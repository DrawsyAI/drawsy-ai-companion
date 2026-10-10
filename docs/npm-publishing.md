# npm publishing

The Companion CLI is published from `.github/workflows/npm-publish.yml`. The workflow accepts two authentication methods:

- `trusted` (default) publishes the built tarball through npm trusted publishing with GitHub OIDC and provenance.
- `bootstrap` uploads the same tarball to npm's staging area using the temporary `NPM_BOOTSTRAP_TOKEN` secret. A maintainer must review and approve the staged version on npmjs.com before it becomes public.

Both paths require dispatching from the latest `main` commit. The workflow checks the selected commit and any existing `cli-v<version>` tag before building. It builds and packages the CLI but does not run tests.

## First publication

Trusted publishing is configured in the npm settings for an existing package, so a new package needs one bootstrap publication first. Use npm staged publishing so the GitHub workflow can submit the package without a long-lived direct-publish credential.

1. Enable npm two-factor authentication on the `drawsy` account with its passkey. npm requires account 2FA for staged publishing setup and requires an interactive 2FA challenge to create access tokens and approve a stage.
2. Create a granular npm access token for the bootstrap. Give it **Read and write (stage only)** access, do not enable **Bypass two-factor authentication**, and choose the shortest practical expiry. Restrict it to `@drawsy/companion` if npm allows selecting the not-yet-created package; otherwise restrict it to the `@drawsy` scope. A scope-level token has broader write access, so keep it only for this bootstrap.
3. In the GitHub repository, add the token as an Actions repository secret named `NPM_BOOTSTRAP_TOKEN`. Do not put the token in a workflow input, command argument, or file.
4. On the latest `main`, open **Actions → Publish Companion CLI to npm**, select `bootstrap`, and run the workflow. It packages the CLI, stages that tarball with public access and provenance, and does not publish the package contents directly.
5. On npmjs.com, open **Staged Packages**, inspect the staged version, and approve it with the account passkey. npm creates a public `0.0.0-stage` placeholder when staging a package that does not yet exist; the staged CLI version and its contents become public only after approval.
6. In the new package's **Settings → Trusted publishing**, add a GitHub Actions publisher with owner `DrawsyAI`, repository `drawsy-ai-companion`, and workflow filename `npm-publish.yml`. Allow `npm publish` for this publisher because the `trusted` workflow path publishes directly. The package tarball declares the matching GitHub repository URL.
7. Remove the `NPM_BOOTSTRAP_TOKEN` repository secret and revoke the temporary npm token after the initial approval and trusted publisher setup. npm recommends setting package publishing access to **Require two-factor authentication and disallow tokens** after trusted publishing is configured; OIDC trusted publishing continues to work with that setting. Use `trusted` for the next version; do not attempt to republish the already approved version.

The staged-publishing command requires npm CLI 11.15.0 or later. The workflow installs the latest npm CLI and checks this requirement before staging. A stage-only token can stage package versions but cannot directly publish one; npm notes that it still has other package write capabilities, so revoke it promptly after bootstrap. Stage approval requires an interactive 2FA challenge.

## Later releases

Use the workflow's default `trusted` method for subsequent CLI releases. It publishes the exact tarball produced by the build job, with npm-generated provenance from GitHub OIDC. Keep the package version and any existing `cli-v<version>` tag aligned with the source commit selected for the workflow.

See npm's documentation for [staged publishing](https://docs.npmjs.com/staged-publishing/), [trusted publishers](https://docs.npmjs.com/trusted-publishers/), [granular access tokens](https://docs.npmjs.com/about-access-tokens/), and [two-factor requirements](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/).
