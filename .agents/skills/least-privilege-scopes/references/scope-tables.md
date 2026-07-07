# Scope Tables

Use delegated scopes. Greybeard read-only setup starts with a narrow Tier 1 set and requests Tier 2 only on first need. Every tenant-admin scope requires admin consent.

## Tier 1

| Task | Minimal scope | Admin consent | Extra gate | Notes |
|---|---|---:|---|---|
| Read users, count disabled users, list guests | `User.Read.All` | yes | none | Use `$select`; use `$count` plus `ConsistencyLevel: eventual` for counts. |
| Read groups and memberships | `Group.Read.All` | yes | none | Use `$select`; use `$batch` only for all-GET fanout. |
| Read Conditional Access policies | `Policy.Read.All` | yes | none | Resolve application display names only if `Application.Read.All` is granted. |
| Read subscribed SKUs | `LicenseAssignment.Read.All` | yes | directory role for delegated access | Greybeard setup may already have `Organization.Read.All`; the least-privileged Graph permission is `LicenseAssignment.Read.All`. |
| MFA registration report | `AuditLog.Read.All` | yes | Entra ID P1 and reporting role | Endpoint: `/reports/authenticationMethods/userRegistrationDetails`. |
| User sign-in activity | `AuditLog.Read.All` plus `User.Read.All` | yes | Entra ID P1 and reporting role | `signInActivity` is selected on `/users`; do not widen to `Directory.Read.All` by default. |
| Usage and reports | `Reports.Read.All` | yes | reporting role for delegated reports | Some reporting surfaces also need product licenses. |

Reporting roles include Reports Reader, Security Reader, Security Administrator, Global Reader, or a higher admin role.

## Tier 2

| Task | Minimal scope | Admin consent | Extra gate | Notes |
|---|---|---:|---|---|
| Intune managed devices | `DeviceManagementManagedDevices.Read.All` | yes | Intune license | Endpoint: `/deviceManagement/managedDevices`. |
| Intune compliance policies and configuration profiles | `DeviceManagementConfiguration.Read.All` | yes | Intune license | Endpoints under `/deviceManagement/deviceCompliancePolicies` and `/deviceManagement/deviceConfigurations`. |
| Intune mobile apps and assignments | `DeviceManagementApps.Read.All` | yes | Intune license | Endpoint: `/deviceAppManagement/mobileApps`. |
| Entra devices | `Device.Read.All` | yes | none | Use only when device directory objects are needed outside Intune managed devices. |
| Application and service principal names | `Application.Read.All` | yes | none | Needed to resolve app IDs in Conditional Access and app hygiene reports. |
| Directory role assignments | `RoleManagement.Read.Directory` | yes | Entra role visibility can still be role-gated | Endpoint: `/roleManagement/directory/roleAssignments`. |
| Identity Protection risky users | `IdentityRiskyUser.Read.All` | yes | Entra ID P2 for many Identity Protection features | Roadmap for risky sign-ins. |
| Secure Score and security events | `SecurityEvents.Read.All` | yes | security portal role may apply | Roadmap for secure score. |

## Write Scopes

Never request write scopes on the first-party read-only app. In read-only mode, write-scope requests return `E_WRITES_NOT_CONFIGURED`; tell the admin to run `greybeard setup --writes`.

Common write scopes after writes mode is configured:

| Write task | Scope |
|---|---|
| Update users | `User.ReadWrite.All` |
| Update groups or memberships | `Group.ReadWrite.All` |
| Update Conditional Access policies | `Policy.ReadWrite.ConditionalAccess` |
| Update Intune configuration | `DeviceManagementConfiguration.ReadWrite.All` |
| Update Intune apps | `DeviceManagementApps.ReadWrite.All` |

Every write still goes through `change-plan`; consent alone is not authorization to execute.

## 403 Handling

When `graph` returns a missing-scope 403:

1. Read the exact `missingScope` returned by the server.
2. Call `add-scope` with that one scope and a concrete reason.
3. If `granted` is true, retry the original scoped call once.
4. If `granted` is false, relay the returned `consentUrl` and one-line justification.
5. If the error is missing license or missing directory role, do not call `add-scope`; report the real gate.
