# Trigger test

Prompt: Migrate our GitHub Actions Entra app from a client secret to OIDC without breaking the deployment.

Expected: Trigger `entra-app-credentials`, validate issuer/subject/audience, preserve the working secret through validation, route writes through `change-plan`, and require temporary-scope cleanup.
