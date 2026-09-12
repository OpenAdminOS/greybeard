---
name: grill-my-change
description: Use when the user asks to sanity-check, rehearse, pressure-test, or get grilled on a planned tenant change before executing it.
---

# Grill My Change

The senior admin's pre-change interview. The goal is to find the failure mode before the tenant does. This skill never writes and never calls `plan-write`; hand the finished Change Brief to the change-plan skill for a script and the admin's existing execution workflow.

## Workflow

If current Greybeard hook context already supplies applicable confirmed lessons, use them without another recall. Otherwise, before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Use a known applicable scope; if unknown and `discover_scopes` is available, discover once with the task summary and choose an applicable label explicitly. Do not read every scope or bypass the selected environment. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, quote its operative words, and explain its effect. Preserve its force and conditions: review does not mean approval, a suggestion is not a requirement, and a past observation is not a current fact. Generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a local memory candidate even after conversational agreement. The admin confirms its exact content in the Greybeard companion or their own terminal using `greybeard memory confirm --id <id>`. Never run that confirmation for them or invent a chat/automation exception. Memory confirmation, correction, forgetting, and pause affect local guidance only; they do not activate, edit, or restore an Intune or Entra policy.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; propose a candidate without waiting for a request to remember it. Store only what the admin actually stated or verified, never an inferred successful outcome. The candidate remains inactive until exact human confirmation.

1. Restate the proposed change in one sentence and confirm it with the admin before questioning.
2. Interview one question at a time. Do not dump all questions at once. Cover, in order:
   - Blast radius: who or what is inside the target set, and who is inside by accident (nested groups, dynamic rules, all-users assignments)?
   - Exceptions: which emergency access or device constraints are relevant to this particular control? Establish the reason and compensating controls before proposing exclusions; do not invent blanket exemptions.
   - Pilot ring: are current assignments already all users or all devices? Editing that policy remains broad. Require an explicit targeting transition or a separate policy option that accounts for overlap with the original. Verify actual group membership before calling it a pilot; a name is insufficient.
   - Rollback: what is the exact undo, how long does it take to propagate, and does anything (deleted objects, one-way migrations) make undo impossible?
   - Timing: change window, sign-in peak hours, dependence on another in-flight change, and who is on call when it lands.
3. When a selected tenant connection is available, verify claims instead of trusting memory: `get-auth-status` first, then narrow `graph` reads (`$select`, `$filter`) to check the target group's real member count, the policy's current state, or the assignment's current scope. State that tenant evidence is unavailable and continue with the facts the admin supplied.
4. Challenge weak answers once, with the concrete risk: "the target group has 4,800 members, not 200; is that intended?" Accept the admin's decision after that.
5. Preserve exact remembered wording and obligation strength. Mark unverified pilot sizes and timelines as proposals. Name the actual mechanism behind audit/report-only/automatic-stop claims; otherwise describe manual checkpoints. Rollback reverses the real change, not a generic assignment removal.
6. Produce the Change Brief and stop. If the user asks to execute, defer to the change-plan skill; it owns the write gate.

## Output Template

```markdown
# Change Brief - <one-line change>

Proposed by: <admin>
Reviewed: <date>

## Change
<what changes, exact objects and settings>

## Blast Radius
<who is affected, verified counts where read>

## Exclusions And Break-Glass
<what is excluded and why; findings if nothing is>

## Pilot
<pilot ring, success signal, widening plan, or "none" with the accepted risk>

## Rollback
<exact undo steps and propagation time, or what cannot be undone>

## Timing
<window, dependencies, on-call>

## Open Risks
1. <risk the interview could not close>

Next step: run this through change-plan for staged execution with human approval.
```

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.
