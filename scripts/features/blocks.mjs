/**
 * HyperFrames registry blocks as plan elements.
 *
 * A block is a self-contained composition installed from the HyperFrames
 * registry (`hyperframes add`). RoosterEdit does not bundle Three.js or the
 * block code: it resolves the block in `style/blocks/<name>/`, copies it into
 * the engine project, and emits a composition host with the plan variables.
 *
 * Pure: no filesystem, no process, no network.
 */

export const BLOCK_TEMPLATE = "block";

/**
 * @param {object} element
 * @returns {boolean}
 */
export function isBlockElement(element) {
  if (!element || typeof element !== "object") return false;
  return (
    String(element.type || "").toLowerCase() === "scene" &&
    (String(element.template || "").toLowerCase() === BLOCK_TEMPLATE || Boolean(element.block))
  );
}

/**
 * Validate and return the block name.
 * @param {object} element
 * @returns {string}
 * @throws {TypeError}
 */
export function blockName(element) {
  const name = String(element?.block || "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
    throw new TypeError(
      `scene block needs a registry name like "extruded-logo" (got "${name || "empty"}").`
    );
  }
  return name;
}

/**
 * Variables baked into the host composition.
 * @param {object} element
 * @returns {Record<string, string|number|boolean>}
 */
export function blockVars(element) {
  const vars = element?.vars;
  if (!vars || typeof vars !== "object" || Array.isArray(vars)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(vars)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) continue;
    if (["string", "number", "boolean"].includes(typeof value)) clean[key] = value;
  }
  return clean;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
}

/**
 * Composition host for one block element.
 *
 * Mirrors the snippet `hyperframes add` prints, with the element id, timing,
 * track, and variables from the plan.
 *
 * @param {object} input
 * @param {object} input.element
 * @param {number} input.index
 * @param {number} input.width
 * @param {number} input.height
 * @returns {string}
 */
export function blockHostHtml({ element, index, width, height }) {
  const name = blockName(element);
  const start = Number(element.start) || 0;
  const end = Math.max(start + 0.1, Number(element.end) || start + 1);
  const vars = blockVars(element);
  const varsAttr = Object.keys(vars).length
    ? ` data-variable-values='${escapeAttr(JSON.stringify(vars))}'`
    : "";
  return (
    `<div id="el-${index}" class="clip scene-host" ` +
    `data-composition-id="el-${index}" ` +
    `data-composition-src="compositions/${name}.html" ` +
    `data-start="${start.toFixed(3)}" data-duration="${(end - start).toFixed(3)}" ` +
    `data-track-index="${index + 2}" data-track-kind="graphics" ` +
    `data-width="${width}" data-height="${height}"${varsAttr}></div>`
  );
}

/**
 * Arguments for `hyperframes add` when the block must be fetched.
 * @param {object} input
 * @param {string} input.name
 * @param {string} input.dir
 * @param {string} [input.varsFile]
 * @returns {string[]}
 */
export function blockAddArgs({ name, dir, varsFile }) {
  const args = ["add", name, "--dir", dir, "--json", "--no-clipboard"];
  if (varsFile) args.push("--vars", varsFile);
  return args;
}

/**
 * Human instruction when a block is missing and downloading is not allowed.
 * @param {object} input
 * @param {string} input.name
 * @param {string} [input.cli]
 * @returns {string}
 */
export function blockInstallHint({ name, cli = "npx hyperframes" }) {
  return `${cli} add ${name}  (or run build with --allow-download)`;
}

/**
 * Whether the planned duration is far from the block's native duration.
 * @param {object} element
 * @param {number} nativeDuration
 * @param {number} [tolerance=0.5]
 * @returns {boolean}
 */
export function blockDurationMismatch(element, nativeDuration, tolerance = 0.5) {
  const start = Number(element?.start);
  const end = Number(element?.end);
  const native = Number(nativeDuration);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(native) || native <= 0) {
    return false;
  }
  return Math.abs(end - start - native) > tolerance;
}
