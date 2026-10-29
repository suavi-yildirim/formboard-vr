// One routing attempt for one wire. Feed it the pointer position on the board (mm) and whether
// the pointer is pressed; it returns events. No rendering, no timing: easy to test.
//
// Rules: grab the wire end (start connector, or the last peg reached) by pressing near it.
// While held, entering the next node of the path snaps the wire to it. Entering any other
// node that is not yet routed counts one error (once per entry). Releasing keeps progress.
import { distance } from './grid.js';

export const SNAP_MM = 32;
export const GRAB_MM = 45;

export class RoutingAttempt {
  constructor(path, pos) {
    this.path = path;
    this.pos = pos;
    this.reached = 1; // path[0..reached-1] are routed; the start connector counts as reached
    this.holding = false;
    this.errors = 0;
    this.inside = null; // node the pointer is currently over, to count each wrong entry once
    this.done = false;
  }

  get end() { return this.path[this.reached - 1]; }
  get next() { return this.path[this.reached] ?? null; }
  get routed() { return this.path.slice(0, this.reached); }

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

    const over = this.nodeUnder(p);
    if (over === this.inside) return events;
    this.inside = over;
    if (over === null || this.routed.includes(over)) return events;
    if (over === this.next) {
      this.reached++;
      if (this.reached === this.path.length) {
        this.done = true;
        this.holding = false;
        events.push({ type: 'snap', at: over }, { type: 'done' });
      } else {
        events.push({ type: 'snap', at: over });
      }
    } else {
      this.errors++;
      events.push({ type: 'wrong', at: over, expected: this.next });
    }
    return events;
  }

  nodeUnder(p) {
    let best = null, bestD = SNAP_MM;
    for (const [id, q] of Object.entries(this.pos)) {
      const d = distance(p, q);
      if (d <= bestD) { best = id; bestD = d; }
    }
    return best;
  }
}
