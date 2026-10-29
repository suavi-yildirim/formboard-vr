# Formboard VR

VR training for wire-harness assembly on a formboard. It runs in the browser on Meta Quest 3 (WebXR), with no install.

**Try it:** https://suavi-yildirim.github.io/formboard-vr/

**Watch it (recorded on Quest 3):** https://suavi-yildirim.github.io/formboard-vr/demo/ (English) · https://suavi-yildirim.github.io/formboard-vr/demo/#de (Deutsch)
- **On Quest 3:** open the link in the Quest Browser and press *Enter VR*.
  - **Wires and pegs by hand:** pinch the glowing wire end between thumb and index finger, right at the wire (within 3 cm), and pull it through the pegs. The wire end stays at your fingertips. With controllers, the trigger grips at the controller tip.
  - **Buttons:** point at the panel and pinch.
  - **Moving:** walk, or use *Go to car* and *Back to the formboard* to jump. With controllers: hold the grip button (inside of the controller), aim at the floor and release to teleport; the left stick walks freely (relative to where you look) and the right stick turns in 30° steps. Pinching never teleports, so working with your hands cannot move you by accident.
- **On desktop:** left-click the panel and drag wires on the board. Right-drag to look around, Shift + right-drag or the arrow keys to pan, scroll to zoom. Desktop browsers have no WebXR, so the app runs there without the VR button.

## What it does

1. **Choose the harness.** The board is sized to the harness (the harness itself is 1:1) and stands like a desk easel within arm's reach.
   - The **VW ignition harness** is real KBL data from the public VW "Old Beetle" sample: 18 wires, 20 connectors, flattened from the 3D vehicle geometry onto a 1:1 formboard.
   - The **door harness** is a fictitious example with variants that come from the KBL modules (base equipment, comfort, ambient light, full).
2. **Board prep.** Ghost pegs show where the guide pegs and Y-pegs go, and you set each one.
3. **Routing, one wire at a time.** Pinch the glowing wire end at the start connector and pull it along the board. In VR this is direct touch at the fingertips, exactly at the glowing end; rays are only used for the panel and for teleporting.
   - The wire snaps to the next correct peg, with sound and haptic feedback.
   - A wrong branch or a skipped peg flashes red and counts as an error. Passing near other pegs while staying on track does not.
   - Reaching the target connector completes the wire, and earlier wires fade back.
   - **The wire grows as you route it.** At the start only its end at the connector is visible. While you pull, it reaches from the last peg to your fingers under light tension (a slight sag) and no further. It is as long as the wire really is, taken from the KBL file: for the VW harness the KBL lengths equal the flattened board paths to the millimetre. Pull further than the wire reaches and it goes taut: the end stops short of your hand, and a controller gives a short buzz. The shape is computed fresh every frame, so it cannot fold or jitter, and it never goes through the board.
4. **Two modes.**
   - **Guided** shows the path and the next peg.
   - **Test** shows only the target connector, so you route from the board drawing. Hints ("Show me") are counted.
5. **Quality check and summary.** You get the time and errors per wire, plus a JSON log for evaluation.
6. **Vehicle view.** To your right stands the complete VW vehicle harness at 1:1 (183 segments, from the KBL centre lines). The ignition harness you just built glows orange where it sits in the car. Use *Go to car* (VR: jump there; desktop: camera view), or teleport.

## Data: from KBL to formboard

KBL (VDA 4964) describes the wiring: connectors, wires, connections, modules and routing. A formboard needs a flat 1:1 layout.
`tools/` turns one into the other:

- `real_kbl.py` works on real KBL 2.3/2.4 files. It reads nodes, segments, connectors (including ring terminals placed as special terminals), wire colours with tracer stripes, cross-sections, and the real **routing of every wire**.
  - **Flattening:** a formboard keeps every segment at its true length, because wires are cut to length, but the branches may turn freely. The layout starts from a plane projection (PCA, viewed from above, never mirrored). It is then relaxed: segment lengths are held at the KBL `Virtual_length`, and nodes that come too close push apart. For the VW harness, all 30 segments end at their true length.
  - **Pegs:** fork pegs along long segments (one every 160 mm) and Y-pegs at branch points.
  - **Vehicle view:** the B-spline centre lines of the full vehicle harness in vehicle coordinates.
- `kbl_to_harness.py` builds all app data (`src/data/*.json`). For the fictitious door harness it uses a hand-made layout (`data/board_layout.json`) and shortest paths through the bundle topology.

Data in this repository:
- **Door harness:** fictitious, from the [KBL knowledge-graph demo](https://github.com/suavi-yildirim/bordnetz-knowledge-graph).
- **`data/vw/`:** the public Volkswagen VOBES "Old Beetle" sample (CC BY-SA 4.0, see `data/vw/SOURCE.md`).

## Look

- **Board:** plywood, with the 1:1 formboard drawing printed on paper and glued on: bundle outlines, centre lines, connector outlines and peg marks.
- **Connectors:** modelled from their KBL parts. Housings are sized by cavity count and coloured from the part description (for example "SCHWARZ"), with a latch and a metal holder. Spark-plug connectors are rubber boots, ring terminals are copper lugs, and splices are heat-shrink sleeves. Each faces away from its wires.
- **Light:** studio reflections on metal and insulation, filmic tone mapping, and one overhead work light. Wires, pegs, connectors and your hands cast shadows on the board, which also helps you judge depth when reaching.

## Structure

```
src/core/    pure logic, unit tested: grid, harness (variants, bundles), router (snap/wrong/done), session (state machine, metrics), heldwire (shape of the held wire), rig (teleport maths)
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
- Real formboard layouts: read the 2D formboard drawing from the harness CAD export when it is available, instead of flattening
