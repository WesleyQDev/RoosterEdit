import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import {
  artifactPath,
  cacheClear,
  cacheGc,
  cacheInfo,
  cacheKey,
  cacheRoot,
  canonicalJson,
  hashFile,
  linkOrCopy,
  readCache,
  statFingerprint,
  withCache,
} from "../lib/cache.mjs";

let savedCacheDir;
let savedWorkspace;

before(() => {
  savedCacheDir = process.env.ROOSTER_CACHE_DIR;
  savedWorkspace = process.env.ROOSTER_WORKSPACE;
  delete process.env.ROOSTER_CACHE_DIR;
  delete process.env.ROOSTER_WORKSPACE;
});

after(() => {
  restoreEnv("ROOSTER_CACHE_DIR", savedCacheDir);
  restoreEnv("ROOSTER_WORKSPACE", savedWorkspace);
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function tempDir(t, prefix = "rooster-cache-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return dir;
}

function isJsonFile(file) {
  try {
    JSON.parse(fs.readFileSync(file, "utf8"));
    return true;
  } catch {
    return false;
  }
}

function writeArtifact(file, value) {
  fs.writeFileSync(file, JSON.stringify(value));
}

function metaPath(file) {
  return `${file}.meta.json`;
}

test("canonicalJson sorts keys recursively and normalizes undefined", () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: 2, c: 3 } }),
    '{"a":{"c":3,"d":2},"b":1}',
  );
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
  assert.equal(
    canonicalJson([undefined, { b: 2, a: 1 }]),
    '[null,{"a":1,"b":2}]',
  );
  assert.equal(canonicalJson(undefined), "null");
  assert.equal(canonicalJson({ n: Number.NaN }), '{"n":null}');
  assert.equal(
    canonicalJson({ when: new Date("2020-01-01T00:00:00.000Z") }),
    '{"when":"2020-01-01T00:00:00.000Z"}',
  );
  assert.equal(
    canonicalJson({ a: 1, b: 2 }),
    canonicalJson({ b: 2, a: 1 }),
  );
});

test("cacheKey is stable, short, and separates adjacent parts", () => {
  const key = cacheKey([{ b: 2, a: 1 }, "ffmpeg", 8]);
  assert.match(key, /^[a-f0-9]{32}$/);
  assert.equal(key, cacheKey([{ a: 1, b: 2 }, "ffmpeg", 8]));
  assert.notEqual(cacheKey(["ab"]), cacheKey(["a", "b"]));
  assert.notEqual(cacheKey([{ a: 1 }]), cacheKey([{ a: 2 }]));
});

test("statFingerprint reports size, mtime, and absolute path", (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, "input.bin");
  fs.writeFileSync(file, "hello");

  const fingerprint = statFingerprint(file);
  assert.equal(fingerprint.size, 5);
  assert.equal(fingerprint.path, path.resolve(file));
  assert.ok(fingerprint.mtimeMs > 0);
  assert.throws(
    () => statFingerprint(path.join(dir, "missing.bin")),
    /cannot stat/,
  );
});

test("hashFile streams in chunks and matches a single-shot hash", (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, "big.bin");
  const data = Buffer.alloc(5 * 1024 * 1024 + 17, 7);
  fs.writeFileSync(file, data);

  const expected = crypto.createHash("sha256").update(data).digest("hex");
  assert.equal(hashFile(file), expected);
  assert.equal(hashFile(file, { chunkSize: 64 * 1024 }), expected);
  assert.equal(
    hashFile(file, { algorithm: "sha1", chunkSize: 12345 }),
    crypto.createHash("sha1").update(data).digest("hex"),
  );
  assert.throws(() => hashFile(file, { chunkSize: 0 }), /chunkSize/);
});

test("artifactPath stays under the cache root", (t) => {
  const dir = tempDir(t);
  const root = cacheRoot(dir);

  assert.equal(
    artifactPath("transcripts", "abc", ".json", dir),
    path.join(root, "transcripts", "abc.json"),
  );
  assert.equal(
    artifactPath("build/abc", "base", ".mp4", dir),
    path.join(root, "build", "abc", "base.mp4"),
  );
  assert.equal(
    artifactPath("transcripts", "abc", "json", dir),
    path.join(root, "transcripts", "abc.json"),
  );
  assert.throws(() => artifactPath("../evil", "abc", ".json", dir), /kind/);
  assert.throws(() => artifactPath("transcripts", "../abc", ".json", dir), /key/);
  assert.throws(() => artifactPath("transcripts", "abc", "../x", dir), /ext/);
});

