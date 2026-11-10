/**
 * Guardrails for custom HTML/CSS/GSAP elements.
 *
 * Custom elements are the escape hatch: the agent may write any markup or
 * animation the engine can render. These checks do not judge the design; they
 * only catch code that cannot work inside the shared HyperFrames timeline, so
 * the failure happens before an expensive render.
 *
 * Pure: no filesystem, no process, no engine imports.
 */

export const CUSTOM_CODE_LIMITS = Object.freeze({
  html: 24000,
  css: 24000,
  animation: 16000,
});

const SELF_CONTAINED_BAN = /\b(import\s+|require\s*\(|fetch\s*\(|XMLHttpRequest\b|new\s+Worker\b)/i;

/**
 * @param {object} element
 * @returns {{errors:string[],warnings:string[]}}
 */
export function customCodeIssues(element) {
  const errors = [];
  const warnings = [];
  if (!element || (element.type !== "custom" && element.template !== "custom")) {
    return { errors, warnings };
  }
  const label = element.id || "custom element";
  const html = String(element.html || "");
  const css = String(element.css || "");
  const animation = String(element.animation || "");

  if (html.length > CUSTOM_CODE_LIMITS.html) {
    errors.push(
      `${label}: inline html is ${html.length} characters; move it to a component folder (limit ${CUSTOM_CODE_LIMITS.html})`
    );
  }
  if (css.length > CUSTOM_CODE_LIMITS.css) {
    errors.push(
      `${label}: inline css is ${css.length} characters; move it to a component folder (limit ${CUSTOM_CODE_LIMITS.css})`
    );
  }
  if (animation.length > CUSTOM_CODE_LIMITS.animation) {
    errors.push(
      `${label}: animation is ${animation.length} characters; move it to element.js in a component (limit ${CUSTOM_CODE_LIMITS.animation})`
    );
  }

  if (/<script[\s>]/i.test(html)) {
    warnings.push(`${label}: inline <script> in html is ignored by the timeline; put it in animation or element.js`);
  }

  if (animation) {
    if (/\bgsap\.timeline\s*\(/i.test(animation)) {
      errors.push(`${label}: do not create a new GSAP timeline; animate the shared tl`);
    }
    if (!/\btl\s*\./.test(animation)) {
      warnings.push(`${label}: animation does not use the shared tl; it will not seek with the composition`);
    }
    if (SELF_CONTAINED_BAN.test(animation)) {
      errors.push(
        `${label}: animation must be self-contained; no imports, require, fetch, Worker, or XHR`
      );
    }
    if (/\bdocument\.(write|open)\b/i.test(animation)) {
      errors.push(`${label}: animation must not use document.write or document.open`);
    }
  }

  if (/@import\b/i.test(css) || /url\(\s*['"]?(https?:)?\/\//i.test(css)) {
    warnings.push(`${label}: remote CSS assets are not copied; use local assets or inline SVG`);
  }

  return { errors, warnings };
}
