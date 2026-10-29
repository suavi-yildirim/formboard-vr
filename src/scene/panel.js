// Floating instruction panel: a canvas texture on a plane, with buttons hit-tested by UV.
// Dark semi-transparent backplate and high-contrast text, as in the original HUD concept.
import * as THREE from 'three';
import { roundRect } from './board.js';

const W = 1024, H = 720;

export class Panel {
  constructor(widthM = 0.64) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(widthM, (widthM * H) / W),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.buttons = [];
    this.hoverId = null;
    this.builder = null;
  }

  draw(builder) {
    this.builder = builder;
    this.redraw();
  }

  redraw() {
    const g = this.g;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(14,18,25,0.88)';
    roundRect(g, 0, 0, W, H, 36);
    g.fill();
    g.strokeStyle = 'rgba(92,225,255,0.5)';
    g.lineWidth = 3;
    roundRect(g, 2, 2, W - 4, H - 4, 34);
    g.stroke();
    this.buttons = [];
    this.builder?.(this);
    this.tex.needsUpdate = true;
  }

  setHover(id) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.redraw();
  }

  hit(uv) {
    const x = uv.x * W, y = (1 - uv.y) * H;
    const b = this.buttons.find((b) => !b.disabled && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    return b?.id ?? null;
  }

  // --- drawing helpers used by the view builders ---

  text(str, x, y, { size = 30, weight = 400, colour = '#e9eef5', align = 'left', max } = {}) {
    const g = this.g;
    g.font = `${weight} ${size}px system-ui, -apple-system, sans-serif`;
    g.fillStyle = colour;
    g.textAlign = align;
    g.textBaseline = 'alphabetic';
    g.fillText(str, x, y, max);
  }

  // Wraps text into lines that fit width; returns the y below the last line.
  para(str, x, y, width, opts = {}) {
    const size = opts.size ?? 28;
    this.g.font = `${opts.weight ?? 400} ${size}px system-ui, -apple-system, sans-serif`;
    let line = '';
    for (const word of str.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (this.g.measureText(test).width > width && line) {
        this.text(line, x, y, opts);
        y += size * 1.3;
        line = word;
      } else line = test;
    }
    if (line) { this.text(line, x, y, opts); y += size * 1.3; }
    return y;
  }

  button(id, label, x, y, w, h, { selected = false, primary = false, disabled = false, size = 28 } = {}) {
    const g = this.g;
    const hover = this.hoverId === id && !disabled;
    g.fillStyle = disabled ? 'rgba(255,255,255,0.05)'
      : selected ? 'rgba(92,225,255,0.9)'
      : primary ? (hover ? '#7ff0b0' : '#3ddc84')
      : hover ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)';
    roundRect(g, x, y, w, h, 16);
    g.fill();
    if (hover) { g.strokeStyle = '#ffffff'; g.lineWidth = 3; roundRect(g, x, y, w, h, 16); g.stroke(); }
    this.text(label, x + w / 2, y + h / 2 + size * 0.36, {
      size, weight: 600, align: 'center', max: w - 16,
      colour: disabled ? '#6b7480' : selected || primary ? '#0d1117' : '#e9eef5',
    });
    this.buttons.push({ id, x, y, w, h, disabled });
  }

  swatch(x, y, hex, r = 18) {
    const g = this.g;
    g.fillStyle = `#${hex.toString(16).padStart(6, '0')}`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 2; g.stroke();
  }

  bar(x, y, w, h, frac, colour = '#5ce1ff') {
    const g = this.g;
    g.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(g, x, y, w, h, h / 2); g.fill();
    if (frac > 0) { g.fillStyle = colour; roundRect(g, x, y, Math.max(h, w * frac), h, h / 2); g.fill(); }
  }

  get width() { return W; }
  get height() { return H; }
}