test("cacheRoot honors ROOSTER_CACHE_DIR and otherwise uses the workspace", (t) => {
  const dir = tempDir(t);
  assert.equal(cacheRoot(dir), path.join(path.resolve(dir), "cache"));

  const custom = path.join(dir, "custom-cache");
  process.env.ROOSTER_CACHE_DIR = custom;
  try {
    assert.equal(cacheRoot(dir), path.resolve(custom));
    const target = withCache({
      kind: "probes",
      key: "one",
      ext: ".json",
      produce: (tmp) => writeArtifact(tmp, { ok: true }),
      workspace: dir,
    });
    assert.equal(target, path.join(path.resolve(custom), "probes", "one.json"));
  } finally {
    delete process.env.ROOSTER_CACHE_DIR;
  }
});

test("withCache writes on a miss and reuses on a hit", (t) => {
  const dir = tempDir(t);
  let calls = 0;
  const produce = (tmp) => {
    calls += 1;
    writeArtifact(tmp, { calls });
  };
  const meta = { toolVersions: { ffmpeg: "8.1" }, inputs: { source: "abc" } };

  const first = withCache({
    workspace: dir,
    kind: "transcripts",
    key: "key1",
    ext: ".json",
    produce,
    validate: isJsonFile,
    meta,
  });
  assert.equal(calls, 1);
  assert.equal(first, artifactPath("transcripts", "key1", ".json", dir));
  assert.deepEqual(JSON.parse(fs.readFileSync(first, "utf8")), { calls: 1 });

  const second = withCache({
    workspace: dir,
    kind: "transcripts",
    key: "key1",
    ext: ".json",
    produce: () => {
      throw new Error("produce must not run on a cache hit");
    },
    validate: isJsonFile,
    meta: { toolVersions: { ffmpeg: "should-not-replace" } },
  });
  assert.equal(second, first);
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(second, "utf8")), { calls: 1 });

  const metaDoc = JSON.parse(fs.readFileSync(metaPath(first), "utf8"));
  assert.equal(metaDoc.schema, "rooster.cache/v1");
  assert.equal(metaDoc.key, "key1");
  assert.equal(metaDoc.kind, "transcripts");
  assert.equal(metaDoc.bytes, fs.statSync(first).size);
  assert.deepEqual(metaDoc.toolVersions, { ffmpeg: "8.1" });
  assert.deepEqual(metaDoc.inputs, { source: "abc" });
  assert.ok(!Number.isNaN(Date.parse(metaDoc.createdAt)));

  const leftovers = fs
    .readdirSync(path.dirname(first))
    .filter((name) => name.includes(".tmp-"));
  assert.deepEqual(leftovers, []);
});

test("withCache refresh replaces the artifact and meta", (t) => {
  const dir = tempDir(t);
  let calls = 0;
  const run = (refresh) =>
    withCache({
      workspace: dir,
      kind: "tts",
      key: "line",
      ext: ".json",
      refresh,
      produce: (tmp) => {
        calls += 1;
        writeArtifact(tmp, { version: calls });
      },
      validate: isJsonFile,
    });

  const first = run(false);
  assert.deepEqual(JSON.parse(fs.readFileSync(first, "utf8")), { version: 1 });
  const metaBefore = JSON.parse(fs.readFileSync(metaPath(first), "utf8"));

  const second = run(true);
  assert.equal(second, first);
  assert.equal(calls, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(second, "utf8")), { version: 2 });
  const metaAfter = JSON.parse(fs.readFileSync(metaPath(second), "utf8"));
  assert.equal(metaAfter.bytes, fs.statSync(second).size);
  assert.equal(metaAfter.createdAt >= metaBefore.createdAt, true);
});

