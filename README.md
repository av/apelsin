# Apelsin

A photoreal orange in your browser. It sits on a white studio cove. Drag across it and a steel knife follows your stroke; let go and the orange is cut with a crunch and a squish. The halves fall open and settle, juice beads drip from the fresh faces, and every cut face shows the orange's anatomy: peel, white pith, segments, juice vesicles and seeds. Press and hold a cut face to squeeze it, or pick the pieces up and toss them. Raw WebGL2, no libraries apart from the vendored Rapier physics engine.

## Controls

- **Knife** (K, default): drag across the orange. A chef's knife glides along the stroke, and on release every piece under the stroke is cut along the plane through your eye and the stroke. It works on any piece from any camera angle, as many times as you like.
- **Hand** (H): drag a piece to lift and swing it, flick to toss it. Pieces bounce, roll, come to rest and stack on each other. Dragging empty space orbits.
- **Squeeze** (S): press and hold a piece. It squashes a little, and juice jets from its cut face faster the longer you hold, runs down the peel and pools on the floor.
- **Camera**: right-drag or two fingers to orbit, wheel or pinch to zoom, middle-drag or Shift-drag to pan.
- **Presets** 1–5: Whole, Halves (face up), Wedges, Wheels (fanned rounds) and Reference (two equatorial quarters composed like Ivan's product shot). Each preset starts a fresh orange, cuts it for real and lays out the pieces already settled, so they never creep.
- N gives a new orange, R resets, M toggles macro depth of field, T toggles slow motion (physics and juice at a quarter speed), A toggles sound, P saves a PNG at twice the resolution. The toolbar also picks the variety (Navel, Valencia, Blood, Cara Cara, Mandarin) and the scene (Studio, Kitchen, Dark). Hover a button for its name and shortcut.
- On phones the toolbar sits at the bottom in two rows with 44 px targets. One finger uses the tool, two fingers orbit and pinch, and the page never scrolls, zooms or selects text.

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

Query parameters: `scene=studio|kitchen|dark`, `variety=navel|valencia|blood|caracara|mandarin`, `seed=<int>`, `preset=whole|halves|wedges|wheels|reference`, `q=low|medium|high|ultra`, `test` (fixed timestep, frames advance only through `apelsin.step()`, deterministic), `debug` (frame stats, `apelsin.internals`).

`window.apelsin` exposes `ready`, `info()`, `preset(name)`, `cut(point, normal)`, `setScene(name)`, `setVariety(name)`, `newOrange(seed)`, `setTool(name)`, `step(frames)`, `screenshot(scale)`, `setQuality(name)`, `camera(options)`, `toggle('slowmo' | 'macro')`, `poses()`, `project(point)`, `contacts()` and `wetness()`.

## How it works

- The orange is a seeded parameter set per variety. One shape function, written identically in JS and GLSL, builds the mesh and gives the shader the distance to the peel.
- Pieces never move their vertices: a cut splits the triangle mesh in the orange's rest space and closes each side with a convex cap. The shaders work out the anatomy from the rest-space position, so any cut, at any angle, shows the right layers.
- Lighting is HDR and physically based: a procedural studio environment is prefiltered for GGX reflections and projected to spherical harmonics. The key softbox has its own prefiltered cubemap, which gets PCSS soft shadows and the translucency computed from shadow-map thickness.
- The frame runs as a chain of passes: shadow → depth/normal/velocity pre-pass → SSAO → shading into separate diffuse and specular targets → screen-space subsurface scattering → juice droplets with refraction → TAA → depth of field → bloom → Khronos PBR Neutral tonemap.
- The knife is a real mesh (ground blade with an edge bevel, bolster, wooden handle with rivets) drawn through the same pipeline in brushed steel, so it casts shadows, reflects the studio and sinks into the fruit where the stroke passes.
- Rapier loads after the first frame. Each piece is a rigid body whose contacts are a packed set of spheres fitted inside its surface: tangent to the flat cut faces, larger under the peel. Convex-hull contacts in this Rapier build let pieces creep and sink, spheres do not. A hidden convex hull gives each piece its real mass and inertia. Rolling resistance stops oranges from rolling forever, wet cut faces slide on each other, and a piece that has come to rest is held still until something hits it.
- Juice is CPU particles: a burst of droplets and peel-oil mist along each new cut, pendant drops that grow on the lowest edge of a fresh face and let go, and jets while squeezing. Drops stretch with speed, refract what is behind them and catch the key light. They cling to the peel as they run down it. Where they land they add a soft blob to a floor wetness map, which holds water and sticky residue separately. Overlapping blobs merge into puddles, and the floor shader turns the map into stains with an irregular, darker rim, a glossy meniscus and a slow drying to a dull film.
- Every sound is synthesised in the browser: rind crackle and a wet, bubbly squelch on each cut (longer for bigger cut faces) that ends with a tap on the board, thuds whose pitch and body depend on the impact, the piece's mass and the surface (paper, wood, stone, slate), a rolling rumble, drips and a continuous squish while squeezing, all through a short room reverb, a compressor and a limiter.
- Quality starts at high on desktop and medium on phones. It steps down after 2 s of slow frames and never steps back up.
