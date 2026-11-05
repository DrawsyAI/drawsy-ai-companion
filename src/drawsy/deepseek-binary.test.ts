import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deepSeekDesktopLaunchers, resolveDeepSeekBinary } from "./deepseek-binary.js";

test("DeepSeek desktop discovery includes native macOS launchers without replacing PATH", () => {
  assert.deepEqual(deepSeekDesktopLaunchers("darwin", "/Users/example"), [
    "/Users/example/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh",
    "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
  ]);
  assert.deepEqual(deepSeekDesktopLaunchers("linux", "/home/example"), []);
  assert.deepEqual(deepSeekDesktopLaunchers("win32", "C:\\Users\\example"), []);
});

test("DeepSeek explicit binary override is preserved", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "drawsy-dsh-binary-"));
  const previous = process.env.DRAWSY_DEEPSEEK_BIN;
  try {
    process.env.DRAWSY_DEEPSEEK_BIN = path.join(root, "custom-dsh");
    assert.equal(resolveDeepSeekBinary(), process.env.DRAWSY_DEEPSEEK_BIN);
  } finally {
    if (previous === undefined) delete process.env.DRAWSY_DEEPSEEK_BIN;
    else process.env.DRAWSY_DEEPSEEK_BIN = previous;
    await rm(root, { recursive: true, force: true });
  }
});
