import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  availableOpenCodeSkills,
  openCodeInlineSkillConfig,
  openCodeSkillDirectories,
  openCodeSkillSources,
  createOpenCodePermissionRules,
  discoverOpenCodeSkills,
  openCodeTurnFailureFromEvent,
  openCodeInternetControl,
  openCodeMcpServerOptions,
  runtimeEnvironment,
  OpenCodeAppServer
} from "./opencode-app-server.js";

test("OpenCode keeps permission decisions with its native profile", () => {
  assert.deepEqual(createOpenCodePermissionRules("workspace"), [
    { action: "*", resource: "*", effect: "allow" }
  ]);
  assert.deepEqual(createOpenCodePermissionRules("readOnly"), [
    { action: "*", resource: "*", effect: "allow" }
  ]);
});

test("OpenCode native question forms map answers through the session form API", async () => {
  const emitted: unknown[] = [];
  const requests: Array<{ path: string; init: RequestInit }> = [];
  const server = Object.assign(Object.create(OpenCodeAppServer.prototype), {
    openCodeSessionId: "session-1",
    pendingQuestions: new Map(),
    emit: (event: unknown) => emitted.push(event),
    request: async (requestPath: string, init: RequestInit = {}) => {
      requests.push({ path: requestPath, init });
      return undefined;
    }
  }) as {
    handleEvent(event: { type?: unknown; properties?: unknown }): void;
    answerQuestion(requestId: string, answers: Record<string, string[]>): Promise<boolean>;
    dismissQuestion(requestId: string): Promise<boolean>;
  };
  const form = (id: string) => ({
    id,
    sessionID: "session-1",
    title: "Questions",
    metadata: { kind: "question" },
    fields: [
      {
        key: "q0",
        type: "string",
        title: "Platform",
        description: "Which platform?",
        options: [{ value: "Web", label: "Web", description: "Browser" }],
        custom: true
      },
      {
        key: "q1",
        type: "multiselect",
        title: "Features",
        description: "Pick features",
        options: [
          { value: "Sharing", label: "Sharing" },
          { value: "Offline", label: "Offline" }
        ],
        custom: true
      }
    ]
  });

  server.handleEvent({ type: "form.created", properties: { form: { ...form("frm_question-1"), metadata: { kind: "mcp-elicitation" } } } });
  server.handleEvent({ type: "form.created", properties: { form: form("frm_question-1") } });
  assert.deepEqual(emitted[0], {
    type: "question.request",
    data: {
      turnId: "frm_question-1",
      requestId: "frm_question-1",
      questions: [
        {
          id: "frm_question-1:0",
          header: "Platform",
          question: "Which platform?",
          options: [{ label: "Web", description: "Browser" }],
          allowCustom: true
        },
        {
          id: "frm_question-1:1",
          header: "Features",
          question: "Pick features",
          options: [{ label: "Sharing" }, { label: "Offline" }],
          multiSelect: true,
          allowCustom: true
        }
      ]
    }
  });
  assert.equal(emitted.length, 1);
  assert.equal(await server.answerQuestion("frm_question-1", {
    "frm_question-1:0": ["Web"],
    "frm_question-1:1": ["Sharing", "Offline"]
  }), true);
  assert.equal(requests[0]?.path, "/api/session/session-1/form/frm_question-1/reply");
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), {
    answer: { q0: "Web", q1: ["Sharing", "Offline"] }
  });
  server.handleEvent({ type: "form.created", properties: { form: form("frm_question-2") } });
  assert.equal(await server.dismissQuestion("frm_question-2"), true);
  assert.equal(requests[1]?.path, "/api/session/session-1/form/frm_question-2");
  assert.equal(requests[1]?.init.method, "DELETE");
});

