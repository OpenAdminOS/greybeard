param(
  [Parameter(Mandatory)][ValidateSet('remove', 'verify')][string]$Operation,
  [Parameter(Mandatory)][string]$BinaryPath,
  [string]$ExpectedPublisher = 'Ugurlabs UG (haftungsbeschränkt)',
  [string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$binary = (Resolve-Path -LiteralPath $BinaryPath).Path
$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
$tool = Get-ChildItem -Path $sdkRoot -Filter signtool.exe -Recurse -File |
  Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $tool) { throw 'Windows SDK x64 signtool.exe is required to prepare and verify Windows releases.' }
if ($Operation -eq 'remove') {
  & $tool.FullName remove /s $binary
  if ($LASTEXITCODE -ne 0) { throw "Removing the inherited Node signature failed ($LASTEXITCODE)." }
  exit 0
}
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '../package.json') -Raw | ConvertFrom-Json).version
$properties = (Get-Item -LiteralPath $binary).VersionInfo
if ($properties.ProductName -ne 'Greybeard' -or $properties.CompanyName -ne 'Ugurlabs' -or $properties.FileDescription -ne 'Greybeard IT mentor' -or $properties.FileVersion -ne "$version.0" -or $properties.ProductVersion -ne "$version.0") { throw 'Windows executable product/version properties do not match Greybeard.' }
$signature = Get-AuthenticodeSignature -LiteralPath $binary
if ($signature.Status -ne 'Valid') { throw "Invalid Windows signature: $($signature.Status)." }
$publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
if ($publisher -ne $ExpectedPublisher) { throw "Unexpected publisher '$publisher'; expected '$ExpectedPublisher'." }
if (-not $signature.TimeStamperCertificate) { throw 'The executable lacks a trusted timestamp.' }
& $tool.FullName verify /pa /all /v $binary
if ($LASTEXITCODE -ne 0) { throw "Windows signature/timestamp verification failed ($LASTEXITCODE)." }

# Inspect the embedded SignedData rather than inferring digest algorithms from
# certificate thumbprints or the signing command's requested options.
Add-Type -AssemblyName System.Security.Cryptography.Pkcs
$bytes = [System.IO.File]::ReadAllBytes($binary)
$pe = [BitConverter]::ToInt32($bytes, 0x3c)
$optional = $pe + 24
$magic = [BitConverter]::ToUInt16($bytes, $optional)
$dataDirectories = switch ($magic) { 0x20b { $optional + 112 }; 0x10b { $optional + 96 }; default { throw 'Unsupported PE optional header.' } }
$certificateOffset = [BitConverter]::ToInt32($bytes, $dataDirectories + 32)
$certificateSize = [BitConverter]::ToInt32($bytes, $certificateOffset)
if ($certificateOffset -le 0 -or $certificateSize -le 8 -or ($certificateOffset + $certificateSize) -gt $bytes.Length) { throw 'Invalid embedded certificate bounds.' }
$encoded = New-Object byte[] ($certificateSize - 8)
[Array]::Copy($bytes, $certificateOffset + 8, $encoded, 0, $encoded.Length)
$cms = [System.Security.Cryptography.Pkcs.SignedCms]::new()
$cms.Decode($encoded)
$sha256Oid = '2.16.840.1.101.3.4.2.1'
if ($cms.SignerInfos.Count -ne 1 -or $cms.SignerInfos[0].DigestAlgorithm.Value -ne $sha256Oid) { throw 'Expected one SHA-256 Authenticode signer.' }
$timestampVerified = $false
foreach ($attribute in $cms.SignerInfos[0].UnsignedAttributes) {
  if ($attribute.Oid.Value -ne '1.3.6.1.4.1.311.3.3.1') { continue }
  foreach ($value in $attribute.Values) {
    [System.Security.Cryptography.Pkcs.Rfc3161TimestampToken]$timestampToken = $null
    [int]$consumed = 0
    $decoded = [System.Security.Cryptography.Pkcs.Rfc3161TimestampToken]::TryDecode([System.ReadOnlyMemory[byte]]::new($value.RawData), [ref]$timestampToken, [ref]$consumed)
    if ($decoded -and $consumed -eq $value.RawData.Length -and $timestampToken.TokenInfo.HashAlgorithmId.Value -eq $sha256Oid) { $timestampVerified = $true }
  }
}
if (-not $timestampVerified) { throw 'Expected an RFC3161 timestamp with SHA-256 digest.' }
Write-Host "Verified publisher $publisher, Authenticode SHA-256, trusted RFC3161 SHA-256 timestamp."

if ($OutputPath) {
  @{ status = 'verified'; publisher = $publisher; fileDigest = 'SHA256'; timestampDigest = 'SHA256'; timestampType = 'RFC3161'; sha256 = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant(); productVersion = $properties.ProductVersion } |
    ConvertTo-Json | Set-Content -LiteralPath $OutputPath -Encoding utf8NoBOM
}
