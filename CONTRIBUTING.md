# Contributing

Greybeard accepts two kinds of work:

- Build: new skills, MCP server capabilities, CLI adapters, installers, and release plumbing.
- Contribute: improve existing skills, add references, tighten tests, fix docs, and harden edge cases.

Keep changes small and testable. The local gate is:

```sh
npm run ci
```

## Skill Authoring Rules

Skills live under `.agents/skills/<category>/<skill-name>/`. The categories are:

- `read/`: live-tenant analysis and reporting skills.
- `write/`: skills that stage tenant changes through the write gate.
- `craft/`: authoring skills for scripts, queries, and Graph mechanics that work without a signed-in tenant.
- `mentor/`: process skills that interview, triage, record decisions, or hand work over.

Required layout:

```text
.agents/skills/<category>/<skill-name>/
├── SKILL.md
├── test.md
├── references/
└── scripts/
```

`references/` and `scripts/` are optional directories, but use them when a skill needs deeper material. Keep `SKILL.md` concise. The agent should load extra files only when the skill says to.

Skill folder names must be unique across all categories. Clients link each skill by its folder name, without the category, so two categories cannot both contain a skill with the same name.

Required `SKILL.md` frontmatter:

```yaml
---
name: skill-name
description: Use when the user asks for a specific task.
version: 0.1.0
---
```

Rules:

- `name` must match the folder name.
- `description` must start with `Use when`.
- The trigger must be concrete and distinct from every other skill.
- Keep specialist skills more specific than `ask-my-tenant`.
- Do not add client-specific frontmatter fields to shared skills.
- Include a body `Version: x.y.z` line and a `## CHANGELOG` section.
- Add `test.md` with at least one trigger prompt and expected behavior.
- Do not store secrets, tenant data, or live customer output in a skill file.

## Declaring Requirements

A skill that cannot do its job without a specific capability declares it in an optional `requires` frontmatter block:

```yaml
---
name: skill-name
description: Use when the user asks for a specific task.
version: 0.1.0
requires:
  servers: [greybeard-graph]
  scopes: [User.Read.All, AuditLog.Read.All]
  license: entra-p1
  roles: [reporting]
  writes: true
---
```

All keys are optional. The grammar is one nested block with two-space indentation, flow-style lists like `[a, b]`, and `true`/`false` for `writes`. The allowed values live in code and are enforced by the skill catalog test:

- `servers`: MCP server names from `SERVER_CATALOG` in `cli/src/serverCatalog.ts`.
- `scopes`: delegated Graph scopes from the Tier 1, Tier 2, or write scope catalogs (`greybeard scopes` prints them).
- `license`: `entra-p1` is the only known value, in `KNOWN_LICENSES` in `cli/src/skillManifest.ts`.
- `roles`: semantic role groups from `ROLE_GROUPS` in `cli/src/skillManifest.ts`, not raw directory role names.
- `writes`: `true` when the skill stages tenant writes through the write gate.

`greybeard doctor` compares every declared block against the signed-in account and reports unmet requirements with the remedy. Capabilities the product grants on demand by design, Tier 2 scopes and the writes opt-in, show up as one informational line instead of per-skill warnings, so a healthy default install stays warning-free. Skills must still degrade gracefully at runtime; a declared requirement is a doctor signal, not a runtime guard.

Apply the hard and soft dependency rule:

- Hard dependency: the skill produces wrong or no output without it. Declare it in `requires` and state the remedy in the skill body (for example `run greybeard setup --writes`).
- Soft dependency: the skill only gets sharper with it (for example `greybeard-memory` recall, an optional Tier 2 scope fetched via `add-scope` on a 403). Keep it in prose, do not declare it, and make sure the skill still works without it.

## Keep Triggers Distinct

Trigger overlap makes clients pick the wrong skill. Before adding or changing a skill, compare the first words and verbs in every `description`.

Good trigger shape:

```text
Use when the user asks why Intune devices are noncompliant, failing compliance, blocked, in grace period, or need compliance policy triage.
```

Weak trigger shape:

```text
Use when the user asks about Intune.
```

If two skills can answer the same prompt, either make one clearly more specific or combine the shared reference material into one skill.

## Versioning

Every skill has a frontmatter `version` and a body `Version:` line. Keep them aligned.

- Major: breaking workflow or output contract.
- Minor: new capability, references, examples, or trigger improvements.
- Patch: typo, formatting, or clarification that does not change behavior.

Add a `CHANGELOG` entry whenever behavior changes. `greybeard update` reports changed skill names and the current version after a pull.

## Build Path

Use this path for code changes:

1. Read the relevant spec or docs file.
2. Add or update focused tests.
3. Implement the change.
4. Run `npm run build`, `npm test`, and finally `npm run ci`.
5. Update README, decisions, or tasks when behavior or claims change.

## Contribute Path

Use this path for skill or reference improvements:

1. Edit the existing skill or reference file.
2. Update `test.md` if the trigger or expected behavior changed.
3. Update the skill version and changelog.
4. Run `npm test --workspace @greybeard/cli` and `npm run check:style`.

## Documentation Rules

- Write plain, admin-facing explanations.
- Document what the code does today, not planned behavior.
- Keep security boundaries explicit.
- Do not add secrets, screenshots with tenant data, or customer-specific identifiers.
- Use plain ASCII punctuation.
