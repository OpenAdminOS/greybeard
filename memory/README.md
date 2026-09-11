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

`discover_scopes` makes scope selection explicit: it returns up to 20 labels and
matching confirmed counts in the bound tenant/profile, with a lexical cursor for
further pages. An optional short task query uses bounded vocabulary expansion.
No scoped content is returned, no scope is automatically applied, and paused
advice returns no discovered labels. The host must select a scope that actually
applies, then pass its exact label to `recall`. Exceptions remain scoped and can
suppress a general rule when only the exception fits the byte budget.

## Relevance and evidence

Retrieval uses FTS plus a small transparent vocabulary for common admin terms
(such as pilot/ring, rollout/deployment and device/endpoint). Task concept overlap
ranks ahead of type preference. Generic mentoring boilerplate is suppressed for
operational queries, while explicit style/preference queries can still retrieve
it. This is bounded lexical matching, not a semantic model or a guarantee that
every paraphrase will match. No continuous model call is introduced.

Records distinguish `rule`, `observation`, `inference` and `context` evidence.
Preferences and decisions default to rules; facts default to observations.
`observedAt` is UTC epoch seconds when the evidence was observed, or null when
unknown. It is never inferred from creation or confirmation and never refreshed
by recall. Recall includes the evidence kind, timestamp and age in seconds.
Observations and inferences always set `verificationRequired: true`; confirmation
means an admin accepted the local record, not that old inventory became current
or an inferred explanation became proven. These fields count within the byte cap.

Schema 4 preserves existing records, revisions, confirmations, links and scopes.
Historical facts receive observation kind with unknown observation time, so an
upgrade does not manufacture evidence of freshness.

## Learning from an outcome

`propose_outcome` accepts one concise reusable `lesson`, a separate reported
`outcome`, its `source`, and optional scope and observation timestamp. It creates
a decision candidate, never confirmed guidance. The companion can display the
reported outcome beside the lesson before exact-record local confirmation.
Corrections use the existing `remember({ supersedes })` lifecycle and remain
candidates until reviewed. Neither chat assent nor an automated tool can confirm
memory. Local memory actions do not activate or change tenant policies.

## Local feedback and context measurement

Each non-paused recall gets a `recallId`. A local bounded history stores its
status, date, returned memory IDs and revisions, serialized bytes and optional human feedback.
It never stores the query, provider credentials, model response or another copy
of memory content. History is limited to the most recent 10,000 recall events in
each tenant/profile. Paused recall does not add an event.

`adviceHistory()` supplies recent recalled events to local controls, resolving
content only when the original ID and revision still exist. Forgotten memory
content is not retained in the history and a reused ID cannot substitute new text.
`recordAdviceFeedback({ recallId, feedback })` accepts `accepted`, `ignored` or
`irrelevant`, with one editable rating per event. These controls are deliberately
absent from MCP so an agent cannot grade its own usefulness. `adviceMetrics()`
reports recall counts, returned bytes, explicit ratings, irrelevant share among
rated events and accepted ratings per KiB of recalled context. Retrieval is not
an interruption or proof that advice was displayed: unrated events remain
unrated. The metrics report `billing: "not-measured"`; the host/provider must
supply actual token usage and billing separately. `clearAdviceMetrics()` deletes
this profile's history without deleting its lessons. These aggregates describe
the bounded local history, not lifetime totals.

Local `list` supports literal content search plus exact scope, type and status
filters before pagination. Export continues to include all records and evidence.
