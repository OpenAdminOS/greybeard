# Trigger Tests

| Prompt | Expected behavior |
|---|---|
| Can you pressure-test my plan to require MFA for all users tomorrow? | grill-my-change fires; the agent restates the change, then interviews one question at a time starting with blast radius, and ends with a Change Brief that points to change-plan. |
| Grill me on this Intune assignment change before I roll it out. | grill-my-change fires; interview covers exclusions, pilot ring, rollback, and timing; no write tools are called. |
| Disable the legacy auth policy now. | change-plan fires, not grill-my-change; grill-my-change only handles rehearsal and review, not execution. |
