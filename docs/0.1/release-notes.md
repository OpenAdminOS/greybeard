# Greybeard 0.1

**An IT mentor that learns how you work.**

Release tag: `v0.1.0`. Download from the [GitHub release](https://github.com/OpenAdminOS/greybeard/releases/tag/v0.1.0). These notes describe the earlier published executable. The current source includes the newer [desktop companion](companion.md), which requires a separate signed installer publication.

## Included

- One executable with its runtime, SQLite library, skills, and beard logo included. No Node, npm, Git, or source checkout is required.
- Local graphical and terminal setup with optional tenant access.
- Candidate lessons that become guidance only after local human confirmation, with scoped corrections, export, pause, and forgetting.
- Claude Code advisory context for individual `Remove-MgDevice`, `Remove-MgUser`, `Remove-MgGroup`, and `Update-MgGroup` commands. The hook does not pause execution; advice can appear after a command runs.
- Memory and guidance on request in the other configured AI clients.
- Customer-owned application credentials for optional tenant reads on POSIX systems. Tenant writes and permission grants are disabled.

## Downloads

| Asset | Computer |
| --- | --- |
| `greybeard-win32-x64.exe` | Windows x64 |
| `greybeard-darwin-arm64.dmg` | Apple Silicon Mac, macOS 14+ |
| `greybeard-linux-x64.tar.gz` | Linux x64 |
| `SHA256SUMS.txt` | Checksums for the release assets |

Open the Mac DMG, drag `Greybeard.app` to Applications, then open the installed app. The Linux archive contains one executable, `greybeard`, with executable permissions preserved. Intel Mac and native Windows ARM64 builds are not included.

Verify the asset checksum, move the executable to its permanent location, then launch setup. Client integrations store that location, so moving the executable afterward requires rerunning setup. Follow [installation instructions](executable-delivery.md).

## Current limits

- The Mac release workflow requires signed, notarized, stapled app and DMG delivery. DMG metadata identifies the unchanged released runtime separately from the packaging source. The original Mac CLI archive remains available.
- Windows tenant connection is unavailable until a protected credential provider is implemented. Local mentor functionality is available without it.
- There is no configured automatic-update feed. Notify is the default setting, but install later versions by verified manual replacement. Windows automatic replacement is not implemented. Mac updates replace the complete app bundle to preserve its signature.
- The mentor provides contextual advice, not guaranteed warnings before execution, autonomous background reasoning, or approval of an action. Other clients do not have the same automatic command advice as Claude Code.
- Exact minimum application grants and the customer certificate flow still need a dedicated narrowly permissioned environment. Do not interpret the listed permission candidates as certified minimum access.
- Greybeard is free. Your AI client's normal model usage still applies, and recalled memory adds context. No token savings are promised.

Settings and memories stay in local application data when replacing the executable. Close Greybeard and its AI clients before replacement, retain the previous executable, and keep the data directory. Never restore an old database over newer memories as an update shortcut.
