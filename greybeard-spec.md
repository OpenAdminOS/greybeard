# Greybeard - Build Spec

Your senior admin, installed in the AI you already use.

## Why Greybeard (positioning)

**AI is expensive because it runs unguarded.** An ungoverned agent explores, retries, over-fetches, pulls a whole tenant into context to answer one question, and invents cmdlets that do not exist. Every wasted call is tokens and money.

Greybeard is the senior admin sitting next to you. It guides your prompting, scopes every call to exactly what is needed, uses Microsoft Graph beta by default for full surface coverage, batches instead of looping, and grounds answers in real docs so the model stops guessing and retrying. Not more capability. More discipline.

The result: the right answer, fewer tokens, lower bill. Token discipline is the shared job of graph-patterns, least-privilege-scopes, and the graph server's defaults: choose the narrowest scopes, select only needed fields, filter server-side, batch fanout, and page deliberately. After a run Greybeard reports what it did: the calls it made, the scopes it used, the API version used, and the scoping decisions it took, so the discipline is visible without inventing a counterfactual "you would have spent X" number.

Lead with this everywhere: name, README, launch. Not "more skills." **A senior admin that keeps your AI cheap and correct.**

---

## Document map

- This file - product spec: positioning, architecture, skills, consent, safety, memory, updates.
- [docs/write-gate.md](docs/write-gate.md) - normative write-gate protocol: invariants, tool contracts, state machine, tokens, approval channels, error codes, threat model, acceptance test cases.
- [docs/mcp-tools.md](docs/mcp-tools.md) - tool contracts for greybeard-graph and greybeard-memory, including the memory schema DDL.
- [tasks/todo.md](tasks/todo.md) - build plan: milestones M0-M8 with acceptance criteria.

Where this file and a docs/ file disagree on protocol detail, the docs/ file wins.

---

## What it is

A portable suite of Agent Skills + MCP servers for Microsoft 365, Intune, and Entra admins. Works in Claude Code, Codex CLI, Gemini CLI, and Cursor.

- Skills are authored to the open Agent Skills standard (canonical path `.agents/skills/`).
- Graph access runs through Greybeard's own MCP server, **greybeard-graph**, using interactive delegated MSAL auth against the Microsoft Graph Command Line Tools first-party app (`14d82eec-204b-4c2f-b7e8-296a70dab67e`), so there is no app registration to maintain for the read-only path.
- All onboarding runs through Greybeard's own terminal wizard, so it is identical on every client and never depends on client UI.

### Build vs reuse (decision)

Lokka already offers MSAL interactive auth on the same first-party app with a generic Graph tool. Greybeard still ships its own Graph server for one reason: **the change-plan write gate must live inside the server's write path** (see Write safety). A gate implemented as skill instructions on top of a third-party server can be bypassed by prompt injection or by any skill that skips the plan. Owning the server is what makes the safety claim true. Everything else (consent UX, scope tiers, call reporting) also benefits from living in the same process, but the gate is the reason.

### First-party app ID: known risks

Piggybacking on the Graph Command Line Tools app works today, but two risks are accepted knowingly and documented in the README:

1. Security-conscious tenants increasingly block or restrict that service principal, because attack tooling abuses the same client ID. In those tenants the read-only path fails.
2. Microsoft could tighten token issuance for first-party client IDs at any time.

The fallback for both is the `--writes` path: `greybeard setup --writes` creates a proper Entra app registration in the admin's tenant, and `greybeard doctor` detects a blocked first-party app and points to it.

---

## Repository architecture

