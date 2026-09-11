# Read-only environment observations

Observed 11 September 2026 through Lokka Microsoft MCP. All 19 Graph requests explicitly used beta and GET. Two authentication checks and two guardrail inspections preceded them. Raw evidence is retained only in the local private review folder; this document omits tenant, object, and user identifiers.

## What was actually inspected

The lab identity was verified through organization read. The separate production connection identifies a different tenant and permits an application sample, but organization read returned HTTP 403 `Authorization_RequestDenied`. This is an access boundary, not an empty production tenant. A production-wide review would require a connection with the selected read capabilities; no permissions or credentials were changed.

| Observation | Evidence and limit | How a useful mentor changes the answer |
| --- | --- | --- |
| Multiple possible compliance targets | Six policy records returned without nextLink: five Windows and one macOS. | Resolve the exact policy instead of treating “the Windows policy” as unique. |
| Existing broad targeting | One Windows policy has both all-licensed-users and all-devices assignments, no filters. The other four Windows policies returned empty assignment collections. | Distinguish changing an already broad policy from staging an unassigned policy. Do not assume creating a pilot group limits an existing broad assignment. |
| Old inventory | Nine managed-device records returned without nextLink. Four Windows records are company-owned and noncompliant; all four last synchronized over 180 days before this observation. The newest Windows sync is in February 2026. | Ask for fresh pilot evaluation evidence. These records do not prove the present active fleet is failing a proposed change. |
| Mixed Mac ownership | Five Mac records: four personal, one company-owned; four noncompliant, one in grace period. | Keep ownership and platform distinctions visible when the admin says “all devices.” No user or device names were fetched. |
| No observed enforced compliant-device CA policy | The returned CA collection contains one report-only policy with `compliantApplication`, not `compliantDevice`; no nextLink. | Explain a possible dependency without asserting that this lab currently has that enforced dependency. This is a snapshot of this returned collection, not a proof that no other access restrictions exist. |
| No configured delay in the inspected action | The selected Windows policy's expanded scheduled action has `actionType: block` and `gracePeriodHours: 0`. | Flag the configured action for review. Do not translate this alone into a claim that every resource access attempt is immediately blocked. |
| Pilot names are not pilot readiness | A bounded group-name search returned two pilot-named groups. Membership and representativeness were not inspected. | Ask for intended group, members, exclusions, and success criteria; do not certify the pilot from its name. |

## API behavior reproduced live

- Managed-device reads with `$top=2` returned two records, `@odata.count: 2`, and an `@odata.nextLink`. Following that exact link returned another two records and another link. The separate `$top=20` request returned all nine records without a link. In this observed response, neither the count of two nor Lokka's `partial: false` means the whole collection was returned.
- Selecting Windows subtype fields, including `passwordRequired`, on the base compliance-policy path returned HTTP 400 `BadRequest`. Adding a subtype cast path also returned HTTP 400 (route mismatch). Reading the single identified policy without that select succeeded and returned the Windows object directly. Do not assume every documented field can be selected on the base resource.
- Direct GET of the selected policy's `scheduledActionsForRule` returned HTTP 400 (route mismatch). Expanding `scheduledActionsForRule($expand=scheduledActionConfigurations)` on the parent policy succeeded. Do not replace a failed read with a similarly named write action.
- Production organization read returned HTTP 403. A selected one-record application read succeeded and included nextLink; no production-wide inventory claim is made.

These are observations of the current endpoints and tenant, not promises about all Microsoft Graph deployments. Microsoft's [policy resource reference](https://learn.microsoft.com/en-us/graph/api/resources/intune-deviceconfig-devicecompliancepolicy?view=graph-rest-beta) and [Windows policy GET reference](https://learn.microsoft.com/en-us/graph/api/intune-deviceconfig-windows10compliancepolicy-get?view=graph-rest-beta) are supplemental; the live results establish the behavior above.

## Access and learning boundaries

The lab token reported directory, managed-device, configuration, and Conditional Access read roles among broader granted roles. The production token reported application read plus application/role-assignment write roles. All probes stayed read-only. A token listing multiple grants does not establish which individual grant authorized a request, so least-privilege access has not been certified by this run.

No tenant mutation, automatic consent, production rollout, or administrator-memory confirmation occurred. The evaluation uses anonymized snapshots and synthetic confirmed memories in isolated test databases. Tenant observations do not establish why an admin made a configuration decision. Possible learning candidates such as “refresh pilot check-in evidence before interpreting compliance” remain proposals for human review, not silently confirmed facts about the admin's preferences.
