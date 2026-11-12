import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  findPiSessionFile,
  PiAppServer,
  PiRpcProcess,
  ompHostToolDefinitions,
  ompRpcArguments,
  ompSubagentUpdate,
  ompTurnFailure,
  piExampleSubagentUpdates,
  piRpcArguments,
  validatePiSessionId
} from "./pi-app-server.js";
import piWorkspaceExtension from "./pi-workspace-extension.js";

test("Pi RPC uses the native runtime configuration and keeps its session extension", () => {
  const args = piRpcArguments({
    sessionDir: "/runtime/sessions",
    nativeSessionId: "drawsy-conversation-1",
    extensionPath: "/app/dist/drawsy/pi-workspace-extension.js",
    systemPrompt: "Drawsy harness"
  });
  assert.ok(args.includes("--mode"));
  assert.ok(args.includes("rpc"));
  assert.ok(args.includes("--no-approve"));
  assert.ok(args.includes("/app/dist/drawsy/pi-workspace-extension.js"));
  for (const flag of ["--no-extensions", "--no-context-files", "--no-skills", "--no-builtin-tools", "--tools"]) {
    assert.ok(!args.includes(flag));
  }
});

test("Pi adapter rejects unsupported access controls without restarting the native process", async () => {
  const server = Object.assign(Object.create(PiAppServer.prototype), {
    rpc: {},
    currentModel: { id: "model", provider: "provider" },
    turnActive: false,
    session: { engine: "pi" }
  }) as PiAppServer;
  await assert.rejects(
    server.updateSettings({ accessMode: "readOnly" }),
    /runs as a native process; access and Internet controls are not available/i
  );
});

test("OMP RPC uses the native runtime configuration and retains full approval mode", () => {
  const args = ompRpcArguments({
    bootstrapSessionDir: "/runtime/bootstrap-sessions",
    extensionPath: "/app/dist/drawsy/pi-workspace-extension.js",
    systemPrompt: "Drawsy OMP harness"
  });
  assert.equal(args[args.indexOf("--mode") + 1], "rpc-ui");
  assert.ok(args.includes("--no-ui"));
  assert.ok(args.includes("--approval-mode"));
  assert.ok(args.includes("/app/dist/drawsy/pi-workspace-extension.js"));
  for (const flag of ["--no-extensions", "--no-context-files", "--no-rules", "--no-skills", "--no-tools"]) {
    assert.ok(!args.includes(flag));
  }
});

