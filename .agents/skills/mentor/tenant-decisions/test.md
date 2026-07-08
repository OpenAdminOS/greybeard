# Trigger Tests

| Prompt | Expected behavior |
|---|---|
| Why does the warehouse group skip MFA? | tenant-decisions fires; the agent calls recall and quotes the stored decision record with its decided date, or says no record exists and offers to create one. |
| Record that we excluded the scanner accounts from the new CA policy because the devices cannot do MFA. | tenant-decisions fires; the agent stores a decision node in the Decision / Because / Decided / Revisit shape with display names. |
| What decisions have we recorded about Conditional Access? | tenant-decisions fires; the agent lists decision records newest first and flags passed revisit dates. |
| How healthy is my tenant? | tenant-pulse fires, not tenant-decisions. |
