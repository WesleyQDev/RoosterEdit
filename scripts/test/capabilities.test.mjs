import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import {
  capabilityCacheTtlMs,
  detectCapabilities,
  formatDoctor,
  parseParakeetModels,
  parseVersionOutput,
} from "../lib/capabilities.mjs";

const tempDirs = [];

function makeTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rooster-capabilities-"));
  tempDirs.push(dir);
  return dir;
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function installHyperFrames(workspace, version = "0.9.9") {
  const pkgDir = path.join(workspace, "cache", "tools", "node_modules", "hyperframes");
  const bin = path.join(pkgDir, "bin", "hyperframes.mjs");
  writeFile(bin, "#!/usr/bin/env node\n");
  writeFile(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: "hyperframes",
      version,
      bin: { hyperframes: "./bin/hyperframes.mjs" },
    })
  );
  return { pkgDir, bin };
}

function baseEnv(root) {
  const home = path.join(root, "user");
  return {
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: path.join(root, "local"),
    APPDATA: path.join(root, "roaming"),
    OPENAI_API_KEY: "test-key",
  };
}

function ok(stdout = "", stderr = "") {
  return { ok: true, status: 0, stdout, stderr, error: null };
}

function fail(stderr = "") {
  return { ok: false, status: 1, stdout: "", stderr, error: null };
}

function baseHandlers() {
  return {
    npm: () => ok("10.2.0"),
    python: (args) => (args[0] === "--version" ? fail() : fail()),
    python3: (args) => (args[0] === "-c" ? ok("7.0.0") : ok("Python 3.12.1")),
    git: () => ok("git version 2.44.0"),
    ffmpeg: () => ok("ffmpeg version 7.1 Copyright (c) 2000-2024\nbuilt with gcc"),
    ffprobe: () => ok("ffprobe version 7.1"),
    "yt-dlp": () => ok("2024.10.01"),
    "nvidia-smi": () => fail(),
    "edge-tts": () => ok("", "edge-tts 6.1.0"),
    piper: () => fail(),
    whisper: () => fail(),
    "whisper-cli": () => ok("usage: whisper-cli"),
    "whisper-cpp": () => fail(),
    "faster-whisper": () => fail(),
    "mlx-whisper": () => fail(),
  };
}

function createRunner(handlers = {}) {
  const calls = [];
  const table = { ...baseHandlers(), ...handlers };
  const runAsync = async (name, args = [], options = {}) => {
    calls.push({ name, args, options });
    const handler = table[name];
    if (typeof handler === "function") {
      const value = handler(args, options);
      if (value !== undefined) return value;
    }
    return fail();
  };
  return { runAsync, calls };
}

function memoryCache(dir) {
  const store = new Map();
  return {
    dir,
    store,
    read(key) {
      return store.has(key) ? store.get(key) : null;
    },
    write(key, value) {
      store.set(key, value);
    },
  };
}

function optionsFor(root, extra = {}) {
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  return {
    workspace,
    cwd: path.join(root, "cwd"),
    home: path.join(root, "rooster-home"),
    env: baseEnv(root),
    ...extra,
  };
}

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseVersionOutput returns the first non-empty trimmed line", () => {
  assert.equal(parseVersionOutput("\n  \nffmpeg version 7.1\nbuilt with gcc"), "ffmpeg version 7.1");
  assert.equal(parseVersionOutput("  npm 10.2.0  "), "npm 10.2.0");
  assert.equal(parseVersionOutput(""), null);
  assert.equal(parseVersionOutput(null), null);
  assert.equal(parseVersionOutput(undefined), null);
});

test("parseParakeetModels handles installed, unsupported, and invalid input", () => {
  assert.deepEqual(
    parseParakeetModels(
      JSON.stringify({
        ok: true,
        models: [
          { engine: "whisper", model: "small", installed: true },
          {
            engine: "parakeet",
            model: "parakeet-tdt-0.6b-v3",
            installed: true,
            runner: "sherpa",
          },
        ],
      })
    ),
    { installed: true, model: "parakeet-tdt-0.6b-v3", reason: null }
  );

  assert.deepEqual(
    parseParakeetModels(
      '{"ok":true,"models":[{"engine":"parakeet","model":"parakeet-tdt-0.6b-v3","installed":false}]}'
    ),
    {
      installed: false,
      model: "parakeet-tdt-0.6b-v3",
      reason: 'not installed (run "hyperframes models install parakeet")',
    }
  );

  assert.deepEqual(
    parseParakeetModels(
      '{"ok":true,"models":[{"engine":"parakeet","installed":false,"unsupported":"no sherpa-onnx build"}]}'
    ),
    { installed: false, model: null, reason: "no sherpa-onnx build" }
  );

  assert.deepEqual(parseParakeetModels("not json"), {
    installed: false,
    model: null,
    reason: "model list unavailable",
  });
  assert.deepEqual(parseParakeetModels(""), {
    installed: false,
    model: null,
    reason: "model list unavailable",
  });
  assert.deepEqual(parseParakeetModels('{"ok":true,"models":[{"engine":"whisper"}]}'), {
    installed: false,
    model: null,
    reason: "parakeet not reported",
  });

  // Objects and JSON embedded in log output are accepted too.
  assert.equal(
    parseParakeetModels({
      models: [{ engine: "parakeet", model: "parakeet-tdt-0.6b-v3", installed: true }],
    }).installed,
    true
  );
  assert.equal(
    parseParakeetModels('debug line\n{"ok":true,"models":[{"engine":"parakeet","installed":true}]}\n')
      .installed,
    true
  );
});

