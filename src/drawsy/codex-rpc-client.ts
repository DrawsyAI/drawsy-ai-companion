import { createInterface } from "node:readline";

import { resolveCodexBinary } from "./codex-binary.js";
import { executableEnvironment } from "./executable-resolver.js";
import { spawnNativeCli } from "./native-cli.js";
import { isRecord } from "./protocol.js";

export type CodexRpc = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export const withCodexAppServer = async <T>(run: (rpc: CodexRpc) => Promise<T>, timeoutMs = 15_000): Promise<T> => {
  const binary = resolveCodexBinary();
  if (!binary) throw new Error("Codex CLI is unavailable.");
  const env = executableEnvironment();
  delete env.PORT;
  const child = spawnNativeCli(binary, ["app-server", "--stdio"], {
    env, stdio: ["pipe", "pipe", "ignore"], windowsHide: true
  });
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  let nextId = 0;
  let requestQueue: Promise<unknown> = Promise.resolve();
  const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  child.on("error", () => lines.close());
  child.stdin.on("error", () => lines.close());

  const rpc: CodexRpc = (method, params) => {
    const request = async () => {
    const id = ++nextId;
    child.stdin.write(`${JSON.stringify({ id, method, ...(params ? { params } : {}) })}\n`);
    while (true) {
      const line = await iterator.next();
      if (line.done) throw new Error("Codex app-server closed before replying.");
      let message: unknown;
      try { message = JSON.parse(line.value); } catch { continue; }
      if (!isRecord(message) || message.id !== id) continue;
      if (isRecord(message.error)) {
        throw new Error(typeof message.error.message === "string" ? message.error.message : "Codex app-server request failed.");
      }
      return message.result;
    }
    };
    const pending = requestQueue.then(request, request);
    requestQueue = pending.then(() => undefined, () => undefined);
    return pending;
  };

  try {
    const initialized = await rpc("initialize", {
      clientInfo: { name: "drawsy-ai", title: "Drawsy AI", version: "0.1.0" },
      capabilities: { experimentalApi: true }
    });
    if (!initialized) throw new Error("Codex app-server initialization failed.");
    child.stdin.write('{"method":"initialized"}\n');
    return await run(rpc);
  } finally {
    clearTimeout(timeout);
    lines.close();
    child.stdin.end();
    child.kill("SIGKILL");
  }
};
