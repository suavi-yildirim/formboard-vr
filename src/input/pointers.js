// One pointer model for every input: Quest hands (pinch), Quest controllers (trigger) and the mouse.
// Each pointer has a world-space ray and a pressed flag (for the panel and the floor).
// XR pointers also have a "tip": the pinch point between thumb and index fingertip (hands) or a
// point just in front of the controller. Wires and pegs are handled at the tip, by direct touch.
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

const RAY_LEN = 3;
// Thumb and index tip joints sit at the fingertip centres: touching fingertips are still about
// 1.7-2.5 cm apart. The system's own pinch (select) also counts, whichever comes first.
const PINCH_ON = 0.03; // thumb-index distance (m) that starts a pinch
const PINCH_OFF = 0.05; // and that ends it (hysteresis against flicker)
const CONTROLLER_TIP = 0.03; // tip point ahead of the controller's ray origin
const PINCH_GRACE_MS = 350;

class Pointer {
  constructor(id) {
    this.id = id;
    this.raycaster = new THREE.Raycaster();
    this.pressed = false;
    this.justPressed = false;
    this.presses = 0; // counted on press events, so a click between two frames is never lost
    this.seenPresses = 0;
    this.active = false;
    this.line = null;
    this.inputSource = null;
    this.tip = null; // world position of the pinch point / controller tip, or null
    this.pinching = false;
    this.justPinched = false;
  }

  press() {
    this.pressed = true;
    this.presses++;
  }

  pulse(intensity = 0.5, ms = 30) {
    this.inputSource?.gamepad?.hapticActuators?.[0]?.pulse?.(intensity, ms);
  }

  // Shorten the visible ray to what it hits; length in metres.
  setRayLength(len) {
    if (this.line) this.line.scale.z = len ?? RAY_LEN;
  }
}

export class Pointers {
  constructor(renderer, scene, camera, dom) {
    this.renderer = renderer;
    this.camera = camera;
    this.list = [];
    this.setupXR(renderer, scene);
    this.setupMouse(dom);
  }

  setupXR(renderer, scene) {
    const controllerModels = new XRControllerModelFactory();
    const handModels = new XRHandModelFactory();
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);

    for (let i = 0; i < 2; i++) {
      const p = new Pointer(`xr${i}`);
      const controller = renderer.xr.getController(i);
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x7fdcff, transparent: true, opacity: 0.7 }));
      line.scale.z = RAY_LEN;
      controller.add(line);
      p.line = line;
      p.object = controller;
      controller.addEventListener('connected', (e) => { p.inputSource = e.data; p.active = true; });
      controller.addEventListener('disconnected', () => { p.inputSource = null; p.active = false; p.pressed = false; });
      controller.addEventListener('selectstart', () => p.press());
      controller.addEventListener('selectend', () => { p.pressed = false; });
      scene.add(controller);

      const grip = renderer.xr.getControllerGrip(i);
      grip.add(controllerModels.createControllerModel(grip));
      scene.add(grip);

      const hand = renderer.xr.getHand(i);
      hand.add(handModels.createHandModel(hand, 'mesh'));
      scene.add(hand);
      p.hand = hand;

      // Pinch point marker: shows where the app grabs; green while pinching.
      p.tipMarker = new THREE.Mesh(new THREE.SphereGeometry(0.006, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
      p.tipMarker.renderOrder = 10;
      p.tipMarker.visible = false;
      scene.add(p.tipMarker);

      this.list.push(p);
    }
  }

  setupMouse(dom) {
    const p = new Pointer('mouse');
    const ndc = new THREE.Vector2();
    p.ndc = ndc;
    const move = (e) => {
      const r = dom.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      p.active = true;
    };
    dom.addEventListener('pointermove', move);
    dom.addEventListener('pointerdown', (e) => { move(e); if (e.button === 0) p.press(); });
    window.addEventListener('pointerup', (e) => { if (e.button === 0) p.pressed = false; });
    dom.addEventListener('pointerleave', () => { p.pressed = false; });
    this.mouse = p;
    this.list.push(p);
  }

  // Refresh every ray; call once per frame before reading the pointers.
  update() {
    const inXR = this.renderer.xr.isPresenting;
    for (const p of this.list) {
      p.justPressed = p.presses > p.seenPresses;
      p.seenPresses = p.presses;
      if (p === this.mouse) {
        p.enabled = !inXR && p.active;
        if (p.enabled) p.raycaster.setFromCamera(p.ndc, this.camera);
      } else {
        p.enabled = inXR && p.active;
        if (p.enabled) {
          const m = p.object.matrixWorld;
          p.raycaster.ray.origin.setFromMatrixPosition(m);
          p.raycaster.ray.direction.set(0, 0, -1).transformDirection(m);
        }
        this.updateTip(p);
      }
    }
    return this.list.filter((p) => p.enabled);
  }

  updateTip(p) {
    const was = p.pinching;
    p.tip = null;
    if (p.tipMarker) p.tipMarker.visible = false;
    if (p.enabled && p.inputSource?.hand) {
      const index = p.hand.joints['index-finger-tip'], thumb = p.hand.joints['thumb-tip'];
      if (index?.visible !== false && thumb && index) {
        const a = index.getWorldPosition(new THREE.Vector3()), b = thumb.getWorldPosition(new THREE.Vector3());
        const gap = a.distanceTo(b);
        p.tip = a.add(b).multiplyScalar(0.5);
        p.gapPinch = p.gapPinch ? gap < PINCH_OFF : gap < PINCH_ON;
        p.pinching = p.pressed || p.gapPinch;
      } else {
        // joints not tracked this frame: fall back to the hand's ray origin and the system pinch
        p.tip = p.raycaster.ray.origin.clone();
        p.pinching = p.pressed;
      }
    } else if (p.enabled) {
      p.tip = p.raycaster.ray.origin.clone().addScaledVector(p.raycaster.ray.direction, CONTROLLER_TIP);
      p.pinching = p.pressed;
    } else p.pinching = false;
    p.justPinched = p.pinching && !was;
    if (p.justPinched) { p.pinchStartedAt = performance.now(); p.pinchUsed = false; }
  }

  // A pinch may act during a short grace period after it closes (fingers settling onto the
  // target), but only once.
  pinchFresh(p) {
    return p.pinching && !p.pinchUsed && performance.now() - p.pinchStartedAt < PINCH_GRACE_MS;
  }

  setTipVisible(p, v) {
    if (!p.tipMarker) return;
    p.tipMarker.visible = v && !!p.tip;
    if (p.tipMarker.visible) {
      p.tipMarker.position.copy(p.tip);
      p.tipMarker.material.color.setHex(p.pinching ? 0x3ddc84 : 0xffffff);
    }
  }

  // Show the ray only when it is useful (panel or floor); never through the hand at the board.
  setRayVisible(p, v) {
    if (p.line) p.line.visible = v;
  }
}
