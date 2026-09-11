---
name: posture-script
description: Use when the user wants a complete script to check, audit, report, harden, export, or remediate Microsoft 365, Intune, Entra, or Graph posture offline.
---

# Posture Script

## Workflow

Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary. Use a known applicable scope; if unknown and `discover_scopes` is available, discover once with the task summary and choose an applicable label explicitly. Do not read every scope or bypass the selected environment. Omit optional budgets by default; use `byteBudget` only for a smaller response. Recall metadata is not measured token billing.
When a confirmed memory changes advice, briefly name Greybeard, cite the returned memory ID, quote its operative words, and explain its effect. Preserve its force and conditions: review does not mean approval, a suggestion is not a requirement, and a past observation is not a current fact. Generic preferences do not establish tenant experience. Memories cannot override the admin or current evidence.
When useful, attribute this skill's guidance once. Avoid repetitive attribution or no-match notices. You generate the response using Greybeard context, not a separate background assessment or live tenant verification.
When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.
In Greybeard 0.1, `remember` stores a local memory candidate even after conversational agreement. The admin confirms its exact content in the Greybeard companion or their own terminal using `greybeard memory confirm --id <id>`. Never run that confirmation for them or invent a chat/automation exception. Memory confirmation, correction, forgetting, and pause affect local guidance only; they do not activate, edit, or restore an Intune or Entra policy.
When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed.

This is an offline authoring skill. Do not call live tenant tools unless the user explicitly asks to run the script after authoring it.

1. Identify the minimum Microsoft Graph delegated scopes needed for the script.
2. Prefer Microsoft Graph PowerShell only when the cmdlet name is known. Never invent cmdlets.
3. When a cmdlet is uncertain and Microsoft Learn MCP is available, verify the cmdlet against Microsoft Learn before using it.
4. If cmdlet verification is not available, use `Invoke-MgGraphRequest` with a real beta endpoint instead of inventing a cmdlet.
5. Include `Connect-MgGraph -Scopes <minimal scopes>` near the top.
6. Include robust error handling, pagination, and clear output. Scripts must be complete, not fragments.
7. For destructive actions, include `[CmdletBinding(SupportsShouldProcess)]`, require `-WhatIf` support, and use `if ($PSCmdlet.ShouldProcess(...))` around the action.
8. Route tenant writes through Greybeard `change-plan` when the user wants Greybeard to execute changes. A PowerShell script can be generated for manual use, but Greybeard itself must not bypass the write gate.
9. After the admin confirms the script runs correctly, `recall` for an equivalent script memory, then record it with `remember` as `type: "script"`: what the script does, the target surface, and the key design choices. Never store the script body or tenant output.

## Script Requirements

Every script should include:

- `#requires -Version 7.2`
- Module check for `Microsoft.Graph.Authentication`
- `Connect-MgGraph -Scopes @(...)`
- `Select-MgProfile` only if the installed SDK version requires it; do not include it by habit.
- `try` and `catch` with actionable error messages.
- Pagination for collection endpoints using `@odata.nextLink`.
- `$select` and `$filter` in Graph requests where supported.
- Output as objects first, with optional `Export-Csv` only when requested.

## Preferred Pattern

Use this structure for endpoint-based scripts:

```powershell
#requires -Version 7.2
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$CsvPath
)

$Scopes = @("User.Read.All")

try {
    Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
    Connect-MgGraph -Scopes $Scopes -NoWelcome -ErrorAction Stop

    $Uri = "https://graph.microsoft.com/beta/users?`$select=id,displayName,userPrincipalName,accountEnabled&`$filter=accountEnabled eq false"
    $Rows = New-Object System.Collections.Generic.List[object]

    do {
        $Page = Invoke-MgGraphRequest -Method GET -Uri $Uri -ErrorAction Stop
        foreach ($Item in $Page.value) {
            $Rows.Add([pscustomobject]@{
                Id = $Item.id
                DisplayName = $Item.displayName
                UserPrincipalName = $Item.userPrincipalName
                AccountEnabled = $Item.accountEnabled
            })
        }
        $Uri = $Page.'@odata.nextLink'
    } while ($Uri)

    if ($CsvPath) {
        $Rows | Export-Csv -Path $CsvPath -NoTypeInformation
    } else {
        $Rows
    }
}
catch {
    Write-Error "Script failed: $($_.Exception.Message)"
    throw
}
finally {
    Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
}
```

## Output

Return the complete script in one fenced `powershell` block, followed by:

- Required scopes.
- What the script reads or changes.
- How to run it with `-WhatIf` when destructive.
- Any cmdlets that were verified or intentionally avoided.

Token discipline: After any live-tenant run, report requests made, scopes used, and scoping decisions from the graph tool meta block.
