---
name: least-privilege-scopes
description: Use when the user needs minimum Microsoft Graph permissions, scope choices, admin-consent notes, over-permissioning review, or least-privilege access planning.
---

# Least Privilege Scopes

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, paraphrase the rule, and explain its effect. Preferences may be advice style or specific rollout rules; generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a candidate even after conversational agreement. Ask the admin to review and confirm it in local setup or `greybeard memory confirm --id <id>`. Never simulate that human confirmation or describe a candidate as confirmed.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

Read `references/scope-tables.md` before answering. Identify the specific capability and distinguish the planned Application permission from permissions actually verified on the active connection.

The optional Greybeard 0.1 tenant connection uses a customer-owned app-only registration. No permissions are selected by default. Do not recommend broad directory access to make a probe succeed. A successful read using a broadly granted token does not demonstrate minimum permissions.

Report the requested capability, candidate role, endpoint and selected fields, the evidence obtained, missing evidence, and any license or other access constraints that were actually verified. Do not infer a missing permission solely from a generic 403. Read the error and distinguish permission, licensing, service availability, and query failures.

Consent and configuration are changed by the administrator in their existing Entra workflow. Greybeard 0.1 exposes no scope mutation or production write tools. It leaves a profile inactive when token roles exceed the selected capability set. Checkboxes do not narrow pre-existing tenant grants.

After the admin chooses a recurring access policy, propose reusable intent as a memory candidate. Confirmation remains a separate local action. Report only live requests actually made; never claim a candidate mapping was validated without isolated evidence.
