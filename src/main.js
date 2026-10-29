// Formboard VR: wires the pure core (session, router) to the three.js scene and the pointers.
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { validateHarness, variants, wiresForVariant, nodePositions, bundleSlots, wirePolyline, nodeById, COLOURS, COLOUR_NAMES } from './core/harness.js';
import { distance } from './core/grid.js';
import { RoutingAttempt, GRAB_MM } from './core/router.js';
import { Session, QA_ITEMS } from './core/session.js';
import { buildWorkshop } from './scene/workshop.js';
import { Board } from './scene/board.js';
import { WireLayer } from './scene/wires.js';
import { Panel } from './scene/panel.js';
import { Sfx } from './scene/audio.js';
import { Pointers } from './input/pointers.js';

const harness = await (await fetch(new URL('./data/harness.json', import.meta.url))).json();
const problems = validateHarness(harness);

// --- renderer, scene, camera ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setFoveation?.(0.5);
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.enableDamping = true;

// Desktop view: frame the panel and the board together, whatever the window shape.
const VIEW = { left: -1.6, right: 0.75, bottom: 0.75, top: 1.68, z: -0.55 };
function fitCamera() {
  const cx = (VIEW.left + VIEW.right) / 2, cy = (VIEW.bottom + VIEW.top) / 2;
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const d = Math.max((VIEW.right - VIEW.left) / 2 / Math.tan(hfov / 2), (VIEW.top - VIEW.bottom) / 2 / Math.tan(vfov / 2)) * 1.05;
  camera.position.set(cx, cy + 0.15, VIEW.z + d);
  controls.target.set(cx, cy, VIEW.z);
  controls.update();
}
fitCamera();

const { metal } = buildWorkshop(scene);
const board = new Board(harness, metal);
board.group.position.set(0, 1.2, -0.62);
board.group.rotation.x = -0.35;
scene.add(board.group);
const wires = new WireLayer(board);
const panel = new Panel();
panel.mesh.position.set(-0.98, 1.3, -0.4);
panel.mesh.rotation.y = 0.55;
scene.add(panel.mesh);

const sfx = new Sfx();
const pointers = new Pointers(renderer, scene, camera, renderer.domElement);

// --- app state ---
const pos = nodePositions(harness);
const vlist = variants(harness);
const session = new Session(harness);
const ui = { variant: 0, mode: 'guided', status: '', statusKind: '', ghostUntil: 0, lastSecond: -1 };
let attempt = null;
let owner = null; // pointer currently holding the wire
let polylines = {};
const now = () => performance.now();
const connLabel = (cp) => `${cp}  ${nodeById(harness, cp.split('.')[0])?.label ?? ''}`;

function startRun() {
  session.start(vlist[ui.variant], ui.mode, now());
  const slots = bundleSlots(session.wires);
  polylines = Object.fromEntries(session.wires.map((w) => [w.id, wirePolyline(w, pos, slots)]));
  wires.clearDone();
  wires.clearLive();
  wires.clearGhost();
  wires.setHandle(null);
  for (const id of Object.keys(board.pegs)) board.setPeg(id, 'hidden');
  for (const p of session.pegs) board.setPeg(p.id, 'ghost');
  board.setHalos([]);
  attempt = null;
  ui.status = '';
  refresh();
}

function toMenu() {
  session.restart();
  attempt = null;
  owner = null;
  wires.clearLive();
  wires.clearGhost();
  wires.setHandle(null);
  wires.dimDone(false);
  board.setHalos([]);
  refresh();
}

function enterWire() {
  const w = session.wire;
  attempt = new RoutingAttempt(w.path, pos);
  owner = null;
  wires.dimDone(true);
  wires.clearLive();
  wires.setGhost(w, polylines[w.id]);
  ui.status = '';
  updateGuides();
  updateLive(null);
  refresh();
}

function enterQa() {
  attempt = null;
  owner = null;
  wires.dimDone(false);
  wires.clearGhost();
  wires.clearLive();
  wires.setHandle(null);
  const ends = new Set(session.wires.flatMap((w) => [w.path[0], w.path.at(-1)]));
  board.setHalos([...ends], 0x3ddc84);
  refresh();
}

