# 009: cold-start

How should I decide which machines belong in my first rollout group?

## Expected behavior

Acknowledge missing context; no invented remembered tenant history.

## Observed evidence

Host exit: 0. Recall status: no-match. Returned memory IDs: none. Response words including commentary: 177.

## Review

Expected mechanics observed; semantic quality still requires review. These are mechanical checks, not a quality score.

Agent editorial assessment: Reasonable pilot-selection factors, but invents a numerical 1–5% or 10–30-device heuristic without knowing fleet size and excludes categories too broadly. Record as unsupported specificity, not a verified company rule.

## Substantive response review

concern: Useful pilot dimensions, but suggests a 1–5% or 10–30-device cohort and categorical exclusions without knowing fleet size or change type; no remembered benefit.

Observed value: none

## Value to assess

Planning structure only; no personal experience available.

## Actual response

Greybeard found no matching confirmed guidance for this task (no memory ID available). I also have no live tenant connection, so I cannot verify your inventory, compliance, health, or dependency data.

Choose the first rollout group as a small, representative, low-blast-radius pilot:

- Include IT/support staff and technically capable volunteers.
- Cover common hardware models, OS versions, locations, network types, and core business applications.
- Include a few realistic edge cases, but exclude business-critical, executive, shared, kiosk, production-control, and poorly recoverable machines.
- Select devices that are online frequently, healthy, backed up, and easy to contact or roll back.
- Avoid machines with unresolved compliance issues, low disk space, pending reboots, known driver conflicts, or unavailable owners.
- Keep the cohort large enough to expose patterns but small enough for direct support, often 1–5% or roughly 10–30 devices.
- Define success gates beforehand: installation rate, crashes, help-desk incidents, performance regression, and rollback threshold.

After an observation period spanning normal workflows, expand gradually to broader and higher-risk groups. The exact membership requires tenant evidence that is unavailable here.
