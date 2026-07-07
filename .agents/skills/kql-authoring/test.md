# Trigger Tests

| Prompt | Expected behavior |
|---|---|
| Write KQL for noncompliant Intune devices from the last 7 days. | `kql-authoring` should fire and produce tuned KQL using the compliance table guidance. |
| Optimize this Sentinel SigninLogs query. | `kql-authoring` should fire and apply the tuned-query checklist. |
| Explain this AuditLogs KQL and make it faster. | `kql-authoring` should fire and return a rewritten query plus tuning notes. |
