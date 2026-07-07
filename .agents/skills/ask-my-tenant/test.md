# Trigger Tests

| Prompt | Expected behavior |
|---|---|
| List guest accounts created this month. | `ask-my-tenant` should fire and resolve to one scoped `/users` call. |
| How many disabled accounts do we have? | `ask-my-tenant` should fire and use `$count` with `ConsistencyLevel: eventual`. |
| Which users do not have a manager? | `ask-my-tenant` should fire and return a ticket-ready answer from one selected user call. |
| Which devices are failing compliance? | `intune-compliance` should fire instead of `ask-my-tenant` because the specialist has precedence. |
