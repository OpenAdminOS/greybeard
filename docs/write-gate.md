# Write Gate Protocol

Component: greybeard-graph MCP server
Status: Draft for implementation (revised after adversarial review)
Companion to: [greybeard-spec.md](../greybeard-spec.md), [mcp-tools.md](mcp-tools.md)

The gate is the reason greybeard-graph exists as its own server. This document is the implementation contract: invariants, tool contracts, state machine, token format, approval channels, error codes, threat model, and test cases.

## 1. Invariants

These hold under all conditions, including hostile prompts, malicious skills, and misbehaving clients.

1. The generic `graph` tool is read-only. It executes GET requests, plus `POST /$batch` only when every inner request is GET.
2. Tenant writes execute only through `execute-plan`, which replays operations stored server-side at plan time. The model never submits a write body at execution time.
3. A plan becomes executable only after a human approves it through a channel outside the MCP conversation (section 6).
4. No approval secret (nonce, approval URL, decision endpoint detail) is ever placed in tool results, progress notifications, error messages, log lines the client relays to the model, or any other model-visible channel, and none is written to disk.
5. The model can request plans, poll their status, and execute approved plans. It can never approve, modify, or extend one.
6. Approval authorizes exactly the stored operations. Deviation is impossible by construction: the server replays its own stored copy, byte for byte, with the sole exception of declared response references (section 7), which are shown to the human at approval time.
7. Plans and tokens are bound to one server process, single-use, short-lived, and held in memory only. Server restart voids all pending and approved plans.
8. The approval UI renders server-derived facts (verbs, paths, bodies, diffs, counts). The model's stated intent is shown, labeled as such, never as the only content.

### Scope of the guarantee (honest version)

The gate cannot be defeated from inside the MCP channel: no sequence of prompts, tool calls, or tool results reaches a write without a human decision. An agent that can execute arbitrary shell commands as the admin's user sits outside that boundary; for that adversary the mitigations in section 6 and the threat model raise the cost, and the client's own shell-permission prompts are the outer boundary. This residual risk is stated in the README, not hidden.

## 2. Actors and channels

| Actor | Role | Channel |
|---|---|---|
| Agent (model) | Requests plans, polls status, executes approved plans | MCP tools over stdio |
| greybeard-graph | Validates, stores, gates, replays, audits | Owns all gate state |
| Human admin | Approves or rejects plans | MCP elicitation (allowlisted clients) or localhost approval page |
| greybeard CLI | Opt-in approval terminal for browserless environments | Loopback HTTP to the server |

## 3. Tool contract

### 3.1 Credentials precondition

Write tokens are acquired under the workspace app registration created by `greybeard setup --writes` (spec: Consent model, Write credentials). If the active tenant has no writes app configured, `plan-write` fails at intake with `E_WRITES_NOT_CONFIGURED` and a pointer to `greybeard setup --writes`. The first-party Graph CLI app is never used for writes.

### 3.2 `plan-write`

Input:

```json
{
  "summary": "Disable sign-in for 3 offboarded users",
  "rollback": "PATCH accountEnabled=true for the same three users",
  "stopOnError": true,
  "operations": [
    {
      "method": "PATCH",
      "apiVersion": "beta",
      "path": "/users/9f2a.../",
      "body": { "accountEnabled": false },
      "reason": "User offboarded per ticket 4821"
    }
  ]
}
```

Validation at intake (before any approval channel opens):

- Writes app configured for the active tenant (section 3.1).
- `method` in POST, PATCH, PUT, DELETE. GET operations are rejected: reads need no plan.
- `apiVersion` defaults to `beta`; callers may set `v1.0` for a specific operation when stability matters.
- 1 to 50 operations per plan. Body size max 256 KB per operation.
- One plan pending per session at a time. A second `plan-write` while one is pending returns `E_PLAN_PENDING`.
- Response references (section 7) must point to earlier operations only.
- `summary`, `reason`, and `rollback` are required. They are the model's stated intent and are labeled as such in the approval UI.

Behavior: **non-blocking.** The server validates, stores the operations, opens the approval channel, and returns immediately:

```json
{ "status": "awaiting_approval", "planId": "gbp_7f3a91c2", "approvalDeadline": "2026-07-04T13:10:00Z" }
```

The outcome is obtained via `check-plan`. This design deliberately avoids a long-blocking tool call: MCP progress notifications may only be sent when the client provided a `progressToken`, and client tool timeouts vary, so a 600 s blocking call would be killed mid-review on some clients. If the client aborts or cancels the `plan-write` request anyway, plan state is unaffected; the plan remains AWAITING_APPROVAL until decided or timed out.

Optional pre-fetch: for PATCH operations the server performs its own ungated GET of the target resource and includes a current-value to new-value diff in the approval rendering. Controlled by `"prefetch": true` (default true); failures to pre-fetch degrade to showing the new values only, flagged as unverified.

