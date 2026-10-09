import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { detectExecutable } from "./executable-resolver.js";

test("Windows probes native executables in paths containing spaces and shell characters", {
  skip: process.platform !== "win32"
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "drawsy executable & test "));
  const executable = path.join(root, "node runtime.exe");
  try {
    await copyFile(process.execPath, executable);
    const detected = detectExecutable({
      configured: executable,
      names: [],
      parseVersion: (text) => {
        const match = /^v(\d+)\.(\d+)\.(\d+)/.exec(text);
        return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
      }
    });
    assert.equal(detected?.path, executable);
    assert.equal(detected?.version.join("."), process.versions.node);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
