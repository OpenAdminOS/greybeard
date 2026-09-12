# Greybeard 0.1 implementation status

## Current branch: automatic mentoring

The [automatic mentoring contract](automatic-mentoring.md) supersedes the initial command-only coverage below. This branch adds prompt/turn hooks for Claude Code and Desktop Code, Codex, Gemini, Copilot CLI, plus Cursor companion prompt advice and supported model-context events. Ordinary Desktop Chat remains MCP-assisted. It also adds automatic reviewed preference proposals, bounded context and duplicate suppression, actual event status, native notifications and optional login startup.

Current execution evidence and exact external host blockers are recorded in [automatic mentoring evaluations](../../evaluations/automatic-0.1/README.md). Historical evaluations below describe the earlier executable implementation; they are not proof that every new host or operating system has passed a real model conversation.

## Earlier executable baseline


Current companion implementation supersedes the earlier delivery and backlog status below. See [the companion flow](companion.md) and [recommendation coverage](reviews/implementation-coverage.md).

This records the foundation verification from 10 September 2026 on branch `feat/0.1-mentor-foundation`. For the 0.1 downloads, signing status, and installation instructions, see [executable delivery](executable-delivery.md) and [release notes](release-notes.md). The public product display remains 0.1.

## Implemented

| Area | Current behavior | Evidence |
| --- | --- | --- |
| Local onboarding | Mentor-only setup, selected client detection, original beard logo, graphical and terminal routes, Notify default | Source checks and browser execution at 1440px and 390px |
| Learning | Model proposals are candidates; local confirmation binds the exact immutable revision; corrections preserve scope and history | Migration, replacement-race, provenance, correction, and deletion regression tests |
| Memory | Profile/tenant identity pinned per session; confirmed-only scoped recall; applicable exceptions precede general guidance; bounded expanded nodes; paginated inspection/export | Cross-profile, paused capture, expiry, linked-exception, cursor, and privacy tests |
| Action advisory context | Claude Code pre-tool hook for four explicitly supported cmdlets; bounded output; no advice for unrelated actions; session/action deduplication; execution is not paused | Fixture events and an actual isolated Claude Code session using a harmless command stub |
| Client configuration | Shared per-file locks and atomic writes for setup, hooks, fallback blocks, and uninstall | Concurrent settings-edit and failure-preservation checks |
| Controls | Inspect, confirm, correct, forget, pause/resume, disable hooks, disconnect tenant, remove owned integrations while retaining memories | CLI and guarded local UI checks |
| Executable | Embedded Node runtime, application, skills, logo, and SQLite native addon; same executable serves MCP and setup | Linux x64 copied outside the checkout with an empty PATH; help/setup/database/MCP passed |
| Tenant connection | Customer-owned app-only certificate provider; exact selected role and identity checks; missing/excess roles remain inactive; finite capability path boundaries | Local certificate and mocked acquisition tests, plus separate Lokka response-contract evidence |
| Tenant read transport | Explicit beta, bounded pages/items/response streams/retries, continuation validation, no bearer forwarding through redirects | Transport rejection and error-body regression tests |
| Production writes | CLI bootstrap removed, scope mutation and write tools absent, GraphService mutation entry points disabled | Public boundary assertions; retained write-engine deadline, credential, scope, and body immutability regressions |
| Updates | Notify default, opt-in automatic staging, Manual mode; signed metadata and artifact hash; POSIX next-launch replacement when peers are idle; previous binary retained | Signature/expiry/platform/downgrade/busy/corruption tests and actual packaged Linux activation |
| Documentation | README, specification, MCP docs, skill guidance, example configs, HTML plans, and current decisions aligned | Historical material explicitly separated from the current contract |

## Verification

The foundation source and executable artifact workflows completed successfully on Windows, macOS, and Linux at `21c3c0f44c3d22798c3403991180aa23f0b05ce8`. Release signing and packaging are verified separately by the release workflow. Historical foundation checks do not establish publisher signing or complete end-user installation coverage.