test("OMP host tools receive unique, provider-safe names and retain MCP schemas", () => {
  const definitions = ompHostToolDefinitions([
    { name: "search", title: "Search", description: "Find items", inputSchema: { type: "object" } },
    { name: "find.item", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
    { name: "find_item", inputSchema: { type: "object" } },
    { name: "long_".repeat(20), inputSchema: { type: "object" } }
  ]);
  const names = definitions.map((definition) => definition.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.every((name) => name.length <= 64 && /^[A-Za-z0-9_-]+$/.test(name)));
  assert.equal(definitions[0]!.label, "Search");
  assert.deepEqual(definitions[0]!.parameters, { type: "object" });
  assert.equal(definitions[2]!.name.startsWith("mcp__drawsy__find_item_"), true);
});

test("OMP provider failures use the active OMP login in their message", () => {
  assert.deepEqual(ompTurnFailure({ error: { httpStatus: 401, message: "Unauthorized" } }), {
    message: "The AI provider refused this request. Check the login in OMP."
  });
  assert.deepEqual(ompTurnFailure({ error: { message: "Temporary model failure" } }), {
    message: "OMP could not complete this request. Check the selected provider login and model."
  });
});

test("OMP subagent lifecycle and progress frames normalize to Drawsy updates", () => {
  assert.deepEqual(ompSubagentUpdate({
    id: "worker-1",
    agent: "researcher",
    description: "Compare the two APIs",
    status: "started",
    index: 1
  }, "lifecycle"), {
    id: "worker-1",
    label: "researcher",
    status: "running",
    detail: "Compare the two APIs"
  });
  assert.deepEqual(ompSubagentUpdate({
    index: 1,
    agent: "researcher",
    progress: { id: "worker-1", agent: "researcher", task: "Check upstream API behavior", status: "running", description: "Reading docs", output: "Found one source." }
  }, "progress"), {
    id: "worker-1",
    label: "researcher",
    task: "Check upstream API behavior",
    status: "running",
    detail: "Reading docs",
    activity: "Reading docs",
    output: "Found one source."
  });
  assert.deepEqual(ompSubagentUpdate({ id: "worker-1", status: "aborted" }, "lifecycle"), {
    id: "worker-1",
    status: "interrupted"
  });
  assert.equal(ompSubagentUpdate({ status: "started" }, "lifecycle"), null);
});

test("OMP forwards only native child tool and assistant message activity", () => {
  const events: unknown[] = [];
  const server = Object.assign(Object.create(PiAppServer.prototype), {
    session: { engine: "omp" },
    observedOmpSubagentOutputs: new Map(),
    observedOmpSubagentStatuses: new Map([["worker", "running"]]),
    emit: (event: unknown) => events.push(event)
  }) as { handleEvent(event: Record<string, unknown>): void };
  server.handleEvent({ type: "subagent_event", payload: { id: "worker", event: { type: "tool_execution_start", toolName: "read" } } });
  server.handleEvent({ type: "subagent_event", payload: { id: "worker", event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Checking " } } } });
  server.handleEvent({ type: "subagent_event", payload: { id: "worker", event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "the file." } } } });
  assert.deepEqual(events, [
    { type: "subagent.updated", data: { id: "worker", status: "running", activity: "Running read" } },
    { type: "subagent.updated", data: { id: "worker", status: "running", output: "Checking " } },
    { type: "subagent.updated", data: { id: "worker", status: "running", output: "Checking the file." } }
  ]);
});

test("Pi example subagent details are observed only in the documented result shape", () => {
  const details = {
    mode: "parallel",
    agentScope: "user",
    projectAgentsDir: null,
    results: [{
      agent: "reviewer",
      agentSource: "user",
      task: "Check the patch",
      exitCode: 0,
      messages: [{ role: "assistant", content: [{ type: "text", text: "Reviewed the patch." }] }],
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 }
    }]
  };
  assert.deepEqual(piExampleSubagentUpdates("tool-1", { details }, false), [{
    id: "tool-1:1",
    label: "reviewer",
    task: "Check the patch",
    status: "running",
    output: "Reviewed the patch."
  }]);
  assert.equal(piExampleSubagentUpdates("tool-1", { details }, true)[0]?.status, "completed");
  assert.equal(piExampleSubagentUpdates("tool-1", { details: { mode: "parallel", results: [] } }, false).length, 0);
});

test("OMP reports unsupported models without blaming provider login", () => {
  assert.deepEqual(
    ompTurnFailure({ error: { httpStatus: 400, message: "400 The requested model is not supported. code=model_not_supported" } }),
    { message: "The selected OMP provider does not support this model. Choose a model supported by that provider." }
  );
  assert.deepEqual(
    ompTurnFailure({ error: { httpStatus: 400, code: "model_not_supported" } }),
    { message: "The selected OMP provider does not support this model. Choose a model supported by that provider." }
  );
});

test("OMP RPC negotiates v2 and reassembles its chunked event stream", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "drawsy-omp-rpc-"));
  const scriptPath = path.join(root, "fake-omp.mjs");
  const script = `
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
send({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 4096, maxReassembledFrameBytes: 1048576 });
let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  pending += chunk;
  let newline = pending.indexOf("\\n");
  while (newline >= 0) {
    const request = JSON.parse(pending.slice(0, newline));
    pending = pending.slice(newline + 1);
    if (request.type === "emit_test") {
      const frame = Buffer.from(JSON.stringify({ type: "test_large_event", text: "雪🌱".repeat(220) }));
      const size = 240;
      const count = Math.ceil(frame.length / size);
      for (let index = 0; index < count; index += 1) {
        send({ type: "rpc_chunk", chunkId: "large-1", index, count, byteLength: frame.length, data: frame.subarray(index * size, (index + 1) * size).toString("base64") });
      }
    }
    send({ id: request.id, type: "response", command: request.type, success: true, data: request.type === "negotiate_protocol" ? { protocolVersion: 2 } : { ok: true } });
    newline = pending.indexOf("\\n");
  }
});
`;
  await writeFile(scriptPath, script);
  const events: Array<Record<string, unknown>> = [];
  let resolveEvent!: (event: Record<string, unknown>) => void;
  const eventPromise = new Promise<Record<string, unknown>>((resolve) => { resolveEvent = resolve; });
  const rpc = new PiRpcProcess("omp", (event) => {
    events.push(event);
    if (event.type === "test_large_event") resolveEvent(event);
  }, () => undefined, () => undefined, () => true, () => undefined);

  try {
    rpc.start(process.execPath, [scriptPath], { cwd: root, env: process.env, detached: false });
    await rpc.protocolReady;
    assert.deepEqual(await rpc.request("get_state"), { ok: true });
    assert.deepEqual(await rpc.request("emit_test"), { ok: true });
    assert.deepEqual(await eventPromise, { type: "test_large_event", text: "雪🌱".repeat(220) });
    assert.deepEqual(events.filter((event) => event.type === "rpc_chunk"), []);
  } finally {
    await rpc.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("OMP turn errors remain active until the session settles", () => {
  const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
  const server = Object.assign(Object.create(PiAppServer.prototype), {
    session: { engine: "omp" },
    turnActive: true,
    activeAssistantMessageId: "omp-message",
    turnFailure: null,
    pendingOmpTurnStatus: null,
    emit: (event: { type: string; data?: Record<string, unknown> }) => events.push(event)
  }) as unknown as {
    turnActive: boolean;
    handleEvent(event: Record<string, unknown>): void;
  };

  server.handleEvent({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "Provider refused" }], stopReason: "error" }
  });
  server.handleEvent({
    type: "prompt_result",
    status: "error",
    sessionSettled: false,
    error: { httpStatus: 401, message: "Unauthorized" }
  });

  assert.equal(server.turnActive, true);
  assert.deepEqual(events, []);
  server.handleEvent({ type: "session_settled" });
  assert.equal(server.turnActive, false);
  assert.deepEqual(events, [{
    type: "turn.status",
    data: {
      status: "failed",
      error: "The AI provider refused this request. Check the login in OMP."
    }
  }]);
});

