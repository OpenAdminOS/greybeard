I’ll use the Greybeard change-plan skill to build a reviewable rollout plan and check for relevant tenant guidance.

We can plan this without tenant changes. **The key risk is scope:** editing a policy already assigned broadly exposes those devices immediately; adding a pilot group does not narrow existing assignments.

Greybeard memory **#1** says: “For Windows compliance rollouts, keep the pilot for 48 hours and require helpdesk review before expanding.” I’ll incorporate that checkpoint; helpdesk review does not itself mean approval.

The draft plan is:

1. **Capture the baseline:** record current settings, assignments, exclusions, filters, noncompliance actions, device compliance results, and Conditional Access dependencies that could turn noncompliance into blocked access.
2. **Define the change:** document each current → proposed value, intended outcome, affected Windows devices, acceptable disruption, and rollback owner.
3. **Establish pilot containment:** inspect actual assignments and membership first. Consider a separately targeted policy or an explicit targeting transition, accounting for the original policy still applying. **Pilot feasibility remains unresolved until assignments are verified.**
4. **Validate and observe:** compare the proposed settings against device readiness offline. After execution through your existing workflow, observe the pilot for **48 hours**, check compliance and access failures, and require helpdesk review before expansion.
5. **Expand in stages:** use manual checkpoints. Pause expansion for unexpected access blocks, unexplained compliance failures, or support impact beyond agreed limits.
6. **Roll back if needed:** restore recorded setting values and reverse targeting changes, then verify device compliance and access recovery. Removing an assignment alone does not undo an in-place setting edit.

No live tenant configuration has been verified, and no tenant changes have been made.

Which tenant and policy are you targeting, what settings should change from their current values, and what disruption, change window, and rollback constraints should the plan accommodate?
