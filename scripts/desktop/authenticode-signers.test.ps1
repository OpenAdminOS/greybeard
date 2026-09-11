$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'authenticode-signers.ps1')
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function New-TestCertificate([string]$Name, [bool]$Timestamp = $false) {
  $key = [System.Security.Cryptography.RSA]::Create(2048)
  $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new("CN=$Name", $key, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
  $oids = [System.Security.Cryptography.OidCollection]::new()
  $null = $oids.Add([System.Security.Cryptography.Oid]::new($(if ($Timestamp) { '1.3.6.1.5.5.7.3.8' } else { '1.3.6.1.5.5.7.3.3' })))
  $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids, $true))
  return $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1), [DateTimeOffset]::UtcNow.AddDays(1))
}
function New-SignedCms($Certificate, [byte[]]$Data, [string]$ContentOid = '1.3.6.1.4.1.311.2.1.4') {
  $cms = [System.Security.Cryptography.Pkcs.SignedCms]::new([System.Security.Cryptography.Pkcs.ContentInfo]::new([System.Security.Cryptography.Oid]::new($ContentOid), $Data))
  $signer = [System.Security.Cryptography.Pkcs.CmsSigner]::new($Certificate)
  $signer.DigestAlgorithm = [System.Security.Cryptography.Oid]::new('2.16.840.1.101.3.4.2.1')
  if ($ContentOid -eq '1.2.840.113549.1.9.16.1.4') {
    # RFC5816 SigningCertificateV2: sequence(certs sequence(ESSCertIDv2
    # sequence(certHash octet string))). SHA256 is its default hash algorithm.
    $certHash = [System.Security.Cryptography.SHA256]::HashData($Certificate.RawData)
    $ess = [byte[]](@(0x30,0x26,0x30,0x24,0x30,0x22,0x04,0x20) + $certHash)
    $null = $signer.SignedAttributes.Add([System.Security.Cryptography.AsnEncodedData]::new([System.Security.Cryptography.Oid]::new('1.2.840.113549.1.9.16.2.47'), $ess))
  }
  $cms.ComputeSignature($signer)
  return $cms
}
function Add-TestTimestamp($Cms, $Tsa) {
  $hash = [System.Security.Cryptography.SHA256]::HashData($Cms.SignerInfos[0].GetSignature())
  $info = [System.Security.Cryptography.Pkcs.Rfc3161TimestampTokenInfo]::new(
    [System.Security.Cryptography.Oid]::new('1.2.3.4'), [System.Security.Cryptography.Oid]::new('2.16.840.1.101.3.4.2.1'),
    [System.ReadOnlyMemory[byte]]::new($hash), [System.ReadOnlyMemory[byte]]::new([byte[]](1)),
    [DateTimeOffset]::UtcNow, $null, $false, $null, $null, $null)
  $timestamp = New-SignedCms $Tsa $info.Encode() '1.2.840.113549.1.9.16.1.4'
  $Cms.SignerInfos[0].AddUnsignedAttribute([System.Security.Cryptography.AsnEncodedData]::new([System.Security.Cryptography.Oid]::new('1.3.6.1.4.1.311.3.3.1'), $timestamp.Encode()))
}
$owned = New-TestCertificate 'Ugurlabs fixture'
$vendor = New-TestCertificate 'Vendor fixture'
$tsa = New-TestCertificate 'Timestamp fixture' $true
$directory = Join-Path ([IO.Path]::GetTempPath()) ('greybeard-signers-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $directory
try {
  $secondary = New-SignedCms $owned ([byte[]](0x30, 0x00))
  Add-TestTimestamp $secondary $tsa
  $primary = New-SignedCms $vendor ([byte[]](0x30, 0x00))
  Add-TestTimestamp $primary $tsa
  $primary.SignerInfos[0].AddUnsignedAttribute([System.Security.Cryptography.AsnEncodedData]::new([System.Security.Cryptography.Oid]::new('1.3.6.1.4.1.311.2.4.1'), $secondary.Encode()))
  $records = @(Get-CmsSigners $primary.Encode())
  Assert ($records.Count -eq 2) 'Nested actual signers must both be enumerated.'
  Assert (@($records | Where-Object { $_.Publisher -eq 'Ugurlabs fixture' -and $_.Timestamp }).Count -eq 1) 'A valid publisher timestamp must bind to its actual nested signer.'

  $decoy = New-SignedCms $vendor ([byte[]](0x30, 0x00))
  $decoy.AddCertificate($owned)
  Assert (@(Get-CmsSigners $decoy.Encode() | Where-Object Publisher -eq 'Ugurlabs fixture').Count -eq 0) 'A certificate in the bag is not a signer.'
  $untimed = New-SignedCms $owned ([byte[]](0x30, 0x03, 0x02, 0x01, 0x01))
  Assert (-not (@(Get-CmsSigners $untimed.Encode())[0].Timestamp)) 'An untimestamped signer must remain untimestamped.'
  # Reusing another signature's real timestamp must fail binding verification.
  $foreignTimestamp = $secondary.SignerInfos[0].UnsignedAttributes | Where-Object { $_.Oid.Value -eq '1.3.6.1.4.1.311.3.3.1' }
  $untimed.SignerInfos[0].AddUnsignedAttribute([System.Security.Cryptography.AsnEncodedData]::new($foreignTimestamp.Oid, $foreignTimestamp.Values[0].RawData))
  Assert (-not (@(Get-CmsSigners $untimed.Encode())[0].Timestamp)) 'A timestamp over another signer cannot be reused.'

  $tampered = $secondary.Encode()
  $signatureBytes = $secondary.SignerInfos[0].GetSignature()
  $signatureOffset = -1
  for ($i = 0; $i -le ($tampered.Length - $signatureBytes.Length); $i++) {
    if ($tampered[$i] -ne $signatureBytes[0]) { continue }
    $same = $true
    for ($j = 0; $j -lt $signatureBytes.Length; $j++) {
      if ($tampered[$i + $j] -ne $signatureBytes[$j]) { $same = $false; break }
    }
    if ($same) { $signatureOffset = $i; break }
  }
  Assert ($signatureOffset -ge 0) 'Fixture signature bytes must be found.'
  $tampered[$signatureOffset] = $tampered[$signatureOffset] -bxor 1
  $rejected = $false
  try { Get-CmsSigners $tampered | Out-Null } catch { $rejected = $true }
  Assert $rejected 'A tampered SignerInfo must fail cryptographic verification.'

  # Real SignedCms bytes inside a bounded synthetic PE certificate table exercise
  # parsing; these fixtures are not trusted Windows binaries or release proof.
  $encoded = $primary.Encode()
  $length = $encoded.Length + 8
  $padded = [int]([Math]::Ceiling($length / 8.0) * 8)
  $bytes = [byte[]]::new(512 + $padded)
  $bytes[0] = 0x4d; $bytes[1] = 0x5a
  [BitConverter]::GetBytes([int]64).CopyTo($bytes, 0x3c)
  [BitConverter]::GetBytes([int]0x4550).CopyTo($bytes, 64)
  [BitConverter]::GetBytes([uint16]0x20b).CopyTo($bytes, 88)
  [BitConverter]::GetBytes([uint32]512).CopyTo($bytes, 232)
  [BitConverter]::GetBytes([uint32]$padded).CopyTo($bytes, 236)
  [BitConverter]::GetBytes([uint32]$length).CopyTo($bytes, 512)
  [BitConverter]::GetBytes([uint16]0x200).CopyTo($bytes, 516)
  [BitConverter]::GetBytes([uint16]2).CopyTo($bytes, 518)
  $encoded.CopyTo($bytes, 520)
  $file = Join-Path $directory 'fixture.dll'
  [IO.File]::WriteAllBytes($file, $bytes)
  Assert (@(Get-EmbeddedSigners $file).Count -eq 2) 'PE parser must return the two actual signatures.'
  [BitConverter]::GetBytes([uint32]::MaxValue).CopyTo($bytes, 236)
  [IO.File]::WriteAllBytes($file, $bytes)
  $rejected = $false
  try { Get-EmbeddedSigners $file | Out-Null } catch { $rejected = $true }
  Assert $rejected 'Out-of-bounds certificate tables must fail.'
  Write-Output 'Embedded signer, nested signature, certificate decoy, timestamp binding and PE bounds regressions passed.'
} finally {
  Remove-Item -LiteralPath $directory -Recurse -Force
  $owned.Dispose(); $vendor.Dispose(); $tsa.Dispose()
}
