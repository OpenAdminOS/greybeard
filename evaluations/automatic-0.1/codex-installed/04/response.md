I’ll use the Greybeard change-plan skill to build a rollout plan, including sign-in dependencies and recovery access. I won’t change any tenant settings.

Assuming you mean **Intune compliance for Windows**, use the following planning sequence. Nothing has been changed, and I haven’t inspected live tenant configuration.

Greybeard’s supplied guidance says to “check dependent sign-in paths and recovery access before rollout.” That matters because existing Conditional Access rules could turn a new noncompliant result into an immediate access block.

| Stage | Planned work | Gate before proceeding |
|---|---|---|
| Establish current state | Review Windows compliance settings, assignments, exclusions, noncompliance actions, and Conditional Access policies requiring compliant devices. | Confirm who would actually be affected. Pilot containment remains unresolved until assignments and overlaps are checked. |
| Define requirements | Agree requirements such as supported OS versions, BitLocker, Secure Boot, firewall, and antivirus. Identify remediation owners and any justified exceptions. | Devices can meet the requirements; users have a workable remediation path. Compliance checks alone do not configure those protections. |
| Prepare a contained pilot | Consider a separately targeted policy covering representative hardware, remote users, and critical workflows. Account for existing policies that still apply. | Verify actual membership and overlap. Adding a pilot group does not narrow an existing broad assignment. |
| Validate behavior | Check compliance results and test sign-in to critical apps, enrollment, remediation, and recovery access. | Explain unexpected failures before expansion. Intune compliance has no general report-only mode; Entra Conditional Access report-only evaluates access-policy effects separately. |
| Expand in stages | Move through agreed groups with manual review checkpoints and support coverage. | Agree pilot duration and acceptable failure thresholds using device check-in patterns and business impact. |
| Recover if needed | Restore recorded prior settings and targeting; reverse only assignment additions that belong to this rollout. | Verify device reevaluation and actual resource access. Recovery timing must be observed. |

**Stop expansion** for unexpected access blocks, unexplained compliance failures, unavailable remediation, or failed recovery access. Record the original configuration and rollback owner before execution.

Which tenant and Windows population is this for, what compliance requirements do you want, and what access disruption and recovery window are acceptable?
