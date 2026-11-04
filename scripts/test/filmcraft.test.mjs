import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  FILMCRAFT_ENV,
  FILMCRAFT_MCP_NAME,
  FILMCRAFT_TICKS_PER_SECOND,
  exportMedia,
  filmCraftCandidates,
  filmCraftMcpConfig,
  filmCraftMcpConfigFiles,
  filmCraftMcpRegistration,
  filmCraftMcpSnippet,
  filmCraftOnboardingPrompt,
  filmCraftRun,
  filmCraftStatus,
  filmCraftVersion,
  findFilmCraft,
  importMedia,
  inspect,
  markers,
  mergeFilmCraftMcpConfig,
  parseFilmCraftVersion,
  place,
  renderFrame,
  replace,
  runFilmCraft,
  secondsToTicks,
  setupFilmCraftMcp,
  ticksToSeconds,
} from "../lib/filmcraft.mjs";

function tempDir(t, prefix = "rooster-filmcraft-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return dir;
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

const FAKE_CLI = `import fs from "node:fs";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("filmcraft-cli 0.17.0\\n");
} else if (args.includes("inspect")) {
  const index = args.indexOf("inspect");
  process.stdout.write(JSON.stringify({ what: args[index + 1] ?? null }) + "\\n");
} else if (args.includes("render")) {
  const index = args.indexOf("--out");
  process.stdout.write(JSON.stringify({ rendered: index >= 0 ? args[index + 1] : null }) + "\\n");
} else {
  const runIndex = args.indexOf("run");
  if (runIndex < 0) {
    process.stderr.write("no run subcommand\\n");
    process.exitCode = 2;
  } else {
    const script = args[runIndex + 1];
    const keepGoing = args.includes("--keep-going");
    const lines = fs.readFileSync(script, "utf8").split(/\\r?\\n/);
    let failed = false;
    let lineNumber = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      lineNumber += 1;
      const command = JSON.parse(line);
      if (command.id === "fail.me") {
        process.stdout.write(
          JSON.stringify({ line: lineNumber, id: command.id, ok: false, error: "boom" }) + "\\n"
        );
        failed = true;
        if (!keepGoing) break;
        continue;
      }
      const result =
        command.id === "file.import"
          ? { items: (command.params.paths ?? []).map((_, index) => index + 1), errors: [] }
          : { echo: command.params ?? {} };
      process.stdout.write(
        JSON.stringify({
          line: lineNumber,
          id: command.id,
          ok: true,
          result,
        }) + "\\n"
      );
    }
    process.exitCode = failed ? 1 : 0;
  }
}
`;

function makeFakeCli(t) {
  const dir = tempDir(t, "rooster-filmcraft-cli-");
  const script = path.join(dir, "fake-cli.mjs");
  fs.writeFileSync(script, FAKE_CLI, "utf8");

  if (process.platform === "win32") {
    const shim = path.join(dir, "filmcraft-cli.cmd");
    fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`, "utf8");
    return shim;
  }

  const shim = path.join(dir, "filmcraft-cli");
  fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, "utf8");
  fs.chmodSync(shim, 0o755);
  return shim;
}

test("parseFilmCraftVersion handles CLI output, bare versions and garbage", () => {
  assert.equal(parseFilmCraftVersion("filmcraft-cli 0.17.0"), "0.17.0");
  assert.equal(parseFilmCraftVersion("0.17.0"), "0.17.0");
  assert.equal(parseFilmCraftVersion("filmcraft-cli 1.2.3-beta.1\n"), "1.2.3-beta.1");
  assert.equal(parseFilmCraftVersion("garbage"), null);
  assert.equal(parseFilmCraftVersion(""), null);
  assert.equal(parseFilmCraftVersion(null), null);
});

test("secondsToTicks and ticksToSeconds round-trip common frame rates", () => {
  assert.equal(FILMCRAFT_TICKS_PER_SECOND, 254016000000);
  assert.equal(secondsToTicks(1), FILMCRAFT_TICKS_PER_SECOND);
  assert.equal(secondsToTicks(0.5), 127008000000);
  assert.equal(ticksToSeconds(FILMCRAFT_TICKS_PER_SECOND), 1);

  for (const fps of [24, 25, 30, 23.976, 29.97, 59.94, 60]) {
    const seconds = 1 / fps;
    const ticks = secondsToTicks(seconds);
    assert.ok(
      Math.abs(ticksToSeconds(ticks) - seconds) < 1e-9,
      `${fps} fps did not round-trip: ${ticksToSeconds(ticks)}`
    );
  }
});

test("findFilmCraft honors ROOSTER_FILMCRAFT_CLI and reports missing installs", (t) => {
  const root = tempDir(t);
  const home = path.join(root, "home");
  const env = { PATH: "", [FILMCRAFT_ENV]: path.join(root, "cli", "filmcraft-cli.exe") };
  writeFile(env[FILMCRAFT_ENV], "fake");

  const fromFile = findFilmCraft({ env, platform: "win32", home });
  assert.equal(fromFile.installed, true);
  assert.equal(fromFile.cli, path.resolve(env[FILMCRAFT_ENV]));
  assert.equal(fromFile.source, "env");

  const dir = path.join(root, "install-dir");
  writeFile(path.join(dir, "filmcraft-cli.exe"), "fake");
  const fromDir = findFilmCraft({
    env: { PATH: "", [FILMCRAFT_ENV]: dir },
    platform: "win32",
    home,
  });
  assert.equal(fromDir.cli, path.resolve(path.join(dir, "filmcraft-cli.exe")));
  assert.equal(fromDir.source, "env");

  const missing = findFilmCraft({
    env: { PATH: "" },
    platform: "win32",
    home,
    localAppData: path.join(root, "local"),
    programFiles: path.join(root, "pf"),
    programFilesX86: path.join(root, "pf86"),
  });
  assert.deepEqual(missing, { cli: null, app: null, source: null, installed: false });
});

test("Windows candidates include LOCALAPPDATA and Program Files entries", (t) => {
  const root = tempDir(t);
  const home = path.join(root, "home");
  const localAppData = path.join(root, "Local");
  const programFiles = path.join(root, "PF");
  const programFilesX86 = path.join(root, "PF86");

  const localCli = path.join(localAppData, "Programs", "ArtCraft", "FilmCraft", "filmcraft-cli.exe");
  const localApp = path.join(localAppData, "Programs", "ArtCraft", "FilmCraft", "filmcraft.exe");
  const pfCli = path.join(programFiles, "ArtCraft", "FilmCraft", "filmcraft-cli.exe");
  const pf86App = path.join(programFilesX86, "ArtCraft", "FilmCraft", "filmcraft.exe");
  writeFile(localCli, "fake");
  writeFile(localApp, "fake");
  writeFile(pfCli, "fake");
  writeFile(pf86App, "fake");

  const options = {
    env: { PATH: "" },
    platform: "win32",
    home,
    localAppData,
    programFiles,
    programFilesX86,
  };
  const candidates = filmCraftCandidates(options);
  const has = (file, source, kind) =>
    candidates.some(
      (candidate) =>
        candidate.path === path.resolve(file) &&
        candidate.source === source &&
        candidate.kind === kind
    );

  assert.ok(has(localCli, "localappdata", "cli"));
  assert.ok(has(localApp, "localappdata", "app"));
  assert.ok(has(pfCli, "program-files", "cli"));
  assert.ok(has(pf86App, "program-files-x86", "app"));

  const found = findFilmCraft(options);
  assert.equal(found.installed, true);
  assert.equal(found.cli, path.resolve(localCli));
  assert.equal(found.app, path.resolve(localApp));
  assert.equal(found.source, "localappdata");

  const overridden = filmCraftCandidates({
    ...options,
    env: { PATH: "", [FILMCRAFT_ENV]: localCli },
  });
  assert.equal(
    overridden.filter((candidate) => candidate.path === path.resolve(localCli)).length,
    1,
    "the env override and LOCALAPPDATA must be deduplicated"
  );
  assert.equal(overridden[0].source, "env");
});

test("mergeFilmCraftMcpConfig creates both shapes, preserves keys and is idempotent", () => {
  const opencode = mergeFilmCraftMcpConfig(
    { theme: "dark", mcp: { other: { type: "local", command: ["other", "mcp"] } } },
    { client: "opencode", cli: "/opt/filmcraft-cli" }
  );
  assert.equal(opencode.error, null);
  assert.equal(opencode.changed, true);
  assert.equal(opencode.config.theme, "dark");
  assert.deepEqual(opencode.config.mcp.other, { type: "local", command: ["other", "mcp"] });
  assert.deepEqual(opencode.config.mcp[FILMCRAFT_MCP_NAME], {
    type: "local",
    command: ["/opt/filmcraft-cli", "mcp"],
    enabled: true,
  });

  const again = mergeFilmCraftMcpConfig(opencode.config, {
    client: "opencode",
    cli: "/opt/filmcraft-cli",
  });
  assert.equal(again.changed, false);
  assert.deepEqual(again.config, opencode.config);

  const replaced = mergeFilmCraftMcpConfig(opencode.config, {
    client: "opencode",
    cli: "/usr/local/bin/filmcraft-cli",
  });
  assert.equal(replaced.changed, true);
  assert.deepEqual(replaced.config.mcp[FILMCRAFT_MCP_NAME].command, [
    "/usr/local/bin/filmcraft-cli",
    "mcp",
  ]);

  const claude = mergeFilmCraftMcpConfig(
    { mcpServers: { other: { command: "other", args: [] } }, keep: true },
    { client: "claude", cli: "C:\\FilmCraft\\filmcraft-cli.exe" }
  );
  assert.equal(claude.error, null);
  assert.equal(claude.changed, true);
  assert.equal(claude.config.keep, true);
  assert.deepEqual(claude.config.mcpServers.other, { command: "other", args: [] });
  assert.deepEqual(claude.config.mcpServers[FILMCRAFT_MCP_NAME], {
    command: "C:\\FilmCraft\\filmcraft-cli.exe",
    args: ["mcp"],
  });

  for (const bad of [null, [], "text", 42]) {
    const result = mergeFilmCraftMcpConfig(bad, { cli: "filmcraft-cli" });
    assert.equal(result.error, "config must be a JSON object");
    assert.equal(result.changed, false);
    assert.equal(result.config, null);
  }
});

test("filmCraftMcpConfigFiles returns project and global paths for both clients", (t) => {
  const root = tempDir(t);
  const cwd = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(home, { recursive: true });

  const files = filmCraftMcpConfigFiles({
    cwd,
    home,
    env: { HOME: home },
    platform: "linux",
  });
  assert.deepEqual(files, [
    { client: "opencode", path: path.join(cwd, "opencode.json"), scope: "project" },
    { client: "opencode", path: path.join(cwd, "opencode.jsonc"), scope: "project" },
    {
      client: "opencode",
      path: path.join(home, ".config", "opencode", "opencode.json"),
      scope: "global",
    },
    {
      client: "opencode",
      path: path.join(home, ".config", "opencode", "opencode.jsonc"),
      scope: "global",
    },
    { client: "claude", path: path.join(cwd, ".mcp.json"), scope: "project" },
    { client: "claude", path: path.join(home, ".claude.json"), scope: "global" },
  ]);

  const windowsHome = path.join(root, "win-home");
  const windows = filmCraftMcpConfigFiles({
    cwd,
    env: { USERPROFILE: windowsHome },
    platform: "win32",
  });
  assert.equal(windows[2].path, path.join(windowsHome, ".config", "opencode", "opencode.json"));
  assert.equal(windows[5].path, path.join(windowsHome, ".claude.json"));
});

test("filmCraftMcpRegistration detects entries and distinguishes missing files", (t) => {
  const root = tempDir(t);
  const home = path.join(root, "home");
  const base = { home, env: { HOME: home }, platform: "linux" };

  const withEntry = path.join(root, "with-entry");
  writeFile(
    path.join(withEntry, "opencode.json"),
    JSON.stringify({
      mcp: {
        filmcraft: { type: "local", command: ["filmcraft-cli", "mcp"], enabled: true },
      },
    })
  );
  const found = filmCraftMcpRegistration({ ...base, cwd: withEntry });
  assert.equal(found.registered, true);
  assert.equal(found.client, "opencode");
  assert.equal(found.path, path.join(withEntry, "opencode.json"));
  assert.equal(found.error, null);

  const withoutEntry = path.join(root, "without-entry");
  writeFile(path.join(withoutEntry, "opencode.json"), JSON.stringify({ mcp: { other: {} } }));
  const notFound = filmCraftMcpRegistration({ ...base, cwd: withoutEntry });
  assert.equal(notFound.registered, false);
  assert.equal(notFound.client, null);
  assert.equal(notFound.path, null);
  assert.equal(notFound.error, null);

  const noFiles = path.join(root, "no-files");
  fs.mkdirSync(noFiles, { recursive: true });
  const none = filmCraftMcpRegistration({ ...base, cwd: noFiles });
  assert.deepEqual(none, { registered: null, client: null, path: null, error: null });

  const jsonc = path.join(root, "jsonc");
  writeFile(
    path.join(jsonc, "opencode.jsonc"),
    `{
      // FilmCraft is registered below.
      "mcp": {
        "filmcraft": {
          "type": "local",
          "command": ["filmcraft-cli", "mcp"],
          "enabled": true,
        },
      },
    }`
  );
  const fromJsonc = filmCraftMcpRegistration({ ...base, cwd: jsonc });
  assert.equal(fromJsonc.registered, true);
  assert.equal(fromJsonc.path, path.join(jsonc, "opencode.jsonc"));
});

test("setupFilmCraftMcp is a dry run unless write is true, backs up and refuses invalid JSON", (t) => {
  const root = tempDir(t);
  const cwd = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const base = { cwd, home, env: { HOME: home }, platform: "linux" };
  const configPath = path.join(cwd, "opencode.json");

  const dry = setupFilmCraftMcp({
    ...base,
    client: "opencode",
    cli: "/opt/first/filmcraft-cli",
    write: false,
  });
  assert.equal(dry.ok, true);
  assert.equal(dry.path, configPath);
  assert.equal(dry.changed, true);
  assert.equal(dry.error, null);
  assert.equal(fs.existsSync(configPath), false);

  const first = setupFilmCraftMcp({
    ...base,
    client: "opencode",
    cli: "/opt/first/filmcraft-cli",
    write: true,
  });
  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  const firstConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.deepEqual(firstConfig.mcp[FILMCRAFT_MCP_NAME].command, [
    "/opt/first/filmcraft-cli",
    "mcp",
  ]);

  const same = setupFilmCraftMcp({
    ...base,
    client: "opencode",
    cli: "/opt/first/filmcraft-cli",
    write: true,
  });
  assert.equal(same.ok, true);
  assert.equal(same.changed, false);

  const second = setupFilmCraftMcp({
    ...base,
    client: "opencode",
    cli: "/opt/second/filmcraft-cli",
    write: true,
  });
  assert.equal(second.ok, true);
  assert.equal(second.changed, true);
  const backupPath = `${configPath}.bak`;
  assert.equal(fs.existsSync(backupPath), true);
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  assert.deepEqual(backup.mcp[FILMCRAFT_MCP_NAME].command, [
    "/opt/first/filmcraft-cli",
    "mcp",
  ]);
  const secondConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.deepEqual(secondConfig.mcp[FILMCRAFT_MCP_NAME].command, [
    "/opt/second/filmcraft-cli",
    "mcp",
  ]);

  const claude = setupFilmCraftMcp({
    ...base,
    client: "claude",
    cli: "/opt/filmcraft-cli",
    write: true,
  });
  assert.equal(claude.ok, true);
  assert.equal(claude.path, path.join(cwd, ".mcp.json"));
  const claudeConfig = JSON.parse(fs.readFileSync(claude.path, "utf8"));
  assert.deepEqual(claudeConfig.mcpServers[FILMCRAFT_MCP_NAME], {
    command: "/opt/filmcraft-cli",
    args: ["mcp"],
  });

  const invalidRoot = path.join(root, "invalid");
  const invalidPath = path.join(invalidRoot, "opencode.json");
  writeFile(invalidPath, "{ not json");
  const invalid = setupFilmCraftMcp({
    cwd: invalidRoot,
    home,
    env: { HOME: home },
    platform: "linux",
    client: "opencode",
    cli: "/opt/filmcraft-cli",
    write: true,
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /invalid JSON/i);
  assert.equal(fs.readFileSync(invalidPath, "utf8"), "{ not json");
  assert.equal(fs.existsSync(`${invalidPath}.bak`), false);
});

test("runFilmCraft and filmCraftVersion use a fake CLI", (t) => {
  const shim = makeFakeCli(t);
  const result = runFilmCraft(shim, ["--version"], { timeout: 10000 });
  assert.equal(result.ok, true, result.stderr);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /filmcraft-cli 0\.17\.0/);
  assert.equal(result.error, null);
  assert.equal(filmCraftVersion(shim, { timeout: 10000 }), "0.17.0");

  const missing = runFilmCraft(path.join(tempDir(t), "missing-filmcraft-cli"), ["--version"]);
  assert.equal(missing.ok, false);
  assert.equal(missing.error, "filmcraft-cli not found");
  assert.equal(missing.status, null);
});

test("filmCraftRun parses JSON lines and reports the first failure", (t) => {
  const shim = makeFakeCli(t);

  const ok = filmCraftRun(
    shim,
    "project.fcproj",
    [
      { id: "one", params: { a: 1 } },
      { id: "two", params: { b: 2 } },
    ],
    { timeout: 10000 }
  );
  assert.equal(ok.ok, true, ok.stderr);
  assert.equal(ok.failed, null);
  assert.equal(ok.results.length, 2);
  assert.deepEqual(ok.results[0].result.echo, { a: 1 });

  const failed = filmCraftRun(
    shim,
    "project.fcproj",
    [{ id: "one" }, { id: "fail.me" }, { id: "three" }],
    { timeout: 10000, keepGoing: true }
  );
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.failed, { line: 2, id: "fail.me", error: "boom" });
  assert.equal(failed.results.length, 3);
  assert.equal(failed.results[2].ok, true);

  const stopped = filmCraftRun(
    shim,
    "project.fcproj",
    [{ id: "one" }, { id: "fail.me" }, { id: "three" }],
    { timeout: 10000 }
  );
  assert.equal(stopped.ok, false);
  assert.equal(stopped.results.length, 2);
  assert.deepEqual(stopped.failed, { line: 2, id: "fail.me", error: "boom" });

  const empty = filmCraftRun(
    path.join(tempDir(t), "missing-filmcraft-cli"),
    "project.fcproj",
    [],
    { timeout: 10000 }
  );
  assert.deepEqual(empty, {
    ok: true,
    results: [],
    failed: null,
    stdout: "",
    stderr: "",
    error: null,
  });
});

test("convenience wrappers build FilmCraft commands", (t) => {
  const shim = makeFakeCli(t);
  const project = path.join(tempDir(t), "project.fcproj");

  const inspected = inspect(shim, project, "both", { timeout: 10000 });
  assert.deepEqual(inspected, { what: "all" });

  const imported = importMedia(shim, project, ["a.mov", "b.wav"], { timeout: 10000 });
  assert.deepEqual(imported, { items: [1, 2], errors: [] });

  const placed = place(shim, project, { item: 1, track: "V1" }, { timeout: 10000 });
  assert.deepEqual(placed.echo, { item: 1, track: "V1" });

  const replaced = replace(shim, project, { clips: [2], item: 1 }, { timeout: 10000 });
  assert.deepEqual(replaced.echo, { clips: [2], item: 1 });

  const marked = markers(
    shim,
    project,
    [{ time: 1, label: "Intro", comment: "start" }],
    { timeout: 10000 }
  );
  assert.equal(marked.ok, true);
  assert.equal(marked.results.length, 1);
  assert.equal(marked.results[0].echo.target, "program");
  assert.equal(marked.results[0].echo.time, FILMCRAFT_TICKS_PER_SECOND);
  assert.equal(marked.results[0].echo.name, "Intro");

  const exported = exportMedia(shim, project, "out.mp4", { timeout: 10000 });
  assert.equal(exported.echo.path, "out.mp4");
  assert.equal(exported.echo.format, "h264");
  assert.equal(exported.echo.range, "entire");
  assert.equal(exported.echo.wait, true);

  const noWait = exportMedia(shim, project, "out.mp4", {
    timeout: 10000,
    wait: false,
    startSeconds: 1,
    endSeconds: 2,
  });
  assert.equal(noWait.echo.wait, false);
  assert.equal(noWait.echo.range, "custom");
  assert.equal(noWait.echo.startSeconds, 1);

  const rendered = renderFrame(shim, project, 1.5, "frame.png", { timeout: 10000 });
  assert.equal(rendered.ok, true, rendered.stderr);
  assert.equal(rendered.path, "frame.png");
});

test("filmCraftMcpConfig and filmCraftStatus expose the expected shapes", (t) => {
  const root = tempDir(t);
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  fs.mkdirSync(cwd, { recursive: true });

  assert.deepEqual(filmCraftMcpConfig({ client: "opencode", cli: "/bin/filmcraft-cli" }), {
    mcp: {
      [FILMCRAFT_MCP_NAME]: {
        type: "local",
        command: ["/bin/filmcraft-cli", "mcp"],
        enabled: true,
      },
    },
  });
  assert.deepEqual(filmCraftMcpConfig({ client: "claude", cli: "/bin/filmcraft-cli" }), {
    mcpServers: {
      [FILMCRAFT_MCP_NAME]: { command: "/bin/filmcraft-cli", args: ["mcp"] },
    },
  });

  const snippet = filmCraftMcpSnippet({ client: "opencode", cli: "/bin/filmcraft-cli" });
  assert.match(snippet, /Restart the agent/);
  assert.deepEqual(JSON.parse(snippet.split("\n\n")[0]), filmCraftMcpConfig({
    client: "opencode",
    cli: "/bin/filmcraft-cli",
  }));

  const status = filmCraftStatus({
    cwd,
    home,
    env: { PATH: "" },
    platform: "win32",
    localAppData: path.join(root, "empty-local"),
    programFiles: path.join(root, "empty-pf"),
    programFilesX86: path.join(root, "empty-pf86"),
  });
  assert.equal(status.installed, false);
  assert.equal(status.cli, null);
  assert.equal(status.app, null);
  assert.equal(status.source, null);
  assert.equal(status.version, null);
  assert.deepEqual(status.mcp, {
    registered: null,
    client: null,
    path: null,
    error: null,
  });
  assert.equal(typeof status.mcpConfig.opencode, "string");
  assert.equal(typeof status.mcpConfig.claude, "string");
});

test("filmCraftOnboardingPrompt covers install, install-cli, connect and ready", () => {
  const install = filmCraftOnboardingPrompt({ installed: false });
  assert.equal(install.kind, "install");
  assert.match(install.questionPt, /Não encontrei o FilmCraft/);
  assert.equal(install.optionsPt.length, 2);

  const installCli = filmCraftOnboardingPrompt({ installed: true, cli: null });
  assert.equal(installCli.kind, "install-cli");
  assert.match(installCli.questionPt, /filmcraft-cli não foi encontrado/);

  const connect = filmCraftOnboardingPrompt({
    installed: true,
    cli: "filmcraft-cli",
    mcp: { registered: false },
  });
  assert.equal(connect.kind, "connect-mcp");
  assert.match(connect.questionPt, /reiniciar o programa\/agente/);
  assert.deepEqual(connect.optionsPt, ["Conectar o MCP", "Agora não"]);

  const ready = filmCraftOnboardingPrompt({
    installed: true,
    cli: "filmcraft-cli",
    mcp: { registered: true },
  });
  assert.equal(ready.kind, "ready");
  assert.deepEqual(ready.options, []);
});
