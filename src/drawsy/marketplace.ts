import { loadBundledSkills } from "./codex-app-server.js";
import {
  readCodexMarketplace,
  mutateCodexMarketplace,
} from "./codex-marketplace.js";
import {
  readNativeMarketplace,
  mutateNativeMarketplace,
} from "./native-marketplace.js";
import type { AgentEngine } from "./protocol.js";

const requiredNames = new Set([
  "drawsy",
  "drawsy-browser-use",
  "drawsy-teaching-diagrams",
  "drawsy-fast-diagrams",
]);

export const readMarketplace = async (engine: AgentEngine) => {
  const bundled = await loadBundledSkills();
  const required = [
    {
      id: "drawsy",
      name: "Drawsy MCP",
      description:
        "Tools for the attached canvas, presentations, libraries, and connected Drawsy resources.",
      kind: "mcp",
      installed: true,
      enabled: true,
      required: true,
      actions: [],
    },
    ...bundled.map((skill) => ({
      id: skill.name,
      name: skill.displayName,
      description: skill.description,
      kind: "skill",
      installed: true,
      enabled: true,
      required: true,
      actions: [],
    })),
  ];
  const native =
    engine === "codex"
      ? await readCodexMarketplace()
      : await readNativeMarketplace(engine);
  return {
    ...native,
    items: [
      ...required,
      ...native.items.filter(
        (item) => !requiredNames.has(item.id) && !requiredNames.has(item.name)
      ),
    ],
  };
};

export const mutateMarketplace = async (
  engine: AgentEngine,
  input: { id?: string; action: string; source?: string; name?: string }
) => {
  if (input.id && requiredNames.has(input.id)) {
    throw new Error("Drawsy's included capabilities are required.");
  }
  if (engine === "codex") return mutateCodexMarketplace(input);
  if (input.action !== "install" && input.action !== "uninstall") {
    throw new Error(
      "This marketplace action is not supported by the selected harness."
    );
  }
  return mutateNativeMarketplace(engine, {
    id: input.id,
    action: input.action,
    source: input.source,
  });
};
