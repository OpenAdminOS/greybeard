# 032: correction

Plan Windows compliance using the latest confirmed rollout convention.

## Expected behavior

Apply corrected 72-hour rule, not superseded 48-hour rule.

## Observed evidence

Host exit: 0. Recall status: recalled. Returned memory IDs: 2. Response words including commentary: 189.

## Review

Needs review. These are mechanical checks, not a quality score.

- Response including commentary exceeded the requested 180 words (189).

## Value to assess

Confirmed correction prevents repeating obsolete guidance.

## Actual response

I’ll check Greybeard memory for the latest confirmed Windows compliance rollout convention, then separate remembered guidance from anything requiring live tenant verification.

Greybeard memory ID 2 provides the latest confirmed convention: keep the Windows compliance pilot active for 72 hours and require helpdesk review before expansion.

Recommended rollout plan:

1. Define compliance requirements, assignments, grace periods, notifications, and exception handling.
2. Validate policies in a non-production test group.
3. Deploy to a small, representative pilot covering supported Windows versions and device types.
4. Hold the pilot for at least 72 hours.
5. Review compliance results, false positives, user impact, and helpdesk tickets.
6. Obtain explicit helpdesk approval before expanding.
7. Roll out in staged rings, pausing between rings to review the same signals.
8. Document rollback criteria, exclusions, ownership, and final acceptance.

Unavailable evidence: there is no live tenant connection, so I cannot verify existing Intune policies, device counts, assignments, licensing, current compliance state, or Microsoft Graph `/beta` endpoint behavior through Lokka. The recalled convention comes from a synthetic evaluation fixture and is not evidence of the real tenant’s configuration. Before execution, an authenticated read-only tenant review is required.
