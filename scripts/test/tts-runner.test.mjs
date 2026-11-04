import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  generateVoiceover,
  planTtsJobs,
  readTtsCache,
  ttsCachePath,
  ttsLineKey,
  writeTtsCache,
} from "../lib/tts-runner.mjs";

const temps = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rooster-tts-runner-"));
  temps.push(dir);
  return dir;
}

function lineFor(index, text, overrides = {}) {
  const file = `voice/line-${index}.mp3`;
  return {
    id: `line-${index}`,
    text,
    audio: file,
    ext: "mp3",
    start: null,
    end: null,
    duration: null,
    measured: false,
    timing: "unmeasured",
    command: {
      schema: "rooster.tts-command/v1",
      provider: "fake-tts",
      command: "fake-tts",
      args: ["--text", text, "--voice", "voice-a", "--out", file],
      stdin: null,
      output: file,
      voice: "voice-a",
      rate: null,
    },
    ...overrides,
  };
}

function manifestWith(lines) {
  return {
    schema: "rooster.voiceover/v1",
    status: "planned",
    provider: "fake-tts",
    voice: "voice-a",
    rate: null,
    ext: "mp3",
    lines,
    totals: { lines: lines.length, words: 0, chars: 0, duration: null, measured: false },
    timing: { status: "unmeasured", method: "ffprobe" },
  };
}

function listTempFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.includes(".tmp-"));
}

test.after(() => {
  for (const dir of temps) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can briefly hold a handle; temp cleanup is best-effort.
    }
  }
});

test("ttsLineKey is stable, local, and covers every rendered option", () => {
  const base = { provider: "edge-tts", voice: "pt-BR-FranciscaNeural", rate: "+0%", text: "Ola mundo", ext: "mp3" };
  const key = ttsLineKey(base);

  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key, ttsLineKey({ ...base }));
  assert.equal(key, ttsLineKey({ ...base, rate: "+0%", ext: ".MP3" }));
  assert.notEqual(key, ttsLineKey({ ...base, text: "Ola mundo!" }));
  assert.notEqual(key, ttsLineKey({ ...base, voice: "en-US-AriaNeural" }));
  assert.notEqual(key, ttsLineKey({ ...base, provider: "hyperframes" }));
  assert.notEqual(key, ttsLineKey({ ...base, rate: "+10%" }));
  assert.notEqual(key, ttsLineKey({ ...base, ext: "wav" }));
});

test("planTtsJobs skips only a matching sidecar key and size", () => {
  const projectDir = tempDir();
  const manifest = manifestWith([lineFor(1, "First line")]);
  const out = path.join(projectDir, manifest.lines[0].audio);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, "audio");

  const key = ttsLineKey({
    provider: manifest.provider,
    voice: manifest.voice,
    rate: manifest.rate,
    text: manifest.lines[0].text,
    ext: "mp3",
  });
  const cachePath = ttsCachePath(projectDir);
  writeTtsCache(cachePath, {
    entries: {
      [manifest.lines[0].audio]: { key, bytes: fs.statSync(out).size },
    },
  });

  const hit = planTtsJobs({ manifest, projectDir });
  assert.equal(hit.jobs.length, 0);
  assert.equal(hit.skipped.length, 1);
  assert.equal(hit.skipped[0].reason, "cached");

  const forced = planTtsJobs({ manifest, projectDir, refresh: true });
  assert.equal(forced.jobs.length, 1);
  assert.equal(forced.skipped.length, 0);
  assert.equal(forced.jobs[0].key, key);

  writeTtsCache(cachePath, {
    entries: { [manifest.lines[0].audio]: { key: "different", bytes: fs.statSync(out).size } },
  });
  assert.equal(planTtsJobs({ manifest, projectDir }).jobs.length, 1);

  writeTtsCache(cachePath, {
    entries: { [manifest.lines[0].audio]: { key, bytes: fs.statSync(out).size + 1 } },
  });
  assert.equal(planTtsJobs({ manifest, projectDir }).jobs.length, 1);
});

