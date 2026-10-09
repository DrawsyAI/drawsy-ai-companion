import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

if (process.platform !== "win32") throw new Error("This smoke check runs only on Windows CI.");
if (!process.env.DRAWSY_CODEX_BIN) throw new Error("A CI-installed Codex binary is required.");

// Never read a developer's Codex authentication or configuration. This checks
// session startup and MCP connectivity, without sending a model turn.
const root = await mkdtemp(path.join(tmpdir(), "drawsy native codex test "));
process.env.CODEX_HOME = path.join(root, "codex-home");
process.env.DRAWSY_LOCAL_STATE_DIR = path.join(root, "companion-state");
await mkdir(process.env.CODEX_HOME, { recursive: true });
const { createDrawsyBridge } = await import("../dist/drawsy/bridge.js");
const bridge = createDrawsyBridge({ port: 0, allowedOrigins: ["https://drawsyai.com"] });
try {
  await bridge.listen();
  const response = await fetch(`${bridge.address}/v1/sessions`, {
    method: "POST",
    headers: { origin: "https://drawsyai.com", "content-type": "application/json" },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      engine: "codex",
      conversationId: randomUUID(),
      clientId: randomUUID(),
      canvasId: "windows-smoke-canvas",
      canvasName: "Windows smoke check",
      surfaceKind: "canvas",
      surfaceId: "windows-smoke-canvas",
      surfaceName: "Windows smoke check"
    })
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(typeof body.id, "string");
  assert.equal(typeof body.token, "string");
  console.log("Native Windows Codex: POST /v1/sessions succeeded with scoped permissions and Drawsy MCP ready. No model turn sent.");
} finally {
  await bridge.close();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
