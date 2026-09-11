From the supplied lab snapshot, observed by someone else on 2026-09-11:

**Known**

- Five managed Macs were present: four personal and one company-owned.
- Across those five Macs, four were noncompliant and one was in grace.
- The evidence does not map those compliance states to ownership, so we cannot say which personal Macs were noncompliant.
- The enabled reporting-only Conditional Access policy checked `compliantApplication`, not `compliantDevice`, and was not enforced.

**Not known**

- Whether the macOS compliance policy was assigned to the personal Macs.
- Why any Mac was noncompliant, how long it had been noncompliant, or its last-sync freshness.
- Whether the personal Macs currently access organizational resources or would be blocked.
- Pilot-group membership, pilot readiness, user impact, exceptions, or remediation status.
- Anything reliable about production: the production organization read returned `403 Authorization_RequestDenied`.

The `gracePeriodHours: 0` observation does not prove immediate access blocking. These findings describe only an anonymized lab sample, not the real tenant or overall fleet. I have no live tenant connection and performed no reads.
