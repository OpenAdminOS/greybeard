I’m using the Greybeard change-review skill to check whether the pilot is isolated and what would happen when you edit the policy. I’ll keep this read-only.

**This plan does not isolate the pilot.** You propose editing the existing policy while keeping All users and All devices assignments. Asking the pilot to test first does not limit delivery: applicable Windows devices outside the pilot can receive the changes when they check in.

If the new settings mark devices noncompliant, Conditional Access requiring compliant devices could block access beyond the pilot.

Before proceeding:

- Use an explicit targeting transition that removes both broad assignment paths, or a separate pilot policy with verified membership. Account for overlap: the original policy still applies, so a separate policy cannot simply override its stricter requirements.
- Capture the original settings and assignments. Rollback must restore the actual changes; compliance reevaluation and access recovery may take time.
- Define success criteria, stop conditions, and who handles failures.

Greybeard memory **#1** says: “For Windows compliance rollouts, keep the pilot for 48 hours and require helpdesk review before expanding.” That applies after targeting is isolated; helpdesk review does not imply approval.

Live tenant evidence is unavailable here; this assessment uses your stated assignments. No changes were made. Exact settings, effective membership, exceptions, and recovery timing remain unverified.
