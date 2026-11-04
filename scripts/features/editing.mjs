/**
 * Pure editorial quality helpers.
 *
 * These functions do not read files or spawn processes. They inspect an
 * approved `rooster.plan/v1` plus an optional transcript and return warnings
 * and derived decisions that the CLI and the build can consume.
 *
 * Times in the plan are source times. Output times are derived from the cuts
 * so the review UI and the build agree on where a beat lands.
 */

const SILENCE_REASONS = new Set(["silence", "long-pause", "pause"]);
const BROLL_INTENTS = new Set(["evidence", "texture", "transition"]);
const VISUAL_TYPES = new Set([
  "letreiro",
  "grafico",
  "lista",
  "broll",
  "lower-third",
  "caption-emphasis",
  "transition",
  "end-card",
  "custom",
]);
const TEXT_TYPES = new Set(["letreiro", "grafico", "lista", "caption-emphasis"]);
const CHAPTER_ROLES = new Set(["chapter", "section", "divider"]);

const STOP_WORDS = new Set([
  "a",
  "o",
  "as",
  "os",
  "um",
  "uma",
  "uns",
  "umas",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "por",
  "para",
  "pra",
  "com",
  "sem",
  "sobre",
  "entre",
  "que",
  "se",
  "e",
  "ou",
  "mas",
  "como",
  "mais",
  "menos",
  "muito",
  "muita",
  "meu",
  "minha",
  "seu",
  "sua",
  "nosso",
  "nossa",
  "ele",
  "ela",
  "eles",
  "elas",
  "isso",
  "isto",
  "aquilo",
  "aqui",
  "ali",
  "lá",
  "já",
  "não",
  "sim",
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "was",
  "were",
  "this",
  "that",
  "it",
]);

const ORPHAN_STARTS = [
  /^bom,?\s+aqui/i,
  /^bem,?\s+aqui/i,
  /^como voc[êe]s (podem|puderam|viram)/i,
  /^como (voc[êe]|a gente) (pode|p[ôo]de) ver/i,
  /^(ela|ele) reconheceu/i,
  /^(ela|ele) (achou|entendeu)/i,
  /^impressionante/i,
  /^fant[áa]stico/i,
  /^olha que legal/i,
  /^(ele|ela) j[áa] viu/i,
  /^eu fechei e abri/i,
  /^outra coisa (legal|interessante)/i,
];

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sortCuts(cuts) {
  return (Array.isArray(cuts) ? cuts : [])
    .filter((cut) => cut && typeof cut === "object")
    .map((cut) => ({ ...cut, start: number(cut.start), end: number(cut.end) }))
    .filter((cut) => cut.end > cut.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * Resolve source keeps from a plan.
 *
 * `keeps` wins when present. Otherwise the cuts are subtracted from the
 * declared duration. The result is always sorted by source time.
 *
 * @param {object} plan
 * @returns {Array<{start:number,end:number}>}
 */
export function keepsFromPlan(plan) {
  if (Array.isArray(plan?.keeps) && plan.keeps.length) {
    return plan.keeps
      .filter((keep) => keep && Number.isFinite(Number(keep.start)) && Number.isFinite(Number(keep.end)))
      .map((keep) => ({ start: number(keep.start), end: number(keep.end) }))
      .filter((keep) => keep.end > keep.start)
      .sort((a, b) => a.start - b.start);
  }

  const duration = number(plan?.duration);
  const cuts = sortCuts(plan?.cuts);
  if (!cuts.length) return duration > 0 ? [{ start: 0, end: duration }] : [];

  const keeps = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.start > cursor) keeps.push({ start: cursor, end: cut.start });
    cursor = Math.max(cursor, cut.end);
  }
  if (cursor < duration) keeps.push({ start: cursor, end: duration });
  return keeps;
}

/**
 * Map a source time to the output timeline.
 *
 * @param {number} time
 * @param {Array<{start:number,end:number}>} keeps
 * @returns {number}
 */
