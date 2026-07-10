# Graph Mechanics

For application registrations, service principals, OAuth permission grants, and federated identity credentials, prefer explicit `v1.0` calls. When resolving delegated permission IDs from a resource service principal, read `publishedPermissionScopes` first and use `oauth2PermissionScopes` only as a compatibility fallback. Application permissions are `appRoles`, not scopes.

## Beta Default

Greybeard uses `apiVersion: "beta"` by default for full Microsoft Graph surface coverage. Beta endpoints can change without notice. A caller may pin `apiVersion: "v1.0"` for a specific call when stability matters more than surface coverage. Report the actual version from `meta.apiVersion`; `meta.usedBeta` remains available for compatibility.

## Query Discipline

Always use `$select` on collection reads unless the endpoint does not support it. Examples:

```json
{
  "path": "/users",
  "query": {
    "$select": "id,displayName,userPrincipalName,accountEnabled",
    "$filter": "accountEnabled eq false"
  }
}
```

Use `$filter` to reduce rows. For directory object counts, add:

```json
{
  "headers": { "ConsistencyLevel": "eventual" },
  "query": { "$count": "true" }
}
```

Do not combine unsupported advanced filters. For `signInActivity`, use the documented supported filters or select the property and filter locally when mixing with other user properties.

## Pagination

Use `fetchAll: true` only when the full set is required. Set `maxItems` based on the task:

- 25 to 100 for previews.
- 1000 for normal reports.
- 5000 for tenant-wide counts.

If `meta.truncated` is true, state that the answer is partial.

## `$batch`

Greybeard allows `POST /$batch` only when every inner request is GET. Use it for fanout after a scoped list, such as getting owners for up to 20 groups at a time.

Batch rules:

- Maximum 20 inner requests.
- No write verbs inside a batch.
- Keep each inner request scoped with `$select`.
- Preserve result mapping to the source row.

## Throttling

The `graph` tool honors `Retry-After` on 429 and 503 up to its retry limit. If throttling remains, report it with `meta.throttled` and suggest narrowing filters or splitting the task.

## Error Classes

Greybeard classifies:

- Missing scope: call `add-scope` for the exact missing scope.
- Missing Entra ID P1 license: report the license gate, do not request scope.
- Missing directory role: report the needed reporting or admin role, do not request scope.

## Read and Write Boundary

Use `graph` for GET and all-GET `$batch` only. Any create, update, delete, assignment, revocation, or policy change must be represented as operations and routed through `change-plan`.
