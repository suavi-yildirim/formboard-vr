// One pointer model for every input: Quest hands (pinch), Quest controllers (trigger) and the mouse.
// Each pointer has a world-space ray and a pressed flag; the app never cares which device it is.
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

const RAY_LEN = 3;

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
        if (p.line) p.line.visible = p.enabled;
      }
    }
    return this.list.filter((p) => p.enabled);
  }
}
