# Greybeard Build Plan

## v0.1.1 incident backlog

- [x] Atomic dependency install, build, test, activation, and rollback in `greybeard update`
- [x] `publishedPermissionScopes` discovery with legacy fallback
- [x] Localhost public-client workspace registration and matching consent redirects
- [x] Explicit-scope persistence without copying cached token scopes
- [x] Plan-specific scope preflight and execution binding
- [x] Audited temporary scope leases and guarded scope release
- [x] Config-revision auth reload without replacing the MCP transport
- [x] Unknown directory-role detection with diagnostics
- [x] Structured MCP output with text compatibility
- [x] Entra app credential and OIDC skill plus catalog metadata/manifest cleanup
- [x] Incident regression suite for setup, provisioning, cleanup, update, reload, and role detection

Milestones are ordered by dependency and by "time to first wow": the read path, one client, and the hero skill come before breadth. Each milestone has acceptance criteria; a milestone is done when its criteria pass, not before.

## M0 - Repo scaffold

- [x] Repo layout per spec: `.agents/skills/`, `cli/`, `graph/`, `memory/`, `configs/`, `docs/`
- [x] Node workspaces for cli/graph/memory, shared lint/tsconfig
- [x] CI: build + unit tests on push (GitHub Actions, macOS/Linux/Windows matrix)

Acceptance: fresh clone, one install command, all three packages build and test green on all three OSes in CI.

## M1 - greybeard-graph: auth + read path

- [x] MSAL interactive delegated auth against the Graph CLI first-party app
- [x] Token cache with OS-level protection (Keychain/DPAPI/libsecret), caches per (tenant, app), plaintext fallback flagged (never claimed encrypted)
- [x] `graph` tool: GET, beta default, query params, fetchAll + maxItems, 429 retry, all-GET `$batch` passthrough
- [x] `get-auth-status` (incl. credentialMode, entraP1, directoryRoles), `add-scope` with admin-consent handoff URL and write-scope refusal in read-only mode
- [x] Error classification: missing-scope (consent URL) vs missing-P1-license vs missing-directory-role, each with distinct guidance
- [x] Session metadata accumulation (requests, pages, warnings)

Acceptance: from Claude Code, sign in with Tier 1 scopes and answer "how many users have accountEnabled false" with one `$select`-scoped call; a Tier 2 endpoint returns the exact missing scope and a working consent URL; a P1-gated endpoint on a non-P1 tenant returns the license classification, not a consent URL; `get-auth-status` shows cache protection state truthfully; write verb returns E_WRITE_BLOCKED.

## M2 - Write gate

- [x] `plan-write` non-blocking intake, `check-plan` long-poll with exactly-once token delivery
- [x] Approval channels: elicitation (allowlist, cancel falls through), localhost page (nonce lifetime semantics per write-gate.md section 6), CLI channel opt-in behind `gate.cliApprove`
- [x] Invariant 4 enforced and tested: no nonce/approval URL in any tool result, notification, error, or file
- [x] Token mint/verify (hashed at rest, constant-time, process-bound, 300 s TTL, single-use)
- [x] `execute-plan` sequential replay under the writes credential, response references, stopOnError, per-op results
- [x] Writes credential path testable via a dev-provisioned workspace app (wizard `--writes` flow itself lands in M3)
- [x] Batch inner-write blocking; audit log JSONL (channel recorded, no secrets)
- [x] All test cases in docs/write-gate.md section 12 automated

Acceptance: every test case in write-gate.md section 12 passes in CI (approval channels driven by a test harness); a manual end-to-end run on a test tenant creates and patches a group via an approved plan and refuses the same patch without one; the leak test (section 12 case 19) passes.

## M3 - Wizard v0 (Claude Code only) + install

- [x] `greybeard setup`: client detection, Tier 1 sign-in, consent handoff path, MCP config write, skill symlink wiring for Claude Code
- [x] `greybeard setup --writes`: workspace app registration creation, read+write scope consent on it, per-(tenant, app) cache
- [x] `greybeard doctor`: auth, cache protection (plaintext flagged red), P1 license and directory-role detection, config, skill wiring, first-party app reachability
- [x] `greybeard approve` (opt-in channel): TTY-required, plan render, decision POST
- [x] `install.sh` and `install.ps1` (CLI install, repo clone to `~/.greybeard`, launch setup)

Acceptance: on a clean macOS and a clean Windows VM, one install command to a working "what's my tenant's MFA coverage?" answer in Claude Code in under 5 minutes, including sign-in; doctor reports all green; setup is idempotent on re-run.

Verification note: CLI behavior is covered with mocked MSAL and Graph unit tests, and `npm run ci` is the local gate. The clean macOS and clean Windows VM acceptance test still needs to be run outside this workspace.

## M4 - Hero skills

