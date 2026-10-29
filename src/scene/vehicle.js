// Vehicle view: the full VW harness at 1:1 in vehicle coordinates, with the formboard harness
// highlighted where it sits in the car. Built from tools/real_kbl.py vehicle() output (metres, y up).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function tubes(segments, scale = 1) {
  const geos = segments.map((s) => {
    const pts = s.pts.map((p) => new THREE.Vector3(...p));
    const path = pts.length === 2 ? [pts[0], pts[0].clone().lerp(pts[1], 0.5), pts[1]] : pts;
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path), Math.max(4, path.length * 2), (s.r / 1000) * scale, 6, false);
  });
  return mergeGeometries(geos);
}

function sign(lines, width = 1024) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = 64 + lines.length * 52;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(14,18,25,0.85)';
  g.fillRect(0, 0, c.width, c.height);
  lines.forEach(([text, colour, size], i) => {
    g.fillStyle = colour;
    g.font = `${i ? 400 : 700} ${size}px system-ui, sans-serif`;
    g.fillText(text, 32, 58 + i * 52, width - 64);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, (1.2 * c.height) / c.width), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
  return m;
}

function label(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(14,18,25,0.85)';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#ffd29a';
  g.font = '600 34px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 34, 240);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(0.12, 0.03, 1);
  return s;
}

export class VehicleView {
  constructor(data) {
    this.group = new THREE.Group();
    const full = new THREE.Mesh(tubes(data.full), new THREE.MeshStandardMaterial({ color: 0x9fb0c4, roughness: 0.55 }));
    this.glow = new THREE.MeshStandardMaterial({ color: 0xf07b16, emissive: 0xf07b16, emissiveIntensity: 0.6, roughness: 0.4 });
    const hl = new THREE.Mesh(tubes(data.highlight, 1.6), this.glow);
    this.group.add(full, hl);

    for (const c of data.connectors) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 6), new THREE.MeshBasicMaterial({ color: 0xffd29a }));
      dot.position.set(...c.p);
      const l = label(c.label);
      l.position.set(c.p[0], c.p[1] + 0.035, c.p[2]);
      this.group.add(dot, l);
    }

    // Approximate vehicle footprint on the floor for scale (Beetle: about 4.1 m x 1.55 m).
    const outline = new THREE.Mesh(new THREE.RingGeometry(0.98, 1, 64), new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.35 }));
    outline.rotation.x = -Math.PI / 2;
    outline.scale.set(2.05, 0.78, 1);
    outline.position.y = -this.liftM + 0.003;
    this.group.add(outline);

    const s = sign([
      ['VW Old Beetle · full vehicle harness, 1:1', '#ffffff', 40],
      [`${data.full.length} segments from KBL ${data.full_id} · ${data.full_connectors} connectors`, '#c5ceda', 30],
      [`Orange: ignition harness ${data.highlight_id}, the one you build on the formboard`, '#f7a35c', 30],
      ['Source: VW VOBES sample, prostep ivip ECAD wiki, CC BY-SA 4.0', '#9aa7b8', 26],
    ]);
    s.position.set(0, 1.2, 0);
    this.sign = s;
    this.group.add(s);
  }

  get liftM() { return 0.35; } // harness z=0 sits about this high above the road

  update(t) {
    this.glow.emissiveIntensity = 0.45 + 0.3 * Math.sin(t * 3);
  }
}
