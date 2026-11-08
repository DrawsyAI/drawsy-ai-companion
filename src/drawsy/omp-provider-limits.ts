import { executableEnvironment } from "./executable-resolver.js";
import { forceStopNativeCli, spawnNativeCli } from "./native-cli.js";
import { resolveOmpBinary } from "./omp-binary.js";
import { isRecord } from "./protocol.js";

type UsageWindow = {
  name?: string;
  usedPercent: number;
  windowMinutes?: number;
  resetsAt?: number;
};

type UsageBucket = { id: string; name: string; windows: UsageWindow[] };

type OmpProviderLimits =
  | { status: "available"; provider: "Oh My Pi"; buckets: UsageBucket[] }
  | { status: "unavailable" };

const unavailable = { status: "unavailable" } as const;
const TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const providerNames = new Map([
  ["anthropic", "Claude"],
  ["openai-codex", "ChatGPT"],
  ["opencode-go", "OpenCode Go"],
  ["github-copilot", "GitHub Copilot"],
  ["google-gemini-cli", "Gemini CLI"],
  ["google-antigravity", "Google Antigravity"],
  ["kimi-code", "Kimi Code"]
]);

const isNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

// These fields are native meter labels. Do not forward account metadata or raw payloads.
const usageLabel = (value: unknown) =>
  typeof value === "string" && /^[\w][\w .:/+()%-]{0,79}$/.test(value)
    ? value
    : undefined;

const readWindow = (limit: unknown): UsageWindow | null => {
  if (!isRecord(limit) || !isRecord(limit.amount) || !isRecord(limit.window)) return null;
  const { amount, window } = limit;
  const name = usageLabel(limit.label) ?? usageLabel(window.label);
  const windowMinutes = isNonNegative(window.durationMs) && window.durationMs > 0
    ? window.durationMs / 60_000
    : undefined;
  const resetsAt = isNonNegative(window.resetsAt) && window.resetsAt > 0
    ? Math.floor(window.resetsAt / 1000)
    : undefined;
  if ((!windowMinutes && !resetsAt) || /\b(wallet|balance|pay.as.you.go)\b/i.test(name ?? "")) {
    return null;
  }

  // Prefer the native fraction. Some providers only report absolute limits or percent used.
  let fraction: number | undefined;
  if (isNonNegative(amount.usedFraction)) fraction = amount.usedFraction;
  else if (isNonNegative(amount.used) && isNonNegative(amount.limit) && amount.limit > 0) {
    fraction = amount.used / amount.limit;
  } else if (amount.unit === "percent" && isNonNegative(amount.used)) {
    fraction = amount.used / 100;
  } else if (isNonNegative(amount.remainingFraction) && amount.remainingFraction <= 1) {
    fraction = 1 - amount.remainingFraction;
  }
  if (fraction === undefined || !Number.isFinite(fraction)) return null;
  return { name, windowMinutes, resetsAt, usedPercent: Math.min(100, fraction * 100) };
};

export const parseOmpProviderLimits = (value: unknown): OmpProviderLimits => {
  if (!isRecord(value) || !Array.isArray(value.reports)) return unavailable;
  const buckets: UsageBucket[] = [];
  for (const report of value.reports) {
    if (!isRecord(report) || typeof report.provider !== "string" || !Array.isArray(report.limits)) continue;
    const provider = providerNames.get(report.provider) ?? usageLabel(report.provider);
    if (!provider) continue;
    const windows = report.limits.map(readWindow).filter((window): window is UsageWindow => window !== null);
    if (!windows.length) continue;
    buckets.push({ id: `omp-${buckets.length + 1}`, name: provider, windows });
  }
  const shown = new Map<string, number>();
  for (const bucket of buckets) {
    const index = (shown.get(bucket.name) ?? 0) + 1;
    shown.set(bucket.name, index);
  }
  const numbered = new Map<string, number>();
  for (const bucket of buckets) {
    if ((shown.get(bucket.name) ?? 0) < 2) continue;
    const index = (numbered.get(bucket.name) ?? 0) + 1;
    numbered.set(bucket.name, index);
    bucket.name = `${bucket.name} · Account ${index}`;
  }
  return buckets.length ? { status: "available", provider: "Oh My Pi", buckets } : unavailable;
};

const fetchLimits = async (): Promise<OmpProviderLimits> => {
  try {
    return await new Promise<OmpProviderLimits>((resolve) => {
      const child = spawnNativeCli(resolveOmpBinary(), ["usage", "--json", "--redact", "--no-extensions"], {
        env: executableEnvironment(), stdio: ["ignore", "pipe", "ignore"], windowsHide: true
      });
      let output = "";
      let outputBytes = 0;
      const timeout = setTimeout(stop, TIMEOUT_MS);
      const finish = (result: OmpProviderLimits) => {
        clearTimeout(timeout);
        resolve(result);
      };
      function stop() {
        forceStopNativeCli(child);
        finish(unavailable);
      }
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > MAX_OUTPUT_BYTES) {
          stop();
          return;
        }
        output += chunk;
      });
      child.once("error", () => finish(unavailable));
      child.once("close", (code) => {
        try {
          finish(code === 0 && outputBytes <= MAX_OUTPUT_BYTES
            ? parseOmpProviderLimits(JSON.parse(output))
            : unavailable);
        } catch {
          finish(unavailable);
        }
      });
    });
  } catch {
    return unavailable;
  }
};

let pending: Promise<OmpProviderLimits> | undefined;

export const readOmpProviderLimits = (): Promise<OmpProviderLimits> => {
  pending ??= fetchLimits().finally(() => { pending = undefined; });
  return pending;
};
