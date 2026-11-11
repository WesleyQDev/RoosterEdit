# AGENTS.md

Rules for agents editing the **RoosterEdit** repository. Read this file before any change.

Precedence when rules conflict:

1. `AGENTS.md` — repository process and limits.
2. `SKILL.md` + `references/` — the skill contract (English).
3. Code in `scripts/` — actual behavior.
4. `docs/` — human documentation.

If code contradicts documentation, code wins for describing behavior; fix the documentation or record the divergence.

---

## 1. What this repository is

- The repository root **is the skill package**. It is not a video workspace.
- `scripts/rooster.mjs` is the CLI (Node.js, ESM, zero runtime dependencies).
- `scripts/lib/` holds infrastructure: cache, async exec, capabilities, engines, media, ASR, build, render.
- `scripts/features/` holds pure helpers (FFmpeg args, captions, charts, audio, motion).
- `scripts/test/` holds tests with `node:test` (zero dependencies).
- `references/` and `agents/` are part of the installable skill and are written in English.
- `docs/` is durable human documentation.
- `.opencode/skills/rooster-edit/` is a **generated copy** made by `scripts/sync-skill.mjs`. Never edit that copy; edit the root and run the sync.
- `rooster/` is the user's default video workspace. It is git-ignored and must not be created at the root for tests.

## 2. What to read before working

| Task | Read first |
|---|---|
| Any change | `AGENTS.md` (this file) |
| Skill, workflow, commands | `SKILL.md` |
| Editing, plan, timeline, QA | the specific reference in `references/` |
| Architecture and decisions | `docs/ARCHITECTURE.md` |
| Workspace, channels, profiles | `docs/WORKSPACE.md` |
| Tests already run | `docs/TESTING.md` |
| Cost and licenses | `docs/COSTS.md`, `references/assets.md` |

Do not read the whole repository by default. Read only the reference for the current phase.

## 3. Language

- `README.md`, `AGENTS.md`, `SKILL.md`, `references/`, `agents/`, `docs/`, and code comments: **English**.
- Docs that are still in Portuguese are being translated in batches. New or heavily edited docs must be written in English.
- Chat replies to the user: the language of the conversation.
- Do not translate command names, JSON fields, schemas, or paths.

## 4. Durable vs temporary (hard rule)

`docs/` is only for **durable** documentation that must survive releases and be maintained.

**Do not put in `docs/`:**

- audits;
- benchmarks and measurements from one task;
- session reports;
- drafts, exploratory analysis, idea lists;
- generated results, logs, frames, contact sheets;
- any file that starts with a date or a project name.

**Put them in `.scratch/`** (git-ignored), with a date prefix:

```text
.scratch/2026-11-03-performance-audit.md
.scratch/2026-11-05-render-bench.json
.scratch/2026-11-07-ux-ideas.md
```

Rules:

- `.scratch/` is disposable. Delete it without warning when the subject dies.
- Do not link `.scratch/` from the README or from `docs/`.
- If a finding becomes a permanent rule, distill it into the right place (`docs/`, `references/`, or `ROADMAP.md`) and delete the scratch file.
- Execution logs for a video project live in `work/logs/` inside the project workspace, not in this repository.
- Benchmarks from one machine do not become official documentation without a reproducible protocol and a date.

## 5. User data and safety

- Never delete or overwrite the user's original media.
- Do not run destructive commands (`rm -rf`, `Remove-Item -Recurse`, `--force`) outside test directories.
- For tests, point `ROOSTER_WORKSPACE` at a temporary directory and clean up afterward.
- Do not commit `.env`, keys, cookies, tokens, media, renders, caches, or logs.
- Do not call a paid API, paid TTS, or cloud render without explicit permission.
- Do not upload user media.
- Respect asset licenses and provenance; never invent a license.

## 6. Code rules

- Node.js `>=22`, ESM (`import`/`export`), zero runtime dependencies.
- Do not add an npm package without an explicit request; prefer the standard library.
- Keep the existing helper pattern: `run`, `readJson`, `writeJson`, `writeText`, `ensureDir`, `fail`, `probeMedia`, `linkOrCopy`.
- Pure feature logic lives in `scripts/features/`; infrastructure with I/O or processes lives in `scripts/lib/`; the CLI and dispatcher live in `scripts/rooster.mjs`.
- Automated tests live in `scripts/test/` and use `node:test`; do not add test dependencies.
- Avoid large unrequested refactors. The main file is large on purpose; changing it requires care.
- Windows compatibility: use `path.join`, spawn `.cmd` through `cmd.exe`, and avoid bash-only commands.
- `spawnSync` is the current pattern. If you need parallelism, add an isolated helper and do not change existing behavior without a test.
- Human output goes to stdout; `--json` must be stable and parseable by agents.
- Errors must say what failed and how to fix it; use `fail()` to exit with code 1.
- Do not hide a failure behind a silent fallback. If quality degrades, say so.

## 7. Changed the CLI? Checklist

Every behavior change must update the items below, when applicable:

1. Implementation in `scripts/rooster.mjs` or `scripts/features/`.
2. Help/usage text in the CLI itself.
3. `SKILL.md` (quick commands and contract), if it is a user-facing command or behavior.
4. The matching reference in `references/` (for example `edit-plan.md`, `engines.md`, `schemas.md`).
5. `templates/` if the plan or profile schema changed.
6. `docs/` only if it is durable knowledge.
7. `npm run validate`.
8. Smoke test in a temporary workspace.
9. `node scripts/sync-skill.mjs` if you need to test local discovery in OpenCode (the copy is generated; do not commit it).

