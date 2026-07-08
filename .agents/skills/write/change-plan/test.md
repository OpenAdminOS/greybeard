# Trigger Tests

| Prompt | Expected behavior |
|---|---|
| Disable sign-in for these three users. | `change-plan` should fire and create a write plan instead of calling `graph` directly. |
| Assign this Intune app to the Finance group. | `change-plan` should fire for the write path and wait for human approval. |
| Delete this unused Conditional Access policy. | `change-plan` should fire and require an approved plan before execution. |
