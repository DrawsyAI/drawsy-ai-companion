import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  defaultConversationPreferences,
  LocalConversationStore
} from "./local-conversation-store.js";

test("Pi has an independent local preference and does not overwrite OpenCode session ids", async (t) => {
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "drawsy-pi-preferences-"));
  t.after(() => rm(stateDirectory, { recursive: true, force: true }));
  const store = new LocalConversationStore({ stateDirectory });
  const conversation = await store.upsert({
    id: "8d1d8dc2-2bc0-4e40-846c-e7cb197fb2e5",
    scope: "general",
    canvasId: null,
    canvasName: null,
    engine: "pi",
    title: "Pi conversation",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
    workspacePath: "/tmp/pi-project"
  });

  assert.equal(conversation.codexThreadId, null);
  assert.equal(conversation.openCodeSessionId, null);
  await store.setNativeSession(conversation.id, "pi", "pi-session-id");
  const storedConversation = await store.get(conversation.id);
  assert.equal(storedConversation?.openCodeSessionId, null);
  assert.equal(storedConversation?.updatedAt, conversation.updatedAt);

  const preferences = defaultConversationPreferences();
  preferences.engine = "pi";
  preferences.pi = {
    model: "claude-sonnet-4",
    modelProvider: "anthropic",
    effort: "high",
    accessMode: "readOnly",
    internetEnabled: false
  };
  await store.setPreferences(preferences);

  const restored = new LocalConversationStore({ stateDirectory });
  const savedPreferences = await restored.getPreferences();
  assert.equal(savedPreferences.engine, "pi");
  assert.deepEqual(savedPreferences.pi, preferences.pi);
  assert.deepEqual(savedPreferences.omp, preferences.omp);
  assert.deepEqual(savedPreferences.deepseek, preferences.deepseek);
  assert.equal(savedPreferences.codex.model, null);
  assert.equal(savedPreferences.opencode.model, null);
});

test("older local conversation files still load without Pi preferences", async (t) => {
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "drawsy-legacy-preferences-"));
  t.after(() => rm(stateDirectory, { recursive: true, force: true }));
  const legacyStatePath = path.join(stateDirectory, "ai-conversations.json");
  await writeFile(legacyStatePath, JSON.stringify({
    version: 1,
    preferences: {
      engine: "opencode",
      codex: { model: "gpt-5", modelProvider: "openai", effort: "high" },
      opencode: { model: "claude-sonnet", modelProvider: "anthropic", effort: "medium" },
      updatedAt: 123
    },
    conversations: [{
      id: "legacy-conversation",
      scope: "general",
      canvasId: null,
      canvasName: null,
      engine: "opencode",
      title: "Older chat",
      createdAt: 1,
      updatedAt: 2,
      messageCount: 1,
      workspacePath: "/tmp/older-project",
      codexThreadId: null,
      openCodeSessionId: "native-opencode-session"
    }],
    rememberedFolders: {}
  }));

  const store = new LocalConversationStore({ stateDirectory });
  const preferences = await store.getPreferences();
  const conversation = await store.get("legacy-conversation");
  assert.equal(preferences.engine, "opencode");
  assert.equal(preferences.opencode.model, "claude-sonnet");
  assert.equal(preferences.pi.model, null);
  assert.equal(conversation?.openCodeSessionId, "native-opencode-session");

  const persisted = JSON.parse(await readFile(legacyStatePath, "utf8")) as {
    preferences: { pi?: unknown };
  };
  assert.equal(persisted.preferences.pi, undefined);
});

test("OMP keeps its native session and model preference separate from Pi", async (t) => {
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "drawsy-omp-preferences-"));
  t.after(() => rm(stateDirectory, { recursive: true, force: true }));
  const store = new LocalConversationStore({ stateDirectory });
  const conversation = await store.upsert({
    id: "omp-conversation",
    scope: "general",
    canvasId: null,
    canvasName: null,
    engine: "omp",
    title: "OMP conversation",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
    workspacePath: "/tmp/omp-project"
  });
  await store.setNativeSession(conversation.id, "omp", "omp-session-id");
  assert.equal((await store.get(conversation.id))?.openCodeSessionId, null);

  const preferences = defaultConversationPreferences();
  preferences.engine = "omp";
  preferences.omp.model = "claude-sonnet-4";
  preferences.omp.modelProvider = "anthropic";
  await store.setPreferences(preferences);

  const restored = await new LocalConversationStore({ stateDirectory }).getPreferences();
  assert.equal(restored.engine, "omp");
  assert.equal(restored.omp.model, "claude-sonnet-4");
  assert.equal(restored.pi.model, null);
});
