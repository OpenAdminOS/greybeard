# Trigger Tests

| Prompt | Expected behavior |
|---|---|
| How healthy is our tenant today? | `tenant-pulse` should fire and produce a scored snapshot with gated pillars degraded if needed. |
| Give me a Microsoft 365 posture score. | `tenant-pulse` should fire and return the copy-paste-ready pulse template. |
| How are we doing on MFA, stale users, CA, and licenses? | `tenant-pulse` should fire and run the exact pillar calls when signed in. |
