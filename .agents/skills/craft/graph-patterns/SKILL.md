---
name: graph-patterns
description: Use when the user needs Microsoft Graph mechanics, beta default behavior, explicit beta requests, pagination, batching, throttling, OData query design, or token-efficient call patterns.
---

# Graph Patterns

## Workflow

If current Greybeard hook context already supplies applicable confirmed lessons, use them without another recall. Otherwise, before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Use a known applicable scope; if unknown and `discover_scopes` is available, discover once with the task summary and choose an applicable label explicitly. Do not read every scope or bypass the selected environment. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, quote its operative words, and explain its effect. Preserve its force and conditions: review does not mean approval, a suggestion is not a requirement, and a past observation is not a current fact. Generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a local memory candidate even after conversational agreement. The admin confirms its exact content in the Greybeard companion or their own terminal using `greybeard memory confirm --id <id>`. Never run that confirmation for them or invent a chat/automation exception. Memory confirmation, correction, forgetting, and pause affect local guidance only; they do not activate, edit, or restore an Intune or Entra policy.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; propose a candidate without waiting for a request to remember it. Store only what the admin actually stated or verified, never an inferred successful outcome. The candidate remains inactive until exact human confirmation.

Read `references/graph-mechanics.md` before answering. Use it to design exact, low-waste Graph calls that default to beta, narrow fields, server-side filtering, safe pagination, and all-GET batching. Use explicit `apiVersion: "beta"` for every Greybeard Graph request.

When discovering delegated permissions on a service principal, prefer `publishedPermissionScopes` and fall back to `oauth2PermissionScopes` for compatibility with older response shapes. Do not confuse either property with application roles in `appRoles`.

When advising live Greybeard runs, route reads through `graph` and writes through `change-plan`. Do not suggest direct non-GET `graph` calls.

After the admin confirms a recommended call pattern works in their environment, `recall` for an equivalent query memory, then record it with `remember` as `type: "query"`: the endpoint, the query options, and why that shape was needed. Never store response payloads.

## Output

Return the recommended request shape, the reason for each query option, expected failure modes, and the token-discipline choices.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.

## Bounded tenant read recipes

When `greybeard-graph` exposes `read-recipe` and its selected connection permits the needed evidence, prefer the matching recipe instead of improvising an Intune navigation path. `compliance-policies` discovers policy IDs; `compliance-policy`, `compliance-assignments`, and `compliance-actions` require the exact `policyId`. `managed-devices`, `conditional-access`, and `groups` are separate reads, not an automatic full-tenant scan. Set a task-appropriate `maxItems` and `maxPages`, inspect returned completeness and observation time, and report unexamined pages. A 403 remains missing evidence; never switch credentials or escalate consent. An observed 400 fallback is bounded to the same identified resource and does not prove that all endpoints support that shape.
