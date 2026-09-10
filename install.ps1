$ErrorActionPreference = 'Stop'
$releaseTag = $env:GREYBEARD_RELEASE_TAG
$releaseHash = $env:GREYBEARD_RELEASE_SHA256
if ($releaseTag -notmatch '^[a-zA-Z0-9._-]+$' -or $releaseHash -notmatch '^[a-fA-F0-9]{64}$') {
  throw 'Executable releases are not configured yet. Set GREYBEARD_RELEASE_TAG and GREYBEARD_RELEASE_SHA256 from the authenticated release announcement.'
}
$cpu = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($cpu -notin @('x64', 'arm64')) { throw "Unsupported architecture: $cpu" }
$binDir = if ($env:GREYBEARD_BIN_DIR) { $env:GREYBEARD_BIN_DIR } else { Join-Path $env:LOCALAPPDATA 'Greybeard\bin' }
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$destination = Join-Path $binDir 'greybeard.exe'
if (Test-Path $destination) { throw 'An installation already exists. Keep it until executable update activation is available.' }
$temporary = Join-Path $binDir ([Guid]::NewGuid().ToString() + '.exe')
try {
  $uri = "https://github.com/ugurkocde/greybeard/releases/download/$releaseTag/greybeard-win32-$cpu.exe"
  Invoke-WebRequest -Uri $uri -OutFile $temporary -UseBasicParsing -TimeoutSec 300
  if ((Get-FileHash -Path $temporary -Algorithm SHA256).Hash -ne $releaseHash) { throw 'Release integrity verification failed' }
  & $temporary --help | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Executable launch verification failed ($LASTEXITCODE)" }
  Move-Item -Path $temporary -Destination $destination
  Write-Host "Installed $destination. Add $binDir to PATH if needed."
  & $destination setup
  if ($LASTEXITCODE -ne 0) { throw "Setup exited with code $LASTEXITCODE" }
} finally {
  if (Test-Path $temporary) { Remove-Item $temporary -Force }
}
