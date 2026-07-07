# Implementation Decisions

## 2026-07-05 - Microsoft Graph beta by default

- Greybeard now uses Microsoft Graph beta by default for read calls, write-plan operations, and internal status probes. This gives full surface coverage for admin workflows, including richer sign-in and Intune data that may not be available or complete on v1.0.
- The accepted risk is that beta endpoints can change without notice. Callers may pin `apiVersion: "v1.0"` on a specific call or write operation when API stability matters more than surface coverage.
- Token discipline is not based on choosing v1.0. It stays focused on narrow delegated scopes, `$select`, `$filter`, deliberate pagination, and all-GET batching.

## 2026-07-04 - M0-M1 scaffold and graph read path

- Active tenant selection is a CLI responsibility in M3. For M1, `greybeard-graph` reads `GREYBEARD_TENANT_ID` and otherwise uses `organizations`; the token cache path was initially keyed by the active tenant value and client ID. This was superseded after the unified app-cache incident below.
- `get-auth-status` probes Entra P1 and directory roles with Graph reads after silent auth. If those probes are denied, M1 reports `entraP1: false` and an empty role list instead of widening scopes.
- At M1, only `graph`, `get-auth-status`, and `add-scope` were exposed. Direct non-GET and batch inner-write rejection shipped early in `graph`.

## 2026-07-04 - M2 write gate

- Until the M3 wizard owns config, `greybeard-graph` reads `gate.cliApprove` from `<appdata>/greybeard/config.json`, represented in code as the graph app-data root plus `config.json`.
- `one pending plan per session` means one plan in `AWAITING_APPROVAL`. Approved, rejected, timed-out, expired, and executed plans do not block a new `plan-write`.
- The CLI approval channel uses the same loopback listener as the browser channel and exposes a plan-scoped `/cli/plan/<planId>/decision` endpoint only when `gate.cliApprove` is true. The pending file contains the rendered plan and loopback port, but no URL, nonce, token, or other decision secret.
- The write-gate approval rendering has no workspace app display name until M3 provisions one, so it labels the credential as `workspace app <clientId>`.
- To deliver a token exactly once without retaining plaintext between approval and the first `check-plan`, M2 derives the token bytes from a per-process CSPRNG secret plus the plan binding, stores only `SHA-256(token)`, and recomputes the plaintext only for that one result.

## 2026-07-04 - M3 wizard CLI and install

- The CLI stays dependency-light for M3: plain terminal output plus `node:readline` for `greybeard approve`. Ink is deferred because setup has no complex branching UI yet, and avoiding a renderer keeps non-interactive tests simple.
- Greybeard config now stores `activeTenantId`, `credentialMode`, `workspaceAppId`, `grantedReadScopes`, `requestedWriteScopes`, and `gate.cliApprove` in `<appdata>/greybeard/config.json`. The graph server reads that config at startup and uses the workspace app only when `credentialMode` is `writes` and `workspaceAppId` is present.
- Claude Code user-scope MCP config is written directly to `~/.claude.json` under top-level `mcpServers.greybeard-graph`, matching the documented user scope location. Direct JSON editing keeps setup idempotent and testable without requiring a live `claude` command.
- Claude Code skills are wired by symlinking folders from the repo `.agents/skills/` directory into `~/.claude/skills/`. Setup replaces stale symlinks but never overwrites a real user file or directory at the target path.
- `greybeard setup --writes` uses the first-party app only for the one-time bootstrap delegated permission `Application.ReadWrite.All`, then creates a tenant-owned workspace app with delegated Microsoft Graph permissions. `Application.ReadWrite.OwnedBy` is application-only in Microsoft Graph, so it cannot be used for the delegated interactive bootstrap. After the workspace app exists and has admin consent, an admin can revoke `Application.ReadWrite.All` from the first-party app unless they need to recreate the workspace app. The default requested write scopes are `User.ReadWrite.All`, `Group.ReadWrite.All`, and `Policy.ReadWrite.ConditionalAccess`; admins can override them with repeated `--write-scope` flags or `GREYBEARD_WRITE_SCOPES`.
- The install scripts default to `https://github.com/ugurkocde/greybeard.git` (the public repository), with `GREYBEARD_REPO_URL` as an override for forks or local checkouts.

