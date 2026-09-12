# Graph Mechanics

For application registrations, service principals, OAuth permission grants, and federated identity credentials, use explicit `beta` calls. When resolving delegated permission IDs from a resource service principal, read `publishedPermissionScopes` first and use `oauth2PermissionScopes` only as a compatibility fallback. Application permissions are `appRoles`, not scopes.

## Beta Default

Greybeard 0.1 uses explicit `apiVersion: "beta"`. Report the version from `meta.apiVersion`. Treat API behavior and permissions as evidence-dependent.

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

- If access is unavailable, report the exact endpoint and error. Ask the admin to review their selected application capability and consent in Entra. Greybeard 0.1 does not request or grant additional permissions.
- Missing Entra ID P1 license: report the license gate, do not request scope.
- Missing directory role: report the needed reporting or admin role, do not request scope.

## Read and Write Boundary

Use `graph` for GET and all-GET `$batch` only. Any create, update, delete, assignment, revocation, or policy change must be represented as operations and routed through `change-plan`.
