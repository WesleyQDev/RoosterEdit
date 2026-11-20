/**
 * Motion helpers for RoosterEdit.
 *
 * Pure, dependency-free builders for two normalized plan elements:
 *   { type: "zoom", start, end, scale, originX, originY }
 *   { type: "transition", start, end, kind, direction }
 *
 * Helpers return CSS/HTML/GSAP strings. Nothing here imports rooster.mjs or
 * writes files.
 */

export const ZOOM_DEFAULTS = Object.freeze({
  scale: 1.12,
  originX: 0.5,
  originY: 0.5,
});

export const TRANSITION_KINDS = Object.freeze(["fade", "dip", "slide"]);
export const TRANSITION_DIRECTIONS = Object.freeze(["left", "right", "up", "down"]);

// ---------------------------------------------------------------------------
// Small pure utilities
// ---------------------------------------------------------------------------

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function fixed(value) {
  return Number(value).toFixed(3);
}

function seconds(value) {
  return Number(Number(value).toFixed(3));
}

function rounded(value, digits = 4) {
  return Number(Number(value).toFixed(digits));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeId(value, fallback = "motion") {
  const raw = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!raw) return fallback;
  if (/^[0-9-]/.test(raw)) return `${fallback}-${raw}`;
  return raw;
}

function safeColor(value, fallback) {
  const text = String(value ?? "").trim();
  const pattern =
    /^(#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]{3,20}|(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]+\))$/i;
  return pattern.test(text) ? text : fallback;
}

function timelineName(options, fallback = "tl") {
  const name = String(options.timeline ?? "");
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : fallback;
}

function identifier(value, fallback) {
  const text = String(value ?? "").replace(/[^A-Za-z0-9_$]/g, "");
  return text && !/^[0-9]/.test(text) ? text : fallback;
}

function requireSelector(selector, helper) {
  if (typeof selector !== "string" || !selector.trim()) {
    throw new TypeError(`${helper} requires a non-empty target selector`);
  }
  return selector.trim();
}

function slideVector(direction) {
  switch (direction) {
    case "right":
      return { axis: "x", from: -100, to: 100 };
    case "up":
      return { axis: "y", from: 100, to: -100 };
    case "down":
      return { axis: "y", from: -100, to: 100 };
    case "left":
    default:
      // "left" means the panel travels left: enter from the right, leave left.
      return { axis: "x", from: 100, to: -100 };
  }
}

function transitionColor(transition, theme = {}, options = {}) {
  const tokens = theme && typeof theme === "object" && !Array.isArray(theme) ? theme : {};
  const fallback = transition.kind === "dip" ? "#000000" : safeColor(tokens.bg, "#000000");
  return safeColor(transition.color ?? options.color, fallback);
}

function transitionElementId(element, options = {}) {
  if (options.id !== undefined) return sanitizeId(options.id, "rooster-transition");
  const base = sanitizeId(element.id ?? options.index ?? "overlay", "overlay");
  return /^rooster-transition-/.test(base) ? base : `rooster-transition-${base}`;
}

/**
 * Convert one zoom plan element into a predictable, render-ready shape.
 * Times are seconds; origin values are 0..1 fractions of the target.
 *
 * @param {object} element
 * @param {object} [options] Defaults and render overrides.
 * @returns {object} Normalized zoom values.
 */
export function normalizeZoom(element = {}, options = {}) {
  const start = seconds(Math.max(0, number(element.start, 0)));
  const end = seconds(Math.max(start + 0.05, number(element.end, start + 1)));
  const duration = seconds(end - start);
  const half = duration / 2;
  const scale = clamp(number(element.scale, options.scale ?? ZOOM_DEFAULTS.scale), 0.5, 4);
  const originX = clamp(number(element.originX, options.originX ?? ZOOM_DEFAULTS.originX), 0, 1);
  const originY = clamp(number(element.originY, options.originY ?? ZOOM_DEFAULTS.originY), 0, 1);
  const release = element.release !== false && options.release !== false;

  const defaultIn = Math.min(0.6, duration * 0.4);
  const defaultOut = Math.min(0.45, duration * 0.3);
  const rampIn = seconds(clamp(number(element.rampIn, options.rampIn ?? defaultIn), 0.02, half));
  const rampOut = release
    ? seconds(clamp(number(element.rampOut, options.rampOut ?? defaultOut), 0.02, half))
    : 0;

  const inEnd = seconds(Math.min(end, start + rampIn));
  const outStart = release ? seconds(Math.max(inEnd + 0.001, end - rampOut)) : end;
  const inputRange = release ? [start, inEnd, outStart, end] : [start, inEnd, end];
  const outputRange = release ? [1, scale, scale, 1] : [1, scale, scale];

  return {
    type: "zoom",
    start,
    end,
    duration,
    scale,
    originX,
    originY,
    originXPercent: rounded(originX * 100, 3),
    originYPercent: rounded(originY * 100, 3),
    transformOrigin: `${rounded(originX * 100, 3)}% ${rounded(originY * 100, 3)}%`,
    release,
    rampIn,
    rampOut,
    inEnd,
    outStart,
    inputRange,
    outputRange,
    ease: typeof element.ease === "string" ? element.ease : options.ease || "power2.out",
    easeOut:
      typeof element.easeOut === "string" ? element.easeOut : options.easeOut || "power2.inOut",
  };
}

/**
 * Convert one transition plan element into a predictable, render-ready shape.
 *
 * @param {object} element
 * @param {object} [options] Defaults and render overrides.
 * @returns {object} Normalized transition values.
 */
export function normalizeTransition(element = {}, options = {}) {
  const start = seconds(Math.max(0, number(element.start, 0)));
  const end = seconds(Math.max(start + 0.1, number(element.end, start + 1)));
  const duration = seconds(end - start);
  const kind = TRANSITION_KINDS.includes(element.kind)
    ? element.kind
    : TRANSITION_KINDS.includes(options.kind)
      ? options.kind
      : "fade";
  const direction = TRANSITION_DIRECTIONS.includes(element.direction)
    ? element.direction
    : TRANSITION_DIRECTIONS.includes(options.direction)
      ? options.direction
      : "left";
  const peak =
    kind === "slide"
      ? 1
      : clamp(number(element.opacity, options.opacity ?? (kind === "dip" ? 1 : 0.8)), 0, 1);
  const mid = seconds(start + duration / 2);

  return {
    type: "transition",
    start,
    end,
    duration,
    mid,
    kind,
    direction,
    peak,
    color: typeof element.color === "string" ? element.color : null,
    easeIn:
      typeof element.easeIn === "string"
        ? element.easeIn
        : options.easeIn || (kind === "slide" ? "power2.inOut" : "power2.in"),
    easeOut:
      typeof element.easeOut === "string"
        ? element.easeOut
        : options.easeOut || (kind === "slide" ? "power2.inOut" : "power2.out"),
    slide: kind === "slide" ? slideVector(direction) : null,
  };
}

// ---------------------------------------------------------------------------
// HyperFrames (HTML + CSS + GSAP)
// ---------------------------------------------------------------------------

/**
 * CSS for a zoom target. Use a dedicated wrapper when the base clip already
 * animates scale, so the two tweens do not fight over the same property.
 *
 * @param {object} element Zoom plan element.
 * @param {string} selector Target selector, e.g. "#base" or "#zoom-layer".
 * @param {object} [options]
 * @returns {string} CSS rule.
 */
export function hyperframesZoomCss(element, selector, options = {}) {
  const target = requireSelector(selector, "hyperframesZoomCss");
  const zoom = normalizeZoom(element, options);
  return `${target} {
  transform-origin: ${zoom.transformOrigin};
  will-change: transform;
  backface-visibility: hidden;
}`;
}

/**
 * GSAP timeline statements for a zoom. The snippet expects a timeline named
 * "tl" unless options.timeline says otherwise.
 *
 * @param {object} element Zoom plan element.
 * @param {string} selector Target selector.
 * @param {object} [options]
 * @returns {string} GSAP statements.
 */
export function hyperframesZoomTween(element, selector, options = {}) {
  const target = requireSelector(selector, "hyperframesZoomTween");
  const zoom = normalizeZoom(element, options);
  const tl = timelineName(options);
  const selected = JSON.stringify(target);
  const lines = [];

  if (options.comment !== false) {
    lines.push(`/* zoom ${fixed(zoom.start)}-${fixed(zoom.end)}s on ${target} */`);
  }
  lines.push(
    `${tl}.set(${selected}, { transformOrigin: ${JSON.stringify(zoom.transformOrigin)} }, ${fixed(zoom.start)});`
  );
  lines.push(
    `${tl}.to(${selected}, { scale: ${rounded(zoom.scale)}, duration: ${fixed(zoom.rampIn)}, ease: ${JSON.stringify(
      zoom.ease
    )} }, ${fixed(zoom.start)});`
  );
  if (zoom.release) {
    lines.push(
      `${tl}.to(${selected}, { scale: 1, duration: ${fixed(zoom.rampOut)}, ease: ${JSON.stringify(
        zoom.easeOut
      )} }, ${fixed(zoom.outStart)});`
    );
  }
  return lines.join("\n");
}

/**
 * Bundle the CSS and tween for a zoom. Zoom has no overlay markup; it
 * decorates an existing element, so there is deliberately no html field.
 *
 * @param {object} element Zoom plan element.
 * @param {string} selector Target selector.
 * @param {object} [options]
 * @returns {{selector: string, css: string, tween: string, values: object}}
 */
export function hyperframesZoom(element, selector, options = {}) {
  const target = requireSelector(selector, "hyperframesZoom");
  return {
    selector: target,
    css: hyperframesZoomCss(element, target, options),
    tween: hyperframesZoomTween(element, target, options),
    values: normalizeZoom(element, options),
  };
}

/**
 * Overlay markup for a fade, dip, or slide transition. Pair it with
 * hyperframesTransitionCss() and hyperframesTransitionTween().
 *
 * @param {object} element Transition plan element.
 * @param {object} [theme] Theme tokens (kept for signature symmetry).
 * @param {object} [options] id, trackIndex, ...
 * @returns {string} HTML element.
 */
export function hyperframesTransitionHtml(element, theme = {}, options = {}) {
  const transition = normalizeTransition(element, options);
  const id = transitionElementId(element, options);
  const trackIndex = Number.isFinite(Number(options.trackIndex))
    ? Math.trunc(Number(options.trackIndex))
    : 40;
  return `<div id="${escapeHtml(id)}" class="clip rooster-transition rooster-transition-${transition.kind}" data-start="${fixed(
    transition.start
  )}" data-duration="${fixed(transition.duration)}" data-track-index="${trackIndex}" aria-hidden="true"></div>`;
}

/**
 * CSS for a transition overlay. The selector defaults to the id used by
 * hyperframesTransitionHtml().
 *
 * @param {object} element Transition plan element.
 * @param {string} [selector] Overlay selector.
 * @param {object} [theme]
 * @param {object} [options]
 * @returns {string} CSS rule.
 */
export function hyperframesTransitionCss(element, selector, theme = {}, options = {}) {
  const transition = normalizeTransition(element, options);
  const id = transitionElementId(element, options);
  const target = selector
    ? requireSelector(selector, "hyperframesTransitionCss")
    : `#${id}`;
  const color = transitionColor(transition, theme, options);
  const zIndex = Number.isFinite(Number(options.zIndex)) ? Math.trunc(Number(options.zIndex)) : 40;
  const lines = [
    `${target} {`,
    "  position: absolute;",
    "  inset: 0;",
    `  z-index: ${zIndex};`,
    "  pointer-events: none;",
    `  background: ${color};`,
    `  opacity: ${transition.kind === "slide" ? 1 : 0};`,
  ];

  if (transition.slide) {
    const { axis, from } = transition.slide;
    lines.push(
      `  transform: translate3d(${axis === "x" ? `${from}%` : "0"}, ${
        axis === "y" ? `${from}%` : "0"
      }, 0);`
    );
    lines.push("  will-change: transform;");
  } else {
    lines.push("  will-change: opacity;");
  }
  lines.push("}");
  return lines.join("\n");
}

/**
 * GSAP timeline statements for a transition overlay. The cut belongs at
 * start + (end - start) / 2; the overlay reaches full cover at that midpoint.
 *
 * @param {object} element Transition plan element.
 * @param {string} selector Overlay selector.
 * @param {object} [options]
 * @returns {string} GSAP statements.
 */
export function hyperframesTransitionTween(element, selector, options = {}) {
  const transition = normalizeTransition(element, options);
  const target = requireSelector(selector, "hyperframesTransitionTween");
  const tl = timelineName(options);
  const selected = JSON.stringify(target);
  const half = transition.duration / 2;
  const lines = [];

  if (options.comment !== false) {
    lines.push(
      `/* ${transition.kind}${
        transition.slide ? `-${transition.direction}` : ""
      } transition ${fixed(transition.start)}-${fixed(transition.end)}s */`
    );
  }

  if (transition.slide) {
    const { axis, from, to } = transition.slide;
    lines.push(
      `${tl}.set(${selected}, { ${
        axis === "x" ? `xPercent: ${from}, yPercent: 0` : `xPercent: 0, yPercent: ${from}`
      }, opacity: 1 }, ${fixed(transition.start)});`
    );
    lines.push(
      `${tl}.to(${selected}, { xPercent: 0, yPercent: 0, duration: ${fixed(
        half
      )}, ease: ${JSON.stringify(transition.easeIn)} }, ${fixed(transition.start)});`
    );
    lines.push(
      `${tl}.to(${selected}, { ${
        axis === "x" ? `xPercent: ${to}, yPercent: 0` : `xPercent: 0, yPercent: ${to}`
      }, duration: ${fixed(half)}, ease: ${JSON.stringify(transition.easeOut)} }, ${fixed(
        transition.mid
      )});`
    );
  } else {
    lines.push(`${tl}.set(${selected}, { opacity: 0 }, ${fixed(transition.start)});`);
    lines.push(
      `${tl}.to(${selected}, { opacity: ${rounded(transition.peak)}, duration: ${fixed(
        half
      )}, ease: ${JSON.stringify(transition.easeIn)} }, ${fixed(transition.start)});`
    );
    lines.push(
      `${tl}.to(${selected}, { opacity: 0, duration: ${fixed(half)}, ease: ${JSON.stringify(
        transition.easeOut
      )} }, ${fixed(transition.mid)});`
    );
  }
  return lines.join("\n");
}

/**
 * Bundle markup, CSS, and GSAP statements for one transition overlay.
 *
 * @param {object} element Transition plan element.
 * @param {object} [theme]
 * @param {object} [options] id, selector, trackIndex, zIndex, ...
 * @returns {{id: string, selector: string, html: string, css: string, tween: string, values: object}}
 */
export function hyperframesTransition(element, theme = {}, options = {}) {
  const id = transitionElementId(element, options);
  const resolved = { ...options, id };
  const selector =
    typeof options.selector === "string" && options.selector.trim()
      ? options.selector.trim()
      : `#${id}`;

  return {
    id,
    selector,
    html: hyperframesTransitionHtml(element, theme, resolved),
    css: hyperframesTransitionCss(element, selector, theme, resolved),
    tween: hyperframesTransitionTween(element, selector, resolved),
    values: normalizeTransition(element, resolved),
  };
}
