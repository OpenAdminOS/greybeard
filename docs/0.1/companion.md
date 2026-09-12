# Greybeard companion

The companion is a real desktop application window with native menus, file pickers, export dialogs and a normal Dock or Start menu entry. It uses Electron with an isolated renderer and the same bundled CLI/MCP runtime. It requires no Node installation and does not open a browser. SQLite stays in the existing Greybeard data directory.

## Everyday flow

1. Install the Windows application from one signed setup executable, or drag the Mac application from its signed DMG to Applications.
2. On first launch, Greybeard checks all six supported AI tools and shows which were detected. Common GUI-launch install locations are checked without invoking a shell or the tools.
3. Choose the detected tools you use, then select **Enable learning**. Local memory is bundled already. Setup writes the memory connection and supported skills/instructions, then checks each selected integration. No tenant connection or model download is needed.
4. Review per-tool results. A blocked user skill or conflicting connection stays intact and prevents a false success result. Retry after resolving the issue. Claude Desktop's memory connection is automated; its optional skill import remains manual and is identified as such.
5. Fully quit and reopen the selected AI tools. Copy the starter prompt into one of them, then return to Greybeard to review the lesson it proposes. Confirmation applies to the exact local text.
6. Later launches open the workspace. Continue in the AI tool; Greybeard can contribute applicable confirmed context. Review proposals, correct or forget lessons, and inspect retrieval activity here.

**Explore the app first** saves that choice without configuring or removing AI-tool integrations. The workspace offers setup whenever the user is ready. Existing memories and paused learning are retained; the explicit Enable learning action resumes learning.

Overview presents the next useful step. AI tools manages integrations and rescanning; Infrastructure holds the optional tenant connection. Your memory contains review, search, correction, export and pause/resume. Advice & activity shows retrieval feedback. App preferences is a secondary navigation item for updates, local storage and installation help. The memory environment selector appears only when a tenant connection makes it relevant.

The companion labels local configuration checks separately from a running host connection. It cannot silently restart an AI tool or guarantee a host will apply advice. No memory control changes tenant configuration, and no continuous model or desktop observer is introduced.

## Installation and CLI

The application includes its CLI. On Mac it remains at `Greybeard.app/Contents/MacOS/greybeard`; on Windows it is in `resources/bin/greybeard.exe` under the installed app. The app configures MCP clients with that persistent path. CLI `greybeard app`, no arguments, and `greybeard setup --ui` open the companion. `greybeard setup` remains a terminal flow.

Development: run `npm ci`, `npm run build:executable`, then `npm run desktop`. Build installers with `node scripts/desktop/build.mjs` after the executable build. The Companion application workflow builds Windows x64, Mac Apple Silicon and Linux x64 independently. Platform assets and verification metadata are downloadable as workflow artifacts before release publication.

## Updates and recovery

The desktop updater downloads the complete application using electron-updater. Notify mode checks without downloading, Automatic downloads an available verified update, and Manual makes no scheduled checks. All modes require an explicit restart to install. macOS updates require the signed application ZIP alongside the DMG; Windows uses signed NSIS installers and publisher verification. Model use is unrelated to update checks.

Before replacement, the companion copies the complete current application into its private application-recovery folder. If backup fails, installation does not proceed. Open the previous application backup from App preferences, quit Greybeard and its AI clients, and reinstall/open the retained version if needed. This is manual recovery, not automatic failure detection. Memory is not restored from an old snapshot, so newer decisions remain. Cross-version schema compatibility must be checked before using a much older runtime.

The repository is currently private. Its GitHub update feed cannot be accessed anonymously. No shared GitHub token is bundled with the application; feed failures are shown and manual verified installation remains possible. Public automatic distribution requires an accessible release feed. This source work does not replace the already published 0.1 download.

## Application boundary

The renderer has no Node access and cannot navigate to other origins, open arbitrary windows or request browser permissions. A private loopback service is owned by the application process, authenticated per launch, checked against the exact Origin/Host and closed with the app. This is an internal transport; there is no browser tab or externally hosted UI. File pickers, memory export and updates use narrow, sender-validated IPC methods. All memory text uses textContent.

Windows certificate reading checks ownership and access control on the same file handle, rejects reparse paths/hard links and shared access, and permits only the current user plus the OS SYSTEM/Administrators recovery boundary. POSIX keys remain owner-only files. Minimum Graph permission combinations still need separate verification using a registration with only those exact grants; broad existing lab access does not establish this.

References: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [whole-application updates](https://www.electron.build/docs/features/auto-update/), [publisher verification](https://www.electron.build/docs/features/security/).
