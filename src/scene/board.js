// The formboard: perforated surface with the 1:1 drawing, connectors, pegs, halos and flashes.
// Board group local space: metres, origin at the grid centre, x right, y up, z out of the surface.
import * as THREE from 'three';
import { boardSizeMm, colName, cellToMm } from '../core/grid.js';

const MARGIN_MM = 45;
const TEX_PX_PER_MM = 1.6;
const PEG_H = 0.05;

export class Board {
  constructor(harness, metal) {
    this.h = harness;
    this.size = boardSizeMm(harness.board);
    this.group = new THREE.Group();
    this.pos = {};
    for (const n of harness.nodes) this.pos[n.id] = cellToMm(n.cell, harness.board.pitch_mm);
    this.pegs = {};
    this.halos = {};
    this.flashes = [];
    this.metal = metal;

    this.buildSurface();
    this.buildFrame();
    this.buildConnectors();
    this.buildPegs();
  }

  local(p, z = 0) {
    return new THREE.Vector3(p.x / 1000 - this.size.w / 2000, p.y / 1000 - this.size.h / 2000, z);
  }

  // World point on the surface -> board mm, or null when off the grid area (with margin).
  toMm(world) {
    const l = this.group.worldToLocal(world.clone());
    const p = { x: (l.x + this.size.w / 2000) * 1000, y: (l.y + this.size.h / 2000) * 1000 };
    if (p.x < -MARGIN_MM || p.y < -MARGIN_MM || p.x > this.size.w + MARGIN_MM || p.y > this.size.h + MARGIN_MM) return null;
    return p;
  }