test("Pi session ids are constrained before they enter the session path", () => {
  assert.equal(validatePiSessionId("01f4a993-a71d-4eae-9f03-cc9a24961d02"), "01f4a993-a71d-4eae-9f03-cc9a24961d02");
  assert.throws(() => validatePiSessionId("../outside"), /session id is invalid/i);
});

test("Pi session resume detection reads the stable session header", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "drawsy-pi-session-"));
  const sessionId = "drawsy-thread-1";
  try {
    const filePath = path.join(root, `2026-11-04T11-00-00-000Z_${sessionId}.jsonl`);
    await writeFile(filePath, `${JSON.stringify({ type: "session", id: sessionId })}\n`);
    assert.equal(await findPiSessionFile(root, sessionId), filePath);
    assert.equal(await findPiSessionFile(root, "drawsy-thread-2"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unexpected Pi exits clear runtime readiness and report the failure", () => {
  const client = {};
  const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
  const server = Object.assign(Object.create(PiAppServer.prototype), {
    rpc: client,
    mcpReady: true,
    turnActive: false,
    activeAssistantMessageId: "assistant-message",
    turnFailure: { code: "pi_provider_error", message: "Provider failed." },
    closed: false,
    emit: (event: { type: string; data?: Record<string, unknown> }) => events.push(event)
  }) as unknown as {
    rpc: unknown;
    mcpReady: boolean;
    activeAssistantMessageId: string | null;
    handleProcessExit(client: object): void;
  };

  server.handleProcessExit(client);

  assert.equal(server.rpc, null);
  assert.equal(server.mcpReady, false);
  assert.equal(server.activeAssistantMessageId, null);
  assert.deepEqual(events, [{
    type: "error",
    data: {
      code: "pi_process_exited",
      message: "Pi stopped unexpectedly. Reopen the Drawsy chat to reconnect."
    }
  }]);
});

test("unexpected Pi exit fails an active turn", () => {
  const client = {};
  const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
  const server = Object.assign(Object.create(PiAppServer.prototype), {
    rpc: client,
    mcpReady: true,
    turnActive: true,
    activeAssistantMessageId: "assistant-message",
    turnFailure: null,
    closed: false,
    emit: (event: { type: string; data?: Record<string, unknown> }) => events.push(event)
  }) as unknown as {
    turnActive: boolean;
    handleProcessExit(client: object): void;
  };

  server.handleProcessExit(client);

  assert.equal(server.turnActive, false);
  assert.deepEqual(events, [{
    type: "turn.status",
    data: {
      status: "failed",
      error: "Pi stopped before the request completed."
    }
  }]);
});

test("Pi provider failures surface once after the run settles", () => {
  const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
  const server = Object.assign(Object.create(PiAppServer.prototype), {
    turnActive: true,
    activeAssistantMessageId: "assistant-message",
    turnFailure: null,
    emit: (event: { type: string; data?: Record<string, unknown> }) => events.push(event)
  }) as unknown as {
    turnActive: boolean;
    handleEvent(event: Record<string, unknown>): void;
  };
  const failedMessage = {
    role: "assistant",
    content: [],
    errorMessage: "401 Unauthorized",
    stopReason: "error"
  };

  server.handleEvent({ type: "message_end", message: failedMessage });
  server.handleEvent({ type: "message_end", message: failedMessage });

  assert.equal(server.turnActive, true);
  assert.deepEqual(events, []);

  server.handleEvent({ type: "agent_settled" });

  assert.equal(server.turnActive, false);
  assert.deepEqual(events, [{
    type: "turn.status",
    data: {
      status: "failed",
      error: "The AI provider refused this request. Check the login in Pi."
    }
  }]);
});

test("a successful Pi retry clears an earlier provider failure", () => {
  const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
  const server = Object.assign(Object.create(PiAppServer.prototype), {
    turnActive: true,
    activeAssistantMessageId: "assistant-message",
    turnFailure: null,
    emit: (event: { type: string; data?: Record<string, unknown> }) => events.push(event)
  }) as unknown as {
    turnActive: boolean;
    handleEvent(event: Record<string, unknown>): void;
  };

  server.handleEvent({
    type: "message_end",
    message: {
      role: "assistant",
      content: [],
      errorMessage: "temporary provider error",
      stopReason: "error"
    }
  });
  server.handleEvent({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Recovered." }],
      stopReason: "stop"
    }
  });
  server.handleEvent({ type: "agent_settled" });

  assert.deepEqual(events, [
    { type: "assistant.final", data: { itemId: "assistant-message", text: "Recovered." } },
    { type: "turn.status", data: { status: "completed" } }
  ]);
});

