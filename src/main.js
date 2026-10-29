// Formboard VR: wires the pure core (session, router) to the three.js scene and the pointers.
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { validateHarness, variants, wiresForVariant, nodePositions, bundleSlots, wirePolyline, nodeById, COLOURS, COLOUR_NAMES } from './core/harness.js';
import { distance } from './core/grid.js';
import { RoutingAttempt, GRAB_MM, neighbourMap } from './core/router.js';

const TIP_GRAB_MM = 30; // fingertips must be this close to the wire end (or a ghost peg) to take it
import { Session, QA_ITEMS } from './core/session.js';
import { buildWorkshop } from './scene/workshop.js';
import { Board } from './scene/board.js';
import { WireLayer } from './scene/wires.js';
import { Panel } from './scene/panel.js';
import { Sfx } from './scene/audio.js';
import { VehicleView } from './scene/vehicle.js';
import { Pointers } from './input/pointers.js';
import { Locomotion } from './input/locomotion.js';

const dataUrl = (f) => new URL(`./data/${f}`, import.meta.url);
const getJson = async (f) => (await fetch(dataUrl(f))).json();
const catalogue = await getJson('harnesses.json');

// --- renderer, scene, camera ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setFoveation?.(0.5);
document.body.appendChild(renderer.domElement);
// Without immersive VR support (desktop browsers, Safari) show a plain note instead of the
// "WEBXR NOT AVAILABLE" / "VR NOT SUPPORTED" button.
const vrSupported = await navigator.xr?.isSessionSupported?.('immersive-vr').catch(() => false);
if (vrSupported) document.body.appendChild(VRButton.createButton(renderer));
else document.getElementById('vr-note').hidden = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.enableDamping = true;
controls.keyPanSpeed = 40;
controls.listenToKeyEvents(window); // arrow keys pan

// Desktop views: frame the panel and the board together, or the vehicle harness.
const VIEWS = {
  board: { left: -1.35, right: 0.62, bottom: 0.55, top: 1.6, z: -0.45, y: 0.45 },
  vehicle: { left: -2.4, right: 2.4, bottom: 0, top: 2.2, z: 0, y: 0, centre: new THREE.Vector3(2.5, 0.75, -0.9), from: new THREE.Vector3(-1, 0.45, 0.15) },
};
let view = 'board';
function fitCamera() {
  const v = VIEWS[view];
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const d = Math.max((v.right - v.left) / 2 / Math.tan(hfov / 2), (v.top - v.bottom) / 2 / Math.tan(vfov / 2)) * 1.05;
  if (view === 'board') {
    const cx = (v.left + v.right) / 2, cy = (v.bottom + v.top) / 2;
    camera.position.set(cx, cy + v.y, v.z + d);
    controls.target.set(cx, cy, v.z);
  } else {
    camera.position.copy(v.centre).addScaledVector(v.from.clone().normalize(), d);
    controls.target.copy(v.centre);
  }
  controls.update();
}
fitCamera();

const backButton = document.getElementById('back-to-board');
function setView(v) {
  view = v;
  backButton.hidden = v === 'board';
  fitCamera();
}
backButton.addEventListener('click', () => setView('board'));

const { metal } = buildWorkshop(scene);
const panel = new Panel();
panel.mesh.position.set(-0.82, 1.28, -0.3);
panel.mesh.rotation.y = 0.6;
scene.add(panel.mesh);

const sfx = new Sfx();
const pointers = new Pointers(renderer, scene, camera, renderer.domElement);
const loco = new Locomotion(renderer, scene);

// Jump spots (floor position and the point to face). The car spot is beside the engine end.
const SPOTS = {
  board: { pos: { x: 0, z: 0 }, look: { x: 0, z: -0.48 } },
  car: { pos: { x: 1.2, z: 0.55 }, look: { x: 2.5, z: 0.1 } },
};

