# Drawsy Companion

Drawsy Companion is the installable local application that connects the Drawsy website to a user's local workspace and already-installed Codex or OpenCode installation.

It is a bridge, not a backend and not an AI engine:

- detects whether Codex or OpenCode is available;
- asks the operating system for explicit folder access;
- starts and scopes a local agent session when Drawsy requests one;
- keeps the selected workspace and session context local;
- exposes the surface-scoped Drawsy MCP only inside the local agent session;
- manages local canvas context, image transfer, and live-preview handoff.

Drawsy does not install Codex or OpenCode. If neither is available, the Drawsy client can show the appropriate download option.

## Development

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run check
corepack pnpm run dev
```

The bridge binds to loopback by default at `http://127.0.0.1:3031`. It does not open a LAN or public listener.

Cloud-connected source/resource calls are disabled unless an explicit backend URL is configured. The default companion path is local-only.

## Packaging

```bash
corepack pnpm run package
```

Release builds are produced through GitHub Actions and attached to GitHub Releases:

- macOS: `.dmg` and `.zip`
- Windows: `.exe` installer and `.zip`
- Linux: `.AppImage` and `.deb`

No release or deployment is performed from local development.

## Public/private boundary

This repository contains the public local companion, bridge, protocol, and surface-scoped MCP. Hosted workspaces, cloud backend implementation, deployment configuration, and production credentials remain outside this repository.

The MCP source is intentionally public. It is loopback-bound, session-scoped, and authenticated back to the companion bridge; it is not a public MCP service.

## License

MIT. See [`LICENSE`](LICENSE).
