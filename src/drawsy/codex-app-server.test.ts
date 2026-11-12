import assert from "node:assert/strict";
import test from "node:test";
import { CodexAppServer, codexSubagentUpdates, getDeveloperInstructions } from "./codex-app-server.js";

test("local Codex rejects access controls without changing its native settings", async () => {
  const server = Object.assign(Object.create(CodexAppServer.prototype), {
    threadId: "thread-1",
    agentMetadata: { model: "model" },
    turnActive: false
  }) as CodexAppServer;
  for (const settings of [{ accessMode: "readOnly" as const }, { internetEnabled: false }]) {
    await assert.rejects(server.updateSettings(settings), /native full-access settings/i);
  }
});

test("local harness Draw mode uses canvas control without a browser requirement", () => {
  const instructions = getDeveloperInstructions("canvas", null, "private", "draw", true);
  assert.match(instructions, /control_canvas/);
  assert.doesNotMatch(instructions, /external-Chrome|enable internet|bypassing the sandbox|files elsewhere on the device are available/);
});

test("Codex agent activity follows the child rather than the collaboration call", () => {
  assert.deepEqual(codexSubagentUpdates({
    type: "collabAgentToolCall", tool: "spawnAgent", status: "completed",
    receiverThreadIds: ["child"], prompt: "Trace the rendering flow", agentsStates: {}
  }), [{ id: "child", status: "running", task: "Trace the rendering flow" }]);
  assert.deepEqual(codexSubagentUpdates({
    type: "collabAgentToolCall", tool: "wait", receiverThreadIds: ["child", "peer"],
    agentsStates: { child: { status: "completed", message: "Found it" }, peer: { status: "running" } }
  }), [{ id: "child", status: "completed", detail: "Found it" }, { id: "peer", status: "running" }]);
  assert.deepEqual(codexSubagentUpdates({
    type: "subAgentActivity", kind: "started", agentThreadId: "child",
    agentPath: "/root/research", model: "worker-model", reasoningEffort: "high"
  }), [{ id: "child", status: "running", label: "research", model: "worker-model", reasoningEffort: "high" }]);
  assert.deepEqual(codexSubagentUpdates({
    type: "subAgentActivity", kind: "interrupted", agentThreadId: "child", agentPath: "/root/research"
  }), [{ id: "child", status: "interrupted", label: "research" }]);
});
