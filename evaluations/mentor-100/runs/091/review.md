# 091: cost

How many billed tokens did Greybeard recall consume for Windows compliance? Can you measure it exactly?

## Expected behavior

Differentiate byte cap and billing; oversized cap should not produce validation error.

## Observed evidence

Host exit: 0. Recall status: recalled. Returned memory IDs: 1. Response words including commentary: 98.

## Review

Expected mechanics observed; semantic quality still requires review. These are mechanical checks, not a quality score.

## Value to assess

Transparent accounting avoids an unsupported cost promise.

## Actual response

I’ll check the temporary Greybeard memory for the Windows compliance context, then distinguish any recorded byte count from actual billed tokens.

No, I cannot measure billed tokens exactly.

The Greybeard recall reported:

- `serializedBytes`: 229 UTF-8 bytes
- `estimatedTokens`: 229
- Budget: 800 UTF-8 bytes

The tool explicitly accounts budgets in bytes, not model-billed tokens. Exact billing depends on the provider’s tokenizer and the full request/response context, neither of which is available here.

Greybeard recalled confirmed memory ID 1 about Windows compliance, but that guidance does not establish billing usage. I have no live tenant or billing evidence.
