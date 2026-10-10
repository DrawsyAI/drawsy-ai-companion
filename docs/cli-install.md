# Install Drawsy Companion

Choose the desktop app unless you specifically want to control Companion from a terminal.

## Desktop app: one line, no Node.js needed

Open Terminal on macOS/Linux or PowerShell on Windows and paste the matching command. It downloads the latest app from GitHub, checks its SHA-256 checksum, installs it for your account, and opens Companion. It needs no Node.js, npm, administrator access, or `sudo`, and it does not install the Microsoft Store package.

macOS (Apple Silicon) or Linux (x64):

```sh
curl -fsSL https://raw.githubusercontent.com/DrawsyAI/drawsy-ai-companion/main/scripts/install.sh | sh
```

Windows (64-bit), in PowerShell:

```powershell
irm https://raw.githubusercontent.com/DrawsyAI/drawsy-ai-companion/main/scripts/install.ps1 | iex
```

The Windows app is currently unsigned, so Windows may show a security warning. The installer does not bypass it. To update the desktop app, close Companion and run the same command again. Supported builds are Apple Silicon macOS, 64-bit Windows, and x64 Linux.

The desktop app stays available in the tray/menu bar while it is open. It does not start automatically when you sign in. Closing its window leaves it running in the background; choose **Quit Drawsy Companion** from the tray/menu to stop it.

## Terminal CLI: background service and controls

Choose this if you want Companion to run without its desktop window and start when you sign in. It requires Node.js 22 or later to remain installed. Use npm, pnpm, or Bun only if you already have it; there is no need to install another package manager.

macOS/Linux, using npm:

```sh
npm install --global --ignore-scripts @drawsy/companion@latest && drawsy-companion setup
```

Windows PowerShell, using npm:

```powershell
npm.cmd install --global --ignore-scripts @drawsy/companion@latest; if ($LASTEXITCODE -eq 0) { drawsy-companion.cmd setup }
```

If you already use a different package manager, run only its command:

- macOS/Linux with pnpm: `pnpm add --global --ignore-scripts @drawsy/companion@latest && drawsy-companion setup`
- macOS/Linux with Bun: `bun add --global --ignore-scripts @drawsy/companion@latest && drawsy-companion setup`
- Windows PowerShell with pnpm: `pnpm.cmd add --global --ignore-scripts @drawsy/companion@latest; if ($LASTEXITCODE -eq 0) { drawsy-companion.cmd setup }`
- Windows PowerShell with Bun: `bun add --global --ignore-scripts @drawsy/companion@latest; if ($LASTEXITCODE -eq 0) { drawsy-companion.cmd setup }`

`setup` starts Companion in the background and enables it when you sign in. Useful commands:

```sh
drawsy-companion status
drawsy-companion logs
drawsy-companion start
drawsy-companion stop
drawsy-companion autostart disable
```

On Windows, use `drawsy-companion.cmd` in PowerShell. Desktop app and CLI use the same local server; close the desktop app before starting the CLI. The CLI will not stop or replace another Companion.

## Updates and removal

The desktop app and CLI update separately. To update the desktop app, close it and run its installer command again. To update the CLI, disable sign-in startup, stop it, install the latest package with the same package manager, then run setup again. Example for npm:

```sh
drawsy-companion autostart disable
npm install --global --ignore-scripts @drawsy/companion@latest
drawsy-companion setup
```

To remove the CLI, disable startup and stop it first, then uninstall the package with the same package manager:

```sh
drawsy-companion autostart disable
drawsy-companion stop
npm uninstall --global @drawsy/companion
```

Neither install route installs, updates, or signs in to Codex or OpenCode. Keep using the installation and login flow you already have for those tools.

## Release sources

- Desktop installers are built and published to this repository's [GitHub Releases](https://github.com/DrawsyAI/drawsy-ai-companion/releases/latest). Install scripts fetch the latest stable release and its checksum file.
- The npm CLI is published separately by the repository's **Publish Companion CLI to npm** GitHub workflow. Installing or updating the desktop app does not publish or update the npm package.
- The CLI release tarball excludes Electron, the desktop window, build dependencies, personal configuration, and credentials.

For maintainers: desktop releases follow a version tag matching `package.json` (`v` followed by the package version) and are built by the release workflow. npm releases require a package version bump on `main` and a deliberate run of **Publish Companion CLI to npm** in GitHub Actions. The two release routes do not trigger each other.
