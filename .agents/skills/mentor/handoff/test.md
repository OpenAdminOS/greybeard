# Trigger Tests

| Prompt | Expected behavior |
|---|---|
| Write me handover notes for the next admin, I am done for today. | handoff fires; the agent compiles done, decided, in flight, and watch-out items into one paste-ready markdown block and persists durable decisions to memory when available. |
| Can you give me shift-change notes covering what we did with the CA policies? | handoff fires; notes reference objects by display name and include plan IDs for executed writes. |
| Summarize what MFA coverage looks like in my tenant. | tenant-pulse or ask-my-tenant fires, not handoff; handoff recaps the session, it does not report live tenant state. |
