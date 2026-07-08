---
name: least-privilege-scopes
description: Use when the user needs minimum Microsoft Graph permissions, scope choices, admin-consent notes, over-permissioning review, or least-privilege access planning.
version: 0.2.0
---

# Least Privilege Scopes

Version: 0.2.0

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.

Read `references/scope-tables.md` before answering. Use it to choose the smallest delegated Microsoft Graph scope set, identify admin-consent requirements, and call out license or role gates that scopes do not solve.

Do not recommend `Directory.Read.All` for Greybeard v1 read paths unless the user explicitly accepts the tradeoff after seeing the narrower alternative. Writes must route through `change-plan` and require `greybeard setup --writes`.

## Output

Return:

- Minimal scopes.
- Why each scope is needed.
- Admin consent required: yes or no.
- Extra non-scope gates: Entra ID P1, Intune license, reporting role, or directory role.
- What to do on 403: use `add-scope` for the exact missing scope and relay the consent URL when `granted` is false.

## CHANGELOG

- 0.2.0: Moved into the craft category.
- 0.1.0: Initial least-privilege scope reference skill.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.
