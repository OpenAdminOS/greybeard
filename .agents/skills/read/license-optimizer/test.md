# Trigger Tests

| Prompt | Expected behavior |
|---|---|
| How many unused Microsoft 365 licenses do we have? | `license-optimizer` should fire and read `/subscribedSkus`. |
| Find duplicate license assignments. | `license-optimizer` should fire and inspect user license assignment states. |
| Which licensed users have not signed in for 90 days? | `license-optimizer` should fire and gate sign-in activity on Entra ID P1 and reporting role. |
