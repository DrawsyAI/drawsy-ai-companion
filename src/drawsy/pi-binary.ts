import { detectExecutable, resolveExecutable } from "./executable-resolver.js";

const parseVersion = (value: string): [number, number, number] | null => {
  const match = value.match(/(?:pi(?:-coding-agent)?\s+)?(\d+)\.(\d+)\.(\d+)/i);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : null;
};

const input = () => ({ configured: process.env.DRAWSY_PI_BIN, names: process.platform === "win32" ? ["pi.cmd", "pi.exe", "pi"] : ["pi"], parseVersion });
export const resolvePiBinary = () => resolveExecutable(input()) || "pi";
export const detectPiBinary = () => {
  const resolved = detectExecutable(input());
  return resolved ? { path: resolved.path, version: resolved.version.join(".") } : null;
};
