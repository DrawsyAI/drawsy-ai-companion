import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  shell,
  Tray
} from "electron";
import type { OpenDialogOptions } from "electron";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createWindowsStatusPage, DRAWSY_URL, windowsStatus } from "./status-window.js";

import { createDrawsyBridge } from "../drawsy/bridge.js";
import { loadDrawsyEnvironment } from "../drawsy/environment.js";

const environmentMode = loadDrawsyEnvironment({
  mode: app.isPackaged ? "production" : process.env.NODE_ENV ?? "development",
  loadFile: !app.isPackaged
});
import { readLocalEngineStatus } from "../drawsy/engine-status.js";
import { normalizeFolder } from "../drawsy/folder-picker.js";

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  let presenceWindow: BrowserWindow | null = null;

  const folderPreferencesPath = () =>
    path.join(app.getPath("userData"), "folder-preferences.json");

  const readLastFolder = async () => {
    try {
      const value = JSON.parse(
        await readFile(folderPreferencesPath(), "utf8")
      ) as { lastFolder?: unknown };
      if (typeof value.lastFolder !== "string" || !value.lastFolder.trim()) {
        return undefined;
      }
      const details = await stat(value.lastFolder);
      return details.isDirectory() ? value.lastFolder : undefined;
    } catch {
      return undefined;
    }
  };

  const rememberFolder = async (folderPath: string) => {
    try {
      await mkdir(app.getPath("userData"), { recursive: true });
      await writeFile(
        folderPreferencesPath(),
        `${JSON.stringify({ lastFolder: folderPath })}\n`,
        { encoding: "utf8", mode: 0o600 }
      );
    } catch (error) {
      console.warn("Drawsy Companion could not remember the selected folder.", error);
    }
  };

  const nativeFolderPicker =
    process.platform === "win32" || process.platform === "linux"
      ? async () => {
          const configuredFolder = process.env.DRAWSY_WORKSPACE_FOLDER?.trim();
          if (configuredFolder) return normalizeFolder(configuredFolder);

          const parentWindow =
            presenceWindow && !presenceWindow.isDestroyed()
              ? presenceWindow
              : undefined;
          const wasMinimized = parentWindow?.isMinimized() ?? false;
          if (parentWindow) {
            if (wasMinimized) parentWindow.restore();
            parentWindow.show();
            parentWindow.focus();
          }

          try {
            const pickerOptions: OpenDialogOptions = {
              title: "Choose a folder for Drawsy AI",
              defaultPath: (await readLastFolder()) ?? app.getPath("documents"),
              buttonLabel: "Choose Folder",
              properties: ["openDirectory", "dontAddToRecent"]
            };
            const result = parentWindow
              ? await dialog.showOpenDialog(parentWindow, pickerOptions)
              : await dialog.showOpenDialog(pickerOptions);
            if (result.canceled || !result.filePaths[0]) {
              throw new Error("Folder selection was cancelled.");
            }
            const folder = await normalizeFolder(result.filePaths[0]);
            await rememberFolder(folder.path);
            return folder;
          } finally {
            if (wasMinimized && parentWindow && !parentWindow.isDestroyed()) {
              parentWindow.minimize();
            }
          }
        }
      : undefined;
  const bridge = createDrawsyBridge({
    host: "127.0.0.1",
    allowedOrigins:
      environmentMode === "production" && !process.env.DRAWSY_ALLOWED_ORIGINS
        ? ["https://drawsyai.com"]
        : undefined,
    folderPicker: nativeFolderPicker,
    version: app.getVersion()
  });
  let tray: Tray | null = null;
  let closing = false;
  let bridgeRunning = false;

  const refreshWindowStatus = (engines?: ReturnType<typeof readLocalEngineStatus>) => {
    if (process.platform !== "win32" || !presenceWindow || presenceWindow.webContents.isLoading()) return;
    const statuses = windowsStatus(engines ?? readLocalEngineStatus(), bridgeRunning);
    void presenceWindow.webContents.executeJavaScript(`
      for (const status of ${JSON.stringify(statuses)}) {
        const element = document.getElementById(status.id);
        if (element) {
          if (element.textContent !== status.text) element.textContent = status.text;
          element.dataset.available = String(status.available);
        }
      }
    `).catch((error) => console.warn("Could not refresh Companion status.", error));
  };

  const trayImage = nativeImage.createFromPath(
    path.join(app.getAppPath(), "build/icon.png")
  );

  const engineLabel = (name: string, installed: boolean, version?: string) =>
    `${name}: ${installed ? `available${version ? ` (${version})` : ""}` : "not found"}`;

  const refreshMenu = () => {
    if (!tray) return;
    const engines = readLocalEngineStatus();
    refreshWindowStatus(engines);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Drawsy Companion",
          enabled: false
        },
        {
          label: `Local bridge: ${bridge.address}`,
          enabled: false
        },
        {
          label: `Version: ${app.getVersion()}`,
          enabled: false
        },
        {
          label: `Connectors: ${bridge.connectorRouting}`,
          enabled: false
        },
        ...(process.platform === "darwin"
          ? []
          : [
              {
                label: "Open status window",
                click: showPresenceWindow
              }
            ]),
        { type: "separator" },
        ...engines.map((engine) => ({
          label: engineLabel(engine.name, engine.installed, engine.version),
          enabled: false
        })),
        { type: "separator" },
        {
          label: "Refresh engine status",
          click: refreshMenu
        },
        {
          label: "Quit Drawsy Companion",
          click: () => {
            void shutdown();
          }
        }
      ])
    );
  };

  const showPresenceWindow = () => {
    if (!presenceWindow) return;
    if (presenceWindow.isMinimized()) presenceWindow.restore();
    presenceWindow.show();
    presenceWindow.focus();
    refreshWindowStatus();
  };

  const shutdown = async () => {
    if (closing) return;
    closing = true;
    tray?.destroy();
    tray = null;
    presenceWindow?.destroy();
    presenceWindow = null;
    await bridge.close();
    app.exit(0);
  };

  const createPresenceWindow = () => {
    if (process.platform === "darwin" || presenceWindow) return;

    presenceWindow = new BrowserWindow({
      width: process.platform === "win32" ? 560 : 360,
      height: process.platform === "win32" ? 580 : 220,
      minWidth: 320,
      minHeight: process.platform === "win32" ? 500 : 180,
      title: process.platform === "win32" ? "DrawsyAI Companion" : "Drawsy Companion",
      icon: path.join(app.getAppPath(), "build/icon.png"),
      show: false,
      skipTaskbar: true,
      autoHideMenuBar: true,
      backgroundColor: process.platform === "win32" ? "#fbfafc" : "#15131d",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    const statusPage = process.platform === "win32"
      ? createWindowsStatusPage(app.getVersion(), readFileSync(path.join(app.getAppPath(), "build/companion-connection.svg"), "utf8"))
      : `<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Drawsy Companion</title>
          <style>
            :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
            body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #15131d; color: #f4f1fa; }
            main { width: 100%; box-sizing: border-box; padding: 28px; }
            h1 { margin: 0 0 10px; font-size: 21px; }
            p { margin: 6px 0; color: #bcb5ca; font-size: 14px; }
            code { color: #d7c8ff; }
          </style>
        </head>
        <body>
          <main>
            <h1>Drawsy Companion</h1>
            <p>Local bridge is running.</p>
            <p><code>${bridge.address}</code></p>
            <p>Version: <code>${app.getVersion()}</code></p>
            <p>Connectors: <code>${bridge.connectorRouting}</code></p>
            <p>Use the tray icon for engine status and quit.</p>
          </main>
        </body>
      </html>`;
    if (process.platform === "win32") {
      const openDrawsy = () => {
        void shell.openExternal(DRAWSY_URL).catch((error) => {
          console.warn("Could not open Drawsy in the browser.", error);
          void presenceWindow?.webContents.executeJavaScript(
            `document.getElementById('browser-caption').textContent = 'Could not open your browser. Please try again.'`
          ).catch(() => {});
        });
      };
      presenceWindow.webContents.on("will-navigate", (event, url) => {
        event.preventDefault();
        if (url === DRAWSY_URL || url === `${DRAWSY_URL}/`) openDrawsy();
      });
      presenceWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      presenceWindow.webContents.on("did-finish-load", () => refreshWindowStatus());
      presenceWindow.once("ready-to-show", showPresenceWindow);
    }
    void presenceWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(statusPage)}`
    );
    presenceWindow.on("close", (event) => {
      if (closing) return;
      event.preventDefault();
      presenceWindow?.hide();
    });
    presenceWindow.on("closed", () => {
      presenceWindow = null;
    });
  };

  const start = async () => {
    app.setAppUserModelId("ai.drawsy.companion");

    // Companion is deliberately user-launched. This also clears the login item
    // created by older builds that enabled automatic startup.
    if (process.platform === "darwin" || process.platform === "win32") {
      app.setLoginItemSettings({ openAtLogin: false });
    }

    createPresenceWindow();
    await bridge.listen();
    bridgeRunning = true;
    if (process.platform === "win32") {
      refreshWindowStatus();
    }
    tray = new Tray(trayImage);
    tray.setToolTip("Drawsy Companion");
    if (process.platform !== "darwin") {
      tray.on("click", showPresenceWindow);
    }
    refreshMenu();
  };

  app.on("activate", () => {
    if (process.platform === "darwin") {
      tray?.popUpContextMenu();
    } else {
      showPresenceWindow();
    }
  });

  app.on("second-instance", () => {
    if (process.platform !== "darwin") {
      showPresenceWindow();
    }
  });

  if (process.platform !== "darwin") {
    app.on("window-all-closed", () => {
      // The tray icon owns the application lifetime on Windows and Linux.
    });
  }

  app.on("before-quit", (event) => {
    if (closing) return;
    event.preventDefault();
    void shutdown();
  });

  void app.whenReady().then(start).catch(async (error) => {
    await dialog.showMessageBox({
      type: "error",
      title: "Drawsy Companion could not start",
      message: error instanceof Error ? error.message : String(error)
    });
    app.exit(1);
  });
}
