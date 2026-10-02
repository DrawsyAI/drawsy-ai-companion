import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type DrawsyEnvironmentMode = "development" | "production";

export const loadDrawsyEnvironment = (
  options: {
    mode?: string;
    root?: string;
    loadFile?: boolean;
  } = {}
): DrawsyEnvironmentMode => {
  const mode = options.mode ?? process.env.NODE_ENV ?? "development";
  if (mode !== "development" && mode !== "production") {
    throw new Error("NODE_ENV must be development or production.");
  }
  const root = options.root ?? fileURLToPath(new URL("../../", import.meta.url));
  const envFile = path.join(root, `.env.${mode}`);
  // Native loading preserves values already supplied by the parent process.
  if (options.loadFile !== false && existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
  process.env.NODE_ENV ??= mode;
  return mode;
};
