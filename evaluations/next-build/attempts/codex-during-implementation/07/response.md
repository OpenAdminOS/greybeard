I’ll use the Greybeard change-plan skill and check for relevant tenant guidance to prepare a read-only rollout plan.

Assuming you mean **Intune Windows device compliance**, here’s a preliminary rollout plan. Nothing was changed. Live policies and assignments remain unverified; Greybeard memory is paused and returned no guidance.

| Stage | Plan and checkpoint |
|---|---|
| Establish baseline | Inventory Windows compliance policies, assignments, exclusions, group membership, noncompliance actions, and Conditional Access policies requiring compliant devices. Record settings and targeting for rollback. |
| Define requirements | Agree on controls such as supported Windows versions, BitLocker, Secure Boot, firewall, and antivirus. Identify remediation owners and grace periods before enforcement. |
| Validate pilot scope | Pilot feasibility remains unresolved until assignments are checked. Editing a broadly assigned policy still affects its broad audience. Consider a separately targeted policy, accounting for existing policies and membership overlap. |
| Run pilot | Choose representative hardware, remote workers, and critical applications. Agree on pilot size and duration based on check-in patterns and support capacity. Track compliance failures, remediation success, and access disruption. |
| Expand in stages | Use a manual review checkpoint before each expansion. Pause expansion for unexpected targeting, unexplained failures, critical application access loss, or support overload. Agree on numerical thresholds beforehand. |
| Roll back if needed | Restore recorded settings and targeting. Removing a newly added assignment reverses that addition, but does not reverse an in-place settings change. Verify device reevaluation and access recovery. |

**Access impact needs particular attention:** existing Conditional Access enforcement can turn a new compliance failure into blocked access. Conditional Access report-only mode can assess those access rules; it is not a report-only mode for Intune compliance policies. An offline comparison is planning, not a tenant dry run.

Which tenant and Windows device population is this for, what compliance requirements are you introducing, and what access disruption and recovery window are acceptable?
