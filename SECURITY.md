# Security reports

Please report suspected vulnerabilities privately through [GitHub's vulnerability reporting form](https://github.com/OpenAdminOS/greybeard/security/advisories/new). Include the affected version, reproduction steps, and expected impact. Do not include live credentials, tenant exports, or personal data.

Avoid posting security-sensitive details in public issues. For ordinary bugs and questions, use the issue tracker.

## Credentials and local data

Keep tenant credentials, signing certificates, private keys, environment files, and memory databases outside source control. Example configuration must use obvious placeholders. Generate temporary credentials inside tests and remove them afterward.

Pull requests and pushes run Gitleaks against the fetched Git history with redacted output. Automated detection cannot prove that a repository contains no secrets. If a credential is exposed, revoke or rotate it first, then address the affected Git history, logs, and artifacts; deleting it in a later commit is not sufficient.

Greybeard supplies advice, not an authorization boundary. Host permissions and your organization's change controls still apply. See the [client behavior and memory controls](README.md#client-behavior) for the supported integration boundaries.
