# KQL Table Cheatsheets

Column names vary by connector version and workspace configuration. If a query fails, inspect with `getschema` or `take 5` and adjust names without changing the query intent.

## IntuneDevices

Use for Intune device inventory and device query style reports.

Common columns:

| Column | Use |
|---|---|
| `TimeGenerated` | Time filter. |
| `DeviceName` | Device display name. |
| `UserPrincipalName` | Primary or enrolled user, depending on source. |
| `OperatingSystem` | OS family. |
| `OSVersion` | OS version. |
| `ComplianceState` | Compliance state. |
| `ManagementState` | Management state. |
| `LastContact` | Last check-in time when present. |

Example:

```kusto
let Lookback = 7d;
IntuneDevices
| where TimeGenerated >= ago(Lookback)
| where ComplianceState =~ "NonCompliant"
| project TimeGenerated, DeviceName, UserPrincipalName, OperatingSystem, OSVersion, ComplianceState, LastContact
| order by TimeGenerated desc
```

## DeviceComplianceOrg

Use for compliance policy rollups and device compliance reporting.

Common columns:

| Column | Use |
|---|---|
| `TimeGenerated` | Time filter. |
| `DeviceName` | Device name. |
| `UserPrincipalName` | Associated user. |
| `ComplianceState` | Compliance state. |
| `PolicyName` | Compliance policy name when present. |
| `OS` | OS family when present. |
| `SerialNumber` | Hardware identifier when present. |

Example:

```kusto
let Lookback = 14d;
DeviceComplianceOrg
| where TimeGenerated >= ago(Lookback)
| where ComplianceState !in~ ("Compliant", "NotApplicable")
| project TimeGenerated, DeviceName, UserPrincipalName, PolicyName, ComplianceState, OS, SerialNumber
| summarize Latest=max(TimeGenerated), States=make_set(ComplianceState), Policies=make_set(PolicyName) by DeviceName, UserPrincipalName
| order by Latest desc
```

## SigninLogs

Use for Entra sign-in analysis and Conditional Access outcomes.

Common columns:

| Column | Use |
|---|---|
| `TimeGenerated` | Time filter. |
| `UserPrincipalName` | User identity. |
| `AppDisplayName` | Application. |
| `ResultType` | Numeric result code. |
| `ResultDescription` | Human-readable result. |
| `ConditionalAccessStatus` | CA status. |
| `IPAddress` | Source IP. |
| `Location` | Dynamic location object. |
| `DeviceDetail` | Dynamic device object. |
| `Status` | Dynamic status object. |

Example:

```kusto
let Lookback = 24h;
SigninLogs
| where TimeGenerated >= ago(Lookback)
| where ResultType != 0
| project TimeGenerated, UserPrincipalName, AppDisplayName, ResultType, ResultDescription, ConditionalAccessStatus, IPAddress
| summarize Failures=count(), Apps=make_set(AppDisplayName, 10) by UserPrincipalName, ResultType, ResultDescription
| order by Failures desc
```

## AuditLogs

Use for directory changes, policy updates, group membership changes, and admin actions.

Common columns:

| Column | Use |
|---|---|
| `TimeGenerated` | Time filter. |
| `OperationName` | Operation name. |
| `Category` | Audit category. |
| `Result` | Success or failure. |
| `InitiatedBy` | Dynamic actor object. |
| `TargetResources` | Dynamic target array. |
| `ActivityDateTime` | Activity timestamp when present. |

Example:

```kusto
let Lookback = 7d;
AuditLogs
| where TimeGenerated >= ago(Lookback)
| where OperationName has_any ("Add member", "Remove member", "Update conditional access policy", "Add app role assignment")
| project TimeGenerated, OperationName, Result, InitiatedBy, TargetResources
| extend Actor = tostring(InitiatedBy.user.userPrincipalName)
| order by TimeGenerated desc
```
