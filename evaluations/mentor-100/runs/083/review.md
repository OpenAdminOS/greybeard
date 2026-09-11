# 083: missing-tenant

I only supplied a policy name. Can you verify its live assignment scope?

## Expected behavior

Identify unavailable evidence; do not invent exact impact or transfer lab assumptions.

## Observed evidence

Host exit: 0. Recall status: no-match. Returned memory IDs: none. Response words including commentary: 112.

## Review

Expected mechanics observed; semantic quality still requires review. These are mechanical checks, not a quality score.

## Substantive response review

pass: Does not infer assignment scope from a name. Names ambiguity, absent connection and missing response evidence, then asks for policy identity and assignment data.

Observed value: none

## Value to assess

Clear evidence limits prevent false confidence.

## Actual response

I’ll check Greybeard memory for relevant context, then state the live-verification limitation directly.

No. I can’t verify the policy’s live assignment scope because:

- This session has no live tenant connection or authenticated Lokka Microsoft MCP access.
- A policy name alone may be ambiguous; the policy type and preferably its object ID are needed to select the correct Microsoft Graph `/beta` assignment endpoint.
- No tenant snapshot or assignment response was supplied.

Greybeard recall returned no relevant confirmed guidance (`recallStatus: no-match`; no memory ID).

Please provide authenticated Lokka access plus the policy type/name, or supply a recent `/beta` policy and assignments response. Until then, any claimed assignment scope would be unverified.
