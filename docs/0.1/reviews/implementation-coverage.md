# Recommendation implementation coverage

Every recommendation has a corresponding source implementation. This ledger distinguishes implemented behavior from external verification and release availability. The existing published 0.1 downloads are unchanged.

| ID | Implemented behavior | Evidence / limits |
| --- | --- | --- |
| GB-01 | Oversized recall budget clamps instead of schema retry. | MCP regression retained. |
| GB-02 | Explicit serialized UTF-8 bytes, deprecated token aliases. | Contract tests; no billing claims. |
| GB-03 | Pausing suppresses recall and proposals. | Service and actual companion tests. |
| GB-04 | Linked memory provenance retained. | SQL/MCP regression retained. |
| GB-05 | Typed preferences versus lessons, searchable type navigation. | Companion filters and record metadata. |
| GB-06 | Source ID, exact text, evidence kind, retrieval attribution. | Skill contracts and natural Codex evaluations. |
| GB-07 | Generated installed-client memory contract, Claude Code context fallback, scope discovery guidance. | Fresh natural Codex conversations saved under evaluations/next-build. Claude MCP connects; model verification blocked by expired Claude OAuth session. |
| GB-08 | Task overlap ranks ahead of generic preference boosts; bounded vocabulary expansion; boilerplate suppression. | Memory relevance regressions. Lexical expansion is not semantic embedding search. |
| GB-09 | Evidence kind, observation time, age and recheck requirement; unknown historical dates remain unknown. | Schema migration, recall tests and companion evidence fields. |
| GB-10 | Planning detects all-user/all-device assignments and requires a containment strategy before an in-place change. | Live lab assignments verified through Lokka; actual natural host response. |
| GB-11 | Seven beta Graph read recipes with bounded paging, completeness and narrow fallback reporting. | Graph tests plus 15 live read-only Lokka requests, including actual 400/403 responses. |
| GB-12 | Outcome proposals store reported outcome separately from reusable lesson. | MCP/service tests and actual companion proposal flow. Confirmation stays local. |
| GB-13 | Bounded retrieval events, returned memory references, explicit useful/ignored/irrelevant ratings, aggregate context-byte metrics. | Service/API/UI checks. Provider usage remains captured by the evaluation harness when supplied, not invented by the app. |
| GB-14 | Selected permissions and explicit readiness probes with precise authentication/endpoint diagnostics. | Live responses plus preview tests. Isolated minimum-grant certification needs a dedicated appropriately scoped registration. |
| GB-15 | Desktop lifecycle, Mac reactivation, complete signed-app updater, backup before installation, manual previous-app recovery. | Actual Electron close/reopen test, updater/recovery tests and platform build workflow. Public anonymous updates remain blocked by private release-feed access. Signed release and real upgrade verification are separate from unsigned candidate builds. |
| GB-16 | Exact rule quotes and preservation of review versus approval. | Installed guidance and natural Codex response reviews. Host compliance cannot be universally guaranteed. |
| GB-17 | No invented numerical pilot sizes or blanket exclusions; rollback derived from actual change. | Planning/rehearsal guidance and response reviews. |
| GB-18 | Tool and skill descriptions distinguish local memory, client context and live tenant state. | Actual lifecycle prompts and service confirmation boundary. |
| GB-19 | Name and verify actual report-only/audit/automation mechanisms, otherwise propose a manual checkpoint. | Planning/diagnostic guidance and response reviews. |
| GB-20 | Database search before pagination, type/status/exact-scope filters, persistent navigation and bounded pages. | Actual 65-record Electron search retrieves the oldest matching record. |
| GB-21 | Explicit prohibition of chatbot confirmation exceptions in MCP tools and installed context. | Confirmation absent from MCP; exact-content/revision local endpoint checks; natural host lifecycle response. |
| GB-22 | Bounded paginated discover_scopes, followed by explicit chosen-scope recall; default scope not silently widened. | Actual MCP transport, tenant isolation tests and natural scoped prompt. |

## Additional product work

The companion provides native window lifecycle and file/export dialogs, manual memory addition, observation/inference metadata, correction review, deletion, outcome learning, pause/resume, local versus connected-tenant selection, connection readiness, install diagnostics, context metrics and update preferences. Its renderer is isolated from Node and the narrow IPC methods validate their sender. The loopback API enforces session, Origin and Host checks.

Windows credentials now have a protected reader with owner/ACL and same-handle checks instead of a blanket platform refusal. Windows-specific CI tests verify both permitted and rejected files. Existing client integrations also gained corrections for Codex and Cursor configuration paths so removing an integration preserves authentication and edits the actual MCP configuration.

## Product value

An admin should miss Greybeard when a remembered exception, correction or past outcome changes the next decision. The implementation supports that sequence directly: propose a specific lesson, confirm it, retrieve it in a fresh relevant session, show its exact wording and scope, and carry a correction forward. Generic advice and a successful tool call alone do not establish value.

No continuous model process was added. The companion is a local application; the selected AI tool supplies reasoning and provider billing. Only applicable confirmed memories are eligible for recall, and local activity feedback measures usefulness without claiming that retrieval equals application of advice.