## 2026-07-04 - M5 greybeard memory

- greybeard-memory reads `<appdata>/greybeard/config.json` on every tool call and uses `activeTenantId` as the partition key. If setup has not written a tenant yet, it uses `organizations`, matching the graph server's pre-setup alias.
- FTS queries are built from server-tokenized, quoted terms. The server may generate an `OR` fallback after an all-term search misses, but raw user text is never passed to FTS syntax.
- Privacy rejection treats two or more GUIDs, two or more UPN-like email addresses, or parseable JSON over 2048 bytes as raw tenant-output shapes. The error tells the agent to store intent instead.
- Preference supersede uses same-tenant preference FTS candidates plus token-overlap scoring. A strong overlap updates the existing row in place so the id and edges stay stable.
- The Claude Code recall hook is opt-in behind `greybeard setup --memory-hook`. Official Claude Code hook docs place user-scope hooks in `~/.claude/settings.json`, and `UserPromptSubmit` has no matcher, so it fires on every prompt globally. Greybeard installs a one-line nudge instead of making this default.

## 2026-07-04 - M7 multi-client adapters

- Cursor support was verified against current Cursor docs: MCP user config lives at `~/.cursor/mcp.json` with `mcpServers`, and Cursor documents Agent Skills in `.agents/skills`, `.cursor/skills`, `~/.agents/skills`, and `~/.cursor/skills`. Greybeard writes MCP config to `~/.cursor/mcp.json` and symlinks skills into `~/.cursor/skills`. The fallback writer can install `~/.cursor/rules/greybeard.mdc`, but setup uses native skills when the symlink path is available. Sources: https://cursor.com/docs/mcp, https://cursor.com/docs/skills, https://cursor.com/docs/rules.
- Codex CLI support was verified against current OpenAI docs: MCP config lives in `~/.codex/config.toml` under `[mcp_servers.<name>]`, Agent Skills are loaded from `$HOME/.agents/skills`, and global instructions can live in `~/.codex/AGENTS.md`. Greybeard writes the TOML tables, symlinks skills into `~/.agents/skills`, and keeps an idempotent AGENTS.md fallback writer. Sources: https://developers.openai.com/codex/mcp, https://developers.openai.com/codex/skills, https://developers.openai.com/codex/guides/agents-md.
- Gemini CLI support was verified against current Gemini CLI docs: MCP config lives in `~/.gemini/settings.json` with `mcpServers`, Agent Skills can be discovered from `~/.gemini/skills` and `~/.agents/skills`, and global context can live in `~/.gemini/GEMINI.md`. Greybeard writes MCP config to `~/.gemini/settings.json`, symlinks skills into `~/.gemini/skills`, and keeps an idempotent GEMINI.md fallback writer. Sources: https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html, https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/using-agent-skills.md, https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html.
- GitHub Copilot support was verified against current GitHub and VS Code docs. Copilot CLI user MCP config lives at `~/.copilot/mcp-config.json` with a top-level `mcpServers` object; local servers use `type: "local"`, `command`, `args`, `env`, and `tools`. Visual Studio also documents `%USERPROFILE%/.mcp.json` with a top-level `servers` object, but that is a different IDE-specific shape. Greybeard targets the Copilot CLI user config as the best GitHub-owned user-scope MCP target across projects, with the limitation that it does not configure every IDE Copilot extension. Copilot Agent Skills are native; personal skills can live in `~/.copilot/skills` or `~/.agents/skills`. Greybeard symlinks into `~/.copilot/skills` and keeps an idempotent `~/.copilot/copilot-instructions.md` fallback writer. Sources: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers, https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills, https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions, https://learn.microsoft.com/en-us/visualstudio/ide/mcp-servers?view=visualstudio.
- `greybeard doctor` checks detected clients for MCP config and either native skill symlinks or fallback blocks. Undetected clients are skipped entirely so shared config directories do not create noisy false findings.
- Assumption kept open: the documented native skill directories are treated as sufficient for setup, and symlinked skill folders are expected to behave like regular skill folders. Real-client trigger smoke tests remain open for Cursor, Codex CLI, Gemini CLI, and GitHub Copilot.
- The Claude Code plugin overlay is minimal metadata pointing at the shared skills. The plugin file shape was checked against Claude Code plugin documentation, but marketplace installation and update behavior remain untested.
- The gate elicitation allowlist stays Claude Code only. Cursor documents MCP elicitation, but Greybeard keeps Cursor, Codex CLI, Gemini CLI, and GitHub Copilot on the browser approval page until a real-client elicitation smoke test confirms a human-visible UI for each client.

