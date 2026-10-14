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
`,l=.01,u=class{patch;ctx;compressors=new Map;grainViews=new Map;pipeViews=new Map;dfViews=new Map;duoViews=new Map;meters=new Map;constructor(e){this.patch=e}async start(){if(!this.ctx){let e=new AudioContext;await e.audioWorklet.addModule(j()),this.build(e)}await this.ctx?.resume()}async stop(){await this.ctx?.suspend()}get currentTime(){return this.ctx?.currentTime??0}readLevel(e,t){let n=this.meters.get(`${e}/${t}`);if(!n)return 0;n.analyser.getFloatTimeDomainData(n.buffer);let r=0;for(let e of n.buffer)r=Math.max(r,Math.abs(e));return r}readGranular(e,t){return this.grainViews.get(`${e}/${t}`)}readPipe(e,t){return this.pipeViews.get(`${e}/${t}`)}readDF(e,t){return this.dfViews.get(`${e}/${t}`)}readDuo(e,t){return this.duoViews.get(`${e}/${t}`)}readReduction(e,t){return this.compressors.get(`${e}/${t}`)?.reduction??0}build(e){this.ctx=e;let t=new Map;for(let[n,r]of this.patch.devices)t.set(n,this.compileCircuit(e,n,r.circuit));let n=(e,n,r)=>{let i=this.patch.device(e).jack(n,r).nodeId,a=t.get(e)?.get(i);if(!a)throw Error(`No audio node for ${e}.${r}`);return a};for(let e of this.patch.connections)n(e.from.device,`out`,e.from.jack).connect(n(e.to.device,`in`,e.to.jack));if(this.patch.output){let{device:t,jack:r}=this.patch.output;n(t,`out`,r).connect(e.destination)}}compileCircuit(t,r,a){let c=new Map;for(let l of a.nodes.values())switch(l.kind){case`oscillator`:{let e=t.createOscillator();e.type=l.options.waveform,e.frequency.value=l.params.frequency??440,e.detune.value=l.params.detune??0,e.start(),c.set(l.id,e);break}case`filter`:{let e=t.createBiquadFilter();e.type=l.options.type,e.frequency.value=l.params.frequency??350,e.Q.value=l.params.Q??1,e.gain.value=l.params.gain??0,e.detune.value=l.params.detune??0,c.set(l.id,e);break}case`envelope`:{let e=t.createConstantSource();e.offset.value=0,e.start(),c.set(l.id,e);break}case`convolver`:{let e=t.createConvolver();e.buffer=te(t,O[l.options.size??`medium`]??O.medium),c.set(l.id,e);break}case`follower`:{let e=new AudioWorkletNode(t,oe,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],parameterData:{attack:l.params.attack??.003,release:l.params.release??.12}});c.set(l.id,e);break}case`granular`:{let{maxTime:e,...n}=l.params,a=new AudioWorkletNode(t,i,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],parameterData:n,processorOptions:{seconds:e??20}});a.port.onmessage=e=>this.grainViews.set(`${r}/${l.id}`,e.data),c.set(l.id,a);break}case`pipe`:{let e=new AudioWorkletNode(t,o,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],parameterData:l.params});e.port.onmessage=e=>this.pipeViews.set(`${r}/${l.id}`,e.data),c.set(l.id,e);break}case`spring`:c.set(l.id,new AudioWorkletNode(t,s,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],parameterData:l.params}));break;case`df`:{let n=new AudioWorkletNode(t,e,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:`explicit`,parameterData:l.params});n.port.onmessage=e=>this.dfViews.set(`${r}/${l.id}`,e.data),c.set(l.id,n);break}case`duo`:{let e=new AudioWorkletNode(t,n,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],parameterData:l.params});e.port.onmessage=e=>this.duoViews.set(`${r}/${l.id}`,e.data),c.set(l.id,e);break}case`compressor`:{let e=t.createDynamicsCompressor();this.compressors.set(`${r}/${l.id}`,e),e.threshold.value=l.params.threshold??-24,e.knee.value=l.params.knee??30,e.ratio.value=l.params.ratio??12,e.attack.value=l.params.attack??.003,e.release.value=l.params.release??.25,c.set(l.id,e);break}case`delay`:{let e=t.createDelay(l.params.maxTime??1);e.delayTime.value=l.params.delayTime??.25,c.set(l.id,e);break}case`trigger`:{let e=t.createConstantSource();e.offset.value=0,e.start(),c.set(l.id,e);break}case`constant`:{let e=t.createConstantSource();e.offset.value=l.params.offset??0,e.start(),c.set(l.id,e);break}case`waveshaper`:{let e=t.createWaveShaper();l.options.curve===`pulse`?e.curve=S():l.options.curve===`soft`?e.curve=w():l.options.curve===`limit`?e.curve=T():l.options.curve===`warm`?e.curve=E():l.options.curve===`abs`?e.curve=ee():l.options.curve===`crush`&&(e.curve=D(l.params.bits??16)),e.oversample=`4x`,c.set(l.id,e);break}case`noise`:{let e=t.createBufferSource();e.buffer=ne(t),e.loop=!0,e.start(),c.set(l.id,e);break}case`random`:{let e=t.createBufferSource();e.buffer=ie(t),e.loop=!0,e.playbackRate.value=(l.params.rate??4)/k,e.start(),c.set(l.id,e);break}case`meter`:{let e=t.createAnalyser();e.fftSize=1024;let n=l.options.channel??`mono`;if(n===`mono`)c.set(l.id,e);else{let r=t.createChannelSplitter(2);r.connect(e,n===`left`?0:1),c.set(l.id,r)}this.meters.set(`${r}/${l.id}`,{analyser:e,buffer:new Float32Array(new ArrayBuffer(e.fftSize*4))});break}case`pan`:{let e=t.createStereoPanner();e.pan.value=l.params.pan??0,c.set(l.id,e);break}case`gain`:{let e=t.createGain();e.gain.value=l.params.gain??1,l.options.channels===`mono`&&(e.channelCount=1,e.channelCountMode=`explicit`),c.set(l.id,e);break}}for(let e of a.cables){let t=c.get(e.from),n=c.get(e.to);if(t&&n){if(e.port===`in`)t.connect(n);else{let r=d(n,e.port);r&&t.connect(r)}}}return a.onChange(e=>{let n=c.get(e.nodeId);if(!n)return;if(e.type===`note`||e.type===`gate`||e.type===`play`){n instanceof AudioWorkletNode&&n.port.postMessage(e);return}if(e.type===`trigger`||e.type===`choke`){n instanceof ConstantSourceNode&&(e.type===`trigger`?b(t,n.offset,a.node(e.nodeId).params,a.node(e.nodeId).options.shape,e.velocity,e.when):x(t,n.offset,e.when));return}if(a.node(e.nodeId).kind===`trigger`)return;if(n instanceof WaveShaperNode&&e.type===`param`&&e.name===`bits`){n.curve=D(e.value);return}if(a.node(e.nodeId).kind===`envelope`){n instanceof ConstantSourceNode&&e.type===`param`&&e.name===`gate`&&h(t,n.offset,a.node(e.nodeId).params,e.value>0);return}if(n instanceof AudioBufferSourceNode&&e.type===`param`&&e.name===`rate`){n.playbackRate.setTargetAtTime(e.value/k,t.currentTime,l);return}if(e.type===`option`){n instanceof OscillatorNode&&e.name===`waveform`||n instanceof BiquadFilterNode&&e.name===`type`?n.type=e.value:n instanceof ConvolverNode&&e.name===`size`&&(n.buffer=te(t,O[e.value]??O.medium));return}let r=d(n,e.name);a.node(e.nodeId).kind===`duo`&&p.test(e.name)||a.node(e.nodeId).kind===`df`&&m.test(e.name)?r?.setValueAtTime(e.value,t.currentTime):r?.setTargetAtTime(e.value,t.currentTime,ae(a,e.nodeId,e.name))}),c}};function d(e,t){if(e instanceof AudioWorkletNode)return e.parameters.get(t);let n=e[t];return n instanceof AudioParam?n:void 0}var f=.001,p=/Wave$|Sync$|Route$|Hold$|Lfo$|Off$/,m=/Type$|Src$|Inv$|Vca$|Gate$|Loop$|Exp$|Trig$|Link$|^mono$/;function h(e,t,n,r){let i=e.currentTime;if(t.cancelScheduledValues(i),t.setValueAtTime(t.value,i),r){let e=Math.max(n.attack??.01,f);t.linearRampToValueAtTime(1,i+e),t.setTargetAtTime(n.sustain??.7,i+e,Math.max(n.decay??.2,f)/3)}else t.setTargetAtTime(0,i,Math.max(n.release??.3,f)/3)}var g=.001,_=3,v=.0035,y=.005;function b(e,t,n,r,i,a){let o=n.velSens??1,s=(n.peak??1)*(1-o+o*i),c=Math.max(n.decay??.2,f)/4,l=Math.max(a??0,e.currentTime);if(t.cancelScheduledValues(l),t.setValueAtTime(t.value,l),t.linearRampToValueAtTime(s,l+g),r!==`clap`){t.setTargetAtTime(0,l+g,c);return}let u=Math.max(n.spread??.012,.002);t.setTargetAtTime(0,l+g,v);for(let e=1;e<=_;e++){let n=l+e*u;t.setValueAtTime(s,n),t.setTargetAtTime(0,n,e===_?c:v)}}function x(e,t,n){let r=Math.max(n??0,e.currentTime);t.cancelScheduledValues(r),t.setValueAtTime(t.value,r),t.setTargetAtTime(0,r,y)}function S(){let e=1024,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++)t[n]=n<e/2?-1:1;return t}var C=2.5;function w(){let e=2048,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++){let e=n/2047*2-1;t[n]=Math.tanh(C*e)/Math.tanh(C)}return t}function T(){let e=4097,t=new Float32Array(new ArrayBuffer(e*4)),n=.9;for(let r=0;r<e;r++){let e=r/4096*2-1,i=Math.abs(e);t[r]=Math.sign(e)*(i<n?i:n+.09999999999999998*Math.tanh((i-n)/.09999999999999998))}return t}function E(){let e=4097,t=new Float32Array(new ArrayBuffer(e*4)),n=.6;for(let r=0;r<e;r++){let e=r/4096*2-1,i=Math.abs(e)*3;t[r]=Math.sign(e)*(i<n?i:n+.4*Math.tanh((i-n)/.4))}return t}function ee(){let e=1025,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++)t[n]=Math.abs(n/1024*2-1);return t}function D(e){let t=8193,n=new Float32Array(new ArrayBuffer(t*4)),r=2**Math.max(1,Math.min(16,e))/2;for(let e=0;e<t;e++){let t=e/8192*2-1;n[e]=Math.round(t*r)/r}return n}var O={small:.9,medium:2.4,large:5};function te(e,t){let n=e.sampleRate,r=Math.floor(n*t),i=e.createBuffer(2,r,n),a=Math.log(1e3)/t;for(let e=0;e<2;e++){let t=i.getChannelData(e),o=0;for(let e=0;e<r;e++){let r=e/n,i=Math.exp(-a*r)*Math.min(1,r/.004),s=.75*Math.exp(-r*1.2)+.06;o+=s*(Math.random()*2-1-o),t[e]=o*i}}return i}function ne(e){let t=e.createBuffer(1,e.sampleRate*2,e.sampleRate),n=t.getChannelData(0);for(let e=0;e<n.length;e++)n[e]=Math.random()*2-1;return t}var re=64,k=10,A=8e3;function ie(e){let t=A/k,n=e.createBuffer(1,re*t,A),r=n.getChannelData(0);for(let e=0;e<re;e++)r.fill(Math.random()*2-1,e*t,(e+1)*t);return n}function ae(e,t,n){let r=e.node(t);return r.kind===`constant`&&n===`offset`&&r.params.glide?Math.max(r.params.glide/3,l):l}var oe=`moa-follower`,se=[`
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
`,a,c,t,r].join(`
`);function j(){return URL.createObjectURL(new Blob([se],{type:`text/javascript`}))}var M=class{listeners=new Set;onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}notify(){for(let e of this.listeners)e()}},N=class extends M{id;label;min;max;initial;unit;apply;curve;kind=`number`;current;constructor(e,t,n,r,i,a,o,s=`linear`){super(),this.id=e,this.label=t,this.min=n,this.max=r,this.initial=i,this.unit=a,this.apply=o,this.curve=s,this.current=ce(this.initial,n,r),this.apply(this.current)}get value(){return this.current}set(e){this.current=ce(e,this.min,this.max),this.apply(this.current),this.notify()}},P=class extends M{id;label;options;apply;kind=`choice`;current;constructor(e,t,n,r,i){if(super(),this.id=e,this.label=t,this.options=n,this.apply=i,!n.includes(r))throw Error(`Invalid initial choice ${r}`);this.current=r,this.apply(this.current)}get value(){return this.current}set(e){if(!this.options.includes(e))throw Error(`Invalid choice ${e} for ${this.id}`);this.current=e,this.apply(e),this.notify()}},F=class extends M{id;label;apply;kind=`toggle`;current;constructor(e,t,n,r){super(),this.id=e,this.label=t,this.apply=r,this.current=n,this.apply(n)}get value(){return this.current}set(e){this.current=e,this.apply(e),this.notify()}};function ce(e,t,n){return Math.min(n,Math.max(t,e))}var le=class{nodes=new Map;cables=[];listeners=new Set;add(e,t,n={},r={}){if(this.nodes.has(e))throw Error(`Duplicate node id: ${e}`);return this.nodes.set(e,{id:e,kind:t,params:{...n},options:{...r}}),this}connect(e,t,n=`in`){this.node(e);let r=this.node(t);if(n!==`in`&&!(n in r.params))throw Error(`Node ${t} has no param ${n}`);if(this.cables.some(r=>r.from===e&&r.to===t&&r.port===n))throw Error(`Duplicate cable ${e} -> ${t}.${n}`);return this.cables.push({from:e,to:t,port:n}),this}setParam(e,t,n){let r=this.node(e);if(!(t in r.params))throw Error(`Node ${e} has no param ${t}`);r.params[t]=n,this.emit({type:`param`,nodeId:e,name:t,value:n})}setOption(e,t,n){let r=this.node(e);if(!(t in r.options))throw Error(`Node ${e} has no option ${t}`);r.options[t]=n,this.emit({type:`option`,nodeId:e,name:t,value:n})}trigger(e,t=1,n){this.expectKind(e,`trigger`),this.emit({type:`trigger`,nodeId:e,velocity:Math.min(1,Math.max(0,t)),when:n})}choke(e,t){this.expectKind(e,`trigger`),this.emit({type:`choke`,nodeId:e,when:t})}noteOn(e,t,n=1){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:t,velocity:Math.min(1,Math.max(0,n))})}noteOff(e,t){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:t,velocity:0})}allNotesOff(e){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:-1,velocity:0})}pedal(e,t){this.expectKind(e,`pipe`),this.emit({type:`note`,nodeId:e,note:-2,velocity:+!!t})}play(e,t,n,r,i){this.expectKind(e,`duo`),this.emit({type:`play`,nodeId:e,n1:t,n2:n,gate:r,retrig:i})}gate(e,t,n){this.expectKind(e,`df`),this.emit({type:`gate`,nodeId:e,target:t,on:n})}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}node(e){let t=this.nodes.get(e);if(!t)throw Error(`Unknown node: ${e}`);return t}expectKind(e,...t){if(!t.includes(this.node(e).kind))throw Error(`Node ${e} is not a ${t.join(` or `)}`)}emit(e){for(let t of this.listeners)t(e)}},I=class{circuit=new le;controlList=[];inputList=[];outputList=[];meterList=[];get controls(){return this.controlList}get inputs(){return this.inputList}get outputs(){return this.outputList}get meters(){return this.meterList}control(e){let t=this.controlList.find(t=>t.id===e);if(!t)throw Error(`${this.name} has no control ${e}`);return t}jack(e,t){let n=(e===`in`?this.inputList:this.outputList).find(e=>e.name===t);if(!n)throw Error(`${this.name} has no ${e} jack ${t}`);return n}},ue=24,de=48,fe=12,pe=1e3,me=500,L=class{intervals=[];last;isRunning=!1;pulses=0;get running(){return this.isRunning}get ticks(){return this.pulses}get bpm(){if(this.intervals.length<fe)return;let e=[...this.intervals].sort((e,t)=>e-t),t=Math.floor(e.length/4),n=e.slice(t,e.length-t);return 6e4/(n.reduce((e,t)=>e+t,0)/n.length*ue)}isLocked(e){return this.last!==void 0&&this.intervals.length>=fe&&e-this.last<me}get position(){return he(this.pulses)}handle(e,t){switch(e.type){case`clock`:if(this.last!==void 0){let e=t-this.last;e>pe?this.intervals=[]:this.intervals.push(e),this.intervals.length>de&&this.intervals.shift()}this.last=t,this.isRunning&&this.pulses++;break;case`start`:this.isRunning=!0,this.pulses=0;break;case`continue`:this.isRunning=!0;break;case`stop`:this.isRunning=!1}}};function he(e){return{bar:Math.floor(e/96)+1,beat:Math.floor(e/ue)%4+1,sixteenth:Math.floor(e/(ue/4))%4+1}}var ge=[`internal`,`midi`],_e=[`omni`,...Array.from({length:16},(e,t)=>String(t+1))],ve=2e3,ye=4,be=class{clock;now;sync=new P(`transport.sync`,`Sync`,ge,`internal`,()=>{});followStartStop=new F(`transport.followStartStop`,`Start/stop`,!0,()=>{});channel=new P(`transport.channel`,`Channel`,_e,`1`,()=>{});tempo=new N(`transport.tempo`,`Tempo`,20,300,120,`BPM`,()=>{});taps=[];constructor(e,t=()=>performance.now()){this.clock=e,this.now=t}get synced(){return this.sync.value===`midi`}get bpm(){return this.synced?this.clock.bpm??this.tempo.value:this.tempo.value}get locked(){return this.synced&&this.clock.isLocked(this.now())}get running(){return this.synced&&this.followStartStop.value&&this.clock.running}get position(){return this.running?this.clock.position:he(0)}acceptsChannel(e){return this.channel.value===`omni`||Number(this.channel.value)===e}tap(e=this.now()){let t=this.taps[this.taps.length-1];if(t!==void 0&&e-t>ve&&(this.taps=[]),this.taps.push(e),this.taps.length>ye&&this.taps.shift(),this.taps.length>=2){let e=this.taps[this.taps.length-1]-this.taps[0];this.tempo.set(Math.round(6e4/(e/(this.taps.length-1))*10)/10)}}nudge(e){this.tempo.set(Math.round((this.tempo.value+e)*10)/10)}},R=[`kick`,`snare`,`clap`,`closedHat`,`openHat`,`ride`],xe={kick:`Kick`,snare:`Snare`,clap:`Clap`,closedHat:`Closed Hat`,openHat:`Open Hat`,ride:`Ride`},Se={35:`kick`,36:`kick`,38:`snare`,40:`snare`,39:`clap`,42:`closedHat`,44:`closedHat`,46:`openHat`,51:`ride`,59:`ride`},Ce=1200,we=[205.3,304.4,369.6,522.7,540,800],Te=class extends I{name;transport;choke=new F(`hats.choke`,`Choke`,!0,()=>{});muted=new Set;soloed=new Set;envelopes=new Map;hitListeners=new Set;constructor(e=`Drums`,t=new L){super(),this.name=e,this.transport=new be(t),this.transport.channel.set(`10`);let n=this.circuit;this.addKick(n),this.addSnare(n),this.addClap(n),this.addHat(n,`closedHat`,{decay:[.015,.25,.04],tone:.7,level:.6}),this.addHat(n,`openHat`,{decay:[.1,1.5,.32],tone:.65,level:.6}),this.addRide(n);for(let e of R)n.add(`${e}.mute`,`gain`,{gain:1}).add(`${e}.out`,`gain`,{gain:.8}).add(`${e}.meter`,`meter`,{},{channel:`mono`}).connect(`${e}.sum`,`${e}.mute`).connect(`${e}.mute`,`${e}.out`).connect(`${e}.out`,`${e}.meter`),this.outputList.push({name:e,nodeId:`${e}.out`}),this.meterList.push({name:e,nodeId:`${e}.meter`});this.addLevels(n),this.controlList.push(this.choke)}trigger(e,t=1,n){if(!(t<=0)){e===`closedHat`&&this.choke.value&&this.circuit.choke(`openHat.ampEnv`,n);for(let r of this.envelopes.get(e)??[])this.circuit.trigger(r,t,n);for(let r of this.hitListeners)r(e,t,n)}}onHit(e){return this.hitListeners.add(e),()=>this.hitListeners.delete(e)}handleMidi(e){if(e.type!==`noteOn`||!this.transport.acceptsChannel(e.channel))return;let t=Se[e.note];t&&this.trigger(t,e.velocity/127)}get soloActive(){return this.soloed.size>0}register(e,...t){this.envelopes.set(e,[...this.envelopes.get(e)??[],...t])}num(...e){let t=new N(...e);return this.controlList.push(t),t}addKick(e){this.register(`kick`,`kick.pitchEnv`,`kick.ampEnv`,`kick.clickEnv`),e.add(`kick.osc`,`oscillator`,{frequency:48,detune:0},{waveform:`sine`}).add(`kick.pitchEnv`,`trigger`,{peak:2700,decay:.05,velSens:0}).add(`kick.ampEnv`,`trigger`,{peak:.8,decay:.38,velSens:.8}).add(`kick.amp`,`gain`,{gain:0}).add(`kick.noise`,`noise`).add(`kick.clickHp`,`filter`,{frequency:2500,Q:.707},{type:`highpass`}).add(`kick.clickAmp`,`gain`,{gain:0}).add(`kick.clickEnv`,`trigger`,{peak:.24,decay:.012,velSens:1}).add(`kick.sum`,`gain`,{gain:1}).connect(`kick.pitchEnv`,`kick.osc`,`detune`).connect(`kick.osc`,`kick.amp`).connect(`kick.ampEnv`,`kick.amp`,`gain`).connect(`kick.amp`,`kick.sum`).connect(`kick.noise`,`kick.clickHp`).connect(`kick.clickHp`,`kick.clickAmp`).connect(`kick.clickEnv`,`kick.clickAmp`,`gain`).connect(`kick.clickAmp`,`kick.sum`),this.num(`kick.tune`,`Tune`,30,120,48,`Hz`,t=>e.setParam(`kick.osc`,`frequency`,t),`log`),this.num(`kick.decay`,`Decay`,.08,1,.38,`s`,t=>e.setParam(`kick.ampEnv`,`decay`,t),`log`),this.num(`kick.click`,`Click`,0,1,.4,``,t=>e.setParam(`kick.clickEnv`,`peak`,t*.6))}addSnare(e){this.register(`snare`,`snare.pitchEnv`,`snare.bodyEnv`,`snare.noiseEnv`),e.add(`snare.osc1`,`oscillator`,{frequency:190,detune:0},{waveform:`triangle`}).add(`snare.osc2`,`oscillator`,{frequency:347.7,detune:0},{waveform:`triangle`}).add(`snare.pitchEnv`,`trigger`,{peak:500,decay:.03,velSens:0}).add(`snare.bodyEnv`,`trigger`,{peak:.4,decay:.1,velSens:.7}).add(`snare.bodyAmp`,`gain`,{gain:0}).add(`snare.noise`,`noise`).add(`snare.noiseHp`,`filter`,{frequency:1800,Q:.707},{type:`highpass`}).add(`snare.noiseEnv`,`trigger`,{peak:.42,decay:.18,velSens:1}).add(`snare.noiseAmp`,`gain`,{gain:0}).add(`snare.sum`,`gain`,{gain:1}).connect(`snare.osc1`,`snare.bodyAmp`).connect(`snare.osc2`,`snare.bodyAmp`).connect(`snare.pitchEnv`,`snare.osc1`,`detune`).connect(`snare.pitchEnv`,`snare.osc2`,`detune`).connect(`snare.bodyEnv`,`snare.bodyAmp`,`gain`).connect(`snare.bodyAmp`,`snare.sum`).connect(`snare.noise`,`snare.noiseHp`).connect(`snare.noiseHp`,`snare.noiseAmp`).connect(`snare.noiseEnv`,`snare.noiseAmp`,`gain`).connect(`snare.noiseAmp`,`snare.sum`),this.num(`snare.tune`,`Tune`,120,300,190,`Hz`,t=>{e.setParam(`snare.osc1`,`frequency`,t),e.setParam(`snare.osc2`,`frequency`,t*1.83)},`log`),this.num(`snare.decay`,`Decay`,.08,.5,.18,`s`,t=>{e.setParam(`snare.noiseEnv`,`decay`,t),e.setParam(`snare.bodyEnv`,`decay`,t*.55)},`log`),this.num(`snare.snap`,`Snap`,0,1,.6,``,t=>e.setParam(`snare.noiseEnv`,`peak`,t*.7))}addClap(e){this.register(`clap`,`clap.env`),e.add(`clap.noise`,`noise`).add(`clap.bp`,`filter`,{frequency:1200,Q:1.5},{type:`bandpass`}).add(`clap.amp`,`gain`,{gain:0}).add(`clap.env`,`trigger`,{peak:2.3,decay:.24,velSens:.8,spread:.012},{shape:`clap`}).add(`clap.sum`,`gain`,{gain:1}).connect(`clap.noise`,`clap.bp`).connect(`clap.bp`,`clap.amp`).connect(`clap.env`,`clap.amp`,`gain`).connect(`clap.amp`,`clap.sum`),this.num(`clap.tone`,`Tone`,600,3e3,1200,`Hz`,t=>e.setParam(`clap.bp`,`frequency`,t),`log`),this.num(`clap.decay`,`Decay`,.08,.6,.24,`s`,t=>e.setParam(`clap.env`,`decay`,t),`log`),this.num(`clap.spread`,`Spread`,0,1,.5,``,t=>e.setParam(`clap.env`,`spread`,.006+t*.012))}addMetal(e,t,n,r,i,a){e.add(`${t}.tune`,`constant`,{offset:0}).add(`${t}.metal`,`gain`,{gain:a}).add(`${t}.bp`,`filter`,{frequency:r,Q:.8},{type:`bandpass`}).add(`${t}.hp`,`filter`,{frequency:i,Q:.707},{type:`highpass`}).connect(`${t}.metal`,`${t}.bp`).connect(`${t}.bp`,`${t}.hp`),we.forEach((r,i)=>{let a=`${t}.sq${i+1}`;e.add(a,`oscillator`,{frequency:r*n,detune:0},{waveform:`square`}).connect(`${t}.tune`,a,`detune`).connect(a,`${t}.metal`)})}addHat(e,t,n){this.register(t,`${t}.ampEnv`),this.addMetal(e,t,1,9e3,7e3,.45),e.add(`${t}.amp`,`gain`,{gain:0}).add(`${t}.ampEnv`,`trigger`,{peak:1,decay:n.decay[2],velSens:.8}).add(`${t}.sum`,`gain`,{gain:1}).connect(`${t}.hp`,`${t}.amp`).connect(`${t}.ampEnv`,`${t}.amp`,`gain`).connect(`${t}.amp`,`${t}.sum`),this.num(`${t}.tune`,`Tune`,0,1,.6,``,n=>e.setParam(`${t}.tune`,`offset`,(n-.6)*2*Ce)),this.num(`${t}.decay`,`Decay`,n.decay[0],n.decay[1],n.decay[2],`s`,n=>e.setParam(`${t}.ampEnv`,`decay`,n),`log`),this.num(`${t}.tone`,`Tone`,0,1,n.tone,``,n=>e.setParam(`${t}.hp`,`frequency`,3e3+n*7e3))}addRide(e){this.register(`ride`,`ride.ampEnv`,`ride.bellEnv`),this.addMetal(e,`ride`,1.3,6500,2500,.18),e.add(`ride.amp`,`gain`,{gain:0}).add(`ride.ampEnv`,`trigger`,{peak:1,decay:1.2,velSens:.8}).add(`ride.bell1`,`oscillator`,{frequency:2650,detune:0},{waveform:`sine`}).add(`ride.bell2`,`oscillator`,{frequency:4380,detune:0},{waveform:`sine`}).add(`ride.bellAmp`,`gain`,{gain:0}).add(`ride.bellEnv`,`trigger`,{peak:.2,decay:.9,velSens:.8}).add(`ride.sum`,`gain`,{gain:1}).connect(`ride.hp`,`ride.amp`).connect(`ride.ampEnv`,`ride.amp`,`gain`).connect(`ride.amp`,`ride.sum`).connect(`ride.tune`,`ride.bell1`,`detune`).connect(`ride.tune`,`ride.bell2`,`detune`).connect(`ride.bell1`,`ride.bellAmp`).connect(`ride.bell2`,`ride.bellAmp`).connect(`ride.bellEnv`,`ride.bellAmp`,`gain`).connect(`ride.bellAmp`,`ride.sum`),this.num(`ride.tune`,`Tune`,0,1,.5,``,t=>e.setParam(`ride.tune`,`offset`,(t-.5)*2*Ce)),this.num(`ride.decay`,`Decay`,.4,2.5,1.2,`s`,t=>{e.setParam(`ride.ampEnv`,`decay`,t),e.setParam(`ride.bellEnv`,`decay`,t*.75)},`log`),this.num(`ride.bell`,`Bell`,0,1,.45,``,t=>e.setParam(`ride.bellEnv`,`peak`,t*.45))}addLevels(e){let t={kick:.8,snare:.75,clap:.7,closedHat:.6,openHat:.6,ride:.55};for(let n of R)this.num(`${n}.level`,`Level`,0,1,t[n],``,t=>e.setParam(`${n}.out`,`gain`,t)),this.controlList.push(new F(`${n}.mute`,`Mute`,!1,e=>this.setFlag(this.muted,n,e)),new F(`${n}.solo`,`Solo`,!1,e=>this.setFlag(this.soloed,n,e)))}setFlag(e,t,n){n?e.add(t):e.delete(t);for(let e of R){let t=`${e}.mute`;if(!this.circuit.nodes.has(t))continue;let n=this.muted.has(e)||this.soloed.size>0&&!this.soloed.has(e);this.circuit.setParam(t,`gain`,+!n)}}},Ee=[`A`,`B`,`C`,`D`],De=[0,.4,.7,1],Oe=De.length-1,ke=6,Ae=.12,je=.05,Me=.1,Ne=()=>Object.fromEntries(R.map(e=>[e,Array(16).fill(0)]));function Pe(e,t){let n=Ne();for(let r of R)for(let i of e[r]??[])n[r][i]=t?t(r,i):i%4==0?3:i%2==0?2:1;return n}function Fe(){return[Pe({kick:[0,4,8,10,12],snare:[4,12],clap:[12],closedHat:[0,2,4,6,8,10,12],openHat:[14],ride:[3,7,11,15]}),Pe({kick:[0,4,8,12],clap:[4,12],closedHat:[0,4,8,12],openHat:[2,6,10,14]},(e,t)=>t%4==0?3:2),Pe({kick:[0,6,10],snare:[4,7,12,15],closedHat:[0,2,4,6,8,10,12,14]},(e,t)=>e===`snare`&&(t===7||t===15)?1:t%4==0?3:2),Ne()]}var Ie=class{drums;clock;now;listeners=new Set;pattern=new P(`seq.pattern`,`Pattern`,Ee,`A`,()=>this.notify());swing=new N(`seq.swing`,`Swing`,50,75,54,`%`,()=>{});patterns=Fe();playing=!1;nextStep=0;nextTime=0;counter=0;played=[];constructor(e,t,n){this.drums=e,this.clock=t,this.now=n}get externallyDriven(){return this.drums.transport.synced&&this.drums.transport.followStartStop.value}get running(){return this.externallyDriven?this.clock.running:this.playing}get activePattern(){return this.patterns[Ee.indexOf(this.pattern.value)]}level(e,t){return this.activePattern[e][t]}setLevel(e,t,n){this.activePattern[e][t]=Math.min(Oe,Math.max(0,Math.round(n))),this.notify()}cycle(e,t){this.setLevel(e,t,(this.level(e,t)+1)%(Oe+1))}clearPattern(){for(let e of R)this.activePattern[e].fill(0);this.notify()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}play(){this.externallyDriven||this.playing||(this.playing=!0,this.nextStep=0,this.nextTime=this.now()+je,this.counter=0,this.played=[])}stop(){this.playing=!1,this.played=[]}tick(){if(!this.playing||this.externallyDriven)return;let e=this.now();for(this.nextTime<e-Me&&(this.nextTime=e);this.nextTime<e+Ae;){let e=this.stepSeconds();this.scheduleStep(this.nextStep,this.nextTime,e),this.nextStep=(this.nextStep+1)%16,this.nextTime+=e}}handleMidi(e){if(this.externallyDriven){if(e.type===`start`)this.counter=0,this.played=[];else if(e.type===`stop`)this.played=[];else if(e.type===`clock`&&this.clock.running){let e=this.clock.ticks-1;if(e>=0&&e%ke===0){let t=e/ke%16;this.counter=e/ke,this.scheduleStep(t,this.now(),this.stepSeconds())}}}}currentStep(){if(!this.running)return;let e=this.now(),t;for(let n of this.played)n.time<=e&&(t=n.step);return t}get position(){if(this.externallyDriven)return this.clock.running?this.clock.position:he(0);if(!this.playing)return he(0);let e=this.now(),t=0;for(let n of this.played)n.time<=e&&(t=n.counter);return he(t*ke)}stepSeconds(){return 60/this.drums.transport.bpm/4}swingDelay(e,t){return e%2==1?(this.swing.value/100-.5)*2*t:0}scheduleStep(e,t,n){let r=t+this.swingDelay(e,n),i=this.activePattern;for(let t of R){let n=i[t][e];n>0&&this.drums.trigger(t,De[n],r)}this.played.push({step:e,counter:this.counter,time:r}),this.externallyDriven||this.counter++,this.played.length>64&&this.played.splice(0,this.played.length-64)}notify(){for(let e of this.listeners)e()}};function Le(e){let t=e[0];if(t===void 0)return;if(t>=240)switch(t){case 248:return{type:`clock`};case 250:return{type:`start`};case 251:return{type:`continue`};case 252:return{type:`stop`};default:return}let n=t&240,r=(t&15)+1,i=(e[1]??0)&127,a=(e[2]??0)&127;switch(n){case 128:return{type:`noteOff`,channel:r,note:i,velocity:a};case 144:return a===0?{type:`noteOff`,channel:r,note:i,velocity:0}:{type:`noteOn`,channel:r,note:i,velocity:a};case 176:return{type:`cc`,channel:r,controller:i,value:a};case 192:return{type:`programChange`,channel:r,program:i};case 224:return{type:`pitchBend`,channel:r,value:(a<<7|i)/8192-1};default:return}}var Re=[`C`,`C#`,`D`,`D#`,`E`,`F`,`F#`,`G`,`G#`,`A`,`A#`,`B`];function ze(e){return`${Re[e%12]}${Math.floor(e/12)-2}`}function Be(e){switch(e.type){case`noteOn`:case`noteOff`:return`note`;case`cc`:return`cc`;case`clock`:case`start`:case`continue`:case`stop`:return`clock`;default:return`other`}}function Ve(e){switch(e.type){case`noteOn`:return`ch${e.channel}  note on  ${ze(e.note)}  vel ${e.velocity}`;case`noteOff`:return`ch${e.channel}  note off  ${ze(e.note)}`;case`cc`:return`ch${e.channel}  cc ${e.controller}  = ${e.value}`;case`pitchBend`:return`ch${e.channel}  bend  ${e.value.toFixed(2)}`;case`programChange`:return`ch${e.channel}  program  ${e.program}`;case`clock`:return`clock`;default:return`clock ${e.type}`}}var He=40,Ue=class{lines=[];lastSeen={note:-1/0,cc:-1/0,clock:-1/0,other:-1/0};listeners=new Set;record(e,t){if(this.lastSeen[Be(e)]=t,e.type!==`clock`){this.lines.push({text:Ve(e),kind:Be(e)}),this.lines.length>He&&this.lines.shift();for(let e of this.listeners)e()}}clear(){this.lines.length=0;for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}},We=`moa.midiBus`,Ge=()=>performance.timeOrigin+performance.now(),Ke=class{now;later;enabled;onMessage;lastSeen=0;channel;listeners=new Set;constructor(e=`moa-midi`,t=Ge,n=(e,t)=>setTimeout(e,t),r){this.now=t,this.later=n,this.enabled=qe();let i=r??(typeof BroadcastChannel>`u`?void 0:e=>new BroadcastChannel(e));this.channel=i?.(e),this.channel&&(this.channel.onmessage=e=>{if(!this.enabled)return;let{at:t,data:n}=e.data;if(!Array.isArray(n)||typeof t!=`number`)return;this.lastSeen=performance.now();let r=t-this.now(),i=()=>this.onMessage?.(Uint8Array.from(n),performance.now());r<=1?i():this.later(i,r)})}get supported(){return this.channel!==void 0}send(e,t=this.now()){this.channel?.postMessage({at:t,data:Array.from(e)})}setEnabled(e){this.enabled=e;try{localStorage.setItem(We,e?`1`:`0`)}catch{}for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}close(){this.channel?.close()}};function qe(){try{return localStorage.getItem(We)!==`0`}catch{return!0}}var Je=`moa.midiInput`,Ye=`moa.midiOutput`,Xe=class{status=typeof navigator<`u`&&`requestMIDIAccess`in navigator?`idle`:`unsupported`;inputs=[];selectedId;outputs=[];selectedOutputId;onMessage;access;listeners=new Set;async connect(){if(this.status!==`unsupported`){try{this.access=await navigator.requestMIDIAccess({sysex:!1})}catch{this.status=`denied`,this.emit();return}this.status=`ready`,this.access.onstatechange=()=>this.refresh(),this.refresh()}}async connectIfPermitted(){if(this.status===`idle`)try{(await navigator.permissions.query({name:`midi`})).state===`granted`&&await this.connect()}catch{}}select(e){if(this.access)for(let e of this.access.inputs.values())e.onmidimessage=null;if(this.selectedId=e,e){let t=this.access?.inputs.get(e);t&&(t.onmidimessage=e=>{e.data&&this.onMessage?.(e.data,e.timeStamp)});try{localStorage.setItem(Je,e)}catch{}}this.emit()}selectOutput(e){this.selectedOutputId=e;try{e?localStorage.setItem(Ye,e):localStorage.removeItem(Ye)}catch{}this.emit()}send(e,t){let n=this.selectedOutputId?this.access?.outputs.get(this.selectedOutputId):void 0;n&&n.send(e,t===void 0?void 0:t-performance.timeOrigin)}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}refresh(){if(this.inputs=[...this.access?.inputs.values()??[]].map(e=>({id:e.id,name:e.name??e.id})),this.outputs=[...this.access?.outputs.values()??[]].map(e=>({id:e.id,name:e.name??e.id})),this.selectedOutputId&&!this.outputs.some(e=>e.id===this.selectedOutputId)&&(this.selectedOutputId=void 0),!this.selectedOutputId)try{let e=localStorage.getItem(Ye);e&&this.outputs.some(t=>t.id===e)&&(this.selectedOutputId=e)}catch{}this.selectedId&&this.inputs.some(e=>e.id===this.selectedId)?this.emit():this.select(this.pickDefault())}pickDefault(){let e=null;try{e=localStorage.getItem(Je)}catch{}return this.inputs.find(t=>t.id===e)?.id??this.inputs.find(e=>/torso|t-?1/i.test(e.name))?.id??(this.inputs.length===1?this.inputs[0]?.id:void 0)}emit(){for(let e of this.listeners)e()}},Ze={"bc.threshold":-18,"bc.ratio":4,"bc.attack":10,"bc.release":200,"bc.knee":6,"bc.makeup":3,"bc.mix":1,"bc.duck.depth":0,"bc.duck.release":120,"bc.duck.keyHp":80,"bc.bypass":0,"bc.listen":0},Qe=(e,t)=>({name:e,values:t}),$e=[Qe(`Init`,{}),Qe(`Glue`,{"bc.threshold":-14,"bc.ratio":2,"bc.attack":30,"bc.release":400,"bc.knee":12,"bc.makeup":2}),Qe(`Kick Duck`,{"bc.threshold":-6,"bc.ratio":1.5,"bc.makeup":0,"bc.duck.depth":.7,"bc.duck.release":140}),Qe(`Gentle Pump`,{"bc.threshold":-16,"bc.ratio":2,"bc.makeup":3,"bc.duck.depth":.35,"bc.duck.release":220}),Qe(`Hard Pump`,{"bc.threshold":-12,"bc.ratio":4,"bc.makeup":2,"bc.duck.depth":.95,"bc.duck.release":90,"bc.duck.keyHp":120}),Qe(`NY Parallel`,{"bc.threshold":-32,"bc.ratio":8,"bc.attack":3,"bc.release":100,"bc.knee":4,"bc.makeup":10,"bc.mix":.4}),Qe(`Drum Smash`,{"bc.threshold":-28,"bc.ratio":20,"bc.attack":1,"bc.release":200,"bc.knee":0,"bc.makeup":8,"bc.mix":.7}),Qe(`Limiter`,{"bc.threshold":-4,"bc.ratio":20,"bc.attack":1,"bc.release":100,"bc.knee":0,"bc.makeup":0})],et=4,tt=e=>10**(e/20);function nt(e,t,n){let r=e+n/2<0?e+(0-e)/t:0;return-.6*Math.min(0,r)}var rt=class extends I{name;slots=[...$e];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;mix=1;makeupDb=3;threshold=-18;ratio=4;knee=6;bypass=!1;listen=!1;constructor(e=`Bus Comp`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`duck`,`gain`,{gain:1}).add(`gate`,`gain`,{gain:1}).add(`comp`,`compressor`,{threshold:-18,knee:6,ratio:4,attack:.01,release:.2}).add(`wet`,`gain`,{gain:tt(3)}).add(`dry`,`gain`,{gain:0}).add(`bypassPath`,`gain`,{gain:0}).add(`listenPath`,`gain`,{gain:0}).add(`out`,`gain`,{gain:1}).add(`inMeter`,`meter`,{},{channel:`mono`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`inMeter`).connect(`in`,`duck`).connect(`duck`,`gate`).connect(`gate`,`comp`).connect(`gate`,`dry`).connect(`comp`,`wet`).connect(`wet`,`out`).connect(`dry`,`out`).connect(`in`,`bypassPath`).connect(`bypassPath`,`out`).connect(`listenPath`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),t.add(`key`,`gain`,{gain:1},{channels:`mono`}).add(`keyHp`,`filter`,{frequency:80,Q:.707,detune:0},{type:`highpass`}).add(`follow`,`follower`,{attack:.003,release:.12}).add(`sense`,`gain`,{gain:et}).add(`keyShape`,`waveshaper`,{},{curve:`soft`}).add(`duckMeter`,`meter`,{},{channel:`mono`}).add(`depth`,`gain`,{gain:0}).connect(`key`,`keyHp`).connect(`keyHp`,`follow`).connect(`follow`,`sense`).connect(`sense`,`keyShape`).connect(`keyShape`,`duckMeter`).connect(`keyShape`,`depth`).connect(`depth`,`duck`,`gain`).connect(`keyHp`,`listenPath`),this.inputList.push({name:`in`,nodeId:`in`},{name:`key`,nodeId:`key`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`in`,nodeId:`inMeter`},{name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`},{name:`duck`,nodeId:`duckMeter`});let n=Ze,r=(e,t,r,i,a,o,s)=>this.controlList.push(new N(e,t,r,i,n[e],a,o,s));r(`bc.threshold`,`Threshold`,-60,0,`dB`,e=>{this.threshold=e,t.setParam(`comp`,`threshold`,e),this.applyMix()}),r(`bc.ratio`,`Ratio`,1,20,`:1`,e=>{this.ratio=e,t.setParam(`comp`,`ratio`,e),this.applyMix()}),r(`bc.attack`,`Attack`,.3,100,`ms`,e=>t.setParam(`comp`,`attack`,e/1e3),`log`),r(`bc.release`,`Release`,30,1e3,`ms`,e=>t.setParam(`comp`,`release`,e/1e3),`log`),r(`bc.knee`,`Knee`,0,30,`dB`,e=>{this.knee=e,t.setParam(`comp`,`knee`,e),this.applyMix()}),r(`bc.makeup`,`Make-up`,0,24,`dB`,e=>{this.makeupDb=e,this.applyMix()}),r(`bc.mix`,`Mix`,0,1,``,e=>{this.mix=e,this.applyMix()}),r(`bc.duck.depth`,`Duck depth`,0,1,``,e=>t.setParam(`depth`,`gain`,-e)),r(`bc.duck.release`,`Duck release`,20,800,`ms`,e=>t.setParam(`follow`,`release`,e/1e3),`log`),r(`bc.duck.keyHp`,`Key HP`,20,300,`Hz`,e=>t.setParam(`keyHp`,`frequency`,e),`log`),this.controlList.push(new F(`bc.bypass`,`Bypass`,!1,e=>{this.bypass=e,this.applyPaths()}),new F(`bc.listen`,`Key listen`,!1,e=>{this.listen=e,this.applyPaths()}))}applyMix(){this.circuit.setParam(`dry`,`gain`,1-this.mix),this.circuit.setParam(`wet`,`gain`,this.mix*tt(this.makeupDb-nt(this.threshold,this.ratio,this.knee)))}applyPaths(){let e=this.circuit;e.setParam(`gate`,`gain`,this.bypass||this.listen?0:1),e.setParam(`bypassPath`,`gain`,this.bypass&&!this.listen?1:0),e.setParam(`listenPath`,`gain`,+!!this.listen)}loadPreset(e){let t={...Ze,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`bc.bypass`&&t.id!==`bc.listen`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}},it=[`small`,`medium`,`large`],at=3.5,ot=Math.tanh(2.5)/2.5,st=2,ct=class extends I{name;constructor(e=`Reverb`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`pre`,`delay`,{delayTime:.02,maxTime:.3}).add(`conv`,`convolver`,{},{size:`medium`}).add(`lowcut`,`filter`,{frequency:150,Q:.707,detune:0},{type:`highpass`}).add(`damp`,`filter`,{frequency:5e3,Q:.707,detune:0},{type:`lowpass`}).add(`drive`,`gain`,{gain:at*ot/st}).add(`sat`,`waveshaper`,{},{curve:`soft`}).add(`out`,`gain`,{gain:st}).connect(`in`,`pre`).connect(`pre`,`conv`).connect(`conv`,`lowcut`).connect(`lowcut`,`damp`).connect(`damp`,`drive`).connect(`drive`,`sat`).connect(`sat`,`out`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.controlList.push(new P(`reverb.size`,`Size`,it,`medium`,e=>t.setOption(`conv`,`size`,e)),new N(`reverb.predelay`,`Pre-delay`,0,250,20,`ms`,e=>t.setParam(`pre`,`delayTime`,e/1e3)),new N(`reverb.lowcut`,`Low cut`,40,600,150,`Hz`,e=>t.setParam(`lowcut`,`frequency`,e),`log`),new N(`reverb.damp`,`Damping`,1e3,16e3,5e3,`Hz`,e=>t.setParam(`damp`,`frequency`,e),`log`))}},lt=class extends I{name;spread=.8;feedback=.45;constructor(e=`Delay`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`out`,`gain`,{gain:.5}).add(`wobble`,`oscillator`,{frequency:.9,detune:0},{waveform:`sine`}).add(`wobbleDepth`,`gain`,{gain:6e-4});for(let e of[`L`,`R`]){let n=t=>`${t}${e}`;t.add(n(`inGain`),`gain`,{gain:1}).add(n(`dly`),`delay`,{delayTime:.375,maxTime:2}).add(n(`tone`),`filter`,{frequency:3200,Q:.707,detune:0},{type:`lowpass`}).add(n(`hp`),`filter`,{frequency:120,Q:.707,detune:0},{type:`highpass`}).add(n(`drive`),`gain`,{gain:1.9}).add(n(`sat`),`waveshaper`,{},{curve:`soft`}).add(n(`make`),`gain`,{gain:ot/1.9}).add(n(`fbSelf`),`gain`,{gain:0}).add(n(`fbCross`),`gain`,{gain:0}).add(n(`pan`),`pan`,{pan:e===`L`?-1:1}).connect(`in`,n(`inGain`)).connect(n(`inGain`),n(`dly`)).connect(n(`dly`),n(`tone`)).connect(n(`tone`),n(`hp`)).connect(n(`hp`),n(`drive`)).connect(n(`drive`),n(`sat`)).connect(n(`sat`),n(`make`)).connect(n(`make`),n(`fbSelf`)).connect(n(`make`),n(`fbCross`)).connect(n(`sat`),n(`pan`)).connect(n(`pan`),`out`).connect(`wobbleDepth`,n(`dly`),`delayTime`)}t.connect(`fbSelfL`,`dlyL`).connect(`fbCrossL`,`dlyR`).connect(`fbSelfR`,`dlyR`).connect(`fbCrossR`,`dlyL`).connect(`wobble`,`wobbleDepth`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`});let n=e=>{e(`L`),e(`R`)};this.controlList.push(new N(`delay.time`,`Time`,20,1500,375,`ms`,e=>n(n=>t.setParam(`dly${n}`,`delayTime`,e/1e3)),`log`),new N(`delay.feedback`,`Feedback`,0,1.1,.45,``,e=>{this.feedback=e,this.applyFeedback()}),new N(`delay.tone`,`Tone`,400,12e3,3200,`Hz`,e=>n(n=>t.setParam(`tone${n}`,`frequency`,e)),`log`),new N(`delay.spread`,`Ping-pong`,0,1,.8,``,e=>{this.spread=e,this.applyFeedback(),t.setParam(`inGainR`,`gain`,1-e)}),new N(`delay.wobble`,`Wobble`,0,1,.15,``,e=>t.setParam(`wobbleDepth`,`gain`,e*.004)),new N(`delay.drive`,`Drive`,0,1,.3,``,e=>{let r=1+e*3;n(e=>{t.setParam(`drive${e}`,`gain`,r),t.setParam(`make${e}`,`gain`,ot/r)})}))}applyFeedback(){let e=this.circuit;for(let t of[`L`,`R`])e.setParam(`fbSelf${t}`,`gain`,this.feedback*(1-this.spread)),e.setParam(`fbCross${t}`,`gain`,this.feedback*this.spread)}},ut=1,dt=2,ft=.8,pt={"gr.position":.3,"gr.size":120,"gr.pitch":0,"gr.rate":12,"gr.spread":.5,"gr.cloud":.2,"gr.detune":0,"gr.shape":.3,"gr.reverse":0,"gr.feedback":0,"gr.mix":1,"gr.freeze":0,"gr.filter":2e4,"gr.reso":.7,"gr.drive":0,"gr.reverb":0,"gr.tone":8e3,"gr.tail":`medium`,"gr.play":0,"gr.attack":20,"gr.decay":300,"gr.sustain":.8,"gr.release":600},mt=3.5,ht=2,gt=7,_t=(e,t)=>({name:e,values:t}),vt=[_t(`Init`,{}),_t(`Cloud Wash`,{"gr.position":.5,"gr.size":350,"gr.rate":30,"gr.spread":1,"gr.cloud":.6,"gr.detune":12,"gr.shape":0,"gr.reverb":.35,"gr.tail":`large`}),_t(`Frozen Pad`,{"gr.position":.15,"gr.size":700,"gr.rate":14,"gr.spread":.9,"gr.cloud":.25,"gr.detune":6,"gr.shape":0,"gr.freeze":1,"gr.filter":3500,"gr.reverb":.3,"gr.tail":`large`}),_t(`Stutter`,{"gr.position":.02,"gr.size":90,"gr.rate":8,"gr.spread":.2,"gr.cloud":0,"gr.shape":.7}),_t(`Octave Shimmer`,{"gr.position":.25,"gr.size":220,"gr.pitch":12,"gr.rate":24,"gr.spread":.8,"gr.cloud":.3,"gr.detune":8,"gr.feedback":.35,"gr.reverb":.25}),_t(`Reverse Swell`,{"gr.position":.35,"gr.size":900,"gr.rate":6,"gr.spread":.6,"gr.cloud":.15,"gr.shape":0,"gr.reverse":1}),_t(`Glitch Dust`,{"gr.position":.6,"gr.size":25,"gr.rate":70,"gr.spread":1,"gr.cloud":.9,"gr.detune":40,"gr.shape":.8,"gr.reverse":.3,"gr.drive":.35,"gr.filter":9e3,"gr.reso":3}),_t(`Tape Drone`,{"gr.position":.1,"gr.size":500,"gr.pitch":-12,"gr.rate":18,"gr.spread":.4,"gr.cloud":.1,"gr.detune":4,"gr.shape":0,"gr.feedback":.6,"gr.filter":1800,"gr.reso":2,"gr.drive":.25})],yt=class extends I{name;slots=[...vt];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;noteListeners=new Set;performanceListeners=new Set;held=[];bend=0;modWheelValue=0;pitchSemitones=0;constructor(e=`Granular`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`grains`,`granular`,{maxTime:20,position:.3,size:.12,pitch:0,rate:12,spread:.5,cloud:.2,detune:0,shape:.3,reverse:0,feedback:0,freeze:0,play:0,attack:.02,decay:.3,sustain:.8,release:.6}).add(`filter`,`filter`,{frequency:2e4,Q:.7,gain:0,detune:0},{type:`lowpass`}).add(`preDrive`,`gain`,{gain:1}).add(`sat`,`waveshaper`,{},{curve:`soft`}).add(`postDrive`,`gain`,{gain:ot}).add(`revSend`,`gain`,{gain:0}).add(`conv`,`convolver`,{},{size:`medium`}).add(`revTone`,`filter`,{frequency:8e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`revDrive`,`gain`,{gain:mt*ot/ht}).add(`revSat`,`waveshaper`,{},{curve:`soft`}).add(`revOut`,`gain`,{gain:ht}).add(`wet`,`gain`,{gain:1}).add(`dry`,`gain`,{gain:0}).add(`out`,`gain`,{gain:1}).add(`inMeter`,`meter`,{},{channel:`mono`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`grains`).connect(`in`,`dry`).connect(`in`,`inMeter`).connect(`grains`,`filter`).connect(`filter`,`preDrive`).connect(`preDrive`,`sat`).connect(`sat`,`postDrive`).connect(`postDrive`,`wet`).connect(`wet`,`out`).connect(`postDrive`,`revSend`).connect(`revSend`,`conv`).connect(`conv`,`revTone`).connect(`revTone`,`revDrive`).connect(`revDrive`,`revSat`).connect(`revSat`,`revOut`).connect(`revOut`,`out`).connect(`dry`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`in`,nodeId:`inMeter`},{name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=pt,r=(e,t,r,i,a,o,s)=>this.controlList.push(new N(e,t,r,i,n[e],a,o,s)),i=(e,n,i,a,o,s,c=1,l)=>r(e,n,i,a,o,e=>t.setParam(`grains`,s,e*c),l);i(`gr.position`,`Position`,0,1,``,`position`),i(`gr.size`,`Size`,5,2e3,`ms`,`size`,1/1e3,`log`),r(`gr.pitch`,`Pitch`,-24,24,`st`,e=>{this.pitchSemitones=e,this.applyPitch()}),i(`gr.rate`,`Rate`,.5,100,`Hz`,`rate`,1,`log`),i(`gr.spread`,`Spread`,0,1,``,`spread`),i(`gr.cloud`,`Cloud`,0,1,``,`cloud`),i(`gr.detune`,`Detune`,0,100,`ct`,`detune`),i(`gr.shape`,`Shape`,0,1,``,`shape`),i(`gr.reverse`,`Reverse`,0,1,``,`reverse`),i(`gr.feedback`,`Feedback`,0,.95,``,`feedback`),r(`gr.filter`,`Filter`,40,2e4,`Hz`,e=>t.setParam(`filter`,`frequency`,e),`log`),r(`gr.reso`,`Reso`,.7,12,``,e=>t.setParam(`filter`,`Q`,e),`log`),r(`gr.drive`,`Drive`,0,1,``,e=>{t.setParam(`preDrive`,`gain`,1+gt*e),t.setParam(`postDrive`,`gain`,ot/(1+2*e))}),r(`gr.reverb`,`Reverb`,0,1,``,e=>t.setParam(`revSend`,`gain`,e)),r(`gr.tone`,`Tone`,1e3,16e3,`Hz`,e=>t.setParam(`revTone`,`frequency`,e),`log`),r(`gr.mix`,`Mix`,0,1,``,e=>{t.setParam(`wet`,`gain`,e),t.setParam(`dry`,`gain`,1-e)}),r(`gr.attack`,`Attack`,1,4e3,`ms`,e=>t.setParam(`grains`,`attack`,e/1e3),`log`),r(`gr.decay`,`Decay`,5,4e3,`ms`,e=>t.setParam(`grains`,`decay`,e/1e3),`log`),r(`gr.sustain`,`Sustain`,0,1,``,e=>t.setParam(`grains`,`sustain`,e)),r(`gr.release`,`Release`,5,8e3,`ms`,e=>t.setParam(`grains`,`release`,e/1e3),`log`),this.controlList.push(new F(`gr.play`,`Keys`,!1,e=>{t.setParam(`grains`,`play`,+!!e),e||this.releaseAll()}),new P(`gr.channel`,`MIDI channel`,_e,`3`,()=>{}),new P(`gr.tail`,`Tail`,it,`medium`,e=>t.setOption(`conv`,`size`,e)),new F(`gr.freeze`,`Freeze`,!1,e=>t.setParam(`grains`,`freeze`,+!!e)))}applyPitch(){this.circuit.setParam(`grains`,`pitch`,this.pitchSemitones+this.bend*dt)}releaseAll(){if(this.circuit.allNotesOff(`grains`),this.held.length>0){this.held=[];for(let e of this.noteListeners)e()}}keyDown(e,t=ft){let n=this.control(`gr.play`);n.kind===`toggle`&&!n.value&&n.set(!0),this.held=this.held.filter(t=>t!==e),this.held.push(e),this.circuit.noteOn(`grains`,e,t);for(let e of this.noteListeners)e()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.circuit.noteOff(`grains`,e);for(let e of this.noteListeners)e()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.applyPitch();for(let e of this.performanceListeners)e()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e));for(let e of this.performanceListeners)e()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(!(`channel`in e))return;let t=this.control(`gr.channel`);if(!(t.kind!==`choice`||t.value!==`omni`&&Number(t.value)!==e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity/127);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===ut&&this.setModWheel(e.value/127);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...pt,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`gr.channel`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}},bt=[`series`,`parallel`,`pingpong`],xt=[`lfo`,`env`],St=[`tri`,`ramp`,`sqr`,`rnd`],Ct=[`lp`,`hp`],wt=[`a`,`b`],z=e=>e.toUpperCase(),Tt=.25,Et=3600,Dt=.8,Ot=.5,kt=1,At=8e-4,jt={"ouro.input":1,"ouro.mix":.5,"ouro.output":1,"ouro.routing":`parallel`,"ouro.kill":0,"ouro.freeze":0,"ouro.a.on":1,"ouro.a.gain":1,"ouro.a.delay":380,"ouro.a.grit":.15,"ouro.a.cutoff":3e3,"ouro.a.resonance":1.2,"ouro.a.filter":`lp`,"ouro.a.clip":.25,"ouro.a.level":1,"ouro.b.on":1,"ouro.b.gain":1,"ouro.b.delay":530,"ouro.b.grit":.15,"ouro.b.cutoff":2200,"ouro.b.resonance":1.2,"ouro.b.filter":`lp`,"ouro.b.clip":.25,"ouro.b.level":1,"ouro.fb.aa":.35,"ouro.fb.ab":.15,"ouro.fb.ba":.15,"ouro.fb.bb":.35,"ouro.mod.mode":`lfo`,"ouro.mod.wave":`tri`,"ouro.mod.rate":.8,"ouro.mod.depth":.4,"ouro.mod.trigger":0,"ouro.mod.dlyA":.15,"ouro.mod.dlyB":-.15,"ouro.mod.cutA":0,"ouro.mod.cutB":0,"ouro.mod.gainA":0,"ouro.mod.gainB":0},Mt=(e,t)=>({name:e,values:t}),Nt=[Mt(`Tape Spiral`,{"ouro.routing":`series`,"ouro.a.delay":240,"ouro.b.delay":360,"ouro.fb.aa":.35,"ouro.fb.bb":.4,"ouro.fb.ab":0,"ouro.fb.ba":.15,"ouro.a.grit":.35,"ouro.a.cutoff":2200,"ouro.b.cutoff":1800,"ouro.mod.rate":.4,"ouro.mod.depth":.6,"ouro.mod.dlyA":.3,"ouro.mod.dlyB":.2,"ouro.mod.cutA":.1}),Mt(`Karaoke Drone`,{"ouro.mix":.7,"ouro.fb.aa":.95,"ouro.fb.bb":.95,"ouro.a.gain":1.6,"ouro.b.gain":1.6,"ouro.a.grit":.5,"ouro.b.grit":.5,"ouro.a.clip":.6,"ouro.b.clip":.6,"ouro.a.delay":700,"ouro.b.delay":910,"ouro.a.cutoff":1400,"ouro.b.cutoff":1e3,"ouro.a.resonance":4,"ouro.b.resonance":4}),Mt(`Ping Pong Mayhem`,{"ouro.routing":`pingpong`,"ouro.mix":.6,"ouro.a.delay":280,"ouro.b.delay":280,"ouro.fb.ab":0,"ouro.fb.ba":.15,"ouro.fb.aa":.1,"ouro.fb.bb":.1,"ouro.a.resonance":.7,"ouro.b.resonance":.7,"ouro.a.grit":.1,"ouro.mod.depth":0}),Mt(`Dub Wash`,{"ouro.routing":`series`,"ouro.mix":.45,"ouro.a.delay":480,"ouro.b.delay":720,"ouro.fb.aa":.6,"ouro.fb.bb":.5,"ouro.fb.ab":.1,"ouro.fb.ba":.1,"ouro.a.cutoff":1800,"ouro.b.cutoff":1200,"ouro.a.resonance":2.5,"ouro.b.resonance":2.5,"ouro.a.clip":.2,"ouro.mod.rate":.25,"ouro.mod.depth":.5,"ouro.mod.cutA":.4,"ouro.mod.cutB":.3}),Mt(`Self Oscillator`,{"ouro.input":.2,"ouro.mix":1,"ouro.fb.aa":1.1,"ouro.fb.bb":1.1,"ouro.fb.ab":.3,"ouro.fb.ba":.3,"ouro.a.resonance":18,"ouro.b.resonance":18,"ouro.a.cutoff":800,"ouro.b.cutoff":1200,"ouro.a.clip":.5,"ouro.b.clip":.5,"ouro.a.delay":60,"ouro.b.delay":90,"ouro.mod.rate":.1,"ouro.mod.depth":.3,"ouro.mod.cutA":.5}),Mt(`Broken Echo`,{"ouro.a.grit":.85,"ouro.b.grit":.85,"ouro.a.delay":330,"ouro.b.delay":470,"ouro.fb.aa":.55,"ouro.fb.bb":.55,"ouro.a.clip":.7,"ouro.b.clip":.7,"ouro.mod.wave":`rnd`,"ouro.mod.rate":6,"ouro.mod.depth":.7,"ouro.mod.dlyA":.4,"ouro.mod.dlyB":-.3,"ouro.mod.gainA":.3}),Mt(`Filter Scream`,{"ouro.routing":`series`,"ouro.mix":.8,"ouro.a.filter":`hp`,"ouro.a.cutoff":2500,"ouro.a.resonance":16,"ouro.b.cutoff":1500,"ouro.b.resonance":16,"ouro.fb.aa":.6,"ouro.fb.bb":.6,"ouro.fb.ab":.2,"ouro.fb.ba":.1,"ouro.a.clip":.8,"ouro.b.clip":.8,"ouro.mod.wave":`ramp`,"ouro.mod.rate":2,"ouro.mod.depth":.8,"ouro.mod.cutA":.8,"ouro.mod.cutB":-.8}),Mt(`Slow Rot`,{"ouro.routing":`series`,"ouro.mix":.55,"ouro.a.delay":900,"ouro.b.delay":1300,"ouro.a.grit":.6,"ouro.b.grit":.6,"ouro.fb.aa":.55,"ouro.fb.bb":.55,"ouro.fb.ab":0,"ouro.fb.ba":.1,"ouro.a.cutoff":900,"ouro.b.cutoff":700,"ouro.a.resonance":1,"ouro.b.resonance":1,"ouro.mod.rate":.08,"ouro.mod.depth":.9,"ouro.mod.dlyA":.5,"ouro.mod.dlyB":.4,"ouro.a.level":.9,"ouro.b.level":.9})],Pt=class extends I{name;slots=[...Nt];currentSlot=0;currentPreset=this.slots[0];fb={aa:.35,ab:.15,ba:.15,bb:.35};on={a:!0,b:!0};clipDrive={a:1.25,b:1.25};routing=`parallel`;killed=!1;frozen=!1;modRate=.8;presetListeners=new Set;constructor(e=`Ouroboros`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`mono`,`gain`,{gain:1},{channels:`mono`}).add(`inGain`,`gain`,{gain:1}).add(`srcGate`,`gain`,{gain:1}).add(`srcA`,`gain`,{gain:1}).add(`srcB`,`gain`,{gain:1}).add(`dry`,`gain`,{gain:Math.SQRT1_2}).add(`wet`,`gain`,{gain:Math.SQRT1_2}).add(`sum`,`gain`,{gain:1}).add(`out`,`gain`,{gain:1}).connect(`in`,`mono`).connect(`mono`,`inGain`).connect(`inGain`,`srcGate`).connect(`srcGate`,`srcA`).connect(`srcGate`,`srcB`).connect(`in`,`dry`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`out`).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`L`,nodeId:`meterL`},{name:`R`,nodeId:`meterR`});for(let e of wt)this.addChannel(t,e);t.add(`linkAB`,`gain`,{gain:0}).add(`bounceBA`,`gain`,{gain:0}).connect(`lvlA`,`linkAB`).connect(`linkAB`,`inB`).connect(`lvlB`,`bounceBA`).connect(`bounceBA`,`inA`).connect(`srcA`,`inA`).connect(`srcB`,`inB`);for(let e of wt)for(let n of wt)t.add(`fb${z(e)}${z(n)}`,`gain`,{gain:0}).connect(`clip${z(e)}`,`fb${z(e)}${z(n)}`).connect(`fb${z(e)}${z(n)}`,`in${z(n)}`);t.add(`seedNoise`,`noise`).add(`seedGain`,`gain`,{gain:At}).connect(`seedNoise`,`seedGain`).connect(`seedGain`,`inA`).connect(`seedGain`,`inB`),this.addModulator(t),this.addControls(t),this.applyRouting(),this.applyFeedback()}loadPreset(e){let t={...jt,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`ouro.kill`&&t.id!==`ouro.mod.trigger`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}addChannel(e,t){let n=z(t);e.add(`in${n}`,`gain`,{gain:1}).add(`on${n}`,`gain`,{gain:1}).add(`g${n}`,`gain`,{gain:ot}).add(`sg${n}`,`waveshaper`,{},{curve:`soft`}).add(`dly${n}`,`delay`,{delayTime:.38,maxTime:2}).add(`tone${n}`,`filter`,{frequency:4800,Q:.707,detune:0},{type:`lowpass`}).add(`crush${n}`,`waveshaper`,{bits:16},{curve:`crush`}).add(`filt${n}`,`filter`,{frequency:3e3,Q:1.2,detune:0},{type:`lowpass`}).add(`cdrive${n}`,`gain`,{gain:ot}).add(`clip${n}`,`waveshaper`,{},{curve:`soft`}).add(`lvl${n}`,`gain`,{gain:1}).add(`send${n}`,`gain`,{gain:1}).add(`pan${n}`,`pan`,{pan:t===`a`?-1:1}).connect(`in${n}`,`on${n}`).connect(`on${n}`,`g${n}`).connect(`g${n}`,`sg${n}`).connect(`sg${n}`,`dly${n}`).connect(`dly${n}`,`tone${n}`).connect(`tone${n}`,`crush${n}`).connect(`crush${n}`,`filt${n}`).connect(`filt${n}`,`cdrive${n}`).connect(`cdrive${n}`,`clip${n}`).connect(`clip${n}`,`lvl${n}`).connect(`lvl${n}`,`send${n}`).connect(`send${n}`,`pan${n}`).connect(`pan${n}`,`wet`)}addModulator(e){e.add(`lfoOsc`,`oscillator`,{frequency:.8,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:.8}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfoGate`,`gain`,{gain:1}).add(`follow`,`waveshaper`,{},{curve:`abs`}).add(`followLp`,`filter`,{frequency:.8,Q:.707,detune:0},{type:`lowpass`}).add(`followGain`,`gain`,{gain:4}).add(`modTrig`,`trigger`,{peak:1,decay:.6,velSens:0}).add(`envGate`,`gain`,{gain:0}).add(`mod`,`gain`,{gain:1}).add(`modOut`,`gain`,{gain:.4}).connect(`lfoOsc`,`lfoOscOut`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoOscOut`,`lfoGate`).connect(`lfoRndOut`,`lfoGate`).connect(`inGain`,`follow`).connect(`follow`,`followLp`).connect(`followLp`,`followGain`).connect(`followGain`,`envGate`).connect(`modTrig`,`envGate`).connect(`lfoGate`,`mod`).connect(`envGate`,`mod`).connect(`mod`,`modOut`);for(let t of wt){let n=z(t);e.add(`mDly${n}`,`gain`,{gain:0}).add(`mCut${n}`,`gain`,{gain:0}).add(`mGain${n}`,`gain`,{gain:0}).connect(`modOut`,`mDly${n}`).connect(`mDly${n}`,`dly${n}`,`delayTime`).connect(`modOut`,`mCut${n}`).connect(`mCut${n}`,`filt${n}`,`detune`).connect(`modOut`,`mGain${n}`).connect(`mGain${n}`,`g${n}`,`gain`)}}addControls(e){let t=jt,n=e=>t[e],r=(e,t,r,i,a,o,s)=>this.controlList.push(new N(e,t,r,i,n(e),a,o,s)),i=(e,n,r,i)=>this.controlList.push(new P(e,n,r,t[e],i));r(`ouro.input`,`Input`,0,2,``,t=>e.setParam(`inGain`,`gain`,t)),r(`ouro.mix`,`Mix`,0,1,``,t=>{e.setParam(`dry`,`gain`,Math.cos(t*Math.PI/2)),e.setParam(`wet`,`gain`,Math.sin(t*Math.PI/2))}),r(`ouro.output`,`Output`,0,1.5,``,t=>e.setParam(`out`,`gain`,t)),i(`ouro.routing`,`Routing`,bt,e=>{this.routing=e,this.applyRouting(),this.applyFeedback()}),this.controlList.push(new F(`ouro.kill`,`Kill`,!1,e=>{this.killed=e,this.applyFeedback()}),new F(`ouro.freeze`,`Freeze`,!1,e=>{this.frozen=e,this.applyFeedback()}));for(let t of wt){let n=z(t),a=e=>`ouro.${t}.${e}`;this.controlList.push(new F(a(`on`),`On`,!0,r=>{this.on[t]=r,e.setParam(`on${n}`,`gain`,+!!r),this.applyFeedback()})),r(a(`gain`),`Gain`,.05,8,`×`,t=>e.setParam(`g${n}`,`gain`,t*ot),`log`),r(a(`delay`),`Delay`,10,1800,`ms`,t=>e.setParam(`dly${n}`,`delayTime`,t/1e3),`log`),r(a(`grit`),`Grit`,0,1,``,t=>e.setParam(`crush${n}`,`bits`,16-t*13)),r(a(`cutoff`),`Cutoff`,20,18e3,`Hz`,t=>e.setParam(`filt${n}`,`frequency`,t),`log`),r(a(`resonance`),`Resonance`,.1,30,``,t=>e.setParam(`filt${n}`,`Q`,t)),i(a(`filter`),`Filter`,Ct,t=>e.setOption(`filt${n}`,`type`,t===`hp`?`highpass`:`lowpass`)),r(a(`clip`),`Clip`,0,1,``,r=>{let i=1+r*7;e.setParam(`cdrive${n}`,`gain`,ot*i),this.clipDrive[t]=i,this.applyFeedback()}),r(a(`level`),`Level`,0,1.5,``,t=>e.setParam(`lvl${n}`,`gain`,t))}for(let[e,t]of[[`aa`,`A>A`],[`ab`,`A>B`],[`ba`,`B>A`],[`bb`,`B>B`]])r(`ouro.fb.${e}`,t,0,1.2,``,t=>{this.fb[e]=t,this.applyFeedback()});i(`ouro.mod.mode`,`Mode`,xt,t=>{e.setParam(`lfoGate`,`gain`,+(t===`lfo`)),e.setParam(`envGate`,`gain`,+(t===`env`))}),i(`ouro.mod.wave`,`Wave`,St,t=>{e.setOption(`lfoOsc`,`waveform`,t===`sqr`?`square`:t===`ramp`?`sawtooth`:`triangle`),e.setParam(`lfoOscOut`,`gain`,t===`rnd`?0:1),e.setParam(`lfoRndOut`,`gain`,+(t===`rnd`))}),r(`ouro.mod.rate`,`Rate`,.05,30,`Hz`,t=>{this.modRate=t,e.setParam(`lfoOsc`,`frequency`,t),e.setParam(`lfoRnd`,`rate`,t),e.setParam(`followLp`,`frequency`,t),e.setParam(`modTrig`,`decay`,Math.min(4,1.5/t))},`log`),r(`ouro.mod.depth`,`Depth`,0,1,``,t=>e.setParam(`modOut`,`gain`,t)),this.controlList.push(new F(`ouro.mod.trigger`,`Trigger`,!1,t=>{t&&e.trigger(`modTrig`,1)}));for(let t of wt){let n=z(t),i=(t,i,a,o)=>r(`ouro.mod.${t}${n}`,i,-1,1,``,t=>e.setParam(`${a}${n}`,`gain`,t*o));i(`dly`,`Delay ${n}`,`mDly`,Tt),i(`cut`,`Cutoff ${n}`,`mCut`,Et),i(`gain`,`Gain ${n}`,`mGain`,Dt)}}applyRouting(){let e=this.circuit,t=this.routing===`series`,n=this.routing===`parallel`;e.setParam(`srcB`,`gain`,+!!n),e.setParam(`sendA`,`gain`,+!t),e.setParam(`panA`,`pan`,-1),e.setParam(`panB`,`pan`,+!t)}applyFeedback(){let e=this.circuit;for(let t of wt)for(let n of wt){let r=`${t}${n}`,i=this.fb[r]/this.clipDrive[t];this.frozen&&t===n&&(i=kt/this.clipDrive[t]),(this.killed||!this.on[t]||!this.on[n])&&(i=0),e.setParam(`fb${z(t)}${z(n)}`,`gain`,i)}let t=this.routing!==`parallel`;e.setParam(`linkAB`,`gain`,t?1/this.clipDrive.a:0);let n=this.routing===`pingpong`&&!this.killed&&this.on.a&&this.on.b;e.setParam(`bounceBA`,`gain`,n?Ot/this.clipDrive.b:0),e.setParam(`srcGate`,`gain`,+!this.frozen)}},Ft={"osc1.wave":`saw`,"osc1.octave":`16`,"osc1.pw":0,"osc1.glide":0,"osc1.level":.8,"osc2.wave":`saw`,"osc2.octave":`8`,"osc2.detune":0,"osc2.glide":0,"osc2.level":.6,tune:0,sync:0,"vib.rate":5,"vib.level":0,noise:0,"route.vco":`nor`,"route.vcf":`lpf`,"route.mod":`single`,"filter.cutoff":1800,"filter.res":.2,"filter.post":0,"mod1.rise":.01,"mod1.fall":.5,"mod1.hold":0,"mod1.lfo":0,"mod1.level":.3,"mod2.rise":.01,"mod2.fall":.5,"mod2.hold":0,"mod2.lfo":0,"mod2.level":0,"vca.rise":.005,"vca.fall":.4,"vca.hold":1,"vca.lfo":0,"vca.level":.8,"reverb.time":.1,"reverb.decay":.35,"reverb.mix":.15,"play.legato":0,"play.mode":`duo`,"play.channel":0},It=[`play.channel`],B=(e,t)=>({name:e,values:t}),Lt=[B(`Init`,{}),B(`Fat Bass`,{"osc1.octave":`32`,"osc1.wave":`square`,"osc1.pw":.2,"osc2.octave":`16`,"osc2.detune":.1,"filter.cutoff":260,"filter.res":.35,"mod1.rise":.002,"mod1.fall":.35,"mod1.level":.55,"vca.fall":.2,"play.mode":`mono`}),B(`Hard Sync Lead`,{"osc1.octave":`16`,"osc2.octave":`8`,"osc2.detune":7,sync:1,"filter.cutoff":2600,"filter.res":.3,"mod2.level":.5,"route.mod":`dual`,"mod2.lfo":1,"mod2.rise":.35,"mod2.fall":.35,"vib.level":.3,"vib.rate":5.5,"osc1.glide":.15,"osc2.glide":.15}),B(`Dual Fifths`,{"osc1.octave":`16`,"osc2.octave":`16`,"osc2.detune":.01,"osc2.wave":`tri`,"filter.cutoff":1400,"mod1.level":.3,"mod1.fall":.8,"mod1.hold":1,"reverb.mix":.25,"reverb.decay":.5}),B(`Resonant Squelch`,{"osc1.octave":`16`,"osc1.wave":`square`,"osc2.level":.3,"filter.cutoff":200,"filter.res":.85,"mod1.rise":.002,"mod1.fall":.22,"mod1.level":.8,"vca.fall":.25,"play.mode":`mono`}),B(`Split Pad`,{"route.vco":`split`,"route.vcf":`even`,"route.mod":`split`,"osc1.octave":`16`,"osc2.octave":`8`,"osc2.wave":`tri`,"osc2.detune":.03,"filter.cutoff":700,"filter.post":1.2,"mod1.rise":.9,"mod1.fall":1.6,"mod1.hold":1,"mod1.level":.35,"mod2.rise":1.4,"mod2.fall":2,"mod2.hold":1,"mod2.level":.45,"vca.rise":.7,"vca.fall":1.6,"reverb.mix":.35,"reverb.decay":.6,"reverb.time":.3}),B(`Band Pass Voice`,{"route.vcf":`odd`,"route.vco":`half`,"osc1.octave":`16`,"osc2.octave":`8`,"osc2.detune":12,"filter.cutoff":900,"filter.res":.6,"filter.post":-.8,"mod1.rise":.1,"mod1.fall":.6,"mod1.level":.4}),B(`Wobble Bass`,{"osc1.octave":`32`,"osc2.octave":`16`,"osc2.detune":.08,"filter.cutoff":180,"filter.res":.6,"mod1.lfo":1,"mod1.rise":.18,"mod1.fall":.18,"mod1.level":.6,"play.mode":`mono`}),B(`Tremolo Organ`,{"osc1.wave":`square`,"osc1.octave":`16`,"osc2.wave":`tri`,"osc2.octave":`8`,"filter.cutoff":3500,"vca.lfo":1,"vca.hold":1,"vca.rise":.06,"vca.fall":.06,"vib.level":.1,"reverb.mix":.3}),B(`Noise Hat`,{"osc1.level":0,"osc2.level":0,noise:.9,"route.vcf":`hpf`,"filter.cutoff":7e3,"filter.res":.2,"vca.hold":0,"vca.rise":.001,"vca.fall":.09,"reverb.mix":.1}),B(`Ringing Filters`,{"route.vco":`vca`,"route.vcf":`even`,"osc1.level":.05,"osc2.level":0,"filter.cutoff":300,"filter.post":.6,"filter.res":1,"mod1.level":.2,"mod1.rise":.01,"mod1.fall":.6,"vca.rise":.01,"vca.fall":.5,"reverb.mix":.3}),B(`Infinite Cathedral`,{"osc1.octave":`8`,"osc2.octave":`8`,"osc2.wave":`tri`,"osc2.detune":.02,"filter.cutoff":2200,"mod1.level":.2,"vca.rise":.5,"vca.fall":2.5,"reverb.mix":.7,"reverb.decay":1,"reverb.time":.5}),B(`Pulse Sweep`,{"osc1.wave":`square`,"osc1.pw":.7,"osc1.octave":`16`,"osc2.octave":`16`,"filter.cutoff":500,"filter.res":.4,"mod1.rise":1.4,"mod1.fall":1.8,"mod1.hold":1,"mod1.level":.7,"vca.rise":.3}),B(`Glide Mono`,{"osc1.octave":`16`,"osc2.octave":`16`,"osc2.detune":.01,"osc1.glide":.35,"osc2.glide":.35,"filter.cutoff":1100,"filter.res":.45,"mod1.level":.4,"mod1.fall":.4,"play.mode":`mono`,"play.legato":1}),B(`Dual Detune Strings`,{"osc1.octave":`8`,"osc2.octave":`8`,"osc2.detune":.12,"filter.cutoff":1900,"mod1.level":.15,"vca.rise":.25,"vca.fall":.9,"vib.level":.15,"vib.rate":5.8,"reverb.mix":.3,"reverb.decay":.55}),B(`Hoover`,{"osc1.wave":`square`,"osc1.pw":.35,"osc1.octave":`16`,"osc2.wave":`saw`,"osc2.octave":`16`,"osc2.detune":0,tune:42,"osc1.glide":.45,"osc2.glide":.5,"osc1.level":.8,"osc2.level":.8,"filter.cutoff":2600,"filter.res":.45,"route.mod":`dual`,"mod1.level":.15,"mod1.fall":.6,"mod1.hold":1,"mod2.lfo":1,"mod2.rise":.4,"mod2.fall":.4,"mod2.level":.5,"vib.level":.3,"vib.rate":6.5,"vca.fall":.5,"reverb.mix":.3,"reverb.decay":.45,"reverb.time":.2,"play.legato":1}),B(`Filter Echo`,{"osc1.octave":`16`,"osc2.octave":`8`,"osc2.detune":12,"route.mod":`dual`,"filter.cutoff":800,"filter.res":.55,"mod2.lfo":1,"mod2.rise":.25,"mod2.fall":.4,"mod2.level":.5,"mod1.level":.4,"reverb.mix":.4,"reverb.decay":.75,"reverb.time":.4})],Rt=Array.from({length:24},(e,t)=>Lt[t]??B(`Init`,{})),zt=1,Bt=64,Vt={32:-24,16:-12,8:0},Ht={16:-12,8:0,4:12},Ut=`o1Wave.o1Off.o1Pw.o1Lvl.o1Gld.o2Wave.o2Off.o2Dtn.o2Lvl.o2Gld.tune.sync.vibRate.vibLvl.noise.vcoRoute.vcfRoute.modRoute.cutoff.res.post.m1Rise.m1Fall.m1Hold.m1Lfo.m1Lvl.m2Rise.m2Fall.m2Hold.m2Lfo.m2Lvl.vcaRise.vcaFall.vcaHold.vcaLfo.level.rvTime.rvDecay.rvMix.bend.modw`.split(`.`),Wt=class extends I{name;bendRange=3;slots=[...Rt];currentSlot=0;currentPreset=this.slots[0];held=[];latched=new Set;pedal=!1;bend=0;modWheelValue=0;gate=!1;lastChannel=1;lockedChannel;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`MOA-DUO`){super(),this.name=e;let t=this.circuit;t.add(`synth`,`duo`,Object.fromEntries(Ut.map(e=>[e,0]))).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`synth`,`meterL`).connect(`synth`,`meterR`),this.outputList.push({name:`out`,nodeId:`synth`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=Ft,r=e=>n=>t.setParam(`synth`,e,n),i=(e,t,i,a,o,s,c)=>this.controlList.push(new N(e,t,i,a,n[e],o,r(s),c)),a=(e,t,i,a,o)=>this.controlList.push(new P(e,t,i,n[e],e=>r(a)(o?o(e):i.indexOf(e)))),o=(e,t,i)=>this.controlList.push(new F(e,t,n[e]>0,e=>r(i)(+!!e)));a(`osc1.wave`,`Wave`,[`saw`,`square`],`o1Wave`),a(`osc1.octave`,`Octave`,[`32`,`16`,`8`],`o1Off`,e=>Vt[e]),i(`osc1.pw`,`Pulse width`,0,1,``,`o1Pw`),i(`osc1.glide`,`Glide`,0,1,``,`o1Gld`),i(`osc1.level`,`Level`,0,1,``,`o1Lvl`),a(`osc2.wave`,`Wave`,[`saw`,`tri`],`o2Wave`),a(`osc2.octave`,`Octave`,[`16`,`8`,`4`],`o2Off`,e=>Ht[e]),i(`osc2.detune`,`Detune`,0,24,`st`,`o2Dtn`),i(`osc2.glide`,`Glide`,0,1,``,`o2Gld`),i(`osc2.level`,`Level`,0,1,``,`o2Lvl`),i(`tune`,`Tune`,-100,100,`ct`,`tune`),o(`sync`,`Sync`,`sync`),i(`vib.rate`,`Vibrato rate`,.1,20,`Hz`,`vibRate`,`log`),i(`vib.level`,`Vibrato level`,0,1,``,`vibLvl`),i(`noise`,`Noise`,0,1,``,`noise`),a(`route.vco`,`VCO routing`,[`nor`,`split`,`half`,`vca`],`vcoRoute`),a(`route.vcf`,`VCF routing`,[`lpf`,`hpf`,`even`,`odd`],`vcfRoute`),a(`route.mod`,`Mod routing`,[`single`,`dual`,`split`,`odd`],`modRoute`),i(`filter.cutoff`,`Cutoff`,20,2e4,`Hz`,`cutoff`,`log`),i(`filter.res`,`Resonance`,0,1,``,`res`),i(`filter.post`,`Post`,-4,4,`oct`,`post`);for(let[e,t]of[[`1`,`m1`],[`2`,`m2`],[`vca`,`vca`]]){let n=e===`vca`?`vca`:`mod${e}`;i(`${n}.rise`,`Rise`,.001,5,`s`,`${t}Rise`,`log`),i(`${n}.fall`,`Fall`,.01,15,`s`,`${t}Fall`,`log`),o(`${n}.hold`,`Hold`,`${t}Hold`),o(`${n}.lfo`,`LFO`,`${t}Lfo`),e!==`vca`&&i(`${n}.level`,`Level`,0,1,``,`${t}Lvl`)}i(`vca.level`,`Level`,0,1.5,``,`level`),i(`reverb.time`,`Time`,0,1,``,`rvTime`),i(`reverb.decay`,`Decay`,0,1,``,`rvDecay`),i(`reverb.mix`,`Mix`,0,1,``,`rvMix`),this.controlList.push(new F(`play.legato`,`Legato`,n[`play.legato`]>0,()=>void 0),new P(`play.mode`,`Mode`,[`mono`,`duo`],n[`play.mode`],()=>void 0),new F(`play.channel`,`Channel lock`,!1,()=>void 0))}keyDown(e){let t=this.held.length===0;this.held=this.held.filter(t=>t!==e),this.held.push(e),this.latched.delete(e),this.sendNotes(t||!this.legato),this.notifyNotes()}keyUp(e){this.held.includes(e)&&(this.pedal?this.latched.add(e):this.release(e))}release(e){this.held=this.held.filter(t=>t!==e),this.latched.delete(e),this.sendNotes(!1),this.notifyNotes()}releaseLatched(){for(let e of[...this.latched])this.release(e)}get legato(){return this.control(`play.legato`).value}assign(){let e=this.held;if(e.length===0)return;let t=e[e.length-1];if(this.control(`play.mode`).value===`mono`||e.length===1)return{n1:t,n2:t};let n=Math.min(...e),r=Math.max(...e);return e.length===2?{n1:n,n2:r}:{n1:n,n2:t>n?t:r}}sendNotes(e){let t=this.assign();t?(this.gate=!0,this.circuit.play(`synth`,t.n1,t.n2,!0,e)):this.gate&&(this.gate=!1,this.circuit.play(`synth`,this.lastN1,this.lastN2,!1,!1)),t&&(this.lastN1=t.n1,this.lastN2=t.n2)}lastN1=60;lastN2=60;get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`synth`,`bend`,this.bend*3),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`synth`,`modw`,this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(`channel`in e){if(!this.control(`play.channel`).value)this.lastChannel=e.channel,this.lockedChannel=void 0;else if(this.lockedChannel??=this.lastChannel,e.channel!==this.lockedChannel)return;switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===zt?this.setModWheel(e.value/127):e.controller===Bt&&(this.pedal=e.value>=64,this.pedal||this.releaseLatched());break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.currentPreset=t,this.applyValues({...Ft,...t.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){if(It.includes(t))continue;let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)It.includes(t.id)||(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyPreset(){for(let e of this.presetListeners)e()}},Gt={"f1.type":`GEN LP`,"f1.cutoff":1200,"f1.res":.25,"f1.depth":0,"f1.source":`env`,"f1.inv":0,"f1.noise":0,"f1.vca":0,"f1.gate":0,"f1.threshold":.3,"f2.type":`GEN LP`,"f2.cutoff":1200,"f2.res":.25,"f2.depth":0,"f2.source":`env`,"f2.inv":0,"f2.noise":0,"f2.vca":0,"f2.gate":0,"f2.threshold":.3,"env1.attack":.01,"env1.decay":.3,"env1.sustain":.6,"env1.release":.4,"env1.mode":`adsr`,"env1.curve":`lin`,"env1.trig":`keys`,"env2.attack":.01,"env2.decay":.3,"env2.sustain":.6,"env2.release":.4,"env2.mode":`adsr`,"env2.curve":`lin`,"env2.trig":`keys`,"link.env":0,"link.cutoff":0,"sh.rate":4,"sh.slew":.2,"sh.source":`noise`,"delay.time":.25,"delay.repeats":.3,"delay.level":0,"delay.mod":0,"delay.source":`s&h`,"mix.a":.8,"mix.b":.8,"mix.mode":`stereo`,"mix.volume":.8},V=(e,t)=>({name:e,values:t}),Kt=e=>{let t={};for(let[n,r]of Object.entries(e))t[`f1.${n}`]=r,t[`f2.${n}`]=r;return t},qt=[V(`Init`,{}),V(`Dynamic Pluck`,{...Kt({cutoff:180,res:.45,depth:.85,vca:1}),"env1.attack":.002,"env1.decay":.22,"env1.sustain":0,"env1.release":.2,"env1.curve":`exp`,"link.env":1,"delay.level":.2,"delay.time":.18,"delay.repeats":.3}),V(`Auto Wah`,{"f1.type":`GEN BP`,"f1.cutoff":350,"f1.res":.7,"f1.depth":.7,"f2.type":`GEN BP`,"f2.cutoff":500,"f2.res":.7,"f2.depth":.7,"env1.trig":`thresh`,"f1.gate":1,"f1.threshold":.35,"env1.attack":.004,"env1.decay":.18,"env1.sustain":.1,"env1.release":.15,"env1.curve":`exp`,"link.env":1}),V(`Screaming Madman`,{"f1.type":`GEN LP`,"f1.cutoff":300,"f1.res":.93,"f1.depth":.6,"f2.type":`GEN HP`,"f2.cutoff":900,"f2.res":.9,"f2.depth":-.4,"env1.attack":.01,"env1.decay":.5,"env1.sustain":.2,"env1.release":.6,"link.env":1,"mix.a":.6,"mix.b":.45}),V(`Silk Sweep`,{...Kt({type:`2045 LP`,cutoff:250,res:.35,depth:.7}),"env1.attack":.45,"env1.decay":1.2,"env1.sustain":.7,"env1.release":1.5,"link.env":1,"delay.level":.25,"delay.time":.38,"delay.repeats":.45}),V(`Ringing 2045`,{"f1.type":`2045 LP`,"f1.cutoff":520,"f1.res":.96,"f1.depth":.3,"f2.type":`2045 LP`,"f2.cutoff":780,"f2.res":.96,"f2.depth":.3,"env1.attack":.05,"env1.sustain":.5,"link.env":1,"mix.a":.5,"mix.b":.5}),V(`Twin Peaks`,{...Kt({type:`BP+`,cutoff:700,res:.78,depth:.5}),"f2.cutoff":1100,"env1.attack":.02,"env1.decay":.6,"env1.sustain":.4,"env1.release":.5,"link.env":1}),V(`Phase Rooms`,{"f1.type":`NOTCH+`,"f1.cutoff":600,"f1.res":.6,"f1.depth":.8,"f1.source":`s&h`,"f2.type":`BANDSTOP+`,"f2.cutoff":900,"f2.res":.5,"f2.depth":.8,"sh.rate":1.2,"sh.slew":.65,"sh.source":`noise`}),V(`Random Steps`,{...Kt({cutoff:400,res:.6,depth:.9,source:`s&h`}),"f2.type":`GEN BP`,"sh.rate":7,"sh.slew":.05,"delay.level":.3,"delay.time":.21,"delay.repeats":.4,"delay.mod":.4,"delay.source":`s&h`}),V(`Looping LFO`,{...Kt({type:`2045 LP`,cutoff:300,res:.55,depth:.7}),"env1.mode":`loop`,"env1.attack":.35,"env1.release":.55,"link.env":1}),V(`Tremolo Gate`,{...Kt({cutoff:8e3,res:.1,depth:0,vca:1}),"env1.mode":`loop`,"env1.attack":.01,"env1.release":.09,"env1.curve":`exp`,"link.env":1}),V(`Crunch Echo`,{...Kt({type:`GEN LP`,cutoff:2400,res:.4}),"delay.level":.7,"delay.time":.42,"delay.repeats":.7,"delay.mod":.25,"delay.source":`env2`,"env2.mode":`loop`,"env2.attack":1.2,"env2.release":1.6}),V(`Noise Drums`,{"f1.type":`GEN BP`,"f1.cutoff":180,"f1.res":.8,"f1.depth":.8,"f1.noise":.9,"f1.vca":1,"f2.type":`GEN HP`,"f2.cutoff":3e3,"f2.res":.4,"f2.noise":.7,"f2.vca":1,"env1.attack":.001,"env1.decay":.12,"env1.sustain":0,"env1.release":.1,"env1.curve":`exp`,"env2.attack":.001,"env2.decay":.05,"env2.sustain":0,"env2.release":.05,"env2.curve":`exp`}),V(`Ghost Pad`,{"f1.type":`2045 LP`,"f1.cutoff":400,"f1.res":.5,"f1.depth":.5,"f1.noise":.15,"f2.type":`BANDSTOP+`,"f2.cutoff":1200,"f2.res":.4,"f2.depth":-.5,"env1.attack":.8,"env1.release":2,"env2.attack":1.5,"env2.release":2.5,"delay.level":.4,"delay.time":.5,"delay.repeats":.6}),V(`Mono Squelch`,{"f1.type":`2045 LP`,"f1.cutoff":120,"f1.res":.88,"f1.depth":.95,"f1.vca":1,"f2.type":`GEN LP`,"f2.cutoff":200,"f2.res":.85,"f2.depth":.9,"f2.vca":1,"env1.attack":.002,"env1.decay":.25,"env1.sustain":.15,"env1.release":.15,"env1.curve":`exp`,"link.env":1,"mix.mode":`mono`})],Jt=Array.from({length:16},(e,t)=>qt[t]??V(`Init`,{})),Yt=[`GEN LP`,`GEN BP`,`GEN HP`,`GEN NOTCH`,`2045 LP`,`BP+`,`NOTCH+`,`BANDSTOP+`],Xt=[`Type`,`Cut`,`Res`,`Depth`,`Src`,`Inv`,`Noise`,`Vca`,`Thr`,`Gate`].flatMap(e=>[`f1${e}`,`f2${e}`]).concat([`e1`,`e2`].flatMap(e=>[`Atk`,`Dec`,`Sus`,`Rel`,`Loop`,`Exp`,`Trig`].map(t=>e+t)),[`envLink`,`cutLink`,`shRate`,`shSlew`,`shSrc`,`dlTime`,`dlRep`,`dlLevel`,`dlMod`,`dlSrc`,`mixA`,`mixB`,`mono`,`vol`]),Zt=class extends I{name;slots=[...Jt];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;constructor(e=`MOA-DF2`){super(),this.name=e;let t=this.circuit;t.add(`box`,`df`,Object.fromEntries(Xt.map(e=>[e,0]))).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`box`,`meterL`).connect(`box`,`meterR`),this.inputList.push({name:`in`,nodeId:`box`}),this.outputList.push({name:`out`,nodeId:`box`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=Gt,r=e=>n=>t.setParam(`box`,e,n),i=(e,t,i,a,o,s,c)=>this.controlList.push(new N(e,t,i,a,n[e],o,r(s),c)),a=(e,t,i,a)=>this.controlList.push(new P(e,t,i,n[e],e=>r(a)(i.indexOf(e)))),o=(e,t,i)=>this.controlList.push(new F(e,t,n[e]>0,e=>r(i)(+!!e)));for(let e of[`1`,`2`]){let t=`f${e}`;a(`${t}.type`,`Filter type`,Yt,`${t}Type`),i(`${t}.cutoff`,`Cutoff`,20,2e4,`Hz`,`${t}Cut`,`log`),i(`${t}.res`,`Resonance`,0,1,``,`${t}Res`),i(`${t}.depth`,`Depth`,-1,1,``,`${t}Depth`),a(`${t}.source`,`Source`,[`env`,`s&h`],`${t}Src`),o(`${t}.inv`,`Invert env`,`${t}Inv`),i(`${t}.noise`,`Noise`,0,1,``,`${t}Noise`),o(`${t}.vca`,`VCA`,`${t}Vca`),i(`${t}.threshold`,`Threshold`,0,1,``,`${t}Thr`),o(`${t}.gate`,`Gate on`,`${t}Gate`)}for(let e of[`1`,`2`]){let t=`env${e}`,n=`e${e}`;i(`${t}.attack`,`Attack`,.001,10,`s`,`${n}Atk`,`log`),i(`${t}.decay`,`Decay`,.005,10,`s`,`${n}Dec`,`log`),i(`${t}.sustain`,`Sustain`,0,1,``,`${n}Sus`),i(`${t}.release`,`Release`,.005,20,`s`,`${n}Rel`,`log`),a(`${t}.mode`,`Mode`,[`adsr`,`loop`],`${n}Loop`),a(`${t}.curve`,`Curve`,[`lin`,`exp`],`${n}Exp`),a(`${t}.trig`,`Gate from`,[`keys`,`thresh`],`${n}Trig`)}o(`link.env`,`Env I link`,`envLink`),o(`link.cutoff`,`Cutoff link`,`cutLink`),i(`sh.rate`,`Rate`,.05,40,`Hz`,`shRate`,`log`),i(`sh.slew`,`Slew`,0,1,``,`shSlew`),a(`sh.source`,`Source`,[`noise`,`env`],`shSrc`),i(`delay.time`,`Time`,.02,.6,`s`,`dlTime`,`log`),i(`delay.repeats`,`Repeats`,0,1,``,`dlRep`),i(`delay.level`,`Level`,0,1,``,`dlLevel`),i(`delay.mod`,`Mod depth`,-1,1,``,`dlMod`),a(`delay.source`,`Mod source`,[`s&h`,`env2`],`dlSrc`),i(`mix.a`,`Filter I`,0,1.5,``,`mixA`),i(`mix.b`,`Filter II`,0,1.5,``,`mixB`),a(`mix.mode`,`Output`,[`stereo`,`mono`],`mono`),i(`mix.volume`,`Volume`,0,1.5,``,`vol`)}setKeys(e){this.circuit.gate(`box`,`keys`,e)}setOpen(e,t){this.circuit.gate(`box`,e===1?`open1`:`open2`,t)}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.currentPreset=t,this.applyValues({...Gt,...t.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyPreset(){for(let e of this.presetListeners)e()}},Qt={"lfo.rate":5,"lfo.delay":0,"dco.lfo":0,"dco.pwm":.5,"dco.pwmSource":`man`,"dco.range":`8`,"dco.pulse":1,"dco.saw":1,"dco.sub":.3,"dco.noise":0,"hpf.freq":`1`,"vcf.freq":3e3,"vcf.res":.2,"vcf.env":.4,"vcf.polarity":`plus`,"vcf.lfo":0,"vcf.kybd":.5,"vca.mode":`env`,"vca.level":.8,"env.attack":.005,"env.decay":.4,"env.sustain":.6,"env.release":.3,"chorus.i":0,"chorus.ii":0,"bend.dco":2,"bend.vcf":.2,"bend.lfo":.3,"bend.lfoTrig":0,"master.portamento":0,"assign.mode":`poly1`,"master.tune":0,"master.volume":.75,"key.hold":0,"key.transpose":`0`},$t=[`master.tune`,`master.volume`,`key.hold`,`key.transpose`],en=[`A`,`B`],tn=en.length*8*8,nn=(e,t,n)=>e*8*8+(t-1)*8+(n-1),H=(e,t)=>({name:e,values:t}),rn=[H(`Brass 1`,{"dco.sub":.2,"vcf.freq":700,"vcf.res":.15,"vcf.env":.55,"vcf.kybd":.6,"env.attack":.07,"env.decay":.4,"env.sustain":.65,"env.release":.2,"chorus.i":1}),H(`Brass 2`,{"dco.pwm":.35,"dco.pulse":1,"dco.saw":1,"vcf.freq":600,"vcf.res":.25,"vcf.env":.6,"env.attack":.12,"env.decay":.5,"env.sustain":.55,"env.release":.25,"chorus.ii":1}),H(`Strings`,{"dco.pulse":0,"dco.saw":1,"dco.sub":.1,"hpf.freq":`2`,"vcf.freq":2600,"vcf.res":.05,"vcf.env":.1,"env.attack":.35,"env.decay":1,"env.sustain":.85,"env.release":.6,"chorus.i":1,"chorus.ii":1}),H(`String Ensemble`,{"dco.pulse":1,"dco.saw":1,"dco.pwm":.6,"dco.pwmSource":`lfo`,"lfo.rate":.8,"dco.sub":.15,"hpf.freq":`2`,"vcf.freq":2200,"vcf.env":.1,"env.attack":.5,"env.decay":1,"env.sustain":.9,"env.release":.8,"chorus.i":1,"chorus.ii":1}),H(`Choir`,{"dco.pulse":1,"dco.saw":0,"dco.pwm":.3,"dco.sub":.3,"dco.noise":.04,"vcf.freq":1300,"vcf.res":.35,"vcf.env":.1,"env.attack":.45,"env.decay":.8,"env.sustain":.8,"env.release":.9,"chorus.ii":1}),H(`Warm Pad`,{"dco.sub":.4,"vcf.freq":900,"vcf.res":.1,"vcf.env":.15,"vcf.lfo":.1,"lfo.rate":.3,"env.attack":.9,"env.decay":1.5,"env.sustain":.8,"env.release":1.4,"chorus.i":1}),H(`Slow Pad`,{"dco.pwmSource":`lfo`,"dco.pwm":.5,"lfo.rate":.2,"dco.sub":.25,"vcf.freq":1500,"vcf.res":.2,"vcf.env":.3,"env.attack":1.6,"env.decay":2,"env.sustain":.85,"env.release":2.2,"chorus.i":1,"chorus.ii":1}),H(`Sweep Pad`,{"vcf.freq":400,"vcf.res":.55,"vcf.env":.7,"vcf.lfo":.25,"lfo.rate":.15,"env.attack":1.2,"env.decay":2.5,"env.sustain":.7,"env.release":1.8,"chorus.ii":1}),H(`Sub Bass`,{"dco.range":`16`,"dco.pulse":0,"dco.saw":1,"dco.sub":.8,"vcf.freq":350,"vcf.res":.1,"vcf.env":.3,"vcf.kybd":.2,"env.attack":.003,"env.decay":.3,"env.sustain":.8,"env.release":.12,"master.portamento":.05}),H(`Saw Bass`,{"dco.range":`16`,"dco.pulse":0,"dco.sub":.5,"hpf.freq":`1`,"vcf.freq":500,"vcf.res":.3,"vcf.env":.55,"vcf.kybd":.3,"env.attack":.002,"env.decay":.25,"env.sustain":.4,"env.release":.12}),H(`Pluck Bass`,{"dco.range":`16`,"dco.pulse":1,"dco.saw":0,"dco.pwm":.4,"dco.sub":.6,"vcf.freq":300,"vcf.res":.4,"vcf.env":.7,"vcf.kybd":.4,"env.attack":.001,"env.decay":.22,"env.sustain":0,"env.release":.15}),H(`Lead Saw`,{"dco.pulse":0,"dco.sub":.1,"vcf.freq":2400,"vcf.res":.3,"vcf.env":.25,"vcf.kybd":.8,"dco.lfo":.12,"lfo.rate":5.5,"lfo.delay":.6,"env.attack":.01,"env.decay":.3,"env.sustain":.85,"env.release":.2,"master.portamento":.15,"assign.mode":`unison`,"chorus.i":1}),H(`Lead Pulse`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.55,"dco.pwmSource":`lfo`,"lfo.rate":3,"dco.sub":.2,"vcf.freq":2e3,"vcf.res":.35,"vcf.env":.3,"vcf.kybd":.8,"env.attack":.01,"env.decay":.3,"env.sustain":.8,"env.release":.2,"assign.mode":`unison`,"chorus.ii":1}),H(`Whistle Lead`,{"dco.range":`4`,"dco.saw":0,"dco.pulse":1,"dco.pwm":.1,"dco.sub":0,"hpf.freq":`2`,"vcf.freq":3800,"vcf.res":.2,"vcf.env":.1,"dco.lfo":.1,"lfo.rate":5,"lfo.delay":.9,"env.attack":.04,"env.decay":.3,"env.sustain":.9,"env.release":.25,"master.portamento":.25,"assign.mode":`unison`}),H(`Organ`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":0,"dco.sub":.7,"hpf.freq":`2`,"vcf.freq":6e3,"vcf.res":0,"vcf.env":0,"vca.mode":`gate`,"chorus.i":1,"chorus.ii":1}),H(`Clav`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.25,"dco.sub":0,"hpf.freq":`3`,"vcf.freq":1500,"vcf.res":.35,"vcf.env":.55,"vcf.kybd":.9,"env.attack":.001,"env.decay":.18,"env.sustain":0,"env.release":.12}),H(`Pluck`,{"dco.pulse":0,"dco.sub":.2,"vcf.freq":700,"vcf.res":.3,"vcf.env":.6,"env.attack":.001,"env.decay":.35,"env.sustain":0,"env.release":.3,"chorus.i":1}),H(`Harp`,{"dco.range":`4`,"dco.pulse":0,"dco.sub":0,"vcf.freq":1500,"vcf.res":.15,"vcf.env":.35,"env.attack":.001,"env.decay":1.2,"env.sustain":0,"env.release":1,"chorus.ii":1}),H(`Bell Pad`,{"dco.range":`4`,"dco.saw":0,"dco.pulse":1,"dco.pwm":.7,"dco.pwmSource":`lfo`,"lfo.rate":6,"dco.sub":0,"vcf.freq":2500,"vcf.res":.45,"vcf.env":.4,"env.attack":.002,"env.decay":1.6,"env.sustain":.1,"env.release":1.5,"chorus.i":1,"chorus.ii":1}),H(`Noise Sweep`,{"dco.pulse":0,"dco.saw":0,"dco.sub":0,"dco.noise":.8,"hpf.freq":`2`,"vcf.freq":300,"vcf.res":.6,"vcf.env":.8,"env.attack":1.4,"env.decay":1.5,"env.sustain":.1,"env.release":1.2,"chorus.ii":1}),H(`Wind`,{"dco.pulse":0,"dco.saw":0,"dco.sub":0,"dco.noise":.9,"vcf.freq":900,"vcf.res":.55,"vcf.env":.2,"vcf.lfo":.3,"lfo.rate":.25,"vcf.kybd":1,"env.attack":1,"env.decay":1,"env.sustain":.9,"env.release":1.5,"chorus.i":1}),H(`Vibes`,{"dco.range":`4`,"dco.pulse":0,"dco.sub":0,"dco.lfo":.05,"lfo.rate":6,"vcf.freq":2400,"vcf.res":.1,"vcf.env":.2,"env.attack":.002,"env.decay":1.4,"env.sustain":0,"env.release":.9,"chorus.ii":1}),H(`Glass`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.8,"dco.pwmSource":`lfo`,"lfo.rate":.5,"dco.sub":0,"dco.noise":.03,"hpf.freq":`2`,"vcf.freq":4e3,"vcf.res":.25,"vcf.env":.1,"env.attack":.6,"env.decay":1.5,"env.sustain":.7,"env.release":1.6,"chorus.i":1,"chorus.ii":1}),H(`Funk Stab`,{"dco.sub":.3,"hpf.freq":`2`,"vcf.freq":500,"vcf.res":.25,"vcf.env":.65,"vcf.kybd":.7,"env.attack":.001,"env.decay":.16,"env.sustain":0,"env.release":.08,"chorus.ii":1})],an=Array.from({length:tn},(e,t)=>rn[t]??H(`Init`,{})),on=[`poly`,`mono`,`unison`],sn=class{count;mode=`poly`;prefer=`oldest`;voices;held=[];clock=0;constructor(e){this.count=e,this.voices=Array.from({length:e},()=>({gate:!1,since:0}))}isActive(e){return this.voices[e].gate}get activeCount(){return this.voices.filter(e=>e.gate).length}noteOn(e){return this.mode===`poly`?this.polyOn(e):this.stackOn(e)}noteOff(e){return this.mode===`poly`?this.polyOff(e):this.stackOff(e)}releaseAll(){this.held=[];let e=[];return this.voices.forEach((t,n)=>{t.gate&&(t.gate=!1,t.since=++this.clock,e.push({kind:`off`,voice:n}))}),e}get active(){return this.mode===`mono`?[0]:this.voices.map((e,t)=>t)}polyOn(e){let t=this.voices.findIndex(t=>t.gate&&t.note===e);if(t<0){let e=this.voices.map((e,t)=>({v:e,i:t})).filter(e=>!e.v.gate),n=e.length?e:this.voices.map((e,t)=>({v:e,i:t}));t=this.prefer===`lowest`&&e.length?e[0].i:n.reduce((e,t)=>t.v.since<e.v.since?t:e).i}let n=this.voices[t];return n.note=e,n.gate=!0,n.since=++this.clock,[{kind:`on`,voice:t,note:e,retrigger:!0,glide:!0}]}polyOff(e){let t=[];return this.voices.forEach((n,r)=>{n.gate&&n.note===e&&(n.gate=!1,n.since=++this.clock,t.push({kind:`off`,voice:r}))}),t}stackOn(e){let t=this.voices[this.active[0]].gate;return this.held=this.held.filter(t=>t!==e),this.held.push(e),this.play(e,!t,t)}stackOff(e){this.held=this.held.filter(t=>t!==e);let t=this.held[this.held.length-1];if(t!==void 0)return this.play(t,!1,!0);let n=[];for(let e of this.active){let t=this.voices[e];t.gate&&(t.gate=!1,t.since=++this.clock,n.push({kind:`off`,voice:e}))}return n}play(e,t,n){return this.active.map(r=>{let i=this.voices[r],a=t||!i.gate;return i.note=e,i.gate=!0,i.since=++this.clock,{kind:`on`,voice:r,note:e,retrigger:a,glide:n&&!a}})}},cn=[`poly1`,`poly2`,`unison`],ln=[`16`,`8`,`4`],un=[`0`,`1`,`2`,`3`],dn=[`-2`,`-1`,`0`,`1`,`2`],fn=1200,pn=69,mn=1,hn=64,gn=.65,_n=12,vn={poly:.4,unison:.3},yn=[10,10,240,720],bn={16:-1200,8:0,4:fn},xn={i:{rate:.5,depth:.0013},ii:{rate:.83,depth:.0013},both:{rate:9,depth:25e-5}},Sn=class extends I{name;transport;slots=[...an];currentSlot=0;currentPreset=this.slots[0];group=0;bank=1;manualState=!0;manualSnapshot;allocator=new sn(6);held=[];sounding=new Map;latched=new Set;pedal=!1;bend=0;modWheelValue=0;portamento=0;bendSemitones=2;bendFilter=.2;lfoSensitivity=.3;lfoDepthCents=0;pwmSource=`man`;pwm=.5;envDepth=.4;envSign=1;lfoTrig=!1;chorusI=!1;chorusII=!1;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`Lynch`,t=new L){super(),this.name=e,this.transport=new be(t),this.transport.channel.set(`omni`);let n=this.circuit;this.addShared(n);for(let e=0;e<6;e++)this.addVoice(n,e);this.addOutput(n),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`}),this.addControls(n)}keyDown(e){let t=e+Number(this.control(`key.transpose`).value)*12;this.held=this.held.filter(t=>t!==e),this.held.push(e),this.latched.delete(e),this.sounding.set(e,t),this.apply(this.allocator.noteOn(t)),this.updateLfoGate(),this.notifyNotes()}keyUp(e){let t=this.sounding.get(e);t!==void 0&&(this.holding?this.latched.add(e):this.release(e,t))}release(e,t){this.sounding.delete(e),this.latched.delete(e),this.held=this.held.filter(t=>t!==e),this.apply(this.allocator.noteOff(t)),this.updateLfoGate(),this.notifyNotes()}get holding(){return this.pedal||this.control(`key.hold`).value}releaseLatched(){for(let e of[...this.latched]){let t=this.sounding.get(e);t!==void 0&&this.release(e,t)}}releaseAll(){this.apply(this.allocator.releaseAll()),this.held=[],this.sounding.clear(),this.latched.clear(),this.updateLfoGate(),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}voiceActive(e){return this.allocator.isActive(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*this.bendSemitones*100),this.circuit.setParam(`bendVcf`,`offset`,this.bend*this.bendFilter*2400),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`lfoPitchMod`,`gain`,this.modWheelValue*this.lfoSensitivity*200),this.updateLfoGate(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}updateLfoGate(){let e=this.lfoTrig?this.modWheelValue>.05:this.held.length>0;this.circuit.setParam(`lfoFade`,`gate`,+!!e)}handleMidi(e){if(e.type!==`clock`&&`channel`in e&&this.transport.acceptsChannel(e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===mn?this.setModWheel(e.value/127):e.controller===hn&&(this.pedal=e.value>=64,this.pedal||this.releaseLatched());break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}get manual(){return this.manualState}get patchNumber(){let e=this.currentSlot%64;return{group:Math.floor(this.currentSlot/64),bank:Math.floor(e/8)+1,patch:e%8+1}}selectGroup(e){this.group=Math.min(en.length-1,Math.max(0,e)),this.notifyPreset()}selectBank(e){this.bank=Math.min(8,Math.max(1,e)),this.notifyPreset()}selectPatch(e){this.loadSlot(nn(this.group,this.bank,e))}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.manualState&&(this.manualSnapshot=this.snapshot()),this.manualState=!1,this.currentSlot=e;let{group:n,bank:r}=this.patchNumber;this.group=n,this.bank=r,this.loadPreset(t)}selectManual(){this.manualState||(this.manualState=!0,this.manualSnapshot&&this.applyValues(this.manualSnapshot),this.notifyPreset())}loadPreset(e){this.currentPreset=e,this.applyValues({...Qt,...e.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){if($t.includes(t))continue;let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)$t.includes(t.id)||(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}write(e=nn(this.group,this.bank,this.patchNumber.patch)){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.manualState=!1,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}apply(e){let t=this.circuit;for(let n of e){let e=e=>`v${n.voice}.${e}`;n.kind===`off`?(t.setParam(e(`env`),`gate`,0),t.setParam(e(`gate`),`gate`,0)):(t.setParam(e(`pitch`),`offset`,(n.note-pn)*100),n.retrigger&&(t.setParam(e(`env`),`gate`,1),t.setParam(e(`gate`),`gate`,1)))}}eachVoice(e){for(let t=0;t<6;t++)e(e=>`v${t}.${e}`)}applyMode(e){this.releaseAll(),this.allocator.mode=e===`unison`?`unison`:`poly`,this.allocator.prefer=e===`poly2`?`lowest`:`oldest`;let t=e===`unison`?vn.unison:vn.poly;this.eachVoice(e=>this.circuit.setParam(e(`out`),`gain`,t));let n=e===`unison`?_n:0,r=5/2;for(let e=0;e<6;e++){let t=(e-r)/r*n;this.circuit.setParam(`v${e}.det`,`offset`,t===0?0:t)}}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyPreset(){for(let e of this.presetListeners)e()}addShared(e){e.add(`bend`,`constant`,{offset:0}).add(`tune`,`constant`,{offset:0}).add(`rangeShift`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:-1200}).add(`pwCv`,`constant`,{offset:0}).add(`bendVcf`,`constant`,{offset:0}).add(`lfoOsc`,`oscillator`,{frequency:5,detune:0},{waveform:`triangle`}).add(`lfoFade`,`envelope`,{attack:.001,decay:.001,sustain:1,release:.02,gate:0}).add(`lfoFadeGain`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPitchMod`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0}).add(`noise`,`noise`).add(`voices`,`gain`,{gain:1}).connect(`lfoOsc`,`lfoFadeGain`).connect(`lfoFade`,`lfoFadeGain`,`gain`).connect(`lfoFadeGain`,`lfo`);for(let t of[`lfoPitch`,`lfoPitchMod`,`lfoPw`,`lfoFilter`])e.connect(`lfo`,t)}addVoice(e,t){let n=e=>`v${t}.${e}`;e.add(n(`pitch`),`constant`,{offset:0,glide:0}).add(n(`det`),`constant`,{offset:0}).add(n(`osc`),`oscillator`,{frequency:440,detune:0},{waveform:`sawtooth`}).add(n(`sub`),`oscillator`,{frequency:440,detune:0},{waveform:`square`}).add(n(`rawOut`),`gain`,{gain:1}).add(n(`pulseSum`),`gain`,{gain:1}).add(n(`shaper`),`waveshaper`,{},{curve:`pulse`}).add(n(`pulseOut`),`gain`,{gain:gn}).add(n(`subLevel`),`gain`,{gain:0}).add(n(`noiseLevel`),`gain`,{gain:0}).add(n(`mix`),`gain`,{gain:.5}).add(n(`boost`),`filter`,{frequency:120,Q:.707,gain:0,detune:0},{type:`lowshelf`}).add(n(`hpf`),`filter`,{frequency:10,Q:.707,gain:0,detune:0},{type:`highpass`}).add(n(`f1`),`filter`,{frequency:3e3,Q:1,detune:0},{type:`lowpass`}).add(n(`f2`),`filter`,{frequency:3e3,Q:.707,detune:0},{type:`lowpass`}).add(n(`keyFollow`),`gain`,{gain:.5}).add(n(`env`),`envelope`,{attack:.005,decay:.4,sustain:.6,release:.3,gate:0}).add(n(`envDepth`),`gain`,{gain:.4*6*fn}).add(n(`gate`),`envelope`,{attack:.003,decay:.001,sustain:1,release:.015,gate:0}).add(n(`envAmp`),`gain`,{gain:1}).add(n(`gateAmp`),`gain`,{gain:0}).add(n(`amp`),`gain`,{gain:0}).add(n(`out`),`gain`,{gain:vn.poly});for(let t of[`osc`,`sub`])for(let r of[n(`pitch`),n(`det`),`bend`,`tune`,`rangeShift`,`lfoPitch`,`lfoPitchMod`])e.connect(r,n(t),`detune`);e.connect(`subShift`,n(`sub`),`detune`).connect(n(`osc`),n(`rawOut`)).connect(n(`osc`),n(`pulseSum`)).connect(`pwCv`,n(`pulseSum`)).connect(`lfoPw`,n(`pulseSum`)).connect(n(`pulseSum`),n(`shaper`)).connect(n(`shaper`),n(`pulseOut`)).connect(n(`rawOut`),n(`mix`)).connect(n(`pulseOut`),n(`mix`)).connect(n(`sub`),n(`subLevel`)).connect(n(`subLevel`),n(`mix`)).connect(`noise`,n(`noiseLevel`)).connect(n(`noiseLevel`),n(`mix`)).connect(n(`mix`),n(`boost`)).connect(n(`boost`),n(`hpf`)).connect(n(`hpf`),n(`f1`)).connect(n(`f1`),n(`f2`)).connect(n(`f2`),n(`amp`)).connect(n(`env`),n(`envDepth`)).connect(n(`pitch`),n(`keyFollow`));for(let t of[`f1`,`f2`])e.connect(n(`envDepth`),n(t),`detune`).connect(n(`keyFollow`),n(t),`detune`).connect(`lfoFilter`,n(t),`detune`).connect(`bendVcf`,n(t),`detune`);e.connect(n(`env`),n(`envAmp`)).connect(n(`envAmp`),n(`amp`),`gain`).connect(n(`gate`),n(`gateAmp`)).connect(n(`gateAmp`),n(`amp`),`gain`).connect(n(`amp`),n(`out`)).connect(n(`out`),`voices`)}addOutput(e){e.add(`chDry`,`gain`,{gain:1}).add(`chLfo`,`oscillator`,{frequency:.5,detune:0},{waveform:`triangle`}).add(`chDelayL`,`delay`,{delayTime:.0035,maxTime:.02}).add(`chDelayR`,`delay`,{delayTime:.0035,maxTime:.02}).add(`chDepthL`,`gain`,{gain:xn.i.depth}).add(`chDepthR`,`gain`,{gain:-xn.i.depth}).add(`chToneL`,`filter`,{frequency:9e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`chToneR`,`filter`,{frequency:9e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`chPanL`,`pan`,{pan:-1}).add(`chPanR`,`pan`,{pan:1}).add(`chWet`,`gain`,{gain:0}).add(`chSum`,`gain`,{gain:1}).add(`vcaLevel`,`gain`,{gain:.8}).add(`volume`,`gain`,{gain:.75}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`voices`,`chDry`).connect(`chDry`,`chSum`).connect(`voices`,`chDelayL`).connect(`voices`,`chDelayR`).connect(`chDelayL`,`chToneL`).connect(`chDelayR`,`chToneR`).connect(`chToneL`,`chPanL`).connect(`chToneR`,`chPanR`).connect(`chPanL`,`chWet`).connect(`chPanR`,`chWet`).connect(`chWet`,`chSum`).connect(`chLfo`,`chDepthL`).connect(`chLfo`,`chDepthR`).connect(`chDepthL`,`chDelayL`,`delayTime`).connect(`chDepthR`,`chDelayR`,`delayTime`).connect(`chSum`,`vcaLevel`).connect(`vcaLevel`,`volume`).connect(`volume`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`)}addControls(e){let t=Qt,n=e=>t[e],r=(e,t,r,i,a,o,s)=>this.controlList.push(new N(e,t,r,i,n(e),a,o,s)),i=e=>t=>this.eachVoice(n=>e(n,t)),a=(e,t,r)=>this.controlList.push(new F(e,t,n(e)>0,r)),o=(e,n,r,i)=>this.controlList.push(new P(e,n,r,t[e],i));r(`lfo.rate`,`Rate`,.1,30,`Hz`,t=>e.setParam(`lfoOsc`,`frequency`,t),`log`),r(`lfo.delay`,`Delay time`,0,3,`s`,t=>e.setParam(`lfoFade`,`attack`,Math.max(.001,t))),r(`dco.lfo`,`LFO`,0,1,``,t=>{this.lfoDepthCents=t*150,e.setParam(`lfoPitch`,`gain`,this.lfoDepthCents)}),r(`dco.pwm`,`PWM`,0,1,``,e=>{this.pwm=e,this.applyPulseWidth()}),o(`dco.pwmSource`,`PWM source`,[`man`,`lfo`],e=>{this.pwmSource=e,this.applyPulseWidth()}),o(`dco.range`,`Range`,ln,t=>e.setParam(`rangeShift`,`offset`,bn[t])),a(`dco.pulse`,`Pulse`,t=>this.eachVoice(n=>e.setParam(n(`pulseOut`),`gain`,t?gn:0))),a(`dco.saw`,`Saw`,t=>this.eachVoice(n=>e.setParam(n(`rawOut`),`gain`,+!!t))),r(`dco.sub`,`Sub`,0,1,``,i((t,n)=>e.setParam(t(`subLevel`),`gain`,n*.6))),r(`dco.noise`,`Noise`,0,1,``,i((t,n)=>e.setParam(t(`noiseLevel`),`gain`,n*.5))),o(`hpf.freq`,`HPF`,un,t=>{let n=Number(t);this.eachVoice(t=>{e.setParam(t(`boost`),`gain`,n===0?6:0),e.setParam(t(`hpf`),`frequency`,yn[n])})}),r(`vcf.freq`,`Freq`,20,2e4,`Hz`,i((t,n)=>{e.setParam(t(`f1`),`frequency`,n),e.setParam(t(`f2`),`frequency`,n)}),`log`),r(`vcf.res`,`Res`,0,1,``,i((t,n)=>e.setParam(t(`f1`),`Q`,.5*32**n))),r(`vcf.env`,`Env`,0,1,``,e=>{this.envDepth=e,this.applyEnvDepth()}),o(`vcf.polarity`,`Env polarity`,[`plus`,`minus`],e=>{this.envSign=e===`minus`?-1:1,this.applyEnvDepth()}),r(`vcf.lfo`,`LFO`,0,1,``,t=>e.setParam(`lfoFilter`,`gain`,t*3*fn)),r(`vcf.kybd`,`Kybd`,0,1,``,i((t,n)=>e.setParam(t(`keyFollow`),`gain`,n))),o(`vca.mode`,`VCA`,[`env`,`gate`],t=>this.eachVoice(n=>{e.setParam(n(`envAmp`),`gain`,+(t===`env`)),e.setParam(n(`gateAmp`),`gain`,+(t===`gate`))})),r(`vca.level`,`Level`,0,1,``,t=>e.setParam(`vcaLevel`,`gain`,t));let s=(t,n,a,o)=>r(`env.${t}`,n,a,o,`s`,i((n,r)=>e.setParam(n(`env`),t,r)),`log`);s(`attack`,`A`,.001,3),s(`decay`,`D`,.002,12),r(`env.sustain`,`S`,0,1,``,i((t,n)=>e.setParam(t(`env`),`sustain`,n))),s(`release`,`R`,.002,12),a(`chorus.i`,`Chorus I`,e=>{this.chorusI=e,this.applyChorus()}),a(`chorus.ii`,`Chorus II`,e=>{this.chorusII=e,this.applyChorus()}),r(`bend.dco`,`Bender DCO`,0,12,`st`,e=>{this.bendSemitones=e,this.setPitchBend(this.bend)}),r(`bend.vcf`,`Bender VCF`,0,1,``,e=>{this.bendFilter=e,this.setPitchBend(this.bend)}),r(`bend.lfo`,`Bender LFO`,0,1,``,e=>{this.lfoSensitivity=e,this.setModWheel(this.modWheelValue)}),a(`bend.lfoTrig`,`LFO trig`,e=>{this.lfoTrig=e,this.updateLfoGate()}),r(`master.portamento`,`Portamento`,0,1,``,t=>{this.portamento=t;let n=t*t*2.5;this.eachVoice(t=>e.setParam(t(`pitch`),`glide`,n))}),o(`assign.mode`,`Assign`,cn,e=>this.applyMode(e)),r(`master.tune`,`Tune`,-50,50,`ct`,t=>e.setParam(`tune`,`offset`,t)),r(`master.volume`,`Volume`,0,1,``,t=>e.setParam(`volume`,`gain`,t)),a(`key.hold`,`Hold`,e=>{e||this.releaseLatched()}),o(`key.transpose`,`Key transpose`,dn,()=>{})}applyPulseWidth(){let e=this.circuit;this.pwmSource===`man`?(e.setParam(`pwCv`,`offset`,1-2*((50-this.pwm*45)/100)),e.setParam(`lfoPw`,`gain`,0)):(e.setParam(`pwCv`,`offset`,0),e.setParam(`lfoPw`,`gain`,this.pwm*.9))}applyEnvDepth(){this.eachVoice(e=>this.circuit.setParam(e(`envDepth`),`gain`,this.envSign*this.envDepth*6*fn))}applyChorus(){let e=this.circuit,t=this.chorusI,n=this.chorusII,r=t&&n?xn.both:t?xn.i:n?xn.ii:void 0,i=r!==void 0,a=r??xn.i;e.setParam(`chLfo`,`frequency`,a.rate),e.setParam(`chDepthL`,`gain`,a.depth),e.setParam(`chDepthR`,`gain`,-a.depth),e.setParam(`chWet`,`gain`,i?.7:0),e.setParam(`chDry`,`gain`,i?.75:1)}},Cn={"env.attack":1,"env.decay":30,"env.sustain":0,"env.release":200,"env.keytrack":0,"env.velocity":.5,"env.legato":0,"gen.noise":1,"gen.cutoff":100,"gen.reso":.2,"gen.keytrack":.5,"gen.envAmt":0,"gen.onePole":0,"gen.gain":1.5,"fb.push":0,"fb.decay":2,"fb.release":.4,"sat.hardness":.3,"sat.symmetry":0,"patch.volume":.8,"delay.tune":0,"delay.fine":0,"delay.harmonics":0,"delay.split":0,"delay.splitPoint":.5,"delay.polarity":0,"filter.highpass":-36,"filter.lowpass":36,"filter.hpComp":1,"filter.lpComp":1,"voice.mode":`poly`,"voice.detune":12,"voice.glide":100,"voice.glideOn":0,"lfo.wave":`sine`,"lfo.rate":5,"lfo.sync":0,"lfo.division":`1/8`,"lfo.delay":0,"lfo.amount":0,"lfo.dest":`pitch`,"rev.mix":.25,"rev.bass":120,"rev.treble":8e3,"rev.size":`medium`,"rev.spread":.5},U=(e,t)=>({name:e,values:t}),wn={"env.attack":60,"env.decay":200,"env.sustain":1,"env.release":250,"gen.noise":.06,"gen.gain":.3,"fb.push":1.2,"fb.decay":4,"fb.release":.3,"sat.hardness":.1,"filter.highpass":-36,"filter.lowpass":30},Tn={"gen.gain":1.9},En=[[U(`Nylon Pluck`,{...Tn,"gen.cutoff":90,"gen.keytrack":.7,"fb.decay":1.8,"fb.release":.25,"filter.lowpass":30,"sat.hardness":.2,"rev.mix":.2}),U(`Steel String`,{...Tn,"gen.cutoff":120,"delay.harmonics":.12,"fb.decay":3.5,"fb.release":.35,"filter.lowpass":48,"sat.hardness":.4,"env.velocity":.7}),U(`Muted Bass`,{...Tn,"delay.tune":-12,"gen.cutoff":70,"gen.keytrack":.2,"fb.decay":.9,"fb.release":.15,"filter.lowpass":18,"filter.highpass":-48,"voice.mode":`mono`,"rev.mix":.08,"patch.volume":1}),U(`Harp`,{...Tn,"gen.cutoff":100,"gen.keytrack":.6,"delay.harmonics":.05,"fb.decay":5,"fb.release":.6,"filter.lowpass":36,"rev.size":`large`,"rev.mix":.35}),U(`Marimba`,{...Tn,"env.attack":1,"env.decay":20,"gen.cutoff":80,"delay.split":1,"delay.splitPoint":.4,"delay.harmonics":.4,"fb.decay":.7,"fb.release":.2,"filter.lowpass":24,"filter.highpass":-48,"rev.mix":.15}),U(`Glass Bell`,{...Tn,"delay.tune":12,"delay.split":1,"delay.splitPoint":.3,"delay.harmonics":.6,"fb.decay":6,"fb.release":2,"sat.hardness":.1,"filter.lowpass":60,"filter.highpass":-48,"rev.size":`large`,"rev.mix":.4}),U(`Wood Block`,{...Tn,"env.decay":15,"gen.gain":2,"delay.split":1,"delay.splitPoint":.5,"delay.harmonics":.2,"fb.decay":.25,"fb.release":.1,"filter.lowpass":40,"filter.highpass":-24,"rev.mix":.1}),U(`Kalimba`,{...Tn,"delay.tune":12,"gen.noise":.8,"delay.split":1,"delay.splitPoint":.6,"delay.harmonics":.3,"fb.decay":1.2,"fb.release":.3,"filter.lowpass":42,"filter.highpass":-48,"rev.mix":.3})],[U(`Pan Flute`,{...wn,"delay.polarity":1,"voice.mode":`mono`,"env.legato":1,"voice.glideOn":1,"voice.glide":60,"lfo.amount":.12,"lfo.rate":5,"lfo.delay":.6,"lfo.dest":`pitch`,"rev.mix":.3}),U(`Clarinet`,{...wn,"delay.polarity":1,"gen.noise":.1,"gen.gain":.35,"env.attack":30,"sat.hardness":.5,"filter.lowpass":36,"voice.mode":`mono`,"env.legato":1,"rev.mix":.2}),U(`Reed Organ`,{...wn,"gen.noise":.08,"env.attack":40,"env.release":200,"sat.hardness":.6,"sat.symmetry":.2,"filter.lowpass":40,"rev.mix":.25}),U(`Pipe Organ`,{...wn,"gen.noise":.05,"env.attack":80,"env.release":500,"filter.lowpass":24,"rev.size":`large`,"rev.mix":.45}),U(`Brass`,{...wn,"gen.noise":.1,"gen.gain":.5,"env.attack":80,"env.decay":200,"env.sustain":.7,"sat.hardness":.7,"sat.symmetry":.6,"filter.lowpass":42,"lfo.dest":`filter`,"lfo.amount":.1,"lfo.rate":6,"rev.mix":.2}),U(`Overblown`,{...wn,"delay.polarity":1,"lfo.dest":`filter`,"lfo.amount":.6,"lfo.rate":.3,"lfo.wave":`sine`,"rev.mix":.3}),U(`Steam Drone`,{...wn,"env.attack":1500,"env.release":3e3,"gen.noise":.2,"fb.decay":20,"fb.release":3,"voice.mode":`unison`,"voice.detune":25,"rev.size":`large`,"rev.mix":.5,"rev.spread":1}),U(`Wind Chimes`,{"delay.tune":12,"delay.split":1,"delay.splitPoint":.2,"delay.harmonics":.5,"fb.decay":8,"fb.release":4,"filter.lowpass":54,"filter.highpass":-48,"sat.hardness":.05,"rev.size":`large`,"rev.mix":.5,"rev.spread":1})]].flat(),Dn=[`poly`,`mono`,`unison`],On=[`sine`,`tri`,`sqr`,`ramp`,`rnd`],kn=[`pitch`,`filter`,`steam`,`sat`,`push`],An=[`1/1`,`1/2`,`1/4`,`1/8`,`1/16`,`1/32`],jn=1,Mn=64,Nn=2,Pn=.8,Fn=3,In=class extends I{name;transport;slots=[...En];currentSlot=0;currentPreset=this.slots[0];held=[];bend=0;modWheelValue=0;lfoHz=5;lfoSync=!1;lfoDivision=`1/8`;clockPulses=0;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`Pipe`,t=new L){super(),this.name=e,this.transport=new be(t),this.transport.channel.set(`omni`),this.circuit.add(`pipe`,`pipe`,{atk:.001,dec:.03,sus:0,rel:.2,envKey:0,vel:.5,legato:0,noise:1,nCut:100,nRes:.2,nKey:.5,nEnv:0,onePole:0,gain:.8,tune:0,fine:0,harm:0,split:0,splitPt:.5,pol:0,fbDec:2,fbRel:.4,push:0,satHard:.3,satSym:0,hp:-36,lp:36,hpComp:1,lpComp:1,mode:0,detune:12,glide:.1,glideOn:0,spread:.5,volume:.8,lfoRate:5,lfoShape:0,lfoDelay:0,lfoAmt:0,lfoDest:0,bend:0,mod:0}).add(`dry`,`gain`,{gain:1}).add(`revIn`,`gain`,{gain:1}).add(`conv`,`convolver`,{},{size:`medium`}).add(`revLow`,`filter`,{frequency:120,Q:.707,detune:0},{type:`highpass`}).add(`revHigh`,`filter`,{frequency:8e3,Q:.707,detune:0},{type:`lowpass`}).add(`wet`,`gain`,{gain:0}).add(`sum`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`pipe`,`dry`).connect(`pipe`,`revIn`).connect(`revIn`,`conv`).connect(`conv`,`revLow`).connect(`revLow`,`revHigh`).connect(`revHigh`,`wet`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`}),this.addControls(),this.transport.tempo.onChange(()=>this.applyLfoRate())}addControls(){let e=this.circuit,t=Cn,n=(e,n,r,i,a,o,s)=>this.controlList.push(new N(e,n,r,i,t[e],a,o,s)),r=(t,r,i,a,o,s,c=1,l)=>n(t,r,i,a,o,t=>e.setParam(`pipe`,s,t*c),l),i=(n,r,i)=>this.controlList.push(new F(n,r,(t[n]??0)>0,t=>e.setParam(`pipe`,i,+!!t)));r(`env.attack`,`Attack`,.5,1e4,`ms`,`atk`,1/1e3,`log`),r(`env.decay`,`Decay`,1,1e4,`ms`,`dec`,1/1e3,`log`),r(`env.sustain`,`Sustain`,0,1,``,`sus`),r(`env.release`,`Release`,5,2e4,`ms`,`rel`,1/1e3,`log`),r(`env.keytrack`,`Keytrack`,0,1,``,`envKey`),r(`env.velocity`,`Velocity`,0,1,``,`vel`),i(`env.legato`,`Legato`,`legato`),r(`gen.noise`,`DC / Noise`,0,1,``,`noise`),r(`gen.cutoff`,`Cutoff`,30,140,`pitch`,`nCut`),r(`gen.reso`,`Resonance`,0,1,``,`nRes`),r(`gen.keytrack`,`Keytrack`,0,1,``,`nKey`),r(`gen.envAmt`,`Env amount`,-48,48,`st`,`nEnv`),r(`gen.gain`,`Gain`,0,2,``,`gain`),i(`gen.onePole`,`1-pole`,`onePole`),r(`fb.push`,`Push`,0,1.5,``,`push`),r(`fb.decay`,`Decay`,.05,30,`s`,`fbDec`,1,`log`),r(`fb.release`,`Release`,.02,20,`s`,`fbRel`,1,`log`),r(`sat.hardness`,`Soft / Hard`,0,1,``,`satHard`),r(`sat.symmetry`,`Symmetry`,0,1,``,`satSym`),r(`patch.volume`,`Volume`,0,1.2,``,`volume`),r(`delay.tune`,`Tune`,-24,24,`st`,`tune`),r(`delay.fine`,`Fine`,-100,100,`ct`,`fine`),r(`delay.harmonics`,`Harmonics`,0,1,``,`harm`),r(`delay.splitPoint`,`Split point`,.05,.95,``,`splitPt`),i(`delay.split`,`Split`,`split`),i(`delay.polarity`,`Polarity`,`pol`),r(`filter.highpass`,`Highpass`,-60,36,`st`,`hp`),r(`filter.lowpass`,`Lowpass`,0,84,`st`,`lp`),r(`filter.hpComp`,`HP comp`,0,1,``,`hpComp`),r(`filter.lpComp`,`LP comp`,0,1,``,`lpComp`),this.controlList.push(new P(`voice.mode`,`Mode`,Dn,`poly`,t=>{this.releaseAll(),e.setParam(`pipe`,`mode`,Dn.indexOf(t))})),r(`voice.detune`,`Detune`,0,100,`ct`,`detune`),r(`voice.glide`,`Glide`,1,5e3,`ms`,`glide`,1/1e3,`log`),i(`voice.glideOn`,`Glide on`,`glideOn`),this.controlList.push(new P(`lfo.wave`,`Wave`,On,`sine`,t=>e.setParam(`pipe`,`lfoShape`,On.indexOf(t))),new P(`lfo.dest`,`Destination`,kn,`pitch`,t=>e.setParam(`pipe`,`lfoDest`,kn.indexOf(t))),new P(`lfo.division`,`Division`,An,`1/8`,e=>{this.lfoDivision=e,this.applyLfoRate()}),new F(`lfo.sync`,`Sync`,!1,e=>{this.lfoSync=e,this.applyLfoRate()})),n(`lfo.rate`,`Rate`,.05,40,`Hz`,e=>{this.lfoHz=e,this.applyLfoRate()},`log`),r(`lfo.delay`,`Delay`,0,5,`s`,`lfoDelay`),r(`lfo.amount`,`Amount`,0,1,``,`lfoAmt`),n(`rev.mix`,`Mix`,0,1,``,t=>{e.setParam(`dry`,`gain`,Math.cos(t*Math.PI/2)),e.setParam(`wet`,`gain`,Math.sin(t*Math.PI/2)*Fn)}),n(`rev.bass`,`Bass`,20,800,`Hz`,t=>e.setParam(`revLow`,`frequency`,t),`log`),n(`rev.treble`,`Treble`,1500,16e3,`Hz`,t=>e.setParam(`revHigh`,`frequency`,t),`log`),r(`rev.spread`,`Spread`,0,1,``,`spread`),this.controlList.push(new P(`rev.size`,`Size`,it,`medium`,t=>e.setOption(`conv`,`size`,t)))}applyLfoRate(){let e=Number(this.lfoDivision.split(`/`)[1]),t=this.lfoSync?this.transport.bpm/60*e/4:this.lfoHz;this.circuit.setParam(`pipe`,`lfoRate`,Math.min(40,Math.max(.05,t)))}releaseAll(){this.circuit.allNotesOff(`pipe`),this.held.length>0&&(this.held=[],this.notifyNotes())}keyDown(e,t=Pn){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.circuit.noteOn(`pipe`,e,t),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.circuit.noteOff(`pipe`,e),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}setSustain(e){this.circuit.pedal(`pipe`,e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`pipe`,`bend`,this.bend*Nn),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`pipe`,`mod`,this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(e.type===`clock`)this.lfoSync&&this.transport.synced&&++this.clockPulses%24==0&&this.applyLfoRate();else if(`channel`in e&&this.transport.acceptsChannel(e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity/127);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===jn?this.setModWheel(e.value/127):e.controller===Mn&&this.setSustain(e.value>=64);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...Cn,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}},Ln={"osc.wave":`saw`,"osc.width":50,"osc.pwm":0,"osc.vibrato":0,"osc.sub":.3,"filter.cutoff":2400,"filter.resonance":1,"filter.env":2,"filter.lfo":0,"filter.key":50,"amp.lfo":0,"amp.key":0,level:.7,"lfo.wave":`tri`,"lfo.rate":5,"lfo.sync":0,"lfo.division":`1/8`,"env1.attack":.005,"env1.decay":.4,"env1.sustain":.4,"env1.release":.4,"env2.attack":.005,"env2.decay":.3,"env2.sustain":.7,"env2.release":.35,"voices.mode":`poly`,"voices.portamento":0,"voices.detune":12,"fx.chorus":0,"fx.delayTime":.35,"fx.feedback":.3,"fx.mix":0},W=(e,t)=>({name:e,values:t}),Rn=[[W(`Soft Pad`,{"osc.sub":.2,"filter.cutoff":900,"filter.resonance":1.2,"filter.env":1.5,"filter.lfo":.3,"env1.attack":.6,"env1.decay":1.2,"env1.sustain":.5,"env1.release":1.5,"env2.attack":.5,"env2.decay":.8,"env2.sustain":.8,"env2.release":1.6,"lfo.rate":.4,"fx.chorus":.7,"fx.mix":.15,"fx.delayTime":.45,"fx.feedback":.35,level:.6}),W(`Warm Brass`,{"osc.sub":.3,"filter.cutoff":700,"filter.env":3.2,"osc.vibrato":8,"env1.attack":.12,"env1.decay":.5,"env1.sustain":.55,"env1.release":.25,"env2.attack":.06,"env2.decay":.3,"env2.sustain":.85,"env2.release":.2,"fx.chorus":.3}),W(`Pluck Bass`,{"voices.mode":`mono`,"osc.sub":.6,"filter.cutoff":350,"filter.resonance":4,"filter.env":3.5,"env1.attack":.001,"env1.decay":.22,"env1.sustain":0,"env1.release":.15,"env2.attack":.001,"env2.decay":.35,"env2.sustain":.5,"env2.release":.1,"voices.portamento":.05}),W(`Glass Keys`,{"osc.wave":`tri`,"osc.sub":0,"filter.cutoff":5200,"filter.resonance":.5,"filter.env":.5,"env1.attack":.001,"env1.decay":.8,"env1.sustain":.2,"env1.release":.6,"env2.attack":.002,"env2.decay":1.2,"env2.sustain":.1,"env2.release":.8,"fx.chorus":.45,"fx.mix":.2,"fx.delayTime":.3,"fx.feedback":.4}),W(`Slow Strings`,{"filter.cutoff":3e3,"filter.env":.6,"filter.key":70,"osc.vibrato":12,"lfo.rate":5.5,"env1.attack":.8,"env1.decay":1,"env1.sustain":.7,"env1.release":1.2,"env2.attack":.9,"env2.decay":1,"env2.sustain":.9,"env2.release":1.4,"fx.chorus":.8}),W(`Sweep Lead`,{"voices.mode":`mono`,"osc.wave":`pulse`,"osc.width":30,"osc.pwm":.4,"osc.sub":.2,"lfo.rate":.7,"filter.cutoff":1500,"filter.resonance":5,"filter.env":2.5,"env1.attack":.001,"env1.decay":.8,"env1.sustain":.35,"env1.release":.3,"env2.sustain":.9,"voices.portamento":.12,"fx.mix":.3,"fx.delayTime":.4,"fx.feedback":.45}),W(`Wobble Sub`,{"voices.mode":`mono`,"osc.sub":.8,"filter.cutoff":260,"filter.resonance":6,"filter.lfo":2.2,"filter.env":.5,"lfo.sync":1,"lfo.division":`1/8`,"env2.sustain":.95,level:.55}),W(`Bell Pluck`,{"osc.wave":`tri`,"osc.sub":0,"filter.cutoff":8e3,"filter.resonance":.3,"filter.env":.2,"osc.vibrato":4,"env1.attack":.001,"env1.decay":.5,"env1.sustain":0,"env1.release":.4,"env2.attack":.001,"env2.decay":1.6,"env2.sustain":0,"env2.release":1.4,"fx.chorus":.3,"fx.mix":.3,"fx.delayTime":.5,"fx.feedback":.5})],[W(`Init`,{}),W(`Analog Poly`,{"filter.cutoff":1800,"filter.resonance":1.5,"filter.env":2,"env1.attack":.01,"env1.decay":.5,"env1.sustain":.35,"env1.release":.4,"env2.attack":.01,"env2.decay":.4,"env2.sustain":.75,"env2.release":.4,"fx.chorus":.35}),W(`Choir Air`,{"osc.wave":`pulse`,"osc.width":40,"osc.pwm":.2,"filter.cutoff":1600,"filter.resonance":2.5,"filter.env":1,"env2.attack":.35,"env2.decay":.6,"env2.sustain":.85,"env2.release":1.1,"fx.chorus":.6,"fx.mix":.2}),W(`Retro Stab`,{"filter.cutoff":600,"filter.resonance":2,"filter.env":4,"env1.attack":.001,"env1.decay":.22,"env1.sustain":0,"env1.release":.2,"env2.attack":.001,"env2.decay":.25,"env2.sustain":0,"env2.release":.2,"fx.chorus":.5}),W(`Fifth Lead`,{"voices.mode":`unison`,"voices.detune":18,"filter.cutoff":2600,"filter.resonance":2,"filter.env":1.5,"env2.sustain":.8,"voices.portamento":.08,"fx.mix":.25}),W(`Dream Wash`,{"osc.sub":.4,"filter.cutoff":1100,"lfo.rate":.3,"filter.lfo":.4,"env1.attack":1.8,"env1.decay":1,"env1.sustain":.6,"env1.release":2.5,"env2.attack":1.5,"env2.decay":1,"env2.sustain":.85,"env2.release":3,"fx.chorus":.9,"fx.mix":.4,"fx.delayTime":.6,"fx.feedback":.6,level:.55}),W(`Pulse Organ`,{"osc.wave":`pulse`,"osc.width":50,"osc.sub":.5,"filter.cutoff":3200,"filter.resonance":.5,"filter.env":.3,"osc.vibrato":6,"lfo.rate":6.5,"env2.attack":.005,"env2.decay":.1,"env2.sustain":1,"env2.release":.08,"fx.chorus":.3}),W(`Space Arp`,{"osc.wave":`pulse`,"osc.width":25,"osc.pwm":.6,"lfo.rate":1.2,"filter.cutoff":1e3,"filter.resonance":3,"filter.env":3,"env1.attack":.001,"env1.decay":.25,"env1.sustain":.1,"env1.release":.2,"env2.attack":.002,"env2.decay":.3,"env2.sustain":.2,"env2.release":.25,"fx.mix":.4,"fx.delayTime":.38,"fx.feedback":.55,"fx.chorus":.2})]],zn=Rn.flat(),Bn=1200,Vn=69,Hn=200,Un=100,Wn=1,Gn=[`saw`,`pulse`,`tri`],Kn=[`tri`,`up`,`down`,`sqr`,`rnd`],qn=[`1/1`,`1/2`,`1/4`,`1/8`,`1/16`,`1/32`],Jn={poly:.45,mono:.6,unison:.34},Yn=.65,Xn=class extends I{name;transport;slots=[...zn];currentSlot=Rn[0].length;currentPreset=this.slots[this.currentSlot];allocator=new sn(6);held=[];bend=0;modWheelValue=0;vibratoCents=0;portamento=0;unisonDetune=12;lfoHz=5;lfoSync=!1;lfoDivision=`1/8`;clockPulses=0;performanceListeners=new Set;noteListeners=new Set;presetListeners=new Set;constructor(e=`Poly`,t=new L){super(),this.name=e,this.transport=new be(t),this.transport.channel.set(`2`);let n=this.circuit;this.addShared(n);for(let e=0;e<6;e++)this.addVoice(n,e);this.addEffects(n),this.outputList.push({name:`out`,nodeId:`level`}),this.addControls(n),this.transport.tempo.onChange(()=>this.applyLfoRate())}keyDown(e){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.apply(this.allocator.noteOn(e)),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.apply(this.allocator.noteOff(e)),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}voiceActive(e){return this.allocator.isActive(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*Hn),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.applyVibrato(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(e.type===`clock`)this.lfoSync&&this.transport.synced&&++this.clockPulses%24==0&&this.applyLfoRate();else if(!(`channel`in e&&!this.transport.acceptsChannel(e.channel)))switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===Wn&&this.setModWheel(e.value/127);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...Ln,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e,t=this.slots[e].name){let n={name:t,values:this.snapshot()};this.slots[e]=n,this.currentSlot=e,this.currentPreset=n;for(let e of this.presetListeners)e();return n}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}apply(e){let t=this.circuit;for(let n of e){let e=e=>`v${n.voice}.${e}`;n.kind===`off`?(t.setParam(e(`env1`),`gate`,0),t.setParam(e(`env2`),`gate`,0)):(n.glide||t.setParam(e(`pitch`),`glide`,0),t.setParam(e(`pitch`),`offset`,(n.note-Vn)*100),n.glide||t.setParam(e(`pitch`),`glide`,this.portamento),n.retrigger&&(t.setParam(e(`env1`),`gate`,1),t.setParam(e(`env2`),`gate`,1)))}}eachVoice(e){for(let t=0;t<6;t++)e(e=>`v${t}.${e}`)}applyMode(e){this.apply(this.allocator.releaseAll()),this.held=[],this.allocator.mode=e,this.eachVoice(t=>this.circuit.setParam(t(`out`),`gain`,Jn[e])),this.applyDetune(),this.notifyNotes()}applyDetune(){let e=this.allocator.mode===`unison`?this.unisonDetune:0,t=5/2;for(let n=0;n<6;n++){let r=(n-t)/t*e;this.circuit.setParam(`v${n}.det`,`offset`,r===0?0:r)}}applyVibrato(){this.circuit.setParam(`lfoPitch`,`gain`,this.vibratoCents+this.modWheelValue*Un)}applyLfoRate(){let e=Number(this.lfoDivision.split(`/`)[1]),t=this.lfoSync?this.transport.bpm/60*e/4:this.lfoHz;this.circuit.setParam(`lfoOsc`,`frequency`,t),this.circuit.setParam(`lfoRnd`,`rate`,t)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}addShared(e){e.add(`bend`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:-1200}).add(`pwCv`,`constant`,{offset:0}).add(`lfoOsc`,`oscillator`,{frequency:5,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:5}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoSign`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0}).add(`lfoAmp`,`gain`,{gain:0}).add(`voices`,`gain`,{gain:1}).connect(`lfoOsc`,`lfoOscOut`).connect(`lfoOscOut`,`lfoSign`).connect(`lfoSign`,`lfo`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoRndOut`,`lfo`);for(let t of[`lfoPitch`,`lfoPw`,`lfoFilter`,`lfoAmp`])e.connect(`lfo`,t)}addVoice(e,t){let n=e=>`v${t}.${e}`;e.add(n(`pitch`),`constant`,{offset:0,glide:0}).add(n(`det`),`constant`,{offset:0}).add(n(`osc`),`oscillator`,{frequency:440,detune:0},{waveform:`sawtooth`}).add(n(`sub`),`oscillator`,{frequency:440,detune:0},{waveform:`square`}).add(n(`rawOut`),`gain`,{gain:1}).add(n(`pulseSum`),`gain`,{gain:1}).add(n(`shaper`),`waveshaper`,{},{curve:`pulse`}).add(n(`pulseOut`),`gain`,{gain:0}).add(n(`subLevel`),`gain`,{gain:0}).add(n(`mix`),`gain`,{gain:.5}).add(n(`f1`),`filter`,{frequency:2400,Q:1,detune:0},{type:`lowpass`}).add(n(`f2`),`filter`,{frequency:2400,Q:.707,detune:0},{type:`lowpass`}).add(n(`keyFollow`),`gain`,{gain:.5}).add(n(`env1`),`envelope`,{attack:.005,decay:.4,sustain:.4,release:.4,gate:0}).add(n(`env1Depth`),`gain`,{gain:2*Bn}).add(n(`env2`),`envelope`,{attack:.005,decay:.3,sustain:.7,release:.35,gate:0}).add(n(`amp`),`gain`,{gain:0}).add(n(`trem`),`gain`,{gain:1}).add(n(`ampKey`),`gain`,{gain:0}).add(n(`out`),`gain`,{gain:Jn.poly});for(let t of[`osc`,`sub`])e.connect(n(`pitch`),n(t),`detune`).connect(n(`det`),n(t),`detune`).connect(`bend`,n(t),`detune`).connect(`lfoPitch`,n(t),`detune`);e.connect(`subShift`,n(`sub`),`detune`).connect(n(`osc`),n(`rawOut`)).connect(n(`osc`),n(`pulseSum`)).connect(`pwCv`,n(`pulseSum`)).connect(`lfoPw`,n(`pulseSum`)).connect(n(`pulseSum`),n(`shaper`)).connect(n(`shaper`),n(`pulseOut`)).connect(n(`rawOut`),n(`mix`)).connect(n(`pulseOut`),n(`mix`)).connect(n(`sub`),n(`subLevel`)).connect(n(`subLevel`),n(`mix`)).connect(n(`mix`),n(`f1`)).connect(n(`f1`),n(`f2`)).connect(n(`f2`),n(`amp`)).connect(n(`env1`),n(`env1Depth`)).connect(n(`pitch`),n(`keyFollow`));for(let t of[`f1`,`f2`])e.connect(n(`env1Depth`),n(t),`detune`).connect(n(`keyFollow`),n(t),`detune`).connect(`lfoFilter`,n(t),`detune`);e.connect(n(`env2`),n(`amp`),`gain`).connect(n(`amp`),n(`trem`)).connect(`lfoAmp`,n(`trem`),`gain`).connect(n(`pitch`),n(`ampKey`)).connect(n(`ampKey`),n(`trem`),`gain`).connect(n(`trem`),n(`out`)).connect(n(`out`),`voices`)}addEffects(e){e.add(`chorusDry`,`gain`,{gain:1}).add(`chorusWet`,`gain`,{gain:0}).add(`chDelayA`,`delay`,{delayTime:.016,maxTime:.05}).add(`chDelayB`,`delay`,{delayTime:.024,maxTime:.05}).add(`chLfoA`,`oscillator`,{frequency:.62,detune:0},{waveform:`sine`}).add(`chLfoB`,`oscillator`,{frequency:.83,detune:0},{waveform:`sine`}).add(`chDepthA`,`gain`,{gain:.0025}).add(`chDepthB`,`gain`,{gain:.003}).add(`fxMix`,`gain`,{gain:1}).connect(`voices`,`chorusDry`).connect(`chorusDry`,`fxMix`).connect(`voices`,`chDelayA`).connect(`voices`,`chDelayB`).connect(`chDelayA`,`chorusWet`).connect(`chDelayB`,`chorusWet`).connect(`chorusWet`,`fxMix`).connect(`chLfoA`,`chDepthA`).connect(`chDepthA`,`chDelayA`,`delayTime`).connect(`chLfoB`,`chDepthB`).connect(`chDepthB`,`chDelayB`,`delayTime`),e.add(`dlyLine`,`delay`,{delayTime:.35,maxTime:1.5}).add(`dlyTone`,`filter`,{frequency:4500,Q:.707,detune:0},{type:`lowpass`}).add(`dlyFb`,`gain`,{gain:.3}).add(`dlyWet`,`gain`,{gain:0}).add(`dlySum`,`gain`,{gain:1}).add(`level`,`gain`,{gain:.7}).connect(`fxMix`,`dlySum`).connect(`fxMix`,`dlyLine`).connect(`dlyLine`,`dlyTone`).connect(`dlyTone`,`dlyFb`).connect(`dlyFb`,`dlyLine`).connect(`dlyTone`,`dlyWet`).connect(`dlyWet`,`dlySum`).connect(`dlySum`,`level`)}addControls(e){let t=(e,t,n,r,i,a,o,s)=>this.controlList.push(new N(e,t,n,r,i,a,o,s)),n=e=>t=>this.eachVoice(n=>e(n,t)),r=Ln,i=e=>r[e],a=(r,a,o,s,c)=>t(`${r}.${a}`,o,s,c,i(`${r}.${a}`),`s`,n((t,n)=>e.setParam(t(r),a,n)),`log`),o=r=>t(`${r}.sustain`,`Sustain`,0,1,i(`${r}.sustain`),``,n((t,n)=>e.setParam(t(r),`sustain`,n)));this.controlList.push(new P(`osc.wave`,`Wave`,Gn,r[`osc.wave`],t=>this.eachVoice(n=>{e.setOption(n(`osc`),`waveform`,t===`tri`?`triangle`:`sawtooth`),e.setParam(n(`rawOut`),`gain`,t===`pulse`?0:1),e.setParam(n(`pulseOut`),`gain`,t===`pulse`?Yn:0)}))),t(`osc.width`,`Width`,5,50,i(`osc.width`),`%`,t=>e.setParam(`pwCv`,`offset`,1-2*t/100)),t(`osc.pwm`,`LFO PWM`,0,100,i(`osc.pwm`)*100,`%`,t=>e.setParam(`lfoPw`,`gain`,t/100*.9)),t(`osc.vibrato`,`LFO Pitch`,0,100,i(`osc.vibrato`),`ct`,e=>{this.vibratoCents=e,this.applyVibrato()}),t(`osc.sub`,`Sub`,0,1,i(`osc.sub`),``,n((t,n)=>e.setParam(t(`subLevel`),`gain`,n*.6))),t(`filter.cutoff`,`Cutoff`,20,2e4,i(`filter.cutoff`),`Hz`,n((t,n)=>{e.setParam(t(`f1`),`frequency`,n),e.setParam(t(`f2`),`frequency`,n)}),`log`),t(`filter.resonance`,`Resonance`,.1,20,i(`filter.resonance`),``,n((t,n)=>e.setParam(t(`f1`),`Q`,n))),t(`filter.env`,`Env 1`,0,6,i(`filter.env`),`oct`,n((t,n)=>e.setParam(t(`env1Depth`),`gain`,n*Bn))),t(`filter.lfo`,`LFO`,0,4,i(`filter.lfo`),`oct`,t=>e.setParam(`lfoFilter`,`gain`,t*Bn)),t(`filter.key`,`Key track`,0,100,i(`filter.key`),`%`,n((t,n)=>e.setParam(t(`keyFollow`),`gain`,n/100))),t(`amp.lfo`,`LFO`,0,100,i(`amp.lfo`),`%`,t=>e.setParam(`lfoAmp`,`gain`,t/100*.8)),t(`amp.key`,`Key track`,0,100,i(`amp.key`),`%`,n((t,n)=>e.setParam(t(`ampKey`),`gain`,n/100/6e3))),t(`level`,`Volume`,0,1,i(`level`),``,t=>e.setParam(`level`,`gain`,t)),this.controlList.push(new P(`lfo.wave`,`Wave`,Kn,r[`lfo.wave`],t=>{e.setOption(`lfoOsc`,`waveform`,t===`sqr`?`square`:t===`up`||t===`down`?`sawtooth`:`triangle`),e.setParam(`lfoSign`,`gain`,t===`down`?-1:1),e.setParam(`lfoOscOut`,`gain`,t===`rnd`?0:1),e.setParam(`lfoRndOut`,`gain`,+(t===`rnd`))})),t(`lfo.rate`,`Rate`,.1,30,i(`lfo.rate`),`Hz`,e=>{this.lfoHz=e,this.applyLfoRate()},`log`),this.controlList.push(new F(`lfo.sync`,`Sync`,!1,e=>{this.lfoSync=e,this.applyLfoRate()}),new P(`lfo.division`,`Division`,qn,r[`lfo.division`],e=>{this.lfoDivision=e,this.applyLfoRate()}));for(let e of[`env1`,`env2`])a(e,`attack`,`Attack`,.001,5),a(e,`decay`,`Decay`,.005,5),o(e),a(e,`release`,`Release`,.005,10);this.controlList.push(new P(`voices.mode`,`Mode`,on,r[`voices.mode`],e=>this.applyMode(e))),t(`voices.portamento`,`Portamento`,0,2,i(`voices.portamento`),`s`,t=>{this.portamento=t,this.eachVoice(n=>e.setParam(n(`pitch`),`glide`,t))}),t(`voices.detune`,`Detune`,0,50,i(`voices.detune`),`ct`,e=>{this.unisonDetune=e,this.applyDetune()}),t(`fx.chorus`,`Chorus`,0,1,i(`fx.chorus`),``,t=>{e.setParam(`chorusWet`,`gain`,t*.7),e.setParam(`chorusDry`,`gain`,1-t*.25)}),t(`fx.delayTime`,`Delay time`,.01,1,i(`fx.delayTime`),`s`,t=>e.setParam(`dlyLine`,`delayTime`,t),`log`),t(`fx.feedback`,`Feedback`,0,.9,i(`fx.feedback`),``,t=>e.setParam(`dlyFb`,`gain`,t)),t(`fx.mix`,`Delay mix`,0,1,i(`fx.mix`),``,t=>e.setParam(`dlyWet`,`gain`,t))}},Zn={"spring.length":2,"spring.tension":.5,"spring.drip":.6,"spring.tilt":0,"spring.dwell":.4,"spring.mix":.25},Qn=1.6,$n=class extends I{name;constructor(e=`Spring`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`spring`,`spring`,{tension:.5,drip:.6,decay:2,tilt:0,dwell:.4}).add(`dry`,`gain`,{gain:1}).add(`wet`,`gain`,{gain:0}).add(`sum`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`spring`).connect(`in`,`dry`).connect(`spring`,`wet`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=(e,t,n,r,i,a,o)=>this.controlList.push(new N(e,t,n,r,Zn[e],i,a,o));n(`spring.length`,`Length`,.2,8,`s`,e=>t.setParam(`spring`,`decay`,e),`log`),n(`spring.tension`,`Tension`,0,1,``,e=>t.setParam(`spring`,`tension`,e)),n(`spring.drip`,`Drip`,0,1,``,e=>t.setParam(`spring`,`drip`,e)),n(`spring.tilt`,`Tilt`,-1,1,``,e=>t.setParam(`spring`,`tilt`,e)),n(`spring.dwell`,`Dwell`,0,1,``,e=>t.setParam(`spring`,`dwell`,e)),n(`spring.mix`,`Dry / wet`,0,1,``,e=>{t.setParam(`dry`,`gain`,Math.cos(e*Math.PI/2)),t.setParam(`wet`,`gain`,Math.sin(e*Math.PI/2)*Qn)})}reset(){for(let e of this.controlList)e.kind===`number`&&e.set(e.initial)}},er=75,tr=10,nr=15,rr=[`A`,`B`,`C`],ir=[[1,2],[3,4],[5,6]],ar=class extends I{channelCount;returnCount;returnFeeds;name;muted=new Set;soloed=new Set;constructor(e=1,t=`Mixer`,n=0,r={}){super(),this.channelCount=e,this.returnCount=n,this.returnFeeds=r,this.name=t;let i=this.circuit;i.add(`main`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`ceiling`,`waveshaper`,{},{curve:`limit`}).add(`mainMeter`,`meter`,{},{channel:`mono`}).connect(`main`,`limiter`).connect(`limiter`,`ceiling`).connect(`ceiling`,`mainMeter`),this.outputList.push({name:`main`,nodeId:`ceiling`}),i.add(`key`,`gain`,{gain:1}),this.outputList.push({name:`key`,nodeId:`key`}),this.meterList.push({name:`main`,nodeId:`mainMeter`});for(let e of rr){let t=`bus${e}`;i.add(t,`gain`,{gain:1}).add(`${t}.toMain`,`gain`,{gain:1}).add(`${t}.meterL`,`meter`,{},{channel:`left`}).add(`${t}.meterR`,`meter`,{},{channel:`right`}).connect(t,`${t}.toMain`).connect(`${t}.toMain`,`main`).connect(t,`${t}.meterL`).connect(t,`${t}.meterR`),this.outputList.push({name:t,nodeId:t}),this.meterList.push({name:`${t}.L`,nodeId:`${t}.meterL`},{name:`${t}.R`,nodeId:`${t}.meterR`}),this.controlList.push(new N(`${t}.fader`,`Bus ${e}`,0,1.5,1,``,e=>i.setParam(t,`gain`,e)),new F(`${t}.main`,`To main`,!0,e=>i.setParam(`${t}.toMain`,`gain`,+!!e)))}for(let e=1;e<=6;e++)i.add(`aux${e}`,`gain`,{gain:1}),this.outputList.push({name:`aux${e}`,nodeId:`aux${e}`}),this.controlList.push(new N(`aux${e}.master`,`Aux ${e}`,0,1.5,1,``,t=>i.setParam(`aux${e}`,`gain`,t)));for(let t=1;t<=e;t++)this.addStrip(`ch${t}`,t,!1);for(let e=1;e<=n;e++)this.addStrip(`ret${e}`,e,!0);this.controlList.push(new P(`key.source`,`Key source`,[`off`,...Array.from({length:e},(e,t)=>`${t+1}`)],`off`,t=>{for(let n=1;n<=e;n++)i.setParam(`ch${n}.keySend`,`gain`,+(t===`${n}`))}))}addStrip(e,t,n){let r=this.circuit,i=t=>`${e}.${t}`;r.add(i(`lowcut`),`filter`,{frequency:tr,Q:.707,gain:0},{type:`highpass`}).add(i(`eqLow`),`filter`,{frequency:80,Q:.707,gain:0},{type:`lowshelf`}).add(i(`eqMid`),`filter`,{frequency:2500,Q:1,gain:0},{type:`peaking`}).add(i(`eqHigh`),`filter`,{frequency:12e3,Q:.707,gain:0},{type:`highshelf`}).add(i(`drive`),`gain`,{gain:1/3}).add(i(`sat`),`waveshaper`,{},{curve:`warm`}).add(i(`mute`),`gain`,{gain:1}).add(i(`fader`),`gain`,{gain:.8}).add(i(`pan`),`pan`,{pan:0}).connect(i(`lowcut`),i(`eqLow`)).connect(i(`eqLow`),i(`eqMid`)).connect(i(`eqMid`),i(`eqHigh`)).connect(i(`eqHigh`),i(`drive`)).connect(i(`drive`),i(`sat`)).connect(i(`sat`),i(`mute`)).connect(i(`mute`),i(`fader`)).connect(i(`fader`),i(`pan`)),n?(r.add(i(`meterL`),`meter`,{},{channel:`left`}).add(i(`meterR`),`meter`,{},{channel:`right`}).connect(i(`pan`),i(`meterL`)).connect(i(`pan`),i(`meterR`)),this.meterList.push({name:`${e}.L`,nodeId:i(`meterL`)},{name:`${e}.R`,nodeId:i(`meterR`)})):(r.add(i(`meter`),`meter`,{},{channel:`mono`}).connect(i(`fader`),i(`meter`)).add(i(`keySend`),`gain`,{gain:0}).connect(i(`mute`),i(`keySend`)).connect(i(`keySend`),`key`),this.meterList.push({name:e,nodeId:i(`meter`)})),this.inputList.push({name:e,nodeId:i(`lowcut`)});let a=rr.filter(e=>!(n&&this.returnFeeds[t]===e));for(let e of a)r.add(i(`assign${e}`),`gain`,{gain:0}).connect(i(`pan`),i(`assign${e}`)).connect(i(`assign${e}`),`bus${e}`);for(let e=1;e<=6;e++)r.add(i(`aux${e}.pre`),`gain`,{gain:0}).add(i(`aux${e}.post`),`gain`,{gain:1}).add(i(`aux${e}`),`gain`,{gain:0}).connect(i(`mute`),i(`aux${e}.pre`)).connect(i(`fader`),i(`aux${e}.post`)).connect(i(`aux${e}.pre`),i(`aux${e}`)).connect(i(`aux${e}.post`),i(`aux${e}`)).connect(i(`aux${e}`),`aux${e}`);let o=(e,t,n,r,a,o,s,c)=>new N(i(e),t,n,r,a,o,s,c),s=(e,t,n)=>o(e,t,-15,nr,0,`dB`,e=>r.setParam(i(n),`gain`,e));this.controlList.push(new F(i(`lowcutOn`),`Low cut`,!1,e=>r.setParam(i(`lowcut`),`frequency`,e?er:tr)),s(`eqHigh`,`High`,`eqHigh`),s(`eqMid`,`Mid`,`eqMid`),o(`eqMidFreq`,`Freq`,100,8e3,2500,`Hz`,e=>r.setParam(i(`eqMid`),`frequency`,e),`log`),s(`eqLow`,`Low`,`eqLow`));for(let e=1;e<=6;e++)this.controlList.push(o(`aux${e}`,`${e}`,0,1,0,``,t=>r.setParam(i(`aux${e}`),`gain`,t)));for(let[e,t]of ir)this.controlList.push(new F(i(`auxPre${e}${t}`),`Pre ${e}-${t}`,!1,n=>{for(let a of[e,t])r.setParam(i(`aux${a}.pre`),`gain`,+!!n),r.setParam(i(`aux${a}.post`),`gain`,+!n)}));this.controlList.push(o(`pan`,n?`Balance`:`Pan`,-1,1,0,``,e=>r.setParam(i(`pan`),`pan`,e))),n?this.controlList.push(new F(i(`mute`),`Mute`,!1,e=>r.setParam(i(`mute`),`gain`,+!e))):this.controlList.push(new F(i(`mute`),`Mute`,!1,e=>this.setFlag(this.muted,t,e)),new F(i(`solo`),`Solo`,!1,e=>this.setFlag(this.soloed,t,e)));for(let e of a)this.controlList.push(new F(i(`bus${e}`),e,e===`A`,t=>r.setParam(i(`assign${e}`),`gain`,+!!t)));this.controlList.push(o(`fader`,`Fader`,0,1.5,.8,``,e=>r.setParam(i(`fader`),`gain`,e)))}get soloActive(){return this.soloed.size>0}setFlag(e,t,n){n?e.add(t):e.delete(t);for(let e=1;e<=this.channelCount;e++){let t=`ch${e}.mute`;if(!this.circuit.nodes.has(t))continue;let n=this.muted.has(e)||this.soloed.size>0&&!this.soloed.has(e);this.circuit.setParam(t,`gain`,+!n)}}},or={"osc.range":`8'`,"osc.width":50,"osc.pwSource":`man`,"osc.pwm":0,"osc.mod":0,"osc.sub":`-1`,"mix.saw":.8,"mix.pulse":0,"mix.sub":.55,"mix.noise":.05,"filter.cutoff":800,"filter.resonance":1,"filter.keyFollow":50,"filter.lfo":0,"filterEnv.amount":2,"filterEnv.attack":.005,"filterEnv.decay":.3,"filterEnv.sustain":.3,"filterEnv.release":.3,"ampEnv.attack":.005,"ampEnv.decay":.2,"ampEnv.sustain":.7,"ampEnv.release":.3,"lfo.wave":`tri`,"lfo.rate":4.8,"perf.glide":0,"perf.notes":`legato`,level:.5},G=(e,t)=>({name:e,values:t}),sr=[G(`Init`,{}),G(`Sub Bass`,{"osc.range":`16'`,"mix.saw":.5,"mix.sub":.95,"mix.noise":0,"filter.cutoff":380,"filter.resonance":2,"filter.keyFollow":30,"filterEnv.amount":1.5,"filterEnv.attack":.001,"filterEnv.decay":.25,"filterEnv.sustain":.2,"ampEnv.attack":.002,"ampEnv.decay":.3,"ampEnv.sustain":.85,"ampEnv.release":.12,level:.6}),G(`Acid Squelch`,{"osc.range":`16'`,"mix.saw":1,"mix.sub":.35,"mix.noise":0,"filter.cutoff":220,"filter.resonance":14,"filter.keyFollow":40,"filterEnv.amount":4,"filterEnv.attack":.001,"filterEnv.decay":.18,"filterEnv.sustain":0,"filterEnv.release":.1,"ampEnv.sustain":.9,"ampEnv.release":.08,"perf.glide":.08,level:.45}),G(`Fat Pulse Bass`,{"osc.range":`16'`,"osc.width":30,"mix.saw":0,"mix.pulse":.9,"mix.sub":.5,"mix.noise":0,"filter.cutoff":520,"filter.resonance":3,"filterEnv.amount":2,"filterEnv.decay":.3,"filterEnv.sustain":.2,"ampEnv.sustain":.85,"ampEnv.release":.1}),G(`Wobble Bass`,{"osc.range":`16'`,"mix.saw":.8,"mix.sub":.7,"mix.noise":0,"filter.cutoff":300,"filter.resonance":6,"filter.lfo":2,"filterEnv.amount":.5,"filterEnv.sustain":.5,"lfo.wave":`tri`,"lfo.rate":3,"ampEnv.sustain":1,"ampEnv.release":.12,level:.55}),G(`Funk Pluck`,{"osc.range":`8'`,"osc.width":25,"mix.saw":.3,"mix.pulse":.8,"mix.sub":.3,"mix.noise":0,"filter.cutoff":260,"filter.resonance":5,"filter.keyFollow":60,"filterEnv.amount":3.5,"filterEnv.attack":.001,"filterEnv.decay":.15,"filterEnv.sustain":0,"ampEnv.attack":.001,"ampEnv.decay":.2,"ampEnv.sustain":.3,"ampEnv.release":.1}),G(`Rubber Bass`,{"osc.range":`16'`,"mix.saw":.7,"mix.sub":.8,"mix.noise":0,"filter.cutoff":150,"filter.resonance":8,"filter.keyFollow":25,"filterEnv.amount":3,"filterEnv.attack":.001,"filterEnv.decay":.3,"filterEnv.sustain":.1,"ampEnv.sustain":.8,"ampEnv.release":.1,level:.55}),G(`Saw Lead`,{"mix.saw":1,"mix.sub":.2,"mix.noise":0,"filter.cutoff":3e3,"filter.resonance":3,"filter.keyFollow":70,"filterEnv.amount":1,"perf.glide":.06,"osc.mod":15,"lfo.rate":5.5,"ampEnv.sustain":.9,"ampEnv.release":.25}),G(`Hollow Pulse Lead`,{"osc.width":18,"mix.saw":0,"mix.pulse":1,"mix.sub":0,"mix.noise":0,"filter.cutoff":2500,"filter.resonance":2,"filter.keyFollow":80,"filterEnv.amount":1.5,"filterEnv.attack":.01,"filterEnv.decay":.4,"filterEnv.sustain":.5,"ampEnv.sustain":.8,"ampEnv.release":.2}),G(`PWM Lead`,{"mix.saw":.2,"mix.pulse":.9,"mix.sub":.2,"mix.noise":0,"osc.pwSource":`lfo`,"osc.pwm":70,"lfo.rate":1.2,"filter.cutoff":3e3,"filter.resonance":2,"filter.keyFollow":70,"filterEnv.amount":1,"ampEnv.sustain":.9,"ampEnv.release":.3}),G(`Vibrato Lead`,{"mix.saw":.8,"mix.pulse":.4,"mix.sub":.1,"mix.noise":0,"osc.mod":40,"lfo.rate":5.2,"filter.cutoff":2800,"filter.resonance":3,"filter.keyFollow":70,"filterEnv.amount":1.2,"perf.glide":.1,"ampEnv.attack":.01,"ampEnv.sustain":.9,"ampEnv.release":.3}),G(`Portamento Solo`,{"mix.saw":1,"mix.sub":.3,"mix.noise":0,"perf.glide":.35,"perf.notes":`legato`,"filter.cutoff":2200,"filter.resonance":4,"filterEnv.amount":.8,"filterEnv.sustain":.6,"ampEnv.sustain":1,"ampEnv.release":.2}),G(`Clarinet`,{"osc.width":50,"mix.saw":0,"mix.pulse":1,"mix.sub":0,"mix.noise":.03,"filter.cutoff":1800,"filter.resonance":1,"filter.keyFollow":70,"filterEnv.amount":1,"filterEnv.attack":.04,"filterEnv.sustain":.6,"ampEnv.attack":.04,"ampEnv.sustain":.9,"ampEnv.release":.12,"osc.mod":8,"lfo.rate":5}),G(`Brass`,{"mix.saw":1,"mix.pulse":.4,"mix.sub":.2,"mix.noise":0,"filter.cutoff":500,"filter.resonance":2,"filter.keyFollow":60,"filterEnv.amount":3,"filterEnv.attack":.12,"filterEnv.decay":.3,"filterEnv.sustain":.6,"ampEnv.attack":.08,"ampEnv.decay":.2,"ampEnv.sustain":.85,"ampEnv.release":.2}),G(`Siren`,{"mix.saw":1,"mix.sub":0,"mix.noise":0,"osc.mod":600,"lfo.wave":`tri`,"lfo.rate":.7,"filter.cutoff":4e3,"filter.resonance":2,"filterEnv.amount":0,"ampEnv.sustain":1,"ampEnv.release":.15}),G(`Random SFX`,{"mix.saw":.5,"mix.pulse":.5,"mix.sub":0,"mix.noise":0,"lfo.wave":`rnd`,"lfo.rate":9,"osc.mod":500,"filter.cutoff":1200,"filter.resonance":8,"filter.lfo":2.5,"filterEnv.amount":0,"ampEnv.attack":.01,"ampEnv.sustain":1,"ampEnv.release":.1,level:.45}),G(`Snare`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":1,"filter.cutoff":3e3,"filter.resonance":2,"filter.keyFollow":0,"filterEnv.amount":1,"filterEnv.attack":.001,"filterEnv.decay":.1,"filterEnv.sustain":0,"ampEnv.attack":.001,"ampEnv.decay":.18,"ampEnv.sustain":0,"ampEnv.release":.1,level:.6}),G(`Wind`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":1,"filter.cutoff":500,"filter.resonance":8,"filter.keyFollow":0,"filterEnv.amount":4,"filterEnv.attack":2,"filterEnv.decay":2,"filterEnv.sustain":.5,"filterEnv.release":2,"ampEnv.attack":1.5,"ampEnv.sustain":1,"ampEnv.release":2,level:.5}),G(`Whistle`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":.6,"filter.cutoff":2e3,"filter.resonance":20,"filter.keyFollow":100,"filterEnv.amount":0,"osc.mod":20,"lfo.rate":5,"ampEnv.attack":.05,"ampEnv.sustain":1,"ampEnv.release":.2,level:.35})],cr=new Map([[70,`filter.cutoff`],[71,`filter.resonance`],[72,`filterEnv.amount`],[73,`filterEnv.decay`],[74,`ampEnv.decay`],[75,`ampEnv.release`],[76,`osc.width`],[77,`osc.pwm`],[78,`mix.pulse`],[79,`mix.sub`],[80,`mix.noise`],[81,`lfo.rate`],[82,`osc.mod`],[83,`perf.glide`]]);function lr(e,t){let n=Math.min(127,Math.max(0,t))/127;if(e.kind===`number`)e.set(e.curve===`log`?e.min*(e.max/e.min)**+n:e.min+n*(e.max-e.min));else if(e.kind===`choice`){let t=Math.min(e.options.length-1,Math.floor(n*e.options.length));e.set(e.options[t])}else e.set(t>=64)}var ur=1200,dr=200,fr=100,pr=1,mr=440,hr=4.8,gr=[`man`,`lfo`,`env`],_r=[`legato`,`retrig`],vr=[`tri`,`sqr`,`rnd`],yr={"16'":-1200,"8'":0,"4'":1200,"2'":2400},br={"-1":-1200,"-2":-2400},xr=class extends I{name;transport;ccMap=new Map(cr);held=[];presetListeners=new Set;currentPreset=sr[0];gateOpen=!1;glideSeconds=0;retrigger=!1;pwSource=`man`;pwmAmount=0;bend=0;modWheelValue=0;oscModCents=0;performanceListeners=new Set;noteListeners=new Set;constructor(e=`Synth`,t=new L){super(),this.name=e,this.transport=new be(t);let n=this.circuit;n.add(`pitch`,`constant`,{offset:0,glide:0}).add(`range`,`constant`,{offset:0}).add(`bend`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:br[-1]}).add(`pulseWidthCv`,`constant`,{offset:0}).add(`sawOsc`,`oscillator`,{frequency:mr,detune:0},{waveform:`sawtooth`}).add(`pulseOsc`,`oscillator`,{frequency:mr,detune:0},{waveform:`sawtooth`}).add(`pulseSum`,`gain`,{gain:1}).add(`pulseShaper`,`waveshaper`,{},{curve:`pulse`}).add(`subOsc`,`oscillator`,{frequency:mr,detune:0},{waveform:`square`}).add(`noise`,`noise`).add(`mix.saw`,`gain`,{gain:.8}).add(`mix.pulse`,`gain`,{gain:0}).add(`mix.sub`,`gain`,{gain:.55}).add(`mix.noise`,`gain`,{gain:.05}).add(`mix`,`gain`,{gain:.5}).add(`filter1`,`filter`,{frequency:800,Q:1,detune:0},{type:`lowpass`}).add(`filter2`,`filter`,{frequency:800,Q:.707,detune:0},{type:`lowpass`}).add(`keyFollow`,`gain`,{gain:.5}).add(`amp`,`gain`,{gain:0}).add(`level`,`gain`,{gain:.5}).add(`ampEnv`,`envelope`,{attack:.005,decay:.2,sustain:.7,release:.3,gate:0}).add(`filterEnv`,`envelope`,{attack:.005,decay:.3,sustain:.3,release:.3,gate:0}).add(`filterEnvDepth`,`gain`,{gain:2*ur}).add(`lfoOsc`,`oscillator`,{frequency:hr,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:hr}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`envPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0});for(let e of[`sawOsc`,`pulseOsc`,`subOsc`])n.connect(`pitch`,e,`detune`).connect(`range`,e,`detune`).connect(`bend`,e,`detune`);n.connect(`subShift`,`subOsc`,`detune`).connect(`pulseOsc`,`pulseSum`).connect(`pulseWidthCv`,`pulseSum`).connect(`pulseSum`,`pulseShaper`).connect(`sawOsc`,`mix.saw`).connect(`pulseShaper`,`mix.pulse`).connect(`subOsc`,`mix.sub`).connect(`noise`,`mix.noise`);for(let e of[`mix.saw`,`mix.pulse`,`mix.sub`,`mix.noise`])n.connect(e,`mix`);n.connect(`mix`,`filter1`).connect(`filter1`,`filter2`).connect(`filter2`,`amp`).connect(`amp`,`level`).connect(`ampEnv`,`amp`,`gain`).connect(`filterEnv`,`filterEnvDepth`).connect(`pitch`,`keyFollow`);for(let e of[`filter1`,`filter2`])n.connect(`filterEnvDepth`,e,`detune`).connect(`keyFollow`,e,`detune`).connect(`lfoFilter`,e,`detune`);for(let e of[`sawOsc`,`pulseOsc`,`subOsc`])n.connect(`lfoPitch`,e,`detune`);n.connect(`lfoOsc`,`lfoOscOut`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoOscOut`,`lfo`).connect(`lfoRndOut`,`lfo`).connect(`lfo`,`lfoPitch`).connect(`lfo`,`lfoPw`).connect(`lfo`,`lfoFilter`).connect(`lfoPw`,`pulseSum`).connect(`filterEnv`,`envPw`).connect(`envPw`,`pulseSum`),this.outputList.push({name:`out`,nodeId:`level`}),this.controlList.push(new P(`osc.range`,`Range`,Object.keys(yr),`8'`,e=>n.setParam(`range`,`offset`,yr[e])),new N(`osc.width`,`Width`,5,50,50,`%`,e=>n.setParam(`pulseWidthCv`,`offset`,1-2*e/100)),new P(`osc.sub`,`Sub`,Object.keys(br),`-1`,e=>n.setParam(`subShift`,`offset`,br[e])),Cr(n,`saw`,`Saw`,.8),Cr(n,`pulse`,`Pulse`,0),Cr(n,`sub`,`Sub`,.55),Cr(n,`noise`,`Noise`,.05),new N(`filter.cutoff`,`Cutoff`,20,2e4,800,`Hz`,e=>{n.setParam(`filter1`,`frequency`,e),n.setParam(`filter2`,`frequency`,e)},`log`),new N(`filter.resonance`,`Resonance`,.1,20,1,``,e=>n.setParam(`filter1`,`Q`,e)),new N(`filter.keyFollow`,`Key`,0,100,50,`%`,e=>n.setParam(`keyFollow`,`gain`,e/100)),new N(`perf.glide`,`Glide`,0,3,0,`s`,e=>{this.glideSeconds=e,n.setParam(`pitch`,`glide`,e)}),new P(`perf.notes`,`Notes`,_r,`legato`,e=>{this.retrigger=e===`retrig`}),new P(`lfo.wave`,`Wave`,vr,`tri`,e=>{n.setOption(`lfoOsc`,`waveform`,e===`sqr`?`square`:`triangle`),n.setParam(`lfoOscOut`,`gain`,e===`rnd`?0:1),n.setParam(`lfoRndOut`,`gain`,+(e===`rnd`))}),new N(`lfo.rate`,`Rate`,.1,30,hr,`Hz`,e=>{n.setParam(`lfoOsc`,`frequency`,e),n.setParam(`lfoRnd`,`rate`,e)},`log`),new N(`osc.mod`,`Mod`,0,600,0,`ct`,e=>{this.oscModCents=e,this.applyVibrato()}),new P(`osc.pwSource`,`PW src`,gr,`man`,e=>{this.pwSource=e,this.applyPwm()}),new N(`osc.pwm`,`PWM`,0,100,0,`%`,e=>{this.pwmAmount=e/100,this.applyPwm()}),new N(`filter.lfo`,`LFO`,0,4,0,`oct`,e=>n.setParam(`lfoFilter`,`gain`,e*ur)),new N(`level`,`Level`,0,1,.5,``,e=>n.setParam(`level`,`gain`,e)),new N(`filterEnv.amount`,`Amount`,0,6,2,`oct`,e=>n.setParam(`filterEnvDepth`,`gain`,e*ur)),...Sr(n,`filterEnv`,{attack:.005,decay:.3,sustain:.3,release:.3}),...Sr(n,`ampEnv`,{attack:.005,decay:.2,sustain:.7,release:.3}))}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*dr),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.applyVibrato(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}applyVibrato(){this.circuit.setParam(`lfoPitch`,`gain`,this.oscModCents+this.modWheelValue*fr)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}loadPreset(e){let t={...or,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}keyDown(e){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.noteOn(wr(e)),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e);let t=this.held[this.held.length-1];t===void 0?this.noteOff():this.noteOn(wr(t)),this.notifyNotes()}handleMidi(e){if(!(`channel`in e&&!this.transport.acceptsChannel(e.channel)))switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:{if(e.controller===pr){this.setModWheel(e.value/127);break}let t=this.ccMap.get(e.controller);t&&lr(this.control(t),e.value);break}case`programChange`:{let t=sr[e.program];t&&this.loadPreset(t);break}}}applyPwm(){let e=this.pwmAmount*.9;this.circuit.setParam(`lfoPw`,`gain`,this.pwSource===`lfo`?e:0),this.circuit.setParam(`envPw`,`gain`,this.pwSource===`env`?e:0)}noteOn(e){let t=this.gateOpen,n=this.glideSeconds;t||this.circuit.setParam(`pitch`,`glide`,0),this.circuit.setParam(`pitch`,`offset`,ur*Math.log2(e/mr)),t||this.circuit.setParam(`pitch`,`glide`,n),(!t||this.retrigger)&&(this.circuit.setParam(`ampEnv`,`gate`,1),this.circuit.setParam(`filterEnv`,`gate`,1)),this.gateOpen=!0}noteOff(){this.circuit.setParam(`ampEnv`,`gate`,0),this.circuit.setParam(`filterEnv`,`gate`,0),this.gateOpen=!1}};function Sr(e,t,n){let r=(r,i,a,o)=>new N(`${t}.${r}`,i,a,o,n[r],`s`,n=>e.setParam(t,r,n),`log`);return[r(`attack`,`Attack`,.001,5),r(`decay`,`Decay`,.005,5),new N(`${t}.sustain`,`Sustain`,0,1,n.sustain,``,n=>e.setParam(t,`sustain`,n)),r(`release`,`Release`,.005,10)]}function Cr(e,t,n,r){return new N(`mix.${t}`,n,0,1,r,``,n=>e.setParam(`mix.${t}`,`gain`,n))}var wr=e=>mr*2**((e-69)/12),Tr=class e{devices=new Map;connections=[];output;add(e,t){if(this.devices.has(e))throw Error(`Duplicate device id: ${e}`);return this.devices.set(e,t),this}device(e){let t=this.devices.get(e);if(!t)throw Error(`Unknown device: ${e}`);return t}connect(e,t){if(this.device(e.device).jack(`out`,e.jack),this.device(t.device).jack(`in`,t.jack),this.connections.some(n=>n.to.device===t.device&&n.to.jack===t.jack&&n.from.device===e.device&&n.from.jack===e.jack))throw Error(`Duplicate connection`);return this.connections.push({from:e,to:t}),this}setOutput(e,t){return this.device(e).jack(`out`,t),this.output={device:e,jack:t},this}static lynch(t=new L){return new e().add(`lynch`,new Sn(`Lynch`,t)).setOutput(`lynch`,`out`)}static duo(){return new e().add(`duo`,new Wt(`MOA-DUO`)).setOutput(`duo`,`out`)}static df2(t=new L){return new e().add(`lynch`,new Sn(`Lynch`,t)).add(`box`,new Zt(`MOA-DF2`)).connect({device:`lynch`,jack:`out`},{device:`box`,jack:`in`}).setOutput(`box`,`out`)}static pipe(t=new L){return new e().add(`pipe`,new In(`Pipe`,t)).add(`spring`,new $n(`Spring`)).connect({device:`pipe`,jack:`out`},{device:`spring`,jack:`in`}).setOutput(`spring`,`out`)}static default(t=new L){let n=new e().add(`synth`,new xr(`Synth`,t)).add(`poly`,new Xn(`Poly`,t)).add(`drums`,new Te(`Drums`,t)).add(`reverb`,new ct(`Reverb`)).add(`delay`,new lt(`Delay`)).add(`ouroboros`,new Pt(`Ouroboros`)).add(`buscomp`,new rt(`Bus Comp`)).add(`granular`,new yt(`Granular`)).add(`mixer`,new ar(2+R.length,`Mixer`,5,{3:`C`,4:`B`})).connect({device:`synth`,jack:`out`},{device:`mixer`,jack:`ch1`}).connect({device:`poly`,jack:`out`},{device:`mixer`,jack:`ch2`});R.forEach((e,t)=>n.connect({device:`drums`,jack:e},{device:`mixer`,jack:`ch${t+3}`})),n.connect({device:`mixer`,jack:`aux1`},{device:`reverb`,jack:`in`}).connect({device:`mixer`,jack:`aux2`},{device:`delay`,jack:`in`}).connect({device:`reverb`,jack:`out`},{device:`mixer`,jack:`ret1`}).connect({device:`delay`,jack:`out`},{device:`mixer`,jack:`ret2`}),n.connect({device:`mixer`,jack:`busC`},{device:`ouroboros`,jack:`in`}).connect({device:`ouroboros`,jack:`out`},{device:`mixer`,jack:`ret3`}),n.connect({device:`mixer`,jack:`busB`},{device:`buscomp`,jack:`in`}).connect({device:`mixer`,jack:`key`},{device:`buscomp`,jack:`key`}).connect({device:`buscomp`,jack:`out`},{device:`mixer`,jack:`ret4`}),n.connect({device:`mixer`,jack:`aux3`},{device:`granular`,jack:`in`}).connect({device:`granular`,jack:`out`},{device:`mixer`,jack:`ret5`});let r=n.device(`mixer`);return r.control(`busC.main`).set(!1),r.control(`busB.main`).set(!1),r.control(`key.source`).set(`3`),n.setOutput(`mixer`,`main`)}},K=1e3;function Er(e){let t=e.curve===`log`?Math.log(e.value/e.min)/Math.log(e.max/e.min):(e.value-e.min)/(e.max-e.min);return Math.round(t*K)}function Dr(e,t){let n=t/K;return e.curve===`log`?e.min*(e.max/e.min)**+n:e.min+n*(e.max-e.min)}function Or(e){let t=e.value;return`${t>=100?t.toFixed(0):t>=10?t.toFixed(1):t>=1?t.toFixed(2):t.toFixed(3)}${e.unit?` `+e.unit:``}`}function kr(e){let t=e.value;return`${Math.abs(t)>=100?t.toFixed(0):Math.abs(t)>=10?t.toFixed(1):t.toFixed(2)}${e.unit?` `+e.unit:``}`}function q(e,t,n){let r=document.createElement(e);return t&&(r.className=t),n!==void 0&&(r.textContent=n),r}function Ar(e,t,n,{height:r=140,capHeight:i=36,tick:a=14,unity:o}={}){let s=q(`div`,`fader`);s.append(q(`div`,`fader-label`,n));let c=q(`div`,`fader-slot`);if(c.style.setProperty(`--slot-h`,`${r}px`),c.style.setProperty(`--cap-h`,`${i}px`),c.style.setProperty(`--tick`,`${a}px`),c.append(q(`div`,`fader-track`)),o!==void 0){let t=q(`div`,`fader-unity`),n=(o-e.min)/(e.max-e.min);t.style.top=`${Math.round((1-n)*(r-i)+i/2)}px`,c.append(t)}let l=q(`div`,`fader-cap`);l.append(q(`span`,`fader-cap-line`)),c.append(l);let u=q(`input`,`fader-input`);u.type=`range`,u.min=`0`,u.max=String(K),u.setAttribute(`aria-label`,`${t} ${e.label}`),c.append(u);let d=q(`div`,`fader-value`),f=()=>{u.value=String(Er(e));let t=Number(u.value)/K;l.style.top=`${Math.round((1-t)*(r-i))}px`,d.textContent=Or(e),u.setAttribute(`aria-valuetext`,d.textContent)};return u.addEventListener(`input`,()=>{e.set(Dr(e,Number(u.value))),f()}),c.addEventListener(`dblclick`,()=>{e.set(e.initial),f()}),e.onChange(f),f(),s.append(c,d),s}var jr=270,Mr=160;function Nr(e,t,n,r=34){let i=q(`div`,`knob-wrap`);i.append(q(`div`,`knob-label`,n));let a=q(`div`,`knob`);a.style.width=`${r}px`,a.style.height=`${r}px`,a.tabIndex=0,a.setAttribute(`role`,`slider`),a.setAttribute(`aria-label`,`${t} ${e.label}`),a.setAttribute(`aria-orientation`,`vertical`),a.setAttribute(`aria-valuemin`,String(e.min)),a.setAttribute(`aria-valuemax`,String(e.max));let o=q(`div`,`knob-pointer`);a.append(o);let s=q(`div`,`knob-value`),c=()=>{let t=Er(e)/K;o.style.transform=`rotate(${-135+t*jr}deg)`,s.textContent=kr(e),a.setAttribute(`aria-valuenow`,String(e.value)),a.setAttribute(`aria-valuetext`,s.textContent)},l=t=>{e.set(Dr(e,Math.round(Math.min(1,Math.max(0,t))*K))),c()},u;a.addEventListener(`pointerdown`,t=>{a.setPointerCapture(t.pointerId),u={y:t.clientY,t:Er(e)/K}}),a.addEventListener(`pointermove`,e=>{u&&l(u.t+(u.y-e.clientY)/Mr)});let d=()=>{u=void 0};return a.addEventListener(`pointerup`,d),a.addEventListener(`pointercancel`,d),a.addEventListener(`dblclick`,()=>{e.set(e.initial),c()}),a.addEventListener(`keydown`,t=>{let n=Er(e)/K,r=t.shiftKey?.1:.02,i={ArrowUp:n+r,ArrowRight:n+r,ArrowDown:n-r,ArrowLeft:n-r,Home:0,End:1};t.key in i&&(t.preventDefault(),l(i[t.key]))}),e.onChange(c),c(),i.append(a,s),i}function Pr(e,t,n,r,i=`btn`){let a=q(`button`,i);a.type=`button`,a.setAttribute(`aria-label`,t);let o=()=>{a.textContent=n(e.value),a.setAttribute(`aria-pressed`,String(e.value)),a.style.background=e.value?r:``,a.style.borderColor=e.value?r:``};return a.addEventListener(`click`,()=>{e.set(!e.value),o()}),e.onChange(o),o(),a}var Fr=150;function Ir(e,t,n,r,i){let a=q(`section`,`midi-strip`),o=q(`div`,`midi-block`);o.append(q(`div`,`fader-label`,`Audio`),r);let s=q(`div`,`midi-block`);s.append(q(`div`,`fader-label`,`MIDI input`));let c=q(`div`,`midi-device`);s.append(c);let l=()=>{if(c.replaceChildren(),e.status===`unsupported`)c.append(q(`div`,`midi-message`,`MIDI is not available in this browser. Try Chrome or Edge.`));else if(e.status===`denied`)c.append(q(`div`,`midi-message`,`MIDI access was blocked. Allow it in the site settings, then reload.`));else if(e.status===`idle`){let t=q(`button`,`btn midi-connect`,`Connect MIDI`);t.type=`button`,t.addEventListener(`click`,()=>void e.connect()),c.append(t)}else{let t=q(`select`,`patch-select`);t.setAttribute(`aria-label`,`MIDI input device`),t.add(new Option(e.inputs.length?`No device selected`:`No MIDI devices found`,``));for(let n of e.inputs)t.add(new Option(n.name,n.id));t.value=e.selectedId??``,t.addEventListener(`change`,()=>e.select(t.value||void 0)),c.append(t)}};e.onChange(l),l();let u,d;if(i?.supported){u=q(`div`,`midi-block`),u.append(q(`div`,`fader-label`,`Sequencer bus`));let e=q(`div`,`midi-bus`);d=q(`span`,`led`);let t=q(`button`,`btn btn-small midi-bus-toggle`);t.type=`button`,t.setAttribute(`aria-label`,`Listen to MIDI from the sequencer page in another tab`);let n=()=>{t.textContent=i.enabled?`On`:`Off`,t.setAttribute(`aria-pressed`,String(i.enabled))};t.addEventListener(`click`,()=>i.setEnabled(!i.enabled)),i.onChange(n),n(),e.append(d,t),u.append(e)}let f=q(`div`,`midi-block`);f.append(q(`div`,`fader-label`,`Incoming clock`));let p=q(`div`,`midi-bpm`,`--.-`),m=q(`div`,`midi-badges`),h=q(`span`,`badge`,`No clock`),g=q(`span`,`badge`,`Stopped`);m.append(h,g),f.append(p,m);let _=q(`div`,`midi-block`);_.append(q(`div`,`fader-label`,`Activity`));let v=q(`div`,`midi-leds`),y={note:q(`span`,`led`),cc:q(`span`,`led`),clock:q(`span`,`led`)};for(let[e,t]of[[`note`,`Notes`],[`cc`,`CC`],[`clock`,`Clock`]]){let n=q(`div`,`led-item`);n.append(y[e],q(`span`,void 0,t)),v.append(n)}_.append(v);let b=q(`div`,`midi-block midi-monitor-block`),x=q(`div`,`midi-monitor-head`);x.append(q(`div`,`fader-label`,`Monitor`));let S=q(`button`,`btn btn-small midi-clear`,`Clear`);S.type=`button`,S.addEventListener(`click`,()=>n.clear()),x.append(S);let C=q(`div`,`midi-log`);C.setAttribute(`role`,`log`),C.setAttribute(`aria-label`,`Recent MIDI messages`),b.append(x,C);let w=()=>{C.replaceChildren(...n.lines.slice(-5).map(e=>q(`div`,`midi-line midi-line-${e.kind}`,e.text)))};n.onChange(w),w(),a.append(o,s,...u?[u]:[],f,_,b);let T=()=>{let e=performance.now(),r=t.bpm,a=t.isLocked(e);p.textContent=r!==void 0&&a?r.toFixed(1):`--.-`,h.textContent=a?`Clock locked`:`No clock`,h.classList.toggle(`on`,a),g.textContent=t.running?`Running`:`Stopped`,g.classList.toggle(`on`,t.running),i&&d&&d.classList.toggle(`on`,e-i.lastSeen<Fr);for(let t of[`note`,`cc`,`clock`])y[t].classList.toggle(`on`,e-n.lastSeen[t]<Fr);requestAnimationFrame(T)};return requestAnimationFrame(T),a}function Lr(e){try{let t=window.localStorage.getItem(e);return t?JSON.parse(t):{}}catch{return{}}}var Rr=(e,t)=>typeof e==`object`&&!!e&&Object.entries(e).every(([e,n])=>t.has(e)&&(typeof n==`number`||typeof n==`string`));function zr(e,t){let n=new Set(t.controls.map(e=>e.id));for(let[r,i]of Object.entries(Lr(e))){let e=Number(r);Number.isInteger(e)&&e>=0&&e<t.slots.length&&typeof i?.name==`string`&&Rr(i.values,n)&&(t.slots[e]=i)}}function Br(e,t,n){try{window.localStorage.setItem(e,JSON.stringify({...Lr(e),[t]:n}))}catch{}}var Vr=`moa-fx2.patches`,Hr=1440,Ur=400,Wr=`http://www.w3.org/2000/svg`,Gr=`#ece2c4`,Kr=`#c4c2a4`,J=(e,t)=>{let n=e.control(t);if(n.kind!==`number`)throw Error(`${t} is not a number control`);return n},qr=(e,t)=>{let n=e.control(t);if(n.kind!==`toggle`)throw Error(`${t} is not a toggle control`);return n},Jr=e=>e>=1e3?`${(e/1e3).toFixed(2)} s`:e<10?`${e.toFixed(1)} ms`:`${Math.round(e)} ms`,Yr=e=>`${e>0?`+`:``}${Math.round(e)} dB`,Xr=e=>`${Math.round(e)} Hz`,Zr=e=>`${Math.round(e*100)} %`,Qr=e=>`${e%1?e.toFixed(1):e}:1`;function $r(e,t,n){e.style.left=`${t}px`,e.style.top=`${n}px`}function ei(e,t){let n=document.createElementNS(Wr,e);for(let[e,r]of Object.entries(t))n.setAttribute(e,r);return n}function ti(e,t){let n={x:48,y:44},r=(e,t)=>{let r=e*Math.PI/180;return[n.x+t*Math.sin(r),n.y-t*Math.cos(r)]},i=[];for(let n=0;n<t;n++){let a=-135+270*n/(t-1),[o,s]=r(a,33),[c,l]=r(a,40);i.push(`<line x1="${o.toFixed(2)}" y1="${s.toFixed(2)}" x2="${c.toFixed(2)}" y2="${l.toFixed(2)}" stroke="${Gr}" stroke-width="1.6" stroke-linecap="round"/>`);let u=e[n];if(u){let[e,t]=r(a,47),n=e<10?`start`:e>86?`end`:`middle`,o=n===`start`?1:n===`end`?95:e;i.push(`<text x="${o.toFixed(2)}" y="${(t+3).toFixed(2)}" text-anchor="${n}" font-family="'DM Mono', monospace" font-size="9" fill="${Kr}">${u}</text>`)}}return i.join(``)}function ni(e){let t=e.control,n=q(`div`,`bc-knob`),r=q(`div`,`bc-knob-box`),i=ei(`svg`,{width:`96`,height:`88`,viewBox:`0 0 96 88`,"aria-hidden":`true`});i.style.cssText=`position:absolute;left:0;top:0`;let a=e.steps?e.steps.length:11;i.innerHTML=ti(e.steps?e.scale:[e.scale[0]??``,...Array(9).fill(``),e.scale[1]??``],a);let o=q(`div`,`bc-knob-cap`);o.tabIndex=0,o.setAttribute(`role`,`slider`),o.setAttribute(`aria-label`,e.label),o.setAttribute(`aria-valuemin`,`0`),o.setAttribute(`aria-valuemax`,`100`),o.innerHTML=`<div class="bc-knob-knurl"></div><div class="bc-knob-brass"></div><div class="bc-knob-pointer"></div>`,r.append(i,o);let s=q(`div`,`bc-silk`,e.label);s.style.fontSize=`13px`;let c=q(`div`,`bc-readout`);n.append(r,s,c);let l=t=>{let n=e.steps;return n.reduce((e,r,i)=>Math.abs(r-t)<Math.abs(n[e]-t)?i:e,0)},u=()=>e.steps?l(t.value)/(e.steps.length-1):Er(t)/K,d=n=>{let r=Math.min(1,Math.max(0,n));e.steps?t.set(e.steps[Math.round(r*(e.steps.length-1))]):t.set(Dr(t,Math.round(r*K)))},f=()=>{let n=u();o.style.transform=`rotate(${(-135+n*270).toFixed(1)}deg)`,c.textContent=e.text(t.value),o.setAttribute(`aria-valuenow`,String(Math.round(n*100))),o.setAttribute(`aria-valuetext`,c.textContent)},p;o.addEventListener(`pointerdown`,e=>{e.preventDefault(),o.focus(),o.setPointerCapture(e.pointerId),p={y:e.clientY,t:u(),scale:o.getBoundingClientRect().width/56||1}}),o.addEventListener(`pointermove`,t=>{if(!p)return;let n=e.steps?90:t.shiftKey?600:160;d(p.t+(p.y-t.clientY)/p.scale/n)});let m=()=>{p=void 0};return o.addEventListener(`pointerup`,m),o.addEventListener(`pointercancel`,m),o.addEventListener(`dblclick`,()=>t.set(t.initial)),o.addEventListener(`keydown`,t=>{let n=e.steps?1/(e.steps.length-1):t.shiftKey?.1:.02,r=u(),i={ArrowUp:r+n,ArrowRight:r+n,ArrowDown:r-n,ArrowLeft:r-n,Home:0,End:1};t.key in i&&(t.preventDefault(),d(i[t.key]))}),t.onChange(f),f(),n}function ri(){let e=(e,t)=>{let n=e*Math.PI/180;return[144+t*Math.sin(n),214-t*Math.cos(n)]},t=e=>e.toFixed(2),n=[],[r,i]=e(-50,156),[a,o]=e(50,156);n.push(`<path d="M ${t(r)} ${t(i)} A 156 156 0 0 1 ${t(a)} ${t(o)}" fill="none" stroke="#2a2417" stroke-width="1.5"/>`);let[s,c]=e(-50,160),[l,u]=e(-20,160);n.push(`<path d="M ${t(s)} ${t(c)} A 160 160 0 0 1 ${t(l)} ${t(u)}" fill="none" stroke="#9c2616" stroke-width="7"/>`);for(let r=0;r<=20;r++){let i=50-r*5,a=r%2==0,o=r>=14,[s,c]=e(i,156),[l,u]=e(i,a?142:148);if(n.push(`<line x1="${t(s)}" y1="${t(c)}" x2="${t(l)}" y2="${t(u)}" stroke="${o?`#9c2616`:`#2a2417`}" stroke-width="${a?2:1}"/>`),a){let[a,s]=e(i,128);n.push(`<text x="${t(a)}" y="${t(s+5)}" text-anchor="middle" font-family="'Barlow Condensed', sans-serif" font-weight="700" font-size="15" fill="${o?`#9c2616`:`#2a2417`}">${r}</text>`)}}return n.join(``)}var ii=14;function ai(e,t,n,r,i){zr(Vr,e),e.loadSlot(e.currentSlot);let a=q(`div`,`bc-wrap`),o=q(`div`,`bc-panel`);a.append(o);let s=[],c=(e,t)=>{let n=q(`div`,`bc-ear`);return $r(n,e,0),n.style.boxShadow=t?`inset 2px 0 0 rgba(0,0,0,.5), inset 3px 0 0 rgba(255,255,255,.08)`:`inset -2px 0 0 rgba(0,0,0,.5), inset -3px 0 0 rgba(255,255,255,.08)`,n.innerHTML=`<i class="bc-slot" style="top:40px"></i><i class="bc-slot" style="top:348px"></i><i class="bc-screw" style="top:13px;transform:rotate(20deg)"></i><i class="bc-screw" style="top:369px;transform:rotate(75deg)"></i>`,n};o.append(c(0,!1),c(1400,!0));let l=q(`div`,`bc-abs`);$r(l,40,0),l.style.cssText+=`width:1360px;height:400px`,o.append(l);let u=q(`div`,`bc-abs`);u.style.cssText=`left:14px;top:20px;width:176px;height:282px;display:flex;flex-direction:column;gap:14px`;let d=q(`div`,`bc-nameplate`);d.innerHTML=`<div class="bc-brand">MOA-FX2</div><div class="bc-silk" style="font-size:21px;font-weight:700;letter-spacing:.3em;color:#e2bd73">BUS COMP</div><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;height:1px;background:#8a6a30"></div><div class="bc-silk" style="font-size:10px;letter-spacing:.32em;color:#c9a05a">SIDECHAIN</div><div style="flex:1;height:1px;background:#8a6a30"></div></div>`;let f=q(`div`);f.style.cssText=`display:flex;align-items:center;gap:12px;height:32px`,f.innerHTML=`<div role="img" aria-label="Power on" class="bc-pilot"></div><div class="bc-silk" style="font-size:13px">Power</div>`;let p=qr(e,`bc.bypass`),m=q(`button`,`bc-wide`);m.type=`button`,m.innerHTML=`<i class="bc-lamp"></i><span class="bc-silk" style="font-size:16px;font-weight:700;letter-spacing:.22em;color:#2a2417">Bypass</span>`;let h=m.querySelector(`.bc-lamp`),g=()=>{m.setAttribute(`aria-pressed`,String(p.value)),m.classList.toggle(`bc-lit`,p.value),h.style.background=p.value?`#e0452b`:`#5b4a2a`,h.style.boxShadow=p.value?`0 0 8px 2px rgba(255,80,40,.8)`:`none`};m.addEventListener(`click`,()=>p.set(!p.value)),p.onChange(g),g();let _=q(`div`);_.style.cssText=`display:flex;justify-content:space-around;align-items:flex-end;flex:1`;let v=e=>`<div aria-hidden="true" style="display:flex;flex-direction:column;align-items:center;gap:4px"><div class="bc-jack"><div class="bc-jack-hole"><div class="bc-jack-pin"></div></div></div><div class="bc-silk" style="font-size:11px">${e}</div></div>`;_.innerHTML=v(`Input`)+v(`Output`),u.append(d,f,m,_),l.append(u);let y=q(`div`,`bc-abs`);y.style.cssText=`left:214px;top:20px;width:420px;height:282px;display:flex;flex-direction:column;gap:8px`,y.append(oi(`Compressor`));let b=q(`div`);b.style.cssText=`display:grid;grid-template-columns:repeat(4,96px);justify-content:space-between;row-gap:6px`,b.append(ni({control:J(e,`bc.threshold`),label:`Threshold`,text:Yr,scale:[`-60`,`0`]}),ni({control:J(e,`bc.ratio`),label:`Ratio`,text:Qr,scale:[`1.5`,`2`,`4`,`8`,`20`],steps:[1.5,2,4,8,20]}),ni({control:J(e,`bc.attack`),label:`Attack`,text:Jr,scale:[`0.3`,`1`,`3`,`10`,`30`],steps:[.3,1,3,10,30]}),ni({control:J(e,`bc.release`),label:`Release`,text:Jr,scale:[`50`,`100`,`200`,`400`,`800`],steps:[50,100,200,400,800]}),ni({control:J(e,`bc.knee`),label:`Knee`,text:Yr,scale:[`0`,`30`]}),ni({control:J(e,`bc.makeup`),label:`Make-up`,text:Yr,scale:[`0`,`+24`]}),ni({control:J(e,`bc.mix`),label:`Mix`,text:Zr,scale:[`DRY`,`WET`]}));let x=[`GR`,`IN`,`OUT`],S=0,C=q(`button`,`bc-knob`);C.type=`button`;let w=ei(`svg`,{width:`96`,height:`88`,viewBox:`0 0 96 88`,"aria-hidden":`true`});w.style.cssText=`position:absolute;left:0;top:0`,w.innerHTML=ti([...x],3);let T=q(`div`,`bc-knob-cap`);T.innerHTML=`<div class="bc-knob-knurl"></div><div class="bc-knob-brass"></div><div class="bc-knob-pointer"></div>`;let E=q(`div`,`bc-knob-box`);E.append(w,T);let ee=q(`div`,`bc-silk`,`Meter`);ee.style.fontSize=`13px`;let D=q(`div`,`bc-readout`);C.append(E,ee,D);let O=ei(`text`,{x:`144`,y:`156`,"text-anchor":`middle`,"font-family":`'Barlow Condensed', sans-serif`,"font-weight":`600`,"font-size":`12`,fill:`#2a2417`,"letter-spacing":`3.5`}),te=[`GAIN REDUCTION`,`INPUT LEVEL`,`OUTPUT LEVEL`],ne=()=>{T.style.transform=`rotate(${-135+S*135}deg)`,D.textContent=x[S],C.setAttribute(`aria-label`,`Meter mode ${x[S]}, press to change`),O.textContent=te[S]};C.addEventListener(`click`,()=>{S=(S+1)%3,ne()}),b.append(C),y.append(b),l.append(y);let re=q(`div`,`bc-abs`);re.style.cssText=`left:650px;top:22px;width:304px;display:flex;flex-direction:column;gap:10px;align-items:center`;let k=q(`div`,`bc-vu-bezel`),A=ei(`svg`,{width:`288`,height:`230`,viewBox:`0 0 288 230`,role:`img`,"aria-label":`Gain reduction VU meter`});A.style.display=`block`,A.innerHTML=`<defs><radialGradient id="bc-vuface" cx="50%" cy="85%" r="95%"><stop offset="0" stop-color="#fbeab4"/><stop offset="0.6" stop-color="#efd890"/><stop offset="1" stop-color="#d4aa5a"/></radialGradient></defs>
    <rect width="288" height="230" fill="url(#bc-vuface)"/>${ri()}
    <text x="144" y="132" text-anchor="middle" font-family="'Alfa Slab One', serif" font-size="22" fill="#2a2417" letter-spacing="2">dB</text>
    <text x="22" y="30" font-family="'Barlow Condensed', sans-serif" font-weight="600" font-size="11" fill="#2a2417" letter-spacing="2">MOA-FX2</text>`,A.append(O);let ie=ei(`g`,{});ie.innerHTML=`<line x1="146" y1="216" x2="146" y2="56" stroke="rgba(60,30,0,0.28)" stroke-width="2.4"/><line x1="144" y1="214" x2="144" y2="54" stroke="#17140d" stroke-width="2"/><line x1="144" y1="90" x2="144" y2="54" stroke="#b02a18" stroke-width="2"/>`,A.append(ie);let ae=ei(`g`,{});ae.innerHTML=`<circle cx="144" cy="214" r="24" fill="#17140d"/><circle cx="144" cy="214" r="24" fill="none" stroke="#6f5a2c" stroke-width="2"/><circle cx="144" cy="214" r="5" fill="#cfa65c"/>`,A.append(ae);let oe=q(`div`,`bc-vu-face`);oe.append(A),k.append(oe);let se=q(`div`);se.style.cssText=`display:flex;align-items:center;gap:10px;width:304px`,se.innerHTML=`<div style="flex:1;height:1px;background:#c4c2a4;opacity:.5"></div><div class="bc-silk" style="font-size:11px;letter-spacing:.3em;color:#c4c2a4">Bus B insert</div><div style="flex:1;height:1px;background:#c4c2a4;opacity:.5"></div>`,re.append(k,se),l.append(re),ne();let j=q(`div`,`bc-abs`);j.style.cssText=`left:966px;top:22px;width:52px;display:flex;flex-direction:column;gap:8px;align-items:center`,j.append(q(`div`,`bc-silk`,`Out`)),j.firstChild.style.cssText=`font-size:12px;color:#c4c2a4`;let M=q(`div`);M.style.cssText=`display:flex;gap:8px;justify-content:center`;let N=[`L`,`R`].map(t=>{let n=q(`div`);n.style.cssText=`display:flex;flex-direction:column;align-items:center;gap:5px`;let r=q(`div`,`bc-ladder`),i=Array.from({length:ii},()=>q(`div`,`bc-seg`));r.append(...[...i].reverse());let a=q(`div`,`bc-silk`,t);return a.style.fontSize=`13px`,n.append(r,a),M.append(n),{segs:i,nodeId:e.meters.find(e=>e.name===`out.${t}`).nodeId}});j.append(M),l.append(j);let P=q(`div`,`bc-sidechain`);$r(P,1032,14);let F=q(`div`,`bc-side-title`);F.append(q(`div`,`bc-silk`,`Sidechain`)),F.firstChild.style.cssText=`font-size:15px;font-weight:700;letter-spacing:.34em`;let ce=q(`div`);ce.style.cssText=`display:flex;justify-content:space-between`,ce.append(ni({control:J(e,`bc.duck.depth`),label:`Duck depth`,text:Zr,scale:[`0`,`100`]}),ni({control:J(e,`bc.duck.release`),label:`Duck release`,text:Jr,scale:[`20`,`800`]}),ni({control:J(e,`bc.duck.keyHp`),label:`Key HP`,text:Xr,scale:[`20`,`300`]}));let le=q(`div`);le.style.cssText=`display:flex;flex-direction:column;gap:4px`;let I=q(`div`,`bc-silk`,`Key source`);I.style.cssText=`font-size:11px;color:#c4c2a4`;let ue=q(`div`);ue.style.cssText=`display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px`;let de=t.control(`key.source`),fe=i.map(e=>{let t=q(`button`,`bc-keybtn`,e.label);return t.type=`button`,t.addEventListener(`click`,()=>de.set(e.value)),ue.append(t),{b:t,value:e.value}}),pe=qr(e,`bc.listen`),me=q(`button`,`bc-keybtn`,`Listen`);me.type=`button`,me.addEventListener(`click`,()=>pe.set(!pe.value)),ue.append(me);let L=()=>{for(let{b:e,value:t}of fe)e.setAttribute(`aria-pressed`,String(de.value===t)),e.classList.toggle(`bc-lit`,de.value===t);me.setAttribute(`aria-pressed`,String(pe.value)),me.classList.toggle(`bc-lit`,pe.value)};de.onChange(L),pe.onChange(L),L(),le.append(I,ue);let he=q(`div`);he.style.cssText=`display:flex;align-items:center;gap:8px;margin-top:2px`;let ge=q(`div`,`bc-keylamp`);ge.setAttribute(`role`,`img`);let _e=q(`div`);_e.style.cssText=`display:flex;align-items:center;gap:5px`,_e.append(ge,q(`div`,`bc-silk`,`Key`)),_e.lastChild.style.fontSize=`11px`;let ve=q(`div`,`bc-duckbar`),ye=Array.from({length:12},()=>{let e=q(`div`,`bc-duckseg`);return ve.append(e),e}),be=q(`div`,`bc-silk`,`Duck`);be.style.fontSize=`11px`,he.append(_e,ve,be),P.append(F,ce,le,he),l.append(P);let R=q(`div`,`bc-strip`),xe=q(`div`,`bc-silk`,`Preset`);xe.style.cssText=`font-size:14px;font-weight:700;letter-spacing:.26em;width:74px`,R.append(xe);let Se=e.slots.map((t,n)=>{let r=q(`button`,`bc-preset`);return r.type=`button`,r.innerHTML=`<i class="bc-preset-led"></i><span></span>`,r.addEventListener(`click`,()=>e.loadSlot(n)),R.append(r),r}),Ce=q(`div`);Ce.style.cssText=`width:2px;align-self:stretch;margin:12px 4px;background:rgba(0,0,0,.35)`;let we=q(`button`,`bc-save`,`Save`);we.type=`button`,we.setAttribute(`aria-label`,`Save patch`);let Te=!1,Ee=()=>{Se.forEach((t,n)=>{let r=n===e.currentSlot;t.setAttribute(`aria-pressed`,String(r)),t.classList.toggle(`bc-lit`,r),t.querySelector(`span`).textContent=e.slots[n].name}),we.textContent=Te?`Saved`:`Save`};we.addEventListener(`click`,()=>{Br(Vr,e.currentSlot,e.saveSlot(e.currentSlot)),Te=!0,Ee(),window.setTimeout(()=>{Te=!1,Ee()},1500)}),e.onPresetChange(Ee),Ee(),R.append(Ce,we),l.append(R);let De=e.meters.find(e=>e.name===`in`).nodeId,Oe=e.meters.find(e=>e.name===`duck`).nodeId,ke=J(e,`bc.duck.depth`),Ae=0,je=performance.now(),Me=e=>e>0?20*Math.log10(e):-60;s.push(()=>{let e=performance.now(),t=Math.min(.1,(e-je)/1e3);je=e;let i=r.readLevel(n,Oe),a;if(S===0){let e=-Me(Math.max(.001,1-ke.value*i));a=p.value?0:Math.max(0,-r.readReduction(n,`comp`))+e}else a=S===1?-Me(r.readLevel(n,De)):-Math.max(...N.map(e=>Me(r.readLevel(n,e.nodeId))));a=Math.min(20,Math.max(0,S===0?a:Math.min(20,a)));let o=a>Ae?12:5;Ae+=(a-Ae)*Math.min(1,o*t),ie.setAttribute(`transform`,`rotate(${(50-5*Ae).toFixed(2)} 144 214)`),A.setAttribute(`aria-label`,`${te[S].toLowerCase()} meter, minus ${Ae.toFixed(1)} dB`);for(let{segs:e,nodeId:t}of N){let i=Me(r.readLevel(n,t));e.forEach((e,t)=>{let n=i>-42+3*t,r=t>=13?`#e0452b`:t>=11?`#ffb347`:`#8fd46a`;e.style.background=n?r:``,e.style.boxShadow=n?`0 0 6px ${r}`:``})}let s=Math.round(Math.min(1,i*ke.value)*12);ye.forEach((e,t)=>{let n=t>=10?`#e0452b`:t>=7?`#ffb347`:`#8fd46a`;e.style.background=t<s?n:``,e.style.boxShadow=t<s?`0 0 5px ${n}`:``});let c=i>.02;ge.style.background=c?`#ffb347`:`#4a3a22`,ge.style.boxShadow=c?`0 0 8px 2px rgba(255,170,60,.8)`:`none`,ge.setAttribute(`aria-label`,`Key signal ${c?`active`:`off`}`)});let Ne=()=>{if(!a.clientWidth)return;let e=a.clientWidth/Hr;o.style.transform=`scale(${e})`,a.style.height=`${Math.round(Ur*e)}px`};a.style.height=`${Ur}px`,new ResizeObserver(Ne).observe(a),window.requestAnimationFrame(Ne);let Pe=()=>{for(let e of s)e();requestAnimationFrame(Pe)};return requestAnimationFrame(Pe),a}function oi(e){let t=q(`div`);return t.style.cssText=`display:flex;align-items:center;gap:10px;height:18px`,t.innerHTML=`<div style="flex:1;height:2px;background:${Kr};opacity:.6"></div><div class="bc-silk" style="font-size:14px;letter-spacing:.32em">${e}</div><div style="flex:1;height:2px;background:${Kr};opacity:.6"></div>`,t}var si=270,ci=160,li=600,ui=131.95;function di(e,t,n=e.label){return{label:n,color:t,get:()=>Er(e)/K,set:t=>e.set(Dr(e,Math.round(Math.min(1,Math.max(0,t))*K))),reset:()=>e.set(e.initial),text:()=>Or(e),subscribe:t=>e.onChange(t)}}var fi=(e,t)=>{let n=Math.round((-135+e*si)*10)/10;return`<svg aria-hidden="true" width="72" height="72" viewBox="0 0 80 80">
    <path d="M16.34 64.42 A34 34 0 1 1 63.66 64.42" fill="none" stroke="#6b6f75" stroke-width="4" stroke-dasharray="1.2 14.8"></path>
    <path d="M20.2 59.8 A28 28 0 1 1 59.8 59.8" fill="none" stroke="#33363b" stroke-width="3"></path>
    <path d="M20.2 59.8 A28 28 0 1 1 59.8 59.8" fill="none" stroke="${t}" stroke-width="3" stroke-dasharray="${(e*ui).toFixed(1)} 200"></path>
    <circle cx="40" cy="40" r="22" fill="#101112" stroke="#4a4e54" stroke-width="1.5"></circle>
    <circle cx="40" cy="40" r="15" fill="#25282c" stroke="#3a3d42" stroke-width="1"></circle>
    <rect x="38.8" y="21.5" width="2.4" height="15" rx="1.2" fill="#f1eee6" transform="rotate(${n} 40 40)"></rect>
  </svg>`};function pi(e,t,n=fi){let r=q(`div`,`dial`),i=q(`div`,`dial-face`);i.tabIndex=0,i.setAttribute(`role`,`slider`),i.setAttribute(`aria-label`,`${t} ${e.label}`),i.setAttribute(`aria-orientation`,`vertical`),i.setAttribute(`aria-valuemin`,`0`),i.setAttribute(`aria-valuemax`,`100`);let a=q(`div`,`dial-label`,e.label),o=q(`div`,`dial-value`),s=()=>{let t=e.get();i.innerHTML=n(t,e.color),o.textContent=e.text(),i.setAttribute(`aria-valuenow`,String(Math.round(t*100))),i.setAttribute(`aria-valuetext`,o.textContent)},c=t=>{e.set(Math.min(1,Math.max(0,t))),s()},l;i.addEventListener(`pointerdown`,t=>{t.preventDefault(),i.focus(),i.setPointerCapture(t.pointerId),l={y:t.clientY,t:e.get()}}),i.addEventListener(`pointermove`,e=>{l&&c(l.t+(l.y-e.clientY)/(e.shiftKey?li:ci))});let u=()=>{l=void 0};return i.addEventListener(`pointerup`,u),i.addEventListener(`pointercancel`,u),i.addEventListener(`dblclick`,()=>{e.reset(),s()}),i.addEventListener(`keydown`,t=>{let n=(t.shiftKey?5:1)*(e.step??.02),r=e.get(),i={ArrowUp:r+n,ArrowRight:r+n,ArrowDown:r-n,ArrowLeft:r-n,Home:0,End:1};t.key in i&&(t.preventDefault(),c(i[t.key]))}),e.subscribe(s),s(),r.append(i,a,o),r}var mi=.04;function hi(e){let t=q(`div`,`wheel`);t.append(q(`div`,`wheel-label`,e.label));let n=q(`div`,`wheel-body`),r=q(`div`,`wheel-scale`);r.setAttribute(`aria-hidden`,`true`);for(let t of e.scale)r.append(q(`span`,void 0,t));let i=q(`button`,`wheel-face`);i.type=`button`,i.setAttribute(`role`,`slider`),i.setAttribute(`aria-label`,e.ariaLabel),i.setAttribute(`aria-orientation`,`vertical`),i.setAttribute(`aria-valuemin`,e.bipolar?`-1`:`0`),i.setAttribute(`aria-valuemax`,`1`),i.append(q(`span`,`wheel-ribs`)),e.bipolar&&i.append(q(`span`,`wheel-detent wheel-detent-left`),q(`span`,`wheel-detent wheel-detent-right`));let a=q(`div`,`wheel-marker`);a.setAttribute(`aria-hidden`,`true`);let o=q(`div`,`wheel-readout`),s=t=>e.bipolar?(t+1)/2:t,c=()=>{let t=e.get(),n=s(t);i.style.setProperty(`--rib`,`${Math.round(t*-60)}px`),a.style.top=`${Math.round((1-n)*102)}px`,o.textContent=e.format(t),i.setAttribute(`aria-valuenow`,String(t)),i.setAttribute(`aria-valuetext`,e.format(t))},l=t=>{let n=Math.min((e.bipolar,1),Math.max(e.bipolar?-1:0,t));e.set(e.bipolar&&Math.abs(n)<mi?0:n),c()},u=t=>{let n=i.getBoundingClientRect(),r=Math.min(1,Math.max(0,1-(t.clientY-n.top)/n.height));l(e.bipolar?r*2-1:r)},d=!1;i.addEventListener(`pointerdown`,e=>{i.setPointerCapture(e.pointerId),d=!0,u(e)}),i.addEventListener(`pointermove`,e=>{d&&u(e)});let f=()=>{d=!1,e.springBack&&l(0)};i.addEventListener(`pointerup`,f),i.addEventListener(`pointercancel`,f),i.addEventListener(`keydown`,t=>{let n=t.key===`ArrowUp`||t.key===`ArrowRight`?1:t.key===`ArrowDown`||t.key===`ArrowLeft`?-1:0;n&&(t.preventDefault(),l(e.get()+n*e.keyStep))}),i.addEventListener(`keyup`,()=>{e.springBack&&l(0)}),i.addEventListener(`dblclick`,()=>l(0)),e.subscribe(c),c();let p=q(`div`,`wheel-markers`);return p.append(a),n.append(r,i,p),t.append(n,o),t}var gi=36,_i=49,vi=[`a`,`w`,`s`,`e`,`d`,`f`,`t`,`g`,`y`,`h`,`u`,`j`,`k`],yi=24,bi=[`C`,`C#`,`D`,`D#`,`E`,`F`,`F#`,`G`,`G#`,`A`,`A#`,`B`],xi=[!0,!1,!0,!1,!0,!0,!1,!0,!1,!0,!1,!0],Si=xi.reduce((e,t,n)=>e+ +!!t,0)*4+1,Ci=100/Si*.6,wi=2,Ti,Ei=e=>`${bi[e%12]}${Math.floor(e/12)-1}`,Di=(e,t=2)=>{let n=Math.round(e*t*100)/100;return`${n>0?`+`:``}${n.toFixed(2)} st`};function Oi(e,t){let n=q(`div`,`keybed`);Ti??=n,document.addEventListener(`pointerdown`,e=>{n.parentElement?.contains(e.target)&&(Ti=n)},!0);let r=q(`div`,`keybed-cheek`),i=q(`div`,`keybed-wheels`);i.append(hi({label:`Bend`,ariaLabel:`Pitch bend`,bipolar:!0,scale:[`+${e.bendRange??2}`,`0`,`-${e.bendRange??2}`],springBack:!0,keyStep:.125,get:()=>e.pitchBend,set:t=>e.setPitchBend(t),subscribe:t=>e.onPerformanceChange(t),format:t=>Di(t,e.bendRange??2)}),hi({label:`Mod`,ariaLabel:`Modulation, LFO vibrato depth`,bipolar:!1,scale:[`100`,`0`],springBack:!1,keyStep:.1,get:()=>e.modWheel,set:t=>e.setModWheel(t),subscribe:t=>e.onPerformanceChange(t),format:e=>`${Math.round(e*100)} %`}));let a=0,o=q(`div`,`keybed-octave`),s=q(`button`,`btn btn-small`,`<`);s.type=`button`,s.setAttribute(`aria-label`,`Octave down`);let c=q(`button`,`btn btn-small`,`>`);c.type=`button`,c.setAttribute(`aria-label`,`Octave up`);let l=q(`span`,`keybed-octave-text`,`Oct 0`);o.append(s,l,c),r.append(i,o);let u=q(`div`,`keybed-keys`),d=q(`div`,`keybed-whites`);u.append(d);let f=[],p=new Map,m=0,h=t=>{if(p.has(t))return;let n=gi+t+a*12;p.set(t,n),e.keyDown(n)},g=t=>{let n=p.get(t);n!==void 0&&(p.delete(t),e.keyUp(n))};for(let e=0;e<_i;e++){let t=xi[e%12],n=q(`button`,t?`key-white`:`key-black`);n.type=`button`,n.setAttribute(`aria-label`,`Key ${Ei(gi+e)}`);let r=vi[e-yi];r&&(n.textContent=r),t?(d.append(n),m++):(n.style.left=`${Math.round((m/Si*100-Ci/2)*1e3)/1e3}%`,n.style.width=`${Ci}%`,u.append(n)),n.addEventListener(`pointerdown`,t=>{t.preventDefault(),h(e)});for(let t of[`pointerup`,`pointerleave`,`pointercancel`])n.addEventListener(t,()=>g(e));n.addEventListener(`keydown`,t=>{(t.key===` `||t.key===`Enter`)&&!t.repeat&&(t.preventDefault(),h(e))}),n.addEventListener(`keyup`,()=>g(e)),f.push(n)}let _=()=>{let t=new Set(e.heldNotes),n=new Set(p.values());f.forEach((e,r)=>{let i=p.has(r)||t.has(gi+r)&&!n.has(gi+r);e.classList.toggle(`on`,i),e.setAttribute(`aria-pressed`,String(i))})};e.onNoteChange(_);let v=()=>{l.textContent=`Oct ${a>0?`+`:``}${a}`,s.disabled=a<=-2,c.disabled=a>=wi,_()};return s.addEventListener(`click`,()=>{a=Math.max(-2,a-1),v()}),c.addEventListener(`click`,()=>{a=Math.min(wi,a+1),v()}),v(),window.addEventListener(`keydown`,e=>{if(Ti!==n||e.repeat||e.metaKey||e.ctrlKey||e.altKey||e.target instanceof HTMLSelectElement)return;let t=vi.indexOf(e.key.toLowerCase());t>=0&&h(yi+t)}),window.addEventListener(`keyup`,e=>{let t=vi.indexOf(e.key.toLowerCase());t>=0&&g(yi+t)}),n.append(t??r,u),n}var ki=`moa6.patches`,Ai=e=>zr(ki,e),ji=(e,t)=>Br(ki,e,t),Mi=`#d9628a`;function Ni(e,t={running:()=>e.running,position:()=>e.position}){let n=q(`div`,`transport`),r=q(`div`,`transport-tempo`);r.append(q(`div`,`fader-label`,`Tempo`));let i=q(`div`,`transport-bpm`,`120.0`),a=q(`div`,`transport-tempo-buttons`),o=q(`button`,`btn btn-small transport-tap`,`Tap`);o.type=`button`,o.addEventListener(`click`,()=>e.tap());let s=q(`button`,`btn btn-small`,`−`);s.type=`button`,s.setAttribute(`aria-label`,`Tempo down`),s.addEventListener(`click`,()=>e.nudge(-1));let c=q(`button`,`btn btn-small`,`+`);c.type=`button`,c.setAttribute(`aria-label`,`Tempo up`),c.addEventListener(`click`,()=>e.nudge(1)),a.append(o,s,c),r.append(i,a);let l=q(`div`,`transport-sync`);l.append(q(`div`,`fader-label`,`Sync`));let u=q(`div`,`transport-seg`),d={internal:`Internal`,midi:`MIDI clock`},f=e.sync.options.map(t=>{let n=q(`button`,`btn btn-small`,d[t]??t);return n.type=`button`,n.addEventListener(`click`,()=>e.sync.set(t)),u.append(n),n}),p=Pr(e.followStartStop,`Follow MIDI start and stop`,e=>`Start/stop: ${e?`On`:`Off`}`,Mi,`btn btn-small`);l.append(u),t.followStartStop!==!1&&l.append(p);let m=q(`div`,`transport-channel`);m.append(q(`div`,`fader-label`,`MIDI ch`));let h=q(`select`,`patch-select transport-channel-select`);h.setAttribute(`aria-label`,`MIDI channel`);for(let t of e.channel.options)h.add(new Option(t===`omni`?`Omni`:`Ch ${t}`,t));h.value=e.channel.value,h.addEventListener(`change`,()=>e.channel.set(h.value)),m.append(h);let g=q(`div`,`transport-pos`);g.append(q(`div`,`fader-label`,`Position`));let _=q(`div`,`transport-pos-row`),v=q(`span`,`led`),y=q(`div`,`transport-position`,`1 : 1 : 1`),b=[0,1,2,3].map(()=>q(`span`,`beat-dot`)),x=q(`div`,`beat-dots`);x.append(...b),_.append(v,y),g.append(_,x),n.append(r,l,m),t.position&&n.append(g);let S=()=>{let t=e.synced;f.forEach((t,n)=>{let r=e.sync.options[n]===e.sync.value;t.setAttribute(`aria-pressed`,String(r)),t.style.background=r?Mi:``,t.style.borderColor=r?Mi:``});for(let e of[o,s,c])e.disabled=t;p.disabled=!t,a.title=t?`Tempo follows MIDI clock`:``,n.classList.toggle(`is-synced`,t)};e.sync.onChange(S),S();let C=()=>{let n=t.running();i.textContent=e.bpm.toFixed(1),i.classList.toggle(`locked`,e.locked);let r=t.position?.();r&&(y.textContent=`${r.bar} : ${r.beat} : ${r.sixteenth}`,v.classList.toggle(`on`,n),b.forEach((e,t)=>e.classList.toggle(`on`,n&&r.beat===t+1))),requestAnimationFrame(C)};return requestAnimationFrame(C),n}var Pi=`#3a8fd6`,Fi=`#e8742c`,Ii=`#4a9be0`,Li=`#dcb43c`,Ri=`#4fb286`,zi=`#d9628a`,Bi=`#a98ae0`,Y={saw:`M1 9 L8 2 L8 9 L15 2 L15 9`,pulse:`M1 9 L1 2 L7 2 L7 9 L14 9 L14 2 L19 2`,tri:`M1 8 L5 2 L10 8 L15 2 L19 6`,down:`M1 2 L8 9 L8 2 L15 9 L15 2`,sqr:`M1 9 L1 2 L8 2 L8 9 L15 9 L15 2 L19 2`,rnd:`M1 6 L1 3 L5 3 L5 8 L9 8 L9 2 L13 2 L13 6 L18 6`,poly:`M1 8 L19 8 M1 5 L19 5 M1 2 L19 2`,mono:`M1 5 L19 5`,unison:`M1 4 L19 4 M1 6 L19 6`},Vi=[{value:`saw`,text:`Saw`,glyph:Y.saw,aria:`saw`},{value:`pulse`,text:`Pulse`,glyph:Y.pulse,aria:`pulse`},{value:`tri`,text:`Tri`,glyph:Y.tri,aria:`triangle`}],Hi=[{value:`tri`,text:`Tri`,glyph:Y.tri,aria:`triangle`},{value:`up`,text:`Up`,glyph:Y.saw,aria:`ramp up`},{value:`down`,text:`Down`,glyph:Y.down,aria:`ramp down`},{value:`sqr`,text:`Square`,glyph:Y.sqr,aria:`square`},{value:`rnd`,text:`Rand`,glyph:Y.rnd,aria:`random`}],Ui=[{value:`poly`,text:`Poly`,glyph:Y.poly,aria:`poly`},{value:`mono`,text:`Mono`,glyph:Y.mono,aria:`mono`},{value:`unison`,text:`Unison`,glyph:Y.unison,aria:`unison`}];function Wi(e,t){let n=e.control(t);if(n.kind!==`number`)throw Error(`${t} is not a number control`);return n}function Gi(e,t){let n=e.control(t);if(n.kind!==`choice`)throw Error(`${t} is not a choice control`);return n}function Ki(e,t){let n=e.control(t);if(n.kind!==`toggle`)throw Error(`${t} is not a toggle control`);return n}var qi=(e,t=20,n=10)=>`<svg aria-hidden="true" width="${t}" height="${n}" viewBox="0 0 20 10"><path d="${e}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"></path></svg>`;function Ji(e,t,n,r){let i=q(`div`,`poly-selector`),a=q(`div`,`poly-step-wrap`),o=q(`button`,`poly-key`);o.type=`button`,o.setAttribute(`aria-label`,n),o.innerHTML=`<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M3 6 L8 11 L13 6" fill="none" stroke="#1b1c1e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`,o.addEventListener(`click`,()=>e.set(r[(r.findIndex(t=>t.value===e.value)+1)%r.length].value)),a.append(o,q(`div`,`poly-mini-label`,t));let s=q(`div`,`poly-options`),c=r.map(n=>{let r=q(`button`,`poly-option`);return r.type=`button`,r.setAttribute(`aria-label`,`${t}: ${n.aria}`),r.innerHTML=`<span class="poly-led" aria-hidden="true"></span>${qi(n.glyph)}<span>${n.text}</span>`,r.addEventListener(`click`,()=>e.set(n.value)),s.append(r),r}),l=()=>{c.forEach((t,n)=>t.setAttribute(`aria-pressed`,String(r[n].value===e.value)))};return e.onChange(l),l(),i.append(a,s),i}function Yi(e){let t=q(`button`,`poly-sync`);t.type=`button`,t.setAttribute(`aria-label`,`LFO tempo sync`),t.innerHTML=`<span class="poly-led" aria-hidden="true"></span><span>Sync</span>`,t.addEventListener(`click`,()=>e.set(!e.value));let n=()=>t.setAttribute(`aria-pressed`,String(e.value));return e.onChange(n),n(),t}function Xi(e){let t=Wi(e,`lfo.rate`),n=Gi(e,`lfo.division`),r=Ki(e,`lfo.sync`),i=qn.length-1;return{label:`Rate`,color:Ri,get:()=>r.value?qn.indexOf(n.value)/i:Er(t)/K,set:e=>r.value?n.set(qn[Math.round(e*i)]):t.set(Dr(t,Math.round(e*K))),reset:()=>r.value?n.set(`1/8`):t.set(t.initial),text:()=>r.value?n.value:`${t.value.toFixed(1)} Hz`,subscribe:e=>{let i=[t.onChange(e),n.onChange(e),r.onChange(e)];return()=>i.forEach(e=>e())},get step(){return r.value?1/i:.02}}}var Zi=(e,t,n,r)=>r.map(r=>{let[i,a]=typeof r==`string`?[r,void 0]:r;return pi(di(Wi(e,i),t,a),n)});function Qi(e){let t=q(`div`,`poly-display`);t.append(q(`div`,`poly-display-title`,`EG1`));let n=`http://www.w3.org/2000/svg`,r=document.createElementNS(n,`svg`);r.setAttribute(`role`,`img`),r.setAttribute(`aria-label`,`Filter envelope curve`),r.setAttribute(`width`,`188`),r.setAttribute(`height`,`64`),r.setAttribute(`viewBox`,`0 0 188 64`);let i=document.createElementNS(n,`line`);for(let[e,t]of Object.entries({x1:`0`,y1:`56`,x2:`188`,y2:`56`,stroke:`#2c3036`,"stroke-width":`1`}))i.setAttribute(e,t);let a=document.createElementNS(n,`polyline`);for(let[e,t]of Object.entries({fill:`none`,stroke:`#8cc6f2`,"stroke-width":`1.6`,"stroke-linejoin":`round`,"stroke-linecap":`round`}))a.setAttribute(e,t);r.append(i,a);let o=q(`div`,`poly-display-text`);t.append(r,o);let s=[`attack`,`decay`,`sustain`,`release`].map(t=>Wi(e,`env1.${t}`)),c=()=>{let[e,t,n,r]=s.map(e=>Er(e)/K),i=6+e*46,c=i+t*52,l=c+30,u=l+r*46,d=56-n*46,f=e=>Math.round(e*10)/10;a.setAttribute(`points`,`6,56 ${f(i)},10 ${f(c)},${f(d)} ${f(l)},${f(d)} ${f(u)},56`);let p=e=>String(Math.round(e*99));o.textContent=`A ${p(e)}  D ${p(t)}  S ${p(n)}  R ${p(r)}`};for(let e of s)e.onChange(c);return c(),t}function $i(e,t){let n=q(`div`,`poly-voices`),r=q(`div`,`poly-voice-leds`);r.setAttribute(`role`,`img`),r.setAttribute(`aria-label`,`Voice activity`);let i=Array.from({length:6},()=>{let e=q(`span`,`poly-led poly-led-big`);return r.append(e),e});return n.append(r,q(`div`,`poly-mini-label`,`Voices`)),t.push(()=>{let t=0;i.forEach((n,r)=>{let i=e.voiceActive(r);n.classList.toggle(`on`,i),i&&t++}),r.setAttribute(`aria-label`,`Voice activity: ${t} of 6 voices sounding`)}),n}function ea(e){return[[{title:`Oscillator`,color:Fi,grow:5.2,body:e=>[Ji(Gi(e,`osc.wave`),`Wave`,`Step oscillator waveform`,Vi),...Zi(e,Fi,`Oscillator`,[`osc.width`,`osc.pwm`,`osc.vibrato`,`osc.sub`])]},{title:`Filter`,color:Ii,grow:5,body:e=>Zi(e,Ii,`Filter`,[`filter.cutoff`,`filter.resonance`,`filter.env`,`filter.lfo`,`filter.key`])},{title:`Amplifier`,color:zi,grow:3,body:e=>Zi(e,zi,`Amplifier`,[`amp.lfo`,`amp.key`,`level`])}],[{title:`LFO`,color:Ri,grow:3.6,body:e=>[Ji(Gi(e,`lfo.wave`),`Wave`,`Step LFO waveform`,Hi),pi(Xi(e),`LFO`),Yi(Ki(e,`lfo.sync`))]},{title:`Envelope generator 1`,color:Ii,grow:5.4,body:e=>[Qi(e),...Zi(e,Ii,`Envelope 1`,[`env1.attack`,`env1.decay`,`env1.sustain`,`env1.release`])]},{title:`Envelope generator 2`,color:zi,grow:4,body:e=>Zi(e,zi,`Envelope 2`,[`env2.attack`,`env2.decay`,`env2.sustain`,`env2.release`])}],[{title:`Voices mode`,color:Li,grow:5,body:t=>[Ji(Gi(t,`voices.mode`),`Mode`,`Step voice mode`,Ui),...Zi(t,Li,`Voices`,[`voices.portamento`,`voices.detune`]),$i(t,e)]},{title:`Effects`,color:Bi,grow:4.4,body:e=>Zi(e,Bi,`Effects`,[`fx.chorus`,`fx.delayTime`,`fx.feedback`,`fx.mix`])}]]}var ta=[`A`,`B`],na=8;function ra(e,t){let n=q(`section`,`poly-patch`),r=q(`div`,`poly-section-head`),i=q(`span`,`poly-bar`);i.style.background=Pi,r.append(i,q(`h2`,void 0,`Patch`));let a=q(`div`,`poly-patch-display`);a.setAttribute(`role`,`status`),a.setAttribute(`aria-label`,`Current patch`);let o=q(`span`,`poly-patch-name`),s=q(`span`,`poly-patch-tag`);a.append(o,s);let c=Math.floor(e.currentSlot/na),l=!1,u=q(`div`,`poly-preset-keys`),d=[];for(let t=0;t<na;t++){let n=q(`div`,`poly-preset`),r=q(`span`,`poly-led`),i=q(`button`,`poly-key poly-key-number`,String(t+1));i.type=`button`,i.addEventListener(`click`,()=>e.loadSlot(c*na+t)),n.append(r,i),u.append(n),d.push({led:r,button:i})}let f=()=>{let t=e.currentSlot;o.textContent=`${String(t%na+1).padStart(2,`0`)} ${e.currentPreset.name}`,s.textContent=l?`Saved`:`Bank ${ta[Math.floor(t/na)]}`,d.forEach(({led:n,button:r},i)=>{let a=c*na+i===t,o=e.slots[c*na+i];n.classList.toggle(`on`,a),r.setAttribute(`aria-pressed`,String(a)),r.setAttribute(`aria-label`,`Preset ${i+1}, ${o.name}`),r.title=o.name})},p=(e,t)=>{let n=q(`button`,`poly-key poly-key-bank`,t);return n.type=`button`,n.setAttribute(`aria-label`,e),n.addEventListener(`click`,()=>{c=(c+1)%ta.length,f()}),n},m=q(`div`,`poly-bank-keys`);m.append(p(`Previous bank`,`<`),p(`Next bank`,`>`));let h=q(`button`,`poly-key poly-save`,`Save`);h.type=`button`,h.setAttribute(`aria-label`,`Save patch`),h.addEventListener(`click`,()=>{ji(e.currentSlot,e.saveSlot(e.currentSlot)),l=!0,f(),window.setTimeout(()=>{l=!1,f()},1500)});let g=q(`div`,`poly-midi`),_=q(`span`,`poly-led`);_.style.setProperty(`--glow`,`1`),g.append(q(`span`,void 0,`MIDI`),_);let v=0;return e.onNoteChange(()=>{v=performance.now()}),t.push(()=>_.classList.toggle(`on`,performance.now()-v<150)),e.onPresetChange(()=>{c=Math.floor(e.currentSlot/na),f()}),f(),n.append(r,a,m,u,h,q(`div`,`poly-spacer`),g),n}function ia(e){Ai(e),e.loadSlot(e.currentSlot);let t=q(`div`,`poly-panel`),n=q(`div`,`poly-header`),r=q(`div`,`synth-brand`);r.append(q(`div`,`synth-name`,`MOA-6`),q(`div`,`synth-subtitle`,`Poly Synthesizer`)),n.append(r,Ni(e.transport,{running:()=>!1,followStartStop:!1})),t.append(n);let i=[];for(let n of ea(i)){let r=q(`div`,`poly-row`);for(let t of n){let n=q(`section`,`poly-section`);n.style.flex=`${t.grow} 1 0`;let i=q(`div`,`poly-section-head`),a=q(`span`,`poly-bar`);a.style.background=t.color,i.append(a,q(`h2`,void 0,t.title));let o=q(`div`,`poly-section-body`);o.append(...t.body(e)),n.append(i,o),r.append(n)}t.append(r)}t.append(ra(e,i),Oi(e));let a=()=>{for(let e of i)e();requestAnimationFrame(a)};return requestAnimationFrame(a),t}var X=`#c45bd6`,aa=`#a8d83a`,oa=`#4fc3d4`,sa=`#d9d4c7`,ca=`moa-fx1.patches`,la=1440,ua=760;function da(e,t){let n=parseInt(e.slice(1),16),r=e=>Math.round(e+(255-e)*t);return`#${[n>>16&255,n>>8&255,n&255].map(e=>r(e).toString(16).padStart(2,`0`)).join(``)}`}var fa=da(X,.3),pa=da(aa,.3),ma=(e,t)=>{let n=e.control(t);if(n.kind!==`number`)throw Error(`${t} is not a number control`);return n},ha=(e,t)=>{let n=e.control(t);if(n.kind!==`choice`)throw Error(`${t} is not a choice control`);return n},ga=(e,t)=>{let n=e.control(t);if(n.kind!==`toggle`)throw Error(`${t} is not a toggle control`);return n};function _a(e,t,n,r=t){return{label:t,aria:r,get:()=>Er(e)/K,set:t=>e.set(Dr(e,Math.round(Math.min(1,Math.max(0,t))*K))),reset:()=>e.set(e.initial),text:()=>n(e.value),subscribe:t=>e.onChange(t)}}var va=e=>`${Math.round(e*100)} %`,ya=e=>`${e>0?`+`:``}${Math.round(e*100)} %`,ba=e=>e<=0?`-inf dB`:`${(20*Math.log10(e)).toFixed(1)} dB`,xa=e=>e>=1e3?`${(e/1e3).toFixed(2)} s`:`${Math.round(e)} ms`,Sa=e=>e>=1e3?`${(e/1e3).toFixed(1)} kHz`:`${Math.round(e)} Hz`;function Ca(e,t,n){e.style.left=`${t}px`,e.style.top=`${n}px`}function wa(e,t,n,r){let i=r.px??72,a=r.cw??80,o=q(`div`,`ouro-knob`);o.style.width=`${a}px`,Ca(o,t-a/2,n-i/2);let s=q(`div`,`ouro-knob-face`);s.style.width=`${i}px`,s.style.height=`${i}px`,s.tabIndex=0,s.setAttribute(`role`,`slider`),s.setAttribute(`aria-label`,e.aria),s.setAttribute(`aria-orientation`,`vertical`),s.setAttribute(`aria-valuemin`,`0`),s.setAttribute(`aria-valuemax`,`100`);let c=q(`div`,`ouro-label`);if(r.parts){let[e,t,n,i]=r.parts,a=q(`span`,void 0,e);a.style.color=t;let o=q(`span`,void 0,n);o.style.color=i,c.append(a,o)}else c.textContent=e.label;let l=q(`div`,`ouro-value`),u=()=>{let t=e.get(),n=-135+t*270,a,o;if(!r.bipolar)a=`M20.2 59.8 A28 28 0 1 1 59.8 59.8`,o=`${(t*131.95).toFixed(1)} 200`;else{let e=n*Math.PI/180;a=Math.abs(t-.5)<.012?`M40 12 L40 12`:`M40 12 A28 28 0 0 ${+(n>0)} ${(40+28*Math.sin(e)).toFixed(2)} ${(40-28*Math.cos(e)).toFixed(2)}`,o=`200 200`}s.innerHTML=`<svg aria-hidden="true" width="${i}" height="${i}" viewBox="0 0 80 80">
      <path d="M16.34 64.42 A34 34 0 1 1 63.66 64.42" fill="none" stroke="#cfcac0" stroke-opacity="0.6" stroke-width="3" stroke-dasharray="1.2 14.8"></path>
      <path d="M20.2 59.8 A28 28 0 1 1 59.8 59.8" fill="none" stroke="#26282c" stroke-width="3"></path>
      <path d="${a}" fill="none" stroke="${r.color}" stroke-width="3" stroke-dasharray="${o}"></path>
      <circle cx="40" cy="40" r="25" fill="#060607" stroke="#2c2e33" stroke-width="1.5"></circle>
      <circle cx="40" cy="40" r="16" fill="#d9c3c9" stroke="#8f7a80" stroke-width="1"></circle>
      <path d="M30 36 A11 11 0 0 1 38 29.5" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="2" stroke-linecap="round"></path>
      <rect x="38.7" y="15" width="2.6" height="10" rx="1.2" fill="${r.pointer??r.color}" transform="rotate(${n.toFixed(1)} 40 40)"></rect>
    </svg>`,l.textContent=e.text(),s.setAttribute(`aria-valuenow`,String(Math.round(t*100))),s.setAttribute(`aria-valuetext`,l.textContent)},d=t=>{e.set(Math.min(1,Math.max(0,t))),u()},f;s.addEventListener(`pointerdown`,t=>{t.preventDefault(),s.focus(),s.setPointerCapture(t.pointerId);let n=s.getBoundingClientRect().width/i||1;f={y:t.clientY,t:e.get(),scale:n}}),s.addEventListener(`pointermove`,e=>{f&&d(f.t+(f.y-e.clientY)/f.scale/(e.shiftKey?600:160))});let p=()=>{f=void 0};return s.addEventListener(`pointerup`,p),s.addEventListener(`pointercancel`,p),s.addEventListener(`dblclick`,()=>{e.reset(),u()}),s.addEventListener(`keydown`,t=>{let n=t.shiftKey?.1:.02,r=e.get(),i={ArrowUp:r+n,ArrowRight:r+n,ArrowDown:r-n,ArrowLeft:r-n,Home:0,End:1};t.key in i&&(t.preventDefault(),d(i[t.key]))}),e.subscribe(u),u(),o.append(s,c,l),o}function Ta(e,t,n,r,i,a){let o=q(`div`,`ouro-fader`);Ca(o,t-28,n);let s=r-20,c=q(`div`,`ouro-fader-face`);c.style.height=`${r}px`,c.tabIndex=0,c.setAttribute(`role`,`slider`),c.setAttribute(`aria-label`,e.aria),c.setAttribute(`aria-orientation`,`vertical`),c.setAttribute(`aria-valuemin`,`0`),c.setAttribute(`aria-valuemax`,`100`);let l=q(`div`,`ouro-label`),u=q(`div`,`ouro-value`),d=[0,1,2,3,4].map(e=>`M12 ${10+e*s/4} H20 M36 ${10+e*s/4} H44`).join(` `),f=()=>{let t=e.get();c.innerHTML=`<svg aria-hidden="true" width="56" height="${r}" viewBox="0 0 56 ${r}" style="position:absolute;left:0;top:0">
        <path d="${d}" fill="none" stroke="#cfcac0" stroke-opacity="0.6" stroke-width="1.2"></path></svg>
      <div aria-hidden="true" style="position:absolute;left:25px;top:0;bottom:0;width:6px;box-sizing:border-box;border-radius:3px;background:#060607;border:1px solid #3a3d42"></div>
      <div aria-hidden="true" style="position:absolute;left:26px;bottom:0;width:4px;height:${Math.round(t*s+10)}px;border-radius:2px;background:${i}"></div>
      <div aria-hidden="true" style="position:absolute;left:8px;top:${Math.round((1-t)*s)}px;width:40px;height:20px;box-sizing:border-box;border-radius:3px;background:#d9c3c9;border:1px solid #8f7a80">
        <div style="position:absolute;left:4px;right:4px;top:8px;height:2px;background:#1b1c1e"></div></div>`,l.textContent=a(),u.textContent=e.text(),c.setAttribute(`aria-valuenow`,String(Math.round(t*100))),c.setAttribute(`aria-valuetext`,u.textContent)},p=t=>{e.set(Math.min(1,Math.max(0,t))),f()},m;c.addEventListener(`pointerdown`,t=>{t.preventDefault(),c.focus(),c.setPointerCapture(t.pointerId),m={y:t.clientY,t:e.get(),scale:c.getBoundingClientRect().height/r||1}}),c.addEventListener(`pointermove`,e=>{m&&p(m.t+(m.y-e.clientY)/m.scale/(e.shiftKey?s*3.75:s))});let h=()=>{m=void 0};return c.addEventListener(`pointerup`,h),c.addEventListener(`pointercancel`,h),c.addEventListener(`dblclick`,()=>{e.reset(),f()}),c.addEventListener(`keydown`,t=>{let n=t.key===`ArrowUp`||t.key===`ArrowRight`?1:t.key===`ArrowDown`||t.key===`ArrowLeft`?-1:0;n&&(t.preventDefault(),p(e.get()+n*.02))}),e.subscribe(f),f(),o.append(c,l,u),o}function Ea(e,t,n,r,i,a,o,s){let c=q(`div`,`ouro-toggle`);Ca(c,t-30,n-38);let l=q(`div`,`ouro-toggle-text`,r),u=q(`div`,`ouro-toggle-text`,i),d=q(`button`);d.type=`button`,d.setAttribute(`role`,`switch`);let f=()=>{let e=a(),t=e?6:38;d.innerHTML=`<svg aria-hidden="true" width="40" height="44" viewBox="0 0 40 44" style="display:block">
      <circle cx="20" cy="22" r="10" fill="#1b1c1e" stroke="#6b6f75" stroke-width="1.5"></circle>
      <line x1="20" y1="22" x2="20" y2="${t}" stroke="#b8a9ae" stroke-width="4" stroke-linecap="round"></line>
      <circle cx="20" cy="${t}" r="4.5" fill="#d9c3c9" stroke="#8f7a80" stroke-width="1"></circle></svg>`,d.setAttribute(`aria-checked`,String(e)),d.setAttribute(`aria-label`,s(e)),l.style.color=e?`#f1eee6`:`#8d9198`,u.style.color=e?`#8d9198`:`#f1eee6`};return d.addEventListener(`click`,()=>{o(!a()),f()}),e.onChange(f),f(),c.append(l,d,u),c}function Da(e,t,n,r,i,a,o){let s=q(`div`,`ouro-selector`);return Ca(s,i,a),s.style.setProperty(`--ow`,`${o}px`),s.append(Ji(e,t,n,r)),s}var Oa={series:`M1 5 L19 5`,parallel:`M1 2 L19 2 M1 8 L19 8`,pingpong:`M2 3 H18 M15 1 L18 3 L15 5 M18 8 H2 M5 6 L2 8 L5 10`,tri:`M1 8 L5 2 L10 8 L15 2 L19 6`,ramp:`M1 9 L8 2 L8 9 L15 2 L15 9`,sqr:`M1 9 L1 2 L8 2 L8 9 L15 9 L15 2 L19 2`,rnd:`M1 6 L1 3 L5 3 L5 8 L9 8 L9 2 L13 2 L13 6 L18 6`},ka=[{value:`series`,text:`Series`,glyph:Oa.series,aria:`series`},{value:`parallel`,text:`Parallel`,glyph:Oa.parallel,aria:`parallel`},{value:`pingpong`,text:`Ping-pong`,glyph:Oa.pingpong,aria:`ping-pong`}],Aa=[{value:`tri`,text:`Tri`,glyph:Oa.tri,aria:`triangle`},{value:`ramp`,text:`Ramp`,glyph:Oa.ramp,aria:`ramp`},{value:`sqr`,text:`Square`,glyph:Oa.sqr,aria:`square`},{value:`rnd`,text:`Random`,glyph:Oa.rnd,aria:`random`}],ja=`<svg aria-hidden="true" width="${la}" height="754" viewBox="0 0 ${la} 754" style="position:absolute;left:0;top:0">
<g fill="none" stroke="#cfcac0" stroke-opacity="0.55" stroke-width="1.2">
<rect x="36" y="56" width="464" height="376" rx="12"></rect><rect x="940" y="56" width="464" height="376" rx="12"></rect>
<rect x="36" y="448" width="364" height="228" rx="12"></rect><rect x="420" y="448" width="984" height="228" rx="12"></rect></g>
<g fill="none" stroke="#cfcac0" stroke-opacity="0.85" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
<path d="M36 186 H60 M140 186 H174 M254 186 H288 M368 186 H402"></path><path d="M442 252 V310"></path>
<path d="M402 346 H358 M298 346 H254 M174 346 H140 M60 346 H36"></path>
<path d="M1404 186 H1380 M1300 186 H1266 M1186 186 H1152 M1072 186 H1038"></path><path d="M998 252 V310"></path>
<path d="M1038 346 H1082 M1142 346 H1186 M1266 346 H1300 M1380 346 H1404"></path>
<path d="M140 520 H178 M258 520 H296"></path><path d="M704 581 V548"></path><path d="M888 548 H904 M1074 550 H1088"></path>
<path d="M100 466 V483 M336 484 V467"></path>
<circle cx="704" cy="590" r="9"></circle><circle cx="1326" cy="468" r="9"></circle><circle cx="1368" cy="468" r="9"></circle>
<circle cx="500" cy="140" r="4" fill="#111214"></circle><circle cx="500" cy="400" r="4" fill="#111214"></circle>
<circle cx="940" cy="140" r="4" fill="#111214"></circle><circle cx="940" cy="400" r="4" fill="#111214"></circle></g>
<g fill="#cfcac0" fill-opacity="0.9" stroke="none">
<polygon points="60,186 52,182 52,190"></polygon><polygon points="174,186 166,182 166,190"></polygon><polygon points="288,186 280,182 280,190"></polygon>
<polygon points="402,186 394,182 394,190"></polygon><polygon points="442,310 438,302 446,302"></polygon>
<polygon points="358,346 366,342 366,350"></polygon><polygon points="254,346 262,342 262,350"></polygon><polygon points="140,346 148,342 148,350"></polygon>
<polygon points="36,346 44,342 44,350"></polygon><polygon points="1380,186 1388,182 1388,190"></polygon><polygon points="1266,186 1274,182 1274,190"></polygon>
<polygon points="1152,186 1160,182 1160,190"></polygon><polygon points="1038,186 1046,182 1046,190"></polygon><polygon points="998,310 994,302 1002,302"></polygon>
<polygon points="1082,346 1074,342 1074,350"></polygon><polygon points="1186,346 1178,342 1178,350"></polygon><polygon points="1300,346 1292,342 1292,350"></polygon>
<polygon points="1404,346 1396,342 1396,350"></polygon><polygon points="178,520 170,516 170,524"></polygon><polygon points="296,520 288,516 288,524"></polygon>
<polygon points="704,548 700,556 708,556"></polygon><polygon points="904,548 896,544 896,552"></polygon><polygon points="1088,550 1080,546 1080,554"></polygon>
<polygon points="100,484 96,476 104,476"></polygon><polygon points="336,466 332,474 340,474"></polygon></g>
<g font-family="'IBM Plex Mono', ui-monospace, monospace" font-size="11" fill="#a9adb3">
<text x="40" y="176">IN</text><text x="40" y="336">OUT</text><text x="1400" y="176" text-anchor="end">IN</text><text x="1400" y="336" text-anchor="end">OUT</text>
<text x="704" y="614" text-anchor="middle">GATE IN</text><text x="1306" y="472" text-anchor="end">MOD OUT</text>
<text x="1326" y="472" text-anchor="middle" fill="#e8e4da">+</text><text x="1368" y="472" text-anchor="middle" fill="#e8e4da">-</text></g></svg>`,Ma={aa:{d:`M504 140 H560 V400 H504`,color:X},bb:{d:`M936 140 H880 V400 H936`,color:aa},ab:{d:`M560 160 L880 380`,color:X},ba:{d:`M880 160 L560 380`,color:aa}};function Na(e,t){let n=`http://www.w3.org/2000/svg`,r=document.createElementNS(n,`svg`);for(let[e,t]of Object.entries({"aria-hidden":`true`,width:String(la),height:`754`,viewBox:`0 0 ${la} 754`}))r.setAttribute(e,t);r.style.cssText=`position:absolute;left:0;top:0;pointer-events:none`;let i=new Map,a=new Map,o=document.createElementNS(n,`g`);o.setAttribute(`fill`,`none`),o.setAttribute(`stroke-linecap`,`round`),o.setAttribute(`stroke-linejoin`,`round`);let s=document.createElementNS(n,`g`),c={aa:`504,400 512,396 512,404`,bb:`936,400 928,396 928,404`,ab:`878,378.6 868.3,376.8 872.9,370.2`,ba:`562,378.6 571.7,376.8 567.1,370.2`};for(let e of[`aa`,`bb`,`ab`,`ba`]){let t=document.createElementNS(n,`path`);t.setAttribute(`d`,Ma[e].d),t.setAttribute(`stroke`,Ma[e].color),o.append(t),i.set(e,t);let r=document.createElementNS(n,`polygon`);r.setAttribute(`points`,c[e]),r.setAttribute(`fill`,Ma[e].color),s.append(r),a.set(e,r)}for(let[e,t,r]of[[560,160,X],[880,160,aa]]){let i=document.createElementNS(n,`circle`);for(let[n,a]of Object.entries({cx:String(e),cy:String(t),r:`3`,fill:r}))i.setAttribute(n,a);s.append(i)}r.append(o,s);let l=q(`div`);l.style.cssText=`margin-top:4px;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11px`;let u=``;return t.push(()=>{let t=`${[`AA`,`BB`,`AB`,`BA`].map(t=>e.circuit.node(`fb${t}`).params.gain).join()}${ga(e,`ouro.kill`).value}${ga(e,`ouro.freeze`).value}`;if(t===u)return;u=t;for(let t of[`aa`,`bb`,`ab`,`ba`]){let n=Math.min(1.2,e.circuit.node(`fb${t.toUpperCase()}`).params.gain),r=i.get(t);r.setAttribute(`stroke-width`,(1.2+n*3.6).toFixed(2)),r.setAttribute(`stroke-opacity`,(.3+Math.min(1,n)*.7).toFixed(2)),r.style.filter=`drop-shadow(0 0 ${(n*7).toFixed(1)}px ${Ma[t].color})`,a.get(t).setAttribute(`fill-opacity`,(.3+Math.min(1,n)*.7).toFixed(2))}let n=ga(e,`ouro.kill`).value,r=ga(e,`ouro.freeze`).value;l.textContent=n?`KILLED  0 %`:r?`FROZEN  100 %`:`LOOP OPEN`,l.style.color=n?`#f08a84`:r?`#8fd8f2`:`#a9adb3`}),{svg:r,status:l}}function Pa(e){let t=ha(e,`ouro.mod.mode`).value,n=ha(e,`ouro.mod.wave`).value,r=ma(e,`ouro.mod.rate`),i=Er(r)/K,a=6+22*ma(e,`ouro.mod.depth`).value,o=t===`lfo`?1+Math.round(i*5):2,s=e=>{let t=Math.sin(e*12.9898+4.1)*43758.5453;return(t-Math.floor(t))*2-1},c=[];for(let e=0;e<=84;e++){let r=e/84*o,l=r-Math.floor(r),u;u=t===`env`?2*Math.exp(-(12-i*10)*l)-1:n===`tri`?1-4*Math.abs(l-.5):n===`ramp`?2*l-1:n===`sqr`?l<.5?1:-1:s(Math.floor(r*2)),c.push(`${(e/84*168).toFixed(1)},${(32-u*a).toFixed(1)}`)}let l=t===`lfo`?`${r.value>=10?r.value.toFixed(0):r.value.toFixed(1)} Hz`:`${Sa(r.value)}`;return{points:c.join(` `),text:t===`lfo`?`LFO ${n.toUpperCase()}  ${l}`:`ENV FOLLOW  ${l}`}}function Fa(e,t,n){zr(ca,e),e.loadSlot(e.currentSlot);let r=q(`div`,`ouro-wrap`),i=q(`div`,`ouro-panel`),a=[];r.append(i),i.insertAdjacentHTML(`beforeend`,ja);let o=Na(e,a);i.append(o.svg);let s=q(`div`,`ouro-abs`);s.style.cssText=`left:36px;top:8px;display:flex;align-items:baseline;gap:16px`;let c=q(`div`,void 0,`OUROBOROS`);c.style.cssText=`font-size:38px;font-weight:700;letter-spacing:.1em;line-height:1`;let l=q(`div`,void 0,`Dual Feedback Delay`);l.style.cssText=`font-size:14px;font-weight:500;letter-spacing:.32em;color:#a9adb3;text-transform:uppercase`,s.append(c,l);let u=q(`div`,`ouro-abs`);u.style.cssText=`right:36px;top:16px;display:flex;align-items:center;gap:10px;font-size:13px;letter-spacing:.2em;color:#a9adb3;text-transform:uppercase`;let d=q(`span`);d.style.cssText=`width:10px;height:10px;border-radius:50%;background:${X};box-shadow:0 0 10px ${X}`,u.append(q(`span`,void 0,`MOA-FX1`),d),i.append(s,u);let f=[{side:`a`,letter:`A`,box:52,titleLeft:124,align:`left`,color:X,text:fa},{side:`b`,letter:`B`,box:1328,titleLeft:1016,align:`right`,color:aa,text:pa}];for(let t of f){let n=q(`div`,`ouro-abs`,t.letter);n.style.cssText=`left:${t.box}px;top:70px;width:60px;height:52px;box-sizing:border-box;border:2px solid ${t.color};border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:700;line-height:1;color:${t.text}`;let r=q(`div`,`ouro-abs`);r.style.cssText=`left:${t.titleLeft}px;top:74px;width:300px;text-align:${t.align}`;let a=q(`h2`,void 0,`Channel ${t.letter}`);a.style.cssText=`margin:0;font-size:22px;font-weight:600;letter-spacing:.22em;text-transform:uppercase`;let o=q(`div`,void 0,`Gain > Delay > Grit > Filter > Clip`);o.style.cssText=`margin-top:4px;font-size:12px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:#a9adb3`,r.append(a,o),i.append(n,r);let s=ga(e,`ouro.${t.side}.on`),c=()=>{n.style.borderColor=s.value?t.color:`#5a5e64`,n.style.color=s.value?t.text:`#8d9198`};s.onChange(c),c()}let p=q(`div`,`ouro-abs`);p.style.cssText=`left:620px;top:66px;width:200px;text-align:center`;let m=q(`h2`,void 0,`Feedback`);m.style.cssText=`margin:0;font-size:20px;font-weight:600;letter-spacing:.3em;text-transform:uppercase`,p.append(m,o.status),i.append(p);for(let[e,t]of[[`left:160px;top:458px;font-size:14px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap`,`Input / Routing`],[`left:436px;top:458px;font-size:15px;font-weight:600;letter-spacing:.22em;text-transform:uppercase`,`Modulator`]]){let n=q(`div`,`ouro-abs`,t);n.style.cssText+=e,i.append(n)}let h=(e,t,n,r,i)=>{let a=q(`div`,`ouro-abs`,i);return a.style.cssText=`left:${e}px;top:446px;width:${t}px;height:20px;box-sizing:border-box;z-index:1;background:#111214;border:1px solid ${X};border-radius:10px;color:${fa};font-size:${n}px;font-weight:600;letter-spacing:${r};line-height:18px;text-align:center;white-space:nowrap`,a};i.append(h(56,88,12,`.1em`,`IN: BUS C`),h(274,124,11,`.08em`,`OUT: FX 3 RETURN`)),i.append(wa(_a(ma(e,`ouro.input`),`Input`,ba),100,520,{color:sa}),wa(_a(ma(e,`ouro.mix`),`Dry/Wet`,va),218,520,{color:sa}),wa(_a(ma(e,`ouro.output`),`Output`,ba),336,520,{color:sa}));for(let t of f){let n=e=>t.side===`b`?la-e:e,r=e=>`ouro.${t.side}.${e}`,a=e=>`Channel ${t.letter} ${e}`,o=(i,o,s,c,l)=>wa(_a(ma(e,r(i)),o,s,a(o)),n(c),l,{color:t.color});i.append(o(`gain`,`Gain`,e=>`${e>=1?`+`:``}${ba(e)}`,100,186),o(`delay`,`Delay`,xa,214,186),o(`grit`,`Grit`,e=>`${Math.round(16-e*13)} bit`,328,186),o(`cutoff`,`Cutoff`,Sa,442,186),o(`resonance`,`Resonance`,e=>e.toFixed(1),442,346),o(`clip`,`Clip`,va,214,346),o(`level`,`Level`,va,100,346));let s=ha(e,r(`filter`));i.append(Ea(s,n(328),346,`HP`,`LP`,()=>s.value===`hp`,e=>s.set(e?`hp`:`lp`),e=>`Channel ${t.letter} filter: ${e?`high-pass`:`low-pass`}`));let c=ga(e,r(`on`));i.append(Ea(c,t.side===`a`?460:980,100,`ON`,`OFF`,()=>c.value,e=>c.set(e),e=>`Channel ${t.letter} ${e?`on`:`off`}`))}let g=(t,n,r)=>{let i=t[0].toUpperCase(),a=t[1].toUpperCase(),o=e=>e===`A`?X:aa,s=e=>e===`A`?fa:pa;return wa(_a(ma(e,`ouro.fb.${t}`),`${i}>${a}`,va,`Feedback ${i} to ${a}`),n,r,{color:o(i),parts:[`${i}>`,s(i),a,s(a)]})};i.append(g(`aa`,560,270),g(`bb`,880,270),g(`ab`,656,233),g(`ba`,784,233));let _=ha(e,`ouro.mod.mode`),v=_a(ma(e,`ouro.mod.rate`),`Rate`,e=>_.value===`lfo`?`${e>=10?e.toFixed(0):e.toFixed(1)} Hz`:Sa(e),`Modulator rate`),y=v.subscribe;v.subscribe=e=>{let t=[y(e),_.onChange(e)];return()=>t.forEach(e=>e())},i.append(Ta(v,550,490,100,oa,()=>_.value===`lfo`?`Rate`:`Speed`),Ta(_a(ma(e,`ouro.mod.depth`),`Depth`,va,`Modulator depth`),620,490,100,oa,()=>`Depth`),Ea(_,471,540,`LFO`,`ENV`,()=>_.value===`lfo`,e=>_.set(e?`lfo`:`env`),e=>`Modulator mode: ${e?`LFO`:`envelope follower`}`),Da(ha(e,`ouro.mod.wave`),`Wave`,`Step modulator wave`,Aa,756,500,80)),[[`dlyA`,`To Delay A`,X,1138],[`cutA`,`To Cutoff A`,X,1236],[`gainA`,`To Gain A`,X,1334],[`dlyB`,`To Delay B`,aa,1138],[`cutB`,`To Cutoff B`,aa,1236],[`gainB`,`To Gain B`,aa,1334]].forEach(([t,n,r,a],o)=>{i.append(wa(_a(ma(e,`ouro.mod.${t}`),n,ya),a,o<3?520:606,{color:r,px:52,cw:96,bipolar:!0}))});let b=ga(e,`ouro.mod.trigger`),x=q(`div`,`ouro-abs`);x.style.cssText=`left:664px;top:500px;z-index:1;background:#111214`;let S=q(`button`,`ouro-key`,`Trigger`);S.type=`button`,S.style.cssText=`width:80px;font-size:14px;letter-spacing:.14em`,S.setAttribute(`aria-label`,`Trigger envelope`);let C=()=>{b.set(!0),S.setAttribute(`aria-pressed`,`true`),S.style.background=oa},w=()=>{b.set(!1),S.setAttribute(`aria-pressed`,`false`),S.style.background=``};S.addEventListener(`pointerdown`,C);for(let e of[`pointerup`,`pointerleave`,`pointercancel`])S.addEventListener(e,w);S.addEventListener(`keydown`,e=>{(e.key===` `||e.key===`Enter`)&&!e.repeat&&(e.preventDefault(),C())}),S.addEventListener(`keyup`,w),x.append(S),i.append(x);let T=q(`div`,`ouro-display`);T.style.cssText=`left:904px;top:500px;width:170px`,T.append(q(`div`,`ouro-display-title`,`MOD`));let E=`http://www.w3.org/2000/svg`,ee=document.createElementNS(E,`svg`);for(let[e,t]of Object.entries({role:`img`,"aria-label":`Modulator waveform`,width:`168`,height:`64`,viewBox:`0 0 168 64`}))ee.setAttribute(e,t);let D=document.createElementNS(E,`line`);for(let[e,t]of Object.entries({x1:`0`,y1:`32`,x2:`168`,y2:`32`,stroke:`#2c3036`,"stroke-width":`1`}))D.setAttribute(e,t);let O=document.createElementNS(E,`polyline`);for(let[e,t]of Object.entries({fill:`none`,stroke:fa,"stroke-width":`1.6`,"stroke-linejoin":`round`,"stroke-linecap":`round`}))O.setAttribute(e,t);ee.append(D,O);let te=q(`div`,`ouro-display-text`);T.append(ee,te),i.append(T);let ne=()=>{let t=Pa(e);O.setAttribute(`points`,t.points),te.textContent=t.text};for(let t of[`ouro.mod.mode`,`ouro.mod.wave`,`ouro.mod.rate`,`ouro.mod.depth`])e.control(t).onChange(ne);ne(),i.append(Da(ha(e,`ouro.routing`),`Routing`,`Step routing`,ka,52,598,106));let re=q(`div`,`ouro-abs`);re.style.cssText=`left:222px;top:600px;display:flex;gap:8px;z-index:1`;let k=ga(e,`ouro.kill`),A=q(`button`,`ouro-key`);A.type=`button`,A.style.cssText=`width:80px;font-size:16px;letter-spacing:.16em`,A.setAttribute(`aria-label`,`Kill: hold to cut all feedback`);let ie=q(`span`,`ouro-led`);A.append(ie,q(`span`,void 0,`Kill`));let ae=()=>{A.setAttribute(`aria-pressed`,String(k.value)),A.style.background=k.value?`#e0524a`:``,ie.style.background=k.value?`#1a0707`:``};k.onChange(ae);let oe=()=>k.set(!0),se=()=>k.set(!1);A.addEventListener(`pointerdown`,oe);for(let e of[`pointerup`,`pointerleave`,`pointercancel`])A.addEventListener(e,se);A.addEventListener(`keydown`,e=>{(e.key===` `||e.key===`Enter`)&&!e.repeat&&(e.preventDefault(),oe())}),A.addEventListener(`keyup`,se),ae();let j=ga(e,`ouro.freeze`),M=q(`button`,`ouro-key`);M.type=`button`,M.style.cssText=`width:80px;font-size:16px;letter-spacing:.12em`,M.setAttribute(`aria-label`,`Freeze: latch feedback at 100 percent`);let N=q(`span`,`ouro-led`);M.append(N,q(`span`,void 0,`Freeze`));let P=()=>{M.setAttribute(`aria-pressed`,String(j.value)),M.style.background=j.value?`#7fd0f0`:``,N.style.background=j.value?`#06222e`:``};j.onChange(P),M.addEventListener(`click`,()=>j.set(!j.value)),P(),re.append(A,M),i.append(re);let F=q(`div`,`ouro-meter`);F.style.cssText+=`left:222px;top:654px`,F.setAttribute(`role`,`img`),F.setAttribute(`aria-label`,`Output level`);let ce=[`L`,`R`].map(t=>{let n=q(`div`,`ouro-meter-row`),r=Array.from({length:10},()=>q(`span`,`ouro-seg`));return n.append(...r),F.append(n),{segs:r,nodeId:e.meters.find(e=>e.name===t).nodeId}});i.append(F);let le=0;a.push(()=>{le=0;for(let{segs:e,nodeId:r}of ce){let i=n.readLevel(t,r);le=Math.max(le,i);let a=i>0?20*Math.log10(i):-48,o=Math.round(Math.min(1,Math.max(0,(a+48)/48))*10);e.forEach((e,t)=>{e.style.background=t<o?t>=9?`#e0524a`:t>=7?`#dcb43c`:`#4fb286`:``})}}),i.append(Ia(e,a,()=>le));let I=()=>{if(!r.clientWidth)return;let e=r.clientWidth/la;i.style.transform=`scale(${e})`,r.style.height=`${Math.round(ua*e)}px`};r.style.height=`${ua}px`,new ResizeObserver(I).observe(r),window.requestAnimationFrame(I);let ue=()=>{for(let e of a)e();requestAnimationFrame(ue)};return requestAnimationFrame(ue),r}function Ia(e,t,n){let r=q(`section`,`ouro-patch`);r.setAttribute(`aria-label`,`Patch`);let i=q(`div`);i.style.cssText=`display:flex;align-items:center;gap:10px`;let a=q(`span`);a.style.cssText=`width:28px;height:5px;border-radius:2px;background:${X}`,i.append(a,q(`h2`,void 0,`Patch`));let o=q(`div`,`ouro-patch-display`);o.setAttribute(`role`,`status`),o.setAttribute(`aria-label`,`Current patch`);let s=q(`span`);s.style.cssText=`font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:18px;color:${fa};white-space:nowrap`;let c=q(`span`);c.style.cssText=`font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11px;color:#a9adb3;white-space:nowrap`,o.append(s,c);let l=q(`div`);l.style.cssText=`display:flex;gap:8px;flex:none`;let u=e.slots.map((t,n)=>{let r=q(`button`,`ouro-key ouro-preset`,String(n+1));return r.type=`button`,r.addEventListener(`click`,()=>e.loadSlot(n)),l.append(r),r}),d={series:`Series`,parallel:`Parallel`,pingpong:`Ping-pong`},f=!1,p=()=>{s.textContent=`${String(e.currentSlot+1).padStart(2,`0`)} ${e.currentPreset.name}`,c.textContent=f?`Saved`:d[ha(e,`ouro.routing`).value]??``,u.forEach((t,n)=>{let r=n===e.currentSlot;t.setAttribute(`aria-pressed`,String(r)),t.setAttribute(`aria-label`,`Preset ${n+1}, ${e.slots[n].name}`),t.title=e.slots[n].name,t.style.background=r?X:``,t.style.borderColor=r?X:``,t.style.boxShadow=r?`0 0 10px ${X}`:``})};e.onPresetChange(p),ha(e,`ouro.routing`).onChange(p);let m=q(`button`,`ouro-key`,`Save`);m.type=`button`,m.style.cssText=`padding:0 18px;font-size:15px;letter-spacing:.16em;flex:none`,m.setAttribute(`aria-label`,`Save patch`),m.addEventListener(`click`,()=>{Br(ca,e.currentSlot,e.saveSlot(e.currentSlot)),f=!0,p(),window.setTimeout(()=>{f=!1,p()},1500)});let h=q(`div`);h.style.flex=`1`;let g=q(`div`);g.style.cssText=`display:flex;align-items:center;gap:10px;font-size:13px;letter-spacing:.2em;color:#a9adb3;text-transform:uppercase;flex:none`;let _=q(`span`);return _.style.cssText=`width:10px;height:10px;border-radius:50%;background:#3a3d42`,g.append(q(`span`,void 0,`Signal`),_),t.push(()=>{let e=n()>.002;_.style.background=e?X:`#3a3d42`,_.style.boxShadow=e?`0 0 10px ${X}`:`none`}),p(),r.append(i,o,l,m,h,g),r}var La={kick:`#e8742c`,snare:`#4a9be0`,clap:`#a98be0`,closedHat:`#4fb286`,openHat:`#dcb43c`,ride:`#d9628a`},Ra={height:120,capHeight:32,tick:12},za=[`tune`,`decay`,`third`,`level`],Ba={kick:`click`,snare:`snap`,clap:`spread`,closedHat:`tone`,openHat:`tone`,ride:`bell`},Va=`clap`,Ha=8,Ua=-48,Wa={soft:.4,normal:.8,hard:1},Ga=[`1`,`2`,`3`,`4`,`5`,`6`];function Ka(e,t){let n=e.control(t);if(n.kind!==`number`)throw Error(`${t} is not a number control`);return n}function qa(e,t){let n=e.control(t);if(n.kind!==`toggle`)throw Error(`${t} is not a toggle control`);return n}function Ja(e,t,n,r,i,a){let o=La[t],s=xe[t],c=q(`section`,`synth-section drum-voice`),l=q(`div`,`synth-section-head`),u=q(`span`,`synth-section-bar`);if(u.style.background=o,l.append(u,q(`h2`,void 0,s)),t===`closedHat`||t===`openHat`){let t=Pr(e.choke,`Closed hat chokes open hat`,()=>`Choke`,o,`btn drum-choke`);t.style.marginLeft=`auto`,l.append(t)}let d=q(`button`,`drum-pad`);d.type=`button`,d.style.setProperty(`--voice`,o),d.setAttribute(`aria-label`,`Play ${s}`),d.append(q(`span`,`drum-pad-key`,Ga[n])),d.addEventListener(`pointerdown`,n=>{n.preventDefault(),e.trigger(t,n.shiftKey?Wa.soft:n.altKey?Wa.hard:Wa.normal)}),d.addEventListener(`keydown`,n=>{(n.key===` `||n.key===`Enter`)&&(n.preventDefault(),n.repeat||e.trigger(t,Wa.normal))});let f;e.onHit((e,n)=>{e===t&&(d.style.setProperty(`--hit`,String(.35+.65*n)),d.classList.add(`hit`),window.clearTimeout(f),f=window.setTimeout(()=>d.classList.remove(`hit`),110))});let p=q(`div`,`drum-faders`);for(let n of za){let r=n===`third`?Ba[t]:n===`tune`&&t===Va?`tone`:n;p.append(Ar(Ka(e,`${t}.${r}`),s,Ka(e,`${t}.${r}`).label,Ra))}let m=q(`div`,`drum-ms`);m.append(Pr(qa(e,`${t}.mute`),`${s} mute`,()=>`Mute`,`#e8b43c`,`btn`),Pr(qa(e,`${t}.solo`),`${s} solo`,()=>`Solo`,`#4fb286`,`btn`));let h=q(`div`,`drum-out`);h.append(q(`span`,`drum-jack`),q(`span`,`drum-out-label`,`Out ${n+1}`));let g=q(`div`,`drum-meter`);g.setAttribute(`role`,`img`),g.setAttribute(`aria-label`,`${s} output level`);let _=Array.from({length:Ha},()=>{let e=q(`span`,`drum-seg`);return g.append(e),e});h.append(g);let v=e.meters.find(e=>e.name===t).nodeId;return a.push(()=>{let e=r.readLevel(i,v),t=e>0?20*Math.log10(e):Ua,n=Math.round(Math.min(1,Math.max(0,(t-Ua)/48))*Ha);_.forEach((e,t)=>{e.style.background=t<n?o:``})}),c.append(l,d,p,m,h),c}var Ya=`#4a9be0`,Xa=[`off`,`soft`,`medium`,`hard`],Za=[`0%`,`34%`,`67%`,`100%`];function Qa(e,t,n){let r=q(`section`,`drum-transport`),i=q(`div`,`drum-run`),a=q(`button`,`btn drum-play`,`Play`);a.type=`button`,a.addEventListener(`click`,()=>e.play());let o=q(`button`,`btn drum-stop`,`Stop`);o.type=`button`,o.addEventListener(`click`,()=>e.stop()),i.append(a,o),n.push(()=>{let t=e.externallyDriven;a.setAttribute(`aria-pressed`,String(e.running)),a.style.background=e.running?Ya:``,a.style.borderColor=e.running?Ya:``,a.disabled=t,o.disabled=t,i.title=t?`Following MIDI start/stop`:``});let s=q(`div`,`drum-swing`);s.append(Nr(e.swing,`Sequencer`,`Swing`,34));let c=q(`div`,`drum-patterns`);c.append(q(`div`,`fader-label`,`Pattern`));let l=q(`div`,`transport-seg`);l.setAttribute(`role`,`group`),l.setAttribute(`aria-label`,`Pattern`);let u=Ee.map(t=>{let n=q(`button`,`btn btn-small drum-pattern`,t);return n.type=`button`,n.addEventListener(`click`,()=>e.pattern.set(t)),l.append(n),n}),d=()=>{u.forEach((t,n)=>{let r=Ee[n]===e.pattern.value;t.setAttribute(`aria-pressed`,String(r)),t.style.background=r?Ya:``,t.style.borderColor=r?Ya:``})};return e.pattern.onChange(d),d(),c.append(l),r.append(i,Ni(t.transport,{running:()=>e.running,position:()=>e.position}),s,c),r}function $a(e,t){let n=q(`section`,`synth-section drum-seq`),r=q(`div`,`synth-section-head`),i=q(`span`,`synth-section-bar`);i.style.background=Ya,r.append(i,q(`h2`,void 0,`Sequencer`),q(`span`,`drum-seq-sub`),q(`span`,`drum-seq-hint`,`Click a step to cycle velocity: soft · medium · hard · off`));let a=r.querySelector(`.drum-seq-sub`),o=()=>{a.textContent=`16 steps · pattern ${e.pattern.value}`};e.pattern.onChange(o),o(),n.append(r);let s=q(`div`,`drum-seq-row`);s.append(q(`div`,`drum-seq-label`));let c=q(`div`,`drum-seq-grid`),l=Array.from({length:16},(e,t)=>{let n=q(`div`,`drum-seq-num`,String(t+1));return c.append(n),n});s.append(c),n.append(s);let u=Array.from({length:16},()=>[]),d=[];for(let t of R){let r=La[t],i=xe[t],a=q(`div`,`drum-seq-row`),o=q(`div`,`drum-seq-label`),s=q(`span`,`drum-seq-dot`);s.style.background=r,o.append(s,q(`span`,void 0,i));let c=q(`div`,`drum-seq-grid`);for(let n=0;n<16;n++){let a=q(`button`,`drum-step`);a.type=`button`,a.dataset.group=String(Math.floor(n/4)%2),a.style.setProperty(`--voice`,r);let o=q(`span`,`drum-step-fill`);a.append(o),a.addEventListener(`click`,()=>e.cycle(t,n));let s=()=>{let r=e.level(t,n);o.style.height=Za[r],a.setAttribute(`aria-pressed`,String(r>0)),a.setAttribute(`aria-label`,`${i} step ${n+1}, velocity ${Xa[r]}`),a.classList.toggle(`on`,r>0)};d.push(s),s(),u[n].push(a),c.append(a)}a.append(o,c),n.append(a)}e.onChange(()=>d.forEach(e=>e()));let f;return t.push(()=>{let t=e.currentStep();if(t!==f){if(f!==void 0){l[f].classList.remove(`playhead`);for(let e of u[f])e.classList.remove(`playhead`)}if(t!==void 0){l[t].classList.add(`playhead`);for(let e of u[t])e.classList.add(`playhead`)}f=t}}),n}function eo(e,t,n,r){let i=q(`div`,`synth-panel drum-panel`),a=q(`div`,`synth-header`),o=q(`div`,`synth-brand`);o.append(q(`div`,`synth-name`,`MOA-DR`),q(`div`,`synth-subtitle`,`Drum Machine`)),a.append(o,q(`div`,`drum-outputs-note`,`6 individual outputs`)),i.append(a);let s=[];i.append(Qa(t,e,s));let c=q(`div`,`drum-voices`);R.forEach((t,i)=>c.append(Ja(e,t,i,r,n,s))),i.append(c,$a(t,s)),window.addEventListener(`keydown`,t=>{if(t.repeat||t.metaKey||t.ctrlKey||t.altKey)return;let n=t.target;if(n instanceof HTMLSelectElement||n instanceof HTMLInputElement)return;let r=Ga.indexOf(t.key);r>=0&&e.trigger(R[r],t.shiftKey?Wa.soft:Wa.normal)});let l=()=>{for(let e of s)e();requestAnimationFrame(l)};return requestAnimationFrame(l),i}var to=`#a98ae0`,no=`#dcb43c`,ro=[{value:`small`,text:`Small`,glyph:`M1 2 L8 9 L19 9`,aria:`small room`},{value:`medium`,text:`Medium`,glyph:`M1 2 L13 9 L19 9`,aria:`medium hall`},{value:`large`,text:`Large`,glyph:`M1 2 L19 9`,aria:`large space`}];function io(e,t){let n=e.control(t);if(n.kind!==`number`)throw Error(`${t} is not a number control`);return n}function ao(e,t,n,r){let i=q(`section`,`poly-section fx-card`),a=q(`div`,`poly-section-head`),o=q(`span`,`poly-bar`);o.style.background=n,a.append(o,q(`h2`,void 0,e),q(`span`,`fx-card-sub`,t));let s=q(`div`,`poly-section-body`);return s.append(...r),i.append(a,s),i}function oo(e,t){let n=q(`div`,`fx-panel`),r=q(`div`,`fx-header`);r.append(q(`div`,`synth-name`,`SEND FX`),q(`div`,`synth-subtitle`,`Aux 1 · Aux 2 · stereo returns`)),n.append(r);let i=q(`div`,`poly-row`),a=e.control(`reverb.size`);if(a.kind!==`choice`)throw Error(`reverb.size is not a choice control`);return i.append(ao(`FX 1 · Reverb`,`aux 1`,to,[Ji(a,`Size`,`Step reverb size`,ro),...[`reverb.predelay`,`reverb.lowcut`,`reverb.damp`].map(t=>pi(di(io(e,t),to),`Reverb`))]),ao(`FX 2 · Delay`,`aux 2`,no,[...[`delay.time`,`delay.feedback`,`delay.tone`,`delay.spread`,`delay.wobble`,`delay.drive`].map(e=>pi(di(io(t,e),no),`Delay`))])),n.append(i),n}var so=`moa-granular-patches`,co=270,lo=`#2b130e`,uo=`#5b8cff`,Z=`#e04fd0`,fo=207.35,po=e=>t=>{let n=Math.round((-135+t*co)*10)/10;return`<svg aria-hidden="true" width="${e}" height="${e}" viewBox="0 0 100 100">
    <path d="M18.89 81.11 A44 44 0 1 1 81.11 81.11" fill="none" stroke="${lo}" stroke-opacity="0.28" stroke-width="3"></path>
    <path d="M18.89 81.11 A44 44 0 1 1 81.11 81.11" fill="none" stroke="${lo}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${(t*fo).toFixed(1)} 300"></path>
    <circle cx="50" cy="52" r="31" fill="rgba(60,20,10,0.35)"></circle>
    <circle cx="50" cy="50" r="31" fill="${lo}"></circle>
    <circle cx="50" cy="50" r="28" fill="url(#grKnob)"></circle>
    <defs><radialGradient id="grKnob" cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="#ffffff"></stop><stop offset="0.45" stop-color="#f2ece4"></stop><stop offset="1" stop-color="#cfc6bb"></stop></radialGradient></defs>
    <rect x="47.5" y="26" width="5" height="17" rx="2.5" fill="${lo}" transform="rotate(${n} 50 50)"></rect>
  </svg>`};function mo(e,t){let n=e.control(t);if(n.kind!==`number`)throw Error(`${t} is not a number control`);return n}function Q(e,t,n,r){let i=pi(di(mo(e,t),n),`Granular`,po(r)),a=q(`i`,`gr-led`);return a.style.background=n,a.style.boxShadow=`0 0 8px ${n}`,i.append(a),i}function ho(e,t){let n=q(`div`,`gr-keys`),r=q(`button`,`gr-tail-btn gr-keys-btn`,`Keys`);r.type=`button`,r.title=`Off: the cloud runs all the time. On: it plays only while notes are held (playing a key turns it on).`,r.addEventListener(`click`,()=>e.set(!e.value));let i=()=>r.setAttribute(`aria-pressed`,String(e.value));e.onChange(i),i();let a=q(`select`,`gr-channel`);a.setAttribute(`aria-label`,`MIDI channel`);for(let e of t.options)a.add(new Option(e===`omni`?`Omni`:`Ch ${e}`,e));return a.value=t.value,a.addEventListener(`change`,()=>t.set(a.value)),t.onChange(()=>{a.value=t.value}),n.append(r,a,q(`div`,`dial-label`,`Play`)),n}function go(e){let t=q(`div`,`gr-tail`),n=q(`div`,`gr-tail-row`),r=e.options.map(t=>{let r=q(`button`,`gr-tail-btn`,t[0].toUpperCase());return r.type=`button`,r.setAttribute(`aria-label`,`Reverb tail ${t}`),r.addEventListener(`click`,()=>e.set(t)),n.append(r),r}),i=()=>r.forEach((t,n)=>t.setAttribute(`aria-pressed`,String(e.options[n]===e.value)));return e.onChange(i),i(),t.append(n,q(`div`,`dial-label`,`Tail`)),t}function _o(e){let t=q(`div`,`gr-rule`);return e&&t.append(q(`span`,void 0,e)),t}function vo(e,t,n){zr(so,e),e.loadSlot(e.currentSlot);let r=q(`section`,`gr-panel`);r.setAttribute(`aria-label`,`MOA-GR granular processor`);let i=q(`div`,`gr-header`),a=q(`div`,`gr-title-row`);a.append(q(`div`,`gr-title`,`MOA-GR`),q(`div`,`gr-sub`,`Granular processor`)),i.append(a,q(`div`,`gr-route`,`Aux 3 in · Return 5 out`));let o=q(`div`,`gr-main`);o.append(Q(e,`gr.position`,uo,88),Q(e,`gr.size`,Z,88),Q(e,`gr.pitch`,Z,88),Q(e,`gr.rate`,uo,88),Q(e,`gr.feedback`,Z,88),Q(e,`gr.mix`,uo,88));let s=q(`div`,`gr-texture`);s.append(Q(e,`gr.spread`,uo,64),Q(e,`gr.cloud`,Z,64),Q(e,`gr.detune`,Z,64),Q(e,`gr.shape`,uo,64),Q(e,`gr.reverse`,Z,64));let c=q(`div`,`gr-space`);c.append(Q(e,`gr.filter`,uo,64),Q(e,`gr.reso`,Z,64),Q(e,`gr.drive`,Z,64),Q(e,`gr.reverb`,uo,64),Q(e,`gr.tone`,Z,64),go(e.control(`gr.tail`)));let l=q(`div`,`gr-play`);l.append(Q(e,`gr.attack`,uo,64),Q(e,`gr.decay`,Z,64),Q(e,`gr.sustain`,uo,64),Q(e,`gr.release`,Z,64),ho(e.control(`gr.play`),e.control(`gr.channel`)));let u=q(`div`,`gr-bottom`),d=e.control(`gr.freeze`),f=q(`div`,`gr-freeze-wrap`),p=q(`button`,`gr-freeze`);p.type=`button`,p.setAttribute(`aria-label`,`Freeze buffer`),p.append(q(`span`,`gr-freeze-lamp`)),p.addEventListener(`click`,()=>d.set(!d.value)),f.append(p,q(`div`,`gr-freeze-label`,`Freeze`));let m=q(`div`,`gr-middle`),h=q(`div`,`gr-screen`),g=q(`div`,`gr-screen-head`),_=q(`div`,`gr-screen-name`),v=q(`div`,`gr-screen-meta`);g.append(_,v);let y=q(`canvas`,`gr-canvas`);y.setAttribute(`role`,`img`),y.setAttribute(`aria-label`,`Capture buffer with the grains that are playing`);let b=q(`div`,`gr-axis`);b.append(q(`span`,void 0,`oldest`),q(`span`,void 0,`position`),q(`span`,void 0,`now`)),h.append(g,y,b);let x=q(`div`,`gr-patches`),S=e.slots.map((t,n)=>{let r=q(`button`,`gr-patch`);return r.type=`button`,r.append(q(`span`,`gr-patch-n`,String(n+1)),q(`span`,`gr-patch-name`)),r.addEventListener(`click`,()=>e.loadSlot(n)),x.append(r),r});m.append(h,x);let C=q(`div`,`gr-side`),w=q(`div`,`gr-encoder`);w.tabIndex=0,w.setAttribute(`role`,`slider`),w.setAttribute(`aria-label`,`Patch`),w.setAttribute(`aria-valuemin`,`1`),w.setAttribute(`aria-valuemax`,String(e.slots.length)),w.append(q(`i`,`gr-encoder-mark`));let T=t=>{let n=Math.min(e.slots.length-1,Math.max(0,e.currentSlot+t));n!==e.currentSlot&&e.loadSlot(n)},E;w.addEventListener(`pointerdown`,e=>{w.setPointerCapture(e.pointerId),E=e.clientY}),w.addEventListener(`pointermove`,e=>{if(E===void 0)return;let t=Math.trunc((E-e.clientY)/22);t!==0&&(T(t),E=e.clientY)});let ee=()=>{E=void 0};w.addEventListener(`pointerup`,ee),w.addEventListener(`pointercancel`,ee),w.addEventListener(`wheel`,e=>{e.preventDefault(),T(e.deltaY<0?1:-1)},{passive:!1}),w.addEventListener(`keydown`,e=>{let t={ArrowUp:1,ArrowRight:1,ArrowDown:-1,ArrowLeft:-1};e.key in t&&(e.preventDefault(),T(t[e.key]))});let D=q(`button`,`gr-save`,`Save`);D.type=`button`,D.setAttribute(`aria-label`,`Save patch`);let O=!1;D.addEventListener(`click`,()=>{Br(so,e.currentSlot,e.saveSlot(e.currentSlot)),O=!0,te(),window.setTimeout(()=>{O=!1,te()},1500)}),C.append(w,q(`div`,`gr-side-label`,`Patch`),D),u.append(f,m,C),r.append(i,_o(),o,_o(`Texture`),s,_o(`Tone & space`),c,_o(`Play · 8 voices`),l,_o(),u,Oi(e));let te=()=>{S.forEach((t,n)=>{let r=n===e.currentSlot;t.setAttribute(`aria-pressed`,String(r)),t.querySelector(`.gr-patch-name`).textContent=e.slots[n].name}),_.textContent=e.currentPreset.name;let t=e.slots.length>1?e.currentSlot/(e.slots.length-1):0;w.style.transform=`rotate(${-135+t*co}deg)`,w.setAttribute(`aria-valuenow`,String(e.currentSlot+1)),w.setAttribute(`aria-valuetext`,e.currentPreset.name),D.textContent=O?`Saved`:`Save`};e.onPresetChange(te),te();let ne=()=>{p.setAttribute(`aria-pressed`,String(d.value)),p.classList.toggle(`gr-lit`,d.value)};d.onChange(ne),ne();let re=mo(e,`gr.position`),k=()=>{let e=y.clientWidth,r=y.clientHeight;if(!e||!r)return;let i=window.devicePixelRatio||1;(y.width!==Math.round(e*i)||y.height!==Math.round(r*i))&&(y.width=Math.round(e*i),y.height=Math.round(r*i));let a=y.getContext(`2d`);if(!a)return;a.setTransform(i,0,0,i,0,0),a.clearRect(0,0,e,r);let o=n.readGranular(t,`grains`),s=o?.peaks,c=s?.length??96,l=e/c;a.fillStyle=`#cdbfae`;for(let e=0;e<c;e++){let t=Math.min(1,Math.sqrt(s?.[e]??0)),n=Math.max(2,t*r*.92);a.fillRect(e*l+.5,(r-n)/2,Math.max(1,l-1.5),n)}if(o){a.fillStyle=`rgba(255,126,104,0.38)`,a.strokeStyle=`#ff9a86`;for(let t=0;t<o.grains.length;t+=2){let n=o.grains[t]*e,i=Math.max(2,o.grains[t+1]*e);a.fillRect(n,0,i,r),a.strokeRect(n+.5,.5,i,r-1)}}a.fillStyle=`#ffe27a`,a.fillRect((1-re.value)*e-1,0,2,r),v.textContent=`20 s buffer · ${d.value?`frozen`:o?`live`:`start audio`}`},A=()=>{k(),requestAnimationFrame(A)};return requestAnimationFrame(A),r}var yo=`#4a9be0`,bo=`#e8742c`,xo=`#4fb286`,So=`#dcb43c`,Co=`#d9628a`,wo={height:240,capHeight:40,tick:24,unity:1},To=240,Eo=-60;function Do(e,t){let n=e.control(t);if(n.kind!==`number`)throw Error(`${t} is not a number control`);return n}function Oo(e,t){let n=e.control(t);if(n.kind!==`toggle`)throw Error(`${t} is not a toggle control`);return n}function ko(e,t){let n=q(`div`,`mix-heading`),r=q(`span`,`mix-heading-bar`);return r.style.background=t,n.append(r,q(`h3`,void 0,e)),n}function Ao(e,t=To){let n=q(`div`,`meter`);n.style.height=`${t}px`,n.setAttribute(`role`,`img`),n.setAttribute(`aria-label`,e);let r=q(`div`,`meter-mask`);n.append(r,q(`div`,`meter-grid`));let i=0;return{element:n,update:e=>{let n=e>0?20*Math.log10(e):Eo,a=Math.min(1,Math.max(0,(n-Eo)/66));i=Math.max(a,i-.03),r.style.height=`${Math.round((1-i)*t)}px`}}}function jo(e,t,n,r,i,a,o,s){let c=e=>`${t}.${e}`,l=r?`FX return ${n}`:`Channel ${n}`,u=q(`section`,r?`mix-strip mix-strip-return`:`mix-strip`),d=q(`header`,`mix-strip-head`);d.append(q(`h2`,void 0,r?`FX${n}`:String(n)),q(`div`,`mix-strip-name`,i)),u.append(d),u.append(Pr(Oo(e,c(`lowcutOn`)),`${l} low cut 75 Hz`,()=>`Low cut`,yo,`btn btn-wide`));let f=q(`div`,`mix-group`);f.append(ko(`EQ`,yo));let p=q(`div`,`mix-grid-2`);for(let[t,n]of[[`eqHigh`,`High`],[`eqMid`,`Mid`],[`eqLow`,`Low`],[`eqMidFreq`,`Freq`]])p.append(Nr(Do(e,c(t)),l,n,32));f.append(p),u.append(f);let m=q(`div`,`mix-group`);m.append(ko(`Aux`,bo));for(let[t,n]of ir){let r=q(`div`,`aux-row`);r.append(Nr(Do(e,c(`aux${t}`)),l,String(t),26),Nr(Do(e,c(`aux${n}`)),l,String(n),26),Pr(Oo(e,c(`auxPre${t}${n}`)),`${l} aux ${t}-${n} pre-fader`,e=>e?`Pre`:`Post`,bo,`btn btn-small`)),m.append(r)}u.append(m),u.append(Nr(Do(e,c(`pan`)),l,r?`Bal`:`Pan`,32));let h=q(`div`,`mix-row`);h.append(Pr(Oo(e,c(`mute`)),`${l} mute`,()=>`Mute`,`#e0524a`,`btn`)),r||h.append(Pr(Oo(e,c(`solo`)),`${l} solo`,()=>`Solo`,So,`btn`)),u.append(h);let g=q(`div`,`mix-group`);g.append(ko(`Bus`,xo));let _=q(`div`,`mix-row`);for(let t of rr)e.controls.some(e=>e.id===c(`bus${t}`))&&_.append(Pr(Oo(e,c(`bus${t}`)),`${l} assign to bus ${t}`,()=>t,xo,`btn`));g.append(_),u.append(g);let v=q(`div`,`mix-fader-row`),y=Ar(Do(e,c(`fader`)),l,`Level`,wo);if(v.append(y),r){let n=q(`div`,`meter-pair`);for(let r of[`L`,`R`]){let i=Ao(`${l} ${r} level`),c=e.meters.find(e=>e.name===`${t}.${r}`).nodeId;s.push(()=>i.update(o.readLevel(a,c))),n.append(i.element)}v.append(n)}else{let n=Ao(`${l} level`),r=e.meters.find(e=>e.name===t).nodeId;s.push(()=>n.update(o.readLevel(a,r))),v.append(n.element)}return u.append(v),u}function Mo(e,t,n,r=[],i=[],a={}){let o=q(`div`,`mix-panel`),s=q(`div`,`mix-header`),c=q(`div`,`mix-brand`);c.append(q(`div`,`mix-name`,`MOA-MIX`),q(`div`,`mix-subtitle`,`${e.channelCount} channel${e.channelCount===1?``:`s`} · ${e.returnCount} FX return${e.returnCount===1?``:`s`} · 3 stereo buses · 6 aux sends`)),s.append(c),o.append(s);let l=q(`div`,`mix-body`),u=[],d=q(`div`,`mix-strips`);for(let i=1;i<=e.channelCount;i++)d.append(jo(e,`ch${i}`,i,!1,r[i-1]??``,t,n,u));for(let r=1;r<=e.returnCount;r++)d.append(jo(e,`ret${r}`,r,!0,i[r-1]??``,t,n,u));l.append(d);let f=q(`section`,`mix-master`),p=q(`div`,`synth-section-head`),m=q(`span`,`synth-section-bar`);m.style.background=Co,p.append(m,q(`h2`,void 0,`Master`)),f.append(p);let h=q(`div`,`mix-group`);h.append(ko(`Aux masters`,bo));let g=q(`div`,`mix-grid-3`);for(let t=1;t<=6;t++)g.append(Nr(Do(e,`aux${t}.master`),`Master`,`Aux ${t}`,36));h.append(g),f.append(h);let _=q(`div`,`mix-group`);_.append(ko(`Monitor`,So));let v=q(`div`,`solo-led`);v.append(q(`span`,`solo-led-dot`),q(`span`,void 0,`Solo active`)),_.append(v),f.append(_),u.push(()=>v.classList.toggle(`on`,e.soloActive));let y=q(`div`,`mix-group mix-group-grow`);y.append(ko(`Stereo buses`,xo));let b=q(`div`,`bus-row`);for(let r of rr){let i=q(`div`,`bus-col`),o=q(`div`,`mix-fader-row`);o.append(Ar(Do(e,`bus${r}.fader`),`Bus`,`Bus ${r}`,wo));let s=q(`div`,`meter-pair`);for(let i of[`L`,`R`]){let a=Ao(`Bus ${r} ${i} level`),o=e.meters.find(e=>e.name===`bus${r}.${i}`).nodeId;u.push(()=>a.update(n.readLevel(t,o))),s.append(a.element)}o.append(s),i.append(o);let c=q(`div`,`bus-route`);c.append(Pr(Oo(e,`bus${r}.main`),`Bus ${r} to main`,()=>`To main`,xo,`btn`));let l=q(`div`,`bus-tag`,a[r]?`→ ${a[r]}`:``);c.append(l);let d=Oo(e,`bus${r}.main`),f=()=>l.classList.toggle(`on`,!d.value&&!!a[r]);d.onChange(f),f(),i.append(c),b.append(i)}y.append(b),f.append(y),l.append(f),o.append(l);let x=()=>{for(let e of u)e();requestAnimationFrame(x)};return requestAnimationFrame(x),o}var No=`#d9628a`,Po=`#4fb286`,Fo=`#e8742c`,Io=`#dcb43c`,Lo=`#4a9be0`,Ro=[[{title:`Performance`,color:No,grow:2,switches:[`perf.notes`],faders:[`perf.glide`]},{title:`LFO`,color:Po,grow:2,switches:[`lfo.wave`],faders:[`lfo.rate`]},{title:`Oscillator`,color:Fo,grow:5,switches:[`osc.range`,`osc.pwSource`],faders:[`mix.saw`,`mix.pulse`,`osc.width`,`osc.pwm`,`osc.mod`]},{title:`Sub & noise`,color:Io,grow:2,switches:[`osc.sub`],faders:[`mix.sub`,`mix.noise`]}],[{title:`Filter`,color:Lo,grow:5,faders:[`filter.cutoff`,`filter.resonance`,{id:`filterEnv.amount`,label:`Env`},`filter.lfo`,`filter.keyFollow`]},{title:`Filter envelope`,color:Lo,grow:4,faders:zo(`filterEnv`)},{title:`Amp envelope`,color:Fo,grow:4,faders:zo(`ampEnv`)},{title:`Master`,color:No,grow:1,faders:[`level`]}]];function zo(e){return[{id:`${e}.attack`,label:`A`},{id:`${e}.decay`,label:`D`},{id:`${e}.sustain`,label:`S`},{id:`${e}.release`,label:`R`}]}function Bo(e,t){let n=e.control(t);if(n.kind!==`number`)throw Error(`${t} is not a number control`);return n}function Vo(e,t){let n=q(`div`,`switch`);n.append(q(`div`,`fader-label`,e.label));let r=q(`div`,`switch-options`);r.setAttribute(`role`,`group`),r.setAttribute(`aria-label`,e.label);let i=e.options.map(t=>{let n=q(`button`,`switch-option`,t);return n.type=`button`,n.addEventListener(`click`,()=>{e.set(t),a()}),r.append(n),n}),a=()=>{i.forEach((n,r)=>{let i=e.options[r]===e.value;n.setAttribute(`aria-pressed`,String(i)),n.style.background=i?t:``,n.style.borderColor=i?t:``})};return e.onChange(a),a(),n.append(r),n}function Ho(e,t){let n=q(`div`,`switch`);n.append(q(`div`,`fader-label`,e.label));let r=q(`button`,`switch-option`,e.value?`On`:`Off`);r.type=`button`;let i=()=>{r.textContent=e.value?`On`:`Off`,r.setAttribute(`aria-pressed`,String(e.value)),r.style.background=e.value?t:``,r.style.borderColor=e.value?t:``};return r.addEventListener(`click`,()=>{e.set(!e.value),i()}),i(),n.append(r),n}function Uo(e,t){let n=q(`section`,`synth-section`);n.style.flex=`${t.grow} 1 0`;let r=q(`div`,`synth-section-head`),i=q(`span`,`synth-section-bar`);i.style.background=t.color,r.append(i,q(`h2`,void 0,t.title));let a=q(`div`,`synth-section-body`);for(let n of t.switches??[]){let r=e.control(n);r.kind===`choice`?a.append(Vo(r,t.color)):r.kind===`toggle`&&a.append(Ho(r,t.color))}for(let n of t.faders){let{id:r,label:i}=typeof n==`string`?{id:n,label:void 0}:n,o=Bo(e,r);a.append(Ar(o,t.title,i??o.label))}return n.append(r,a),n}function Wo(e){let t=q(`div`,`patch-picker`);t.append(q(`div`,`fader-label`,`Patch`));let n=q(`div`,`patch-picker-row`),r=q(`select`,`patch-select`);r.setAttribute(`aria-label`,`Synth patch`),sr.forEach((e,t)=>r.add(new Option(`${String(t).padStart(2,`0`)}  ${e.name}`,String(t))));let i=t=>{let n=sr.length,i=(t%n+n)%n;r.value=String(i),e.loadPreset(sr[i])},a=(e,t,n)=>{let a=q(`button`,`btn patch-step`,t);return a.type=`button`,a.setAttribute(`aria-label`,e),a.addEventListener(`click`,()=>i(Number(r.value)+n)),a};return r.addEventListener(`change`,()=>i(Number(r.value))),e.onPresetChange(()=>{r.value=String(sr.indexOf(e.currentPreset))}),n.append(a(`Previous patch`,`‹`,-1),r,a(`Next patch`,`›`,1)),t.append(n),t}function Go(e){let t=q(`div`,`synth-panel`),n=q(`div`,`synth-header`),r=q(`div`,`synth-brand`);r.append(q(`div`,`synth-name`,`MOA-1`),q(`div`,`synth-subtitle`,`Mono Synthesizer`)),n.append(r,Ni(e.transport),Wo(e)),t.append(n);for(let n of Ro){let r=q(`div`,`synth-row`);for(let t of n)r.append(Uo(e,t));t.append(r)}return t.append(Oi(e)),t}var Ko=new L,qo=new Ue,Jo=new Xe,$=Tr.default(Ko),Yo=new u($),Xo=document.querySelector(`#app`),Zo=document.createElement(`button`);Zo.className=`start`,Zo.textContent=`Start audio`,Zo.addEventListener(`click`,async()=>{await Yo.start(),Zo.textContent=`Audio running`,Zo.disabled=!0});var Qo=$.device(`synth`),$o=$.device(`poly`),es=$.device(`drums`),ts=$.device(`granular`),ns=new Ie(es,Ko,()=>Yo.currentTime);setInterval(()=>ns.tick(),25);function rs(e,t=performance.now()){let n=Le(e);n&&(Ko.handle(n,t),qo.record(n,t),Qo.handleMidi(n),$o.handleMidi(n),ts.handleMidi(n),es.handleMidi(n),ns.handleMidi(n))}Jo.onMessage=(e,t)=>rs(e,t),Jo.connectIfPermitted();var is=new Ke;is.onMessage=(e,t)=>rs(e,t),Xo.append(Ir(Jo,Ko,qo,Zo,is),Go(Qo)),Xo.append(ia($o)),Xo.append(eo(es,ns,`drums`,Yo)),Xo.append(oo($.device(`reverb`),$.device(`delay`))),Xo.append(Fa($.device(`ouroboros`),`ouroboros`,Yo)),Xo.append(ai($.device(`buscomp`),$.device(`mixer`),`buscomp`,Yo,[{value:`off`,label:`Off`},{value:`3`,label:`Kick`},{value:`4`,label:`Snare`},{value:`5`,label:`Clap`},{value:`6`,label:`CL Hat`},{value:`7`,label:`OP Hat`},{value:`8`,label:`Ride`},{value:`1`,label:`Synth`},{value:`2`,label:`Poly`}])),Xo.append(vo(ts,`granular`,Yo)),Xo.append(Mo($.device(`mixer`),`mixer`,Yo,[`Synth`,`Poly`,`Kick`,`Snare`,`Clap`,`Closed Hat`,`Open Hat`,`Ride`],[`Reverb`,`Delay`,`Ouroboros`,`Bus Comp`,`Granular`],{B:`to Bus Comp`,C:`to Ouroboros`}));