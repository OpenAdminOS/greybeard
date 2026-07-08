# Trigger Tests

| Prompt | Expected behavior |
|---|---|
| What Graph scopes do I need to read Intune compliance policies? | `least-privilege-scopes` should fire and name `DeviceManagementConfiguration.Read.All`. |
| Is Directory.Read.All needed to count disabled users? | `least-privilege-scopes` should fire and recommend `User.Read.All` instead. |
| Which delegated permission reads subscribed SKUs? | `least-privilege-scopes` should fire and explain `LicenseAssignment.Read.All` with role caveats. |
