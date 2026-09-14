# Security policy

Please do not open a public issue for a suspected security vulnerability.

The companion is intended to bind only to loopback, use explicit browser-origin checks, keep sessions scoped to a selected folder, and keep the Drawsy MCP behind an authenticated local session. Connector and resource grants are received for the active turn, forwarded only to the configured Drawsy backend, and kept in memory; provider credentials are never shipped with the companion. Do not expose it on a LAN or public interface.

Private backend services, credentials, provider keys, and production deployment configuration do not belong in this repository.
