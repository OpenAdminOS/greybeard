---
name: intune-assignments
description: Use when the user asks what Intune apps, policies, configuration profiles, devices, or groups are assigned, targeted, excluded, conflicting, or missing.
---

# Intune Assignments

## Workflow

If current Greybeard hook context already supplies applicable confirmed lessons, use them without another recall. Otherwise, before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Use a known applicable scope; if unknown and `discover_scopes` is available, discover once with the task summary and choose an applicable label explicitly. Do not read every scope or bypass the selected environment. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, quote its operative words, and explain its effect. Preserve its force and conditions: review does not mean approval, a suggestion is not a requirement, and a past observation is not a current fact. Generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a local memory candidate even after conversational agreement. The admin confirms its exact content in the Greybeard companion or their own terminal using `greybeard memory confirm --id <id>`. Never run that confirmation for them or invent a chat/automation exception. Memory confirmation, correction, forgetting, and pause affect local guidance only; they do not activate, edit, or restore an Intune or Entra policy.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; propose a candidate without waiting for a request to remember it. Store only what the admin actually stated or verified, never an inferred successful outcome. The candidate remains inactive until exact human confirmation.

1. Call `get-auth-status` before any `graph` call.
2. If `signedIn` is false, tell the user to run `greybeard setup` and stop.
3. Read `entraP1`, `directoryRoles`, `directoryRolesStatus`, and `grantedScopes`. Treat `directoryRoles: null` as unknown. Intune assignment reports are not Entra P1 gated, but Intune licensing and roles may still limit data.
4. Use the narrowest report shape below. Do not turn assignment questions into compliance or health audits.
5. Tier 2 scopes for this skill are `DeviceManagementConfiguration.Read.All`, `DeviceManagementApps.Read.All`, `DeviceManagementManagedDevices.Read.All`, and `Device.Read.All` only when Entra device objects must be resolved.
6. If access is unavailable, report the exact endpoint and error. Ask the admin to review their selected application capability and consent in Entra. Greybeard 0.1 does not request or grant additional permissions.

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

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.

## Available access

The optional 0.1 connection exposes only its selected read capabilities. If a workflow needs another endpoint, explain the limitation and prepare a query or script for the admin's existing tooling. Do not escalate permissions or substitute a different credential.

## Bounded tenant read recipes

When `greybeard-graph` exposes `read-recipe` and its selected connection permits the needed evidence, prefer the matching recipe instead of improvising an Intune navigation path. `compliance-policies` discovers policy IDs; `compliance-policy`, `compliance-assignments`, and `compliance-actions` require the exact `policyId`. `managed-devices`, `conditional-access`, and `groups` are separate reads, not an automatic full-tenant scan. Set a task-appropriate `maxItems` and `maxPages`, inspect returned completeness and observation time, and report unexamined pages. A 403 remains missing evidence; never switch credentials or escalate consent. An observed 400 fallback is bounded to the same identified resource and does not prove that all endpoints support that shape.
