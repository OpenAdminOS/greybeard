---
name: license-optimizer
description: Use when the user asks about license waste, unused seats, duplicate licenses, downgrade candidates, SKU utilization, or Microsoft 365 cost optimization.
---

# License Optimizer

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

1. Call `get-auth-status` before any `graph` call.
2. If `signedIn` is false, tell the user to run `greybeard setup` and stop.
3. Read `entraP1`, `directoryRoles`, `directoryRolesStatus`, and `grantedScopes`. Treat `directoryRoles: null` as unknown. SKU utilization is not Entra P1 gated; stale-license candidates require P1, `AuditLog.Read.All`, and a reporting role.
4. Use SKU utilization first. Only inspect user license assignments when the user asks for candidates or waste detail.
5. Tier 2 scope for this skill is `LicenseAssignment.Read.All` when the server asks for it. `User.Read.All` and `Group.Read.All` support user and group assignment context.
6. On a missing-scope 403, call `add-scope` for the exact scope returned by the server. If `granted` is false, relay the returned consent URL and stop.

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
