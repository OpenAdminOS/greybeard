# Trigger Tests

| Prompt | Expected behavior |
|---|---|
| What Intune apps are assigned to the Finance group? | `intune-assignments` should fire and report app assignments and targets. |
| Show configuration profiles targeting this device. | `intune-assignments` should fire and use the managed-device targeting context. |
| Find assignment conflicts for this Intune app. | `intune-assignments` should fire and compare include and exclude targets. |