test("withCache never caches empty, invalid, or failed artifacts", (t) => {
  const dir = tempDir(t);

  assert.throws(
    () =>
      withCache({
        workspace: dir,
        kind: "renders",
        key: "empty",
        ext: ".mp4",
        produce: (tmp) => fs.writeFileSync(tmp, ""),
      }),
    /non-empty/,
  );
  assert.equal(
    fs.existsSync(artifactPath("renders", "empty", ".mp4", dir)),
    false,
  );

  assert.throws(
    () =>
      withCache({
        workspace: dir,
        kind: "renders",
        key: "invalid",
        ext: ".json",
        produce: (tmp) => fs.writeFileSync(tmp, "not json"),
        validate: isJsonFile,
      }),
    /validation/,
  );
  assert.equal(
    fs.existsSync(artifactPath("renders", "invalid", ".json", dir)),
    false,
  );
  assert.equal(
    fs.existsSync(metaPath(artifactPath("renders", "invalid", ".json", dir))),
    false,
  );

  assert.throws(
    () =>
      withCache({
        workspace: dir,
        kind: "renders",
        key: "throws",
        ext: ".json",
        produce: () => {
          throw new Error("encoder crashed");
        },
      }),
    /encoder crashed/,
  );
  assert.equal(
    fs.existsSync(artifactPath("renders", "throws", ".json", dir)),
    false,
  );

  const target = artifactPath("renders", "invalid-existing", ".json", dir);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "broken");
  let calls = 0;
  withCache({
    workspace: dir,
    kind: "renders",
    key: "invalid-existing",
    ext: ".json",
    validate: isJsonFile,
    produce: (tmp) => {
      calls += 1;
      writeArtifact(tmp, { fixed: true });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { fixed: true });
});

test("withCache does not let caller meta override reserved fields", (t) => {
  const dir = tempDir(t);
  const target = withCache({
    workspace: dir,
    kind: "probes",
    key: "reserved",
    ext: ".json",
    produce: (tmp) => writeArtifact(tmp, { ok: true }),
    meta: { key: "other", kind: "other", schema: "evil", bytes: 1 },
  });
  const metaDoc = JSON.parse(fs.readFileSync(metaPath(target), "utf8"));
  assert.equal(metaDoc.schema, "rooster.cache/v1");
  assert.equal(metaDoc.key, "reserved");
  assert.equal(metaDoc.kind, "probes");
  assert.equal(metaDoc.bytes, fs.statSync(target).size);
});

test("readCache returns only valid artifacts", (t) => {
  const dir = tempDir(t);
  assert.equal(
    readCache("transcripts", "missing", ".json", isJsonFile, dir),
    null,
  );

  const target = withCache({
    workspace: dir,
    kind: "transcripts",
    key: "valid",
    ext: ".json",
    produce: (tmp) => writeArtifact(tmp, { ok: true }),
    validate: isJsonFile,
  });
  assert.equal(readCache("transcripts", "valid", ".json", isJsonFile, dir), target);
  assert.equal(readCache("transcripts", "valid", ".json", () => false, dir), null);

  const orphan = artifactPath("transcripts", "orphan", ".json", dir);
  fs.mkdirSync(path.dirname(orphan), { recursive: true });
  fs.writeFileSync(orphan, JSON.stringify({ orphan: true }));
  assert.equal(readCache("transcripts", "orphan", ".json", isJsonFile, dir), orphan);
});

test("linkOrCopy links or copies into place", (t) => {
  const dir = tempDir(t);
  const source = path.join(dir, "source.bin");
  const target = path.join(dir, "nested", "target.bin");
  fs.writeFileSync(source, Buffer.alloc(1024, 3));

  assert.equal(linkOrCopy(source, target), target);
  assert.deepEqual(fs.readFileSync(target), fs.readFileSync(source));

  fs.writeFileSync(source, "second version");
  linkOrCopy(source, target);
  assert.equal(fs.readFileSync(target, "utf8"), "second version");

  assert.equal(linkOrCopy(source, source), source);
  assert.equal(fs.readFileSync(source, "utf8"), "second version");

  assert.throws(
    () => linkOrCopy(path.join(dir, "missing.bin"), path.join(dir, "x.bin")),
    /ENOENT|no such file/i,
  );
});

test("cacheInfo and cacheClear report and remove only cache content", (t) => {
  const dir = tempDir(t);
  const outside = path.join(dir, "outside.txt");
  fs.writeFileSync(outside, "keep me");

  assert.equal(cacheInfo(dir).exists, false);

  const transcript = withCache({
    workspace: dir,
    kind: "transcripts",
    key: "one",
    ext: ".json",
    produce: (tmp) => writeArtifact(tmp, { ok: true }),
  });
  const tts = withCache({
    workspace: dir,
    kind: "tts",
    key: "two",
    ext: ".txt",
    produce: (tmp) => fs.writeFileSync(tmp, "voice"),
  });

  const info = cacheInfo(dir);
  assert.equal(info.exists, true);
  assert.equal(info.files, 4);
  assert.ok(info.bytes > 0);
  assert.equal(info.artifacts, 2);
  assert.deepEqual(info.byKind.transcripts, {
    files: 2,
    bytes: fs.statSync(transcript).size + fs.statSync(metaPath(transcript)).size,
  });
  assert.equal(info.byKind.tts.files, 2);

  const partial = cacheClear(dir, "transcripts");
  assert.equal(partial.removed, 2);
  assert.equal(fs.existsSync(transcript), false);
  assert.equal(fs.existsSync(metaPath(transcript)), false);
  assert.equal(fs.existsSync(tts), true);
  assert.equal(fs.readFileSync(outside, "utf8"), "keep me");

  const all = cacheClear(dir);
  assert.equal(all.removed, 2);
  assert.equal(fs.existsSync(tts), false);
  assert.equal(fs.existsSync(metaPath(tts)), false);
  assert.equal(fs.readFileSync(outside, "utf8"), "keep me");
  assert.throws(() => cacheClear(dir, "../outside.txt"), /kind/);
  assert.equal(fs.existsSync(outside), true);
});

test("cacheGc evicts by age and keeps fresh entries", (t) => {
  const dir = tempDir(t);
  const outside = path.join(dir, "outside.txt");
  fs.writeFileSync(outside, "keep me");

  const oldArtifact = withCache({
    workspace: dir,
    kind: "build",
    key: "old",
    ext: ".bin",
    produce: (tmp) => fs.writeFileSync(tmp, Buffer.alloc(1000, 1)),
  });
  const freshArtifact = withCache({
    workspace: dir,
    kind: "build",
    key: "fresh",
    ext: ".bin",
    produce: (tmp) => fs.writeFileSync(tmp, Buffer.alloc(1000, 2)),
  });

  const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  fs.utimesSync(oldArtifact, oldDate, oldDate);
  fs.utimesSync(metaPath(oldArtifact), oldDate, oldDate);

  const report = cacheGc(dir, { maxAgeMs: 24 * 60 * 60 * 1000 });
  assert.equal(report.removed, 2);
  assert.equal(fs.existsSync(oldArtifact), false);
  assert.equal(fs.existsSync(metaPath(oldArtifact)), false);
  assert.equal(fs.existsSync(freshArtifact), true);
  assert.equal(fs.readFileSync(outside, "utf8"), "keep me");
});

test("cacheGc respects maxBytes and deletes oldest units first", (t) => {
  const dir = tempDir(t);
  const artifacts = [];
  const now = Date.now();

  for (let index = 0; index < 3; index += 1) {
    const artifact = withCache({
      workspace: dir,
      kind: "renders",
      key: `render-${index}`,
      ext: ".bin",
      produce: (tmp) => fs.writeFileSync(tmp, Buffer.alloc(1000, index)),
    });
    const date = new Date(now - (3 - index) * 5000);
    fs.utimesSync(artifact, date, date);
    fs.utimesSync(metaPath(artifact), date, date);
    artifacts.push(artifact);
  }

  const before = cacheInfo(dir).bytes;
  const report = cacheGc(dir, { maxBytes: before - 1 });
  assert.ok(report.removed >= 1);
  assert.ok(report.bytesFreed > 0);
  assert.ok(cacheInfo(dir).bytes <= before - 1);
  assert.equal(fs.existsSync(artifacts[0]), false);
  assert.equal(fs.existsSync(artifacts[1]), true);
  assert.equal(fs.existsSync(artifacts[2]), true);
});

test("cacheGc is a no-op without limits and rejects invalid limits", (t) => {
  const dir = tempDir(t);
  withCache({
    workspace: dir,
    kind: "probes",
    key: "keep",
    ext: ".json",
    produce: (tmp) => writeArtifact(tmp, { ok: true }),
  });

  const report = cacheGc(dir, {});
  assert.equal(report.removed, 0);
  assert.equal(cacheInfo(dir).files, 2);
  assert.throws(() => cacheGc(dir, { maxBytes: -1 }), /maxBytes/);
  assert.throws(() => cacheGc(dir, { maxAgeMs: -1 }), /maxAgeMs/);
});
