---
name: graph-patterns
description: Use when the user needs Microsoft Graph mechanics, beta default behavior, explicit v1.0 pinning, pagination, batching, throttling, OData query design, or token-efficient call patterns.
version: 0.1.0
---

# Graph Patterns

Version: 0.1.0

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.

Read `references/graph-mechanics.md` before answering. Use it to design exact, low-waste Graph calls that default to beta, narrow fields, server-side filtering, safe pagination, and all-GET batching. Pin `apiVersion: "v1.0"` only for a specific call when API stability matters more than surface coverage.

When advising live Greybeard runs, route reads through `graph` and writes through `change-plan`. Do not suggest direct non-GET `graph` calls.

## Output

Return the recommended request shape, the reason for each query option, expected failure modes, and the token-discipline choices.

## CHANGELOG

- 0.1.1: Updated Graph guidance to use beta by default with explicit v1.0 pinning when stability matters.
- 0.1.0: Initial Graph mechanics reference skill.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.