```
greybeard/
├── .agents/
│   └── skills/                      # canonical, cross-agent (Claude / Codex / Gemini / Cursor)
│       ├── tenant-pulse/
│       │   ├── SKILL.md
│       │   ├── references/          # loaded on demand
│       │   └── scripts/             # agent-run, only output enters context
│       ├── ask-my-tenant/
│       │   └── SKILL.md
│       └── ...one folder per skill (see catalog)
│
├── cli/                             # the greybeard wizard (setup / update / doctor / approve)
│   ├── src/                         # Ink (Node). One toolchain with the servers; shares MSAL code with graph/
│   └── package.json
│
├── graph/                           # greybeard-graph MCP (MSAL interactive + generic Graph tool + write gate)
│   ├── src/
│   └── package.json
│
├── memory/                          # greybeard-memory MCP (SQLite + FTS5)
│   ├── src/
│   └── package.json
│
├── .claude-plugin/                  # Claude Code overlay (optional, marketplace updates)
│   ├── plugin.json
│   └── marketplace.json
├── .mcp.json                        # servers: greybeard-graph + MS Learn + greybeard-memory
│
├── configs/                         # per-client MCP blocks, written by the wizard
│   ├── claude.mcp.json
│   ├── codex.config.toml
│   ├── gemini.settings.json
│   └── cursor.mcp.json
│
├── docs/                            # normative protocol docs (write-gate.md, mcp-tools.md)
├── tasks/                           # build plan (todo.md), lessons learned
│
├── install.sh                       # macOS/Linux: installs the CLI, then launches `greybeard setup`
├── install.ps1                      # Windows: same flow via `irm https://raw.githubusercontent.com/ugurkocde/greybeard/main/install.ps1 | iex`
├── LICENSE                          # MIT
└── README.md                        # setup matrix + first-run walkthrough + consent requirements
```

Naming rule: the three shipped servers are **greybeard-graph**, **greybeard-memory**, and (post-v1) **greybeard-tools**. Never "greybeard MCP" unqualified.

### Build rules for Claude Code

- One folder per skill under `.agents/skills/`. Each has a `SKILL.md`. Deep content in `references/`, runnable helpers in `scripts/`.
- SKILL.md frontmatter stays to the open spec (`name`, `description`). Keep Claude-only fields out of shared skills so Cursor/Codex/Gemini don't drop them.
- `description` is the trigger AND the pitch. Write it as "Use when the user...". Keep triggers distinct or the agent picks the wrong skill.
- Third-party servers (MS Learn) are referenced, never vendored.
- No secrets in the repo. The wizard handles any credential step at runtime.

---

## MCP servers (bundled references)

| Server | Purpose | Config note |
|---|---|---|
| greybeard-graph (yours) | Graph read/write, the core. Generic Graph tool (method/path/OData/body, fetch-all), beta default, write gate | MSAL interactive delegated, first-party Graph CLI app, no app reg on read-only path |
| Microsoft Learn MCP | Grounds answers in real docs, kills invented cmdlets | remote, no auth |
| greybeard-memory (yours) | Local self-improving memory (SQLite + FTS5) | v1, shared DB across clients |

Keep the list short. Every extra server adds tools to context each turn and degrades tool selection. A `greybeard-tools` server for custom non-Graph tools is post-v1 and only gets built when a concrete tool justifies it.

---

## Skill catalog

Legend: **[H]** hero/viral front door, **[S]** safety, **[W]** workflow (multi-step), **[L]** requires live tenant (greybeard-graph signed in). If not signed in, [L] skills tell the user and point to `greybeard setup` instead of failing silently.

### v1 - ships at launch (12)

Twelve excellent skills beat thirty-one adequate ones. Every v1 skill ships with a test question and expected behavior. The rest of the catalog is roadmap.

1. **tenant-pulse** [H][L] - Use when the user asks how healthy or secure the tenant is, or says posture, risk, score, "how are we doing." Returns a scored snapshot: MFA coverage, stale accounts, CA gaps, unused licenses, top risks. The first-run hero.
2. **ask-my-tenant** [H][L] - Use for natural-language questions about live tenant state **when no more specific Greybeard skill matches** ("who has no MFA," "list guest accounts created this month"). Resolves the question to the right Graph call and returns a clean, ticket-ready answer. The catch-all yields to specialists by design (see checklist).
3. **posture-script** [H] - Use when the user wants a script to check or harden something. Produces a ready-to-run, least-privilege PowerShell/Graph script with error handling, not a snippet.
4. **change-plan** [S][L] - Use before any write to the tenant. Produces a dry-run plan (what changes, blast radius, rollback) the admin confirms before execution. Nothing writes without it. Backed by the MCP-level gate below.
5. **least-privilege-scopes** - Use when a task needs Graph permissions. Picks the minimum scope and flags over-permissioning. Token discipline: least access, least waste.
6. **graph-patterns** - Use for Graph mechanics: beta default, explicit v1.0 pinning, pagination, `$batch`, `$select`/`$filter`, throttling and retry. Token discipline: scopes calls so the agent stops over-fetching.
7. **kql-authoring** - Use for any KQL request (write, optimize, explain) for Intune or Log Analytics. Returns working, tuned queries.
8. **intune-assignments** [L] - Use for assignment and targeting questions. Surfaces conflicts, gaps, and exactly what targets a given group or device.
9. **intune-compliance** [L] - Use for compliance policy review and non-compliance triage. Explains why devices fail and what to fix.
10. **entra-identity** [L] - Use for users, groups, and membership hygiene: dynamic rules, orphaned groups, naming, cleanup candidates.
11. **conditional-access-review** [L] - Use to review or audit existing CA. Reads live state and flags gaps (no emergency-account exclusion, missing MFA, report-only left on).
12. **license-optimizer** [L] - Use for license cost and waste: unassigned, duplicate, and downgrade candidates.

### Roadmap - post-v1 (19)

Graph craft: **graph-powershell**, **graph-batch**.
KQL: **kql-intune-reporting**, **kql-sentinel-hunting**.
Intune: **intune-config-profiles** [L], **intune-app-deployment** [L], **intune-autopilot** [L] (needs `DeviceManagementServiceConfig.Read.All`), **intune-remediations** [L], **intune-update-management** [L].
Entra: **conditional-access-design** [S][L] (designs new CA from intent, stages through change-plan - it writes, so it carries [S][L]), **entra-app-hygiene** [L], **entra-pim-roles** [L], **entra-risky-signins** [L].
Security and cost: **secure-score** [L].
Workflows: **offboard-user** [W][L], **onboard-user** [W][L], **stale-device-cleanup** [W][L], **access-review-campaign** [W][L].
Bridge: **openadminos-manifest**.

### Trigger-accuracy checklist (for Claude Code)

- Every `description` opens with "Use when the user..." and names concrete phrases/verbs.
- No two skills share a trigger. Review vs design, reporting vs hunting are split on purpose.
- Exception with a rule: `ask-my-tenant` is a deliberate catch-all and overlaps every [L] skill by construction. Precedence is explicit: specialist skills win, and ask-my-tenant's description says "when no more specific Greybeard skill matches." The distinctness test for it checks precedence (a compliance question triggers intune-compliance, not ask-my-tenant), not non-overlap.
- Broad domains stay one skill with `references/`, not several thin ones.
- Hero skills (1-3) must return a copy-paste-ready artifact, since those outputs are the shareable unit.
- Every write path routes through `change-plan`.
- New skills ship with a test question and expected behavior so triggers can be verified.

---

## Consent model (the honest version)

Every scope Greybeard uses requires **admin consent** for delegated access. There is no "any user can sign in" path for tenant administration data, and the README says so plainly. The target user is an admin; the wizard is designed around that.

### Scope tiers

**Tier 1 - requested at first sign-in.** The minimum that powers `tenant-pulse` and most of `ask-my-tenant`, so the consent screen is short and every scope on it is explainable:

- `User.Read.All`, `Group.Read.All` - identity, membership, stale accounts (signInActivity also needs AuditLog)
- `Policy.Read.All` - Conditional Access
- `Organization.Read.All` - tenant, license SKUs
- `AuditLog.Read.All`, `Reports.Read.All` - sign-in activity, MFA registration, usage

**Tier 2 - requested incrementally**, only when a skill first needs it, via the 403-to-consent flow:

- `Device.Read.All` - devices
- `DeviceManagementConfiguration.Read.All`, `DeviceManagementManagedDevices.Read.All`, `DeviceManagementApps.Read.All` - Intune config, devices, apps
- `DeviceManagementServiceConfig.Read.All` - Autopilot (roadmap)
- `Application.Read.All` - app registrations, service principals, resolving app names in CA policies
- `RoleManagement.Read.Directory` - roles, PIM
- `IdentityRiskyUser.Read.All` - Identity Protection
- `SecurityEvents.Read.All` - Secure Score

Granular scopes, never `Directory.Read.All`, to keep the least-privilege story honest. Writes are never in any read tier and never land on the first-party app at all (see Write credentials); write calls are gated regardless (below).

### Write credentials

Two credentials per tenant, and the model never picks between them:

- **Read-only mode** (default): everything runs under the first-party Graph CLI app. Writes are impossible; the server answers write-scope requests and `plan-write` with a pointer to `greybeard setup --writes`.
- **Writes mode**: `greybeard setup --writes` creates a workspace app registration in the tenant and consents the granted read scopes plus the needed write scopes on it. From then on the server uses the workspace app for **all** calls in that tenant, so there is exactly one active credential per tenant and no dual-token juggling. Incremental write scopes go through `add-scope` against the workspace app.

Token caches are per app. MSAL partitions accounts by tenant inside the app cache, and Greybeard selects the account and authority from the active tenant.

### License and role requirements (the other honest part)

Scopes are not the only gate on Microsoft's side, and the spec must not pretend otherwise:

- `signInActivity` (stale accounts), `userRegistrationDetails` (MFA coverage), and `/auditLogs/signIns` require a **Microsoft Entra ID P1** license on the tenant.
- Delegated reporting endpoints are additionally **role-gated**: the signed-in user needs Reports Reader, Security Reader, Global Reader, or higher, regardless of consented scopes.
- Known Graph quirk: `signInActivity` can fail intermittently when the token lacks `Directory.Read.All`; Greybeard keeps the granular-scope stance, retries once, and reports the caveat rather than widening scope.

Consequences, specified not hoped:

- `tenant-pulse` degrades per pillar: on a non-P1 tenant the MFA-coverage and stale-accounts pillars render as "requires Entra ID P1" lines and the score is computed from the remaining pillars. It never hard-fails on licensing.
- greybeard-graph classifies failures as missing-scope vs missing-license vs missing-role and answers each differently; only missing-scope gets a consent URL.
- `greybeard doctor` and `get-auth-status` report P1 presence and the user's directory roles so skills can predict gaps instead of discovering them mid-run.

### Consent flow in the wizard

1. Sign in requests Tier 1.
2. If the signed-in user can grant admin consent (Global Admin, Privileged Role Admin, or a permitted consent policy), consent completes inline and setup continues.
3. If not, the wizard prints the admin-consent URL for the exact scope set and a one-line justification per scope, ready to hand to whoever can consent, then exits cleanly with a resume hint (`greybeard setup` re-runs idempotently).

### Error and consent UX (running state)

Turn 403s into one-click fixes.

- greybeard-graph maps a permission error to the exact missing scope and returns it with the consent URL.
- If the admin can consent, the prompt handles it inline (incremental consent).
- If admin consent is required and they lack rights, the same handoff link flow as setup applies.
- `get-auth-status` reports current scopes and gaps at any time.

### Token cache

MSAL token caches are protected with OS-level encryption via the MSAL cache extensions: Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux. Where no keyring exists (headless Linux), the MSAL extensions fall back to a **plaintext** file; there is no honest way to encrypt without a key source, so Greybeard does not pretend to: `greybeard doctor` flags that state red and the README warns about it. Cache location is the OS app-data path, one cache per app. MSAL stores tenant-scoped accounts inside that app cache, and the active tenant selects the account and authority. The old per-tenant cache key broke silent auth because setup first signs in under `organizations`, then stores the real tenant ID for later runs.

---

## Write safety (the change-plan gate)

Not a convention, an MCP-level gate with a human in the loop that the model cannot simulate. Full protocol (state machine, token format, approval channels, error codes, threat model, test cases): [docs/write-gate.md](docs/write-gate.md).

### The rule

The generic `graph` tool is **read-only**: GET, plus `$batch` only when every inner request is a GET (the server parses batch payloads, so a write cannot hide inside one). Writes execute only through `execute-plan`, which replays operations the server stored at plan time. There is no code path where the model submits a write body directly to Graph.

### Why the confirmation must be out-of-band

If the model can call whatever issues the token, then prompt injection can too, and the gate is theater. The token is therefore minted only after a human approves the plan **outside the model's channel**. The model can request a plan and execute an approved one; it can never approve, modify, or extend one.

### Flow

1. The agent calls `plan-write` with the intended operations, exact delegated `requiredScopes`, summary, and rollback notes. The server verifies those scopes before approval, stores them with the operations, and reacquires the same set during execution.
2. The server renders a human-readable plan - server-derived facts first (verbs, paths, current-vs-new diffs via its own prefetch reads), the model's stated intent labeled as such - and presents it for approval out-of-band:
   - **MCP elicitation, allowlisted clients only** (clients smoke-tested to render elicitation as user-facing UI). Decline is a rejection; cancel falls through to the browser page.
   - **Localhost approval page** for everyone else: the server opens the default browser to a loopback page (nonce-protected) showing the full plan, and waits for an explicit Approve/Reject click. Works headless-stdio on all platforms and all clients.
   - `greybeard approve` in the CLI: **opt-in** (`gate.cliApprove: true`), for browserless environments. Off by default because a same-user process can imitate a terminal decision; enabling it weakens the gate and the wizard says so.
3. On approval the server mints the token: 256-bit random, hashed at rest, bound to this plan and server process, **single-use**, 5-minute TTL. `check-plan` delivers it exactly once.
4. The agent calls `execute-plan` with the plan ID and token. The server replays its own stored copy of the operations, in order, under the writes credential, and reports per-operation results. Altering an approved operation is impossible by construction: execution never takes operation content from the model.

### Properties

- A different operation needs a new plan and a new human approval. There is no wildcard or standing token. Partial failures do not make a plan re-executable; the remainder needs a fresh plan.
- No approval secret (nonce, approval URL) ever enters a model-visible channel or touches disk, so the gate cannot be defeated from inside the MCP channel: not by prompt injection, a skill that skips the plan, a raw Graph call, or a write smuggled into a `$batch`. Honest boundary: an agent running arbitrary shell commands as the admin's user sits outside any local gate; mitigations and the residual risk are specified in docs/write-gate.md and stated in the README.
- Multi-operation plans (e.g. a future offboard workflow) are approved once as a set; chained values (create-then-configure) use declared response references that the human sees verbatim at approval.
- Every plan and decision lands in a local append-only audit log (which channel decided, operation hashes, never Graph payloads or secrets).

---

## The wizard (`greybeard` CLI)

A terminal TUI shipped with the install, built with Ink (Node) - one toolchain with the MCP servers, and it shares the MSAL auth code with greybeard-graph. Lives independently of any client, runs anytime.

Commands:

- `greybeard setup` - full onboarding. Auto-launched by the installer, re-runnable anytime, idempotent.
- `greybeard setup --writes` - add write access (creates an Entra app registration) later.
- `greybeard update` - pull latest skills, refresh MCP config, report changed skills.
- `greybeard doctor` - check auth, cache protection, client config, skill wiring, versions, first-party app availability.
- `greybeard approve` - list and approve/reject pending write plans; opt-in approval channel for browserless environments (see Write safety).
- `greybeard tenant use <domain>` - switch active tenant (see MSP section).
- `greybeard memory list|forget` - inspect or prune memory.

### Install

- macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/ugurkocde/greybeard/main/install.sh | sh`
- **Windows: `irm https://raw.githubusercontent.com/ugurkocde/greybeard/main/install.ps1 | iex`** - first-class, not a footnote. A large share of Intune/Entra admins run Windows. Scheduled updates use Task Scheduler there, cron/launchd elsewhere.

