# Optional shared memory

Greybeard 0.1.2 adds a private server for one administrator's multiple computers. Local memory remains the default. First-time setup has no server step or account requirement.

Shared mode sends bounded relevant prompt or command text to your own server for automatic mentoring. It does not send transcript files, working directories, environment objects, or full tool output. Existing privacy checks run before event forwarding. Activity retains bounded metadata, not raw prompts. Your AI provider can still receive recalled lessons as part of its normal conversation.

## Server setup

The initial server target is Linux x64 with local persistent storage. The bundled CLI runs headlessly; the companion is not required on the server. The executable is built by `npm run build:executable` and is available in the companion's bundled service resources. This PR does not publish a standalone server download. Use the candidate build for testing and only claim release availability once artifacts are published.

Run under a dedicated account with a private application-data directory. Keep SQLite and its WAL files on that host's disk, not NFS/SMB or a mounted folder shared between computers. Configure an administrator-managed private HTTPS reverse proxy or Tailscale HTTPS endpoint with a certificate trusted by the clients. Forward to the loopback listener; preserve request headers and bodies. Do not expose it publicly or disable certificate validation.

```sh
greybeard server start --app-data /var/lib/greybeard-shared \
  --port 47831 --public-url https://memory.example.com
```

The server listens only on `127.0.0.1`. The public URL is an HTTPS origin without a path, credentials, query, or fragment. No implicit network listener starts in local mode. For a persistent service, adapt the [systemd example](../server/greybeard-memory.service), including the executable location, account, and URL.

On the server owner's interactive terminal, using the same OS account and data directory:

```sh
greybeard server enroll --app-data /var/lib/greybeard-shared --review
```

The owner explicitly approves review authority. The printed code works once and expires after ten minutes. Generate a separate code for each computer. Omit `--review` for a device limited to memory tools and hooks; that device cannot use companion review or export. Optional `--profile` and `--tenant` labels bind a device to one memory identity. These are memory labels, not login credentials. The shared pause is server-wide.

## Connect a computer

1. Install Greybeard normally and finish the existing local setup.
2. Open **App preferences > Advanced > Shared memory**.
3. Enter the private HTTPS server URL and its single-use pairing code.
4. Read and accept the disclosure, then connect.
5. Fully restart your AI tools. Their existing local MCP and hook commands remain in place and now use the selected shared store.

Linux clients need `secret-tool` and an unlocked Secret Service. macOS uses Keychain; Windows uses CurrentUser DPAPI. There is no plaintext credential fallback. Review credentials are separate from agent credentials and are never written into AI client configurations. OS account access remains a trust boundary: this does not isolate hostile processes already running as your account.

The shared store starts independently of existing local memories. No automatic upload, merge, or copying occurs. Create a shared proposal, inspect its exact wording in the companion, and confirm it. Another device can then recall it during a relevant task. MCP has no confirmation tool.

## Daily operation

The companion identifies the shared URL and profile. List, map, review, corrections, export, and activity use that store. Review checks the displayed store and record revision; if either changed, refresh and review again. Export transfers bounded pages and rejects a changing snapshot rather than silently mixing records.

The normal learning pause affects this device. Advanced settings also provide **Pause shared store** and **Resume shared store**, which apply to all devices. Shared capture and recall stop while paused; exact human confirmation, inspection, and export remain available. Local mode keeps its existing pause behavior.

When the server is unavailable, shared memory reports an error. Hooks return empty context within a 1.5-second processing deadline on macOS/Linux or 2.5 seconds on Windows (including native credential lookup) and do not block the host. There is no silent fallback to local records, offline memory cache, or replay queue. An interrupted mutation may have committed: inspect the current records before repeating it. Request IDs deduplicate transport replays for 24 hours; requests older than that are rejected. The server retains replay records for two days. Forgetting records discards stored mutation response snapshots while retaining replay tombstones, so old retries cannot recreate forgotten content.

To return to the retained local store, choose **Return to local memory**, or run:

```sh
greybeard shared-memory status
greybeard shared-memory disconnect
```

Restart your AI tools after switching. Existing MCP sessions retain their old binding; disconnect revokes the device when reachable, so those sessions may need to be restarted before they work again. Disconnect does not delete server memories. If the server is offline or OS credential removal fails, Greybeard reports the outstanding cleanup instead of claiming success.

## Revoke, back up, and recover

Use the server account and the same data directory:

```sh
greybeard server devices --app-data /var/lib/greybeard-shared
greybeard server revoke --device DEVICE_ID --app-data /var/lib/greybeard-shared
greybeard server backup --out /secure-backups/greybeard-new.db \
  --app-data /var/lib/greybeard-shared
```

Each backup must use a new file. The SQLite backup includes memories and server authentication metadata. Separately preserve `config.json` for shared pause/settings. Protect backups as private data. For restore, stop the service, preserve the existing data directory as a recovery copy, place the backup as `memory.db` in a fresh private data directory owned by the service account, and restore the intended configuration. Do not combine old WAL/SHM files with the restored database.

Before restarting a restored server, run interactively:

```sh
greybeard server reset-credentials --app-data /var/lib/greybeard-shared
```

This rotates store identity and revokes every device and enrollment code so a backup cannot resurrect credentials revoked after it was taken. Pair devices again. For upgrades, back up first, stop the service, replace the executable, then restart and check status. Retain the previous executable and database backup; do not assume a future schema can be opened by an older binary.

## Compatibility and verification

This uses Streamable HTTP between Greybeard's local adapter and private server. It is not a general OAuth connector for third-party hosted clients. The legacy standalone `greybeard-memory` entry point refuses a remote configuration and directs users to `greybeard mcp memory`.

Automated evidence covers two isolated client processes, trusted TLS, native Linux credential storage, a packaged Linux server with empty PATH/display, and Claude-shaped hook events. These checks do not substitute for two physical machines running real Claude Code conversations. See the [implementation evidence and release gates](implementation-status.md). Windows/macOS credential and real host remote workflows need their own release evidence. Existing local client support is unchanged.
