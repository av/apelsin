# Apelsin

A photoreal orange in the browser. It sits on a white studio cove; drag across it and the knife cuts it for real: the pieces fall apart under physics, juice sprays and splats on the floor, and every cut face shows the orange's anatomy: peel, white pith, segments, juice vesicles and seeds. Raw WebGL2, no libraries apart from the vendored Rapier physics engine.

## Controls

- **Knife** (K, default): drag across the orange. Every piece under the stroke is cut along the plane through your eye and the stroke.
- **Hand** (H): drag a piece to lift it, let go to toss it. Dragging empty space orbits.
- **Squeeze** (S): press and hold on a cut face. Juice spurts faster the longer you hold.
- **Camera**: right-drag or two fingers to orbit, wheel or pinch to zoom, middle-drag or Shift-drag to pan.
- **Presets** 1–5: Whole, Halves, Wedges, Wheels, Reference (Ivan's two-wedge product shot). Each one starts a fresh orange, cuts it, and lays out the pieces.
- N gives a new orange, R resets, M toggles macro depth of field, P saves a PNG at twice the resolution. The toolbar also picks the variety (Navel, Valencia, Blood, Cara Cara, Mandarin) and the scene (Studio, Kitchen, Dark), and has slow motion and sound.

## Run

No build step. Serve the folder over HTTP and open http://localhost:8000/:

```sh
python3 -m http.server 8000
```

Tests drive the real page in system Chrome:

```sh
npm install
npm test
```

They use the NVIDIA GPU flags by default. Set `APELSIN_GPU=intel` for the iGPU or `APELSIN_GPU=swiftshader` for plain headless Chrome.

Query parameters: `scene=studio|kitchen|dark`, `variety=navel|valencia|blood|caracara|mandarin`, `seed=<int>`, `preset=whole|halves|wedges|wheels|reference`, `q=low|medium|high|ultra`, `test` (fixed timestep, frames advance only through `apelsin.step()`, deterministic), `debug` (frame stats, `apelsin.internals`).

`window.apelsin` exposes `ready`, `info()`, `preset(name)`, `cut(point, normal)`, `setScene(name)`, `setVariety(name)`, `newOrange(seed)`, `setTool(name)`, `step(frames)`, `screenshot(scale)` and `setQuality(name)`.

## How it works

- The orange is a seeded parameter set per variety. One shape function, written identically in JS and GLSL, builds the mesh and physics hull and gives the shader the distance to the peel.
- Pieces never move their vertices: a cut splits the triangle mesh in the orange's rest space and closes each side with a convex cap. The shaders work out the anatomy from the rest-space position, so any cut, at any angle, shows the right layers.
- Lighting is HDR and physically based: a procedural studio environment is prefiltered for GGX reflections and projected to spherical harmonics. The key softbox has its own prefiltered cubemap, which gets PCSS soft shadows and the translucency computed from shadow-map thickness.
- The frame runs as a chain of passes: shadow → depth/normal/velocity pre-pass → SSAO → shading into separate diffuse and specular targets → screen-space subsurface scattering → juice droplets with refraction → TAA → depth of field → bloom → Khronos PBR Neutral tonemap.
- Rapier loads after the first frame. It simulates every piece as a convex hull. Juice droplets are CPU particles that collide with the pieces and splat into a floor wetness map, which the floor shader reads.
- Quality starts at high on desktop and medium on phones. It steps down after 2 s of slow frames and never steps back up.
