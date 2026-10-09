import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenCodePermissionRules,
  openCodeTurnFailureFromEvent,
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
      pattern: `${runtimePath}/data/opencode/tool-output/*`,
      action: "allow"
    },
    {
      permission: "external_directory",
      pattern: `${runtimePath}/tmp/opencode/*`,
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
