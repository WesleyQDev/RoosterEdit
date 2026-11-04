import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FEEDBACK_ISSUES_URL,
  FEEDBACK_REPO,
  buildFeedbackIssue,
  feedbackBody,
  feedbackTitle,
  redactObject,
  redactText,
} from "../features/feedback.mjs";

// ---------------------------------------------------------------------------
// redactText: paths
// ---------------------------------------------------------------------------

test("redactText replaces home, workspace, project, and extra paths", () => {
  const windowsOptions = {
    home: "C:\\Users\\Alice",
    workspace: "C:\\Users\\Alice\\dev\\rooster",
    project: "C:\\Users\\Alice\\dev\\rooster\\projects\\demo",
    extraPaths: ["D:\\assets\\raw"],
  };
  const windowsText = [
    "home C:\\Users\\Alice\\notes.txt",
    "forward C:/Users/Alice/dev/rooster/work",
    "project C:\\Users\\Alice\\dev\\rooster\\projects\\demo\\rooster.json",
    "extra D:\\assets\\raw\\clip.mp4",
    "unrelated hello world",
  ].join("\n");

  const windowsOut = redactText(windowsText, windowsOptions);
  assert.ok(windowsOut.includes("home ~\\notes.txt"));
  assert.ok(windowsOut.includes("forward <workspace>/work"));
  assert.ok(windowsOut.includes("project <project>\\rooster.json"));
  assert.ok(windowsOut.includes("extra <path>\\clip.mp4"));
  assert.ok(windowsOut.includes("unrelated hello world"));
  assert.ok(!windowsOut.includes("C:\\Users\\Alice"));
  assert.ok(!windowsOut.includes("D:\\assets\\raw"));

  const posixOptions = {
    home: "/home/alice",
    workspace: "/home/alice/dev/rooster",
    project: "/home/alice/dev/rooster/projects/demo",
    extraPaths: ["/mnt/assets/raw"],
  };
  const posixText = [
    "home /home/alice/notes.txt",
    "workspace /home/alice/dev/rooster/work",
    "project /home/alice/dev/rooster/projects/demo/rooster.json",
    "extra /mnt/assets/raw/clip.mp4",
    "unrelated stays",
  ].join("\n");

  const posixOut = redactText(posixText, posixOptions);
  assert.ok(posixOut.includes("home ~/notes.txt"));
  assert.ok(posixOut.includes("workspace <workspace>/work"));
  assert.ok(posixOut.includes("project <project>/rooster.json"));
  assert.ok(posixOut.includes("extra <path>/clip.mp4"));
  assert.ok(posixOut.includes("unrelated stays"));
  assert.ok(!posixOut.includes("/home/alice"));
  assert.ok(!posixOut.includes("/mnt/assets/raw"));
});

// ---------------------------------------------------------------------------
// redactText: tokens
// ---------------------------------------------------------------------------

test("redactText redacts token patterns and key/value secrets", () => {
  const text = [
    "github ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "fine github_pat_11ABCDEFG0123456789_abcdefghijklmnop",
    "openai sk-proj-abc123XYZ",
    "slack xoxb-1234-5678-abcdef",
    "auth Bearer abc.def-123_ghi",
    "api_key=secret123",
    "APIKEY: 'my secret'",
    "token = abc",
    "secret=shh",
    "password: hunter2",
    "cookie=sessionid",
  ].join("\n");

  const out = redactText(text);
  for (const secret of [
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "github_pat_11ABCDEFG0123456789_abcdefghijklmnop",
    "sk-proj-abc123XYZ",
    "xoxb-1234-5678-abcdef",
    "abc.def-123_ghi",
    "secret123",
    "my secret",
    "abc",
    "shh",
    "hunter2",
    "sessionid",
  ]) {
    assert.ok(!out.includes(secret), `leaked ${secret}`);
  }

  assert.ok(out.includes("api_key=<redacted>"));
  assert.ok(out.includes("APIKEY: '<redacted>'"));
  assert.ok(out.includes("token = <redacted>"));
  assert.ok(out.includes("secret=<redacted>"));
  assert.ok(out.includes("password: <redacted>"));
  assert.ok(out.includes("cookie=<redacted>"));
  assert.ok(out.includes("Bearer <redacted>"));
});

// ---------------------------------------------------------------------------
// redactText: fallback user homes
// ---------------------------------------------------------------------------

test("redactText redacts Windows and POSIX user home fallbacks", () => {
  const out = redactText(
    "C:\\Users\\Alice\\file /home/alice/x /Users/Alice/y",
  );

  assert.ok(out.includes("C:\\Users\\<user>\\file"));
  assert.ok(out.includes("/home/<user>/x"));
  assert.ok(out.includes("/Users/<user>/y"));
  assert.ok(!out.includes("Alice"));
  assert.ok(!out.includes("alice"));
});

