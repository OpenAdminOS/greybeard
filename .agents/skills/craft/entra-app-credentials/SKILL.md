---
name: entra-app-credentials
description: Use when the user asks about Entra app registrations, service principals, client secrets, certificates, federated identity credentials, GitHub OIDC, secret-to-OIDC migration, bootstrap permissions, or credential rollback.
---

# Entra App Credentials

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Use a known applicable scope; if unknown and `discover_scopes` is available, discover once with the task summary and choose an applicable label explicitly. Do not read every scope or bypass the selected environment. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, quote its operative words, and explain its effect. Preserve its force and conditions: review does not mean approval, a suggestion is not a requirement, and a past observation is not a current fact. Generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a local memory candidate even after conversational agreement. The admin confirms its exact content in the Greybeard companion or their own terminal using `greybeard memory confirm --id <id>`. Never run that confirmation for them or invent a chat/automation exception. Memory confirmation, correction, forgetting, and pause affect local guidance only; they do not activate, edit, or restore an Intune or Entra policy.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.
Never store secret values or tokens.

1. Call `get-auth-status` before any live Graph read or write plan.
2. Separate the application object from its tenant-local service principal. State which object each operation changes.
3. Prefer federated identity credentials over client secrets for supported workloads. For GitHub Actions, validate the exact issuer `https://token.actions.githubusercontent.com`, subject, and audience `api://AzureADTokenExchange` before planning writes.
4. Inventory working credentials before migration. Create and validate the replacement first; do not delete the last working credential.
5. Use explicit `apiVersion: "beta"` for all Graph requests. Verify the required endpoint behavior before presenting a working call.
6. Route every write through `change-plan`. Include exact `requiredScopes`, a rollback that preserves the current credential, and a validation checkpoint before removal.
Review permissions and revocation in the admin's existing Entra workflow. Greybeard 0.1 does not change registrations, credentials, or consent.
8. Never print or store a secret value after creation. If a secret is exposed, treat it as compromised and rotate it.

## Secret-to-OIDC Migration

Use this sequence:

1. Identify the workload, application object ID, service principal, current credential owners, and rollback owner.
2. Derive the exact federation tuple: issuer, subject, and audience. Match case and environment/ref semantics exactly.
3. Add the federated identity credential in a small approved plan using `Application.ReadWrite.All`.
4. Run a real workload authentication test and verify the token audience and subject claims.
5. Observe at least one successful production-equivalent run.
6. Remove the old secret in a separate approved plan only after validation. Roll back by restoring the previous workload configuration, not by deleting the new credential prematurely.
7. Release temporary Greybeard scopes and revoke residual tenant consent.

## Output

Return an object map, exact credential/federation values with secrets redacted, minimum delegated scopes, staged plan, validation evidence required between stages, rollback, and cleanup checklist.

Token discipline: After any live-tenant run, report requests made, scopes used, lease/cleanup state, and scoping decisions from the graph tool meta block.
