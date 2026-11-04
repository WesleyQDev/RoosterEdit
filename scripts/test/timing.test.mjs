import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";

import {
  resetTimings,
  startTimer,
  timeAsync,
  timeSync,
  timingReport,
  writeTimings,
} from "../lib/timing.mjs";

beforeEach(() => {
  resetTimings();
  delete process.env.ROOSTER_TIMING;
});

function tempDir(t, prefix = "rooster-timing-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return dir;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("startTimer records a stage with the stable shape", () => {
  const timer = startTimer("prepare");
  assert.equal(timer.label, "prepare");
  assert.equal(timer.status, "running");
  assert.equal(timer.ms, 0);

  const stopped = timer.stop();
  assert.equal(stopped, timer);
  assert.equal(timer.status, "ok");
  assert.ok(timer.ms >= 0);
  assert.ok(!Number.isNaN(Date.parse(timer.startedAt)));

  const report = timingReport();
  assert.equal(report.stages.length, 1);
  assert.deepEqual(report.stages[0], {
    label: "prepare",
    ms: timer.ms,
    startedAt: timer.startedAt,
    status: "ok",
  });
});

test("startTimer stop is idempotent", () => {
  const timer = startTimer("once");
  timer.stop("ok");
  const firstMs = timer.ms;
  timer.stop("error");
  assert.equal(timer.status, "ok");
  assert.equal(timer.ms, firstMs);
});

test("timeSync returns the value and records success or failure", () => {
  assert.equal(
    timeSync("sync", () => 42),
    42,
  );
  assert.equal(timingReport().stages[0].status, "ok");

  assert.throws(
    () =>
      timeSync("sync-error", () => {
        throw new Error("nope");
      }),
    /nope/,
  );
  const report = timingReport();
  assert.equal(report.stages.length, 2);
  assert.equal(report.stages[1].status, "error");
});

test("timeAsync awaits and records success or failure", async () => {
  const value = await timeAsync("async", async () => {
    await delay(5);
    return "done";
  });
  assert.equal(value, "done");
  assert.equal(timingReport().stages[0].status, "ok");

  await assert.rejects(
    timeAsync("async-error", async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  const report = timingReport();
  assert.equal(report.stages.length, 2);
  assert.equal(report.stages[1].status, "error");
});

test("timingReport sums stages and uses a versioned schema", () => {
  timeSync("first", () => {});
  timeSync("second", () => {});

  const report = timingReport();
  assert.equal(report.schema, "rooster.timings/v1");
  assert.ok(!Number.isNaN(Date.parse(report.generatedAt)));
  assert.equal(report.stages.length, 2);
  assert.deepEqual(
    report.stages.map((stage) => stage.label),
    ["first", "second"],
  );
  assert.ok(report.totalMs >= report.stages[0].ms + report.stages[1].ms - 0.001);
});

test("writeTimings writes JSON atomically and returns the path", (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, "logs", "timings.json");

  timeSync("write", () => {});
  const report = timingReport();
  assert.equal(writeTimings(file, report), path.resolve(file));

  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(parsed.stages, report.stages);
  assert.equal(parsed.schema, "rooster.timings/v1");

  const leftovers = fs
    .readdirSync(path.dirname(file))
    .filter((name) => name.includes(".tmp-"));
  assert.deepEqual(leftovers, []);
});

test("writeTimings defaults to the current report", (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, "timings.json");
  timeSync("default-report", () => {});
  writeTimings(file);

  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(parsed.stages[0].label, "default-report");
});

test("ROOSTER_TIMING=1 prints stages to stderr", () => {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  process.env.ROOSTER_TIMING = "1";
  try {
    timeSync("loud", () => {});
    timeSync("quiet", () => {}, { silent: true });
  } finally {
    console.error = original;
    delete process.env.ROOSTER_TIMING;
  }

  assert.equal(lines.some((line) => line.includes("loud")), true);
  assert.equal(lines.some((line) => line.includes("quiet")), false);
});

test("a custom log callback receives the stage", () => {
  const stages = [];
  timeSync("custom", () => {}, { log: (stage) => stages.push(stage) });
  assert.equal(stages.length, 1);
  assert.equal(stages[0].label, "custom");
  assert.equal(stages[0].status, "ok");
});
