(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=`moa-df`,t=`
const DF_TWO_PI = Math.PI * 2;

// name, default, min, max
const DF_PARAM_DEFS = [
  ['f1Type', 0, 0, 7], ['f1Cut', 800, 10, 22000], ['f1Res', 0.3, 0, 1], ['f1Depth', 0, -1, 1], ['f1Src', 0, 0, 1],
  ['f1Inv', 0, 0, 1], ['f1Noise', 0, 0, 1], ['f1Vca', 0, 0, 1], ['f1Thr', 0.3, 0, 1], ['f1Gate', 0, 0, 1],
  ['f2Type', 0, 0, 7], ['f2Cut', 800, 10, 22000], ['f2Res', 0.3, 0, 1], ['f2Depth', 0, -1, 1], ['f2Src', 0, 0, 1],
  ['f2Inv', 0, 0, 1], ['f2Noise', 0, 0, 1], ['f2Vca', 0, 0, 1], ['f2Thr', 0.3, 0, 1], ['f2Gate', 0, 0, 1],
  ['e1Atk', 0.01, 0.0005, 10], ['e1Dec', 0.3, 0.001, 10], ['e1Sus', 0.6, 0, 1], ['e1Rel', 0.4, 0.001, 20],
  ['e1Loop', 0, 0, 1], ['e1Exp', 0, 0, 1], ['e1Trig', 0, 0, 1],
  ['e2Atk', 0.01, 0.0005, 10], ['e2Dec', 0.3, 0.001, 10], ['e2Sus', 0.6, 0, 1], ['e2Rel', 0.4, 0.001, 20],
  ['e2Loop', 0, 0, 1], ['e2Exp', 0, 0, 1], ['e2Trig', 0, 0, 1],
  ['envLink', 0, 0, 1], ['cutLink', 0, 0, 1],
  ['shRate', 4, 0.05, 40], ['shSlew', 0.2, 0, 1], ['shSrc', 0, 0, 1],
  ['dlTime', 0.25, 0.02, 0.6], ['dlRep', 0.35, 0, 1], ['dlLevel', 0, 0, 1], ['dlMod', 0, -1, 1], ['dlSrc', 0, 0, 1],
  ['mixA', 0.8, 0, 1.5], ['mixB', 0.8, 0, 1.5], ['mono', 0, 0, 1], ['vol', 0.8, 0, 1.5],
];
const DF_DEFAULTS = {};
for (const d of DF_PARAM_DEFS) DF_DEFAULTS[d[0]] = d[1];

// Pade tanh: exact enough, and cheap. Saturates cleanly beyond |x| = 3.
function dfTanh(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

class DFEnv {
  constructor(sr) {
    this.sr = sr;
    this.v = 0;
    this.stage = 0; // 0 idle, 1 attack, 2 decay, 3 sustain, 4 release
    this.gate = false;
  }

  tick(gate, a, d, s, r, loop, exp) {
    const sr = this.sr;
    if (loop) {
      if (this.stage === 0 || this.stage === 2 || this.stage === 3) this.stage = 1;
    } else {
      if (gate && !this.gate) this.stage = 1;
      else if (!gate && this.gate && this.stage !== 0) this.stage = 4;
      else if (this.stage === 1 && !gate && !this.gate && this.v === 0) this.stage = 0;
    }
    this.gate = gate;
    switch (this.stage) {
      case 1:
        if (exp) this.v += (1.15 - this.v) * (1 - Math.exp(-2.04 / (a * sr)));
        else this.v += 1 / (a * sr);
        if (this.v >= 1) { this.v = 1; this.stage = loop ? 4 : 2; }
        break;
      case 2:
        if (exp) this.v += (s - this.v) * (1 - Math.exp(-3 / (d * sr)));
        else this.v -= (1 - s) / (d * sr);
        if (this.v <= s + (exp ? 0.002 : 0)) { this.v = s; this.stage = 3; }
        break;
      case 3:
        this.v = s;
        break;
      case 4:
        if (exp) {
          this.v -= this.v * (1 - Math.exp(-3 / (r * sr)));
          if (this.v < (loop ? 0.01 : 0.0002)) { this.v = 0; this.stage = loop ? 1 : 0; }
        } else {
          this.v -= 1 / (r * sr);
          if (this.v <= 0) { this.v = 0; this.stage = loop ? 1 : 0; }
        }
        break;
      default:
        this.v = 0;
    }
    return this.v;
  }
}

class DFFilter {
  constructor(sr) {
    this.sr = sr;
    this.s1 = 0; this.s2 = 0;
    this.l1 = 0; this.l2 = 0; this.l3 = 0; this.l4 = 0;
    this.lvl = 0;
    this.open = false;
    this.logCut = -1;
    this.seed = 12345;
    this.aAtk = 1 - Math.exp(-1 / (0.001 * sr));
    this.aRel = 1 - Math.exp(-1 / (0.08 * sr));
  }

  // GEN R-8: 12 dB/oct state-variable filter, saturating, self-oscillating. mode 0 LP, 1 BP, 2 HP, 3 notch.
  svf(x, fc, res, mode) {
    const sr = this.sr;
    const g = Math.tan(Math.PI * Math.min(fc, 0.45 * sr) / sr);
    const k = 1.8 * (1 - res) - 0.07 * Math.pow(res, 8);
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    const xin = (dfTanh(1.3 * x + 0.12) - 0.11942) / 1.3 + (this.seed / 4294967296 - 0.5) * 2e-5;
    const hp = (xin - (k + g) * this.s1 - this.s2) / (1 + g * (k + g));
    const bp = g * hp + this.s1;
    const lp = g * bp + this.s2;
    this.s1 = dfTanh((g * hp + bp) * 0.8) / 0.8;
    this.s2 = dfTanh((g * bp + lp) * 0.8) / 0.8;
    if (mode === 0) return lp;
    if (mode === 1) return bp * Math.max(k, 0.15);
    if (mode === 2) return hp;
    return xin - k * bp;
  }

  // 2045: four-pole 24 dB/oct low-pass with resonance feedback; self-oscillates above about res 0.91.
  ladder(x, fc, res) {
    const sr = this.sr;
    const g = Math.tan(Math.PI * Math.min(fc, 0.45 * sr) / sr);
    const G = g / (1 + g);
    const k = 4.4 * res;
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    x += (this.seed / 4294967296 - 0.5) * 2e-5;
    const G2 = G * G, G3 = G2 * G, G4 = G2 * G2;
    const S = (1 - G) * (G3 * this.l1 + G2 * this.l2 + G * this.l3 + this.l4);
    const u = dfTanh((x - k * S) / (1 + k * G4));
    let v = (u - this.l1) * G; let y = v + this.l1; this.l1 = y + v;
    v = (y - this.l2) * G; y = v + this.l2; this.l2 = y + v;
    v = (y - this.l3) * G; y = v + this.l3; this.l3 = y + v;
    v = (y - this.l4) * G; y = v + this.l4; this.l4 = y + v;
    return y * (1 + 0.5 * k);
  }

  run(x, fc, res, type) {
    switch (type) {
      case 0: return this.svf(x, fc, res, 0);
      case 1: return this.svf(x, fc, res, 1);
      case 2: return this.svf(x, fc, res, 2);
      case 3: return this.svf(x, fc, res, 3);
      case 4: return this.ladder(x, fc, res);
      case 5: return this.ladder(this.svf(x, fc / 1.4, res, 1), fc * 1.4, res * 0.9);
      case 6: return this.ladder(this.svf(x, fc, res, 3), fc * 2.5, res * 0.9);
      default: {
        const lo = this.ladder(x, fc / 2.2, res);
        return 0.7 * lo + 0.7 * this.svf(x, fc * 2.2, res, 2);
      }
    }
  }

  // The audio-level gate: a peak follower and a comparator with hysteresis.
  detect(x, thr, enabled) {
    const a = Math.abs(x);
    this.lvl += (a - this.lvl) * (a > this.lvl ? this.aAtk : this.aRel);
    const t = 0.003 * Math.pow(150, thr);
    if (!enabled) this.open = false;
    else if (this.lvl > t) this.open = true;
    else if (this.lvl < t * 0.6) this.open = false;
    return this.open;
  }
}

class DFCore {
  constructor(sampleRate, random) {
    this.sr = sampleRate;
    this.random = random || Math.random;
    this.f1 = new DFFilter(sampleRate);
    this.f2 = new DFFilter(sampleRate);
    this.e1 = new DFEnv(sampleRate);
    this.e2 = new DFEnv(sampleRate);
    this.keys = false;
    this.manual = [false, false];
    this.shPhase = 0; this.shTarget = 0; this.sh = 0;
    this.dLen = Math.ceil(sampleRate * 1.3) + 8;
    this.line = new Float32Array(this.dLen);
    this.dPos = 0;
    this.dSm = -1;
    this.dLp1 = 0; this.dLp2 = 0; this.dHp = 0;
    this.view = { env: [0, 0], gate: [false, false], sh: 0 };
  }

  setKeys(on) { this.keys = !!on; }
  setOpen(which, on) { this.manual[which] = !!on; }

  process(inL, inR, outL, outR, n, p) {
    const sr = this.sr;
    const rnd = this.random;
    const cutSm = 1 - Math.exp(-1 / (0.006 * sr));
    const maxFc = 0.45 * sr;
    const type1 = Math.round(p.f1Type), type2 = Math.round(p.f2Type);
    const cut1 = Math.log2(Math.max(10, p.f1Cut));
    const cut2 = Math.log2(Math.max(10, p.cutLink > 0.5 ? p.f1Cut : p.f2Cut));
    const f1 = this.f1, f2 = this.f2;
    if (f1.logCut < 0) { f1.logCut = cut1; f2.logCut = cut2; }
    const shInc = p.shRate / sr;
    const slewTau = p.shSlew * p.shSlew * 0.6;
    const slewA = slewTau < 0.0005 ? 1 : 1 - Math.exp(-1 / (slewTau * sr));
    const e1Loop = p.e1Loop > 0.5, e2Loop = p.e2Loop > 0.5;
    const e1Exp = p.e1Exp > 0.5, e2Exp = p.e2Exp > 0.5;
    const link = p.envLink > 0.5;
    const noiseA = p.f1Noise * 0.5, noiseB = p.f2Noise * 0.5;
    const mono = p.mono > 0.5;
    const dlTime = p.dlTime;
    const fb = Math.min(1, p.dlRep) * 1.06;
    const aHp = 1 - Math.exp(-DF_TWO_PI * 90 / sr);
    for (let i = 0; i < n; i++) {
      const xa = inL ? inL[i] : 0;
      const xb = inR ? inR[i] : 0;

      // gates and envelopes
      const g1 = this.manual[0] || (p.e1Trig > 0.5 ? f1.detect(xa, p.f1Thr, p.f1Gate > 0.5) : (f1.detect(xa, p.f1Thr, false), this.keys));
      const g2 = this.manual[1] || (p.e2Trig > 0.5 ? f2.detect(xb, p.f2Thr, p.f2Gate > 0.5) : (f2.detect(xb, p.f2Thr, false), this.keys));
      const v1 = this.e1.tick(g1, p.e1Atk, p.e1Dec, p.e1Sus, p.e1Rel, e1Loop, e1Exp);
      const v2 = this.e2.tick(g2, p.e2Atk, p.e2Dec, p.e2Sus, p.e2Rel, e2Loop, e2Exp);

      // sample and hold
      this.shPhase += shInc;
      if (this.shPhase >= 1) {
        this.shPhase -= 1;
        this.shTarget = p.shSrc > 0.5 ? v1 * 2 - 1 : rnd() * 2 - 1;
      }
      this.sh += (this.shTarget - this.sh) * slewA;

      // filter I
      f1.logCut += (cut1 - f1.logCut) * cutSm;
      const m1 = p.f1Src > 0.5 ? this.sh * 5 : (p.f1Inv > 0.5 ? 1 - v1 : v1) * 6;
      const fc1 = Math.min(maxFc, Math.pow(2, f1.logCut + p.f1Depth * m1));
      const y1 = f1.run(xa + (rnd() * 2 - 1) * noiseA, fc1, p.f1Res, type1);
      const ve1 = p.f1Inv > 0.5 ? 1 - v1 : v1;
      const o1 = dfTanh(y1) * (p.f1Vca > 0.5 ? ve1 : 1);

      // filter II (envelope I when linked)
      f2.logCut += (cut2 - f2.logCut) * cutSm;
      const ve2src = link ? v1 : v2;
      const ve2 = p.f2Inv > 0.5 ? 1 - ve2src : ve2src;
      const m2 = p.f2Src > 0.5 ? this.sh * 5 : ve2 * 6;
      const fc2 = Math.min(maxFc, Math.pow(2, f2.logCut + p.f2Depth * m2));
      const y2 = f2.run(xb + (rnd() * 2 - 1) * noiseB, fc2, p.f2Res, type2);
      const o2 = dfTanh(y2) * (p.f2Vca > 0.5 ? ve2 : 1);

      const a = o1 * p.mixA, b = o2 * p.mixB;

      // delay (mono, from the mixed filters)
      const dMod = p.dlMod * 1.5 * (p.dlSrc > 0.5 ? v2 * 2 - 1 : this.sh);
      const tSec = Math.min(0.6, Math.max(0.01, dlTime * Math.pow(2, dMod)));
      if (this.dSm < 0) this.dSm = tSec * sr;
      this.dSm += (tSec * sr - this.dSm) * 0.0006;
      let rp = this.dPos - this.dSm;
      if (rp < 0) rp += this.dLen;
      const ri = Math.floor(rp);
      const fr = rp - ri;
      const r0 = this.line[ri % this.dLen], r1 = this.line[(ri + 1) % this.dLen];
      const raw = r0 + (r1 - r0) * fr;
      // the loop loses bandwidth as the delay lengthens, like a clocked bucket-brigade chip
      const bw = 14000 / (1 + this.dSm / sr * 9);
      const aLp = 1 - Math.exp(-DF_TWO_PI * bw / sr);
      this.dLp1 += (raw - this.dLp1) * aLp;
      this.dLp2 += (this.dLp1 - this.dLp2) * aLp;
      this.dHp += (this.dLp2 - this.dHp) * aHp;
      const wet = this.dLp2 - this.dHp;
      const din = (a + b) * 0.5;
      const w = dfTanh((din + fb * wet) * 1.1) / 1.1;
      this.line[this.dPos] = Math.round(w * 256) / 256;
      this.dPos = (this.dPos + 1) % this.dLen;
      const d = wet * p.dlLevel;

      let l, r;
      if (mono) { l = r = (a + b) * 0.7071; } else { l = a; r = b; }
      l = (l + d) * p.vol;
      r = (r + d) * p.vol;
      outL[i] = dfTanh(l * 0.9) / 0.9;
      outR[i] = dfTanh(r * 0.9) / 0.9;
    }
    this.view.env[0] = this.e1.v; this.view.env[1] = this.e2.v;
    this.view.gate[0] = this.e1.gate; this.view.gate[1] = this.e2.gate;
    this.view.sh = this.sh;
  }
}

if (typeof registerProcessor === 'function') {
  class MoaDF extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return DF_PARAM_DEFS.map((d) => ({ name: d[0], defaultValue: d[1], minValue: d[2], maxValue: d[3], automationRate: 'k-rate' }));
    }
    constructor() {
      super();
      this.core = new DFCore(sampleRate);
      this.p = Object.assign({}, DF_DEFAULTS);
      this.sinceView = 0;
      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m || m.type !== 'gate') return;
        if (m.target === 'keys') this.core.setKeys(m.on);
        else if (m.target === 'open1') this.core.setOpen(0, m.on);
        else if (m.target === 'open2') this.core.setOpen(1, m.on);
      };
    }
    process(inputs, outputs, params) {
      const out = outputs[0];
      const input = inputs[0];
      for (const name in params) this.p[name] = params[name][0];
      const n = out[0].length;
      this.core.process(input && input[0], input && (input[1] || input[0]), out[0], out[1] || out[0], n, this.p);
      this.sinceView += n;
      if (this.sinceView >= sampleRate / 30) {
        this.sinceView = 0;
        this.port.postMessage({ env: this.core.view.env.slice(), gate: this.core.view.gate.slice(), sh: this.core.view.sh });
      }
      return true;
    }
  }
  registerProcessor('${e}', MoaDF);
}
`,n=`moa-duo`,r=`
const DUO_TWO_PI = Math.PI * 2;

// name, default, min, max
const DUO_PARAM_DEFS = [
  ['o1Wave', 0, 0, 1], ['o1Off', -12, -36, 12], ['o1Pw', 0, 0, 1], ['o1Lvl', 0.8, 0, 1], ['o1Gld', 0, 0, 1],
  ['o2Wave', 0, 0, 1], ['o2Off', 0, -36, 12], ['o2Dtn', 0, 0, 24], ['o2Lvl', 0.8, 0, 1], ['o2Gld', 0, 0, 1],
  ['tune', 0, -100, 100], ['sync', 0, 0, 1], ['vibRate', 5, 0.1, 20], ['vibLvl', 0, 0, 1], ['noise', 0, 0, 1],
  ['vcoRoute', 0, 0, 3], ['vcfRoute', 0, 0, 3], ['modRoute', 0, 0, 3],
  ['cutoff', 1500, 20, 20000], ['res', 0.2, 0, 1], ['post', 0, -4, 4],
  ['m1Rise', 0.01, 0.001, 5], ['m1Fall', 0.4, 0.01, 15], ['m1Hold', 0, 0, 1], ['m1Lfo', 0, 0, 1], ['m1Lvl', 0.3, 0, 1],
  ['m2Rise', 0.01, 0.001, 5], ['m2Fall', 0.4, 0.01, 15], ['m2Hold', 0, 0, 1], ['m2Lfo', 0, 0, 1], ['m2Lvl', 0, 0, 1],
  ['vcaRise', 0.005, 0.001, 5], ['vcaFall', 0.4, 0.01, 15], ['vcaHold', 1, 0, 1], ['vcaLfo', 0, 0, 1], ['level', 0.8, 0, 1.5],
  ['rvTime', 0.02, 0, 1], ['rvDecay', 0.4, 0, 1], ['rvMix', 0.2, 0, 1],
  ['bend', 0, -3, 3], ['modw', 0, 0, 1],
];
const DUO_DEFAULTS = {};
for (const d of DUO_PARAM_DEFS) DUO_DEFAULTS[d[0]] = d[1];

function duoTanh(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

// PolyBLEP step correction for a discontinuity at phase 0 (t = phase, dt = increment).
function duoBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// A modulator: rise and fall, optional hold (fall becomes release) and optional LFO (loops).
class DuoMod {
  constructor(sr) { this.sr = sr; this.v = 0; this.stage = 0; this.gate = false; }

  // stage: 0 idle, 1 rising, 2 falling (decay), 3 holding at max, 4 releasing
  tick(gate, trig, rise, fall, hold, lfo) {
    const sr = this.sr;
    if (lfo) {
      if (hold && gate) { this.v = 1; this.stage = 3; this.gate = gate; return 1; }
      if (this.stage === 0 || this.stage === 3) this.stage = 1;
    } else {
      if (trig && gate) this.stage = 1;
      else if (gate && !this.gate) this.stage = 1;
      else if (!gate && this.gate && hold && (this.stage === 1 || this.stage === 3)) this.stage = 4;
    }
    this.gate = gate;
    switch (this.stage) {
      case 1:
        this.v += (1.2 - this.v) * (1 - Math.exp(-1.79 / (rise * sr)));
        if (this.v >= 1) {
          this.v = 1;
          this.stage = lfo ? 2 : (hold ? (gate ? 3 : 4) : 2);
        }
        break;
      case 2: case 4:
        this.v -= this.v * (1 - Math.exp(-4.6 / (fall * sr)));
        if (this.v < (lfo ? 0.02 : 0.002)) { this.v = lfo ? 0.02 : 0; this.stage = lfo ? 1 : 0; }
        break;
      case 3:
        this.v = 1;
        break;
      default:
        this.v = 0;
    }
    return this.v;
  }
}

// 12 dB state-variable filter (zero-delay feedback, tanh-saturated integrators), self-oscillating.
class DuoSvf {
  constructor(sr) { this.sr = sr; this.s1 = 0; this.s2 = 0; this.lp = 0; this.hp = 0; this.seed = 777; }
  run(x, fc, res) {
    const sr = this.sr;
    const g = Math.tan(Math.PI * Math.min(fc, 0.45 * sr) / sr);
    const k = 1.8 * (1 - res) - 0.07 * Math.pow(res, 8);
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    const xin = x + (this.seed / 4294967296 - 0.5) * 2e-5;
    const hp = (xin - (k + g) * this.s1 - this.s2) / (1 + g * (k + g));
    const bp = g * hp + this.s1;
    const lp = g * bp + this.s2;
    this.s1 = duoTanh((g * hp + bp) * 0.8) / 0.8;
    this.s2 = duoTanh((g * bp + lp) * 0.8) / 0.8;
    this.lp = lp;
    this.hp = hp;
  }
}

class DuoReverb {
  constructor(sr) {
    this.sr = sr;
    const scale = sr / 44100;
    const lens = [1117, 1559, 1877, 2203].map((n) => Math.round(n * scale));
    this.lens = lens;
    this.lines = lens.map((n) => new Float32Array(n));
    this.pos = [0, 0, 0, 0];
    this.damp = [0, 0, 0, 0];
    this.dc = [0, 0, 0, 0];
    this.y = [0, 0, 0, 0];
    this.pre = new Float32Array(Math.ceil(0.3 * sr) + 4);
    this.prePos = 0;
    this.ap = [new Float32Array(Math.round(347 * scale)), new Float32Array(Math.round(113 * scale))];
    this.apPos = [0, 0];
  }

  // in: mono; writes the wet stereo pair into out[0], out[1]
  tick(x, time, decay, out) {
    const sr = this.sr;
    // pre-delay (the TIME knob) and a loop that brightens as it grows
    const preLen = Math.max(1, Math.floor(time * 0.25 * sr));
    this.pre[this.prePos] = x;
    let rp = this.prePos - preLen; if (rp < 0) rp += this.pre.length;
    this.prePos = (this.prePos + 1) % this.pre.length;
    let s = this.pre[rp];
    for (let i = 0; i < 2; i++) {
      const buf = this.ap[i];
      const p = this.apPos[i];
      const d = buf[p];
      const v = s + 0.6 * d;
      buf[p] = v;
      s = d - 0.6 * v;
      this.apPos[i] = (p + 1) % buf.length;
    }
    const bright = 0.25 + 0.7 * time;
    const dampA = 1 - Math.exp(-DUO_TWO_PI * (2500 + 9000 * bright) / sr);
    let sum = 0;
    const y = this.y;
    for (let i = 0; i < 4; i++) { y[i] = this.lines[i][this.pos[i]]; sum += y[i]; }
    const mix = sum * 0.5;
    const infinite = decay >= 0.995;
    // decay 0..1: RT60 from 0.25 s up to about 25 s, then infinite at the top
    const rt = 0.25 * Math.pow(100, Math.min(decay, 0.99));
    for (let i = 0; i < 4; i++) {
      const g = infinite ? 1 : Math.exp(-6.9078 * this.lens[i] / (sr * rt));
      let w = y[i] - mix;
      this.damp[i] += (w - this.damp[i]) * dampA;
      w = this.damp[i] * g;
      this.dc[i] += (w - this.dc[i]) * 0.0007;
      w = duoTanh((w - this.dc[i] + s * 0.5) * 0.9) / 0.9;
      this.lines[i][this.pos[i]] = w;
      this.pos[i] = (this.pos[i] + 1) % this.lens[i];
    }
    out[0] = (y[0] + y[2]) * 0.7;
    out[1] = (y[1] + y[3]) * 0.7;
  }
}

class DuoCore {
  constructor(sampleRate, random) {
    this.sr = sampleRate;
    this.random = random || Math.random;
    this.n1 = 60; this.n2 = 60;
    this.p1 = 60; this.p2 = 60;
    this.gate = false; this.trig = false;
    this.ph1 = 0; this.ph2 = 0;
    this.vibPh = 0;
    this.drift = 0; this.drift2 = 0;
    this.f1 = new DuoSvf(sampleRate);
    this.f2 = new DuoSvf(sampleRate);
    this.logCut = -1;
    this.m1 = new DuoMod(sampleRate);
    this.m2 = new DuoMod(sampleRate);
    this.mv = new DuoMod(sampleRate);
    this.rev = new DuoReverb(sampleRate);
    this.wet = [0, 0];
    this.started = false;
    this.view = { m: [0, 0, 0], gate: false };
  }

  play(n1, n2, gate, retrig) {
    this.n1 = n1; this.n2 = n2;
    if (!this.started) { this.p1 = n1; this.p2 = n2; this.started = true; }
    if (gate && retrig) this.trig = true;
    this.gate = !!gate;
  }

  process(outL, outR, n, p) {
    const sr = this.sr;
    const rnd = this.random;
    const gl1 = p.o1Gld < 0.001 ? 1 : 1 - Math.exp(-1 / (p.o1Gld * p.o1Gld * 2 * sr));
    const gl2 = p.o2Gld < 0.001 ? 1 : 1 - Math.exp(-1 / (p.o2Gld * p.o2Gld * 2 * sr));
    const cutSm = 1 - Math.exp(-1 / (0.006 * sr));
    const cutLog = Math.log2(Math.max(20, p.cutoff));
    if (this.logCut < 0) this.logCut = cutLog;
    const vcoR = Math.round(p.vcoRoute), vcfR = Math.round(p.vcfRoute), modR = Math.round(p.modRoute);
    const sync = p.sync > 0.5;
    const pw = 0.5 - p.o1Pw * 0.45;
    const vibDepth = Math.min(1, p.vibLvl + p.modw) * 0.8; // semitones
    const vibInc = p.vibRate / sr;
    const lvl1 = p.o1Lvl * 0.5, lvl2 = p.o2Lvl * 0.5, nz = p.noise * 0.5;
    const m1d = p.m1Lvl * 6, m2d = p.m2Lvl * 6;
    for (let i = 0; i < n; i++) {
      // modulators
      const trig = this.trig; this.trig = false;
      const a = this.m1.tick(this.gate, trig, p.m1Rise, p.m1Fall, p.m1Hold > 0.5, p.m1Lfo > 0.5);
      const b = this.m2.tick(this.gate, trig, p.m2Rise, p.m2Fall, p.m2Hold > 0.5, p.m2Lfo > 0.5);
      const c = this.mv.tick(this.gate, trig, p.vcaRise, p.vcaFall, p.vcaHold > 0.5, p.vcaLfo > 0.5);

      // pitch: glide, vibrato, bend, tune and a slow wander
      this.p1 += (this.n1 - this.p1) * gl1;
      this.p2 += (this.n2 - this.p2) * gl2;
      this.vibPh += vibInc; if (this.vibPh >= 1) this.vibPh -= 1;
      const vib = Math.sin(DUO_TWO_PI * this.vibPh) * vibDepth;
      this.drift += (rnd() * 2 - 1 - this.drift) * 0.00002;
      this.drift2 += (rnd() * 2 - 1 - this.drift2) * 0.00002;
      const semi = p.bend + vib;
      const hz1 = 440 * Math.pow(2, (this.p1 + p.o1Off - 69 + semi + this.drift * 0.08) / 12);
      // TUNE moves oscillator 2 only, so it detunes against oscillator 1
      const hz2 = 440 * Math.pow(2, (this.p2 + p.o2Off + p.o2Dtn - 69 + semi + p.tune * 0.01 + this.drift2 * 0.08) / 12);
      const dt1 = Math.min(0.45, hz1 / sr), dt2 = Math.min(0.45, hz2 / sr);

      // osc 1: saw or pulse
      this.ph1 += dt1;
      let wrapped = false, wrapFrac = 0;
      if (this.ph1 >= 1) { this.ph1 -= 1; wrapped = true; wrapFrac = this.ph1 / dt1; }
      let o1;
      if (p.o1Wave < 0.5) o1 = 2 * this.ph1 - 1 - duoBlep(this.ph1, dt1);
      else {
        o1 = this.ph1 < pw ? 1 : -1;
        o1 += duoBlep(this.ph1, dt1);
        let t2 = this.ph1 - pw; if (t2 < 0) t2 += 1;
        o1 -= duoBlep(t2, dt1);
      }
      // osc 2: saw or triangle, hard-synced to osc 1
      this.ph2 += dt2;
      if (this.ph2 >= 1) this.ph2 -= 1;
      if (sync && wrapped) this.ph2 = Math.min(0.999, wrapFrac * dt2);
      const o2 = p.o2Wave < 0.5
        ? 2 * this.ph2 - 1 - duoBlep(this.ph2, dt2)
        : (this.ph2 < 0.5 ? 4 * this.ph2 - 1 : 3 - 4 * this.ph2);

      const noise = (rnd() * 2 - 1) * nz;
      const s1 = o1 * lvl1, s2 = o2 * lvl2;

      // VCO route
      let in1 = 0, in2 = 0, direct = 0;
      if (vcoR === 0) in1 = s1 + s2 + noise;
      else if (vcoR === 1) { in1 = s1 + noise; in2 = s2; }
      else if (vcoR === 2) in2 = s1 + s2 + noise;
      else direct = s1 + s2 + noise;

      // filter cutoffs: shared CUTOFF, POST on filter 2, modulators per the MOD route
      this.logCut += (cutLog - this.logCut) * cutSm;
      let mod1 = 0, mod2 = 0;
      if (modR === 0) { mod1 = a * m1d; mod2 = a * m1d; }
      else if (modR === 1) { mod1 = a * m1d + b * m2d; mod2 = mod1; }
      else if (modR === 2) { mod1 = a * m1d; mod2 = b * m2d; }
      else { mod1 = a * m1d; mod2 = a * m1d + b * m2d; }
      const fc1 = Math.min(20000, Math.pow(2, this.logCut + mod1));
      const fc2 = Math.min(20000, Math.pow(2, this.logCut + p.post + mod2));
      let out;
      if (vcfR <= 1) {
        // series: filter 2 takes filter 1's output plus whatever the VCO route sends it directly
        this.f1.run(in1, fc1, p.res);
        const mid = vcfR === 0 ? this.f1.lp : this.f1.hp;
        this.f2.run(mid + in2, fc2, p.res);
        out = vcfR === 0 ? this.f2.lp : this.f2.hp;
      } else {
        this.f1.run(in1, fc1, p.res);
        this.f2.run(in2, fc2, p.res);
        out = this.f1.lp + (vcfR === 2 ? this.f2.lp : this.f2.hp);
      }
      out = (duoTanh(out) + direct) * 0.95;

      // VCA and reverb
      const dry = out * c * p.level;
      this.rev.tick(dry, p.rvTime, p.rvDecay, this.wet);
      const wetMix = p.rvMix, dryMix = 1 - p.rvMix * 0.5;
      const l = dry * dryMix + this.wet[0] * wetMix;
      const r = dry * dryMix + this.wet[1] * wetMix;
      outL[i] = duoTanh(l * 0.9) / 0.9;
      outR[i] = duoTanh(r * 0.9) / 0.9;
      this.view.m[0] = a; this.view.m[1] = b; this.view.m[2] = c;
    }
    this.view.gate = this.gate;
  }
}

if (typeof registerProcessor === 'function') {
  class MoaDuo extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return DUO_PARAM_DEFS.map((d) => ({ name: d[0], defaultValue: d[1], minValue: d[2], maxValue: d[3], automationRate: 'k-rate' }));
    }
    constructor() {
      super();
      this.core = new DuoCore(sampleRate);
      this.p = Object.assign({}, DUO_DEFAULTS);
      this.sinceView = 0;
      this.port.onmessage = (e) => {
        const m = e.data;
        if (m && m.type === 'play') this.core.play(m.n1, m.n2, m.gate, m.retrig);
      };
    }
    process(inputs, outputs, params) {
      const out = outputs[0];
      for (const name in params) this.p[name] = params[name][0];
      const n = out[0].length;
      this.core.process(out[0], out[1] || out[0], n, this.p);
      this.sinceView += n;
      if (this.sinceView >= sampleRate / 30) {
        this.sinceView = 0;
        this.port.postMessage({ m: this.core.view.m.slice(), gate: this.core.view.gate });
      }
      return true;
    }
  }
  registerProcessor('${n}', MoaDuo);
}
`,i=`moa-granular`,a=`
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
  registerProcessor('${i}', MoaGranular);
}
`,o=`moa-pipe`,s=`moa-spring`,c=`
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
  registerProcessor('${o}', MoaPipe);

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
  registerProcessor('${s}', MoaSpring);
}
`,l=.01,u=class{patch;ctx;compiled=new Map;monitor;monitorOn=!0;compressors=new Map;grainViews=new Map;pipeViews=new Map;dfViews=new Map;duoViews=new Map;meters=new Map;constructor(e){this.patch=e}async start(){if(!this.ctx){let e=new AudioContext;await e.audioWorklet.addModule(ye()),this.build(e)}await this.ctx?.resume()}async stop(){await this.ctx?.suspend()}get context(){return this.ctx}setMonitor(e){this.monitorOn=e,this.monitor&&this.ctx&&this.monitor.gain.setTargetAtTime(+!!e,this.ctx.currentTime,.02)}jackNode(e,t,n){let r=this.patch.device(e).jack(t,n).nodeId;return this.compiled.get(e)?.get(r)}setCable(e,t,n){let r=this.jackNode(e.device,`out`,e.jack),i=this.jackNode(t.device,`in`,t.jack);r&&i&&(n?r.connect(i):r.disconnect(i))}get currentTime(){return this.ctx?.currentTime??0}readLevel(e,t){let n=this.meters.get(`${e}/${t}`);if(!n)return 0;n.analyser.getFloatTimeDomainData(n.buffer);let r=0;for(let e of n.buffer)r=Math.max(r,Math.abs(e));return r}readGranular(e,t){return this.grainViews.get(`${e}/${t}`)}readPipe(e,t){return this.pipeViews.get(`${e}/${t}`)}readDF(e,t){return this.dfViews.get(`${e}/${t}`)}readDuo(e,t){return this.duoViews.get(`${e}/${t}`)}readReduction(e,t){return this.compressors.get(`${e}/${t}`)?.reduction??0}build(e){this.ctx=e;let t=new Map;for(let[n,r]of this.patch.devices)t.set(n,this.compileCircuit(e,n,r.circuit));this.compiled=t;let n=(e,n,r)=>{let i=this.patch.device(e).jack(n,r).nodeId,a=t.get(e)?.get(i);if(!a)throw Error(`No audio node for ${e}.${r}`);return a};for(let e of this.patch.connections)n(e.from.device,`out`,e.from.jack).connect(n(e.to.device,`in`,e.to.jack));if(this.patch.output){this.monitor=e.createGain(),this.monitor.gain.value=+!!this.monitorOn,this.monitor.connect(e.destination);for(let{device:e,jack:t}of[this.patch.output,...this.patch.extraOutputs])n(e,`out`,t).connect(this.monitor)}}compileCircuit(t,r,a){let c=new Map;for(let l of a.nodes.values())switch(l.kind){case`oscillator`:{let e=t.createOscillator();e.type=l.options.waveform,e.frequency.value=l.params.frequency??440,e.detune.value=l.params.detune??0,e.start(),c.set(l.id,e);break}case`filter`:{let e=t.createBiquadFilter();e.type=l.options.type,e.frequency.value=l.params.frequency??350,e.Q.value=l.params.Q??1,e.gain.value=l.params.gain??0,e.detune.value=l.params.detune??0,c.set(l.id,e);break}case`envelope`:{let e=t.createConstantSource();e.offset.value=0,e.start(),c.set(l.id,e);break}case`convolver`:{let e=t.createConvolver();e.buffer=ue(t,le[l.options.size??`medium`]??le.medium),c.set(l.id,e);break}case`follower`:{let e=new AudioWorkletNode(t,_e,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],parameterData:{attack:l.params.attack??.003,release:l.params.release??.12}});c.set(l.id,e);break}case`granular`:{let{maxTime:e,...n}=l.params,a=new AudioWorkletNode(t,i,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],parameterData:n,processorOptions:{seconds:e??20}});a.port.onmessage=e=>this.grainViews.set(`${r}/${l.id}`,e.data),c.set(l.id,a);break}case`pipe`:{let e=new AudioWorkletNode(t,o,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],parameterData:l.params});e.port.onmessage=e=>this.pipeViews.set(`${r}/${l.id}`,e.data),c.set(l.id,e);break}case`spring`:c.set(l.id,new AudioWorkletNode(t,s,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],parameterData:l.params}));break;case`df`:{let n=new AudioWorkletNode(t,e,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:`explicit`,parameterData:l.params});n.port.onmessage=e=>this.dfViews.set(`${r}/${l.id}`,e.data),c.set(l.id,n);break}case`duo`:{let e=new AudioWorkletNode(t,n,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],parameterData:l.params});e.port.onmessage=e=>this.duoViews.set(`${r}/${l.id}`,e.data),c.set(l.id,e);break}case`compressor`:{let e=t.createDynamicsCompressor();this.compressors.set(`${r}/${l.id}`,e),e.threshold.value=l.params.threshold??-24,e.knee.value=l.params.knee??30,e.ratio.value=l.params.ratio??12,e.attack.value=l.params.attack??.003,e.release.value=l.params.release??.25,c.set(l.id,e);break}case`delay`:{let e=t.createDelay(l.params.maxTime??1);e.delayTime.value=l.params.delayTime??.25,c.set(l.id,e);break}case`trigger`:{let e=t.createConstantSource();e.offset.value=0,e.start(),c.set(l.id,e);break}case`constant`:{let e=t.createConstantSource();e.offset.value=l.params.offset??0,e.start(),c.set(l.id,e);break}case`waveshaper`:{let e=t.createWaveShaper();l.options.curve===`pulse`?e.curve=re():l.options.curve===`soft`?e.curve=ie():l.options.curve===`limit`?e.curve=ae():l.options.curve===`warm`?e.curve=oe():l.options.curve===`abs`?e.curve=se():l.options.curve===`crush`&&(e.curve=ce(l.params.bits??16)),e.oversample=`4x`,c.set(l.id,e);break}case`noise`:{let e=t.createBufferSource();e.buffer=de(t),e.loop=!0,e.start(),c.set(l.id,e);break}case`random`:{let e=t.createBufferSource();e.buffer=he(t),e.loop=!0,e.playbackRate.value=(l.params.rate??4)/pe,e.start(),c.set(l.id,e);break}case`meter`:{let e=t.createAnalyser();e.fftSize=1024;let n=l.options.channel??`mono`;if(n===`mono`)c.set(l.id,e);else{let r=t.createChannelSplitter(2);r.connect(e,n===`left`?0:1),c.set(l.id,r)}this.meters.set(`${r}/${l.id}`,{analyser:e,buffer:new Float32Array(new ArrayBuffer(e.fftSize*4))});break}case`pan`:{let e=t.createStereoPanner();e.pan.value=l.params.pan??0,c.set(l.id,e);break}case`gain`:{let e=t.createGain();e.gain.value=l.params.gain??1,l.options.channels===`mono`&&(e.channelCount=1,e.channelCountMode=`explicit`),c.set(l.id,e);break}}for(let e of a.cables){let t=c.get(e.from),n=c.get(e.to);if(t&&n){if(e.port===`in`)t.connect(n);else{let r=d(n,e.port);r&&t.connect(r)}}}return a.onChange(e=>{let n=c.get(e.nodeId);if(!n)return;if(e.type===`note`||e.type===`gate`||e.type===`play`){n instanceof AudioWorkletNode&&n.port.postMessage(e);return}if(e.type===`trigger`||e.type===`choke`){n instanceof ConstantSourceNode&&(e.type===`trigger`?te(t,n.offset,a.node(e.nodeId).params,a.node(e.nodeId).options.shape,e.velocity,e.when):ne(t,n.offset,e.when));return}if(a.node(e.nodeId).kind===`trigger`)return;if(n instanceof WaveShaperNode&&e.type===`param`&&e.name===`bits`){n.curve=ce(e.value);return}if(a.node(e.nodeId).kind===`envelope`){n instanceof ConstantSourceNode&&e.type===`param`&&e.name===`gate`&&h(t,n.offset,a.node(e.nodeId).params,e.value>0);return}if(n instanceof AudioBufferSourceNode&&e.type===`param`&&e.name===`rate`){n.playbackRate.setTargetAtTime(e.value/pe,t.currentTime,l);return}if(e.type===`option`){n instanceof OscillatorNode&&e.name===`waveform`||n instanceof BiquadFilterNode&&e.name===`type`?n.type=e.value:n instanceof ConvolverNode&&e.name===`size`&&(n.buffer=ue(t,le[e.value]??le.medium));return}let r=d(n,e.name);a.node(e.nodeId).kind===`duo`&&p.test(e.name)||a.node(e.nodeId).kind===`df`&&m.test(e.name)?r?.setValueAtTime(e.value,t.currentTime):r?.setTargetAtTime(e.value,t.currentTime,ge(a,e.nodeId,e.name))}),c}};function d(e,t){if(e instanceof AudioWorkletNode)return e.parameters.get(t);let n=e[t];return n instanceof AudioParam?n:void 0}var f=.001,p=/Wave$|Sync$|Route$|Hold$|Lfo$|Off$/,m=/Type$|Src$|Inv$|Vca$|Gate$|Loop$|Exp$|Trig$|Link$|^mono$/;function h(e,t,n,r){let i=e.currentTime;if(t.cancelScheduledValues(i),t.setValueAtTime(t.value,i),r){let e=Math.max(n.attack??.01,f);t.linearRampToValueAtTime(1,i+e),t.setTargetAtTime(n.sustain??.7,i+e,Math.max(n.decay??.2,f)/3)}else t.setTargetAtTime(0,i,Math.max(n.release??.3,f)/3)}var g=.001,_=3,v=.0035,ee=.005;function te(e,t,n,r,i,a){let o=n.velSens??1,s=(n.peak??1)*(1-o+o*i),c=Math.max(n.decay??.2,f)/4,l=Math.max(a??0,e.currentTime);if(t.cancelScheduledValues(l),t.setValueAtTime(t.value,l),t.linearRampToValueAtTime(s,l+g),r!==`clap`){t.setTargetAtTime(0,l+g,c);return}let u=Math.max(n.spread??.012,.002);t.setTargetAtTime(0,l+g,v);for(let e=1;e<=_;e++){let n=l+e*u;t.setValueAtTime(s,n),t.setTargetAtTime(0,n,e===_?c:v)}}function ne(e,t,n){let r=Math.max(n??0,e.currentTime);t.cancelScheduledValues(r),t.setValueAtTime(t.value,r),t.setTargetAtTime(0,r,ee)}function re(){let e=1024,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++)t[n]=n<e/2?-1:1;return t}var y=2.5;function ie(){let e=2048,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++){let e=n/2047*2-1;t[n]=Math.tanh(y*e)/Math.tanh(y)}return t}function ae(){let e=4097,t=new Float32Array(new ArrayBuffer(e*4)),n=.9;for(let r=0;r<e;r++){let e=r/4096*2-1,i=Math.abs(e);t[r]=Math.sign(e)*(i<n?i:n+.09999999999999998*Math.tanh((i-n)/.09999999999999998))}return t}function oe(){let e=4097,t=new Float32Array(new ArrayBuffer(e*4)),n=.6;for(let r=0;r<e;r++){let e=r/4096*2-1,i=Math.abs(e)*3;t[r]=Math.sign(e)*(i<n?i:n+.4*Math.tanh((i-n)/.4))}return t}function se(){let e=1025,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++)t[n]=Math.abs(n/1024*2-1);return t}function ce(e){let t=8193,n=new Float32Array(new ArrayBuffer(t*4)),r=2**Math.max(1,Math.min(16,e))/2;for(let e=0;e<t;e++){let t=e/8192*2-1;n[e]=Math.round(t*r)/r}return n}var le={small:.9,medium:2.4,large:5};function ue(e,t){let n=e.sampleRate,r=Math.floor(n*t),i=e.createBuffer(2,r,n),a=Math.log(1e3)/t;for(let e=0;e<2;e++){let t=i.getChannelData(e),o=0;for(let e=0;e<r;e++){let r=e/n,i=Math.exp(-a*r)*Math.min(1,r/.004),s=.75*Math.exp(-r*1.2)+.06;o+=s*(Math.random()*2-1-o),t[e]=o*i}}return i}function de(e){let t=e.createBuffer(1,e.sampleRate*2,e.sampleRate),n=t.getChannelData(0);for(let e=0;e<n.length;e++)n[e]=Math.random()*2-1;return t}var fe=64,pe=10,me=8e3;function he(e){let t=me/pe,n=e.createBuffer(1,fe*t,me),r=n.getChannelData(0);for(let e=0;e<fe;e++)r.fill(Math.random()*2-1,e*t,(e+1)*t);return n}function ge(e,t,n){let r=e.node(t);return r.kind===`constant`&&n===`offset`&&r.params.glide?Math.max(r.params.glide/3,l):l}var _e=`moa-follower`,ve=[`
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
registerProcessor('${_e}', MoaFollower);
`,a,c,t,r].join(`
`);function ye(){return URL.createObjectURL(new Blob([ve],{type:`text/javascript`}))}var be=24,xe=48,Se=12,Ce=1e3,we=500,b=class{intervals=[];last;isRunning=!1;pulses=0;get running(){return this.isRunning}get ticks(){return this.pulses}get bpm(){if(this.intervals.length<Se)return;let e=[...this.intervals].sort((e,t)=>e-t),t=Math.floor(e.length/4),n=e.slice(t,e.length-t);return 6e4/(n.reduce((e,t)=>e+t,0)/n.length*be)}isLocked(e){return this.last!==void 0&&this.intervals.length>=Se&&e-this.last<we}get position(){return Te(this.pulses)}handle(e,t){switch(e.type){case`clock`:if(this.last!==void 0){let e=t-this.last;e>Ce?this.intervals=[]:this.intervals.push(e),this.intervals.length>xe&&this.intervals.shift()}this.last=t,this.isRunning&&this.pulses++;break;case`start`:this.isRunning=!0,this.pulses=0;break;case`continue`:this.isRunning=!0;break;case`stop`:this.isRunning=!1}}};function Te(e){return{bar:Math.floor(e/96)+1,beat:Math.floor(e/be)%4+1,sixteenth:Math.floor(e/(be/4))%4+1}}var Ee=class{nodes=new Map;cables=[];listeners=new Set;add(e,t,n={},r={}){if(this.nodes.has(e))throw Error(`Duplicate node id: ${e}`);return this.nodes.set(e,{id:e,kind:t,params:{...n},options:{...r}}),this}connect(e,t,n=`in`){this.node(e);let r=this.node(t);if(n!==`in`&&!(n in r.params))throw Error(`Node ${t} has no param ${n}`);if(this.cables.some(r=>r.from===e&&r.to===t&&r.port===n))throw Error(`Duplicate cable ${e} -> ${t}.${n}`);return this.cables.push({from:e,to:t,port:n}),this}setParam(e,t,n){let r=this.node(e);if(!(t in r.params))throw Error(`Node ${e} has no param ${t}`);r.params[t]=n,this.emit({type:`param`,nodeId:e,name:t,value:n})}setOption(e,t,n){let r=this.node(e);if(!(t in r.options))throw Error(`Node ${e} has no option ${t}`);r.options[t]=n,this.emit({type:`option`,nodeId:e,name:t,value:n})}trigger(e,t=1,n){this.expectKind(e,`trigger`),this.emit({type:`trigger`,nodeId:e,velocity:Math.min(1,Math.max(0,t)),when:n})}choke(e,t){this.expectKind(e,`trigger`),this.emit({type:`choke`,nodeId:e,when:t})}noteOn(e,t,n=1){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:t,velocity:Math.min(1,Math.max(0,n))})}noteOff(e,t){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:t,velocity:0})}allNotesOff(e){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:-1,velocity:0})}pedal(e,t){this.expectKind(e,`pipe`),this.emit({type:`note`,nodeId:e,note:-2,velocity:+!!t})}play(e,t,n,r,i){this.expectKind(e,`duo`),this.emit({type:`play`,nodeId:e,n1:t,n2:n,gate:r,retrig:i})}gate(e,t,n){this.expectKind(e,`df`),this.emit({type:`gate`,nodeId:e,target:t,on:n})}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}node(e){let t=this.nodes.get(e);if(!t)throw Error(`Unknown node: ${e}`);return t}expectKind(e,...t){if(!t.includes(this.node(e).kind))throw Error(`Node ${e} is not a ${t.join(` or `)}`)}emit(e){for(let t of this.listeners)t(e)}},x=class{circuit=new Ee;controlList=[];inputList=[];outputList=[];meterList=[];get controls(){return this.controlList}get inputs(){return this.inputList}get outputs(){return this.outputList}get meters(){return this.meterList}control(e){let t=this.controlList.find(t=>t.id===e);if(!t)throw Error(`${this.name} has no control ${e}`);return t}jack(e,t){let n=(e===`in`?this.inputList:this.outputList).find(e=>e.name===t);if(!n)throw Error(`${this.name} has no ${e} jack ${t}`);return n}},De=class{listeners=new Set;onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}notify(){for(let e of this.listeners)e()}},S=class extends De{id;label;min;max;initial;unit;apply;curve;kind=`number`;current;constructor(e,t,n,r,i,a,o,s=`linear`){super(),this.id=e,this.label=t,this.min=n,this.max=r,this.initial=i,this.unit=a,this.apply=o,this.curve=s,this.current=Oe(this.initial,n,r),this.apply(this.current)}get value(){return this.current}set(e){this.current=Oe(e,this.min,this.max),this.apply(this.current),this.notify()}},C=class extends De{id;label;options;apply;kind=`choice`;current;constructor(e,t,n,r,i){if(super(),this.id=e,this.label=t,this.options=n,this.apply=i,!n.includes(r))throw Error(`Invalid initial choice ${r}`);this.current=r,this.apply(this.current)}get value(){return this.current}set(e){if(!this.options.includes(e))throw Error(`Invalid choice ${e} for ${this.id}`);this.current=e,this.apply(e),this.notify()}},w=class extends De{id;label;apply;kind=`toggle`;current;constructor(e,t,n,r){super(),this.id=e,this.label=t,this.apply=r,this.current=n,this.apply(n)}get value(){return this.current}set(e){this.current=e,this.apply(e),this.notify()}};function Oe(e,t,n){return Math.min(n,Math.max(t,e))}var ke={"bc.threshold":-18,"bc.ratio":4,"bc.attack":10,"bc.release":200,"bc.knee":6,"bc.makeup":3,"bc.mix":1,"bc.duck.depth":0,"bc.duck.release":120,"bc.duck.keyHp":80,"bc.bypass":0,"bc.listen":0},T=(e,t)=>({name:e,values:t}),Ae=[T(`Init`,{}),T(`Glue`,{"bc.threshold":-14,"bc.ratio":2,"bc.attack":30,"bc.release":400,"bc.knee":12,"bc.makeup":2}),T(`Kick Duck`,{"bc.threshold":-6,"bc.ratio":1.5,"bc.makeup":0,"bc.duck.depth":.7,"bc.duck.release":140}),T(`Gentle Pump`,{"bc.threshold":-16,"bc.ratio":2,"bc.makeup":3,"bc.duck.depth":.35,"bc.duck.release":220}),T(`Hard Pump`,{"bc.threshold":-12,"bc.ratio":4,"bc.makeup":2,"bc.duck.depth":.95,"bc.duck.release":90,"bc.duck.keyHp":120}),T(`NY Parallel`,{"bc.threshold":-32,"bc.ratio":8,"bc.attack":3,"bc.release":100,"bc.knee":4,"bc.makeup":10,"bc.mix":.4}),T(`Drum Smash`,{"bc.threshold":-28,"bc.ratio":20,"bc.attack":1,"bc.release":200,"bc.knee":0,"bc.makeup":8,"bc.mix":.7}),T(`Limiter`,{"bc.threshold":-4,"bc.ratio":20,"bc.attack":1,"bc.release":100,"bc.knee":0,"bc.makeup":0})],je=4,Me=e=>10**(e/20);function Ne(e,t,n){let r=e+n/2<0?e+(0-e)/t:0;return-.6*Math.min(0,r)}var Pe=class extends x{name;slots=[...Ae];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;mix=1;makeupDb=3;threshold=-18;ratio=4;knee=6;bypass=!1;listen=!1;constructor(e=`Bus Comp`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`duck`,`gain`,{gain:1}).add(`gate`,`gain`,{gain:1}).add(`comp`,`compressor`,{threshold:-18,knee:6,ratio:4,attack:.01,release:.2}).add(`wet`,`gain`,{gain:Me(3)}).add(`dry`,`gain`,{gain:0}).add(`bypassPath`,`gain`,{gain:0}).add(`listenPath`,`gain`,{gain:0}).add(`out`,`gain`,{gain:1}).add(`inMeter`,`meter`,{},{channel:`mono`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`inMeter`).connect(`in`,`duck`).connect(`duck`,`gate`).connect(`gate`,`comp`).connect(`gate`,`dry`).connect(`comp`,`wet`).connect(`wet`,`out`).connect(`dry`,`out`).connect(`in`,`bypassPath`).connect(`bypassPath`,`out`).connect(`listenPath`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),t.add(`key`,`gain`,{gain:1},{channels:`mono`}).add(`keyHp`,`filter`,{frequency:80,Q:.707,detune:0},{type:`highpass`}).add(`follow`,`follower`,{attack:.003,release:.12}).add(`sense`,`gain`,{gain:je}).add(`keyShape`,`waveshaper`,{},{curve:`soft`}).add(`duckMeter`,`meter`,{},{channel:`mono`}).add(`depth`,`gain`,{gain:0}).connect(`key`,`keyHp`).connect(`keyHp`,`follow`).connect(`follow`,`sense`).connect(`sense`,`keyShape`).connect(`keyShape`,`duckMeter`).connect(`keyShape`,`depth`).connect(`depth`,`duck`,`gain`).connect(`keyHp`,`listenPath`),this.inputList.push({name:`in`,nodeId:`in`},{name:`key`,nodeId:`key`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`in`,nodeId:`inMeter`},{name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`},{name:`duck`,nodeId:`duckMeter`});let n=ke,r=(e,t,r,i,a,o,s)=>this.controlList.push(new S(e,t,r,i,n[e],a,o,s));r(`bc.threshold`,`Threshold`,-60,0,`dB`,e=>{this.threshold=e,t.setParam(`comp`,`threshold`,e),this.applyMix()}),r(`bc.ratio`,`Ratio`,1,20,`:1`,e=>{this.ratio=e,t.setParam(`comp`,`ratio`,e),this.applyMix()}),r(`bc.attack`,`Attack`,.3,100,`ms`,e=>t.setParam(`comp`,`attack`,e/1e3),`log`),r(`bc.release`,`Release`,30,1e3,`ms`,e=>t.setParam(`comp`,`release`,e/1e3),`log`),r(`bc.knee`,`Knee`,0,30,`dB`,e=>{this.knee=e,t.setParam(`comp`,`knee`,e),this.applyMix()}),r(`bc.makeup`,`Make-up`,0,24,`dB`,e=>{this.makeupDb=e,this.applyMix()}),r(`bc.mix`,`Mix`,0,1,``,e=>{this.mix=e,this.applyMix()}),r(`bc.duck.depth`,`Duck depth`,0,1,``,e=>t.setParam(`depth`,`gain`,-e)),r(`bc.duck.release`,`Duck release`,20,800,`ms`,e=>t.setParam(`follow`,`release`,e/1e3),`log`),r(`bc.duck.keyHp`,`Key HP`,20,300,`Hz`,e=>t.setParam(`keyHp`,`frequency`,e),`log`),this.controlList.push(new w(`bc.bypass`,`Bypass`,!1,e=>{this.bypass=e,this.applyPaths()}),new w(`bc.listen`,`Key listen`,!1,e=>{this.listen=e,this.applyPaths()}))}applyMix(){this.circuit.setParam(`dry`,`gain`,1-this.mix),this.circuit.setParam(`wet`,`gain`,this.mix*Me(this.makeupDb-Ne(this.threshold,this.ratio,this.knee)))}applyPaths(){let e=this.circuit;e.setParam(`gate`,`gain`,this.bypass||this.listen?0:1),e.setParam(`bypassPath`,`gain`,this.bypass&&!this.listen?1:0),e.setParam(`listenPath`,`gain`,+!!this.listen)}loadPreset(e){let t={...ke,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`bc.bypass`&&t.id!==`bc.listen`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}},Fe=[`internal`,`midi`],Ie=[`omni`,...Array.from({length:16},(e,t)=>String(t+1))],Le=2e3,Re=4,ze=class{clock;now;sync=new C(`transport.sync`,`Sync`,Fe,`internal`,()=>{});followStartStop=new w(`transport.followStartStop`,`Start/stop`,!0,()=>{});channel=new C(`transport.channel`,`Channel`,Ie,`1`,()=>{});tempo=new S(`transport.tempo`,`Tempo`,20,300,120,`BPM`,()=>{});taps=[];constructor(e,t=()=>performance.now()){this.clock=e,this.now=t}get synced(){return this.sync.value===`midi`}get bpm(){return this.synced?this.clock.bpm??this.tempo.value:this.tempo.value}get locked(){return this.synced&&this.clock.isLocked(this.now())}get running(){return this.synced&&this.followStartStop.value&&this.clock.running}get position(){return this.running?this.clock.position:Te(0)}acceptsChannel(e){return this.channel.value===`omni`||Number(this.channel.value)===e}tap(e=this.now()){let t=this.taps[this.taps.length-1];if(t!==void 0&&e-t>Le&&(this.taps=[]),this.taps.push(e),this.taps.length>Re&&this.taps.shift(),this.taps.length>=2){let e=this.taps[this.taps.length-1]-this.taps[0];this.tempo.set(Math.round(6e4/(e/(this.taps.length-1))*10)/10)}}nudge(e){this.tempo.set(Math.round((this.tempo.value+e)*10)/10)}},E=[`kick`,`snare`,`clap`,`closedHat`,`openHat`,`ride`],Be={35:`kick`,36:`kick`,38:`snare`,40:`snare`,39:`clap`,42:`closedHat`,44:`closedHat`,46:`openHat`,51:`ride`,59:`ride`},Ve=1200,He=[205.3,304.4,369.6,522.7,540,800],Ue=class extends x{name;transport;choke=new w(`hats.choke`,`Choke`,!0,()=>{});muted=new Set;soloed=new Set;envelopes=new Map;hitListeners=new Set;constructor(e=`Drums`,t=new b){super(),this.name=e,this.transport=new ze(t),this.transport.channel.set(`10`);let n=this.circuit;this.addKick(n),this.addSnare(n),this.addClap(n),this.addHat(n,`closedHat`,{decay:[.015,.25,.04],tone:.7,level:.6}),this.addHat(n,`openHat`,{decay:[.1,1.5,.32],tone:.65,level:.6}),this.addRide(n);for(let e of E)n.add(`${e}.mute`,`gain`,{gain:1}).add(`${e}.out`,`gain`,{gain:.8}).add(`${e}.meter`,`meter`,{},{channel:`mono`}).connect(`${e}.sum`,`${e}.mute`).connect(`${e}.mute`,`${e}.out`).connect(`${e}.out`,`${e}.meter`),this.outputList.push({name:e,nodeId:`${e}.out`}),this.meterList.push({name:e,nodeId:`${e}.meter`});this.addLevels(n),this.controlList.push(this.choke)}trigger(e,t=1,n){if(!(t<=0)){e===`closedHat`&&this.choke.value&&this.circuit.choke(`openHat.ampEnv`,n);for(let r of this.envelopes.get(e)??[])this.circuit.trigger(r,t,n);for(let r of this.hitListeners)r(e,t,n)}}onHit(e){return this.hitListeners.add(e),()=>this.hitListeners.delete(e)}handleMidi(e){if(e.type!==`noteOn`||!this.transport.acceptsChannel(e.channel))return;let t=Be[e.note];t&&this.trigger(t,e.velocity/127)}get soloActive(){return this.soloed.size>0}register(e,...t){this.envelopes.set(e,[...this.envelopes.get(e)??[],...t])}num(...e){let t=new S(...e);return this.controlList.push(t),t}addKick(e){this.register(`kick`,`kick.pitchEnv`,`kick.ampEnv`,`kick.clickEnv`),e.add(`kick.osc`,`oscillator`,{frequency:48,detune:0},{waveform:`sine`}).add(`kick.pitchEnv`,`trigger`,{peak:2700,decay:.05,velSens:0}).add(`kick.ampEnv`,`trigger`,{peak:.8,decay:.38,velSens:.8}).add(`kick.amp`,`gain`,{gain:0}).add(`kick.noise`,`noise`).add(`kick.clickHp`,`filter`,{frequency:2500,Q:.707},{type:`highpass`}).add(`kick.clickAmp`,`gain`,{gain:0}).add(`kick.clickEnv`,`trigger`,{peak:.24,decay:.012,velSens:1}).add(`kick.sum`,`gain`,{gain:1}).connect(`kick.pitchEnv`,`kick.osc`,`detune`).connect(`kick.osc`,`kick.amp`).connect(`kick.ampEnv`,`kick.amp`,`gain`).connect(`kick.amp`,`kick.sum`).connect(`kick.noise`,`kick.clickHp`).connect(`kick.clickHp`,`kick.clickAmp`).connect(`kick.clickEnv`,`kick.clickAmp`,`gain`).connect(`kick.clickAmp`,`kick.sum`),this.num(`kick.tune`,`Tune`,30,120,48,`Hz`,t=>e.setParam(`kick.osc`,`frequency`,t),`log`),this.num(`kick.decay`,`Decay`,.08,1,.38,`s`,t=>e.setParam(`kick.ampEnv`,`decay`,t),`log`),this.num(`kick.click`,`Click`,0,1,.4,``,t=>e.setParam(`kick.clickEnv`,`peak`,t*.6))}addSnare(e){this.register(`snare`,`snare.pitchEnv`,`snare.bodyEnv`,`snare.noiseEnv`),e.add(`snare.osc1`,`oscillator`,{frequency:190,detune:0},{waveform:`triangle`}).add(`snare.osc2`,`oscillator`,{frequency:347.7,detune:0},{waveform:`triangle`}).add(`snare.pitchEnv`,`trigger`,{peak:500,decay:.03,velSens:0}).add(`snare.bodyEnv`,`trigger`,{peak:.4,decay:.1,velSens:.7}).add(`snare.bodyAmp`,`gain`,{gain:0}).add(`snare.noise`,`noise`).add(`snare.noiseHp`,`filter`,{frequency:1800,Q:.707},{type:`highpass`}).add(`snare.noiseEnv`,`trigger`,{peak:.42,decay:.18,velSens:1}).add(`snare.noiseAmp`,`gain`,{gain:0}).add(`snare.sum`,`gain`,{gain:1}).connect(`snare.osc1`,`snare.bodyAmp`).connect(`snare.osc2`,`snare.bodyAmp`).connect(`snare.pitchEnv`,`snare.osc1`,`detune`).connect(`snare.pitchEnv`,`snare.osc2`,`detune`).connect(`snare.bodyEnv`,`snare.bodyAmp`,`gain`).connect(`snare.bodyAmp`,`snare.sum`).connect(`snare.noise`,`snare.noiseHp`).connect(`snare.noiseHp`,`snare.noiseAmp`).connect(`snare.noiseEnv`,`snare.noiseAmp`,`gain`).connect(`snare.noiseAmp`,`snare.sum`),this.num(`snare.tune`,`Tune`,120,300,190,`Hz`,t=>{e.setParam(`snare.osc1`,`frequency`,t),e.setParam(`snare.osc2`,`frequency`,t*1.83)},`log`),this.num(`snare.decay`,`Decay`,.08,.5,.18,`s`,t=>{e.setParam(`snare.noiseEnv`,`decay`,t),e.setParam(`snare.bodyEnv`,`decay`,t*.55)},`log`),this.num(`snare.snap`,`Snap`,0,1,.6,``,t=>e.setParam(`snare.noiseEnv`,`peak`,t*.7))}addClap(e){this.register(`clap`,`clap.env`),e.add(`clap.noise`,`noise`).add(`clap.bp`,`filter`,{frequency:1200,Q:1.5},{type:`bandpass`}).add(`clap.amp`,`gain`,{gain:0}).add(`clap.env`,`trigger`,{peak:2.3,decay:.24,velSens:.8,spread:.012},{shape:`clap`}).add(`clap.sum`,`gain`,{gain:1}).connect(`clap.noise`,`clap.bp`).connect(`clap.bp`,`clap.amp`).connect(`clap.env`,`clap.amp`,`gain`).connect(`clap.amp`,`clap.sum`),this.num(`clap.tone`,`Tone`,600,3e3,1200,`Hz`,t=>e.setParam(`clap.bp`,`frequency`,t),`log`),this.num(`clap.decay`,`Decay`,.08,.6,.24,`s`,t=>e.setParam(`clap.env`,`decay`,t),`log`),this.num(`clap.spread`,`Spread`,0,1,.5,``,t=>e.setParam(`clap.env`,`spread`,.006+t*.012))}addMetal(e,t,n,r,i,a){e.add(`${t}.tune`,`constant`,{offset:0}).add(`${t}.metal`,`gain`,{gain:a}).add(`${t}.bp`,`filter`,{frequency:r,Q:.8},{type:`bandpass`}).add(`${t}.hp`,`filter`,{frequency:i,Q:.707},{type:`highpass`}).connect(`${t}.metal`,`${t}.bp`).connect(`${t}.bp`,`${t}.hp`),He.forEach((r,i)=>{let a=`${t}.sq${i+1}`;e.add(a,`oscillator`,{frequency:r*n,detune:0},{waveform:`square`}).connect(`${t}.tune`,a,`detune`).connect(a,`${t}.metal`)})}addHat(e,t,n){this.register(t,`${t}.ampEnv`),this.addMetal(e,t,1,9e3,7e3,.45),e.add(`${t}.amp`,`gain`,{gain:0}).add(`${t}.ampEnv`,`trigger`,{peak:1,decay:n.decay[2],velSens:.8}).add(`${t}.sum`,`gain`,{gain:1}).connect(`${t}.hp`,`${t}.amp`).connect(`${t}.ampEnv`,`${t}.amp`,`gain`).connect(`${t}.amp`,`${t}.sum`),this.num(`${t}.tune`,`Tune`,0,1,.6,``,n=>e.setParam(`${t}.tune`,`offset`,(n-.6)*2*Ve)),this.num(`${t}.decay`,`Decay`,n.decay[0],n.decay[1],n.decay[2],`s`,n=>e.setParam(`${t}.ampEnv`,`decay`,n),`log`),this.num(`${t}.tone`,`Tone`,0,1,n.tone,``,n=>e.setParam(`${t}.hp`,`frequency`,3e3+n*7e3))}addRide(e){this.register(`ride`,`ride.ampEnv`,`ride.bellEnv`),this.addMetal(e,`ride`,1.3,6500,2500,.18),e.add(`ride.amp`,`gain`,{gain:0}).add(`ride.ampEnv`,`trigger`,{peak:1,decay:1.2,velSens:.8}).add(`ride.bell1`,`oscillator`,{frequency:2650,detune:0},{waveform:`sine`}).add(`ride.bell2`,`oscillator`,{frequency:4380,detune:0},{waveform:`sine`}).add(`ride.bellAmp`,`gain`,{gain:0}).add(`ride.bellEnv`,`trigger`,{peak:.2,decay:.9,velSens:.8}).add(`ride.sum`,`gain`,{gain:1}).connect(`ride.hp`,`ride.amp`).connect(`ride.ampEnv`,`ride.amp`,`gain`).connect(`ride.amp`,`ride.sum`).connect(`ride.tune`,`ride.bell1`,`detune`).connect(`ride.tune`,`ride.bell2`,`detune`).connect(`ride.bell1`,`ride.bellAmp`).connect(`ride.bell2`,`ride.bellAmp`).connect(`ride.bellEnv`,`ride.bellAmp`,`gain`).connect(`ride.bellAmp`,`ride.sum`),this.num(`ride.tune`,`Tune`,0,1,.5,``,t=>e.setParam(`ride.tune`,`offset`,(t-.5)*2*Ve)),this.num(`ride.decay`,`Decay`,.4,2.5,1.2,`s`,t=>{e.setParam(`ride.ampEnv`,`decay`,t),e.setParam(`ride.bellEnv`,`decay`,t*.75)},`log`),this.num(`ride.bell`,`Bell`,0,1,.45,``,t=>e.setParam(`ride.bellEnv`,`peak`,t*.45))}addLevels(e){let t={kick:.8,snare:.75,clap:.7,closedHat:.6,openHat:.6,ride:.55};for(let n of E)this.num(`${n}.level`,`Level`,0,1,t[n],``,t=>e.setParam(`${n}.out`,`gain`,t)),this.controlList.push(new w(`${n}.mute`,`Mute`,!1,e=>this.setFlag(this.muted,n,e)),new w(`${n}.solo`,`Solo`,!1,e=>this.setFlag(this.soloed,n,e)))}setFlag(e,t,n){n?e.add(t):e.delete(t);for(let e of E){let t=`${e}.mute`;if(!this.circuit.nodes.has(t))continue;let n=this.muted.has(e)||this.soloed.size>0&&!this.soloed.has(e);this.circuit.setParam(t,`gain`,+!n)}}},We=[`small`,`medium`,`large`],Ge=3.5,D=Math.tanh(2.5)/2.5,Ke=2,qe=class extends x{name;constructor(e=`Reverb`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`pre`,`delay`,{delayTime:.02,maxTime:.3}).add(`conv`,`convolver`,{},{size:`medium`}).add(`lowcut`,`filter`,{frequency:150,Q:.707,detune:0},{type:`highpass`}).add(`damp`,`filter`,{frequency:5e3,Q:.707,detune:0},{type:`lowpass`}).add(`drive`,`gain`,{gain:Ge*D/Ke}).add(`sat`,`waveshaper`,{},{curve:`soft`}).add(`out`,`gain`,{gain:Ke}).connect(`in`,`pre`).connect(`pre`,`conv`).connect(`conv`,`lowcut`).connect(`lowcut`,`damp`).connect(`damp`,`drive`).connect(`drive`,`sat`).connect(`sat`,`out`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.controlList.push(new C(`reverb.size`,`Size`,We,`medium`,e=>t.setOption(`conv`,`size`,e)),new S(`reverb.predelay`,`Pre-delay`,0,250,20,`ms`,e=>t.setParam(`pre`,`delayTime`,e/1e3)),new S(`reverb.lowcut`,`Low cut`,40,600,150,`Hz`,e=>t.setParam(`lowcut`,`frequency`,e),`log`),new S(`reverb.damp`,`Damping`,1e3,16e3,5e3,`Hz`,e=>t.setParam(`damp`,`frequency`,e),`log`))}},Je=class extends x{name;spread=.8;feedback=.45;constructor(e=`Delay`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`out`,`gain`,{gain:.5}).add(`wobble`,`oscillator`,{frequency:.9,detune:0},{waveform:`sine`}).add(`wobbleDepth`,`gain`,{gain:6e-4});for(let e of[`L`,`R`]){let n=t=>`${t}${e}`;t.add(n(`inGain`),`gain`,{gain:1}).add(n(`dly`),`delay`,{delayTime:.375,maxTime:2}).add(n(`tone`),`filter`,{frequency:3200,Q:.707,detune:0},{type:`lowpass`}).add(n(`hp`),`filter`,{frequency:120,Q:.707,detune:0},{type:`highpass`}).add(n(`drive`),`gain`,{gain:1.9}).add(n(`sat`),`waveshaper`,{},{curve:`soft`}).add(n(`make`),`gain`,{gain:D/1.9}).add(n(`fbSelf`),`gain`,{gain:0}).add(n(`fbCross`),`gain`,{gain:0}).add(n(`pan`),`pan`,{pan:e===`L`?-1:1}).connect(`in`,n(`inGain`)).connect(n(`inGain`),n(`dly`)).connect(n(`dly`),n(`tone`)).connect(n(`tone`),n(`hp`)).connect(n(`hp`),n(`drive`)).connect(n(`drive`),n(`sat`)).connect(n(`sat`),n(`make`)).connect(n(`make`),n(`fbSelf`)).connect(n(`make`),n(`fbCross`)).connect(n(`sat`),n(`pan`)).connect(n(`pan`),`out`).connect(`wobbleDepth`,n(`dly`),`delayTime`)}t.connect(`fbSelfL`,`dlyL`).connect(`fbCrossL`,`dlyR`).connect(`fbSelfR`,`dlyR`).connect(`fbCrossR`,`dlyL`).connect(`wobble`,`wobbleDepth`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`});let n=e=>{e(`L`),e(`R`)};this.controlList.push(new S(`delay.time`,`Time`,20,1500,375,`ms`,e=>n(n=>t.setParam(`dly${n}`,`delayTime`,e/1e3)),`log`),new S(`delay.feedback`,`Feedback`,0,1.1,.45,``,e=>{this.feedback=e,this.applyFeedback()}),new S(`delay.tone`,`Tone`,400,12e3,3200,`Hz`,e=>n(n=>t.setParam(`tone${n}`,`frequency`,e)),`log`),new S(`delay.spread`,`Ping-pong`,0,1,.8,``,e=>{this.spread=e,this.applyFeedback(),t.setParam(`inGainR`,`gain`,1-e)}),new S(`delay.wobble`,`Wobble`,0,1,.15,``,e=>t.setParam(`wobbleDepth`,`gain`,e*.004)),new S(`delay.drive`,`Drive`,0,1,.3,``,e=>{let r=1+e*3;n(e=>{t.setParam(`drive${e}`,`gain`,r),t.setParam(`make${e}`,`gain`,D/r)})}))}applyFeedback(){let e=this.circuit;for(let t of[`L`,`R`])e.setParam(`fbSelf${t}`,`gain`,this.feedback*(1-this.spread)),e.setParam(`fbCross${t}`,`gain`,this.feedback*this.spread)}},Ye=1,Xe=2,Ze=.8,Qe={"gr.position":.3,"gr.size":120,"gr.pitch":0,"gr.rate":12,"gr.spread":.5,"gr.cloud":.2,"gr.detune":0,"gr.shape":.3,"gr.reverse":0,"gr.feedback":0,"gr.mix":1,"gr.freeze":0,"gr.filter":2e4,"gr.reso":.7,"gr.drive":0,"gr.reverb":0,"gr.tone":8e3,"gr.tail":`medium`,"gr.play":0,"gr.attack":20,"gr.decay":300,"gr.sustain":.8,"gr.release":600},$e=3.5,et=2,tt=7,O=(e,t)=>({name:e,values:t}),nt=[O(`Init`,{}),O(`Cloud Wash`,{"gr.position":.5,"gr.size":350,"gr.rate":30,"gr.spread":1,"gr.cloud":.6,"gr.detune":12,"gr.shape":0,"gr.reverb":.35,"gr.tail":`large`}),O(`Frozen Pad`,{"gr.position":.15,"gr.size":700,"gr.rate":14,"gr.spread":.9,"gr.cloud":.25,"gr.detune":6,"gr.shape":0,"gr.freeze":1,"gr.filter":3500,"gr.reverb":.3,"gr.tail":`large`}),O(`Stutter`,{"gr.position":.02,"gr.size":90,"gr.rate":8,"gr.spread":.2,"gr.cloud":0,"gr.shape":.7}),O(`Octave Shimmer`,{"gr.position":.25,"gr.size":220,"gr.pitch":12,"gr.rate":24,"gr.spread":.8,"gr.cloud":.3,"gr.detune":8,"gr.feedback":.35,"gr.reverb":.25}),O(`Reverse Swell`,{"gr.position":.35,"gr.size":900,"gr.rate":6,"gr.spread":.6,"gr.cloud":.15,"gr.shape":0,"gr.reverse":1}),O(`Glitch Dust`,{"gr.position":.6,"gr.size":25,"gr.rate":70,"gr.spread":1,"gr.cloud":.9,"gr.detune":40,"gr.shape":.8,"gr.reverse":.3,"gr.drive":.35,"gr.filter":9e3,"gr.reso":3}),O(`Tape Drone`,{"gr.position":.1,"gr.size":500,"gr.pitch":-12,"gr.rate":18,"gr.spread":.4,"gr.cloud":.1,"gr.detune":4,"gr.shape":0,"gr.feedback":.6,"gr.filter":1800,"gr.reso":2,"gr.drive":.25})],rt=class extends x{name;slots=[...nt];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;noteListeners=new Set;performanceListeners=new Set;held=[];bend=0;modWheelValue=0;pitchSemitones=0;constructor(e=`Granular`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`grains`,`granular`,{maxTime:20,position:.3,size:.12,pitch:0,rate:12,spread:.5,cloud:.2,detune:0,shape:.3,reverse:0,feedback:0,freeze:0,play:0,attack:.02,decay:.3,sustain:.8,release:.6}).add(`filter`,`filter`,{frequency:2e4,Q:.7,gain:0,detune:0},{type:`lowpass`}).add(`preDrive`,`gain`,{gain:1}).add(`sat`,`waveshaper`,{},{curve:`soft`}).add(`postDrive`,`gain`,{gain:D}).add(`revSend`,`gain`,{gain:0}).add(`conv`,`convolver`,{},{size:`medium`}).add(`revTone`,`filter`,{frequency:8e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`revDrive`,`gain`,{gain:$e*D/et}).add(`revSat`,`waveshaper`,{},{curve:`soft`}).add(`revOut`,`gain`,{gain:et}).add(`wet`,`gain`,{gain:1}).add(`dry`,`gain`,{gain:0}).add(`out`,`gain`,{gain:1}).add(`inMeter`,`meter`,{},{channel:`mono`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`grains`).connect(`in`,`dry`).connect(`in`,`inMeter`).connect(`grains`,`filter`).connect(`filter`,`preDrive`).connect(`preDrive`,`sat`).connect(`sat`,`postDrive`).connect(`postDrive`,`wet`).connect(`wet`,`out`).connect(`postDrive`,`revSend`).connect(`revSend`,`conv`).connect(`conv`,`revTone`).connect(`revTone`,`revDrive`).connect(`revDrive`,`revSat`).connect(`revSat`,`revOut`).connect(`revOut`,`out`).connect(`dry`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`in`,nodeId:`inMeter`},{name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=Qe,r=(e,t,r,i,a,o,s)=>this.controlList.push(new S(e,t,r,i,n[e],a,o,s)),i=(e,n,i,a,o,s,c=1,l)=>r(e,n,i,a,o,e=>t.setParam(`grains`,s,e*c),l);i(`gr.position`,`Position`,0,1,``,`position`),i(`gr.size`,`Size`,5,2e3,`ms`,`size`,1/1e3,`log`),r(`gr.pitch`,`Pitch`,-24,24,`st`,e=>{this.pitchSemitones=e,this.applyPitch()}),i(`gr.rate`,`Rate`,.5,100,`Hz`,`rate`,1,`log`),i(`gr.spread`,`Spread`,0,1,``,`spread`),i(`gr.cloud`,`Cloud`,0,1,``,`cloud`),i(`gr.detune`,`Detune`,0,100,`ct`,`detune`),i(`gr.shape`,`Shape`,0,1,``,`shape`),i(`gr.reverse`,`Reverse`,0,1,``,`reverse`),i(`gr.feedback`,`Feedback`,0,.95,``,`feedback`),r(`gr.filter`,`Filter`,40,2e4,`Hz`,e=>t.setParam(`filter`,`frequency`,e),`log`),r(`gr.reso`,`Reso`,.7,12,``,e=>t.setParam(`filter`,`Q`,e),`log`),r(`gr.drive`,`Drive`,0,1,``,e=>{t.setParam(`preDrive`,`gain`,1+tt*e),t.setParam(`postDrive`,`gain`,D/(1+2*e))}),r(`gr.reverb`,`Reverb`,0,1,``,e=>t.setParam(`revSend`,`gain`,e)),r(`gr.tone`,`Tone`,1e3,16e3,`Hz`,e=>t.setParam(`revTone`,`frequency`,e),`log`),r(`gr.mix`,`Mix`,0,1,``,e=>{t.setParam(`wet`,`gain`,e),t.setParam(`dry`,`gain`,1-e)}),r(`gr.attack`,`Attack`,1,4e3,`ms`,e=>t.setParam(`grains`,`attack`,e/1e3),`log`),r(`gr.decay`,`Decay`,5,4e3,`ms`,e=>t.setParam(`grains`,`decay`,e/1e3),`log`),r(`gr.sustain`,`Sustain`,0,1,``,e=>t.setParam(`grains`,`sustain`,e)),r(`gr.release`,`Release`,5,8e3,`ms`,e=>t.setParam(`grains`,`release`,e/1e3),`log`),this.controlList.push(new w(`gr.play`,`Keys`,!1,e=>{t.setParam(`grains`,`play`,+!!e),e||this.releaseAll()}),new C(`gr.channel`,`MIDI channel`,Ie,`3`,()=>{}),new C(`gr.tail`,`Tail`,We,`medium`,e=>t.setOption(`conv`,`size`,e)),new w(`gr.freeze`,`Freeze`,!1,e=>t.setParam(`grains`,`freeze`,+!!e)))}applyPitch(){this.circuit.setParam(`grains`,`pitch`,this.pitchSemitones+this.bend*Xe)}releaseAll(){if(this.circuit.allNotesOff(`grains`),this.held.length>0){this.held=[];for(let e of this.noteListeners)e()}}keyDown(e,t=Ze){let n=this.control(`gr.play`);n.kind===`toggle`&&!n.value&&n.set(!0),this.held=this.held.filter(t=>t!==e),this.held.push(e),this.circuit.noteOn(`grains`,e,t);for(let e of this.noteListeners)e()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.circuit.noteOff(`grains`,e);for(let e of this.noteListeners)e()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.applyPitch();for(let e of this.performanceListeners)e()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e));for(let e of this.performanceListeners)e()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(!(`channel`in e))return;let t=this.control(`gr.channel`);if(!(t.kind!==`choice`||t.value!==`omni`&&Number(t.value)!==e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity/127);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===Ye&&this.setModWheel(e.value/127);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...Qe,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`gr.channel`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}},it=[`series`,`parallel`,`pingpong`],at=[`lfo`,`env`],ot=[`tri`,`ramp`,`sqr`,`rnd`],st=[`lp`,`hp`],k=[`a`,`b`],A=e=>e.toUpperCase(),ct=.25,lt=3600,ut=.8,dt=.5,ft=1,pt=8e-4,mt={"ouro.input":1,"ouro.mix":.5,"ouro.output":1,"ouro.routing":`parallel`,"ouro.kill":0,"ouro.freeze":0,"ouro.a.on":1,"ouro.a.gain":1,"ouro.a.delay":380,"ouro.a.grit":.15,"ouro.a.cutoff":3e3,"ouro.a.resonance":1.2,"ouro.a.filter":`lp`,"ouro.a.clip":.25,"ouro.a.level":1,"ouro.b.on":1,"ouro.b.gain":1,"ouro.b.delay":530,"ouro.b.grit":.15,"ouro.b.cutoff":2200,"ouro.b.resonance":1.2,"ouro.b.filter":`lp`,"ouro.b.clip":.25,"ouro.b.level":1,"ouro.fb.aa":.35,"ouro.fb.ab":.15,"ouro.fb.ba":.15,"ouro.fb.bb":.35,"ouro.mod.mode":`lfo`,"ouro.mod.wave":`tri`,"ouro.mod.rate":.8,"ouro.mod.depth":.4,"ouro.mod.trigger":0,"ouro.mod.dlyA":.15,"ouro.mod.dlyB":-.15,"ouro.mod.cutA":0,"ouro.mod.cutB":0,"ouro.mod.gainA":0,"ouro.mod.gainB":0},j=(e,t)=>({name:e,values:t}),ht=[j(`Tape Spiral`,{"ouro.routing":`series`,"ouro.a.delay":240,"ouro.b.delay":360,"ouro.fb.aa":.35,"ouro.fb.bb":.4,"ouro.fb.ab":0,"ouro.fb.ba":.15,"ouro.a.grit":.35,"ouro.a.cutoff":2200,"ouro.b.cutoff":1800,"ouro.mod.rate":.4,"ouro.mod.depth":.6,"ouro.mod.dlyA":.3,"ouro.mod.dlyB":.2,"ouro.mod.cutA":.1}),j(`Karaoke Drone`,{"ouro.mix":.7,"ouro.fb.aa":.95,"ouro.fb.bb":.95,"ouro.a.gain":1.6,"ouro.b.gain":1.6,"ouro.a.grit":.5,"ouro.b.grit":.5,"ouro.a.clip":.6,"ouro.b.clip":.6,"ouro.a.delay":700,"ouro.b.delay":910,"ouro.a.cutoff":1400,"ouro.b.cutoff":1e3,"ouro.a.resonance":4,"ouro.b.resonance":4}),j(`Ping Pong Mayhem`,{"ouro.routing":`pingpong`,"ouro.mix":.6,"ouro.a.delay":280,"ouro.b.delay":280,"ouro.fb.ab":0,"ouro.fb.ba":.15,"ouro.fb.aa":.1,"ouro.fb.bb":.1,"ouro.a.resonance":.7,"ouro.b.resonance":.7,"ouro.a.grit":.1,"ouro.mod.depth":0}),j(`Dub Wash`,{"ouro.routing":`series`,"ouro.mix":.45,"ouro.a.delay":480,"ouro.b.delay":720,"ouro.fb.aa":.6,"ouro.fb.bb":.5,"ouro.fb.ab":.1,"ouro.fb.ba":.1,"ouro.a.cutoff":1800,"ouro.b.cutoff":1200,"ouro.a.resonance":2.5,"ouro.b.resonance":2.5,"ouro.a.clip":.2,"ouro.mod.rate":.25,"ouro.mod.depth":.5,"ouro.mod.cutA":.4,"ouro.mod.cutB":.3}),j(`Self Oscillator`,{"ouro.input":.2,"ouro.mix":1,"ouro.fb.aa":1.1,"ouro.fb.bb":1.1,"ouro.fb.ab":.3,"ouro.fb.ba":.3,"ouro.a.resonance":18,"ouro.b.resonance":18,"ouro.a.cutoff":800,"ouro.b.cutoff":1200,"ouro.a.clip":.5,"ouro.b.clip":.5,"ouro.a.delay":60,"ouro.b.delay":90,"ouro.mod.rate":.1,"ouro.mod.depth":.3,"ouro.mod.cutA":.5}),j(`Broken Echo`,{"ouro.a.grit":.85,"ouro.b.grit":.85,"ouro.a.delay":330,"ouro.b.delay":470,"ouro.fb.aa":.55,"ouro.fb.bb":.55,"ouro.a.clip":.7,"ouro.b.clip":.7,"ouro.mod.wave":`rnd`,"ouro.mod.rate":6,"ouro.mod.depth":.7,"ouro.mod.dlyA":.4,"ouro.mod.dlyB":-.3,"ouro.mod.gainA":.3}),j(`Filter Scream`,{"ouro.routing":`series`,"ouro.mix":.8,"ouro.a.filter":`hp`,"ouro.a.cutoff":2500,"ouro.a.resonance":16,"ouro.b.cutoff":1500,"ouro.b.resonance":16,"ouro.fb.aa":.6,"ouro.fb.bb":.6,"ouro.fb.ab":.2,"ouro.fb.ba":.1,"ouro.a.clip":.8,"ouro.b.clip":.8,"ouro.mod.wave":`ramp`,"ouro.mod.rate":2,"ouro.mod.depth":.8,"ouro.mod.cutA":.8,"ouro.mod.cutB":-.8}),j(`Slow Rot`,{"ouro.routing":`series`,"ouro.mix":.55,"ouro.a.delay":900,"ouro.b.delay":1300,"ouro.a.grit":.6,"ouro.b.grit":.6,"ouro.fb.aa":.55,"ouro.fb.bb":.55,"ouro.fb.ab":0,"ouro.fb.ba":.1,"ouro.a.cutoff":900,"ouro.b.cutoff":700,"ouro.a.resonance":1,"ouro.b.resonance":1,"ouro.mod.rate":.08,"ouro.mod.depth":.9,"ouro.mod.dlyA":.5,"ouro.mod.dlyB":.4,"ouro.a.level":.9,"ouro.b.level":.9})],gt=class extends x{name;slots=[...ht];currentSlot=0;currentPreset=this.slots[0];fb={aa:.35,ab:.15,ba:.15,bb:.35};on={a:!0,b:!0};clipDrive={a:1.25,b:1.25};routing=`parallel`;killed=!1;frozen=!1;modRate=.8;presetListeners=new Set;constructor(e=`Ouroboros`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`mono`,`gain`,{gain:1},{channels:`mono`}).add(`inGain`,`gain`,{gain:1}).add(`srcGate`,`gain`,{gain:1}).add(`srcA`,`gain`,{gain:1}).add(`srcB`,`gain`,{gain:1}).add(`dry`,`gain`,{gain:Math.SQRT1_2}).add(`wet`,`gain`,{gain:Math.SQRT1_2}).add(`sum`,`gain`,{gain:1}).add(`out`,`gain`,{gain:1}).connect(`in`,`mono`).connect(`mono`,`inGain`).connect(`inGain`,`srcGate`).connect(`srcGate`,`srcA`).connect(`srcGate`,`srcB`).connect(`in`,`dry`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`out`).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`L`,nodeId:`meterL`},{name:`R`,nodeId:`meterR`});for(let e of k)this.addChannel(t,e);t.add(`linkAB`,`gain`,{gain:0}).add(`bounceBA`,`gain`,{gain:0}).connect(`lvlA`,`linkAB`).connect(`linkAB`,`inB`).connect(`lvlB`,`bounceBA`).connect(`bounceBA`,`inA`).connect(`srcA`,`inA`).connect(`srcB`,`inB`);for(let e of k)for(let n of k)t.add(`fb${A(e)}${A(n)}`,`gain`,{gain:0}).connect(`clip${A(e)}`,`fb${A(e)}${A(n)}`).connect(`fb${A(e)}${A(n)}`,`in${A(n)}`);t.add(`seedNoise`,`noise`).add(`seedGain`,`gain`,{gain:pt}).connect(`seedNoise`,`seedGain`).connect(`seedGain`,`inA`).connect(`seedGain`,`inB`),this.addModulator(t),this.addControls(t),this.applyRouting(),this.applyFeedback()}loadPreset(e){let t={...mt,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`ouro.kill`&&t.id!==`ouro.mod.trigger`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}addChannel(e,t){let n=A(t);e.add(`in${n}`,`gain`,{gain:1}).add(`on${n}`,`gain`,{gain:1}).add(`g${n}`,`gain`,{gain:D}).add(`sg${n}`,`waveshaper`,{},{curve:`soft`}).add(`dly${n}`,`delay`,{delayTime:.38,maxTime:2}).add(`tone${n}`,`filter`,{frequency:4800,Q:.707,detune:0},{type:`lowpass`}).add(`crush${n}`,`waveshaper`,{bits:16},{curve:`crush`}).add(`filt${n}`,`filter`,{frequency:3e3,Q:1.2,detune:0},{type:`lowpass`}).add(`cdrive${n}`,`gain`,{gain:D}).add(`clip${n}`,`waveshaper`,{},{curve:`soft`}).add(`lvl${n}`,`gain`,{gain:1}).add(`send${n}`,`gain`,{gain:1}).add(`pan${n}`,`pan`,{pan:t===`a`?-1:1}).connect(`in${n}`,`on${n}`).connect(`on${n}`,`g${n}`).connect(`g${n}`,`sg${n}`).connect(`sg${n}`,`dly${n}`).connect(`dly${n}`,`tone${n}`).connect(`tone${n}`,`crush${n}`).connect(`crush${n}`,`filt${n}`).connect(`filt${n}`,`cdrive${n}`).connect(`cdrive${n}`,`clip${n}`).connect(`clip${n}`,`lvl${n}`).connect(`lvl${n}`,`send${n}`).connect(`send${n}`,`pan${n}`).connect(`pan${n}`,`wet`)}addModulator(e){e.add(`lfoOsc`,`oscillator`,{frequency:.8,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:.8}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfoGate`,`gain`,{gain:1}).add(`follow`,`waveshaper`,{},{curve:`abs`}).add(`followLp`,`filter`,{frequency:.8,Q:.707,detune:0},{type:`lowpass`}).add(`followGain`,`gain`,{gain:4}).add(`modTrig`,`trigger`,{peak:1,decay:.6,velSens:0}).add(`envGate`,`gain`,{gain:0}).add(`mod`,`gain`,{gain:1}).add(`modOut`,`gain`,{gain:.4}).connect(`lfoOsc`,`lfoOscOut`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoOscOut`,`lfoGate`).connect(`lfoRndOut`,`lfoGate`).connect(`inGain`,`follow`).connect(`follow`,`followLp`).connect(`followLp`,`followGain`).connect(`followGain`,`envGate`).connect(`modTrig`,`envGate`).connect(`lfoGate`,`mod`).connect(`envGate`,`mod`).connect(`mod`,`modOut`);for(let t of k){let n=A(t);e.add(`mDly${n}`,`gain`,{gain:0}).add(`mCut${n}`,`gain`,{gain:0}).add(`mGain${n}`,`gain`,{gain:0}).connect(`modOut`,`mDly${n}`).connect(`mDly${n}`,`dly${n}`,`delayTime`).connect(`modOut`,`mCut${n}`).connect(`mCut${n}`,`filt${n}`,`detune`).connect(`modOut`,`mGain${n}`).connect(`mGain${n}`,`g${n}`,`gain`)}}addControls(e){let t=mt,n=e=>t[e],r=(e,t,r,i,a,o,s)=>this.controlList.push(new S(e,t,r,i,n(e),a,o,s)),i=(e,n,r,i)=>this.controlList.push(new C(e,n,r,t[e],i));r(`ouro.input`,`Input`,0,2,``,t=>e.setParam(`inGain`,`gain`,t)),r(`ouro.mix`,`Mix`,0,1,``,t=>{e.setParam(`dry`,`gain`,Math.cos(t*Math.PI/2)),e.setParam(`wet`,`gain`,Math.sin(t*Math.PI/2))}),r(`ouro.output`,`Output`,0,1.5,``,t=>e.setParam(`out`,`gain`,t)),i(`ouro.routing`,`Routing`,it,e=>{this.routing=e,this.applyRouting(),this.applyFeedback()}),this.controlList.push(new w(`ouro.kill`,`Kill`,!1,e=>{this.killed=e,this.applyFeedback()}),new w(`ouro.freeze`,`Freeze`,!1,e=>{this.frozen=e,this.applyFeedback()}));for(let t of k){let n=A(t),a=e=>`ouro.${t}.${e}`;this.controlList.push(new w(a(`on`),`On`,!0,r=>{this.on[t]=r,e.setParam(`on${n}`,`gain`,+!!r),this.applyFeedback()})),r(a(`gain`),`Gain`,.05,8,`×`,t=>e.setParam(`g${n}`,`gain`,t*D),`log`),r(a(`delay`),`Delay`,10,1800,`ms`,t=>e.setParam(`dly${n}`,`delayTime`,t/1e3),`log`),r(a(`grit`),`Grit`,0,1,``,t=>e.setParam(`crush${n}`,`bits`,16-t*13)),r(a(`cutoff`),`Cutoff`,20,18e3,`Hz`,t=>e.setParam(`filt${n}`,`frequency`,t),`log`),r(a(`resonance`),`Resonance`,.1,30,``,t=>e.setParam(`filt${n}`,`Q`,t)),i(a(`filter`),`Filter`,st,t=>e.setOption(`filt${n}`,`type`,t===`hp`?`highpass`:`lowpass`)),r(a(`clip`),`Clip`,0,1,``,r=>{let i=1+r*7;e.setParam(`cdrive${n}`,`gain`,D*i),this.clipDrive[t]=i,this.applyFeedback()}),r(a(`level`),`Level`,0,1.5,``,t=>e.setParam(`lvl${n}`,`gain`,t))}for(let[e,t]of[[`aa`,`A>A`],[`ab`,`A>B`],[`ba`,`B>A`],[`bb`,`B>B`]])r(`ouro.fb.${e}`,t,0,1.2,``,t=>{this.fb[e]=t,this.applyFeedback()});i(`ouro.mod.mode`,`Mode`,at,t=>{e.setParam(`lfoGate`,`gain`,+(t===`lfo`)),e.setParam(`envGate`,`gain`,+(t===`env`))}),i(`ouro.mod.wave`,`Wave`,ot,t=>{e.setOption(`lfoOsc`,`waveform`,t===`sqr`?`square`:t===`ramp`?`sawtooth`:`triangle`),e.setParam(`lfoOscOut`,`gain`,t===`rnd`?0:1),e.setParam(`lfoRndOut`,`gain`,+(t===`rnd`))}),r(`ouro.mod.rate`,`Rate`,.05,30,`Hz`,t=>{this.modRate=t,e.setParam(`lfoOsc`,`frequency`,t),e.setParam(`lfoRnd`,`rate`,t),e.setParam(`followLp`,`frequency`,t),e.setParam(`modTrig`,`decay`,Math.min(4,1.5/t))},`log`),r(`ouro.mod.depth`,`Depth`,0,1,``,t=>e.setParam(`modOut`,`gain`,t)),this.controlList.push(new w(`ouro.mod.trigger`,`Trigger`,!1,t=>{t&&e.trigger(`modTrig`,1)}));for(let t of k){let n=A(t),i=(t,i,a,o)=>r(`ouro.mod.${t}${n}`,i,-1,1,``,t=>e.setParam(`${a}${n}`,`gain`,t*o));i(`dly`,`Delay ${n}`,`mDly`,ct),i(`cut`,`Cutoff ${n}`,`mCut`,lt),i(`gain`,`Gain ${n}`,`mGain`,ut)}}applyRouting(){let e=this.circuit,t=this.routing===`series`,n=this.routing===`parallel`;e.setParam(`srcB`,`gain`,+!!n),e.setParam(`sendA`,`gain`,+!t),e.setParam(`panA`,`pan`,-1),e.setParam(`panB`,`pan`,+!t)}applyFeedback(){let e=this.circuit;for(let t of k)for(let n of k){let r=`${t}${n}`,i=this.fb[r]/this.clipDrive[t];this.frozen&&t===n&&(i=ft/this.clipDrive[t]),(this.killed||!this.on[t]||!this.on[n])&&(i=0),e.setParam(`fb${A(t)}${A(n)}`,`gain`,i)}let t=this.routing!==`parallel`;e.setParam(`linkAB`,`gain`,t?1/this.clipDrive.a:0);let n=this.routing===`pingpong`&&!this.killed&&this.on.a&&this.on.b;e.setParam(`bounceBA`,`gain`,n?dt/this.clipDrive.b:0),e.setParam(`srcGate`,`gain`,+!this.frozen)}},_t={"osc1.wave":`saw`,"osc1.octave":`16`,"osc1.pw":0,"osc1.glide":0,"osc1.level":.8,"osc2.wave":`saw`,"osc2.octave":`8`,"osc2.detune":0,"osc2.glide":0,"osc2.level":.6,tune:0,sync:0,"vib.rate":5,"vib.level":0,noise:0,"route.vco":`nor`,"route.vcf":`lpf`,"route.mod":`single`,"filter.cutoff":1800,"filter.res":.2,"filter.post":0,"mod1.rise":.01,"mod1.fall":.5,"mod1.hold":0,"mod1.lfo":0,"mod1.level":.3,"mod2.rise":.01,"mod2.fall":.5,"mod2.hold":0,"mod2.lfo":0,"mod2.level":0,"vca.rise":.005,"vca.fall":.4,"vca.hold":1,"vca.lfo":0,"vca.level":.8,"reverb.time":.1,"reverb.decay":.35,"reverb.mix":.15,"play.legato":0,"play.mode":`duo`,"play.channel":0},vt=[`play.channel`],M=(e,t)=>({name:e,values:t}),yt=[M(`Init`,{}),M(`Fat Bass`,{"osc1.octave":`32`,"osc1.wave":`square`,"osc1.pw":.2,"osc2.octave":`16`,"osc2.detune":.1,"filter.cutoff":260,"filter.res":.35,"mod1.rise":.002,"mod1.fall":.35,"mod1.level":.55,"vca.fall":.2,"play.mode":`mono`}),M(`Hard Sync Lead`,{"osc1.octave":`16`,"osc2.octave":`8`,"osc2.detune":7,sync:1,"filter.cutoff":2600,"filter.res":.3,"mod2.level":.5,"route.mod":`dual`,"mod2.lfo":1,"mod2.rise":.35,"mod2.fall":.35,"vib.level":.3,"vib.rate":5.5,"osc1.glide":.15,"osc2.glide":.15}),M(`Dual Fifths`,{"osc1.octave":`16`,"osc2.octave":`16`,"osc2.detune":.01,"osc2.wave":`tri`,"filter.cutoff":1400,"mod1.level":.3,"mod1.fall":.8,"mod1.hold":1,"reverb.mix":.25,"reverb.decay":.5}),M(`Resonant Squelch`,{"osc1.octave":`16`,"osc1.wave":`square`,"osc2.level":.3,"filter.cutoff":200,"filter.res":.85,"mod1.rise":.002,"mod1.fall":.22,"mod1.level":.8,"vca.fall":.25,"play.mode":`mono`}),M(`Split Pad`,{"route.vco":`split`,"route.vcf":`even`,"route.mod":`split`,"osc1.octave":`16`,"osc2.octave":`8`,"osc2.wave":`tri`,"osc2.detune":.03,"filter.cutoff":700,"filter.post":1.2,"mod1.rise":.9,"mod1.fall":1.6,"mod1.hold":1,"mod1.level":.35,"mod2.rise":1.4,"mod2.fall":2,"mod2.hold":1,"mod2.level":.45,"vca.rise":.7,"vca.fall":1.6,"reverb.mix":.35,"reverb.decay":.6,"reverb.time":.3}),M(`Band Pass Voice`,{"route.vcf":`odd`,"route.vco":`half`,"osc1.octave":`16`,"osc2.octave":`8`,"osc2.detune":12,"filter.cutoff":900,"filter.res":.6,"filter.post":-.8,"mod1.rise":.1,"mod1.fall":.6,"mod1.level":.4}),M(`Wobble Bass`,{"osc1.octave":`32`,"osc2.octave":`16`,"osc2.detune":.08,"filter.cutoff":180,"filter.res":.6,"mod1.lfo":1,"mod1.rise":.18,"mod1.fall":.18,"mod1.level":.6,"play.mode":`mono`}),M(`Tremolo Organ`,{"osc1.wave":`square`,"osc1.octave":`16`,"osc2.wave":`tri`,"osc2.octave":`8`,"filter.cutoff":3500,"vca.lfo":1,"vca.hold":1,"vca.rise":.06,"vca.fall":.06,"vib.level":.1,"reverb.mix":.3}),M(`Noise Hat`,{"osc1.level":0,"osc2.level":0,noise:.9,"route.vcf":`hpf`,"filter.cutoff":7e3,"filter.res":.2,"vca.hold":0,"vca.rise":.001,"vca.fall":.09,"reverb.mix":.1}),M(`Ringing Filters`,{"route.vco":`vca`,"route.vcf":`even`,"osc1.level":.05,"osc2.level":0,"filter.cutoff":300,"filter.post":.6,"filter.res":1,"mod1.level":.2,"mod1.rise":.01,"mod1.fall":.6,"vca.rise":.01,"vca.fall":.5,"reverb.mix":.3}),M(`Infinite Cathedral`,{"osc1.octave":`8`,"osc2.octave":`8`,"osc2.wave":`tri`,"osc2.detune":.02,"filter.cutoff":2200,"mod1.level":.2,"vca.rise":.5,"vca.fall":2.5,"reverb.mix":.7,"reverb.decay":1,"reverb.time":.5}),M(`Pulse Sweep`,{"osc1.wave":`square`,"osc1.pw":.7,"osc1.octave":`16`,"osc2.octave":`16`,"filter.cutoff":500,"filter.res":.4,"mod1.rise":1.4,"mod1.fall":1.8,"mod1.hold":1,"mod1.level":.7,"vca.rise":.3}),M(`Glide Mono`,{"osc1.octave":`16`,"osc2.octave":`16`,"osc2.detune":.01,"osc1.glide":.35,"osc2.glide":.35,"filter.cutoff":1100,"filter.res":.45,"mod1.level":.4,"mod1.fall":.4,"play.mode":`mono`,"play.legato":1}),M(`Dual Detune Strings`,{"osc1.octave":`8`,"osc2.octave":`8`,"osc2.detune":.12,"filter.cutoff":1900,"mod1.level":.15,"vca.rise":.25,"vca.fall":.9,"vib.level":.15,"vib.rate":5.8,"reverb.mix":.3,"reverb.decay":.55}),M(`Hoover`,{"osc1.wave":`square`,"osc1.pw":.35,"osc1.octave":`16`,"osc2.wave":`saw`,"osc2.octave":`16`,"osc2.detune":0,tune:42,"osc1.glide":.45,"osc2.glide":.5,"osc1.level":.8,"osc2.level":.8,"filter.cutoff":2600,"filter.res":.45,"route.mod":`dual`,"mod1.level":.15,"mod1.fall":.6,"mod1.hold":1,"mod2.lfo":1,"mod2.rise":.4,"mod2.fall":.4,"mod2.level":.5,"vib.level":.3,"vib.rate":6.5,"vca.fall":.5,"reverb.mix":.3,"reverb.decay":.45,"reverb.time":.2,"play.legato":1}),M(`Filter Echo`,{"osc1.octave":`16`,"osc2.octave":`8`,"osc2.detune":12,"route.mod":`dual`,"filter.cutoff":800,"filter.res":.55,"mod2.lfo":1,"mod2.rise":.25,"mod2.fall":.4,"mod2.level":.5,"mod1.level":.4,"reverb.mix":.4,"reverb.decay":.75,"reverb.time":.4})],bt=Array.from({length:24},(e,t)=>yt[t]??M(`Init`,{})),xt=1,St=64,Ct={32:-24,16:-12,8:0},wt={16:-12,8:0,4:12},Tt=`o1Wave.o1Off.o1Pw.o1Lvl.o1Gld.o2Wave.o2Off.o2Dtn.o2Lvl.o2Gld.tune.sync.vibRate.vibLvl.noise.vcoRoute.vcfRoute.modRoute.cutoff.res.post.m1Rise.m1Fall.m1Hold.m1Lfo.m1Lvl.m2Rise.m2Fall.m2Hold.m2Lfo.m2Lvl.vcaRise.vcaFall.vcaHold.vcaLfo.level.rvTime.rvDecay.rvMix.bend.modw`.split(`.`),Et=class extends x{name;bendRange=3;slots=[...bt];currentSlot=0;currentPreset=this.slots[0];held=[];latched=new Set;pedal=!1;bend=0;modWheelValue=0;gate=!1;lastChannel=1;lockedChannel;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`MOA-DUO`){super(),this.name=e;let t=this.circuit;t.add(`synth`,`duo`,Object.fromEntries(Tt.map(e=>[e,0]))).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`synth`,`meterL`).connect(`synth`,`meterR`),this.outputList.push({name:`out`,nodeId:`synth`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=_t,r=e=>n=>t.setParam(`synth`,e,n),i=(e,t,i,a,o,s,c)=>this.controlList.push(new S(e,t,i,a,n[e],o,r(s),c)),a=(e,t,i,a,o)=>this.controlList.push(new C(e,t,i,n[e],e=>r(a)(o?o(e):i.indexOf(e)))),o=(e,t,i)=>this.controlList.push(new w(e,t,n[e]>0,e=>r(i)(+!!e)));a(`osc1.wave`,`Wave`,[`saw`,`square`],`o1Wave`),a(`osc1.octave`,`Octave`,[`32`,`16`,`8`],`o1Off`,e=>Ct[e]),i(`osc1.pw`,`Pulse width`,0,1,``,`o1Pw`),i(`osc1.glide`,`Glide`,0,1,``,`o1Gld`),i(`osc1.level`,`Level`,0,1,``,`o1Lvl`),a(`osc2.wave`,`Wave`,[`saw`,`tri`],`o2Wave`),a(`osc2.octave`,`Octave`,[`16`,`8`,`4`],`o2Off`,e=>wt[e]),i(`osc2.detune`,`Detune`,0,24,`st`,`o2Dtn`),i(`osc2.glide`,`Glide`,0,1,``,`o2Gld`),i(`osc2.level`,`Level`,0,1,``,`o2Lvl`),i(`tune`,`Tune`,-100,100,`ct`,`tune`),o(`sync`,`Sync`,`sync`),i(`vib.rate`,`Vibrato rate`,.1,20,`Hz`,`vibRate`,`log`),i(`vib.level`,`Vibrato level`,0,1,``,`vibLvl`),i(`noise`,`Noise`,0,1,``,`noise`),a(`route.vco`,`VCO routing`,[`nor`,`split`,`half`,`vca`],`vcoRoute`),a(`route.vcf`,`VCF routing`,[`lpf`,`hpf`,`even`,`odd`],`vcfRoute`),a(`route.mod`,`Mod routing`,[`single`,`dual`,`split`,`odd`],`modRoute`),i(`filter.cutoff`,`Cutoff`,20,2e4,`Hz`,`cutoff`,`log`),i(`filter.res`,`Resonance`,0,1,``,`res`),i(`filter.post`,`Post`,-4,4,`oct`,`post`);for(let[e,t]of[[`1`,`m1`],[`2`,`m2`],[`vca`,`vca`]]){let n=e===`vca`?`vca`:`mod${e}`;i(`${n}.rise`,`Rise`,.001,5,`s`,`${t}Rise`,`log`),i(`${n}.fall`,`Fall`,.01,15,`s`,`${t}Fall`,`log`),o(`${n}.hold`,`Hold`,`${t}Hold`),o(`${n}.lfo`,`LFO`,`${t}Lfo`),e!==`vca`&&i(`${n}.level`,`Level`,0,1,``,`${t}Lvl`)}i(`vca.level`,`Level`,0,1.5,``,`level`),i(`reverb.time`,`Time`,0,1,``,`rvTime`),i(`reverb.decay`,`Decay`,0,1,``,`rvDecay`),i(`reverb.mix`,`Mix`,0,1,``,`rvMix`),this.controlList.push(new w(`play.legato`,`Legato`,n[`play.legato`]>0,()=>void 0),new C(`play.mode`,`Mode`,[`mono`,`duo`],n[`play.mode`],()=>void 0),new w(`play.channel`,`Channel lock`,!1,()=>void 0))}keyDown(e){let t=this.held.length===0;this.held=this.held.filter(t=>t!==e),this.held.push(e),this.latched.delete(e),this.sendNotes(t||!this.legato),this.notifyNotes()}keyUp(e){this.held.includes(e)&&(this.pedal?this.latched.add(e):this.release(e))}release(e){this.held=this.held.filter(t=>t!==e),this.latched.delete(e),this.sendNotes(!1),this.notifyNotes()}releaseLatched(){for(let e of[...this.latched])this.release(e)}get legato(){return this.control(`play.legato`).value}assign(){let e=this.held;if(e.length===0)return;let t=e[e.length-1];if(this.control(`play.mode`).value===`mono`||e.length===1)return{n1:t,n2:t};let n=Math.min(...e),r=Math.max(...e);return e.length===2?{n1:n,n2:r}:{n1:n,n2:t>n?t:r}}sendNotes(e){let t=this.assign();t?(this.gate=!0,this.circuit.play(`synth`,t.n1,t.n2,!0,e)):this.gate&&(this.gate=!1,this.circuit.play(`synth`,this.lastN1,this.lastN2,!1,!1)),t&&(this.lastN1=t.n1,this.lastN2=t.n2)}lastN1=60;lastN2=60;get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`synth`,`bend`,this.bend*3),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`synth`,`modw`,this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(`channel`in e){if(!this.control(`play.channel`).value)this.lastChannel=e.channel,this.lockedChannel=void 0;else if(this.lockedChannel??=this.lastChannel,e.channel!==this.lockedChannel)return;switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===xt?this.setModWheel(e.value/127):e.controller===St&&(this.pedal=e.value>=64,this.pedal||this.releaseLatched());break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.currentPreset=t,this.applyValues({..._t,...t.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){if(vt.includes(t))continue;let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)vt.includes(t.id)||(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyPreset(){for(let e of this.presetListeners)e()}},Dt={"f1.type":`GEN LP`,"f1.cutoff":1200,"f1.res":.25,"f1.depth":0,"f1.source":`env`,"f1.inv":0,"f1.noise":0,"f1.vca":0,"f1.gate":0,"f1.threshold":.3,"f2.type":`GEN LP`,"f2.cutoff":1200,"f2.res":.25,"f2.depth":0,"f2.source":`env`,"f2.inv":0,"f2.noise":0,"f2.vca":0,"f2.gate":0,"f2.threshold":.3,"env1.attack":.01,"env1.decay":.3,"env1.sustain":.6,"env1.release":.4,"env1.mode":`adsr`,"env1.curve":`lin`,"env1.trig":`keys`,"env2.attack":.01,"env2.decay":.3,"env2.sustain":.6,"env2.release":.4,"env2.mode":`adsr`,"env2.curve":`lin`,"env2.trig":`keys`,"link.env":0,"link.cutoff":0,"sh.rate":4,"sh.slew":.2,"sh.source":`noise`,"delay.time":.25,"delay.repeats":.3,"delay.level":0,"delay.mod":0,"delay.source":`s&h`,"mix.a":.8,"mix.b":.8,"mix.mode":`stereo`,"mix.volume":.8},N=(e,t)=>({name:e,values:t}),P=e=>{let t={};for(let[n,r]of Object.entries(e))t[`f1.${n}`]=r,t[`f2.${n}`]=r;return t},Ot=[N(`Init`,{}),N(`Dynamic Pluck`,{...P({cutoff:180,res:.45,depth:.85,vca:1}),"env1.attack":.002,"env1.decay":.22,"env1.sustain":0,"env1.release":.2,"env1.curve":`exp`,"link.env":1,"delay.level":.2,"delay.time":.18,"delay.repeats":.3}),N(`Auto Wah`,{"f1.type":`GEN BP`,"f1.cutoff":350,"f1.res":.7,"f1.depth":.7,"f2.type":`GEN BP`,"f2.cutoff":500,"f2.res":.7,"f2.depth":.7,"env1.trig":`thresh`,"f1.gate":1,"f1.threshold":.35,"env1.attack":.004,"env1.decay":.18,"env1.sustain":.1,"env1.release":.15,"env1.curve":`exp`,"link.env":1}),N(`Screaming Madman`,{"f1.type":`GEN LP`,"f1.cutoff":300,"f1.res":.93,"f1.depth":.6,"f2.type":`GEN HP`,"f2.cutoff":900,"f2.res":.9,"f2.depth":-.4,"env1.attack":.01,"env1.decay":.5,"env1.sustain":.2,"env1.release":.6,"link.env":1,"mix.a":.6,"mix.b":.45}),N(`Silk Sweep`,{...P({type:`2045 LP`,cutoff:250,res:.35,depth:.7}),"env1.attack":.45,"env1.decay":1.2,"env1.sustain":.7,"env1.release":1.5,"link.env":1,"delay.level":.25,"delay.time":.38,"delay.repeats":.45}),N(`Ringing 2045`,{"f1.type":`2045 LP`,"f1.cutoff":520,"f1.res":.96,"f1.depth":.3,"f2.type":`2045 LP`,"f2.cutoff":780,"f2.res":.96,"f2.depth":.3,"env1.attack":.05,"env1.sustain":.5,"link.env":1,"mix.a":.5,"mix.b":.5}),N(`Twin Peaks`,{...P({type:`BP+`,cutoff:700,res:.78,depth:.5}),"f2.cutoff":1100,"env1.attack":.02,"env1.decay":.6,"env1.sustain":.4,"env1.release":.5,"link.env":1}),N(`Phase Rooms`,{"f1.type":`NOTCH+`,"f1.cutoff":600,"f1.res":.6,"f1.depth":.8,"f1.source":`s&h`,"f2.type":`BANDSTOP+`,"f2.cutoff":900,"f2.res":.5,"f2.depth":.8,"sh.rate":1.2,"sh.slew":.65,"sh.source":`noise`}),N(`Random Steps`,{...P({cutoff:400,res:.6,depth:.9,source:`s&h`}),"f2.type":`GEN BP`,"sh.rate":7,"sh.slew":.05,"delay.level":.3,"delay.time":.21,"delay.repeats":.4,"delay.mod":.4,"delay.source":`s&h`}),N(`Looping LFO`,{...P({type:`2045 LP`,cutoff:300,res:.55,depth:.7}),"env1.mode":`loop`,"env1.attack":.35,"env1.release":.55,"link.env":1}),N(`Tremolo Gate`,{...P({cutoff:8e3,res:.1,depth:0,vca:1}),"env1.mode":`loop`,"env1.attack":.01,"env1.release":.09,"env1.curve":`exp`,"link.env":1}),N(`Crunch Echo`,{...P({type:`GEN LP`,cutoff:2400,res:.4}),"delay.level":.7,"delay.time":.42,"delay.repeats":.7,"delay.mod":.25,"delay.source":`env2`,"env2.mode":`loop`,"env2.attack":1.2,"env2.release":1.6}),N(`Noise Drums`,{"f1.type":`GEN BP`,"f1.cutoff":180,"f1.res":.8,"f1.depth":.8,"f1.noise":.9,"f1.vca":1,"f2.type":`GEN HP`,"f2.cutoff":3e3,"f2.res":.4,"f2.noise":.7,"f2.vca":1,"env1.attack":.001,"env1.decay":.12,"env1.sustain":0,"env1.release":.1,"env1.curve":`exp`,"env2.attack":.001,"env2.decay":.05,"env2.sustain":0,"env2.release":.05,"env2.curve":`exp`}),N(`Ghost Pad`,{"f1.type":`2045 LP`,"f1.cutoff":400,"f1.res":.5,"f1.depth":.5,"f1.noise":.15,"f2.type":`BANDSTOP+`,"f2.cutoff":1200,"f2.res":.4,"f2.depth":-.5,"env1.attack":.8,"env1.release":2,"env2.attack":1.5,"env2.release":2.5,"delay.level":.4,"delay.time":.5,"delay.repeats":.6}),N(`Mono Squelch`,{"f1.type":`2045 LP`,"f1.cutoff":120,"f1.res":.88,"f1.depth":.95,"f1.vca":1,"f2.type":`GEN LP`,"f2.cutoff":200,"f2.res":.85,"f2.depth":.9,"f2.vca":1,"env1.attack":.002,"env1.decay":.25,"env1.sustain":.15,"env1.release":.15,"env1.curve":`exp`,"link.env":1,"mix.mode":`mono`})],kt=Array.from({length:16},(e,t)=>Ot[t]??N(`Init`,{})),At=[`GEN LP`,`GEN BP`,`GEN HP`,`GEN NOTCH`,`2045 LP`,`BP+`,`NOTCH+`,`BANDSTOP+`],jt=[`Type`,`Cut`,`Res`,`Depth`,`Src`,`Inv`,`Noise`,`Vca`,`Thr`,`Gate`].flatMap(e=>[`f1${e}`,`f2${e}`]).concat([`e1`,`e2`].flatMap(e=>[`Atk`,`Dec`,`Sus`,`Rel`,`Loop`,`Exp`,`Trig`].map(t=>e+t)),[`envLink`,`cutLink`,`shRate`,`shSlew`,`shSrc`,`dlTime`,`dlRep`,`dlLevel`,`dlMod`,`dlSrc`,`mixA`,`mixB`,`mono`,`vol`]),Mt=class extends x{name;slots=[...kt];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;constructor(e=`MOA-DF2`){super(),this.name=e;let t=this.circuit;t.add(`box`,`df`,Object.fromEntries(jt.map(e=>[e,0]))).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`box`,`meterL`).connect(`box`,`meterR`),this.inputList.push({name:`in`,nodeId:`box`}),this.outputList.push({name:`out`,nodeId:`box`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=Dt,r=e=>n=>t.setParam(`box`,e,n),i=(e,t,i,a,o,s,c)=>this.controlList.push(new S(e,t,i,a,n[e],o,r(s),c)),a=(e,t,i,a)=>this.controlList.push(new C(e,t,i,n[e],e=>r(a)(i.indexOf(e)))),o=(e,t,i)=>this.controlList.push(new w(e,t,n[e]>0,e=>r(i)(+!!e)));for(let e of[`1`,`2`]){let t=`f${e}`;a(`${t}.type`,`Filter type`,At,`${t}Type`),i(`${t}.cutoff`,`Cutoff`,20,2e4,`Hz`,`${t}Cut`,`log`),i(`${t}.res`,`Resonance`,0,1,``,`${t}Res`),i(`${t}.depth`,`Depth`,-1,1,``,`${t}Depth`),a(`${t}.source`,`Source`,[`env`,`s&h`],`${t}Src`),o(`${t}.inv`,`Invert env`,`${t}Inv`),i(`${t}.noise`,`Noise`,0,1,``,`${t}Noise`),o(`${t}.vca`,`VCA`,`${t}Vca`),i(`${t}.threshold`,`Threshold`,0,1,``,`${t}Thr`),o(`${t}.gate`,`Gate on`,`${t}Gate`)}for(let e of[`1`,`2`]){let t=`env${e}`,n=`e${e}`;i(`${t}.attack`,`Attack`,.001,10,`s`,`${n}Atk`,`log`),i(`${t}.decay`,`Decay`,.005,10,`s`,`${n}Dec`,`log`),i(`${t}.sustain`,`Sustain`,0,1,``,`${n}Sus`),i(`${t}.release`,`Release`,.005,20,`s`,`${n}Rel`,`log`),a(`${t}.mode`,`Mode`,[`adsr`,`loop`],`${n}Loop`),a(`${t}.curve`,`Curve`,[`lin`,`exp`],`${n}Exp`),a(`${t}.trig`,`Gate from`,[`keys`,`thresh`],`${n}Trig`)}o(`link.env`,`Env I link`,`envLink`),o(`link.cutoff`,`Cutoff link`,`cutLink`),i(`sh.rate`,`Rate`,.05,40,`Hz`,`shRate`,`log`),i(`sh.slew`,`Slew`,0,1,``,`shSlew`),a(`sh.source`,`Source`,[`noise`,`env`],`shSrc`),i(`delay.time`,`Time`,.02,.6,`s`,`dlTime`,`log`),i(`delay.repeats`,`Repeats`,0,1,``,`dlRep`),i(`delay.level`,`Level`,0,1,``,`dlLevel`),i(`delay.mod`,`Mod depth`,-1,1,``,`dlMod`),a(`delay.source`,`Mod source`,[`s&h`,`env2`],`dlSrc`),i(`mix.a`,`Filter I`,0,1.5,``,`mixA`),i(`mix.b`,`Filter II`,0,1.5,``,`mixB`),a(`mix.mode`,`Output`,[`stereo`,`mono`],`mono`),i(`mix.volume`,`Volume`,0,1.5,``,`vol`)}setKeys(e){this.circuit.gate(`box`,`keys`,e)}setOpen(e,t){this.circuit.gate(`box`,e===1?`open1`:`open2`,t)}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.currentPreset=t,this.applyValues({...Dt,...t.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyPreset(){for(let e of this.presetListeners)e()}},Nt={"lfo.rate":5,"lfo.delay":0,"dco.lfo":0,"dco.pwm":.5,"dco.pwmSource":`man`,"dco.range":`8`,"dco.pulse":1,"dco.saw":1,"dco.sub":.3,"dco.noise":0,"hpf.freq":`1`,"vcf.freq":3e3,"vcf.res":.2,"vcf.env":.4,"vcf.polarity":`plus`,"vcf.lfo":0,"vcf.kybd":.5,"vca.mode":`env`,"vca.level":.8,"env.attack":.005,"env.decay":.4,"env.sustain":.6,"env.release":.3,"chorus.i":0,"chorus.ii":0,"bend.dco":2,"bend.vcf":.2,"bend.lfo":.3,"bend.lfoTrig":0,"master.portamento":0,"assign.mode":`poly1`,"master.tune":0,"master.volume":.75,"key.hold":0,"key.transpose":`0`},Pt=[`master.tune`,`master.volume`,`key.hold`,`key.transpose`],Ft=[`A`,`B`],It=Ft.length*8*8,Lt=(e,t,n)=>e*8*8+(t-1)*8+(n-1),F=(e,t)=>({name:e,values:t}),Rt=[F(`Brass 1`,{"dco.sub":.2,"vcf.freq":700,"vcf.res":.15,"vcf.env":.55,"vcf.kybd":.6,"env.attack":.07,"env.decay":.4,"env.sustain":.65,"env.release":.2,"chorus.i":1}),F(`Brass 2`,{"dco.pwm":.35,"dco.pulse":1,"dco.saw":1,"vcf.freq":600,"vcf.res":.25,"vcf.env":.6,"env.attack":.12,"env.decay":.5,"env.sustain":.55,"env.release":.25,"chorus.ii":1}),F(`Strings`,{"dco.pulse":0,"dco.saw":1,"dco.sub":.1,"hpf.freq":`2`,"vcf.freq":2600,"vcf.res":.05,"vcf.env":.1,"env.attack":.35,"env.decay":1,"env.sustain":.85,"env.release":.6,"chorus.i":1,"chorus.ii":1}),F(`String Ensemble`,{"dco.pulse":1,"dco.saw":1,"dco.pwm":.6,"dco.pwmSource":`lfo`,"lfo.rate":.8,"dco.sub":.15,"hpf.freq":`2`,"vcf.freq":2200,"vcf.env":.1,"env.attack":.5,"env.decay":1,"env.sustain":.9,"env.release":.8,"chorus.i":1,"chorus.ii":1}),F(`Choir`,{"dco.pulse":1,"dco.saw":0,"dco.pwm":.3,"dco.sub":.3,"dco.noise":.04,"vcf.freq":1300,"vcf.res":.35,"vcf.env":.1,"env.attack":.45,"env.decay":.8,"env.sustain":.8,"env.release":.9,"chorus.ii":1}),F(`Warm Pad`,{"dco.sub":.4,"vcf.freq":900,"vcf.res":.1,"vcf.env":.15,"vcf.lfo":.1,"lfo.rate":.3,"env.attack":.9,"env.decay":1.5,"env.sustain":.8,"env.release":1.4,"chorus.i":1}),F(`Slow Pad`,{"dco.pwmSource":`lfo`,"dco.pwm":.5,"lfo.rate":.2,"dco.sub":.25,"vcf.freq":1500,"vcf.res":.2,"vcf.env":.3,"env.attack":1.6,"env.decay":2,"env.sustain":.85,"env.release":2.2,"chorus.i":1,"chorus.ii":1}),F(`Sweep Pad`,{"vcf.freq":400,"vcf.res":.55,"vcf.env":.7,"vcf.lfo":.25,"lfo.rate":.15,"env.attack":1.2,"env.decay":2.5,"env.sustain":.7,"env.release":1.8,"chorus.ii":1}),F(`Sub Bass`,{"dco.range":`16`,"dco.pulse":0,"dco.saw":1,"dco.sub":.8,"vcf.freq":350,"vcf.res":.1,"vcf.env":.3,"vcf.kybd":.2,"env.attack":.003,"env.decay":.3,"env.sustain":.8,"env.release":.12,"master.portamento":.05}),F(`Saw Bass`,{"dco.range":`16`,"dco.pulse":0,"dco.sub":.5,"hpf.freq":`1`,"vcf.freq":500,"vcf.res":.3,"vcf.env":.55,"vcf.kybd":.3,"env.attack":.002,"env.decay":.25,"env.sustain":.4,"env.release":.12}),F(`Pluck Bass`,{"dco.range":`16`,"dco.pulse":1,"dco.saw":0,"dco.pwm":.4,"dco.sub":.6,"vcf.freq":300,"vcf.res":.4,"vcf.env":.7,"vcf.kybd":.4,"env.attack":.001,"env.decay":.22,"env.sustain":0,"env.release":.15}),F(`Lead Saw`,{"dco.pulse":0,"dco.sub":.1,"vcf.freq":2400,"vcf.res":.3,"vcf.env":.25,"vcf.kybd":.8,"dco.lfo":.12,"lfo.rate":5.5,"lfo.delay":.6,"env.attack":.01,"env.decay":.3,"env.sustain":.85,"env.release":.2,"master.portamento":.15,"assign.mode":`unison`,"chorus.i":1}),F(`Lead Pulse`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.55,"dco.pwmSource":`lfo`,"lfo.rate":3,"dco.sub":.2,"vcf.freq":2e3,"vcf.res":.35,"vcf.env":.3,"vcf.kybd":.8,"env.attack":.01,"env.decay":.3,"env.sustain":.8,"env.release":.2,"assign.mode":`unison`,"chorus.ii":1}),F(`Whistle Lead`,{"dco.range":`4`,"dco.saw":0,"dco.pulse":1,"dco.pwm":.1,"dco.sub":0,"hpf.freq":`2`,"vcf.freq":3800,"vcf.res":.2,"vcf.env":.1,"dco.lfo":.1,"lfo.rate":5,"lfo.delay":.9,"env.attack":.04,"env.decay":.3,"env.sustain":.9,"env.release":.25,"master.portamento":.25,"assign.mode":`unison`}),F(`Organ`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":0,"dco.sub":.7,"hpf.freq":`2`,"vcf.freq":6e3,"vcf.res":0,"vcf.env":0,"vca.mode":`gate`,"chorus.i":1,"chorus.ii":1}),F(`Clav`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.25,"dco.sub":0,"hpf.freq":`3`,"vcf.freq":1500,"vcf.res":.35,"vcf.env":.55,"vcf.kybd":.9,"env.attack":.001,"env.decay":.18,"env.sustain":0,"env.release":.12}),F(`Pluck`,{"dco.pulse":0,"dco.sub":.2,"vcf.freq":700,"vcf.res":.3,"vcf.env":.6,"env.attack":.001,"env.decay":.35,"env.sustain":0,"env.release":.3,"chorus.i":1}),F(`Harp`,{"dco.range":`4`,"dco.pulse":0,"dco.sub":0,"vcf.freq":1500,"vcf.res":.15,"vcf.env":.35,"env.attack":.001,"env.decay":1.2,"env.sustain":0,"env.release":1,"chorus.ii":1}),F(`Bell Pad`,{"dco.range":`4`,"dco.saw":0,"dco.pulse":1,"dco.pwm":.7,"dco.pwmSource":`lfo`,"lfo.rate":6,"dco.sub":0,"vcf.freq":2500,"vcf.res":.45,"vcf.env":.4,"env.attack":.002,"env.decay":1.6,"env.sustain":.1,"env.release":1.5,"chorus.i":1,"chorus.ii":1}),F(`Noise Sweep`,{"dco.pulse":0,"dco.saw":0,"dco.sub":0,"dco.noise":.8,"hpf.freq":`2`,"vcf.freq":300,"vcf.res":.6,"vcf.env":.8,"env.attack":1.4,"env.decay":1.5,"env.sustain":.1,"env.release":1.2,"chorus.ii":1}),F(`Wind`,{"dco.pulse":0,"dco.saw":0,"dco.sub":0,"dco.noise":.9,"vcf.freq":900,"vcf.res":.55,"vcf.env":.2,"vcf.lfo":.3,"lfo.rate":.25,"vcf.kybd":1,"env.attack":1,"env.decay":1,"env.sustain":.9,"env.release":1.5,"chorus.i":1}),F(`Vibes`,{"dco.range":`4`,"dco.pulse":0,"dco.sub":0,"dco.lfo":.05,"lfo.rate":6,"vcf.freq":2400,"vcf.res":.1,"vcf.env":.2,"env.attack":.002,"env.decay":1.4,"env.sustain":0,"env.release":.9,"chorus.ii":1}),F(`Glass`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.8,"dco.pwmSource":`lfo`,"lfo.rate":.5,"dco.sub":0,"dco.noise":.03,"hpf.freq":`2`,"vcf.freq":4e3,"vcf.res":.25,"vcf.env":.1,"env.attack":.6,"env.decay":1.5,"env.sustain":.7,"env.release":1.6,"chorus.i":1,"chorus.ii":1}),F(`Funk Stab`,{"dco.sub":.3,"hpf.freq":`2`,"vcf.freq":500,"vcf.res":.25,"vcf.env":.65,"vcf.kybd":.7,"env.attack":.001,"env.decay":.16,"env.sustain":0,"env.release":.08,"chorus.ii":1})],zt=Array.from({length:It},(e,t)=>Rt[t]??F(`Init`,{})),Bt=[`poly`,`mono`,`unison`],Vt=class{count;mode=`poly`;prefer=`oldest`;voices;held=[];clock=0;constructor(e){this.count=e,this.voices=Array.from({length:e},()=>({gate:!1,since:0}))}isActive(e){return this.voices[e].gate}get activeCount(){return this.voices.filter(e=>e.gate).length}noteOn(e){return this.mode===`poly`?this.polyOn(e):this.stackOn(e)}noteOff(e){return this.mode===`poly`?this.polyOff(e):this.stackOff(e)}releaseAll(){this.held=[];let e=[];return this.voices.forEach((t,n)=>{t.gate&&(t.gate=!1,t.since=++this.clock,e.push({kind:`off`,voice:n}))}),e}get active(){return this.mode===`mono`?[0]:this.voices.map((e,t)=>t)}polyOn(e){let t=this.voices.findIndex(t=>t.gate&&t.note===e);if(t<0){let e=this.voices.map((e,t)=>({v:e,i:t})).filter(e=>!e.v.gate),n=e.length?e:this.voices.map((e,t)=>({v:e,i:t}));t=this.prefer===`lowest`&&e.length?e[0].i:n.reduce((e,t)=>t.v.since<e.v.since?t:e).i}let n=this.voices[t];return n.note=e,n.gate=!0,n.since=++this.clock,[{kind:`on`,voice:t,note:e,retrigger:!0,glide:!0}]}polyOff(e){let t=[];return this.voices.forEach((n,r)=>{n.gate&&n.note===e&&(n.gate=!1,n.since=++this.clock,t.push({kind:`off`,voice:r}))}),t}stackOn(e){let t=this.voices[this.active[0]].gate;return this.held=this.held.filter(t=>t!==e),this.held.push(e),this.play(e,!t,t)}stackOff(e){this.held=this.held.filter(t=>t!==e);let t=this.held[this.held.length-1];if(t!==void 0)return this.play(t,!1,!0);let n=[];for(let e of this.active){let t=this.voices[e];t.gate&&(t.gate=!1,t.since=++this.clock,n.push({kind:`off`,voice:e}))}return n}play(e,t,n){return this.active.map(r=>{let i=this.voices[r],a=t||!i.gate;return i.note=e,i.gate=!0,i.since=++this.clock,{kind:`on`,voice:r,note:e,retrigger:a,glide:n&&!a}})}},Ht=[`poly1`,`poly2`,`unison`],Ut=[`16`,`8`,`4`],Wt=[`0`,`1`,`2`,`3`],Gt=[`-2`,`-1`,`0`,`1`,`2`],Kt=1200,qt=69,Jt=1,Yt=64,Xt=.65,Zt=12,Qt={poly:.4,unison:.3},$t=[10,10,240,720],en={16:-1200,8:0,4:Kt},I={i:{rate:.5,depth:.0013},ii:{rate:.83,depth:.0013},both:{rate:9,depth:25e-5}},tn=class extends x{name;transport;slots=[...zt];currentSlot=0;currentPreset=this.slots[0];group=0;bank=1;manualState=!0;manualSnapshot;allocator=new Vt(6);held=[];sounding=new Map;latched=new Set;pedal=!1;bend=0;modWheelValue=0;portamento=0;bendSemitones=2;bendFilter=.2;lfoSensitivity=.3;lfoDepthCents=0;pwmSource=`man`;pwm=.5;envDepth=.4;envSign=1;lfoTrig=!1;chorusI=!1;chorusII=!1;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`Lynch`,t=new b){super(),this.name=e,this.transport=new ze(t),this.transport.channel.set(`omni`);let n=this.circuit;this.addShared(n);for(let e=0;e<6;e++)this.addVoice(n,e);this.addOutput(n),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`}),this.addControls(n)}keyDown(e){let t=e+Number(this.control(`key.transpose`).value)*12;this.held=this.held.filter(t=>t!==e),this.held.push(e),this.latched.delete(e),this.sounding.set(e,t),this.apply(this.allocator.noteOn(t)),this.updateLfoGate(),this.notifyNotes()}keyUp(e){let t=this.sounding.get(e);t!==void 0&&(this.holding?this.latched.add(e):this.release(e,t))}release(e,t){this.sounding.delete(e),this.latched.delete(e),this.held=this.held.filter(t=>t!==e),this.apply(this.allocator.noteOff(t)),this.updateLfoGate(),this.notifyNotes()}get holding(){return this.pedal||this.control(`key.hold`).value}releaseLatched(){for(let e of[...this.latched]){let t=this.sounding.get(e);t!==void 0&&this.release(e,t)}}releaseAll(){this.apply(this.allocator.releaseAll()),this.held=[],this.sounding.clear(),this.latched.clear(),this.updateLfoGate(),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}voiceActive(e){return this.allocator.isActive(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*this.bendSemitones*100),this.circuit.setParam(`bendVcf`,`offset`,this.bend*this.bendFilter*2400),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`lfoPitchMod`,`gain`,this.modWheelValue*this.lfoSensitivity*200),this.updateLfoGate(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}updateLfoGate(){let e=this.lfoTrig?this.modWheelValue>.05:this.held.length>0;this.circuit.setParam(`lfoFade`,`gate`,+!!e)}handleMidi(e){if(e.type!==`clock`&&`channel`in e&&this.transport.acceptsChannel(e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===Jt?this.setModWheel(e.value/127):e.controller===Yt&&(this.pedal=e.value>=64,this.pedal||this.releaseLatched());break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}get manual(){return this.manualState}get patchNumber(){let e=this.currentSlot%64;return{group:Math.floor(this.currentSlot/64),bank:Math.floor(e/8)+1,patch:e%8+1}}selectGroup(e){this.group=Math.min(Ft.length-1,Math.max(0,e)),this.notifyPreset()}selectBank(e){this.bank=Math.min(8,Math.max(1,e)),this.notifyPreset()}selectPatch(e){this.loadSlot(Lt(this.group,this.bank,e))}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.manualState&&(this.manualSnapshot=this.snapshot()),this.manualState=!1,this.currentSlot=e;let{group:n,bank:r}=this.patchNumber;this.group=n,this.bank=r,this.loadPreset(t)}selectManual(){this.manualState||(this.manualState=!0,this.manualSnapshot&&this.applyValues(this.manualSnapshot),this.notifyPreset())}loadPreset(e){this.currentPreset=e,this.applyValues({...Nt,...e.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){if(Pt.includes(t))continue;let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)Pt.includes(t.id)||(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}write(e=Lt(this.group,this.bank,this.patchNumber.patch)){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.manualState=!1,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}apply(e){let t=this.circuit;for(let n of e){let e=e=>`v${n.voice}.${e}`;n.kind===`off`?(t.setParam(e(`env`),`gate`,0),t.setParam(e(`gate`),`gate`,0)):(t.setParam(e(`pitch`),`offset`,(n.note-qt)*100),n.retrigger&&(t.setParam(e(`env`),`gate`,1),t.setParam(e(`gate`),`gate`,1)))}}eachVoice(e){for(let t=0;t<6;t++)e(e=>`v${t}.${e}`)}applyMode(e){this.releaseAll(),this.allocator.mode=e===`unison`?`unison`:`poly`,this.allocator.prefer=e===`poly2`?`lowest`:`oldest`;let t=e===`unison`?Qt.unison:Qt.poly;this.eachVoice(e=>this.circuit.setParam(e(`out`),`gain`,t));let n=e===`unison`?Zt:0,r=5/2;for(let e=0;e<6;e++){let t=(e-r)/r*n;this.circuit.setParam(`v${e}.det`,`offset`,t===0?0:t)}}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyPreset(){for(let e of this.presetListeners)e()}addShared(e){e.add(`bend`,`constant`,{offset:0}).add(`tune`,`constant`,{offset:0}).add(`rangeShift`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:-1200}).add(`pwCv`,`constant`,{offset:0}).add(`bendVcf`,`constant`,{offset:0}).add(`lfoOsc`,`oscillator`,{frequency:5,detune:0},{waveform:`triangle`}).add(`lfoFade`,`envelope`,{attack:.001,decay:.001,sustain:1,release:.02,gate:0}).add(`lfoFadeGain`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPitchMod`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0}).add(`noise`,`noise`).add(`voices`,`gain`,{gain:1}).connect(`lfoOsc`,`lfoFadeGain`).connect(`lfoFade`,`lfoFadeGain`,`gain`).connect(`lfoFadeGain`,`lfo`);for(let t of[`lfoPitch`,`lfoPitchMod`,`lfoPw`,`lfoFilter`])e.connect(`lfo`,t)}addVoice(e,t){let n=e=>`v${t}.${e}`;e.add(n(`pitch`),`constant`,{offset:0,glide:0}).add(n(`det`),`constant`,{offset:0}).add(n(`osc`),`oscillator`,{frequency:440,detune:0},{waveform:`sawtooth`}).add(n(`sub`),`oscillator`,{frequency:440,detune:0},{waveform:`square`}).add(n(`rawOut`),`gain`,{gain:1}).add(n(`pulseSum`),`gain`,{gain:1}).add(n(`shaper`),`waveshaper`,{},{curve:`pulse`}).add(n(`pulseOut`),`gain`,{gain:Xt}).add(n(`subLevel`),`gain`,{gain:0}).add(n(`noiseLevel`),`gain`,{gain:0}).add(n(`mix`),`gain`,{gain:.5}).add(n(`boost`),`filter`,{frequency:120,Q:.707,gain:0,detune:0},{type:`lowshelf`}).add(n(`hpf`),`filter`,{frequency:10,Q:.707,gain:0,detune:0},{type:`highpass`}).add(n(`f1`),`filter`,{frequency:3e3,Q:1,detune:0},{type:`lowpass`}).add(n(`f2`),`filter`,{frequency:3e3,Q:.707,detune:0},{type:`lowpass`}).add(n(`keyFollow`),`gain`,{gain:.5}).add(n(`env`),`envelope`,{attack:.005,decay:.4,sustain:.6,release:.3,gate:0}).add(n(`envDepth`),`gain`,{gain:.4*6*Kt}).add(n(`gate`),`envelope`,{attack:.003,decay:.001,sustain:1,release:.015,gate:0}).add(n(`envAmp`),`gain`,{gain:1}).add(n(`gateAmp`),`gain`,{gain:0}).add(n(`amp`),`gain`,{gain:0}).add(n(`out`),`gain`,{gain:Qt.poly});for(let t of[`osc`,`sub`])for(let r of[n(`pitch`),n(`det`),`bend`,`tune`,`rangeShift`,`lfoPitch`,`lfoPitchMod`])e.connect(r,n(t),`detune`);e.connect(`subShift`,n(`sub`),`detune`).connect(n(`osc`),n(`rawOut`)).connect(n(`osc`),n(`pulseSum`)).connect(`pwCv`,n(`pulseSum`)).connect(`lfoPw`,n(`pulseSum`)).connect(n(`pulseSum`),n(`shaper`)).connect(n(`shaper`),n(`pulseOut`)).connect(n(`rawOut`),n(`mix`)).connect(n(`pulseOut`),n(`mix`)).connect(n(`sub`),n(`subLevel`)).connect(n(`subLevel`),n(`mix`)).connect(`noise`,n(`noiseLevel`)).connect(n(`noiseLevel`),n(`mix`)).connect(n(`mix`),n(`boost`)).connect(n(`boost`),n(`hpf`)).connect(n(`hpf`),n(`f1`)).connect(n(`f1`),n(`f2`)).connect(n(`f2`),n(`amp`)).connect(n(`env`),n(`envDepth`)).connect(n(`pitch`),n(`keyFollow`));for(let t of[`f1`,`f2`])e.connect(n(`envDepth`),n(t),`detune`).connect(n(`keyFollow`),n(t),`detune`).connect(`lfoFilter`,n(t),`detune`).connect(`bendVcf`,n(t),`detune`);e.connect(n(`env`),n(`envAmp`)).connect(n(`envAmp`),n(`amp`),`gain`).connect(n(`gate`),n(`gateAmp`)).connect(n(`gateAmp`),n(`amp`),`gain`).connect(n(`amp`),n(`out`)).connect(n(`out`),`voices`)}addOutput(e){e.add(`chDry`,`gain`,{gain:1}).add(`chLfo`,`oscillator`,{frequency:.5,detune:0},{waveform:`triangle`}).add(`chDelayL`,`delay`,{delayTime:.0035,maxTime:.02}).add(`chDelayR`,`delay`,{delayTime:.0035,maxTime:.02}).add(`chDepthL`,`gain`,{gain:I.i.depth}).add(`chDepthR`,`gain`,{gain:-I.i.depth}).add(`chToneL`,`filter`,{frequency:9e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`chToneR`,`filter`,{frequency:9e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`chPanL`,`pan`,{pan:-1}).add(`chPanR`,`pan`,{pan:1}).add(`chWet`,`gain`,{gain:0}).add(`chSum`,`gain`,{gain:1}).add(`vcaLevel`,`gain`,{gain:.8}).add(`volume`,`gain`,{gain:.75}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`voices`,`chDry`).connect(`chDry`,`chSum`).connect(`voices`,`chDelayL`).connect(`voices`,`chDelayR`).connect(`chDelayL`,`chToneL`).connect(`chDelayR`,`chToneR`).connect(`chToneL`,`chPanL`).connect(`chToneR`,`chPanR`).connect(`chPanL`,`chWet`).connect(`chPanR`,`chWet`).connect(`chWet`,`chSum`).connect(`chLfo`,`chDepthL`).connect(`chLfo`,`chDepthR`).connect(`chDepthL`,`chDelayL`,`delayTime`).connect(`chDepthR`,`chDelayR`,`delayTime`).connect(`chSum`,`vcaLevel`).connect(`vcaLevel`,`volume`).connect(`volume`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`)}addControls(e){let t=Nt,n=e=>t[e],r=(e,t,r,i,a,o,s)=>this.controlList.push(new S(e,t,r,i,n(e),a,o,s)),i=e=>t=>this.eachVoice(n=>e(n,t)),a=(e,t,r)=>this.controlList.push(new w(e,t,n(e)>0,r)),o=(e,n,r,i)=>this.controlList.push(new C(e,n,r,t[e],i));r(`lfo.rate`,`Rate`,.1,30,`Hz`,t=>e.setParam(`lfoOsc`,`frequency`,t),`log`),r(`lfo.delay`,`Delay time`,0,3,`s`,t=>e.setParam(`lfoFade`,`attack`,Math.max(.001,t))),r(`dco.lfo`,`LFO`,0,1,``,t=>{this.lfoDepthCents=t*150,e.setParam(`lfoPitch`,`gain`,this.lfoDepthCents)}),r(`dco.pwm`,`PWM`,0,1,``,e=>{this.pwm=e,this.applyPulseWidth()}),o(`dco.pwmSource`,`PWM source`,[`man`,`lfo`],e=>{this.pwmSource=e,this.applyPulseWidth()}),o(`dco.range`,`Range`,Ut,t=>e.setParam(`rangeShift`,`offset`,en[t])),a(`dco.pulse`,`Pulse`,t=>this.eachVoice(n=>e.setParam(n(`pulseOut`),`gain`,t?Xt:0))),a(`dco.saw`,`Saw`,t=>this.eachVoice(n=>e.setParam(n(`rawOut`),`gain`,+!!t))),r(`dco.sub`,`Sub`,0,1,``,i((t,n)=>e.setParam(t(`subLevel`),`gain`,n*.6))),r(`dco.noise`,`Noise`,0,1,``,i((t,n)=>e.setParam(t(`noiseLevel`),`gain`,n*.5))),o(`hpf.freq`,`HPF`,Wt,t=>{let n=Number(t);this.eachVoice(t=>{e.setParam(t(`boost`),`gain`,n===0?6:0),e.setParam(t(`hpf`),`frequency`,$t[n])})}),r(`vcf.freq`,`Freq`,20,2e4,`Hz`,i((t,n)=>{e.setParam(t(`f1`),`frequency`,n),e.setParam(t(`f2`),`frequency`,n)}),`log`),r(`vcf.res`,`Res`,0,1,``,i((t,n)=>e.setParam(t(`f1`),`Q`,.5*32**n))),r(`vcf.env`,`Env`,0,1,``,e=>{this.envDepth=e,this.applyEnvDepth()}),o(`vcf.polarity`,`Env polarity`,[`plus`,`minus`],e=>{this.envSign=e===`minus`?-1:1,this.applyEnvDepth()}),r(`vcf.lfo`,`LFO`,0,1,``,t=>e.setParam(`lfoFilter`,`gain`,t*3*Kt)),r(`vcf.kybd`,`Kybd`,0,1,``,i((t,n)=>e.setParam(t(`keyFollow`),`gain`,n))),o(`vca.mode`,`VCA`,[`env`,`gate`],t=>this.eachVoice(n=>{e.setParam(n(`envAmp`),`gain`,+(t===`env`)),e.setParam(n(`gateAmp`),`gain`,+(t===`gate`))})),r(`vca.level`,`Level`,0,1,``,t=>e.setParam(`vcaLevel`,`gain`,t));let s=(t,n,a,o)=>r(`env.${t}`,n,a,o,`s`,i((n,r)=>e.setParam(n(`env`),t,r)),`log`);s(`attack`,`A`,.001,3),s(`decay`,`D`,.002,12),r(`env.sustain`,`S`,0,1,``,i((t,n)=>e.setParam(t(`env`),`sustain`,n))),s(`release`,`R`,.002,12),a(`chorus.i`,`Chorus I`,e=>{this.chorusI=e,this.applyChorus()}),a(`chorus.ii`,`Chorus II`,e=>{this.chorusII=e,this.applyChorus()}),r(`bend.dco`,`Bender DCO`,0,12,`st`,e=>{this.bendSemitones=e,this.setPitchBend(this.bend)}),r(`bend.vcf`,`Bender VCF`,0,1,``,e=>{this.bendFilter=e,this.setPitchBend(this.bend)}),r(`bend.lfo`,`Bender LFO`,0,1,``,e=>{this.lfoSensitivity=e,this.setModWheel(this.modWheelValue)}),a(`bend.lfoTrig`,`LFO trig`,e=>{this.lfoTrig=e,this.updateLfoGate()}),r(`master.portamento`,`Portamento`,0,1,``,t=>{this.portamento=t;let n=t*t*2.5;this.eachVoice(t=>e.setParam(t(`pitch`),`glide`,n))}),o(`assign.mode`,`Assign`,Ht,e=>this.applyMode(e)),r(`master.tune`,`Tune`,-50,50,`ct`,t=>e.setParam(`tune`,`offset`,t)),r(`master.volume`,`Volume`,0,1,``,t=>e.setParam(`volume`,`gain`,t)),a(`key.hold`,`Hold`,e=>{e||this.releaseLatched()}),o(`key.transpose`,`Key transpose`,Gt,()=>{})}applyPulseWidth(){let e=this.circuit;this.pwmSource===`man`?(e.setParam(`pwCv`,`offset`,1-2*((50-this.pwm*45)/100)),e.setParam(`lfoPw`,`gain`,0)):(e.setParam(`pwCv`,`offset`,0),e.setParam(`lfoPw`,`gain`,this.pwm*.9))}applyEnvDepth(){this.eachVoice(e=>this.circuit.setParam(e(`envDepth`),`gain`,this.envSign*this.envDepth*6*Kt))}applyChorus(){let e=this.circuit,t=this.chorusI,n=this.chorusII,r=t&&n?I.both:t?I.i:n?I.ii:void 0,i=r!==void 0,a=r??I.i;e.setParam(`chLfo`,`frequency`,a.rate),e.setParam(`chDepthL`,`gain`,a.depth),e.setParam(`chDepthR`,`gain`,-a.depth),e.setParam(`chWet`,`gain`,i?.7:0),e.setParam(`chDry`,`gain`,i?.75:1)}},nn={"env.attack":1,"env.decay":30,"env.sustain":0,"env.release":200,"env.keytrack":0,"env.velocity":.5,"env.legato":0,"gen.noise":1,"gen.cutoff":100,"gen.reso":.2,"gen.keytrack":.5,"gen.envAmt":0,"gen.onePole":0,"gen.gain":1.5,"fb.push":0,"fb.decay":2,"fb.release":.4,"sat.hardness":.3,"sat.symmetry":0,"patch.volume":.8,"delay.tune":0,"delay.fine":0,"delay.harmonics":0,"delay.split":0,"delay.splitPoint":.5,"delay.polarity":0,"filter.highpass":-36,"filter.lowpass":36,"filter.hpComp":1,"filter.lpComp":1,"voice.mode":`poly`,"voice.detune":12,"voice.glide":100,"voice.glideOn":0,"lfo.wave":`sine`,"lfo.rate":5,"lfo.sync":0,"lfo.division":`1/8`,"lfo.delay":0,"lfo.amount":0,"lfo.dest":`pitch`,"rev.mix":.25,"rev.bass":120,"rev.treble":8e3,"rev.size":`medium`,"rev.spread":.5},L=(e,t)=>({name:e,values:t}),R={"env.attack":60,"env.decay":200,"env.sustain":1,"env.release":250,"gen.noise":.06,"gen.gain":.3,"fb.push":1.2,"fb.decay":4,"fb.release":.3,"sat.hardness":.1,"filter.highpass":-36,"filter.lowpass":30},z={"gen.gain":1.9},rn=[[L(`Nylon Pluck`,{...z,"gen.cutoff":90,"gen.keytrack":.7,"fb.decay":1.8,"fb.release":.25,"filter.lowpass":30,"sat.hardness":.2,"rev.mix":.2}),L(`Steel String`,{...z,"gen.cutoff":120,"delay.harmonics":.12,"fb.decay":3.5,"fb.release":.35,"filter.lowpass":48,"sat.hardness":.4,"env.velocity":.7}),L(`Muted Bass`,{...z,"delay.tune":-12,"gen.cutoff":70,"gen.keytrack":.2,"fb.decay":.9,"fb.release":.15,"filter.lowpass":18,"filter.highpass":-48,"voice.mode":`mono`,"rev.mix":.08,"patch.volume":1}),L(`Harp`,{...z,"gen.cutoff":100,"gen.keytrack":.6,"delay.harmonics":.05,"fb.decay":5,"fb.release":.6,"filter.lowpass":36,"rev.size":`large`,"rev.mix":.35}),L(`Marimba`,{...z,"env.attack":1,"env.decay":20,"gen.cutoff":80,"delay.split":1,"delay.splitPoint":.4,"delay.harmonics":.4,"fb.decay":.7,"fb.release":.2,"filter.lowpass":24,"filter.highpass":-48,"rev.mix":.15}),L(`Glass Bell`,{...z,"delay.tune":12,"delay.split":1,"delay.splitPoint":.3,"delay.harmonics":.6,"fb.decay":6,"fb.release":2,"sat.hardness":.1,"filter.lowpass":60,"filter.highpass":-48,"rev.size":`large`,"rev.mix":.4}),L(`Wood Block`,{...z,"env.decay":15,"gen.gain":2,"delay.split":1,"delay.splitPoint":.5,"delay.harmonics":.2,"fb.decay":.25,"fb.release":.1,"filter.lowpass":40,"filter.highpass":-24,"rev.mix":.1}),L(`Kalimba`,{...z,"delay.tune":12,"gen.noise":.8,"delay.split":1,"delay.splitPoint":.6,"delay.harmonics":.3,"fb.decay":1.2,"fb.release":.3,"filter.lowpass":42,"filter.highpass":-48,"rev.mix":.3})],[L(`Pan Flute`,{...R,"delay.polarity":1,"voice.mode":`mono`,"env.legato":1,"voice.glideOn":1,"voice.glide":60,"lfo.amount":.12,"lfo.rate":5,"lfo.delay":.6,"lfo.dest":`pitch`,"rev.mix":.3}),L(`Clarinet`,{...R,"delay.polarity":1,"gen.noise":.1,"gen.gain":.35,"env.attack":30,"sat.hardness":.5,"filter.lowpass":36,"voice.mode":`mono`,"env.legato":1,"rev.mix":.2}),L(`Reed Organ`,{...R,"gen.noise":.08,"env.attack":40,"env.release":200,"sat.hardness":.6,"sat.symmetry":.2,"filter.lowpass":40,"rev.mix":.25}),L(`Pipe Organ`,{...R,"gen.noise":.05,"env.attack":80,"env.release":500,"filter.lowpass":24,"rev.size":`large`,"rev.mix":.45}),L(`Brass`,{...R,"gen.noise":.1,"gen.gain":.5,"env.attack":80,"env.decay":200,"env.sustain":.7,"sat.hardness":.7,"sat.symmetry":.6,"filter.lowpass":42,"lfo.dest":`filter`,"lfo.amount":.1,"lfo.rate":6,"rev.mix":.2}),L(`Overblown`,{...R,"delay.polarity":1,"lfo.dest":`filter`,"lfo.amount":.6,"lfo.rate":.3,"lfo.wave":`sine`,"rev.mix":.3}),L(`Steam Drone`,{...R,"env.attack":1500,"env.release":3e3,"gen.noise":.2,"fb.decay":20,"fb.release":3,"voice.mode":`unison`,"voice.detune":25,"rev.size":`large`,"rev.mix":.5,"rev.spread":1}),L(`Wind Chimes`,{"delay.tune":12,"delay.split":1,"delay.splitPoint":.2,"delay.harmonics":.5,"fb.decay":8,"fb.release":4,"filter.lowpass":54,"filter.highpass":-48,"sat.hardness":.05,"rev.size":`large`,"rev.mix":.5,"rev.spread":1})]].flat(),an=[`poly`,`mono`,`unison`],on=[`sine`,`tri`,`sqr`,`ramp`,`rnd`],sn=[`pitch`,`filter`,`steam`,`sat`,`push`],cn=[`1/1`,`1/2`,`1/4`,`1/8`,`1/16`,`1/32`],ln=1,un=64,dn=2,fn=.8,pn=3,mn=class extends x{name;transport;slots=[...rn];currentSlot=0;currentPreset=this.slots[0];held=[];bend=0;modWheelValue=0;lfoHz=5;lfoSync=!1;lfoDivision=`1/8`;clockPulses=0;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`Pipe`,t=new b){super(),this.name=e,this.transport=new ze(t),this.transport.channel.set(`omni`),this.circuit.add(`pipe`,`pipe`,{atk:.001,dec:.03,sus:0,rel:.2,envKey:0,vel:.5,legato:0,noise:1,nCut:100,nRes:.2,nKey:.5,nEnv:0,onePole:0,gain:.8,tune:0,fine:0,harm:0,split:0,splitPt:.5,pol:0,fbDec:2,fbRel:.4,push:0,satHard:.3,satSym:0,hp:-36,lp:36,hpComp:1,lpComp:1,mode:0,detune:12,glide:.1,glideOn:0,spread:.5,volume:.8,lfoRate:5,lfoShape:0,lfoDelay:0,lfoAmt:0,lfoDest:0,bend:0,mod:0}).add(`dry`,`gain`,{gain:1}).add(`revIn`,`gain`,{gain:1}).add(`conv`,`convolver`,{},{size:`medium`}).add(`revLow`,`filter`,{frequency:120,Q:.707,detune:0},{type:`highpass`}).add(`revHigh`,`filter`,{frequency:8e3,Q:.707,detune:0},{type:`lowpass`}).add(`wet`,`gain`,{gain:0}).add(`sum`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`pipe`,`dry`).connect(`pipe`,`revIn`).connect(`revIn`,`conv`).connect(`conv`,`revLow`).connect(`revLow`,`revHigh`).connect(`revHigh`,`wet`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`}),this.addControls(),this.transport.tempo.onChange(()=>this.applyLfoRate())}addControls(){let e=this.circuit,t=nn,n=(e,n,r,i,a,o,s)=>this.controlList.push(new S(e,n,r,i,t[e],a,o,s)),r=(t,r,i,a,o,s,c=1,l)=>n(t,r,i,a,o,t=>e.setParam(`pipe`,s,t*c),l),i=(n,r,i)=>this.controlList.push(new w(n,r,(t[n]??0)>0,t=>e.setParam(`pipe`,i,+!!t)));r(`env.attack`,`Attack`,.5,1e4,`ms`,`atk`,1/1e3,`log`),r(`env.decay`,`Decay`,1,1e4,`ms`,`dec`,1/1e3,`log`),r(`env.sustain`,`Sustain`,0,1,``,`sus`),r(`env.release`,`Release`,5,2e4,`ms`,`rel`,1/1e3,`log`),r(`env.keytrack`,`Keytrack`,0,1,``,`envKey`),r(`env.velocity`,`Velocity`,0,1,``,`vel`),i(`env.legato`,`Legato`,`legato`),r(`gen.noise`,`DC / Noise`,0,1,``,`noise`),r(`gen.cutoff`,`Cutoff`,30,140,`pitch`,`nCut`),r(`gen.reso`,`Resonance`,0,1,``,`nRes`),r(`gen.keytrack`,`Keytrack`,0,1,``,`nKey`),r(`gen.envAmt`,`Env amount`,-48,48,`st`,`nEnv`),r(`gen.gain`,`Gain`,0,2,``,`gain`),i(`gen.onePole`,`1-pole`,`onePole`),r(`fb.push`,`Push`,0,1.5,``,`push`),r(`fb.decay`,`Decay`,.05,30,`s`,`fbDec`,1,`log`),r(`fb.release`,`Release`,.02,20,`s`,`fbRel`,1,`log`),r(`sat.hardness`,`Soft / Hard`,0,1,``,`satHard`),r(`sat.symmetry`,`Symmetry`,0,1,``,`satSym`),r(`patch.volume`,`Volume`,0,1.2,``,`volume`),r(`delay.tune`,`Tune`,-24,24,`st`,`tune`),r(`delay.fine`,`Fine`,-100,100,`ct`,`fine`),r(`delay.harmonics`,`Harmonics`,0,1,``,`harm`),r(`delay.splitPoint`,`Split point`,.05,.95,``,`splitPt`),i(`delay.split`,`Split`,`split`),i(`delay.polarity`,`Polarity`,`pol`),r(`filter.highpass`,`Highpass`,-60,36,`st`,`hp`),r(`filter.lowpass`,`Lowpass`,0,84,`st`,`lp`),r(`filter.hpComp`,`HP comp`,0,1,``,`hpComp`),r(`filter.lpComp`,`LP comp`,0,1,``,`lpComp`),this.controlList.push(new C(`voice.mode`,`Mode`,an,`poly`,t=>{this.releaseAll(),e.setParam(`pipe`,`mode`,an.indexOf(t))})),r(`voice.detune`,`Detune`,0,100,`ct`,`detune`),r(`voice.glide`,`Glide`,1,5e3,`ms`,`glide`,1/1e3,`log`),i(`voice.glideOn`,`Glide on`,`glideOn`),this.controlList.push(new C(`lfo.wave`,`Wave`,on,`sine`,t=>e.setParam(`pipe`,`lfoShape`,on.indexOf(t))),new C(`lfo.dest`,`Destination`,sn,`pitch`,t=>e.setParam(`pipe`,`lfoDest`,sn.indexOf(t))),new C(`lfo.division`,`Division`,cn,`1/8`,e=>{this.lfoDivision=e,this.applyLfoRate()}),new w(`lfo.sync`,`Sync`,!1,e=>{this.lfoSync=e,this.applyLfoRate()})),n(`lfo.rate`,`Rate`,.05,40,`Hz`,e=>{this.lfoHz=e,this.applyLfoRate()},`log`),r(`lfo.delay`,`Delay`,0,5,`s`,`lfoDelay`),r(`lfo.amount`,`Amount`,0,1,``,`lfoAmt`),n(`rev.mix`,`Mix`,0,1,``,t=>{e.setParam(`dry`,`gain`,Math.cos(t*Math.PI/2)),e.setParam(`wet`,`gain`,Math.sin(t*Math.PI/2)*pn)}),n(`rev.bass`,`Bass`,20,800,`Hz`,t=>e.setParam(`revLow`,`frequency`,t),`log`),n(`rev.treble`,`Treble`,1500,16e3,`Hz`,t=>e.setParam(`revHigh`,`frequency`,t),`log`),r(`rev.spread`,`Spread`,0,1,``,`spread`),this.controlList.push(new C(`rev.size`,`Size`,We,`medium`,t=>e.setOption(`conv`,`size`,t)))}applyLfoRate(){let e=Number(this.lfoDivision.split(`/`)[1]),t=this.lfoSync?this.transport.bpm/60*e/4:this.lfoHz;this.circuit.setParam(`pipe`,`lfoRate`,Math.min(40,Math.max(.05,t)))}releaseAll(){this.circuit.allNotesOff(`pipe`),this.held.length>0&&(this.held=[],this.notifyNotes())}keyDown(e,t=fn){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.circuit.noteOn(`pipe`,e,t),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.circuit.noteOff(`pipe`,e),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}setSustain(e){this.circuit.pedal(`pipe`,e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`pipe`,`bend`,this.bend*dn),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`pipe`,`mod`,this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(e.type===`clock`)this.lfoSync&&this.transport.synced&&++this.clockPulses%24==0&&this.applyLfoRate();else if(`channel`in e&&this.transport.acceptsChannel(e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity/127);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===ln?this.setModWheel(e.value/127):e.controller===un&&this.setSustain(e.value>=64);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...nn,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}},hn={"osc.wave":`saw`,"osc.width":50,"osc.pwm":0,"osc.vibrato":0,"osc.sub":.3,"filter.cutoff":2400,"filter.resonance":1,"filter.env":2,"filter.lfo":0,"filter.key":50,"amp.lfo":0,"amp.key":0,level:.7,"lfo.wave":`tri`,"lfo.rate":5,"lfo.sync":0,"lfo.division":`1/8`,"env1.attack":.005,"env1.decay":.4,"env1.sustain":.4,"env1.release":.4,"env2.attack":.005,"env2.decay":.3,"env2.sustain":.7,"env2.release":.35,"voices.mode":`poly`,"voices.portamento":0,"voices.detune":12,"fx.chorus":0,"fx.delayTime":.35,"fx.feedback":.3,"fx.mix":0},B=(e,t)=>({name:e,values:t}),gn=[[B(`Soft Pad`,{"osc.sub":.2,"filter.cutoff":900,"filter.resonance":1.2,"filter.env":1.5,"filter.lfo":.3,"env1.attack":.6,"env1.decay":1.2,"env1.sustain":.5,"env1.release":1.5,"env2.attack":.5,"env2.decay":.8,"env2.sustain":.8,"env2.release":1.6,"lfo.rate":.4,"fx.chorus":.7,"fx.mix":.15,"fx.delayTime":.45,"fx.feedback":.35,level:.6}),B(`Warm Brass`,{"osc.sub":.3,"filter.cutoff":700,"filter.env":3.2,"osc.vibrato":8,"env1.attack":.12,"env1.decay":.5,"env1.sustain":.55,"env1.release":.25,"env2.attack":.06,"env2.decay":.3,"env2.sustain":.85,"env2.release":.2,"fx.chorus":.3}),B(`Pluck Bass`,{"voices.mode":`mono`,"osc.sub":.6,"filter.cutoff":350,"filter.resonance":4,"filter.env":3.5,"env1.attack":.001,"env1.decay":.22,"env1.sustain":0,"env1.release":.15,"env2.attack":.001,"env2.decay":.35,"env2.sustain":.5,"env2.release":.1,"voices.portamento":.05}),B(`Glass Keys`,{"osc.wave":`tri`,"osc.sub":0,"filter.cutoff":5200,"filter.resonance":.5,"filter.env":.5,"env1.attack":.001,"env1.decay":.8,"env1.sustain":.2,"env1.release":.6,"env2.attack":.002,"env2.decay":1.2,"env2.sustain":.1,"env2.release":.8,"fx.chorus":.45,"fx.mix":.2,"fx.delayTime":.3,"fx.feedback":.4}),B(`Slow Strings`,{"filter.cutoff":3e3,"filter.env":.6,"filter.key":70,"osc.vibrato":12,"lfo.rate":5.5,"env1.attack":.8,"env1.decay":1,"env1.sustain":.7,"env1.release":1.2,"env2.attack":.9,"env2.decay":1,"env2.sustain":.9,"env2.release":1.4,"fx.chorus":.8}),B(`Sweep Lead`,{"voices.mode":`mono`,"osc.wave":`pulse`,"osc.width":30,"osc.pwm":.4,"osc.sub":.2,"lfo.rate":.7,"filter.cutoff":1500,"filter.resonance":5,"filter.env":2.5,"env1.attack":.001,"env1.decay":.8,"env1.sustain":.35,"env1.release":.3,"env2.sustain":.9,"voices.portamento":.12,"fx.mix":.3,"fx.delayTime":.4,"fx.feedback":.45}),B(`Wobble Sub`,{"voices.mode":`mono`,"osc.sub":.8,"filter.cutoff":260,"filter.resonance":6,"filter.lfo":2.2,"filter.env":.5,"lfo.sync":1,"lfo.division":`1/8`,"env2.sustain":.95,level:.55}),B(`Bell Pluck`,{"osc.wave":`tri`,"osc.sub":0,"filter.cutoff":8e3,"filter.resonance":.3,"filter.env":.2,"osc.vibrato":4,"env1.attack":.001,"env1.decay":.5,"env1.sustain":0,"env1.release":.4,"env2.attack":.001,"env2.decay":1.6,"env2.sustain":0,"env2.release":1.4,"fx.chorus":.3,"fx.mix":.3,"fx.delayTime":.5,"fx.feedback":.5})],[B(`Init`,{}),B(`Analog Poly`,{"filter.cutoff":1800,"filter.resonance":1.5,"filter.env":2,"env1.attack":.01,"env1.decay":.5,"env1.sustain":.35,"env1.release":.4,"env2.attack":.01,"env2.decay":.4,"env2.sustain":.75,"env2.release":.4,"fx.chorus":.35}),B(`Choir Air`,{"osc.wave":`pulse`,"osc.width":40,"osc.pwm":.2,"filter.cutoff":1600,"filter.resonance":2.5,"filter.env":1,"env2.attack":.35,"env2.decay":.6,"env2.sustain":.85,"env2.release":1.1,"fx.chorus":.6,"fx.mix":.2}),B(`Retro Stab`,{"filter.cutoff":600,"filter.resonance":2,"filter.env":4,"env1.attack":.001,"env1.decay":.22,"env1.sustain":0,"env1.release":.2,"env2.attack":.001,"env2.decay":.25,"env2.sustain":0,"env2.release":.2,"fx.chorus":.5}),B(`Fifth Lead`,{"voices.mode":`unison`,"voices.detune":18,"filter.cutoff":2600,"filter.resonance":2,"filter.env":1.5,"env2.sustain":.8,"voices.portamento":.08,"fx.mix":.25}),B(`Dream Wash`,{"osc.sub":.4,"filter.cutoff":1100,"lfo.rate":.3,"filter.lfo":.4,"env1.attack":1.8,"env1.decay":1,"env1.sustain":.6,"env1.release":2.5,"env2.attack":1.5,"env2.decay":1,"env2.sustain":.85,"env2.release":3,"fx.chorus":.9,"fx.mix":.4,"fx.delayTime":.6,"fx.feedback":.6,level:.55}),B(`Pulse Organ`,{"osc.wave":`pulse`,"osc.width":50,"osc.sub":.5,"filter.cutoff":3200,"filter.resonance":.5,"filter.env":.3,"osc.vibrato":6,"lfo.rate":6.5,"env2.attack":.005,"env2.decay":.1,"env2.sustain":1,"env2.release":.08,"fx.chorus":.3}),B(`Space Arp`,{"osc.wave":`pulse`,"osc.width":25,"osc.pwm":.6,"lfo.rate":1.2,"filter.cutoff":1e3,"filter.resonance":3,"filter.env":3,"env1.attack":.001,"env1.decay":.25,"env1.sustain":.1,"env1.release":.2,"env2.attack":.002,"env2.decay":.3,"env2.sustain":.2,"env2.release":.25,"fx.mix":.4,"fx.delayTime":.38,"fx.feedback":.55,"fx.chorus":.2})]],_n=gn.flat(),vn=1200,yn=69,bn=200,xn=100,Sn=1,Cn=[`saw`,`pulse`,`tri`],wn=[`tri`,`up`,`down`,`sqr`,`rnd`],Tn=[`1/1`,`1/2`,`1/4`,`1/8`,`1/16`,`1/32`],En={poly:.45,mono:.6,unison:.34},Dn=.65,On=class extends x{name;transport;slots=[..._n];currentSlot=gn[0].length;currentPreset=this.slots[this.currentSlot];allocator=new Vt(6);held=[];bend=0;modWheelValue=0;vibratoCents=0;portamento=0;unisonDetune=12;lfoHz=5;lfoSync=!1;lfoDivision=`1/8`;clockPulses=0;performanceListeners=new Set;noteListeners=new Set;presetListeners=new Set;constructor(e=`Poly`,t=new b){super(),this.name=e,this.transport=new ze(t),this.transport.channel.set(`2`);let n=this.circuit;this.addShared(n);for(let e=0;e<6;e++)this.addVoice(n,e);this.addEffects(n),this.outputList.push({name:`out`,nodeId:`level`}),this.addControls(n),this.transport.tempo.onChange(()=>this.applyLfoRate())}keyDown(e){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.apply(this.allocator.noteOn(e)),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.apply(this.allocator.noteOff(e)),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}voiceActive(e){return this.allocator.isActive(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*bn),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.applyVibrato(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(e.type===`clock`)this.lfoSync&&this.transport.synced&&++this.clockPulses%24==0&&this.applyLfoRate();else if(!(`channel`in e&&!this.transport.acceptsChannel(e.channel)))switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===Sn&&this.setModWheel(e.value/127);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...hn,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e,t=this.slots[e].name){let n={name:t,values:this.snapshot()};this.slots[e]=n,this.currentSlot=e,this.currentPreset=n;for(let e of this.presetListeners)e();return n}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}apply(e){let t=this.circuit;for(let n of e){let e=e=>`v${n.voice}.${e}`;n.kind===`off`?(t.setParam(e(`env1`),`gate`,0),t.setParam(e(`env2`),`gate`,0)):(n.glide||t.setParam(e(`pitch`),`glide`,0),t.setParam(e(`pitch`),`offset`,(n.note-yn)*100),n.glide||t.setParam(e(`pitch`),`glide`,this.portamento),n.retrigger&&(t.setParam(e(`env1`),`gate`,1),t.setParam(e(`env2`),`gate`,1)))}}eachVoice(e){for(let t=0;t<6;t++)e(e=>`v${t}.${e}`)}applyMode(e){this.apply(this.allocator.releaseAll()),this.held=[],this.allocator.mode=e,this.eachVoice(t=>this.circuit.setParam(t(`out`),`gain`,En[e])),this.applyDetune(),this.notifyNotes()}applyDetune(){let e=this.allocator.mode===`unison`?this.unisonDetune:0,t=5/2;for(let n=0;n<6;n++){let r=(n-t)/t*e;this.circuit.setParam(`v${n}.det`,`offset`,r===0?0:r)}}applyVibrato(){this.circuit.setParam(`lfoPitch`,`gain`,this.vibratoCents+this.modWheelValue*xn)}applyLfoRate(){let e=Number(this.lfoDivision.split(`/`)[1]),t=this.lfoSync?this.transport.bpm/60*e/4:this.lfoHz;this.circuit.setParam(`lfoOsc`,`frequency`,t),this.circuit.setParam(`lfoRnd`,`rate`,t)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}addShared(e){e.add(`bend`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:-1200}).add(`pwCv`,`constant`,{offset:0}).add(`lfoOsc`,`oscillator`,{frequency:5,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:5}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoSign`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0}).add(`lfoAmp`,`gain`,{gain:0}).add(`voices`,`gain`,{gain:1}).connect(`lfoOsc`,`lfoOscOut`).connect(`lfoOscOut`,`lfoSign`).connect(`lfoSign`,`lfo`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoRndOut`,`lfo`);for(let t of[`lfoPitch`,`lfoPw`,`lfoFilter`,`lfoAmp`])e.connect(`lfo`,t)}addVoice(e,t){let n=e=>`v${t}.${e}`;e.add(n(`pitch`),`constant`,{offset:0,glide:0}).add(n(`det`),`constant`,{offset:0}).add(n(`osc`),`oscillator`,{frequency:440,detune:0},{waveform:`sawtooth`}).add(n(`sub`),`oscillator`,{frequency:440,detune:0},{waveform:`square`}).add(n(`rawOut`),`gain`,{gain:1}).add(n(`pulseSum`),`gain`,{gain:1}).add(n(`shaper`),`waveshaper`,{},{curve:`pulse`}).add(n(`pulseOut`),`gain`,{gain:0}).add(n(`subLevel`),`gain`,{gain:0}).add(n(`mix`),`gain`,{gain:.5}).add(n(`f1`),`filter`,{frequency:2400,Q:1,detune:0},{type:`lowpass`}).add(n(`f2`),`filter`,{frequency:2400,Q:.707,detune:0},{type:`lowpass`}).add(n(`keyFollow`),`gain`,{gain:.5}).add(n(`env1`),`envelope`,{attack:.005,decay:.4,sustain:.4,release:.4,gate:0}).add(n(`env1Depth`),`gain`,{gain:2*vn}).add(n(`env2`),`envelope`,{attack:.005,decay:.3,sustain:.7,release:.35,gate:0}).add(n(`amp`),`gain`,{gain:0}).add(n(`trem`),`gain`,{gain:1}).add(n(`ampKey`),`gain`,{gain:0}).add(n(`out`),`gain`,{gain:En.poly});for(let t of[`osc`,`sub`])e.connect(n(`pitch`),n(t),`detune`).connect(n(`det`),n(t),`detune`).connect(`bend`,n(t),`detune`).connect(`lfoPitch`,n(t),`detune`);e.connect(`subShift`,n(`sub`),`detune`).connect(n(`osc`),n(`rawOut`)).connect(n(`osc`),n(`pulseSum`)).connect(`pwCv`,n(`pulseSum`)).connect(`lfoPw`,n(`pulseSum`)).connect(n(`pulseSum`),n(`shaper`)).connect(n(`shaper`),n(`pulseOut`)).connect(n(`rawOut`),n(`mix`)).connect(n(`pulseOut`),n(`mix`)).connect(n(`sub`),n(`subLevel`)).connect(n(`subLevel`),n(`mix`)).connect(n(`mix`),n(`f1`)).connect(n(`f1`),n(`f2`)).connect(n(`f2`),n(`amp`)).connect(n(`env1`),n(`env1Depth`)).connect(n(`pitch`),n(`keyFollow`));for(let t of[`f1`,`f2`])e.connect(n(`env1Depth`),n(t),`detune`).connect(n(`keyFollow`),n(t),`detune`).connect(`lfoFilter`,n(t),`detune`);e.connect(n(`env2`),n(`amp`),`gain`).connect(n(`amp`),n(`trem`)).connect(`lfoAmp`,n(`trem`),`gain`).connect(n(`pitch`),n(`ampKey`)).connect(n(`ampKey`),n(`trem`),`gain`).connect(n(`trem`),n(`out`)).connect(n(`out`),`voices`)}addEffects(e){e.add(`chorusDry`,`gain`,{gain:1}).add(`chorusWet`,`gain`,{gain:0}).add(`chDelayA`,`delay`,{delayTime:.016,maxTime:.05}).add(`chDelayB`,`delay`,{delayTime:.024,maxTime:.05}).add(`chLfoA`,`oscillator`,{frequency:.62,detune:0},{waveform:`sine`}).add(`chLfoB`,`oscillator`,{frequency:.83,detune:0},{waveform:`sine`}).add(`chDepthA`,`gain`,{gain:.0025}).add(`chDepthB`,`gain`,{gain:.003}).add(`fxMix`,`gain`,{gain:1}).connect(`voices`,`chorusDry`).connect(`chorusDry`,`fxMix`).connect(`voices`,`chDelayA`).connect(`voices`,`chDelayB`).connect(`chDelayA`,`chorusWet`).connect(`chDelayB`,`chorusWet`).connect(`chorusWet`,`fxMix`).connect(`chLfoA`,`chDepthA`).connect(`chDepthA`,`chDelayA`,`delayTime`).connect(`chLfoB`,`chDepthB`).connect(`chDepthB`,`chDelayB`,`delayTime`),e.add(`dlyLine`,`delay`,{delayTime:.35,maxTime:1.5}).add(`dlyTone`,`filter`,{frequency:4500,Q:.707,detune:0},{type:`lowpass`}).add(`dlyFb`,`gain`,{gain:.3}).add(`dlyWet`,`gain`,{gain:0}).add(`dlySum`,`gain`,{gain:1}).add(`level`,`gain`,{gain:.7}).connect(`fxMix`,`dlySum`).connect(`fxMix`,`dlyLine`).connect(`dlyLine`,`dlyTone`).connect(`dlyTone`,`dlyFb`).connect(`dlyFb`,`dlyLine`).connect(`dlyTone`,`dlyWet`).connect(`dlyWet`,`dlySum`).connect(`dlySum`,`level`)}addControls(e){let t=(e,t,n,r,i,a,o,s)=>this.controlList.push(new S(e,t,n,r,i,a,o,s)),n=e=>t=>this.eachVoice(n=>e(n,t)),r=hn,i=e=>r[e],a=(r,a,o,s,c)=>t(`${r}.${a}`,o,s,c,i(`${r}.${a}`),`s`,n((t,n)=>e.setParam(t(r),a,n)),`log`),o=r=>t(`${r}.sustain`,`Sustain`,0,1,i(`${r}.sustain`),``,n((t,n)=>e.setParam(t(r),`sustain`,n)));this.controlList.push(new C(`osc.wave`,`Wave`,Cn,r[`osc.wave`],t=>this.eachVoice(n=>{e.setOption(n(`osc`),`waveform`,t===`tri`?`triangle`:`sawtooth`),e.setParam(n(`rawOut`),`gain`,t===`pulse`?0:1),e.setParam(n(`pulseOut`),`gain`,t===`pulse`?Dn:0)}))),t(`osc.width`,`Width`,5,50,i(`osc.width`),`%`,t=>e.setParam(`pwCv`,`offset`,1-2*t/100)),t(`osc.pwm`,`LFO PWM`,0,100,i(`osc.pwm`)*100,`%`,t=>e.setParam(`lfoPw`,`gain`,t/100*.9)),t(`osc.vibrato`,`LFO Pitch`,0,100,i(`osc.vibrato`),`ct`,e=>{this.vibratoCents=e,this.applyVibrato()}),t(`osc.sub`,`Sub`,0,1,i(`osc.sub`),``,n((t,n)=>e.setParam(t(`subLevel`),`gain`,n*.6))),t(`filter.cutoff`,`Cutoff`,20,2e4,i(`filter.cutoff`),`Hz`,n((t,n)=>{e.setParam(t(`f1`),`frequency`,n),e.setParam(t(`f2`),`frequency`,n)}),`log`),t(`filter.resonance`,`Resonance`,.1,20,i(`filter.resonance`),``,n((t,n)=>e.setParam(t(`f1`),`Q`,n))),t(`filter.env`,`Env 1`,0,6,i(`filter.env`),`oct`,n((t,n)=>e.setParam(t(`env1Depth`),`gain`,n*vn))),t(`filter.lfo`,`LFO`,0,4,i(`filter.lfo`),`oct`,t=>e.setParam(`lfoFilter`,`gain`,t*vn)),t(`filter.key`,`Key track`,0,100,i(`filter.key`),`%`,n((t,n)=>e.setParam(t(`keyFollow`),`gain`,n/100))),t(`amp.lfo`,`LFO`,0,100,i(`amp.lfo`),`%`,t=>e.setParam(`lfoAmp`,`gain`,t/100*.8)),t(`amp.key`,`Key track`,0,100,i(`amp.key`),`%`,n((t,n)=>e.setParam(t(`ampKey`),`gain`,n/100/6e3))),t(`level`,`Volume`,0,1,i(`level`),``,t=>e.setParam(`level`,`gain`,t)),this.controlList.push(new C(`lfo.wave`,`Wave`,wn,r[`lfo.wave`],t=>{e.setOption(`lfoOsc`,`waveform`,t===`sqr`?`square`:t===`up`||t===`down`?`sawtooth`:`triangle`),e.setParam(`lfoSign`,`gain`,t===`down`?-1:1),e.setParam(`lfoOscOut`,`gain`,t===`rnd`?0:1),e.setParam(`lfoRndOut`,`gain`,+(t===`rnd`))})),t(`lfo.rate`,`Rate`,.1,30,i(`lfo.rate`),`Hz`,e=>{this.lfoHz=e,this.applyLfoRate()},`log`),this.controlList.push(new w(`lfo.sync`,`Sync`,!1,e=>{this.lfoSync=e,this.applyLfoRate()}),new C(`lfo.division`,`Division`,Tn,r[`lfo.division`],e=>{this.lfoDivision=e,this.applyLfoRate()}));for(let e of[`env1`,`env2`])a(e,`attack`,`Attack`,.001,5),a(e,`decay`,`Decay`,.005,5),o(e),a(e,`release`,`Release`,.005,10);this.controlList.push(new C(`voices.mode`,`Mode`,Bt,r[`voices.mode`],e=>this.applyMode(e))),t(`voices.portamento`,`Portamento`,0,2,i(`voices.portamento`),`s`,t=>{this.portamento=t,this.eachVoice(n=>e.setParam(n(`pitch`),`glide`,t))}),t(`voices.detune`,`Detune`,0,50,i(`voices.detune`),`ct`,e=>{this.unisonDetune=e,this.applyDetune()}),t(`fx.chorus`,`Chorus`,0,1,i(`fx.chorus`),``,t=>{e.setParam(`chorusWet`,`gain`,t*.7),e.setParam(`chorusDry`,`gain`,1-t*.25)}),t(`fx.delayTime`,`Delay time`,.01,1,i(`fx.delayTime`),`s`,t=>e.setParam(`dlyLine`,`delayTime`,t),`log`),t(`fx.feedback`,`Feedback`,0,.9,i(`fx.feedback`),``,t=>e.setParam(`dlyFb`,`gain`,t)),t(`fx.mix`,`Delay mix`,0,1,i(`fx.mix`),``,t=>e.setParam(`dlyWet`,`gain`,t))}},kn={"spring.length":2,"spring.tension":.5,"spring.drip":.6,"spring.tilt":0,"spring.dwell":.4,"spring.mix":.25},An=1.6,jn=class extends x{name;constructor(e=`Spring`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`spring`,`spring`,{tension:.5,drip:.6,decay:2,tilt:0,dwell:.4}).add(`dry`,`gain`,{gain:1}).add(`wet`,`gain`,{gain:0}).add(`sum`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`spring`).connect(`in`,`dry`).connect(`spring`,`wet`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=(e,t,n,r,i,a,o)=>this.controlList.push(new S(e,t,n,r,kn[e],i,a,o));n(`spring.length`,`Length`,.2,8,`s`,e=>t.setParam(`spring`,`decay`,e),`log`),n(`spring.tension`,`Tension`,0,1,``,e=>t.setParam(`spring`,`tension`,e)),n(`spring.drip`,`Drip`,0,1,``,e=>t.setParam(`spring`,`drip`,e)),n(`spring.tilt`,`Tilt`,-1,1,``,e=>t.setParam(`spring`,`tilt`,e)),n(`spring.dwell`,`Dwell`,0,1,``,e=>t.setParam(`spring`,`dwell`,e)),n(`spring.mix`,`Dry / wet`,0,1,``,e=>{t.setParam(`dry`,`gain`,Math.cos(e*Math.PI/2)),t.setParam(`wet`,`gain`,Math.sin(e*Math.PI/2)*An)})}reset(){for(let e of this.controlList)e.kind===`number`&&e.set(e.initial)}},Mn=75,Nn=10,Pn=15,Fn=[`A`,`B`,`C`],In=[[1,2],[3,4],[5,6]],Ln=class extends x{channelCount;returnCount;returnFeeds;lineCount;name;muted=new Set;soloed=new Set;constructor(e=1,t=`Mixer`,n=0,r={},i=0){super(),this.channelCount=e,this.returnCount=n,this.returnFeeds=r,this.lineCount=i,this.name=t;let a=this.circuit;a.add(`main`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`ceiling`,`waveshaper`,{},{curve:`limit`}).add(`mainMeter`,`meter`,{},{channel:`mono`}).connect(`main`,`limiter`).connect(`limiter`,`ceiling`).connect(`ceiling`,`mainMeter`),this.outputList.push({name:`main`,nodeId:`ceiling`}),a.add(`key`,`gain`,{gain:1}),this.outputList.push({name:`key`,nodeId:`key`}),this.meterList.push({name:`main`,nodeId:`mainMeter`});for(let e of Fn){let t=`bus${e}`;a.add(t,`gain`,{gain:1}).add(`${t}.toMain`,`gain`,{gain:1}).add(`${t}.meterL`,`meter`,{},{channel:`left`}).add(`${t}.meterR`,`meter`,{},{channel:`right`}).connect(t,`${t}.toMain`).connect(`${t}.toMain`,`main`).connect(t,`${t}.meterL`).connect(t,`${t}.meterR`),this.outputList.push({name:t,nodeId:t}),this.meterList.push({name:`${t}.L`,nodeId:`${t}.meterL`},{name:`${t}.R`,nodeId:`${t}.meterR`}),this.controlList.push(new S(`${t}.fader`,`Bus ${e}`,0,1.5,1,``,e=>a.setParam(t,`gain`,e)),new w(`${t}.main`,`To main`,!0,e=>a.setParam(`${t}.toMain`,`gain`,+!!e)))}for(let e=1;e<=6;e++)a.add(`aux${e}`,`gain`,{gain:1}),this.outputList.push({name:`aux${e}`,nodeId:`aux${e}`}),this.controlList.push(new S(`aux${e}.master`,`Aux ${e}`,0,1.5,1,``,t=>a.setParam(`aux${e}`,`gain`,t)));for(let t=1;t<=e;t++)this.addStrip(`ch${t}`,t,`channel`);for(let e=1;e<=n;e++)this.addStrip(`ret${e}`,e,`return`);for(let e=1;e<=i;e++)this.addStrip(`line${e}`,e,`line`);this.controlList.push(new C(`key.source`,`Key source`,[`off`,...Array.from({length:e},(e,t)=>`${t+1}`)],`off`,t=>{for(let n=1;n<=e;n++)a.setParam(`ch${n}.keySend`,`gain`,+(t===`${n}`))}))}addStrip(e,t,n){let r=this.circuit,i=n!==`channel`,a=t=>`${e}.${t}`;r.add(a(`lowcut`),`filter`,{frequency:Nn,Q:.707,gain:0},{type:`highpass`}).add(a(`eqLow`),`filter`,{frequency:80,Q:.707,gain:0},{type:`lowshelf`}).add(a(`eqMid`),`filter`,{frequency:2500,Q:1,gain:0},{type:`peaking`}).add(a(`eqHigh`),`filter`,{frequency:12e3,Q:.707,gain:0},{type:`highshelf`}).add(a(`drive`),`gain`,{gain:1/3}).add(a(`sat`),`waveshaper`,{},{curve:`warm`}).add(a(`mute`),`gain`,{gain:1}).add(a(`fader`),`gain`,{gain:.8}).add(a(`pan`),`pan`,{pan:0}).connect(a(`lowcut`),a(`eqLow`)).connect(a(`eqLow`),a(`eqMid`)).connect(a(`eqMid`),a(`eqHigh`)).connect(a(`eqHigh`),a(`drive`)).connect(a(`drive`),a(`sat`)).connect(a(`sat`),a(`mute`)).connect(a(`mute`),a(`fader`)).connect(a(`fader`),a(`pan`)),i?(r.add(a(`meterL`),`meter`,{},{channel:`left`}).add(a(`meterR`),`meter`,{},{channel:`right`}).connect(a(`pan`),a(`meterL`)).connect(a(`pan`),a(`meterR`)),this.meterList.push({name:`${e}.L`,nodeId:a(`meterL`)},{name:`${e}.R`,nodeId:a(`meterR`)})):(r.add(a(`meter`),`meter`,{},{channel:`mono`}).connect(a(`fader`),a(`meter`)).add(a(`keySend`),`gain`,{gain:0}).connect(a(`mute`),a(`keySend`)).connect(a(`keySend`),`key`),this.meterList.push({name:e,nodeId:a(`meter`)})),this.inputList.push({name:e,nodeId:a(`lowcut`)});let o=Fn.filter(e=>n!==`return`||this.returnFeeds[t]!==e);for(let e of o)r.add(a(`assign${e}`),`gain`,{gain:0}).connect(a(`pan`),a(`assign${e}`)).connect(a(`assign${e}`),`bus${e}`);for(let e=1;e<=6;e++)r.add(a(`aux${e}.pre`),`gain`,{gain:0}).add(a(`aux${e}.post`),`gain`,{gain:1}).add(a(`aux${e}`),`gain`,{gain:0}).connect(a(`mute`),a(`aux${e}.pre`)).connect(a(`fader`),a(`aux${e}.post`)).connect(a(`aux${e}.pre`),a(`aux${e}`)).connect(a(`aux${e}.post`),a(`aux${e}`)).connect(a(`aux${e}`),`aux${e}`);let s=(e,t,n,r,i,o,s,c)=>new S(a(e),t,n,r,i,o,s,c),c=(e,t,n)=>s(e,t,-15,Pn,0,`dB`,e=>r.setParam(a(n),`gain`,e));this.controlList.push(new w(a(`lowcutOn`),`Low cut`,!1,e=>r.setParam(a(`lowcut`),`frequency`,e?Mn:Nn)),c(`eqHigh`,`High`,`eqHigh`),c(`eqMid`,`Mid`,`eqMid`),s(`eqMidFreq`,`Freq`,100,8e3,2500,`Hz`,e=>r.setParam(a(`eqMid`),`frequency`,e),`log`),c(`eqLow`,`Low`,`eqLow`));for(let e=1;e<=6;e++)this.controlList.push(s(`aux${e}`,`${e}`,0,1,0,``,t=>r.setParam(a(`aux${e}`),`gain`,t)));for(let[e,t]of In)this.controlList.push(new w(a(`auxPre${e}${t}`),`Pre ${e}-${t}`,!1,n=>{for(let i of[e,t])r.setParam(a(`aux${i}.pre`),`gain`,+!!n),r.setParam(a(`aux${i}.post`),`gain`,+!n)}));this.controlList.push(s(`pan`,i?`Balance`:`Pan`,-1,1,0,``,e=>r.setParam(a(`pan`),`pan`,e))),i?this.controlList.push(new w(a(`mute`),`Mute`,!1,e=>r.setParam(a(`mute`),`gain`,+!e))):this.controlList.push(new w(a(`mute`),`Mute`,!1,e=>this.setFlag(this.muted,t,e)),new w(a(`solo`),`Solo`,!1,e=>this.setFlag(this.soloed,t,e)));for(let e of o)this.controlList.push(new w(a(`bus${e}`),e,e===`A`,t=>r.setParam(a(`assign${e}`),`gain`,+!!t)));this.controlList.push(s(`fader`,`Fader`,0,1.5,.8,``,e=>r.setParam(a(`fader`),`gain`,e)))}get soloActive(){return this.soloed.size>0}setFlag(e,t,n){n?e.add(t):e.delete(t);for(let e=1;e<=this.channelCount;e++){let t=`ch${e}.mute`;if(!this.circuit.nodes.has(t))continue;let n=this.muted.has(e)||this.soloed.size>0&&!this.soloed.has(e);this.circuit.setParam(t,`gain`,+!n)}}},Rn={"osc.range":`8'`,"osc.width":50,"osc.pwSource":`man`,"osc.pwm":0,"osc.mod":0,"osc.sub":`-1`,"mix.saw":.8,"mix.pulse":0,"mix.sub":.55,"mix.noise":.05,"filter.cutoff":800,"filter.resonance":1,"filter.keyFollow":50,"filter.lfo":0,"filterEnv.amount":2,"filterEnv.attack":.005,"filterEnv.decay":.3,"filterEnv.sustain":.3,"filterEnv.release":.3,"ampEnv.attack":.005,"ampEnv.decay":.2,"ampEnv.sustain":.7,"ampEnv.release":.3,"lfo.wave":`tri`,"lfo.rate":4.8,"perf.glide":0,"perf.notes":`legato`,level:.5},V=(e,t)=>({name:e,values:t}),zn=[V(`Init`,{}),V(`Sub Bass`,{"osc.range":`16'`,"mix.saw":.5,"mix.sub":.95,"mix.noise":0,"filter.cutoff":380,"filter.resonance":2,"filter.keyFollow":30,"filterEnv.amount":1.5,"filterEnv.attack":.001,"filterEnv.decay":.25,"filterEnv.sustain":.2,"ampEnv.attack":.002,"ampEnv.decay":.3,"ampEnv.sustain":.85,"ampEnv.release":.12,level:.6}),V(`Acid Squelch`,{"osc.range":`16'`,"mix.saw":1,"mix.sub":.35,"mix.noise":0,"filter.cutoff":220,"filter.resonance":14,"filter.keyFollow":40,"filterEnv.amount":4,"filterEnv.attack":.001,"filterEnv.decay":.18,"filterEnv.sustain":0,"filterEnv.release":.1,"ampEnv.sustain":.9,"ampEnv.release":.08,"perf.glide":.08,level:.45}),V(`Fat Pulse Bass`,{"osc.range":`16'`,"osc.width":30,"mix.saw":0,"mix.pulse":.9,"mix.sub":.5,"mix.noise":0,"filter.cutoff":520,"filter.resonance":3,"filterEnv.amount":2,"filterEnv.decay":.3,"filterEnv.sustain":.2,"ampEnv.sustain":.85,"ampEnv.release":.1}),V(`Wobble Bass`,{"osc.range":`16'`,"mix.saw":.8,"mix.sub":.7,"mix.noise":0,"filter.cutoff":300,"filter.resonance":6,"filter.lfo":2,"filterEnv.amount":.5,"filterEnv.sustain":.5,"lfo.wave":`tri`,"lfo.rate":3,"ampEnv.sustain":1,"ampEnv.release":.12,level:.55}),V(`Funk Pluck`,{"osc.range":`8'`,"osc.width":25,"mix.saw":.3,"mix.pulse":.8,"mix.sub":.3,"mix.noise":0,"filter.cutoff":260,"filter.resonance":5,"filter.keyFollow":60,"filterEnv.amount":3.5,"filterEnv.attack":.001,"filterEnv.decay":.15,"filterEnv.sustain":0,"ampEnv.attack":.001,"ampEnv.decay":.2,"ampEnv.sustain":.3,"ampEnv.release":.1}),V(`Rubber Bass`,{"osc.range":`16'`,"mix.saw":.7,"mix.sub":.8,"mix.noise":0,"filter.cutoff":150,"filter.resonance":8,"filter.keyFollow":25,"filterEnv.amount":3,"filterEnv.attack":.001,"filterEnv.decay":.3,"filterEnv.sustain":.1,"ampEnv.sustain":.8,"ampEnv.release":.1,level:.55}),V(`Saw Lead`,{"mix.saw":1,"mix.sub":.2,"mix.noise":0,"filter.cutoff":3e3,"filter.resonance":3,"filter.keyFollow":70,"filterEnv.amount":1,"perf.glide":.06,"osc.mod":15,"lfo.rate":5.5,"ampEnv.sustain":.9,"ampEnv.release":.25}),V(`Hollow Pulse Lead`,{"osc.width":18,"mix.saw":0,"mix.pulse":1,"mix.sub":0,"mix.noise":0,"filter.cutoff":2500,"filter.resonance":2,"filter.keyFollow":80,"filterEnv.amount":1.5,"filterEnv.attack":.01,"filterEnv.decay":.4,"filterEnv.sustain":.5,"ampEnv.sustain":.8,"ampEnv.release":.2}),V(`PWM Lead`,{"mix.saw":.2,"mix.pulse":.9,"mix.sub":.2,"mix.noise":0,"osc.pwSource":`lfo`,"osc.pwm":70,"lfo.rate":1.2,"filter.cutoff":3e3,"filter.resonance":2,"filter.keyFollow":70,"filterEnv.amount":1,"ampEnv.sustain":.9,"ampEnv.release":.3}),V(`Vibrato Lead`,{"mix.saw":.8,"mix.pulse":.4,"mix.sub":.1,"mix.noise":0,"osc.mod":40,"lfo.rate":5.2,"filter.cutoff":2800,"filter.resonance":3,"filter.keyFollow":70,"filterEnv.amount":1.2,"perf.glide":.1,"ampEnv.attack":.01,"ampEnv.sustain":.9,"ampEnv.release":.3}),V(`Portamento Solo`,{"mix.saw":1,"mix.sub":.3,"mix.noise":0,"perf.glide":.35,"perf.notes":`legato`,"filter.cutoff":2200,"filter.resonance":4,"filterEnv.amount":.8,"filterEnv.sustain":.6,"ampEnv.sustain":1,"ampEnv.release":.2}),V(`Clarinet`,{"osc.width":50,"mix.saw":0,"mix.pulse":1,"mix.sub":0,"mix.noise":.03,"filter.cutoff":1800,"filter.resonance":1,"filter.keyFollow":70,"filterEnv.amount":1,"filterEnv.attack":.04,"filterEnv.sustain":.6,"ampEnv.attack":.04,"ampEnv.sustain":.9,"ampEnv.release":.12,"osc.mod":8,"lfo.rate":5}),V(`Brass`,{"mix.saw":1,"mix.pulse":.4,"mix.sub":.2,"mix.noise":0,"filter.cutoff":500,"filter.resonance":2,"filter.keyFollow":60,"filterEnv.amount":3,"filterEnv.attack":.12,"filterEnv.decay":.3,"filterEnv.sustain":.6,"ampEnv.attack":.08,"ampEnv.decay":.2,"ampEnv.sustain":.85,"ampEnv.release":.2}),V(`Siren`,{"mix.saw":1,"mix.sub":0,"mix.noise":0,"osc.mod":600,"lfo.wave":`tri`,"lfo.rate":.7,"filter.cutoff":4e3,"filter.resonance":2,"filterEnv.amount":0,"ampEnv.sustain":1,"ampEnv.release":.15}),V(`Random SFX`,{"mix.saw":.5,"mix.pulse":.5,"mix.sub":0,"mix.noise":0,"lfo.wave":`rnd`,"lfo.rate":9,"osc.mod":500,"filter.cutoff":1200,"filter.resonance":8,"filter.lfo":2.5,"filterEnv.amount":0,"ampEnv.attack":.01,"ampEnv.sustain":1,"ampEnv.release":.1,level:.45}),V(`Snare`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":1,"filter.cutoff":3e3,"filter.resonance":2,"filter.keyFollow":0,"filterEnv.amount":1,"filterEnv.attack":.001,"filterEnv.decay":.1,"filterEnv.sustain":0,"ampEnv.attack":.001,"ampEnv.decay":.18,"ampEnv.sustain":0,"ampEnv.release":.1,level:.6}),V(`Wind`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":1,"filter.cutoff":500,"filter.resonance":8,"filter.keyFollow":0,"filterEnv.amount":4,"filterEnv.attack":2,"filterEnv.decay":2,"filterEnv.sustain":.5,"filterEnv.release":2,"ampEnv.attack":1.5,"ampEnv.sustain":1,"ampEnv.release":2,level:.5}),V(`Whistle`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":.6,"filter.cutoff":2e3,"filter.resonance":20,"filter.keyFollow":100,"filterEnv.amount":0,"osc.mod":20,"lfo.rate":5,"ampEnv.attack":.05,"ampEnv.sustain":1,"ampEnv.release":.2,level:.35})],Bn=new Map([[70,`filter.cutoff`],[71,`filter.resonance`],[72,`filterEnv.amount`],[73,`filterEnv.decay`],[74,`ampEnv.decay`],[75,`ampEnv.release`],[76,`osc.width`],[77,`osc.pwm`],[78,`mix.pulse`],[79,`mix.sub`],[80,`mix.noise`],[81,`lfo.rate`],[82,`osc.mod`],[83,`perf.glide`]]);function Vn(e,t){let n=Math.min(127,Math.max(0,t))/127;if(e.kind===`number`)e.set(e.curve===`log`?e.min*(e.max/e.min)**+n:e.min+n*(e.max-e.min));else if(e.kind===`choice`){let t=Math.min(e.options.length-1,Math.floor(n*e.options.length));e.set(e.options[t])}else e.set(t>=64)}var Hn=1200,Un=200,Wn=100,Gn=1,H=440,Kn=4.8,qn=[`man`,`lfo`,`env`],Jn=[`legato`,`retrig`],Yn=[`tri`,`sqr`,`rnd`],Xn={"16'":-1200,"8'":0,"4'":1200,"2'":2400},Zn={"-1":-1200,"-2":-2400},Qn=class extends x{name;transport;ccMap=new Map(Bn);held=[];presetListeners=new Set;currentPreset=zn[0];gateOpen=!1;glideSeconds=0;retrigger=!1;pwSource=`man`;pwmAmount=0;bend=0;modWheelValue=0;oscModCents=0;performanceListeners=new Set;noteListeners=new Set;constructor(e=`Synth`,t=new b){super(),this.name=e,this.transport=new ze(t);let n=this.circuit;n.add(`pitch`,`constant`,{offset:0,glide:0}).add(`range`,`constant`,{offset:0}).add(`bend`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:Zn[-1]}).add(`pulseWidthCv`,`constant`,{offset:0}).add(`sawOsc`,`oscillator`,{frequency:H,detune:0},{waveform:`sawtooth`}).add(`pulseOsc`,`oscillator`,{frequency:H,detune:0},{waveform:`sawtooth`}).add(`pulseSum`,`gain`,{gain:1}).add(`pulseShaper`,`waveshaper`,{},{curve:`pulse`}).add(`subOsc`,`oscillator`,{frequency:H,detune:0},{waveform:`square`}).add(`noise`,`noise`).add(`mix.saw`,`gain`,{gain:.8}).add(`mix.pulse`,`gain`,{gain:0}).add(`mix.sub`,`gain`,{gain:.55}).add(`mix.noise`,`gain`,{gain:.05}).add(`mix`,`gain`,{gain:.5}).add(`filter1`,`filter`,{frequency:800,Q:1,detune:0},{type:`lowpass`}).add(`filter2`,`filter`,{frequency:800,Q:.707,detune:0},{type:`lowpass`}).add(`keyFollow`,`gain`,{gain:.5}).add(`amp`,`gain`,{gain:0}).add(`level`,`gain`,{gain:.5}).add(`ampEnv`,`envelope`,{attack:.005,decay:.2,sustain:.7,release:.3,gate:0}).add(`filterEnv`,`envelope`,{attack:.005,decay:.3,sustain:.3,release:.3,gate:0}).add(`filterEnvDepth`,`gain`,{gain:2*Hn}).add(`lfoOsc`,`oscillator`,{frequency:Kn,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:Kn}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`envPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0});for(let e of[`sawOsc`,`pulseOsc`,`subOsc`])n.connect(`pitch`,e,`detune`).connect(`range`,e,`detune`).connect(`bend`,e,`detune`);n.connect(`subShift`,`subOsc`,`detune`).connect(`pulseOsc`,`pulseSum`).connect(`pulseWidthCv`,`pulseSum`).connect(`pulseSum`,`pulseShaper`).connect(`sawOsc`,`mix.saw`).connect(`pulseShaper`,`mix.pulse`).connect(`subOsc`,`mix.sub`).connect(`noise`,`mix.noise`);for(let e of[`mix.saw`,`mix.pulse`,`mix.sub`,`mix.noise`])n.connect(e,`mix`);n.connect(`mix`,`filter1`).connect(`filter1`,`filter2`).connect(`filter2`,`amp`).connect(`amp`,`level`).connect(`ampEnv`,`amp`,`gain`).connect(`filterEnv`,`filterEnvDepth`).connect(`pitch`,`keyFollow`);for(let e of[`filter1`,`filter2`])n.connect(`filterEnvDepth`,e,`detune`).connect(`keyFollow`,e,`detune`).connect(`lfoFilter`,e,`detune`);for(let e of[`sawOsc`,`pulseOsc`,`subOsc`])n.connect(`lfoPitch`,e,`detune`);n.connect(`lfoOsc`,`lfoOscOut`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoOscOut`,`lfo`).connect(`lfoRndOut`,`lfo`).connect(`lfo`,`lfoPitch`).connect(`lfo`,`lfoPw`).connect(`lfo`,`lfoFilter`).connect(`lfoPw`,`pulseSum`).connect(`filterEnv`,`envPw`).connect(`envPw`,`pulseSum`),this.outputList.push({name:`out`,nodeId:`level`}),this.controlList.push(new C(`osc.range`,`Range`,Object.keys(Xn),`8'`,e=>n.setParam(`range`,`offset`,Xn[e])),new S(`osc.width`,`Width`,5,50,50,`%`,e=>n.setParam(`pulseWidthCv`,`offset`,1-2*e/100)),new C(`osc.sub`,`Sub`,Object.keys(Zn),`-1`,e=>n.setParam(`subShift`,`offset`,Zn[e])),er(n,`saw`,`Saw`,.8),er(n,`pulse`,`Pulse`,0),er(n,`sub`,`Sub`,.55),er(n,`noise`,`Noise`,.05),new S(`filter.cutoff`,`Cutoff`,20,2e4,800,`Hz`,e=>{n.setParam(`filter1`,`frequency`,e),n.setParam(`filter2`,`frequency`,e)},`log`),new S(`filter.resonance`,`Resonance`,.1,20,1,``,e=>n.setParam(`filter1`,`Q`,e)),new S(`filter.keyFollow`,`Key`,0,100,50,`%`,e=>n.setParam(`keyFollow`,`gain`,e/100)),new S(`perf.glide`,`Glide`,0,3,0,`s`,e=>{this.glideSeconds=e,n.setParam(`pitch`,`glide`,e)}),new C(`perf.notes`,`Notes`,Jn,`legato`,e=>{this.retrigger=e===`retrig`}),new C(`lfo.wave`,`Wave`,Yn,`tri`,e=>{n.setOption(`lfoOsc`,`waveform`,e===`sqr`?`square`:`triangle`),n.setParam(`lfoOscOut`,`gain`,e===`rnd`?0:1),n.setParam(`lfoRndOut`,`gain`,+(e===`rnd`))}),new S(`lfo.rate`,`Rate`,.1,30,Kn,`Hz`,e=>{n.setParam(`lfoOsc`,`frequency`,e),n.setParam(`lfoRnd`,`rate`,e)},`log`),new S(`osc.mod`,`Mod`,0,600,0,`ct`,e=>{this.oscModCents=e,this.applyVibrato()}),new C(`osc.pwSource`,`PW src`,qn,`man`,e=>{this.pwSource=e,this.applyPwm()}),new S(`osc.pwm`,`PWM`,0,100,0,`%`,e=>{this.pwmAmount=e/100,this.applyPwm()}),new S(`filter.lfo`,`LFO`,0,4,0,`oct`,e=>n.setParam(`lfoFilter`,`gain`,e*Hn)),new S(`level`,`Level`,0,1,.5,``,e=>n.setParam(`level`,`gain`,e)),new S(`filterEnv.amount`,`Amount`,0,6,2,`oct`,e=>n.setParam(`filterEnvDepth`,`gain`,e*Hn)),...$n(n,`filterEnv`,{attack:.005,decay:.3,sustain:.3,release:.3}),...$n(n,`ampEnv`,{attack:.005,decay:.2,sustain:.7,release:.3}))}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*Un),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.applyVibrato(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}applyVibrato(){this.circuit.setParam(`lfoPitch`,`gain`,this.oscModCents+this.modWheelValue*Wn)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}loadPreset(e){let t={...Rn,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}keyDown(e){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.noteOn(tr(e)),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e);let t=this.held[this.held.length-1];t===void 0?this.noteOff():this.noteOn(tr(t)),this.notifyNotes()}handleMidi(e){if(!(`channel`in e&&!this.transport.acceptsChannel(e.channel)))switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:{if(e.controller===Gn){this.setModWheel(e.value/127);break}let t=this.ccMap.get(e.controller);t&&Vn(this.control(t),e.value);break}case`programChange`:{let t=zn[e.program];t&&this.loadPreset(t);break}}}applyPwm(){let e=this.pwmAmount*.9;this.circuit.setParam(`lfoPw`,`gain`,this.pwSource===`lfo`?e:0),this.circuit.setParam(`envPw`,`gain`,this.pwSource===`env`?e:0)}noteOn(e){let t=this.gateOpen,n=this.glideSeconds;t||this.circuit.setParam(`pitch`,`glide`,0),this.circuit.setParam(`pitch`,`offset`,Hn*Math.log2(e/H)),t||this.circuit.setParam(`pitch`,`glide`,n),(!t||this.retrigger)&&(this.circuit.setParam(`ampEnv`,`gate`,1),this.circuit.setParam(`filterEnv`,`gate`,1)),this.gateOpen=!0}noteOff(){this.circuit.setParam(`ampEnv`,`gate`,0),this.circuit.setParam(`filterEnv`,`gate`,0),this.gateOpen=!1}};function $n(e,t,n){let r=(r,i,a,o)=>new S(`${t}.${r}`,i,a,o,n[r],`s`,n=>e.setParam(t,r,n),`log`);return[r(`attack`,`Attack`,.001,5),r(`decay`,`Decay`,.005,5),new S(`${t}.sustain`,`Sustain`,0,1,n.sustain,``,n=>e.setParam(t,`sustain`,n)),r(`release`,`Release`,.005,10)]}function er(e,t,n,r){return new S(`mix.${t}`,n,0,1,r,``,n=>e.setParam(`mix.${t}`,`gain`,n))}var tr=e=>H*2**((e-69)/12),nr=class e{devices=new Map;connections=[];output;extraOutputs=[];add(e,t){if(this.devices.has(e))throw Error(`Duplicate device id: ${e}`);return this.devices.set(e,t),this}device(e){let t=this.devices.get(e);if(!t)throw Error(`Unknown device: ${e}`);return t}connect(e,t){if(this.device(e.device).jack(`out`,e.jack),this.device(t.device).jack(`in`,t.jack),this.connections.some(n=>n.to.device===t.device&&n.to.jack===t.jack&&n.from.device===e.device&&n.from.jack===e.jack))throw Error(`Duplicate connection`);return this.connections.push({from:e,to:t}),this}setOutput(e,t){return this.device(e).jack(`out`,t),this.output={device:e,jack:t},this}addOutput(e,t){return this.device(e).jack(`out`,t),this.extraOutputs.push({device:e,jack:t}),this}static poly(t=new b){return new e().add(`poly`,new On(`Poly`,t)).setOutput(`poly`,`out`)}static drums(t=new b){let n=new e().add(`drums`,new Ue(`Drums`,t)).setOutput(`drums`,E[0]);for(let e of E.slice(1))n.addOutput(`drums`,e);return n}static synth(t=new b){return new e().add(`synth`,new Qn(`Synth`,t)).setOutput(`synth`,`out`)}static lynch(t=new b){return new e().add(`lynch`,new tn(`Lynch`,t)).setOutput(`lynch`,`out`)}static duo(){return new e().add(`duo`,new Et(`MOA-DUO`)).setOutput(`duo`,`out`)}static df2(t=new b){return new e().add(`lynch`,new tn(`Lynch`,t)).add(`box`,new Mt(`MOA-DF2`)).connect({device:`lynch`,jack:`out`},{device:`box`,jack:`in`}).setOutput(`box`,`out`)}static pipe(t=new b){return new e().add(`pipe`,new mn(`Pipe`,t)).add(`spring`,new jn(`Spring`)).connect({device:`pipe`,jack:`out`},{device:`spring`,jack:`in`}).setOutput(`spring`,`out`)}static mixerRack(){return e.wireRack(e.addRack(new e,4))}static default(t=new b){let n=new e().add(`synth`,new Qn(`Synth`,t)).add(`poly`,new On(`Poly`,t)).add(`drums`,new Ue(`Drums`,t));return e.addRack(n).connect({device:`synth`,jack:`out`},{device:`mixer`,jack:`ch1`}).connect({device:`poly`,jack:`out`},{device:`mixer`,jack:`ch2`}),E.forEach((e,t)=>n.connect({device:`drums`,jack:e},{device:`mixer`,jack:`ch${t+3}`})),e.wireRack(n)}static addRack(e,t=0){return e.add(`reverb`,new qe(`Reverb`)).add(`delay`,new Je(`Delay`)).add(`ouroboros`,new gt(`Ouroboros`)).add(`buscomp`,new Pe(`Bus Comp`)).add(`granular`,new rt(`Granular`)).add(`mixer`,new Ln(2+E.length,`Mixer`,5,{3:`C`,4:`B`},t))}static wireRack(e){e.connect({device:`mixer`,jack:`aux1`},{device:`reverb`,jack:`in`}).connect({device:`mixer`,jack:`aux2`},{device:`delay`,jack:`in`}).connect({device:`reverb`,jack:`out`},{device:`mixer`,jack:`ret1`}).connect({device:`delay`,jack:`out`},{device:`mixer`,jack:`ret2`}),e.connect({device:`mixer`,jack:`busC`},{device:`ouroboros`,jack:`in`}).connect({device:`ouroboros`,jack:`out`},{device:`mixer`,jack:`ret3`}),e.connect({device:`mixer`,jack:`busB`},{device:`buscomp`,jack:`in`}).connect({device:`mixer`,jack:`key`},{device:`buscomp`,jack:`key`}).connect({device:`buscomp`,jack:`out`},{device:`mixer`,jack:`ret4`}),e.connect({device:`mixer`,jack:`aux3`},{device:`granular`,jack:`in`}).connect({device:`granular`,jack:`out`},{device:`mixer`,jack:`ret5`});let t=e.device(`mixer`);return t.control(`busC.main`).set(!1),t.control(`busB.main`).set(!1),t.control(`key.source`).set(`3`),e.setOutput(`mixer`,`main`)}},rr=1e3;function ir(e){let t=e.curve===`log`?Math.log(e.value/e.min)/Math.log(e.max/e.min):(e.value-e.min)/(e.max-e.min);return Math.round(t*rr)}function ar(e,t){let n=t/rr;return e.curve===`log`?e.min*(e.max/e.min)**+n:e.min+n*(e.max-e.min)}function or(e){let t=e.value;return`${t>=100?t.toFixed(0):t>=10?t.toFixed(1):t>=1?t.toFixed(2):t.toFixed(3)}${e.unit?` `+e.unit:``}`}function U(e,t,n){let r=document.createElement(e);return t&&(r.className=t),n!==void 0&&(r.textContent=n),r}var sr=270,cr=160,lr=600,ur=131.95;function dr(e,t,n=e.label){return{label:n,color:t,get:()=>ir(e)/rr,set:t=>e.set(ar(e,Math.round(Math.min(1,Math.max(0,t))*rr))),reset:()=>e.set(e.initial),text:()=>or(e),subscribe:t=>e.onChange(t)}}var fr=(e,t)=>{let n=Math.round((-135+e*sr)*10)/10;return`<svg aria-hidden="true" width="72" height="72" viewBox="0 0 80 80">
    <path d="M16.34 64.42 A34 34 0 1 1 63.66 64.42" fill="none" stroke="#6b6f75" stroke-width="4" stroke-dasharray="1.2 14.8"></path>
    <path d="M20.2 59.8 A28 28 0 1 1 59.8 59.8" fill="none" stroke="#33363b" stroke-width="3"></path>
    <path d="M20.2 59.8 A28 28 0 1 1 59.8 59.8" fill="none" stroke="${t}" stroke-width="3" stroke-dasharray="${(e*ur).toFixed(1)} 200"></path>
    <circle cx="40" cy="40" r="22" fill="#101112" stroke="#4a4e54" stroke-width="1.5"></circle>
    <circle cx="40" cy="40" r="15" fill="#25282c" stroke="#3a3d42" stroke-width="1"></circle>
    <rect x="38.8" y="21.5" width="2.4" height="15" rx="1.2" fill="#f1eee6" transform="rotate(${n} 40 40)"></rect>
  </svg>`};function pr(e,t,n=fr){let r=U(`div`,`dial`),i=U(`div`,`dial-face`);i.tabIndex=0,i.setAttribute(`role`,`slider`),i.setAttribute(`aria-label`,`${t} ${e.label}`),i.setAttribute(`aria-orientation`,`vertical`),i.setAttribute(`aria-valuemin`,`0`),i.setAttribute(`aria-valuemax`,`100`);let a=U(`div`,`dial-label`,e.label),o=U(`div`,`dial-value`),s=()=>{let t=e.get();i.innerHTML=n(t,e.color),o.textContent=e.text(),i.setAttribute(`aria-valuenow`,String(Math.round(t*100))),i.setAttribute(`aria-valuetext`,o.textContent)},c=t=>{e.set(Math.min(1,Math.max(0,t))),s()},l;i.addEventListener(`pointerdown`,t=>{t.preventDefault(),i.focus(),i.setPointerCapture(t.pointerId),l={y:t.clientY,t:e.get()}}),i.addEventListener(`pointermove`,e=>{l&&c(l.t+(l.y-e.clientY)/(e.shiftKey?lr:cr))});let u=()=>{l=void 0};return i.addEventListener(`pointerup`,u),i.addEventListener(`pointercancel`,u),i.addEventListener(`dblclick`,()=>{e.reset(),s()}),i.addEventListener(`keydown`,t=>{let n=(t.shiftKey?5:1)*(e.step??.02),r=e.get(),i={ArrowUp:r+n,ArrowRight:r+n,ArrowDown:r-n,ArrowLeft:r-n,Home:0,End:1};t.key in i&&(t.preventDefault(),c(i[t.key]))}),e.subscribe(s),s(),r.append(i,a,o),r}var W={x:25,y:18,w:1965,h:1167},mr=`<svg class="duo-decor" viewBox="25 18 1965 1167" aria-hidden="true" focusable="false">
    <!-- outlines -->
    <g fill="none" stroke="#e6e6e2" stroke-width="5" stroke-linejoin="round">
      <rect x="85" y="58" width="547" height="234" rx="30"/>
      <rect x="658" y="58" width="582" height="238" rx="36" stroke-width="9"/>
      <rect x="1264" y="58" width="316" height="238" rx="28"/>
      <rect x="85" y="324" width="547" height="772" rx="30"/>
      <path d="M690 324 H1210 Q1240 324 1240 354 V740 Q1240 770 1270 770 H1346 Q1378 770 1378 800 V1066 Q1378 1096 1348 1096 H688 Q658 1096 658 1066 V356 Q658 324 690 324 Z"/>
      <path d="M1292 324 H1552 Q1580 324 1580 352 V1068 Q1580 1096 1552 1096 H1406 Q1378 1096 1378 1068 V798 Q1378 770 1346 770 H1292 Q1264 770 1264 742 V352 Q1264 324 1292 324 Z"/>
    </g>
    <!-- routing strips -->
    <rect x="272" y="128" width="80" height="162" rx="8" fill="#cfcfcf"/>
    <rect x="362" y="128" width="80" height="162" rx="8" fill="#cfcfcf"/>
    <g fill="none" stroke="#e6e6e2" stroke-width="3"><path d="M215 148 H245 L272 148 M215 185 H255 L272 185 M215 222 H245 L272 222 M215 260 H245 L272 260"/><path d="M442 148 H470 M442 185 H470 M442 222 H470 M442 260 H470"/></g>
    <g fill="#141414" font-size="25" text-anchor="middle" letter-spacing="1"><text x="312" y="154">NOR</text><text x="312" y="191">SPLIT</text><text x="312" y="228">HALF</text><text x="312" y="267">VCA</text><text x="402" y="154">LPF</text><text x="402" y="191">HPF</text><text x="402" y="228">EVEN</text><text x="402" y="267">ODD</text></g>
    <g fill="#f2f2ee" font-size="36" text-anchor="middle" letter-spacing="2"><text x="358" y="100">ROUTING</text><text x="175" y="114" font-size="28">VCO</text><text x="541" y="114" font-size="28">VCF</text></g>
    <!-- reverb fans -->
    <polygon points="690,100 826,150 826,214 690,262" fill="#cfcfcf"/>
    <polygon points="1208,100 1034,150 1034,214 1208,262" fill="#cfcfcf"/>
    <g fill="#f2f2ee" font-size="30" text-anchor="middle" letter-spacing="2"><text x="948" y="102" font-size="36" fill="#cfcfcf">REVERB</text><text x="750" y="276">TIME</text><text x="948" y="276">DECAY</text><text x="1146" y="276">MIX</text></g>
    <!-- settings -->
    <line x1="1272" y1="207" x2="1572" y2="207" stroke="#e6e6e2" stroke-width="4"/>
    <g fill="#f2f2ee" font-size="22" text-anchor="middle" letter-spacing="1"><text x="1422" y="102" font-size="36" letter-spacing="2">SETTINGS</text><text x="1310" y="143">OFF</text><text x="1418" y="143">MONO</text><text x="1527" y="143">OMNI</text><text x="1310" y="276">LEG</text><text x="1418" y="276">DUO</text><text x="1527" y="276">CHAN</text></g>
    <!-- osc box -->
    
    <g fill="#cfcfcf" font-size="34" letter-spacing="3"><text x="114" y="366">OSC 1</text><text x="466" y="366">OSC 2</text></g>
    <g fill="#f2f2ee" font-size="22" text-anchor="middle" letter-spacing="1"><text x="355" y="584" font-size="28">TUNE</text><text x="355" y="702" font-size="22">SYNC</text><text x="298" y="656" text-anchor="end">OFF</text><text x="408" y="656" text-anchor="start">ON</text>
      <text x="170" y="446">32 16 8</text><text x="526" y="446">16 8 4</text>
      <text x="131" y="745">PW</text><text x="226" y="745">GLD</text><text x="485" y="745">DTN</text><text x="579" y="745">GLD</text>
      <text x="131" y="1071">LVL</text><text x="579" y="1071">LVL</text></g>
    <g stroke="#e6e6e2" stroke-width="3"><line x1="454" y1="596" x2="476" y2="596"/><line x1="496" y1="596" x2="518" y2="596"/></g>
    <!-- vibrato -->
    <path d="M272 1076 V796 Q272 772 296 772 H350 Q356 772 356 790 V1076 Z M356 1076" fill="#e9e9e9"/>
    <rect x="272" y="772" width="168" height="304" rx="14" fill="#e9e9e9"/>
    <g fill="#141414" font-size="24" text-anchor="middle" letter-spacing="1"><text x="355" y="800">VIBRATO</text><text x="307" y="1071">RATE</text><text x="403" y="1071">LVL</text></g>
    <!-- wave icons -->
    <g fill="none" stroke="#f2f2ee" stroke-width="4" stroke-linejoin="round"><path d="M203 878 L222 862 V878"/><path d="M200 983 V965 H208 V983 H216 V965 H224"/><path d="M483 878 L502 862 V878"/><path d="M486 982 L500 966 L514 982"/></g>
    <!-- dual filter -->
    
    <g fill="#cfcfcf" font-size="38" letter-spacing="4" text-anchor="end"><text x="1202" y="366">DUAL FILTER</text></g>
    <g fill="#f2f2ee" font-size="26" text-anchor="middle" letter-spacing="1"><text x="793" y="584" font-size="28">CUTOFF</text><text x="1060" y="689">POST</text><text x="1157" y="689">RES</text></g>
    <g stroke="#e6e6e2" stroke-width="3"><line x1="1030" y1="545" x2="1050" y2="545"/><line x1="1072" y1="545" x2="1092" y2="545"/></g>
    <!-- mod root strip -->
    <path d="M666 640 Q666 604 702 604 H944 V748 H702 Q666 748 666 712 Z" fill="#dadada"/>
    <g fill="#141414" font-size="25" text-anchor="end" letter-spacing="1"><text x="912" y="621">SINGLE</text><text x="896" y="662">DUAL</text><text x="896" y="701">SPLIT</text><text x="896" y="740">ODD</text></g>
    <text x="946" y="690" fill="#141414" font-size="20" font-weight="700" letter-spacing="2" transform="rotate(90 946 690)" text-anchor="middle" dy="-4">MOD ROOT</text>
    <!-- mods -->
    <g fill="#f2f2ee" font-size="30" letter-spacing="2" text-anchor="middle"><text x="786" y="793">MOD 1</text><text x="1108" y="793">MOD 2</text></g>
    <g fill="#f2f2ee" font-size="22" text-anchor="middle" letter-spacing="1"><text x="778" y="1071">RISE</text><text x="873" y="1071">FALL</text><text x="968" y="1071">LVL</text><text x="1065" y="1071">RISE</text><text x="1160" y="1071">FALL</text><text x="1255" y="1071">LVL</text><text x="698" y="884">HOLD</text><text x="698" y="1071">LFO</text><text x="1339" y="885">HOLD</text><text x="1339" y="1071">LFO</text></g>
    <line x1="1018" y1="812" x2="1018" y2="1040" stroke="#e6e6e2" stroke-width="5"/>
    <!-- vca -->
    <path d="M1264 640 H1580 V1068 Q1580 1096 1552 1096 H1406 Q1378 1096 1378 1068 V798 Q1378 770 1346 770 H1292 Q1264 770 1264 742 Z" fill="#e9e9e9"/>
    <path d="M1264 640 Q1264 700 1300 710 H1316" fill="none"/>
    
    <g fill="#f2f2ee" font-size="36" text-anchor="middle" letter-spacing="3"><text x="1426" y="366">VCA</text></g>
    <g fill="#f2f2ee" font-size="28" text-anchor="middle" letter-spacing="2"><text x="1426" y="630">LEVEL</text></g>
    <g fill="#141414" font-size="22" text-anchor="middle" letter-spacing="1"><text x="1368" y="692" text-anchor="start">HOLD</text><text x="1464" y="692" text-anchor="start">LFO</text><text x="1441" y="1071">RISE</text><text x="1537" y="1071">FALL</text></g>
    <!-- right panel: noise and patches (the hardware's jacks are left out) -->
    <rect x="1600" y="325" width="336" height="765" rx="30" fill="#e0e0e0"/>
    <g fill="#141414" font-size="26" text-anchor="middle" letter-spacing="2"><text x="1768" y="424">NOISE</text><text x="1768" y="590" font-size="30">PATCH</text><text x="1768" y="1066" font-size="22">MIDI</text></g>
    
    <!-- wordmark -->
    <g transform="translate(1612 120) scale(1.12)" fill="none" stroke="#f4f4f0" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
      <g transform="translate(6 8)"><path d="M4 44 V6 L19 28 L34 6 V44"/></g>
      <g transform="translate(52 8)"><ellipse cx="19" cy="25" rx="16" ry="21"/></g>
      <g transform="translate(96 8)"><path d="M4 44 L19 5 L34 44 M10 31 H28"/></g>
      <g transform="translate(138 8)"><path d="M6 27 H22"/></g>
      <g transform="translate(160 8)"><path d="M4 6 V44 H15 C31 44 36 34 36 25 C36 14 30 6 15 6 Z"/></g>
      <g transform="translate(206 8)"><path d="M4 6 V30 C4 52 36 52 36 30 V6"/></g>
      <g transform="translate(250 8)"><ellipse cx="19" cy="25" rx="16" ry="21"/></g>
    </g>
    <rect x="1604" y="214" width="336" height="9" rx="4" fill="#f0883e"/>
    <text x="1604" y="262" fill="#f2f2ee" font-size="24" letter-spacing="4">PARAPHONIC SYNTHESIZER</text>
    <!-- screws -->
    <g fill="#2a2a2c" stroke="#555" stroke-width="2"><circle cx="108" cy="46" r="13"/><circle cx="1928" cy="46" r="13"/><circle cx="108" cy="1148" r="13"/><circle cx="1928" cy="1148" r="13"/><circle cx="214" cy="1038" r="20"/><circle cx="497" cy="1038" r="20"/></g>
  </svg>`;function hr(e){try{let t=window.localStorage.getItem(e);return t?JSON.parse(t):{}}catch{return{}}}var gr=(e,t)=>typeof e==`object`&&!!e&&Object.entries(e).every(([e,n])=>t.has(e)&&(typeof n==`number`||typeof n==`string`));function _r(e,t){let n=new Set(t.controls.map(e=>e.id));for(let[r,i]of Object.entries(hr(e))){let e=Number(r);Number.isInteger(e)&&e>=0&&e<t.slots.length&&typeof i?.name==`string`&&gr(i.values,n)&&(t.slots[e]=i)}}function vr(e,t,n){try{window.localStorage.setItem(e,JSON.stringify({...hr(e),[t]:n}))}catch{}}var yr=`moa-duo.patches`,br=e=>_r(yr,e),xr=(e,t)=>vr(yr,e,t),G=(e,t)=>{let n=e.control(t);if(n.kind!==`number`)throw Error(`${t} is not a number control`);return n},K=(e,t)=>{let n=e.control(t);if(n.kind!==`choice`)throw Error(`${t} is not a choice control`);return n},q=(e,t)=>{let n=e.control(t);if(n.kind!==`toggle`)throw Error(`${t} is not a toggle control`);return n},Sr=`<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
  <radialGradient id="duoSkirt" cx="50%" cy="38%" r="65%"><stop offset="0" stop-color="#2c2c2e"/><stop offset="1" stop-color="#09090a"/></radialGradient>
  <radialGradient id="duoCap" cx="42%" cy="36%" r="70%"><stop offset="0" stop-color="#f7f7f7"/><stop offset="0.55" stop-color="#bcbcbc"/><stop offset="1" stop-color="#8a8a8a"/></radialGradient>
</defs></svg>`,Cr=(e=!1)=>t=>{let n=Math.round((-135+t*270)*10)/10;return`<svg aria-hidden="true" viewBox="0 0 100 100" width="100%" height="100%">
    <circle cx="50" cy="50" r="47" fill="url(#duoSkirt)"></circle>
    <circle cx="50" cy="50" r="45" fill="none" stroke="#1f1f21" stroke-width="5" stroke-dasharray="4.1 4.1"></circle>
    ${e?`<circle cx="50" cy="50" r="22" fill="#1d1d1f" stroke="#3a3a3d" stroke-width="1.5"></circle>`:`<circle cx="50" cy="50" r="36" fill="url(#duoCap)" stroke="#555" stroke-width="1"></circle>
       <g opacity="0.35" fill="#ffffff"><path d="M50 50 L86 50 A36 36 0 0 0 68 18.8 Z"></path><path d="M50 50 L14 50 A36 36 0 0 0 32 81.2 Z"></path></g>`}
    <rect x="47.5" y="5" width="5" height="${e?12:15}" rx="2" fill="#f4f4f0" transform="rotate(${n} 50 50)"></rect>
  </svg>`};function J(e,t,n,r=!1){let i=pr(dr(e,`#f4f4f0`,n),t,Cr(r));return i.classList.add(`duo-knob`),i}function wr(e,t,n){let r=e.options.length-1,i=pr({label:n,color:`#f4f4f0`,step:1/r,get:()=>e.options.indexOf(e.value)/r,set:t=>e.set(e.options[Math.round(Math.min(1,Math.max(0,t))*r)]),reset:()=>e.set(e.options[0]),text:()=>e.value.toUpperCase(),subscribe:t=>e.onChange(t)},t,e=>`<svg aria-hidden="true" viewBox="0 0 100 100" width="100%" height="100%">
      <circle cx="50" cy="50" r="47" fill="url(#duoSkirt)"></circle>
      <circle cx="50" cy="50" r="45" fill="none" stroke="#1f1f21" stroke-width="5" stroke-dasharray="4.1 4.1"></circle>
      <circle cx="50" cy="50" r="36" fill="url(#duoCap)" stroke="#555" stroke-width="1"></circle>
      <g opacity="0.35" fill="#ffffff"><path d="M50 50 L86 50 A36 36 0 0 0 68 18.8 Z"></path><path d="M50 50 L14 50 A36 36 0 0 0 32 81.2 Z"></path></g>
      <rect x="47.5" y="5" width="5" height="15" rx="2" fill="#f4f4f0" transform="rotate(${-45+e*90} 50 50)"></rect>
    </svg>`);return i.classList.add(`duo-knob`,`duo-knob-choice`),i}var Tr=(e,t)=>({label:t,steps:rr,get:()=>ir(e),set:t=>e.set(ar(e,t)),reset:()=>e.set(e.initial),text:()=>`${e.label} ${Math.abs(e.value)>=100?e.value.toFixed(0):e.value.toFixed(2)} ${e.unit}`.trim(),subscribe:t=>e.onChange(t)});function Er(e,t){let n=U(`div`,`duo-slider`);n.append(U(`div`,`duo-slider-track`));let r=U(`div`,`duo-slider-cap`);r.append(U(`span`)),n.append(r);let i=U(`input`,`duo-slider-input`);i.type=`range`,i.min=`0`,i.max=String(e.steps),i.step=`1`,i.setAttribute(`aria-label`,`${t} ${e.label}`),i.setAttribute(`aria-orientation`,`vertical`);let a=()=>{n.style.setProperty(`--t`,String(e.get()/e.steps)),i.value=String(e.get()),i.setAttribute(`aria-valuetext`,e.text()),i.title=e.text()};return i.addEventListener(`input`,()=>{e.set(Number(i.value)),a()}),i.addEventListener(`dblclick`,()=>{e.reset(),a()}),e.subscribe(a),a(),n.append(i),n}var Y=(e,t,n=[`off`,`on`])=>({positions:n,aria:t,get:()=>+!!e.value,set:t=>e.set(t===1),subscribe:t=>void e.onChange(t)}),X=(e,t)=>({positions:e.options,aria:t,get:()=>e.options.indexOf(e.value),set:t=>e.set(e.options[t]),subscribe:t=>void e.onChange(t)});function Z(e,t){let n=U(`button`,`duo-toggle`);n.type=`button`,n.setAttribute(`role`,`switch`),n.setAttribute(`aria-label`,e.aria),n.append(U(`i`));let r=e.positions.length-1,i=()=>{let i=e.get(),a=t?i===0?0:180:-35+70*i/r;n.style.setProperty(`--a`,`${a}deg`),n.setAttribute(`aria-checked`,String(i>0)),n.title=`${e.aria}: ${e.positions[i]}`};return n.addEventListener(`click`,()=>{e.set((e.get()+1)%e.positions.length),i()}),e.subscribe(i),i(),n}function Dr(e,t){let n=U(`i`,`duo-led`);n.setAttribute(`aria-hidden`,`true`);let r=()=>n.classList.toggle(`on`,e());return t(r),r(),n}var Q=(e,t,n,r,i=r)=>(e.classList.add(`duo-placed`),e.style.left=`${((t-r/2-W.x)/W.w*100).toFixed(3)}%`,e.style.top=`${((n-i/2-W.y)/W.h*100).toFixed(3)}%`,e.style.width=`${(r/W.w*100).toFixed(3)}%`,e.style.height=`${(i/W.h*100).toFixed(3)}%`,e),Or=e=>`${(e/W.w*100).toFixed(3)}cqw`;function kr(e,t){let n=U(`div`,`duo-case`);n.insertAdjacentHTML(`afterbegin`,Sr);let r=jr(e),i=Mr(e);if(n.append(r,i),t){let e=[...n.querySelectorAll(`.duo-gate-led`)],r=()=>{let n=t.readDuo(`duo`,`synth`)?.gate===!0;for(let t of e)t.classList.toggle(`on`,n);requestAnimationFrame(r)};requestAnimationFrame(r)}return n}function Ar(e,t){let n=U(`div`,`duo-patch-name ${t}`);n.setAttribute(`role`,`status`),n.setAttribute(`aria-label`,`Patch`);let r=!1,i=()=>{n.textContent=`${String(e.currentSlot+1).padStart(2,`0`)}  ${e.currentPreset.name}${r?`  SAVED`:``}`};e.onPresetChange(i),i();let a=(e,t,n)=>{let r=U(`button`,`duo-patch-btn`,e);return r.type=`button`,r.setAttribute(`aria-label`,t),r.addEventListener(`click`,n),r},o=t=>e.loadSlot((e.currentSlot+t+e.slots.length)%e.slots.length);return{name:n,buttons:[a(`<`,`Previous patch`,()=>o(-1)),a(`>`,`Next patch`,()=>o(1)),a(`SAVE`,`Save the panel into this patch slot`,()=>{xr(e.currentSlot,e.saveSlot(e.currentSlot)),r=!0,i(),window.setTimeout(()=>{r=!1,i()},1500)})]}}function jr(e){let t=U(`div`,`duo-desktop`);t.insertAdjacentHTML(`afterbegin`,mr);let n=e=>t.append(e);n(Q(wr(K(e,`route.vco`),`Routing`,`VCO`),172,190,135)),n(Q(wr(K(e,`route.vcf`),`Routing`,`VCF`),543,185,112)),n(Q(wr(K(e,`route.mod`),`Routing`,`Mod root`),748,672,128));let r=(e,t,r,i)=>{e.options.forEach((i,a)=>{let o=U(`button`,`duo-pick`);o.type=`button`,o.setAttribute(`aria-label`,`${e.label} ${i}`),o.addEventListener(`click`,()=>e.set(i));let s=()=>o.classList.toggle(`on`,e.value===i);e.onChange(s),s(),n(Q(o,t,r[a],74,34))})};r(K(e,`route.vco`),312,[148,185,222,261],!1),r(K(e,`route.vcf`),402,[148,185,222,261],!1),r(K(e,`route.mod`),866,[615,656,695,734],!0),n(Q(J(G(e,`reverb.time`),`Reverb`,`Time`),750,168,105)),n(Q(J(G(e,`reverb.decay`),`Reverb`,`Decay`),950,165,110)),n(Q(J(G(e,`reverb.mix`),`Reverb`,`Mix`),1145,168,110)),n(Q(Z(Y(q(e,`play.legato`),`Legato`,[`off`,`legato`]),!0),1310,190,44)),n(Q(Z(X(K(e,`play.mode`),`Mode, mono or duo`),!0),1420,190,44)),n(Q(Z(Y(q(e,`play.channel`),`MIDI channel, omni or locked`,[`omni`,`chan`]),!0),1527,190,44)),n(Q(Z(X(K(e,`osc1.octave`),`Oscillator 1 octave`),!1),150,400,44)),n(Q(Z(X(K(e,`osc2.octave`),`Oscillator 2 octave`),!1),527,400,44)),n(Q(J(G(e,`tune`),`Oscillator 2`,`Tune`),355,445,215)),n(Q(Z(Y(q(e,`sync`),`Oscillator sync`),!1),352,652,44)),n(Q(Dr(()=>q(e,`sync`).value,t=>void q(e,`sync`).onChange(t)),355,740,16)),n(Q(Z(X(K(e,`osc1.wave`),`Oscillator 1 wave`),!0),213,925,44)),n(Q(Z(X(K(e,`osc2.wave`),`Oscillator 2 wave`),!0),493,925,44));let i=(t,r,i,a,o,s)=>{let c=Er(Tr(G(e,t),i),r);c.style.setProperty(`--h`,Or(s-o)),c.style.setProperty(`--w`,Or(40)),c.style.setProperty(`--cap`,Or(34)),n(Q(c,a,(o+s)/2,40,s-o))};i(`osc1.pw`,`Oscillator 1`,`Pulse width`,128,480,715),i(`osc1.glide`,`Oscillator 1`,`Glide`,225,480,715),i(`osc2.detune`,`Oscillator 2`,`Detune`,485,480,715),i(`osc2.glide`,`Oscillator 2`,`Glide`,579,480,715),i(`osc1.level`,`Oscillator 1`,`Level`,128,805,1040),i(`vib.rate`,`Vibrato`,`Rate`,307,805,1040),i(`vib.level`,`Vibrato`,`Level`,403,805,1040),i(`osc2.level`,`Oscillator 2`,`Level`,579,805,1040),n(Q(J(G(e,`filter.cutoff`),`Filter`,`Cutoff`),793,445,200)),i(`filter.post`,`Filter`,`Post`,1060,420,655),i(`filter.res`,`Filter`,`Resonance`,1155,420,655);let a=(t,r,a,o,s)=>{let c=`mod${t}`,l=`Modulator ${t}`;i(`${c}.rise`,l,`Rise`,r,805,1040),i(`${c}.fall`,l,`Fall`,r+95,805,1040),i(`${c}.level`,l,`Level`,r+190,805,1040),n(Q(Z(Y(q(e,`${c}.hold`),`${l} hold`),!0),a,830,44)),n(Q(Z(Y(q(e,`${c}.lfo`),`${l} LFO`),!0),o,1025,44)),n(Q(Dr(()=>q(e,`${c}.hold`).value,t=>void q(e,`${c}.hold`).onChange(t)),s,922,16))};a(`1`,778,698,698,698),a(`2`,1065,1340,1340,1331),n(Q(J(G(e,`vca.level`),`VCA`,`Level`),1440,500,215)),n(Q(Z(Y(q(e,`vca.hold`),`VCA hold`),!1),1310,686,44)),n(Q(Z(Y(q(e,`vca.lfo`),`VCA LFO`),!1),1523,686,44)),i(`vca.rise`,`VCA`,`Rise`,1441,805,1040),i(`vca.fall`,`VCA`,`Fall`,1537,805,1040),n(Q(J(G(e,`noise`),`Noise`,`Noise`,!0),1768,350,70));let o=Ar(e,`duo-patch-desktop`);n(Q(o.name,1768,652,284,84)),n(Q(o.buttons[0],1668,752,78,56)),n(Q(o.buttons[1],1768,752,78,56)),n(Q(o.buttons[2],1862,752,96,56));let s=Dr(()=>e.heldNotes.length>0,t=>void e.onNoteChange(t));return s.classList.add(`duo-gate-led`),n(Q(s,1768,1030,22)),t}function Mr(e){let t=U(`div`,`duo-mobile`),n=(e,...t)=>{let n=U(`section`,`duo-card`);return n.append(U(`h2`,`duo-card-title`,e),...t),n},r=(e,...t)=>{let n=U(`div`,e);return n.append(...t),n},i=(e,t)=>{let n=U(`div`,`duo-item`);return n.append(t,U(`span`,`duo-item-label`,e)),n},a=(t,n,r)=>i(r,Er(Tr(G(e,t),r),n)),o=(t,n,r,i=!1)=>J(G(e,t),n,r,i),s=(e,t,n,r)=>{let i=U(`div`,`duo-item duo-item-switch`);return i.append(U(`span`,`duo-item-label`,n),Z(e,t),U(`span`,`duo-item-label`,r)),i},c=(e,t)=>{let n=U(`div`,`duo-segmented`);n.setAttribute(`role`,`group`),n.setAttribute(`aria-label`,t),n.append(U(`span`,`duo-segmented-name`,t));let r=e.options.map(t=>{let r=U(`button`,`duo-pick`,t.toUpperCase());return r.type=`button`,r.addEventListener(`click`,()=>e.set(t)),n.append(r),[t,r]}),i=()=>r.forEach(([t,n])=>{n.classList.toggle(`on`,e.value===t),n.setAttribute(`aria-pressed`,String(e.value===t))});return e.onChange(i),i(),n},l=Ar(e,`duo-patch-mobile`),u=i(`NOISE`,o(`noise`,`Noise`,`Noise`,!0)),d=r(`duo-patch-row`,l.buttons[0],l.name,l.buttons[1],l.buttons[2]),f=Dr(()=>e.heldNotes.length>0,t=>void e.onNoteChange(t));return f.classList.add(`duo-gate-led`),t.append(d,n(`ROUTING`,c(K(e,`route.vco`),`VCO`),c(K(e,`route.vcf`),`VCF`),c(K(e,`route.mod`),`MOD`)),n(`OSC 1`,c(K(e,`osc1.octave`),`OCT`),r(`duo-row`,s(X(K(e,`osc1.wave`),`Oscillator 1 wave`),!0,`SAW`,`SQUARE`),a(`osc1.pw`,`Oscillator 1`,`PW`),a(`osc1.glide`,`Oscillator 1`,`GLD`),a(`osc1.level`,`Oscillator 1`,`LVL`))),n(`OSC 2`,c(K(e,`osc2.octave`),`OCT`),r(`duo-row`,s(X(K(e,`osc2.wave`),`Oscillator 2 wave`),!0,`SAW`,`TRI`),a(`osc2.detune`,`Oscillator 2`,`DTN`),a(`osc2.glide`,`Oscillator 2`,`GLD`),a(`osc2.level`,`Oscillator 2`,`LVL`))),n(`TUNE & VIBRATO`,r(`duo-row`,i(`TUNE`,o(`tune`,`Oscillators`,`Tune`)),s(Y(q(e,`sync`),`Oscillator sync`),!1,`SYNC OFF`,`ON`),a(`vib.rate`,`Vibrato`,`RATE`),a(`vib.level`,`Vibrato`,`LVL`),u)),n(`DUAL FILTER`,r(`duo-row`,i(`CUTOFF`,o(`filter.cutoff`,`Filter`,`Cutoff`)),a(`filter.post`,`Filter`,`POST`),a(`filter.res`,`Filter`,`RES`)),...[`1`,`2`].map(t=>{let n=`mod${t}`,i=`Modulator ${t}`,o=U(`div`,`duo-sub`);return o.append(U(`h3`,`duo-sub-title`,`MOD ${t}`),r(`duo-row`,s(Y(q(e,`${n}.hold`),`${i} hold`),!0,`OFF`,`HOLD`),s(Y(q(e,`${n}.lfo`),`${i} LFO`),!0,`ENV`,`LFO`),a(`${n}.rise`,i,`RISE`),a(`${n}.fall`,i,`FALL`),a(`${n}.level`,i,`LVL`))),o})),n(`VCA`,r(`duo-row`,i(`LEVEL`,o(`vca.level`,`VCA`,`Level`)),s(Y(q(e,`vca.hold`),`VCA hold`),!0,`OFF`,`HOLD`),s(Y(q(e,`vca.lfo`),`VCA LFO`),!0,`ENV`,`LFO`),a(`vca.rise`,`VCA`,`RISE`),a(`vca.fall`,`VCA`,`FALL`))),n(`REVERB`,r(`duo-row`,i(`TIME`,o(`reverb.time`,`Reverb`,`Time`)),i(`DECAY`,o(`reverb.decay`,`Reverb`,`Decay`)),i(`MIX`,o(`reverb.mix`,`Reverb`,`Mix`)))),n(`SETTINGS`,r(`duo-row`,s(Y(q(e,`play.legato`),`Legato`,[`off`,`legato`]),!0,`OFF`,`LEG`),s(X(K(e,`play.mode`),`Mode, mono or duo`),!0,`MONO`,`DUO`),s(Y(q(e,`play.channel`),`MIDI channel, omni or locked`,[`omni`,`chan`]),!0,`OMNI`,`CHAN`),r(`duo-led-item`,f,U(`span`,`duo-item-label`,`GATE`))))),t}var Nr=`moa.monitor`,Pr=class{audience;apply;storage;mode=`auto`;listeners=new Set;constructor(e,t,n=Fr()){this.audience=e,this.apply=t,this.storage=n;let r=n?.getItem(Nr);(r===`on`||r===`off`||r===`auto`)&&(this.mode=r)}get on(){return this.mode===`on`||this.mode===`auto`&&this.audience()===0}setMode(e){this.mode=e;try{this.storage?.setItem(Nr,e)}catch{}this.update()}update(){this.apply(this.on);for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}};function Fr(){try{return typeof localStorage>`u`?void 0:localStorage}catch{return}}var Ir=`moa-pcm-send`,Lr=`moa-pcm-recv`,Rr=`
class PcmRing {
  constructor(capacity, target) {
    this.cap = capacity;
    this.target = target;
    this.l = new Float32Array(capacity);
    this.r = new Float32Array(capacity);
    this.w = 0; // frames ever written
    this.pos = 0; // fractional read position, in the same frames
    this.primed = false;
    this.underruns = 0;
    this.drops = 0;
  }
  get fill() { return this.w - this.pos; }
  push(l, r) {
    for (let i = 0; i < l.length; i++) {
      const at = (this.w + i) % this.cap;
      this.l[at] = l[i];
      this.r[at] = r[i];
    }
    this.w += l.length;
    if (this.fill > this.cap * 0.9) {
      this.pos = this.w - this.target;
      this.drops++;
    }
  }
  /** Fills outL/outR; ratio is sender rate / our rate. */
  pull(outL, outR, ratio) {
    const n = outL.length;
    if (!this.primed) {
      if (this.fill >= this.target) this.primed = true;
      else { outL.fill(0); outR.fill(0); return; }
    }
    const trim = Math.max(-0.01, Math.min(0.01, ((this.fill - this.target) / this.target) * 0.02));
    const rate = ratio * (1 + trim);
    for (let i = 0; i < n; i++) {
      if (this.fill < 2) {
        this.primed = false;
        this.underruns++;
        for (let j = i; j < n; j++) { outL[j] = 0; outR[j] = 0; }
        return;
      }
      const i0 = Math.floor(this.pos);
      const f = this.pos - i0;
      const a = i0 % this.cap;
      const b = (i0 + 1) % this.cap;
      outL[i] = this.l[a] + (this.l[b] - this.l[a]) * f;
      outR[i] = this.r[a] + (this.r[b] - this.r[a]) * f;
      this.pos += rate;
    }
  }
}

class PcmSend extends AudioWorkletProcessor {
  constructor() {
    super();
    this.n = 512;
    this.l = new Float32Array(this.n);
    this.r = new Float32Array(this.n);
    this.at = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const left = input[0];
      const right = input[1] || input[0];
      for (let i = 0; i < left.length; i++) {
        this.l[this.at] = left[i];
        this.r[this.at] = right[i];
        if (++this.at === this.n) {
          this.port.postMessage({ l: this.l, r: this.r }, [this.l.buffer, this.r.buffer]);
          this.l = new Float32Array(this.n);
          this.r = new Float32Array(this.n);
          this.at = 0;
        }
      }
    }
    return true;
  }
}

class PcmRecv extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { targetMs, capacityMs } = options.processorOptions;
    this.ring = new PcmRing(Math.ceil(sampleRate * capacityMs / 1000), Math.ceil(sampleRate * targetMs / 1000));
    this.ratio = 1;
    this.blocks = 0;
    this.port.onmessage = (e) => {
      this.ratio = e.data.rate / sampleRate;
      this.ring.push(e.data.l, e.data.r);
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    this.ring.pull(out[0], out[1] || out[0], this.ratio);
    if (++this.blocks % 64 === 0) {
      this.port.postMessage({ fill: this.ring.fill / sampleRate * 1000, underruns: this.ring.underruns, drops: this.ring.drops });
    }
    return true;
  }
}

registerProcessor('${Ir}', PcmSend);
registerProcessor('${Lr}', PcmRecv);
`,zr=new WeakSet;async function Br(e){if(zr.has(e))return;let t=URL.createObjectURL(new Blob([Rr],{type:`text/javascript`}));await e.audioWorklet.addModule(t),zr.add(e)}var Vr=()=>Math.random().toString(36).slice(2,10),Hr=class{id=Vr();channel;remote=new Map;listeners=new Set;audienceListeners=new Set;outlets=new Map;sinks=new Map;constructor(e=`moa-audio-pcm`,t){let n=t??(typeof BroadcastChannel>`u`?void 0:e=>new BroadcastChannel(e));this.channel=n?.(e),this.channel&&(this.channel.onmessage=e=>this.handle(e.data),this.send({type:`hello`,from:this.id}),typeof window<`u`&&window.addEventListener(`pagehide`,e=>{e.persisted||this.close()}))}get supported(){return this.channel!==void 0&&typeof AudioWorkletNode<`u`}get ports(){return[...this.remote].map(([e,t])=>({id:e,name:t.name}))}get audience(){let e=0;for(let t of this.outlets.values())e+=t.audience.size;return e}openOutlet(e){let t=Vr(),n={name:e,audience:new Set};return this.outlets.set(t,n),this.send({type:`announce`,from:this.id,port:t,name:e}),{id:t,get listened(){return n.audience.size>0},send:(e,r,i)=>{n.audience.size>0&&this.send({type:`pcm`,from:this.id,port:t,rate:i,l:e,r})},close:()=>{this.outlets.delete(t)&&(n.stop?.(),this.send({type:`bye`,from:this.id,port:t}),this.audienceChanged())}}}listen(e,t){return this.sinks.set(e,e=>t(e.rate,e.l,e.r)),this.send({type:`listen`,from:this.id,port:e}),()=>{this.sinks.delete(e)&&this.send({type:`unlisten`,from:this.id,port:e})}}async publish(e,t,n){await Br(e);let r=new AudioWorkletNode(e,Ir,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:`explicit`}),i=e.createGain();i.gain.value=0,t.connect(r),r.connect(i).connect(e.destination);let a=this.openOutlet(n);return r.port.onmessage=t=>a.send(t.data.l,t.data.r,e.sampleRate),this.outlets.get(a.id).stop=()=>{t.disconnect(r),r.disconnect(),i.disconnect(),r.port.onmessage=null},a.close}async subscribe(e,t,n=30){await Br(e);let r=new AudioWorkletNode(e,Lr,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{targetMs:n,capacityMs:400}}),i={fill:0,underruns:0,drops:0};r.port.onmessage=e=>{i=e.data};let a=this.listen(t,(e,t,n)=>r.port.postMessage({rate:e,l:t,r:n},[t.buffer,n.buffer]));return{node:r,stats:()=>i,close:()=>{a(),r.disconnect(),r.port.onmessage=null}}}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}onAudience(e){return this.audienceListeners.add(e),()=>this.audienceListeners.delete(e)}close(){for(let e of[...this.sinks.keys()])this.send({type:`unlisten`,from:this.id,port:e});this.sinks.clear();for(let e of this.outlets.values())e.stop?.();this.outlets.clear(),this.send({type:`bye`,from:this.id}),this.channel?.close()}emit(){for(let e of this.listeners)e()}audienceChanged(){for(let e of this.audienceListeners)e()}send(e){this.channel?.postMessage(e)}handle(e){if(e.from!==this.id)switch(e.type){case`hello`:for(let[e,t]of this.outlets)this.send({type:`announce`,from:this.id,port:e,name:t.name});return;case`announce`:this.remote.set(e.port,{owner:e.from,name:e.name}),this.emit();return;case`bye`:for(let[t,n]of[...this.remote])n.owner===e.from&&(e.port===void 0||e.port===t)&&this.remote.delete(t);if(e.port===void 0){let t=!1;for(let n of this.outlets.values())t=n.audience.delete(e.from)||t;t&&this.audienceChanged()}this.emit();return;case`listen`:{let t=this.outlets.get(e.port);if(!t||t.audience.has(e.from))return;t.audience.add(e.from),this.audienceChanged();return}case`unlisten`:this.outlets.get(e.port)?.audience.delete(e.from)&&this.audienceChanged();return;case`pcm`:this.sinks.get(e.port)?.(e);return}}};function Ur(e){let t=e[0];if(t===void 0)return;if(t>=240)switch(t){case 248:return{type:`clock`};case 250:return{type:`start`};case 251:return{type:`continue`};case 252:return{type:`stop`};default:return}let n=t&240,r=(t&15)+1,i=(e[1]??0)&127,a=(e[2]??0)&127;switch(n){case 128:return{type:`noteOff`,channel:r,note:i,velocity:a};case 144:return a===0?{type:`noteOff`,channel:r,note:i,velocity:0}:{type:`noteOn`,channel:r,note:i,velocity:a};case 176:return{type:`cc`,channel:r,controller:i,value:a};case 192:return{type:`programChange`,channel:r,program:i};case 224:return{type:`pitchBend`,channel:r,value:(a<<7|i)/8192-1};default:return}}var Wr=[`C`,`C#`,`D`,`D#`,`E`,`F`,`F#`,`G`,`G#`,`A`,`A#`,`B`];function Gr(e){return`${Wr[e%12]}${Math.floor(e/12)-2}`}function Kr(e){switch(e.type){case`noteOn`:case`noteOff`:return`note`;case`cc`:return`cc`;case`clock`:case`start`:case`continue`:case`stop`:return`clock`;default:return`other`}}function qr(e){switch(e.type){case`noteOn`:return`ch${e.channel}  note on  ${Gr(e.note)}  vel ${e.velocity}`;case`noteOff`:return`ch${e.channel}  note off  ${Gr(e.note)}`;case`cc`:return`ch${e.channel}  cc ${e.controller}  = ${e.value}`;case`pitchBend`:return`ch${e.channel}  bend  ${e.value.toFixed(2)}`;case`programChange`:return`ch${e.channel}  program  ${e.program}`;case`clock`:return`clock`;default:return`clock ${e.type}`}}var Jr=40,Yr=class{lines=[];lastSeen={note:-1/0,cc:-1/0,clock:-1/0,other:-1/0};listeners=new Set;record(e,t){if(this.lastSeen[Kr(e)]=t,e.type!==`clock`){this.lines.push({text:qr(e),kind:Kr(e)}),this.lines.length>Jr&&this.lines.shift();for(let e of this.listeners)e()}}clear(){this.lines.length=0;for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}},Xr=`moa.midiBus`,Zr=()=>performance.timeOrigin+performance.now(),Qr=class{now;later;enabled;onMessage;lastSeen=0;channel;listeners=new Set;constructor(e=`moa-midi`,t=Zr,n=(e,t)=>setTimeout(e,t),r){this.now=t,this.later=n,this.enabled=$r();let i=r??(typeof BroadcastChannel>`u`?void 0:e=>new BroadcastChannel(e));this.channel=i?.(e),this.channel&&(this.channel.onmessage=e=>{if(!this.enabled)return;let{at:t,data:n}=e.data;if(!Array.isArray(n)||typeof t!=`number`)return;this.lastSeen=performance.now();let r=t-this.now(),i=()=>this.onMessage?.(Uint8Array.from(n),performance.now());r<=1?i():this.later(i,r)})}get supported(){return this.channel!==void 0}send(e,t=this.now()){this.channel?.postMessage({at:t,data:Array.from(e)})}setEnabled(e){this.enabled=e;try{localStorage.setItem(Xr,e?`1`:`0`)}catch{}for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}close(){this.channel?.close()}};function $r(){try{return localStorage.getItem(Xr)!==`0`}catch{return!0}}var ei=e=>`moa-control-${e}`,ti=`moa-control-status`,ni=e=>`moa-song-${e}`;function ri(e){return typeof BroadcastChannel>`u`?void 0:new BroadcastChannel(e)}function ii(e,t){let n=ri(ei(e));return n?(n.onmessage=e=>{e.data&&typeof e.data.type==`string`&&t(e.data)},()=>n.close()):()=>{}}function ai(e,t){let n=ri(ti);n?.postMessage({page:e,state:t}),n?.close()}var oi=e=>typeof e==`string`?e===`1`||e===`true`||e===`on`:typeof e==`number`?e!==0:e;function si(e,t){let n=[];for(let[r,i]of Object.entries(t)){let t=e.devices.get(r);if(!t){n.push(`no device ${r}`);continue}if(i.preset!==void 0){let e=t,a=i.preset;t instanceof Qn&&Number.isInteger(a)&&a>=0&&a<zn.length?t.loadPreset(zn[a]):typeof e.loadSlot==`function`&&Number.isInteger(a)&&a>=0&&a<(e.slots?.length??0)?e.loadSlot(a):n.push(`${r}: cannot load preset ${a}`)}let a=t.transport;if(i.channel!==void 0)try{if(!a?.channel)throw Error(`no channel setting`);a.channel.set(i.channel)}catch(e){n.push(`${r}: channel ${i.channel}: ${e.message}`)}for(let[e,a]of Object.entries(i.controls??{}))try{let n=t.control(e);if(n.kind===`number`){let e=typeof a==`number`?a:Number(a);if(Number.isNaN(e))throw Error(`not a number`);n.set(e)}else n.kind===`choice`?n.set(String(a)):n.set(oi(a))}catch(t){n.push(`${r}.${e}: ${t.message}`)}}return n}var ci=`moa.midiInput`,li=`moa.midiOutput`,ui=class{status=typeof navigator<`u`&&`requestMIDIAccess`in navigator?`idle`:`unsupported`;inputs=[];selectedId;outputs=[];selectedOutputId;onMessage;access;listeners=new Set;async connect(){if(this.status!==`unsupported`){try{this.access=await navigator.requestMIDIAccess({sysex:!1})}catch{this.status=`denied`,this.emit();return}this.status=`ready`,this.access.onstatechange=()=>this.refresh(),this.refresh()}}async connectIfPermitted(){if(this.status===`idle`)try{(await navigator.permissions.query({name:`midi`})).state===`granted`&&await this.connect()}catch{}}select(e){if(this.access)for(let e of this.access.inputs.values())e.onmidimessage=null;if(this.selectedId=e,e){let t=this.access?.inputs.get(e);t&&(t.onmidimessage=e=>{e.data&&this.onMessage?.(e.data,e.timeStamp)});try{localStorage.setItem(ci,e)}catch{}}this.emit()}selectOutput(e){this.selectedOutputId=e;try{e?localStorage.setItem(li,e):localStorage.removeItem(li)}catch{}this.emit()}send(e,t){let n=this.selectedOutputId?this.access?.outputs.get(this.selectedOutputId):void 0;n&&n.send(e,t===void 0?void 0:t-performance.timeOrigin)}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}refresh(){if(this.inputs=[...this.access?.inputs.values()??[]].map(e=>({id:e.id,name:e.name??e.id})),this.outputs=[...this.access?.outputs.values()??[]].map(e=>({id:e.id,name:e.name??e.id})),this.selectedOutputId&&!this.outputs.some(e=>e.id===this.selectedOutputId)&&(this.selectedOutputId=void 0),!this.selectedOutputId)try{let e=localStorage.getItem(li);e&&this.outputs.some(t=>t.id===e)&&(this.selectedOutputId=e)}catch{}this.selectedId&&this.inputs.some(e=>e.id===this.selectedId)?this.emit():this.select(this.pickDefault())}pickDefault(){let e=null;try{e=localStorage.getItem(ci)}catch{}return this.inputs.find(t=>t.id===e)?.id??this.inputs.find(e=>/torso|t-?1/i.test(e.name))?.id??(this.inputs.length===1?this.inputs[0]?.id:void 0)}emit(){for(let e of this.listeners)e()}},di=[[`auto`,`Auto`],[`on`,`On`],[`off`,`Off`]];function fi(e,t){let n=U(`div`,`midi-block`);n.append(U(`div`,`fader-label`,`Audio bus`));let r=U(`div`,`midi-bus`),i=U(`span`,`led input-led`),a=U(`span`,`bus-listening`);r.append(i,a);let o=U(`div`,`bus-monitor`);o.append(U(`span`,`fader-label`,`Speakers`));let s=di.map(([e,n])=>{let r=U(`button`,`btn btn-small`,n);return r.type=`button`,r.setAttribute(`aria-label`,`Own speakers: ${n}`),r.addEventListener(`click`,()=>t.setMode(e)),o.append(r),[e,r]}),c=()=>{let n=e.audience;a.textContent=n===0?`Nothing listening`:n===1?`1 listener`:`${n} listeners`,i.classList.toggle(`input-led-live`,n>0);for(let[e,n]of s)n.setAttribute(`aria-pressed`,String(t.mode===e));o.title=t.on?`Playing on this page's speakers`:`This page's speakers are muted`};return e.onAudience(c),t.onChange(c),c(),n.append(r,o),n}var pi=150;function mi(e,t,n,r,i){let a=U(`section`,`midi-strip`),o=U(`div`,`midi-block`);o.append(U(`div`,`fader-label`,`Audio`),r);let s=U(`div`,`midi-block`);s.append(U(`div`,`fader-label`,`MIDI input`));let c=U(`div`,`midi-device`);s.append(c);let l=()=>{if(c.replaceChildren(),e.status===`unsupported`)c.append(U(`div`,`midi-message`,`MIDI is not available in this browser. Try Chrome or Edge.`));else if(e.status===`denied`)c.append(U(`div`,`midi-message`,`MIDI access was blocked. Allow it in the site settings, then reload.`));else if(e.status===`idle`){let t=U(`button`,`btn midi-connect`,`Connect MIDI`);t.type=`button`,t.addEventListener(`click`,()=>void e.connect()),c.append(t)}else{let t=U(`select`,`patch-select`);t.setAttribute(`aria-label`,`MIDI input device`),t.add(new Option(e.inputs.length?`No device selected`:`No MIDI devices found`,``));for(let n of e.inputs)t.add(new Option(n.name,n.id));t.value=e.selectedId??``,t.addEventListener(`change`,()=>e.select(t.value||void 0)),c.append(t)}};e.onChange(l),l();let u,d;if(i?.supported){u=U(`div`,`midi-block`),u.append(U(`div`,`fader-label`,`Sequencer bus`));let e=U(`div`,`midi-bus`);d=U(`span`,`led`);let t=U(`button`,`btn btn-small midi-bus-toggle`);t.type=`button`,t.setAttribute(`aria-label`,`Listen to MIDI from the sequencer page in another tab`);let n=()=>{t.textContent=i.enabled?`On`:`Off`,t.setAttribute(`aria-pressed`,String(i.enabled))};t.addEventListener(`click`,()=>i.setEnabled(!i.enabled)),i.onChange(n),n(),e.append(d,t),u.append(e)}let f=U(`div`,`midi-block`);f.append(U(`div`,`fader-label`,`Incoming clock`));let p=U(`div`,`midi-bpm`,`--.-`),m=U(`div`,`midi-badges`),h=U(`span`,`badge`,`No clock`),g=U(`span`,`badge`,`Stopped`);m.append(h,g),f.append(p,m);let _=U(`div`,`midi-block`);_.append(U(`div`,`fader-label`,`Activity`));let v=U(`div`,`midi-leds`),ee={note:U(`span`,`led`),cc:U(`span`,`led`),clock:U(`span`,`led`)};for(let[e,t]of[[`note`,`Notes`],[`cc`,`CC`],[`clock`,`Clock`]]){let n=U(`div`,`led-item`);n.append(ee[e],U(`span`,void 0,t)),v.append(n)}_.append(v);let te=U(`div`,`midi-block midi-monitor-block`),ne=U(`div`,`midi-monitor-head`);ne.append(U(`div`,`fader-label`,`Monitor`));let re=U(`button`,`btn btn-small midi-clear`,`Clear`);re.type=`button`,re.addEventListener(`click`,()=>n.clear()),ne.append(re);let y=U(`div`,`midi-log`);y.setAttribute(`role`,`log`),y.setAttribute(`aria-label`,`Recent MIDI messages`),te.append(ne,y);let ie=()=>{y.replaceChildren(...n.lines.slice(-5).map(e=>U(`div`,`midi-line midi-line-${e.kind}`,e.text)))};n.onChange(ie),ie(),a.append(o,s,...u?[u]:[],f,_,te);let ae=()=>{let e=performance.now(),r=t.bpm,a=t.isLocked(e);p.textContent=r!==void 0&&a?r.toFixed(1):`--.-`,h.textContent=a?`Clock locked`:`No clock`,h.classList.toggle(`on`,a),g.textContent=t.running?`Running`:`Stopped`,g.classList.toggle(`on`,t.running),i&&d&&d.classList.toggle(`on`,e-i.lastSeen<pi);for(let t of[`note`,`cc`,`clock`])ee[t].classList.toggle(`on`,e-n.lastSeen[t]<pi);requestAnimationFrame(ae)};return requestAnimationFrame(ae),a}var hi=[[`/mixer/`,`The mixer`],[`/synth/`,`MOA-1`],[`/poly/`,`MOA-6`],[`/drums/`,`MOA-DR`],[`/lynch/`,`Lynch 106`],[`/duo/`,`MOA-DUO`],[`/df2/`,`MOA-DF2`],[`/pipe/`,`MOA-PIPE`],[`/seq/`,`MOA-SEQ`],[`/records/`,`Records`],[`/`,`moaswift.no`]];function gi(e){let t=document.createElement(`nav`);return t.className=`pipe-nav`,t.innerHTML=hi.filter(([t])=>t!==e).map(([e,t])=>`<a href="${e}">${t}</a>`).join(``),t}function _i(e){let{engine:t,clock:n}=e,r=new Yr,i=new ui,a=new Hr,o=new Pr(()=>a.audience,e=>t.setMonitor(e));a.onAudience(()=>o.update());let s=document.querySelector(`#app`),c=!1,l=async()=>{if(c)return;c=!0,await t.start(),o.update();let n=t.context;if(n)for(let r of e.ports){let e=t.jackNode(r.device,`out`,r.jack);e&&await a.publish(n,e,r.name)}u.textContent=`Audio running`,u.disabled=!0,ai(e.id,`started`)},u=document.createElement(`button`);u.className=`start`,u.textContent=`Start audio`,u.addEventListener(`click`,()=>void l());function d(t,i=performance.now()){let a=Ur(t);a&&(n.handle(a,i),r.record(a,i),e.onMidi(a))}i.onMessage=(e,t)=>d(e,t),i.connectIfPermitted();let f=new Qr;f.onMessage=(e,t)=>d(e,t);let p=new Qr(ni(e.id));p.enabled=!0,p.onMessage=(e,t)=>d(e,t),ii(e.id,t=>{t.type===`start`?l():t.settings&&si(e.patch,t.settings)}),ai(e.id,`loaded`);let m=mi(i,n,r,u,f);return m.append(fi(a,o)),s.append(gi(e.self),m,...Array.isArray(e.panel)?e.panel:[e.panel]),{handleMidiBytes:d,pcm:a}}var vi=.04;function yi(e){let t=U(`div`,`wheel`);t.append(U(`div`,`wheel-label`,e.label));let n=U(`div`,`wheel-body`),r=U(`div`,`wheel-scale`);r.setAttribute(`aria-hidden`,`true`);for(let t of e.scale)r.append(U(`span`,void 0,t));let i=U(`button`,`wheel-face`);i.type=`button`,i.setAttribute(`role`,`slider`),i.setAttribute(`aria-label`,e.ariaLabel),i.setAttribute(`aria-orientation`,`vertical`),i.setAttribute(`aria-valuemin`,e.bipolar?`-1`:`0`),i.setAttribute(`aria-valuemax`,`1`),i.append(U(`span`,`wheel-ribs`)),e.bipolar&&i.append(U(`span`,`wheel-detent wheel-detent-left`),U(`span`,`wheel-detent wheel-detent-right`));let a=U(`div`,`wheel-marker`);a.setAttribute(`aria-hidden`,`true`);let o=U(`div`,`wheel-readout`),s=t=>e.bipolar?(t+1)/2:t,c=()=>{let t=e.get(),n=s(t);i.style.setProperty(`--rib`,`${Math.round(t*-60)}px`),a.style.top=`${Math.round((1-n)*102)}px`,o.textContent=e.format(t),i.setAttribute(`aria-valuenow`,String(t)),i.setAttribute(`aria-valuetext`,e.format(t))},l=t=>{let n=Math.min((e.bipolar,1),Math.max(e.bipolar?-1:0,t));e.set(e.bipolar&&Math.abs(n)<vi?0:n),c()},u=t=>{let n=i.getBoundingClientRect(),r=Math.min(1,Math.max(0,1-(t.clientY-n.top)/n.height));l(e.bipolar?r*2-1:r)},d=!1;i.addEventListener(`pointerdown`,e=>{i.setPointerCapture(e.pointerId),d=!0,u(e)}),i.addEventListener(`pointermove`,e=>{d&&u(e)});let f=()=>{d=!1,e.springBack&&l(0)};i.addEventListener(`pointerup`,f),i.addEventListener(`pointercancel`,f),i.addEventListener(`keydown`,t=>{let n=t.key===`ArrowUp`||t.key===`ArrowRight`?1:t.key===`ArrowDown`||t.key===`ArrowLeft`?-1:0;n&&(t.preventDefault(),l(e.get()+n*e.keyStep))}),i.addEventListener(`keyup`,()=>{e.springBack&&l(0)}),i.addEventListener(`dblclick`,()=>l(0)),e.subscribe(c),c();let p=U(`div`,`wheel-markers`);return p.append(a),n.append(r,i,p),t.append(n,o),t}var bi=36,xi=49,Si=[`a`,`w`,`s`,`e`,`d`,`f`,`t`,`g`,`y`,`h`,`u`,`j`,`k`],Ci=24,wi=[`C`,`C#`,`D`,`D#`,`E`,`F`,`F#`,`G`,`G#`,`A`,`A#`,`B`],Ti=[!0,!1,!0,!1,!0,!0,!1,!0,!1,!0,!1,!0],Ei=Ti.reduce((e,t,n)=>e+ +!!t,0)*4+1,Di=100/Ei*.6,Oi=2,ki,Ai=e=>`${wi[e%12]}${Math.floor(e/12)-1}`,ji=(e,t=2)=>{let n=Math.round(e*t*100)/100;return`${n>0?`+`:``}${n.toFixed(2)} st`};function Mi(e,t){let n=U(`div`,`keybed`);ki??=n,document.addEventListener(`pointerdown`,e=>{n.parentElement?.contains(e.target)&&(ki=n)},!0);let r=U(`div`,`keybed-cheek`),i=U(`div`,`keybed-wheels`);i.append(yi({label:`Bend`,ariaLabel:`Pitch bend`,bipolar:!0,scale:[`+${e.bendRange??2}`,`0`,`-${e.bendRange??2}`],springBack:!0,keyStep:.125,get:()=>e.pitchBend,set:t=>e.setPitchBend(t),subscribe:t=>e.onPerformanceChange(t),format:t=>ji(t,e.bendRange??2)}),yi({label:`Mod`,ariaLabel:`Modulation, LFO vibrato depth`,bipolar:!1,scale:[`100`,`0`],springBack:!1,keyStep:.1,get:()=>e.modWheel,set:t=>e.setModWheel(t),subscribe:t=>e.onPerformanceChange(t),format:e=>`${Math.round(e*100)} %`}));let a=0,o=U(`div`,`keybed-octave`),s=U(`button`,`btn btn-small`,`<`);s.type=`button`,s.setAttribute(`aria-label`,`Octave down`);let c=U(`button`,`btn btn-small`,`>`);c.type=`button`,c.setAttribute(`aria-label`,`Octave up`);let l=U(`span`,`keybed-octave-text`,`Oct 0`);o.append(s,l,c),r.append(i,o);let u=U(`div`,`keybed-keys`),d=U(`div`,`keybed-whites`);u.append(d);let f=[],p=new Map,m=0,h=t=>{if(p.has(t))return;let n=bi+t+a*12;p.set(t,n),e.keyDown(n)},g=t=>{let n=p.get(t);n!==void 0&&(p.delete(t),e.keyUp(n))};for(let e=0;e<xi;e++){let t=Ti[e%12],n=U(`button`,t?`key-white`:`key-black`);n.type=`button`,n.setAttribute(`aria-label`,`Key ${Ai(bi+e)}`);let r=Si[e-Ci];r&&(n.textContent=r),t?(d.append(n),m++):(n.style.left=`${Math.round((m/Ei*100-Di/2)*1e3)/1e3}%`,n.style.width=`${Di}%`,u.append(n)),n.addEventListener(`pointerdown`,t=>{t.preventDefault(),h(e)});for(let t of[`pointerup`,`pointerleave`,`pointercancel`])n.addEventListener(t,()=>g(e));n.addEventListener(`keydown`,t=>{(t.key===` `||t.key===`Enter`)&&!t.repeat&&(t.preventDefault(),h(e))}),n.addEventListener(`keyup`,()=>g(e)),f.push(n)}let _=()=>{let t=new Set(e.heldNotes),n=new Set(p.values());f.forEach((e,r)=>{let i=p.has(r)||t.has(bi+r)&&!n.has(bi+r);e.classList.toggle(`on`,i),e.setAttribute(`aria-pressed`,String(i))})};e.onNoteChange(_);let v=()=>{l.textContent=`Oct ${a>0?`+`:``}${a}`,s.disabled=a<=-2,c.disabled=a>=Oi,_()};return s.addEventListener(`click`,()=>{a=Math.max(-2,a-1),v()}),c.addEventListener(`click`,()=>{a=Math.min(Oi,a+1),v()}),v(),window.addEventListener(`keydown`,e=>{if(ki!==n||e.repeat||e.metaKey||e.ctrlKey||e.altKey||e.target instanceof HTMLSelectElement)return;let t=Si.indexOf(e.key.toLowerCase());t>=0&&h(Ci+t)}),window.addEventListener(`keyup`,e=>{let t=Si.indexOf(e.key.toLowerCase());t>=0&&g(Ci+t)}),n.append(t??r,u),n}var Ni=new b,Pi=nr.duo(),Fi=new u(Pi),$=Pi.device(`duo`);br($),$.loadSlot($.currentSlot);var Ii=document.createElement(`div`);Ii.className=`duo-wrap`,Ii.append(kr($,Fi),Mi($)),_i({id:`duo`,patch:Pi,engine:Fi,clock:Ni,self:`/duo/`,panel:Ii,ports:[{device:`duo`,jack:`out`,name:`MOA-DUO`}],onMidi:e=>$.handleMidi(e)});