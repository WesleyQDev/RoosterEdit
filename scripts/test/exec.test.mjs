import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  commandName,
  quoteCmd,
  runAsync,
  runPool,
} from "../lib/exec.mjs";

function tempDir(t, prefix = "rooster-exec-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return dir;
}

function nodeScript(source, args = [], options = {}) {
  return runAsync(process.execPath, ["-e", source, ...args], options);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("commandName handles Windows shims", () => {
  if (process.platform === "win32") {
    assert.equal(commandName("npm"), "npm.cmd");
    assert.equal(commandName("npx"), "npx.cmd");
    assert.equal(commandName("pnpm"), "pnpm.cmd");
    assert.equal(commandName("yarn"), "yarn.cmd");
    assert.equal(commandName("node"), "node");
    assert.equal(commandName("C:\\tools\\run.CMD"), "C:\\tools\\run.CMD");
    assert.equal(commandName("C:\\tools\\run.bat"), "C:\\tools\\run.bat");
  } else {
    assert.equal(commandName("npm"), "npm");
    assert.equal(commandName("node"), "node");
  }
  assert.throws(() => commandName(""), /required/);
});

test("quoteCmd quotes only when needed and escapes quotes", () => {
  assert.equal(quoteCmd("plain"), "plain");
  assert.equal(quoteCmd("with space"), '"with space"');
  assert.equal(quoteCmd(""), '""');
  assert.equal(quoteCmd("a&b"), '"a&b"');
  assert.equal(quoteCmd('a"b'), '"a\\"b"');

  const trailing = quoteCmd("C:\\folder with space\\");
  assert.equal(trailing.startsWith('"C:\\folder with space'), true);
  assert.equal(trailing.endsWith('\\\\"'), true);
});

test("runAsync routes .cmd and .bat shims through cmd.exe", async (t) => {
  if (process.platform !== "win32") return;

  const dir = path.join(tempDir(t), "with space");
  fs.mkdirSync(dir, { recursive: true });

  for (const extension of ["cmd", "bat"]) {
    const script = path.join(dir, `hello.${extension}`);
    fs.writeFileSync(
      script,
      "@echo off\r\necho hello from cmd\r\necho [%~1]\r\n",
      "utf8",
    );

    const result = await runAsync(script, ["argument with spaces"], {
      timeout: 10000,
    });

    assert.equal(result.ok, true, `${extension}: ${result.stderr}`);
    assert.match(result.stdout, /hello from cmd/);
    assert.match(result.stdout, /\[argument with spaces\]/);
  }
});

test("runAsync collects stdout, stderr, and exit status", async () => {
  const result = await nodeScript(
    "process.stdout.write('out'); process.stderr.write('err');",
    [],
    { timeout: 10000 },
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "out");
  assert.equal(result.stderr, "err");
  assert.equal(result.error, null);
  assert.equal(result.timedOut, false);
});

test("runAsync reports a non-zero exit without inventing an error", async () => {
  const result = await nodeScript("process.exit(3);", [], { timeout: 10000 });

  assert.equal(result.ok, false);
  assert.equal(result.status, 3);
  assert.equal(result.error, null);
  assert.equal(result.timedOut, false);
});

test("runAsync supports cwd", async (t) => {
  const dir = tempDir(t);
  const result = await nodeScript("process.stdout.write(process.cwd());", [], {
    cwd: dir,
    timeout: 10000,
  });

  assert.equal(result.ok, true);
  assert.equal(
    path.resolve(result.stdout).toLowerCase(),
    path.resolve(dir).toLowerCase(),
  );
});

test("runAsync invokes onLine for stdout and stderr lines", async () => {
  const lines = [];
  const result = await nodeScript(
    "process.stdout.write('alpha\\nbeta\\n'); process.stderr.write('gamma\\n');",
    [],
    {
      timeout: 10000,
      onLine: (line) => lines.push(line),
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(lines.sort(), ["alpha", "beta", "gamma"]);
});

test("runAsync treats carriage-return progress as lines", async () => {
  const lines = [];
  const result = await nodeScript(
    "process.stdout.write('one\\rtwo\\rthree');",
    [],
    {
      timeout: 10000,
      onLine: (line) => lines.push(line),
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(lines, ["one", "two", "three"]);
});

test("runAsync times out and kills the process", async () => {
  const started = Date.now();
  const result = await nodeScript(
    "setTimeout(() => {}, 60000);",
    [],
    { timeout: 300 },
  );
  const elapsed = Date.now() - started;

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.error, "timeout");
  assert.ok(elapsed < 5000, `timeout took ${elapsed}ms`);
});

test("runAsync resolves a spawn error for a missing command", async () => {
  const missing = `rooster-missing-${process.pid}-${Date.now()}`;
  const result = await runAsync(missing, [], { timeout: 5000 });

  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.equal(result.timedOut, false);
  assert.match(result.error, /ENOENT|not found/i);
});

test("runAsync caps output and reports maxBuffer", async () => {
  const result = await nodeScript(
    "process.stdout.write('x'.repeat(200000));",
    [],
    { maxBuffer: 1000, timeout: 5000 },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, "maxBuffer exceeded");
  assert.ok(result.stdout.length <= 1000);
});

test("runPool preserves input order and respects the limit", async () => {
  const items = [40, 30, 20, 10];
  let active = 0;
  let maxActive = 0;

  const results = await runPool(items, 2, async (ms) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      await delay(ms);
      return ms * 2;
    } finally {
      active -= 1;
    }
  });

  assert.ok(maxActive >= 1);
  assert.ok(maxActive <= 2, `max concurrency was ${maxActive}`);
  assert.deepEqual(
    results.map((entry) => entry.status),
    ["fulfilled", "fulfilled", "fulfilled", "fulfilled"],
  );
  assert.deepEqual(
    results.map((entry) => entry.value),
    [80, 60, 40, 20],
  );
});

test("runPool settles every item in input order", async () => {
  const seen = [];
  const results = await runPool([1, 2, 3], 2, async (value) => {
    seen.push(value);
    if (value === 2) throw new Error("boom");
    return value * 10;
  });

  assert.deepEqual(seen.sort(), [1, 2, 3]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[0].value, 10);
  assert.equal(results[1].status, "rejected");
  assert.match(results[1].reason.message, /boom/);
  assert.equal(results[2].status, "fulfilled");
  assert.equal(results[2].value, 30);
});

test("runPool handles empty input and validates the limit", async () => {
  assert.deepEqual(await runPool([], 2, async () => 1), []);
  await assert.rejects(runPool([1], 0, async () => 1), /limit/);
  await assert.rejects(runPool([1], 1.5, async () => 1), /limit/);
});
