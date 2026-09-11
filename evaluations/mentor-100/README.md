# Greybeard mentor evaluation

This folder records **actual model conversations with the local Greybeard memory MCP**, not generated example answers. Open [review.html](review.html) for a searchable review, [summary.json](summary.json) for counts and usage, and [paired-baselines.json](paired-baselines.json) for the comparison subset.

## What was exercised

The manifest contains 100 distinct administration prompts across cold start, general preferences, a specific confirmed rollout decision, corrections, forgetting, pause, profile isolation, irrelevant memories, candidates, malicious memory instructions, planning-only boundaries, missing tenant evidence, a supplied lab snapshot, cost, and attribution.

Each prompt starts a new authenticated Codex CLI process with a fresh temporary SQLite profile. Fixture setup uses Greybeard's real remember, confirm, correction, and forget service methods. The model calls the real stdio MCP recall tool. Only that tool is exposed and approved for these synthetic databases. No tenant connector, tenant credential, shell tool, web search, or real user memory is forwarded to the model process. Temporary profiles are deleted after each run. Existing Codex authentication remains in its original location; its values are never copied into results.

Ten selected prompts also run without Greybeard. The same base instructions, response-length request, and supplied evidence apply to both arms; only memory availability and memory-specific instructions differ. These pairs illustrate possible contributions and overhead, not a causal estimate over a representative population.

Five prompts receive the same anonymized, dated lab snapshot from the parent reviewer's separate read-only Lokka inspection. The evaluated model did **not** make those tenant reads. Memory fixtures, including pilot durations and adversarial text, are synthetic and are not assertions about the real company.

## What this does not establish

- The harness explicitly requests initial recall and supplies memory-use guidance. It does not test spontaneous skill discovery or a background observer.
- Only recall is available. Absence of tenant writes is enforced by the harness, not evidence that an unrestricted host would always refuse them.
- One response per distinct prompt does not establish reliability across reruns, hosts, models, production tenants, or languages.
- Global host instructions can still influence model behavior, including references to live Lokka verification. `--ignore-user-config` and disabled skill discovery do not make this a bare language-model API benchmark.
- The 180-word request is a soft instruction. Word counts include any saved assistant commentary as well as the final answer.
- Mechanical flags and lexical cues help locate evidence. They are **not** a quality pass rate. Agent editorial reviews are separate from external human adjudication.
- Aggregate CLI token counters cover the host prompt and multiple tool turns. Cached input is included in total input. These counters are not Greybeard's serialized-memory byte cap, a marginal recall cost, or a monetary bill.

## Reproduce

Use an existing authenticated Codex installation and build the repository first:

```sh
npm run build
python3 evaluations/mentor-100/make-cases.py
python3 scripts/evaluate-mentor.py --jobs 4
python3 scripts/evaluate-mentor.py --baseline --jobs 4
python3 scripts/evaluate-mentor-review.py
```

Running these commands consumes model usage on the authenticated account. Defaults retain completed results; use `--force` only to deliberately replace a recorded run. `--start` and `--limit` select a bounded subset. The fixture script requires a `/tmp/greybeard-evaluation-*` directory and never uses Greybeard's default app-data location.

The recorded run uses the locally configured model. `run-configuration.json` records the actual model, CLI version, source hashes, and start time. Model events, responses, tool evidence, errors, usage, and per-case reviews live under `runs/NNN/`; machine-specific paths in traces are replaced with placeholders. Baselines use `baselines/NNN/`. The initial MCP approval smoke failure is retained separately under `smoke-failures/` and is not counted among the 100 prompts.

Codex invocation behavior was checked against local CLI help and [official non-interactive documentation](https://developers.openai.com/codex/noninteractive), including JSON event output. The per-tool invocation policy follows the [official configuration reference](https://developers.openai.com/codex/config-reference). No persistent user configuration was changed.

## Supplementary skill rechecks

Eight selected prompts are rerun separately with the actual repository change-plan memory preamble after the initial reviews identified that the shortened harness omitted local-confirmation guidance. These results live under `skill-rechecks/`; their exact preamble and source hashes are in `skill-rechecks-configuration.json`. Run them with:

```sh
python3 scripts/evaluate-mentor.py --skill-rechecks --jobs 4
```

They preserve the original 100 results and do not count as additional distinct prompts. Improvements in these rechecks suggest instruction coverage matters, but eight selected retries cannot establish general reliability. Initial candidate-confirmation failures are host/harness observations, not proof that the installed full skill has the same failure.

## Recorded execution outcome

The initial run completed all **100 distinct prompts**, with a successful real MCP recall in every conversation. All ten baseline processes and all eight supplementary processes also completed. The supplementary full-preamble runs called recall in two of eight conversations; the others answered without it, including some that incorrectly said the configured tool was unavailable. This is an unresolved discovery observation, not a missing database connection in the initial batch.

The initial 100 conversations reported 3,267,487 aggregate input tokens (2,475,264 cached), 36,113 output tokens, and 7,565 reasoning-output tokens. These are CLI-reported fields; do not add reasoning tokens to output as if independent billing quantities without checking provider semantics.

For the ten paired prompts, the Greybeard arm reported 327,063 input tokens (255,232 cached) and 3,565 output tokens; the no-memory arm reported 97,016 input tokens (27,008 cached) and 1,828 output tokens. The arms have different tool turns, context, and cache histories. The input-total ratio is not a monetary cost multiplier or the isolated cost of recalled memories.

The most concrete observed contribution is in paired prompts 021, 023, and 031: Greybeard supplies the confirmed pilot duration and helpdesk checkpoint (including the corrected duration), while the baseline must ask the admin to provide those details. A fresh host session can therefore avoid asking again or repeating an obsolete local rule. Broader quality findings remain in the per-case and independent reviews.

## Substantive reviews

Every initial response has a separately saved substantive agent review: [001-050](manual-review-001-050.json) and [051-100](manual-review-051-100.json). Totals: 72 pass, 26 concern, 2 fail. The searchable HTML and per-case review files include these judgments alongside mechanical checks. These are agent editorial judgments, not external human adjudication. [Eight supplementary comparisons](manual-skill-rechecks.json) retain the original outcomes.