export function remapTime(time, keeps) {
  let elapsed = 0;
  for (const keep of keeps) {
    if (time < keep.start) break;
    if (time <= keep.end) return elapsed + (time - keep.start);
    elapsed += keep.end - keep.start;
  }
  return elapsed;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokensOf(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

/**
 * The on-screen copy of an element, including structured `data`.
 *
 * A diagram or counter may carry its words in `data` instead of `text`. The
 * review and grounding checks should see those words too.
 *
 * @param {object} element
 * @returns {string}
 */
export function elementText(element) {
  if (!element || typeof element !== "object") return "";
  if (element.text) return String(element.text).trim();
  const data = element.data && typeof element.data === "object" ? element.data : {};
  const parts = [];
  for (const key of ["title", "name", "role", "command", "label", "sub"]) {
    if (data[key]) parts.push(String(data[key]));
  }
  for (const node of Array.isArray(data.nodes) ? data.nodes : []) {
    parts.push(typeof node === "string" ? node : node?.label || node?.text || "");
  }
  for (const item of Array.isArray(data.items) ? data.items : []) {
    parts.push(typeof item === "string" ? item : item?.label || item?.text || "");
  }
  for (const row of Array.isArray(data.rows) ? data.rows : []) {
    parts.push([row?.value, row?.label].filter(Boolean).join(" "));
  }
  return parts.map((part) => String(part).trim()).filter(Boolean).join(" · ");
}

function segmentTextAt(segments, start, end) {
  const from = number(start);
  const to = Math.max(from, number(end, from));
  return (Array.isArray(segments) ? segments : [])
    .filter((segment) => number(segment.end) > from && number(segment.start) < to)
    .map((segment) => String(segment.text || "").trim())
    .filter(Boolean)
    .join(" ");
}

function transcriptAround(segments, start, end, windowSeconds) {
  const pad = Math.max(0, number(windowSeconds, 8));
  return segmentTextAt(segments, number(start) - pad, number(end) + pad);
}

/**
 * List the visual elements that count as a beat, sorted by start.
 *
 * @param {object} plan
 * @returns {Array<object>}
 */
export function visualBeats(plan) {
  return (Array.isArray(plan?.elements) ? plan.elements : [])
    .filter((element) => element && VISUAL_TYPES.has(String(element.type || "")))
    .filter((element) => number(element.end) > number(element.start))
    .slice()
    .sort((a, b) => number(a.start) - number(b.start));
}

function outputDuration(plan) {
  const keeps = keepsFromPlan(plan);
  return keeps.reduce((sum, keep) => sum + (keep.end - keep.start), 0);
}

function outputBeats(plan, keeps) {
  return visualBeats(plan)
    .map((element) => ({
      id: element.id || null,
      type: element.type || "element",
      start: remapTime(number(element.start), keeps),
      end: remapTime(number(element.end), keeps),
    }))
    .filter((beat) => beat.end > beat.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * Find long stretches without any visual beat.
 *
 * A gap is measured in output time, because that is what the viewer sees.
 * Elements are clamped to the output duration.
 *
 * @param {object} plan
 * @param {{maxGap?: number, minGap?: number}} [options]
 * @returns {{duration:number, maxGap:number, averageGap:number, gaps:Array<object>}}
 */
export function visualGaps(plan, options = {}) {
  const duration = outputDuration(plan);
  const maxGap = Math.max(1, number(options.maxGap, 45));
  const minGap = Math.max(0, number(options.minGap, 0));
  if (!(duration > 0)) {
    return { duration: 0, maxGap, averageGap: 0, gaps: [] };
  }

  const keeps = keepsFromPlan(plan);
  const beats = outputBeats(plan, keeps)
    .map((beat) => ({
      ...beat,
      start: Math.max(0, beat.start),
      end: Math.min(duration, beat.end),
    }))
    .filter((beat) => beat.end > beat.start)
    .sort((a, b) => a.start - b.start);

  const gaps = [];
  let cursor = 0;
  let covered = 0;
  for (const beat of beats) {
    if (beat.start > cursor) {
      const length = beat.start - cursor;
      if (length > minGap) gaps.push({ start: cursor, end: beat.start, duration: length });
    }
    covered += Math.max(0, beat.end - Math.max(beat.start, cursor));
    cursor = Math.max(cursor, beat.end);
  }
  if (cursor < duration) {
    const length = duration - cursor;
    if (length > minGap) gaps.push({ start: cursor, end: duration, duration: length });
  }

  const severe = gaps.filter((gap) => gap.duration > maxGap);
  return {
    duration,
    maxGap,
    averageGap: beats.length ? duration / (beats.length + 1) : duration,
    covered,
    gaps: severe,
    allGaps: gaps,
  };
}

/**
 * Which element types the target engine can render as visual layers.
 *
 * FilmCraft accepts overlay clips, but it does not apply zooms or overlay
 * transitions to the base clip. Pretending otherwise silently drops motion
 * from the plan, which is worse than warning the editor.
 *
 * @param {object} plan
 * @param {string} engine
 * @returns {{supported:string[], unsupported:Array<{id:string,type:string,reason:string}>}}
 */
export function elementSupport(plan, engine) {
  const target = String(engine || "").toLowerCase();
  const unsupported = [];
  const supported = [];
  const fallback = [];
  const knownTemplates = new Set([
    "chapter",
    "title",
    "diagram",
    "counter",
    "list",
    "lower-third",
    "emphasis",
    "callout",
    "terminal",
    "end-card",
    "broll",
    "chart",
    "custom",
  ]);
  const elements = Array.isArray(plan?.elements) ? plan.elements : [];
  for (const element of elements) {
    const type = String(element?.type || "");
    if (!type) continue;
    const template = String(element?.template || "");
    if (template && !knownTemplates.has(template)) {
      unsupported.push({
        id: element.id || null,
        type,
        reason: `unknown template "${template}"`,
      });
      continue;
    }
    if (target === "filmcraft" && (type === "zoom" || type === "transition")) {
      unsupported.push({
        id: element.id || null,
        type,
        reason:
          type === "zoom"
            ? "FilmCraft does not animate the base clip; use HyperFrames/Remotion or a punch-in"
            : "FilmCraft does not support overlay transitions",
      });
    } else if (target === "remotion" && (type === "custom" || template === "custom")) {
      unsupported.push({
        id: element.id || null,
        type,
        reason: "Remotion cannot execute custom HTML/JS; use HyperFrames for this element",
      });
    } else {
      supported.push(type);
      if (target === "remotion" && template && template !== "chart" && template !== "broll") {
        fallback.push({
          id: element.id || null,
          type,
          template,
          reason: `Remotion renders "${template}" as the card/text fallback; use HyperFrames for the animated layout`,
        });
      }
    }
  }
  return { supported: Array.from(new Set(supported)), unsupported, fallback };
}

function isChapterCard(element) {
  const role = String(element?.role || "").toLowerCase();
  if (CHAPTER_ROLES.has(role)) return true;
  return String(element?.template || "").toLowerCase() === "chapter";
}

/**
 * Check whether on-screen text is grounded in what is being said.
 *
 * Chapter cards, names and roles are intentionally exempt: they label a
 * section instead of quoting a line. Everything else should share at least
 * one meaningful token with the transcript around it, or carry an explicit
 * `covers` quote that does.
 *
 * @param {object} plan
 * @param {Array<object>} segments Transcript segments.
 * @param {{window?: number}} [options]
 * @returns {Array<object>} warnings
 */
export function textGroundingWarnings(plan, segments, options = {}) {
  const windowSeconds = number(options.window, 8);
  const warnings = [];
  const chapterTitles = new Set(
    (Array.isArray(plan?.chapters) ? plan.chapters : []).map((chapter) => normalizeText(chapter.title))
  );
  for (const element of Array.isArray(plan?.elements) ? plan.elements : []) {
    const type = String(element?.type || "");
    if (!TEXT_TYPES.has(type)) continue;
    if (isChapterCard(element)) continue;
    if (type === "letreiro" && chapterTitles.has(normalizeText(element.text))) continue;

    const around = transcriptAround(segments, element.start, element.end, windowSeconds);
    const aroundTokens = new Set(tokensOf(around));
    const label = element.id || type;
    const covers = String(element.covers || "").trim();

    if (covers) {
      const coversTokens = tokensOf(covers);
      const hit = coversTokens.length && coversTokens.every((token) => aroundTokens.has(token));
      if (!hit) {
        warnings.push({
          id: element.id || null,
          type: "text",
          message: `${label}: "covers" does not appear in the transcript around it (${around.slice(0, 90) || "no transcript"})`,
        });
      }
      continue;
    }

    const text = elementText(element);
    if (!text) continue;
    const textTokens = tokensOf(text);
    if (!textTokens.length) continue;
    const matched = textTokens.filter((token) => aroundTokens.has(token));
    if (!matched.length) {
      warnings.push({
        id: element.id || null,
        type: "text",
        message: `${label}: "${text}" shares no word with the transcript around it — check the context or add "covers"`,
      });
    }
  }
  return warnings;
}

/**
 * Warn about b-roll that has no spoken anchor.
 *
 * Visual matching still needs human eyes, but a `covers` quote is cheap and
 * makes the editor read the exact line before choosing the clip.
 *
 * @param {object} plan
 * @param {Array<object>} segments
 * @param {{window?: number}} [options]
 * @returns {Array<object>}
 */
export function brollContextWarnings(plan, segments, options = {}) {
  const windowSeconds = number(options.window, 8);
  const futureThreshold = Math.max(0, number(options.futureThreshold, 30));
  const warnings = [];
  for (const element of Array.isArray(plan?.elements) ? plan.elements : []) {
    if (String(element?.type || "") !== "broll") continue;
    const label = element.id || "broll";
    const covers = String(element.covers || "").trim();
    const intent = String(element.intent || "").trim().toLowerCase();
    const around = transcriptAround(segments, element.start, element.end, windowSeconds);
    const hasSourceTime =
      element.sourceTime !== undefined && element.sourceTime !== null && element.sourceTime !== "";
    const missing = [];
    if (!covers) missing.push("covers");
    if (!intent) missing.push("intent");
    if (!hasSourceTime) missing.push("sourceTime");
    if (missing.length) {
      warnings.push({
        id: element.id || null,
        type: "broll",
        message: `${label}: b-roll missing ${missing.join(", ")}; confirm the line, the intent and where the clip was extracted`,
      });
    }

    if (covers) {
      const aroundTokens = new Set(tokensOf(around));
      const coversTokens = tokensOf(covers);
      if (coversTokens.length && !coversTokens.every((token) => aroundTokens.has(token))) {
        warnings.push({
          id: element.id || null,
          type: "broll",
          message: `${label}: "covers" does not appear in the transcript around it — the b-roll may be misplaced`,
        });
      }
    }

    if (intent && !BROLL_INTENTS.has(intent)) {
      warnings.push({
        id: element.id || null,
        type: "broll",
        message: `${label}: unknown b-roll intent "${intent}"; use "evidence", "texture" or "transition"`,
      });
    }

    if (!hasSourceTime) continue;
    const sourceTime = Number(element.sourceTime);
    if (!Number.isFinite(sourceTime)) {
      warnings.push({
        id: element.id || null,
        type: "broll",
        message: `${label}: sourceTime must be numeric seconds`,
      });
      continue;
    }

    const future = sourceTime - number(element.end);
    if (future > futureThreshold) {
      warnings.push({
        id: element.id || null,
        type: "broll",
        message:
          intent === "evidence"
            ? `${label}: b-roll extracted from ${clock(sourceTime)} (${Math.round(future)} s later) and placed at ${clock(element.start)}; confirm it is evidence and does not spoil a later scene`
            : `${label}: b-roll extracted from ${clock(sourceTime)} (${Math.round(future)} s later) and placed at ${clock(element.start)}; use a custom motion graphic or a same-context clip`,
      });
    }
  }
  return warnings;
}

/**
 * Catch the classic broken cut: a reaction survives, but the setup does not.
 *
 * @param {object} plan
 * @param {Array<object>} segments
 * @param {{window?: number}} [options]
 * @returns {Array<object>}
 */
export function orphanCutWarnings(plan, segments, options = {}) {
  const windowSeconds = number(options.window, 45);
  const cuts = sortCuts(plan?.cuts);
  const list = (Array.isArray(segments) ? segments : [])
    .map((segment) => ({ ...segment, start: number(segment.start), end: number(segment.end) }))
    .filter((segment) => segment.end > segment.start)
    .sort((a, b) => a.start - b.start);
  const warnings = [];

  for (const cut of cuts) {
    const reason = String(cut.reason || "");
    if (SILENCE_REASONS.has(reason)) continue;
    const next = list.find((segment) => segment.start >= cut.end - 0.05);
    if (!next) continue;
    if (next.start > cut.end + windowSeconds) continue;
    const text = String(next.text || "").trim();
    if (!ORPHAN_STARTS.some((pattern) => pattern.test(text))) continue;
    warnings.push({
      id: cut.id || null,
      type: "cut",
      message: `${cut.id || "cut"}: reaction "${text.slice(0, 70)}" may depend on the removed setup — restore the setup or extend the cut through the reaction`,
    });
  }
  return warnings;
}

function overlapsBeat(beats, time, padding = 0.12) {
  return beats.some((beat) => time >= beat.start - padding && time <= beat.end + padding);
}

/**
 * Warn about kept shots that are too short to read as a shot.
 *
 * A 0.4–0.8 s keep often looks like a flash between two cuts. The editor
 * should merge it into the neighbouring cut or restore a little context.
 *
 * @param {object} plan
 * @param {{minKeep?: number}} [options]
 * @returns {Array<object>}
 */
export function shortKeepWarnings(plan, options = {}) {
  const minKeep = Math.max(0.2, number(options.minKeep, 0.8));
  const keeps = keepsFromPlan(plan);
  const warnings = [];
  for (const keep of keeps) {
    const duration = keep.end - keep.start;
    if (duration >= minKeep) continue;
    const output = remapTime(keep.start, keeps);
    warnings.push({
      id: null,
      type: "cut",
      message: `${clock(output)}: ${duration.toFixed(1)} s keep — too short for a clean cut; merge it with the adjacent cut or keep more context`,
    });
  }
  return warnings;
}

function defaultPosition(element) {
  const explicit = String(element?.position || "");
  if (explicit) return explicit;
  const type = String(element?.type || "");
  const template = String(element?.template || "");
  if (type === "custom" || template === "custom") return "center";
  if (type === "broll") return "top-right";
  if (type === "end-card") return "center";
  if (type === "lower-third" || type === "lista" || type === "caption-emphasis") {
    return type === "caption-emphasis" ? "bottom-center" : "bottom-left";
  }
  if (type === "letreiro") return template === "chapter" ? "center-left" : "center-left";
  if (type === "grafico") {
    if (template === "counter") return "top-right";
    if (template === "diagram") return "bottom-right";
    if (template === "terminal") return "bottom-left";
    return "bottom-left";
  }
  return "bottom-right";
}

/**
 * Warn when two on-screen layers share the same corner and time.
 *
 * The build can stack them on different tracks, but the viewer sees a pile of
 * cards. The editor should move one beat or change its `position`.
 *
 * @param {object} plan
 * @returns {Array<object>}
 */
export function layoutCollisionWarnings(plan) {
  const keeps = keepsFromPlan(plan);
  const mapTime = keeps.length ? (value) => remapTime(value, keeps) : (value) => number(value);
  const elements = (Array.isArray(plan?.elements) ? plan.elements : [])
    .filter(
      (element) =>
        element &&
        String(element.type || "") !== "custom" &&
        String(element.template || "") !== "custom" &&
        !["zoom", "transition"].includes(String(element.type || ""))
    )
    .map((element) => ({
      id: element.id || null,
      type: element.type || "element",
      start: mapTime(element.start),
      end: mapTime(element.end),
      position: defaultPosition(element),
    }))
    .filter((element) => element.end > element.start)
    .sort((a, b) => a.start - b.start);
  const warnings = [];
  for (let i = 0; i < elements.length; i += 1) {
    for (let j = i + 1; j < elements.length; j += 1) {
      const a = elements[i];
      const b = elements[j];
      if (b.start >= a.end) break;
      if (a.position !== b.position) continue;
      const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
      if (overlap < 0.25) continue;
      warnings.push({
        id: b.id || null,
        type: "layout",
        message: `${a.id || a.type} and ${b.id || b.type} overlap in the ${a.position} region for ${overlap.toFixed(1)} s — move one beat or change its position`,
      });
    }
  }
  return warnings;
}

/**
 * Decide how to soften cuts.
 *
 * - `punch` toggles a small scale between consecutive clips after uncovered
 *   silence cuts. That gives the eye two "camera angles" without extra footage.
 * - `fade` is a tiny audio fade at every join to remove clicks.
 * - `uncovered` lists long jumps that no visual beat covers, so the editor can
 *   add a PIP b-roll or a transition before rendering.
 *
 * @param {object} plan
 * @param {{punchScale?: number, fade?: number, minJump?: number}} [options]
 * @returns {{punchKeeps:boolean[], fade:number, punchScale:number, uncovered:Array<object>}}
 */
export function cutSmoothing(plan, options = {}) {
  const punchScale = Math.max(0, number(options.punchScale, 1.035));
  const fade = Math.max(0, number(options.fade, 0.035));
  const minJump = Math.max(0, number(options.minJump, 0.8));
  const coverJump = Math.max(minJump, number(options.coverJump, 6));
  const keeps = keepsFromPlan(plan);
  const cuts = sortCuts(plan?.cuts);
  const beats = outputBeats(plan, keeps);
  const punchKeeps = keeps.map(() => false);
  const uncovered = [];

  let tight = false;
  for (let index = 1; index < keeps.length; index += 1) {
    const keep = keeps[index];
    const previous = keeps[index - 1];
    const cut = cuts.find(
      (candidate) => Math.abs(candidate.end - keep.start) <= 0.08 && candidate.start >= previous.end - 0.08
    );
    if (!cut) continue;
    const reason = String(cut.reason || "");
    if (!SILENCE_REASONS.has(reason)) continue;
    if (cut.end - cut.start < minJump) continue;
    const output = remapTime(cut.end, keeps);
    if (overlapsBeat(beats, output, 0.75)) continue;
    tight = !tight;
    punchKeeps[index] = tight && punchScale > 1;
    if (cut.end - cut.start >= coverJump) {
      uncovered.push({
        id: cut.id || null,
        sourceStart: cut.start,
        sourceEnd: cut.end,
        output,
        duration: cut.end - cut.start,
      });
    }
  }

  return { punchKeeps, fade, punchScale, uncovered };
}

/**
 * Summarize the visual treatment per chapter.
 *
 * This is the "motion plan" view: how many beats of each kind, and how many
 * b-roll clips come from a later scene. It does not replace the per-element
 * list; it makes the mix obvious before approval.
 *
 * @param {object} plan
 * @param {{futureThreshold?: number}} [options]
 * @returns {Array<object>}
 */
export function motionMix(plan, options = {}) {
  const futureThreshold = Math.max(0, number(options.futureThreshold, 30));
  const chapters = (Array.isArray(plan?.chapters) ? plan.chapters : [])
    .filter((chapter) => chapter && Number.isFinite(Number(chapter.start)))
    .map((chapter) => ({ ...chapter, start: number(chapter.start) }))
    .sort((a, b) => a.start - b.start);
  const elements = (Array.isArray(plan?.elements) ? plan.elements : [])
    .filter((element) => element && number(element.end) > number(element.start))
    .map((element) => ({
      id: element.id || null,
      type: String(element.type || "element"),
      template: String(element.template || ""),
      start: number(element.start),
      end: number(element.end),
      intent: String(element.intent || "").toLowerCase(),
      sourceTime: element.sourceTime === undefined ? null : Number(element.sourceTime),
    }))
    .sort((a, b) => a.start - b.start);

  const rows = [];
  const bounds = chapters.length ? chapters : [{ start: 0, title: "Video" }];
  for (let index = 0; index < bounds.length; index += 1) {
    const chapter = bounds[index];
    const next = bounds[index + 1];
    const start = chapter.start;
    const end = next ? next.start : Number(plan?.duration) || Infinity;
    const beats = elements.filter((element) => element.start >= start && element.start < end);
    const broll = beats.filter((element) => element.type === "broll");
    const custom = beats.filter((element) => element.type === "custom" || element.template === "custom");
    const graphic = beats.filter(
      (element) => ["grafico", "lista"].includes(element.type) && !custom.includes(element)
    );
    const text = beats.filter(
      (element) => ["letreiro", "caption-emphasis", "lower-third", "end-card"].includes(element.type)
    );
    const motion = beats.filter((element) => ["zoom", "transition"].includes(element.type));
    const futureBroll = broll.filter(
      (element) =>
        element.sourceTime !== null &&
        Number.isFinite(element.sourceTime) &&
        element.sourceTime - element.end > futureThreshold
    );
    rows.push({
      title: chapter.title || "Video",
      start,
      end: Number.isFinite(end) ? end : null,
      total: beats.length,
      broll: broll.length,
      custom: custom.length,
      graphic: graphic.length,
      text: text.length,
      motion: motion.length,
      futureBroll: futureBroll.length,
      futureIds: futureBroll.map((element) => element.id).filter(Boolean),
      beats,
    });
  }
  return rows;
}

/**
 * Build the complete editorial quality report used by `plan --check`.
 *
 * @param {object} plan
 * @param {object|null} transcript
 * @param {{engine?: string, maxGap?: number, window?: number}} [options]
 * @returns {object}
 */
export function planQualityReport(plan, transcript, options = {}) {
  const segments = Array.isArray(transcript?.segments) ? transcript.segments : [];
  const engine = String(options.engine || "hyperframes").toLowerCase();
  const maxGap = number(options.maxGap, 45);
  const windowSeconds = number(options.window, 8);
  const density = visualGaps(plan, { maxGap });
  const support = elementSupport(plan, engine);
  const smoothing = cutSmoothing(plan);
  const warnings = [];

  for (const gap of density.gaps) {
    warnings.push({
      id: null,
      type: "density",
      message: `no visual beat from ${clock(gap.start)} to ${clock(gap.end)} (${Math.round(gap.duration)} s) — add one`,
    });
  }
  for (const item of support.unsupported) {
    warnings.push({
      id: item.id,
      type: "support",
      message: `${item.id || item.type}: ${item.reason}`,
    });
  }
  for (const item of support.fallback || []) {
    warnings.push({
      id: item.id,
      type: "support",
      message: `${item.id || item.type}: ${item.reason}`,
    });
  }
  warnings.push(...textGroundingWarnings(plan, segments, { window: windowSeconds }));
  warnings.push(...brollContextWarnings(plan, segments, { window: windowSeconds }));
  warnings.push(...orphanCutWarnings(plan, segments));
  warnings.push(...shortKeepWarnings(plan));
  warnings.push(...layoutCollisionWarnings(plan));
  const dryCuts = smoothing.uncovered
    .slice()
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 8);
  for (const cut of dryCuts) {
    warnings.push({
      id: cut.id,
      type: "cut",
      message: `${cut.id || "cut"}: ${Math.round(cut.duration)} s jump with no b-roll/transition at ${clock(cut.output)} — the cut may feel dry`,
    });
  }
  if (smoothing.uncovered.length > dryCuts.length) {
    warnings.push({
      id: null,
      type: "cut",
      message: `${smoothing.uncovered.length - dryCuts.length} more long jump(s) without visual cover`,
    });
  }

  return { density, support, warnings, cutSmoothing: smoothing };
}

function clock(seconds) {
  const total = Math.max(0, Math.round(number(seconds)));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Propose cuts for silence cleanup from transcript gaps.
 *
 * Gaps between segments at or above `min` become `long-pause` cuts, padded by
 * `pad` seconds on each side. Leading and trailing dead air are included when
 * `duration` is known. The result is sorted by start time.
 *
 * @param {object} transcript
 * @param {{min?:number,pad?:number,duration?:number}} [options]
 * @returns {Array<{id:string,start:number,end:number,reason:string,note:string}>}
 */
export function silenceCuts(transcript, options = {}) {
  const min = Number(options.min);
  const pad = Number(options.pad);
  const threshold = Number.isFinite(min) && min > 0 ? min : 0.8;
  const padding = Number.isFinite(pad) && pad >= 0 ? pad : 0.08;
  const duration = Number(options.duration) || 0;
  const segments = (transcript?.segments || [])
    .filter((segment) => Number.isFinite(Number(segment.start)) && Number.isFinite(Number(segment.end)))
    .map((segment) => ({
      start: Number(segment.start),
      end: Number(segment.end),
      text: String(segment.text || ""),
    }))
    .sort((a, b) => a.start - b.start);
  const cuts = [];
  const add = (start, end, note) => {
    const from = Math.max(0, Number(Number(start).toFixed(3)));
    const to = Math.max(from, Number(Number(end).toFixed(3)));
    if (to - from < 0.2) return;
    cuts.push({
      id: `silence-${String(cuts.length + 1).padStart(3, "0")}`,
      start: from,
      end: to,
      reason: "long-pause",
      note,
    });
  };
  let cursor = 0;
  for (const segment of segments) {
    const gap = segment.start - cursor;
    if (gap >= threshold) {
      const before = segment.text.trim().slice(0, 48);
      add(cursor + padding, segment.start - padding, `gap ${Number(gap.toFixed(2))}s before "${before}"`);
    }
    cursor = Math.max(cursor, segment.end);
  }
  if (duration > cursor && duration - cursor >= threshold) {
    add(cursor + padding, duration, `tail ${Number((duration - cursor).toFixed(2))}s`);
  }
  return cuts;
}

/**
 * Merge incoming cuts into existing ones, joining overlaps and near-adjacent
 * spans. Existing metadata is preserved; mixed reasons become "mixed".
 *
 * @param {Array<object>} existing
 * @param {Array<object>} incoming
 * @returns {Array<object>}
 */
export function mergeSilenceCuts(existing, incoming) {
  const all = [...(existing || []), ...(incoming || [])]
    .filter((cut) => cut && Number.isFinite(Number(cut.start)) && Number.isFinite(Number(cut.end)))
    .map((cut) => ({ ...cut, start: Number(cut.start), end: Number(cut.end) }))
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const cut of all) {
    const last = merged[merged.length - 1];
    if (last && cut.start <= last.end + 0.05) {
      last.end = Math.max(last.end, cut.end);
      if (last.reason !== cut.reason) last.reason = "mixed";
      last.note = [last.note, cut.note].filter(Boolean).join("; ");
    } else {
      merged.push({ ...cut });
    }
  }
  return merged;
}
