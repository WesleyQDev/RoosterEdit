import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BROLL_INDEX_SCHEMA,
  getBrollIndex,
  indexIsStale,
} from "../lib/broll-index.mjs";

const temps = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rooster-broll-index-"));
  temps.push(dir);
  return dir;
}

function touch(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x");
}

function listTempFiles(dir) {
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

test("first scan indexes media, writes JSON, and ignores skip directories", () => {
  const dir = tempDir();
  const library = path.join(dir, "library");
  touch(path.join(library, "clips", "a.mp4"));
  touch(path.join(library, "clips", "b.MOV"));
  touch(path.join(library, "images", "c.JPG"));
  touch(path.join(library, "notes.txt"));
  touch(path.join(library, "node_modules", "ignored.mp4"));
  touch(path.join(library, "cache", "ignored.png"));

  const indexPath = path.join(dir, "cache", "broll-index.json");
  const index = getBrollIndex({ dirs: [library], indexPath });

  assert.equal(index.schema, BROLL_INDEX_SCHEMA);
  assert.equal(index.cached, false);
  assert.equal(index.stale, true);
  assert.equal(index.files.length, 3);
  assert.deepEqual(
    index.files.map((file) => path.basename(file)),
    ["a.mp4", "b.MOV", "c.JPG"]
  );
  assert.equal(index.roots.length, 1);
  assert.equal(index.roots[0].path, library);
  assert.equal(Number.isFinite(index.roots[0].mtimeMs), true);
  assert.equal(fs.existsSync(indexPath), true);
  assert.deepEqual(listTempFiles(path.dirname(indexPath)), []);

  const saved = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  assert.equal(saved.schema, BROLL_INDEX_SCHEMA);
  assert.deepEqual(saved.files, index.files);
  assert.equal(typeof saved.createdAt, "string");
});

test("unchanged root mtimes return the cached list without walking nested folders", () => {
  const dir = tempDir();
  const library = path.join(dir, "library");
  touch(path.join(library, "a.mp4"));
  touch(path.join(library, "nested", "b.mp4"));

  const indexPath = path.join(dir, "index.json");
  const first = getBrollIndex({ dirs: library, indexPath });
  assert.equal(first.files.length, 2);

  // A nested addition changes `nested/` but not the configured root mtime.
  touch(path.join(library, "nested", "late.mp4"));

  const second = getBrollIndex({ dirs: [library], indexPath });
  assert.equal(second.cached, true);
  assert.equal(second.stale, false);
  assert.equal(second.files.length, 2);

  const refreshed = getBrollIndex({ dirs: [library], indexPath, refresh: true });
  assert.equal(refreshed.cached, false);
  assert.equal(refreshed.stale, true);
  assert.equal(refreshed.files.length, 3);

  const again = getBrollIndex({ dirs: [library], indexPath });
  assert.equal(again.cached, true);
  assert.equal(again.files.length, 3);
});

test("a root mtime change invalidates the index", () => {
  const dir = tempDir();
  const library = path.join(dir, "library");
  touch(path.join(library, "a.mp4"));

  const indexPath = path.join(dir, "index.json");
  const first = getBrollIndex({ dirs: library, indexPath });
  assert.equal(first.files.length, 1);

  touch(path.join(library, "top-level.mp4"));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(library, later, later);

  const second = getBrollIndex({ dirs: library, indexPath });
  assert.equal(second.cached, false);
  assert.equal(second.stale, true);
  assert.equal(second.files.length, 2);
});

test("missing roots are tolerated and recorded", () => {
  const dir = tempDir();
  const present = path.join(dir, "present");
  const missing = path.join(dir, "missing");
  touch(path.join(present, "a.mp4"));

  const indexPath = path.join(dir, "index.json");
  const index = getBrollIndex({ dirs: [present, missing], indexPath });

  assert.equal(index.files.length, 1);
  assert.equal(index.roots.length, 2);
  const missingRoot = index.roots.find((root) => root.path === missing);
  assert.equal(missingRoot.mtimeMs, null);

  const cached = getBrollIndex({ dirs: [present, missing], indexPath });
  assert.equal(cached.cached, true);
  assert.equal(indexIsStale(cached, [present, missing]), false);

  touch(path.join(missing, "now-exists.mp4"));
  assert.equal(indexIsStale(cached, [present, missing]), true);
});

test("corrupt index JSON triggers a rescan and is replaced", () => {
  const dir = tempDir();
  const library = path.join(dir, "library");
  touch(path.join(library, "a.mp4"));

  const indexPath = path.join(dir, "index.json");
  fs.writeFileSync(indexPath, "{ not json");

  const index = getBrollIndex({ dirs: library, indexPath });
  assert.equal(index.cached, false);
  assert.equal(index.files.length, 1);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(indexPath, "utf8")));
});

test("indexIsStale compares roots order-independently", () => {
  const dir = tempDir();
  const first = path.join(dir, "one");
  const second = path.join(dir, "two");
  touch(path.join(first, "a.mp4"));
  touch(path.join(second, "b.mp4"));

  const indexPath = path.join(dir, "index.json");
  const index = getBrollIndex({ dirs: [first, second], indexPath });

  assert.equal(indexIsStale(index, [second, first]), false);
  assert.equal(indexIsStale(index, [first]), true);
  assert.equal(indexIsStale(index, [first, second, path.join(dir, "three")]), true);
  assert.equal(indexIsStale(null, [first, second]), true);
  assert.equal(indexIsStale({ ...index, schema: "other" }, [first, second]), true);
  assert.equal(indexIsStale({ ...index, files: null }, [first, second]), true);

  const later = new Date(Date.now() + 5000);
  fs.utimesSync(first, later, later);
  assert.equal(indexIsStale(index, [first, second]), true);
});
