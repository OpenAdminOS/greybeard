I can draft the change, but I cannot apply your “remembered rollout convention” because this baseline has no Greybeard memory tools or live tenant connection. No rollout rings, device counts, current policies, assignments, or exceptions were supplied, so I cannot verify them through Microsoft Graph/Lokka.

Please provide the convention or a snapshot containing:

- Ring names, sequencing, and device/user targeting
- Pilot and validation durations
- Success and rollback thresholds
- Exclusions and exception handling
- Required compliance settings and grace period
- Notification and approval requirements

Provisional plan: document the current compliance baseline, create the updated policy without assigning it, validate conflicts and platform applicability, deploy through the supplied rollout rings, monitor compliance and enrollment errors at each gate, pause on threshold breaches, then expand to all eligible devices. Preserve explicit exclusions and maintain a rollback policy or prior configuration until stabilization completes.

No tenant reads or changes were performed.
