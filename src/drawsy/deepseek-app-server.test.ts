import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentMetadata, BridgeEvent } from "./protocol.js";
import { deepSeekSdkArguments, DeepSeekAppServer, DeepSeekSdkProcess, drawsyMcpOverlay } from "./deepseek-app-server.js";

test("DeepSeek Harness launches the native SDK profile with an additive patch", () => {
  assert.deepEqual(deepSeekSdkArguments("/tmp/drawsy.patch.yml"), ["--profile", "sdk", "--patch", "/tmp/drawsy.patch.yml"]);
  const overlay = drawsyMcpOverlay({
    id: "drawsy-test-session", command: "/usr/bin/node", entry: "/app/mcp.js", cwd: "/workspace",
    env: { DRAWSY_SESSION_ID: "session-1", DRAWSY_SESSION_SECRET: "secret" }
  });
  assert.match(overlay, /- insert:/);
  assert.match(overlay, /name: '@deepseek-ai\/dsh-mcp-client'/);
  assert.match(overlay, /serverName: drawsy/);
  assert.match(overlay, /startupTimeoutMs: 30000/);
  assert.match(overlay, /failOnStartupError: true/);
  assert.match(overlay, /DRAWSY_SESSION_SECRET: "secret"/);
  assert.doesNotMatch(overlay, /- remove:|disabled: true/);
});

test("DeepSeek SDK process answers native host requests while a client request waits", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "drawsy-deepseek-sdk-"));
  const script = path.join(root, "peer.mjs");
  await writeFile(script, `
let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  pending += chunk;
  let at;
  while ((at = pending.indexOf("\\n")) >= 0) {
    const line = pending.slice(0, at); pending = pending.slice(at + 1);
    const request = JSON.parse(line);
    if (request.method === "session/query") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "session.status", params: { sessionId: "s", status: "running" } }) + "\\n");
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "user-question/ask",
        params: { requestId: "question-1", sessionId: "s", questions: [
          { id: "name", question: "Name?" },
          { id: "color", question: "Colors?", options: [{ label: "Blue" }], multiSelect: true }
        ] }
      }) + "\\n");
    } else if (request.id === 1 && request.result) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: "1", result: request.result }) + "\\n");
    }
  }
});
`);
  const notices: string[] = [];
  let receiveQuestion!: (event: Extract<BridgeEvent, { type: "question.request" }>) => void;
  const question = new Promise<Extract<BridgeEvent, { type: "question.request" }>>((resolve) => {
    receiveQuestion = resolve;
  });
  const rpc = new DeepSeekSdkProcess(
    (method) => notices.push(method),
    (id, method, params) => internal.handleRequest(rpc, id, method, params)
  );
  const server = Object.assign(Object.create(DeepSeekAppServer.prototype), {
    session: { nativeSessionId: "s" },
    rpc, turnToken: "turn-1", pendingQuestions: new Map(),
    emit: (event: BridgeEvent) => {
      if (event.type === "question.request") receiveQuestion(event);
    }
  }) as DeepSeekAppServer;
  const internal = server as unknown as {
    handleRequest(rpc: DeepSeekSdkProcess, id: string | number, method: string, params: Record<string, unknown>): void;
  };
  try {
    rpc.start(process.execPath, [script], { cwd: root, env: process.env, detached: false });
    const query = rpc.request("session/query", {}, 2_000);
    const event = await Promise.race([question, query.then(() => { throw new Error("Query completed before the question."); })]);
    assert.equal(event.data.requestId, "question-1");
    assert.equal(event.data.turnId, "turn-1");
    assert.equal(await server.answerQuestion("question-1", { name: ["Drawsy"], color: ["Blue", "Green"] }), true);
    assert.deepEqual(await query, {
      answers: [
        { id: "name", selected: [], custom: "Drawsy" },
        { id: "color", selected: ["Blue"], custom: "Green" }
      ]
    });
    assert.equal(await server.dismissQuestion("question-1"), false);
    assert.deepEqual(notices, ["session.status"]);
  } finally {
    await rpc.close(); await rm(root, { recursive: true, force: true });
  }
});

test("DeepSeek SDK preserves native turn failure reasons in command completion", () => {
  let outcome: [string, string | undefined] | null = null;
  const server = Object.assign(Object.create(DeepSeekAppServer.prototype), {
    session: { nativeSessionId: "s" }, turnActive: true, turnResultStatus: "completed", turnResultError: undefined,
    turnEnd: (status: string, error?: string) => { outcome = [status, error]; }
  }) as DeepSeekAppServer;
  const internal = server as unknown as { handleNotification(method: string, params: Record<string, unknown>): void };
  internal.handleNotification("session.event", {
    sessionId: "s", event: { type: "turn/end", data: { reason: { kind: "error", error: { message: "Missing API key" } } } }
  });
  internal.handleNotification("session.query.completed", { sessionId: "s", finishReason: "ok", finalResponse: "Missing API key" });
  assert.deepEqual(outcome, ["failed", "Missing API key"]);
});

