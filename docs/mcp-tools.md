# MCP Tool Contracts

Components: greybeard-graph, greybeard-memory
Bundled third-party server: intuneautomation (see the end of this doc)
Status: Draft for implementation
Companion to: [greybeard-spec.md](../greybeard-spec.md), [write-gate.md](write-gate.md)

Design rule for both servers: few tools, tight schemas. Every tool a server exposes is context the client carries on every turn, so nothing gets a tool that a parameter can express.

## greybeard-graph

Six tools: `graph`, `plan-write`, `check-plan`, `execute-plan`, `get-auth-status`, `add-scope`.

### Credentials

Two possible credentials per tenant, selected per call, never by the model:

- **Read-only mode** (default after setup): all calls use the first-party Graph CLI app. Writes are impossible (`E_WRITES_NOT_CONFIGURED`).
- **Writes mode** (after `greybeard setup --writes`): the wizard creates a workspace app registration and consents the granted read scopes plus requested write scopes on it. From then on the server uses the workspace app for **all** calls in that tenant, read and write, so there is exactly one active credential per tenant at any time and no dual-token juggling. The first-party cache is kept but dormant.

Token caches are per app, OS-protected per the spec's Token cache section. MSAL partitions accounts by tenant inside the app cache; the active tenant selects the authority and account.

### `graph` (read-only generic Graph call)

Input:

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/users",
  "query": { "$select": "id,displayName,accountEnabled", "$filter": "accountEnabled eq false", "$count": "true" },
  "headers": { "ConsistencyLevel": "eventual" },
  "fetchAll": false,
  "maxItems": 1000
}
```

Behavior:

- `method`: GET, or POST only for `/$batch` with all-GET inner requests (see write-gate.md section 3.5). Anything else: `E_WRITE_BLOCKED`.
- `apiVersion`: `beta` (default) or `v1.0`. Greybeard defaults to beta for full surface coverage. A caller may pin `v1.0` for a specific call when stability matters. Result metadata includes both `apiVersion` and the retained `usedBeta` flag so the run report can surface the version used.
- `fetchAll`: follows `@odata.nextLink` until done or `maxItems` reached. `maxItems` default 1000, hard cap 5000; truncation is flagged in metadata, never silent.
- Throttling: honors `Retry-After` on 429/503, max 3 retries, then surfaces the error with the retry state.
- Error mapping distinguishes three failure classes and says which one it is: missing scope (403 with consent URL), **missing Entra ID P1 license** (e.g. `signInActivity`, `userRegistrationDetails`, `/auditLogs/signIns` on unlicensed tenants), and **missing directory role** (delegated reporting endpoints are role-gated: Reports Reader, Security Reader, Global Reader, or higher, regardless of scopes). The latter two are not consent problems and must not be answered with a consent URL.
- Token discipline nudges (metadata warnings, not errors): collection GET without `$select`; `fetchAll` without `$filter`. Explicit `v1.0` use is reported as an informational metadata note, not a warning.

Result:

```json
{
  "data": { "value": [ ... ] },
  "meta": {
    "requests": 3,
    "pages": 3,
    "truncated": false,
    "throttled": 0,
    "apiVersion": "beta",
    "usedBeta": true,
    "notes": [],
    "warnings": ["no $select on collection read: consider selecting only needed fields"]
  }
}
```

`meta` accumulates per session in server memory; skills reference it for the after-run discipline report (calls made, scopes used, scoping decisions).

### `plan-write`, `check-plan`, `execute-plan`

Contracts, lifecycle, tokens, approval channels, and error codes are specified normatively in [write-gate.md](write-gate.md). This document does not duplicate them. Summary: `plan-write` is non-blocking and returns a planId; `check-plan` long-polls the decision and delivers the single-use token exactly once; `execute-plan` replays the server-stored operations.

### `get-auth-status`

No input. Result:

```json
{
  "signedIn": true,
  "account": "ugur@contoso.com",
  "tenantId": "…",
  "tenantDomain": "contoso.com",
  "activeTenantAlias": "contoso",
  "credentialMode": "read-only",
  "clientId": "14d82eec-204b-4c2f-b7e8-296a70dab67e",
  "clientIdKind": "first-party",
  "grantedScopes": ["User.Read.All", "Group.Read.All", "Policy.Read.All", "Organization.Read.All", "AuditLog.Read.All", "Reports.Read.All"],
  "entraP1": true,
  "directoryRoles": ["Global Reader"],
  "cacheProtection": "keychain",
  "gate": { "pendingPlan": null, "writesConfigured": false }
}
```

In writes mode, `credentialMode` is `"writes"`, `clientId`/`clientIdKind` describe the workspace app, and `gate.writesConfigured` is true. `entraP1` is `true`, `false`, or `null`; `null` means the probe could not determine license state, while `false` means the probe succeeded and found no Entra P1 license. `entraP1` and `directoryRoles` exist so skills can predict license/role-gated failures (tenant-pulse pillar degradation) instead of discovering them per call.

When not signed in, the result says so and includes the literal instruction to run `greybeard setup`; [L] skills relay it instead of failing silently.

### `add-scope`

Input: `{ "scopes": ["Device.Read.All"], "reason": "stale device report" }`

Behavior:

- Deduplicates against granted scopes; no-ops report as already granted.
- **Write scopes require writes mode.** In read-only mode a write scope request returns `E_WRITES_NOT_CONFIGURED` with a pointer to `greybeard setup --writes`; the first-party app never receives write consent.
- Attempts interactive incremental consent (browser) on the active credential.
- If admin consent is required and the signed-in user cannot grant it, returns `consentUrl` (tenant admin-consent URL for the exact scope set) plus one-line justifications per scope for handoff, and `granted: false`.
- Result always echoes the post-attempt `grantedScopes`.

Tenant switching is not a tool. The active tenant is set by `greybeard tenant use <domain>` in the CLI and read by the server from config at call time; `get-auth-status` reports it. Keeping tenant switching out of the model's reach means a prompt can never silently retarget an MSP's other customer.

## greybeard-memory

Four tools: `recall`, `remember`, `list`, `forget`. Tenant is never a tool parameter; the server resolves the active tenant from the same config the graph server uses, so memory cannot be cross-tenant queried by a prompt.

### Storage

One SQLite DB (better-sqlite3, WAL mode) at `<appdata>/greybeard/memory.db`, shared by all clients.

```sql
CREATE TABLE nodes (
  id           INTEGER PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('query','preference','script','fact','scope')),
  content      TEXT NOT NULL,
  embedding    BLOB,              -- reserved for v1.1 vectors; NULL in v1
  tenant       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,  -- unix epoch
  last_used_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE nodes_fts USING fts5(
  content, content='nodes', content_rowid='id', tokenize='porter'
);

