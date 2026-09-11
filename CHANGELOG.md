# Changelog

## 0.1 - 2026-09-11

Release tag: `v0.1.0`. Access to this executable release requires an account with access to the private repository; historical package versions below describe an earlier distribution.

- Host Greybeard releases and authenticated installer downloads in `OpenAdminOS/greybeard`.
- Install one executable, with local graphical or terminal setup and no Node, npm, or Git requirement.
- Use local mentoring and memory without connecting a Microsoft tenant.
- Propose, inspect, confirm, correct, export, pause, and forget scoped lessons through local controls.
- Supply confirmed advisory context for supported Claude Code commands. Execution is not paused and advice may appear afterward.
- Connect a customer-owned application for optional tenant reads on supported POSIX systems; production writes and consent mutation remain disabled.
- Retain memories when replacing the executable or removing client integrations.

Updates use manual verified downloads for this release. Windows tenant credentials and automatic update activation are not implemented. Platform signing and notarization status is recorded with the release assets. See [release notes](docs/0.1/release-notes.md) for installation and current limits.

Historical entries below describe earlier code and retain their original version labels.

## 0.1.1 - 2026-07-10

### Security

- Workspace app setup now persists only Greybeard's explicit Tier 1 and selected write scopes. Permissions present only because of a cached first-party token are never copied into the tenant app registration.
- Workspace apps are registered as public clients with the `http://localhost` redirect, and workspace admin-consent links use the same redirect URI.
- Bootstrap now uses temporary app-registration and delegated-consent management scopes, removes those grants after provisioning, and records incomplete cleanup for `greybeard doctor` to flag.
- Write plans declare an exact `requiredScopes` set. Greybeard verifies the set before approval and reacquires the same scopes for execution, preventing an approval from running under a broader implicit Tier 1 request.
- Incremental scope requests now retain their reason in a local audit log, support optional expiry leases, and can be released through a guarded `remove-scope` tool. Scope release reports when tenant-side consent still needs administrator revocation.

### Reliability

- `greybeard update` now requires a clean tracked tree, pulls with fast-forward only, installs locked dependencies, builds, and tests before activating client configuration. Failed verification restores the previous revision and rebuilds its dependencies and runtime artifacts.
- Long-running MCP processes now reload the active authentication provider when Greybeard config revisions change. Completing setup no longer requires killing the stdio transport before the next tool call can use the workspace app.
- Existing workspace applications are repaired idempotently. Missing public-client settings, redirect URIs, permission declarations, or service principals are restored on setup.
- New application provisioning rolls back the application object if service-principal creation fails, while reruns can repair previously recorded workspace apps.

### Fixes

- The generic Graph tool now parses string-encoded `$batch` bodies before the read gate. Agents that serialize the batch body as a JSON string no longer have valid all-GET batches rejected with `E_WRITE_BLOCKED`, while inner writes and unparseable bodies remain blocked and the wire payload is encoded exactly once.
- Microsoft Graph delegated permission discovery now prefers `publishedPermissionScopes` and supports `oauth2PermissionScopes` as a compatibility fallback.
- Failed directory-role detection now returns `directoryRoles: null` plus diagnostic state. It no longer falsely reports that the signed-in admin has no roles.
- Microsoft Graph app-registration, service-principal, and OAuth grant setup calls now use explicit stable `v1.0` endpoints.

### Features

- MCP tools now declare output schemas and return `structuredContent`; JSON text remains available for older clients.
- Added the `entra-app-credentials` skill for app registrations, service principals, GitHub OIDC federation, secret-to-OIDC migration, staged rollback, and temporary bootstrap permission cleanup.
- Added `agents/openai.yaml` metadata for every Greybeard skill.

### Compatibility and upgrade notes

- `plan-write` callers must now supply a non-empty `requiredScopes` array containing delegated write scopes. Older clients or prompts that omit it receive `E_PLAN_INVALID` before approval.
- Directory-role consumers must handle `directoryRoles: null` and inspect `directoryRolesStatus` when role detection is unavailable.
- Skill versions moved from `SKILL.md` frontmatter and embedded changelogs to `.agents/skills/manifest.json`. Skill frontmatter now contains only `name` and `description`.
- After a successful local update, reload or reconnect MCP clients so newly launched server processes use the rebuilt runtime.
