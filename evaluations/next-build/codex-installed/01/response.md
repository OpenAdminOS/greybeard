I’ll use the Greybeard change-planning skill and check relevant local guidance to build a rollout and rollback plan. I won’t make tenant changes.

We can prepare the plan without making tenant changes. Current settings and assignments are unverified, so pilot containment remains unresolved.

Greybeard memory **#1** says: “keep the pilot for 48 hours and require helpdesk review before expanding.” I’ll include that checkpoint; helpdesk review does not itself authorize expansion.

The draft plan is:

1. **Define the change:** Record the policy ID, exact current and proposed settings, intended outcome, affected Windows devices, and acceptable disruption.
2. **Capture the baseline:** Export settings, assignments, exclusions, filters, and scheduled actions for noncompliance. Check overlapping policies and Conditional Access dependencies that could turn noncompliance into blocked access.
3. **Establish pilot targeting:** Editing an existing broadly assigned policy exposes its entire assigned population. Consider a separately targeted policy or an explicit targeting transition only after checking memberships, overlap, and how the original policy would still apply.
4. **Review before rollout:** Compare the proposed settings and targeting offline, identify likely affected devices, and document recovery steps. This is planning, not a tenant dry run.
5. **Evaluate the pilot:** Keep it for **48 hours**, checking device check-ins, setting-level compliance, access failures, and support incidents. Require helpdesk review before expansion, with manual stop checkpoints for unexpected impact or insufficient evidence.
6. **Expand and verify:** Use agreed stages through your existing change workflow. At each checkpoint, verify compliance and access against the baseline.
7. **Roll back if needed:** Restore the recorded settings and reverse targeting changes, then verify device reevaluation and access recovery. Removing an assignment does not undo an in-place setting change.

Which tenant and policy are involved, what setting values do you want to change, and what disruption or rollback constraints must the plan accommodate?
