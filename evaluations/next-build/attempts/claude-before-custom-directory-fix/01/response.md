I'll start with the change-plan skill and a memory recall.

## Intune Windows compliance policy change — plan brief

**No tenant changes made, and none are possible from here.** Two things to state up front:

- The `greybeard-memory` server is **not available** in this session, so no `recall` ran — I have no confirmed Greybeard records backing anything below. This guidance comes from the Greybeard change-plan skill only.
- No Intune/Graph read tools are connected either (the Microsoft 365 connector here covers mail/Teams/SharePoint, not device management), and the IntuneAutomation script-catalog lookup was declined. **All current-state evidence is therefore unknown**, not verified.

### What I still need from you
Materially different plans follow from these, so I'm asking rather than assuming:
1. Which policy (display name / ID) and which **exact setting** is changing, from what value to what value?
2. Tenant, and the policy's **current assignments** — All Devices, All Users, or specific groups, with any exclusions?
3. Acceptable impact: can devices go non-compliant, and is a Conditional Access policy keyed to compliance (i.e. does non-compliant mean blocked)?
4. Existing change window and approval path.

### Scope warning that applies regardless of your answers
If the policy is already assigned to All Devices/All Users, **editing it in place keeps that full exposure**. Adding a pilot-named group does not narrow it — targeting only shrinks if you remove the broad assignment or create a separately targeted new policy. Until assignments are actually read, pilot feasibility is **unresolved**; I can't promise containment.

Also: removing an assignment reverses an *assignment* change only. It does **not** undo an in-place setting edit — rollback must restore the recorded prior setting value and then be verified.

### Change brief skeleton (fill once the above is known)
- **Operation:** `PATCH /deviceManagement/deviceCompliancePolicies/{id}` (v1.0), single named setting.
- **Preconditions:** export the policy JSON and its `/assignments` to a file first — that export *is* your rollback record; capture a pre-change compliance count as baseline.
- **Planning dry run:** diff the exported JSON against the intended JSON **offline**. That is planning, not a tenant dry run — Greybeard supplies no rollout controller, and there is no verified automatic stop mechanism here. Use a **manual review checkpoint** instead.
- **Grace period:** a non-zero `scheduledActionsForRule` grace period is the main lever for avoiding an immediate block. Whatever number you pick is an **option to validate against your CA posture**, not a recommendation I can ground.
- **Stop conditions:** non-compliant count rises beyond your stated tolerance, or any sign-in blocks attributable to the change → halt, roll back.
- **Rollback:** re-`PATCH` the recorded prior value, then re-read the policy and re-check the compliance count to confirm recovery. Note device check-in latency means recovery is not instant.
- **Least privilege:** `DeviceManagementConfiguration.ReadWrite.All` for the write; read-only scopes suffice for evidence-gathering.

Send me the four answers and I'll produce the exact brief plus an inspectable script for you to run through your own approved workflow — creating a script does not authorise running it, and I can't execute or approve it for you.