// Small panel at the car with the way back to the workstation.
const carPanel = new Panel(0.4);
{
  const { pos, look } = SPOTS.car;
  const d = new THREE.Vector3(look.x - pos.x, 0, look.z - pos.z).normalize();
  const left = new THREE.Vector3(d.z, 0, -d.x);
  carPanel.mesh.position.set(pos.x + d.x * 0.55 + left.x * 0.45, 1.15, pos.z + d.z * 0.55 + left.z * 0.45);
  carPanel.mesh.lookAt(pos.x, 1.5, pos.z);
  scene.add(carPanel.mesh);
  carPanel.draw((g) => {
    g.text('VEHICLE VIEW · 1:1', 56, 80, { size: 30, weight: 700, colour: '#5ce1ff' });
    g.text('VW Old Beetle harness', 56, 150, { size: 52, weight: 700 });
    g.para('Orange: the ignition harness from the formboard, in place at the engine. Point at the floor and pinch to walk around.', 56, 230, 912, { size: 34, colour: '#c5ceda' });
    g.button('goto:board', '← Back to the formboard', 56, 560, 912, 110, { primary: true, size: 40 });
  });
}
const panels = [panel, carPanel];

function goTo(spot) {
  if (loco.active) loco.jump(SPOTS[spot]);
  else setView(spot === 'car' ? 'vehicle' : 'board');
}

// The VW vehicle harness stands to the user's right, 1:1, with the engine end (rear of the Beetle,
// where the ignition harness sits) towards the user.
let vehicle = null;
getJson('vw_vehicle.json').then((data) => {
  vehicle = new VehicleView(data);
  vehicle.group.position.set(2.5, vehicle.liftM, -0.9);
  vehicle.group.rotation.y = -Math.PI / 2;
  scene.add(vehicle.group);
  vehicle.group.updateMatrixWorld(true);
  vehicle.sign.lookAt(new THREE.Vector3(0, 1.4, 0));
  refresh();
});

// --- harness-dependent state ---
const H = { file: null, harness: null, pos: {}, nb: {}, vlist: [], problems: [], session: null, board: null, wires: null };
const ui = { harnessIdx: 0, variant: 0, mode: 'guided', status: '', statusKind: '', ghostUntil: 0, lastSecond: -1, loading: false };
let attempt = null;
let owner = null; // pointer currently holding the wire
let polylines = {};
const now = () => performance.now();

async function loadHarness(i) {
  ui.loading = true;
  refresh();
  const h = await getJson(catalogue[i].file);
  H.board?.dispose();
  H.file = catalogue[i].file;
  H.harness = h;
  H.problems = validateHarness(h);
  H.pos = nodePositions(h);
  H.nb = neighbourMap(h.segments);
  H.vlist = variants(h);
  H.session = new Session(h);
  H.board = new Board(h, metal);
  // Tilted like a desk easel, resting on the bench, within arm's reach of the standing user.
  const tilt = 0.7, heightM = H.board.size.h / 1000 + 0.09;
  H.board.group.position.set(0, 0.765 + (heightM / 2) * Math.cos(tilt), -0.48);
  H.board.group.rotation.x = -tilt;
  scene.add(H.board.group);
  H.wires = new WireLayer(H.board);
  ui.harnessIdx = i;
  ui.variant = 0;
  ui.loading = false;
  attempt = null;
  owner = null;
  refresh();
}

const connLabel = (w, end) => {
  const n = nodeById(H.harness, end === 'from' ? w.from_node : w.to_node);
  return `${w[end]}  ${n?.label ?? ''}`;
};

function startRun() {
  const { session, board, wires } = H;
  session.start(H.vlist[ui.variant], ui.mode, now());
  const slots = bundleSlots(session.wires);
  polylines = Object.fromEntries(session.wires.map((w) => [w.id, wirePolyline(w, H.pos, slots)]));
  wires.clearDone();
  wires.clearLive();
  wires.clearGhost();
  wires.setHandle(null);
  for (const id of Object.keys(board.pegs)) board.setPeg(id, 'hidden');
  for (const p of session.pegs) board.setPeg(p.id, 'ghost');
  board.setHalos([]);
  attempt = null;
  ui.status = '';
  setView('board');
  refresh();
}

