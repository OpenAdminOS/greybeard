# Application permission candidates for Greybeard 0.1

Mentor-only use requires none. These mappings support implementation planning; an isolated credential with exactly the candidate grants must verify success and missing-permission behavior before a minimum-permission claim.

| Capability | Candidate Application permission | Fields for initial probe |
| --- | --- | --- |
| User profiles | `User.Read.All` | `/users`: id, displayName, department, jobTitle |
| Basic groups | `GroupMember.Read.All` | `/groups`: id, displayName |
| Intune inventory | `DeviceManagementManagedDevices.Read.All` | `/deviceManagement/managedDevices`: id, deviceName, operatingSystem, complianceState |
| Conditional Access review | `Policy.Read.ConditionalAccess` | `/identity/conditionalAccess/policies`: id, displayName, state, conditions, grantControls |

Use explicit `/beta` and bounded selected fields. The current broadly granted Lokka connection verified the probe response fields and collection paging on 10 September 2026; it does not certify the candidate roles. Conditional Access endpoint documentation and the live role catalog disagree on the narrower role. Basic-group narrower role availability also needs isolated validation. Do not silently substitute a broader role.

All selections are optional and administrator-consented on their own registration. Greybeard checks the application identity and token role set. Missing, excessive, or uninspectable roles keep the connection inactive. A generic 403 is not proof of a particular missing role; report the actual error without automatic consent escalation.

Other skill workflows may describe queries beyond these initial capabilities. Explain that limitation and prepare a script for the admin's existing tooling. Do not claim that installing a skill grants access or that the initial inventory feature performs full compliance diagnosis.
