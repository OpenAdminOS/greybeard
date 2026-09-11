# Companion packaging and updates

Build the bundled service first with `npm run build:executable`, then run
`node scripts/desktop/build.mjs`. The default creates a local candidate without
publisher-signing claims. The companion workflow builds and exercises Linux,
Windows and Mac Silicon independently.

The installed application is a complete Electron companion containing its own
Node executable. SQLite remains inside that executable, avoiding an Electron
native-addon ABI dependency. Mac uses `Greybeard.app/Contents/MacOS/GreybeardCompanion`
for the window (distinct even on case-insensitive filesystems) and `Contents/MacOS/greybeard` for existing terminal references.
The Mac after-pack hook renames only the Electron shell and its plist entry
before copying the service, then signing both. It deliberately avoids the
`executableName` setting, which also changes the bundle filename in this builder.
Windows and Linux bundle the service under `resources/bin`. No browser tab is
opened by the desktop shell.

## Distribution

- Mac Silicon: a signed, notarized and stapled DMG for installation, plus a ZIP
  containing the complete signed and stapled application for updates.
- Windows: one NSIS setup executable with current-user installation. The
  installer, application, bundled service and shipped DLLs are publisher signed
  and checked for trusted timestamps in release mode.
- Linux: one AppImage. SHA-256 checksums establish artifact integrity; they are
  not an operating-system publisher signature.

Explicit release builds use `GREYBEARD_DESKTOP_RELEASE=true`. The workflow
imports the existing Apple certificate through `scripts/macos-signing.mjs`,
signs SQLite before embedding and signs the embedded service. The packaging
script converts the existing PEM `APPLE_API_KEY` secret into a temporary private
file for notarization and removes it afterward. Windows reuses the Azure Trusted
Signing application credentials through environment variables. Credentials are
never packaged or written into update metadata. Missing signing credentials or
failed notarization fail the release build instead of falling back unsigned.

The workflow defaults to building artifacts. Publishing requires explicit
`release=true`, `publish=true`, and a new `tag` matching both package versions.
All three platforms must verify first. A draft release is uploaded completely
before becoming visible. An existing tag or release, including v0.1.0, is rejected;
these scripts cannot silently replace the previous downloads.

## Complete application updates and recovery

The update feed contains `latest.yml`, `latest-mac.yml`, `latest-linux.yml` and
associated archives/blockmaps. Mac needs its ZIP even though users download the
DMG. Checksums are refreshed after DMG stapling, then checked again before
publication. Verification extracts the updater ZIP and mounts the DMG, checks
the contained app signatures, tickets and Gatekeeper acceptance in release mode,
and compares both executable hashes with the verified packaged app. A DMG
blockmap created before stapling is removed; Mac updates use the ZIP blockmap.
Electron's Windows updater validates the configured publisher and
macOS validates its signed application. Candidate artifacts are not a substitute
for release signing verification.

The GitHub feed has no embedded token. While the repository is private, a user
without release access cannot use that public feed anonymously; the companion
reports the error and offers manual installation. A public distribution location
is required for anonymous automatic updates. Do not put a shared repository
credential into the app to bypass this restriction.

Before applying a complete update, the companion saves the previous complete
application under its local `application-recovery/previous` folder. Close
Greybeard and AI clients before restoring it. On Mac, copy the saved `.app` back
to Applications; on Windows, restore the saved application directory while its
processes are closed; on Linux, use the saved AppImage. Preserve the existing
memory/configuration directory. Memory is not rolled back: a previous version
must support its schema, and a newer schema deliberately blocks an incompatible
older runtime. This is an explicit manual recovery copy, not an automatic
rollback guarantee.

Packaging follows the installed electron-builder 26 configuration and its
[macOS signing](https://www.electron.build/v26/docs/mac/) and
[Windows signing](https://www.electron.build/v26/docs/win/) contracts. Verification
scripts check actual produced artifacts, not configuration alone.


Windows publisher checks inspect actual PE `SignerInfo` records, including nested
Authenticode signatures, rather than trusting arbitrary certificates in a CMS
certificate collection. They require the Ugurlabs signer, SHA-256, and a valid
RFC3161 timestamp bound to that signer. SignTool independently verifies every
embedded signature, PE digest, trust chain and timestamp with `/pa /all /tw`.
This avoids mistaking a preferred Microsoft catalog signature for the publisher
of the embedded signature. Microsoft documents this
[catalog preference](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature).
Cryptographic fixture tests cover nested signers, decoy certificates, missing
and reused timestamps, and PE bounds; only the Windows release check establishes
actual Windows trust for the distributed files.
