---
name: intune-compliance
description: Use when the user asks why Intune devices are noncompliant, failing compliance, blocked, in grace period, or need compliance policy triage.
---

# Intune Compliance

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, paraphrase the rule, and explain its effect. Preferences may be advice style or specific rollout rules; generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a candidate even after conversational agreement. Ask the admin to review and confirm it in local setup or `greybeard memory confirm --id <id>`. Never simulate that human confirmation or describe a candidate as confirmed.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

1. Call `get-auth-status` before any `graph` call.
2. If `signedIn` is false, tell the user to run `greybeard setup` and stop.
3. Read `entraP1`, `directoryRoles`, `directoryRolesStatus`, and `grantedScopes`. Treat `directoryRoles: null` as unknown. Intune compliance reports are not Entra P1 gated, but Intune licensing and roles may still limit data.
4. Use Graph for policy and managed-device state. If the user wants Log Analytics or historical trend KQL, hand off to `kql-authoring`.
5. Tier 2 scopes for this skill are `DeviceManagementConfiguration.Read.All` and `DeviceManagementManagedDevices.Read.All`.
6. If access is unavailable, report the exact endpoint and error. Ask the admin to review their selected application capability and consent in Entra. Greybeard 0.1 does not request or grant additional permissions.

## Report Shapes

### Compliance Policy Overview

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/deviceManagement/deviceCompliancePolicies",
  "query": {
    "$select": "id,displayName,createdDateTime,lastModifiedDateTime,version"
  },
  "fetchAll": true,
  "maxItems": 1000
}
```

For each selected policy:

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/deviceManagement/deviceCompliancePolicies/{deviceCompliancePolicyId}/deviceStatusOverview",
  "query": {
    "$select": "pendingCount,notApplicableCount,successCount,errorCount,failedCount,lastUpdateDateTime,configurationVersion"
  },
  "fetchAll": false,
  "maxItems": 1
}
```

### Noncompliant Device List

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/deviceManagement/managedDevices",
  "query": {
    "$select": "id,deviceName,userPrincipalName,operatingSystem,osVersion,complianceState,lastSyncDateTime,managementAgent",
    "$filter": "complianceState eq 'noncompliant'"
  },
  "fetchAll": true,
  "maxItems": 5000
}
```

### Device Statuses for One Policy

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/deviceManagement/deviceCompliancePolicies/{deviceCompliancePolicyId}/deviceStatuses",
  "fetchAll": true,
  "maxItems": 5000
}
```

Do not use `$select` on `deviceStatuses`; the Intune service returns a 500 for any `$select` here. Fetch full rows and keep only `id`, `deviceDisplayName`, `userName`, `userPrincipalName`, `status`, and `lastReportedDateTime` in the report.

## Output

Return:

- Summary of affected devices and policies.
- Likely reason buckets: failed, error, in grace period, pending, not applicable.
- Device table with selected fields only.
- Fix guidance that separates admin action from user action.
- A note when Graph state is current-state only and KQL is needed for history.

Do not propose changing compliance policies directly. If the user asks for changes, route to `change-plan`.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.

## Available access

The optional 0.1 connection exposes only its selected read capabilities. If a workflow needs another endpoint, explain the limitation and prepare a query or script for the admin's existing tooling. Do not escalate permissions or substitute a different credential.
