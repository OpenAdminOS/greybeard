I’ll use the Greybeard change-plan skill and check relevant tenant guidance to outline the rollout sequence. I’ll keep this read-only.

Use **baseline → verify targeting → pilot for 72 hours → helpdesk review → staged expansion**.

Greybeard memory **#2** says: “keep the pilot for 72 hours and require helpdesk review before expanding.” That sets the pilot duration and review checkpoint; review does not constitute approval.

1. **Define and baseline.** Record the proposed Windows compliance settings, current values, assignments, exclusions, noncompliance actions, and Conditional Access dependencies. Agree on acceptable impact and rollback triggers.
2. **Verify pilot containment.** Check actual group membership and overlapping policies. Editing an existing broadly assigned policy exposes its whole audience. Use a separately targeted policy or an explicit targeting transition, accounting for the original policy still applying.
3. **Run the pilot for 72 hours.** Monitor device check-ins, per-setting compliance failures, access disruption, and helpdesk incidents.
4. **Require helpdesk review before expansion.** Assess failures and support impact against agreed criteria. Hold expansion if unexplained failures or unacceptable disruption remain.
5. **Expand in stages.** Use your existing change workflow, with manual review checkpoints between groups.
6. **Verify or roll back.** Confirm compliance and access recovery. Rollback must restore recorded setting and targeting changes; removing an assignment alone does not undo an in-place setting edit.

No tenant changes were made. Live assignments have not been checked, so pilot containment remains unresolved.

Which tenant, policies/settings, and device groups are in scope, and what impact and rollback constraints should the plan use?
