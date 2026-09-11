param([Parameter(Mandatory)][string]$Directory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'authenticode-signers.ps1')
$publisherExpected = 'Ugurlabs UG (haftungsbeschränkt)'
$diagnostic = @{ file = ''; status = 'not-inspected'; publisher = ''; timestamp = $false }
function Stop-SignatureVerification([string]$Code) {
  $record = @{ code = $Code; file = $diagnostic.file; status = $diagnostic.status; publisher = $diagnostic.publisher; timestamp = $diagnostic.timestamp }
  Write-Output ('GREYBEARD_SIGNATURE_DIAGNOSTIC ' + ($record | ConvertTo-Json -Compress))
  exit 1
}
try {
  $root = (Resolve-Path -LiteralPath $Directory).Path
  $files = @(Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.Extension -in @('.exe', '.dll') })
  if ($files.Count -lt 3) { Stop-SignatureVerification 'missing-distribution-files' }
  $sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  $tool = Get-ChildItem -Path $sdkRoot -Filter signtool.exe -Recurse -File |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $tool) { Stop-SignatureVerification 'missing-sdk-signtool' }
  foreach ($file in $files) {
    $diagnostic = @{ file = $file.Name; status = 'not-inspected'; publisher = ''; timestamp = $false }
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    $diagnostic.status = [string]$signature.Status
    if ($signature.SignerCertificate) {
      $diagnostic.publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    }
    $diagnostic.timestamp = [bool]$signature.TimeStamperCertificate
    Write-Output ('GREYBEARD_SIGNATURE_DIAGNOSTIC ' + ((@{ code = 'inspected' } + $diagnostic) | ConvertTo-Json -Compress))
    if ($signature.Status -ne 'Valid') { Stop-SignatureVerification 'invalid-authenticode' }
    # Get-AuthenticodeSignature may prefer the original Microsoft catalog. The
    # distributed bytes must carry our own actual, cryptographically valid signer.
    $embedded = @(Get-EmbeddedSigners -Path $file.FullName)
    $owned = @($embedded | Where-Object { $_.Publisher -eq $publisherExpected })
    if (-not $owned.Count) { Stop-SignatureVerification 'publisher-mismatch' }
    $current = @($owned | Where-Object { $_.Timestamp -and $_.Digest -eq '2.16.840.1.101.3.4.2.1' })
    if (-not $current.Count) { Stop-SignatureVerification 'missing-timestamp' }
    $diagnostic.publisher = $publisherExpected
    $diagnostic.timestamp = $true
    Write-Output ('GREYBEARD_SIGNATURE_DIAGNOSTIC ' + ((@{ code = 'embedded-signer-verified' } + $diagnostic) | ConvertTo-Json -Compress))
    # No /a: verify embedded signatures rather than choosing a catalog. /tw fails
    # on a missing timestamp; /all retains verification of every embedded signer.
    & $tool.FullName verify /pa /all /tw /q $file.FullName
    if ($LASTEXITCODE -ne 0) { Stop-SignatureVerification 'signature-chain-failed' }
  }
  Write-Host "Verified publisher and trusted timestamps for $($files.Count) Windows executables and libraries."
} catch {
  # Exception text may include paths or process arguments. Export only our fixed stage.
  Stop-SignatureVerification 'inspection-command-failed'
}
