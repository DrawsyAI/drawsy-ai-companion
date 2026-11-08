import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { mutateNativeMarketplace, parseOmpNativePluginList, readNativeMarketplace } from "./native-marketplace.js";

test("Pi native marketplace reads package sources from the configured agent directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "drawsy-pi-marketplace-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
    await writeFile(join(directory, "settings.json"), JSON.stringify({
      packages: ["npm:@drawsy/native", { source: "https://github.com/acme/pi-tools@v2" }, { extensions: ["./local"] }, "npm:@drawsy/native"]
    }));
    const result = await readNativeMarketplace("pi");
    assert.equal(result.installSource, "npm");
    assert.deepEqual(result.items.map(({ id, name, kind, installed, required, source, actions }) => ({ id, name, kind, installed, required, source, actions })), [
      { id: "npm:@drawsy/native", name: "native", kind: "plugin", installed: true, required: false, source: "npm:@drawsy/native", actions: ["uninstall"] },
      { id: "https://github.com/acme/pi-tools@v2", name: "pi-tools", kind: "plugin", installed: true, required: false, source: "https://github.com/acme/pi-tools@v2", actions: ["uninstall"] }
    ]);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("native mutation rejects unsupported engines and unsafe Pi sources without running a CLI", async () => {
  await assert.rejects(mutateNativeMarketplace("deepseek", { action: "uninstall", id: "example" }), /not exposed/);
  await assert.rejects(mutateNativeMarketplace("pi", { action: "install", source: "https://example.com/evil" }), /must use npm:|github\.com/);
  await assert.rejects(mutateNativeMarketplace("pi", { action: "install", source: "npm:pkg && touch /tmp/pwned" }), /must use npm:|github\.com/);
});

test("OpenCode native marketplace returns discovered skills without mutation actions", async () => {
  const result = await readNativeMarketplace("opencode");
  assert.ok(Array.isArray(result.items));
  assert.ok(result.items.every((item) => item.kind === "skill" && item.actions.length === 0));
});

test("OMP native JSON inventory accepts the documented npm/marketplace schema only", () => {
  assert.deepEqual(parseOmpNativePluginList(JSON.stringify({
    npm: [{ name: "@acme/tools", version: "1.2.3", enabled: true, manifest: { description: "Useful tools" } }],
    marketplace: []
  })), { npm: [{ name: "@acme/tools", version: "1.2.3", description: "Useful tools" }], marketplaceCount: 0 });
  assert.deepEqual(parseOmpNativePluginList('{"npm":[],"marketplace":[]}'), { npm: [], marketplaceCount: 0 });
  assert.equal(parseOmpNativePluginList('{"items":[]}'), null);
  assert.deepEqual(parseOmpNativePluginList(JSON.stringify({
    npm: [{ name: "--help", version: "1.0", manifest: {} }, { name: "valid", version: "1.0", manifest: {} }],
    marketplace: []
  })), { npm: [{ name: "valid", version: "1.0", description: "Installed OMP package" }], marketplaceCount: 0 });
});
