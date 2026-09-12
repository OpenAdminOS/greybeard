# Automatic mentoring in 0.1

Implementation objective: an installed integration should receive host events automatically, contribute small relevant advice, propose durable lessons for human review, and expose evidence that it is working. An MCP connection alone does not establish prompt coverage.

## Host contracts checked

- [Claude Code hooks](https://code.claude.com/docs/en/hooks): UserPromptSubmit and PreToolUse accept additional context. Stop provides the last assistant message. User hooks apply to local Code sessions, including the Desktop Code surface.
- [Codex hooks](https://developers.openai.com/codex/hooks): UserPromptSubmit and PreToolUse accept additional context. Stop provides last_assistant_message. Local Codex 0.154.0 enables stable hooks. Newly installed or changed definitions must be reviewed with /hooks; installation must not bypass that trust decision.
- [Gemini hooks](https://geminicli.com/docs/hooks/reference/): BeforeAgent accepts additionalContext; AfterAgent provides the prompt and response. User settings can install hooks.
- [Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference): command userPromptSubmitted output is ignored. userPromptTransformed can append context while preserving the original transformed prompt. User hooks are supported; runtime compatibility must be verified.
- [Cursor hooks](https://cursor.com/docs/hooks): beforeSubmitPrompt observes prompts but does not accept advisory model context. Use local companion advice on that event, and supported sessionStart/postToolUse context output. Do not block a prompt just to display advice.
- [Claude Desktop](https://code.claude.com/docs/en/desktop): Code and ordinary Chat have different integration configurations. Ordinary Chat's local MCP connection is not a documented prompt observer. The user selected Code mode for automatic mentoring; ordinary Chat remains clearly labeled MCP-assisted.

## Implemented behavior

1. Shared local event engine: bounded inputs, selected profile/environment, relevance filtering, compact confirmed memory, concise built-in operational reminders, duplicate suppression and pause handling. No tenant writes or separate background model calls.
2. Automatic lesson proposals from explicit durable operating preferences/corrections, with source attribution, secret rejection, duplicate suppression and exact human confirmation retained. Host instructions support proposing additional useful outcomes without requiring the user to ask for memory by name.
3. Native host hook adapters, preserving unrelated configuration and safely updating/removing owned definitions. Report host-specific trust and version requirements.
4. Persistent bounded event evidence and companion status: configured, awaiting first event, receiving events, paused, and failure details. Advice delivery must distinguish host-context output from companion notifications.
5. Real installed-client verification where available, host-contract regression fixtures elsewhere, upgrade/uninstall checks, privacy and concurrency checks, and packaged desktop verification. Document any external authentication or host availability blockers precisely.
6. Signed installer build, CI verification, PR update, and Mac delivery. Remain version 0.1.0.

## Verification and practical limits

- Codex CLI 0.154.0: ten actual isolated conversations use the installed integration and synthetic memories. Results cover remembered and corrected durations, inactive and forgotten lessons, pause, unrelated prompts, hostile remembered text, scoped retrieval and automatic proposals. Two further sessions compare untrusted hooks with trusted hook-only delivery, without MCP, skills or host instructions. The hook-only model used the 48-hour/helpdesk rule; untrusted hooks emitted no events. Fixture automation uses the documented trust bypass only for vetted temporary commands; normal setup never bypasses `/hooks`.
- 100 distinct prompts are replayed through all five adapters, giving 500 deterministic engine checks with saved reviews. These are not 500 model conversations. The earlier 100 real model conversations remain in `evaluations/mentor-100` as historical evidence, not proof of this new implementation.
- Real Claude Code model authentication failed: OAuth session expired and could not be refreshed. Refresh that account's local Claude authentication before repeating the saved-session check. Desktop Code shares the documented local hooks but was not directly driven from this Linux machine.
- Gemini CLI 0.59.0 loaded the configuration but exited with code 41 because no authentication method is configured in the isolated environment. Complete an authorized Gemini login before real model verification.
- Copilot CLI 1.0.83 reached the account policy check but was denied access; it also reported third-party MCP disabled by organization policy. Enable applicable Copilot CLI access at the account/organization level before repeating real model verification. The adapter contract is verified against current primary documentation; no successful model conversation is claimed.
- Cursor is not installed here. Its documented hook contracts have automated fixtures; actual editor notification and post-tool delivery need an installed Cursor session. Its prompt hook does not support advisory model context. Prompt-time advice therefore needs the running Greybeard companion and permitted native notifications.
- Full local workspace checks and native Electron onboarding/companion smoke cover repair, memory review, new event visibility, pause, persistence and renderer isolation. Generated hooks are executed through the platform shell in the cross-platform test suite, including paths with spaces and apostrophes.

See [saved evaluations and reviews](../../evaluations/automatic-0.1/README.md). Installer build and signing results are tracked on PR #2; successful Linux checks do not establish macOS or Windows signing.

## What the admin experiences

Enable the detected tools once. Fully restart them, and approve Greybeard in Codex `/hooks`. State a durable operating preference naturally. Greybeard proposes a candidate and tells supported hosts its ID, avoiding a duplicate proposal or a false claim that saving failed. Review the exact wording in the companion. Later relevant prompts receive the confirmed lesson without asking for Greybeard by name.

Overview distinguishes configuration from observed host events. Advice & activity shows where advice was delivered, memory IDs, built-in reminders, and generic local errors. An event proves a hook ran and what it returned; it does not prove the model followed advice. Closing the app window keeps the companion available through the Mac Dock or Windows/Linux tray. Mac and Windows installations offer explicit open-at-login control. Quitting the companion stops native notifications; configured host hooks still work.

## Resource and privacy contract

The local engine makes no model or tenant calls. Hook input is limited to 128 KB with a bounded stdin wait. SQLite lock waits use 200 ms for this path. Host definitions allow five seconds, and runtime event failures return non-blocking empty JSON. Context is capped at 2,048 UTF-8 bytes, preserving whole lessons. Identical context is suppressed for ten minutes within a host/session/delivery channel. Skills reuse applicable hook context instead of recalling it again. The model host can still bill for context in subsequent requests; byte counters are not token prices.

Raw prompts, transcripts and assistant responses are not kept in the activity ledger. Explicit, privacy-screened preference text can become an unconfirmed candidate. More nuanced outcomes are proposed by the existing host model, using stated evidence; Greybeard does not silently infer verified success. Event metadata is bounded to seven days and 1,000 records per profile/environment. Hashed proposal fingerprints persist for up to 90 days to avoid immediately relearning forgotten or dismissed duplicates. Native notifications contain generic text, not the remembered content. Pause suppresses new advice and proposals while preserving local review.

Topic scopes such as devices can be selected from Windows/device vocabulary. Named team, project and environment labels require explicit applicability; ambiguous labels are offered to the host for selection instead of reading every scope. Tenant and profile boundaries remain fixed by the installed command arguments.