for (const response of [undefined, { agentInvoked: false }, { disposition: "handled" }]) {
  test(`OMP prompt ${JSON.stringify(response)} preserves the native turn lifecycle`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "drawsy-pi-handled-"));
    const runtimePath = path.join(root, "runtime");
    await mkdir(runtimePath);
    const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const server = Object.assign(Object.create(PiAppServer.prototype), {
      folderPath: root,
      session: {
        engine: "omp",
        surfaceKind: "neutral",
        previewPort: null,
        workspaceMode: "private",
        runtimePath
      },
      rpc: { request: async () => response },
      currentModel: { id: "model", provider: "provider", input: ["text"] },
      mcpReady: true,
      turnActive: false,
      emit: (event: { type: string; data?: Record<string, unknown> }) => events.push(event)
    }) as unknown as { startTurn(message: string): Promise<void>; turnActive: boolean; handleEvent(event: Record<string, unknown>): void };

    try {
      await server.startTurn("handled command");
      if (response === undefined) {
        assert.equal(server.turnActive, true);
        assert.deepEqual(events.map((event) => event.data?.status), ["inProgress"]);
        server.handleEvent({ type: "prompt_result", status: "success", sessionSettled: false });
        assert.equal(server.turnActive, true);
        server.handleEvent({ type: "session_settled" });
      }
      assert.equal(server.turnActive, false);
      assert.deepEqual(events.map((event) => [event.type, event.data?.status]), [
        ["turn.status", "inProgress"],
        ["turn.status", "completed"]
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("Pi extension attaches the Drawsy MCP server and injects per-turn instructions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "drawsy-pi-extension-"));
  const runtime = path.join(root, "runtime");
  await mkdir(runtime);
  await writeFile(path.join(runtime, "turn-instructions.txt"), "Canvas instructions");
  const keys = [
    "DRAWSY_PI_ENGINE",
    "DRAWSY_PI_WORKSPACE_ROOT",
    "DRAWSY_PI_RUNTIME_PATH",
    "DRAWSY_BRIDGE_URL",
    "DRAWSY_SESSION_ID",
    "DRAWSY_SESSION_SECRET",
    "DRAWSY_SURFACE_KIND"
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    DRAWSY_PI_ENGINE: "pi",
    DRAWSY_PI_WORKSPACE_ROOT: root,
    DRAWSY_PI_RUNTIME_PATH: path.join(root, "runtime"),
    DRAWSY_BRIDGE_URL: "http://127.0.0.1:3031",
    DRAWSY_SESSION_ID: "omp-extension-test",
    DRAWSY_SESSION_SECRET: "test-secret",
    DRAWSY_SURFACE_KIND: "neutral"
  });
  const registeredTools: string[] = [];
  const servers: Array<{ name: string; config: Record<string, unknown> }> = [];
  const handlers = new Map<string, (...args: any[]) => unknown>();

  try {
    piWorkspaceExtension({
      registerTool: (tool) => registeredTools.push(String(tool.name)),
      registerMcpServer: (name, config) => servers.push({ name, config }),
      getActiveTools: () => [],
      on: (event, handler) => { handlers.set(event, handler); return () => undefined; }
    });
    assert.deepEqual(registeredTools, []);
    assert.equal(servers.length, 1);
    assert.equal(servers[0]?.name, "drawsy");
    assert.equal(servers[0]?.config.cwd, root);
    const injected = await handlers.get("before_agent_start")?.({ systemPrompt: "native prompt" }) as { systemPrompt: string };
    assert.match(injected.systemPrompt, /Canvas instructions/);
    await handlers.get("agent_settled")?.({});
    assert.equal(await readFile(path.join(runtime, "turn-instructions.txt"), "utf8"), "");
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("OMP extension leaves Drawsy MCP host tools to the RPC server", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "drawsy-omp-extension-"));
  const keys = [
    "DRAWSY_PI_ENGINE",
    "DRAWSY_PI_WORKSPACE_ROOT",
    "DRAWSY_PI_RUNTIME_PATH",
    "DRAWSY_BRIDGE_URL",
    "DRAWSY_SESSION_ID",
    "DRAWSY_SESSION_SECRET",
    "DRAWSY_SURFACE_KIND"
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    DRAWSY_PI_ENGINE: "omp",
    DRAWSY_PI_WORKSPACE_ROOT: root,
    DRAWSY_PI_RUNTIME_PATH: path.join(root, "runtime"),
    DRAWSY_BRIDGE_URL: "http://127.0.0.1:3031",
    DRAWSY_SESSION_ID: "omp-extension-test",
    DRAWSY_SESSION_SECRET: "test-secret",
    DRAWSY_SURFACE_KIND: "neutral"
  });
  const registeredTools: string[] = [];
  let nestedMcpServers = 0;
  try {
    piWorkspaceExtension({
      registerTool: (tool) => registeredTools.push(String(tool.name)),
      registerMcpServer: () => { nestedMcpServers += 1; },
      getActiveTools: () => [],
      on: () => () => undefined
    });
    assert.deepEqual(registeredTools, []);
    assert.equal(nestedMcpServers, 0);
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
