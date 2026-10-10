import { execFile } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const label = "ai.drawsy.companion.cli";
const unit = "drawsy-companion-cli.service";
const stateDirectory = join(homedir(), ".drawsy-companion");
const plistPath = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
const unitDirectory = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "systemd", "user");
const unitPath = join(unitDirectory, unit);

async function run(command: string, args: string[]): Promise<string> {
  try {
    const result = await execute(command, args, { windowsHide: true, timeout: 30_000 });
    return result.stdout.trim();
  } catch (error) {
    const details = error as NodeJS.ErrnoException & { stderr?: string };
    throw new Error(`Cannot manage Companion startup: ${details.stderr?.trim() || details.message}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function powershellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Windows command-line quoting, independent of PowerShell string quoting.
function windowsArgument(value: string): string {
  return `"${value.replace(/(\\*)"/g, "$1$1\\\"").replace(/\\+$/g, "$&$&")}"`;
}

function unitArgument(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    .replace(/%/g, "%%").replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;
}

async function powershell(script: string): Promise<string> {
  return run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(`$ErrorActionPreference = 'Stop'; ${script}`, "utf16le").toString("base64")]);
}

const taskIdentity = "$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent(); " +
  "$taskName = 'DrawsyCompanion-CLI-' + $identity.User.Value; ";

function launchDomain(): string {
  if (!process.getuid || process.getuid() === 0) {
    throw new Error("Run Companion setup as your signed-in user, without sudo.");
  }
  return `gui/${process.getuid()}`;
}

async function requireSystemd(): Promise<void> {
  if (process.getuid?.() === 0) {
    throw new Error("Run Companion setup as your signed-in user, without sudo.");
  }
  try {
    await run("systemctl", ["--user", "show-environment"]);
  } catch {
    throw new Error("Automatic startup requires a working systemd user session. You can still use Companion start or serve manually.");
  }
}

/** Register and start the CLI for the signed-in user, without administrator access. */
export async function enableAutostart(nodeExecutable: string, cliEntry: string): Promise<void> {
  if (!isAbsolute(nodeExecutable) || !isAbsolute(cliEntry) || /[\0\r\n]/.test(nodeExecutable + cliEntry)) {
    throw new Error("Startup requires absolute Node and Companion paths without control characters.");
  }
  await access(nodeExecutable);
  await access(cliEntry);
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });

  if (process.platform === "darwin") {
    const domain = launchDomain();
    await mkdir(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
    // Replace only our existing registration. A missing loaded job is normal after logout.
    if (await exists(plistPath)) {
      const loaded = await execute("/bin/launchctl", ["print", `${domain}/${label}`], { timeout: 30_000 }).then(() => true, () => false);
      if (loaded) await run("/bin/launchctl", ["bootout", `${domain}/${label}`]);
    }
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(nodeExecutable)}</string><string>${xml(cliEntry)}</string><string>serve</string><string>--background-log</string></array>
<key>WorkingDirectory</key><string>${xml(stateDirectory)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(process.env.PATH || "")}</string></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>15</integer>
<key>StandardOutPath</key><string>${xml(join(stateDirectory, "companion.log"))}</string>
<key>StandardErrorPath</key><string>${xml(join(stateDirectory, "companion.log"))}</string>
</dict></plist>
`;
    await writeFile(plistPath, plist, { mode: 0o600 });
    await run("/bin/launchctl", ["enable", `${domain}/${label}`]);
    await run("/bin/launchctl", ["bootstrap", domain, plistPath]);
    await run("/bin/launchctl", ["kickstart", `${domain}/${label}`]);
    return;
  }

  if (process.platform === "win32") {
    // A hidden launcher waits for Node so Task Scheduler observes server exit/restart.
    const launchScript = `$ErrorActionPreference = 'Stop'; $env:PATH = ${powershellLiteral(process.env.PATH || "")}; ` +
      `$child = Start-Process -FilePath ${powershellLiteral(nodeExecutable)} ` +
      `-ArgumentList ${powershellLiteral(`${windowsArgument(cliEntry)} serve --background-log`)} ` +
      `-WorkingDirectory ${powershellLiteral(stateDirectory)} -WindowStyle Hidden -Wait -PassThru; exit $child.ExitCode`;
    const encodedLaunch = Buffer.from(launchScript, "utf16le").toString("base64");
    await powershell(taskIdentity +
      `$action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') ` +
      `-Argument '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encodedLaunch}'; ` +
      "$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name; " +
      "$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited; " +
      "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries " +
      "-ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew; " +
      "Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null; " +
      "Start-ScheduledTask -TaskName $taskName;");
    return;
  }

  if (process.platform === "linux") {
    await requireSystemd();
    await mkdir(unitDirectory, { recursive: true });
    // ':' disables systemd environment expansion in ExecStart, preserving literal paths.
    await writeFile(unitPath, `[Unit]
Description=Drawsy Companion local canvas connection

[Service]
Type=simple
ExecStart=:${unitArgument(nodeExecutable)} ${unitArgument(cliEntry)} serve --background-log
WorkingDirectory=${unitArgument(stateDirectory)}
Environment=${unitArgument(`PATH=${process.env.PATH || ""}`)}
Restart=on-failure
RestartSec=15
TimeoutStopSec=20

[Install]
WantedBy=default.target
`, { mode: 0o600 });
    await run("systemctl", ["--user", "daemon-reload"]);
    await run("systemctl", ["--user", "enable", unit]);
    await run("systemctl", ["--user", "restart", unit]);
    return;
  }
  throw new Error(`Automatic startup is not supported on ${process.platform}.`);
}

