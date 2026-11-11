# OCR

Read text and word boxes from a frame. Use it for screen recordings, slides, product demos, and text inside b-roll. Do not OCR text the plan already authored: the plan has the string and the position.

## Command

```bash
node "<skill>/scripts/rooster.mjs" ocr <slug> --at 12.5 --lang pt-BR
node "<skill>/scripts/rooster.mjs" ocr <slug> --image still.png --json
```

Options:

- `--image <path>` reads a still instead of a video frame.
- `--input <path>` uses a specific video (default: `plan.source`).
- `--at <seconds>` picks the frame (default: 0).
- `--lang <code>` defaults to the project language.
- `--provider winrt|vision|tesseract|wasm` forces one adapter; `auto` picks the cheapest available.
- `--out <path>` writes a JSON file or a directory (default: `qa/ocr/`).
- `--refresh` ignores the cached result.

The result is `rooster.ocr/v1`: text plus `words[]` with pixel boxes and confidence. It is cached by frame and provider; rerunning prints the cached file.

## Providers

| Provider | Platform | Download | Notes |
|---|---|---|---|
| `winrt` | Windows | none | `Windows.Media.Ocr`; language must be installed in Windows |
| `vision` | macOS | none | Vision framework via a small Swift helper (needs Xcode CLT) |
| `tesseract` | any | system install | `tesseract … tsv` |
| `wasm` | any | `tools install ocr-wasm --approve` | tesseract.js in `~/.rooster/tools/ocr-wasm` |

`auto` order: native OS, Tesseract binary, WASM. No Python and no account.

## Install the optional WASM provider

```bash
node "<skill>/scripts/rooster.mjs" tools list
node "<skill>/scripts/rooster.mjs" tools install ocr-wasm --approve
```

The install runs `npm install --prefix` in the tools cache (not in the skill), records version and license in `manifest.json`, and keeps the package outside the repo. The first OCR downloads the language data into the same cache. `tools remove ocr-wasm` deletes only that folder.

## Privacy and limits

- Frames stay local. No image is uploaded by any provider.
- Windows/macOS native OCR uses the OS language packs; if the language is missing, the engine falls back to the user profile language.
- Boxes are in the frame's pixels, so a callout can be placed exactly over the detected text.
- OCR is not a text-layout engine: reading order, tables, and handwriting are out of scope.
- Do not use OCR to claim a license or provenance for an asset.

## QA use

- Detect text in a screen recording and place a highlight/callout over it.
- Check that a burned-in title matches the plan string.
- Find small text that must be avoided when cropping to 9:16.