test("OpenCode reads API key provider fields from integration forms", async () => {
  const server = Object.assign(Object.create(OpenCodeAppServer.prototype), {
    apiKeyProviderIds: new Set<string>(),
    apiKeyConnections: new Map<string, Set<string>>(),
    providerNames: new Map<string, string>(),
    request: async (requestPath: string) => {
      assert.equal(requestPath, "/api/integration");
      return {
        data: [{
          id: "example-provider",
          name: "Example Provider",
          methods: [{
            type: "key",
            label: "API key",
            form: [
              {
                key: "apiKey",
                title: "API key",
                type: "string",
                placeholder: "Paste your API key"
              },
              {
                key: "region",
                title: "Region",
                type: "string",
                options: ["us-east", "eu-west"]
              }
            ]
          }],
          connections: [{ id: "credential-1", type: "credential" }]
        }]
      };
    }
  }) as {
    apiKeyProviders(): Promise<Array<{
      id: string;
      fields: Array<{
        key: string;
        label: string;
        type: string;
        placeholder?: string;
        options?: Array<{ label: string; value: string }>;
      }>;
    }>>;
  };

  assert.deepEqual(await server.apiKeyProviders(), [{
    id: "example-provider",
    name: "Example Provider",
    label: "API key",
    fields: [
      {
        key: "apiKey",
        label: "API key",
        type: "text",
        placeholder: "Paste your API key"
      },
      {
        key: "region",
        label: "Region",
        type: "select",
        options: [
          { label: "us-east", value: "us-east" },
          { label: "eu-west", value: "eu-west" }
        ]
      }
    ]
  }]);
});

