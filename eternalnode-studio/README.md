# EternalNode Studio

**Edit Reality. Build Worlds.**

A unified creative environment: timeline editing, node compositing, 3D, animation
and AI-assisted creation over one project document. Switching workspaces changes
the layout, never the data — nothing is ever exported between modes.

This repository is the **Phase 1–4 prototype**: the real application shell,
running engines, and an architecture shaped so the browser renderer can be
replaced by the native C++/Qt/Vulkan core without touching the UI layer.

---

## Run it

```bash
npm install
npm run dev      # http://localhost:5273
npm run build    # typecheck + production bundle
```

Requires a WebGL2 browser. Chrome or Edge unlock PNG sequence export
(File System Access API).

## First five minutes

1. **Import media** in the project panel, then drag a clip onto a video track.
2. Press **Space** to play. Trim with the clip edges, **Shift-drag** to slip.
3. Press **⌘K / Ctrl+K** and type *"make this look like a damaged cyberpunk
   security recording"*. E.L.A.I.N.E. shows the plan before it builds anything.
4. **Build it** — you land in the Nodes workspace with a real, editable chain
   feeding the viewport.
5. Click a node, hit the **◆** beside a parameter in the Inspector to animate it,
   then open the **Graph editor** to shape the curve.
6. **Export** → WebM records the live GPU composite.

### Keyboard

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← → | Step one frame (Shift = ten) |
| S | Split at playhead |
| Delete / Shift+Delete | Delete / ripple delete |
| 1 2 3 4 | Edit / Nodes / Model / Animate |
| ⌘K | E.L.A.I.N.E. command bar |
| ⌘Z / ⇧⌘Z | Undo / redo |
| ⌘S | Save project |

---

## Architecture

```
src/
├── core/        Document model, store, undo history, project format
├── media/       Import, probing, thumbnails, decoder element pool
├── timeline/    Clip operations, snapping, transport clock, timeline UI
├── nodes/       Registry, evaluator, node editor
├── video/       WebGL2 compositor, shaders, program monitor
├── threeD/      Scene document, three.js viewport, gizmos
├── animation/   Keyframes, easing, curve editor
├── materials/   (reserved — shares nodes/registry)
├── audio/       (reserved — peaks, mixer, beat detection)
├── ai/          E.L.A.I.N.E. planner and command bar
├── renderer/    Export engine and panel
├── ui/          Shell, chrome, panels, splitters
└── plugins/     Plugin SDK, Node Capsules
```

**Data flow, every frame**

```
timeline layers → 2D flatten → GPU source texture
                                    ↓
node graph → evaluator → EffectPass[] → Compositor (ping-pong FBOs) → canvas
                ↑                                                        ↓
        keyframes sampled at t                              MediaRecorder / PNG
```

Three rules hold the design together:

1. **One document.** Clips, nodes, keyframes and 3D objects live in the same
   `ProjectState`. That is what removes the export-between-apps loop.
2. **One mutation path.** Everything goes through `core/project.ts → edit()`, so
   undo, autosave and the dirty flag work everywhere for free, including for
   anything E.L.A.I.N.E. builds.
3. **The timeline never depends on the graph.** Editing works with an empty
   graph; the graph is depth you opt into.

### Swapping in the native engine

`Compositor` is the only class that touches WebGL, and it takes a source frame
plus a pass list. The Qt/Vulkan renderer implements the same two methods
(`resize`, `render`) behind an IPC boundary; `nodes/evaluator.ts` already emits a
serialisable pass description rather than GL calls.

---

## What works today

- Application shell, six workspaces, resizable and persisted panel layout
- Media import with probing and thumbnails; drag or double-click to the timeline
- Multi-track timeline: move across tracks, edge trim, slip, split, ripple
  delete, magnetic snapping with live guides, markers, per-track mute/hide, zoom
- Transport: play, loop, frame stepping, scrubbing, timecode
- Live multi-layer preview (video, image, titles) with opacity and cover fit
- Node editor: pan, zoom, drag, typed drag-to-connect with cycle rejection,
  search palette, bypass, delete
- Seven real GPU passes: grade, glow, signal corruption, digital noise,
  scanlines, vignette, transform, plus a burned-in timestamp overlay
- Keyframes on any animatable node parameter, curve editor with easing
- 3D workspace: primitives, orbit, transform gizmos writing back to the project,
  shading modes, material values, picking
- E.L.A.I.N.E.: plan preview then real nodes, clips, keyframes and objects
- Project save/load, autosave with crash recovery, full undo/redo
- Export: WebM (VP9), PNG frame, PNG sequence, presets, range, estimates

## What is planned, and labelled as such in the UI

- **Modeling:** edit mode, modifiers, booleans, UV, sculpt, retopology
  (needs the half-edge mesh layer — next milestone for `threeD/`)
- **3D animation:** armatures, IK, weight painting, blend shapes, mocap
- **Material workspace:** shader node set on the existing canvas
- **Geometry nodes:** procedural generators
- **AI runtimes:** generative nodes are registered and marked *Planned*;
  tracking, depth, matting arrive with ONNX Runtime
- **3D into composite:** the `3D Scene` node renders the scene into the chain
- **Codecs:** MP4/H.264/H.265/AV1/ProRes/EXR with the FFmpeg backend
- **Marketplace:** capsule capture and instantiation exist in `plugins/api.ts`;
  the client and sandboxed loading do not

Nothing in the interface pretends to work. Planned features carry a badge or an
explanation of what they are waiting on.

---

## Roadmap

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Shell, workspaces, media, timeline, preview, project system | Done |
| 2 | Node editor, video nodes, evaluation, real-time preview | Done |
| 3 | 3D viewport, primitives, transforms, lights, materials | Done (basic) |
| 4 | Keyframes, graph editor, motion graphics | Partial |
| 5 | Native modeling, mesh editing, modifiers, procedural geometry | Next |
| 6 | AI runtimes, tracking, roto, depth, generative workflows | Planned |
| 7 | Plugin SDK, marketplace, collaboration, cloud rendering | Planned |

## Project format

`Project.eternal` is modular by design. The browser build writes one JSON
document with the same section layout the folder format uses:

```
project.json · timeline.json · nodes.json · scene.eternal3d
materials/ models/ media/ audio/ ai/ cache/ previews/
```

Media is stored by name and relinked on load — object URLs cannot survive a
reload, and the app tells you which assets need relinking rather than failing
silently.
