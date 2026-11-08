import nodePath from "node:path";
import { resolveControlIcon } from "./codex-app-server.js";
import { createHash } from "node:crypto";
import { isRecord } from "./protocol.js";
import { withCodexAppServer, type CodexRpc } from "./codex-rpc-client.js";
export type { CodexRpc } from "./codex-rpc-client.js";

export type CodexMarketplaceAction = "install" | "uninstall" | "enable" | "disable" | "add-mcp";
export type CodexMarketplaceItem = {
  id: string; name: string; description: string; kind: "plugin" | "skill" | "mcp";
  iconUrl?: string; iconUrlDark?: string;
  installed: boolean; enabled?: boolean; required: false; source?: string; actions?: CodexMarketplaceAction[];
};
export type CodexMarketplaceResult = { items: CodexMarketplaceItem[]; note?: string };

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 20);
const record = (value: unknown) => isRecord(value) ? value : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const protectedName = (value: string) => /(^|[^a-z0-9])drawsy([^a-z0-9]|$)/i.test(value);
const actionSet = (values: CodexMarketplaceAction[]) => values;

type NativeItem = { item: CodexMarketplaceItem; raw: Record<string, unknown>; marketplace: Record<string, unknown> };
type Catalog = { result: CodexMarketplaceResult; plugins: NativeItem[]; skills: NativeItem[]; mcps: NativeItem[] };

const readCatalog = async (rpc: CodexRpc, cwd?: string): Promise<Catalog> => {
  const [skillsResponse, pluginsResponse, mcpResponse, configResponse] = await Promise.all([
    rpc("skills/list", { cwds: cwd ? [cwd] : [] }),
    rpc("plugin/list", { cwds: cwd ? [cwd] : null, marketplaceKinds: ["local", "vertical", "workspace-directory", "shared-with-me", "created-by-me-remote"] }),
    rpc("mcpServerStatus/list", { limit: 100, detail: "toolsAndAuthOnly" }),
    rpc("config/read", cwd ? { cwd } : {})
  ]);
  const pluginItems: NativeItem[] = [];
  const marketplaces = Array.isArray(record(pluginsResponse).marketplaces) ? record(pluginsResponse).marketplaces as unknown[] : [];
  for (const marketplaceValue of marketplaces) {
    const marketplace = record(marketplaceValue);
    const entries = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
    for (const value of entries) {
      const plugin = record(value);
      if (typeof plugin.id !== "string" || typeof plugin.name !== "string") continue;
      const iface = record(plugin.interface);
      const installed = plugin.installed === true;
      const enabled = plugin.enabled === true;
      const available = plugin.availability === "AVAILABLE";
      const actions: CodexMarketplaceAction[] = installed
        ? enabled ? ["uninstall", "disable"] : ["uninstall", "enable"]
        : available && (typeof marketplace.path === "string" || typeof marketplace.name === "string") ? ["install"] : [];
      const source = text(record(plugin.source).type) || text(marketplace.name) || "Codex marketplace";
      const pluginRoot = record(plugin.source).type === "local"
        ? text(record(plugin.source).path) : "";
      const iconUrl = await resolveControlIcon({
        localPath: iface.composerIcon || iface.logo,
        remoteUrl: iface.composerIconUrl || iface.logoUrl,
        directory: pluginRoot
      });
      const iconUrlDark = await resolveControlIcon({
        localPath: iface.logoDark || iface.composerIcon || iface.logo,
        remoteUrl: iface.logoUrlDark || iface.composerIconUrl || iface.logoUrl,
        directory: pluginRoot
      });
      const item: CodexMarketplaceItem = {
        iconUrl, iconUrlDark,
        id: `plugin:${plugin.id}`, name: text(iface.displayName) || plugin.name,
        description: text(iface.shortDescription) || "Codex plugin", kind: "plugin",
        installed, enabled, required: false, source, actions: protectedName(plugin.name) ? [] : actions
      };
      pluginItems.push({ item, raw: plugin, marketplace });
    }
  }

  const skillItems: NativeItem[] = [];
  const data = Array.isArray(record(skillsResponse).data) ? record(skillsResponse).data as unknown[] : [];
  for (const entryValue of data) {
    const entry = record(entryValue);
    for (const value of Array.isArray(entry.skills) ? entry.skills : []) {
      const skill = record(value);
      if (typeof skill.name !== "string") continue;
      const path = text(skill.path);
      const enabled = skill.enabled === true;
      const id = `skill:${hash(`${skill.name}\0${path}`)}`;
      const actions: CodexMarketplaceAction[] = enabled ? ["disable"] : ["enable"];
      const iface = record(skill.interface);
      const iconUrl = await resolveControlIcon({
        localPath: iface.iconSmall,
        remoteUrl: iface.iconSmallUrl,
        directory: nodePath.dirname(path)
      });
      const item: CodexMarketplaceItem = {
        iconUrl,
        id, name: skill.name, description: text(skill.description) || "Codex skill", kind: "skill",
        installed: true, enabled, required: false, source: "Codex skill", actions: protectedName(skill.name) ? [] : actions
      };
      skillItems.push({ item, raw: skill, marketplace: entry });
    }
  }

  const mcpItems: NativeItem[] = [];
  const statuses = new Map<string, Record<string, unknown>>();
  for (const value of Array.isArray(record(mcpResponse).data) ? record(mcpResponse).data as unknown[] : []) {
    const status = record(value);
    if (typeof status.name === "string") statuses.set(status.name, status);
  }
  const configuredServers = record(record(record(configResponse).config).mcp_servers);
  for (const [name, configValue] of Object.entries(configuredServers)) {
    const server = record(configValue);
    if (name === "drawsy" || (typeof server.command !== "string" && typeof server.url !== "string")) continue;
    const status = statuses.get(name) ?? {};
    const enabled = server.enabled !== false;
    const item: CodexMarketplaceItem = {
      id: `mcp:${hash(name)}`, name,
      description: `${Object.keys(record(status.tools)).length} tools · ${text(status.authStatus) || "auth status unavailable"}`,
      kind: "mcp", installed: true, enabled, required: false, source: "Codex MCP configuration",
      actions: protectedName(name) ? [] : [enabled ? "disable" : "enable"]
    };
      mcpItems.push({ item, raw: { ...status, name }, marketplace: {} });
  }
  const items = [...pluginItems, ...skillItems, ...mcpItems].map(({ item }) => item);
  const errorCount = [skillsResponse, pluginsResponse, mcpResponse]
    .reduce<number>((count, response) => count + (Array.isArray(record(response).errors) ? (record(response).errors as unknown[]).length : 0), 0)
    + marketplaces.reduce<number>((count, marketplace) => count + (Array.isArray(record(marketplace).errors) ? (record(marketplace).errors as unknown[]).length : 0), 0);
  return {
    result: { items, ...(errorCount ? { note: `Some Codex marketplace entries could not be loaded (${errorCount}).` } : {}) },
    plugins: pluginItems, skills: skillItems, mcps: mcpItems
  };
};

