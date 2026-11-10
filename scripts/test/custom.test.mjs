import { test } from "node:test";
import assert from "node:assert/strict";

import { customCodeIssues } from "../features/custom.mjs";

const base = {
  id: "el-custom",
  type: "custom",
  template: "custom",
  html: "<div class=\"card\"><strong>3,6 GB</strong></div>",
  animation: "tl.fromTo(root.querySelector('.card'), { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, start + 0.1);",
};

test("customCodeIssues accepts a self-contained element with the shared timeline", () => {
  const result = customCodeIssues(base);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test("customCodeIssues rejects a private GSAP timeline", () => {
  const result = customCodeIssues({
    ...base,
    animation: "const own = gsap.timeline(); own.to(root, { opacity: 1 });",
  });
  assert.ok(result.errors.some((error) => /shared tl/.test(error)));
});

test("customCodeIssues rejects imports, fetch, and workers", () => {
  for (const animation of [
    "import gsap from 'gsap'; tl.to(root, { opacity: 1 });",
    "fetch('/data.json').then(() => tl.to(root, { opacity: 1 }));",
    "const worker = new Worker('job.js'); tl.to(root, { opacity: 1 });",
  ]) {
    const result = customCodeIssues({ ...base, animation });
    assert.ok(result.errors.some((error) => /self-contained/.test(error)));
  }
});

test("customCodeIssues warns when the animation ignores the shared timeline", () => {
  const result = customCodeIssues({
    ...base,
    animation: "root.style.opacity = '1';",
  });
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((warning) => /shared tl/.test(warning)));
});

test("customCodeIssues warns about inline script and remote CSS assets", () => {
  const result = customCodeIssues({
    ...base,
    html: "<div><script>window.x = 1</script></div>",
    css: "@import url(https://fonts.example/x.css); .card { background: url(https://cdn.example/x.png); }",
  });
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((warning) => /inline <script>/.test(warning)));
  assert.ok(result.warnings.some((warning) => /remote CSS assets/.test(warning)));
});

test("customCodeIssues rejects oversized inline code", () => {
  const result = customCodeIssues({ ...base, html: "x".repeat(25000) });
  assert.ok(result.errors.some((error) => /move it to a component/.test(error)));
});

test("customCodeIssues ignores other element types", () => {
  const result = customCodeIssues({ type: "letreiro", template: "title", html: "x".repeat(30000) });
  assert.deepEqual(result, { errors: [], warnings: [] });
});
