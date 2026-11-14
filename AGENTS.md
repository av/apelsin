# AGENTS.md — Apelsin

The realism bar is `/tmp/apelsin-work/refs/ivan-reference-wedges.jpg` (when present), and the numbers come from `/tmp/apelsin-work/research/REALISM.md`.

## Conventions

- Buildless ES modules served as static files. No bundler, no TypeScript, no runtime CDN. The only runtime dependency is `vendor/rapier/rapier.mjs`.
- No code comments of any kind. Shaders live in JS modules as template strings.
- Tests are end-to-end only (`test/e2e.test.mjs`: node --test + playwright-core + system Chrome). Every behaviour change gets a user-visible assertion there. Look at your own screenshots.
- Units: metres, Y up, floor top at y = 0. Author colours in linear space; sRGB happens only in the tonemap pass.
- **Rest-space rule**: piece vertices stay in the orange's rest space forever (origin = orange centre, +Y = stem). The model matrix is `T(position) · R(rotation) · T(−com)`, where `position` is the body's world centre of mass (`orange/piece.js updateModel`). Shading is a function of rest position.
- Commit each logical change. Messages are lowercase and imperative, under 72 chars.

## Module map

| File | Responsibility |
|---|---|
| `src/main.js` | boot, app state, frame loop, auto quality, URL params, `window.apelsin` |
| `src/gl.js` | context, `program()` with readable errors, textures, FBOs, `ubo()`, `mesh()`, fullscreen triangle |
| `src/renderer.js` | tiers, render targets, Frame UBO packing, `passes` array (the frame graph), material programs |
| `src/ibl.js` | procedural env → source cube, GGX prefilter, SH9, BRDF LUT; env cube and key-only cube |
| `src/shadows.js` | key-light ortho shadow map fitted to the pieces' bounds |
| `src/post.js` + `src/shaders/post.js` | SSAO, SSS, combine/background, TAA, DOF, bloom, tonemap |
| `src/shaders/common.js` | Frame UBO, noise/Voronoi, `Surface`, `shadeSurface()` (shared lighting) |
| `src/shaders/materials.js` | uber VS/FS builder, backdrop materials (cove, board, counter, slate), wetness |
| `src/orange/params.js` | variety table, seeded params, `packOrange()` → Orange UBO |
| `src/orange/mesh.js` | `shapeRadius` (JS twin of GLSL `orangeShapeRadius`), base mesh, mesh analysis, hull points, raycast |
| `src/orange/slice.js` | plane split of a triangle soup into two closed pieces with convex caps |
| `src/orange/piece.js` | piece object, model matrices, rest/world conversions, picking |
| `src/orange/glsl.js` | Orange UBO, shape, rind surface, interior (cut-face) surface |
| `src/world.js` | piece list, new orange, `cut()`, physics sync, bounds |
| `src/physics.js` | Rapier world, sphere-compound piece bodies (hidden hull for mass), rolling resistance, rest holding, grab spring, impact events, `settle()` |
| `src/tools.js` | knife / hand / squeeze / camera input and the blade-trail overlay |
| `src/knife.js` | chef's knife mesh and its pose/animation along the stroke (drawable with material `steel`) |
| `src/presets.js` | scripted cuts and compositions, settled with `app.settle()` |
| `src/juice.js` | droplets, mist, pendant drips, squeeze jets, droplet rendering, wetness splats and pooling |
| `src/scenes.js` | Studio / Kitchen / Dark: env lights, backdrop meshes, colliders, camera, grade |
| `src/audio.js`, `src/ui.js` | synthesised sounds; toolbar, hint, keyboard |

## Contracts

- **Uniform blocks**: `Frame` (binding 0, `src/shaders/common.js`; packed in `renderer.js fillFrame` with the offsets in `F`), `Orange` (binding 1, `src/orange/glsl.js`; packed by `packOrange`). If you add a field, update the GLSL block, the float count and the packer together.
- **Per-draw uniforms**: `uModel`, `uPrevModel` (for velocity), `uMaterialColor`.
- **Surface**: each material defines `Surface materialSurface(SurfaceInput si)` and returns a world-space `N`. `SurfaceInput` holds `rest`, `restNormal`, `world`, `normal`, `V`, `cap` (1 on cut faces), `restToWorld`, `pixel` (world size of a pixel, for `fwidth`-style filtering). The lighting (`shadeSurface`) never knows about anatomy.
- **Surface field meanings**: `sssProfile` is 0 none, 1 rind, 2 pith/core, 3 flesh, with `sssWidth` in 0..1. They are encoded into diffuse alpha by `encodeProfile`. `sssColor` tints the wrapped terminator light. `transmission` is lit through shadow-map thickness. `cavity` multiplies the AO. `emission` goes into the specular target.
- **Materials**: `MATERIALS` in `shaders/materials.js` maps a name to GLSL. Drawables carry `material`, which selects the compiled program. Adding a material means one GLSL entry plus a scene backdrop or a drawable that uses it.
- **Render pass**: insert `{ name, enabled(ctx), run(ctx) }` into `renderer.passes` at the right position. Read `ctx.targets` (depth, normal, velocity, diffuse, specular, hdr, hdrCopy) and the current `ctx.color`, and set `ctx.color` to your output. Allocate size-dependent targets in a `resize` (see `post.js`). Never sample a texture that is attached to the bound FBO.
- **Pieces**: `{ id, geometry: { data, count }, com, volume, radius, caps[], gpu, position, rotation, model, prevModel, body, squash }`. Vertex layout is `STRIDE = 7`: position, normal, cap flag (non-indexed triangles). Caps hold `normal`, `d`, `area`, `centroid`, `tris`.
- **Physics**: never give pieces convex-hull contacts; polyhedron contacts in the vendored Rapier creep and tunnel. Contacts are balls (`contactBalls`), statics are cuboids. Collision groups: statics collide with all balls, a coverage subset of each piece's balls (`GROUP_TOUCH`) also collides between pieces. Never call `body.sleep()` by hand (woken bodies then fall through statics): resting pieces are `held` (velocities zeroed each step) and Rapier sleeps them itself. Piece fields owned by physics: `body`, `held`, `contact` (`'ground' | 'piece' | null`), `rolling`, `restTime`, `freshUntil`.
- **Juice**: `cutBurst(piece, cap, params, amount)`, `fresh(piece, cap, seconds)` (drips from the lowest edge), `squeeze(piece, cap, params, dt, hold, state)`, `setVariety(name)` → floor tint. The wetness map is RG16F: R = water (dries in ~50 s), G = deposit (stays). Backdrop materials read it in `applyWetness` and take `uniform vec3 uJuiceTint`, set by `main.js applyJuiceTint` on the backdrop programs.
- **Materials**: `steel` (knife): `cap` attribute 1 = wooden handle, 0 = steel; shading uses rest (local knife) coordinates.
- **Test API additions**: `poses()`, `project(point)`, `contacts()` (`floor` = lowest piece point above the floor, `overlap` = deepest hull point inside another piece), `wetness()` (stain area, m²), `toggle(name)`; `info()` adds `knife, splats, drips, slowmo, macro, squash, muted`.
- **Test mode** (`?test`): `rAF` does not advance anything; `apelsin.step(n)` runs n fixed 1/60 s frames; the camera snaps. `?debug` adds `apelsin.internals`.
