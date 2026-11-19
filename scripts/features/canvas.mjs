/**
 * Canvas scenes.
 *
 * A canvas is ONE composition that owns a persistent backdrop, a set of cards
 * placed in board coordinates, optional annotations drawn on top of a card, and
 * a camera path between them. It exists because a continuous camera move cannot
 * live inside a list of independent element clips: every cut would restart the
 * animation.
 *
 * The grammar (easing, tempo, card frame, type scale) comes from a preset, never
 * from this file. A channel swaps `templates/scenes/<name>.json` or
 * `channels/<channel>/style/scenes/<name>.json` and gets a different film from
 * the same scene data.
 *
 * Everything here is pure: no filesystem, no processes. The CLI resolves the
 * preset file and calls these builders.
 */

export const CANVAS_TYPE = "canvas";
export const CANVAS_TEMPLATE = "canvas";
export const CANVAS_PRESET_SCHEMA = "rooster.canvas/v1";

const CARD_STYLES = new Set(["photo", "document", "object", "screen", "icon", "year", "statement", "label"]);
const ENTERS = new Set(["settle", "rise", "fade", "slide"]);
const FRAMES = new Set(["none", "print", "glass", "line"]);
const BACKDROPS = new Set(["solid", "grid", "paper", "map", "image"]);
const ANNOTATIONS = new Set(["ellipse", "box", "label", "underline"]);
const ORDERS = new Set(["index", "reverse", "reading"]);

export const CANVAS_DEFAULTS = {
  schema: CANVAS_PRESET_SCHEMA,
  id: "neutral",
  name: "Neutral",
  description: "Plain canvas: dark stage, no frame, no texture.",
  backdrop: {
    kind: "solid",
    color: null,
    image: null,
    vignette: 0.28,
    grain: 0.0,
    drift: 0.012,
    grid: 84,
  },
  piece: {
    frame: "none",
    radius: 6,
    shadow: 0.18,
    border: 1.2,
    padding: 10,
    rotateJitter: 0,
    paper: "#f2ede0",
    tilt: [0, 0],
    glow: 0,
  },
  type: {
    display: null,
    mono: null,
    yearSize: 140,
    statementSize: 92,
    labelSize: 26,
    uppercase: false,
    tracking: 0,
  },
  accent: null,
  muted: null,
  animation: {
    mode: "settle",
    order: "index",
    direction: "left-to-right",
    stagger: 0,
    enter: "settle",
    ease: "power2.out",
    duration: 0.7,
  },
  tempo: { hold: 2.4, travel: 1.2, fadeOut: 0.28 },
  camera: { ease: "power3.inOut" },
  texture: "none",
};

const NUMBER_LIMITS = {
  "backdrop.vignette": [0, 1],
  "backdrop.grain": [0, 1],
  "backdrop.drift": [0, 0.2],
  "backdrop.grid": [16, 400],
  "piece.radius": [0, 120],
  "piece.shadow": [0, 1],
  "piece.border": [0, 12],
  "piece.padding": [0, 120],
  "piece.rotateJitter": [0, 8],
  "piece.glow": [0, 1],
  "type.yearSize": [24, 400],
  "type.statementSize": [24, 400],
  "type.labelSize": [10, 80],
  "type.tracking": [-0.1, 0.4],
  "animation.stagger": [0, 2],
  "animation.duration": [0.05, 4],
  "tempo.hold": [0, 20],
  "tempo.travel": [0.1, 20],
  "tempo.fadeOut": [0, 2],
};

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mergeDeep(base, patch) {
  if (!isObject(base)) return isObject(patch) ? mergeDeep({}, patch) : patch;
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!isObject(patch)) return out;
  for (const [key, value] of Object.entries(patch)) {
    if (isObject(value) && isObject(out[key])) out[key] = mergeDeep(out[key], value);
    else if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Merge a preset file over the neutral defaults and clamp the numeric tokens.
 *
 * @param {object|null} input
 * @returns {object} normalized preset
 */
export function normalizeCanvasPreset(input) {
  const preset = mergeDeep(CANVAS_DEFAULTS, isObject(input) ? input : {});
  preset.schema = CANVAS_PRESET_SCHEMA;
  preset.id = String(preset.id || "neutral");
  preset.name = String(preset.name || preset.id);
  preset.description = String(preset.description || "");
  preset.backdrop = mergeDeep(CANVAS_DEFAULTS.backdrop, preset.backdrop || {});
  preset.piece = mergeDeep(CANVAS_DEFAULTS.piece, preset.piece || {});
  preset.type = mergeDeep(CANVAS_DEFAULTS.type, preset.type || {});
  preset.animation = mergeDeep(CANVAS_DEFAULTS.animation, preset.animation || {});
  preset.tempo = mergeDeep(CANVAS_DEFAULTS.tempo, preset.tempo || {});
  preset.camera = mergeDeep(CANVAS_DEFAULTS.camera, preset.camera || {});

  for (const [path, [min, max]] of Object.entries(NUMBER_LIMITS)) {
    const [group, key] = path.split(".");
    preset[group][key] = clamp(num(preset[group][key], CANVAS_DEFAULTS[group][key]), min, max);
  }

  preset.backdrop.kind = BACKDROPS.has(String(preset.backdrop.kind)) ? String(preset.backdrop.kind) : "solid";
  preset.piece.frame = FRAMES.has(String(preset.piece.frame)) ? String(preset.piece.frame) : "none";
  preset.animation.enter = ENTERS.has(String(preset.animation.enter)) ? String(preset.animation.enter) : "settle";
  preset.animation.order = ORDERS.has(String(preset.animation.order)) ? String(preset.animation.order) : "index";
  preset.animation.mode = ["settle", "wave", "follow"].includes(String(preset.animation.mode))
    ? String(preset.animation.mode)
    : "settle";
  preset.type.uppercase = Boolean(preset.type.uppercase);
  preset.texture = String(preset.texture || "none");
  return preset;
}

/**
 * Inline CSS custom properties for one canvas element. Numbers are expressed in
 * `--u` units (1px at 1080p short side), so the same preset holds up in 9:16.
 *
 * @param {object} preset normalized preset
 * @param {object} theme theme from the channel profile
 * @returns {string} style attribute value
 */
export function canvasStyleVars(preset, theme = {}) {
  const accent = preset.accent || theme.accent || "#22d3ee";
  const muted = preset.muted || theme.muted || "#94a3b8";
  const display = fontStack(preset.type.display || theme.display, "sans-serif");
  const mono = fontStack(preset.type.mono || theme.mono, "monospace");
  const bg = preset.backdrop.color || theme.bg || "#0b0f19";
  const fg = theme.fg || "#f8fafc";
  const unit = (value) => `calc(${Number(value).toFixed(2)} * var(--u))`;
  return [
    `--cv-bg:${bg}`,
    `--cv-fg:${fg}`,
    `--cv-muted:${muted}`,
    `--cv-accent:${accent}`,
    `--cv-paper:${preset.piece.paper}`,
    `--cv-radius:${unit(preset.piece.radius)}`,
    `--cv-border:${unit(preset.piece.border)}`,
    `--cv-pad:${unit(preset.piece.padding)}`,
    `--cv-shadow:${preset.piece.shadow.toFixed(2)}`,
    `--cv-grain:${preset.backdrop.grain.toFixed(3)}`,
    `--cv-vignette:${preset.backdrop.vignette.toFixed(3)}`,
    `--cv-grid:${unit(preset.backdrop.grid)}`,
    `--cv-year:${unit(preset.type.yearSize)}`,
    `--cv-statement:${unit(preset.type.statementSize)}`,
    `--cv-label:${unit(preset.type.labelSize)}`,
    `--cv-display:${display}`,
    `--cv-mono:${mono}`,
  ].join(";");
}

/**
 * A preset may give a full stack ("Inter, system-ui, sans-serif") or a single
 * family name; both become a usable `font-family` value.
 *
 * @param {string|undefined} value
 * @param {string} fallback
 * @returns {string}
 */
export function fontStack(value, fallback = "sans-serif") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (text.includes(",")) return text;
  return `"${text}", ${fallback}`;
}

