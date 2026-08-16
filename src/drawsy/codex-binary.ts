import {
  detectExecutable,
  resolveExecutable
} from "./executable-resolver.js";

const parseVersion = (value: string): [number, number, number] | null => {
  const match = value.match(/codex-cli\s+(\d+)\.(\d+)\.(\d+)/i);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : null;
};

export const resolveCodexBinary = () =>
  resolveExecutable({
    configured: process.env.DRAWSY_CODEX_BIN,
    names:
      process.platform === "win32"
        ? ["codex.cmd", "codex.exe", "codex"]
        : ["codex"],
    parseVersion
  }) || null;

export const detectCodexBinary = () => {
  const resolved = detectExecutable({
    configured: process.env.DRAWSY_CODEX_BIN,
    names:
      process.platform === "win32"
        ? ["codex.cmd", "codex.exe", "codex"]
        : ["codex"],
    parseVersion
  });
  return resolved
    ? { path: resolved.path, version: resolved.version.join(".") }
    : null;
};
