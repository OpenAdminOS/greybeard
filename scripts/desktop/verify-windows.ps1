param([Parameter(Mandatory)][string]$Directory)
$ErrorActionPreference = 'Stop'
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
    if ($diagnostic.publisher -ne $publisherExpected) { Stop-SignatureVerification 'publisher-mismatch' }
    if (-not $signature.TimeStamperCertificate) { Stop-SignatureVerification 'missing-timestamp' }
    & $tool.FullName verify /pa /all /q $file.FullName
    if ($LASTEXITCODE -ne 0) { Stop-SignatureVerification 'signature-chain-failed' }
  }
  Write-Host "Verified publisher and trusted timestamps for $($files.Count) Windows executables and libraries."
} catch {
  # Exception text may include paths or process arguments. Export only our fixed stage.
  Stop-SignatureVerification 'inspection-command-failed'
}
