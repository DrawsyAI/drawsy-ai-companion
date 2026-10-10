# Install Drawsy Companion with your coding agent

Copy this prompt into Codex, Claude Code, Pi, OpenCode, or another coding agent running on the same computer as your browser:

```text
Install and set up Drawsy Companion on this computer so Drawsy can connect to the coding tools already installed here. Complete the setup and verify it; do not only give me instructions.

- Use this computer's terminal. If it is remote, SSH, a container, or CI, stop and tell me Companion must run on my own computer.
- Install the permanent public npm package globally; do not use npx. Use no administrator or sudo access, and do not change shell security settings.
- Check for Node.js 22 or newer and npm. If missing, use only an already-installed trusted package manager without administrator access; otherwise tell me the exact requirement.
- Do not install, update, sign in to, or change Codex or OpenCode. Do not read or print secrets, ask for npm login, or purchase anything.
- Check `drawsy-companion status` first if it is installed. If its CLI service is running or set to start at sign-in, run `drawsy-companion autostart disable` before updating it. On Windows, use `drawsy-companion.cmd`. Never stop the desktop app or an unknown process. If another Companion owns the local connection, leave it alone and report the conflict.

Install the latest package (Windows PowerShell uses `npm.cmd`):
- Windows: `npm.cmd install --global --ignore-scripts @drawsy/companion@latest`
- macOS/Linux: `npm install --global --ignore-scripts @drawsy/companion@latest`

Then run `drawsy-companion setup` (Windows: `drawsy-companion.cmd setup`). This starts Companion and enables startup when I sign in. If setup fails or finds another Companion, do not stop other processes or claim success. Use status and, if needed, logs to identify the blocker. If status says it is starting, wait briefly and check again.

Verify status shows the CLI Companion running and startup at sign-in enabled. Report the installed version and the Codex/OpenCode availability and versions exactly as Companion reports them; do not call an unsupported or missing tool available. Never say setup is done unless both running status and sign-in startup are confirmed.

Keep the final report short: say whether setup succeeded, the version and tool statuses, then—if successful—tell me to go to https://drawsyai.com, sign in, open a canvas, and start its AI chat. If it did not finish, name the blocker and the next step.
```