test("local OpenCode inherits native credentials and config while adding session settings", () => {
  const names = [
    "HOME", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME",
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CODEX_HOME",
    "OPENCODE_CONFIG_CONTENT", "OPENCODE_PURE"
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    HOME: "/tmp/drawsy-native-home",
    XDG_DATA_HOME: "/tmp/drawsy-native-data",
    XDG_CONFIG_HOME: "/tmp/drawsy-native-config",
    XDG_CACHE_HOME: "/tmp/drawsy-native-cache",
    OPENAI_API_KEY: "test-native-openai-key",
    ANTHROPIC_API_KEY: "test-native-anthropic-key",
    CODEX_HOME: "/tmp/drawsy-native-codex-home",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: "native/model", skills: ["/native/skills"] })
  });
  delete process.env.OPENCODE_PURE;

  try {
    const environment = runtimeEnvironment(
      "/tmp/drawsy-opencode-session",
      4312,
      ["/drawsy/skills"],
      "session-password"
    );
    assert.equal(environment.HOME, "/tmp/drawsy-native-home");
    assert.equal(environment.XDG_DATA_HOME, "/tmp/drawsy-native-data");
    assert.equal(environment.XDG_CONFIG_HOME, "/tmp/drawsy-native-config");
    assert.equal(environment.XDG_CACHE_HOME, "/tmp/drawsy-native-cache");
    assert.equal(environment.OPENAI_API_KEY, "test-native-openai-key");
    assert.equal(environment.ANTHROPIC_API_KEY, "test-native-anthropic-key");
    assert.equal(environment.CODEX_HOME, "/tmp/drawsy-native-codex-home");
    assert.equal(environment.OPENCODE_SERVER_PASSWORD, "session-password");
    assert.equal(environment.PORT, "4312");
    assert.equal(environment.DRAWSY_PREVIEW_PORT, "4312");
    assert.equal(environment.OPENCODE_PURE, undefined);
    assert.deepEqual(JSON.parse(environment.OPENCODE_CONFIG_CONTENT || "{}"), {
      model: "native/model",
      skills: ["/native/skills", "/drawsy/skills"]
    });
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("local OpenCode discovers active OAuth models without API-key credentials", async () => {
  const server = Object.assign(Object.create(OpenCodeAppServer.prototype), {
    apiKeyProviderIds: new Set(),
    apiKeyConnections: new Map(),
    providerNames: new Map(),
    request: async (requestPath: string) => {
      if (requestPath === "/api/model") {
        return {
          data: [{
            id: "oauth-model",
            providerID: "anthropic",
            name: "OAuth model",
            status: "active",
            enabled: true,
            capabilities: { tools: true, input: ["text"] },
            cost: [1, 1],
            variants: []
          }]
        };
      }
      if (requestPath === "/api/provider") {
        return { data: [{ id: "anthropic", name: "Anthropic" }] };
      }
      if (requestPath === "/api/integration") {
        return { data: [{ id: "anthropic", methods: [{ type: "oauth" }], connections: [] }] };
      }
      if (requestPath === "/api/model/default") {
        return { data: { providerID: "anthropic", id: "oauth-model" } };
      }
      throw new Error(`Unexpected OpenCode request: ${requestPath}`);
    }
  }) as {
    availableModels(): Promise<Array<{
      providerId: string;
      modelId: string;
      isDefault: boolean;
      isFree: boolean;
    }>>;
  };

  const models = await server.availableModels();
  assert.deepEqual(models.map(({ providerId, modelId, isDefault, isFree }) => ({
    providerId, modelId, isDefault, isFree
  })), [{
    providerId: "anthropic",
    modelId: "oauth-model",
    isDefault: true,
    isFree: false
  }]);
});

test("OpenCode only offers Internet blocking where the sandbox can enforce it", () => {
  assert.deepEqual(
    openCodeInternetControl({ platform: "linux", isolateProcessGroup: true }),
    {
      canDisable: false,
      reason:
        "Internet cannot be safely disabled in this OpenCode session on Linux."
    }
  );
  assert.deepEqual(
    openCodeInternetControl({ platform: "linux", isolateProcessGroup: false }),
    {
      canDisable: false,
      reason:
        "Internet cannot be safely disabled in this OpenCode session on Linux."
    }
  );
  assert.deepEqual(
    openCodeInternetControl({ platform: "darwin", isolateProcessGroup: true }),
    { canDisable: true }
  );
});

test("OpenCode discovers native skills by scope without filtering tool guidance", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "drawsy-browser-opencode-skills-")
  );
  const projectSkills = path.join(root, "project", ".opencode", "skills");
  const userSkills = path.join(root, "user", ".agents", "skills");
  const writeSkill = async (
    directory: string,
    name: string,
    description: string
  ) => {
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\nUse this skill.`
    );
  };

  try {
    await writeSkill(
      path.join(projectSkills, "diagram"),
      "diagram",
      "Project diagrams"
    );
    await writeSkill(
      path.join(userSkills, "diagram"),
      "diagram",
      "User diagrams"
    );
    await writeSkill(path.join(userSkills, "notes"), "notes", "Write notes");
    await writeSkill(
      path.join(userSkills, "impeccable"),
      "impeccable",
      "Improve frontend UX, responsive behavior, and live browser iteration."
    );
    await writeSkill(
      path.join(userSkills, "browser-helper"),
      "browser-helper",
      "Browser helper"
    );
    await writeSkill(
      path.join(userSkills, "browser-reference"),
      "browser-reference",
      "Help with Browser setup"
    );

    const skills = await discoverOpenCodeSkills([projectSkills, userSkills]);

    assert.deepEqual(
      skills
        .map(({ name }) => name)
        .sort((left, right) => left.localeCompare(right)),
      ["browser-helper", "browser-reference", "diagram", "impeccable", "notes"]
    );
    assert.equal(
      skills.find(({ name }) => name === "impeccable")?.description,
      "Improve frontend UX, responsive behavior, and live browser iteration."
    );
    const projectSkill = skills.find(({ name }) => name === "diagram");
    assert.ok(projectSkill);
    assert.equal(
      projectSkill.path,
      await realpath(path.join(projectSkills, "diagram", "SKILL.md"))
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCode exposes global Codex and OpenCode skills to its native skill loader", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "drawsy-opencode-global-skills-")
  );
  const home = path.join(root, "home");
  const workspace = path.join(root, "repo", "app");
  const previousCodexHome = process.env.CODEX_HOME;
  const writeSkill = async (directory: string, name: string) => {
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} workflow\n---\nUse ${name}.`
    );
  };

  try {
    await mkdir(path.join(root, "repo", ".git"), { recursive: true });
    process.env.CODEX_HOME = path.join(home, ".codex");
    await writeSkill(
      path.join(home, ".codex", "skills", "frontend-design"),
      "frontend-design"
    );
    await writeSkill(
      path.join(home, ".codex", "skills", ".system", "visualize"),
      "visualize"
    );
    await writeSkill(
      path.join(home, ".codex", "plugins", "cache", "test-registry", "test-plugin", "1.0.0", "skills", "documents"),
      "documents"
    );
    await writeSkill(
      path.join(home, ".config", "opencode", "skills", "opencode-global"),
      "opencode-global"
    );
    await writeSkill(
      path.join(root, "repo", ".agents", "skills", "project-skill"),
      "project-skill"
    );

    const directories = await openCodeSkillDirectories(workspace, home);
    const available = await discoverOpenCodeSkills([...directories].reverse());
    const names = new Set(available.map((skill) => skill.name));
    assert.ok(names.has("frontend-design"));
    assert.ok(names.has("visualize"));
    assert.ok(names.has("documents"));
    assert.ok(names.has("opencode-global"));
    assert.ok(names.has("project-skill"));

    const discoveredSources = openCodeSkillSources(
      directories,
      workspace,
      "linux"
    );
    const globalSource = discoveredSources.find(({ hostPath }) =>
      hostPath.includes(path.join(".codex", "skills"))
    );
    const projectSource = discoveredSources.find(({ hostPath }) =>
      hostPath.includes(path.join(".agents", "skills"))
    );
    assert.ok(projectSource);
    assert.equal(projectSource.sessionPath, projectSource.hostPath);

    const linuxSources = openCodeSkillSources(
      ["/home/test-user/.codex/skills", projectSource.hostPath],
      workspace,
      "linux"
    );
    const mappedGlobalSource = linuxSources.find(({ hostPath }) => {
      const segments = hostPath.split(/[\\/]/);
      const codexIndex = segments.indexOf(".codex");
      return codexIndex >= 0 && segments[codexIndex + 1] === "skills";
    });
    assert.ok(mappedGlobalSource);
    assert.notEqual(mappedGlobalSource.sessionPath, mappedGlobalSource.hostPath);

    const inlineConfig = JSON.parse(
      openCodeInlineSkillConfig(linuxSources.map((source) => source.sessionPath))
    ) as { skills: string[] };
    assert.deepEqual(
      inlineConfig.skills,
      linuxSources.map((source) => source.sessionPath)
    );
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCode exposes the complete bundled Drawsy skill set", async () => {
  const skills = await availableOpenCodeSkills(os.tmpdir());
  const names = skills.map((skill) => skill.name);

  assert.ok(names.includes("drawsy-teaching-diagrams"));
  assert.ok(names.includes("drawsy-fast-diagrams"));
  assert.ok(names.includes("drawsy-browser-use"));
});