- [x] `tenant-pulse` (scored snapshot, Tier 1 scopes only, copy-paste-ready output, per-pillar degradation on non-P1 tenants and under-roled users)
- [x] `ask-my-tenant` (NL to scoped Graph call, ticket-ready answer)
- [x] `posture-script` (least-privilege PowerShell/Graph script, works offline)
- [x] `change-plan` skill fronting the gate
- [ ] Trigger test: one known prompt per skill triggers that skill and no other

Note: static trigger artifacts and catalog validation are added in M4/M6. Model-driven trigger execution remains manual until M7 client smoke tests.

Acceptance: on a P1 demo tenant, tenant-pulse completes in under 60 s of wall time with no scope prompts beyond Tier 1; on a non-P1 tenant it still returns a scored snapshot with the license-gated pillars marked "requires Entra ID P1" instead of erroring; each hero skill passes its trigger test; a deliberate write request routes through change-plan and the approval page appears.

## M5 - greybeard-memory

- [x] SQLite + FTS5 store, WAL, shared path, schema per docs/mcp-tools.md
- [x] `recall`/`remember`/`list`/`forget` with privacy-rule rejection and supersede logic
- [x] Eviction (soft cap, sticky preferences, query TTL)
- [x] Claude Code recall hook as opt-in `greybeard setup --memory-hook`; `greybeard memory list|forget` in the CLI
- [x] Skill preambles updated to call recall/remember

Acceptance: teach a preference in one session ("use DeviceComplianceOrg"), get it applied without re-teaching in a fresh session; an attempt to remember a raw user list is rejected; two clients writing concurrently corrupt nothing (WAL test).

## M6 - Remaining v1 skills (8)

- [x] least-privilege-scopes, graph-patterns, kql-authoring
- [x] intune-assignments, intune-compliance
- [x] entra-identity, conditional-access-review, license-optimizer
- [x] Each with test question + expected behavior; static trigger-distinctness pass across all 12

Note: model-driven trigger tests remain manual until M7; automated coverage validates catalog shape, two-field frontmatter, distinct description prefixes, manifest versions, `agents/openai.yaml`, and `test.md` presence.

Acceptance: all 12 v1 skills pass their trigger tests in one suite run; [L] skills degrade correctly when signed out (point to `greybeard setup`, no silent failure); the distinctness matrix passes, where ask-my-tenant is tested for precedence (specialist questions trigger the specialist, not the catch-all) and all other pairs for non-overlap.

## M7 - Multi-client

- [x] Wizard adapters: Cursor, Codex CLI, Gemini CLI (MCP config + skill wiring or context-file fallback per client)
- [x] GitHub Copilot adapter: `copilot` binary detection plus setup flag and config override, `~/.copilot/mcp-config.json`, native `~/.copilot/skills`, and a `~/.copilot/copilot-instructions.md` fallback writer
- [x] Per-client smoke test, Codex CLI: all 12 skills discovered natively from ~/.agents/skills and greybeard-graph/get-auth-status returned the signed-in tenant over the shared cache (2026-07-05). Cursor, Gemini CLI, and GitHub Copilot remain open
- [ ] Per-client elicitation smoke test: verify elicitation renders as user-facing UI before adding a client to the gate's elicitation allowlist; everyone else keeps the browser approval page
- [x] README support matrix sourced from adapter behavior; real-client trigger smoke remains open

Acceptance: on each client, the smoke test passes or the README matrix honestly marks the fallback in use; doctor validates wiring per detected client.

## M8 - Update model + release

- [x] Release workflow for @greybeard/graph and @greybeard/memory with npm provenance
- [ ] npm publish executed for @greybeard/graph and @greybeard/memory
- [x] Latest/pinned server modes in wizard; default remains local dist paths until first npm publish
- [x] Scheduled skill pull (cron/launchd/Task Scheduler) per wizard choice; `greybeard update` with changed-skill report
- [x] Skill version manifest plus `agents/openai.yaml` metadata; `SKILL.md` frontmatter limited to name and description
- [x] README: positioning, consent requirements (honest version), setup matrix, first-run walkthrough, first-party app ID risks, security notes (token cache, gate, audit log)
- [x] CONTRIBUTING.md per spec

Acceptance: bumping a published server version reaches a latest-mode user on next client launch and does not reach a pinned user until `greybeard update`; a skills repo push reaches a weekly-mode user via the scheduled pull; README claims match doctor/smoke-test reality.

## M9 - Claude Desktop client

