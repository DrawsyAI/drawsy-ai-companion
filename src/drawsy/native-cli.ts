import crossSpawn from "cross-spawn";
import type { ChildProcess, spawn, spawnSync } from "node:child_process";

// Keep Node's stdio overloads while supporting Windows npm command shims.
export const spawnNativeCli = crossSpawn as typeof spawn;
export const spawnNativeCliSync = crossSpawn.sync as typeof spawnSync;

export const forceStopNativeCli = (child: ChildProcess) => {
  if (process.platform === "win32" && child.pid && child.exitCode === null) {
    const result = spawnNativeCliSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 5_000
    });
    if (!result.error && result.status === 0) return;
  }
  child.kill("SIGKILL");
};