/** Stop and unregister only the CLI's user startup entry. */
export async function disableAutostart(): Promise<void> {
  if (process.platform === "darwin") {
    const domain = launchDomain();
    const loaded = await execute("/bin/launchctl", ["print", `${domain}/${label}`], { timeout: 30_000 }).then(() => true, () => false);
    if (loaded) await run("/bin/launchctl", ["bootout", `${domain}/${label}`]);
    await rm(plistPath, { force: true });
    return;
  }
  if (process.platform === "win32") {
    await powershell(taskIdentity +
      "$task = Get-ScheduledTask | Where-Object { $_.TaskName -eq $taskName -and $_.TaskPath -eq '\\' }; " +
      "if ($task) { Stop-ScheduledTask -TaskName $taskName; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false; }");
    return;
  }
  if (process.platform === "linux") {
    if (!(await exists(unitPath))) return;
    await requireSystemd();
    await run("systemctl", ["--user", "disable", "--now", unit]);
    await rm(unitPath, { force: true });
    await run("systemctl", ["--user", "daemon-reload"]);
    return;
  }
  throw new Error(`Automatic startup is not supported on ${process.platform}.`);
}

/** Report persistent login registration; this does not assert server health. */
export async function autostartEnabled(): Promise<boolean> {
  if (process.platform === "darwin") {
    if (!(await exists(plistPath))) return false;
    const disabled = await run("/bin/launchctl", ["print-disabled", launchDomain()]);
    return !disabled.includes(`"${label}" => true`);
  }
  if (process.platform === "win32") {
    return (await powershell(taskIdentity +
      "$task = Get-ScheduledTask | Where-Object { $_.TaskName -eq $taskName -and $_.TaskPath -eq '\\' }; " +
      "if ($task -and $task.State -ne 'Disabled') { 'true' } else { 'false' }")) === "true";
  }
  if (process.platform === "linux") {
    if (!(await exists(unitPath))) return false;
    await requireSystemd();
    const result = await execute("systemctl", ["--user", "is-enabled", unit], { timeout: 30_000 }).then(
      ({ stdout }) => stdout.trim(),
      (error: { stdout?: string }) => error.stdout?.trim() || "disabled"
    );
    return result === "enabled";
  }
  throw new Error(`Automatic startup is not supported on ${process.platform}.`);
}