test("OpenCode MCP controls list the native profile's complete server set", () => {
  assert.deepEqual(
    openCodeMcpServerOptions({
      drawsy: { status: "connected", tools: { read_current_canvas: {}, browser_control: {} } },
      documents: {
        status: "connected",
        tools: { search: {}, read: {} }
      },
      browser: { status: "connected", tools: { search: {} } },
      other: { status: "connected", tools: { computer_control: {} } }
    }),
    [
      { name: "drawsy", toolCount: 2, authStatus: "connected" },
      { name: "browser", toolCount: 1, authStatus: "connected" },
      { name: "documents", toolCount: 2, authStatus: "connected" },
      { name: "other", toolCount: 1, authStatus: "connected" }
    ]
  );
});

test("OpenCode provider failures classify 401, 403, and 500 without exposing details", () => {
  for (const statusCode of [401, 403]) {
    assert.deepEqual(
      openCodeTurnFailureFromEvent({
        type: "message.updated",
        properties: {
          info: {
            error: {
              name: "APIError",
              data: {
                message: "private provider detail",
                statusCode
              }
            }
          }
        }
      }),
      {
        code: "opencode_provider_access_denied",
        message: "The AI provider refused this request."
      }
    );
  }

  assert.deepEqual(
    openCodeTurnFailureFromEvent({
      type: "session.error",
      properties: {
        error: {
          data: { message: "private provider detail", statusCode: 500 }
        }
      }
    }),
    {
      code: "opencode_provider_error",
      message: "OpenCode could not complete this request."
    }
  );
  assert.equal(
    openCodeTurnFailureFromEvent({
      type: "message.updated",
      properties: { info: { error: null } }
    }),
    null
  );
});

