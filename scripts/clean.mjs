import { rm } from "node:fs/promises";

for (const directory of ["dist", "dist-test", "release"]) {
  await rm(directory, { recursive: true, force: true });
}
