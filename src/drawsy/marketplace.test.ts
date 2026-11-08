import assert from "node:assert/strict";
import { test } from "node:test";
import { mutateMarketplace } from "./marketplace.js";

test("required Drawsy skills and MCP cannot be removed or disabled", async () => {
  for (const engine of ["codex", "opencode", "pi", "omp", "deepseek"] as const) {
    for (const id of ["drawsy", "drawsy-browser-use", "drawsy-fast-diagrams", "drawsy-teaching-diagrams"]) {
      await assert.rejects(mutateMarketplace(engine, { id, action: "uninstall" }), /required/);
      await assert.rejects(mutateMarketplace(engine, { id, action: "disable" }), /required/);
    }
  }
});
