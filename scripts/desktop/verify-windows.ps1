param([Parameter(Mandatory)][string]$Directory)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $Directory).Path
$publisherExpected = 'Ugurlabs UG (haftungsbeschränkt)'
$files = @(Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.Extension -in @('.exe', '.dll') })
if ($files.Count -lt 3) { throw 'Installer, application, and embedded CLI must all be present.' }
$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
$tool = Get-ChildItem -Path $sdkRoot -Filter signtool.exe -Recurse -File |
  Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $tool) { throw 'Windows SDK signtool is required for release verification.' }
foreach ($file in $files) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  if ($signature.Status -ne 'Valid') { throw "Invalid Authenticode signature: $($file.Name)." }
  $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if ($publisher -ne $publisherExpected) { throw "Unexpected publisher: $($file.Name)." }
  if (-not $signature.TimeStamperCertificate) { throw "Missing trusted timestamp: $($file.Name)." }
  & $tool.FullName verify /pa /all /q $file.FullName
  if ($LASTEXITCODE -ne 0) { throw "Signature chain verification failed: $($file.Name)." }
}
Write-Host "Verified publisher and trusted timestamps for $($files.Count) Windows executables and libraries."
