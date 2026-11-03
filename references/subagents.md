# Subagents

RoosterEdit works like a small studio: the main agent is the director, and the stage subagents are the crew. The director talks to the user, holds the brief and the decisions, opens and closes approval gates, and judges the result. The crew reads the raw material, does one job, writes the full detail to disk, and returns a handoff small enough to keep in the main thread.

This is the main lever for context cost. Video work produces far more raw material than conversation: a transcript, a media probe, a plan, engine code, build logs, a QA sweep. None of it needs to live in the director's head. For the general rules, read `references/token-discipline.md`; this file is the delegation protocol.

## When to delegate

Delegate a stage when it reads or produces more than about one screen of raw material, or when it runs a noisy command. Keep it in the main thread when:

- it is one cheap command (`doctor`, `list`, `open`);
- it is the conversation itself: intake, clarifying questions, approval gates;
- it is the final visual or editorial judgment;
- the harness cannot start a fresh agent with file and command access.

Do not spawn a subagent for a question that one file read answers, and do not delegate a stage you cannot describe with concrete input and output paths. A fresh context has a real cost; delegate by artifact, not by reflex.

## Capability test

A harness supports stage subagents if it can:

1. start a fresh agent with its own context;
2. give it a prompt and a working directory;
3. let it read and write project files and run commands;
4. return its final message to the main agent.

If any of these is missing, if the subagent cannot read the skill folder, or if two spawns fail, run the stage inline. The project must not block waiting for delegation. The fallback at the end of this file is part of the protocol, not an error path.

## Cast

| Step | Role file | Main input | Writes | Main receives |
|---|---|---|---|---|
| 02 Intake | `producer.md` | conversation notes, channel | `brief.md` | 5-line brief + open questions |
| 02 Research | `researcher.md` | brief, topic | `work/research.md` | 5 findings + sources + license flags |
| 03 Transcript | `transcript-analyst.md` | media, brief | `edit/transcript.json`, `edit/digest.md`, `edit/analysis.json` | duration, topics, beats, flags |
| 04 Script | `scriptwriter.md` | brief, analysis | `script.md`, `script.json` | hook + beat summary |
| 04 Plan | `editor.md` | brief, style, analysis, manifest | `edit/plan.json`, `plan.md`, `plan.html` | plan summary + risks |
| 05 Style | `art-director.md` | brief, profile, plan | `style.md`, `style/proof/`, `storyboard/storyboard.json` | tokens + scene count + asset needs |
| 05 Timeline | `editor.md` | plan, storyboard | `edit/timeline.json`, `edit/edl.json` | duration math + markers |
| 05 Audio | `audio-director.md` | plan, timeline, script | `edit/voiceover.json`, audio fields | voice/music/mix decisions |
| 06 Build | `engineer.md` | plan, style, timeline | `engine/<engine>/`, `work/logs/` | status + paths + blocker |
| 07 QA | `qa.md` | render, plan, checklist | `qa/report.md`, `qa/text-review.md`, frames, probes | verdict + top issues + frames |
| 08 Render | `engineer.md` | approved plan, QA | `renders/`, delivery files, `edit/export/` | final path + probe stats |

The step numbers match the 8-step tracker in `SKILL.md`. A step can use more than one role; each role still returns its own handoff.

## What the main agent may read

Keep this line clear:

- **Read freely:** `brief.md`, `script.md`, `style.md`, `plan.md`, `review.md`, handoffs, and 3–5 representative frames. View `plan.html` in the preview pane instead of reading its source.
- **Do not read:** raw `transcript.json`, word-level captions, full manifests, full timelines, generated engine code, build/render logs, contact sheets with dozens of frames.

The first group is decisions. The second is material. If a detail from the second group is needed, ask the subagent that owns it or spawn a reader for that one file. Do not pull the file into the main thread "just to check".

## Handoff contract

Every subagent writes a handoff to the path passed in the spawn prompt (default: `work/handoffs/<step>-<role>.md`) and returns the same content as its final message. Keep it under 15 lines for mechanical stages and under 25 for plan, QA, and delivery.

```md
# Handoff — <step> <role>
status: ok | needs-decision | blocked
artifacts:
- edit/plan.json
- edit/plan.html
summary:
- 12 cuts, 8 elements, 58.4s against a 60s target
- hook: "..." (0.0–3.0s)
decisions:
- accept the 2.1s cold open?
blockers:
- none
next: 5/8 storyboard and timeline
```

