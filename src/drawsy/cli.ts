#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, rm, stat, writeFile, open } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Console } from "node:console";
import { createWriteStream } from "node:fs";
import { createDrawsyBridge } from "./bridge.js";
import { readLocalEngineStatus } from "./engine-status.js";
import { enableAutostart, disableAutostart, autostartEnabled } from "./cli-autostart.js";
import { printDashboard, printHelp, startDrawsyIndicator } from "./cli-ui.js";

const directory = path.join(homedir(), ".drawsy-companion");
const lockDirectory = path.join(directory, "runtime.lock");
const recordPath = path.join(lockDirectory, "runtime.json");
const logPath = path.join(directory, "companion.log");
const entry = fileURLToPath(import.meta.url);
const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
type Runtime = { pid: number; port: number; token: string; version: string };

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
};

const readRuntime = async (): Promise<Runtime | null> => {
  try {
    const value: unknown = JSON.parse(await readFile(recordPath, "utf8"));
    if (!value || typeof value !== "object") throw new Error("Invalid runtime record.");
    const record = value as Runtime;
    if (!Number.isInteger(record.pid) || record.pid <= 0 || !Number.isInteger(record.port) || record.port <= 0 || record.port > 65535 || typeof record.token !== "string" || !/^[a-f0-9]{64}$/.test(record.token) || typeof record.version !== "string") throw new Error("Invalid runtime record.");
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

const control = async (operation: "status" | "stop") => {
  const record = await readRuntime();
  if (!record || !alive(record.pid)) return null;
  const response = await fetch(`http://127.0.0.1:${record.port}/${operation}`, {
    method: "POST", headers: { authorization: `Bearer ${record.token}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error("Could not authenticate the running CLI. No process was stopped.");
  const result = await response.json() as { service: string; version: string; pid: number };
  if (result.service !== "drawsy-companion-cli" || result.pid !== record.pid) throw new Error("Unexpected background process. No process was stopped.");
  return result;
};

const bridgePresent = async () => {
  try {
    const response = await fetch("http://127.0.0.1:3031/health", { signal: AbortSignal.timeout(1000) });
    const result = await response.json() as { service?: string; version?: string };
    return response.ok && result.service === "drawsy-ai-bridge" ? result : null;
  } catch { return null; }
};

type StatusOptions = {
  includeLinks?: boolean;
  animate?: boolean;
  hint?: string;
  missingState?: "starting" | "stopped";
};

const showStatus = async (options: StatusOptions = {}) => {
  const running = await control("status");
  const other = running ? null : await bridgePresent();
  const autostart = await autostartEnabled();
  const companion = running ? "running" : other ? "other" : options.missingState ?? "stopped";
  const hint = options.hint ?? (other
    ? "Quit the desktop app before starting CLI mode."
    : running
      ? autostart ? "Ready for Drawsy." : "Run drawsy-companion setup to keep it ready at sign-in."
      : companion === "starting"
        ? "Startup is enabled; run drawsy-companion status to check readiness."
        : "Run drawsy-companion setup to start now and at sign-in.");

  await printDashboard({
    version: manifest.version,
    companion,
    companionVersion: running?.version ?? other?.version,
    autostart,
    engines: readLocalEngineStatus(),
    includeLinks: options.includeLinks,
    hint,
  }, options.animate);
  return { running, other, autostart };
};

const acquire = async () => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try { await mkdir(lockDirectory, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // Called only after acquiring the fixed loopback listener: competing servers
    // cannot reach this cleanup concurrently.
    const record = await readRuntime();
    if (record && alive(record.pid)) throw new Error("Companion CLI is already running. Use drawsy-companion status.");
    const info = await stat(lockDirectory);
    if (!record && Date.now() - info.mtimeMs < 30_000) throw new Error("Companion is starting. Try again shortly.");
    await rm(lockDirectory, { recursive: true });
    await mkdir(lockDirectory, { mode: 0o700 });
  }
};

const serve = async (backgroundLog: boolean) => {
  let bridge: ReturnType<typeof createDrawsyBridge> | undefined;
  let closing = false;
  let ownsLock = false;
  const manager = createServer((request, response) => {
    if (request.headers.origin || request.method !== "POST" || request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403).end(); return;
    }
    if (request.url !== "/status" && request.url !== "/stop") { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ service: "drawsy-companion-cli", pid: process.pid, version: manifest.version }));
    if (request.url === "/stop") void shutdown();
  });
  const token = randomBytes(32).toString("hex");
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    let exitCode = 0;
    try { await bridge?.close(); }
    catch { exitCode = 1; }
    finally {
      await new Promise<void>((resolve) => manager.close(() => resolve()));
      if (ownsLock) await rm(lockDirectory, { recursive: true, force: true });
      process.exit(exitCode);
    }
  };
  try {
    if (await bridgePresent()) throw new Error("The desktop app or another Companion server is running. Quit it before starting the CLI.");
    // The distributed CLI always uses the production web origin policy and loopback.
    process.env.NODE_ENV = "production";
    bridge = createDrawsyBridge({ host: "127.0.0.1", port: 3031, version: manifest.version });
    await bridge.listen();
    await acquire();
    ownsLock = true;
    if (backgroundLog) {
      const output = createWriteStream(logPath, { flags: "a", mode: 0o600 });
      output.on("error", () => { process.stderr.write("Companion could not write its background log.\n"); });
      globalThis.console = new Console({ stdout: output, stderr: output });
    }
    await new Promise<void>((resolve, reject) => {
      manager.once("error", reject);
      manager.listen(0, "127.0.0.1", resolve);
    });
    const address = manager.address();
    if (!address || typeof address === "string") throw new Error("CLI control server could not start.");
    await writeFile(recordPath, JSON.stringify({ pid: process.pid, port: address.port, token, version: manifest.version }), { mode: 0o600 });
    process.once("SIGINT", () => { void shutdown(); });
    process.once("SIGTERM", () => { void shutdown(); });
    await printDashboard({
      version: manifest.version,
      companion: "running",
      companionVersion: manifest.version,
      engines: readLocalEngineStatus(),
      includeLinks: !backgroundLog,
      hint: backgroundLog ? `Local bridge ready at ${bridge.address}.` : "Press Ctrl+C to stop.",
    });
    process.send?.({ ready: true });
    process.disconnect?.();
  } catch (error) {
    // close also clears the bridge's timer when listen failed. Preserve the
    // original startup failure (including an occupied port) during cleanup.
    await bridge?.close().catch(() => undefined);
    manager.close();
    if (ownsLock) await rm(lockDirectory, { recursive: true, force: true });
    throw error;
  }
};

const start = async () => {
  const existing = await control("status");
  if (existing) {
    await showStatus({ includeLinks: true });
    return;
  }
  if (await bridgePresent()) throw new Error("The desktop app or another Companion server is running. Quit it first; this command will not replace it.");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const output = await open(logPath, "a", 0o600);
  const indicator = startDrawsyIndicator("Starting local Companion");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [entry, "serve"], {
        detached: true, windowsHide: true, cwd: homedir(),
        stdio: ["ignore", output.fd, output.fd, "ipc"],
      });
      const timer = setTimeout(() => {
        child.disconnect(); child.unref();
        reject(new Error("Startup is taking longer than expected. Check drawsy-companion status and logs."));
      }, 15_000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Companion exited (${code}). Run drawsy-companion logs.`)); });
      child.once("message", () => {
        clearTimeout(timer); child.unref(); resolve();
      });
    });
  } catch (error) {
    indicator.stop("Startup did not finish.");
    throw error;
  } finally { await output.close(); }
  indicator.stop("Local Companion started.");
  await showStatus({ includeLinks: true });
};