- Integrated build, all 176 unit tests (89 Graph, 30 memory, 57 CLI), and repository style check passed, including final client-configuration concurrency hardening.
- Actual Linux executable: setup and SQLite outside the checkout with no Node on PATH, memory MCP initialization, explicit application-data override, valid local signed update activation, and invalid-signature recovery passed.
- Graphical UI: no-tenant setup, candidate confirmation with revision, scoped correction, candidate deletion, pause, capability selection, and form validation passed. No horizontal overflow at desktop and mobile widths.
- Production dependency audit reported zero vulnerabilities. Two moderate findings remain in the development-only Vitest toolchain; a compatible major-version upgrade is separate work.
- Actual Claude Code: the host delivered a PreToolUse event to the packaged executable, returned its confirmed lesson to the model, and the assistant reported the advice after a harmless local stub command. The CLI automatically substituted the requested Fable model; this proves host integration, not a Fable-only run or a user-visible warning before execution. No retry or tenant operation occurred.
- No production tenant write, new app registration, permission grant, or public artifact publication was performed for this work.

## Live Microsoft verification

The authenticated Lokka connection used explicit `graphApiVersion: beta`. Read-only probes returned the selected fields for users, basic groups, managed devices, and Conditional Access policies. Users, groups, and devices returned continuation links; following each link returned another page. The policy sample returned a collection without a continuation. An intentionally invalid user-filter property returned HTTP 400 with `Request_UnsupportedQuery`.

The connection has broad permissions. This evidence verifies response contracts and error/paging behavior, not minimum grants. No tenant data, token, or credential has been copied into this repository. See the shared capability catalog in `graph/src/appOnlyAuth.ts` and [permission candidate notes](../../.agents/skills/craft/least-privilege-scopes/references/scope-tables.md).

## Remaining product work

1. **Windows certificate provider.** The current PEM provider checks ownership and file permissions on POSIX; Windows tenant connection deliberately refuses until protected key access is implemented and verified. macOS OS-backed non-exportable key signing is also not implemented. This does not block mentor-only use.
2. **Customer credential and minimum-grant evidence.** Provision a dedicated app/Lokka connection with only each candidate permission, then validate successes and missing-permission cases and the actual Greybeard certificate path. Current broad grants cannot establish the answer. An authorized tenant administrator must supply this environment; no production credential is silently repurposed.
3. **Publisher delivery.** Establish the protected signing identity, trusted public-key distribution, HTTPS feed, signed Windows binaries, and signed/notarized macOS binaries. Generate actual public one-line installer URLs and platform hashes once the artifacts exist. The current downloaders fail when release inputs are absent.
4. **Windows update activation.** Implement and verify a separate replacement process/helper and installation ownership/recovery model. Windows checks and staging do not imply working automatic replacement. Extend POSIX recovery coverage and verify database compatibility with the retained executable.
5. **Platform coverage.** Build and run on clean Windows/macOS machines and each advertised architecture. Use the final handoff for the actual CI matrix outcomes. Successful CI builds and fixtures do not establish clean-machine release support.
6. **Client transfer.** Prove a complete later-session lesson in Codex using an evidenced host integration, and run actual conversations in each advertised client. Current non-Claude integrations expose guidance on request; they do not provide the same proactive behavior.
7. **Pre-execution intervention.** Define and verify how a relevant warning reaches the admin before an action runs. The current advisory hook supplies context without pausing execution, and the observed host session surfaced its lesson afterward. Do not describe that as a blocking or guaranteed pre-action warning.
8. **Useful and affordable advice.** Measure admin usefulness, dismissals, missed cases, false warnings, latency, and whole-task model usage. Expand the finite command adapter only with evidence. The initial fixture does not prove broad mentor effectiveness or net token savings.

The first iteration is intentionally narrow about observed actions. It does not independently reason in the background, monitor the desktop, poll tenants, execute remediation, synchronize cloud memory, or train a foundation model. Those remain outside the agreed first scope.

## Security boundaries

- Human confirmation is a local application boundary. A process with the user's OS permissions can access the same files; this is not isolation from arbitrary same-user shell access.
- Memory retrieval budgets apply to serialized recalled nodes. Protocol envelope, host prompts, tool schemas, and subsequent model reasoning add context beyond that budget.
- Deleting a confirmed correction does not silently resurrect superseded guidance. Model-side deletion cannot erase confirmed lessons.
- Certificate file paths are stored locally; private-key content is not placed in configuration or model tools. The certificate remains customer-owned. Application identity is permission-bounded and distinct from the signed-in user's identity.
- Native SQLite code and assets are extracted from the single executable into owned application data and checked against embedded hashes. The user does not need to install a developer runtime.
- No unverified artifact or interrupted transfer replaces the current executable. Recovery preserves the previous binary and never blindly restores an old memory database.
