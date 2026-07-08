<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/greybeard-dark.png">
    <img src="assets/logo/greybeard-light.png" alt="Greybeard logo: a bespectacled face with a grey beard" width="188">
  </picture>

# Greybeard

**Senior admin judgment for Microsoft 365, Intune, and Entra, in the AI client you already use.**

<p>
  <img alt="Claude Code" src="https://img.shields.io/badge/Claude%20Code-1f1f1f?logo=anthropic&logoColor=white">
  <img alt="Cursor" src="https://img.shields.io/badge/Cursor-1f1f1f?logo=cursor&logoColor=white">
  <img alt="Codex CLI" src="https://img.shields.io/badge/Codex%20CLI-1f1f1f?logo=openai&logoColor=white">
  <img alt="Gemini CLI" src="https://img.shields.io/badge/Gemini%20CLI-1f1f1f?logo=googlegemini&logoColor=white">
  <img alt="GitHub Copilot" src="https://img.shields.io/badge/GitHub%20Copilot-1f1f1f?logo=githubcopilot&logoColor=white">
</p>

</div>

Every team has one: the admin with the grey beard who has been there for years, who has seen the tenant grow from fifty seats to five thousand, and who knows without looking which Conditional Access policy will lock everyone out and which stale group is load-bearing. When a change is risky, you ask them first. That instinct is experience, and it usually walks out the door when they do.

Greybeard is that experience, made portable. It brings the veteran's habits to whatever AI client you already use: read before you write, ask for the narrowest permission that does the job, scope every query instead of dragging the whole tenant into context, reach for the full Graph surface when the task needs it, and never make a change to production without a human signing off first. The AI has the speed; Greybeard gives it the judgment.

Concretely, it is a portable set of Agent Skills plus MCP servers for Microsoft 365, Intune, and Entra admins. It calls the Microsoft Graph beta endpoint by default for full coverage, asks for the narrowest delegated scope that can do the job, uses `$select` and filters instead of over-fetching, and routes every tenant write through a server-side approval gate.

## One Overlay, Three Layers

Greybeard installs as a single overlay on the AI client you already use, and it works the same in every supported client. The three layers map to what a senior admin actually has:

| Layer | What it is | Why it exists |
|---|---|---|
| Skills, the judgment | Seventeen Agent Skills that encode how a senior admin thinks: which question to ask first, which approach fits which task, when to stop | An AI client with Graph access but no judgment over-fetches, guesses at endpoints, and writes without a plan |
| MCP servers, the hands | `greybeard-graph` for scoped Graph reads and gated writes, `greybeard-memory` for recall, plus optional servers like the IntuneAutomation script library | Judgment without hands is a lecture; the servers make the narrow reads and route every write through human approval |
| Memory, the experience | A local second brain that accumulates your naming conventions, decision records, and confirmed working queries and scripts | Experience is what makes the tenth session better than the first; without it every session starts from zero |

How the layers work together, using "why are marketing devices noncompliant" as the example: the judgment picks the intune-compliance skill and recalls that this tenant reports compliance by deployment ring; the hands run the narrowest filtered reads for the marketing group's devices; and once you confirm the root cause, the experience keeps the pattern, so next month's triage starts ahead instead of starting over.

Each layer degrades independently. The craft skills work with no signed-in tenant, everything works with memory empty, and all three layers travel to every client you configure.

## What Is Included

- `greybeard-graph` (the hands): Microsoft Graph MCP server with MSAL interactive auth, read-safe Graph access, incremental consent guidance, and the write gate.
- `greybeard-memory` (the experience): local SQLite and FTS5 memory shared across clients.
- `greybeard` CLI: `setup`, `setup --writes`, `doctor`, `approve`, `memory`, `scopes`, and `update`. Optional MCP servers such as `intuneautomation` toggle with `greybeard setup --enable-server <name>` and `--disable-server <name>`. Setup never overwrites an MCP server entry you wrote yourself, and pinned mode pins third-party servers to the version vetted in the server catalog.
- Seventeen Agent Skills (the judgment) under `.agents/skills/`, organized into `read/`, `write/`, `craft/`, and `mentor/` categories (see the skill catalog below).

