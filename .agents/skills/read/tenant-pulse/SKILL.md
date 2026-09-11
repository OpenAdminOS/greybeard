---
name: tenant-pulse
description: Use when the user asks how healthy or secure the tenant is, says posture, risk, score, "how are we doing", or wants a scored Microsoft 365 tenant snapshot.
---

# Tenant Pulse

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, paraphrase the rule, and explain its effect. Preferences may be advice style or specific rollout rules; generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a candidate even after conversational agreement. Ask the admin to review and confirm it in local setup or `greybeard memory confirm --id <id>`. Never simulate that human confirmation or describe a candidate as confirmed.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

1. Call `get-auth-status` before any `graph` call.
2. If `signedIn` is false, tell the user to run `greybeard setup` and stop. Do not continue with guesses.
3. Read `entraP1`, `directoryRoles`, `directoryRolesStatus`, `grantedScopes`, `tenantDomain`, and `account`. Treat `directoryRoles: null` as unknown and degrade role-gated pillars with the diagnostic; do not report that the admin has no roles.
4. Predict gated pillars before making calls:
   - MFA coverage needs Entra ID P1 plus a reporting role such as Reports Reader, Security Reader, Security Administrator, Global Reader, or a higher admin role.
   - Stale accounts with `signInActivity` needs Entra ID P1, `AuditLog.Read.All`, and a reporting role.
   - Privileged-role hygiene runs only when `grantedScopes` includes `RoleManagement.Read.Directory`.
5. Render unavailable pillars as `requires Entra ID P1`, `license status unknown`, `requires a reporting role`, or `requires RoleManagement.Read.Directory`; exclude those pillars from the score denominator.

## Exact Graph Calls

Use beta for every call by default. Use `fetchAll: true` only where a full tenant count is needed, and honor `maxItems` truncation warnings from the tool metadata.

### MFA Coverage

Only run when `entraP1` is true and the role gate is satisfied. The endpoint supports `$filter`, not `$select`.

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/reports/authenticationMethods/userRegistrationDetails",
  "query": { "$filter": "isMfaRegistered eq true" },
  "fetchAll": true,
  "maxItems": 5000
}
```

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/reports/authenticationMethods/userRegistrationDetails",
  "query": { "$filter": "isMfaRegistered eq false" },
  "fetchAll": true,
  "maxItems": 5000
}
```

Score the pillar from registered divided by registered plus unregistered. Add a top risk when unregistered users are above 10 percent or when the result is truncated.

### Stale Accounts

Only run when `entraP1` is true, `AuditLog.Read.All` is granted, and the role gate is satisfied.

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/users",
  "query": {
    "$select": "id,displayName,userPrincipalName,accountEnabled,userType,signInActivity",
    "$filter": "accountEnabled eq true"
  },
  "fetchAll": true,
  "maxItems": 5000
}
```

Compute stale enabled accounts from `signInActivity.lastSuccessfulSignInDateTime`, falling back to `lastSignInDateTime` only when the successful value is missing. Use 90 days unless the user asked for a different threshold. Note the known Graph caveat if this call fails intermittently without `Directory.Read.All`; do not widen scopes.

### Conditional Access Gaps

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/identity/conditionalAccess/policies",
  "query": {
    "$select": "id,displayName,state,conditions,grantControls,sessionControls"
  },
  "fetchAll": true,
  "maxItems": 1000
}
```

Flag these gaps:

- No enabled policy with MFA in `grantControls.builtInControls` or a phishing-resistant authentication strength.
- Policies in `enabledForReportingButNotEnforced`.
- Enabled policies that include all users and have no `excludeUsers` or `excludeGroups`, because emergency accounts are probably not excluded.

### Unused Licenses

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

Compute unused seats as `prepaidUnits.enabled - consumedUnits`. Treat suspended or warning units separately from enabled units.

### Privileged-Role Hygiene

Only run when `grantedScopes` includes `RoleManagement.Read.Directory`.

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/roleManagement/directory/roleDefinitions",
  "query": {
    "$select": "id,displayName,isBuiltIn,isEnabled"
  },
  "fetchAll": true,
  "maxItems": 1000
}
```

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/roleManagement/directory/roleAssignments",
  "query": {
    "$select": "id,principalId,roleDefinitionId,directoryScopeId"
  },
  "fetchAll": true,
  "maxItems": 5000
}
```

Do not add `appScopeId` or `createdDateTime` to this `$select`. The service rejects both with a 400 on beta and v1.0 even though `appScopeId` appears in the resource docs.

Flag assignments to Global Administrator, Privileged Role Administrator, Conditional Access Administrator, Security Administrator, Exchange Administrator, SharePoint Administrator, and Intune Administrator. Call this a hygiene indicator, not a complete PIM review.

## Scoring

Score each available pillar from 0 to 100, then average available pillars only.

- MFA coverage: registered percentage.
- Stale accounts: `100 - staleEnabledPercentage`, floor at 0.
- Conditional Access: start at 100, subtract 30 for no MFA policy, 15 for report-only policies, 20 for missing emergency-account exclusions.
- Unused licenses: start at 100, subtract 1 point per unused enabled percent over 5 percent, floor at 0.
- Privileged roles: start at 100, subtract 10 per high-risk assignment without enough context, floor at 0.

## Output Template

Return copy-paste-ready markdown:

```markdown
# Tenant Pulse - <tenantDomain>

Run as: <account>
Score: <score>/100

## Top Risks
1. <risk, impact, next action>
2. <risk, impact, next action>
3. <risk, impact, next action>

## Pillars
| Pillar | Score | Result | Notes |
|---|---:|---|---|
| MFA coverage | <score or n/a> | <registered>/<total> registered | <or requires Entra ID P1 / requires a reporting role> |
| Stale accounts | <score or n/a> | <count> enabled users stale over <days> days | <or requires Entra ID P1 / AuditLog.Read.All / reporting role> |
| Conditional Access gaps | <score> | <summary> | <policy findings> |
| Unused licenses | <score> | <unused> enabled seats unused | <largest SKU gaps> |
| Privileged-role hygiene | <score or n/a> | <summary> | <or requires RoleManagement.Read.Directory> |

## Calls Made
<one line from graph meta: requests, pages, truncation, warnings>

## Token Discipline
Requests made: <n>. Scopes used: <granted scopes relevant to these calls>. Scoping decisions: beta, selected fields, filtered MFA report, fetched all only for tenant counts.
```

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.

## Available access

The optional 0.1 connection exposes only its selected read capabilities. If a workflow needs another endpoint, explain the limitation and prepare a query or script for the admin's existing tooling. Do not escalate permissions or substitute a different credential.
