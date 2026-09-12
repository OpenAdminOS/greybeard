I’ll use the Greybeard change-plan skill to outline the rollout and access checks. I’ll keep this to planning and make no tenant changes.

Assuming you mean Intune Windows device compliance, here’s a provisional rollout plan. **No tenant changes were made, and current policies and assignments have not been verified.**

Greybeard confirmed memory **#1 (devices)** says: “keep the pilot for 48 hours and require helpdesk review before expanding.” That sets the pilot duration and review checkpoint; review itself is not approval.

| Stage | Proposed work | Checkpoint |
|---|---|---|
| Establish scope | Identify the tenant, Windows population, required compliance settings, current policies, assignments, exclusions, and noncompliance actions. Check Conditional Access dependencies. | Actual targeting and overlapping policies are understood. |
| Prepare targeting | Consider a separately targeted policy for a representative pilot. Verify group membership and existing policies that will still apply. | Pilot containment is verified. Editing an existing broadly assigned policy would retain broad exposure. |
| Prepare support and recovery | Document remediation instructions, support ownership, grace periods, baseline settings and assignments, and recovery access. Test dependent sign-in paths. | Users and administrators have a tested recovery route. |
| Run pilot | Hold the pilot for **48 hours**. Monitor check-ins, setting-level failures, resource access, and support incidents. | Require **helpdesk review before expanding** and resolve unexplained failures. |
| Expand in stages | Choose subsequent groups based on pilot evidence and support capacity. Review compliance and access after each stage. | Manual decision to continue; pause on unexpected access failures or targeting errors. |

A successful policy deployment does not prove users can still access their resources. Validation should include sign-in to essential applications, particularly where Conditional Access requires a compliant device.

For rollback, record and reverse the precise setting and targeting changes, then verify device reevaluation and restored access. Removing a newly added assignment can reverse that assignment addition; it does not undo an in-place policy edit.

To make this concrete, which tenant and Windows groups are in scope, which compliance requirements do you want to introduce, and what access disruption or rollback constraints must the plan accommodate?
