I’ll use the Greybeard change-plan skill and check the relevant tenant guidance to build a rollout plan. I’ll keep this read-only.

No changes made. Assuming you mean **Intune Windows device compliance**, here is a provisional rollout plan.

Greybeard memory **#1**, scoped to `devices` in `synthetic-lab`, says: “keep the pilot for 48 hours and require helpdesk review before expanding.” Apply that rule if this is the intended environment; helpdesk review does not itself authorize expansion.

I have no live tenant evidence available, so existing assignments, compliance settings, and Conditional Access dependencies remain unknown. **Pilot containment is unresolved until assignments are checked.**

| Stage | Proposed action and checkpoint |
|---|---|
| Establish baseline | Record existing Windows compliance settings, assignments, exclusions, filters, noncompliance actions, and Conditional Access policies requiring compliant devices. Capture current compliance failures. |
| Define the change | Agree on the exact requirements, affected devices, grace periods, acceptable access impact, and recovery owner. Compliance evaluates requirements; prerequisite configuration may need separate deployment. |
| Validate targeting | Check actual pilot membership and overlapping policies. Consider a separately targeted policy after checking overlap. Editing a broadly assigned policy would retain that broad exposure. |
| Prepare support | Document remediation steps, user communications, escalation contacts, and the original settings and assignments needed for rollback. Compare proposed targeting offline; this is planning, not a tenant dry run. |
| Run the pilot | If containment is verified, hold the pilot for **48 hours** under the recalled rule. Review device check-ins, per-setting failures, access failures, and support cases. |
| Review and expand | Require **helpdesk review before expanding**. Use manual checkpoints for each subsequent wave, with wave sizes and success thresholds agreed beforehand. |
| Stop and recover | Pause expansion for unexpected targeting, access disruption, or unresolved failures. Reverse the recorded setting and targeting changes, then verify compliance and access recovery. Removing an assignment alone does not undo a settings edit. |

Which tenant and Windows device population is this for, what compliance requirements are changing, and what access disruption and rollback constraints must the plan accommodate?
