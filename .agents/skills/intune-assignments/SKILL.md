---
name: intune-assignments
description: Use when the user asks what Intune apps, policies, configuration profiles, devices, or groups are assigned, targeted, excluded, conflicting, or missing.
version: 0.1.0
---

# Intune Assignments

Version: 0.1.0

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.

1. Call `get-auth-status` before any `graph` call.
2. If `signedIn` is false, tell the user to run `greybeard setup` and stop.
3. Read `entraP1`, `directoryRoles`, and `grantedScopes`. Intune assignment reports are not Entra P1 gated, but the tenant needs an active Intune license and delegated Intune roles may still limit data.
4. Use the narrowest report shape below. Do not turn assignment questions into compliance or health audits.
5. Tier 2 scopes for this skill are `DeviceManagementConfiguration.Read.All`, `DeviceManagementApps.Read.All`, `DeviceManagementManagedDevices.Read.All`, and `Device.Read.All` only when Entra device objects must be resolved.
6. On a missing-scope 403, call `add-scope` for the exact scope returned by the server. If `granted` is false, relay the returned consent URL and stop.

## Report Shapes

### Mobile App Assignment Map

Use when the user asks what an Intune app is assigned to.

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/deviceAppManagement/mobileApps",
  "query": {
    "$select": "id,displayName,publisher,isAssigned,lastModifiedDateTime"
  },
  "fetchAll": true,
  "maxItems": 1000
}
```

For each matching app:

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/deviceAppManagement/mobileApps/{mobileAppId}/assignments",
  "query": {
    "$select": "id,intent,target,settings"
  },
  "fetchAll": true,
  "maxItems": 1000
}
```

### Device Configuration Assignment Map

Use when the user asks what configuration profiles target a group or device.

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/deviceManagement/deviceConfigurations",
  "query": {
    "$select": "id,displayName,lastModifiedDateTime,version"
  },
  "fetchAll": true,
  "maxItems": 1000
}
```

For each candidate profile:

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/deviceManagement/deviceConfigurations/{deviceConfigurationId}/assignments",
  "query": {
    "$select": "id,target"
  },
  "fetchAll": true,
  "maxItems": 1000
}
```

### Device Targeting Context

Use when the user asks why a device is or is not targeted. This shows Intune identity context, not compliance root cause.

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/deviceManagement/managedDevices",
  "query": {
    "$select": "id,deviceName,userPrincipalName,azureADDeviceId,operatingSystem,complianceState,managementAgent,lastSyncDateTime",
    "$filter": "deviceName eq '<device-name>'"
  },
  "fetchAll": false,
  "maxItems": 25
}
```

Resolve group IDs only when needed:

```json
{
  "method": "GET",
  "apiVersion": "beta",
  "path": "/groups/{groupId}",
  "query": {
    "$select": "id,displayName,groupTypes,mailEnabled,securityEnabled"
  },
  "fetchAll": false,
  "maxItems": 1
}
```

## Output

Return a table with assignment source, intent, include or exclude target, resolved target name when available, and confidence. Call out conflicts where the same object is both included and excluded or receives incompatible intents.

## CHANGELOG

- 0.1.1: Updated Graph examples to use beta by default.
- 0.1.0: Initial Intune assignment reporting skill.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.
