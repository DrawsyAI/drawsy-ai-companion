import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourcePackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(sourcePackage.version)) {
  throw new Error("package.json must contain a release version.");
}

const output = path.join(root, "release", "cli");
const stage = await mkdtemp(path.join(os.tmpdir(), "drawsy-companion-cli-"));
try {
  await mkdir(output, { recursive: true });
  await cp(path.join(root, "dist", "drawsy"), path.join(stage, "dist", "drawsy"), {
    recursive: true,
    filter: (source) => !source.endsWith(".map") && !source.endsWith(".test.js")
  });
  await cp(path.join(root, "skills"), path.join(stage, "skills"), { recursive: true });
  await cp(path.join(root, "LICENSE"), path.join(stage, "LICENSE"));
  await cp(path.join(root, "docs", "cli-install.md"), path.join(stage, "README.md"));

  const manifest = {
    name: sourcePackage.name,
    version: sourcePackage.version,
    private: false,
    type: "module",
    description: "Drawsy's local Companion server and background command-line controls",
    license: sourcePackage.license,
    author: sourcePackage.author,
    repository: {
      type: "git",
      url: "git+https://github.com/DrawsyAI/drawsy-ai-companion.git"
    },
    homepage: "https://github.com/DrawsyAI/drawsy-ai-companion",
    bugs: { url: "https://github.com/DrawsyAI/drawsy-ai-companion/issues" },
    engines: { node: ">=22" },
    bin: {
      "drawsy-companion": "dist/drawsy/cli.js",
      "drawsy-ai-mcp": "dist/drawsy/mcp.js"
    },
    files: ["dist/drawsy", "skills", "LICENSE", "README.md"],
    dependencies: sourcePackage.dependencies
  };
  await writeFile(path.join(stage, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await chmod(path.join(stage, "dist", "drawsy", "cli.js"), 0o755);
  await chmod(path.join(stage, "dist", "drawsy", "mcp.js"), 0o755);

  const result = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json"], {
    cwd: stage,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  }));
  if (result.length !== 1 || path.basename(result[0].filename) !== result[0].filename) {
    throw new Error("npm pack did not return one package filename.");
  }
  const filename = result[0].filename;
  const archive = await readFile(path.join(stage, filename));
  const checksum = createHash("sha256").update(archive).digest("hex");
  await writeFile(path.join(output, filename), archive);
  await writeFile(path.join(output, "CLI-SHA256SUMS"), `${checksum}  ${filename}\n`);
  console.log(`CLI package: release/cli/${filename}`);
  console.log(`SHA256: ${checksum}`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
