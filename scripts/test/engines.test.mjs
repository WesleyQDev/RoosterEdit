import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import {
  engineVersion,
  findHyperFrames,
  hyperFramesBinCandidates,
  hyperFramesVersion,
  npmCacheRoots,
} from "../lib/engines.mjs";

const tempDirs = [];

function makeTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rooster-engines-"));
  tempDirs.push(dir);
  return dir;
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function installHyperFrames(pkgDir, version) {
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
  };
}

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("npmCacheRoots is platform-aware and deduplicated", () => {
  const root = makeTemp();
  const home = path.join(root, "home");
  const custom = path.join(root, "custom-cache");

  const win = npmCacheRoots(
    {
      npm_config_cache: custom,
      HOME: home,
      USERPROFILE: home,
      LOCALAPPDATA: path.join(root, "local"),
      APPDATA: path.join(root, "roaming"),
    },
    { platform: "win32" }
  );

  assert.equal(win[0], path.resolve(custom));
  assert.ok(win.includes(path.join(root, "local", "npm-cache")));
  assert.ok(win.includes(path.join(root, "roaming", "npm-cache")));
  assert.ok(win.includes(path.join(home, ".npm")));
  assert.equal(new Set(win).size, win.length);

  const fallback = npmCacheRoots({ HOME: home, USERPROFILE: home }, { platform: "win32" });
  assert.ok(fallback.includes(path.join(home, "AppData", "Local", "npm-cache")));
  assert.ok(fallback.includes(path.join(home, "AppData", "Roaming", "npm-cache")));

  const posix = npmCacheRoots({ HOME: home }, { platform: "linux" });
  assert.deepEqual(posix, [path.join(home, ".npm")]);
});

test("findHyperFrames follows env, workspace, cwd, home, npx priority", () => {
  const root = makeTemp();
  const workspace = path.join(root, "workspace");
  const cwd = path.join(root, "cwd");
  const home = path.join(root, "home");
  const env = baseEnv(root);

  const workspaceInstall = installHyperFrames(
    path.join(workspace, "cache", "tools", "node_modules", "hyperframes"),
    "1.0.0"
  );
  const cwdInstall = installHyperFrames(
    path.join(cwd, "node_modules", "hyperframes"),
    "2.0.0"
  );
  const homeInstall = installHyperFrames(
    path.join(home, "tools", "node_modules", "hyperframes"),
    "3.0.0"
  );

  const fromWorkspace = findHyperFrames({ workspace, cwd, home, env });
  assert.equal(fromWorkspace.bin, workspaceInstall.bin);
  assert.equal(fromWorkspace.source, "workspace-cache");
  assert.equal(hyperFramesVersion(fromWorkspace.pkgPath), "1.0.0");

  const emptyWorkspace = path.join(root, "empty-workspace");
  const fromCwd = findHyperFrames({ workspace: emptyWorkspace, cwd, home, env });
  assert.equal(fromCwd.bin, cwdInstall.bin);
  assert.equal(fromCwd.source, "cwd");

  const emptyCwd = path.join(root, "empty-cwd");
  const fromHome = findHyperFrames({ workspace: emptyWorkspace, cwd: emptyCwd, home, env });
  assert.equal(fromHome.bin, homeInstall.bin);
  assert.equal(fromHome.source, "home");

  const none = findHyperFrames({
    workspace: emptyWorkspace,
    cwd: emptyCwd,
    home: path.join(root, "empty-home"),
    env,
  });
  assert.equal(none, null);
});

test("ROOSTER_HYPERFRAMES_BIN wins over filesystem candidates", () => {
  const root = makeTemp();
  const workspace = path.join(root, "workspace");
  const cwd = path.join(root, "cwd");
  const home = path.join(root, "home");
  const env = baseEnv(root);

  installHyperFrames(
    path.join(workspace, "cache", "tools", "node_modules", "hyperframes"),
    "1.0.0"
  );
  const custom = installHyperFrames(path.join(root, "custom", "hyperframes"), "9.9.9");

  const fromFile = findHyperFrames({
    workspace,
    cwd,
    home,
    env: { ...env, ROOSTER_HYPERFRAMES_BIN: custom.bin },
  });
  assert.equal(fromFile.bin, custom.bin);
  assert.equal(fromFile.source, "env");

  const fromDir = findHyperFrames({
    workspace,
    cwd,
    home,
    env: { ...env, ROOSTER_HYPERFRAMES_BIN: custom.pkgDir },
  });
  assert.equal(fromDir.bin, custom.bin);
  assert.equal(fromDir.source, "env");

  const ignored = findHyperFrames({
    workspace,
    cwd,
    home,
    env: { ...env, ROOSTER_HYPERFRAMES_BIN: path.join(root, "missing.mjs") },
  });
  assert.equal(ignored.source, "workspace-cache");
});

test("npx cache scan prefers the highest version", () => {
  const root = makeTemp();
  const workspace = path.join(root, "workspace");
  const cwd = path.join(root, "cwd");
  const home = path.join(root, "home");
  const env = baseEnv(root);
  const cacheRoot = path.join(env.LOCALAPPDATA, "npm-cache");

  const older = installHyperFrames(
    path.join(cacheRoot, "_npx", "aaa", "node_modules", "hyperframes"),
    "1.4.0"
  );
  const newer = installHyperFrames(
    path.join(cacheRoot, "_npx", "bbb", "node_modules", "hyperframes"),
    "2.0.1"
  );
  fs.mkdirSync(path.join(cacheRoot, "_npx", "ccc", "node_modules", "hyperframes"), {
    recursive: true,
  });

  const candidates = hyperFramesBinCandidates({ workspace, cwd, home, env });
  assert.ok(candidates.length >= 1);
  assert.equal(candidates[0].bin, newer.bin);
  assert.equal(candidates[0].source, "npx-cache");
  assert.ok(candidates.some((candidate) => candidate.bin === older.bin));
});

test("hyperFramesVersion is null-safe and accepts a package directory", () => {
  const root = makeTemp();
  const install = installHyperFrames(path.join(root, "hyperframes"), "0.9.9");

  assert.equal(hyperFramesVersion(null), null);
  assert.equal(hyperFramesVersion(path.join(root, "missing", "package.json")), null);
  assert.equal(hyperFramesVersion(install.pkgDir), "0.9.9");
  assert.equal(hyperFramesVersion(install.bin), "0.9.9");

  writeFile(path.join(root, "broken", "package.json"), "{ not json");
  assert.equal(hyperFramesVersion(path.join(root, "broken", "package.json")), null);
});

test("engineVersion reports HyperFrames and rejects removed engines", () => {
  const root = makeTemp();
  const workspace = path.join(root, "workspace");
  const cwd = path.join(root, "cwd");
  const home = path.join(root, "home");
  const env = baseEnv(root);

  const install = installHyperFrames(
    path.join(workspace, "cache", "tools", "node_modules", "hyperframes"),
    "0.9.9"
  );

  const hf = engineVersion("hyperframes", { workspace, cwd, home, env });
  assert.equal(hf.version, "0.9.9");
  assert.equal(hf.bin, install.bin);
  assert.equal(hf.source, "workspace-cache");

  assert.equal(engineVersion("remotion", {}), null);
  assert.equal(engineVersion("ffmpeg", { workspace, cwd, home, env }), null);
  assert.equal(engineVersion("unknown", {}), null);
});