## Install

macOS and Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/ugurkocde/greybeard/main/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/ugurkocde/greybeard/main/install.ps1 | iex
```

Both scripts clone the repo to `~/.greybeard`, run `npm ci`, build the workspaces, install the `greybeard` command, and launch `greybeard setup`. To install from a fork or local checkout instead, set `GREYBEARD_REPO_URL` to that URL.

## First Run

Run `greybeard setup`. Before a browser opens, setup shows what will happen and waits for confirmation in interactive terminals:

```text
Greybeard setup

Will configure Claude Code and Cursor. (Codex CLI, Gemini CLI, GitHub Copilot not detected)

Sign in to Microsoft
  Microsoft's own sign-in page (login.microsoftonline.com) with
  the first-party Microsoft Graph Command Line Tools app.
  Greybeard never sees your password, registers no app of its own,
  and cannot write to your tenant.
  Requests 6 read-only scopes: users, groups, policies, org and license info, audit logs, usage reports.
  Run greybeard scopes for the full list and reasons.

Press Enter to open your browser and sign in (Ctrl+C to cancel)
OK    Signed in                admin@contoso.com (contoso.com)
      MCP servers              greybeard-graph, greybeard-memory, intuneautomation
OK    Claude Code              MCP servers and 17 skills configured
OK    Cursor                   MCP servers, 17 skills, and context block configured
OK    Memory                   ready; weekly auto-update scheduled
OK    Memory hook              installed in ~/.claude/settings.json

