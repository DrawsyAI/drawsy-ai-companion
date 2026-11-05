# Contributing

Drawsy Companion is the public local desktop boundary for Drawsy. Changes in this repository should improve the tray application, local bridge, supported harness lifecycles, local MCP, or cross-platform packaging without pulling hosted backend responsibilities into the companion.

## Change boundary

- Keep the bridge bound to loopback and preserve origin/session authentication.
- Use the selected folder as the session working directory and keep the Drawsy surface scoped to the active session. Preserve each harness's native profile, permission model, and tool access; do not add a Companion-level filesystem jail.
- Do not add provider credentials, backend implementation, hosted workspace code, or deployment secrets.
- Do not install or bundle a harness; Companion detects the user's existing installation.
- Keep local-only behavior local unless an explicit, reviewed integration contract requires otherwise.
- Prefer focused changes over broad renames or unrelated cleanup.

## Validate changes

Requirements are Node.js `>=20.12` and pnpm `10.11.0` through Corepack.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run check
```

For packaging changes, also run the platform-appropriate package command and inspect the generated `release/` output:

```bash
corepack pnpm run package:dir
corepack pnpm run package
```

The test suite is static/unit protocol coverage. It does not require browser automation or a running Drawsy web server.

## Pull requests

Include the affected runtime boundary, tests run, packaging impact, and any known platform limitation. Do not include credentials, provider tokens, private workspace data, generated release output, or local environment files.

For security vulnerabilities, use the private reporting path in [`SECURITY.md`](SECURITY.md).