test("DeepSeek ordinary prompt waits for native idle and accepts a second turn", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "drawsy-deepseek-turns-"));
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const fakeRpc = { request: async (method: string) => method === "session/query" ? { kind: "prompt", messageId: "message" } : {} };
  const server = Object.assign(Object.create(DeepSeekAppServer.prototype), {
    folderPath: root,
    session: { id: "s", nativeSessionId: "native-s", surfaceKind: "canvas", surfaceName: "Canvas", workspaceMode: "private", previewPort: null },
    rpc: fakeRpc, closed: false, turnActive: false, turnEnd: null, history: [],
    markerPath: path.join(root, "session-created"),
    emit: (event: { type: string; data: Record<string, unknown> }) => events.push(event)
  }) as DeepSeekAppServer;
  try {
    for (const [index, message] of ["first", "second"].entries()) {
      await server.startTurn(message);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(events.filter((event) => event.type === "turn.status" && event.data.status === "completed").length, index + 1);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("DeepSeek controls expose the native provider catalogue and reasoning options", async () => {
  const server = Object.assign(Object.create(DeepSeekAppServer.prototype), {
    session: { deepseekBinary: "/dsh" }, rpc: {}, closed: false,
    agent: { model: "deepseek-flash", modelProvider: "deepseek-account", reasoningEffort: "high", serviceTier: null },
    loadModelCatalog: async () => ({
      default: { provider: "deepseek-account", model: "deepseek-flash" }, routableProviders: ["deepseek-account"],
      groups: [{ id: "deepseek-account", name: "DeepSeek Account", models: [{
        id: "deepseek-flash", name: "DeepSeek Flash", reasoning: {
          defaultEffort: "medium", efforts: [{ id: "medium", description: "Balanced" }, { id: "high", description: "More reasoning" }]
        }
      }] }], failures: []
    })
  }) as DeepSeekAppServer;
  const controls = await server.getControls();
  assert.deepEqual(controls.models, [{
    id: "deepseek-account:deepseek-flash", model: "deepseek-flash", providerId: "deepseek-account",
    displayName: "DeepSeek Flash", description: "DeepSeek Account",
    efforts: [{ id: "medium", description: "Balanced" }, { id: "high", description: "More reasoning" }],
    defaultEffort: "medium", isDefault: true
  }]);
});

test("DeepSeek selection restarts the SDK session with the native route and reasoning effort", async () => {
  const server = Object.assign(Object.create(DeepSeekAppServer.prototype), {
    session: { deepseekBinary: "/dsh" }, rpc: { close: async () => undefined }, closed: false, turnActive: false,
    selectedModel: { provider: "deepseek-account", model: "deepseek-flash" },
    agent: { model: "deepseek-flash", modelProvider: "deepseek-account", reasoningEffort: null, serviceTier: null },
    loadModelCatalog: async () => ({
      default: { provider: "deepseek-account", model: "deepseek-flash" }, routableProviders: ["deepseek-account"],
      groups: [{ id: "deepseek-account", name: "DeepSeek Account", models: [{
        id: "deepseek-flash", name: "DeepSeek Flash", reasoning: { efforts: [{ id: "high" }] }
      }] }], failures: []
    }),
    initialize: async function(this: { selectedModel: { provider: string; model: string; reasoningEffort?: string }; agent: AgentMetadata; rpc: object }) {
      this.agent = { model: this.selectedModel.model, modelProvider: this.selectedModel.provider, reasoningEffort: this.selectedModel.reasoningEffort || null, serviceTier: null };
      this.rpc = {};
    }
  }) as DeepSeekAppServer;
  const result = await server.updateSettings({ modelProvider: "deepseek-account", model: "deepseek-flash", effort: "high" });
  assert.equal(result.agent.modelProvider, "deepseek-account");
  assert.equal(result.agent.model, "deepseek-flash");
  assert.equal(result.agent.reasoningEffort, "high");
});

test("DeepSeek rejects reasoning efforts absent from the native model catalogue", async () => {
  const server = Object.assign(Object.create(DeepSeekAppServer.prototype), {
    session: { deepseekBinary: "/dsh" }, rpc: {}, closed: false, turnActive: false,
    selectedModel: { provider: "deepseek-account", model: "deepseek-flash" },
    agent: { model: "deepseek-flash", modelProvider: "deepseek-account", reasoningEffort: null, serviceTier: null },
    loadModelCatalog: async () => ({
      default: { provider: "deepseek-account", model: "deepseek-flash" }, routableProviders: ["deepseek-account"],
      groups: [{ id: "deepseek-account", name: "DeepSeek Account", models: [{ id: "deepseek-flash", name: "DeepSeek Flash", reasoning: { efforts: [{ id: "low" }] } }] }], failures: []
    })
  }) as DeepSeekAppServer;
  await assert.rejects(server.updateSettings({ effort: "unavailable" }), /not available/);
});

test("DeepSeek SDK restarts do not announce a new bridge session", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "drawsy-deepseek-readiness-"));
  const binary = path.join(root, "dsh");
  await writeFile(binary, `#!${process.execPath}
import readline from 'node:readline';
for await (const line of readline.createInterface({input:process.stdin})) {
  const request=JSON.parse(line);
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{}})+'\\n');
}
`, { mode: 0o700 });
  const events: Array<{ type: string }> = [];
  const catalog = {
    default: { provider: "native", model: "model" }, routableProviders: ["native"], failures: [],
    groups: [{ id: "native", name: "Native", models: [{ id: "model", name: "Model", reasoning: { efforts: [{ id: "low" }, { id: "high" }] } }] }]
  };
  const server = Object.assign(Object.create(DeepSeekAppServer.prototype), {
    folderPath: root, markerPath: path.join(root, "session-created"),
    pendingQuestions: new Map(),
    session: { id: "test", secret: "test", bridgeUrl: "http://127.0.0.1:1", runtimePath: root,
      nativeSessionId: "native-session", deepseekBinary: binary, surfaceKind: "canvas", workspaceMode: "private", isolateProcessGroup: false },
    loadModelCatalog: async () => catalog,
    selectedModel: { provider: "native", model: "model", reasoningEffort: "low" },
    emit: (event: { type: string }) => events.push(event)
  }) as DeepSeekAppServer;
  try {
    await (server as unknown as { initialize(): Promise<void> }).initialize();
    await server.updateSettings({ effort: "high" });
    assert.equal(server.metadata.reasoningEffort, "high");
    assert.equal(events.filter((event) => event.type === "session.ready").length, 0);
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
});