// ---------------------------------------------------------------------------
// redactObject
// ---------------------------------------------------------------------------

test("redactObject deep-clones and redacts strings without mutating input", () => {
  const input = {
    path: "C:\\Users\\Alice\\clip.mp4",
    nested: {
      token: "ghp_abcdefghijklmnopqrstuvwxyz012345",
      count: 3,
      ok: true,
      none: null,
    },
    list: ["/home/alice/x", 7, false, null],
  };
  const snapshot = structuredClone(input);

  const out = redactObject(input, { home: "C:\\Users\\Alice" });

  assert.notEqual(out, input);
  assert.notEqual(out.nested, input.nested);
  assert.notEqual(out.list, input.list);
  assert.deepEqual(input, snapshot);

  assert.equal(out.path, "~\\clip.mp4");
  assert.equal(out.nested.token, "<redacted>");
  assert.equal(out.nested.count, 3);
  assert.equal(out.nested.ok, true);
  assert.equal(out.nested.none, null);
  assert.equal(out.list[0], "/home/<user>/x");
  assert.equal(out.list[1], 7);
  assert.equal(out.list[2], false);
  assert.equal(out.list[3], null);
});

// ---------------------------------------------------------------------------
// feedbackTitle
// ---------------------------------------------------------------------------

test("feedbackTitle prefers summary and falls back through error, command, project, default", () => {
  assert.equal(feedbackTitle({ summary: "  Render   failed\non demo  " }), "Render failed on demo");
  assert.equal(
    feedbackTitle({ summary: "   ", error: "ffmpeg exited 1" }),
    "command failed: ffmpeg exited 1",
  );
  assert.equal(
    feedbackTitle({ command: "rooster render demo" }),
    "issue with: rooster render demo",
  );
  assert.equal(feedbackTitle({ project: "demo" }), "Feedback: demo");
  assert.equal(feedbackTitle({ project: { slug: "demo" } }), "Feedback: demo");
  assert.equal(feedbackTitle(), "RoosterEdit feedback");

  const summaryTitle = feedbackTitle({ summary: "word ".repeat(40).trim() });
  assert.equal(summaryTitle.length, 120);

  const errorTitle = feedbackTitle({ error: "x".repeat(200) });
  assert.equal(errorTitle, `command failed: ${"x".repeat(90)}`);
  assert.ok(errorTitle.length <= 120);

  const commandTitle = feedbackTitle({ command: "y".repeat(200) });
  assert.equal(commandTitle.length, 120);
  assert.ok(commandTitle.startsWith("issue with: "));
});

// ---------------------------------------------------------------------------
// feedbackBody
// ---------------------------------------------------------------------------

test("feedbackBody renders sections in order and omits diagnostics when disabled", () => {
  const body = feedbackBody({
    summary: "Render failed",
    notes: "Happened twice",
    command: "rooster render demo",
    error: "ffmpeg exited 1",
    expected: "an mp4",
    actual: "no file",
    steps: ["run rooster render demo", "wait for ffmpeg"],
    project: {
      slug: "demo",
      engine: "hyperframes",
      timeline: "rooster.timeline/v1",
      format: "16:9",
      duration: 10,
      status: "failed",
      profile: "minimal",
      channel: "demo",
    },
    environment: {
      rooster: "0.1.0",
      os: "Windows 11",
      node: "v20.11.0",
      ffmpeg: "6.1",
      hyperframes: "1.2",
      remotion: "n/a",
      filmcraft: "n/a",
      git: "2.43",
      gh: "2.40",
    },
    validation: { errors: ["missing source"], warnings: ["fps mismatch"] },
    render: {
      quality: "draft",
      engine: "hyperframes",
      issues: ["frame 12 blank"],
      duration: 10,
      resolution: "1920x1080",
      createdAt: "2026-01-01",
    },
    logs: "line a\nline b",
  });

  const order = [
    "## Summary",
    "## What happened",
    "## Steps to reproduce",
    "## Environment",
    "## Project",
    "## Validation",
    "## Last render",
    "## Logs",
    "## Privacy",
    "---",
    FEEDBACK_ISSUES_URL,
  ];
  let cursor = -1;
  for (const marker of order) {
    const index = body.indexOf(marker);
    assert.ok(index > cursor, `${marker} missing or out of order`);
    cursor = index;
  }

  assert.ok(body.includes("Render failed"));
  assert.ok(body.includes("Happened twice"));
  assert.ok(body.includes("- **Command:** rooster render demo"));
  assert.ok(body.includes("- **Error:** ffmpeg exited 1"));
  assert.ok(body.includes("1. run rooster render demo"));
  assert.ok(body.includes("2. wait for ffmpeg"));
  assert.ok(body.includes("- **slug:** demo"));
  assert.ok(body.includes("- **rooster:** 0.1.0"));
  assert.ok(body.includes("**Errors**"));
  assert.ok(body.includes("- missing source"));
  assert.ok(body.includes("**Warnings**"));
  assert.ok(body.includes("- fps mismatch"));
  assert.ok(body.includes("- **quality:** draft"));
  assert.ok(body.includes("- frame 12 blank"));
  assert.ok(body.includes("line a\nline b"));
  assert.ok(body.includes("- [ ] I reviewed"));

  const noDiagnostics = feedbackBody({
    summary: "Render failed",
    command: "rooster render demo",
    project: { slug: "demo" },
    environment: { node: "v20" },
    validation: { errors: ["bad"] },
    render: { quality: "draft" },
    logs: "tail",
    includeDiagnostics: false,
  });

  assert.ok(noDiagnostics.includes("## Summary"));
  assert.ok(noDiagnostics.includes("## What happened"));
  for (const omitted of [
    "## Environment",
    "## Project",
    "## Validation",
    "## Last render",
    "## Logs",
  ]) {
    assert.ok(!noDiagnostics.includes(omitted), `${omitted} should be omitted`);
  }
});

