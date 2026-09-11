---
name: tenant-decisions
description: Use when the user asks why the tenant is configured a certain way, or wants to record the reason behind a configuration decision.
---

# Tenant Decisions

The tenant's institutional memory. Configuration shows what is set; decision records keep why it is set, so the reasoning survives staff changes and does not get relitigated every audit. If `greybeard-memory` tools are not available, tell the user to run `greybeard setup` and stop.

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, paraphrase the rule, and explain its effect. Preferences may be advice style or specific rollout rules; generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a candidate even after conversational agreement. Ask the admin to review and confirm it in local setup or `greybeard memory confirm --id <id>`. Never simulate that human confirmation or describe a candidate as confirmed.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

### Looking up a decision

1. On "why does..." or "why is..." questions about tenant configuration, call `recall` with the object and topic, for example `warehouse group MFA exclusion`.
2. Quote matching decision records verbatim, with their decided date. Do not paraphrase away the rationale.
3. If no record exists, say so plainly, answer from live configuration if a specialist skill can, and offer to record the reason once the admin states it.

### Recording a decision

1. Capture four fields from the admin: what was decided, why, when (default today), and when to revisit (optional).
2. Call `remember` with `type: "decision"` and this content shape:

```text
Decision: <what is configured and for whom>. Because: <the reason>. Decided: <YYYY-MM-DD>. Revisit: <YYYY-MM-DD or condition>.
```

3. Use display names, not GUIDs. A decision may name at most three object IDs when display names are ambiguous; the server rejects more as raw tenant output.
4. Link the decision to related memory nodes when the admin mentions them, and confirm back the stored record in one line.

### Reviewing decisions

On "what decisions have we recorded" or during an audit, call `list` with `type: "decision"` and present them newest first with decided and revisit dates. Flag records whose revisit date has passed.
