$ErrorActionPreference = "Stop"
$codexInstall = Join-Path $env:RUNNER_TEMP "Drawsy Codex CLI"
npm install --prefix "$codexInstall" --no-audit --no-fund @openai/codex@0.162.1
if ($LASTEXITCODE -ne 0) { throw "CI-only Codex installation failed." }
$env:DRAWSY_CODEX_BIN = Join-Path $codexInstall "node_modules/.bin/codex.cmd"
$env:ELECTRON_RUN_AS_NODE = "1"
try {
  & "./release/win-unpacked/drawsy-companion.exe" "./scripts/check-windows-codex.mjs" --packaged
  if ($LASTEXITCODE -ne 0) { throw "Packaged Windows Codex session check failed." }
} finally {
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
}
