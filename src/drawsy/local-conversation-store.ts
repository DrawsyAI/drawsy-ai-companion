import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { AgentAccessMode, AgentEngine } from "./protocol.js";

export type LocalConversationScope = "canvas" | "general";

export type LocalAgentPreference = {
  model: string | null;
  modelProvider: string | null;
  effort: string | null;
  accessMode: AgentAccessMode | null;
  internetEnabled: boolean | null;
};

export type LocalConversationPreferences = {
  engine: AgentEngine;
  codex: LocalAgentPreference;
  opencode: LocalAgentPreference;
  updatedAt: number;
};

export type LocalConversation = {
  id: string;
  scope: LocalConversationScope;
  canvasId: string | null;
  canvasName: string | null;
  engine: AgentEngine;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  codexThreadId: string | null;
  openCodeSessionId: string | null;
};

type StoreData = {
  version: 1;
  preferences: LocalConversationPreferences;
  conversations: LocalConversation[];
};

const emptyPreference = (): LocalAgentPreference => ({
  model: null,
  modelProvider: null,
  effort: null,
  accessMode: null,
  internetEnabled: null
});

export const defaultConversationPreferences = (): LocalConversationPreferences => ({
  engine: "codex",
  codex: emptyPreference(),
  opencode: emptyPreference(),
  updatedAt: 0
});

const initialStore = (): StoreData => ({
  version: 1,
  preferences: defaultConversationPreferences(),
  conversations: []
});

const localStateDirectory = () => {
  if (process.env.DRAWSY_LOCAL_STATE_DIR) {
    return path.resolve(process.env.DRAWSY_LOCAL_STATE_DIR);
  }
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "Drawsy AI");
  }
  return path.join(process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state"), "drawsy-ai");
};

const isAgentEngine = (value: unknown): value is AgentEngine =>
  value === "codex" || value === "opencode";

const isAccessMode = (value: unknown): value is AgentAccessMode =>
  value === "workspace" || value === "readOnly";

const readPreference = (value: unknown): LocalAgentPreference => {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    model: typeof record.model === "string" ? record.model : null,
    modelProvider: typeof record.modelProvider === "string" ? record.modelProvider : null,
    effort: typeof record.effort === "string" ? record.effort : null,
    accessMode: isAccessMode(record.accessMode) ? record.accessMode : null,
    internetEnabled: typeof record.internetEnabled === "boolean" ? record.internetEnabled : null
  };
};

const readConversation = (value: unknown): LocalConversation | null => {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (
    !record ||
    typeof record.id !== "string" ||
    (record.scope !== "canvas" && record.scope !== "general") ||
    !isAgentEngine(record.engine) ||
    typeof record.title !== "string" ||
    typeof record.createdAt !== "number" ||
    typeof record.updatedAt !== "number" ||
    typeof record.messageCount !== "number"
  ) {
    return null;
  }
  return {
    id: record.id,
    scope: record.scope,
    canvasId: typeof record.canvasId === "string" ? record.canvasId : null,
    canvasName: typeof record.canvasName === "string" ? record.canvasName : null,
    engine: record.engine,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messageCount: Math.max(0, Math.floor(record.messageCount)),
    codexThreadId: typeof record.codexThreadId === "string" ? record.codexThreadId : null,
    openCodeSessionId: typeof record.openCodeSessionId === "string" ? record.openCodeSessionId : null
  };
};