function updateGuides() {
  if (session.state !== 'route' || !attempt) return;
  const w = session.wire;
  const guided = session.mode === 'guided' || now() < ui.ghostUntil;
  const target = w.path.at(-1);
  const ids = guided && attempt.next ? [...new Set([attempt.next, target])] : [target];
  board.setHalos(ids, COLOURS[w.colour] === COLOURS.WH ? 0x5ce1ff : COLOURS[w.colour]);
  wires.setGhostVisible(guided);
}

// Live wire = routed part (bundle-offset points) plus the free end at the pointer while held.
function updateLive(pointerMm) {
  const w = session.wire;
  const routed = polylines[w.id].slice(0, attempt.reached);
  const pts = attempt.holding && pointerMm ? [...routed, pointerMm] : routed;
  if (pts.length >= 2) wires.setLive(w, pts, false);
  else wires.clearLive();
  wires.setHandle(w, attempt.holding && pointerMm ? pointerMm : routed.at(-1), attempt.holding);
}

function handleEvents(events, p) {
  for (const e of events) {
    if (e.type === 'grab') { sfx.grab(); p.pulse(0.3, 20); }
    if (e.type === 'snap') {
      sfx.snap(); p.pulse(0.6, 40);
      board.flash(e.at, 0x3ddc84);
      ui.status = `✓ ${e.at}`; ui.statusKind = 'ok';
      updateGuides();
    }
    if (e.type === 'wrong') {
      sfx.wrong(); p.pulse(1, 140);
      board.flash(e.at, 0xff3b30);
      ui.status = session.mode === 'guided' ? `✗ ${e.at} is wrong, next is ${e.expected}` : `✗ ${e.at} is not on this route`;
      ui.statusKind = 'err';
    }
    if (e.type === 'done') {
      sfx.done();
      const w = session.wire;
      wires.setDone(w, polylines[w.id]);
      session.wireDone(attempt.errors, now());
      if (session.state === 'qa') enterQa();
      else enterWire();
      return;
    }
    refresh();
  }
}

function back() {
  if (session.state !== 'qa' && !(session.state === 'route' && session.index > 0)) return;
  session.back(now());
  wires.removeDone(session.wire.id);
  enterWire();
}

function showMe() {
  if (session.state !== 'route') return;
  session.hint();
  ui.ghostUntil = now() + 3000;
  wires.startTour();
  updateGuides();
  refresh();
}

