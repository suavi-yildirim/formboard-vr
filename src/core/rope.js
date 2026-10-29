// Light rope simulation (Verlet integration with length constraints) for the wire being routed.
// Units are metres in the board's local frame (z = height above the surface). No three.js.
//
// A rope starts at a fixed point. Its end is either held (pinned to `hand`; the rope goes taut and
// the end stops short when the hand is further away than the rope reaches) or free (it hangs).
// The app uses two: the span from the last peg to the hand, held under light tension as a worker
// does, and the rest of the wire hanging beyond the hand.

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const len = (a) => Math.hypot(a.x, a.y, a.z);

export class Rope {
  constructor(points = 16) {
    this.n = points;
    this.p = [];
    this.prev = [];
  }

  // Lay the rope straight from a to b.
  reset(a, b) {
    this.p = [];
    for (let i = 0; i < this.n; i++) this.p.push(add(a, mul(sub(b, a), i / (this.n - 1))));
    this.prev = this.p.map((q) => ({ ...q }));
  }

  // One simulation step. With `hand` the end is held there; with `hand: null` it hangs free.
  // bounds: {w, h} of the board in metres (local x/y from -w/2..w/2); the surface only supports
  // the rope inside them. Returns the end point, whether the rope is taut, and its points.
  step(dt, { start, hand = null, length, gravity, floorZ = 0, bounds = null, iterations = 14, damping = 0.96 }) {
    const free = !hand;
    if (!this.p.length) this.reset(start, free ? add(start, mul(gravity, length / (len(gravity) || 1))) : hand);
    let end = null, taut = false;
    if (!free) {
      const span = sub(hand, start);
      const dist = len(span);
      taut = dist >= length;
      end = taut ? add(start, mul(span, length / dist)) : hand;
      if (taut) {
        // pulled tight: a straight line from the peg to where the wire ends
        this.reset(start, end);
        return { end, taut, points: this.p };
      }
    }
    const seg = length / (this.n - 1);
    const g = mul(gravity, dt * dt);
    const last = free ? this.n : this.n - 1;

    for (let i = 1; i < last; i++) {
      const v = mul(sub(this.p[i], this.prev[i]), damping);
      this.prev[i] = this.p[i];
      this.p[i] = add(add(this.p[i], v), g);
    }
    this.p[0] = { ...start };
    if (!free) this.p[this.n - 1] = { ...end };

    for (let k = 0; k < iterations; k++) {
      for (let i = 0; i < this.n - 1; i++) {
        const a = this.p[i], b = this.p[i + 1];
        const d = sub(b, a);
        const l = len(d) || 1e-9;
        const corr = mul(d, (l - seg) / l);
        const pinA = i === 0, pinB = !free && i + 1 === this.n - 1;
        if (pinA && pinB) continue;
        if (pinA) this.p[i + 1] = sub(b, corr);
        else if (pinB) this.p[i] = add(a, corr);
        else { this.p[i] = add(a, mul(corr, 0.5)); this.p[i + 1] = sub(b, mul(corr, 0.5)); }
      }
      // the board surface holds the rope up (only over the board)
      for (let i = 1; i < last; i++) {
        const q = this.p[i];
        const onBoard = !bounds || (Math.abs(q.x) <= bounds.w / 2 && Math.abs(q.y) <= bounds.h / 2);
        if (onBoard && q.z < floorZ) {
          this.p[i] = { ...q, z: floorZ };
          // friction: a wire lying on the board does not slide freely
          this.prev[i] = { x: q.x - (q.x - this.prev[i].x) * 0.3, y: q.y - (q.y - this.prev[i].y) * 0.3, z: floorZ };
        }
      }
    }
    return { end: free ? this.p[this.n - 1] : end, taut, points: this.p };
  }
}
