---
name: change-plan
description: Use when the user proposes tenant writes or asks to create, update, delete, assign, disable, remediate, grant, revoke, or execute Microsoft Graph changes.
---

# Change Plan

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

1. Call `get-auth-status` before any write planning tool.
2. If `signedIn` is false, tell the user to run `greybeard setup` and stop.
3. Read `entraP1`, `directoryRoles`, `directoryRolesStatus`, `credentialMode`, `gate.writesConfigured`, and `grantedScopes`. Treat `directoryRoles: null` as unknown, not as no roles. Warn up front when the requested write is likely license or role gated.
4. Never attempt writes with `graph`. The `graph` tool is read-only. Do not use `POST /$batch` for writes.
5. Determine the exact delegated write scopes for the operations. If any are missing, call `add-scope` before approval with a reason and, for bootstrap-only access, `leaseMinutes`. Stop on a consent handoff until setup/consent completes; the MCP transport can remain connected and will reload auth on the next call.
6. Build an operations list with `method`, `apiVersion`, `path`, `body`, and `reason` for each operation. Include `summary`, `rollback`, `requiredScopes`, and `stopOnError`.
7. Call `plan-write` once. The server must reject the plan before approval if its exact `requiredScopes` are unavailable.
8. If `plan-write` returns `E_WRITES_NOT_CONFIGURED`, tell the admin to run `greybeard setup --writes` and stop.
9. If `plan-write` returns `E_PLAN_PENDING`, call `check-plan` for the pending plan and tell the admin an approval is pending.
10. Poll `check-plan` with the returned `planId`. The server long-polls for up to 55 seconds. When it returns `awaiting_approval`, tell the admin a Greybeard approval is pending in their browser or approval UI, then call `check-plan` again. Do not spin silently.
11. On `approved`, call `execute-plan` exactly once with the token returned by `check-plan`. Execution must acquire the same scope set approved with the plan.
12. On `rejected`, report the human's reason and stop. Never resubmit an identical plan after rejection.
13. On `timed_out`, `expired`, `failed`, or `partial`, report the status and the next safe action. Any changed or remaining operations need a new plan.
14. After a temporary permission is no longer needed, call `remove-scope` with `confirm: true` and a cleanup reason. Report any tenant-side consent revocation still required.
15. After a completed plan, offer to record the reason through `tenant-decisions` using its Decision, Because, Decided, Revisit shape.

## Plan Shape

Use this model-visible plan input. The approval itself happens outside the model channel.

```json
{
  "summary": "Disable sign-in for 3 offboarded users",
  "rollback": "PATCH accountEnabled=true for the same three users",
  "requiredScopes": ["User.ReadWrite.All"],
  "stopOnError": true,
  "operations": [
    {
      "method": "PATCH",
      "apiVersion": "beta",
      "path": "/users/<id>",
      "body": { "accountEnabled": false },
      "reason": "User offboarded per ticket 4821"
    }
  ]
}
```

Rules:

- Use only `POST`, `PATCH`, `PUT`, or `DELETE` operations. Reads do not belong in a write plan.
- Keep plans small and reviewable. The server accepts at most 50 operations.
- Include rollback notes that a human can understand.
- Use response references only when an earlier operation creates an ID needed by a later operation.
- Do not include approval URLs, nonces, or tokens in user-visible text.

## Result Reporting

After `execute-plan`, report per operation:

```markdown
## Change Plan Result

Plan: <planId>
Status: <completed | partial | failed>

| Op | Method | Path | Result | HTTP | Detail |
|---:|---|---|---|---:|---|
| 0 | PATCH | `/users/<id>` | success | 204 | Sign-in disabled |

Rollback: <rollback from the plan>
Discipline: Requests made: <n>. Scopes used: <relevant scopes>. Scoping decisions: no direct graph writes, server-stored operations, single execute-plan call.
```

## Rejections

When `check-plan` returns:

```json
{ "status": "rejected", "reason": "Wrong user" }
```

Reply with the reason and stop. If the user asks to try again, build a materially changed plan that addresses the rejection.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.
