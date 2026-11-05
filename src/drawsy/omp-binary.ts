import { detectExecutable, resolveExecutable } from "./executable-resolver.js";

const versionPattern = /(?:omp\/?\s*)?(\d+)\.(\d+)\.(\d+)/i;

const parseVersion = (value: string): [number, number, number] | null => {
  const match = value.match(versionPattern);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : null;
};

const input = () => ({ configured: process.env.DRAWSY_OMP_BIN, names: process.platform === "win32" ? ["omp.cmd", "omp.exe", "omp"] : ["omp"], parseVersion });
export const resolveOmpBinary = () => resolveExecutable(input()) || "omp";
export const detectOmpBinary = () => {
  const resolved = detectExecutable(input());
  return resolved ? { path: resolved.path, version: resolved.version.join(".") } : null;
};
