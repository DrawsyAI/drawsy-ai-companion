import { spawnSync } from "node:child_process";
import { delimiter, join } from "node:path";

type OpenCodeCandidate = {
  path: string;
  version: [number, number, number];
};

let resolvedOpenCodeBinary: string | null = null;

const parseVersion = (value: string): [number, number, number] | null => {
  const match = value.match(/(?:opencode\s+)?(\d+)\.(\d+)\.(\d+)/i);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : null;
};

const compareVersions = (left: OpenCodeCandidate, right: OpenCodeCandidate) => {
  for (let index = 0; index < left.version.length; index += 1) {
    const difference = right.version[index]! - left.version[index]!;
    if (difference) return difference;
  }
  return 0;
};

export const resolveOpenCodeBinary = () => {
  const configured = process.env.DRAWSY_OPENCODE_BIN?.trim();
  if (configured) return configured;
  if (resolvedOpenCodeBinary) return resolvedOpenCodeBinary;

  const executable = process.platform === "win32" ? "opencode.cmd" : "opencode";
  const paths = (process.env.PATH || "")
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const candidates = [...new Set(paths.map((entry) => join(entry, executable)))]
    .flatMap((candidate): OpenCodeCandidate[] => {
      const result = spawnSync(candidate, ["--version"], {
        encoding: "utf8",
        timeout: 3_000,
        windowsHide: true
      });
      if (result.error || result.status !== 0) return [];
      const version = parseVersion(`${result.stdout}\n${result.stderr}`);
      return version ? [{ path: candidate, version }] : [];
    })
    .sort(compareVersions);

  resolvedOpenCodeBinary = candidates[0]?.path || "opencode";
  return resolvedOpenCodeBinary;
};

export const detectOpenCodeBinary = () => {
  const binary = resolveOpenCodeBinary();
  const result = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    timeout: 3_000,
    windowsHide: true,
    shell: process.platform === "win32"
  });
  const version = parseVersion(`${result.stdout}\n${result.stderr}`);
  return result.error || result.status !== 0 || !version
    ? null
    : { path: binary, version: version.join(".") };
};
