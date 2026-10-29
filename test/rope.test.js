import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rope } from '../src/core/rope.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const ropeLength = (pts) => pts.slice(1).reduce((s, q, i) => s + dist(pts[i], q), 0);
const settle = (rope, opts, steps = 400) => { let r; for (let i = 0; i < steps; i++) r = rope.step(1 / 72, opts); return r; };

test('rope: slack wire sags under gravity and keeps its length', () => {
  const rope = new Rope(16);
  const start = { x: 0, y: 0, z: 0.3 }, hand = { x: 0.3, y: 0, z: 0.3 };
  const r = settle(rope, { start, hand, length: 0.5, gravity: { x: 0, y: 0, z: -9.81 }, floorZ: -10 });
  assert.equal(r.taut, false);
  assert.deepEqual(r.end, hand);
  const mid = r.points[8];
  assert.ok(mid.z < 0.3 - 0.1, `sags: ${mid.z}`);
  assert.ok(Math.abs(ropeLength(r.points) - 0.5) < 0.02, `length ${ropeLength(r.points)}`);
});

test('rope: pulling beyond the wire length makes it taut and stops the end', () => {
  const rope = new Rope(16);
  const start = { x: 0, y: 0, z: 0 }, hand = { x: 0.8, y: 0, z: 0 };
  const r = settle(rope, { start, hand, length: 0.5, gravity: { x: 0, y: 0, z: -9.81 }, floorZ: -10 });
  assert.equal(r.taut, true);
  assert.ok(Math.abs(r.end.x - 0.5) < 1e-9);
  assert.ok(r.points.every((q) => Math.abs(q.z) < 0.01), 'straight line');
});

test('rope: the board surface holds the wire up, off the board it hangs down', () => {
  const rope = new Rope(16);
  const g = { x: 0, y: 0, z: -9.81 };
  const r = settle(rope, { start: { x: 0, y: 0, z: 0.03 }, hand: { x: 0.2, y: 0, z: 0.03 }, length: 0.4, gravity: g, floorZ: 0.01, bounds: { w: 1, h: 1 } });
  assert.ok(r.points.every((q) => q.z >= 0.01 - 1e-9), 'rests on the surface');
  const off = new Rope(16);
  const r2 = settle(off, { start: { x: 0.45, y: 0, z: 0.03 }, hand: { x: 0.6, y: 0, z: 0.03 }, length: 0.4, gravity: g, floorZ: 0.01, bounds: { w: 1, h: 1 } });
  assert.ok(Math.min(...r2.points.map((q) => q.z)) < -0.05, 'hangs past the edge');
});