### 3.3 `check-plan`

Input: `{ "planId": "gbp_7f3a91c2" }`

Behavior: if the plan is AWAITING_APPROVAL, the call long-polls up to 55 s (safely under common client timeouts) and returns the current state at decision or at the 55 s mark. The agent re-calls as needed; the `change-plan` skill instructs it to tell the admin an approval is pending rather than spin.

Results by state:

- Awaiting: `{ "status": "awaiting_approval", "approvalDeadline": ... }`
- Approved, first call: `{ "status": "approved", "token": "gbt_...", "expiresAt": ..., "operations": [ { "index": 0, "hash": "sha256:..." } ] }`. **The token is delivered exactly once.** Subsequent calls return `{ "status": "approved", "tokenDelivered": true }`; a lost token cannot be re-fetched, the plan expires unused and a new plan is required.
- Rejected: `{ "status": "rejected", "reason": "<human-entered text, may be empty>" }` (a result, not an error; the agent must read the reason).
- Timed out: `{ "status": "timed_out" }`
- Expired unexecuted: `{ "status": "expired" }`
- Executed: `{ "status": "completed" | "partial" | "failed" }` with the stored per-operation results.

### 3.4 `execute-plan`

Input: `{ "planId": "gbp_7f3a91c2", "token": "gbt_..." }`

The server verifies: token hash match (constant-time compare against the stored SHA-256), plan state APPROVED, TTL not lapsed. Then it replays the stored operations in order, resolving response references as it goes. Replay is sequential individual requests; the server does not use `$batch` internally in v1 (Graph batches cap at 20 inner requests, run parallel unless `dependsOn` chains them, and cannot resolve response references between inner requests).

Result:

```json
{
  "status": "completed | partial | failed",
  "results": [
    { "index": 0, "status": "success", "httpStatus": 204 },
    { "index": 1, "status": "failed", "httpStatus": 403, "error": "Authorization_RequestDenied", "missingScope": "Group.ReadWrite.All" }
  ]
}
```

- `stopOnError: true` (default): first failure halts remaining operations; their status is `skipped`.
- Response bodies are returned truncated to 4 KB per operation; enough for IDs and error detail, not bulk data.
- The token is consumed on the first `execute-plan` call regardless of outcome. Partial failures do not make the plan re-executable: recovering requires a new plan covering only the remaining operations. This is deliberate; retry-with-modification is exactly what the gate exists to force back through a human.

### 3.5 `graph` (read tool) gate behavior

- Any non-GET method: `E_WRITE_BLOCKED`, message pointing to `plan-write`.
- `POST /$batch`: the server parses the batch payload; if any inner request is non-GET, `E_WRITE_BLOCKED` naming the offending inner request IDs.

## 4. Plan lifecycle

```
plan-write called
   |  intake validation fails -> E_PLAN_INVALID / E_WRITES_NOT_CONFIGURED (no state created)
   v
AWAITING_APPROVAL  (plan-write returned; approval channel open; agent polls check-plan)
   |-- human approves -------> APPROVED  (token minted, TTL 300 s from approval)
   |-- human rejects --------> REJECTED  (terminal)
   |-- 600 s elapse ---------> TIMED_OUT (terminal)
   |-- server exits ---------> VOID      (terminal)

APPROVED
   |-- execute-plan (valid) -> EXECUTING -> COMPLETED | PARTIAL | FAILED (terminal)
   |-- 300 s elapse ---------> EXPIRED   (terminal; also if token was never picked up)
   |-- server exits ---------> VOID      (terminal)
```

All state is in server memory. Nothing about a plan persists across server restarts except the audit log (section 10).

## 5. Token specification

- Format: `gbt_` + 32 random bytes (CSPRNG), base64url, no padding.
- Storage: the server stores only `SHA-256(token)`; the plaintext exists in exactly one `check-plan` result and nowhere else. Comparison is constant-time.
- Binding: `{ planId, operation hashes, expiresAt }`, scoped to the server process (stdio has one client per process, so process lifetime is the session boundary; a `sessionId` UUID is minted at startup and recorded in the audit log so the binding survives a future move to a multi-session transport).
- Single-use: consumed by the first `execute-plan` call.
- TTL: 300 s from approval, regardless of when (or whether) the token was picked up via `check-plan`.
- Plan ID: `gbp_` + 8 hex chars, unique per server lifetime.

The model holding the token is safe by design: the token authorizes replay of the approved operations and nothing else. Operation hashes are `SHA-256(method + "\n" + apiVersion + "\n" + path + "\n" + JCS(body))` where JCS is RFC 8785 canonical JSON; hashes exist for the audit log and result correlation, not for execution-time matching, since execution replays stored copies.

