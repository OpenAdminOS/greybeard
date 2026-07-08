---
name: learn-my-tenant
description: Use when the user wants Greybeard to learn the tenant, onboard a new environment, or seed memory with naming conventions, rings, break-glass accounts, and change windows.
version: 0.1.0
requires:
  servers: [greybeard-graph, greybeard-memory]
  scopes: [Organization.Read.All, Policy.Read.All, Group.Read.All, User.Read.All]
---

# Learn My Tenant

Version: 0.1.0

One-time onboarding that turns a fresh install into an experienced one: interview the admin, take a narrow read-only look at the tenant, and seed memory with the durable facts, preferences, and decisions a veteran of this environment would already know. If `greybeard-memory` tools are not available, tell the user to run `greybeard setup` and stop.

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

1. Call `get-auth-status` before any `graph` call. If `signedIn` is false, tell the user to run `greybeard setup` and stop.
2. Check for a prior run: call `recall` with `tenant environment bootstrap` and `list` with type `fact`. If earlier seeding exists, switch to refresh mode: summarize what is stored, ask what has changed, offer `forget` plus a fresh `remember` for stale entries, and skip everything still current.
3. Interview the admin in one batch, adapting follow-ups to their answers: naming conventions for groups, policies, and devices; ring or pilot structure; break-glass account names (names only, never credentials); change windows and freeze periods; known quirks and load-bearing legacy configuration.
4. Scan read-only with the narrowest reads: `/organization` with `$select`, `/domains`, `/subscribedSkus` with `$select=skuPartNumber,prepaidUnits,consumedUnits`, Conditional Access policy names via `$select=displayName,state`, and a group naming sample via `$top=20&$select=displayName`. Directory role holders and Intune structure are optional extras: fetch them only when the admin wants them, calling `add-scope` on the 403 with a one-line reason. If `granted` is false, relay the consent URL and continue without that data.
5. Synthesize candidate memories from the interview and the scan, and present them as one numbered list grouped by type, worded exactly as they would be stored, for the admin to confirm, edit, or drop. Interview answers count as explicitly confirmed; anything derived from the scan is inferred and always needs this confirmation.
6. Seed the confirmed items: durable environment structure as `type: "fact"`; the admin's working habits as `type: "preference"`; the rationale behind existing configuration as `type: "decision"` in the tenant-decisions shape (Decision, Because, Decided, Revisit). Before each `remember`, `recall` the topic and skip equivalents. Use display names, at most three object IDs per entry, never raw Graph output. Cap a run at 20 stored memories; prefer fewer, denser entries and offer a second pass instead of exceeding the cap.
7. Report one line per stored memory and note what was deliberately not stored and why.

## Output Template

```markdown
# Tenant Onboarding - <tenant domain>

## Stored
1. fact: <content as stored>
2. preference: <content as stored>

## Skipped
- <candidate>: <reason it was not stored>

## Suggested second pass
<areas the admin may want to teach next, or "none">
```

## CHANGELOG

- 0.1.0: Initial tenant onboarding and memory seeding skill.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.
