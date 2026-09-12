---
name: kql-authoring
description: Use when the user asks to write, tune, explain, debug, optimize, or convert KQL for Intune device query, Log Analytics, Sentinel, sign-in, audit, or compliance data.
---

# KQL Authoring

## Workflow

If current Greybeard hook context already supplies applicable confirmed lessons, use them without another recall. Otherwise, before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Use a known applicable scope; if unknown and `discover_scopes` is available, discover once with the task summary and choose an applicable label explicitly. Do not read every scope or bypass the selected environment. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, quote its operative words, and explain its effect. Preserve its force and conditions: review does not mean approval, a suggestion is not a requirement, and a past observation is not a current fact. Generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a local memory candidate even after conversational agreement. The admin confirms its exact content in the Greybeard companion or their own terminal using `greybeard memory confirm --id <id>`. Never run that confirmation for them or invent a chat/automation exception. Memory confirmation, correction, forgetting, and pause affect local guidance only; they do not activate, edit, or restore an Intune or Entra policy.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; propose a candidate without waiting for a request to remember it. Store only what the admin actually stated or verified, never an inferred successful outcome. The candidate remains inactive until exact human confirmation.

1. Identify whether the target is Intune device query, Log Analytics, Sentinel, sign-in logs, audit logs, or compliance reporting.
2. Read `references/table-cheatsheets.md` when table or column choices matter.
3. Apply the tuned-query checklist:
   - Put the time filter first.
   - Filter high-cardinality columns before expensive parsing.
   - `project` early to keep only needed columns.
   - Parse dynamic JSON only after narrowing rows.
   - `summarize` late, after filters and projections.
   - Add `order by` and `take` only at the end.
4. Prefer readable KQL with named `let` blocks for time windows and thresholds.
5. Return runnable KQL plus a short explanation of the table choice and performance decisions.
6. After the admin confirms the query returns what they need, `recall` for an equivalent query memory, then record the pattern with `remember` as `type: "query"`: the target table, the filters that mattered, and why. Never store query results.

## Intune Device Query

For Intune device query, keep syntax simple and device-focused. Use short projections and avoid Sentinel-only operators unless the user says the query runs in Log Analytics or Sentinel.

## Output

Return:

- A fenced `kusto` query.
- Parameters to change, such as lookback window or threshold.
- Assumptions about tables.
- Tuning notes.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.
