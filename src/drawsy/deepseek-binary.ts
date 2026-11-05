import { homedir } from "node:os";
import { join } from "node:path";
import { executableSearchPath } from "./executable-resolver.js";
import { spawnNativeCliSync } from "./native-cli.js";

type Version = [number, number, number];
const parseVersion = (value: string): Version | null => {
  const match = value.match(/(?:dsh|deepseek(?:-cli)?\s+)?v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/i);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

export const deepSeekDesktopLaunchers = (platform: NodeJS.Platform, home: string) => {
  if (platform !== "darwin") return [];
  const launcher = "DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh";
  return [join(home, "Applications", launcher), join("/Applications", launcher)];
};

/** Locate the installed DeepSeek Harness CLI without changing its home or profile. */
export const resolveDeepSeekBinary = () => {
  const configured = process.env.DRAWSY_DEEPSEEK_BIN?.trim();
  if (configured) return configured;
  const names = process.platform === "win32" ? ["dsh.cmd", "dsh.exe", "dsh"] : ["dsh"];
  const candidates = [...new Set(executableSearchPath().flatMap((entry) => names.map((name) => join(entry, name)))
    .concat(deepSeekDesktopLaunchers(process.platform, homedir())))];
  for (const candidate of candidates) {
    const result = spawnNativeCliSync(candidate, ["--version"], { encoding: "utf8", timeout: 3_000, windowsHide: true });
    if (!result.error && result.status === 0 && parseVersion(`${result.stdout}\n${result.stderr}`)) return candidate;
  }
  return "dsh";
};

export const detectDeepSeekBinary = () => {
  const path = resolveDeepSeekBinary();
  const result = spawnNativeCliSync(path, ["--version"], { encoding: "utf8", timeout: 3_000, windowsHide: true });
  const version = !result.error && result.status === 0 ? parseVersion(`${result.stdout}\n${result.stderr}`) : null;
  return version ? { path, version: version.join(".") } : null;
};
