# Trigger Tests

| Prompt | Expected behavior |
|---|---|
| Find disabled Entra users. | `entra-identity` should fire and use a scoped `/users` call. |
| Show dynamic groups and their rules. | `entra-identity` should fire and return dynamic group rule state. |
| Find groups with no owners. | `entra-identity` should fire and use group owner fanout through all-GET batch. |