## 2026-07-04 - M8 update and release model

- `greybeard update` runs `git pull --ff-only` in the repo root, compares the previous and current HEAD, reports changed folders under `.agents/skills`, reads each current skill version, and rewrites client MCP configs. The git runner is injected through `CliRuntime.runCommand` so tests do not shell out.
- Setup stores `skillUpdate`, `serverUpdate`, and `serverPackageSource` in the Greybeard config. The scheduler writer is injected through `CliRuntime.runCommand`; tests cover command generation without registering real OS schedules.
- Server `latest` and `pinned` modes are implemented. When `serverPackageSource` is `npm`, MCP writers emit `npx -y @greybeard/graph@latest` or `@greybeard/graph@<current version>` and the same for memory. The default remains `serverPackageSource: local`, which writes local `node .../dist/index.js` paths, because `@greybeard/graph` and `@greybeard/memory` have not been published to npm yet.
- The release workflow is present and ready to publish `@greybeard/graph` and `@greybeard/memory` with npm provenance on version tags once the npm organization, access token, and first package publish are in place. The M8 publish execution checkbox remains open until that happens.

## 2026-07-04 - Setup sign-in confirmation

- Setup prints the Microsoft sign-in host, first-party app identity, client ID, password boundary, and exact delegated scopes before token acquisition. This is intentionally before `getToken`, because MSAL can open the browser from that call.
- The confirmation reader first tries `/dev/tty` so `curl | sh` installs still pause on the user's terminal even though standard input is the script pipe. If `/dev/tty` cannot be opened, setup falls back to `process.stdin` only when it is a TTY. If neither path is interactive, setup prints the disclosure and continues with a `proceeding non-interactively` warning.
- `--yes` skips the pause but not the disclosure. The confirmation hook lives on `CliRuntime` so tests can assert ordering and cancellation without invoking a browser.

## 2026-07-04 - Unified MSAL app cache

- Real install incident: setup signed in before `activeTenantId` existed, so MSAL wrote the first-party token cache under `auth/organizations/<clientId>/`. Setup then stored the real tenant ID, and later graph server runs opened `auth/<tenant-guid>/<clientId>/`, an empty cache. Silent auth failed even though setup had just signed in.
- The cache is now keyed only by app client ID: `auth/<clientId>/msal-cache.json`, with keychain account name `<clientId>`. MSAL caches are multi-tenant; `AccountInfo.tenantId` partitions accounts inside the app cache. Tenant selection remains in the authority URL and `findAccount` tenant filtering, with the existing first-account fallback.
- On startup, if the unified cache has no accounts, Greybeard looks for legacy `auth/<tenant>/<clientId>/msal-cache.json` entries, reads the newest one through `PersistenceCreator`, writes its contents into the unified persistence, and leaves legacy files untouched.

## 2026-07-04 - Client detection signals

- Real install incident: setup reported Gemini CLI as detected because `~/.gemini` existed, but that directory had been created by unrelated Google tooling. Greybeard then wrote `settings.json` and skills into that directory, which made the false positive repeat on later runs.
- Client detection now requires a signal uniquely produced by the client itself or a client binary on PATH. Claude Code uses the `claude` binary or a `~/.claude.json` that is not just Greybeard MCP entries; Codex CLI uses the `codex` binary or `~/.codex/auth.json`; Gemini CLI uses only the `gemini` binary because `~/.gemini` is shared; Cursor uses the `cursor` binary or the installed app path. GitHub Copilot uses the `copilot` binary on PATH, matching Gemini's binary-only rule, and keeps `greybeard setup --with-copilot` or `clients.githubCopilot` as an override for non-CLI Copilot surfaces. The shared `~/.copilot` directory, Copilot MCP files, skill dirs, and instruction files are never detection signals.
- Greybeard-written MCP configs, skill directories, and context-file fallback blocks are never detection signals. Setup and update write MCP configs and skills only for detected clients, and doctor skips undetected clients.
