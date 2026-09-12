# Greybeard 0.1.1

The desktop companion for Greybeard's 0.1 research preview. Review what Greybeard learns, connect your AI tools, and carry approved lessons into later work without a browser tab.

## Download and install

- **Windows x64:** download `Greybeard-0.1.1-windows-x64-setup.exe`, run it, then open Greybeard from Start. The installer and application are publisher-signed through Azure Trusted Signing.
- **Apple Silicon Mac, macOS 14+:** download `Greybeard-0.1.1-mac-arm64.dmg`, drag Greybeard to Applications, eject the disk image, then open the app. The app and DMG are Developer ID signed and notarized.
- **Linux x64:** download `Greybeard-0.1.1-linux-x64.AppImage`, mark it executable, and open it from a permanent location. Linux uses SHA-256 integrity checks, not a publisher signature.

Compare your download with `SHA256SUMS.txt` from this release. The Mac ZIP is the complete signed application used for updates; the DMG is the normal first-install download. No Node, npm, Git, or Microsoft tenant connection is required to start.

## Included

- Native companion for first-run setup, integration status, memory review, corrections, forgetting, advice activity, and preferences.
- Automatic discovery of supported AI tools, reviewed conflict repair, and setup results that distinguish installed configuration from observed host activity.
- Automatic mentoring through supported Claude Code/Desktop Code, Codex, Gemini, Copilot CLI and Cursor events. Cursor prompt advice appears in the companion; its supported session/tool events provide model context. Ordinary Claude Desktop Chat remains MCP-assisted.
- Proposed operating preferences stay inactive until you approve their exact wording. Confirmed lessons can inform later relevant work across connected tools.
- A larger interactive memory globe with exact details, saved-time filtering, correction links, and an accessible flat view.
- Optional infrastructure connection with your own app registration, using a client secret in protected OS storage or a certificate. No connection is required for local memory.
- Complete-application update checks, optional downloads, and retained previous-app recovery. Notify is the default; installing an update requires an explicit restart.

## Upgrading

Close Greybeard and the connected AI tools before installing. Keep your local Greybeard data directory. The companion uses the existing memory database; do not overwrite it with an older snapshot.

After installation, open **AI tools** and apply setup to refresh integration paths. Review any conflicts, fully restart the selected tools, and review new or changed Greybeard hooks in Codex `/hooks`.

The earlier standalone executable does not acquire the companion through its old updater. Install this companion manually first. The existing `v0.1.0` release is retained for recovery.

## Boundaries

Greybeard supplies advice, not enforcement or guaranteed model compliance. Your AI tool's permissions and your organization's change controls still apply. Automatic support depends on the host and mode listed above.

Retrieval and mentoring rules make no separate model call. Relevant context can still increase your AI client's normal token usage. Memories require local confirmation before becoming guidance.

Intel Mac and native Windows ARM64 installers are not included. Linux is unsigned. The project is free and remains in the 0.1 research preview.
