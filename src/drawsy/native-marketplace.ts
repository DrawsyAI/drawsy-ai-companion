import { spawnNativeCli } from "./native-cli.js";
import { resolvePiBinary } from "./pi-binary.js";
import { resolveOmpBinary } from "./omp-binary.js";
import { availableOpenCodeSkills } from "./opencode-app-server.js";
import type { AgentEngine, AgentSkillOption } from "./protocol.js";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { executableEnvironment } from "./executable-resolver.js";

export type NativeMarketplaceItem = {
  id: string;
  name: string;
  description: string;
  kind: "plugin" | "skill";
  installed: true;
  required: boolean;
  source: string;
  actions: Array<"uninstall">;
};

export type NativeMarketplaceResult = {
  items: NativeMarketplaceItem[];
  note?: string;
  installSource?: "npm";
};

export type NativeMarketplaceMutation = {
  action: "install" | "uninstall";
  id?: string;
  source?: string;
};

const PI_NPM_SOURCE = /^npm:(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-z0-9][a-z0-9._+-]*)?$/i;
const PI_GITHUB_SOURCE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:@[A-Za-z0-9._/-]+)?$/;
const PI_AGENT_DIR = () => {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  const expanded = configured?.startsWith("~/")
    ? join(homedir(), configured.slice(2))
    : configured;
  return resolve(expanded || join(homedir(), ".pi", "agent"));
};

