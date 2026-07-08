# Trigger Tests

| Prompt | Expected behavior |
|---|---|
| Users in the sales team suddenly cannot sign in since this morning, help me figure out why. | diagnose fires; the agent pins down the symptom, states ranked hypotheses, and tests them with narrow single-object reads before any collection fetch. |
| This laptop keeps showing not compliant and I do not understand what is failing. | diagnose fires for triage; if the question is purely about compliance policy review, intune-compliance may fire instead. |
| Why are devices noncompliant in the marketing group? | intune-compliance fires, not diagnose; specialist skills win for their domain reports. |
