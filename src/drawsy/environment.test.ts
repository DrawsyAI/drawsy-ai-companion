import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadDrawsyEnvironment } from "./environment.js";

test("explicit environment mode loads one file and preserves supplied values", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "drawsy-environment-"));
  const keys = ["NODE_ENV", "DRAWSY_ENV_TEST", "DRAWSY_ENV_EXTERNAL"];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    delete process.env.NODE_ENV;
    process.env.DRAWSY_ENV_EXTERNAL = "parent";
    await writeFile(path.join(root, ".env.development"), "DRAWSY_ENV_TEST=local\nDRAWSY_ENV_EXTERNAL=file\n");
    await writeFile(path.join(root, ".env.production"), "DRAWSY_ENV_TEST=hosted\n");
    assert.equal(loadDrawsyEnvironment({ mode: "development", root }), "development");
    assert.equal(process.env.DRAWSY_ENV_TEST, "local");
    assert.equal(process.env.DRAWSY_ENV_EXTERNAL, "parent");
    assert.throws(() => loadDrawsyEnvironment({ mode: "staging", root }), /development or production/);
    delete process.env.DRAWSY_ENV_TEST;
    assert.equal(loadDrawsyEnvironment({ mode: "production", root, loadFile: false }), "production");
    assert.equal(process.env.DRAWSY_ENV_TEST, undefined);
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    await rm(root, { recursive: true, force: true });
  }
});
