// Shape of the wire a worker is holding: computed directly every frame, no simulation state,
// so it cannot fold, kink or jitter. Units are metres in the board's local frame
// (z = height above the surface). No three.js.
//
// - From the last peg (start) to the hand the wire is held under light tension: a shallow arc
//   whose sag matches a cable `slack` times longer than the straight distance, sagging the way
//   gravity pulls (sideways to the span).
// - The rest of the wire is beyond the hand: a short tail (at most `tail` metres) laid out from
//   the hand in the direction of gravity.
// - If the hand is further away than the remaining wire reaches, the wire is taut: straight, and
//   its end stops short of the hand.
// - Over the board nothing goes below the surface (floorZ).

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);

export function heldWire({ start, hand, remaining, gravity, slack = 1.02, tail = 0.15, floorZ = 0, bounds = null, points = 16, tailPoints = 6 }) {
  const support = (q) => {
    const onBoard = !bounds || (Math.abs(q.x) <= bounds.w / 2 && Math.abs(q.y) <= bounds.h / 2);
    return onBoard && q.z < floorZ ? { ...q, z: floorZ } : q;
  };
  const span = sub(hand, start);
  const d = len(span);
  const taut = d >= remaining;
  const end = taut ? add(start, mul(span, remaining / (d || 1))) : { x: hand.x, y: hand.y, z: hand.z };
  const g = mul(gravity, 1 / (len(gravity) || 1));

  // sag of a shallow cable of length L over distance d: s = sqrt(3 d (L - d) / 8)
  const spanLen = taut ? remaining : Math.min(remaining, d * slack);
  const sag = taut ? 0 : Math.sqrt(Math.max(0, (3 * d * (spanLen - d)) / 8));
  const dir = d > 1e-6 ? mul(span, 1 / d) : { x: 0, y: 0, z: 0 };
  let down = sub(g, mul(dir, dot(g, dir))); // gravity sideways to the span
  const dl = len(down);
  down = dl > 1e-6 ? mul(down, 1 / dl) : { x: 0, y: 0, z: 0 };

  const pts = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const q = add(add(start, mul(sub(end, start), t)), mul(down, sag * 4 * t * (1 - t)));
    pts.push(i === 0 || i === points - 1 ? q : support(q));
  }

  const tailLen = taut ? 0 : Math.min(tail, remaining - spanLen);
  const tailPts = [];
  if (tailLen > 0.01) {
    for (let i = 1; i < tailPoints; i++) tailPts.push(support(add(end, mul(g, (tailLen * i) / (tailPoints - 1)))));
  }
  return { end, taut, points: pts, tail: tailPts };
}
