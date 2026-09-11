# Greybeard companion

The companion is a real desktop application window with native menus, file pickers, export dialogs and a normal Dock or Start menu entry. It uses Electron with an isolated renderer and the same bundled CLI/MCP runtime. It requires no Node installation and does not open a browser. SQLite stays in the existing Greybeard data directory.

## Everyday flow

1. Install the Windows application from one signed setup executable, or drag the Mac application from its signed DMG to Applications.
2. Open Greybeard. Local memory works immediately; a tenant connection is optional.
3. Select detected AI tools in Connections and save. Restart those clients to load their integration.
4. Add an operating preference, decision or observation. Save a proposal, review its exact content, then confirm it.
5. Continue working in the AI client. Greybeard contributes applicable confirmed context; the companion shows local retrieval activity and lets you mark it useful, ignored or irrelevant.
6. Correct or forget a memory in the companion. Corrections remain proposals until confirmed, and prior text remains active until replacement confirmation.

Overview explains the value, Memory searches and filters the whole local collection before pagination, Connections displays selected permissions and explicit read probes, Advice & activity shows retrieval metrics, and Settings manages pause, updates and installation checks. The environment selector separates local memory from the configured tenant. No memory control changes tenant configuration.

## Installation and CLI

The application includes its CLI. On Mac it remains at `Greybeard.app/Contents/MacOS/greybeard`; on Windows it is in `resources/bin/greybeard.exe` under the installed app. The app configures MCP clients with that persistent path. CLI `greybeard app`, no arguments, and `greybeard setup --ui` open the companion. `greybeard setup` remains a terminal flow.

Development: run `npm ci`, `npm run build:executable`, then `npm run desktop`. Build installers with `node scripts/desktop/build.mjs` after the executable build. The Companion application workflow builds Windows x64, Mac Apple Silicon and Linux x64 independently. Platform assets and verification metadata are downloadable as workflow artifacts before release publication.

## Updates and recovery

The desktop updater downloads the complete application using electron-updater. Notify mode checks without downloading, Automatic downloads an available verified update, and Manual makes no scheduled checks. All modes require an explicit restart to install. macOS updates require the signed application ZIP alongside the DMG; Windows uses signed NSIS installers and publisher verification. Model use is unrelated to update checks.

Before replacement, the companion copies the complete current application into its private application-recovery folder. If backup fails, installation does not proceed. Open the previous application backup from Settings, quit Greybeard and its AI clients, and reinstall/open the retained version if needed. This is manual recovery, not automatic failure detection. Memory is not restored from an old snapshot, so newer decisions remain. Cross-version schema compatibility must be checked before using a much older runtime.

The repository is currently private. Its GitHub update feed cannot be accessed anonymously. No shared GitHub token is bundled with the application; feed failures are shown and manual verified installation remains possible. Public automatic distribution requires an accessible release feed. This source work does not replace the already published 0.1 download.

## Application boundary

The renderer has no Node access and cannot navigate to other origins, open arbitrary windows or request browser permissions. A private loopback service is owned by the application process, authenticated per launch, checked against the exact Origin/Host and closed with the app. This is an internal transport; there is no browser tab or externally hosted UI. File pickers, memory export and updates use narrow, sender-validated IPC methods. All memory text uses textContent.

Windows certificate reading checks ownership and access control on the same file handle, rejects reparse paths/hard links and shared access, and permits only the current user plus the OS SYSTEM/Administrators recovery boundary. POSIX keys remain owner-only files. Minimum Graph permission combinations still need separate verification using a registration with only those exact grants; broad existing lab access does not establish this.

References: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [whole-application updates](https://www.electron.build/docs/features/auto-update/), [publisher verification](https://www.electron.build/docs/features/security/).