/**
 * Static CSS for every canvas. All look values arrive through the custom
 * properties set by `canvasStyleVars`, so one stylesheet serves every preset.
 *
 * @returns {string}
 */
export function canvasCss() {
  return `
      /* Canvas: a persistent backdrop with cards and a camera path. */
      .fx-canvas { z-index: 1; overflow: hidden; }
      .fx-canvas .cv-stage { position: absolute; inset: 0; overflow: hidden; background: var(--cv-bg); }
      .fx-canvas .cv-backdrop {
        position: absolute; inset: -5%; background-position: center; background-size: cover;
        will-change: transform;
      }
      .fx-canvas[data-backdrop="solid"] .cv-backdrop {
        background-image:
          radial-gradient(ellipse 60% 45% at 28% 18%, color-mix(in srgb, var(--cv-accent) 14%, transparent), transparent 70%),
          radial-gradient(ellipse 55% 50% at 78% 85%, color-mix(in srgb, #7c5cff 10%, transparent), transparent 70%),
          radial-gradient(ellipse 120% 90% at 50% 50%, transparent 55%, rgba(0, 0, 0, 0.5) 100%);
      }
      .fx-canvas[data-backdrop="grid"] .cv-backdrop {
        background-image:
          linear-gradient(to right, color-mix(in srgb, var(--cv-fg) 9%, transparent) 1px, transparent 1px),
          linear-gradient(to bottom, color-mix(in srgb, var(--cv-fg) 9%, transparent) 1px, transparent 1px);
        background-size: var(--cv-grid) var(--cv-grid);
      }
      .fx-canvas[data-backdrop="paper"] .cv-backdrop {
        background-image:
          radial-gradient(circle at 18% 22%, rgba(255, 255, 255, 0.06), transparent 42%),
          radial-gradient(circle at 82% 78%, rgba(0, 0, 0, 0.22), transparent 48%),
          linear-gradient(135deg, #1b1a17, #0c0b0a 70%);
      }
      .fx-canvas[data-backdrop="map"] .cv-backdrop,
      .fx-canvas[data-backdrop="image"] .cv-backdrop {
        background-image: var(--cv-bg-image, none);
        opacity: 0.55;
        filter: saturate(0.7) contrast(1.05);
      }
      .fx-canvas .cv-vignette {
        position: absolute; inset: 0; pointer-events: none;
        background: radial-gradient(ellipse at 50% 48%, transparent 38%, rgba(0, 0, 0, var(--cv-vignette)) 100%);
      }
      .fx-canvas .cv-grain {
        position: absolute; inset: 0; pointer-events: none; opacity: var(--cv-grain);
        mix-blend-mode: overlay;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
      }
      .fx-canvas .cv-camera { position: absolute; inset: 0; transform-origin: 50% 50%; }
      .fx-canvas .cv-depth {
        position: absolute; inset: 0;
        filter: blur(calc((1 - var(--cv-depth, 0.7)) * 1.6 * var(--u)));
        opacity: calc(0.78 + var(--cv-depth, 0.7) * 0.22);
      }
      .fx-canvas .cv-item { position: absolute; container-type: size; perspective: calc(1400 * var(--u)); }
      .fx-canvas .cv-piece {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        transform: rotateX(var(--cv-tilt-x, 0deg)) rotateY(var(--cv-tilt-y, 0deg)) rotate(var(--cv-rot, 0deg));
        transform-style: preserve-3d;
      }
      .fx-canvas .cv-item[data-glow="true"] .cv-paper {
        box-shadow:
          0 0 calc(24 * var(--u)) color-mix(in srgb, var(--cv-accent) 55%, transparent),
          0 0 calc(90 * var(--u)) color-mix(in srgb, var(--cv-accent) 22%, transparent),
          0 calc(30 * var(--u)) calc(70 * var(--u)) rgba(0, 0, 0, 0.6),
          inset 0 1px 0 rgba(255, 255, 255, 0.14);
      }
      .fx-canvas .cv-screen .cv-paper {
        background: linear-gradient(180deg, #0d131c 0%, #090d13 100%);
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: calc(16 * var(--u));
        overflow: hidden;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.12),
          inset 0 0 calc(60 * var(--u)) rgba(0, 0, 0, 0.55);
      }
      .fx-canvas .cv-screen .cv-paper::before {
        content: ""; position: absolute; inset: 0 0 auto 0; height: calc(30 * var(--u)); z-index: 2;
        background: linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.015) 60%, transparent);
        border-bottom: 1px solid rgba(255, 255, 255, 0.09);
        pointer-events: none;
      }
      .fx-canvas .cv-screen .cv-paper::after {
        content: ""; position: absolute; left: calc(12 * var(--u)); top: calc(9 * var(--u));
        width: calc(8 * var(--u)); height: calc(8 * var(--u)); border-radius: 50%;
        background: #ff5f57;
        box-shadow: calc(14 * var(--u)) 0 0 #febc2e, calc(28 * var(--u)) 0 0 #28c840;
      }
      .fx-canvas .cv-screen .cv-media { object-fit: cover; padding-top: calc(26 * var(--u)); }
      .fx-canvas .cv-icon .cv-paper {
        display: flex; align-items: center; justify-content: center;
        background: linear-gradient(160deg, color-mix(in srgb, var(--cv-accent) 26%, #0f131a), #0c0f15);
        border: 1px solid color-mix(in srgb, var(--cv-accent) 48%, transparent);
        border-radius: calc(20 * var(--u));
        box-shadow: 0 0 calc(38 * var(--u)) color-mix(in srgb, var(--cv-accent) 30%, transparent);
      }
      .fx-canvas .cv-icon .cv-glyph {
        font-family: var(--cv-display); font-weight: 700;
        font-size: calc(64 * var(--u)); letter-spacing: -0.02em; color: var(--cv-fg);
      }
      .fx-canvas .cv-links { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
      .fx-canvas .cv-link {
        fill: none; stroke: var(--cv-accent); stroke-width: 1.4;
        vector-effect: non-scaling-stroke; opacity: 0.62; stroke-linecap: round;
      }
      .fx-canvas .cv-paper { position: relative; width: 100%; height: 100%; overflow: hidden; }
      .fx-canvas[data-frame="print"] .cv-paper {
        background: var(--cv-paper);
        border-radius: var(--cv-radius);
        padding: var(--cv-pad);
        box-shadow: 0 calc(22 * var(--u)) calc(56 * var(--u)) rgba(0, 0, 0, calc(var(--cv-shadow) * 1.6)),
          0 calc(2 * var(--u)) calc(6 * var(--u)) rgba(0, 0, 0, 0.28);
      }
      .fx-canvas[data-frame="glass"] .cv-paper {
        background: rgba(12, 16, 22, 0.72);
        border: var(--cv-border) solid color-mix(in srgb, var(--cv-accent) 40%, transparent);
        border-radius: var(--cv-radius);
        backdrop-filter: blur(calc(10 * var(--u)));
        box-shadow: 0 calc(20 * var(--u)) calc(50 * var(--u)) rgba(0, 0, 0, calc(var(--cv-shadow) * 1.8));
      }
      .fx-canvas[data-frame="line"] .cv-paper {
        border: var(--cv-border) solid color-mix(in srgb, var(--cv-fg) 26%, transparent);
        border-radius: var(--cv-radius);
      }
      .fx-canvas .cv-media { display: block; width: 100%; height: 100%; }
      .fx-canvas .cv-photo .cv-media { object-fit: cover; }
      .fx-canvas .cv-document .cv-paper { padding: calc(var(--cv-pad) * 0.6); }
      .fx-canvas .cv-document .cv-media { object-fit: contain; }
      .fx-canvas .cv-object .cv-media { object-fit: contain; }
      .fx-canvas .cv-year, .fx-canvas .cv-statement, .fx-canvas .cv-label {
        font-family: var(--cv-display); color: var(--cv-fg); text-align: center;
        line-height: 1.02; overflow-wrap: break-word;
      }
      .fx-canvas .cv-copy { max-width: 100%; }
      .fx-canvas .cv-year {
        font-size: min(var(--cv-year), 74cqh); font-weight: 300;
        letter-spacing: calc(0.04em + var(--cv-tracking, 0em));
        text-shadow: 0 0 calc(30 * var(--u)) color-mix(in srgb, var(--cv-fg) 35%, transparent);
      }
      .fx-canvas .cv-statement {
        font-size: min(var(--cv-statement), 58cqh); font-weight: 600;
        letter-spacing: calc(-0.02em + var(--cv-tracking, 0em));
      }
      .fx-canvas[data-uppercase="true"] .cv-statement { text-transform: uppercase; }
      .fx-canvas .cv-label {
        font-family: var(--cv-mono); font-size: var(--cv-label); font-weight: 600;
        letter-spacing: 0.1em; text-transform: uppercase; color: var(--cv-muted);
        background: color-mix(in srgb, var(--cv-bg) 72%, transparent);
        border: 1px solid color-mix(in srgb, var(--cv-fg) 16%, transparent);
        border-radius: 999px;
        padding: calc(7 * var(--u)) calc(16 * var(--u));
        backdrop-filter: blur(calc(6 * var(--u)));
      }
      .fx-canvas .cv-copy { display: flex; flex-direction: column; align-items: center; justify-content: center; }
      .fx-canvas .cv-piece .cv-paper { display: flex; align-items: center; justify-content: center; }
      .fx-canvas .cv-sub {
        display: block; margin-top: calc(14 * var(--u));
        font-family: var(--cv-mono); font-size: calc(26 * var(--u));
        letter-spacing: 0.1em; text-transform: uppercase; color: var(--cv-muted);
      }
      .fx-canvas .cv-annot { position: absolute; inset: -8%; pointer-events: none; }
      .fx-canvas .cv-annot svg { width: 100%; height: 100%; overflow: visible; }
      .fx-canvas .cv-annot .cv-stroke {
        fill: none; stroke: var(--cv-accent); stroke-width: 3; vector-effect: non-scaling-stroke;
        stroke-linecap: round; stroke-linejoin: round;
      }
      .fx-canvas .cv-annot-label {
        position: absolute; left: 0; top: 0; transform: translateY(-115%);
        display: inline-flex; align-items: center; gap: calc(6 * var(--u));
        padding: calc(5 * var(--u)) calc(12 * var(--u)); border-radius: 999px;
        background: var(--cv-accent); color: #fff;
        font-family: var(--cv-mono); font-size: var(--cv-label); letter-spacing: 0.08em;
        text-transform: uppercase; white-space: nowrap;
      }
      .fx-canvas .cv-annot-underline {
        position: absolute; left: 0; right: 0; bottom: -6%;
        height: calc(4 * var(--u)); background: var(--cv-accent); transform-origin: left center;
      }
  `;
}

