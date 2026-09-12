# Greybeard 0.1 implementation brief

Decision snapshot: 10 September 2026. This brief governs the next implementation work. The HTML walkthrough illustrates the interface; the release review preserves evidence from the original code. Historical findings are not a specification of the future architecture. Implementation is proceeding on feat/0.1-mentor-foundation. See docs/0.1/implementation-status.md for verified progress and remaining release gates.

## Product direction

**An IT mentor that learns how you work.**

Greybeard remembers your decisions and confirmed lessons, reviews supported admin actions, and offers relevant guidance inside the AI tools you already use.

Initial audience: Microsoft-focused administrators already using AI for scripts, troubleshooting, and preparation of changes. Begin with Microsoft 365, Intune, and Entra. The individual admin is the 0.1 user; governed team knowledge is a possible later direction, not an implemented capability or a commitment to paid features.

The key experience: a confirmed lesson becomes relevant guidance during a later task without the admin having to ask for that lesson again. Self-learning means retaining confirmed lessons, recording their scope and evidence, and applying corrections. It does not mean training a new foundation model or promoting guesses to facts.

## Established decisions

- Public product name/version: Greybeard 0.1. Free to use. No alpha, beta, or similar release-stage labels in product copy. Keep engineering verification requirements in private planning. Microsoft Graph API version terminology is separate.
- Use the README's grey-bearded face logo. Embed the existing image in the application; a simplified tiny-icon variant can be designed separately.
- One executable per supported OS/architecture. Download and terminal entry points run the same application. Users do not install Git, npm, or Node separately. Settings, SQLite data, owned client integration assets, and protected credentials remain writable data outside the executable.
- Greybeard is the local mentor application. MCP exposes its tools; skills supply guidance; host-specific integrations provide supported action events. MCP alone does not observe arbitrary computer activity.
- A complete mentor-only path requires no Microsoft tenant connection. The chosen AI client still supplies model access. Local storage does not prevent recalled information from entering that client's cloud-model context.
- Optional tenant connection uses a customer-owned app registration and app-only authentication. Collect a profile name, Tenant ID, Client ID, and either a client secret stored with OS protection or a customer-provisioned certificate credential. No ongoing end-user browser sign-in. An authorized tenant administrator still configures the registration and grants application permissions in Entra.
- Request capabilities individually, with none preselected. Show permission names, purpose, reach, and missing or excess grants. Do not request application-management permissions merely to onboard or inspect the app.
- Updates have Automatic, Notify, and Manual choices. Default: Notify. Automatic is an explicit opt-in, disclosed in setup. Use the same updater for both installation routes. Stage verified downloads and activate on a safe next launch. Active operations must finish first. No silent permission changes.
- Keep controls for pause, inspect, correct, forget, disconnect, and uninstall. Do not delete memories automatically during uninstall.

## Recommended first shipping scope

Build the initial release around mentor-only use and individually verified read-only tenant capabilities. Keep all production mutation paths disabled until the existing approval/identity/expiry defects are fixed and write validation is separately authorized and complete. This is a scope recommendation, not a statement that the original write findings are resolved.

First full mentor client: Claude Code. Second: Codex, with the same confirmed lesson correctly applied in a later session. Client support is behavior-specific. Desktop clients may expose on-request assistance without automatic intervention. Do not advertise universal observation.

Defer independent model workers, unattended tenant polling, autonomous remediation, cloud sync, shared team memory, vector search, and enterprise monetization features. They are not prerequisites for proving the individual mentor experience.

## Build sequence and acceptance

### 1. Deliver a mentor loop with trustworthy local memory

Create stable profile and session identities, atomic/locked configuration writes, privacy-aware storage, reversible corrections, and bounded retrieval after link expansion. Preserve coexisting preferences; record explicit supersession rather than destructive token-overlap replacement. Separate personal preferences from tenant facts. Record observation time, source, confirmation state, applicability, and supersedes relationship.

Implement client selection, learning preferences, update preference persistence, mentor-only completion, owned configuration installation/removal, diagnostics, and memory controls. The user should not need Microsoft credentials to reach the first useful interaction.

