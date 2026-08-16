import {
  app,
  dialog,
  Menu,
  nativeImage,
  Tray
} from "electron";
import path from "node:path";

import { createDrawsyBridge } from "../drawsy/bridge.js";
import { readLocalEngineStatus } from "../drawsy/engine-status.js";

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  const bridge = createDrawsyBridge({ host: "127.0.0.1" });
  let tray: Tray | null = null;
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

  const shutdown = async () => {
    if (closing) return;
    closing = true;
    tray?.destroy();
    tray = null;
    await bridge.close();
    app.exit(0);
  };

  const start = async () => {
    app.setAppUserModelId("ai.drawsy.companion");

    // Companion is deliberately user-launched. This also clears the login item
    // created by older builds that enabled automatic startup.
    if (process.platform === "darwin" || process.platform === "win32") {
      app.setLoginItemSettings({ openAtLogin: false });
    }

    await bridge.listen();
    tray = new Tray(trayImage);
    tray.setToolTip("Drawsy Companion");
    refreshMenu();
  };

  app.on("activate", () => {
    tray?.popUpContextMenu();
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
