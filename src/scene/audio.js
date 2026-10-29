// Short synthesised feedback sounds (no audio files). The context starts on the first user gesture.
export class Sfx {
  constructor() {
    this.ctx = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    this.ctx?.resume?.();
  }

  tone(freq, dur, type = 'sine', gain = 0.15, delay = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t0);
    o.stop(t0 + dur);
  }

  click() { this.tone(1400, 0.05, 'square', 0.05); }
  snap() { this.tone(880, 0.08, 'triangle'); this.tone(1320, 0.1, 'triangle', 0.1, 0.05); }
  wrong() { this.tone(160, 0.25, 'sawtooth', 0.12); }
  grab() { this.tone(520, 0.06, 'sine', 0.1); }
  done() { [660, 830, 990].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.12, i * 0.09)); }
  finish() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.12, i * 0.12)); }
}
