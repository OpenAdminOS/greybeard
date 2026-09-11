$ErrorActionPreference = 'Stop'
$releaseTag = if ($env:GREYBEARD_RELEASE_TAG) { $env:GREYBEARD_RELEASE_TAG } else { 'v0.1.0' }
$releaseHash = $env:GREYBEARD_RELEASE_SHA256
$localAsset = $env:GREYBEARD_RELEASE_FILE
if ($releaseTag -notmatch '^[a-zA-Z0-9._-]+$' -or $releaseHash -notmatch '^[a-fA-F0-9]{64}$') {
  throw 'Set GREYBEARD_RELEASE_SHA256 to the executable hash from the authenticated Greybeard release. Optionally set GREYBEARD_RELEASE_FILE to an already downloaded executable.'
}
if (-not [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)) {
  throw 'Use install.sh on macOS or Linux.'
}
$cpu = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($cpu -ne 'x64') { throw 'This release provides a Windows x64 executable. No native Windows ARM64 executable is published.' }
$binDir = if ($env:GREYBEARD_BIN_DIR) { $env:GREYBEARD_BIN_DIR } else { Join-Path $env:LOCALAPPDATA 'Greybeard\bin' }
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$destination = Join-Path $binDir 'greybeard.exe'
if (Test-Path -LiteralPath $destination) { throw 'An installation already exists. Close Greybeard and its AI clients, retain the old executable, and replace it manually after verifying the new release.' }
$temporaryDir = Join-Path $binDir ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $temporaryDir | Out-Null
$assetName = 'greybeard-win32-x64.exe'
$temporary = Join-Path $temporaryDir $assetName
try {
  if ($localAsset) {
    Copy-Item -LiteralPath $localAsset -Destination $temporary
  } elseif (Get-Command gh -ErrorAction SilentlyContinue) {
    & gh release download $releaseTag --repo OpenAdminOS/greybeard --pattern $assetName --dir $temporaryDir
    if ($LASTEXITCODE -ne 0) { throw 'Private release download failed. Sign in with gh auth login using an account with repository access, or download the executable in GitHub and set GREYBEARD_RELEASE_FILE.' }
  } else {
    throw 'Download the executable from the private GitHub release and set GREYBEARD_RELEASE_FILE, or use an authenticated GitHub CLI (gh). No public download endpoint is configured.'
  }
  if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $releaseHash) { throw 'Release integrity verification failed; nothing was installed' }
  & $temporary --help | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Executable launch verification failed ($LASTEXITCODE)" }
  [System.IO.File]::Move($temporary, $destination)
  Write-Host "Installed $destination. Add $binDir to PATH if needed."
  & $destination setup
  if ($LASTEXITCODE -ne 0) { throw "Setup exited with code $LASTEXITCODE" }
} finally {
  if (Test-Path -LiteralPath $temporaryDir) { Remove-Item -LiteralPath $temporaryDir -Recurse -Force }
}
