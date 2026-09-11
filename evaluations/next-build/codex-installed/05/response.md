I’m using the Greybeard change-review skill to check whether the proposed pilot actually limits the impact. I’ll review the plan without changing tenant configuration.

Your plan edits an existing Windows compliance policy while retaining its All users and All devices assignments. **That is a broad rollout immediately upon evaluation, not a pilot.** Asking the pilot group to test first does not stop other targeted Windows devices from receiving the settings. Devices that fail could lose access if Conditional Access requires compliance.

Revise the plan before editing:

- Use a separate pilot-targeted policy or an explicit assignment transition. Account for overlap: the existing policy still applies, so a separate, looser policy may not override its requirements.
- Verify actual pilot membership and effective targeting before deployment.
- Record the original settings for rollback. Restoring them requires device reevaluation; recovery is not instantaneous.

Greybeard memory **#1** requires: “keep the pilot for 48 hours and require helpdesk review before expanding.” Apply that after targeting is actually limited; helpdesk review is not approval.

No changes were made. Live tenant evidence was unavailable, so this assessment uses your stated assignments.

Which targeting approach will you use to ensure only the pilot receives the changed settings?
