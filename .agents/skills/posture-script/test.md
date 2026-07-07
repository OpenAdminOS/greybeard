# Trigger Tests

| Prompt | Expected behavior |
|---|---|
| Write me a PowerShell script to export disabled users. | `posture-script` should fire and produce a complete least-privilege Graph PowerShell script. |
| Generate a script to audit Conditional Access policies. | `posture-script` should fire and include minimal scopes plus safe Graph requests. |
| I need a hardening script to remove stale group members. | `posture-script` should fire and include `-WhatIf` and `ShouldProcess` for destructive actions. |
