import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { LocalConversationStore } from "./local-conversation-store.js";
import { listHarnessActivity, recordHarnessUsage } from "./harness-activity.js";

test("harness history survives reload and separates legacy chats, models, and reported usage", async (t) => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "drawsy-harness-activity-"));
  t.after(() => rm(stateDirectory, { recursive: true, force: true }));
  const store = new LocalConversationStore({ stateDirectory });
  for (let index = 0; index < 11; index++) {
    await store.upsert({
      id: String(index), scope: "general", canvasId: null, canvasName: null,
      engine: "codex", title: "Legacy chat", createdAt: index, updatedAt: index,
      messageCount: 1, workspacePath: null
    });
  }
  await store.recordUserMessage("0", "follow-up", { model: "model-a", modelProvider: "one" });
  await store.recordUserMessage("0", "another model", { model: "model-b", modelProvider: "two" });
  const usage = {
    usageId: "turn-a", model: "model-a", modelProvider: "one",
    usage: { inputTokens: 50, outputTokens: 0, cachedInputTokens: 12 }
  };
  await store.recordUsage("0", usage);
  await store.recordUsage("0", usage);
  await store.recordUsage("0", {
    usageId: "turn-b", model: "model-b", modelProvider: "two",
    usage: { outputTokens: 30, costUsd: 0.01 }
  });
  const restored = new LocalConversationStore({ stateDirectory });
  const all = await restored.getHarnessActivity("codex", 1, null);
  assert.equal(all.total, 11);
  assert.equal(all.chats.length, 10);
  assert.equal(all.chats[0]?.messageCount, 3);
  assert.equal((await restored.getHarnessActivity("codex", 2, null)).chats.length, 1);

  const model = all.models.find(({ model }) => model === "model-a")!;
  const filtered = await restored.getHarnessActivity("codex", 1, model.key);
  assert.equal(filtered.total, 1);
  assert.equal(filtered.chats[0]?.messageCount, 1);
  assert.deepEqual(filtered.usage, {
    samples: 1, inputTokens: 50, outputTokens: 0, cachedInputTokens: 12
  });
  assert.equal(filtered.daily.reduce((sum, day) => sum + day.prompts, 0), 1);
  assert.equal(filtered.daily.reduce((sum, day) => sum + day.usage.samples, 0), 1);
  assert.equal(filtered.daily.find((day) => day.usage.samples)?.usage.outputTokens, 0);
  const unknown = all.models.find(({ model }) => model === null)!;
  const legacy = await restored.getHarnessActivity("codex", 1, unknown.key);
  assert.equal(legacy.total, 11);
  assert.deepEqual(legacy.daily, []);
  assert.equal((await restored.getHarnessActivity("opencode", 1, null)).total, 0);
  assert.equal("activity" in (await restored.get("0"))!, false);
});

test("recent activity uses the event's UTC day and leaves older usage in lifetime totals", () => {
  const chat = { id: "one", title: "Chat", canvasName: null, updatedAt: 0, messageCount: 1 };
  for (const [day, totalTokens] of [["2026-10-02", 20], ["2026-10-03", 10], ["2026-11-01", 5]] as const) {
    recordHarnessUsage(chat, { usageId: day, usage: { totalTokens } }, Date.parse(day));
  }
  const activity = listHarnessActivity([chat], 1, null, Date.parse("2026-11-01T15:00:00Z"));
  assert.equal(activity.usage.totalTokens, 35);
  assert.deepEqual(activity.daily.map(({ day, usage }) => [day, usage.totalTokens]), [
    ["2026-10-03", 10], ["2026-11-01", 5]
  ]);
});
