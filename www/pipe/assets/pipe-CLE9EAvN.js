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
`,a=.01,o=class{patch;ctx;compressors=new Map;grainViews=new Map;pipeViews=new Map;meters=new Map;constructor(e){this.patch=e}async start(){if(!this.ctx){let e=new AudioContext;await e.audioWorklet.addModule(ce()),this.build(e)}await this.ctx?.resume()}async stop(){await this.ctx?.suspend()}get currentTime(){return this.ctx?.currentTime??0}readLevel(e,t){let n=this.meters.get(`${e}/${t}`);if(!n)return 0;n.analyser.getFloatTimeDomainData(n.buffer);let r=0;for(let e of n.buffer)r=Math.max(r,Math.abs(e));return r}readGranular(e,t){return this.grainViews.get(`${e}/${t}`)}readPipe(e,t){return this.pipeViews.get(`${e}/${t}`)}readReduction(e,t){return this.compressors.get(`${e}/${t}`)?.reduction??0}build(e){this.ctx=e;let t=new Map;for(let[n,r]of this.patch.devices)t.set(n,this.compileCircuit(e,n,r.circuit));let n=(e,n,r)=>{let i=this.patch.device(e).jack(n,r).nodeId,a=t.get(e)?.get(i);if(!a)throw Error(`No audio node for ${e}.${r}`);return a};for(let e of this.patch.connections)n(e.from.device,`out`,e.from.jack).connect(n(e.to.device,`in`,e.to.jack));if(this.patch.output){let{device:t,jack:r}=this.patch.output;n(t,`out`,r).connect(e.destination)}}compileCircuit(t,i,o){let c=new Map;for(let a of o.nodes.values())switch(a.kind){case`oscillator`:{let e=t.createOscillator();e.type=a.options.waveform,e.frequency.value=a.params.frequency??440,e.detune.value=a.params.detune??0,e.start(),c.set(a.id,e);break}case`filter`:{let e=t.createBiquadFilter();e.type=a.options.type,e.frequency.value=a.params.frequency??350,e.Q.value=a.params.Q??1,e.gain.value=a.params.gain??0,e.detune.value=a.params.detune??0,c.set(a.id,e);break}case`envelope`:{let e=t.createConstantSource();e.offset.value=0,e.start(),c.set(a.id,e);break}case`convolver`:{let e=t.createConvolver();e.buffer=ee(t,C[a.options.size??`medium`]??C.medium),c.set(a.id,e);break}case`follower`:{let e=new AudioWorkletNode(t,oe,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],parameterData:{attack:a.params.attack??.003,release:a.params.release??.12}});c.set(a.id,e);break}case`granular`:{let{maxTime:n,...r}=a.params,o=new AudioWorkletNode(t,e,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],parameterData:r,processorOptions:{seconds:n??20}});o.port.onmessage=e=>this.grainViews.set(`${i}/${a.id}`,e.data),c.set(a.id,o);break}case`pipe`:{let e=new AudioWorkletNode(t,n,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params});e.port.onmessage=e=>this.pipeViews.set(`${i}/${a.id}`,e.data),c.set(a.id,e);break}case`spring`:c.set(a.id,new AudioWorkletNode(t,r,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params}));break;case`compressor`:{let e=t.createDynamicsCompressor();this.compressors.set(`${i}/${a.id}`,e),e.threshold.value=a.params.threshold??-24,e.knee.value=a.params.knee??30,e.ratio.value=a.params.ratio??12,e.attack.value=a.params.attack??.003,e.release.value=a.params.release??.25,c.set(a.id,e);break}case`delay`:{let e=t.createDelay(a.params.maxTime??1);e.delayTime.value=a.params.delayTime??.25,c.set(a.id,e);break}case`trigger`:{let e=t.createConstantSource();e.offset.value=0,e.start(),c.set(a.id,e);break}case`constant`:{let e=t.createConstantSource();e.offset.value=a.params.offset??0,e.start(),c.set(a.id,e);break}case`waveshaper`:{let e=t.createWaveShaper();a.options.curve===`pulse`?e.curve=g():a.options.curve===`soft`?e.curve=v():a.options.curve===`limit`?e.curve=y():a.options.curve===`warm`?e.curve=b():a.options.curve===`abs`?e.curve=x():a.options.curve===`crush`&&(e.curve=S(a.params.bits??16)),e.oversample=`4x`,c.set(a.id,e);break}case`noise`:{let e=t.createBufferSource();e.buffer=te(t),e.loop=!0,e.start(),c.set(a.id,e);break}case`random`:{let e=t.createBufferSource();e.buffer=w(t),e.loop=!0,e.playbackRate.value=(a.params.rate??4)/re,e.start(),c.set(a.id,e);break}case`meter`:{let e=t.createAnalyser();e.fftSize=1024;let n=a.options.channel??`mono`;if(n===`mono`)c.set(a.id,e);else{let r=t.createChannelSplitter(2);r.connect(e,n===`left`?0:1),c.set(a.id,r)}this.meters.set(`${i}/${a.id}`,{analyser:e,buffer:new Float32Array(new ArrayBuffer(e.fftSize*4))});break}case`pan`:{let e=t.createStereoPanner();e.pan.value=a.params.pan??0,c.set(a.id,e);break}case`gain`:{let e=t.createGain();e.gain.value=a.params.gain??1,a.options.channels===`mono`&&(e.channelCount=1,e.channelCountMode=`explicit`),c.set(a.id,e);break}}for(let e of o.cables){let t=c.get(e.from),n=c.get(e.to);if(t&&n){if(e.port===`in`)t.connect(n);else{let r=s(n,e.port);r&&t.connect(r)}}}return o.onChange(e=>{let n=c.get(e.nodeId);n&&(e.type===`note`?n instanceof AudioWorkletNode&&n.port.postMessage(e):e.type===`trigger`||e.type===`choke`?n instanceof ConstantSourceNode&&(e.type===`trigger`?m(t,n.offset,o.node(e.nodeId).params,o.node(e.nodeId).options.shape,e.velocity,e.when):h(t,n.offset,e.when)):o.node(e.nodeId).kind!==`trigger`&&(n instanceof WaveShaperNode&&e.type===`param`&&e.name===`bits`?n.curve=S(e.value):o.node(e.nodeId).kind===`envelope`?n instanceof ConstantSourceNode&&e.type===`param`&&e.name===`gate`&&l(t,n.offset,o.node(e.nodeId).params,e.value>0):n instanceof AudioBufferSourceNode&&e.type===`param`&&e.name===`rate`?n.playbackRate.setTargetAtTime(e.value/re,t.currentTime,a):e.type===`option`?n instanceof OscillatorNode&&e.name===`waveform`||n instanceof BiquadFilterNode&&e.name===`type`?n.type=e.value:n instanceof ConvolverNode&&e.name===`size`&&(n.buffer=ee(t,C[e.value]??C.medium)):s(n,e.name)?.setTargetAtTime(e.value,t.currentTime,ae(o,e.nodeId,e.name))))}),c}};function s(e,t){if(e instanceof AudioWorkletNode)return e.parameters.get(t);let n=e[t];return n instanceof AudioParam?n:void 0}var c=.001;function l(e,t,n,r){let i=e.currentTime;if(t.cancelScheduledValues(i),t.setValueAtTime(t.value,i),r){let e=Math.max(n.attack??.01,c);t.linearRampToValueAtTime(1,i+e),t.setTargetAtTime(n.sustain??.7,i+e,Math.max(n.decay??.2,c)/3)}else t.setTargetAtTime(0,i,Math.max(n.release??.3,c)/3)}var u=.001,d=3,f=.0035,p=.005;function m(e,t,n,r,i,a){let o=n.velSens??1,s=(n.peak??1)*(1-o+o*i),l=Math.max(n.decay??.2,c)/4,p=Math.max(a??0,e.currentTime);if(t.cancelScheduledValues(p),t.setValueAtTime(t.value,p),t.linearRampToValueAtTime(s,p+u),r!==`clap`){t.setTargetAtTime(0,p+u,l);return}let m=Math.max(n.spread??.012,.002);t.setTargetAtTime(0,p+u,f);for(let e=1;e<=d;e++){let n=p+e*m;t.setValueAtTime(s,n),t.setTargetAtTime(0,n,e===d?l:f)}}function h(e,t,n){let r=Math.max(n??0,e.currentTime);t.cancelScheduledValues(r),t.setValueAtTime(t.value,r),t.setTargetAtTime(0,r,p)}function g(){let e=1024,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++)t[n]=n<e/2?-1:1;return t}var _=2.5;function v(){let e=2048,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++){let e=n/2047*2-1;t[n]=Math.tanh(_*e)/Math.tanh(_)}return t}function y(){let e=4097,t=new Float32Array(new ArrayBuffer(e*4)),n=.9;for(let r=0;r<e;r++){let e=r/4096*2-1,i=Math.abs(e);t[r]=Math.sign(e)*(i<n?i:n+.09999999999999998*Math.tanh((i-n)/.09999999999999998))}return t}function b(){let e=4097,t=new Float32Array(new ArrayBuffer(e*4)),n=.6;for(let r=0;r<e;r++){let e=r/4096*2-1,i=Math.abs(e)*3;t[r]=Math.sign(e)*(i<n?i:n+.4*Math.tanh((i-n)/.4))}return t}function x(){let e=1025,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++)t[n]=Math.abs(n/1024*2-1);return t}function S(e){let t=8193,n=new Float32Array(new ArrayBuffer(t*4)),r=2**Math.max(1,Math.min(16,e))/2;for(let e=0;e<t;e++){let t=e/8192*2-1;n[e]=Math.round(t*r)/r}return n}var C={small:.9,medium:2.4,large:5};function ee(e,t){let n=e.sampleRate,r=Math.floor(n*t),i=e.createBuffer(2,r,n),a=Math.log(1e3)/t;for(let e=0;e<2;e++){let t=i.getChannelData(e),o=0;for(let e=0;e<r;e++){let r=e/n,i=Math.exp(-a*r)*Math.min(1,r/.004),s=.75*Math.exp(-r*1.2)+.06;o+=s*(Math.random()*2-1-o),t[e]=o*i}}return i}function te(e){let t=e.createBuffer(1,e.sampleRate*2,e.sampleRate),n=t.getChannelData(0);for(let e=0;e<n.length;e++)n[e]=Math.random()*2-1;return t}var ne=64,re=10,ie=8e3;function w(e){let t=ie/re,n=e.createBuffer(1,ne*t,ie),r=n.getChannelData(0);for(let e=0;e<ne;e++)r.fill(Math.random()*2-1,e*t,(e+1)*t);return n}function ae(e,t,n){let r=e.node(t);return r.kind===`constant`&&n===`offset`&&r.params.glide?Math.max(r.params.glide/3,a):a}var oe=`moa-follower`,se=[`
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
registerProcessor('${oe}', MoaFollower);
`,t,i].join(`
`);function ce(){return URL.createObjectURL(new Blob([se],{type:`text/javascript`}))}var le=24,ue=48,de=12,fe=1e3,pe=500,T=class{intervals=[];last;isRunning=!1;pulses=0;get running(){return this.isRunning}get ticks(){return this.pulses}get bpm(){if(this.intervals.length<de)return;let e=[...this.intervals].sort((e,t)=>e-t),t=Math.floor(e.length/4),n=e.slice(t,e.length-t);return 6e4/(n.reduce((e,t)=>e+t,0)/n.length*le)}isLocked(e){return this.last!==void 0&&this.intervals.length>=de&&e-this.last<pe}get position(){return me(this.pulses)}handle(e,t){switch(e.type){case`clock`:if(this.last!==void 0){let e=t-this.last;e>fe?this.intervals=[]:this.intervals.push(e),this.intervals.length>ue&&this.intervals.shift()}this.last=t,this.isRunning&&this.pulses++;break;case`start`:this.isRunning=!0,this.pulses=0;break;case`continue`:this.isRunning=!0;break;case`stop`:this.isRunning=!1}}};function me(e){return{bar:Math.floor(e/96)+1,beat:Math.floor(e/le)%4+1,sixteenth:Math.floor(e/(le/4))%4+1}}function he(e){let t=e[0];if(t===void 0)return;if(t>=240)switch(t){case 248:return{type:`clock`};case 250:return{type:`start`};case 251:return{type:`continue`};case 252:return{type:`stop`};default:return}let n=t&240,r=(t&15)+1,i=(e[1]??0)&127,a=(e[2]??0)&127;switch(n){case 128:return{type:`noteOff`,channel:r,note:i,velocity:a};case 144:return a===0?{type:`noteOff`,channel:r,note:i,velocity:0}:{type:`noteOn`,channel:r,note:i,velocity:a};case 176:return{type:`cc`,channel:r,controller:i,value:a};case 192:return{type:`programChange`,channel:r,program:i};case 224:return{type:`pitchBend`,channel:r,value:(a<<7|i)/8192-1};default:return}}var ge=[`C`,`C#`,`D`,`D#`,`E`,`F`,`F#`,`G`,`G#`,`A`,`A#`,`B`];function _e(e){return`${ge[e%12]}${Math.floor(e/12)-2}`}function ve(e){switch(e.type){case`noteOn`:case`noteOff`:return`note`;case`cc`:return`cc`;case`clock`:case`start`:case`continue`:case`stop`:return`clock`;default:return`other`}}function ye(e){switch(e.type){case`noteOn`:return`ch${e.channel}  note on  ${_e(e.note)}  vel ${e.velocity}`;case`noteOff`:return`ch${e.channel}  note off  ${_e(e.note)}`;case`cc`:return`ch${e.channel}  cc ${e.controller}  = ${e.value}`;case`pitchBend`:return`ch${e.channel}  bend  ${e.value.toFixed(2)}`;case`programChange`:return`ch${e.channel}  program  ${e.program}`;case`clock`:return`clock`;default:return`clock ${e.type}`}}var be=40,xe=class{lines=[];lastSeen={note:-1/0,cc:-1/0,clock:-1/0,other:-1/0};listeners=new Set;record(e,t){if(this.lastSeen[ve(e)]=t,e.type!==`clock`){this.lines.push({text:ye(e),kind:ve(e)}),this.lines.length>be&&this.lines.shift();for(let e of this.listeners)e()}}clear(){this.lines.length=0;for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}},Se=class{nodes=new Map;cables=[];listeners=new Set;add(e,t,n={},r={}){if(this.nodes.has(e))throw Error(`Duplicate node id: ${e}`);return this.nodes.set(e,{id:e,kind:t,params:{...n},options:{...r}}),this}connect(e,t,n=`in`){this.node(e);let r=this.node(t);if(n!==`in`&&!(n in r.params))throw Error(`Node ${t} has no param ${n}`);if(this.cables.some(r=>r.from===e&&r.to===t&&r.port===n))throw Error(`Duplicate cable ${e} -> ${t}.${n}`);return this.cables.push({from:e,to:t,port:n}),this}setParam(e,t,n){let r=this.node(e);if(!(t in r.params))throw Error(`Node ${e} has no param ${t}`);r.params[t]=n,this.emit({type:`param`,nodeId:e,name:t,value:n})}setOption(e,t,n){let r=this.node(e);if(!(t in r.options))throw Error(`Node ${e} has no option ${t}`);r.options[t]=n,this.emit({type:`option`,nodeId:e,name:t,value:n})}trigger(e,t=1,n){this.expectKind(e,`trigger`),this.emit({type:`trigger`,nodeId:e,velocity:Math.min(1,Math.max(0,t)),when:n})}choke(e,t){this.expectKind(e,`trigger`),this.emit({type:`choke`,nodeId:e,when:t})}noteOn(e,t,n=1){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:t,velocity:Math.min(1,Math.max(0,n))})}noteOff(e,t){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:t,velocity:0})}allNotesOff(e){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:-1,velocity:0})}pedal(e,t){this.expectKind(e,`pipe`),this.emit({type:`note`,nodeId:e,note:-2,velocity:+!!t})}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}node(e){let t=this.nodes.get(e);if(!t)throw Error(`Unknown node: ${e}`);return t}expectKind(e,...t){if(!t.includes(this.node(e).kind))throw Error(`Node ${e} is not a ${t.join(` or `)}`)}emit(e){for(let t of this.listeners)t(e)}},E=class{circuit=new Se;controlList=[];inputList=[];outputList=[];meterList=[];get controls(){return this.controlList}get inputs(){return this.inputList}get outputs(){return this.outputList}get meters(){return this.meterList}control(e){let t=this.controlList.find(t=>t.id===e);if(!t)throw Error(`${this.name} has no control ${e}`);return t}jack(e,t){let n=(e===`in`?this.inputList:this.outputList).find(e=>e.name===t);if(!n)throw Error(`${this.name} has no ${e} jack ${t}`);return n}},Ce=class{listeners=new Set;onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}notify(){for(let e of this.listeners)e()}},D=class extends Ce{id;label;min;max;initial;unit;apply;curve;kind=`number`;current;constructor(e,t,n,r,i,a,o,s=`linear`){super(),this.id=e,this.label=t,this.min=n,this.max=r,this.initial=i,this.unit=a,this.apply=o,this.curve=s,this.current=we(this.initial,n,r),this.apply(this.current)}get value(){return this.current}set(e){this.current=we(e,this.min,this.max),this.apply(this.current),this.notify()}},O=class extends Ce{id;label;options;apply;kind=`choice`;current;constructor(e,t,n,r,i){if(super(),this.id=e,this.label=t,this.options=n,this.apply=i,!n.includes(r))throw Error(`Invalid initial choice ${r}`);this.current=r,this.apply(this.current)}get value(){return this.current}set(e){if(!this.options.includes(e))throw Error(`Invalid choice ${e} for ${this.id}`);this.current=e,this.apply(e),this.notify()}},k=class extends Ce{id;label;apply;kind=`toggle`;current;constructor(e,t,n,r){super(),this.id=e,this.label=t,this.apply=r,this.current=n,this.apply(n)}get value(){return this.current}set(e){this.current=e,this.apply(e),this.notify()}};function we(e,t,n){return Math.min(n,Math.max(t,e))}var Te={"bc.threshold":-18,"bc.ratio":4,"bc.attack":10,"bc.release":200,"bc.knee":6,"bc.makeup":3,"bc.mix":1,"bc.duck.depth":0,"bc.duck.release":120,"bc.duck.keyHp":80,"bc.bypass":0,"bc.listen":0},A=(e,t)=>({name:e,values:t}),Ee=[A(`Init`,{}),A(`Glue`,{"bc.threshold":-14,"bc.ratio":2,"bc.attack":30,"bc.release":400,"bc.knee":12,"bc.makeup":2}),A(`Kick Duck`,{"bc.threshold":-6,"bc.ratio":1.5,"bc.makeup":0,"bc.duck.depth":.7,"bc.duck.release":140}),A(`Gentle Pump`,{"bc.threshold":-16,"bc.ratio":2,"bc.makeup":3,"bc.duck.depth":.35,"bc.duck.release":220}),A(`Hard Pump`,{"bc.threshold":-12,"bc.ratio":4,"bc.makeup":2,"bc.duck.depth":.95,"bc.duck.release":90,"bc.duck.keyHp":120}),A(`NY Parallel`,{"bc.threshold":-32,"bc.ratio":8,"bc.attack":3,"bc.release":100,"bc.knee":4,"bc.makeup":10,"bc.mix":.4}),A(`Drum Smash`,{"bc.threshold":-28,"bc.ratio":20,"bc.attack":1,"bc.release":200,"bc.knee":0,"bc.makeup":8,"bc.mix":.7}),A(`Limiter`,{"bc.threshold":-4,"bc.ratio":20,"bc.attack":1,"bc.release":100,"bc.knee":0,"bc.makeup":0})],De=4,Oe=e=>10**(e/20);function ke(e,t,n){let r=e+n/2<0?e+(0-e)/t:0;return-.6*Math.min(0,r)}var Ae=class extends E{name;slots=[...Ee];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;mix=1;makeupDb=3;threshold=-18;ratio=4;knee=6;bypass=!1;listen=!1;constructor(e=`Bus Comp`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`duck`,`gain`,{gain:1}).add(`gate`,`gain`,{gain:1}).add(`comp`,`compressor`,{threshold:-18,knee:6,ratio:4,attack:.01,release:.2}).add(`wet`,`gain`,{gain:Oe(3)}).add(`dry`,`gain`,{gain:0}).add(`bypassPath`,`gain`,{gain:0}).add(`listenPath`,`gain`,{gain:0}).add(`out`,`gain`,{gain:1}).add(`inMeter`,`meter`,{},{channel:`mono`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`inMeter`).connect(`in`,`duck`).connect(`duck`,`gate`).connect(`gate`,`comp`).connect(`gate`,`dry`).connect(`comp`,`wet`).connect(`wet`,`out`).connect(`dry`,`out`).connect(`in`,`bypassPath`).connect(`bypassPath`,`out`).connect(`listenPath`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),t.add(`key`,`gain`,{gain:1},{channels:`mono`}).add(`keyHp`,`filter`,{frequency:80,Q:.707,detune:0},{type:`highpass`}).add(`follow`,`follower`,{attack:.003,release:.12}).add(`sense`,`gain`,{gain:De}).add(`keyShape`,`waveshaper`,{},{curve:`soft`}).add(`duckMeter`,`meter`,{},{channel:`mono`}).add(`depth`,`gain`,{gain:0}).connect(`key`,`keyHp`).connect(`keyHp`,`follow`).connect(`follow`,`sense`).connect(`sense`,`keyShape`).connect(`keyShape`,`duckMeter`).connect(`keyShape`,`depth`).connect(`depth`,`duck`,`gain`).connect(`keyHp`,`listenPath`),this.inputList.push({name:`in`,nodeId:`in`},{name:`key`,nodeId:`key`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`in`,nodeId:`inMeter`},{name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`},{name:`duck`,nodeId:`duckMeter`});let n=Te,r=(e,t,r,i,a,o,s)=>this.controlList.push(new D(e,t,r,i,n[e],a,o,s));r(`bc.threshold`,`Threshold`,-60,0,`dB`,e=>{this.threshold=e,t.setParam(`comp`,`threshold`,e),this.applyMix()}),r(`bc.ratio`,`Ratio`,1,20,`:1`,e=>{this.ratio=e,t.setParam(`comp`,`ratio`,e),this.applyMix()}),r(`bc.attack`,`Attack`,.3,100,`ms`,e=>t.setParam(`comp`,`attack`,e/1e3),`log`),r(`bc.release`,`Release`,30,1e3,`ms`,e=>t.setParam(`comp`,`release`,e/1e3),`log`),r(`bc.knee`,`Knee`,0,30,`dB`,e=>{this.knee=e,t.setParam(`comp`,`knee`,e),this.applyMix()}),r(`bc.makeup`,`Make-up`,0,24,`dB`,e=>{this.makeupDb=e,this.applyMix()}),r(`bc.mix`,`Mix`,0,1,``,e=>{this.mix=e,this.applyMix()}),r(`bc.duck.depth`,`Duck depth`,0,1,``,e=>t.setParam(`depth`,`gain`,-e)),r(`bc.duck.release`,`Duck release`,20,800,`ms`,e=>t.setParam(`follow`,`release`,e/1e3),`log`),r(`bc.duck.keyHp`,`Key HP`,20,300,`Hz`,e=>t.setParam(`keyHp`,`frequency`,e),`log`),this.controlList.push(new k(`bc.bypass`,`Bypass`,!1,e=>{this.bypass=e,this.applyPaths()}),new k(`bc.listen`,`Key listen`,!1,e=>{this.listen=e,this.applyPaths()}))}applyMix(){this.circuit.setParam(`dry`,`gain`,1-this.mix),this.circuit.setParam(`wet`,`gain`,this.mix*Oe(this.makeupDb-ke(this.threshold,this.ratio,this.knee)))}applyPaths(){let e=this.circuit;e.setParam(`gate`,`gain`,this.bypass||this.listen?0:1),e.setParam(`bypassPath`,`gain`,this.bypass&&!this.listen?1:0),e.setParam(`listenPath`,`gain`,+!!this.listen)}loadPreset(e){let t={...Te,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`bc.bypass`&&t.id!==`bc.listen`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}},je=[`internal`,`midi`],Me=[`omni`,...Array.from({length:16},(e,t)=>String(t+1))],Ne=2e3,Pe=4,Fe=class{clock;now;sync=new O(`transport.sync`,`Sync`,je,`internal`,()=>{});followStartStop=new k(`transport.followStartStop`,`Start/stop`,!0,()=>{});channel=new O(`transport.channel`,`Channel`,Me,`1`,()=>{});tempo=new D(`transport.tempo`,`Tempo`,20,300,120,`BPM`,()=>{});taps=[];constructor(e,t=()=>performance.now()){this.clock=e,this.now=t}get synced(){return this.sync.value===`midi`}get bpm(){return this.synced?this.clock.bpm??this.tempo.value:this.tempo.value}get locked(){return this.synced&&this.clock.isLocked(this.now())}get running(){return this.synced&&this.followStartStop.value&&this.clock.running}get position(){return this.running?this.clock.position:me(0)}acceptsChannel(e){return this.channel.value===`omni`||Number(this.channel.value)===e}tap(e=this.now()){let t=this.taps[this.taps.length-1];if(t!==void 0&&e-t>Ne&&(this.taps=[]),this.taps.push(e),this.taps.length>Pe&&this.taps.shift(),this.taps.length>=2){let e=this.taps[this.taps.length-1]-this.taps[0];this.tempo.set(Math.round(6e4/(e/(this.taps.length-1))*10)/10)}}nudge(e){this.tempo.set(Math.round((this.tempo.value+e)*10)/10)}},j=[`kick`,`snare`,`clap`,`closedHat`,`openHat`,`ride`],Ie={35:`kick`,36:`kick`,38:`snare`,40:`snare`,39:`clap`,42:`closedHat`,44:`closedHat`,46:`openHat`,51:`ride`,59:`ride`},Le=1200,Re=[205.3,304.4,369.6,522.7,540,800],ze=class extends E{name;transport;choke=new k(`hats.choke`,`Choke`,!0,()=>{});muted=new Set;soloed=new Set;envelopes=new Map;hitListeners=new Set;constructor(e=`Drums`,t=new T){super(),this.name=e,this.transport=new Fe(t),this.transport.channel.set(`10`);let n=this.circuit;this.addKick(n),this.addSnare(n),this.addClap(n),this.addHat(n,`closedHat`,{decay:[.015,.25,.04],tone:.7,level:.6}),this.addHat(n,`openHat`,{decay:[.1,1.5,.32],tone:.65,level:.6}),this.addRide(n);for(let e of j)n.add(`${e}.mute`,`gain`,{gain:1}).add(`${e}.out`,`gain`,{gain:.8}).add(`${e}.meter`,`meter`,{},{channel:`mono`}).connect(`${e}.sum`,`${e}.mute`).connect(`${e}.mute`,`${e}.out`).connect(`${e}.out`,`${e}.meter`),this.outputList.push({name:e,nodeId:`${e}.out`}),this.meterList.push({name:e,nodeId:`${e}.meter`});this.addLevels(n),this.controlList.push(this.choke)}trigger(e,t=1,n){if(!(t<=0)){e===`closedHat`&&this.choke.value&&this.circuit.choke(`openHat.ampEnv`,n);for(let r of this.envelopes.get(e)??[])this.circuit.trigger(r,t,n);for(let r of this.hitListeners)r(e,t,n)}}onHit(e){return this.hitListeners.add(e),()=>this.hitListeners.delete(e)}handleMidi(e){if(e.type!==`noteOn`||!this.transport.acceptsChannel(e.channel))return;let t=Ie[e.note];t&&this.trigger(t,e.velocity/127)}get soloActive(){return this.soloed.size>0}register(e,...t){this.envelopes.set(e,[...this.envelopes.get(e)??[],...t])}num(...e){let t=new D(...e);return this.controlList.push(t),t}addKick(e){this.register(`kick`,`kick.pitchEnv`,`kick.ampEnv`,`kick.clickEnv`),e.add(`kick.osc`,`oscillator`,{frequency:48,detune:0},{waveform:`sine`}).add(`kick.pitchEnv`,`trigger`,{peak:2700,decay:.05,velSens:0}).add(`kick.ampEnv`,`trigger`,{peak:.8,decay:.38,velSens:.8}).add(`kick.amp`,`gain`,{gain:0}).add(`kick.noise`,`noise`).add(`kick.clickHp`,`filter`,{frequency:2500,Q:.707},{type:`highpass`}).add(`kick.clickAmp`,`gain`,{gain:0}).add(`kick.clickEnv`,`trigger`,{peak:.24,decay:.012,velSens:1}).add(`kick.sum`,`gain`,{gain:1}).connect(`kick.pitchEnv`,`kick.osc`,`detune`).connect(`kick.osc`,`kick.amp`).connect(`kick.ampEnv`,`kick.amp`,`gain`).connect(`kick.amp`,`kick.sum`).connect(`kick.noise`,`kick.clickHp`).connect(`kick.clickHp`,`kick.clickAmp`).connect(`kick.clickEnv`,`kick.clickAmp`,`gain`).connect(`kick.clickAmp`,`kick.sum`),this.num(`kick.tune`,`Tune`,30,120,48,`Hz`,t=>e.setParam(`kick.osc`,`frequency`,t),`log`),this.num(`kick.decay`,`Decay`,.08,1,.38,`s`,t=>e.setParam(`kick.ampEnv`,`decay`,t),`log`),this.num(`kick.click`,`Click`,0,1,.4,``,t=>e.setParam(`kick.clickEnv`,`peak`,t*.6))}addSnare(e){this.register(`snare`,`snare.pitchEnv`,`snare.bodyEnv`,`snare.noiseEnv`),e.add(`snare.osc1`,`oscillator`,{frequency:190,detune:0},{waveform:`triangle`}).add(`snare.osc2`,`oscillator`,{frequency:347.7,detune:0},{waveform:`triangle`}).add(`snare.pitchEnv`,`trigger`,{peak:500,decay:.03,velSens:0}).add(`snare.bodyEnv`,`trigger`,{peak:.4,decay:.1,velSens:.7}).add(`snare.bodyAmp`,`gain`,{gain:0}).add(`snare.noise`,`noise`).add(`snare.noiseHp`,`filter`,{frequency:1800,Q:.707},{type:`highpass`}).add(`snare.noiseEnv`,`trigger`,{peak:.42,decay:.18,velSens:1}).add(`snare.noiseAmp`,`gain`,{gain:0}).add(`snare.sum`,`gain`,{gain:1}).connect(`snare.osc1`,`snare.bodyAmp`).connect(`snare.osc2`,`snare.bodyAmp`).connect(`snare.pitchEnv`,`snare.osc1`,`detune`).connect(`snare.pitchEnv`,`snare.osc2`,`detune`).connect(`snare.bodyEnv`,`snare.bodyAmp`,`gain`).connect(`snare.bodyAmp`,`snare.sum`).connect(`snare.noise`,`snare.noiseHp`).connect(`snare.noiseHp`,`snare.noiseAmp`).connect(`snare.noiseEnv`,`snare.noiseAmp`,`gain`).connect(`snare.noiseAmp`,`snare.sum`),this.num(`snare.tune`,`Tune`,120,300,190,`Hz`,t=>{e.setParam(`snare.osc1`,`frequency`,t),e.setParam(`snare.osc2`,`frequency`,t*1.83)},`log`),this.num(`snare.decay`,`Decay`,.08,.5,.18,`s`,t=>{e.setParam(`snare.noiseEnv`,`decay`,t),e.setParam(`snare.bodyEnv`,`decay`,t*.55)},`log`),this.num(`snare.snap`,`Snap`,0,1,.6,``,t=>e.setParam(`snare.noiseEnv`,`peak`,t*.7))}addClap(e){this.register(`clap`,`clap.env`),e.add(`clap.noise`,`noise`).add(`clap.bp`,`filter`,{frequency:1200,Q:1.5},{type:`bandpass`}).add(`clap.amp`,`gain`,{gain:0}).add(`clap.env`,`trigger`,{peak:2.3,decay:.24,velSens:.8,spread:.012},{shape:`clap`}).add(`clap.sum`,`gain`,{gain:1}).connect(`clap.noise`,`clap.bp`).connect(`clap.bp`,`clap.amp`).connect(`clap.env`,`clap.amp`,`gain`).connect(`clap.amp`,`clap.sum`),this.num(`clap.tone`,`Tone`,600,3e3,1200,`Hz`,t=>e.setParam(`clap.bp`,`frequency`,t),`log`),this.num(`clap.decay`,`Decay`,.08,.6,.24,`s`,t=>e.setParam(`clap.env`,`decay`,t),`log`),this.num(`clap.spread`,`Spread`,0,1,.5,``,t=>e.setParam(`clap.env`,`spread`,.006+t*.012))}addMetal(e,t,n,r,i,a){e.add(`${t}.tune`,`constant`,{offset:0}).add(`${t}.metal`,`gain`,{gain:a}).add(`${t}.bp`,`filter`,{frequency:r,Q:.8},{type:`bandpass`}).add(`${t}.hp`,`filter`,{frequency:i,Q:.707},{type:`highpass`}).connect(`${t}.metal`,`${t}.bp`).connect(`${t}.bp`,`${t}.hp`),Re.forEach((r,i)=>{let a=`${t}.sq${i+1}`;e.add(a,`oscillator`,{frequency:r*n,detune:0},{waveform:`square`}).connect(`${t}.tune`,a,`detune`).connect(a,`${t}.metal`)})}addHat(e,t,n){this.register(t,`${t}.ampEnv`),this.addMetal(e,t,1,9e3,7e3,.45),e.add(`${t}.amp`,`gain`,{gain:0}).add(`${t}.ampEnv`,`trigger`,{peak:1,decay:n.decay[2],velSens:.8}).add(`${t}.sum`,`gain`,{gain:1}).connect(`${t}.hp`,`${t}.amp`).connect(`${t}.ampEnv`,`${t}.amp`,`gain`).connect(`${t}.amp`,`${t}.sum`),this.num(`${t}.tune`,`Tune`,0,1,.6,``,n=>e.setParam(`${t}.tune`,`offset`,(n-.6)*2*Le)),this.num(`${t}.decay`,`Decay`,n.decay[0],n.decay[1],n.decay[2],`s`,n=>e.setParam(`${t}.ampEnv`,`decay`,n),`log`),this.num(`${t}.tone`,`Tone`,0,1,n.tone,``,n=>e.setParam(`${t}.hp`,`frequency`,3e3+n*7e3))}addRide(e){this.register(`ride`,`ride.ampEnv`,`ride.bellEnv`),this.addMetal(e,`ride`,1.3,6500,2500,.18),e.add(`ride.amp`,`gain`,{gain:0}).add(`ride.ampEnv`,`trigger`,{peak:1,decay:1.2,velSens:.8}).add(`ride.bell1`,`oscillator`,{frequency:2650,detune:0},{waveform:`sine`}).add(`ride.bell2`,`oscillator`,{frequency:4380,detune:0},{waveform:`sine`}).add(`ride.bellAmp`,`gain`,{gain:0}).add(`ride.bellEnv`,`trigger`,{peak:.2,decay:.9,velSens:.8}).add(`ride.sum`,`gain`,{gain:1}).connect(`ride.hp`,`ride.amp`).connect(`ride.ampEnv`,`ride.amp`,`gain`).connect(`ride.amp`,`ride.sum`).connect(`ride.tune`,`ride.bell1`,`detune`).connect(`ride.tune`,`ride.bell2`,`detune`).connect(`ride.bell1`,`ride.bellAmp`).connect(`ride.bell2`,`ride.bellAmp`).connect(`ride.bellEnv`,`ride.bellAmp`,`gain`).connect(`ride.bellAmp`,`ride.sum`),this.num(`ride.tune`,`Tune`,0,1,.5,``,t=>e.setParam(`ride.tune`,`offset`,(t-.5)*2*Le)),this.num(`ride.decay`,`Decay`,.4,2.5,1.2,`s`,t=>{e.setParam(`ride.ampEnv`,`decay`,t),e.setParam(`ride.bellEnv`,`decay`,t*.75)},`log`),this.num(`ride.bell`,`Bell`,0,1,.45,``,t=>e.setParam(`ride.bellEnv`,`peak`,t*.45))}addLevels(e){let t={kick:.8,snare:.75,clap:.7,closedHat:.6,openHat:.6,ride:.55};for(let n of j)this.num(`${n}.level`,`Level`,0,1,t[n],``,t=>e.setParam(`${n}.out`,`gain`,t)),this.controlList.push(new k(`${n}.mute`,`Mute`,!1,e=>this.setFlag(this.muted,n,e)),new k(`${n}.solo`,`Solo`,!1,e=>this.setFlag(this.soloed,n,e)))}setFlag(e,t,n){n?e.add(t):e.delete(t);for(let e of j){let t=`${e}.mute`;if(!this.circuit.nodes.has(t))continue;let n=this.muted.has(e)||this.soloed.size>0&&!this.soloed.has(e);this.circuit.setParam(t,`gain`,+!n)}}},Be=[`small`,`medium`,`large`],Ve=3.5,M=Math.tanh(2.5)/2.5,He=2,Ue=class extends E{name;constructor(e=`Reverb`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`pre`,`delay`,{delayTime:.02,maxTime:.3}).add(`conv`,`convolver`,{},{size:`medium`}).add(`lowcut`,`filter`,{frequency:150,Q:.707,detune:0},{type:`highpass`}).add(`damp`,`filter`,{frequency:5e3,Q:.707,detune:0},{type:`lowpass`}).add(`drive`,`gain`,{gain:Ve*M/He}).add(`sat`,`waveshaper`,{},{curve:`soft`}).add(`out`,`gain`,{gain:He}).connect(`in`,`pre`).connect(`pre`,`conv`).connect(`conv`,`lowcut`).connect(`lowcut`,`damp`).connect(`damp`,`drive`).connect(`drive`,`sat`).connect(`sat`,`out`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.controlList.push(new O(`reverb.size`,`Size`,Be,`medium`,e=>t.setOption(`conv`,`size`,e)),new D(`reverb.predelay`,`Pre-delay`,0,250,20,`ms`,e=>t.setParam(`pre`,`delayTime`,e/1e3)),new D(`reverb.lowcut`,`Low cut`,40,600,150,`Hz`,e=>t.setParam(`lowcut`,`frequency`,e),`log`),new D(`reverb.damp`,`Damping`,1e3,16e3,5e3,`Hz`,e=>t.setParam(`damp`,`frequency`,e),`log`))}},We=class extends E{name;spread=.8;feedback=.45;constructor(e=`Delay`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`out`,`gain`,{gain:.5}).add(`wobble`,`oscillator`,{frequency:.9,detune:0},{waveform:`sine`}).add(`wobbleDepth`,`gain`,{gain:6e-4});for(let e of[`L`,`R`]){let n=t=>`${t}${e}`;t.add(n(`inGain`),`gain`,{gain:1}).add(n(`dly`),`delay`,{delayTime:.375,maxTime:2}).add(n(`tone`),`filter`,{frequency:3200,Q:.707,detune:0},{type:`lowpass`}).add(n(`hp`),`filter`,{frequency:120,Q:.707,detune:0},{type:`highpass`}).add(n(`drive`),`gain`,{gain:1.9}).add(n(`sat`),`waveshaper`,{},{curve:`soft`}).add(n(`make`),`gain`,{gain:M/1.9}).add(n(`fbSelf`),`gain`,{gain:0}).add(n(`fbCross`),`gain`,{gain:0}).add(n(`pan`),`pan`,{pan:e===`L`?-1:1}).connect(`in`,n(`inGain`)).connect(n(`inGain`),n(`dly`)).connect(n(`dly`),n(`tone`)).connect(n(`tone`),n(`hp`)).connect(n(`hp`),n(`drive`)).connect(n(`drive`),n(`sat`)).connect(n(`sat`),n(`make`)).connect(n(`make`),n(`fbSelf`)).connect(n(`make`),n(`fbCross`)).connect(n(`sat`),n(`pan`)).connect(n(`pan`),`out`).connect(`wobbleDepth`,n(`dly`),`delayTime`)}t.connect(`fbSelfL`,`dlyL`).connect(`fbCrossL`,`dlyR`).connect(`fbSelfR`,`dlyR`).connect(`fbCrossR`,`dlyL`).connect(`wobble`,`wobbleDepth`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`});let n=e=>{e(`L`),e(`R`)};this.controlList.push(new D(`delay.time`,`Time`,20,1500,375,`ms`,e=>n(n=>t.setParam(`dly${n}`,`delayTime`,e/1e3)),`log`),new D(`delay.feedback`,`Feedback`,0,1.1,.45,``,e=>{this.feedback=e,this.applyFeedback()}),new D(`delay.tone`,`Tone`,400,12e3,3200,`Hz`,e=>n(n=>t.setParam(`tone${n}`,`frequency`,e)),`log`),new D(`delay.spread`,`Ping-pong`,0,1,.8,``,e=>{this.spread=e,this.applyFeedback(),t.setParam(`inGainR`,`gain`,1-e)}),new D(`delay.wobble`,`Wobble`,0,1,.15,``,e=>t.setParam(`wobbleDepth`,`gain`,e*.004)),new D(`delay.drive`,`Drive`,0,1,.3,``,e=>{let r=1+e*3;n(e=>{t.setParam(`drive${e}`,`gain`,r),t.setParam(`make${e}`,`gain`,M/r)})}))}applyFeedback(){let e=this.circuit;for(let t of[`L`,`R`])e.setParam(`fbSelf${t}`,`gain`,this.feedback*(1-this.spread)),e.setParam(`fbCross${t}`,`gain`,this.feedback*this.spread)}},Ge=1,Ke=2,qe=.8,Je={"gr.position":.3,"gr.size":120,"gr.pitch":0,"gr.rate":12,"gr.spread":.5,"gr.cloud":.2,"gr.detune":0,"gr.shape":.3,"gr.reverse":0,"gr.feedback":0,"gr.mix":1,"gr.freeze":0,"gr.filter":2e4,"gr.reso":.7,"gr.drive":0,"gr.reverb":0,"gr.tone":8e3,"gr.tail":`medium`,"gr.play":0,"gr.attack":20,"gr.decay":300,"gr.sustain":.8,"gr.release":600},Ye=3.5,Xe=2,Ze=7,N=(e,t)=>({name:e,values:t}),Qe=[N(`Init`,{}),N(`Cloud Wash`,{"gr.position":.5,"gr.size":350,"gr.rate":30,"gr.spread":1,"gr.cloud":.6,"gr.detune":12,"gr.shape":0,"gr.reverb":.35,"gr.tail":`large`}),N(`Frozen Pad`,{"gr.position":.15,"gr.size":700,"gr.rate":14,"gr.spread":.9,"gr.cloud":.25,"gr.detune":6,"gr.shape":0,"gr.freeze":1,"gr.filter":3500,"gr.reverb":.3,"gr.tail":`large`}),N(`Stutter`,{"gr.position":.02,"gr.size":90,"gr.rate":8,"gr.spread":.2,"gr.cloud":0,"gr.shape":.7}),N(`Octave Shimmer`,{"gr.position":.25,"gr.size":220,"gr.pitch":12,"gr.rate":24,"gr.spread":.8,"gr.cloud":.3,"gr.detune":8,"gr.feedback":.35,"gr.reverb":.25}),N(`Reverse Swell`,{"gr.position":.35,"gr.size":900,"gr.rate":6,"gr.spread":.6,"gr.cloud":.15,"gr.shape":0,"gr.reverse":1}),N(`Glitch Dust`,{"gr.position":.6,"gr.size":25,"gr.rate":70,"gr.spread":1,"gr.cloud":.9,"gr.detune":40,"gr.shape":.8,"gr.reverse":.3,"gr.drive":.35,"gr.filter":9e3,"gr.reso":3}),N(`Tape Drone`,{"gr.position":.1,"gr.size":500,"gr.pitch":-12,"gr.rate":18,"gr.spread":.4,"gr.cloud":.1,"gr.detune":4,"gr.shape":0,"gr.feedback":.6,"gr.filter":1800,"gr.reso":2,"gr.drive":.25})],$e=class extends E{name;slots=[...Qe];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;noteListeners=new Set;performanceListeners=new Set;held=[];bend=0;modWheelValue=0;pitchSemitones=0;constructor(e=`Granular`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`grains`,`granular`,{maxTime:20,position:.3,size:.12,pitch:0,rate:12,spread:.5,cloud:.2,detune:0,shape:.3,reverse:0,feedback:0,freeze:0,play:0,attack:.02,decay:.3,sustain:.8,release:.6}).add(`filter`,`filter`,{frequency:2e4,Q:.7,gain:0,detune:0},{type:`lowpass`}).add(`preDrive`,`gain`,{gain:1}).add(`sat`,`waveshaper`,{},{curve:`soft`}).add(`postDrive`,`gain`,{gain:M}).add(`revSend`,`gain`,{gain:0}).add(`conv`,`convolver`,{},{size:`medium`}).add(`revTone`,`filter`,{frequency:8e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`revDrive`,`gain`,{gain:Ye*M/Xe}).add(`revSat`,`waveshaper`,{},{curve:`soft`}).add(`revOut`,`gain`,{gain:Xe}).add(`wet`,`gain`,{gain:1}).add(`dry`,`gain`,{gain:0}).add(`out`,`gain`,{gain:1}).add(`inMeter`,`meter`,{},{channel:`mono`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`grains`).connect(`in`,`dry`).connect(`in`,`inMeter`).connect(`grains`,`filter`).connect(`filter`,`preDrive`).connect(`preDrive`,`sat`).connect(`sat`,`postDrive`).connect(`postDrive`,`wet`).connect(`wet`,`out`).connect(`postDrive`,`revSend`).connect(`revSend`,`conv`).connect(`conv`,`revTone`).connect(`revTone`,`revDrive`).connect(`revDrive`,`revSat`).connect(`revSat`,`revOut`).connect(`revOut`,`out`).connect(`dry`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`in`,nodeId:`inMeter`},{name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=Je,r=(e,t,r,i,a,o,s)=>this.controlList.push(new D(e,t,r,i,n[e],a,o,s)),i=(e,n,i,a,o,s,c=1,l)=>r(e,n,i,a,o,e=>t.setParam(`grains`,s,e*c),l);i(`gr.position`,`Position`,0,1,``,`position`),i(`gr.size`,`Size`,5,2e3,`ms`,`size`,1/1e3,`log`),r(`gr.pitch`,`Pitch`,-24,24,`st`,e=>{this.pitchSemitones=e,this.applyPitch()}),i(`gr.rate`,`Rate`,.5,100,`Hz`,`rate`,1,`log`),i(`gr.spread`,`Spread`,0,1,``,`spread`),i(`gr.cloud`,`Cloud`,0,1,``,`cloud`),i(`gr.detune`,`Detune`,0,100,`ct`,`detune`),i(`gr.shape`,`Shape`,0,1,``,`shape`),i(`gr.reverse`,`Reverse`,0,1,``,`reverse`),i(`gr.feedback`,`Feedback`,0,.95,``,`feedback`),r(`gr.filter`,`Filter`,40,2e4,`Hz`,e=>t.setParam(`filter`,`frequency`,e),`log`),r(`gr.reso`,`Reso`,.7,12,``,e=>t.setParam(`filter`,`Q`,e),`log`),r(`gr.drive`,`Drive`,0,1,``,e=>{t.setParam(`preDrive`,`gain`,1+Ze*e),t.setParam(`postDrive`,`gain`,M/(1+2*e))}),r(`gr.reverb`,`Reverb`,0,1,``,e=>t.setParam(`revSend`,`gain`,e)),r(`gr.tone`,`Tone`,1e3,16e3,`Hz`,e=>t.setParam(`revTone`,`frequency`,e),`log`),r(`gr.mix`,`Mix`,0,1,``,e=>{t.setParam(`wet`,`gain`,e),t.setParam(`dry`,`gain`,1-e)}),r(`gr.attack`,`Attack`,1,4e3,`ms`,e=>t.setParam(`grains`,`attack`,e/1e3),`log`),r(`gr.decay`,`Decay`,5,4e3,`ms`,e=>t.setParam(`grains`,`decay`,e/1e3),`log`),r(`gr.sustain`,`Sustain`,0,1,``,e=>t.setParam(`grains`,`sustain`,e)),r(`gr.release`,`Release`,5,8e3,`ms`,e=>t.setParam(`grains`,`release`,e/1e3),`log`),this.controlList.push(new k(`gr.play`,`Keys`,!1,e=>{t.setParam(`grains`,`play`,+!!e),e||this.releaseAll()}),new O(`gr.channel`,`MIDI channel`,Me,`3`,()=>{}),new O(`gr.tail`,`Tail`,Be,`medium`,e=>t.setOption(`conv`,`size`,e)),new k(`gr.freeze`,`Freeze`,!1,e=>t.setParam(`grains`,`freeze`,+!!e)))}applyPitch(){this.circuit.setParam(`grains`,`pitch`,this.pitchSemitones+this.bend*Ke)}releaseAll(){if(this.circuit.allNotesOff(`grains`),this.held.length>0){this.held=[];for(let e of this.noteListeners)e()}}keyDown(e,t=qe){let n=this.control(`gr.play`);n.kind===`toggle`&&!n.value&&n.set(!0),this.held=this.held.filter(t=>t!==e),this.held.push(e),this.circuit.noteOn(`grains`,e,t);for(let e of this.noteListeners)e()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.circuit.noteOff(`grains`,e);for(let e of this.noteListeners)e()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.applyPitch();for(let e of this.performanceListeners)e()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e));for(let e of this.performanceListeners)e()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(!(`channel`in e))return;let t=this.control(`gr.channel`);if(!(t.kind!==`choice`||t.value!==`omni`&&Number(t.value)!==e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity/127);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===Ge&&this.setModWheel(e.value/127);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...Je,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`gr.channel`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}},et=[`series`,`parallel`,`pingpong`],tt=[`lfo`,`env`],nt=[`tri`,`ramp`,`sqr`,`rnd`],rt=[`lp`,`hp`],P=[`a`,`b`],F=e=>e.toUpperCase(),it=.25,at=3600,ot=.8,st=.5,ct=1,lt=8e-4,ut={"ouro.input":1,"ouro.mix":.5,"ouro.output":1,"ouro.routing":`parallel`,"ouro.kill":0,"ouro.freeze":0,"ouro.a.on":1,"ouro.a.gain":1,"ouro.a.delay":380,"ouro.a.grit":.15,"ouro.a.cutoff":3e3,"ouro.a.resonance":1.2,"ouro.a.filter":`lp`,"ouro.a.clip":.25,"ouro.a.level":1,"ouro.b.on":1,"ouro.b.gain":1,"ouro.b.delay":530,"ouro.b.grit":.15,"ouro.b.cutoff":2200,"ouro.b.resonance":1.2,"ouro.b.filter":`lp`,"ouro.b.clip":.25,"ouro.b.level":1,"ouro.fb.aa":.35,"ouro.fb.ab":.15,"ouro.fb.ba":.15,"ouro.fb.bb":.35,"ouro.mod.mode":`lfo`,"ouro.mod.wave":`tri`,"ouro.mod.rate":.8,"ouro.mod.depth":.4,"ouro.mod.trigger":0,"ouro.mod.dlyA":.15,"ouro.mod.dlyB":-.15,"ouro.mod.cutA":0,"ouro.mod.cutB":0,"ouro.mod.gainA":0,"ouro.mod.gainB":0},I=(e,t)=>({name:e,values:t}),dt=[I(`Tape Spiral`,{"ouro.routing":`series`,"ouro.a.delay":240,"ouro.b.delay":360,"ouro.fb.aa":.35,"ouro.fb.bb":.4,"ouro.fb.ab":0,"ouro.fb.ba":.15,"ouro.a.grit":.35,"ouro.a.cutoff":2200,"ouro.b.cutoff":1800,"ouro.mod.rate":.4,"ouro.mod.depth":.6,"ouro.mod.dlyA":.3,"ouro.mod.dlyB":.2,"ouro.mod.cutA":.1}),I(`Karaoke Drone`,{"ouro.mix":.7,"ouro.fb.aa":.95,"ouro.fb.bb":.95,"ouro.a.gain":1.6,"ouro.b.gain":1.6,"ouro.a.grit":.5,"ouro.b.grit":.5,"ouro.a.clip":.6,"ouro.b.clip":.6,"ouro.a.delay":700,"ouro.b.delay":910,"ouro.a.cutoff":1400,"ouro.b.cutoff":1e3,"ouro.a.resonance":4,"ouro.b.resonance":4}),I(`Ping Pong Mayhem`,{"ouro.routing":`pingpong`,"ouro.mix":.6,"ouro.a.delay":280,"ouro.b.delay":280,"ouro.fb.ab":0,"ouro.fb.ba":.15,"ouro.fb.aa":.1,"ouro.fb.bb":.1,"ouro.a.resonance":.7,"ouro.b.resonance":.7,"ouro.a.grit":.1,"ouro.mod.depth":0}),I(`Dub Wash`,{"ouro.routing":`series`,"ouro.mix":.45,"ouro.a.delay":480,"ouro.b.delay":720,"ouro.fb.aa":.6,"ouro.fb.bb":.5,"ouro.fb.ab":.1,"ouro.fb.ba":.1,"ouro.a.cutoff":1800,"ouro.b.cutoff":1200,"ouro.a.resonance":2.5,"ouro.b.resonance":2.5,"ouro.a.clip":.2,"ouro.mod.rate":.25,"ouro.mod.depth":.5,"ouro.mod.cutA":.4,"ouro.mod.cutB":.3}),I(`Self Oscillator`,{"ouro.input":.2,"ouro.mix":1,"ouro.fb.aa":1.1,"ouro.fb.bb":1.1,"ouro.fb.ab":.3,"ouro.fb.ba":.3,"ouro.a.resonance":18,"ouro.b.resonance":18,"ouro.a.cutoff":800,"ouro.b.cutoff":1200,"ouro.a.clip":.5,"ouro.b.clip":.5,"ouro.a.delay":60,"ouro.b.delay":90,"ouro.mod.rate":.1,"ouro.mod.depth":.3,"ouro.mod.cutA":.5}),I(`Broken Echo`,{"ouro.a.grit":.85,"ouro.b.grit":.85,"ouro.a.delay":330,"ouro.b.delay":470,"ouro.fb.aa":.55,"ouro.fb.bb":.55,"ouro.a.clip":.7,"ouro.b.clip":.7,"ouro.mod.wave":`rnd`,"ouro.mod.rate":6,"ouro.mod.depth":.7,"ouro.mod.dlyA":.4,"ouro.mod.dlyB":-.3,"ouro.mod.gainA":.3}),I(`Filter Scream`,{"ouro.routing":`series`,"ouro.mix":.8,"ouro.a.filter":`hp`,"ouro.a.cutoff":2500,"ouro.a.resonance":16,"ouro.b.cutoff":1500,"ouro.b.resonance":16,"ouro.fb.aa":.6,"ouro.fb.bb":.6,"ouro.fb.ab":.2,"ouro.fb.ba":.1,"ouro.a.clip":.8,"ouro.b.clip":.8,"ouro.mod.wave":`ramp`,"ouro.mod.rate":2,"ouro.mod.depth":.8,"ouro.mod.cutA":.8,"ouro.mod.cutB":-.8}),I(`Slow Rot`,{"ouro.routing":`series`,"ouro.mix":.55,"ouro.a.delay":900,"ouro.b.delay":1300,"ouro.a.grit":.6,"ouro.b.grit":.6,"ouro.fb.aa":.55,"ouro.fb.bb":.55,"ouro.fb.ab":0,"ouro.fb.ba":.1,"ouro.a.cutoff":900,"ouro.b.cutoff":700,"ouro.a.resonance":1,"ouro.b.resonance":1,"ouro.mod.rate":.08,"ouro.mod.depth":.9,"ouro.mod.dlyA":.5,"ouro.mod.dlyB":.4,"ouro.a.level":.9,"ouro.b.level":.9})],ft=class extends E{name;slots=[...dt];currentSlot=0;currentPreset=this.slots[0];fb={aa:.35,ab:.15,ba:.15,bb:.35};on={a:!0,b:!0};clipDrive={a:1.25,b:1.25};routing=`parallel`;killed=!1;frozen=!1;modRate=.8;presetListeners=new Set;constructor(e=`Ouroboros`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`mono`,`gain`,{gain:1},{channels:`mono`}).add(`inGain`,`gain`,{gain:1}).add(`srcGate`,`gain`,{gain:1}).add(`srcA`,`gain`,{gain:1}).add(`srcB`,`gain`,{gain:1}).add(`dry`,`gain`,{gain:Math.SQRT1_2}).add(`wet`,`gain`,{gain:Math.SQRT1_2}).add(`sum`,`gain`,{gain:1}).add(`out`,`gain`,{gain:1}).connect(`in`,`mono`).connect(`mono`,`inGain`).connect(`inGain`,`srcGate`).connect(`srcGate`,`srcA`).connect(`srcGate`,`srcB`).connect(`in`,`dry`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`out`).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`L`,nodeId:`meterL`},{name:`R`,nodeId:`meterR`});for(let e of P)this.addChannel(t,e);t.add(`linkAB`,`gain`,{gain:0}).add(`bounceBA`,`gain`,{gain:0}).connect(`lvlA`,`linkAB`).connect(`linkAB`,`inB`).connect(`lvlB`,`bounceBA`).connect(`bounceBA`,`inA`).connect(`srcA`,`inA`).connect(`srcB`,`inB`);for(let e of P)for(let n of P)t.add(`fb${F(e)}${F(n)}`,`gain`,{gain:0}).connect(`clip${F(e)}`,`fb${F(e)}${F(n)}`).connect(`fb${F(e)}${F(n)}`,`in${F(n)}`);t.add(`seedNoise`,`noise`).add(`seedGain`,`gain`,{gain:lt}).connect(`seedNoise`,`seedGain`).connect(`seedGain`,`inA`).connect(`seedGain`,`inB`),this.addModulator(t),this.addControls(t),this.applyRouting(),this.applyFeedback()}loadPreset(e){let t={...ut,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`ouro.kill`&&t.id!==`ouro.mod.trigger`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}addChannel(e,t){let n=F(t);e.add(`in${n}`,`gain`,{gain:1}).add(`on${n}`,`gain`,{gain:1}).add(`g${n}`,`gain`,{gain:M}).add(`sg${n}`,`waveshaper`,{},{curve:`soft`}).add(`dly${n}`,`delay`,{delayTime:.38,maxTime:2}).add(`tone${n}`,`filter`,{frequency:4800,Q:.707,detune:0},{type:`lowpass`}).add(`crush${n}`,`waveshaper`,{bits:16},{curve:`crush`}).add(`filt${n}`,`filter`,{frequency:3e3,Q:1.2,detune:0},{type:`lowpass`}).add(`cdrive${n}`,`gain`,{gain:M}).add(`clip${n}`,`waveshaper`,{},{curve:`soft`}).add(`lvl${n}`,`gain`,{gain:1}).add(`send${n}`,`gain`,{gain:1}).add(`pan${n}`,`pan`,{pan:t===`a`?-1:1}).connect(`in${n}`,`on${n}`).connect(`on${n}`,`g${n}`).connect(`g${n}`,`sg${n}`).connect(`sg${n}`,`dly${n}`).connect(`dly${n}`,`tone${n}`).connect(`tone${n}`,`crush${n}`).connect(`crush${n}`,`filt${n}`).connect(`filt${n}`,`cdrive${n}`).connect(`cdrive${n}`,`clip${n}`).connect(`clip${n}`,`lvl${n}`).connect(`lvl${n}`,`send${n}`).connect(`send${n}`,`pan${n}`).connect(`pan${n}`,`wet`)}addModulator(e){e.add(`lfoOsc`,`oscillator`,{frequency:.8,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:.8}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfoGate`,`gain`,{gain:1}).add(`follow`,`waveshaper`,{},{curve:`abs`}).add(`followLp`,`filter`,{frequency:.8,Q:.707,detune:0},{type:`lowpass`}).add(`followGain`,`gain`,{gain:4}).add(`modTrig`,`trigger`,{peak:1,decay:.6,velSens:0}).add(`envGate`,`gain`,{gain:0}).add(`mod`,`gain`,{gain:1}).add(`modOut`,`gain`,{gain:.4}).connect(`lfoOsc`,`lfoOscOut`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoOscOut`,`lfoGate`).connect(`lfoRndOut`,`lfoGate`).connect(`inGain`,`follow`).connect(`follow`,`followLp`).connect(`followLp`,`followGain`).connect(`followGain`,`envGate`).connect(`modTrig`,`envGate`).connect(`lfoGate`,`mod`).connect(`envGate`,`mod`).connect(`mod`,`modOut`);for(let t of P){let n=F(t);e.add(`mDly${n}`,`gain`,{gain:0}).add(`mCut${n}`,`gain`,{gain:0}).add(`mGain${n}`,`gain`,{gain:0}).connect(`modOut`,`mDly${n}`).connect(`mDly${n}`,`dly${n}`,`delayTime`).connect(`modOut`,`mCut${n}`).connect(`mCut${n}`,`filt${n}`,`detune`).connect(`modOut`,`mGain${n}`).connect(`mGain${n}`,`g${n}`,`gain`)}}addControls(e){let t=ut,n=e=>t[e],r=(e,t,r,i,a,o,s)=>this.controlList.push(new D(e,t,r,i,n(e),a,o,s)),i=(e,n,r,i)=>this.controlList.push(new O(e,n,r,t[e],i));r(`ouro.input`,`Input`,0,2,``,t=>e.setParam(`inGain`,`gain`,t)),r(`ouro.mix`,`Mix`,0,1,``,t=>{e.setParam(`dry`,`gain`,Math.cos(t*Math.PI/2)),e.setParam(`wet`,`gain`,Math.sin(t*Math.PI/2))}),r(`ouro.output`,`Output`,0,1.5,``,t=>e.setParam(`out`,`gain`,t)),i(`ouro.routing`,`Routing`,et,e=>{this.routing=e,this.applyRouting(),this.applyFeedback()}),this.controlList.push(new k(`ouro.kill`,`Kill`,!1,e=>{this.killed=e,this.applyFeedback()}),new k(`ouro.freeze`,`Freeze`,!1,e=>{this.frozen=e,this.applyFeedback()}));for(let t of P){let n=F(t),a=e=>`ouro.${t}.${e}`;this.controlList.push(new k(a(`on`),`On`,!0,r=>{this.on[t]=r,e.setParam(`on${n}`,`gain`,+!!r),this.applyFeedback()})),r(a(`gain`),`Gain`,.05,8,`×`,t=>e.setParam(`g${n}`,`gain`,t*M),`log`),r(a(`delay`),`Delay`,10,1800,`ms`,t=>e.setParam(`dly${n}`,`delayTime`,t/1e3),`log`),r(a(`grit`),`Grit`,0,1,``,t=>e.setParam(`crush${n}`,`bits`,16-t*13)),r(a(`cutoff`),`Cutoff`,20,18e3,`Hz`,t=>e.setParam(`filt${n}`,`frequency`,t),`log`),r(a(`resonance`),`Resonance`,.1,30,``,t=>e.setParam(`filt${n}`,`Q`,t)),i(a(`filter`),`Filter`,rt,t=>e.setOption(`filt${n}`,`type`,t===`hp`?`highpass`:`lowpass`)),r(a(`clip`),`Clip`,0,1,``,r=>{let i=1+r*7;e.setParam(`cdrive${n}`,`gain`,M*i),this.clipDrive[t]=i,this.applyFeedback()}),r(a(`level`),`Level`,0,1.5,``,t=>e.setParam(`lvl${n}`,`gain`,t))}for(let[e,t]of[[`aa`,`A>A`],[`ab`,`A>B`],[`ba`,`B>A`],[`bb`,`B>B`]])r(`ouro.fb.${e}`,t,0,1.2,``,t=>{this.fb[e]=t,this.applyFeedback()});i(`ouro.mod.mode`,`Mode`,tt,t=>{e.setParam(`lfoGate`,`gain`,+(t===`lfo`)),e.setParam(`envGate`,`gain`,+(t===`env`))}),i(`ouro.mod.wave`,`Wave`,nt,t=>{e.setOption(`lfoOsc`,`waveform`,t===`sqr`?`square`:t===`ramp`?`sawtooth`:`triangle`),e.setParam(`lfoOscOut`,`gain`,t===`rnd`?0:1),e.setParam(`lfoRndOut`,`gain`,+(t===`rnd`))}),r(`ouro.mod.rate`,`Rate`,.05,30,`Hz`,t=>{this.modRate=t,e.setParam(`lfoOsc`,`frequency`,t),e.setParam(`lfoRnd`,`rate`,t),e.setParam(`followLp`,`frequency`,t),e.setParam(`modTrig`,`decay`,Math.min(4,1.5/t))},`log`),r(`ouro.mod.depth`,`Depth`,0,1,``,t=>e.setParam(`modOut`,`gain`,t)),this.controlList.push(new k(`ouro.mod.trigger`,`Trigger`,!1,t=>{t&&e.trigger(`modTrig`,1)}));for(let t of P){let n=F(t),i=(t,i,a,o)=>r(`ouro.mod.${t}${n}`,i,-1,1,``,t=>e.setParam(`${a}${n}`,`gain`,t*o));i(`dly`,`Delay ${n}`,`mDly`,it),i(`cut`,`Cutoff ${n}`,`mCut`,at),i(`gain`,`Gain ${n}`,`mGain`,ot)}}applyRouting(){let e=this.circuit,t=this.routing===`series`,n=this.routing===`parallel`;e.setParam(`srcB`,`gain`,+!!n),e.setParam(`sendA`,`gain`,+!t),e.setParam(`panA`,`pan`,-1),e.setParam(`panB`,`pan`,+!t)}applyFeedback(){let e=this.circuit;for(let t of P)for(let n of P){let r=`${t}${n}`,i=this.fb[r]/this.clipDrive[t];this.frozen&&t===n&&(i=ct/this.clipDrive[t]),(this.killed||!this.on[t]||!this.on[n])&&(i=0),e.setParam(`fb${F(t)}${F(n)}`,`gain`,i)}let t=this.routing!==`parallel`;e.setParam(`linkAB`,`gain`,t?1/this.clipDrive.a:0);let n=this.routing===`pingpong`&&!this.killed&&this.on.a&&this.on.b;e.setParam(`bounceBA`,`gain`,n?st/this.clipDrive.b:0),e.setParam(`srcGate`,`gain`,+!this.frozen)}},pt={"env.attack":1,"env.decay":30,"env.sustain":0,"env.release":200,"env.keytrack":0,"env.velocity":.5,"env.legato":0,"gen.noise":1,"gen.cutoff":100,"gen.reso":.2,"gen.keytrack":.5,"gen.envAmt":0,"gen.onePole":0,"gen.gain":1.5,"fb.push":0,"fb.decay":2,"fb.release":.4,"sat.hardness":.3,"sat.symmetry":0,"patch.volume":.8,"delay.tune":0,"delay.fine":0,"delay.harmonics":0,"delay.split":0,"delay.splitPoint":.5,"delay.polarity":0,"filter.highpass":-36,"filter.lowpass":36,"filter.hpComp":1,"filter.lpComp":1,"voice.mode":`poly`,"voice.detune":12,"voice.glide":100,"voice.glideOn":0,"lfo.wave":`sine`,"lfo.rate":5,"lfo.sync":0,"lfo.division":`1/8`,"lfo.delay":0,"lfo.amount":0,"lfo.dest":`pitch`,"rev.mix":.25,"rev.bass":120,"rev.treble":8e3,"rev.size":`medium`,"rev.spread":.5},L=(e,t)=>({name:e,values:t}),R={"env.attack":60,"env.decay":200,"env.sustain":1,"env.release":250,"gen.noise":.06,"gen.gain":.3,"fb.push":1.2,"fb.decay":4,"fb.release":.3,"sat.hardness":.1,"filter.highpass":-36,"filter.lowpass":30},z={"gen.gain":1.9},mt=[[L(`Nylon Pluck`,{...z,"gen.cutoff":90,"gen.keytrack":.7,"fb.decay":1.8,"fb.release":.25,"filter.lowpass":30,"sat.hardness":.2,"rev.mix":.2}),L(`Steel String`,{...z,"gen.cutoff":120,"delay.harmonics":.12,"fb.decay":3.5,"fb.release":.35,"filter.lowpass":48,"sat.hardness":.4,"env.velocity":.7}),L(`Muted Bass`,{...z,"delay.tune":-12,"gen.cutoff":70,"gen.keytrack":.2,"fb.decay":.9,"fb.release":.15,"filter.lowpass":18,"filter.highpass":-48,"voice.mode":`mono`,"rev.mix":.08,"patch.volume":1}),L(`Harp`,{...z,"gen.cutoff":100,"gen.keytrack":.6,"delay.harmonics":.05,"fb.decay":5,"fb.release":.6,"filter.lowpass":36,"rev.size":`large`,"rev.mix":.35}),L(`Marimba`,{...z,"env.attack":1,"env.decay":20,"gen.cutoff":80,"delay.split":1,"delay.splitPoint":.4,"delay.harmonics":.4,"fb.decay":.7,"fb.release":.2,"filter.lowpass":24,"filter.highpass":-48,"rev.mix":.15}),L(`Glass Bell`,{...z,"delay.tune":12,"delay.split":1,"delay.splitPoint":.3,"delay.harmonics":.6,"fb.decay":6,"fb.release":2,"sat.hardness":.1,"filter.lowpass":60,"filter.highpass":-48,"rev.size":`large`,"rev.mix":.4}),L(`Wood Block`,{...z,"env.decay":15,"gen.gain":2,"delay.split":1,"delay.splitPoint":.5,"delay.harmonics":.2,"fb.decay":.25,"fb.release":.1,"filter.lowpass":40,"filter.highpass":-24,"rev.mix":.1}),L(`Kalimba`,{...z,"delay.tune":12,"gen.noise":.8,"delay.split":1,"delay.splitPoint":.6,"delay.harmonics":.3,"fb.decay":1.2,"fb.release":.3,"filter.lowpass":42,"filter.highpass":-48,"rev.mix":.3})],[L(`Pan Flute`,{...R,"delay.polarity":1,"voice.mode":`mono`,"env.legato":1,"voice.glideOn":1,"voice.glide":60,"lfo.amount":.12,"lfo.rate":5,"lfo.delay":.6,"lfo.dest":`pitch`,"rev.mix":.3}),L(`Clarinet`,{...R,"delay.polarity":1,"gen.noise":.1,"gen.gain":.35,"env.attack":30,"sat.hardness":.5,"filter.lowpass":36,"voice.mode":`mono`,"env.legato":1,"rev.mix":.2}),L(`Reed Organ`,{...R,"gen.noise":.08,"env.attack":40,"env.release":200,"sat.hardness":.6,"sat.symmetry":.2,"filter.lowpass":40,"rev.mix":.25}),L(`Pipe Organ`,{...R,"gen.noise":.05,"env.attack":80,"env.release":500,"filter.lowpass":24,"rev.size":`large`,"rev.mix":.45}),L(`Brass`,{...R,"gen.noise":.1,"gen.gain":.5,"env.attack":80,"env.decay":200,"env.sustain":.7,"sat.hardness":.7,"sat.symmetry":.6,"filter.lowpass":42,"lfo.dest":`filter`,"lfo.amount":.1,"lfo.rate":6,"rev.mix":.2}),L(`Overblown`,{...R,"delay.polarity":1,"lfo.dest":`filter`,"lfo.amount":.6,"lfo.rate":.3,"lfo.wave":`sine`,"rev.mix":.3}),L(`Steam Drone`,{...R,"env.attack":1500,"env.release":3e3,"gen.noise":.2,"fb.decay":20,"fb.release":3,"voice.mode":`unison`,"voice.detune":25,"rev.size":`large`,"rev.mix":.5,"rev.spread":1}),L(`Wind Chimes`,{"delay.tune":12,"delay.split":1,"delay.splitPoint":.2,"delay.harmonics":.5,"fb.decay":8,"fb.release":4,"filter.lowpass":54,"filter.highpass":-48,"sat.hardness":.05,"rev.size":`large`,"rev.mix":.5,"rev.spread":1})]].flat(),ht=[`poly`,`mono`,`unison`],gt=[`sine`,`tri`,`sqr`,`ramp`,`rnd`],_t=[`pitch`,`filter`,`steam`,`sat`,`push`],vt=[`1/1`,`1/2`,`1/4`,`1/8`,`1/16`,`1/32`],yt=1,bt=64,xt=2,St=.8,Ct=3,wt=class extends E{name;transport;slots=[...mt];currentSlot=0;currentPreset=this.slots[0];held=[];bend=0;modWheelValue=0;lfoHz=5;lfoSync=!1;lfoDivision=`1/8`;clockPulses=0;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`Pipe`,t=new T){super(),this.name=e,this.transport=new Fe(t),this.transport.channel.set(`omni`),this.circuit.add(`pipe`,`pipe`,{atk:.001,dec:.03,sus:0,rel:.2,envKey:0,vel:.5,legato:0,noise:1,nCut:100,nRes:.2,nKey:.5,nEnv:0,onePole:0,gain:.8,tune:0,fine:0,harm:0,split:0,splitPt:.5,pol:0,fbDec:2,fbRel:.4,push:0,satHard:.3,satSym:0,hp:-36,lp:36,hpComp:1,lpComp:1,mode:0,detune:12,glide:.1,glideOn:0,spread:.5,volume:.8,lfoRate:5,lfoShape:0,lfoDelay:0,lfoAmt:0,lfoDest:0,bend:0,mod:0}).add(`dry`,`gain`,{gain:1}).add(`revIn`,`gain`,{gain:1}).add(`conv`,`convolver`,{},{size:`medium`}).add(`revLow`,`filter`,{frequency:120,Q:.707,detune:0},{type:`highpass`}).add(`revHigh`,`filter`,{frequency:8e3,Q:.707,detune:0},{type:`lowpass`}).add(`wet`,`gain`,{gain:0}).add(`sum`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`pipe`,`dry`).connect(`pipe`,`revIn`).connect(`revIn`,`conv`).connect(`conv`,`revLow`).connect(`revLow`,`revHigh`).connect(`revHigh`,`wet`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`}),this.addControls(),this.transport.tempo.onChange(()=>this.applyLfoRate())}addControls(){let e=this.circuit,t=pt,n=(e,n,r,i,a,o,s)=>this.controlList.push(new D(e,n,r,i,t[e],a,o,s)),r=(t,r,i,a,o,s,c=1,l)=>n(t,r,i,a,o,t=>e.setParam(`pipe`,s,t*c),l),i=(n,r,i)=>this.controlList.push(new k(n,r,(t[n]??0)>0,t=>e.setParam(`pipe`,i,+!!t)));r(`env.attack`,`Attack`,.5,1e4,`ms`,`atk`,1/1e3,`log`),r(`env.decay`,`Decay`,1,1e4,`ms`,`dec`,1/1e3,`log`),r(`env.sustain`,`Sustain`,0,1,``,`sus`),r(`env.release`,`Release`,5,2e4,`ms`,`rel`,1/1e3,`log`),r(`env.keytrack`,`Keytrack`,0,1,``,`envKey`),r(`env.velocity`,`Velocity`,0,1,``,`vel`),i(`env.legato`,`Legato`,`legato`),r(`gen.noise`,`DC / Noise`,0,1,``,`noise`),r(`gen.cutoff`,`Cutoff`,30,140,`pitch`,`nCut`),r(`gen.reso`,`Resonance`,0,1,``,`nRes`),r(`gen.keytrack`,`Keytrack`,0,1,``,`nKey`),r(`gen.envAmt`,`Env amount`,-48,48,`st`,`nEnv`),r(`gen.gain`,`Gain`,0,2,``,`gain`),i(`gen.onePole`,`1-pole`,`onePole`),r(`fb.push`,`Push`,0,1.5,``,`push`),r(`fb.decay`,`Decay`,.05,30,`s`,`fbDec`,1,`log`),r(`fb.release`,`Release`,.02,20,`s`,`fbRel`,1,`log`),r(`sat.hardness`,`Soft / Hard`,0,1,``,`satHard`),r(`sat.symmetry`,`Symmetry`,0,1,``,`satSym`),r(`patch.volume`,`Volume`,0,1.2,``,`volume`),r(`delay.tune`,`Tune`,-24,24,`st`,`tune`),r(`delay.fine`,`Fine`,-100,100,`ct`,`fine`),r(`delay.harmonics`,`Harmonics`,0,1,``,`harm`),r(`delay.splitPoint`,`Split point`,.05,.95,``,`splitPt`),i(`delay.split`,`Split`,`split`),i(`delay.polarity`,`Polarity`,`pol`),r(`filter.highpass`,`Highpass`,-60,36,`st`,`hp`),r(`filter.lowpass`,`Lowpass`,0,84,`st`,`lp`),r(`filter.hpComp`,`HP comp`,0,1,``,`hpComp`),r(`filter.lpComp`,`LP comp`,0,1,``,`lpComp`),this.controlList.push(new O(`voice.mode`,`Mode`,ht,`poly`,t=>{this.releaseAll(),e.setParam(`pipe`,`mode`,ht.indexOf(t))})),r(`voice.detune`,`Detune`,0,100,`ct`,`detune`),r(`voice.glide`,`Glide`,1,5e3,`ms`,`glide`,1/1e3,`log`),i(`voice.glideOn`,`Glide on`,`glideOn`),this.controlList.push(new O(`lfo.wave`,`Wave`,gt,`sine`,t=>e.setParam(`pipe`,`lfoShape`,gt.indexOf(t))),new O(`lfo.dest`,`Destination`,_t,`pitch`,t=>e.setParam(`pipe`,`lfoDest`,_t.indexOf(t))),new O(`lfo.division`,`Division`,vt,`1/8`,e=>{this.lfoDivision=e,this.applyLfoRate()}),new k(`lfo.sync`,`Sync`,!1,e=>{this.lfoSync=e,this.applyLfoRate()})),n(`lfo.rate`,`Rate`,.05,40,`Hz`,e=>{this.lfoHz=e,this.applyLfoRate()},`log`),r(`lfo.delay`,`Delay`,0,5,`s`,`lfoDelay`),r(`lfo.amount`,`Amount`,0,1,``,`lfoAmt`),n(`rev.mix`,`Mix`,0,1,``,t=>{e.setParam(`dry`,`gain`,Math.cos(t*Math.PI/2)),e.setParam(`wet`,`gain`,Math.sin(t*Math.PI/2)*Ct)}),n(`rev.bass`,`Bass`,20,800,`Hz`,t=>e.setParam(`revLow`,`frequency`,t),`log`),n(`rev.treble`,`Treble`,1500,16e3,`Hz`,t=>e.setParam(`revHigh`,`frequency`,t),`log`),r(`rev.spread`,`Spread`,0,1,``,`spread`),this.controlList.push(new O(`rev.size`,`Size`,Be,`medium`,t=>e.setOption(`conv`,`size`,t)))}applyLfoRate(){let e=Number(this.lfoDivision.split(`/`)[1]),t=this.lfoSync?this.transport.bpm/60*e/4:this.lfoHz;this.circuit.setParam(`pipe`,`lfoRate`,Math.min(40,Math.max(.05,t)))}releaseAll(){this.circuit.allNotesOff(`pipe`),this.held.length>0&&(this.held=[],this.notifyNotes())}keyDown(e,t=St){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.circuit.noteOn(`pipe`,e,t),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.circuit.noteOff(`pipe`,e),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}setSustain(e){this.circuit.pedal(`pipe`,e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`pipe`,`bend`,this.bend*xt),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`pipe`,`mod`,this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(e.type===`clock`)this.lfoSync&&this.transport.synced&&++this.clockPulses%24==0&&this.applyLfoRate();else if(`channel`in e&&this.transport.acceptsChannel(e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity/127);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===yt?this.setModWheel(e.value/127):e.controller===bt&&this.setSustain(e.value>=64);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...pt,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}},Tt={"osc.wave":`saw`,"osc.width":50,"osc.pwm":0,"osc.vibrato":0,"osc.sub":.3,"filter.cutoff":2400,"filter.resonance":1,"filter.env":2,"filter.lfo":0,"filter.key":50,"amp.lfo":0,"amp.key":0,level:.7,"lfo.wave":`tri`,"lfo.rate":5,"lfo.sync":0,"lfo.division":`1/8`,"env1.attack":.005,"env1.decay":.4,"env1.sustain":.4,"env1.release":.4,"env2.attack":.005,"env2.decay":.3,"env2.sustain":.7,"env2.release":.35,"voices.mode":`poly`,"voices.portamento":0,"voices.detune":12,"fx.chorus":0,"fx.delayTime":.35,"fx.feedback":.3,"fx.mix":0},B=(e,t)=>({name:e,values:t}),Et=[[B(`Soft Pad`,{"osc.sub":.2,"filter.cutoff":900,"filter.resonance":1.2,"filter.env":1.5,"filter.lfo":.3,"env1.attack":.6,"env1.decay":1.2,"env1.sustain":.5,"env1.release":1.5,"env2.attack":.5,"env2.decay":.8,"env2.sustain":.8,"env2.release":1.6,"lfo.rate":.4,"fx.chorus":.7,"fx.mix":.15,"fx.delayTime":.45,"fx.feedback":.35,level:.6}),B(`Warm Brass`,{"osc.sub":.3,"filter.cutoff":700,"filter.env":3.2,"osc.vibrato":8,"env1.attack":.12,"env1.decay":.5,"env1.sustain":.55,"env1.release":.25,"env2.attack":.06,"env2.decay":.3,"env2.sustain":.85,"env2.release":.2,"fx.chorus":.3}),B(`Pluck Bass`,{"voices.mode":`mono`,"osc.sub":.6,"filter.cutoff":350,"filter.resonance":4,"filter.env":3.5,"env1.attack":.001,"env1.decay":.22,"env1.sustain":0,"env1.release":.15,"env2.attack":.001,"env2.decay":.35,"env2.sustain":.5,"env2.release":.1,"voices.portamento":.05}),B(`Glass Keys`,{"osc.wave":`tri`,"osc.sub":0,"filter.cutoff":5200,"filter.resonance":.5,"filter.env":.5,"env1.attack":.001,"env1.decay":.8,"env1.sustain":.2,"env1.release":.6,"env2.attack":.002,"env2.decay":1.2,"env2.sustain":.1,"env2.release":.8,"fx.chorus":.45,"fx.mix":.2,"fx.delayTime":.3,"fx.feedback":.4}),B(`Slow Strings`,{"filter.cutoff":3e3,"filter.env":.6,"filter.key":70,"osc.vibrato":12,"lfo.rate":5.5,"env1.attack":.8,"env1.decay":1,"env1.sustain":.7,"env1.release":1.2,"env2.attack":.9,"env2.decay":1,"env2.sustain":.9,"env2.release":1.4,"fx.chorus":.8}),B(`Sweep Lead`,{"voices.mode":`mono`,"osc.wave":`pulse`,"osc.width":30,"osc.pwm":.4,"osc.sub":.2,"lfo.rate":.7,"filter.cutoff":1500,"filter.resonance":5,"filter.env":2.5,"env1.attack":.001,"env1.decay":.8,"env1.sustain":.35,"env1.release":.3,"env2.sustain":.9,"voices.portamento":.12,"fx.mix":.3,"fx.delayTime":.4,"fx.feedback":.45}),B(`Wobble Sub`,{"voices.mode":`mono`,"osc.sub":.8,"filter.cutoff":260,"filter.resonance":6,"filter.lfo":2.2,"filter.env":.5,"lfo.sync":1,"lfo.division":`1/8`,"env2.sustain":.95,level:.55}),B(`Bell Pluck`,{"osc.wave":`tri`,"osc.sub":0,"filter.cutoff":8e3,"filter.resonance":.3,"filter.env":.2,"osc.vibrato":4,"env1.attack":.001,"env1.decay":.5,"env1.sustain":0,"env1.release":.4,"env2.attack":.001,"env2.decay":1.6,"env2.sustain":0,"env2.release":1.4,"fx.chorus":.3,"fx.mix":.3,"fx.delayTime":.5,"fx.feedback":.5})],[B(`Init`,{}),B(`Analog Poly`,{"filter.cutoff":1800,"filter.resonance":1.5,"filter.env":2,"env1.attack":.01,"env1.decay":.5,"env1.sustain":.35,"env1.release":.4,"env2.attack":.01,"env2.decay":.4,"env2.sustain":.75,"env2.release":.4,"fx.chorus":.35}),B(`Choir Air`,{"osc.wave":`pulse`,"osc.width":40,"osc.pwm":.2,"filter.cutoff":1600,"filter.resonance":2.5,"filter.env":1,"env2.attack":.35,"env2.decay":.6,"env2.sustain":.85,"env2.release":1.1,"fx.chorus":.6,"fx.mix":.2}),B(`Retro Stab`,{"filter.cutoff":600,"filter.resonance":2,"filter.env":4,"env1.attack":.001,"env1.decay":.22,"env1.sustain":0,"env1.release":.2,"env2.attack":.001,"env2.decay":.25,"env2.sustain":0,"env2.release":.2,"fx.chorus":.5}),B(`Fifth Lead`,{"voices.mode":`unison`,"voices.detune":18,"filter.cutoff":2600,"filter.resonance":2,"filter.env":1.5,"env2.sustain":.8,"voices.portamento":.08,"fx.mix":.25}),B(`Dream Wash`,{"osc.sub":.4,"filter.cutoff":1100,"lfo.rate":.3,"filter.lfo":.4,"env1.attack":1.8,"env1.decay":1,"env1.sustain":.6,"env1.release":2.5,"env2.attack":1.5,"env2.decay":1,"env2.sustain":.85,"env2.release":3,"fx.chorus":.9,"fx.mix":.4,"fx.delayTime":.6,"fx.feedback":.6,level:.55}),B(`Pulse Organ`,{"osc.wave":`pulse`,"osc.width":50,"osc.sub":.5,"filter.cutoff":3200,"filter.resonance":.5,"filter.env":.3,"osc.vibrato":6,"lfo.rate":6.5,"env2.attack":.005,"env2.decay":.1,"env2.sustain":1,"env2.release":.08,"fx.chorus":.3}),B(`Space Arp`,{"osc.wave":`pulse`,"osc.width":25,"osc.pwm":.6,"lfo.rate":1.2,"filter.cutoff":1e3,"filter.resonance":3,"filter.env":3,"env1.attack":.001,"env1.decay":.25,"env1.sustain":.1,"env1.release":.2,"env2.attack":.002,"env2.decay":.3,"env2.sustain":.2,"env2.release":.25,"fx.mix":.4,"fx.delayTime":.38,"fx.feedback":.55,"fx.chorus":.2})]],Dt=Et.flat(),Ot=[`poly`,`mono`,`unison`],kt=class{count;mode=`poly`;voices;held=[];clock=0;constructor(e){this.count=e,this.voices=Array.from({length:e},()=>({gate:!1,since:0}))}isActive(e){return this.voices[e].gate}get activeCount(){return this.voices.filter(e=>e.gate).length}noteOn(e){return this.mode===`poly`?this.polyOn(e):this.stackOn(e)}noteOff(e){return this.mode===`poly`?this.polyOff(e):this.stackOff(e)}releaseAll(){this.held=[];let e=[];return this.voices.forEach((t,n)=>{t.gate&&(t.gate=!1,t.since=++this.clock,e.push({kind:`off`,voice:n}))}),e}get active(){return this.mode===`mono`?[0]:this.voices.map((e,t)=>t)}polyOn(e){let t=this.voices.findIndex(t=>t.gate&&t.note===e);if(t<0){let e=this.voices.map((e,t)=>({v:e,i:t})).filter(e=>!e.v.gate);t=(e.length?e:this.voices.map((e,t)=>({v:e,i:t}))).reduce((e,t)=>t.v.since<e.v.since?t:e).i}let n=this.voices[t];return n.note=e,n.gate=!0,n.since=++this.clock,[{kind:`on`,voice:t,note:e,retrigger:!0,glide:!0}]}polyOff(e){let t=[];return this.voices.forEach((n,r)=>{n.gate&&n.note===e&&(n.gate=!1,n.since=++this.clock,t.push({kind:`off`,voice:r}))}),t}stackOn(e){let t=this.voices[this.active[0]].gate;return this.held=this.held.filter(t=>t!==e),this.held.push(e),this.play(e,!t,t)}stackOff(e){this.held=this.held.filter(t=>t!==e);let t=this.held[this.held.length-1];if(t!==void 0)return this.play(t,!1,!0);let n=[];for(let e of this.active){let t=this.voices[e];t.gate&&(t.gate=!1,t.since=++this.clock,n.push({kind:`off`,voice:e}))}return n}play(e,t,n){return this.active.map(r=>{let i=this.voices[r],a=t||!i.gate;return i.note=e,i.gate=!0,i.since=++this.clock,{kind:`on`,voice:r,note:e,retrigger:a,glide:n&&!a}})}},At=1200,jt=69,Mt=200,Nt=100,Pt=1,Ft=[`saw`,`pulse`,`tri`],It=[`tri`,`up`,`down`,`sqr`,`rnd`],Lt=[`1/1`,`1/2`,`1/4`,`1/8`,`1/16`,`1/32`],Rt={poly:.45,mono:.6,unison:.34},zt=.65,Bt=class extends E{name;transport;slots=[...Dt];currentSlot=Et[0].length;currentPreset=this.slots[this.currentSlot];allocator=new kt(6);held=[];bend=0;modWheelValue=0;vibratoCents=0;portamento=0;unisonDetune=12;lfoHz=5;lfoSync=!1;lfoDivision=`1/8`;clockPulses=0;performanceListeners=new Set;noteListeners=new Set;presetListeners=new Set;constructor(e=`Poly`,t=new T){super(),this.name=e,this.transport=new Fe(t),this.transport.channel.set(`2`);let n=this.circuit;this.addShared(n);for(let e=0;e<6;e++)this.addVoice(n,e);this.addEffects(n),this.outputList.push({name:`out`,nodeId:`level`}),this.addControls(n),this.transport.tempo.onChange(()=>this.applyLfoRate())}keyDown(e){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.apply(this.allocator.noteOn(e)),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.apply(this.allocator.noteOff(e)),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}voiceActive(e){return this.allocator.isActive(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*Mt),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.applyVibrato(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(e.type===`clock`)this.lfoSync&&this.transport.synced&&++this.clockPulses%24==0&&this.applyLfoRate();else if(!(`channel`in e&&!this.transport.acceptsChannel(e.channel)))switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===Pt&&this.setModWheel(e.value/127);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...Tt,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e,t=this.slots[e].name){let n={name:t,values:this.snapshot()};this.slots[e]=n,this.currentSlot=e,this.currentPreset=n;for(let e of this.presetListeners)e();return n}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}apply(e){let t=this.circuit;for(let n of e){let e=e=>`v${n.voice}.${e}`;n.kind===`off`?(t.setParam(e(`env1`),`gate`,0),t.setParam(e(`env2`),`gate`,0)):(n.glide||t.setParam(e(`pitch`),`glide`,0),t.setParam(e(`pitch`),`offset`,(n.note-jt)*100),n.glide||t.setParam(e(`pitch`),`glide`,this.portamento),n.retrigger&&(t.setParam(e(`env1`),`gate`,1),t.setParam(e(`env2`),`gate`,1)))}}eachVoice(e){for(let t=0;t<6;t++)e(e=>`v${t}.${e}`)}applyMode(e){this.apply(this.allocator.releaseAll()),this.held=[],this.allocator.mode=e,this.eachVoice(t=>this.circuit.setParam(t(`out`),`gain`,Rt[e])),this.applyDetune(),this.notifyNotes()}applyDetune(){let e=this.allocator.mode===`unison`?this.unisonDetune:0,t=5/2;for(let n=0;n<6;n++){let r=(n-t)/t*e;this.circuit.setParam(`v${n}.det`,`offset`,r===0?0:r)}}applyVibrato(){this.circuit.setParam(`lfoPitch`,`gain`,this.vibratoCents+this.modWheelValue*Nt)}applyLfoRate(){let e=Number(this.lfoDivision.split(`/`)[1]),t=this.lfoSync?this.transport.bpm/60*e/4:this.lfoHz;this.circuit.setParam(`lfoOsc`,`frequency`,t),this.circuit.setParam(`lfoRnd`,`rate`,t)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}addShared(e){e.add(`bend`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:-1200}).add(`pwCv`,`constant`,{offset:0}).add(`lfoOsc`,`oscillator`,{frequency:5,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:5}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoSign`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0}).add(`lfoAmp`,`gain`,{gain:0}).add(`voices`,`gain`,{gain:1}).connect(`lfoOsc`,`lfoOscOut`).connect(`lfoOscOut`,`lfoSign`).connect(`lfoSign`,`lfo`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoRndOut`,`lfo`);for(let t of[`lfoPitch`,`lfoPw`,`lfoFilter`,`lfoAmp`])e.connect(`lfo`,t)}addVoice(e,t){let n=e=>`v${t}.${e}`;e.add(n(`pitch`),`constant`,{offset:0,glide:0}).add(n(`det`),`constant`,{offset:0}).add(n(`osc`),`oscillator`,{frequency:440,detune:0},{waveform:`sawtooth`}).add(n(`sub`),`oscillator`,{frequency:440,detune:0},{waveform:`square`}).add(n(`rawOut`),`gain`,{gain:1}).add(n(`pulseSum`),`gain`,{gain:1}).add(n(`shaper`),`waveshaper`,{},{curve:`pulse`}).add(n(`pulseOut`),`gain`,{gain:0}).add(n(`subLevel`),`gain`,{gain:0}).add(n(`mix`),`gain`,{gain:.5}).add(n(`f1`),`filter`,{frequency:2400,Q:1,detune:0},{type:`lowpass`}).add(n(`f2`),`filter`,{frequency:2400,Q:.707,detune:0},{type:`lowpass`}).add(n(`keyFollow`),`gain`,{gain:.5}).add(n(`env1`),`envelope`,{attack:.005,decay:.4,sustain:.4,release:.4,gate:0}).add(n(`env1Depth`),`gain`,{gain:2*At}).add(n(`env2`),`envelope`,{attack:.005,decay:.3,sustain:.7,release:.35,gate:0}).add(n(`amp`),`gain`,{gain:0}).add(n(`trem`),`gain`,{gain:1}).add(n(`ampKey`),`gain`,{gain:0}).add(n(`out`),`gain`,{gain:Rt.poly});for(let t of[`osc`,`sub`])e.connect(n(`pitch`),n(t),`detune`).connect(n(`det`),n(t),`detune`).connect(`bend`,n(t),`detune`).connect(`lfoPitch`,n(t),`detune`);e.connect(`subShift`,n(`sub`),`detune`).connect(n(`osc`),n(`rawOut`)).connect(n(`osc`),n(`pulseSum`)).connect(`pwCv`,n(`pulseSum`)).connect(`lfoPw`,n(`pulseSum`)).connect(n(`pulseSum`),n(`shaper`)).connect(n(`shaper`),n(`pulseOut`)).connect(n(`rawOut`),n(`mix`)).connect(n(`pulseOut`),n(`mix`)).connect(n(`sub`),n(`subLevel`)).connect(n(`subLevel`),n(`mix`)).connect(n(`mix`),n(`f1`)).connect(n(`f1`),n(`f2`)).connect(n(`f2`),n(`amp`)).connect(n(`env1`),n(`env1Depth`)).connect(n(`pitch`),n(`keyFollow`));for(let t of[`f1`,`f2`])e.connect(n(`env1Depth`),n(t),`detune`).connect(n(`keyFollow`),n(t),`detune`).connect(`lfoFilter`,n(t),`detune`);e.connect(n(`env2`),n(`amp`),`gain`).connect(n(`amp`),n(`trem`)).connect(`lfoAmp`,n(`trem`),`gain`).connect(n(`pitch`),n(`ampKey`)).connect(n(`ampKey`),n(`trem`),`gain`).connect(n(`trem`),n(`out`)).connect(n(`out`),`voices`)}addEffects(e){e.add(`chorusDry`,`gain`,{gain:1}).add(`chorusWet`,`gain`,{gain:0}).add(`chDelayA`,`delay`,{delayTime:.016,maxTime:.05}).add(`chDelayB`,`delay`,{delayTime:.024,maxTime:.05}).add(`chLfoA`,`oscillator`,{frequency:.62,detune:0},{waveform:`sine`}).add(`chLfoB`,`oscillator`,{frequency:.83,detune:0},{waveform:`sine`}).add(`chDepthA`,`gain`,{gain:.0025}).add(`chDepthB`,`gain`,{gain:.003}).add(`fxMix`,`gain`,{gain:1}).connect(`voices`,`chorusDry`).connect(`chorusDry`,`fxMix`).connect(`voices`,`chDelayA`).connect(`voices`,`chDelayB`).connect(`chDelayA`,`chorusWet`).connect(`chDelayB`,`chorusWet`).connect(`chorusWet`,`fxMix`).connect(`chLfoA`,`chDepthA`).connect(`chDepthA`,`chDelayA`,`delayTime`).connect(`chLfoB`,`chDepthB`).connect(`chDepthB`,`chDelayB`,`delayTime`),e.add(`dlyLine`,`delay`,{delayTime:.35,maxTime:1.5}).add(`dlyTone`,`filter`,{frequency:4500,Q:.707,detune:0},{type:`lowpass`}).add(`dlyFb`,`gain`,{gain:.3}).add(`dlyWet`,`gain`,{gain:0}).add(`dlySum`,`gain`,{gain:1}).add(`level`,`gain`,{gain:.7}).connect(`fxMix`,`dlySum`).connect(`fxMix`,`dlyLine`).connect(`dlyLine`,`dlyTone`).connect(`dlyTone`,`dlyFb`).connect(`dlyFb`,`dlyLine`).connect(`dlyTone`,`dlyWet`).connect(`dlyWet`,`dlySum`).connect(`dlySum`,`level`)}addControls(e){let t=(e,t,n,r,i,a,o,s)=>this.controlList.push(new D(e,t,n,r,i,a,o,s)),n=e=>t=>this.eachVoice(n=>e(n,t)),r=Tt,i=e=>r[e],a=(r,a,o,s,c)=>t(`${r}.${a}`,o,s,c,i(`${r}.${a}`),`s`,n((t,n)=>e.setParam(t(r),a,n)),`log`),o=r=>t(`${r}.sustain`,`Sustain`,0,1,i(`${r}.sustain`),``,n((t,n)=>e.setParam(t(r),`sustain`,n)));this.controlList.push(new O(`osc.wave`,`Wave`,Ft,r[`osc.wave`],t=>this.eachVoice(n=>{e.setOption(n(`osc`),`waveform`,t===`tri`?`triangle`:`sawtooth`),e.setParam(n(`rawOut`),`gain`,t===`pulse`?0:1),e.setParam(n(`pulseOut`),`gain`,t===`pulse`?zt:0)}))),t(`osc.width`,`Width`,5,50,i(`osc.width`),`%`,t=>e.setParam(`pwCv`,`offset`,1-2*t/100)),t(`osc.pwm`,`LFO PWM`,0,100,i(`osc.pwm`)*100,`%`,t=>e.setParam(`lfoPw`,`gain`,t/100*.9)),t(`osc.vibrato`,`LFO Pitch`,0,100,i(`osc.vibrato`),`ct`,e=>{this.vibratoCents=e,this.applyVibrato()}),t(`osc.sub`,`Sub`,0,1,i(`osc.sub`),``,n((t,n)=>e.setParam(t(`subLevel`),`gain`,n*.6))),t(`filter.cutoff`,`Cutoff`,20,2e4,i(`filter.cutoff`),`Hz`,n((t,n)=>{e.setParam(t(`f1`),`frequency`,n),e.setParam(t(`f2`),`frequency`,n)}),`log`),t(`filter.resonance`,`Resonance`,.1,20,i(`filter.resonance`),``,n((t,n)=>e.setParam(t(`f1`),`Q`,n))),t(`filter.env`,`Env 1`,0,6,i(`filter.env`),`oct`,n((t,n)=>e.setParam(t(`env1Depth`),`gain`,n*At))),t(`filter.lfo`,`LFO`,0,4,i(`filter.lfo`),`oct`,t=>e.setParam(`lfoFilter`,`gain`,t*At)),t(`filter.key`,`Key track`,0,100,i(`filter.key`),`%`,n((t,n)=>e.setParam(t(`keyFollow`),`gain`,n/100))),t(`amp.lfo`,`LFO`,0,100,i(`amp.lfo`),`%`,t=>e.setParam(`lfoAmp`,`gain`,t/100*.8)),t(`amp.key`,`Key track`,0,100,i(`amp.key`),`%`,n((t,n)=>e.setParam(t(`ampKey`),`gain`,n/100/6e3))),t(`level`,`Volume`,0,1,i(`level`),``,t=>e.setParam(`level`,`gain`,t)),this.controlList.push(new O(`lfo.wave`,`Wave`,It,r[`lfo.wave`],t=>{e.setOption(`lfoOsc`,`waveform`,t===`sqr`?`square`:t===`up`||t===`down`?`sawtooth`:`triangle`),e.setParam(`lfoSign`,`gain`,t===`down`?-1:1),e.setParam(`lfoOscOut`,`gain`,t===`rnd`?0:1),e.setParam(`lfoRndOut`,`gain`,+(t===`rnd`))})),t(`lfo.rate`,`Rate`,.1,30,i(`lfo.rate`),`Hz`,e=>{this.lfoHz=e,this.applyLfoRate()},`log`),this.controlList.push(new k(`lfo.sync`,`Sync`,!1,e=>{this.lfoSync=e,this.applyLfoRate()}),new O(`lfo.division`,`Division`,Lt,r[`lfo.division`],e=>{this.lfoDivision=e,this.applyLfoRate()}));for(let e of[`env1`,`env2`])a(e,`attack`,`Attack`,.001,5),a(e,`decay`,`Decay`,.005,5),o(e),a(e,`release`,`Release`,.005,10);this.controlList.push(new O(`voices.mode`,`Mode`,Ot,r[`voices.mode`],e=>this.applyMode(e))),t(`voices.portamento`,`Portamento`,0,2,i(`voices.portamento`),`s`,t=>{this.portamento=t,this.eachVoice(n=>e.setParam(n(`pitch`),`glide`,t))}),t(`voices.detune`,`Detune`,0,50,i(`voices.detune`),`ct`,e=>{this.unisonDetune=e,this.applyDetune()}),t(`fx.chorus`,`Chorus`,0,1,i(`fx.chorus`),``,t=>{e.setParam(`chorusWet`,`gain`,t*.7),e.setParam(`chorusDry`,`gain`,1-t*.25)}),t(`fx.delayTime`,`Delay time`,.01,1,i(`fx.delayTime`),`s`,t=>e.setParam(`dlyLine`,`delayTime`,t),`log`),t(`fx.feedback`,`Feedback`,0,.9,i(`fx.feedback`),``,t=>e.setParam(`dlyFb`,`gain`,t)),t(`fx.mix`,`Delay mix`,0,1,i(`fx.mix`),``,t=>e.setParam(`dlyWet`,`gain`,t))}},Vt={"spring.length":2,"spring.tension":.5,"spring.drip":.6,"spring.tilt":0,"spring.dwell":.4,"spring.mix":.25},Ht=1.6,Ut=class extends E{name;constructor(e=`Spring`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`spring`,`spring`,{tension:.5,drip:.6,decay:2,tilt:0,dwell:.4}).add(`dry`,`gain`,{gain:1}).add(`wet`,`gain`,{gain:0}).add(`sum`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`spring`).connect(`in`,`dry`).connect(`spring`,`wet`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=(e,t,n,r,i,a,o)=>this.controlList.push(new D(e,t,n,r,Vt[e],i,a,o));n(`spring.length`,`Length`,.2,8,`s`,e=>t.setParam(`spring`,`decay`,e),`log`),n(`spring.tension`,`Tension`,0,1,``,e=>t.setParam(`spring`,`tension`,e)),n(`spring.drip`,`Drip`,0,1,``,e=>t.setParam(`spring`,`drip`,e)),n(`spring.tilt`,`Tilt`,-1,1,``,e=>t.setParam(`spring`,`tilt`,e)),n(`spring.dwell`,`Dwell`,0,1,``,e=>t.setParam(`spring`,`dwell`,e)),n(`spring.mix`,`Dry / wet`,0,1,``,e=>{t.setParam(`dry`,`gain`,Math.cos(e*Math.PI/2)),t.setParam(`wet`,`gain`,Math.sin(e*Math.PI/2)*Ht)})}reset(){for(let e of this.controlList)e.kind===`number`&&e.set(e.initial)}},Wt=75,Gt=10,Kt=15,qt=[`A`,`B`,`C`],Jt=[[1,2],[3,4],[5,6]],Yt=class extends E{channelCount;returnCount;returnFeeds;name;muted=new Set;soloed=new Set;constructor(e=1,t=`Mixer`,n=0,r={}){super(),this.channelCount=e,this.returnCount=n,this.returnFeeds=r,this.name=t;let i=this.circuit;i.add(`main`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`ceiling`,`waveshaper`,{},{curve:`limit`}).add(`mainMeter`,`meter`,{},{channel:`mono`}).connect(`main`,`limiter`).connect(`limiter`,`ceiling`).connect(`ceiling`,`mainMeter`),this.outputList.push({name:`main`,nodeId:`ceiling`}),i.add(`key`,`gain`,{gain:1}),this.outputList.push({name:`key`,nodeId:`key`}),this.meterList.push({name:`main`,nodeId:`mainMeter`});for(let e of qt){let t=`bus${e}`;i.add(t,`gain`,{gain:1}).add(`${t}.toMain`,`gain`,{gain:1}).add(`${t}.meterL`,`meter`,{},{channel:`left`}).add(`${t}.meterR`,`meter`,{},{channel:`right`}).connect(t,`${t}.toMain`).connect(`${t}.toMain`,`main`).connect(t,`${t}.meterL`).connect(t,`${t}.meterR`),this.outputList.push({name:t,nodeId:t}),this.meterList.push({name:`${t}.L`,nodeId:`${t}.meterL`},{name:`${t}.R`,nodeId:`${t}.meterR`}),this.controlList.push(new D(`${t}.fader`,`Bus ${e}`,0,1.5,1,``,e=>i.setParam(t,`gain`,e)),new k(`${t}.main`,`To main`,!0,e=>i.setParam(`${t}.toMain`,`gain`,+!!e)))}for(let e=1;e<=6;e++)i.add(`aux${e}`,`gain`,{gain:1}),this.outputList.push({name:`aux${e}`,nodeId:`aux${e}`}),this.controlList.push(new D(`aux${e}.master`,`Aux ${e}`,0,1.5,1,``,t=>i.setParam(`aux${e}`,`gain`,t)));for(let t=1;t<=e;t++)this.addStrip(`ch${t}`,t,!1);for(let e=1;e<=n;e++)this.addStrip(`ret${e}`,e,!0);this.controlList.push(new O(`key.source`,`Key source`,[`off`,...Array.from({length:e},(e,t)=>`${t+1}`)],`off`,t=>{for(let n=1;n<=e;n++)i.setParam(`ch${n}.keySend`,`gain`,+(t===`${n}`))}))}addStrip(e,t,n){let r=this.circuit,i=t=>`${e}.${t}`;r.add(i(`lowcut`),`filter`,{frequency:Gt,Q:.707,gain:0},{type:`highpass`}).add(i(`eqLow`),`filter`,{frequency:80,Q:.707,gain:0},{type:`lowshelf`}).add(i(`eqMid`),`filter`,{frequency:2500,Q:1,gain:0},{type:`peaking`}).add(i(`eqHigh`),`filter`,{frequency:12e3,Q:.707,gain:0},{type:`highshelf`}).add(i(`drive`),`gain`,{gain:1/3}).add(i(`sat`),`waveshaper`,{},{curve:`warm`}).add(i(`mute`),`gain`,{gain:1}).add(i(`fader`),`gain`,{gain:.8}).add(i(`pan`),`pan`,{pan:0}).connect(i(`lowcut`),i(`eqLow`)).connect(i(`eqLow`),i(`eqMid`)).connect(i(`eqMid`),i(`eqHigh`)).connect(i(`eqHigh`),i(`drive`)).connect(i(`drive`),i(`sat`)).connect(i(`sat`),i(`mute`)).connect(i(`mute`),i(`fader`)).connect(i(`fader`),i(`pan`)),n?(r.add(i(`meterL`),`meter`,{},{channel:`left`}).add(i(`meterR`),`meter`,{},{channel:`right`}).connect(i(`pan`),i(`meterL`)).connect(i(`pan`),i(`meterR`)),this.meterList.push({name:`${e}.L`,nodeId:i(`meterL`)},{name:`${e}.R`,nodeId:i(`meterR`)})):(r.add(i(`meter`),`meter`,{},{channel:`mono`}).connect(i(`fader`),i(`meter`)).add(i(`keySend`),`gain`,{gain:0}).connect(i(`mute`),i(`keySend`)).connect(i(`keySend`),`key`),this.meterList.push({name:e,nodeId:i(`meter`)})),this.inputList.push({name:e,nodeId:i(`lowcut`)});let a=qt.filter(e=>!(n&&this.returnFeeds[t]===e));for(let e of a)r.add(i(`assign${e}`),`gain`,{gain:0}).connect(i(`pan`),i(`assign${e}`)).connect(i(`assign${e}`),`bus${e}`);for(let e=1;e<=6;e++)r.add(i(`aux${e}.pre`),`gain`,{gain:0}).add(i(`aux${e}.post`),`gain`,{gain:1}).add(i(`aux${e}`),`gain`,{gain:0}).connect(i(`mute`),i(`aux${e}.pre`)).connect(i(`fader`),i(`aux${e}.post`)).connect(i(`aux${e}.pre`),i(`aux${e}`)).connect(i(`aux${e}.post`),i(`aux${e}`)).connect(i(`aux${e}`),`aux${e}`);let o=(e,t,n,r,a,o,s,c)=>new D(i(e),t,n,r,a,o,s,c),s=(e,t,n)=>o(e,t,-15,Kt,0,`dB`,e=>r.setParam(i(n),`gain`,e));this.controlList.push(new k(i(`lowcutOn`),`Low cut`,!1,e=>r.setParam(i(`lowcut`),`frequency`,e?Wt:Gt)),s(`eqHigh`,`High`,`eqHigh`),s(`eqMid`,`Mid`,`eqMid`),o(`eqMidFreq`,`Freq`,100,8e3,2500,`Hz`,e=>r.setParam(i(`eqMid`),`frequency`,e),`log`),s(`eqLow`,`Low`,`eqLow`));for(let e=1;e<=6;e++)this.controlList.push(o(`aux${e}`,`${e}`,0,1,0,``,t=>r.setParam(i(`aux${e}`),`gain`,t)));for(let[e,t]of Jt)this.controlList.push(new k(i(`auxPre${e}${t}`),`Pre ${e}-${t}`,!1,n=>{for(let a of[e,t])r.setParam(i(`aux${a}.pre`),`gain`,+!!n),r.setParam(i(`aux${a}.post`),`gain`,+!n)}));this.controlList.push(o(`pan`,n?`Balance`:`Pan`,-1,1,0,``,e=>r.setParam(i(`pan`),`pan`,e))),n?this.controlList.push(new k(i(`mute`),`Mute`,!1,e=>r.setParam(i(`mute`),`gain`,+!e))):this.controlList.push(new k(i(`mute`),`Mute`,!1,e=>this.setFlag(this.muted,t,e)),new k(i(`solo`),`Solo`,!1,e=>this.setFlag(this.soloed,t,e)));for(let e of a)this.controlList.push(new k(i(`bus${e}`),e,e===`A`,t=>r.setParam(i(`assign${e}`),`gain`,+!!t)));this.controlList.push(o(`fader`,`Fader`,0,1.5,.8,``,e=>r.setParam(i(`fader`),`gain`,e)))}get soloActive(){return this.soloed.size>0}setFlag(e,t,n){n?e.add(t):e.delete(t);for(let e=1;e<=this.channelCount;e++){let t=`ch${e}.mute`;if(!this.circuit.nodes.has(t))continue;let n=this.muted.has(e)||this.soloed.size>0&&!this.soloed.has(e);this.circuit.setParam(t,`gain`,+!n)}}},Xt={"osc.range":`8'`,"osc.width":50,"osc.pwSource":`man`,"osc.pwm":0,"osc.mod":0,"osc.sub":`-1`,"mix.saw":.8,"mix.pulse":0,"mix.sub":.55,"mix.noise":.05,"filter.cutoff":800,"filter.resonance":1,"filter.keyFollow":50,"filter.lfo":0,"filterEnv.amount":2,"filterEnv.attack":.005,"filterEnv.decay":.3,"filterEnv.sustain":.3,"filterEnv.release":.3,"ampEnv.attack":.005,"ampEnv.decay":.2,"ampEnv.sustain":.7,"ampEnv.release":.3,"lfo.wave":`tri`,"lfo.rate":4.8,"perf.glide":0,"perf.notes":`legato`,level:.5},V=(e,t)=>({name:e,values:t}),Zt=[V(`Init`,{}),V(`Sub Bass`,{"osc.range":`16'`,"mix.saw":.5,"mix.sub":.95,"mix.noise":0,"filter.cutoff":380,"filter.resonance":2,"filter.keyFollow":30,"filterEnv.amount":1.5,"filterEnv.attack":.001,"filterEnv.decay":.25,"filterEnv.sustain":.2,"ampEnv.attack":.002,"ampEnv.decay":.3,"ampEnv.sustain":.85,"ampEnv.release":.12,level:.6}),V(`Acid Squelch`,{"osc.range":`16'`,"mix.saw":1,"mix.sub":.35,"mix.noise":0,"filter.cutoff":220,"filter.resonance":14,"filter.keyFollow":40,"filterEnv.amount":4,"filterEnv.attack":.001,"filterEnv.decay":.18,"filterEnv.sustain":0,"filterEnv.release":.1,"ampEnv.sustain":.9,"ampEnv.release":.08,"perf.glide":.08,level:.45}),V(`Fat Pulse Bass`,{"osc.range":`16'`,"osc.width":30,"mix.saw":0,"mix.pulse":.9,"mix.sub":.5,"mix.noise":0,"filter.cutoff":520,"filter.resonance":3,"filterEnv.amount":2,"filterEnv.decay":.3,"filterEnv.sustain":.2,"ampEnv.sustain":.85,"ampEnv.release":.1}),V(`Wobble Bass`,{"osc.range":`16'`,"mix.saw":.8,"mix.sub":.7,"mix.noise":0,"filter.cutoff":300,"filter.resonance":6,"filter.lfo":2,"filterEnv.amount":.5,"filterEnv.sustain":.5,"lfo.wave":`tri`,"lfo.rate":3,"ampEnv.sustain":1,"ampEnv.release":.12,level:.55}),V(`Funk Pluck`,{"osc.range":`8'`,"osc.width":25,"mix.saw":.3,"mix.pulse":.8,"mix.sub":.3,"mix.noise":0,"filter.cutoff":260,"filter.resonance":5,"filter.keyFollow":60,"filterEnv.amount":3.5,"filterEnv.attack":.001,"filterEnv.decay":.15,"filterEnv.sustain":0,"ampEnv.attack":.001,"ampEnv.decay":.2,"ampEnv.sustain":.3,"ampEnv.release":.1}),V(`Rubber Bass`,{"osc.range":`16'`,"mix.saw":.7,"mix.sub":.8,"mix.noise":0,"filter.cutoff":150,"filter.resonance":8,"filter.keyFollow":25,"filterEnv.amount":3,"filterEnv.attack":.001,"filterEnv.decay":.3,"filterEnv.sustain":.1,"ampEnv.sustain":.8,"ampEnv.release":.1,level:.55}),V(`Saw Lead`,{"mix.saw":1,"mix.sub":.2,"mix.noise":0,"filter.cutoff":3e3,"filter.resonance":3,"filter.keyFollow":70,"filterEnv.amount":1,"perf.glide":.06,"osc.mod":15,"lfo.rate":5.5,"ampEnv.sustain":.9,"ampEnv.release":.25}),V(`Hollow Pulse Lead`,{"osc.width":18,"mix.saw":0,"mix.pulse":1,"mix.sub":0,"mix.noise":0,"filter.cutoff":2500,"filter.resonance":2,"filter.keyFollow":80,"filterEnv.amount":1.5,"filterEnv.attack":.01,"filterEnv.decay":.4,"filterEnv.sustain":.5,"ampEnv.sustain":.8,"ampEnv.release":.2}),V(`PWM Lead`,{"mix.saw":.2,"mix.pulse":.9,"mix.sub":.2,"mix.noise":0,"osc.pwSource":`lfo`,"osc.pwm":70,"lfo.rate":1.2,"filter.cutoff":3e3,"filter.resonance":2,"filter.keyFollow":70,"filterEnv.amount":1,"ampEnv.sustain":.9,"ampEnv.release":.3}),V(`Vibrato Lead`,{"mix.saw":.8,"mix.pulse":.4,"mix.sub":.1,"mix.noise":0,"osc.mod":40,"lfo.rate":5.2,"filter.cutoff":2800,"filter.resonance":3,"filter.keyFollow":70,"filterEnv.amount":1.2,"perf.glide":.1,"ampEnv.attack":.01,"ampEnv.sustain":.9,"ampEnv.release":.3}),V(`Portamento Solo`,{"mix.saw":1,"mix.sub":.3,"mix.noise":0,"perf.glide":.35,"perf.notes":`legato`,"filter.cutoff":2200,"filter.resonance":4,"filterEnv.amount":.8,"filterEnv.sustain":.6,"ampEnv.sustain":1,"ampEnv.release":.2}),V(`Clarinet`,{"osc.width":50,"mix.saw":0,"mix.pulse":1,"mix.sub":0,"mix.noise":.03,"filter.cutoff":1800,"filter.resonance":1,"filter.keyFollow":70,"filterEnv.amount":1,"filterEnv.attack":.04,"filterEnv.sustain":.6,"ampEnv.attack":.04,"ampEnv.sustain":.9,"ampEnv.release":.12,"osc.mod":8,"lfo.rate":5}),V(`Brass`,{"mix.saw":1,"mix.pulse":.4,"mix.sub":.2,"mix.noise":0,"filter.cutoff":500,"filter.resonance":2,"filter.keyFollow":60,"filterEnv.amount":3,"filterEnv.attack":.12,"filterEnv.decay":.3,"filterEnv.sustain":.6,"ampEnv.attack":.08,"ampEnv.decay":.2,"ampEnv.sustain":.85,"ampEnv.release":.2}),V(`Siren`,{"mix.saw":1,"mix.sub":0,"mix.noise":0,"osc.mod":600,"lfo.wave":`tri`,"lfo.rate":.7,"filter.cutoff":4e3,"filter.resonance":2,"filterEnv.amount":0,"ampEnv.sustain":1,"ampEnv.release":.15}),V(`Random SFX`,{"mix.saw":.5,"mix.pulse":.5,"mix.sub":0,"mix.noise":0,"lfo.wave":`rnd`,"lfo.rate":9,"osc.mod":500,"filter.cutoff":1200,"filter.resonance":8,"filter.lfo":2.5,"filterEnv.amount":0,"ampEnv.attack":.01,"ampEnv.sustain":1,"ampEnv.release":.1,level:.45}),V(`Snare`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":1,"filter.cutoff":3e3,"filter.resonance":2,"filter.keyFollow":0,"filterEnv.amount":1,"filterEnv.attack":.001,"filterEnv.decay":.1,"filterEnv.sustain":0,"ampEnv.attack":.001,"ampEnv.decay":.18,"ampEnv.sustain":0,"ampEnv.release":.1,level:.6}),V(`Wind`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":1,"filter.cutoff":500,"filter.resonance":8,"filter.keyFollow":0,"filterEnv.amount":4,"filterEnv.attack":2,"filterEnv.decay":2,"filterEnv.sustain":.5,"filterEnv.release":2,"ampEnv.attack":1.5,"ampEnv.sustain":1,"ampEnv.release":2,level:.5}),V(`Whistle`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":.6,"filter.cutoff":2e3,"filter.resonance":20,"filter.keyFollow":100,"filterEnv.amount":0,"osc.mod":20,"lfo.rate":5,"ampEnv.attack":.05,"ampEnv.sustain":1,"ampEnv.release":.2,level:.35})],Qt=new Map([[70,`filter.cutoff`],[71,`filter.resonance`],[72,`filterEnv.amount`],[73,`filterEnv.decay`],[74,`ampEnv.decay`],[75,`ampEnv.release`],[76,`osc.width`],[77,`osc.pwm`],[78,`mix.pulse`],[79,`mix.sub`],[80,`mix.noise`],[81,`lfo.rate`],[82,`osc.mod`],[83,`perf.glide`]]);function $t(e,t){let n=Math.min(127,Math.max(0,t))/127;if(e.kind===`number`)e.set(e.curve===`log`?e.min*(e.max/e.min)**+n:e.min+n*(e.max-e.min));else if(e.kind===`choice`){let t=Math.min(e.options.length-1,Math.floor(n*e.options.length));e.set(e.options[t])}else e.set(t>=64)}var en=1200,tn=200,nn=100,rn=1,H=440,an=4.8,on=[`man`,`lfo`,`env`],sn=[`legato`,`retrig`],cn=[`tri`,`sqr`,`rnd`],ln={"16'":-1200,"8'":0,"4'":1200,"2'":2400},un={"-1":-1200,"-2":-2400},dn=class extends E{name;transport;ccMap=new Map(Qt);held=[];presetListeners=new Set;currentPreset=Zt[0];gateOpen=!1;glideSeconds=0;retrigger=!1;pwSource=`man`;pwmAmount=0;bend=0;modWheelValue=0;oscModCents=0;performanceListeners=new Set;noteListeners=new Set;constructor(e=`Synth`,t=new T){super(),this.name=e,this.transport=new Fe(t);let n=this.circuit;n.add(`pitch`,`constant`,{offset:0,glide:0}).add(`range`,`constant`,{offset:0}).add(`bend`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:un[-1]}).add(`pulseWidthCv`,`constant`,{offset:0}).add(`sawOsc`,`oscillator`,{frequency:H,detune:0},{waveform:`sawtooth`}).add(`pulseOsc`,`oscillator`,{frequency:H,detune:0},{waveform:`sawtooth`}).add(`pulseSum`,`gain`,{gain:1}).add(`pulseShaper`,`waveshaper`,{},{curve:`pulse`}).add(`subOsc`,`oscillator`,{frequency:H,detune:0},{waveform:`square`}).add(`noise`,`noise`).add(`mix.saw`,`gain`,{gain:.8}).add(`mix.pulse`,`gain`,{gain:0}).add(`mix.sub`,`gain`,{gain:.55}).add(`mix.noise`,`gain`,{gain:.05}).add(`mix`,`gain`,{gain:.5}).add(`filter1`,`filter`,{frequency:800,Q:1,detune:0},{type:`lowpass`}).add(`filter2`,`filter`,{frequency:800,Q:.707,detune:0},{type:`lowpass`}).add(`keyFollow`,`gain`,{gain:.5}).add(`amp`,`gain`,{gain:0}).add(`level`,`gain`,{gain:.5}).add(`ampEnv`,`envelope`,{attack:.005,decay:.2,sustain:.7,release:.3,gate:0}).add(`filterEnv`,`envelope`,{attack:.005,decay:.3,sustain:.3,release:.3,gate:0}).add(`filterEnvDepth`,`gain`,{gain:2*en}).add(`lfoOsc`,`oscillator`,{frequency:an,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:an}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`envPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0});for(let e of[`sawOsc`,`pulseOsc`,`subOsc`])n.connect(`pitch`,e,`detune`).connect(`range`,e,`detune`).connect(`bend`,e,`detune`);n.connect(`subShift`,`subOsc`,`detune`).connect(`pulseOsc`,`pulseSum`).connect(`pulseWidthCv`,`pulseSum`).connect(`pulseSum`,`pulseShaper`).connect(`sawOsc`,`mix.saw`).connect(`pulseShaper`,`mix.pulse`).connect(`subOsc`,`mix.sub`).connect(`noise`,`mix.noise`);for(let e of[`mix.saw`,`mix.pulse`,`mix.sub`,`mix.noise`])n.connect(e,`mix`);n.connect(`mix`,`filter1`).connect(`filter1`,`filter2`).connect(`filter2`,`amp`).connect(`amp`,`level`).connect(`ampEnv`,`amp`,`gain`).connect(`filterEnv`,`filterEnvDepth`).connect(`pitch`,`keyFollow`);for(let e of[`filter1`,`filter2`])n.connect(`filterEnvDepth`,e,`detune`).connect(`keyFollow`,e,`detune`).connect(`lfoFilter`,e,`detune`);for(let e of[`sawOsc`,`pulseOsc`,`subOsc`])n.connect(`lfoPitch`,e,`detune`);n.connect(`lfoOsc`,`lfoOscOut`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoOscOut`,`lfo`).connect(`lfoRndOut`,`lfo`).connect(`lfo`,`lfoPitch`).connect(`lfo`,`lfoPw`).connect(`lfo`,`lfoFilter`).connect(`lfoPw`,`pulseSum`).connect(`filterEnv`,`envPw`).connect(`envPw`,`pulseSum`),this.outputList.push({name:`out`,nodeId:`level`}),this.controlList.push(new O(`osc.range`,`Range`,Object.keys(ln),`8'`,e=>n.setParam(`range`,`offset`,ln[e])),new D(`osc.width`,`Width`,5,50,50,`%`,e=>n.setParam(`pulseWidthCv`,`offset`,1-2*e/100)),new O(`osc.sub`,`Sub`,Object.keys(un),`-1`,e=>n.setParam(`subShift`,`offset`,un[e])),pn(n,`saw`,`Saw`,.8),pn(n,`pulse`,`Pulse`,0),pn(n,`sub`,`Sub`,.55),pn(n,`noise`,`Noise`,.05),new D(`filter.cutoff`,`Cutoff`,20,2e4,800,`Hz`,e=>{n.setParam(`filter1`,`frequency`,e),n.setParam(`filter2`,`frequency`,e)},`log`),new D(`filter.resonance`,`Resonance`,.1,20,1,``,e=>n.setParam(`filter1`,`Q`,e)),new D(`filter.keyFollow`,`Key`,0,100,50,`%`,e=>n.setParam(`keyFollow`,`gain`,e/100)),new D(`perf.glide`,`Glide`,0,3,0,`s`,e=>{this.glideSeconds=e,n.setParam(`pitch`,`glide`,e)}),new O(`perf.notes`,`Notes`,sn,`legato`,e=>{this.retrigger=e===`retrig`}),new O(`lfo.wave`,`Wave`,cn,`tri`,e=>{n.setOption(`lfoOsc`,`waveform`,e===`sqr`?`square`:`triangle`),n.setParam(`lfoOscOut`,`gain`,e===`rnd`?0:1),n.setParam(`lfoRndOut`,`gain`,+(e===`rnd`))}),new D(`lfo.rate`,`Rate`,.1,30,an,`Hz`,e=>{n.setParam(`lfoOsc`,`frequency`,e),n.setParam(`lfoRnd`,`rate`,e)},`log`),new D(`osc.mod`,`Mod`,0,600,0,`ct`,e=>{this.oscModCents=e,this.applyVibrato()}),new O(`osc.pwSource`,`PW src`,on,`man`,e=>{this.pwSource=e,this.applyPwm()}),new D(`osc.pwm`,`PWM`,0,100,0,`%`,e=>{this.pwmAmount=e/100,this.applyPwm()}),new D(`filter.lfo`,`LFO`,0,4,0,`oct`,e=>n.setParam(`lfoFilter`,`gain`,e*en)),new D(`level`,`Level`,0,1,.5,``,e=>n.setParam(`level`,`gain`,e)),new D(`filterEnv.amount`,`Amount`,0,6,2,`oct`,e=>n.setParam(`filterEnvDepth`,`gain`,e*en)),...fn(n,`filterEnv`,{attack:.005,decay:.3,sustain:.3,release:.3}),...fn(n,`ampEnv`,{attack:.005,decay:.2,sustain:.7,release:.3}))}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*tn),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.applyVibrato(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}applyVibrato(){this.circuit.setParam(`lfoPitch`,`gain`,this.oscModCents+this.modWheelValue*nn)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}loadPreset(e){let t={...Xt,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}keyDown(e){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.noteOn(mn(e)),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e);let t=this.held[this.held.length-1];t===void 0?this.noteOff():this.noteOn(mn(t)),this.notifyNotes()}handleMidi(e){if(!(`channel`in e&&!this.transport.acceptsChannel(e.channel)))switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:{if(e.controller===rn){this.setModWheel(e.value/127);break}let t=this.ccMap.get(e.controller);t&&$t(this.control(t),e.value);break}case`programChange`:{let t=Zt[e.program];t&&this.loadPreset(t);break}}}applyPwm(){let e=this.pwmAmount*.9;this.circuit.setParam(`lfoPw`,`gain`,this.pwSource===`lfo`?e:0),this.circuit.setParam(`envPw`,`gain`,this.pwSource===`env`?e:0)}noteOn(e){let t=this.gateOpen,n=this.glideSeconds;t||this.circuit.setParam(`pitch`,`glide`,0),this.circuit.setParam(`pitch`,`offset`,en*Math.log2(e/H)),t||this.circuit.setParam(`pitch`,`glide`,n),(!t||this.retrigger)&&(this.circuit.setParam(`ampEnv`,`gate`,1),this.circuit.setParam(`filterEnv`,`gate`,1)),this.gateOpen=!0}noteOff(){this.circuit.setParam(`ampEnv`,`gate`,0),this.circuit.setParam(`filterEnv`,`gate`,0),this.gateOpen=!1}};function fn(e,t,n){let r=(r,i,a,o)=>new D(`${t}.${r}`,i,a,o,n[r],`s`,n=>e.setParam(t,r,n),`log`);return[r(`attack`,`Attack`,.001,5),r(`decay`,`Decay`,.005,5),new D(`${t}.sustain`,`Sustain`,0,1,n.sustain,``,n=>e.setParam(t,`sustain`,n)),r(`release`,`Release`,.005,10)]}function pn(e,t,n,r){return new D(`mix.${t}`,n,0,1,r,``,n=>e.setParam(`mix.${t}`,`gain`,n))}var mn=e=>H*2**((e-69)/12),hn=class e{devices=new Map;connections=[];output;add(e,t){if(this.devices.has(e))throw Error(`Duplicate device id: ${e}`);return this.devices.set(e,t),this}device(e){let t=this.devices.get(e);if(!t)throw Error(`Unknown device: ${e}`);return t}connect(e,t){if(this.device(e.device).jack(`out`,e.jack),this.device(t.device).jack(`in`,t.jack),this.connections.some(n=>n.to.device===t.device&&n.to.jack===t.jack&&n.from.device===e.device&&n.from.jack===e.jack))throw Error(`Duplicate connection`);return this.connections.push({from:e,to:t}),this}setOutput(e,t){return this.device(e).jack(`out`,t),this.output={device:e,jack:t},this}static pipe(t=new T){return new e().add(`pipe`,new wt(`Pipe`,t)).add(`spring`,new Ut(`Spring`)).connect({device:`pipe`,jack:`out`},{device:`spring`,jack:`in`}).setOutput(`spring`,`out`)}static default(t=new T){let n=new e().add(`synth`,new dn(`Synth`,t)).add(`poly`,new Bt(`Poly`,t)).add(`drums`,new ze(`Drums`,t)).add(`reverb`,new Ue(`Reverb`)).add(`delay`,new We(`Delay`)).add(`ouroboros`,new ft(`Ouroboros`)).add(`buscomp`,new Ae(`Bus Comp`)).add(`granular`,new $e(`Granular`)).add(`mixer`,new Yt(2+j.length,`Mixer`,5,{3:`C`,4:`B`})).connect({device:`synth`,jack:`out`},{device:`mixer`,jack:`ch1`}).connect({device:`poly`,jack:`out`},{device:`mixer`,jack:`ch2`});j.forEach((e,t)=>n.connect({device:`drums`,jack:e},{device:`mixer`,jack:`ch${t+3}`})),n.connect({device:`mixer`,jack:`aux1`},{device:`reverb`,jack:`in`}).connect({device:`mixer`,jack:`aux2`},{device:`delay`,jack:`in`}).connect({device:`reverb`,jack:`out`},{device:`mixer`,jack:`ret1`}).connect({device:`delay`,jack:`out`},{device:`mixer`,jack:`ret2`}),n.connect({device:`mixer`,jack:`busC`},{device:`ouroboros`,jack:`in`}).connect({device:`ouroboros`,jack:`out`},{device:`mixer`,jack:`ret3`}),n.connect({device:`mixer`,jack:`busB`},{device:`buscomp`,jack:`in`}).connect({device:`mixer`,jack:`key`},{device:`buscomp`,jack:`key`}).connect({device:`buscomp`,jack:`out`},{device:`mixer`,jack:`ret4`}),n.connect({device:`mixer`,jack:`aux3`},{device:`granular`,jack:`in`}).connect({device:`granular`,jack:`out`},{device:`mixer`,jack:`ret5`});let r=n.device(`mixer`);return r.control(`busC.main`).set(!1),r.control(`busB.main`).set(!1),r.control(`key.source`).set(`3`),n.setOutput(`mixer`,`main`)}},gn=`moa.midiInput`,_n=class{status=typeof navigator<`u`&&`requestMIDIAccess`in navigator?`idle`:`unsupported`;inputs=[];selectedId;onMessage;access;listeners=new Set;async connect(){if(this.status!==`unsupported`){try{this.access=await navigator.requestMIDIAccess({sysex:!1})}catch{this.status=`denied`,this.emit();return}this.status=`ready`,this.access.onstatechange=()=>this.refresh(),this.refresh()}}async connectIfPermitted(){if(this.status===`idle`)try{(await navigator.permissions.query({name:`midi`})).state===`granted`&&await this.connect()}catch{}}select(e){if(this.access)for(let e of this.access.inputs.values())e.onmidimessage=null;if(this.selectedId=e,e){let t=this.access?.inputs.get(e);t&&(t.onmidimessage=e=>{e.data&&this.onMessage?.(e.data,e.timeStamp)});try{localStorage.setItem(gn,e)}catch{}}this.emit()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}refresh(){this.inputs=[...this.access?.inputs.values()??[]].map(e=>({id:e.id,name:e.name??e.id})),this.selectedId&&this.inputs.some(e=>e.id===this.selectedId)?this.emit():this.select(this.pickDefault())}pickDefault(){let e=null;try{e=localStorage.getItem(gn)}catch{}return this.inputs.find(t=>t.id===e)?.id??this.inputs.find(e=>/torso|t-?1/i.test(e.name))?.id??(this.inputs.length===1?this.inputs[0]?.id:void 0)}emit(){for(let e of this.listeners)e()}},U=1e3;function vn(e){let t=e.curve===`log`?Math.log(e.value/e.min)/Math.log(e.max/e.min):(e.value-e.min)/(e.max-e.min);return Math.round(t*U)}function yn(e,t){let n=t/U;return e.curve===`log`?e.min*(e.max/e.min)**+n:e.min+n*(e.max-e.min)}function bn(e){let t=e.value;return`${t>=100?t.toFixed(0):t>=10?t.toFixed(1):t>=1?t.toFixed(2):t.toFixed(3)}${e.unit?` `+e.unit:``}`}function W(e,t,n){let r=document.createElement(e);return t&&(r.className=t),n!==void 0&&(r.textContent=n),r}function xn(e,t,n,r,i=`btn`){let a=W(`button`,i);a.type=`button`,a.setAttribute(`aria-label`,t);let o=()=>{a.textContent=n(e.value),a.setAttribute(`aria-pressed`,String(e.value)),a.style.background=e.value?r:``,a.style.borderColor=e.value?r:``};return a.addEventListener(`click`,()=>{e.set(!e.value),o()}),e.onChange(o),o(),a}var Sn=150;function Cn(e,t,n,r){let i=W(`section`,`midi-strip`),a=W(`div`,`midi-block`);a.append(W(`div`,`fader-label`,`Audio`),r);let o=W(`div`,`midi-block`);o.append(W(`div`,`fader-label`,`MIDI input`));let s=W(`div`,`midi-device`);o.append(s);let c=()=>{if(s.replaceChildren(),e.status===`unsupported`)s.append(W(`div`,`midi-message`,`MIDI is not available in this browser. Try Chrome or Edge.`));else if(e.status===`denied`)s.append(W(`div`,`midi-message`,`MIDI access was blocked. Allow it in the site settings, then reload.`));else if(e.status===`idle`){let t=W(`button`,`btn midi-connect`,`Connect MIDI`);t.type=`button`,t.addEventListener(`click`,()=>void e.connect()),s.append(t)}else{let t=W(`select`,`patch-select`);t.setAttribute(`aria-label`,`MIDI input device`),t.add(new Option(e.inputs.length?`No device selected`:`No MIDI devices found`,``));for(let n of e.inputs)t.add(new Option(n.name,n.id));t.value=e.selectedId??``,t.addEventListener(`change`,()=>e.select(t.value||void 0)),s.append(t)}};e.onChange(c),c();let l=W(`div`,`midi-block`);l.append(W(`div`,`fader-label`,`Incoming clock`));let u=W(`div`,`midi-bpm`,`--.-`),d=W(`div`,`midi-badges`),f=W(`span`,`badge`,`No clock`),p=W(`span`,`badge`,`Stopped`);d.append(f,p),l.append(u,d);let m=W(`div`,`midi-block`);m.append(W(`div`,`fader-label`,`Activity`));let h=W(`div`,`midi-leds`),g={note:W(`span`,`led`),cc:W(`span`,`led`),clock:W(`span`,`led`)};for(let[e,t]of[[`note`,`Notes`],[`cc`,`CC`],[`clock`,`Clock`]]){let n=W(`div`,`led-item`);n.append(g[e],W(`span`,void 0,t)),h.append(n)}m.append(h);let _=W(`div`,`midi-block midi-monitor-block`),v=W(`div`,`midi-monitor-head`);v.append(W(`div`,`fader-label`,`Monitor`));let y=W(`button`,`btn btn-small midi-clear`,`Clear`);y.type=`button`,y.addEventListener(`click`,()=>n.clear()),v.append(y);let b=W(`div`,`midi-log`);b.setAttribute(`role`,`log`),b.setAttribute(`aria-label`,`Recent MIDI messages`),_.append(v,b);let x=()=>{b.replaceChildren(...n.lines.slice(-5).map(e=>W(`div`,`midi-line midi-line-${e.kind}`,e.text)))};n.onChange(x),x(),i.append(a,o,l,m,_);let S=()=>{let e=performance.now(),r=t.bpm,i=t.isLocked(e);u.textContent=r!==void 0&&i?r.toFixed(1):`--.-`,f.textContent=i?`Clock locked`:`No clock`,f.classList.toggle(`on`,i),p.textContent=t.running?`Running`:`Stopped`,p.classList.toggle(`on`,t.running);for(let t of[`note`,`cc`,`clock`])g[t].classList.toggle(`on`,e-n.lastSeen[t]<Sn);requestAnimationFrame(S)};return requestAnimationFrame(S),i}var wn=270,Tn=160,En=600,Dn=131.95;function On(e,t,n=e.label){return{label:n,color:t,get:()=>vn(e)/U,set:t=>e.set(yn(e,Math.round(Math.min(1,Math.max(0,t))*U))),reset:()=>e.set(e.initial),text:()=>bn(e),subscribe:t=>e.onChange(t)}}var kn=(e,t)=>{let n=Math.round((-135+e*wn)*10)/10;return`<svg aria-hidden="true" width="72" height="72" viewBox="0 0 80 80">
    <path d="M16.34 64.42 A34 34 0 1 1 63.66 64.42" fill="none" stroke="#6b6f75" stroke-width="4" stroke-dasharray="1.2 14.8"></path>
    <path d="M20.2 59.8 A28 28 0 1 1 59.8 59.8" fill="none" stroke="#33363b" stroke-width="3"></path>
    <path d="M20.2 59.8 A28 28 0 1 1 59.8 59.8" fill="none" stroke="${t}" stroke-width="3" stroke-dasharray="${(e*Dn).toFixed(1)} 200"></path>
    <circle cx="40" cy="40" r="22" fill="#101112" stroke="#4a4e54" stroke-width="1.5"></circle>
    <circle cx="40" cy="40" r="15" fill="#25282c" stroke="#3a3d42" stroke-width="1"></circle>
    <rect x="38.8" y="21.5" width="2.4" height="15" rx="1.2" fill="#f1eee6" transform="rotate(${n} 40 40)"></rect>
  </svg>`};function An(e,t,n=kn){let r=W(`div`,`dial`),i=W(`div`,`dial-face`);i.tabIndex=0,i.setAttribute(`role`,`slider`),i.setAttribute(`aria-label`,`${t} ${e.label}`),i.setAttribute(`aria-orientation`,`vertical`),i.setAttribute(`aria-valuemin`,`0`),i.setAttribute(`aria-valuemax`,`100`);let a=W(`div`,`dial-label`,e.label),o=W(`div`,`dial-value`),s=()=>{let t=e.get();i.innerHTML=n(t,e.color),o.textContent=e.text(),i.setAttribute(`aria-valuenow`,String(Math.round(t*100))),i.setAttribute(`aria-valuetext`,o.textContent)},c=t=>{e.set(Math.min(1,Math.max(0,t))),s()},l;i.addEventListener(`pointerdown`,t=>{t.preventDefault(),i.focus(),i.setPointerCapture(t.pointerId),l={y:t.clientY,t:e.get()}}),i.addEventListener(`pointermove`,e=>{l&&c(l.t+(l.y-e.clientY)/(e.shiftKey?En:Tn))});let u=()=>{l=void 0};return i.addEventListener(`pointerup`,u),i.addEventListener(`pointercancel`,u),i.addEventListener(`dblclick`,()=>{e.reset(),s()}),i.addEventListener(`keydown`,t=>{let n=(t.shiftKey?5:1)*(e.step??.02),r=e.get(),i={ArrowUp:r+n,ArrowRight:r+n,ArrowDown:r-n,ArrowLeft:r-n,Home:0,End:1};t.key in i&&(t.preventDefault(),c(i[t.key]))}),e.subscribe(s),s(),r.append(i,a,o),r}var jn=.04;function Mn(e){let t=W(`div`,`wheel`);t.append(W(`div`,`wheel-label`,e.label));let n=W(`div`,`wheel-body`),r=W(`div`,`wheel-scale`);r.setAttribute(`aria-hidden`,`true`);for(let t of e.scale)r.append(W(`span`,void 0,t));let i=W(`button`,`wheel-face`);i.type=`button`,i.setAttribute(`role`,`slider`),i.setAttribute(`aria-label`,e.ariaLabel),i.setAttribute(`aria-orientation`,`vertical`),i.setAttribute(`aria-valuemin`,e.bipolar?`-1`:`0`),i.setAttribute(`aria-valuemax`,`1`),i.append(W(`span`,`wheel-ribs`)),e.bipolar&&i.append(W(`span`,`wheel-detent wheel-detent-left`),W(`span`,`wheel-detent wheel-detent-right`));let a=W(`div`,`wheel-marker`);a.setAttribute(`aria-hidden`,`true`);let o=W(`div`,`wheel-readout`),s=t=>e.bipolar?(t+1)/2:t,c=()=>{let t=e.get(),n=s(t);i.style.setProperty(`--rib`,`${Math.round(t*-60)}px`),a.style.top=`${Math.round((1-n)*102)}px`,o.textContent=e.format(t),i.setAttribute(`aria-valuenow`,String(t)),i.setAttribute(`aria-valuetext`,e.format(t))},l=t=>{let n=Math.min((e.bipolar,1),Math.max(e.bipolar?-1:0,t));e.set(e.bipolar&&Math.abs(n)<jn?0:n),c()},u=t=>{let n=i.getBoundingClientRect(),r=Math.min(1,Math.max(0,1-(t.clientY-n.top)/n.height));l(e.bipolar?r*2-1:r)},d=!1;i.addEventListener(`pointerdown`,e=>{i.setPointerCapture(e.pointerId),d=!0,u(e)}),i.addEventListener(`pointermove`,e=>{d&&u(e)});let f=()=>{d=!1,e.springBack&&l(0)};i.addEventListener(`pointerup`,f),i.addEventListener(`pointercancel`,f),i.addEventListener(`keydown`,t=>{let n=t.key===`ArrowUp`||t.key===`ArrowRight`?1:t.key===`ArrowDown`||t.key===`ArrowLeft`?-1:0;n&&(t.preventDefault(),l(e.get()+n*e.keyStep))}),i.addEventListener(`keyup`,()=>{e.springBack&&l(0)}),i.addEventListener(`dblclick`,()=>l(0)),e.subscribe(c),c();let p=W(`div`,`wheel-markers`);return p.append(a),n.append(r,i,p),t.append(n,o),t}var Nn=36,Pn=49,Fn=[`a`,`w`,`s`,`e`,`d`,`f`,`t`,`g`,`y`,`h`,`u`,`j`,`k`],In=24,Ln=[`C`,`C#`,`D`,`D#`,`E`,`F`,`F#`,`G`,`G#`,`A`,`A#`,`B`],Rn=[!0,!1,!0,!1,!0,!0,!1,!0,!1,!0,!1,!0],zn=Rn.reduce((e,t,n)=>e+ +!!t,0)*4+1,Bn=100/zn*.6,Vn=2,Hn,Un=e=>`${Ln[e%12]}${Math.floor(e/12)-1}`,Wn=e=>{let t=Math.round(e*2*100)/100;return`${t>0?`+`:``}${t.toFixed(2)} st`};function Gn(e){let t=W(`div`,`keybed`);Hn??=t,document.addEventListener(`pointerdown`,e=>{t.parentElement?.contains(e.target)&&(Hn=t)},!0);let n=W(`div`,`keybed-cheek`),r=W(`div`,`keybed-wheels`);r.append(Mn({label:`Bend`,ariaLabel:`Pitch bend`,bipolar:!0,scale:[`+2`,`0`,`-2`],springBack:!0,keyStep:.125,get:()=>e.pitchBend,set:t=>e.setPitchBend(t),subscribe:t=>e.onPerformanceChange(t),format:Wn}),Mn({label:`Mod`,ariaLabel:`Modulation, LFO vibrato depth`,bipolar:!1,scale:[`100`,`0`],springBack:!1,keyStep:.1,get:()=>e.modWheel,set:t=>e.setModWheel(t),subscribe:t=>e.onPerformanceChange(t),format:e=>`${Math.round(e*100)} %`}));let i=0,a=W(`div`,`keybed-octave`),o=W(`button`,`btn btn-small`,`<`);o.type=`button`,o.setAttribute(`aria-label`,`Octave down`);let s=W(`button`,`btn btn-small`,`>`);s.type=`button`,s.setAttribute(`aria-label`,`Octave up`);let c=W(`span`,`keybed-octave-text`,`Oct 0`);a.append(o,c,s),n.append(r,a);let l=W(`div`,`keybed-keys`),u=W(`div`,`keybed-whites`);l.append(u);let d=[],f=new Map,p=0,m=t=>{if(f.has(t))return;let n=Nn+t+i*12;f.set(t,n),e.keyDown(n)},h=t=>{let n=f.get(t);n!==void 0&&(f.delete(t),e.keyUp(n))};for(let e=0;e<Pn;e++){let t=Rn[e%12],n=W(`button`,t?`key-white`:`key-black`);n.type=`button`,n.setAttribute(`aria-label`,`Key ${Un(Nn+e)}`);let r=Fn[e-In];r&&(n.textContent=r),t?(u.append(n),p++):(n.style.left=`${Math.round((p/zn*100-Bn/2)*1e3)/1e3}%`,n.style.width=`${Bn}%`,l.append(n)),n.addEventListener(`pointerdown`,t=>{t.preventDefault(),m(e)});for(let t of[`pointerup`,`pointerleave`,`pointercancel`])n.addEventListener(t,()=>h(e));n.addEventListener(`keydown`,t=>{(t.key===` `||t.key===`Enter`)&&!t.repeat&&(t.preventDefault(),m(e))}),n.addEventListener(`keyup`,()=>h(e)),d.push(n)}let g=()=>{let t=new Set(e.heldNotes),n=new Set(f.values());d.forEach((e,r)=>{let i=f.has(r)||t.has(Nn+r)&&!n.has(Nn+r);e.classList.toggle(`on`,i),e.setAttribute(`aria-pressed`,String(i))})};e.onNoteChange(g);let _=()=>{c.textContent=`Oct ${i>0?`+`:``}${i}`,o.disabled=i<=-2,s.disabled=i>=Vn,g()};return o.addEventListener(`click`,()=>{i=Math.max(-2,i-1),_()}),s.addEventListener(`click`,()=>{i=Math.min(Vn,i+1),_()}),_(),window.addEventListener(`keydown`,e=>{if(Hn!==t||e.repeat||e.metaKey||e.ctrlKey||e.altKey||e.target instanceof HTMLSelectElement)return;let n=Fn.indexOf(e.key.toLowerCase());n>=0&&m(In+n)}),window.addEventListener(`keyup`,e=>{let t=Fn.indexOf(e.key.toLowerCase());t>=0&&h(In+t)}),t.append(n,l),t}function Kn(e){try{let t=window.localStorage.getItem(e);return t?JSON.parse(t):{}}catch{return{}}}var qn=(e,t)=>typeof e==`object`&&!!e&&Object.entries(e).every(([e,n])=>t.has(e)&&(typeof n==`number`||typeof n==`string`));function Jn(e,t){let n=new Set(t.controls.map(e=>e.id));for(let[r,i]of Object.entries(Kn(e))){let e=Number(r);Number.isInteger(e)&&e>=0&&e<t.slots.length&&typeof i?.name==`string`&&qn(i.values,n)&&(t.slots[e]=i)}}function Yn(e,t,n){try{window.localStorage.setItem(e,JSON.stringify({...Kn(e),[t]:n}))}catch{}}var Xn=`moapipe.patches`,Zn=e=>Jn(Xn,e),Qn=(e,t)=>Yn(Xn,e,t),$n=`#d9628a`;function er(e,t={running:()=>e.running,position:()=>e.position}){let n=W(`div`,`transport`),r=W(`div`,`transport-tempo`);r.append(W(`div`,`fader-label`,`Tempo`));let i=W(`div`,`transport-bpm`,`120.0`),a=W(`div`,`transport-tempo-buttons`),o=W(`button`,`btn btn-small transport-tap`,`Tap`);o.type=`button`,o.addEventListener(`click`,()=>e.tap());let s=W(`button`,`btn btn-small`,`−`);s.type=`button`,s.setAttribute(`aria-label`,`Tempo down`),s.addEventListener(`click`,()=>e.nudge(-1));let c=W(`button`,`btn btn-small`,`+`);c.type=`button`,c.setAttribute(`aria-label`,`Tempo up`),c.addEventListener(`click`,()=>e.nudge(1)),a.append(o,s,c),r.append(i,a);let l=W(`div`,`transport-sync`);l.append(W(`div`,`fader-label`,`Sync`));let u=W(`div`,`transport-seg`),d={internal:`Internal`,midi:`MIDI clock`},f=e.sync.options.map(t=>{let n=W(`button`,`btn btn-small`,d[t]??t);return n.type=`button`,n.addEventListener(`click`,()=>e.sync.set(t)),u.append(n),n}),p=xn(e.followStartStop,`Follow MIDI start and stop`,e=>`Start/stop: ${e?`On`:`Off`}`,$n,`btn btn-small`);l.append(u),t.followStartStop!==!1&&l.append(p);let m=W(`div`,`transport-channel`);m.append(W(`div`,`fader-label`,`MIDI ch`));let h=W(`select`,`patch-select transport-channel-select`);h.setAttribute(`aria-label`,`MIDI channel`);for(let t of e.channel.options)h.add(new Option(t===`omni`?`Omni`:`Ch ${t}`,t));h.value=e.channel.value,h.addEventListener(`change`,()=>e.channel.set(h.value)),m.append(h);let g=W(`div`,`transport-pos`);g.append(W(`div`,`fader-label`,`Position`));let _=W(`div`,`transport-pos-row`),v=W(`span`,`led`),y=W(`div`,`transport-position`,`1 : 1 : 1`),b=[0,1,2,3].map(()=>W(`span`,`beat-dot`)),x=W(`div`,`beat-dots`);x.append(...b),_.append(v,y),g.append(_,x),n.append(r,l,m),t.position&&n.append(g);let S=()=>{let t=e.synced;f.forEach((t,n)=>{let r=e.sync.options[n]===e.sync.value;t.setAttribute(`aria-pressed`,String(r)),t.style.background=r?$n:``,t.style.borderColor=r?$n:``});for(let e of[o,s,c])e.disabled=t;p.disabled=!t,a.title=t?`Tempo follows MIDI clock`:``,n.classList.toggle(`is-synced`,t)};e.sync.onChange(S),S();let C=()=>{let n=t.running();i.textContent=e.bpm.toFixed(1),i.classList.toggle(`locked`,e.locked);let r=t.position?.();r&&(y.textContent=`${r.bar} : ${r.beat} : ${r.sixteenth}`,v.classList.toggle(`on`,n),b.forEach((e,t)=>e.classList.toggle(`on`,n&&r.beat===t+1))),requestAnimationFrame(C)};return requestAnimationFrame(C),n}var tr=`#5fb3b3`,G=`#d8a63c`,nr=`#4a9be0`,rr=`#4fb286`,K=`#e8742c`,ir=`#d9628a`,ar=`#cf7d4e`,or=`#a9adb3`,q=8,sr=[`A`,`B`],cr=(e,t)=>{let n=e.control(t);if(n.kind!==`number`)throw Error(`${t} is not a number control`);return n},J=(e,t)=>{let n=e.control(t);if(n.kind!==`choice`)throw Error(`${t} is not a choice control`);return n},Y=(e,t)=>{let n=e.control(t);if(n.kind!==`toggle`)throw Error(`${t} is not a toggle control`);return n},X=(e,t,n,r)=>r.map(r=>{let[i,a]=typeof r==`string`?[r,void 0]:r;return An(On(cr(e,i),t,a),n)});function Z(e,t){let n=W(`div`,`pipe-led-wrap`);n.append(W(`div`,`dial-label`,t));let r=W(`button`,`pipe-led-btn`);r.type=`button`,r.setAttribute(`aria-label`,t),r.append(W(`span`,`pipe-led`)),r.addEventListener(`click`,()=>e.set(!e.value));let i=()=>r.setAttribute(`aria-pressed`,String(e.value));return e.onChange(i),i(),n.append(r),n}function lr(e,t,n,r={}){let i=W(`div`,`pipe-pills`);i.setAttribute(`role`,`group`),i.setAttribute(`aria-label`,t),i.style.setProperty(`--accent`,n);let a=e.options.map(n=>{let a=W(`button`,`pipe-pill`);return a.type=`button`,a.setAttribute(`aria-label`,`${t}: ${r[n]??n}`),a.append(W(`span`,`poly-led`),W(`span`,void 0,r[n]??n)),a.addEventListener(`click`,()=>e.set(n)),i.append(a),a}),o=()=>a.forEach((t,n)=>t.setAttribute(`aria-pressed`,String(e.options[n]===e.value)));return e.onChange(o),o(),i}function Q(e,t,n,r=``){let i=W(`section`,`pipe-section ${r}`.trim()),a=W(`div`,`pipe-section-head`),o=W(`span`,`pipe-bar`);o.style.background=t,a.append(o,W(`h2`,void 0,e));let s=W(`div`,`pipe-section-body`);return s.append(...n),i.append(a,s),i}function ur(e){let t=cr(e,`lfo.rate`),n=J(e,`lfo.division`),r=Y(e,`lfo.sync`),i=vt.length-1;return{label:`Speed`,color:K,get:()=>r.value?vt.indexOf(n.value)/i:vn(t)/U,set:e=>r.value?n.set(vt[Math.round(e*i)]):t.set(yn(t,Math.round(e*U))),reset:()=>r.value?n.set(`1/8`):t.set(t.initial),text:()=>r.value?n.value:`${t.value.toFixed(1)} Hz`,subscribe:e=>{let i=[t.onChange(e),n.onChange(e),r.onChange(e)];return()=>i.forEach(e=>e())},get step(){return r.value?1/i:.02}}}function dr(e,t){let n=W(`div`,`pipe-encoder`),r=W(`div`,`pipe-encoder-knob`);r.tabIndex=0,r.setAttribute(`role`,`spinbutton`),r.setAttribute(`aria-label`,e);let i=0,a=0,o=0,s=!1,c=e=>{i+=e*24,r.style.transform=`rotate(${i}deg)`,t(e)};r.addEventListener(`pointerdown`,e=>{e.preventDefault(),r.focus(),r.setPointerCapture(e.pointerId),s=!0,o=e.clientY,a=0}),r.addEventListener(`pointermove`,e=>{if(s)for(a+=o-e.clientY,o=e.clientY;Math.abs(a)>=14;){let e=a>0?1:-1;a-=e*14,c(e)}});let l=()=>{s=!1};return r.addEventListener(`pointerup`,l),r.addEventListener(`pointercancel`,l),r.addEventListener(`wheel`,e=>{e.preventDefault(),c(e.deltaY<0?1:-1)},{passive:!1}),r.addEventListener(`keydown`,e=>{(e.key===`ArrowUp`||e.key===`ArrowRight`)&&(e.preventDefault(),c(1)),(e.key===`ArrowDown`||e.key===`ArrowLeft`)&&(e.preventDefault(),c(-1))}),n.append(r,W(`div`,`dial-label`,e)),n}function fr(e,t,n,r){let i=W(`section`,`pipe-brand`),a=W(`div`,`pipe-name`);a.innerHTML=`MOA<span>-</span>PIPE`;let o=W(`div`,`pipe-subtitle`,`Physical modelling`),s=W(`div`,`pipe-title`);s.append(a,o);let c=W(`div`,`pipe-oled`);c.setAttribute(`role`,`status`),c.setAttribute(`aria-label`,`Display`);let l=W(`div`,`pipe-oled-row`),u=W(`span`),d=W(`span`);l.append(u,d);let f=W(`div`,`pipe-oled-name`),p=W(`div`,`pipe-oled-row pipe-oled-dim`),m=W(`span`),h=W(`span`,`pipe-voice-leds`);h.setAttribute(`aria-hidden`,`true`);let g=Array.from({length:8},()=>h.appendChild(W(`i`)));p.append(m,h),c.append(l,f,p);let _=!1,v=Math.floor(e.currentSlot/q),y=J(e,`voice.mode`),b=()=>{let t=e.currentSlot;u.textContent=`PRESET ${String(t+1).padStart(2,`0`)}${_?`  SAVED`:``}`,d.textContent=`${y.value.toUpperCase()}  8 VOICES`,f.textContent=e.currentPreset.name,m.textContent=r.label?`${r.label.toUpperCase()}  ${r.value}`:`BANK ${sr[Math.floor(t/q)]}`},x=t=>{let n=(e.currentSlot+t+e.slots.length)%e.slots.length;e.loadSlot(n)},S=cr(e,`patch.volume`),C=W(`div`,`pipe-encoders`);C.append(dr(`Preset`,x),dr(`Volume`,e=>S.set(S.value+e*(S.max-S.min)*.03)));let ee=W(`div`,`pipe-brand-row`);ee.append(c,C);let te=W(`div`,`pipe-keys`),ne=W(`div`,`pipe-bank-keys`),re=(e,t)=>{let n=W(`button`,`pipe-key`,t);return n.type=`button`,n.setAttribute(`aria-label`,e),n.addEventListener(`click`,()=>{v=(v+1)%sr.length,ae()}),n};ne.append(re(`Previous bank`,`<`),re(`Next bank`,`>`));let ie=Array.from({length:q},(t,n)=>{let r=W(`button`,`pipe-key pipe-key-number`,String(n+1));return r.type=`button`,r.addEventListener(`click`,()=>e.loadSlot(v*q+n)),r}),w=W(`button`,`pipe-key pipe-key-save`,`Save`);w.type=`button`,w.setAttribute(`aria-label`,`Save patch`),w.addEventListener(`click`,()=>{Qn(e.currentSlot,e.saveSlot(e.currentSlot)),_=!0,b(),window.setTimeout(()=>{_=!1,b()},1500)});let ae=()=>{ie.forEach((t,n)=>{let r=v*q+n,i=e.slots[r];t.setAttribute(`aria-pressed`,String(r===e.currentSlot)),t.setAttribute(`aria-label`,`Preset ${r+1}, ${i.name}`),t.title=i.name})};return te.append(ne,...ie,w),e.onPresetChange(()=>{v=Math.floor(e.currentSlot/q),ae(),b()}),y.onChange(b),b(),ae(),n.push(()=>{let e=t?.readPipe(`pipe`,`pipe`);g.forEach((t,n)=>t.classList.toggle(`on`,e?.active[n]===!0)),b()}),i.append(s,ee,te),i}function pr(e,t,n){Zn(e),e.loadSlot(e.currentSlot);let r=[],i={label:``,value:``},a=W(`div`,`pipe-case`);a.append(W(`div`,`pipe-cheek pipe-cheek-left`));let o=W(`div`,`pipe-panel`),s=W(`div`,`pipe-columns`),c=W(`div`,`pipe-col pipe-col-left`);c.append(Q(`Envelope`,tr,[...X(e,tr,`Envelope`,[`env.attack`,`env.decay`,`env.sustain`,`env.release`,`env.keytrack`,`env.velocity`]),Z(Y(e,`env.legato`),`Legato`)]),Q(`Generator`,tr,[...X(e,tr,`Generator`,[[`gen.noise`,`DC / Noise`],`gen.cutoff`,[`gen.reso`,`Reso`],[`gen.keytrack`,`Keytrack`],[`gen.envAmt`,`Env amt`],`gen.gain`]),Z(Y(e,`gen.onePole`),`1-pole`)]));let l=W(`div`,`pipe-row`);l.append(Q(`Feedback`,G,X(e,G,`Feedback`,[`fb.push`,`fb.decay`,`fb.release`]),`pipe-grow-3`),Q(`Saturation`,G,X(e,G,`Saturation`,[[`sat.hardness`,`Soft/Hard`],[`sat.symmetry`,`Symmetry`]]),`pipe-grow-2`),Q(`Patch`,or,X(e,or,`Patch`,[[`patch.volume`,`Volume`]]),`pipe-grow-1`)),c.append(l,Q(`Delay box`,G,[...X(e,G,`Delay box`,[`delay.tune`,`delay.fine`,`delay.harmonics`,[`delay.splitPoint`,`Split pt`]]),Z(Y(e,`delay.split`),`Split`),Z(Y(e,`delay.polarity`),`Polarity`)]));let u=W(`div`,`pipe-row`);u.append(Q(`Filter`,nr,X(e,nr,`Filter`,[[`filter.highpass`,`Highpass`],[`filter.lowpass`,`Lowpass`],[`filter.hpComp`,`HP comp`],[`filter.lpComp`,`LP comp`]]),`pipe-grow-1`),Q(`Voice`,rr,[...X(e,rr,`Voice`,[`voice.detune`,`voice.glide`]),Z(Y(e,`voice.glideOn`),`Glide`),lr(J(e,`voice.mode`),`Voice mode`,rr,{poly:`Poly`,mono:`Mono`,unison:`Unison`})],`pipe-grow-1`)),c.append(u);let d=W(`div`,`pipe-col pipe-col-right`);d.append(fr(e,n,r,i),Q(`Reverb`,ir,[...X(e,ir,`Reverb`,[[`rev.spread`,`Spread`],`rev.mix`,`rev.bass`,`rev.treble`]),lr(J(e,`rev.size`),`Reverb size`,ir,{small:`Small`,medium:`Medium`,large:`Large`})]),Q(`Spring`,ar,[...X(t,ar,`Spring`,[[`spring.length`,`Length`],`spring.tension`,`spring.drip`,`spring.tilt`,`spring.dwell`,[`spring.mix`,`Dry / wet`]])],`pipe-spring`),Q(`LFO`,K,[An(ur(e),`LFO`),...X(e,K,`LFO`,[[`lfo.delay`,`Delay`],[`lfo.amount`,`Amount`]]),Z(Y(e,`lfo.sync`),`Sync`),lr(J(e,`lfo.wave`),`LFO wave`,K,{sine:`Sine`,tri:`Tri`,sqr:`Square`,ramp:`Ramp`,rnd:`Rand`}),lr(J(e,`lfo.dest`),`LFO destination`,K,{pitch:`Pitch`,filter:`Filter`,steam:`Steam`,sat:`Sat`,push:`Push`})])),s.append(c,d);let f=W(`div`,`pipe-header`);f.append(er(e.transport,{running:()=>!1,followStartStop:!1})),o.append(f,s,Gn(e)),a.append(o,W(`div`,`pipe-cheek pipe-cheek-right`));let p=0,m=()=>{p=performance.now()},h=e=>e.target?.closest(`.dial-face, .pipe-led-btn, .pipe-pill, .pipe-encoder-knob`)!=null;o.addEventListener(`pointerdown`,e=>h(e)&&m(),!0),o.addEventListener(`keydown`,e=>h(e)&&m(),!0),o.addEventListener(`pointermove`,e=>{e.buttons&&h(e)&&m()},!0),o.addEventListener(`wheel`,e=>h(e)&&m(),!0);for(let n of[...e.controls,...t.controls])n.kind===`number`&&n.onChange(()=>{performance.now()-p>1500||(i.label=n.label,i.value=bn(n))});let g=()=>{for(let e of r)e();requestAnimationFrame(g)};return requestAnimationFrame(g),a}var mr=new T,hr=new xe,gr=new _n,_r=hn.pipe(mr),vr=new o(_r),yr=document.querySelector(`#app`),$=document.createElement(`button`);$.className=`start`,$.textContent=`Start audio`,$.addEventListener(`click`,async()=>{await vr.start(),$.textContent=`Audio running`,$.disabled=!0});var br=_r.device(`pipe`),xr=_r.device(`spring`);function Sr(e,t=performance.now()){let n=he(e);n&&(mr.handle(n,t),hr.record(n,t),br.handleMidi(n))}gr.onMessage=(e,t)=>Sr(e,t),gr.connectIfPermitted();var Cr=document.createElement(`nav`);Cr.className=`pipe-nav`,Cr.innerHTML=`<a href="/mixer/">The mixer</a><a href="/">moaswift.no</a>`,yr.append(Cr,Cn(gr,mr,hr,$),pr(br,xr,vr));