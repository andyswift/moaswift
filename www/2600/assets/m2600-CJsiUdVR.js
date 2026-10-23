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
`,n=[`chrom`,`major`,`minor`,`pent`,`dorian`,`blues`],r={chrom:[0,1,2,3,4,5,6,7,8,9,10,11],major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10],pent:[0,3,5,7,10],dorian:[0,2,3,5,7,9,10],blues:[0,3,5,6,7,10]},i={"1/4":24,"1/8":12,"1/8T":8,"1/16":6,"1/16T":4},a=(e,t,n,r,i,a=``,o=`linear`)=>({id:e,label:t,kind:`number`,min:n,max:r,def:i,unit:a,curve:o}),o=(e,t,n,r)=>({id:e,label:t,kind:`choice`,min:0,max:n.length-1,def:n.indexOf(r),options:n}),s=[.2,.35,.5,.35,.2,.6,.5,.35,.2,.35,.5,.7,.6,.5,.35,.2],c=[...Array.from({length:16},(e,t)=>a(`sq.step.${t+1}`,`Step ${t+1}`,0,1,s[t])),...Array.from({length:16},(e,t)=>o(`sq.gate.${t+1}`,`Step ${t+1} gate`,[`off`,`1`,`2`,`3`],`1`)),o(`sq.mode`,`Steps`,[`16`,`8x2`],`16`),o(`sq.dir`,`Direction`,[`fwd`,`rev`,`pingpong`,`random`],`fwd`),o(`sq.skip`,`Bus 3 does`,[`skip`,`off`,`reset`],`off`),o(`sq.trig`,`Start/stop input`,[`trig`,`gate`],`trig`),a(`sq.rate`,`Clock frequency`,.2,40,6,`Hz`,`log`),a(`sq.fm`,`Clock FM`,0,1,0),a(`sq.pw`,`Pulse width`,.05,.95,.5),o(`sq.scale`,`Quantizer scale`,n,`chrom`),o(`sq.range`,`Quantizer range`,[`1`,`2`,`4`],`2`),o(`sq.sync`,`Clock source`,[`int`,`midi`],`int`),o(`sq.div`,`MIDI division`,Object.keys(i),`1/16`)],l=[`sq.a`,`sq.b`,`sq.qa`,`sq.qb`,`sq.bus1`,`sq.bus2`,`sq.bus3`,`sq.pos1`,`sq.cgate1`,`sq.clk`],u=[{id:`sq.cvin`},{id:`sq.ina`,normal:`sq.a`},{id:`sq.inb`,normal:`sq.b`},{id:`sq.start`},{id:`sq.stop`},{id:`sq.startstop`},{id:`sq.stepin`},{id:`sq.resetin`},{id:`sq.fmin`,slider:`sq.fm`},{id:`sq.pwm`},{id:`sq.extclk`}],d=(e,t,n,r,i,a=``,o=`linear`)=>({id:e,label:t,kind:`number`,min:n,max:r,def:i,unit:a,curve:o}),f=(e,t,n,r)=>({id:e,label:t,kind:`choice`,min:0,max:n.length-1,def:n.indexOf(r),options:n}),p=(e,t,n=0)=>({id:e,label:t,kind:`toggle`,min:0,max:1,def:n}),m=(e,t,n=0)=>d(e,t,0,1,n),h=[d(`kb.porta`,`Portamento`,0,1,.25),p(`kb.portaOn`,`Portamento on`,0),f(`kb.voice`,`Voice mode`,[`mono`,`duo`],`mono`),f(`kb.repeat`,`Repeat`,[`kybd`,`off`,`auto`],`off`),f(`kb.trig`,`Trigger mode`,[`single`,`multi`],`multi`),d(`lfo.speed`,`LFO speed`,.1,30,5,`Hz`,`log`),d(`lfo.delay`,`Vibrato delay`,0,3,0,`s`),m(`lfo.depth`,`Vibrato depth`,0),m(`pre.gain`,`Preamp gain`,.5),f(`pre.range`,`Preamp range`,[`x10`,`x100`,`x1000`],`x10`),m(`envf.gain`,`Env follower gain`,.5),f(`ring.mode`,`Ring mod mode`,[`audio`,`dc`],`audio`),m(`ring.a`,`Ring mod A level`,1),m(`ring.b`,`Ring mod B level`,1),m(`noise.color`,`Noise color`,0),m(`noise.level`,`Noise level`,.8),d(`vco1.freq`,`Initial frequency`,10,1e4,261.63,`Hz`,`log`),d(`vco1.fine`,`Fine tune`,-6,6,0,`st`),d(`vco1.pw`,`Pulse width`,.1,.9,.5),f(`vco1.range`,`Range`,[`audio`,`lf`],`audio`),m(`vco1.fm.sh`,`FM S/H`),m(`vco1.fm.adsr`,`FM ADSR`),m(`vco1.fm.lfo`,`FM LFO`),d(`vco2.freq`,`Initial frequency`,10,1e4,261.63,`Hz`,`log`),d(`vco2.fine`,`Fine tune`,-6,6,0,`st`),d(`vco2.pw`,`Pulse width`,.1,.9,.5),f(`vco2.range`,`Range`,[`audio`,`lf`],`audio`),p(`vco2.sync`,`Sync to VCO 1`),m(`vco2.fm.sh`,`FM S/H`),m(`vco2.fm.adsr`,`FM ADSR`),m(`vco2.fm.vco1`,`FM VCO 1`),m(`vco2.pwm`,`PWM noise`),d(`vco3.freq`,`Initial frequency`,10,1e4,261.63,`Hz`,`log`),d(`vco3.fine`,`Fine tune`,-6,6,0,`st`),d(`vco3.pw`,`Pulse width`,.1,.9,.5),f(`vco3.range`,`Range`,[`audio`,`lf`],`audio`),p(`vco3.sync`,`Sync to VCO 1`),m(`vco3.fm.noise`,`FM noise`),m(`vco3.fm.adsr`,`FM ADSR`),m(`vco3.fm.vco2`,`FM VCO 2`),m(`vco3.pwm`,`PWM ADSR`),d(`vcf.freq`,`Initial frequency`,10,16e3,1200,`Hz`,`log`),d(`vcf.fine`,`Fine tune`,-1,1,0,`oct`),m(`vcf.res`,`Resonance`,0),f(`vcf.mode`,`Mode`,[`4012`,`4072`],`4072`),m(`vcf.in.ring`,`Audio ring mod`),m(`vcf.in.vco1`,`Audio VCO 1`,.8),m(`vcf.in.vco2`,`Audio VCO 2`),m(`vcf.in.vco3`,`Audio VCO 3`),m(`vcf.in.noise`,`Audio noise`),m(`vcf.cv.kybd`,`Control keyboard`,1),m(`vcf.cv.adsr`,`Control ADSR`,.3),m(`vcf.cv.vco2`,`Control VCO 2`),d(`sem.freq`,`Frequency`,10,16e3,16e3,`Hz`,`log`),m(`sem.res`,`Resonance`,0),m(`sem.mode`,`LP / notch / HP`,0),p(`sem.bp`,`Band pass`),m(`sem.in.vco1`,`Audio VCO 1`),m(`sem.in.vco2`,`Audio VCO 2`),m(`sem.in.vco3`,`Audio VCO 3`),m(`sem.in.noise`,`Audio noise`),m(`sem.cv.kybd`,`Control keyboard`,1),m(`sem.cv.adsr`,`Control ADSR`),m(`sem.cv.lfo`,`Control LFO`),d(`adsr.attack`,`Attack`,.001,10,.005,`s`,`log`),d(`adsr.decay`,`Decay`,.002,10,.4,`s`,`log`),m(`adsr.sustain`,`Sustain`,.6),d(`adsr.release`,`Release`,.002,10,.3,`s`,`log`),f(`adsr.factor`,`Time factor`,[`x0.5`,`x1`,`x2`],`x1`),d(`ar.attack`,`Attack`,.001,10,.005,`s`,`log`),d(`ar.release`,`Release`,.002,10,.3,`s`,`log`),f(`ar.factor`,`Time factor`,[`x0.5`,`x1`,`x2`],`x1`),f(`ar.source`,`AR gate`,[`kybd`,`sh`],`kybd`),m(`vca.gain`,`Initial gain`,0),m(`vca.in.vcf`,`Audio VCF`,.8),m(`vca.in.sem`,`Audio SEM`),m(`vca.in.ring`,`Audio ring mod`),m(`vca.cv.ar`,`Control AR (lin)`),m(`vca.cv.adsr`,`Control ADSR (exp)`,1),m(`vp.2`,`Processor 2 (-10 V)`),m(`vp.4`,`Processor 4 (KYBD CV)`),m(`vp.6`,`Processor 6 (+10 V)`),m(`vp.lag`,`Lag time`,.3),m(`sh.level`,`S/H input level`,1),d(`sh.rate`,`S/H clock rate`,.1,50,6,`Hz`,`log`),m(`mix.vcf`,`Mixer VCF`),m(`mix.vca`,`Mixer VCA`,.8),m(`reverb.left`,`Reverb left`,.15),m(`reverb.right`,`Reverb right`,.15),d(`mix.pan`,`Pan`,-1,1,0),m(`out.volume`,`Volume`,.8),...c],g=[d(`bend`,`Bend`,-2,2,0,`st`),m(`modw`,`Mod wheel`)],ee=new Set(h.filter(e=>e.kind!==`number`).map(e=>e.id)),te=[`kb.cv`,`kb.upper`,`kb.gate`,`kb.trig`,`lfo.tri`,`lfo.square`,`lfo.delayed`,`pre.out`,`envf.out`,`ring.out`,`noise.out`,`vco1.saw`,`vco1.pulse`,`vco2.tri`,`vco2.saw`,`vco2.sine`,`vco2.pulse`,`vco3.tri`,`vco3.saw`,`vco3.sine`,`vco3.pulse`,`vcf.out`,`sem.out`,`adsr.out`,`ar.out`,`vca.out`,`mix.out`,`reverb.out`,`vp.inv1`,`vp.inv2`,`vp.lag`,`sh.out`,`sh.clk`,`esw.c`,...l],ne=[{id:`kb.extvib`},{id:`pre.in`},{id:`envf.in`,normal:`pre.out`,slider:`envf.gain`},{id:`ring.a`,normal:`vco1.saw`,slider:`ring.a`},{id:`ring.b`,normal:`vco2.tri`,slider:`ring.b`},{id:`vco1.fm.kybd`,normal:`kb.cv`},{id:`vco1.fm.sh`,normal:`sh.out`,slider:`vco1.fm.sh`},{id:`vco1.fm.adsr`,normal:`adsr.out`,slider:`vco1.fm.adsr`},{id:`vco1.fm.lfo`,normal:`lfo.tri`,slider:`vco1.fm.lfo`},{id:`vco2.fm.kybd`,normal:`kb.upper`},{id:`vco2.fm.sh`,normal:`sh.out`,slider:`vco2.fm.sh`},{id:`vco2.fm.adsr`,normal:`adsr.out`,slider:`vco2.fm.adsr`},{id:`vco2.fm.vco1`,normal:`vco1.pulse`,slider:`vco2.fm.vco1`},{id:`vco2.pwm`,normal:`noise.out`,slider:`vco2.pwm`},{id:`vco3.fm.kybd`,normal:`kb.upper`},{id:`vco3.fm.noise`,normal:`noise.out`,slider:`vco3.fm.noise`},{id:`vco3.fm.adsr`,normal:`adsr.out`,slider:`vco3.fm.adsr`},{id:`vco3.fm.vco2`,normal:`vco2.sine`,slider:`vco3.fm.vco2`},{id:`vco3.pwm`,normal:`adsr.out`,slider:`vco3.pwm`},{id:`vcf.in.ring`,normal:`ring.out`,slider:`vcf.in.ring`},{id:`vcf.in.vco1`,normal:`vco1.pulse`,slider:`vcf.in.vco1`},{id:`vcf.in.vco2`,normal:`vco2.pulse`,slider:`vcf.in.vco2`},{id:`vcf.in.vco3`,normal:`vco3.saw`,slider:`vcf.in.vco3`},{id:`vcf.in.noise`,normal:`noise.out`,slider:`vcf.in.noise`},{id:`vcf.cv.kybd`,normal:`kb.cv`,slider:`vcf.cv.kybd`},{id:`vcf.cv.adsr`,normal:`adsr.out`,slider:`vcf.cv.adsr`},{id:`vcf.cv.vco2`,normal:`vco2.sine`,slider:`vcf.cv.vco2`},{id:`sem.in.vco1`,normal:`vco1.saw`,slider:`sem.in.vco1`},{id:`sem.in.vco2`,normal:`vco2.saw`,slider:`sem.in.vco2`},{id:`sem.in.vco3`,normal:`vco3.pulse`,slider:`sem.in.vco3`},{id:`sem.in.noise`,normal:`noise.out`,slider:`sem.in.noise`},{id:`sem.cv.kybd`,normal:`kb.cv`,slider:`sem.cv.kybd`},{id:`sem.cv.adsr`,normal:`adsr.out`,slider:`sem.cv.adsr`},{id:`sem.cv.lfo`,normal:`lfo.tri`,slider:`sem.cv.lfo`},{id:`adsr.gate`,normal:`kb.gate`},{id:`adsr.trig`,normal:`kb.trig`},{id:`ar.gate`,normal:`kb.gate`},{id:`vca.in.vcf`,normal:`vcf.out`,slider:`vca.in.vcf`},{id:`vca.in.sem`,normal:`sem.out`,slider:`vca.in.sem`},{id:`vca.in.ring`,normal:`ring.out`,slider:`vca.in.ring`},{id:`vca.cv.ar`,normal:`ar.out`,slider:`vca.cv.ar`},{id:`vca.cv.adsr`,normal:`adsr.out`,slider:`vca.cv.adsr`},{id:`mix.in.vcf`,normal:`vcf.out`,slider:`mix.vcf`},{id:`mix.in.vca`,normal:`vca.out`,slider:`mix.vca`},{id:`vp.1`},{id:`vp.2`,normal:`-10V`,slider:`vp.2`},{id:`vp.3`},{id:`vp.4`,normal:`kb.cv`,slider:`vp.4`},{id:`vp.5`},{id:`vp.6`,normal:`+10V`,slider:`vp.6`},{id:`vp.7`,normal:`envf.out`},{id:`sh.in`,normal:`noise.out`,slider:`sh.level`},{id:`sh.extclk`},{id:`esw.a`},{id:`esw.b`},{id:`out.left`},{id:`out.right`},...u],re=`moa-duo`,ie=`
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
  registerProcessor('${re}', MoaDuo);
}
`,ae=`moa-fold`,oe=`
const FOLD_OS = 2; // oversampling (with the steep decimation filter, 2x measured cleaner than 4x)
const FOLD_PARAMS = [
  ['fold', 1, 0.5, 12], ['even', 0, 0, 1], ['harmonics', 48, 2, 128], ['pitch', 0, -6000, 6000],
];

class FoldCore {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.prevIn = 0;
    this.prevU = 0;
    this.s = new Float64Array(12); // six TPT state-variable low-pass stages, two states each
    this.dcIn = 0;
    this.dcOut = 0;
  }

  // one 12 dB TPT low-pass stage; g and k are precomputed
  lp(i, x, g, k) {
    const s = this.s;
    const hp = (x - (k + g) * s[i] - s[i + 1]) / (1 + g * (k + g));
    const bp = g * hp + s[i];
    const lp = g * bp + s[i + 1];
    s[i] = g * hp + bp;
    s[i + 1] = g * bp + lp;
    return lp;
  }

  // the folder sin(u), first-order ADAA: the mean of sin over the step from the previous u to this one
  fold(u) {
    const d = u - this.prevU;
    const y = Math.abs(d) > 1e-5 ? (Math.cos(this.prevU) - Math.cos(u)) / d : Math.sin(0.5 * (u + this.prevU));
    this.prevU = u;
    return y;
  }

  process(input, output, n, p) {
    const srOs = this.sr * FOLD_OS;
    const gain = p.fold * Math.PI * 0.5;
    const bias = p.even * Math.PI * 0.5;
    const f0 = 440 * Math.pow(2, p.pitch / 1200);
    const fc = Math.min(18000, Math.max(150, p.harmonics * f0));
    const g = Math.tan(Math.PI * fc / srOs);
    const gd = Math.tan(Math.PI * Math.min(19000, 0.45 * this.sr) / srOs);
    for (let i = 0; i < n; i++) {
      const x = input ? input[i] : 0;
      // x2: points along the line from the last sample to this one; the low-passes run at the raised rate, and the
      // last point is kept
      let y = 0;
      for (let j = 1; j <= FOLD_OS; j++) {
        const xs = this.prevIn + (x - this.prevIn) * (j / FOLD_OS);
        const v = this.fold(gain * xs + bias);
        // the pitch-tracking low-pass: a 4th-order Butterworth (stage damping 2 cos(pi/8) and 2 cos(3pi/8))
        const t = this.lp(2, this.lp(0, v, g, 1.8478), g, 0.7654);
        // the decimation low-pass: an 8th-order Butterworth, so nothing above the new Nyquist folds back
        y = this.lp(10, this.lp(8, this.lp(6, this.lp(4, t, gd, 1.9616), gd, 1.6629), gd, 1.1111), gd, 0.3902);
      }
      this.prevIn = x;
      // DC blocker (the bias adds an offset)
      const out = y - this.dcIn + 0.9995 * this.dcOut;
      this.dcIn = y;
      this.dcOut = Math.abs(out) < 1e-20 ? 0 : out;
      output[i] = out;
    }
  }
}

if (typeof registerProcessor === 'function') {
  class MoaFold extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return FOLD_PARAMS.map((d) => ({ name: d[0], defaultValue: d[1], minValue: d[2], maxValue: d[3], automationRate: 'k-rate' }));
    }
    constructor() {
      super();
      this.core = new FoldCore(sampleRate);
      this.p = {};
    }
    process(inputs, outputs, params) {
      const out = outputs[0][0];
      for (const name in params) this.p[name] = params[name][0];
      const input = inputs[0] && inputs[0][0];
      this.core.process(input, out, out.length, this.p);
      return true;
    }
  }
  registerProcessor('${ae}', MoaFold);
}
`,se=`moa-ladder`,ce=`
const LADDER_PARAMS = [
  ['cutoff', 800, 20, 20000, 'k-rate'], ['detune', 0, -12000, 12000, 'a-rate'], ['res', 0, 0, 1, 'k-rate'], ['drive', 0, 0, 1, 'k-rate'],
];

function ladderTanh(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

class LadderCore {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.s = [0, 0, 0, 0];
    this.d = new Float64Array(8); // the decimation filter: four TPT stages, two states each
    this.prevIn = 0;
  }

  // one TPT low-pass stage of the decimation filter
  dec(i, x, g, k) {
    const s = this.d;
    const hp = (x - (k + g) * s[i] - s[i + 1]) / (1 + g * (k + g));
    const bp = g * hp + s[i];
    const lp = g * bp + s[i + 1];
    s[i] = g * hp + bp;
    s[i + 1] = g * bp + lp;
    return lp;
  }

  // one sample of the ladder at the oversampled rate
  ladder(x, g, k, drive) {
    const G = g / (1 + g), ig = 1 / (1 + g), s = this.s;
    const G2 = G * G;
    const S = (G2 * G * s[0] + G2 * s[1] + G * s[2] + s[3]) * ig;
    const y4 = (G2 * G2 * x + S) / (1 + k * G2 * G2);
    let u = ladderTanh((x - k * y4) * drive) / drive;
    for (let j = 0; j < 4; j++) {
      const v = (u - s[j]) * G;
      const y = v + s[j];
      s[j] = y + v;
      u = y;
    }
    return u;
  }

  // detune: an array (a-rate) or a single value
  process(input, output, n, p, detune) {
    const sr2 = this.sr * 2;
    const k = p.res * 4.15;
    const pre = 0.6 + p.drive * 7; // the level into the loop's saturation
    const comp = (1 + 0.55 * k) * (1 + p.drive * 0.6); // the passband back up, and some make-up
    const gd = Math.tan(Math.PI * Math.min(19000, 0.45 * this.sr) / sr2);
    const maxFc = 0.45 * sr2 * 0.5;
    const many = detune && detune.length > 1;
    for (let i = 0; i < n; i++) {
      const x = input ? input[i] : 0;
      const cents = many ? detune[i] : (detune ? detune[0] : 0);
      const fc = Math.min(maxFc, Math.max(10, p.cutoff * Math.pow(2, cents / 1200)));
      const g = Math.tan(Math.PI * fc / sr2);
      let y = 0;
      for (let j = 1; j <= 2; j++) {
        const xs = this.prevIn + (x - this.prevIn) * (j / 2);
        const v = this.ladder(xs, g, k, pre) * comp;
        y = this.dec(6, this.dec(4, this.dec(2, this.dec(0, v, gd, 1.9616), gd, 1.6629), gd, 1.1111), gd, 0.3902);
      }
      this.prevIn = x;
      output[i] = Number.isFinite(y) ? y : 0;
    }
    if (!Number.isFinite(this.s[3])) { this.s.fill(0); this.d.fill(0); }
  }
}

if (typeof registerProcessor === 'function') {
  class MoaLadder extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return LADDER_PARAMS.map((d) => ({ name: d[0], defaultValue: d[1], minValue: d[2], maxValue: d[3], automationRate: d[4] }));
    }
    constructor() {
      super();
      this.core = new LadderCore(sampleRate);
      this.p = {};
    }
    process(inputs, outputs, params) {
      const out = outputs[0][0];
      this.p.cutoff = params.cutoff[0];
      this.p.res = params.res[0];
      this.p.drive = params.drive[0];
      const input = inputs[0] && inputs[0][0];
      this.core.process(input, out, out.length, this.p, params.detune);
      return true;
    }
  }
  registerProcessor('${se}', MoaLadder);
}
`,le=`moa-60`,ue=`
const SAMPLER_PARAMS = [['level', 0.8, 0, 2]];
const SAMPLER_VOICES = 32;
const SAMPLER_DECAY_OFF = 8; // a one-shot decay at this or longer plays the whole sound
const SAMPLER_CHOKE_SECONDS = 0.005;
const SAMPLER_LN1000 = Math.log(1000); // -60 dB

class SamplerCore {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.samples = new Map();
    this.pads = [];
    this.voices = [];
    this.queue = []; // { frame, type, pad, velocity } in time order
    this.frame = 0;
    this.age = 0;
  }

  addSample(id, rate, channels) { this.samples.set(id, { rate, channels, length: channels[0] ? channels[0].length : 0 }); }

  dropSample(id) {
    this.samples.delete(id);
    this.voices = this.voices.filter((v) => v.sample !== id);
  }

  setPad(i, p) { this.pads[i] = p; }

  /** Starts pad i at \`frame\` (an absolute frame; now if missing or past); \`over\` changes its settings for this hit. */
  hit(i, velocity, frame, over) { this.enqueue({ frame: frame === undefined ? this.frame : frame, type: 'hit', pad: i, velocity, over }); }
  release(i, frame) { this.enqueue({ frame: frame === undefined ? this.frame : frame, type: 'release', pad: i }); }
  stopAll() { this.queue = []; for (const v of this.voices) this.choke(v); }

  enqueue(e) {
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].frame > e.frame) i--;
    this.queue.splice(i, 0, e);
  }

  choke(v) {
    v.stage = 'choke';
    v.decay = Math.exp(-1 / (SAMPLER_CHOKE_SECONDS / 6.9 * this.sr));
  }

  start(i, velocity, over) {
    const p = over && this.pads[i] ? Object.assign({}, this.pads[i], over) : this.pads[i];
    if (!p || !p.sample) return;
    const s = this.samples.get(p.sample);
    if (!s || !s.length) return;
    if (p.group) for (const v of this.voices) if (v.group === p.group && v.pad !== i && v.stage !== 'choke') this.choke(v);
    const start = Math.max(0, Math.min(s.length - 1, Math.floor(p.start || 0)));
    const end = Math.max(start + 1, Math.min(s.length, Math.floor(p.end || s.length)));
    const step = Math.pow(2, (p.tune || 0) / 12) * s.rate / this.sr;
    const vel = Math.max(0, Math.min(1, velocity));
    const velLevel = p.velLevel === undefined ? 1 : p.velLevel;
    const amp = (p.level === undefined ? 1 : p.level) * (1 - velLevel + velLevel * Math.pow(vel, 1.5));
    const pan = Math.max(-1, Math.min(1, p.pan || 0));
    const cutoff = (p.cutoff || 20000) * Math.pow(2, (p.velFilter || 0) * (vel - 1) * 4);
    const v = {
      pad: i, sample: p.sample, group: p.group || 0, s, start, end, loop: !!p.loop,
      pos: p.reverse ? end - 1 : start, step: p.reverse ? -step : step,
      amp,
      // a mono sound is panned with equal power; a stereo one is balanced (its centre keeps both sides whole)
      gl: s.channels.length > 1 ? Math.min(1, 1 - pan) : Math.cos((pan + 1) * Math.PI / 4),
      gr: s.channels.length > 1 ? Math.min(1, 1 + pan) : Math.sin((pan + 1) * Math.PI / 4),
      env: 0, stage: 'attack',
      attackInc: p.attack > 0 ? 1 / (p.attack * this.sr) : 1,
      noteOn: p.mode === 'noteon',
      decay: Math.exp(-SAMPLER_LN1000 / (Math.max(0.005, p.decay || SAMPLER_DECAY_OFF) * this.sr)),
      holds: p.mode === 'noteon' || !(p.decay < SAMPLER_DECAY_OFF),
      filtered: cutoff < 19000,
      g: Math.tan(Math.PI * Math.min(cutoff, this.sr * 0.45) / this.sr), k: 2 - 1.9 * Math.max(0, Math.min(1, p.reso || 0)),
      f: [0, 0, 0, 0], age: this.age++,
    };
    if (this.voices.length >= SAMPLER_VOICES) {
      let oldest = 0;
      for (let j = 1; j < this.voices.length; j++) if (this.voices[j].age < this.voices[oldest].age) oldest = j;
      this.voices.splice(oldest, 1);
    }
    this.voices.push(v);
  }

  stop(i) {
    for (const v of this.voices) if (v.pad === i && v.noteOn && (v.stage === 'attack' || v.stage === 'hold')) {
      v.stage = 'decay';
      v.holds = false;
    }
  }

  /** One sample of channel c at position x, by a cubic through the four samples around it. */
  read(data, x, v) {
    const i = Math.floor(x), t = x - i;
    const at = (n) => (n < v.start || n >= v.end ? 0 : data[n]);
    const y0 = at(i - 1), y1 = at(i), y2 = at(i + 1), y3 = at(i + 2);
    const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * t + c2) * t + c1) * t + y1;
  }

  render(L, R, from, to, level) {
    for (let n = this.voices.length - 1; n >= 0; n--) {
      const v = this.voices[n];
      const ch = v.s.channels, left = ch[0], right = ch[1] || ch[0];
      let done = false;
      for (let j = from; j < to; j++) {
        if (v.stage === 'attack') {
          v.env += v.attackInc;
          if (v.env >= 1) { v.env = 1; v.stage = v.holds ? 'hold' : 'decay'; }
        } else if (v.stage === 'decay' || v.stage === 'choke') {
          v.env *= v.decay;
          if (v.env < 1e-4) { done = true; break; }
        }
        let a = this.read(left, v.pos, v), b = right === left ? a : this.read(right, v.pos, v);
        if (v.filtered) {
          // two state-variable low-passes (trapezoidal), one per channel
          const g = v.g, k = v.k, h = 1 / (1 + g * (g + k)), f = v.f;
          let v1 = (f[0] + g * (a - f[1])) * h, v2 = f[1] + g * v1;
          f[0] = 2 * v1 - f[0]; f[1] = 2 * v2 - f[1]; a = v2;
          v1 = (f[2] + g * (b - f[3])) * h; v2 = f[3] + g * v1;
          f[2] = 2 * v1 - f[2]; f[3] = 2 * v2 - f[3]; b = v2;
        }
        const e = v.env * v.amp * level;
        L[j] += a * e * v.gl;
        R[j] += b * e * v.gr;
        v.pos += v.step;
        if (v.step > 0 ? v.pos >= v.end : v.pos < v.start) {
          if (v.loop) v.pos += v.step > 0 ? v.start - v.end : v.end - v.start;
          else { done = true; break; }
        }
      }
      if (done) this.voices.splice(n, 1);
    }
  }

  /** Renders \`len\` frames into L and R (cleared first), starting the queued hits and releases on their frames. */
  process(L, R, len, level) {
    L.fill(0); R.fill(0);
    const end = this.frame + len;
    let at = 0;
    while (this.queue.length && this.queue[0].frame < end) {
      const e = this.queue.shift();
      const j = Math.max(0, e.frame - this.frame);
      if (j > at) { this.render(L, R, at, j, level); at = j; }
      if (e.type === 'hit') this.start(e.pad, e.velocity, e.over);
      else this.stop(e.pad);
    }
    if (at < len) this.render(L, R, at, len, level);
    this.frame = end;
  }

  /** What is playing: [pad, position 0..1 through its sound, envelope] per voice. */
  view() {
    return this.voices.map((v) => [v.pad, (v.pos - v.start) / Math.max(1, v.end - v.start), v.env]);
  }
}

if (typeof registerProcessor === 'function') {
  class Moa60 extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return SAMPLER_PARAMS.map((d) => ({ name: d[0], defaultValue: d[1], minValue: d[2], maxValue: d[3], automationRate: 'k-rate' }));
    }
    constructor() {
      super();
      this.core = new SamplerCore(sampleRate);
      this.core.frame = currentFrame;
      this.since = 0;
      const frameOf = (when) => (when === undefined ? undefined : Math.round(when * sampleRate));
      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m) return;
        if (m.type === 'sample') this.core.addSample(m.id, m.rate, m.channels);
        else if (m.type === 'drop') this.core.dropSample(m.id);
        else if (m.type === 'pad') this.core.setPad(m.pad, m.settings);
        else if (m.type === 'hit') this.core.hit(m.pad, m.velocity, m.when === undefined && m.delay > 0 ? currentFrame + Math.round(m.delay * sampleRate) : frameOf(m.when), m.over);
        else if (m.type === 'release') this.core.release(m.pad, frameOf(m.when));
        else if (m.type === 'stopAll') this.core.stopAll();
      };
      this.port.postMessage({ type: 'ready' }); // the device sends its sounds and pads when it hears this
    }
    process(inputs, outputs, params) {
      const out = outputs[0];
      this.core.frame = currentFrame;
      this.core.process(out[0], out[1], out[0].length, params.level[0]);
      this.since += out[0].length;
      if (this.since >= sampleRate / 30) {
        this.since = 0;
        this.port.postMessage({ type: 'view', voices: this.core.view() });
      }
      return true;
    }
  }
  registerProcessor('${le}', Moa60);
}
`,de=`moa-string`,fe=`
const STRING_PARAMS = [['level', 0.5, 0, 2], ['tone', 3500, 300, 12000]];

class StringCore {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.n = 0;
    this.omega = new Float64Array(0); this.sigma = new Float64Array(0); this.pick = new Float64Array(0);
    this.strainK = new Float64Array(0); this.palm = new Float64Array(0); this.mute = new Float64Array(0);
    this.re = new Float64Array(0); this.im = new Float64Array(0);
    this.stretch = 0;
    this.muted = false;
    this.muteScale = 1;
    this.pitchScale = 1;
    this.lp = [0, 0, 0, 0]; // pickup resonance biquad state
  }

  /** The string's modes: frequencies (Hz), decay rates (1/s), pickup weights, strain weights (n pi / L)^2 / 4. */
  configure(m) {
    const n = m.hz.length;
    const grow = (a) => { const b = new Float64Array(n); b.set(a.subarray(0, Math.min(n, a.length))); return b; };
    this.re = grow(this.re); this.im = grow(this.im); // modes keep their motion through a change of fret or tension
    this.omega = Float64Array.from(m.hz, (f) => 2 * Math.PI * f);
    this.sigma = Float64Array.from(m.sigma);
    this.pick = Float64Array.from(m.pickup);
    this.strainK = Float64Array.from(m.strainK);
    this.stretch = m.stretch;
    this.palm = m.palm ? Float64Array.from(m.palm) : new Float64Array(n);
    this.mute = m.mute ? Float64Array.from(m.mute) : new Float64Array(n);
    this.n = n;
  }

  /** A pluck: the hand grabs (each mode keeps grab[k] of itself), then lets go with these displacements (m). */
  pluck(amps, grab) {
    for (let k = 0; k < this.n; k++) {
      const g = grab ? grab[k] : 1;
      this.re[k] = this.re[k] * g + (amps[k] || 0);
      this.im[k] *= g;
    }
  }

  setMuted(on, hard) { this.muted = !!on; this.muteScale = on && hard ? 8 : 1; }

  process(out, len, p) {
    const re = this.re, im = this.im, sr = this.sr;
    // the modes still moving: up to the highest whose velocity is above 1e-7 m/s (far below hearing)
    let n = 0;
    for (let k = this.n - 1; k >= 0; k--) {
      const v2 = (re[k] * re[k] + im[k] * im[k]) * this.omega[k] * this.omega[k];
      if (v2 > 1e-14) { n = k + 1; break; }
      re[k] = 0; im[k] = 0;
    }
    const z0 = this.lp;
    if (n === 0 && Math.abs(z0[0]) + Math.abs(z0[1]) + Math.abs(z0[2]) + Math.abs(z0[3]) < 1e-9) {
      out.fill(0); // silent: nothing to compute
      z0[0] = z0[1] = z0[2] = z0[3] = 0;
      this.pitchScale = 1;
      return;
    }
    // tension modulation from the present motion
    let strain = 0;
    for (let k = 0; k < n; k++) strain += this.strainK[k] * (re[k] * re[k] + im[k] * im[k]);
    const s = Math.sqrt(1 + Math.min(0.5, this.stretch * strain));
    this.pitchScale = s;
    if (!this.cr || this.cr.length < this.n) { const m = this.n; this.cr = new Float64Array(m); this.ci = new Float64Array(m); this.vw = new Float64Array(m); } // sized once: no allocation per block
    const cr = this.cr, ci = this.ci, vw = this.vw;
    for (let k = 0; k < n; k++) {
      const loss = this.sigma[k] + this.palm[k] + (this.muted ? this.mute[k] * this.muteScale : 0);
      const r = Math.exp(-loss / sr);
      const w = this.omega[k] * s;
      cr[k] = r * Math.cos(w / sr);
      ci[k] = r * Math.sin(w / sr);
      vw[k] = -w * this.pick[k]; // velocity of Re(z) is -w Im(z)
    }
    // the pickup's resonance: an RBJ low-pass at the tone frequency, Q 1.4
    const w0 = 2 * Math.PI * Math.min(p.tone, 0.45 * sr) / sr, alpha = Math.sin(w0) / (2 * 1.4), cw = Math.cos(w0);
    const a0 = 1 + alpha, b0 = (1 - cw) / 2 / a0, b1 = (1 - cw) / a0, a1 = -2 * cw / a0, a2 = (1 - alpha) / a0;
    const z = this.lp;
    for (let i = 0; i < len; i++) {
      let v = 0;
      for (let k = 0; k < n; k++) {
        const x = re[k], y = im[k];
        re[k] = x * cr[k] - y * ci[k];
        im[k] = x * ci[k] + y * cr[k];
        v += vw[k] * im[k];
      }
      const y = b0 * v + b1 * z[0] + b0 * z[1] - a1 * z[2] - a2 * z[3];
      z[1] = z[0]; z[0] = v; z[3] = z[2]; z[2] = y;
      const o = y * 1.2 * p.level;
      out[i] = o > 3 ? 1 : o < -3 ? -1 : o * (27 + o * o) / (27 + 9 * o * o);
    }
  }

  /** The modes' present amplitudes (m), for drawing the string. */
  amplitudes(count) {
    const a = new Float32Array(Math.min(count, this.n));
    for (let k = 0; k < a.length; k++) a[k] = Math.hypot(this.re[k], this.im[k]);
    return a;
  }
}

if (typeof registerProcessor === 'function') {
  class MoaString extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return STRING_PARAMS.map((d) => ({ name: d[0], defaultValue: d[1], minValue: d[2], maxValue: d[3], automationRate: 'k-rate' }));
    }
    constructor(options) {
      super();
      this.core = new StringCore(sampleRate);
      const cfg = options && options.processorOptions && options.processorOptions.config;
      if (cfg && cfg.hz) this.core.configure(cfg); // the string as it was set up before audio started
      this.p = {};
      this.since = 0;
      this.waiting = [];
      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m) return;
        if (m.type === 'configure') this.core.configure(m);
        else if (m.type === 'pluck' && m.delay > 0) this.waiting.push({ due: currentFrame + Math.round(m.delay * sampleRate), m });
        else if (m.type === 'pluck') this.core.pluck(m.amps, m.grab);
        else if (m.type === 'mute') {
          this.core.setMuted(m.on, m.hard);
          if (m.on) this.waiting = [];
        }
      };
    }
    process(inputs, outputs, params) {
      const out = outputs[0][0];
      if (this.waiting.length) {
        const end = currentFrame + out.length;
        for (const w of this.waiting) if (w.due < end) { this.core.setMuted(false); this.core.pluck(w.m.amps, w.m.grab); }
        this.waiting = this.waiting.filter((w) => w.due >= end);
      }
      this.p.level = params.level[0];
      this.p.tone = params.tone[0];
      this.core.process(out, out.length, this.p);
      this.since += out.length;
      if (this.since >= sampleRate / 30) {
        this.since = 0;
        this.port.postMessage({ amps: this.core.amplitudes(48), pitchScale: this.core.pitchScale });
      }
      return true;
    }
  }
  registerProcessor('${de}', MoaString);
}
`,pe=`moa-drum`,me=`
const DRUM_PARAMS = [['level', 1, 0, 4]];

class DrumCore {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.n = 0;
    this.re = new Float64Array(0); this.im = new Float64Array(0);
    this.omega = new Float64Array(0); this.sigma = new Float64Array(0); this.mic = new Float64Array(0);
    this.strainK = new Float64Array(0); this.wireW = new Float64Array(0); this.dampK = new Float64Array(0);
    this.stretch = 0; this.pitchScale = 1;
    this.wires = null; this.cascade = null; this.band = null;
    this.damping = 0; this.contactLevel = 0;
    this.click = []; this.clickAt = 0; this.lastClick = 0;
    this.burst = 0; this.burstDecay = 0;
    this.rattle = 0; this.bandEnv = 0;
    this.seed = 22222;
    this.bp = [0, 0, 0, 0, 0, 0, 0, 0]; // two biquads: the wires' band, or the cymbal's top band
    this.quiet = true;
  }

  rand() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 2147483648 - 1;
  }

  configure(m) {
    const n = m.hz.length;
    const grow = (a) => { const b = new Float64Array(n); b.set(a.subarray(0, Math.min(n, a.length))); return b; };
    this.re = grow(this.re); this.im = grow(this.im);
    this.omega = Float64Array.from(m.hz, (f) => 2 * Math.PI * f);
    this.sigma = Float64Array.from(m.sigma);
    this.mic = Float64Array.from(m.mic);
    this.strainK = m.strainK ? Float64Array.from(m.strainK) : new Float64Array(n);
    this.dampK = m.dampK ? Float64Array.from(m.dampK) : new Float64Array(n).fill(1);
    this.stretch = m.stretch || 0;
    this.wires = m.wires || null;
    this.wireW = m.wires ? Float64Array.from(m.wires.weights) : new Float64Array(n);
    this.cascade = m.cascade || null;
    this.band = m.band || null;
    this.n = n;
    if (m.damp) this.setDamp(m.damp.sigma, m.damp.contact);
    this.setFilter();
  }

  /** The band-pass for the wires (or the high-pass for a cymbal's top): RBJ coefficients. */
  setFilter() {
    const f = this.wires ? this.wires.hz : this.band ? this.band.hz : 1000;
    const w0 = 2 * Math.PI * Math.min(f, 0.45 * this.sr) / this.sr, cw = Math.cos(w0), sw = Math.sin(w0);
    const q = this.wires ? 0.9 : 0.7071, alpha = sw / (2 * q), a0 = 1 + alpha;
    if (this.wires) this.co = [alpha / a0, 0, -alpha / a0, -2 * cw / a0, (1 - alpha) / a0];
    else this.co = [(1 + cw) / 2 / a0, -(1 + cw) / a0, (1 + cw) / 2 / a0, -2 * cw / a0, (1 - alpha) / a0];
  }

  /** A strike: each mode's velocity (m/s), the click's amplitude and contact time (s), and a burst of contact noise. */
  hit(v, click, tau, burst, burstDecay) {
    for (let k = 0; k < this.n; k++) {
      const dv = v[k] || 0;
      if (dv) this.im[k] -= dv / this.omega[k];
    }
    const len = Math.max(2, Math.round(tau * this.sr));
    this.click = new Float64Array(len + 1);
    for (let i = 0; i < len; i++) this.click[i] = click * Math.sin(Math.PI * i / len);
    this.clickAt = 0;
    if (burst) { this.burst = Math.max(this.burst, burst); this.burstDecay = Math.exp(-1 / Math.max(1e-4, burstDecay) / this.sr); }
    this.quiet = false;
  }

  /** Extra damping on every mode (s^-1), and the noise of plates touching while it is on. */
  setDamp(sigma, contact) { this.damping = sigma; this.contactLevel = contact || 0; }

  process(out, len, p) {
    const n = this.n, re = this.re, im = this.im, sr = this.sr;
    if (this.quiet && this.clickAt >= this.click.length && this.burst < 1e-6) { out.fill(0); return; }
    let strain = 0, energy = 0;
    for (let k = 0; k < n; k++) {
      const a2 = re[k] * re[k] + im[k] * im[k];
      strain += this.strainK[k] * a2;
      energy += a2 * this.mic[k] * this.mic[k];
    }
    const s = Math.sqrt(1 + Math.min(0.5, this.stretch * strain));
    this.pitchScale = s;
    // the cymbal's cascade: energy handed up band by band, from the top down so it climbs one band a block
    if (this.cascade) {
      const c = this.cascade, edges = c.edges;
      for (let b = edges.length - 3; b >= 0; b--) {
        const from = edges[b], to = edges[b + 1], end = Math.min(n, edges[b + 2]);
        if (to >= end) continue;
        let e = 0;
        for (let k = from; k < to; k++) { const w = this.omega[k]; e += (re[k] * re[k] + im[k] * im[k]) * w * w; }
        const share = Math.min(0.5, c.rate * Math.pow(e / c.refs[b], 1.5) * len / sr);
        if (share < 1e-9) continue;
        const keep = Math.sqrt(1 - share);
        for (let k = from; k < to; k++) { re[k] *= keep; im[k] *= keep; }
        const each = (share * e) / (end - to);
        for (let k = to; k < end; k++) {
          const amp = Math.sqrt(each) / this.omega[k], phase = Math.PI * this.rand();
          re[k] += amp * Math.cos(phase); im[k] += amp * Math.sin(phase);
        }
      }
    }
    if (!this.cr || this.cr.length !== n) { this.cr = new Float64Array(n); this.ci = new Float64Array(n); }
    const cr = this.cr, ci = this.ci, mic = this.mic, ww = this.wireW;
    for (let k = 0; k < n; k++) {
      const r = Math.exp(-(this.sigma[k] + this.damping * this.dampK[k]) / sr), w = this.omega[k] * s / sr;
      cr[k] = r * Math.cos(w); ci[k] = r * Math.sin(w);
    }
    const co = this.co, z = this.bp, wires = this.wires, band = this.band;
    // the top band follows the level of the highest modes
    let top = 0;
    if (band) { for (let k = Math.floor(n * 0.75); k < n; k++) top += (re[k] * re[k] + im[k] * im[k]) * mic[k] * mic[k]; top = Math.sqrt(top) * band.gain; }
    const att = Math.exp(-1 / (0.0007 * sr)), rel = Math.exp(-1 / (0.02 * sr));
    for (let i = 0; i < len; i++) {
      let y = 0, acc = 0;
      for (let k = 0; k < n; k++) {
        const x = re[k], q = im[k];
        re[k] = x * cr[k] - q * ci[k];
        im[k] = x * ci[k] + q * cr[k];
        y += mic[k] * re[k];
        if (wires) acc += ww[k] * re[k];
      }
      // the stick's click: the derivative of the contact force
      if (this.clickAt < this.click.length) {
        const c = this.click[this.clickAt++];
        y += (c - this.lastClick) * sr * 0.001;
        this.lastClick = c;
      } else this.lastClick = 0;
      let noise = 0;
      if (wires) {
        const over = Math.max(0, Math.abs(acc) - wires.threshold) / wires.threshold;
        this.rattle = over > this.rattle ? att * this.rattle + (1 - att) * over : rel * this.rattle;
        noise += this.rattle * wires.gain;
      }
      if (band) { this.bandEnv = 0.999 * this.bandEnv + 0.001 * top; noise += this.bandEnv; }
      if (this.contactLevel) noise += this.contactLevel * Math.min(1, Math.sqrt(energy) * 0.02);
      let filtered = 0;
      if (noise > 1e-7) {
        const x = this.rand() * noise;
        const b = co[0] * x + co[1] * z[0] + co[2] * z[1] - co[3] * z[2] - co[4] * z[3];
        z[1] = z[0]; z[0] = x; z[3] = z[2]; z[2] = b;
        filtered = b;
      }
      if (this.burst > 1e-6) { filtered += this.rand() * this.burst; this.burst *= this.burstDecay; }
      const o = (y + filtered) * p.level;
      out[i] = o > 3 ? 1 : o < -3 ? -1 : o * (27 + o * o) / (27 + 9 * o * o);
    }
    let alive = false;
    for (let k = 0; k < n; k++) {
      if (Math.abs(re[k]) < 1e-11 && Math.abs(im[k]) < 1e-11) { re[k] = 0; im[k] = 0; } else alive = true;
    }
    this.quiet = !alive && this.rattle < 1e-6 && this.bandEnv < 1e-7;
  }

  /** The modes' present amplitudes (m), for drawing the head. */
  amplitudes(count) {
    const a = new Float32Array(Math.min(count, this.n));
    for (let k = 0; k < a.length; k++) a[k] = Math.hypot(this.re[k], this.im[k]);
    return a;
  }
}

if (typeof registerProcessor === 'function') {
  class MoaDrum extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return DRUM_PARAMS.map((d) => ({ name: d[0], defaultValue: d[1], minValue: d[2], maxValue: d[3], automationRate: 'k-rate' }));
    }
    constructor(options) {
      super();
      this.core = new DrumCore(sampleRate);
      const cfg = options && options.processorOptions && options.processorOptions.config;
      if (cfg && cfg.hz) this.core.configure(cfg);
      this.p = {};
      this.since = 0;
      this.waiting = [];
      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m) return;
        if (m.type === 'configure') this.core.configure(m);
        else if (m.type === 'hit' && m.delay > 0) this.waiting.push({ due: currentFrame + Math.round(m.delay * sampleRate), m });
        else if (m.type === 'hit') this.core.hit(m.v, m.click, m.tau, m.burst, m.burstDecay);
        else if (m.type === 'damp') this.core.setDamp(m.sigma, m.contact);
      };
    }
    process(inputs, outputs, params) {
      const out = outputs[0][0];
      if (this.waiting.length) {
        const end = currentFrame + out.length;
        for (const w of this.waiting) if (w.due < end) this.core.hit(w.m.v, w.m.click, w.m.tau, w.m.burst, w.m.burstDecay);
        this.waiting = this.waiting.filter((w) => w.due >= end);
      }
      this.p.level = params.level[0];
      this.core.process(out, out.length, this.p);
      this.since += out.length;
      if (this.since >= sampleRate / 30) {
        this.since = 0;
        this.port.postMessage({ amps: this.core.amplitudes(48), pitchScale: this.core.pitchScale });
      }
      return true;
    }
  }
  registerProcessor('${pe}', MoaDrum);
}
`,he=`moa-tone`,ge=`
const TONE_PARAMS = [['level', 0.7, 0, 2]];
const TONE_VOICES = 8;
const TONE_WAVES = ['square', 'pulse25', 'pulse12', 'saw', 'triangle', 'sine'];

function toneBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/** One sample of a wave at phase p (0..1) moving dt a sample. */
function toneWave(wave, p, dt) {
  switch (wave) {
    case 'sine': return Math.sin(2 * Math.PI * p);
    case 'triangle': return 1 - 4 * Math.abs(p - 0.5);
    case 'saw': return 2 * p - 1 - toneBlep(p, dt);
    default: {
      const w = wave === 'pulse25' ? 0.25 : wave === 'pulse12' ? 0.125 : 0.5;
      let y = p < w ? 1 : -1;
      y += toneBlep(p, dt);
      let q = p - w; if (q < 0) q += 1;
      y -= toneBlep(q, dt);
      return y - (2 * w - 1); // no DC: a thin pulse sits around zero
    }
  }
}

const TONE_DEFAULT = { w1: 'square', w2: 'square', i2: 12, mix2: 0, a: 0.005, d: 0.3, s: 0.6, r: 0.2, vib: 0, vibRate: 5.5, vibDelay: 0.3, gain: 1 };

class ToneCore {
  constructor(sampleRate, role) {
    this.sr = sampleRate;
    this.role = role || 'voices';
    this.p = Object.assign({}, TONE_DEFAULT);
    this.voices = [];
    this.drums = [];
    this.queue = [];
    this.frame = 0;
    this.age = 0;
    this.seed = 22222;
  }

  setPreset(p) { this.p = Object.assign({}, TONE_DEFAULT, p); }

  enqueue(e) {
    if (e.frame === undefined) e.frame = this.frame;
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].frame > e.frame) i--;
    this.queue.splice(i, 0, e);
  }

  noteOn(note, velocity, frame) { this.enqueue({ type: 'on', note, velocity, frame }); }
  noteOff(note, frame) { this.enqueue({ type: 'off', note, frame }); }
  drum(kind, velocity, frame) { this.enqueue({ type: 'drum', kind, velocity, frame }); }
  allOff() { this.queue = []; for (const v of this.voices) v.stage = 'release'; }

  start(note, velocity) {
    // the same key again restarts its voice; otherwise a free one, or the oldest
    let v = this.voices.find((x) => x.note === note);
    if (!v) {
      if (this.voices.length >= TONE_VOICES) {
        let o = 0;
        for (let j = 1; j < this.voices.length; j++) if (this.voices[j].age < this.voices[o].age) o = j;
        this.voices.splice(o, 1);
      }
      v = { note, p1: 0, p2: 0, env: 0, vibPhase: 0 };
      this.voices.push(v);
    }
    Object.assign(v, { velocity: Math.max(0, Math.min(1, velocity)), stage: 'attack', t: 0, age: this.age++, hz: 440 * Math.pow(2, (note - 69) / 12) });
  }

  stop(note) { for (const v of this.voices) if (v.note === note && v.stage !== 'release') v.stage = 'release'; }

  hit(kind, velocity) {
    if (this.drums.length > 16) this.drums.shift();
    this.drums.push({ kind, velocity: Math.max(0, Math.min(1, velocity)), t: 0, phase: 0, lp: 0, prev: 0 });
  }

  noise() { this.seed = (this.seed * 196314165 + 907633515) >>> 0; return this.seed / 2147483648 - 1; }

  renderVoices(out, from, to, level) {
    const p = this.p, sr = this.sr;
    const attack = 1 / Math.max(1, p.a * sr), decay = Math.exp(-1 / Math.max(1, (p.d / 4) * sr)), release = Math.exp(-1 / Math.max(1, (p.r / 4) * sr));
    const ratio2 = Math.pow(2, p.i2 / 12);
    for (let n = this.voices.length - 1; n >= 0; n--) {
      const v = this.voices[n];
      let done = false;
      for (let j = from; j < to; j++) {
        if (v.stage === 'attack') { v.env += attack; if (v.env >= 1) { v.env = 1; v.stage = 'decay'; } }
        else if (v.stage === 'decay') v.env = p.s + (v.env - p.s) * decay;
        else { v.env *= release; if (v.env < 1e-4) { done = true; break; } }
        v.t += 1 / sr;
        // the vibrato fades in after its delay
        const vibAmt = p.vib * Math.min(1, Math.max(0, (v.t - p.vibDelay) / 0.3));
        v.vibPhase += p.vibRate / sr;
        if (v.vibPhase >= 1) v.vibPhase -= 1;
        const hz = v.hz * Math.pow(2, (vibAmt * Math.sin(2 * Math.PI * v.vibPhase)) / 1200);
        const dt1 = Math.min(0.5, hz / sr), dt2 = Math.min(0.5, (hz * ratio2) / sr);
        const y = toneWave(p.w1, v.p1, dt1) * (1 - p.mix2) + toneWave(p.w2, v.p2, dt2) * p.mix2;
        v.p1 += dt1; if (v.p1 >= 1) v.p1 -= 1;
        v.p2 += dt2; if (v.p2 >= 1) v.p2 -= 1;
        out[j] += y * v.env * (0.35 + 0.65 * v.velocity) * p.gain * level * 0.3;
      }
      if (done) this.voices.splice(n, 1);
    }
  }

  renderDrums(out, from, to, level) {
    const sr = this.sr;
    for (let n = this.drums.length - 1; n >= 0; n--) {
      const d = this.drums[n];
      let done = false;
      for (let j = from; j < to; j++) {
        const t = d.t;
        let y = 0, len = 0.3;
        if (d.kind === 'kick') {
          len = 0.35;
          const hz = 50 + 110 * Math.exp(-t / 0.04);
          d.phase += hz / sr;
          y = Math.sin(2 * Math.PI * d.phase) * Math.exp(-t / 0.12) * 1.2;
        } else if (d.kind === 'snare') {
          len = 0.25;
          d.phase += 185 / sr;
          y = (this.noise() * 0.7 * Math.exp(-t / 0.06) + Math.sin(2 * Math.PI * d.phase) * 0.5 * Math.exp(-t / 0.03));
        } else if (d.kind === 'hat') {
          len = 0.08;
          const x = this.noise();
          y = (x - d.prev) * 0.35 * Math.exp(-t / 0.018); // a difference: only the top of the noise
          d.prev = x;
        } else if (d.kind === 'clap') {
          len = 0.25;
          // three quick bursts (the hands), then the room
          const bursts = t < 0.03 ? Math.exp(-(t % 0.01) / 0.003) : Math.exp(-(t - 0.03) / 0.07);
          d.lp += 0.5 * (this.noise() - d.lp);
          y = (this.noise() - d.lp) * 0.8 * bursts;
        } else if (d.kind === 'wood') {
          len = 0.06;
          d.phase += 1750 / sr;
          y = Math.sin(2 * Math.PI * d.phase) * 0.6 * Math.exp(-t / 0.012);
        } else if (d.kind === 'bell') {
          len = 0.3;
          d.phase += 800 / sr;
          const p2 = (d.phase * 540 / 800) % 1;
          y = ((d.phase % 1 < 0.5 ? 1 : -1) + (p2 < 0.5 ? 1 : -1)) * 0.18 * Math.exp(-t / 0.07);
        }
        out[j] += y * d.velocity * level * 0.35;
        d.t += 1 / sr;
        if (d.t > len) { done = true; break; }
      }
      if (done) this.drums.splice(n, 1);
    }
  }

  render(out, from, to, level) {
    if (this.role === 'drums') this.renderDrums(out, from, to, level);
    else this.renderVoices(out, from, to, level);
  }

  /** Renders \`len\` frames into out (cleared first), starting the queued events on their frames. */
  process(out, len, level) {
    out.fill(0);
    const end = this.frame + len;
    let at = 0;
    while (this.queue.length && this.queue[0].frame < end) {
      const e = this.queue.shift();
      const j = Math.max(0, e.frame - this.frame);
      if (j > at) { this.render(out, at, j, level); at = j; }
      if (e.type === 'on') this.start(e.note, e.velocity);
      else if (e.type === 'off') this.stop(e.note);
      else this.hit(e.kind, e.velocity);
    }
    if (at < len) this.render(out, at, len, level);
    this.frame = end;
  }
}

if (typeof registerProcessor === 'function') {
  class MoaTone extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return TONE_PARAMS.map((d) => ({ name: d[0], defaultValue: d[1], minValue: d[2], maxValue: d[3], automationRate: 'k-rate' }));
    }
    constructor(options) {
      super();
      const o = (options && options.processorOptions) || {};
      this.core = new ToneCore(sampleRate, o.role);
      if (o.preset) this.core.setPreset(o.preset);
      const frameOf = (when) => (when === undefined ? undefined : Math.round(when * sampleRate));
      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m) return;
        if (m.type === 'preset') this.core.setPreset(m.preset);
        else if (m.type === 'on') this.core.noteOn(m.note, m.velocity, frameOf(m.when));
        else if (m.type === 'off') this.core.noteOff(m.note, frameOf(m.when));
        else if (m.type === 'drum') this.core.drum(m.kind, m.velocity, frameOf(m.when));
        else if (m.type === 'allOff') this.core.allOff();
      };
    }
    process(inputs, outputs, params) {
      const out = outputs[0][0];
      this.core.frame = currentFrame;
      this.core.process(out, out.length, params.level[0]);
      return true;
    }
  }
  registerProcessor('${he}', MoaTone);
}
`,_e=`moa-granular`,ve=`
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
  registerProcessor('${_e}', MoaGranular);
}
`,ye=n.map(e=>r[e]),be=`
const M26_SQ_STEPS = 16;
const M26_SQ_SCALES = ${JSON.stringify(ye)};
const M26_SQ_RANGES = [1, 2, 4];

class M26Seq {
  constructor(sr, random) {
    this.sr = sr;
    this.random = random || Math.random;
    this.steps = new Float64Array(M26_SQ_STEPS);
    this.gates = new Int32Array(M26_SQ_STEPS);
    this.n = 16; this.dir = 0; this.skip = 1; this.gateMode = false; this.midi = false;
    this.inc = 0; this.fm = 0; this.pw = 0.5; this.notes = M26_SQ_SCALES[0]; this.range = 2;
    this.extPatched = false; this.ssPatched = false;
    // position: the step whose outputs are current; pending: the next advance lands on the first step
    this.pos = 0; this.pending = true; this.ping = 1;
    this.running = false;
    this.phase = 0; this.high = false;
    this.prev = { ext: false, start: false, stop: false, ss: false, step: false, reset: false };
    this.stepReq = 0; this.tickReq = 0;
    this.sinceTick = 0; this.tickLen = 0.1 * sr;
    // outputs (volts)
    this.a = 0; this.b = 0; this.bus = [0, 0, 0]; this.pos1 = 0; this.cgate1 = 0; this.clk = 0;
  }

  /** Per block: the params (ids "sq.*") and which of the clock and start/stop inputs have cords in them. */
  block(p, extPatched, ssPatched) {
    for (let i = 0; i < M26_SQ_STEPS; i++) {
      this.steps[i] = p['sq.step.' + (i + 1)];
      this.gates[i] = Math.round(p['sq.gate.' + (i + 1)]);
    }
    this.n = p['sq.mode'] > 0.5 ? 8 : 16;
    if (this.pos >= this.n) this.pos %= this.n;
    this.dir = Math.round(p['sq.dir']);
    if (this.pending) this.pos = this.dir === 1 ? this.n - 1 : 0; // shows the step it will start on
    this.skip = Math.round(p['sq.skip']); // 0 skip, 1 off, 2 reset
    this.gateMode = p['sq.trig'] > 0.5;
    this.inc = p['sq.rate'] / this.sr;
    this.fm = p['sq.fm'];
    this.pw = p['sq.pw'];
    this.notes = M26_SQ_SCALES[Math.round(p['sq.scale'])] || M26_SQ_SCALES[0];
    this.range = M26_SQ_RANGES[Math.round(p['sq.range'])] || 2;
    this.midi = p['sq.sync'] > 0.5;
    this.extPatched = extPatched;
    this.ssPatched = ssPatched;
  }

  first() {
    this.ping = 1;
    return this.dir === 1 ? this.n - 1 : 0;
  }

  next(p) {
    const n = this.n;
    switch (this.dir) {
      case 1: return (p - 1 + n) % n;
      case 2: {
        if (n < 2) return 0;
        let q = p + this.ping;
        if (q >= n) { this.ping = -1; q = n - 2; }
        else if (q < 0) { this.ping = 1; q = 1; }
        return q;
      }
      case 3: return Math.min(n - 1, Math.floor(this.random() * n));
      default: return (p + 1) % n;
    }
  }

  advance() {
    let p;
    if (this.pending) { p = this.first(); this.pending = false; }
    else p = this.next(this.pos);
    // a step on bus 3 skips on, or sends the sequence back to its first step
    if (this.gates[p] === 3 && this.skip === 0) {
      let q = p;
      for (let k = 0; k < this.n && this.gates[q] === 3; k++) q = this.next(q);
      if (this.gates[q] !== 3) p = q;
    } else if (this.gates[p] === 3 && this.skip === 2) {
      const f = this.first();
      if (p !== f) p = f;
    }
    this.pos = p;
  }

  /** Starts or stops it; starting fires the internal clock on the next sample, so the first step plays at once. */
  setRunning(on) {
    if (on && !this.running && !this.extPatched && !this.midi) this.phase = 1;
    this.running = on;
  }

  message(m) {
    if (!m) return;
    if (m.type === 'sqtick') { this.tickReq++; return; }
    if (m.type !== 'sq') return;
    switch (m.action) {
      case 'run': this.setRunning(true); break;
      case 'stop': this.setRunning(false); break;
      case 'toggle': this.setRunning(!this.running); break;
      case 'step': this.stepReq++; break;
      case 'reset': this.pos = this.first(); this.pending = true; break;
      case 'jump': {
        const i = Math.max(0, Math.floor(m.index || 0));
        this.pos = i % this.n;
        this.pending = false;
        break;
      }
    }
  }

  /** One sample: input voltages in, outputs left in this.a, b, bus, pos1, cgate1 and clk. */
  tick(fmV, pwmV, extV, startV, stopV, ssV, stepV, resetV) {
    const pr = this.prev;
    // start / stop
    const start = startV > 2.5, stop = stopV > 2.5, ss = ssV > 2.5;
    if (start && !pr.start) this.setRunning(true);
    if (stop && !pr.stop) this.setRunning(false);
    if (this.ssPatched) {
      if (this.gateMode) this.setRunning(ss);
      else if (ss && !pr.ss) this.setRunning(!this.running);
    }
    pr.start = start; pr.stop = stop; pr.ss = ss;
    // reset and step inputs
    const reset = resetV > 2.5, step = stepV > 2.5;
    if (reset && !pr.reset) { this.pos = this.first(); this.pending = true; }
    if (step && !pr.step) this.stepReq++;
    pr.reset = reset; pr.step = step;

    // the clock
    let rise = false;
    const pw = Math.min(0.98, Math.max(0.02, this.pw + pwmV / 10));
    if (this.extPatched) {
      const hi = extV > 2.5;
      rise = hi && !pr.ext;
      pr.ext = hi;
      this.high = hi;
    } else {
      this.phase += this.inc * Math.pow(2, this.fm * fmV);
      if (this.phase >= 1) { this.phase -= Math.floor(this.phase); rise = true; }
      this.high = this.phase < pw;
    }
    if (this.midi) {
      // MIDI ticks step it; the clock is high for the pulse width of the time between ticks
      rise = false;
      this.sinceTick++;
      if (this.tickReq > 0) {
        this.tickReq = 0;
        if (this.sinceTick > 8 && this.sinceTick < 4 * this.sr) this.tickLen = this.sinceTick;
        this.sinceTick = 0;
        rise = true;
      }
      this.high = this.sinceTick < pw * this.tickLen;
    }
    if (rise && this.running) this.advance();
    while (this.stepReq > 0) { this.stepReq--; this.advance(); }

    // outputs
    const p = this.pos;
    this.a = this.steps[p] * 10;
    this.b = this.n === 8 ? this.steps[p + 8] * 10 : this.a;
    const g = this.running ? this.gates[p] : 0;
    this.bus[0] = g === 1 ? 10 : 0;
    this.bus[1] = g === 2 ? 10 : 0;
    this.bus[2] = g === 3 ? 10 : 0;
    this.cgate1 = g === 1 && this.high ? 10 : 0;
    this.pos1 = this.running && p === 0 ? 10 : 0;
    this.clk = this.high ? 10 : 0;
  }

  /** A quantizer: 0-10 V in, a note of the scale over the range out (1 V per octave), plus the CV input. */
  quant(v, cv) {
    const semis = Math.min(10, Math.max(0, v)) / 10 * this.range * 12;
    const oct = Math.floor(semis / 12);
    const r = semis - oct * 12;
    let best = 0, dist = 99;
    for (const s of this.notes) { const d = Math.abs(r - s); if (d < dist - 1e-9) { dist = d; best = s; } }
    if (Math.abs(r - 12) < dist - 1e-9) best = 12;
    return (oct * 12 + best) / 12 + cv;
  }
}
`,xe=`moa-2600`,Se=[...h,...g].map(e=>[e.id,e.def,e.min,e.max]),Ce=ne.map(e=>({id:e.id,normal:e.normal??null})),we=`
const M26_TWO_PI = Math.PI * 2;
// name, default, min, max
const M26_PARAM_DEFS = ${JSON.stringify(Se)};
const M26_DEFAULTS = {};
for (const d of M26_PARAM_DEFS) M26_DEFAULTS[d[0]] = d[1];
const M26_OUTPUTS = ${JSON.stringify(te)};
const M26_INPUTS = ${JSON.stringify(Ce)};
const M26_O = {};
M26_OUTPUTS.forEach((id, i) => { M26_O[id] = i; });
// three constant signals after the outputs: -10 V, +10 V and silence (for inputs with no normal)
const M26_NEG10 = M26_OUTPUTS.length, M26_POS10 = M26_NEG10 + 1, M26_ZERO = M26_NEG10 + 2, M26_NSIG = M26_NEG10 + 3;
const M26_I = {};
M26_INPUTS.forEach((x, i) => { M26_I[x.id] = i; });
const M26_NORMALS = Int32Array.from(M26_INPUTS.map((x) =>
  x.normal === '-10V' ? M26_NEG10 : x.normal === '+10V' ? M26_POS10 : x.normal ? M26_O[x.normal] : M26_ZERO));
const M26_FACTORS = [0.5, 1, 2];
const M26_PRE_RANGES = [10, 100, 1000];

function m26Tanh(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

// PolyBLEP step correction for a discontinuity at phase 0 (t = phase, dt = increment).
function m26Blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// An oscillator with every waveform out at once (±5 V). resetFrac >= 0 hard-syncs it (the master wrapped that
// fraction of a sample ago).
class M26Vco {
  constructor() { this.ph = 0; this.saw = 0; this.pulse = 0; this.tri = 0; this.sine = 0; this.wrapped = false; this.frac = 0; }
  run(dt, pw, resetFrac) {
    this.ph += dt;
    this.wrapped = false;
    if (this.ph >= 1) { this.ph -= Math.floor(this.ph); this.wrapped = true; this.frac = this.ph / dt; }
    if (resetFrac >= 0) this.ph = Math.min(0.999, resetFrac * dt);
    const ph = this.ph;
    this.saw = 5 * (2 * ph - 1 - m26Blep(ph, dt));
    let pl = ph < pw ? 1 : -1;
    pl += m26Blep(ph, dt);
    let t2 = ph - pw; if (t2 < 0) t2 += 1;
    pl -= m26Blep(t2, dt);
    this.pulse = 5 * pl;
    this.tri = 5 * (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph);
    this.sine = 5 * Math.sin(M26_TWO_PI * ph);
  }
}

// ADSR (0..10 V): a gate opening or a trigger restarts the attack from wherever the level is.
class M26Adsr {
  constructor() { this.v = 0; this.stage = 0; this.g = false; }
  tick(gate, trig, aRate, dCoef, sus, rCoef) {
    if ((gate && !this.g) || (gate && trig)) this.stage = 1;
    else if (!gate && this.g) this.stage = 3;
    this.g = gate;
    if (this.stage === 1) {
      this.v += aRate;
      if (this.v >= 10) { this.v = 10; this.stage = 2; }
    } else if (this.stage === 2) this.v += (sus - this.v) * dCoef;
    else if (this.stage === 3) {
      this.v -= this.v * rCoef;
      if (this.v < 1e-4) { this.v = 0; this.stage = 0; }
    }
    return this.v;
  }
}

// TPT ladder (zero-delay feedback, solved linearly, the input stage saturated): four one-poles in a resonant loop.
class M26Ladder {
  constructor() { this.s = [0, 0, 0, 0]; this.y = 0; }
  run(x, g, k, drive) {
    const G = g / (1 + g), ig = 1 / (1 + g), s = this.s;
    const G2 = G * G;
    const S = (G2 * G * s[0] + G2 * s[1] + G * s[2] + s[3]) * ig;
    const y4 = (G2 * G2 * x + S) / (1 + k * G2 * G2);
    let u = m26Tanh((x - k * y4) * drive) / drive;
    for (let j = 0; j < 4; j++) {
      const v = (u - s[j]) * G;
      const y = v + s[j];
      s[j] = y + v;
      u = y;
    }
    this.y = u;
    return u;
  }
}

// 12 dB TPT state-variable filter with saturating integrators (the SEM).
class M26Svf {
  constructor() { this.s1 = 0; this.s2 = 0; this.lp = 0; this.bp = 0; this.hp = 0; }
  run(x, g, k) {
    const hp = (x - (k + g) * this.s1 - this.s2) / (1 + g * (k + g));
    const bp = g * hp + this.s1;
    const lp = g * bp + this.s2;
    this.s1 = m26Tanh((g * hp + bp) * 0.7) / 0.7;
    this.s2 = m26Tanh((g * bp + lp) * 0.7) / 0.7;
    this.lp = lp; this.bp = bp; this.hp = hp;
  }
}

// A compact stereo spring-ish reverb: per side a damped feedback delay with an allpass chain inside the loop (the
// chirpy dispersion), a little cross-feed, and a soft clip in the loop so it stays bounded.
class M26Reverb {
  constructor(sr) {
    const sc = sr / 44100;
    const mk = (n) => new Float32Array(Math.max(2, Math.round(n * sc)));
    this.lines = [mk(1601), mk(1777)];
    this.pos = [0, 0];
    this.aps = [[mk(142), mk(107), mk(379), mk(53)], [mk(151), mk(113), mk(397), mk(61)]];
    this.apPos = [[0, 0, 0, 0], [0, 0, 0, 0]];
    this.damp = [0, 0];
    this.dc = [0, 0];
    this.out = [0, 0];
    this.dampA = 1 - Math.exp(-M26_TWO_PI * 4200 / sr);
  }
  tick(x) {
    const yl = this.lines[0][this.pos[0]], yr = this.lines[1][this.pos[1]];
    this.out[0] = yl * 5; this.out[1] = yr * 5;
    const ys = [yl, yr];
    for (let c = 0; c < 2; c++) {
      this.damp[c] += (ys[c] * 0.88 + ys[1 - c] * 0.1 - this.damp[c]) * this.dampA;
      let v = x * 0.06 + this.damp[c] * 0.8;
      this.dc[c] += (v - this.dc[c]) * 0.0005;
      v -= this.dc[c];
      const bufs = this.aps[c], ps = this.apPos[c];
      for (let j = 0; j < 4; j++) {
        const b = bufs[j], p = ps[j], d = b[p];
        const w = v + 0.55 * d;
        b[p] = w;
        v = d - 0.55 * w;
        ps[j] = p + 1 === b.length ? 0 : p + 1;
      }
      this.lines[c][this.pos[c]] = m26Tanh(v);
      this.pos[c] = this.pos[c] + 1 === this.lines[c].length ? 0 : this.pos[c] + 1;
    }
  }
}

${be}
class M26Core {
  constructor(sampleRate, random) {
    this.sr = sampleRate;
    this.random = random || Math.random;
    this.sig = new Float64Array(M26_NSIG);
    this.sig[M26_NEG10] = -10;
    this.sig[M26_POS10] = 10;
    this.cord = new Int32Array(M26_INPUTS.length).fill(-1);
    /** An output index to send straight to both channels (volts / 5) instead of the mix, for tests and scopes. */
    this.probe = -1;
    // keyboard
    this.n1 = 60; this.n2 = 60; this.keyGate = false; this.trigReq = false; this.started = false;
    this.cvLo = 0; this.cvHi = 0; this.trigLeft = 0; this.vibT = 0; this.autoGate = false;
    this.manualOn = false;
    // modules
    this.lfoPh = 0; this.lfoSq = false;
    this.pk = [0, 0, 0, 0, 0, 0, 0]; this.lfNoise = 0;
    this.shPh = 0; this.shHigh = false; this.extClk = false; this.held = 0; this.esw = 0;
    this.adsr = new M26Adsr(); this.ar = new M26Adsr(); this.trigPrev = false;
    this.v1 = new M26Vco(); this.v2 = new M26Vco(); this.v3 = new M26Vco();
    this.ringHa = [0, 0]; this.ringHb = [0, 0];
    this.envf = 0;
    this.vcf = new M26Ladder(); this.sem = new M26Svf();
    this.lag = 0;
    this.rev = new M26Reverb(sampleRate);
    this.seed = 12345;
    this.seq = new M26Seq(sampleRate, this.random);
    this.view = { gate: false, lfo: false, clk: false, esw: 0, adsr: 0, ar: 0, sq: { step: 0, running: false, clk: false } };
  }

  play(n1, n2, gate, retrig) {
    this.n1 = n1; this.n2 = n2;
    if (!this.started) { this.cvLo = (n1 - 60) / 12; this.cvHi = (n2 - 60) / 12; this.started = true; }
    if (gate && (retrig || !this.keyGate)) this.trigReq = true;
    if (gate && !this.keyGate) this.vibT = 0;
    this.keyGate = !!gate;
  }

  manual(on) { this.manualOn = !!on; }

  /** The sequencer's messages: { type: 'sq', action, index? } and { type: 'sqtick' }. */
  seqMessage(m) { this.seq.message(m); }

  /** Patch cords: a list of { from: output id, to: input id }; replaces every cord. Unknown ids are skipped. */
  setCords(list) {
    this.cord.fill(-1);
    for (const c of list || []) {
      const i = M26_I[c.to], o = M26_O[c.from];
      if (i !== undefined && o !== undefined) this.cord[i] = o;
    }
  }

  src(id) { const i = M26_I[id]; return this.cord[i] >= 0 ? this.cord[i] : M26_NORMALS[i]; }
  patched(id) { return this.cord[M26_I[id]] >= 0; }

  process(outL, outR, n, p) {
    const sr = this.sr, rnd = this.random, sig = this.sig, O = M26_O;
    const src = (id) => this.src(id);
    // ---- per-block: sources
    const sExtVib = src('kb.extvib'), sPre = src('pre.in'), sEnvf = src('envf.in');
    const sRingA = src('ring.a'), sRingB = src('ring.b');
    const s1k = src('vco1.fm.kybd'), s1sh = src('vco1.fm.sh'), s1ad = src('vco1.fm.adsr'), s1lfo = src('vco1.fm.lfo');
    const s2k = src('vco2.fm.kybd'), s2sh = src('vco2.fm.sh'), s2ad = src('vco2.fm.adsr'), s2v1 = src('vco2.fm.vco1'), s2pwm = src('vco2.pwm');
    const s3k = src('vco3.fm.kybd'), s3nz = src('vco3.fm.noise'), s3ad = src('vco3.fm.adsr'), s3v2 = src('vco3.fm.vco2'), s3pwm = src('vco3.pwm');
    const sfRing = src('vcf.in.ring'), sfV1 = src('vcf.in.vco1'), sfV2 = src('vcf.in.vco2'), sfV3 = src('vcf.in.vco3'), sfNz = src('vcf.in.noise');
    const sfK = src('vcf.cv.kybd'), sfAd = src('vcf.cv.adsr'), sfV2c = src('vcf.cv.vco2');
    const ssV1 = src('sem.in.vco1'), ssV2 = src('sem.in.vco2'), ssV3 = src('sem.in.vco3'), ssNz = src('sem.in.noise');
    const ssK = src('sem.cv.kybd'), ssAd = src('sem.cv.adsr'), ssLfo = src('sem.cv.lfo');
    const sAdGate = src('adsr.gate'), sAdTrig = src('adsr.trig');
    const sVcaAr = src('vca.cv.ar'), sVcaAd = src('vca.cv.adsr'), sVcaRing = src('vca.in.ring');
    const sVp = [src('vp.1'), src('vp.2'), src('vp.3'), src('vp.4'), src('vp.5'), src('vp.6'), src('vp.7')];
    const sShIn = src('sh.in'), sExtClk = src('sh.extclk'), extClk = this.patched('sh.extclk');
    const sEswA = src('esw.a'), sEswB = src('esw.b'), sOutL = src('out.left'), sOutR = src('out.right');
    const arPatched = this.patched('ar.gate'), sArGate = src('ar.gate');
    const sVcaVcf = src('vca.in.vcf'), sMixVcf = src('mix.in.vcf'), sVcaSem = src('vca.in.sem');
    const sMixVca = src('mix.in.vca');
    const sqFm = src('sq.fmin'), sqPwm = src('sq.pwm'), sqExt = src('sq.extclk'), sqStart = src('sq.start'), sqStop = src('sq.stop');
    const sqSs = src('sq.startstop'), sqStep = src('sq.stepin'), sqReset = src('sq.resetin');
    const sqIna = src('sq.ina'), sqInb = src('sq.inb'), sqCv = src('sq.cvin');
    const seq = this.seq;
    seq.block(p, this.patched('sq.extclk'), this.patched('sq.startstop'));
    const k1Patched = this.patched('vco1.fm.kybd'), k2Patched = this.patched('vco2.fm.kybd'), k3Patched = this.patched('vco3.fm.kybd');

    // ---- per-block: params
    const portaC = p['kb.portaOn'] > 0.5 && p['kb.porta'] > 0.001 ? 1 - Math.exp(-1 / (p['kb.porta'] * p['kb.porta'] * 2 * sr)) : 1;
    const repeat = Math.round(p['kb.repeat']); // 0 kybd, 1 off, 2 auto
    const lfoInc = p['lfo.speed'] / sr;
    const vibDelay = p['lfo.delay'];
    const vibDepth = Math.min(1, p['lfo.depth'] + p.modw) * 0.25;
    const bendV = p.bend / 12;
    const preGain = p['pre.gain'] * M26_PRE_RANGES[Math.round(p['pre.range'])];
    const envfGain = p['envf.gain'];
    const ringDc = p['ring.mode'] > 0.5, ringA = p['ring.a'], ringB = p['ring.b'];
    const ringHpA = 1 - Math.exp(-M26_TWO_PI * 10 / sr);
    const color = p['noise.color'], noiseLvl = p['noise.level'] * 5;
    const lfA = 1 - Math.exp(-M26_TWO_PI * 6 / sr);
    const vco = [1, 2, 3].map((k) => {
      const lf = p['vco' + k + '.range'] > 0.5;
      return { base: p['vco' + k + '.freq'] * Math.pow(2, p['vco' + k + '.fine'] / 12) / (lf ? 333.33 : 1), lf, pw: p['vco' + k + '.pw'] };
    });
    const sync2 = p['vco2.sync'] > 0.5, sync3 = p['vco3.sync'] > 0.5;
    const f1sh = p['vco1.fm.sh'], f1ad = p['vco1.fm.adsr'], f1lfo = p['vco1.fm.lfo'];
    const f2sh = p['vco2.fm.sh'], f2ad = p['vco2.fm.adsr'], f2v1 = p['vco2.fm.vco1'], f2pwm = p['vco2.pwm'];
    const f3nz = p['vco3.fm.noise'], f3ad = p['vco3.fm.adsr'], f3v2 = p['vco3.fm.vco2'], f3pwm = p['vco3.pwm'];
    const maxHz = 0.45 * sr;
    const vcfBase = p['vcf.freq'] * Math.pow(2, p['vcf.fine']);
    const vcfK = p['vcf.res'] * 4.8;
    const is4012 = p['vcf.mode'] < 0.5;
    const vcfDrive = is4012 ? 1.2 : 0.8;
    const vcfComp = is4012 ? 2 : 1 + vcfK * 0.3;
    const fRing = p['vcf.in.ring'], fV1 = p['vcf.in.vco1'], fV2 = p['vcf.in.vco2'], fV3 = p['vcf.in.vco3'], fNz = p['vcf.in.noise'];
    const fK = p['vcf.cv.kybd'], fAd = p['vcf.cv.adsr'], fV2c = p['vcf.cv.vco2'];
    const semBase = p['sem.freq'], semRes = p['sem.res'];
    const semK = 2 * (1 - semRes * 0.98) - 0.06 * Math.pow(semRes, 8);
    const semMode = p['sem.mode'], semBp = p['sem.bp'] > 0.5;
    const sV1 = p['sem.in.vco1'], sV2 = p['sem.in.vco2'], sV3 = p['sem.in.vco3'], sNz = p['sem.in.noise'];
    const sK = p['sem.cv.kybd'], sAd = p['sem.cv.adsr'], sLfo = p['sem.cv.lfo'];
    const adF = M26_FACTORS[Math.round(p['adsr.factor'])] || 1;
    const adA = 10 / (Math.max(0.0005, p['adsr.attack'] * adF) * sr);
    const adD = 1 - Math.exp(-4.6 / (Math.max(0.001, p['adsr.decay'] * adF) * sr));
    const adS = p['adsr.sustain'] * 10;
    const adR = 1 - Math.exp(-4.6 / (Math.max(0.001, p['adsr.release'] * adF) * sr));
    const arF = M26_FACTORS[Math.round(p['ar.factor'])] || 1;
    const arA = 10 / (Math.max(0.0005, p['ar.attack'] * arF) * sr);
    const arR = 1 - Math.exp(-4.6 / (Math.max(0.001, p['ar.release'] * arF) * sr));
    const arSh = p['ar.source'] > 0.5;
    const vGain = p['vca.gain'], vVcf = p['vca.in.vcf'], vSem = p['vca.in.sem'], vRing = p['vca.in.ring'], vAr = p['vca.cv.ar'], vAd = p['vca.cv.adsr'];
    const vp2 = p['vp.2'], vp4 = p['vp.4'], vp6 = p['vp.6'];
    const lagC = 1 - Math.exp(-1 / (0.001 * Math.pow(2000, p['vp.lag']) * sr));
    const shLvl = p['sh.level'], shInc = p['sh.rate'] / sr;
    const mVcf = p['mix.vcf'], mVca = p['mix.vca'], revL = p['reverb.left'], revR = p['reverb.right'];
    const panA = (Math.min(1, Math.max(-1, p['mix.pan'])) + 1) * Math.PI / 4;
    const gL = Math.cos(panA) * Math.SQRT2, gR = Math.sin(panA) * Math.SQRT2;
    const outGain = 0.25 * p['out.volume'];
    const trigLen = Math.round(0.002 * sr);
    const v1 = this.v1, v2 = this.v2, v3 = this.v3, pk = this.pk;

    for (let i = 0; i < n; i++) {
      // ---- keyboard controller and LFO
      this.lfoPh += lfoInc;
      let lfoRise = false;
      if (this.lfoPh >= 1) { this.lfoPh -= 1; lfoRise = true; }
      const lph = this.lfoPh;
      const lfoTri = 5 * (lph < 0.5 ? 4 * lph - 1 : 3 - 4 * lph);
      this.lfoSq = lph < 0.5;
      sig[O['lfo.tri']] = lfoTri;
      sig[O['lfo.square']] = this.lfoSq ? 5 : -5;
      let gate = this.keyGate;
      if (repeat === 2) gate = gate || this.lfoSq;
      if (gate) this.vibT += 1 / sr;
      const fade = vibDelay <= 0 ? 1 : Math.min(1, this.vibT / vibDelay);
      sig[O['lfo.delayed']] = lfoTri * fade;
      if (this.trigReq) { this.trigLeft = trigLen; this.trigReq = false; }
      if (lfoRise && repeat !== 1 && gate) this.trigLeft = trigLen;
      const vib = (lfoTri * fade + sig[sExtVib]) / 5 * vibDepth + bendV;
      this.cvLo += ((this.n1 - 60) / 12 - this.cvLo) * portaC;
      this.cvHi += ((this.n2 - 60) / 12 - this.cvHi) * portaC;
      sig[O['kb.cv']] = this.cvLo + vib;
      sig[O['kb.upper']] = this.cvHi + vib;
      sig[O['kb.gate']] = gate ? 10 : 0;
      sig[O['kb.trig']] = this.trigLeft > 0 ? 10 : 0;
      if (this.trigLeft > 0) this.trigLeft--;

      // ---- SQ16 sequencer
      seq.tick(sig[sqFm], sig[sqPwm], sig[sqExt], sig[sqStart], sig[sqStop], sig[sqSs], sig[sqStep], sig[sqReset]);
      sig[O['sq.a']] = seq.a; sig[O['sq.b']] = seq.b;
      sig[O['sq.bus1']] = seq.bus[0]; sig[O['sq.bus2']] = seq.bus[1]; sig[O['sq.bus3']] = seq.bus[2];
      sig[O['sq.pos1']] = seq.pos1; sig[O['sq.cgate1']] = seq.cgate1; sig[O['sq.clk']] = seq.clk;
      sig[O['sq.qa']] = seq.quant(sig[sqIna], sig[sqCv]);
      sig[O['sq.qb']] = seq.quant(sig[sqInb], sig[sqCv]);

      // ---- noise: white > pink > low-frequency random
      const w = rnd() * 2 - 1;
      pk[0] = 0.99886 * pk[0] + w * 0.0555179; pk[1] = 0.99332 * pk[1] + w * 0.0750759;
      pk[2] = 0.969 * pk[2] + w * 0.153852; pk[3] = 0.8665 * pk[3] + w * 0.3104856;
      pk[4] = 0.55 * pk[4] + w * 0.5329522; pk[5] = -0.7616 * pk[5] - w * 0.016898;
      const pink = (pk[0] + pk[1] + pk[2] + pk[3] + pk[4] + pk[5] + pk[6] + w * 0.5362) * 0.11;
      pk[6] = w * 0.115926;
      this.lfNoise += (w - this.lfNoise) * lfA;
      const low = m26Tanh(this.lfNoise * 40);
      const nz = color < 0.5 ? w * (1 - 2 * color) + pink * 2 * color : pink * (2 - 2 * color) + low * (2 * color - 1);
      sig[O['noise.out']] = nz * noiseLvl;

      // ---- sample-and-hold, its clock and the electronic switch
      let clkRise = false;
      if (extClk) {
        const hi = sig[sExtClk] > 2;
        clkRise = hi && !this.extClk;
        this.extClk = hi;
        this.shHigh = hi;
      } else {
        this.shPh += shInc;
        if (this.shPh >= 1) { this.shPh -= 1; clkRise = true; }
        this.shHigh = this.shPh < 0.5;
      }
      if (clkRise) { this.held = sig[sShIn] * shLvl; this.esw ^= 1; }
      sig[O['sh.out']] = this.held;
      sig[O['sh.clk']] = this.shHigh ? 10 : 0;

      // ---- envelopes
      const trigHi = sig[sAdTrig] > 2;
      const ad = this.adsr.tick(sig[sAdGate] > 2, trigHi && !this.trigPrev, adA, adD, adS, adR);
      this.trigPrev = trigHi;
      sig[O['adsr.out']] = ad;
      const arGate = (arPatched ? sig[sArGate] > 2 : (arSh ? this.shHigh : sig[O['kb.gate']] > 2)) || this.manualOn;
      const arv = this.ar.tick(arGate, false, arA, 0, 10, arR);
      sig[O['ar.out']] = arv;

      // ---- oscillators
      let fm = sig[s1sh] * f1sh + sig[s1ad] * f1ad + sig[s1lfo] * f1lfo;
      if (!vco[0].lf || k1Patched) fm += sig[s1k];
      let hz = Math.min(maxHz, vco[0].base * Math.pow(2, fm));
      v1.run(Math.max(1e-7, hz / sr), vco[0].pw, -1);
      sig[O['vco1.saw']] = v1.saw; sig[O['vco1.pulse']] = v1.pulse;
      const reset = v1.wrapped ? v1.frac : -1;

      fm = sig[s2sh] * f2sh + sig[s2ad] * f2ad + sig[s2v1] * f2v1;
      if (!vco[1].lf || k2Patched) fm += sig[s2k];
      hz = Math.min(maxHz, vco[1].base * Math.pow(2, fm));
      let pw = Math.min(0.95, Math.max(0.05, vco[1].pw + sig[s2pwm] * f2pwm / 10));
      v2.run(Math.max(1e-7, hz / sr), pw, sync2 ? reset : -1);
      sig[O['vco2.tri']] = v2.tri; sig[O['vco2.saw']] = v2.saw; sig[O['vco2.sine']] = v2.sine; sig[O['vco2.pulse']] = v2.pulse;

      fm = sig[s3nz] * f3nz + sig[s3ad] * f3ad + sig[s3v2] * f3v2;
      if (!vco[2].lf || k3Patched) fm += sig[s3k];
      hz = Math.min(maxHz, vco[2].base * Math.pow(2, fm));
      pw = Math.min(0.95, Math.max(0.05, vco[2].pw + sig[s3pwm] * f3pwm / 10));
      v3.run(Math.max(1e-7, hz / sr), pw, sync3 ? reset : -1);
      sig[O['vco3.tri']] = v3.tri; sig[O['vco3.saw']] = v3.saw; sig[O['vco3.sine']] = v3.sine; sig[O['vco3.pulse']] = v3.pulse;

      // ---- ring modulator (audio: AC-coupled inputs; dc: direct)
      let ra = sig[sRingA] * ringA, rb = sig[sRingB] * ringB;
      if (!ringDc) {
        this.ringHa[0] += (ra - this.ringHa[0]) * ringHpA; ra -= this.ringHa[0];
        this.ringHb[0] += (rb - this.ringHb[0]) * ringHpA; rb -= this.ringHb[0];
      }
      sig[O['ring.out']] = ra * rb / 5;

      // ---- preamp and envelope follower
      sig[O['pre.out']] = 10 * m26Tanh(sig[sPre] * preGain / 10);
      const ef = Math.abs(sig[sEnvf] * envfGain) * 2;
      this.envf += (ef - this.envf) * (ef > this.envf ? 0.004 : 0.0003);
      sig[O['envf.out']] = Math.min(10, this.envf);

      // ---- VCF (in units of 5 V)
      this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
      const tiny = (this.seed / 4294967296 - 0.5) * 2e-6;
      const fx = (sig[sfRing] * fRing + sig[sfV1] * fV1 + sig[sfV2] * fV2 + sig[sfV3] * fV3 + sig[sfNz] * fNz) / 5 + tiny;
      const fcv = sig[sfK] * fK + sig[sfAd] * fAd + sig[sfV2c] * fV2c;
      const fc = Math.min(maxHz, Math.max(5, vcfBase * Math.pow(2, fcv)));
      const fy = this.vcf.run(fx, Math.tan(Math.PI * fc / sr), vcfK, vcfDrive);
      sig[O['vcf.out']] = 10 * m26Tanh(fy * vcfComp * 0.5);

      // ---- SEM
      {
        const sx = (sig[ssV1] * sV1 + sig[ssV2] * sV2 + sig[ssV3] * sV3 + sig[ssNz] * sNz) / 5 + tiny;
        const scv = sig[ssK] * sK + sig[ssAd] * sAd + sig[ssLfo] * sLfo;
        const sfc = Math.min(maxHz, Math.max(5, semBase * Math.pow(2, scv)));
        const sem = this.sem;
        sem.run(sx, Math.tan(Math.PI * sfc / sr), semK);
        let sy;
        if (semBp) sy = sem.bp;
        else if (semMode < 0.5) sy = sem.lp + sem.hp * 2 * semMode;
        else sy = sem.lp * (2 - 2 * semMode) + sem.hp;
        sig[O['sem.out']] = 10 * m26Tanh(sy * 0.5);
      }

      // ---- VCA (AR linear, ADSR exponential)
      const ax = sig[sVcaVcf] * vVcf + sig[sVcaSem] * vSem + sig[sVcaRing] * vRing;
      const adV = Math.min(1, Math.max(0, sig[sVcaAd] / 10));
      const g = Math.min(1, Math.max(0, vGain + vAr * sig[sVcaAr] / 10 + vAd * (Math.pow(100, adV) - 1) / 99));
      sig[O['vca.out']] = ax * g;

      // ---- mixer, reverb and output
      const mix = sig[sMixVcf] * mVcf + sig[sMixVca] * mVca;
      sig[O['mix.out']] = mix;
      this.rev.tick(mix / 5);
      const wl = this.rev.out[0], wr = this.rev.out[1];
      sig[O['reverb.out']] = (wl + wr) * 0.5;

      // ---- voltage processors and the electronic switch
      sig[O['vp.inv1']] = -(sig[sVp[0]] + sig[sVp[2]] + sig[sVp[1]] * vp2 + sig[sVp[3]] * vp4);
      sig[O['vp.inv2']] = -(sig[sVp[4]] + sig[sVp[5]] * vp6);
      this.lag += (sig[sVp[6]] - this.lag) * lagC;
      sig[O['vp.lag']] = this.lag;
      sig[O['esw.c']] = this.esw ? sig[sEswB] : sig[sEswA];

      if (this.probe >= 0) {
        outL[i] = outR[i] = sig[this.probe] / 5;
        continue;
      }
      const l = mix * gL + wl * revL + sig[sOutL];
      const r = mix * gR + wr * revR + sig[sOutR];
      outL[i] = m26Tanh(l * outGain);
      outR[i] = m26Tanh(r * outGain);
    }
    // keep the filter and reverb states clear of NaN (a bad cord could feed one in)
    if (!(this.vcf.s[0] === this.vcf.s[0]) || !(this.sem.s1 === this.sem.s1)) {
      this.vcf = new M26Ladder(); this.sem = new M26Svf();
    }
    const v = this.view;
    v.gate = this.keyGate; v.lfo = this.lfoSq; v.clk = this.shHigh; v.esw = this.esw;
    v.adsr = this.adsr.v; v.ar = this.ar.v;
    v.sq.step = seq.pos; v.sq.running = seq.running; v.sq.clk = seq.high;
  }
}

if (typeof registerProcessor === 'function') {
  class Moa2600 extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return M26_PARAM_DEFS.map((d) => ({ name: d[0], defaultValue: d[1], minValue: d[2], maxValue: d[3], automationRate: 'k-rate' }));
    }
    constructor(options) {
      super();
      this.core = new M26Core(sampleRate);
      // the cords patched before audio started
      const cords = options && options.processorOptions && options.processorOptions.cords;
      if (cords) this.core.setCords(cords);
      this.p = Object.assign({}, M26_DEFAULTS);
      this.sinceView = 0;
      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m) return;
        if (m.type === 'play') this.core.play(m.n1, m.n2, m.gate, m.retrig);
        else if (m.type === 'manual') this.core.manual(m.on);
        else if (m.type === 'cords') this.core.setCords(m.cords);
        else if (m.type === 'sq' || m.type === 'sqtick') this.core.seqMessage(m);
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
        this.port.postMessage(Object.assign({}, this.core.view));
      }
      return true;
    }
  }
  registerProcessor('${xe}', Moa2600);
}
`,Te=`moa-pipe`,Ee=`moa-spring`,De=`
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
  registerProcessor('${Te}', MoaPipe);

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
  registerProcessor('${Ee}', MoaSpring);
}
`,Oe=.01,ke=class t{patch;ctx;compiled=new Map;monitor;monitorOn=!0;compressors=new Map;grainViews=new Map;pipeViews=new Map;dfViews=new Map;duoViews=new Map;m2600Views=new Map;stringViews=new Map;samplerViews=new Map;meters=new Map;constructor(e){this.patch=e}async start(){if(!this.ctx){let e=new AudioContext;await e.audioWorklet.addModule(at()),this.build(e)}await this.ctx?.resume()}static async render(e,n,r,i,a=2){let o=new OfflineAudioContext(a,Math.ceil(n*r),r);return await o.audioWorklet.addModule(at()),new t(e).build(o),i(),o.startRendering()}async stop(){await this.ctx?.suspend()}get context(){return this.ctx}setMonitor(e){this.monitorOn=e,this.monitor&&this.ctx&&this.monitor.gain.setTargetAtTime(+!!e,this.ctx.currentTime,.02)}jackNode(e,t,n){let r=this.patch.device(e).jack(t,n).nodeId;return this.compiled.get(e)?.get(r)}setCable(e,t,n){let r=this.jackNode(e.device,`out`,e.jack),i=this.jackNode(t.device,`in`,t.jack);r&&i&&(n?r.connect(i):r.disconnect(i))}get currentTime(){return this.ctx?.currentTime??0}readLevel(e,t){let n=this.meters.get(`${e}/${t}`);if(!n)return 0;n.analyser.getFloatTimeDomainData(n.buffer);let r=0;for(let e of n.buffer)r=Math.max(r,Math.abs(e));return r}readGranular(e,t){return this.grainViews.get(`${e}/${t}`)}readPipe(e,t){return this.pipeViews.get(`${e}/${t}`)}readDF(e,t){return this.dfViews.get(`${e}/${t}`)}readSampler(e,t){return this.samplerViews.get(`${e}/${t}`)}readString(e,t){return this.stringViews.get(`${e}/${t}`)}readM2600(e,t){return this.m2600Views.get(`${e}/${t}`)}readDuo(e,t){return this.duoViews.get(`${e}/${t}`)}readReduction(e,t){return this.compressors.get(`${e}/${t}`)?.reduction??0}build(e){e instanceof AudioContext&&(this.ctx=e);let t=new Map;for(let[n,r]of this.patch.devices)t.set(n,this.compileCircuit(e,n,r.circuit));this.compiled=t;let n=(e,n,r)=>{let i=this.patch.device(e).jack(n,r).nodeId,a=t.get(e)?.get(i);if(!a)throw Error(`No audio node for ${e}.${r}`);return a};for(let e of this.patch.connections)n(e.from.device,`out`,e.from.jack).connect(n(e.to.device,`in`,e.to.jack));if(this.patch.output){this.monitor=e.createGain(),this.monitor.gain.value=+!!this.monitorOn,this.monitor.connect(e.destination);for(let{device:e,jack:t}of[this.patch.output,...this.patch.extraOutputs])n(e,`out`,t).connect(this.monitor)}}compileCircuit(t,n,r){let i=new Map;for(let a of r.nodes.values())switch(a.kind){case`oscillator`:{let e=t.createOscillator();e.type=a.options.waveform,e.frequency.value=a.params.frequency??440,e.detune.value=a.params.detune??0,e.start(),i.set(a.id,e);break}case`filter`:{let e=t.createBiquadFilter();e.type=a.options.type,e.frequency.value=a.params.frequency??350,e.Q.value=a.params.Q??1,e.gain.value=a.params.gain??0,e.detune.value=a.params.detune??0,i.set(a.id,e);break}case`envelope`:{let e=t.createConstantSource();e.offset.value=0,e.start(),i.set(a.id,e);break}case`convolver`:{let e=t.createConvolver();e.buffer=Xe(t,Ye[a.options.size??`medium`]??Ye.medium),i.set(a.id,e);break}case`follower`:{let e=new AudioWorkletNode(t,rt,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],parameterData:{attack:a.params.attack??.003,release:a.params.release??.12}});i.set(a.id,e);break}case`granular`:{let{maxTime:e,...r}=a.params,o=new AudioWorkletNode(t,_e,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],parameterData:r,processorOptions:{seconds:e??20}});o.port.onmessage=e=>this.grainViews.set(`${n}/${a.id}`,e.data),i.set(a.id,o);break}case`pipe`:{let e=new AudioWorkletNode(t,Te,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params});e.port.onmessage=e=>this.pipeViews.set(`${n}/${a.id}`,e.data),i.set(a.id,e);break}case`spring`:i.set(a.id,new AudioWorkletNode(t,Ee,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params}));break;case`df`:{let r=new AudioWorkletNode(t,e,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:`explicit`,parameterData:a.params});r.port.onmessage=e=>this.dfViews.set(`${n}/${a.id}`,e.data),i.set(a.id,r);break}case`duo`:{let e=new AudioWorkletNode(t,re,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params});e.port.onmessage=e=>this.duoViews.set(`${n}/${a.id}`,e.data),i.set(a.id,e);break}case`string`:{let e=new AudioWorkletNode(t,de,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],parameterData:a.params,processorOptions:{config:JSON.parse(a.options.config??`{}`)}});e.port.onmessage=e=>this.stringViews.set(`${n}/${a.id}`,e.data),i.set(a.id,e);break}case`drum`:{let e=new AudioWorkletNode(t,pe,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],parameterData:a.params,processorOptions:{config:JSON.parse(a.options.config??`{}`)}});e.port.onmessage=e=>this.stringViews.set(`${n}/${a.id}`,e.data),i.set(a.id,e);break}case`tone`:i.set(a.id,new AudioWorkletNode(t,he,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],parameterData:a.params,processorOptions:{role:a.options.role,preset:JSON.parse(a.options.preset??`{}`)}}));break;case`sampler`:{let e=new AudioWorkletNode(t,le,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params});e.port.onmessage=e=>{e.data.type===`ready`?r.nodeReady(a.id):this.samplerViews.set(`${n}/${a.id}`,e.data)},i.set(a.id,e);break}case`ladder`:i.set(a.id,new AudioWorkletNode(t,se,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:`explicit`,parameterData:a.params}));break;case`fold`:i.set(a.id,new AudioWorkletNode(t,ae,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:`explicit`,parameterData:a.params}));break;case`m2600`:{let e=new AudioWorkletNode(t,xe,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params,processorOptions:{cords:JSON.parse(a.options.cords??`[]`)}});e.port.onmessage=e=>this.m2600Views.set(`${n}/${a.id}`,e.data),i.set(a.id,e);break}case`compressor`:{let e=t.createDynamicsCompressor();this.compressors.set(`${n}/${a.id}`,e),e.threshold.value=a.params.threshold??-24,e.knee.value=a.params.knee??30,e.ratio.value=a.params.ratio??12,e.attack.value=a.params.attack??.003,e.release.value=a.params.release??.25,i.set(a.id,e);break}case`delay`:{let e=t.createDelay(a.params.maxTime??1);e.delayTime.value=a.params.delayTime??.25,i.set(a.id,e);break}case`trigger`:{let e=t.createConstantSource();e.offset.value=0,e.start(),i.set(a.id,e);break}case`constant`:{let e=t.createConstantSource();e.offset.value=a.params.offset??0,e.start(),i.set(a.id,e);break}case`waveshaper`:{let e=t.createWaveShaper();a.options.curve===`pulse`?e.curve=Ve():a.options.curve===`soft`?e.curve=Ue():a.options.curve===`limit`?e.curve=We():a.options.curve===`warm`?e.curve=Ke():a.options.curve===`tube`?e.curve=Ge():a.options.curve===`abs`?e.curve=qe():a.options.curve===`crush`&&(e.curve=Je(a.params.bits??16)),e.oversample=`4x`,i.set(a.id,e);break}case`noise`:{let e=t.createBufferSource();e.buffer=Ze(t),e.loop=!0,e.start(),i.set(a.id,e);break}case`random`:{let e=t.createBufferSource();e.buffer=tt(t),e.loop=!0,e.playbackRate.value=(a.params.rate??4)/$e,e.start(),i.set(a.id,e);break}case`meter`:{let e=t.createAnalyser();e.fftSize=1024;let r=a.options.channel??`mono`;if(r===`mono`)i.set(a.id,e);else{let n=t.createChannelSplitter(2);n.connect(e,r===`left`?0:1),i.set(a.id,n)}this.meters.set(`${n}/${a.id}`,{analyser:e,buffer:new Float32Array(new ArrayBuffer(e.fftSize*4))});break}case`pan`:{let e=t.createStereoPanner();e.pan.value=a.params.pan??0,i.set(a.id,e);break}case`gain`:{let e=t.createGain();e.gain.value=a.params.gain??1,a.options.channels===`mono`&&(e.channelCount=1,e.channelCountMode=`explicit`),i.set(a.id,e);break}}for(let e of r.cables){let t=i.get(e.from),n=i.get(e.to);if(t&&n){if(e.port===`in`)t.connect(n);else{let r=Ae(n,e.port);r&&t.connect(r)}}}return r.onChange(e=>{let n=i.get(e.nodeId);if(!n)return;if(e.type===`note`||e.type===`gate`||e.type===`play`){n instanceof AudioWorkletNode&&n.port.postMessage(e);return}if(e.type===`message`){n instanceof AudioWorkletNode&&n.port.postMessage(e.data);return}if(e.type===`trigger`||e.type===`choke`){n instanceof ConstantSourceNode&&(e.type===`trigger`?ze(t,n.offset,r.node(e.nodeId).params,r.node(e.nodeId).options.shape,e.velocity,e.when):Be(t,n.offset,e.when));return}if(r.node(e.nodeId).kind===`trigger`)return;if(n instanceof WaveShaperNode&&e.type===`param`&&e.name===`bits`){n.curve=Je(e.value);return}if(r.node(e.nodeId).kind===`envelope`){n instanceof ConstantSourceNode&&e.type===`param`&&e.name===`gate`&&Pe(t,n.offset,r.node(e.nodeId).params,e.value>0);return}if(n instanceof AudioBufferSourceNode&&e.type===`param`&&e.name===`rate`){n.playbackRate.setTargetAtTime(e.value/$e,t.currentTime,Oe);return}if(e.type===`option`){n instanceof OscillatorNode&&e.name===`waveform`||n instanceof BiquadFilterNode&&e.name===`type`?n.type=e.value:n instanceof ConvolverNode&&e.name===`size`&&(n.buffer=Xe(t,Ye[e.value]??Ye.medium));return}let a=Ae(n,e.name);r.node(e.nodeId).kind===`m2600`&&ee.has(e.name)||r.node(e.nodeId).kind===`duo`&&Me.test(e.name)||r.node(e.nodeId).kind===`df`&&Ne.test(e.name)?a?.setValueAtTime(e.value,t.currentTime):a?.setTargetAtTime(e.value,t.currentTime,nt(r,e.nodeId,e.name))}),i}};function Ae(e,t){if(e instanceof AudioWorkletNode)return e.parameters.get(t);let n=e[t];return n instanceof AudioParam?n:void 0}var je=.001,Me=/Wave$|Sync$|Route$|Hold$|Lfo$|Off$/,Ne=/Type$|Src$|Inv$|Vca$|Gate$|Loop$|Exp$|Trig$|Link$|^mono$/;function Pe(e,t,n,r){let i=e.currentTime;if(t.cancelScheduledValues(i),t.setValueAtTime(t.value,i),r){let e=Math.max(n.attack??.01,je);t.linearRampToValueAtTime(1,i+e),t.setTargetAtTime(n.sustain??.7,i+e,Math.max(n.decay??.2,je)/3)}else t.setTargetAtTime(0,i,Math.max(n.release??.3,je)/3)}var Fe=.001,Ie=3,Le=.0035,Re=.005;function ze(e,t,n,r,i,a){let o=n.velSens??1,s=(n.peak??1)*(1-o+o*i),c=Math.max(n.decay??.2,je)/4,l=Math.max(a??0,e.currentTime);if(t.cancelScheduledValues(l),t.setValueAtTime(t.value,l),t.linearRampToValueAtTime(s,l+Fe),r!==`clap`){t.setTargetAtTime(0,l+Fe,c);return}let u=Math.max(n.spread??.012,.002);t.setTargetAtTime(0,l+Fe,Le);for(let e=1;e<=Ie;e++){let n=l+e*u;t.setValueAtTime(s,n),t.setTargetAtTime(0,n,e===Ie?c:Le)}}function Be(e,t,n){let r=Math.max(n??0,e.currentTime);t.cancelScheduledValues(r),t.setValueAtTime(t.value,r),t.setTargetAtTime(0,r,Re)}function Ve(){let e=1024,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++)t[n]=n<e/2?-1:1;return t}var He=2.5;function Ue(){let e=2048,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++){let e=n/2047*2-1;t[n]=Math.tanh(He*e)/Math.tanh(He)}return t}function We(){let e=4097,t=new Float32Array(new ArrayBuffer(e*4)),n=.9;for(let r=0;r<e;r++){let e=r/4096*2-1,i=Math.abs(e);t[r]=Math.sign(e)*(i<n?i:n+.09999999999999998*Math.tanh((i-n)/.09999999999999998))}return t}function Ge(){let e=4097,t=new Float32Array(new ArrayBuffer(e*4)),n=2.2,r=.35,i=n*(1-Math.tanh(r)**2);for(let a=0;a<e;a++){let e=a/4096*2-1;t[a]=(Math.tanh(n*e+r)-Math.tanh(r))/i}return t}function Ke(){let e=4097,t=new Float32Array(new ArrayBuffer(e*4)),n=.6;for(let r=0;r<e;r++){let e=r/4096*2-1,i=Math.abs(e)*3;t[r]=Math.sign(e)*(i<n?i:n+.4*Math.tanh((i-n)/.4))}return t}function qe(){let e=1025,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++)t[n]=Math.abs(n/1024*2-1);return t}function Je(e){let t=8193,n=new Float32Array(new ArrayBuffer(t*4)),r=2**Math.max(1,Math.min(16,e))/2;for(let e=0;e<t;e++){let t=e/8192*2-1;n[e]=Math.round(t*r)/r}return n}var Ye={small:.9,medium:2.4,large:5};function Xe(e,t){let n=e.sampleRate,r=Math.floor(n*t),i=e.createBuffer(2,r,n),a=Math.log(1e3)/t;for(let e=0;e<2;e++){let t=i.getChannelData(e),o=0;for(let e=0;e<r;e++){let r=e/n,i=Math.exp(-a*r)*Math.min(1,r/.004),s=.75*Math.exp(-r*1.2)+.06;o+=s*(Math.random()*2-1-o),t[e]=o*i}}return i}function Ze(e){let t=e.createBuffer(1,e.sampleRate*2,e.sampleRate),n=t.getChannelData(0);for(let e=0;e<n.length;e++)n[e]=Math.random()*2-1;return t}var Qe=64,$e=10,et=8e3;function tt(e){let t=et/$e,n=e.createBuffer(1,Qe*t,et),r=n.getChannelData(0);for(let e=0;e<Qe;e++)r.fill(Math.random()*2-1,e*t,(e+1)*t);return n}function nt(e,t,n){let r=e.node(t);return r.kind===`constant`&&n===`offset`&&r.params.glide?Math.max(r.params.glide/3,Oe):Oe}var rt=`moa-follower`,it=[`
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
registerProcessor('${rt}', MoaFollower);
`,ve,De,t,ie,we,oe,ce,fe,me,ue,ge].join(`
`);function at(){return URL.createObjectURL(new Blob([it],{type:`text/javascript`}))}var ot=24,st=48,ct=12,lt=1e3,ut=500,_=class{intervals=[];last;isRunning=!1;pulses=0;get running(){return this.isRunning}get ticks(){return this.pulses}get bpm(){if(this.intervals.length<ct)return;let e=[...this.intervals].sort((e,t)=>e-t),t=Math.floor(e.length/4),n=e.slice(t,e.length-t);return 6e4/(n.reduce((e,t)=>e+t,0)/n.length*ot)}isLocked(e){return this.last!==void 0&&this.intervals.length>=ct&&e-this.last<ut}get position(){return dt(this.pulses)}handle(e,t){switch(e.type){case`clock`:if(this.last!==void 0){let e=t-this.last;e>lt?this.intervals=[]:this.intervals.push(e),this.intervals.length>st&&this.intervals.shift()}this.last=t,this.isRunning&&this.pulses++;break;case`start`:this.isRunning=!0,this.pulses=0;break;case`continue`:this.isRunning=!0;break;case`stop`:this.isRunning=!1}}};function dt(e){return{bar:Math.floor(e/96)+1,beat:Math.floor(e/ot)%4+1,sixteenth:Math.floor(e/(ot/4))%4+1}}var ft=class{nodes=new Map;cables=[];listeners=new Set;readyListeners=new Set;add(e,t,n={},r={}){if(this.nodes.has(e))throw Error(`Duplicate node id: ${e}`);return this.nodes.set(e,{id:e,kind:t,params:{...n},options:{...r}}),this}connect(e,t,n=`in`){this.node(e);let r=this.node(t);if(n!==`in`&&!(n in r.params))throw Error(`Node ${t} has no param ${n}`);if(this.cables.some(r=>r.from===e&&r.to===t&&r.port===n))throw Error(`Duplicate cable ${e} -> ${t}.${n}`);return this.cables.push({from:e,to:t,port:n}),this}setParam(e,t,n){let r=this.node(e);if(!(t in r.params))throw Error(`Node ${e} has no param ${t}`);r.params[t]=n,this.emit({type:`param`,nodeId:e,name:t,value:n})}setOption(e,t,n){let r=this.node(e);if(!(t in r.options))throw Error(`Node ${e} has no option ${t}`);r.options[t]=n,this.emit({type:`option`,nodeId:e,name:t,value:n})}trigger(e,t=1,n){this.expectKind(e,`trigger`),this.emit({type:`trigger`,nodeId:e,velocity:Math.min(1,Math.max(0,t)),when:n})}choke(e,t){this.expectKind(e,`trigger`),this.emit({type:`choke`,nodeId:e,when:t})}noteOn(e,t,n=1){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:t,velocity:Math.min(1,Math.max(0,n))})}noteOff(e,t){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:t,velocity:0})}allNotesOff(e){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:-1,velocity:0})}pedal(e,t){this.expectKind(e,`pipe`),this.emit({type:`note`,nodeId:e,note:-2,velocity:+!!t})}play(e,t,n,r,i){this.expectKind(e,`duo`,`m2600`),this.emit({type:`play`,nodeId:e,n1:t,n2:n,gate:r,retrig:i})}send(e,t){this.expectKind(e,`m2600`,`string`,`drum`,`sampler`,`tone`),this.emit({type:`message`,nodeId:e,data:t})}gate(e,t,n){this.expectKind(e,`df`),this.emit({type:`gate`,nodeId:e,target:t,on:n})}nodeReady(e){for(let t of this.readyListeners)t(e)}onReady(e){return this.readyListeners.add(e),()=>this.readyListeners.delete(e)}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}node(e){let t=this.nodes.get(e);if(!t)throw Error(`Unknown node: ${e}`);return t}expectKind(e,...t){if(!t.includes(this.node(e).kind))throw Error(`Node ${e} is not a ${t.join(` or `)}`)}emit(e){for(let t of this.listeners)t(e)}},v=class{circuit=new ft;controlList=[];inputList=[];outputList=[];meterList=[];get controls(){return this.controlList}get inputs(){return this.inputList}get outputs(){return this.outputList}get meters(){return this.meterList}control(e){let t=this.controlList.find(t=>t.id===e);if(!t)throw Error(`${this.name} has no control ${e}`);return t}jack(e,t){let n=(e===`in`?this.inputList:this.outputList).find(e=>e.name===t);if(!n)throw Error(`${this.name} has no ${e} jack ${t}`);return n}},pt=class{listeners=new Set;onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}notify(){for(let e of this.listeners)e()}},y=class extends pt{id;label;min;max;initial;unit;apply;curve;kind=`number`;current;constructor(e,t,n,r,i,a,o,s=`linear`){super(),this.id=e,this.label=t,this.min=n,this.max=r,this.initial=i,this.unit=a,this.apply=o,this.curve=s,this.current=mt(this.initial,n,r),this.apply(this.current)}get value(){return this.current}set(e){this.current=mt(e,this.min,this.max),this.apply(this.current),this.notify()}},b=class extends pt{id;label;options;apply;kind=`choice`;current;constructor(e,t,n,r,i){if(super(),this.id=e,this.label=t,this.options=n,this.apply=i,!n.includes(r))throw Error(`Invalid initial choice ${r}`);this.current=r,this.apply(this.current)}get value(){return this.current}set(e){if(!this.options.includes(e))throw Error(`Invalid choice ${e} for ${this.id}`);this.current=e,this.apply(e),this.notify()}},x=class extends pt{id;label;apply;kind=`toggle`;current;constructor(e,t,n,r){super(),this.id=e,this.label=t,this.apply=r,this.current=n,this.apply(n)}get value(){return this.current}set(e){this.current=e,this.apply(e),this.notify()}};function mt(e,t,n){return Math.min(n,Math.max(t,e))}var ht={"bc.threshold":-18,"bc.ratio":4,"bc.attack":10,"bc.release":200,"bc.knee":6,"bc.makeup":3,"bc.mix":1,"bc.duck.depth":0,"bc.duck.release":120,"bc.duck.keyHp":80,"bc.bypass":0,"bc.listen":0},gt=(e,t)=>({name:e,values:t}),_t=[gt(`Init`,{}),gt(`Glue`,{"bc.threshold":-14,"bc.ratio":2,"bc.attack":30,"bc.release":400,"bc.knee":12,"bc.makeup":2}),gt(`Kick Duck`,{"bc.threshold":-6,"bc.ratio":1.5,"bc.makeup":0,"bc.duck.depth":.7,"bc.duck.release":140}),gt(`Gentle Pump`,{"bc.threshold":-16,"bc.ratio":2,"bc.makeup":3,"bc.duck.depth":.35,"bc.duck.release":220}),gt(`Hard Pump`,{"bc.threshold":-12,"bc.ratio":4,"bc.makeup":2,"bc.duck.depth":.95,"bc.duck.release":90,"bc.duck.keyHp":120}),gt(`NY Parallel`,{"bc.threshold":-32,"bc.ratio":8,"bc.attack":3,"bc.release":100,"bc.knee":4,"bc.makeup":10,"bc.mix":.4}),gt(`Drum Smash`,{"bc.threshold":-28,"bc.ratio":20,"bc.attack":1,"bc.release":200,"bc.knee":0,"bc.makeup":8,"bc.mix":.7}),gt(`Limiter`,{"bc.threshold":-4,"bc.ratio":20,"bc.attack":1,"bc.release":100,"bc.knee":0,"bc.makeup":0})],vt=4,yt=e=>10**(e/20);function bt(e,t,n){let r=e+n/2<0?e+(0-e)/t:0;return-.6*Math.min(0,r)}var xt=class extends v{name;slots=[..._t];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;mix=1;makeupDb=3;threshold=-18;ratio=4;knee=6;bypass=!1;listen=!1;constructor(e=`Bus Comp`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`duck`,`gain`,{gain:1}).add(`gate`,`gain`,{gain:1}).add(`comp`,`compressor`,{threshold:-18,knee:6,ratio:4,attack:.01,release:.2}).add(`wet`,`gain`,{gain:yt(3)}).add(`dry`,`gain`,{gain:0}).add(`bypassPath`,`gain`,{gain:0}).add(`listenPath`,`gain`,{gain:0}).add(`out`,`gain`,{gain:1}).add(`inMeter`,`meter`,{},{channel:`mono`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`inMeter`).connect(`in`,`duck`).connect(`duck`,`gate`).connect(`gate`,`comp`).connect(`gate`,`dry`).connect(`comp`,`wet`).connect(`wet`,`out`).connect(`dry`,`out`).connect(`in`,`bypassPath`).connect(`bypassPath`,`out`).connect(`listenPath`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),t.add(`key`,`gain`,{gain:1},{channels:`mono`}).add(`keyHp`,`filter`,{frequency:80,Q:.707,detune:0},{type:`highpass`}).add(`follow`,`follower`,{attack:.003,release:.12}).add(`sense`,`gain`,{gain:vt}).add(`keyShape`,`waveshaper`,{},{curve:`soft`}).add(`duckMeter`,`meter`,{},{channel:`mono`}).add(`depth`,`gain`,{gain:0}).connect(`key`,`keyHp`).connect(`keyHp`,`follow`).connect(`follow`,`sense`).connect(`sense`,`keyShape`).connect(`keyShape`,`duckMeter`).connect(`keyShape`,`depth`).connect(`depth`,`duck`,`gain`).connect(`keyHp`,`listenPath`),this.inputList.push({name:`in`,nodeId:`in`},{name:`key`,nodeId:`key`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`in`,nodeId:`inMeter`},{name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`},{name:`duck`,nodeId:`duckMeter`});let n=ht,r=(e,t,r,i,a,o,s)=>this.controlList.push(new y(e,t,r,i,n[e],a,o,s));r(`bc.threshold`,`Threshold`,-60,0,`dB`,e=>{this.threshold=e,t.setParam(`comp`,`threshold`,e),this.applyMix()}),r(`bc.ratio`,`Ratio`,1,20,`:1`,e=>{this.ratio=e,t.setParam(`comp`,`ratio`,e),this.applyMix()}),r(`bc.attack`,`Attack`,.3,100,`ms`,e=>t.setParam(`comp`,`attack`,e/1e3),`log`),r(`bc.release`,`Release`,30,1e3,`ms`,e=>t.setParam(`comp`,`release`,e/1e3),`log`),r(`bc.knee`,`Knee`,0,30,`dB`,e=>{this.knee=e,t.setParam(`comp`,`knee`,e),this.applyMix()}),r(`bc.makeup`,`Make-up`,0,24,`dB`,e=>{this.makeupDb=e,this.applyMix()}),r(`bc.mix`,`Mix`,0,1,``,e=>{this.mix=e,this.applyMix()}),r(`bc.duck.depth`,`Duck depth`,0,1,``,e=>t.setParam(`depth`,`gain`,-e)),r(`bc.duck.release`,`Duck release`,20,800,`ms`,e=>t.setParam(`follow`,`release`,e/1e3),`log`),r(`bc.duck.keyHp`,`Key HP`,20,300,`Hz`,e=>t.setParam(`keyHp`,`frequency`,e),`log`),this.controlList.push(new x(`bc.bypass`,`Bypass`,!1,e=>{this.bypass=e,this.applyPaths()}),new x(`bc.listen`,`Key listen`,!1,e=>{this.listen=e,this.applyPaths()}))}applyMix(){this.circuit.setParam(`dry`,`gain`,1-this.mix),this.circuit.setParam(`wet`,`gain`,this.mix*yt(this.makeupDb-bt(this.threshold,this.ratio,this.knee)))}applyPaths(){let e=this.circuit;e.setParam(`gate`,`gain`,this.bypass||this.listen?0:1),e.setParam(`bypassPath`,`gain`,this.bypass&&!this.listen?1:0),e.setParam(`listenPath`,`gain`,+!!this.listen)}loadPreset(e){let t={...ht,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`bc.bypass`&&t.id!==`bc.listen`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}},St=[`internal`,`midi`],Ct=[`omni`,...Array.from({length:16},(e,t)=>String(t+1))],wt=2e3,Tt=4,Et=class{clock;now;sync=new b(`transport.sync`,`Sync`,St,`internal`,()=>{});followStartStop=new x(`transport.followStartStop`,`Start/stop`,!0,()=>{});channel=new b(`transport.channel`,`Channel`,Ct,`1`,()=>{});tempo=new y(`transport.tempo`,`Tempo`,20,300,120,`BPM`,()=>{});taps=[];constructor(e,t=()=>performance.now()){this.clock=e,this.now=t}get synced(){return this.sync.value===`midi`}get bpm(){return this.synced?this.clock.bpm??this.tempo.value:this.tempo.value}get locked(){return this.synced&&this.clock.isLocked(this.now())}get running(){return this.synced&&this.followStartStop.value&&this.clock.running}get position(){return this.running?this.clock.position:dt(0)}acceptsChannel(e){return this.channel.value===`omni`||Number(this.channel.value)===e}tap(e=this.now()){let t=this.taps[this.taps.length-1];if(t!==void 0&&e-t>wt&&(this.taps=[]),this.taps.push(e),this.taps.length>Tt&&this.taps.shift(),this.taps.length>=2){let e=this.taps[this.taps.length-1]-this.taps[0];this.tempo.set(Math.round(6e4/(e/(this.taps.length-1))*10)/10)}}nudge(e){this.tempo.set(Math.round((this.tempo.value+e)*10)/10)}},Dt=[`kick`,`snare`,`clap`,`closedHat`,`openHat`,`ride`],Ot=[`rim`,`lowTom`,`midTom`,`highTom`,`cowbell`,`crash`],kt=[...Dt,...Ot],At=[...Dt,`perc`],jt={35:`kick`,36:`kick`,38:`snare`,40:`snare`,39:`clap`,42:`closedHat`,44:`closedHat`,46:`openHat`,51:`ride`,59:`ride`,37:`rim`,41:`lowTom`,43:`lowTom`,45:`midTom`,47:`midTom`,48:`highTom`,50:`highTom`,56:`cowbell`,49:`crash`,57:`crash`},Mt=1200,Nt=[205.3,304.4,369.6,522.7,540,800],Pt=1.5,Ft=class extends v{name;transport;choke=new x(`hats.choke`,`Choke`,!0,()=>{});muted=new Set;soloed=new Set;envelopes=new Map;hitListeners=new Set;constructor(e=`Drums`,t=new _){super(),this.name=e,this.transport=new Et(t),this.transport.channel.set(`10`);let n=this.circuit;this.addKick(n),this.addSnare(n),this.addClap(n),this.addHat(n,`closedHat`,{decay:[.015,.25,.04],tone:.7,level:.6}),this.addHat(n,`openHat`,{decay:[.1,1.5,.32],tone:.65,level:.6}),this.addRide(n),this.addRim(n),this.addTom(n,`lowTom`,100),this.addTom(n,`midTom`,145),this.addTom(n,`highTom`,200),this.addCowbell(n),this.addCrash(n),n.add(`perc.out`,`gain`,{gain:1});for(let e of kt)n.add(`${e}.mute`,`gain`,{gain:1}).add(`${e}.out`,`gain`,{gain:.8}).add(`${e}.meter`,`meter`,{},{channel:`mono`}).connect(`${e}.sum`,`${e}.mute`).connect(`${e}.mute`,`${e}.out`).connect(`${e}.out`,`${e}.meter`),this.meterList.push({name:e,nodeId:`${e}.meter`}),Ot.includes(e)?n.connect(`${e}.out`,`perc.out`):this.outputList.push({name:e,nodeId:`${e}.out`});this.outputList.push({name:`perc`,nodeId:`perc.out`}),this.addLevels(n),this.controlList.push(this.choke)}trigger(e,t=1,n){if(!(t<=0)){e===`closedHat`&&this.choke.value&&this.circuit.choke(`openHat.ampEnv`,n);for(let r of this.envelopes.get(e)??[])this.circuit.trigger(r,t,n);for(let r of this.hitListeners)r(e,t,n)}}onHit(e){return this.hitListeners.add(e),()=>this.hitListeners.delete(e)}handleMidi(e){if(e.type!==`noteOn`||!this.transport.acceptsChannel(e.channel))return;let t=jt[e.note];t&&this.trigger(t,e.velocity/127)}get soloActive(){return this.soloed.size>0}register(e,...t){this.envelopes.set(e,[...this.envelopes.get(e)??[],...t])}num(...e){let t=new y(...e);return this.controlList.push(t),t}addKick(e){this.register(`kick`,`kick.pitchEnv`,`kick.ampEnv`,`kick.clickEnv`),e.add(`kick.osc`,`oscillator`,{frequency:48,detune:0},{waveform:`sine`}).add(`kick.pitchEnv`,`trigger`,{peak:2700,decay:.05,velSens:0}).add(`kick.ampEnv`,`trigger`,{peak:.8,decay:.38,velSens:.8}).add(`kick.amp`,`gain`,{gain:0}).add(`kick.noise`,`noise`).add(`kick.clickHp`,`filter`,{frequency:2500,Q:.707},{type:`highpass`}).add(`kick.clickAmp`,`gain`,{gain:0}).add(`kick.clickEnv`,`trigger`,{peak:.24,decay:.012,velSens:1}).add(`kick.sum`,`gain`,{gain:1}).connect(`kick.pitchEnv`,`kick.osc`,`detune`).connect(`kick.osc`,`kick.amp`).connect(`kick.ampEnv`,`kick.amp`,`gain`).connect(`kick.amp`,`kick.sum`).connect(`kick.noise`,`kick.clickHp`).connect(`kick.clickHp`,`kick.clickAmp`).connect(`kick.clickEnv`,`kick.clickAmp`,`gain`).connect(`kick.clickAmp`,`kick.sum`),this.num(`kick.tune`,`Tune`,30,120,48,`Hz`,t=>e.setParam(`kick.osc`,`frequency`,t),`log`),this.num(`kick.decay`,`Decay`,.08,1,.38,`s`,t=>e.setParam(`kick.ampEnv`,`decay`,t),`log`),this.num(`kick.click`,`Click`,0,1,.4,``,t=>e.setParam(`kick.clickEnv`,`peak`,t*.6))}addSnare(e){this.register(`snare`,`snare.pitchEnv`,`snare.bodyEnv`,`snare.noiseEnv`),e.add(`snare.osc1`,`oscillator`,{frequency:190,detune:0},{waveform:`triangle`}).add(`snare.osc2`,`oscillator`,{frequency:347.7,detune:0},{waveform:`triangle`}).add(`snare.pitchEnv`,`trigger`,{peak:500,decay:.03,velSens:0}).add(`snare.bodyEnv`,`trigger`,{peak:.4,decay:.1,velSens:.7}).add(`snare.bodyAmp`,`gain`,{gain:0}).add(`snare.noise`,`noise`).add(`snare.noiseHp`,`filter`,{frequency:1800,Q:.707},{type:`highpass`}).add(`snare.noiseEnv`,`trigger`,{peak:.42,decay:.18,velSens:1}).add(`snare.noiseAmp`,`gain`,{gain:0}).add(`snare.sum`,`gain`,{gain:1}).connect(`snare.osc1`,`snare.bodyAmp`).connect(`snare.osc2`,`snare.bodyAmp`).connect(`snare.pitchEnv`,`snare.osc1`,`detune`).connect(`snare.pitchEnv`,`snare.osc2`,`detune`).connect(`snare.bodyEnv`,`snare.bodyAmp`,`gain`).connect(`snare.bodyAmp`,`snare.sum`).connect(`snare.noise`,`snare.noiseHp`).connect(`snare.noiseHp`,`snare.noiseAmp`).connect(`snare.noiseEnv`,`snare.noiseAmp`,`gain`).connect(`snare.noiseAmp`,`snare.sum`),this.num(`snare.tune`,`Tune`,120,300,190,`Hz`,t=>{e.setParam(`snare.osc1`,`frequency`,t),e.setParam(`snare.osc2`,`frequency`,t*1.83)},`log`),this.num(`snare.decay`,`Decay`,.08,.5,.18,`s`,t=>{e.setParam(`snare.noiseEnv`,`decay`,t),e.setParam(`snare.bodyEnv`,`decay`,t*.55)},`log`),this.num(`snare.snap`,`Snap`,0,1,.6,``,t=>e.setParam(`snare.noiseEnv`,`peak`,t*.7))}addClap(e){this.register(`clap`,`clap.env`),e.add(`clap.noise`,`noise`).add(`clap.bp`,`filter`,{frequency:1200,Q:1.5},{type:`bandpass`}).add(`clap.amp`,`gain`,{gain:0}).add(`clap.env`,`trigger`,{peak:2.3,decay:.24,velSens:.8,spread:.012},{shape:`clap`}).add(`clap.sum`,`gain`,{gain:1}).connect(`clap.noise`,`clap.bp`).connect(`clap.bp`,`clap.amp`).connect(`clap.env`,`clap.amp`,`gain`).connect(`clap.amp`,`clap.sum`),this.num(`clap.tone`,`Tone`,600,3e3,1200,`Hz`,t=>e.setParam(`clap.bp`,`frequency`,t),`log`),this.num(`clap.decay`,`Decay`,.08,.6,.24,`s`,t=>e.setParam(`clap.env`,`decay`,t),`log`),this.num(`clap.spread`,`Spread`,0,1,.5,``,t=>e.setParam(`clap.env`,`spread`,.006+t*.012))}addMetal(e,t,n,r,i,a){e.add(`${t}.tune`,`constant`,{offset:0}).add(`${t}.metal`,`gain`,{gain:a}).add(`${t}.bp`,`filter`,{frequency:r,Q:.8},{type:`bandpass`}).add(`${t}.hp`,`filter`,{frequency:i,Q:.707},{type:`highpass`}).connect(`${t}.metal`,`${t}.bp`).connect(`${t}.bp`,`${t}.hp`),Nt.forEach((r,i)=>{let a=`${t}.sq${i+1}`;e.add(a,`oscillator`,{frequency:r*n,detune:0},{waveform:`square`}).connect(`${t}.tune`,a,`detune`).connect(a,`${t}.metal`)})}addHat(e,t,n){this.register(t,`${t}.ampEnv`),this.addMetal(e,t,1,9e3,7e3,.45),e.add(`${t}.amp`,`gain`,{gain:0}).add(`${t}.ampEnv`,`trigger`,{peak:1,decay:n.decay[2],velSens:.8}).add(`${t}.sum`,`gain`,{gain:1}).connect(`${t}.hp`,`${t}.amp`).connect(`${t}.ampEnv`,`${t}.amp`,`gain`).connect(`${t}.amp`,`${t}.sum`),this.num(`${t}.tune`,`Tune`,0,1,.6,``,n=>e.setParam(`${t}.tune`,`offset`,(n-.6)*2*Mt)),this.num(`${t}.decay`,`Decay`,n.decay[0],n.decay[1],n.decay[2],`s`,n=>e.setParam(`${t}.ampEnv`,`decay`,n),`log`),this.num(`${t}.tone`,`Tone`,0,1,n.tone,``,n=>e.setParam(`${t}.hp`,`frequency`,3e3+n*7e3))}addRide(e){this.register(`ride`,`ride.ampEnv`,`ride.pingEnv`,`ride.bellEnv`,`ride.airEnv`,`ride.tickEnv`),e.add(`ride.sum`,`gain`,{gain:1}),this.addMetal(e,`ride`,1.75,7e3,3e3,.3),e.add(`ride.gritPre`,`gain`,{gain:2.2}).add(`ride.crush`,`waveshaper`,{bits:6},{curve:`crush`}).add(`ride.gritPost`,`gain`,{gain:.45}).connect(`ride.hp`,`ride.gritPre`).connect(`ride.gritPre`,`ride.crush`).connect(`ride.crush`,`ride.gritPost`).add(`ride.amp`,`gain`,{gain:0}).add(`ride.ampEnv`,`trigger`,{peak:.6,decay:1.4,velSens:.8}).connect(`ride.gritPost`,`ride.amp`).connect(`ride.ampEnv`,`ride.amp`,`gain`).add(`ride.pingBp`,`filter`,{frequency:5200,Q:1.4},{type:`bandpass`}).add(`ride.pingAmp`,`gain`,{gain:0}).add(`ride.pingEnv`,`trigger`,{peak:1.4,decay:.06,velSens:.9}).connect(`ride.gritPost`,`ride.pingBp`).connect(`ride.pingBp`,`ride.pingAmp`).connect(`ride.pingEnv`,`ride.pingAmp`,`gain`).add(`ride.bellBp`,`filter`,{frequency:3300,Q:10},{type:`bandpass`}).add(`ride.bellAmp`,`gain`,{gain:0}).add(`ride.bellEnv`,`trigger`,{peak:.4,decay:.55,velSens:.8}).connect(`ride.metal`,`ride.bellBp`).connect(`ride.bellBp`,`ride.bellAmp`).connect(`ride.bellEnv`,`ride.bellAmp`,`gain`).add(`ride.noise`,`noise`).add(`ride.airHp`,`filter`,{frequency:9e3,Q:.707},{type:`highpass`}).add(`ride.airAmp`,`gain`,{gain:0}).add(`ride.airEnv`,`trigger`,{peak:.1,decay:1.1,velSens:.8}).add(`ride.tickHp`,`filter`,{frequency:5e3,Q:.707},{type:`highpass`}).add(`ride.tickAmp`,`gain`,{gain:0}).add(`ride.tickEnv`,`trigger`,{peak:.3,decay:.005,velSens:1}).connect(`ride.noise`,`ride.airHp`).connect(`ride.airHp`,`ride.airAmp`).connect(`ride.airEnv`,`ride.airAmp`,`gain`).connect(`ride.noise`,`ride.tickHp`).connect(`ride.tickHp`,`ride.tickAmp`).connect(`ride.tickEnv`,`ride.tickAmp`,`gain`).add(`ride.layers`,`gain`,{gain:Pt});for(let t of[`ride.amp`,`ride.pingAmp`,`ride.bellAmp`,`ride.airAmp`,`ride.tickAmp`])e.connect(t,`ride.layers`);e.connect(`ride.layers`,`ride.sum`),this.num(`ride.tune`,`Tune`,0,1,.5,``,t=>e.setParam(`ride.tune`,`offset`,(t-.5)*2*Mt)),this.num(`ride.decay`,`Decay`,.3,2.5,.75,`s`,t=>{e.setParam(`ride.ampEnv`,`decay`,t*1.15),e.setParam(`ride.airEnv`,`decay`,t*.9),e.setParam(`ride.bellEnv`,`decay`,t*.45)},`log`),this.num(`ride.bell`,`Bell`,0,1,.45,``,t=>e.setParam(`ride.bellEnv`,`peak`,t*.9))}addRim(e){this.register(`rim`,`rim.toneEnv`,`rim.clickEnv`),e.add(`rim.osc1`,`oscillator`,{frequency:480,detune:0},{waveform:`triangle`}).add(`rim.osc2`,`oscillator`,{frequency:1720,detune:0},{waveform:`sine`}).add(`rim.tune`,`constant`,{offset:0}).add(`rim.bp`,`filter`,{frequency:1600,Q:2.2},{type:`bandpass`}).add(`rim.toneAmp`,`gain`,{gain:0}).add(`rim.toneEnv`,`trigger`,{peak:1.4,decay:.03,velSens:.8}).add(`rim.noise`,`noise`).add(`rim.hp`,`filter`,{frequency:5e3,Q:.707},{type:`highpass`}).add(`rim.clickAmp`,`gain`,{gain:0}).add(`rim.clickEnv`,`trigger`,{peak:.3,decay:.008,velSens:1}).add(`rim.sum`,`gain`,{gain:1}).connect(`rim.tune`,`rim.osc1`,`detune`).connect(`rim.tune`,`rim.osc2`,`detune`).connect(`rim.osc1`,`rim.bp`).connect(`rim.osc2`,`rim.bp`).connect(`rim.bp`,`rim.toneAmp`).connect(`rim.toneEnv`,`rim.toneAmp`,`gain`).connect(`rim.toneAmp`,`rim.sum`).connect(`rim.noise`,`rim.hp`).connect(`rim.hp`,`rim.clickAmp`).connect(`rim.clickEnv`,`rim.clickAmp`,`gain`).connect(`rim.clickAmp`,`rim.sum`),this.num(`rim.tune`,`Tune`,0,1,.5,``,t=>e.setParam(`rim.tune`,`offset`,(t-.5)*2*Mt)),this.num(`rim.decay`,`Decay`,.01,.12,.03,`s`,t=>e.setParam(`rim.toneEnv`,`decay`,t),`log`),this.num(`rim.tone`,`Tone`,600,4e3,1600,`Hz`,t=>e.setParam(`rim.bp`,`frequency`,t),`log`)}addTom(e,t,n){this.register(t,`${t}.pitchEnv`,`${t}.ampEnv`,`${t}.noiseEnv`),e.add(`${t}.osc`,`oscillator`,{frequency:n,detune:0},{waveform:`sine`}).add(`${t}.pitchEnv`,`trigger`,{peak:700,decay:.09,velSens:0}).add(`${t}.ampEnv`,`trigger`,{peak:.9,decay:.4,velSens:.8}).add(`${t}.amp`,`gain`,{gain:0}).add(`${t}.noise`,`noise`).add(`${t}.bp`,`filter`,{frequency:n*4,Q:1.2},{type:`bandpass`}).add(`${t}.noiseAmp`,`gain`,{gain:0}).add(`${t}.noiseEnv`,`trigger`,{peak:.12,decay:.06,velSens:1}).add(`${t}.sum`,`gain`,{gain:1}).connect(`${t}.pitchEnv`,`${t}.osc`,`detune`).connect(`${t}.osc`,`${t}.amp`).connect(`${t}.ampEnv`,`${t}.amp`,`gain`).connect(`${t}.amp`,`${t}.sum`).connect(`${t}.noise`,`${t}.bp`).connect(`${t}.bp`,`${t}.noiseAmp`).connect(`${t}.noiseEnv`,`${t}.noiseAmp`,`gain`).connect(`${t}.noiseAmp`,`${t}.sum`),this.num(`${t}.tune`,`Tune`,n*.6,n*1.6,n,`Hz`,n=>{e.setParam(`${t}.osc`,`frequency`,n),e.setParam(`${t}.bp`,`frequency`,n*4)},`log`),this.num(`${t}.decay`,`Decay`,.1,1.2,.4,`s`,n=>e.setParam(`${t}.ampEnv`,`decay`,n),`log`),this.num(`${t}.bend`,`Bend`,0,1,.5,``,n=>e.setParam(`${t}.pitchEnv`,`peak`,n*1400))}addCowbell(e){this.register(`cowbell`,`cowbell.strikeEnv`,`cowbell.env`,`cowbell.pitchEnv`),e.add(`cowbell.tune`,`constant`,{offset:0}).add(`cowbell.pitchEnv`,`trigger`,{peak:120,decay:.015,velSens:.5}).add(`cowbell.sq1`,`oscillator`,{frequency:540,detune:0},{waveform:`square`}).add(`cowbell.sq2`,`oscillator`,{frequency:800,detune:0},{waveform:`square`}).add(`cowbell.bp`,`filter`,{frequency:2640,Q:1.4},{type:`bandpass`}).add(`cowbell.lp`,`filter`,{frequency:5500,Q:.6},{type:`lowpass`}).add(`cowbell.amp`,`gain`,{gain:0}).add(`cowbell.strikeEnv`,`trigger`,{peak:.75,decay:.012,velSens:.9}).add(`cowbell.env`,`trigger`,{peak:.32,decay:.25,velSens:.7}).add(`cowbell.sum`,`gain`,{gain:1}).connect(`cowbell.tune`,`cowbell.sq1`,`detune`).connect(`cowbell.tune`,`cowbell.sq2`,`detune`).connect(`cowbell.pitchEnv`,`cowbell.sq1`,`detune`).connect(`cowbell.pitchEnv`,`cowbell.sq2`,`detune`).connect(`cowbell.sq1`,`cowbell.bp`).connect(`cowbell.sq2`,`cowbell.bp`).connect(`cowbell.bp`,`cowbell.lp`).connect(`cowbell.lp`,`cowbell.amp`).connect(`cowbell.strikeEnv`,`cowbell.amp`,`gain`).connect(`cowbell.env`,`cowbell.amp`,`gain`).connect(`cowbell.amp`,`cowbell.sum`),this.num(`cowbell.tune`,`Tune`,0,1,.5,``,t=>e.setParam(`cowbell.tune`,`offset`,(t-.5)*Mt)),this.num(`cowbell.decay`,`Decay`,.05,1,.25,`s`,t=>e.setParam(`cowbell.env`,`decay`,t),`log`),this.num(`cowbell.tone`,`Tone`,1e3,6e3,2640,`Hz`,t=>e.setParam(`cowbell.bp`,`frequency`,t),`log`)}addCrash(e){this.register(`crash`,`crash.ampEnv`,`crash.noiseEnv`),this.addMetal(e,`crash`,1.15,8e3,4500,.35),e.add(`crash.amp`,`gain`,{gain:0}).add(`crash.ampEnv`,`trigger`,{peak:1,decay:1.6,velSens:.8}).add(`crash.noise`,`noise`).add(`crash.noiseHp`,`filter`,{frequency:6e3,Q:.707},{type:`highpass`}).add(`crash.noiseAmp`,`gain`,{gain:0}).add(`crash.noiseEnv`,`trigger`,{peak:.3,decay:1.2,velSens:.8}).add(`crash.sum`,`gain`,{gain:1}).connect(`crash.hp`,`crash.amp`).connect(`crash.ampEnv`,`crash.amp`,`gain`).connect(`crash.amp`,`crash.sum`).connect(`crash.noise`,`crash.noiseHp`).connect(`crash.noiseHp`,`crash.noiseAmp`).connect(`crash.noiseEnv`,`crash.noiseAmp`,`gain`).connect(`crash.noiseAmp`,`crash.sum`),this.num(`crash.tune`,`Tune`,0,1,.5,``,t=>e.setParam(`crash.tune`,`offset`,(t-.5)*2*Mt)),this.num(`crash.decay`,`Decay`,.5,4,1.6,`s`,t=>{e.setParam(`crash.ampEnv`,`decay`,t),e.setParam(`crash.noiseEnv`,`decay`,t*.75)},`log`),this.num(`crash.tone`,`Tone`,0,1,.5,``,t=>e.setParam(`crash.hp`,`frequency`,2500+t*6e3))}addLevels(e){let t={kick:.8,snare:.75,clap:.7,closedHat:.6,openHat:.6,ride:.55,rim:.6,lowTom:.7,midTom:.7,highTom:.7,cowbell:.5,crash:.5};for(let n of kt)this.num(`${n}.level`,`Level`,0,1,t[n],``,t=>e.setParam(`${n}.out`,`gain`,t)),this.controlList.push(new x(`${n}.mute`,`Mute`,!1,e=>this.setFlag(this.muted,n,e)),new x(`${n}.solo`,`Solo`,!1,e=>this.setFlag(this.soloed,n,e)))}setFlag(e,t,n){n?e.add(t):e.delete(t);for(let e of kt){let t=`${e}.mute`;if(!this.circuit.nodes.has(t))continue;let n=this.muted.has(e)||this.soloed.size>0&&!this.soloed.has(e);this.circuit.setParam(t,`gain`,+!n)}}},It=[`small`,`medium`,`large`],Lt=3.5,S=Math.tanh(2.5)/2.5,Rt=2,zt=class extends v{name;constructor(e=`Reverb`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`pre`,`delay`,{delayTime:.02,maxTime:.3}).add(`conv`,`convolver`,{},{size:`medium`}).add(`lowcut`,`filter`,{frequency:150,Q:.707,detune:0},{type:`highpass`}).add(`damp`,`filter`,{frequency:5e3,Q:.707,detune:0},{type:`lowpass`}).add(`drive`,`gain`,{gain:Lt*S/Rt}).add(`sat`,`waveshaper`,{},{curve:`soft`}).add(`out`,`gain`,{gain:Rt}).connect(`in`,`pre`).connect(`pre`,`conv`).connect(`conv`,`lowcut`).connect(`lowcut`,`damp`).connect(`damp`,`drive`).connect(`drive`,`sat`).connect(`sat`,`out`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.controlList.push(new b(`reverb.size`,`Size`,It,`medium`,e=>t.setOption(`conv`,`size`,e)),new y(`reverb.predelay`,`Pre-delay`,0,250,20,`ms`,e=>t.setParam(`pre`,`delayTime`,e/1e3)),new y(`reverb.lowcut`,`Low cut`,40,600,150,`Hz`,e=>t.setParam(`lowcut`,`frequency`,e),`log`),new y(`reverb.damp`,`Damping`,1e3,16e3,5e3,`Hz`,e=>t.setParam(`damp`,`frequency`,e),`log`))}},Bt=class extends v{name;spread=.8;feedback=.45;constructor(e=`Delay`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`out`,`gain`,{gain:.5}).add(`wobble`,`oscillator`,{frequency:.9,detune:0},{waveform:`sine`}).add(`wobbleDepth`,`gain`,{gain:6e-4});for(let e of[`L`,`R`]){let n=t=>`${t}${e}`;t.add(n(`inGain`),`gain`,{gain:1}).add(n(`dly`),`delay`,{delayTime:.375,maxTime:2}).add(n(`tone`),`filter`,{frequency:3200,Q:.707,detune:0},{type:`lowpass`}).add(n(`hp`),`filter`,{frequency:120,Q:.707,detune:0},{type:`highpass`}).add(n(`drive`),`gain`,{gain:1.9}).add(n(`sat`),`waveshaper`,{},{curve:`soft`}).add(n(`make`),`gain`,{gain:S/1.9}).add(n(`fbSelf`),`gain`,{gain:0}).add(n(`fbCross`),`gain`,{gain:0}).add(n(`pan`),`pan`,{pan:e===`L`?-1:1}).connect(`in`,n(`inGain`)).connect(n(`inGain`),n(`dly`)).connect(n(`dly`),n(`tone`)).connect(n(`tone`),n(`hp`)).connect(n(`hp`),n(`drive`)).connect(n(`drive`),n(`sat`)).connect(n(`sat`),n(`make`)).connect(n(`make`),n(`fbSelf`)).connect(n(`make`),n(`fbCross`)).connect(n(`sat`),n(`pan`)).connect(n(`pan`),`out`).connect(`wobbleDepth`,n(`dly`),`delayTime`)}t.connect(`fbSelfL`,`dlyL`).connect(`fbCrossL`,`dlyR`).connect(`fbSelfR`,`dlyR`).connect(`fbCrossR`,`dlyL`).connect(`wobble`,`wobbleDepth`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`});let n=e=>{e(`L`),e(`R`)};this.controlList.push(new y(`delay.time`,`Time`,20,1500,375,`ms`,e=>n(n=>t.setParam(`dly${n}`,`delayTime`,e/1e3)),`log`),new y(`delay.feedback`,`Feedback`,0,1.1,.45,``,e=>{this.feedback=e,this.applyFeedback()}),new y(`delay.tone`,`Tone`,400,12e3,3200,`Hz`,e=>n(n=>t.setParam(`tone${n}`,`frequency`,e)),`log`),new y(`delay.spread`,`Ping-pong`,0,1,.8,``,e=>{this.spread=e,this.applyFeedback(),t.setParam(`inGainR`,`gain`,1-e)}),new y(`delay.wobble`,`Wobble`,0,1,.15,``,e=>t.setParam(`wobbleDepth`,`gain`,e*.004)),new y(`delay.drive`,`Drive`,0,1,.3,``,e=>{let r=1+e*3;n(e=>{t.setParam(`drive${e}`,`gain`,r),t.setParam(`make${e}`,`gain`,S/r)})}))}applyFeedback(){let e=this.circuit;for(let t of[`L`,`R`])e.setParam(`fbSelf${t}`,`gain`,this.feedback*(1-this.spread)),e.setParam(`fbCross${t}`,`gain`,this.feedback*this.spread)}},Vt=1,Ht=2,Ut=.8,Wt={"gr.position":.3,"gr.size":120,"gr.pitch":0,"gr.rate":12,"gr.spread":.5,"gr.cloud":.2,"gr.detune":0,"gr.shape":.3,"gr.reverse":0,"gr.feedback":0,"gr.mix":1,"gr.freeze":0,"gr.filter":2e4,"gr.reso":.7,"gr.drive":0,"gr.reverb":0,"gr.tone":8e3,"gr.tail":`medium`,"gr.play":0,"gr.attack":20,"gr.decay":300,"gr.sustain":.8,"gr.release":600},Gt=3.5,Kt=2,qt=7,Jt=(e,t)=>({name:e,values:t}),Yt=[Jt(`Init`,{}),Jt(`Cloud Wash`,{"gr.position":.5,"gr.size":350,"gr.rate":30,"gr.spread":1,"gr.cloud":.6,"gr.detune":12,"gr.shape":0,"gr.reverb":.35,"gr.tail":`large`}),Jt(`Frozen Pad`,{"gr.position":.15,"gr.size":700,"gr.rate":14,"gr.spread":.9,"gr.cloud":.25,"gr.detune":6,"gr.shape":0,"gr.freeze":1,"gr.filter":3500,"gr.reverb":.3,"gr.tail":`large`}),Jt(`Stutter`,{"gr.position":.02,"gr.size":90,"gr.rate":8,"gr.spread":.2,"gr.cloud":0,"gr.shape":.7}),Jt(`Octave Shimmer`,{"gr.position":.25,"gr.size":220,"gr.pitch":12,"gr.rate":24,"gr.spread":.8,"gr.cloud":.3,"gr.detune":8,"gr.feedback":.35,"gr.reverb":.25}),Jt(`Reverse Swell`,{"gr.position":.35,"gr.size":900,"gr.rate":6,"gr.spread":.6,"gr.cloud":.15,"gr.shape":0,"gr.reverse":1}),Jt(`Glitch Dust`,{"gr.position":.6,"gr.size":25,"gr.rate":70,"gr.spread":1,"gr.cloud":.9,"gr.detune":40,"gr.shape":.8,"gr.reverse":.3,"gr.drive":.35,"gr.filter":9e3,"gr.reso":3}),Jt(`Tape Drone`,{"gr.position":.1,"gr.size":500,"gr.pitch":-12,"gr.rate":18,"gr.spread":.4,"gr.cloud":.1,"gr.detune":4,"gr.shape":0,"gr.feedback":.6,"gr.filter":1800,"gr.reso":2,"gr.drive":.25})],Xt=class extends v{name;slots=[...Yt];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;noteListeners=new Set;performanceListeners=new Set;held=[];bend=0;modWheelValue=0;pitchSemitones=0;constructor(e=`Granular`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`grains`,`granular`,{maxTime:20,position:.3,size:.12,pitch:0,rate:12,spread:.5,cloud:.2,detune:0,shape:.3,reverse:0,feedback:0,freeze:0,play:0,attack:.02,decay:.3,sustain:.8,release:.6}).add(`filter`,`filter`,{frequency:2e4,Q:.7,gain:0,detune:0},{type:`lowpass`}).add(`preDrive`,`gain`,{gain:1}).add(`sat`,`waveshaper`,{},{curve:`soft`}).add(`postDrive`,`gain`,{gain:S}).add(`revSend`,`gain`,{gain:0}).add(`conv`,`convolver`,{},{size:`medium`}).add(`revTone`,`filter`,{frequency:8e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`revDrive`,`gain`,{gain:Gt*S/Kt}).add(`revSat`,`waveshaper`,{},{curve:`soft`}).add(`revOut`,`gain`,{gain:Kt}).add(`wet`,`gain`,{gain:1}).add(`dry`,`gain`,{gain:0}).add(`out`,`gain`,{gain:1}).add(`inMeter`,`meter`,{},{channel:`mono`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`grains`).connect(`in`,`dry`).connect(`in`,`inMeter`).connect(`grains`,`filter`).connect(`filter`,`preDrive`).connect(`preDrive`,`sat`).connect(`sat`,`postDrive`).connect(`postDrive`,`wet`).connect(`wet`,`out`).connect(`postDrive`,`revSend`).connect(`revSend`,`conv`).connect(`conv`,`revTone`).connect(`revTone`,`revDrive`).connect(`revDrive`,`revSat`).connect(`revSat`,`revOut`).connect(`revOut`,`out`).connect(`dry`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`in`,nodeId:`inMeter`},{name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=Wt,r=(e,t,r,i,a,o,s)=>this.controlList.push(new y(e,t,r,i,n[e],a,o,s)),i=(e,n,i,a,o,s,c=1,l)=>r(e,n,i,a,o,e=>t.setParam(`grains`,s,e*c),l);i(`gr.position`,`Position`,0,1,``,`position`),i(`gr.size`,`Size`,5,2e3,`ms`,`size`,1/1e3,`log`),r(`gr.pitch`,`Pitch`,-24,24,`st`,e=>{this.pitchSemitones=e,this.applyPitch()}),i(`gr.rate`,`Rate`,.5,100,`Hz`,`rate`,1,`log`),i(`gr.spread`,`Spread`,0,1,``,`spread`),i(`gr.cloud`,`Cloud`,0,1,``,`cloud`),i(`gr.detune`,`Detune`,0,100,`ct`,`detune`),i(`gr.shape`,`Shape`,0,1,``,`shape`),i(`gr.reverse`,`Reverse`,0,1,``,`reverse`),i(`gr.feedback`,`Feedback`,0,.95,``,`feedback`),r(`gr.filter`,`Filter`,40,2e4,`Hz`,e=>t.setParam(`filter`,`frequency`,e),`log`),r(`gr.reso`,`Reso`,.7,12,``,e=>t.setParam(`filter`,`Q`,e),`log`),r(`gr.drive`,`Drive`,0,1,``,e=>{t.setParam(`preDrive`,`gain`,1+qt*e),t.setParam(`postDrive`,`gain`,S/(1+2*e))}),r(`gr.reverb`,`Reverb`,0,1,``,e=>t.setParam(`revSend`,`gain`,e)),r(`gr.tone`,`Tone`,1e3,16e3,`Hz`,e=>t.setParam(`revTone`,`frequency`,e),`log`),r(`gr.mix`,`Mix`,0,1,``,e=>{t.setParam(`wet`,`gain`,e),t.setParam(`dry`,`gain`,1-e)}),r(`gr.attack`,`Attack`,1,4e3,`ms`,e=>t.setParam(`grains`,`attack`,e/1e3),`log`),r(`gr.decay`,`Decay`,5,4e3,`ms`,e=>t.setParam(`grains`,`decay`,e/1e3),`log`),r(`gr.sustain`,`Sustain`,0,1,``,e=>t.setParam(`grains`,`sustain`,e)),r(`gr.release`,`Release`,5,8e3,`ms`,e=>t.setParam(`grains`,`release`,e/1e3),`log`),this.controlList.push(new x(`gr.play`,`Keys`,!1,e=>{t.setParam(`grains`,`play`,+!!e),e||this.releaseAll()}),new b(`gr.channel`,`MIDI channel`,Ct,`3`,()=>{}),new b(`gr.tail`,`Tail`,It,`medium`,e=>t.setOption(`conv`,`size`,e)),new x(`gr.freeze`,`Freeze`,!1,e=>t.setParam(`grains`,`freeze`,+!!e)))}applyPitch(){this.circuit.setParam(`grains`,`pitch`,this.pitchSemitones+this.bend*Ht)}releaseAll(){if(this.circuit.allNotesOff(`grains`),this.held.length>0){this.held=[];for(let e of this.noteListeners)e()}}keyDown(e,t=Ut){let n=this.control(`gr.play`);n.kind===`toggle`&&!n.value&&n.set(!0),this.held=this.held.filter(t=>t!==e),this.held.push(e),this.circuit.noteOn(`grains`,e,t);for(let e of this.noteListeners)e()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.circuit.noteOff(`grains`,e);for(let e of this.noteListeners)e()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.applyPitch();for(let e of this.performanceListeners)e()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e));for(let e of this.performanceListeners)e()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(!(`channel`in e))return;let t=this.control(`gr.channel`);if(!(t.kind!==`choice`||t.value!==`omni`&&Number(t.value)!==e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity/127);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===Vt&&this.setModWheel(e.value/127);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...Wt,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`gr.channel`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}},Zt=[`series`,`parallel`,`pingpong`],Qt=[`lfo`,`env`],$t=[`tri`,`ramp`,`sqr`,`rnd`],en=[`lp`,`hp`],tn=[`a`,`b`],C=e=>e.toUpperCase(),nn=.25,rn=3600,an=.8,on=.5,sn=1,cn=8e-4,ln={"ouro.input":1,"ouro.mix":.5,"ouro.output":1,"ouro.routing":`parallel`,"ouro.kill":0,"ouro.freeze":0,"ouro.a.on":1,"ouro.a.gain":1,"ouro.a.delay":380,"ouro.a.grit":.15,"ouro.a.cutoff":3e3,"ouro.a.resonance":1.2,"ouro.a.filter":`lp`,"ouro.a.clip":.25,"ouro.a.level":1,"ouro.b.on":1,"ouro.b.gain":1,"ouro.b.delay":530,"ouro.b.grit":.15,"ouro.b.cutoff":2200,"ouro.b.resonance":1.2,"ouro.b.filter":`lp`,"ouro.b.clip":.25,"ouro.b.level":1,"ouro.fb.aa":.35,"ouro.fb.ab":.15,"ouro.fb.ba":.15,"ouro.fb.bb":.35,"ouro.mod.mode":`lfo`,"ouro.mod.wave":`tri`,"ouro.mod.rate":.8,"ouro.mod.depth":.4,"ouro.mod.trigger":0,"ouro.mod.dlyA":.15,"ouro.mod.dlyB":-.15,"ouro.mod.cutA":0,"ouro.mod.cutB":0,"ouro.mod.gainA":0,"ouro.mod.gainB":0},un=(e,t)=>({name:e,values:t}),dn=[un(`Tape Spiral`,{"ouro.routing":`series`,"ouro.a.delay":240,"ouro.b.delay":360,"ouro.fb.aa":.35,"ouro.fb.bb":.4,"ouro.fb.ab":0,"ouro.fb.ba":.15,"ouro.a.grit":.35,"ouro.a.cutoff":2200,"ouro.b.cutoff":1800,"ouro.mod.rate":.4,"ouro.mod.depth":.6,"ouro.mod.dlyA":.3,"ouro.mod.dlyB":.2,"ouro.mod.cutA":.1}),un(`Karaoke Drone`,{"ouro.mix":.7,"ouro.fb.aa":.95,"ouro.fb.bb":.95,"ouro.a.gain":1.6,"ouro.b.gain":1.6,"ouro.a.grit":.5,"ouro.b.grit":.5,"ouro.a.clip":.6,"ouro.b.clip":.6,"ouro.a.delay":700,"ouro.b.delay":910,"ouro.a.cutoff":1400,"ouro.b.cutoff":1e3,"ouro.a.resonance":4,"ouro.b.resonance":4}),un(`Ping Pong Mayhem`,{"ouro.routing":`pingpong`,"ouro.mix":.6,"ouro.a.delay":280,"ouro.b.delay":280,"ouro.fb.ab":0,"ouro.fb.ba":.15,"ouro.fb.aa":.1,"ouro.fb.bb":.1,"ouro.a.resonance":.7,"ouro.b.resonance":.7,"ouro.a.grit":.1,"ouro.mod.depth":0}),un(`Dub Wash`,{"ouro.routing":`series`,"ouro.mix":.45,"ouro.a.delay":480,"ouro.b.delay":720,"ouro.fb.aa":.6,"ouro.fb.bb":.5,"ouro.fb.ab":.1,"ouro.fb.ba":.1,"ouro.a.cutoff":1800,"ouro.b.cutoff":1200,"ouro.a.resonance":2.5,"ouro.b.resonance":2.5,"ouro.a.clip":.2,"ouro.mod.rate":.25,"ouro.mod.depth":.5,"ouro.mod.cutA":.4,"ouro.mod.cutB":.3}),un(`Self Oscillator`,{"ouro.input":.2,"ouro.mix":1,"ouro.fb.aa":1.1,"ouro.fb.bb":1.1,"ouro.fb.ab":.3,"ouro.fb.ba":.3,"ouro.a.resonance":18,"ouro.b.resonance":18,"ouro.a.cutoff":800,"ouro.b.cutoff":1200,"ouro.a.clip":.5,"ouro.b.clip":.5,"ouro.a.delay":60,"ouro.b.delay":90,"ouro.mod.rate":.1,"ouro.mod.depth":.3,"ouro.mod.cutA":.5}),un(`Broken Echo`,{"ouro.a.grit":.85,"ouro.b.grit":.85,"ouro.a.delay":330,"ouro.b.delay":470,"ouro.fb.aa":.55,"ouro.fb.bb":.55,"ouro.a.clip":.7,"ouro.b.clip":.7,"ouro.mod.wave":`rnd`,"ouro.mod.rate":6,"ouro.mod.depth":.7,"ouro.mod.dlyA":.4,"ouro.mod.dlyB":-.3,"ouro.mod.gainA":.3}),un(`Filter Scream`,{"ouro.routing":`series`,"ouro.mix":.8,"ouro.a.filter":`hp`,"ouro.a.cutoff":2500,"ouro.a.resonance":16,"ouro.b.cutoff":1500,"ouro.b.resonance":16,"ouro.fb.aa":.6,"ouro.fb.bb":.6,"ouro.fb.ab":.2,"ouro.fb.ba":.1,"ouro.a.clip":.8,"ouro.b.clip":.8,"ouro.mod.wave":`ramp`,"ouro.mod.rate":2,"ouro.mod.depth":.8,"ouro.mod.cutA":.8,"ouro.mod.cutB":-.8}),un(`Slow Rot`,{"ouro.routing":`series`,"ouro.mix":.55,"ouro.a.delay":900,"ouro.b.delay":1300,"ouro.a.grit":.6,"ouro.b.grit":.6,"ouro.fb.aa":.55,"ouro.fb.bb":.55,"ouro.fb.ab":0,"ouro.fb.ba":.1,"ouro.a.cutoff":900,"ouro.b.cutoff":700,"ouro.a.resonance":1,"ouro.b.resonance":1,"ouro.mod.rate":.08,"ouro.mod.depth":.9,"ouro.mod.dlyA":.5,"ouro.mod.dlyB":.4,"ouro.a.level":.9,"ouro.b.level":.9})],fn=class extends v{name;slots=[...dn];currentSlot=0;currentPreset=this.slots[0];fb={aa:.35,ab:.15,ba:.15,bb:.35};on={a:!0,b:!0};clipDrive={a:1.25,b:1.25};routing=`parallel`;killed=!1;frozen=!1;modRate=.8;presetListeners=new Set;constructor(e=`Ouroboros`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`mono`,`gain`,{gain:1},{channels:`mono`}).add(`inGain`,`gain`,{gain:1}).add(`srcGate`,`gain`,{gain:1}).add(`srcA`,`gain`,{gain:1}).add(`srcB`,`gain`,{gain:1}).add(`dry`,`gain`,{gain:Math.SQRT1_2}).add(`wet`,`gain`,{gain:Math.SQRT1_2}).add(`sum`,`gain`,{gain:1}).add(`out`,`gain`,{gain:1}).connect(`in`,`mono`).connect(`mono`,`inGain`).connect(`inGain`,`srcGate`).connect(`srcGate`,`srcA`).connect(`srcGate`,`srcB`).connect(`in`,`dry`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`out`).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`L`,nodeId:`meterL`},{name:`R`,nodeId:`meterR`});for(let e of tn)this.addChannel(t,e);t.add(`linkAB`,`gain`,{gain:0}).add(`bounceBA`,`gain`,{gain:0}).connect(`lvlA`,`linkAB`).connect(`linkAB`,`inB`).connect(`lvlB`,`bounceBA`).connect(`bounceBA`,`inA`).connect(`srcA`,`inA`).connect(`srcB`,`inB`);for(let e of tn)for(let n of tn)t.add(`fb${C(e)}${C(n)}`,`gain`,{gain:0}).connect(`clip${C(e)}`,`fb${C(e)}${C(n)}`).connect(`fb${C(e)}${C(n)}`,`in${C(n)}`);t.add(`seedNoise`,`noise`).add(`seedGain`,`gain`,{gain:cn}).connect(`seedNoise`,`seedGain`).connect(`seedGain`,`inA`).connect(`seedGain`,`inB`),this.addModulator(t),this.addControls(t),this.applyRouting(),this.applyFeedback()}loadPreset(e){let t={...ln,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`ouro.kill`&&t.id!==`ouro.mod.trigger`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}addChannel(e,t){let n=C(t);e.add(`in${n}`,`gain`,{gain:1}).add(`on${n}`,`gain`,{gain:1}).add(`g${n}`,`gain`,{gain:S}).add(`sg${n}`,`waveshaper`,{},{curve:`soft`}).add(`dly${n}`,`delay`,{delayTime:.38,maxTime:2}).add(`tone${n}`,`filter`,{frequency:4800,Q:.707,detune:0},{type:`lowpass`}).add(`crush${n}`,`waveshaper`,{bits:16},{curve:`crush`}).add(`filt${n}`,`filter`,{frequency:3e3,Q:1.2,detune:0},{type:`lowpass`}).add(`cdrive${n}`,`gain`,{gain:S}).add(`clip${n}`,`waveshaper`,{},{curve:`soft`}).add(`lvl${n}`,`gain`,{gain:1}).add(`send${n}`,`gain`,{gain:1}).add(`pan${n}`,`pan`,{pan:t===`a`?-1:1}).connect(`in${n}`,`on${n}`).connect(`on${n}`,`g${n}`).connect(`g${n}`,`sg${n}`).connect(`sg${n}`,`dly${n}`).connect(`dly${n}`,`tone${n}`).connect(`tone${n}`,`crush${n}`).connect(`crush${n}`,`filt${n}`).connect(`filt${n}`,`cdrive${n}`).connect(`cdrive${n}`,`clip${n}`).connect(`clip${n}`,`lvl${n}`).connect(`lvl${n}`,`send${n}`).connect(`send${n}`,`pan${n}`).connect(`pan${n}`,`wet`)}addModulator(e){e.add(`lfoOsc`,`oscillator`,{frequency:.8,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:.8}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfoGate`,`gain`,{gain:1}).add(`follow`,`waveshaper`,{},{curve:`abs`}).add(`followLp`,`filter`,{frequency:.8,Q:.707,detune:0},{type:`lowpass`}).add(`followGain`,`gain`,{gain:4}).add(`modTrig`,`trigger`,{peak:1,decay:.6,velSens:0}).add(`envGate`,`gain`,{gain:0}).add(`mod`,`gain`,{gain:1}).add(`modOut`,`gain`,{gain:.4}).connect(`lfoOsc`,`lfoOscOut`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoOscOut`,`lfoGate`).connect(`lfoRndOut`,`lfoGate`).connect(`inGain`,`follow`).connect(`follow`,`followLp`).connect(`followLp`,`followGain`).connect(`followGain`,`envGate`).connect(`modTrig`,`envGate`).connect(`lfoGate`,`mod`).connect(`envGate`,`mod`).connect(`mod`,`modOut`);for(let t of tn){let n=C(t);e.add(`mDly${n}`,`gain`,{gain:0}).add(`mCut${n}`,`gain`,{gain:0}).add(`mGain${n}`,`gain`,{gain:0}).connect(`modOut`,`mDly${n}`).connect(`mDly${n}`,`dly${n}`,`delayTime`).connect(`modOut`,`mCut${n}`).connect(`mCut${n}`,`filt${n}`,`detune`).connect(`modOut`,`mGain${n}`).connect(`mGain${n}`,`g${n}`,`gain`)}}addControls(e){let t=ln,n=e=>t[e],r=(e,t,r,i,a,o,s)=>this.controlList.push(new y(e,t,r,i,n(e),a,o,s)),i=(e,n,r,i)=>this.controlList.push(new b(e,n,r,t[e],i));r(`ouro.input`,`Input`,0,2,``,t=>e.setParam(`inGain`,`gain`,t)),r(`ouro.mix`,`Mix`,0,1,``,t=>{e.setParam(`dry`,`gain`,Math.cos(t*Math.PI/2)),e.setParam(`wet`,`gain`,Math.sin(t*Math.PI/2))}),r(`ouro.output`,`Output`,0,1.5,``,t=>e.setParam(`out`,`gain`,t)),i(`ouro.routing`,`Routing`,Zt,e=>{this.routing=e,this.applyRouting(),this.applyFeedback()}),this.controlList.push(new x(`ouro.kill`,`Kill`,!1,e=>{this.killed=e,this.applyFeedback()}),new x(`ouro.freeze`,`Freeze`,!1,e=>{this.frozen=e,this.applyFeedback()}));for(let t of tn){let n=C(t),a=e=>`ouro.${t}.${e}`;this.controlList.push(new x(a(`on`),`On`,!0,r=>{this.on[t]=r,e.setParam(`on${n}`,`gain`,+!!r),this.applyFeedback()})),r(a(`gain`),`Gain`,.05,8,`×`,t=>e.setParam(`g${n}`,`gain`,t*S),`log`),r(a(`delay`),`Delay`,10,1800,`ms`,t=>e.setParam(`dly${n}`,`delayTime`,t/1e3),`log`),r(a(`grit`),`Grit`,0,1,``,t=>e.setParam(`crush${n}`,`bits`,16-t*13)),r(a(`cutoff`),`Cutoff`,20,18e3,`Hz`,t=>e.setParam(`filt${n}`,`frequency`,t),`log`),r(a(`resonance`),`Resonance`,.1,30,``,t=>e.setParam(`filt${n}`,`Q`,t)),i(a(`filter`),`Filter`,en,t=>e.setOption(`filt${n}`,`type`,t===`hp`?`highpass`:`lowpass`)),r(a(`clip`),`Clip`,0,1,``,r=>{let i=1+r*7;e.setParam(`cdrive${n}`,`gain`,S*i),this.clipDrive[t]=i,this.applyFeedback()}),r(a(`level`),`Level`,0,1.5,``,t=>e.setParam(`lvl${n}`,`gain`,t))}for(let[e,t]of[[`aa`,`A>A`],[`ab`,`A>B`],[`ba`,`B>A`],[`bb`,`B>B`]])r(`ouro.fb.${e}`,t,0,1.2,``,t=>{this.fb[e]=t,this.applyFeedback()});i(`ouro.mod.mode`,`Mode`,Qt,t=>{e.setParam(`lfoGate`,`gain`,+(t===`lfo`)),e.setParam(`envGate`,`gain`,+(t===`env`))}),i(`ouro.mod.wave`,`Wave`,$t,t=>{e.setOption(`lfoOsc`,`waveform`,t===`sqr`?`square`:t===`ramp`?`sawtooth`:`triangle`),e.setParam(`lfoOscOut`,`gain`,t===`rnd`?0:1),e.setParam(`lfoRndOut`,`gain`,+(t===`rnd`))}),r(`ouro.mod.rate`,`Rate`,.05,30,`Hz`,t=>{this.modRate=t,e.setParam(`lfoOsc`,`frequency`,t),e.setParam(`lfoRnd`,`rate`,t),e.setParam(`followLp`,`frequency`,t),e.setParam(`modTrig`,`decay`,Math.min(4,1.5/t))},`log`),r(`ouro.mod.depth`,`Depth`,0,1,``,t=>e.setParam(`modOut`,`gain`,t)),this.controlList.push(new x(`ouro.mod.trigger`,`Trigger`,!1,t=>{t&&e.trigger(`modTrig`,1)}));for(let t of tn){let n=C(t),i=(t,i,a,o)=>r(`ouro.mod.${t}${n}`,i,-1,1,``,t=>e.setParam(`${a}${n}`,`gain`,t*o));i(`dly`,`Delay ${n}`,`mDly`,nn),i(`cut`,`Cutoff ${n}`,`mCut`,rn),i(`gain`,`Gain ${n}`,`mGain`,an)}}applyRouting(){let e=this.circuit,t=this.routing===`series`,n=this.routing===`parallel`;e.setParam(`srcB`,`gain`,+!!n),e.setParam(`sendA`,`gain`,+!t),e.setParam(`panA`,`pan`,-1),e.setParam(`panB`,`pan`,+!t)}applyFeedback(){let e=this.circuit;for(let t of tn)for(let n of tn){let r=`${t}${n}`,i=this.fb[r]/this.clipDrive[t];this.frozen&&t===n&&(i=sn/this.clipDrive[t]),(this.killed||!this.on[t]||!this.on[n])&&(i=0),e.setParam(`fb${C(t)}${C(n)}`,`gain`,i)}let t=this.routing!==`parallel`;e.setParam(`linkAB`,`gain`,t?1/this.clipDrive.a:0);let n=this.routing===`pingpong`&&!this.killed&&this.on.a&&this.on.b;e.setParam(`bounceBA`,`gain`,n?on/this.clipDrive.b:0),e.setParam(`srcGate`,`gain`,+!this.frozen)}},pn={"osc1.wave":`saw`,"osc1.octave":`16`,"osc1.pw":0,"osc1.glide":0,"osc1.level":.8,"osc2.wave":`saw`,"osc2.octave":`8`,"osc2.detune":0,"osc2.glide":0,"osc2.level":.6,tune:0,sync:0,"vib.rate":5,"vib.level":0,noise:0,"route.vco":`nor`,"route.vcf":`lpf`,"route.mod":`single`,"filter.cutoff":1800,"filter.res":.2,"filter.post":0,"mod1.rise":.01,"mod1.fall":.5,"mod1.hold":0,"mod1.lfo":0,"mod1.level":.3,"mod2.rise":.01,"mod2.fall":.5,"mod2.hold":0,"mod2.lfo":0,"mod2.level":0,"vca.rise":.005,"vca.fall":.4,"vca.hold":1,"vca.lfo":0,"vca.level":.8,"reverb.time":.1,"reverb.decay":.35,"reverb.mix":.15,"play.legato":0,"play.mode":`duo`,"play.channel":0},mn=[`play.channel`],w=(e,t)=>({name:e,values:t}),hn=[w(`Init`,{}),w(`Fat Bass`,{"osc1.octave":`32`,"osc1.wave":`square`,"osc1.pw":.2,"osc2.octave":`16`,"osc2.detune":.1,"filter.cutoff":260,"filter.res":.35,"mod1.rise":.002,"mod1.fall":.35,"mod1.level":.55,"vca.fall":.2,"play.mode":`mono`}),w(`Hard Sync Lead`,{"osc1.octave":`16`,"osc2.octave":`8`,"osc2.detune":7,sync:1,"filter.cutoff":2600,"filter.res":.3,"mod2.level":.5,"route.mod":`dual`,"mod2.lfo":1,"mod2.rise":.35,"mod2.fall":.35,"vib.level":.3,"vib.rate":5.5,"osc1.glide":.15,"osc2.glide":.15}),w(`Dual Fifths`,{"osc1.octave":`16`,"osc2.octave":`16`,"osc2.detune":.01,"osc2.wave":`tri`,"filter.cutoff":1400,"mod1.level":.3,"mod1.fall":.8,"mod1.hold":1,"reverb.mix":.25,"reverb.decay":.5}),w(`Resonant Squelch`,{"osc1.octave":`16`,"osc1.wave":`square`,"osc2.level":.3,"filter.cutoff":200,"filter.res":.85,"mod1.rise":.002,"mod1.fall":.22,"mod1.level":.8,"vca.fall":.25,"play.mode":`mono`}),w(`Split Pad`,{"route.vco":`split`,"route.vcf":`even`,"route.mod":`split`,"osc1.octave":`16`,"osc2.octave":`8`,"osc2.wave":`tri`,"osc2.detune":.03,"filter.cutoff":700,"filter.post":1.2,"mod1.rise":.9,"mod1.fall":1.6,"mod1.hold":1,"mod1.level":.35,"mod2.rise":1.4,"mod2.fall":2,"mod2.hold":1,"mod2.level":.45,"vca.rise":.7,"vca.fall":1.6,"reverb.mix":.35,"reverb.decay":.6,"reverb.time":.3}),w(`Band Pass Voice`,{"route.vcf":`odd`,"route.vco":`half`,"osc1.octave":`16`,"osc2.octave":`8`,"osc2.detune":12,"filter.cutoff":900,"filter.res":.6,"filter.post":-.8,"mod1.rise":.1,"mod1.fall":.6,"mod1.level":.4}),w(`Wobble Bass`,{"osc1.octave":`32`,"osc2.octave":`16`,"osc2.detune":.08,"filter.cutoff":180,"filter.res":.6,"mod1.lfo":1,"mod1.rise":.18,"mod1.fall":.18,"mod1.level":.6,"play.mode":`mono`}),w(`Tremolo Organ`,{"osc1.wave":`square`,"osc1.octave":`16`,"osc2.wave":`tri`,"osc2.octave":`8`,"filter.cutoff":3500,"vca.lfo":1,"vca.hold":1,"vca.rise":.06,"vca.fall":.06,"vib.level":.1,"reverb.mix":.3}),w(`Noise Hat`,{"osc1.level":0,"osc2.level":0,noise:.9,"route.vcf":`hpf`,"filter.cutoff":7e3,"filter.res":.2,"vca.hold":0,"vca.rise":.001,"vca.fall":.09,"reverb.mix":.1}),w(`Ringing Filters`,{"route.vco":`vca`,"route.vcf":`even`,"osc1.level":.05,"osc2.level":0,"filter.cutoff":300,"filter.post":.6,"filter.res":1,"mod1.level":.2,"mod1.rise":.01,"mod1.fall":.6,"vca.rise":.01,"vca.fall":.5,"reverb.mix":.3}),w(`Infinite Cathedral`,{"osc1.octave":`8`,"osc2.octave":`8`,"osc2.wave":`tri`,"osc2.detune":.02,"filter.cutoff":2200,"mod1.level":.2,"vca.rise":.5,"vca.fall":2.5,"reverb.mix":.7,"reverb.decay":1,"reverb.time":.5}),w(`Pulse Sweep`,{"osc1.wave":`square`,"osc1.pw":.7,"osc1.octave":`16`,"osc2.octave":`16`,"filter.cutoff":500,"filter.res":.4,"mod1.rise":1.4,"mod1.fall":1.8,"mod1.hold":1,"mod1.level":.7,"vca.rise":.3}),w(`Glide Mono`,{"osc1.octave":`16`,"osc2.octave":`16`,"osc2.detune":.01,"osc1.glide":.35,"osc2.glide":.35,"filter.cutoff":1100,"filter.res":.45,"mod1.level":.4,"mod1.fall":.4,"play.mode":`mono`,"play.legato":1}),w(`Dual Detune Strings`,{"osc1.octave":`8`,"osc2.octave":`8`,"osc2.detune":.12,"filter.cutoff":1900,"mod1.level":.15,"vca.rise":.25,"vca.fall":.9,"vib.level":.15,"vib.rate":5.8,"reverb.mix":.3,"reverb.decay":.55}),w(`Hoover`,{"osc1.wave":`square`,"osc1.pw":.35,"osc1.octave":`16`,"osc2.wave":`saw`,"osc2.octave":`16`,"osc2.detune":0,tune:42,"osc1.glide":.45,"osc2.glide":.5,"osc1.level":.8,"osc2.level":.8,"filter.cutoff":2600,"filter.res":.45,"route.mod":`dual`,"mod1.level":.15,"mod1.fall":.6,"mod1.hold":1,"mod2.lfo":1,"mod2.rise":.4,"mod2.fall":.4,"mod2.level":.5,"vib.level":.3,"vib.rate":6.5,"vca.fall":.5,"reverb.mix":.3,"reverb.decay":.45,"reverb.time":.2,"play.legato":1}),w(`Filter Echo`,{"osc1.octave":`16`,"osc2.octave":`8`,"osc2.detune":12,"route.mod":`dual`,"filter.cutoff":800,"filter.res":.55,"mod2.lfo":1,"mod2.rise":.25,"mod2.fall":.4,"mod2.level":.5,"mod1.level":.4,"reverb.mix":.4,"reverb.decay":.75,"reverb.time":.4})],gn=Array.from({length:24},(e,t)=>hn[t]??w(`Init`,{})),_n=1,vn=64,yn={32:-24,16:-12,8:0},bn={16:-12,8:0,4:12},xn=`o1Wave.o1Off.o1Pw.o1Lvl.o1Gld.o2Wave.o2Off.o2Dtn.o2Lvl.o2Gld.tune.sync.vibRate.vibLvl.noise.vcoRoute.vcfRoute.modRoute.cutoff.res.post.m1Rise.m1Fall.m1Hold.m1Lfo.m1Lvl.m2Rise.m2Fall.m2Hold.m2Lfo.m2Lvl.vcaRise.vcaFall.vcaHold.vcaLfo.level.rvTime.rvDecay.rvMix.bend.modw`.split(`.`),Sn=class extends v{name;bendRange=3;slots=[...gn];currentSlot=0;currentPreset=this.slots[0];held=[];latched=new Set;pedal=!1;bend=0;modWheelValue=0;gate=!1;lastChannel=1;lockedChannel;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`MOA-DUO`){super(),this.name=e;let t=this.circuit;t.add(`synth`,`duo`,Object.fromEntries(xn.map(e=>[e,0]))).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`synth`,`meterL`).connect(`synth`,`meterR`),this.outputList.push({name:`out`,nodeId:`synth`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=pn,r=e=>n=>t.setParam(`synth`,e,n),i=(e,t,i,a,o,s,c)=>this.controlList.push(new y(e,t,i,a,n[e],o,r(s),c)),a=(e,t,i,a,o)=>this.controlList.push(new b(e,t,i,n[e],e=>r(a)(o?o(e):i.indexOf(e)))),o=(e,t,i)=>this.controlList.push(new x(e,t,n[e]>0,e=>r(i)(+!!e)));a(`osc1.wave`,`Wave`,[`saw`,`square`],`o1Wave`),a(`osc1.octave`,`Octave`,[`32`,`16`,`8`],`o1Off`,e=>yn[e]),i(`osc1.pw`,`Pulse width`,0,1,``,`o1Pw`),i(`osc1.glide`,`Glide`,0,1,``,`o1Gld`),i(`osc1.level`,`Level`,0,1,``,`o1Lvl`),a(`osc2.wave`,`Wave`,[`saw`,`tri`],`o2Wave`),a(`osc2.octave`,`Octave`,[`16`,`8`,`4`],`o2Off`,e=>bn[e]),i(`osc2.detune`,`Detune`,0,24,`st`,`o2Dtn`),i(`osc2.glide`,`Glide`,0,1,``,`o2Gld`),i(`osc2.level`,`Level`,0,1,``,`o2Lvl`),i(`tune`,`Tune`,-100,100,`ct`,`tune`),o(`sync`,`Sync`,`sync`),i(`vib.rate`,`Vibrato rate`,.1,20,`Hz`,`vibRate`,`log`),i(`vib.level`,`Vibrato level`,0,1,``,`vibLvl`),i(`noise`,`Noise`,0,1,``,`noise`),a(`route.vco`,`VCO routing`,[`nor`,`split`,`half`,`vca`],`vcoRoute`),a(`route.vcf`,`VCF routing`,[`lpf`,`hpf`,`even`,`odd`],`vcfRoute`),a(`route.mod`,`Mod routing`,[`single`,`dual`,`split`,`odd`],`modRoute`),i(`filter.cutoff`,`Cutoff`,20,2e4,`Hz`,`cutoff`,`log`),i(`filter.res`,`Resonance`,0,1,``,`res`),i(`filter.post`,`Post`,-4,4,`oct`,`post`);for(let[e,t]of[[`1`,`m1`],[`2`,`m2`],[`vca`,`vca`]]){let n=e===`vca`?`vca`:`mod${e}`;i(`${n}.rise`,`Rise`,.001,5,`s`,`${t}Rise`,`log`),i(`${n}.fall`,`Fall`,.01,15,`s`,`${t}Fall`,`log`),o(`${n}.hold`,`Hold`,`${t}Hold`),o(`${n}.lfo`,`LFO`,`${t}Lfo`),e!==`vca`&&i(`${n}.level`,`Level`,0,1,``,`${t}Lvl`)}i(`vca.level`,`Level`,0,1.5,``,`level`),i(`reverb.time`,`Time`,0,1,``,`rvTime`),i(`reverb.decay`,`Decay`,0,1,``,`rvDecay`),i(`reverb.mix`,`Mix`,0,1,``,`rvMix`),this.controlList.push(new x(`play.legato`,`Legato`,n[`play.legato`]>0,()=>void 0),new b(`play.mode`,`Mode`,[`mono`,`duo`],n[`play.mode`],()=>void 0),new x(`play.channel`,`Channel lock`,!1,()=>void 0))}keyDown(e){let t=this.held.length===0;this.held=this.held.filter(t=>t!==e),this.held.push(e),this.latched.delete(e),this.sendNotes(t||!this.legato),this.notifyNotes()}keyUp(e){this.held.includes(e)&&(this.pedal?this.latched.add(e):this.release(e))}release(e){this.held=this.held.filter(t=>t!==e),this.latched.delete(e),this.sendNotes(!1),this.notifyNotes()}releaseLatched(){for(let e of[...this.latched])this.release(e)}get legato(){return this.control(`play.legato`).value}assign(){let e=this.held;if(e.length===0)return;let t=e[e.length-1];if(this.control(`play.mode`).value===`mono`||e.length===1)return{n1:t,n2:t};let n=Math.min(...e),r=Math.max(...e);return e.length===2?{n1:n,n2:r}:{n1:n,n2:t>n?t:r}}sendNotes(e){let t=this.assign();t?(this.gate=!0,this.circuit.play(`synth`,t.n1,t.n2,!0,e)):this.gate&&(this.gate=!1,this.circuit.play(`synth`,this.lastN1,this.lastN2,!1,!1)),t&&(this.lastN1=t.n1,this.lastN2=t.n2)}lastN1=60;lastN2=60;get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`synth`,`bend`,this.bend*3),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`synth`,`modw`,this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(`channel`in e){if(!this.control(`play.channel`).value)this.lastChannel=e.channel,this.lockedChannel=void 0;else if(this.lockedChannel??=this.lastChannel,e.channel!==this.lockedChannel)return;switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===_n?this.setModWheel(e.value/127):e.controller===vn&&(this.pedal=e.value>=64,this.pedal||this.releaseLatched());break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.currentPreset=t,this.applyValues({...pn,...t.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){if(mn.includes(t))continue;let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)mn.includes(t.id)||(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyPreset(){for(let e of this.presetListeners)e()}},Cn=[[`mult.1`,`mult.2`,`mult.3`,`mult.4`],[`sq.mult.1`,`sq.mult.2`,`sq.mult.3`,`sq.mult.4`]],wn=Cn.flat(),Tn=e=>Cn.findIndex(t=>t.includes(e)),En=new Set(te),Dn=new Set(ne.map(e=>e.id)),On=new Set(wn);function kn(e){if(En.has(e))return`out`;if(Dn.has(e))return`in`;if(On.has(e))return`mult`}function An(e,t){let n=kn(e),r=kn(t);if(n&&r&&e!==t&&(n!==`mult`||r!==`mult`)){if(n===`out`&&r!==`out`)return{from:e,to:t};if(r===`out`&&n!==`out`)return{from:t,to:e};if(n===`mult`&&r===`in`)return{from:e,to:t};if(r===`mult`&&n===`in`)return{from:t,to:e}}}var jn=e=>kn(e)!==`out`;function Mn(e,t){let n=new Set([t.from,t.to].filter(jn)),r=On.has(t.to)?Tn(t.to):-1;return[...e.filter(e=>!n.has(e.from)&&!n.has(e.to)&&!(r>=0&&Tn(e.to)===r)),t]}var Nn=(e,t)=>e.filter(e=>e.from!==t&&e.to!==t);function Pn(e){let t=Cn.map((t,n)=>e.find(e=>On.has(e.to)&&Tn(e.to)===n)?.from),n=[];for(let r of e)if(!On.has(r.to)){if(On.has(r.from)){let e=t[Tn(r.from)];e&&n.push({from:e,to:r.to})}else n.push(r)}return n}var Fn=e=>e.map(e=>`${e.from}>${e.to}`).join(`;`);function In(e){let t=[];for(let n of e.split(`;`)){let[e,r]=n.split(`>`),i=e&&r?An(e,r):void 0;i&&(t=Mn(t,i))}return t}var Ln={kb:`Keyboard`,lfo:`LFO`,pre:`Preamp`,envf:`Env follower`,ring:`Ring mod`,noise:`Noise`,vco1:`VCO 1`,vco2:`VCO 2`,vco3:`VCO 3`,vcf:`VCF`,sem:`SEM`,adsr:`ADSR`,ar:`AR`,vca:`VCA`,mix:`Mixer`,reverb:`Reverb`,vp:`Processor`,sh:`S/H`,esw:`Elec switch`,mult:`Mult`,out:`Output`,sq:`SQ16`},Rn={cv:`CV`,upper:`upper voice`,gate:`gate`,trig:`trigger`,tri:`triangle`,square:`square`,delayed:`delayed`,out:`output`,saw:`saw`,pulse:`pulse`,sine:`sine`,extvib:`ext vibrato in`,in:`input`,inv1:`inverter 1`,inv2:`inverter 2`,lag:`lag`,clk:`clock`,extclk:`ext clock in`,a:`A`,b:`B`,c:`C`,left:`left in`,right:`right in`,"fm.kybd":`FM keyboard`,"sq.a":`output A`,"sq.b":`output B`,"sq.qa":`quantized A`,"sq.qb":`quantized B`,"sq.bus1":`gate bus 1`,"sq.bus2":`gate bus 2`,"sq.bus3":`gate bus 3`,"sq.pos1":`position 1`,"sq.cgate1":`clocked gate 1`,"sq.clk":`clock out`,"sq.cvin":`CV input`,"sq.ina":`quantizer input A`,"sq.inb":`quantizer input B`,"sq.start":`start`,"sq.stop":`stop`,"sq.startstop":`start/stop`,"sq.stepin":`step`,"sq.resetin":`reset`,"sq.fmin":`clock FM`,"sq.pwm":`PWM`,"sq.extclk":`clock in`,"sq.mult.1":`mult 1`,"sq.mult.2":`mult 2`,"sq.mult.3":`mult 3`,"sq.mult.4":`mult 4`,1:`1`,2:`2`,3:`3`,4:`4`,5:`5`,6:`6`,7:`7`},zn=new Map(h.map(e=>[e.id,e.label])),Bn=new Map(ne.filter(e=>e.slider).map(e=>[e.id,e.slider]));function T(e){let[t,...n]=e.split(`.`),r=Ln[t]??t,i=Bn.get(e);return`${r} · ${t===`sq`?Rn[e]??n.join(` `):i?zn.get(i):Rn[n.join(`.`)]??n.join(` `)}`}var Vn=[...te,...wn],Hn=[...ne.map(e=>e.id),...wn],E=`cords`,Un={...Object.fromEntries(h.map(e=>[e.id,e.kind===`choice`?e.options[e.def]:e.def])),[E]:``},Wn=[`play.channel`],Gn=[`sem.route`],D=(e,t)=>({name:e,values:t}),O=65.41,k=130.81,Kn=261.63,qn=523.25,Jn=`vcf.out>sem.in.vco1`;function Yn(e,t=``,n=2,r=1){let i={};return e.forEach((e,t)=>{i[`sq.step.${r+t}`]=Math.min(1,Math.max(0,e/(12*n)))}),[...t].forEach((e,t)=>{i[`sq.gate.${r+t}`]=`123`.includes(e)?e:`off`}),i}function Xn(e,t=1){return Object.fromEntries(e.map((e,n)=>[`sq.step.${t+n}`,e]))}var Zn=[D(`Init`,{}),D(`Classic Bass`,{"vco1.freq":O,"vco2.freq":O,"vco2.fine":.08,"vco3.freq":O/2,"vcf.in.vco1":.7,"vcf.in.vco2":.6,"vcf.in.vco3":.4,"vcf.freq":180,"vcf.res":.35,"vcf.cv.adsr":.45,"adsr.attack":.002,"adsr.decay":.35,"adsr.sustain":.25,"adsr.release":.12}),D(`Sync Lead`,{"vco2.sync":1,"vco2.freq":qn,"vco2.fm.adsr":.2,"vcf.in.vco1":0,"vcf.in.vco2":.8,"vcf.freq":3e3,"vcf.res":.2,"vcf.cv.adsr":.15,"adsr.decay":.8,"adsr.sustain":.7,"kb.portaOn":1,"kb.porta":.2,"lfo.delay":.4,"lfo.depth":.25}),D(`Ladder Squelch`,{"vcf.mode":`4012`,"vco1.freq":k,"vcf.freq":220,"vcf.res":.85,"vcf.cv.adsr":.5,"adsr.attack":.001,"adsr.decay":.25,"adsr.sustain":.1,"adsr.release":.1}),D(`Brass`,{"vcf.in.vco1":.6,"vcf.in.vco3":.6,"vco3.fine":.06,"vcf.freq":500,"vcf.res":.1,"vcf.cv.adsr":.35,"adsr.attack":.06,"adsr.decay":.5,"adsr.sustain":.7,"adsr.release":.25,"lfo.delay":.6,"lfo.depth":.15}),D(`Duo Lead`,{"kb.voice":`duo`,"vcf.in.vco1":.6,"vcf.in.vco2":.6,"vcf.in.vco3":.5,"vco3.fine":.05,"vcf.freq":2200,"vcf.res":.25,"adsr.decay":.6,"adsr.sustain":.7,"kb.portaOn":1,"kb.porta":.15,"lfo.delay":.5,"lfo.depth":.2}),D(`Ring Bells`,{"vcf.in.vco1":0,"vcf.in.ring":.9,"vco2.freq":Kn*2.76,"vcf.freq":6e3,"vcf.cv.adsr":0,"adsr.attack":.001,"adsr.decay":1.8,"adsr.sustain":0,"adsr.release":1.5,"reverb.left":.35,"reverb.right":.35}),D(`FM Clang`,{"vcf.in.vco1":0,"vcf.in.vco3":.8,"vco3.fm.vco2":.3,"vco2.freq":Kn*3.5,"vcf.freq":4e3,"vcf.cv.adsr":.2,"adsr.attack":.001,"adsr.decay":1.2,"adsr.sustain":0,"adsr.release":.8,"reverb.left":.25,"reverb.right":.25}),D(`Droid Chatter`,{"vco1.fm.sh":.25,"sh.rate":9,"vcf.freq":2500,"vcf.cv.adsr":0,"kb.repeat":`kybd`,"lfo.speed":9,"adsr.attack":.001,"adsr.decay":.08,"adsr.sustain":0,"adsr.release":.05}),D(`Laser Zap`,{"vco1.freq":qn,"vco1.fm.adsr":.35,"vcf.freq":5e3,"vcf.res":.2,"vcf.cv.adsr":0,"adsr.attack":.001,"adsr.decay":.25,"adsr.sustain":0,"adsr.release":.2}),D(`Repeat Bleeps`,{"kb.repeat":`kybd`,"lfo.speed":7,"vcf.freq":900,"vcf.res":.6,"vcf.cv.adsr":.35,"adsr.attack":.001,"adsr.decay":.12,"adsr.sustain":0,"adsr.release":.1}),D(`Wind and Surf`,{"vcf.in.vco1":0,"vcf.in.noise":.9,"noise.color":.5,"vcf.freq":400,"vcf.res":.75,"vcf.cv.kybd":0,"vcf.cv.adsr":0,"vcf.cv.vco2":.35,"vco2.range":`lf`,"vco2.freq":33,"adsr.attack":1.5,"adsr.sustain":1,"adsr.release":3,"reverb.left":.4,"reverb.right":.4}),D(`Noise Snare`,{"vcf.in.vco1":.2,"vco1.freq":196,"vcf.in.noise":.9,"vcf.freq":3500,"vcf.cv.kybd":0,"vcf.cv.adsr":.1,"adsr.attack":.001,"adsr.decay":.18,"adsr.sustain":0,"adsr.release":.15}),D(`Kick Drum`,{"vco1.freq":50,"vco1.fm.adsr":.3,"vcf.in.vco1":.9,"vcf.freq":120,"vcf.res":.3,"vcf.cv.kybd":0,"vcf.cv.adsr":.35,"vca.in.vcf":1,"adsr.attack":.001,"adsr.decay":.22,"adsr.sustain":0,"adsr.release":.18,"reverb.left":.05,"reverb.right":.05}),D(`Space Organ`,{"vcf.in.vco1":.6,"vco2.freq":qn,"vcf.in.vco2":.5,"vcf.freq":3e3,"vcf.cv.adsr":0,"adsr.attack":.01,"adsr.decay":.1,"adsr.sustain":1,"adsr.release":.1,"lfo.speed":6,"lfo.depth":.12,"reverb.left":.5,"reverb.right":.5}),D(`Dual Filter Pad`,{"vco2.fine":.1,"vco3.fine":-.1,"vcf.in.vco1":.6,"vcf.in.vco2":.6,"vcf.freq":700,"vcf.res":.3,"vcf.cv.adsr":.15,"sem.in.vco1":.6,"sem.in.vco3":.5,"sem.freq":1800,"sem.mode":.8,"sem.res":.4,"sem.cv.lfo":.08,"lfo.speed":.3,"vca.in.sem":.7,"adsr.attack":.8,"adsr.decay":1.5,"adsr.sustain":.8,"adsr.release":2,"reverb.left":.35,"reverb.right":.35}),D(`Notch Sweep`,{[E]:Jn,"sem.in.vco1":1,"vca.in.vcf":0,"vca.in.sem":.8,"vcf.in.vco1":0,"vcf.in.vco2":.6,"vcf.in.vco3":.6,"vco3.fine":.07,"vcf.freq":8e3,"vcf.cv.adsr":0,"sem.mode":.5,"sem.res":.5,"sem.freq":800,"sem.cv.kybd":0,"sem.cv.lfo":.25,"lfo.speed":.25,"adsr.sustain":1,"adsr.release":.6}),D(`Band Pass Voice`,{[E]:Jn,"sem.in.vco1":1,"vca.in.vcf":0,"vca.in.sem":.8,"vcf.in.vco1":.7,"vcf.in.vco3":.6,"vco3.fine":.07,"vcf.freq":5e3,"vcf.cv.adsr":0,"sem.bp":1,"sem.freq":900,"sem.res":.6,"sem.cv.adsr":.15,"adsr.attack":.03,"adsr.sustain":.8,"lfo.delay":.3,"lfo.depth":.15}),D(`Twin Resonance`,{[E]:Jn,"sem.in.vco1":1,"vca.in.vcf":0,"vca.in.sem":.8,"vco1.freq":k,"vcf.mode":`4012`,"vcf.freq":350,"vcf.res":.7,"vcf.cv.adsr":.4,"sem.freq":1400,"sem.res":.75,"sem.cv.adsr":.25,"sem.mode":.15,"adsr.attack":.002,"adsr.decay":.4,"adsr.sustain":.2,"adsr.release":.2}),D(`S&H Filter`,{[E]:`sh.out>vcf.cv.vco2`,"vcf.cv.vco2":.3,"vcf.freq":700,"vcf.res":.7,"vcf.cv.adsr":0,"sh.rate":7,"adsr.sustain":1,"adsr.release":.3}),D(`Inverted Envelope`,{[E]:`adsr.out>vp.1;vp.inv1>vcf.cv.vco2`,"vcf.cv.vco2":.4,"vcf.freq":5e3,"vcf.res":.5,"vcf.cv.adsr":0,"adsr.attack":.3,"adsr.decay":.8,"adsr.sustain":.4,"adsr.release":.5}),D(`Mult Wobble`,{[E]:`lfo.tri>mult.1;mult.2>vcf.cv.vco2;mult.3>vco2.pwm`,"vco2.freq":O,"vcf.in.vco1":0,"vcf.in.vco2":.8,"vco2.pwm":.5,"vcf.cv.vco2":.25,"vcf.freq":600,"vcf.res":.5,"vcf.cv.adsr":0,"lfo.speed":3,"adsr.sustain":1}),D(`Octave Switch`,{[E]:`vp.inv2>esw.b;esw.c>mult.1;mult.2>vco1.fm.sh;mult.3>vco2.fm.sh`,"vp.6":.1,"vco1.fm.sh":1,"vco2.fm.sh":1,"vco2.fine":.07,"vcf.in.vco2":.6,"vcf.freq":2e3,"vcf.res":.3,"vcf.cv.adsr":.1,"sh.rate":6,"adsr.sustain":.8}),D(`SQ16 Bass Line`,{[E]:`sq.qa>mult.1;mult.2>vco1.fm.kybd;mult.3>vco2.fm.kybd;sq.cgate1>adsr.gate`,"vco1.freq":O,"vco2.freq":O,"vco2.fine":.08,"vcf.in.vco2":.5,"vcf.freq":300,"vcf.res":.45,"vcf.cv.adsr":.4,"adsr.attack":.002,"adsr.decay":.2,"adsr.sustain":.2,"adsr.release":.1,"sq.scale":`minor`,"sq.rate":7}),D(`Keys Pitch, SQ16 Rhythm`,{[E]:`sq.cgate1>adsr.gate;sq.b>vcf.cv.vco2`,"vcf.cv.vco2":.25,"vcf.freq":400,"vcf.res":.5,"vcf.cv.adsr":.2,"vcf.in.vco3":.5,"vco3.fine":.07,"adsr.attack":.002,"adsr.decay":.15,"adsr.sustain":.3,"adsr.release":.1,"sq.mode":`8x2`,"sq.rate":8}),D(`SQ16 Random Bleeps`,{[E]:`sq.qa>vco1.fm.kybd;sq.cgate1>adsr.gate`,"vco1.freq":k,"vcf.freq":2500,"vcf.cv.adsr":.15,"adsr.attack":.001,"adsr.decay":.1,"adsr.sustain":0,"adsr.release":.08,"sq.dir":`random`,"sq.scale":`pent`,"sq.range":`4`,"sq.rate":9,"reverb.left":.35,"reverb.right":.35}),D(`Acid 8x2`,{[E]:`sq.qa>vco1.fm.kybd;sq.cgate1>adsr.gate;sq.b>vcf.cv.vco2`,"vco1.freq":O,"vcf.mode":`4012`,"vcf.freq":250,"vcf.res":.8,"vcf.cv.adsr":.35,"vcf.cv.vco2":.2,"vcf.cv.kybd":0,"adsr.attack":.002,"adsr.decay":.18,"adsr.sustain":0,"adsr.release":.1,"sq.mode":`8x2`,"sq.rate":8,...Yn([0,0,12,0,3,15,0,10],`1.111.11`),...Xn([.2,0,.8,.1,.3,0,.6,.2],9)}),D(`Keys Transpose Arp`,{[E]:`kb.cv>sq.cvin;sq.qa>mult.1;mult.2>vco1.fm.kybd;mult.3>vco2.fm.kybd;sq.cgate1>adsr.gate`,"vco1.freq":k,"vco2.freq":k,"vco2.fine":.07,"vcf.in.vco2":.5,"vcf.freq":1800,"vcf.res":.2,"vcf.cv.adsr":.25,"adsr.attack":.002,"adsr.decay":.25,"adsr.sustain":.3,"adsr.release":.2,"reverb.left":.25,"reverb.right":.25,"sq.scale":`major`,"sq.rate":10,...Yn([0,4,7,12,16,12,7,4,0,4,7,11,14,11,7,4],`1111111111111111`)}),D(`Two-Voice Counterpoint`,{[E]:`sq.qa>vco1.fm.kybd;sq.qb>vco2.fm.kybd;sq.cgate1>adsr.gate`,"vco1.freq":k,"vco2.freq":k,"vcf.in.vco1":.6,"vcf.in.vco2":.6,"vcf.freq":2e3,"vcf.res":.15,"vcf.cv.adsr":.2,"adsr.attack":.005,"adsr.decay":.3,"adsr.sustain":.5,"adsr.release":.25,"sq.mode":`8x2`,"sq.scale":`dorian`,"sq.rate":5,...Yn([0,3,7,5,3,2,0,10],`11111111`),...Yn([12,14,15,17,15,14,12,19],``,2,9)}),D(`Random Pentatonic`,{[E]:`sh.out>vp.1;vp.inv1>sq.ina;sq.qa>vco1.fm.kybd;sh.clk>adsr.gate`,"vp.2":.5,"vco1.freq":k,"sh.rate":6,"vcf.freq":2200,"vcf.cv.adsr":.2,"adsr.attack":.002,"adsr.decay":.15,"adsr.sustain":.2,"adsr.release":.15,"sq.scale":`pent`,"reverb.left":.35,"reverb.right":.35}),D(`Swaying Tempo`,{[E]:`sq.qa>vco1.fm.kybd;sq.cgate1>adsr.gate;lfo.tri>sq.fmin`,"sq.fm":.12,"lfo.speed":.15,"vco1.freq":k,"vcf.in.vco3":.5,"vco3.fine":.05,"vcf.freq":1500,"vcf.res":.3,"vcf.cv.adsr":.3,"adsr.attack":.003,"adsr.decay":.3,"adsr.sustain":.2,"adsr.release":.3,"reverb.left":.3,"reverb.right":.3,"sq.scale":`minor`,"sq.rate":6,...Yn([0,7,3,10,12,10,7,3,5,7,8,12,15,12,8,7],`1111111111111111`)}),D(`Step Filter (hold a key)`,{[E]:`sq.a>vcf.cv.vco2`,"vcf.cv.vco2":.3,"vcf.freq":150,"vcf.res":.6,"vcf.cv.adsr":0,"vcf.in.vco1":.6,"vcf.in.vco3":.6,"vco3.fine":.07,"adsr.attack":.01,"adsr.sustain":1,"adsr.release":.4,"sq.rate":8,...Xn([.1,.5,.25,.8,.1,.6,.35,.9,.15,.5,.2,.7,.1,.4,.6,1])}),D(`Odd Loop (5 steps)`,{[E]:`sq.qa>vco1.fm.kybd;sq.cgate1>adsr.gate`,"sq.skip":`reset`,"vco1.freq":O,"vco2.freq":O,"vco2.fine":.1,"vcf.in.vco2":.5,"vcf.freq":400,"vcf.res":.5,"vcf.cv.adsr":.4,"adsr.attack":.002,"adsr.decay":.2,"adsr.sustain":.1,"adsr.release":.1,"sq.scale":`minor`,"sq.rate":7,...Yn([0,12,7,10,3,0],`111113`)}),D(`Ring Mod Sequence`,{[E]:`sq.qa>vco2.fm.kybd;sq.cgate1>adsr.gate`,"vco2.freq":Kn*1.5,"vcf.in.vco1":0,"vcf.in.ring":.9,"vcf.freq":5e3,"vcf.cv.adsr":0,"adsr.attack":.001,"adsr.decay":.6,"adsr.sustain":0,"adsr.release":.5,"reverb.left":.4,"reverb.right":.4,"sq.rate":5,...Yn([0,7,12,5,10,3,15,8,0,12,7,19,5,14,10,2],`1111111111111111`)}),D(`SQ16 Chord Arp`,{[E]:`kb.cv>sq.cvin;sq.qa>mult.1;mult.2>vco1.fm.kybd;mult.3>vco2.fm.kybd;sq.cgate1>adsr.gate`,"vcf.in.vco1":.6,"vcf.in.vco2":.5,"vco2.fine":.08,"vcf.freq":1500,"vcf.res":.35,"vcf.cv.adsr":.3,"adsr.attack":.001,"adsr.decay":.16,"adsr.sustain":.1,"adsr.release":.12,"reverb.left":.15,"reverb.right":.15,"sq.sync":`midi`,"sq.div":`1/16`,"sq.dir":`random`,"sq.mode":`8x2`,"sq.pw":.4,...Yn([0,7,12,14,19,12,7,24],`11111111`)})],Qn=Array.from({length:48},(e,t)=>Zn[t]??D(`Init`,{})),$n=1,er=64,tr=[`omni`,...Array.from({length:16},(e,t)=>String(t+1))],nr=class extends v{name;bendRange=2;slots=[...Qn];currentSlot=0;currentPreset=this.slots[0];held=[];latched=new Set;pedal=!1;bend=0;modWheelValue=0;gate=!1;last={n1:60,n2:60};portaHeld=!1;manualOn=!1;cordList=[];midiPulses=0;cordListeners=new Set;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`MOA-2600`){super(),this.name=e;let t=this.circuit,n=[...h,...g];t.add(`synth`,`m2600`,Object.fromEntries(n.map(e=>[e.id,e.def])),{cords:`[]`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`synth`,`meterL`).connect(`synth`,`meterR`),this.outputList.push({name:`out`,nodeId:`synth`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let r=e=>n=>t.setParam(`synth`,e,n);for(let e of h){let t=Un[e.id];if(e.kind===`number`)this.controlList.push(new y(e.id,e.label,e.min,e.max,t,e.unit??``,r(e.id),e.curve));else if(e.kind===`choice`){let n=e.options;this.controlList.push(new b(e.id,e.label,n,t,t=>r(e.id)(n.indexOf(t))))}else this.controlList.push(new x(e.id,e.label,t>0,t=>r(e.id)(+!!t)))}this.controlList.push(new b(`play.channel`,`MIDI channel`,tr,`omni`,()=>void 0))}get transport(){return{channel:this.control(`play.channel`)}}keyDown(e){let t=this.held.length===0;this.held=this.held.filter(t=>t!==e),this.held.push(e),this.latched.delete(e),this.sendNotes(t||this.multiTrigger),this.notifyNotes()}keyUp(e){this.held.includes(e)&&(this.pedal?this.latched.add(e):this.release(e))}release(e){this.held=this.held.filter(t=>t!==e),this.latched.delete(e),this.sendNotes(!1),this.notifyNotes()}get multiTrigger(){return this.control(`kb.trig`).value===`multi`}assign(){if(this.held.length===0)return;let e=Math.min(...this.held);return this.control(`kb.voice`).value===`mono`?{n1:e,n2:e}:{n1:e,n2:Math.max(...this.held)}}sendNotes(e){let t=this.assign();t?(this.gate=!0,this.last=t,this.circuit.play(`synth`,t.n1,t.n2,!0,e)):this.gate&&(this.gate=!1,this.circuit.play(`synth`,this.last.n1,this.last.n2,!1,!1))}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}setManual(e){e!==this.manualOn&&(this.manualOn=e,this.circuit.send(`synth`,{type:`manual`,on:e}))}setPortamentoHeld(e){e!==this.portaHeld&&(this.portaHeld=e,this.circuit.setParam(`synth`,`kb.portaOn`,e||this.control(`kb.portaOn`).value?1:0))}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`synth`,`bend`,this.bend*2),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`synth`,`modw`,this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}sequencer(e){this.circuit.send(`synth`,{type:`sq`,action:e})}jumpTo(e){this.circuit.send(`synth`,{type:`sq`,action:`jump`,index:e})}handleClock(e){if(this.control(`sq.sync`).value===`midi`){if(e.type===`start`)this.midiPulses=0,this.sequencer(`reset`),this.sequencer(`run`);else if(e.type===`continue`)this.sequencer(`run`);else if(e.type===`stop`)this.sequencer(`stop`);else if(e.type===`clock`){let e=i[this.control(`sq.div`).value];this.midiPulses%e===0&&this.circuit.send(`synth`,{type:`sqtick`}),this.midiPulses++}}}handleMidi(e){if(!(`channel`in e)){this.handleClock(e);return}let t=this.control(`play.channel`).value;if(t===`omni`||Number(t)===e.channel)switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:if(e.controller===$n)this.setModWheel(e.value/127);else if(e.controller===er&&(this.pedal=e.value>=64,!this.pedal))for(let e of[...this.latched])this.release(e);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}get cords(){return this.cordList}connect(e,t){let n=An(e,t);return n?(this.setCords(Mn(this.cordList,n)),!0):!1}unplug(e){this.setCords(Nn(this.cordList,e))}clearCords(){this.setCords([])}setCords(e){this.cordList=[...e];let t=Pn(this.cordList);this.circuit.setOption(`synth`,`cords`,JSON.stringify(t)),this.circuit.send(`synth`,{type:`cords`,cords:t});for(let e of this.cordListeners)e()}onCordsChange(e){return this.cordListeners.add(e),()=>this.cordListeners.delete(e)}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.currentPreset=t,this.applyValues({...Un,...t.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){if(Wn.includes(t)||Gn.includes(t))continue;if(t===`cords`){if(typeof n!=`string`)throw Error(`Patch: bad cords`);this.setCords(In(n));continue}let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)Wn.includes(t.id)||(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e[E]=Fn(this.cordList),e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyPreset(){for(let e of this.presetListeners)e()}},rr={steel:{name:`Steel`,rho:7850,E:2e11},nickel:{name:`Nickel-plated steel`,rho:8900,E:2e11},stainless:{name:`Stainless steel`,rho:8e3,E:193e9}},ir={round:{name:`Roundwound`,fill:.78,b2:2e-5},half:{name:`Half-round`,fill:.85,b2:4e-5},flat:{name:`Flatwound`,fill:.92,b2:9e-5},plain:{name:`Plain steel`,fill:0,b2:4e-6}},ar=[`round`,`half`,`flat`],A=.0254,or={E:{outer:.105*A,core:.04*A,wrap:`nickel`,winding:`round`,note:28},A:{outer:.085*A,core:.034*A,wrap:`nickel`,winding:`round`,note:33},D:{outer:.065*A,core:.028*A,wrap:`nickel`,winding:`round`,note:38},G:{outer:.045*A,core:.022*A,wrap:`nickel`,winding:`round`,note:43}},sr={short:30*A,medium:32*A,long:34*A,extra:35*A},cr={E:{outer:.046*A,core:.018*A,wrap:`nickel`,winding:`round`,packing:.88,note:40},A:{outer:.036*A,core:.016*A,wrap:`nickel`,winding:`round`,packing:.88,note:45},D:{outer:.026*A,core:.012*A,wrap:`nickel`,winding:`round`,packing:.88,note:50},G:{outer:.017*A,core:.017*A,wrap:`steel`,winding:`plain`,note:55},B:{outer:.013*A,core:.013*A,wrap:`steel`,winding:`plain`,note:59},e:{outer:.01*A,core:.01*A,wrap:`steel`,winding:`plain`,note:64}},lr={'25.5"':25.5*A,'24.75"':24.75*A},ur=e=>440*2**((e-69)/12);function dr(e){return rr.steel.rho*(Math.PI/4)*e.core**2+rr[e.wrap].rho*(Math.PI/4)*(e.outer**2-e.core**2)*ir[e.winding].fill*(e.packing??1)}var fr=e=>rr.steel.E*(Math.PI*e.core**4)/64,pr=e=>rr.steel.E*(Math.PI/4)*e.core**2,mr=(e,t,n)=>dr(e)*(2*t*n)**2,hr=(e,t,n)=>Math.sqrt(n/dr(e))/(2*t),gr=(e,t)=>e/2**(t/12),_r=(e,t,n)=>Math.PI**2*fr(e)/(n*t**2);function vr(e,t,n=.5){return n+ir[e].b2*t*t}function yr(e,t,n,r,i=128){let a=hr(e,t,n),o=_r(e,t,n),s=[];for(let t=1;t<=i;t++){let n=t*a*Math.sqrt(1+o*t*t);if(n>r)break;s.push({hz:n,sigma:vr(e.winding,n)})}return s}var br={width:.012,release:25e-5},xr={width:.0015,release:2e-5};function Sr(e,t,n){let r=Math.min(Math.max(n.position,.002),e-.002),i=[];for(let a=1;a<=t.length;a++){let o=a*Math.PI/e,s=2*n.height*e*e/(a*a*Math.PI*Math.PI*r*(e-r))*Math.sin(o*r),c=o*n.width/2,l=c<1e-9?1:Math.sin(c)/c,u=1/Math.sqrt(1+(2*Math.PI*t[a-1]*n.release)**2);i.push(s*l*u)}return i}function Cr(e,t,n,r=.01){let i=[];for(let a=1;a<=t;a++){let t=a*Math.PI/e,o=t*r/2;i.push(Math.sin(t*n)*(o<1e-9?1:Math.sin(o)/o))}return i}function wr(e,t,n){let r=Array(t).fill(0);for(let i of n)Cr(e,t,i.position).forEach((e,t)=>{r[t]+=i.gain*e});return r}function Tr(e,t,n,r){let i=[];for(let a=1;a<=t;a++)i.push(r*Math.sin(a*Math.PI*n/e)**2);return i}function Er(e){let t=69+12*Math.log2(e/440),n=Math.round(t);return{note:n,name:`${[`C`,`C#`,`D`,`D#`,`E`,`F`,`F#`,`G`,`G#`,`A`,`A#`,`B`][(n%12+12)%12]}${Math.floor(n/12)-1}`,cents:(t-n)*100}}function Dr(e){let t=gr(e.scale,e.fret),n=yr(e.spec,t,e.tension,Math.min(12e3,.45*e.sampleRate)),r=n.length,i=Tr(t,r,Math.max(.005,t-.015),140).map(e=>e+30);return{length:t,hz:n.map(e=>e.hz),sigma:n.map(e=>e.sigma),pickup:typeof e.pickup==`number`?Cr(t,r,e.pickup):wr(t,r,e.pickup),strainK:n.map((e,n)=>((n+1)*Math.PI/t)**2/8),stretch:pr(e.spec)/e.tension,palm:Tr(t,r,e.palm.position,e.palm.amount*600),mute:i}}var Or=1,kr=64,Ar=2,jr=48e3,Mr=6,Nr=class extends v{design;name;bendRange=Ar;voices;frets;hand=3;held=[];bend=0;modWheelValue=0;pedal=!1;latched=new Set;building=!0;noteListeners=new Set;performanceListeners=new Set;physicsListeners=new Set;pluckListeners=new Set;constructor(e,t){super(),this.design=t,this.name=e,this.frets=t.frets;let n=this.circuit;this.voices=t.strings.map((e,n)=>({name:e.name,node:`s${n+1}`,fret:0,length:t.scales[t.scale]})),n.add(`strings`,`gain`,{gain:1});for(let e of this.voices)n.add(e.node,`string`,{level:.5,tone:3500},{config:`{}`}).connect(e.node,`strings`);n.add(`pedalDry`,`gain`,{gain:1}).add(`odHp`,`filter`,{frequency:700,Q:.5},{type:`highpass`}).add(`odGain`,`gain`,{gain:1}).add(`odClip`,`waveshaper`,{},{curve:`soft`}).add(`odTone`,`filter`,{frequency:3e3,Q:.707},{type:`lowpass`}).add(`odLow`,`filter`,{frequency:700,Q:.5},{type:`lowpass`}).add(`odLevel`,`gain`,{gain:.4}).add(`odWet`,`gain`,{gain:0}).connect(`strings`,`pedalDry`).connect(`strings`,`odHp`).connect(`odHp`,`odGain`).connect(`odGain`,`odClip`).connect(`odClip`,`odTone`).connect(`odTone`,`odLevel`).connect(`strings`,`odLow`).connect(`odLow`,`odLevel`).connect(`odLevel`,`odWet`);let r=t.toneStack;n.add(`ampIn`,`gain`,{gain:1}).add(`ampDrive`,`waveshaper`,{},{curve:`tube`}).add(`ampPost`,`gain`,{gain:1}).add(`ampBass`,`filter`,{frequency:r.bass,Q:.707,gain:0},{type:`lowshelf`}).add(`ampMid`,`filter`,{frequency:r.mid,Q:.8,gain:0},{type:`peaking`}).add(`ampTreble`,`filter`,{frequency:r.treble,Q:.707,gain:0},{type:`highshelf`}).add(`cabHp`,`filter`,{frequency:55,Q:1.1},{type:`highpass`}).add(`cabBump`,`filter`,{frequency:90,Q:1.2,gain:2},{type:`peaking`}).add(`cabCone`,`filter`,{frequency:2e3,Q:1.5,gain:4},{type:`peaking`}).add(`cabLp1`,`filter`,{frequency:5e3,Q:.707},{type:`lowpass`}).add(`cabLp2`,`filter`,{frequency:5e3,Q:.707},{type:`lowpass`}).add(`cabMic`,`filter`,{frequency:3e3,Q:.707,gain:0},{type:`highshelf`}).add(`cabOut`,`gain`,{gain:.8}).add(`diOut`,`gain`,{gain:.6}).add(`master`,`gain`,{gain:.8}).connect(`pedalDry`,`ampIn`).connect(`odWet`,`ampIn`).connect(`ampIn`,`ampDrive`).connect(`ampDrive`,`ampPost`).connect(`ampPost`,`ampBass`).connect(`ampBass`,`ampMid`).connect(`ampMid`,`ampTreble`).connect(`ampTreble`,`cabHp`).connect(`cabHp`,`cabBump`).connect(`cabBump`,`cabCone`).connect(`cabCone`,`cabLp1`).connect(`cabLp1`,`cabLp2`).connect(`cabLp2`,`cabMic`).connect(`cabMic`,`cabOut`).connect(`cabOut`,`master`).connect(`strings`,`diOut`).connect(`diOut`,`master`),this.outputList.push({name:`out`,nodeId:`master`});let i=()=>this.reconfigureAll();this.choice(`string.wrap`,`Wrap`,[`nickel`,`stainless`,`steel`],`nickel`,i),this.choice(`string.winding`,`Winding`,ar,`round`,i),this.choice(`string.scale`,`Scale`,Object.keys(t.scales),t.scale,i),t.strings.forEach((e,n)=>{let r=mr(this.specFor(n,`nickel`,`round`),t.scales[t.scale],ur(e.gauge.note));this.num(`${e.name}.tension`,`${e.name} tension`,t.tension[0],t.tension[1],Math.round(r*10)/10,`N`,()=>this.reconfigure(n))}),this.num(`palm`,`Palm mute`,0,1,0,``,i),this.choice(`pluck.style`,`Pluck with`,[`finger`,`pick`],t.pluck.style,()=>void 0),this.num(`pluck.position`,`Pluck at`,.02,.4,t.pluck.position,`m`,()=>void 0),this.num(`pluck.strength`,`Strength`,0,1,.5,``,()=>void 0),this.num(`drive.mix`,`Drive`,0,1,0,``,e=>{n.setParam(`pedalDry`,`gain`,Math.cos(e*Math.PI/2)),n.setParam(`odWet`,`gain`,Math.sin(e*Math.PI/2))}),this.num(`drive.gain`,`Gain`,0,1,.4,``,e=>n.setParam(`odGain`,`gain`,2*30**e)),this.num(`drive.tone`,`Tone`,800,8e3,3e3,`Hz`,e=>n.setParam(`odTone`,`frequency`,e),`log`),this.num(`drive.level`,`Level`,0,1.5,.4,``,e=>n.setParam(`odLevel`,`gain`,e)),this.num(`amp.gain`,`Gain`,0,1,t.gain,``,e=>{let{pre:r,post:i}=t.drive(e);n.setParam(`ampIn`,`gain`,r),n.setParam(`ampPost`,`gain`,i)}),this.num(`amp.bass`,`Bass`,-12,12,0,`dB`,e=>n.setParam(`ampBass`,`gain`,e)),this.num(`amp.mid`,`Mid`,-12,12,0,`dB`,e=>n.setParam(`ampMid`,`gain`,e)),this.num(`amp.treble`,`Treble`,-12,12,0,`dB`,e=>n.setParam(`ampTreble`,`gain`,e)),this.choice(`cab.type`,`Cabinet`,Object.keys(t.cabinets),t.cabinet,e=>this.applyCabinet(e)),this.choice(`cab.mic`,`Mic`,[`on-axis`,`off-axis`],`on-axis`,e=>n.setParam(`cabMic`,`gain`,e===`off-axis`?-8:0)),this.num(`cab.blend`,`DI / Cab`,0,1,t.blend,``,e=>{n.setParam(`diOut`,`gain`,Math.cos(e*Math.PI/2)),n.setParam(`cabOut`,`gain`,Math.sin(e*Math.PI/2))}),this.num(`level`,`Level`,0,1.5,t.level,``,e=>n.setParam(`master`,`gain`,e))}choice(e,t,n,r,i){this.controlList.push(new b(e,t,n,r,i))}num(e,t,n,r,i,a,o,s){this.controlList.push(new y(e,t,n,r,i,a,o,s))}ready(){this.building=!1,this.reconfigureAll()}pluckDelay(e){return 0}setTone(e){for(let t of this.voices)this.circuit.setParam(t.node,`tone`,e)}applyCabinet(e){let t=this.design.cabinets[e],n=this.circuit;n.setParam(`cabHp`,`frequency`,t.hp),n.setParam(`cabHp`,`Q`,t.hpQ),n.setParam(`cabBump`,`frequency`,t.bumpHz),n.setParam(`cabBump`,`gain`,t.bumpDb),n.setParam(`cabCone`,`frequency`,t.coneHz),n.setParam(`cabCone`,`gain`,t.coneDb),n.setParam(`cabCone`,`Q`,t.coneQ),n.setParam(`cabLp1`,`frequency`,t.top),n.setParam(`cabLp2`,`frequency`,t.top)}value(e){return this.control(e).value}specFor(e,t=this.value(`string.wrap`),n=this.value(`string.winding`)){let r=this.design.strings[e].gauge;return r.winding===`plain`?{outer:r.outer,core:r.core,wrap:r.wrap,winding:`plain`}:{outer:r.outer,core:r.core,wrap:t,winding:n,packing:r.packing}}spec(e){return this.specFor(e)}get scale(){return this.design.scales[this.value(`string.scale`)]}get palmAt(){return this.design.palmAt}tension(e){return this.value(`${this.voices[e].name}.tension`)*2**(2*this.bend*Ar/12)}openNote(e){return Er(hr(this.spec(e),this.scale,this.value(`${this.voices[e].name}.tension`))).note}get standardNotes(){return this.design.strings.map(e=>e.gauge.note)}readout(e){let t=this.spec(e),n=this.tension(e),r=this.voices[e],i=gr(this.scale,r.fret),a=hr(t,this.scale,this.value(`${r.name}.tension`)),o=hr(t,i,n)*Math.sqrt(1+_r(t,i,n));return{tension:n,mu:dr(t),speed:Math.sqrt(n/dr(t)),B:_r(t,i,n),open:{hz:a,...Er(a)},now:{hz:o,...Er(o)},length:i,fret:r.fret,wrap:rr[t.wrap].name,winding:ir[t.winding].name,gauge:t.outer}}tuneToStandard(){this.design.strings.forEach((e,t)=>{this.control(`${e.name}.tension`).set(Math.round(mr(this.spec(t),this.scale,ur(e.gauge.note))*10)/10)})}reconfigureAll(){for(let e=0;e<this.voices.length;e++)this.reconfigure(e)}reconfigure(e){if(this.building)return;let t=this.voices[e],n=Dr({spec:this.spec(e),scale:this.scale,tension:this.tension(e),fret:t.fret,pickup:this.pickup(e),palm:{position:this.design.palmAt,amount:this.value(`palm`)},sampleRate:jr});t.length=n.length;let r={type:`configure`,...n};this.circuit.setOption(t.node,`config`,JSON.stringify(r)),this.circuit.send(t.node,r);for(let e of this.physicsListeners)e()}modeHz(e){return JSON.parse(this.circuit.node(this.voices[e].node).options.config).hz??[]}onPhysicsChange(e){return this.physicsListeners.add(e),()=>this.physicsListeners.delete(e)}setFret(e,t){let n=this.voices[e],r=Math.max(0,Math.min(this.frets,Math.round(t)));r!==n.fret&&(n.fret=r,r>0&&(this.hand=r),this.reconfigure(e))}pluck(e,t=this.value(`pluck.position`),n=this.value(`pluck.strength`),r=0){let i=this.voices[e],a=Math.min(Math.max(t,.01),i.length-.01),o=this.modeHz(e),s=this.value(`pluck.style`)===`pick`?xr:br,[c,l]=this.design.pluckHeight,u=c*(l/c)**+n,d=Sr(i.length,o,{position:a,height:u,...s}),f=Tr(i.length,o.length,a,.9).map(e=>1-e);this.circuit.send(i.node,{type:`mute`,on:!1}),this.circuit.send(i.node,r>0?{type:`pluck`,amps:d,grab:f,delay:r}:{type:`pluck`,amps:d,grab:f});for(let t of this.pluckListeners)t(e,a)}onPluck(e){return this.pluckListeners.add(e),()=>this.pluckListeners.delete(e)}release(e){this.circuit.send(this.voices[e].node,{type:`mute`,on:!0})}chooseString(e){let t,n=1/0;return this.voices.forEach((r,i)=>{let a=e-this.openNote(i);if(a<0||a>this.frets)return;let o=(a===0?.5:Math.abs(a-this.hand))+(r.note!==void 0&&r.note!==e?Mr:0);o<n&&(n=o,t=i)}),t}keyDown(e,t=96){let n=this.chooseString(e);if(n===void 0)return;let r=this.voices[n];r.note!==void 0&&r.note!==e&&(this.held=this.held.filter(e=>e!==r.note)),r.note=e,this.held=this.held.filter(t=>t!==e),this.held.push(e),this.latched.delete(e),this.setFret(n,e-this.openNote(n));let i=Math.min(1,Math.max(.05,this.value(`pluck.strength`)*t/96));t<=40?(this.pluck(n,void 0,i),this.circuit.send(r.node,{type:`mute`,on:!0,hard:!0})):this.pluck(n,void 0,i,this.pluckDelay(n)),this.notifyNotes()}keyUp(e){if(!this.held.includes(e))return;if(this.pedal){this.latched.add(e);return}this.held=this.held.filter(t=>t!==e);let t=this.voices.findIndex(t=>t.note===e);t>=0&&(this.voices[t].note=void 0,this.release(t)),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(this.design.bendDown?-1:0,e)),this.reconfigureAll(),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.control(`palm`).set(this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:if(e.controller===Or)this.setModWheel(e.value/127);else if(e.controller===kr&&(this.pedal=e.value>=64,!this.pedal))for(let e of[...this.latched])this.latched.delete(e),this.keyUp(e)}}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}},Pr=[`E`,`A`,`D`,`G`],Fr={"4x10":{label:`4×10`,hp:55,hpQ:1.1,bumpHz:90,bumpDb:2,coneHz:2e3,coneDb:4,coneQ:1.5,top:5e3},"1x15":{label:`1×15`,hp:42,hpQ:1.3,bumpHz:70,bumpDb:3,coneHz:1200,coneDb:3,coneQ:1.2,top:2600},"8x10":{label:`8×10`,hp:38,hpQ:1,bumpHz:60,bumpDb:3.5,coneHz:1800,coneDb:3.5,coneQ:1.4,top:4500}},Ir=class extends Nr{constructor(e=`MOA-BASS`){super(e,{strings:Pr.map(e=>({name:e,gauge:or[e]})),frets:24,scales:sr,scale:`long`,tension:[40,400],pluckHeight:[3e-4,.006],palmAt:.03,pluck:{style:`finger`,position:.12},bendDown:!1,toneStack:{bass:100,mid:600,treble:2500},drive:e=>({pre:.4+e*4,post:1/(.4+e*2.2)}),gain:.3,cabinets:Fr,cabinet:`4x10`,blend:.6,level:.8}),this.num(`pickup.position`,`Pickup`,.03,.3,.15,`m`,()=>this.reconfigureAll()),this.num(`tone`,`Tone`,300,12e3,3500,`Hz`,e=>this.setTone(e),`log`),this.ready()}pickup(){return this.value(`pickup.position`)}pickups(){return[{position:this.pickup(),coils:1,on:!0}]}},Lr=[`E`,`A`,`D`,`G`,`B`,`e`],Rr={"1x12":{label:`1×12`,hp:85,hpQ:1,bumpHz:120,bumpDb:2,coneHz:2500,coneDb:4,coneQ:1.4,top:5200},"2x12":{label:`2×12`,hp:75,hpQ:1.1,bumpHz:105,bumpDb:2.5,coneHz:2200,coneDb:4,coneQ:1.3,top:5e3},"4x12":{label:`4×12`,hp:65,hpQ:1.2,bumpHz:95,bumpDb:3.5,coneHz:2e3,coneDb:4.5,coneQ:1.2,top:4600}},zr={neck:.16,middle:.1,bridge:.042},Br=[`bridge`,`bridge+middle`,`middle`,`middle+neck`,`neck`],Vr=.018,Hr={single:5e3,humbucker:2700},Ur=1.3,Wr=.7,Gr=40,Kr=class extends Nr{now=()=>performance.now();strum;wired=!1;constructor(e=`MOA-GUITAR`){super(e,{strings:Lr.map(e=>({name:e,gauge:cr[e]})),frets:22,scales:lr,scale:`25.5"`,tension:[20,150],pluckHeight:[2e-4,.003],palmAt:.02,pluck:{style:`pick`,position:.09},bendDown:!0,toneStack:{bass:120,mid:750,treble:3e3},drive:e=>{let t=.15*70**e;return{pre:t,post:1/t+.42}},gain:.3,cabinets:Rr,cabinet:`2x12`,blend:.85,level:.6});let t=()=>this.voicePickups();this.choice(`pickup.select`,`Pickups`,Br,`bridge`,t),this.choice(`pickup.type`,`Type`,[`single`,`humbucker`],`single`,t),this.num(`tone`,`Tone`,0,10,10,``,t),this.choice(`strum`,`Strum`,[`off`,`down`,`up`],`down`,()=>void 0),this.num(`strum.time`,`Strum time`,2,40,10,`ms`,()=>void 0),this.wired=!0,this.voicePickups(),this.ready()}get selected(){return this.value(`pickup.select`).split(`+`)}get humbucker(){return this.value(`pickup.type`)===`humbucker`}voicePickups(){if(!this.wired)return;let e=this.selected.length>1,t=Hr[this.humbucker?`humbucker`:`single`]*(e?Ur:1);this.setTone(t*2**(-2.2*(10-this.value(`tone`))/10)),this.reconfigureAll()}pickup(e){let t=this.standardNotes,n=(ur(t[0])/ur(t[e]))**+Wr,r=(this.selected.length>1?.6:1)*n;return this.selected.flatMap(e=>this.humbucker?[{position:zr[e]-Vr/2,gain:.8*r},{position:zr[e]+Vr/2,gain:.8*r}]:[{position:zr[e],gain:r}])}pickups(){let e=this.selected;return Object.keys(zr).map(t=>({position:zr[t],coils:this.humbucker?2:1,on:e.includes(t)}))}pluckDelay(e){let t=this.value(`strum`);if(t===`off`)return 0;let n=this.now();if(!this.strum||n-this.strum.at>Gr)return this.strum={at:n,first:e},0;let r=t===`down`?e-this.strum.first:this.strum.first-e;return Math.max(0,r)*this.value(`strum.time`)/1e3}},qr={rho:1.2,c:343},Jr={rho:1390,E:45e8},j={rho:8600,E:105e9,nu:.34},M=.0254;function Yr(e,t){let n=Math.max(64,Math.ceil(2*(Math.abs(t)+e)+32)),r=0;for(let i=0;i<=n;i++){let a=Math.PI*i/n;r+=(i===0||i===n?.5:1)*Math.cos(e*a-t*Math.sin(a))}return r/n}var Xr=new Map;function Zr(e,t){let n=Xr.get(e)??[];if(n.length>=t)return n.slice(0,t);let r=[...n],i=r.length?r[r.length-1]+.5:Math.max(.5,e),a=Yr(e,i);for(;r.length<t;){let t=i+.05,n=Yr(e,t);if(a*n<0){let n=i,o=t,s=a;for(let t=0;t<48;t++){let t=(n+o)/2,r=Yr(e,t);s*r<=0?o=t:(n=t,s=r)}r.push((n+o)/2)}i=t,a=n}return Xr.set(e,r),r.slice(0,t)}var Qr={coated:{name:`Coated, one ply`,sigma:.4,thickness:254e-6,b2:3e-6},clear:{name:`Clear, one ply`,sigma:.353,thickness:254e-6,b2:15e-7},twoPly:{name:`Clear, two plies`,sigma:.495,thickness:356e-6,b2:9e-6}},$r={kick:{diameter:22*M,depth:18*M,head:`twoPly`,striker:`beater`},snare:{diameter:14*M,depth:5.5*M,head:`coated`,striker:`stick`},tom:{diameter:12*M,depth:8*M,head:`coated`,striker:`stick`},floor:{diameter:16*M,depth:16*M,head:`coated`,striker:`stick`}},ei=[.15,.05,.02,.01],ti=.2,ni=(e,t)=>2*qr.rho*e/t,ri=(e,t,n)=>t===0?ti*qr.rho*qr.c**2*(4/n**2)/e.depth:0;function ii(e,t,n){let r=e.diameter/2,i=Qr[e.head],a=t/i.sigma,o=[];for(let t=0;t<40;t++)Zr(t,16).forEach((n,s)=>{let c=i.sigma+ni(r,n),l=n*n*a/(r*r)*(i.sigma/c)+ri(e,t,n)/c,u=Math.sqrt(l)/(2*Math.PI),d=2*Math.PI*u/qr.c*r,f=qr.rho*qr.c/c*(ei[t]??.005)*Math.min(1,d**(2*t+2));o.push({m:t,n:s+1,j:n,hz:u,sigma:1.5+i.b2*u*u+f})});return o.sort((e,t)=>e.hz-t.hz).slice(0,n)}function ai(e,t){let n=e.diameter/2,r=Qr[e.head],i=Zr(0,1)[0],a=r.sigma+ni(n,i);return((2*Math.PI*t)**2*a-ri(e,0,i))*n*n/(i*i)}var oi=(e,t)=>Yr(e.m,e.j*t),si=e=>Yr(e.m+1,e.j)**2*(e.m===0?1:.5),ci={beater:.03,stick:.005,metal:.003};function li(e,t){let n=e*t;return n<1e-6?1:2*Yr(1,n)/n}function ui(e,t){return(e===`beater`?.003:e===`stick`?9e-4:3e-4)*Math.max(.05,t)**-.2}function di(e,t){let n=2*e*t;return Math.abs(1-n)<1e-6?Math.PI/4:Math.cos(Math.PI*n/2)/(1-n*n)}function fi(e,t,n){let[r,i]=e===`beater`?[.1,3]:[.05,5],a=.5+(i-.5)*n,o=t*.25;return 1.5*r*o*a/(r+o)}function pi(e,t,n){let r=e.diameter/2,i=Math.PI*r*r,a=fi(e.striker,Qr[e.head].sigma*i,n.velocity);return t.map(t=>{let o=(Qr[e.head].sigma+ni(r,t.j))*i*si(t);return a*oi(t,n.r)/o*di(t.hz,n.contact)*li(t.j/r,ci[e.striker])})}function mi(e,t){return e.map(e=>t*160*oi(e,.9)**2/si(e))}var hi=(e,t)=>Math.sqrt(1+(qr.c/(2*Math.PI*e*t))**2);function gi(e,t,n){let r=e.diameter/2;return t.map(e=>{let t=2*Math.PI*e.hz,i=t/qr.c*r;return t*t*hi(e.hz,n)*Math.min(1,i**e.m)*(e.m===0?1:.6)})}var _i=(e,t)=>t.map(t=>(t.j/(e.diameter/2))**2*si(t)/4),vi=.12,yi=(e,t)=>vi*Jr.E*Qr[e.head].thickness/t,bi={hat:{diameter:14*M,thickness:.0011,dome:1.1},crash:{diameter:18*M,thickness:9e-4,dome:1.6},ride:{diameter:21*M,thickness:.0014,dome:1.8}},xi=e=>j.E*e**3/(12*(1-j.nu**2)),Si=e=>Math.sqrt(j.E/(j.rho*(1-j.nu**2)))/(2*Math.PI*e.dome);function Ci(e,t){let n=e.diameter/2,r=Math.sqrt(xi(e.thickness)/(j.rho*e.thickness)),i=Si(e),a=[];for(let e=0;e<90;e++)for(let t=0;t<45;t++){if(e+2*t<2)continue;let o=Math.PI/2*(e+2*t),s=o*o/(2*Math.PI*n*n)*r,c=t>0?Math.hypot(s,i):s;a.push({m:e,n:t,lambda:o,hz:c,sigma:.5+15e-5*c})}return a.sort((e,t)=>e.hz-t.hz).slice(0,t)}var wi=(e,t)=>Yr(e.m,e.lambda*t);function Ti(e,t,n){let r=e.diameter/2,i=j.rho*e.thickness*Math.PI*r*r,a=i*.25,o=fi(`stick`,i,n.velocity);return t.map(e=>o*wi(e,n.r)/a*di(e.hz,n.contact)*li(e.lambda/r,ci.metal))}function Ei(e,t,n){let r=Math.sqrt(j.E/(j.rho*(1-j.nu**2))),i=qr.c**2/(1.8*r*e.thickness);return t.map(e=>{let t=2*Math.PI*e.hz;return t*t*hi(e.hz,n)*Math.sqrt(Math.min(1,e.hz/i))})}var Di=44100,Oi={hat:{closed:{cut:`funk`,tune:0,decay:.2,level:1.6},open:{cut:`steady`,tune:0,decay:0,level:.85},pedal:{cut:`heavy`,tune:-1,decay:.06,level:1.1}},ride:{bow:{cut:`heavy`,tune:-3,decay:0,level:1.6},bell:{cut:`funk`,tune:4,decay:0,level:1.3}},crash:{hit:{cut:`steady`,tune:-2,decay:0,level:1}}},ki=[`kick`,`snare`,`tom`,`floor`],Ai=[`hat`,`crash`,`ride`],ji=[...ki,...Ai],Mi={kick:`Kick`,snare:`Snare`,tom:`Rack tom`,floor:`Floor tom`,hat:`Hi-hat`,crash:`Crash`,ride:`Ride`},Ni={kick:55,snare:210,tom:150,floor:95},Pi={kick:.6,snare:.2,tom:.1,floor:.15},Fi={kick:90,snare:110,tom:110,floor:110,hat:220,crash:300,ride:300},Ii={kick:.15,snare:.3,tom:.4,floor:.4,hat:.6,crash:.85,ride:.6},Li={kick:0,snare:.25,tom:-.05,floor:-.4,hat:.5,crash:.6,ride:-.6},Ri={kick:.15,snare:.1,tom:.1,floor:.1,hat:.6,crash:.8,ride:.8},zi={kick:.02,snare:.00254,tom:.00172,floor:96e-5,hat:.04,crash:.019,ride:.036},Bi={kick:1,snare:1,tom:1,floor:1,hat:.5,crash:.5,ride:.6},Vi={thin:.8,medium:1,heavy:1.25},Hi={hat:150,crash:1500,ride:150},Ui={hat:1,crash:.65,ride:1},Wi={hat:.5,crash:1.4,ride:.5},Gi=260,Ki={hat:.15,ride:.45,crash:.9},qi={hat:[Oi.hat.closed,Oi.hat.open,Oi.hat.pedal],ride:[Oi.ride.bow,Oi.ride.bell],crash:[Oi.crash.hit]},Ji={35:{piece:`kick`},36:{piece:`kick`},37:{piece:`snare`,at:.97},38:{piece:`snare`},40:{piece:`snare`,at:.1},41:{piece:`floor`},43:{piece:`floor`},45:{piece:`tom`,at:.55},47:{piece:`tom`},48:{piece:`tom`},50:{piece:`tom`,at:.25},42:{piece:`hat`,hat:`closed`},44:{piece:`hat`,hat:`pedal`},46:{piece:`hat`,hat:`open`},49:{piece:`crash`},52:{piece:`crash`},55:{piece:`crash`,at:.7},57:{piece:`crash`},51:{piece:`ride`},59:{piece:`ride`},53:{piece:`ride`,at:.12}},Yi=e=>ki.includes(e),Xi=e=>`${e}.s`,Zi=class extends v{name;hatOpen=0;building=!0;modes=new Map;strikes=new Map;hitListeners=new Set;physicsListeners=new Set;cuts=new Map;constructor(e=`MOA-KIT`){super(),this.name=e;let t=this.circuit;t.add(`kit`,`gain`,{gain:1});for(let e of ji)t.add(e,`drum`,{level:1},{config:`{}`}).add(`${e}.pan`,`pan`,{pan:Li[e]}).connect(e,`${e}.pan`).connect(`${e}.pan`,`kit`);t.add(`tailHp`,`filter`,{frequency:1200,Q:.707},{type:`highpass`}).add(`tail`,`convolver`,{},{size:`medium`}).connect(`tailHp`,`tail`).connect(`tail`,`kit`);for(let e of Ai)t.add(Xi(e),`sampler`,{level:1}).add(`${e}.tail`,`gain`,{gain:Ki[e]}).connect(Xi(e),`kit`).connect(Xi(e),`${e}.tail`).connect(`${e}.tail`,`tailHp`);t.onReady(e=>{let t=Ai.find(t=>Xi(t)===e);t&&this.sendCymbal(t)}),t.add(`master`,`gain`,{gain:.8}).connect(`kit`,`master`),this.outputList.push({name:`out`,nodeId:`master`});let n=(e,t,n,r,i,a,o,s)=>this.controlList.push(new y(e,t,n,r,i,a,o,s)),r=(e,t,n,r,i)=>this.controlList.push(new b(e,t,n,r,i));for(let e of ki){let t=Math.round(ai($r[e],Ni[e]));n(`${e}.tension`,`${Mi[e]} tension`,200,9e3,t,`N/m`,()=>this.reconfigure(e),`log`),n(`${e}.muffle`,`${Mi[e]} muffling`,0,1,Pi[e],``,()=>this.reconfigure(e))}n(`snare.wires`,`Snare wires`,0,1,.4,``,()=>this.reconfigure(`snare`)),r(`snare.on`,`Snares`,[`on`,`off`],`on`,()=>this.reconfigure(`snare`));for(let e of Ai)r(`${e}.weight`,Mi[e],Object.keys(Vi),`medium`,()=>this.reconfigure(e));n(`hat.open`,`Hi-hat open`,0,1,0,``,e=>this.setHat(e)),n(`strength`,`Strength`,0,1,.7,``,()=>void 0),r(`cymbals.source`,`Cymbals`,[`samples`,`model`],`samples`,()=>this.setLevels()),n(`cymbals.layer`,`Model under`,0,1,0,``,()=>this.setLevels()),n(`cymbals.tail`,`Tail`,0,1.5,1,``,e=>{for(let n of Ai)t.setParam(`${n}.tail`,`gain`,Ki[n]*e)});for(let e of ji)n(`${e}.level`,`${Mi[e]} level`,0,2,1,``,()=>this.setLevels());n(`level`,`Level`,0,1.5,.6,``,e=>t.setParam(`master`,`gain`,e)),this.building=!1;for(let e of ji)this.reconfigure(e);this.setHat(this.hatOpen),this.setLevels()}get sampledCymbals(){return this.value(`cymbals.source`)===`samples`}setLevels(){if(!this.building)for(let e of ji){let t=this.value(`${e}.level`);if(Yi(e)){this.circuit.setParam(e,`level`,t);continue}let n=this.sampledCymbals;this.circuit.setParam(e,`level`,n?t*this.value(`cymbals.layer`):t),this.circuit.setParam(Xi(e),`level`,n?t:0)}}loadCymbals(e){for(let[t,n]of Object.entries(e))this.cuts.set(t,n);for(let e of Ai)this.sendCymbal(e)}sendCymbal(e){let t=Xi(e);for(let[e,n]of this.cuts)this.circuit.send(t,{type:`sample`,id:e,rate:Di,channels:[n]});qi[e].forEach((n,r)=>{let i={sample:n.cut,start:0,end:this.cuts.get(n.cut)?.length??0,tune:n.tune,level:n.level,pan:Li[e],attack:.001,decay:n.decay>0?n.decay:8,mode:`oneshot`,group:+(e===`hat`),velLevel:.8,velFilter:.3,cutoff:2e4};this.circuit.send(t,{type:`pad`,pad:r,settings:i})})}hitSample(e,t,n,r,i=!1){let a={type:`hit`,pad:e===`hat`?i?2:this.hatOpen<.5?0:1:+(e===`ride`&&n<.25),velocity:t};r>0&&(a.delay=r),this.circuit.send(Xi(e),a)}value(e){return this.control(e).value}drumSpec(e){return $r[e]}cymbalSpec(e){let t=bi[e];return{...t,thickness:t.thickness*Vi[this.value(`${e}.weight`)]}}pieceModes(e){return this.modes.get(e)??[]}readout(e){let t=this.pieceModes(e);if(Yi(e)){let n=this.drumSpec(e),r=this.value(`${e}.tension`),i=Qr[n.head],a=t[0].hz;return{kind:`drum`,diameter:n.diameter,depth:n.depth,head:i.name,tension:r,speed:Math.sqrt(r/i.sigma),sigma:i.sigma,fundamental:{hz:a,...Er(a)},ratio11:(t.find(e=>e.m===1)?.hz??a)/a,ring:6.9/t[0].sigma,modes:t.length,top:t.at(-1).hz}}let n=this.cymbalSpec(e),r=t.find(e=>e.hz>150)??t[0];return{kind:`cymbal`,diameter:n.diameter,thickness:n.thickness,bending:xi(n.thickness),mass:j.rho*n.thickness*Math.PI*(n.diameter/2)**2,fundamental:{hz:r.hz,...Er(r.hz)},ring:6.9/r.sigma,modes:t.length,top:t.at(-1).hz}}reconfigure(e){if(this.building)return;this.strikes.clear();let t;if(Yi(e)){let n=this.drumSpec(e),r=this.value(`${e}.tension`),i=ii(n,r,Fi[e]);this.modes.set(e,i);let a=mi(i,this.value(`${e}.muffle`));if(t={hz:i.map(e=>e.hz),sigma:i.map((e,t)=>e.sigma+a[t]),mic:gi(n,i,Ri[e]).map(t=>t*zi[e]*.001),strainK:_i(n,i),stretch:yi(n,r)},e===`snare`&&this.value(`snare.on`)===`on`){let e=this.value(`snare.wires`);t.wires={weights:i.map(e=>e.m<=1?.33*(2*Math.PI*e.hz)**2*oi(e,.45):0),threshold:60+900*e,gain:.25,hz:5200}}}else{let n=this.cymbalSpec(e),r=Ci(n,Fi[e]);this.modes.set(e,r);let i=[0,500,1e3,2e3,4e3,8e3],a=[...i.map(e=>{let t=r.findIndex(t=>t.hz>=e);return t<0?r.length:t}),r.length],o=i.map(e=>(2*Math.PI*Math.max(250,e)*n.thickness)**2);t={hz:r.map(e=>e.hz),sigma:r.map(t=>t.sigma*Ui[e]),mic:Ei(n,r,Ri[e]).map(t=>t*zi[e]*.001),dampK:r.map(e=>1+e.hz/2e3),cascade:{edges:a,refs:o,rate:Hi[e]},band:{hz:r.at(-1).hz,gain:Wi[e]}},e===`hat`&&(t.damp=this.hatDamp())}let n={type:`configure`,...t};this.circuit.setOption(e,`config`,JSON.stringify(n)),this.circuit.send(e,n);for(let e of this.physicsListeners)e()}onPhysicsChange(e){return this.physicsListeners.add(e),()=>this.physicsListeners.delete(e)}strikeVelocities(e,t,n){let r=`${e}/${t.toFixed(2)}/${n.toFixed(2)}`,i=this.strikes.get(r);if(!i){let a={r:t,velocity:n,contact:ui(Yi(e)?$r[e].striker:`metal`,n)};i=Yi(e)?pi(this.drumSpec(e),this.modes.get(e),a):Ti(this.cymbalSpec(e),this.modes.get(e),a),this.strikes.size>600&&this.strikes.clear(),this.strikes.set(r,i)}return i}hit(e,t,n=Ii[e],r=0){let i=Math.min(1,Math.max(.02,t)),a=Math.min(.97,Math.max(0,n));if(!Yi(e)&&this.sampledCymbals){this.hitSample(e,i,a,r);for(let t of this.hitListeners)t(e,i,a);if(this.value(`cymbals.layer`)===0)return}let o=this.strikeVelocities(e,a,Math.round(i*50)/50),s=Yi(e)?$r[e].striker:`metal`,c=ui(s,i),l=Yi(e)?Qr[$r[e].head].sigma*Math.PI*($r[e].diameter/2)**2:1,u={type:`hit`,v:o,click:fi(s===`beater`?`beater`:`stick`,l,i)*Bi[e],tau:c};e===`hat`&&this.hatOpen<.3&&(u.burst=.05*i,u.burstDecay=.012),r>0&&(u.delay=r),this.circuit.send(e,u);for(let t of this.hitListeners)t(e,i,a)}setHat(e){this.hatOpen=Math.min(1,Math.max(0,e));let t=this.hatDamp(),n=JSON.parse(this.circuit.node(`hat`).options.config);n.hz&&this.circuit.setOption(`hat`,`config`,JSON.stringify({...n,damp:t})),this.circuit.send(`hat`,{type:`damp`,...t})}hatDamp(){let e=Math.max(0,1-this.hatOpen/.5),t=this.hatOpen>.05&&this.hatOpen<.5;return{sigma:Gi*e*e,contact:t?4*this.hatOpen*e:0}}hatPedal(e){this.setHat(0),this.sampledCymbals&&this.hitSample(`hat`,e,0,0,!0),this.circuit.send(`hat`,{type:`hit`,v:[],click:0,tau:.001,burst:.08*e,burstDecay:.02});for(let t of this.hitListeners)t(`hat`,e,0)}onHit(e){return this.hitListeners.add(e),()=>this.hitListeners.delete(e)}handleMidi(e){if(e.type!==`noteOn`)return;let t=Ji[e.note];if(!t)return;let n=e.velocity/127;if(t.hat===`pedal`)return this.hatPedal(n);t.hat===`closed`&&this.setHat(0),t.hat===`open`&&this.setHat(1),this.hit(t.piece,n,t.at)}},Qi=4e4,$i=2047,ea=Math.log1p(68);function ta(e){let t=Math.round(Math.log1p(68*Math.min(1,Math.abs(e)))/ea*$i)/$i,n=Math.expm1(t*ea)/68;return e<0?-n:n}var na=16,ra=256,ia=8.6;function aa(e){let t=1,n=1;for(let r=1;r<40&&(n*=(e/(2*r))**2,t+=n,!(n<t*1e-12));r++);return t}function oa(e,t,n){if(t===n)return e.slice();let r=n/t,i=.9*Math.min(1,r),a=Math.ceil(na/i),o=2*a,s=new Float64Array(257*o),c=aa(ia);for(let e=0;e<=ra;e++)for(let t=0;t<o;t++){let n=t-a+1-e/ra,r=n/a,l=Math.abs(r)>=1?0:aa(ia*Math.sqrt(1-r*r))/c,u=Math.PI*i*n;s[e*o+t]=i*(u===0?1:Math.sin(u)/u)*l}let l=Math.floor(e.length*r),u=new Float32Array(l);for(let t=0;t<l;t++){let n=t/r,i=Math.floor(n),c=(n-i)*ra,l=Math.floor(c),d=c-l,f=l*o,p=f+o,m=0;for(let t=0;t<o;t++){let n=i-a+1+t;n<0||n>=e.length||(m+=e[n]*(s[f+t]+d*(s[p+t]-s[f+t])))}u[t]=m}return u}function sa(e,t){return{rate:Qi,channels:e.map(e=>{let n=oa(e,t,Qi);for(let e=0;e<n.length;e++)n[e]=ta(n[e]);return n})}}var ca=[`A`,`B`,`C`,`D`],N=ca.length*16,la=()=>({start:0,end:0,tune:0,level:.8,pan:0,attack:0,decay:8,mode:`oneshot`,reverse:!1,loop:!1,group:0,velLevel:1,cutoff:2e4,reso:0,velFilter:0}),ua=e=>`${ca[Math.floor(e/16)]}${String(e%16+1).padStart(2,`0`)}`,da=e=>ca.indexOf(e[0])*16+Number(e.slice(1))-1,fa=Array.from({length:N},(e,t)=>ua(t)),pa=[`MOA Drums 60`,`Gaute Breaks`],ma=0,ha=()=>`s${Date.now().toString(36)}${(ma++).toString(36)}`,ga=class extends v{name;transport;sounds=new Map;pads=Array.from({length:N},la);programName=`New kit`;slots=pa.map(e=>({name:e,load:async()=>({sounds:[],program:{name:e,pads:[]}})}));bank=0;hitListeners=new Set;changeListeners=new Set;loading;built=this.circuit.add(`voices`,`sampler`,{level:.8}).add(`out`,`gain`,{gain:1}).add(`meter`,`meter`,{},{channel:`mono`}).connect(`voices`,`out`).connect(`out`,`meter`);level=this.num(`mpc.level`,`Level`,0,1.5,.8,``,e=>this.circuit.setParam(`voices`,`level`,e));character=this.choice(`mpc.character`,`New sounds`,[`MPC60`,`Clean`],`MPC60`,()=>{});selected=this.choice(`pad.select`,`Pad`,fa,`A01`,()=>this.showPad());levels=this.choice(`levels.mode`,`16 Levels`,[`off`,`tune`,`velocity`,`decay`,`filter`],`off`,()=>this.notifyChange());padControls={tune:this.num(`pad.tune`,`Tune`,-36,36,0,`st`,e=>this.editPad({tune:e})),level:this.num(`pad.level`,`Level`,0,1.5,.8,``,e=>this.editPad({level:e})),pan:this.num(`pad.pan`,`Pan`,-1,1,0,``,e=>this.editPad({pan:e})),attack:this.num(`pad.attack`,`Attack`,0,2,0,`s`,e=>this.editPad({attack:e})),decay:this.num(`pad.decay`,`Decay`,.01,8,8,`s`,e=>this.editPad({decay:e}),`log`),mode:this.choice(`pad.mode`,`Mode`,[`oneshot`,`noteon`],`oneshot`,e=>this.editPad({mode:e})),reverse:this.toggle(`pad.reverse`,`Reverse`,!1,e=>this.editPad({reverse:e})),loop:this.toggle(`pad.loop`,`Loop`,!1,e=>this.editPad({loop:e})),group:this.choice(`pad.group`,`Mute group`,[`off`,`1`,`2`,`3`,`4`,`5`,`6`,`7`,`8`],`off`,e=>this.editPad({group:e===`off`?0:Number(e)})),velLevel:this.num(`pad.velocity`,`Velocity`,0,1,1,``,e=>this.editPad({velLevel:e})),cutoff:this.num(`pad.cutoff`,`Filter`,40,2e4,2e4,`Hz`,e=>this.editPad({cutoff:e}),`log`),reso:this.num(`pad.reso`,`Resonance`,0,1,0,``,e=>this.editPad({reso:e})),velFilter:this.num(`pad.velFilter`,`Vel > filter`,0,1,0,``,e=>this.editPad({velFilter:e}))};showing=!1;constructor(e,t=`MOA-60`){super(),this.name=t,this.transport=new Et(e),this.transport.channel.set(`11`),this.controlList.push(this.transport.channel),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out`,nodeId:`meter`}),this.circuit.onReady(e=>{e===`voices`&&this.sendAll()})}get selectedPad(){return da(this.selected.value)}padMessage(e){let t=this.pads[e],n=t.sound?this.sounds.get(t.sound):void 0,r=n?.rate??1;return{type:`pad`,pad:e,settings:{...t,sample:n?t.sound:void 0,start:t.start*r,end:t.end>t.start?t.end*r:0}}}sendPad(e){this.circuit.send(`voices`,this.padMessage(e))}sendSound(e){this.circuit.send(`voices`,{type:`sample`,id:e.id,rate:e.rate,channels:e.channels})}sendAll(){for(let e of this.sounds.values())this.sendSound(e);for(let e=0;e<N;e++)this.sendPad(e)}addSound(e,t,n,r=this.character.value,i=ha()){let a={rate:t,channels:n},o=r===`MPC60`?sa(n,t):a,s={id:i,name:e,character:r,source:a,rate:o.rate,channels:o.channels};this.sounds.set(i,s),this.sendSound(s);for(let e=0;e<N;e++)this.pads[e].sound===i&&this.sendPad(e);return this.notifyChange(),s}setCharacter(e,t){let n=this.sounds.get(e);if(!n||n.character===t)return;let r=t===`MPC60`?sa(n.source.channels,n.source.rate):n.source;Object.assign(n,{character:t,rate:r.rate,channels:r.channels}),this.sendSound(n);for(let t=0;t<N;t++)this.pads[t].sound===e&&this.sendPad(t);this.notifyChange()}removeSound(e){if(this.sounds.delete(e)){this.circuit.send(`voices`,{type:`drop`,id:e});for(let t=0;t<N;t++)this.pads[t].sound===e&&this.setPad(t,{sound:void 0});this.notifyChange()}}duration(e){let t=this.sounds.get(e);return t?t.source.channels[0].length/t.source.rate:0}setPad(e,t){Object.assign(this.pads[e],t),this.sendPad(e),e===this.selectedPad&&this.showPad(),this.notifyChange()}assign(e,t,n=0,r=0){this.setPad(e,{sound:t,start:n,end:r})}editPad(e){this.showing||(Object.assign(this.pads[this.selectedPad],e),this.sendPad(this.selectedPad),this.notifyChange())}showPad(){if(!this.padControls)return;let e=this.pads[this.selectedPad];this.showing=!0;let t=this.padControls;t.tune.set(e.tune),t.level.set(e.level),t.pan.set(e.pan),t.attack.set(e.attack),t.decay.set(e.decay),t.mode.set(e.mode),t.reverse.set(e.reverse),t.loop.set(e.loop),t.group.set(e.group?String(e.group):`off`),t.velLevel.set(e.velLevel),t.cutoff.set(e.cutoff),t.reso.set(e.reso),t.velFilter.set(e.velFilter),this.showing=!1,this.notifyChange()}hit(e,t=1,n,r){if(!(e<0||e>=N||t<=0)){this.circuit.send(`voices`,{type:`hit`,pad:e,velocity:t,when:n,over:r});for(let r of this.hitListeners)r({pad:e,velocity:t,when:n})}}release(e,t){this.circuit.send(`voices`,{type:`release`,pad:e,when:t})}stopAll(){this.circuit.send(`voices`,{type:`stopAll`})}padFor(e,t=1){let n=this.levels.value;if(n===`off`)return{pad:this.bank*16+e,velocity:t};let r=this.selectedPad,i=this.pads[r],a=e/15;return n===`tune`?{pad:r,velocity:t,over:{tune:i.tune+e-8}}:n===`velocity`?{pad:r,velocity:(e+1)/16}:n===`decay`?{pad:r,velocity:t,over:{decay:.03*(8/.03)**a,mode:`oneshot`}}:{pad:r,velocity:t,over:{cutoff:100*200**a}}}press(e,t=1,n){let r=this.padFor(e,t);return this.hit(r.pad,r.velocity,n,r.over),r}unpress(e,t){this.release(this.levels.value===`off`?this.bank*16+e:this.selectedPad,t)}handleMidi(e,t){if(e.type!==`noteOn`&&e.type!==`noteOff`||!this.transport.acceptsChannel(e.channel))return;let n=e.note-36;n<0||n>=N||(e.type===`noteOn`&&e.velocity>0?this.hit(n,e.velocity/127,t):this.release(n,t))}program(){return{name:this.programName,pads:this.pads.map(e=>({...e}))}}loadProgram(e){this.programName=e.name;for(let t=0;t<N;t++)Object.assign(this.pads[t],la(),{sound:void 0},e.pads[t]??{}),this.sendPad(t);this.showPad()}loadSlot(e){let t=this.slots[e];return t?(this.loading=t.load().then(({sounds:e,program:t})=>{for(let t of e)this.addSound(t.name,t.rate,t.channels,t.character??`MPC60`,t.id);this.loadProgram(t)}),this.loading):Promise.resolve()}ready(){return this.loading??Promise.resolve()}onHit(e){return this.hitListeners.add(e),()=>this.hitListeners.delete(e)}onChange(e){return this.changeListeners.add(e),()=>this.changeListeners.delete(e)}notifyChange(){for(let e of this.changeListeners)e()}num(...e){let t=new y(...e);return this.controlList.push(t),t}choice(...e){let t=new b(...e);return this.controlList.push(t),t}toggle(...e){let t=new x(...e);return this.controlList.push(t),t}};function _a(e,t=16){let n=Array.from({length:t},()=>[]);for(let[r,i]of Object.entries(e))[...i.replace(/ /g,``)].forEach((e,i)=>{e!==`.`&&i<t&&n[i].push([r,e===`x`?1:.55])});return n}var va={rock:{name:`Rock`,steps:16,pattern:_a({kick:`x... .... x.x. ....`,snare:`.... x... .... x...`,hat:`x.o. x.o. x.o. x.o.`})},pop:{name:`Pop`,steps:16,pattern:_a({kick:`x... ..x. x... ....`,clap:`.... x... .... x...`,hat:`.ox. .ox. .ox. .ox.`})},waltz:{name:`Waltz`,steps:12,pattern:_a({kick:`x... .... ....`,hat:`.... x... x...`,wood:`.... o... o...`},12)},march:{name:`March`,steps:16,pattern:_a({kick:`x... .... x... ....`,snare:`.... x.o. .... x.oo`,wood:`o... o... o... o...`})},disco:{name:`Disco`,steps:16,pattern:_a({kick:`x... x... x... x...`,clap:`.... x... .... x...`,hat:`..x. ..x. ..x. ..x.`,bell:`.... .... .... ..o.`})}},ya=Object.keys(va),P=60,F=62,I=64,L=65,R=67,ba=69,xa=71,Sa=Object.keys({mikkel:{name:`Mikkel Rev`,notes:[[66,1],[69,1],[62,2],[66,1],[69,1],[62,2],[67,1],[71,1],[74,1],[71,1],[71,2],[69,2],[66,1],[69,1],[62,2],[66,1],[69,1],[62,2],[64,1],[66,1],[67,1],[61,1],[64,2],[62,2]]},twinkle:{name:`Twinkle Twinkle`,notes:[[P,1],[P,1],[R,1],[R,1],[ba,1],[ba,1],[R,2],[L,1],[L,1],[I,1],[I,1],[F,1],[F,1],[P,2],[R,1],[R,1],[L,1],[L,1],[I,1],[I,1],[F,2],[R,1],[R,1],[L,1],[L,1],[I,1],[I,1],[F,2],[P,1],[P,1],[R,1],[R,1],[ba,1],[ba,1],[R,2],[L,1],[L,1],[I,1],[I,1],[F,1],[F,1],[P,2]]},lamb:{name:`Mary Had a Little Lamb`,notes:[[I,1],[F,1],[P,1],[F,1],[I,1],[I,1],[I,2],[F,1],[F,1],[F,2],[I,1],[R,1],[R,2],[I,1],[F,1],[P,1],[F,1],[I,1],[I,1],[I,1],[I,1],[F,1],[F,1],[I,1],[F,1],[P,4]]},joy:{name:`Ode to Joy`,notes:[[I,1],[I,1],[L,1],[R,1],[R,1],[L,1],[I,1],[F,1],[P,1],[P,1],[F,1],[I,1],[I,1.5],[F,.5],[F,2],[I,1],[I,1],[L,1],[R,1],[R,1],[L,1],[I,1],[F,1],[P,1],[P,1],[F,1],[I,1],[F,1.5],[P,.5],[P,2]]},farm:{name:`Old MacDonald`,notes:[[R,1],[R,1],[R,1],[F,1],[I,1],[I,1],[F,2],[xa,1],[xa,1],[ba,1],[ba,1],[R,3],[F,1],[R,1],[R,1],[R,1],[F,1],[I,1],[I,1],[F,2],[xa,1],[xa,1],[ba,1],[ba,1],[R,3]]},bells:{name:`Jingle Bells`,notes:[[I,1],[I,1],[I,2],[I,1],[I,1],[I,2],[I,1],[R,1],[P,1.5],[F,.5],[I,4],[L,1],[L,1],[L,1.5],[L,.5],[L,1],[I,1],[I,1],[I,.5],[I,.5],[I,1],[F,1],[F,1],[I,1],[F,2],[R,2],[I,1],[I,1],[I,2],[I,1],[I,1],[I,2],[I,1],[R,1],[P,1.5],[F,.5],[I,4],[L,1],[L,1],[L,1.5],[L,.5],[L,1],[I,1],[I,1],[I,.5],[I,.5],[R,1],[R,1],[L,1],[F,1],[P,4]]}}),z=e=>({w1:`square`,w2:`square`,i2:12,mix2:0,a:.005,d:.3,s:.6,r:.2,vib:0,vibRate:5.5,vibDelay:.3,gain:1,...e}),Ca=[{name:`Piano`,label:`Piano`,icon:`🎹`,magic:4500,sparkle:.1,sound:z({w1:`pulse25`,w2:`square`,i2:12,mix2:.3,a:.002,d:.9,s:0,r:.25})},{name:`Organ`,label:`Orgel`,icon:`🎶`,magic:6e3,sparkle:.05,sound:z({w1:`square`,w2:`square`,i2:12,mix2:.5,a:.005,d:.1,s:1,r:.08,gain:.8})},{name:`Flute`,label:`Fløyte`,icon:`🌬️`,magic:3e3,sparkle:.1,sound:z({w1:`sine`,w2:`triangle`,i2:12,mix2:.15,a:.06,d:.3,s:.9,r:.15,vib:12,vibDelay:.35,gain:1.3})},{name:`Trumpet`,label:`Trompet`,icon:`🎺`,magic:2500,sparkle:.3,sound:z({w1:`saw`,w2:`pulse25`,i2:0,mix2:.3,a:.04,d:.2,s:.8,r:.1,vib:10,gain:.8})},{name:`Violin`,label:`Fiolin`,icon:`🎻`,magic:3500,sparkle:.15,sound:z({w1:`saw`,w2:`saw`,i2:.08,mix2:.5,a:.12,d:.3,s:1,r:.3,vib:18,vibDelay:.4,gain:.8})},{name:`Bells`,label:`Bjeller`,icon:`🔔`,magic:8e3,sparkle:.1,sound:z({w1:`sine`,w2:`sine`,i2:19,mix2:.4,a:.001,d:1.5,s:0,r:1.2,gain:1.3})},{name:`Robot`,label:`Robot`,icon:`🤖`,magic:1200,sparkle:.85,sound:z({w1:`pulse12`,w2:`square`,i2:-12,mix2:.5,a:.001,d:.2,s:.7,r:.05,vib:60,vibRate:9,vibDelay:0})},{name:`Kitty`,label:`Pusekatt`,icon:`🐱`,magic:2e3,sparkle:.7,sound:z({w1:`triangle`,w2:`pulse25`,i2:12,mix2:.25,a:.02,d:.4,s:.3,r:.3,vib:40,vibRate:7,vibDelay:.1,gain:1.2})},{name:`Space`,label:`Romskip`,icon:`🚀`,magic:1500,sparkle:.6,sound:z({w1:`saw`,w2:`square`,i2:7,mix2:.5,a:.3,d:1,s:.7,r:1.5,vib:8,gain:.8})},{name:`Elephant`,label:`Elefant`,icon:`🐘`,magic:900,sparkle:.3,sound:z({w1:`square`,w2:`saw`,i2:-12,mix2:.6,a:.005,d:.3,s:.6,r:.1})}],wa=4,Ta=1,Ea=15,Da=class extends v{name;transport;held=new Map;noteListeners=new Set;changeListeners=new Set;built=this.circuit.add(`voices`,`tone`,{level:.7},{role:`voices`,preset:JSON.stringify(Ca[0].sound)}).add(`filter`,`ladder`,{cutoff:4500,detune:0,res:.1,drive:.15}).add(`drums`,`tone`,{level:.6},{role:`drums`,preset:`{}`}).add(`out`,`gain`,{gain:.8}).add(`meter`,`meter`,{},{channel:`mono`}).connect(`voices`,`filter`).connect(`filter`,`out`).connect(`drums`,`out`).connect(`out`,`meter`);preset=this.choice(`uni.preset`,`Sound`,Ca.map(e=>e.name),`Piano`,()=>this.loadSound(!0));magic=this.num(`uni.magic`,`Magic`,150,12e3,4500,`Hz`,e=>this.circuit.setParam(`filter`,`cutoff`,e),`log`);sparkle=this.num(`uni.sparkle`,`Sparkle`,0,.95,.1,``,e=>this.circuit.setParam(`filter`,`res`,e));volume=this.num(`uni.volume`,`Volume`,0,1,.8,``,e=>this.circuit.setParam(`out`,`gain`,e));vibrato=this.toggle(`uni.vibrato`,`Vibrato`,!1,()=>this.loadSound(!1));sustain=this.toggle(`uni.sustain`,`Sustain`,!1,()=>this.loadSound(!1));octave=this.choice(`uni.octave`,`Octave`,[`-1`,`0`,`+1`],`0`,()=>this.notifyChange());rhythm=this.choice(`uni.rhythm`,`Rhythm`,[`off`,...ya],`off`,()=>this.notifyChange());tempo=this.num(`uni.tempo`,`Tempo`,50,200,110,`BPM`,()=>this.notifyChange());beatLevel=this.num(`uni.beat`,`Drums`,0,1,.7,``,e=>this.circuit.setParam(`drums`,`level`,e));song=this.choice(`uni.song`,`Song`,[`off`,...Sa],`off`,()=>this.notifyChange());constructor(e,t=`MOA-UNICORN`){super(),this.name=t,this.transport=new Et(e),this.transport.channel.set(`omni`),this.controlList.push(this.transport.channel),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out`,nodeId:`meter`})}get currentPreset(){return Ca.find(e=>e.name===this.preset.value)??Ca[0]}get sound(){let e={...this.currentPreset.sound};return this.sustain.value&&(e.r=Math.max(Ta,e.r*wa)),this.vibrato.value&&e.vib===0&&(e.vib=Ea),e}loadSound(e){if(!this.sustain||!this.vibrato)return;let t=this.sound;this.circuit.node(`voices`).options.preset=JSON.stringify(t),this.circuit.send(`voices`,{type:`preset`,preset:t}),e&&(this.magic.set(this.currentPreset.magic),this.sparkle.set(this.currentPreset.sparkle)),this.notifyChange()}get shift(){return 12*Number(this.octave.value)}keyDown(e,t=.8,n,r){let i=(r??e)+this.shift;if(!(i<0||i>127)){this.held.has(e)&&this.keyUp(e,n),this.held.set(e,i),this.circuit.send(`voices`,{type:`on`,note:i,velocity:t,when:n});for(let e of this.noteListeners)e(i,!0)}}keyUp(e,t){let n=this.held.get(e);if(n!==void 0){this.held.delete(e),this.circuit.send(`voices`,{type:`off`,note:n,when:t});for(let e of this.noteListeners)e(n,!1)}}playNote(e,t,n,r=.8){this.circuit.send(`voices`,{type:`on`,note:e+this.shift,velocity:r,when:t}),this.circuit.send(`voices`,{type:`off`,note:e+this.shift,when:t+n})}drum(e,t,n){this.circuit.send(`drums`,{type:`drum`,kind:e,velocity:t,when:n})}allOff(){for(let e of[...this.held.keys()])this.keyUp(e);this.circuit.send(`voices`,{type:`allOff`})}get heldKeys(){return[...this.held.keys()]}handleMidi(e){e.type!==`noteOn`&&e.type!==`noteOff`||!this.transport.acceptsChannel(e.channel)||(e.type===`noteOn`&&e.velocity>0?this.keyDown(e.note,e.velocity/127):this.keyUp(e.note))}onNote(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}onChange(e){return this.changeListeners.add(e),()=>this.changeListeners.delete(e)}notifyChange(){for(let e of this.changeListeners)e()}num(...e){let t=new y(...e);return this.controlList.push(t),t}choice(...e){let t=new b(...e);return this.controlList.push(t),t}toggle(...e){let t=new x(...e);return this.controlList.push(t),t}},Oa={"f1.type":`GEN LP`,"f1.cutoff":1200,"f1.res":.25,"f1.depth":0,"f1.source":`env`,"f1.inv":0,"f1.noise":0,"f1.vca":0,"f1.gate":0,"f1.threshold":.3,"f2.type":`GEN LP`,"f2.cutoff":1200,"f2.res":.25,"f2.depth":0,"f2.source":`env`,"f2.inv":0,"f2.noise":0,"f2.vca":0,"f2.gate":0,"f2.threshold":.3,"env1.attack":.01,"env1.decay":.3,"env1.sustain":.6,"env1.release":.4,"env1.mode":`adsr`,"env1.curve":`lin`,"env1.trig":`keys`,"env2.attack":.01,"env2.decay":.3,"env2.sustain":.6,"env2.release":.4,"env2.mode":`adsr`,"env2.curve":`lin`,"env2.trig":`keys`,"link.env":0,"link.cutoff":0,"sh.rate":4,"sh.slew":.2,"sh.source":`noise`,"delay.time":.25,"delay.repeats":.3,"delay.level":0,"delay.mod":0,"delay.source":`s&h`,"mix.a":.8,"mix.b":.8,"mix.mode":`stereo`,"mix.volume":.8},B=(e,t)=>({name:e,values:t}),ka=e=>{let t={};for(let[n,r]of Object.entries(e))t[`f1.${n}`]=r,t[`f2.${n}`]=r;return t},Aa=[B(`Init`,{}),B(`Dynamic Pluck`,{...ka({cutoff:180,res:.45,depth:.85,vca:1}),"env1.attack":.002,"env1.decay":.22,"env1.sustain":0,"env1.release":.2,"env1.curve":`exp`,"link.env":1,"delay.level":.2,"delay.time":.18,"delay.repeats":.3}),B(`Auto Wah`,{"f1.type":`GEN BP`,"f1.cutoff":350,"f1.res":.7,"f1.depth":.7,"f2.type":`GEN BP`,"f2.cutoff":500,"f2.res":.7,"f2.depth":.7,"env1.trig":`thresh`,"f1.gate":1,"f1.threshold":.35,"env1.attack":.004,"env1.decay":.18,"env1.sustain":.1,"env1.release":.15,"env1.curve":`exp`,"link.env":1}),B(`Screaming Madman`,{"f1.type":`GEN LP`,"f1.cutoff":300,"f1.res":.93,"f1.depth":.6,"f2.type":`GEN HP`,"f2.cutoff":900,"f2.res":.9,"f2.depth":-.4,"env1.attack":.01,"env1.decay":.5,"env1.sustain":.2,"env1.release":.6,"link.env":1,"mix.a":.6,"mix.b":.45}),B(`Silk Sweep`,{...ka({type:`2045 LP`,cutoff:250,res:.35,depth:.7}),"env1.attack":.45,"env1.decay":1.2,"env1.sustain":.7,"env1.release":1.5,"link.env":1,"delay.level":.25,"delay.time":.38,"delay.repeats":.45}),B(`Ringing 2045`,{"f1.type":`2045 LP`,"f1.cutoff":520,"f1.res":.96,"f1.depth":.3,"f2.type":`2045 LP`,"f2.cutoff":780,"f2.res":.96,"f2.depth":.3,"env1.attack":.05,"env1.sustain":.5,"link.env":1,"mix.a":.5,"mix.b":.5}),B(`Twin Peaks`,{...ka({type:`BP+`,cutoff:700,res:.78,depth:.5}),"f2.cutoff":1100,"env1.attack":.02,"env1.decay":.6,"env1.sustain":.4,"env1.release":.5,"link.env":1}),B(`Phase Rooms`,{"f1.type":`NOTCH+`,"f1.cutoff":600,"f1.res":.6,"f1.depth":.8,"f1.source":`s&h`,"f2.type":`BANDSTOP+`,"f2.cutoff":900,"f2.res":.5,"f2.depth":.8,"sh.rate":1.2,"sh.slew":.65,"sh.source":`noise`}),B(`Random Steps`,{...ka({cutoff:400,res:.6,depth:.9,source:`s&h`}),"f2.type":`GEN BP`,"sh.rate":7,"sh.slew":.05,"delay.level":.3,"delay.time":.21,"delay.repeats":.4,"delay.mod":.4,"delay.source":`s&h`}),B(`Looping LFO`,{...ka({type:`2045 LP`,cutoff:300,res:.55,depth:.7}),"env1.mode":`loop`,"env1.attack":.35,"env1.release":.55,"link.env":1}),B(`Tremolo Gate`,{...ka({cutoff:8e3,res:.1,depth:0,vca:1}),"env1.mode":`loop`,"env1.attack":.01,"env1.release":.09,"env1.curve":`exp`,"link.env":1}),B(`Crunch Echo`,{...ka({type:`GEN LP`,cutoff:2400,res:.4}),"delay.level":.7,"delay.time":.42,"delay.repeats":.7,"delay.mod":.25,"delay.source":`env2`,"env2.mode":`loop`,"env2.attack":1.2,"env2.release":1.6}),B(`Noise Drums`,{"f1.type":`GEN BP`,"f1.cutoff":180,"f1.res":.8,"f1.depth":.8,"f1.noise":.9,"f1.vca":1,"f2.type":`GEN HP`,"f2.cutoff":3e3,"f2.res":.4,"f2.noise":.7,"f2.vca":1,"env1.attack":.001,"env1.decay":.12,"env1.sustain":0,"env1.release":.1,"env1.curve":`exp`,"env2.attack":.001,"env2.decay":.05,"env2.sustain":0,"env2.release":.05,"env2.curve":`exp`}),B(`Ghost Pad`,{"f1.type":`2045 LP`,"f1.cutoff":400,"f1.res":.5,"f1.depth":.5,"f1.noise":.15,"f2.type":`BANDSTOP+`,"f2.cutoff":1200,"f2.res":.4,"f2.depth":-.5,"env1.attack":.8,"env1.release":2,"env2.attack":1.5,"env2.release":2.5,"delay.level":.4,"delay.time":.5,"delay.repeats":.6}),B(`Mono Squelch`,{"f1.type":`2045 LP`,"f1.cutoff":120,"f1.res":.88,"f1.depth":.95,"f1.vca":1,"f2.type":`GEN LP`,"f2.cutoff":200,"f2.res":.85,"f2.depth":.9,"f2.vca":1,"env1.attack":.002,"env1.decay":.25,"env1.sustain":.15,"env1.release":.15,"env1.curve":`exp`,"link.env":1,"mix.mode":`mono`})],ja=Array.from({length:16},(e,t)=>Aa[t]??B(`Init`,{})),Ma=[`GEN LP`,`GEN BP`,`GEN HP`,`GEN NOTCH`,`2045 LP`,`BP+`,`NOTCH+`,`BANDSTOP+`],Na=[`Type`,`Cut`,`Res`,`Depth`,`Src`,`Inv`,`Noise`,`Vca`,`Thr`,`Gate`].flatMap(e=>[`f1${e}`,`f2${e}`]).concat([`e1`,`e2`].flatMap(e=>[`Atk`,`Dec`,`Sus`,`Rel`,`Loop`,`Exp`,`Trig`].map(t=>e+t)),[`envLink`,`cutLink`,`shRate`,`shSlew`,`shSrc`,`dlTime`,`dlRep`,`dlLevel`,`dlMod`,`dlSrc`,`mixA`,`mixB`,`mono`,`vol`]),Pa=class extends v{name;slots=[...ja];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;constructor(e=`MOA-DF2`){super(),this.name=e;let t=this.circuit;t.add(`box`,`df`,Object.fromEntries(Na.map(e=>[e,0]))).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`box`,`meterL`).connect(`box`,`meterR`),this.inputList.push({name:`in`,nodeId:`box`}),this.outputList.push({name:`out`,nodeId:`box`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=Oa,r=e=>n=>t.setParam(`box`,e,n),i=(e,t,i,a,o,s,c)=>this.controlList.push(new y(e,t,i,a,n[e],o,r(s),c)),a=(e,t,i,a)=>this.controlList.push(new b(e,t,i,n[e],e=>r(a)(i.indexOf(e)))),o=(e,t,i)=>this.controlList.push(new x(e,t,n[e]>0,e=>r(i)(+!!e)));for(let e of[`1`,`2`]){let t=`f${e}`;a(`${t}.type`,`Filter type`,Ma,`${t}Type`),i(`${t}.cutoff`,`Cutoff`,20,2e4,`Hz`,`${t}Cut`,`log`),i(`${t}.res`,`Resonance`,0,1,``,`${t}Res`),i(`${t}.depth`,`Depth`,-1,1,``,`${t}Depth`),a(`${t}.source`,`Source`,[`env`,`s&h`],`${t}Src`),o(`${t}.inv`,`Invert env`,`${t}Inv`),i(`${t}.noise`,`Noise`,0,1,``,`${t}Noise`),o(`${t}.vca`,`VCA`,`${t}Vca`),i(`${t}.threshold`,`Threshold`,0,1,``,`${t}Thr`),o(`${t}.gate`,`Gate on`,`${t}Gate`)}for(let e of[`1`,`2`]){let t=`env${e}`,n=`e${e}`;i(`${t}.attack`,`Attack`,.001,10,`s`,`${n}Atk`,`log`),i(`${t}.decay`,`Decay`,.005,10,`s`,`${n}Dec`,`log`),i(`${t}.sustain`,`Sustain`,0,1,``,`${n}Sus`),i(`${t}.release`,`Release`,.005,20,`s`,`${n}Rel`,`log`),a(`${t}.mode`,`Mode`,[`adsr`,`loop`],`${n}Loop`),a(`${t}.curve`,`Curve`,[`lin`,`exp`],`${n}Exp`),a(`${t}.trig`,`Gate from`,[`keys`,`thresh`],`${n}Trig`)}o(`link.env`,`Env I link`,`envLink`),o(`link.cutoff`,`Cutoff link`,`cutLink`),i(`sh.rate`,`Rate`,.05,40,`Hz`,`shRate`,`log`),i(`sh.slew`,`Slew`,0,1,``,`shSlew`),a(`sh.source`,`Source`,[`noise`,`env`],`shSrc`),i(`delay.time`,`Time`,.02,.6,`s`,`dlTime`,`log`),i(`delay.repeats`,`Repeats`,0,1,``,`dlRep`),i(`delay.level`,`Level`,0,1,``,`dlLevel`),i(`delay.mod`,`Mod depth`,-1,1,``,`dlMod`),a(`delay.source`,`Mod source`,[`s&h`,`env2`],`dlSrc`),i(`mix.a`,`Filter I`,0,1.5,``,`mixA`),i(`mix.b`,`Filter II`,0,1.5,``,`mixB`),a(`mix.mode`,`Output`,[`stereo`,`mono`],`mono`),i(`mix.volume`,`Volume`,0,1.5,``,`vol`)}setKeys(e){this.circuit.gate(`box`,`keys`,e)}setOpen(e,t){this.circuit.gate(`box`,e===1?`open1`:`open2`,t)}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.currentPreset=t,this.applyValues({...Oa,...t.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyPreset(){for(let e of this.presetListeners)e()}},Fa={"lfo.rate":5,"lfo.delay":0,"dco.lfo":0,"dco.pwm":.5,"dco.pwmSource":`man`,"dco.range":`8`,"dco.pulse":1,"dco.saw":1,"dco.sub":.3,"dco.noise":0,"hpf.freq":`1`,"vcf.freq":3e3,"vcf.res":.2,"vcf.env":.4,"vcf.polarity":`plus`,"vcf.lfo":0,"vcf.kybd":.5,"vca.mode":`env`,"vca.level":.8,"env.attack":.005,"env.decay":.4,"env.sustain":.6,"env.release":.3,"chorus.i":0,"chorus.ii":0,"bend.dco":2,"bend.vcf":.2,"bend.lfo":.3,"bend.lfoTrig":0,"master.portamento":0,"assign.mode":`poly1`,"master.tune":0,"master.volume":.75,"key.hold":0,"key.transpose":`0`},Ia=[`master.tune`,`master.volume`,`key.hold`,`key.transpose`],La=[`A`,`B`],Ra=La.length*8*8,za=(e,t,n)=>e*8*8+(t-1)*8+(n-1),V=(e,t)=>({name:e,values:t}),Ba=[V(`Brass 1`,{"dco.sub":.2,"vcf.freq":700,"vcf.res":.15,"vcf.env":.55,"vcf.kybd":.6,"env.attack":.07,"env.decay":.4,"env.sustain":.65,"env.release":.2,"chorus.i":1}),V(`Brass 2`,{"dco.pwm":.35,"dco.pulse":1,"dco.saw":1,"vcf.freq":600,"vcf.res":.25,"vcf.env":.6,"env.attack":.12,"env.decay":.5,"env.sustain":.55,"env.release":.25,"chorus.ii":1}),V(`Strings`,{"dco.pulse":0,"dco.saw":1,"dco.sub":.1,"hpf.freq":`2`,"vcf.freq":2600,"vcf.res":.05,"vcf.env":.1,"env.attack":.35,"env.decay":1,"env.sustain":.85,"env.release":.6,"chorus.i":1,"chorus.ii":1}),V(`String Ensemble`,{"dco.pulse":1,"dco.saw":1,"dco.pwm":.6,"dco.pwmSource":`lfo`,"lfo.rate":.8,"dco.sub":.15,"hpf.freq":`2`,"vcf.freq":2200,"vcf.env":.1,"env.attack":.5,"env.decay":1,"env.sustain":.9,"env.release":.8,"chorus.i":1,"chorus.ii":1}),V(`Choir`,{"dco.pulse":1,"dco.saw":0,"dco.pwm":.3,"dco.sub":.3,"dco.noise":.04,"vcf.freq":1300,"vcf.res":.35,"vcf.env":.1,"env.attack":.45,"env.decay":.8,"env.sustain":.8,"env.release":.9,"chorus.ii":1}),V(`Warm Pad`,{"dco.sub":.4,"vcf.freq":900,"vcf.res":.1,"vcf.env":.15,"vcf.lfo":.1,"lfo.rate":.3,"env.attack":.9,"env.decay":1.5,"env.sustain":.8,"env.release":1.4,"chorus.i":1}),V(`Slow Pad`,{"dco.pwmSource":`lfo`,"dco.pwm":.5,"lfo.rate":.2,"dco.sub":.25,"vcf.freq":1500,"vcf.res":.2,"vcf.env":.3,"env.attack":1.6,"env.decay":2,"env.sustain":.85,"env.release":2.2,"chorus.i":1,"chorus.ii":1}),V(`Sweep Pad`,{"vcf.freq":400,"vcf.res":.55,"vcf.env":.7,"vcf.lfo":.25,"lfo.rate":.15,"env.attack":1.2,"env.decay":2.5,"env.sustain":.7,"env.release":1.8,"chorus.ii":1}),V(`Sub Bass`,{"dco.range":`16`,"dco.pulse":0,"dco.saw":1,"dco.sub":.8,"vcf.freq":350,"vcf.res":.1,"vcf.env":.3,"vcf.kybd":.2,"env.attack":.003,"env.decay":.3,"env.sustain":.8,"env.release":.12,"master.portamento":.05}),V(`Saw Bass`,{"dco.range":`16`,"dco.pulse":0,"dco.sub":.5,"hpf.freq":`1`,"vcf.freq":500,"vcf.res":.3,"vcf.env":.55,"vcf.kybd":.3,"env.attack":.002,"env.decay":.25,"env.sustain":.4,"env.release":.12}),V(`Pluck Bass`,{"dco.range":`16`,"dco.pulse":1,"dco.saw":0,"dco.pwm":.4,"dco.sub":.6,"vcf.freq":300,"vcf.res":.4,"vcf.env":.7,"vcf.kybd":.4,"env.attack":.001,"env.decay":.22,"env.sustain":0,"env.release":.15}),V(`Lead Saw`,{"dco.pulse":0,"dco.sub":.1,"vcf.freq":2400,"vcf.res":.3,"vcf.env":.25,"vcf.kybd":.8,"dco.lfo":.12,"lfo.rate":5.5,"lfo.delay":.6,"env.attack":.01,"env.decay":.3,"env.sustain":.85,"env.release":.2,"master.portamento":.15,"assign.mode":`unison`,"chorus.i":1}),V(`Lead Pulse`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.55,"dco.pwmSource":`lfo`,"lfo.rate":3,"dco.sub":.2,"vcf.freq":2e3,"vcf.res":.35,"vcf.env":.3,"vcf.kybd":.8,"env.attack":.01,"env.decay":.3,"env.sustain":.8,"env.release":.2,"assign.mode":`unison`,"chorus.ii":1}),V(`Whistle Lead`,{"dco.range":`4`,"dco.saw":0,"dco.pulse":1,"dco.pwm":.1,"dco.sub":0,"hpf.freq":`2`,"vcf.freq":3800,"vcf.res":.2,"vcf.env":.1,"dco.lfo":.1,"lfo.rate":5,"lfo.delay":.9,"env.attack":.04,"env.decay":.3,"env.sustain":.9,"env.release":.25,"master.portamento":.25,"assign.mode":`unison`}),V(`Organ`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":0,"dco.sub":.7,"hpf.freq":`2`,"vcf.freq":6e3,"vcf.res":0,"vcf.env":0,"vca.mode":`gate`,"chorus.i":1,"chorus.ii":1}),V(`Clav`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.25,"dco.sub":0,"hpf.freq":`3`,"vcf.freq":1500,"vcf.res":.35,"vcf.env":.55,"vcf.kybd":.9,"env.attack":.001,"env.decay":.18,"env.sustain":0,"env.release":.12}),V(`Pluck`,{"dco.pulse":0,"dco.sub":.2,"vcf.freq":700,"vcf.res":.3,"vcf.env":.6,"env.attack":.001,"env.decay":.35,"env.sustain":0,"env.release":.3,"chorus.i":1}),V(`Harp`,{"dco.range":`4`,"dco.pulse":0,"dco.sub":0,"vcf.freq":1500,"vcf.res":.15,"vcf.env":.35,"env.attack":.001,"env.decay":1.2,"env.sustain":0,"env.release":1,"chorus.ii":1}),V(`Bell Pad`,{"dco.range":`4`,"dco.saw":0,"dco.pulse":1,"dco.pwm":.7,"dco.pwmSource":`lfo`,"lfo.rate":6,"dco.sub":0,"vcf.freq":2500,"vcf.res":.45,"vcf.env":.4,"env.attack":.002,"env.decay":1.6,"env.sustain":.1,"env.release":1.5,"chorus.i":1,"chorus.ii":1}),V(`Noise Sweep`,{"dco.pulse":0,"dco.saw":0,"dco.sub":0,"dco.noise":.8,"hpf.freq":`2`,"vcf.freq":300,"vcf.res":.6,"vcf.env":.8,"env.attack":1.4,"env.decay":1.5,"env.sustain":.1,"env.release":1.2,"chorus.ii":1}),V(`Wind`,{"dco.pulse":0,"dco.saw":0,"dco.sub":0,"dco.noise":.9,"vcf.freq":900,"vcf.res":.55,"vcf.env":.2,"vcf.lfo":.3,"lfo.rate":.25,"vcf.kybd":1,"env.attack":1,"env.decay":1,"env.sustain":.9,"env.release":1.5,"chorus.i":1}),V(`Vibes`,{"dco.range":`4`,"dco.pulse":0,"dco.sub":0,"dco.lfo":.05,"lfo.rate":6,"vcf.freq":2400,"vcf.res":.1,"vcf.env":.2,"env.attack":.002,"env.decay":1.4,"env.sustain":0,"env.release":.9,"chorus.ii":1}),V(`Glass`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.8,"dco.pwmSource":`lfo`,"lfo.rate":.5,"dco.sub":0,"dco.noise":.03,"hpf.freq":`2`,"vcf.freq":4e3,"vcf.res":.25,"vcf.env":.1,"env.attack":.6,"env.decay":1.5,"env.sustain":.7,"env.release":1.6,"chorus.i":1,"chorus.ii":1}),V(`Funk Stab`,{"dco.sub":.3,"hpf.freq":`2`,"vcf.freq":500,"vcf.res":.25,"vcf.env":.65,"vcf.kybd":.7,"env.attack":.001,"env.decay":.16,"env.sustain":0,"env.release":.08,"chorus.ii":1})],Va=Array.from({length:Ra},(e,t)=>Ba[t]??V(`Init`,{})),Ha=[`poly`,`mono`,`unison`],Ua=class{count;mode=`poly`;prefer=`oldest`;voices;held=[];clock=0;constructor(e){this.count=e,this.voices=Array.from({length:e},()=>({gate:!1,since:0}))}isActive(e){return this.voices[e].gate}get activeCount(){return this.voices.filter(e=>e.gate).length}noteOn(e){return this.mode===`poly`?this.polyOn(e):this.stackOn(e)}noteOff(e){return this.mode===`poly`?this.polyOff(e):this.stackOff(e)}releaseAll(){this.held=[];let e=[];return this.voices.forEach((t,n)=>{t.gate&&(t.gate=!1,t.since=++this.clock,e.push({kind:`off`,voice:n}))}),e}get active(){return this.mode===`mono`?[0]:this.voices.map((e,t)=>t)}polyOn(e){let t=this.voices.findIndex(t=>t.gate&&t.note===e);if(t<0){let e=this.voices.map((e,t)=>({v:e,i:t})).filter(e=>!e.v.gate),n=e.length?e:this.voices.map((e,t)=>({v:e,i:t}));t=this.prefer===`lowest`&&e.length?e[0].i:n.reduce((e,t)=>t.v.since<e.v.since?t:e).i}let n=this.voices[t];return n.note=e,n.gate=!0,n.since=++this.clock,[{kind:`on`,voice:t,note:e,retrigger:!0,glide:!0}]}polyOff(e){let t=[];return this.voices.forEach((n,r)=>{n.gate&&n.note===e&&(n.gate=!1,n.since=++this.clock,t.push({kind:`off`,voice:r}))}),t}stackOn(e){let t=this.voices[this.active[0]].gate;return this.held=this.held.filter(t=>t!==e),this.held.push(e),this.play(e,!t,t)}stackOff(e){this.held=this.held.filter(t=>t!==e);let t=this.held[this.held.length-1];if(t!==void 0)return this.play(t,!1,!0);let n=[];for(let e of this.active){let t=this.voices[e];t.gate&&(t.gate=!1,t.since=++this.clock,n.push({kind:`off`,voice:e}))}return n}play(e,t,n){return this.active.map(r=>{let i=this.voices[r],a=t||!i.gate;return i.note=e,i.gate=!0,i.since=++this.clock,{kind:`on`,voice:r,note:e,retrigger:a,glide:n&&!a}})}},Wa=[`poly1`,`poly2`,`unison`],Ga=[`16`,`8`,`4`],Ka=[`0`,`1`,`2`,`3`],qa=[`-2`,`-1`,`0`,`1`,`2`],Ja=1200,Ya=69,Xa=1,Za=64,Qa=.65,$a=12,eo={poly:.4,unison:.3},to=[10,10,240,720],no={16:-1200,8:0,4:Ja},ro={i:{rate:.5,depth:.0013},ii:{rate:.83,depth:.0013},both:{rate:9,depth:25e-5}},io=class extends v{name;transport;slots=[...Va];currentSlot=0;currentPreset=this.slots[0];group=0;bank=1;manualState=!0;manualSnapshot;allocator=new Ua(6);held=[];sounding=new Map;latched=new Set;pedal=!1;bend=0;modWheelValue=0;portamento=0;bendSemitones=2;bendFilter=.2;lfoSensitivity=.3;lfoDepthCents=0;pwmSource=`man`;pwm=.5;envDepth=.4;envSign=1;lfoTrig=!1;chorusI=!1;chorusII=!1;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`Lynch`,t=new _){super(),this.name=e,this.transport=new Et(t),this.transport.channel.set(`omni`);let n=this.circuit;this.addShared(n);for(let e=0;e<6;e++)this.addVoice(n,e);this.addOutput(n),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`}),this.addControls(n)}keyDown(e){let t=e+Number(this.control(`key.transpose`).value)*12;this.held=this.held.filter(t=>t!==e),this.held.push(e),this.latched.delete(e),this.sounding.set(e,t),this.apply(this.allocator.noteOn(t)),this.updateLfoGate(),this.notifyNotes()}keyUp(e){let t=this.sounding.get(e);t!==void 0&&(this.holding?this.latched.add(e):this.release(e,t))}release(e,t){this.sounding.delete(e),this.latched.delete(e),this.held=this.held.filter(t=>t!==e),this.apply(this.allocator.noteOff(t)),this.updateLfoGate(),this.notifyNotes()}get holding(){return this.pedal||this.control(`key.hold`).value}releaseLatched(){for(let e of[...this.latched]){let t=this.sounding.get(e);t!==void 0&&this.release(e,t)}}releaseAll(){this.apply(this.allocator.releaseAll()),this.held=[],this.sounding.clear(),this.latched.clear(),this.updateLfoGate(),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}voiceActive(e){return this.allocator.isActive(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*this.bendSemitones*100),this.circuit.setParam(`bendVcf`,`offset`,this.bend*this.bendFilter*2400),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`lfoPitchMod`,`gain`,this.modWheelValue*this.lfoSensitivity*200),this.updateLfoGate(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}updateLfoGate(){let e=this.lfoTrig?this.modWheelValue>.05:this.held.length>0;this.circuit.setParam(`lfoFade`,`gate`,+!!e)}handleMidi(e){if(e.type!==`clock`&&`channel`in e&&this.transport.acceptsChannel(e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===Xa?this.setModWheel(e.value/127):e.controller===Za&&(this.pedal=e.value>=64,this.pedal||this.releaseLatched());break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}get manual(){return this.manualState}get patchNumber(){let e=this.currentSlot%64;return{group:Math.floor(this.currentSlot/64),bank:Math.floor(e/8)+1,patch:e%8+1}}selectGroup(e){this.group=Math.min(La.length-1,Math.max(0,e)),this.notifyPreset()}selectBank(e){this.bank=Math.min(8,Math.max(1,e)),this.notifyPreset()}selectPatch(e){this.loadSlot(za(this.group,this.bank,e))}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.manualState&&(this.manualSnapshot=this.snapshot()),this.manualState=!1,this.currentSlot=e;let{group:n,bank:r}=this.patchNumber;this.group=n,this.bank=r,this.loadPreset(t)}selectManual(){this.manualState||(this.manualState=!0,this.manualSnapshot&&this.applyValues(this.manualSnapshot),this.notifyPreset())}loadPreset(e){this.currentPreset=e,this.applyValues({...Fa,...e.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){if(Ia.includes(t))continue;let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)Ia.includes(t.id)||(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}write(e=za(this.group,this.bank,this.patchNumber.patch)){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.manualState=!1,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}apply(e){let t=this.circuit;for(let n of e){let e=e=>`v${n.voice}.${e}`;n.kind===`off`?(t.setParam(e(`env`),`gate`,0),t.setParam(e(`gate`),`gate`,0)):(t.setParam(e(`pitch`),`offset`,(n.note-Ya)*100),n.retrigger&&(t.setParam(e(`env`),`gate`,1),t.setParam(e(`gate`),`gate`,1)))}}eachVoice(e){for(let t=0;t<6;t++)e(e=>`v${t}.${e}`)}applyMode(e){this.releaseAll(),this.allocator.mode=e===`unison`?`unison`:`poly`,this.allocator.prefer=e===`poly2`?`lowest`:`oldest`;let t=e===`unison`?eo.unison:eo.poly;this.eachVoice(e=>this.circuit.setParam(e(`out`),`gain`,t));let n=e===`unison`?$a:0,r=5/2;for(let e=0;e<6;e++){let t=(e-r)/r*n;this.circuit.setParam(`v${e}.det`,`offset`,t===0?0:t)}}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyPreset(){for(let e of this.presetListeners)e()}addShared(e){e.add(`bend`,`constant`,{offset:0}).add(`tune`,`constant`,{offset:0}).add(`rangeShift`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:-1200}).add(`pwCv`,`constant`,{offset:0}).add(`bendVcf`,`constant`,{offset:0}).add(`lfoOsc`,`oscillator`,{frequency:5,detune:0},{waveform:`triangle`}).add(`lfoFade`,`envelope`,{attack:.001,decay:.001,sustain:1,release:.02,gate:0}).add(`lfoFadeGain`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPitchMod`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0}).add(`noise`,`noise`).add(`voices`,`gain`,{gain:1}).connect(`lfoOsc`,`lfoFadeGain`).connect(`lfoFade`,`lfoFadeGain`,`gain`).connect(`lfoFadeGain`,`lfo`);for(let t of[`lfoPitch`,`lfoPitchMod`,`lfoPw`,`lfoFilter`])e.connect(`lfo`,t)}addVoice(e,t){let n=e=>`v${t}.${e}`;e.add(n(`pitch`),`constant`,{offset:0,glide:0}).add(n(`det`),`constant`,{offset:0}).add(n(`osc`),`oscillator`,{frequency:440,detune:0},{waveform:`sawtooth`}).add(n(`sub`),`oscillator`,{frequency:440,detune:0},{waveform:`square`}).add(n(`rawOut`),`gain`,{gain:1}).add(n(`pulseSum`),`gain`,{gain:1}).add(n(`shaper`),`waveshaper`,{},{curve:`pulse`}).add(n(`pulseOut`),`gain`,{gain:Qa}).add(n(`subLevel`),`gain`,{gain:0}).add(n(`noiseLevel`),`gain`,{gain:0}).add(n(`mix`),`gain`,{gain:.5}).add(n(`boost`),`filter`,{frequency:120,Q:.707,gain:0,detune:0},{type:`lowshelf`}).add(n(`hpf`),`filter`,{frequency:10,Q:.707,gain:0,detune:0},{type:`highpass`}).add(n(`f1`),`filter`,{frequency:3e3,Q:1,detune:0},{type:`lowpass`}).add(n(`f2`),`filter`,{frequency:3e3,Q:.707,detune:0},{type:`lowpass`}).add(n(`keyFollow`),`gain`,{gain:.5}).add(n(`env`),`envelope`,{attack:.005,decay:.4,sustain:.6,release:.3,gate:0}).add(n(`envDepth`),`gain`,{gain:.4*6*Ja}).add(n(`gate`),`envelope`,{attack:.003,decay:.001,sustain:1,release:.015,gate:0}).add(n(`envAmp`),`gain`,{gain:1}).add(n(`gateAmp`),`gain`,{gain:0}).add(n(`amp`),`gain`,{gain:0}).add(n(`out`),`gain`,{gain:eo.poly});for(let t of[`osc`,`sub`])for(let r of[n(`pitch`),n(`det`),`bend`,`tune`,`rangeShift`,`lfoPitch`,`lfoPitchMod`])e.connect(r,n(t),`detune`);e.connect(`subShift`,n(`sub`),`detune`).connect(n(`osc`),n(`rawOut`)).connect(n(`osc`),n(`pulseSum`)).connect(`pwCv`,n(`pulseSum`)).connect(`lfoPw`,n(`pulseSum`)).connect(n(`pulseSum`),n(`shaper`)).connect(n(`shaper`),n(`pulseOut`)).connect(n(`rawOut`),n(`mix`)).connect(n(`pulseOut`),n(`mix`)).connect(n(`sub`),n(`subLevel`)).connect(n(`subLevel`),n(`mix`)).connect(`noise`,n(`noiseLevel`)).connect(n(`noiseLevel`),n(`mix`)).connect(n(`mix`),n(`boost`)).connect(n(`boost`),n(`hpf`)).connect(n(`hpf`),n(`f1`)).connect(n(`f1`),n(`f2`)).connect(n(`f2`),n(`amp`)).connect(n(`env`),n(`envDepth`)).connect(n(`pitch`),n(`keyFollow`));for(let t of[`f1`,`f2`])e.connect(n(`envDepth`),n(t),`detune`).connect(n(`keyFollow`),n(t),`detune`).connect(`lfoFilter`,n(t),`detune`).connect(`bendVcf`,n(t),`detune`);e.connect(n(`env`),n(`envAmp`)).connect(n(`envAmp`),n(`amp`),`gain`).connect(n(`gate`),n(`gateAmp`)).connect(n(`gateAmp`),n(`amp`),`gain`).connect(n(`amp`),n(`out`)).connect(n(`out`),`voices`)}addOutput(e){e.add(`chDry`,`gain`,{gain:1}).add(`chLfo`,`oscillator`,{frequency:.5,detune:0},{waveform:`triangle`}).add(`chDelayL`,`delay`,{delayTime:.0035,maxTime:.02}).add(`chDelayR`,`delay`,{delayTime:.0035,maxTime:.02}).add(`chDepthL`,`gain`,{gain:ro.i.depth}).add(`chDepthR`,`gain`,{gain:-ro.i.depth}).add(`chToneL`,`filter`,{frequency:9e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`chToneR`,`filter`,{frequency:9e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`chPanL`,`pan`,{pan:-1}).add(`chPanR`,`pan`,{pan:1}).add(`chWet`,`gain`,{gain:0}).add(`chSum`,`gain`,{gain:1}).add(`vcaLevel`,`gain`,{gain:.8}).add(`volume`,`gain`,{gain:.75}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`voices`,`chDry`).connect(`chDry`,`chSum`).connect(`voices`,`chDelayL`).connect(`voices`,`chDelayR`).connect(`chDelayL`,`chToneL`).connect(`chDelayR`,`chToneR`).connect(`chToneL`,`chPanL`).connect(`chToneR`,`chPanR`).connect(`chPanL`,`chWet`).connect(`chPanR`,`chWet`).connect(`chWet`,`chSum`).connect(`chLfo`,`chDepthL`).connect(`chLfo`,`chDepthR`).connect(`chDepthL`,`chDelayL`,`delayTime`).connect(`chDepthR`,`chDelayR`,`delayTime`).connect(`chSum`,`vcaLevel`).connect(`vcaLevel`,`volume`).connect(`volume`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`)}addControls(e){let t=Fa,n=e=>t[e],r=(e,t,r,i,a,o,s)=>this.controlList.push(new y(e,t,r,i,n(e),a,o,s)),i=e=>t=>this.eachVoice(n=>e(n,t)),a=(e,t,r)=>this.controlList.push(new x(e,t,n(e)>0,r)),o=(e,n,r,i)=>this.controlList.push(new b(e,n,r,t[e],i));r(`lfo.rate`,`Rate`,.1,30,`Hz`,t=>e.setParam(`lfoOsc`,`frequency`,t),`log`),r(`lfo.delay`,`Delay time`,0,3,`s`,t=>e.setParam(`lfoFade`,`attack`,Math.max(.001,t))),r(`dco.lfo`,`LFO`,0,1,``,t=>{this.lfoDepthCents=t*150,e.setParam(`lfoPitch`,`gain`,this.lfoDepthCents)}),r(`dco.pwm`,`PWM`,0,1,``,e=>{this.pwm=e,this.applyPulseWidth()}),o(`dco.pwmSource`,`PWM source`,[`man`,`lfo`],e=>{this.pwmSource=e,this.applyPulseWidth()}),o(`dco.range`,`Range`,Ga,t=>e.setParam(`rangeShift`,`offset`,no[t])),a(`dco.pulse`,`Pulse`,t=>this.eachVoice(n=>e.setParam(n(`pulseOut`),`gain`,t?Qa:0))),a(`dco.saw`,`Saw`,t=>this.eachVoice(n=>e.setParam(n(`rawOut`),`gain`,+!!t))),r(`dco.sub`,`Sub`,0,1,``,i((t,n)=>e.setParam(t(`subLevel`),`gain`,n*.6))),r(`dco.noise`,`Noise`,0,1,``,i((t,n)=>e.setParam(t(`noiseLevel`),`gain`,n*.5))),o(`hpf.freq`,`HPF`,Ka,t=>{let n=Number(t);this.eachVoice(t=>{e.setParam(t(`boost`),`gain`,n===0?6:0),e.setParam(t(`hpf`),`frequency`,to[n])})}),r(`vcf.freq`,`Freq`,20,2e4,`Hz`,i((t,n)=>{e.setParam(t(`f1`),`frequency`,n),e.setParam(t(`f2`),`frequency`,n)}),`log`),r(`vcf.res`,`Res`,0,1,``,i((t,n)=>e.setParam(t(`f1`),`Q`,.5*32**n))),r(`vcf.env`,`Env`,0,1,``,e=>{this.envDepth=e,this.applyEnvDepth()}),o(`vcf.polarity`,`Env polarity`,[`plus`,`minus`],e=>{this.envSign=e===`minus`?-1:1,this.applyEnvDepth()}),r(`vcf.lfo`,`LFO`,0,1,``,t=>e.setParam(`lfoFilter`,`gain`,t*3*Ja)),r(`vcf.kybd`,`Kybd`,0,1,``,i((t,n)=>e.setParam(t(`keyFollow`),`gain`,n))),o(`vca.mode`,`VCA`,[`env`,`gate`],t=>this.eachVoice(n=>{e.setParam(n(`envAmp`),`gain`,+(t===`env`)),e.setParam(n(`gateAmp`),`gain`,+(t===`gate`))})),r(`vca.level`,`Level`,0,1,``,t=>e.setParam(`vcaLevel`,`gain`,t));let s=(t,n,a,o)=>r(`env.${t}`,n,a,o,`s`,i((n,r)=>e.setParam(n(`env`),t,r)),`log`);s(`attack`,`A`,.001,3),s(`decay`,`D`,.002,12),r(`env.sustain`,`S`,0,1,``,i((t,n)=>e.setParam(t(`env`),`sustain`,n))),s(`release`,`R`,.002,12),a(`chorus.i`,`Chorus I`,e=>{this.chorusI=e,this.applyChorus()}),a(`chorus.ii`,`Chorus II`,e=>{this.chorusII=e,this.applyChorus()}),r(`bend.dco`,`Bender DCO`,0,12,`st`,e=>{this.bendSemitones=e,this.setPitchBend(this.bend)}),r(`bend.vcf`,`Bender VCF`,0,1,``,e=>{this.bendFilter=e,this.setPitchBend(this.bend)}),r(`bend.lfo`,`Bender LFO`,0,1,``,e=>{this.lfoSensitivity=e,this.setModWheel(this.modWheelValue)}),a(`bend.lfoTrig`,`LFO trig`,e=>{this.lfoTrig=e,this.updateLfoGate()}),r(`master.portamento`,`Portamento`,0,1,``,t=>{this.portamento=t;let n=t*t*2.5;this.eachVoice(t=>e.setParam(t(`pitch`),`glide`,n))}),o(`assign.mode`,`Assign`,Wa,e=>this.applyMode(e)),r(`master.tune`,`Tune`,-50,50,`ct`,t=>e.setParam(`tune`,`offset`,t)),r(`master.volume`,`Volume`,0,1,``,t=>e.setParam(`volume`,`gain`,t)),a(`key.hold`,`Hold`,e=>{e||this.releaseLatched()}),o(`key.transpose`,`Key transpose`,qa,()=>{})}applyPulseWidth(){let e=this.circuit;this.pwmSource===`man`?(e.setParam(`pwCv`,`offset`,1-2*((50-this.pwm*45)/100)),e.setParam(`lfoPw`,`gain`,0)):(e.setParam(`pwCv`,`offset`,0),e.setParam(`lfoPw`,`gain`,this.pwm*.9))}applyEnvDepth(){this.eachVoice(e=>this.circuit.setParam(e(`envDepth`),`gain`,this.envSign*this.envDepth*6*Ja))}applyChorus(){let e=this.circuit,t=this.chorusI,n=this.chorusII,r=t&&n?ro.both:t?ro.i:n?ro.ii:void 0,i=r!==void 0,a=r??ro.i;e.setParam(`chLfo`,`frequency`,a.rate),e.setParam(`chDepthL`,`gain`,a.depth),e.setParam(`chDepthR`,`gain`,-a.depth),e.setParam(`chWet`,`gain`,i?.7:0),e.setParam(`chDry`,`gain`,i?.75:1)}},ao={"env.attack":1,"env.decay":30,"env.sustain":0,"env.release":200,"env.keytrack":0,"env.velocity":.5,"env.legato":0,"gen.noise":1,"gen.cutoff":100,"gen.reso":.2,"gen.keytrack":.5,"gen.envAmt":0,"gen.onePole":0,"gen.gain":1.5,"fb.push":0,"fb.decay":2,"fb.release":.4,"sat.hardness":.3,"sat.symmetry":0,"patch.volume":.8,"delay.tune":0,"delay.fine":0,"delay.harmonics":0,"delay.split":0,"delay.splitPoint":.5,"delay.polarity":0,"filter.highpass":-36,"filter.lowpass":36,"filter.hpComp":1,"filter.lpComp":1,"voice.mode":`poly`,"voice.detune":12,"voice.glide":100,"voice.glideOn":0,"lfo.wave":`sine`,"lfo.rate":5,"lfo.sync":0,"lfo.division":`1/8`,"lfo.delay":0,"lfo.amount":0,"lfo.dest":`pitch`,"rev.mix":.25,"rev.bass":120,"rev.treble":8e3,"rev.size":`medium`,"rev.spread":.5},H=(e,t)=>({name:e,values:t}),oo={"env.attack":60,"env.decay":200,"env.sustain":1,"env.release":250,"gen.noise":.06,"gen.gain":.3,"fb.push":1.2,"fb.decay":4,"fb.release":.3,"sat.hardness":.1,"filter.highpass":-36,"filter.lowpass":30},so={"gen.gain":1.9},co=[[H(`Nylon Pluck`,{...so,"gen.cutoff":90,"gen.keytrack":.7,"fb.decay":1.8,"fb.release":.25,"filter.lowpass":30,"sat.hardness":.2,"rev.mix":.2}),H(`Steel String`,{...so,"gen.cutoff":120,"delay.harmonics":.12,"fb.decay":3.5,"fb.release":.35,"filter.lowpass":48,"sat.hardness":.4,"env.velocity":.7}),H(`Muted Bass`,{...so,"delay.tune":-12,"gen.cutoff":70,"gen.keytrack":.2,"fb.decay":.9,"fb.release":.15,"filter.lowpass":18,"filter.highpass":-48,"voice.mode":`mono`,"rev.mix":.08,"patch.volume":1}),H(`Harp`,{...so,"gen.cutoff":100,"gen.keytrack":.6,"delay.harmonics":.05,"fb.decay":5,"fb.release":.6,"filter.lowpass":36,"rev.size":`large`,"rev.mix":.35}),H(`Marimba`,{...so,"env.attack":1,"env.decay":20,"gen.cutoff":80,"delay.split":1,"delay.splitPoint":.4,"delay.harmonics":.4,"fb.decay":.7,"fb.release":.2,"filter.lowpass":24,"filter.highpass":-48,"rev.mix":.15}),H(`Glass Bell`,{...so,"delay.tune":12,"delay.split":1,"delay.splitPoint":.3,"delay.harmonics":.6,"fb.decay":6,"fb.release":2,"sat.hardness":.1,"filter.lowpass":60,"filter.highpass":-48,"rev.size":`large`,"rev.mix":.4}),H(`Wood Block`,{...so,"env.decay":15,"gen.gain":2,"delay.split":1,"delay.splitPoint":.5,"delay.harmonics":.2,"fb.decay":.25,"fb.release":.1,"filter.lowpass":40,"filter.highpass":-24,"rev.mix":.1}),H(`Kalimba`,{...so,"delay.tune":12,"gen.noise":.8,"delay.split":1,"delay.splitPoint":.6,"delay.harmonics":.3,"fb.decay":1.2,"fb.release":.3,"filter.lowpass":42,"filter.highpass":-48,"rev.mix":.3})],[H(`Pan Flute`,{...oo,"delay.polarity":1,"voice.mode":`mono`,"env.legato":1,"voice.glideOn":1,"voice.glide":60,"lfo.amount":.12,"lfo.rate":5,"lfo.delay":.6,"lfo.dest":`pitch`,"rev.mix":.3}),H(`Clarinet`,{...oo,"delay.polarity":1,"gen.noise":.1,"gen.gain":.35,"env.attack":30,"sat.hardness":.5,"filter.lowpass":36,"voice.mode":`mono`,"env.legato":1,"rev.mix":.2}),H(`Reed Organ`,{...oo,"gen.noise":.08,"env.attack":40,"env.release":200,"sat.hardness":.6,"sat.symmetry":.2,"filter.lowpass":40,"rev.mix":.25}),H(`Pipe Organ`,{...oo,"gen.noise":.05,"env.attack":80,"env.release":500,"filter.lowpass":24,"rev.size":`large`,"rev.mix":.45}),H(`Brass`,{...oo,"gen.noise":.1,"gen.gain":.5,"env.attack":80,"env.decay":200,"env.sustain":.7,"sat.hardness":.7,"sat.symmetry":.6,"filter.lowpass":42,"lfo.dest":`filter`,"lfo.amount":.1,"lfo.rate":6,"rev.mix":.2}),H(`Overblown`,{...oo,"delay.polarity":1,"lfo.dest":`filter`,"lfo.amount":.6,"lfo.rate":.3,"lfo.wave":`sine`,"rev.mix":.3}),H(`Steam Drone`,{...oo,"env.attack":1500,"env.release":3e3,"gen.noise":.2,"fb.decay":20,"fb.release":3,"voice.mode":`unison`,"voice.detune":25,"rev.size":`large`,"rev.mix":.5,"rev.spread":1}),H(`Wind Chimes`,{"delay.tune":12,"delay.split":1,"delay.splitPoint":.2,"delay.harmonics":.5,"fb.decay":8,"fb.release":4,"filter.lowpass":54,"filter.highpass":-48,"sat.hardness":.05,"rev.size":`large`,"rev.mix":.5,"rev.spread":1})]].flat(),lo=[`poly`,`mono`,`unison`],uo=[`sine`,`tri`,`sqr`,`ramp`,`rnd`],fo=[`pitch`,`filter`,`steam`,`sat`,`push`],po=[`1/1`,`1/2`,`1/4`,`1/8`,`1/16`,`1/32`],mo=1,ho=64,go=2,_o=.8,vo=3,yo=class extends v{name;transport;slots=[...co];currentSlot=0;currentPreset=this.slots[0];held=[];bend=0;modWheelValue=0;lfoHz=5;lfoSync=!1;lfoDivision=`1/8`;clockPulses=0;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`Pipe`,t=new _){super(),this.name=e,this.transport=new Et(t),this.transport.channel.set(`omni`),this.circuit.add(`pipe`,`pipe`,{atk:.001,dec:.03,sus:0,rel:.2,envKey:0,vel:.5,legato:0,noise:1,nCut:100,nRes:.2,nKey:.5,nEnv:0,onePole:0,gain:.8,tune:0,fine:0,harm:0,split:0,splitPt:.5,pol:0,fbDec:2,fbRel:.4,push:0,satHard:.3,satSym:0,hp:-36,lp:36,hpComp:1,lpComp:1,mode:0,detune:12,glide:.1,glideOn:0,spread:.5,volume:.8,lfoRate:5,lfoShape:0,lfoDelay:0,lfoAmt:0,lfoDest:0,bend:0,mod:0}).add(`dry`,`gain`,{gain:1}).add(`revIn`,`gain`,{gain:1}).add(`conv`,`convolver`,{},{size:`medium`}).add(`revLow`,`filter`,{frequency:120,Q:.707,detune:0},{type:`highpass`}).add(`revHigh`,`filter`,{frequency:8e3,Q:.707,detune:0},{type:`lowpass`}).add(`wet`,`gain`,{gain:0}).add(`sum`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`pipe`,`dry`).connect(`pipe`,`revIn`).connect(`revIn`,`conv`).connect(`conv`,`revLow`).connect(`revLow`,`revHigh`).connect(`revHigh`,`wet`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`}),this.addControls(),this.transport.tempo.onChange(()=>this.applyLfoRate())}addControls(){let e=this.circuit,t=ao,n=(e,n,r,i,a,o,s)=>this.controlList.push(new y(e,n,r,i,t[e],a,o,s)),r=(t,r,i,a,o,s,c=1,l)=>n(t,r,i,a,o,t=>e.setParam(`pipe`,s,t*c),l),i=(n,r,i)=>this.controlList.push(new x(n,r,(t[n]??0)>0,t=>e.setParam(`pipe`,i,+!!t)));r(`env.attack`,`Attack`,.5,1e4,`ms`,`atk`,1/1e3,`log`),r(`env.decay`,`Decay`,1,1e4,`ms`,`dec`,1/1e3,`log`),r(`env.sustain`,`Sustain`,0,1,``,`sus`),r(`env.release`,`Release`,5,2e4,`ms`,`rel`,1/1e3,`log`),r(`env.keytrack`,`Keytrack`,0,1,``,`envKey`),r(`env.velocity`,`Velocity`,0,1,``,`vel`),i(`env.legato`,`Legato`,`legato`),r(`gen.noise`,`DC / Noise`,0,1,``,`noise`),r(`gen.cutoff`,`Cutoff`,30,140,`pitch`,`nCut`),r(`gen.reso`,`Resonance`,0,1,``,`nRes`),r(`gen.keytrack`,`Keytrack`,0,1,``,`nKey`),r(`gen.envAmt`,`Env amount`,-48,48,`st`,`nEnv`),r(`gen.gain`,`Gain`,0,2,``,`gain`),i(`gen.onePole`,`1-pole`,`onePole`),r(`fb.push`,`Push`,0,1.5,``,`push`),r(`fb.decay`,`Decay`,.05,30,`s`,`fbDec`,1,`log`),r(`fb.release`,`Release`,.02,20,`s`,`fbRel`,1,`log`),r(`sat.hardness`,`Soft / Hard`,0,1,``,`satHard`),r(`sat.symmetry`,`Symmetry`,0,1,``,`satSym`),r(`patch.volume`,`Volume`,0,1.2,``,`volume`),r(`delay.tune`,`Tune`,-24,24,`st`,`tune`),r(`delay.fine`,`Fine`,-100,100,`ct`,`fine`),r(`delay.harmonics`,`Harmonics`,0,1,``,`harm`),r(`delay.splitPoint`,`Split point`,.05,.95,``,`splitPt`),i(`delay.split`,`Split`,`split`),i(`delay.polarity`,`Polarity`,`pol`),r(`filter.highpass`,`Highpass`,-60,36,`st`,`hp`),r(`filter.lowpass`,`Lowpass`,0,84,`st`,`lp`),r(`filter.hpComp`,`HP comp`,0,1,``,`hpComp`),r(`filter.lpComp`,`LP comp`,0,1,``,`lpComp`),this.controlList.push(new b(`voice.mode`,`Mode`,lo,`poly`,t=>{this.releaseAll(),e.setParam(`pipe`,`mode`,lo.indexOf(t))})),r(`voice.detune`,`Detune`,0,100,`ct`,`detune`),r(`voice.glide`,`Glide`,1,5e3,`ms`,`glide`,1/1e3,`log`),i(`voice.glideOn`,`Glide on`,`glideOn`),this.controlList.push(new b(`lfo.wave`,`Wave`,uo,`sine`,t=>e.setParam(`pipe`,`lfoShape`,uo.indexOf(t))),new b(`lfo.dest`,`Destination`,fo,`pitch`,t=>e.setParam(`pipe`,`lfoDest`,fo.indexOf(t))),new b(`lfo.division`,`Division`,po,`1/8`,e=>{this.lfoDivision=e,this.applyLfoRate()}),new x(`lfo.sync`,`Sync`,!1,e=>{this.lfoSync=e,this.applyLfoRate()})),n(`lfo.rate`,`Rate`,.05,40,`Hz`,e=>{this.lfoHz=e,this.applyLfoRate()},`log`),r(`lfo.delay`,`Delay`,0,5,`s`,`lfoDelay`),r(`lfo.amount`,`Amount`,0,1,``,`lfoAmt`),n(`rev.mix`,`Mix`,0,1,``,t=>{e.setParam(`dry`,`gain`,Math.cos(t*Math.PI/2)),e.setParam(`wet`,`gain`,Math.sin(t*Math.PI/2)*vo)}),n(`rev.bass`,`Bass`,20,800,`Hz`,t=>e.setParam(`revLow`,`frequency`,t),`log`),n(`rev.treble`,`Treble`,1500,16e3,`Hz`,t=>e.setParam(`revHigh`,`frequency`,t),`log`),r(`rev.spread`,`Spread`,0,1,``,`spread`),this.controlList.push(new b(`rev.size`,`Size`,It,`medium`,t=>e.setOption(`conv`,`size`,t)))}applyLfoRate(){let e=Number(this.lfoDivision.split(`/`)[1]),t=this.lfoSync?this.transport.bpm/60*e/4:this.lfoHz;this.circuit.setParam(`pipe`,`lfoRate`,Math.min(40,Math.max(.05,t)))}releaseAll(){this.circuit.allNotesOff(`pipe`),this.held.length>0&&(this.held=[],this.notifyNotes())}keyDown(e,t=_o){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.circuit.noteOn(`pipe`,e,t),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.circuit.noteOff(`pipe`,e),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}setSustain(e){this.circuit.pedal(`pipe`,e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`pipe`,`bend`,this.bend*go),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`pipe`,`mod`,this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(e.type===`clock`)this.lfoSync&&this.transport.synced&&++this.clockPulses%24==0&&this.applyLfoRate();else if(`channel`in e&&this.transport.acceptsChannel(e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity/127);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===mo?this.setModWheel(e.value/127):e.controller===ho&&this.setSustain(e.value>=64);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...ao,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}},bo={"osc.wave":`saw`,"osc.width":50,"osc.pwm":0,"osc.vibrato":0,"osc.sub":.3,"filter.cutoff":2400,"filter.resonance":1,"filter.env":2,"filter.lfo":0,"filter.key":50,"amp.lfo":0,"amp.key":0,level:.7,"lfo.wave":`tri`,"lfo.rate":5,"lfo.sync":0,"lfo.division":`1/8`,"env1.attack":.005,"env1.decay":.4,"env1.sustain":.4,"env1.release":.4,"env2.attack":.005,"env2.decay":.3,"env2.sustain":.7,"env2.release":.35,"voices.mode":`poly`,"voices.portamento":0,"voices.detune":12,"fx.chorus":0,"fx.delayTime":.35,"fx.feedback":.3,"fx.mix":0},U=(e,t)=>({name:e,values:t}),xo=[[U(`Soft Pad`,{"osc.sub":.2,"filter.cutoff":900,"filter.resonance":1.2,"filter.env":1.5,"filter.lfo":.3,"env1.attack":.6,"env1.decay":1.2,"env1.sustain":.5,"env1.release":1.5,"env2.attack":.5,"env2.decay":.8,"env2.sustain":.8,"env2.release":1.6,"lfo.rate":.4,"fx.chorus":.7,"fx.mix":.15,"fx.delayTime":.45,"fx.feedback":.35,level:.6}),U(`Warm Brass`,{"osc.sub":.3,"filter.cutoff":700,"filter.env":3.2,"osc.vibrato":8,"env1.attack":.12,"env1.decay":.5,"env1.sustain":.55,"env1.release":.25,"env2.attack":.06,"env2.decay":.3,"env2.sustain":.85,"env2.release":.2,"fx.chorus":.3}),U(`Pluck Bass`,{"voices.mode":`mono`,"osc.sub":.6,"filter.cutoff":350,"filter.resonance":4,"filter.env":3.5,"env1.attack":.001,"env1.decay":.22,"env1.sustain":0,"env1.release":.15,"env2.attack":.001,"env2.decay":.35,"env2.sustain":.5,"env2.release":.1,"voices.portamento":.05}),U(`Glass Keys`,{"osc.wave":`tri`,"osc.sub":0,"filter.cutoff":5200,"filter.resonance":.5,"filter.env":.5,"env1.attack":.001,"env1.decay":.8,"env1.sustain":.2,"env1.release":.6,"env2.attack":.002,"env2.decay":1.2,"env2.sustain":.1,"env2.release":.8,"fx.chorus":.45,"fx.mix":.2,"fx.delayTime":.3,"fx.feedback":.4}),U(`Slow Strings`,{"filter.cutoff":3e3,"filter.env":.6,"filter.key":70,"osc.vibrato":12,"lfo.rate":5.5,"env1.attack":.8,"env1.decay":1,"env1.sustain":.7,"env1.release":1.2,"env2.attack":.9,"env2.decay":1,"env2.sustain":.9,"env2.release":1.4,"fx.chorus":.8}),U(`Sweep Lead`,{"voices.mode":`mono`,"osc.wave":`pulse`,"osc.width":30,"osc.pwm":.4,"osc.sub":.2,"lfo.rate":.7,"filter.cutoff":1500,"filter.resonance":5,"filter.env":2.5,"env1.attack":.001,"env1.decay":.8,"env1.sustain":.35,"env1.release":.3,"env2.sustain":.9,"voices.portamento":.12,"fx.mix":.3,"fx.delayTime":.4,"fx.feedback":.45}),U(`Wobble Sub`,{"voices.mode":`mono`,"osc.sub":.8,"filter.cutoff":260,"filter.resonance":6,"filter.lfo":2.2,"filter.env":.5,"lfo.sync":1,"lfo.division":`1/8`,"env2.sustain":.95,level:.55}),U(`Bell Pluck`,{"osc.wave":`tri`,"osc.sub":0,"filter.cutoff":8e3,"filter.resonance":.3,"filter.env":.2,"osc.vibrato":4,"env1.attack":.001,"env1.decay":.5,"env1.sustain":0,"env1.release":.4,"env2.attack":.001,"env2.decay":1.6,"env2.sustain":0,"env2.release":1.4,"fx.chorus":.3,"fx.mix":.3,"fx.delayTime":.5,"fx.feedback":.5})],[U(`Init`,{}),U(`Analog Poly`,{"filter.cutoff":1800,"filter.resonance":1.5,"filter.env":2,"env1.attack":.01,"env1.decay":.5,"env1.sustain":.35,"env1.release":.4,"env2.attack":.01,"env2.decay":.4,"env2.sustain":.75,"env2.release":.4,"fx.chorus":.35}),U(`Choir Air`,{"osc.wave":`pulse`,"osc.width":40,"osc.pwm":.2,"filter.cutoff":1600,"filter.resonance":2.5,"filter.env":1,"env2.attack":.35,"env2.decay":.6,"env2.sustain":.85,"env2.release":1.1,"fx.chorus":.6,"fx.mix":.2}),U(`Retro Stab`,{"filter.cutoff":600,"filter.resonance":2,"filter.env":4,"env1.attack":.001,"env1.decay":.22,"env1.sustain":0,"env1.release":.2,"env2.attack":.001,"env2.decay":.25,"env2.sustain":0,"env2.release":.2,"fx.chorus":.5}),U(`Fifth Lead`,{"voices.mode":`unison`,"voices.detune":18,"filter.cutoff":2600,"filter.resonance":2,"filter.env":1.5,"env2.sustain":.8,"voices.portamento":.08,"fx.mix":.25}),U(`Dream Wash`,{"osc.sub":.4,"filter.cutoff":1100,"lfo.rate":.3,"filter.lfo":.4,"env1.attack":1.8,"env1.decay":1,"env1.sustain":.6,"env1.release":2.5,"env2.attack":1.5,"env2.decay":1,"env2.sustain":.85,"env2.release":3,"fx.chorus":.9,"fx.mix":.4,"fx.delayTime":.6,"fx.feedback":.6,level:.55}),U(`Pulse Organ`,{"osc.wave":`pulse`,"osc.width":50,"osc.sub":.5,"filter.cutoff":3200,"filter.resonance":.5,"filter.env":.3,"osc.vibrato":6,"lfo.rate":6.5,"env2.attack":.005,"env2.decay":.1,"env2.sustain":1,"env2.release":.08,"fx.chorus":.3}),U(`Space Arp`,{"osc.wave":`pulse`,"osc.width":25,"osc.pwm":.6,"lfo.rate":1.2,"filter.cutoff":1e3,"filter.resonance":3,"filter.env":3,"env1.attack":.001,"env1.decay":.25,"env1.sustain":.1,"env1.release":.2,"env2.attack":.002,"env2.decay":.3,"env2.sustain":.2,"env2.release":.25,"fx.mix":.4,"fx.delayTime":.38,"fx.feedback":.55,"fx.chorus":.2})]],So=xo.flat(),Co=1200,wo=69,To=200,Eo=100,Do=1,Oo=[`saw`,`pulse`,`tri`],ko=[`tri`,`up`,`down`,`sqr`,`rnd`],Ao=[`1/1`,`1/2`,`1/4`,`1/8`,`1/16`,`1/32`],jo={poly:.45,mono:.6,unison:.34},Mo=.65,No=class extends v{name;transport;slots=[...So];currentSlot=xo[0].length;currentPreset=this.slots[this.currentSlot];allocator=new Ua(6);held=[];bend=0;modWheelValue=0;vibratoCents=0;portamento=0;unisonDetune=12;lfoHz=5;lfoSync=!1;lfoDivision=`1/8`;clockPulses=0;performanceListeners=new Set;noteListeners=new Set;presetListeners=new Set;constructor(e=`Poly`,t=new _){super(),this.name=e,this.transport=new Et(t),this.transport.channel.set(`2`);let n=this.circuit;this.addShared(n);for(let e=0;e<6;e++)this.addVoice(n,e);this.addEffects(n),this.outputList.push({name:`out`,nodeId:`level`}),this.addControls(n),this.transport.tempo.onChange(()=>this.applyLfoRate())}keyDown(e){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.apply(this.allocator.noteOn(e)),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.apply(this.allocator.noteOff(e)),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}voiceActive(e){return this.allocator.isActive(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*To),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.applyVibrato(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(e.type===`clock`)this.lfoSync&&this.transport.synced&&++this.clockPulses%24==0&&this.applyLfoRate();else if(!(`channel`in e&&!this.transport.acceptsChannel(e.channel)))switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===Do&&this.setModWheel(e.value/127);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...bo,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e,t=this.slots[e].name){let n={name:t,values:this.snapshot()};this.slots[e]=n,this.currentSlot=e,this.currentPreset=n;for(let e of this.presetListeners)e();return n}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}apply(e){let t=this.circuit;for(let n of e){let e=e=>`v${n.voice}.${e}`;n.kind===`off`?(t.setParam(e(`env1`),`gate`,0),t.setParam(e(`env2`),`gate`,0)):(n.glide||t.setParam(e(`pitch`),`glide`,0),t.setParam(e(`pitch`),`offset`,(n.note-wo)*100),n.glide||t.setParam(e(`pitch`),`glide`,this.portamento),n.retrigger&&(t.setParam(e(`env1`),`gate`,1),t.setParam(e(`env2`),`gate`,1)))}}eachVoice(e){for(let t=0;t<6;t++)e(e=>`v${t}.${e}`)}applyMode(e){this.apply(this.allocator.releaseAll()),this.held=[],this.allocator.mode=e,this.eachVoice(t=>this.circuit.setParam(t(`out`),`gain`,jo[e])),this.applyDetune(),this.notifyNotes()}applyDetune(){let e=this.allocator.mode===`unison`?this.unisonDetune:0,t=5/2;for(let n=0;n<6;n++){let r=(n-t)/t*e;this.circuit.setParam(`v${n}.det`,`offset`,r===0?0:r)}}applyVibrato(){this.circuit.setParam(`lfoPitch`,`gain`,this.vibratoCents+this.modWheelValue*Eo)}applyLfoRate(){let e=Number(this.lfoDivision.split(`/`)[1]),t=this.lfoSync?this.transport.bpm/60*e/4:this.lfoHz;this.circuit.setParam(`lfoOsc`,`frequency`,t),this.circuit.setParam(`lfoRnd`,`rate`,t)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}addShared(e){e.add(`bend`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:-1200}).add(`pwCv`,`constant`,{offset:0}).add(`lfoOsc`,`oscillator`,{frequency:5,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:5}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoSign`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0}).add(`lfoAmp`,`gain`,{gain:0}).add(`voices`,`gain`,{gain:1}).connect(`lfoOsc`,`lfoOscOut`).connect(`lfoOscOut`,`lfoSign`).connect(`lfoSign`,`lfo`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoRndOut`,`lfo`);for(let t of[`lfoPitch`,`lfoPw`,`lfoFilter`,`lfoAmp`])e.connect(`lfo`,t)}addVoice(e,t){let n=e=>`v${t}.${e}`;e.add(n(`pitch`),`constant`,{offset:0,glide:0}).add(n(`det`),`constant`,{offset:0}).add(n(`osc`),`oscillator`,{frequency:440,detune:0},{waveform:`sawtooth`}).add(n(`sub`),`oscillator`,{frequency:440,detune:0},{waveform:`square`}).add(n(`rawOut`),`gain`,{gain:1}).add(n(`pulseSum`),`gain`,{gain:1}).add(n(`shaper`),`waveshaper`,{},{curve:`pulse`}).add(n(`pulseOut`),`gain`,{gain:0}).add(n(`subLevel`),`gain`,{gain:0}).add(n(`mix`),`gain`,{gain:.5}).add(n(`f1`),`filter`,{frequency:2400,Q:1,detune:0},{type:`lowpass`}).add(n(`f2`),`filter`,{frequency:2400,Q:.707,detune:0},{type:`lowpass`}).add(n(`keyFollow`),`gain`,{gain:.5}).add(n(`env1`),`envelope`,{attack:.005,decay:.4,sustain:.4,release:.4,gate:0}).add(n(`env1Depth`),`gain`,{gain:2*Co}).add(n(`env2`),`envelope`,{attack:.005,decay:.3,sustain:.7,release:.35,gate:0}).add(n(`amp`),`gain`,{gain:0}).add(n(`trem`),`gain`,{gain:1}).add(n(`ampKey`),`gain`,{gain:0}).add(n(`out`),`gain`,{gain:jo.poly});for(let t of[`osc`,`sub`])e.connect(n(`pitch`),n(t),`detune`).connect(n(`det`),n(t),`detune`).connect(`bend`,n(t),`detune`).connect(`lfoPitch`,n(t),`detune`);e.connect(`subShift`,n(`sub`),`detune`).connect(n(`osc`),n(`rawOut`)).connect(n(`osc`),n(`pulseSum`)).connect(`pwCv`,n(`pulseSum`)).connect(`lfoPw`,n(`pulseSum`)).connect(n(`pulseSum`),n(`shaper`)).connect(n(`shaper`),n(`pulseOut`)).connect(n(`rawOut`),n(`mix`)).connect(n(`pulseOut`),n(`mix`)).connect(n(`sub`),n(`subLevel`)).connect(n(`subLevel`),n(`mix`)).connect(n(`mix`),n(`f1`)).connect(n(`f1`),n(`f2`)).connect(n(`f2`),n(`amp`)).connect(n(`env1`),n(`env1Depth`)).connect(n(`pitch`),n(`keyFollow`));for(let t of[`f1`,`f2`])e.connect(n(`env1Depth`),n(t),`detune`).connect(n(`keyFollow`),n(t),`detune`).connect(`lfoFilter`,n(t),`detune`);e.connect(n(`env2`),n(`amp`),`gain`).connect(n(`amp`),n(`trem`)).connect(`lfoAmp`,n(`trem`),`gain`).connect(n(`pitch`),n(`ampKey`)).connect(n(`ampKey`),n(`trem`),`gain`).connect(n(`trem`),n(`out`)).connect(n(`out`),`voices`)}addEffects(e){e.add(`chorusDry`,`gain`,{gain:1}).add(`chorusWet`,`gain`,{gain:0}).add(`chDelayA`,`delay`,{delayTime:.016,maxTime:.05}).add(`chDelayB`,`delay`,{delayTime:.024,maxTime:.05}).add(`chLfoA`,`oscillator`,{frequency:.62,detune:0},{waveform:`sine`}).add(`chLfoB`,`oscillator`,{frequency:.83,detune:0},{waveform:`sine`}).add(`chDepthA`,`gain`,{gain:.0025}).add(`chDepthB`,`gain`,{gain:.003}).add(`fxMix`,`gain`,{gain:1}).connect(`voices`,`chorusDry`).connect(`chorusDry`,`fxMix`).connect(`voices`,`chDelayA`).connect(`voices`,`chDelayB`).connect(`chDelayA`,`chorusWet`).connect(`chDelayB`,`chorusWet`).connect(`chorusWet`,`fxMix`).connect(`chLfoA`,`chDepthA`).connect(`chDepthA`,`chDelayA`,`delayTime`).connect(`chLfoB`,`chDepthB`).connect(`chDepthB`,`chDelayB`,`delayTime`),e.add(`dlyLine`,`delay`,{delayTime:.35,maxTime:1.5}).add(`dlyTone`,`filter`,{frequency:4500,Q:.707,detune:0},{type:`lowpass`}).add(`dlyFb`,`gain`,{gain:.3}).add(`dlyWet`,`gain`,{gain:0}).add(`dlySum`,`gain`,{gain:1}).add(`level`,`gain`,{gain:.7}).connect(`fxMix`,`dlySum`).connect(`fxMix`,`dlyLine`).connect(`dlyLine`,`dlyTone`).connect(`dlyTone`,`dlyFb`).connect(`dlyFb`,`dlyLine`).connect(`dlyTone`,`dlyWet`).connect(`dlyWet`,`dlySum`).connect(`dlySum`,`level`)}addControls(e){let t=(e,t,n,r,i,a,o,s)=>this.controlList.push(new y(e,t,n,r,i,a,o,s)),n=e=>t=>this.eachVoice(n=>e(n,t)),r=bo,i=e=>r[e],a=(r,a,o,s,c)=>t(`${r}.${a}`,o,s,c,i(`${r}.${a}`),`s`,n((t,n)=>e.setParam(t(r),a,n)),`log`),o=r=>t(`${r}.sustain`,`Sustain`,0,1,i(`${r}.sustain`),``,n((t,n)=>e.setParam(t(r),`sustain`,n)));this.controlList.push(new b(`osc.wave`,`Wave`,Oo,r[`osc.wave`],t=>this.eachVoice(n=>{e.setOption(n(`osc`),`waveform`,t===`tri`?`triangle`:`sawtooth`),e.setParam(n(`rawOut`),`gain`,t===`pulse`?0:1),e.setParam(n(`pulseOut`),`gain`,t===`pulse`?Mo:0)}))),t(`osc.width`,`Width`,5,50,i(`osc.width`),`%`,t=>e.setParam(`pwCv`,`offset`,1-2*t/100)),t(`osc.pwm`,`LFO PWM`,0,100,i(`osc.pwm`)*100,`%`,t=>e.setParam(`lfoPw`,`gain`,t/100*.9)),t(`osc.vibrato`,`LFO Pitch`,0,100,i(`osc.vibrato`),`ct`,e=>{this.vibratoCents=e,this.applyVibrato()}),t(`osc.sub`,`Sub`,0,1,i(`osc.sub`),``,n((t,n)=>e.setParam(t(`subLevel`),`gain`,n*.6))),t(`filter.cutoff`,`Cutoff`,20,2e4,i(`filter.cutoff`),`Hz`,n((t,n)=>{e.setParam(t(`f1`),`frequency`,n),e.setParam(t(`f2`),`frequency`,n)}),`log`),t(`filter.resonance`,`Resonance`,.1,20,i(`filter.resonance`),``,n((t,n)=>e.setParam(t(`f1`),`Q`,n))),t(`filter.env`,`Env 1`,0,6,i(`filter.env`),`oct`,n((t,n)=>e.setParam(t(`env1Depth`),`gain`,n*Co))),t(`filter.lfo`,`LFO`,0,4,i(`filter.lfo`),`oct`,t=>e.setParam(`lfoFilter`,`gain`,t*Co)),t(`filter.key`,`Key track`,0,100,i(`filter.key`),`%`,n((t,n)=>e.setParam(t(`keyFollow`),`gain`,n/100))),t(`amp.lfo`,`LFO`,0,100,i(`amp.lfo`),`%`,t=>e.setParam(`lfoAmp`,`gain`,t/100*.8)),t(`amp.key`,`Key track`,0,100,i(`amp.key`),`%`,n((t,n)=>e.setParam(t(`ampKey`),`gain`,n/100/6e3))),t(`level`,`Volume`,0,1,i(`level`),``,t=>e.setParam(`level`,`gain`,t)),this.controlList.push(new b(`lfo.wave`,`Wave`,ko,r[`lfo.wave`],t=>{e.setOption(`lfoOsc`,`waveform`,t===`sqr`?`square`:t===`up`||t===`down`?`sawtooth`:`triangle`),e.setParam(`lfoSign`,`gain`,t===`down`?-1:1),e.setParam(`lfoOscOut`,`gain`,t===`rnd`?0:1),e.setParam(`lfoRndOut`,`gain`,+(t===`rnd`))})),t(`lfo.rate`,`Rate`,.1,30,i(`lfo.rate`),`Hz`,e=>{this.lfoHz=e,this.applyLfoRate()},`log`),this.controlList.push(new x(`lfo.sync`,`Sync`,!1,e=>{this.lfoSync=e,this.applyLfoRate()}),new b(`lfo.division`,`Division`,Ao,r[`lfo.division`],e=>{this.lfoDivision=e,this.applyLfoRate()}));for(let e of[`env1`,`env2`])a(e,`attack`,`Attack`,.001,5),a(e,`decay`,`Decay`,.005,5),o(e),a(e,`release`,`Release`,.005,10);this.controlList.push(new b(`voices.mode`,`Mode`,Ha,r[`voices.mode`],e=>this.applyMode(e))),t(`voices.portamento`,`Portamento`,0,2,i(`voices.portamento`),`s`,t=>{this.portamento=t,this.eachVoice(n=>e.setParam(n(`pitch`),`glide`,t))}),t(`voices.detune`,`Detune`,0,50,i(`voices.detune`),`ct`,e=>{this.unisonDetune=e,this.applyDetune()}),t(`fx.chorus`,`Chorus`,0,1,i(`fx.chorus`),``,t=>{e.setParam(`chorusWet`,`gain`,t*.7),e.setParam(`chorusDry`,`gain`,1-t*.25)}),t(`fx.delayTime`,`Delay time`,.01,1,i(`fx.delayTime`),`s`,t=>e.setParam(`dlyLine`,`delayTime`,t),`log`),t(`fx.feedback`,`Feedback`,0,.9,i(`fx.feedback`),``,t=>e.setParam(`dlyFb`,`gain`,t)),t(`fx.mix`,`Delay mix`,0,1,i(`fx.mix`),``,t=>e.setParam(`dlyWet`,`gain`,t))}},Po={"spring.length":2,"spring.tension":.5,"spring.drip":.6,"spring.tilt":0,"spring.dwell":.4,"spring.mix":.25},Fo=1.6,Io=class extends v{name;constructor(e=`Spring`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`spring`,`spring`,{tension:.5,drip:.6,decay:2,tilt:0,dwell:.4}).add(`dry`,`gain`,{gain:1}).add(`wet`,`gain`,{gain:0}).add(`sum`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`spring`).connect(`in`,`dry`).connect(`spring`,`wet`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=(e,t,n,r,i,a,o)=>this.controlList.push(new y(e,t,n,r,Po[e],i,a,o));n(`spring.length`,`Length`,.2,8,`s`,e=>t.setParam(`spring`,`decay`,e),`log`),n(`spring.tension`,`Tension`,0,1,``,e=>t.setParam(`spring`,`tension`,e)),n(`spring.drip`,`Drip`,0,1,``,e=>t.setParam(`spring`,`drip`,e)),n(`spring.tilt`,`Tilt`,-1,1,``,e=>t.setParam(`spring`,`tilt`,e)),n(`spring.dwell`,`Dwell`,0,1,``,e=>t.setParam(`spring`,`dwell`,e)),n(`spring.mix`,`Dry / wet`,0,1,``,e=>{t.setParam(`dry`,`gain`,Math.cos(e*Math.PI/2)),t.setParam(`wet`,`gain`,Math.sin(e*Math.PI/2)*Fo)})}reset(){for(let e of this.controlList)e.kind===`number`&&e.set(e.initial)}},Lo=75,Ro=10,zo=15,Bo=.3,Vo=[`A`,`B`,`C`],Ho=[[1,2],[3,4],[5,6]],Uo=120,Wo=6,Go=1.2,Ko=1.5,qo=class extends v{channelCount;returnCount;returnFeeds;lineCount;name;muted=new Set;soloed=new Set;constructor(e=1,t=`Mixer`,n=0,r={},i=0){super(),this.channelCount=e,this.returnCount=n,this.returnFeeds=r,this.lineCount=i,this.name=t;let a=this.circuit;a.add(`main`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`ceiling`,`waveshaper`,{},{curve:`limit`}).add(`mainMeter`,`meter`,{},{channel:`mono`}).connect(`main`,`limiter`).connect(`limiter`,`ceiling`).connect(`ceiling`,`mainMeter`),this.outputList.push({name:`main`,nodeId:`ceiling`}),a.add(`key`,`gain`,{gain:1}),this.outputList.push({name:`key`,nodeId:`key`}),this.meterList.push({name:`main`,nodeId:`mainMeter`});for(let e of Vo){let t=`bus${e}`;a.add(t,`gain`,{gain:1}).add(`${t}.toMain`,`gain`,{gain:1}).add(`${t}.meterL`,`meter`,{},{channel:`left`}).add(`${t}.meterR`,`meter`,{},{channel:`right`}).connect(t,`${t}.toMain`).connect(`${t}.toMain`,`main`).connect(t,`${t}.meterL`).connect(t,`${t}.meterR`),this.outputList.push({name:t,nodeId:t}),this.meterList.push({name:`${t}.L`,nodeId:`${t}.meterL`},{name:`${t}.R`,nodeId:`${t}.meterR`}),this.controlList.push(new y(`${t}.fader`,`Bus ${e}`,0,1.5,1,``,e=>a.setParam(t,`gain`,e)),new x(`${t}.main`,`To main`,!0,e=>a.setParam(`${t}.toMain`,`gain`,+!!e)))}for(let e=1;e<=6;e++)a.add(`aux${e}`,`gain`,{gain:1}),this.outputList.push({name:`aux${e}`,nodeId:`aux${e}`}),this.controlList.push(new y(`aux${e}.master`,`Aux ${e}`,0,1.5,1,``,t=>a.setParam(`aux${e}`,`gain`,t)));for(let t=1;t<=e;t++)this.addStrip(`ch${t}`,t,`channel`);for(let e=1;e<=n;e++)this.addStrip(`ret${e}`,e,`return`);for(let e=1;e<=i;e++)this.addStrip(`line${e}`,e,`line`);this.controlList.push(new y(`comp.ms`,`Delay comp`,0,Bo*1e3,0,`ms`,t=>{for(let n=1;n<=e;n++)a.setParam(`ch${n}.comp`,`delayTime`,t/1e3);for(let e=1;e<=i;e++)a.setParam(`line${e}.comp`,`delayTime`,t/1e3)}),new b(`key.source`,`Key source`,[`off`,...Array.from({length:e},(e,t)=>`${t+1}`)],`off`,t=>{for(let n=1;n<=e;n++)a.setParam(`ch${n}.keySend`,`gain`,+(t===`${n}`))}))}addStrip(e,t,n){let r=this.circuit,i=n!==`channel`,a=t=>`${e}.${t}`;r.add(a(`lowcut`),`filter`,{frequency:Ro,Q:.707,gain:0},{type:`highpass`}).add(a(`eqLow`),`filter`,{frequency:80,Q:.707,gain:0},{type:`lowshelf`}).add(a(`eqMid`),`filter`,{frequency:2500,Q:1,gain:0},{type:`peaking`}).add(a(`eqHigh`),`filter`,{frequency:12e3,Q:.707,gain:0},{type:`highshelf`}).add(a(`tapePre`),`filter`,{frequency:Uo,Q:.707,gain:0},{type:`lowshelf`}).add(a(`drive`),`gain`,{gain:1/3}).add(a(`sat`),`waveshaper`,{},{curve:`warm`}).add(a(`tapePost`),`filter`,{frequency:Uo,Q:.707,gain:0},{type:`lowshelf`}).add(a(`tapeHf`),`filter`,{frequency:9e3,Q:.707,gain:0},{type:`highshelf`}).add(a(`tapeBump`),`filter`,{frequency:70,Q:1,gain:0},{type:`peaking`}).add(a(`tapeMakeup`),`gain`,{gain:1}).add(a(`mute`),`gain`,{gain:1}).add(a(`fader`),`gain`,{gain:.8}).add(a(`pan`),`pan`,{pan:0}).connect(a(`lowcut`),a(`eqLow`)).connect(a(`eqLow`),a(`eqMid`)).connect(a(`eqMid`),a(`eqHigh`)).connect(a(`eqHigh`),a(`tapePre`)).connect(a(`tapePre`),a(`drive`)).connect(a(`drive`),a(`sat`)).connect(a(`sat`),a(`tapePost`)).connect(a(`tapePost`),a(`tapeHf`)).connect(a(`tapeHf`),a(`tapeBump`)).connect(a(`tapeBump`),a(`tapeMakeup`)).connect(a(`tapeMakeup`),a(`mute`)).connect(a(`mute`),a(`fader`)).connect(a(`fader`),a(`pan`)),i?(r.add(a(`meterL`),`meter`,{},{channel:`left`}).add(a(`meterR`),`meter`,{},{channel:`right`}).connect(a(`pan`),a(`meterL`)).connect(a(`pan`),a(`meterR`)),this.meterList.push({name:`${e}.L`,nodeId:a(`meterL`)},{name:`${e}.R`,nodeId:a(`meterR`)})):(r.add(a(`meter`),`meter`,{},{channel:`mono`}).connect(a(`fader`),a(`meter`)).add(a(`keySend`),`gain`,{gain:0}).connect(a(`mute`),a(`keySend`)).connect(a(`keySend`),`key`),this.meterList.push({name:e,nodeId:a(`meter`)})),this.inputList.push({name:e,nodeId:a(`lowcut`)});let o=Vo.filter(e=>n!==`return`||this.returnFeeds[t]!==e);n!==`return`&&r.add(a(`comp`),`delay`,{delayTime:0,maxTime:Bo}).connect(a(`pan`),a(`comp`));for(let e of o){let t=a(e===`A`&&n!==`return`?`comp`:`pan`);r.add(a(`assign${e}`),`gain`,{gain:0}).connect(t,a(`assign${e}`)).connect(a(`assign${e}`),`bus${e}`)}for(let e=1;e<=6;e++)r.add(a(`aux${e}.pre`),`gain`,{gain:0}).add(a(`aux${e}.post`),`gain`,{gain:1}).add(a(`aux${e}`),`gain`,{gain:0}).connect(a(`mute`),a(`aux${e}.pre`)).connect(a(`fader`),a(`aux${e}.post`)).connect(a(`aux${e}.pre`),a(`aux${e}`)).connect(a(`aux${e}.post`),a(`aux${e}`)).connect(a(`aux${e}`),`aux${e}`);let s=(e,t,n,r,i,o,s,c)=>new y(a(e),t,n,r,i,o,s,c),c=(e,t,n)=>s(e,t,-15,zo,0,`dB`,e=>r.setParam(a(n),`gain`,e));this.controlList.push(new x(a(`lowcutOn`),`Low cut`,!1,e=>r.setParam(a(`lowcut`),`frequency`,e?Lo:Ro)),c(`eqHigh`,`High`,`eqHigh`),c(`eqMid`,`Mid`,`eqMid`),s(`eqMidFreq`,`Freq`,100,8e3,2500,`Hz`,e=>r.setParam(a(`eqMid`),`frequency`,e),`log`),c(`eqLow`,`Low`,`eqLow`),s(`tape`,`Tape`,0,1,0,``,e=>{let t=1/3+e*(Go-1/3);r.setParam(a(`tapePre`),`gain`,Wo*e),r.setParam(a(`tapePost`),`gain`,-6*e),r.setParam(a(`drive`),`gain`,t),r.setParam(a(`tapeMakeup`),`gain`,1/(3*t)),r.setParam(a(`tapeHf`),`gain`,-4*e),r.setParam(a(`tapeBump`),`gain`,Ko*e)}));for(let e=1;e<=6;e++)this.controlList.push(s(`aux${e}`,`${e}`,0,1,0,``,t=>r.setParam(a(`aux${e}`),`gain`,t)));for(let[e,t]of Ho)this.controlList.push(new x(a(`auxPre${e}${t}`),`Pre ${e}-${t}`,!1,n=>{for(let i of[e,t])r.setParam(a(`aux${i}.pre`),`gain`,+!!n),r.setParam(a(`aux${i}.post`),`gain`,+!n)}));this.controlList.push(s(`pan`,i?`Balance`:`Pan`,-1,1,0,``,e=>r.setParam(a(`pan`),`pan`,e))),i?this.controlList.push(new x(a(`mute`),`Mute`,!1,e=>r.setParam(a(`mute`),`gain`,+!e))):this.controlList.push(new x(a(`mute`),`Mute`,!1,e=>this.setFlag(this.muted,t,e)),new x(a(`solo`),`Solo`,!1,e=>this.setFlag(this.soloed,t,e)));for(let e of o)this.controlList.push(new x(a(`bus${e}`),e,e===`A`,t=>r.setParam(a(`assign${e}`),`gain`,+!!t)));this.controlList.push(s(`fader`,`Fader`,0,1.5,.8,``,e=>r.setParam(a(`fader`),`gain`,e)))}get soloActive(){return this.soloed.size>0}setFlag(e,t,n){n?e.add(t):e.delete(t);for(let e=1;e<=this.channelCount;e++){let t=`ch${e}.mute`;if(!this.circuit.nodes.has(t))continue;let n=this.muted.has(e)||this.soloed.size>0&&!this.soloed.has(e);this.circuit.setParam(t,`gain`,+!n)}}},Jo={"osc.range":`8'`,"osc.width":50,"osc.pwSource":`man`,"osc.pwm":0,"osc.mod":0,"osc.sub":`-1`,"mix.saw":.8,"mix.pulse":0,"mix.sub":.55,"mix.noise":.05,"filter.cutoff":800,"filter.resonance":1,"filter.keyFollow":50,"filter.lfo":0,"filter.model":`clean`,"filter.drive":0,"filterEnv.amount":2,"filterEnv.attack":.005,"filterEnv.decay":.3,"filterEnv.sustain":.3,"filterEnv.release":.3,"ampEnv.attack":.005,"ampEnv.decay":.2,"ampEnv.sustain":.7,"ampEnv.release":.3,"lfo.wave":`tri`,"lfo.rate":4.8,"perf.glide":0,"perf.notes":`legato`,accent:0,drive:0,"drive.tilt":0,"drive.even":0,"drive.harmonics":48,level:.5},W=(e,t)=>({name:e,values:t}),Yo=[W(`Init`,{}),W(`Sub Bass`,{"osc.range":`16'`,"mix.saw":.5,"mix.sub":.95,"mix.noise":0,"filter.cutoff":380,"filter.resonance":2,"filter.keyFollow":30,"filterEnv.amount":1.5,"filterEnv.attack":.001,"filterEnv.decay":.25,"filterEnv.sustain":.2,"ampEnv.attack":.002,"ampEnv.decay":.3,"ampEnv.sustain":.85,"ampEnv.release":.12,level:.6}),W(`Acid Squelch`,{"osc.range":`16'`,"mix.saw":1,"mix.sub":.35,"mix.noise":0,"filter.cutoff":220,"filter.resonance":14,"filter.keyFollow":40,"filterEnv.amount":4,"filterEnv.attack":.001,"filterEnv.decay":.18,"filterEnv.sustain":0,"filterEnv.release":.1,"ampEnv.sustain":.9,"ampEnv.release":.08,"perf.glide":.08,accent:.7,level:.45}),W(`Fat Pulse Bass`,{"osc.range":`16'`,"osc.width":30,"mix.saw":0,"mix.pulse":.9,"mix.sub":.5,"mix.noise":0,"filter.cutoff":520,"filter.resonance":3,"filterEnv.amount":2,"filterEnv.decay":.3,"filterEnv.sustain":.2,"ampEnv.sustain":.85,"ampEnv.release":.1}),W(`Wobble Bass`,{"osc.range":`16'`,"mix.saw":.8,"mix.sub":.7,"mix.noise":0,"filter.cutoff":300,"filter.resonance":6,"filter.lfo":2,"filterEnv.amount":.5,"filterEnv.sustain":.5,"lfo.wave":`tri`,"lfo.rate":3,"ampEnv.sustain":1,"ampEnv.release":.12,level:.55}),W(`Funk Pluck`,{"osc.range":`8'`,"osc.width":25,"mix.saw":.3,"mix.pulse":.8,"mix.sub":.3,"mix.noise":0,"filter.cutoff":260,"filter.resonance":5,"filter.keyFollow":60,"filterEnv.amount":3.5,"filterEnv.attack":.001,"filterEnv.decay":.15,"filterEnv.sustain":0,"ampEnv.attack":.001,"ampEnv.decay":.2,"ampEnv.sustain":.3,"ampEnv.release":.1}),W(`Rubber Bass`,{"osc.range":`16'`,"mix.saw":.7,"mix.sub":.8,"mix.noise":0,"filter.cutoff":150,"filter.resonance":8,"filter.keyFollow":25,"filterEnv.amount":3,"filterEnv.attack":.001,"filterEnv.decay":.3,"filterEnv.sustain":.1,"ampEnv.sustain":.8,"ampEnv.release":.1,level:.55}),W(`Saw Lead`,{"mix.saw":1,"mix.sub":.2,"mix.noise":0,"filter.cutoff":3e3,"filter.resonance":3,"filter.keyFollow":70,"filterEnv.amount":1,"perf.glide":.06,"osc.mod":15,"lfo.rate":5.5,"ampEnv.sustain":.9,"ampEnv.release":.25}),W(`Hollow Pulse Lead`,{"osc.width":18,"mix.saw":0,"mix.pulse":1,"mix.sub":0,"mix.noise":0,"filter.cutoff":2500,"filter.resonance":2,"filter.keyFollow":80,"filterEnv.amount":1.5,"filterEnv.attack":.01,"filterEnv.decay":.4,"filterEnv.sustain":.5,"ampEnv.sustain":.8,"ampEnv.release":.2}),W(`PWM Lead`,{"mix.saw":.2,"mix.pulse":.9,"mix.sub":.2,"mix.noise":0,"osc.pwSource":`lfo`,"osc.pwm":70,"lfo.rate":1.2,"filter.cutoff":3e3,"filter.resonance":2,"filter.keyFollow":70,"filterEnv.amount":1,"ampEnv.sustain":.9,"ampEnv.release":.3}),W(`Vibrato Lead`,{"mix.saw":.8,"mix.pulse":.4,"mix.sub":.1,"mix.noise":0,"osc.mod":40,"lfo.rate":5.2,"filter.cutoff":2800,"filter.resonance":3,"filter.keyFollow":70,"filterEnv.amount":1.2,"perf.glide":.1,"ampEnv.attack":.01,"ampEnv.sustain":.9,"ampEnv.release":.3}),W(`Portamento Solo`,{"mix.saw":1,"mix.sub":.3,"mix.noise":0,"perf.glide":.35,"perf.notes":`legato`,"filter.cutoff":2200,"filter.resonance":4,"filterEnv.amount":.8,"filterEnv.sustain":.6,"ampEnv.sustain":1,"ampEnv.release":.2}),W(`Clarinet`,{"osc.width":50,"mix.saw":0,"mix.pulse":1,"mix.sub":0,"mix.noise":.03,"filter.cutoff":1800,"filter.resonance":1,"filter.keyFollow":70,"filterEnv.amount":1,"filterEnv.attack":.04,"filterEnv.sustain":.6,"ampEnv.attack":.04,"ampEnv.sustain":.9,"ampEnv.release":.12,"osc.mod":8,"lfo.rate":5}),W(`Brass`,{"mix.saw":1,"mix.pulse":.4,"mix.sub":.2,"mix.noise":0,"filter.cutoff":500,"filter.resonance":2,"filter.keyFollow":60,"filterEnv.amount":3,"filterEnv.attack":.12,"filterEnv.decay":.3,"filterEnv.sustain":.6,"ampEnv.attack":.08,"ampEnv.decay":.2,"ampEnv.sustain":.85,"ampEnv.release":.2}),W(`Siren`,{"mix.saw":1,"mix.sub":0,"mix.noise":0,"osc.mod":600,"lfo.wave":`tri`,"lfo.rate":.7,"filter.cutoff":4e3,"filter.resonance":2,"filterEnv.amount":0,"ampEnv.sustain":1,"ampEnv.release":.15}),W(`Random SFX`,{"mix.saw":.5,"mix.pulse":.5,"mix.sub":0,"mix.noise":0,"lfo.wave":`rnd`,"lfo.rate":9,"osc.mod":500,"filter.cutoff":1200,"filter.resonance":8,"filter.lfo":2.5,"filterEnv.amount":0,"ampEnv.attack":.01,"ampEnv.sustain":1,"ampEnv.release":.1,level:.45}),W(`Snare`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":1,"filter.cutoff":3e3,"filter.resonance":2,"filter.keyFollow":0,"filterEnv.amount":1,"filterEnv.attack":.001,"filterEnv.decay":.1,"filterEnv.sustain":0,"ampEnv.attack":.001,"ampEnv.decay":.18,"ampEnv.sustain":0,"ampEnv.release":.1,level:.6}),W(`Wind`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":1,"filter.cutoff":500,"filter.resonance":8,"filter.keyFollow":0,"filterEnv.amount":4,"filterEnv.attack":2,"filterEnv.decay":2,"filterEnv.sustain":.5,"filterEnv.release":2,"ampEnv.attack":1.5,"ampEnv.sustain":1,"ampEnv.release":2,level:.5}),W(`Whistle`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":.6,"filter.cutoff":2e3,"filter.resonance":20,"filter.keyFollow":100,"filterEnv.amount":0,"osc.mod":20,"lfo.rate":5,"ampEnv.attack":.05,"ampEnv.sustain":1,"ampEnv.release":.2,level:.35}),W(`Acid Fold`,{"osc.range":`16'`,"mix.saw":1,"mix.sub":.35,"mix.noise":0,"filter.cutoff":380,"filter.resonance":14,"filter.keyFollow":40,"filterEnv.amount":4,"filterEnv.attack":.001,"filterEnv.decay":.18,"filterEnv.sustain":0,"filterEnv.release":.1,"ampEnv.sustain":.9,"ampEnv.release":.08,"perf.glide":.07,"perf.notes":`legato`,accent:.7,drive:.45,"drive.tilt":6,level:.45}),W(`Acid Ladder`,{"osc.range":`16'`,"mix.saw":1,"mix.sub":.35,"mix.noise":0,"filter.model":`ladder`,"filter.drive":.5,"filter.cutoff":300,"filter.resonance":15,"filter.keyFollow":40,"filterEnv.amount":4,"filterEnv.attack":.001,"filterEnv.decay":.18,"filterEnv.sustain":0,"filterEnv.release":.1,"ampEnv.sustain":.9,"ampEnv.release":.08,"perf.glide":.07,"perf.notes":`legato`,accent:.7,level:.45})],Xo=new Map([[70,`filter.cutoff`],[71,`filter.resonance`],[72,`filterEnv.amount`],[73,`filterEnv.decay`],[74,`ampEnv.decay`],[75,`ampEnv.release`],[76,`osc.width`],[77,`osc.pwm`],[78,`mix.pulse`],[79,`mix.sub`],[80,`mix.noise`],[81,`lfo.rate`],[82,`osc.mod`],[83,`perf.glide`]]);function Zo(e,t){let n=Math.min(127,Math.max(0,t))/127;if(e.kind===`number`)e.set(e.curve===`log`?e.min*(e.max/e.min)**+n:e.min+n*(e.max-e.min));else if(e.kind===`choice`){let t=Math.min(e.options.length-1,Math.floor(n*e.options.length));e.set(e.options[t])}else e.set(t>=64)}var Qo=1200,$o=200,es=100,ts=1,ns=440,rs=4.8,is=[`man`,`lfo`,`env`],as=[`legato`,`retrig`],os=[`tri`,`sqr`,`rnd`],ss={"16'":-1200,"8'":0,"4'":1200,"2'":2400},cs={"-1":-1200,"-2":-2400},ls=.6,us=.8,ds=.12,fs=700,ps=1.25,ms=class extends v{name;transport;ccMap=new Map(Xo);held=[];presetListeners=new Set;currentPreset=Yo[0];gateOpen=!1;glideSeconds=0;retrigger=!1;pwSource=`man`;pwmAmount=0;bend=0;modWheelValue=0;oscModCents=0;accentAmount=0;envAmount=2;envDecay=.3;accented=!1;performanceListeners=new Set;noteListeners=new Set;constructor(e=`Synth`,t=new _){super(),this.name=e,this.transport=new Et(t);let n=this.circuit;n.add(`pitch`,`constant`,{offset:0,glide:0}).add(`range`,`constant`,{offset:0}).add(`bend`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:cs[-1]}).add(`pulseWidthCv`,`constant`,{offset:0}).add(`sawOsc`,`oscillator`,{frequency:ns,detune:0},{waveform:`sawtooth`}).add(`pulseOsc`,`oscillator`,{frequency:ns,detune:0},{waveform:`sawtooth`}).add(`pulseSum`,`gain`,{gain:1}).add(`pulseShaper`,`waveshaper`,{},{curve:`pulse`}).add(`subOsc`,`oscillator`,{frequency:ns,detune:0},{waveform:`square`}).add(`noise`,`noise`).add(`mix.saw`,`gain`,{gain:.8}).add(`mix.pulse`,`gain`,{gain:0}).add(`mix.sub`,`gain`,{gain:.55}).add(`mix.noise`,`gain`,{gain:.05}).add(`mix`,`gain`,{gain:.5}).add(`filter1`,`filter`,{frequency:800,Q:1,detune:0},{type:`lowpass`}).add(`filter2`,`filter`,{frequency:800,Q:.707,detune:0},{type:`lowpass`}).add(`ladder`,`ladder`,{cutoff:800,detune:0,res:.2,drive:0}).add(`filterClean`,`gain`,{gain:1}).add(`filterLadder`,`gain`,{gain:0}).add(`filterOut`,`gain`,{gain:1}).add(`keyFollow`,`gain`,{gain:.5}).add(`amp`,`gain`,{gain:0}).add(`accentAmp`,`gain`,{gain:1}).add(`level`,`gain`,{gain:.5}).add(`driveDry`,`gain`,{gain:1}).add(`driveTiltLo`,`filter`,{frequency:fs,Q:.707,gain:0,detune:0},{type:`lowshelf`}).add(`driveTiltHi`,`filter`,{frequency:fs,Q:.707,gain:0,detune:0},{type:`highshelf`}).add(`driveFold`,`fold`,{fold:1,even:0,harmonics:48,pitch:0}).add(`driveWet`,`gain`,{gain:0}).add(`ampEnv`,`envelope`,{attack:.005,decay:.2,sustain:.7,release:.3,gate:0}).add(`filterEnv`,`envelope`,{attack:.005,decay:.3,sustain:.3,release:.3,gate:0}).add(`filterEnvDepth`,`gain`,{gain:2*Qo}).add(`lfoOsc`,`oscillator`,{frequency:rs,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:rs}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`envPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0});for(let e of[`sawOsc`,`pulseOsc`,`subOsc`])n.connect(`pitch`,e,`detune`).connect(`range`,e,`detune`).connect(`bend`,e,`detune`);n.connect(`subShift`,`subOsc`,`detune`).connect(`pulseOsc`,`pulseSum`).connect(`pulseWidthCv`,`pulseSum`).connect(`pulseSum`,`pulseShaper`).connect(`sawOsc`,`mix.saw`).connect(`pulseShaper`,`mix.pulse`).connect(`subOsc`,`mix.sub`).connect(`noise`,`mix.noise`);for(let e of[`mix.saw`,`mix.pulse`,`mix.sub`,`mix.noise`])n.connect(e,`mix`);n.connect(`mix`,`filter1`).connect(`filter1`,`filter2`).connect(`filter2`,`filterClean`).connect(`mix`,`ladder`).connect(`ladder`,`filterLadder`).connect(`filterClean`,`filterOut`).connect(`filterLadder`,`filterOut`).connect(`filterOut`,`driveDry`).connect(`filterOut`,`driveTiltLo`).connect(`driveTiltLo`,`driveTiltHi`).connect(`driveTiltHi`,`driveFold`).connect(`driveFold`,`driveWet`).connect(`pitch`,`driveFold`,`pitch`).connect(`range`,`driveFold`,`pitch`).connect(`bend`,`driveFold`,`pitch`).connect(`driveDry`,`amp`).connect(`driveWet`,`amp`).connect(`amp`,`accentAmp`).connect(`accentAmp`,`level`).connect(`ampEnv`,`amp`,`gain`).connect(`filterEnv`,`filterEnvDepth`).connect(`pitch`,`keyFollow`);for(let e of[`filter1`,`filter2`,`ladder`])n.connect(`filterEnvDepth`,e,`detune`).connect(`keyFollow`,e,`detune`).connect(`lfoFilter`,e,`detune`);for(let e of[`sawOsc`,`pulseOsc`,`subOsc`])n.connect(`lfoPitch`,e,`detune`);n.connect(`lfoOsc`,`lfoOscOut`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoOscOut`,`lfo`).connect(`lfoRndOut`,`lfo`).connect(`lfo`,`lfoPitch`).connect(`lfo`,`lfoPw`).connect(`lfo`,`lfoFilter`).connect(`lfoPw`,`pulseSum`).connect(`filterEnv`,`envPw`).connect(`envPw`,`pulseSum`),this.outputList.push({name:`out`,nodeId:`level`}),this.controlList.push(new b(`osc.range`,`Range`,Object.keys(ss),`8'`,e=>n.setParam(`range`,`offset`,ss[e])),new y(`osc.width`,`Width`,5,50,50,`%`,e=>n.setParam(`pulseWidthCv`,`offset`,1-2*e/100)),new b(`osc.sub`,`Sub`,Object.keys(cs),`-1`,e=>n.setParam(`subShift`,`offset`,cs[e])),gs(n,`saw`,`Saw`,.8),gs(n,`pulse`,`Pulse`,0),gs(n,`sub`,`Sub`,.55),gs(n,`noise`,`Noise`,.05),new y(`filter.cutoff`,`Cutoff`,20,2e4,800,`Hz`,e=>{n.setParam(`filter1`,`frequency`,e),n.setParam(`filter2`,`frequency`,e),n.setParam(`ladder`,`cutoff`,e)},`log`),new y(`filter.resonance`,`Resonance`,.1,20,1,``,e=>{n.setParam(`filter1`,`Q`,e),n.setParam(`ladder`,`res`,Math.sqrt((e-.1)/19.9))}),new b(`filter.model`,`Filter`,[`clean`,`ladder`],`clean`,e=>{n.setParam(`filterClean`,`gain`,+(e===`clean`)),n.setParam(`filterLadder`,`gain`,e===`ladder`?ps:0)}),new y(`filter.drive`,`Filter drive`,0,1,0,``,e=>n.setParam(`ladder`,`drive`,e)),new y(`filter.keyFollow`,`Key`,0,100,50,`%`,e=>n.setParam(`keyFollow`,`gain`,e/100)),new y(`perf.glide`,`Glide`,0,3,0,`s`,e=>{this.glideSeconds=e,n.setParam(`pitch`,`glide`,e)}),new b(`perf.notes`,`Notes`,as,`legato`,e=>{this.retrigger=e===`retrig`}),new b(`lfo.wave`,`Wave`,os,`tri`,e=>{n.setOption(`lfoOsc`,`waveform`,e===`sqr`?`square`:`triangle`),n.setParam(`lfoOscOut`,`gain`,e===`rnd`?0:1),n.setParam(`lfoRndOut`,`gain`,+(e===`rnd`))}),new y(`lfo.rate`,`Rate`,.1,30,rs,`Hz`,e=>{n.setParam(`lfoOsc`,`frequency`,e),n.setParam(`lfoRnd`,`rate`,e)},`log`),new y(`osc.mod`,`Mod`,0,600,0,`ct`,e=>{this.oscModCents=e,this.applyVibrato()}),new b(`osc.pwSource`,`PW src`,is,`man`,e=>{this.pwSource=e,this.applyPwm()}),new y(`osc.pwm`,`PWM`,0,100,0,`%`,e=>{this.pwmAmount=e/100,this.applyPwm()}),new y(`filter.lfo`,`LFO`,0,4,0,`oct`,e=>n.setParam(`lfoFilter`,`gain`,e*Qo)),new y(`level`,`Level`,0,1,.5,``,e=>n.setParam(`level`,`gain`,e)),new y(`filterEnv.amount`,`Amount`,0,6,2,`oct`,e=>{this.envAmount=e,this.applyAccent()}),...hs(n,`filterEnv`,{attack:.005,decay:.3,sustain:.3,release:.3},e=>{this.envDecay=e,this.applyAccent()}),new y(`accent`,`Accent`,0,1,0,``,e=>{this.accentAmount=e,this.applyAccent()}),new y(`drive`,`Drive`,0,1,0,``,e=>{let t=Math.min(1,e*3);n.setParam(`driveDry`,`gain`,1-t*.65),n.setParam(`driveFold`,`fold`,.8+e*9),n.setParam(`driveWet`,`gain`,t*.55)}),new y(`drive.even`,`Even`,0,1,0,``,e=>n.setParam(`driveFold`,`even`,e)),new y(`drive.harmonics`,`Harmonics`,4,128,48,``,e=>n.setParam(`driveFold`,`harmonics`,e),`log`),new y(`drive.tilt`,`Tilt`,-12,12,0,`dB`,e=>{n.setParam(`driveTiltLo`,`gain`,-e),n.setParam(`driveTiltHi`,`gain`,e)}),...hs(n,`ampEnv`,{attack:.005,decay:.2,sustain:.7,release:.3}))}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*$o),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.applyVibrato(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}applyVibrato(){this.circuit.setParam(`lfoPitch`,`gain`,this.oscModCents+this.modWheelValue*es)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}loadPreset(e){let t={...Jo,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}keyDown(e,t=100){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.accented=t>=110,this.applyAccent(),this.noteOn(_s(e)),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e);let t=this.held[this.held.length-1];t===void 0?this.noteOff():this.noteOn(_s(t)),this.notifyNotes()}handleMidi(e){if(!(`channel`in e&&!this.transport.acceptsChannel(e.channel)))switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:{if(e.controller===ts){this.setModWheel(e.value/127);break}let t=this.ccMap.get(e.controller);t&&Zo(this.control(t),e.value);break}case`programChange`:{let t=Yo[e.program];t&&this.loadPreset(t);break}}}applyAccent(){let e=this.accented?this.accentAmount:0,t=this.circuit;t.setParam(`accentAmp`,`gain`,1+e*ls),t.setParam(`filterEnvDepth`,`gain`,this.envAmount*(1+e*us)*Qo),t.setParam(`filterEnv`,`decay`,e>0?Math.min(this.envDecay,ds+(1-e)*this.envDecay):this.envDecay)}applyPwm(){let e=this.pwmAmount*.9;this.circuit.setParam(`lfoPw`,`gain`,this.pwSource===`lfo`?e:0),this.circuit.setParam(`envPw`,`gain`,this.pwSource===`env`?e:0)}noteOn(e){let t=this.gateOpen,n=this.glideSeconds;t||this.circuit.setParam(`pitch`,`glide`,0),this.circuit.setParam(`pitch`,`offset`,Qo*Math.log2(e/ns)),t||this.circuit.setParam(`pitch`,`glide`,n),(!t||this.retrigger)&&(this.circuit.setParam(`ampEnv`,`gate`,1),this.circuit.setParam(`filterEnv`,`gate`,1)),this.gateOpen=!0}noteOff(){this.circuit.setParam(`ampEnv`,`gate`,0),this.circuit.setParam(`filterEnv`,`gate`,0),this.gateOpen=!1}};function hs(e,t,n,r){let i=(r,i,a,o)=>new y(`${t}.${r}`,i,a,o,n[r],`s`,n=>e.setParam(t,r,n),`log`);return[i(`attack`,`Attack`,.001,5),r?new y(`${t}.decay`,`Decay`,.005,5,n.decay,`s`,r,`log`):i(`decay`,`Decay`,.005,5),new y(`${t}.sustain`,`Sustain`,0,1,n.sustain,``,n=>e.setParam(t,`sustain`,n)),i(`release`,`Release`,.005,10)]}function gs(e,t,n,r){return new y(`mix.${t}`,n,0,1,r,``,n=>e.setParam(`mix.${t}`,`gain`,n))}var _s=e=>ns*2**((e-69)/12),vs=class e{devices=new Map;connections=[];output;extraOutputs=[];add(e,t){if(this.devices.has(e))throw Error(`Duplicate device id: ${e}`);return this.devices.set(e,t),this}device(e){let t=this.devices.get(e);if(!t)throw Error(`Unknown device: ${e}`);return t}connect(e,t){if(this.device(e.device).jack(`out`,e.jack),this.device(t.device).jack(`in`,t.jack),this.connections.some(n=>n.to.device===t.device&&n.to.jack===t.jack&&n.from.device===e.device&&n.from.jack===e.jack))throw Error(`Duplicate connection`);return this.connections.push({from:e,to:t}),this}setOutput(e,t){return this.device(e).jack(`out`,t),this.output={device:e,jack:t},this}addOutput(e,t){return this.device(e).jack(`out`,t),this.extraOutputs.push({device:e,jack:t}),this}static reverb(){return new e().add(`reverb`,new zt(`Reverb`)).setOutput(`reverb`,`out`)}static delay(){return new e().add(`delay`,new Bt(`Delay`)).setOutput(`delay`,`out`)}static ouroboros(){return new e().add(`ouroboros`,new fn(`Ouroboros`)).setOutput(`ouroboros`,`out`)}static buscomp(){return new e().add(`buscomp`,new xt(`Bus Comp`)).setOutput(`buscomp`,`out`)}static granular(){return new e().add(`granular`,new Xt(`Granular`)).setOutput(`granular`,`out`)}static poly(t=new _){return new e().add(`poly`,new No(`Poly`,t)).setOutput(`poly`,`out`)}static drums(t=new _){let n=new e().add(`drums`,new Ft(`Drums`,t)).setOutput(`drums`,At[0]);for(let e of At.slice(1))n.addOutput(`drums`,e);return n}static synth(t=new _){return new e().add(`synth`,new ms(`Synth`,t)).setOutput(`synth`,`out`)}static lynch(t=new _){return new e().add(`lynch`,new io(`Lynch`,t)).setOutput(`lynch`,`out`)}static unicorn(t=new _){return new e().add(`uni`,new Da(t)).setOutput(`uni`,`out`)}static mpc(t=new _){return new e().add(`mpc`,new ga(t)).setOutput(`mpc`,`out`)}static bass(){return new e().add(`bass`,new Ir(`MOA-BASS`)).setOutput(`bass`,`out`)}static guitar(){return new e().add(`guitar`,new Kr(`MOA-GUITAR`)).setOutput(`guitar`,`out`)}static kit(){return new e().add(`kit`,new Zi(`MOA-KIT`)).setOutput(`kit`,`out`)}static m2600(){return new e().add(`m2600`,new nr(`MOA-2600`)).setOutput(`m2600`,`out`)}static duo(){return new e().add(`duo`,new Sn(`MOA-DUO`)).setOutput(`duo`,`out`)}static df2(t=new _){return new e().add(`lynch`,new io(`Lynch`,t)).add(`box`,new Pa(`MOA-DF2`)).connect({device:`lynch`,jack:`out`},{device:`box`,jack:`in`}).setOutput(`box`,`out`)}static pipe(t=new _){return new e().add(`pipe`,new yo(`Pipe`,t)).add(`spring`,new Io(`Spring`)).connect({device:`pipe`,jack:`out`},{device:`spring`,jack:`in`}).setOutput(`spring`,`out`)}static mixerRack(){let t=new e().add(`mixer`,new qo(2+At.length,`Mixer`,5,{3:`C`,4:`B`},5)),n=t.device(`mixer`);return n.control(`busC.main`).set(!1),n.control(`busB.main`).set(!1),n.control(`key.source`).set(`3`),t.setOutput(`mixer`,`main`)}static default(t=new _){let n=new e().add(`synth`,new ms(`Synth`,t)).add(`poly`,new No(`Poly`,t)).add(`drums`,new Ft(`Drums`,t));return e.addRack(n).connect({device:`synth`,jack:`out`},{device:`mixer`,jack:`ch1`}).connect({device:`poly`,jack:`out`},{device:`mixer`,jack:`ch2`}),At.forEach((e,t)=>n.connect({device:`drums`,jack:e},{device:`mixer`,jack:`ch${t+3}`})),e.wireRack(n)}static addRack(e,t=0){return e.add(`reverb`,new zt(`Reverb`)).add(`delay`,new Bt(`Delay`)).add(`ouroboros`,new fn(`Ouroboros`)).add(`buscomp`,new xt(`Bus Comp`)).add(`granular`,new Xt(`Granular`)).add(`mixer`,new qo(2+At.length,`Mixer`,5,{3:`C`,4:`B`},t))}static wireRack(e){e.connect({device:`mixer`,jack:`aux1`},{device:`reverb`,jack:`in`}).connect({device:`mixer`,jack:`aux2`},{device:`delay`,jack:`in`}).connect({device:`reverb`,jack:`out`},{device:`mixer`,jack:`ret1`}).connect({device:`delay`,jack:`out`},{device:`mixer`,jack:`ret2`}),e.connect({device:`mixer`,jack:`busC`},{device:`ouroboros`,jack:`in`}).connect({device:`ouroboros`,jack:`out`},{device:`mixer`,jack:`ret3`}),e.connect({device:`mixer`,jack:`busB`},{device:`buscomp`,jack:`in`}).connect({device:`mixer`,jack:`key`},{device:`buscomp`,jack:`key`}).connect({device:`buscomp`,jack:`out`},{device:`mixer`,jack:`ret4`}),e.connect({device:`mixer`,jack:`aux3`},{device:`granular`,jack:`in`}).connect({device:`granular`,jack:`out`},{device:`mixer`,jack:`ret5`});let t=e.device(`mixer`);return t.control(`busC.main`).set(!1),t.control(`busB.main`).set(!1),t.control(`key.source`).set(`3`),e.setOutput(`mixer`,`main`)}},ys=()=>typeof location<`u`&&new URLSearchParams(location.search).has(`embed`),bs=()=>{try{let e=window.frameElement;return!!e&&e.style.visibility===`hidden`}catch{return!1}};function xs(){let e=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=t=>bs()?window.setTimeout(()=>t(performance.now()),250):e(t)}function Ss(){ys()&&(document.body.classList.add(`embed`),xs(),document.addEventListener(`keydown`,e=>{e.key===`Escape`&&window.parent.postMessage({type:Cs},location.origin)}))}var Cs=`moa-close-panel`,ws=`@internal`,Ts=`@none`,Es=`moa.mixerInputs`,Ds=class{host;jacks;storage;storageKey;slots=new Map;listeners=new Set;ready=!1;constructor(e,t,n={},r=Os(),i=Es){this.host=e,this.jacks=t,this.storage=r,this.storageKey=i;let a=ks(r,i);for(let r of t)this.slots.set(r,{selection:a[r]??n[r]??(e.hasInternal(r)?`@internal`:`@none`),internal:!0,status:`idle`})}selection(e){return this.slot(e).selection}status(e){return this.slot(e).status}hasInternal(e){return this.host.hasInternal(e)}portNames(){return[...new Set(this.host.ports().map(e=>e.name))]}setSelection(e,t,n=!0){if(this.slot(e).selection=t,n)try{this.storage?.setItem(this.storageKey,JSON.stringify(Object.fromEntries([...this.slots].map(([e,t])=>[e,t.selection]))))}catch{}this.reconcile()}start(){this.ready=!0,this.reconcile()}reconcile(){for(let[e,t]of this.slots)this.reconcileOne(e,t);for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}reconcileOne(e,t){let n=t.selection===ws;if(!this.ready){t.status=`idle`;return}let r=n||t.selection===`@none`?void 0:this.host.ports().find(e=>e.name===t.selection);r||this.release(t),t.internal!==n&&(this.host.setInternal(e,n),t.internal=n),r?t.portId!==r.id&&t.pending!==r.id&&(this.release(t),t.pending=r.id,t.status=`connecting`,this.host.attach(e,r.id).then(e=>{if(t.pending!==r.id)e();else{t.pending=void 0,t.portId=r.id,t.detach=e,t.status=`live`;for(let e of this.listeners)e()}},()=>{t.pending===r.id&&(t.pending=void 0),t.status=`missing`;for(let e of this.listeners)e()})):t.status=n?`internal`:t.selection===`@none`?`none`:`missing`}release(e){e.detach?.(),e.detach=void 0,e.portId=void 0,e.pending=void 0}slot(e){let t=this.slots.get(e);if(!t)throw Error(`Unknown input: ${e}`);return t}};function Os(){try{return ys()||typeof localStorage>`u`?void 0:localStorage}catch{return}}function ks(e,t){try{let n=JSON.parse(e?.getItem(t)??`{}`);return n&&typeof n==`object`?n:{}}catch{return{}}}var As=`moa.monitor`,js=class{audience;apply;storage;mode=`auto`;listeners=new Set;constructor(e,t,n=Ms()){this.audience=e,this.apply=t,this.storage=n;let r=n?.getItem(As);(r===`on`||r===`off`||r===`auto`)&&(this.mode=r)}get on(){return this.mode===`on`||this.mode===`auto`&&this.audience()===0}setMode(e){this.mode=e;try{this.storage?.setItem(As,e)}catch{}this.update()}update(){this.apply(this.on);for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}};function Ms(){try{return ys()||typeof localStorage>`u`?void 0:localStorage}catch{return}}var Ns=`moa-pcm-send`,Ps=`moa-pcm-recv`,Fs=`
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
    this.active = false; // the main thread switches this on while some tab listens to the port
    this.port.onmessage = (e) => { this.active = !!e.data.active; this.at = 0; };
    this.l = new Float32Array(this.n);
    this.r = new Float32Array(this.n);
    this.at = 0;
  }
  process(inputs) {
    if (!this.active) return true; // nobody is listening: do no work
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

registerProcessor('${Ns}', PcmSend);
registerProcessor('${Ps}', PcmRecv);
`,Is=new WeakSet;async function Ls(e){if(Is.has(e))return;let t=URL.createObjectURL(new Blob([Fs],{type:`text/javascript`}));await e.audioWorklet.addModule(t),Is.add(e)}var Rs=()=>Math.random().toString(36).slice(2,10),zs=class{id=Rs();channel;remote=new Map;listeners=new Set;audienceListeners=new Set;outlets=new Map;sinks=new Map;receiving=new Map;constructor(e=`moa-audio-pcm`,t){let n=t??(typeof BroadcastChannel>`u`?void 0:e=>new BroadcastChannel(e));this.channel=n?.(e),this.channel&&(this.channel.onmessage=e=>this.handle(e.data),this.send({type:`hello`,from:this.id}),typeof window<`u`&&window.addEventListener(`pagehide`,e=>{e.persisted||this.close()}))}get supported(){return this.channel!==void 0&&typeof AudioWorkletNode<`u`}get ports(){return[...this.remote].map(([e,t])=>({id:e,name:t.name}))}get audience(){let e=0;for(let t of this.outlets.values())e+=t.audience.size;return e}openOutlet(e){let t=Rs(),n={name:e,audience:new Set};return this.outlets.set(t,n),this.send({type:`announce`,from:this.id,port:t,name:e}),{id:t,get listened(){return n.audience.size>0},send:(e,r,i)=>{n.audience.size>0&&this.send({type:`pcm`,from:this.id,port:t,rate:i,l:e,r})},close:()=>{this.outlets.delete(t)&&(n.stop?.(),this.send({type:`bye`,from:this.id,port:t}),this.audienceChanged())}}}listen(e,t){return this.sinks.set(e,e=>t(e.rate,e.l,e.r)),this.send({type:`listen`,from:this.id,port:e}),()=>{this.sinks.delete(e)&&this.send({type:`unlisten`,from:this.id,port:e})}}async publish(e,t,n){await Ls(e);let r=new AudioWorkletNode(e,Ns,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:`explicit`}),i=e.createGain();i.gain.value=0,t.connect(r),r.connect(i).connect(e.destination);let a=this.openOutlet(n);return r.port.onmessage=t=>a.send(t.data.l,t.data.r,e.sampleRate),this.outlets.get(a.id).listening=e=>r.port.postMessage({active:e}),this.outlets.get(a.id).stop=()=>{t.disconnect(r),r.disconnect(),i.disconnect(),r.port.onmessage=null},a.close}async subscribe(e,t,n=30){await Ls(e);let r=new AudioWorkletNode(e,Ps,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{targetMs:n,capacityMs:400}}),i={fill:0,underruns:0,drops:0};r.port.onmessage=e=>{i=e.data};let a=this.listen(t,(e,t,n)=>r.port.postMessage({rate:e,l:t,r:n},[t.buffer,n.buffer])),o={node:r,stats:()=>i,close:()=>{a(),r.disconnect(),r.port.onmessage=null,this.receiving.delete(o)}};return this.receiving.set(o,this.remote.get(t)?.name??t),o}receiveStats(){return[...this.receiving].map(([e,t])=>({name:t,stats:e.stats()}))}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}onAudience(e){return this.audienceListeners.add(e),()=>this.audienceListeners.delete(e)}close(){for(let e of[...this.sinks.keys()])this.send({type:`unlisten`,from:this.id,port:e});this.sinks.clear();for(let e of this.outlets.values())e.stop?.();this.outlets.clear(),this.send({type:`bye`,from:this.id}),this.channel?.close()}emit(){for(let e of this.listeners)e()}audienceChanged(){for(let e of this.audienceListeners)e()}send(e){this.channel?.postMessage(e)}handle(e){if(e.from!==this.id)switch(e.type){case`hello`:for(let[e,t]of this.outlets)this.send({type:`announce`,from:this.id,port:e,name:t.name});return;case`announce`:this.remote.set(e.port,{owner:e.from,name:e.name}),this.emit();return;case`bye`:for(let[t,n]of[...this.remote])n.owner===e.from&&(e.port===void 0||e.port===t)&&this.remote.delete(t);if(e.port===void 0){let t=!1;for(let n of this.outlets.values())n.audience.delete(e.from)&&(t=!0,n.audience.size===0&&n.listening?.(!1));t&&this.audienceChanged()}this.emit();return;case`listen`:{let t=this.outlets.get(e.port);if(!t||t.audience.has(e.from))return;t.audience.add(e.from),t.listening?.(!0),this.audienceChanged();return}case`unlisten`:{let t=this.outlets.get(e.port);t?.audience.delete(e.from)&&(t.audience.size===0&&t.listening?.(!1),this.audienceChanged());return}case`pcm`:this.sinks.get(e.port)?.(e);return}}};function Bs(e){let t=e[0];if(t===void 0)return;if(t>=240)switch(t){case 248:return{type:`clock`};case 250:return{type:`start`};case 251:return{type:`continue`};case 252:return{type:`stop`};default:return}let n=t&240,r=(t&15)+1,i=(e[1]??0)&127,a=(e[2]??0)&127;switch(n){case 128:return{type:`noteOff`,channel:r,note:i,velocity:a};case 144:return a===0?{type:`noteOff`,channel:r,note:i,velocity:0}:{type:`noteOn`,channel:r,note:i,velocity:a};case 176:return{type:`cc`,channel:r,controller:i,value:a};case 192:return{type:`programChange`,channel:r,program:i};case 224:return{type:`pitchBend`,channel:r,value:(a<<7|i)/8192-1};default:return}}var Vs=[`C`,`C#`,`D`,`D#`,`E`,`F`,`F#`,`G`,`G#`,`A`,`A#`,`B`];function Hs(e){return`${Vs[e%12]}${Math.floor(e/12)-2}`}function Us(e){switch(e.type){case`noteOn`:case`noteOff`:return`note`;case`cc`:return`cc`;case`clock`:case`start`:case`continue`:case`stop`:return`clock`;default:return`other`}}function Ws(e){switch(e.type){case`noteOn`:return`ch${e.channel}  note on  ${Hs(e.note)}  vel ${e.velocity}`;case`noteOff`:return`ch${e.channel}  note off  ${Hs(e.note)}`;case`cc`:return`ch${e.channel}  cc ${e.controller}  = ${e.value}`;case`pitchBend`:return`ch${e.channel}  bend  ${e.value.toFixed(2)}`;case`programChange`:return`ch${e.channel}  program  ${e.program}`;case`clock`:return`clock`;default:return`clock ${e.type}`}}var Gs=40,Ks=class{lines=[];lastSeen={note:-1/0,cc:-1/0,clock:-1/0,other:-1/0};listeners=new Set;record(e,t){if(this.lastSeen[Us(e)]=t,e.type!==`clock`){this.lines.push({text:Ws(e),kind:Us(e)}),this.lines.length>Gs&&this.lines.shift();for(let e of this.listeners)e()}}clear(){this.lines.length=0;for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}},qs=`moa.midiBus`,Js=()=>performance.timeOrigin+performance.now(),Ys=class{now;later;lead;enabled;onMessage;lastSeen=0;channel;listeners=new Set;constructor(e=`moa-midi`,t=Js,n=(e,t)=>setTimeout(e,t),r,i=0){this.now=t,this.later=n,this.lead=i,this.enabled=Xs();let a=r??(typeof BroadcastChannel>`u`?void 0:e=>new BroadcastChannel(e));this.channel=a?.(e),this.channel&&(this.channel.onmessage=e=>{if(!this.enabled)return;let{at:t,data:n}=e.data;if(!Array.isArray(n)||typeof t!=`number`)return;this.lastSeen=performance.now();let r=t-this.now(),i=()=>this.onMessage?.(Uint8Array.from(n),performance.now()+(this.lead>0?Math.max(0,t-this.now()):0));r-this.lead<=1?i():this.later(i,r-this.lead)})}get supported(){return this.channel!==void 0}send(e,t=this.now()){this.channel?.postMessage({at:t,data:Array.from(e)})}setEnabled(e){this.enabled=e;try{localStorage.setItem(qs,e?`1`:`0`)}catch{}for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}close(){this.channel?.close()}};function Xs(){try{return localStorage.getItem(qs)!==`0`}catch{return!0}}var Zs=[`mixer`,`synth`,`poly`,`drums`,`lynch`,`duo`,`df2`,`pipe`],Qs=[`reverb`,`delay`,`ouroboros`,`buscomp`,`granular`],$s=[`m2600`,`bass`,`bass2`,`guitar`,`guitar2`,`kit`,`mpc`,`unicorn`];[...Zs,...Qs,...$s],[...Qs,...$s];var ec=e=>`moa-control-${e}`,tc=`moa-control-status`,nc=e=>`moa-song-${e}`;function rc(e){return typeof BroadcastChannel>`u`?void 0:new BroadcastChannel(e)}function ic(e,t){let n=rc(ec(e));return n?(n.onmessage=e=>{e.data&&typeof e.data.type==`string`&&t(e.data)},()=>n.close()):()=>{}}function ac(e,t){let n=rc(tc);n?.postMessage({page:e,state:t}),n?.close()}var oc=e=>typeof e==`string`?e===`1`||e===`true`||e===`on`:typeof e==`number`?e!==0:e;function sc(e,t){let n=[];for(let[r,i]of Object.entries(t)){let t=e.devices.get(r);if(!t){n.push(`no device ${r}`);continue}if(i.preset!==void 0){let e=t,a=i.preset;t instanceof ms&&Number.isInteger(a)&&a>=0&&a<Yo.length?t.loadPreset(Yo[a]):typeof e.loadSlot==`function`&&Number.isInteger(a)&&a>=0&&a<(e.slots?.length??0)?e.loadSlot(a):n.push(`${r}: cannot load preset ${a}`)}let a=t.transport;if(i.channel!==void 0)try{if(!a?.channel)throw Error(`no channel setting`);a.channel.set(i.channel)}catch(e){n.push(`${r}: channel ${i.channel}: ${e.message}`)}for(let[e,a]of Object.entries(i.controls??{}))try{let n=t.control(e);if(n.kind===`number`){let e=typeof a==`number`?a:Number(a);if(Number.isNaN(e))throw Error(`not a number`);n.set(e)}else n.kind===`choice`?n.set(String(a)):n.set(oc(a))}catch(t){n.push(`${r}.${e}: ${t.message}`)}}return n}var cc=`moa.midiInput`,lc=`moa.midiOutput`,uc=class{status=typeof navigator<`u`&&`requestMIDIAccess`in navigator?`idle`:`unsupported`;inputs=[];selectedId;outputs=[];selectedOutputId;onMessage;access;listeners=new Set;async connect(){if(this.status!==`unsupported`){try{this.access=await navigator.requestMIDIAccess({sysex:!1})}catch{this.status=`denied`,this.emit();return}this.status=`ready`,this.access.onstatechange=()=>this.refresh(),this.refresh()}}async connectIfPermitted(){if(this.status===`idle`)try{(await navigator.permissions.query({name:`midi`})).state===`granted`&&await this.connect()}catch{}}select(e){if(this.access)for(let e of this.access.inputs.values())e.onmidimessage=null;if(this.selectedId=e,e){let t=this.access?.inputs.get(e);t&&(t.onmidimessage=e=>{e.data&&this.onMessage?.(e.data,e.timeStamp)});try{localStorage.setItem(cc,e)}catch{}}this.emit()}selectOutput(e){this.selectedOutputId=e;try{e?localStorage.setItem(lc,e):localStorage.removeItem(lc)}catch{}this.emit()}send(e,t){let n=this.selectedOutputId?this.access?.outputs.get(this.selectedOutputId):void 0;n&&n.send(e,t===void 0?void 0:t-performance.timeOrigin)}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}refresh(){if(this.inputs=[...this.access?.inputs.values()??[]].map(e=>({id:e.id,name:e.name??e.id})),this.outputs=[...this.access?.outputs.values()??[]].map(e=>({id:e.id,name:e.name??e.id})),this.selectedOutputId&&!this.outputs.some(e=>e.id===this.selectedOutputId)&&(this.selectedOutputId=void 0),!this.selectedOutputId)try{let e=localStorage.getItem(lc);e&&this.outputs.some(t=>t.id===e)&&(this.selectedOutputId=e)}catch{}this.selectedId&&this.inputs.some(e=>e.id===this.selectedId)?this.emit():this.select(this.pickDefault())}pickDefault(){let e=null;try{e=localStorage.getItem(cc)}catch{}return this.inputs.find(t=>t.id===e)?.id??this.inputs.find(e=>/torso|t-?1/i.test(e.name))?.id??(this.inputs.length===1?this.inputs[0]?.id:void 0)}emit(){for(let e of this.listeners)e()}},dc=1e3;function fc(e){let t=e.curve===`log`?Math.log(e.value/e.min)/Math.log(e.max/e.min):(e.value-e.min)/(e.max-e.min);return Math.round(t*dc)}function pc(e,t){let n=t/dc;return e.curve===`log`?e.min*(e.max/e.min)**+n:e.min+n*(e.max-e.min)}function G(e,t,n){let r=document.createElement(e);return t&&(r.className=t),n!==void 0&&(r.textContent=n),r}var mc=[[`auto`,`Auto`],[`on`,`On`],[`off`,`Off`]];function hc(e,t){let n=G(`div`,`midi-block`);n.append(G(`div`,`fader-label`,`Audio bus`));let r=G(`div`,`midi-bus`),i=G(`span`,`led input-led`),a=G(`span`,`bus-listening`);r.append(i,a);let o=G(`div`,`bus-monitor`);o.append(G(`span`,`fader-label`,`Speakers`));let s=mc.map(([e,n])=>{let r=G(`button`,`btn btn-small`,n);return r.type=`button`,r.setAttribute(`aria-label`,`Own speakers: ${n}`),r.addEventListener(`click`,()=>t.setMode(e)),o.append(r),[e,r]}),c=()=>{let n=e.audience;a.textContent=n===0?`Nothing listening`:n===1?`1 listener`:`${n} listeners`,i.classList.toggle(`input-led-live`,n>0);for(let[e,n]of s)n.setAttribute(`aria-pressed`,String(t.mode===e));o.title=t.on?`Playing on this page's speakers`:`This page's speakers are muted`};return e.onAudience(c),t.onChange(c),c(),n.append(r,o),n}var gc={idle:`Start audio to connect`,internal:`Using the instrument on this page`,none:`No input`,connecting:`Connecting`,live:`Receiving audio from another tab`,missing:`That tab is not open`};function _c(e,t,n,r){let i=G(`div`,`mix-input`),a=G(`span`,`led`),o=G(`select`,`patch-select mix-input-select`);o.setAttribute(`aria-label`,`${n} input`);let s=()=>{let n=e.selection(t),s=e.portNames();o.replaceChildren(...e.hasInternal(t)?[new Option(r,ws)]:[],new Option(`None`,Ts));for(let e of s)o.add(new Option(e,e));n!==`@internal`&&n!==`@none`&&!s.includes(n)&&o.add(new Option(`${n} (not open)`,n)),o.value=n;let c=e.status(t);a.className=`led input-led input-led-${c}`,i.title=gc[c]};return o.addEventListener(`change`,()=>e.setSelection(t,o.value)),e.onChange(s),s(),i.append(a,o),i}var vc=150;function yc(e,t,n,r,i){let a=G(`section`,`midi-strip`),o=G(`div`,`midi-block`);o.append(G(`div`,`fader-label`,`Audio`),r);let s=G(`div`,`midi-block`);s.append(G(`div`,`fader-label`,`MIDI input`));let c=G(`div`,`midi-device`);s.append(c);let l=()=>{if(c.replaceChildren(),e.status===`unsupported`)c.append(G(`div`,`midi-message`,`MIDI is not available in this browser. Try Chrome or Edge.`));else if(e.status===`denied`)c.append(G(`div`,`midi-message`,`MIDI access was blocked. Allow it in the site settings, then reload.`));else if(e.status===`idle`){let t=G(`button`,`btn midi-connect`,`Connect MIDI`);t.type=`button`,t.addEventListener(`click`,()=>void e.connect()),c.append(t)}else{let t=G(`select`,`patch-select`);t.setAttribute(`aria-label`,`MIDI input device`),t.add(new Option(e.inputs.length?`No device selected`:`No MIDI devices found`,``));for(let n of e.inputs)t.add(new Option(n.name,n.id));t.value=e.selectedId??``,t.addEventListener(`change`,()=>e.select(t.value||void 0)),c.append(t)}};e.onChange(l),l();let u,d;if(i?.supported){u=G(`div`,`midi-block`),u.append(G(`div`,`fader-label`,`Sequencer bus`));let e=G(`div`,`midi-bus`);d=G(`span`,`led`);let t=G(`button`,`btn btn-small midi-bus-toggle`);t.type=`button`,t.setAttribute(`aria-label`,`Listen to MIDI from the sequencer page in another tab`);let n=()=>{t.textContent=i.enabled?`On`:`Off`,t.setAttribute(`aria-pressed`,String(i.enabled))};t.addEventListener(`click`,()=>i.setEnabled(!i.enabled)),i.onChange(n),n(),e.append(d,t),u.append(e)}let f=G(`div`,`midi-block`);f.append(G(`div`,`fader-label`,`Incoming clock`));let p=G(`div`,`midi-bpm`,`--.-`),m=G(`div`,`midi-badges`),h=G(`span`,`badge`,`No clock`),g=G(`span`,`badge`,`Stopped`);m.append(h,g),f.append(p,m);let ee=G(`div`,`midi-block`);ee.append(G(`div`,`fader-label`,`Activity`));let te=G(`div`,`midi-leds`),ne={note:G(`span`,`led`),cc:G(`span`,`led`),clock:G(`span`,`led`)};for(let[e,t]of[[`note`,`Notes`],[`cc`,`CC`],[`clock`,`Clock`]]){let n=G(`div`,`led-item`);n.append(ne[e],G(`span`,void 0,t)),te.append(n)}ee.append(te);let re=G(`div`,`midi-block midi-monitor-block`),ie=G(`div`,`midi-monitor-head`);ie.append(G(`div`,`fader-label`,`Monitor`));let ae=G(`button`,`btn btn-small midi-clear`,`Clear`);ae.type=`button`,ae.addEventListener(`click`,()=>n.clear()),ie.append(ae);let oe=G(`div`,`midi-log`);oe.setAttribute(`role`,`log`),oe.setAttribute(`aria-label`,`Recent MIDI messages`),re.append(ie,oe);let se=()=>{oe.replaceChildren(...n.lines.slice(-5).map(e=>G(`div`,`midi-line midi-line-${e.kind}`,e.text)))};n.onChange(se),se(),a.append(o,s,...u?[u]:[],f,ee,re);let ce=()=>{let e=performance.now(),r=t.bpm,a=t.isLocked(e);p.textContent=r!==void 0&&a?r.toFixed(1):`--.-`,h.textContent=a?`Clock locked`:`No clock`,h.classList.toggle(`on`,a),g.textContent=t.running?`Running`:`Stopped`,g.classList.toggle(`on`,t.running),i&&d&&d.classList.toggle(`on`,e-i.lastSeen<vc);for(let t of[`note`,`cc`,`clock`])ne[t].classList.toggle(`on`,e-n.lastSeen[t]<vc);requestAnimationFrame(ce)};return requestAnimationFrame(ce),a}var bc=[[`/mixer/`,`The mixer`],[`/synth/`,`MOA-1`],[`/poly/`,`MOA-6`],[`/drums/`,`MOA-DR`],[`/lynch/`,`Lynch 106`],[`/duo/`,`MOA-DUO`],[`/2600/`,`MOA-2600`],[`/bass/`,`MOA-BASS`],[`/guitar/`,`MOA-GUITAR`],[`/kit/`,`MOA-KIT`],[`/mpc/`,`MOA-60`],[`/unicorn/`,`MOA-UNICORN`],[`/df2/`,`MOA-DF2`],[`/pipe/`,`MOA-PIPE`],[`/seq/`,`MOA-SEQ`],[`/reverb/`,`Reverb`],[`/delay/`,`Delay`],[`/ouroboros/`,`Ouroboros`],[`/buscomp/`,`Bus Comp`],[`/granular/`,`Granular`],[`/records/`,`Records`],[`/`,`moaswift.no`]];function xc(e){let t=document.createElement(`nav`);return t.className=`pipe-nav`,t.innerHTML=bc.filter(([t])=>t!==e).map(([e,t])=>`<a href="${e}">${t}</a>`).join(``),t}function Sc(e){let{engine:t,clock:n}=e;Ss();let r=new Ks,i=new uc,a=new zs,o=new js(()=>a.audience,e=>t.setMonitor(e));a.onAudience(()=>o.update());let s=document.querySelector(`#app`),c=e.inputs?.length?new Ds({ports:()=>a.ports,hasInternal:()=>!1,setInternal:()=>{},attach:async(n,r)=>{let i=t.context,o=e.inputs.find(e=>e.jack===n),s=t.jackNode(o.device,`in`,o.jack);if(!i||!s)throw Error(`Audio is not running`);let c=await a.subscribe(i,r,ys()?80:14);if(o.mono){let e=i.createGain();return e.channelCount=1,e.channelCountMode=`explicit`,c.node.connect(e).connect(s),()=>{e.disconnect(),c.close()}}return c.node.connect(s),()=>c.close()}},e.inputs.map(e=>e.jack),Object.fromEntries(e.inputs.map(e=>[e.jack,e.defaultPort])),void 0,`moa.inputs.${e.id}`):void 0;a.onChange(()=>c?.reconcile());let l=!1,u=async()=>{if(l)return;l=!0,await t.start(),o.update();let n=t.context;if(n)for(let r of e.ports){let e=t.jackNode(r.device,`out`,r.jack);e&&await a.publish(n,e,r.name)}c?.start(),d.textContent=`Audio running`,d.disabled=!0,ac(e.id,`started`)},d=document.createElement(`button`);d.className=`start`,d.textContent=`Start audio`,d.addEventListener(`click`,()=>void u());function f(t,i=performance.now()){let a=Bs(t);a&&(n.handle(a,i),r.record(a,i),e.onMidi(a,i))}i.onMessage=(e,t)=>f(e,t),i.connectIfPermitted();let p=new Ys(void 0,void 0,void 0,void 0,e.midiLeadMs);if(p.onMessage=(e,t)=>f(e,t),new URLSearchParams(location.search).has(`embed`)){let t=new Ys(nc(e.id),void 0,void 0,void 0,e.midiLeadMs);t.enabled=!0,t.onMessage=(e,t)=>f(e,t),ic(e.id,t=>{t.type===`start`?u():t.settings&&sc(e.patch,t.settings)}),ac(e.id,`loaded`)}let m=yc(i,n,r,d,p);if(c&&e.inputs){let t=G(`div`,`midi-block`);t.append(G(`div`,`fader-label`,e.inputs.length>1?`Inputs`:`Input`));for(let n of e.inputs)t.append(_c(c,n.jack,n.label,`None`));m.append(t)}m.append(hc(a,o));let h=Array.isArray(e.panel)?e.panel:[e.panel];return e.bare?s.append(...h):s.append(xc(e.self),m,...h),{handleMidiBytes:f,pcm:a,power:async e=>{e?l?await t.start():await u():await t.stop()},midi:i}}var Cc=.04;function wc(e){let t=G(`div`,`wheel`);t.append(G(`div`,`wheel-label`,e.label));let n=G(`div`,`wheel-body`),r=G(`div`,`wheel-scale`);r.setAttribute(`aria-hidden`,`true`);for(let t of e.scale)r.append(G(`span`,void 0,t));let i=G(`button`,`wheel-face`);i.type=`button`,i.setAttribute(`role`,`slider`),i.setAttribute(`aria-label`,e.ariaLabel),i.setAttribute(`aria-orientation`,`vertical`),i.setAttribute(`aria-valuemin`,e.bipolar?`-1`:`0`),i.setAttribute(`aria-valuemax`,`1`),i.append(G(`span`,`wheel-ribs`)),e.bipolar&&i.append(G(`span`,`wheel-detent wheel-detent-left`),G(`span`,`wheel-detent wheel-detent-right`));let a=G(`div`,`wheel-marker`);a.setAttribute(`aria-hidden`,`true`);let o=G(`div`,`wheel-readout`),s=t=>e.bipolar?(t+1)/2:t,c=()=>{let t=e.get(),n=s(t);i.style.setProperty(`--rib`,`${Math.round(t*-60)}px`),a.style.top=`${Math.round((1-n)*102)}px`,o.textContent=e.format(t),i.setAttribute(`aria-valuenow`,String(t)),i.setAttribute(`aria-valuetext`,e.format(t))},l=t=>{let n=Math.min((e.bipolar,1),Math.max(e.bipolar?-1:0,t));e.set(e.bipolar&&Math.abs(n)<Cc?0:n),c()},u=t=>{let n=i.getBoundingClientRect(),r=Math.min(1,Math.max(0,1-(t.clientY-n.top)/n.height));l(e.bipolar?r*2-1:r)},d=!1;i.addEventListener(`pointerdown`,e=>{i.setPointerCapture(e.pointerId),d=!0,u(e)}),i.addEventListener(`pointermove`,e=>{d&&u(e)});let f=()=>{d=!1,e.springBack&&l(0)};i.addEventListener(`pointerup`,f),i.addEventListener(`pointercancel`,f),i.addEventListener(`keydown`,t=>{let n=t.key===`ArrowUp`||t.key===`ArrowRight`?1:t.key===`ArrowDown`||t.key===`ArrowLeft`?-1:0;n&&(t.preventDefault(),l(e.get()+n*e.keyStep))}),i.addEventListener(`keyup`,()=>{e.springBack&&l(0)}),i.addEventListener(`dblclick`,()=>l(0)),e.subscribe(c),c();let p=G(`div`,`wheel-markers`);return p.append(a),n.append(r,i,p),t.append(n,o),t}var Tc=36,Ec=49,Dc=[`a`,`w`,`s`,`e`,`d`,`f`,`t`,`g`,`y`,`h`,`u`,`j`,`k`],Oc=24,kc=[`C`,`C#`,`D`,`D#`,`E`,`F`,`F#`,`G`,`G#`,`A`,`A#`,`B`],Ac=[!0,!1,!0,!1,!0,!0,!1,!0,!1,!0,!1,!0],jc=Ac.reduce((e,t,n)=>e+ +!!t,0)*4+1,Mc=100/jc*.6,Nc=2,Pc,Fc=e=>`${kc[e%12]}${Math.floor(e/12)-1}`,Ic=(e,t=2)=>{let n=Math.round(e*t*100)/100;return`${n>0?`+`:``}${n.toFixed(2)} st`};function Lc(e,t){let n=G(`div`,`keybed`);Pc??=n,document.addEventListener(`pointerdown`,e=>{n.parentElement?.contains(e.target)&&(Pc=n)},!0);let r=G(`div`,`keybed-cheek`),i=G(`div`,`keybed-wheels`);i.append(wc({label:`Bend`,ariaLabel:`Pitch bend`,bipolar:!0,scale:[`+${e.bendRange??2}`,`0`,`-${e.bendRange??2}`],springBack:!0,keyStep:.125,get:()=>e.pitchBend,set:t=>e.setPitchBend(t),subscribe:t=>e.onPerformanceChange(t),format:t=>Ic(t,e.bendRange??2)}),wc({label:`Mod`,ariaLabel:`Modulation, LFO vibrato depth`,bipolar:!1,scale:[`100`,`0`],springBack:!1,keyStep:.1,get:()=>e.modWheel,set:t=>e.setModWheel(t),subscribe:t=>e.onPerformanceChange(t),format:e=>`${Math.round(e*100)} %`}));let a=0,o=G(`div`,`keybed-octave`),s=G(`button`,`btn btn-small`,`<`);s.type=`button`,s.setAttribute(`aria-label`,`Octave down`);let c=G(`button`,`btn btn-small`,`>`);c.type=`button`,c.setAttribute(`aria-label`,`Octave up`);let l=G(`span`,`keybed-octave-text`,`Oct 0`);o.append(s,l,c),r.append(i,o);let u=G(`div`,`keybed-keys`),d=G(`div`,`keybed-whites`);u.append(d);let f=[],p=new Map,m=0,h=t=>{if(p.has(t))return;let n=Tc+t+a*12;p.set(t,n),e.keyDown(n)},g=t=>{let n=p.get(t);n!==void 0&&(p.delete(t),e.keyUp(n))};for(let e=0;e<Ec;e++){let t=Ac[e%12],n=G(`button`,t?`key-white`:`key-black`);n.type=`button`,n.setAttribute(`aria-label`,`Key ${Fc(Tc+e)}`);let r=Dc[e-Oc];r&&(n.textContent=r),t?(d.append(n),m++):(n.style.left=`${Math.round((m/jc*100-Mc/2)*1e3)/1e3}%`,n.style.width=`${Mc}%`,u.append(n)),n.addEventListener(`pointerdown`,t=>{t.preventDefault(),h(e)});for(let t of[`pointerup`,`pointerleave`,`pointercancel`])n.addEventListener(t,()=>g(e));n.addEventListener(`keydown`,t=>{(t.key===` `||t.key===`Enter`)&&!t.repeat&&(t.preventDefault(),h(e))}),n.addEventListener(`keyup`,()=>g(e)),f.push(n)}let ee=()=>{let t=new Set(e.heldNotes),n=new Set(p.values());f.forEach((e,r)=>{let i=p.has(r)||t.has(Tc+r)&&!n.has(Tc+r);e.classList.toggle(`on`,i),e.setAttribute(`aria-pressed`,String(i))})};e.onNoteChange(ee);let te=()=>{l.textContent=`Oct ${a>0?`+`:``}${a}`,s.disabled=a<=-2,c.disabled=a>=Nc,ee()};return s.addEventListener(`click`,()=>{a=Math.max(-2,a-1),te()}),c.addEventListener(`click`,()=>{a=Math.min(Nc,a+1),te()}),te(),window.addEventListener(`keydown`,e=>{if(Pc!==n||e.repeat||e.metaKey||e.ctrlKey||e.altKey||e.target instanceof HTMLSelectElement)return;let t=Dc.indexOf(e.key.toLowerCase());t>=0&&h(Oc+t)}),window.addEventListener(`keyup`,e=>{let t=Dc.indexOf(e.key.toLowerCase());t>=0&&g(Oc+t)}),n.append(t??r,u),n}var Rc=[`#e8402e`,`#f2c230`,`#2f7fd8`,`#3fae5a`,`#f08a2c`,`#e9e9e4`,`#9b59d0`,`#1c1c1e`];function zc(e){let t=0;for(let n of`${e.from}>${e.to}`)t=t*31+n.charCodeAt(0)>>>0;return Rc[t%Rc.length]}function Bc(e,t,n,r){let i=Math.min(140,22+Math.hypot(n-e,r-t)*.32);return`M${e} ${t} C${e} ${t+i} ${n} ${r+i} ${n} ${r}`}function Vc(e,t,n,r,i,a=!1){let o=Bc(e,t,n,r),s=(e,t)=>`<circle cx="${e}" cy="${t}" r="7" fill="${i}" stroke="#111" stroke-width="2"/><circle cx="${e}" cy="${t}" r="2.6" fill="#111" opacity="0.55"/>`;return`<g class="m26-cable${a?` m26-cable-live`:``}">
    <path d="${o}" stroke="rgba(0,0,0,0.45)" stroke-width="7.5" fill="none" stroke-linecap="round" transform="translate(1.5 3)"/>
    <path d="${o}" stroke="#111" stroke-width="6.5" fill="none" stroke-linecap="round"/>
    <path d="${o}" stroke="${i}" stroke-width="4.5" fill="none" stroke-linecap="round"/>
    ${s(e,t)}${a?``:s(n,r)}
  </g>`}function Hc(e,t,n,r,i,a){let o=document.createElementNS(`http://www.w3.org/2000/svg`,`svg`);o.setAttribute(`class`,`m26-cables`),o.setAttribute(`viewBox`,`0 0 ${r} ${i}`),o.setAttribute(`aria-hidden`,`true`),e.append(o);let s,c,l=()=>{let e=``;for(let r of t.cords){let t=n.get(r.from),i=n.get(r.to);t&&i&&(e+=Vc(t.x,t.y,i.x,i.y,zc(r)))}let r=s?n.get(s):void 0;r&&c&&(e+=Vc(r.x,r.y,c.x,c.y,`#f4f4f0`,!0)),o.innerHTML=e;let i=new Set(t.cords.flatMap(e=>[e.from,e.to]));for(let[e,t]of n)t.el.classList.toggle(`m26-plugged`,i.has(e)),t.el.classList.toggle(`m26-anchor`,e===s),t.el.classList.toggle(`m26-target`,!!s&&e!==s&&!!An(s,e))};t.onCordsChange(l);let u=e=>{s=e,a(`Patching from ${T(e)}: drop or click on a jack (Esc cancels)`),l()},d=()=>{s=void 0,c=void 0,l()},f=e=>{let n=s;s=void 0,c=void 0,t.connect(n,e)?a(`Patched ${T(n)} → ${T(e)}`):a(`${T(n)} and ${T(e)} can't be joined (an output goes to an input or a MULT)`),l()},p=e=>kn(e)===`out`?void 0:t.cords.find(t=>t.from===e||t.to===e),m=t=>{let n=e.getBoundingClientRect();return{x:(t.clientX-n.left)/n.width*r,y:(t.clientY-n.top)/n.height*i}},h=e=>(document.elementFromPoint(e.clientX,e.clientY)?.closest(`[data-jack]`))?.dataset.jack;for(let[e,r]of n){let n=r.el,i;n.addEventListener(`pointerdown`,r=>{if(r.button!==0)return;r.preventDefault(),n.setPointerCapture(r.pointerId);let a=s?void 0:p(e);i={x:r.clientX,y:r.clientY,picked:a},a&&(t.setCords(t.cords.filter(e=>e!==a)),u(a.from===e?a.to:a.from),c=m(r),l())}),n.addEventListener(`pointermove`,t=>{i&&n.hasPointerCapture(t.pointerId)&&(!s&&Math.hypot(t.clientX-i.x,t.clientY-i.y)>5&&u(e),s&&(c=m(t),l()))}),n.addEventListener(`pointerup`,n=>{if(!i)return;let{picked:r}=i,o=Math.hypot(n.clientX-i.x,n.clientY-i.y)>5;if(i=void 0,o){let e=h(n);e&&e!==s?f(e):(r&&a(`Pulled out ${T(r.from)} → ${T(r.to)}`),d())}else r&&(t.setCords([...t.cords,r]),s=void 0),c=void 0,s?s===e?d():f(e):u(e)}),n.addEventListener(`pointercancel`,()=>{i=void 0,d()}),n.addEventListener(`dblclick`,()=>{t.unplug(e),d(),a(`Pulled every cord out of ${T(e)}`)}),n.addEventListener(`keydown`,n=>{n.key===`Enter`||n.key===` `?(n.preventDefault(),s?s===e?d():f(e):u(e)):(n.key===`Delete`||n.key===`Backspace`)&&(n.preventDefault(),t.unplug(e),a(`Pulled every cord out of ${T(e)}`))})}document.addEventListener(`keydown`,e=>{e.key===`Escape`&&s&&d()}),e.addEventListener(`pointermove`,e=>{s&&(c=m(e),l())}),e.addEventListener(`pointerdown`,e=>{s&&!e.target.closest(`[data-jack]`)&&d()}),l()}function K(e,t,n,r,i){let a=G(`button`,`sq-chip`,n);a.type=`button`,a.setAttribute(`aria-label`,r);let o=()=>{a.classList.toggle(`on`,e.value===t),a.setAttribute(`aria-pressed`,String(e.value===t))};return a.addEventListener(`click`,()=>{e.set(t),i.show(`SQ16 · ${e.label}: ${n}`)}),e.onChange(o),o(),a}function Uc(e,t,n){let r=G(`button`,`sq-gate`);r.type=`button`;let i=()=>{r.textContent=e.value===`off`?`·`:e.value,r.dataset.bus=e.value,r.setAttribute(`aria-label`,`Step ${t} gate: ${e.value===`off`?`off`:`bus ${e.value}`}`)};return r.addEventListener(`click`,()=>{e.set(e.options[(e.options.indexOf(e.value)+1)%e.options.length]),n.show(`SQ16 · Step ${t} gate: ${e.value===`off`?`OFF`:`BUS ${e.value}`}`)}),e.onChange(i),i(),r}function Wc(e,t,n,r=``){let i=G(`button`,`sq-push ${r}`.trim(),e);return i.type=`button`,i.setAttribute(`aria-label`,t),i.addEventListener(`click`,n),i}function Gc(e){let t=G(`div`,`m26-readout sq-display`),n=X(e,`sq.rate`),r=Z(e,`sq.sync`),i=Z(e,`sq.div`),a=()=>{t.textContent=r.value===`midi`?`MIDI CLOCK · ${i.value} STEPS`:`${sl(n)} · ${Math.round(n.value*15)} BPM`};for(let e of[n,r,i])e.onChange(a);return a(),t}function Kc(e,t,n,r,i){let a=e=>i+e,o=Z(t,`sq.mode`);e.draw(`<rect x="4" y="${a(6)}" width="22" height="288" rx="5" class="sq-wood"/><rect x="${q-26}" y="${a(6)}" width="22" height="288" rx="5" class="sq-wood"/>`),e.draw(`<rect x="26" y="${a(10)}" width="${q-52}" height="280" rx="4" class="sq-face"/>`),e.draw(`<g class="sq-ink">`),e.draw(`<rect x="36" y="${a(18)}" width="${q-72}" height="264" rx="6" fill="none" stroke-width="1.4"/>`),e.text(52,a(48),`MOA-SQ16`,26,`start`,`class="m26-logo"`),e.text(176,a(47),`SEQUENCER`,13,`start`,`letter-spacing="3"`);for(let t of[790,920,1150])e.line(t,a(26),t,a(274),1.3);e.text(300,a(32),`CLOCK`,7,`middle`);let s=Z(t,`sq.sync`);e.place(K(s,`int`,`INT`,`Clock source: internal`,n),286,a(45),30,15),e.place(K(s,`midi`,`MIDI`,`Clock source: MIDI clock`,n),318,a(45),32,15),e.text(420,a(32),`MIDI DIVISION`,7,`middle`);let c=Z(t,`sq.div`);c.options.forEach((t,r)=>e.place(K(c,t,t,`MIDI division ${t}`,n),364+r*28,a(45),26,15)),e.place(Gc(t),620,a(45),200,18);let l=a(64);e.text(60,l+3,`GATE`,6.5,`start`);for(let i=0;i<16;i++){let s=i<8?92+i*42:448+(i-8)*42;e.place(Uc(Z(t,`sq.gate.${i+1}`),i+1,n),s,a(72),24,16),e.text(s,a(98),String(i+1),9,`middle`,`font-weight="700"`),e.vslider(X(t,`sq.step.${i+1}`),`SQ16`,s,a(106),a(214),n);let c=G(`button`,`sq-lamp`);c.type=`button`,c.setAttribute(`aria-label`,`Jump to step ${i+1}`),c.addEventListener(`click`,()=>{t.jumpTo(o.value===`8x2`?i%8:i),n.show(`SQ16 · jumped to step ${i+1}`)}),c.append(ml()),e.place(c,s,a(232),14),r.add(c.firstElementChild,e=>{let t=e.sq?.step;return t!==void 0&&(t===i||o.value===`8x2`&&t+8===i)})}e.path(`M80 ${a(246)} H405 M400 ${a(242)} L406 ${a(246)} L400 ${a(250)}`),e.text(416,a(249),`A`,9,`middle`,`font-weight="700"`),e.path(`M436 ${a(246)} H761 M756 ${a(242)} L762 ${a(246)} L756 ${a(250)}`),e.text(772,a(249),`B`,9,`middle`,`font-weight="700"`),e.text(110,a(264),`STEPS`,7,`middle`),e.place(K(o,`16`,`16 × 1`,`16 steps`,n),150,a(266),40,15),e.place(K(o,`8x2`,`8 × 2`,`8 steps on A and B together`,n),194,a(266),40,15),e.text(300,a(264),`DIRECTION`,7,`middle`);let u=Z(t,`sq.dir`);[[`fwd`,`FWD`,`forward`],[`rev`,`REV`,`reverse`],[`pingpong`,`P-P`,`ping-pong`],[`random`,`RND`,`random`]].forEach(([t,r,i],o)=>e.place(K(u,t,r,`Direction: ${i}`,n),350+o*36,a(266),33,15)),e.text(560,a(264),`START/STOP IN`,7,`middle`);let d=Z(t,`sq.trig`);e.place(K(d,`trig`,`TRIG`,`Start/stop input toggles on each trigger`,n),620,a(266),34,15),e.place(K(d,`gate`,`GATE`,`Start/stop input runs while high`,n),656,a(266),34,15),[[`sq.bus1`,`BUS 1`,812],[`sq.bus2`,`BUS 2`,846],[`sq.bus3`,`BUS 3`,880]].forEach(([t,n,r])=>e.outJack(t,r,a(56),n)),e.outJack(`sq.pos1`,950,a(56),`POS 1`),e.outJack(`sq.cgate1`,990,a(56),`CLK GATE 1`),e.text(820,a(90),`STEP`,7.5,`middle`),e.place(Wc(``,`Step the sequencer once`,()=>{t.sequencer(`step`),n.show(`SQ16 · step`)}),820,a(112),30,26),e.jack(`sq.stepin`,820,a(146),`Input: step`),e.text(880,a(96),`BUS 3`,7,`middle`),e.text(880,a(110),`SKIP`,6.5,`middle`),e.place($(Q(Z(t,`sq.skip`),`Bus 3 steps: skip, off or reset`),n),880,a(132),14,30),e.text(894,a(135),`OFF`,6.5,`start`),e.text(880,a(158),`RESET`,6.5,`middle`),e.text(820,a(178),`RESET`,7.5,`middle`),e.place(Wc(``,`Reset: the next clock plays step 1`,()=>{t.sequencer(`reset`),n.show(`SQ16 · reset`)}),820,a(200),30,26),e.jack(`sq.resetin`,820,a(234),`Input: reset`),e.text(950,a(96),`START`,7,`middle`),e.jack(`sq.start`,950,a(114),`Input: start`);let f=Wc(`RUN`,`Run or stop the sequencer`,()=>t.sequencer(`toggle`),`sq-run`),p=ml(`sq-run-led`);f.prepend(p),e.place(f,985,a(160),52,40),r.add(p,e=>e.sq?.running===!0),e.text(950,a(208),`STOP`,7,`middle`),e.jack(`sq.stop`,950,a(226),`Input: stop`),e.text(992,a(208),`START/STOP`,7,`middle`),e.jack(`sq.startstop`,992,a(226),`Input: start/stop`),[[`sq.rate`,`CLOCK
FREQ`,1040],[`sq.fm`,`FM`,1080],[`sq.pw`,`PULSE
WIDTH`,1120]].forEach(([r,i,o])=>{e.lines(o,a(90),i,7),e.vslider(X(t,r),`SQ16 clock`,o,a(108),a(204),n)}),e.jack(`sq.extclk`,1040,a(226),`Input: external clock`),e.text(1040,a(248),`CLK IN`,6.5,`middle`),e.jack(`sq.fmin`,1080,a(226),`Input: clock FM`),e.text(1080,a(248),`CLOCK FM`,6.5,`middle`),e.jack(`sq.pwm`,1120,a(226),`Input: pulse width modulation`),e.text(1120,a(248),`PWM`,6.5,`middle`);let m=e.place(ml(),1060,a(56),8);r.add(m,e=>e.sq?.clk===!0),e.outJack(`sq.clk`,1100,a(56),`CLOCK OUT`),e.outJack(`sq.qa`,1180,a(56),`QUANT A`),e.jack(`sq.cvin`,1250,a(56),`Input: CV, added to both quantizers (patch KYBD CV here to transpose)`),e.text(1250,a(41),`CV IN`,7.5,`middle`),e.outJack(`sq.qb`,1320,a(56),`QUANT B`),e.path(`M1250 ${a(67)} V${a(78)} M1180 ${a(78)} H1320 M1180 ${a(78)} V${a(67)} M1320 ${a(78)} V${a(67)}`),e.box(1158,a(88),44,22,`QUANT
A`,7),e.box(1298,a(88),44,22,`QUANT
B`,7),e.text(1180,a(128),`INPUT A`,6.5,`middle`),e.jack(`sq.ina`,1180,a(144),`Input: quantizer A (normalled to output A)`),e.text(1320,a(128),`INPUT B`,6.5,`middle`),e.jack(`sq.inb`,1320,a(144),`Input: quantizer B (normalled to output B)`),e.outJack(`sq.a`,1180,a(188),`SEQ OUT A`),e.outJack(`sq.b`,1320,a(188),`SEQ OUT B`),e.path(`M1180 ${a(110)} V${a(133)} M1320 ${a(110)} V${a(133)} M1180 ${a(155)} V${a(170)} M1320 ${a(155)} V${a(170)}`),e.text(1250,a(96),`SCALE`,7,`middle`);let h=Z(t,`sq.scale`);[[`chrom`,`CHR`],[`major`,`MAJ`],[`minor`,`MIN`],[`pent`,`PEN`],[`dorian`,`DOR`],[`blues`,`BLU`]].forEach(([t,r],i)=>e.place(K(h,t,r,`Quantizer scale: ${t}`,n),1232+i%2*36,a(110+Math.floor(i/2)*18),33,15)),e.text(1250,a(170),`RANGE (OCT)`,6.5,`middle`);let g=Z(t,`sq.range`);g.options.forEach((t,r)=>e.place(K(g,t,t,`Quantizer range: ${t} octaves`,n),1222+r*28,a(184),26,15)),e.text(1250,a(216),`MULT`,7.5,`middle`),[1190,1230,1270,1310].forEach((t,n)=>{e.jack(`sq.mult.${n+1}`,t,a(236),`Mult`),n&&e.line(t-29,a(236),t-11,a(236))}),e.draw(`</g>`)}function qc(e){let t=G(`section`,`m26-card`);t.append(G(`h2`,`m26-card-title`,`MOA-SQ16 SEQUENCER`));let n=G(`div`,`m26-patch-row`);return n.append(Wc(`RUN / STOP`,`Run or stop the sequencer`,()=>e.sequencer(`toggle`),`sq-mobile-btn`),Wc(`STEP`,`Step once`,()=>e.sequencer(`step`),`sq-mobile-btn`),Wc(`RESET`,`Reset to step 1`,()=>e.sequencer(`reset`),`sq-mobile-btn`)),t.append(n,G(`p`,`m26-cord-note`,`Patch its outputs into the 2600 in the Patch cords card, e.g. SQ16 · clocked gate 1 → ADSR · GATE IN.`)),[t,wl(e,`SQ16 CLOCK & MODES`,[`sq.sync`,`sq.div`,`sq.rate`,`sq.fm`,`sq.pw`,`sq.mode`,`sq.dir`,`sq.skip`,`sq.trig`,`sq.scale`,`sq.range`]),wl(e,`SQ16 STEPS`,Array.from({length:16},(e,t)=>[`sq.step.${t+1}`,`sq.gate.${t+1}`]).flat())]}function Jc(e){try{let t=window.localStorage.getItem(e);return t?JSON.parse(t):{}}catch{return{}}}var Yc=(e,t)=>typeof e==`object`&&!!e&&Object.entries(e).every(([e,n])=>t.has(e)&&(typeof n==`number`||typeof n==`string`));function Xc(e,t){if(ys())return;let n=new Set(t.controls.map(e=>e.id));for(let[r,i]of Object.entries(Jc(e))){let e=Number(r);Number.isInteger(e)&&e>=0&&e<t.slots.length&&typeof i?.name==`string`&&Yc(i.values,n)&&(t.slots[e]=i)}}function Zc(e,t,n){try{window.localStorage.setItem(e,JSON.stringify({...Jc(e),[t]:n}))}catch{}}var Qc=`moa-2600.patches`,$c=e=>Xc(Qc,{controls:[...e.controls,...[E,...Gn].map(e=>({id:e}))],slots:e.slots}),el=(e,t)=>Zc(Qc,e,t),q=1380,tl=1225,nl=50,rl=640,J=[48,92,140],il=305,al=445,Y=492,X=(e,t)=>{let n=e.control(t);if(n.kind!==`number`)throw Error(`${t} is not a number control`);return n},Z=(e,t)=>{let n=e.control(t);if(n.kind!==`choice`)throw Error(`${t} is not a choice control`);return n},ol=(e,t)=>{let n=e.control(t);if(n.kind!==`toggle`)throw Error(`${t} is not a toggle control`);return n};function sl(e){let t=e.value;return e.unit===`Hz`&&t>=1e3?`${(t/1e3).toFixed(2)} kHz`:`${Math.abs(t)>=100?t.toFixed(0):Math.abs(t)>=10?t.toFixed(1):t.toFixed(2)}${e.unit?` `+e.unit:``}`}var cl=e=>e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`),ll=class{el=G(`div`,`m26-readout`);constructor(){this.el.setAttribute(`aria-live`,`polite`),this.el.textContent=`Drag a slider; double-click resets it`}show(e){this.el.textContent=e}};function ul(e,t,n,r){let i=G(`div`,`m26-slider ${n?`m26-v`:`m26-h`}`);i.append(G(`div`,`m26-slot`),G(`div`,`m26-cap`));let a=G(`input`,`m26-input`);a.type=`range`,a.min=`0`,a.max=String(dc),a.step=`1`,a.setAttribute(`aria-label`,`${t} ${e.label}`),n&&a.setAttribute(`aria-orientation`,`vertical`);let o=()=>`${t} · ${e.label}  ${sl(e)}`,s=()=>{let t=fc(e);i.style.setProperty(`--t`,String(t/dc)),a.value=String(t),a.setAttribute(`aria-valuetext`,sl(e)),a.title=o()};return a.addEventListener(`input`,()=>{e.set(pc(e,Number(a.value))),r?.show(o())}),a.addEventListener(`dblclick`,()=>{e.set(e.initial),r?.show(o())}),a.addEventListener(`focus`,()=>r?.show(o())),e.onChange(s),s(),i.append(a),i}var Q=(e,t,n)=>{let r=n??e.options;return{positions:r,aria:t,get:()=>r.indexOf(e.value),set:t=>e.set(r[t]),subscribe:t=>void e.onChange(t)}},dl=(e,t,n=!0)=>({positions:n?[`on`,`off`]:[`off`,`on`],aria:t,get:()=>e.value===n?0:1,set:t=>e.set(n?t===0:t===1),subscribe:t=>void e.onChange(t)});function $(e,t){let n=G(`button`,`m26-switch`);n.type=`button`,n.setAttribute(`aria-label`,e.aria),n.append(G(`i`));let r=e.positions.length-1,i=()=>{let t=e.get();n.style.setProperty(`--p`,String(r===0?0:t/r)),n.title=`${e.aria}: ${e.positions[t]}`,n.setAttribute(`aria-description`,e.positions[t])},a=n=>{e.set(Math.max(0,Math.min(r,n))),t?.show(`${e.aria}: ${e.positions[e.get()].toUpperCase()}`)};return n.addEventListener(`click`,()=>a(e.get()===r?0:e.get()+1)),n.addEventListener(`keydown`,t=>{t.key===`ArrowUp`&&(t.preventDefault(),a(e.get()-1)),t.key===`ArrowDown`&&(t.preventDefault(),a(e.get()+1))}),e.subscribe(i),i(),n}function fl(e,t){let n=G(`button`,`m26-button`);n.type=`button`,n.setAttribute(`aria-label`,e),n.title=e;let r=e=>{e.preventDefault(),n.classList.add(`down`),t(!0)},i=()=>{n.classList.contains(`down`)&&(n.classList.remove(`down`),t(!1))};return n.addEventListener(`pointerdown`,r),n.addEventListener(`pointerup`,i),n.addEventListener(`pointerleave`,i),n.addEventListener(`pointercancel`,i),n.addEventListener(`keydown`,e=>{(e.key===` `||e.key===`Enter`)&&!e.repeat&&r(e)}),n.addEventListener(`keyup`,e=>{(e.key===` `||e.key===`Enter`)&&i()}),n}function pl(e,t,n){let r=G(`div`,`m26-knob`);r.tabIndex=0,r.setAttribute(`role`,`slider`),r.setAttribute(`aria-label`,`${t} ${e.label}`),r.setAttribute(`aria-valuemin`,`0`),r.setAttribute(`aria-valuemax`,String(dc)),r.append(G(`i`));let i=()=>`${t} · ${e.label}  ${sl(e)}`,a=()=>{let t=fc(e);r.style.setProperty(`--a`,`${-135+t/dc*270}deg`),r.setAttribute(`aria-valuenow`,String(t)),r.setAttribute(`aria-valuetext`,sl(e)),r.title=i()},o=t=>{e.set(pc(e,Math.max(0,Math.min(dc,fc(e)+t)))),n?.show(i())},s=0,c=0;return r.addEventListener(`pointerdown`,t=>{s=t.clientY,c=fc(e),r.setPointerCapture(t.pointerId)}),r.addEventListener(`pointermove`,t=>{r.hasPointerCapture(t.pointerId)&&(e.set(pc(e,Math.max(0,Math.min(dc,c+(s-t.clientY)*5)))),n?.show(i()))}),r.addEventListener(`wheel`,e=>{e.preventDefault(),o(e.deltaY<0?20:-20)},{passive:!1}),r.addEventListener(`keydown`,e=>{(e.key===`ArrowUp`||e.key===`ArrowRight`)&&(e.preventDefault(),o(20)),(e.key===`ArrowDown`||e.key===`ArrowLeft`)&&(e.preventDefault(),o(-20))}),r.addEventListener(`dblclick`,()=>e.set(e.initial)),e.onChange(a),a(),r}function ml(e=``){let t=G(`i`,`m26-led ${e}`.trim());return t.setAttribute(`aria-hidden`,`true`),t}var hl=class{root=G(`div`,`m26-desktop`);jacks=new Map;svg=[];place(e,t,n,r,i=r){return e.classList.add(`m26-placed`),e.style.left=`${((t-r/2)/q*100).toFixed(3)}%`,e.style.top=`${((n-i/2)/tl*100).toFixed(3)}%`,e.style.width=`${(r/q*100).toFixed(3)}%`,e.style.height=`${(i/tl*100).toFixed(3)}%`,this.root.append(e),e}draw(e){this.svg.push(e)}text(e,t,n,r=9,i=`middle`,a=``){this.draw(`<text x="${e}" y="${t}" font-size="${r}" text-anchor="${i}" ${a}>${cl(n)}</text>`)}lines(e,t,n,r=8.5,i=r+1){n.split(`
`).forEach((n,a)=>this.text(e,t+a*i,n,r))}line(e,t,n,r,i=1.2){this.draw(`<line x1="${e}" y1="${t}" x2="${n}" y2="${r}" stroke-width="${i}"/>`)}path(e,t=1.2){this.draw(`<path d="${e}" fill="none" stroke-width="${t}"/>`)}box(e,t,n,r,i,a=9.5){this.draw(`<rect x="${e}" y="${t}" width="${n}" height="${r}" fill="none" stroke-width="1.3"/>`);let o=i.split(`
`),s=a+1.5,c=t+r/2-(o.length-1)*s/2+a*.36;o.forEach((t,r)=>this.text(e+n/2,c+r*s,t,a,`middle`,`font-weight="700"`))}bracket(e,t,n,r){let i=(e+t)/2,a=r.length*2.6+6;this.path(`M${e} ${n+6} V${n} H${i-a} M${i+a} ${n} H${t} V${n+6}`),this.text(i,n+3,r,8.5,`middle`,`font-weight="600"`)}jack(e,t,n,r){if(!kn(e)){let e=G(`span`,`m26-jack`);return e.title=r,e.setAttribute(`aria-hidden`,`true`),this.place(e,t,n,21)}let i=G(`button`,`m26-jack`);return i.type=`button`,i.dataset.jack=e,i.title=`${r} — drag to another jack to patch, double-click to unplug`,i.setAttribute(`aria-label`,`Jack ${T(e)}`),this.jacks.set(e,{el:i,x:t,y:n}),this.place(i,t,n,21)}inJack(e,t,n,r,i=!0){this.jack(e,t,n,`Input: ${r.replace(`
`,` `)}`),i&&this.draw(`<circle cx="${t}" cy="${n+22}" r="5.5" fill="none" stroke-width="1"/><path d="M${t-3} ${n+25} L${t+3} ${n+19} M${t+.5} ${n+19} H${t+3} V${n+21.5}" fill="none" stroke-width="1"/>`);let a=r.split(`
`),o=a.length>1?21:13;this.draw(`<rect x="${t-13}" y="${n+31}" width="26" height="${o}" fill="none" stroke-width="0.9"/>`),a.forEach((e,r)=>this.text(t,n+40+r*8.5,e,7))}outJack(e,t,n,r,i=!0){this.jack(e,t,n,`Output: ${r}`),this.text(t,i?n-15:n+22,r,7.5)}vslider(e,t,n,r,i,a,o=!0){if(o)for(let e=0;e<=4;e++)this.line(n+9,r+8+e*(i-r-16)/4,n+14,r+8+e*(i-r-16)/4,1);let s=ul(e,t,!0,a);return this.place(s,n,(r+i)/2,18,i-r)}hslider(e,t,n,r,i,a){let o=ul(e,t,!1,a);return this.place(o,(n+r)/2,i,r-n,16)}finish(){return this.root.insertAdjacentHTML(`afterbegin`,`<svg class="m26-art" viewBox="0 0 ${q} ${tl}" aria-hidden="true" focusable="false"><g class="m26-ink">${this.svg.join(``)}</g></svg>`),this.root}};function gl(e,t){let n=G(`div`,`m26-patch-name ${t}`);n.setAttribute(`role`,`status`),n.setAttribute(`aria-label`,`Patch`);let r=!1,i=()=>{n.textContent=`${String(e.currentSlot+1).padStart(2,`0`)} ${e.currentPreset.name}${r?`  SAVED`:``}`};e.onPresetChange(i),i();let a=(e,t,n)=>{let r=G(`button`,`m26-patch-btn`,e);return r.type=`button`,r.setAttribute(`aria-label`,t),r.addEventListener(`click`,n),r},o=t=>e.loadSlot((e.currentSlot+t+e.slots.length)%e.slots.length);return{name:n,buttons:[a(`◀`,`Previous patch`,()=>o(-1)),a(`▶`,`Next patch`,()=>o(1)),a(`SAVE`,`Save the panel into this patch slot`,()=>{el(e.currentSlot,e.saveSlot(e.currentSlot)),r=!0,i(),window.setTimeout(()=>{r=!1,i()},1500)})]}}function _l(e){let t=G(`button`,`m26-patch-btn m26-clear`);t.type=`button`;let n=()=>{t.textContent=`CORDS ${e.cords.length} ✕`,t.disabled=e.cords.length===0,t.setAttribute(`aria-label`,`Remove all ${e.cords.length} patch cords`)};return t.addEventListener(`click`,()=>e.clearCords()),e.onCordsChange(n),n(),t}function vl(e){let t=G(`section`,`m26-card`);t.append(G(`h2`,`m26-card-title`,`PATCH CORDS`));let n=G(`ul`,`m26-cord-list`),r=(e,t)=>{let n=G(`select`,`m26-channel`);n.setAttribute(`aria-label`,e);for(let e of t){let t=G(`option`,``,T(e));t.value=e,n.append(t)}return n},i=r(`Cord from`,Vn),a=r(`Cord to`,Hn),o=G(`button`,`m26-patch-btn`,`CONNECT`);o.type=`button`;let s=G(`p`,`m26-cord-note`);o.addEventListener(`click`,()=>{s.textContent=e.connect(i.value,a.value)?``:`Those two cannot be joined.`});let c=G(`div`,`m26-cord-form`);c.append(i,G(`span`,`m26-item-label`,`→`),a,o);let l=()=>{n.replaceChildren(...e.cords.map(t=>{let n=G(`li`,`m26-cord`);n.append(G(`span`,``,`${T(t.from)} → ${T(t.to)}`));let r=G(`button`,`m26-patch-btn`,`✕`);return r.type=`button`,r.setAttribute(`aria-label`,`Remove ${T(t.from)} to ${T(t.to)}`),r.addEventListener(`click`,()=>e.setCords(e.cords.filter(e=>e!==t))),n.append(r),n})),e.cords.length===0&&n.append(G(`li`,`m26-cord-note`,`No cords: the synth plays on its normalled routing.`))};return e.onCordsChange(l),l(),t.append(n,c,s),t}function yl(e){let t=Z(e,`play.channel`),n=G(`select`,`m26-channel`);n.setAttribute(`aria-label`,`MIDI channel`);for(let e of tr){let t=G(`option`,``,e===`omni`?`MIDI OMNI`:`MIDI CH ${e}`);t.value=e,n.append(t)}let r=()=>{n.value=t.value};return n.addEventListener(`change`,()=>t.set(n.value)),t.onChange(r),r(),n}function bl(e,t){let n=new hl,r=new ll,i=e=>nl+e,a=e=>rl+e;n.draw(`<rect class="m26-face" x="1" y="1" width="1378" height="923" rx="10"/>`);for(let[e,t]of[[18,18],[1362,18],[18,907],[1362,907],[q/2,18],[q/2,907]])n.draw(`<g class="m26-screw"><circle cx="${e}" cy="${t}" r="7"/><path d="M${e-4} ${t} H${e+4} M${e} ${t-4} V${t+4}"/></g>`);n.text(40,37,`MOA-2600`,28,`start`,`class="m26-logo"`),n.text(186,36,`SEMI-MODULAR SYNTHESIZER · DUAL FILTER`,10,`start`,`letter-spacing="2" class="m26-sub"`),n.place(r.el,590,26,280,20),n.place(_l(e),777,26,74,24);let o=gl(e,`m26-patch-desktop`);n.place(o.name,950,26,250,24),n.place(o.buttons[0],1095,26,28,24),n.place(o.buttons[1],1127,26,28,24),n.place(o.buttons[2],1170,26,46,24),n.place(yl(e),1270,26,108,24),n.draw(`<rect x="32" y="46" width="1316" height="584" rx="4" fill="none" stroke-width="1.4"/>`);for(let e of[200,360,520,765,975,1100,1240])n.line(e,i(0),e,i(570),1.4);n.draw(`<rect x="32" y="638" width="1316" height="263" rx="4" fill="none" stroke-width="1.4"/>`);for(let e of[270,420,570,710,1020,1225])n.line(e,a(4),e,a(252),1.4);let s=(t,a)=>{let o=`vco${t}`,s=`VCO ${t}`,c=a+12,l=a+148;n.text((c+l)/2,i(18),`INITIAL OSCILLATOR FREQUENCY`,8),[`10`,`100`,`1kHz`,`10kHz`].forEach((e,t)=>n.text(c+8+t*40,i(31),e,6.5)),[`.03`,`0.3`,`3.0`,`30.`].forEach((e,t)=>n.text(c+8+t*40,i(38),e,6,`middle`,`class="m26-dim"`)),n.hslider(X(e,`${o}.freq`),s,c,l,i(J[0]),r),n.text((c+l)/2,i(74),`FINE TUNE`,8),n.line((c+l)/2,i(78),(c+l)/2,i(83),1),n.hslider(X(e,`${o}.fine`),s,c,l,i(J[1]),r),n.text((c+l)/2,i(120),`PULSE WIDTH`,8),n.text(c+6,i(128),`10%`,6.5),n.text((c+l)/2,i(128),`50%`,6.5),n.text(l-6,i(128),`90%`,6.5),n.hslider(X(e,`${o}.pw`),s,c,l,i(J[2]),r),t===1?(n.box(a+8,i(212),92,44,`VOLTAGE
CONTROLLED
OSCILLATOR 1`,8.5),n.text(a+135,i(178),`OUTPUTS`,7,`middle`,`class="m26-dim"`),n.outJack(`vco1.saw`,a+135,i(205),`SAW`),n.outJack(`vco1.pulse`,a+135,i(262),`PULSE`),n.path(`M${a+100} ${i(225)} H${a+122} M${a+100} ${i(245)} Q${a+112} ${i(245)} ${a+112} ${i(262)} H${a+122}`),n.draw(`<g transform="translate(${a+30} ${i(176)})" class="m26-mark"><circle cx="9" cy="9" r="9"/><path d="M3 12 L7 5 L9 10 L11 5 L15 12"/></g>`)):(n.text(a+20,i(176),`SYNC`,7.5),n.text(a+20,i(186),`ON`,6.5),n.place($(dl(ol(e,`${o}.sync`),`${s} sync to VCO 1`),r),a+20,i(206),14,30),n.text(a+20,i(232),`OFF`,6.5),n.box(a+34,i(212),64,44,`VOLTAGE\nCONTROLLED\nOSCILLATOR ${t}`,7.5),n.outJack(`${o}.tri`,a+112,i(198),`TRI`),n.outJack(`${o}.saw`,a+142,i(198),`SAW`),n.outJack(`${o}.sine`,a+112,i(268),`SINE`,!1),n.outJack(`${o}.pulse`,a+142,i(268),`PULSE`,!1),n.path(`M${a+98} ${i(226)} H${a+104} V${i(210)} M${a+98} ${i(242)} H${a+104} V${i(256)}`));let u=t===1?36:32,d=t===1?a+22:a+18,f=Array.from({length:t===1?4:5},(e,t)=>d+t*u);n.text(f[0],i(360),`AUDIO`,7),n.text(f[0],i(369),`KYBD ON`,6.5),n.place($(Q(Z(e,`${o}.range`),`${s} range`),r),f[0],i(392),14,30),n.text(f[0],i(418),`KYBD OFF`,6.5),n.text(f[0],i(427),`LF`,7),n.inJack(`${o}.fm.kybd`,f[0],i(Y),`KYBD
CV`,!1),{1:[[`fm.sh`,`S/H
OUT`],[`fm.adsr`,`ADSR`],[`fm.lfo`,`LFO`]],2:[[`fm.sh`,`S/H
OUT`],[`fm.adsr`,`ADSR`],[`fm.vco1`,`VCO 1
⊓⊔`],[`pwm`,`NOISE
GEN`]],3:[[`fm.noise`,`NOISE
GEN`],[`fm.adsr`,`ADSR`],[`fm.vco2`,`VCO 2
∿`],[`pwm`,`ADSR`]]}[t].forEach(([c,l],u)=>{let d=f[u+1];n.vslider(X(e,`${o}.${c}`),s,d,i(il),i(al),r),n.inJack(`${o}.${c}`,d,i(Y),l),n.path(`M${d} ${i(299)} V${i(290)} L${a+(t===1?54:66)+(u-1)*8} ${i(258)}`,1)});let p=f[3];n.bracket(f[0]-4,p+4,i(468),`FM CONTROL`),t!==1&&n.text(f[4],i(471),`PWM`,8,`middle`,`font-weight="600"`)};s(1,40),s(2,200),s(3,360);{n.text(1323/2,i(18),`INITIAL FILTER FREQUENCY`,8),[`10`,`100`,`1kHz`,`10kHz`].forEach((e,t)=>n.text(585+t*51,i(31),e,6.5)),n.hslider(X(e,`vcf.freq`),`VCF`,575,748,i(J[0]),r),n.text(1323/2,i(74),`FINE TUNE`,8),n.hslider(X(e,`vcf.fine`),`VCF`,575,748,i(J[1]),r),n.text(1323/2,i(120),`RESONANCE`,8),n.text(583,i(128),`MIN`,6.5),n.text(740,i(128),`MAX`,6.5),n.hslider(X(e,`vcf.res`),`VCF`,575,748,i(J[2]),r),n.text(548,i(176),`MODE`,8),n.text(548,i(186),`4012`,6.5),n.place($(Q(Z(e,`vcf.mode`),`VCF mode, 4012 or 4072`),r),548,i(206),14,30),n.text(548,i(232),`4072`,6.5),n.box(598,i(196),116,52,`VOLTAGE
CONTROLLED
FILTER / RESONATOR
VCF`,8),n.outJack(`vcf.out`,744,i(222),`OUTPUT`),n.line(714,i(222),731,i(222));let t=[[`in.ring`,`RING
MOD`],[`in.vco1`,`VCO 1
⊓⊔`],[`in.vco2`,`VCO 2
⊓⊔`],[`in.vco3`,`VCO 3
⩘`],[`in.noise`,`NOISE
GEN`]],a=[[`cv.kybd`,`KYBD
CV`],[`cv.adsr`,`ADSR`],[`cv.vco2`,`VCO 2
∿`]];[...t,...a].forEach(([t,a],o)=>{let s=542+o*30;n.vslider(X(e,`vcf.${t}`),`VCF`,s,i(il),i(al),r),n.inJack(`vcf.${t}`,s,i(Y),a),n.path(`M${s} ${i(299)} V${i(282+o%4*4)} L${606+o*14} ${i(248)}`,1)}),n.bracket(538,666,i(468),`AUDIO`),n.bracket(688,756,i(468),`CONTROL`)}{n.text(1745/2,i(18),`SEM FILTER FREQUENCY`,8),[`10`,`100`,`1kHz`,`10kHz`].forEach((e,t)=>n.text(800+t*48,i(31),e,6.5)),n.hslider(X(e,`sem.freq`),`SEM`,790,955,i(J[0]),r),n.text(1745/2,i(74),`RESONANCE`,8),n.text(798,i(82),`MIN`,6.5),n.text(947,i(82),`MAX`,6.5),n.hslider(X(e,`sem.res`),`SEM`,790,955,i(J[1]),r),n.text(1745/2,i(120),`MODE`,8),n.text(796,i(128),`LP`,7),n.text(1745/2,i(128),`NOTCH`,7),n.text(949,i(128),`HP`,7),n.hslider(X(e,`sem.mode`),`SEM`,790,955,i(J[2]),r),n.text(806,i(176),`BAND`,7.5),n.text(806,i(186),`BP`,6.5),n.place($(dl(ol(e,`sem.bp`),`SEM band pass`),r),806,i(206),14,30),n.text(806,i(232),`MODE`,6.5),n.box(856,i(196),82,52,`SEM
STATE-VARIABLE
FILTER
LP · N · HP · BP`,7.5),n.outJack(`sem.out`,957,i(240),`OUTPUT`,!1),n.path(`M938 ${i(222)} H957 V${i(229)}`);let t=[[`in.vco1`,`VCO 1
⩘`],[`in.vco2`,`VCO 2
⩘`],[`in.vco3`,`VCO 3
⊓⊔`],[`in.noise`,`NOISE
GEN`]],a=[[`cv.kybd`,`KYBD
CV`],[`cv.adsr`,`ADSR`],[`cv.lfo`,`LFO
∿`]];[...t,...a].forEach(([t,a],o)=>{let s=785+o*29.5;n.vslider(X(e,`sem.${t}`),`SEM`,s,i(il),i(al),r),n.inJack(`sem.${t}`,s,i(Y),a),n.path(`M${s} ${i(299)} V${i(282+o%4*4)} L${866+o*10} ${i(248)}`,1)}),n.bracket(781,877,i(468),`AUDIO`),n.bracket(903,966,i(468),`CONTROL`)}[[`attack`,`ATTACK
TIME`],[`decay`,`DECAY
TIME`],[`sustain`,`SUS
LEVEL`],[`release`,`REL
TIME`]].forEach(([t,a],o)=>{let s=992+o*30;n.lines(s,i(14),a,7.5),n.vslider(X(e,`adsr.${t}`),`ADSR`,s,i(30),i(175),r)}),n.box(984,i(186),108,26,`ADSR
ENVELOPE GENERATOR`,7.5),n.text(994,i(230),`x2`,6.5),n.place($(Q(Z(e,`adsr.factor`),`ADSR time factor`,[`x2`,`x1`,`x0.5`]),r),994,i(252),14,30),n.text(994,i(278),`x0.5`,6.5),n.text(994,i(287),`TIME`,6.5),n.outJack(`adsr.out`,1080,i(240),`OUTPUT`,!1),n.line(1080,i(212),1080,i(229)),n.lines(994,i(304),`ATTACK
TIME`,7),n.vslider(X(e,`ar.attack`),`AR`,994,i(320),i(445),r),n.lines(1082,i(304),`REL
TIME`,7),n.vslider(X(e,`ar.release`),`AR`,1082,i(320),i(445),r),n.text(1024,i(310),`MANUAL`,6.5),n.place(fl(`AR manual gate`,t=>e.setManual(t)),1024,i(330),18),n.outJack(`ar.out`,1054,i(330),`OUTPUT`),n.box(1010,i(352),58,24,`AR
ENV GEN`,7.5),n.text(1024,i(392),`KYBD`,6.5),n.place($(Q(Z(e,`ar.source`),`AR gate: keyboard or S/H clock`),r),1024,i(412),14,28),n.text(1024,i(437),`S/H`,6.5),n.text(1054,i(392),`x2`,6.5),n.place($(Q(Z(e,`ar.factor`),`AR time factor`,[`x2`,`x1`,`x0.5`]),r),1054,i(412),14,28),n.text(1054,i(437),`x0.5`,6.5),n.jack(`adsr.gate`,996,i(Y),`Input: ADSR gate (keyboard gate)`),n.text(996,i(514),`GATE IN`,6.5),n.jack(`adsr.trig`,1030,i(Y),`Input: ADSR trigger (keyboard trigger)`),n.text(1030,i(514),`TRIG IN`,6.5),n.jack(`ar.gate`,1064,i(Y),`Input: AR gate`),n.text(1064,i(514),`AR GATE`,6.5),n.text(1030,i(471),`GATES`,8,`middle`,`font-weight="600"`),n.lines(1120,i(14),`INITIAL
GAIN`,7.5),n.vslider(X(e,`vca.gain`),`VCA`,1120,i(30),i(175),r),n.box(1144,i(186),88,40,`VOLTAGE
CONTROLLED
AMPLIFIER`,8),n.outJack(`vca.out`,1188,i(150),`OUTPUT`),n.line(1188,i(161),1188,i(186)),[[`in.vcf`,`VCF`],[`in.sem`,`SEM`],[`in.ring`,`RING
MOD`],[`cv.ar`,`AR`],[`cv.adsr`,`ADSR`]].forEach(([t,a],o)=>{let s=1118+o*28;n.vslider(X(e,`vca.${t}`),`VCA`,s,i(il),i(al),r),n.inJack(`vca.${t}`,s,i(Y),a),n.path(`M${s} ${i(299)} V${i(260+o*4)} L${1156+o*13} ${i(226)}`,1)}),n.bracket(1114,1178,i(468),`AUDIO`),n.text(1200,i(471),`LIN`,6.5),n.text(1228,i(471),`EXP`,6.5),n.outJack(`out.L`,1262,i(30),`L OUT`,!1),n.outJack(`out.R`,1318,i(30),`R OUT`,!1),n.text(1290,i(70),`PAN`,7.5),n.hslider(X(e,`mix.pan`),`Output`,1252,1328,i(84),r),n.jack(`out.left`,1262,i(118),`Input: left output`),n.text(1262,i(140),`LEFT IN`,6.5),n.jack(`out.right`,1318,i(118),`Input: right output`),n.text(1318,i(140),`RIGHT IN`,6.5),n.text(1265,i(156),`L`,7.5),n.text(1315,i(156),`R`,7.5),n.vslider(X(e,`reverb.left`),`Reverb`,1265,i(162),i(240),r),n.vslider(X(e,`reverb.right`),`Reverb`,1315,i(162),i(240),r),n.box(1266,i(248),48,15,`REVERB`,8),n.outJack(`mix.out`,1262,i(285),`MIX OUT`,!1),n.outJack(`reverb.out`,1318,i(285),`REV OUT`,!1),n.vslider(X(e,`mix.vcf`),`Mixer`,1265,i(325),i(435),r),n.vslider(X(e,`mix.vca`),`Mixer`,1315,i(325),i(435),r),n.box(1268,i(450),44,14,`MIXER`,8),n.inJack(`mix.in.vcf`,1265,i(Y),`VCF`),n.inJack(`mix.in.vca`,1315,i(Y),`VCA`);{[[`kb.trig`,60,`TRIG OUT`],[`kb.upper`,100,`UPPER
VOICE`]].forEach(([e,t,r])=>{n.lines(t,a(14),r,6.5),n.jack(e,t,a(38),`Output: ${r.replace(`
`,` `)}`)}),n.text(60,a(64),`GATE OUT`,6.5),n.jack(`kb.gate`,60,a(84),`Output: keyboard gate`),n.text(100,a(64),`KYBD CV`,6.5),n.jack(`kb.cv`,100,a(84),`Output: keyboard CV`),n.lines(142,a(12),`VOICE
MODE`,7.5),n.text(142,a(32),`MONO`,6.5),n.place($(Q(Z(e,`kb.voice`),`Voice mode: mono or duo`),r),142,a(54),14,30),n.text(142,a(80),`DUO`,6.5),n.text(186,a(16),`LFO ∿`,6.5),n.jack(`lfo.tri`,186,a(38),`Output: LFO triangle`),n.text(186,a(64),`LFO ⊓⊔`,6.5),n.jack(`lfo.square`,186,a(84),`Output: LFO square`),n.lines(228,a(12),`EXT VIB
IN`,6.5),n.jack(`kb.extvib`,228,a(38),`Input: external vibrato`),n.lines(228,a(60),`LFO
DELAYED`,6.5),n.jack(`lfo.delayed`,228,a(84),`Output: delayed LFO`),n.text(54,a(120),`ON`,6.5),n.place($(dl(ol(e,`kb.portaOn`),`Portamento on or off`),r),54,a(142),14,30),n.text(54,a(168),`OFF`,6.5),n.text(54,a(184),`MOMEN`,6.5),n.place(fl(`Portamento, while held`,t=>e.setPortamentoHeld(t)),54,a(200),16),n.text(86,a(114),`MAX`,6.5,`end`),n.text(86,a(214),`MIN`,6.5,`end`),n.vslider(X(e,`kb.porta`),`Portamento`,98,a(108),a(220),r,!1),n.box(40,a(226),74,14,`PORTAMENTO`,8),n.text(142,a(108),`REPEAT`,7.5),n.text(142,a(117),`KYBD`,6.5),n.place($(Q(Z(e,`kb.repeat`),`Repeat: keyboard, off or auto`),r),142,a(138),14,30),n.text(156,a(141),`OFF`,6.5,`start`),n.text(142,a(163),`AUTO`,6.5),n.lines(142,a(178),`TRIG
MODE`,7.5),n.text(142,a(196),`SINGLE`,6.5),n.place($(Q(Z(e,`kb.trig`),`Trigger mode: single or multi`),r),142,a(214),12,22),n.text(142,a(233),`MULTI`,6.5);let i=n.place(ml(`m26-lfo-led`),186,a(104),7);t.add(i,e=>e.lfo),n.vslider(X(e,`lfo.speed`),`LFO`,186,a(112),a(212),r),n.vslider(X(e,`lfo.delay`),`Vibrato`,216,a(112),a(212),r),n.vslider(X(e,`lfo.depth`),`Vibrato`,246,a(112),a(212),r),n.lines(186,a(224),`LFO
SPEED`,7),n.lines(216,a(224),`VIB
DELAY`,7),n.lines(246,a(224),`VIB
DEPTH`,7)}n.box(278,a(10),46,15,`PREAMP`,7.5),n.outJack(`pre.out`,312,a(48),`OUTPUT`,!1),n.text(288,a(86),`GAIN`,7),n.vslider(X(e,`pre.gain`),`Preamp`,288,a(94),a(220),r,!1),n.text(322,a(108),`x1000`,6.5),n.place($(Q(Z(e,`pre.range`),`Preamp range`,[`x1000`,`x100`,`x10`]),r),322,a(132),14,30),n.text(322,a(158),`x10`,6.5),n.text(322,a(186),`INPUT`,6.5),n.jack(`pre.in`,322,a(204),`Input: preamp`),n.box(350,a(8),64,22,`ENV
FOLLOWER`,7.5),n.outJack(`envf.out`,396,a(52),`OUTPUT`,!1),n.vslider(X(e,`envf.gain`),`Envelope follower`,362,a(94),a(220),r),n.box(380,a(176),34,12,`PREAMP`,6),n.jack(`envf.in`,396,a(204),`Input: envelope follower (normalled to the preamp)`),n.box(440,a(8),74,18,`RING MOD`,9),n.outJack(`ring.out`,548,a(30),`OUTPUT`,!1),n.vslider(X(e,`ring.a`),`Ring mod`,444,a(70),a(220),r),n.vslider(X(e,`ring.b`),`Ring mod`,548,a(70),a(220),r),n.text(496,a(84),`AUDIO`,6.5),n.place($(Q(Z(e,`ring.mode`),`Ring mod: audio or DC coupled`),r),496,a(106),14,30),n.text(496,a(132),`DC`,6.5),n.box(462,a(166),28,20,`VCO 1
⩘`,6),n.jack(`ring.a`,476,a(204),`Input: ring mod A (VCO 1 saw)`),n.box(502,a(166),28,20,`VCO 2
∧`,6),n.jack(`ring.b`,516,a(204),`Input: ring mod B (VCO 2 triangle)`),n.box(580,a(8),96,18,`NOISE GENERATOR`,8),n.outJack(`noise.out`,692,a(44),`OUTPUT`,!1),n.text(610,a(62),`COLOR`,7.5),n.text(598,a(78),`WHITE`,6.5,`end`),n.text(598,a(148),`PINK`,6.5,`end`),n.text(598,a(212),`LOW`,6.5,`end`),n.text(598,a(220),`FREQ`,6.5,`end`),n.vslider(X(e,`noise.color`),`Noise`,610,a(72),a(222),r,!1),n.text(662,a(62),`LEVEL`,7.5),n.vslider(X(e,`noise.level`),`Noise`,662,a(72),a(222),r),n.text(808,a(22),`MULT`,7.5,`end`),[828,858,888,918].forEach((e,t)=>{n.jack(`mult.${t+1}`,e,a(18),`Mult`),t&&n.line(e-19,a(18),e-11,a(18))}),n.box(796,a(38),136,18,`VOLTAGE PROCESSOR`,9);for(let[t,i,o]of[[`vp.2`,`2  −10V`,86],[`vp.4`,`4  KYBD CV`,124],[`vp.6`,`6  +10V`,164],[`vp.lag`,`7  ENV FOLL`,206]])n.text(722,a(o-14),i,6.5,`start`),n.jack(t===`vp.lag`?`vp.7`:t,732,a(o),`Input: processor ${i}`),n.hslider(X(e,t),`Voltage processor`,752,892,a(o),r);n.text(822,a(226),`→ INCREASE LAG TIME →`,6.5),n.jack(`vp.1`,918,a(70),`Input: processor 1`),n.text(904,a(73),`1`,6.5,`end`),n.jack(`vp.3`,918,a(104),`Input: processor 3`),n.text(904,a(107),`3`,6.5,`end`),n.path(`M892 ${a(86)} H940 M892 ${a(124)} H940 V${a(86)} M929 ${a(70)} H940 V${a(86)} M929 ${a(104)} H940`),n.draw(`<path d="M948 ${a(88)} L962 ${a(88)} L955 ${a(74)} Z" fill="none" stroke-width="1"/>`),n.path(`M940 ${a(86)} H948`),n.outJack(`vp.inv1`,996,a(86),`INVERTER`,!1),n.path(`M962 ${a(86)} H985`),n.jack(`vp.5`,918,a(144),`Input: processor 5`),n.text(904,a(147),`5`,6.5,`end`),n.path(`M892 ${a(164)} H950 M918 ${a(155)} V${a(164)}`),n.draw(`<path d="M950 ${a(157)} L950 ${a(171)} L963 ${a(164)} Z" fill="none" stroke-width="1"/>`),n.outJack(`vp.inv2`,996,a(164),`INVERTER`,!1),n.path(`M963 ${a(164)} H985`),n.box(928,a(199),30,14,`LAG`,7.5),n.path(`M892 ${a(206)} H928 M958 ${a(206)} H985`),n.jack(`vp.lag`,996,a(206),`Output: lag`);{n.box(1058,a(8),92,18,`SAMPLE & HOLD`,8.5),n.jack(`sh.in`,1040,a(46),`Input: S/H (normalled to noise)`),n.box(1027,a(60),26,20,`NOISE
GEN`,6),n.jack(`sh.clk`,1040,a(104),`Output: S/H internal clock`),n.lines(1062,a(98),`INT
CLK`,6.5),n.jack(`sh.out`,1040,a(150),`Output: S/H`),n.lines(1062,a(146),`S/H
OUT`,6.5),n.jack(`sh.extclk`,1040,a(200),`Input: S/H external clock`),n.lines(1062,a(196),`EXT
CLK`,6.5);let i=n.place(ml(),1112,a(46),8);t.add(i,e=>e.clk),n.text(1096,a(64),`LEVEL`,6.5),n.vslider(X(e,`sh.level`),`S/H`,1096,a(72),a(220),r),n.text(1136,a(64),`RATE`,6.5),n.vslider(X(e,`sh.rate`),`S/H`,1136,a(72),a(220),r),n.lines(1192,a(14),`ELEC
SWITCH`,7),n.jack(`esw.a`,1174,a(46),`Input: electronic switch A`),n.text(1174,a(64),`A`,7),n.jack(`esw.b`,1210,a(46),`Input: electronic switch B`),n.text(1210,a(64),`B`,7);let o=n.place(ml(`m26-amber`),1174,a(76),7),s=n.place(ml(`m26-amber`),1210,a(76),7);t.add(o,e=>e.esw===0),t.add(s,e=>e.esw===1),n.draw(`<circle cx="1192" cy="${a(112)}" r="10" fill="none" stroke-width="1.2"/>`),n.path(`M1174 ${a(84)} V${a(100)} L1188 ${a(108)} M1210 ${a(84)} V${a(100)} L1196 ${a(108)} M1192 ${a(122)} V${a(134)}`),n.outJack(`esw.c`,1192,a(146),`C`,!1),n.box(1172,a(186),40,22,`INT
CLOCK`,7)}{n.text(1280,a(30),`VOLUME`,8),n.place(pl(X(e,`out.volume`),`Output`,r),1280,a(78),58),[`0`,`2`,`4`,`6`,`8`,`10`].forEach((e,t)=>{let r=(-135+t*54)*Math.PI/180;n.text(1280+Math.sin(r)*40,a(78)-Math.cos(r)*40+3,e,6.5)});let i=n.place(ml(`m26-amber`),1280,a(150),10);t.add(i,e=>e.gate),n.text(1280,a(172),`GATE`,8)}Kc(n,e,r,t,925);let c=n.finish();return Hc(c,e,n.jacks,q,tl,e=>r.show(e)),c}var xl=class{list=[];add(e,t){this.list.push([e,t])}start(e){let t=()=>{let n=e.readM2600(`m2600`,`synth`);if(n)for(let[e,t]of this.list)e.classList.toggle(`on`,t(n));requestAnimationFrame(t)};requestAnimationFrame(t)}},Sl=[[`VCO 1`,[`vco1.range`,`vco1.freq`,`vco1.fine`,`vco1.pw`,`vco1.fm.sh`,`vco1.fm.adsr`,`vco1.fm.lfo`]],[`VCO 2`,[`vco2.range`,`vco2.sync`,`vco2.freq`,`vco2.fine`,`vco2.pw`,`vco2.fm.sh`,`vco2.fm.adsr`,`vco2.fm.vco1`,`vco2.pwm`]],[`VCO 3`,[`vco3.range`,`vco3.sync`,`vco3.freq`,`vco3.fine`,`vco3.pw`,`vco3.fm.noise`,`vco3.fm.adsr`,`vco3.fm.vco2`,`vco3.pwm`]],[`VCF`,[`vcf.mode`,`vcf.freq`,`vcf.fine`,`vcf.res`,`vcf.in.ring`,`vcf.in.vco1`,`vcf.in.vco2`,`vcf.in.vco3`,`vcf.in.noise`,`vcf.cv.kybd`,`vcf.cv.adsr`,`vcf.cv.vco2`]],[`SEM FILTER`,[`sem.bp`,`sem.freq`,`sem.res`,`sem.mode`,`sem.in.vco1`,`sem.in.vco2`,`sem.in.vco3`,`sem.in.noise`,`sem.cv.kybd`,`sem.cv.adsr`,`sem.cv.lfo`]],[`ADSR`,[`adsr.factor`,`adsr.attack`,`adsr.decay`,`adsr.sustain`,`adsr.release`]],[`AR`,[`ar.source`,`ar.factor`,`ar.attack`,`ar.release`]],[`VCA`,[`vca.gain`,`vca.in.vcf`,`vca.in.sem`,`vca.in.ring`,`vca.cv.ar`,`vca.cv.adsr`]],[`MIXER & OUTPUT`,[`mix.vcf`,`mix.vca`,`reverb.left`,`reverb.right`,`mix.pan`,`out.volume`]],[`KEYBOARD & LFO`,[`kb.voice`,`kb.trig`,`kb.repeat`,`kb.portaOn`,`kb.porta`,`lfo.speed`,`lfo.delay`,`lfo.depth`]],[`RING MOD & NOISE`,[`ring.mode`,`ring.a`,`ring.b`,`noise.color`,`noise.level`]],[`SAMPLE & HOLD`,[`sh.level`,`sh.rate`]],[`PREAMP & PROCESSORS`,[`pre.range`,`pre.gain`,`envf.gain`,`vp.2`,`vp.4`,`vp.6`,`vp.lag`]]];function Cl(e){let t=G(`div`,`m26-mobile`),n=gl(e,`m26-patch-mobile`),r=G(`div`,`m26-patch-row`);r.append(n.buttons[0],n.name,n.buttons[1],n.buttons[2]);let i=fl(`AR manual gate`,t=>e.setManual(t));i.classList.add(`m26-manual-mobile`),i.textContent=`AR MANUAL`;let a=G(`div`,`m26-patch-row`);a.append(yl(e),i),t.append(r,a,vl(e));for(let[n,r]of Sl)t.append(wl(e,n,r));return t.append(...qc(e)),t}function wl(e,t,n){let r=G(`section`,`m26-card`);r.append(G(`h2`,`m26-card-title`,t));for(let i of n){let n=e.control(i),a=G(`div`,`m26-item`);if(n.kind===`number`){let e=G(`span`,`m26-item-label`,n.label),r=G(`span`,`m26-item-value`),i=()=>{r.textContent=sl(n)};n.onChange(i),i(),a.append(e,r,ul(n,t,!1))}else{a.classList.add(`m26-item-choice`),a.append(G(`span`,`m26-item-label`,n.label));let e=n.kind===`choice`?n.options:[`off`,`on`],r=G(`div`,`m26-seg`);r.setAttribute(`role`,`group`),r.setAttribute(`aria-label`,`${t} ${n.label}`);let i=e.map(e=>{let t=G(`button`,`m26-seg-btn`,e.toUpperCase());return t.type=`button`,t.addEventListener(`click`,()=>n.kind===`choice`?n.set(e):n.set(e===`on`)),r.append(t),[e,t]}),o=()=>i.forEach(([e,t])=>{let r=n.kind===`choice`?n.value===e:e===`on`===n.value;t.classList.toggle(`on`,r),t.setAttribute(`aria-pressed`,String(r))});n.onChange(o),o(),a.append(r)}r.append(a)}return r}function Tl(e,t){let n=G(`div`,`m26-case`),r=new xl;return n.append(bl(e,r),Cl(e)),t&&r.start(t),n}var El=new _,Dl=vs.m2600(),Ol=Dl.device(`m2600`),kl=new ke(Dl);$c(Ol),Ol.loadSlot(Ol.currentSlot);var Al=document.createElement(`div`);Al.className=`m26-wrap`,Al.append(Tl(Ol,kl),Lc(Ol)),Sc({id:`m2600`,patch:Dl,engine:kl,clock:El,self:`/2600/`,panel:Al,ports:[{device:`m2600`,jack:`out`,name:`MOA-2600`}],onMidi:e=>Ol.handleMidi(e)});