# Automatic mentoring verification, Greybeard 0.1

This directory keeps actual host observations separate from deterministic adapter checks. All memory records and user prompts here are synthetic. No tenant tools were connected.

## Evidence

- `codex-installed/01` through `10`: actual Codex CLI 0.154.0 conversations using normal generated instructions, skills and hooks. Each contains the prompt, response, JSON event stream, local automatic event ledger, memory state, source hashes and a review. The isolated generated scripts use the documented hook trust bypass solely for automation; user installation still requires `/hooks` approval.
- `codex-untrusted`: same synthetic rule with no hook approval. No events ran; the model said the pilot duration was unknown.
- `codex-hooks-only`: trusted temporary hooks with MCP, skills and host instructions removed. The actual model used the 48-hour pilot and helpdesk-review condition supplied by the hook. This isolates automatic context delivery from model-initiated recall.
- `contract-reviews.json`: 100 distinct prompts from the retained evaluation corpus, each exercised through all five adapters. All 500 deterministic checks passed: byte cap, confirmed-record isolation, absence of permission decisions, Cursor companion output, preserved Copilot prompt, and pause. These are not 500 model conversations and do not grade the factual quality of model answers.
- Local full CI, native Electron first-run and companion smoke, notification/startup unit tests and standalone executable checks cover the implementation. GitHub Actions adds native Windows and macOS builds and signing verification.

The first rollout run initially injected 3,150 bytes. After repeated-context suppression and skill reuse, the saved run injected 1,350 bytes with the same remembered condition. This is an observed context reduction, not a billing benchmark. Usage records describe the complete host turn, including unrelated instruction/tool overhead.

## Additional native host evidence

[Native transport verification](transport/README.md) now proves actual Gemini and Copilot CLI hook execution, confirmed-lesson delivery and automatic candidate proposals using local synthetic model responses. This is stronger than calling the adapter functions directly, but does not evaluate model reasoning or establish account access. The check found and verified a fix for Gemini's native session-context prefix displacing the user's recall query.

## External limitations

- Claude Code reached the configured memory connection but model authentication failed: **OAuth session expired and could not be refreshed**. Refresh local Claude authentication before repeating. Desktop Code shares local hooks, but a Desktop Code conversation was not driven here.
- Gemini CLI 0.59.0 exited with code 41: no authentication method configured in its isolated settings/environment. An authorized Gemini login is needed for a model conversation.
- Copilot CLI 1.0.83 was denied by account/organization policy and reported third-party MCP disabled. Its saved result includes the exact failure; enable applicable CLI access before retrying. No successful Copilot model call is claimed.
- Cursor is not installed on this machine. Its documented hook outputs have fixtures; native editor delivery still needs an installed session. Ordinary Claude Desktop Chat has no documented prompt hook and remains MCP-assisted by design.

## Issues found and addressed

1. Tool availability alone did not ensure prompt-time memory use: generated native hooks now call the local engine automatically.
2. Repeated relevant tool events reinjected identical context: per-session/channel suppression and skill reuse reduce duplication.
3. A locally saved preference was invisible to the model, causing a false failed-save message: hook context now identifies the saved candidate and prevents a second proposal.
4. Topic-scoped memory could be missed without a literal scope label: device/Windows vocabulary selects standard device topics; named scopes remain explicit and ambiguity is surfaced.
5. Copilot's submitted-prompt hook ignores output: the implementation uses the documented transformed-prompt hook and preserves its original content. Missing transformed content is an error, not a successful-delivery claim.
6. Cursor cannot inject advice at prompt submission: its prompt advice goes to the native companion, with supported context events handled separately.
7. Setup was treated as proof of activity: the UI now separates installed hooks, trust/restart requirements, observed events, pause, disabled settings and errors.
8. Shared Desktop Code hooks could be removed while disconnecting ordinary Desktop Chat: uninstall keeps those integrations separate.

9. Bare PowerShell cmdlet names can contain the domain word inside a longer identifier: the event matcher now recognizes administrative cmdlet syntax and retains destructive-change reminders without requiring an extra word in the prompt.

10. Gemini prepends session-hook output to prompt events: normalization now excludes those native context blocks from user-task retrieval and preference capture, including turn completion. Actual CLI transport and regression checks cover the fix.

## Follow-up verification

Repeat real sessions after the external authentication/policy blockers are resolved, especially Desktop Code and Cursor on the user's Mac and Windows. Verify native notification permissions and open-at-login behavior on those installations. Continue collecting explicit useful/irrelevant feedback and confirmed outcomes before claiming broad reliability or a measured productivity gain.

Reproduction scripts are under `scripts/evaluate-automatic-*`. They require a built workspace; model runners reference existing authorized authentication without storing credentials. Never point them at production memory.
