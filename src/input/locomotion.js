// Teleport and jumps in VR. The user is moved by offsetting the WebXR reference space, so the
// head, hands, controllers and their rays all follow without a separate camera rig.
import * as THREE from 'three';
import { placeRig, yawToFace } from '../core/rig.js';

const FLOOR_LIMIT = 7; // metres from the centre of the room
const MAX_DISTANCE = 10;

export class Locomotion {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.base = null;
    this.rig = { x: 0, z: 0, yaw: 0 };
    this.floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.marker = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.27, 48), new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.9, depthWrite: false }));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.06, 24), new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.6, depthWrite: false }));
    for (const m of [ring, dot]) { m.rotation.x = -Math.PI / 2; this.marker.add(m); }
    this.marker.position.y = 0.01;
    this.marker.visible = false;
    scene.add(this.marker);

    renderer.xr.addEventListener('sessionstart', () => {
      this.base = renderer.xr.getReferenceSpace();
      this.rig = { x: 0, z: 0, yaw: 0 };
    });
    renderer.xr.addEventListener('sessionend', () => { this.base = null; });
  }

  get active() { return !!this.base; }

  // Floor point the ray points at, or null (pointing up, too far, outside the room).
  floorHit(ray) {
    if (ray.direction.y > -0.05) return null;
    const p = ray.intersectPlane(this.floor, new THREE.Vector3());
    if (!p || p.distanceTo(ray.origin) > MAX_DISTANCE || Math.abs(p.x) > FLOOR_LIMIT || Math.abs(p.z) > FLOOR_LIMIT) return null;
    return p;
  }

  showMarker(p) {
    this.marker.visible = !!p;
    if (p) this.marker.position.set(p.x, 0.01, p.z);
  }

  head() {
    const cam = this.renderer.xr.getCamera();
    const pos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
    return { pos: { x: pos.x, z: pos.z }, fwd: { x: fwd.x, z: fwd.z } };
  }

  // Teleport: stand on the spot, keep the current turn.
  teleport(p) {
    if (!this.active) return;
    this.apply(placeRig(this.rig, this.head().pos, { x: p.x, z: p.z }));
  }

  // Jump: stand on the spot and face the look-at point.
  jump(spot) {
    if (!this.active) return;
    const h = this.head();
    const dir = { x: spot.look.x - spot.pos.x, z: spot.look.z - spot.pos.z };
    this.apply(placeRig(this.rig, h.pos, spot.pos, yawToFace(this.rig, h.fwd, dir)));
  }

  // world = rotate(base, yaw) + rig  =>  base = rotate(world - rig, -yaw)
  apply(rig) {
    this.rig = rig;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -rig.yaw);
    const pos = new THREE.Vector3(-rig.x, 0, -rig.z).applyQuaternion(q);
    const t = new XRRigidTransform({ x: pos.x, y: 0, z: pos.z, w: 1 }, { x: q.x, y: q.y, z: q.z, w: q.w });
    this.renderer.xr.setReferenceSpace(this.base.getOffsetReferenceSpace(t));
  }
}