## 6. Approval channels

Hard rule (invariant 4): approval secrets never enter a model-visible channel and are never written to disk. That constrains every channel below.

Selection order, first available wins:

1. **MCP elicitation - allowlisted clients only.** The MCP spec leaves elicitation presentation entirely to the client; there is no protocol guarantee a human answered. Elicitation is therefore used only for clients on a maintained allowlist, verified by an M7 smoke test to render elicitation as user-facing UI (initial allowlist: Claude Code). The server sends the rendered plan summary (section 9) with an approve/reject choice and optional reason field. Decline is a rejection: the human answered. Cancel (the third elicitation action) is not a decision: the plan stays AWAITING_APPROVAL, the server falls through to channel 2, and the 600 s deadline keeps running.
2. **Localhost approval page.** The server binds an HTTP listener to `127.0.0.1` on a random port and opens the default browser (`open` / `start` / `xdg-open`) at `http://127.0.0.1:<port>/plan/<planId>?k=<nonce>`.
   - The nonce is 128-bit random and valid for the plan's AWAITING_APPROVAL lifetime: the page may be loaded and reloaded with it, but the first accepted decision POST (which requires the nonce) invalidates it and closes the listener. Replayed or concurrent decision POSTs are refused.
   - The URL and nonce appear only in the `open` invocation and the browser. They are never returned to the agent, never written to any file, never logged. If the browser fails to open, the server writes a human-directed message to its own stderr (client log surface, not model context) and the plan simply waits for channel 3 or times out.
3. **`greybeard approve` (CLI) - opt-in.** Disabled by default; enabled with `gate.cliApprove: true` in Greybeard config for browserless environments (SSH boxes, servers). When enabled, the server additionally writes `<appdata>/greybeard/pending/<planId>.json` containing the rendered plan and the loopback port - **no nonce, mode 0600**. `greybeard approve` requires an interactive TTY, renders the plan, takes the decision from the keyboard, and POSTs it to a CLI-specific decision endpoint. Because any same-user process can imitate this flow, enabling it weakens the gate against an agent with shell access; the wizard says so when the flag is set, and the audit log records which channel decided every plan.

If no channel can be established at all (elicitation unsupported, listener bind fails, CLI channel disabled), `plan-write` returns `E_CHANNEL_UNAVAILABLE` and no plan state is kept.

## 7. Response references

Later operations may reference earlier operations' responses, for chains like create-then-configure:

```json
{ "method": "POST", "path": "/groups/{{op[0].response.body.id}}/members/$ref",
  "body": { "@odata.id": "https://graph.microsoft.com/beta/directoryObjects/{{op[0].response.body.ownerId}}" } }
```

Rules:

- Syntax: `{{op[<index>].response.body.<dotted path>}}`, allowed in `path` and in string values inside `body`. Nothing else is templated.
- References must point to a strictly earlier operation; validated at intake.
- The approval UI shows references verbatim, unexpanded, so the human sees exactly which values flow where.
- At execution, an unresolvable reference fails that operation with `E_REFERENCE_UNRESOLVED`; `stopOnError` applies.

## 8. Error codes

Rejection, timeout, and expiry are `check-plan` result statuses, not errors (section 3.3). Errors:

| Code | Meaning | Agent's correct next step |
|---|---|---|
| E_WRITE_BLOCKED | Write verb on `graph`, or batch with inner write | Call `plan-write` with the intended operations |
| E_WRITES_NOT_CONFIGURED | No writes app registration for the active tenant | Tell the admin to run `greybeard setup --writes` |
| E_PLAN_INVALID | Intake validation failed (detail in message) | Fix the plan structure and resubmit |
| E_PLAN_PENDING | Another plan is awaiting approval in this session | Poll `check-plan`; tell the admin a plan is pending |
| E_PLAN_NOT_FOUND | Unknown planId (includes plans voided by restart) | Nothing to retry; a new plan is required |
| E_CHANNEL_UNAVAILABLE | No approval channel could be established | Tell the admin to run `greybeard doctor` |
| E_TOKEN_INVALID | Unknown or malformed token | Nothing to retry; a new plan is required |
| E_TOKEN_EXPIRED | Approved but not executed within 300 s | New `plan-write`; tell the admin why |
| E_PLAN_ALREADY_EXECUTED | Token already consumed | Report results of the prior execution; new plan for anything further |
| E_REFERENCE_UNRESOLVED | A response reference had no value at execution | Per-operation failure; plan remainder per stopOnError |

Graph API errors during replay are reported per operation with status, Graph error code, and, for 403s, the mapped missing scope and consent URL (same mapping as the read path).

## 9. Approval rendering rules

The approval surface (elicitation text, browser page, CLI render) shows, in order:

