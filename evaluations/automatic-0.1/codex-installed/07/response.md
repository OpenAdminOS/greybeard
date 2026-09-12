I’ll use the Greybeard change-plan skill to build a read-only rollout plan and check for relevant tenant guidance.

No changes made. Assuming you mean **Windows device compliance in Intune**, here is a provisional rollout plan.

Greybeard memory is paused, so no remembered guidance was used. Live tenant reads are unavailable here; existing policies, assignments, and Conditional Access dependencies remain unverified.

| Stage | Proposed work | Gate before proceeding |
|---|---|---|
| Establish baseline | Inventory Windows compliance settings, assignments, exclusions, filters, noncompliance actions, device health, and Conditional Access policies requiring compliance. | Confirm actual affected devices and existing access impact. |
| Define requirements | Agree requirements such as BitLocker, Secure Boot, supported OS versions, firewall, and antivirus. Identify how failing devices will be remediated; compliance policies assess requirements rather than configure every prerequisite. | Each requirement has an owner, remediation path, and agreed grace period. |
| Validate targeting | Assess a separately targeted policy option and its overlap with existing policies. | **Pilot containment remains unresolved until assignments and membership are checked.** Adding a pilot group to a broadly assigned policy does not narrow its exposure. |
| Evaluate a pilot | Once targeting is verified, select representative hardware, work patterns, and critical applications. Review per-setting failures, check-ins, and access outcomes. | Manual review confirms understood failures, working remediation, and acceptable impact. Pilot size and duration remain to be agreed. |
| Expand in stages | Extend to agreed groups with support coverage and a review checkpoint between stages. | Pause expansion for unexplained failures, unexpected access blocks, or support demand above agreed capacity. |
| Verify completion | Confirm intended coverage, investigate devices with missing or stale results, and review exceptions. | Owners accept remaining exceptions and ongoing monitoring. |

Before any future execution, record the original settings and targeting. Rollback must restore both where changed; removing a new assignment does not undo an in-place setting edit. Then verify device reassessment and access recovery, without assuming immediate propagation.

Any offline comparison would be planning evidence, not a tenant dry run. Intune compliance changes can affect access through existing Conditional Access policies.

Which tenant and Windows population is this for, which compliance requirements are you targeting, and what access disruption and recovery window are acceptable?
