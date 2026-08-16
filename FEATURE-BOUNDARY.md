# Companion feature boundary

The private `drawsy-ai-mcp` repository remains the historical implementation record. This repository is the public local product boundary.

## Included here

- local Codex app-server lifecycle;
- local OpenCode server lifecycle;
- installed-engine detection;
- selected-folder permission and sandbox boundary;
- Drawsy bridge protocol and loopback authentication;
- surface-scoped Drawsy MCP;
- canvas, presentation, image, context, and local preview handoff;
- local conversation state and session cleanup;
- static checks, protocol tests, and release packaging.

## Kept outside

- hosted workspace copying and remote preview proxying;
- backend implementation and connector authorization services;
- deployment manifests, cloud runtime configuration, and production secrets;
- the historical standalone Excalidraw MCP demo/server.

Those features are not deleted from the product plan. They remain owned by the private web/backend system and can use the public companion protocol where required.
