import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOmpProviderLimits } from "./omp-provider-limits.js";

test("OMP normalizes native quota fractions and milliseconds without raw account data", () => {
  const result = parseOmpProviderLimits({ reports: [{
    provider: "anthropic",
    metadata: { email: "private@example.test" },
    limits: [{
      label: "5-hour usage",
      window: { durationMs: 18000000, resetsAt: 1794140000000 },
      amount: { usedFraction: 0.82 }
    }]
  }] });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.equal(result.buckets[0]?.windows[0]?.usedPercent, 82);
  assert.equal(result.buckets[0]?.windows[0]?.windowMinutes, 300);
  assert.equal(result.buckets[0]?.windows[0]?.resetsAt, 1794140000);
  assert.equal(JSON.stringify(result).includes("private@example.test"), false);
});

test("OMP omits wallet balances and preserves unused quota", () => {
  assert.deepEqual(parseOmpProviderLimits({ reports: [{
    provider: "deepseek",
    limits: [{ label: "wallet", window: {}, amount: { used: 2, limit: 10 } }]
  }] }), { status: "unavailable" });
  const result = parseOmpProviderLimits({ reports: [{
    provider: "anthropic",
    limits: [{ window: { durationMs: 60000 }, amount: { remainingFraction: 1 } }]
  }] });
  assert.equal(result.status, "available");
  if (result.status === "available") assert.equal(result.buckets[0]?.windows[0]?.usedPercent, 0);
});
