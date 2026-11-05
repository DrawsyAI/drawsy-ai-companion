import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ExtensionApi = {
  registerTool(tool: Record<string, unknown>): void;
  registerMcpServer(name: string, config: Record<string, unknown>): void;
  getActiveTools(): string[];
  on(event: string, handler: (...args: any[]) => unknown): () => void;
};

const workspaceReadyMarker = process.env.DRAWSY_PI_ENGINE === "omp"
  ? "DRAWSY_OMP_WORKSPACE_READY"
  : "DRAWSY_PI_MCP_READY";
const workspaceTimeoutMarker = process.env.DRAWSY_PI_ENGINE === "omp"
  ? "DRAWSY_OMP_WORKSPACE_TIMEOUT"
  : "DRAWSY_PI_MCP_TIMEOUT";

export default function (pi: ExtensionApi) {
  const workspaceRoot = process.env.DRAWSY_PI_WORKSPACE_ROOT;
  const runtimePath = process.env.DRAWSY_PI_RUNTIME_PATH;
  const bridgeUrl = process.env.DRAWSY_BRIDGE_URL;
  const sessionId = process.env.DRAWSY_SESSION_ID;
  const sessionSecret = process.env.DRAWSY_SESSION_SECRET;
  const surfaceKind = process.env.DRAWSY_SURFACE_KIND;
  if (!workspaceRoot || !runtimePath || !bridgeUrl || !sessionId || !sessionSecret || !surfaceKind) {
    throw new Error("Drawsy session MCP configuration is missing.");
  }

  const mcpEnv: Record<string, string> = {
    DRAWSY_BRIDGE_URL: bridgeUrl,
    DRAWSY_SESSION_ID: sessionId,
    DRAWSY_SESSION_SECRET: sessionSecret,
    DRAWSY_WORKSPACE_ROOT: workspaceRoot,
    DRAWSY_SURFACE_KIND: surfaceKind
  };
  if (process.env.DRAWSY_PREVIEW_PORT) {
    mcpEnv.DRAWSY_PREVIEW_PORT = process.env.DRAWSY_PREVIEW_PORT;
  }
  const mcpEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "mcp.js");
  const ompHostTools = process.env.DRAWSY_PI_ENGINE === "omp";
  if (!ompHostTools) {
    pi.registerMcpServer("drawsy", {
      command: process.execPath,
      args: [mcpEntry],
      env: mcpEnv,
      cwd: workspaceRoot,
      exposure: "direct",
      description: "Drawsy tools for the attached session and canvas."
    });
  }

  pi.on("session_start", () => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const drawsyToolsReady = ompHostTools || pi.getActiveTools().some((name) => name.startsWith("mcp__drawsy__"));
      if (drawsyToolsReady) {
        clearInterval(timer);
        process.stderr.write(`${workspaceReadyMarker}\n`);
      } else if (Date.now() - startedAt > 30_000) {
        clearInterval(timer);
        process.stderr.write(`${workspaceTimeoutMarker}\n`);
      }
    }, 100);
    timer.unref?.();
  });

  let activeInstructions: string | null = null;
  pi.on("before_agent_start", async (event: any) => {
    const instructionPath = path.join(runtimePath, "turn-instructions.txt");
    if (activeInstructions === null) {
      activeInstructions = await readFile(instructionPath, "utf8").catch(() => "");
    }
    return activeInstructions
      ? { systemPrompt: `${event.systemPrompt}\n\n${activeInstructions}` }
      : undefined;
  });
  pi.on(ompHostTools ? "agent_end" : "agent_settled", async (event: { yielded?: boolean; isTerminal?: boolean }) => {
    if (ompHostTools && (event.yielded === false || event.isTerminal === false)) return;
    activeInstructions = null;
    await writeFile(path.join(runtimePath, "turn-instructions.txt"), "", { mode: 0o600 }).catch(() => undefined);
  });
}
