---
name: graph-patterns
description: Use when the user needs Microsoft Graph mechanics, beta default behavior, explicit v1.0 pinning, pagination, batching, throttling, OData query design, or token-efficient call patterns.
---

# Graph Patterns

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

Read `references/graph-mechanics.md` before answering. Use it to design exact, low-waste Graph calls that default to beta, narrow fields, server-side filtering, safe pagination, and all-GET batching. Pin `apiVersion: "v1.0"` for stable app-registration, service-principal, OAuth grant, and federated-credential APIs unless a required property is beta-only.

When discovering delegated permissions on a service principal, prefer `publishedPermissionScopes` and fall back to `oauth2PermissionScopes` for compatibility with older response shapes. Do not confuse either property with application roles in `appRoles`.

When advising live Greybeard runs, route reads through `graph` and writes through `change-plan`. Do not suggest direct non-GET `graph` calls.

After the admin confirms a recommended call pattern works in their environment, `recall` for an equivalent query memory, then record it with `remember` as `type: "query"`: the endpoint, the query options, and why that shape was needed. Never store response payloads.

## Output

Return the recommended request shape, the reason for each query option, expected failure modes, and the token-discipline choices.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.