function cardId(card, index) {
  const id = String(card?.id || "").trim();
  return id || `card-${index + 1}`;
}

function resolveBox(canvas, ref) {
  if (!ref) return null;
  if (Array.isArray(ref)) {
    const boxes = ref.map((item) => resolveBox(canvas, item)).filter(Boolean);
    if (!boxes.length) return null;
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  if (typeof ref === "object") {
    const at = Array.isArray(ref.at) ? ref.at : null;
    const size = Array.isArray(ref.size) ? ref.size : null;
    if (!at) return null;
    return {
      x: num(at[0], 0),
      y: num(at[1], 0),
      w: size ? num(size[0], 30) : num(ref.w, 30),
      h: size ? num(size[1], 30) : num(ref.h, 30),
    };
  }
  const key = String(ref);
  const card = canvas.cards.find((item) => item.id === key);
  if (card) return { x: card.x, y: card.y, w: card.w, h: card.h };
  const slot = canvas.slots.find((item) => item.id === key);
  if (slot) return { x: slot.x, y: slot.y, w: slot.w, h: slot.h };
  return null;
}

function normalizeRect(source, fallback) {
  const at = Array.isArray(source?.at) ? source.at : null;
  const size = Array.isArray(source?.size) ? source.size : null;
  const x = num(at ? at[0] : source?.x, fallback.x);
  const y = num(at ? at[1] : source?.y, fallback.y);
  const w = num(size ? size[0] : source?.w, fallback.w);
  const h = num(size ? size[1] : source?.h, fallback.h);
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
}

/**
 * Deterministic rotation jitter: the same card id always leans the same way, so
 * a rebuild does not reshuffle the board.
 *
 * @param {string} id
 * @returns {number} -1..1
 */
export function canvasJitter(id) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 2000) / 1000 - 1;
}

