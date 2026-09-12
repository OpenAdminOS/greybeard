---
name: least-privilege-scopes
description: Use when the user needs minimum Microsoft Graph permissions, scope choices, admin-consent notes, over-permissioning review, or least-privilege access planning.
---

# Least Privilege Scopes

## Workflow

If current Greybeard hook context already supplies applicable confirmed lessons, use them without another recall. Otherwise, before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Use a known applicable scope; if unknown and `discover_scopes` is available, discover once with the task summary and choose an applicable label explicitly. Do not read every scope or bypass the selected environment. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, quote its operative words, and explain its effect. Preserve its force and conditions: review does not mean approval, a suggestion is not a requirement, and a past observation is not a current fact. Generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a local memory candidate even after conversational agreement. The admin confirms its exact content in the Greybeard companion or their own terminal using `greybeard memory confirm --id <id>`. Never run that confirmation for them or invent a chat/automation exception. Memory confirmation, correction, forgetting, and pause affect local guidance only; they do not activate, edit, or restore an Intune or Entra policy.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; propose a candidate without waiting for a request to remember it. Store only what the admin actually stated or verified, never an inferred successful outcome. The candidate remains inactive until exact human confirmation.

Read `references/scope-tables.md` before answering. Identify the specific capability and distinguish the planned Application permission from permissions actually verified on the active connection.

The optional Greybeard 0.1 tenant connection uses a customer-owned app-only registration. No permissions are selected by default. Do not recommend broad directory access to make a probe succeed. A successful read using a broadly granted token does not demonstrate minimum permissions.

Report the requested capability, candidate role, endpoint and selected fields, the evidence obtained, missing evidence, and any license or other access constraints that were actually verified. Do not infer a missing permission solely from a generic 403. Read the error and distinguish permission, licensing, service availability, and query failures.

Consent and configuration are changed by the administrator in their existing Entra workflow. Greybeard 0.1 exposes no scope mutation or production write tools. It leaves a profile inactive when token roles exceed the selected capability set. Checkboxes do not narrow pre-existing tenant grants.

After the admin chooses a recurring access policy, propose reusable intent as a memory candidate. Confirmation remains a separate local action. Report only live requests actually made; never claim a candidate mapping was validated without isolated evidence.
