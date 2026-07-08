---
name: kql-authoring
description: Use when the user asks to write, tune, explain, debug, optimize, or convert KQL for Intune device query, Log Analytics, Sentinel, sign-in, audit, or compliance data.
version: 0.2.0
---

# KQL Authoring

Version: 0.2.0

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.

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

## Intune Device Query

For Intune device query, keep syntax simple and device-focused. Use short projections and avoid Sentinel-only operators unless the user says the query runs in Log Analytics or Sentinel.

## Output

Return:

- A fenced `kusto` query.
- Parameters to change, such as lookback window or threshold.
- Assumptions about tables.
- Tuning notes.

## CHANGELOG

- 0.2.0: Moved into the craft category.
- 0.1.0: Initial KQL authoring skill with Intune and Log Analytics guidance.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.