test("feedbackBody escapes HTML in logs and truncates long logs", () => {
  const escaped = feedbackBody({ logs: '<script>alert("x") & more</script>' });
  assert.ok(escaped.includes('&lt;script&gt;alert("x") &amp; more&lt;/script&gt;'));
  assert.ok(!escaped.includes("<script>"));

  const lines = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`);
  const long = feedbackBody({ logs: lines });
  const lineMatch = long.match(/<pre>([\s\S]*?)<\/pre>/);
  assert.ok(lineMatch);
  const contentLines = lineMatch[1].split("\n");
  assert.equal(contentLines.length, 120);
  assert.equal(contentLines[0], "line 81");
  assert.equal(contentLines[119], "line 200");

  const chars = feedbackBody({ logs: "x".repeat(20000) });
  const charMatch = chars.match(/<pre>([\s\S]*?)<\/pre>/);
  assert.ok(charMatch);
  assert.equal(charMatch[1].length, 12000);
});

test("feedbackBody ignores transcript and plan fields", () => {
  const body = feedbackBody({
    summary: "ok",
    project: {
      slug: "demo",
      transcript: "TRANSCRIPT_SHOULD_NOT_APPEAR",
      plan: { elements: ["PLAN_SHOULD_NOT_APPEAR"] },
    },
    transcript: "TOP_TRANSCRIPT_SHOULD_NOT_APPEAR",
    plan: "TOP_PLAN_SHOULD_NOT_APPEAR",
  });

  assert.ok(!body.includes("TRANSCRIPT_SHOULD_NOT_APPEAR"));
  assert.ok(!body.includes("PLAN_SHOULD_NOT_APPEAR"));
  assert.ok(body.includes("- **slug:** demo"));
});

// ---------------------------------------------------------------------------
// buildFeedbackIssue
// ---------------------------------------------------------------------------

test("buildFeedbackIssue defaults the repo and normalizes labels", () => {
  const issue = buildFeedbackIssue({
    summary: "Render failed",
    labels: [" bug ", "", "feedback", null, "bug"],
  });

  assert.equal(issue.repo, FEEDBACK_REPO);
  assert.deepEqual(issue.labels, ["bug", "feedback"]);
  assert.equal(issue.title, "Render failed");
  assert.ok(issue.body.includes("## Summary"));
  assert.ok(issue.body.includes("Render failed"));

  const custom = buildFeedbackIssue({ repo: " someone/fork ", project: "demo" });
  assert.equal(custom.repo, "someone/fork");
  assert.equal(custom.title, "Feedback: demo");
  assert.deepEqual(custom.labels, []);
});

test("buildFeedbackIssue produces a valid draft for empty input", () => {
  const issue = buildFeedbackIssue();

  assert.equal(issue.title, "RoosterEdit feedback");
  assert.equal(issue.repo, FEEDBACK_REPO);
  assert.deepEqual(issue.labels, []);
  assert.ok(issue.body.includes("## Summary"));
  assert.ok(issue.body.includes("(describe here)"));
  assert.ok(issue.body.includes("## Privacy"));
  assert.ok(issue.body.trim().endsWith(FEEDBACK_ISSUES_URL));
  assert.ok(issue.body.length < 20000);
});
