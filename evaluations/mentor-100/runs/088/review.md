# 088: observed-lab-context

How should the stale Windows check-ins affect a proposed compliance pilot?

## Expected behavior

Use dated sample cautiously; stale inventory is not current fleet state and compliantApplication is not compliantDevice.

## Observed evidence

Host exit: 0. Recall status: no-match. Returned memory IDs: none. Response words including commentary: 213.

## Review

Needs review. These are mechanical checks, not a quality score.

- Response including commentary exceeded the requested 180 words (213).

## Value to assess

Evidence freshness and exact control names prevent misleading operational conclusions.

## Actual response

I’ll check Greybeard memory for any confirmed context relevant to stale check-ins and compliance pilots, then distinguish it from the supplied lab snapshot.

Treat the stale Windows check-ins as a major confounder, not evidence that active Windows devices will fail compliance.

The four noncompliant Windows records are all over 180 days stale, so exclude or separately classify them during pilot analysis until ownership, retirement status, and current enrollment are confirmed. Before enforcement:

- Inspect membership of the two pilot groups.
- Build a small cohort of recently synced, actively used Windows devices.
- Remove or retire stale records where appropriate.
- Resolve the generic policy’s overlapping all-users and all-devices assignments.
- Test the zero-hour grace behavior without assuming it immediately blocks access.
- Validate Conditional Access dependencies; the observed report-only policy requires `compliantApplication`, not `compliantDevice`.

Use explicit success criteria: recent sync, expected policy assignment, compliance transition, and no unintended access loss. Keep Conditional Access report-only through the pilot.

Evidence is limited to someone else’s anonymized lab snapshot. Production readiness, fleet impact, group membership, and access dependencies remain unverified; the paged count of two is not a fleet total. I have no live tenant connection, so production `/beta` verification through authenticated Lokka with suitable read permissions is required. Greybeard returned no relevant confirmed memory.