let piMutationQueue: Promise<void> = Promise.resolve();
let ompMutationQueue: Promise<void> = Promise.resolve();
const serializePiMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
  const previous = piMutationQueue;
  let release!: () => void;
  piMutationQueue = new Promise<void>((resolveQueue) => { release = resolveQueue; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
};
const serializeOmpMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
  const previous = ompMutationQueue;
  let release!: () => void;
  ompMutationQueue = new Promise<void>((resolveQueue) => { release = resolveQueue; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
};

const piSettingsPath = () => join(PI_AGENT_DIR(), "settings.json");

const readPiPackages = async (): Promise<Array<{ source: string }>> => {
  let raw: string;
  try {
    raw = await readFile(piSettingsPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let settings: unknown;
  try {
    settings = JSON.parse(raw);
  } catch {
    throw new Error("Pi settings.json is not valid JSON; native packages could not be listed.");
  }
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return [];
  const packages = (settings as Record<string, unknown>).packages;
  if (!Array.isArray(packages)) return [];
  return packages.flatMap((entry) => {
    const source = typeof entry === "string"
      ? entry
      : typeof entry === "object" && entry !== null && !Array.isArray(entry) && typeof (entry as Record<string, unknown>).source === "string"
      ? (entry as Record<string, unknown>).source as string
      : "";
    return source.trim() ? [{ source: source.trim() }] : [];
  });
};

const packageName = (source: string) => {
  const bare = source.replace(/^npm:/, "").replace(/^https:\/\/github\.com\//, "").replace(/@[^/@]+$/, "");
  return bare.split("/").filter(Boolean).at(-1) || source;
};

const piItems = async (): Promise<NativeMarketplaceItem[]> => {
  const packages = await readPiPackages();
  return [...new Map(packages.map(({ source }) => [source, {
    id: source,
    name: packageName(source),
    description: "Installed Pi package",
    kind: "plugin" as const,
    installed: true as const,
    required: false,
    source,
    actions: (PI_NPM_SOURCE.test(source) || PI_GITHUB_SOURCE.test(source)
      ? ["uninstall"]
      : []) as Array<"uninstall">
  }])).values()].sort((left, right) => left.name.localeCompare(right.name));
};

const runPi = (args: string[]) => new Promise<void>((resolveRun, rejectRun) => {
  const child = spawnNativeCli(resolvePiBinary(), args, {
    cwd: process.cwd(),
    env: executableEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let outputBytes = 0;
  const append = (chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > 64 * 1024) child.kill("SIGKILL");
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  const timeout = setTimeout(() => child.kill("SIGKILL"), 60_000);
  child.once("error", (error) => {
    clearTimeout(timeout);
    rejectRun(new Error(`Could not run Pi package command: ${error.message}`));
  });
  child.once("close", (code, signal) => {
    clearTimeout(timeout);
    if (code === 0) resolveRun();
    else rejectRun(new Error(`Pi package command failed (exit ${code ?? signal ?? "unknown"}).`));
  });
});

const runNativeCli = (binary: string, args: string[]) => new Promise<string>((resolveRun, rejectRun) => {
  const child = spawnNativeCli(binary, args, {
    cwd: process.cwd(),
    env: executableEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let stdout = "";
  let outputBytes = 0;
  let outputLimitHit = false;
  const append = (chunk: Buffer, target: "stdout" | "stderr") => {
    outputBytes += chunk.length;
    if (outputBytes > 64 * 1024) {
      outputLimitHit = true;
      child.kill("SIGKILL");
      return;
    }
    if (target === "stdout") stdout += chunk.toString("utf8");
  };
  child.stdout?.on("data", (chunk: Buffer) => append(chunk, "stdout"));
  child.stderr?.on("data", (chunk: Buffer) => append(chunk, "stderr"));
  const timeout = setTimeout(() => child.kill("SIGKILL"), 60_000);
  child.once("error", (error) => {
    clearTimeout(timeout);
    rejectRun(new Error(`Could not run native harness command: ${error.message}`));
  });
  child.once("close", (code, signal) => {
    clearTimeout(timeout);
    if (code === 0) resolveRun(stdout);
    else rejectRun(new Error(outputLimitHit
      ? "Native harness command exceeded the 64 KiB output limit."
      : `Native harness command failed (exit ${code ?? signal ?? "unknown"}).`));
  });
});

type OmpNpmPlugin = { name: string; version: string; description: string };
type OmpNativePluginList = { npm: OmpNpmPlugin[]; marketplaceCount: number };
const OMP_NPM_PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[0-9][a-z0-9._+-]*)?$/i;

export const parseOmpNativePluginList = (text: string): OmpNativePluginList | null => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.npm) || !Array.isArray(record.marketplace)) return null;
  const npm = record.npm.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const plugin = entry as Record<string, unknown>;
    const name = typeof plugin.name === "string" ? plugin.name.trim() : "";
    const version = typeof plugin.version === "string" ? plugin.version.trim() : "";
    const manifest = typeof plugin.manifest === "object" && plugin.manifest !== null
      ? plugin.manifest as Record<string, unknown>
      : {};
    const description = typeof manifest.description === "string" ? manifest.description : "Installed OMP package";
    if (!name || !version || !OMP_NPM_PACKAGE.test(name)) return [];
    return [{ name, version, description }];
  });
  return { npm, marketplaceCount: record.marketplace.length };
};

const readOmpPackages = async (): Promise<OmpNativePluginList | null> => {
  try {
    const output = await runNativeCli(resolveOmpBinary(), ["plugin", "list", "--json"]);
    return parseOmpNativePluginList(output);
  } catch {
    return null;
  }
};

const ompItems = async (): Promise<{ items: NativeMarketplaceItem[]; marketplaceCount: number } | null> => {
  const packageList = await readOmpPackages();
  if (!packageList) return null;
  return {
    marketplaceCount: packageList.marketplaceCount,
    items: packageList.npm.map((plugin) => ({
      id: plugin.name,
      name: plugin.name,
      description: plugin.description,
      kind: "plugin",
      installed: true,
      required: false,
      source: `npm:${plugin.name}@${plugin.version}`,
      actions: ["uninstall"]
    }))
  };
};

const normalizeOmpInstallSource = (source: string | undefined) => {
  if (!source) return null;
  const spec = source.startsWith("npm:") ? source.slice(4) : source;
  return OMP_NPM_PACKAGE.test(spec) ? spec : null;
};

let ompPackageCommandSupport: Promise<boolean> | null = null;
const supportsOmpPackageCommands = () => {
  ompPackageCommandSupport ??= runNativeCli(resolveOmpBinary(), ["plugin", "--help"])
    .then((help) => help.includes("--json") && /\binstall\b/.test(help) && /\buninstall\b/.test(help))
    .catch(() => false);
  return ompPackageCommandSupport;
};

const mutateOmp = (mutation: NativeMarketplaceMutation) => serializeOmpMutation(async () => {
  const installedItems = await ompItems();
  if (!installedItems) {
    throw new Error("This OMP version does not expose the verified `omp plugin list --json` schema.");
  }
  if (!(await supportsOmpPackageCommands())) {
    throw new Error("This OMP version does not advertise JSON package install and uninstall commands.");
  }
  let args: string[];
  if (mutation.action === "install") {
    const spec = normalizeOmpInstallSource(mutation.source);
    if (!spec) throw new Error("OMP installs accept an npm package name, optionally versioned, such as @scope/package@1.2.3.");
    args = ["plugin", "install", spec, "--json"];
  } else {
    const item = installedItems.items.find((candidate) => candidate.id === mutation.id);
    if (!item) throw new Error("The selected OMP npm package is not installed or is not listed by this OMP version.");
    args = ["plugin", "uninstall", item.id, "--json"];
  }
  await runNativeCli(resolveOmpBinary(), args);
  const refreshed = await ompItems();
  if (!refreshed) throw new Error("OMP changed package state, but its installed plugin list is no longer readable.");
  return { items: refreshed.items, installSource: "npm" as const };
});

const mutatePi = (mutation: NativeMarketplaceMutation) => serializePiMutation(async () => {
  const source = mutation.action === "install" ? mutation.source : mutation.id || mutation.source;
  if (!source || !(PI_NPM_SOURCE.test(source) || PI_GITHUB_SOURCE.test(source))) {
    throw new Error("Pi packages must use npm:<package> or an https://github.com/<owner>/<repo> source.");
  }
  if (mutation.action === "uninstall" && !(await piItems()).some((item) => item.id === source)) {
    throw new Error("The selected Pi package is not installed in the active agent directory.");
  }
  await runPi([mutation.action === "install" ? "install" : "remove", source]);
  return { items: await piItems(), installSource: "npm" as const };
});

const openCodeItems = async (): Promise<NativeMarketplaceItem[]> => {
  const skills: AgentSkillOption[] = await availableOpenCodeSkills(process.cwd(), homedir());
  return skills.map((skill) => ({
    id: skill.name,
    name: skill.displayName || skill.name,
    description: skill.description,
    kind: "skill",
    installed: true,
    required: skill.name.startsWith("drawsy-"),
    source: skill.path,
    actions: []
  }));
};

export const readNativeMarketplace = async (engine: AgentEngine): Promise<NativeMarketplaceResult> => {
  if (engine === "pi") return { items: await piItems(), installSource: "npm" };
  if (engine === "opencode") return { items: await openCodeItems() };
  if (engine === "omp") {
    const items = await ompItems();
    if (!items) return {
      items: [],
      note: "This OMP version does not expose the verified `omp plugin list --json` schema. Manage packages in OMP’s native CLI: https://github.com/can1357/oh-my-pi/blob/main/docs/marketplace.md"
    };
    const notes = items.marketplaceCount > 0
      ? ["OMP marketplace plugins are omitted from this npm package view; manage them in OMP’s native plugin manager."]
      : [];
    if (await supportsOmpPackageCommands()) return { items: items.items, installSource: "npm", ...(notes.length ? { note: notes.join(" ") } : {}) };
    notes.unshift("This OMP version can list installed plugins but does not advertise verified JSON install and uninstall commands.");
    return {
      items: items.items.map((item) => ({ ...item, actions: [] })),
      note: `${notes.join(" ")} Manage packages in OMP’s native CLI: https://github.com/can1357/oh-my-pi/blob/main/docs/marketplace.md`
    };
  }
  return {
    items: [],
    note: "DeepSeek Harness manages plugins through its native plugin panel or profile CLI; no structured installed-item schema is verified here. Manage plugins in DeepSeek Harness: https://deepseekdocs.com/en/docs/user-guide/plugins"
  };
};

export const mutateNativeMarketplace = async (
  engine: AgentEngine,
  mutation: NativeMarketplaceMutation
): Promise<NativeMarketplaceResult> => {
  if (engine !== "pi") {
    if (engine === "omp") return mutateOmp(mutation);
    throw new Error(`${engine} native marketplace changes are not exposed by Drawsy.`);
  }
  return mutatePi(mutation);
};
