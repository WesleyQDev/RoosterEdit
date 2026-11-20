# Blender

Blender is the heavy 3D technique: real geometry, materials, lighting, simulation, and a render that does not have to run inside a browser. It is **optional**. RoosterEdit never installs it and never makes it the default.

Two modes:

- **Headless CLI** — deterministic, scriptable, the right mode for `build` and delivery.
- **MCP** — interactive, for the user who wants to see and change the scene while the agent works.

## Detect and install

`doctor --json` reports `blender.installed`, the binary, and the version. If it is missing:

```bash
winget install BlenderFoundation.Blender     # Windows
brew install --cask blender                  # macOS
sudo apt install blender                     # Debian/Ubuntu
```

Ask before installing. A Blender install is ~300 MB and the render can use the GPU for minutes.

## Headless render (preferred)

Keep the scene script in the project, not in the skill:

```text
style/blender/<scene>.py
style/blender/<scene>.blend
renders/intermediate/<scene>/frame-####.png
```

Render a deterministic image sequence, then encode it with FFmpeg or place it as a b-roll clip:

```bash
blender --background style/blender/<scene>.blend \
  --python style/blender/<scene>.py \
  --render-output //../../renders/intermediate/<scene>/frame- \
  --render-frame 1-120
```

Rules:

- Set the frame rate and resolution in the script; do not inherit whatever the `.blend` had.
- Seed every random value (`seed`, particle seeds, noise offsets).
- Use EEVEE for drafts and Cycles for delivery only when the look needs it.
- `--background` has no UI; a script that opens a dialog will hang. Test one frame first.
- Write the log to `work/logs/blender.log` and read the tail only.
- For a transparent element, render PNG with RGBA or a ProRes 4444 sequence; check alpha before placing it over footage.
- For a 3D scene that should sit behind type, render a clean plate with no text.

## GPU

Blender uses the GPU through Cycles (CUDA/OptiX for NVIDIA, HIP for AMD, Metal for Apple) or EEVEE. `doctor --json` tells you the vendor; do not assume a backend is configured. Check once:

```bash
blender --background --python-expr "import bpy; print(bpy.context.preferences.addons['cycles'].preferences.compute_device_type)"
```

If the GPU backend is not configured, render on the CPU for the draft and say so. Do not promise a GPU render without testing a frame.

## Interactive MCP (optional)

The `mcp-for-blender` server (MIT, community project) connects an agent to a **running** Blender instance. It can execute Python, inspect the scene, take viewport/camera/multi-angle snapshots, and import assets (Poly Haven CC0, Poly Pizza, Sketchfab).

Use it only when the user wants to iterate in the viewport. The headless CLI is better for a build that must be reproducible.

Setup, with permission:

```bash
uvx mcp-for-blender setup
```

The OpenCode entry looks like:

```json
{
  "mcp": {
    "blender-mcp": {
      "type": "local",
      "command": ["uvx", "mcp-for-blender"],
      "enabled": true,
      "environment": {
        "BLENDER_HOST": "localhost",
        "BLENDER_PORT": "9876",
        "BLENDER_MCP_SAFE_MODE": "1",
        "DISABLE_TELEMETRY": "true"
      }
    }
  }
}
```

The user must restart the agent before the tools appear.

### Security

- The addon's socket has **no authentication or encryption**. Anyone who can reach the port can run Python in Blender. Keep it on `localhost`; prefer an SSH tunnel over exposing it.
- `BLENDER_MCP_SAFE_MODE=1` blocks file writes, process execution, and network access in scripts. Use it unless the scene genuinely needs those.
- `DISABLE_TELEMETRY=true` turns off the minimal anonymous usage record.
- The server can call paid generators (Meshy, Tripo, Hyper3D, World Labs). Never call one without explicit permission and a cost check.

## Assets and licenses

- Poly Haven is CC0: no attribution required, but keep the source and the license in `assets/manifest.json`.
- Poly Pizza is mixed: about 69% is CC-BY and requires credit. Record the credit line the importer stores on the object.
- Sketchfab models keep their own license; check before downloading.
- Never ship a `.blend` or texture you cannot license.

## Delivery

Blender does not assemble the video. Render the shot, put the result in `assets/generated/` (or `assets/licensed/`), and add it to the plan as a `broll` element. If the shot needs to be editable by hand, use FilmCraft as the timeline and place the rendered clip there.

## QA

- Look at the first and last frame, not only the middle.
- Check that the lighting matches the surrounding footage; a CGI shot next to a window-lit interview needs a grade.
- Check the alpha channel before compositing.
- Confirm the clip duration and frame rate with FFprobe after the encode.
- If the shot is the hook, it must be readable in the first second; do not spend it on a slow camera move.
