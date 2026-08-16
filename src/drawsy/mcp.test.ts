import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("stdio MCP exposes only current-canvas tools and authenticates to loopback", async () => {
  const secret = "test-secret";
  const testRoot = await mkdtemp(path.join(tmpdir(), "drawsy-mcp-test-"));
  const workspaceRoot = path.join(testRoot, "workspace");
  await mkdir(workspaceRoot);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  await writeFile(path.join(workspaceRoot, "generated.png"), png);
  await writeFile(path.join(testRoot, "outside.png"), png);
  let appliedBody = "";
  const connectorRequests: Array<{ url: string; body: unknown }> = [];
  const resourceRequests: unknown[] = [];
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${secret}`);
    if (request.url?.endsWith("/connectors/list")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          sources: [
            {
              connectionId: "google-one",
              capability: "mail",
              label: "gmail",
              accountLabel: "person@example.com"
            },
            {
              connectionId: "fireflies-one",
              capability: "fireflies",
              label: "fireflies",
              accountLabel: "person@example.com"
            }
          ]
        })
      );
      return;
    }
    if (
      request.url?.endsWith("/connectors/search") ||
      request.url?.endsWith("/connectors/read") ||
      request.url?.endsWith("/connectors/query") ||
      request.url?.endsWith("/connectors/mcp-tools") ||
      request.url?.endsWith("/connectors/mcp-call")
    ) {
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      connectorRequests.push({ url: request.url, body: JSON.parse(body) });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        request.url.endsWith("/mcp-tools")
          ? JSON.stringify({
              operation: "mcp_tools",
              capability: "fireflies",
              tools: [
                {
                  name: "fireflies_get_transcripts",
                  description: "Get meeting transcripts",
                  inputSchema: { type: "object" }
                }
              ]
            })
          : request.url.endsWith("/mcp-call")
            ? JSON.stringify({
                operation: "mcp_call",
                capability: "fireflies",
                toolName: "fireflies_get_transcripts",
                content: [{ type: "text", text: "Planning meeting" }],
                structuredContent: null
              })
          : request.url.endsWith("/query")
          ? JSON.stringify({
              operation: "list",
              capability: "mail",
              kind: "mail_messages",
              items: [{ id: "opaque-latest", title: "Latest message" }],
              nextCursor: null
            })
          : request.url.endsWith("/search")
            ? JSON.stringify({
                operation: "search",
                capability: "mail",
                items: [{ id: "opaque-message", title: "Project update" }],
                nextCursor: null
              })
            : JSON.stringify({
                operation: "read",
                capability: "mail",
                item: { id: "opaque-message", content: "Status is green." }
              })
      );
      return;
    }
    if (request.url?.endsWith("/resources/execute")) {
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      resourceRequests.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ boards: [{ id: "board-0001" }] }));
      return;
    }
    if (request.url?.endsWith("/read")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ canvasId: "canvas-1", elements: [] }));
      return;
    }
    for await (const chunk of request) appliedBody += chunk.toString();
    if (request.url?.endsWith("/image")) {
      const body = JSON.parse(appliedBody);
      if (body.sourcePath === "../outside.png") {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: { message: "The image must be inside the selected folder." }
          })
        );
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ elementId: "image-1", width: 320, height: 320 })
      );
      return;
    }
    if (request.url?.endsWith("/context")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "context-1",
          previewPath: path.join(
            workspaceRoot,
            ".drawsy/context/selection.png"
          ),
          elementIds: ["image-1", "note-1"],
          sourceImages: [
            {
              id: "source-1",
              path: path.join(workspaceRoot, ".drawsy/context/source.png")
            }
          ]
        })
      );
      return;
    }
    if (request.url?.endsWith("/preview")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ previewId: "preview-1" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const mcpPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "mcp.js"
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpPath],
    env: {
      PATH: process.env.PATH || "",
      DRAWSY_BRIDGE_URL: `http://127.0.0.1:${address.port}`,
      DRAWSY_SESSION_ID: "session-1",
      DRAWSY_SESSION_SECRET: secret,
      DRAWSY_WORKSPACE_ROOT: workspaceRoot,
      DRAWSY_SURFACE_KIND: "canvas"
    },
    stderr: "pipe"
  });
  const client = new Client({ name: "drawsy-test", version: "0.1.0" });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      "add_image_from_file",
      "apply_canvas_changes",
      "attach_live_preview",
      "call_connected_meeting_tool",
      "capture_canvas_context",
      "create_kanban_card",
      "create_kanban_checklist_item",
      "inspect_current_canvas_layout",
      "link_current_canvas_to_kanban_card",
      "list_aws_cloudformation_stacks",
      "list_aws_regions",
      "list_calendar_events",
      "list_calendars",
      "list_connected_meeting_tools",
      "list_connected_sources",
      "list_drive_files",
      "list_github_issues",
      "list_github_pull_requests",
      "list_github_repositories",
      "list_github_repository_contents",
      "list_jira_backlog",
      "list_jira_boards",
      "list_jira_connections",
      "list_jira_projects",
      "list_jira_sprints",
      "list_kanban_boards",
      "list_mail_messages",
      "list_notion_content",
      "list_slack_channels",
      "list_slack_messages",
      "move_kanban_card",
      "read_connected_item",
      "read_current_canvas",
      "read_jira_issue",
      "read_kanban_board",
      "replace_canvas_image_from_file",
      "search_aws_resources",
      "search_connected_source",
      "search_jira_issues",
      "update_kanban_card",
      "update_kanban_checklist_item"
    ]);
    assert.equal(
      tools.tools.some(
        (tool) => "canvasId" in (tool.inputSchema.properties || {})
      ),
      false
    );
    const genericSearch = tools.tools.find(
      (tool) => tool.name === "search_connected_source"
    );
    assert.deepEqual(
      (
        genericSearch?.inputSchema.properties?.capability as {
          enum?: unknown;
        }
      )?.enum,
      ["mail", "calendar", "drive", "notion", "slack", "github"]
    );
    const applyTool = tools.tools.find(
      (tool) => tool.name === "apply_canvas_changes"
    );
    assert.match(applyTool?.description || "", /live canvas immediately/);
    assert.match(applyTool?.description || "", /Apply work progressively/);

    const read = await client.callTool({
      name: "read_current_canvas",
      arguments: {}
    });
    assert.match(JSON.stringify(read.content), /canvas-1/);
    const layout = await client.callTool({
      name: "inspect_current_canvas_layout",
      arguments: {}
    });
    assert.equal(layout.isError, undefined);
    appliedBody = "";
    const apply = await client.callTool({
      name: "apply_canvas_changes",
      arguments: {
        upsertElements: [{ id: "r1", type: "rectangle" }],
        deleteElementIds: ["old"]
      }
    });
    assert.equal(apply.isError, undefined);
    assert.deepEqual(JSON.parse(appliedBody), {
      upsertElements: [{ id: "r1", type: "rectangle" }],
      deleteElementIds: ["old"],
      files: []
    });

    appliedBody = "";
    const preview = await client.callTool({
      name: "attach_live_preview",
      arguments: {
        url: "http://localhost:5173/",
        title: "Local app"
      }
    });
    assert.equal(preview.isError, undefined);
    assert.deepEqual(JSON.parse(appliedBody), {
      url: "http://localhost:5173/",
      title: "Local app"
    });
    assert.match(JSON.stringify(preview.content), /preview-1/);

    appliedBody = "";
    const image = await client.callTool({
      name: "add_image_from_file",
      arguments: {
        sourcePath: "generated.png",
        x: 40,
        y: 60,
        maxWidth: 320
      }
    });
    assert.equal(image.isError, undefined);
    assert.deepEqual(JSON.parse(appliedBody), {
      sourcePath: "generated.png",
      x: 40,
      y: 60,
      maxWidth: 320
    });
    assert.match(JSON.stringify(image.content), /image-1 \(320 × 320\)/);

    appliedBody = "";
    const escaped = await client.callTool({
      name: "add_image_from_file",
      arguments: {
        sourcePath: "../outside.png",
        x: 0,
        y: 0,
        maxWidth: 100
      }
    });
    assert.equal(escaped.isError, true);
    assert.match(JSON.stringify(escaped.content), /selected folder/);

    appliedBody = "";
    const context = await client.callTool({
      name: "capture_canvas_context",
      arguments: {
        elementIds: ["image-1", "note-1"],
        includeSourceImages: true,
        maxDimension: 2048
      }
    });
    assert.equal(context.isError, undefined);
    assert.deepEqual(JSON.parse(appliedBody), {
      elementIds: ["image-1", "note-1"],
      includeSourceImages: true,
      maxDimension: 2048
    });
    assert.match(JSON.stringify(context.content), /selection\.png/);
    assert.match(JSON.stringify(context.content), /source\.png/);

    appliedBody = "";
    const replacement = await client.callTool({
      name: "replace_canvas_image_from_file",
      arguments: {
        targetElementId: "image-1",
        sourcePath: "generated.png"
      }
    });
    assert.equal(replacement.isError, undefined);
    assert.deepEqual(JSON.parse(appliedBody), {
      targetElementId: "image-1",
      sourcePath: "generated.png"
    });

    const sources = await client.callTool({
      name: "list_connected_sources",
      arguments: {}
    });
    assert.match(JSON.stringify(sources.content), /person@example\.com/);
    const boards = await client.callTool({
      name: "list_kanban_boards",
      arguments: {}
    });
    assert.match(JSON.stringify(boards.content), /board-0001/);
    assert.deepEqual(resourceRequests, [{ operation: "kanban_list_boards" }]);
    const latestMail = await client.callTool({
      name: "list_mail_messages",
      arguments: {
        connectionId: "google-one",
        limit: 1
      }
    });
    assert.match(JSON.stringify(latestMail.content), /opaque-latest/);
    const search = await client.callTool({
      name: "search_connected_source",
      arguments: {
        capability: "mail",
        connectionId: "google-one",
        query: "project update"
      }
    });
    assert.match(JSON.stringify(search.content), /opaque-message/);
    const awsSearch = await client.callTool({
      name: "search_aws_resources",
      arguments: {
        connectionId: "aws-one",
        region: "ap-south-1",
        query: ""
      }
    });
    assert.equal(awsSearch.isError, undefined);
    const invalidGenericAwsSearch = await client.callTool({
      name: "search_connected_source",
      arguments: {
        capability: "aws",
        connectionId: "aws-one",
        query: "service:ec2"
      }
    });
    assert.equal(invalidGenericAwsSearch.isError, true);
    const connectedItem = await client.callTool({
      name: "read_connected_item",
      arguments: {
        capability: "mail",
        connectionId: "google-one",
        resourceId: "opaque-message"
      }
    });
    assert.match(JSON.stringify(connectedItem.content), /Status is green/);
    const meetingTools = await client.callTool({
      name: "list_connected_meeting_tools",
      arguments: {
        capability: "fireflies",
        connectionId: "fireflies-one"
      }
    });
    assert.match(
      JSON.stringify(meetingTools.content),
      /fireflies_get_transcripts/
    );
    const meeting = await client.callTool({
      name: "call_connected_meeting_tool",
      arguments: {
        capability: "fireflies",
        connectionId: "fireflies-one",
        toolName: "fireflies_get_transcripts",
        arguments: { limit: 1 }
      }
    });
    assert.match(JSON.stringify(meeting.content), /Planning meeting/);
    assert.deepEqual(connectorRequests, [
      {
        url: "/internal/sessions/session-1/connectors/query",
        body: {
          capability: "mail",
          kind: "mail_messages",
          connectionId: "google-one",
          includeSpamTrash: false,
          limit: 1
        }
      },
      {
        url: "/internal/sessions/session-1/connectors/search",
        body: {
          capability: "mail",
          connectionId: "google-one",
          query: "project update",
          limit: 10
        }
      },
      {
        url: "/internal/sessions/session-1/connectors/search",
        body: {
          capability: "aws",
          connectionId: "aws-one",
          region: "ap-south-1",
          query: "",
          limit: 50
        }
      },
      {
        url: "/internal/sessions/session-1/connectors/read",
        body: {
          capability: "mail",
          connectionId: "google-one",
          resourceId: "opaque-message"
        }
      },
      {
        url: "/internal/sessions/session-1/connectors/mcp-tools",
        body: {
          capability: "fireflies",
          connectionId: "fireflies-one"
        }
      },
      {
        url: "/internal/sessions/session-1/connectors/mcp-call",
        body: {
          capability: "fireflies",
          connectionId: "fireflies-one",
          toolName: "fireflies_get_transcripts",
          arguments: { limit: 1 }
        }
      }
    ]);

    const listSurfaceTools = async (surfaceKind: "kanban" | "neutral") => {
      const surfaceTransport = new StdioClientTransport({
        command: process.execPath,
        args: [mcpPath],
        env: {
          PATH: process.env.PATH || "",
          DRAWSY_BRIDGE_URL: `http://127.0.0.1:${address.port}`,
          DRAWSY_SESSION_ID: "session-1",
          DRAWSY_SESSION_SECRET: secret,
          DRAWSY_WORKSPACE_ROOT: workspaceRoot,
          DRAWSY_SURFACE_KIND: surfaceKind
        },
        stderr: "pipe"
      });
      const surfaceClient = new Client({
        name: `drawsy-${surfaceKind}-test`,
        version: "0.1.0"
      });
      try {
        await surfaceClient.connect(surfaceTransport);
        return (await surfaceClient.listTools()).tools.map((tool) => tool.name);
      } finally {
        await surfaceClient.close();
      }
    };
    const neutralTools = await listSurfaceTools("neutral");
    assert.equal(neutralTools.includes("read_current_canvas"), false);
    assert.equal(neutralTools.includes("read_current_kanban_board"), false);
    assert.equal(
      neutralTools.includes("link_current_canvas_to_kanban_card"),
      false
    );
    assert.equal(neutralTools.includes("list_kanban_boards"), true);
    assert.equal(neutralTools.includes("list_jira_connections"), true);

    const kanbanTools = await listSurfaceTools("kanban");
    assert.equal(kanbanTools.includes("read_current_kanban_board"), true);
    assert.equal(kanbanTools.includes("read_current_canvas"), false);
    assert.equal(
      kanbanTools.includes("link_current_canvas_to_kanban_card"),
      false
    );
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(testRoot, { recursive: true, force: true });
  }
});
