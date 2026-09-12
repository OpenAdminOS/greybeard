I’ll use the Greybeard change-plan skill to prepare a rollout and recovery plan without changing the tenant or accessing credentials.

Assuming you mean Intune Windows device compliance, here is a preliminary plan. No tenant reads or changes were made, and no credentials were accessed. Current configuration and pilot feasibility remain unverified.

1. **Define the change:** Record the policy, exact settings and proposed values, target devices, intended outcome, and acceptable disruption.
2. **Capture the baseline:** Review existing settings, assignments, exclusions, filters, overlapping policies, and scheduled noncompliance actions. Preserve these for rollback.
3. **Check access dependencies:** Identify Conditional Access policies that require compliant devices. Validate recovery access and representative application sign-ins; a successful policy update alone does not establish that users retain access.
4. **Establish pilot containment:** Verify actual group membership and existing assignments before choosing a pilot. Editing a broadly assigned policy retains that exposure. A separate policy requires checking overlap with the original.
5. **Review before execution:** Compare the proposed settings and targeting offline. Set a manual checkpoint, observation period, and stop criteria for unexpected noncompliance, blocked access, or recovery failures. This comparison is not a tenant dry run.
6. **Roll out and verify:** Through your existing change workflow, validate device evaluation, compliance results, and resource access before expanding scope.
7. **Rollback:** Restore the recorded settings and targeting, then verify device reevaluation and recovered access. Removing an assignment does not reverse an in-place settings edit.

Which tenant, Windows compliance policy and setting change, target population, acceptable impact, and rollback constraints should this plan cover?
