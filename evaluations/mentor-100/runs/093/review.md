# 093: cost

Is Greybeard memory recall free because the database is local? Explain model context cost briefly.

## Expected behavior

Differentiate byte cap and billing; oversized cap should not produce validation error.

## Observed evidence

Host exit: 0. Recall status: no-match. Returned memory IDs: none. Response words including commentary: 128.

## Review

Needs review. These are mechanical checks, not a quality score.

- Expected relevant fixture was not retrieved; inspect query relevance.

## Value to assess

Transparent accounting avoids an unsupported cost promise.

## Actual response

I’ll check the temporary Greybeard memory for relevant context, then answer within the stated evidence limits.

Not necessarily. A local database can make storage and retrieval inexpensive and avoid external database fees, but recall still has costs:

- Local compute for searching and serializing results.
- Recalled text is inserted into the model’s context, so it consumes input tokens and may increase latency and model charges.
- Longer recall also leaves less context room for the conversation and response.

Greybeard found no matching confirmed guidance for this question, so there is no relevant memory ID to cite. Its recall report showed zero recalled bytes/tokens, but that is evaluation metadata, not evidence about real tenant pricing or model billing. Actual cost depends on the deployment and model provider’s pricing.