Acceptance: concurrent sessions do not lose configuration or mix tenant data; unrelated client configuration remains unchanged; disabling an integration removes the owned hook; learning off is respected. Retrieved memories are not silently reconfirmed or sent wholesale to the model.

Model-originated and migrated unverified memories begin as candidates. MCP cannot confirm them. A separate local human confirmation flow previews exact content and scope; store confirmation channel and time. Local shell access shares the user account, so this is an application boundary, not protection against all same-user processes. Do not claim a model-generated success proves human intent.

#### The first complete interaction

Use supported client events to observe a proposed action, retrieve applicable confirmed context, offer a concise suggestion, and record a confirmed correction or outcome. Explain why a suggestion appeared, permit dismissal, and avoid repetitive advice. Unrecognized actions must not be labeled safe. Add Codex only after the first complete Claude Code loop works.

Current implementation supplies advisory context through Claude Code's PreToolUse hook but does not pause execution. The observed host session surfaced the lesson after the command. A guaranteed user-visible warning before execution requires a separately defined interaction and remains an acceptance gate, not a delivered behavior.

Acceptance scenario: record a month-end device-cleanup exception; recognize its relevance in a later session; handle an intentional exception without overwriting the general rule; apply the scoped lesson correctly in a second client. Record intervention usefulness, false warnings, latency, model context, and task completion. Do not promise net token savings before measuring whole tasks.

Proposed recall budget: 300-800 tokens of relevant memory, enforced after expansion. This is a design target, not a measured current limit. Prefer local checks and the host's existing model; no mandatory second model subscription.

### 2. Prove executable delivery alongside the mentor loop

Produce an executable outside the source checkout that starts, provides help/setup, opens and queries its SQLite store, and serves one local MCP memory operation without any tenant authentication or installed developer runtime. Verify embedded skill assets can be materialized to owned locations. Check credential-library loading does not break mentor-only startup.

First resolve the native SQLite and credential dependencies. Identify any native-library extraction, temporary updater process/copy, and OS prerequisites. If a packaging approach cannot satisfy the single-executable requirement, evaluate alternatives before widening product implementation. Do not assume an installer that expands a Node installation satisfies the requirement.

Acceptance: a clean supported machine can launch the artifact, complete mentor-only setup, and save/recall a preference. Choose OS/architecture coverage from actual build evidence. Windows and macOS are initial targets; do not claim additional architectures before verification.

Time-box the packaging technology spike to one focused engineering session. It must not delay the first developer-checkout mentor demonstration. Ship one executable as the user download, document any owned native-library extraction, and verify behavior outside the checkout.

### 3. Complete terminal and graphical onboarding

Retain both installation routes and the same executable. Terminal prompts can land first during development. Graphical setup remains a release requirement, using the original beard asset and a local-only interface. No tenant authentication is required to finish mentor setup. Client detection must distinguish installed, selected, configured, and observed-working states.

Acceptance: setup can be completed offline; pausing learning stops capture; disabling an integration removes only owned entries; ordinary local browser requests cannot forge state-changing setup or memory confirmation requests. Default updates to Notify. The interface labels memories as candidates until explicitly confirmed.

### 4. Add optional app-only access one capability at a time

Implement a dedicated app-only credential provider; the current delegated provider cannot simply be relabeled. Treat certificate selection, private-key protection, identity validation, expiry, rotation, removal, app-role interpretation, and authentication failures as explicit behaviors. Never ship a vendor secret or private key in the executable. No public-client redirect is needed for the client-credentials flow.

Candidate Application permission mappings:

| Capability | Candidate permission | Boundary |
| --- | --- | --- |
| User profiles including organizational attributes | User.Read.All | Does not imply mailbox access. Basic-profile lookup could later be a distinct narrower feature. |
| Basic groups and ordinary memberships | GroupMember.Read.All | Hidden memberships are not included. Narrower catalog/documentation discrepancy needs resolution. |
| Intune inventory and current compliance state | DeviceManagementManagedDevices.Read.All | Does not imply full compliance diagnosis or device actions. |
| Conditional Access policy review | Policy.Read.ConditionalAccess | Narrow role is in the live catalog; endpoint documentation still lists Policy.Read.All. Isolated verification is required. |

