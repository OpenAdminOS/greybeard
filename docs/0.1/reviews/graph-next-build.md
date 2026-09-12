# GB-11 and GB-14 implementation and verification

Implemented in source on 11 September 2026. No tenant changes, permission changes, consent requests, credential changes or release publication were performed.

## Shipped source behavior

The Graph MCP exposes `read-recipe` with seven recipes: compliance policy discovery, one identified policy, its actual assignments, expanded noncompliance actions, managed device inventory with check-in timestamps, Conditional Access policies, and basic groups. Every recipe explicitly uses beta and GET. Collection recipes default to 100 items and five pages, with hard limits of 5,000 items and 50 pages. IDs must be exact GUIDs. The Graph transport follows opaque continuation URLs only on the same Graph origin and collection path and rejects repeated continuation URLs.

Each recipe returns an observation timestamp, endpoint, configured limits, completeness, fallback evidence and request metadata. A page limit, item limit or unconsumed nested continuation marks the evidence partial. A one-page raw Graph preview now also marks itself partial when Microsoft returns a nextLink. A missing response field raises an evidence error instead of being interpreted as an empty or healthy state.

The policy detail recipe reads one full identified object because selecting Windows subtype fields on the base collection failed live. The actions recipe uses the verified parent expansion instead of repeatedly trying the unsupported direct action route. The assignment recipe permits just one same-endpoint retry without projection after a specific select/property 400. A generic 400, 401, 403, unexpected shape or network failure does not trigger broader endpoints, changed credentials or another API version. Existing bounded transient retries remain in the transport.

`previewCapabilities` and the CLI `getConnectionPreview` wrapper expose capability labels, candidate Application permissions, selected fields, exact endpoints, selection state and readiness. Configuration is `unverified` until an explicit check. Each selected read is checked independently; unselected capabilities are never probed. Ready means the dated probe succeeded, including an empty valid collection. It is not a health certificate, license certificate or proof of minimum grants. Failures retain Microsoft's HTTP status, error code and message. App-only failures no longer invent delegated consent, user-role or licensing causes. Consent is never escalated automatically.

`greybeard connect status --verify` performs these checks. Plain status is configuration-only. The legacy `scopes` output now describes the actual customer-owned app-only connection instead of advertising removed delegated sign-in and write enrollment. Connecting requires every selected probe to succeed before saving an active profile. The new `compliance` capability allows only policy collection/object reads and the specific assignment/action navigations; it does not enable managed-device actions or writes.

## Live Lokka verification

Performed 15 Microsoft Graph GET requests, each with `graphApiVersion: "beta"` and `fetchAll: false`, plus two read-only authentication status checks. Raw tenant records and identifiers are intentionally absent from this repository report.

| Probe | Live evidence |
| --- | --- |
| Lab compliance policy discovery, selected base fields | Collection with six records, including id, displayName, lastModifiedDateTime and version; no nextLink in this response. |
| Windows-specific `bitLockerEnabled` selected on the base policy collection | HTTP 400, `BadRequest`, property not found on `microsoft.graph.deviceCompliancePolicy`. |
| One exact Windows policy, full object | Success with id and subtype properties including bitLockerEnabled and secureBootEnabled. |
| Direct policy scheduledActionsForRule navigation | HTTP 400, `No method match route template`. |
| Parent policy with `scheduledActionsForRule($expand=scheduledActionConfigurations)` | Success with a rule and nested action configuration, including actionType and gracePeriodHours. |
| Policy assignments, then exact recipe projection | Both succeeded. Two observed targets: allLicensedUsersAssignmentTarget and allDevicesAssignmentTarget, each with no assignment filter. Editing this policy in place remains broadly targeted; a pilot-named group does not change that. |
| Groups with id/displayName and top one, followed returned opaque nextLink | Both pages succeeded and each exposed another nextLink. Lokka's `partial:false` envelope did not mean the entire collection was read. |
| Managed devices with id/deviceName/operatingSystem/complianceState/lastSyncDateTime and top one | Valid collection with count and nextLink. A current API read does not make an old lastSyncDateTime fresh. |
| Conditional Access selected fields | Valid collection with id, displayName, state, conditions and grantControls. |
| Users selected fields | Valid collection with id, displayName, department, jobTitle and nextLink. |
| Production organization and groups selected probes | Both HTTP 403, `Authorization_RequestDenied`, “Insufficient privileges to complete the operation.” No retry using a broader identity and no consent request. |

The authenticated lab identity carries broad read and write grants. The production identity exposes three application-related roles, not a verified group-read capability. All execution here used GET. These identities verify endpoint shapes and error behavior, not the smallest possible grants. Isolated minimum-grant certification remains an external verification requirement; the implementation explicitly reports `minimumGrantsVerified:false` rather than pretending broad lab success proves least privilege. Production group preview remains unavailable with the current identity; a customer must configure their chosen read capability in their own existing registration workflow to use it.

## Automated evidence

Graph suite: 97 tests pass on Linux, including eight new checks covering opaque paging and page limits, one-page partial status, exact identified policy/action request shapes, narrow single fallback and no 403 fallback, invalid IDs, nested continuation completeness, malformed responses, no unselected probes, exact403 diagnostic preservation, no app-only consent/license inference, and compliance capability path boundaries. Certificate-dependent tests use temporary synthetic credentials and mock token acquisition. No automated test uses a live tenant or real secret.

Companion integration consumes `cli/src/connectionPreview.ts`. Windows private-key loading remains intentionally unavailable in the existing certificate provider until its protected provider can be verified. This work does not conceal that limitation or weaken credential file checks to make the preview green.

## Windows protected key implementation

A follow-up implementation replaces the blanket Windows block with a handle-bound credential reader. It invokes the system Windows PowerShell 5.1 with fixed encoded code; a file path is passed as data, never inserted into a script or shell command. Native `CreateFile` opens the existing file without following a final reparse point, permitting read sharing only. The reader checks the final handle path, rejects junction/reparse ancestors, non-disk files, hard links and files larger than 64 KiB. ACL inspection and the bounded read use the same file handle. Ownership must match the current user SID. Allow entries may grant access only to that user, SYSTEM and local Administrators, which form Windows' existing ownership-recovery boundary. Null, unsupported or callback ACLs are rejected. The ACL is rechecked after reading; failures return a fixed diagnostic and never the child process error object or key output. Existing POSIX ownership/mode checks remain unchanged.

Six Windows-only tests exercise actual NTFS ACL allowance/rejection, different ownership, junctions, size limits, safe path handling and certificate/private-key loading through the actual application provider. They run under the existing Windows CI matrix and must pass there before Windows verification is claimed. Linux can validate TypeScript, the separate POSIX tests and C# syntax, but cannot establish Windows ACL behavior. At local handoff: 98 Linux tests pass; six Windows-only tests await Windows execution.

Primary implementation references: [FileStream.GetAccessControl](https://learn.microsoft.com/en-us/dotnet/api/system.io.filestream.getaccesscontrol?view=netframework-4.8.1), [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew), and [GetFinalPathNameByHandleW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew). The follow-up supersedes the earlier blanket-provider restriction described above once its Windows checks have passed.
