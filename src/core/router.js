// One routing attempt for one wire. Feed it the pointer position on the board (mm) and whether
// the pointer is pressed; it returns events. No rendering, no timing: easy to test.
//
// Rules: grab the wire end (start connector, or the last peg reached) by pressing near it.
// While held, coming near the next node of the path snaps the wire to it; the next node wins
// over any other node in reach. Errors are only real mistakes: taking a wrong branch (a node
// next to the current end that is not the next one) or skipping ahead along the path. Passing
// unrelated nodes in a dense area is ignored, and so is any node while the pointer stays in the
// corridor between the current end and the next node (short side branches near a hub would
// otherwise fire on a correct move). Releasing keeps progress.
import { distance } from './grid.js';

export const SNAP_MM = 30;
export const GRAB_MM = 45;
const CORRIDOR = 0.6; // half-width of the "on track" corridor, as a fraction of the snap radius

function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export class RoutingAttempt {
  constructor(path, pos, neighbours = {}, snapMm = SNAP_MM) {
    this.path = path;
    this.pos = pos;
    this.neighbours = neighbours;
    this.snap = snapMm;
    this.reached = 1; // path[0..reached-1] are routed; the start connector counts as reached
    this.holding = false;
    this.errors = 0;
    this.inside = null; // wrong node the pointer is over, to count each entry once
    this.done = false;
  }

  get end() { return this.path[this.reached - 1]; }
  get next() { return this.path[this.reached] ?? null; }
  get routed() { return this.path.slice(0, this.reached); }

  // Nodes whose entry counts as an error right now.
  get wrongCandidates() {
    const later = this.path.slice(this.reached + 1);
    const branches = (this.neighbours[this.end] ?? []).filter((n) => n !== this.next && !this.routed.includes(n));
    return new Set([...later, ...branches]);
  }

  update(p, pressed) {
    const events = [];
    if (this.done) return events;
    if (!pressed) {
      if (this.holding) events.push({ type: 'release', at: this.end });
      this.holding = false;
      this.inside = null;
      return events;
    }
    if (!this.holding) {
      if (p && distance(p, this.pos[this.end]) <= GRAB_MM) {
        this.holding = true;
        events.push({ type: 'grab', at: this.end });
      }
      return events;
    }
    if (!p) return events;

    if (distance(p, this.pos[this.next]) <= this.snap) {
      const at = this.next;
      this.reached++;
      this.inside = null;
      events.push({ type: 'snap', at });
      if (this.reached === this.path.length) {
        this.done = true;
        this.holding = false;
        events.push({ type: 'done' });
      }
      return events;
    }

    let over = null;
    if (segmentDistance(p, this.pos[this.end], this.pos[this.next]) > this.snap * CORRIDOR) {
      for (const id of this.wrongCandidates) {
        if (distance(p, this.pos[id]) <= this.snap) { over = id; break; }
      }
    }
    if (over !== this.inside) {
      this.inside = over;
      if (over !== null) {
        this.errors++;
        events.push({ type: 'wrong', at: over, expected: this.next });
      }
    }
    return events;
  }
}

// Adjacency of the board graph, for wrong-branch detection.
export function neighbourMap(segments) {
  const nb = {};
  for (const [a, b] of segments) {
    (nb[a] ??= []).push(b);
    (nb[b] ??= []).push(a);
  }
  return nb;
}
