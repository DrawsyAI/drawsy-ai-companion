import type { LocalEngineStatus } from "../drawsy/engine-status.js";

export const DRAWSY_URL = "https://drawsyai.com";

export const windowsStatus = (engines: LocalEngineStatus[], running: boolean) => [
  { id: "companion", text: running ? "Companion running" : "Companion starting", available: running },
  {
    id: "codex",
    text: engines.find((engine) => engine.id === "codex")?.installed
      ? "Codex available" : "Codex not found",
    available: Boolean(engines.find((engine) => engine.id === "codex")?.installed)
  },
  // Detection alone does not make OpenCode usable: its session sandbox currently
  // rejects Windows in OpenCodeSession.initialize().
  { id: "opencode", text: "OpenCode unavailable on Windows", available: false }
];

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!
);

export const createWindowsStatusPage = (version: string, illustration: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>DrawsyAI Companion</title>
  <style>
    :root { color-scheme: light dark; font-family: "Segoe UI", sans-serif;
      --paper: #fbfafc; --ink: #2b2930; --quiet: #77747d; --rule: #e4e2e8;
      --purple: #685ed8; --green: #397b49; --button-text: #fff;
      --illustration-ink: var(--ink); --illustration-rule: var(--rule);
      --illustration-muted: var(--quiet); --illustration-purple: var(--purple);
      --illustration-blue: #3e73b7; --illustration-green: var(--green); }
    @media (prefers-color-scheme: dark) { :root {
      --paper: #18181b; --ink: #f1f0f3; --quiet: #aaa7b1; --rule: #34343a;
      --purple: #b1a8ff; --green: #8fcca0; --button-text: #211b46; --illustration-blue: #85b3e0; } }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: var(--paper); color: var(--ink); display: flex; flex-direction: column; }
    main { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 30px 32px 24px; text-align: center; }
    .drawing { width: min(100%, 290px); margin: 0 0 22px; }
    .drawing svg { display: block; width: 100%; height: auto; }
    h1 { font-size: 27px; font-weight: 600; letter-spacing: -.7px; margin: 0 0 12px; }
    .description { color: var(--quiet); font-size: 14px; line-height: 1.6; max-width: 290px; margin: 0 0 24px; }
    .open { display: inline-block; padding: 13px 30px; border-radius: 7px; background: var(--purple); color: var(--button-text); font-size: 14px; font-weight: 600; text-decoration: none; }
    .open:hover { filter: brightness(.96); }
    .open:focus-visible { outline: 2px solid var(--purple); outline-offset: 4px; }
    .caption { color: var(--quiet); font-size: 12px; margin: 10px 0 28px; }
    .runtime { width: 100%; border-top: 1px solid var(--rule); padding-top: 18px; display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 18px; font-size: 12px; }
    .status { display: inline-flex; align-items: center; gap: 7px; }
    .status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--quiet); flex-shrink: 0; }
    .status[data-available="true"]::before { background: var(--green); }
    .status[data-available="false"] { color: var(--quiet); }
    footer { padding: 14px 20px; display: flex; justify-content: space-between; gap: 16px; color: var(--quiet); font-size: 11px; }
    @media (max-width: 400px) { main { padding: 24px 20px; } h1 { font-size: 24px; } footer { flex-wrap: wrap; } }
  </style>
</head>
<body>
  <main>
    <div class="drawing">${illustration}</div>
    <h1>Your canvas. Your computer.</h1>
    <p class="description">Companion connects Drawsy to the tools on this computer.</p>
    <a class="open" href="${DRAWSY_URL}">Open Drawsy</a>
    <p class="caption" id="browser-caption" role="status">Opens in your browser</p>
    <div class="runtime" aria-live="polite" aria-label="Local runtime status">
      <span class="status" id="companion">Companion starting</span>
      <span class="status" id="codex">Checking Codex</span>
      <span class="status" id="opencode">OpenCode unavailable on Windows</span>
    </div>
  </main>
  <footer><span>Stays running when you close this window.</span><span>v${escapeHtml(version)}</span></footer>
</body>
</html>`;