test("detectCapabilities runs probes in parallel and keeps doctor fields", async () => {
  const root = makeTemp();
  const options = optionsFor(root);
  const hyperframes = installHyperFrames(options.workspace);
  const { runAsync, calls } = createRunner();

  const caps = await detectCapabilities({ ...options, runAsync, timeout: 1234 });

  assert.equal(caps.schema, "rooster.doctor/v1");
  assert.equal(caps.version, "0.1.0");
  assert.equal(caps.os, process.platform);
  assert.equal(caps.arch, process.arch);
  assert.equal(caps.cwd, path.resolve(options.cwd));
  assert.equal(caps.workspace, path.resolve(options.workspace));
  assert.equal(caps.workspaceExists, true);
  assert.equal(caps.roosterHome, path.resolve(options.home));
  assert.equal(caps.node, process.version.replace(/^v/, ""));

  assert.equal(caps.npm, "10.2.0");
  assert.equal(caps.python, "Python 3.12.1");
  assert.equal(caps.git, "git version 2.44.0");
  assert.equal(caps.ffmpeg, "ffmpeg version 7.1 Copyright (c) 2000-2024");
  assert.equal(caps.ffprobe, "ffprobe version 7.1");
  assert.equal(caps.ytdlp, "2024.10.01");
  assert.equal(caps.whisper, "whisper-cli");
  assert.equal(caps.gpu, null);

  assert.equal(caps.hyperframes.bin, hyperframes.bin);
  assert.equal(caps.hyperframes.version, "0.9.9");
  assert.equal(caps.hyperframes.source, "workspace-cache");
  assert.equal(caps.hyperframesCli, "0.9.9");
  assert.equal(caps.engines.hyperframes, "detected");

  assert.equal(caps.tts.openai, true);
  assert.equal(caps.tts.elevenlabs, false);
  assert.equal(caps.tts.gemini, false);
  assert.equal(caps.tts.edgeTts, true);
  assert.equal(caps.tts.piper, false);

  assert.equal(caps.parakeet.installed, false);
  assert.equal(caps.parakeet.model, null);
  assert.match(caps.parakeet.reason, /doctor --deep/);

  assert.deepEqual(caps.cache, {
    enabled: false,
    dir: path.join(options.workspace, "cache"),
    hit: false,
    ageMs: null,
    error: null,
  });

  assert.ok(calls.length >= 15);
  assert.ok(calls.every((call) => call.options.timeout === 1234));
  assert.ok(calls.every((call) => call.name !== "npx"));
  assert.ok(calls.every((call) => call.name !== process.execPath));
  assert.deepEqual(caps.env, {
    roosterWorkspace: false,
    roosterHome: false,
    roosterProfile: null,
    roosterEngine: null,
  });
});

test("detectCapabilities --deep probes Parakeet through the local binary", async () => {
  const root = makeTemp();
  const options = optionsFor(root);
  const hyperframes = installHyperFrames(options.workspace);
  const { runAsync, calls } = createRunner({
    [process.execPath]: (args) => {
      if (args.includes("models")) {
        return ok(
          JSON.stringify({
            ok: true,
            models: [
              {
                engine: "parakeet",
                model: "parakeet-tdt-0.6b-v3",
                installed: true,
                runner: "sherpa",
              },
            ],
          })
        );
      }
      return fail();
    },
  });

  const caps = await detectCapabilities({ ...options, runAsync, deep: true, timeout: 1000 });

  assert.deepEqual(caps.parakeet, {
    installed: true,
    model: "parakeet-tdt-0.6b-v3",
    reason: null,
  });

  const modelCall = calls.find(
    (call) => call.name === process.execPath && call.args.includes("models")
  );
  assert.ok(modelCall);
  assert.deepEqual(modelCall.args, [hyperframes.bin, "models", "list", "--json"]);
  assert.equal(modelCall.options.timeout, 30000);
  assert.ok(calls.every((call) => call.name !== "npx"));
});

test("detectCapabilities --deep reports missing HyperFrames and model list errors", async () => {
  const root = makeTemp();
  const options = optionsFor(root);
  const { runAsync } = createRunner();

  const noEngine = await detectCapabilities({ ...options, runAsync, deep: true });
  assert.deepEqual(noEngine.parakeet, {
    installed: false,
    model: null,
    reason: "hyperframes not found",
  });

  const withEngine = optionsFor(makeTemp());
  installHyperFrames(withEngine.workspace);
  const failing = createRunner({
    [process.execPath]: () => fail("sherpa-onnx exploded"),
  });
  const failed = await detectCapabilities({
    ...withEngine,
    runAsync: failing.runAsync,
    deep: true,
  });
  assert.equal(failed.parakeet.installed, false);
  assert.equal(failed.parakeet.reason, "sherpa-onnx exploded");
});

