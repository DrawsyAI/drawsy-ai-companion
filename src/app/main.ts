import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  Tray
} from "electron";
import path from "node:path";

import { createDrawsyBridge } from "../drawsy/bridge.js";
import { readLocalEngineStatus } from "../drawsy/engine-status.js";
import { normalizeFolder } from "../drawsy/folder-picker.js";

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  const nativeFolderPicker =
    process.platform === "win32" || process.platform === "linux"
      ? async () => {
          const configuredFolder = process.env.DRAWSY_WORKSPACE_FOLDER?.trim();
          if (configuredFolder) return normalizeFolder(configuredFolder);

          const result = await dialog.showOpenDialog({
            title: "Choose a folder for Drawsy AI",
            properties: ["openDirectory", "dontAddToRecent"]
          });
          if (result.canceled || !result.filePaths[0]) {
            throw new Error("Folder selection was cancelled.");
          }
          return normalizeFolder(result.filePaths[0]);
        }
      : undefined;
  const bridge = createDrawsyBridge({
    host: "127.0.0.1",
    folderPicker: nativeFolderPicker
  });
  let tray: Tray | null = null;
  let presenceWindow: BrowserWindow | null = null;
  let closing = false;

  const trayImage = nativeImage.createFromPath(
    path.join(app.getAppPath(), "build/icon.png")
  );

  const engineLabel = (name: string, installed: boolean, version?: string) =>
    `${name}: ${installed ? `available${version ? ` (${version})` : ""}` : "not found"}`;

  const refreshMenu = () => {
    if (!tray) return;
    const engines = readLocalEngineStatus();
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Drawsy Companion",
          enabled: false
        },
        {
          label: "Local bridge: http://127.0.0.1:3031",
          enabled: false
        },
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
      width: 360,
      height: 220,
      minWidth: 320,
      minHeight: 180,
      title: "Drawsy Companion",
      icon: path.join(app.getAppPath(), "build/icon.png"),
      show: false,
      skipTaskbar: false,
      autoHideMenuBar: true,
      backgroundColor: "#15131d",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    const statusPage = `<!doctype html>
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
            <p><code>http://127.0.0.1:3031</code></p>
            <p>Use the tray icon for engine status and quit.</p>
          </main>
        </body>
      </html>`;
    void presenceWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(statusPage)}`
    );
    presenceWindow.once("ready-to-show", () => {
      if (!presenceWindow || closing) return;
      presenceWindow.showInactive();
      presenceWindow.minimize();
    });
    presenceWindow.on("close", (event) => {
      if (closing) return;
      event.preventDefault();
      void shutdown();
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

    await bridge.listen();
    createPresenceWindow();
    tray = new Tray(trayImage);
    tray.setToolTip("Drawsy Companion");
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
