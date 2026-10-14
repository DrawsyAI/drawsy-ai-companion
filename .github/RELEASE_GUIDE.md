# Release guide

The GitHub desktop release also publishes the matching CLI version to npm after the desktop release workflow succeeds. Microsoft Store submission remains separate and manual.

## Before a release

- Merge changes into `main` through a pull request.
- Update the version in `package.json`. The current pnpm lockfile does not record the root package version; update it only when dependency metadata changes.
- Prepare releases from `main`. Release workflows must reject source commits that are not part of `main`.
- Never move or replace an existing version tag. Never force-push. Use a new version if a release needs correction.
- A maintainer must complete platform checks before publishing; a successful build is not a user-install check.

## Desktop app on GitHub

Create and push a new tag matching the package version, such as `v1.2.3`. The **Release Companion** workflow builds the desktop artifacts and publishes them with `SHA256SUMS` to the GitHub release. To rebuild an existing tag after a workflow failure, run **Release Companion** manually from `main` and enter that existing tag. The workflow checks that the tag is on `main` and matches the version inside it; never move or replace a tag.

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

Pushing a new version tag from `main` starts **Release Companion**. After that workflow succeeds, **Publish Companion CLI to npm** builds the CLI from the same tag, checks that its version matches, and publishes `@drawsy/companion` to npm with provenance. If that exact npm version is already present, the workflow skips it. A failed npm publish does not undo the desktop release; maintainers can run this workflow manually from the latest `main` commit to recover.

The GitHub **Packages** tab only lists packages published to GitHub's own registry. The installable CLI remains on npm, so it does not appear in that tab. A second copy in GitHub Packages would require GitHub sign-in to install, so we do not publish one.

The normal route uses npm trusted publishing from GitHub Actions and creates npm provenance while this source repository is public. If the source repository becomes private, provenance will stop working and npm will no longer be able to verify the public source link. The optional bootstrap route is for an authorized recovery only; never add or print npm tokens in workflow files or logs.

npm, pnpm, and Bun install the same public CLI package on all three platforms. The CLI requires Node.js and is separate from the desktop app. It does not install or change Codex/OpenCode.

## Release map

| Release | Start | Output | Maintainer action |
| --- | --- | --- | --- |
| Desktop | Push a new `v*` version tag from `main` | GitHub macOS, Windows, and Linux assets; matching npm CLI version after success | Review both release pages; finish delayed Apple notarization if needed |
| Microsoft Store | Manually run the Store package workflow from `main` | `.appx` Actions artifact | Upload and submit in Partner Center; monitor certification |
| npm CLI | Auto after a successful desktop tag release; manual workflow dispatch for recovery | Public `@drawsy/companion` package | Confirm npm publication; manually recover only if it fails |

The desktop and npm release run in sequence; Store submission remains manual. Do not describe a Store submission as automated until Partner Center credentials and a publishing workflow are configured and verified.
