# Trigger Tests

| Prompt | Expected behavior |
|---|---|
| Review our existing Conditional Access policies. | `conditional-access-review` should fire and read live CA policy state. |
| Which CA policies are still report-only? | `conditional-access-review` should fire and filter `enabledForReportingButNotEnforced`. |
| Check whether emergency accounts are excluded from CA. | `conditional-access-review` should fire and flag missing exclusions. |
| what is my tenant MFA coverage? | `tenant-pulse` should fire, not `conditional-access-review`; this asks for MFA registration coverage, not CA enforcement. |
