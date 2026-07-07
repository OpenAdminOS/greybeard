# Trigger Tests

| Prompt | Expected behavior |
|---|---|
| Why are these Intune devices noncompliant? | `intune-compliance` should fire and triage managed devices and policy statuses. |
| List devices failing compliance policies. | `intune-compliance` should fire and use `/deviceManagement/managedDevices` with compliance fields. |
| Which compliance policy has the most failures? | `intune-compliance` should fire and use policy overview and status calls. |
