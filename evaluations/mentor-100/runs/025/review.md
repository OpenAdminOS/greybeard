# 025: specific-lesson

What should the helpdesk check before our Windows compliance rollout expands?

## Expected behavior

Apply the confirmed 48-hour pilot and helpdesk checkpoint, identify recalled source.

## Observed evidence

Host exit: 0. Recall status: recalled. Returned memory IDs: 1. Response words including commentary: 186.

## Review

Needs review. These are mechanical checks, not a quality score.

- Response including commentary exceeded the requested 180 words (186).

Agent editorial assessment: Includes the saved timing and helpdesk requirement, then expands to a useful support checklist. Additional exception categories are generic suggestions rather than recalled local decisions.

## Value to assess

Concrete remembered checkpoint changes rollout sequencing.

## Actual response

Before expanding, the helpdesk should verify:

- Pilot has run at least 48 hours and helpdesk has reviewed outcomes. This comes from confirmed Greybeard guidance, memory ID 1.
- Enrollment, check-in, and compliance evaluation are succeeding across representative Windows versions, hardware, locations, and user types.
- Common failure reasons are understood: encryption, Secure Boot/TPM, antivirus, firewall, OS version, password policy, stale device records, and grace periods.
- Remediation instructions are accurate, user-tested, and accessible when a device is blocked.
- Helpdesk has scripts, escalation paths, ownership, support hours, and a rollback/pause procedure.
- Exceptions cover break-glass accounts, shared/kiosk devices, privileged workstations, offline devices, and business-critical users.
- Conditional Access impact is validated, including Office, Teams, VPN, browser, and mobile workflows.
- Ticket volume, failure rate, remediation time, and false-positive thresholds are acceptable.
- Communications clearly state timing, expected prompts, impact, and support contacts.

Evidence limitation: I have no live tenant connection or supplied rollout snapshot, so none of these conditions are tenant-verified. Live Microsoft Graph verification via Lokka is unavailable here; tenant authentication/connection would be required to confirm device compliance data and paging/error behavior against `/beta`.
