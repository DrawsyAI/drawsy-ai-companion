import { spawnSync } from "node:child_process";
import { delimiter, join } from "node:path";

const PROBE_TIMEOUT_MS = 3_000;

export type ExecutableVersion = [number, number, number];

export type ResolvedExecutable = {
  path: string;
  version: ExecutableVersion;
};

type ResolveExecutableInput = {
  configured?: string;
  names: string[];
  parseVersion: (value: string) => ExecutableVersion | null;
};

const pathEntries = (value: string | undefined) =>
  typeof value === "string"
    ? value
        .split(delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

const readLoginShellPath = () => {
  if (process.platform === "win32") return [];

  const shell =
    process.env.SHELL?.trim() ||
    (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
  const result = spawnSync(shell, ["-ilc", "/usr/bin/env"], {
    encoding: "utf8",
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true
  });
  if (result.error || result.status !== 0) return [];

  const output = typeof result.stdout === "string" ? result.stdout : "";
  const pathLine = output
    .split(/\r?\n/)
    .find((line) => line.startsWith("PATH="));
  return pathEntries(pathLine?.slice("PATH=".length));
};

export const executableSearchPath = () => {
  const entries = [
    ...pathEntries(process.env.PATH),
    ...pathEntries(process.env.Path)
  ];
  if (process.platform !== "win32") entries.push(...readLoginShellPath());
  return [...new Set(entries)];
};

export const executableEnvironment = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: executableSearchPath().join(delimiter)
});

const compareVersions = (
  left: ResolvedExecutable,
  right: ResolvedExecutable
) => {
  for (let index = 0; index < left.version.length; index += 1) {
    const difference = right.version[index]! - left.version[index]!;
    if (difference) return difference;
  }
  return 0;
};

export const resolveExecutable = ({
  configured,
  names,
  parseVersion
}: ResolveExecutableInput): string | null => {
  const configuredCandidate = configured?.trim();
  if (configuredCandidate) return configuredCandidate;

  const searchPath = executableSearchPath();
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: searchPath.join(delimiter)
  };
  const candidates = [
    ...searchPath.flatMap((entry) =>
      names.map((name) => join(entry, name))
    )
  ];

  const resolved = [...new Set(candidates)].flatMap(
    (candidate): ResolvedExecutable[] => {
      const result = spawnSync(candidate, ["--version"], {
        encoding: "utf8",
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
        shell: process.platform === "win32",
        env: environment
      });
      if (result.error || result.status !== 0) return [];
      const version = parseVersion(`${result.stdout}\n${result.stderr}`);
      return version ? [{ path: candidate, version }] : [];
    }
  );

  return resolved.sort(compareVersions)[0]?.path || null;
};

export const detectExecutable = (input: ResolveExecutableInput) => {
  const binary = resolveExecutable(input);
  if (!binary) return null;

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: executableSearchPath().join(delimiter)
  };
  const result = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true,
    shell: process.platform === "win32",
    env: environment
  });
  if (result.error || result.status !== 0) return null;
  const version = input.parseVersion(`${result.stdout}\n${result.stderr}`);
  return version ? { path: binary, version } : null;
};
