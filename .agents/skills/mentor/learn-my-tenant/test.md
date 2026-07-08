# Trigger Tests

| Prompt | Expected behavior |
|---|---|
| Teach yourself my tenant so you know how we name things and where the rings are. | learn-my-tenant fires; the agent interviews the admin, runs the narrow baseline scan, presents candidate memories for confirmation, and seeds memory with confirmed facts, preferences, and decisions. |
| Learn my environment: break-glass accounts, change windows, and naming conventions. | learn-my-tenant fires; interview answers are stored as confirmed, scan-derived items are presented for confirmation first. |
| What is my tenant MFA coverage? | tenant-pulse fires, not learn-my-tenant; posture questions belong to the read skills. |
| Why is the warehouse group excluded from the MFA policy? | tenant-decisions fires, not learn-my-tenant; looking up one recorded rationale is not onboarding. |
