---
name: intune-compliance
description: Use when the user asks why Intune devices are noncompliant, failing compliance, blocked, in grace period, or need compliance policy triage.
version: 0.2.0
requires:
  servers: [greybeard-graph]
  scopes: [DeviceManagementManagedDevices.Read.All, DeviceManagementConfiguration.Read.All]
---

# Intune Compliance

Version: 0.2.0

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.

1. Call `get-auth-status` before any `graph` call.
2. If `signedIn` is false, tell the user to run `greybeard setup` and stop.
3. Read `entraP1`, `directoryRoles`, and `grantedScopes`. Intune compliance reports are not Entra P1 gated, but the tenant needs an active Intune license and delegated Intune roles may still limit data.
4. Use Graph for policy and managed-device state. If the user wants Log Analytics or historical trend KQL, hand off to `kql-authoring`.
5. Tier 2 scopes for this skill are `DeviceManagementConfiguration.Read.All` and `DeviceManagementManagedDevices.Read.All`.
6. On a missing-scope 403, call `add-scope` for the exact scope returned by the server. If `granted` is false, relay the returned consent URL and stop.

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

## CHANGELOG

- 0.2.0: Moved into the read category and declared requirements in frontmatter.
- 0.1.2: Removed $select from deviceStatuses; the Intune service returns a 500 for any $select on that endpoint. Verified live via Lokka.
- 0.1.1: Updated Graph examples to use beta by default.
- 0.1.0: Initial Intune compliance triage skill.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.
