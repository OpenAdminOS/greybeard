# Memory recall contract

Greybeard recalls confirmed records from the tenant and profile bound when the
service starts. Recall includes global records and records in the requested exact
scope. Candidates and superseded records cannot supply advice. Turning off
`learningEnabled` pauses both proposals and recalled advice; local list/export
remain available for review.

Usually call `recall` with a short `query` and omit the optional budget. If needed,
use `byteBudget`: a nonnegative safe integer, defaulting to 800 and capped at 800.
An oversized request such as 1800 succeeds with an effective cap of 800. Negative,
fractional, nonnumeric and unsafe integer values are invalid. `tokenBudget` remains
an accepted deprecated alias; conflicting values for both fields are rejected.

`serializedBytes` counts each compact recalled node's UTF-8 JSON bytes plus one
separator byte per node. `byteBudget` describes that allowance only, excluding the
response envelope, array brackets, tool definitions and host conversation.
`budgetUnit` is `utf8-bytes`. The legacy output fields `estimatedTokens` and
`tokenBudget` alias `serializedBytes` and `byteBudget`. None of these fields
measures model tokens, total context or billing.

Recalled nodes carry ID, type, content, confirmation status, source, scope and
direct-match or link provenance. Tenant and profile appear once on the response.
Full timestamps, revisions and confirmation details remain in list/export.

`recallStatus` distinguishes `recalled`, `no-match`, `budget-excluded` and `paused`.
`attribution` describes what Greybeard retrieved, without claiming that the host
used it, that an independent assessment ran, or that tenant state was verified.
The host should identify the particular record that affected its answer only
when it actually applies that record. A preference can contain a useful rollout
convention; its type alone does not make it a mentor behavior setting.

Confirmation, correction and deletion govern subsequent retrieval. They cannot
remove text already present in an existing host conversation. Start a fresh
conversation when checking that a correction or deletion changes advice.

## Scope selection

Omitting `scope` searches global guidance only. To recall a lesson stored under `devices`, explicitly pass `scope: "devices"`; that also includes applicable global guidance. A matching task summary alone does not select a named scope. Reliable scope selection by the host remains a client integration requirement.
