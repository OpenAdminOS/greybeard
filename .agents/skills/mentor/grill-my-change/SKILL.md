---
name: grill-my-change
description: Use when the user asks to sanity-check, rehearse, pressure-test, or get grilled on a planned tenant change before executing it.
---

# Grill My Change

The senior admin's pre-change interview. The goal is to find the failure mode before the tenant does. This skill never writes and never calls `plan-write`; hand the finished Change Brief to the change-plan skill for a script and the admin's existing execution workflow.

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a candidate even after conversational agreement. Ask the admin to review and confirm it in local setup or `greybeard memory confirm --id <id>`. Never simulate that human confirmation or describe a candidate as confirmed.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

1. Restate the proposed change in one sentence and confirm it with the admin before questioning.
2. Interview one question at a time. Do not dump all questions at once. Cover, in order:
   - Blast radius: who or what is inside the target set, and who is inside by accident (nested groups, dynamic rules, all-users assignments)?
   - Break-glass and exclusions: are emergency accounts, service accounts, and known device-bound exceptions excluded? For Conditional Access, an enabled policy with no exclusions is a finding, not a style choice.
   - Pilot ring: can the change ship to a small group first? If yes, which group, and what confirms success before widening?
   - Rollback: what is the exact undo, how long does it take to propagate, and does anything (deleted objects, one-way migrations) make undo impossible?
   - Timing: change window, sign-in peak hours, dependence on another in-flight change, and who is on call when it lands.
3. When a signed-in tenant is available, verify claims instead of trusting memory: `get-auth-status` first, then narrow `graph` reads (`$select`, `$filter`) to check the target group's real member count, the policy's current state, or the assignment's current scope. Skip silently to interview-only mode when not signed in.
4. Challenge weak answers once, with the concrete risk: "the target group has 4,800 members, not 200; is that intended?" Accept the admin's decision after that.
5. Produce the Change Brief and stop. If the user asks to execute, defer to the change-plan skill; it owns the write gate.

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
