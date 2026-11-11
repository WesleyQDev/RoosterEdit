/**
 * Encoder argument builders.
 *
 * Pure: no filesystem access, no processes. Hardware encoders accept different
 * quality flags than libx264/libx265, so a plain `-crf` for every encoder would
 * fail at runtime.
 */

/**
 * Build encoder-specific video arguments.
 *
 * @param {{encoder?: string, crf?: number, preset?: string}} options
 * @returns {string[]}
 */
export function videoEncoderArgs({ encoder = "libx264", crf = 20, preset = "veryfast" } = {}) {
  const name = String(encoder || "libx264").trim();
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new TypeError(`videoEncoderArgs: invalid encoder "${name}"`);
  }
  if (name === "copy") return ["-c:v", "copy"];

  const quality = Number(crf);
  if (!Number.isFinite(quality) || quality < 0 || quality > 63) {
    throw new RangeError("videoEncoderArgs: crf must be between 0 and 63");
  }
  const q = String(quality);
  const presetName = String(preset || "").trim();

  switch (name) {
    case "h264_nvenc": {
      const speed = /^p[1-7]$/.test(presetName) ? presetName : "p4";
      return ["-c:v", name, "-preset", speed, "-rc", "vbr", "-cq", q];
    }
    case "h264_amf": {
      const speed = ["speed", "balanced", "quality"].includes(presetName)
        ? presetName
        : "speed";
      return [
        "-c:v",
        name,
        "-quality",
        speed,
        "-rc",
        "cqp",
        "-qp_i",
        q,
        "-qp_p",
        q,
      ];
    }
    case "h264_qsv":
      return ["-c:v", name, "-preset", presetName || "veryfast", "-global_quality", q];
    case "h264_videotoolbox":
      return ["-c:v", name, "-q:v", q];
    default:
      return ["-c:v", name, "-preset", presetName || "veryfast", "-crf", q];
  }
}