Done. Open Claude Code and ask: what is my tenant MFA coverage?
```

`greybeard scopes` prints every Tier 1, Tier 2, and write scope with the reason it is requested. `--verbose` adds file paths and detection details to the setup ledger. After setup, run `greybeard doctor`, then ask the suggested tenant-pulse question in your client.

Setup is idempotent. It preserves unrelated user MCP config and replaces only Greybeard-owned blocks or symlinks.

## Skill Catalog

Skills live under `.agents/skills/<category>/<skill>/` and are linked into each client by their flat skill name.

| Category | Skills | What they do |
|---|---|---|
| `read/` | tenant-pulse, ask-my-tenant, intune-assignments, intune-compliance, entra-identity, conditional-access-review, license-optimizer | Live-tenant analysis and reporting |
| `write/` | change-plan | Stages tenant writes through the server-side approval gate |
| `craft/` | posture-script, graph-patterns, kql-authoring, least-privilege-scopes | Scripts, Graph mechanics, KQL, and scope planning without a signed-in tenant |
| `mentor/` | grill-my-change, diagnose, tenant-decisions, handoff, learn-my-tenant | Pre-change interviews, incident triage, decision records, session handovers, tenant onboarding |

A skill that cannot work without a specific capability declares it in its frontmatter: MCP servers, delegated Graph scopes, an Entra ID P1 license, a directory role group, or write configuration. `greybeard doctor` compares those declarations against the signed-in account and prints one warning per skill with the exact remedy, for example `run greybeard setup --writes` or `ask the agent to call add-scope`. Unmet requirements never fail doctor, because skills degrade by design.

The mentor skills are the second-brain half of Greybeard. `grill-my-change` interviews you about blast radius, break-glass exclusions, pilot rings, and rollback before a change reaches the write gate. `diagnose` runs hypothesis-driven incident triage with the narrowest read that can falsify each hypothesis. `tenant-decisions` records why the tenant is configured the way it is (`Decision: ... Because: ... Decided: ... Revisit: ...`) so the reasoning survives staff changes, and `handoff` turns a session into paste-ready shift-change notes. `learn-my-tenant` bootstraps all of it: it interviews you about naming conventions, rings, break-glass accounts, and change windows, takes a narrow read-only look at the tenant, and seeds memory so the first real session already knows your environment.

## Consent And Scope Tiers

Greybeard is for admins. Every delegated Graph scope used here needs admin consent. If the signed-in user cannot grant it, setup prints an admin-consent URL and a one-line reason per scope, then exits cleanly so another admin can consent.

In an interactive terminal, setup never opens the browser without first showing the sign-in and scope disclosure and waiting for explicit confirmation.

Tier 1, requested at first sign-in:

| Scope | Used For |
|---|---|
| `User.Read.All` | Users, stale accounts, identity hygiene |
| `Group.Read.All` | Groups and memberships |
| `Policy.Read.All` | Conditional Access and policy reads |
| `Organization.Read.All` | Tenant and license information |
| `AuditLog.Read.All` | Audit and sign-in activity |
| `Reports.Read.All` | MFA and usage reporting |

Tier 2 is requested only when a skill needs it: `Device.Read.All`, Intune read scopes, `Application.Read.All`, `RoleManagement.Read.Directory`, `IdentityRiskyUser.Read.All`, and `SecurityEvents.Read.All`.

Writes are separate. `greybeard setup --writes` creates a tenant-owned workspace app and requests write scopes such as `User.ReadWrite.All`, `Group.ReadWrite.All`, and `Policy.ReadWrite.ConditionalAccess`. Write scopes are never added to the first-party read path.

License and role gates are separate from consent. Some reporting endpoints require Microsoft Entra ID P1, and delegated reporting also requires Reports Reader, Security Reader, Global Reader, or higher. Greybeard reports missing license or role as that problem, not as another consent prompt.

## Write Safety

The generic Graph tool refuses non-GET requests and refuses `$batch` payloads that contain inner writes. Tenant writes can only run through `plan-write`, human approval, `check-plan`, and `execute-plan`.

The approval secret never appears in model-visible tool output or files. The server stores the approved operations and executes only that stored copy. A different change needs a different plan and a new human approval.

Honest boundary: this protects the Greybeard MCP Graph path. A client or agent that can run arbitrary shell commands as the same OS user is outside the local gate's control. Keep that capability restricted in clients where you rely on local approval boundaries.

## Memory Privacy

Memory is the experience layer of the overlay, and it earns that role only if it can be trusted with nothing sensitive. Greybeard memory stores intent, preferences, and decision records, not raw tenant output. Examples that are acceptable: `use 90 days as the stale account threshold`, `prefer DeviceComplianceOrg for compliance reports`, and a decision record like `Decision: the warehouse group stays excluded from the MFA policy. Because: scanners cannot do MFA. Decided: 2026-07-08.` Examples that are rejected: user lists, device lists, UPN dumps, GUID-heavy payloads, and Graph JSON responses. Decision records may name up to three tenant objects because the rationale needs them; every other entry type rejects at two GUIDs.

The memory database stays local in the OS app-data path and is partitioned by tenant.

## Token Cache

MSAL token caches are protected by the OS where available: Keychain on macOS, DPAPI on Windows, and libsecret or compatible keyrings on Linux. There is one cache per app, and MSAL partitions accounts by tenant inside it. On headless Linux without a keyring, the cache can fall back to plaintext. `greybeard doctor` flags that state as a failure. Greybeard does not claim encryption without a key source.

## First-Party App ID Risks

The default read-only path uses the Microsoft Graph Command Line Tools first-party app ID, `14d82eec-204b-4c2f-b7e8-296a70dab67e`.

Known risks:

- Some tenants block or restrict that service principal because the same client ID is abused by attack tooling.
- Microsoft can change first-party token issuance behavior.

Fallback: run `greybeard setup --writes` to create a tenant-owned workspace app. After bootstrap, an admin can revoke the broad `Application.ReadWrite.All` grant from the first-party app unless they need to recreate the workspace app.

## Client Support Matrix

This table describes what the current adapters write.

| Client | Detection | MCP Config | Skills | Ambient Recall | Approval Channel |
|---|---|---|---|---|---|
| Claude Code | `claude` on PATH, or a `~/.claude.json` that Greybeard did not create alone | Yes, `~/.claude.json` with `greybeard-graph` and `greybeard-memory` | Native symlinks into `~/.claude/skills` | Prompt-time recall hook in `~/.claude/settings.json`, on by default, `--no-memory-hook` opts out | MCP elicitation is allowlisted for Claude Code, with browser fallback. CLI approval is opt-in. |
| Cursor | `cursor` on PATH, or the installed app (`/Applications/Cursor.app`, `%LOCALAPPDATA%\Programs\cursor`) | Yes, `~/.cursor/mcp.json` | Native symlinks into `~/.cursor/skills`; setup and update also write `~/.cursor/rules/greybeard.mdc` | Always-applied Cursor rule with recall and capture guidance | Browser approval page. Elicitation stays off until a real-client smoke test passes. |
| Codex CLI | `codex` on PATH, or `~/.codex/auth.json` | Yes, `~/.codex/config.toml` under `[mcp_servers.*]` | Native symlinks into `~/.agents/skills`; setup and update also write `~/.codex/AGENTS.md` | Context block in `~/.codex/AGENTS.md` with recall and capture guidance | Browser approval page. Elicitation stays off until a real-client smoke test passes. |
| Gemini CLI | `gemini` on PATH only, because `~/.gemini` is shared by unrelated Google tooling | Yes, `~/.gemini/settings.json` | Native symlinks into `~/.gemini/skills`; setup and update also write `~/.gemini/GEMINI.md` | Context block in `~/.gemini/GEMINI.md` with recall and capture guidance | Browser approval page. Elicitation stays off until a real-client smoke test passes. |
| GitHub Copilot | `copilot` on PATH, or forced with `greybeard setup --with-copilot` for non-CLI Copilot surfaces. The shared `~/.copilot` directory is never a detection signal. | Yes, `~/.copilot/mcp-config.json` with `mcpServers` and `type: "local"` servers | Native symlinks into `~/.copilot/skills`; setup and update also write `~/.copilot/copilot-instructions.md` | Context block in `~/.copilot/copilot-instructions.md` with recall and capture guidance | Browser approval page. Elicitation stays off until a real-client smoke test passes. |

Greybeard never treats the mere existence of a shared config directory, or files Greybeard itself wrote, as proof a client is installed. Undetected clients are skipped by setup and doctor.

Native skills support was rechecked against current client documentation for Cursor, Codex CLI, Gemini CLI, and GitHub Copilot during M7. The smoke tests that require real client installs remain manual.

## Updates

`greybeard setup` installs an Auto-update choice:

- `--skill-update weekly`: scheduled `greybeard update`, the default.
- `--skill-update login`: run on login where the OS scheduler supports it.
- `--skill-update off`: manual update only.

`greybeard update` runs `git pull --ff-only` in the installed repo, reports changed skills since the previous HEAD, refreshes client MCP config, re-links skills, and rewrites each detected client's context block and the Claude Code recall hook, so layout and guidance changes in the repo heal without a full setup re-run.

Server update modes are implemented but npm publishing has not run yet. The default config writes local `node .../graph/dist/index.js` and `node .../memory/dist/index.js` paths. After first npm publish, `--server-source npm --server-update latest` writes `npx -y @greybeard/graph@latest` and `@greybeard/memory@latest`; pinned mode writes the current package versions.

## Telemetry

None. Greybeard has no usage collection, analytics, or remote logging. Network calls are the ones required for Microsoft Graph, Microsoft Learn MCP, git or npm updates you opted into, and package install.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New skills need portable frontmatter, a distinct `Use when...` trigger, `test.md`, a `version` field, and a `CHANGELOG` section.
