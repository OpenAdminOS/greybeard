# Native CLI transport verification

These runs use the actual installed Claude Code, Copilot CLI 1.0.83 and Gemini CLI 0.59.0 against a local HTTP server that returns a fixed synthetic acknowledgement. They verify real host hook execution and the outgoing model-request payload. They do not evaluate model reasoning, billing, real account policies or tenant access.

All three hosts passed two flows with only generated Greybeard hooks, no memory MCP or installed skills:

1. A natural Windows compliance prompt reached the local endpoint with its original text, Greybeard context and the confirmed 48-hour pilot/helpdesk lesson.
2. A natural operating preference created exactly one unconfirmed candidate. The outgoing model request retained the prompt and identified the saved candidate for review.

`claude.json`, `copilot.json` and `gemini.json` retain checks, versions, source hashes, event ledgers and synthetic memory state. Request bodies containing host system instructions are not retained; the server records only the relevant presence checks. Reported token usage comes from the synthetic response and is not a measurement.

`gemini-before-fix.json` records the discovered regression on dd49566: session context reached the endpoint but the confirmed lesson did not. Gemini prepends `<hook_context>` blocks to its prompt. Greybeard now removes those native leading blocks before retrieving or proposing lessons, including at turn completion. A regression test also ensures that preferences inside hook context do not become user proposals.

To reproduce on Linux, build the workspace, install the recorded CLI versions into an isolated tool directory, and run `python3 evaluations/automatic-0.1/transport/run.py`. Claude Code is resolved from PATH or `GREYBEARD_CLAUDE_BINARY`. Set `GREYBEARD_HOST_BIN_DIR` if the CLI executables are elsewhere than the default temporary verification directory. The runner uses temporary homes and synthetic memory. Copilot uses its documented offline local-provider mode; Gemini uses a synthetic key accepted only by the local fixture server and explicit trust for that generated temporary workspace. No real account credential is read.
