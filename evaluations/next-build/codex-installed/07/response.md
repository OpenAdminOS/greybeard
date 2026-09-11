I’ll use the Greybeard change-plan skill and check for relevant rollout guidance in memory. I’ll keep this to planning and make no tenant changes.

Assuming you mean **Intune Windows device compliance**, here is a provisional rollout plan. Nothing has been changed. Live tenant configuration is unverified; Greybeard memory is paused and returned no guidance.

1. **Define the requirements.** Agree on checks such as BitLocker, Secure Boot, antivirus health, and minimum Windows version. Identify the intended devices, exceptions, remediation owners, and acceptable access impact.
2. **Establish current exposure.** Review existing compliance settings, assignments, exclusions, filters, noncompliance actions, and Conditional Access policies requiring compliant devices. Record the original configuration for rollback.
3. **Validate pilot containment.** Pilot feasibility remains unresolved until assignments and actual membership are checked. Adding a pilot group to a broadly assigned policy does not narrow its scope. A separately targeted policy is an option, but existing policies still apply.
4. **Prepare remediation and support.** Document how users resolve each failure, support escalation, notifications, and proposed grace periods. Agree on pilot size and duration based on device diversity and check-in patterns.
5. **Run a manual review checkpoint.** Before any future deployment, compare intended targeting offline. After an authorized pilot, verify per-setting compliance, assignment coverage, check-ins, and actual access effects. Offline comparison is planning, not a tenant dry run.
6. **Expand only after review.** Pause expansion for unexpected targeting, unexplained failures, or unacceptable access disruption. Set measurable acceptance thresholds before starting.
7. **Rollback precisely.** Reverse the recorded settings and targeting changes, then verify device status and access recovery. Removing an assignment does not undo an in-place settings edit.

Which tenant and Windows device population is this for, what compliance requirements are you introducing, and what access disruption or rollback constraints must the plan respect?
