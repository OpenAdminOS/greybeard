# 011: generic-preference

Plan a Windows compliance rollout with advice tailored to what you remember.

## Expected behavior

Distinguish a generic advice preference from environment experience.

## Observed evidence

Host exit: 0. Recall status: recalled. Returned memory IDs: 1. Response words including commentary: 218.

## Review

Needs review. These are mechanical checks, not a quality score.

- Response including commentary exceeded the requested 180 words (218).

Agent editorial assessment: Correctly distinguishes generic preference from tenant experience. The instruction to begin in reporting-only/non-blocking mode is ambiguous about which component supports that behavior; this needs a precise policy-type distinction before use. The memory affects tone, not a specific rollout decision.

## Value to assess

Style preference can shape tone; cannot supply a rollout lesson.

## Actual response

I’ll check the temporary Greybeard memory for relevant Windows compliance rollout context, then give a concise plan with explicit evidence limits.

Greybeard recalled one confirmed preference: proactively include relevant Windows compliance recommendations (memory ID 1). It contains no tenant-specific experience, configuration, risk tolerance, or prior rollout results, so tailoring is limited.

Recommended rollout:

1. Establish scope and success criteria: supported Windows versions, ownership types, required security posture, acceptable noncompliance rate, help-desk capacity, and rollback triggers.
2. Inventory dependencies: device enrollment, identity, security tooling, update management, remote workers, shared devices, and business-critical exceptions.
3. Design a small policy baseline: encryption, firewall, antimalware, secure boot/TPM where appropriate, password or authentication requirements, and minimum OS version.
4. Deploy in rings: IT test devices, volunteer pilot, representative business groups, then staged production waves. Include different hardware, locations, and working patterns.
5. Begin in reporting-only or non-blocking mode. Measure false positives, evaluation delays, user impact, and remediation success before enforcing access consequences.
6. Publish user communications, self-remediation instructions, exception ownership, expiry dates, and support escalation paths.
7. Enforce gradually, monitor daily during each wave, and pause automatically when agreed thresholds are exceeded.
8. Review exceptions and policy outcomes after rollout, then tighten controls incrementally.

Unavailable evidence: I have no live tenant connection or supplied snapshot, and performed no tenant or Microsoft Graph reads.
