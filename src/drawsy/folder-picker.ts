import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

const runPicker = (command: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else if (code === 1) {
        reject(new Error("Folder selection was cancelled."));
      } else {
        reject(new Error(stderr.trim() || "Folder picker failed."));
      }
    });
  });

const pickerCommand = (): [string, string[]] => {
  if (process.platform === "darwin") {
    return [
      "osascript",
      [
        "-e",
        'POSIX path of (choose folder with prompt "Choose a folder for Drawsy AI")',
      ],
    ];
  }
  if (process.platform === "win32") {
    return [
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.SelectedPath)}else{exit 1}",
      ],
    ];
  }
  return [
    "zenity",
    [
      "--file-selection",
      "--directory",
      "--title=Choose a folder for Drawsy AI",
    ],
  ];
};

export const pickFolder = async () => {
  const defaultFolder =
    process.env.DRAWSY_WORKSPACE_FOLDER ||
    (process.env.NODE_ENV === "test"
      ? process.env.DRAWSY_TEST_FOLDER
      : undefined);
  const rawPath = defaultFolder ?? (await runPicker(...pickerCommand()));
  const folderPath = await realpath(rawPath);
  if (!(await stat(folderPath)).isDirectory()) {
    throw new Error("The selected path is not a folder.");
  }
  return { path: folderPath, name: path.basename(folderPath) || folderPath };
};
