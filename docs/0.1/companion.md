# Greybeard companion

The companion is a real desktop application window with native menus, file pickers, export dialogs and a normal Dock or Start menu entry. It uses Electron with an isolated renderer and the same bundled CLI/MCP runtime. It requires no Node installation and does not open a browser. SQLite stays in the existing Greybeard data directory.

## Everyday flow

1. Install the Windows application from one signed setup executable, or drag the Mac application from its signed DMG to Applications.
2. On first launch, Greybeard checks all six supported AI tools and shows which were detected. Common GUI-launch install locations are checked without invoking a shell or the tools.
3. Choose the detected tools you use, then select **Enable learning**. Local memory is bundled already. Setup writes the memory connection, supported automatic hooks and skills/instructions, then checks each selected integration. No tenant connection or model download is needed.
4. Review per-tool results. Links into previous Greybeard runtime builds are upgraded automatically. Other blocked skills and unidentified connections stay intact and are listed with their exact paths. **Review repair** previews the affected files; **Back up and reconnect** preserves the existing configuration and moves conflicting skills outside the host's skills directory before installing the current integration. A changed configuration invalidates the reviewed repair. Claude Desktop's optional skill import is separate from memory connection health.
5. Fully quit and reopen the selected AI tools. In Codex, review and trust Greybeard in `/hooks`. Claude Desktop Code shares Claude Code hooks; ordinary Chat remains MCP-assisted. Copy the starter prompt into one of them, then return to Greybeard to review the lesson it proposes. Confirmation applies to the exact local text.
6. Later launches open the workspace. Continue in the AI tool; Greybeard can contribute applicable confirmed context. Review proposals, correct or forget lessons, and inspect retrieval activity here.

**Explore the app first** saves that choice without configuring or removing AI-tool integrations. The workspace offers setup whenever the user is ready. Existing memories and paused learning are retained; the explicit Enable learning action resumes learning.

**Continue for now** also permits leaving partial setup without claiming unresolved tools are ready. Repair results show the backup location. Each repair stores the original configuration plus a restore manifest in local `integration-backups`; skill backups are in a `greybeard-backups` sibling of the tool's skills directory, so they are not loaded as duplicate skills. Restoring backups is manual: quit the AI tool, use the manifest's original paths, and account for any later configuration changes before restoring a whole configuration file. Repair does not edit the memory database.

Overview presents the next useful step. AI tools manages integrations and rescanning; Infrastructure holds the optional tenant connection. Your memory contains review, search, correction, export and pause/resume. Advice & activity shows automatic host events, delivery channels, memory contributions, proposed lessons and retrieval feedback. App preferences also offers explicit Mac/Windows open-at-login control and remains the secondary navigation item for updates, local storage and installation help. The memory environment selector appears only when a tenant connection makes it relevant.

The companion labels local configuration checks separately from a running host connection. It cannot silently restart an AI tool or guarantee a host will apply advice. No memory control changes tenant configuration, and no continuous model or desktop observer is introduced.

## Memory map

The map gives the globe the full workspace width, with a midnight-blue canvas and teal, coral and slate memories. Color and outline indicate confirmation status. There are no tool-name hubs or source lines on the canvas; only recorded memory relationships and corrections appear.

Click a memory to open its exact text, saved and confirmed dates, scope and connections in a focused dialog. Close the dialog or press Escape to return to the globe. Source and other recorded timestamps remain available under More about this memory. Follow a connection inside the dialog or open the record in Your memory for review and editing. Nothing is selected automatically on first load.

Drag or use arrow keys to rotate; Enter opens the selected or foremost memory. Browse memories as a list and Flat view support keyboard selection without rotation. Search and status filters run before the 200/500/1,000-record limit; counts identify truncated results. The timeline filters loaded records by saved date. Refresh reloads the selected environment, and profile changes clear old data. An empty result displays a message instead of an empty globe.

Globe positions are visual layout, not geography or inferred similarity. No graph service, model call, telemetry or continuously running animation is introduced. The existing exact confirmation and forgetting controls stay in Your memory.

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
