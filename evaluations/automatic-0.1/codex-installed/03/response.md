I’ll use the Greybeard change-plan skill to build a staged rollout plan, including access and recovery checks. I won’t change any tenant settings.

Assuming you mean **Windows device compliance in Intune**, here’s a provisional rollout plan. No tenant settings were changed or inspected; existing assignments and pilot containment remain unverified.

Greybeard’s supplied guidance says to “check dependent sign-in paths and recovery access before rollout.” That means testing access to business apps and remediation tools—not just checking that a device reports compliant.

| Stage | Proposed work | Gate to proceed |
|---|---|---|
| Establish baseline | Review Windows inventory, existing compliance settings, assignments, exclusions, noncompliance actions, and Conditional Access dependencies. Record original settings and targeting for rollback. | Effective scope and access impact understood. |
| Define requirements | Agree requirements such as supported Windows versions, BitLocker, Secure Boot, firewall, and antivirus. Define remediation owners, grace periods, and exception expiry. Compliance evaluates requirements; configuration policies may be needed to implement them. | Target devices can meet the requirements. |
| Design containment | Consider a separately targeted policy after checking actual group membership and policy overlap. Adding a pilot group to an already broadly assigned policy does **not** narrow exposure. | Pilot targeting verified, including existing policies that still apply. |
| Run a representative pilot | Include relevant hardware, remote workers, and critical app users. Verify device check-in, individual compliance results, business-app sign-in, and access to remediation and recovery tools. | Manual review confirms acceptable results and working recovery. |
| Expand in stages | Expand through agreed groups with a manual checkpoint after each stage. Choose duration and thresholds from observed check-in patterns and business tolerance. | No unexplained failures or unacceptable access disruption. |

**Access enforcement needs special care:** an existing Conditional Access policy requiring compliant devices can turn a new compliance failure into an immediate access problem, depending on configured actions and timing. Intune compliance has no general report-only mode. Conditional Access report-only can help evaluate a proposed CA policy, but does not neutralize existing enforcement.

**Stop and rollback:** pause expansion for unexpected targeting, critical-app access failures, unavailable recovery paths, or failures above an agreed threshold. Restore the recorded settings and targeting changes, then verify device reevaluation and actual sign-in recovery. Removing an assignment does not reverse an in-place settings edit.

To make this specific, which tenant and Windows population are in scope, what compliance requirements do you want, and what access disruption and recovery time are acceptable—including whether Conditional Access already requires compliant devices?