test("OpenCode errors remain failed through idle and reset when the next turn begins", () => {
  type TestableServer = {
    beginTurn(): void;
    handleEvent(event: { type?: unknown; properties?: unknown }): void;
    openCodeSessionId: string | null;
    turnActive: boolean;
    turnFailure: unknown;
    emit: (event: unknown) => void;
  };
  const emitted: unknown[] = [];
  const server = Object.assign(Object.create(OpenCodeAppServer.prototype), {
    openCodeSessionId: "session-1",
    subagentSessions: new Map(),
    turnActive: true,
    turnFailure: null,
    knownAssistantMessageIds: new Set<string>(),
    activeAssistantMessageId: null,
    emit: (event: unknown) => emitted.push(event)
  }) as TestableServer;
  const providerError = {
    data: { message: "private provider detail", statusCode: 403 }
  };

  server.handleEvent({
    type: "message.updated",
    properties: {
      info: {
        sessionID: "another-session",
        error: providerError
      }
    }
  });
  server.handleEvent({
    type: "message.updated",
    properties: {
      info: { sessionID: "session-1", error: providerError }
    }
  });
  server.handleEvent({
    type: "session.error",
    properties: { sessionID: "session-1", error: providerError }
  });
  server.handleEvent({
    type: "session.idle",
    properties: { sessionID: "session-1" }
  });
  server.handleEvent({
    type: "session.status",
    properties: {
      sessionID: "session-1",
      status: { type: "idle" }
    }
  });

  assert.deepEqual(
    emitted.map((event) => (event as { type: string }).type),
    ["error", "turn.status"]
  );
  assert.deepEqual(emitted[1], {
    type: "turn.status",
    data: { status: "failed" }
  });
  assert.doesNotMatch(JSON.stringify(emitted), /private provider detail/);

  server.beginTurn();
  server.handleEvent({
    type: "message.updated",
    properties: {
      info: { sessionID: "session-1", id: "assistant-2", role: "assistant" }
    }
  });
  server.handleEvent({
    type: "session.idle",
    properties: { sessionID: "session-1" }
  });
  assert.deepEqual(
    emitted.slice(2).map(
      (event) => (event as { data: { status?: string } }).data?.status
    ),
    ["inProgress", "completed"]
  );
});

test("OpenCode v2 envelopes stream text and complete a native turn", () => {
  const emitted: unknown[] = [];
  const server = Object.assign(Object.create(OpenCodeAppServer.prototype), {
    openCodeSessionId: "session-1",
    turnActive: true,
    turnFailure: null,
    activeAssistantMessageId: null,
    emit: (event: unknown) => emitted.push(event)
  }) as {
    handleEvent(event: { type?: unknown; data?: unknown }): void;
    turnActive: boolean;
  };

  server.handleEvent({
    type: "session.execution.started",
    data: { sessionID: "session-1", assistantMessageID: "assistant-1" }
  });
  server.handleEvent({
    type: "session.step.started",
    data: {
      sessionID: "session-1",
      assistantMessageID: "assistant-1",
      model: { id: "native-model", providerID: "native-provider" }
    }
  });
  server.handleEvent({
    type: "session.text.delta",
    data: {
      sessionID: "session-1",
      assistantMessageID: "assistant-1",
      delta: "Hello from OpenCode v2"
    }
  });
  server.handleEvent({
    type: "session.step.ended",
    data: {
      sessionID: "session-1",
      assistantMessageID: "assistant-1",
      tokens: { input: 12, output: 4, reasoning: 2, cache: { read: 3, write: 1 } },
      cost: 0.002
    }
  });
  server.handleEvent({
    type: "session.execution.succeeded",
    data: { sessionID: "session-1", assistantMessageID: "assistant-1" }
  });

  assert.deepEqual(emitted, [
    { type: "turn.status", data: { status: "inProgress" } },
    {
      type: "assistant.delta",
      data: { itemId: "assistant-1", delta: "Hello from OpenCode v2" }
    },
    {
      type: "usage.recorded",
      data: {
        usageId: "assistant-1",
        model: "native-model",
        modelProvider: "native-provider",
        usage: {
          inputTokens: 16,
          outputTokens: 6,
          totalTokens: 22,
          cachedInputTokens: 3,
          reasoningTokens: 2,
          cacheWriteTokens: 1,
          costUsd: 0.002
        }
      }
    },
    { type: "turn.status", data: { status: "completed" } }
  ]);
  assert.equal(server.turnActive, false);
});

