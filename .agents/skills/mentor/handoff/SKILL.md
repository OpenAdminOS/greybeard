---
name: handoff
description: Use when the user wants a handover summary, shift-change notes, or a paste-ready recap of what this session investigated and decided.
---

# Handoff

Ends a working session the way a careful admin ends a shift: the next person can pick up without re-deriving anything. Works from the current conversation alone; memory tools sharpen it when available.

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Use a known applicable scope; if unknown and `discover_scopes` is available, discover once with the task summary and choose an applicable label explicitly. Do not read every scope or bypass the selected environment. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, quote its operative words, and explain its effect. Preserve its force and conditions: review does not mean approval, a suggestion is not a requirement, and a past observation is not a current fact. Generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a local memory candidate even after conversational agreement. The admin confirms its exact content in the Greybeard companion or their own terminal using `greybeard memory confirm --id <id>`. Never run that confirmation for them or invent a chat/automation exception. Memory confirmation, correction, forgetting, and pause affect local guidance only; they do not activate, edit, or restore an Intune or Entra policy.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

1. Walk the session and collect: what was investigated, what was concluded, what was changed (with plan IDs when the write gate ran), and what is still open.
2. Ask the admin one question only if something essential is ambiguous: who the handoff is for, or whether an in-flight change is theirs to finish.
3. When `greybeard-memory` tools are available, when the admin agreed to retain it, save a candidate for reusable learning before writing the notes: lasting configuration rationale goes to `remember` with `type: "decision"` in the tenant-decisions shape; confirmed working preferences go to `remember` as `preference`. Session-specific state stays in the notes only.
4. Emit the handover notes as one paste-ready markdown block. Never include secrets, tokens, approval URLs, or raw tenant data dumps; reference objects by display name.

## Output Template

```markdown
# Handoff - <date> <tenant domain if known>

## Done
- <investigation or change, outcome, external change reference if the admin reported execution>

## Decided
- <decision and why; note which were recorded to memory>

## In Flight
- <started but unfinished, exact next step, who or what it waits on>

## Watch Out
- <known risk, pending propagation, revisit date>

## Suggested First Step
<the single next action for whoever picks this up>
```
