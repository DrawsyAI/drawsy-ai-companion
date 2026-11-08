import { createInterface } from "node:readline";

import { resolveCodexBinary } from "./codex-binary.js";
import { executableEnvironment } from "./executable-resolver.js";
import { spawnNativeCli } from "./native-cli.js";
import { isRecord } from "./protocol.js";

const unavailable = { status: "unavailable" } as const;
const stringValue = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const nonnegative = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value : undefined;

const parseWindow = (value: unknown) => {
  if (!isRecord(value)) return null;
  const usedPercent = nonnegative(value.usedPercent);
  if (usedPercent === undefined) return null;
  return {
    usedPercent,
    windowMinutes: nonnegative(value.windowDurationMins),
    resetsAt: nonnegative(value.resetsAt)
  };
};

export const parseCodexProviderLimits = (account: unknown, result: unknown) => {
  if (!isRecord(account) || account.type !== "chatgpt" || !isRecord(result)) {
    return unavailable;
  }
  const rawBuckets = new Map<string, Record<string, unknown>>();
  if (isRecord(result.rateLimitsByLimitId)) {
    for (const [key, bucket] of Object.entries(result.rateLimitsByLimitId)) {
      if (isRecord(bucket)) rawBuckets.set(stringValue(bucket.limitId) ?? key, bucket);
    }
  }
  if (isRecord(result.rateLimits)) {
    const id = stringValue(result.rateLimits.limitId) ?? "codex";
    rawBuckets.set(id, { ...result.rateLimits, ...rawBuckets.get(id) });
  }
  const buckets = [...rawBuckets].flatMap(([id, bucket]) => {
    const windows = [parseWindow(bucket.primary), parseWindow(bucket.secondary)]
      .filter((window) => window !== null);
    const credit = isRecord(bucket.credits) ? bucket.credits : null;
    const balance = stringValue(credit?.balance);
    const credits = credit && (balance !== undefined || credit.unlimited === true)
      ? { balance, unlimited: credit.unlimited === true } : undefined;
    return windows.length || credits
      ? [{ id, name: stringValue(bucket.limitName), windows, credits }] : [];
  });
  const resetCredits = isRecord(result.rateLimitResetCredits)
    ? nonnegative(result.rateLimitResetCredits.availableCount) : undefined;
  if (!buckets.length && resetCredits === undefined) return unavailable;
  return {
    status: "available" as const,
    provider: "ChatGPT",
    plan: stringValue(account.planType) ?? stringValue(rawBuckets.get("codex")?.planType),
    buckets,
    resetCredits
  };
};

const read = async () => {
  const binary = resolveCodexBinary();
  if (!binary) return unavailable;
  const env = executableEnvironment();
  delete env.PORT;
  const child = spawnNativeCli(binary, ["app-server", "--stdio"], {
    env, stdio: ["pipe", "pipe", "ignore"], windowsHide: true
  });
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  const stopReading = () => lines.close();
  child.on("error", stopReading);
  child.stdin.on("error", stopReading);
  const timeout = setTimeout(() => {
    stopReading();
    child.kill("SIGKILL");
  }, 10_000);

  const request = async (id: number, method: string, params?: Record<string, unknown>) => {
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    while (true) {
      const line = await iterator.next();
      if (line.done) return null;
      const message: unknown = JSON.parse(line.value);
      if (isRecord(message) && message.id === id) return message.result ?? null;
    }
  };

  try {
    const initialized = await request(1, "initialize", {
      clientInfo: { name: "drawsy-ai", title: "Drawsy AI", version: "0.1.0" }
    });
    if (!initialized) return unavailable;
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    const identity = await request(2, "account/read", { refreshToken: false });
    if (!isRecord(identity) || !isRecord(identity.account) || identity.account.type !== "chatgpt") {
      return unavailable;
    }
    const limits = await request(3, "account/rateLimits/read");
    return parseCodexProviderLimits(identity.account, limits);
  } finally {
    clearTimeout(timeout);
    lines.close();
    child.stdin.end();
    child.kill("SIGKILL");
  }
};

let pending: ReturnType<typeof read> | undefined;
export const readCodexProviderLimits = () =>
  pending ??= read().catch(() => unavailable).finally(() => { pending = undefined; });
