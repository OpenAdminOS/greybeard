---
name: diagnose
description: Use when the user reports something broken, failing, or misbehaving in the tenant and needs structured incident triage.
---

# Diagnose

Hypothesis-driven triage for "users cannot sign in", "the device will not comply", "the app stopped working". The discipline: one hypothesis at a time, tested with the narrowest read that can falsify it, instead of dragging the tenant into context and hoping.

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Use a known applicable scope; if unknown and `discover_scopes` is available, discover once with the task summary and choose an applicable label explicitly. Do not read every scope or bypass the selected environment. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, quote its operative words, and explain its effect. Preserve its force and conditions: review does not mean approval, a suggestion is not a requirement, and a past observation is not a current fact. Generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a local memory candidate even after conversational agreement. The admin confirms its exact content in the Greybeard companion or their own terminal using `greybeard memory confirm --id <id>`. Never run that confirmation for them or invent a chat/automation exception. Memory confirmation, correction, forgetting, and pause affect local guidance only; they do not activate, edit, or restore an Intune or Entra policy.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

1. Call `get-auth-status` before any `graph` call. If `signedIn` is false, tell the user to run `greybeard setup` and stop.
2. Pin down the symptom first: who or what is affected, since when, what changed recently, and one concrete failing example (a user, a device, an app). Ask only for what the admin has not already said.
3. State the top two or three hypotheses, ranked by likelihood, before making any call. Name the single read that would falsify the first one.
4. Test one hypothesis at a time with the narrowest possible read: a single object by id before a collection, `$select` on the fields the hypothesis needs, `$filter` on the failing example, `$top` when sampling. Never fetch a whole collection to inspect one member.
5. After each read, say what the result confirms or rules out, then move to the next hypothesis. Stop as soon as one is confirmed; do not keep reading for completeness.
6. If access is unavailable, report the exact endpoint and error. Ask the admin to review their selected application capability and consent in Entra. Greybeard 0.1 does not request or grant additional permissions.
7. Report the finding: root cause, evidence, and the fix. Any fix that writes to the tenant routes through the change-plan skill; offer to record the root cause with the tenant-decisions skill when it explains a lasting configuration choice.
8. When the admin confirms the root cause and it is likely to recur, `recall` for an equivalent fact, then record the symptom-to-cause pattern with `remember` as `type: "fact"`, include the reported incident date and the specific cause found in that incident; do not turn one incident into a claim about the usual cause. Use display names, never raw log output.

## Output Template

```markdown
# Diagnosis - <symptom>

## Root Cause
<confirmed cause, or the strongest remaining hypothesis labeled as unconfirmed>

## Evidence
1. <read made and what it showed>

## Ruled Out
- <hypothesis>: <what ruled it out>

## Fix
<the change to make; if it writes, run it through change-plan>
```

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.
