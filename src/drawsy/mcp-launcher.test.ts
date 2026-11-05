import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { drawsyMcpProcess, resolveDrawsyMcpEntry } from "./mcp-launcher.js";

test("packaged Electron launches session MCP as Node from unpacked files", () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.versions, "electron");
  Object.defineProperty(process.versions, "electron", { value: "39.0.0", configurable: true });
  try {
    const modulePath = path.resolve("fixture", "app.asar", "dist", "drawsy", "pi-app-server.js");
    const entry = resolveDrawsyMcpEntry(pathToFileURL(modulePath).href);
    assert.equal(entry, path.resolve("fixture", "app.asar.unpacked", "dist", "drawsy", "mcp.js"));
    assert.deepEqual(drawsyMcpProcess(entry), {
      command: process.execPath,
      args: [entry],
      environment: { ELECTRON_RUN_AS_NODE: "1" }
    });
  } finally {
    if (descriptor) Object.defineProperty(process.versions, "electron", descriptor);
    else delete (process.versions as Record<string, string | undefined>).electron;
  }
});
