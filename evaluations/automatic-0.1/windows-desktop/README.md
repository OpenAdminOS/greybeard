# Windows desktop verification, 2026-09-12

Synthetic local workspace, no tenant connection or tenant operations. Claude Desktop and Cursor were installed/launched using their normal Windows application flows and existing authorized accounts. No authentication material or screenshots are included here.

## Claude Desktop Code

Claude Desktop updated to 1.52386.3.0. With normal generated Greybeard integration, a natural operating-preference prompt specified a 48-hour Windows pilot plus helpdesk review. The user prompt did not request Greybeard or a memory tool. The hook created candidate #1; the model acknowledged that the candidate awaited exact human review.

The exact synthetic candidate was reviewed and confirmed in the native companion. A new Code conversation asked for three Windows rollout checkpoints without repeating the pilot duration. The response included the 48-hour pilot and helpdesk review. `claude-events.json` records the first proposal and subsequent prompt context containing memory #1 (705 bytes). This proves actual Desktop Code prompt delivery and observed reuse in these conversations, not universal model compliance. Ordinary Chat automatic observation is not claimed.

## Cursor

Cursor 3.20.17 used a local IDE workspace. Initial prompts and tool events reached Greybeard but failed JSON parsing. A temporary probe recorded only the byte count, first four bytes and JSON key names: the input began `efbbbf7b`, a UTF-8 BOM followed by `{`. The probe forwarded the original bytes unchanged and was removed after diagnosis.

After the bounded decoder fix, actual prompt events created inactive candidates and recalled memory #1 into the companion. A native Windows notification appeared with generic advice text, without the prompt or memory text. A subsequent post-tool event delivered 705 bytes of confirmed context. `cursor-events.json` retains event metadata from the fixed run. Quiet later events reflect duplicate suppression. Prompt output remains the companion channel; it is not labeled as model-context injection.

One automated keystroke entry lost part of its text inside the editor before submission. Its exact malformed text was preserved as a candidate, never confirmed. Pasting a complete synthetic prompt through normal native input produced the correct candidate. This input-harness artifact is distinct from the verified BOM transport bug.

## Review and remaining limits

- Passed: actual Desktop Code candidate creation, exact companion confirmation, recall in a new conversation; actual Cursor prompt/candidate delivery, generic notification and post-tool context.
- The initial signed installation was build `cccf8eb`. Cursor's fixed event capture used the same source runtime with the BOM correction, pending replacement by the final signed installer. Installer verification is recorded separately on PR #2.
- Preferences currently retain the exact matched prompt, including trailing task instructions. The review gate prevents automatic activation, but extracting shorter proposals is a future quality improvement.
- These are focused acceptance conversations, not a broad model-quality benchmark. Mac host delivery and login-startup behavior require separate checks.
- No semantic or geographic relationships are inferred by the new memory map. Native Electron checks cover actual correction links, source/status filtering, rotation, keyboard/flat access, timeline, forgetting, failed-load recovery and safe exact text.
