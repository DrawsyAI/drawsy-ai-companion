import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

type ChromeTarget = { targetId: string; type: string; title: string; url: string };
type ChromeResponse = { id?: number; result?: unknown; error?: unknown };
type Tab = { id: string; title: string; url: string };

const browserTabSetupMessage =
  'In Chrome, open chrome://inspect/#remote-debugging, enable remote debugging, and approve Chrome’s connection prompt. Click Browser Tab to retry.';

const chromeProfile = () => {
  switch (process.platform) {
    case "darwin":
      return path.join(homedir(), "Library/Application Support/Google/Chrome");
    case "win32":
      return path.join(process.env.LOCALAPPDATA || path.join(homedir(), "AppData/Local"), "Google/Chrome/User Data");
    default:
      return path.join(process.env.CHROME_CONFIG_HOME || process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "google-chrome");
  }
};

const openChromeSetup = () => {
  const url = "chrome://inspect/#remote-debugging";
  if (process.platform === "darwin") {
    execFile("open", ["-a", "Google Chrome", url], () => {});
  } else if (process.platform === "linux") {
    execFile("google-chrome", [url], () => {});
  } else if (process.platform === "win32") {
    const locations = [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]];
    for (const location of locations) {
      if (!location) continue;
      const executable = path.join(location, "Google/Chrome/Application/chrome.exe");
      if (existsSync(executable)) {
        execFile(executable, [url], () => {});
        break;
      }
    }
  }
};

export class BrowserTabs {
  private socket: WebSocket | undefined;
  private connecting: Promise<WebSocket> | undefined;
  private nextId = 0;
  private readonly selections = new WeakMap<object, Map<string, Tab>>();

  private readonly shutdown = new AbortController();

  private async debuggerUrl() {
    const file = path.join(chromeProfile(), "DevToolsActivePort");
    const readUrl = async () => {
      const activePort = await readFile(file, "utf8").catch(() => "");
      const [port, endpoint] = activePort.trim().split(/\r?\n/);
      return port && /^\d{1,5}$/.test(port) && Number(port) > 0 && Number(port) <= 65535 &&
        endpoint && /^\/devtools\/browser\/[\w-]+$/.test(endpoint)
        ? `ws://127.0.0.1:${port}${endpoint}`
        : null;
    };
    const existingUrl = await readUrl();
    if (existingUrl) return existingUrl;

    openChromeSetup();
    const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(60_000)]);
    while (!signal.aborted) {
      try {
        await delay(500, undefined, { signal });
      } catch {
        break;
      }
      const url = await readUrl();
      if (url) return url;
    }
    throw new Error(browserTabSetupMessage);
  }

  private async connect() {
    if (typeof WebSocket === "undefined") {
      throw new Error("Browser tabs require Node.js 22 or later.");
    }
    const url = await this.debuggerUrl();
    this.shutdown.signal.throwIfAborted();
    const socket = new WebSocket(url);
    return new Promise<WebSocket>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.shutdown.signal.removeEventListener("abort", fail);
        socket.removeEventListener("error", fail);
        socket.removeEventListener("close", fail);
      };
      const fail = () => {
        cleanup();
        socket.close();
        reject(new Error(browserTabSetupMessage));
      };
      const timer = setTimeout(fail, 60_000);
      this.shutdown.signal.addEventListener("abort", fail, { once: true });
      socket.addEventListener("error", fail, { once: true });
      socket.addEventListener("close", fail, { once: true });
      socket.addEventListener("open", () => {
        cleanup();
        this.socket = socket;
        socket.addEventListener("close", () => {
          if (this.socket === socket) this.socket = undefined;
        }, { once: true });
        resolve(socket);
      }, { once: true });
    });
  }

  private async command<T>(method: string, params = {}, sessionId?: string) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Chrome disconnected. Click Browser Tab to reconnect.");
    }
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("close", onClose);
      };
      const onClose = () => {
        cleanup();
        reject(new Error("Chrome disconnected. Click Browser Tab to reconnect."));
      };
      const onMessage = (event: MessageEvent<string>) => {
        let response: ChromeResponse;
        try {
          response = JSON.parse(event.data) as ChromeResponse;
        } catch {
          return;
        }
        if (response.id !== id) return;
        cleanup();
        if (response.error) reject(new Error("Chrome could not read the browser tab."));
        else resolve(response.result as T);
      };
      const timer = setTimeout(() => {
        socket.close();
        onClose();
      }, 5_000);
      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", onClose, { once: true });
      try {
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      } catch {
        onClose();
      }
    });
  }

  async list(session: object, requestAccess: boolean) {
    if (!requestAccess && !this.selections.has(session)) return null;
    try {
      const tabs = await this.listOpenTabs(requestAccess);
      const entries = tabs.map((tab) => ({
        id: createHash("sha256").update(JSON.stringify([tab.id, tab.url])).digest("hex"),
        tab
      }));
      this.selections.set(session, new Map(entries.map(({ id, tab }) => [id, tab])));
      return entries.map(({ id, tab }) => ({
        id,
        title: tab.title.trim().replace(/\s+/g, " ").slice(0, 140),
        host: new URL(tab.url).hostname
      }));
    } catch (error) {
      this.selections.delete(session);
      throw error;
    }
  }

  private async listOpenTabs(requestAccess: boolean): Promise<Tab[]> {
    if (requestAccess && (!this.socket || this.socket.readyState !== WebSocket.OPEN)) {
      this.connecting ??= this.connect().finally(() => { this.connecting = undefined; });
      await this.connecting;
    }
    const { targetInfos } = await this.command<{ targetInfos: ChromeTarget[] }>("Target.getTargets");
    return targetInfos
      .filter(({ type, url }) => type === "page" && /^https?:\/\//i.test(url))
      .map(({ targetId, title, url }) => ({ id: targetId, title, url }));
  }

  async snapshots(session: object, ids: string[]) {
    const selections = this.selections.get(session);
    const snapshots = [];
    for (const id of new Set(ids)) {
      const tab = selections?.get(id);
      if (!tab) throw new Error("Pick the browser tab again from the @ menu.");
      snapshots.push({
        title: tab.title.slice(0, 140),
        host: new URL(tab.url).hostname,
        text: await this.read(tab)
      });
    }
    return snapshots;
  }

  private async read(tab: Tab) {
    const { sessionId } = await this.command<{ sessionId: string }>(
      "Target.attachToTarget", { targetId: tab.id, flatten: true }
    );
    try {
      const { result } = await this.command<{ result: { value?: string } }>(
        "Runtime.evaluate",
        {
          expression: `location.href === ${JSON.stringify(tab.url)} ? document.body?.innerText.trim().slice(0, 8000) : null`,
          returnByValue: true
        },
        sessionId
      );
      if (typeof result.value !== "string") {
        throw new Error("The browser tab changed. Pick it again from the @ menu.");
      }
      return result.value;
    } finally {
      await this.command("Target.detachFromTarget", { sessionId }).catch(() => {});
    }
  }

  close() {
    this.shutdown.abort();
    this.socket?.close();
  }
}
