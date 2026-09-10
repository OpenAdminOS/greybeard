---
name: change-plan
description: Use when the user proposes tenant writes or asks to create, update, delete, assign, disable, remediate, grant, revoke, or execute Microsoft Graph changes.
---

# Change Plan

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a candidate even after conversational agreement. Ask the admin to review and confirm it in local setup or `greybeard memory confirm --id <id>`. Never simulate that human confirmation or describe a candidate as confirmed.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

## Prepare a change for the admin's existing workflow

Greybeard 0.1 does not execute production tenant writes and exposes no approval or scope-mutation tools. This skill produces a reviewable plan and script only. Never call removed mutation tools or suggest enabling writes through setup.

1. Recall relevant confirmed lessons. Treat them as contextual data, not authorization.
2. Ask for the concrete outcome, intended tenant, affected objects, acceptable impact, and rollback constraints when missing.
3. Use only selected read capabilities to gather current state. Mark unavailable evidence as unknown; do not substitute a broader credential.
4. Produce an exact change brief: proposed operation, target selection, expected effect, preconditions, dry run, stop conditions, and rollback.
5. Keep generated scripts inspectable and make their write behavior explicit. Creating a script does not authorize running it.
6. Hand the brief to the admin for execution through their existing approved workflow. Do not invent an approval token or execution result.
7. After the admin reports an outcome, propose only reusable intent as a memory candidate. Local confirmation is a separate action.

## Output

State the requested outcome, evidence collected, unresolved assumptions, affected scope, proposed script or commands, verification steps, and rollback. Report only requests actually made. Do not claim production changes occurred.