### Install to first answer

```
$ curl -fsSL https://raw.githubusercontent.com/ugurkocde/greybeard/main/install.sh | sh
  Installing Greybeard...
  ✓ CLI installed to ~/.local/bin/greybeard
  ✓ Skills cloned to ~/.greybeard/skills
  ✓ Detected clients: Claude Code, Cursor, Codex

  Greybeard Setup
  ───────────────────────────────
  › Configure which clients?
      [x] Claude Code   [x] Cursor   [x] Codex

  › Access level?
      (•) Read-only  - sign in now, no app registration
      ( ) Writes     - creates an Entra app registration

  › Sign in to Microsoft…                    [opens browser]
      ✓ Signed in as ugur@contoso.com
      ✓ Consented: User.Read.All, Group.Read.All, Policy.Read.All,
                   Organization.Read.All, AuditLog.Read.All, Reports.Read.All
        (needs an admin role; if you can't consent, Greybeard prints a
         handoff link for your admin instead)

  › Auto-update
      Skills:      (•) On (weekly)   ( ) On login   ( ) Off
      MCP servers: (•) Latest        ( ) Pinned (stable)

  ✓ Wrote MCP config for Claude Code, Cursor, Codex
  ✓ Wired skills for Claude Code, Cursor, Codex
  ✓ Setup complete

  Try this now:  "what's my tenant's MFA coverage?"
```

