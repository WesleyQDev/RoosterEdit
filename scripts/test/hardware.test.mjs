import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyVendor,
  describeHardware,
  detectHardware,
  isHardwareEncoder,
  parseFfmpegEncoders,
  parseLspci,
  parseNvidiaSmi,
  parseSystemProfiler,
  parseWindowsVideoControllers,
  recommendEncoders,
  resolveEncoder,
} from "../lib/hardware.mjs";

test("classifyVendor recognizes the four families and stays conservative", () => {
  assert.equal(classifyVendor("NVIDIA GeForce RTX 4070"), "nvidia");
  assert.equal(classifyVendor("AMD Radeon RX 6600"), "amd");
  assert.equal(classifyVendor("Intel(R) Arc(TM) A770 Graphics"), "intel");
  assert.equal(classifyVendor("Apple M3 Pro"), "apple");
  assert.equal(classifyVendor("Microsoft Basic Display Adapter"), "unknown");
});

test("parseNvidiaSmi reads name, memory and driver", () => {
  const rows = parseNvidiaSmi(
    "NVIDIA GeForce RTX 4070, 12282 MiB, 566.36\nNVIDIA GeForce RTX 4070, 12282 MiB, 566.36\n"
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "NVIDIA GeForce RTX 4070");
  assert.equal(rows[0].vramMB, 12282);
  assert.equal(rows[0].driver, "566.36");
  assert.equal(rows[0].vendor, "nvidia");
  assert.deepEqual(parseNvidiaSmi(""), []);
});

test("parseWindowsVideoControllers handles one adapter and several", () => {
  const one = parseWindowsVideoControllers(
    JSON.stringify({ Name: "AMD Radeon RX 6600", AdapterRAM: 4293918720, DriverVersion: "32.0.1" })
  );
  assert.equal(one.length, 1);
  assert.equal(one[0].vendor, "amd");
  assert.equal(one[0].driver, "32.0.1");

  const two = parseWindowsVideoControllers(
    JSON.stringify([
      { Name: "Intel(R) UHD Graphics 770", AdapterRAM: 1073741824 },
      { Name: "NVIDIA GeForce RTX 3060", AdapterRAM: 12884901888 },
    ])
  );
  assert.deepEqual(
    two.map((row) => row.vendor),
    ["intel", "nvidia"]
  );

  const filtered = parseWindowsVideoControllers(
    JSON.stringify([{ Name: "Microsoft Basic Display Adapter" }])
  );
  assert.equal(filtered.length, 0);
  assert.deepEqual(parseWindowsVideoControllers("not json"), []);
});

test("parseSystemProfiler reads Apple Silicon", () => {
  const rows = parseSystemProfiler(
    JSON.stringify({
      SPDisplaysDataType: [
        { _name: "Apple M4 Pro", sppci_model: "Apple M4 Pro", spdisplays_vram: "24 GB" },
      ],
    })
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].vendor, "apple");
  assert.equal(rows[0].name, "Apple M4 Pro");
  assert.equal(rows[0].vramMB, 24 * 1024);
});

test("parseLspci keeps display controllers only", () => {
  const rows = parseLspci(
    [
      '00:02.0 "VGA compatible controller" "Intel Corporation" "Raptor Lake-P [Iris Xe Graphics]" -r04',
      '00:1f.3 "Audio device" "Intel Corporation" "Raptor Lake High Definition Audio Controller"',
      '03:00.0 "3D controller" "NVIDIA Corporation" "GA107M [GeForce RTX 3050 Mobile]"',
    ].join("\n")
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].vendor, "intel");
  assert.equal(rows[1].vendor, "nvidia");
  assert.match(rows[1].name, /GeForce RTX 3050/);
});

test("parseFfmpegEncoders finds hardware encoders and ignores software ones", () => {
  const encoders = parseFfmpegEncoders(
    [
      " V....D libx264              libx264 H.264 / AVC (codec h264)",
      " V....D h264_amf             AMD AMF H.264 Encoder (codec h264)",
      " V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)",
      " V..... h264_qsv             H.264 (Intel Quick Sync Video acceleration) (codec h264)",
      " V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)",
    ].join("\n")
  );
  assert.ok(encoders.has("h264_amf"));
  assert.ok(encoders.has("h264_nvenc"));
  assert.ok(encoders.has("h264_qsv"));
  assert.ok(encoders.has("h264_videotoolbox"));
});

