'use strict';
// Tiny WebAudio synth — no audio files needed.
const SFX = {
  ctx: null, on: true,
  ensure() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { this.ctx = null; }
  },
  tone(freq, dur, type = 'square', vol = 0.05, slide = 0, delay = 0) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol = 0.1, cutoff = 1200) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx, len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf; f.type = 'lowpass'; f.frequency.value = cutoff; g.gain.value = vol;
    src.connect(f).connect(g).connect(c.destination); src.start();
  },
  shot(heavy) { heavy ? (this.tone(180, 0.25, 'sawtooth', 0.06, -120), this.noise(0.18, 0.08, 1500))
                      : (this.tone(720, 0.1, 'square', 0.035, -450), this.noise(0.06, 0.04, 4000)); },
  boom() { this.noise(0.6, 0.22, 500); this.tone(80, 0.45, 'sine', 0.18, -50); },
  miss() { this.tone(300, 0.08, 'triangle', 0.03, -100); },
  move() { this.tone(150, 0.05, 'triangle', 0.025); },
  stomp() { this.tone(60, 0.12, 'sine', 0.12, -20); this.noise(0.1, 0.05, 300); },
  click() { this.tone(900, 0.03, 'square', 0.02); },
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, 'square', 0.04, 0, i * 0.14)); },
  lose() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.04, 0, i * 0.18)); },
};