Research basis (verified 2026-07-12 against official docs): Claude Desktop still supports local stdio MCP servers via `claude_desktop_config.json` (macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`), plain `command/args/env` shape, full app restart required after edits. Skills are supported on all plans including Free, uploaded as ZIPs via Settings > Capabilities > Skills, and auto-trigger from the description field. Every tool call gets Claude Desktop's own explicit approval UI. MCP Bundles (`.mcpb`, renamed from `.dxt`) are the official one-click packaging for local stdio servers; no silent programmatic install exists, so direct config write remains the scripted path.

- [x] Pre-work: extract the per-client if/else chains in `cli/src/clients.ts` and `cli/src/doctor.ts` into a `ClientAdapter` record keyed by `KnownClientName` (detection, MCP writer/inspector, skills wiring, fallback writer, ambient branch). Nine dispatch sites today; do this once before adding a sixth client
- [x] Add `"Claude Desktop"` to `KnownClientName` with `detectClaudeDesktop`: macOS `/Applications/Claude.app` or config file present; Windows `%APPDATA%\Claude\claude_desktop_config.json`. Handle the Windows MSIX-install config-path discrepancy (anthropics/claude-code#26073) in detection notes
- [x] MCP config writer/inspector for `claude_desktop_config.json`, `"plain"` shape, same foreign-entry preservation as other JSON clients, 0600 mode; setup output must state that a full Claude Desktop restart is required
- [x] Skills channel: new `greybeard skills pack [--out <dir>]` command producing one ZIP per skill (folder name equals skill name, `SKILL.md` at root), Node built-ins only (no new dependency), plus printed upload instructions (Settings > Capabilities > Skills). No symlink dir and no ambient fallback file exist for this client; nothing is faked
- [x] `greybeard update`: surfaces the changed-skill report with a repack-and-re-upload reminder naming the changed ZIPs when Claude Desktop is detected
- [x] Doctor: inspects MCP wiring; reports the skills-upload state as a marker-free manual step that cannot be verified locally (uploads are private to the account)
- [x] Write gate: localhost browser approval page only; elicitation allowlist verified unchanged (Claude Desktop joins the M7 elicitation smoke-test backlog)
- [x] README support matrix row and a `docs/decisions.md` record (config path, skills mechanism, restart requirement, MSIX caveat), following the Codex CLI precedent
- [x] Decision (user, 2026-07-12): the `.mcpb` one-click bundle is deferred out of the first pass; `greybeard setup` config-write is the only install path for now. Revisit as a release artifact once the adapter is proven
- [ ] Real-client smoke test on a machine with Claude Desktop installed: setup detects and writes config, both servers appear after a full restart, `get-auth-status` answers in a normal chat, an uploaded skill ZIP auto-triggers on its `test.md` question (intune-compliance precedence over ask-my-tenant), and a `plan-write` opens the browser approval page
- [ ] MSIX heuristic check against a real Windows MSIX install (the package-directory regex is a documented best-effort assumption)

Acceptance: on a machine with Claude Desktop installed, `greybeard setup` detects it and writes both core servers into `claude_desktop_config.json` without touching user-authored entries; after an app restart both servers appear and `get-auth-status` answers in a normal chat; an uploaded skill ZIP auto-triggers on its test question from `test.md` (smoke: a compliance question triggers intune-compliance, not ask-my-tenant); a `plan-write` opens the browser approval page and an approved plan executes; doctor reports Claude Desktop MCP wiring truthfully and marks skills upload as manual; the README matrix row matches observed behavior.

## M10 - ChatGPT desktop app: deferred (decision 2026-07-12)

Hard constraints (verified 2026-07-12): the ChatGPT desktop app cannot connect to local stdio servers or plain localhost; custom connectors and developer-mode MCP require a publicly reachable HTTPS endpoint (SSE or Streamable HTTP) plus server-side OAuth ("OAuth with Client ID Metadata Documents" per https://developers.openai.com/api/docs/mcp), reached via OpenAI's Secure MCP Tunnel or ngrok/Cloudflare. Developer mode needs a paid plan. There is no Agent Skills equivalent; per-task guidance lives in Project instructions or a Custom GPT, and custom connectors do not auto-trigger as reliably as first-party ones.

- [x] Decision (user, 2026-07-12): defer ChatGPT entirely. Tunnel exposure plus an OAuth build conflicts with the local-first principle (spec line 427) and the write gate's single-local-session design for too little payoff. Revisit when OpenAI supports local MCP servers. Recorded in docs/decisions.md
- [ ] On revisit: re-verify transport and developer-mode requirements in-app before re-planning; the rejected options (read-only over tunnel, full experimental tunnel) are preserved in this file's git history

Acceptance: docs/decisions.md carries the deferral with sources; no ChatGPT-related code, config, or README support-matrix row exists.

## Verification checkpoints (before calling v1 done)

- [x] Re-verify current client support for the Agent Skills standard (Codex, Gemini CLI, Cursor, GitHub Copilot) and correct the adapters and matrix
- [ ] Security pass on the gate by someone who did not build it (threat model in write-gate.md section 11 as the checklist)
- [ ] Fresh-eyes install test by an admin who has never seen the project, on Windows

## Review log

- 2026-07-04, pre-implementation spec review (independent reviewer, Graph facts verified against Microsoft Learn): 11 findings + 1. Critical: approval nonce leaked into model-visible channels and pending file, allowing agent self-approval (fixed: invariant 4, channel redesign, CLI channel opt-in). High: write credential model undefined (fixed: workspace app / credentialMode); blocking plan-write not survivable on real clients (fixed: non-blocking + check-plan); Entra P1 license and directory-role gating unaddressed (fixed: consent model section, pillar degradation, error classification). Medium: elicitation trust allowlisted; rejection result/error duality resolved; nonce semantics defined; stdio session semantics defined; npx @latest tag; plaintext cache fallback stated honestly; ask-my-tenant precedence rule; internal $batch replay dropped. All fixes applied to spec, write-gate.md, mcp-tools.md, and this plan.
- 2026-07-04, M7-M8 implementation review: multi-client adapters, doctor checks, update command, scheduler wiring, versioned skills, release workflow, README, and CONTRIBUTING are in place. Manual remains: real-client skill trigger smoke tests, real-client elicitation smoke tests before allowlisting non-Claude clients, first npm publish, clean VM installs, and independent write-gate security review.
- 2026-07-04, per-milestone orchestration review (independent reviewer, distinct from the implementer): 9 findings found and fixed across M1-M3 (error misclassification breaking the 403-to-consent flow on Tier 1 paths, fetchAll truncation flag overwrite, entraP1 tri-state, npm ci, write-gate token consumption leaving plans stuck in executing, bodyless POST sending a JSON null body, Application.ReadWrite.OwnedBy not existing as a delegated permission). Final verification: npm run ci green on all workspaces; both MCP servers smoke-tested over real stdio (initialize, tools/list, and a signed-out get-auth-status call returning the exact spec shape).
- 2026-07-05, Codex CLI real-client smoke test passed: 12/12 skills listed by the live client, greybeard-graph MCP tool call succeeded with silent auth from the unified app cache. First attempt looked like a failure because the probe prompt forbade tool discovery; the wiring was correct throughout.
- 2026-07-05, GitHub Copilot adapter added from current docs: Copilot CLI binary detection plus explicit override, Copilot CLI user MCP config, native personal skills, and fallback local instructions. Real-client Copilot smoke remains open.

- 2026-07-12, M9 implementation review (independent reviewer, distinct from the implementer): no blocker or should-fix findings. Verified by inspection: ClientAdapter registry preserves all five existing clients on the shared write paths; Claude Desktop writer reuses the existing foreign-entry preservation and 0600 path; the skills pack ZIP writer's local/central/EOCD records hand-checked against the ZIP spec with a real zlib round-trip test; detection keeps Claude Code and Claude Desktop signals separate and never counts Greybeard-written config as a signal; doctor output keeps status markers off informational rows; elicitation allowlist unchanged; no graph/src or memory/src coupling. Full npm run ci green locally (implementer's sandbox could not run it). Manual remainder tracked as open M9 checkboxes.

## Graph call verification with Lokka (2026-07-05)

- [x] Extract every Graph call from .agents/skills/*/SKILL.md, graph/src, cli/src
- [x] Execute each read call live via Lokka (beta, documented $select/$filter/headers)
- [x] Second round for calls needing real IDs (assignments, deviceStatusOverview, deviceStatuses, $batch owners)
- [x] Fix call shapes that fail or return unexpected results
- [x] Re-verify fixes live

### Review

Verified 22 distinct call shapes live against Ugur Koc Lab (app-only Lokka connection). 20 passed as documented. 2 were broken and fixed:

- tenant-pulse: /roleManagement/directory/roleAssignments $select included appScopeId and createdDateTime; the service rejects both with 400 on beta and v1.0. Trimmed to id,principalId,roleDefinitionId,directoryScopeId; re-verified 200.
- intune-compliance: deviceStatuses $select caused an Intune 500. Removed $select and documented client-side trimming; re-verified 200 (all wanted fields are in the default payload).

Notes from verification: users createdDateTime ge filter works without ConsistencyLevel eventual on beta; roleDefinitions requires a minimum page size of 20 (documented shape without $top is fine); guest and disabled counts of 0 are genuine tenant state (24 enabled members, 0 guests). Not verifiable app-only: /beta/me/memberOf in msalAuth.ts (delegated-only path) and the write calls in cli/setup.ts and change-plan (shapes match Graph docs; no writes performed).

Acceptance: every documented read call succeeds live with its documented shape or is fixed and re-verified; delegated-only and write calls validated against docs and noted; no tenant writes.