First run ends by suggesting `tenant-pulse`, which is the sub-60-second wow.

### Skill wiring per client (where portability is earned)

The clone lives at `~/.greybeard/` with skills at `~/.greybeard/skills/` (the repo's `.agents/skills/`). MCP config is the easy half; skill discovery differs per client, and the wizard owns a small adapter per client:

- **Claude Code**: symlink skill folders into `~/.claude/skills/` (personal skills), or install as the Claude Code plugin for marketplace updates. Never both - the wizard detects and picks one.
- **Codex CLI / Gemini CLI / Cursor**: wire via each client's skill/rules discovery mechanism where the client supports the Agent Skills standard; where support is missing or partial, fall back to injecting a short pointer block into the client's context file (`AGENTS.md`, `.cursor/rules`) that tells the agent where the skills live and how to load one.
- The README carries a per-client support matrix (what works natively, what uses the fallback), and `greybeard doctor` verifies the wiring per detected client. Each client adapter has a smoke test: one known prompt must trigger one known skill.

This section is flagged honestly: client support for the skills standard is moving, the adapters are small, and the matrix gets re-verified each release.

---

## Memory (v1, cross-client)

A local, self-improving memory so Greybeard stops re-deriving what the admin already taught it. Shipped as a bundled MCP server (**greybeard-memory**), shared by every client.

### How retrieval actually works (no magic)

An MCP server cannot hook every prompt; it only runs when the model calls its tools. So:

- greybeard-memory exposes `recall(query)`, `remember(type, content, links)`, `list`, `forget`.
- Every Greybeard skill's instructions open with: call `recall` with the task summary before doing anything else, and call `remember` when the admin corrects, chooses, or confirms something.
- On Claude Code, `greybeard setup --memory-hook` can install an opt-in `UserPromptSubmit` recall nudge. It is opt-in because the event fires on every prompt globally.
- On Codex/Gemini/Cursor, retrieval is best-effort by instruction. This is stated plainly rather than promised away.

### Stack (all shipped in the MCP package, no user install)

- **SQLite** embedded file DB via `better-sqlite3` (prebuilt binaries, Win/macOS/Linux), WAL mode so multiple clients can share one DB safely.
- **FTS5** full-text search (porter stemming) for retrieval. No embedding model, no ONNX runtime, no 100 MB download, no native-binary matrix beyond SQLite itself.
- v1.1 option, behind a flag: sqlite-vec + a small local embedding model, added only if FTS recall quality proves insufficient in practice. The schema reserves an `embedding` column so this is additive.
- One global DB at the OS app-data path, enforced by the wizard so all clients share it.

### Schema (two tables)

- `nodes(id, type, content, embedding NULL, tenant, created_at, last_used_at)` - type ∈ query | preference | script | fact | scope.
- `edges(source, target, relation, weight)` - relation ∈ used | depends_on | needs | prefers.

### Write rule (what makes it self-improving)

Write a node on **feedback and preference**, not only on success. When the admin corrects, chooses, or confirms ("use DeviceComplianceOrg for compliance reports"), store that as a `preference` node linked to the task. Next time the match returns it and skips the iteration.

### Privacy rule (hard)

Store **intent and preferences, never raw tenant output**. A node records "prefers X table for Y," "uses 90-day stale threshold," or a script reference, never a returned device list, UPNs, or any Graph payload. Everything stays local. This keeps memory inside the local-first guarantee.

### Eviction

Keep it simple, not strict.

- Soft cap ~2000 nodes per tenant. On exceed, evict by usage-weighted LRU: least recently retrieved and lowest edge-weight go first.
- `preference` nodes are sticky: never auto-evicted while still referenced; a newer preference supersedes (not duplicates) the old one for the same use case.
- `query` nodes carry a soft 90-day TTL unless reused, which refreshes them.
- `greybeard memory list/forget` always lets the admin prune manually.

### Wizard step

One line during setup: create the DB at the shared path, done. Memory is on by default.

---

## Update model

Two independent paths, both configured in the wizard's Auto-update step.

**MCP servers.** Published as npm packages (`@greybeard/graph`, `@greybeard/memory`) and run via `npx -y`.

- **Latest** (default): wizard writes `npx -y @greybeard/graph@latest` into the MCP configs. The explicit `@latest` tag matters: a bare package name lets npx serve its cache without re-checking the registry, so "latest" would silently go stale. Always current, but an upstream break reaches users immediately.
- **Pinned**: wizard writes `@greybeard/graph@<version>` for stability. `greybeard update` bumps the pin on your schedule.

**Skills.** The installer clones the repo once, a static copy. A GitHub push does not reach users until they pull. The wizard offers:

- **Weekly** (default): a scheduled `git pull` job (cron/launchd on macOS/Linux, Task Scheduler on Windows).
- **On login**: pull check at shell start.
- **Off**: manual `greybeard update` only.
- Claude Code plugin users can additionally take marketplace updates (`/plugin update greybeard`).

---

## MSP / multi-tenant

First-class. The `tenant` column scopes every memory node, and auth is per-tenant.

- `greybeard tenant use <domain>` switches the active connection; sign-in is per-tenant inside the app cache, with MSAL account records partitioned by tenant.
- Memory retrieval filters by the active tenant, so preferences never leak across customers.
- One DB file, many tenants inside it, cleanly partitioned.

---

## Contributing

- MIT licensed. `CONTRIBUTING.md` covers skill authoring: folder layout, frontmatter, the "Use when..." trigger rule, and the keep-triggers-distinct check.
- Two paths, mirroring the Awesome Intune model: Build (new skills/MCP tools) and Contribute (improve existing skills, add references).
- New skills ship with a test question and expected behavior so triggers can be verified.

---

## Skill versioning

- `SKILL.md` frontmatter contains only `name` and `description`.
- `.agents/skills/manifest.json` carries skill versions; `greybeard update` reports changed skills from that manifest.
- Each skill includes `agents/openai.yaml` UI metadata and a trigger test artifact.

---

## Telemetry

None. Greybeard is local-first and phones home for nothing. No usage collection, no analytics, no remote logging. The only network calls are to Microsoft Graph (the admin's own tenant), Microsoft Learn MCP, and npm/GitHub for updates the admin opted into.
