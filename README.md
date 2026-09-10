<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/greybeard-dark.png">
    <img src="assets/logo/greybeard-light.png" alt="Greybeard logo: a bespectacled face with a grey beard" width="188">
  </picture>

# Greybeard 0.1

**An IT mentor that learns how you work.**

For Microsoft 365, Intune, and Entra administrators using AI tools.

</div>

Greybeard keeps the decisions and lessons you confirm, brings relevant context into later work, and supplies relevant advisory context for supported commands in Claude Code. It is free to use. You can use its local memory and admin skills without connecting a Microsoft tenant.

Greybeard is a local application. MCP exposes its memory and optional tenant-read tools to your AI client. Client integrations supply supported events; Greybeard does not watch your desktop or automatically observe every command. Your existing AI client supplies the model.

## Install and first run

The distribution format is one executable for each supported operating system and architecture. The graphical download and terminal downloader use the same executable; users do not need Git, npm, or Node. Public signed downloads are not published yet. Do not use an old package release as a substitute for the executable described here.

Launch the executable without arguments to open local graphical setup, or run:

```sh
greybeard setup
```

Setup detects your AI clients, configures the selected integrations, creates local memory, and defaults updates to **Notify**. It does not open Microsoft sign-in or require tenant permissions. Use `greybeard setup --client "Claude Code"` to select one detected client, or `greybeard setup --ui` to open the graphical route.

The executable contains the application runtime, skills, logo, and SQLite library. It extracts integrity-checked assets and the native SQLite library into private application data. Your settings and memories remain outside the executable so they survive updates.

The shell and PowerShell downloaders in this repository require an authenticated release tag and checksum. They deliberately stop when those release inputs are missing. [Executable delivery](docs/0.1/executable-delivery.md) documents the current build and release requirements.

## Your first lesson

Ask your AI client to remember a durable preference, or propose one locally:

```sh
greybeard memory add --content "Review stale device ownership before device deletion" --scope devices
greybeard memory candidates
greybeard memory confirm --id 1
```

Use the actual candidate ID returned by the first command. Confirmation previews the exact lesson and requires an interactive terminal; you can also review and confirm it in local graphical setup. A conversation, tool result, or successful command cannot silently turn a candidate into confirmed guidance.

For a supported later action, Claude Code receives a short advisory containing applicable confirmed lessons. The initial command adapter recognizes individual `Remove-MgDevice`, `Remove-MgUser`, `Remove-MgGroup`, and `Update-MgGroup` commands through its Bash pre-tool event, including a simple PowerShell command wrapper. Compound scripts and other actions are outside that adapter's coverage. The hook does not pause execution: Claude Code may surface the advice after a command runs. A guaranteed user-visible warning before execution remains a release acceptance requirement. Advice never means a command is safe or authorized.

## Client behavior

| Client | Integration behavior |
| --- | --- |
| Claude Code | Skills, memory MCP, and advisory context for the supported commands above; execution is not paused |
| Codex CLI, Cursor, Gemini CLI | Memory MCP and configured guidance; automatic action advice is not implemented |
| Claude Desktop | Memory MCP; skills require the documented manual pack route; assistance on request |
| GitHub Copilot | Optional configuration through `--with-copilot`; assistance on request |

Configuration detection is distinct from verifying a complete conversation in each client. The [implementation status](docs/0.1/implementation-status.md) records the evidence and remaining work.

## Memory and control

SQLite stores candidates, confirmed lessons, sources, scopes, and correction relationships. Existing unverified memories migrate to candidates. Related preferences coexist; a correction does not silently overwrite the original. Memory is isolated by profile and tenant snapshot.

```sh
greybeard memory list
greybeard memory correct --id 1 --content "Check device ownership and retention before deletion"
greybeard memory export > greybeard-memory.json
greybeard memory pause
greybeard memory resume
greybeard memory forget --id 1
greybeard setup --no-memory-hook
greybeard uninstall
```

Review and confirm corrections separately. Pausing stops new learning and proactive advice; explicit recall remains available. Disabling the hook removes Greybeard-owned hook entries. Uninstall removes recognized integrations and retains your memories, configuration, and customer-owned certificate files.

Local storage is not a promise that data stays off the network: your AI client may send recalled lessons to its model. Processes running as your OS account can access the same files. Store reusable intent, not secrets or raw tenant exports.

## Optional tenant connection

Use your own app registration and customer-provisioned certificate. Start with:

```sh
greybeard connect capabilities
greybeard connect --help
greybeard connect status
greybeard connect disconnect
```

No permissions are preselected. The connection command lists each candidate Application permission and its purpose. Configure and consent only the selected capabilities in Entra; Greybeard never creates the registration, grants permissions, or silently escalates access. Its app-only provider checks the returned application's identity and exact role selection and leaves unsuitable connections inactive. These checks do not prove minimum permissions.

The implemented certificate-file provider checks ownership and private-key permissions on POSIX systems. Windows tenant connection remains unavailable until its protected credential provider is implemented and verified. Mentor-only setup remains available independently. Exact permission validation and certificate lifecycle requirements are tracked in [the implementation plan](docs/0.1/implementation-plan.md).

Tenant tools use explicit Microsoft Graph `/beta` reads. **Production tenant writes, approval tools, and delegated permission mutation are disabled in 0.1.** Change planning skills prepare a reviewable brief for your existing execution workflow.

## Updates and model usage

Notify is the default. Automatic is opt-in; Manual disables scheduled checks. A configured trusted publisher feed is required before update checks can succeed. Updates verify signed metadata and the artifact hash before staging. Supported activation waits for a later launch without active Greybeard peers; platform limits are documented in the delivery plan. No database backup is blindly restored during executable recovery.

Local SQLite and deterministic matching use no model tokens. Recalled context adds input tokens to your existing client's conversation. Retrieval is bounded after link expansion; actual whole-task costs depend on the client, model, and task. Greybeard does not require a separate model subscription or continuous model worker, and does not promise net token savings.

## Development

Developer dependencies are separate from the user installation:

```sh
npm ci
npm run ci
npm run build:executable
npm run test:executable
```

Build on the intended operating system and architecture with the same Node runtime used to install native dependencies. Local executable evidence covers Linux x64; target-platform CI results are recorded in the implementation handoff. Windows and macOS release support also depends on signing and clean-machine checks. No release is implied by a successful local build.

The [0.1 plan](docs/0.1/implementation-plan.md), [review decisions](docs/0.1/review-decisions.md), and [implementation status](docs/0.1/implementation-status.md) govern this work. Historical tags and internal package versions remain separate from the public 0.1 display label.