test("OpenCode v2 failure envelopes end a turn once", () => {
  const emitted: unknown[] = [];
  const server = Object.assign(Object.create(OpenCodeAppServer.prototype), {
    openCodeSessionId: "session-1",
    turnActive: true,
    turnFailure: null,
    activeAssistantMessageId: null,
    emit: (event: unknown) => emitted.push(event)
  }) as {
    handleEvent(event: { type?: unknown; data?: unknown }): void;
    turnActive: boolean;
  };
  const failure = {
    sessionID: "session-1",
    assistantMessageID: "assistant-1",
    error: { data: { statusCode: 401, message: "private provider detail" } }
  };

  server.handleEvent({ type: "session.execution.started", data: { sessionID: "session-1" } });
  server.handleEvent({ type: "session.execution.failed", data: failure });
  server.handleEvent({ type: "session.execution.failed", data: failure });
  server.handleEvent({ type: "session.execution.succeeded", data: { sessionID: "session-1" } });

  assert.deepEqual(
    emitted.map((event) => (event as { type: string }).type),
    ["turn.status", "error", "turn.status"]
  );
  assert.deepEqual(emitted[1], {
    type: "error",
    data: {
      code: "opencode_provider_access_denied",
      message: "The AI provider refused this request."
    }
  });
  assert.deepEqual(emitted[2], { type: "turn.status", data: { status: "failed" } });
  assert.equal(server.turnActive, false);
  assert.doesNotMatch(JSON.stringify(emitted), /private provider detail/);
});

