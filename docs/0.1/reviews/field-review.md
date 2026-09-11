# Greybeard field review: what the admin would miss

## Result

The memory integration can change a fresh conversation using a confirmed rollout rule and can carry a correction into the next session. It does not yet establish dependable background mentoring across clients. Meaning-preserving recall and reliable discovery matter more than adding another integration.

The source improvements fix the Mac transcript's budget error, clarify byte accounting, separate preferences from lessons, preserve linked-memory provenance, suppress recalled advice when paused, and improve attribution instructions. The published 0.1 runtime remains unchanged; these updates are on the review branch.

## Evaluation evidence

[100 prompts and saved response reviews](../../../evaluations/mentor-100/review.html), [method and reproduction](../../../evaluations/mentor-100/README.md), and [paired baselines](../../../evaluations/mentor-100/paired-baselines.json).

- 100 distinct prompts across 16 categories, each answered by a real Codex process with a real isolated memory MCP recall.
- Independent agent editorial review of every actual response: 72 pass, 26 concern, 2 fail. These are review judgments, not statistical reliability estimates or external human certification. Mechanical flags are separate and must not be read as the failure count.
- 10 selected prompts also ran without Greybeard; 8 additional conversations used the actual skill memory preamble. All 118 model processes completed. Tool success does not imply answer quality.
- 180 local source tests passed. Linux standalone startup, SQLite/MCP and update smoke passed. Browser verification covered 53 synthetic memories, pagination, confirmation, correction, forgetting, pause, literal HTML handling, desktop and mobile rendering.

## Where value appeared

Cases 021 and 023 reused a confirmed 48-hour pilot/helpdesk checkpoint that the baseline did not know. Cases 031-035 returned the corrected 72-hour rule without the superseded duration. Case 027 correctly separated a confirmed process rule from an unknown historical reason. Forgetting, pause, and cross-profile isolation prevented the stored rule from appearing in their respective fixtures.

These demonstrate specific remembered context and working controls. They do not prove that the host will notice the relevant task without prompting, that the recalled rule remains operationally current, or that the generated plan preserves every nuance. Several answers changed “helpdesk review” into “helpdesk approval.”

The empty-memory cases largely produced standard planning checklists. The five lab-snapshot cases mainly demonstrate reasoning over supplied evidence; the model did not fetch that evidence, and an empty recall added no tenant-specific memory. Greybeard should earn its context overhead by providing an otherwise missing constraint.

## Failures and limits

Initial case 058 confused a local memory's confirmation state with an Intune policy's activation. Case 060 invented an exception whereby a chat bot could treat conversational agreement as activation. The actual server did not expose those unconfirmed records. The initial harness omitted part of the full skill lifecycle guidance, so these are host/harness observations, not proof that the installed skill produced the same failure.

The eight actual-preamble follow-ups improve that diagnosis: only two invoked recall; six answered without MCP evidence. Five explanations improved, three remained substantially unchanged. Case 058 explained local confirmation correctly; case 060 still invented the automation exception. A configured server does not itself prove that the model discovered its tool. See [supplementary reviews](../../../evaluations/mentor-100/manual-skill-rechecks.json).

The initial 100 runs deliberately required recall and supplied guidance. Only recall was available; absence of mutations was enforced by the harness. All fixtures were synthetic, all were globally scoped within isolated profiles, and this is a single-model, one-sample-per-prompt evaluation. A separate actual MCP probe showed a matching lesson under a named scope is missed unless the caller specifies that scope. Natural discovery and scope routing remain high-priority work.

## Context usage

The initial 100 conversations reported 3, 267,487 aggregate input tokens, including 2,475, 264 cached input tokens, and 36,113 output tokens. These counters include repeated host context across tool turns. They are not the memory's byte budget or a monetary bill.

For the 10 paired prompts, Greybeard runs reported 327,063 input (255,232 cached) and 3,565 output tokens; baselines reported 97,016 input (27,008 cached) and 1,828 output tokens. The difference includes tool availability, tool round trips, instructions, caching, and answer length. It is not a general production cost multiplier, but it clearly does not support a token-savings claim.

## Live environment work

A separate read-only Lokka inspection made 19 explicit beta Graph GET requests. The lab returned useful policy, assignment, inventory, scheduled-action, and Conditional Access context. Production organization read returned 403; only a limited production application sample succeeded. No tenant changes, permission grants, or real administrator-memory confirmations occurred.

See [scoped observations and API behavior](tenant-observations.md). Raw tenant evidence stays in the private local Downloads review folder; the repository contains anonymized findings only. Lab access does not certify Greybeard's least-privilege customer connection.

## Product direction

Install Greybeard to retain reviewed operating knowledge across sessions and tools, and to bring an applicable exception or correction into the next decision. An administrator would miss it when removing it means re-explaining that knowledge or repeating a previously documented mistake.

The next build should prove that moment in natural client use, preserve the meaning of recalled rules, route to the right scope, and distinguish fresh observations from remembered decisions. Continuous model calls and repetitive branded reminders would not solve those gaps.

[Issues, priorities, and acceptance criteria](issues-and-next-build.md).
