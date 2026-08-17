import { build } from "esbuild";

await build({
  entryPoints: ["src/drawsy/mcp.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist/drawsy/mcp.js",
  logLevel: "info"
});