function toMenu() {
  H.session.restart();
  attempt = null;
  owner = null;
  H.wires.clearLive();
  H.wires.clearGhost();
  H.wires.setHandle(null);
  H.wires.dimDone(false);
  H.board.setHalos([]);
  refresh();
}

function enterWire() {
  const w = H.session.wire;
  attempt = new RoutingAttempt(w.path, H.pos, H.nb);
  owner = null;
  H.wires.dimDone(true);
  H.wires.clearLive();
  H.wires.setGhost(w, polylines[w.id]);
  ui.status = '';
  updateGuides();
  updateLive(null);
  refresh();
}

function enterQa() {
  attempt = null;
  owner = null;
  H.wires.dimDone(false);
  H.wires.clearGhost();
  H.wires.clearLive();
  H.wires.setHandle(null);
  const ends = new Set(H.session.wires.flatMap((w) => [w.path[0], w.path.at(-1)]));
  H.board.setHalos([...ends], 0x3ddc84);
  refresh();
}

function updateGuides() {
  if (H.session.state !== 'route' || !attempt) return;
  const w = H.session.wire;
  const guided = H.session.mode === 'guided' || now() < ui.ghostUntil;
  const target = w.path.at(-1);
  const ids = guided && attempt.next ? [...new Set([attempt.next, target])] : [target];
  const c = COLOURS[w.colour];
  H.board.setHalos(ids, c === COLOURS.WH || c === COLOURS.BK ? 0x5ce1ff : c);
  H.wires.setGhostVisible(guided);
}

// Live wire = routed part (bundle-offset points) plus the free end while held: at the fingertips
// in VR (freeEnd, board-local 3D point), on the board under the mouse on desktop (pointerMm).
function updateLive(pointerMm, freeEnd) {
  const w = H.session.wire;
  const routed = polylines[w.id].slice(0, attempt.reached);
  if (attempt.holding && freeEnd) {
    H.wires.setLive(w, routed, freeEnd);
    H.wires.setHandle(w, null, true, freeEnd);
    return;
  }
  const pts = attempt.holding && pointerMm ? [...routed, pointerMm] : routed;
  if (pts.length >= 2) H.wires.setLive(w, pts);
  else H.wires.clearLive();
  H.wires.setHandle(w, attempt.holding && pointerMm ? pointerMm : routed.at(-1), attempt.holding);
}

function handleEvents(events, p) {
  for (const e of events) {
    if (e.type === 'grab') { sfx.grab(); p.pulse(0.3, 20); }
    if (e.type === 'snap') {
      sfx.snap(); p.pulse(0.6, 40);
      H.board.flash(e.at, 0x3ddc84);
      ui.status = `✓ ${e.at}`; ui.statusKind = 'ok';
      updateGuides();
    }
    if (e.type === 'wrong') {
      sfx.wrong(); p.pulse(1, 140);
      H.board.flash(e.at, 0xff3b30);
      ui.status = H.session.mode === 'guided' ? `✗ ${e.at} is wrong, next is ${e.expected}` : `✗ ${e.at} is not on this route`;
      ui.statusKind = 'err';
    }
    if (e.type === 'done') {
      sfx.done();
      const w = H.session.wire;
      H.wires.setDone(w, polylines[w.id]);
      H.session.wireDone(attempt.errors, now());
      if (H.session.state === 'qa') enterQa();
      else enterWire();
      return;
    }
    refresh();
  }
}

function back() {
  const s = H.session;
  if (s.state !== 'qa' && !(s.state === 'route' && s.index > 0)) return;
  s.back(now());
  H.wires.removeDone(s.wire.id);
  enterWire();
}

function showMe() {
  if (H.session.state !== 'route') return;
  H.session.hint();
  ui.ghostUntil = now() + 3000;
  H.wires.startTour();
  updateGuides();
  refresh();
}

