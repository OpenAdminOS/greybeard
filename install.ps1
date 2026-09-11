# Installs the signed companion through its normal per-user NSIS installer.
$ErrorActionPreference = 'Stop'
$releaseTag = if ($env:GREYBEARD_RELEASE_TAG) { $env:GREYBEARD_RELEASE_TAG } else { 'v0.1.0' }
$releaseHash = $env:GREYBEARD_RELEASE_SHA256
$localAsset = $env:GREYBEARD_RELEASE_FILE
if ($releaseTag -notmatch '^[a-zA-Z0-9._-]+$' -or $releaseHash -notmatch '^[a-fA-F0-9]{64}$') {
  throw 'Set GREYBEARD_RELEASE_TAG to a companion release and GREYBEARD_RELEASE_SHA256 to its installer hash. You can set GREYBEARD_RELEASE_FILE to an already downloaded installer.'
}
if (-not [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)) { throw 'Use the Mac DMG or Linux AppImage on your platform.' }
$cpu = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($cpu -ne 'x64') { throw 'This installer supports Windows x64.' }
$releaseVersion = $releaseTag -replace '^v', ''
$assetName = "Greybeard-$releaseVersion-windows-x64-setup.exe"
$temporaryDir = Join-Path ([System.IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $temporaryDir | Out-Null
$temporary = Join-Path $temporaryDir $assetName
try {
  if ($localAsset) { Copy-Item -LiteralPath $localAsset -Destination $temporary }
  elseif (Get-Command gh -ErrorAction SilentlyContinue) {
    & gh release download $releaseTag --repo OpenAdminOS/greybeard --pattern $assetName --dir $temporaryDir
    if ($LASTEXITCODE -ne 0) { throw 'Release download failed. Use a GitHub account with repository access or a downloaded installer.' }
  } else { throw 'Download the companion installer and set GREYBEARD_RELEASE_FILE, or use authenticated GitHub CLI access.' }
  if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $releaseHash) { throw 'Installer checksum verification failed.' }
  $signature = Get-AuthenticodeSignature -LiteralPath $temporary
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=Ugurlabs UG \(haftungsbeschränkt\)' -or -not $signature.TimeStamperCertificate) { throw 'The installer does not have the expected valid publisher signature and timestamp.' }
  $result = Start-Process -FilePath $temporary -Wait -PassThru
  if ($result.ExitCode -ne 0) { throw "The companion installer exited with code $($result.ExitCode)." }
  Write-Host 'Greybeard companion installed. Open Greybeard from the Start menu to select AI tools and review memory.'
} finally { Remove-Item -LiteralPath $temporaryDir -Recurse -Force }
