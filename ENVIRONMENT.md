# Environment SOP

Only `.env.development` and `.env.production` exist at the repository root. Both are ignored, mode `0600`, and excluded from Electron packaging. No `.env`, `.env.local`, or example files are supported.

Unpackaged Electron and the standalone bridge select `NODE_ENV=development` by default and load only `.env.development`. An explicit `NODE_ENV=production` selects `.env.production`. Native Node loading preserves externally supplied values; set the mode before launching. Invalid modes fail immediately. The development defaults preserve loopback port 3031 and localhost canvas origins.

Packaged Electron always selects production defaults and does not read env files from the customer working directory. Its bridge listens on `127.0.0.1`; the only default trusted browser origin is `https://drawsyai.com`. Loopback transport is necessary for the on-device bridge and is independent of the browser-origin allowlist. Explicit external `DRAWSY_ALLOWED_ORIGINS` remains an operator override; it must be exact and reviewed. The packaged app is not rebuilt by editing source or root env files.

The product backend is resolved from the canvas origin (`https://api.drawsyai.com`); local development routes to the existing local backend. No service secrets, Firebase Admin keys, shared provider login, subscription credentials, or remote server workspaces belong on a customer device. Local harnesses use the user's existing provider login and native credential storage. Provider configuration submitted through a supported harness control follows that harness's native persistence behavior.

The agent's session-scoped stdio MCP receives its environment from Companion and does not load root env files. Verify source with a no-emit typecheck and compile tests into a temporary directory. Do not package, replace release artifacts, restart Companion, or alter release workflows as part of environment configuration work.

Harness executable overrides are process-level operator settings: `DRAWSY_CODEX_BIN`, `DRAWSY_OPENCODE_BIN`, `DRAWSY_PI_BIN`, `DRAWSY_OMP_BIN`, and `DRAWSY_DEEPSEEK_BIN`. They select an already-installed executable; they do not configure provider credentials or replace a harness's native profile. Without an override, Companion searches its inherited `PATH` and, on macOS/Linux, the user's login-shell `PATH`. DeepSeek Harness also has its standard macOS Applications launcher locations checked.
