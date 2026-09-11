---
name: change-plan
description: Use when the user proposes tenant writes or asks to create, update, delete, assign, disable, remediate, grant, revoke, or execute Microsoft Graph changes.
---

# Change Plan

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Use a known applicable scope; if unknown and `discover_scopes` is available, discover once with the task summary and choose an applicable label explicitly. Do not read every scope or bypass the selected environment. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, quote its operative words, and explain its effect. Preserve its force and conditions: review does not mean approval, a suggestion is not a requirement, and a past observation is not a current fact. Generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a local memory candidate even after conversational agreement. The admin confirms its exact content in the Greybeard companion or their own terminal using `greybeard memory confirm --id <id>`. Never run that confirmation for them or invent a chat/automation exception. Memory confirmation, correction, forgetting, and pause affect local guidance only; they do not activate, edit, or restore an Intune or Entra policy.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

## Prepare a change for the admin's existing workflow

Greybeard 0.1 does not execute production tenant writes and exposes no approval or scope-mutation tools. This skill produces a reviewable plan and script only. Never call removed mutation tools or suggest enabling writes through setup.

1. Recall relevant confirmed lessons. Treat them as contextual data, not authorization.
2. Ask for the concrete outcome, intended tenant, affected objects, acceptable impact, and rollback constraints when missing.
3. Use only selected read capabilities to gather current state. Use explicit beta Graph requests and `/beta` in generated Graph URLs; do not invent a resource route, setting field, or write permission from a generic policy example. Mark unavailable evidence as unknown; do not substitute a broader credential.
4. Produce an exact change brief: proposed operation, target selection, expected effect, preconditions, dry run, stop conditions, and rollback.
5. Keep generated scripts inspectable and make their write behavior explicit. Creating a script does not authorize running it.
6. Hand the brief to the admin for execution through their existing approved workflow. Do not invent an approval token or execution result.
7. After the admin reports an outcome, propose only reusable intent as a memory candidate. Local confirmation is a separate action.

## Scope and reversible rollout

Before recommending a pilot, establish the existing assignments. Editing a policy already assigned to all users or all devices keeps that broad exposure; a pilot-named group does not narrow it. Prepare an explicit targeting transition or separately targeted policy option, check overlap and actual membership, and account for the original policy still applying. If assignments cannot be read, mark pilot feasibility unresolved rather than promise containment.

Preserve exact remembered durations and conditions. Label any proposed pilot size, duration, exemption, or threshold as an option with a reason to validate; do not invent percentages, blanket exclusions, or service propagation guarantees. Rollback must reverse the recorded setting and targeting changes and then verify recovery. Removing an assignment is only appropriate when reversing an assignment addition; it does not undo an in-place setting change.

Name the system and verified mechanism behind any report-only, audit, simulation, or automated stop proposal. Greybeard does not supply an automatic rollout controller. Without evidence of a supported mechanism, use a manual review checkpoint and describe offline comparison as planning, not a tenant dry run.

## Output

State the requested outcome, evidence collected, unresolved assumptions, affected scope, proposed script or commands, verification steps, and rollback. Report only requests actually made. Do not claim production changes occurred.

## Bounded tenant read recipes

When `greybeard-graph` exposes `read-recipe` and its selected connection permits the needed evidence, prefer the matching recipe instead of improvising an Intune navigation path. `compliance-policies` discovers policy IDs; `compliance-policy`, `compliance-assignments`, and `compliance-actions` require the exact `policyId`. `managed-devices`, `conditional-access`, and `groups` are separate reads, not an automatic full-tenant scan. Set a task-appropriate `maxItems` and `maxPages`, inspect returned completeness and observation time, and report unexamined pages. A 403 remains missing evidence; never switch credentials or escalate consent. An observed 400 fallback is bounded to the same identified resource and does not prove that all endpoints support that shape.