/**
 * Normalize a plan element into a canvas description and collect problems.
 *
 * Cards use `at`/`size` in frame percentages, or a named slot. Times are local
 * to the scene (`from`/`to` in seconds from the scene start), so moving the
 * scene does not rewrite every card.
 *
 * @param {object} element plan element
 * @param {object|null} preset normalized preset
 * @returns {{canvas:object, errors:string[], warnings:string[]}}
 */
export function normalizeCanvas(element, preset = null) {
  const errors = [];
  const warnings = [];
  const data = isObject(element?.data) ? element.data : {};
  const resolvedPreset = preset ? normalizeCanvasPreset(preset) : normalizeCanvasPreset({});
  const start = num(element?.start, 0);
  const end = num(element?.end, start + 1);
  const duration = Math.max(0.1, end - start);

  const slots = [];
  const seenSlots = new Set();
  for (const [index, slot] of (Array.isArray(data.slots) ? data.slots : []).entries()) {
    const id = String(slot?.id || "").trim() || `slot-${index + 1}`;
    if (seenSlots.has(id)) errors.push(`slot "${id}" is duplicated`);
    seenSlots.add(id);
    slots.push({ id, ...normalizeRect(slot, { x: 0, y: 0, w: 30, h: 30 }) });
  }

  const cards = [];
  const seenCards = new Set();
  const rawCards = Array.isArray(data.cards) ? data.cards : [];
  if (!rawCards.length) errors.push('canvas: "cards" is empty; a canvas needs at least one card');
  if (rawCards.length > 24) warnings.push(`canvas: ${rawCards.length} cards is a lot for one camera path`);

  for (const [index, card] of rawCards.entries()) {
    const id = cardId(card, index);
    if (seenCards.has(id)) {
      errors.push(`card id "${id}" is duplicated`);
      continue;
    }
    seenCards.add(id);
    const style = CARD_STYLES.has(String(card?.style)) ? String(card.style) : card?.src ? "photo" : "statement";
    const slot = card?.slot ? slots.find((item) => item.id === String(card.slot)) : null;
    if (card?.slot && !slot) errors.push(`card "${id}" points to unknown slot "${card.slot}"`);
    const base = slot ? { x: slot.x, y: slot.y, w: slot.w, h: slot.h } : { x: 30, y: 30, w: 30, h: 30 };
    const rect = normalizeRect(card, base);
    if (rect.x + rect.w < -120 || rect.y + rect.h < -120 || rect.x > 260 || rect.y > 260) {
      warnings.push(`card "${id}" sits far outside the board (${rect.x}, ${rect.y}); it will never be framed`);
    }
    if (!card?.src && !card?.text) errors.push(`card "${id}" needs "src" or "text"`);
    const from = clamp(num(card?.from, 0), 0, duration);
    const to = clamp(num(card?.to, duration), 0, duration);
    if (to <= from) errors.push(`card "${id}" ends before it starts (${from} >= ${to})`);
    const enter = ENTERS.has(String(card?.enter)) ? String(card.enter) : resolvedPreset.animation.enter;
    cards.push({
      id,
      style,
      src: card?.src ? String(card.src) : null,
      text: card?.text ? String(card.text) : "",
      sub: card?.sub ? String(card.sub) : "",
      from,
      to,
      enter,
      stagger: card?.stagger !== false,
      rotate: style === "year" || style === "statement" || style === "label" ? 0 : canvasJitter(id) * resolvedPreset.piece.rotateJitter,
      paper: card?.paper === undefined ? style === "label" : Boolean(card.paper),
      depth: clamp(num(card?.depth, 0.7), 0, 1),
      tilt: [
        clamp(num(Array.isArray(card?.tilt) ? card.tilt[0] : card?.tiltX, resolvedPreset.piece.tilt[0]), -28, 28),
        clamp(num(Array.isArray(card?.tilt) ? card.tilt[1] : card?.tiltY, resolvedPreset.piece.tilt[1]), -32, 32),
      ],
      glow: clamp(num(card?.glow, resolvedPreset.piece.glow), 0, 1),
      glyph: card?.glyph ? String(card.glyph) : "",
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      annotations: [],
    });
  }

  for (const [index, annotation] of (Array.isArray(data.annotations) ? data.annotations : []).entries()) {
    const kind = ANNOTATIONS.has(String(annotation?.kind)) ? String(annotation.kind) : "ellipse";
    const targetId = String(annotation?.target || "");
    const target = cards.find((card) => card.id === targetId);
    if (!target) {
      errors.push(`annotation ${index + 1} targets unknown card "${targetId || "(missing)"}"`);
      continue;
    }
    const from = clamp(num(annotation?.from, target.from), 0, duration);
    const to = clamp(num(annotation?.to, target.to), from + 0.1, duration);
    target.annotations.push({
      kind,
      text: annotation?.text ? String(annotation.text) : "",
      from,
      to,
      draw: clamp(num(annotation?.draw, 0.55), 0.1, 3),
    });
  }

  const rawCamera = Array.isArray(data.camera) && data.camera.length ? data.camera : [{ at: 0, frame: cards.map((card) => card.id), zoom: 1 }];
  const camera = [];
  for (const [index, keyframe] of rawCamera.entries()) {
    const focus = keyframe?.focus ?? null;
    const frame = keyframe?.frame ?? null;
    const at = clamp(num(keyframe?.at, index === 0 ? 0 : duration), 0, duration);
    if (focus && !resolveBox({ cards, slots }, focus)) errors.push(`camera ${index + 1} focuses on unknown card "${focus}"`);
    if (frame && !resolveBox({ cards, slots }, frame)) errors.push(`camera ${index + 1} frames unknown target "${JSON.stringify(frame)}"`);
    camera.push({
      at,
      focus,
      frame,
      zoom: clamp(num(keyframe?.zoom, 1), 0.4, 4),
      rotate: clamp(num(keyframe?.rotate, 0), -12, 12),
      ease: String(keyframe?.ease || resolvedPreset.camera.ease),
      hold: Math.max(0, num(keyframe?.hold, 0)),
    });
  }
  camera.sort((a, b) => a.at - b.at);

  const links = [];
  for (const link of Array.isArray(data.links) ? data.links : []) {
    const from = cards.find((card) => card.id === String(link?.from || ""));
    const to = cards.find((card) => card.id === String(link?.to || ""));
    if (!from || !to) {
      warnings.push(`link targets an unknown card (${link?.from || "?"} -> ${link?.to || "?"})`);
      continue;
    }
    // Auto anchors: exit the bottom edge and enter the top edge when the cards
    // are stacked, exit the right edge and enter the left edge when they are
    // side by side. A line through a title looks like a defect.
    const vertical =
      Math.abs(to.y + to.h / 2 - (from.y + from.h / 2)) >=
      Math.abs(to.x + to.w / 2 - (from.x + from.w / 2));
    links.push({
      from: from.id,
      to: to.id,
      x1: Number((vertical ? from.x + from.w / 2 : from.x + from.w).toFixed(2)),
      y1: Number((vertical ? from.y + from.h : from.y + from.h / 2).toFixed(2)),
      x2: Number((vertical ? to.x + to.w / 2 : to.x).toFixed(2)),
      y2: Number((vertical ? to.y : to.y + to.h / 2).toFixed(2)),
      curve: clamp(num(link?.curve, 0.18), -1, 1),
      at: clamp(num(link?.at, 0), 0, duration),
      draw: clamp(num(link?.draw, 0.7), 0.1, 4),
    });
  }

  const animation = mergeDeep(resolvedPreset.animation, isObject(data.animation) ? data.animation : {});
  const canvas = {
    preset: resolvedPreset,
    duration,
    start,
    end,
    slots,
    cards,
    links,
    camera,
    animation: {
      mode: ["settle", "wave", "follow"].includes(String(animation.mode)) ? String(animation.mode) : "settle",
      order: ORDERS.has(String(animation.order)) ? String(animation.order) : "index",
      direction: String(animation.direction || "left-to-right"),
      stagger: clamp(num(animation.stagger, 0), 0, 2),
      enter: ENTERS.has(String(animation.enter)) ? String(animation.enter) : "settle",
      ease: String(animation.ease || "power2.out"),
      duration: clamp(num(animation.duration, 0.7), 0.05, 4),
    },
    tempo: resolvedPreset.tempo,
    backdrop: resolvedPreset.backdrop,
    backdropInline: themeBackdropInline(resolvedPreset, data.backdrop),
  };
  return { canvas, errors, warnings };
}

