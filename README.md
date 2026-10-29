# Formboard VR

VR training for wire-harness assembly on a formboard. It runs in the browser on Meta Quest 3 (WebXR), with no install.

**Try it:** https://suavi-yildirim.github.io/formboard-vr/
- **On Quest 3:** open the link in the Quest Browser, press *Enter VR*, then point and pinch (hand tracking) or pull the trigger.
- **On desktop:** left-click the panel and drag wires on the board. Right-drag to look around, scroll to zoom.

## What it does

1. **Choose the variant.** Variants come from the KBL modules (base equipment, comfort, ambient light, full).
2. **Board prep.** Ghost pegs show where the guide pegs and Y-pegs go, and you set each one.
3. **Routing, one wire at a time.** Grab the glowing wire end at the start connector and pull it along the board.
   - The wire snaps to the next correct peg, with sound and haptic feedback.
   - A wrong branch or a skipped peg flashes red and counts as an error.
   - Reaching the target connector completes the wire, and earlier wires fade back.
4. **Two modes.**
   - **Guided** shows the path and the next peg.
   - **Test** shows only the target connector, so you route from the board drawing. Hints ("Show me") are counted.
5. **Quality check and summary.** You get the time and errors per wire, plus a JSON log for evaluation.

## Data: from KBL to formboard

KBL (VDA 4964) describes the wiring: connectors, wires, connections, modules and routing. A formboard needs a flat 1:1 layout.
`tools/` turns one into the other:

- `kbl_to_harness.py` takes a KBL plus a formboard layout and writes `src/data/harness.json`. Each wire's path is the shortest path through the bundle topology.
- `real_kbl.py` works on real KBL 2.3/2.4 files. It reads nodes, segments, connectors, wire colours and cross-sections, and the real **routing of every wire**.
  - It flattens the 3D harness onto the board while keeping every segment at its true length, starting from a plane projection and relaxing the layout.
  - It adds fork pegs along long segments and Y-pegs at branch points.

Data in this repository:
- **Door harness:** fictitious, from the [KBL knowledge-graph demo](https://github.com/suavi-yildirim/bordnetz-knowledge-graph).
- **`data/vw/`:** the public Volkswagen VOBES "Old Beetle" sample (CC BY-SA 4.0, see `data/vw/SOURCE.md`).

## Structure

```
src/core/    pure logic, unit tested: grid, harness (variants, bundles), router (snap/wrong/done), session (state machine, metrics)
src/scene/   three.js: workshop, board, wires, panel, audio
src/input/   one pointer model for hands, controllers and mouse
tools/       KBL -> harness.json
test/        node --test
```

Run locally: `python3 -m http.server`, then open http://localhost:8000. Tests: `npm test`. Rebuild data: `npm run data`.

## Roadmap

- Mixed reality on a physical board: Quest passthrough, with the board registered by markers on opposite corners or by a two-point touch calibration
- Unity 6 + Meta XR SDK port for the lab version, using the same `harness.json`
- Study mode: compare guided and test runs, and paper vs. VR instructions, using the logged times and errors
