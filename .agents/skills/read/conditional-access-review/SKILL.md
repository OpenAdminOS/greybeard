---
name: conditional-access-review
description: Use when the user asks to review existing Conditional Access, audit CA policies, find report-only policies, find enabled policies that lack MFA enforcement, or verify emergency-account exclusions.
version: 0.2.0
requires:
  servers: [greybeard-graph]
  scopes: [Policy.Read.All]
---

# Conditional Access Review

Version: 0.2.0

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.

1. Call `get-auth-status` before any `graph` call.
2. If `signedIn` is false, tell the user to run `greybeard setup` and stop.
3. Read `entraP1`, `directoryRoles`, and `grantedScopes`. Existing CA policy review is not Entra P1 gated through Graph, but the tenant licensing terms for CA still apply outside the API.
4. Use live state only. Do not design new CA policies here; route design and writes through `change-plan`.
5. Tier 2 scope for this skill is `Application.Read.All` when application IDs in policies need display-name resolution. `Policy.Read.All` is the core read scope.
6. On a missing-scope 403, call `add-scope` for the exact scope returned by the server. If `granted` is false, relay the returned consent URL and stop.
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

Use only if `Application.Read.All` is granted or after a successful `add-scope`.

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

## CHANGELOG

- 0.2.0: Moved into the read category and declared requirements in frontmatter.
- 0.1.1: Updated Graph examples to use beta by default.
- 0.1.0: Initial Conditional Access live review skill.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.
