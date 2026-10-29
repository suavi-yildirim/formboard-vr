// Where the user's tracked play space sits in the scene (for teleport and jump buttons).
// The rig is a floor offset {x, z} plus a turn `yaw` (radians about the vertical axis):
//   world = rotate(base, yaw) + rig
// Plain {x, z} objects, no three.js, so this can be unit tested.

export function rotate(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: v.x * c + v.z * s, z: -v.x * s + v.z * c };
}

// Heading of a direction on the floor; rotate(v, a) adds a to it.
export function heading(v) {
  return Math.atan2(v.x, v.z);
}

// New rig that puts the head (seen now at headWorld) at target, turned to newYaw.
// The head's own offset inside the play space is kept, so the user lands exactly on the spot.
export function placeRig(rig, headWorld, target, newYaw = rig.yaw) {
  const headBase = rotate({ x: headWorld.x - rig.x, z: headWorld.z - rig.z }, -rig.yaw);
  const turned = rotate(headBase, newYaw);
  return { x: target.x - turned.x, z: target.z - turned.z, yaw: newYaw };
}

// Turn that makes the current view direction (world) point along dir after the move.
export function yawToFace(rig, viewWorld, dir) {
  const viewBase = rotate(viewWorld, -rig.yaw);
  return heading(dir) - heading(viewBase);
}
