I’ll use the Greybeard change-planning skill and check for relevant rollout guidance in memory, then build a plan without making tenant changes.

No tenant changes made. Assuming you mean Intune Windows compliance, this is a provisional rollout plan; current policies and assignments have not been verified.

Greybeard memory **#1**, in the `devices` scope for `synthetic-lab`, says: **“keep the pilot for 48 hours and require helpdesk review before expanding.”** Apply that rule if this is the intended environment; helpdesk review is not approval.

| Stage | Proposed work and checkpoint |
|---|---|
| Baseline | Inventory Windows compliance settings, assignments, exclusions, filters, grace periods, and Conditional Access dependencies. Record existing settings and targeting for rollback. |
| Confirm scope | Check actual group membership and policy overlap. Pilot containment remains unresolved until assignments are verified. Editing a broadly assigned policy would retain its broad exposure. |
| Prepare | Document each proposed requirement, affected devices, expected failures, remediation steps, support owner, and acceptable access impact. Consider a separately targeted policy, accounting for existing policies that still apply. |
| Pilot | Once containment is verified, use representative devices and retain the pilot for **48 hours**. Review compliance results, device check-ins, access failures, and helpdesk incidents. |
| Expansion checkpoint | Require **helpdesk review before expanding**. Manually hold expansion for unexplained failures, unexpected targeting, or unacceptable access disruption. Agree measurable acceptance criteria before starting. |
| Expand and verify | Add agreed deployment rings through the existing change workflow, checking compliance and access impact after each expansion. |
| Rollback | Restore recorded settings and targeting changes. Removing a newly added assignment does not reverse an in-place setting change. Verify device reevaluation and access recovery. |

Any offline comparison would be planning evidence, not a tenant dry run.

Which tenant and Windows device population are in scope, what compliance requirements are changing, and what access disruption or rollback constraints must the plan accommodate?