test("planTtsJobs reports lines without usable output or text", () => {
  const projectDir = tempDir();
  const manifest = manifestWith([
    lineFor(1, "Has text"),
    lineFor(2, "No output", { audio: null, command: null }),
    lineFor(3, "   ", { audio: "voice/empty.mp3" }),
  ]);

  const { jobs, skipped } = planTtsJobs({ manifest, projectDir });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].out, path.join(projectDir, "voice/line-1.mp3"));
  assert.deepEqual(
    skipped.map((item) => item.reason),
    ["no-output", "empty-text"]
  );
});

test("generateVoiceover writes files, timings, and a sidecar cache", async () => {
  const projectDir = tempDir();
  const manifest = manifestWith([lineFor(1, "First line"), lineFor(2, "Second line")]);
  const calls = [];
  const events = [];

  const run = async (command) => {
    calls.push(command);
    fs.writeFileSync(command.out, `audio for ${path.basename(command.out)}`);
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };
  const probe = async (file) => ({
    duration: path.basename(file).includes("line-1") ? 1.5 : 2.5,
  });

  const result = await generateVoiceover({
    manifest,
    projectDir,
    run,
    probe,
    concurrency: 2,
    retryDelay: 0,
    onProgress: (event) => events.push(event.type),
  });

  assert.equal(result.ok, true);
  assert.equal(result.generated, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cwd, projectDir);
  assert.equal(path.isAbsolute(calls[0].out), true);

  assert.equal(manifest.lines[0].duration, 1.5);
  assert.equal(manifest.lines[0].start, 0);
  assert.equal(manifest.lines[0].end, 1.5);
  assert.equal(manifest.lines[1].duration, 2.5);
  assert.equal(manifest.lines[1].start, 1.5);
  assert.equal(manifest.lines[1].end, 4);
  assert.equal(manifest.duration, 4);
  assert.equal(manifest.totals.duration, 4);
  assert.equal(manifest.status, "generated");

  assert.deepEqual(events.filter((type) => type === "ok").length, 2);
  assert.equal(result.cachePath, ttsCachePath(projectDir));
  const cache = readTtsCache(result.cachePath);
  assert.equal(cache.entries["voice/line-1.mp3"].duration, 1.5);
  assert.equal(cache.entries["voice/line-2.mp3"].duration, 2.5);
  assert.equal(cache.entries["voice/line-1.mp3"].attempts, 1);
  assert.deepEqual(listTempFiles(path.join(projectDir, "edit")), []);

  const fresh = manifestWith([lineFor(1, "First line"), lineFor(2, "Second line")]);
  const cached = await generateVoiceover({
    manifest: fresh,
    projectDir,
    probe,
    retryDelay: 0,
    run: async () => {
      throw new Error("cached lines must not run");
    },
  });

  assert.equal(cached.ok, true);
  assert.equal(cached.generated, 0);
  assert.equal(cached.skipped, 2);
  assert.equal(fresh.lines[0].duration, 1.5);
  assert.equal(fresh.duration, 4);
  assert.equal(fresh.status, "generated");
});

test("generateVoiceover retries transient failures with backoff", async () => {
  const projectDir = tempDir();
  const manifest = manifestWith([lineFor(1, "Retry me")]);
  const events = [];
  let calls = 0;

  const run = async (command) => {
    calls += 1;
    if (calls < 3) {
      return { ok: false, status: 1, stderr: "network reset" };
    }
    fs.writeFileSync(command.out, "audio");
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };

  const result = await generateVoiceover({
    manifest,
    projectDir,
    run,
    probe: () => ({ duration: 1 }),
    retryDelay: 0,
    onProgress: (event) => events.push(event),
  });

  assert.equal(result.ok, true);
  assert.equal(result.generated, 1);
  assert.equal(calls, 3);
  assert.equal(events.filter((event) => event.type === "retry").length, 2);
  assert.equal(events.find((event) => event.type === "ok").attempts, 3);
  assert.equal(readTtsCache(result.cachePath).entries["voice/line-1.mp3"].attempts, 3);
});

