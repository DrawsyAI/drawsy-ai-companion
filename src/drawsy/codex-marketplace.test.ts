import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { addCodexMcpServerWithRpc, mutateCodexMarketplaceWithRpc, readCodexPluginDetailsWithRpc } from "./codex-marketplace.js";
import type { CodexRpc } from "./codex-rpc-client.js";

const fixture = () => {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  let installed = false;
  let enabled = false;
  let mcpEnabled = true;
  let dottedMcpEnabled = true;
  const rpc: CodexRpc = async (method, params) => {
    calls.push({ method, params });
    if (method === "skills/list") return { data: [{ skills: [{ name: "notes", description: "Notes", path: "/private/notes/SKILL.md", enabled: true }] }] };
    if (method === "plugin/list") return { marketplaces: [{ name: "local", path: "/private/plugins", plugins: [
      { id: "sample@local", name: "sample", installed, enabled, availability: "AVAILABLE", source: { type: "local", path: "/private/plugin" }, interface: { shortDescription: "Sample", composerIconUrl: "https://icons.example/sample.png", logoUrlDark: "https://icons.example/sample-dark.png" } }
    ] }] };
    if (method === "mcpServerStatus/list") return { data: [{ name: "custom", tools: { find: {} }, authStatus: "authorized" }, { name: "foo.bar", tools: {}, authStatus: "unknown" }] };
    if (method === "config/read") return { config: { mcp_servers: {
      custom: { url: "https://mcp.example/sse", enabled: mcpEnabled, headers: { Authorization: "secret" } },
      "foo.bar": { url: "https://dotted.example/sse", enabled: dottedMcpEnabled, headers: { Authorization: "other-secret" } }
    } } };
    if (method === "plugin/install") { installed = true; enabled = true; return {}; }
    if (method === "plugin/uninstall") { installed = false; enabled = false; return {}; }
    if (method === "skills/config/write") return {};
    if (method === "config/value/write") {
      if (params?.keyPath === 'mcp_servers."foo.bar".enabled') dottedMcpEnabled = params?.value === true;
      else if (String(params?.keyPath).endsWith(".enabled")) mcpEnabled = params?.value === true;
      return {};
    }
    return {};
  };
  return { rpc, calls };
};

test("catalog exposes canonical installed state without config credentials or local paths", async () => {
  const { rpc } = fixture();
  await assert.rejects(() => mutateCodexMarketplaceWithRpc(rpc, { id: "skill:invalid", action: "enable" }), /no longer available/);
});

test("native plugin installation resolves the catalog item and uses app-server install", async () => {
  const { rpc, calls } = fixture();
  const result = await mutateCodexMarketplaceWithRpc(rpc, { id: "plugin:sample@local", action: "install" });
  assert.equal(calls.some((call) => call.method === "plugin/install" && call.params?.pluginName === "sample"), true);
  assert.equal(result.items.find((item) => item.id === "plugin:sample@local")?.installed, true);
  assert.equal(result.items.find((item) => item.id === "plugin:sample@local")?.iconUrl, "https://icons.example/sample.png");
  assert.equal(result.items.find((item) => item.id === "plugin:sample@local")?.iconUrlDark, "https://icons.example/sample-dark.png");
  assert.equal(JSON.stringify(result).includes("/private"), false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("partial marketplace errors are surfaced with a concise count", async () => {
  const { rpc: base } = fixture();
  const rpc: CodexRpc = async (method, params) => {
    const result = await base(method, params);
    if (method !== "plugin/list" || !result || typeof result !== "object") return result;
    const response = result as Record<string, unknown>;
    const marketplaces = response.marketplaces as Array<Record<string, unknown>>;
    return { ...response, errors: ["remote unavailable"], marketplaces: marketplaces.map((marketplace) => ({ ...marketplace, errors: ["one plugin failed"] })) };
  };
  const result = await mutateCodexMarketplaceWithRpc(rpc, { id: "plugin:sample@local", action: "install" });
  assert.equal(result.note, "Some Codex marketplace entries could not be loaded (2).");
});

test("MCP toggle quotes dotted server names and changes only enabled while keeping auth config private", async () => {
  const { rpc, calls } = fixture();
  const id = `mcp:${createHash("sha256").update("foo.bar").digest("hex").slice(0, 20)}`;
  const result = await mutateCodexMarketplaceWithRpc(rpc, { id, action: "disable" });
  const write = calls.find((call) => call.method === "config/value/write");
  assert.deepEqual(write?.params, { keyPath: 'mcp_servers."foo.bar".enabled', value: false, mergeStrategy: "replace" });
  assert.equal(result.items.find((item) => item.id === id)?.enabled, false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("MCP URL addition validates endpoint and never overwrites a configured name", async () => {
  const { rpc, calls } = fixture();
  const before = calls.length;
  await assert.rejects(() => addCodexMcpServerWithRpc(rpc, { name: "safe", url: "http://mcp.example" }), /HTTPS/);
  assert.equal(calls.length, before);
  await assert.rejects(() => addCodexMcpServerWithRpc(rpc, { name: "custom", url: "https://mcp.example/sse" }), /already uses/);
  await assert.rejects(() => addCodexMcpServerWithRpc(rpc, { name: "unsafe", url: "https://user:pass@mcp.example/sse" }), /credentials/);
});


test("an installed plugin does not claim a missing app connector is callable", async () => {
  const { rpc } = fixture();
  await mutateCodexMarketplaceWithRpc(rpc, { id: "plugin:sample@local", action: "install" });
  const detailsRpc: CodexRpc = async (method, params) => {
    if (method === "plugin/read") return { plugin: {
      apps: [{ id: "adobe-app", name: "Adobe", installUrl: "https://chatgpt.com/apps/adobe/adobe-app" }],
      skills: [{ name: "edit-photos" }], mcpServers: []
    } };
    if (method === "app/installed") return { apps: [] };
    return rpc(method, params);
  };
  const details = await readCodexPluginDetailsWithRpc(detailsRpc, "plugin:sample@local");
  assert.deepEqual(details.connections, [{
    id: "adobe-app", name: "Adobe", callable: false, enabled: undefined,
    url: "https://chatgpt.com/apps/adobe/adobe-app"
  }]);
  assert.deepEqual(details.skills, ["edit-photos"]);
  assert.equal(JSON.stringify(details).includes("/private"), false);
  await assert.rejects(
    readCodexPluginDetailsWithRpc(detailsRpc, "plugin:absent"), /no longer available/
  );
});