function themeBackdropInline(preset, override) {
  const source = isObject(override) ? override : {};
  const image = source.image || source.src || preset.backdrop.image || null;
  let kind = BACKDROPS.has(String(source.kind)) ? String(source.kind) : preset.backdrop.kind;
  // A map or an image backdrop without a file would render as a flat rectangle;
  // fall back to the grid so the scene keeps its depth cue.
  if ((kind === "map" || kind === "image") && !image) kind = "grid";
  return { image: image ? String(image) : null, kind };
}

/**
 * Resolve the camera path into percent transforms.
 *
 * A point at `cx` percent of the frame sits `(cx - 50)` percent away from the
 * centre. Scaling by `z` multiplies that offset, so the translate that brings it
 * back to the centre is `(50 - cx) * z`, in percent of the element size — which
 * is exactly what GSAP's `xPercent`/`yPercent` expect.
 *
 * @param {object} canvas normalized canvas
 * @returns {Array<{t:number,xPercent:number,yPercent:number,scale:number,ease:string,hold:number}>}
 */
export function canvasCameraKeyframes(canvas) {
  const stage = { cards: canvas.cards, slots: canvas.slots };
  return canvas.camera.map((keyframe) => {
    const target = keyframe.focus || keyframe.frame || canvas.cards.map((card) => card.id);
    const box = resolveBox(stage, target) || { x: 0, y: 0, w: 100, h: 100 };
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const zoom = keyframe.zoom;
    return {
      t: keyframe.at,
      xPercent: Number(((50 - cx) * zoom).toFixed(3)),
      yPercent: Number(((50 - cy) * zoom).toFixed(3)),
      scale: Number(zoom.toFixed(3)),
      rotate: Number((keyframe.rotate || 0).toFixed(2)),
      ease: keyframe.ease || canvas.preset.camera.ease,
      hold: keyframe.hold,
    };
  });
}

