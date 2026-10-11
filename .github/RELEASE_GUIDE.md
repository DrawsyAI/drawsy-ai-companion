# Release guide

Drawsy Companion has separate release lanes. A desktop release does not publish the npm package or submit an update to Microsoft Store.

## Before a release

- Merge changes into `main` through a pull request.
- Update `package.json` and `pnpm-lock.yaml` together so their versions match.
- Prepare releases from `main`. Release workflows must reject source commits that are not part of `main`.
- Never move or replace an existing version tag. Never force-push. Use a new version if a release needs correction.
- A maintainer must complete platform checks before publishing; a successful build is not a user-install check.

## Desktop app on GitHub

Create and push a new tag matching the package version, such as `v1.2.3`. The **Release Companion** workflow builds the desktop artifacts and publishes them with `SHA256SUMS` to the GitHub release.

- macOS: signed and notarized `.dmg` and `.zip`. Apple credentials stay in GitHub Actions secrets.
- Windows: unsigned `.exe` and `.zip`. These remain an alternate download; the Microsoft Store is the recommended install.
- Linux: unsigned `.AppImage` and `.deb`.

If Apple has not finished notarization within the workflow's wait window, run **Finalize Delayed macOS Release** with the original run ID after Apple reports acceptance. Do not rerun the release and create a duplicate notarization submission.

## Microsoft Store for Windows

Run **Build DrawsyAI Companion Store Package** manually from the current `main` branch. It builds and validates the unsigned `.appx` as a GitHub Actions artifact. Microsoft handles package signing during Store certification.

This workflow does not upload or submit the package. Download the `.appx` artifact, open DrawsyAI Companion in Partner Center, upload it to the package section, complete any required listing fields, and submit the update. Follow Partner Center until certification finishes and the update is published.

The Store product ID is `9PD4MGJ9BW4F`; the public listing is https://apps.microsoft.com/detail/9PD4MGJ9BW4F. Package identity values are GitHub Actions variables. Do not add a Windows signing certificate for Store packages.

Store submission can be automated after a maintainer configures Microsoft's Partner Center publishing credentials as GitHub Actions secrets and confirms the publishing connection. Those credentials are not configured in this repository, so submission remains a Partner Center step. Keep the package build and Store submission separate until that setup is intentionally completed.

## npm CLI

Run **Publish Companion CLI to npm** manually from the latest `main` commit after the npm package version is ready. The normal route uses npm trusted publishing from GitHub Actions and creates npm provenance while this source repository is public. If the source repository becomes private, provenance will stop working and npm will no longer be able to verify the public source link. The optional bootstrap route is for an authorized recovery only; never add or print npm tokens in workflow files or logs.

npm, pnpm, and Bun install the same public CLI package on all three platforms. The CLI requires Node.js and is separate from the desktop app. It does not install or change Codex/OpenCode.

## Release map

| Release | Start | Output | Maintainer action |
| --- | --- | --- | --- |
| Desktop | Push a new `v*` version tag from `main` | GitHub macOS, Windows, and Linux assets | Review the release page; finish delayed Apple notarization if needed |
| Microsoft Store | Manually run the Store package workflow from `main` | `.appx` Actions artifact | Upload and submit in Partner Center; monitor certification |
| npm CLI | Manually run the npm workflow from current `main` | Public `@drawsy/companion` package | Confirm package version and npm publication |

No single workflow currently performs all three lanes. Do not describe a Store submission as automated until Partner Center credentials and a publishing workflow are configured and verified.
