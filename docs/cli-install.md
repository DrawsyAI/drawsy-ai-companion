# Drawsy Companion from your terminal

The CLI runs the same local Companion server without the desktop app. It connects Drawsy to your existing Codex/OpenCode installation. It does not install either engine, sign you in, or change their authentication settings.

## Requirements

- Windows, macOS, or Linux.
- Node.js 22 or later with npm, installed for your user account.
- The public npm package [@drawsy/companion](https://www.npmjs.com/package/@drawsy/companion).

The package is published under Drawsy's npm account. A public package does not require a paid private npm plan. No paid app signing certificate or Microsoft Store approval is required for this Node.js CLI package; the separate desktop app has its own release requirements.

## Install permanently

Install the public npm package:

```sh
npm install --global --ignore-scripts @drawsy/companion
```

This installs the CLI globally; npx is not needed. npm must be configured so your user account can install global packages; this flow does not request administrator access.

Once installed, run:

```sh
drawsy-companion setup
```

Running `drawsy-companion` by itself shows the local status without changing startup settings. `setup` starts Companion in the background and enables startup when you sign in. Then open [Drawsy](https://drawsyai.com), the URL allowed by the Companion connection policy. Closing the terminal does not stop the background server.

To install and set up in one line:

macOS/Linux:

```sh
npm install --global --ignore-scripts @drawsy/companion && drawsy-companion setup
```

Windows PowerShell:

```powershell
npm.cmd install --global --ignore-scripts @drawsy/companion; if ($LASTEXITCODE -eq 0) { drawsy-companion.cmd setup }
```

The Windows `.cmd` commands avoid requiring a PowerShell script execution policy change.

### Optional GitHub tarball source

If you prefer to install a GitHub release tarball, use its versioned `.tgz` asset. For CLI version 0.1.30:

```sh
npm install --global --ignore-scripts https://github.com/DrawsyAI/drawsy-ai-companion/releases/download/cli-v0.1.30/drawsy-companion-0.1.30.tgz
```

The tarball is built by this repository's CLI release workflow and is available after its draft release is published. Use the tarball asset, not the desktop ZIP or AppX.

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

The CLI does not update itself. npm distributes the package; Node runs it. To update, stop the running server first. If startup at sign-in is enabled, `autostart disable` also stops it:

```sh
drawsy-companion autostart disable
npm install --global --ignore-scripts @drawsy/companion@latest
drawsy-companion setup
```

Run `setup` after installation only if you want Companion to start at sign-in. Otherwise, run `drawsy-companion start` when you want it for the current login session. If startup was already disabled, use `drawsy-companion stop` before installing the update instead.

Before removing the package, disable startup at login, stop Companion, and remove the package:

```sh
drawsy-companion autostart disable
drawsy-companion stop
npm uninstall --global @drawsy/companion
```

This does not uninstall your Codex/OpenCode installation.

## Release preparation

The first public version, 0.1.28, was built and uploaded by GitHub Actions and approved through npm's staged publication flow. Follow [the npm publishing guide](https://github.com/DrawsyAI/drawsy-ai-companion/blob/main/docs/npm-publishing.md) for GitHub trusted publishing setup. Future public package releases use this repository's **Publish Companion CLI to npm** GitHub workflow. It requires the current `main` commit, rejects a mismatched existing CLI version tag, builds and packages the CLI, and publishes the package with npm provenance. It runs no tests and launches no app or server.

The **Build Companion CLI release** GitHub workflow builds and packages a selected commit, runs no tests, and launches no app or server. It uploads the tarball and `CLI-SHA256SUMS` to a draft release named `cli-v` followed by the package version. Review and manually verify the draft before publishing it; existing published releases are never replaced. This GitHub tarball is an optional install source.

The package contains the compiled local server, bundled Drawsy skills, and npm runtime dependency declarations. It excludes Electron, the desktop UI, build dependencies, personal configuration, and credentials. npm installs the declared runtime dependencies when installing the tarball.
