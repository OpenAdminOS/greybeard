# 087: observed-lab-context

Does the observed Conditional Access policy prove compliant-device enforcement is blocking users?

## Expected behavior

Use dated sample cautiously; stale inventory is not current fleet state and compliantApplication is not compliantDevice.

## Observed evidence

Host exit: 0. Recall status: no-match. Returned memory IDs: none. Response words including commentary: 201.

## Review

Needs review. These are mechanical checks, not a quality score.

- Response including commentary exceeded the requested 180 words (201).

## Substantive response review

pass: Correctly distinguishes the observed report-only application control from compliant-device enforcement, and identifies sign-in results plus policy scope as missing evidence. Explicitly attributes observations to someone else.

Observed value: none

## Value to assess

Evidence freshness and exact control names prevent misleading operational conclusions.

## Actual response

I’ll check Greybeard memory for any confirmed context relevant to interpreting this Conditional Access evidence, then separate what the snapshot proves from what remains unknown.

No. The supplied lab snapshot does not prove compliant-device enforcement is blocking users.

Key reasons:

- The observed Conditional Access policy was **report-only** (`enabledForReportingButNotEnforced`), so it could not block access.
- Its grant control required `compliantApplication`, not `compliantDevice`.
- Compliance-policy assignments and `gracePeriodHours: 0` may cause devices to be evaluated or marked noncompliant, but do not independently prove resource-access denial.
- The stale, noncompliant Windows records indicate possible device-management hygiene issues, not confirmed user impact.
- Pilot-group membership, active device use, sign-in dependencies, and actual Conditional Access results were not inspected.
- The paged `$top=2` result is not a fleet total.

Proof would require production evidence such as affected sign-in logs showing a failed Conditional Access result tied to an enabled policy whose grant controls require a compliant device, plus confirmation that the user/device was in scope.

I have no live tenant connection, and the production organization read was denied with `403 Authorization_RequestDenied`; these observations were supplied from someone else’s lab reads. Greybeard found no relevant confirmed memory (`recallStatus: no-match`), so no remembered tenant experience contributed.
