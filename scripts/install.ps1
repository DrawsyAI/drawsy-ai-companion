$ErrorActionPreference = "Stop"

function Stop-Install([string] $Message) {
  throw "Drawsy Companion installer: $Message"
}

if (-not [Environment]::Is64BitOperatingSystem) {
  Stop-Install "The current Windows release requires 64-bit Windows."
}

$running = Get-Process -Name "drawsy-companion" -ErrorAction SilentlyContinue
if ($running) {
  Stop-Install "Close Drawsy Companion, then run this command again. The installer will not close it for you."
}

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$releaseApi = "https://api.github.com/repos/DrawsyAI/drawsy-ai-companion/releases/latest"
$headers = @{
  Accept = "application/vnd.github+json"
  "User-Agent" = "Drawsy-Companion-Installer"
}
$release = Invoke-RestMethod -Uri $releaseApi -Headers $headers
if ([string]$release.tag_name -notmatch "^v(?<version>\d+\.\d+\.\d+)$") {
  Stop-Install "GitHub did not return a stable Companion release."
}
$version = $Matches.version
$assetName = "Drawsy.Companion-$version-win-x64-unsigned.zip"
$asset = $release.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
$checksumAsset = $release.assets | Where-Object { $_.name -eq "SHA256SUMS" } | Select-Object -First 1
if (-not $asset -or -not $checksumAsset) {
  Stop-Install "The latest release does not include the Windows ZIP and checksum. No Store package will be installed."
}

$temporaryDirectory = Join-Path $env:TEMP ("drawsy-companion-" + [Guid]::NewGuid().ToString("N"))
$programsDirectory = Join-Path $env:LOCALAPPDATA "Programs"
$installDirectory = Join-Path $programsDirectory "Drawsy Companion"
$stageDirectory = Join-Path $programsDirectory (".Drawsy Companion.installing-" + [Guid]::NewGuid().ToString("N"))
$backupDirectory = $null
$installSucceeded = $false

try {
  Write-Host "Downloading Drawsy Companion $version..."
  New-Item -ItemType Directory -Path $temporaryDirectory, $programsDirectory -Force | Out-Null
  $archivePath = Join-Path $temporaryDirectory $assetName
  $checksumPath = Join-Path $temporaryDirectory "SHA256SUMS"
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archivePath -UseBasicParsing
  Invoke-WebRequest -Uri $checksumAsset.browser_download_url -OutFile $checksumPath -UseBasicParsing

  $escapedAssetName = [regex]::Escape($assetName)
  $checksumLine = Get-Content -LiteralPath $checksumPath |
    Where-Object { $_ -match "^(?<hash>[0-9A-Fa-f]{64})\s+\*?$escapedAssetName$" } |
    Select-Object -First 1
  if (-not $checksumLine) {
    Stop-Install "The release checksum does not include the Windows ZIP."
  }
  $expectedHash = [regex]::Match($checksumLine, "^[0-9A-Fa-f]{64}").Value
  $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
  if ($actualHash -ne $expectedHash) {
    Stop-Install "The downloaded file did not match GitHub's checksum."
  }

  Write-Host "Download checked. Installing for your account..."
  $extractDirectory = Join-Path $temporaryDirectory "extracted"
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDirectory
  $sourceExecutable = Get-ChildItem -LiteralPath $extractDirectory -Filter "drawsy-companion.exe" -File -Recurse |
    Select-Object -First 1
  if (-not $sourceExecutable) {
    Stop-Install "The Windows ZIP does not contain the Companion app."
  }
  New-Item -ItemType Directory -Path $stageDirectory -Force | Out-Null
  Copy-Item -Path (Join-Path $sourceExecutable.DirectoryName "*") -Destination $stageDirectory -Recurse -Force
  $stagedExecutable = Join-Path $stageDirectory "drawsy-companion.exe"
  if (-not (Test-Path -LiteralPath $stagedExecutable -PathType Leaf)) {
    Stop-Install "The Companion app could not be prepared."
  }

  if (Test-Path -LiteralPath $installDirectory) {
    $backupDirectory = "$installDirectory.previous-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))"
    Move-Item -LiteralPath $installDirectory -Destination $backupDirectory
  }
  try {
    Move-Item -LiteralPath $stageDirectory -Destination $installDirectory
  }
  catch {
    if ($backupDirectory -and (Test-Path -LiteralPath $backupDirectory)) {
      Move-Item -LiteralPath $backupDirectory -Destination $installDirectory
    }
    throw
  }

  $installedExecutable = Join-Path $installDirectory "drawsy-companion.exe"
  $startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
  New-Item -ItemType Directory -Path $startMenu -Force | Out-Null
  $shortcutPath = Join-Path $startMenu "Drawsy Companion.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $installedExecutable
  $shortcut.WorkingDirectory = $installDirectory
  $shortcut.IconLocation = $installedExecutable
  $shortcut.Save()

  Start-Process -FilePath $installedExecutable -WorkingDirectory $installDirectory
  $installSucceeded = $true
  Write-Host "Drawsy Companion $version is installed for your account and opening now."
  Write-Host "Next, go to https://drawsyai.com in your browser."
  Write-Host "The current Windows download is unsigned, so Windows may show a security warning."
}
finally {
  if (Test-Path -LiteralPath $temporaryDirectory) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
  }
  if (-not $installSucceeded -and (Test-Path -LiteralPath $stageDirectory)) {
    Remove-Item -LiteralPath $stageDirectory -Recurse -Force
  }
}
