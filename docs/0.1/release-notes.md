# Greybeard 0.1.2

Share approved memories between your computers while keeping the same simple local setup. Shared memory is optional and lives under **App preferences > Advanced**.

## What's new

- **One private memory store across computers.** Run the headless Greybeard server behind private HTTPS and pair your devices with single-use codes. Your connected AI tools can use the same approved lessons through MCP and automatic mentoring hooks.
- **Shared review and control.** Review exact candidate text, confirm or correct lessons, export memories, and use the memory map across devices. Pause one device or pause the shared store for everyone.
- **Protected device credentials.** Each device stores its credentials in native OS protection. Server owners can grant separate review authority and revoke individual devices. Server backup and credential-reset commands support recovery.
- **More reliable Windows automatic recall.** The hook allows for native protected-credential startup while retaining a bounded timeout. When the server is unavailable, hooks return without shared advice and do not silently switch to another memory store.

Local memory remains the default. Pairing preserves your existing local memories and does not upload them automatically. Disconnecting returns to that retained local store. Shared-memory candidates still require exact review before they become guidance.

## Download and install

- **Windows x64:** `Greybeard-0.1.2-windows-x64-setup.exe`. Run the publisher-signed installer, then open Greybeard from Start.
- **Apple Silicon Mac, macOS 14+:** `Greybeard-0.1.2-mac-arm64.dmg`. Drag Greybeard to Applications, eject the image, then open the app. The application and DMG are Developer ID signed and notarized.
- **Linux x64:** `Greybeard-0.1.2-linux-x64.AppImage`. Mark it executable and open it from a permanent location. Linux uses SHA-256 integrity checks rather than a publisher signature.

Compare your download with `SHA256SUMS.txt` attached to this release. The Mac ZIP contains the complete application for updates; use the DMG for first installation. No Node, npm, Git, or Microsoft tenant connection is required to get started.

## Upgrading from 0.1.1

Close Greybeard and its connected AI tools, install the new companion, and keep your existing Greybeard data directory. Open **AI tools** to refresh integration paths, review any conflicts, then fully restart the selected tools. Review new or changed hooks in Codex `/hooks`.

Existing local users can continue without configuring a server. To share memory, follow the [private-server and pairing guide](https://github.com/OpenAdminOS/greybeard/blob/v0.1.2/docs/0.1.2/shared-memory.md). Shared mode sends relevant mentoring text to your chosen private server and requires its availability for shared recall. Keep the server's SQLite database on its local disk, not a network share.

The [0.1.1 release](https://github.com/OpenAdminOS/greybeard/releases/tag/v0.1.1) remains available. Older versions do not support shared-memory connections; disconnect shared mode before returning to them.

## Verification

Actual Claude Code conversations on Windows and an Apple Silicon Mac shared reviewed preferences over Tailscale. Validation covered later-session automatic recall, shared pause, outages, backup restoration, and credential cleanup. See the [device evidence and validation limits](https://github.com/OpenAdminOS/greybeard/blob/v0.1.2/evaluations/shared-memory-0.1.2/README.md).

Greybeard remains a 0.1 research preview. It provides advice; your AI tool's permissions and normal change controls still apply. Intel Mac and native Windows ARM64 installers are not included.

Implemented in [#6](https://github.com/OpenAdminOS/greybeard/pull/6), addressing [#5](https://github.com/OpenAdminOS/greybeard/issues/5).
