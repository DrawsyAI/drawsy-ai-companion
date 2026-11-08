import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCodexProviderLimits } from "./codex-provider-limits.js";

test("Codex exposes native windows and credits without account identity or duplicate buckets", () => {
  const result = parseCodexProviderLimits({ type: "chatgpt", planType: "plus", email: "private@example.test" }, {
    rateLimits: {
      limitId: "codex", primary: { usedPercent: 82, windowDurationMins: 300, resetsAt: 100 },
      credits: { balance: "0", unlimited: false }
    },
    rateLimitsByLimitId: {
      codex: { limitId: "codex", primary: { usedPercent: 82, windowDurationMins: 300, resetsAt: 100 },
        secondary: { usedPercent: 48, windowDurationMins: 10080 } }
    },
    rateLimitResetCredits: { availableCount: 0 }
  });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.equal(result.buckets.length, 1);
  assert.equal(result.plan, "plus");
  assert.equal(result.buckets[0]?.windows[0]?.usedPercent, 82);
  assert.equal(result.buckets[0]?.windows[1]?.windowMinutes, 10080);
  assert.equal(result.buckets[0]?.credits?.balance, "0");
  assert.equal(result.resetCredits, 0);
  assert.equal(JSON.stringify(result).includes("private@example.test"), false);
});

test("Codex omits unsupported auth and unavailable quota values", () => {
  assert.deepEqual(parseCodexProviderLimits({ type: "apiKey" }, {}), { status: "unavailable" });
  assert.deepEqual(parseCodexProviderLimits(null, {}), { status: "unavailable" });
  assert.deepEqual(parseCodexProviderLimits({ type: "chatgpt" }, {
    rateLimits: { primary: { usedPercent: null }, secondary: { usedPercent: NaN } }
  }), { status: "unavailable" });
});