All are optional. App-only access is independent of the current user's directory role. The token uses the application's pre-consented roles via .default; UI feature toggles and $select do not narrow existing tenant grants. Detect/report excess grants without requesting broad permission just to inspect grants. Keep an overprivileged profile inactive until the access issue is resolved under the chosen product policy.

All Graph calls use explicit beta. Retain narrow fields, request limits, paging bounds, trusted continuation origins, redaction, and explicit unknown/error states. An unavailable feature must not trigger silent permission escalation.

Acceptance: an isolated, minimal-permission Lokka connection verifies each candidate's endpoint fields, paging, success, and missing-permission behavior. Then verify the same behavior through Greybeard. Verify certificate authentication and identity binding separately. Preserve mentor-only functionality when credentials or consent are unavailable.

External dependency: the present Lokka connection has broad permissions. Its successful reads verify endpoint behavior but cannot certify minimum grants. A tenant administrator must provision a dedicated connection/app with only candidate grants. No permissions or tenant credentials were changed during the review.

### 5. Implement executable updates and recovery

Build authenticated release metadata and verified artifact downloads, compatibility checks, staging outside the active runtime, coordination between all running Greybeard processes, activation when operations are idle, and startup health verification. Keep the previous working executable. Make database migrations compatible with recovery; never lose memories written after an upgrade by restoring an old backup blindly.

Proposed check policy: at launch and at most daily while running. Notify mode waits for the user; Manual has no scheduled checks. A closed executable cannot check by itself: any OS scheduler is an explicit installation choice, not an assumed daemon. Respect an organization's update policy and the package manager that owns an installation.

Acceptance: failed downloads/signatures leave the current version active; active operations are not interrupted; failed activation recovers without losing data; users are told when an AI client must reconnect. Updates must not silently add consent or activate stale write approvals.

Use public display version 0.1 with unique internal artifact/build identifiers. Settle internal version ordering and signature trust before implementing the feed. Do not rewrite historical release records to make them resemble the new product direction.

### 6. Prepare the actual 0.1 release

Build, sign, and distribute the executable artifacts for the verified platform matrix. Align README, setup, download instructions, permission disclosure, support matrix, and release notes with actual behavior. Remove the clone-and-build path from the primary user installation route while preserving developer instructions separately.

Acceptance: fresh-machine setup and upgrade from supported builds work; onboarding reaches a useful mentor moment; the support matrix matches observed behavior; permission-dependent claims have evidence; package and public version labels agree with the 0.1 policy. Keep the private defect report until each finding is resolved, mitigated by an enforced feature boundary, or explicitly deferred.

## Decisions to resolve through implementation, not another visual redesign

1. Executable packaging technology and native-module behavior.
2. Exact supported OS/architecture combinations and protected certificate-store integration.
3. Minimal application permissions where documentation/catalog disagree.
4. Update activation mechanism, internal build numbering, signing identity, and recovery-compatible database migrations.

These do not prevent starting milestones 1-3. They do prevent claiming all release requirements are already settled or implemented.

## Artifact ownership

- `greybeard-0.1-implementation-brief.md`: current decisions, build sequence, and acceptance.
- `greybeard-release-plan.html`: original 18 findings plus the aligned current direction. The historical evidence refers to reviewed commit 40ca2d1a9c44e444df1bd8d73245ef0a3667362a.
- `greybeard-user-flow-concept.html`: interactive interface reference, including free 0.1 branding, original beard logo, optional app-only access, and updates. Simulated actions are not implementation evidence.

The earlier Markdown review in the temporary review directory is historical audit evidence, not the current implementation brief.

## Accepted independent-review decisions

Adopt the earlier mentor proof, confirmation provenance, non-destructive memory, explicit adapter refactor, and Notify updates. Keep customer-owned app-only access, the one-executable download, graphical onboarding, free 0.1, and the beard logo. The critique that the concept did not use the beard logo was incorrect: CSS applies the embedded image. Defer claims of cross-client parity, signed delivery, minimal grants, and platform support until demonstrated.

No production tenant write is authorized by this implementation task. Minimum-permission and certificate validation requires an isolated customer-provisioned credential; release signing and clean Windows/macOS execution are external release gates. Implement and locally verify the available work while keeping those gates explicit.
