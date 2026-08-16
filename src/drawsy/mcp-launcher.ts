import path from "node:path";
import { fileURLToPath } from "node:url";

export const resolveDrawsyMcpEntry = (moduleUrl: string) => {
  const entry = path.resolve(path.dirname(fileURLToPath(moduleUrl)), "mcp.js");
  if (!process.versions.electron) return entry;

  return entry.replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`
  );
};

export const drawsyMcpProcess = (entry: string) => ({
  command: process.execPath,
  args: [entry],
  environment: process.versions.electron
    ? { ELECTRON_RUN_AS_NODE: "1" }
    : {}
});
