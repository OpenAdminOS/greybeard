# Greybeard 0.1 MCP tools

The same application runs as `greybeard mcp memory` or `greybeard mcp graph`. Setup writes client-specific transport configuration with the application-data path, profile, and tenant identity. MCP stdout is reserved for protocol messages.

## Memory

- `recall`: short query, optional scope, limit, and retrieval budget. Returns applicable confirmed non-superseded guidance. Expanded results are bounded and candidates are excluded.
- `remember`: type, reusable intent, optional scope, correction relationship, and links. Always creates a candidate. The MCP channel cannot supply confirmation or pretend to be a local user.
- `list`: inspect records by type/status and page cursor. Candidates remain explicitly unverified.
- `forget`: model-side deletion is restricted to candidates; confirmed guidance can only be removed in local controls.

Confirmation and correction approval are deliberately absent from MCP. Local controls preview the exact record and submit its immutable revision to an atomic confirmation operation. Deleting and recreating an ID cannot confirm an unseen replacement. Local processes sharing the same OS account are outside this application trust boundary.

## Optional tenant reads

- `graph`: GET reads and validated all-GET batch requests using explicit beta. Selected application capabilities restrict supported endpoint paths. Bounded paging checks continuation origin/path, detects cycles, caps pages/items, and bounds response streams and retries. Request redirects cannot forward the bearer token elsewhere.
- `get-auth-status`: customer application identity, checked roles, and read-only state. No access token is returned and no user role or license probe is implied.

The app-only provider rejects missing/excess roles, incorrect identity/audience, delegated or uninspectable tokens, and changed connection configuration. Minimum-grant validation is a separate release requirement; successful reads on the current broadly granted connection do not certify it.

There are no `plan-write`, `check-plan`, `execute-plan`, `add-scope`, or `remove-scope` tools in the 0.1 server. Retained legacy write-engine code is inaccessible through the shipped service and MCP surface.

The original delegated contracts and schema are retained in [the historical tool specification](history/original-mcp-tools.md), not as a current API reference.
