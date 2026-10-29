import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotate, heading, placeRig, yawToFace } from '../src/core/rig.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const nearAngle = (a, b) => near(Math.cos(a - b), 1);
const world = (rig, base) => { const r = rotate(base, rig.yaw); return { x: r.x + rig.x, z: r.z + rig.z }; };

test('rig: rotate adds to heading', () => {
  nearAngle(heading(rotate({ x: 0, z: -1 }, 0.7)), heading({ x: 0, z: -1 }) + 0.7);
});

test('rig: teleport lands the head on the target, keeping the turn', () => {
  const rig = { x: 1, z: -2, yaw: 0.4 };
  const headBase = { x: 0.3, z: -0.5 }; // user stands off-centre in the play area
  const r = placeRig(rig, world(rig, headBase), { x: 5, z: 3 });
  const head = world(r, headBase);
  near(head.x, 5); near(head.z, 3); near(r.yaw, 0.4);
});

test('rig: jump turns the view towards the target direction', () => {
  const rig = { x: 0, z: 0, yaw: 0 };
  const viewWorld = { x: 0, z: -1 }; // looking at the board
  const dir = { x: 1, z: 0 }; // want to face +x (the car)
  const yaw = yawToFace(rig, viewWorld, dir);
  const r = placeRig(rig, { x: 0, z: 0 }, { x: 1, z: 1 }, yaw);
  const v = rotate(rotate(viewWorld, -rig.yaw), r.yaw);
  nearAngle(heading(v), heading(dir));
});

test('rig: turning on the spot keeps the head where it is', () => {
  const rig = { x: 0.5, z: -1, yaw: 0.2 };
  const headBase = { x: 0.4, z: 0.3 };
  const head = world(rig, headBase);
  const r = placeRig(rig, head, head, rig.yaw - Math.PI / 6);
  const after = world(r, headBase);
  near(after.x, head.x); near(after.z, head.z); near(r.yaw, 0.2 - Math.PI / 6);
});
