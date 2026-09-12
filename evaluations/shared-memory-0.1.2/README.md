# Shared memory on two physical devices

Date: 2026-09-12. Related: [issue #5](https://github.com/OpenAdminOS/greybeard/issues/5), [PR #6](https://github.com/OpenAdminOS/greybeard/pull/6).

## Environment and isolation

- Physical Windows 11 x64 MiniPC and Apple Silicon MacBook Air, connected to a packaged Linux headless server through private Tailscale Serve HTTPS.
- CI candidate executables were downloaded, matched to their source commit, and verified against their SHA-256 metadata. Initial Windows/macOS tests used `bc256fcc7bf4235832c64548a2f7342534b23155`. The corrected Windows executable used `0bd6f1e1ef358d4b61f5a8073d58c20acf237bf4`.
- Separate test directories, a new server database, synthetic preferences, and per-process Claude settings/MCP configuration. Personal memory databases and installed client configuration were not changed. TLS verification remained enabled.
- Real authenticated Claude Code print-mode conversations ran on each device. These were actual model conversations, not generated host-event fixtures. Session persistence and automatic memory were disabled for these test conversations.
- macOS SSH could see keychain metadata but could not use protected values. Running the test process as a temporary job in the logged-in desktop session enabled normal Keychain and Claude authentication access, without exporting credentials or changing keychain security.

## Cross-device results

| Check | Result |
| --- | --- |
| Native pairing | Passed on Windows with DPAPI and macOS with Keychain, through the packaged companion backend. |
| Candidate visibility | A preference proposed by Claude on Windows remained a candidate and was absent from recall before review. |
| Windows to Mac | Windows Claude proposed the synthetic Cedarfield preference. After review on the Mac, a new Mac Claude conversation received it through UserPromptSubmit context and included a 37-hour pilot and helpdesk review. The new prompt omitted those details. |
| Mac to Windows | Mac Claude proposed the synthetic Birchhaven preference. After review on Windows, a new Windows Claude conversation retrieved its 19-hour pilot and service-desk check through MCP. The new prompt omitted those details. |
| Shared pause | Pausing through the Mac companion backend produced `recallStatus: paused` on Windows. Windows resumed the shared store. |
| Server outage | Both devices returned empty hook context and created no local memory database. The Mac recovered automatic context after the server restarted. |
| Backup restoration | The packaged server backed up its SQLite store. A restored copy was opened only after the interactive credential-reset command rotated identity and revoked devices. An old Mac connection was rejected, then re-pairing recovered both confirmed preferences. |
| Native credential removal | Disconnect removed both macOS Keychain entries and all Windows DPAPI credential files, and selected local mode. |

Review used automated exact-content/revision calls to each device's authenticated companion backend. It did not exercise a person clicking the installed Electron review dialog. Transcript tool permissions allowed fixture memory operations only; early conversations correctly reported that scope discovery was not permitted, then still retrieved global guidance. Scope discovery was allowed in the final Windows retest.

## Windows issue found during validation

The original Windows packaged hook returned empty context even though MCP retrieval worked. Instrumentation measured protected-credential startup at about 1.8 seconds, exceeding the original 1.5-second processing deadline. The same source under the machine's separate Node runtime completed faster, so source-only tests did not reveal the packaged behavior.

The fix allows 2.5 seconds of processing on Windows and retains 1.5 seconds on macOS/Linux. Both remain within the installed five-second host timeout. The deadline still includes credential retrieval and cancels it when necessary. No cache, plaintext fallback, extra daemon, or onboarding step was added.

The updated Windows artifact delivered Birchhaven automatic hook context in 2,237 ms including process launch. A fresh Windows Claude conversation then received the saved rule through UserPromptSubmit and included the 19-hour pilot and service-desk check without making a recall-tool call. Local regression tests now cover delayed successful Windows credential lookup and bounded cancellation on all three platforms. The complete local `npm run ci` suite passed, including 95 CLI tests; platform-gated credential tests remain explicitly skipped on other operating systems.

## Limits

This validates private-network transport, native core executables, authenticated Claude conversations, companion backend review, and recovery with synthetic data. It does not certify fresh VM/LXC installation, the installed native companion's complete visual workflow, signed installer updates, interrupted application upgrades, or publication of version 0.1.2. Those remain release checks.

Raw logs, pairing material, hostnames, network addresses, account metadata, and desktop-job files are excluded from this evidence.
