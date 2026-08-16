import { detectCodexBinary } from "./codex-binary.js";
import { detectOpenCodeBinary } from "./opencode-binary.js";

export type LocalEngineStatus = {
  id: "codex" | "opencode";
  name: string;
  installed: boolean;
  path?: string;
  version?: string;
};

export const readLocalEngineStatus = (): LocalEngineStatus[] => {
  const codex = detectCodexBinary();
  const openCode = detectOpenCodeBinary();
  return [
    {
      id: "codex",
      name: "Codex",
      installed: Boolean(codex),
      ...(codex || {})
    },
    {
      id: "opencode",
      name: "OpenCode",
      installed: Boolean(openCode),
      ...(openCode || {})
    }
  ];
};
