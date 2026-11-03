/**
 * Chart helpers for RoosterEdit.
 *
 * Dependency-free renderer for plan elements shaped like:
 *   { type: "grafico", chart: { kind, values, labels, unit, title } }
 *
 * renderChartSvg() returns a self-contained 1200x600 SVG.
 * chartSummary() returns one plain-text line for plan summaries.
 * validateChart() returns plan-style { errors, warnings, ok }.
 */

export const CHART_KINDS = Object.freeze(["bar", "line", "pie"]);

const VIEW = Object.freeze({ width: 1200, height: 600 });
const DEFAULT_THEME = Object.freeze({
  bg: "#0b0f19",
  fg: "#f8fafc",
  muted: "#94a3b8",
  accent: "#22d3ee",
  accent2: "#f472b6",
  display: "Inter",
  body: "Inter",
});
const FALLBACK_COLORS = Object.freeze([
  "#facc15",
  "#4ade80",
  "#a78bfa",
  "#fb923c",
  "#38bdf8",
  "#f87171",
  "#e879f9",
  "#2dd4bf",
]);
const CURRENCY_UNITS = new Set(["$", "€", "£", "¥", "₹", "R$", "US$"]);

// ---------------------------------------------------------------------------
// Small pure utilities
// ---------------------------------------------------------------------------

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeColor(value, fallback) {
  const text = String(value ?? "").trim();
  const pattern =
    /^(#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]{3,20}|(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]+\))$/i;
  return pattern.test(text) ? text : fallback;
}

function truncate(value, max) {
  const chars = Array.from(String(value ?? ""));
  if (chars.length <= max) return chars.join("");
  return `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}

function formatNumber(value, maxDigits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0";
  const abs = Math.abs(parsed);
  let digits = maxDigits;
  if (abs > 0 && abs < 1) {
    digits = Math.min(8, Math.max(maxDigits, Math.ceil(-Math.log10(abs)) + 1));
  }
  let rounded = Number(parsed.toFixed(digits));
  if (Object.is(rounded, -0)) rounded = 0;
  const negative = rounded < 0;
  const [whole, decimals] = String(Math.abs(rounded)).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${decimals ? `.${decimals}` : ""}`;
}

function formatUnitValue(value, unit) {
  const text = formatNumber(value);
  const clean = String(unit ?? "").trim();
  if (!clean) return text;
  if (/^[%‰°]$/.test(clean)) return `${text}${clean}`;
  if (CURRENCY_UNITS.has(clean)) {
    return text.startsWith("-") ? `-${clean} ${text.slice(1)}` : `${clean} ${text}`;
  }
  return `${text} ${clean}`;
}

function themeOf(theme = {}) {
  const source = theme && typeof theme === "object" && !Array.isArray(theme) ? theme : {};
  return {
    bg: safeColor(source.bg, DEFAULT_THEME.bg),
    fg: safeColor(source.fg, DEFAULT_THEME.fg),
    muted: safeColor(source.muted, DEFAULT_THEME.muted),
    accent: safeColor(source.accent, DEFAULT_THEME.accent),
    accent2: safeColor(source.accent2, DEFAULT_THEME.accent2),
    display:
      typeof source.display === "string" && source.display.trim()
        ? source.display.trim()
        : DEFAULT_THEME.display,
    body:
      typeof source.body === "string" && source.body.trim()
        ? source.body.trim()
        : DEFAULT_THEME.body,
  };
}

function paletteFor(theme) {
  const candidates = [theme.accent, theme.accent2, ...FALLBACK_COLORS]
    .map((color) => safeColor(color, ""))
    .filter(Boolean);
  const unique = [];
  for (const color of candidates) {
    if (!unique.some((existing) => existing.toLowerCase() === color.toLowerCase())) {
      unique.push(color);
    }
  }
  return unique.length ? unique : [DEFAULT_THEME.accent];
}

function fontFamily(theme, role = "body") {
  const family = role === "display" ? theme.display : theme.body;
  return [family, "Segoe UI", "sans-serif"].filter(Boolean).join(", ");
}

function kindLabel(kind) {
  if (kind === "line") return "Line chart";
  if (kind === "pie") return "Pie chart";
  return "Bar chart";
}

function chartModel(element = {}) {
  const source = element && typeof element === "object" && !Array.isArray(element) ? element : {};
  const chart =
    source.chart && typeof source.chart === "object" && !Array.isArray(source.chart)
      ? source.chart
      : {};
  const rawValues = Array.isArray(chart.values) ? chart.values : [];
  const values = Array.from(rawValues, (value) => number(value, 0));
  const rawLabels = Array.isArray(chart.labels) ? chart.labels : [];
  const labels = values.map((_, index) => {
    const label = rawLabels[index];
    return label === undefined || label === null ? "" : String(label);
  });
  const kind = CHART_KINDS.includes(chart.kind) ? chart.kind : "bar";
  const title =
    typeof chart.title === "string" && chart.title.trim()
      ? chart.title.trim()
      : typeof source.text === "string"
        ? source.text.trim()
        : "";
  const unit = typeof chart.unit === "string" ? chart.unit.trim() : "";

  return { element: source, chart, kind, values, labels, title, unit };
}

function valueRange(values) {
  let dataMax = Math.max(0, ...values);
  let dataMin = Math.min(0, ...values);
  if (dataMax === dataMin) dataMax = dataMin + 1;

  const targetSteps = 4;
  const rawStep = (dataMax - dataMin) / targetSteps;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 0.000001))));
  const residual = rawStep / magnitude;
  const factor =
    residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10;
  const step = factor * magnitude;

  let min = Math.floor(dataMin / step) * step;
  let max = Math.ceil(dataMax / step) * step;

  // A point sitting exactly on the top or bottom gridline has no room for its
  // value label. Add one clean step of headroom when that happens.
  const tolerance = step * 1e-6;
  if (dataMax > 0 && max <= dataMax + tolerance) max += step;
  if (dataMin < 0 && min >= dataMin - tolerance) min -= step;
  if (!(max > min)) max = min + step;

  return {
    min,
    max,
    step,
    ticks: Math.max(1, Math.round((max - min) / step)),
  };
}