/**
 * Entrance offsets for the wave choreography. `wave` staggers by reading order
 * so a row of cards enters left to right; `follow` staggers by the camera stops;
 * `settle` keeps the declared times.
 *
 * @param {object} canvas normalized canvas
 * @returns {Array<object>} cards with a resolved `enterAt`
 */
export function canvasCardTimes(canvas) {
  const cards = [...canvas.cards];
  let order = cards.map((card, index) => ({ card, index }));
  if (canvas.animation.order === "reverse") order = order.reverse();
  if (canvas.animation.order === "reading") {
    order = order.sort((a, b) => a.card.y - b.card.y || a.card.x - b.card.x);
  }
  const offsets = new Map();
  order.forEach((entry, position) => {
    const steps = canvas.animation.mode === "wave" ? position : 0;
    const offset = canvas.animation.mode === "settle" ? 0 : steps * canvas.animation.stagger;
    offsets.set(entry.card.id, entry.card.stagger ? offset : 0);
  });
  return cards.map((card) => ({ ...card, enterAt: clamp(card.from + (offsets.get(card.id) || 0), 0, canvas.duration) }));
}

/**
 * Fit a short line of display copy inside its card.
 *
 * CSS can cap a font by the container height, but not by how many lines the
 * words will take. This estimates the wrap with an average advance width and
 * shrinks the size until the block fits, so a title never spills out of the
 * board. The result is expressed in `--u` units, which keeps it resolution
 * independent.
 *
 * @param {string} text
 * @param {{w:number,h:number}} box percentages of the frame
 * @param {number} baseSize design px
 * @param {{uppercase?:boolean}} [options]
 * @returns {number} design px
 */
