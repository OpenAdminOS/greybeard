# Greybeard: field review and next build

Current companion implementation supersedes the earlier delivery and backlog status below. See [the companion flow](../companion.md) and [recommendation coverage](implementation-coverage.md).

The product test is whether an administrator gets a materially better decision because Greybeard remembers relevant experience, preserves a correction, or identifies a constraint the current conversation would otherwise miss. Installation, a successful recall, and a branded answer are necessary infrastructure; they do not establish that value by themselves.

## Implemented after the Mac conversation

| ID | Issue found | Change | Evidence |
| --- | --- | --- | --- |
| GB-01 | Codex requested recall budget 1800 and received a validation error before retrying 800. | Clamp valid oversized requests to 800; continue rejecting invalid input. Skills omit optional budget fields by default. | Actual MCP regression in memory tests; budget case in prompt evaluation. |
| GB-02 | `estimatedTokens` looked like model usage but counted serialized bytes. | Add explicit byte fields, document legacy aliases, and clarify excluded envelope/host overhead. Compact returned nodes. | Memory contract and budget tests. No token-savings promise. |
| GB-03 | Pausing learning and advice did not suppress direct memory recall. | Return a paused result with no recalled guidance; retain records for local review/export. | Fresh-service pause/resume regression. |
| GB-04 | A linked-memory query could overwrite provenance with an edge's numeric source ID. | Alias the SQL edge column separately and preserve the memory's original source. | Linked-memory provenance regression. |
| GB-05 | Advice-style preferences appeared as experiential lessons. | Separate Mentor preferences from Lessons and decisions using the existing record type. Include IDs and retain review controls. | UI interaction tests and browser verification. Specific rollout preferences still belong in Preferences. |
| GB-06 | The admin could not tell what Greybeard contributed. | Add retrieval-status metadata and concise skill instructions to name a relevant confirmed memory and its practical effect. | Prompt-response review. This guides the host; it does not guarantee host compliance or create a separate agent. |

## Next-build priorities

| Priority / ID | Improvement | Why an admin would miss it | Acceptance evidence |
| --- | --- | --- | --- |
| P0 / GB-07 | Prove useful recall under normal client discovery. | A lesson that only appears after the admin explicitly asks for memory will often arrive too late. | Fresh real Codex/Claude sessions, normal installed configuration, unprompted relevant recall, no irrelevant repeated nudges. The 100-case harness forces recall and cannot prove this. |
| P0 / GB-08 | Improve relevance and suppress generic matches. | The mentor should remember an exception or past incident, not spend context restating “give helpful advice.” | Paraphrases retrieve the relevant lesson; unrelated tasks get no invented personal rule; compare against no-memory baseline. Current lexical matching remains a limitation. |
| P0 / GB-09 | Distinguish current observations, confirmed rules, and inferred reasons. | An admin needs to know whether a recommendation reflects today's tenant, an old observation, or a human decision. | Evidence timestamps and scope visible; old inventory flagged; no invented rationale or cross-tenant reuse. A remembered observation triggers rechecking when freshness matters. |
| P0 / GB-10 | Rehearse an already broadly assigned policy before suggesting a pilot. | The mentor catches a targeting assumption that could defeat the admin's rollout plan. | A plan for all-users/all-devices assignments identifies that editing in place remains broad; requires an explicit targeting strategy. Pilot-named groups alone are insufficient evidence. |
| P1 / GB-11 | Build reusable, verified Graph read recipes with bounded fallbacks. | The admin avoids repeating endpoint, subtype-select, and paging mistakes. | Reproduce 400 and 403 handling, follow nextLink, state page limits, never substitute a write route or broader credential. See tenant-observations.md. |
| P1 / GB-12 | Make learning from an outcome easier without bypassing confirmation. | Corrections carry into the next task, and the admin does not need to reconstruct the previous incident. | After an outcome, propose one concise reusable lesson with source; admin confirms; later session changes its plan; correction/forgetting takes effect. |
| P1 / GB-13 | Measure useful advice per added context and interruption. | The product earns its cost when a small relevant reminder saves investigation or rework. | Paired tasks, measured provider usage where available, accepted/ignored advice, irrelevant-nudge rate, and documented limits. Recall bytes are not billing. |
| P1 / GB-14 | Offer a clear connection capability preview. | The admin knows why a production question cannot be answered before waiting for a failed call. | Show selected read capabilities and actual readiness; exact 403 diagnostics; no automatic permission escalation. Existing lab credentials do not certify minimum grants. |
| P2 / GB-15 | Improve Mac setup reopening and whole-app updates. | The local mentor feels dependable outside the terminal. | Reopen after closing a browser tab, consistent session lifecycle, signed complete-app update and rollback preserving data. The existing 0.1 download has manual updates. |

## Additional issues found in actual prompt responses

| ID | Observed issue | Priority and response |
| --- | --- | --- |
| GB-16 | Several answers strengthen a remembered requirement for helpdesk review into explicit approval. | P0: preserve the force and conditions of an admin's rule; show a short source quote beside the inferred plan. A retrieval success does not justify changing the rule. |
| GB-17 | Some cold-start answers prescribe numerical pilot sizes, blanket exclusions, or rollback actions without enough context. | P0: identify these as options requiring justification; rollback must reverse the actual change rather than assume assignment removal is correct. |
| GB-18 | Some answers confuse local memory confirmation/profile state with Intune policy activation or Graph tenant configuration. | P0: distinguish local memory controls, host context, and tenant state in tool descriptions and skill guidance; verify through actual installed-client conversations. |
| GB-19 | Some answers suggest ambiguous “report-only,” “audit mode,” or automatic rollout pauses without establishing what system provides them. | P0: name the specific available mechanism and evidence or describe a proposed manual checkpoint. Do not invent product capabilities. |
| GB-20 | Large memory collections require scrolling through the preferences group before reaching lessons. | P1: add search, type/status filters, and navigation between groups while preserving pagination and exact-content confirmation. |
| GB-21 | A lifecycle prompt may receive an invented conversational-confirmation exception when full skill lifecycle guidance is absent. | P0: make the local-confirmation contract visible in the tool context and verify it in natural client use. The 100-case harness limits are part of the diagnosis; separate skill-context rechecks retain the original failures. |

## Scoped recall gap reproduced separately

**P0 / GB-22:** A confirmed rule stored under `scope: devices` is not returned when the caller omits scope, even if the query matches exactly. Explicitly setting `scope: devices` returns it. This was reproduced through the actual MCP transport with an isolated synthetic record after the 100-prompt batch. The current boundary is intentional filtering; the product gap is reliable task-to-scope selection and visibility. Do not broaden scope silently or promise that the global-only 100-case fixtures cover scoped discovery. A useful next build needs bounded scope discovery or explicit scope-aware client guidance, plus cross-scope exception tests.

## What to resist

Do not add continuous model calls simply to make the product appear active. Do not describe generic good practice as knowledge of this administrator. Do not add a Greybeard label to advice that would be identical without it. Do not use a user's broad Lokka credentials as evidence that Greybeard's least-privilege connection is verified.

A useful repeat-use moment is: “Last time we excluded shared devices for a documented reason. Has that constraint changed?” The remembered rule must actually exist, apply to this environment, and remain subject to current evidence and the admin's decision.

## Release state

These improvements are source changes for review. The previously published 0.1 runtime and signed DMG are not silently replaced by this work. The installer's existing manual-update limitation still applies.