function ariaLabel(model) {
  const kind = kindLabel(model.kind);
  const title = model.title ? `: ${model.title.replace(/[.!?]+$/, "")}` : "";
  if (!model.values.length) return `${kind}${title}. No data.`;
  const shown = Math.min(model.values.length, 10);
  const items = [];
  for (let index = 0; index < shown; index++) {
    const label = model.labels[index] || `item ${index + 1}`;
    items.push(`${label} ${formatUnitValue(model.values[index], model.unit)}`);
  }
  const more =
    model.values.length > shown ? `, and ${model.values.length - shown} more` : "";
  return `${kind}${title}. ${items.join(", ")}${more}.`;
}

// ---------------------------------------------------------------------------
// SVG pieces
// ---------------------------------------------------------------------------

function titleBlock(model, theme) {
  const parts = [];
  if (model.title) {
    const maxTitle = model.unit ? 40 : 48;
    parts.push(
      `  <text x="80" y="76" fill="${theme.fg}" font-family="${escapeXml(
        fontFamily(theme, "display")
      )}" font-size="38" font-weight="700" letter-spacing="-0.02em">${escapeXml(
        truncate(model.title, maxTitle)
      )}</text>`
    );
    parts.push(`  <rect x="80" y="94" width="64" height="5" rx="2.5" fill="${theme.accent}"/>`);
  }
  if (model.unit) {
    parts.push(
      `  <text x="1120" y="76" text-anchor="end" fill="${theme.muted}" font-family="${escapeXml(
        fontFamily(theme)
      )}" font-size="22">${escapeXml(truncate(model.unit, 20))}</text>`
    );
  }
  return parts.join("\n");
}

function emptyBody(model, theme) {
  const hint = model.title ? "Check chart.values in the plan." : "Add chart.values to the plan.";
  return `  <text x="600" y="310" text-anchor="middle" fill="${theme.muted}" font-family="${escapeXml(
    fontFamily(theme)
  )}" font-size="32" font-weight="600">No chart data</text>
  <text x="600" y="350" text-anchor="middle" fill="${theme.muted}" font-family="${escapeXml(
    fontFamily(theme)
  )}" font-size="20">${escapeXml(hint)}</text>`;
}

