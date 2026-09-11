# Greybeard 0.1

**An IT mentor that learns how you work.**

Release tag: `v0.1.0`. Download from the [private GitHub release](https://github.com/ugurkocde/greybeard/releases/tag/v0.1.0) using an account with repository access. The release handoff confirms publication and the final asset checksums.

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
| `greybeard-darwin-arm64.tar.gz` | Apple Silicon Mac |
| `greybeard-linux-x64.tar.gz` | Linux x64 |
| `SHA256SUMS.txt` | Checksums for the release assets |

The Mac and Linux archives contain one executable, `greybeard`, with executable permissions preserved. Intel Mac and native Windows ARM64 builds are not included.

Verify the asset checksum, move the executable to its permanent location, then launch setup. Client integrations store that location, so moving the executable afterward requires rerunning setup. Follow [installation instructions](executable-delivery.md).

## Current limits

- This is a private repository release, not a public unauthenticated download. Browser download needs GitHub access; terminal download can use an already authenticated GitHub CLI.
- The platform metadata records the delivered Mac artifact's signing and notarization status. Only a completed, verified signing and notarization result establishes Apple publisher delivery. If an artifact is explicitly marked ad-hoc and macOS blocks the verified download, use [Apple's per-app Open Anyway instructions](https://support.apple.com/en-gb/102445).
- Windows tenant connection is unavailable until a protected credential provider is implemented. Local mentor functionality is available without it.
- There is no configured automatic-update feed. Notify is the default setting, but install later versions by verified manual replacement. Windows automatic replacement is not implemented.
- The mentor provides contextual advice, not guaranteed warnings before execution, autonomous background reasoning, or approval of an action. Other clients do not have the same automatic command advice as Claude Code.
- Exact minimum application grants and the customer certificate flow still need a dedicated narrowly permissioned environment. Do not interpret the listed permission candidates as certified minimum access.
- Greybeard is free. Your AI client's normal model usage still applies, and recalled memory adds context. No token savings are promised.

Settings and memories stay in local application data when replacing the executable. Close Greybeard and its AI clients before replacement, retain the previous executable, and keep the data directory. Never restore an old database over newer memories as an update shortcut.
