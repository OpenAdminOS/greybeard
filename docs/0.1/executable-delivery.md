# Install Greybeard 0.1

The release tag is `v0.1.0`; the application displays **0.1**. The repository remains private. Open the [release page](https://github.com/OpenAdminOS/greybeard/releases/tag/v0.1.0) while signed into a GitHub account with access.

Greybeard runs from one executable. It includes the runtime, application, SQLite library, skills, and logo. You do not install Node, npm, Git, or a source checkout. Its extracted runtime assets, settings, and memory database live in application data.

## Windows x64

1. Download `greybeard-win32-x64.exe` and `SHA256SUMS.txt` from the authenticated release.
2. In PowerShell, display the downloaded executable's checksum and compare it with the matching line in `SHA256SUMS.txt`:

   ```powershell
   Get-FileHash "$env:USERPROFILE\Downloads\greybeard-win32-x64.exe" -Algorithm SHA256
   ```

3. Create `%LOCALAPPDATA%\Greybeard\bin`, move the verified executable there, and rename it to `greybeard.exe`. Use a permanent folder, because setup stores this executable path in your client configurations.
4. Double-click `greybeard.exe` for local graphical setup, or run:

   ```powershell
   & "$env:LOCALAPPDATA\Greybeard\bin\greybeard.exe" setup
   ```

5. Select your installed AI clients, finish setup, and restart those clients.

The release assets include signing metadata. Check the executable's actual publisher details if Windows presents a security prompt; a checksum verifies the selected bytes, not a publisher signature. A native Windows ARM64 executable is not included.

Windows supports local mentor setup. Tenant connection and automatic executable replacement are not implemented on Windows in this release.

## Apple Silicon Mac

Requires macOS 14 or later.

1. Download `greybeard-darwin-arm64.dmg` and `SHA256SUMS.txt` from the authenticated release.
2. In Terminal, compare the disk image checksum with its line in `SHA256SUMS.txt`:

   ```sh
   shasum -a 256 "$HOME/Downloads/greybeard-darwin-arm64.dmg"
   ```

3. Open the DMG and drag **Greybeard.app** onto **Applications**.
4. Eject the disk image, then open **Greybeard** from Applications. Opening the app while it is still on the disk image displays installation instructions.
5. Select your installed AI clients, finish setup, and restart those clients.

For terminal setup, use the installed app's launcher:

```sh
"/Applications/Greybeard.app/Contents/MacOS/GreybeardLauncher" setup
```

The release workflow requires Developer ID signing and Apple notarization for the app and DMG, staples both tickets, and verifies the installed app. Results are recorded in `greybeard-darwin-arm64.dmg.metadata.json`. An Intel Mac build is not included. The original `.tar.gz` remains a legacy CLI asset; the DMG is the recommended Mac installation.

## Terminal installer

The optional installers put the application in a stable location and run terminal setup. They require the expected SHA-256 from the authenticated release. The release tag defaults to `v0.1.0`.

For the private download, use an already authenticated GitHub CLI with repository access, or download the asset in your browser and set `GREYBEARD_RELEASE_FILE`. GitHub CLI is optional; the manual installation above requires no package manager. [GitHub CLI release download reference](https://cli.github.com/manual/gh_release_download).

After downloading `install.sh` from the same release, macOS or Linux users can run:

```sh
GREYBEARD_RELEASE_SHA256='<matching DMG or Linux archive hash from the release>' sh install.sh
```

To use a DMG already downloaded in the browser instead:

```sh
GREYBEARD_RELEASE_FILE="$HOME/Downloads/greybeard-darwin-arm64.dmg" GREYBEARD_RELEASE_SHA256='<matching DMG hash>' sh install.sh
```

The shell installer supports Apple Silicon macOS 14+ and x64 Linux. On Mac it verifies the DMG checksum, publisher signature, and Gatekeeper assessment, copies the app to `~/Applications/Greybeard.app`, ejects the image, and runs terminal setup. Set `GREYBEARD_APP_DIR` to choose another Applications directory. On Linux, it verifies and extracts the single executable from `greybeard-linux-x64.tar.gz` into `~/.local/bin/greybeard`.

After downloading `install.ps1` from the same release, Windows users can run:

```powershell
$env:GREYBEARD_RELEASE_SHA256 = '<matching executable hash from the release>'
.\install.ps1
```

To use the browser download instead of GitHub CLI:

```powershell
$env:GREYBEARD_RELEASE_FILE = "$env:USERPROFILE\Downloads\greybeard-win32-x64.exe"
$env:GREYBEARD_RELEASE_SHA256 = '<matching executable hash>'
.\install.ps1
```

The default Windows destination is `%LOCALAPPDATA%\Greybeard\bin\greybeard.exe`. Windows and Linux accept `GREYBEARD_BIN_DIR` for a different permanent directory; Mac uses `GREYBEARD_APP_DIR`. All accept `GREYBEARD_RELEASE_TAG` for a later specific release. They refuse to overwrite an existing installation. On Windows and Linux, add the executable directory to your PATH to type `greybeard` from any terminal. On Mac, invoke the installed app launcher shown above (under `~/Applications` when using the shell installer). No script disables operating-system security settings.

## First run and local data

Graphical setup uses a private session link on `127.0.0.1`. Keep that link private and close setup when finished. You can complete mentor-only setup without a Microsoft sign-in, app registration, or tenant permissions. Optional tenant access is separate.

The application creates its data directory at:

- Windows: `%APPDATA%\greybeard`
- macOS: `~/Library/Application Support/greybeard`
- Linux: `$XDG_DATA_HOME/greybeard`, or `~/.local/share/greybeard`

The same executable serves local MCP connections and setup. Embedded runtime assets are extracted into an owned, integrity-checked data directory. Settings and SQLite memories stay outside the executable. Use `--app-data <directory>` consistently if you choose a different store.

## Replacing Greybeard

There is **no configured automatic-update feed** for this release. Notify remains the default setting, but selecting Automatic does not install new GitHub releases. `greybeard update` explains that no feed is available unless a trusted publisher feed has been configured independently.

To install a later release:

1. Download and verify its matching DMG, executable, or archive.
2. Close Greybeard setup and quit AI clients that are running its MCP process.
3. Retain the current application as a separate backup, then place the replacement at the same permanent path. On Mac, replace the complete `Greybeard.app` from the new DMG; do not replace its inner executable independently.
4. Keep the application-data directory. Do not replace the memory database with an older copy.
5. Reopen Greybeard and your AI clients. If you moved the executable to a different path, rerun setup to update the integrations.

The update engine includes signed-metadata validation and staged replacement for supported POSIX paths, but publisher-key distribution and a live release feed are separate work. Windows automatic activation is not implemented. Custom binary update feeds are unsupported inside the Mac app bundle; use whole-app replacement to preserve its signature. Keeping an old executable does not establish that it can read a newer database schema; consult the later release's migration notes before reverting.

## Build and distribution evidence

Release assets are built for their actual OS and architecture with Node 22.23.2. The workflow runs source checks and exercises the executable outside the checkout. The final release handoff records the source commit, workflow outcomes, and asset hashes. Those checks do not certify every personal machine or organizational policy.

The release includes checksums and per-platform metadata describing signing. macOS ad-hoc signing is distinct from Apple publisher signing and notarization. No feed signing key or publisher identity is embedded as a substitute for real release provisioning.

### Maintainer signing setup

Run the **Executable artifacts** workflow from the intended release commit with `release=true` and `macos-signing=developer-id` to require both Windows publisher signing and Apple notarization. Ordinary push builds produce candidates. A signing failure never falls back to an unsigned release artifact.

Windows uses the repository secrets `GREYBEARD_SIGNING_TENANT_ID`, `GREYBEARD_SIGNING_CLIENT_ID`, and `GREYBEARD_SIGNING_CLIENT_SECRET` for the configured Azure signing account and certificate profile.

Apple signing uses these repository secrets, matching the existing publisher's naming:

| Secret | Value |
| --- | --- |
| `CSC_LINK` | Base64-encoded Developer ID Application certificate and private key exported as `.p12` |
| `CSC_KEY_PASSWORD` | Password protecting that `.p12` |
| `APPLE_API_KEY` | Original notarization API `.p8` private-key contents |
| `APPLE_API_KEY_ID` | API key identifier |
| `APPLE_API_ISSUER` | API issuer identifier |

The workflow verifies Apple Team ID `D259ULY2B4`, signs the embedded SQLite library before packaging, signs the executable with hardened runtime, and requires notarization status `Accepted`. Temporary signing material is removed at job completion. The workflow then packages `Greybeard.app`, signs its launcher and bundle, notarizes and staples the app, and creates a signed, notarized, stapled DMG. It mounts the final image, verifies signatures and tickets, checks launch from an installed copy, and exercises the shell installer.

To add a DMG around the already published 0.1 runtime, also set `dmg-only=true`. This mode downloads and verifies the pinned original archive and executable hashes without rebuilding the runtime or moving `v0.1.0`. Its metadata records `softwareSourceSha` for the released runtime and `packagingSourceSha` for the app launcher and packaging workflow. The original archive and its metadata remain available for reproducibility. Workflow artifacts are reviewed and then uploaded to the GitHub release; workflow dispatch alone does not publish them.

The OpenAdminOS organization currently uses GitHub Free, so this private repository uses repository-level signing secrets. Organization secrets are not available to private repositories on that plan.

Stored GitHub secret values cannot be read back through the API. Add the original values to this repository's Actions secrets; a secret stored in another repository is not automatically available here. Keep certificates, private keys, and passwords out of commits and release assets.

For development only:

```sh
npm ci
npm run ci
npm run build:executable
npm run test:executable
```

[Node single-executable applications](https://nodejs.org/download/release/latest-v22.x/docs/api/single-executable-applications.html) explains why the native SQLite addon must be materialized before loading. [Release notes](release-notes.md) list the current product limits.
