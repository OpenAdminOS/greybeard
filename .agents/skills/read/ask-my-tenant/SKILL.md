---
name: ask-my-tenant
description: Use when the user poses a live tenant state question when no more specific Greybeard skill matches, including guest accounts, disabled accounts, or simple user and group counts.
version: 0.2.0
requires:
  servers: [greybeard-graph]
  scopes: [User.Read.All, Group.Read.All, Organization.Read.All]
---

# Ask My Tenant

Version: 0.2.0

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.

1. Call `get-auth-status` before any `graph` call.
2. If `signedIn` is false, tell the user to run `greybeard setup` and stop.
3. Read `entraP1`, `directoryRoles`, and `grantedScopes` before choosing a call. Warn up front if the question touches P1 or reporting-role gated data such as `signInActivity` or user registration reports.
4. Use this skill only when no specialist skill matches. Yield to Intune, Conditional Access, Entra hygiene, license, KQL, scope, Graph mechanics, script, and write-plan skills.
5. Resolve the question to one scoped beta `graph` call. Use `$select`. Use `$filter` whenever it reduces rows. Use `$count=true` with `ConsistencyLevel: eventual` for counts on directory collections.
6. If Graph returns a missing-scope 403, call `add-scope` for the exact missing scope with a one-line reason. If `granted` is false, relay the consent URL and stop.

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

## CHANGELOG

- 0.2.0: Moved into the read category and declared requirements in frontmatter.
- 0.1.1: Updated Graph examples and guidance to use beta by default.
- 0.1.0: Initial catch-all live tenant question workflow.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.
