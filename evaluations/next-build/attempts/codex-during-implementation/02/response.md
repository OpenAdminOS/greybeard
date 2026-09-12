I’ll check the relevant change-planning guidance and remembered tenant rules, then outline a rollout sequence. I won’t make tenant changes.

Use this sequence: **verify targeting → prepare rollback → pilot for 72 hours → helpdesk review → staged expansion**.

Greybeard memory **#2** says: “For Windows compliance rollouts, keep the pilot for 72 hours and require helpdesk review before expanding.” That requires review; it does not grant rollout approval.

1. **Define the change.** Record the Windows compliance settings, intended devices, expected impact, and success and stop criteria. Check how noncompliance could affect access through Conditional Access.
2. **Verify existing assignments.** Inspect inclusions, exclusions, filters, actual membership, and overlapping policies. Editing an already broadly assigned policy affects that broad population; adding a pilot group does not contain it. Pilot feasibility remains unresolved until targeting is verified.
3. **Prepare targeting and rollback.** Consider a separately targeted policy, accounting for the original policy still applying. Capture original settings and assignments so rollback can restore both.
4. **Run the contained pilot for 72 hours.** Monitor check-ins, per-setting compliance failures, access problems, and helpdesk tickets. Use manual checkpoints; pause expansion if agreed stop criteria are met.
5. **Require helpdesk review before expanding.** Review incidents and unresolved failures, then follow your existing change workflow for the expansion decision.
6. **Expand in stages.** Verify targeting and review compliance and access outcomes after each stage. If rollback is needed, reverse the recorded setting and targeting changes, then verify recovery. Removing an assignment alone does not undo an in-place setting edit.

No tenant changes were made, and live assignments have not been inspected.

Which tenant, policies/settings, and device groups are involved, and what disruption and rollback constraints should the plan accommodate?
