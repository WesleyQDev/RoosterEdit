# 3D cartoon

Use this playbook for short 3D animations with characters, products, or abstract scenes built with Three.js.

## When to use

- the user wants a 3D character, product, or environment;
- the video is generated rather than filmed;
- the style is cartoon, low-poly, clay, toy, or stylized.

## Intake specifics

- What is the subject: character, product, abstract scene, environment?
- What style: low-poly, clay, toy, Pixar-like, sci-fi, minimalist?
- Is there dialogue, narration, or only music and captions?
- What is the exact duration and aspect ratio?
- Is there a reference image or video?
- Does the character need to speak, blink, or gesture?
- What is the render budget (time, GPU, resolution)?

## Style rules

Write these before modeling anything:

- **Shape language**: rounded vs sharp, chunky vs realistic, symmetric vs organic.
- **Palette**: 3–5 colors, one accent, one neutral.
- **Lighting**: soft key + fill + rim, or stylized flat; avoid realistic global illumination unless needed.
- **Materials**: matte, clay, plastic, metal, emissive; keep one dominant material family.
- **Camera**: orthographic vs perspective, lens, height, movement.
- **Motion**: squash/stretch, overshoot, anticipation, follow-through.
- **Background**: gradient, void, simple set, or environment; keep it quiet.
- **Post**: grain, vignette, bloom; use sparingly and consistently.

A style guide with 5–8 reference frames is more useful than a paragraph of adjectives.

## Structure

| Beat | Goal | Typical duration |
|---|---|---|
| Hook | A striking visual or question | 0–3 s |
| Setup | Character and world | 3–8 s |
| Action | The main visual idea | 8–70% |
| Turn | A surprise or transformation | 70–85% |
| Payoff | The result | 85–95% |
| CTA | End card or next step | 95–100% |

A 20-second short can be a single continuous shot or 3–5 shots. A 60-second short needs 6–10 shots.

## Storyboard

Each shot should specify:

- camera position and movement;
- subject pose/action;
- background;
- lighting;
- duration;
- transition;
- on-screen text or caption;
- audio cue.

Draw or describe the key frame for each shot. If the character is the focus, sketch the silhouette first; if the product is the focus, sketch the camera path first.

## Character

- Start with a simple rig: root, body, head, limbs, eyes.
- Use primitives and low-poly geometry; avoid complex sculpts.
- Keep the silhouette readable at mobile size.
- Exaggerate proportions: bigger head, simpler hands, clear eyes.
- Animate with a few key poses, not a full simulation.
- Use squash/stretch and anticipation for appeal.
- Avoid realistic skin, hair, and cloth unless the render budget supports it.

## Three.js

### Determinism

- Drive all animation from the frame/time value, not `Date.now()` or real-time `requestAnimationFrame`.
- Use seeded randomness for particles and variation.
- Do not use physics unless the simulation is deterministic and reproducible.
- Avoid network fetches during render.

### Remotion + `@remotion/three`

```tsx
import { ThreeCanvas } from "@remotion/three";
import { useCurrentFrame, interpolate } from "remotion";

export const Robot = () => {
  const frame = useCurrentFrame();
  const y = interpolate(frame, [0, 30, 60], [0, -0.4, 0], {
    extrapolateRight: "clamp",
  });
  const rotation = frame * 0.02;
  return (
    <ThreeCanvas width={1080} height={1920} camera={{ position: [0, 1.2, 6], fov: 45 }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 5, 4]} intensity={1.3} />
      <group position={[0, y, 0]} rotation={[0, rotation, 0]}>
        <mesh>
          <boxGeometry args={[1.2, 1.6, 0.8]} />
          <meshStandardMaterial color="#22d3ee" roughness={0.5} />
        </mesh>
      </group>
    </ThreeCanvas>
  );
};
```

### HyperFrames + Three.js

- Import Three.js from a local file in `assets/vendor/`.
- Create the renderer and scene once.
- Drive the animation from the GSAP timeline's time value.
- Render a frame on each seek; do not start a real-time loop.
- Register the timeline after creating the scene.
- Snapshot the midpoint of each 3D scene to verify the mount.

## Lighting and materials

- Use a key light, a fill, and a rim light for readable shapes.
- Keep shadows soft or disabled if render time matters.
- Use `MeshStandardMaterial` for a modern look; `MeshToonMaterial` for a cel-shaded look.
- Avoid expensive refraction, subsurface scattering, and heavy post-processing in v1.
- Use a gradient background instead of a complex environment map when possible.

## Camera

- Keep the subject centered for vertical video.
- Use a slow dolly or orbit for elegance; use a snap zoom for comedy.
- Avoid rapid camera moves that make the viewer motion-sick.
- Match the camera language to the style: toy = low angle, tech = clean orbit, clay = static wide.

## Audio

- If there is no voice, music and SFX carry the rhythm.
- Use SFX for footstep, whoosh, pop, impact, and UI moments.
- Keep the mix simple: music bed + 3–6 SFX.
- If there is narration, generate TTS per line and time the animation to it.
- Captions are essential for silent social video.

## Render

- Test one still per scene before rendering the full video.
- Render a low-resolution draft first.
- Keep the render deterministic; do not use real-time clocks.
- Check the first, middle, and last frames.
- Watch for blank frames, missing geometry, black materials, and camera clipping.
- If the render is slow, reduce polygon count, shadow quality, and post-processing before lowering resolution.

## QA

- [ ] The character silhouette reads at mobile size.
- [ ] The palette and materials are consistent.
- [ ] The camera movement is smooth and motivated.
- [ ] The animation has anticipation and follow-through.
- [ ] No blank or broken frames.
- [ ] The 3D scene mounts correctly in the engine.
- [ ] Captions are readable and in the safe area.
- [ ] Music and SFX are licensed.
- [ ] The render duration matches the timeline.
- [ ] The video works without sound.

## Example

A 20-second short: a cute robot discovers a glowing quantum coin.

1. Hook: the robot's eyes light up in the dark. (0–3 s)
2. Setup: it reaches for a floating coin. (3–7 s)
3. Action: the coin splits into superposition rings. (7–14 s)
4. Turn: the robot's head tilts in wonder. (14–17 s)
5. CTA: text "Quântica é estranha. E linda." (17–20 s)

Style: low-poly, teal/coral palette, soft key light, simple gradient background, slow orbit camera, minimal SFX, captions bottom.
