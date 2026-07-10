---
name: least-privilege-scopes
description: Use when the user needs minimum Microsoft Graph permissions, scope choices, admin-consent notes, over-permissioning review, or least-privilege access planning.
---

# Least Privilege Scopes

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

Read `references/scope-tables.md` before answering. Use it to choose the smallest delegated Microsoft Graph scope set, identify admin-consent requirements, and call out license or role gates that scopes do not solve.

Distinguish these values explicitly:

- Delegated scopes requested by a public client for a signed-in user.
- Application roles used by app-only credentials; never present them as delegated scopes.
- Configured permissions in an app registration's `requiredResourceAccess`.
- Scopes embedded in the current access token.
- Tenant consent grants stored on the service principal.
- Greybeard scope leases, which control future requests but do not by themselves revoke tenant consent.

Do not recommend `Directory.Read.All` for Greybeard v1 read paths unless the user explicitly accepts the tradeoff after seeing the narrower alternative. Writes must route through `change-plan` and require `greybeard setup --writes`.

When the admin settles on a scope set for a recurring task, `recall` for an equivalent memory, then record the choice with `remember` as `type: "preference"`, for example the accepted tradeoff or the scope set this tenant standardizes on.

## Output

Return:

- Minimal scopes.
- Why each scope is needed.
- Admin consent required: yes or no.
- Extra non-scope gates: Entra ID P1, Intune license, reporting role, or directory role.
- What to do on 403: use `add-scope` for the exact missing scope and relay the consent URL when `granted` is false.
- Cleanup: use a temporary lease for bootstrap access, then `remove-scope`; state whether an admin must also revoke tenant consent.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.