CREATE TABLE edges (
  source   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('used','depends_on','needs','prefers')),
  weight   REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (source, target, relation)
);
```

Sync triggers keep `nodes_fts` consistent with `nodes` on insert/update/delete.

### `recall`

Input: `{ "query": "compliance report table choice", "limit": 5 }`

Behavior:

- FTS5 match ranked by bm25, filtered to the active tenant.
- Rank adjustments: `preference` nodes boosted above other types; recency boost on `last_used_at`.
- Each hit expands one hop over `edges`, so a matched query node brings its linked preference or script along.
- Matched nodes get `last_used_at` refreshed (this is what keeps useful nodes alive through eviction).
- Empty result returns an explicit "no memory for this yet", so agents do not retry with paraphrases.

### `remember`

Input:

```json
{
  "type": "preference",
  "content": "For Intune compliance reports, use the DeviceComplianceOrg table, not DeviceComplianceTrend.",
  "links": [ { "target": 42, "relation": "prefers" } ]
}
```

Behavior:

- Privacy rule enforced at the door: the server rejects content matching tenant-output shapes (GUID lists, UPN lists, JSON payloads over a size threshold) with a message telling the agent to store the intent, not the data.
- Supersede-not-duplicate: for `preference`, the server FTS-searches existing same-tenant preferences; on strong overlap it updates that node's content in place (same id, edges preserved) instead of inserting. The result says which happened.
- Eviction on write (spec: Memory eviction): soft cap ~2000 nodes per tenant, usage-weighted LRU, `preference` sticky while referenced, `query` nodes 90-day soft TTL.

### `list` / `forget`

- `list`: `{ "type": "preference", "limit": 50 }`, active tenant, newest first. Mirrors `greybeard memory list`.
- `forget`: `{ "id": 42 }` or `{ "olderThanDays": 90, "type": "query" }`. Deletes cascade over edges. Mirrors `greybeard memory forget`.

### Skill contract (retrieval reality)

- Every Greybeard skill opens with: call `recall` with a one-line task summary before other work; call `remember` when the admin corrects, chooses, or confirms something.
- Claude Code can install an opt-in `UserPromptSubmit` recall nudge with `greybeard setup --memory-hook`. Codex/Gemini/Cursor are best-effort by instruction; the README says so.

## Server catalog and optional servers

All servers Greybeard wires into clients are declared in `cli/src/serverCatalog.ts`. The two Greybeard servers are `required: true` and always configured. Everything else is optional: enabled or disabled per user with setup flags, persisted in `config.json` under `mcpServers`, and honored by `greybeard setup`, `greybeard update`, and `greybeard doctor`.

- `greybeard setup --disable-server <name>` removes the server from every client config and remembers the choice.
- `greybeard setup --enable-server <name>` turns it back on.
- Adding a new optional server means adding one catalog entry (name, description, npm package, `defaultEnabled`); the writers, inspectors, and doctor pick it up automatically.
- Doctor treats a client as configured only when every enabled server is present.

### intuneautomation (bundled third-party server, optional, on by default)

Not part of this repo. `greybeard setup` wires [`@ugurkocde/intuneautomation-mcp`](https://www.npmjs.com/package/@ugurkocde/intuneautomation-mcp) into every detected client alongside the two Greybeard servers. It exposes search and retrieval over the IntuneAutomation PowerShell script library.

- Always runs from npm via `npx -y @ugurkocde/intuneautomation-mcp@latest`, regardless of `serverPackageSource`, because there is no local build for it in this repo. The `pinned` server update mode does not apply to it.
- Needs no credentials or environment variables; it serves script content, not tenant data. Graph calls stay in greybeard-graph.
- Disable with `greybeard setup --disable-server intuneautomation`.
