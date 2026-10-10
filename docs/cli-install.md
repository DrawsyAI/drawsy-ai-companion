# Drawsy Companion from your terminal

The CLI runs the same local Companion server without the desktop app. It connects Drawsy to your existing Codex/OpenCode installation. It does not install either engine or change their login flow.

## Requirements

- Windows, macOS, or Linux.
- Node.js 22 or later with npm, installed for your user account.
- A published Companion CLI release from [this repository](https://github.com/DrawsyAI/drawsy-ai-companion/releases).

No Microsoft Store approval or paid app signing certificate is required for this Node.js CLI package. This does not change the signing requirements of the separate desktop app.

## Install permanently

For CLI version 0.1.28, the permanent install command is:

```sh
npm install --global --ignore-scripts https://github.com/DrawsyAI/drawsy-ai-companion/releases/download/cli-v0.1.28/drawsy-companion-0.1.28.tgz
```

The package is installed permanently; npx is not needed. Downloads come from GitHub, not an npm registry publication. For a newer release titled **Companion CLI**, use that release's `.tgz` download link instead. npm must be configured so your user account can install global packages; this flow does not request administrator access.

Use the versioned `.tgz` link, not the desktop ZIP or AppX. CLI release download links become available only after the draft release is published.

Once installed, run:

```sh
drawsy-companion setup
```

`setup` starts Companion in the background and enables startup when you sign in. Then open [drawsyai.com](https://drawsyai.com). Closing the terminal does not stop the background server.

To install and set up in one line, after the release is published:

macOS/Linux:

```sh
npm install --global --ignore-scripts https://github.com/DrawsyAI/drawsy-ai-companion/releases/download/cli-v0.1.28/drawsy-companion-0.1.28.tgz && drawsy-companion setup
```

Windows PowerShell:

```powershell
npm.cmd install --global --ignore-scripts https://github.com/DrawsyAI/drawsy-ai-companion/releases/download/cli-v0.1.28/drawsy-companion-0.1.28.tgz; if ($LASTEXITCODE -eq 0) { drawsy-companion.cmd setup }
```

The Windows `.cmd` commands avoid requiring a PowerShell script execution policy change.

## Commands

```sh
drawsy-companion start
drawsy-companion stop
drawsy-companion status
drawsy-companion logs
drawsy-companion serve
drawsy-companion autostart enable
drawsy-companion autostart disable
```

`serve` keeps the server visible in your current terminal. Press Ctrl+C to stop it. `status` reports whether the local server is running. Startup at login uses Windows Task Scheduler, macOS launchd, or Linux's user systemd service; Linux requires a working user systemd session. `start` alone does not enable startup at login.

The desktop app and CLI use the same local server address. Quit the desktop app before switching to the CLI; an existing server is not silently replaced or stopped.

## Update or remove

Run `drawsy-companion autostart disable`, then `drawsy-companion stop` before installing a newer versioned `.tgz` with the same npm install command. Run `drawsy-companion setup` after installation to restore background startup. This also refreshes the saved Node.js executable path if your Node installation changed.

Before removing the package, disable startup at login, stop Companion, and remove the package:

```sh
drawsy-companion autostart disable
drawsy-companion stop
npm uninstall --global @drawsy/companion
```

This does not uninstall your Codex/OpenCode installation.

## Release preparation

The **Build Companion CLI release** GitHub workflow builds and packages a selected commit from this repository. It runs no tests and launches no server. It uploads the tarball and `CLI-SHA256SUMS` to a draft release named `cli-v` followed by the package version. Existing published assets are never replaced. Review and manually test the draft before publishing it.

The package contains the compiled local server, bundled Drawsy skills, and npm runtime dependency declarations. It excludes Electron, the desktop UI, build dependencies, personal configuration, and credentials. npm installs the declared runtime dependencies when installing the tarball.
