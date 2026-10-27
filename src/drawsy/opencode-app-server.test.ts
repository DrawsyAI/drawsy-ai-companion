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
  OpenCodeAppServer
} from "./opencode-app-server.js";

test("OpenCode permissions keep generated output scoped to the session runtime", () => {
  const runtimePath = "/private/tmp/drawsy-opencode-test/session-a";
  const rules = createOpenCodePermissionRules("workspace", runtimePath);
  const directoryRules = rules.filter(
    (rule) => rule.permission === "external_directory"
  );

  assert.deepEqual(directoryRules, [
    { permission: "external_directory", pattern: "*", action: "deny" },
    {
      permission: "external_directory",
      pattern: `${path.join(runtimePath, "data/opencode/tool-output")}/*`,
      action: "allow"
    },
    {
      permission: "external_directory",
      pattern: `${path.join(runtimePath, "tmp/opencode")}/*`,
      action: "allow"
    }
  ]);
  assert.equal(
    directoryRules.some((rule) => rule.pattern === `${runtimePath}/*`),
    false
  );
  assert.deepEqual(
    createOpenCodePermissionRules("readOnly", runtimePath).find(
      (rule) => rule.permission === "edit"
    ),
    { permission: "edit", pattern: "*", action: "deny" }
  );
  assert.ok(
    rules.some(
      (rule) =>
        rule.permission === "skill" &&
        rule.pattern === "*" &&
        rule.action === "allow"
    )
  );
  for (const pattern of ["*browser*", "*chrome*", "*computer*"]) {
    assert.ok(
      rules.some(
        (rule) =>
          rule.permission === "skill" &&
          rule.pattern === pattern &&
          rule.action === "deny"
      )
    );
  }
  assert.ok(
    !createOpenCodePermissionRules("workspace", runtimePath, false).some(
      (rule) => rule.permission === "skill"
    )
  );
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

test("OpenCode discovers local skills by scope and excludes browser controls", async () => {
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
      ["diagram", "impeccable", "notes"]
    );
    assert.equal(
      skills.find(({ name }) => name === "impeccable")?.description,
      "Improve frontend UX, responsive behavior, and live browser iteration."
    );
    assert.ok(skills[0]);
    assert.equal(
      skills[0].path,
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
  const writeSkill = async (directory: string, name: string) => {
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} workflow\n---\nUse ${name}.`
    );
  };

  try {
    await mkdir(path.join(root, "repo", ".git"), { recursive: true });
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
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCode exposes bundled Drawsy skills without browser capabilities", async () => {
  const skills = await availableOpenCodeSkills(os.tmpdir());
  const names = skills.map((skill) => skill.name);

  assert.ok(names.includes("drawsy-teaching-diagrams"));
  assert.ok(names.includes("drawsy-fast-diagrams"));
  assert.ok(!names.includes("drawsy-browser-use"));
  assert.ok(!names.some((name) => /browser|chrome|computer/i.test(name)));
});

test("OpenCode MCP controls list connected safe servers and hide browser tools", () => {
  assert.deepEqual(
    openCodeMcpServerOptions({
      drawsy: { status: "connected", tools: { read_current_canvas: {} } },
      documents: {
        status: "connected",
        tools: { search: {}, read: {} }
      },
      browser: { status: "connected", tools: { search: {} } },
      other: { status: "connected", tools: { computer_control: {} } }
    }),
    [
      { name: "drawsy", toolCount: 1, authStatus: "connected" },
      { name: "documents", toolCount: 2, authStatus: "connected" }
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
    turnActive: true,
    turnFailure: null,
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
