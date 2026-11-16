import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { isRecord } from "./protocol.js";
import { spawnNativeCli, forceStopNativeCli } from "./native-cli.js";

type Rpc = Record<string, unknown>;
type RpcId = string | number;
const text = (value: unknown) => typeof value === "string" ? value : "";
const rec = (value: unknown): Rpc => isRecord(value) ? value : {};
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout | null };

const READY_TIMEOUT = 45_000;

export class StdioJsonRpcError extends Error {
  constructor(message: string, readonly code: number | undefined) {
    super(message);
  }
}
/** Newline-delimited JSON-RPC over a native subprocess. */
export class StdioJsonRpc {
  private child: ChildProcessWithoutNullStreams | null = null;
  private decoder = new StringDecoder("utf8");
  private buffer = "";
  private nextId = 1;
  private pending = new Map<string, Pending>();
  private closed = false;
  private failure: Error | null = null;
  private processGroupIsolated = false;
  private exitResolve!: (code: number | null) => void;
  readonly exited = new Promise<number | null>((resolve) => { this.exitResolve = resolve; });

  constructor(
    private readonly name: string,
    private readonly onNotification: (method: string, params: Rpc) => void,
    private readonly onRequest?: (id: RpcId, method: string, params: Rpc) => void
  ) {}

  start(binary: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; detached: boolean }) {
    this.processGroupIsolated = options.detached;
    const child = spawnNativeCli(binary, args, { cwd: options.cwd, env: options.env, stdio: "pipe", detached: options.detached, windowsHide: true });
    this.child = child;
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", (chunk: Buffer) => this.consume(this.decoder.write(chunk)));
    child.stderr.on("data", () => undefined);
    child.on("error", (error) => this.fail(error));
    child.on("close", (code) => { this.exitResolve(code); this.fail(new Error(`${this.name} exited (${code ?? "signal"}).`)); });
  }

  private consume(chunk: string) {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim(); this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: Rpc;
      try { message = rec(JSON.parse(line)); } catch { continue; }
      if (typeof message.method === "string" && (typeof message.id === "string" || typeof message.id === "number")) {
        if (this.onRequest) this.onRequest(message.id, message.method, rec(message.params));
        else void this.respond(message.id, { error: { code: -32601, message: "Method not found." } }).catch(() => undefined);
      } else if ("id" in message && ("result" in message || "error" in message)) {
        const key = String(message.id); const pending = this.pending.get(key); if (!pending) continue;
        this.pending.delete(key); if (pending.timer) clearTimeout(pending.timer);
        if (message.error) {
          const { message: detail, code } = rec(message.error);
          pending.reject(new StdioJsonRpcError(
            text(detail) || `${this.name} request failed.`,
            typeof code === "number" ? code : undefined
          ));
        } else pending.resolve(message.result);
      } else if (typeof message.method === "string") this.onNotification(message.method, rec(message.params));
    }
  }

  respond(id: RpcId, response: { result: Rpc } | { error: { code: number; message: string } }) {
    const child = this.child;
    if (!child || this.closed || child.stdin.destroyed) {
      return Promise.reject(new Error(`${this.name} session is closed.`));
    }
    return new Promise<void>((resolve, reject) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...response })}\n`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  request<T = Rpc>(method: string, params: Rpc = {}, timeoutMs = READY_TIMEOUT): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.child || this.closed) return Promise.reject(new Error(`${this.name} session is closed.`));
    const id = String(this.nextId++);
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.name} timed out during ${method}.`)); }, timeoutMs) : null;
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
        if (!error) return;
        if (timer) clearTimeout(timer); this.pending.delete(id); reject(error);
      });
    });
  }

  notify(method: string, params: Rpc) {
    if (!this.child || this.closed || this.failure) throw this.failure ?? new Error(`${this.name} session is closed.`);
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private fail(error: Error) {
    this.failure ??= error;
    for (const pending of this.pending.values()) { if (pending.timer) clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  async close() {
    if (this.closed) return;
    this.closed = true; this.fail(new Error(`${this.name} session closed.`));
    const child = this.child; this.child = null;
    if (!child || child.exitCode !== null) return;
    child.stdin.end();
    await Promise.race([this.exited, new Promise<void>((resolve) => setTimeout(resolve, 1_500))]);
    if (child.exitCode === null && child.pid) {
      try {
        if (this.processGroupIsolated && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else forceStopNativeCli(child);
      } catch { forceStopNativeCli(child); }
      await Promise.race([this.exited, new Promise<void>((resolve) => setTimeout(resolve, 1_500))]);
    }
  }
}