test("capabilities cache honors the TTL and refresh", async () => {
  const root = makeTemp();
  const options = optionsFor(root);
  installHyperFrames(options.workspace);
  const cache = memoryCache(path.join(options.workspace, "cache"));
  const { runAsync, calls } = createRunner();
  const now = 1_700_000_000_000;

  const first = await detectCapabilities({ ...options, runAsync, cache, now });
  assert.equal(first.cache.enabled, true);
  assert.equal(first.cache.hit, false);
  assert.equal(first.cache.dir, cache.dir);
  assert.ok(cache.store.has("capabilities"));
  const callsAfterFirst = calls.length;

  const warm = await detectCapabilities({ ...options, runAsync, cache, now: now + 1000 });
  assert.equal(calls.length, callsAfterFirst);
  assert.equal(warm.cache.hit, true);
  assert.equal(warm.cache.ageMs, 1000);
  assert.equal(warm.npm, "10.2.0");

  const expired = await detectCapabilities({
    ...options,
    runAsync,
    cache,
    now: now + capabilityCacheTtlMs + 1,
  });
  assert.ok(calls.length > callsAfterFirst);
  assert.equal(expired.cache.hit, false);

  const beforeRefresh = calls.length;
  const refreshed = await detectCapabilities({
    ...options,
    runAsync,
    cache,
    now: now + capabilityCacheTtlMs + 2,
    refresh: true,
  });
  assert.ok(calls.length > beforeRefresh);
  assert.equal(refreshed.cache.hit, false);
});

test("capabilities cache understands JSON-serialized entries", async () => {
  const root = makeTemp();
  const options = optionsFor(root);
  const store = new Map();
  const cache = {
    read(key) {
      return store.has(key) ? store.get(key) : null;
    },
    write(key, value) {
      store.set(key, JSON.stringify(value));
    },
  };
  const { runAsync, calls } = createRunner();
  const now = 1_700_000_000_000;

  await detectCapabilities({ ...options, runAsync, cache, now });
  const callsAfterFirst = calls.length;

  const warm = await detectCapabilities({ ...options, runAsync, cache, now: now + 500 });
  assert.equal(warm.cache.hit, true);
  assert.equal(warm.cache.ageMs, 500);
  assert.equal(warm.npm, "10.2.0");
  assert.equal(calls.length, callsAfterFirst);
});

test("a deep call upgrades a shallow cached result", async () => {
  const root = makeTemp();
  const options = optionsFor(root);
  installHyperFrames(options.workspace);
  const cache = memoryCache(path.join(options.workspace, "cache"));
  const { runAsync, calls } = createRunner({
    [process.execPath]: (args) =>
      args.includes("models")
        ? ok(
            JSON.stringify({
              models: [{ engine: "parakeet", model: "parakeet-tdt-0.6b-v3", installed: true }],
            })
          )
        : fail(),
  });
  const now = 1_700_000_000_000;

  const shallow = await detectCapabilities({ ...options, runAsync, cache, now });
  assert.match(shallow.parakeet.reason, /doctor --deep/);
  assert.equal(
    calls.some((call) => call.name === process.execPath && call.args.includes("models")),
    false
  );

  const deep = await detectCapabilities({ ...options, runAsync, cache, now: now + 1, deep: true });
  assert.equal(deep.parakeet.installed, true);
  assert.ok(
    calls.some((call) => call.name === process.execPath && call.args.includes("models"))
  );
});

test("detectCapabilities surfaces cache read/write failures without throwing", async () => {
  const root = makeTemp();
  const options = optionsFor(root);
  const { runAsync } = createRunner();
  const cache = {
    read() {
      throw new Error("read boom");
    },
    write() {
      throw new Error("write boom");
    },
  };

  const caps = await detectCapabilities({ ...options, runAsync, cache });
  assert.equal(caps.cache.enabled, true);
  assert.equal(caps.cache.hit, false);
  assert.equal(caps.cache.error, "write boom");
});

test("formatDoctor is stable JSON and ANSI-free text", async () => {
  const root = makeTemp();
  const options = optionsFor(root);
  const { runAsync } = createRunner();
  const caps = await detectCapabilities({ ...options, runAsync, timeout: 500 });

  const json = formatDoctor(caps, { json: true });
  assert.deepEqual(JSON.parse(json), JSON.parse(JSON.stringify(caps)));
  assert.equal(json.includes("\u001b["), false);

  const text = formatDoctor(caps, { json: false });
  assert.match(text, /^RoosterEdit doctor/);
  assert.match(text, /Engines/);
  assert.match(text, /ASR/);
  assert.match(text, /TTS/);
  assert.match(text, /Cache/);
  assert.match(text, /Parakeet/);
  assert.equal(text.includes("\u001b["), false);

  const empty = formatDoctor(null);
  assert.match(empty, /Node\s+unknown/);
  assert.equal(empty.includes("\u001b["), false);
});