  buildSurface() {
    const { w, h } = this.size;
    const W = w + 2 * MARGIN_MM, H = h + 2 * MARGIN_MM;
    const c = document.createElement('canvas');
    c.width = Math.round(W * TEX_PX_PER_MM);
    c.height = Math.round(H * TEX_PX_PER_MM);
    const g = c.getContext('2d');
    const s = TEX_PX_PER_MM;
    const X = (mm) => (mm + MARGIN_MM) * s;
    const Y = (mm) => (h - mm + MARGIN_MM) * s;

    g.fillStyle = '#e8eaed';
    g.fillRect(0, 0, c.width, c.height);
    // perforation every 25 mm
    g.fillStyle = '#b4bac3';
    for (let x = 12.5; x < w; x += 25) for (let y = 12.5; y < h; y += 25) {
      g.beginPath(); g.arc(X(x), Y(y), 2.6 * s, 0, Math.PI * 2); g.fill();
    }
    // grid lines at cell borders
    g.strokeStyle = '#c9ced6';
    g.lineWidth = 1.2;
    const p = this.h.board.pitch_mm;
    for (let x = 0; x <= w; x += p) { g.beginPath(); g.moveTo(X(x), Y(0)); g.lineTo(X(x), Y(h)); g.stroke(); }
    for (let y = 0; y <= h; y += p) { g.beginPath(); g.moveTo(X(0), Y(y)); g.lineTo(X(w), Y(y)); g.stroke(); }
    // grid labels in the margin
    g.fillStyle = '#3d5a80';
    g.font = `bold ${16 * s}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let col = 0; col < this.h.board.cols; col++) {
      g.fillText(colName(col), X((col + 0.5) * p), Y(-MARGIN_MM / 2));
      g.fillText(colName(col), X((col + 0.5) * p), Y(h + MARGIN_MM / 2));
    }
    for (let row = 0; row < this.h.board.rows; row++) {
      g.fillText(String(row + 1), X(-MARGIN_MM / 2), Y((row + 0.5) * p));
      g.fillText(String(row + 1), X(w + MARGIN_MM / 2), Y((row + 0.5) * p));
    }
    // 1:1 formboard drawing: bundle segments and node names, as glued onto real boards
    g.strokeStyle = 'rgba(61,90,128,0.35)';
    g.lineCap = 'round';
    g.lineWidth = 14 * s;
    for (const [a, b] of this.h.segments) {
      g.beginPath(); g.moveTo(X(this.pos[a].x), Y(this.pos[a].y)); g.lineTo(X(this.pos[b].x), Y(this.pos[b].y)); g.stroke();
    }
    g.fillStyle = '#3d5a80';
    g.font = `${11 * s}px system-ui, sans-serif`;
    for (const n of this.h.nodes) {
      if (n.kind === 'connector') continue;
      g.fillText(`${n.id} · ${n.cell}`, X(this.pos[n.id].x), Y(this.pos[n.id].y - 22));
    }
    g.textAlign = 'left';
    g.font = `bold ${13 * s}px system-ui, sans-serif`;
    g.fillText(`${this.h.id} · ${this.h.description} · formboard 1:1`, X(8), Y(h - 14));

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(W / 1000, H / 1000), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
    this.group.add(this.surface);
  }

  buildFrame() {
    const { w, h } = this.size;
    const W = (w + 2 * MARGIN_MM) / 1000, H = (h + 2 * MARGIN_MM) / 1000;
    const back = new THREE.Mesh(new THREE.BoxGeometry(W + 0.03, H + 0.03, 0.025), new THREE.MeshStandardMaterial({ color: 0x30363f, roughness: 0.7 }));
    back.position.z = -0.0126;
    this.group.add(back);
    // Rear struts down to the bench, so the tilted board does not float.
    for (const x of [-W / 2 + 0.15, W / 2 - 0.15]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.5, 0.03), this.metal);
      strut.position.set(x, -H / 2 + 0.12, -0.13);
      strut.rotation.x = 0.55;
      this.group.add(strut);
    }
  }

  buildConnectors() {
    this.connectors = {};
    const body = new THREE.BoxGeometry(0.07, 0.045, 0.03);
    for (const n of this.h.nodes.filter((x) => x.kind === 'connector')) {
      const grp = new THREE.Group();
      const mesh = new THREE.Mesh(body, new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5 }));
      mesh.position.z = 0.015;
      grp.add(mesh);
      const holder = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.035), this.metal);
      holder.position.set(0, -0.03, 0.017);
      grp.add(holder);
      const label = makeLabel(`${n.id}  ${n.label}`);
      label.position.set(0, 0.05, 0.04);
      grp.add(label);
      grp.position.copy(this.local(this.pos[n.id]));
      this.group.add(grp);
      this.connectors[n.id] = { grp, mesh };
    }
  }

  buildPegs() {
    const post = new THREE.CylinderGeometry(0.004, 0.005, PEG_H, 12).rotateX(Math.PI / 2).translate(0, 0, PEG_H / 2);
    const prong = new THREE.CylinderGeometry(0.0025, 0.0025, 0.03, 8).rotateX(Math.PI / 2);
    const cap = new THREE.SphereGeometry(0.008, 16, 8);
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.45, depthWrite: false });
    const branchMat = new THREE.MeshStandardMaterial({ color: 0xf07b16, roughness: 0.4 });

    for (const n of this.h.nodes.filter((x) => x.kind !== 'connector')) {
      const set = new THREE.Group();
      set.add(new THREE.Mesh(post, this.metal));
      const dir = this.segmentAngle(n.id);
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(prong, this.metal);
        m.position.set(Math.cos(dir + Math.PI / 2) * 0.008 * s, Math.sin(dir + Math.PI / 2) * 0.008 * s, PEG_H - 0.005);
        set.add(m);
      }
      if (n.kind === 'branch') {
        const c = new THREE.Mesh(cap, branchMat);
        c.position.z = PEG_H + 0.012;
        set.add(c);
      }
      const ghost = set.clone();
      ghost.traverse((o) => { if (o.isMesh) o.material = this.ghostMat; });

      const grp = new THREE.Group();
      grp.position.copy(this.local(this.pos[n.id]));
      grp.add(set, ghost);
      set.visible = ghost.visible = false;
      this.group.add(grp);
      this.pegs[n.id] = { grp, set, ghost, drop: 0 };
    }
  }

  segmentAngle(id) {
    const seg = this.h.segments.find(([a, b]) => a === id || b === id);
    const other = seg[0] === id ? seg[1] : seg[0];
    return Math.atan2(this.pos[other].y - this.pos[id].y, this.pos[other].x - this.pos[id].x);
  }

  setPeg(id, state) {
    const p = this.pegs[id];
    if (!p) return;
    p.ghost.visible = state === 'ghost';
    if (state === 'set' && !p.set.visible) p.drop = 1;
    p.set.visible = state === 'set';
  }

  // Pulsing rings on the given nodes; colour as hex.
  setHalos(ids, colour = 0x5ce1ff) {
    for (const [id, m] of Object.entries(this.halos)) m.visible = ids.includes(id);
    for (const id of ids) {
      if (!this.halos[id]) {
        const m = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.027, 40), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        m.position.copy(this.local(this.pos[id], 0.003));
        this.group.add(m);
        this.halos[id] = m;
      }
      this.halos[id].material.color.setHex(colour);
      this.halos[id].visible = true;
    }
  }

  flash(id, colour) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.032, 32), new THREE.MeshBasicMaterial({ color: colour, transparent: true, depthWrite: false }));
    m.position.copy(this.local(this.pos[id], 0.004));
    this.group.add(m);
    this.flashes.push({ m, t: 0 });
  }

  update(dt, t) {
    const pulse = 1 + 0.25 * Math.sin(t * 6);
    for (const m of Object.values(this.halos)) {
      m.scale.setScalar(pulse);
      m.material.opacity = 0.55 + 0.35 * Math.sin(t * 6);
    }
    this.ghostMat.opacity = 0.3 + 0.2 * Math.sin(t * 4);
    for (const p of Object.values(this.pegs)) {
      if (p.drop > 0) {
        p.drop = Math.max(0, p.drop - dt * 5);
        p.set.position.z = p.drop * p.drop * 0.08;
      }
    }
    this.flashes = this.flashes.filter((f) => {
      f.t += dt;
      f.m.material.opacity = Math.max(0, 0.8 - f.t * 1.6);
      f.m.scale.setScalar(1 + f.t * 1.5);
      if (f.t > 0.5) { this.group.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); return false; }
      return true;
    });
  }
}

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,24,31,0.85)';
  roundRect(g, 4, 4, 504, 88, 18); g.fill();
  g.fillStyle = '#ffffff';
  g.font = '600 40px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 50, 480);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(0.16, 0.03, 1);
  return s;
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