export const readCodexMarketplace = async (cwd?: string): Promise<CodexMarketplaceResult> => {
  try {
    return await withCodexAppServer(async (rpc) => (await readCatalog(rpc, cwd)).result);
  } catch (error) {
    return { items: [], note: error instanceof Error ? error.message : "Codex marketplace is unavailable." };
  }
};

let mutationQueue: Promise<unknown> = Promise.resolve();
export const mutateCodexMarketplace = (input: { id?: string; action: string; source?: string; name?: string }, cwd?: string): Promise<CodexMarketplaceResult> => {
  const run = async () => withCodexAppServer(async (rpc) => {
    if ((!input.id || input.action === "add-mcp") && input.name && input.source) {
      return addCodexMcpServerWithRpc(rpc, { name: input.name, url: input.source }, cwd);
    }
    if (typeof input.id !== "string" || !["install", "uninstall", "enable", "disable"].includes(input.action)) {
      throw new Error("A current Codex marketplace item and supported action are required.");
    }
    return mutateCodexMarketplaceWithRpc(rpc, { id: input.id, action: input.action as Exclude<CodexMarketplaceAction, "add-mcp"> }, cwd);
  }, 120_000);
  const pending = mutationQueue.then(run, run);
  mutationQueue = pending.then(() => undefined, () => undefined);
  return pending;
};

export const addCodexMcpServer = (input: { name: string; url: string }, cwd?: string): Promise<CodexMarketplaceResult> => {
  const run = async () => withCodexAppServer((rpc) => addCodexMcpServerWithRpc(rpc, input, cwd), 120_000);
  const pending = mutationQueue.then(run, run);
  mutationQueue = pending.then(() => undefined, () => undefined);
  return pending;
};

export const addCodexMcpServerWithRpc = async (rpc: CodexRpc, input: { name: string; url: string }, cwd?: string): Promise<CodexMarketplaceResult> => {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(input.name) || protectedName(input.name) || input.name === "drawsy") {
      throw new Error("Choose a server name using 1–64 letters, numbers, underscores, or hyphens; Drawsy is reserved.");
    }
    let endpoint: URL;
    try { endpoint = new URL(input.url); } catch { throw new Error("Enter a valid HTTPS MCP URL."); }
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) {
      throw new Error("MCP endpoints must use HTTPS and cannot include credentials or fragments.");
    }
    const configResponse = await rpc("config/read", cwd ? { cwd } : {});
    const current = record(record(record(configResponse).config).mcp_servers);
    if (Object.hasOwn(current, input.name)) throw new Error("A Codex MCP server already uses that name.");
    await rpc("config/value/write", {
      keyPath: `mcp_servers.${JSON.stringify(input.name)}`,
      value: { url: endpoint.toString(), enabled: true }, mergeStrategy: "replace"
    });
    return (await readCatalog(rpc, cwd)).result;
};

