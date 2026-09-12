# Greybeard 0.1.2 shared memory implementation plan

Status: implemented for PR review; see [evidence and outstanding release gates](../0.1.2/implementation-status.md).

Target version: **0.1.2**, confirmed by the user. GitHub already published `v0.1.1` on 12 September 2026. Package versions are prepared for 0.1.2; preserve the existing release tag and assets. No release publication is part of this PR.

Source: [issue #5](https://github.com/OpenAdminOS/greybeard/issues/5). Investigation baseline: `cb51fc28619f0a565370d4221f8c91fe867c9f9b`.

## Outcome and product boundaries

An administrator can use a workstation and laptop with the same confirmed memories, automatic mentoring, and review queue, backed by a small server they manage. The initial complete remote workflow targets Claude Code on both machines.

The default experience stays local: download Greybeard, open it, and complete the existing setup. No account, server choice, network credentials, or additional screen is introduced during onboarding. Existing installations keep their current memories and settings. Local mode performs no remote-memory requests and starts no remote-memory listener.

Shared memory lives under **Settings > Advanced > Shared memory**. Enabling it is optional and reversible. A remote connection is visibly identified in memory review and connection status; ordinary users never need to configure it.

This increment serves one administrator using multiple devices, with identities pinned to a profile and environment. Team accounts, organization roles, hosted services, billing, public internet exposure, automatic discovery, bidirectional offline synchronization, and deployment of unrelated infrastructure services are outside scope. Existing client support remains available in local mode. Advertise remote support for another client only after its actual hook and MCP paths pass verification.

## Evidence from the investigation

- `cli/src/index.ts` and `memory/src/index.ts` connect memory MCP through stdio only. `memory/src/mcpServer.ts` constructs the tool server independently of transport.
- `cli/src/automaticHooks.ts` installs local commands. `cli/src/automaticMentor.ts` reads event JSON, opens the local activity store, and shares its database with `MemoryService`. Hooks do not call the configured MCP server.
- `cli/src/setupUi.ts` and `cli/src/memory.ts` access memory locally. The companion's loopback HTTP service is a private UI backend, not a remote MCP endpoint.
- Confirmation is absent from MCP. CLI confirmation previews the exact candidate revision and requires an interactive terminal.
- Two independent stdio MCP processes successfully shared one test store. A hook using a different directory remained separate; the same event processed against the shared directory became visible through MCP. A nonexistent transcript path did not prevent processing.
- Memory and CLI builds and 15 mentoring tests passed. These are local baseline checks, not proof of remote networking, TLS, packaged server deployment, or remote host compatibility.

## Architecture

Keep the installed local executable as the integration point for AI clients. Existing MCP configurations continue launching `greybeard mcp memory`, and hooks continue launching `greybeard mentor event`. A common backend selector chooses local storage or the configured remote service. Do not require users to hand-edit every AI client's MCP configuration.

```text
AI client ---- local stdio MCP adapter ----+
Host hooks --- local event adapter -------+-- authenticated HTTPS -- server -- SQLite
Companion ---- local review adapter ------+
                                             separate review authority

Local mode: the same adapters use the existing local service directly.
```

The server owns SQLite, configuration relevant to shared learning, and shared activity. SQLite remains on the server's local disk. Do not mount the live database across machines: the current WAL configuration requires processes accessing the database to run on the same host. See [SQLite WAL documentation](https://sqlite.org/wal.html).

Use Streamable HTTP for remote MCP through the installed SDK. Preserve stdio as the default. Define a separate bounded event API and a separate human-review API; events and confirmation must not become model tools. Validate origins, protocol negotiation, sessions, cancellation, and response types against the [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports). Legacy HTTP+SSE transport is not required for the bundled adapter.

Prefer stateless MCP requests if the installed SDK supports the required lifecycle. Otherwise bound sessions by authenticated device, profile, expiry, and resource limits. Never treat an MCP session ID as authentication or share a mutable active profile between clients.

## Contracts to establish first

### Backend selection and compatibility

- Add a versioned `memoryBackend` setting with `local` as the default when absent. Remote settings contain a server URL, stable server/store identity, device ID, profile binding, and references to protected credentials.
- Introduce interfaces for model memory operations, mentor event processing, and human review. Local implementations delegate to existing behavior. Remote implementations use the corresponding server surface, avoiding duplicate business rules.
- Pin backend, server identity, profile, and environment for each MCP session. Backend switches apply to newly started sessions; show when an AI client restart is necessary. Hooks resolve one binding per event. A review operation stays bound to the store and revision that supplied its preview.
- Provide an authenticated capability handshake including application protocol version and supported operations. Refuse unsupported combinations with a clear update message. Existing local mode must remain usable independently of server availability or version.

### Server deployment and authentication

- Add explicit headless server commands to the existing executable. Starting the desktop app or a normal MCP process never starts this listener.
- Initial supported server target: Linux x64 VM or LXC with a local persistent data directory and a dedicated OS account. Supply a service example with explicit data path, restart behavior, backup procedure, and logs. Verify native SQLite packaging without a desktop session.
- Default the backend listener to loopback. Document HTTPS through an administrator-managed reverse proxy or Tailscale HTTPS endpoint for private-network use. Remote clients require a trusted certificate. Do not offer a certificate-validation bypass or plaintext remote credentials.
- Pair devices through an expiring, single-use enrollment code issued interactively by the server owner. Rate-limit enrollment. Issue independent revocable device credentials, store their hashes on the server, and keep client secrets in protected OS storage outside AI client configuration and logs. A headless server must not require a desktop keyring to start.
- Separate model/event permissions from human-review permissions. MCP and hooks cannot obtain or use review credentials. The existing companion or interactive CLI mediates exact-record review, with distinct review authorization. Unattended pairing must not mint review authority without the owner's explicit action.
- Enforce authentication on every data request, fixed profile/environment authorization, host/origin checks, body and response bounds, timeouts, rate limits, and redirect restrictions. Check revocation for active connections as well as new ones. Do not forward credentials to a redirected origin.
- Treat this as a private Greybeard client/server credential scheme. Do not claim generic third-party MCP OAuth compatibility. Local OS account access remains a trust boundary, as it is today; separate API privileges do not isolate arbitrary same-user processes.

### Events, privacy, and offline behavior

- Normalize host input locally. Transmit only the event fields needed by mentor processing: host, event kind, session/turn identity, and bounded relevant text. Do not forward the entire raw event, transcript paths, files, environment variables, or full tool output. Show this disclosure before enabling shared memory.
- Namespace activity and delivery fingerprints by stable device ID as well as profile, host, and session to avoid collisions between computers. Keep durable proposal deduplication scoped to shared content so repeated preferences do not create duplicate candidates.
- Preserve existing privacy screening, retention limits, confirmed-only scoped recall, and the 2,048-byte context ceiling. No extra model call is needed.
- Set an end-to-end remote hook processing deadline of 1.5 seconds on macOS/Linux and 2.5 seconds on Windows, within the existing five-second host hook limits. The Windows allowance reflects measured DPAPI startup on a physical device. Bound local preprocessing too. Do not retry hooks within that budget. A timeout returns the existing empty host response and never blocks the user's command.
- When offline, show shared memory as unavailable. Do not silently use an unrelated local store, claim recall succeeded, queue raw prompts, or accept review actions as completed. Keep the local mode fully independent. No offline shared-memory cache or replay queue in this increment.
- Give retriable mutations stable operation IDs and durable server deduplication within a defined retention window. A lost response must not duplicate candidates, corrections, or confirmations. Distinguish an unknown result from a definite rejection and provide a way to inspect the outcome before retrying.

### Review, pause, and switching stores

- Route list, candidate preview, confirm, correct, forget, export, memory map, and activity through the selected backend. Preserve pagination and exact revision checks. Two devices reviewing one candidate must receive a conflict when one preview becomes stale.
- Display the selected server/store name next to shared memory controls. Preserve candidate status, original source, observation time, scope, and correction links; connecting a server cannot promote records to confirmed.
- A device-level pause immediately stops new advice and proposals from that device. A separately labeled shared-store pause suppresses learning and recall across connected devices and is enforced by the server. Allow review and export while paused. In local mode, retain the existing single pause control.
- Pair and verify a remote connection before committing the backend switch. In-flight calls retain their original binding. Disconnecting returns new sessions to the retained local store; it does not copy or delete shared records.
- Do not automatically upload or merge existing local memories. The first remote connection explicitly explains that the shared store is separate and the local store is retained. The complete initial workflow creates and confirms new shared lessons. Bulk migration with preview, deduplication, provenance, and confirmation preservation is a separate follow-up.
- Support individual device revocation, remote credential removal, and server backup/restore. Disconnect should revoke when reachable, remove local credentials regardless, and explain when server-side revocation remains outstanding. A restored store must not silently reuse invalidated credentials or operation IDs.

## Delivery sequence

| Step | Work and primary files | Completion evidence |
| --- | --- | --- |
| 1. Define contracts | Add backend interfaces and versioned configuration; extract reusable event processing from `cli/src/automaticMentor.ts`; adapt `memory/src/mcpServer.ts` to the interface | Existing local behavior, session identity, pause, and confirmation boundaries pass with no remote configuration |
| 2. Build the headless server | Add server lifecycle, SQLite ownership, authenticated HTTP MCP, event and review routes, pairing, revocation, protocol handshake, bounded requests | Real HTTP integration tests cover two devices, authorization, replay, stale revisions, origin rejection, cancellation, and server restart |
| 3. Wire local adapters | Update `cli/src/index.ts`, hook processing, and shared configuration resolution; retain existing installed command shapes | Two local stdio adapters connect to one real server; hooks create and recall shared candidates without direct local DB access in remote mode |
| 4. Complete companion and CLI | Update `cli/src/setupUi.ts`, companion settings, `cli/src/memory.ts`, activity/map readers, and diagnostics; introduce advanced pairing and review flows | Existing first-run setup is unchanged; remote review, device pause, shared pause, disconnect, offline status, and revision conflicts work end to end |
| 5. Verify delivery | Add headless packaging/service examples, protocol docs, operator guide, and remote acceptance evidence | Packaged Linux server and installed clients pass the matrix below; supported platforms are based on actual evidence |
| 6. Prepare release | Align 0.1.2 package versions, release notes, installer/update metadata, and issue response with delivered behavior | All required CI checks on the final commit are green; release artifacts and upgrades are verified before publication claims |

Implementation and verification status is recorded in the linked evidence document. Treat steps 1 through 5 as one feature: exposing HTTP alone does not fulfill issue #5. Keep the advanced remote entry unavailable in release builds until the full workflow passes.

## Acceptance and release gates

- [ ] A fresh local installation has the same setup screens and requirements, creates no remote-memory listener, and sends no remote-memory requests. Existing local users retain their records, settings, and working integrations after upgrade.
- [ ] Using two physical or virtual client machines running Claude Code: machine A proposes a lesson, the companion reviews the exact candidate, and a later relevant conversation on machine B receives the confirmed lesson through its automatic hook. Unconfirmed candidates never enter recall.
- [ ] Both machines can inspect and correct the same shared records. Scoped recall and exceptions remain intact. Distinct profile/environment bindings cannot read or mutate each other's records.
- [ ] Every currently supported local client retains working setup and hooks. Remote compatibility is verified per client before it appears in the supported matrix; host trust/restart requirements are shown accurately.
- [ ] Server unavailable, DNS failure, slow response, invalid certificate, revoked credential, expired enrollment, malformed event, oversized request, and unsupported protocol all produce bounded, useful failures. Hook deadlines are measured under slow and failing connections.
- [ ] MCP/event credentials cannot call confirmation or other human-only controls. A browser origin cannot forge review requests. Credential rotation/revocation, cross-device session reuse, and stale record previews are tested.
- [ ] Concurrent proposals, a disconnect after a committed mutation, and server restart do not duplicate durable changes. Device session collisions do not suppress another machine's advice.
- [ ] Pauses have the documented scope, including during outages. Switching and disconnecting preserve stores and never redirect an in-flight operation. Existing local memories are not silently uploaded.
- [ ] A clean Linux VM/LXC starts the packaged server without Electron, a graphical session, Node, or npm installed. Persistent state survives service restart; backup/restore and an interrupted upgrade are exercised with native SQLite.
- [ ] The installed Windows, macOS, and Linux companion/client paths are checked for protected credentials, pairing, review, and clean disconnect before claiming each platform supports remote mode.
- [ ] Operators can configure private HTTPS, pair/revoke a device, inspect sanitized diagnostics, back up, restore, and update using the documented commands. Existing AI client configurations are preserved.
- [ ] Final CI is monitored to terminal success on the latest commit. Manual platform/host checks have evidence; a skipped check is not a pass. Publication uses an unused version and never replaces an existing release.

## Decisions still requiring evidence

1. **Protocol/session implementation:** verify the installed SDK's stateless support and reconnect behavior with a real server in step 2. Keep application protocol compatibility distinct from product versioning.
2. **Packaging footprint:** prove that the headless artifact starts independently of desktop-only dependencies before documenting Linux server support.
3. **Latency:** measure the first request from a newly launched hook process, including protected credential lookup and TLS. If it cannot meet the hook budget, evaluate a bounded local connection broker within this design instead of increasing host delays.
4. **Human-review authorization:** verify exact-record review and credential separation through the actual companion IPC and interactive CLI. Do not add a model-accessible confirmation shortcut to make remote review easier.

These are implementation gates, not additional choices presented to users during ordinary setup.