function xLabel(text, x, y, slot, theme, font) {
  const size = round(clamp(slot * 0.32, 12, 22), 2);
  const maxChars = Math.max(4, Math.floor(slot / (size * 0.58)));
  const short = truncate(text, maxChars);
  const full = String(text ?? "");
  const tooltip = short !== full ? `<title>${escapeXml(full)}</title>` : "";
  return `  <text x="${round(x)}" y="${round(y)}" text-anchor="middle" fill="${
    theme.muted
  }" font-family="${escapeXml(font)}" font-size="${size}">${escapeXml(short)}${tooltip}</text>`;
}

function renderGrid(context) {
  const { range, plot, theme, yOf } = context;
  const font = fontFamily(theme);
  const parts = [];
  const steps = range.ticks ?? 4;
  const step = (range.max - range.min) / steps;

  for (let index = 0; index <= steps; index++) {
    const value = range.min + step * index;
    const y = yOf(value);
    const opacity = index === 0 ? 0.4 : 0.16;
    parts.push(
      `  <line x1="${plot.left}" y1="${round(y)}" x2="${plot.right}" y2="${round(
        y
      )}" stroke="${theme.muted}" stroke-opacity="${opacity}" stroke-width="1"/>`
    );
    parts.push(
      `  <text x="${plot.left - 16}" y="${round(y + 6)}" text-anchor="end" fill="${
        theme.muted
      }" font-family="${escapeXml(font)}" font-size="18">${formatNumber(value)}</text>`
    );
  }

  if (range.min < 0 && range.max > 0) {
    const baseline = yOf(0);
    parts.push(
      `  <line x1="${plot.left}" y1="${round(baseline)}" x2="${plot.right}" y2="${round(
        baseline
      )}" stroke="${theme.fg}" stroke-opacity="0.3" stroke-width="2"/>`
    );
  }
  return parts.join("\n");
}

function renderBars(context) {
  const { model, theme, plot, plotWidth, baseline, yOf } = context;
  const count = model.values.length;
  const slot = plotWidth / count;
  const barWidth = Math.min(96, Math.max(2, slot * 0.62));
  const font = fontFamily(theme);
  const valueFont = round(clamp(slot * 0.22, 13, 20), 2);
  const withUnit = count <= 8;
  const parts = [];

  model.values.forEach((value, index) => {
    const x = plot.left + slot * index + (slot - barWidth) / 2;
    const valueY = yOf(value);
    const rawHeight = Math.abs(valueY - baseline);
    const height = value === 0 ? 0 : Math.max(2, rawHeight);
    const y = value >= 0 ? baseline - height : baseline;
    const radius = round(Math.min(8, barWidth / 2, height / 2), 2);
    const fill = value < 0 ? theme.accent2 : theme.accent;
    const label = withUnit ? formatUnitValue(value, model.unit) : formatNumber(value);
    const above = value >= 0 && valueY - 10 >= plot.top + 14;
    const labelY =
      value >= 0
        ? above
          ? valueY - 10
          : valueY + valueFont + 6
        : Math.min(plot.bottom - 8, valueY + valueFont + 8);
    const labelFill = value >= 0 && !above ? theme.bg : theme.fg;

    parts.push(
      `  <rect x="${round(x)}" y="${round(y)}" width="${round(barWidth)}" height="${round(
        height
      )}" rx="${radius}" fill="${fill}" fill-opacity="0.92"/>`
    );
    parts.push(
      `  <text x="${round(x + barWidth / 2)}" y="${round(
        labelY
      )}" text-anchor="middle" fill="${labelFill}" font-family="${escapeXml(
        font
      )}" font-size="${valueFont}" font-weight="600">${escapeXml(label)}</text>`
    );
    parts.push(
      xLabel(model.labels[index] || String(index + 1), x + barWidth / 2, plot.bottom + 40, slot, theme, font)
    );
  });

  return parts.join("\n");
}