try {
  const [command = "welcome", option, ...extra] = process.argv.slice(2);
  if (extra.length || (option && command !== "autostart" && !(command === "serve" && option === "--background-log"))) throw new Error("Unexpected arguments. Use drawsy-companion help.");
  switch (command) {
    case "welcome":
      await showStatus({
        includeLinks: true,
        animate: true,
      });
      break;
    case "serve": await serve(option === "--background-log"); break;
    case "start": await start(); break;
    case "stop": {
      const running = await control("stop");
      if (running) {
        for (let attempt = 0; attempt < 50 && alive(running.pid); attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
        if (alive(running.pid)) throw new Error("Shutdown is still in progress. Check status before restarting.");
      }
      await showStatus({ hint: running ? "Companion CLI stopped." : "Companion CLI is not running." });
      break;
    }
    case "status": {
      await showStatus();
      break;
    }
    case "logs": {
      try {
        const file = await open(logPath, "r");
        try {
          const info = await file.stat();
          const buffer = Buffer.alloc(Math.min(info.size, 64 * 1024));
          const result = await file.read(buffer, 0, buffer.length, Math.max(0, info.size - buffer.length));
          process.stdout.write(buffer.subarray(0, result.bytesRead));
        } finally { await file.close(); }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        console.log("No background log yet. Foreground output appears in its terminal.");
      }
      break;
    }
    case "setup":
    case "autostart": {
      const action = command === "setup" ? "enable" : option;
      if (action === "disable") {
        await control("stop");
        await disableAutostart();
        await showStatus({ hint: "Startup at sign-in disabled." });
      } else if (action === "enable") {
        if (await autostartEnabled() && await control("status")) {
          await showStatus({ includeLinks: true, hint: "Ready at sign-in." });
          break;
        }
        if (await control("status") || await bridgePresent()) throw new Error("Stop Companion first, then run setup. Existing sessions will not be interrupted automatically.");
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const indicator = startDrawsyIndicator("Setting up sign-in startup");
        try {
          await enableAutostart(process.execPath, entry);
        } catch (error) {
          indicator.stop("Setup could not be completed.");
          throw error;
        }
        indicator.stop("Startup at sign-in enabled.");
        await showStatus({
          includeLinks: true,
          missingState: "starting",
        });
      } else throw new Error("Use autostart enable or autostart disable.");
      break;
    }
    case "help": case "--help": case "-h": await printHelp(manifest.version); break;
    case "--version": console.log(manifest.version); break;
    default: throw new Error(`Unknown command: ${command}. Use drawsy-companion help.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Companion could not complete this command.");
  process.exitCode = 1;
}
