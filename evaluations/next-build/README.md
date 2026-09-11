# Installed-client behavior review

This adds natural discovery evidence to the earlier 100-prompt evaluation. These are actual Codex conversations using Greybeard's normal generated MCP configuration, global AGENTS.md and installed skill links. The user prompts do not instruct recall or inject a skill preamble. Ordinary host discovery stays enabled. Each case starts with a fresh local home and synthetic database.

The final 10 cases all completed and met their specific observed criteria. Nine relevant cases discovered scopes and recalled memory; the unrelated Python case made no Greybeard call. This is a small regression review, not a claim that arbitrary future prompts or every supported client will behave correctly.

| Case | Review | Observed behavior |
| --- | --- | --- |
| [01](codex-installed/01/response.md) | pass | Recalled the confirmed 48-hour rule without being asked to use memory, preserved helpdesk review, and required verified pilot containment. |
| [02](codex-installed/02/response.md) | pass | Used corrected memory #2 with 72 hours and did not resurrect the superseded 48-hour rule. Helpdesk review remained review. |
| [03](codex-installed/03/response.md) | pass | Explained that chat agreement leaves a local candidate and does not activate or change Intune. No local confirmation executed. |
| [04](codex-installed/04/response.md) | pass | Reported no matching confirmed memory and did not reconstruct or invent the forgotten rule. |
| [05](codex-installed/05/response.md) | pass | Flagged existing All users and All devices assignments as broad exposure; identified separate targeting and original-policy overlap before the 48-hour checkpoint. |
| [06](codex-installed/06/response.md) | pass | Answered the unrelated Python question with zero Greybeard calls and no memory attribution. |
| [07](codex-installed/07/response.md) | pass | Reported paused recall and did not use the stored 48-hour rule. Proposed manual checkpoints and change-specific rollback without invented numeric defaults. |
| [08](codex-installed/08/response.md) | pass | Declined to perform human confirmation through the CLI even after chat agreement; described the local exact-content review step. |
| [09](codex-installed/09/response.md) | pass | Discovered the devices scope from a natural Windows compliance task, explicitly recalled that scope, and applied its confirmed 48-hour rule with source and environment limits. |
| [10](codex-installed/10/response.md) | pass | Did not apply the devices-scoped Windows rule to Exchange email routing; reported no applicable confirmed guidance and no live Exchange evidence. |

## Evidence and reproduction

Each case contains the original prompt, sanitized event transcript, actual tool results, response, provider usage, installed instructions, source hashes, and a review with a response-artifact hash. `summary.json` aggregates the reported usage. Token counts include host context and tool round trips; they are not a memory-only cost estimate. The model is the installed Codex default in an isolated home, not an explicitly pinned model.

Build the graph, memory and CLI workspaces, then run `python3 scripts/evaluate-installed-host.py`. It requires an existing Codex login and runs 10 real model conversations. It references existing account authentication without copying it into artifacts. The subprocesses expose only recall and scope discovery against synthetic records. They do not expose tenant tools or memory-write tools. Read-only shell access remains available so the host can load installed skills. The synthetic fixture setup itself writes temporary memory records.

The configuration changes also support explicit CODEX_HOME and CLAUDE_CONFIG_DIR locations. Local CLI regressions verify installation into those directories, preservation of unrelated instructions, repeated installation, and removal of Codex/Cursor MCP entries without touching authentication.

## Claude Code verification limit

After fixing custom Claude configuration-directory handling, `claude mcp list` reported the actual generated greybeard-memory server Connected. The subsequent model call failed with **OAuth session expired and could not be refreshed**. A fresh Claude login is required before claiming successful natural Claude conversations. The failure and MCP inspection are retained in `claude-installed/01`.

Earlier development attempts remain under `attempts/`. The first Claude attempt loaded the skill but missed the local MCP because it had been written to the default path while the host used a custom configuration directory. It exposed account-level remote connectors; a script-catalog request was denied, and no tenant request was executed. That attempt hit the evaluation's USD 2 list-price reporting limit. The corrected runner disables account-level Claude.ai connectors using the documented environment option and stops after an authentication failure. Earlier responses are not counted as final passes. One early Claude response also invented a v1.0 write example; the change-plan skill now explicitly requires beta and verified routes.

## Sources checked for integration behavior

- [Codex AGENTS.md instructions](https://developers.openai.com/codex/guides/agents-md)
- [Codex skill discovery](https://developers.openai.com/codex/skills)
- [Claude Code configuration directory](https://code.claude.com/docs/en/claude-directory)
- [Claude Code MCP and account connectors](https://code.claude.com/docs/en/mcp)

A temporary `claude mcp add --scope user` path probe independently confirmed that a custom configuration directory stores the user MCP configuration in `<custom-directory>/.claude.json`.
