---
name: conditional-access-review
description: Use when the user asks to review existing Conditional Access, audit CA policies, find report-only policies, find enabled policies that lack MFA enforcement, or verify emergency-account exclusions.
---

# Conditional Access Review

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a candidate even after conversational agreement. Ask the admin to review and confirm it in local setup or `greybeard memory confirm --id <id>`. Never simulate that human confirmation or describe a candidate as confirmed.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

1. Call `get-auth-status` before any `graph` call.
2. If `signedIn` is false, tell the user to run `greybeard setup` and stop.
3. Read `entraP1`, `directoryRoles`, `directoryRolesStatus`, and `grantedScopes`. Treat `directoryRoles: null` as unknown. Existing CA policy review is not Entra P1 gated through Graph, but tenant licensing terms still apply.
4. Use live state only. Do not design new CA policies here; route design and writes through `change-plan`.
5. Tier 2 scope for this skill is `Application.Read.All` when application IDs in policies need display-name resolution. `Policy.Read.All` is the core read scope.
6. If access is unavailable, report the exact endpoint and error. Ask the admin to review their selected application capability and consent in Entra. Greybeard 0.1 does not request or grant additional permissions.
7. Treat MFA wording precisely: this skill checks whether Conditional Access policies enforce MFA. It does not report user MFA registration coverage. If the user asks for MFA coverage or registration status, use `tenant-pulse` instead.

## Report Shapes

### CA Inventory and Gap Review

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/identity/conditionalAccess/policies",
  "query": {
    "$select": "id,displayName,state,createdDateTime,modifiedDateTime,conditions,grantControls,sessionControls"
  },
  "fetchAll": true,
  "maxItems": 1000
}
```

Flag:

- No enabled policy that enforces MFA through `grantControls.builtInControls` or authentication strength.
- Policies in `enabledForReportingButNotEnforced`.
- Policies that include all users and have no user or group exclusions for emergency accounts.
- Disabled policies that look production-critical by name.
- Policies targeting all cloud apps without clear exclusions.

### Report-Only Policies

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/identity/conditionalAccess/policies",
  "query": {
    "$select": "id,displayName,state,modifiedDateTime,conditions,grantControls",
    "$filter": "state eq 'enabledForReportingButNotEnforced'"
  },
  "fetchAll": true,
  "maxItems": 1000
}
```

### Resolve Target Application Names

If access is unavailable, report the exact endpoint and error. Ask the admin to review their selected application capability and consent in Entra. Greybeard 0.1 does not request or grant additional permissions.

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/servicePrincipals",
  "query": {
    "$select": "id,appId,displayName",
    "$filter": "appId eq '<app-id-from-ca-policy>'"
  },
  "fetchAll": false,
  "maxItems": 5
}
```

## Output

Return:

- CA posture summary.
- Gap table with policy name, state, finding, evidence, and recommended review.
- "No writes performed" line.
- If the admin asks to fix a policy, hand off to `change-plan` with a proposed operation list.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.

## Available access

The optional 0.1 connection exposes only its selected read capabilities. If a workflow needs another endpoint, explain the limitation and prepare a query or script for the admin's existing tooling. Do not escalate permissions or substitute a different credential.
