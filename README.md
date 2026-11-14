# Apelsin

One hyperrealistic navel orange in your browser, lit like a classic studio product shot on a white cove. Drag across it and a steel knife follows your stroke; let go and the orange is cut with a crunch and a squish. The pieces fall open and settle, a few juice beads drip from the fresh faces, and every cut face shows the orange's anatomy: peel, white pith, segments, juice vesicles and the pale core. Pick the pieces up and toss them, or orbit in close. Raw WebGL2, no libraries apart from the vendored Rapier physics engine.

## Controls

- **Knife** (K, default): drag across the orange. A chef's knife glides along the stroke, and on release every piece under the stroke is cut along the plane through your eye and the stroke. It works on any piece from any camera angle, as many times as you like.
- **Hand** (H): drag a piece to lift and swing it, flick to toss it. Pieces bounce, roll, come to rest and stack on each other. Dragging empty space orbits.
- **Camera**: right-drag or two fingers to orbit, wheel or pinch to zoom, middle-drag or Shift-drag to pan.
- **Presets** 1–4: Whole, Halves (face up), Wedges and Reference (two equatorial quarters composed as a classic studio product shot). Each preset starts a fresh orange, cuts it for real and lays out the pieces already settled, so they never creep.
- N gives a new orange, R resets, A toggles sound, P saves a PNG at twice the resolution. Hover a toolbar button for its name and shortcut.
- On phones the toolbar is a single row at the bottom with 44 px tall targets. One finger uses the tool, two fingers orbit and pinch, and the page never scrolls, zooms or selects text.

## Run

No build step. Serve the folder over HTTP and open http://localhost:8000/:

```sh
python3 -m http.server 8000
```

Tests drive the real page in system Chrome, including mouse strokes and multi-touch through the DevTools protocol:

```sh
npm install
npm test
```

They use the NVIDIA GPU flags by default. Set `APELSIN_GPU=intel` for the iGPU or `APELSIN_GPU=swiftshader` for plain headless Chrome.

Query parameters: `seed=<int>` (a new random seed on every load otherwise), `preset=whole|halves|wedges|reference`, `q=low|medium|high|ultra`, `test` (fixed timestep, frames advance only through `apelsin.step()`, deterministic), `debug` (frame stats, `apelsin.internals`).

`window.apelsin` exposes `ready`, `info()`, `preset(name)`, `cut(point, normal)`, `newOrange(seed)`, `setTool('knife' | 'hand')`, `step(frames)`, `screenshot(scale)`, `setQuality(name)`, `camera(options)`, `poses()`, `project(point)`, `contacts()` and `wetness()`.

## How it works

- The orange is a seeded navel-orange parameter set. One shape function, written identically in JS and GLSL, builds the mesh and gives the shader the distance to the peel.
- Pieces never move their vertices: a cut splits the triangle mesh in the orange's rest space and closes each side with a convex cap. The shaders work out the anatomy from the rest-space position, so any cut, at any angle, shows the right layers.
- Lighting is HDR and physically based: a procedural studio environment is prefiltered for GGX reflections and projected to spherical harmonics. The key softbox has its own prefiltered cubemap, which gets PCSS soft shadows and the translucency computed from shadow-map thickness.
- The frame runs as a chain of passes: shadow → depth/normal/velocity pre-pass → SSAO → shading into separate diffuse and specular targets → screen-space subsurface scattering → juice droplets with refraction → TAA → depth of field (only when the scene sets an f-stop) → bloom → Khronos PBR Neutral tonemap.
- The knife is a real mesh (ground blade with an edge bevel, bolster, wooden handle with rivets) drawn through the same pipeline in brushed steel, so it casts shadows, reflects the studio and sinks into the fruit where the stroke passes.
- Rapier loads after the first frame. Each piece is a rigid body whose contacts are a packed set of spheres fitted inside its surface: tangent to the flat cut faces, larger under the peel. Convex-hull contacts in this Rapier build let pieces creep and sink, spheres do not. A hidden convex hull gives each piece its real mass and inertia. Rolling resistance stops oranges from rolling forever, wet cut faces slide on each other, and a piece that has come to rest is held still until something hits it.
- Juice is CPU particles: a burst of droplets and peel-oil mist along each new cut, and pendant drops that grow on the lowest edge of a fresh face and let go. Drops stretch with speed, refract what is behind them and catch the key light. They cling to the peel as they run down it. Where they land they add a soft blob to a floor wetness map, which holds water and sticky residue separately. Overlapping blobs merge into puddles, and the floor shader turns the map into stains with an irregular, darker rim, a glossy meniscus and a slow drying to a dull film.
- Every sound is synthesised in the browser: rind crackle and a wet, bubbly squelch on each cut (longer for bigger cut faces) that ends with a tap on the cove, thuds whose pitch and body depend on the impact, the piece's mass and whether it hit the paper cove or another piece, a rolling rumble and drips, all through a short room reverb, a compressor and a limiter.
- Quality starts at high on desktop and medium on phones. It steps down after 2 s of slow frames and never steps back up.
