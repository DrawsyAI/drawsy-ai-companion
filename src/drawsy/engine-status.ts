import { detectCodexBinary } from "./codex-binary.js";
import { detectOpenCodeBinary } from "./opencode-binary.js";
import { detectPiBinary } from "./pi-binary.js";
import { detectOmpBinary } from "./omp-binary.js";
import { detectDeepSeekBinary } from "./deepseek-binary.js";

export type LocalEngineStatus = {
  id: "codex" | "opencode" | "pi" | "omp" | "deepseek";
  name: string;
  installed: boolean;
  path?: string;
  version?: string;
};

export const readLocalEngineStatus = (): LocalEngineStatus[] => {
  const codex = detectCodexBinary();
  const openCode = detectOpenCodeBinary();
  const pi = detectPiBinary();
  const omp = detectOmpBinary();
  const deepSeek = detectDeepSeekBinary();
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
    },
    { id: "pi", name: "Pi", installed: Boolean(pi), ...(pi || {}) },
    { id: "omp", name: "Oh My Pi", installed: Boolean(omp), ...(omp || {}) },
    { id: "deepseek", name: "DeepSeek", installed: Boolean(deepSeek), ...(deepSeek || {}) }
  ];
};
