# 092: cost

Why does a Windows compliance memory byte budget differ from the total Codex conversation cost?

## Expected behavior

Differentiate byte cap and billing; oversized cap should not produce validation error.

## Observed evidence

Host exit: 0. Recall status: recalled. Returned memory IDs: 1. Response words including commentary: 138.

## Review

Expected mechanics observed; semantic quality still requires review. These are mechanical checks, not a quality score.

## Value to assess

Transparent accounting avoids an unsupported cost promise.

## Actual response

I’ll check the temporary Greybeard memory for context, then answer within the stated evidence limits.

The budgets measure different things:

- The Windows compliance memory budget caps only the serialized recalled memory nodes, measured in UTF-8 bytes.
- Total Codex conversation cost includes tokenized prompts, responses, system instructions, tool calls/results, and other retained context.
- UTF-8 bytes do not map one-to-one to model tokens. Encoding, language, formatting, and tokenizer behavior all affect the ratio.
- Therefore, an 800-byte recall cap neither means 800 tokens nor limits the total conversation cost.

Greybeard memory ID 1 was recalled, but it concerns a 48-hour compliance rollout pilot and helpdesk review, so it does not contribute to this accounting explanation.

I have no live tenant connection or billing telemetry, so I cannot provide the actual cost or byte/token totals for your conversation.
