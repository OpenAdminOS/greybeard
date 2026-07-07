# Trigger Tests

| Prompt | Expected behavior |
|---|---|
| How should I page through all users with Graph? | `graph-patterns` should fire and explain `fetchAll`, `maxItems`, and `@odata.nextLink`. |
| Can I put writes inside a Graph batch? | `graph-patterns` should fire and state Greybeard permits only all-GET `$batch`. |
| When do I need ConsistencyLevel eventual? | `graph-patterns` should fire and explain advanced query count/search behavior. |