function downloadLog() {
  const log = { ...H.session.summary(), harness_file: H.file, date: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `formboard-log-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function onButton(id) {
  sfx.click();
  const s = H.session;
  if (id.startsWith('harness:')) { const i = Number(id.split(':')[1]); if (i !== ui.harnessIdx) loadHarness(i); return; }
  if (id.startsWith('variant:')) ui.variant = Number(id.split(':')[1]);
  else if (id.startsWith('mode:')) ui.mode = id.split(':')[1];
  else if (id === 'start') startRun();
  else if (id === 'menu') toMenu();
  else if (id === 'vehicle') goTo('car');
  else if (id === 'goto:board') goTo('board');
  else if (id === 'allpegs') { for (const p of s.pegs) H.board.setPeg(p.id, 'set'); s.setAllPegs(now()); enterWire(); return; }
  else if (id === 'showme') showMe();
  else if (id === 'back') back();
  else if (id.startsWith('qa:')) {
    s.checkQa(Number(id.split(':')[1]), now());
    if (s.state === 'summary') { sfx.finish(); H.board.setHalos([]); console.log('formboard log', s.summary()); }
  } else if (id === 'download') downloadLog();
  else if (id === 'again') startRun();
  refresh();
}

function onBoardPress(p) {
  const s = H.session;
  if (s.state !== 'prep' || !p.work.mm) return;
  let best = null, bestD = p.work.grab;
  for (const peg of s.pegs) {
    if (s.pegsSet.has(peg.id)) continue;
    const d = distance(p.work.mm, H.pos[peg.id]);
    if (d < bestD) { best = peg; bestD = d; }
  }
  if (!best) return;
  H.board.setPeg(best.id, 'set');
  p.pinchUsed = true; // one peg per pinch
  sfx.snap(); p.pulse(0.5, 30);
  s.setPeg(best.id, now());
  if (s.state === 'route') enterWire();
  else refresh();
}

// --- panel views ---
const L = 56, R = 968;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function header(g, kicker, title) {
  g.text(kicker, L, 72, { size: 24, weight: 700, colour: '#5ce1ff' });
  if (title) g.text(title, L, 124, { size: 40, weight: 700, max: R - L });
}

const views = {
  menu(g) {
    const h = H.harness;
    header(g, 'FORMBOARD VR · WIRE HARNESS TRAINING', h.description);
    g.text(`${h.id} · ${h.wires.length} wires · ${h.source}`, L, 162, { size: 22, colour: '#9aa7b8', max: R - L });
    if (H.problems.length) { g.para(`Harness data is invalid: ${H.problems.join('; ')}`, L, 230, R - L, { colour: '#ff6b6b' }); return; }
    g.text('Harness', L, 212, { size: 24, weight: 600, colour: '#9aa7b8' });
    catalogue.forEach((c, i) => g.button(`harness:${i}`, `${c.label} · ${c.note}`, L + i * 464, 226, 448, 62, { selected: ui.harnessIdx === i, size: 25 }));
    g.text('Variant', L, 326, { size: 24, weight: 600, colour: '#9aa7b8' });
    H.vlist.forEach((v, i) => {
      const n = wiresForVariant(h, v).length;
      g.button(`variant:${i}`, `${v.label} · ${n}`, L + (i % 2) * 464, 340 + Math.floor(i / 2) * 70, 448, 58, { selected: ui.variant === i, size: 24 });
    });
    if (h.flattening) {
      g.para(`Flattened from 3D KBL: ${h.flattening.segments} segments at true length (max. deviation ${h.flattening.max_length_error_pct} %), pegs placed automatically.`, L, 440, R - L, { size: 20, colour: '#c5ceda' });
    }
    g.text('Mode', L, 514, { size: 24, weight: 600, colour: '#9aa7b8' });
    g.button('mode:guided', 'Guided', L, 526, 448, 60, { selected: ui.mode === 'guided' });
    g.button('mode:test', 'Test', L + 464, 526, 448, 60, { selected: ui.mode === 'test' });
    g.button('start', ui.loading ? 'Loading…' : 'Start', L, 610, 600, 80, { primary: true, size: 32, disabled: ui.loading });
    g.button('vehicle', 'Go to car →', L + 616, 610, 296, 80, { disabled: !vehicle, size: 26 });
  },

  prep(g) {
    const s = H.session;
    header(g, 'STEP 1 · BOARD PREP', 'Set the guide pegs');
    const y = g.para('Point at a blue ghost peg on the board and pinch (or pull the trigger) to insert it. Orange caps are Y-pegs at branch points.', L, 190, R - L);
    const n = s.pegsSet.size, total = s.pegs.length;
    g.text(`${n} / ${total} pegs`, L, y + 50, { size: 34, weight: 700 });
    g.bar(L, y + 74, R - L, 18, n / total);
    g.button('allpegs', 'Set all pegs', L, 620, 448, 76);
    g.button('menu', 'Menu', L + 464, 620, 448, 76);
  },

  route(g) {
    const s = H.session;
    const w = s.wire, i = s.index, n = s.wires.length;
    header(g, `STEP 2 · WIRE ${i + 1} / ${n} · ${s.mode.toUpperCase()}`, '');
    g.swatch(L + 22, 112, COLOURS[w.colour] ?? 0xcccccc, 22);
    const colour = `${COLOUR_NAMES[w.colour] ?? w.colour}${w.stripe ? `/${COLOUR_NAMES[w.stripe] ?? w.stripe}` : ''}`;
    g.text(`${w.id}  ${colour} · ${w.cross_section_mm2} mm²`, L + 60, 124, { size: 40, weight: 700, max: R - L - 60 });
    g.text(`Signal ${w.signal} · ${w.length_mm} mm`, L, 170, { size: 26, colour: '#9aa7b8', max: R - L });
    g.text('From', L, 222, { size: 24, colour: '#9aa7b8' });
    g.text(connLabel(w, 'from'), L + 90, 222, { size: 28, weight: 600, max: R - L - 90 });
    g.text('To', L, 264, { size: 24, colour: '#9aa7b8' });
    g.text(connLabel(w, 'to'), L + 90, 264, { size: 28, weight: 600, max: R - L - 90 });
    const instr = attempt?.holding
      ? (s.mode === 'guided' ? `Pull the wire to ${attempt.next}.` : 'Pull the wire along its route to the target connector.')
      : attempt?.reached > 1
        ? `Grab the wire end at ${attempt.end} to continue.`
        : `Grab the glowing end at ${w.path[0]} and pull it through the pegs to ${w.path.at(-1)}.`;
    g.para(instr, L, 322, R - L, { size: 28 });
    if (ui.status) g.text(ui.status, L, 420, { size: 30, weight: 700, colour: ui.statusKind === 'err' ? '#ff6b6b' : '#3ddc84' });
    const m = s.metrics[i];
    g.text(`Errors ${attempt?.errors ?? 0}    Hints ${m.hints}    Time ${fmt((now() - m.start) / 1000)}`, L, 478, { size: 28, colour: '#c5ceda' });
    g.text(`Peg ${attempt ? attempt.reached : 0} / ${w.path.length}`, R, 478, { size: 28, colour: '#c5ceda', align: 'right' });
    g.bar(L, 510, R - L, 14, attempt ? (attempt.reached - 1) / (w.path.length - 1) : 0, `#${(COLOURS[w.colour] ?? 0x5ce1ff).toString(16).padStart(6, '0')}`);
    g.bar(L, 540, R - L, 8, i / n);
    g.button('showme', 'Show me', L, 620, 290, 76);
    g.button('back', 'Undo last wire', L + 311, 620, 290, 76, { disabled: i === 0 });
    g.button('menu', 'Menu', L + 622, 620, 290, 76);
  },

  qa(g) {
    const s = H.session;
    header(g, 'STEP 3 · QUALITY CHECK', 'Check the harness');
    g.text('Connector ends are highlighted. Confirm each check.', L, 172, { size: 26, colour: '#c5ceda' });
    QA_ITEMS.forEach((item, i) => g.button(`qa:${i}`, `${s.qa.has(i) ? '☑' : '☐'}  ${item}`, L, 210 + i * 92, R - L, 76, { selected: s.qa.has(i) }));
    g.button('back', 'Back to last wire', L, 620, 448, 76);
    g.button('menu', 'Menu', L + 464, 620, 448, 76);
  },

  summary(g) {
    const s = H.session.summary();
    header(g, 'DONE · HARNESS COMPLETE', `${s.variant} · ${s.mode}`);
    g.text(`${fmt(s.total_s)} total`, L, 196, { size: 36, weight: 700 });
    g.text(`${s.errors} errors`, L + 330, 196, { size: 36, weight: 700, colour: s.errors ? '#ff6b6b' : '#3ddc84' });
    g.text(`${s.hints} hints`, L + 610, 196, { size: 36, weight: 700, colour: '#c5ceda' });
    const cols = s.wires.length > 12 ? 3 : 2, per = Math.ceil(s.wires.length / cols), colW = (R - L) / cols;
    const rowH = Math.min(54, 330 / per);
    s.wires.forEach((w, i) => {
      const x = L + Math.floor(i / per) * colW, y = 256 + (i % per) * rowH;
      const wire = H.session.wires.find((x) => x.id === w.wire);
      g.swatch(x + 14, y - 9, COLOURS[wire.colour] ?? 0xcccccc, 11);
      g.text(`${w.wire}  ${w.time_s.toFixed(1)} s  ${w.errors} err`, x + 36, y, { size: Math.min(26, rowH * 0.62), colour: w.errors ? '#ffb3b3' : '#e9eef5', max: colW - 44 });
    });
    g.button('download', 'Download log', L, 620, 290, 76);
    g.button('vehicle', 'Go to car →', L + 311, 620, 290, 76, { disabled: !vehicle });
    g.button('again', 'New run', L + 622, 620, 290, 76, { primary: true });
  },
};

