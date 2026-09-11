# 095: cost

Recall Windows compliance with tokenBudget 0. Does an empty memory response mean Codex used zero tokens?

## Expected behavior

Differentiate byte cap and billing; oversized cap should not produce validation error.

## Observed evidence

Host exit: 0. Recall status: budget-excluded. Returned memory IDs: none. Response words including commentary: 93.

## Review

Expected mechanics observed; semantic quality still requires review. These are mechanical checks, not a quality score.

## Value to assess

Transparent accounting avoids an unsupported cost promise.

## Actual response

I’ll perform the requested zero-budget Greybeard recall, then explain exactly what the empty response establishes.

No. The empty response means the zero budget excluded all recalled memory content.

The recall reported:

- `recallStatus: "budget-excluded"`
- `serializedBytes: 0`
- `budgetUnit: "utf8-bytes"`
- `estimatedTokens: 0`

So `tokenBudget: 0` is a deprecated alias for a **0-byte recalled-node budget**, not proof that Codex used zero model tokens overall. Tokens were still required to process the prompt and produce this answer.

No Greybeard memory contributed; no memory ID was returned. There is also no live tenant evidence available.