function renderLine(context) {
  const { model, theme, plot, plotWidth, baseline, yOf } = context;
  const count = model.values.length;
  const step = count > 1 ? plotWidth / (count - 1) : plotWidth;
  const font = fontFamily(theme);
  const points = model.values.map((value, index) => ({
    x: count === 1 ? plot.left + plotWidth / 2 : plot.left + step * index,
    y: yOf(value),
    value,
    index,
  }));
  const valueFont = round(clamp(step * 0.35, 12, 18), 2);
  const withUnit = count <= 8;
  const parts = [];
  const baselineY = clamp(baseline, plot.top, plot.bottom);

  if (points.length > 1) {
    const area = [
      `M ${round(points[0].x)} ${round(baselineY)}`,
      ...points.map((point) => `L ${round(point.x)} ${round(point.y)}`),
      `L ${round(points[points.length - 1].x)} ${round(baselineY)}`,
      "Z",
    ].join(" ");
    parts.push(`  <path d="${area}" fill="${theme.accent}" fill-opacity="0.12"/>`);
    parts.push(
      `  <path d="${points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${round(point.x)} ${round(point.y)}`)
        .join(" ")}" fill="none" stroke="${theme.accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`
    );
  }

  for (const point of points) {
    const label = withUnit ? formatUnitValue(point.value, model.unit) : formatNumber(point.value);
    const above = point.value >= 0 && point.y - 12 >= plot.top + 14;
    const labelY =
      point.value >= 0
        ? above
          ? point.y - 12
          : point.y + valueFont + 10
        : Math.min(plot.bottom - 6, point.y + valueFont + 12);
    const anchor =
      count === 1 ? "middle" : point.index === 0 ? "start" : point.index === count - 1 ? "end" : "middle";
    const labelX = anchor === "start" ? point.x + 4 : anchor === "end" ? point.x - 4 : point.x;
    parts.push(
      `  <circle cx="${round(point.x)}" cy="${round(point.y)}" r="${
        count === 1 ? 9 : 6
      }" fill="${theme.accent2}" stroke="${theme.bg}" stroke-width="3"/>`
    );
    parts.push(
      `  <text x="${round(
        labelX
      )}" y="${round(labelY)}" text-anchor="${anchor}" fill="${
        theme.fg
      }" font-family="${escapeXml(font)}" font-size="${valueFont}" font-weight="600">${escapeXml(
        label
      )}</text>`
    );
    parts.push(
      xLabel(model.labels[point.index] || String(point.index + 1), point.x, plot.bottom + 40, step, theme, font)
    );
  }

  return parts.join("\n");
}

function renderCartesian(model, theme) {
  const plot = {
    left: 96,
    right: 1104,
    top: model.title ? 150 : 120,
    bottom: 495,
  };
  const range = valueRange(model.values);
  const plotWidth = plot.right - plot.left;
  const plotHeight = plot.bottom - plot.top;
  const yOf = (value) =>
    plot.bottom - ((value - range.min) / (range.max - range.min)) * plotHeight;
  const baseline = yOf(0);
  const context = { model, theme, plot, plotWidth, plotHeight, range, yOf, baseline };

  const body = model.kind === "line" ? renderLine(context) : renderBars(context);
  return `${renderGrid(context)}\n${body}`;
}

function renderLegend(model, theme, colors) {
  const count = model.values.length;
  const font = fontFamily(theme);
  const top = model.title ? 165 : 135;
  const available = 395;
  const rowHeight = Math.min(46, available / Math.max(1, count));
  const fontSize = round(clamp(rowHeight * 0.46, 12, 22), 2);
  const swatch = round(Math.min(18, Math.max(10, rowHeight * 0.6)), 2);
  const maxChars = Math.max(
    6,
    Math.floor(280 / (fontSize * 0.55))
  );
  const parts = [];

  model.values.forEach((value, index) => {
    const y = top + rowHeight * index;
    const centerY = y + rowHeight / 2;
    const label = model.labels[index] || `Item ${index + 1}`;
    const color = colors[index % colors.length];
    parts.push(
      `  <rect x="660" y="${round(centerY - swatch / 2)}" width="${swatch}" height="${swatch}" rx="5" fill="${color}"/>`
    );
    parts.push(
      `  <text x="690" y="${round(centerY + fontSize * 0.36)}" fill="${
        theme.fg
      }" font-family="${escapeXml(font)}" font-size="${fontSize}">${escapeXml(
        truncate(label, maxChars)
      )}</text>`
    );
    parts.push(
      `  <text x="1120" y="${round(centerY + fontSize * 0.36)}" text-anchor="end" fill="${
        theme.muted
      }" font-family="${escapeXml(font)}" font-size="${fontSize}">${escapeXml(
        formatUnitValue(value, model.unit)
      )}</text>`
    );
  });

  return parts.join("\n");
}