function refresh() {
  if (!H.session) {
    panel.draw((g) => header(g, 'FORMBOARD VR', 'Loading harness…'));
    return;
  }
  panel.draw(views[H.session.state]);
}

// --- frame loop ---
const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  if (!renderer.xr.isPresenting) controls.update();

  const hover = new Map(panels.map((x) => [x, null]));
  let marker = null;
  for (const p of pointers.update()) {
    const mouse = p === pointers.mouse;
    // Board work. VR: direct touch at the fingertips (pinch point), no ray. Desktop: mouse ray.
    let nearBoard = false;
    if (mouse) {
      p.work = { mm: null, pressed: false, justPressed: false, canGrab: false, grab: GRAB_MM, freeEnd: null };
    } else {
      const probe = p.tip && H.board ? H.board.probe(p.tip) : null;
      const inside = probe && probe.mm.x > -60 && probe.mm.y > -60 && probe.mm.x < H.board.size.w + 60 && probe.mm.y < H.board.size.h + 60;
      // Fingers easily sink into a virtual board (no resistance): accept up to 8 cm behind the surface.
      nearBoard = !!(inside && probe.z > -0.12 && probe.z < 0.2);
      const touching = inside && probe.z > -0.08 && probe.z < 0.07;
      pointers.setTipVisible(p, nearBoard);
      p.work = {
        mm: touching ? probe.mm : null, pressed: p.pinching,
        // act only where the pinch closes (plus a short grace period), not by sweeping into a wire
        justPressed: touching && pointers.pinchFresh(p),
        canGrab: touching && pointers.pinchFresh(p),
        grab: TIP_GRAB_MM, freeEnd: probe ? probe.local : null,
      };
    }

    // Rays: panel buttons and teleport. In VR not while the hand works at the board.
    let hp = null, hitPanel = null;
    if (!nearBoard) {
      for (const x of panels) {
        const h = p.raycaster.intersectObject(x.mesh)[0];
        if (h && (!hp || h.distance < hp.distance)) { hp = h; hitPanel = x; }
      }
    }
    const hb = mouse && H.board ? p.raycaster.intersectObject(H.board.surface)[0] : null;
    const panelFirst = !!hp && (!hb || hp.distance < hb.distance);
    p.panelId = panelFirst ? hitPanel.hit(hp.uv) : null;
    if (mouse) {
      const mm = !panelFirst && hb ? H.board.toMm(hb.point) : null;
      const pressed = p.pressed && !p.pressOnPanel;
      p.work = { mm, pressed, justPressed: p.justPressed && !panelFirst, canGrab: pressed, grab: GRAB_MM, freeEnd: null };
    }
    // Teleport target: the floor, when the ray hits nothing else (VR only).
    const floor = !mouse && !nearBoard && !hp && loco.active ? loco.floorHit(p.raycaster.ray) : null;
    p.setRayLength(hp ? hp.distance : floor ? floor.distanceTo(p.raycaster.ray.origin) : undefined);
    if (!mouse) pointers.setRayVisible(p, !!(hp || (floor && !p.pinching) || p.pressOnFloor));
    if (p.panelId) hover.set(hitPanel, p.panelId);
    if (p.justPressed && !nearBoard) {
      sfx.unlock();
      p.pressOnPanel = panelFirst;
      p.pressOnFloor = !!floor;
      p.floorTarget = floor; // a pinch shorter than one frame still teleports
      if (p.panelId) onButton(p.panelId);
    }
    if (p.work.justPressed && H.session) { sfx.unlock(); onBoardPress(p); }
    if (p.pressOnFloor) {
      if (p.pressed) { if (floor) p.floorTarget = floor; marker = p.floorTarget ?? null; }
      else {
        if (p.floorTarget) { loco.teleport(p.floorTarget); sfx.grab(); }
        p.pressOnFloor = false;
        p.floorTarget = null;
      }
    }
  }
  for (const [x, id] of hover) x.setHover(id);
  loco.showMarker(marker);
  loco.update(dt, pointers.list);

  if (H.session?.state === 'route' && attempt) {
    if (!owner) {
      for (const p of pointers.list) {
        if (!p.enabled || !p.work?.canGrab || p.pressOnPanel || p.pressOnFloor) continue;
        handleEvents(attempt.update(p.work.mm, true, p.work.grab), p);
        if (attempt?.holding) { owner = p; p.pinchUsed = true; break; }
      }
    } else {
      const p = owner;
      const events = attempt.update(p.enabled ? p.work.mm : null, p.enabled && p.work.pressed, p.work.grab);
      if (!attempt.holding) owner = null;
      handleEvents(events, p);
    }
    if (H.session.state === 'route' && attempt) {
      updateLive(owner?.work.mm ?? null, owner?.work.freeEnd ?? null);
      if (ui.ghostUntil && now() > ui.ghostUntil) { ui.ghostUntil = 0; updateGuides(); }
      const sec = Math.floor(now() / 1000);
      if (sec !== ui.lastSecond) { ui.lastSecond = sec; refresh(); }
    }
  }

  H.board?.update(dt, t);
  H.wires?.update(dt, t);
  vehicle?.update(t);
  renderer.render(scene, camera);
}

renderer.xr.addEventListener('sessionstart', refresh);
renderer.xr.addEventListener('sessionend', () => { refresh(); fitCamera(); });
await loadHarness(0);
renderer.setAnimationLoop(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (!renderer.xr.isPresenting) fitCamera();
});

// Debug handle. step() renders one frame by hand, for scripted tests when the page gets no animation frames.
window.formboard = { H, panel, carPanel, camera, step: frame, load: loadHarness, setView };
