---
name: license-optimizer
description: Use when the user asks about license waste, unused seats, duplicate licenses, downgrade candidates, SKU utilization, or Microsoft 365 cost optimization.
---

# License Optimizer

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Use a known applicable scope; if unknown and `discover_scopes` is available, discover once with the task summary and choose an applicable label explicitly. Do not read every scope or bypass the selected environment. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, quote its operative words, and explain its effect. Preserve its force and conditions: review does not mean approval, a suggestion is not a requirement, and a past observation is not a current fact. Generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a local memory candidate even after conversational agreement. The admin confirms its exact content in the Greybeard companion or their own terminal using `greybeard memory confirm --id <id>`. Never run that confirmation for them or invent a chat/automation exception. Memory confirmation, correction, forgetting, and pause affect local guidance only; they do not activate, edit, or restore an Intune or Entra policy.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

1. Call `get-auth-status` before any `graph` call.
2. If `signedIn` is false, tell the user to run `greybeard setup` and stop.
3. Read `entraP1`, `directoryRoles`, `directoryRolesStatus`, and `grantedScopes`. Treat `directoryRoles: null` as unknown. SKU utilization is not Entra P1 gated; stale-license candidates require P1, `AuditLog.Read.All`, and a reporting role.
4. Use SKU utilization first. Only inspect user license assignments when the user asks for candidates or waste detail.
5. Tier 2 scope for this skill is `LicenseAssignment.Read.All` when the server asks for it. `User.Read.All` and `Group.Read.All` support user and group assignment context.
6. If access is unavailable, report the exact endpoint and error. Ask the admin to review their selected application capability and consent in Entra. Greybeard 0.1 does not request or grant additional permissions.

## Report Shapes

### SKU Utilization

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/subscribedSkus",
  "query": {
    "$select": "skuId,skuPartNumber,prepaidUnits,consumedUnits,capabilityStatus"
  },
  "fetchAll": true,
  "maxItems": 1000
}
```

Compute:

- Enabled seats: `prepaidUnits.enabled`.
- Consumed seats: `consumedUnits`.
- Unused enabled seats: `prepaidUnits.enabled - consumedUnits`.
- Suspended, warning, and locked-out seats separately.

### User License Assignment Detail

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/users",
  "query": {
    "$select": "id,displayName,userPrincipalName,accountEnabled,userType,assignedLicenses,licenseAssignmentStates"
  },
  "fetchAll": true,
  "maxItems": 5000
}
```

Use `licenseAssignmentStates.assignedByGroup` to distinguish direct and group-based licensing when present. Treat direct duplicate-looking assignments as review candidates, not automatic savings.

### Stale Licensed User Candidates

Only run when P1, `AuditLog.Read.All`, and reporting role gates are satisfied.

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/users",
  "query": {
    "$select": "id,displayName,userPrincipalName,accountEnabled,userType,assignedLicenses,signInActivity",
    "$filter": "accountEnabled eq true"
  },
  "fetchAll": true,
  "maxItems": 5000
}
```

Flag enabled licensed users whose `signInActivity.lastSuccessfulSignInDateTime` is older than the requested threshold, defaulting to 90 days. Do not widen to `Directory.Read.All` for the known sign-in activity quirk.

## Output

Return:

- SKU utilization table.
- Top waste candidates with evidence.
- License gates or role gates that prevented deeper analysis.
- Savings estimate only as seat counts unless the user provides price data.
- No direct removals. License changes route through `change-plan`.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.

## Available access

The optional 0.1 connection exposes only its selected read capabilities. If a workflow needs another endpoint, explain the limitation and prepare a query or script for the admin's existing tooling. Do not escalate permissions or substitute a different credential.
