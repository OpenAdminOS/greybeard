# Greybeard 0.1.2 implementation evidence

The shared-memory implementation addresses [issue #5](https://github.com/OpenAdminOS/greybeard/issues/5). Release availability and assets are recorded on the [0.1.2 release page](https://github.com/OpenAdminOS/greybeard/releases/tag/v0.1.2). This document records implementation evidence and its limits.

## Implemented

- Default-local backend selection, unchanged onboarding, optional Advanced pairing, visible store identity, protected per-device credentials, explicit owner authorization for separate human review credentials, revocation and retained local data on disconnect.
- Loopback-only headless server behind private HTTPS, stateless Streamable HTTP MCP, authenticated event and review APIs, identity binding, bounded inputs/outputs, enrollment throttling, transactional mutation replay records, pagination and changing-export detection.
- Remote MCP tools, normalized automatic events, bounded hook cancellation including native credential lookup, companion/CLI review, exact revision/store checks, memory map/export/activity, device pause and shared pause.
- Server operator commands, SQLite backup, restore credential invalidation, service example and troubleshooting documentation.

## Local verification

- Workspace build and regression suites passed before final PR checks. Native credential tests gated by platform are reported separately, not counted as passes.
- Twelve shared-memory integration cases cover shared candidates/recall, profile and credential isolation, stale review, mutation replay, two-device event handling, local data preservation, invalid configurations, companion routes, hook deadline, paged export, paused review, and persisted server metadata.
- Actual Electron first-run and companion smoke tests passed, including collapsed Advanced settings, disclosure validation, masked-code clearing, existing review/export, and returning local launch.
- `scripts/smoke-shared-memory.sh` passed inside an isolated Linux Secret Service session: a packaged server outside the checkout, empty server PATH/display, trusted TLS proxy, two independent client processes using native protected credentials, a candidate reviewed on one client and recalled by the second client's MCP and hook, and native credential removal/device revocation.

The native smoke uses a synthetic certificate trusted only by its child processes, generated fixtures, and a separate keyring. It never disables TLS verification or touches personal memories.

## Physical-device verification

[Recorded device evidence](../../evaluations/shared-memory-0.1.2/README.md) covers a Windows MiniPC and Apple Silicon MacBook over private Tailscale HTTPS: actual Claude Code proposals and later conversations in both directions, native pairing and protected credentials, exact companion-backend review, shared pause, outage behavior, backup restoration with credential invalidation, and credential cleanup.

Device testing found Windows packaged DPAPI startup exceeded the original hook deadline. The corrected artifact passed automatic context delivery in a fresh Claude conversation. Windows now has a 2.5-second processing budget; macOS/Linux retain 1.5 seconds, all within the existing five-second host timeout.

## Validation limits

- The installed Windows/macOS companion visual workflow, including a person reviewing a candidate in the native dialog. Device tests automated its authenticated backend, not the window.
- Clean VM/LXC installation and interrupted application upgrade rehearsal using the distributed artifact. Private Tailscale deployment and core backup restoration were exercised on owned devices.
- Signed packaging, notarization, packaged-app smoke tests, and publication are enforced by the explicit Companion application release workflow. They do not establish every manual upgrade scenario.

PR #6 is merged. The owner authorized publication of the current 0.1.2 version with the manual scenarios above still unverified. Automated release checks must finish successfully before publication; generated fixture events are not counted as actual host conversations.
