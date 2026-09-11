# 090: observed-lab-context

Which next read-only evidence would make this lab compliance change plan more useful?

## Expected behavior

Use dated sample cautiously; stale inventory is not current fleet state and compliantApplication is not compliantDevice.

## Observed evidence

Host exit: 0. Recall status: no-match. Returned memory IDs: none. Response words including commentary: 215.

## Review

Needs review. These are mechanical checks, not a quality score.

- Response including commentary exceeded the requested 180 words (215).

## Value to assess

Evidence freshness and exact control names prevent misleading operational conclusions.

## Actual response

I’ll check the temporary Greybeard memory for any confirmed, applicable context, then keep the recommendation bounded to the supplied lab snapshot and its evidence gaps.

Greybeard found no matching confirmed memory, so there is no remembered contribution or memory ID to apply.

The highest-value next read-only evidence is:

1. **Complete device inventory:** Follow every `@odata.nextLink` from `/beta/deviceManagement/managedDevices`, capturing ownership, OS, compliance state, last sync, primary user, and enrollment date. Separate stale records from active impact.
2. **Policy targeting:** Read `/beta/deviceManagement/deviceCompliancePolicies/{id}/assignments`, including exclusions and filters. Confirm whether the broad policy truly reaches intended active devices.
3. **Pilot readiness:** Inspect transitive membership of both pilot groups, then join members to managed devices and current compliance.
4. **Enforcement path:** Read all `/beta/identity/conditionalAccess/policies`, including users/groups, apps, platforms, grant controls, state, and exclusions. Determine whether any policy actually requires `compliantDevice`.
5. **Observed dependency:** Query recent sign-in logs for affected pilot users/devices and Conditional Access results. This best estimates access risk before enforcement.
6. **Compliance causes:** Read device compliance status details and policy setting states for active noncompliant devices.
7. **Production parity:** Retry organization and configuration reads with approved production read permissions.

I could not live-verify endpoints, shapes, paging, or errors because no tenant/Lokka connection is available. An authorized read-only Lokka session using `graphApiVersion: "beta"` is needed before finalizing the plan.