function renderPie(model, theme, colors) {
  const values = model.values.map((value) => Math.max(0, value));
  const total = values.reduce((sum, value) => sum + value, 0);
  const centerX = 390;
  const centerY = 350;
  const radius = 180;
  const parts = [];
  let angle = -Math.PI / 2;

  values.forEach((value, index) => {
    if (value <= 0) return;
    const fraction = value / total;
    const end = angle + fraction * Math.PI * 2;
    const color = colors[index % colors.length];

    if (fraction >= 0.9999) {
      parts.push(
        `  <circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="${color}" stroke="${theme.bg}" stroke-width="3"/>`
      );
    } else {
      const x1 = centerX + radius * Math.cos(angle);
      const y1 = centerY + radius * Math.sin(angle);
      const x2 = centerX + radius * Math.cos(end);
      const y2 = centerY + radius * Math.sin(end);
      const largeArc = end - angle > Math.PI ? 1 : 0;
      parts.push(
        `  <path d="M ${centerX} ${centerY} L ${round(x1)} ${round(y1)} A ${radius} ${radius} 0 ${largeArc} 1 ${round(
          x2
        )} ${round(y2)} Z" fill="${color}" stroke="${theme.bg}" stroke-width="3"/>`
      );
    }

    if (fraction >= 0.06) {
      const middle = angle + (end - angle) / 2;
      const x = centerX + Math.cos(middle) * radius * 0.62;
      const y = centerY + Math.sin(middle) * radius * 0.62;
      parts.push(
        `  <text x="${round(x)}" y="${round(
          y + 8
        )}" text-anchor="middle" fill="${theme.fg}" stroke="${
          theme.bg
        }" stroke-width="4" paint-order="stroke" font-family="${escapeXml(
          fontFamily(theme)
        )}" font-size="24" font-weight="700">${Math.round(fraction * 100)}%</text>`
      );
    }

    angle = end;
  });

  parts.push(renderLegend(model, theme, colors));
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a chart element as a self-contained SVG.
 *
 * @param {object} element Plan element with a chart object.
 * @param {object} [theme] Theme tokens from themeFromProfile().
 * @returns {string} SVG markup. Text is escaped; no external assets are used.
 */
export function renderChartSvg(element, theme = {}) {
  const model = chartModel(element);
  const paletteTheme = themeOf(theme);
  const colors = paletteFor(paletteTheme);
  const aria = ariaLabel(model);
  const title = model.title || kindLabel(model.kind);
  const attributes = `xmlns="http://www.w3.org/2000/svg" width="${VIEW.width}" height="${VIEW.height}" viewBox="0 0 ${VIEW.width} ${VIEW.height}" role="img" aria-label="${escapeXml(
    aria
  )}" preserveAspectRatio="xMidYMid meet"`;
  const shell = (body) => `<svg ${attributes}>
  <title>${escapeXml(title)}</title>
  <rect width="${VIEW.width}" height="${VIEW.height}" rx="24" fill="${paletteTheme.bg}"/>
  <rect x="0.5" y="0.5" width="${VIEW.width - 1}" height="${
    VIEW.height - 1
  }" rx="24" fill="none" stroke="${paletteTheme.accent}" stroke-opacity="0.16"/>
${titleBlock(model, paletteTheme)}
${body}
</svg>`;

  if (!model.values.length) return shell(emptyBody(model, paletteTheme));
  if (model.kind === "pie") {
    const total = model.values.reduce((sum, value) => sum + Math.max(0, value), 0);
    if (!(total > 0)) return shell(emptyBody(model, paletteTheme));
    return shell(renderPie(model, paletteTheme, colors));
  }
  return shell(renderCartesian(model, paletteTheme));
}

/**
 * One-line plain-text summary for plan.md, plan.html, or the CLI.
 * The result contains no markup; escape it at the HTML boundary.
 *
 * @param {object} element Plan element with a chart object.
 * @returns {string}
 */
export function chartSummary(element) {
  const model = chartModel(element);
  const label = kindLabel(model.kind);
  const title = model.title ? ` "${model.title}"` : "";
  if (!model.values.length) return `${label}${title}: no data`;

  const maxItems = 8;
  const items = model.values.slice(0, maxItems).map((value, index) => {
    const name = model.labels[index];
    return name
      ? `${name}: ${formatUnitValue(value, model.unit)}`
      : formatUnitValue(value, model.unit);
  });
  const more =
    model.values.length > maxItems ? ` … (+${model.values.length - maxItems} more)` : "";
  return `${label}${title} — ${model.values.length} value${
    model.values.length === 1 ? "" : "s"
  }: ${items.join(", ")}${more}`;
}

/**
 * Validate a chart element using the same { errors, warnings } shape as
 * validatePlan(). Errors block a build; warnings are editorial advice.
 *
 * @param {object} element
 * @returns {{errors: string[], warnings: string[], ok: boolean}}
 */
export function validateChart(element) {
  const errors = [];
  const warnings = [];

  if (!element || typeof element !== "object" || Array.isArray(element)) {
    errors.push("chart: element must be an object");
    return { errors, warnings, ok: false };
  }
  if (element.type !== "grafico") errors.push('chart: type must be "grafico"');

  const chart = element.chart;
  if (!chart || typeof chart !== "object" || Array.isArray(chart)) {
    errors.push("chart: missing chart object");
    return { errors, warnings, ok: false };
  }

  if (!CHART_KINDS.includes(chart.kind)) {
    errors.push(`chart: kind must be one of ${CHART_KINDS.join(", ")}`);
  }

  const numeric = [];
  if (!Array.isArray(chart.values)) {
    errors.push("chart: values must be an array");
  } else if (!chart.values.length) {
    errors.push("chart: values must contain at least one number");
  } else {
    for (let index = 0; index < chart.values.length; index++) {
      const value = chart.values[index];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(`chart: values[${index}] must be a finite number`);
      } else {
        numeric.push(value);
      }
    }
  }

  if (chart.labels !== undefined) {
    if (!Array.isArray(chart.labels)) {
      errors.push("chart: labels must be an array");
    } else {
      for (let index = 0; index < chart.labels.length; index++) {
        const label = chart.labels[index];
        if (label !== null && typeof label !== "string" && typeof label !== "number") {
          errors.push(`chart: labels[${index}] must be a string or number`);
        }
      }
      if (Array.isArray(chart.values) && chart.labels.length !== chart.values.length) {
        warnings.push(
          `chart: labels has ${chart.labels.length} item(s) but values has ${chart.values.length}`
        );
      }
    }
  } else {
    warnings.push("chart: labels missing; index numbers will be used");
  }

  if (chart.unit !== undefined && typeof chart.unit !== "string") {
    errors.push("chart: unit must be a string");
  }
  if (chart.title !== undefined && typeof chart.title !== "string") {
    errors.push("chart: title must be a string");
  }
  const hasTitle =
    (typeof chart.title === "string" && Boolean(chart.title.trim())) ||
    (typeof element.text === "string" && Boolean(element.text.trim()));
  if (!hasTitle) warnings.push("chart: title missing");

  if (chart.kind === "pie" && numeric.length) {
    if (numeric.some((value) => value < 0)) {
      errors.push("chart: pie values cannot be negative");
    }
    const total = numeric.reduce((sum, value) => sum + Math.max(0, value), 0);
    if (!(total > 0)) errors.push("chart: pie values must add up to more than zero");
    if (numeric.filter((value) => value > 0).length > 8) {
      warnings.push("chart: more than 8 pie slices will be crowded");
    }
    if (numeric.some((value) => value === 0)) {
      warnings.push("chart: zero-value pie slices will not render");
    }
  }

  if ((chart.kind === "bar" || chart.kind === "line") && numeric.length) {
    if (numeric.length > 24) warnings.push("chart: more than 24 points will be crowded");
    if (numeric.every((value) => value === 0)) warnings.push("chart: all values are zero");
  }

  return { errors, warnings, ok: errors.length === 0 };
}
