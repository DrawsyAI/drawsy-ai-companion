# Security policy

Please do not open a public issue for a suspected security vulnerability.

The companion binds only to loopback, uses explicit browser-origin checks, starts each harness in the user-selected working directory, and keeps the Drawsy MCP behind an authenticated local session. It preserves each installed harness's native profile, permissions, and tool access rather than imposing an additional filesystem jail. Connector and resource grants are received for the active turn, forwarded only to the configured Drawsy backend, and kept in memory; provider credentials are never shipped with the companion. Do not expose it on a LAN or public interface.

Private backend services, credentials, provider keys, and production deployment configuration do not belong in this repository.
