import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildComponentEntry,
  buildSnapshot,
  clearWatch,
  componentShell,
  findPreviewFixture,
  inferDefaultProps,
  inferPropNames,
  readWatch,
  readWatchState,
  resolveComponentFixture,
  startWatchServer,
  updateWatchState,
  watchHtml,
  writeWatch,
} from "../lib/watch.mjs";

function tempProject(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rooster-watch-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  fs.mkdirSync(path.join(root, "edit"), { recursive: true });
  fs.mkdirSync(path.join(root, "assets", "source"), { recursive: true });
  fs.mkdirSync(path.join(root, "renders"), { recursive: true });
  fs.mkdirSync(path.join(root, "style", "proof"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "project.json"),
    JSON.stringify({ schema: "rooster.project/v1", slug: "demo", name: "Demo", channel: "studio", engine: "hyperframes", timeline: "none" })
  );
  return root;
}

test("buildSnapshot reports stages, plan, media, and the next active step", (t) => {
  const root = tempProject(t);
  fs.writeFileSync(path.join(root, "brief.md"), "# Demo\n");
  fs.writeFileSync(path.join(root, "script.md"), "# Script\n");
  fs.writeFileSync(
    path.join(root, "edit", "plan.json"),
    JSON.stringify({ schema: "rooster.plan/v1", editMode: "cleanup", duration: 42, cuts: [{}, {}], elements: [{}] })
  );
  fs.writeFileSync(path.join(root, "style", "proof", "frame-1.png"), Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(path.join(root, "renders", "draft.mp4"), Buffer.alloc(2048));

  const snapshot = buildSnapshot(root, { now: Date.now() });
  assert.equal(snapshot.schema, "rooster.watch/v1");
  assert.equal(snapshot.project, "demo");
  assert.equal(snapshot.progress.total, 8);
  assert.equal(snapshot.stages.filter((stage) => stage.status === "done").length, 3);
  assert.equal(snapshot.current.id, "assets");
  assert.equal(snapshot.plan.cuts, 2);
  assert.equal(snapshot.plan.elements, 1);
  assert.equal(snapshot.plan.duration, 42);
  assert.equal(snapshot.images.length, 1);
  assert.equal(snapshot.images[0].relative, "style/proof/frame-1.png");
  assert.equal(snapshot.renders.length, 1);
  assert.equal(snapshot.renders[0].relative, "renders/draft.mp4");
});

test("updateWatchState keeps the first sighting and the finish time", (t) => {
  const root = tempProject(t);
  fs.writeFileSync(path.join(root, "brief.md"), "# Demo\n");
  fs.writeFileSync(path.join(root, "script.md"), "# Script\n");

  const t0 = 1_700_000_000_000;
  const first = buildSnapshot(root, { now: t0, state: null });
  const state = updateWatchState(null, first, t0);
  assert.equal(state.schema, "rooster.watch-state/v1");
  assert.ok(state.stages.brief.firstSeen);
  assert.ok(state.stages.brief.doneAt);
  assert.equal(state.stages.plan.doneAt, null);

  const t1 = t0 + 90_000;
  const second = buildSnapshot(root, { now: t1, state });
  const later = updateWatchState(state, second, t1);
  assert.equal(later.stages.brief.firstSeen, state.stages.brief.firstSeen);
  assert.equal(later.stages.brief.doneAt, state.stages.brief.doneAt);
  assert.equal(later.stages.plan.doneAt, null);
});

test("watch state and status files round-trip and clear", (t) => {
  const root = tempProject(t);
  writeWatch(root, { url: "http://127.0.0.1:1/", port: 1, pid: 999999, slug: "demo" });
  assert.equal(readWatch(root).url, "http://127.0.0.1:1/");
  assert.equal(readWatchState(root), null);
  clearWatch(root);
  assert.equal(readWatch(root), null);
});

test("the server serves the page, the snapshot, and refuses path traversal", async (t) => {
  const root = tempProject(t);
  fs.writeFileSync(path.join(root, "style", "proof", "a.png"), Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(path.join(root, "renders", "draft.mp4"), Buffer.alloc(1024));
  fs.writeFileSync(path.join(root, "secret.txt"), "no");
  fs.mkdirSync(path.join(root, "preview"), { recursive: true });
  fs.mkdirSync(path.join(root, "engine", "remotion", "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "preview", "index.html"), "<h1>Preview</h1>");
  fs.writeFileSync(path.join(root, "engine", "remotion", "src", "Scene.tsx"), "export const Scene = () => null;\n");

  const server = await startWatchServer({ projectDir: root, port: 0, intervalMs: 500 });
  t.after(() => server.close());
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

  const page = await fetch(server.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /RoosterEdit/);

  const snapshot = await (await fetch(`${server.url}api/state`)).json();
  assert.equal(snapshot.project, "demo");
  assert.ok(snapshot.files.videos.some((file) => file.relative === "renders/draft.mp4"));
  assert.ok(snapshot.files.images.some((file) => file.relative === "style/proof/a.png"));
  assert.ok(snapshot.files.html.some((file) => file.relative === "preview/index.html"));
  assert.ok(snapshot.files.code.some((file) => file.relative === "engine/remotion/src/Scene.tsx"));

  const image = await fetch(`${server.url}file/style/proof/a.png`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");

  const code = await fetch(`${server.url}file/engine/remotion/src/Scene.tsx`);
  assert.equal(code.status, 200);
  assert.match(code.headers.get("content-type"), /text\/plain/);
  assert.match(await code.text(), /export const Scene/);

  const html = await fetch(`${server.url}file/preview/index.html`);
  assert.equal(html.status, 200);
  assert.match(html.headers.get("content-type"), /text\/html/);

  const traversal = await fetch(`${server.url}file/../secret.txt`);
  assert.equal(traversal.status, 404);

  const missing = await fetch(`${server.url}file/nope.png`);
  assert.equal(missing.status, 404);
});

test("watchHtml stays dependency-free", () => {
  const html = watchHtml();
  assert.match(html, /EventSource/);
  assert.match(html, /\/component\//);
  assert.doesNotMatch(html, /https?:\/\/(?!127\.0\.0\.1)/);
  assert.doesNotMatch(html, /<script src=/);
});

test("component preview degrades with a clear message when no bundler exists", async (t) => {
  const root = tempProject(t);
  fs.mkdirSync(path.join(root, "engine", "remotion", "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "engine", "remotion", "src", "Scene.tsx"),
    "export const Scene = () => null;\n"
  );

  const server = await startWatchServer({ projectDir: root, port: 0, intervalMs: 500 });
  t.after(() => server.close());

  const snapshot = await (await fetch(`${server.url}api/state`)).json();
  assert.equal(snapshot.preview.bundler, false);
  assert.equal(snapshot.files.code[0].renderable, false);

  const shell = await fetch(`${server.url}component/engine/remotion/src/Scene.tsx`);
  assert.equal(shell.status, 200);
  const html = await shell.text();
  assert.match(html, /No esbuild found/);
  assert.doesNotMatch(html, /<script src=/);

  const missing = await fetch(`${server.url}component/nope.tsx`);
  assert.equal(missing.status, 404);
});

test("componentShell renders a root node for a bundle and escapes the error", () => {
  const ok = componentShell({ title: "Scene", bundleUrl: "/component-bundle/x.js?v=1" });
  assert.match(ok, /<div id="root"><\/div>/);
  assert.match(ok, /src="\/component-bundle\/x\.js\?v=1"/);

  const error = componentShell({ title: "Scene", error: 'unexpected <token> & "quote"' });
  assert.match(error, /unexpected &lt;token&gt; &amp; &quot;quote&quot;/);
  assert.doesNotMatch(error, /<script src=/);
});

test("findPreviewFixture prefers the sibling fixture and ignores the component itself", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rooster-fixture-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const hero = path.join(dir, "Hero.tsx");
  fs.writeFileSync(hero, "export default () => null;");
  assert.equal(findPreviewFixture(dir, hero), null);

  fs.writeFileSync(path.join(dir, "Hero.preview.tsx"), "export default {};");
  assert.equal(path.basename(findPreviewFixture(dir, hero)), "Hero.preview.tsx");

  const card = path.join(dir, "Card.tsx");
  fs.writeFileSync(card, "export default () => null;");
  fs.writeFileSync(path.join(dir, "preview.json"), '{"title":"Hi"}');
  assert.equal(path.basename(findPreviewFixture(dir, card)), "preview.json");

  // A file named preview.tsx must not become its own fixture.
  const preview = path.join(dir, "preview.tsx");
  fs.writeFileSync(preview, "export default () => null;");
  fs.rmSync(path.join(dir, "preview.json"));
  assert.equal(findPreviewFixture(dir, preview), null);
});

test("buildComponentEntry embeds JSON props and imports module fixtures", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rooster-entry-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const plain = buildComponentEntry({ component: "C:/p/Hero.tsx" });
  assert.match(plain, /import \* as mod from "C:\/p\/Hero.tsx"/);
  assert.match(plain, /const fixture = null;/);

  const direct = buildComponentEntry({ component: "C:/p/Hero.tsx", props: { title: "Ada" } });
  assert.match(direct, /const fixtureProps = \{"title":"Ada"\};/);
  assert.match(direct, /const fixture = fixtureProps;/);

  const jsonFixture = path.join(dir, "preview.json");
  fs.writeFileSync(jsonFixture, JSON.stringify({ title: "Ada", count: 2 }));
  const withJson = buildComponentEntry({ component: "C:/p/Hero.tsx", fixture: jsonFixture });
  assert.match(withJson, /const fixtureProps = \{"title":"Ada","count":2\};/);
  assert.match(withJson, /const fixture = fixtureProps;/);

  const moduleFixture = path.join(dir, "Hero.preview.tsx");
  fs.writeFileSync(moduleFixture, "export default { title: 'Ada' };");
  const withModule = buildComponentEntry({ component: "C:/p/Hero.tsx", fixture: moduleFixture });
  assert.match(withModule, /import \* as fixtureModule from /);
  assert.match(withModule, /fixtureModule\.props !== undefined/);
});

test("props are inferred from the signature when no fixture exists", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rooster-infer-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.deepEqual(
    inferPropNames("export default function Hero({ title, count = 3 }: Props) { return null; }"),
    ["title", "count"]
  );
  assert.deepEqual(inferPropNames("const Hero = ({ title, active }) => null;"), ["title", "active"]);
  assert.deepEqual(inferPropNames("const Hero = (props) => null;"), []);

  assert.deepEqual(inferDefaultProps(["title", "count", "items", "active", "accent"], "A hero card"), {
    title: "A hero card",
    count: 3,
    items: [],
    active: false,
    accent: "#22d3ee",
  });
  assert.deepEqual(inferDefaultProps(["title"], ""), { title: "Preview" });

  const component = path.join(dir, "Hero.tsx");
  fs.writeFileSync(component, "export default function Hero({ title, count }) { return null; }");

  const bare = resolveComponentFixture(dir, component);
  assert.equal(bare.source, "inferred");
  assert.deepEqual(bare.props, { title: "Preview", count: 3 });

  fs.writeFileSync(path.join(dir, "component.json"), JSON.stringify({ description: "A hero card" }));
  const withManifest = resolveComponentFixture(dir, component);
  assert.equal(withManifest.source, "inferred");
  assert.deepEqual(withManifest.props, { title: "A hero card", count: 3 });

  fs.writeFileSync(
    path.join(dir, "component.json"),
    JSON.stringify({ description: "A hero card", props: { title: "Fixed" } })
  );
  const withProps = resolveComponentFixture(dir, component);
  assert.equal(withProps.source, "manifest");
  assert.deepEqual(withProps.props, { title: "Fixed" });

  fs.writeFileSync(path.join(dir, "preview.json"), JSON.stringify({ title: "File wins" }));
  const withFile = resolveComponentFixture(dir, component);
  assert.equal(withFile.source, "file");
  assert.equal(path.basename(withFile.fixture), "preview.json");
});