test("recommendEncoders maps vendor to codec and platform", () => {
  const winAmd = recommendEncoders({
    vendor: "amd",
    platform: "win32",
    encoders: ["h264_amf", "hevc_amf", "av1_amf"],
  });
  assert.deepEqual(winAmd, { h264: "h264_amf", hevc: "hevc_amf", av1: "av1_amf" });

  const linuxAmd = recommendEncoders({
    vendor: "amd",
    platform: "linux",
    encoders: ["h264_amf", "h264_vaapi", "hevc_vaapi"],
  });
  assert.deepEqual(linuxAmd, { h264: null, hevc: null, av1: null });

  const nvidiaNoAv1 = recommendEncoders({
    vendor: "nvidia",
    platform: "win32",
    encoders: ["h264_nvenc", "hevc_nvenc"],
  });
  assert.deepEqual(nvidiaNoAv1, { h264: "h264_nvenc", hevc: "hevc_nvenc", av1: null });

  const unknown = recommendEncoders({ vendor: "unknown", encoders: ["h264_nvenc"] });
  assert.deepEqual(unknown, { h264: null, hevc: null, av1: null });
});

test("resolveEncoder uses hardware for drafts, software for delivery", () => {
  const hardware = {
    detected: true,
    recommended: { h264: "h264_amf", hevc: "hevc_amf", av1: "av1_amf" },
  };
  assert.equal(resolveEncoder("auto", { quality: "draft", hardware }), "h264_amf");
  assert.equal(resolveEncoder(undefined, { quality: "draft", hardware }), "h264_amf");
  assert.equal(resolveEncoder("auto", { quality: "final", hardware }), "libx264");
  assert.equal(resolveEncoder("h264_nvenc", { quality: "final", hardware }), "h264_nvenc");
  assert.equal(
    resolveEncoder("auto", { quality: "draft", hardware, env: { ROOSTER_ENCODER: "libx264" } }),
    "libx264"
  );
  assert.equal(
    resolveEncoder("auto", { quality: "final", hardware, env: { ROOSTER_ENCODER: "h264_amf" } }),
    "h264_amf"
  );
  assert.throws(() => resolveEncoder("bad;encoder", { hardware }), TypeError);
});

test("isHardwareEncoder separates hardware ids from libx264", () => {
  assert.equal(isHardwareEncoder("h264_amf"), true);
  assert.equal(isHardwareEncoder("hevc_nvenc"), true);
  assert.equal(isHardwareEncoder("h264_videotoolbox"), true);
  assert.equal(isHardwareEncoder("libx264"), false);
  assert.equal(isHardwareEncoder("copy"), false);
});

test("detectHardware combines OS adapters with FFmpeg encoders", () => {
  const calls = [];
  const run = (name, args) => {
    calls.push([name, args]);
    if (name === "nvidia-smi") return { status: 1, stdout: "", stderr: "" };
    if (name === "powershell.exe") {
      return {
        status: 0,
        stdout: JSON.stringify({
          Name: "AMD Radeon RX 6600",
          AdapterRAM: 4293918720,
          DriverVersion: "32.0.1",
        }),
        stderr: "",
      };
    }
    if (name === "ffmpeg") {
      return {
        status: 0,
        stdout: " V....D h264_amf AMD AMF H.264 Encoder\n V....D hevc_amf AMD AMF HEVC encoder\n",
        stderr: "",
      };
    }
    return { status: 1, stdout: "", stderr: "" };
  };

  const hardware = detectHardware({ platform: "win32", arch: "x64", run });
  assert.equal(hardware.detected, true);
  assert.equal(hardware.vendor, "amd");
  assert.equal(hardware.name, "AMD Radeon RX 6600");
  assert.equal(hardware.recommended.h264, "h264_amf");
  assert.equal(hardware.delivery, "libx264");
  assert.equal(hardware.note, null);
  assert.ok(calls.some(([name]) => name === "ffmpeg"));
  assert.match(describeHardware(hardware), /AMD Radeon RX 6600/);
  assert.match(describeHardware(hardware), /h264_amf/);
});

test("detectHardware reports a GPU without a usable encoder", () => {
  const run = (name) => {
    if (name === "powershell.exe") {
      return { status: 0, stdout: JSON.stringify({ Name: "AMD Radeon RX 6600" }), stderr: "" };
    }
    if (name === "ffmpeg" || name === "nvidia-smi") {
      return { status: 1, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "" };
  };
  const hardware = detectHardware({ platform: "win32", run });
  assert.equal(hardware.detected, true);
  assert.equal(hardware.recommended.h264, null);
  assert.match(hardware.note, /no matching hardware encoder/);
  assert.match(describeHardware(hardware), /no hardware encoder/);
});

test("detectHardware degrades to CPU when nothing is found", () => {
  const hardware = detectHardware({
    platform: "linux",
    run: () => ({ status: 1, stdout: "", stderr: "" }),
  });
  assert.equal(hardware.detected, false);
  assert.equal(hardware.recommended.h264, null);
  assert.equal(describeHardware(hardware), "not detected (CPU)");
});
