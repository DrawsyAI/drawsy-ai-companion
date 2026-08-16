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
    await bridge.listen();
    tray = new Tray(trayImage);
    tray.setToolTip("Drawsy Companion");
    refreshMenu();

    if (process.platform === "darwin") app.dock?.hide();
    app.setLoginItemSettings({ openAtLogin: true });
  };

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
