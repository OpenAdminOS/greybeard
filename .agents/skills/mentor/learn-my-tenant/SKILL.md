---
name: learn-my-tenant
description: Use when the user wants Greybeard to learn the tenant, onboard a new environment, or seed memory with naming conventions, rings, break-glass accounts, and change windows.
---

# Learn My Tenant

Onboarding that starts building useful local context: interview the admin, take a narrow read-only look at the tenant, and seed memory with the durable facts, preferences, and decisions a veteran of this environment would already know. If `greybeard-memory` tools are not available, tell the user to run `greybeard setup` and stop.

## Workflow

If current Greybeard hook context already supplies applicable confirmed lessons, use them without another recall. Otherwise, before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Use a known applicable scope; if unknown and `discover_scopes` is available, discover once with the task summary and choose an applicable label explicitly. Do not read every scope or bypass the selected environment. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, quote its operative words, and explain its effect. Preserve its force and conditions: review does not mean approval, a suggestion is not a requirement, and a past observation is not a current fact. Generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a local memory candidate even after conversational agreement. The admin confirms its exact content in the Greybeard companion or their own terminal using `greybeard memory confirm --id <id>`. Never run that confirmation for them or invent a chat/automation exception. Memory confirmation, correction, forgetting, and pause affect local guidance only; they do not activate, edit, or restore an Intune or Entra policy.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; propose a candidate without waiting for a request to remember it. Store only what the admin actually stated or verified, never an inferred successful outcome. The candidate remains inactive until exact human confirmation.

1. An interview can run without a tenant connection. Before live reads, call `get-auth-status`; when access is unavailable, state that observations are unverified and continue the interview without claiming a tenant scan.
2. Check for a prior run: call `recall` with `tenant environment bootstrap` and `list` with type `fact`. If earlier seeding exists, switch to refresh mode: summarize what is stored, ask what has changed, offer a correction candidate that supersedes the old entry only after local confirmation, and skip everything still current.
3. Interview the admin in one batch, adapting follow-ups to their answers: naming conventions for groups, policies, and devices; ring or pilot structure; break-glass account names (names only, never credentials); change windows and freeze periods; known quirks and load-bearing legacy configuration.
4. Scan only selected read capabilities with explicit beta requests, narrow fields, and bounded pages. If another endpoint is required, explain that it is outside the current connection and ask for admin-provided evidence; do not request additional permissions automatically.
5. Synthesize candidate memories from the interview and the scan, and present them as one numbered list grouped by type, worded exactly as they would be stored, for the admin to confirm, edit, or drop. Interview answers can authorize saving candidates; they do not confirm records for recall. Distinguish observed facts with timestamps from inferred explanations, and never invent a rationale. Every saved candidate needs the admin's separate local confirmation.
6. Save the agreed candidates: durable environment structure as `type: "fact"`; the admin's working habits as `type: "preference"`; the rationale behind existing configuration as `type: "decision"` in the tenant-decisions shape (Decision, Because, Decided, Revisit). Before each `remember`, `recall` the topic and skip equivalents. Use display names, at most three object IDs per entry, never raw Graph output. Cap a run at 20 stored memories; prefer fewer, denser entries and offer a second pass instead of exceeding the cap.
7. Report the candidate ID, pending confirmation status, and source for each saved memory and note what was deliberately not stored and why.

## Output Template

```markdown
# Tenant Onboarding - <tenant domain>

## Awaiting local review
1. candidate <id>, fact: <exact content and source>
2. candidate <id>, preference: <exact content and source>

## Skipped
- <candidate>: <reason it was not stored>

## Suggested second pass
<areas the admin may want to teach next, or "none">
```

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.
