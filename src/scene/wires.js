// Wire tubes on the board: finished wires, the live wire being routed, the ghost path and the grab handle.
// Points come in as board mm; the board converts them to its local space.
import * as THREE from 'three';
import { COLOURS } from '../core/harness.js';

const WIRE_Z = 0.03; // wires lie in the peg forks
const CONNECTOR_Z = 0.016;

// Wire insulation: base colour with a lengthwise tracer stripe (Kennfarbe), as a small texture.
const stripeCache = new Map();
function wireMaterial(wire, extra = {}) {
  const base = COLOURS[wire.colour] ?? 0xcccccc;
  if (!wire.stripe) return new THREE.MeshStandardMaterial({ color: base, roughness: 0.45, ...extra });
  const key = `${wire.colour}/${wire.stripe}`;
  if (!stripeCache.has(key)) {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 32;
    const g = c.getContext('2d');
    const hex = (v) => `#${v.toString(16).padStart(6, '0')}`;
    g.fillStyle = hex(base); g.fillRect(0, 0, 4, 32);
    g.fillStyle = hex(COLOURS[wire.stripe] ?? 0xffffff); g.fillRect(0, 4, 4, 8); g.fillRect(0, 20, 4, 8);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    stripeCache.set(key, t);
  }
  return new THREE.MeshStandardMaterial({ color: 0xffffff, map: stripeCache.get(key), roughness: 0.45, ...extra });
}

export function wireRadius(crossSectionMm2) {
  return (1.8 + crossSectionMm2 * 0.8) / 1000;
}

export class WireLayer {
  constructor(board) {
    this.board = board;
    this.group = new THREE.Group();
    board.group.add(this.group);
    this.done = new Map(); // wire id -> mesh
    this.live = null;
    this.ghost = null;
    this.handle = new THREE.Mesh(new THREE.SphereGeometry(0.011, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.handleGlow = new THREE.Mesh(new THREE.SphereGeometry(0.02, 20, 12), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.handle.add(this.handleGlow);
    this.handle.visible = false;
    this.group.add(this.handle);
    this.tour = null;
    this.tourDot = new THREE.Mesh(new THREE.SphereGeometry(0.009, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.tourDot.visible = false;
    this.group.add(this.tourDot);
  }

  // Board mm points -> 3D points. The first and last node may be connectors (lower z).
  points3(pointsMm, connectorEnds = [true, true]) {
    return pointsMm.map((p, i) => {
      const atConnector = (i === 0 && connectorEnds[0]) || (i === pointsMm.length - 1 && connectorEnds[1]);
      return this.board.local(p, atConnector ? CONNECTOR_Z : WIRE_Z);
    });
  }

  tube(points, radius, material) {
    const pts = points.length === 2 ? [points[0], points[0].clone().lerp(points[1], 0.5), points[1]] : points;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const geo = new THREE.TubeGeometry(curve, Math.max(16, pts.length * 14), radius, 8, false);
    return new THREE.Mesh(geo, material);
  }

  setDone(wire, pointsMm) {
    this.removeDone(wire.id);
    const mat = wireMaterial(wire, { transparent: true });
    const mesh = this.tube(this.points3(pointsMm), wireRadius(wire.cross_section_mm2), mat);
    this.group.add(mesh);
    this.done.set(wire.id, mesh);
  }

  removeDone(id) {
    const m = this.done.get(id);
    if (!m) return;
    this.group.remove(m);
    m.geometry.dispose();
    m.material.dispose();
    this.done.delete(id);
  }

  clearDone() {
    for (const id of [...this.done.keys()]) this.removeDone(id);
  }

  // Earlier wires fade back so the current one stands out.
  dimDone(dim) {
    for (const m of this.done.values()) m.material.opacity = dim ? 0.35 : 1;
  }

  setLive(wire, pointsMm, tipConnector = false) {
    this.clearLive();
    if (!wire || pointsMm.length < 2) return;
    const mat = wireMaterial(wire, { emissive: COLOURS[wire.colour] ?? 0, emissiveIntensity: 0.2 });
    this.live = this.tube(this.points3(pointsMm, [true, tipConnector]), wireRadius(wire.cross_section_mm2), mat);
    this.group.add(this.live);
  }

  clearLive() {
    if (!this.live) return;
    this.group.remove(this.live);
    this.live.geometry.dispose();
    this.live.material.dispose();
    this.live = null;
  }

  setGhost(wire, pointsMm) {
    this.clearGhost();
    if (!wire) return;
    const mat = new THREE.MeshBasicMaterial({ color: COLOURS[wire.colour] ?? 0xffffff, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
    this.ghost = this.tube(this.points3(pointsMm), wireRadius(wire.cross_section_mm2) * 2.2, mat);
    this.ghostPts = this.points3(pointsMm);
    this.group.add(this.ghost);
  }

  clearGhost() {
    if (!this.ghost) return;
    this.group.remove(this.ghost);
    this.ghost.geometry.dispose();
    this.ghost.material.dispose();
    this.ghost = null;
  }

  setGhostVisible(v) {
    if (this.ghost) this.ghost.visible = v;
  }

  setHandle(wire, pMm, held) {
    if (!wire || !pMm) { this.handle.visible = false; return; }
    const c = COLOURS[wire.colour] ?? 0xffffff;
    this.handle.material.color.setHex(c);
    this.handleGlow.material.color.setHex(c);
    this.handle.position.copy(this.board.local(pMm, WIRE_Z + 0.004));
    this.handle.visible = true;
    this.handle.userData.held = held;
  }

  // "Show me": a dot runs along the ghost path.
  startTour() {
    if (this.ghostPts) this.tour = { t: 0, curve: new THREE.CatmullRomCurve3(this.ghostPts.length === 2 ? [this.ghostPts[0], this.ghostPts[0].clone().lerp(this.ghostPts[1], 0.5), this.ghostPts[1]] : this.ghostPts, false, 'centripetal') };
  }

  update(dt, t) {
    const s = this.handle.userData.held ? 1.25 : 1 + 0.3 * Math.sin(t * 5);
    this.handleGlow.scale.setScalar(s);
    if (this.ghost) this.ghost.material.opacity = 0.22 + 0.14 * Math.sin(t * 3);
    if (this.tour) {
      this.tour.t += dt / 2.2;
      this.tourDot.visible = this.tour.t < 1;
      if (this.tour.t < 1) this.tourDot.position.copy(this.tour.curve.getPointAt(this.tour.t));
      else this.tour = null;
    }
  }
}
