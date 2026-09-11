---
name: entra-identity
description: Use when the user asks about Entra users, groups, memberships, dynamic rules, orphaned groups, naming hygiene, cleanup candidates, or identity inventory.
---

# Entra Identity

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, paraphrase the rule, and explain its effect. Preferences may be advice style or specific rollout rules; generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a candidate even after conversational agreement. Ask the admin to review and confirm it in local setup or `greybeard memory confirm --id <id>`. Never simulate that human confirmation or describe a candidate as confirmed.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

1. Call `get-auth-status` before any `graph` call.
2. If `signedIn` is false, tell the user to run `greybeard setup` and stop.
3. Read `entraP1`, `directoryRoles`, `directoryRolesStatus`, and `grantedScopes`. Treat `directoryRoles: null` as unknown. Warn up front when the request needs P1 data or a role-gated report.
4. Use the narrowest report shape below. Do not review Conditional Access, licensing, or Intune compliance here.
5. Tier 2 scopes for this skill are `Application.Read.All` for app or service principal resolution and `RoleManagement.Read.Directory` for directory role assignments. Core user and group work uses Tier 1 `User.Read.All` and `Group.Read.All`.
6. If access is unavailable, report the exact endpoint and error. Ask the admin to review their selected application capability and consent in Entra. Greybeard 0.1 does not request or grant additional permissions.

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

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.

## Available access

The optional 0.1 connection exposes only its selected read capabilities. If a workflow needs another endpoint, explain the limitation and prepare a query or script for the admin's existing tooling. Do not escalate permissions or substitute a different credential.