export const mutateCodexMarketplaceWithRpc = async (
  rpc: CodexRpc, input: { id: string; action: CodexMarketplaceAction }, cwd?: string
): Promise<CodexMarketplaceResult> => {
  const catalog = await readCatalog(rpc, cwd);
  const candidates = [...catalog.plugins, ...catalog.skills, ...catalog.mcps];
  const found = candidates.find(({ item }) => item.id === input.id);
  if (!found || !found.item.actions?.includes(input.action)) throw new Error("This Codex marketplace action is no longer available.");
  if (protectedName(found.item.name)) throw new Error("Drawsy marketplace entries are managed by Drawsy and cannot be changed here.");

  if (input.action === "add-mcp") throw new Error("Use addCodexMcpServer to add a Codex MCP endpoint.");
  if (found.item.kind === "plugin") {
    if (input.action === "install") {
      const marketplace = found.marketplace;
      const marketplaceIdentity = typeof marketplace.path === "string"
        ? { marketplacePath: marketplace.path }
        : { remoteMarketplaceName: text(marketplace.name) };
      await rpc("plugin/install", { pluginName: found.raw.name, ...marketplaceIdentity });
    } else if (input.action === "uninstall") {
      await rpc("plugin/uninstall", { pluginId: found.raw.id });
    } else {
      await rpc("config/value/write", {
        keyPath: `plugins.${JSON.stringify(String(found.raw.id))}.enabled`, value: input.action === "enable", mergeStrategy: "replace"
      });
    }
  } else if (found.item.kind === "skill") {
    await rpc("skills/config/write", {
      name: found.raw.name, path: typeof found.raw.path === "string" ? found.raw.path : null,
      enabled: input.action === "enable"
    });
  } else {
    const configResponse = await rpc("config/read", cwd ? { cwd } : {});
    const servers = record(record(configResponse).config).mcp_servers;
    const current = record(record(servers)[text(found.raw.name)]);
    if (typeof current.command !== "string" && typeof current.url !== "string") throw new Error("The native MCP transport is missing; refusing to overwrite its configuration.");
    await rpc("config/value/write", {
        keyPath: `mcp_servers.${JSON.stringify(text(found.raw.name))}.enabled`, value: input.action === "enable", mergeStrategy: "replace"
    });
  }
  return (await readCatalog(rpc, cwd)).result;
};

/** Native connection metadata only. Authentication remains in Codex/ChatGPT. */
export const readCodexPluginDetailsWithRpc = async (rpc: CodexRpc, id: string) => {
  const catalog = await readCatalog(rpc);
  const entry = catalog.plugins.find(({ item }) => item.id === id && item.installed);
  if (!entry) throw new Error("This installed Codex plugin is no longer available.");
  const marketplace = entry.marketplace;
  const response = record(await rpc("plugin/read", {
    pluginName: entry.raw.name,
    ...(typeof marketplace.path === "string"
      ? { marketplacePath: marketplace.path }
      : { remoteMarketplaceName: text(marketplace.name) })
  }));
  const plugin = record(response.plugin);
  const runtime = record(await rpc("app/installed", { forceRefresh: true }));
  const apps = Array.isArray(runtime.apps) ? runtime.apps.map(record) : [];
  const connections = (Array.isArray(plugin.apps) ? plugin.apps : []).flatMap((value) => {
    const app = record(value);
    if (typeof app.id !== "string") return [];
    const state = apps.find((candidate) => candidate.id === app.id);
    let url: string | undefined;
    try {
      const parsed = new URL(text(app.installUrl));
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password) url = parsed.toString();
    } catch {}
    const name = text(app.name);
    return [{
      id: app.id,
      name: !name || name === app.id ? entry.item.name : name,
      callable: state?.callable === true,
      enabled: typeof state?.enabled === "boolean" ? state.enabled : undefined,
      url
    }];
  });
  return {
    name: entry.item.name,
    skills: (Array.isArray(plugin.skills) ? plugin.skills : [])
      .flatMap((skill) => typeof record(skill).name === "string" ? [String(record(skill).name)] : []),
    connections,
    mcpServers: (Array.isArray(plugin.mcpServers) ? plugin.mcpServers : [])
      .filter((name): name is string => typeof name === "string")
  };
};

export const readCodexPluginDetails = (id: string) =>
  withCodexAppServer((rpc) => readCodexPluginDetailsWithRpc(rpc, id), 30_000);