Do not announce a command as ready without running it. If you could not test it, say what is missing.

## 8. Documentation

- `docs/` is durable: it needs a clear purpose and maintenance.
- Do not duplicate `SKILL.md`; link to it.
- Keep the documentation index in `README.md` up to date when adding a durable doc.
- Commands must be copyable, using `<skill>` for the skill path.
- Performance numbers only enter durable docs with a reproducible protocol.
- Temporary reports go to `.scratch/` (see section 4).

## 9. Testing and validation

- `npm run validate` is mandatory before finishing.
- `npm test` runs the unit tests (`node --test scripts/test/*.test.mjs`) and is also mandatory when the change touches `scripts/lib/`, `scripts/features/`, or schemas.
- Minimal CLI smoke test:

```bash
node scripts/rooster.mjs --help
node scripts/rooster.mjs doctor --json
```

- For workflow changes, test in a temporary workspace:

```bash
$env:ROOSTER_WORKSPACE = "$env:TEMP\rooster-test"
node scripts/rooster.mjs init
node scripts/rooster.mjs channel new demo --language en-US --format 16:9 --profile minimal
node scripts/rooster.mjs channel design demo --from minimal --accent "#22d3ee"
node scripts/rooster.mjs new test-video --channel demo
```

- There is no formal test suite. `docs/TESTING.md` is a record of manual tests, not an automated suite.
- If you add automated tests, use `node:test` and keep zero dependencies.
- Test error paths too: missing file, invalid plan, unavailable FFmpeg.
- On Windows, watch for file handles and hardlinks; validate behavior on the target OS.

## 10. Skill sync

- Source of truth: the repository root.
- `.opencode/skills/rooster-edit/` is a local build artifact, git-ignored.
- Run `npm run sync` (or `node scripts/sync-skill.mjs`) after changing `SKILL.md`, `references/`, `scripts/`, `templates/`, or `agents/`, if you need to test in OpenCode.
- Never edit files in `.opencode/` directly.

## 11. Performance

- Measure before optimizing. Benchmarks and results go to `.scratch/` or `work/logs/`, not `docs/`.
- Cache only with an invalidation key (content + tool version + options) and a `--refresh` option.
- Do not trade quality for speed silently: draft and final are explicit.
- Hardware encoding only for draft/intermediate work, unless quality is validated for delivery.
- Do not add unbounded parallelism; Chrome and FFmpeg consume RAM and CPU.
- If a performance report is requested, the default path is `.scratch/YYYY-MM-DD-performance-*.md`.

## 12. Git and commits

- Small, focused commits.
- Conventional style: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`.
- Do not commit generated artifacts: `.opencode/`, `rooster/`, `.rooster/`, `.scratch/`, renders, media, logs.
- Do not rewrite history or force-push without permission.
- Do not mix a code change with a temporary report in the same commit.
- If the user asks to keep a scratch file, ask where to promote it before moving it to `docs/`.

## 13. When the task is producing a video

- Follow `SKILL.md` and the 6/8-step workflow.
- Do not render before the plan and preview are approved, unless explicitly asked.
- Use the project workspace; do not create a project at the skill repository root.
- Delegate heavy stages to subagents when the harness supports it; the main agent reads the handoff, not the transcript, log, or generated code.
- Close the task with the result, paths, blockers, and one next question.

## 14. Common traps

- `.opencode/skills/rooster-edit/` is generated; editing there does not change the skill.
- `docs/` is not the place for temporary reports; use `.scratch/`.
- `references/` is the English skill contract; do not translate it.
- `rooster/` at the root is a video workspace, not a test folder for the repository.
- `doctor` may call `npx` and take a while; do not put it in a test loop.
- `build --force` deletes the engine directory; never point it at a user project without intent.
- `linkOrCopy` uses a hardlink when possible; across volumes it becomes a copy.
- Windows may hold file handles; wait before deleting large directories.
- Do not assume a library is installed; check the version and the real adapter.

## 15. Quick commands

```bash
npm run validate
npm test
npm run sync
node scripts/rooster.mjs --help
node scripts/rooster.mjs doctor --json
```

## 16. Releases

Keep npm and GitHub in sync. A version is not released until the npm package and the GitHub release exist for the same tag.

1. Bump the version in `package.json`, `package-lock.json`, `SKILL.md`, and `scripts/rooster.mjs`.
2. Update hard-coded version assertions in `scripts/test/`.
3. Run `npm run validate` and `npm test`.
4. Commit `chore: release X.Y.Z`.
5. Create and push the annotated tag: `git tag -a vX.Y.Z -m "RoosterEdit vX.Y.Z"` and `git push origin vX.Y.Z`.
6. Publish to npm. With a stage-only token, run `npm stage publish` and approve the staged version on npmjs.com.
7. Verify `npm view rooster-edit version` and `npx rooster-edit@latest version`.
8. Create the GitHub release from the tag after npm is live, with the install command and highlights.
9. Verify the release page and the npm page.

Do not create the GitHub release before the npm version is live.

If something is unclear, ask before inventing a new convention.
