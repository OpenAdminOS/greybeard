I’ll check Greybeard for the remembered rollout convention, then frame the plan without claiming any live tenant evidence.

Greybeard memory **ID 1** confirms your rollout convention: hold a Windows compliance pilot for **48 hours**, then require **helpdesk review before expansion**. That changes “all devices” into a staged rollout whose final scope is all eligible Windows devices.

Plan:

1. Define the compliance changes, supported Windows versions, grace period, user messaging, exemptions, and rollback criteria.
2. Baseline current compliance and confirm break-glass, kiosk, shared, and other exceptional devices are handled appropriately.
3. Deploy to a representative pilot group.
4. Observe for 48 hours. Track compliance failures, enrollment/check-in issues, Conditional Access impact, and support tickets.
5. Require documented helpdesk approval.
6. Expand through successively larger rings, pausing on threshold breaches.
7. Assign to all eligible Windows devices only after each gate passes.
8. Monitor afterward and retain a rollback path, ownership, and audit record.

Unavailable evidence: I have no live tenant connection, so I cannot verify device counts, existing policies, assignments, exclusions, conflicts, licenses, or Graph responses. Before execution, an authenticated admin should validate those items in Intune; live Microsoft Graph verification would also require Lokka access with sufficient read permissions and `graphApiVersion: "beta"`.
