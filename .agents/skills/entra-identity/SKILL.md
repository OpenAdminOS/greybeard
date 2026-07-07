---
name: entra-identity
description: Use when the user asks about Entra users, groups, memberships, dynamic rules, orphaned groups, naming hygiene, cleanup candidates, or identity inventory.
version: 0.1.0
---

# Entra Identity

Version: 0.1.0

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.

1. Call `get-auth-status` before any `graph` call.
2. If `signedIn` is false, tell the user to run `greybeard setup` and stop.
3. Read `entraP1`, `directoryRoles`, and `grantedScopes`. Warn up front when the request needs P1 data such as `signInActivity` or a role-gated report.
4. Use the narrowest report shape below. Do not review Conditional Access, licensing, or Intune compliance here.
5. Tier 2 scopes for this skill are `Application.Read.All` for app or service principal resolution and `RoleManagement.Read.Directory` for directory role assignments. Core user and group work uses Tier 1 `User.Read.All` and `Group.Read.All`.
6. On a missing-scope 403, call `add-scope` for the exact scope returned by the server. If `granted` is false, relay the returned consent URL and stop.

## Report Shapes

### Disabled Account Inventory

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/users",
  "headers": { "ConsistencyLevel": "eventual" },
  "query": {
    "$select": "id,displayName,userPrincipalName,accountEnabled,userType,createdDateTime",
    "$filter": "accountEnabled eq false",
    "$count": "true"
  },
  "fetchAll": true,
  "maxItems": 5000
}
```

### Dynamic Group Rules

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/groups",
  "headers": { "ConsistencyLevel": "eventual" },
  "query": {
    "$select": "id,displayName,groupTypes,membershipRule,membershipRuleProcessingState,mailEnabled,securityEnabled",
    "$filter": "groupTypes/any(c:c eq 'DynamicMembership')",
    "$count": "true"
  },
  "fetchAll": true,
  "maxItems": 5000
}
```

### Ownerless Group Candidates

First list candidate groups:

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/groups",
  "query": {
    "$select": "id,displayName,groupTypes,mailEnabled,securityEnabled,createdDateTime"
  },
  "fetchAll": true,
  "maxItems": 5000
}
```

Then use all-GET `$batch` fanout in chunks of 20:

```json
{
  "method": "POST",
  "apiVersion": "beta",
  "path": "/$batch",
  "body": {
    "requests": [
      {
        "id": "0",
        "method": "GET",
        "url": "/groups/{groupId}/owners?$select=id,displayName,userPrincipalName"
      }
    ]
  }
}
```

Groups with zero returned owners are candidates, not automatic deletion targets.

## Output

Return a table with object ID, display name, type, why it is flagged, evidence, and suggested next review step. For cleanup candidates, say what to verify before a change plan.

## CHANGELOG

- 0.1.1: Updated Graph examples to use beta by default.
- 0.1.0: Initial Entra identity hygiene skill.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.