Rules for the handoff:

- `artifacts` are project-relative paths that exist. No "planned" paths.
- `summary` is outcomes, not process. Five bullets is the ceiling.
- `decisions` are choices the main agent or user must confirm. Do not hide a creative change here.
- `blockers` say what was tried and what is missing. "It failed" is not a blocker.
- No logs, code, transcript text, JSON dumps, or long quotes. The detail lives in the files.
- If the stage cannot proceed, return `status: blocked` early instead of producing a partial artifact.

## Gate ritual

At every approval gate, run the same short loop:

1. Read the handoff, not the raw file.
2. Verify the artifact paths exist and look at 3–5 frames when the stage is visual.
3. Ask the user one clear question about the decision, not a status report.
4. Append the decision to `review.md` with the date, the choice, and the reason.
5. Spawn the next stage with the new handoff path and the constraints that changed.

The `review.md` entry is what lets a compacted or resumed session recover the direction without re-reading the project. Keep it to a few lines per gate.

## Spawn prompt

Pass paths, not content. The subagent reads the role file and the inputs itself.

```text
RoosterEdit subagent: <role>.
Project: <absolute project path>
Workspace: <absolute workspace path>
Skill: <absolute skill base path>   # references/ and agents/ resolve here
Handoff: <project-relative handoff path>

Read <skill>/agents/<role>.md and follow it. Paths under references/ and agents/ in that file resolve against the Skill path.
Task: <one sentence>.
Inputs: <project-relative paths only>.
Constraints: <2–4 lines: duration, format, language, approvals already given>.
Do not ask me for information you can read from the files. If blocked, return status=blocked.
Return only the handoff template. Do not paste logs, code, transcripts, or JSON.
```

A few details matter more than they look:

- **Pass the role file path, not the role text.** The main agent should not load the role into its own context.
- **Pass a task, not an essay.** If the task needs a paragraph of context, that context belongs in `brief.md`, `review.md`, or a handoff.
- **Match the agent type to the work.** Use whatever the harness calls its general-purpose or worker agent for stages that write files or run commands. If it has only one type, use it. A read-only or research type is fine for research; do not give it a build task. Do not depend on the tool or agent name; the capability is what matters.
- **Externalize the conversation first.** If the input lives only in the chat, write it to `work/intake.md` or `work/decisions.md` before spawning. Point to that file; do not paraphrase the conversation into the prompt.
- **Respect the sandbox.** If a subagent cannot read the skill folder, install the skill locally or copy the role file into `work/scratch/role.md` and point to that copy. Do not paste the role into the main context.

## Stage playbook

### 02 Intake and brief

The conversation stays in the main thread: it is cheap and needs judgment. Delegate the reference gathering and, when the intake is dense, the first draft of the brief. The producer reads `project.json`, `channel.json`, and the intake notes, then writes a one-page brief. It lists missing answers as open questions; it does not invent them.

### 03 Assets and transcript

This is the highest-value delegation. `transcript-analyst` runs transcription if needed, writes the digest and `edit/analysis.json`, and returns counts, topics, hook candidates, and flags. The main agent never reads `transcript.json`. If the user asks for a specific quote, the main agent asks the analyst for it or runs `digest` for that narrow range.

### 04 Script and plan

`scriptwriter` turns the analysis into a script or paper edit. `editor` turns the approved script into `edit/plan.json` with cuts, elements, music, and duration math; it also writes `edit/timeline.json` and `edit/edl.json` when the project uses them. The main agent reviews `plan.html` with the user; it does not read the plan JSON unless a field must be edited. The HTML now includes transcript context and the text-review table. Plan changes go back to the editor, not into the main thread. Run `textcheck` before the final approval.

### 05 Style, storyboard, and audio

`art-director` resolves the profile and writes `style.md` plus the storyboard. It also produces the three-frame style proof (`styleproof`) for the hook, data, and caption frames. `audio-director` handles TTS, music, SFX, and mix decisions after the plan exists; it may edit only the audio fields of the plan. Keep these two serialized: both touch the plan or the artifacts derived from it.

### 06 Build

