param(
  [string]$RepoUrl = $env:GREYBEARD_REPO_URL,
  [string]$InstallDir = $env:GREYBEARD_INSTALL_DIR,
  [string]$BinDir = $env:GREYBEARD_BIN_DIR
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoUrl)) {
  $RepoUrl = "https://github.com/ugurkocde/greybeard.git"
}

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  $InstallDir = Join-Path $HOME ".greybeard"
}

if ([string]::IsNullOrWhiteSpace($BinDir)) {
  $BinDir = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps"
}

Write-Host "Installing Greybeard..."

$gitDir = Join-Path $InstallDir ".git"
if (Test-Path $gitDir) {
  git -C $InstallDir fetch --prune
  git -C $InstallDir pull --ff-only
} elseif (Test-Path $InstallDir) {
  Write-Error "Install directory exists and is not a git checkout: $InstallDir"
} else {
  git clone $RepoUrl $InstallDir
}

Push-Location $InstallDir
try {
  npm ci
  npm run build --workspaces
} finally {
  Pop-Location
}

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$cmdPath = Join-Path $BinDir "greybeard.cmd"
$cliPath = Join-Path $InstallDir "cli\dist\index.js"
$cmdBody = "@echo off`r`nnode `"$cliPath`" %*`r`n"
Set-Content -Path $cmdPath -Value $cmdBody -Encoding ASCII

$pathParts = ($env:PATH -split ";") | Where-Object { $_ -ne "" }
if ($pathParts -notcontains $BinDir) {
  Write-Warning "$BinDir is not on PATH."
}

& $cmdPath setup
