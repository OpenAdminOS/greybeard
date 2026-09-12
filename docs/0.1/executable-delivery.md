# Install Greybeard

[Download Greybeard 0.1.2](https://github.com/OpenAdminOS/greybeard/releases/tag/v0.1.2). This release bundles the native companion, CLI, MCP services, skills and local SQLite memory. No developer tools or tenant connection are needed.

## Windows x64

Download `Greybeard-0.1.2-windows-x64-setup.exe` and `SHA256SUMS.txt`. Compare the installer hash with its entry:

```powershell
Get-FileHash "$env:USERPROFILE\Downloads\Greybeard-0.1.2-windows-x64-setup.exe" -Algorithm SHA256
```

Run the publisher-signed installer and open Greybeard from Start. Follow the detected-tool setup, then restart your selected AI tools. The bundled CLI is at `resources\bin\greybeard.exe` inside the installation directory; it is not a separate download.

## Apple Silicon Mac

Requires macOS 14 or later. Download `Greybeard-0.1.2-mac-arm64.dmg` and compare its checksum:

```sh
shasum -a 256 "$HOME/Downloads/Greybeard-0.1.2-mac-arm64.dmg"
```

Open the DMG, drag Greybeard to Applications, eject the image, then open Greybeard. Both the app and disk image are Developer ID signed and notarized. Terminal setup is also available:

```sh
"/Applications/Greybeard.app/Contents/MacOS/greybeard" setup
```

## Linux x64

Download `Greybeard-0.1.2-linux-x64.AppImage` and compare its checksum:

```sh
sha256sum "$HOME/Downloads/Greybeard-0.1.2-linux-x64.AppImage"
chmod +x "$HOME/Downloads/Greybeard-0.1.2-linux-x64.AppImage"
```

Move it to a permanent location before setup, then open it. Linux is unsigned: the checksum checks integrity, not publisher identity. Depending on your distribution, AppImage support may require FUSE 2. The extracted MCP runtime lives in application data so it can run outside an AppImage mount.

## Optional terminal installers

Download `install.sh` or `install.ps1` from the same release and review it before execution. Set the expected installer hash from `SHA256SUMS.txt`. The scripts accept an already downloaded file through `GREYBEARD_RELEASE_FILE`, or download from the public release.

macOS or Linux:

```sh
GREYBEARD_RELEASE_SHA256='<matching DMG or AppImage SHA-256>' sh install.sh
```

Windows PowerShell:

```powershell
$env:GREYBEARD_RELEASE_SHA256 = '<matching Windows installer SHA-256>'
.\install.ps1
```

The shell installer refuses to overwrite an existing installation. Use normal manual replacement for upgrades. Windows uses the normal signed setup application. No tenant credentials belong in these commands.

## Upgrades, data and updates

Close Greybeard and connected AI tools before installing. Preserve your local data directory and retain the previous installer for recovery. After installation, rerun setup under **AI tools**, review conflicts, fully restart the tools, and trust new or changed Greybeard hooks in Codex `/hooks`.

The legacy `v0.1.0` executable requires manual installation of the companion. Companion releases include `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, and the complete application assets used by the updater. Notify checks without downloading; Automatic downloads an available update; installation requires an explicit restart. See [updates and recovery](companion.md#updates-and-recovery).

## Release verification

Each platform includes a verification report and SHA-256 manifest. Windows verification checks the installer and application publisher signatures; macOS verification checks the installed app, notarization, and both ZIP and DMG payloads. Linux provides integrity verification only. The combined `SHA256SUMS.txt` covers the uploaded application assets, reports, platform manifests and installer scripts.

Publisher credentials remain in repository Actions secrets, with temporary signing files outside the packaged application. See [packaging and signing](../../scripts/desktop/README.md) for maintainers' instructions. Never commit certificates, private keys, client secrets, or memory databases.
