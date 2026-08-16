import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";

type CodexCandidate = {
  path: string;
  version: [number, number, number];
};

let resolvedCodexBinary: string | null = null;

const parseVersion = (value: string): [number, number, number] | null => {
  const match = value.match(/codex-cli\s+(\d+)\.(\d+)\.(\d+)/i);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : null;
};

const compareVersions = (left: CodexCandidate, right: CodexCandidate) => {
  for (let index = 0; index < left.version.length; index += 1) {
    const difference = right.version[index]! - left.version[index]!;
    if (difference) return difference;
  }
  return 0;
};

export const resolveCodexBinary = () => {
  const configured = process.env.DRAWSY_CODEX_BIN?.trim();
  if (configured) return configured;
  if (resolvedCodexBinary) return resolvedCodexBinary;

  const executable = process.platform === "win32" ? "codex.cmd" : "codex";
  const paths = (process.env.PATH || "")
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const candidates = [...new Set(paths.map((entry) => join(entry, executable)))]
    .flatMap((candidate): CodexCandidate[] => {
      const result = spawnSync(candidate, ["--version"], {
        encoding: "utf8",
        timeout: 3_000,
        windowsHide: true,
      });
      if (result.error || result.status !== 0) return [];
      const version = parseVersion(`${result.stdout}\n${result.stderr}`);
      return version ? [{ path: candidate, version }] : [];
    })
    .sort(compareVersions);

  resolvedCodexBinary = candidates[0]?.path || "codex";
  return resolvedCodexBinary;
};

export const detectCodexBinary = () => {
  const binary = resolveCodexBinary();
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
