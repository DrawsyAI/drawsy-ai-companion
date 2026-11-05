import assert from "node:assert/strict";
import test from "node:test";
import { CodexAppServer, getDeveloperInstructions } from "./codex-app-server.js";

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