export function fitTextSize(text, box, baseSize, options = {}) {
  const words = String(text || "")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return baseSize;
  // The estimate assumes a 16:9 frame; a different aspect only changes how
  // conservative the result is, never whether it fits vertically.
  const boxWidth = (Math.max(1, box.w) / 100) * 1920;
  const boxHeight = (Math.max(1, box.h) / 100) * 1080;
  const advance = (word) => {
    let units = 0;
    for (const char of word) {
      if (/[A-ZÀ-Þ]/.test(char)) units += 0.82;
      else if (/[a-zà-þ]/.test(char)) units += 0.52;
      else if (/[0-9]/.test(char)) units += 0.62;
      else if (char === "'" || char === "’" || char === "." || char === ",") units += 0.3;
      else units += 0.42;
    }
    return units;
  };
  const lineHeight = 1.06;
  let size = baseSize;

  for (let attempt = 0; attempt < 24; attempt += 1) {
    let lines = 1;
    let lineWidth = 0;
    let widest = 0;
    for (const word of words) {
      const width = advance(word) * size;
      widest = Math.max(widest, width);
      const candidate = lineWidth === 0 ? width : lineWidth + size * 0.3 + width;
      if (candidate > boxWidth && lineWidth > 0) {
        lines += 1;
        lineWidth = width;
      } else {
        lineWidth = candidate;
      }
    }
    const fits = widest <= boxWidth && lines * lineHeight * size <= boxHeight;
    if (fits) break;
    size *= 0.94;
  }
  return Math.max(18, Math.round(size * 10) / 10);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function annotationHtml(annotation, cardIdValue) {
  const dataAttr = `data-annot="${escapeHtml(cardIdValue)}"`;
  if (annotation.kind === "label") {
    return `<div class="cv-annot" ${dataAttr}><span class="cv-annot-label">${escapeHtml(annotation.text)}</span></div>`;
  }
  if (annotation.kind === "underline") {
    return `<div class="cv-annot" ${dataAttr}><span class="cv-annot-underline"></span></div>`;
  }
  const shape =
    annotation.kind === "box"
      ? `<rect class="cv-stroke" x="4" y="4" width="92" height="92" rx="4" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" />`
      : `<ellipse class="cv-stroke" cx="50" cy="50" rx="47" ry="46" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" />`;
  return `<div class="cv-annot" ${dataAttr}><svg viewBox="0 0 100 100" preserveAspectRatio="none">${shape}</svg></div>`;
}

function cardHtml(card, preset) {
  const style = [
    `left:${card.x}%`,
    `top:${card.y}%`,
    `width:${card.w}%`,
    `height:${card.h}%`,
    `--cv-rot:${card.rotate.toFixed(2)}deg`,
    `--cv-tilt-x:${card.tilt[0].toFixed(2)}deg`,
    `--cv-tilt-y:${card.tilt[1].toFixed(2)}deg`,
  ].join(";");
  const annotations = card.annotations.map((item) => annotationHtml(item, card.id)).join("");
  const selector = `data-card="${escapeHtml(card.id)}" data-glow="${card.glow > 0.05 ? "true" : "false"}"`;
  if (card.style === "icon") {
    return `<div class="cv-item cv-card" ${selector} style="${style}">
        <div class="cv-piece cv-icon"><div class="cv-paper"><span class="cv-glyph">${escapeHtml(card.glyph || card.text)}</span></div></div>${annotations}
      </div>`;
  }
  if (card.src) {
    return `<div class="cv-item cv-card" ${selector} style="${style}">
        <div class="cv-piece cv-${escapeHtml(card.style)}">
          <div class="cv-paper"><img class="cv-media" src="${escapeHtml(card.src)}" alt="" /></div>
        </div>${annotations}
      </div>`;
  }
  const base =
    card.style === "year" ? preset.type.yearSize : card.style === "label" ? preset.type.labelSize : preset.type.statementSize;
  const fitted = fitTextSize(card.text, { w: card.w, h: card.h }, base, { uppercase: preset.type.uppercase });
  const sizeVar = card.style === "year" ? "--cv-year" : card.style === "label" ? "--cv-label" : "--cv-statement";
  const content = card.sub
    ? `<div class="cv-copy"><span>${escapeHtml(card.text)}</span><span class="cv-sub">${escapeHtml(card.sub)}</span></div>`
    : `<div class="cv-copy"><span>${escapeHtml(card.text)}</span></div>`;
  const wrapped = card.paper ? `<div class="cv-paper">${content}</div>` : content;
  return `<div class="cv-item cv-card" ${selector} style="${style}">
      <div class="cv-piece cv-${escapeHtml(card.style)}" style="${sizeVar}:calc(${fitted} * var(--u))">${wrapped}</div>${annotations}
    </div>`;
}

/**
 * HTML for one canvas element. The caller supplies the `common()` wrapper so the
 * element keeps the same `data-start`/`data-duration`/track contract as every
 * other template.
 *
 * @param {(classes:string)=>string} common attribute builder from the adapter
 * @param {object} element plan element
 * @param {object} canvas normalized canvas
 * @returns {string}
 */
export function renderCanvasHtml(common, element, canvas, theme = {}) {
  const preset = canvas.preset;
  const vars = [
    canvasStyleVars(preset, theme),
    canvas.backdropInline.image
      ? `--cv-bg-image:url("${String(canvas.backdropInline.image).replace(/"/g, "%22")}")`
      : "--cv-bg-image:none",
    `--cv-tracking:${preset.type.tracking}em`,
  ].join(";");
  const groups = canvasDepthGroups(canvasCardTimes(canvas));
  const links = canvas.links
    .map((link) => {
      const dx = link.x2 - link.x1;
      const dy = link.y2 - link.y1;
      const cx = (link.x1 + link.x2) / 2 - dy * link.curve;
      const cy = (link.y1 + link.y2) / 2 + dx * link.curve;
      return `<path class="cv-link" data-link="${escapeHtml(link.from)}->${escapeHtml(link.to)}" d="M ${link.x1} ${link.y1} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${link.x2} ${link.y2}" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" />`;
    })
    .join("");
  const linkLayer = links
    ? `<svg class="cv-links" viewBox="0 0 100 100" preserveAspectRatio="none">${links}</svg>`
    : "";
  const layers = groups
    .map(
      (group) =>
        `<div class="cv-depth" data-depth="${group.depth.toFixed(2)}" style="--cv-depth:${group.depth.toFixed(2)}">${group.cards
          .map((card) => cardHtml(card, preset))
          .join("")}</div>`
    )
    .join("");
  return `<div ${common("cv-scene")} style="${vars}" data-backdrop="${escapeHtml(canvas.backdropInline.kind)}" data-frame="${escapeHtml(preset.piece.frame)}" data-uppercase="${preset.type.uppercase ? "true" : "false"}">
      <div class="cv-stage">
        <div class="cv-backdrop"></div>
        <div class="cv-camera">${linkLayer}${layers}</div>
        <div class="cv-vignette"></div>
        <div class="cv-grain"></div>
      </div>
    </div>`;
}

/**
 * Group cards by depth so a single full-frame layer can carry the parallax lag
 * and the depth-of-field blur. Far layers paint first, near layers on top.
 *
 * @param {Array<object>} cards
 * @returns {Array<{depth:number, cards:Array<object>}>}
 */
export function canvasDepthGroups(cards) {
  const buckets = new Map();
  for (const card of cards) {
    const depth = Math.round(clamp(Number(card.depth) || 0, 0, 1) * 20) / 20;
    if (!buckets.has(depth)) buckets.set(depth, []);
    buckets.get(depth).push(card);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, group]) => ({ depth, cards: group }));
}

/**
 * GSAP statements for one canvas element. Values are percentages, never pixels,
 * so the same scene works at any resolution or aspect.
 *
 * @param {object} element plan element
 * @param {number} index element index (used for the `#el-N` selector)
 * @param {object} canvas normalized canvas
 * @returns {string}
 */