test("generateVoiceover does not retry permanent failures", async () => {
  const projectDir = tempDir();
  const manifest = manifestWith([lineFor(1, "Permanent")]);
  let calls = 0;

  const result = await generateVoiceover({
    manifest,
    projectDir,
    retryDelay: 0,
    run: async () => {
      calls += 1;
      return { ok: false, status: 2, error: "bad request", transient: false };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failed, 1);
  assert.equal(calls, 1);
  assert.match(result.errors[0].error, /bad request/);
  assert.equal(manifest.status, "failed");
});

test("generateVoiceover respects the concurrency limit and order", async () => {
  const projectDir = tempDir();
  const manifest = manifestWith([1, 2, 3, 4].map((index) => lineFor(index, `Line ${index}`)));
  let active = 0;
  let maxActive = 0;

  const run = async (command) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    fs.writeFileSync(command.out, "audio");
    active -= 1;
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };

  const result = await generateVoiceover({
    manifest,
    projectDir,
    run,
    concurrency: 2,
    retryDelay: 0,
  });

  assert.equal(result.generated, 4);
  assert.equal(maxActive, 2);
  assert.deepEqual(
    result.results.map((item) => item.job.line.id),
    ["line-1", "line-2", "line-3", "line-4"]
  );
});

test("generateVoiceover accepts an injected runPool", async () => {
  const projectDir = tempDir();
  const manifest = manifestWith([lineFor(1, "One"), lineFor(2, "Two")]);
  let poolUsed = false;

  const result = await generateVoiceover({
    manifest,
    projectDir,
    concurrency: 2,
    run: async (command) => {
      fs.writeFileSync(command.out, "audio");
      return { ok: true, status: 0 };
    },
    runPool: async (items, limit, fn) => {
      poolUsed = true;
      assert.equal(limit, 2);
      const results = [];
      for (const item of items.slice().reverse()) results.push(await fn(item));
      return results.reverse();
    },
  });

  assert.equal(poolUsed, true);
  assert.equal(result.generated, 2);
});

test("generateVoiceover builds provider commands and refuses API providers", async () => {
  const projectDir = tempDir();
  const manifest = {
    schema: "rooster.voiceover/v1",
    provider: "edge-tts",
    voice: "pt-BR-FranciscaNeural",
    rate: "+0%",
    ext: "mp3",
    lines: [lineFor(1, "Ola", { command: null })],
  };

  let command;
  const result = await generateVoiceover({
    manifest,
    projectDir,
    run: async (value) => {
      command = value;
      fs.writeFileSync(value.out, "audio");
      return { ok: true, status: 0 };
    },
  });

  assert.equal(result.generated, 1);
  assert.equal(command.command, "edge-tts");
  assert.equal(command.args.includes("--write-media"), true);
  assert.equal(command.args.at(-1), path.join(projectDir, "voice/line-1.mp3"));

  const apiProject = tempDir();
  const apiManifest = {
    schema: "rooster.voiceover/v1",
    provider: "openai",
    voice: "alloy",
    ext: "mp3",
    lines: [lineFor(1, "API line", { command: null })],
  };
  let apiCalls = 0;
  const api = await generateVoiceover({
    manifest: apiManifest,
    projectDir: apiProject,
    run: async () => {
      apiCalls += 1;
      return { ok: true, status: 0 };
    },
  });

  assert.equal(apiCalls, 0);
  assert.equal(api.ok, false);
  assert.equal(api.failed, 1);
  assert.match(api.errors[0].error, /API provider/);
});

test("generateVoiceover validates its required inputs", async () => {
  await assert.rejects(
    () => generateVoiceover({ manifest: manifestWith([]), projectDir: tempDir() }),
    /requires run\(command\)/
  );
  await assert.rejects(
    () => generateVoiceover({ manifest: null, projectDir: tempDir(), run: () => {} }),
    /requires a voiceover manifest/
  );
  await assert.rejects(
    () => generateVoiceover({ manifest: manifestWith([]), run: () => {} }),
    /requires projectDir/
  );
});
