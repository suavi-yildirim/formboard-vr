// Harness model: validation, variants, steps and wire geometry on the board (all in mm).
import { cellToMm, boardSizeMm } from './grid.js';

export const COLOURS = {
  RD: 0xd7263d, BN: 0x7b4a2a, VT: 0x8e44ad, BU: 0x1f6fd1, GY: 0x9aa0a6, GN: 0x2e9e4f,
  YE: 0xf2c80f, WH: 0xf4f4f4, OG: 0xf07b16, BK: 0x222222, PK: 0xf48fb1,
};

export const COLOUR_NAMES = {
  RD: 'red', BN: 'brown', VT: 'violet', BU: 'blue', GY: 'grey', GN: 'green',
  YE: 'yellow', WH: 'white', OG: 'orange', BK: 'black', PK: 'pink',
};

const BUNDLE_SPACING_MM = 7;

export function validateHarness(h) {
  const problems = [];
  const ids = new Set();
  const size = boardSizeMm(h.board);
  for (const n of h.nodes) {
    if (ids.has(n.id)) problems.push(`duplicate node ${n.id}`);
    ids.add(n.id);
    try {
      const p = nodePosition(n, h.board);
      if (p.x < 0 || p.y < 0 || p.x > size.w || p.y > size.h) problems.push(`node ${n.id} is off the board`);
    } catch (e) {
      problems.push(`node ${n.id}: ${e.message}`);
    }
  }
  const seg = new Set(h.segments.map(([a, b]) => segKey(a, b)));
  for (const w of h.wires) {
    if (w.path.length < 2) problems.push(`wire ${w.id} has no path`);
    for (const n of w.path) if (!ids.has(n)) problems.push(`wire ${w.id} uses unknown node ${n}`);
    for (let i = 1; i < w.path.length; i++) {
      if (!seg.has(segKey(w.path[i - 1], w.path[i]))) {
        problems.push(`wire ${w.id} jumps ${w.path[i - 1]} -> ${w.path[i]} without a segment`);
      }
    }
    if (w.from_node !== w.path[0] || w.to_node !== w.path.at(-1)) {
      problems.push(`wire ${w.id} path does not start/end at its connectors`);
    }
  }
  return problems;
}

function segKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Variants are cumulative: the first module is the base, each further option adds its wires.
export function variants(h) {
  const [base, ...options] = h.modules;
  const list = [{ id: base.id, label: base.label, modules: [base.id] }];
  if (!options.length) return list;
  for (const m of options) list.push({ id: `${base.id}+${m.id}`, label: `${base.label} + ${shortLabel(m.label)}`, modules: [base.id, m.id] });
  if (options.length > 1) list.push({ id: 'ALL', label: 'Full equipment', modules: h.modules.map((m) => m.id) });
  return list;
}

function shortLabel(label) {
  return label.replace(/\s*\(.*\)\s*$/, '');
}

export function wiresForVariant(h, variant) {
  const wanted = new Set(h.modules.filter((m) => variant.modules.includes(m.id)).flatMap((m) => m.wires));
  return h.wires.filter((w) => wanted.has(w.id));
}

// Pegs and branch points needed for a set of wires, in board order (left to right).
export function pegsFor(h, wires) {
  const used = new Set(wires.flatMap((w) => w.path));
  const pos = nodePositions(h);
  return h.nodes
    .filter((n) => n.kind !== 'connector' && used.has(n.id))
    .sort((a, b) => pos[a.id].x - pos[b.id].x || pos[a.id].y - pos[b.id].y);
}

// A node sits either on a grid cell ("H9", hand-made layouts) or at board mm (flattened real KBL).
export function nodePosition(n, board) {
  return n.xy ? { x: n.xy[0], y: n.xy[1] } : cellToMm(n.cell, board.pitch_mm);
}

export function nodePositions(h) {
  const pos = {};
  for (const n of h.nodes) pos[n.id] = nodePosition(n, h.board);
  return pos;
}

// Lateral slot of each wire on each segment, so wires sharing a segment lie side by side as a bundle.
export function bundleSlots(wires) {
  const bySeg = {};
  for (const w of wires) {
    for (let i = 1; i < w.path.length; i++) (bySeg[segKey(w.path[i - 1], w.path[i])] ??= []).push(w.id);
  }
  const slots = {};
  for (const [key, ids] of Object.entries(bySeg)) {
    ids.forEach((id, i) => { (slots[id] ??= {})[key] = i - (ids.length - 1) / 2; });
  }
  return slots;
}

// Polyline of a wire in mm: one point at each node, shifted sideways by its bundle slot.
export function wirePolyline(wire, pos, slots) {
  const s = slots[wire.id] ?? {};
  const pts = [];
  for (let i = 0; i < wire.path.length; i++) {
    const p = pos[wire.path[i]];
    const offs = [];
    if (i > 0) offs.push(segOffset(pos[wire.path[i - 1]], p, s[segKey(wire.path[i - 1], wire.path[i])] ?? 0));
    if (i < wire.path.length - 1) offs.push(segOffset(p, pos[wire.path[i + 1]], s[segKey(wire.path[i], wire.path[i + 1])] ?? 0));
    const ox = offs.reduce((a, o) => a + o.x, 0) / offs.length;
    const oy = offs.reduce((a, o) => a + o.y, 0) / offs.length;
    pts.push({ x: p.x + ox, y: p.y + oy });
  }
  return pts;
}

function segOffset(a, b, slot) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: (-dy / len) * slot * BUNDLE_SPACING_MM, y: (dx / len) * slot * BUNDLE_SPACING_MM };
}

export function nodeById(h, id) {
  return h.nodes.find((n) => n.id === id);
}
