---
name: conditional-access-review
description: Use when the user asks to review existing Conditional Access, audit CA policies, find report-only policies, find enabled policies that lack MFA enforcement, or verify emergency-account exclusions.
---

# Conditional Access Review

## Workflow

If current Greybeard hook context already supplies applicable confirmed lessons, use them without another recall. Otherwise, before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Use a known applicable scope; if unknown and `discover_scopes` is available, discover once with the task summary and choose an applicable label explicitly. Do not read every scope or bypass the selected environment. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, quote its operative words, and explain its effect. Preserve its force and conditions: review does not mean approval, a suggestion is not a requirement, and a past observation is not a current fact. Generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a local memory candidate even after conversational agreement. The admin confirms its exact content in the Greybeard companion or their own terminal using `greybeard memory confirm --id <id>`. Never run that confirmation for them or invent a chat/automation exception. Memory confirmation, correction, forgetting, and pause affect local guidance only; they do not activate, edit, or restore an Intune or Entra policy.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; propose a candidate without waiting for a request to remember it. Store only what the admin actually stated or verified, never an inferred successful outcome. The candidate remains inactive until exact human confirmation.

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
