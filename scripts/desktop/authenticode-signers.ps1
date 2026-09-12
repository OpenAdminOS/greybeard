# Read embedded PE signatures, not Windows catalog selection. Trust of every
# signature and its timestamp is still checked independently by SignTool /all.
Add-Type -AssemblyName System.Security.Cryptography.Pkcs
function Get-CmsSigners([byte[]]$Encoded, [int]$Depth = 0) {
  if ($Depth -gt 8) { throw 'Embedded signature nesting exceeds the verification limit.' }
  $cms = [System.Security.Cryptography.Pkcs.SignedCms]::new()
  $cms.Decode($Encoded)
  if ($cms.ContentInfo.ContentType.Value -ne '1.3.6.1.4.1.311.2.1.4') { throw 'Expected Authenticode indirect data.' }
  foreach ($signer in $cms.SignerInfos) {
    # This checks the actual SignerInfo signature, never just membership in the
    # CMS certificate collection. Native SignTool separately verifies PE hashes.
    $signer.CheckSignature($true)
    if (-not $signer.Certificate) { throw 'Embedded signer certificate is missing.' }
    $timestampValid = $false
    foreach ($attribute in $signer.UnsignedAttributes) {
      if ($attribute.Oid.Value -ne '1.3.6.1.4.1.311.3.3.1') { continue }
      foreach ($value in $attribute.Values) {
        [System.Security.Cryptography.Pkcs.Rfc3161TimestampToken]$token = $null
        [int]$consumed = 0
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$tsa = $null
        $decoded = [System.Security.Cryptography.Pkcs.Rfc3161TimestampToken]::TryDecode([System.ReadOnlyMemory[byte]]::new($value.RawData), [ref]$token, [ref]$consumed)
        if ($decoded -and $consumed -eq $value.RawData.Length -and
            $token.VerifySignatureForSignerInfo($signer, [ref]$tsa, $null)) { $timestampValid = $true }
      }
    }
    [pscustomobject]@{
      Publisher = $signer.Certificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
      Timestamp = $timestampValid
      Digest = $signer.DigestAlgorithm.Value
    }
    foreach ($attribute in $signer.UnsignedAttributes) {
      if ($attribute.Oid.Value -ne '1.3.6.1.4.1.311.2.4.1') { continue }
      foreach ($value in $attribute.Values) { Get-CmsSigners -Encoded $value.RawData -Depth ($Depth + 1) }
    }
  }
}

function Get-EmbeddedSigners([string]$Path) {
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -lt 64 -or $bytes[0] -ne 0x4d -or $bytes[1] -ne 0x5a) { throw 'Invalid PE header.' }
  $pe = [BitConverter]::ToInt32($bytes, 0x3c)
  if ($pe -lt 64 -or $pe -gt ($bytes.Length - 152) -or [BitConverter]::ToUInt32($bytes, $pe) -ne 0x4550) { throw 'Invalid PE offset.' }
  $optional = $pe + 24
  $magic = [BitConverter]::ToUInt16($bytes, $optional)
  $directories = switch ($magic) { 0x20b { $optional + 112 }; 0x10b { $optional + 96 }; default { throw 'Unsupported PE header.' } }
  if ($directories -gt ($bytes.Length - 40)) { throw 'Missing security directory.' }
  [long]$offset = [BitConverter]::ToUInt32($bytes, $directories + 32)
  [long]$size = [BitConverter]::ToUInt32($bytes, $directories + 36)
  if ($offset -lt ($directories + 40) -or $size -lt 8 -or ($offset + $size) -gt $bytes.Length) { throw 'Invalid certificate table bounds.' }
  $end = $offset + $size
  while ($offset -lt $end) {
    if (($end - $offset) -lt 8) { throw 'Incomplete certificate entry.' }
    [long]$length = [BitConverter]::ToUInt32($bytes, [int]$offset)
    if ($length -le 8 -or ($offset + $length) -gt $end) { throw 'Invalid certificate entry bounds.' }
    if ([BitConverter]::ToUInt16($bytes, [int]($offset + 6)) -ne 2) { throw 'Expected a PKCS signed certificate entry.' }
    $encoded = [byte[]]::new([int]($length - 8))
    [Array]::Copy($bytes, $offset + 8, $encoded, 0, $encoded.Length)
    Get-CmsSigners -Encoded $encoded
    $offset += [long]([Math]::Ceiling($length / 8.0) * 8)
  }
}
