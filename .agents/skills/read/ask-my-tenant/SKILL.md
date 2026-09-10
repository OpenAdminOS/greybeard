---
name: ask-my-tenant
description: Use when the user poses a live tenant state question when no more specific Greybeard skill matches, including guest accounts, disabled accounts, or simple user and group counts.
---

# Ask My Tenant

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a candidate even after conversational agreement. Ask the admin to review and confirm it in local setup or `greybeard memory confirm --id <id>`. Never simulate that human confirmation or describe a candidate as confirmed.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

1. Call `get-auth-status` before any `graph` call.
2. If `signedIn` is false, tell the user to run `greybeard setup` and stop.
3. Read `entraP1`, `directoryRoles`, `directoryRolesStatus`, and `grantedScopes` before choosing a call. Treat `directoryRoles: null` as unknown, not as no roles. Warn up front if the question touches P1 or reporting-role gated data.
4. Use this skill only when no specialist skill matches. Yield to Intune, Conditional Access, Entra hygiene, license, KQL, scope, Graph mechanics, script, and write-plan skills.
5. Resolve the question to one scoped beta `graph` call. Use `$select`. Use `$filter` whenever it reduces rows. Use `$count=true` with `ConsistencyLevel: eventual` for counts on directory collections.
6. If access is unavailable, report the exact endpoint and error. Ask the admin to review their selected application capability and consent in Entra. Greybeard 0.1 does not request or grant additional permissions.

## Call Discipline

The answer must use exactly one `graph` call unless the user explicitly asks a follow-up that needs another call. Do not broaden into an audit. Do not fetch whole users or groups without `$select`.

Examples that belong here:

```json
{
  "question": "List guest accounts created this month.",
  "graph": {
    "method": "GET",
    "apiVersion": "beta",
    "path": "/users",
    "query": {
      "$select": "id,displayName,userPrincipalName,userType,createdDateTime,externalUserState",
      "$filter": "userType eq 'Guest' and createdDateTime ge <first-day-of-current-month>T00:00:00Z"
    },
    "fetchAll": true,
    "maxItems": 1000
  }
}
```

```json
{
  "question": "Show users without a manager.",
  "graph": {
    "method": "GET",
    "apiVersion": "beta",
    "path": "/users",
    "query": {
      "$select": "id,displayName,userPrincipalName,accountEnabled",
      "$expand": "manager($select=id,displayName,userPrincipalName)"
    },
    "fetchAll": true,
    "maxItems": 1000
  }
}
```

```json
{
  "question": "How many disabled accounts do we have?",
  "graph": {
    "method": "GET",
    "apiVersion": "beta",
    "path": "/users",
    "headers": { "ConsistencyLevel": "eventual" },
    "query": {
      "$select": "id,displayName,userPrincipalName,accountEnabled",
      "$filter": "accountEnabled eq false",
      "$count": "true"
    },
    "fetchAll": false,
    "maxItems": 25
  }
}
```

For "users without manager", the single call retrieves a selected manager expansion and the agent filters rows where `manager` is missing. State that Graph did not server-filter manager absence.

## Ticket-Ready Answer

Return this shape:

```markdown
## Answer
<direct result in one or two sentences>

## Evidence
| Field | Value |
|---|---|
| Query | `GET /beta/<path>?<scoped query>` |
| Rows considered | <count or "first page only"> |
| Time window | <if any> |

## Details
<small table or bullet list with only the selected fields>

## Discipline
Requests made: <n>. Scopes used: <relevant granted scopes>. Scoping decisions: beta, `$select` fields, `$filter` used, `$count` and `ConsistencyLevel eventual` used when applicable.
```

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.

## Available access

The optional 0.1 connection exposes only its selected read capabilities. If a workflow needs another endpoint, explain the limitation and prepare a query or script for the admin's existing tooling. Do not escalate permissions or substitute a different credential.
