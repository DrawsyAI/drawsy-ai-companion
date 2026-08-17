import {
  detectExecutable,
  resolveExecutable
} from "./executable-resolver.js";

const parseVersion = (value: string): [number, number, number] | null => {
  const match = value.match(/(?:opencode\s+)?(\d+)\.(\d+)\.(\d+)/i);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : null;
};

export const resolveOpenCodeBinary = () =>
  resolveExecutable({
    configured: process.env.DRAWSY_OPENCODE_BIN,
    names:
      process.platform === "win32"
        ? ["opencode.cmd", "opencode.exe", "opencode"]
        : ["opencode"],
    parseVersion
  }) || null;

export const detectOpenCodeBinary = () => {
  const resolved = detectExecutable({
    configured: process.env.DRAWSY_OPENCODE_BIN,
    names:
      process.platform === "win32"
        ? ["opencode.cmd", "opencode.exe", "opencode"]
        : ["opencode"],
    parseVersion
  });
  return resolved
    ? { path: resolved.path, version: resolved.version.join(".") }
    : null;
};