1. Tenant domain and signed-in account, the credential the writes will run under (writes app name), client name, and session start time. The human must see whose tenant this touches and as what.
2. Operation list: verb badge, full path, API version. DELETE operations visually flagged as destructive and counted separately ("2 deletes, 3 patches").
3. Per-operation body. For PATCH with prefetch: current value vs new value per field. Response references verbatim.
4. The model's `summary`, `reason` per operation, and `rollback`, labeled "stated intent (model-provided)".
5. Approve and Reject controls, Reject with optional reason.

Anti-fatigue rule: the rendering never summarizes away operations. Fifty operations render as fifty lines. If that is painful, the plan is too big, and that friction is intentional.

## 10. Audit log

Append-only JSONL at `<appdata>/greybeard/audit/plans-YYYYMM.jsonl`. Events: plan created, decided (channel, decision, reason), executed (per-operation status codes and hashes). Records operation hashes, paths, verbs, tenant, account, sessionId, timestamps. Never records Graph response payloads (memory privacy rule applies here too) and never records nonces or tokens. Local only, never transmitted.

## 11. Threat model

| Threat | Mitigation |
|---|---|
| Prompt injection instructs the model to write directly | `graph` is read-only; writes have no path around `plan-write` (invariants 1 and 2) |
| Injection crafts a misleading plan summary | Approval UI leads with server-derived facts; model text is labeled stated intent (invariant 8) |
| Model alters operations after approval | Impossible: execution replays the server-stored copy (invariant 6) |
| Token replay or reuse | Single-use, 300 s TTL, process-bound, hashed at rest, constant-time compare |
| Approval secret leaks into model context | Invariant 4: nonce/URL never in tool results, notifications, errors, or files; browser-open and stderr only |
| Agent with shell/file tools hunts the nonce and self-approves | Nonce not on disk; pending file (opt-in CLI channel only) carries no nonce, mode 0600; CLI approve requires a TTY and is off by default; residual risk for an unrestricted-shell agent is real and stated (see Scope of the guarantee); client shell-permission prompts are the outer boundary; audit log records the deciding channel |
| Client auto-answers elicitation without a human | Elicitation used only on allowlisted clients whose rendering is smoke-tested as user-facing UI; all other clients get the browser page |
| Forged decision to the localhost listener | Loopback bind, 128-bit nonce required on GET and decision POST, first accepted decision invalidates the nonce and closes the listener |
| Write hidden inside a $batch | Server parses batch payloads; inner non-GETs are blocked (section 3.5) |
| Approval fatigue via many small plans | One pending plan per session; no-summarization rendering; count badges for destructive verbs |
| Server restart during pending plan | All state voids; audit log records creation without decision |

## 12. Test cases (implementation acceptance)

1. PATCH via `graph` returns E_WRITE_BLOCKED; same operation via plan-write + approval + execute-plan succeeds.
2. `$batch` with 10 GETs passes through `graph`; same batch with one inner PATCH returns E_WRITE_BLOCKED naming the inner request.
3. Approved plan, token used twice: second call returns E_PLAN_ALREADY_EXECUTED.
4. Approved plan, 301 s idle: execute-plan returns E_TOKEN_EXPIRED; check-plan reports status expired.
5. Pending plan, 601 s without decision: check-plan reports status timed_out; pending file (if CLI channel enabled) deleted.
6. Reject with reason on the browser page: check-plan returns status rejected with that reason.
7. Well-formed but unknown token presented to execute-plan: E_TOKEN_INVALID.
8. Second plan-write while one pending: E_PLAN_PENDING.
9. Response reference to a later operation: E_PLAN_INVALID at intake.
10. Reference path missing in the actual response: that operation fails E_REFERENCE_UNRESOLVED, subsequent ops skipped under stopOnError.
11. stopOnError false: failure at op 2 of 4 still executes ops 3 and 4; status partial.
12. Kill the server with a plan pending; restart; check-plan returns E_PLAN_NOT_FOUND and execute-plan with the old token returns E_TOKEN_INVALID; audit log shows created-without-decision.
13. Decision POST replayed with the same nonce after approval: refused, plan state unchanged, listener closed.
14. Page GET with the nonce, reload, then decision POST: reloads succeed while awaiting; decision succeeds once.
15. plan-write with no writes app configured: E_WRITES_NOT_CONFIGURED, no plan state created.
16. check-plan token delivery: first call after approval returns the token; second call returns tokenDelivered true and no token.
17. Elicitation cancel action: plan remains awaiting, browser channel opens, deadline unchanged.
18. Non-allowlisted client with elicitation capability: server skips elicitation and uses the browser page.
19. Inspect all tool results, notifications, and errors emitted across tests 1-18: no nonce or approval URL appears in any of them; no file under appdata contains a nonce.
