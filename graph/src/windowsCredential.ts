import { execFile } from "node:child_process";
import { win32 } from "node:path";

// Fixed code, never interpolated with user input. Windows PowerShell 5.1 supplies
// FileStream.GetAccessControl, which inspects the same handle that is read.
const READ_PROTECTED_KEY = String.raw`
$ErrorActionPreference = 'Stop'
try {
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class GreybeardProtectedKey {
  [StructLayout(LayoutKind.Sequential)] struct Info {
    public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
    public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint GetFileType(SafeFileHandle handle);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint length, uint flags);
  static void CheckPath(string path) {
    for (string part = path; !String.IsNullOrEmpty(part); part = Path.GetDirectoryName(part)) {
      if ((File.GetAttributes(part) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("reparse-point");
    }
  }
  static string CheckAcl(FileStream stream) {
    var acl = stream.GetAccessControl();
    var current = WindowsIdentity.GetCurrent().User.Value;
    if (acl.GetOwner(typeof(SecurityIdentifier)).Value != current) throw new InvalidOperationException("owner");
    var raw = new RawSecurityDescriptor(acl.GetSecurityDescriptorBinaryForm(), 0);
    if ((raw.ControlFlags & ControlFlags.DiscretionaryAclPresent) == 0 || raw.DiscretionaryAcl == null) throw new InvalidOperationException("unrestricted-acl");
    foreach (GenericAce ace in raw.DiscretionaryAcl) {
      var common = ace as CommonAce;
      if (common == null || common.IsCallback || (common.AceQualifier != AceQualifier.AccessAllowed && common.AceQualifier != AceQualifier.AccessDenied)) throw new InvalidOperationException("unsupported-acl");
    }
    foreach (FileSystemAccessRule rule in acl.GetAccessRules(true, true, typeof(SecurityIdentifier))) {
      string sid = rule.IdentityReference.Value;
      // SYSTEM and local Administrators are the OS recovery boundary and can
      // already take ownership. No other group or user may have an allow ACE.
      if (rule.AccessControlType == AccessControlType.Allow && sid != current && sid != "S-1-5-18" && sid != "S-1-5-32-544") throw new InvalidOperationException("shared-acl");
    }
    return acl.GetSecurityDescriptorSddlForm(AccessControlSections.Access | AccessControlSections.Owner);
  }
  public static byte[] Read(string input) {
    string path = Path.GetFullPath(input);
    if (path.Length < 3 || path[1] != ':' || path[2] != '\\' || path.Substring(2).Contains(":")) throw new InvalidOperationException("local-path");
    CheckPath(path);
    // OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT; only other readers may share.
    using (var handle = CreateFile(path, 0x80000000, 1, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero)) {
      if (handle.IsInvalid) throw new InvalidOperationException("open");
      Info info;
      if (GetFileType(handle) != 1 || !GetFileInformationByHandle(handle, out info) || (info.Attributes & (0x400 | 0x10)) != 0 || info.SizeHigh != 0 || info.SizeLow > 65536 || info.Links != 1) throw new InvalidOperationException("file-type-or-size");
      var final = new StringBuilder(32768);
      uint length = GetFinalPathNameByHandle(handle, final, (uint)final.Capacity, 0);
      if (length == 0 || length >= final.Capacity || !String.Equals(final.ToString(), @"\\?\" + path, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("redirected-path");
      CheckPath(path);
      using (var stream = new FileStream(handle, FileAccess.Read)) {
        string before = CheckAcl(stream);
        byte[] bytes = new byte[info.SizeLow];
        int offset = 0, read;
        while (offset < bytes.Length && (read = stream.Read(bytes, offset, bytes.Length - offset)) > 0) offset += read;
        if (offset != bytes.Length || stream.ReadByte() != -1 || before != CheckAcl(stream)) throw new InvalidOperationException("changed-file");
        return bytes;
      }
    }
  }
}
'@
$bytes = [GreybeardProtectedKey]::Read($env:GREYBEARD_CREDENTIAL_PATH)
[Console]::Out.Write([Convert]::ToBase64String($bytes))
} catch {
  $reason = $_.Exception
  while ($reason.InnerException) { $reason = $reason.InnerException }
  $known = @('reparse-point','owner','unrestricted-acl','unsupported-acl','shared-acl','local-path','open','file-type-or-size','redirected-path','changed-file')
  if ($known -contains $reason.Message) { [Console]::Out.Write('GB_KEY_' + $reason.Message) }
  else { [Console]::Out.Write('GB_KEY_verification-unavailable') }
  exit 1
}
`;

export function readWindowsProtectedKey(path: string): Promise<string> {
  if (process.platform !== "win32") return Promise.reject(new Error("Windows credential protection is only available on Windows."));
  // Disallow network paths, device namespaces and alternate data streams.
  if (!/^[a-z]:[\\/]/i.test(path) || path.slice(2).includes(":") || path.includes("\0")) return Promise.reject(new Error("Windows private key requires an absolute local-drive file path."));
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !/^[a-z]:[\\/]/i.test(systemRoot)) return Promise.reject(new Error("Windows system directory is unavailable; credential protection cannot be verified."));
  const powershell = win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return new Promise((resolve, reject) => {
    execFile(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(READ_PROTECTED_KEY, "utf16le").toString("base64")], {
      windowsHide: true, timeout: 20_000, maxBuffer: 100 * 1024,
      env: { ...process.env, GREYBEARD_CREDENTIAL_PATH: path }
    }, (error, stdout) => {
      if (error) {
        // Windows PowerShell -EncodedCommand can append CLIXML progress records
        // to stderr. The fixed failure protocol uses stdout, which has no key on
        // a failed ACL check; consume only an exact allowlisted diagnostic.
        const reason = /^GB_KEY_(reparse-point|owner|unrestricted-acl|unsupported-acl|shared-acl|local-path|open|file-type-or-size|redirected-path|changed-file|verification-unavailable)$/.exec(stdout.trim())?.[1] ?? "verification-unavailable";
        // Never surface execFile's error object: it can include stdout/key bytes.
        reject(new Error(`Windows private-key protection failed (${reason}). Use a regular local file owned by your account with access limited to you, SYSTEM and local Administrators. Symlinks, junctions and shared files are rejected.`));
        return;
      }
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(stdout) || Buffer.byteLength(stdout, "base64") > 65536) { reject(new Error("Windows credential reader returned an invalid response.")); return; }
      resolve(Buffer.from(stdout, "base64").toString("utf8"));
    });
  });
}
