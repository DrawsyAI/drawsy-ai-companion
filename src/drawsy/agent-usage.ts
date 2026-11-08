import type { AgentUsage, BridgeEvent } from "./protocol.js";

export const usageNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

export const inclusiveTokenCount = (base: unknown, ...components: unknown[]) => {
  const count = usageNumber(base);
  return count === undefined
    ? undefined
    : components.reduce<number>((sum, value) => sum + (usageNumber(value) ?? 0), count);
};

export const usageEvent = (
  usageId: string,
  values: { [K in keyof AgentUsage]: unknown },
  model?: string,
  modelProvider?: string
): Extract<BridgeEvent, { type: "usage.recorded" }> | null => {
  const usage: AgentUsage = {};
  for (const key of Object.keys(values) as (keyof AgentUsage)[]) {
    const value = usageNumber(values[key]);
    if (value !== undefined) usage[key] = value;
  }
  return Object.keys(usage).length
    ? { type: "usage.recorded", data: { usageId, usage, model, modelProvider } }
    : null;
};
