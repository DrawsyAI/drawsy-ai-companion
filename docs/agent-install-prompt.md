# Install Drawsy Companion with your coding agent

Copy this prompt into Codex, Claude Code, Pi, OpenCode, or another coding agent on the same computer as your browser:

```text
Install Drawsy Companion on this computer so Drawsy can connect to the Codex or OpenCode I already use. Complete the setup and verify what actually happened; do not only give me instructions.

- Use this computer's terminal. If this is a remote machine, container, or CI environment, stop and tell me Companion must run on my own computer.
- Prefer the desktop app; it does not need Node.js, npm, administrator access, or sudo. In 64-bit Windows PowerShell, run: irm https://raw.githubusercontent.com/DrawsyAI/drawsy-ai-companion/main/scripts/install.ps1 | iex
- On Apple Silicon macOS or x64 Linux, run in Terminal: curl -fsSL https://raw.githubusercontent.com/DrawsyAI/drawsy-ai-companion/main/scripts/install.sh | sh
- The installer downloads the latest stable GitHub release, checks its SHA-256 checksum, installs for my account, and opens the app. Do not install the Store package. Windows builds are unsigned: do not bypass a security warning. If Windows blocks the app or needs my approval, stop and explain that clearly.
- If this computer or processor is unsupported, stop and name it. Do not install a different package or switch to the Store version.
- Do not install, update, sign in to, or change Codex or OpenCode. Do not change their existing login or read secrets.
- The desktop app and terminal CLI use the same local connection. Do not start the CLI alongside the desktop app. Never stop the desktop app or an unknown process to make installation work. If another Companion is using the connection, leave it alone and report the conflict.
- Only use the terminal CLI if I specifically ask for a windowless background service. It needs Node.js 22 or later and an already-installed npm, pnpm, or Bun. Do not install Node.js or another package manager. First check CLI status; only stop/update a confirmed CLI service, and disable its sign-in startup before updating. If the desktop app or another Companion is using the connection, do not stop it or continue. Install @drawsy/companion globally with the package manager already present, skip package scripts, then run drawsy-companion setup (on Windows use npm.cmd/pnpm.cmd/bun and drawsy-companion.cmd).
- For the desktop app, verify it opened and http://127.0.0.1:3031/health reports ok=true. For the CLI, verify drawsy-companion status reports running and sign-in startup enabled. Read Codex/OpenCode status from the Companion window or CLI and report it exactly. If a check cannot be made, say so; do not claim success without evidence.

Keep your final report short: say whether installation completed, the installed version if you could verify it, the local connection check, and Codex/OpenCode availability exactly as Companion reports it. If it completed, tell me to visit https://drawsyai.com, sign in, open a canvas, and start AI chat. If it did not, name the blocker and the next step.
```
