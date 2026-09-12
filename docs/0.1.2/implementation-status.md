# Greybeard 0.1.2 implementation evidence

The shared-memory implementation addresses [issue #5](https://github.com/OpenAdminOS/greybeard/issues/5). This is PR evidence, not a publication or platform certification claim.

## Implemented

- Default-local backend selection, unchanged onboarding, optional Advanced pairing, visible store identity, protected per-device credentials, explicit owner authorization for separate human review credentials, revocation and retained local data on disconnect.
- Loopback-only headless server behind private HTTPS, stateless Streamable HTTP MCP, authenticated event and review APIs, identity binding, bounded inputs/outputs, enrollment throttling, transactional mutation replay records, pagination and changing-export detection.
- Remote MCP tools, normalized automatic events, bounded hook cancellation including native credential lookup, companion/CLI review, exact revision/store checks, memory map/export/activity, device pause and shared pause.
- Server operator commands, SQLite backup, restore credential invalidation, service example and troubleshooting documentation.

## Local verification

- Workspace build and regression suites passed before final PR checks. Native credential tests gated by platform are reported separately, not counted as passes.
- Nine new integration scenarios cover shared candidates/recall, profile and credential isolation, stale review, mutation replay, two-device event handling, local data preservation, invalid configurations, companion routes, hook deadline, paged export, paused review, and persisted server metadata.
- Actual Electron first-run and companion smoke tests passed, including collapsed Advanced settings, disclosure validation, masked-code clearing, existing review/export, and returning local launch.
- `scripts/smoke-shared-memory.sh` passed inside an isolated Linux Secret Service session: a packaged server outside the checkout, empty server PATH/display, trusted TLS proxy, two independent client processes using native protected credentials, a candidate reviewed on one client and recalled by the second client's MCP and hook, and native credential removal/device revocation.

The native smoke uses a synthetic certificate trusted only by its child processes, generated fixtures, and a separate keyring. It never disables TLS verification or touches personal memories.

## Remaining release gates

- Actual Claude Code conversations on two physical/virtual client machines, including later-session automatic recall and companion review.
- Native shared-memory pairing, review, credential cleanup, and outage behavior on installed Windows and macOS builds. Cross-platform CI fixtures and local Linux tests do not establish those outcomes.
- Real private-network/Tailscale deployment, clean VM/LXC install, and interrupted upgrade/backup restoration rehearsal using the distributed artifact.
- Final publication/signing and upgrade verification for a new 0.1.2 release. Version/package changes do not mean release artifacts have been published.

CI on the final PR commit must reach a terminal state before handoff. Keep the PR as a draft until the external release checks have a recorded disposition. Do not describe a generated fixture event as an actual host conversation.
