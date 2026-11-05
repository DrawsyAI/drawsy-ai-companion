import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { forceStopNativeCli, spawnNativeCli } from "./native-cli.js";
import { resolveDeepSeekBinary } from "./deepseek-binary.js";
import { executableEnvironment } from "./executable-resolver.js";

export type DeepSeekModelCatalog = {
  default: { provider: string; model: string; reasoningEffort?: string | null };
  routableProviders: string[];
  groups: Array<{
    id: string;
    name: string;
    models: Array<{ id: string; name: string; description?: string; reasoning?: unknown }>;
  }>;
  failures: Array<{ id: string; name: string; message: string }>;
};

export type DeepSeekModelCatalogRuntime = {
  spawn: typeof spawnNativeCli;
  fetch: typeof fetch;
};

const runtime: DeepSeekModelCatalogRuntime = { spawn: spawnNativeCli, fetch };
const STARTUP_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 1_500;

/** Read the native Web Host's model catalogue through its authenticated owner RPC. */
export async function getDeepSeekModelCatalog(
  binary = resolveDeepSeekBinary(),
  io: DeepSeekModelCatalogRuntime = runtime,
): Promise<DeepSeekModelCatalog> {
  const child = io.spawn(binary, ["web", "--host", "127.0.0.1", "--port", "0", "--no-open"], {
    cwd: process.cwd(), env: executableEnvironment(), stdio: "pipe", windowsHide: true,
  });
  // The Web process may log diagnostics here; drain without forwarding them because startup URLs contain credentials.
  child.stderr.resume();
  try {
    const baseUrl = await readStartupUrl(child);
    const token = new URL(baseUrl).searchParams.get("token");
    if (!token) throw new Error("DeepSeek Harness Web startup did not provide an authentication token.");
    const cookie = await exchangeToken(io.fetch, baseUrl, token);
    return await readCatalog(io.fetch, baseUrl, cookie);
  } finally {
    await stopChild(child);
  }
}

function readStartupUrl(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    const timeout = setTimeout(() => finish(new Error("DeepSeek Harness Web startup timed out.")), STARTUP_TIMEOUT_MS);
    const finish = (error?: Error, url?: string) => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("error", onError);
      child.off("close", onClose);
      if (error) reject(error);
      else resolve(url!);
    };
    const onData = (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      const match = /(?:^|\n)dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/u.exec(buffer);
      if (!match) {
        if (buffer.length > 8_192) buffer = buffer.slice(-4_096);
        return;
      }
      const url = new URL(match[1]!);
      if (!url.searchParams.get("token")) return;
      finish(undefined, url.origin + url.pathname + url.search);
    };
    const onError = () => finish(new Error("Could not start DeepSeek Harness Web."));
    const onClose = () => finish(new Error("DeepSeek Harness Web exited before becoming ready."));
    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

async function exchangeToken(doFetch: typeof fetch, baseUrl: string, token: string): Promise<string> {
  const url = new URL("/connect", baseUrl);
  url.searchParams.set("token", token);
  url.searchParams.set("interactions", "none");
  const response = await doFetch(url, { redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const setCookies = response.headers.getSetCookie();
  const cookie = setCookies.map((value) => value.split(";", 1)[0]).find(Boolean);
  if (response.status !== 302 || !cookie) {
    throw new Error("DeepSeek Harness Web authentication failed.");
  }
  return cookie;
}

async function readCatalog(doFetch: typeof fetch, baseUrl: string, cookie: string): Promise<DeepSeekModelCatalog> {
  const rpcId = randomUUID();
  const response = await doFetch(new URL("/api/session/modelCatalog", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ type: "client-request", rpcId, method: "session/modelCatalog", payload: { args: {} } }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("DeepSeek Harness Web model catalogue request failed.");
  const envelope: unknown = await response.json();
  if (!isRecord(envelope) || envelope.type !== "server-response" || envelope.rpcId !== rpcId
    || !isRecord(envelope.result) || envelope.result.ok !== true || !isRecord(envelope.result.value)) {
    throw new Error("DeepSeek Harness Web returned an invalid model catalogue response.");
  }
  const catalog = envelope.result.value;
  if (!isRecord(catalog) || !isRecord(catalog.default) || !Array.isArray(catalog.groups)
    || !Array.isArray(catalog.routableProviders) || !Array.isArray(catalog.failures)) {
    throw new Error("DeepSeek Harness Web returned an invalid model catalogue.");
  }
  return catalog as unknown as DeepSeekModelCatalog;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  child.kill("SIGTERM");
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([closed, new Promise<void>((resolve) => {
    timer = setTimeout(resolve, STOP_TIMEOUT_MS);
  })]);
  if (timer) clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32") forceStopNativeCli(child);
    else child.kill("SIGKILL");
  }
}