test("DeepSeek reserves turn startup while asynchronous preparation is pending", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const server = Object.assign(Object.create(DeepSeekAppServer.prototype), {
    startingTurn: false, turnActive: false, updatingSettings: false,
    prepareTurn: async () => gate
  }) as DeepSeekAppServer;
  const first = server.startTurn("first");
  await assert.rejects(server.startTurn("second"), /already running/);
  release();
  await first;
  assert.equal((server as unknown as { startingTurn: boolean }).startingTurn, false);
});

test("DeepSeek prevents model changes from racing an active turn", async () => {
  const server = Object.assign(Object.create(DeepSeekAppServer.prototype), {
    startingTurn: false, turnActive: true, updatingSettings: false
  }) as DeepSeekAppServer;
  await assert.rejects(server.updateSettings({ model: "other" }), /operation to finish/);
});

test("DeepSeek native child notifications stay scoped to the conversation tree", () => {
  const events: BridgeEvent[] = [];
  const server = Object.assign(Object.create(DeepSeekAppServer.prototype), {
    session: { nativeSessionId: "root" },
    subagentSessions: new Set(),
    emit: (event: BridgeEvent) => events.push(event)
  }) as { handleNotification(method: string, params: Record<string, unknown>): void };
  server.handleNotification("subagent.started", { parentSessionId: "unrelated", childSessionId: "other" });
  server.handleNotification("subagent.started", { parentSessionId: "root", childSessionId: "child" });
  server.handleNotification("session.status", { sessionId: "child", status: "running" });
  server.handleNotification("subagent.finished", {
    parentSessionId: "child", childSessionId: "nested", status: "error", stopReason: "aborted"
  });
  server.handleNotification("subagent.finished", {
    parentSessionId: "root", childSessionId: "child", status: "ok", stopReason: "completed",
    lastAssistantMessage: [{ type: "text", text: "Research complete." }]
  });
  assert.deepEqual(events, [
    { type: "subagent.updated", data: { id: "child", status: "unknown" } },
    { type: "subagent.updated", data: { id: "child", status: "running" } },
    { type: "subagent.updated", data: { id: "nested", status: "interrupted" } },
    { type: "subagent.updated", data: { id: "child", status: "completed", detail: "Research complete.", output: "Research complete." } }
  ]);
});