export function canvasTween(element, index, canvas) {
  const root = `#el-${index}`;
  const total = canvas.duration;
  const lines = [];
  const frames = canvasCameraKeyframes(canvas);
  const first = frames[0] || { xPercent: 0, yPercent: 0, scale: 1, rotate: 0 };
  const camera = `${root} .cv-camera`;
  lines.push(`tl.set("${camera}", { transformOrigin: "50% 50%", filter: "blur(0px)" }, 0);`);
  lines.push(
    `tl.set("${camera}", { xPercent: ${first.xPercent}, yPercent: ${first.yPercent}, scale: ${first.scale}, rotation: ${first.rotate || 0} }, 0);`
  );

  const drift = Number(canvas.preset.backdrop.drift) || 0;
  if (drift > 0) {
    lines.push(
      `tl.fromTo("${root} .cv-backdrop", { scale: 1.04, xPercent: 0, yPercent: 0 }, { scale: ${(1.04 + drift).toFixed(3)}, xPercent: ${(drift * 160).toFixed(2)}, yPercent: ${(-drift * 90).toFixed(2)}, duration: ${total.toFixed(3)}, ease: "sine.inOut" }, 0);`
    );
  }

  // Depth layers lag behind the camera: far cards travel less, so the board
  // reads as a space instead of a flat poster.
  for (const group of canvasDepthGroups(canvasCardTimes(canvas))) {
    const lag = Number(((1 - group.depth) * 0.42).toFixed(3));
    if (lag <= 0) continue;
    const selector = `${root} .cv-depth[data-depth='${group.depth.toFixed(2)}']`;
    lines.push(
      `tl.set("${selector}", { xPercent: ${(-(first.xPercent) * lag).toFixed(3)}, yPercent: ${(-(first.yPercent) * lag).toFixed(3)} }, 0);`
    );
    for (let step = 1; step < frames.length; step += 1) {
      const previous = frames[step - 1];
      const current = frames[step];
      const from = Math.min(total, previous.t + (previous.hold || 0));
      const duration = Math.max(0.1, current.t - from);
      lines.push(
        `tl.to("${selector}", { xPercent: ${(-(current.xPercent) * lag).toFixed(3)}, yPercent: ${(-(current.yPercent) * lag).toFixed(3)}, duration: ${duration.toFixed(3)}, ease: "${current.ease}" }, ${from.toFixed(3)});`
      );
    }
  }

  // Camera moves: fast in the middle, soft at both ends, with a short motion
  // blur while the board travels.
  for (let step = 1; step < frames.length; step += 1) {
    const previous = frames[step - 1];
    const current = frames[step];
    const from = Math.min(total, previous.t + (previous.hold || 0));
    const duration = Math.max(0.1, current.t - from);
    lines.push(
      `tl.to("${camera}", { xPercent: ${current.xPercent}, yPercent: ${current.yPercent}, scale: ${current.scale}, rotation: ${current.rotate || 0}, duration: ${duration.toFixed(3)}, ease: "${current.ease}" }, ${from.toFixed(3)});`
    );
    if (duration > 0.45) {
      const rise = duration * 0.35;
      lines.push(
        `tl.to("${camera}", { filter: "blur(2.5px)", duration: ${rise.toFixed(3)}, ease: "power2.in" }, ${from.toFixed(3)});`
      );
      lines.push(
        `tl.to("${camera}", { filter: "blur(0px)", duration: ${(duration - rise).toFixed(3)}, ease: "power2.out" }, ${(from + rise).toFixed(3)});`
      );
    }
  }

  // A stopped camera is never frozen: a slow drift keeps the board alive while
  // the viewer reads.
  for (let step = 0; step < frames.length; step += 1) {
    const frame = frames[step];
    const hold = frame.hold || 0;
    if (hold < 0.6) continue;
    const direction = step % 2 === 0 ? 1 : -1;
    lines.push(
      `tl.to("${camera}", { xPercent: ${Number((frame.xPercent + 0.4 * direction).toFixed(2))}, yPercent: ${Number((frame.yPercent - 0.3 * direction).toFixed(2))}, duration: ${(hold / 2).toFixed(2)}, ease: "sine.inOut", yoyo: true, repeat: 1 }, ${frame.t.toFixed(2)});`
    );
  }

  for (const link of canvas.links) {
    const selector = `${root} [data-link='${link.from}->${link.to}']`;
    lines.push(`tl.set("${selector}", { strokeDashoffset: 100 }, 0);`);
    lines.push(
      `tl.to("${selector}", { strokeDashoffset: 0, duration: ${link.draw.toFixed(3)}, ease: "power2.inOut" }, ${link.at.toFixed(3)});`
    );
  }

  for (const card of canvasCardTimes(canvas)) {
    const selector = `${root} [data-card='${card.id}']`;
    const texty = ["year", "statement", "label"].includes(card.style);
    const offset = { settle: 7, rise: 12, fade: 0, slide: -6 }[card.enter] ?? 7;
    const duration = canvas.animation.duration;
    const ease = canvas.animation.ease;
    const from = texty
      ? `{ autoAlpha: 0, yPercent: ${offset + 4}, scale: 0.96, filter: "blur(7px)" }`
      : `{ autoAlpha: 0, yPercent: ${offset}, scale: 0.975, filter: "blur(0px)" }`;
    lines.push(`tl.set("${selector}", { autoAlpha: 0 }, 0);`);
    lines.push(
      `tl.fromTo("${selector}", ${from}, { autoAlpha: 1, yPercent: 0, xPercent: 0, scale: 1, filter: "blur(0px)", duration: ${duration.toFixed(3)}, ease: "${ease}" }, ${card.enterAt.toFixed(3)});`
    );
    if (card.to < total - 0.01) {
      const fade = canvas.tempo.fadeOut;
      lines.push(
        `tl.to("${selector}", { autoAlpha: 0, duration: ${fade.toFixed(3)}, ease: "power1.in" }, ${Math.max(0, card.to - fade).toFixed(3)});`
      );
    }
    for (const annotation of card.annotations) {
      const annot = `${selector} [data-annot='${card.id}']`;
      if (annotation.kind === "label") {
        lines.push(`tl.set("${annot}", { autoAlpha: 0 }, 0);`);
        lines.push(
          `tl.fromTo("${annot}", { autoAlpha: 0, yPercent: -10 }, { autoAlpha: 1, yPercent: 0, duration: 0.35, ease: "power2.out" }, ${annotation.from.toFixed(3)});`
        );
      } else if (annotation.kind === "underline") {
        lines.push(`tl.set("${annot} .cv-annot-underline", { scaleX: 0 }, 0);`);
        lines.push(
          `tl.to("${annot} .cv-annot-underline", { scaleX: 1, duration: ${annotation.draw.toFixed(3)}, ease: "power2.out" }, ${annotation.from.toFixed(3)});`
        );
      } else {
        lines.push(`tl.set("${annot} .cv-stroke", { strokeDashoffset: 100 }, 0);`);
        lines.push(
          `tl.to("${annot} .cv-stroke", { strokeDashoffset: 0, duration: ${annotation.draw.toFixed(3)}, ease: "power2.out" }, ${annotation.from.toFixed(3)});`
        );
      }
    }
  }
  return lines.join("\n      ");
}

/**
 * Compact, human-readable summary for `plan --check` output.
 *
 * @param {object} canvas normalized canvas
 * @returns {string}
 */
export function canvasSummary(canvas) {
  const cards = canvas.cards.length;
  const stops = canvas.camera.length;
  const preset = canvas.preset.id;
  return `${cards} card(s), ${stops} camera stop(s), preset "${preset}"`;
}
