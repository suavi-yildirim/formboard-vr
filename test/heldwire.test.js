import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heldWire } from '../src/core/heldwire.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const pathLen = (pts) => pts.slice(1).reduce((s, q, i) => s + dist(pts[i], q), 0);
const g = { x: 0, y: 0, z: -9.81 };

test('held wire: light tension, a shallow arc about 2 % longer than the straight line', () => {
  const r = heldWire({ start: { x: 0, y: 0, z: 0.3 }, hand: { x: 0.4, y: 0, z: 0.3 }, remaining: 1.2, gravity: g, floorZ: -10 });
  assert.equal(r.taut, false);
  assert.deepEqual(r.end, { x: 0.4, y: 0, z: 0.3 });
  const mid = r.points[Math.floor(r.points.length / 2)];
  assert.ok(mid.z < 0.3 - 0.02 && mid.z > 0.3 - 0.06, `shallow sag: ${mid.z}`);
  const ratio = pathLen(r.points) / 0.4;
  assert.ok(ratio > 1.01 && ratio < 1.03, `length ratio ${ratio}`);
});

test('held wire: the rest hangs beyond the hand as a short tail along gravity', () => {
  const r = heldWire({ start: { x: 0, y: 0, z: 0.3 }, hand: { x: 0.4, y: 0, z: 0.3 }, remaining: 1.2, gravity: g, floorZ: -10 });
  const tip = r.tail.at(-1);
  assert.ok(Math.abs(tip.x - 0.4) < 1e-9 && Math.abs(tip.z - 0.15) < 1e-9, `tail tip ${JSON.stringify(tip)}`);
});

test('held wire: pulled further than the wire reaches it is straight and stops short', () => {
  const r = heldWire({ start: { x: 0, y: 0, z: 0 }, hand: { x: 0.8, y: 0, z: 0 }, remaining: 0.5, gravity: g, floorZ: -10 });
  assert.equal(r.taut, true);
  assert.ok(Math.abs(r.end.x - 0.5) < 1e-9);
  assert.ok(r.points.every((q) => Math.abs(q.z) < 1e-9));
  assert.equal(r.tail.length, 0);
});

test('held wire: never below the board surface, any hand position (no folds)', () => {
  for (const hand of [{ x: 0.05, y: 0.02, z: 0.01 }, { x: -0.3, y: 0.2, z: 0.04 }, { x: 0.3, y: -0.4, z: 0.2 }]) {
    const r = heldWire({ start: { x: 0, y: 0, z: 0.03 }, hand, remaining: 1.1, gravity: { x: 0, y: -6, z: -7.5 }, floorZ: 0.003, bounds: { w: 1, h: 1 } });
    assert.ok([...r.points.slice(1, -1), ...r.tail].every((q) => q.z >= 0.003 - 1e-9));
    // consecutive points stay close together: no long jumps, no loops back
    const step = Math.max(...r.points.slice(1).map((q, i) => dist(r.points[i], q)));
    assert.ok(step < dist({ x: 0, y: 0, z: 0.03 }, hand) / 8, `max step ${step}`);
  }
});
