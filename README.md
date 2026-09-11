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

## Install Greybeard 0.1

Download the assets from the [private 0.1 release](https://github.com/ugurkocde/greybeard/releases/tag/v0.1.0) while signed into a GitHub account with repository access. GitHub tag `v0.1.0` corresponds to the product display **0.1**. Until the release is published, use the final delivery link provided with the release handoff.

| Computer | Download |
| --- | --- |
| Windows x64 | `greybeard-win32-x64.exe` |
| Apple Silicon Mac | `greybeard-darwin-arm64.tar.gz` |
| Linux x64 | `greybeard-linux-x64.tar.gz` |

Each archive contains one executable named `greybeard`. You do not need Node, npm, Git, or a source checkout. Download `SHA256SUMS.txt` from the same authenticated release and compare the checksum for your asset before opening it. Put the executable in its permanent location **before setup**, because client configurations refer to that path.

On Windows, move the executable into `%LOCALAPPDATA%\Greybeard\bin`, rename it to `greybeard.exe`, then double-click it. For terminal setup:

```powershell
& "$env:LOCALAPPDATA\Greybeard\bin\greybeard.exe" setup
```

On a Mac, expand the archive and move `greybeard` into `~/Applications/Greybeard` before opening it. The archive preserves its executable permission. You can also launch local graphical setup from Terminal:

```sh
"$HOME/Applications/Greybeard/greybeard" setup --ui
```

Check the Mac artifact's signing and notarization status in the release metadata. If the delivered artifact is explicitly marked ad-hoc and macOS blocks the verified download, follow [Apple's instructions for Open Anyway](https://support.apple.com/en-gb/102445). Do not disable Gatekeeper globally.

Setup detects your AI clients, configures your selection, creates local memory, and defaults updates to **Notify**. It requires no Microsoft sign-in or tenant permissions. Restart your selected AI clients after setup.

The executable contains the runtime, skills, logo, and SQLite library. It extracts integrity-checked assets into application data; settings and memories remain outside the executable so they survive replacement. There is no configured automatic-update feed for this release: updates are manual downloads.

For checksum commands, authenticated terminal installation, and replacement instructions, see [executable delivery](docs/0.1/executable-delivery.md). The [release notes](docs/0.1/release-notes.md) describe the available features and limits.

## Your first lesson

Ask your AI client to remember a durable preference, or propose one locally:

```sh
greybeard memory add --content "Review stale device ownership before device deletion" --scope devices
greybeard memory candidates
greybeard memory confirm --id 1
```

Use the actual candidate ID returned by the first command. Confirmation previews the exact lesson and requires an interactive terminal; you can also review and confirm it in local graphical setup. A conversation, tool result, or successful command cannot silently turn a candidate into confirmed guidance.

For a supported later action, Claude Code receives a short advisory containing applicable confirmed lessons. The initial command adapter recognizes individual `Remove-MgDevice`, `Remove-MgUser`, `Remove-MgGroup`, and `Update-MgGroup` commands through its Bash pre-tool event, including a simple PowerShell command wrapper. Compound scripts and other actions are outside that adapter's coverage. The hook does not pause execution: Claude Code may surface the advice after a command runs. It does not guarantee a user-visible warning before execution. Advice never means a command is safe or authorized.

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

Notify is the default, but this release has no configured publisher update feed. Selecting Automatic does not make new GitHub releases install themselves. Download and verify a replacement manually, close Greybeard and its AI clients, retain the old executable, then replace it at the same path. Keep the application-data directory. The update engine supports verified staging with an independently configured trusted feed; Windows automatic activation is not implemented.

Local SQLite and deterministic matching use no model tokens. Recalled context adds input tokens to your existing client's conversation. Retrieval is bounded after link expansion; actual whole-task costs depend on the client, model, and task. Greybeard does not require a separate model subscription or continuous model worker, and does not promise net token savings.

## Development

Developer dependencies are separate from the user installation:

```sh
npm ci
npm run ci
npm run build:executable
npm run test:executable
```

Build on the intended operating system and architecture with the same Node runtime used to install native dependencies. Target-platform build and executable-check outcomes are recorded in the release handoff. Release signing status and supported architecture names belong to the actual release assets; a source build alone does not establish them.

The [0.1 plan](docs/0.1/implementation-plan.md), [review decisions](docs/0.1/review-decisions.md), and [implementation status](docs/0.1/implementation-status.md) govern this work. Historical tags and internal package versions remain separate from the public 0.1 display label.