function downloadLog() {
  const blob = new Blob([JSON.stringify({ ...session.summary(), date: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `formboard-log-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function onButton(id) {
  sfx.click();
  if (id.startsWith('variant:')) ui.variant = Number(id.split(':')[1]);
  else if (id.startsWith('mode:')) ui.mode = id.split(':')[1];
  else if (id === 'start') startRun();
  else if (id === 'menu') toMenu();
  else if (id === 'allpegs') { for (const p of session.pegs) board.setPeg(p.id, 'set'); session.setAllPegs(now()); enterWire(); return; }
  else if (id === 'showme') showMe();
  else if (id === 'back') back();
  else if (id.startsWith('qa:')) {
    session.checkQa(Number(id.split(':')[1]), now());
    if (session.state === 'summary') { sfx.finish(); board.setHalos([]); console.log('formboard log', session.summary()); }
  } else if (id === 'download') downloadLog();
  else if (id === 'again') startRun();
  refresh();
}

function onBoardPress(p) {
  if (session.state !== 'prep' || !p.boardMm) return;
  let best = null, bestD = GRAB_MM;
  for (const peg of session.pegs) {
    if (session.pegsSet.has(peg.id)) continue;
    const d = distance(p.boardMm, pos[peg.id]);
    if (d < bestD) { best = peg; bestD = d; }
  }
  if (!best) return;
  board.setPeg(best.id, 'set');
  sfx.snap(); p.pulse(0.5, 30);
  session.setPeg(best.id, now());
  if (session.state === 'route') enterWire();
  else refresh();
}

// --- panel views ---
const L = 56, R = 968;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function header(g, kicker, title) {
  g.text(kicker, L, 72, { size: 24, weight: 700, colour: '#5ce1ff' });
  g.text(title, L, 124, { size: 42, weight: 700, max: R - L });
}

const views = {
  menu(g) {
    header(g, 'FORMBOARD VR · WIRE HARNESS TRAINING', harness.description);
    g.text(`${harness.id} · ${harness.wires.length} wires · source: KBL + formboard layout`, L, 166, { size: 24, colour: '#9aa7b8' });
    if (problems.length) { g.para(`Harness data is invalid: ${problems.join('; ')}`, L, 230, R - L, { colour: '#ff6b6b' }); return; }
    g.text('Variant', L, 228, { size: 26, weight: 600, colour: '#9aa7b8' });
    vlist.forEach((v, i) => {
      const n = wiresForVariant(harness, v).length;
      g.button(`variant:${i}`, `${v.label} · ${n}`, L + (i % 2) * 464, 246 + Math.floor(i / 2) * 84, 448, 70, { selected: ui.variant === i, size: 26 });
    });
    g.text('Mode', L, 452, { size: 26, weight: 600, colour: '#9aa7b8' });
    g.button('mode:guided', 'Guided', L, 470, 448, 70, { selected: ui.mode === 'guided' });
    g.button('mode:test', 'Test', L + 464, 470, 448, 70, { selected: ui.mode === 'test' });
    g.para(ui.mode === 'guided' ? 'Path, next peg and target are shown. Learn the harness.' : 'Only the target connector is shown. Route from the drawing; errors and hints are logged.', L, 584, R - L, { size: 24, colour: '#c5ceda' });
    g.button('start', 'Start', L, 620, R - L, 76, { primary: true, size: 32 });
  },

  prep(g) {
    header(g, 'STEP 1 · BOARD PREP', 'Set the guide pegs');
    let y = g.para('Point at a blue ghost peg on the board and pinch (or pull the trigger) to insert it. Orange caps are Y-pegs at branch points.', L, 190, R - L);
    const n = session.pegsSet.size, total = session.pegs.length;
    g.text(`${n} / ${total} pegs`, L, y + 50, { size: 34, weight: 700 });
    g.bar(L, y + 74, R - L, 18, n / total);
    g.button('allpegs', 'Set all pegs', L, 620, 448, 76);
    g.button('menu', 'Menu', L + 464, 620, 448, 76);
  },

  route(g) {
    const w = session.wire, i = session.index, n = session.wires.length;
    header(g, `STEP 2 · WIRE ${i + 1} / ${n} · ${session.mode.toUpperCase()}`, '');
    g.swatch(L + 22, 112, COLOURS[w.colour] ?? 0xcccccc, 22);
    g.text(`${w.id}  ${COLOUR_NAMES[w.colour] ?? w.colour} · ${w.cross_section_mm2} mm²`, L + 60, 124, { size: 40, weight: 700 });
    g.text(`Signal ${w.signal} · ${w.length_mm} mm`, L, 170, { size: 26, colour: '#9aa7b8' });
    g.text('From', L, 222, { size: 24, colour: '#9aa7b8' });
    g.text(connLabel(w.from), L + 90, 222, { size: 28, weight: 600, max: R - L - 90 });
    g.text('To', L, 264, { size: 24, colour: '#9aa7b8' });
    g.text(connLabel(w.to), L + 90, 264, { size: 28, weight: 600, max: R - L - 90 });
    const instr = attempt?.holding
      ? (session.mode === 'guided' ? `Pull the wire to ${attempt.next}.` : 'Pull the wire along its route to the target connector.')
      : attempt?.reached > 1
        ? `Grab the wire end at ${attempt.end} to continue.`
        : `Grab the glowing end at ${w.path[0]} and pull it through the pegs to ${w.path.at(-1)}.`;
    g.para(instr, L, 322, R - L, { size: 28 });
    if (ui.status) g.text(ui.status, L, 420, { size: 30, weight: 700, colour: ui.statusKind === 'err' ? '#ff6b6b' : '#3ddc84' });
    const m = session.metrics[i];
    g.text(`Errors ${attempt?.errors ?? 0}    Hints ${m.hints}    Time ${fmt((now() - m.start) / 1000)}`, L, 478, { size: 28, colour: '#c5ceda' });
    g.text(`Peg ${attempt ? attempt.reached : 0} / ${w.path.length}`, R, 478, { size: 28, colour: '#c5ceda', align: 'right' });
    g.bar(L, 510, R - L, 14, attempt ? (attempt.reached - 1) / (w.path.length - 1) : 0, `#${(COLOURS[w.colour] ?? 0x5ce1ff).toString(16).padStart(6, '0')}`);
    g.bar(L, 540, R - L, 8, i / n);
    g.button('showme', 'Show me', L, 620, 290, 76);
    g.button('back', 'Undo last wire', L + 311, 620, 290, 76, { disabled: i === 0 });
    g.button('menu', 'Menu', L + 622, 620, 290, 76);
  },

  qa(g) {
    header(g, 'STEP 3 · QUALITY CHECK', 'Check the harness');
    g.text('Connector ends are highlighted. Confirm each check.', L, 172, { size: 26, colour: '#c5ceda' });
    QA_ITEMS.forEach((item, i) => g.button(`qa:${i}`, `${session.qa.has(i) ? '☑' : '☐'}  ${item}`, L, 210 + i * 92, R - L, 76, { selected: session.qa.has(i) }));
    g.button('back', 'Back to last wire', L, 620, 448, 76);
    g.button('menu', 'Menu', L + 464, 620, 448, 76);
  },

  summary(g) {
    const s = session.summary();
    header(g, 'DONE · HARNESS COMPLETE', `${s.variant} · ${s.mode}`);
    g.text(`${fmt(s.total_s)} total`, L, 196, { size: 36, weight: 700 });
    g.text(`${s.errors} errors`, L + 330, 196, { size: 36, weight: 700, colour: s.errors ? '#ff6b6b' : '#3ddc84' });
    g.text(`${s.hints} hints`, L + 610, 196, { size: 36, weight: 700, colour: '#c5ceda' });
    s.wires.forEach((w, i) => {
      const x = L + (i < 6 ? 0 : 464), y = 256 + (i % 6) * 54;
      const wire = session.wires.find((x) => x.id === w.wire);
      g.swatch(x + 14, y - 9, COLOURS[wire.colour] ?? 0xcccccc, 12);
      g.text(`${w.wire}   ${w.time_s.toFixed(1)} s   ${w.errors} err`, x + 40, y, { size: 26, colour: w.errors ? '#ffb3b3' : '#e9eef5' });
    });
    g.button('download', 'Download log', L, 620, 448, 76);
    g.button('again', 'New run', L + 464, 620, 448, 76, { primary: true });
  },
};

function refresh() {
  panel.draw(views[session.state]);
}

// --- frame loop ---
const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  if (!renderer.xr.isPresenting) controls.update();

  let hover = null;
  for (const p of pointers.update()) {
    const hp = p.raycaster.intersectObject(panel.mesh)[0];
    const hb = p.raycaster.intersectObject(board.surface)[0];
    const panelFirst = hp && (!hb || hp.distance < hb.distance);
    p.panelId = panelFirst ? panel.hit(hp.uv) : null;
    p.boardMm = !panelFirst && hb ? board.toMm(hb.point) : null;
    p.setRayLength((panelFirst ? hp : hb)?.distance);
    if (p.panelId) hover = p.panelId;
    if (p.justPressed) {
      sfx.unlock();
      p.pressOnPanel = panelFirst;
      if (p.panelId) onButton(p.panelId);
      else if (!panelFirst) onBoardPress(p);
    }
  }
  panel.setHover(hover);

  if (session.state === 'route' && attempt) {
    if (!owner) {
      for (const p of pointers.list) {
        if (!p.enabled || !p.pressed || p.pressOnPanel) continue;
        handleEvents(attempt.update(p.boardMm, true), p);
        if (attempt?.holding) { owner = p; break; }
      }
    } else {
      const p = owner;
      const events = attempt.update(p.enabled ? p.boardMm : null, p.enabled && p.pressed);
      if (!attempt.holding) owner = null;
      handleEvents(events, p);
    }
    if (session.state === 'route' && attempt) {
      updateLive(owner?.boardMm ?? null);
      if (ui.ghostUntil && now() > ui.ghostUntil) { ui.ghostUntil = 0; updateGuides(); }
      const sec = Math.floor(now() / 1000);
      if (sec !== ui.lastSecond) { ui.lastSecond = sec; refresh(); }
    }
  }

  board.update(dt, t);
  wires.update(dt, t);
  renderer.render(scene, camera);
}

refresh();
renderer.setAnimationLoop(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (!renderer.xr.isPresenting) fitCamera();
});

// Handy for debugging in the browser console.
// step() renders one frame by hand, for scripted tests when the page gets no animation frames.
window.formboard = { session, harness, board, panel, camera, step: frame };
