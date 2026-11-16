import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import { spawnNativeCliSync } from "./native-cli.js";

export type AcpEngine = "antigravity" | "claude";
export const isAcpEngine = (value: unknown): value is AcpEngine =>
  value === "antigravity" || value === "claude";

const definitions = {
  antigravity: { name: "Antigravity", executable: "agy", args: ["acp"], override: "DRAWSY_AGY_BIN" },
  claude: { name: "Claude", executable: "claude-agent-acp", args: [], override: "DRAWSY_CLAUDE_ACP_BIN" }
};

const candidates = (engine: AcpEngine) => {
  const { executable, override } = definitions[engine];
  const configured = process.env[override]?.trim();
  if (configured) return [configured];
  const directories = [
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
    join(homedir(), ".local", "bin"),
    ...(process.platform === "win32" && process.env.APPDATA ? [join(process.env.APPDATA, "npm")] : [])
  ];
  const names = process.platform === "win32" ? [`${executable}.exe`, `${executable}.cmd`] : [executable];
  return [...new Set(directories.flatMap((directory) => names.map((name) => join(directory, name))))];
};

export const acpLaunch = (engine: AcpEngine) => {
  const definition = definitions[engine];
  const status = readAcpStatus(engine);
  if (!status.path) throw new Error(`Install ${definition.name === "Claude" ? "the Claude ACP adapter" : "Antigravity CLI with ACP support"} on this device, then retry.`);
  return { name: definition.name, command: status.path, args: definition.args };
};

export const readAcpStatus = (engine: AcpEngine) => {
  const { name } = definitions[engine];
  for (const executable of candidates(engine)) {
    if (!existsSync(executable)) continue;
    const result = spawnNativeCliSync(executable, engine === "antigravity" ? ["acp", "--help"] : ["--version"], {
      encoding: "utf8", timeout: 2_000, windowsHide: true
    });
    if (!result.error && result.status === 0) return { id: engine, name, installed: true, path: executable };
  }
  return { id: engine, name, installed: false };
};
