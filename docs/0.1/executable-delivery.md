# Greybeard 0.1 executable delivery

Greybeard now builds one executable for the build machine's OS and architecture. It includes its Node runtime, application JavaScript, SQLite native addon, skills, and logo. Users do not install Node, Git, npm, or a source checkout.

The executable materializes its embedded native addon and skills in a private, content-addressed runtime directory inside Greybeard app data. This is required by Node's native addon loader; it is one download, not a promise of zero supporting files. Extracted files are checked against embedded SHA-256 hashes before use. Runtime directories reject symbolic links, foreign ownership, and group/world write access on POSIX. The mentor path does not load the legacy native credential extension. Bootstrap resolves `--app-data` before opening assets, session locks, or updates. Its defaults match source installations: `%APPDATA%/greybeard` on Windows, `~/Library/Application Support/greybeard` on macOS, and `$XDG_DATA_HOME/greybeard` (or `~/.local/share/greybeard`) on Linux.

## Current evidence

On the current Linux x64 machine, the built artifact passed an isolated smoke run after copying outside the repository, with an empty PATH and a fresh home and data directory:

- `--help` launched the embedded application.
- `setup --yes` created local configuration and SQLite without a tenant connection.
- `memory list` opened the local SQLite database.
- `mcp memory` completed protocol initialization.
- A locally signed update fixture activated on the next launch and retained the prior executable.
- An invalid pending signature left the installed executable usable.

The artifact is `dist/executable/greybeard-linux-x64`. This is local developer evidence, not a signed published release or a clean-machine certification. Linux system compatibility, macOS and Windows still require their own clean-machine verification. No GitHub workflow or publication was triggered by this implementation.

## Build and verify

Use Node 22.23.2 for the build, including installation of native dependencies:

```sh
npm ci
npm run ci
npm run build:executable
npm run test:executable
```

Build separately on each target OS and architecture. The script names the executable using the actual build platform and architecture. Do not rename an x64 artifact to imply arm64 support. The `Executable artifacts` workflow (source changes or manual dispatch) builds candidates on Linux, Windows, and macOS and uploads CI artifacts. It does not publish npm packages or GitHub releases. The macOS build applies a local ad-hoc signature for execution; that is not a Developer ID signature or notarization.

## Installation contract

Both the shell and PowerShell downloaders fetch the same executable that a person can download and double-click. The shell downloader uses HTTPS-only redirects and verifies the publisher-announced SHA-256 before execution. PowerShell likewise checks SHA-256 and explicitly checks every native process exit code.

No executable release is currently configured as available. The downloaders fail with an explanation unless a release tag and an independently authenticated expected hash are supplied. For a future published artifact, terminal usage has this shape:

```sh
GREYBEARD_RELEASE_TAG='<published-tag>' GREYBEARD_RELEASE_SHA256='<authenticated-platform-hash>' sh install.sh
```

```powershell
$env:GREYBEARD_RELEASE_TAG = '<published-tag>'
$env:GREYBEARD_RELEASE_SHA256 = '<authenticated-platform-hash>'
.\install.ps1
```

These are release-operator templates, not working public download instructions. A short public one-line installer must be generated with the actual platform hashes and authenticated distribution URL at release time. A checksum downloaded alongside an unsigned executable does not establish publisher identity by itself. Existing installations are preserved instead of silently overwritten by the initial installer.

## Update trust and modes

Notify is the default. Manual disables scheduled checks. Automatic opts into verified download and staging. A packaged long-running process checks after startup and then daily, using a shared last-check timestamp. An application that is closed does not run a scheduler. The checks never write to MCP stdout.

Until a trusted feed is configured, `greybeard update` explains that delivery is unavailable and leaves the executable unchanged. Operators configure:

- `GREYBEARD_UPDATE_MANIFEST_URL`: an HTTPS manifest URL, with its detached binary signature at the same URL plus `.sig`.
- `GREYBEARD_UPDATE_PUBLIC_KEY_FILE`: an independently provisioned Ed25519 publisher public key file. The key is not obtained from the manifest or its server.

The signed manifest covers schema, public version, monotonically increasing build sequence, expiry, OS, architecture, executable URL, byte size, and SHA-256. Downloads enforce HTTPS redirects, redirect count, timeout, and size bounds. Wrong signatures, expired metadata, repeated or older accepted sequences, wrong platforms, and corrupted artifacts fail closed. `greybeard update --stage` requests a download explicitly in Notify mode.

Public copy remains version **0.1**. Build sequences distinguish executable revisions without inventing new product versions. The workspace package versions are developer dependency metadata and currently remain 0.1.1. Do not treat the unrelated historical Git tag as an executable build sequence.

## Activation and recovery

On POSIX packaged installations, a staged update activates at the next launch before opening SQLite or an MCP session. It rechecks the publisher signature, expiry, target, monotonic sequence, and artifact hash. Startup and activation share a short ownership lock; live peer processes defer activation. Dead-process session records are cleaned up. A stale activation lock is recovered when its owner is dead, or after a grace period when no owner record was written.

The candidate must pass a startup check. The current executable is copied to `<executable>.previous`, then a same-directory candidate atomically replaces the installed executable. The new process starts with the user's original arguments. An invalid or unusable pending candidate leaves the current application available. Recovery retains the previous executable; an operator can close Greybeard and restore that file. Greybeard never restores or deletes the memory database as a side effect of executable recovery. Database schema downgrade compatibility remains a release requirement.

Windows automatic replacement is not implemented because a running executable requires a separate replacement process and a verified Windows installation ownership/recovery design. Windows may check and stage; it must not claim activation on restart until that separately signed helper is implemented and validated. POSIX logic has passed local Linux fixtures; macOS replacement is not yet verified.

## Release blockers

- Establish protected Ed25519 release signing, key distribution/rotation, and an authenticated manifest feed. No vendor signing key or feed was fabricated.
- Sign and notarize macOS distributions, and sign Windows executables and their eventual replacement helper with real publisher identities.
- Validate runtime dependencies, file permissions/ACLs, uninstall behavior, simultaneous launches, and activation/recovery on clean target machines, including each advertised architecture.
- Verify memory migration compatibility with the retained executable before advertising automatic rollback across schema changes.
- Generate actual installer URLs, platform hashes, and release metadata only after signed artifacts exist.

Production dependency audit currently reports zero vulnerabilities after compatible lockfile updates. Two moderate findings remain in the development-only Vitest toolchain and require a major-version upgrade decision; this work did not force that upgrade.

Reference: [Node single-executable applications](https://nodejs.org/download/release/latest-v22.x/docs/api/single-executable-applications.html).