`engineer` owns the engine project, the build logs, and the fixes. Give it the plan path and the engine, not the plan contents. It redirects output to `work/logs/`, reads the tail, runs the engine check, and returns status and artifact paths. Generated code never enters the main context. Before the full build, it runs `build --sample 3` so the user can approve three representative elements. If a fix needs an editorial decision, the engineer returns `needs-decision` with one question instead of changing the story.

### 07 Preview and QA

`qa` opens `preview/index.html` when a browser is available, captures screenshots, checks console and network errors, probes the render, extracts 5–9 frames, and writes `qa/report.md`. It runs `textcheck` and reviews `qa/text-review.md`, then checks every cut boundary by ear. It returns a verdict, the blocking issues, and the frame paths. The main agent looks at 3–5 of those frames itself before asking the user to approve: visual judgment is the director's job, not a delegated checkbox.

### 08 Render and delivery

Use `engineer` in render or package mode. It renders the draft or final, validates with FFprobe, writes `renders/thumbnail.jpg` and `renders/metadata.json`, and returns the path and stats. If the user wants an NLE, run `export <slug> --format both` and hand over `edit/export/`. The main agent verifies that the file exists and reports it; it does not read the render log.

### 09 Learn

The main thread records the decisions and feedback in `review.md` and offers to save the profile or component. A subagent can draft the reusable style or component, but the main agent decides what becomes a default.

## Parallelism

Parallel subagents are useful, but only when the work is independent:

- research, three script variants, and art-direction options can run in parallel after the brief is stable;
- QA and a fix cannot run in parallel on the same artifact;
- multiple engineers editing the same engine project will conflict.

The default is **one stage at a time**. Parallelize read-only or proposal work, serialize writes to shared files, and cap concurrency at three or four to avoid rate limits. If parallel workers touch separate scene files, the main agent needs a merge step and a single build afterward.

## Follow-ups and escalation

Keep the subagent's session when the harness supports it. A follow-up such as "the user rejected beat 7, propose two alternatives" is cheaper and more accurate than a new context. If the harness does not keep sessions, include the relevant handoff path and the exact question in the new prompt.

If the main agent finds a problem in a returned artifact, send it back with evidence. Do not fix the artifact by hand in the main thread and do not ask the user to arbitrate a technical detail the subagent can resolve.

## Verification without ingestion

The main agent still verifies. Cheap checks that do not flood the context:

- check that every path in `artifacts` exists and is non-empty;
- run `ffprobe` with a one-line summary for duration, resolution, fps, audio;
- open `plan.html` and 3–5 JPEG frames;
- read the handoff and `review.md`;
- ask QA for a specific finding if a screenshot raises a question.

Trust is not the issue; context is. A 10-second probe is cheaper than a 40k-token log.

## Fallback

When the harness has no fresh-context agent tool, the subagent cannot read the role file or write artifacts, or the spawn fails twice:

1. Do the stage inline, in sequence.
2. Still write the handoff file and keep raw output in `work/logs/`.
3. Read only the summary, the tail of the log, and a few frames.
4. Tell the user which stages ran inline, without pretending parallelism.

The protocol degrades to "files instead of context", which is still much cheaper than pasting everything into the chat.

## Anti-patterns

- Spawning a subagent for a one-line question or a single `ls`.
- Delegating the user conversation or an approval gate.
- A subagent that returns a 300-line report, a full transcript, or a log tail.
- The main agent reading the raw file "to double check" after every handoff.
- Parallel writers on the same plan, timeline, or engine project.
- Letting a subagent change the story, the license, or the budget without a `needs-decision`.
- Hiding a failure behind a lower-quality artifact.
- One giant subagent that does the whole project: it saves nothing and loses the gates.

## Cost sketch

The numbers vary by project, but the shape is stable:

| Stage | Raw material | Main-thread cost with a handoff |
|---|---|---|
| Transcript | 10k–60k tokens | ~300 tokens |
| Plan | 2k–10k tokens of JSON | ~400 tokens + the HTML the user reviews |
| Build | 5k–40k tokens of logs and code | ~250 tokens |
| QA | 5k–30k tokens of logs and frames | ~400 tokens + 3–5 images |

The subagent pays the cost of its own context once and discards it. The main thread pays the handoff once and keeps it for the rest of the session. That is the trade: a small fixed cost per stage in exchange for not carrying the raw material through every later turn.