test("OpenCode v2 task tool events report scoped native subagent lifecycle", () => {
  const emitted: unknown[] = [];
  const server = Object.assign(Object.create(OpenCodeAppServer.prototype), {
    session: { runtimeProfile: "local" },
    openCodeSessionId: "session-parent",
    turnActive: true,
    turnFailure: null,
    activeAssistantMessageId: null,
    activeSubagents: new Map(),
    backgroundSubagentCalls: new Set(),
    nativeToolNames: new Map(),
    nativeToolInputs: new Map(),
    subagentSessions: new Map(),
    subagentChildTerminalStatuses: new Map(),
    emit: (event: unknown) => emitted.push(event)
  }) as {
    handleEvent(event: { type?: unknown; data?: unknown }): void;
  };

  server.handleEvent({
    type: "session.tool.input.started",
    data: { sessionID: "session-parent", assistantMessageID: "assistant-1", id: "task-call-1", name: "subagent" }
  });
  server.handleEvent({
    type: "session.tool.called",
    data: {
      sessionID: "session-parent",
      assistantMessageID: "assistant-1",
      id: "task-call-1",
      input: { agent: "explore", description: "Trace the auth flow", prompt: "private prompt" },
      executed: false
    }
  });
  server.handleEvent({
    type: "session.tool.progress",
    data: {
      sessionID: "session-parent",
      assistantMessageID: "assistant-1",
      id: "task-call-1",
      metadata: { sessionID: "child-session", status: "running" }
    }
  });
  server.handleEvent({
    type: "session.tool.input.started",
    data: { sessionID: "session-parent", assistantMessageID: "assistant-1", id: "task-call-background", name: "subagent" }
  });
  server.handleEvent({
    type: "session.tool.called",
    data: {
      sessionID: "session-parent",
      assistantMessageID: "assistant-1",
      id: "task-call-background",
      input: { agent: "explore", description: "Background research", background: true },
      executed: false
    }
  });
  server.handleEvent({
    type: "session.tool.progress",
    data: {
      sessionID: "session-parent",
      assistantMessageID: "assistant-1",
      id: "task-call-background",
      metadata: { sessionID: "child-background", status: "running" }
    }
  });
  server.handleEvent({
    type: "session.tool.success",
    data: {
      sessionID: "session-parent",
      assistantMessageID: "assistant-1",
      id: "task-call-background",
      metadata: { sessionID: "child-background", status: "running", truncated: false }
    }
  });
  server.handleEvent({
    type: "session.execution.succeeded",
    data: { sessionID: "child-session" }
  });
  server.handleEvent({
    type: "session.execution.succeeded",
    data: { sessionID: "child-background" }
  });
  server.handleEvent({
    type: "session.tool.success",
    data: {
      sessionID: "session-parent",
      assistantMessageID: "assistant-1",
      id: "task-call-1",
      metadata: { sessionID: "child-session", status: "running", truncated: false }
    }
  });
  server.handleEvent({
    type: "session.tool.input.started",
    data: { sessionID: "another-parent", id: "task-call-2", name: "subagent" }
  });
  server.handleEvent({
    type: "session.tool.called",
    data: {
      sessionID: "another-parent",
      id: "task-call-2",
      input: { agent: "explore", description: "Must be ignored" }
    }
  });

  assert.deepEqual(
    emitted.filter((event) => (event as { type: string }).type === "subagent.updated"),
    [
      {
        type: "subagent.updated",
        data: {
          id: "task-call-1",
          label: "explore",
          task: "Trace the auth flow",
          status: "running"
        }
      },
      {
        type: "subagent.updated",
        data: {
          id: "task-call-background",
          label: "explore",
          task: "Background research",
          status: "running"
        }
      },
      {
        type: "subagent.updated",
        data: {
          id: "task-call-1",
          label: "explore",
          task: "Trace the auth flow",
          status: "completed"
        }
      },
      {
        type: "subagent.updated",
        data: {
          id: "task-call-background",
          label: "explore",
          task: "Background research",
          status: "completed"
        }
      },
    ]
  );
  assert.equal(JSON.stringify(emitted).includes("private prompt"), false);
});

test("OpenCode v1 task tool part updates map native terminal states", () => {
  const emitted: unknown[] = [];
  const server = Object.assign(Object.create(OpenCodeAppServer.prototype), {
    session: { runtimeProfile: "local" },
    activeSubagents: new Map(),
    backgroundSubagentCalls: new Set(),
    nativeToolNames: new Map(),
    nativeToolInputs: new Map(),
    subagentSessions: new Map(),
    subagentChildTerminalStatuses: new Map(),
    partKinds: new Map(),
    emit: (event: unknown) => emitted.push(event)
  }) as {
    handlePart(part: Record<string, unknown>): void;
  };

  server.handlePart({
    id: "task-call-v1",
    type: "tool",
    name: "task",
    state: {
      status: "running",
      input: { agent: "reviewer", description: "Review the change" },
      metadata: { sessionId: "child-session" }
    }
  });
  server.handlePart({
    id: "task-call-v1",
    type: "tool",
    name: "task",
    state: {
      status: "error",
      input: { agent: "reviewer", description: "Review the change" },
      metadata: { sessionId: "child-session", interrupted: true }
    }
  });

  assert.deepEqual(
    emitted.filter((event) => (event as { type: string }).type === "subagent.updated"),
    [
      {
        type: "subagent.updated",
        data: {
          id: "task-call-v1",
          label: "reviewer",
          task: "Review the change",
          status: "running"
        }
      },
      {
        type: "subagent.updated",
        data: {
          id: "task-call-v1",
          label: "reviewer",
          task: "Review the change",
          status: "interrupted"
        }
      }
    ]
  );
});
