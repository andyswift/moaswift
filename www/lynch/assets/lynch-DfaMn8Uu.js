(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=`moa-granular`,t=`
const MAX_GRAINS = 128;
const BINS = 96;
const VOICES = 8;
const DRONE = VOICES; // the cloud's voice index when it runs without notes
const MIDDLE_C = 60;

class GrainCore {
  constructor(sampleRate, seconds, random) {
    this.sr = sampleRate;
    this.rnd = random || Math.random;
    this.len = Math.max(1024, Math.floor(sampleRate * seconds));
    this.buf = new Float32Array(this.len);
    this.w = 0;
    this.filled = 0;
    this.last = 0;
    this.pos = new Float64Array(MAX_GRAINS);
    this.step = new Float64Array(MAX_GRAINS);
    this.total = new Float64Array(MAX_GRAINS);
    this.age = new Float64Array(MAX_GRAINS);
    this.gl = new Float32Array(MAX_GRAINS);
    this.gr = new Float32Array(MAX_GRAINS);
    this.gv = new Uint8Array(MAX_GRAINS);
    this.live = new Uint8Array(MAX_GRAINS);
    this.peaks = new Float32Array(BINS);
    this.binSize = this.len / BINS;
    this.curBin = 0;
    // Voices: stage 0 idle, 1 attack, 2 decay then sustain, 3 release.
    this.vNote = new Int16Array(VOICES).fill(-1);
    this.vStage = new Uint8Array(VOICES);
    this.vEnv = new Float32Array(VOICES);
    this.vVel = new Float32Array(VOICES);
    this.vSeq = new Float64Array(VOICES);
    this.seq = 0;
    this.timers = new Float64Array(VOICES + 1);
    this.norm = 1;
    this.drone = 1;
  }

  get activeGrains() {
    let n = 0;
    for (let k = 0; k < MAX_GRAINS; k++) n += this.live[k];
    return n;
  }

  /** Voices that are sounding (any stage but idle). */
  get activeVoices() {
    let n = 0;
    for (let v = 0; v < VOICES; v++) n += this.vStage[v] > 0 ? 1 : 0;
    return n;
  }

  /** Starts a note (velocity 0..1). The same note again retriggers its voice; with all 8 busy, the quietest releasing voice (else the oldest) is taken. */
  noteOn(note, velocity) {
    let v = -1;
    for (let i = 0; i < VOICES; i++) if (this.vStage[i] > 0 && this.vNote[i] === note) { v = i; break; }
    if (v < 0) for (let i = 0; i < VOICES; i++) if (this.vStage[i] === 0) { v = i; break; }
    if (v < 0) {
      let best = Infinity;
      for (let i = 0; i < VOICES; i++) {
        const score = this.vStage[i] === 3 ? this.vEnv[i] - 10 : this.vSeq[i];
        if (score < best) { best = score; v = i; }
      }
    }
    this.vNote[v] = note;
    this.vStage[v] = 1;
    this.vVel[v] = Math.min(1, Math.max(0, velocity));
    this.vSeq[v] = ++this.seq;
    this.timers[v] = 0;
  }

  noteOff(note) {
    for (let i = 0; i < VOICES; i++) if (this.vStage[i] > 0 && this.vStage[i] < 3 && this.vNote[i] === note) this.vStage[i] = 3;
  }

  allNotesOff() {
    for (let i = 0; i < VOICES; i++) if (this.vStage[i] > 0) this.vStage[i] = 3;
  }

  /**
   * What a display needs: the buffer's peak level in BINS slices from oldest to newest, and the live grains as
   * [x, width] pairs (x: where along that oldest..newest axis a grain is reading, width: the stretch it spans).
   */
  snapshot() {
    const peaks = new Float32Array(BINS);
    for (let i = 0; i < BINS; i++) peaks[i] = this.peaks[(this.curBin + 1 + i) % BINS];
    const grains = [];
    for (let k = 0; k < MAX_GRAINS; k++) {
      if (!this.live[k]) continue;
      const age = (((this.w - this.pos[k]) % this.len) + this.len) % this.len;
      grains.push(Math.max(0, 1 - age / this.len), Math.min(1, (this.total[k] * Math.abs(this.step[k])) / this.len));
    }
    return { peaks, grains };
  }

  spawn(p, voice) {
    let k = 0;
    while (k < MAX_GRAINS && this.live[k]) k++;
    if (k === MAX_GRAINS) return;
    const r = this.rnd;
    const size = Math.max(64, p.size * this.sr);
    const cents = p.detune * (r() * 2 - 1);
    const transpose = voice < VOICES ? this.vNote[voice] - MIDDLE_C : 0;
    const ratio = Math.pow(2, (p.pitch + transpose + cents / 100) / 12);
    const dir = r() < p.reverse ? -1 : 1;
    const span = this.filled;
    const scatter = p.cloud * (r() * 2 - 1) * 0.25 * span;
    // A grain must not run into the write head: leave room for the span it will read.
    const minAge = size * Math.max(1, ratio) + 32;
    let age = p.position * span + scatter;
    age = Math.min(Math.max(age, minAge), Math.max(minAge, span));
    // age is how far back the grain's older end sits; a reverse grain starts at its newer end and reads towards it.
    let start = this.w - age;
    if (dir < 0) start += size * ratio;
    start = ((start % this.len) + this.len) % this.len;
    const pan = p.spread * (r() * 2 - 1);
    const angle = (pan + 1) * Math.PI / 4;
    this.pos[k] = start;
    this.step[k] = dir * ratio;
    this.total[k] = size;
    this.age[k] = 0;
    this.gl[k] = Math.cos(angle);
    this.gr[k] = Math.sin(angle);
    this.gv[k] = voice;
    this.live[k] = 1;
  }

  /** Window value for a grain at phase t in 0..1: Hann blended with a fast-attack, decaying shape. */
  window(t, shape) {
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
    if (shape <= 0) return hann;
    const sharp = Math.min(1, t * 40) * Math.exp(-5 * t) * 1.6;
    return hann + shape * (sharp - hann);
  }

  /** Time until the next grain for one voice: 1/rate, scattered by cloud. */
  interval(p) {
    return (this.sr / Math.max(0.1, p.rate)) * (1 + p.cloud * (this.rnd() * 2 - 1) * 0.8);
  }

  /** Renders n samples. input is mono (or null); p holds plain numbers for every parameter. */
  process(input, outL, outR, n, p) {
    const buf = this.buf, len = this.len, sr = this.sr;
    const frozen = p.freeze > 0.5;
    const playing = p.play > 0.5;
    const baseGain = 1 / Math.sqrt(Math.max(1, p.rate * p.size * 0.6));
    const fb = p.feedback;
    const attackStep = 1 / (Math.max(p.attack, 0.001) * sr);
    const decayCoef = 1 - Math.exp(-3 / (Math.max(p.decay, 0.001) * sr));
    const releaseCoef = 1 - Math.exp(-3 / (Math.max(p.release, 0.001) * sr));
    for (let i = 0; i < n; i++) {
      if (!frozen) {
        const sample = (input ? input[i] : 0) + fb * Math.tanh(this.last);
        buf[this.w] = sample;
        const bin = Math.min(BINS - 1, Math.floor(this.w / this.binSize));
        if (bin !== this.curBin) { this.curBin = bin; this.peaks[bin] = 0; }
        const mag = Math.abs(sample);
        if (mag > this.peaks[bin]) this.peaks[bin] = mag;
        this.w = (this.w + 1) % len;
        if (this.filled < len - 1) this.filled++;
      }

      // Envelopes always run (so a note released as Keys goes off still fades out); only grains are gated by Keys.
      let sounding = 0;
      for (let v = 0; v < VOICES; v++) {
        const stage = this.vStage[v];
        if (stage === 0) continue;
        let env = this.vEnv[v];
        if (stage === 1) {
          env += attackStep;
          if (env >= 1) { env = 1; this.vStage[v] = 2; }
        } else if (stage === 2) {
          env += (p.sustain - env) * decayCoef;
        } else {
          env -= env * releaseCoef;
          if (env < 0.0005) { env = 0; this.vStage[v] = 0; this.vNote[v] = -1; }
        }
        this.vEnv[v] = env;
        if (this.vStage[v] === 0 || !playing) continue;
        sounding++;
        this.timers[v] -= 1;
        if (this.timers[v] <= 0) {
          this.spawn(p, v);
          this.timers[v] += this.interval(p);
        }
      }
      if (!playing) {
        this.timers[DRONE] -= 1;
        if (this.timers[DRONE] <= 0) {
          this.spawn(p, DRONE);
          this.timers[DRONE] += this.interval(p);
        }
      }
      // The free-running cloud fades out when Keys goes on (and back in when it goes off).
      this.drone += ((playing ? 0 : 1) - this.drone) * 0.003;
      // More voices at once means more grains: scale down so a chord is not much louder than one note.
      const target = playing ? 1 / Math.sqrt(Math.max(1, sounding)) : 1;
      this.norm += (target - this.norm) * 0.002;
      const gain = baseGain * this.norm;

      let l = 0, r = 0;
      for (let k = 0; k < MAX_GRAINS; k++) {
        if (!this.live[k]) continue;
        const t = this.age[k] / this.total[k];
        if (t >= 1) { this.live[k] = 0; continue; }
        let pos = this.pos[k];
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        const a = buf[((i0 % len) + len) % len];
        const b = buf[(((i0 + 1) % len) + len) % len];
        const v = this.gv[k];
        const level = v < VOICES ? this.vEnv[v] * this.vVel[v] : this.drone;
        const s = (a + (b - a) * frac) * this.window(t, p.shape) * level;
        l += s * this.gl[k];
        r += s * this.gr[k];
        pos += this.step[k];
        this.pos[k] = ((pos % len) + len) % len;
        this.age[k] += 1;
      }
      outL[i] = l * gain;
      outR[i] = r * gain;
      this.last = (outL[i] + outR[i]) * 0.5;
    }
  }
}

if (typeof registerProcessor === 'function') {
  class MoaGranular extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      const k = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' });
      return [
        k('position', 0.3, 0, 1), k('size', 0.12, 0.002, 4), k('pitch', 0, -48, 48), k('rate', 12, 0.1, 200),
        k('spread', 0.5, 0, 1), k('cloud', 0.2, 0, 1), k('detune', 0, 0, 1200), k('shape', 0.3, 0, 1),
        k('reverse', 0, 0, 1), k('feedback', 0, 0, 1), k('freeze', 0, 0, 1),
        k('play', 0, 0, 1), k('attack', 0.02, 0.001, 10), k('decay', 0.3, 0.001, 10), k('sustain', 0.8, 0, 1), k('release', 0.6, 0.001, 20),
      ];
    }
    constructor(options) {
      super();
      const seconds = (options.processorOptions && options.processorOptions.seconds) || 20;
      this.core = new GrainCore(sampleRate, seconds);
      this.mono = new Float32Array(128);
      this.p = {};
      this.sinceView = 0;
      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m || m.type !== 'note') return;
        if (m.note < 0) this.core.allNotesOff();
        else if (m.velocity > 0) this.core.noteOn(m.note, m.velocity);
        else this.core.noteOff(m.note);
      };
    }
    process(inputs, outputs, params) {
      const out = outputs[0];
      const n = out[0].length;
      const input = inputs[0];
      let mono = null;
      if (input.length > 0) {
        if (this.mono.length < n) this.mono = new Float32Array(n);
        mono = this.mono;
        for (let i = 0; i < n; i++) {
          let s = 0;
          for (let ch = 0; ch < input.length; ch++) s += input[ch][i];
          mono[i] = s / input.length;
        }
      }
      for (const name in params) this.p[name] = params[name][0];
      this.core.process(mono, out[0], out[1] || out[0], n, this.p);
      this.sinceView += n;
      if (this.sinceView >= sampleRate / 30) {
        this.sinceView = 0;
        this.port.postMessage(this.core.snapshot());
      }
      return true;
    }
  }
  registerProcessor('${e}', MoaGranular);
}
`,n=`moa-pipe`,r=`moa-spring`,i=`
const PIPE_NUM_VOICES = 8;
const LINE = 16384;
const MASK = LINE - 1;
const CHUNK = 32;
const DRIVE = 1.3;
const INV_DRIVE = 1 / DRIVE;
const STAGES = 4;
const TWO_PI = Math.PI * 2;
const LN1000 = 6.907755278982137; // ln(10^3): a 60 dB fall

const PIPE_DEFAULTS = {
  atk: 0.005, dec: 0.3, sus: 0.8, rel: 0.3, envKey: 0, vel: 0.5, legato: 0,
  noise: 0.5, nCut: 100, nRes: 0.2, nKey: 0.5, nEnv: 0, onePole: 0, gain: 0.7,
  tune: 0, fine: 0, harm: 0, split: 0, splitPt: 0.5, pol: 0,
  fbDec: 2, fbRel: 0.4, push: 0, satHard: 0.3, satSym: 0,
  hp: -12, lp: 36, hpComp: 1, lpComp: 1,
  mode: 0, detune: 12, glide: 0.1, glideOn: 0, spread: 0.5, volume: 0.8,
  lfoRate: 5, lfoShape: 0, lfoDelay: 0, lfoAmt: 0, lfoDest: 0,
  bend: 0, mod: 0,
};

function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// Phase delay, in samples, of the loop's filters at angular frequency w (so the loop length can compensate).
function atan2f(y, x) { return Math.atan2(y, x); }
function delayLowpass(a, w) { // y += a (x - y)
  const b = 1 - a;
  return atan2f(b * Math.sin(w), 1 - b * Math.cos(w)) / w;
}
function delayHighpass(a, w) { // x - lowpass(x)
  const b = 1 - a;
  return -((Math.PI - w) / 2 - atan2f(b * Math.sin(w), 1 - b * Math.cos(w))) / w;
}
function delayAllpass(c, w) { // (c + z^-1) / (1 + c z^-1)
  let ph = atan2f(-Math.sin(w), c + Math.cos(w)) - atan2f(-c * Math.sin(w), 1 + c * Math.cos(w));
  while (ph > 0) ph -= TWO_PI;
  while (ph < -TWO_PI) ph += TWO_PI;
  return -ph / w;
}

class PipeVoice {
  constructor() {
    this.buf = new Float32Array(LINE);
    this.apX = new Float64Array(STAGES * 2);
    this.apY = new Float64Array(STAGES * 2);
    this.reset();
  }
  reset() {
    this.buf.fill(0);
    this.apX.fill(0);
    this.apY.fill(0);
    this.w = 0;
    this.interp = 0;
    this.lpS = 0; this.hpS = 0;
    this.s1 = 0; this.s2 = 0; this.pS = 0;
    this.dcX = 0; this.dcY = 0;
    this.active = false; this.gate = false; this.key = false; this.sustained = false;
    this.note = 60; this.target = 60; this.pitch = 60; this.cents = 0;
    this.vel = 1; this.stage = 0; this.env = 0; this.seq = 0;
    this.D = 100; this.g = 0.9; this.fresh = true; this.peak = 0;
  }
}

class PipeCore {
  constructor(sampleRate, random) {
    this.sr = sampleRate;
    this.rnd = random || Math.random;
    this.voices = [];
    for (let i = 0; i < PIPE_NUM_VOICES; i++) this.voices.push(new PipeVoice());
    this.seq = 0;
    this.stack = [];
    this.pedal = false;
    this.mode = 0;
    this.lfoPhase = 0; this.lfoHeld = 0; this.lfoSh = 0; this.lfoFade = 0;
    this.nz = 1;
  }

  get activeVoices() {
    let n = 0;
    for (const v of this.voices) if (v.active) n++;
    return n;
  }

  voiceFor(note) {
    for (const v of this.voices) if (v.active && v.key && v.note === note) return v;
    return null;
  }

  // ---- notes ----

  start(v, note, velocity, retrigger, glide, cents) {
    if (!v.active) v.reset(); // an idle voice starts from a clean slate
    this.seq += 1;
    v.seq = this.seq;
    v.cents = cents;
    v.vel = velocity;
    v.note = note;
    v.target = note;
    if (!glide) v.pitch = note;
    if (retrigger) v.stage = 1;
    v.active = true;
    v.gate = true; v.key = true; v.sustained = false;
  }

  release(v) {
    v.key = false;
    if (this.pedal) { v.sustained = true; return; }
    v.gate = false;
    if (v.stage > 0) v.stage = 3;
  }

  unisonCents(i, count, detune) {
    return count > 1 ? detune * ((i / (count - 1)) * 2 - 1) : 0;
  }

  noteOn(note, velocity, p) {
    const mode = p ? Math.round(p.mode) : this.mode;
    this.mode = mode;
    const detune = p ? p.detune : 12;
    const glideOn = p ? p.glideOn > 0.5 : false;
    const legato = p ? p.legato > 0.5 : false;
    if (mode === 0) {
      let pick = null;
      for (const v of this.voices) if (!v.active) { pick = v; break; }
      if (!pick) {
        // steal: the released voice that has rung longest, else the oldest sounding one
        let best = Infinity;
        for (const v of this.voices) if (!v.gate && v.seq < best) { best = v.seq; pick = v; }
        if (!pick) for (const v of this.voices) if (v.seq < best) { best = v.seq; pick = v; }
        pick.reset();
      }
      pick.reset();
      this.start(pick, note, velocity, true, false, 0);
      return;
    }
    // mono and unison: a note stack, last note wins, overlapping notes glide (and keep the envelope if legato)
    const stackWasEmpty = this.stack.length === 0;
    this.stack = this.stack.filter((s) => s.note !== note);
    this.stack.push({ note, velocity });
    const used = mode === 1 ? 1 : PIPE_NUM_VOICES;
    for (let i = 0; i < used; i++) {
      const v = this.voices[i];
      const sounding = v.active && v.gate;
      const retrigger = stackWasEmpty || !legato || !sounding;
      this.start(v, note, velocity, retrigger, glideOn && sounding, this.unisonCents(i, used, detune));
    }
  }

  noteOff(note) {
    if (this.mode === 0) {
      for (const v of this.voices) if (v.active && v.key && v.note === note) this.release(v);
      return;
    }
    this.stack = this.stack.filter((s) => s.note !== note);
    const used = this.mode === 1 ? 1 : PIPE_NUM_VOICES;
    if (this.stack.length > 0) {
      const top = this.stack[this.stack.length - 1];
      for (let i = 0; i < used; i++) {
        const v = this.voices[i];
        v.target = top.note; v.note = top.note;
      }
      return;
    }
    for (let i = 0; i < used; i++) if (this.voices[i].active) this.release(this.voices[i]);
  }

  allNotesOff() {
    this.stack = [];
    this.pedal = false;
    for (const v of this.voices) if (v.active && v.gate) { v.key = false; v.sustained = false; v.gate = false; v.stage = 3; }
  }

  sustainPedal(down) {
    this.pedal = down;
    if (!down) {
      for (const v of this.voices) if (v.sustained) { v.sustained = false; v.gate = false; if (v.stage > 0) v.stage = 3; }
    }
  }

  // ---- sound ----

  lfoValue(p, n) {
    const rate = p.lfoRate;
    this.lfoPhase += (rate * n) / this.sr;
    let crossed = false;
    if (this.lfoPhase >= 1) { this.lfoPhase -= Math.floor(this.lfoPhase); crossed = true; }
    const ph = this.lfoPhase;
    switch (Math.round(p.lfoShape)) {
      case 1: return ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4;
      case 2: return ph < 0.5 ? 1 : -1;
      case 3: return ph * 2 - 1;
      case 4:
        if (crossed || this.lfoSh === 0) this.lfoSh = this.rnd() * 2 - 1;
        return this.lfoSh;
      default: return Math.sin(ph * TWO_PI);
    }
  }

  process(outL, outR, n, p) {
    outL.fill(0, 0, n);
    outR.fill(0, 0, n);
    const sr = this.sr;
    const anyHeld = this.voices.some((v) => v.active && v.key);
    if (anyHeld && this.lfoHeld === 0) this.lfoFade = 0;
    this.lfoHeld = anyHeld ? 1 : 0;

    const modeRound = Math.round(p.mode);
    const modeLevel = modeRound === 1 ? 0.8 : modeRound === 2 ? 0.28 : 0.5;
    const spread = p.spread;
    for (let s = 0; s < n; s += CHUNK) {
      const m = Math.min(CHUNK, n - s);
      // shared LFO, faded in after the delay
      const lfoRaw = this.lfoValue(p, m);
      if (anyHeld) this.lfoFade = p.lfoDelay <= 0 ? 1 : Math.min(1, this.lfoFade + m / (p.lfoDelay * sr));
      const amt = Math.min(1, p.lfoAmt + p.mod) * this.lfoFade;
      const l = lfoRaw * amt;
      const dest = Math.round(p.lfoDest);
      const mods = {
        pitch: dest === 0 ? l * 1.5 : 0,
        hp: dest === 1 ? l * 12 : 0,
        lp: dest === 1 ? l * 24 : 0,
        steam: dest === 2 ? l * 0.8 : 0,
        sat: dest === 3 ? l * 0.5 : 0,
        push: dest === 4 ? l * 0.5 : 0,
      };
      for (let vi = 0; vi < PIPE_NUM_VOICES; vi++) {
        const v = this.voices[vi];
        if (!v.active) continue;
        const pan = PIPE_NUM_VOICES > 1 ? (vi / (PIPE_NUM_VOICES - 1)) * 2 - 1 : 0;
        const ang = (pan * spread * 0.5 + 0.5) * (Math.PI / 2);
        this.voiceChunk(v, m, p, mods, Math.cos(ang) * modeLevel * p.volume, Math.sin(ang) * modeLevel * p.volume, outL, outR, s);
      }
    }
  }

  voiceChunk(v, m, p, mods, gL, gR, outL, outR, off) {
    const sr = this.sr;
    // pitch, with glide
    if (p.glideOn > 0.5 && p.glide > 0.001) v.pitch += (v.target - v.pitch) * (1 - Math.exp(-m / (p.glide * sr / 4.6)));
    else v.pitch = v.target;
    const semis = v.pitch + v.cents / 100 + p.tune + p.fine / 100 + p.bend + mods.pitch;
    let f0 = midiHz(semis);
    if (f0 < 12) f0 = 12;
    if (f0 > sr * 0.3) f0 = sr * 0.3;
    const w0 = (TWO_PI * f0) / sr;

    // loop filters, positioned relative to the fundamental
    let hpHz = f0 * Math.pow(2, (p.hp + mods.hp) / 12);
    let lpHz = f0 * Math.pow(2, (p.lp + mods.lp) / 12);
    hpHz = Math.min(Math.max(hpHz, 4), sr * 0.45);
    lpHz = Math.min(Math.max(lpHz, 30), sr * 0.45);
    const aH = 1 - Math.exp((-TWO_PI * hpHz) / sr);
    const aL = 1 - Math.exp((-TWO_PI * lpHz) / sr);

    // dispersion: stiffness (harm), or two unequal sections in split mode. Each allpass has its corner a set
    // number of fundamentals up the spectrum, so the stretching of the partials is the same on every key.
    const half = STAGES / 2;
    const period = (p.pol > 0.5 ? 0.5 : 1) * (sr / f0);
    const corner = (k) => Math.min(0, (Math.tan(Math.min(1.5, (Math.PI * k * f0) / sr)) - 1) / (Math.tan(Math.min(1.5, (Math.PI * k * f0) / sr)) + 1));
    let c1 = 0, c2 = 0;
    if (p.split > 0.5) {
      const kBase = 5 - 3 * p.harm;
      c1 = corner(kBase * 2 * p.splitPt);
      c2 = corner(kBase * 2 * (1 - p.splitPt));
    } else if (p.harm > 0.001) {
      c1 = c2 = corner(14 - 11.5 * p.harm);
    }
    let dispDelay = half * delayAllpass(c1, w0) + half * delayAllpass(c2, w0);
    for (let it = 0; it < 6 && dispDelay > 0.7 * period; it++) { // never let the dispersion eat the loop
      c1 *= 0.7; c2 *= 0.7;
      dispDelay = half * delayAllpass(c1, w0) + half * delayAllpass(c2, w0);
    }

    // the loop's total delay, less what the filters and dispersion add at f0
    const comp = delayLowpass(aL, w0) * p.lpComp + delayHighpass(aH, w0) * p.hpComp + dispDelay;
    // an inverted loop rings an octave low (a closed pipe), so it is half as long to keep the pitch: odd harmonics
    let Dt = period - comp;
    if (Dt < 2.6) Dt = 2.6;
    if (Dt > LINE - 8) Dt = LINE - 8;
    if (v.fresh) { v.D = Dt; v.fresh = false; }

    // feedback gain: a decay time while held, a release time after
    // Decay is the ring time of the fundamental, so divide out what the loop's own filters take away at f0.
    // The cap keeps the loop gain under one at every frequency, so the pipe can only sing through Push.
    const T = Math.max(0.01, v.gate ? p.fbDec : p.fbRel);
    const loopAt = (TWO_PI * f0) / sr;
    const cosw = Math.cos(loopAt);
    const bH = 1 - aH;
    const bL = 1 - aL;
    const magHp = (bH * Math.sqrt(2 - 2 * cosw)) / Math.sqrt(1 + bH * bH - 2 * bH * cosw);
    const magLp = aL / Math.sqrt(1 + bL * bL - 2 * bL * cosw);
    // The loop's gain is highest somewhere near the passband's middle; keep g times that peak just under one,
    // so the pipe cannot grow at any frequency. (Capping g at one instead made high notes die far too fast.)
    let peakMag = magHp * magLp;
    const lowHz = Math.max(8, hpHz * 0.5);
    const highHz = Math.min(sr * 0.49, lpHz * 2);
    for (let k = 0; k < 12; k++) {
      const wk = (TWO_PI * lowHz * Math.pow(highHz / lowHz, k / 11)) / sr;
      const ck = Math.cos(wk);
      const hpk = (bH * Math.sqrt(2 - 2 * ck)) / Math.sqrt(1 + bH * bH - 2 * bH * ck);
      const lpk = aL / Math.sqrt(1 + bL * bL - 2 * bL * ck);
      if (hpk * lpk > peakMag) peakMag = hpk * lpk;
    }
    const gT = Math.min(0.99995 / Math.max(0.05, peakMag), Math.exp((-LN1000 * Dt) / (sr * T)) / Math.max(0.05, magHp * magLp));
    v.g += (gT - v.g) * 0.15;

    // steam: envelope times scale with the note, level with velocity
    const scale = Math.pow(2, (-p.envKey * (v.note - 60)) / 12);
    const atkRate = 1 / Math.max(2, p.atk * scale * sr);
    const decC = 1 - Math.exp(-4.6 / Math.max(2, p.dec * scale * sr));
    const relC = 1 - Math.exp(-4.6 / Math.max(2, p.rel * scale * sr));
    const velScale = 1 - p.vel + p.vel * v.vel;
    const steamGain = p.gain * velScale * Math.max(0, 1 + mods.steam);

    // steam low-pass: cutoff in MIDI pitch, follows the key and the envelope
    const cutNote = p.nCut + p.nKey * (v.note - 60) + p.nEnv * v.env;
    let cutHz = midiHz(Math.min(Math.max(cutNote, 0), 150));
    cutHz = Math.min(cutHz, sr * 0.45);
    const onePole = p.onePole > 0.5;
    const wc = (TWO_PI * cutHz) / sr;
    let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0, aOne = 0;
    if (onePole) {
      aOne = 1 - Math.exp(-wc);
    } else {
      const q = 0.5 + p.nRes * 7;
      const alpha = Math.sin(wc) / (2 * q);
      const cs = Math.cos(wc);
      const a0 = 1 + alpha;
      b0 = (1 - cs) / 2 / a0; b1 = (1 - cs) / a0; b2 = b0;
      a1 = (-2 * cs) / a0; a2 = (1 - alpha) / a0;
    }

    // saturator and push
    const hard = Math.min(1, Math.max(0, p.satHard + mods.sat));
    const bias = p.satSym * 0.5;
    const yb = Math.tanh(bias) + (Math.max(-1, Math.min(1, bias)) - Math.tanh(bias)) * hard;
    const push = Math.max(0, p.push + mods.push);
    const pol = p.pol > 0.5 ? -1 : 1;
    const pAc = 1 - Math.exp((-TWO_PI * Math.max(3, f0 * 0.1)) / sr);
    const noiseMix = p.noise;
    const sus = p.sus;

    const buf = v.buf;
    let w = v.w;
    const aps = v.apX;
    const apy = v.apY;
    for (let i = 0; i < m; i++) {
      // envelope
      switch (v.stage) {
        case 1: v.env += atkRate; if (v.env >= 1) { v.env = 1; v.stage = 2; } break;
        case 2: v.env += (sus - v.env) * decC; break;
        case 3: v.env -= v.env * relC; if (v.env < 0.00002) { v.env = 0; v.stage = 0; } break;
        default: break;
      }
      // steam source and filter
      const src = (1 - noiseMix) + noiseMix * (this.rnd() * 2 - 1);
      let sl;
      if (onePole) {
        v.s1 += aOne * (src - v.s1);
        sl = v.s1;
      } else {
        sl = b0 * src + v.s1;
        v.s1 = b1 * src - a1 * sl + v.s2;
        v.s2 = b2 * src - a2 * sl;
      }
      const e = sl * v.env * steamGain;

      // read the pipe, with allpass interpolation of the fractional delay
      v.D += (Dt - v.D) * 0.004;
      const ii = Math.floor(v.D - 0.5);
      const frac = v.D - ii;
      const eta = (1 - frac) / (1 + frac);
      const idx = (w - ii) & MASK;
      const x0 = buf[idx];
      const x1 = buf[(idx - 1) & MASK];
      const p0 = eta * (x0 - v.interp) + x1;
      v.interp = p0;

      // the loop: polarity, high-pass, low-pass, dispersion
      let fb = p0 * pol;
      v.hpS += aH * (fb - v.hpS);
      fb -= v.hpS;
      v.lpS += aL * (fb - v.lpS);
      fb = v.lpS;
      for (let k = 0; k < STAGES; k++) {
        const c = k < half ? c1 : c2;
        const y = c * fb + aps[k] - c * apy[k];
        aps[k] = fb;
        apy[k] = y;
        fb = y;
      }

      // push-pull: the steam is pushed or pulled by the pipe's contents (without the DC the steam itself adds)
      v.pS += pAc * (p0 - v.pS);
      const x = e * (1 + push * pol * (p0 - v.pS)) + v.g * fb;
      // saturator: soft (tanh) to hard (clip), optionally biased for even harmonics. Normalised so small
      // signals pass at unity gain, which keeps the loop's gain below one (so it decays unless pushed).
      const sdr = x * DRIVE + bias;
      const ys = Math.tanh(sdr);
      const yh = sdr > 1 ? 1 : sdr < -1 ? -1 : sdr;
      let y = (ys + (yh - ys) * hard - yb) * INV_DRIVE;
      y += 1e-20 * (1 - 2 * (i & 1));
      buf[w] = y;
      w = (w + 1) & MASK;

      // output: block DC from the steam
      const o = y - v.dcX + 0.9993 * v.dcY;
      v.dcX = y; v.dcY = o;
      outL[off + i] += o * gL;
      outR[off + i] += o * gR;
      const a = Math.abs(y);
      v.peak = a > v.peak ? a : v.peak * 0.9995;
    }
    v.w = w;
    if (v.stage === 0 && !v.gate && v.peak < 0.00001) v.active = false;
  }
}

// ---------------------------------------------------------------- spring reverb

const SPRING_DEFAULTS = { tension: 0.5, drip: 0.6, decay: 2, tilt: 0, dwell: 0.4 };
const SPRING_LINE = 65536;
const SPRING_MASK = SPRING_LINE - 1;
const SPRING_STAGES = 96;

class Spring {
  constructor(sr, scale, dripScale) {
    this.sr = sr;
    this.scale = scale;
    this.dripScale = dripScale;
    this.buf = new Float32Array(SPRING_LINE);
    this.w = 0;
    this.px = new Float64Array(SPRING_STAGES);
    this.py = new Float64Array(SPRING_STAGES);
    this.lp = 0; this.tl = 0; this.drive = 0;
    this.g = 0.8;
    this.D = 0;
  }

  // x is the (dwell-driven) input sample; returns the wet sample
  tick(x, c, g, gl, gh, aTilt, aDamp, D) {
    this.D += (D - this.D) * 0.002;
    const d = this.D;
    const ii = Math.floor(d);
    const fr = d - ii;
    const idx = (this.w - ii) & SPRING_MASK;
    const a = this.buf[idx];
    const b = this.buf[(idx - 1) & SPRING_MASK];
    let y = a + (b - a) * fr;
    // dispersion: the drip
    for (let k = 0; k < SPRING_STAGES; k++) {
      const o = c * y + this.px[k] - c * this.py[k];
      this.px[k] = y;
      this.py[k] = o;
      y = o;
    }
    const wet = y;
    // tilt and damping inside the loop
    this.tl += aTilt * (y - this.tl);
    y = this.tl * gl + (y - this.tl) * gh;
    this.lp += aDamp * (y - this.lp);
    y = this.lp;
    this.buf[this.w] = x + g * y + 1e-20 * (1 - 2 * (this.w & 1));
    this.w = (this.w + 1) & SPRING_MASK;
    return wet;
  }
}

class SpringCore {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.a = new Spring(sampleRate, 1, 1);
    this.b = new Spring(sampleRate, 1.09, 0.92);
    this.dcA = 0; this.dcB = 0;
  }

  process(input, outL, outR, n, p) {
    const sr = this.sr;
    const tension = Math.min(1, Math.max(0, p.tension));
    const drip = Math.min(1, Math.max(0, p.drip));
    const decay = Math.max(0.1, p.decay);
    const tilt = Math.min(1, Math.max(-1, p.tilt));
    const k = 0.6 + 5 * Math.min(1, Math.max(0, p.dwell));
    const norm = 1 / Math.sqrt(k);
    // a tight spring is short and quick; a slack one is long and slow
    const base = (0.012 + 0.058 * (1 - tension)) * sr;
    const gl = 1 - 0.07 * Math.max(0, tilt);
    const gh = 1 - 0.07 * Math.max(0, -tilt);
    const aTilt = 1 - Math.exp((-TWO_PI * 1500) / sr);
    const aDamp = 1 - Math.exp((-TWO_PI * 5500) / sr);
    const cA = -(0.35 + 0.55 * drip);
    const cB = -(0.35 + 0.55 * drip * 0.92);
    // time one trip round the loop takes, including the dispersion's low-frequency delay
    const tripA = base * this.a.scale + SPRING_STAGES * ((1 - cA) / (1 + cA)) * 0.5;
    const tripB = base * this.b.scale + SPRING_STAGES * ((1 - cB) / (1 + cB)) * 0.5;
    const gA = Math.exp((-LN1000 * tripA) / (sr * decay));
    const gB = Math.exp((-LN1000 * tripB) / (sr * decay));
    // normalise by the loop's energy gain, so a long Length does not also mean a louder reverb
    const nA = Math.sqrt(1 - gA * gA);
    const nB = Math.sqrt(1 - gB * gB);
    const DA = Math.max(8, base * this.a.scale);
    const DB = Math.max(8, base * this.b.scale);
    if (this.a.D === 0) { this.a.D = DA; this.b.D = DB; }
    for (let i = 0; i < n; i++) {
      const x = input ? input[i] : 0;
      const driven = Math.tanh(k * x) * norm;
      const wa = this.a.tick(driven, cA, gA, gl, gh, aTilt, aDamp, DA);
      const wb = this.b.tick(driven, cB, gB, gl, gh, aTilt, aDamp, DB);
      // remove any DC the loops build up
      this.dcA += 0.0005 * (wa - this.dcA);
      this.dcB += 0.0005 * (wb - this.dcB);
      outL[i] = (wa - this.dcA) * nA;
      outR[i] = (wb - this.dcB) * nB;
    }
  }
}

if (typeof registerProcessor === 'function') {
  const kp = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' });

  class MoaPipe extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [
        kp('atk', 0.005, 0.0005, 10), kp('dec', 0.3, 0.001, 10), kp('sus', 0.8, 0, 1), kp('rel', 0.3, 0.001, 20),
        kp('envKey', 0, 0, 1), kp('vel', 0.5, 0, 1), kp('legato', 0, 0, 1),
        kp('noise', 0.5, 0, 1), kp('nCut', 100, 0, 150), kp('nRes', 0.2, 0, 1), kp('nKey', 0.5, 0, 1),
        kp('nEnv', 0, -60, 60), kp('onePole', 0, 0, 1), kp('gain', 0.7, 0, 2),
        kp('tune', 0, -36, 36), kp('fine', 0, -100, 100), kp('harm', 0, 0, 1), kp('split', 0, 0, 1),
        kp('splitPt', 0.5, 0.05, 0.95), kp('pol', 0, 0, 1),
        kp('fbDec', 2, 0.02, 30), kp('fbRel', 0.4, 0.01, 20), kp('push', 0, 0, 1.5), kp('satHard', 0.3, 0, 1),
        kp('satSym', 0, 0, 1), kp('hp', -12, -60, 36), kp('lp', 36, -12, 96), kp('hpComp', 1, 0, 1), kp('lpComp', 1, 0, 1),
        kp('mode', 0, 0, 2), kp('detune', 12, 0, 100), kp('glide', 0.1, 0.001, 5), kp('glideOn', 0, 0, 1),
        kp('spread', 0.5, 0, 1), kp('volume', 0.8, 0, 1.5),
        kp('lfoRate', 5, 0.01, 40), kp('lfoShape', 0, 0, 4), kp('lfoDelay', 0, 0, 10), kp('lfoAmt', 0, 0, 1),
        kp('lfoDest', 0, 0, 4), kp('bend', 0, -12, 12), kp('mod', 0, 0, 1),
      ];
    }
    constructor() {
      super();
      this.core = new PipeCore(sampleRate);
      this.p = {};
      this.sinceView = 0;
      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m || m.type !== 'note') return;
        if (m.note === -1) this.core.allNotesOff();
        else if (m.note === -2) this.core.sustainPedal(m.velocity > 0);
        else if (m.velocity > 0) this.core.noteOn(m.note, m.velocity, this.p.mode === undefined ? null : this.p);
        else this.core.noteOff(m.note);
      };
    }
    process(inputs, outputs, params) {
      const out = outputs[0];
      for (const name in params) this.p[name] = params[name][0];
      this.core.process(out[0], out[1] || out[0], out[0].length, this.p);
      this.sinceView += out[0].length;
      if (this.sinceView >= sampleRate / 30) {
        this.sinceView = 0;
        this.port.postMessage({ active: this.core.voices.map((v) => v.active) });
      }
      return true;
    }
  }
  registerProcessor('${n}', MoaPipe);

  class MoaSpring extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [kp('tension', 0.5, 0, 1), kp('drip', 0.6, 0, 1), kp('decay', 2, 0.1, 12), kp('tilt', 0, -1, 1), kp('dwell', 0.4, 0, 1)];
    }
    constructor() {
      super();
      this.core = new SpringCore(sampleRate);
      this.p = {};
      this.mono = new Float32Array(128);
    }
    process(inputs, outputs, params) {
      const out = outputs[0];
      const n = out[0].length;
      const input = inputs[0];
      let mono = null;
      if (input && input.length > 0) {
        if (this.mono.length < n) this.mono = new Float32Array(n);
        mono = this.mono;
        for (let i = 0; i < n; i++) {
          let s = 0;
          for (let ch = 0; ch < input.length; ch++) s += input[ch][i];
          mono[i] = s / input.length;
        }
      }
      for (const name in params) this.p[name] = params[name][0];
      this.core.process(mono, out[0], out[1] || out[0], n, this.p);
      return true;
    }
  }
  registerProcessor('${r}', MoaSpring);
}
`,a=.01,o=class{patch;ctx;compressors=new Map;grainViews=new Map;pipeViews=new Map;meters=new Map;constructor(e){this.patch=e}async start(){if(!this.ctx){let e=new AudioContext;await e.audioWorklet.addModule(fe()),this.build(e)}await this.ctx?.resume()}async stop(){await this.ctx?.suspend()}get currentTime(){return this.ctx?.currentTime??0}readLevel(e,t){let n=this.meters.get(`${e}/${t}`);if(!n)return 0;n.analyser.getFloatTimeDomainData(n.buffer);let r=0;for(let e of n.buffer)r=Math.max(r,Math.abs(e));return r}readGranular(e,t){return this.grainViews.get(`${e}/${t}`)}readPipe(e,t){return this.pipeViews.get(`${e}/${t}`)}readReduction(e,t){return this.compressors.get(`${e}/${t}`)?.reduction??0}build(e){this.ctx=e;let t=new Map;for(let[n,r]of this.patch.devices)t.set(n,this.compileCircuit(e,n,r.circuit));let n=(e,n,r)=>{let i=this.patch.device(e).jack(n,r).nodeId,a=t.get(e)?.get(i);if(!a)throw Error(`No audio node for ${e}.${r}`);return a};for(let e of this.patch.connections)n(e.from.device,`out`,e.from.jack).connect(n(e.to.device,`in`,e.to.jack));if(this.patch.output){let{device:t,jack:r}=this.patch.output;n(t,`out`,r).connect(e.destination)}}compileCircuit(t,i,o){let c=new Map;for(let a of o.nodes.values())switch(a.kind){case`oscillator`:{let e=t.createOscillator();e.type=a.options.waveform,e.frequency.value=a.params.frequency??440,e.detune.value=a.params.detune??0,e.start(),c.set(a.id,e);break}case`filter`:{let e=t.createBiquadFilter();e.type=a.options.type,e.frequency.value=a.params.frequency??350,e.Q.value=a.params.Q??1,e.gain.value=a.params.gain??0,e.detune.value=a.params.detune??0,c.set(a.id,e);break}case`envelope`:{let e=t.createConstantSource();e.offset.value=0,e.start(),c.set(a.id,e);break}case`convolver`:{let e=t.createConvolver();e.buffer=re(t,ne[a.options.size??`medium`]??ne.medium),c.set(a.id,e);break}case`follower`:{let e=new AudioWorkletNode(t,ue,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],parameterData:{attack:a.params.attack??.003,release:a.params.release??.12}});c.set(a.id,e);break}case`granular`:{let{maxTime:n,...r}=a.params,o=new AudioWorkletNode(t,e,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],parameterData:r,processorOptions:{seconds:n??20}});o.port.onmessage=e=>this.grainViews.set(`${i}/${a.id}`,e.data),c.set(a.id,o);break}case`pipe`:{let e=new AudioWorkletNode(t,n,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params});e.port.onmessage=e=>this.pipeViews.set(`${i}/${a.id}`,e.data),c.set(a.id,e);break}case`spring`:c.set(a.id,new AudioWorkletNode(t,r,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params}));break;case`compressor`:{let e=t.createDynamicsCompressor();this.compressors.set(`${i}/${a.id}`,e),e.threshold.value=a.params.threshold??-24,e.knee.value=a.params.knee??30,e.ratio.value=a.params.ratio??12,e.attack.value=a.params.attack??.003,e.release.value=a.params.release??.25,c.set(a.id,e);break}case`delay`:{let e=t.createDelay(a.params.maxTime??1);e.delayTime.value=a.params.delayTime??.25,c.set(a.id,e);break}case`trigger`:{let e=t.createConstantSource();e.offset.value=0,e.start(),c.set(a.id,e);break}case`constant`:{let e=t.createConstantSource();e.offset.value=a.params.offset??0,e.start(),c.set(a.id,e);break}case`waveshaper`:{let e=t.createWaveShaper();a.options.curve===`pulse`?e.curve=g():a.options.curve===`soft`?e.curve=v():a.options.curve===`limit`?e.curve=y():a.options.curve===`warm`?e.curve=b():a.options.curve===`abs`?e.curve=ee():a.options.curve===`crush`&&(e.curve=te(a.params.bits??16)),e.oversample=`4x`,c.set(a.id,e);break}case`noise`:{let e=t.createBufferSource();e.buffer=ie(t),e.loop=!0,e.start(),c.set(a.id,e);break}case`random`:{let e=t.createBufferSource();e.buffer=ce(t),e.loop=!0,e.playbackRate.value=(a.params.rate??4)/oe,e.start(),c.set(a.id,e);break}case`meter`:{let e=t.createAnalyser();e.fftSize=1024;let n=a.options.channel??`mono`;if(n===`mono`)c.set(a.id,e);else{let r=t.createChannelSplitter(2);r.connect(e,n===`left`?0:1),c.set(a.id,r)}this.meters.set(`${i}/${a.id}`,{analyser:e,buffer:new Float32Array(new ArrayBuffer(e.fftSize*4))});break}case`pan`:{let e=t.createStereoPanner();e.pan.value=a.params.pan??0,c.set(a.id,e);break}case`gain`:{let e=t.createGain();e.gain.value=a.params.gain??1,a.options.channels===`mono`&&(e.channelCount=1,e.channelCountMode=`explicit`),c.set(a.id,e);break}}for(let e of o.cables){let t=c.get(e.from),n=c.get(e.to);if(t&&n){if(e.port===`in`)t.connect(n);else{let r=s(n,e.port);r&&t.connect(r)}}}return o.onChange(e=>{let n=c.get(e.nodeId);n&&(e.type===`note`?n instanceof AudioWorkletNode&&n.port.postMessage(e):e.type===`trigger`||e.type===`choke`?n instanceof ConstantSourceNode&&(e.type===`trigger`?m(t,n.offset,o.node(e.nodeId).params,o.node(e.nodeId).options.shape,e.velocity,e.when):h(t,n.offset,e.when)):o.node(e.nodeId).kind!==`trigger`&&(n instanceof WaveShaperNode&&e.type===`param`&&e.name===`bits`?n.curve=te(e.value):o.node(e.nodeId).kind===`envelope`?n instanceof ConstantSourceNode&&e.type===`param`&&e.name===`gate`&&l(t,n.offset,o.node(e.nodeId).params,e.value>0):n instanceof AudioBufferSourceNode&&e.type===`param`&&e.name===`rate`?n.playbackRate.setTargetAtTime(e.value/oe,t.currentTime,a):e.type===`option`?n instanceof OscillatorNode&&e.name===`waveform`||n instanceof BiquadFilterNode&&e.name===`type`?n.type=e.value:n instanceof ConvolverNode&&e.name===`size`&&(n.buffer=re(t,ne[e.value]??ne.medium)):s(n,e.name)?.setTargetAtTime(e.value,t.currentTime,le(o,e.nodeId,e.name))))}),c}};function s(e,t){if(e instanceof AudioWorkletNode)return e.parameters.get(t);let n=e[t];return n instanceof AudioParam?n:void 0}var c=.001;function l(e,t,n,r){let i=e.currentTime;if(t.cancelScheduledValues(i),t.setValueAtTime(t.value,i),r){let e=Math.max(n.attack??.01,c);t.linearRampToValueAtTime(1,i+e),t.setTargetAtTime(n.sustain??.7,i+e,Math.max(n.decay??.2,c)/3)}else t.setTargetAtTime(0,i,Math.max(n.release??.3,c)/3)}var u=.001,d=3,f=.0035,p=.005;function m(e,t,n,r,i,a){let o=n.velSens??1,s=(n.peak??1)*(1-o+o*i),l=Math.max(n.decay??.2,c)/4,p=Math.max(a??0,e.currentTime);if(t.cancelScheduledValues(p),t.setValueAtTime(t.value,p),t.linearRampToValueAtTime(s,p+u),r!==`clap`){t.setTargetAtTime(0,p+u,l);return}let m=Math.max(n.spread??.012,.002);t.setTargetAtTime(0,p+u,f);for(let e=1;e<=d;e++){let n=p+e*m;t.setValueAtTime(s,n),t.setTargetAtTime(0,n,e===d?l:f)}}function h(e,t,n){let r=Math.max(n??0,e.currentTime);t.cancelScheduledValues(r),t.setValueAtTime(t.value,r),t.setTargetAtTime(0,r,p)}function g(){let e=1024,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++)t[n]=n<e/2?-1:1;return t}var _=2.5;function v(){let e=2048,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++){let e=n/2047*2-1;t[n]=Math.tanh(_*e)/Math.tanh(_)}return t}function y(){let e=4097,t=new Float32Array(new ArrayBuffer(e*4)),n=.9;for(let r=0;r<e;r++){let e=r/4096*2-1,i=Math.abs(e);t[r]=Math.sign(e)*(i<n?i:n+.09999999999999998*Math.tanh((i-n)/.09999999999999998))}return t}function b(){let e=4097,t=new Float32Array(new ArrayBuffer(e*4)),n=.6;for(let r=0;r<e;r++){let e=r/4096*2-1,i=Math.abs(e)*3;t[r]=Math.sign(e)*(i<n?i:n+.4*Math.tanh((i-n)/.4))}return t}function ee(){let e=1025,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++)t[n]=Math.abs(n/1024*2-1);return t}function te(e){let t=8193,n=new Float32Array(new ArrayBuffer(t*4)),r=2**Math.max(1,Math.min(16,e))/2;for(let e=0;e<t;e++){let t=e/8192*2-1;n[e]=Math.round(t*r)/r}return n}var ne={small:.9,medium:2.4,large:5};function re(e,t){let n=e.sampleRate,r=Math.floor(n*t),i=e.createBuffer(2,r,n),a=Math.log(1e3)/t;for(let e=0;e<2;e++){let t=i.getChannelData(e),o=0;for(let e=0;e<r;e++){let r=e/n,i=Math.exp(-a*r)*Math.min(1,r/.004),s=.75*Math.exp(-r*1.2)+.06;o+=s*(Math.random()*2-1-o),t[e]=o*i}}return i}function ie(e){let t=e.createBuffer(1,e.sampleRate*2,e.sampleRate),n=t.getChannelData(0);for(let e=0;e<n.length;e++)n[e]=Math.random()*2-1;return t}var ae=64,oe=10,se=8e3;function ce(e){let t=se/oe,n=e.createBuffer(1,ae*t,se),r=n.getChannelData(0);for(let e=0;e<ae;e++)r.fill(Math.random()*2-1,e*t,(e+1)*t);return n}function le(e,t,n){let r=e.node(t);return r.kind===`constant`&&n===`offset`&&r.params.glide?Math.max(r.params.glide/3,a):a}var ue=`moa-follower`,de=[`
class MoaFollower extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'attack', defaultValue: 0.003, minValue: 0.0001, maxValue: 2, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.12, minValue: 0.001, maxValue: 5, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.env = 0; }
  process(inputs, outputs, params) {
    const out = outputs[0][0];
    const input = inputs[0];
    const ca = 1 - Math.exp(-1 / (Math.max(params.attack[0], 0.0001) * sampleRate));
    const cr = 1 - Math.exp(-1 / (Math.max(params.release[0], 0.001) * sampleRate));
    let env = this.env;
    for (let i = 0; i < out.length; i++) {
      let x = 0;
      for (let ch = 0; ch < input.length; ch++) x = Math.max(x, Math.abs(input[ch][i]));
      env += (x > env ? ca : cr) * (x - env);
      out[i] = env;
    }
    this.env = env;
    return true;
  }
}
registerProcessor('${ue}', MoaFollower);
`,t,i].join(`
`);function fe(){return URL.createObjectURL(new Blob([de],{type:`text/javascript`}))}var pe=24,me=48,he=12,ge=1e3,_e=500,x=class{intervals=[];last;isRunning=!1;pulses=0;get running(){return this.isRunning}get ticks(){return this.pulses}get bpm(){if(this.intervals.length<he)return;let e=[...this.intervals].sort((e,t)=>e-t),t=Math.floor(e.length/4),n=e.slice(t,e.length-t);return 6e4/(n.reduce((e,t)=>e+t,0)/n.length*pe)}isLocked(e){return this.last!==void 0&&this.intervals.length>=he&&e-this.last<_e}get position(){return ve(this.pulses)}handle(e,t){switch(e.type){case`clock`:if(this.last!==void 0){let e=t-this.last;e>ge?this.intervals=[]:this.intervals.push(e),this.intervals.length>me&&this.intervals.shift()}this.last=t,this.isRunning&&this.pulses++;break;case`start`:this.isRunning=!0,this.pulses=0;break;case`continue`:this.isRunning=!0;break;case`stop`:this.isRunning=!1}}};function ve(e){return{bar:Math.floor(e/96)+1,beat:Math.floor(e/pe)%4+1,sixteenth:Math.floor(e/(pe/4))%4+1}}function ye(e){let t=e[0];if(t===void 0)return;if(t>=240)switch(t){case 248:return{type:`clock`};case 250:return{type:`start`};case 251:return{type:`continue`};case 252:return{type:`stop`};default:return}let n=t&240,r=(t&15)+1,i=(e[1]??0)&127,a=(e[2]??0)&127;switch(n){case 128:return{type:`noteOff`,channel:r,note:i,velocity:a};case 144:return a===0?{type:`noteOff`,channel:r,note:i,velocity:0}:{type:`noteOn`,channel:r,note:i,velocity:a};case 176:return{type:`cc`,channel:r,controller:i,value:a};case 192:return{type:`programChange`,channel:r,program:i};case 224:return{type:`pitchBend`,channel:r,value:(a<<7|i)/8192-1};default:return}}var be=[`C`,`C#`,`D`,`D#`,`E`,`F`,`F#`,`G`,`G#`,`A`,`A#`,`B`];function xe(e){return`${be[e%12]}${Math.floor(e/12)-2}`}function Se(e){switch(e.type){case`noteOn`:case`noteOff`:return`note`;case`cc`:return`cc`;case`clock`:case`start`:case`continue`:case`stop`:return`clock`;default:return`other`}}function Ce(e){switch(e.type){case`noteOn`:return`ch${e.channel}  note on  ${xe(e.note)}  vel ${e.velocity}`;case`noteOff`:return`ch${e.channel}  note off  ${xe(e.note)}`;case`cc`:return`ch${e.channel}  cc ${e.controller}  = ${e.value}`;case`pitchBend`:return`ch${e.channel}  bend  ${e.value.toFixed(2)}`;case`programChange`:return`ch${e.channel}  program  ${e.program}`;case`clock`:return`clock`;default:return`clock ${e.type}`}}var we=40,Te=class{lines=[];lastSeen={note:-1/0,cc:-1/0,clock:-1/0,other:-1/0};listeners=new Set;record(e,t){if(this.lastSeen[Se(e)]=t,e.type!==`clock`){this.lines.push({text:Ce(e),kind:Se(e)}),this.lines.length>we&&this.lines.shift();for(let e of this.listeners)e()}}clear(){this.lines.length=0;for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}},Ee=class{nodes=new Map;cables=[];listeners=new Set;add(e,t,n={},r={}){if(this.nodes.has(e))throw Error(`Duplicate node id: ${e}`);return this.nodes.set(e,{id:e,kind:t,params:{...n},options:{...r}}),this}connect(e,t,n=`in`){this.node(e);let r=this.node(t);if(n!==`in`&&!(n in r.params))throw Error(`Node ${t} has no param ${n}`);if(this.cables.some(r=>r.from===e&&r.to===t&&r.port===n))throw Error(`Duplicate cable ${e} -> ${t}.${n}`);return this.cables.push({from:e,to:t,port:n}),this}setParam(e,t,n){let r=this.node(e);if(!(t in r.params))throw Error(`Node ${e} has no param ${t}`);r.params[t]=n,this.emit({type:`param`,nodeId:e,name:t,value:n})}setOption(e,t,n){let r=this.node(e);if(!(t in r.options))throw Error(`Node ${e} has no option ${t}`);r.options[t]=n,this.emit({type:`option`,nodeId:e,name:t,value:n})}trigger(e,t=1,n){this.expectKind(e,`trigger`),this.emit({type:`trigger`,nodeId:e,velocity:Math.min(1,Math.max(0,t)),when:n})}choke(e,t){this.expectKind(e,`trigger`),this.emit({type:`choke`,nodeId:e,when:t})}noteOn(e,t,n=1){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:t,velocity:Math.min(1,Math.max(0,n))})}noteOff(e,t){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:t,velocity:0})}allNotesOff(e){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:-1,velocity:0})}pedal(e,t){this.expectKind(e,`pipe`),this.emit({type:`note`,nodeId:e,note:-2,velocity:+!!t})}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}node(e){let t=this.nodes.get(e);if(!t)throw Error(`Unknown node: ${e}`);return t}expectKind(e,...t){if(!t.includes(this.node(e).kind))throw Error(`Node ${e} is not a ${t.join(` or `)}`)}emit(e){for(let t of this.listeners)t(e)}},S=class{circuit=new Ee;controlList=[];inputList=[];outputList=[];meterList=[];get controls(){return this.controlList}get inputs(){return this.inputList}get outputs(){return this.outputList}get meters(){return this.meterList}control(e){let t=this.controlList.find(t=>t.id===e);if(!t)throw Error(`${this.name} has no control ${e}`);return t}jack(e,t){let n=(e===`in`?this.inputList:this.outputList).find(e=>e.name===t);if(!n)throw Error(`${this.name} has no ${e} jack ${t}`);return n}},De=class{listeners=new Set;onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}notify(){for(let e of this.listeners)e()}},C=class extends De{id;label;min;max;initial;unit;apply;curve;kind=`number`;current;constructor(e,t,n,r,i,a,o,s=`linear`){super(),this.id=e,this.label=t,this.min=n,this.max=r,this.initial=i,this.unit=a,this.apply=o,this.curve=s,this.current=Oe(this.initial,n,r),this.apply(this.current)}get value(){return this.current}set(e){this.current=Oe(e,this.min,this.max),this.apply(this.current),this.notify()}},w=class extends De{id;label;options;apply;kind=`choice`;current;constructor(e,t,n,r,i){if(super(),this.id=e,this.label=t,this.options=n,this.apply=i,!n.includes(r))throw Error(`Invalid initial choice ${r}`);this.current=r,this.apply(this.current)}get value(){return this.current}set(e){if(!this.options.includes(e))throw Error(`Invalid choice ${e} for ${this.id}`);this.current=e,this.apply(e),this.notify()}},T=class extends De{id;label;apply;kind=`toggle`;current;constructor(e,t,n,r){super(),this.id=e,this.label=t,this.apply=r,this.current=n,this.apply(n)}get value(){return this.current}set(e){this.current=e,this.apply(e),this.notify()}};function Oe(e,t,n){return Math.min(n,Math.max(t,e))}var ke={"bc.threshold":-18,"bc.ratio":4,"bc.attack":10,"bc.release":200,"bc.knee":6,"bc.makeup":3,"bc.mix":1,"bc.duck.depth":0,"bc.duck.release":120,"bc.duck.keyHp":80,"bc.bypass":0,"bc.listen":0},E=(e,t)=>({name:e,values:t}),Ae=[E(`Init`,{}),E(`Glue`,{"bc.threshold":-14,"bc.ratio":2,"bc.attack":30,"bc.release":400,"bc.knee":12,"bc.makeup":2}),E(`Kick Duck`,{"bc.threshold":-6,"bc.ratio":1.5,"bc.makeup":0,"bc.duck.depth":.7,"bc.duck.release":140}),E(`Gentle Pump`,{"bc.threshold":-16,"bc.ratio":2,"bc.makeup":3,"bc.duck.depth":.35,"bc.duck.release":220}),E(`Hard Pump`,{"bc.threshold":-12,"bc.ratio":4,"bc.makeup":2,"bc.duck.depth":.95,"bc.duck.release":90,"bc.duck.keyHp":120}),E(`NY Parallel`,{"bc.threshold":-32,"bc.ratio":8,"bc.attack":3,"bc.release":100,"bc.knee":4,"bc.makeup":10,"bc.mix":.4}),E(`Drum Smash`,{"bc.threshold":-28,"bc.ratio":20,"bc.attack":1,"bc.release":200,"bc.knee":0,"bc.makeup":8,"bc.mix":.7}),E(`Limiter`,{"bc.threshold":-4,"bc.ratio":20,"bc.attack":1,"bc.release":100,"bc.knee":0,"bc.makeup":0})],je=4,Me=e=>10**(e/20);function Ne(e,t,n){let r=e+n/2<0?e+(0-e)/t:0;return-.6*Math.min(0,r)}var Pe=class extends S{name;slots=[...Ae];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;mix=1;makeupDb=3;threshold=-18;ratio=4;knee=6;bypass=!1;listen=!1;constructor(e=`Bus Comp`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`duck`,`gain`,{gain:1}).add(`gate`,`gain`,{gain:1}).add(`comp`,`compressor`,{threshold:-18,knee:6,ratio:4,attack:.01,release:.2}).add(`wet`,`gain`,{gain:Me(3)}).add(`dry`,`gain`,{gain:0}).add(`bypassPath`,`gain`,{gain:0}).add(`listenPath`,`gain`,{gain:0}).add(`out`,`gain`,{gain:1}).add(`inMeter`,`meter`,{},{channel:`mono`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`inMeter`).connect(`in`,`duck`).connect(`duck`,`gate`).connect(`gate`,`comp`).connect(`gate`,`dry`).connect(`comp`,`wet`).connect(`wet`,`out`).connect(`dry`,`out`).connect(`in`,`bypassPath`).connect(`bypassPath`,`out`).connect(`listenPath`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),t.add(`key`,`gain`,{gain:1},{channels:`mono`}).add(`keyHp`,`filter`,{frequency:80,Q:.707,detune:0},{type:`highpass`}).add(`follow`,`follower`,{attack:.003,release:.12}).add(`sense`,`gain`,{gain:je}).add(`keyShape`,`waveshaper`,{},{curve:`soft`}).add(`duckMeter`,`meter`,{},{channel:`mono`}).add(`depth`,`gain`,{gain:0}).connect(`key`,`keyHp`).connect(`keyHp`,`follow`).connect(`follow`,`sense`).connect(`sense`,`keyShape`).connect(`keyShape`,`duckMeter`).connect(`keyShape`,`depth`).connect(`depth`,`duck`,`gain`).connect(`keyHp`,`listenPath`),this.inputList.push({name:`in`,nodeId:`in`},{name:`key`,nodeId:`key`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`in`,nodeId:`inMeter`},{name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`},{name:`duck`,nodeId:`duckMeter`});let n=ke,r=(e,t,r,i,a,o,s)=>this.controlList.push(new C(e,t,r,i,n[e],a,o,s));r(`bc.threshold`,`Threshold`,-60,0,`dB`,e=>{this.threshold=e,t.setParam(`comp`,`threshold`,e),this.applyMix()}),r(`bc.ratio`,`Ratio`,1,20,`:1`,e=>{this.ratio=e,t.setParam(`comp`,`ratio`,e),this.applyMix()}),r(`bc.attack`,`Attack`,.3,100,`ms`,e=>t.setParam(`comp`,`attack`,e/1e3),`log`),r(`bc.release`,`Release`,30,1e3,`ms`,e=>t.setParam(`comp`,`release`,e/1e3),`log`),r(`bc.knee`,`Knee`,0,30,`dB`,e=>{this.knee=e,t.setParam(`comp`,`knee`,e),this.applyMix()}),r(`bc.makeup`,`Make-up`,0,24,`dB`,e=>{this.makeupDb=e,this.applyMix()}),r(`bc.mix`,`Mix`,0,1,``,e=>{this.mix=e,this.applyMix()}),r(`bc.duck.depth`,`Duck depth`,0,1,``,e=>t.setParam(`depth`,`gain`,-e)),r(`bc.duck.release`,`Duck release`,20,800,`ms`,e=>t.setParam(`follow`,`release`,e/1e3),`log`),r(`bc.duck.keyHp`,`Key HP`,20,300,`Hz`,e=>t.setParam(`keyHp`,`frequency`,e),`log`),this.controlList.push(new T(`bc.bypass`,`Bypass`,!1,e=>{this.bypass=e,this.applyPaths()}),new T(`bc.listen`,`Key listen`,!1,e=>{this.listen=e,this.applyPaths()}))}applyMix(){this.circuit.setParam(`dry`,`gain`,1-this.mix),this.circuit.setParam(`wet`,`gain`,this.mix*Me(this.makeupDb-Ne(this.threshold,this.ratio,this.knee)))}applyPaths(){let e=this.circuit;e.setParam(`gate`,`gain`,this.bypass||this.listen?0:1),e.setParam(`bypassPath`,`gain`,this.bypass&&!this.listen?1:0),e.setParam(`listenPath`,`gain`,+!!this.listen)}loadPreset(e){let t={...ke,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`bc.bypass`&&t.id!==`bc.listen`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}},Fe=[`internal`,`midi`],Ie=[`omni`,...Array.from({length:16},(e,t)=>String(t+1))],Le=2e3,Re=4,D=class{clock;now;sync=new w(`transport.sync`,`Sync`,Fe,`internal`,()=>{});followStartStop=new T(`transport.followStartStop`,`Start/stop`,!0,()=>{});channel=new w(`transport.channel`,`Channel`,Ie,`1`,()=>{});tempo=new C(`transport.tempo`,`Tempo`,20,300,120,`BPM`,()=>{});taps=[];constructor(e,t=()=>performance.now()){this.clock=e,this.now=t}get synced(){return this.sync.value===`midi`}get bpm(){return this.synced?this.clock.bpm??this.tempo.value:this.tempo.value}get locked(){return this.synced&&this.clock.isLocked(this.now())}get running(){return this.synced&&this.followStartStop.value&&this.clock.running}get position(){return this.running?this.clock.position:ve(0)}acceptsChannel(e){return this.channel.value===`omni`||Number(this.channel.value)===e}tap(e=this.now()){let t=this.taps[this.taps.length-1];if(t!==void 0&&e-t>Le&&(this.taps=[]),this.taps.push(e),this.taps.length>Re&&this.taps.shift(),this.taps.length>=2){let e=this.taps[this.taps.length-1]-this.taps[0];this.tempo.set(Math.round(6e4/(e/(this.taps.length-1))*10)/10)}}nudge(e){this.tempo.set(Math.round((this.tempo.value+e)*10)/10)}},O=[`kick`,`snare`,`clap`,`closedHat`,`openHat`,`ride`],ze={35:`kick`,36:`kick`,38:`snare`,40:`snare`,39:`clap`,42:`closedHat`,44:`closedHat`,46:`openHat`,51:`ride`,59:`ride`},Be=1200,Ve=[205.3,304.4,369.6,522.7,540,800],He=class extends S{name;transport;choke=new T(`hats.choke`,`Choke`,!0,()=>{});muted=new Set;soloed=new Set;envelopes=new Map;hitListeners=new Set;constructor(e=`Drums`,t=new x){super(),this.name=e,this.transport=new D(t),this.transport.channel.set(`10`);let n=this.circuit;this.addKick(n),this.addSnare(n),this.addClap(n),this.addHat(n,`closedHat`,{decay:[.015,.25,.04],tone:.7,level:.6}),this.addHat(n,`openHat`,{decay:[.1,1.5,.32],tone:.65,level:.6}),this.addRide(n);for(let e of O)n.add(`${e}.mute`,`gain`,{gain:1}).add(`${e}.out`,`gain`,{gain:.8}).add(`${e}.meter`,`meter`,{},{channel:`mono`}).connect(`${e}.sum`,`${e}.mute`).connect(`${e}.mute`,`${e}.out`).connect(`${e}.out`,`${e}.meter`),this.outputList.push({name:e,nodeId:`${e}.out`}),this.meterList.push({name:e,nodeId:`${e}.meter`});this.addLevels(n),this.controlList.push(this.choke)}trigger(e,t=1,n){if(!(t<=0)){e===`closedHat`&&this.choke.value&&this.circuit.choke(`openHat.ampEnv`,n);for(let r of this.envelopes.get(e)??[])this.circuit.trigger(r,t,n);for(let r of this.hitListeners)r(e,t,n)}}onHit(e){return this.hitListeners.add(e),()=>this.hitListeners.delete(e)}handleMidi(e){if(e.type!==`noteOn`||!this.transport.acceptsChannel(e.channel))return;let t=ze[e.note];t&&this.trigger(t,e.velocity/127)}get soloActive(){return this.soloed.size>0}register(e,...t){this.envelopes.set(e,[...this.envelopes.get(e)??[],...t])}num(...e){let t=new C(...e);return this.controlList.push(t),t}addKick(e){this.register(`kick`,`kick.pitchEnv`,`kick.ampEnv`,`kick.clickEnv`),e.add(`kick.osc`,`oscillator`,{frequency:48,detune:0},{waveform:`sine`}).add(`kick.pitchEnv`,`trigger`,{peak:2700,decay:.05,velSens:0}).add(`kick.ampEnv`,`trigger`,{peak:.8,decay:.38,velSens:.8}).add(`kick.amp`,`gain`,{gain:0}).add(`kick.noise`,`noise`).add(`kick.clickHp`,`filter`,{frequency:2500,Q:.707},{type:`highpass`}).add(`kick.clickAmp`,`gain`,{gain:0}).add(`kick.clickEnv`,`trigger`,{peak:.24,decay:.012,velSens:1}).add(`kick.sum`,`gain`,{gain:1}).connect(`kick.pitchEnv`,`kick.osc`,`detune`).connect(`kick.osc`,`kick.amp`).connect(`kick.ampEnv`,`kick.amp`,`gain`).connect(`kick.amp`,`kick.sum`).connect(`kick.noise`,`kick.clickHp`).connect(`kick.clickHp`,`kick.clickAmp`).connect(`kick.clickEnv`,`kick.clickAmp`,`gain`).connect(`kick.clickAmp`,`kick.sum`),this.num(`kick.tune`,`Tune`,30,120,48,`Hz`,t=>e.setParam(`kick.osc`,`frequency`,t),`log`),this.num(`kick.decay`,`Decay`,.08,1,.38,`s`,t=>e.setParam(`kick.ampEnv`,`decay`,t),`log`),this.num(`kick.click`,`Click`,0,1,.4,``,t=>e.setParam(`kick.clickEnv`,`peak`,t*.6))}addSnare(e){this.register(`snare`,`snare.pitchEnv`,`snare.bodyEnv`,`snare.noiseEnv`),e.add(`snare.osc1`,`oscillator`,{frequency:190,detune:0},{waveform:`triangle`}).add(`snare.osc2`,`oscillator`,{frequency:347.7,detune:0},{waveform:`triangle`}).add(`snare.pitchEnv`,`trigger`,{peak:500,decay:.03,velSens:0}).add(`snare.bodyEnv`,`trigger`,{peak:.4,decay:.1,velSens:.7}).add(`snare.bodyAmp`,`gain`,{gain:0}).add(`snare.noise`,`noise`).add(`snare.noiseHp`,`filter`,{frequency:1800,Q:.707},{type:`highpass`}).add(`snare.noiseEnv`,`trigger`,{peak:.42,decay:.18,velSens:1}).add(`snare.noiseAmp`,`gain`,{gain:0}).add(`snare.sum`,`gain`,{gain:1}).connect(`snare.osc1`,`snare.bodyAmp`).connect(`snare.osc2`,`snare.bodyAmp`).connect(`snare.pitchEnv`,`snare.osc1`,`detune`).connect(`snare.pitchEnv`,`snare.osc2`,`detune`).connect(`snare.bodyEnv`,`snare.bodyAmp`,`gain`).connect(`snare.bodyAmp`,`snare.sum`).connect(`snare.noise`,`snare.noiseHp`).connect(`snare.noiseHp`,`snare.noiseAmp`).connect(`snare.noiseEnv`,`snare.noiseAmp`,`gain`).connect(`snare.noiseAmp`,`snare.sum`),this.num(`snare.tune`,`Tune`,120,300,190,`Hz`,t=>{e.setParam(`snare.osc1`,`frequency`,t),e.setParam(`snare.osc2`,`frequency`,t*1.83)},`log`),this.num(`snare.decay`,`Decay`,.08,.5,.18,`s`,t=>{e.setParam(`snare.noiseEnv`,`decay`,t),e.setParam(`snare.bodyEnv`,`decay`,t*.55)},`log`),this.num(`snare.snap`,`Snap`,0,1,.6,``,t=>e.setParam(`snare.noiseEnv`,`peak`,t*.7))}addClap(e){this.register(`clap`,`clap.env`),e.add(`clap.noise`,`noise`).add(`clap.bp`,`filter`,{frequency:1200,Q:1.5},{type:`bandpass`}).add(`clap.amp`,`gain`,{gain:0}).add(`clap.env`,`trigger`,{peak:2.3,decay:.24,velSens:.8,spread:.012},{shape:`clap`}).add(`clap.sum`,`gain`,{gain:1}).connect(`clap.noise`,`clap.bp`).connect(`clap.bp`,`clap.amp`).connect(`clap.env`,`clap.amp`,`gain`).connect(`clap.amp`,`clap.sum`),this.num(`clap.tone`,`Tone`,600,3e3,1200,`Hz`,t=>e.setParam(`clap.bp`,`frequency`,t),`log`),this.num(`clap.decay`,`Decay`,.08,.6,.24,`s`,t=>e.setParam(`clap.env`,`decay`,t),`log`),this.num(`clap.spread`,`Spread`,0,1,.5,``,t=>e.setParam(`clap.env`,`spread`,.006+t*.012))}addMetal(e,t,n,r,i,a){e.add(`${t}.tune`,`constant`,{offset:0}).add(`${t}.metal`,`gain`,{gain:a}).add(`${t}.bp`,`filter`,{frequency:r,Q:.8},{type:`bandpass`}).add(`${t}.hp`,`filter`,{frequency:i,Q:.707},{type:`highpass`}).connect(`${t}.metal`,`${t}.bp`).connect(`${t}.bp`,`${t}.hp`),Ve.forEach((r,i)=>{let a=`${t}.sq${i+1}`;e.add(a,`oscillator`,{frequency:r*n,detune:0},{waveform:`square`}).connect(`${t}.tune`,a,`detune`).connect(a,`${t}.metal`)})}addHat(e,t,n){this.register(t,`${t}.ampEnv`),this.addMetal(e,t,1,9e3,7e3,.45),e.add(`${t}.amp`,`gain`,{gain:0}).add(`${t}.ampEnv`,`trigger`,{peak:1,decay:n.decay[2],velSens:.8}).add(`${t}.sum`,`gain`,{gain:1}).connect(`${t}.hp`,`${t}.amp`).connect(`${t}.ampEnv`,`${t}.amp`,`gain`).connect(`${t}.amp`,`${t}.sum`),this.num(`${t}.tune`,`Tune`,0,1,.6,``,n=>e.setParam(`${t}.tune`,`offset`,(n-.6)*2*Be)),this.num(`${t}.decay`,`Decay`,n.decay[0],n.decay[1],n.decay[2],`s`,n=>e.setParam(`${t}.ampEnv`,`decay`,n),`log`),this.num(`${t}.tone`,`Tone`,0,1,n.tone,``,n=>e.setParam(`${t}.hp`,`frequency`,3e3+n*7e3))}addRide(e){this.register(`ride`,`ride.ampEnv`,`ride.bellEnv`),this.addMetal(e,`ride`,1.3,6500,2500,.18),e.add(`ride.amp`,`gain`,{gain:0}).add(`ride.ampEnv`,`trigger`,{peak:1,decay:1.2,velSens:.8}).add(`ride.bell1`,`oscillator`,{frequency:2650,detune:0},{waveform:`sine`}).add(`ride.bell2`,`oscillator`,{frequency:4380,detune:0},{waveform:`sine`}).add(`ride.bellAmp`,`gain`,{gain:0}).add(`ride.bellEnv`,`trigger`,{peak:.2,decay:.9,velSens:.8}).add(`ride.sum`,`gain`,{gain:1}).connect(`ride.hp`,`ride.amp`).connect(`ride.ampEnv`,`ride.amp`,`gain`).connect(`ride.amp`,`ride.sum`).connect(`ride.tune`,`ride.bell1`,`detune`).connect(`ride.tune`,`ride.bell2`,`detune`).connect(`ride.bell1`,`ride.bellAmp`).connect(`ride.bell2`,`ride.bellAmp`).connect(`ride.bellEnv`,`ride.bellAmp`,`gain`).connect(`ride.bellAmp`,`ride.sum`),this.num(`ride.tune`,`Tune`,0,1,.5,``,t=>e.setParam(`ride.tune`,`offset`,(t-.5)*2*Be)),this.num(`ride.decay`,`Decay`,.4,2.5,1.2,`s`,t=>{e.setParam(`ride.ampEnv`,`decay`,t),e.setParam(`ride.bellEnv`,`decay`,t*.75)},`log`),this.num(`ride.bell`,`Bell`,0,1,.45,``,t=>e.setParam(`ride.bellEnv`,`peak`,t*.45))}addLevels(e){let t={kick:.8,snare:.75,clap:.7,closedHat:.6,openHat:.6,ride:.55};for(let n of O)this.num(`${n}.level`,`Level`,0,1,t[n],``,t=>e.setParam(`${n}.out`,`gain`,t)),this.controlList.push(new T(`${n}.mute`,`Mute`,!1,e=>this.setFlag(this.muted,n,e)),new T(`${n}.solo`,`Solo`,!1,e=>this.setFlag(this.soloed,n,e)))}setFlag(e,t,n){n?e.add(t):e.delete(t);for(let e of O){let t=`${e}.mute`;if(!this.circuit.nodes.has(t))continue;let n=this.muted.has(e)||this.soloed.size>0&&!this.soloed.has(e);this.circuit.setParam(t,`gain`,+!n)}}},Ue=[`small`,`medium`,`large`],We=3.5,k=Math.tanh(2.5)/2.5,Ge=2,Ke=class extends S{name;constructor(e=`Reverb`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`pre`,`delay`,{delayTime:.02,maxTime:.3}).add(`conv`,`convolver`,{},{size:`medium`}).add(`lowcut`,`filter`,{frequency:150,Q:.707,detune:0},{type:`highpass`}).add(`damp`,`filter`,{frequency:5e3,Q:.707,detune:0},{type:`lowpass`}).add(`drive`,`gain`,{gain:We*k/Ge}).add(`sat`,`waveshaper`,{},{curve:`soft`}).add(`out`,`gain`,{gain:Ge}).connect(`in`,`pre`).connect(`pre`,`conv`).connect(`conv`,`lowcut`).connect(`lowcut`,`damp`).connect(`damp`,`drive`).connect(`drive`,`sat`).connect(`sat`,`out`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.controlList.push(new w(`reverb.size`,`Size`,Ue,`medium`,e=>t.setOption(`conv`,`size`,e)),new C(`reverb.predelay`,`Pre-delay`,0,250,20,`ms`,e=>t.setParam(`pre`,`delayTime`,e/1e3)),new C(`reverb.lowcut`,`Low cut`,40,600,150,`Hz`,e=>t.setParam(`lowcut`,`frequency`,e),`log`),new C(`reverb.damp`,`Damping`,1e3,16e3,5e3,`Hz`,e=>t.setParam(`damp`,`frequency`,e),`log`))}},qe=class extends S{name;spread=.8;feedback=.45;constructor(e=`Delay`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`out`,`gain`,{gain:.5}).add(`wobble`,`oscillator`,{frequency:.9,detune:0},{waveform:`sine`}).add(`wobbleDepth`,`gain`,{gain:6e-4});for(let e of[`L`,`R`]){let n=t=>`${t}${e}`;t.add(n(`inGain`),`gain`,{gain:1}).add(n(`dly`),`delay`,{delayTime:.375,maxTime:2}).add(n(`tone`),`filter`,{frequency:3200,Q:.707,detune:0},{type:`lowpass`}).add(n(`hp`),`filter`,{frequency:120,Q:.707,detune:0},{type:`highpass`}).add(n(`drive`),`gain`,{gain:1.9}).add(n(`sat`),`waveshaper`,{},{curve:`soft`}).add(n(`make`),`gain`,{gain:k/1.9}).add(n(`fbSelf`),`gain`,{gain:0}).add(n(`fbCross`),`gain`,{gain:0}).add(n(`pan`),`pan`,{pan:e===`L`?-1:1}).connect(`in`,n(`inGain`)).connect(n(`inGain`),n(`dly`)).connect(n(`dly`),n(`tone`)).connect(n(`tone`),n(`hp`)).connect(n(`hp`),n(`drive`)).connect(n(`drive`),n(`sat`)).connect(n(`sat`),n(`make`)).connect(n(`make`),n(`fbSelf`)).connect(n(`make`),n(`fbCross`)).connect(n(`sat`),n(`pan`)).connect(n(`pan`),`out`).connect(`wobbleDepth`,n(`dly`),`delayTime`)}t.connect(`fbSelfL`,`dlyL`).connect(`fbCrossL`,`dlyR`).connect(`fbSelfR`,`dlyR`).connect(`fbCrossR`,`dlyL`).connect(`wobble`,`wobbleDepth`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`});let n=e=>{e(`L`),e(`R`)};this.controlList.push(new C(`delay.time`,`Time`,20,1500,375,`ms`,e=>n(n=>t.setParam(`dly${n}`,`delayTime`,e/1e3)),`log`),new C(`delay.feedback`,`Feedback`,0,1.1,.45,``,e=>{this.feedback=e,this.applyFeedback()}),new C(`delay.tone`,`Tone`,400,12e3,3200,`Hz`,e=>n(n=>t.setParam(`tone${n}`,`frequency`,e)),`log`),new C(`delay.spread`,`Ping-pong`,0,1,.8,``,e=>{this.spread=e,this.applyFeedback(),t.setParam(`inGainR`,`gain`,1-e)}),new C(`delay.wobble`,`Wobble`,0,1,.15,``,e=>t.setParam(`wobbleDepth`,`gain`,e*.004)),new C(`delay.drive`,`Drive`,0,1,.3,``,e=>{let r=1+e*3;n(e=>{t.setParam(`drive${e}`,`gain`,r),t.setParam(`make${e}`,`gain`,k/r)})}))}applyFeedback(){let e=this.circuit;for(let t of[`L`,`R`])e.setParam(`fbSelf${t}`,`gain`,this.feedback*(1-this.spread)),e.setParam(`fbCross${t}`,`gain`,this.feedback*this.spread)}},Je=1,Ye=2,Xe=.8,Ze={"gr.position":.3,"gr.size":120,"gr.pitch":0,"gr.rate":12,"gr.spread":.5,"gr.cloud":.2,"gr.detune":0,"gr.shape":.3,"gr.reverse":0,"gr.feedback":0,"gr.mix":1,"gr.freeze":0,"gr.filter":2e4,"gr.reso":.7,"gr.drive":0,"gr.reverb":0,"gr.tone":8e3,"gr.tail":`medium`,"gr.play":0,"gr.attack":20,"gr.decay":300,"gr.sustain":.8,"gr.release":600},Qe=3.5,$e=2,et=7,A=(e,t)=>({name:e,values:t}),tt=[A(`Init`,{}),A(`Cloud Wash`,{"gr.position":.5,"gr.size":350,"gr.rate":30,"gr.spread":1,"gr.cloud":.6,"gr.detune":12,"gr.shape":0,"gr.reverb":.35,"gr.tail":`large`}),A(`Frozen Pad`,{"gr.position":.15,"gr.size":700,"gr.rate":14,"gr.spread":.9,"gr.cloud":.25,"gr.detune":6,"gr.shape":0,"gr.freeze":1,"gr.filter":3500,"gr.reverb":.3,"gr.tail":`large`}),A(`Stutter`,{"gr.position":.02,"gr.size":90,"gr.rate":8,"gr.spread":.2,"gr.cloud":0,"gr.shape":.7}),A(`Octave Shimmer`,{"gr.position":.25,"gr.size":220,"gr.pitch":12,"gr.rate":24,"gr.spread":.8,"gr.cloud":.3,"gr.detune":8,"gr.feedback":.35,"gr.reverb":.25}),A(`Reverse Swell`,{"gr.position":.35,"gr.size":900,"gr.rate":6,"gr.spread":.6,"gr.cloud":.15,"gr.shape":0,"gr.reverse":1}),A(`Glitch Dust`,{"gr.position":.6,"gr.size":25,"gr.rate":70,"gr.spread":1,"gr.cloud":.9,"gr.detune":40,"gr.shape":.8,"gr.reverse":.3,"gr.drive":.35,"gr.filter":9e3,"gr.reso":3}),A(`Tape Drone`,{"gr.position":.1,"gr.size":500,"gr.pitch":-12,"gr.rate":18,"gr.spread":.4,"gr.cloud":.1,"gr.detune":4,"gr.shape":0,"gr.feedback":.6,"gr.filter":1800,"gr.reso":2,"gr.drive":.25})],nt=class extends S{name;slots=[...tt];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;noteListeners=new Set;performanceListeners=new Set;held=[];bend=0;modWheelValue=0;pitchSemitones=0;constructor(e=`Granular`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`grains`,`granular`,{maxTime:20,position:.3,size:.12,pitch:0,rate:12,spread:.5,cloud:.2,detune:0,shape:.3,reverse:0,feedback:0,freeze:0,play:0,attack:.02,decay:.3,sustain:.8,release:.6}).add(`filter`,`filter`,{frequency:2e4,Q:.7,gain:0,detune:0},{type:`lowpass`}).add(`preDrive`,`gain`,{gain:1}).add(`sat`,`waveshaper`,{},{curve:`soft`}).add(`postDrive`,`gain`,{gain:k}).add(`revSend`,`gain`,{gain:0}).add(`conv`,`convolver`,{},{size:`medium`}).add(`revTone`,`filter`,{frequency:8e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`revDrive`,`gain`,{gain:Qe*k/$e}).add(`revSat`,`waveshaper`,{},{curve:`soft`}).add(`revOut`,`gain`,{gain:$e}).add(`wet`,`gain`,{gain:1}).add(`dry`,`gain`,{gain:0}).add(`out`,`gain`,{gain:1}).add(`inMeter`,`meter`,{},{channel:`mono`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`grains`).connect(`in`,`dry`).connect(`in`,`inMeter`).connect(`grains`,`filter`).connect(`filter`,`preDrive`).connect(`preDrive`,`sat`).connect(`sat`,`postDrive`).connect(`postDrive`,`wet`).connect(`wet`,`out`).connect(`postDrive`,`revSend`).connect(`revSend`,`conv`).connect(`conv`,`revTone`).connect(`revTone`,`revDrive`).connect(`revDrive`,`revSat`).connect(`revSat`,`revOut`).connect(`revOut`,`out`).connect(`dry`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`in`,nodeId:`inMeter`},{name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=Ze,r=(e,t,r,i,a,o,s)=>this.controlList.push(new C(e,t,r,i,n[e],a,o,s)),i=(e,n,i,a,o,s,c=1,l)=>r(e,n,i,a,o,e=>t.setParam(`grains`,s,e*c),l);i(`gr.position`,`Position`,0,1,``,`position`),i(`gr.size`,`Size`,5,2e3,`ms`,`size`,1/1e3,`log`),r(`gr.pitch`,`Pitch`,-24,24,`st`,e=>{this.pitchSemitones=e,this.applyPitch()}),i(`gr.rate`,`Rate`,.5,100,`Hz`,`rate`,1,`log`),i(`gr.spread`,`Spread`,0,1,``,`spread`),i(`gr.cloud`,`Cloud`,0,1,``,`cloud`),i(`gr.detune`,`Detune`,0,100,`ct`,`detune`),i(`gr.shape`,`Shape`,0,1,``,`shape`),i(`gr.reverse`,`Reverse`,0,1,``,`reverse`),i(`gr.feedback`,`Feedback`,0,.95,``,`feedback`),r(`gr.filter`,`Filter`,40,2e4,`Hz`,e=>t.setParam(`filter`,`frequency`,e),`log`),r(`gr.reso`,`Reso`,.7,12,``,e=>t.setParam(`filter`,`Q`,e),`log`),r(`gr.drive`,`Drive`,0,1,``,e=>{t.setParam(`preDrive`,`gain`,1+et*e),t.setParam(`postDrive`,`gain`,k/(1+2*e))}),r(`gr.reverb`,`Reverb`,0,1,``,e=>t.setParam(`revSend`,`gain`,e)),r(`gr.tone`,`Tone`,1e3,16e3,`Hz`,e=>t.setParam(`revTone`,`frequency`,e),`log`),r(`gr.mix`,`Mix`,0,1,``,e=>{t.setParam(`wet`,`gain`,e),t.setParam(`dry`,`gain`,1-e)}),r(`gr.attack`,`Attack`,1,4e3,`ms`,e=>t.setParam(`grains`,`attack`,e/1e3),`log`),r(`gr.decay`,`Decay`,5,4e3,`ms`,e=>t.setParam(`grains`,`decay`,e/1e3),`log`),r(`gr.sustain`,`Sustain`,0,1,``,e=>t.setParam(`grains`,`sustain`,e)),r(`gr.release`,`Release`,5,8e3,`ms`,e=>t.setParam(`grains`,`release`,e/1e3),`log`),this.controlList.push(new T(`gr.play`,`Keys`,!1,e=>{t.setParam(`grains`,`play`,+!!e),e||this.releaseAll()}),new w(`gr.channel`,`MIDI channel`,Ie,`3`,()=>{}),new w(`gr.tail`,`Tail`,Ue,`medium`,e=>t.setOption(`conv`,`size`,e)),new T(`gr.freeze`,`Freeze`,!1,e=>t.setParam(`grains`,`freeze`,+!!e)))}applyPitch(){this.circuit.setParam(`grains`,`pitch`,this.pitchSemitones+this.bend*Ye)}releaseAll(){if(this.circuit.allNotesOff(`grains`),this.held.length>0){this.held=[];for(let e of this.noteListeners)e()}}keyDown(e,t=Xe){let n=this.control(`gr.play`);n.kind===`toggle`&&!n.value&&n.set(!0),this.held=this.held.filter(t=>t!==e),this.held.push(e),this.circuit.noteOn(`grains`,e,t);for(let e of this.noteListeners)e()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.circuit.noteOff(`grains`,e);for(let e of this.noteListeners)e()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.applyPitch();for(let e of this.performanceListeners)e()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e));for(let e of this.performanceListeners)e()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(!(`channel`in e))return;let t=this.control(`gr.channel`);if(!(t.kind!==`choice`||t.value!==`omni`&&Number(t.value)!==e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity/127);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===Je&&this.setModWheel(e.value/127);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...Ze,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`gr.channel`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}},rt=[`series`,`parallel`,`pingpong`],it=[`lfo`,`env`],at=[`tri`,`ramp`,`sqr`,`rnd`],ot=[`lp`,`hp`],j=[`a`,`b`],M=e=>e.toUpperCase(),st=.25,ct=3600,lt=.8,ut=.5,dt=1,ft=8e-4,pt={"ouro.input":1,"ouro.mix":.5,"ouro.output":1,"ouro.routing":`parallel`,"ouro.kill":0,"ouro.freeze":0,"ouro.a.on":1,"ouro.a.gain":1,"ouro.a.delay":380,"ouro.a.grit":.15,"ouro.a.cutoff":3e3,"ouro.a.resonance":1.2,"ouro.a.filter":`lp`,"ouro.a.clip":.25,"ouro.a.level":1,"ouro.b.on":1,"ouro.b.gain":1,"ouro.b.delay":530,"ouro.b.grit":.15,"ouro.b.cutoff":2200,"ouro.b.resonance":1.2,"ouro.b.filter":`lp`,"ouro.b.clip":.25,"ouro.b.level":1,"ouro.fb.aa":.35,"ouro.fb.ab":.15,"ouro.fb.ba":.15,"ouro.fb.bb":.35,"ouro.mod.mode":`lfo`,"ouro.mod.wave":`tri`,"ouro.mod.rate":.8,"ouro.mod.depth":.4,"ouro.mod.trigger":0,"ouro.mod.dlyA":.15,"ouro.mod.dlyB":-.15,"ouro.mod.cutA":0,"ouro.mod.cutB":0,"ouro.mod.gainA":0,"ouro.mod.gainB":0},N=(e,t)=>({name:e,values:t}),mt=[N(`Tape Spiral`,{"ouro.routing":`series`,"ouro.a.delay":240,"ouro.b.delay":360,"ouro.fb.aa":.35,"ouro.fb.bb":.4,"ouro.fb.ab":0,"ouro.fb.ba":.15,"ouro.a.grit":.35,"ouro.a.cutoff":2200,"ouro.b.cutoff":1800,"ouro.mod.rate":.4,"ouro.mod.depth":.6,"ouro.mod.dlyA":.3,"ouro.mod.dlyB":.2,"ouro.mod.cutA":.1}),N(`Karaoke Drone`,{"ouro.mix":.7,"ouro.fb.aa":.95,"ouro.fb.bb":.95,"ouro.a.gain":1.6,"ouro.b.gain":1.6,"ouro.a.grit":.5,"ouro.b.grit":.5,"ouro.a.clip":.6,"ouro.b.clip":.6,"ouro.a.delay":700,"ouro.b.delay":910,"ouro.a.cutoff":1400,"ouro.b.cutoff":1e3,"ouro.a.resonance":4,"ouro.b.resonance":4}),N(`Ping Pong Mayhem`,{"ouro.routing":`pingpong`,"ouro.mix":.6,"ouro.a.delay":280,"ouro.b.delay":280,"ouro.fb.ab":0,"ouro.fb.ba":.15,"ouro.fb.aa":.1,"ouro.fb.bb":.1,"ouro.a.resonance":.7,"ouro.b.resonance":.7,"ouro.a.grit":.1,"ouro.mod.depth":0}),N(`Dub Wash`,{"ouro.routing":`series`,"ouro.mix":.45,"ouro.a.delay":480,"ouro.b.delay":720,"ouro.fb.aa":.6,"ouro.fb.bb":.5,"ouro.fb.ab":.1,"ouro.fb.ba":.1,"ouro.a.cutoff":1800,"ouro.b.cutoff":1200,"ouro.a.resonance":2.5,"ouro.b.resonance":2.5,"ouro.a.clip":.2,"ouro.mod.rate":.25,"ouro.mod.depth":.5,"ouro.mod.cutA":.4,"ouro.mod.cutB":.3}),N(`Self Oscillator`,{"ouro.input":.2,"ouro.mix":1,"ouro.fb.aa":1.1,"ouro.fb.bb":1.1,"ouro.fb.ab":.3,"ouro.fb.ba":.3,"ouro.a.resonance":18,"ouro.b.resonance":18,"ouro.a.cutoff":800,"ouro.b.cutoff":1200,"ouro.a.clip":.5,"ouro.b.clip":.5,"ouro.a.delay":60,"ouro.b.delay":90,"ouro.mod.rate":.1,"ouro.mod.depth":.3,"ouro.mod.cutA":.5}),N(`Broken Echo`,{"ouro.a.grit":.85,"ouro.b.grit":.85,"ouro.a.delay":330,"ouro.b.delay":470,"ouro.fb.aa":.55,"ouro.fb.bb":.55,"ouro.a.clip":.7,"ouro.b.clip":.7,"ouro.mod.wave":`rnd`,"ouro.mod.rate":6,"ouro.mod.depth":.7,"ouro.mod.dlyA":.4,"ouro.mod.dlyB":-.3,"ouro.mod.gainA":.3}),N(`Filter Scream`,{"ouro.routing":`series`,"ouro.mix":.8,"ouro.a.filter":`hp`,"ouro.a.cutoff":2500,"ouro.a.resonance":16,"ouro.b.cutoff":1500,"ouro.b.resonance":16,"ouro.fb.aa":.6,"ouro.fb.bb":.6,"ouro.fb.ab":.2,"ouro.fb.ba":.1,"ouro.a.clip":.8,"ouro.b.clip":.8,"ouro.mod.wave":`ramp`,"ouro.mod.rate":2,"ouro.mod.depth":.8,"ouro.mod.cutA":.8,"ouro.mod.cutB":-.8}),N(`Slow Rot`,{"ouro.routing":`series`,"ouro.mix":.55,"ouro.a.delay":900,"ouro.b.delay":1300,"ouro.a.grit":.6,"ouro.b.grit":.6,"ouro.fb.aa":.55,"ouro.fb.bb":.55,"ouro.fb.ab":0,"ouro.fb.ba":.1,"ouro.a.cutoff":900,"ouro.b.cutoff":700,"ouro.a.resonance":1,"ouro.b.resonance":1,"ouro.mod.rate":.08,"ouro.mod.depth":.9,"ouro.mod.dlyA":.5,"ouro.mod.dlyB":.4,"ouro.a.level":.9,"ouro.b.level":.9})],ht=class extends S{name;slots=[...mt];currentSlot=0;currentPreset=this.slots[0];fb={aa:.35,ab:.15,ba:.15,bb:.35};on={a:!0,b:!0};clipDrive={a:1.25,b:1.25};routing=`parallel`;killed=!1;frozen=!1;modRate=.8;presetListeners=new Set;constructor(e=`Ouroboros`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`mono`,`gain`,{gain:1},{channels:`mono`}).add(`inGain`,`gain`,{gain:1}).add(`srcGate`,`gain`,{gain:1}).add(`srcA`,`gain`,{gain:1}).add(`srcB`,`gain`,{gain:1}).add(`dry`,`gain`,{gain:Math.SQRT1_2}).add(`wet`,`gain`,{gain:Math.SQRT1_2}).add(`sum`,`gain`,{gain:1}).add(`out`,`gain`,{gain:1}).connect(`in`,`mono`).connect(`mono`,`inGain`).connect(`inGain`,`srcGate`).connect(`srcGate`,`srcA`).connect(`srcGate`,`srcB`).connect(`in`,`dry`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`out`).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`L`,nodeId:`meterL`},{name:`R`,nodeId:`meterR`});for(let e of j)this.addChannel(t,e);t.add(`linkAB`,`gain`,{gain:0}).add(`bounceBA`,`gain`,{gain:0}).connect(`lvlA`,`linkAB`).connect(`linkAB`,`inB`).connect(`lvlB`,`bounceBA`).connect(`bounceBA`,`inA`).connect(`srcA`,`inA`).connect(`srcB`,`inB`);for(let e of j)for(let n of j)t.add(`fb${M(e)}${M(n)}`,`gain`,{gain:0}).connect(`clip${M(e)}`,`fb${M(e)}${M(n)}`).connect(`fb${M(e)}${M(n)}`,`in${M(n)}`);t.add(`seedNoise`,`noise`).add(`seedGain`,`gain`,{gain:ft}).connect(`seedNoise`,`seedGain`).connect(`seedGain`,`inA`).connect(`seedGain`,`inB`),this.addModulator(t),this.addControls(t),this.applyRouting(),this.applyFeedback()}loadPreset(e){let t={...pt,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`ouro.kill`&&t.id!==`ouro.mod.trigger`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}addChannel(e,t){let n=M(t);e.add(`in${n}`,`gain`,{gain:1}).add(`on${n}`,`gain`,{gain:1}).add(`g${n}`,`gain`,{gain:k}).add(`sg${n}`,`waveshaper`,{},{curve:`soft`}).add(`dly${n}`,`delay`,{delayTime:.38,maxTime:2}).add(`tone${n}`,`filter`,{frequency:4800,Q:.707,detune:0},{type:`lowpass`}).add(`crush${n}`,`waveshaper`,{bits:16},{curve:`crush`}).add(`filt${n}`,`filter`,{frequency:3e3,Q:1.2,detune:0},{type:`lowpass`}).add(`cdrive${n}`,`gain`,{gain:k}).add(`clip${n}`,`waveshaper`,{},{curve:`soft`}).add(`lvl${n}`,`gain`,{gain:1}).add(`send${n}`,`gain`,{gain:1}).add(`pan${n}`,`pan`,{pan:t===`a`?-1:1}).connect(`in${n}`,`on${n}`).connect(`on${n}`,`g${n}`).connect(`g${n}`,`sg${n}`).connect(`sg${n}`,`dly${n}`).connect(`dly${n}`,`tone${n}`).connect(`tone${n}`,`crush${n}`).connect(`crush${n}`,`filt${n}`).connect(`filt${n}`,`cdrive${n}`).connect(`cdrive${n}`,`clip${n}`).connect(`clip${n}`,`lvl${n}`).connect(`lvl${n}`,`send${n}`).connect(`send${n}`,`pan${n}`).connect(`pan${n}`,`wet`)}addModulator(e){e.add(`lfoOsc`,`oscillator`,{frequency:.8,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:.8}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfoGate`,`gain`,{gain:1}).add(`follow`,`waveshaper`,{},{curve:`abs`}).add(`followLp`,`filter`,{frequency:.8,Q:.707,detune:0},{type:`lowpass`}).add(`followGain`,`gain`,{gain:4}).add(`modTrig`,`trigger`,{peak:1,decay:.6,velSens:0}).add(`envGate`,`gain`,{gain:0}).add(`mod`,`gain`,{gain:1}).add(`modOut`,`gain`,{gain:.4}).connect(`lfoOsc`,`lfoOscOut`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoOscOut`,`lfoGate`).connect(`lfoRndOut`,`lfoGate`).connect(`inGain`,`follow`).connect(`follow`,`followLp`).connect(`followLp`,`followGain`).connect(`followGain`,`envGate`).connect(`modTrig`,`envGate`).connect(`lfoGate`,`mod`).connect(`envGate`,`mod`).connect(`mod`,`modOut`);for(let t of j){let n=M(t);e.add(`mDly${n}`,`gain`,{gain:0}).add(`mCut${n}`,`gain`,{gain:0}).add(`mGain${n}`,`gain`,{gain:0}).connect(`modOut`,`mDly${n}`).connect(`mDly${n}`,`dly${n}`,`delayTime`).connect(`modOut`,`mCut${n}`).connect(`mCut${n}`,`filt${n}`,`detune`).connect(`modOut`,`mGain${n}`).connect(`mGain${n}`,`g${n}`,`gain`)}}addControls(e){let t=pt,n=e=>t[e],r=(e,t,r,i,a,o,s)=>this.controlList.push(new C(e,t,r,i,n(e),a,o,s)),i=(e,n,r,i)=>this.controlList.push(new w(e,n,r,t[e],i));r(`ouro.input`,`Input`,0,2,``,t=>e.setParam(`inGain`,`gain`,t)),r(`ouro.mix`,`Mix`,0,1,``,t=>{e.setParam(`dry`,`gain`,Math.cos(t*Math.PI/2)),e.setParam(`wet`,`gain`,Math.sin(t*Math.PI/2))}),r(`ouro.output`,`Output`,0,1.5,``,t=>e.setParam(`out`,`gain`,t)),i(`ouro.routing`,`Routing`,rt,e=>{this.routing=e,this.applyRouting(),this.applyFeedback()}),this.controlList.push(new T(`ouro.kill`,`Kill`,!1,e=>{this.killed=e,this.applyFeedback()}),new T(`ouro.freeze`,`Freeze`,!1,e=>{this.frozen=e,this.applyFeedback()}));for(let t of j){let n=M(t),a=e=>`ouro.${t}.${e}`;this.controlList.push(new T(a(`on`),`On`,!0,r=>{this.on[t]=r,e.setParam(`on${n}`,`gain`,+!!r),this.applyFeedback()})),r(a(`gain`),`Gain`,.05,8,`×`,t=>e.setParam(`g${n}`,`gain`,t*k),`log`),r(a(`delay`),`Delay`,10,1800,`ms`,t=>e.setParam(`dly${n}`,`delayTime`,t/1e3),`log`),r(a(`grit`),`Grit`,0,1,``,t=>e.setParam(`crush${n}`,`bits`,16-t*13)),r(a(`cutoff`),`Cutoff`,20,18e3,`Hz`,t=>e.setParam(`filt${n}`,`frequency`,t),`log`),r(a(`resonance`),`Resonance`,.1,30,``,t=>e.setParam(`filt${n}`,`Q`,t)),i(a(`filter`),`Filter`,ot,t=>e.setOption(`filt${n}`,`type`,t===`hp`?`highpass`:`lowpass`)),r(a(`clip`),`Clip`,0,1,``,r=>{let i=1+r*7;e.setParam(`cdrive${n}`,`gain`,k*i),this.clipDrive[t]=i,this.applyFeedback()}),r(a(`level`),`Level`,0,1.5,``,t=>e.setParam(`lvl${n}`,`gain`,t))}for(let[e,t]of[[`aa`,`A>A`],[`ab`,`A>B`],[`ba`,`B>A`],[`bb`,`B>B`]])r(`ouro.fb.${e}`,t,0,1.2,``,t=>{this.fb[e]=t,this.applyFeedback()});i(`ouro.mod.mode`,`Mode`,it,t=>{e.setParam(`lfoGate`,`gain`,+(t===`lfo`)),e.setParam(`envGate`,`gain`,+(t===`env`))}),i(`ouro.mod.wave`,`Wave`,at,t=>{e.setOption(`lfoOsc`,`waveform`,t===`sqr`?`square`:t===`ramp`?`sawtooth`:`triangle`),e.setParam(`lfoOscOut`,`gain`,t===`rnd`?0:1),e.setParam(`lfoRndOut`,`gain`,+(t===`rnd`))}),r(`ouro.mod.rate`,`Rate`,.05,30,`Hz`,t=>{this.modRate=t,e.setParam(`lfoOsc`,`frequency`,t),e.setParam(`lfoRnd`,`rate`,t),e.setParam(`followLp`,`frequency`,t),e.setParam(`modTrig`,`decay`,Math.min(4,1.5/t))},`log`),r(`ouro.mod.depth`,`Depth`,0,1,``,t=>e.setParam(`modOut`,`gain`,t)),this.controlList.push(new T(`ouro.mod.trigger`,`Trigger`,!1,t=>{t&&e.trigger(`modTrig`,1)}));for(let t of j){let n=M(t),i=(t,i,a,o)=>r(`ouro.mod.${t}${n}`,i,-1,1,``,t=>e.setParam(`${a}${n}`,`gain`,t*o));i(`dly`,`Delay ${n}`,`mDly`,st),i(`cut`,`Cutoff ${n}`,`mCut`,ct),i(`gain`,`Gain ${n}`,`mGain`,lt)}}applyRouting(){let e=this.circuit,t=this.routing===`series`,n=this.routing===`parallel`;e.setParam(`srcB`,`gain`,+!!n),e.setParam(`sendA`,`gain`,+!t),e.setParam(`panA`,`pan`,-1),e.setParam(`panB`,`pan`,+!t)}applyFeedback(){let e=this.circuit;for(let t of j)for(let n of j){let r=`${t}${n}`,i=this.fb[r]/this.clipDrive[t];this.frozen&&t===n&&(i=dt/this.clipDrive[t]),(this.killed||!this.on[t]||!this.on[n])&&(i=0),e.setParam(`fb${M(t)}${M(n)}`,`gain`,i)}let t=this.routing!==`parallel`;e.setParam(`linkAB`,`gain`,t?1/this.clipDrive.a:0);let n=this.routing===`pingpong`&&!this.killed&&this.on.a&&this.on.b;e.setParam(`bounceBA`,`gain`,n?ut/this.clipDrive.b:0),e.setParam(`srcGate`,`gain`,+!this.frozen)}},gt={"lfo.rate":5,"lfo.delay":0,"dco.lfo":0,"dco.pwm":.5,"dco.pwmSource":`man`,"dco.range":`8`,"dco.pulse":1,"dco.saw":1,"dco.sub":.3,"dco.noise":0,"hpf.freq":`1`,"vcf.freq":3e3,"vcf.res":.2,"vcf.env":.4,"vcf.polarity":`plus`,"vcf.lfo":0,"vcf.kybd":.5,"vca.mode":`env`,"vca.level":.8,"env.attack":.005,"env.decay":.4,"env.sustain":.6,"env.release":.3,"chorus.i":0,"chorus.ii":0,"bend.dco":2,"bend.vcf":.2,"bend.lfo":.3,"bend.lfoTrig":0,"master.portamento":0,"assign.mode":`poly1`,"master.tune":0,"master.volume":.75,"key.hold":0,"key.transpose":`0`},_t=[`master.tune`,`master.volume`,`key.hold`,`key.transpose`],vt=[`A`,`B`],yt=vt.length*8*8,bt=(e,t,n)=>e*8*8+(t-1)*8+(n-1),P=(e,t)=>({name:e,values:t}),xt=[P(`Brass 1`,{"dco.sub":.2,"vcf.freq":700,"vcf.res":.15,"vcf.env":.55,"vcf.kybd":.6,"env.attack":.07,"env.decay":.4,"env.sustain":.65,"env.release":.2,"chorus.i":1}),P(`Brass 2`,{"dco.pwm":.35,"dco.pulse":1,"dco.saw":1,"vcf.freq":600,"vcf.res":.25,"vcf.env":.6,"env.attack":.12,"env.decay":.5,"env.sustain":.55,"env.release":.25,"chorus.ii":1}),P(`Strings`,{"dco.pulse":0,"dco.saw":1,"dco.sub":.1,"hpf.freq":`2`,"vcf.freq":2600,"vcf.res":.05,"vcf.env":.1,"env.attack":.35,"env.decay":1,"env.sustain":.85,"env.release":.6,"chorus.i":1,"chorus.ii":1}),P(`String Ensemble`,{"dco.pulse":1,"dco.saw":1,"dco.pwm":.6,"dco.pwmSource":`lfo`,"lfo.rate":.8,"dco.sub":.15,"hpf.freq":`2`,"vcf.freq":2200,"vcf.env":.1,"env.attack":.5,"env.decay":1,"env.sustain":.9,"env.release":.8,"chorus.i":1,"chorus.ii":1}),P(`Choir`,{"dco.pulse":1,"dco.saw":0,"dco.pwm":.3,"dco.sub":.3,"dco.noise":.04,"vcf.freq":1300,"vcf.res":.35,"vcf.env":.1,"env.attack":.45,"env.decay":.8,"env.sustain":.8,"env.release":.9,"chorus.ii":1}),P(`Warm Pad`,{"dco.sub":.4,"vcf.freq":900,"vcf.res":.1,"vcf.env":.15,"vcf.lfo":.1,"lfo.rate":.3,"env.attack":.9,"env.decay":1.5,"env.sustain":.8,"env.release":1.4,"chorus.i":1}),P(`Slow Pad`,{"dco.pwmSource":`lfo`,"dco.pwm":.5,"lfo.rate":.2,"dco.sub":.25,"vcf.freq":1500,"vcf.res":.2,"vcf.env":.3,"env.attack":1.6,"env.decay":2,"env.sustain":.85,"env.release":2.2,"chorus.i":1,"chorus.ii":1}),P(`Sweep Pad`,{"vcf.freq":400,"vcf.res":.55,"vcf.env":.7,"vcf.lfo":.25,"lfo.rate":.15,"env.attack":1.2,"env.decay":2.5,"env.sustain":.7,"env.release":1.8,"chorus.ii":1}),P(`Sub Bass`,{"dco.range":`16`,"dco.pulse":0,"dco.saw":1,"dco.sub":.8,"vcf.freq":350,"vcf.res":.1,"vcf.env":.3,"vcf.kybd":.2,"env.attack":.003,"env.decay":.3,"env.sustain":.8,"env.release":.12,"master.portamento":.05}),P(`Saw Bass`,{"dco.range":`16`,"dco.pulse":0,"dco.sub":.5,"hpf.freq":`1`,"vcf.freq":500,"vcf.res":.3,"vcf.env":.55,"vcf.kybd":.3,"env.attack":.002,"env.decay":.25,"env.sustain":.4,"env.release":.12}),P(`Pluck Bass`,{"dco.range":`16`,"dco.pulse":1,"dco.saw":0,"dco.pwm":.4,"dco.sub":.6,"vcf.freq":300,"vcf.res":.4,"vcf.env":.7,"vcf.kybd":.4,"env.attack":.001,"env.decay":.22,"env.sustain":0,"env.release":.15}),P(`Lead Saw`,{"dco.pulse":0,"dco.sub":.1,"vcf.freq":2400,"vcf.res":.3,"vcf.env":.25,"vcf.kybd":.8,"dco.lfo":.12,"lfo.rate":5.5,"lfo.delay":.6,"env.attack":.01,"env.decay":.3,"env.sustain":.85,"env.release":.2,"master.portamento":.15,"assign.mode":`unison`,"chorus.i":1}),P(`Lead Pulse`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.55,"dco.pwmSource":`lfo`,"lfo.rate":3,"dco.sub":.2,"vcf.freq":2e3,"vcf.res":.35,"vcf.env":.3,"vcf.kybd":.8,"env.attack":.01,"env.decay":.3,"env.sustain":.8,"env.release":.2,"assign.mode":`unison`,"chorus.ii":1}),P(`Whistle Lead`,{"dco.range":`4`,"dco.saw":0,"dco.pulse":1,"dco.pwm":.1,"dco.sub":0,"hpf.freq":`2`,"vcf.freq":3800,"vcf.res":.2,"vcf.env":.1,"dco.lfo":.1,"lfo.rate":5,"lfo.delay":.9,"env.attack":.04,"env.decay":.3,"env.sustain":.9,"env.release":.25,"master.portamento":.25,"assign.mode":`unison`}),P(`Organ`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":0,"dco.sub":.7,"hpf.freq":`2`,"vcf.freq":6e3,"vcf.res":0,"vcf.env":0,"vca.mode":`gate`,"chorus.i":1,"chorus.ii":1}),P(`Clav`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.25,"dco.sub":0,"hpf.freq":`3`,"vcf.freq":1500,"vcf.res":.35,"vcf.env":.55,"vcf.kybd":.9,"env.attack":.001,"env.decay":.18,"env.sustain":0,"env.release":.12}),P(`Pluck`,{"dco.pulse":0,"dco.sub":.2,"vcf.freq":700,"vcf.res":.3,"vcf.env":.6,"env.attack":.001,"env.decay":.35,"env.sustain":0,"env.release":.3,"chorus.i":1}),P(`Harp`,{"dco.range":`4`,"dco.pulse":0,"dco.sub":0,"vcf.freq":1500,"vcf.res":.15,"vcf.env":.35,"env.attack":.001,"env.decay":1.2,"env.sustain":0,"env.release":1,"chorus.ii":1}),P(`Bell Pad`,{"dco.range":`4`,"dco.saw":0,"dco.pulse":1,"dco.pwm":.7,"dco.pwmSource":`lfo`,"lfo.rate":6,"dco.sub":0,"vcf.freq":2500,"vcf.res":.45,"vcf.env":.4,"env.attack":.002,"env.decay":1.6,"env.sustain":.1,"env.release":1.5,"chorus.i":1,"chorus.ii":1}),P(`Noise Sweep`,{"dco.pulse":0,"dco.saw":0,"dco.sub":0,"dco.noise":.8,"hpf.freq":`2`,"vcf.freq":300,"vcf.res":.6,"vcf.env":.8,"env.attack":1.4,"env.decay":1.5,"env.sustain":.1,"env.release":1.2,"chorus.ii":1}),P(`Wind`,{"dco.pulse":0,"dco.saw":0,"dco.sub":0,"dco.noise":.9,"vcf.freq":900,"vcf.res":.55,"vcf.env":.2,"vcf.lfo":.3,"lfo.rate":.25,"vcf.kybd":1,"env.attack":1,"env.decay":1,"env.sustain":.9,"env.release":1.5,"chorus.i":1}),P(`Vibes`,{"dco.range":`4`,"dco.pulse":0,"dco.sub":0,"dco.lfo":.05,"lfo.rate":6,"vcf.freq":2400,"vcf.res":.1,"vcf.env":.2,"env.attack":.002,"env.decay":1.4,"env.sustain":0,"env.release":.9,"chorus.ii":1}),P(`Glass`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.8,"dco.pwmSource":`lfo`,"lfo.rate":.5,"dco.sub":0,"dco.noise":.03,"hpf.freq":`2`,"vcf.freq":4e3,"vcf.res":.25,"vcf.env":.1,"env.attack":.6,"env.decay":1.5,"env.sustain":.7,"env.release":1.6,"chorus.i":1,"chorus.ii":1}),P(`Funk Stab`,{"dco.sub":.3,"hpf.freq":`2`,"vcf.freq":500,"vcf.res":.25,"vcf.env":.65,"vcf.kybd":.7,"env.attack":.001,"env.decay":.16,"env.sustain":0,"env.release":.08,"chorus.ii":1})],St=Array.from({length:yt},(e,t)=>xt[t]??P(`Init`,{})),Ct=[`poly`,`mono`,`unison`],wt=class{count;mode=`poly`;prefer=`oldest`;voices;held=[];clock=0;constructor(e){this.count=e,this.voices=Array.from({length:e},()=>({gate:!1,since:0}))}isActive(e){return this.voices[e].gate}get activeCount(){return this.voices.filter(e=>e.gate).length}noteOn(e){return this.mode===`poly`?this.polyOn(e):this.stackOn(e)}noteOff(e){return this.mode===`poly`?this.polyOff(e):this.stackOff(e)}releaseAll(){this.held=[];let e=[];return this.voices.forEach((t,n)=>{t.gate&&(t.gate=!1,t.since=++this.clock,e.push({kind:`off`,voice:n}))}),e}get active(){return this.mode===`mono`?[0]:this.voices.map((e,t)=>t)}polyOn(e){let t=this.voices.findIndex(t=>t.gate&&t.note===e);if(t<0){let e=this.voices.map((e,t)=>({v:e,i:t})).filter(e=>!e.v.gate),n=e.length?e:this.voices.map((e,t)=>({v:e,i:t}));t=this.prefer===`lowest`&&e.length?e[0].i:n.reduce((e,t)=>t.v.since<e.v.since?t:e).i}let n=this.voices[t];return n.note=e,n.gate=!0,n.since=++this.clock,[{kind:`on`,voice:t,note:e,retrigger:!0,glide:!0}]}polyOff(e){let t=[];return this.voices.forEach((n,r)=>{n.gate&&n.note===e&&(n.gate=!1,n.since=++this.clock,t.push({kind:`off`,voice:r}))}),t}stackOn(e){let t=this.voices[this.active[0]].gate;return this.held=this.held.filter(t=>t!==e),this.held.push(e),this.play(e,!t,t)}stackOff(e){this.held=this.held.filter(t=>t!==e);let t=this.held[this.held.length-1];if(t!==void 0)return this.play(t,!1,!0);let n=[];for(let e of this.active){let t=this.voices[e];t.gate&&(t.gate=!1,t.since=++this.clock,n.push({kind:`off`,voice:e}))}return n}play(e,t,n){return this.active.map(r=>{let i=this.voices[r],a=t||!i.gate;return i.note=e,i.gate=!0,i.since=++this.clock,{kind:`on`,voice:r,note:e,retrigger:a,glide:n&&!a}})}},Tt=[`poly1`,`poly2`,`unison`],Et=[`16`,`8`,`4`],Dt=[`0`,`1`,`2`,`3`],Ot=[`-2`,`-1`,`0`,`1`,`2`],kt=1200,At=69,jt=1,Mt=64,Nt=.65,Pt=12,Ft={poly:.4,unison:.3},It=[10,10,240,720],Lt={16:-1200,8:0,4:kt},F={i:{rate:.5,depth:.0013},ii:{rate:.83,depth:.0013},both:{rate:9,depth:25e-5}},Rt=class extends S{name;transport;slots=[...St];currentSlot=0;currentPreset=this.slots[0];group=0;bank=1;manualState=!0;manualSnapshot;allocator=new wt(6);held=[];sounding=new Map;latched=new Set;pedal=!1;bend=0;modWheelValue=0;portamento=0;bendSemitones=2;bendFilter=.2;lfoSensitivity=.3;lfoDepthCents=0;pwmSource=`man`;pwm=.5;envDepth=.4;envSign=1;lfoTrig=!1;chorusI=!1;chorusII=!1;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`Lynch`,t=new x){super(),this.name=e,this.transport=new D(t),this.transport.channel.set(`omni`);let n=this.circuit;this.addShared(n);for(let e=0;e<6;e++)this.addVoice(n,e);this.addOutput(n),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`}),this.addControls(n)}keyDown(e){let t=e+Number(this.control(`key.transpose`).value)*12;this.held=this.held.filter(t=>t!==e),this.held.push(e),this.latched.delete(e),this.sounding.set(e,t),this.apply(this.allocator.noteOn(t)),this.updateLfoGate(),this.notifyNotes()}keyUp(e){let t=this.sounding.get(e);t!==void 0&&(this.holding?this.latched.add(e):this.release(e,t))}release(e,t){this.sounding.delete(e),this.latched.delete(e),this.held=this.held.filter(t=>t!==e),this.apply(this.allocator.noteOff(t)),this.updateLfoGate(),this.notifyNotes()}get holding(){return this.pedal||this.control(`key.hold`).value}releaseLatched(){for(let e of[...this.latched]){let t=this.sounding.get(e);t!==void 0&&this.release(e,t)}}releaseAll(){this.apply(this.allocator.releaseAll()),this.held=[],this.sounding.clear(),this.latched.clear(),this.updateLfoGate(),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}voiceActive(e){return this.allocator.isActive(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*this.bendSemitones*100),this.circuit.setParam(`bendVcf`,`offset`,this.bend*this.bendFilter*2400),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`lfoPitchMod`,`gain`,this.modWheelValue*this.lfoSensitivity*200),this.updateLfoGate(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}updateLfoGate(){let e=this.lfoTrig?this.modWheelValue>.05:this.held.length>0;this.circuit.setParam(`lfoFade`,`gate`,+!!e)}handleMidi(e){if(e.type!==`clock`&&`channel`in e&&this.transport.acceptsChannel(e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===jt?this.setModWheel(e.value/127):e.controller===Mt&&(this.pedal=e.value>=64,this.pedal||this.releaseLatched());break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}get manual(){return this.manualState}get patchNumber(){let e=this.currentSlot%64;return{group:Math.floor(this.currentSlot/64),bank:Math.floor(e/8)+1,patch:e%8+1}}selectGroup(e){this.group=Math.min(vt.length-1,Math.max(0,e)),this.notifyPreset()}selectBank(e){this.bank=Math.min(8,Math.max(1,e)),this.notifyPreset()}selectPatch(e){this.loadSlot(bt(this.group,this.bank,e))}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.manualState&&(this.manualSnapshot=this.snapshot()),this.manualState=!1,this.currentSlot=e;let{group:n,bank:r}=this.patchNumber;this.group=n,this.bank=r,this.loadPreset(t)}selectManual(){this.manualState||(this.manualState=!0,this.manualSnapshot&&this.applyValues(this.manualSnapshot),this.notifyPreset())}loadPreset(e){this.currentPreset=e,this.applyValues({...gt,...e.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){if(_t.includes(t))continue;let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)_t.includes(t.id)||(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}write(e=bt(this.group,this.bank,this.patchNumber.patch)){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.manualState=!1,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}apply(e){let t=this.circuit;for(let n of e){let e=e=>`v${n.voice}.${e}`;n.kind===`off`?(t.setParam(e(`env`),`gate`,0),t.setParam(e(`gate`),`gate`,0)):(t.setParam(e(`pitch`),`offset`,(n.note-At)*100),n.retrigger&&(t.setParam(e(`env`),`gate`,1),t.setParam(e(`gate`),`gate`,1)))}}eachVoice(e){for(let t=0;t<6;t++)e(e=>`v${t}.${e}`)}applyMode(e){this.releaseAll(),this.allocator.mode=e===`unison`?`unison`:`poly`,this.allocator.prefer=e===`poly2`?`lowest`:`oldest`;let t=e===`unison`?Ft.unison:Ft.poly;this.eachVoice(e=>this.circuit.setParam(e(`out`),`gain`,t));let n=e===`unison`?Pt:0,r=5/2;for(let e=0;e<6;e++){let t=(e-r)/r*n;this.circuit.setParam(`v${e}.det`,`offset`,t===0?0:t)}}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyPreset(){for(let e of this.presetListeners)e()}addShared(e){e.add(`bend`,`constant`,{offset:0}).add(`tune`,`constant`,{offset:0}).add(`rangeShift`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:-1200}).add(`pwCv`,`constant`,{offset:0}).add(`bendVcf`,`constant`,{offset:0}).add(`lfoOsc`,`oscillator`,{frequency:5,detune:0},{waveform:`triangle`}).add(`lfoFade`,`envelope`,{attack:.001,decay:.001,sustain:1,release:.02,gate:0}).add(`lfoFadeGain`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPitchMod`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0}).add(`noise`,`noise`).add(`voices`,`gain`,{gain:1}).connect(`lfoOsc`,`lfoFadeGain`).connect(`lfoFade`,`lfoFadeGain`,`gain`).connect(`lfoFadeGain`,`lfo`);for(let t of[`lfoPitch`,`lfoPitchMod`,`lfoPw`,`lfoFilter`])e.connect(`lfo`,t)}addVoice(e,t){let n=e=>`v${t}.${e}`;e.add(n(`pitch`),`constant`,{offset:0,glide:0}).add(n(`det`),`constant`,{offset:0}).add(n(`osc`),`oscillator`,{frequency:440,detune:0},{waveform:`sawtooth`}).add(n(`sub`),`oscillator`,{frequency:440,detune:0},{waveform:`square`}).add(n(`rawOut`),`gain`,{gain:1}).add(n(`pulseSum`),`gain`,{gain:1}).add(n(`shaper`),`waveshaper`,{},{curve:`pulse`}).add(n(`pulseOut`),`gain`,{gain:Nt}).add(n(`subLevel`),`gain`,{gain:0}).add(n(`noiseLevel`),`gain`,{gain:0}).add(n(`mix`),`gain`,{gain:.5}).add(n(`boost`),`filter`,{frequency:120,Q:.707,gain:0,detune:0},{type:`lowshelf`}).add(n(`hpf`),`filter`,{frequency:10,Q:.707,gain:0,detune:0},{type:`highpass`}).add(n(`f1`),`filter`,{frequency:3e3,Q:1,detune:0},{type:`lowpass`}).add(n(`f2`),`filter`,{frequency:3e3,Q:.707,detune:0},{type:`lowpass`}).add(n(`keyFollow`),`gain`,{gain:.5}).add(n(`env`),`envelope`,{attack:.005,decay:.4,sustain:.6,release:.3,gate:0}).add(n(`envDepth`),`gain`,{gain:.4*6*kt}).add(n(`gate`),`envelope`,{attack:.003,decay:.001,sustain:1,release:.015,gate:0}).add(n(`envAmp`),`gain`,{gain:1}).add(n(`gateAmp`),`gain`,{gain:0}).add(n(`amp`),`gain`,{gain:0}).add(n(`out`),`gain`,{gain:Ft.poly});for(let t of[`osc`,`sub`])for(let r of[n(`pitch`),n(`det`),`bend`,`tune`,`rangeShift`,`lfoPitch`,`lfoPitchMod`])e.connect(r,n(t),`detune`);e.connect(`subShift`,n(`sub`),`detune`).connect(n(`osc`),n(`rawOut`)).connect(n(`osc`),n(`pulseSum`)).connect(`pwCv`,n(`pulseSum`)).connect(`lfoPw`,n(`pulseSum`)).connect(n(`pulseSum`),n(`shaper`)).connect(n(`shaper`),n(`pulseOut`)).connect(n(`rawOut`),n(`mix`)).connect(n(`pulseOut`),n(`mix`)).connect(n(`sub`),n(`subLevel`)).connect(n(`subLevel`),n(`mix`)).connect(`noise`,n(`noiseLevel`)).connect(n(`noiseLevel`),n(`mix`)).connect(n(`mix`),n(`boost`)).connect(n(`boost`),n(`hpf`)).connect(n(`hpf`),n(`f1`)).connect(n(`f1`),n(`f2`)).connect(n(`f2`),n(`amp`)).connect(n(`env`),n(`envDepth`)).connect(n(`pitch`),n(`keyFollow`));for(let t of[`f1`,`f2`])e.connect(n(`envDepth`),n(t),`detune`).connect(n(`keyFollow`),n(t),`detune`).connect(`lfoFilter`,n(t),`detune`).connect(`bendVcf`,n(t),`detune`);e.connect(n(`env`),n(`envAmp`)).connect(n(`envAmp`),n(`amp`),`gain`).connect(n(`gate`),n(`gateAmp`)).connect(n(`gateAmp`),n(`amp`),`gain`).connect(n(`amp`),n(`out`)).connect(n(`out`),`voices`)}addOutput(e){e.add(`chDry`,`gain`,{gain:1}).add(`chLfo`,`oscillator`,{frequency:.5,detune:0},{waveform:`triangle`}).add(`chDelayL`,`delay`,{delayTime:.0035,maxTime:.02}).add(`chDelayR`,`delay`,{delayTime:.0035,maxTime:.02}).add(`chDepthL`,`gain`,{gain:F.i.depth}).add(`chDepthR`,`gain`,{gain:-F.i.depth}).add(`chToneL`,`filter`,{frequency:9e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`chToneR`,`filter`,{frequency:9e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`chPanL`,`pan`,{pan:-1}).add(`chPanR`,`pan`,{pan:1}).add(`chWet`,`gain`,{gain:0}).add(`chSum`,`gain`,{gain:1}).add(`vcaLevel`,`gain`,{gain:.8}).add(`volume`,`gain`,{gain:.75}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`voices`,`chDry`).connect(`chDry`,`chSum`).connect(`voices`,`chDelayL`).connect(`voices`,`chDelayR`).connect(`chDelayL`,`chToneL`).connect(`chDelayR`,`chToneR`).connect(`chToneL`,`chPanL`).connect(`chToneR`,`chPanR`).connect(`chPanL`,`chWet`).connect(`chPanR`,`chWet`).connect(`chWet`,`chSum`).connect(`chLfo`,`chDepthL`).connect(`chLfo`,`chDepthR`).connect(`chDepthL`,`chDelayL`,`delayTime`).connect(`chDepthR`,`chDelayR`,`delayTime`).connect(`chSum`,`vcaLevel`).connect(`vcaLevel`,`volume`).connect(`volume`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`)}addControls(e){let t=gt,n=e=>t[e],r=(e,t,r,i,a,o,s)=>this.controlList.push(new C(e,t,r,i,n(e),a,o,s)),i=e=>t=>this.eachVoice(n=>e(n,t)),a=(e,t,r)=>this.controlList.push(new T(e,t,n(e)>0,r)),o=(e,n,r,i)=>this.controlList.push(new w(e,n,r,t[e],i));r(`lfo.rate`,`Rate`,.1,30,`Hz`,t=>e.setParam(`lfoOsc`,`frequency`,t),`log`),r(`lfo.delay`,`Delay time`,0,3,`s`,t=>e.setParam(`lfoFade`,`attack`,Math.max(.001,t))),r(`dco.lfo`,`LFO`,0,1,``,t=>{this.lfoDepthCents=t*150,e.setParam(`lfoPitch`,`gain`,this.lfoDepthCents)}),r(`dco.pwm`,`PWM`,0,1,``,e=>{this.pwm=e,this.applyPulseWidth()}),o(`dco.pwmSource`,`PWM source`,[`man`,`lfo`],e=>{this.pwmSource=e,this.applyPulseWidth()}),o(`dco.range`,`Range`,Et,t=>e.setParam(`rangeShift`,`offset`,Lt[t])),a(`dco.pulse`,`Pulse`,t=>this.eachVoice(n=>e.setParam(n(`pulseOut`),`gain`,t?Nt:0))),a(`dco.saw`,`Saw`,t=>this.eachVoice(n=>e.setParam(n(`rawOut`),`gain`,+!!t))),r(`dco.sub`,`Sub`,0,1,``,i((t,n)=>e.setParam(t(`subLevel`),`gain`,n*.6))),r(`dco.noise`,`Noise`,0,1,``,i((t,n)=>e.setParam(t(`noiseLevel`),`gain`,n*.5))),o(`hpf.freq`,`HPF`,Dt,t=>{let n=Number(t);this.eachVoice(t=>{e.setParam(t(`boost`),`gain`,n===0?6:0),e.setParam(t(`hpf`),`frequency`,It[n])})}),r(`vcf.freq`,`Freq`,20,2e4,`Hz`,i((t,n)=>{e.setParam(t(`f1`),`frequency`,n),e.setParam(t(`f2`),`frequency`,n)}),`log`),r(`vcf.res`,`Res`,0,1,``,i((t,n)=>e.setParam(t(`f1`),`Q`,.5*32**n))),r(`vcf.env`,`Env`,0,1,``,e=>{this.envDepth=e,this.applyEnvDepth()}),o(`vcf.polarity`,`Env polarity`,[`plus`,`minus`],e=>{this.envSign=e===`minus`?-1:1,this.applyEnvDepth()}),r(`vcf.lfo`,`LFO`,0,1,``,t=>e.setParam(`lfoFilter`,`gain`,t*3*kt)),r(`vcf.kybd`,`Kybd`,0,1,``,i((t,n)=>e.setParam(t(`keyFollow`),`gain`,n))),o(`vca.mode`,`VCA`,[`env`,`gate`],t=>this.eachVoice(n=>{e.setParam(n(`envAmp`),`gain`,+(t===`env`)),e.setParam(n(`gateAmp`),`gain`,+(t===`gate`))})),r(`vca.level`,`Level`,0,1,``,t=>e.setParam(`vcaLevel`,`gain`,t));let s=(t,n,a,o)=>r(`env.${t}`,n,a,o,`s`,i((n,r)=>e.setParam(n(`env`),t,r)),`log`);s(`attack`,`A`,.001,3),s(`decay`,`D`,.002,12),r(`env.sustain`,`S`,0,1,``,i((t,n)=>e.setParam(t(`env`),`sustain`,n))),s(`release`,`R`,.002,12),a(`chorus.i`,`Chorus I`,e=>{this.chorusI=e,this.applyChorus()}),a(`chorus.ii`,`Chorus II`,e=>{this.chorusII=e,this.applyChorus()}),r(`bend.dco`,`Bender DCO`,0,12,`st`,e=>{this.bendSemitones=e,this.setPitchBend(this.bend)}),r(`bend.vcf`,`Bender VCF`,0,1,``,e=>{this.bendFilter=e,this.setPitchBend(this.bend)}),r(`bend.lfo`,`Bender LFO`,0,1,``,e=>{this.lfoSensitivity=e,this.setModWheel(this.modWheelValue)}),a(`bend.lfoTrig`,`LFO trig`,e=>{this.lfoTrig=e,this.updateLfoGate()}),r(`master.portamento`,`Portamento`,0,1,``,t=>{this.portamento=t;let n=t*t*2.5;this.eachVoice(t=>e.setParam(t(`pitch`),`glide`,n))}),o(`assign.mode`,`Assign`,Tt,e=>this.applyMode(e)),r(`master.tune`,`Tune`,-50,50,`ct`,t=>e.setParam(`tune`,`offset`,t)),r(`master.volume`,`Volume`,0,1,``,t=>e.setParam(`volume`,`gain`,t)),a(`key.hold`,`Hold`,e=>{e||this.releaseLatched()}),o(`key.transpose`,`Key transpose`,Ot,()=>{})}applyPulseWidth(){let e=this.circuit;this.pwmSource===`man`?(e.setParam(`pwCv`,`offset`,1-2*((50-this.pwm*45)/100)),e.setParam(`lfoPw`,`gain`,0)):(e.setParam(`pwCv`,`offset`,0),e.setParam(`lfoPw`,`gain`,this.pwm*.9))}applyEnvDepth(){this.eachVoice(e=>this.circuit.setParam(e(`envDepth`),`gain`,this.envSign*this.envDepth*6*kt))}applyChorus(){let e=this.circuit,t=this.chorusI,n=this.chorusII,r=t&&n?F.both:t?F.i:n?F.ii:void 0,i=r!==void 0,a=r??F.i;e.setParam(`chLfo`,`frequency`,a.rate),e.setParam(`chDepthL`,`gain`,a.depth),e.setParam(`chDepthR`,`gain`,-a.depth),e.setParam(`chWet`,`gain`,i?.7:0),e.setParam(`chDry`,`gain`,i?.75:1)}},zt={"env.attack":1,"env.decay":30,"env.sustain":0,"env.release":200,"env.keytrack":0,"env.velocity":.5,"env.legato":0,"gen.noise":1,"gen.cutoff":100,"gen.reso":.2,"gen.keytrack":.5,"gen.envAmt":0,"gen.onePole":0,"gen.gain":1.5,"fb.push":0,"fb.decay":2,"fb.release":.4,"sat.hardness":.3,"sat.symmetry":0,"patch.volume":.8,"delay.tune":0,"delay.fine":0,"delay.harmonics":0,"delay.split":0,"delay.splitPoint":.5,"delay.polarity":0,"filter.highpass":-36,"filter.lowpass":36,"filter.hpComp":1,"filter.lpComp":1,"voice.mode":`poly`,"voice.detune":12,"voice.glide":100,"voice.glideOn":0,"lfo.wave":`sine`,"lfo.rate":5,"lfo.sync":0,"lfo.division":`1/8`,"lfo.delay":0,"lfo.amount":0,"lfo.dest":`pitch`,"rev.mix":.25,"rev.bass":120,"rev.treble":8e3,"rev.size":`medium`,"rev.spread":.5},I=(e,t)=>({name:e,values:t}),L={"env.attack":60,"env.decay":200,"env.sustain":1,"env.release":250,"gen.noise":.06,"gen.gain":.3,"fb.push":1.2,"fb.decay":4,"fb.release":.3,"sat.hardness":.1,"filter.highpass":-36,"filter.lowpass":30},R={"gen.gain":1.9},Bt=[[I(`Nylon Pluck`,{...R,"gen.cutoff":90,"gen.keytrack":.7,"fb.decay":1.8,"fb.release":.25,"filter.lowpass":30,"sat.hardness":.2,"rev.mix":.2}),I(`Steel String`,{...R,"gen.cutoff":120,"delay.harmonics":.12,"fb.decay":3.5,"fb.release":.35,"filter.lowpass":48,"sat.hardness":.4,"env.velocity":.7}),I(`Muted Bass`,{...R,"delay.tune":-12,"gen.cutoff":70,"gen.keytrack":.2,"fb.decay":.9,"fb.release":.15,"filter.lowpass":18,"filter.highpass":-48,"voice.mode":`mono`,"rev.mix":.08,"patch.volume":1}),I(`Harp`,{...R,"gen.cutoff":100,"gen.keytrack":.6,"delay.harmonics":.05,"fb.decay":5,"fb.release":.6,"filter.lowpass":36,"rev.size":`large`,"rev.mix":.35}),I(`Marimba`,{...R,"env.attack":1,"env.decay":20,"gen.cutoff":80,"delay.split":1,"delay.splitPoint":.4,"delay.harmonics":.4,"fb.decay":.7,"fb.release":.2,"filter.lowpass":24,"filter.highpass":-48,"rev.mix":.15}),I(`Glass Bell`,{...R,"delay.tune":12,"delay.split":1,"delay.splitPoint":.3,"delay.harmonics":.6,"fb.decay":6,"fb.release":2,"sat.hardness":.1,"filter.lowpass":60,"filter.highpass":-48,"rev.size":`large`,"rev.mix":.4}),I(`Wood Block`,{...R,"env.decay":15,"gen.gain":2,"delay.split":1,"delay.splitPoint":.5,"delay.harmonics":.2,"fb.decay":.25,"fb.release":.1,"filter.lowpass":40,"filter.highpass":-24,"rev.mix":.1}),I(`Kalimba`,{...R,"delay.tune":12,"gen.noise":.8,"delay.split":1,"delay.splitPoint":.6,"delay.harmonics":.3,"fb.decay":1.2,"fb.release":.3,"filter.lowpass":42,"filter.highpass":-48,"rev.mix":.3})],[I(`Pan Flute`,{...L,"delay.polarity":1,"voice.mode":`mono`,"env.legato":1,"voice.glideOn":1,"voice.glide":60,"lfo.amount":.12,"lfo.rate":5,"lfo.delay":.6,"lfo.dest":`pitch`,"rev.mix":.3}),I(`Clarinet`,{...L,"delay.polarity":1,"gen.noise":.1,"gen.gain":.35,"env.attack":30,"sat.hardness":.5,"filter.lowpass":36,"voice.mode":`mono`,"env.legato":1,"rev.mix":.2}),I(`Reed Organ`,{...L,"gen.noise":.08,"env.attack":40,"env.release":200,"sat.hardness":.6,"sat.symmetry":.2,"filter.lowpass":40,"rev.mix":.25}),I(`Pipe Organ`,{...L,"gen.noise":.05,"env.attack":80,"env.release":500,"filter.lowpass":24,"rev.size":`large`,"rev.mix":.45}),I(`Brass`,{...L,"gen.noise":.1,"gen.gain":.5,"env.attack":80,"env.decay":200,"env.sustain":.7,"sat.hardness":.7,"sat.symmetry":.6,"filter.lowpass":42,"lfo.dest":`filter`,"lfo.amount":.1,"lfo.rate":6,"rev.mix":.2}),I(`Overblown`,{...L,"delay.polarity":1,"lfo.dest":`filter`,"lfo.amount":.6,"lfo.rate":.3,"lfo.wave":`sine`,"rev.mix":.3}),I(`Steam Drone`,{...L,"env.attack":1500,"env.release":3e3,"gen.noise":.2,"fb.decay":20,"fb.release":3,"voice.mode":`unison`,"voice.detune":25,"rev.size":`large`,"rev.mix":.5,"rev.spread":1}),I(`Wind Chimes`,{"delay.tune":12,"delay.split":1,"delay.splitPoint":.2,"delay.harmonics":.5,"fb.decay":8,"fb.release":4,"filter.lowpass":54,"filter.highpass":-48,"sat.hardness":.05,"rev.size":`large`,"rev.mix":.5,"rev.spread":1})]].flat(),Vt=[`poly`,`mono`,`unison`],Ht=[`sine`,`tri`,`sqr`,`ramp`,`rnd`],Ut=[`pitch`,`filter`,`steam`,`sat`,`push`],Wt=[`1/1`,`1/2`,`1/4`,`1/8`,`1/16`,`1/32`],Gt=1,Kt=64,qt=2,Jt=.8,Yt=3,Xt=class extends S{name;transport;slots=[...Bt];currentSlot=0;currentPreset=this.slots[0];held=[];bend=0;modWheelValue=0;lfoHz=5;lfoSync=!1;lfoDivision=`1/8`;clockPulses=0;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`Pipe`,t=new x){super(),this.name=e,this.transport=new D(t),this.transport.channel.set(`omni`),this.circuit.add(`pipe`,`pipe`,{atk:.001,dec:.03,sus:0,rel:.2,envKey:0,vel:.5,legato:0,noise:1,nCut:100,nRes:.2,nKey:.5,nEnv:0,onePole:0,gain:.8,tune:0,fine:0,harm:0,split:0,splitPt:.5,pol:0,fbDec:2,fbRel:.4,push:0,satHard:.3,satSym:0,hp:-36,lp:36,hpComp:1,lpComp:1,mode:0,detune:12,glide:.1,glideOn:0,spread:.5,volume:.8,lfoRate:5,lfoShape:0,lfoDelay:0,lfoAmt:0,lfoDest:0,bend:0,mod:0}).add(`dry`,`gain`,{gain:1}).add(`revIn`,`gain`,{gain:1}).add(`conv`,`convolver`,{},{size:`medium`}).add(`revLow`,`filter`,{frequency:120,Q:.707,detune:0},{type:`highpass`}).add(`revHigh`,`filter`,{frequency:8e3,Q:.707,detune:0},{type:`lowpass`}).add(`wet`,`gain`,{gain:0}).add(`sum`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`pipe`,`dry`).connect(`pipe`,`revIn`).connect(`revIn`,`conv`).connect(`conv`,`revLow`).connect(`revLow`,`revHigh`).connect(`revHigh`,`wet`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`}),this.addControls(),this.transport.tempo.onChange(()=>this.applyLfoRate())}addControls(){let e=this.circuit,t=zt,n=(e,n,r,i,a,o,s)=>this.controlList.push(new C(e,n,r,i,t[e],a,o,s)),r=(t,r,i,a,o,s,c=1,l)=>n(t,r,i,a,o,t=>e.setParam(`pipe`,s,t*c),l),i=(n,r,i)=>this.controlList.push(new T(n,r,(t[n]??0)>0,t=>e.setParam(`pipe`,i,+!!t)));r(`env.attack`,`Attack`,.5,1e4,`ms`,`atk`,1/1e3,`log`),r(`env.decay`,`Decay`,1,1e4,`ms`,`dec`,1/1e3,`log`),r(`env.sustain`,`Sustain`,0,1,``,`sus`),r(`env.release`,`Release`,5,2e4,`ms`,`rel`,1/1e3,`log`),r(`env.keytrack`,`Keytrack`,0,1,``,`envKey`),r(`env.velocity`,`Velocity`,0,1,``,`vel`),i(`env.legato`,`Legato`,`legato`),r(`gen.noise`,`DC / Noise`,0,1,``,`noise`),r(`gen.cutoff`,`Cutoff`,30,140,`pitch`,`nCut`),r(`gen.reso`,`Resonance`,0,1,``,`nRes`),r(`gen.keytrack`,`Keytrack`,0,1,``,`nKey`),r(`gen.envAmt`,`Env amount`,-48,48,`st`,`nEnv`),r(`gen.gain`,`Gain`,0,2,``,`gain`),i(`gen.onePole`,`1-pole`,`onePole`),r(`fb.push`,`Push`,0,1.5,``,`push`),r(`fb.decay`,`Decay`,.05,30,`s`,`fbDec`,1,`log`),r(`fb.release`,`Release`,.02,20,`s`,`fbRel`,1,`log`),r(`sat.hardness`,`Soft / Hard`,0,1,``,`satHard`),r(`sat.symmetry`,`Symmetry`,0,1,``,`satSym`),r(`patch.volume`,`Volume`,0,1.2,``,`volume`),r(`delay.tune`,`Tune`,-24,24,`st`,`tune`),r(`delay.fine`,`Fine`,-100,100,`ct`,`fine`),r(`delay.harmonics`,`Harmonics`,0,1,``,`harm`),r(`delay.splitPoint`,`Split point`,.05,.95,``,`splitPt`),i(`delay.split`,`Split`,`split`),i(`delay.polarity`,`Polarity`,`pol`),r(`filter.highpass`,`Highpass`,-60,36,`st`,`hp`),r(`filter.lowpass`,`Lowpass`,0,84,`st`,`lp`),r(`filter.hpComp`,`HP comp`,0,1,``,`hpComp`),r(`filter.lpComp`,`LP comp`,0,1,``,`lpComp`),this.controlList.push(new w(`voice.mode`,`Mode`,Vt,`poly`,t=>{this.releaseAll(),e.setParam(`pipe`,`mode`,Vt.indexOf(t))})),r(`voice.detune`,`Detune`,0,100,`ct`,`detune`),r(`voice.glide`,`Glide`,1,5e3,`ms`,`glide`,1/1e3,`log`),i(`voice.glideOn`,`Glide on`,`glideOn`),this.controlList.push(new w(`lfo.wave`,`Wave`,Ht,`sine`,t=>e.setParam(`pipe`,`lfoShape`,Ht.indexOf(t))),new w(`lfo.dest`,`Destination`,Ut,`pitch`,t=>e.setParam(`pipe`,`lfoDest`,Ut.indexOf(t))),new w(`lfo.division`,`Division`,Wt,`1/8`,e=>{this.lfoDivision=e,this.applyLfoRate()}),new T(`lfo.sync`,`Sync`,!1,e=>{this.lfoSync=e,this.applyLfoRate()})),n(`lfo.rate`,`Rate`,.05,40,`Hz`,e=>{this.lfoHz=e,this.applyLfoRate()},`log`),r(`lfo.delay`,`Delay`,0,5,`s`,`lfoDelay`),r(`lfo.amount`,`Amount`,0,1,``,`lfoAmt`),n(`rev.mix`,`Mix`,0,1,``,t=>{e.setParam(`dry`,`gain`,Math.cos(t*Math.PI/2)),e.setParam(`wet`,`gain`,Math.sin(t*Math.PI/2)*Yt)}),n(`rev.bass`,`Bass`,20,800,`Hz`,t=>e.setParam(`revLow`,`frequency`,t),`log`),n(`rev.treble`,`Treble`,1500,16e3,`Hz`,t=>e.setParam(`revHigh`,`frequency`,t),`log`),r(`rev.spread`,`Spread`,0,1,``,`spread`),this.controlList.push(new w(`rev.size`,`Size`,Ue,`medium`,t=>e.setOption(`conv`,`size`,t)))}applyLfoRate(){let e=Number(this.lfoDivision.split(`/`)[1]),t=this.lfoSync?this.transport.bpm/60*e/4:this.lfoHz;this.circuit.setParam(`pipe`,`lfoRate`,Math.min(40,Math.max(.05,t)))}releaseAll(){this.circuit.allNotesOff(`pipe`),this.held.length>0&&(this.held=[],this.notifyNotes())}keyDown(e,t=Jt){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.circuit.noteOn(`pipe`,e,t),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.circuit.noteOff(`pipe`,e),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}setSustain(e){this.circuit.pedal(`pipe`,e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`pipe`,`bend`,this.bend*qt),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`pipe`,`mod`,this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(e.type===`clock`)this.lfoSync&&this.transport.synced&&++this.clockPulses%24==0&&this.applyLfoRate();else if(`channel`in e&&this.transport.acceptsChannel(e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity/127);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===Gt?this.setModWheel(e.value/127):e.controller===Kt&&this.setSustain(e.value>=64);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...zt,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}},Zt={"osc.wave":`saw`,"osc.width":50,"osc.pwm":0,"osc.vibrato":0,"osc.sub":.3,"filter.cutoff":2400,"filter.resonance":1,"filter.env":2,"filter.lfo":0,"filter.key":50,"amp.lfo":0,"amp.key":0,level:.7,"lfo.wave":`tri`,"lfo.rate":5,"lfo.sync":0,"lfo.division":`1/8`,"env1.attack":.005,"env1.decay":.4,"env1.sustain":.4,"env1.release":.4,"env2.attack":.005,"env2.decay":.3,"env2.sustain":.7,"env2.release":.35,"voices.mode":`poly`,"voices.portamento":0,"voices.detune":12,"fx.chorus":0,"fx.delayTime":.35,"fx.feedback":.3,"fx.mix":0},z=(e,t)=>({name:e,values:t}),Qt=[[z(`Soft Pad`,{"osc.sub":.2,"filter.cutoff":900,"filter.resonance":1.2,"filter.env":1.5,"filter.lfo":.3,"env1.attack":.6,"env1.decay":1.2,"env1.sustain":.5,"env1.release":1.5,"env2.attack":.5,"env2.decay":.8,"env2.sustain":.8,"env2.release":1.6,"lfo.rate":.4,"fx.chorus":.7,"fx.mix":.15,"fx.delayTime":.45,"fx.feedback":.35,level:.6}),z(`Warm Brass`,{"osc.sub":.3,"filter.cutoff":700,"filter.env":3.2,"osc.vibrato":8,"env1.attack":.12,"env1.decay":.5,"env1.sustain":.55,"env1.release":.25,"env2.attack":.06,"env2.decay":.3,"env2.sustain":.85,"env2.release":.2,"fx.chorus":.3}),z(`Pluck Bass`,{"voices.mode":`mono`,"osc.sub":.6,"filter.cutoff":350,"filter.resonance":4,"filter.env":3.5,"env1.attack":.001,"env1.decay":.22,"env1.sustain":0,"env1.release":.15,"env2.attack":.001,"env2.decay":.35,"env2.sustain":.5,"env2.release":.1,"voices.portamento":.05}),z(`Glass Keys`,{"osc.wave":`tri`,"osc.sub":0,"filter.cutoff":5200,"filter.resonance":.5,"filter.env":.5,"env1.attack":.001,"env1.decay":.8,"env1.sustain":.2,"env1.release":.6,"env2.attack":.002,"env2.decay":1.2,"env2.sustain":.1,"env2.release":.8,"fx.chorus":.45,"fx.mix":.2,"fx.delayTime":.3,"fx.feedback":.4}),z(`Slow Strings`,{"filter.cutoff":3e3,"filter.env":.6,"filter.key":70,"osc.vibrato":12,"lfo.rate":5.5,"env1.attack":.8,"env1.decay":1,"env1.sustain":.7,"env1.release":1.2,"env2.attack":.9,"env2.decay":1,"env2.sustain":.9,"env2.release":1.4,"fx.chorus":.8}),z(`Sweep Lead`,{"voices.mode":`mono`,"osc.wave":`pulse`,"osc.width":30,"osc.pwm":.4,"osc.sub":.2,"lfo.rate":.7,"filter.cutoff":1500,"filter.resonance":5,"filter.env":2.5,"env1.attack":.001,"env1.decay":.8,"env1.sustain":.35,"env1.release":.3,"env2.sustain":.9,"voices.portamento":.12,"fx.mix":.3,"fx.delayTime":.4,"fx.feedback":.45}),z(`Wobble Sub`,{"voices.mode":`mono`,"osc.sub":.8,"filter.cutoff":260,"filter.resonance":6,"filter.lfo":2.2,"filter.env":.5,"lfo.sync":1,"lfo.division":`1/8`,"env2.sustain":.95,level:.55}),z(`Bell Pluck`,{"osc.wave":`tri`,"osc.sub":0,"filter.cutoff":8e3,"filter.resonance":.3,"filter.env":.2,"osc.vibrato":4,"env1.attack":.001,"env1.decay":.5,"env1.sustain":0,"env1.release":.4,"env2.attack":.001,"env2.decay":1.6,"env2.sustain":0,"env2.release":1.4,"fx.chorus":.3,"fx.mix":.3,"fx.delayTime":.5,"fx.feedback":.5})],[z(`Init`,{}),z(`Analog Poly`,{"filter.cutoff":1800,"filter.resonance":1.5,"filter.env":2,"env1.attack":.01,"env1.decay":.5,"env1.sustain":.35,"env1.release":.4,"env2.attack":.01,"env2.decay":.4,"env2.sustain":.75,"env2.release":.4,"fx.chorus":.35}),z(`Choir Air`,{"osc.wave":`pulse`,"osc.width":40,"osc.pwm":.2,"filter.cutoff":1600,"filter.resonance":2.5,"filter.env":1,"env2.attack":.35,"env2.decay":.6,"env2.sustain":.85,"env2.release":1.1,"fx.chorus":.6,"fx.mix":.2}),z(`Retro Stab`,{"filter.cutoff":600,"filter.resonance":2,"filter.env":4,"env1.attack":.001,"env1.decay":.22,"env1.sustain":0,"env1.release":.2,"env2.attack":.001,"env2.decay":.25,"env2.sustain":0,"env2.release":.2,"fx.chorus":.5}),z(`Fifth Lead`,{"voices.mode":`unison`,"voices.detune":18,"filter.cutoff":2600,"filter.resonance":2,"filter.env":1.5,"env2.sustain":.8,"voices.portamento":.08,"fx.mix":.25}),z(`Dream Wash`,{"osc.sub":.4,"filter.cutoff":1100,"lfo.rate":.3,"filter.lfo":.4,"env1.attack":1.8,"env1.decay":1,"env1.sustain":.6,"env1.release":2.5,"env2.attack":1.5,"env2.decay":1,"env2.sustain":.85,"env2.release":3,"fx.chorus":.9,"fx.mix":.4,"fx.delayTime":.6,"fx.feedback":.6,level:.55}),z(`Pulse Organ`,{"osc.wave":`pulse`,"osc.width":50,"osc.sub":.5,"filter.cutoff":3200,"filter.resonance":.5,"filter.env":.3,"osc.vibrato":6,"lfo.rate":6.5,"env2.attack":.005,"env2.decay":.1,"env2.sustain":1,"env2.release":.08,"fx.chorus":.3}),z(`Space Arp`,{"osc.wave":`pulse`,"osc.width":25,"osc.pwm":.6,"lfo.rate":1.2,"filter.cutoff":1e3,"filter.resonance":3,"filter.env":3,"env1.attack":.001,"env1.decay":.25,"env1.sustain":.1,"env1.release":.2,"env2.attack":.002,"env2.decay":.3,"env2.sustain":.2,"env2.release":.25,"fx.mix":.4,"fx.delayTime":.38,"fx.feedback":.55,"fx.chorus":.2})]],$t=Qt.flat(),en=1200,tn=69,nn=200,rn=100,an=1,on=[`saw`,`pulse`,`tri`],sn=[`tri`,`up`,`down`,`sqr`,`rnd`],cn=[`1/1`,`1/2`,`1/4`,`1/8`,`1/16`,`1/32`],ln={poly:.45,mono:.6,unison:.34},un=.65,dn=class extends S{name;transport;slots=[...$t];currentSlot=Qt[0].length;currentPreset=this.slots[this.currentSlot];allocator=new wt(6);held=[];bend=0;modWheelValue=0;vibratoCents=0;portamento=0;unisonDetune=12;lfoHz=5;lfoSync=!1;lfoDivision=`1/8`;clockPulses=0;performanceListeners=new Set;noteListeners=new Set;presetListeners=new Set;constructor(e=`Poly`,t=new x){super(),this.name=e,this.transport=new D(t),this.transport.channel.set(`2`);let n=this.circuit;this.addShared(n);for(let e=0;e<6;e++)this.addVoice(n,e);this.addEffects(n),this.outputList.push({name:`out`,nodeId:`level`}),this.addControls(n),this.transport.tempo.onChange(()=>this.applyLfoRate())}keyDown(e){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.apply(this.allocator.noteOn(e)),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.apply(this.allocator.noteOff(e)),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}voiceActive(e){return this.allocator.isActive(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*nn),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.applyVibrato(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(e.type===`clock`)this.lfoSync&&this.transport.synced&&++this.clockPulses%24==0&&this.applyLfoRate();else if(!(`channel`in e&&!this.transport.acceptsChannel(e.channel)))switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===an&&this.setModWheel(e.value/127);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...Zt,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e,t=this.slots[e].name){let n={name:t,values:this.snapshot()};this.slots[e]=n,this.currentSlot=e,this.currentPreset=n;for(let e of this.presetListeners)e();return n}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}apply(e){let t=this.circuit;for(let n of e){let e=e=>`v${n.voice}.${e}`;n.kind===`off`?(t.setParam(e(`env1`),`gate`,0),t.setParam(e(`env2`),`gate`,0)):(n.glide||t.setParam(e(`pitch`),`glide`,0),t.setParam(e(`pitch`),`offset`,(n.note-tn)*100),n.glide||t.setParam(e(`pitch`),`glide`,this.portamento),n.retrigger&&(t.setParam(e(`env1`),`gate`,1),t.setParam(e(`env2`),`gate`,1)))}}eachVoice(e){for(let t=0;t<6;t++)e(e=>`v${t}.${e}`)}applyMode(e){this.apply(this.allocator.releaseAll()),this.held=[],this.allocator.mode=e,this.eachVoice(t=>this.circuit.setParam(t(`out`),`gain`,ln[e])),this.applyDetune(),this.notifyNotes()}applyDetune(){let e=this.allocator.mode===`unison`?this.unisonDetune:0,t=5/2;for(let n=0;n<6;n++){let r=(n-t)/t*e;this.circuit.setParam(`v${n}.det`,`offset`,r===0?0:r)}}applyVibrato(){this.circuit.setParam(`lfoPitch`,`gain`,this.vibratoCents+this.modWheelValue*rn)}applyLfoRate(){let e=Number(this.lfoDivision.split(`/`)[1]),t=this.lfoSync?this.transport.bpm/60*e/4:this.lfoHz;this.circuit.setParam(`lfoOsc`,`frequency`,t),this.circuit.setParam(`lfoRnd`,`rate`,t)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}addShared(e){e.add(`bend`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:-1200}).add(`pwCv`,`constant`,{offset:0}).add(`lfoOsc`,`oscillator`,{frequency:5,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:5}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoSign`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0}).add(`lfoAmp`,`gain`,{gain:0}).add(`voices`,`gain`,{gain:1}).connect(`lfoOsc`,`lfoOscOut`).connect(`lfoOscOut`,`lfoSign`).connect(`lfoSign`,`lfo`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoRndOut`,`lfo`);for(let t of[`lfoPitch`,`lfoPw`,`lfoFilter`,`lfoAmp`])e.connect(`lfo`,t)}addVoice(e,t){let n=e=>`v${t}.${e}`;e.add(n(`pitch`),`constant`,{offset:0,glide:0}).add(n(`det`),`constant`,{offset:0}).add(n(`osc`),`oscillator`,{frequency:440,detune:0},{waveform:`sawtooth`}).add(n(`sub`),`oscillator`,{frequency:440,detune:0},{waveform:`square`}).add(n(`rawOut`),`gain`,{gain:1}).add(n(`pulseSum`),`gain`,{gain:1}).add(n(`shaper`),`waveshaper`,{},{curve:`pulse`}).add(n(`pulseOut`),`gain`,{gain:0}).add(n(`subLevel`),`gain`,{gain:0}).add(n(`mix`),`gain`,{gain:.5}).add(n(`f1`),`filter`,{frequency:2400,Q:1,detune:0},{type:`lowpass`}).add(n(`f2`),`filter`,{frequency:2400,Q:.707,detune:0},{type:`lowpass`}).add(n(`keyFollow`),`gain`,{gain:.5}).add(n(`env1`),`envelope`,{attack:.005,decay:.4,sustain:.4,release:.4,gate:0}).add(n(`env1Depth`),`gain`,{gain:2*en}).add(n(`env2`),`envelope`,{attack:.005,decay:.3,sustain:.7,release:.35,gate:0}).add(n(`amp`),`gain`,{gain:0}).add(n(`trem`),`gain`,{gain:1}).add(n(`ampKey`),`gain`,{gain:0}).add(n(`out`),`gain`,{gain:ln.poly});for(let t of[`osc`,`sub`])e.connect(n(`pitch`),n(t),`detune`).connect(n(`det`),n(t),`detune`).connect(`bend`,n(t),`detune`).connect(`lfoPitch`,n(t),`detune`);e.connect(`subShift`,n(`sub`),`detune`).connect(n(`osc`),n(`rawOut`)).connect(n(`osc`),n(`pulseSum`)).connect(`pwCv`,n(`pulseSum`)).connect(`lfoPw`,n(`pulseSum`)).connect(n(`pulseSum`),n(`shaper`)).connect(n(`shaper`),n(`pulseOut`)).connect(n(`rawOut`),n(`mix`)).connect(n(`pulseOut`),n(`mix`)).connect(n(`sub`),n(`subLevel`)).connect(n(`subLevel`),n(`mix`)).connect(n(`mix`),n(`f1`)).connect(n(`f1`),n(`f2`)).connect(n(`f2`),n(`amp`)).connect(n(`env1`),n(`env1Depth`)).connect(n(`pitch`),n(`keyFollow`));for(let t of[`f1`,`f2`])e.connect(n(`env1Depth`),n(t),`detune`).connect(n(`keyFollow`),n(t),`detune`).connect(`lfoFilter`,n(t),`detune`);e.connect(n(`env2`),n(`amp`),`gain`).connect(n(`amp`),n(`trem`)).connect(`lfoAmp`,n(`trem`),`gain`).connect(n(`pitch`),n(`ampKey`)).connect(n(`ampKey`),n(`trem`),`gain`).connect(n(`trem`),n(`out`)).connect(n(`out`),`voices`)}addEffects(e){e.add(`chorusDry`,`gain`,{gain:1}).add(`chorusWet`,`gain`,{gain:0}).add(`chDelayA`,`delay`,{delayTime:.016,maxTime:.05}).add(`chDelayB`,`delay`,{delayTime:.024,maxTime:.05}).add(`chLfoA`,`oscillator`,{frequency:.62,detune:0},{waveform:`sine`}).add(`chLfoB`,`oscillator`,{frequency:.83,detune:0},{waveform:`sine`}).add(`chDepthA`,`gain`,{gain:.0025}).add(`chDepthB`,`gain`,{gain:.003}).add(`fxMix`,`gain`,{gain:1}).connect(`voices`,`chorusDry`).connect(`chorusDry`,`fxMix`).connect(`voices`,`chDelayA`).connect(`voices`,`chDelayB`).connect(`chDelayA`,`chorusWet`).connect(`chDelayB`,`chorusWet`).connect(`chorusWet`,`fxMix`).connect(`chLfoA`,`chDepthA`).connect(`chDepthA`,`chDelayA`,`delayTime`).connect(`chLfoB`,`chDepthB`).connect(`chDepthB`,`chDelayB`,`delayTime`),e.add(`dlyLine`,`delay`,{delayTime:.35,maxTime:1.5}).add(`dlyTone`,`filter`,{frequency:4500,Q:.707,detune:0},{type:`lowpass`}).add(`dlyFb`,`gain`,{gain:.3}).add(`dlyWet`,`gain`,{gain:0}).add(`dlySum`,`gain`,{gain:1}).add(`level`,`gain`,{gain:.7}).connect(`fxMix`,`dlySum`).connect(`fxMix`,`dlyLine`).connect(`dlyLine`,`dlyTone`).connect(`dlyTone`,`dlyFb`).connect(`dlyFb`,`dlyLine`).connect(`dlyTone`,`dlyWet`).connect(`dlyWet`,`dlySum`).connect(`dlySum`,`level`)}addControls(e){let t=(e,t,n,r,i,a,o,s)=>this.controlList.push(new C(e,t,n,r,i,a,o,s)),n=e=>t=>this.eachVoice(n=>e(n,t)),r=Zt,i=e=>r[e],a=(r,a,o,s,c)=>t(`${r}.${a}`,o,s,c,i(`${r}.${a}`),`s`,n((t,n)=>e.setParam(t(r),a,n)),`log`),o=r=>t(`${r}.sustain`,`Sustain`,0,1,i(`${r}.sustain`),``,n((t,n)=>e.setParam(t(r),`sustain`,n)));this.controlList.push(new w(`osc.wave`,`Wave`,on,r[`osc.wave`],t=>this.eachVoice(n=>{e.setOption(n(`osc`),`waveform`,t===`tri`?`triangle`:`sawtooth`),e.setParam(n(`rawOut`),`gain`,t===`pulse`?0:1),e.setParam(n(`pulseOut`),`gain`,t===`pulse`?un:0)}))),t(`osc.width`,`Width`,5,50,i(`osc.width`),`%`,t=>e.setParam(`pwCv`,`offset`,1-2*t/100)),t(`osc.pwm`,`LFO PWM`,0,100,i(`osc.pwm`)*100,`%`,t=>e.setParam(`lfoPw`,`gain`,t/100*.9)),t(`osc.vibrato`,`LFO Pitch`,0,100,i(`osc.vibrato`),`ct`,e=>{this.vibratoCents=e,this.applyVibrato()}),t(`osc.sub`,`Sub`,0,1,i(`osc.sub`),``,n((t,n)=>e.setParam(t(`subLevel`),`gain`,n*.6))),t(`filter.cutoff`,`Cutoff`,20,2e4,i(`filter.cutoff`),`Hz`,n((t,n)=>{e.setParam(t(`f1`),`frequency`,n),e.setParam(t(`f2`),`frequency`,n)}),`log`),t(`filter.resonance`,`Resonance`,.1,20,i(`filter.resonance`),``,n((t,n)=>e.setParam(t(`f1`),`Q`,n))),t(`filter.env`,`Env 1`,0,6,i(`filter.env`),`oct`,n((t,n)=>e.setParam(t(`env1Depth`),`gain`,n*en))),t(`filter.lfo`,`LFO`,0,4,i(`filter.lfo`),`oct`,t=>e.setParam(`lfoFilter`,`gain`,t*en)),t(`filter.key`,`Key track`,0,100,i(`filter.key`),`%`,n((t,n)=>e.setParam(t(`keyFollow`),`gain`,n/100))),t(`amp.lfo`,`LFO`,0,100,i(`amp.lfo`),`%`,t=>e.setParam(`lfoAmp`,`gain`,t/100*.8)),t(`amp.key`,`Key track`,0,100,i(`amp.key`),`%`,n((t,n)=>e.setParam(t(`ampKey`),`gain`,n/100/6e3))),t(`level`,`Volume`,0,1,i(`level`),``,t=>e.setParam(`level`,`gain`,t)),this.controlList.push(new w(`lfo.wave`,`Wave`,sn,r[`lfo.wave`],t=>{e.setOption(`lfoOsc`,`waveform`,t===`sqr`?`square`:t===`up`||t===`down`?`sawtooth`:`triangle`),e.setParam(`lfoSign`,`gain`,t===`down`?-1:1),e.setParam(`lfoOscOut`,`gain`,t===`rnd`?0:1),e.setParam(`lfoRndOut`,`gain`,+(t===`rnd`))})),t(`lfo.rate`,`Rate`,.1,30,i(`lfo.rate`),`Hz`,e=>{this.lfoHz=e,this.applyLfoRate()},`log`),this.controlList.push(new T(`lfo.sync`,`Sync`,!1,e=>{this.lfoSync=e,this.applyLfoRate()}),new w(`lfo.division`,`Division`,cn,r[`lfo.division`],e=>{this.lfoDivision=e,this.applyLfoRate()}));for(let e of[`env1`,`env2`])a(e,`attack`,`Attack`,.001,5),a(e,`decay`,`Decay`,.005,5),o(e),a(e,`release`,`Release`,.005,10);this.controlList.push(new w(`voices.mode`,`Mode`,Ct,r[`voices.mode`],e=>this.applyMode(e))),t(`voices.portamento`,`Portamento`,0,2,i(`voices.portamento`),`s`,t=>{this.portamento=t,this.eachVoice(n=>e.setParam(n(`pitch`),`glide`,t))}),t(`voices.detune`,`Detune`,0,50,i(`voices.detune`),`ct`,e=>{this.unisonDetune=e,this.applyDetune()}),t(`fx.chorus`,`Chorus`,0,1,i(`fx.chorus`),``,t=>{e.setParam(`chorusWet`,`gain`,t*.7),e.setParam(`chorusDry`,`gain`,1-t*.25)}),t(`fx.delayTime`,`Delay time`,.01,1,i(`fx.delayTime`),`s`,t=>e.setParam(`dlyLine`,`delayTime`,t),`log`),t(`fx.feedback`,`Feedback`,0,.9,i(`fx.feedback`),``,t=>e.setParam(`dlyFb`,`gain`,t)),t(`fx.mix`,`Delay mix`,0,1,i(`fx.mix`),``,t=>e.setParam(`dlyWet`,`gain`,t))}},fn={"spring.length":2,"spring.tension":.5,"spring.drip":.6,"spring.tilt":0,"spring.dwell":.4,"spring.mix":.25},pn=1.6,mn=class extends S{name;constructor(e=`Spring`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`spring`,`spring`,{tension:.5,drip:.6,decay:2,tilt:0,dwell:.4}).add(`dry`,`gain`,{gain:1}).add(`wet`,`gain`,{gain:0}).add(`sum`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`spring`).connect(`in`,`dry`).connect(`spring`,`wet`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=(e,t,n,r,i,a,o)=>this.controlList.push(new C(e,t,n,r,fn[e],i,a,o));n(`spring.length`,`Length`,.2,8,`s`,e=>t.setParam(`spring`,`decay`,e),`log`),n(`spring.tension`,`Tension`,0,1,``,e=>t.setParam(`spring`,`tension`,e)),n(`spring.drip`,`Drip`,0,1,``,e=>t.setParam(`spring`,`drip`,e)),n(`spring.tilt`,`Tilt`,-1,1,``,e=>t.setParam(`spring`,`tilt`,e)),n(`spring.dwell`,`Dwell`,0,1,``,e=>t.setParam(`spring`,`dwell`,e)),n(`spring.mix`,`Dry / wet`,0,1,``,e=>{t.setParam(`dry`,`gain`,Math.cos(e*Math.PI/2)),t.setParam(`wet`,`gain`,Math.sin(e*Math.PI/2)*pn)})}reset(){for(let e of this.controlList)e.kind===`number`&&e.set(e.initial)}},hn=75,gn=10,_n=15,vn=[`A`,`B`,`C`],yn=[[1,2],[3,4],[5,6]],bn=class extends S{channelCount;returnCount;returnFeeds;name;muted=new Set;soloed=new Set;constructor(e=1,t=`Mixer`,n=0,r={}){super(),this.channelCount=e,this.returnCount=n,this.returnFeeds=r,this.name=t;let i=this.circuit;i.add(`main`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`ceiling`,`waveshaper`,{},{curve:`limit`}).add(`mainMeter`,`meter`,{},{channel:`mono`}).connect(`main`,`limiter`).connect(`limiter`,`ceiling`).connect(`ceiling`,`mainMeter`),this.outputList.push({name:`main`,nodeId:`ceiling`}),i.add(`key`,`gain`,{gain:1}),this.outputList.push({name:`key`,nodeId:`key`}),this.meterList.push({name:`main`,nodeId:`mainMeter`});for(let e of vn){let t=`bus${e}`;i.add(t,`gain`,{gain:1}).add(`${t}.toMain`,`gain`,{gain:1}).add(`${t}.meterL`,`meter`,{},{channel:`left`}).add(`${t}.meterR`,`meter`,{},{channel:`right`}).connect(t,`${t}.toMain`).connect(`${t}.toMain`,`main`).connect(t,`${t}.meterL`).connect(t,`${t}.meterR`),this.outputList.push({name:t,nodeId:t}),this.meterList.push({name:`${t}.L`,nodeId:`${t}.meterL`},{name:`${t}.R`,nodeId:`${t}.meterR`}),this.controlList.push(new C(`${t}.fader`,`Bus ${e}`,0,1.5,1,``,e=>i.setParam(t,`gain`,e)),new T(`${t}.main`,`To main`,!0,e=>i.setParam(`${t}.toMain`,`gain`,+!!e)))}for(let e=1;e<=6;e++)i.add(`aux${e}`,`gain`,{gain:1}),this.outputList.push({name:`aux${e}`,nodeId:`aux${e}`}),this.controlList.push(new C(`aux${e}.master`,`Aux ${e}`,0,1.5,1,``,t=>i.setParam(`aux${e}`,`gain`,t)));for(let t=1;t<=e;t++)this.addStrip(`ch${t}`,t,!1);for(let e=1;e<=n;e++)this.addStrip(`ret${e}`,e,!0);this.controlList.push(new w(`key.source`,`Key source`,[`off`,...Array.from({length:e},(e,t)=>`${t+1}`)],`off`,t=>{for(let n=1;n<=e;n++)i.setParam(`ch${n}.keySend`,`gain`,+(t===`${n}`))}))}addStrip(e,t,n){let r=this.circuit,i=t=>`${e}.${t}`;r.add(i(`lowcut`),`filter`,{frequency:gn,Q:.707,gain:0},{type:`highpass`}).add(i(`eqLow`),`filter`,{frequency:80,Q:.707,gain:0},{type:`lowshelf`}).add(i(`eqMid`),`filter`,{frequency:2500,Q:1,gain:0},{type:`peaking`}).add(i(`eqHigh`),`filter`,{frequency:12e3,Q:.707,gain:0},{type:`highshelf`}).add(i(`drive`),`gain`,{gain:1/3}).add(i(`sat`),`waveshaper`,{},{curve:`warm`}).add(i(`mute`),`gain`,{gain:1}).add(i(`fader`),`gain`,{gain:.8}).add(i(`pan`),`pan`,{pan:0}).connect(i(`lowcut`),i(`eqLow`)).connect(i(`eqLow`),i(`eqMid`)).connect(i(`eqMid`),i(`eqHigh`)).connect(i(`eqHigh`),i(`drive`)).connect(i(`drive`),i(`sat`)).connect(i(`sat`),i(`mute`)).connect(i(`mute`),i(`fader`)).connect(i(`fader`),i(`pan`)),n?(r.add(i(`meterL`),`meter`,{},{channel:`left`}).add(i(`meterR`),`meter`,{},{channel:`right`}).connect(i(`pan`),i(`meterL`)).connect(i(`pan`),i(`meterR`)),this.meterList.push({name:`${e}.L`,nodeId:i(`meterL`)},{name:`${e}.R`,nodeId:i(`meterR`)})):(r.add(i(`meter`),`meter`,{},{channel:`mono`}).connect(i(`fader`),i(`meter`)).add(i(`keySend`),`gain`,{gain:0}).connect(i(`mute`),i(`keySend`)).connect(i(`keySend`),`key`),this.meterList.push({name:e,nodeId:i(`meter`)})),this.inputList.push({name:e,nodeId:i(`lowcut`)});let a=vn.filter(e=>!(n&&this.returnFeeds[t]===e));for(let e of a)r.add(i(`assign${e}`),`gain`,{gain:0}).connect(i(`pan`),i(`assign${e}`)).connect(i(`assign${e}`),`bus${e}`);for(let e=1;e<=6;e++)r.add(i(`aux${e}.pre`),`gain`,{gain:0}).add(i(`aux${e}.post`),`gain`,{gain:1}).add(i(`aux${e}`),`gain`,{gain:0}).connect(i(`mute`),i(`aux${e}.pre`)).connect(i(`fader`),i(`aux${e}.post`)).connect(i(`aux${e}.pre`),i(`aux${e}`)).connect(i(`aux${e}.post`),i(`aux${e}`)).connect(i(`aux${e}`),`aux${e}`);let o=(e,t,n,r,a,o,s,c)=>new C(i(e),t,n,r,a,o,s,c),s=(e,t,n)=>o(e,t,-15,_n,0,`dB`,e=>r.setParam(i(n),`gain`,e));this.controlList.push(new T(i(`lowcutOn`),`Low cut`,!1,e=>r.setParam(i(`lowcut`),`frequency`,e?hn:gn)),s(`eqHigh`,`High`,`eqHigh`),s(`eqMid`,`Mid`,`eqMid`),o(`eqMidFreq`,`Freq`,100,8e3,2500,`Hz`,e=>r.setParam(i(`eqMid`),`frequency`,e),`log`),s(`eqLow`,`Low`,`eqLow`));for(let e=1;e<=6;e++)this.controlList.push(o(`aux${e}`,`${e}`,0,1,0,``,t=>r.setParam(i(`aux${e}`),`gain`,t)));for(let[e,t]of yn)this.controlList.push(new T(i(`auxPre${e}${t}`),`Pre ${e}-${t}`,!1,n=>{for(let a of[e,t])r.setParam(i(`aux${a}.pre`),`gain`,+!!n),r.setParam(i(`aux${a}.post`),`gain`,+!n)}));this.controlList.push(o(`pan`,n?`Balance`:`Pan`,-1,1,0,``,e=>r.setParam(i(`pan`),`pan`,e))),n?this.controlList.push(new T(i(`mute`),`Mute`,!1,e=>r.setParam(i(`mute`),`gain`,+!e))):this.controlList.push(new T(i(`mute`),`Mute`,!1,e=>this.setFlag(this.muted,t,e)),new T(i(`solo`),`Solo`,!1,e=>this.setFlag(this.soloed,t,e)));for(let e of a)this.controlList.push(new T(i(`bus${e}`),e,e===`A`,t=>r.setParam(i(`assign${e}`),`gain`,+!!t)));this.controlList.push(o(`fader`,`Fader`,0,1.5,.8,``,e=>r.setParam(i(`fader`),`gain`,e)))}get soloActive(){return this.soloed.size>0}setFlag(e,t,n){n?e.add(t):e.delete(t);for(let e=1;e<=this.channelCount;e++){let t=`ch${e}.mute`;if(!this.circuit.nodes.has(t))continue;let n=this.muted.has(e)||this.soloed.size>0&&!this.soloed.has(e);this.circuit.setParam(t,`gain`,+!n)}}},xn={"osc.range":`8'`,"osc.width":50,"osc.pwSource":`man`,"osc.pwm":0,"osc.mod":0,"osc.sub":`-1`,"mix.saw":.8,"mix.pulse":0,"mix.sub":.55,"mix.noise":.05,"filter.cutoff":800,"filter.resonance":1,"filter.keyFollow":50,"filter.lfo":0,"filterEnv.amount":2,"filterEnv.attack":.005,"filterEnv.decay":.3,"filterEnv.sustain":.3,"filterEnv.release":.3,"ampEnv.attack":.005,"ampEnv.decay":.2,"ampEnv.sustain":.7,"ampEnv.release":.3,"lfo.wave":`tri`,"lfo.rate":4.8,"perf.glide":0,"perf.notes":`legato`,level:.5},B=(e,t)=>({name:e,values:t}),Sn=[B(`Init`,{}),B(`Sub Bass`,{"osc.range":`16'`,"mix.saw":.5,"mix.sub":.95,"mix.noise":0,"filter.cutoff":380,"filter.resonance":2,"filter.keyFollow":30,"filterEnv.amount":1.5,"filterEnv.attack":.001,"filterEnv.decay":.25,"filterEnv.sustain":.2,"ampEnv.attack":.002,"ampEnv.decay":.3,"ampEnv.sustain":.85,"ampEnv.release":.12,level:.6}),B(`Acid Squelch`,{"osc.range":`16'`,"mix.saw":1,"mix.sub":.35,"mix.noise":0,"filter.cutoff":220,"filter.resonance":14,"filter.keyFollow":40,"filterEnv.amount":4,"filterEnv.attack":.001,"filterEnv.decay":.18,"filterEnv.sustain":0,"filterEnv.release":.1,"ampEnv.sustain":.9,"ampEnv.release":.08,"perf.glide":.08,level:.45}),B(`Fat Pulse Bass`,{"osc.range":`16'`,"osc.width":30,"mix.saw":0,"mix.pulse":.9,"mix.sub":.5,"mix.noise":0,"filter.cutoff":520,"filter.resonance":3,"filterEnv.amount":2,"filterEnv.decay":.3,"filterEnv.sustain":.2,"ampEnv.sustain":.85,"ampEnv.release":.1}),B(`Wobble Bass`,{"osc.range":`16'`,"mix.saw":.8,"mix.sub":.7,"mix.noise":0,"filter.cutoff":300,"filter.resonance":6,"filter.lfo":2,"filterEnv.amount":.5,"filterEnv.sustain":.5,"lfo.wave":`tri`,"lfo.rate":3,"ampEnv.sustain":1,"ampEnv.release":.12,level:.55}),B(`Funk Pluck`,{"osc.range":`8'`,"osc.width":25,"mix.saw":.3,"mix.pulse":.8,"mix.sub":.3,"mix.noise":0,"filter.cutoff":260,"filter.resonance":5,"filter.keyFollow":60,"filterEnv.amount":3.5,"filterEnv.attack":.001,"filterEnv.decay":.15,"filterEnv.sustain":0,"ampEnv.attack":.001,"ampEnv.decay":.2,"ampEnv.sustain":.3,"ampEnv.release":.1}),B(`Rubber Bass`,{"osc.range":`16'`,"mix.saw":.7,"mix.sub":.8,"mix.noise":0,"filter.cutoff":150,"filter.resonance":8,"filter.keyFollow":25,"filterEnv.amount":3,"filterEnv.attack":.001,"filterEnv.decay":.3,"filterEnv.sustain":.1,"ampEnv.sustain":.8,"ampEnv.release":.1,level:.55}),B(`Saw Lead`,{"mix.saw":1,"mix.sub":.2,"mix.noise":0,"filter.cutoff":3e3,"filter.resonance":3,"filter.keyFollow":70,"filterEnv.amount":1,"perf.glide":.06,"osc.mod":15,"lfo.rate":5.5,"ampEnv.sustain":.9,"ampEnv.release":.25}),B(`Hollow Pulse Lead`,{"osc.width":18,"mix.saw":0,"mix.pulse":1,"mix.sub":0,"mix.noise":0,"filter.cutoff":2500,"filter.resonance":2,"filter.keyFollow":80,"filterEnv.amount":1.5,"filterEnv.attack":.01,"filterEnv.decay":.4,"filterEnv.sustain":.5,"ampEnv.sustain":.8,"ampEnv.release":.2}),B(`PWM Lead`,{"mix.saw":.2,"mix.pulse":.9,"mix.sub":.2,"mix.noise":0,"osc.pwSource":`lfo`,"osc.pwm":70,"lfo.rate":1.2,"filter.cutoff":3e3,"filter.resonance":2,"filter.keyFollow":70,"filterEnv.amount":1,"ampEnv.sustain":.9,"ampEnv.release":.3}),B(`Vibrato Lead`,{"mix.saw":.8,"mix.pulse":.4,"mix.sub":.1,"mix.noise":0,"osc.mod":40,"lfo.rate":5.2,"filter.cutoff":2800,"filter.resonance":3,"filter.keyFollow":70,"filterEnv.amount":1.2,"perf.glide":.1,"ampEnv.attack":.01,"ampEnv.sustain":.9,"ampEnv.release":.3}),B(`Portamento Solo`,{"mix.saw":1,"mix.sub":.3,"mix.noise":0,"perf.glide":.35,"perf.notes":`legato`,"filter.cutoff":2200,"filter.resonance":4,"filterEnv.amount":.8,"filterEnv.sustain":.6,"ampEnv.sustain":1,"ampEnv.release":.2}),B(`Clarinet`,{"osc.width":50,"mix.saw":0,"mix.pulse":1,"mix.sub":0,"mix.noise":.03,"filter.cutoff":1800,"filter.resonance":1,"filter.keyFollow":70,"filterEnv.amount":1,"filterEnv.attack":.04,"filterEnv.sustain":.6,"ampEnv.attack":.04,"ampEnv.sustain":.9,"ampEnv.release":.12,"osc.mod":8,"lfo.rate":5}),B(`Brass`,{"mix.saw":1,"mix.pulse":.4,"mix.sub":.2,"mix.noise":0,"filter.cutoff":500,"filter.resonance":2,"filter.keyFollow":60,"filterEnv.amount":3,"filterEnv.attack":.12,"filterEnv.decay":.3,"filterEnv.sustain":.6,"ampEnv.attack":.08,"ampEnv.decay":.2,"ampEnv.sustain":.85,"ampEnv.release":.2}),B(`Siren`,{"mix.saw":1,"mix.sub":0,"mix.noise":0,"osc.mod":600,"lfo.wave":`tri`,"lfo.rate":.7,"filter.cutoff":4e3,"filter.resonance":2,"filterEnv.amount":0,"ampEnv.sustain":1,"ampEnv.release":.15}),B(`Random SFX`,{"mix.saw":.5,"mix.pulse":.5,"mix.sub":0,"mix.noise":0,"lfo.wave":`rnd`,"lfo.rate":9,"osc.mod":500,"filter.cutoff":1200,"filter.resonance":8,"filter.lfo":2.5,"filterEnv.amount":0,"ampEnv.attack":.01,"ampEnv.sustain":1,"ampEnv.release":.1,level:.45}),B(`Snare`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":1,"filter.cutoff":3e3,"filter.resonance":2,"filter.keyFollow":0,"filterEnv.amount":1,"filterEnv.attack":.001,"filterEnv.decay":.1,"filterEnv.sustain":0,"ampEnv.attack":.001,"ampEnv.decay":.18,"ampEnv.sustain":0,"ampEnv.release":.1,level:.6}),B(`Wind`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":1,"filter.cutoff":500,"filter.resonance":8,"filter.keyFollow":0,"filterEnv.amount":4,"filterEnv.attack":2,"filterEnv.decay":2,"filterEnv.sustain":.5,"filterEnv.release":2,"ampEnv.attack":1.5,"ampEnv.sustain":1,"ampEnv.release":2,level:.5}),B(`Whistle`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":.6,"filter.cutoff":2e3,"filter.resonance":20,"filter.keyFollow":100,"filterEnv.amount":0,"osc.mod":20,"lfo.rate":5,"ampEnv.attack":.05,"ampEnv.sustain":1,"ampEnv.release":.2,level:.35})],Cn=new Map([[70,`filter.cutoff`],[71,`filter.resonance`],[72,`filterEnv.amount`],[73,`filterEnv.decay`],[74,`ampEnv.decay`],[75,`ampEnv.release`],[76,`osc.width`],[77,`osc.pwm`],[78,`mix.pulse`],[79,`mix.sub`],[80,`mix.noise`],[81,`lfo.rate`],[82,`osc.mod`],[83,`perf.glide`]]);function wn(e,t){let n=Math.min(127,Math.max(0,t))/127;if(e.kind===`number`)e.set(e.curve===`log`?e.min*(e.max/e.min)**+n:e.min+n*(e.max-e.min));else if(e.kind===`choice`){let t=Math.min(e.options.length-1,Math.floor(n*e.options.length));e.set(e.options[t])}else e.set(t>=64)}var Tn=1200,En=200,Dn=100,On=1,V=440,kn=4.8,An=[`man`,`lfo`,`env`],jn=[`legato`,`retrig`],Mn=[`tri`,`sqr`,`rnd`],Nn={"16'":-1200,"8'":0,"4'":1200,"2'":2400},Pn={"-1":-1200,"-2":-2400},Fn=class extends S{name;transport;ccMap=new Map(Cn);held=[];presetListeners=new Set;currentPreset=Sn[0];gateOpen=!1;glideSeconds=0;retrigger=!1;pwSource=`man`;pwmAmount=0;bend=0;modWheelValue=0;oscModCents=0;performanceListeners=new Set;noteListeners=new Set;constructor(e=`Synth`,t=new x){super(),this.name=e,this.transport=new D(t);let n=this.circuit;n.add(`pitch`,`constant`,{offset:0,glide:0}).add(`range`,`constant`,{offset:0}).add(`bend`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:Pn[-1]}).add(`pulseWidthCv`,`constant`,{offset:0}).add(`sawOsc`,`oscillator`,{frequency:V,detune:0},{waveform:`sawtooth`}).add(`pulseOsc`,`oscillator`,{frequency:V,detune:0},{waveform:`sawtooth`}).add(`pulseSum`,`gain`,{gain:1}).add(`pulseShaper`,`waveshaper`,{},{curve:`pulse`}).add(`subOsc`,`oscillator`,{frequency:V,detune:0},{waveform:`square`}).add(`noise`,`noise`).add(`mix.saw`,`gain`,{gain:.8}).add(`mix.pulse`,`gain`,{gain:0}).add(`mix.sub`,`gain`,{gain:.55}).add(`mix.noise`,`gain`,{gain:.05}).add(`mix`,`gain`,{gain:.5}).add(`filter1`,`filter`,{frequency:800,Q:1,detune:0},{type:`lowpass`}).add(`filter2`,`filter`,{frequency:800,Q:.707,detune:0},{type:`lowpass`}).add(`keyFollow`,`gain`,{gain:.5}).add(`amp`,`gain`,{gain:0}).add(`level`,`gain`,{gain:.5}).add(`ampEnv`,`envelope`,{attack:.005,decay:.2,sustain:.7,release:.3,gate:0}).add(`filterEnv`,`envelope`,{attack:.005,decay:.3,sustain:.3,release:.3,gate:0}).add(`filterEnvDepth`,`gain`,{gain:2*Tn}).add(`lfoOsc`,`oscillator`,{frequency:kn,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:kn}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`envPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0});for(let e of[`sawOsc`,`pulseOsc`,`subOsc`])n.connect(`pitch`,e,`detune`).connect(`range`,e,`detune`).connect(`bend`,e,`detune`);n.connect(`subShift`,`subOsc`,`detune`).connect(`pulseOsc`,`pulseSum`).connect(`pulseWidthCv`,`pulseSum`).connect(`pulseSum`,`pulseShaper`).connect(`sawOsc`,`mix.saw`).connect(`pulseShaper`,`mix.pulse`).connect(`subOsc`,`mix.sub`).connect(`noise`,`mix.noise`);for(let e of[`mix.saw`,`mix.pulse`,`mix.sub`,`mix.noise`])n.connect(e,`mix`);n.connect(`mix`,`filter1`).connect(`filter1`,`filter2`).connect(`filter2`,`amp`).connect(`amp`,`level`).connect(`ampEnv`,`amp`,`gain`).connect(`filterEnv`,`filterEnvDepth`).connect(`pitch`,`keyFollow`);for(let e of[`filter1`,`filter2`])n.connect(`filterEnvDepth`,e,`detune`).connect(`keyFollow`,e,`detune`).connect(`lfoFilter`,e,`detune`);for(let e of[`sawOsc`,`pulseOsc`,`subOsc`])n.connect(`lfoPitch`,e,`detune`);n.connect(`lfoOsc`,`lfoOscOut`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoOscOut`,`lfo`).connect(`lfoRndOut`,`lfo`).connect(`lfo`,`lfoPitch`).connect(`lfo`,`lfoPw`).connect(`lfo`,`lfoFilter`).connect(`lfoPw`,`pulseSum`).connect(`filterEnv`,`envPw`).connect(`envPw`,`pulseSum`),this.outputList.push({name:`out`,nodeId:`level`}),this.controlList.push(new w(`osc.range`,`Range`,Object.keys(Nn),`8'`,e=>n.setParam(`range`,`offset`,Nn[e])),new C(`osc.width`,`Width`,5,50,50,`%`,e=>n.setParam(`pulseWidthCv`,`offset`,1-2*e/100)),new w(`osc.sub`,`Sub`,Object.keys(Pn),`-1`,e=>n.setParam(`subShift`,`offset`,Pn[e])),Ln(n,`saw`,`Saw`,.8),Ln(n,`pulse`,`Pulse`,0),Ln(n,`sub`,`Sub`,.55),Ln(n,`noise`,`Noise`,.05),new C(`filter.cutoff`,`Cutoff`,20,2e4,800,`Hz`,e=>{n.setParam(`filter1`,`frequency`,e),n.setParam(`filter2`,`frequency`,e)},`log`),new C(`filter.resonance`,`Resonance`,.1,20,1,``,e=>n.setParam(`filter1`,`Q`,e)),new C(`filter.keyFollow`,`Key`,0,100,50,`%`,e=>n.setParam(`keyFollow`,`gain`,e/100)),new C(`perf.glide`,`Glide`,0,3,0,`s`,e=>{this.glideSeconds=e,n.setParam(`pitch`,`glide`,e)}),new w(`perf.notes`,`Notes`,jn,`legato`,e=>{this.retrigger=e===`retrig`}),new w(`lfo.wave`,`Wave`,Mn,`tri`,e=>{n.setOption(`lfoOsc`,`waveform`,e===`sqr`?`square`:`triangle`),n.setParam(`lfoOscOut`,`gain`,e===`rnd`?0:1),n.setParam(`lfoRndOut`,`gain`,+(e===`rnd`))}),new C(`lfo.rate`,`Rate`,.1,30,kn,`Hz`,e=>{n.setParam(`lfoOsc`,`frequency`,e),n.setParam(`lfoRnd`,`rate`,e)},`log`),new C(`osc.mod`,`Mod`,0,600,0,`ct`,e=>{this.oscModCents=e,this.applyVibrato()}),new w(`osc.pwSource`,`PW src`,An,`man`,e=>{this.pwSource=e,this.applyPwm()}),new C(`osc.pwm`,`PWM`,0,100,0,`%`,e=>{this.pwmAmount=e/100,this.applyPwm()}),new C(`filter.lfo`,`LFO`,0,4,0,`oct`,e=>n.setParam(`lfoFilter`,`gain`,e*Tn)),new C(`level`,`Level`,0,1,.5,``,e=>n.setParam(`level`,`gain`,e)),new C(`filterEnv.amount`,`Amount`,0,6,2,`oct`,e=>n.setParam(`filterEnvDepth`,`gain`,e*Tn)),...In(n,`filterEnv`,{attack:.005,decay:.3,sustain:.3,release:.3}),...In(n,`ampEnv`,{attack:.005,decay:.2,sustain:.7,release:.3}))}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*En),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.applyVibrato(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}applyVibrato(){this.circuit.setParam(`lfoPitch`,`gain`,this.oscModCents+this.modWheelValue*Dn)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}loadPreset(e){let t={...xn,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}keyDown(e){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.noteOn(Rn(e)),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e);let t=this.held[this.held.length-1];t===void 0?this.noteOff():this.noteOn(Rn(t)),this.notifyNotes()}handleMidi(e){if(!(`channel`in e&&!this.transport.acceptsChannel(e.channel)))switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:{if(e.controller===On){this.setModWheel(e.value/127);break}let t=this.ccMap.get(e.controller);t&&wn(this.control(t),e.value);break}case`programChange`:{let t=Sn[e.program];t&&this.loadPreset(t);break}}}applyPwm(){let e=this.pwmAmount*.9;this.circuit.setParam(`lfoPw`,`gain`,this.pwSource===`lfo`?e:0),this.circuit.setParam(`envPw`,`gain`,this.pwSource===`env`?e:0)}noteOn(e){let t=this.gateOpen,n=this.glideSeconds;t||this.circuit.setParam(`pitch`,`glide`,0),this.circuit.setParam(`pitch`,`offset`,Tn*Math.log2(e/V)),t||this.circuit.setParam(`pitch`,`glide`,n),(!t||this.retrigger)&&(this.circuit.setParam(`ampEnv`,`gate`,1),this.circuit.setParam(`filterEnv`,`gate`,1)),this.gateOpen=!0}noteOff(){this.circuit.setParam(`ampEnv`,`gate`,0),this.circuit.setParam(`filterEnv`,`gate`,0),this.gateOpen=!1}};function In(e,t,n){let r=(r,i,a,o)=>new C(`${t}.${r}`,i,a,o,n[r],`s`,n=>e.setParam(t,r,n),`log`);return[r(`attack`,`Attack`,.001,5),r(`decay`,`Decay`,.005,5),new C(`${t}.sustain`,`Sustain`,0,1,n.sustain,``,n=>e.setParam(t,`sustain`,n)),r(`release`,`Release`,.005,10)]}function Ln(e,t,n,r){return new C(`mix.${t}`,n,0,1,r,``,n=>e.setParam(`mix.${t}`,`gain`,n))}var Rn=e=>V*2**((e-69)/12),zn=class e{devices=new Map;connections=[];output;add(e,t){if(this.devices.has(e))throw Error(`Duplicate device id: ${e}`);return this.devices.set(e,t),this}device(e){let t=this.devices.get(e);if(!t)throw Error(`Unknown device: ${e}`);return t}connect(e,t){if(this.device(e.device).jack(`out`,e.jack),this.device(t.device).jack(`in`,t.jack),this.connections.some(n=>n.to.device===t.device&&n.to.jack===t.jack&&n.from.device===e.device&&n.from.jack===e.jack))throw Error(`Duplicate connection`);return this.connections.push({from:e,to:t}),this}setOutput(e,t){return this.device(e).jack(`out`,t),this.output={device:e,jack:t},this}static lynch(t=new x){return new e().add(`lynch`,new Rt(`Lynch`,t)).setOutput(`lynch`,`out`)}static pipe(t=new x){return new e().add(`pipe`,new Xt(`Pipe`,t)).add(`spring`,new mn(`Spring`)).connect({device:`pipe`,jack:`out`},{device:`spring`,jack:`in`}).setOutput(`spring`,`out`)}static default(t=new x){let n=new e().add(`synth`,new Fn(`Synth`,t)).add(`poly`,new dn(`Poly`,t)).add(`drums`,new He(`Drums`,t)).add(`reverb`,new Ke(`Reverb`)).add(`delay`,new qe(`Delay`)).add(`ouroboros`,new ht(`Ouroboros`)).add(`buscomp`,new Pe(`Bus Comp`)).add(`granular`,new nt(`Granular`)).add(`mixer`,new bn(2+O.length,`Mixer`,5,{3:`C`,4:`B`})).connect({device:`synth`,jack:`out`},{device:`mixer`,jack:`ch1`}).connect({device:`poly`,jack:`out`},{device:`mixer`,jack:`ch2`});O.forEach((e,t)=>n.connect({device:`drums`,jack:e},{device:`mixer`,jack:`ch${t+3}`})),n.connect({device:`mixer`,jack:`aux1`},{device:`reverb`,jack:`in`}).connect({device:`mixer`,jack:`aux2`},{device:`delay`,jack:`in`}).connect({device:`reverb`,jack:`out`},{device:`mixer`,jack:`ret1`}).connect({device:`delay`,jack:`out`},{device:`mixer`,jack:`ret2`}),n.connect({device:`mixer`,jack:`busC`},{device:`ouroboros`,jack:`in`}).connect({device:`ouroboros`,jack:`out`},{device:`mixer`,jack:`ret3`}),n.connect({device:`mixer`,jack:`busB`},{device:`buscomp`,jack:`in`}).connect({device:`mixer`,jack:`key`},{device:`buscomp`,jack:`key`}).connect({device:`buscomp`,jack:`out`},{device:`mixer`,jack:`ret4`}),n.connect({device:`mixer`,jack:`aux3`},{device:`granular`,jack:`in`}).connect({device:`granular`,jack:`out`},{device:`mixer`,jack:`ret5`});let r=n.device(`mixer`);return r.control(`busC.main`).set(!1),r.control(`busB.main`).set(!1),r.control(`key.source`).set(`3`),n.setOutput(`mixer`,`main`)}},Bn=`moa.midiInput`,Vn=class{status=typeof navigator<`u`&&`requestMIDIAccess`in navigator?`idle`:`unsupported`;inputs=[];selectedId;onMessage;access;listeners=new Set;async connect(){if(this.status!==`unsupported`){try{this.access=await navigator.requestMIDIAccess({sysex:!1})}catch{this.status=`denied`,this.emit();return}this.status=`ready`,this.access.onstatechange=()=>this.refresh(),this.refresh()}}async connectIfPermitted(){if(this.status===`idle`)try{(await navigator.permissions.query({name:`midi`})).state===`granted`&&await this.connect()}catch{}}select(e){if(this.access)for(let e of this.access.inputs.values())e.onmidimessage=null;if(this.selectedId=e,e){let t=this.access?.inputs.get(e);t&&(t.onmidimessage=e=>{e.data&&this.onMessage?.(e.data,e.timeStamp)});try{localStorage.setItem(Bn,e)}catch{}}this.emit()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}refresh(){this.inputs=[...this.access?.inputs.values()??[]].map(e=>({id:e.id,name:e.name??e.id})),this.selectedId&&this.inputs.some(e=>e.id===this.selectedId)?this.emit():this.select(this.pickDefault())}pickDefault(){let e=null;try{e=localStorage.getItem(Bn)}catch{}return this.inputs.find(t=>t.id===e)?.id??this.inputs.find(e=>/torso|t-?1/i.test(e.name))?.id??(this.inputs.length===1?this.inputs[0]?.id:void 0)}emit(){for(let e of this.listeners)e()}},Hn=1e3;function Un(e){let t=e.curve===`log`?Math.log(e.value/e.min)/Math.log(e.max/e.min):(e.value-e.min)/(e.max-e.min);return Math.round(t*Hn)}function Wn(e,t){let n=t/Hn;return e.curve===`log`?e.min*(e.max/e.min)**+n:e.min+n*(e.max-e.min)}function Gn(e){let t=e.value;return`${t>=100?t.toFixed(0):t>=10?t.toFixed(1):t>=1?t.toFixed(2):t.toFixed(3)}${e.unit?` `+e.unit:``}`}function H(e,t,n){let r=document.createElement(e);return t&&(r.className=t),n!==void 0&&(r.textContent=n),r}var Kn=270,qn=160,Jn=600,Yn=131.95;function Xn(e,t,n=e.label){return{label:n,color:t,get:()=>Un(e)/Hn,set:t=>e.set(Wn(e,Math.round(Math.min(1,Math.max(0,t))*Hn))),reset:()=>e.set(e.initial),text:()=>Gn(e),subscribe:t=>e.onChange(t)}}var Zn=(e,t)=>{let n=Math.round((-135+e*Kn)*10)/10;return`<svg aria-hidden="true" width="72" height="72" viewBox="0 0 80 80">
    <path d="M16.34 64.42 A34 34 0 1 1 63.66 64.42" fill="none" stroke="#6b6f75" stroke-width="4" stroke-dasharray="1.2 14.8"></path>
    <path d="M20.2 59.8 A28 28 0 1 1 59.8 59.8" fill="none" stroke="#33363b" stroke-width="3"></path>
    <path d="M20.2 59.8 A28 28 0 1 1 59.8 59.8" fill="none" stroke="${t}" stroke-width="3" stroke-dasharray="${(e*Yn).toFixed(1)} 200"></path>
    <circle cx="40" cy="40" r="22" fill="#101112" stroke="#4a4e54" stroke-width="1.5"></circle>
    <circle cx="40" cy="40" r="15" fill="#25282c" stroke="#3a3d42" stroke-width="1"></circle>
    <rect x="38.8" y="21.5" width="2.4" height="15" rx="1.2" fill="#f1eee6" transform="rotate(${n} 40 40)"></rect>
  </svg>`};function Qn(e,t,n=Zn){let r=H(`div`,`dial`),i=H(`div`,`dial-face`);i.tabIndex=0,i.setAttribute(`role`,`slider`),i.setAttribute(`aria-label`,`${t} ${e.label}`),i.setAttribute(`aria-orientation`,`vertical`),i.setAttribute(`aria-valuemin`,`0`),i.setAttribute(`aria-valuemax`,`100`);let a=H(`div`,`dial-label`,e.label),o=H(`div`,`dial-value`),s=()=>{let t=e.get();i.innerHTML=n(t,e.color),o.textContent=e.text(),i.setAttribute(`aria-valuenow`,String(Math.round(t*100))),i.setAttribute(`aria-valuetext`,o.textContent)},c=t=>{e.set(Math.min(1,Math.max(0,t))),s()},l;i.addEventListener(`pointerdown`,t=>{t.preventDefault(),i.focus(),i.setPointerCapture(t.pointerId),l={y:t.clientY,t:e.get()}}),i.addEventListener(`pointermove`,e=>{l&&c(l.t+(l.y-e.clientY)/(e.shiftKey?Jn:qn))});let u=()=>{l=void 0};return i.addEventListener(`pointerup`,u),i.addEventListener(`pointercancel`,u),i.addEventListener(`dblclick`,()=>{e.reset(),s()}),i.addEventListener(`keydown`,t=>{let n=(t.shiftKey?5:1)*(e.step??.02),r=e.get(),i={ArrowUp:r+n,ArrowRight:r+n,ArrowDown:r-n,ArrowLeft:r-n,Home:0,End:1};t.key in i&&(t.preventDefault(),c(i[t.key]))}),e.subscribe(s),s(),r.append(i,a,o),r}var $n=.04;function er(e){let t=H(`div`,`wheel`);t.append(H(`div`,`wheel-label`,e.label));let n=H(`div`,`wheel-body`),r=H(`div`,`wheel-scale`);r.setAttribute(`aria-hidden`,`true`);for(let t of e.scale)r.append(H(`span`,void 0,t));let i=H(`button`,`wheel-face`);i.type=`button`,i.setAttribute(`role`,`slider`),i.setAttribute(`aria-label`,e.ariaLabel),i.setAttribute(`aria-orientation`,`vertical`),i.setAttribute(`aria-valuemin`,e.bipolar?`-1`:`0`),i.setAttribute(`aria-valuemax`,`1`),i.append(H(`span`,`wheel-ribs`)),e.bipolar&&i.append(H(`span`,`wheel-detent wheel-detent-left`),H(`span`,`wheel-detent wheel-detent-right`));let a=H(`div`,`wheel-marker`);a.setAttribute(`aria-hidden`,`true`);let o=H(`div`,`wheel-readout`),s=t=>e.bipolar?(t+1)/2:t,c=()=>{let t=e.get(),n=s(t);i.style.setProperty(`--rib`,`${Math.round(t*-60)}px`),a.style.top=`${Math.round((1-n)*102)}px`,o.textContent=e.format(t),i.setAttribute(`aria-valuenow`,String(t)),i.setAttribute(`aria-valuetext`,e.format(t))},l=t=>{let n=Math.min((e.bipolar,1),Math.max(e.bipolar?-1:0,t));e.set(e.bipolar&&Math.abs(n)<$n?0:n),c()},u=t=>{let n=i.getBoundingClientRect(),r=Math.min(1,Math.max(0,1-(t.clientY-n.top)/n.height));l(e.bipolar?r*2-1:r)},d=!1;i.addEventListener(`pointerdown`,e=>{i.setPointerCapture(e.pointerId),d=!0,u(e)}),i.addEventListener(`pointermove`,e=>{d&&u(e)});let f=()=>{d=!1,e.springBack&&l(0)};i.addEventListener(`pointerup`,f),i.addEventListener(`pointercancel`,f),i.addEventListener(`keydown`,t=>{let n=t.key===`ArrowUp`||t.key===`ArrowRight`?1:t.key===`ArrowDown`||t.key===`ArrowLeft`?-1:0;n&&(t.preventDefault(),l(e.get()+n*e.keyStep))}),i.addEventListener(`keyup`,()=>{e.springBack&&l(0)}),i.addEventListener(`dblclick`,()=>l(0)),e.subscribe(c),c();let p=H(`div`,`wheel-markers`);return p.append(a),n.append(r,i,p),t.append(n,o),t}var tr=36,nr=49,rr=[`a`,`w`,`s`,`e`,`d`,`f`,`t`,`g`,`y`,`h`,`u`,`j`,`k`],ir=24,ar=[`C`,`C#`,`D`,`D#`,`E`,`F`,`F#`,`G`,`G#`,`A`,`A#`,`B`],or=[!0,!1,!0,!1,!0,!0,!1,!0,!1,!0,!1,!0],sr=or.reduce((e,t,n)=>e+ +!!t,0)*4+1,cr=100/sr*.6,lr=2,ur,dr=e=>`${ar[e%12]}${Math.floor(e/12)-1}`,fr=e=>{let t=Math.round(e*2*100)/100;return`${t>0?`+`:``}${t.toFixed(2)} st`};function pr(e,t){let n=H(`div`,`keybed`);ur??=n,document.addEventListener(`pointerdown`,e=>{n.parentElement?.contains(e.target)&&(ur=n)},!0);let r=H(`div`,`keybed-cheek`),i=H(`div`,`keybed-wheels`);i.append(er({label:`Bend`,ariaLabel:`Pitch bend`,bipolar:!0,scale:[`+2`,`0`,`-2`],springBack:!0,keyStep:.125,get:()=>e.pitchBend,set:t=>e.setPitchBend(t),subscribe:t=>e.onPerformanceChange(t),format:fr}),er({label:`Mod`,ariaLabel:`Modulation, LFO vibrato depth`,bipolar:!1,scale:[`100`,`0`],springBack:!1,keyStep:.1,get:()=>e.modWheel,set:t=>e.setModWheel(t),subscribe:t=>e.onPerformanceChange(t),format:e=>`${Math.round(e*100)} %`}));let a=0,o=H(`div`,`keybed-octave`),s=H(`button`,`btn btn-small`,`<`);s.type=`button`,s.setAttribute(`aria-label`,`Octave down`);let c=H(`button`,`btn btn-small`,`>`);c.type=`button`,c.setAttribute(`aria-label`,`Octave up`);let l=H(`span`,`keybed-octave-text`,`Oct 0`);o.append(s,l,c),r.append(i,o);let u=H(`div`,`keybed-keys`),d=H(`div`,`keybed-whites`);u.append(d);let f=[],p=new Map,m=0,h=t=>{if(p.has(t))return;let n=tr+t+a*12;p.set(t,n),e.keyDown(n)},g=t=>{let n=p.get(t);n!==void 0&&(p.delete(t),e.keyUp(n))};for(let e=0;e<nr;e++){let t=or[e%12],n=H(`button`,t?`key-white`:`key-black`);n.type=`button`,n.setAttribute(`aria-label`,`Key ${dr(tr+e)}`);let r=rr[e-ir];r&&(n.textContent=r),t?(d.append(n),m++):(n.style.left=`${Math.round((m/sr*100-cr/2)*1e3)/1e3}%`,n.style.width=`${cr}%`,u.append(n)),n.addEventListener(`pointerdown`,t=>{t.preventDefault(),h(e)});for(let t of[`pointerup`,`pointerleave`,`pointercancel`])n.addEventListener(t,()=>g(e));n.addEventListener(`keydown`,t=>{(t.key===` `||t.key===`Enter`)&&!t.repeat&&(t.preventDefault(),h(e))}),n.addEventListener(`keyup`,()=>g(e)),f.push(n)}let _=()=>{let t=new Set(e.heldNotes),n=new Set(p.values());f.forEach((e,r)=>{let i=p.has(r)||t.has(tr+r)&&!n.has(tr+r);e.classList.toggle(`on`,i),e.setAttribute(`aria-pressed`,String(i))})};e.onNoteChange(_);let v=()=>{l.textContent=`Oct ${a>0?`+`:``}${a}`,s.disabled=a<=-2,c.disabled=a>=lr,_()};return s.addEventListener(`click`,()=>{a=Math.max(-2,a-1),v()}),c.addEventListener(`click`,()=>{a=Math.min(lr,a+1),v()}),v(),window.addEventListener(`keydown`,e=>{if(ur!==n||e.repeat||e.metaKey||e.ctrlKey||e.altKey||e.target instanceof HTMLSelectElement)return;let t=rr.indexOf(e.key.toLowerCase());t>=0&&h(ir+t)}),window.addEventListener(`keyup`,e=>{let t=rr.indexOf(e.key.toLowerCase());t>=0&&g(ir+t)}),n.append(t??r,u),n}function mr(e){try{let t=window.localStorage.getItem(e);return t?JSON.parse(t):{}}catch{return{}}}var hr=(e,t)=>typeof e==`object`&&!!e&&Object.entries(e).every(([e,n])=>t.has(e)&&(typeof n==`number`||typeof n==`string`));function gr(e,t){let n=new Set(t.controls.map(e=>e.id));for(let[r,i]of Object.entries(mr(e))){let e=Number(r);Number.isInteger(e)&&e>=0&&e<t.slots.length&&typeof i?.name==`string`&&hr(i.values,n)&&(t.slots[e]=i)}}function _r(e,t,n){try{window.localStorage.setItem(e,JSON.stringify({...mr(e),[t]:n}))}catch{}}var vr=`lynch106.patches`,yr=e=>gr(vr,e),br=(e,t)=>_r(vr,e,t),U=(e,t)=>{let n=e.control(t);if(n.kind!==`number`)throw Error(`${t} is not a number control`);return n},W=(e,t)=>{let n=e.control(t);if(n.kind!==`choice`)throw Error(`${t} is not a choice control`);return n},G=(e,t)=>{let n=e.control(t);if(n.kind!==`toggle`)throw Error(`${t} is not a toggle control`);return n};function K(e,t=104,n=16){let r=H(`div`,`ly-slider`);r.append(H(`div`,`ly-slider-label`,e.label));let i=H(`div`,`ly-slider-slot`);i.style.setProperty(`--h`,`${t}px`),i.style.setProperty(`--cap`,`${n}px`),i.append(H(`div`,`ly-slider-ticks`),H(`div`,`ly-slider-track`));let a=H(`div`,`ly-slider-cap`);a.append(H(`span`)),i.append(a);let o=H(`input`,`ly-slider-input`);o.type=`range`,o.min=`0`,o.max=String(e.steps),o.step=`1`,o.setAttribute(`aria-label`,e.aria),o.setAttribute(`aria-orientation`,`vertical`);let s=()=>{let r=e.get()/e.steps;a.style.top=`${Math.round((1-r)*(t-n))}px`,o.value=String(e.get()),o.setAttribute(`aria-valuetext`,e.text()),o.title=e.text()};return o.addEventListener(`input`,()=>{e.set(Number(o.value)),s()}),o.addEventListener(`dblclick`,()=>{e.reset(),s()}),e.subscribe(s),s(),i.append(o),r.append(i),r}var q=(e,t,n=`${t} slider`)=>({label:t,aria:n,steps:Hn,get:()=>Un(e),set:t=>e.set(Wn(e,t)),reset:()=>e.set(e.initial),text:()=>`${e.label} ${e.value.toFixed(e.max>100?0:2)} ${e.unit}`.trim(),subscribe:t=>e.onChange(t)}),xr=(e,t)=>({label:t,aria:`${t} slider`,steps:e.options.length-1,get:()=>e.options.indexOf(e.value),set:t=>e.set(e.options[t]),reset:()=>e.set(`1`),text:()=>`position ${e.value}`,subscribe:t=>e.onChange(t)});function J(e){let t=H(`div`,`ly-key-wrap`);t.append(H(`i`,`ly-led`));let n=H(`button`,`ly-key ly-key-${e.tone}`,e.label);n.type=`button`,n.setAttribute(`aria-label`,e.aria),e.width&&(n.style.width=`${e.width}px`),n.addEventListener(`click`,e.click);let r=()=>{let r=e.on();n.setAttribute(`aria-pressed`,String(r)),t.classList.toggle(`lit`,r)};return e.subscribe(r),r(),t.append(n),t}var Y=(e,t,n,r=t,i)=>J({label:t,aria:r,tone:n,width:i,on:()=>e.value,click:()=>e.set(!e.value),subscribe:t=>void e.onChange(t)}),X=(e,t,n,r,i,a)=>J({label:n,aria:i,tone:r,width:a,on:()=>e.value===t,click:()=>e.set(t),subscribe:t=>void e.onChange(t)});function Z(e,t,n=``){let r=H(`div`,`ly-group ${n}`.trim());r.append(H(`div`,`ly-group-title`,e));let i=H(`div`,`ly-group-row`);return i.append(...t),r.append(i),r}function Q(e,t,n,r=!1){let i=H(`section`,`ly-section`);i.style.flex=`${n} 1 0`,i.append(H(`div`,`ly-bar${r?` ly-bar-blue`:``}`,e));let a=H(`div`,`ly-section-body`);return a.append(...t),i.append(a),i}var Sr=e=>`<svg aria-hidden="true" width="76" height="66" viewBox="0 0 84 74">
    <path d="M17 58 A28 28 0 1 1 67 58" fill="none" stroke="#d9d5ce" stroke-width="1.3" stroke-dasharray="1 5.2"></path>
    <text x="13" y="70" font-family="Barlow Condensed, sans-serif" font-size="11" font-weight="600" fill="#f4f1ea">0</text>
    <text x="63" y="70" font-family="Barlow Condensed, sans-serif" font-size="11" font-weight="600" fill="#f4f1ea">10</text>
    <circle cx="42" cy="38" r="19" fill="#0b0b0c" stroke="#3f3d42" stroke-width="1.5"></circle>
    <circle cx="42" cy="38" r="13" fill="#161617" stroke="#2c2b2e" stroke-width="1"></circle>
    <rect x="40.8" y="21" width="2.4" height="13" rx="1.2" fill="#f4f1ea" transform="rotate(${Math.round((-135+e*270)*10)/10} 42 38)"></rect>
  </svg>`;function Cr(e,t,n){let r=Qn(Xn(U(e,t),`#f4f1ea`,n),`Lynch`,e=>Sr(e));return r.classList.add(`ly-knob`),r}function wr(e){let t=H(`div`,`ly-lever-wrap`),n=H(`div`,`ly-lever`);n.tabIndex=0,n.setAttribute(`role`,`application`),n.setAttribute(`aria-roledescription`,`bender lever`),n.setAttribute(`aria-label`,`Bender lever: left and right bend the pitch, up adds modulation`);let r=H(`div`,`ly-lever-handle`);n.append(r);let i=()=>{r.style.transform=`translate(${e.pitchBend*54}px, ${-e.modWheel*5}px)`};e.onPerformanceChange(i),i();let a;n.addEventListener(`pointerdown`,t=>{t.preventDefault(),n.focus(),n.setPointerCapture(t.pointerId),a={x:t.clientX,y:t.clientY,bend:e.pitchBend,mod:e.modWheel}}),n.addEventListener(`pointermove`,t=>{a&&(e.setPitchBend(a.bend+(t.clientX-a.x)/54),e.setModWheel(a.mod+(a.y-t.clientY)/40))});let o=()=>{a&&(a=void 0,e.setPitchBend(0),e.setModWheel(0))};n.addEventListener(`pointerup`,o),n.addEventListener(`pointercancel`,o),n.addEventListener(`keydown`,t=>{if(!t.repeat){if(t.key===`ArrowLeft`)e.setPitchBend(-1);else if(t.key===`ArrowRight`)e.setPitchBend(1);else if(t.key===`ArrowUp`)e.setModWheel(1);else return;t.preventDefault()}}),n.addEventListener(`keyup`,t=>{t.key===`ArrowLeft`||t.key===`ArrowRight`?e.setPitchBend(0):t.key===`ArrowUp`&&e.setModWheel(0)});let s=H(`div`,`ly-lever-arrows`);return s.innerHTML=`<svg aria-hidden="true" width="110" height="10" viewBox="0 0 110 10"><path d="M4 5 H106 M4 5 L9 2 M4 5 L9 8 M106 5 L101 2 M106 5 L101 8" fill="none" stroke="#f4f1ea" stroke-width="1.2"></path></svg>`,t.append(n,s),t}function Tr(e){let t=H(`div`,`ly-cheek`),n=H(`div`,`ly-knobs`);n.append(Cr(e,`master.volume`,`Volume`),Cr(e,`master.portamento`,`Portamento`));let r=H(`div`,`ly-bender`),i=H(`div`,`ly-bender-scale`);i.innerHTML=`<span>10</span><span>5</span><span>0</span>`;let a=H(`div`,`ly-bender-sliders`);for(let[t,n]of[[`bend.dco`,`DCO`],[`bend.vcf`,`VCF`],[`bend.lfo`,`LFO`]])a.append(K(q(U(e,t),n,`Bender ${n} sensitivity`),56,12));let o=H(`div`,`ly-trig`),s=H(`span`,void 0,`OFF`),c=H(`span`,void 0,`ON`),l=H(`button`,`ly-trig-switch`);l.type=`button`,l.setAttribute(`aria-label`,`LFO trigger from the lever`),l.append(H(`i`));let u=G(e,`bend.lfoTrig`);l.addEventListener(`click`,()=>u.set(!u.value));let d=()=>l.setAttribute(`aria-pressed`,String(u.value));u.onChange(d),d(),o.append(s,l,c),r.append(i,a,o);let f=H(`div`,`ly-routing`);return f.innerHTML=`<svg aria-hidden="true" width="196" height="26" viewBox="0 0 196 26">
    <path d="M52 0 V10 H92 V22 M82 0 V6 H92 M112 0 V10 H92 M170 0 V14 H132 V22" fill="none" stroke="#f4f1ea" stroke-width="1.2"></path>
    <text x="138" y="25" font-family="Barlow Condensed, sans-serif" font-size="10" font-weight="700" fill="#f4f1ea" letter-spacing="1">LFO TRIG</text>
  </svg>`,t.append(n,r,f,H(`div`,`ly-bender-name`,`BENDER`),wr(e)),t}var Er=`<svg role="img" aria-label="Lynch 106" width="420" height="58" viewBox="-2 -2 350 48" class="ly-logo">
  <g fill="none" stroke="#efe9d6" stroke-width="8" stroke-linejoin="round" stroke-linecap="round">
    <path d="M4 4 V40 H28"></path>
    <g transform="translate(42 0)"><path d="M4 4 L17 22 L30 4 M17 22 V40"></path></g>
    <g transform="translate(84 0)"><path d="M4 40 V4 L30 40 V4"></path></g>
    <g transform="translate(126 0)"><path d="M30 15 V14 Q30 4 20 4 H14 Q4 4 4 14 V30 Q4 40 14 40 H20 Q30 40 30 30 V29"></path></g>
    <g transform="translate(168 0)"><path d="M4 4 V40 M30 4 V40 M4 22 H30"></path></g>
    <g transform="translate(210 0)"><path d="M4 22 H16"></path></g>
    <g transform="translate(238 0)"><path d="M4 14 L14 4 V40"></path></g>
    <g transform="translate(270 0)"><path d="M14 4 H20 Q30 4 30 14 V30 Q30 40 20 40 H14 Q4 40 4 30 V14 Q4 4 14 4 Z"></path></g>
    <g transform="translate(312 0)"><path d="M28 4 H14 Q4 4 4 14 V30 Q4 40 14 40 H20 Q30 40 30 30 Q30 22 20 22 H4"></path></g>
  </g>
</svg>`;function Dr(e){let t=H(`header`,`ly-header`),n=H(`div`,`ly-patch-name`);n.append(H(`div`,`ly-small-label`,`Patch`));let r=H(`div`,`ly-patch-text`);r.setAttribute(`role`,`status`);let i=H(`label`,`ly-channel`);i.append(H(`span`,void 0,`MIDI channel`));let a=H(`select`);for(let t of Ie)a.add(new Option(t===`omni`?`Omni`:t,t,!1,t===e.transport.channel.value));a.addEventListener(`change`,()=>e.transport.channel.set(a.value)),i.append(a),n.append(r,i);let o=H(`div`,`ly-brand`);o.innerHTML=`<div class="ly-stripe"></div>${Er}<div class="ly-stripe ly-stripe-thin"></div><div class="ly-tagline">Programmable Polyphonic Synthesizer</div>`,t.append(n,o);let s=()=>{r.textContent=e.manual?`MANUAL`:e.currentPreset.name.toUpperCase()};return e.onPresetChange(s),s(),t}function Or(e){yr(e);let t=e=>void 0,n=t=>void e.onPresetChange(t),r=H(`div`,`ly-case`);r.append(H(`div`,`ly-end ly-end-left`));let i=H(`div`,`ly-panel`);i.append(Dr(e));let a=H(`div`,`ly-row`),o=W(e,`dco.range`),s=W(e,`dco.pwmSource`);a.append(Q(`LFO`,[K(q(U(e,`lfo.rate`),`Rate`)),K(q(U(e,`lfo.delay`),`Delay`))],2),Q(`DCO`,[(()=>{let t=H(`div`,`ly-top-row`);return t.append(Z(`Range`,[X(o,`16`,`16`,`cream`,`Range 16 foot`,34),X(o,`8`,`8`,`cream`,`Range 8 foot`,34),X(o,`4`,`4`,`cream`,`Range 4 foot`,34)]),Z(`Wave`,[Y(G(e,`dco.pulse`),`Pulse`,`cream`,`Pulse wave`,44),Y(G(e,`dco.saw`),`Saw`,`cream`,`Sawtooth wave`,44)]),Z(`PWM`,[X(s,`man`,`Man`,`orange`,`Pulse width manual`,38),X(s,`lfo`,`LFO`,`orange`,`Pulse width from LFO`,38)])),t})(),K(q(U(e,`dco.lfo`),`LFO`)),K(q(U(e,`dco.pwm`),`PWM`)),K(q(U(e,`dco.sub`),`Sub`)),K(q(U(e,`dco.noise`),`Noise`))],7),Q(`HPF`,[K(xr(W(e,`hpf.freq`),`Freq`))],1.3),Q(`VCF`,[K(q(U(e,`vcf.freq`),`Freq`)),K(q(U(e,`vcf.res`),`Res`)),K(q(U(e,`vcf.env`),`Env`)),K(q(U(e,`vcf.lfo`),`LFO`)),K(q(U(e,`vcf.kybd`),`Kybd`)),(()=>{let t=W(e,`vcf.polarity`);return Z(`Env`,[X(t,`plus`,`+`,`orange`,`Envelope polarity positive`,30),X(t,`minus`,`-`,`orange`,`Envelope polarity inverted`,30)],`ly-stack`)})()],5.5));let c=W(e,`vca.mode`),l=G(e,`chorus.i`),u=G(e,`chorus.ii`),d=e=>{l.onChange(e),u.onChange(e)},f=W(e,`key.transpose`),p=W(e,`assign.mode`),m=H(`div`,`ly-row`);m.append(Q(`VCA`,[K(q(U(e,`vca.level`),`Level`)),Z(`Mode`,[X(c,`env`,`Env`,`orange`,`VCA from envelope`,34),X(c,`gate`,`Gate`,`orange`,`VCA from gate`,34)],`ly-stack`)],2.2),Q(`ENV`,[`attack`,`decay`,`sustain`,`release`].map((t,n)=>K(q(U(e,`env.${t}`),`ADSR`[n]))),4),Q(`Chorus`,[Z(``,[J({label:`Off`,aria:`Chorus off`,tone:`cream`,width:40,on:()=>!l.value&&!u.value,click:()=>{l.set(!1),u.set(!1)},subscribe:e=>d(e)}),Y(l,`I`,`orange`,`Chorus I`,34),Y(u,`II`,`orange`,`Chorus II`,34)])],2.8),Q(`Key`,[Z(``,[J({label:`Transpose`,aria:`Key transpose, steps through five octave settings`,tone:`orange`,width:70,on:()=>f.value!==`0`,click:()=>f.set(f.options[(f.options.indexOf(f.value)+1)%f.options.length]),subscribe:e=>void f.onChange(e)}),Y(G(e,`key.hold`),`Hold`,`cream`,`Hold`,40),X(p,`poly1`,`Poly 1`,`cream`,`Assign mode poly 1`,46),X(p,`poly2`,`Poly 2`,`cream`,`Assign mode poly 2`,46),X(p,`unison`,`Unison`,`cream`,`Assign mode unison`,48)])],4.6));let h=H(`div`,`ly-display`);h.setAttribute(`role`,`status`),h.setAttribute(`aria-label`,`Bank and patch number`);let g=[H(`span`),H(`span`)];h.append(...g);let _=()=>{g[0].textContent=String(e.bank),g[1].textContent=String(e.patchNumber.patch)};n(_),_();let v=(e,t,r)=>Array.from({length:8},(i,a)=>J({label:String(a+1),aria:`${e} ${a+1}`,tone:`blue`,width:30,on:()=>t(a+1),click:()=>r(a+1),subscribe:n})),y=H(`div`,`ly-row`);return y.append(Q(`Group`,vt.map((t,r)=>J({label:t,aria:`Group ${t}`,tone:`cream`,width:30,on:()=>e.group===r,click:()=>e.selectGroup(r),subscribe:n})),1.4,!0),Q(`Bank`,v(`Bank`,t=>e.bank===t,t=>e.selectBank(t)),3.4,!0),Q(`Number`,[h],1.3,!0),Q(`Patch number`,v(`Patch`,t=>!e.manual&&e.patchNumber.patch===t&&e.patchNumber.bank===e.bank&&e.patchNumber.group===e.group,t=>e.selectPatch(t)).slice(0,8),3.4,!0),Q(`Memory`,[J({label:`Manual`,aria:`Manual: the panel is the sound`,tone:`cream`,width:50,on:()=>e.manual,click:()=>e.selectManual(),subscribe:n}),J({label:`Write`,aria:`Write the sound to the selected patch`,tone:`orange`,width:46,on:()=>!1,click:()=>{let t=e.write();br(e.currentSlot,t)},subscribe:t})],1.8)),i.append(a,m,y,pr(e,Tr(e))),r.append(i,H(`div`,`ly-end ly-end-right`)),r}var kr=150;function Ar(e,t,n,r){let i=H(`section`,`midi-strip`),a=H(`div`,`midi-block`);a.append(H(`div`,`fader-label`,`Audio`),r);let o=H(`div`,`midi-block`);o.append(H(`div`,`fader-label`,`MIDI input`));let s=H(`div`,`midi-device`);o.append(s);let c=()=>{if(s.replaceChildren(),e.status===`unsupported`)s.append(H(`div`,`midi-message`,`MIDI is not available in this browser. Try Chrome or Edge.`));else if(e.status===`denied`)s.append(H(`div`,`midi-message`,`MIDI access was blocked. Allow it in the site settings, then reload.`));else if(e.status===`idle`){let t=H(`button`,`btn midi-connect`,`Connect MIDI`);t.type=`button`,t.addEventListener(`click`,()=>void e.connect()),s.append(t)}else{let t=H(`select`,`patch-select`);t.setAttribute(`aria-label`,`MIDI input device`),t.add(new Option(e.inputs.length?`No device selected`:`No MIDI devices found`,``));for(let n of e.inputs)t.add(new Option(n.name,n.id));t.value=e.selectedId??``,t.addEventListener(`change`,()=>e.select(t.value||void 0)),s.append(t)}};e.onChange(c),c();let l=H(`div`,`midi-block`);l.append(H(`div`,`fader-label`,`Incoming clock`));let u=H(`div`,`midi-bpm`,`--.-`),d=H(`div`,`midi-badges`),f=H(`span`,`badge`,`No clock`),p=H(`span`,`badge`,`Stopped`);d.append(f,p),l.append(u,d);let m=H(`div`,`midi-block`);m.append(H(`div`,`fader-label`,`Activity`));let h=H(`div`,`midi-leds`),g={note:H(`span`,`led`),cc:H(`span`,`led`),clock:H(`span`,`led`)};for(let[e,t]of[[`note`,`Notes`],[`cc`,`CC`],[`clock`,`Clock`]]){let n=H(`div`,`led-item`);n.append(g[e],H(`span`,void 0,t)),h.append(n)}m.append(h);let _=H(`div`,`midi-block midi-monitor-block`),v=H(`div`,`midi-monitor-head`);v.append(H(`div`,`fader-label`,`Monitor`));let y=H(`button`,`btn btn-small midi-clear`,`Clear`);y.type=`button`,y.addEventListener(`click`,()=>n.clear()),v.append(y);let b=H(`div`,`midi-log`);b.setAttribute(`role`,`log`),b.setAttribute(`aria-label`,`Recent MIDI messages`),_.append(v,b);let ee=()=>{b.replaceChildren(...n.lines.slice(-5).map(e=>H(`div`,`midi-line midi-line-${e.kind}`,e.text)))};n.onChange(ee),ee(),i.append(a,o,l,m,_);let te=()=>{let e=performance.now(),r=t.bpm,i=t.isLocked(e);u.textContent=r!==void 0&&i?r.toFixed(1):`--.-`,f.textContent=i?`Clock locked`:`No clock`,f.classList.toggle(`on`,i),p.textContent=t.running?`Running`:`Stopped`,p.classList.toggle(`on`,t.running);for(let t of[`note`,`cc`,`clock`])g[t].classList.toggle(`on`,e-n.lastSeen[t]<kr);requestAnimationFrame(te)};return requestAnimationFrame(te),i}var jr=new x,Mr=new Te,Nr=new Vn,Pr=zn.lynch(jr),Fr=new o(Pr),Ir=document.querySelector(`#app`),$=document.createElement(`button`);$.className=`start`,$.textContent=`Start audio`,$.addEventListener(`click`,async()=>{await Fr.start(),$.textContent=`Audio running`,$.disabled=!0});var Lr=Pr.device(`lynch`);function Rr(e,t=performance.now()){let n=ye(e);n&&(jr.handle(n,t),Mr.record(n,t),Lr.handleMidi(n))}Nr.onMessage=(e,t)=>Rr(e,t),Nr.connectIfPermitted();var zr=document.createElement(`nav`);zr.className=`pipe-nav`,zr.innerHTML=`<a href="/mixer/">The mixer</a><a href="/pipe/">MOA-PIPE</a><a href="/">moaswift.no</a>`,Ir.append(zr,Ar(Nr,jr,Mr,$),Or(Lr));