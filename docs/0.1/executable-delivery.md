# Install Greybeard 0.1

The release tag is `v0.1.0`; the application displays **0.1**. The repository remains private. Open the [release page](https://github.com/ugurkocde/greybeard/releases/tag/v0.1.0) while signed into a GitHub account with access. The final release handoff confirms publication and asset hashes.

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

1. Download `greybeard-darwin-arm64.tar.gz` and `SHA256SUMS.txt` from the authenticated release.
2. In Terminal, display the archive checksum and compare it with the matching line in `SHA256SUMS.txt`:

   ```sh
   shasum -a 256 "$HOME/Downloads/greybeard-darwin-arm64.tar.gz"
   ```

3. Expand the archive in Finder. It contains one executable named `greybeard`, with its executable permission preserved.
4. Create `~/Applications/Greybeard` and move the executable there **before running setup**. Open it from Finder, or launch graphical setup from Terminal:

   ```sh
   "$HOME/Applications/Greybeard/greybeard" setup --ui
   ```

5. Select your installed AI clients, finish setup, and restart those clients.

The platform metadata records whether the delivered Mac executable is Developer ID signed and notarized. Signing credentials alone do not establish a completed notarization. If the delivered artifact is explicitly marked ad-hoc and macOS blocks the verified download, Apple's documented route is **System Settings > Privacy & Security > Open Anyway** after the opening attempt. Use the exception only for the Greybeard file you obtained and verified. Do not disable Gatekeeper globally. [Apple's opening instructions](https://support.apple.com/en-gb/102445).

This asset is for Apple Silicon. An Intel Mac executable is not included.

## Terminal installer

The optional installers put the same executable in a stable location and run terminal setup. They require the expected SHA-256 from the authenticated release. The release tag defaults to `v0.1.0`.

For the private download, use an already authenticated GitHub CLI with repository access, or download the asset in your browser and set `GREYBEARD_RELEASE_FILE`. GitHub CLI is optional; the manual installation above requires no package manager. [GitHub CLI release download reference](https://cli.github.com/manual/gh_release_download).

After downloading `install.sh` from the same release, macOS or Linux users can run:

```sh
GREYBEARD_RELEASE_SHA256='<matching archive hash from the release>' sh install.sh
```

To use an archive already downloaded in the browser instead:

```sh
GREYBEARD_RELEASE_FILE="$HOME/Downloads/greybeard-darwin-arm64.tar.gz" GREYBEARD_RELEASE_SHA256='<matching archive hash>' sh install.sh
```

The shell installer supports Apple Silicon macOS and x64 Linux. The Linux asset is `greybeard-linux-x64.tar.gz`. Both archives contain the single member `greybeard`; the installer verifies the archive hash before extracting or executing it. The default destination is `~/.local/bin/greybeard`.

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

The default Windows destination is `%LOCALAPPDATA%\Greybeard\bin\greybeard.exe`. Both installers accept `GREYBEARD_BIN_DIR` for a different permanent directory and `GREYBEARD_RELEASE_TAG` for a later specific release. They refuse to overwrite an existing installation. Add the destination directory to your PATH if you want to type `greybeard` from any terminal. No script disables operating-system security settings.

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

1. Download and verify its matching executable or archive.
2. Close Greybeard setup and quit AI clients that are running its MCP process.
3. Retain the current executable as a separate backup, then place the replacement at the same permanent path.
4. Keep the application-data directory. Do not replace the memory database with an older copy.
5. Reopen Greybeard and your AI clients. If you moved the executable to a different path, rerun setup to update the integrations.

The update engine includes signed-metadata validation and staged replacement for supported POSIX paths, but publisher-key distribution and a live release feed are separate work. Windows automatic activation is not implemented. Keeping an old executable does not establish that it can read a newer database schema; consult the later release's migration notes before reverting.

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

The workflow verifies Apple Team ID `D259ULY2B4`, signs the embedded SQLite library before packaging, signs the executable with hardened runtime, and requires notarization status `Accepted`. Temporary signing material is removed at job completion. The raw executable has no stapled ticket; macOS retrieves its notarization ticket online.

Stored GitHub secret values cannot be read back through the API. Add the original values to this repository's Actions secrets; a secret stored in another repository is not automatically available here. Keep certificates, private keys, and passwords out of commits and release assets.

For development only:

```sh
npm ci
npm run ci
npm run build:executable
npm run test:executable
```

[Node single-executable applications](https://nodejs.org/download/release/latest-v22.x/docs/api/single-executable-applications.html) explains why the native SQLite addon must be materialized before loading. [Release notes](release-notes.md) list the current product limits.