export class LocalConversationStore {
  readonly stateDirectory = localStateDirectory();
  readonly statePath = path.join(this.stateDirectory, "ai-conversations.json");
  private data: StoreData = initialStore();
  private readonly loaded: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.loaded = this.load();
  }

  private async load() {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, "utf8")) as unknown;
      const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
      if (!record || record.version !== 1) return;
      const preferencesRecord = record.preferences && typeof record.preferences === "object"
        ? record.preferences as Record<string, unknown>
        : {};
      const preferences = {
        engine: isAgentEngine(preferencesRecord.engine) ? preferencesRecord.engine : "codex",
        codex: readPreference(preferencesRecord.codex),
        opencode: readPreference(preferencesRecord.opencode),
        updatedAt: typeof preferencesRecord.updatedAt === "number" ? preferencesRecord.updatedAt : 0
      } satisfies LocalConversationPreferences;
      const conversations = Array.isArray(record.conversations)
        ? record.conversations.map(readConversation).filter((item): item is LocalConversation => !!item)
        : [];
      this.data = { version: 1, preferences, conversations };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        const backupPath = `${this.statePath}.corrupt-${Date.now()}`;
        const preserved = await rename(this.statePath, backupPath)
          .then(() => backupPath)
          .catch(() => null);
        console.warn(
          preserved
            ? `Drawsy local AI history was unreadable and was preserved at ${preserved}.`
            : "Drawsy local AI history could not be read; starting empty.",
          error
        );
      }
    }
  }

  private async persist() {
    await mkdir(this.stateDirectory, { recursive: true });
    const temporaryPath = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, this.statePath);
  }

  private async mutate<T>(change: () => T | Promise<T>) {
    await this.loaded;
    let value!: T;
    const write = this.writeQueue.then(async () => {
      value = await change();
      await this.persist();
    });
    this.writeQueue = write.catch(() => undefined);
    await write;
    return value;
  }

  async list(scope: LocalConversationScope, canvasId: string | null) {
    await this.loaded;
    return this.data.conversations
      .filter((conversation) =>
        conversation.scope === scope &&
        (scope === "general" || conversation.canvasId === canvasId)
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((conversation) => ({ ...conversation }));
  }

  async get(id: string) {
    await this.loaded;
    const conversation = this.data.conversations.find((item) => item.id === id);
    return conversation ? { ...conversation } : null;
  }

  async upsert(input: Omit<LocalConversation, "codexThreadId" | "openCodeSessionId">) {
    return this.mutate(() => {
      const existing = this.data.conversations.find((item) => item.id === input.id);
      const conversation: LocalConversation = existing
        ? {
            ...existing,
            ...input,
            createdAt: existing.createdAt,
            title: existing.title === "New conversation" ? input.title : existing.title,
            messageCount: Math.max(existing.messageCount, input.messageCount),
            updatedAt: Math.max(existing.updatedAt, input.updatedAt)
          }
        : { ...input, codexThreadId: null, openCodeSessionId: null };
      const index = this.data.conversations.findIndex((item) => item.id === input.id);
      if (index >= 0) this.data.conversations[index] = conversation;
      else this.data.conversations.push(conversation);
      return { ...conversation };
    });
  }

  async recordUserMessage(id: string, message: string) {
    return this.mutate(() => {
      const conversation = this.data.conversations.find((item) => item.id === id);
      if (!conversation) throw new Error("Conversation does not exist locally.");
      const trimmed = message.replace(/\s+/g, " ").trim();
      conversation.updatedAt = Date.now();
      if (conversation.messageCount === 0 && trimmed) {
        conversation.title = trimmed.slice(0, 96);
      }
      conversation.messageCount += 1;
      return { ...conversation };
    });
  }

  async setNativeSession(
    id: string,
    engine: AgentEngine,
    nativeSessionId: string | null
  ) {
    return this.mutate(() => {
      const conversation = this.data.conversations.find((item) => item.id === id);
      if (!conversation) throw new Error("Conversation does not exist locally.");
      if (engine === "codex") conversation.codexThreadId = nativeSessionId;
      else conversation.openCodeSessionId = nativeSessionId;
      conversation.updatedAt = Date.now();
      return { ...conversation };
    });
  }

  async getPreferences() {
    await this.loaded;
    return structuredClone(this.data.preferences);
  }

  async setPreferences(input: Omit<LocalConversationPreferences, "updatedAt">) {
    return this.mutate(() => {
      this.data.preferences = {
        engine: input.engine,
        codex: readPreference(input.codex),
        opencode: readPreference(input.opencode),
        updatedAt: Date.now()
      };
      return structuredClone(this.data.preferences);
    });
  }
}
