---
name: handoff
description: Use when the user wants a handover summary, shift-change notes, or a paste-ready recap of what this session investigated and decided.
---

# Handoff

Ends a working session the way a careful admin ends a shift: the next person can pick up without re-deriving anything. Works from the current conversation alone; memory tools sharpen it when available.

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

1. Walk the session and collect: what was investigated, what was concluded, what was changed (with plan IDs when the write gate ran), and what is still open.
2. Ask the admin one question only if something essential is ambiguous: who the handoff is for, or whether an in-flight change is theirs to finish.
3. When `greybeard-memory` tools are available, persist anything durable before writing the notes: lasting configuration rationale goes to `remember` with `type: "decision"` in the tenant-decisions shape; confirmed working preferences go to `remember` as `preference`. Session-specific state stays in the notes only.
4. Emit the handover notes as one paste-ready markdown block. Never include secrets, tokens, approval URLs, or raw tenant data dumps; reference objects by display name.

## Output Template

```markdown
# Handoff - <date> <tenant domain if known>

## Done
- <investigation or change, outcome, plan ID if a write executed>

## Decided
- <decision and why; note which were recorded to memory>

## In Flight
- <started but unfinished, exact next step, who or what it waits on>

## Watch Out
- <known risk, pending propagation, revisit date>

## Suggested First Step
<the single next action for whoever picks this up>
```
