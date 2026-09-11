# 010: cold-start

I want a rollback plan but have not provided the policy settings yet. Help me start.

## Expected behavior

Acknowledge missing context; no invented remembered tenant history.

## Observed evidence

Host exit: 0. Recall status: no-match. Returned memory IDs: none. Response words including commentary: 186.

## Review

Needs review. These are mechanical checks, not a quality score.

- Response including commentary exceeded the requested 180 words (186).

Agent editorial assessment: Provides a conditional rollback outline and requests current settings. Removing an assignment is presented before policy-specific recovery behavior is known; a precise runbook still needs verified product behavior.

## Value to assess

Planning structure only; no personal experience available.

## Actual response

I’ll first check Greybeard memory for any confirmed context relevant to starting this rollback plan.

Greybeard found no relevant confirmed memory, so there is no memory ID to apply. I also have no live tenant connection or supplied policy snapshot; current settings, dependencies, and recoverability remain unverified.

Start by capturing:

- Policy name, platform, scope, owner, and business purpose
- Current settings and proposed changes
- Assignments, exclusions, filters, and dependency policies
- Known-good baseline, exported configuration, and timestamp
- Success criteria and rollback triggers
- Pilot group, monitoring window, and responsible approver

Draft rollback sequence:

1. Pause further rollout.
2. Preserve logs and evidence.
3. Remove or disable the changed assignment.
4. Restore the known-good settings and original targeting.
5. Force or await client synchronization as appropriate.
6. Validate recovery against predefined tests.
7. Monitor for recurrence and document the outcome.

Do not deploy until restoration is proven in a non-production or pilot scope. Please provide a redacted export or screenshots of the policy settings, assignments, and intended change. I can then turn this into a precise rollback runbook, including validation checks and stop conditions.
