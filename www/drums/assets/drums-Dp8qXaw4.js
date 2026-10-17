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
`,n=[`chrom`,`major`,`minor`,`pent`,`dorian`,`blues`],r={chrom:[0,1,2,3,4,5,6,7,8,9,10,11],major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10],pent:[0,3,5,7,10],dorian:[0,2,3,5,7,9,10],blues:[0,3,5,6,7,10]},i={"1/4":24,"1/8":12,"1/8T":8,"1/16":6,"1/16T":4},a=(e,t,n,r,i,a=``,o=`linear`)=>({id:e,label:t,kind:`number`,min:n,max:r,def:i,unit:a,curve:o}),o=(e,t,n,r)=>({id:e,label:t,kind:`choice`,min:0,max:n.length-1,def:n.indexOf(r),options:n}),s=[.2,.35,.5,.35,.2,.6,.5,.35,.2,.35,.5,.7,.6,.5,.35,.2],c=[...Array.from({length:16},(e,t)=>a(`sq.step.${t+1}`,`Step ${t+1}`,0,1,s[t])),...Array.from({length:16},(e,t)=>o(`sq.gate.${t+1}`,`Step ${t+1} gate`,[`off`,`1`,`2`,`3`],`1`)),o(`sq.mode`,`Steps`,[`16`,`8x2`],`16`),o(`sq.dir`,`Direction`,[`fwd`,`rev`,`pingpong`,`random`],`fwd`),o(`sq.skip`,`Bus 3 does`,[`skip`,`off`,`reset`],`off`),o(`sq.trig`,`Start/stop input`,[`trig`,`gate`],`trig`),a(`sq.rate`,`Clock frequency`,.2,40,6,`Hz`,`log`),a(`sq.fm`,`Clock FM`,0,1,0),a(`sq.pw`,`Pulse width`,.05,.95,.5),o(`sq.scale`,`Quantizer scale`,n,`chrom`),o(`sq.range`,`Quantizer range`,[`1`,`2`,`4`],`2`),o(`sq.sync`,`Clock source`,[`int`,`midi`],`int`),o(`sq.div`,`MIDI division`,Object.keys(i),`1/16`)],l=[`sq.a`,`sq.b`,`sq.qa`,`sq.qb`,`sq.bus1`,`sq.bus2`,`sq.bus3`,`sq.pos1`,`sq.cgate1`,`sq.clk`],u=[{id:`sq.cvin`},{id:`sq.ina`,normal:`sq.a`},{id:`sq.inb`,normal:`sq.b`},{id:`sq.start`},{id:`sq.stop`},{id:`sq.startstop`},{id:`sq.stepin`},{id:`sq.resetin`},{id:`sq.fmin`,slider:`sq.fm`},{id:`sq.pwm`},{id:`sq.extclk`}],d=(e,t,n,r,i,a=``,o=`linear`)=>({id:e,label:t,kind:`number`,min:n,max:r,def:i,unit:a,curve:o}),f=(e,t,n,r)=>({id:e,label:t,kind:`choice`,min:0,max:n.length-1,def:n.indexOf(r),options:n}),p=(e,t,n=0)=>({id:e,label:t,kind:`toggle`,min:0,max:1,def:n}),m=(e,t,n=0)=>d(e,t,0,1,n),h=[d(`kb.porta`,`Portamento`,0,1,.25),p(`kb.portaOn`,`Portamento on`,0),f(`kb.voice`,`Voice mode`,[`mono`,`duo`],`mono`),f(`kb.repeat`,`Repeat`,[`kybd`,`off`,`auto`],`off`),f(`kb.trig`,`Trigger mode`,[`single`,`multi`],`multi`),d(`lfo.speed`,`LFO speed`,.1,30,5,`Hz`,`log`),d(`lfo.delay`,`Vibrato delay`,0,3,0,`s`),m(`lfo.depth`,`Vibrato depth`,0),m(`pre.gain`,`Preamp gain`,.5),f(`pre.range`,`Preamp range`,[`x10`,`x100`,`x1000`],`x10`),m(`envf.gain`,`Env follower gain`,.5),f(`ring.mode`,`Ring mod mode`,[`audio`,`dc`],`audio`),m(`ring.a`,`Ring mod A level`,1),m(`ring.b`,`Ring mod B level`,1),m(`noise.color`,`Noise color`,0),m(`noise.level`,`Noise level`,.8),d(`vco1.freq`,`Initial frequency`,10,1e4,261.63,`Hz`,`log`),d(`vco1.fine`,`Fine tune`,-6,6,0,`st`),d(`vco1.pw`,`Pulse width`,.1,.9,.5),f(`vco1.range`,`Range`,[`audio`,`lf`],`audio`),m(`vco1.fm.sh`,`FM S/H`),m(`vco1.fm.adsr`,`FM ADSR`),m(`vco1.fm.lfo`,`FM LFO`),d(`vco2.freq`,`Initial frequency`,10,1e4,261.63,`Hz`,`log`),d(`vco2.fine`,`Fine tune`,-6,6,0,`st`),d(`vco2.pw`,`Pulse width`,.1,.9,.5),f(`vco2.range`,`Range`,[`audio`,`lf`],`audio`),p(`vco2.sync`,`Sync to VCO 1`),m(`vco2.fm.sh`,`FM S/H`),m(`vco2.fm.adsr`,`FM ADSR`),m(`vco2.fm.vco1`,`FM VCO 1`),m(`vco2.pwm`,`PWM noise`),d(`vco3.freq`,`Initial frequency`,10,1e4,261.63,`Hz`,`log`),d(`vco3.fine`,`Fine tune`,-6,6,0,`st`),d(`vco3.pw`,`Pulse width`,.1,.9,.5),f(`vco3.range`,`Range`,[`audio`,`lf`],`audio`),p(`vco3.sync`,`Sync to VCO 1`),m(`vco3.fm.noise`,`FM noise`),m(`vco3.fm.adsr`,`FM ADSR`),m(`vco3.fm.vco2`,`FM VCO 2`),m(`vco3.pwm`,`PWM ADSR`),d(`vcf.freq`,`Initial frequency`,10,16e3,1200,`Hz`,`log`),d(`vcf.fine`,`Fine tune`,-1,1,0,`oct`),m(`vcf.res`,`Resonance`,0),f(`vcf.mode`,`Mode`,[`4012`,`4072`],`4072`),m(`vcf.in.ring`,`Audio ring mod`),m(`vcf.in.vco1`,`Audio VCO 1`,.8),m(`vcf.in.vco2`,`Audio VCO 2`),m(`vcf.in.vco3`,`Audio VCO 3`),m(`vcf.in.noise`,`Audio noise`),m(`vcf.cv.kybd`,`Control keyboard`,1),m(`vcf.cv.adsr`,`Control ADSR`,.3),m(`vcf.cv.vco2`,`Control VCO 2`),d(`sem.freq`,`Frequency`,10,16e3,16e3,`Hz`,`log`),m(`sem.res`,`Resonance`,0),m(`sem.mode`,`LP / notch / HP`,0),p(`sem.bp`,`Band pass`),m(`sem.in.vco1`,`Audio VCO 1`),m(`sem.in.vco2`,`Audio VCO 2`),m(`sem.in.vco3`,`Audio VCO 3`),m(`sem.in.noise`,`Audio noise`),m(`sem.cv.kybd`,`Control keyboard`,1),m(`sem.cv.adsr`,`Control ADSR`),m(`sem.cv.lfo`,`Control LFO`),d(`adsr.attack`,`Attack`,.001,10,.005,`s`,`log`),d(`adsr.decay`,`Decay`,.002,10,.4,`s`,`log`),m(`adsr.sustain`,`Sustain`,.6),d(`adsr.release`,`Release`,.002,10,.3,`s`,`log`),f(`adsr.factor`,`Time factor`,[`x0.5`,`x1`,`x2`],`x1`),d(`ar.attack`,`Attack`,.001,10,.005,`s`,`log`),d(`ar.release`,`Release`,.002,10,.3,`s`,`log`),f(`ar.factor`,`Time factor`,[`x0.5`,`x1`,`x2`],`x1`),f(`ar.source`,`AR gate`,[`kybd`,`sh`],`kybd`),m(`vca.gain`,`Initial gain`,0),m(`vca.in.vcf`,`Audio VCF`,.8),m(`vca.in.sem`,`Audio SEM`),m(`vca.in.ring`,`Audio ring mod`),m(`vca.cv.ar`,`Control AR (lin)`),m(`vca.cv.adsr`,`Control ADSR (exp)`,1),m(`vp.2`,`Processor 2 (-10 V)`),m(`vp.4`,`Processor 4 (KYBD CV)`),m(`vp.6`,`Processor 6 (+10 V)`),m(`vp.lag`,`Lag time`,.3),m(`sh.level`,`S/H input level`,1),d(`sh.rate`,`S/H clock rate`,.1,50,6,`Hz`,`log`),m(`mix.vcf`,`Mixer VCF`),m(`mix.vca`,`Mixer VCA`,.8),m(`reverb.left`,`Reverb left`,.15),m(`reverb.right`,`Reverb right`,.15),d(`mix.pan`,`Pan`,-1,1,0),m(`out.volume`,`Volume`,.8),...c],g=[d(`bend`,`Bend`,-2,2,0,`st`),m(`modw`,`Mod wheel`)],_=new Set(h.filter(e=>e.kind!==`number`).map(e=>e.id)),v=[`kb.cv`,`kb.upper`,`kb.gate`,`kb.trig`,`lfo.tri`,`lfo.square`,`lfo.delayed`,`pre.out`,`envf.out`,`ring.out`,`noise.out`,`vco1.saw`,`vco1.pulse`,`vco2.tri`,`vco2.saw`,`vco2.sine`,`vco2.pulse`,`vco3.tri`,`vco3.saw`,`vco3.sine`,`vco3.pulse`,`vcf.out`,`sem.out`,`adsr.out`,`ar.out`,`vca.out`,`mix.out`,`reverb.out`,`vp.inv1`,`vp.inv2`,`vp.lag`,`sh.out`,`sh.clk`,`esw.c`,...l],y=[{id:`kb.extvib`},{id:`pre.in`},{id:`envf.in`,normal:`pre.out`,slider:`envf.gain`},{id:`ring.a`,normal:`vco1.saw`,slider:`ring.a`},{id:`ring.b`,normal:`vco2.tri`,slider:`ring.b`},{id:`vco1.fm.kybd`,normal:`kb.cv`},{id:`vco1.fm.sh`,normal:`sh.out`,slider:`vco1.fm.sh`},{id:`vco1.fm.adsr`,normal:`adsr.out`,slider:`vco1.fm.adsr`},{id:`vco1.fm.lfo`,normal:`lfo.tri`,slider:`vco1.fm.lfo`},{id:`vco2.fm.kybd`,normal:`kb.upper`},{id:`vco2.fm.sh`,normal:`sh.out`,slider:`vco2.fm.sh`},{id:`vco2.fm.adsr`,normal:`adsr.out`,slider:`vco2.fm.adsr`},{id:`vco2.fm.vco1`,normal:`vco1.pulse`,slider:`vco2.fm.vco1`},{id:`vco2.pwm`,normal:`noise.out`,slider:`vco2.pwm`},{id:`vco3.fm.kybd`,normal:`kb.upper`},{id:`vco3.fm.noise`,normal:`noise.out`,slider:`vco3.fm.noise`},{id:`vco3.fm.adsr`,normal:`adsr.out`,slider:`vco3.fm.adsr`},{id:`vco3.fm.vco2`,normal:`vco2.sine`,slider:`vco3.fm.vco2`},{id:`vco3.pwm`,normal:`adsr.out`,slider:`vco3.pwm`},{id:`vcf.in.ring`,normal:`ring.out`,slider:`vcf.in.ring`},{id:`vcf.in.vco1`,normal:`vco1.pulse`,slider:`vcf.in.vco1`},{id:`vcf.in.vco2`,normal:`vco2.pulse`,slider:`vcf.in.vco2`},{id:`vcf.in.vco3`,normal:`vco3.saw`,slider:`vcf.in.vco3`},{id:`vcf.in.noise`,normal:`noise.out`,slider:`vcf.in.noise`},{id:`vcf.cv.kybd`,normal:`kb.cv`,slider:`vcf.cv.kybd`},{id:`vcf.cv.adsr`,normal:`adsr.out`,slider:`vcf.cv.adsr`},{id:`vcf.cv.vco2`,normal:`vco2.sine`,slider:`vcf.cv.vco2`},{id:`sem.in.vco1`,normal:`vco1.saw`,slider:`sem.in.vco1`},{id:`sem.in.vco2`,normal:`vco2.saw`,slider:`sem.in.vco2`},{id:`sem.in.vco3`,normal:`vco3.pulse`,slider:`sem.in.vco3`},{id:`sem.in.noise`,normal:`noise.out`,slider:`sem.in.noise`},{id:`sem.cv.kybd`,normal:`kb.cv`,slider:`sem.cv.kybd`},{id:`sem.cv.adsr`,normal:`adsr.out`,slider:`sem.cv.adsr`},{id:`sem.cv.lfo`,normal:`lfo.tri`,slider:`sem.cv.lfo`},{id:`adsr.gate`,normal:`kb.gate`},{id:`adsr.trig`,normal:`kb.trig`},{id:`ar.gate`,normal:`kb.gate`},{id:`vca.in.vcf`,normal:`vcf.out`,slider:`vca.in.vcf`},{id:`vca.in.sem`,normal:`sem.out`,slider:`vca.in.sem`},{id:`vca.in.ring`,normal:`ring.out`,slider:`vca.in.ring`},{id:`vca.cv.ar`,normal:`ar.out`,slider:`vca.cv.ar`},{id:`vca.cv.adsr`,normal:`adsr.out`,slider:`vca.cv.adsr`},{id:`mix.in.vcf`,normal:`vcf.out`,slider:`mix.vcf`},{id:`mix.in.vca`,normal:`vca.out`,slider:`mix.vca`},{id:`vp.1`},{id:`vp.2`,normal:`-10V`,slider:`vp.2`},{id:`vp.3`},{id:`vp.4`,normal:`kb.cv`,slider:`vp.4`},{id:`vp.5`},{id:`vp.6`,normal:`+10V`,slider:`vp.6`},{id:`vp.7`,normal:`envf.out`},{id:`sh.in`,normal:`noise.out`,slider:`sh.level`},{id:`sh.extclk`},{id:`esw.a`},{id:`esw.b`},{id:`out.left`},{id:`out.right`},...u],b=`moa-duo`,x=`
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
  registerProcessor('${b}', MoaDuo);
}
`,S=`moa-granular`,C=`
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
  registerProcessor('${S}', MoaGranular);
}
`,ee=n.map(e=>r[e]),te=`
const M26_SQ_STEPS = 16;
const M26_SQ_SCALES = ${JSON.stringify(ee)};
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
`,ne=`moa-2600`,re=[...h,...g].map(e=>[e.id,e.def,e.min,e.max]),ie=y.map(e=>({id:e.id,normal:e.normal??null})),ae=`
const M26_TWO_PI = Math.PI * 2;
// name, default, min, max
const M26_PARAM_DEFS = ${JSON.stringify(re)};
const M26_DEFAULTS = {};
for (const d of M26_PARAM_DEFS) M26_DEFAULTS[d[0]] = d[1];
const M26_OUTPUTS = ${JSON.stringify(v)};
const M26_INPUTS = ${JSON.stringify(ie)};
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

${te}
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
  registerProcessor('${ne}', Moa2600);
}
`,oe=`moa-pipe`,se=`moa-spring`,ce=`
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
  registerProcessor('${oe}', MoaPipe);

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
  registerProcessor('${se}', MoaSpring);
}
`,le=.01,ue=class{patch;ctx;compiled=new Map;monitor;monitorOn=!0;compressors=new Map;grainViews=new Map;pipeViews=new Map;dfViews=new Map;duoViews=new Map;m2600Views=new Map;meters=new Map;constructor(e){this.patch=e}async start(){if(!this.ctx){let e=new AudioContext;await e.audioWorklet.addModule(ze()),this.build(e)}await this.ctx?.resume()}async stop(){await this.ctx?.suspend()}get context(){return this.ctx}setMonitor(e){this.monitorOn=e,this.monitor&&this.ctx&&this.monitor.gain.setTargetAtTime(+!!e,this.ctx.currentTime,.02)}jackNode(e,t,n){let r=this.patch.device(e).jack(t,n).nodeId;return this.compiled.get(e)?.get(r)}setCable(e,t,n){let r=this.jackNode(e.device,`out`,e.jack),i=this.jackNode(t.device,`in`,t.jack);r&&i&&(n?r.connect(i):r.disconnect(i))}get currentTime(){return this.ctx?.currentTime??0}readLevel(e,t){let n=this.meters.get(`${e}/${t}`);if(!n)return 0;n.analyser.getFloatTimeDomainData(n.buffer);let r=0;for(let e of n.buffer)r=Math.max(r,Math.abs(e));return r}readGranular(e,t){return this.grainViews.get(`${e}/${t}`)}readPipe(e,t){return this.pipeViews.get(`${e}/${t}`)}readDF(e,t){return this.dfViews.get(`${e}/${t}`)}readM2600(e,t){return this.m2600Views.get(`${e}/${t}`)}readDuo(e,t){return this.duoViews.get(`${e}/${t}`)}readReduction(e,t){return this.compressors.get(`${e}/${t}`)?.reduction??0}build(e){this.ctx=e;let t=new Map;for(let[n,r]of this.patch.devices)t.set(n,this.compileCircuit(e,n,r.circuit));this.compiled=t;let n=(e,n,r)=>{let i=this.patch.device(e).jack(n,r).nodeId,a=t.get(e)?.get(i);if(!a)throw Error(`No audio node for ${e}.${r}`);return a};for(let e of this.patch.connections)n(e.from.device,`out`,e.from.jack).connect(n(e.to.device,`in`,e.to.jack));if(this.patch.output){this.monitor=e.createGain(),this.monitor.gain.value=+!!this.monitorOn,this.monitor.connect(e.destination);for(let{device:e,jack:t}of[this.patch.output,...this.patch.extraOutputs])n(e,`out`,t).connect(this.monitor)}}compileCircuit(t,n,r){let i=new Map;for(let a of r.nodes.values())switch(a.kind){case`oscillator`:{let e=t.createOscillator();e.type=a.options.waveform,e.frequency.value=a.params.frequency??440,e.detune.value=a.params.detune??0,e.start(),i.set(a.id,e);break}case`filter`:{let e=t.createBiquadFilter();e.type=a.options.type,e.frequency.value=a.params.frequency??350,e.Q.value=a.params.Q??1,e.gain.value=a.params.gain??0,e.detune.value=a.params.detune??0,i.set(a.id,e);break}case`envelope`:{let e=t.createConstantSource();e.offset.value=0,e.start(),i.set(a.id,e);break}case`convolver`:{let e=t.createConvolver();e.buffer=Ae(t,ke[a.options.size??`medium`]??ke.medium),i.set(a.id,e);break}case`follower`:{let e=new AudioWorkletNode(t,Le,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],parameterData:{attack:a.params.attack??.003,release:a.params.release??.12}});i.set(a.id,e);break}case`granular`:{let{maxTime:e,...r}=a.params,o=new AudioWorkletNode(t,S,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],parameterData:r,processorOptions:{seconds:e??20}});o.port.onmessage=e=>this.grainViews.set(`${n}/${a.id}`,e.data),i.set(a.id,o);break}case`pipe`:{let e=new AudioWorkletNode(t,oe,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params});e.port.onmessage=e=>this.pipeViews.set(`${n}/${a.id}`,e.data),i.set(a.id,e);break}case`spring`:i.set(a.id,new AudioWorkletNode(t,se,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params}));break;case`df`:{let r=new AudioWorkletNode(t,e,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:`explicit`,parameterData:a.params});r.port.onmessage=e=>this.dfViews.set(`${n}/${a.id}`,e.data),i.set(a.id,r);break}case`duo`:{let e=new AudioWorkletNode(t,b,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params});e.port.onmessage=e=>this.duoViews.set(`${n}/${a.id}`,e.data),i.set(a.id,e);break}case`m2600`:{let e=new AudioWorkletNode(t,ne,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params,processorOptions:{cords:JSON.parse(a.options.cords??`[]`)}});e.port.onmessage=e=>this.m2600Views.set(`${n}/${a.id}`,e.data),i.set(a.id,e);break}case`compressor`:{let e=t.createDynamicsCompressor();this.compressors.set(`${n}/${a.id}`,e),e.threshold.value=a.params.threshold??-24,e.knee.value=a.params.knee??30,e.ratio.value=a.params.ratio??12,e.attack.value=a.params.attack??.003,e.release.value=a.params.release??.25,i.set(a.id,e);break}case`delay`:{let e=t.createDelay(a.params.maxTime??1);e.delayTime.value=a.params.delayTime??.25,i.set(a.id,e);break}case`trigger`:{let e=t.createConstantSource();e.offset.value=0,e.start(),i.set(a.id,e);break}case`constant`:{let e=t.createConstantSource();e.offset.value=a.params.offset??0,e.start(),i.set(a.id,e);break}case`waveshaper`:{let e=t.createWaveShaper();a.options.curve===`pulse`?e.curve=Se():a.options.curve===`soft`?e.curve=we():a.options.curve===`limit`?e.curve=Te():a.options.curve===`warm`?e.curve=Ee():a.options.curve===`abs`?e.curve=De():a.options.curve===`crush`&&(e.curve=Oe(a.params.bits??16)),e.oversample=`4x`,i.set(a.id,e);break}case`noise`:{let e=t.createBufferSource();e.buffer=je(t),e.loop=!0,e.start(),i.set(a.id,e);break}case`random`:{let e=t.createBufferSource();e.buffer=Fe(t),e.loop=!0,e.playbackRate.value=(a.params.rate??4)/Ne,e.start(),i.set(a.id,e);break}case`meter`:{let e=t.createAnalyser();e.fftSize=1024;let r=a.options.channel??`mono`;if(r===`mono`)i.set(a.id,e);else{let n=t.createChannelSplitter(2);n.connect(e,r===`left`?0:1),i.set(a.id,n)}this.meters.set(`${n}/${a.id}`,{analyser:e,buffer:new Float32Array(new ArrayBuffer(e.fftSize*4))});break}case`pan`:{let e=t.createStereoPanner();e.pan.value=a.params.pan??0,i.set(a.id,e);break}case`gain`:{let e=t.createGain();e.gain.value=a.params.gain??1,a.options.channels===`mono`&&(e.channelCount=1,e.channelCountMode=`explicit`),i.set(a.id,e);break}}for(let e of r.cables){let t=i.get(e.from),n=i.get(e.to);if(t&&n){if(e.port===`in`)t.connect(n);else{let r=de(n,e.port);r&&t.connect(r)}}}return r.onChange(e=>{let n=i.get(e.nodeId);if(!n)return;if(e.type===`note`||e.type===`gate`||e.type===`play`){n instanceof AudioWorkletNode&&n.port.postMessage(e);return}if(e.type===`message`){n instanceof AudioWorkletNode&&n.port.postMessage(e.data);return}if(e.type===`trigger`||e.type===`choke`){n instanceof ConstantSourceNode&&(e.type===`trigger`?be(t,n.offset,r.node(e.nodeId).params,r.node(e.nodeId).options.shape,e.velocity,e.when):xe(t,n.offset,e.when));return}if(r.node(e.nodeId).kind===`trigger`)return;if(n instanceof WaveShaperNode&&e.type===`param`&&e.name===`bits`){n.curve=Oe(e.value);return}if(r.node(e.nodeId).kind===`envelope`){n instanceof ConstantSourceNode&&e.type===`param`&&e.name===`gate`&&he(t,n.offset,r.node(e.nodeId).params,e.value>0);return}if(n instanceof AudioBufferSourceNode&&e.type===`param`&&e.name===`rate`){n.playbackRate.setTargetAtTime(e.value/Ne,t.currentTime,le);return}if(e.type===`option`){n instanceof OscillatorNode&&e.name===`waveform`||n instanceof BiquadFilterNode&&e.name===`type`?n.type=e.value:n instanceof ConvolverNode&&e.name===`size`&&(n.buffer=Ae(t,ke[e.value]??ke.medium));return}let a=de(n,e.name);r.node(e.nodeId).kind===`m2600`&&_.has(e.name)||r.node(e.nodeId).kind===`duo`&&pe.test(e.name)||r.node(e.nodeId).kind===`df`&&me.test(e.name)?a?.setValueAtTime(e.value,t.currentTime):a?.setTargetAtTime(e.value,t.currentTime,Ie(r,e.nodeId,e.name))}),i}};function de(e,t){if(e instanceof AudioWorkletNode)return e.parameters.get(t);let n=e[t];return n instanceof AudioParam?n:void 0}var fe=.001,pe=/Wave$|Sync$|Route$|Hold$|Lfo$|Off$/,me=/Type$|Src$|Inv$|Vca$|Gate$|Loop$|Exp$|Trig$|Link$|^mono$/;function he(e,t,n,r){let i=e.currentTime;if(t.cancelScheduledValues(i),t.setValueAtTime(t.value,i),r){let e=Math.max(n.attack??.01,fe);t.linearRampToValueAtTime(1,i+e),t.setTargetAtTime(n.sustain??.7,i+e,Math.max(n.decay??.2,fe)/3)}else t.setTargetAtTime(0,i,Math.max(n.release??.3,fe)/3)}var ge=.001,_e=3,ve=.0035,ye=.005;function be(e,t,n,r,i,a){let o=n.velSens??1,s=(n.peak??1)*(1-o+o*i),c=Math.max(n.decay??.2,fe)/4,l=Math.max(a??0,e.currentTime);if(t.cancelScheduledValues(l),t.setValueAtTime(t.value,l),t.linearRampToValueAtTime(s,l+ge),r!==`clap`){t.setTargetAtTime(0,l+ge,c);return}let u=Math.max(n.spread??.012,.002);t.setTargetAtTime(0,l+ge,ve);for(let e=1;e<=_e;e++){let n=l+e*u;t.setValueAtTime(s,n),t.setTargetAtTime(0,n,e===_e?c:ve)}}function xe(e,t,n){let r=Math.max(n??0,e.currentTime);t.cancelScheduledValues(r),t.setValueAtTime(t.value,r),t.setTargetAtTime(0,r,ye)}function Se(){let e=1024,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++)t[n]=n<e/2?-1:1;return t}var Ce=2.5;function we(){let e=2048,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++){let e=n/2047*2-1;t[n]=Math.tanh(Ce*e)/Math.tanh(Ce)}return t}function Te(){let e=4097,t=new Float32Array(new ArrayBuffer(e*4)),n=.9;for(let r=0;r<e;r++){let e=r/4096*2-1,i=Math.abs(e);t[r]=Math.sign(e)*(i<n?i:n+.09999999999999998*Math.tanh((i-n)/.09999999999999998))}return t}function Ee(){let e=4097,t=new Float32Array(new ArrayBuffer(e*4)),n=.6;for(let r=0;r<e;r++){let e=r/4096*2-1,i=Math.abs(e)*3;t[r]=Math.sign(e)*(i<n?i:n+.4*Math.tanh((i-n)/.4))}return t}function De(){let e=1025,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++)t[n]=Math.abs(n/1024*2-1);return t}function Oe(e){let t=8193,n=new Float32Array(new ArrayBuffer(t*4)),r=2**Math.max(1,Math.min(16,e))/2;for(let e=0;e<t;e++){let t=e/8192*2-1;n[e]=Math.round(t*r)/r}return n}var ke={small:.9,medium:2.4,large:5};function Ae(e,t){let n=e.sampleRate,r=Math.floor(n*t),i=e.createBuffer(2,r,n),a=Math.log(1e3)/t;for(let e=0;e<2;e++){let t=i.getChannelData(e),o=0;for(let e=0;e<r;e++){let r=e/n,i=Math.exp(-a*r)*Math.min(1,r/.004),s=.75*Math.exp(-r*1.2)+.06;o+=s*(Math.random()*2-1-o),t[e]=o*i}}return i}function je(e){let t=e.createBuffer(1,e.sampleRate*2,e.sampleRate),n=t.getChannelData(0);for(let e=0;e<n.length;e++)n[e]=Math.random()*2-1;return t}var Me=64,Ne=10,Pe=8e3;function Fe(e){let t=Pe/Ne,n=e.createBuffer(1,Me*t,Pe),r=n.getChannelData(0);for(let e=0;e<Me;e++)r.fill(Math.random()*2-1,e*t,(e+1)*t);return n}function Ie(e,t,n){let r=e.node(t);return r.kind===`constant`&&n===`offset`&&r.params.glide?Math.max(r.params.glide/3,le):le}var Le=`moa-follower`,Re=[`
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
registerProcessor('${Le}', MoaFollower);
`,C,ce,t,x,ae].join(`
`);function ze(){return URL.createObjectURL(new Blob([Re],{type:`text/javascript`}))}var Be=class{nodes=new Map;cables=[];listeners=new Set;add(e,t,n={},r={}){if(this.nodes.has(e))throw Error(`Duplicate node id: ${e}`);return this.nodes.set(e,{id:e,kind:t,params:{...n},options:{...r}}),this}connect(e,t,n=`in`){this.node(e);let r=this.node(t);if(n!==`in`&&!(n in r.params))throw Error(`Node ${t} has no param ${n}`);if(this.cables.some(r=>r.from===e&&r.to===t&&r.port===n))throw Error(`Duplicate cable ${e} -> ${t}.${n}`);return this.cables.push({from:e,to:t,port:n}),this}setParam(e,t,n){let r=this.node(e);if(!(t in r.params))throw Error(`Node ${e} has no param ${t}`);r.params[t]=n,this.emit({type:`param`,nodeId:e,name:t,value:n})}setOption(e,t,n){let r=this.node(e);if(!(t in r.options))throw Error(`Node ${e} has no option ${t}`);r.options[t]=n,this.emit({type:`option`,nodeId:e,name:t,value:n})}trigger(e,t=1,n){this.expectKind(e,`trigger`),this.emit({type:`trigger`,nodeId:e,velocity:Math.min(1,Math.max(0,t)),when:n})}choke(e,t){this.expectKind(e,`trigger`),this.emit({type:`choke`,nodeId:e,when:t})}noteOn(e,t,n=1){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:t,velocity:Math.min(1,Math.max(0,n))})}noteOff(e,t){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:t,velocity:0})}allNotesOff(e){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:-1,velocity:0})}pedal(e,t){this.expectKind(e,`pipe`),this.emit({type:`note`,nodeId:e,note:-2,velocity:+!!t})}play(e,t,n,r,i){this.expectKind(e,`duo`,`m2600`),this.emit({type:`play`,nodeId:e,n1:t,n2:n,gate:r,retrig:i})}send(e,t){this.expectKind(e,`m2600`),this.emit({type:`message`,nodeId:e,data:t})}gate(e,t,n){this.expectKind(e,`df`),this.emit({type:`gate`,nodeId:e,target:t,on:n})}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}node(e){let t=this.nodes.get(e);if(!t)throw Error(`Unknown node: ${e}`);return t}expectKind(e,...t){if(!t.includes(this.node(e).kind))throw Error(`Node ${e} is not a ${t.join(` or `)}`)}emit(e){for(let t of this.listeners)t(e)}},w=class{circuit=new Be;controlList=[];inputList=[];outputList=[];meterList=[];get controls(){return this.controlList}get inputs(){return this.inputList}get outputs(){return this.outputList}get meters(){return this.meterList}control(e){let t=this.controlList.find(t=>t.id===e);if(!t)throw Error(`${this.name} has no control ${e}`);return t}jack(e,t){let n=(e===`in`?this.inputList:this.outputList).find(e=>e.name===t);if(!n)throw Error(`${this.name} has no ${e} jack ${t}`);return n}},Ve=class{listeners=new Set;onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}notify(){for(let e of this.listeners)e()}},T=class extends Ve{id;label;min;max;initial;unit;apply;curve;kind=`number`;current;constructor(e,t,n,r,i,a,o,s=`linear`){super(),this.id=e,this.label=t,this.min=n,this.max=r,this.initial=i,this.unit=a,this.apply=o,this.curve=s,this.current=He(this.initial,n,r),this.apply(this.current)}get value(){return this.current}set(e){this.current=He(e,this.min,this.max),this.apply(this.current),this.notify()}},E=class extends Ve{id;label;options;apply;kind=`choice`;current;constructor(e,t,n,r,i){if(super(),this.id=e,this.label=t,this.options=n,this.apply=i,!n.includes(r))throw Error(`Invalid initial choice ${r}`);this.current=r,this.apply(this.current)}get value(){return this.current}set(e){if(!this.options.includes(e))throw Error(`Invalid choice ${e} for ${this.id}`);this.current=e,this.apply(e),this.notify()}},D=class extends Ve{id;label;apply;kind=`toggle`;current;constructor(e,t,n,r){super(),this.id=e,this.label=t,this.apply=r,this.current=n,this.apply(n)}get value(){return this.current}set(e){this.current=e,this.apply(e),this.notify()}};function He(e,t,n){return Math.min(n,Math.max(t,e))}var Ue=24,We=48,Ge=12,Ke=1e3,qe=500,O=class{intervals=[];last;isRunning=!1;pulses=0;get running(){return this.isRunning}get ticks(){return this.pulses}get bpm(){if(this.intervals.length<Ge)return;let e=[...this.intervals].sort((e,t)=>e-t),t=Math.floor(e.length/4),n=e.slice(t,e.length-t);return 6e4/(n.reduce((e,t)=>e+t,0)/n.length*Ue)}isLocked(e){return this.last!==void 0&&this.intervals.length>=Ge&&e-this.last<qe}get position(){return Je(this.pulses)}handle(e,t){switch(e.type){case`clock`:if(this.last!==void 0){let e=t-this.last;e>Ke?this.intervals=[]:this.intervals.push(e),this.intervals.length>We&&this.intervals.shift()}this.last=t,this.isRunning&&this.pulses++;break;case`start`:this.isRunning=!0,this.pulses=0;break;case`continue`:this.isRunning=!0;break;case`stop`:this.isRunning=!1}}};function Je(e){return{bar:Math.floor(e/96)+1,beat:Math.floor(e/Ue)%4+1,sixteenth:Math.floor(e/(Ue/4))%4+1}}var Ye=[`internal`,`midi`],Xe=[`omni`,...Array.from({length:16},(e,t)=>String(t+1))],Ze=2e3,Qe=4,$e=class{clock;now;sync=new E(`transport.sync`,`Sync`,Ye,`internal`,()=>{});followStartStop=new D(`transport.followStartStop`,`Start/stop`,!0,()=>{});channel=new E(`transport.channel`,`Channel`,Xe,`1`,()=>{});tempo=new T(`transport.tempo`,`Tempo`,20,300,120,`BPM`,()=>{});taps=[];constructor(e,t=()=>performance.now()){this.clock=e,this.now=t}get synced(){return this.sync.value===`midi`}get bpm(){return this.synced?this.clock.bpm??this.tempo.value:this.tempo.value}get locked(){return this.synced&&this.clock.isLocked(this.now())}get running(){return this.synced&&this.followStartStop.value&&this.clock.running}get position(){return this.running?this.clock.position:Je(0)}acceptsChannel(e){return this.channel.value===`omni`||Number(this.channel.value)===e}tap(e=this.now()){let t=this.taps[this.taps.length-1];if(t!==void 0&&e-t>Ze&&(this.taps=[]),this.taps.push(e),this.taps.length>Qe&&this.taps.shift(),this.taps.length>=2){let e=this.taps[this.taps.length-1]-this.taps[0];this.tempo.set(Math.round(6e4/(e/(this.taps.length-1))*10)/10)}}nudge(e){this.tempo.set(Math.round((this.tempo.value+e)*10)/10)}},et=[`kick`,`snare`,`clap`,`closedHat`,`openHat`,`ride`],tt=[`rim`,`lowTom`,`midTom`,`highTom`,`cowbell`,`crash`],k=[...et,...tt],A=[...et,`perc`],nt={kick:`Kick`,snare:`Snare`,clap:`Clap`,closedHat:`Closed Hat`,openHat:`Open Hat`,ride:`Ride`,rim:`Rimshot`,lowTom:`Low Tom`,midTom:`Mid Tom`,highTom:`High Tom`,cowbell:`Cowbell`,crash:`Crash`},rt={...nt,perc:`Perc`},it={35:`kick`,36:`kick`,38:`snare`,40:`snare`,39:`clap`,42:`closedHat`,44:`closedHat`,46:`openHat`,51:`ride`,59:`ride`,37:`rim`,41:`lowTom`,43:`lowTom`,45:`midTom`,47:`midTom`,48:`highTom`,50:`highTom`,56:`cowbell`,49:`crash`,57:`crash`},at=1200,ot=[205.3,304.4,369.6,522.7,540,800],st=class extends w{name;transport;choke=new D(`hats.choke`,`Choke`,!0,()=>{});muted=new Set;soloed=new Set;envelopes=new Map;hitListeners=new Set;constructor(e=`Drums`,t=new O){super(),this.name=e,this.transport=new $e(t),this.transport.channel.set(`10`);let n=this.circuit;this.addKick(n),this.addSnare(n),this.addClap(n),this.addHat(n,`closedHat`,{decay:[.015,.25,.04],tone:.7,level:.6}),this.addHat(n,`openHat`,{decay:[.1,1.5,.32],tone:.65,level:.6}),this.addRide(n),this.addRim(n),this.addTom(n,`lowTom`,100),this.addTom(n,`midTom`,145),this.addTom(n,`highTom`,200),this.addCowbell(n),this.addCrash(n),n.add(`perc.out`,`gain`,{gain:1});for(let e of k)n.add(`${e}.mute`,`gain`,{gain:1}).add(`${e}.out`,`gain`,{gain:.8}).add(`${e}.meter`,`meter`,{},{channel:`mono`}).connect(`${e}.sum`,`${e}.mute`).connect(`${e}.mute`,`${e}.out`).connect(`${e}.out`,`${e}.meter`),this.meterList.push({name:e,nodeId:`${e}.meter`}),tt.includes(e)?n.connect(`${e}.out`,`perc.out`):this.outputList.push({name:e,nodeId:`${e}.out`});this.outputList.push({name:`perc`,nodeId:`perc.out`}),this.addLevels(n),this.controlList.push(this.choke)}trigger(e,t=1,n){if(!(t<=0)){e===`closedHat`&&this.choke.value&&this.circuit.choke(`openHat.ampEnv`,n);for(let r of this.envelopes.get(e)??[])this.circuit.trigger(r,t,n);for(let r of this.hitListeners)r(e,t,n)}}onHit(e){return this.hitListeners.add(e),()=>this.hitListeners.delete(e)}handleMidi(e){if(e.type!==`noteOn`||!this.transport.acceptsChannel(e.channel))return;let t=it[e.note];t&&this.trigger(t,e.velocity/127)}get soloActive(){return this.soloed.size>0}register(e,...t){this.envelopes.set(e,[...this.envelopes.get(e)??[],...t])}num(...e){let t=new T(...e);return this.controlList.push(t),t}addKick(e){this.register(`kick`,`kick.pitchEnv`,`kick.ampEnv`,`kick.clickEnv`),e.add(`kick.osc`,`oscillator`,{frequency:48,detune:0},{waveform:`sine`}).add(`kick.pitchEnv`,`trigger`,{peak:2700,decay:.05,velSens:0}).add(`kick.ampEnv`,`trigger`,{peak:.8,decay:.38,velSens:.8}).add(`kick.amp`,`gain`,{gain:0}).add(`kick.noise`,`noise`).add(`kick.clickHp`,`filter`,{frequency:2500,Q:.707},{type:`highpass`}).add(`kick.clickAmp`,`gain`,{gain:0}).add(`kick.clickEnv`,`trigger`,{peak:.24,decay:.012,velSens:1}).add(`kick.sum`,`gain`,{gain:1}).connect(`kick.pitchEnv`,`kick.osc`,`detune`).connect(`kick.osc`,`kick.amp`).connect(`kick.ampEnv`,`kick.amp`,`gain`).connect(`kick.amp`,`kick.sum`).connect(`kick.noise`,`kick.clickHp`).connect(`kick.clickHp`,`kick.clickAmp`).connect(`kick.clickEnv`,`kick.clickAmp`,`gain`).connect(`kick.clickAmp`,`kick.sum`),this.num(`kick.tune`,`Tune`,30,120,48,`Hz`,t=>e.setParam(`kick.osc`,`frequency`,t),`log`),this.num(`kick.decay`,`Decay`,.08,1,.38,`s`,t=>e.setParam(`kick.ampEnv`,`decay`,t),`log`),this.num(`kick.click`,`Click`,0,1,.4,``,t=>e.setParam(`kick.clickEnv`,`peak`,t*.6))}addSnare(e){this.register(`snare`,`snare.pitchEnv`,`snare.bodyEnv`,`snare.noiseEnv`),e.add(`snare.osc1`,`oscillator`,{frequency:190,detune:0},{waveform:`triangle`}).add(`snare.osc2`,`oscillator`,{frequency:347.7,detune:0},{waveform:`triangle`}).add(`snare.pitchEnv`,`trigger`,{peak:500,decay:.03,velSens:0}).add(`snare.bodyEnv`,`trigger`,{peak:.4,decay:.1,velSens:.7}).add(`snare.bodyAmp`,`gain`,{gain:0}).add(`snare.noise`,`noise`).add(`snare.noiseHp`,`filter`,{frequency:1800,Q:.707},{type:`highpass`}).add(`snare.noiseEnv`,`trigger`,{peak:.42,decay:.18,velSens:1}).add(`snare.noiseAmp`,`gain`,{gain:0}).add(`snare.sum`,`gain`,{gain:1}).connect(`snare.osc1`,`snare.bodyAmp`).connect(`snare.osc2`,`snare.bodyAmp`).connect(`snare.pitchEnv`,`snare.osc1`,`detune`).connect(`snare.pitchEnv`,`snare.osc2`,`detune`).connect(`snare.bodyEnv`,`snare.bodyAmp`,`gain`).connect(`snare.bodyAmp`,`snare.sum`).connect(`snare.noise`,`snare.noiseHp`).connect(`snare.noiseHp`,`snare.noiseAmp`).connect(`snare.noiseEnv`,`snare.noiseAmp`,`gain`).connect(`snare.noiseAmp`,`snare.sum`),this.num(`snare.tune`,`Tune`,120,300,190,`Hz`,t=>{e.setParam(`snare.osc1`,`frequency`,t),e.setParam(`snare.osc2`,`frequency`,t*1.83)},`log`),this.num(`snare.decay`,`Decay`,.08,.5,.18,`s`,t=>{e.setParam(`snare.noiseEnv`,`decay`,t),e.setParam(`snare.bodyEnv`,`decay`,t*.55)},`log`),this.num(`snare.snap`,`Snap`,0,1,.6,``,t=>e.setParam(`snare.noiseEnv`,`peak`,t*.7))}addClap(e){this.register(`clap`,`clap.env`),e.add(`clap.noise`,`noise`).add(`clap.bp`,`filter`,{frequency:1200,Q:1.5},{type:`bandpass`}).add(`clap.amp`,`gain`,{gain:0}).add(`clap.env`,`trigger`,{peak:2.3,decay:.24,velSens:.8,spread:.012},{shape:`clap`}).add(`clap.sum`,`gain`,{gain:1}).connect(`clap.noise`,`clap.bp`).connect(`clap.bp`,`clap.amp`).connect(`clap.env`,`clap.amp`,`gain`).connect(`clap.amp`,`clap.sum`),this.num(`clap.tone`,`Tone`,600,3e3,1200,`Hz`,t=>e.setParam(`clap.bp`,`frequency`,t),`log`),this.num(`clap.decay`,`Decay`,.08,.6,.24,`s`,t=>e.setParam(`clap.env`,`decay`,t),`log`),this.num(`clap.spread`,`Spread`,0,1,.5,``,t=>e.setParam(`clap.env`,`spread`,.006+t*.012))}addMetal(e,t,n,r,i,a){e.add(`${t}.tune`,`constant`,{offset:0}).add(`${t}.metal`,`gain`,{gain:a}).add(`${t}.bp`,`filter`,{frequency:r,Q:.8},{type:`bandpass`}).add(`${t}.hp`,`filter`,{frequency:i,Q:.707},{type:`highpass`}).connect(`${t}.metal`,`${t}.bp`).connect(`${t}.bp`,`${t}.hp`),ot.forEach((r,i)=>{let a=`${t}.sq${i+1}`;e.add(a,`oscillator`,{frequency:r*n,detune:0},{waveform:`square`}).connect(`${t}.tune`,a,`detune`).connect(a,`${t}.metal`)})}addHat(e,t,n){this.register(t,`${t}.ampEnv`),this.addMetal(e,t,1,9e3,7e3,.45),e.add(`${t}.amp`,`gain`,{gain:0}).add(`${t}.ampEnv`,`trigger`,{peak:1,decay:n.decay[2],velSens:.8}).add(`${t}.sum`,`gain`,{gain:1}).connect(`${t}.hp`,`${t}.amp`).connect(`${t}.ampEnv`,`${t}.amp`,`gain`).connect(`${t}.amp`,`${t}.sum`),this.num(`${t}.tune`,`Tune`,0,1,.6,``,n=>e.setParam(`${t}.tune`,`offset`,(n-.6)*2*at)),this.num(`${t}.decay`,`Decay`,n.decay[0],n.decay[1],n.decay[2],`s`,n=>e.setParam(`${t}.ampEnv`,`decay`,n),`log`),this.num(`${t}.tone`,`Tone`,0,1,n.tone,``,n=>e.setParam(`${t}.hp`,`frequency`,3e3+n*7e3))}addRide(e){this.register(`ride`,`ride.ampEnv`,`ride.bellEnv`),this.addMetal(e,`ride`,1.3,6500,2500,.18),e.add(`ride.amp`,`gain`,{gain:0}).add(`ride.ampEnv`,`trigger`,{peak:1,decay:1.2,velSens:.8}).add(`ride.bell1`,`oscillator`,{frequency:2650,detune:0},{waveform:`sine`}).add(`ride.bell2`,`oscillator`,{frequency:4380,detune:0},{waveform:`sine`}).add(`ride.bellAmp`,`gain`,{gain:0}).add(`ride.bellEnv`,`trigger`,{peak:.2,decay:.9,velSens:.8}).add(`ride.sum`,`gain`,{gain:1}).connect(`ride.hp`,`ride.amp`).connect(`ride.ampEnv`,`ride.amp`,`gain`).connect(`ride.amp`,`ride.sum`).connect(`ride.tune`,`ride.bell1`,`detune`).connect(`ride.tune`,`ride.bell2`,`detune`).connect(`ride.bell1`,`ride.bellAmp`).connect(`ride.bell2`,`ride.bellAmp`).connect(`ride.bellEnv`,`ride.bellAmp`,`gain`).connect(`ride.bellAmp`,`ride.sum`),this.num(`ride.tune`,`Tune`,0,1,.5,``,t=>e.setParam(`ride.tune`,`offset`,(t-.5)*2*at)),this.num(`ride.decay`,`Decay`,.4,2.5,1.2,`s`,t=>{e.setParam(`ride.ampEnv`,`decay`,t),e.setParam(`ride.bellEnv`,`decay`,t*.75)},`log`),this.num(`ride.bell`,`Bell`,0,1,.45,``,t=>e.setParam(`ride.bellEnv`,`peak`,t*.45))}addRim(e){this.register(`rim`,`rim.toneEnv`,`rim.clickEnv`),e.add(`rim.osc1`,`oscillator`,{frequency:480,detune:0},{waveform:`triangle`}).add(`rim.osc2`,`oscillator`,{frequency:1720,detune:0},{waveform:`sine`}).add(`rim.tune`,`constant`,{offset:0}).add(`rim.bp`,`filter`,{frequency:1600,Q:2.2},{type:`bandpass`}).add(`rim.toneAmp`,`gain`,{gain:0}).add(`rim.toneEnv`,`trigger`,{peak:1.4,decay:.03,velSens:.8}).add(`rim.noise`,`noise`).add(`rim.hp`,`filter`,{frequency:5e3,Q:.707},{type:`highpass`}).add(`rim.clickAmp`,`gain`,{gain:0}).add(`rim.clickEnv`,`trigger`,{peak:.3,decay:.008,velSens:1}).add(`rim.sum`,`gain`,{gain:1}).connect(`rim.tune`,`rim.osc1`,`detune`).connect(`rim.tune`,`rim.osc2`,`detune`).connect(`rim.osc1`,`rim.bp`).connect(`rim.osc2`,`rim.bp`).connect(`rim.bp`,`rim.toneAmp`).connect(`rim.toneEnv`,`rim.toneAmp`,`gain`).connect(`rim.toneAmp`,`rim.sum`).connect(`rim.noise`,`rim.hp`).connect(`rim.hp`,`rim.clickAmp`).connect(`rim.clickEnv`,`rim.clickAmp`,`gain`).connect(`rim.clickAmp`,`rim.sum`),this.num(`rim.tune`,`Tune`,0,1,.5,``,t=>e.setParam(`rim.tune`,`offset`,(t-.5)*2*at)),this.num(`rim.decay`,`Decay`,.01,.12,.03,`s`,t=>e.setParam(`rim.toneEnv`,`decay`,t),`log`),this.num(`rim.tone`,`Tone`,600,4e3,1600,`Hz`,t=>e.setParam(`rim.bp`,`frequency`,t),`log`)}addTom(e,t,n){this.register(t,`${t}.pitchEnv`,`${t}.ampEnv`,`${t}.noiseEnv`),e.add(`${t}.osc`,`oscillator`,{frequency:n,detune:0},{waveform:`sine`}).add(`${t}.pitchEnv`,`trigger`,{peak:700,decay:.09,velSens:0}).add(`${t}.ampEnv`,`trigger`,{peak:.9,decay:.4,velSens:.8}).add(`${t}.amp`,`gain`,{gain:0}).add(`${t}.noise`,`noise`).add(`${t}.bp`,`filter`,{frequency:n*4,Q:1.2},{type:`bandpass`}).add(`${t}.noiseAmp`,`gain`,{gain:0}).add(`${t}.noiseEnv`,`trigger`,{peak:.12,decay:.06,velSens:1}).add(`${t}.sum`,`gain`,{gain:1}).connect(`${t}.pitchEnv`,`${t}.osc`,`detune`).connect(`${t}.osc`,`${t}.amp`).connect(`${t}.ampEnv`,`${t}.amp`,`gain`).connect(`${t}.amp`,`${t}.sum`).connect(`${t}.noise`,`${t}.bp`).connect(`${t}.bp`,`${t}.noiseAmp`).connect(`${t}.noiseEnv`,`${t}.noiseAmp`,`gain`).connect(`${t}.noiseAmp`,`${t}.sum`),this.num(`${t}.tune`,`Tune`,n*.6,n*1.6,n,`Hz`,n=>{e.setParam(`${t}.osc`,`frequency`,n),e.setParam(`${t}.bp`,`frequency`,n*4)},`log`),this.num(`${t}.decay`,`Decay`,.1,1.2,.4,`s`,n=>e.setParam(`${t}.ampEnv`,`decay`,n),`log`),this.num(`${t}.bend`,`Bend`,0,1,.5,``,n=>e.setParam(`${t}.pitchEnv`,`peak`,n*1400))}addCowbell(e){this.register(`cowbell`,`cowbell.env`),e.add(`cowbell.tune`,`constant`,{offset:0}).add(`cowbell.sq1`,`oscillator`,{frequency:540,detune:0},{waveform:`square`}).add(`cowbell.sq2`,`oscillator`,{frequency:800,detune:0},{waveform:`square`}).add(`cowbell.bp`,`filter`,{frequency:2640,Q:1.4},{type:`bandpass`}).add(`cowbell.amp`,`gain`,{gain:0}).add(`cowbell.env`,`trigger`,{peak:.7,decay:.25,velSens:.8}).add(`cowbell.sum`,`gain`,{gain:1}).connect(`cowbell.tune`,`cowbell.sq1`,`detune`).connect(`cowbell.tune`,`cowbell.sq2`,`detune`).connect(`cowbell.sq1`,`cowbell.bp`).connect(`cowbell.sq2`,`cowbell.bp`).connect(`cowbell.bp`,`cowbell.amp`).connect(`cowbell.env`,`cowbell.amp`,`gain`).connect(`cowbell.amp`,`cowbell.sum`),this.num(`cowbell.tune`,`Tune`,0,1,.5,``,t=>e.setParam(`cowbell.tune`,`offset`,(t-.5)*at)),this.num(`cowbell.decay`,`Decay`,.05,1,.25,`s`,t=>e.setParam(`cowbell.env`,`decay`,t),`log`),this.num(`cowbell.tone`,`Tone`,1e3,6e3,2640,`Hz`,t=>e.setParam(`cowbell.bp`,`frequency`,t),`log`)}addCrash(e){this.register(`crash`,`crash.ampEnv`,`crash.noiseEnv`),this.addMetal(e,`crash`,1.15,8e3,4500,.35),e.add(`crash.amp`,`gain`,{gain:0}).add(`crash.ampEnv`,`trigger`,{peak:1,decay:1.6,velSens:.8}).add(`crash.noise`,`noise`).add(`crash.noiseHp`,`filter`,{frequency:6e3,Q:.707},{type:`highpass`}).add(`crash.noiseAmp`,`gain`,{gain:0}).add(`crash.noiseEnv`,`trigger`,{peak:.3,decay:1.2,velSens:.8}).add(`crash.sum`,`gain`,{gain:1}).connect(`crash.hp`,`crash.amp`).connect(`crash.ampEnv`,`crash.amp`,`gain`).connect(`crash.amp`,`crash.sum`).connect(`crash.noise`,`crash.noiseHp`).connect(`crash.noiseHp`,`crash.noiseAmp`).connect(`crash.noiseEnv`,`crash.noiseAmp`,`gain`).connect(`crash.noiseAmp`,`crash.sum`),this.num(`crash.tune`,`Tune`,0,1,.5,``,t=>e.setParam(`crash.tune`,`offset`,(t-.5)*2*at)),this.num(`crash.decay`,`Decay`,.5,4,1.6,`s`,t=>{e.setParam(`crash.ampEnv`,`decay`,t),e.setParam(`crash.noiseEnv`,`decay`,t*.75)},`log`),this.num(`crash.tone`,`Tone`,0,1,.5,``,t=>e.setParam(`crash.hp`,`frequency`,2500+t*6e3))}addLevels(e){let t={kick:.8,snare:.75,clap:.7,closedHat:.6,openHat:.6,ride:.55,rim:.6,lowTom:.7,midTom:.7,highTom:.7,cowbell:.5,crash:.5};for(let n of k)this.num(`${n}.level`,`Level`,0,1,t[n],``,t=>e.setParam(`${n}.out`,`gain`,t)),this.controlList.push(new D(`${n}.mute`,`Mute`,!1,e=>this.setFlag(this.muted,n,e)),new D(`${n}.solo`,`Solo`,!1,e=>this.setFlag(this.soloed,n,e)))}setFlag(e,t,n){n?e.add(t):e.delete(t);for(let e of k){let t=`${e}.mute`;if(!this.circuit.nodes.has(t))continue;let n=this.muted.has(e)||this.soloed.size>0&&!this.soloed.has(e);this.circuit.setParam(t,`gain`,+!n)}}},ct=[`A`,`B`,`C`,`D`],lt=[0,.4,.7,1],ut=lt.length-1,dt=6,ft=.12,pt=.05,mt=.1,ht=()=>Object.fromEntries(k.map(e=>[e,Array(16).fill(0)]));function gt(e,t){let n=ht();for(let r of k)for(let i of e[r]??[])n[r][i]=t?t(r,i):i%4==0?3:i%2==0?2:1;return n}function _t(){return[gt({kick:[0,4,8,10,12],snare:[4,12],clap:[12],closedHat:[0,2,4,6,8,10,12],openHat:[14],ride:[3,7,11,15]}),gt({kick:[0,4,8,12],clap:[4,12],closedHat:[0,4,8,12],openHat:[2,6,10,14]},(e,t)=>t%4==0?3:2),gt({kick:[0,6,10],snare:[4,7,12,15],closedHat:[0,2,4,6,8,10,12,14]},(e,t)=>e===`snare`&&(t===7||t===15)?1:t%4==0?3:2),ht()]}var vt=class{drums;clock;now;listeners=new Set;pattern=new E(`seq.pattern`,`Pattern`,ct,`A`,()=>this.notify());swing=new T(`seq.swing`,`Swing`,50,75,54,`%`,()=>{});patterns=_t();playing=!1;nextStep=0;nextTime=0;counter=0;played=[];constructor(e,t,n){this.drums=e,this.clock=t,this.now=n}get externallyDriven(){return this.drums.transport.synced&&this.drums.transport.followStartStop.value}get running(){return this.externallyDriven?this.clock.running:this.playing}get activePattern(){return this.patterns[ct.indexOf(this.pattern.value)]}level(e,t){return this.activePattern[e][t]}setLevel(e,t,n){this.activePattern[e][t]=Math.min(ut,Math.max(0,Math.round(n))),this.notify()}cycle(e,t){this.setLevel(e,t,(this.level(e,t)+1)%(ut+1))}clearPattern(){for(let e of k)this.activePattern[e].fill(0);this.notify()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}play(){this.externallyDriven||this.playing||(this.playing=!0,this.nextStep=0,this.nextTime=this.now()+pt,this.counter=0,this.played=[])}stop(){this.playing=!1,this.played=[]}tick(){if(!this.playing||this.externallyDriven)return;let e=this.now();for(this.nextTime<e-mt&&(this.nextTime=e);this.nextTime<e+ft;){let e=this.stepSeconds();this.scheduleStep(this.nextStep,this.nextTime,e),this.nextStep=(this.nextStep+1)%16,this.nextTime+=e}}handleMidi(e){if(this.externallyDriven){if(e.type===`start`)this.counter=0,this.played=[];else if(e.type===`stop`)this.played=[];else if(e.type===`clock`&&this.clock.running){let e=this.clock.ticks-1;if(e>=0&&e%dt===0){let t=e/dt%16;this.counter=e/dt,this.scheduleStep(t,this.now(),this.stepSeconds())}}}}currentStep(){if(!this.running)return;let e=this.now(),t;for(let n of this.played)n.time<=e&&(t=n.step);return t}get position(){if(this.externallyDriven)return this.clock.running?this.clock.position:Je(0);if(!this.playing)return Je(0);let e=this.now(),t=0;for(let n of this.played)n.time<=e&&(t=n.counter);return Je(t*dt)}stepSeconds(){return 60/this.drums.transport.bpm/4}swingDelay(e,t){return e%2==1?(this.swing.value/100-.5)*2*t:0}scheduleStep(e,t,n){let r=t+this.swingDelay(e,n),i=this.activePattern;for(let t of k){let n=i[t][e];n>0&&this.drums.trigger(t,lt[n],r)}this.played.push({step:e,counter:this.counter,time:r}),this.externallyDriven||this.counter++,this.played.length>64&&this.played.splice(0,this.played.length-64)}notify(){for(let e of this.listeners)e()}},yt={"bc.threshold":-18,"bc.ratio":4,"bc.attack":10,"bc.release":200,"bc.knee":6,"bc.makeup":3,"bc.mix":1,"bc.duck.depth":0,"bc.duck.release":120,"bc.duck.keyHp":80,"bc.bypass":0,"bc.listen":0},j=(e,t)=>({name:e,values:t}),bt=[j(`Init`,{}),j(`Glue`,{"bc.threshold":-14,"bc.ratio":2,"bc.attack":30,"bc.release":400,"bc.knee":12,"bc.makeup":2}),j(`Kick Duck`,{"bc.threshold":-6,"bc.ratio":1.5,"bc.makeup":0,"bc.duck.depth":.7,"bc.duck.release":140}),j(`Gentle Pump`,{"bc.threshold":-16,"bc.ratio":2,"bc.makeup":3,"bc.duck.depth":.35,"bc.duck.release":220}),j(`Hard Pump`,{"bc.threshold":-12,"bc.ratio":4,"bc.makeup":2,"bc.duck.depth":.95,"bc.duck.release":90,"bc.duck.keyHp":120}),j(`NY Parallel`,{"bc.threshold":-32,"bc.ratio":8,"bc.attack":3,"bc.release":100,"bc.knee":4,"bc.makeup":10,"bc.mix":.4}),j(`Drum Smash`,{"bc.threshold":-28,"bc.ratio":20,"bc.attack":1,"bc.release":200,"bc.knee":0,"bc.makeup":8,"bc.mix":.7}),j(`Limiter`,{"bc.threshold":-4,"bc.ratio":20,"bc.attack":1,"bc.release":100,"bc.knee":0,"bc.makeup":0})],xt=4,St=e=>10**(e/20);function Ct(e,t,n){let r=e+n/2<0?e+(0-e)/t:0;return-.6*Math.min(0,r)}var wt=class extends w{name;slots=[...bt];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;mix=1;makeupDb=3;threshold=-18;ratio=4;knee=6;bypass=!1;listen=!1;constructor(e=`Bus Comp`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`duck`,`gain`,{gain:1}).add(`gate`,`gain`,{gain:1}).add(`comp`,`compressor`,{threshold:-18,knee:6,ratio:4,attack:.01,release:.2}).add(`wet`,`gain`,{gain:St(3)}).add(`dry`,`gain`,{gain:0}).add(`bypassPath`,`gain`,{gain:0}).add(`listenPath`,`gain`,{gain:0}).add(`out`,`gain`,{gain:1}).add(`inMeter`,`meter`,{},{channel:`mono`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`inMeter`).connect(`in`,`duck`).connect(`duck`,`gate`).connect(`gate`,`comp`).connect(`gate`,`dry`).connect(`comp`,`wet`).connect(`wet`,`out`).connect(`dry`,`out`).connect(`in`,`bypassPath`).connect(`bypassPath`,`out`).connect(`listenPath`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),t.add(`key`,`gain`,{gain:1},{channels:`mono`}).add(`keyHp`,`filter`,{frequency:80,Q:.707,detune:0},{type:`highpass`}).add(`follow`,`follower`,{attack:.003,release:.12}).add(`sense`,`gain`,{gain:xt}).add(`keyShape`,`waveshaper`,{},{curve:`soft`}).add(`duckMeter`,`meter`,{},{channel:`mono`}).add(`depth`,`gain`,{gain:0}).connect(`key`,`keyHp`).connect(`keyHp`,`follow`).connect(`follow`,`sense`).connect(`sense`,`keyShape`).connect(`keyShape`,`duckMeter`).connect(`keyShape`,`depth`).connect(`depth`,`duck`,`gain`).connect(`keyHp`,`listenPath`),this.inputList.push({name:`in`,nodeId:`in`},{name:`key`,nodeId:`key`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`in`,nodeId:`inMeter`},{name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`},{name:`duck`,nodeId:`duckMeter`});let n=yt,r=(e,t,r,i,a,o,s)=>this.controlList.push(new T(e,t,r,i,n[e],a,o,s));r(`bc.threshold`,`Threshold`,-60,0,`dB`,e=>{this.threshold=e,t.setParam(`comp`,`threshold`,e),this.applyMix()}),r(`bc.ratio`,`Ratio`,1,20,`:1`,e=>{this.ratio=e,t.setParam(`comp`,`ratio`,e),this.applyMix()}),r(`bc.attack`,`Attack`,.3,100,`ms`,e=>t.setParam(`comp`,`attack`,e/1e3),`log`),r(`bc.release`,`Release`,30,1e3,`ms`,e=>t.setParam(`comp`,`release`,e/1e3),`log`),r(`bc.knee`,`Knee`,0,30,`dB`,e=>{this.knee=e,t.setParam(`comp`,`knee`,e),this.applyMix()}),r(`bc.makeup`,`Make-up`,0,24,`dB`,e=>{this.makeupDb=e,this.applyMix()}),r(`bc.mix`,`Mix`,0,1,``,e=>{this.mix=e,this.applyMix()}),r(`bc.duck.depth`,`Duck depth`,0,1,``,e=>t.setParam(`depth`,`gain`,-e)),r(`bc.duck.release`,`Duck release`,20,800,`ms`,e=>t.setParam(`follow`,`release`,e/1e3),`log`),r(`bc.duck.keyHp`,`Key HP`,20,300,`Hz`,e=>t.setParam(`keyHp`,`frequency`,e),`log`),this.controlList.push(new D(`bc.bypass`,`Bypass`,!1,e=>{this.bypass=e,this.applyPaths()}),new D(`bc.listen`,`Key listen`,!1,e=>{this.listen=e,this.applyPaths()}))}applyMix(){this.circuit.setParam(`dry`,`gain`,1-this.mix),this.circuit.setParam(`wet`,`gain`,this.mix*St(this.makeupDb-Ct(this.threshold,this.ratio,this.knee)))}applyPaths(){let e=this.circuit;e.setParam(`gate`,`gain`,this.bypass||this.listen?0:1),e.setParam(`bypassPath`,`gain`,this.bypass&&!this.listen?1:0),e.setParam(`listenPath`,`gain`,+!!this.listen)}loadPreset(e){let t={...yt,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`bc.bypass`&&t.id!==`bc.listen`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}},Tt=[`small`,`medium`,`large`],Et=3.5,M=Math.tanh(2.5)/2.5,Dt=2,Ot=class extends w{name;constructor(e=`Reverb`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`pre`,`delay`,{delayTime:.02,maxTime:.3}).add(`conv`,`convolver`,{},{size:`medium`}).add(`lowcut`,`filter`,{frequency:150,Q:.707,detune:0},{type:`highpass`}).add(`damp`,`filter`,{frequency:5e3,Q:.707,detune:0},{type:`lowpass`}).add(`drive`,`gain`,{gain:Et*M/Dt}).add(`sat`,`waveshaper`,{},{curve:`soft`}).add(`out`,`gain`,{gain:Dt}).connect(`in`,`pre`).connect(`pre`,`conv`).connect(`conv`,`lowcut`).connect(`lowcut`,`damp`).connect(`damp`,`drive`).connect(`drive`,`sat`).connect(`sat`,`out`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.controlList.push(new E(`reverb.size`,`Size`,Tt,`medium`,e=>t.setOption(`conv`,`size`,e)),new T(`reverb.predelay`,`Pre-delay`,0,250,20,`ms`,e=>t.setParam(`pre`,`delayTime`,e/1e3)),new T(`reverb.lowcut`,`Low cut`,40,600,150,`Hz`,e=>t.setParam(`lowcut`,`frequency`,e),`log`),new T(`reverb.damp`,`Damping`,1e3,16e3,5e3,`Hz`,e=>t.setParam(`damp`,`frequency`,e),`log`))}},kt=class extends w{name;spread=.8;feedback=.45;constructor(e=`Delay`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`out`,`gain`,{gain:.5}).add(`wobble`,`oscillator`,{frequency:.9,detune:0},{waveform:`sine`}).add(`wobbleDepth`,`gain`,{gain:6e-4});for(let e of[`L`,`R`]){let n=t=>`${t}${e}`;t.add(n(`inGain`),`gain`,{gain:1}).add(n(`dly`),`delay`,{delayTime:.375,maxTime:2}).add(n(`tone`),`filter`,{frequency:3200,Q:.707,detune:0},{type:`lowpass`}).add(n(`hp`),`filter`,{frequency:120,Q:.707,detune:0},{type:`highpass`}).add(n(`drive`),`gain`,{gain:1.9}).add(n(`sat`),`waveshaper`,{},{curve:`soft`}).add(n(`make`),`gain`,{gain:M/1.9}).add(n(`fbSelf`),`gain`,{gain:0}).add(n(`fbCross`),`gain`,{gain:0}).add(n(`pan`),`pan`,{pan:e===`L`?-1:1}).connect(`in`,n(`inGain`)).connect(n(`inGain`),n(`dly`)).connect(n(`dly`),n(`tone`)).connect(n(`tone`),n(`hp`)).connect(n(`hp`),n(`drive`)).connect(n(`drive`),n(`sat`)).connect(n(`sat`),n(`make`)).connect(n(`make`),n(`fbSelf`)).connect(n(`make`),n(`fbCross`)).connect(n(`sat`),n(`pan`)).connect(n(`pan`),`out`).connect(`wobbleDepth`,n(`dly`),`delayTime`)}t.connect(`fbSelfL`,`dlyL`).connect(`fbCrossL`,`dlyR`).connect(`fbSelfR`,`dlyR`).connect(`fbCrossR`,`dlyL`).connect(`wobble`,`wobbleDepth`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`});let n=e=>{e(`L`),e(`R`)};this.controlList.push(new T(`delay.time`,`Time`,20,1500,375,`ms`,e=>n(n=>t.setParam(`dly${n}`,`delayTime`,e/1e3)),`log`),new T(`delay.feedback`,`Feedback`,0,1.1,.45,``,e=>{this.feedback=e,this.applyFeedback()}),new T(`delay.tone`,`Tone`,400,12e3,3200,`Hz`,e=>n(n=>t.setParam(`tone${n}`,`frequency`,e)),`log`),new T(`delay.spread`,`Ping-pong`,0,1,.8,``,e=>{this.spread=e,this.applyFeedback(),t.setParam(`inGainR`,`gain`,1-e)}),new T(`delay.wobble`,`Wobble`,0,1,.15,``,e=>t.setParam(`wobbleDepth`,`gain`,e*.004)),new T(`delay.drive`,`Drive`,0,1,.3,``,e=>{let r=1+e*3;n(e=>{t.setParam(`drive${e}`,`gain`,r),t.setParam(`make${e}`,`gain`,M/r)})}))}applyFeedback(){let e=this.circuit;for(let t of[`L`,`R`])e.setParam(`fbSelf${t}`,`gain`,this.feedback*(1-this.spread)),e.setParam(`fbCross${t}`,`gain`,this.feedback*this.spread)}},At=1,jt=2,Mt=.8,Nt={"gr.position":.3,"gr.size":120,"gr.pitch":0,"gr.rate":12,"gr.spread":.5,"gr.cloud":.2,"gr.detune":0,"gr.shape":.3,"gr.reverse":0,"gr.feedback":0,"gr.mix":1,"gr.freeze":0,"gr.filter":2e4,"gr.reso":.7,"gr.drive":0,"gr.reverb":0,"gr.tone":8e3,"gr.tail":`medium`,"gr.play":0,"gr.attack":20,"gr.decay":300,"gr.sustain":.8,"gr.release":600},Pt=3.5,Ft=2,It=7,N=(e,t)=>({name:e,values:t}),Lt=[N(`Init`,{}),N(`Cloud Wash`,{"gr.position":.5,"gr.size":350,"gr.rate":30,"gr.spread":1,"gr.cloud":.6,"gr.detune":12,"gr.shape":0,"gr.reverb":.35,"gr.tail":`large`}),N(`Frozen Pad`,{"gr.position":.15,"gr.size":700,"gr.rate":14,"gr.spread":.9,"gr.cloud":.25,"gr.detune":6,"gr.shape":0,"gr.freeze":1,"gr.filter":3500,"gr.reverb":.3,"gr.tail":`large`}),N(`Stutter`,{"gr.position":.02,"gr.size":90,"gr.rate":8,"gr.spread":.2,"gr.cloud":0,"gr.shape":.7}),N(`Octave Shimmer`,{"gr.position":.25,"gr.size":220,"gr.pitch":12,"gr.rate":24,"gr.spread":.8,"gr.cloud":.3,"gr.detune":8,"gr.feedback":.35,"gr.reverb":.25}),N(`Reverse Swell`,{"gr.position":.35,"gr.size":900,"gr.rate":6,"gr.spread":.6,"gr.cloud":.15,"gr.shape":0,"gr.reverse":1}),N(`Glitch Dust`,{"gr.position":.6,"gr.size":25,"gr.rate":70,"gr.spread":1,"gr.cloud":.9,"gr.detune":40,"gr.shape":.8,"gr.reverse":.3,"gr.drive":.35,"gr.filter":9e3,"gr.reso":3}),N(`Tape Drone`,{"gr.position":.1,"gr.size":500,"gr.pitch":-12,"gr.rate":18,"gr.spread":.4,"gr.cloud":.1,"gr.detune":4,"gr.shape":0,"gr.feedback":.6,"gr.filter":1800,"gr.reso":2,"gr.drive":.25})],Rt=class extends w{name;slots=[...Lt];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;noteListeners=new Set;performanceListeners=new Set;held=[];bend=0;modWheelValue=0;pitchSemitones=0;constructor(e=`Granular`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`grains`,`granular`,{maxTime:20,position:.3,size:.12,pitch:0,rate:12,spread:.5,cloud:.2,detune:0,shape:.3,reverse:0,feedback:0,freeze:0,play:0,attack:.02,decay:.3,sustain:.8,release:.6}).add(`filter`,`filter`,{frequency:2e4,Q:.7,gain:0,detune:0},{type:`lowpass`}).add(`preDrive`,`gain`,{gain:1}).add(`sat`,`waveshaper`,{},{curve:`soft`}).add(`postDrive`,`gain`,{gain:M}).add(`revSend`,`gain`,{gain:0}).add(`conv`,`convolver`,{},{size:`medium`}).add(`revTone`,`filter`,{frequency:8e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`revDrive`,`gain`,{gain:Pt*M/Ft}).add(`revSat`,`waveshaper`,{},{curve:`soft`}).add(`revOut`,`gain`,{gain:Ft}).add(`wet`,`gain`,{gain:1}).add(`dry`,`gain`,{gain:0}).add(`out`,`gain`,{gain:1}).add(`inMeter`,`meter`,{},{channel:`mono`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`grains`).connect(`in`,`dry`).connect(`in`,`inMeter`).connect(`grains`,`filter`).connect(`filter`,`preDrive`).connect(`preDrive`,`sat`).connect(`sat`,`postDrive`).connect(`postDrive`,`wet`).connect(`wet`,`out`).connect(`postDrive`,`revSend`).connect(`revSend`,`conv`).connect(`conv`,`revTone`).connect(`revTone`,`revDrive`).connect(`revDrive`,`revSat`).connect(`revSat`,`revOut`).connect(`revOut`,`out`).connect(`dry`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`in`,nodeId:`inMeter`},{name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=Nt,r=(e,t,r,i,a,o,s)=>this.controlList.push(new T(e,t,r,i,n[e],a,o,s)),i=(e,n,i,a,o,s,c=1,l)=>r(e,n,i,a,o,e=>t.setParam(`grains`,s,e*c),l);i(`gr.position`,`Position`,0,1,``,`position`),i(`gr.size`,`Size`,5,2e3,`ms`,`size`,1/1e3,`log`),r(`gr.pitch`,`Pitch`,-24,24,`st`,e=>{this.pitchSemitones=e,this.applyPitch()}),i(`gr.rate`,`Rate`,.5,100,`Hz`,`rate`,1,`log`),i(`gr.spread`,`Spread`,0,1,``,`spread`),i(`gr.cloud`,`Cloud`,0,1,``,`cloud`),i(`gr.detune`,`Detune`,0,100,`ct`,`detune`),i(`gr.shape`,`Shape`,0,1,``,`shape`),i(`gr.reverse`,`Reverse`,0,1,``,`reverse`),i(`gr.feedback`,`Feedback`,0,.95,``,`feedback`),r(`gr.filter`,`Filter`,40,2e4,`Hz`,e=>t.setParam(`filter`,`frequency`,e),`log`),r(`gr.reso`,`Reso`,.7,12,``,e=>t.setParam(`filter`,`Q`,e),`log`),r(`gr.drive`,`Drive`,0,1,``,e=>{t.setParam(`preDrive`,`gain`,1+It*e),t.setParam(`postDrive`,`gain`,M/(1+2*e))}),r(`gr.reverb`,`Reverb`,0,1,``,e=>t.setParam(`revSend`,`gain`,e)),r(`gr.tone`,`Tone`,1e3,16e3,`Hz`,e=>t.setParam(`revTone`,`frequency`,e),`log`),r(`gr.mix`,`Mix`,0,1,``,e=>{t.setParam(`wet`,`gain`,e),t.setParam(`dry`,`gain`,1-e)}),r(`gr.attack`,`Attack`,1,4e3,`ms`,e=>t.setParam(`grains`,`attack`,e/1e3),`log`),r(`gr.decay`,`Decay`,5,4e3,`ms`,e=>t.setParam(`grains`,`decay`,e/1e3),`log`),r(`gr.sustain`,`Sustain`,0,1,``,e=>t.setParam(`grains`,`sustain`,e)),r(`gr.release`,`Release`,5,8e3,`ms`,e=>t.setParam(`grains`,`release`,e/1e3),`log`),this.controlList.push(new D(`gr.play`,`Keys`,!1,e=>{t.setParam(`grains`,`play`,+!!e),e||this.releaseAll()}),new E(`gr.channel`,`MIDI channel`,Xe,`3`,()=>{}),new E(`gr.tail`,`Tail`,Tt,`medium`,e=>t.setOption(`conv`,`size`,e)),new D(`gr.freeze`,`Freeze`,!1,e=>t.setParam(`grains`,`freeze`,+!!e)))}applyPitch(){this.circuit.setParam(`grains`,`pitch`,this.pitchSemitones+this.bend*jt)}releaseAll(){if(this.circuit.allNotesOff(`grains`),this.held.length>0){this.held=[];for(let e of this.noteListeners)e()}}keyDown(e,t=Mt){let n=this.control(`gr.play`);n.kind===`toggle`&&!n.value&&n.set(!0),this.held=this.held.filter(t=>t!==e),this.held.push(e),this.circuit.noteOn(`grains`,e,t);for(let e of this.noteListeners)e()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.circuit.noteOff(`grains`,e);for(let e of this.noteListeners)e()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.applyPitch();for(let e of this.performanceListeners)e()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e));for(let e of this.performanceListeners)e()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(!(`channel`in e))return;let t=this.control(`gr.channel`);if(!(t.kind!==`choice`||t.value!==`omni`&&Number(t.value)!==e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity/127);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===At&&this.setModWheel(e.value/127);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...Nt,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`gr.channel`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}},zt=[`series`,`parallel`,`pingpong`],Bt=[`lfo`,`env`],Vt=[`tri`,`ramp`,`sqr`,`rnd`],Ht=[`lp`,`hp`],P=[`a`,`b`],F=e=>e.toUpperCase(),Ut=.25,Wt=3600,Gt=.8,Kt=.5,qt=1,Jt=8e-4,Yt={"ouro.input":1,"ouro.mix":.5,"ouro.output":1,"ouro.routing":`parallel`,"ouro.kill":0,"ouro.freeze":0,"ouro.a.on":1,"ouro.a.gain":1,"ouro.a.delay":380,"ouro.a.grit":.15,"ouro.a.cutoff":3e3,"ouro.a.resonance":1.2,"ouro.a.filter":`lp`,"ouro.a.clip":.25,"ouro.a.level":1,"ouro.b.on":1,"ouro.b.gain":1,"ouro.b.delay":530,"ouro.b.grit":.15,"ouro.b.cutoff":2200,"ouro.b.resonance":1.2,"ouro.b.filter":`lp`,"ouro.b.clip":.25,"ouro.b.level":1,"ouro.fb.aa":.35,"ouro.fb.ab":.15,"ouro.fb.ba":.15,"ouro.fb.bb":.35,"ouro.mod.mode":`lfo`,"ouro.mod.wave":`tri`,"ouro.mod.rate":.8,"ouro.mod.depth":.4,"ouro.mod.trigger":0,"ouro.mod.dlyA":.15,"ouro.mod.dlyB":-.15,"ouro.mod.cutA":0,"ouro.mod.cutB":0,"ouro.mod.gainA":0,"ouro.mod.gainB":0},I=(e,t)=>({name:e,values:t}),Xt=[I(`Tape Spiral`,{"ouro.routing":`series`,"ouro.a.delay":240,"ouro.b.delay":360,"ouro.fb.aa":.35,"ouro.fb.bb":.4,"ouro.fb.ab":0,"ouro.fb.ba":.15,"ouro.a.grit":.35,"ouro.a.cutoff":2200,"ouro.b.cutoff":1800,"ouro.mod.rate":.4,"ouro.mod.depth":.6,"ouro.mod.dlyA":.3,"ouro.mod.dlyB":.2,"ouro.mod.cutA":.1}),I(`Karaoke Drone`,{"ouro.mix":.7,"ouro.fb.aa":.95,"ouro.fb.bb":.95,"ouro.a.gain":1.6,"ouro.b.gain":1.6,"ouro.a.grit":.5,"ouro.b.grit":.5,"ouro.a.clip":.6,"ouro.b.clip":.6,"ouro.a.delay":700,"ouro.b.delay":910,"ouro.a.cutoff":1400,"ouro.b.cutoff":1e3,"ouro.a.resonance":4,"ouro.b.resonance":4}),I(`Ping Pong Mayhem`,{"ouro.routing":`pingpong`,"ouro.mix":.6,"ouro.a.delay":280,"ouro.b.delay":280,"ouro.fb.ab":0,"ouro.fb.ba":.15,"ouro.fb.aa":.1,"ouro.fb.bb":.1,"ouro.a.resonance":.7,"ouro.b.resonance":.7,"ouro.a.grit":.1,"ouro.mod.depth":0}),I(`Dub Wash`,{"ouro.routing":`series`,"ouro.mix":.45,"ouro.a.delay":480,"ouro.b.delay":720,"ouro.fb.aa":.6,"ouro.fb.bb":.5,"ouro.fb.ab":.1,"ouro.fb.ba":.1,"ouro.a.cutoff":1800,"ouro.b.cutoff":1200,"ouro.a.resonance":2.5,"ouro.b.resonance":2.5,"ouro.a.clip":.2,"ouro.mod.rate":.25,"ouro.mod.depth":.5,"ouro.mod.cutA":.4,"ouro.mod.cutB":.3}),I(`Self Oscillator`,{"ouro.input":.2,"ouro.mix":1,"ouro.fb.aa":1.1,"ouro.fb.bb":1.1,"ouro.fb.ab":.3,"ouro.fb.ba":.3,"ouro.a.resonance":18,"ouro.b.resonance":18,"ouro.a.cutoff":800,"ouro.b.cutoff":1200,"ouro.a.clip":.5,"ouro.b.clip":.5,"ouro.a.delay":60,"ouro.b.delay":90,"ouro.mod.rate":.1,"ouro.mod.depth":.3,"ouro.mod.cutA":.5}),I(`Broken Echo`,{"ouro.a.grit":.85,"ouro.b.grit":.85,"ouro.a.delay":330,"ouro.b.delay":470,"ouro.fb.aa":.55,"ouro.fb.bb":.55,"ouro.a.clip":.7,"ouro.b.clip":.7,"ouro.mod.wave":`rnd`,"ouro.mod.rate":6,"ouro.mod.depth":.7,"ouro.mod.dlyA":.4,"ouro.mod.dlyB":-.3,"ouro.mod.gainA":.3}),I(`Filter Scream`,{"ouro.routing":`series`,"ouro.mix":.8,"ouro.a.filter":`hp`,"ouro.a.cutoff":2500,"ouro.a.resonance":16,"ouro.b.cutoff":1500,"ouro.b.resonance":16,"ouro.fb.aa":.6,"ouro.fb.bb":.6,"ouro.fb.ab":.2,"ouro.fb.ba":.1,"ouro.a.clip":.8,"ouro.b.clip":.8,"ouro.mod.wave":`ramp`,"ouro.mod.rate":2,"ouro.mod.depth":.8,"ouro.mod.cutA":.8,"ouro.mod.cutB":-.8}),I(`Slow Rot`,{"ouro.routing":`series`,"ouro.mix":.55,"ouro.a.delay":900,"ouro.b.delay":1300,"ouro.a.grit":.6,"ouro.b.grit":.6,"ouro.fb.aa":.55,"ouro.fb.bb":.55,"ouro.fb.ab":0,"ouro.fb.ba":.1,"ouro.a.cutoff":900,"ouro.b.cutoff":700,"ouro.a.resonance":1,"ouro.b.resonance":1,"ouro.mod.rate":.08,"ouro.mod.depth":.9,"ouro.mod.dlyA":.5,"ouro.mod.dlyB":.4,"ouro.a.level":.9,"ouro.b.level":.9})],Zt=class extends w{name;slots=[...Xt];currentSlot=0;currentPreset=this.slots[0];fb={aa:.35,ab:.15,ba:.15,bb:.35};on={a:!0,b:!0};clipDrive={a:1.25,b:1.25};routing=`parallel`;killed=!1;frozen=!1;modRate=.8;presetListeners=new Set;constructor(e=`Ouroboros`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`mono`,`gain`,{gain:1},{channels:`mono`}).add(`inGain`,`gain`,{gain:1}).add(`srcGate`,`gain`,{gain:1}).add(`srcA`,`gain`,{gain:1}).add(`srcB`,`gain`,{gain:1}).add(`dry`,`gain`,{gain:Math.SQRT1_2}).add(`wet`,`gain`,{gain:Math.SQRT1_2}).add(`sum`,`gain`,{gain:1}).add(`out`,`gain`,{gain:1}).connect(`in`,`mono`).connect(`mono`,`inGain`).connect(`inGain`,`srcGate`).connect(`srcGate`,`srcA`).connect(`srcGate`,`srcB`).connect(`in`,`dry`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`out`).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`L`,nodeId:`meterL`},{name:`R`,nodeId:`meterR`});for(let e of P)this.addChannel(t,e);t.add(`linkAB`,`gain`,{gain:0}).add(`bounceBA`,`gain`,{gain:0}).connect(`lvlA`,`linkAB`).connect(`linkAB`,`inB`).connect(`lvlB`,`bounceBA`).connect(`bounceBA`,`inA`).connect(`srcA`,`inA`).connect(`srcB`,`inB`);for(let e of P)for(let n of P)t.add(`fb${F(e)}${F(n)}`,`gain`,{gain:0}).connect(`clip${F(e)}`,`fb${F(e)}${F(n)}`).connect(`fb${F(e)}${F(n)}`,`in${F(n)}`);t.add(`seedNoise`,`noise`).add(`seedGain`,`gain`,{gain:Jt}).connect(`seedNoise`,`seedGain`).connect(`seedGain`,`inA`).connect(`seedGain`,`inB`),this.addModulator(t),this.addControls(t),this.applyRouting(),this.applyFeedback()}loadPreset(e){let t={...Yt,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`ouro.kill`&&t.id!==`ouro.mod.trigger`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}addChannel(e,t){let n=F(t);e.add(`in${n}`,`gain`,{gain:1}).add(`on${n}`,`gain`,{gain:1}).add(`g${n}`,`gain`,{gain:M}).add(`sg${n}`,`waveshaper`,{},{curve:`soft`}).add(`dly${n}`,`delay`,{delayTime:.38,maxTime:2}).add(`tone${n}`,`filter`,{frequency:4800,Q:.707,detune:0},{type:`lowpass`}).add(`crush${n}`,`waveshaper`,{bits:16},{curve:`crush`}).add(`filt${n}`,`filter`,{frequency:3e3,Q:1.2,detune:0},{type:`lowpass`}).add(`cdrive${n}`,`gain`,{gain:M}).add(`clip${n}`,`waveshaper`,{},{curve:`soft`}).add(`lvl${n}`,`gain`,{gain:1}).add(`send${n}`,`gain`,{gain:1}).add(`pan${n}`,`pan`,{pan:t===`a`?-1:1}).connect(`in${n}`,`on${n}`).connect(`on${n}`,`g${n}`).connect(`g${n}`,`sg${n}`).connect(`sg${n}`,`dly${n}`).connect(`dly${n}`,`tone${n}`).connect(`tone${n}`,`crush${n}`).connect(`crush${n}`,`filt${n}`).connect(`filt${n}`,`cdrive${n}`).connect(`cdrive${n}`,`clip${n}`).connect(`clip${n}`,`lvl${n}`).connect(`lvl${n}`,`send${n}`).connect(`send${n}`,`pan${n}`).connect(`pan${n}`,`wet`)}addModulator(e){e.add(`lfoOsc`,`oscillator`,{frequency:.8,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:.8}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfoGate`,`gain`,{gain:1}).add(`follow`,`waveshaper`,{},{curve:`abs`}).add(`followLp`,`filter`,{frequency:.8,Q:.707,detune:0},{type:`lowpass`}).add(`followGain`,`gain`,{gain:4}).add(`modTrig`,`trigger`,{peak:1,decay:.6,velSens:0}).add(`envGate`,`gain`,{gain:0}).add(`mod`,`gain`,{gain:1}).add(`modOut`,`gain`,{gain:.4}).connect(`lfoOsc`,`lfoOscOut`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoOscOut`,`lfoGate`).connect(`lfoRndOut`,`lfoGate`).connect(`inGain`,`follow`).connect(`follow`,`followLp`).connect(`followLp`,`followGain`).connect(`followGain`,`envGate`).connect(`modTrig`,`envGate`).connect(`lfoGate`,`mod`).connect(`envGate`,`mod`).connect(`mod`,`modOut`);for(let t of P){let n=F(t);e.add(`mDly${n}`,`gain`,{gain:0}).add(`mCut${n}`,`gain`,{gain:0}).add(`mGain${n}`,`gain`,{gain:0}).connect(`modOut`,`mDly${n}`).connect(`mDly${n}`,`dly${n}`,`delayTime`).connect(`modOut`,`mCut${n}`).connect(`mCut${n}`,`filt${n}`,`detune`).connect(`modOut`,`mGain${n}`).connect(`mGain${n}`,`g${n}`,`gain`)}}addControls(e){let t=Yt,n=e=>t[e],r=(e,t,r,i,a,o,s)=>this.controlList.push(new T(e,t,r,i,n(e),a,o,s)),i=(e,n,r,i)=>this.controlList.push(new E(e,n,r,t[e],i));r(`ouro.input`,`Input`,0,2,``,t=>e.setParam(`inGain`,`gain`,t)),r(`ouro.mix`,`Mix`,0,1,``,t=>{e.setParam(`dry`,`gain`,Math.cos(t*Math.PI/2)),e.setParam(`wet`,`gain`,Math.sin(t*Math.PI/2))}),r(`ouro.output`,`Output`,0,1.5,``,t=>e.setParam(`out`,`gain`,t)),i(`ouro.routing`,`Routing`,zt,e=>{this.routing=e,this.applyRouting(),this.applyFeedback()}),this.controlList.push(new D(`ouro.kill`,`Kill`,!1,e=>{this.killed=e,this.applyFeedback()}),new D(`ouro.freeze`,`Freeze`,!1,e=>{this.frozen=e,this.applyFeedback()}));for(let t of P){let n=F(t),a=e=>`ouro.${t}.${e}`;this.controlList.push(new D(a(`on`),`On`,!0,r=>{this.on[t]=r,e.setParam(`on${n}`,`gain`,+!!r),this.applyFeedback()})),r(a(`gain`),`Gain`,.05,8,`×`,t=>e.setParam(`g${n}`,`gain`,t*M),`log`),r(a(`delay`),`Delay`,10,1800,`ms`,t=>e.setParam(`dly${n}`,`delayTime`,t/1e3),`log`),r(a(`grit`),`Grit`,0,1,``,t=>e.setParam(`crush${n}`,`bits`,16-t*13)),r(a(`cutoff`),`Cutoff`,20,18e3,`Hz`,t=>e.setParam(`filt${n}`,`frequency`,t),`log`),r(a(`resonance`),`Resonance`,.1,30,``,t=>e.setParam(`filt${n}`,`Q`,t)),i(a(`filter`),`Filter`,Ht,t=>e.setOption(`filt${n}`,`type`,t===`hp`?`highpass`:`lowpass`)),r(a(`clip`),`Clip`,0,1,``,r=>{let i=1+r*7;e.setParam(`cdrive${n}`,`gain`,M*i),this.clipDrive[t]=i,this.applyFeedback()}),r(a(`level`),`Level`,0,1.5,``,t=>e.setParam(`lvl${n}`,`gain`,t))}for(let[e,t]of[[`aa`,`A>A`],[`ab`,`A>B`],[`ba`,`B>A`],[`bb`,`B>B`]])r(`ouro.fb.${e}`,t,0,1.2,``,t=>{this.fb[e]=t,this.applyFeedback()});i(`ouro.mod.mode`,`Mode`,Bt,t=>{e.setParam(`lfoGate`,`gain`,+(t===`lfo`)),e.setParam(`envGate`,`gain`,+(t===`env`))}),i(`ouro.mod.wave`,`Wave`,Vt,t=>{e.setOption(`lfoOsc`,`waveform`,t===`sqr`?`square`:t===`ramp`?`sawtooth`:`triangle`),e.setParam(`lfoOscOut`,`gain`,t===`rnd`?0:1),e.setParam(`lfoRndOut`,`gain`,+(t===`rnd`))}),r(`ouro.mod.rate`,`Rate`,.05,30,`Hz`,t=>{this.modRate=t,e.setParam(`lfoOsc`,`frequency`,t),e.setParam(`lfoRnd`,`rate`,t),e.setParam(`followLp`,`frequency`,t),e.setParam(`modTrig`,`decay`,Math.min(4,1.5/t))},`log`),r(`ouro.mod.depth`,`Depth`,0,1,``,t=>e.setParam(`modOut`,`gain`,t)),this.controlList.push(new D(`ouro.mod.trigger`,`Trigger`,!1,t=>{t&&e.trigger(`modTrig`,1)}));for(let t of P){let n=F(t),i=(t,i,a,o)=>r(`ouro.mod.${t}${n}`,i,-1,1,``,t=>e.setParam(`${a}${n}`,`gain`,t*o));i(`dly`,`Delay ${n}`,`mDly`,Ut),i(`cut`,`Cutoff ${n}`,`mCut`,Wt),i(`gain`,`Gain ${n}`,`mGain`,Gt)}}applyRouting(){let e=this.circuit,t=this.routing===`series`,n=this.routing===`parallel`;e.setParam(`srcB`,`gain`,+!!n),e.setParam(`sendA`,`gain`,+!t),e.setParam(`panA`,`pan`,-1),e.setParam(`panB`,`pan`,+!t)}applyFeedback(){let e=this.circuit;for(let t of P)for(let n of P){let r=`${t}${n}`,i=this.fb[r]/this.clipDrive[t];this.frozen&&t===n&&(i=qt/this.clipDrive[t]),(this.killed||!this.on[t]||!this.on[n])&&(i=0),e.setParam(`fb${F(t)}${F(n)}`,`gain`,i)}let t=this.routing!==`parallel`;e.setParam(`linkAB`,`gain`,t?1/this.clipDrive.a:0);let n=this.routing===`pingpong`&&!this.killed&&this.on.a&&this.on.b;e.setParam(`bounceBA`,`gain`,n?Kt/this.clipDrive.b:0),e.setParam(`srcGate`,`gain`,+!this.frozen)}},Qt={"osc1.wave":`saw`,"osc1.octave":`16`,"osc1.pw":0,"osc1.glide":0,"osc1.level":.8,"osc2.wave":`saw`,"osc2.octave":`8`,"osc2.detune":0,"osc2.glide":0,"osc2.level":.6,tune:0,sync:0,"vib.rate":5,"vib.level":0,noise:0,"route.vco":`nor`,"route.vcf":`lpf`,"route.mod":`single`,"filter.cutoff":1800,"filter.res":.2,"filter.post":0,"mod1.rise":.01,"mod1.fall":.5,"mod1.hold":0,"mod1.lfo":0,"mod1.level":.3,"mod2.rise":.01,"mod2.fall":.5,"mod2.hold":0,"mod2.lfo":0,"mod2.level":0,"vca.rise":.005,"vca.fall":.4,"vca.hold":1,"vca.lfo":0,"vca.level":.8,"reverb.time":.1,"reverb.decay":.35,"reverb.mix":.15,"play.legato":0,"play.mode":`duo`,"play.channel":0},$t=[`play.channel`],L=(e,t)=>({name:e,values:t}),en=[L(`Init`,{}),L(`Fat Bass`,{"osc1.octave":`32`,"osc1.wave":`square`,"osc1.pw":.2,"osc2.octave":`16`,"osc2.detune":.1,"filter.cutoff":260,"filter.res":.35,"mod1.rise":.002,"mod1.fall":.35,"mod1.level":.55,"vca.fall":.2,"play.mode":`mono`}),L(`Hard Sync Lead`,{"osc1.octave":`16`,"osc2.octave":`8`,"osc2.detune":7,sync:1,"filter.cutoff":2600,"filter.res":.3,"mod2.level":.5,"route.mod":`dual`,"mod2.lfo":1,"mod2.rise":.35,"mod2.fall":.35,"vib.level":.3,"vib.rate":5.5,"osc1.glide":.15,"osc2.glide":.15}),L(`Dual Fifths`,{"osc1.octave":`16`,"osc2.octave":`16`,"osc2.detune":.01,"osc2.wave":`tri`,"filter.cutoff":1400,"mod1.level":.3,"mod1.fall":.8,"mod1.hold":1,"reverb.mix":.25,"reverb.decay":.5}),L(`Resonant Squelch`,{"osc1.octave":`16`,"osc1.wave":`square`,"osc2.level":.3,"filter.cutoff":200,"filter.res":.85,"mod1.rise":.002,"mod1.fall":.22,"mod1.level":.8,"vca.fall":.25,"play.mode":`mono`}),L(`Split Pad`,{"route.vco":`split`,"route.vcf":`even`,"route.mod":`split`,"osc1.octave":`16`,"osc2.octave":`8`,"osc2.wave":`tri`,"osc2.detune":.03,"filter.cutoff":700,"filter.post":1.2,"mod1.rise":.9,"mod1.fall":1.6,"mod1.hold":1,"mod1.level":.35,"mod2.rise":1.4,"mod2.fall":2,"mod2.hold":1,"mod2.level":.45,"vca.rise":.7,"vca.fall":1.6,"reverb.mix":.35,"reverb.decay":.6,"reverb.time":.3}),L(`Band Pass Voice`,{"route.vcf":`odd`,"route.vco":`half`,"osc1.octave":`16`,"osc2.octave":`8`,"osc2.detune":12,"filter.cutoff":900,"filter.res":.6,"filter.post":-.8,"mod1.rise":.1,"mod1.fall":.6,"mod1.level":.4}),L(`Wobble Bass`,{"osc1.octave":`32`,"osc2.octave":`16`,"osc2.detune":.08,"filter.cutoff":180,"filter.res":.6,"mod1.lfo":1,"mod1.rise":.18,"mod1.fall":.18,"mod1.level":.6,"play.mode":`mono`}),L(`Tremolo Organ`,{"osc1.wave":`square`,"osc1.octave":`16`,"osc2.wave":`tri`,"osc2.octave":`8`,"filter.cutoff":3500,"vca.lfo":1,"vca.hold":1,"vca.rise":.06,"vca.fall":.06,"vib.level":.1,"reverb.mix":.3}),L(`Noise Hat`,{"osc1.level":0,"osc2.level":0,noise:.9,"route.vcf":`hpf`,"filter.cutoff":7e3,"filter.res":.2,"vca.hold":0,"vca.rise":.001,"vca.fall":.09,"reverb.mix":.1}),L(`Ringing Filters`,{"route.vco":`vca`,"route.vcf":`even`,"osc1.level":.05,"osc2.level":0,"filter.cutoff":300,"filter.post":.6,"filter.res":1,"mod1.level":.2,"mod1.rise":.01,"mod1.fall":.6,"vca.rise":.01,"vca.fall":.5,"reverb.mix":.3}),L(`Infinite Cathedral`,{"osc1.octave":`8`,"osc2.octave":`8`,"osc2.wave":`tri`,"osc2.detune":.02,"filter.cutoff":2200,"mod1.level":.2,"vca.rise":.5,"vca.fall":2.5,"reverb.mix":.7,"reverb.decay":1,"reverb.time":.5}),L(`Pulse Sweep`,{"osc1.wave":`square`,"osc1.pw":.7,"osc1.octave":`16`,"osc2.octave":`16`,"filter.cutoff":500,"filter.res":.4,"mod1.rise":1.4,"mod1.fall":1.8,"mod1.hold":1,"mod1.level":.7,"vca.rise":.3}),L(`Glide Mono`,{"osc1.octave":`16`,"osc2.octave":`16`,"osc2.detune":.01,"osc1.glide":.35,"osc2.glide":.35,"filter.cutoff":1100,"filter.res":.45,"mod1.level":.4,"mod1.fall":.4,"play.mode":`mono`,"play.legato":1}),L(`Dual Detune Strings`,{"osc1.octave":`8`,"osc2.octave":`8`,"osc2.detune":.12,"filter.cutoff":1900,"mod1.level":.15,"vca.rise":.25,"vca.fall":.9,"vib.level":.15,"vib.rate":5.8,"reverb.mix":.3,"reverb.decay":.55}),L(`Hoover`,{"osc1.wave":`square`,"osc1.pw":.35,"osc1.octave":`16`,"osc2.wave":`saw`,"osc2.octave":`16`,"osc2.detune":0,tune:42,"osc1.glide":.45,"osc2.glide":.5,"osc1.level":.8,"osc2.level":.8,"filter.cutoff":2600,"filter.res":.45,"route.mod":`dual`,"mod1.level":.15,"mod1.fall":.6,"mod1.hold":1,"mod2.lfo":1,"mod2.rise":.4,"mod2.fall":.4,"mod2.level":.5,"vib.level":.3,"vib.rate":6.5,"vca.fall":.5,"reverb.mix":.3,"reverb.decay":.45,"reverb.time":.2,"play.legato":1}),L(`Filter Echo`,{"osc1.octave":`16`,"osc2.octave":`8`,"osc2.detune":12,"route.mod":`dual`,"filter.cutoff":800,"filter.res":.55,"mod2.lfo":1,"mod2.rise":.25,"mod2.fall":.4,"mod2.level":.5,"mod1.level":.4,"reverb.mix":.4,"reverb.decay":.75,"reverb.time":.4})],tn=Array.from({length:24},(e,t)=>en[t]??L(`Init`,{})),nn=1,rn=64,an={32:-24,16:-12,8:0},on={16:-12,8:0,4:12},sn=`o1Wave.o1Off.o1Pw.o1Lvl.o1Gld.o2Wave.o2Off.o2Dtn.o2Lvl.o2Gld.tune.sync.vibRate.vibLvl.noise.vcoRoute.vcfRoute.modRoute.cutoff.res.post.m1Rise.m1Fall.m1Hold.m1Lfo.m1Lvl.m2Rise.m2Fall.m2Hold.m2Lfo.m2Lvl.vcaRise.vcaFall.vcaHold.vcaLfo.level.rvTime.rvDecay.rvMix.bend.modw`.split(`.`),cn=class extends w{name;bendRange=3;slots=[...tn];currentSlot=0;currentPreset=this.slots[0];held=[];latched=new Set;pedal=!1;bend=0;modWheelValue=0;gate=!1;lastChannel=1;lockedChannel;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`MOA-DUO`){super(),this.name=e;let t=this.circuit;t.add(`synth`,`duo`,Object.fromEntries(sn.map(e=>[e,0]))).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`synth`,`meterL`).connect(`synth`,`meterR`),this.outputList.push({name:`out`,nodeId:`synth`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=Qt,r=e=>n=>t.setParam(`synth`,e,n),i=(e,t,i,a,o,s,c)=>this.controlList.push(new T(e,t,i,a,n[e],o,r(s),c)),a=(e,t,i,a,o)=>this.controlList.push(new E(e,t,i,n[e],e=>r(a)(o?o(e):i.indexOf(e)))),o=(e,t,i)=>this.controlList.push(new D(e,t,n[e]>0,e=>r(i)(+!!e)));a(`osc1.wave`,`Wave`,[`saw`,`square`],`o1Wave`),a(`osc1.octave`,`Octave`,[`32`,`16`,`8`],`o1Off`,e=>an[e]),i(`osc1.pw`,`Pulse width`,0,1,``,`o1Pw`),i(`osc1.glide`,`Glide`,0,1,``,`o1Gld`),i(`osc1.level`,`Level`,0,1,``,`o1Lvl`),a(`osc2.wave`,`Wave`,[`saw`,`tri`],`o2Wave`),a(`osc2.octave`,`Octave`,[`16`,`8`,`4`],`o2Off`,e=>on[e]),i(`osc2.detune`,`Detune`,0,24,`st`,`o2Dtn`),i(`osc2.glide`,`Glide`,0,1,``,`o2Gld`),i(`osc2.level`,`Level`,0,1,``,`o2Lvl`),i(`tune`,`Tune`,-100,100,`ct`,`tune`),o(`sync`,`Sync`,`sync`),i(`vib.rate`,`Vibrato rate`,.1,20,`Hz`,`vibRate`,`log`),i(`vib.level`,`Vibrato level`,0,1,``,`vibLvl`),i(`noise`,`Noise`,0,1,``,`noise`),a(`route.vco`,`VCO routing`,[`nor`,`split`,`half`,`vca`],`vcoRoute`),a(`route.vcf`,`VCF routing`,[`lpf`,`hpf`,`even`,`odd`],`vcfRoute`),a(`route.mod`,`Mod routing`,[`single`,`dual`,`split`,`odd`],`modRoute`),i(`filter.cutoff`,`Cutoff`,20,2e4,`Hz`,`cutoff`,`log`),i(`filter.res`,`Resonance`,0,1,``,`res`),i(`filter.post`,`Post`,-4,4,`oct`,`post`);for(let[e,t]of[[`1`,`m1`],[`2`,`m2`],[`vca`,`vca`]]){let n=e===`vca`?`vca`:`mod${e}`;i(`${n}.rise`,`Rise`,.001,5,`s`,`${t}Rise`,`log`),i(`${n}.fall`,`Fall`,.01,15,`s`,`${t}Fall`,`log`),o(`${n}.hold`,`Hold`,`${t}Hold`),o(`${n}.lfo`,`LFO`,`${t}Lfo`),e!==`vca`&&i(`${n}.level`,`Level`,0,1,``,`${t}Lvl`)}i(`vca.level`,`Level`,0,1.5,``,`level`),i(`reverb.time`,`Time`,0,1,``,`rvTime`),i(`reverb.decay`,`Decay`,0,1,``,`rvDecay`),i(`reverb.mix`,`Mix`,0,1,``,`rvMix`),this.controlList.push(new D(`play.legato`,`Legato`,n[`play.legato`]>0,()=>void 0),new E(`play.mode`,`Mode`,[`mono`,`duo`],n[`play.mode`],()=>void 0),new D(`play.channel`,`Channel lock`,!1,()=>void 0))}keyDown(e){let t=this.held.length===0;this.held=this.held.filter(t=>t!==e),this.held.push(e),this.latched.delete(e),this.sendNotes(t||!this.legato),this.notifyNotes()}keyUp(e){this.held.includes(e)&&(this.pedal?this.latched.add(e):this.release(e))}release(e){this.held=this.held.filter(t=>t!==e),this.latched.delete(e),this.sendNotes(!1),this.notifyNotes()}releaseLatched(){for(let e of[...this.latched])this.release(e)}get legato(){return this.control(`play.legato`).value}assign(){let e=this.held;if(e.length===0)return;let t=e[e.length-1];if(this.control(`play.mode`).value===`mono`||e.length===1)return{n1:t,n2:t};let n=Math.min(...e),r=Math.max(...e);return e.length===2?{n1:n,n2:r}:{n1:n,n2:t>n?t:r}}sendNotes(e){let t=this.assign();t?(this.gate=!0,this.circuit.play(`synth`,t.n1,t.n2,!0,e)):this.gate&&(this.gate=!1,this.circuit.play(`synth`,this.lastN1,this.lastN2,!1,!1)),t&&(this.lastN1=t.n1,this.lastN2=t.n2)}lastN1=60;lastN2=60;get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`synth`,`bend`,this.bend*3),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`synth`,`modw`,this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(`channel`in e){if(!this.control(`play.channel`).value)this.lastChannel=e.channel,this.lockedChannel=void 0;else if(this.lockedChannel??=this.lastChannel,e.channel!==this.lockedChannel)return;switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===nn?this.setModWheel(e.value/127):e.controller===rn&&(this.pedal=e.value>=64,this.pedal||this.releaseLatched());break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.currentPreset=t,this.applyValues({...Qt,...t.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){if($t.includes(t))continue;let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)$t.includes(t.id)||(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyPreset(){for(let e of this.presetListeners)e()}},ln=[[`mult.1`,`mult.2`,`mult.3`,`mult.4`],[`sq.mult.1`,`sq.mult.2`,`sq.mult.3`,`sq.mult.4`]],un=ln.flat(),dn=e=>ln.findIndex(t=>t.includes(e)),fn=new Set(v),pn=new Set(y.map(e=>e.id)),mn=new Set(un);function hn(e){if(fn.has(e))return`out`;if(pn.has(e))return`in`;if(mn.has(e))return`mult`}function gn(e,t){let n=hn(e),r=hn(t);if(n&&r&&e!==t&&(n!==`mult`||r!==`mult`)){if(n===`out`&&r!==`out`)return{from:e,to:t};if(r===`out`&&n!==`out`)return{from:t,to:e};if(n===`mult`&&r===`in`)return{from:e,to:t};if(r===`mult`&&n===`in`)return{from:t,to:e}}}var _n=e=>hn(e)!==`out`;function vn(e,t){let n=new Set([t.from,t.to].filter(_n)),r=mn.has(t.to)?dn(t.to):-1;return[...e.filter(e=>!n.has(e.from)&&!n.has(e.to)&&!(r>=0&&dn(e.to)===r)),t]}var yn=(e,t)=>e.filter(e=>e.from!==t&&e.to!==t);function bn(e){let t=ln.map((t,n)=>e.find(e=>mn.has(e.to)&&dn(e.to)===n)?.from),n=[];for(let r of e)if(!mn.has(r.to)){if(mn.has(r.from)){let e=t[dn(r.from)];e&&n.push({from:e,to:r.to})}else n.push(r)}return n}var xn=e=>e.map(e=>`${e.from}>${e.to}`).join(`;`);function Sn(e){let t=[];for(let n of e.split(`;`)){let[e,r]=n.split(`>`),i=e&&r?gn(e,r):void 0;i&&(t=vn(t,i))}return t}new Map(h.map(e=>[e.id,e.label])),new Map(y.filter(e=>e.slider).map(e=>[e.id,e.slider])),[...v,...un],[...y.map(e=>e.id),...un];var R=`cords`,Cn={...Object.fromEntries(h.map(e=>[e.id,e.kind===`choice`?e.options[e.def]:e.def])),[R]:``},wn=[`play.channel`],Tn=[`sem.route`],z=(e,t)=>({name:e,values:t}),B=65.41,V=130.81,En=261.63,Dn=523.25,On=`vcf.out>sem.in.vco1`;function H(e,t=``,n=2,r=1){let i={};return e.forEach((e,t)=>{i[`sq.step.${r+t}`]=Math.min(1,Math.max(0,e/(12*n)))}),[...t].forEach((e,t)=>{i[`sq.gate.${r+t}`]=`123`.includes(e)?e:`off`}),i}function kn(e,t=1){return Object.fromEntries(e.map((e,n)=>[`sq.step.${t+n}`,e]))}var An=[z(`Init`,{}),z(`Classic Bass`,{"vco1.freq":B,"vco2.freq":B,"vco2.fine":.08,"vco3.freq":B/2,"vcf.in.vco1":.7,"vcf.in.vco2":.6,"vcf.in.vco3":.4,"vcf.freq":180,"vcf.res":.35,"vcf.cv.adsr":.45,"adsr.attack":.002,"adsr.decay":.35,"adsr.sustain":.25,"adsr.release":.12}),z(`Sync Lead`,{"vco2.sync":1,"vco2.freq":Dn,"vco2.fm.adsr":.2,"vcf.in.vco1":0,"vcf.in.vco2":.8,"vcf.freq":3e3,"vcf.res":.2,"vcf.cv.adsr":.15,"adsr.decay":.8,"adsr.sustain":.7,"kb.portaOn":1,"kb.porta":.2,"lfo.delay":.4,"lfo.depth":.25}),z(`Ladder Squelch`,{"vcf.mode":`4012`,"vco1.freq":V,"vcf.freq":220,"vcf.res":.85,"vcf.cv.adsr":.5,"adsr.attack":.001,"adsr.decay":.25,"adsr.sustain":.1,"adsr.release":.1}),z(`Brass`,{"vcf.in.vco1":.6,"vcf.in.vco3":.6,"vco3.fine":.06,"vcf.freq":500,"vcf.res":.1,"vcf.cv.adsr":.35,"adsr.attack":.06,"adsr.decay":.5,"adsr.sustain":.7,"adsr.release":.25,"lfo.delay":.6,"lfo.depth":.15}),z(`Duo Lead`,{"kb.voice":`duo`,"vcf.in.vco1":.6,"vcf.in.vco2":.6,"vcf.in.vco3":.5,"vco3.fine":.05,"vcf.freq":2200,"vcf.res":.25,"adsr.decay":.6,"adsr.sustain":.7,"kb.portaOn":1,"kb.porta":.15,"lfo.delay":.5,"lfo.depth":.2}),z(`Ring Bells`,{"vcf.in.vco1":0,"vcf.in.ring":.9,"vco2.freq":En*2.76,"vcf.freq":6e3,"vcf.cv.adsr":0,"adsr.attack":.001,"adsr.decay":1.8,"adsr.sustain":0,"adsr.release":1.5,"reverb.left":.35,"reverb.right":.35}),z(`FM Clang`,{"vcf.in.vco1":0,"vcf.in.vco3":.8,"vco3.fm.vco2":.3,"vco2.freq":En*3.5,"vcf.freq":4e3,"vcf.cv.adsr":.2,"adsr.attack":.001,"adsr.decay":1.2,"adsr.sustain":0,"adsr.release":.8,"reverb.left":.25,"reverb.right":.25}),z(`Droid Chatter`,{"vco1.fm.sh":.25,"sh.rate":9,"vcf.freq":2500,"vcf.cv.adsr":0,"kb.repeat":`kybd`,"lfo.speed":9,"adsr.attack":.001,"adsr.decay":.08,"adsr.sustain":0,"adsr.release":.05}),z(`Laser Zap`,{"vco1.freq":Dn,"vco1.fm.adsr":.35,"vcf.freq":5e3,"vcf.res":.2,"vcf.cv.adsr":0,"adsr.attack":.001,"adsr.decay":.25,"adsr.sustain":0,"adsr.release":.2}),z(`Repeat Bleeps`,{"kb.repeat":`kybd`,"lfo.speed":7,"vcf.freq":900,"vcf.res":.6,"vcf.cv.adsr":.35,"adsr.attack":.001,"adsr.decay":.12,"adsr.sustain":0,"adsr.release":.1}),z(`Wind and Surf`,{"vcf.in.vco1":0,"vcf.in.noise":.9,"noise.color":.5,"vcf.freq":400,"vcf.res":.75,"vcf.cv.kybd":0,"vcf.cv.adsr":0,"vcf.cv.vco2":.35,"vco2.range":`lf`,"vco2.freq":33,"adsr.attack":1.5,"adsr.sustain":1,"adsr.release":3,"reverb.left":.4,"reverb.right":.4}),z(`Noise Snare`,{"vcf.in.vco1":.2,"vco1.freq":196,"vcf.in.noise":.9,"vcf.freq":3500,"vcf.cv.kybd":0,"vcf.cv.adsr":.1,"adsr.attack":.001,"adsr.decay":.18,"adsr.sustain":0,"adsr.release":.15}),z(`Kick Drum`,{"vco1.freq":50,"vco1.fm.adsr":.3,"vcf.in.vco1":.9,"vcf.freq":120,"vcf.res":.3,"vcf.cv.kybd":0,"vcf.cv.adsr":.35,"vca.in.vcf":1,"adsr.attack":.001,"adsr.decay":.22,"adsr.sustain":0,"adsr.release":.18,"reverb.left":.05,"reverb.right":.05}),z(`Space Organ`,{"vcf.in.vco1":.6,"vco2.freq":Dn,"vcf.in.vco2":.5,"vcf.freq":3e3,"vcf.cv.adsr":0,"adsr.attack":.01,"adsr.decay":.1,"adsr.sustain":1,"adsr.release":.1,"lfo.speed":6,"lfo.depth":.12,"reverb.left":.5,"reverb.right":.5}),z(`Dual Filter Pad`,{"vco2.fine":.1,"vco3.fine":-.1,"vcf.in.vco1":.6,"vcf.in.vco2":.6,"vcf.freq":700,"vcf.res":.3,"vcf.cv.adsr":.15,"sem.in.vco1":.6,"sem.in.vco3":.5,"sem.freq":1800,"sem.mode":.8,"sem.res":.4,"sem.cv.lfo":.08,"lfo.speed":.3,"vca.in.sem":.7,"adsr.attack":.8,"adsr.decay":1.5,"adsr.sustain":.8,"adsr.release":2,"reverb.left":.35,"reverb.right":.35}),z(`Notch Sweep`,{[R]:On,"sem.in.vco1":1,"vca.in.vcf":0,"vca.in.sem":.8,"vcf.in.vco1":0,"vcf.in.vco2":.6,"vcf.in.vco3":.6,"vco3.fine":.07,"vcf.freq":8e3,"vcf.cv.adsr":0,"sem.mode":.5,"sem.res":.5,"sem.freq":800,"sem.cv.kybd":0,"sem.cv.lfo":.25,"lfo.speed":.25,"adsr.sustain":1,"adsr.release":.6}),z(`Band Pass Voice`,{[R]:On,"sem.in.vco1":1,"vca.in.vcf":0,"vca.in.sem":.8,"vcf.in.vco1":.7,"vcf.in.vco3":.6,"vco3.fine":.07,"vcf.freq":5e3,"vcf.cv.adsr":0,"sem.bp":1,"sem.freq":900,"sem.res":.6,"sem.cv.adsr":.15,"adsr.attack":.03,"adsr.sustain":.8,"lfo.delay":.3,"lfo.depth":.15}),z(`Twin Resonance`,{[R]:On,"sem.in.vco1":1,"vca.in.vcf":0,"vca.in.sem":.8,"vco1.freq":V,"vcf.mode":`4012`,"vcf.freq":350,"vcf.res":.7,"vcf.cv.adsr":.4,"sem.freq":1400,"sem.res":.75,"sem.cv.adsr":.25,"sem.mode":.15,"adsr.attack":.002,"adsr.decay":.4,"adsr.sustain":.2,"adsr.release":.2}),z(`S&H Filter`,{[R]:`sh.out>vcf.cv.vco2`,"vcf.cv.vco2":.3,"vcf.freq":700,"vcf.res":.7,"vcf.cv.adsr":0,"sh.rate":7,"adsr.sustain":1,"adsr.release":.3}),z(`Inverted Envelope`,{[R]:`adsr.out>vp.1;vp.inv1>vcf.cv.vco2`,"vcf.cv.vco2":.4,"vcf.freq":5e3,"vcf.res":.5,"vcf.cv.adsr":0,"adsr.attack":.3,"adsr.decay":.8,"adsr.sustain":.4,"adsr.release":.5}),z(`Mult Wobble`,{[R]:`lfo.tri>mult.1;mult.2>vcf.cv.vco2;mult.3>vco2.pwm`,"vco2.freq":B,"vcf.in.vco1":0,"vcf.in.vco2":.8,"vco2.pwm":.5,"vcf.cv.vco2":.25,"vcf.freq":600,"vcf.res":.5,"vcf.cv.adsr":0,"lfo.speed":3,"adsr.sustain":1}),z(`Octave Switch`,{[R]:`vp.inv2>esw.b;esw.c>mult.1;mult.2>vco1.fm.sh;mult.3>vco2.fm.sh`,"vp.6":.1,"vco1.fm.sh":1,"vco2.fm.sh":1,"vco2.fine":.07,"vcf.in.vco2":.6,"vcf.freq":2e3,"vcf.res":.3,"vcf.cv.adsr":.1,"sh.rate":6,"adsr.sustain":.8}),z(`SQ16 Bass Line`,{[R]:`sq.qa>mult.1;mult.2>vco1.fm.kybd;mult.3>vco2.fm.kybd;sq.cgate1>adsr.gate`,"vco1.freq":B,"vco2.freq":B,"vco2.fine":.08,"vcf.in.vco2":.5,"vcf.freq":300,"vcf.res":.45,"vcf.cv.adsr":.4,"adsr.attack":.002,"adsr.decay":.2,"adsr.sustain":.2,"adsr.release":.1,"sq.scale":`minor`,"sq.rate":7}),z(`Keys Pitch, SQ16 Rhythm`,{[R]:`sq.cgate1>adsr.gate;sq.b>vcf.cv.vco2`,"vcf.cv.vco2":.25,"vcf.freq":400,"vcf.res":.5,"vcf.cv.adsr":.2,"vcf.in.vco3":.5,"vco3.fine":.07,"adsr.attack":.002,"adsr.decay":.15,"adsr.sustain":.3,"adsr.release":.1,"sq.mode":`8x2`,"sq.rate":8}),z(`SQ16 Random Bleeps`,{[R]:`sq.qa>vco1.fm.kybd;sq.cgate1>adsr.gate`,"vco1.freq":V,"vcf.freq":2500,"vcf.cv.adsr":.15,"adsr.attack":.001,"adsr.decay":.1,"adsr.sustain":0,"adsr.release":.08,"sq.dir":`random`,"sq.scale":`pent`,"sq.range":`4`,"sq.rate":9,"reverb.left":.35,"reverb.right":.35}),z(`Acid 8x2`,{[R]:`sq.qa>vco1.fm.kybd;sq.cgate1>adsr.gate;sq.b>vcf.cv.vco2`,"vco1.freq":B,"vcf.mode":`4012`,"vcf.freq":250,"vcf.res":.8,"vcf.cv.adsr":.35,"vcf.cv.vco2":.2,"vcf.cv.kybd":0,"adsr.attack":.002,"adsr.decay":.18,"adsr.sustain":0,"adsr.release":.1,"sq.mode":`8x2`,"sq.rate":8,...H([0,0,12,0,3,15,0,10],`1.111.11`),...kn([.2,0,.8,.1,.3,0,.6,.2],9)}),z(`Keys Transpose Arp`,{[R]:`kb.cv>sq.cvin;sq.qa>mult.1;mult.2>vco1.fm.kybd;mult.3>vco2.fm.kybd;sq.cgate1>adsr.gate`,"vco1.freq":V,"vco2.freq":V,"vco2.fine":.07,"vcf.in.vco2":.5,"vcf.freq":1800,"vcf.res":.2,"vcf.cv.adsr":.25,"adsr.attack":.002,"adsr.decay":.25,"adsr.sustain":.3,"adsr.release":.2,"reverb.left":.25,"reverb.right":.25,"sq.scale":`major`,"sq.rate":10,...H([0,4,7,12,16,12,7,4,0,4,7,11,14,11,7,4],`1111111111111111`)}),z(`Two-Voice Counterpoint`,{[R]:`sq.qa>vco1.fm.kybd;sq.qb>vco2.fm.kybd;sq.cgate1>adsr.gate`,"vco1.freq":V,"vco2.freq":V,"vcf.in.vco1":.6,"vcf.in.vco2":.6,"vcf.freq":2e3,"vcf.res":.15,"vcf.cv.adsr":.2,"adsr.attack":.005,"adsr.decay":.3,"adsr.sustain":.5,"adsr.release":.25,"sq.mode":`8x2`,"sq.scale":`dorian`,"sq.rate":5,...H([0,3,7,5,3,2,0,10],`11111111`),...H([12,14,15,17,15,14,12,19],``,2,9)}),z(`Random Pentatonic`,{[R]:`sh.out>vp.1;vp.inv1>sq.ina;sq.qa>vco1.fm.kybd;sh.clk>adsr.gate`,"vp.2":.5,"vco1.freq":V,"sh.rate":6,"vcf.freq":2200,"vcf.cv.adsr":.2,"adsr.attack":.002,"adsr.decay":.15,"adsr.sustain":.2,"adsr.release":.15,"sq.scale":`pent`,"reverb.left":.35,"reverb.right":.35}),z(`Swaying Tempo`,{[R]:`sq.qa>vco1.fm.kybd;sq.cgate1>adsr.gate;lfo.tri>sq.fmin`,"sq.fm":.12,"lfo.speed":.15,"vco1.freq":V,"vcf.in.vco3":.5,"vco3.fine":.05,"vcf.freq":1500,"vcf.res":.3,"vcf.cv.adsr":.3,"adsr.attack":.003,"adsr.decay":.3,"adsr.sustain":.2,"adsr.release":.3,"reverb.left":.3,"reverb.right":.3,"sq.scale":`minor`,"sq.rate":6,...H([0,7,3,10,12,10,7,3,5,7,8,12,15,12,8,7],`1111111111111111`)}),z(`Step Filter (hold a key)`,{[R]:`sq.a>vcf.cv.vco2`,"vcf.cv.vco2":.3,"vcf.freq":150,"vcf.res":.6,"vcf.cv.adsr":0,"vcf.in.vco1":.6,"vcf.in.vco3":.6,"vco3.fine":.07,"adsr.attack":.01,"adsr.sustain":1,"adsr.release":.4,"sq.rate":8,...kn([.1,.5,.25,.8,.1,.6,.35,.9,.15,.5,.2,.7,.1,.4,.6,1])}),z(`Odd Loop (5 steps)`,{[R]:`sq.qa>vco1.fm.kybd;sq.cgate1>adsr.gate`,"sq.skip":`reset`,"vco1.freq":B,"vco2.freq":B,"vco2.fine":.1,"vcf.in.vco2":.5,"vcf.freq":400,"vcf.res":.5,"vcf.cv.adsr":.4,"adsr.attack":.002,"adsr.decay":.2,"adsr.sustain":.1,"adsr.release":.1,"sq.scale":`minor`,"sq.rate":7,...H([0,12,7,10,3,0],`111113`)}),z(`Ring Mod Sequence`,{[R]:`sq.qa>vco2.fm.kybd;sq.cgate1>adsr.gate`,"vco2.freq":En*1.5,"vcf.in.vco1":0,"vcf.in.ring":.9,"vcf.freq":5e3,"vcf.cv.adsr":0,"adsr.attack":.001,"adsr.decay":.6,"adsr.sustain":0,"adsr.release":.5,"reverb.left":.4,"reverb.right":.4,"sq.rate":5,...H([0,7,12,5,10,3,15,8,0,12,7,19,5,14,10,2],`1111111111111111`)})],jn=Array.from({length:48},(e,t)=>An[t]??z(`Init`,{})),Mn=1,Nn=64,Pn=[`omni`,...Array.from({length:16},(e,t)=>String(t+1))],Fn=class extends w{name;bendRange=2;slots=[...jn];currentSlot=0;currentPreset=this.slots[0];held=[];latched=new Set;pedal=!1;bend=0;modWheelValue=0;gate=!1;last={n1:60,n2:60};portaHeld=!1;manualOn=!1;cordList=[];midiPulses=0;cordListeners=new Set;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`MOA-2600`){super(),this.name=e;let t=this.circuit,n=[...h,...g];t.add(`synth`,`m2600`,Object.fromEntries(n.map(e=>[e.id,e.def])),{cords:`[]`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`synth`,`meterL`).connect(`synth`,`meterR`),this.outputList.push({name:`out`,nodeId:`synth`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let r=e=>n=>t.setParam(`synth`,e,n);for(let e of h){let t=Cn[e.id];if(e.kind===`number`)this.controlList.push(new T(e.id,e.label,e.min,e.max,t,e.unit??``,r(e.id),e.curve));else if(e.kind===`choice`){let n=e.options;this.controlList.push(new E(e.id,e.label,n,t,t=>r(e.id)(n.indexOf(t))))}else this.controlList.push(new D(e.id,e.label,t>0,t=>r(e.id)(+!!t)))}this.controlList.push(new E(`play.channel`,`MIDI channel`,Pn,`omni`,()=>void 0))}get transport(){return{channel:this.control(`play.channel`)}}keyDown(e){let t=this.held.length===0;this.held=this.held.filter(t=>t!==e),this.held.push(e),this.latched.delete(e),this.sendNotes(t||this.multiTrigger),this.notifyNotes()}keyUp(e){this.held.includes(e)&&(this.pedal?this.latched.add(e):this.release(e))}release(e){this.held=this.held.filter(t=>t!==e),this.latched.delete(e),this.sendNotes(!1),this.notifyNotes()}get multiTrigger(){return this.control(`kb.trig`).value===`multi`}assign(){if(this.held.length===0)return;let e=Math.min(...this.held);return this.control(`kb.voice`).value===`mono`?{n1:e,n2:e}:{n1:e,n2:Math.max(...this.held)}}sendNotes(e){let t=this.assign();t?(this.gate=!0,this.last=t,this.circuit.play(`synth`,t.n1,t.n2,!0,e)):this.gate&&(this.gate=!1,this.circuit.play(`synth`,this.last.n1,this.last.n2,!1,!1))}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}setManual(e){e!==this.manualOn&&(this.manualOn=e,this.circuit.send(`synth`,{type:`manual`,on:e}))}setPortamentoHeld(e){e!==this.portaHeld&&(this.portaHeld=e,this.circuit.setParam(`synth`,`kb.portaOn`,e||this.control(`kb.portaOn`).value?1:0))}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`synth`,`bend`,this.bend*2),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`synth`,`modw`,this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}sequencer(e){this.circuit.send(`synth`,{type:`sq`,action:e})}jumpTo(e){this.circuit.send(`synth`,{type:`sq`,action:`jump`,index:e})}handleClock(e){if(this.control(`sq.sync`).value===`midi`){if(e.type===`start`)this.midiPulses=0,this.sequencer(`reset`),this.sequencer(`run`);else if(e.type===`continue`)this.sequencer(`run`);else if(e.type===`stop`)this.sequencer(`stop`);else if(e.type===`clock`){let e=i[this.control(`sq.div`).value];this.midiPulses%e===0&&this.circuit.send(`synth`,{type:`sqtick`}),this.midiPulses++}}}handleMidi(e){if(!(`channel`in e)){this.handleClock(e);return}let t=this.control(`play.channel`).value;if(t===`omni`||Number(t)===e.channel)switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:if(e.controller===Mn)this.setModWheel(e.value/127);else if(e.controller===Nn&&(this.pedal=e.value>=64,!this.pedal))for(let e of[...this.latched])this.release(e);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}get cords(){return this.cordList}connect(e,t){let n=gn(e,t);return n?(this.setCords(vn(this.cordList,n)),!0):!1}unplug(e){this.setCords(yn(this.cordList,e))}clearCords(){this.setCords([])}setCords(e){this.cordList=[...e];let t=bn(this.cordList);this.circuit.setOption(`synth`,`cords`,JSON.stringify(t)),this.circuit.send(`synth`,{type:`cords`,cords:t});for(let e of this.cordListeners)e()}onCordsChange(e){return this.cordListeners.add(e),()=>this.cordListeners.delete(e)}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.currentPreset=t,this.applyValues({...Cn,...t.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){if(wn.includes(t)||Tn.includes(t))continue;if(t===`cords`){if(typeof n!=`string`)throw Error(`Patch: bad cords`);this.setCords(Sn(n));continue}let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)wn.includes(t.id)||(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e[R]=xn(this.cordList),e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyPreset(){for(let e of this.presetListeners)e()}},In={"f1.type":`GEN LP`,"f1.cutoff":1200,"f1.res":.25,"f1.depth":0,"f1.source":`env`,"f1.inv":0,"f1.noise":0,"f1.vca":0,"f1.gate":0,"f1.threshold":.3,"f2.type":`GEN LP`,"f2.cutoff":1200,"f2.res":.25,"f2.depth":0,"f2.source":`env`,"f2.inv":0,"f2.noise":0,"f2.vca":0,"f2.gate":0,"f2.threshold":.3,"env1.attack":.01,"env1.decay":.3,"env1.sustain":.6,"env1.release":.4,"env1.mode":`adsr`,"env1.curve":`lin`,"env1.trig":`keys`,"env2.attack":.01,"env2.decay":.3,"env2.sustain":.6,"env2.release":.4,"env2.mode":`adsr`,"env2.curve":`lin`,"env2.trig":`keys`,"link.env":0,"link.cutoff":0,"sh.rate":4,"sh.slew":.2,"sh.source":`noise`,"delay.time":.25,"delay.repeats":.3,"delay.level":0,"delay.mod":0,"delay.source":`s&h`,"mix.a":.8,"mix.b":.8,"mix.mode":`stereo`,"mix.volume":.8},U=(e,t)=>({name:e,values:t}),W=e=>{let t={};for(let[n,r]of Object.entries(e))t[`f1.${n}`]=r,t[`f2.${n}`]=r;return t},Ln=[U(`Init`,{}),U(`Dynamic Pluck`,{...W({cutoff:180,res:.45,depth:.85,vca:1}),"env1.attack":.002,"env1.decay":.22,"env1.sustain":0,"env1.release":.2,"env1.curve":`exp`,"link.env":1,"delay.level":.2,"delay.time":.18,"delay.repeats":.3}),U(`Auto Wah`,{"f1.type":`GEN BP`,"f1.cutoff":350,"f1.res":.7,"f1.depth":.7,"f2.type":`GEN BP`,"f2.cutoff":500,"f2.res":.7,"f2.depth":.7,"env1.trig":`thresh`,"f1.gate":1,"f1.threshold":.35,"env1.attack":.004,"env1.decay":.18,"env1.sustain":.1,"env1.release":.15,"env1.curve":`exp`,"link.env":1}),U(`Screaming Madman`,{"f1.type":`GEN LP`,"f1.cutoff":300,"f1.res":.93,"f1.depth":.6,"f2.type":`GEN HP`,"f2.cutoff":900,"f2.res":.9,"f2.depth":-.4,"env1.attack":.01,"env1.decay":.5,"env1.sustain":.2,"env1.release":.6,"link.env":1,"mix.a":.6,"mix.b":.45}),U(`Silk Sweep`,{...W({type:`2045 LP`,cutoff:250,res:.35,depth:.7}),"env1.attack":.45,"env1.decay":1.2,"env1.sustain":.7,"env1.release":1.5,"link.env":1,"delay.level":.25,"delay.time":.38,"delay.repeats":.45}),U(`Ringing 2045`,{"f1.type":`2045 LP`,"f1.cutoff":520,"f1.res":.96,"f1.depth":.3,"f2.type":`2045 LP`,"f2.cutoff":780,"f2.res":.96,"f2.depth":.3,"env1.attack":.05,"env1.sustain":.5,"link.env":1,"mix.a":.5,"mix.b":.5}),U(`Twin Peaks`,{...W({type:`BP+`,cutoff:700,res:.78,depth:.5}),"f2.cutoff":1100,"env1.attack":.02,"env1.decay":.6,"env1.sustain":.4,"env1.release":.5,"link.env":1}),U(`Phase Rooms`,{"f1.type":`NOTCH+`,"f1.cutoff":600,"f1.res":.6,"f1.depth":.8,"f1.source":`s&h`,"f2.type":`BANDSTOP+`,"f2.cutoff":900,"f2.res":.5,"f2.depth":.8,"sh.rate":1.2,"sh.slew":.65,"sh.source":`noise`}),U(`Random Steps`,{...W({cutoff:400,res:.6,depth:.9,source:`s&h`}),"f2.type":`GEN BP`,"sh.rate":7,"sh.slew":.05,"delay.level":.3,"delay.time":.21,"delay.repeats":.4,"delay.mod":.4,"delay.source":`s&h`}),U(`Looping LFO`,{...W({type:`2045 LP`,cutoff:300,res:.55,depth:.7}),"env1.mode":`loop`,"env1.attack":.35,"env1.release":.55,"link.env":1}),U(`Tremolo Gate`,{...W({cutoff:8e3,res:.1,depth:0,vca:1}),"env1.mode":`loop`,"env1.attack":.01,"env1.release":.09,"env1.curve":`exp`,"link.env":1}),U(`Crunch Echo`,{...W({type:`GEN LP`,cutoff:2400,res:.4}),"delay.level":.7,"delay.time":.42,"delay.repeats":.7,"delay.mod":.25,"delay.source":`env2`,"env2.mode":`loop`,"env2.attack":1.2,"env2.release":1.6}),U(`Noise Drums`,{"f1.type":`GEN BP`,"f1.cutoff":180,"f1.res":.8,"f1.depth":.8,"f1.noise":.9,"f1.vca":1,"f2.type":`GEN HP`,"f2.cutoff":3e3,"f2.res":.4,"f2.noise":.7,"f2.vca":1,"env1.attack":.001,"env1.decay":.12,"env1.sustain":0,"env1.release":.1,"env1.curve":`exp`,"env2.attack":.001,"env2.decay":.05,"env2.sustain":0,"env2.release":.05,"env2.curve":`exp`}),U(`Ghost Pad`,{"f1.type":`2045 LP`,"f1.cutoff":400,"f1.res":.5,"f1.depth":.5,"f1.noise":.15,"f2.type":`BANDSTOP+`,"f2.cutoff":1200,"f2.res":.4,"f2.depth":-.5,"env1.attack":.8,"env1.release":2,"env2.attack":1.5,"env2.release":2.5,"delay.level":.4,"delay.time":.5,"delay.repeats":.6}),U(`Mono Squelch`,{"f1.type":`2045 LP`,"f1.cutoff":120,"f1.res":.88,"f1.depth":.95,"f1.vca":1,"f2.type":`GEN LP`,"f2.cutoff":200,"f2.res":.85,"f2.depth":.9,"f2.vca":1,"env1.attack":.002,"env1.decay":.25,"env1.sustain":.15,"env1.release":.15,"env1.curve":`exp`,"link.env":1,"mix.mode":`mono`})],Rn=Array.from({length:16},(e,t)=>Ln[t]??U(`Init`,{})),zn=[`GEN LP`,`GEN BP`,`GEN HP`,`GEN NOTCH`,`2045 LP`,`BP+`,`NOTCH+`,`BANDSTOP+`],Bn=[`Type`,`Cut`,`Res`,`Depth`,`Src`,`Inv`,`Noise`,`Vca`,`Thr`,`Gate`].flatMap(e=>[`f1${e}`,`f2${e}`]).concat([`e1`,`e2`].flatMap(e=>[`Atk`,`Dec`,`Sus`,`Rel`,`Loop`,`Exp`,`Trig`].map(t=>e+t)),[`envLink`,`cutLink`,`shRate`,`shSlew`,`shSrc`,`dlTime`,`dlRep`,`dlLevel`,`dlMod`,`dlSrc`,`mixA`,`mixB`,`mono`,`vol`]),Vn=class extends w{name;slots=[...Rn];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;constructor(e=`MOA-DF2`){super(),this.name=e;let t=this.circuit;t.add(`box`,`df`,Object.fromEntries(Bn.map(e=>[e,0]))).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`box`,`meterL`).connect(`box`,`meterR`),this.inputList.push({name:`in`,nodeId:`box`}),this.outputList.push({name:`out`,nodeId:`box`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=In,r=e=>n=>t.setParam(`box`,e,n),i=(e,t,i,a,o,s,c)=>this.controlList.push(new T(e,t,i,a,n[e],o,r(s),c)),a=(e,t,i,a)=>this.controlList.push(new E(e,t,i,n[e],e=>r(a)(i.indexOf(e)))),o=(e,t,i)=>this.controlList.push(new D(e,t,n[e]>0,e=>r(i)(+!!e)));for(let e of[`1`,`2`]){let t=`f${e}`;a(`${t}.type`,`Filter type`,zn,`${t}Type`),i(`${t}.cutoff`,`Cutoff`,20,2e4,`Hz`,`${t}Cut`,`log`),i(`${t}.res`,`Resonance`,0,1,``,`${t}Res`),i(`${t}.depth`,`Depth`,-1,1,``,`${t}Depth`),a(`${t}.source`,`Source`,[`env`,`s&h`],`${t}Src`),o(`${t}.inv`,`Invert env`,`${t}Inv`),i(`${t}.noise`,`Noise`,0,1,``,`${t}Noise`),o(`${t}.vca`,`VCA`,`${t}Vca`),i(`${t}.threshold`,`Threshold`,0,1,``,`${t}Thr`),o(`${t}.gate`,`Gate on`,`${t}Gate`)}for(let e of[`1`,`2`]){let t=`env${e}`,n=`e${e}`;i(`${t}.attack`,`Attack`,.001,10,`s`,`${n}Atk`,`log`),i(`${t}.decay`,`Decay`,.005,10,`s`,`${n}Dec`,`log`),i(`${t}.sustain`,`Sustain`,0,1,``,`${n}Sus`),i(`${t}.release`,`Release`,.005,20,`s`,`${n}Rel`,`log`),a(`${t}.mode`,`Mode`,[`adsr`,`loop`],`${n}Loop`),a(`${t}.curve`,`Curve`,[`lin`,`exp`],`${n}Exp`),a(`${t}.trig`,`Gate from`,[`keys`,`thresh`],`${n}Trig`)}o(`link.env`,`Env I link`,`envLink`),o(`link.cutoff`,`Cutoff link`,`cutLink`),i(`sh.rate`,`Rate`,.05,40,`Hz`,`shRate`,`log`),i(`sh.slew`,`Slew`,0,1,``,`shSlew`),a(`sh.source`,`Source`,[`noise`,`env`],`shSrc`),i(`delay.time`,`Time`,.02,.6,`s`,`dlTime`,`log`),i(`delay.repeats`,`Repeats`,0,1,``,`dlRep`),i(`delay.level`,`Level`,0,1,``,`dlLevel`),i(`delay.mod`,`Mod depth`,-1,1,``,`dlMod`),a(`delay.source`,`Mod source`,[`s&h`,`env2`],`dlSrc`),i(`mix.a`,`Filter I`,0,1.5,``,`mixA`),i(`mix.b`,`Filter II`,0,1.5,``,`mixB`),a(`mix.mode`,`Output`,[`stereo`,`mono`],`mono`),i(`mix.volume`,`Volume`,0,1.5,``,`vol`)}setKeys(e){this.circuit.gate(`box`,`keys`,e)}setOpen(e,t){this.circuit.gate(`box`,e===1?`open1`:`open2`,t)}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.currentPreset=t,this.applyValues({...In,...t.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyPreset(){for(let e of this.presetListeners)e()}},Hn={"lfo.rate":5,"lfo.delay":0,"dco.lfo":0,"dco.pwm":.5,"dco.pwmSource":`man`,"dco.range":`8`,"dco.pulse":1,"dco.saw":1,"dco.sub":.3,"dco.noise":0,"hpf.freq":`1`,"vcf.freq":3e3,"vcf.res":.2,"vcf.env":.4,"vcf.polarity":`plus`,"vcf.lfo":0,"vcf.kybd":.5,"vca.mode":`env`,"vca.level":.8,"env.attack":.005,"env.decay":.4,"env.sustain":.6,"env.release":.3,"chorus.i":0,"chorus.ii":0,"bend.dco":2,"bend.vcf":.2,"bend.lfo":.3,"bend.lfoTrig":0,"master.portamento":0,"assign.mode":`poly1`,"master.tune":0,"master.volume":.75,"key.hold":0,"key.transpose":`0`},Un=[`master.tune`,`master.volume`,`key.hold`,`key.transpose`],Wn=[`A`,`B`],Gn=Wn.length*8*8,Kn=(e,t,n)=>e*8*8+(t-1)*8+(n-1),G=(e,t)=>({name:e,values:t}),qn=[G(`Brass 1`,{"dco.sub":.2,"vcf.freq":700,"vcf.res":.15,"vcf.env":.55,"vcf.kybd":.6,"env.attack":.07,"env.decay":.4,"env.sustain":.65,"env.release":.2,"chorus.i":1}),G(`Brass 2`,{"dco.pwm":.35,"dco.pulse":1,"dco.saw":1,"vcf.freq":600,"vcf.res":.25,"vcf.env":.6,"env.attack":.12,"env.decay":.5,"env.sustain":.55,"env.release":.25,"chorus.ii":1}),G(`Strings`,{"dco.pulse":0,"dco.saw":1,"dco.sub":.1,"hpf.freq":`2`,"vcf.freq":2600,"vcf.res":.05,"vcf.env":.1,"env.attack":.35,"env.decay":1,"env.sustain":.85,"env.release":.6,"chorus.i":1,"chorus.ii":1}),G(`String Ensemble`,{"dco.pulse":1,"dco.saw":1,"dco.pwm":.6,"dco.pwmSource":`lfo`,"lfo.rate":.8,"dco.sub":.15,"hpf.freq":`2`,"vcf.freq":2200,"vcf.env":.1,"env.attack":.5,"env.decay":1,"env.sustain":.9,"env.release":.8,"chorus.i":1,"chorus.ii":1}),G(`Choir`,{"dco.pulse":1,"dco.saw":0,"dco.pwm":.3,"dco.sub":.3,"dco.noise":.04,"vcf.freq":1300,"vcf.res":.35,"vcf.env":.1,"env.attack":.45,"env.decay":.8,"env.sustain":.8,"env.release":.9,"chorus.ii":1}),G(`Warm Pad`,{"dco.sub":.4,"vcf.freq":900,"vcf.res":.1,"vcf.env":.15,"vcf.lfo":.1,"lfo.rate":.3,"env.attack":.9,"env.decay":1.5,"env.sustain":.8,"env.release":1.4,"chorus.i":1}),G(`Slow Pad`,{"dco.pwmSource":`lfo`,"dco.pwm":.5,"lfo.rate":.2,"dco.sub":.25,"vcf.freq":1500,"vcf.res":.2,"vcf.env":.3,"env.attack":1.6,"env.decay":2,"env.sustain":.85,"env.release":2.2,"chorus.i":1,"chorus.ii":1}),G(`Sweep Pad`,{"vcf.freq":400,"vcf.res":.55,"vcf.env":.7,"vcf.lfo":.25,"lfo.rate":.15,"env.attack":1.2,"env.decay":2.5,"env.sustain":.7,"env.release":1.8,"chorus.ii":1}),G(`Sub Bass`,{"dco.range":`16`,"dco.pulse":0,"dco.saw":1,"dco.sub":.8,"vcf.freq":350,"vcf.res":.1,"vcf.env":.3,"vcf.kybd":.2,"env.attack":.003,"env.decay":.3,"env.sustain":.8,"env.release":.12,"master.portamento":.05}),G(`Saw Bass`,{"dco.range":`16`,"dco.pulse":0,"dco.sub":.5,"hpf.freq":`1`,"vcf.freq":500,"vcf.res":.3,"vcf.env":.55,"vcf.kybd":.3,"env.attack":.002,"env.decay":.25,"env.sustain":.4,"env.release":.12}),G(`Pluck Bass`,{"dco.range":`16`,"dco.pulse":1,"dco.saw":0,"dco.pwm":.4,"dco.sub":.6,"vcf.freq":300,"vcf.res":.4,"vcf.env":.7,"vcf.kybd":.4,"env.attack":.001,"env.decay":.22,"env.sustain":0,"env.release":.15}),G(`Lead Saw`,{"dco.pulse":0,"dco.sub":.1,"vcf.freq":2400,"vcf.res":.3,"vcf.env":.25,"vcf.kybd":.8,"dco.lfo":.12,"lfo.rate":5.5,"lfo.delay":.6,"env.attack":.01,"env.decay":.3,"env.sustain":.85,"env.release":.2,"master.portamento":.15,"assign.mode":`unison`,"chorus.i":1}),G(`Lead Pulse`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.55,"dco.pwmSource":`lfo`,"lfo.rate":3,"dco.sub":.2,"vcf.freq":2e3,"vcf.res":.35,"vcf.env":.3,"vcf.kybd":.8,"env.attack":.01,"env.decay":.3,"env.sustain":.8,"env.release":.2,"assign.mode":`unison`,"chorus.ii":1}),G(`Whistle Lead`,{"dco.range":`4`,"dco.saw":0,"dco.pulse":1,"dco.pwm":.1,"dco.sub":0,"hpf.freq":`2`,"vcf.freq":3800,"vcf.res":.2,"vcf.env":.1,"dco.lfo":.1,"lfo.rate":5,"lfo.delay":.9,"env.attack":.04,"env.decay":.3,"env.sustain":.9,"env.release":.25,"master.portamento":.25,"assign.mode":`unison`}),G(`Organ`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":0,"dco.sub":.7,"hpf.freq":`2`,"vcf.freq":6e3,"vcf.res":0,"vcf.env":0,"vca.mode":`gate`,"chorus.i":1,"chorus.ii":1}),G(`Clav`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.25,"dco.sub":0,"hpf.freq":`3`,"vcf.freq":1500,"vcf.res":.35,"vcf.env":.55,"vcf.kybd":.9,"env.attack":.001,"env.decay":.18,"env.sustain":0,"env.release":.12}),G(`Pluck`,{"dco.pulse":0,"dco.sub":.2,"vcf.freq":700,"vcf.res":.3,"vcf.env":.6,"env.attack":.001,"env.decay":.35,"env.sustain":0,"env.release":.3,"chorus.i":1}),G(`Harp`,{"dco.range":`4`,"dco.pulse":0,"dco.sub":0,"vcf.freq":1500,"vcf.res":.15,"vcf.env":.35,"env.attack":.001,"env.decay":1.2,"env.sustain":0,"env.release":1,"chorus.ii":1}),G(`Bell Pad`,{"dco.range":`4`,"dco.saw":0,"dco.pulse":1,"dco.pwm":.7,"dco.pwmSource":`lfo`,"lfo.rate":6,"dco.sub":0,"vcf.freq":2500,"vcf.res":.45,"vcf.env":.4,"env.attack":.002,"env.decay":1.6,"env.sustain":.1,"env.release":1.5,"chorus.i":1,"chorus.ii":1}),G(`Noise Sweep`,{"dco.pulse":0,"dco.saw":0,"dco.sub":0,"dco.noise":.8,"hpf.freq":`2`,"vcf.freq":300,"vcf.res":.6,"vcf.env":.8,"env.attack":1.4,"env.decay":1.5,"env.sustain":.1,"env.release":1.2,"chorus.ii":1}),G(`Wind`,{"dco.pulse":0,"dco.saw":0,"dco.sub":0,"dco.noise":.9,"vcf.freq":900,"vcf.res":.55,"vcf.env":.2,"vcf.lfo":.3,"lfo.rate":.25,"vcf.kybd":1,"env.attack":1,"env.decay":1,"env.sustain":.9,"env.release":1.5,"chorus.i":1}),G(`Vibes`,{"dco.range":`4`,"dco.pulse":0,"dco.sub":0,"dco.lfo":.05,"lfo.rate":6,"vcf.freq":2400,"vcf.res":.1,"vcf.env":.2,"env.attack":.002,"env.decay":1.4,"env.sustain":0,"env.release":.9,"chorus.ii":1}),G(`Glass`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.8,"dco.pwmSource":`lfo`,"lfo.rate":.5,"dco.sub":0,"dco.noise":.03,"hpf.freq":`2`,"vcf.freq":4e3,"vcf.res":.25,"vcf.env":.1,"env.attack":.6,"env.decay":1.5,"env.sustain":.7,"env.release":1.6,"chorus.i":1,"chorus.ii":1}),G(`Funk Stab`,{"dco.sub":.3,"hpf.freq":`2`,"vcf.freq":500,"vcf.res":.25,"vcf.env":.65,"vcf.kybd":.7,"env.attack":.001,"env.decay":.16,"env.sustain":0,"env.release":.08,"chorus.ii":1})],Jn=Array.from({length:Gn},(e,t)=>qn[t]??G(`Init`,{})),Yn=[`poly`,`mono`,`unison`],Xn=class{count;mode=`poly`;prefer=`oldest`;voices;held=[];clock=0;constructor(e){this.count=e,this.voices=Array.from({length:e},()=>({gate:!1,since:0}))}isActive(e){return this.voices[e].gate}get activeCount(){return this.voices.filter(e=>e.gate).length}noteOn(e){return this.mode===`poly`?this.polyOn(e):this.stackOn(e)}noteOff(e){return this.mode===`poly`?this.polyOff(e):this.stackOff(e)}releaseAll(){this.held=[];let e=[];return this.voices.forEach((t,n)=>{t.gate&&(t.gate=!1,t.since=++this.clock,e.push({kind:`off`,voice:n}))}),e}get active(){return this.mode===`mono`?[0]:this.voices.map((e,t)=>t)}polyOn(e){let t=this.voices.findIndex(t=>t.gate&&t.note===e);if(t<0){let e=this.voices.map((e,t)=>({v:e,i:t})).filter(e=>!e.v.gate),n=e.length?e:this.voices.map((e,t)=>({v:e,i:t}));t=this.prefer===`lowest`&&e.length?e[0].i:n.reduce((e,t)=>t.v.since<e.v.since?t:e).i}let n=this.voices[t];return n.note=e,n.gate=!0,n.since=++this.clock,[{kind:`on`,voice:t,note:e,retrigger:!0,glide:!0}]}polyOff(e){let t=[];return this.voices.forEach((n,r)=>{n.gate&&n.note===e&&(n.gate=!1,n.since=++this.clock,t.push({kind:`off`,voice:r}))}),t}stackOn(e){let t=this.voices[this.active[0]].gate;return this.held=this.held.filter(t=>t!==e),this.held.push(e),this.play(e,!t,t)}stackOff(e){this.held=this.held.filter(t=>t!==e);let t=this.held[this.held.length-1];if(t!==void 0)return this.play(t,!1,!0);let n=[];for(let e of this.active){let t=this.voices[e];t.gate&&(t.gate=!1,t.since=++this.clock,n.push({kind:`off`,voice:e}))}return n}play(e,t,n){return this.active.map(r=>{let i=this.voices[r],a=t||!i.gate;return i.note=e,i.gate=!0,i.since=++this.clock,{kind:`on`,voice:r,note:e,retrigger:a,glide:n&&!a}})}},Zn=[`poly1`,`poly2`,`unison`],Qn=[`16`,`8`,`4`],$n=[`0`,`1`,`2`,`3`],er=[`-2`,`-1`,`0`,`1`,`2`],tr=1200,nr=69,rr=1,ir=64,ar=.65,or=12,sr={poly:.4,unison:.3},cr=[10,10,240,720],lr={16:-1200,8:0,4:tr},K={i:{rate:.5,depth:.0013},ii:{rate:.83,depth:.0013},both:{rate:9,depth:25e-5}},ur=class extends w{name;transport;slots=[...Jn];currentSlot=0;currentPreset=this.slots[0];group=0;bank=1;manualState=!0;manualSnapshot;allocator=new Xn(6);held=[];sounding=new Map;latched=new Set;pedal=!1;bend=0;modWheelValue=0;portamento=0;bendSemitones=2;bendFilter=.2;lfoSensitivity=.3;lfoDepthCents=0;pwmSource=`man`;pwm=.5;envDepth=.4;envSign=1;lfoTrig=!1;chorusI=!1;chorusII=!1;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`Lynch`,t=new O){super(),this.name=e,this.transport=new $e(t),this.transport.channel.set(`omni`);let n=this.circuit;this.addShared(n);for(let e=0;e<6;e++)this.addVoice(n,e);this.addOutput(n),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`}),this.addControls(n)}keyDown(e){let t=e+Number(this.control(`key.transpose`).value)*12;this.held=this.held.filter(t=>t!==e),this.held.push(e),this.latched.delete(e),this.sounding.set(e,t),this.apply(this.allocator.noteOn(t)),this.updateLfoGate(),this.notifyNotes()}keyUp(e){let t=this.sounding.get(e);t!==void 0&&(this.holding?this.latched.add(e):this.release(e,t))}release(e,t){this.sounding.delete(e),this.latched.delete(e),this.held=this.held.filter(t=>t!==e),this.apply(this.allocator.noteOff(t)),this.updateLfoGate(),this.notifyNotes()}get holding(){return this.pedal||this.control(`key.hold`).value}releaseLatched(){for(let e of[...this.latched]){let t=this.sounding.get(e);t!==void 0&&this.release(e,t)}}releaseAll(){this.apply(this.allocator.releaseAll()),this.held=[],this.sounding.clear(),this.latched.clear(),this.updateLfoGate(),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}voiceActive(e){return this.allocator.isActive(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*this.bendSemitones*100),this.circuit.setParam(`bendVcf`,`offset`,this.bend*this.bendFilter*2400),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`lfoPitchMod`,`gain`,this.modWheelValue*this.lfoSensitivity*200),this.updateLfoGate(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}updateLfoGate(){let e=this.lfoTrig?this.modWheelValue>.05:this.held.length>0;this.circuit.setParam(`lfoFade`,`gate`,+!!e)}handleMidi(e){if(e.type!==`clock`&&`channel`in e&&this.transport.acceptsChannel(e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===rr?this.setModWheel(e.value/127):e.controller===ir&&(this.pedal=e.value>=64,this.pedal||this.releaseLatched());break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}get manual(){return this.manualState}get patchNumber(){let e=this.currentSlot%64;return{group:Math.floor(this.currentSlot/64),bank:Math.floor(e/8)+1,patch:e%8+1}}selectGroup(e){this.group=Math.min(Wn.length-1,Math.max(0,e)),this.notifyPreset()}selectBank(e){this.bank=Math.min(8,Math.max(1,e)),this.notifyPreset()}selectPatch(e){this.loadSlot(Kn(this.group,this.bank,e))}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.manualState&&(this.manualSnapshot=this.snapshot()),this.manualState=!1,this.currentSlot=e;let{group:n,bank:r}=this.patchNumber;this.group=n,this.bank=r,this.loadPreset(t)}selectManual(){this.manualState||(this.manualState=!0,this.manualSnapshot&&this.applyValues(this.manualSnapshot),this.notifyPreset())}loadPreset(e){this.currentPreset=e,this.applyValues({...Hn,...e.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){if(Un.includes(t))continue;let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)Un.includes(t.id)||(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}write(e=Kn(this.group,this.bank,this.patchNumber.patch)){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.manualState=!1,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}apply(e){let t=this.circuit;for(let n of e){let e=e=>`v${n.voice}.${e}`;n.kind===`off`?(t.setParam(e(`env`),`gate`,0),t.setParam(e(`gate`),`gate`,0)):(t.setParam(e(`pitch`),`offset`,(n.note-nr)*100),n.retrigger&&(t.setParam(e(`env`),`gate`,1),t.setParam(e(`gate`),`gate`,1)))}}eachVoice(e){for(let t=0;t<6;t++)e(e=>`v${t}.${e}`)}applyMode(e){this.releaseAll(),this.allocator.mode=e===`unison`?`unison`:`poly`,this.allocator.prefer=e===`poly2`?`lowest`:`oldest`;let t=e===`unison`?sr.unison:sr.poly;this.eachVoice(e=>this.circuit.setParam(e(`out`),`gain`,t));let n=e===`unison`?or:0,r=5/2;for(let e=0;e<6;e++){let t=(e-r)/r*n;this.circuit.setParam(`v${e}.det`,`offset`,t===0?0:t)}}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyPreset(){for(let e of this.presetListeners)e()}addShared(e){e.add(`bend`,`constant`,{offset:0}).add(`tune`,`constant`,{offset:0}).add(`rangeShift`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:-1200}).add(`pwCv`,`constant`,{offset:0}).add(`bendVcf`,`constant`,{offset:0}).add(`lfoOsc`,`oscillator`,{frequency:5,detune:0},{waveform:`triangle`}).add(`lfoFade`,`envelope`,{attack:.001,decay:.001,sustain:1,release:.02,gate:0}).add(`lfoFadeGain`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPitchMod`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0}).add(`noise`,`noise`).add(`voices`,`gain`,{gain:1}).connect(`lfoOsc`,`lfoFadeGain`).connect(`lfoFade`,`lfoFadeGain`,`gain`).connect(`lfoFadeGain`,`lfo`);for(let t of[`lfoPitch`,`lfoPitchMod`,`lfoPw`,`lfoFilter`])e.connect(`lfo`,t)}addVoice(e,t){let n=e=>`v${t}.${e}`;e.add(n(`pitch`),`constant`,{offset:0,glide:0}).add(n(`det`),`constant`,{offset:0}).add(n(`osc`),`oscillator`,{frequency:440,detune:0},{waveform:`sawtooth`}).add(n(`sub`),`oscillator`,{frequency:440,detune:0},{waveform:`square`}).add(n(`rawOut`),`gain`,{gain:1}).add(n(`pulseSum`),`gain`,{gain:1}).add(n(`shaper`),`waveshaper`,{},{curve:`pulse`}).add(n(`pulseOut`),`gain`,{gain:ar}).add(n(`subLevel`),`gain`,{gain:0}).add(n(`noiseLevel`),`gain`,{gain:0}).add(n(`mix`),`gain`,{gain:.5}).add(n(`boost`),`filter`,{frequency:120,Q:.707,gain:0,detune:0},{type:`lowshelf`}).add(n(`hpf`),`filter`,{frequency:10,Q:.707,gain:0,detune:0},{type:`highpass`}).add(n(`f1`),`filter`,{frequency:3e3,Q:1,detune:0},{type:`lowpass`}).add(n(`f2`),`filter`,{frequency:3e3,Q:.707,detune:0},{type:`lowpass`}).add(n(`keyFollow`),`gain`,{gain:.5}).add(n(`env`),`envelope`,{attack:.005,decay:.4,sustain:.6,release:.3,gate:0}).add(n(`envDepth`),`gain`,{gain:.4*6*tr}).add(n(`gate`),`envelope`,{attack:.003,decay:.001,sustain:1,release:.015,gate:0}).add(n(`envAmp`),`gain`,{gain:1}).add(n(`gateAmp`),`gain`,{gain:0}).add(n(`amp`),`gain`,{gain:0}).add(n(`out`),`gain`,{gain:sr.poly});for(let t of[`osc`,`sub`])for(let r of[n(`pitch`),n(`det`),`bend`,`tune`,`rangeShift`,`lfoPitch`,`lfoPitchMod`])e.connect(r,n(t),`detune`);e.connect(`subShift`,n(`sub`),`detune`).connect(n(`osc`),n(`rawOut`)).connect(n(`osc`),n(`pulseSum`)).connect(`pwCv`,n(`pulseSum`)).connect(`lfoPw`,n(`pulseSum`)).connect(n(`pulseSum`),n(`shaper`)).connect(n(`shaper`),n(`pulseOut`)).connect(n(`rawOut`),n(`mix`)).connect(n(`pulseOut`),n(`mix`)).connect(n(`sub`),n(`subLevel`)).connect(n(`subLevel`),n(`mix`)).connect(`noise`,n(`noiseLevel`)).connect(n(`noiseLevel`),n(`mix`)).connect(n(`mix`),n(`boost`)).connect(n(`boost`),n(`hpf`)).connect(n(`hpf`),n(`f1`)).connect(n(`f1`),n(`f2`)).connect(n(`f2`),n(`amp`)).connect(n(`env`),n(`envDepth`)).connect(n(`pitch`),n(`keyFollow`));for(let t of[`f1`,`f2`])e.connect(n(`envDepth`),n(t),`detune`).connect(n(`keyFollow`),n(t),`detune`).connect(`lfoFilter`,n(t),`detune`).connect(`bendVcf`,n(t),`detune`);e.connect(n(`env`),n(`envAmp`)).connect(n(`envAmp`),n(`amp`),`gain`).connect(n(`gate`),n(`gateAmp`)).connect(n(`gateAmp`),n(`amp`),`gain`).connect(n(`amp`),n(`out`)).connect(n(`out`),`voices`)}addOutput(e){e.add(`chDry`,`gain`,{gain:1}).add(`chLfo`,`oscillator`,{frequency:.5,detune:0},{waveform:`triangle`}).add(`chDelayL`,`delay`,{delayTime:.0035,maxTime:.02}).add(`chDelayR`,`delay`,{delayTime:.0035,maxTime:.02}).add(`chDepthL`,`gain`,{gain:K.i.depth}).add(`chDepthR`,`gain`,{gain:-K.i.depth}).add(`chToneL`,`filter`,{frequency:9e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`chToneR`,`filter`,{frequency:9e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`chPanL`,`pan`,{pan:-1}).add(`chPanR`,`pan`,{pan:1}).add(`chWet`,`gain`,{gain:0}).add(`chSum`,`gain`,{gain:1}).add(`vcaLevel`,`gain`,{gain:.8}).add(`volume`,`gain`,{gain:.75}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`voices`,`chDry`).connect(`chDry`,`chSum`).connect(`voices`,`chDelayL`).connect(`voices`,`chDelayR`).connect(`chDelayL`,`chToneL`).connect(`chDelayR`,`chToneR`).connect(`chToneL`,`chPanL`).connect(`chToneR`,`chPanR`).connect(`chPanL`,`chWet`).connect(`chPanR`,`chWet`).connect(`chWet`,`chSum`).connect(`chLfo`,`chDepthL`).connect(`chLfo`,`chDepthR`).connect(`chDepthL`,`chDelayL`,`delayTime`).connect(`chDepthR`,`chDelayR`,`delayTime`).connect(`chSum`,`vcaLevel`).connect(`vcaLevel`,`volume`).connect(`volume`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`)}addControls(e){let t=Hn,n=e=>t[e],r=(e,t,r,i,a,o,s)=>this.controlList.push(new T(e,t,r,i,n(e),a,o,s)),i=e=>t=>this.eachVoice(n=>e(n,t)),a=(e,t,r)=>this.controlList.push(new D(e,t,n(e)>0,r)),o=(e,n,r,i)=>this.controlList.push(new E(e,n,r,t[e],i));r(`lfo.rate`,`Rate`,.1,30,`Hz`,t=>e.setParam(`lfoOsc`,`frequency`,t),`log`),r(`lfo.delay`,`Delay time`,0,3,`s`,t=>e.setParam(`lfoFade`,`attack`,Math.max(.001,t))),r(`dco.lfo`,`LFO`,0,1,``,t=>{this.lfoDepthCents=t*150,e.setParam(`lfoPitch`,`gain`,this.lfoDepthCents)}),r(`dco.pwm`,`PWM`,0,1,``,e=>{this.pwm=e,this.applyPulseWidth()}),o(`dco.pwmSource`,`PWM source`,[`man`,`lfo`],e=>{this.pwmSource=e,this.applyPulseWidth()}),o(`dco.range`,`Range`,Qn,t=>e.setParam(`rangeShift`,`offset`,lr[t])),a(`dco.pulse`,`Pulse`,t=>this.eachVoice(n=>e.setParam(n(`pulseOut`),`gain`,t?ar:0))),a(`dco.saw`,`Saw`,t=>this.eachVoice(n=>e.setParam(n(`rawOut`),`gain`,+!!t))),r(`dco.sub`,`Sub`,0,1,``,i((t,n)=>e.setParam(t(`subLevel`),`gain`,n*.6))),r(`dco.noise`,`Noise`,0,1,``,i((t,n)=>e.setParam(t(`noiseLevel`),`gain`,n*.5))),o(`hpf.freq`,`HPF`,$n,t=>{let n=Number(t);this.eachVoice(t=>{e.setParam(t(`boost`),`gain`,n===0?6:0),e.setParam(t(`hpf`),`frequency`,cr[n])})}),r(`vcf.freq`,`Freq`,20,2e4,`Hz`,i((t,n)=>{e.setParam(t(`f1`),`frequency`,n),e.setParam(t(`f2`),`frequency`,n)}),`log`),r(`vcf.res`,`Res`,0,1,``,i((t,n)=>e.setParam(t(`f1`),`Q`,.5*32**n))),r(`vcf.env`,`Env`,0,1,``,e=>{this.envDepth=e,this.applyEnvDepth()}),o(`vcf.polarity`,`Env polarity`,[`plus`,`minus`],e=>{this.envSign=e===`minus`?-1:1,this.applyEnvDepth()}),r(`vcf.lfo`,`LFO`,0,1,``,t=>e.setParam(`lfoFilter`,`gain`,t*3*tr)),r(`vcf.kybd`,`Kybd`,0,1,``,i((t,n)=>e.setParam(t(`keyFollow`),`gain`,n))),o(`vca.mode`,`VCA`,[`env`,`gate`],t=>this.eachVoice(n=>{e.setParam(n(`envAmp`),`gain`,+(t===`env`)),e.setParam(n(`gateAmp`),`gain`,+(t===`gate`))})),r(`vca.level`,`Level`,0,1,``,t=>e.setParam(`vcaLevel`,`gain`,t));let s=(t,n,a,o)=>r(`env.${t}`,n,a,o,`s`,i((n,r)=>e.setParam(n(`env`),t,r)),`log`);s(`attack`,`A`,.001,3),s(`decay`,`D`,.002,12),r(`env.sustain`,`S`,0,1,``,i((t,n)=>e.setParam(t(`env`),`sustain`,n))),s(`release`,`R`,.002,12),a(`chorus.i`,`Chorus I`,e=>{this.chorusI=e,this.applyChorus()}),a(`chorus.ii`,`Chorus II`,e=>{this.chorusII=e,this.applyChorus()}),r(`bend.dco`,`Bender DCO`,0,12,`st`,e=>{this.bendSemitones=e,this.setPitchBend(this.bend)}),r(`bend.vcf`,`Bender VCF`,0,1,``,e=>{this.bendFilter=e,this.setPitchBend(this.bend)}),r(`bend.lfo`,`Bender LFO`,0,1,``,e=>{this.lfoSensitivity=e,this.setModWheel(this.modWheelValue)}),a(`bend.lfoTrig`,`LFO trig`,e=>{this.lfoTrig=e,this.updateLfoGate()}),r(`master.portamento`,`Portamento`,0,1,``,t=>{this.portamento=t;let n=t*t*2.5;this.eachVoice(t=>e.setParam(t(`pitch`),`glide`,n))}),o(`assign.mode`,`Assign`,Zn,e=>this.applyMode(e)),r(`master.tune`,`Tune`,-50,50,`ct`,t=>e.setParam(`tune`,`offset`,t)),r(`master.volume`,`Volume`,0,1,``,t=>e.setParam(`volume`,`gain`,t)),a(`key.hold`,`Hold`,e=>{e||this.releaseLatched()}),o(`key.transpose`,`Key transpose`,er,()=>{})}applyPulseWidth(){let e=this.circuit;this.pwmSource===`man`?(e.setParam(`pwCv`,`offset`,1-2*((50-this.pwm*45)/100)),e.setParam(`lfoPw`,`gain`,0)):(e.setParam(`pwCv`,`offset`,0),e.setParam(`lfoPw`,`gain`,this.pwm*.9))}applyEnvDepth(){this.eachVoice(e=>this.circuit.setParam(e(`envDepth`),`gain`,this.envSign*this.envDepth*6*tr))}applyChorus(){let e=this.circuit,t=this.chorusI,n=this.chorusII,r=t&&n?K.both:t?K.i:n?K.ii:void 0,i=r!==void 0,a=r??K.i;e.setParam(`chLfo`,`frequency`,a.rate),e.setParam(`chDepthL`,`gain`,a.depth),e.setParam(`chDepthR`,`gain`,-a.depth),e.setParam(`chWet`,`gain`,i?.7:0),e.setParam(`chDry`,`gain`,i?.75:1)}},dr={"env.attack":1,"env.decay":30,"env.sustain":0,"env.release":200,"env.keytrack":0,"env.velocity":.5,"env.legato":0,"gen.noise":1,"gen.cutoff":100,"gen.reso":.2,"gen.keytrack":.5,"gen.envAmt":0,"gen.onePole":0,"gen.gain":1.5,"fb.push":0,"fb.decay":2,"fb.release":.4,"sat.hardness":.3,"sat.symmetry":0,"patch.volume":.8,"delay.tune":0,"delay.fine":0,"delay.harmonics":0,"delay.split":0,"delay.splitPoint":.5,"delay.polarity":0,"filter.highpass":-36,"filter.lowpass":36,"filter.hpComp":1,"filter.lpComp":1,"voice.mode":`poly`,"voice.detune":12,"voice.glide":100,"voice.glideOn":0,"lfo.wave":`sine`,"lfo.rate":5,"lfo.sync":0,"lfo.division":`1/8`,"lfo.delay":0,"lfo.amount":0,"lfo.dest":`pitch`,"rev.mix":.25,"rev.bass":120,"rev.treble":8e3,"rev.size":`medium`,"rev.spread":.5},q=(e,t)=>({name:e,values:t}),J={"env.attack":60,"env.decay":200,"env.sustain":1,"env.release":250,"gen.noise":.06,"gen.gain":.3,"fb.push":1.2,"fb.decay":4,"fb.release":.3,"sat.hardness":.1,"filter.highpass":-36,"filter.lowpass":30},Y={"gen.gain":1.9},fr=[[q(`Nylon Pluck`,{...Y,"gen.cutoff":90,"gen.keytrack":.7,"fb.decay":1.8,"fb.release":.25,"filter.lowpass":30,"sat.hardness":.2,"rev.mix":.2}),q(`Steel String`,{...Y,"gen.cutoff":120,"delay.harmonics":.12,"fb.decay":3.5,"fb.release":.35,"filter.lowpass":48,"sat.hardness":.4,"env.velocity":.7}),q(`Muted Bass`,{...Y,"delay.tune":-12,"gen.cutoff":70,"gen.keytrack":.2,"fb.decay":.9,"fb.release":.15,"filter.lowpass":18,"filter.highpass":-48,"voice.mode":`mono`,"rev.mix":.08,"patch.volume":1}),q(`Harp`,{...Y,"gen.cutoff":100,"gen.keytrack":.6,"delay.harmonics":.05,"fb.decay":5,"fb.release":.6,"filter.lowpass":36,"rev.size":`large`,"rev.mix":.35}),q(`Marimba`,{...Y,"env.attack":1,"env.decay":20,"gen.cutoff":80,"delay.split":1,"delay.splitPoint":.4,"delay.harmonics":.4,"fb.decay":.7,"fb.release":.2,"filter.lowpass":24,"filter.highpass":-48,"rev.mix":.15}),q(`Glass Bell`,{...Y,"delay.tune":12,"delay.split":1,"delay.splitPoint":.3,"delay.harmonics":.6,"fb.decay":6,"fb.release":2,"sat.hardness":.1,"filter.lowpass":60,"filter.highpass":-48,"rev.size":`large`,"rev.mix":.4}),q(`Wood Block`,{...Y,"env.decay":15,"gen.gain":2,"delay.split":1,"delay.splitPoint":.5,"delay.harmonics":.2,"fb.decay":.25,"fb.release":.1,"filter.lowpass":40,"filter.highpass":-24,"rev.mix":.1}),q(`Kalimba`,{...Y,"delay.tune":12,"gen.noise":.8,"delay.split":1,"delay.splitPoint":.6,"delay.harmonics":.3,"fb.decay":1.2,"fb.release":.3,"filter.lowpass":42,"filter.highpass":-48,"rev.mix":.3})],[q(`Pan Flute`,{...J,"delay.polarity":1,"voice.mode":`mono`,"env.legato":1,"voice.glideOn":1,"voice.glide":60,"lfo.amount":.12,"lfo.rate":5,"lfo.delay":.6,"lfo.dest":`pitch`,"rev.mix":.3}),q(`Clarinet`,{...J,"delay.polarity":1,"gen.noise":.1,"gen.gain":.35,"env.attack":30,"sat.hardness":.5,"filter.lowpass":36,"voice.mode":`mono`,"env.legato":1,"rev.mix":.2}),q(`Reed Organ`,{...J,"gen.noise":.08,"env.attack":40,"env.release":200,"sat.hardness":.6,"sat.symmetry":.2,"filter.lowpass":40,"rev.mix":.25}),q(`Pipe Organ`,{...J,"gen.noise":.05,"env.attack":80,"env.release":500,"filter.lowpass":24,"rev.size":`large`,"rev.mix":.45}),q(`Brass`,{...J,"gen.noise":.1,"gen.gain":.5,"env.attack":80,"env.decay":200,"env.sustain":.7,"sat.hardness":.7,"sat.symmetry":.6,"filter.lowpass":42,"lfo.dest":`filter`,"lfo.amount":.1,"lfo.rate":6,"rev.mix":.2}),q(`Overblown`,{...J,"delay.polarity":1,"lfo.dest":`filter`,"lfo.amount":.6,"lfo.rate":.3,"lfo.wave":`sine`,"rev.mix":.3}),q(`Steam Drone`,{...J,"env.attack":1500,"env.release":3e3,"gen.noise":.2,"fb.decay":20,"fb.release":3,"voice.mode":`unison`,"voice.detune":25,"rev.size":`large`,"rev.mix":.5,"rev.spread":1}),q(`Wind Chimes`,{"delay.tune":12,"delay.split":1,"delay.splitPoint":.2,"delay.harmonics":.5,"fb.decay":8,"fb.release":4,"filter.lowpass":54,"filter.highpass":-48,"sat.hardness":.05,"rev.size":`large`,"rev.mix":.5,"rev.spread":1})]].flat(),pr=[`poly`,`mono`,`unison`],mr=[`sine`,`tri`,`sqr`,`ramp`,`rnd`],hr=[`pitch`,`filter`,`steam`,`sat`,`push`],gr=[`1/1`,`1/2`,`1/4`,`1/8`,`1/16`,`1/32`],_r=1,vr=64,yr=2,br=.8,xr=3,Sr=class extends w{name;transport;slots=[...fr];currentSlot=0;currentPreset=this.slots[0];held=[];bend=0;modWheelValue=0;lfoHz=5;lfoSync=!1;lfoDivision=`1/8`;clockPulses=0;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`Pipe`,t=new O){super(),this.name=e,this.transport=new $e(t),this.transport.channel.set(`omni`),this.circuit.add(`pipe`,`pipe`,{atk:.001,dec:.03,sus:0,rel:.2,envKey:0,vel:.5,legato:0,noise:1,nCut:100,nRes:.2,nKey:.5,nEnv:0,onePole:0,gain:.8,tune:0,fine:0,harm:0,split:0,splitPt:.5,pol:0,fbDec:2,fbRel:.4,push:0,satHard:.3,satSym:0,hp:-36,lp:36,hpComp:1,lpComp:1,mode:0,detune:12,glide:.1,glideOn:0,spread:.5,volume:.8,lfoRate:5,lfoShape:0,lfoDelay:0,lfoAmt:0,lfoDest:0,bend:0,mod:0}).add(`dry`,`gain`,{gain:1}).add(`revIn`,`gain`,{gain:1}).add(`conv`,`convolver`,{},{size:`medium`}).add(`revLow`,`filter`,{frequency:120,Q:.707,detune:0},{type:`highpass`}).add(`revHigh`,`filter`,{frequency:8e3,Q:.707,detune:0},{type:`lowpass`}).add(`wet`,`gain`,{gain:0}).add(`sum`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`pipe`,`dry`).connect(`pipe`,`revIn`).connect(`revIn`,`conv`).connect(`conv`,`revLow`).connect(`revLow`,`revHigh`).connect(`revHigh`,`wet`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`}),this.addControls(),this.transport.tempo.onChange(()=>this.applyLfoRate())}addControls(){let e=this.circuit,t=dr,n=(e,n,r,i,a,o,s)=>this.controlList.push(new T(e,n,r,i,t[e],a,o,s)),r=(t,r,i,a,o,s,c=1,l)=>n(t,r,i,a,o,t=>e.setParam(`pipe`,s,t*c),l),i=(n,r,i)=>this.controlList.push(new D(n,r,(t[n]??0)>0,t=>e.setParam(`pipe`,i,+!!t)));r(`env.attack`,`Attack`,.5,1e4,`ms`,`atk`,1/1e3,`log`),r(`env.decay`,`Decay`,1,1e4,`ms`,`dec`,1/1e3,`log`),r(`env.sustain`,`Sustain`,0,1,``,`sus`),r(`env.release`,`Release`,5,2e4,`ms`,`rel`,1/1e3,`log`),r(`env.keytrack`,`Keytrack`,0,1,``,`envKey`),r(`env.velocity`,`Velocity`,0,1,``,`vel`),i(`env.legato`,`Legato`,`legato`),r(`gen.noise`,`DC / Noise`,0,1,``,`noise`),r(`gen.cutoff`,`Cutoff`,30,140,`pitch`,`nCut`),r(`gen.reso`,`Resonance`,0,1,``,`nRes`),r(`gen.keytrack`,`Keytrack`,0,1,``,`nKey`),r(`gen.envAmt`,`Env amount`,-48,48,`st`,`nEnv`),r(`gen.gain`,`Gain`,0,2,``,`gain`),i(`gen.onePole`,`1-pole`,`onePole`),r(`fb.push`,`Push`,0,1.5,``,`push`),r(`fb.decay`,`Decay`,.05,30,`s`,`fbDec`,1,`log`),r(`fb.release`,`Release`,.02,20,`s`,`fbRel`,1,`log`),r(`sat.hardness`,`Soft / Hard`,0,1,``,`satHard`),r(`sat.symmetry`,`Symmetry`,0,1,``,`satSym`),r(`patch.volume`,`Volume`,0,1.2,``,`volume`),r(`delay.tune`,`Tune`,-24,24,`st`,`tune`),r(`delay.fine`,`Fine`,-100,100,`ct`,`fine`),r(`delay.harmonics`,`Harmonics`,0,1,``,`harm`),r(`delay.splitPoint`,`Split point`,.05,.95,``,`splitPt`),i(`delay.split`,`Split`,`split`),i(`delay.polarity`,`Polarity`,`pol`),r(`filter.highpass`,`Highpass`,-60,36,`st`,`hp`),r(`filter.lowpass`,`Lowpass`,0,84,`st`,`lp`),r(`filter.hpComp`,`HP comp`,0,1,``,`hpComp`),r(`filter.lpComp`,`LP comp`,0,1,``,`lpComp`),this.controlList.push(new E(`voice.mode`,`Mode`,pr,`poly`,t=>{this.releaseAll(),e.setParam(`pipe`,`mode`,pr.indexOf(t))})),r(`voice.detune`,`Detune`,0,100,`ct`,`detune`),r(`voice.glide`,`Glide`,1,5e3,`ms`,`glide`,1/1e3,`log`),i(`voice.glideOn`,`Glide on`,`glideOn`),this.controlList.push(new E(`lfo.wave`,`Wave`,mr,`sine`,t=>e.setParam(`pipe`,`lfoShape`,mr.indexOf(t))),new E(`lfo.dest`,`Destination`,hr,`pitch`,t=>e.setParam(`pipe`,`lfoDest`,hr.indexOf(t))),new E(`lfo.division`,`Division`,gr,`1/8`,e=>{this.lfoDivision=e,this.applyLfoRate()}),new D(`lfo.sync`,`Sync`,!1,e=>{this.lfoSync=e,this.applyLfoRate()})),n(`lfo.rate`,`Rate`,.05,40,`Hz`,e=>{this.lfoHz=e,this.applyLfoRate()},`log`),r(`lfo.delay`,`Delay`,0,5,`s`,`lfoDelay`),r(`lfo.amount`,`Amount`,0,1,``,`lfoAmt`),n(`rev.mix`,`Mix`,0,1,``,t=>{e.setParam(`dry`,`gain`,Math.cos(t*Math.PI/2)),e.setParam(`wet`,`gain`,Math.sin(t*Math.PI/2)*xr)}),n(`rev.bass`,`Bass`,20,800,`Hz`,t=>e.setParam(`revLow`,`frequency`,t),`log`),n(`rev.treble`,`Treble`,1500,16e3,`Hz`,t=>e.setParam(`revHigh`,`frequency`,t),`log`),r(`rev.spread`,`Spread`,0,1,``,`spread`),this.controlList.push(new E(`rev.size`,`Size`,Tt,`medium`,t=>e.setOption(`conv`,`size`,t)))}applyLfoRate(){let e=Number(this.lfoDivision.split(`/`)[1]),t=this.lfoSync?this.transport.bpm/60*e/4:this.lfoHz;this.circuit.setParam(`pipe`,`lfoRate`,Math.min(40,Math.max(.05,t)))}releaseAll(){this.circuit.allNotesOff(`pipe`),this.held.length>0&&(this.held=[],this.notifyNotes())}keyDown(e,t=br){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.circuit.noteOn(`pipe`,e,t),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.circuit.noteOff(`pipe`,e),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}setSustain(e){this.circuit.pedal(`pipe`,e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`pipe`,`bend`,this.bend*yr),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`pipe`,`mod`,this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(e.type===`clock`)this.lfoSync&&this.transport.synced&&++this.clockPulses%24==0&&this.applyLfoRate();else if(`channel`in e&&this.transport.acceptsChannel(e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity/127);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===_r?this.setModWheel(e.value/127):e.controller===vr&&this.setSustain(e.value>=64);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...dr,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}},Cr={"osc.wave":`saw`,"osc.width":50,"osc.pwm":0,"osc.vibrato":0,"osc.sub":.3,"filter.cutoff":2400,"filter.resonance":1,"filter.env":2,"filter.lfo":0,"filter.key":50,"amp.lfo":0,"amp.key":0,level:.7,"lfo.wave":`tri`,"lfo.rate":5,"lfo.sync":0,"lfo.division":`1/8`,"env1.attack":.005,"env1.decay":.4,"env1.sustain":.4,"env1.release":.4,"env2.attack":.005,"env2.decay":.3,"env2.sustain":.7,"env2.release":.35,"voices.mode":`poly`,"voices.portamento":0,"voices.detune":12,"fx.chorus":0,"fx.delayTime":.35,"fx.feedback":.3,"fx.mix":0},X=(e,t)=>({name:e,values:t}),wr=[[X(`Soft Pad`,{"osc.sub":.2,"filter.cutoff":900,"filter.resonance":1.2,"filter.env":1.5,"filter.lfo":.3,"env1.attack":.6,"env1.decay":1.2,"env1.sustain":.5,"env1.release":1.5,"env2.attack":.5,"env2.decay":.8,"env2.sustain":.8,"env2.release":1.6,"lfo.rate":.4,"fx.chorus":.7,"fx.mix":.15,"fx.delayTime":.45,"fx.feedback":.35,level:.6}),X(`Warm Brass`,{"osc.sub":.3,"filter.cutoff":700,"filter.env":3.2,"osc.vibrato":8,"env1.attack":.12,"env1.decay":.5,"env1.sustain":.55,"env1.release":.25,"env2.attack":.06,"env2.decay":.3,"env2.sustain":.85,"env2.release":.2,"fx.chorus":.3}),X(`Pluck Bass`,{"voices.mode":`mono`,"osc.sub":.6,"filter.cutoff":350,"filter.resonance":4,"filter.env":3.5,"env1.attack":.001,"env1.decay":.22,"env1.sustain":0,"env1.release":.15,"env2.attack":.001,"env2.decay":.35,"env2.sustain":.5,"env2.release":.1,"voices.portamento":.05}),X(`Glass Keys`,{"osc.wave":`tri`,"osc.sub":0,"filter.cutoff":5200,"filter.resonance":.5,"filter.env":.5,"env1.attack":.001,"env1.decay":.8,"env1.sustain":.2,"env1.release":.6,"env2.attack":.002,"env2.decay":1.2,"env2.sustain":.1,"env2.release":.8,"fx.chorus":.45,"fx.mix":.2,"fx.delayTime":.3,"fx.feedback":.4}),X(`Slow Strings`,{"filter.cutoff":3e3,"filter.env":.6,"filter.key":70,"osc.vibrato":12,"lfo.rate":5.5,"env1.attack":.8,"env1.decay":1,"env1.sustain":.7,"env1.release":1.2,"env2.attack":.9,"env2.decay":1,"env2.sustain":.9,"env2.release":1.4,"fx.chorus":.8}),X(`Sweep Lead`,{"voices.mode":`mono`,"osc.wave":`pulse`,"osc.width":30,"osc.pwm":.4,"osc.sub":.2,"lfo.rate":.7,"filter.cutoff":1500,"filter.resonance":5,"filter.env":2.5,"env1.attack":.001,"env1.decay":.8,"env1.sustain":.35,"env1.release":.3,"env2.sustain":.9,"voices.portamento":.12,"fx.mix":.3,"fx.delayTime":.4,"fx.feedback":.45}),X(`Wobble Sub`,{"voices.mode":`mono`,"osc.sub":.8,"filter.cutoff":260,"filter.resonance":6,"filter.lfo":2.2,"filter.env":.5,"lfo.sync":1,"lfo.division":`1/8`,"env2.sustain":.95,level:.55}),X(`Bell Pluck`,{"osc.wave":`tri`,"osc.sub":0,"filter.cutoff":8e3,"filter.resonance":.3,"filter.env":.2,"osc.vibrato":4,"env1.attack":.001,"env1.decay":.5,"env1.sustain":0,"env1.release":.4,"env2.attack":.001,"env2.decay":1.6,"env2.sustain":0,"env2.release":1.4,"fx.chorus":.3,"fx.mix":.3,"fx.delayTime":.5,"fx.feedback":.5})],[X(`Init`,{}),X(`Analog Poly`,{"filter.cutoff":1800,"filter.resonance":1.5,"filter.env":2,"env1.attack":.01,"env1.decay":.5,"env1.sustain":.35,"env1.release":.4,"env2.attack":.01,"env2.decay":.4,"env2.sustain":.75,"env2.release":.4,"fx.chorus":.35}),X(`Choir Air`,{"osc.wave":`pulse`,"osc.width":40,"osc.pwm":.2,"filter.cutoff":1600,"filter.resonance":2.5,"filter.env":1,"env2.attack":.35,"env2.decay":.6,"env2.sustain":.85,"env2.release":1.1,"fx.chorus":.6,"fx.mix":.2}),X(`Retro Stab`,{"filter.cutoff":600,"filter.resonance":2,"filter.env":4,"env1.attack":.001,"env1.decay":.22,"env1.sustain":0,"env1.release":.2,"env2.attack":.001,"env2.decay":.25,"env2.sustain":0,"env2.release":.2,"fx.chorus":.5}),X(`Fifth Lead`,{"voices.mode":`unison`,"voices.detune":18,"filter.cutoff":2600,"filter.resonance":2,"filter.env":1.5,"env2.sustain":.8,"voices.portamento":.08,"fx.mix":.25}),X(`Dream Wash`,{"osc.sub":.4,"filter.cutoff":1100,"lfo.rate":.3,"filter.lfo":.4,"env1.attack":1.8,"env1.decay":1,"env1.sustain":.6,"env1.release":2.5,"env2.attack":1.5,"env2.decay":1,"env2.sustain":.85,"env2.release":3,"fx.chorus":.9,"fx.mix":.4,"fx.delayTime":.6,"fx.feedback":.6,level:.55}),X(`Pulse Organ`,{"osc.wave":`pulse`,"osc.width":50,"osc.sub":.5,"filter.cutoff":3200,"filter.resonance":.5,"filter.env":.3,"osc.vibrato":6,"lfo.rate":6.5,"env2.attack":.005,"env2.decay":.1,"env2.sustain":1,"env2.release":.08,"fx.chorus":.3}),X(`Space Arp`,{"osc.wave":`pulse`,"osc.width":25,"osc.pwm":.6,"lfo.rate":1.2,"filter.cutoff":1e3,"filter.resonance":3,"filter.env":3,"env1.attack":.001,"env1.decay":.25,"env1.sustain":.1,"env1.release":.2,"env2.attack":.002,"env2.decay":.3,"env2.sustain":.2,"env2.release":.25,"fx.mix":.4,"fx.delayTime":.38,"fx.feedback":.55,"fx.chorus":.2})]],Tr=wr.flat(),Er=1200,Dr=69,Or=200,kr=100,Ar=1,jr=[`saw`,`pulse`,`tri`],Mr=[`tri`,`up`,`down`,`sqr`,`rnd`],Nr=[`1/1`,`1/2`,`1/4`,`1/8`,`1/16`,`1/32`],Pr={poly:.45,mono:.6,unison:.34},Fr=.65,Ir=class extends w{name;transport;slots=[...Tr];currentSlot=wr[0].length;currentPreset=this.slots[this.currentSlot];allocator=new Xn(6);held=[];bend=0;modWheelValue=0;vibratoCents=0;portamento=0;unisonDetune=12;lfoHz=5;lfoSync=!1;lfoDivision=`1/8`;clockPulses=0;performanceListeners=new Set;noteListeners=new Set;presetListeners=new Set;constructor(e=`Poly`,t=new O){super(),this.name=e,this.transport=new $e(t),this.transport.channel.set(`2`);let n=this.circuit;this.addShared(n);for(let e=0;e<6;e++)this.addVoice(n,e);this.addEffects(n),this.outputList.push({name:`out`,nodeId:`level`}),this.addControls(n),this.transport.tempo.onChange(()=>this.applyLfoRate())}keyDown(e){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.apply(this.allocator.noteOn(e)),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.apply(this.allocator.noteOff(e)),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}voiceActive(e){return this.allocator.isActive(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*Or),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.applyVibrato(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(e.type===`clock`)this.lfoSync&&this.transport.synced&&++this.clockPulses%24==0&&this.applyLfoRate();else if(!(`channel`in e&&!this.transport.acceptsChannel(e.channel)))switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===Ar&&this.setModWheel(e.value/127);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...Cr,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e,t=this.slots[e].name){let n={name:t,values:this.snapshot()};this.slots[e]=n,this.currentSlot=e,this.currentPreset=n;for(let e of this.presetListeners)e();return n}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}apply(e){let t=this.circuit;for(let n of e){let e=e=>`v${n.voice}.${e}`;n.kind===`off`?(t.setParam(e(`env1`),`gate`,0),t.setParam(e(`env2`),`gate`,0)):(n.glide||t.setParam(e(`pitch`),`glide`,0),t.setParam(e(`pitch`),`offset`,(n.note-Dr)*100),n.glide||t.setParam(e(`pitch`),`glide`,this.portamento),n.retrigger&&(t.setParam(e(`env1`),`gate`,1),t.setParam(e(`env2`),`gate`,1)))}}eachVoice(e){for(let t=0;t<6;t++)e(e=>`v${t}.${e}`)}applyMode(e){this.apply(this.allocator.releaseAll()),this.held=[],this.allocator.mode=e,this.eachVoice(t=>this.circuit.setParam(t(`out`),`gain`,Pr[e])),this.applyDetune(),this.notifyNotes()}applyDetune(){let e=this.allocator.mode===`unison`?this.unisonDetune:0,t=5/2;for(let n=0;n<6;n++){let r=(n-t)/t*e;this.circuit.setParam(`v${n}.det`,`offset`,r===0?0:r)}}applyVibrato(){this.circuit.setParam(`lfoPitch`,`gain`,this.vibratoCents+this.modWheelValue*kr)}applyLfoRate(){let e=Number(this.lfoDivision.split(`/`)[1]),t=this.lfoSync?this.transport.bpm/60*e/4:this.lfoHz;this.circuit.setParam(`lfoOsc`,`frequency`,t),this.circuit.setParam(`lfoRnd`,`rate`,t)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}addShared(e){e.add(`bend`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:-1200}).add(`pwCv`,`constant`,{offset:0}).add(`lfoOsc`,`oscillator`,{frequency:5,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:5}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoSign`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0}).add(`lfoAmp`,`gain`,{gain:0}).add(`voices`,`gain`,{gain:1}).connect(`lfoOsc`,`lfoOscOut`).connect(`lfoOscOut`,`lfoSign`).connect(`lfoSign`,`lfo`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoRndOut`,`lfo`);for(let t of[`lfoPitch`,`lfoPw`,`lfoFilter`,`lfoAmp`])e.connect(`lfo`,t)}addVoice(e,t){let n=e=>`v${t}.${e}`;e.add(n(`pitch`),`constant`,{offset:0,glide:0}).add(n(`det`),`constant`,{offset:0}).add(n(`osc`),`oscillator`,{frequency:440,detune:0},{waveform:`sawtooth`}).add(n(`sub`),`oscillator`,{frequency:440,detune:0},{waveform:`square`}).add(n(`rawOut`),`gain`,{gain:1}).add(n(`pulseSum`),`gain`,{gain:1}).add(n(`shaper`),`waveshaper`,{},{curve:`pulse`}).add(n(`pulseOut`),`gain`,{gain:0}).add(n(`subLevel`),`gain`,{gain:0}).add(n(`mix`),`gain`,{gain:.5}).add(n(`f1`),`filter`,{frequency:2400,Q:1,detune:0},{type:`lowpass`}).add(n(`f2`),`filter`,{frequency:2400,Q:.707,detune:0},{type:`lowpass`}).add(n(`keyFollow`),`gain`,{gain:.5}).add(n(`env1`),`envelope`,{attack:.005,decay:.4,sustain:.4,release:.4,gate:0}).add(n(`env1Depth`),`gain`,{gain:2*Er}).add(n(`env2`),`envelope`,{attack:.005,decay:.3,sustain:.7,release:.35,gate:0}).add(n(`amp`),`gain`,{gain:0}).add(n(`trem`),`gain`,{gain:1}).add(n(`ampKey`),`gain`,{gain:0}).add(n(`out`),`gain`,{gain:Pr.poly});for(let t of[`osc`,`sub`])e.connect(n(`pitch`),n(t),`detune`).connect(n(`det`),n(t),`detune`).connect(`bend`,n(t),`detune`).connect(`lfoPitch`,n(t),`detune`);e.connect(`subShift`,n(`sub`),`detune`).connect(n(`osc`),n(`rawOut`)).connect(n(`osc`),n(`pulseSum`)).connect(`pwCv`,n(`pulseSum`)).connect(`lfoPw`,n(`pulseSum`)).connect(n(`pulseSum`),n(`shaper`)).connect(n(`shaper`),n(`pulseOut`)).connect(n(`rawOut`),n(`mix`)).connect(n(`pulseOut`),n(`mix`)).connect(n(`sub`),n(`subLevel`)).connect(n(`subLevel`),n(`mix`)).connect(n(`mix`),n(`f1`)).connect(n(`f1`),n(`f2`)).connect(n(`f2`),n(`amp`)).connect(n(`env1`),n(`env1Depth`)).connect(n(`pitch`),n(`keyFollow`));for(let t of[`f1`,`f2`])e.connect(n(`env1Depth`),n(t),`detune`).connect(n(`keyFollow`),n(t),`detune`).connect(`lfoFilter`,n(t),`detune`);e.connect(n(`env2`),n(`amp`),`gain`).connect(n(`amp`),n(`trem`)).connect(`lfoAmp`,n(`trem`),`gain`).connect(n(`pitch`),n(`ampKey`)).connect(n(`ampKey`),n(`trem`),`gain`).connect(n(`trem`),n(`out`)).connect(n(`out`),`voices`)}addEffects(e){e.add(`chorusDry`,`gain`,{gain:1}).add(`chorusWet`,`gain`,{gain:0}).add(`chDelayA`,`delay`,{delayTime:.016,maxTime:.05}).add(`chDelayB`,`delay`,{delayTime:.024,maxTime:.05}).add(`chLfoA`,`oscillator`,{frequency:.62,detune:0},{waveform:`sine`}).add(`chLfoB`,`oscillator`,{frequency:.83,detune:0},{waveform:`sine`}).add(`chDepthA`,`gain`,{gain:.0025}).add(`chDepthB`,`gain`,{gain:.003}).add(`fxMix`,`gain`,{gain:1}).connect(`voices`,`chorusDry`).connect(`chorusDry`,`fxMix`).connect(`voices`,`chDelayA`).connect(`voices`,`chDelayB`).connect(`chDelayA`,`chorusWet`).connect(`chDelayB`,`chorusWet`).connect(`chorusWet`,`fxMix`).connect(`chLfoA`,`chDepthA`).connect(`chDepthA`,`chDelayA`,`delayTime`).connect(`chLfoB`,`chDepthB`).connect(`chDepthB`,`chDelayB`,`delayTime`),e.add(`dlyLine`,`delay`,{delayTime:.35,maxTime:1.5}).add(`dlyTone`,`filter`,{frequency:4500,Q:.707,detune:0},{type:`lowpass`}).add(`dlyFb`,`gain`,{gain:.3}).add(`dlyWet`,`gain`,{gain:0}).add(`dlySum`,`gain`,{gain:1}).add(`level`,`gain`,{gain:.7}).connect(`fxMix`,`dlySum`).connect(`fxMix`,`dlyLine`).connect(`dlyLine`,`dlyTone`).connect(`dlyTone`,`dlyFb`).connect(`dlyFb`,`dlyLine`).connect(`dlyTone`,`dlyWet`).connect(`dlyWet`,`dlySum`).connect(`dlySum`,`level`)}addControls(e){let t=(e,t,n,r,i,a,o,s)=>this.controlList.push(new T(e,t,n,r,i,a,o,s)),n=e=>t=>this.eachVoice(n=>e(n,t)),r=Cr,i=e=>r[e],a=(r,a,o,s,c)=>t(`${r}.${a}`,o,s,c,i(`${r}.${a}`),`s`,n((t,n)=>e.setParam(t(r),a,n)),`log`),o=r=>t(`${r}.sustain`,`Sustain`,0,1,i(`${r}.sustain`),``,n((t,n)=>e.setParam(t(r),`sustain`,n)));this.controlList.push(new E(`osc.wave`,`Wave`,jr,r[`osc.wave`],t=>this.eachVoice(n=>{e.setOption(n(`osc`),`waveform`,t===`tri`?`triangle`:`sawtooth`),e.setParam(n(`rawOut`),`gain`,t===`pulse`?0:1),e.setParam(n(`pulseOut`),`gain`,t===`pulse`?Fr:0)}))),t(`osc.width`,`Width`,5,50,i(`osc.width`),`%`,t=>e.setParam(`pwCv`,`offset`,1-2*t/100)),t(`osc.pwm`,`LFO PWM`,0,100,i(`osc.pwm`)*100,`%`,t=>e.setParam(`lfoPw`,`gain`,t/100*.9)),t(`osc.vibrato`,`LFO Pitch`,0,100,i(`osc.vibrato`),`ct`,e=>{this.vibratoCents=e,this.applyVibrato()}),t(`osc.sub`,`Sub`,0,1,i(`osc.sub`),``,n((t,n)=>e.setParam(t(`subLevel`),`gain`,n*.6))),t(`filter.cutoff`,`Cutoff`,20,2e4,i(`filter.cutoff`),`Hz`,n((t,n)=>{e.setParam(t(`f1`),`frequency`,n),e.setParam(t(`f2`),`frequency`,n)}),`log`),t(`filter.resonance`,`Resonance`,.1,20,i(`filter.resonance`),``,n((t,n)=>e.setParam(t(`f1`),`Q`,n))),t(`filter.env`,`Env 1`,0,6,i(`filter.env`),`oct`,n((t,n)=>e.setParam(t(`env1Depth`),`gain`,n*Er))),t(`filter.lfo`,`LFO`,0,4,i(`filter.lfo`),`oct`,t=>e.setParam(`lfoFilter`,`gain`,t*Er)),t(`filter.key`,`Key track`,0,100,i(`filter.key`),`%`,n((t,n)=>e.setParam(t(`keyFollow`),`gain`,n/100))),t(`amp.lfo`,`LFO`,0,100,i(`amp.lfo`),`%`,t=>e.setParam(`lfoAmp`,`gain`,t/100*.8)),t(`amp.key`,`Key track`,0,100,i(`amp.key`),`%`,n((t,n)=>e.setParam(t(`ampKey`),`gain`,n/100/6e3))),t(`level`,`Volume`,0,1,i(`level`),``,t=>e.setParam(`level`,`gain`,t)),this.controlList.push(new E(`lfo.wave`,`Wave`,Mr,r[`lfo.wave`],t=>{e.setOption(`lfoOsc`,`waveform`,t===`sqr`?`square`:t===`up`||t===`down`?`sawtooth`:`triangle`),e.setParam(`lfoSign`,`gain`,t===`down`?-1:1),e.setParam(`lfoOscOut`,`gain`,t===`rnd`?0:1),e.setParam(`lfoRndOut`,`gain`,+(t===`rnd`))})),t(`lfo.rate`,`Rate`,.1,30,i(`lfo.rate`),`Hz`,e=>{this.lfoHz=e,this.applyLfoRate()},`log`),this.controlList.push(new D(`lfo.sync`,`Sync`,!1,e=>{this.lfoSync=e,this.applyLfoRate()}),new E(`lfo.division`,`Division`,Nr,r[`lfo.division`],e=>{this.lfoDivision=e,this.applyLfoRate()}));for(let e of[`env1`,`env2`])a(e,`attack`,`Attack`,.001,5),a(e,`decay`,`Decay`,.005,5),o(e),a(e,`release`,`Release`,.005,10);this.controlList.push(new E(`voices.mode`,`Mode`,Yn,r[`voices.mode`],e=>this.applyMode(e))),t(`voices.portamento`,`Portamento`,0,2,i(`voices.portamento`),`s`,t=>{this.portamento=t,this.eachVoice(n=>e.setParam(n(`pitch`),`glide`,t))}),t(`voices.detune`,`Detune`,0,50,i(`voices.detune`),`ct`,e=>{this.unisonDetune=e,this.applyDetune()}),t(`fx.chorus`,`Chorus`,0,1,i(`fx.chorus`),``,t=>{e.setParam(`chorusWet`,`gain`,t*.7),e.setParam(`chorusDry`,`gain`,1-t*.25)}),t(`fx.delayTime`,`Delay time`,.01,1,i(`fx.delayTime`),`s`,t=>e.setParam(`dlyLine`,`delayTime`,t),`log`),t(`fx.feedback`,`Feedback`,0,.9,i(`fx.feedback`),``,t=>e.setParam(`dlyFb`,`gain`,t)),t(`fx.mix`,`Delay mix`,0,1,i(`fx.mix`),``,t=>e.setParam(`dlyWet`,`gain`,t))}},Lr={"spring.length":2,"spring.tension":.5,"spring.drip":.6,"spring.tilt":0,"spring.dwell":.4,"spring.mix":.25},Rr=1.6,zr=class extends w{name;constructor(e=`Spring`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`spring`,`spring`,{tension:.5,drip:.6,decay:2,tilt:0,dwell:.4}).add(`dry`,`gain`,{gain:1}).add(`wet`,`gain`,{gain:0}).add(`sum`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`spring`).connect(`in`,`dry`).connect(`spring`,`wet`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=(e,t,n,r,i,a,o)=>this.controlList.push(new T(e,t,n,r,Lr[e],i,a,o));n(`spring.length`,`Length`,.2,8,`s`,e=>t.setParam(`spring`,`decay`,e),`log`),n(`spring.tension`,`Tension`,0,1,``,e=>t.setParam(`spring`,`tension`,e)),n(`spring.drip`,`Drip`,0,1,``,e=>t.setParam(`spring`,`drip`,e)),n(`spring.tilt`,`Tilt`,-1,1,``,e=>t.setParam(`spring`,`tilt`,e)),n(`spring.dwell`,`Dwell`,0,1,``,e=>t.setParam(`spring`,`dwell`,e)),n(`spring.mix`,`Dry / wet`,0,1,``,e=>{t.setParam(`dry`,`gain`,Math.cos(e*Math.PI/2)),t.setParam(`wet`,`gain`,Math.sin(e*Math.PI/2)*Rr)})}reset(){for(let e of this.controlList)e.kind===`number`&&e.set(e.initial)}},Br=75,Vr=10,Hr=15,Ur=.3,Wr=[`A`,`B`,`C`],Gr=[[1,2],[3,4],[5,6]],Kr=class extends w{channelCount;returnCount;returnFeeds;lineCount;name;muted=new Set;soloed=new Set;constructor(e=1,t=`Mixer`,n=0,r={},i=0){super(),this.channelCount=e,this.returnCount=n,this.returnFeeds=r,this.lineCount=i,this.name=t;let a=this.circuit;a.add(`main`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`ceiling`,`waveshaper`,{},{curve:`limit`}).add(`mainMeter`,`meter`,{},{channel:`mono`}).connect(`main`,`limiter`).connect(`limiter`,`ceiling`).connect(`ceiling`,`mainMeter`),this.outputList.push({name:`main`,nodeId:`ceiling`}),a.add(`key`,`gain`,{gain:1}),this.outputList.push({name:`key`,nodeId:`key`}),this.meterList.push({name:`main`,nodeId:`mainMeter`});for(let e of Wr){let t=`bus${e}`;a.add(t,`gain`,{gain:1}).add(`${t}.toMain`,`gain`,{gain:1}).add(`${t}.meterL`,`meter`,{},{channel:`left`}).add(`${t}.meterR`,`meter`,{},{channel:`right`}).connect(t,`${t}.toMain`).connect(`${t}.toMain`,`main`).connect(t,`${t}.meterL`).connect(t,`${t}.meterR`),this.outputList.push({name:t,nodeId:t}),this.meterList.push({name:`${t}.L`,nodeId:`${t}.meterL`},{name:`${t}.R`,nodeId:`${t}.meterR`}),this.controlList.push(new T(`${t}.fader`,`Bus ${e}`,0,1.5,1,``,e=>a.setParam(t,`gain`,e)),new D(`${t}.main`,`To main`,!0,e=>a.setParam(`${t}.toMain`,`gain`,+!!e)))}for(let e=1;e<=6;e++)a.add(`aux${e}`,`gain`,{gain:1}),this.outputList.push({name:`aux${e}`,nodeId:`aux${e}`}),this.controlList.push(new T(`aux${e}.master`,`Aux ${e}`,0,1.5,1,``,t=>a.setParam(`aux${e}`,`gain`,t)));for(let t=1;t<=e;t++)this.addStrip(`ch${t}`,t,`channel`);for(let e=1;e<=n;e++)this.addStrip(`ret${e}`,e,`return`);for(let e=1;e<=i;e++)this.addStrip(`line${e}`,e,`line`);this.controlList.push(new T(`comp.ms`,`Delay comp`,0,Ur*1e3,0,`ms`,t=>{for(let n=1;n<=e;n++)a.setParam(`ch${n}.comp`,`delayTime`,t/1e3);for(let e=1;e<=i;e++)a.setParam(`line${e}.comp`,`delayTime`,t/1e3)}),new E(`key.source`,`Key source`,[`off`,...Array.from({length:e},(e,t)=>`${t+1}`)],`off`,t=>{for(let n=1;n<=e;n++)a.setParam(`ch${n}.keySend`,`gain`,+(t===`${n}`))}))}addStrip(e,t,n){let r=this.circuit,i=n!==`channel`,a=t=>`${e}.${t}`;r.add(a(`lowcut`),`filter`,{frequency:Vr,Q:.707,gain:0},{type:`highpass`}).add(a(`eqLow`),`filter`,{frequency:80,Q:.707,gain:0},{type:`lowshelf`}).add(a(`eqMid`),`filter`,{frequency:2500,Q:1,gain:0},{type:`peaking`}).add(a(`eqHigh`),`filter`,{frequency:12e3,Q:.707,gain:0},{type:`highshelf`}).add(a(`drive`),`gain`,{gain:1/3}).add(a(`sat`),`waveshaper`,{},{curve:`warm`}).add(a(`mute`),`gain`,{gain:1}).add(a(`fader`),`gain`,{gain:.8}).add(a(`pan`),`pan`,{pan:0}).connect(a(`lowcut`),a(`eqLow`)).connect(a(`eqLow`),a(`eqMid`)).connect(a(`eqMid`),a(`eqHigh`)).connect(a(`eqHigh`),a(`drive`)).connect(a(`drive`),a(`sat`)).connect(a(`sat`),a(`mute`)).connect(a(`mute`),a(`fader`)).connect(a(`fader`),a(`pan`)),i?(r.add(a(`meterL`),`meter`,{},{channel:`left`}).add(a(`meterR`),`meter`,{},{channel:`right`}).connect(a(`pan`),a(`meterL`)).connect(a(`pan`),a(`meterR`)),this.meterList.push({name:`${e}.L`,nodeId:a(`meterL`)},{name:`${e}.R`,nodeId:a(`meterR`)})):(r.add(a(`meter`),`meter`,{},{channel:`mono`}).connect(a(`fader`),a(`meter`)).add(a(`keySend`),`gain`,{gain:0}).connect(a(`mute`),a(`keySend`)).connect(a(`keySend`),`key`),this.meterList.push({name:e,nodeId:a(`meter`)})),this.inputList.push({name:e,nodeId:a(`lowcut`)});let o=Wr.filter(e=>n!==`return`||this.returnFeeds[t]!==e);n!==`return`&&r.add(a(`comp`),`delay`,{delayTime:0,maxTime:Ur}).connect(a(`pan`),a(`comp`));for(let e of o){let t=a(e===`A`&&n!==`return`?`comp`:`pan`);r.add(a(`assign${e}`),`gain`,{gain:0}).connect(t,a(`assign${e}`)).connect(a(`assign${e}`),`bus${e}`)}for(let e=1;e<=6;e++)r.add(a(`aux${e}.pre`),`gain`,{gain:0}).add(a(`aux${e}.post`),`gain`,{gain:1}).add(a(`aux${e}`),`gain`,{gain:0}).connect(a(`mute`),a(`aux${e}.pre`)).connect(a(`fader`),a(`aux${e}.post`)).connect(a(`aux${e}.pre`),a(`aux${e}`)).connect(a(`aux${e}.post`),a(`aux${e}`)).connect(a(`aux${e}`),`aux${e}`);let s=(e,t,n,r,i,o,s,c)=>new T(a(e),t,n,r,i,o,s,c),c=(e,t,n)=>s(e,t,-15,Hr,0,`dB`,e=>r.setParam(a(n),`gain`,e));this.controlList.push(new D(a(`lowcutOn`),`Low cut`,!1,e=>r.setParam(a(`lowcut`),`frequency`,e?Br:Vr)),c(`eqHigh`,`High`,`eqHigh`),c(`eqMid`,`Mid`,`eqMid`),s(`eqMidFreq`,`Freq`,100,8e3,2500,`Hz`,e=>r.setParam(a(`eqMid`),`frequency`,e),`log`),c(`eqLow`,`Low`,`eqLow`));for(let e=1;e<=6;e++)this.controlList.push(s(`aux${e}`,`${e}`,0,1,0,``,t=>r.setParam(a(`aux${e}`),`gain`,t)));for(let[e,t]of Gr)this.controlList.push(new D(a(`auxPre${e}${t}`),`Pre ${e}-${t}`,!1,n=>{for(let i of[e,t])r.setParam(a(`aux${i}.pre`),`gain`,+!!n),r.setParam(a(`aux${i}.post`),`gain`,+!n)}));this.controlList.push(s(`pan`,i?`Balance`:`Pan`,-1,1,0,``,e=>r.setParam(a(`pan`),`pan`,e))),i?this.controlList.push(new D(a(`mute`),`Mute`,!1,e=>r.setParam(a(`mute`),`gain`,+!e))):this.controlList.push(new D(a(`mute`),`Mute`,!1,e=>this.setFlag(this.muted,t,e)),new D(a(`solo`),`Solo`,!1,e=>this.setFlag(this.soloed,t,e)));for(let e of o)this.controlList.push(new D(a(`bus${e}`),e,e===`A`,t=>r.setParam(a(`assign${e}`),`gain`,+!!t)));this.controlList.push(s(`fader`,`Fader`,0,1.5,.8,``,e=>r.setParam(a(`fader`),`gain`,e)))}get soloActive(){return this.soloed.size>0}setFlag(e,t,n){n?e.add(t):e.delete(t);for(let e=1;e<=this.channelCount;e++){let t=`ch${e}.mute`;if(!this.circuit.nodes.has(t))continue;let n=this.muted.has(e)||this.soloed.size>0&&!this.soloed.has(e);this.circuit.setParam(t,`gain`,+!n)}}},qr={"osc.range":`8'`,"osc.width":50,"osc.pwSource":`man`,"osc.pwm":0,"osc.mod":0,"osc.sub":`-1`,"mix.saw":.8,"mix.pulse":0,"mix.sub":.55,"mix.noise":.05,"filter.cutoff":800,"filter.resonance":1,"filter.keyFollow":50,"filter.lfo":0,"filterEnv.amount":2,"filterEnv.attack":.005,"filterEnv.decay":.3,"filterEnv.sustain":.3,"filterEnv.release":.3,"ampEnv.attack":.005,"ampEnv.decay":.2,"ampEnv.sustain":.7,"ampEnv.release":.3,"lfo.wave":`tri`,"lfo.rate":4.8,"perf.glide":0,"perf.notes":`legato`,accent:0,drive:0,"drive.tilt":0,level:.5},Z=(e,t)=>({name:e,values:t}),Jr=[Z(`Init`,{}),Z(`Sub Bass`,{"osc.range":`16'`,"mix.saw":.5,"mix.sub":.95,"mix.noise":0,"filter.cutoff":380,"filter.resonance":2,"filter.keyFollow":30,"filterEnv.amount":1.5,"filterEnv.attack":.001,"filterEnv.decay":.25,"filterEnv.sustain":.2,"ampEnv.attack":.002,"ampEnv.decay":.3,"ampEnv.sustain":.85,"ampEnv.release":.12,level:.6}),Z(`Acid Squelch`,{"osc.range":`16'`,"mix.saw":1,"mix.sub":.35,"mix.noise":0,"filter.cutoff":220,"filter.resonance":14,"filter.keyFollow":40,"filterEnv.amount":4,"filterEnv.attack":.001,"filterEnv.decay":.18,"filterEnv.sustain":0,"filterEnv.release":.1,"ampEnv.sustain":.9,"ampEnv.release":.08,"perf.glide":.08,accent:.7,level:.45}),Z(`Fat Pulse Bass`,{"osc.range":`16'`,"osc.width":30,"mix.saw":0,"mix.pulse":.9,"mix.sub":.5,"mix.noise":0,"filter.cutoff":520,"filter.resonance":3,"filterEnv.amount":2,"filterEnv.decay":.3,"filterEnv.sustain":.2,"ampEnv.sustain":.85,"ampEnv.release":.1}),Z(`Wobble Bass`,{"osc.range":`16'`,"mix.saw":.8,"mix.sub":.7,"mix.noise":0,"filter.cutoff":300,"filter.resonance":6,"filter.lfo":2,"filterEnv.amount":.5,"filterEnv.sustain":.5,"lfo.wave":`tri`,"lfo.rate":3,"ampEnv.sustain":1,"ampEnv.release":.12,level:.55}),Z(`Funk Pluck`,{"osc.range":`8'`,"osc.width":25,"mix.saw":.3,"mix.pulse":.8,"mix.sub":.3,"mix.noise":0,"filter.cutoff":260,"filter.resonance":5,"filter.keyFollow":60,"filterEnv.amount":3.5,"filterEnv.attack":.001,"filterEnv.decay":.15,"filterEnv.sustain":0,"ampEnv.attack":.001,"ampEnv.decay":.2,"ampEnv.sustain":.3,"ampEnv.release":.1}),Z(`Rubber Bass`,{"osc.range":`16'`,"mix.saw":.7,"mix.sub":.8,"mix.noise":0,"filter.cutoff":150,"filter.resonance":8,"filter.keyFollow":25,"filterEnv.amount":3,"filterEnv.attack":.001,"filterEnv.decay":.3,"filterEnv.sustain":.1,"ampEnv.sustain":.8,"ampEnv.release":.1,level:.55}),Z(`Saw Lead`,{"mix.saw":1,"mix.sub":.2,"mix.noise":0,"filter.cutoff":3e3,"filter.resonance":3,"filter.keyFollow":70,"filterEnv.amount":1,"perf.glide":.06,"osc.mod":15,"lfo.rate":5.5,"ampEnv.sustain":.9,"ampEnv.release":.25}),Z(`Hollow Pulse Lead`,{"osc.width":18,"mix.saw":0,"mix.pulse":1,"mix.sub":0,"mix.noise":0,"filter.cutoff":2500,"filter.resonance":2,"filter.keyFollow":80,"filterEnv.amount":1.5,"filterEnv.attack":.01,"filterEnv.decay":.4,"filterEnv.sustain":.5,"ampEnv.sustain":.8,"ampEnv.release":.2}),Z(`PWM Lead`,{"mix.saw":.2,"mix.pulse":.9,"mix.sub":.2,"mix.noise":0,"osc.pwSource":`lfo`,"osc.pwm":70,"lfo.rate":1.2,"filter.cutoff":3e3,"filter.resonance":2,"filter.keyFollow":70,"filterEnv.amount":1,"ampEnv.sustain":.9,"ampEnv.release":.3}),Z(`Vibrato Lead`,{"mix.saw":.8,"mix.pulse":.4,"mix.sub":.1,"mix.noise":0,"osc.mod":40,"lfo.rate":5.2,"filter.cutoff":2800,"filter.resonance":3,"filter.keyFollow":70,"filterEnv.amount":1.2,"perf.glide":.1,"ampEnv.attack":.01,"ampEnv.sustain":.9,"ampEnv.release":.3}),Z(`Portamento Solo`,{"mix.saw":1,"mix.sub":.3,"mix.noise":0,"perf.glide":.35,"perf.notes":`legato`,"filter.cutoff":2200,"filter.resonance":4,"filterEnv.amount":.8,"filterEnv.sustain":.6,"ampEnv.sustain":1,"ampEnv.release":.2}),Z(`Clarinet`,{"osc.width":50,"mix.saw":0,"mix.pulse":1,"mix.sub":0,"mix.noise":.03,"filter.cutoff":1800,"filter.resonance":1,"filter.keyFollow":70,"filterEnv.amount":1,"filterEnv.attack":.04,"filterEnv.sustain":.6,"ampEnv.attack":.04,"ampEnv.sustain":.9,"ampEnv.release":.12,"osc.mod":8,"lfo.rate":5}),Z(`Brass`,{"mix.saw":1,"mix.pulse":.4,"mix.sub":.2,"mix.noise":0,"filter.cutoff":500,"filter.resonance":2,"filter.keyFollow":60,"filterEnv.amount":3,"filterEnv.attack":.12,"filterEnv.decay":.3,"filterEnv.sustain":.6,"ampEnv.attack":.08,"ampEnv.decay":.2,"ampEnv.sustain":.85,"ampEnv.release":.2}),Z(`Siren`,{"mix.saw":1,"mix.sub":0,"mix.noise":0,"osc.mod":600,"lfo.wave":`tri`,"lfo.rate":.7,"filter.cutoff":4e3,"filter.resonance":2,"filterEnv.amount":0,"ampEnv.sustain":1,"ampEnv.release":.15}),Z(`Random SFX`,{"mix.saw":.5,"mix.pulse":.5,"mix.sub":0,"mix.noise":0,"lfo.wave":`rnd`,"lfo.rate":9,"osc.mod":500,"filter.cutoff":1200,"filter.resonance":8,"filter.lfo":2.5,"filterEnv.amount":0,"ampEnv.attack":.01,"ampEnv.sustain":1,"ampEnv.release":.1,level:.45}),Z(`Snare`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":1,"filter.cutoff":3e3,"filter.resonance":2,"filter.keyFollow":0,"filterEnv.amount":1,"filterEnv.attack":.001,"filterEnv.decay":.1,"filterEnv.sustain":0,"ampEnv.attack":.001,"ampEnv.decay":.18,"ampEnv.sustain":0,"ampEnv.release":.1,level:.6}),Z(`Wind`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":1,"filter.cutoff":500,"filter.resonance":8,"filter.keyFollow":0,"filterEnv.amount":4,"filterEnv.attack":2,"filterEnv.decay":2,"filterEnv.sustain":.5,"filterEnv.release":2,"ampEnv.attack":1.5,"ampEnv.sustain":1,"ampEnv.release":2,level:.5}),Z(`Whistle`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":.6,"filter.cutoff":2e3,"filter.resonance":20,"filter.keyFollow":100,"filterEnv.amount":0,"osc.mod":20,"lfo.rate":5,"ampEnv.attack":.05,"ampEnv.sustain":1,"ampEnv.release":.2,level:.35})],Yr=new Map([[70,`filter.cutoff`],[71,`filter.resonance`],[72,`filterEnv.amount`],[73,`filterEnv.decay`],[74,`ampEnv.decay`],[75,`ampEnv.release`],[76,`osc.width`],[77,`osc.pwm`],[78,`mix.pulse`],[79,`mix.sub`],[80,`mix.noise`],[81,`lfo.rate`],[82,`osc.mod`],[83,`perf.glide`]]);function Xr(e,t){let n=Math.min(127,Math.max(0,t))/127;if(e.kind===`number`)e.set(e.curve===`log`?e.min*(e.max/e.min)**+n:e.min+n*(e.max-e.min));else if(e.kind===`choice`){let t=Math.min(e.options.length-1,Math.floor(n*e.options.length));e.set(e.options[t])}else e.set(t>=64)}var Zr=1200,Qr=200,$r=100,ei=1,ti=440,ni=4.8,ri=[`man`,`lfo`,`env`],ii=[`legato`,`retrig`],ai=[`tri`,`sqr`,`rnd`],oi={"16'":-1200,"8'":0,"4'":1200,"2'":2400},si={"-1":-1200,"-2":-2400},ci=.6,li=.8,ui=.12,di=700,fi=class extends w{name;transport;ccMap=new Map(Yr);held=[];presetListeners=new Set;currentPreset=Jr[0];gateOpen=!1;glideSeconds=0;retrigger=!1;pwSource=`man`;pwmAmount=0;bend=0;modWheelValue=0;oscModCents=0;accentAmount=0;envAmount=2;envDecay=.3;accented=!1;performanceListeners=new Set;noteListeners=new Set;constructor(e=`Synth`,t=new O){super(),this.name=e,this.transport=new $e(t);let n=this.circuit;n.add(`pitch`,`constant`,{offset:0,glide:0}).add(`range`,`constant`,{offset:0}).add(`bend`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:si[-1]}).add(`pulseWidthCv`,`constant`,{offset:0}).add(`sawOsc`,`oscillator`,{frequency:ti,detune:0},{waveform:`sawtooth`}).add(`pulseOsc`,`oscillator`,{frequency:ti,detune:0},{waveform:`sawtooth`}).add(`pulseSum`,`gain`,{gain:1}).add(`pulseShaper`,`waveshaper`,{},{curve:`pulse`}).add(`subOsc`,`oscillator`,{frequency:ti,detune:0},{waveform:`square`}).add(`noise`,`noise`).add(`mix.saw`,`gain`,{gain:.8}).add(`mix.pulse`,`gain`,{gain:0}).add(`mix.sub`,`gain`,{gain:.55}).add(`mix.noise`,`gain`,{gain:.05}).add(`mix`,`gain`,{gain:.5}).add(`filter1`,`filter`,{frequency:800,Q:1,detune:0},{type:`lowpass`}).add(`filter2`,`filter`,{frequency:800,Q:.707,detune:0},{type:`lowpass`}).add(`keyFollow`,`gain`,{gain:.5}).add(`amp`,`gain`,{gain:0}).add(`accentAmp`,`gain`,{gain:1}).add(`level`,`gain`,{gain:.5}).add(`driveDry`,`gain`,{gain:1}).add(`drivePre`,`gain`,{gain:1}).add(`driveTiltLo`,`filter`,{frequency:di,Q:.707,gain:0,detune:0},{type:`lowshelf`}).add(`driveTiltHi`,`filter`,{frequency:di,Q:.707,gain:0,detune:0},{type:`highshelf`}).add(`driveShaper`,`waveshaper`,{},{curve:`soft`}).add(`driveTone`,`filter`,{frequency:4200,Q:.6,detune:0},{type:`lowpass`}).add(`driveWet`,`gain`,{gain:0}).add(`ampEnv`,`envelope`,{attack:.005,decay:.2,sustain:.7,release:.3,gate:0}).add(`filterEnv`,`envelope`,{attack:.005,decay:.3,sustain:.3,release:.3,gate:0}).add(`filterEnvDepth`,`gain`,{gain:2*Zr}).add(`lfoOsc`,`oscillator`,{frequency:ni,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:ni}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`envPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0});for(let e of[`sawOsc`,`pulseOsc`,`subOsc`])n.connect(`pitch`,e,`detune`).connect(`range`,e,`detune`).connect(`bend`,e,`detune`);n.connect(`subShift`,`subOsc`,`detune`).connect(`pulseOsc`,`pulseSum`).connect(`pulseWidthCv`,`pulseSum`).connect(`pulseSum`,`pulseShaper`).connect(`sawOsc`,`mix.saw`).connect(`pulseShaper`,`mix.pulse`).connect(`subOsc`,`mix.sub`).connect(`noise`,`mix.noise`);for(let e of[`mix.saw`,`mix.pulse`,`mix.sub`,`mix.noise`])n.connect(e,`mix`);n.connect(`mix`,`filter1`).connect(`filter1`,`filter2`).connect(`filter2`,`driveDry`).connect(`filter2`,`drivePre`).connect(`drivePre`,`driveTiltLo`).connect(`driveTiltLo`,`driveTiltHi`).connect(`driveTiltHi`,`driveShaper`).connect(`driveShaper`,`driveTone`).connect(`driveTone`,`driveWet`).connect(`driveDry`,`amp`).connect(`driveWet`,`amp`).connect(`amp`,`accentAmp`).connect(`accentAmp`,`level`).connect(`ampEnv`,`amp`,`gain`).connect(`filterEnv`,`filterEnvDepth`).connect(`pitch`,`keyFollow`);for(let e of[`filter1`,`filter2`])n.connect(`filterEnvDepth`,e,`detune`).connect(`keyFollow`,e,`detune`).connect(`lfoFilter`,e,`detune`);for(let e of[`sawOsc`,`pulseOsc`,`subOsc`])n.connect(`lfoPitch`,e,`detune`);n.connect(`lfoOsc`,`lfoOscOut`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoOscOut`,`lfo`).connect(`lfoRndOut`,`lfo`).connect(`lfo`,`lfoPitch`).connect(`lfo`,`lfoPw`).connect(`lfo`,`lfoFilter`).connect(`lfoPw`,`pulseSum`).connect(`filterEnv`,`envPw`).connect(`envPw`,`pulseSum`),this.outputList.push({name:`out`,nodeId:`level`}),this.controlList.push(new E(`osc.range`,`Range`,Object.keys(oi),`8'`,e=>n.setParam(`range`,`offset`,oi[e])),new T(`osc.width`,`Width`,5,50,50,`%`,e=>n.setParam(`pulseWidthCv`,`offset`,1-2*e/100)),new E(`osc.sub`,`Sub`,Object.keys(si),`-1`,e=>n.setParam(`subShift`,`offset`,si[e])),mi(n,`saw`,`Saw`,.8),mi(n,`pulse`,`Pulse`,0),mi(n,`sub`,`Sub`,.55),mi(n,`noise`,`Noise`,.05),new T(`filter.cutoff`,`Cutoff`,20,2e4,800,`Hz`,e=>{n.setParam(`filter1`,`frequency`,e),n.setParam(`filter2`,`frequency`,e)},`log`),new T(`filter.resonance`,`Resonance`,.1,20,1,``,e=>n.setParam(`filter1`,`Q`,e)),new T(`filter.keyFollow`,`Key`,0,100,50,`%`,e=>n.setParam(`keyFollow`,`gain`,e/100)),new T(`perf.glide`,`Glide`,0,3,0,`s`,e=>{this.glideSeconds=e,n.setParam(`pitch`,`glide`,e)}),new E(`perf.notes`,`Notes`,ii,`legato`,e=>{this.retrigger=e===`retrig`}),new E(`lfo.wave`,`Wave`,ai,`tri`,e=>{n.setOption(`lfoOsc`,`waveform`,e===`sqr`?`square`:`triangle`),n.setParam(`lfoOscOut`,`gain`,e===`rnd`?0:1),n.setParam(`lfoRndOut`,`gain`,+(e===`rnd`))}),new T(`lfo.rate`,`Rate`,.1,30,ni,`Hz`,e=>{n.setParam(`lfoOsc`,`frequency`,e),n.setParam(`lfoRnd`,`rate`,e)},`log`),new T(`osc.mod`,`Mod`,0,600,0,`ct`,e=>{this.oscModCents=e,this.applyVibrato()}),new E(`osc.pwSource`,`PW src`,ri,`man`,e=>{this.pwSource=e,this.applyPwm()}),new T(`osc.pwm`,`PWM`,0,100,0,`%`,e=>{this.pwmAmount=e/100,this.applyPwm()}),new T(`filter.lfo`,`LFO`,0,4,0,`oct`,e=>n.setParam(`lfoFilter`,`gain`,e*Zr)),new T(`level`,`Level`,0,1,.5,``,e=>n.setParam(`level`,`gain`,e)),new T(`filterEnv.amount`,`Amount`,0,6,2,`oct`,e=>{this.envAmount=e,this.applyAccent()}),...pi(n,`filterEnv`,{attack:.005,decay:.3,sustain:.3,release:.3},e=>{this.envDecay=e,this.applyAccent()}),new T(`accent`,`Accent`,0,1,0,``,e=>{this.accentAmount=e,this.applyAccent()}),new T(`drive`,`Drive`,0,1,0,``,e=>{let t=Math.min(1,e*3);n.setParam(`driveDry`,`gain`,1-t*.65),n.setParam(`drivePre`,`gain`,1+e*24),n.setParam(`driveWet`,`gain`,t*.55)}),new T(`drive.tilt`,`Tilt`,-12,12,0,`dB`,e=>{n.setParam(`driveTiltLo`,`gain`,-e),n.setParam(`driveTiltHi`,`gain`,e)}),...pi(n,`ampEnv`,{attack:.005,decay:.2,sustain:.7,release:.3}))}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*Qr),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.applyVibrato(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}applyVibrato(){this.circuit.setParam(`lfoPitch`,`gain`,this.oscModCents+this.modWheelValue*$r)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}loadPreset(e){let t={...qr,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}keyDown(e,t=100){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.accented=t>=110,this.applyAccent(),this.noteOn(hi(e)),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e);let t=this.held[this.held.length-1];t===void 0?this.noteOff():this.noteOn(hi(t)),this.notifyNotes()}handleMidi(e){if(!(`channel`in e&&!this.transport.acceptsChannel(e.channel)))switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:{if(e.controller===ei){this.setModWheel(e.value/127);break}let t=this.ccMap.get(e.controller);t&&Xr(this.control(t),e.value);break}case`programChange`:{let t=Jr[e.program];t&&this.loadPreset(t);break}}}applyAccent(){let e=this.accented?this.accentAmount:0,t=this.circuit;t.setParam(`accentAmp`,`gain`,1+e*ci),t.setParam(`filterEnvDepth`,`gain`,this.envAmount*(1+e*li)*Zr),t.setParam(`filterEnv`,`decay`,e>0?Math.min(this.envDecay,ui+(1-e)*this.envDecay):this.envDecay)}applyPwm(){let e=this.pwmAmount*.9;this.circuit.setParam(`lfoPw`,`gain`,this.pwSource===`lfo`?e:0),this.circuit.setParam(`envPw`,`gain`,this.pwSource===`env`?e:0)}noteOn(e){let t=this.gateOpen,n=this.glideSeconds;t||this.circuit.setParam(`pitch`,`glide`,0),this.circuit.setParam(`pitch`,`offset`,Zr*Math.log2(e/ti)),t||this.circuit.setParam(`pitch`,`glide`,n),(!t||this.retrigger)&&(this.circuit.setParam(`ampEnv`,`gate`,1),this.circuit.setParam(`filterEnv`,`gate`,1)),this.gateOpen=!0}noteOff(){this.circuit.setParam(`ampEnv`,`gate`,0),this.circuit.setParam(`filterEnv`,`gate`,0),this.gateOpen=!1}};function pi(e,t,n,r){let i=(r,i,a,o)=>new T(`${t}.${r}`,i,a,o,n[r],`s`,n=>e.setParam(t,r,n),`log`);return[i(`attack`,`Attack`,.001,5),r?new T(`${t}.decay`,`Decay`,.005,5,n.decay,`s`,r,`log`):i(`decay`,`Decay`,.005,5),new T(`${t}.sustain`,`Sustain`,0,1,n.sustain,``,n=>e.setParam(t,`sustain`,n)),i(`release`,`Release`,.005,10)]}function mi(e,t,n,r){return new T(`mix.${t}`,n,0,1,r,``,n=>e.setParam(`mix.${t}`,`gain`,n))}var hi=e=>ti*2**((e-69)/12),gi=class e{devices=new Map;connections=[];output;extraOutputs=[];add(e,t){if(this.devices.has(e))throw Error(`Duplicate device id: ${e}`);return this.devices.set(e,t),this}device(e){let t=this.devices.get(e);if(!t)throw Error(`Unknown device: ${e}`);return t}connect(e,t){if(this.device(e.device).jack(`out`,e.jack),this.device(t.device).jack(`in`,t.jack),this.connections.some(n=>n.to.device===t.device&&n.to.jack===t.jack&&n.from.device===e.device&&n.from.jack===e.jack))throw Error(`Duplicate connection`);return this.connections.push({from:e,to:t}),this}setOutput(e,t){return this.device(e).jack(`out`,t),this.output={device:e,jack:t},this}addOutput(e,t){return this.device(e).jack(`out`,t),this.extraOutputs.push({device:e,jack:t}),this}static reverb(){return new e().add(`reverb`,new Ot(`Reverb`)).setOutput(`reverb`,`out`)}static delay(){return new e().add(`delay`,new kt(`Delay`)).setOutput(`delay`,`out`)}static ouroboros(){return new e().add(`ouroboros`,new Zt(`Ouroboros`)).setOutput(`ouroboros`,`out`)}static buscomp(){return new e().add(`buscomp`,new wt(`Bus Comp`)).setOutput(`buscomp`,`out`)}static granular(){return new e().add(`granular`,new Rt(`Granular`)).setOutput(`granular`,`out`)}static poly(t=new O){return new e().add(`poly`,new Ir(`Poly`,t)).setOutput(`poly`,`out`)}static drums(t=new O){let n=new e().add(`drums`,new st(`Drums`,t)).setOutput(`drums`,A[0]);for(let e of A.slice(1))n.addOutput(`drums`,e);return n}static synth(t=new O){return new e().add(`synth`,new fi(`Synth`,t)).setOutput(`synth`,`out`)}static lynch(t=new O){return new e().add(`lynch`,new ur(`Lynch`,t)).setOutput(`lynch`,`out`)}static m2600(){return new e().add(`m2600`,new Fn(`MOA-2600`)).setOutput(`m2600`,`out`)}static duo(){return new e().add(`duo`,new cn(`MOA-DUO`)).setOutput(`duo`,`out`)}static df2(t=new O){return new e().add(`lynch`,new ur(`Lynch`,t)).add(`box`,new Vn(`MOA-DF2`)).connect({device:`lynch`,jack:`out`},{device:`box`,jack:`in`}).setOutput(`box`,`out`)}static pipe(t=new O){return new e().add(`pipe`,new Sr(`Pipe`,t)).add(`spring`,new zr(`Spring`)).connect({device:`pipe`,jack:`out`},{device:`spring`,jack:`in`}).setOutput(`spring`,`out`)}static mixerRack(){let t=new e().add(`mixer`,new Kr(2+A.length,`Mixer`,5,{3:`C`,4:`B`},5)),n=t.device(`mixer`);return n.control(`busC.main`).set(!1),n.control(`busB.main`).set(!1),n.control(`key.source`).set(`3`),t.setOutput(`mixer`,`main`)}static default(t=new O){let n=new e().add(`synth`,new fi(`Synth`,t)).add(`poly`,new Ir(`Poly`,t)).add(`drums`,new st(`Drums`,t));return e.addRack(n).connect({device:`synth`,jack:`out`},{device:`mixer`,jack:`ch1`}).connect({device:`poly`,jack:`out`},{device:`mixer`,jack:`ch2`}),A.forEach((e,t)=>n.connect({device:`drums`,jack:e},{device:`mixer`,jack:`ch${t+3}`})),e.wireRack(n)}static addRack(e,t=0){return e.add(`reverb`,new Ot(`Reverb`)).add(`delay`,new kt(`Delay`)).add(`ouroboros`,new Zt(`Ouroboros`)).add(`buscomp`,new wt(`Bus Comp`)).add(`granular`,new Rt(`Granular`)).add(`mixer`,new Kr(2+A.length,`Mixer`,5,{3:`C`,4:`B`},t))}static wireRack(e){e.connect({device:`mixer`,jack:`aux1`},{device:`reverb`,jack:`in`}).connect({device:`mixer`,jack:`aux2`},{device:`delay`,jack:`in`}).connect({device:`reverb`,jack:`out`},{device:`mixer`,jack:`ret1`}).connect({device:`delay`,jack:`out`},{device:`mixer`,jack:`ret2`}),e.connect({device:`mixer`,jack:`busC`},{device:`ouroboros`,jack:`in`}).connect({device:`ouroboros`,jack:`out`},{device:`mixer`,jack:`ret3`}),e.connect({device:`mixer`,jack:`busB`},{device:`buscomp`,jack:`in`}).connect({device:`mixer`,jack:`key`},{device:`buscomp`,jack:`key`}).connect({device:`buscomp`,jack:`out`},{device:`mixer`,jack:`ret4`}),e.connect({device:`mixer`,jack:`aux3`},{device:`granular`,jack:`in`}).connect({device:`granular`,jack:`out`},{device:`mixer`,jack:`ret5`});let t=e.device(`mixer`);return t.control(`busC.main`).set(!1),t.control(`busB.main`).set(!1),t.control(`key.source`).set(`3`),e.setOutput(`mixer`,`main`)}},Q=1e3;function _i(e){let t=e.curve===`log`?Math.log(e.value/e.min)/Math.log(e.max/e.min):(e.value-e.min)/(e.max-e.min);return Math.round(t*Q)}function vi(e,t){let n=t/Q;return e.curve===`log`?e.min*(e.max/e.min)**+n:e.min+n*(e.max-e.min)}function yi(e){let t=e.value;return`${t>=100?t.toFixed(0):t>=10?t.toFixed(1):t>=1?t.toFixed(2):t.toFixed(3)}${e.unit?` `+e.unit:``}`}function bi(e){let t=e.value;return`${Math.abs(t)>=100?t.toFixed(0):Math.abs(t)>=10?t.toFixed(1):t.toFixed(2)}${e.unit?` `+e.unit:``}`}function $(e,t,n){let r=document.createElement(e);return t&&(r.className=t),n!==void 0&&(r.textContent=n),r}function xi(e,t,n,{height:r=140,capHeight:i=36,tick:a=14,unity:o}={}){let s=$(`div`,`fader`);s.append($(`div`,`fader-label`,n));let c=$(`div`,`fader-slot`);if(c.style.setProperty(`--slot-h`,`${r}px`),c.style.setProperty(`--cap-h`,`${i}px`),c.style.setProperty(`--tick`,`${a}px`),c.append($(`div`,`fader-track`)),o!==void 0){let t=$(`div`,`fader-unity`),n=(o-e.min)/(e.max-e.min);t.style.top=`${Math.round((1-n)*(r-i)+i/2)}px`,c.append(t)}let l=$(`div`,`fader-cap`);l.append($(`span`,`fader-cap-line`)),c.append(l);let u=$(`input`,`fader-input`);u.type=`range`,u.min=`0`,u.max=String(Q),u.setAttribute(`aria-label`,`${t} ${e.label}`),c.append(u);let d=$(`div`,`fader-value`),f=()=>{u.value=String(_i(e));let t=Number(u.value)/Q;l.style.top=`${Math.round((1-t)*(r-i))}px`,d.textContent=yi(e),u.setAttribute(`aria-valuetext`,d.textContent)};return u.addEventListener(`input`,()=>{e.set(vi(e,Number(u.value))),f()}),c.addEventListener(`dblclick`,()=>{e.set(e.initial),f()}),e.onChange(f),f(),s.append(c,d),s}var Si=270,Ci=160;function wi(e,t,n,r=34){let i=$(`div`,`knob-wrap`);i.append($(`div`,`knob-label`,n));let a=$(`div`,`knob`);a.style.width=`${r}px`,a.style.height=`${r}px`,a.tabIndex=0,a.setAttribute(`role`,`slider`),a.setAttribute(`aria-label`,`${t} ${e.label}`),a.setAttribute(`aria-orientation`,`vertical`),a.setAttribute(`aria-valuemin`,String(e.min)),a.setAttribute(`aria-valuemax`,String(e.max));let o=$(`div`,`knob-pointer`);a.append(o);let s=$(`div`,`knob-value`),c=()=>{let t=_i(e)/Q;o.style.transform=`rotate(${-135+t*Si}deg)`,s.textContent=bi(e),a.setAttribute(`aria-valuenow`,String(e.value)),a.setAttribute(`aria-valuetext`,s.textContent)},l=t=>{e.set(vi(e,Math.round(Math.min(1,Math.max(0,t))*Q))),c()},u;a.addEventListener(`pointerdown`,t=>{a.setPointerCapture(t.pointerId),u={y:t.clientY,t:_i(e)/Q}}),a.addEventListener(`pointermove`,e=>{u&&l(u.t+(u.y-e.clientY)/Ci)});let d=()=>{u=void 0};return a.addEventListener(`pointerup`,d),a.addEventListener(`pointercancel`,d),a.addEventListener(`dblclick`,()=>{e.set(e.initial),c()}),a.addEventListener(`keydown`,t=>{let n=_i(e)/Q,r=t.shiftKey?.1:.02,i={ArrowUp:n+r,ArrowRight:n+r,ArrowDown:n-r,ArrowLeft:n-r,Home:0,End:1};t.key in i&&(t.preventDefault(),l(i[t.key]))}),e.onChange(c),c(),i.append(a,s),i}function Ti(e,t,n,r,i=`btn`){let a=$(`button`,i);a.type=`button`,a.setAttribute(`aria-label`,t);let o=()=>{a.textContent=n(e.value),a.setAttribute(`aria-pressed`,String(e.value)),a.style.background=e.value?r:``,a.style.borderColor=e.value?r:``};return a.addEventListener(`click`,()=>{e.set(!e.value),o()}),e.onChange(o),o(),a}var Ei=`#d9628a`;function Di(e,t={running:()=>e.running,position:()=>e.position}){let n=$(`div`,`transport`),r=$(`div`,`transport-tempo`);r.append($(`div`,`fader-label`,`Tempo`));let i=$(`div`,`transport-bpm`,`120.0`),a=$(`div`,`transport-tempo-buttons`),o=$(`button`,`btn btn-small transport-tap`,`Tap`);o.type=`button`,o.addEventListener(`click`,()=>e.tap());let s=$(`button`,`btn btn-small`,`−`);s.type=`button`,s.setAttribute(`aria-label`,`Tempo down`),s.addEventListener(`click`,()=>e.nudge(-1));let c=$(`button`,`btn btn-small`,`+`);c.type=`button`,c.setAttribute(`aria-label`,`Tempo up`),c.addEventListener(`click`,()=>e.nudge(1)),a.append(o,s,c),r.append(i,a);let l=$(`div`,`transport-sync`);l.append($(`div`,`fader-label`,`Sync`));let u=$(`div`,`transport-seg`),d={internal:`Internal`,midi:`MIDI clock`},f=e.sync.options.map(t=>{let n=$(`button`,`btn btn-small`,d[t]??t);return n.type=`button`,n.addEventListener(`click`,()=>e.sync.set(t)),u.append(n),n}),p=Ti(e.followStartStop,`Follow MIDI start and stop`,e=>`Start/stop: ${e?`On`:`Off`}`,Ei,`btn btn-small`);l.append(u),t.followStartStop!==!1&&l.append(p);let m=$(`div`,`transport-channel`);m.append($(`div`,`fader-label`,`MIDI ch`));let h=$(`select`,`patch-select transport-channel-select`);h.setAttribute(`aria-label`,`MIDI channel`);for(let t of e.channel.options)h.add(new Option(t===`omni`?`Omni`:`Ch ${t}`,t));h.value=e.channel.value,h.addEventListener(`change`,()=>e.channel.set(h.value)),m.append(h);let g=$(`div`,`transport-pos`);g.append($(`div`,`fader-label`,`Position`));let _=$(`div`,`transport-pos-row`),v=$(`span`,`led`),y=$(`div`,`transport-position`,`1 : 1 : 1`),b=[0,1,2,3].map(()=>$(`span`,`beat-dot`)),x=$(`div`,`beat-dots`);x.append(...b),_.append(v,y),g.append(_,x),n.append(r,l,m),t.position&&n.append(g);let S=()=>{let t=e.synced;f.forEach((t,n)=>{let r=e.sync.options[n]===e.sync.value;t.setAttribute(`aria-pressed`,String(r)),t.style.background=r?Ei:``,t.style.borderColor=r?Ei:``});for(let e of[o,s,c])e.disabled=t;p.disabled=!t,a.title=t?`Tempo follows MIDI clock`:``,n.classList.toggle(`is-synced`,t)};e.sync.onChange(S),S();let C=()=>{let n=t.running();i.textContent=e.bpm.toFixed(1),i.classList.toggle(`locked`,e.locked);let r=t.position?.();r&&(y.textContent=`${r.bar} : ${r.beat} : ${r.sixteenth}`,v.classList.toggle(`on`,n),b.forEach((e,t)=>e.classList.toggle(`on`,n&&r.beat===t+1))),requestAnimationFrame(C)};return requestAnimationFrame(C),n}var Oi={kick:`#e8742c`,snare:`#4a9be0`,clap:`#a98be0`,closedHat:`#4fb286`,openHat:`#dcb43c`,ride:`#d9628a`,rim:`#e0a07a`,lowTom:`#c46a3c`,midTom:`#d4844c`,highTom:`#e49e60`,cowbell:`#c9c24a`,crash:`#8fc9e0`},ki={height:120,capHeight:32,tick:12},Ai=[`tune`,`decay`,`third`,`level`],ji={kick:`click`,snare:`snap`,clap:`spread`,closedHat:`tone`,openHat:`tone`,ride:`bell`,rim:`tone`,lowTom:`bend`,midTom:`bend`,highTom:`bend`,cowbell:`tone`,crash:`tone`},Mi=`clap`,Ni=8,Pi=-48,Fi={soft:.4,normal:.8,hard:1},Ii=[`1`,`2`,`3`,`4`,`5`,`6`,`7`,`8`,`9`,`0`,`-`,`=`];function Li(e,t){let n=e.control(t);if(n.kind!==`number`)throw Error(`${t} is not a number control`);return n}function Ri(e,t){let n=e.control(t);if(n.kind!==`toggle`)throw Error(`${t} is not a toggle control`);return n}function zi(e,t,n,r,i,a){let o=Oi[t],s=nt[t],c=$(`section`,`synth-section drum-voice`),l=$(`div`,`synth-section-head`),u=$(`span`,`synth-section-bar`);if(u.style.background=o,l.append(u,$(`h2`,void 0,s)),t===`closedHat`||t===`openHat`){let t=Ti(e.choke,`Closed hat chokes open hat`,()=>`Choke`,o,`btn drum-choke`);t.style.marginLeft=`auto`,l.append(t)}let d=$(`button`,`drum-pad`);d.type=`button`,d.style.setProperty(`--voice`,o),d.setAttribute(`aria-label`,`Play ${s}`),d.append($(`span`,`drum-pad-key`,Ii[n])),d.addEventListener(`pointerdown`,n=>{n.preventDefault(),e.trigger(t,n.shiftKey?Fi.soft:n.altKey?Fi.hard:Fi.normal)}),d.addEventListener(`keydown`,n=>{(n.key===` `||n.key===`Enter`)&&(n.preventDefault(),n.repeat||e.trigger(t,Fi.normal))});let f;e.onHit((e,n)=>{e===t&&(d.style.setProperty(`--hit`,String(.35+.65*n)),d.classList.add(`hit`),window.clearTimeout(f),f=window.setTimeout(()=>d.classList.remove(`hit`),110))});let p=$(`div`,`drum-faders`);for(let n of Ai){let r=n===`third`?ji[t]:n===`tune`&&t===Mi?`tone`:n;p.append(xi(Li(e,`${t}.${r}`),s,Li(e,`${t}.${r}`).label,ki))}let m=$(`div`,`drum-ms`);m.append(Ti(Ri(e,`${t}.mute`),`${s} mute`,()=>`Mute`,`#e8b43c`,`btn`),Ti(Ri(e,`${t}.solo`),`${s} solo`,()=>`Solo`,`#4fb286`,`btn`));let h=$(`div`,`drum-out`);h.append($(`span`,`drum-jack`),$(`span`,`drum-out-label`,n<et.length?`Out ${n+1}`:`Perc out`));let g=$(`div`,`drum-meter`);g.setAttribute(`role`,`img`),g.setAttribute(`aria-label`,`${s} output level`);let _=Array.from({length:Ni},()=>{let e=$(`span`,`drum-seg`);return g.append(e),e});h.append(g);let v=e.meters.find(e=>e.name===t).nodeId;return a.push(()=>{let e=r.readLevel(i,v),t=e>0?20*Math.log10(e):Pi,n=Math.round(Math.min(1,Math.max(0,(t-Pi)/48))*Ni);_.forEach((e,t)=>{e.style.background=t<n?o:``})}),c.append(l,d,p,m,h),c}var Bi=`#4a9be0`,Vi=[`off`,`soft`,`medium`,`hard`],Hi=[`0%`,`34%`,`67%`,`100%`];function Ui(e,t,n){let r=$(`section`,`drum-transport`),i=$(`div`,`drum-run`),a=$(`button`,`btn drum-play`,`Play`);a.type=`button`,a.addEventListener(`click`,()=>e.play());let o=$(`button`,`btn drum-stop`,`Stop`);o.type=`button`,o.addEventListener(`click`,()=>e.stop()),i.append(a,o),n.push(()=>{let t=e.externallyDriven;a.setAttribute(`aria-pressed`,String(e.running)),a.style.background=e.running?Bi:``,a.style.borderColor=e.running?Bi:``,a.disabled=t,o.disabled=t,i.title=t?`Following MIDI start/stop`:``});let s=$(`div`,`drum-swing`);s.append(wi(e.swing,`Sequencer`,`Swing`,34));let c=$(`div`,`drum-patterns`);c.append($(`div`,`fader-label`,`Pattern`));let l=$(`div`,`transport-seg`);l.setAttribute(`role`,`group`),l.setAttribute(`aria-label`,`Pattern`);let u=ct.map(t=>{let n=$(`button`,`btn btn-small drum-pattern`,t);return n.type=`button`,n.addEventListener(`click`,()=>e.pattern.set(t)),l.append(n),n}),d=()=>{u.forEach((t,n)=>{let r=ct[n]===e.pattern.value;t.setAttribute(`aria-pressed`,String(r)),t.style.background=r?Bi:``,t.style.borderColor=r?Bi:``})};return e.pattern.onChange(d),d(),c.append(l),r.append(i,Di(t.transport,{running:()=>e.running,position:()=>e.position}),s,c),r}function Wi(e,t){let n=$(`section`,`synth-section drum-seq`),r=$(`div`,`synth-section-head`),i=$(`span`,`synth-section-bar`);i.style.background=Bi,r.append(i,$(`h2`,void 0,`Sequencer`),$(`span`,`drum-seq-sub`),$(`span`,`drum-seq-hint`,`Click a step to cycle velocity: soft · medium · hard · off`));let a=r.querySelector(`.drum-seq-sub`),o=()=>{a.textContent=`16 steps · pattern ${e.pattern.value}`};e.pattern.onChange(o),o(),n.append(r);let s=$(`div`,`drum-seq-row`);s.append($(`div`,`drum-seq-label`));let c=$(`div`,`drum-seq-grid`),l=Array.from({length:16},(e,t)=>{let n=$(`div`,`drum-seq-num`,String(t+1));return c.append(n),n});s.append(c),n.append(s);let u=Array.from({length:16},()=>[]),d=[];for(let t of k){let r=Oi[t],i=nt[t],a=$(`div`,`drum-seq-row`),o=$(`div`,`drum-seq-label`),s=$(`span`,`drum-seq-dot`);s.style.background=r,o.append(s,$(`span`,void 0,i));let c=$(`div`,`drum-seq-grid`);for(let n=0;n<16;n++){let a=$(`button`,`drum-step`);a.type=`button`,a.dataset.group=String(Math.floor(n/4)%2),a.style.setProperty(`--voice`,r);let o=$(`span`,`drum-step-fill`);a.append(o),a.addEventListener(`click`,()=>e.cycle(t,n));let s=()=>{let r=e.level(t,n);o.style.height=Hi[r],a.setAttribute(`aria-pressed`,String(r>0)),a.setAttribute(`aria-label`,`${i} step ${n+1}, velocity ${Vi[r]}`),a.classList.toggle(`on`,r>0)};d.push(s),s(),u[n].push(a),c.append(a)}a.append(o,c),n.append(a)}e.onChange(()=>d.forEach(e=>e()));let f;return t.push(()=>{let t=e.currentStep();if(t!==f){if(f!==void 0){l[f].classList.remove(`playhead`);for(let e of u[f])e.classList.remove(`playhead`)}if(t!==void 0){l[t].classList.add(`playhead`);for(let e of u[t])e.classList.add(`playhead`)}f=t}}),n}function Gi(e,t,n,r){let i=$(`div`,`synth-panel drum-panel`),a=$(`div`,`synth-header`),o=$(`div`,`synth-brand`);o.append($(`div`,`synth-name`,`MOA-DR`),$(`div`,`synth-subtitle`,`Drum Machine`)),a.append(o,$(`div`,`drum-outputs-note`,`6 individual outputs + perc`)),i.append(a);let s=[];i.append(Ui(t,e,s));let c=$(`div`,`drum-voices`);k.forEach((t,i)=>c.append(zi(e,t,i,r,n,s))),i.append(c,Wi(t,s)),window.addEventListener(`keydown`,t=>{if(t.repeat||t.metaKey||t.ctrlKey||t.altKey)return;let n=t.target;if(n instanceof HTMLSelectElement||n instanceof HTMLInputElement)return;let r=Ii.indexOf(t.key);r>=0&&e.trigger(k[r],t.shiftKey?Fi.soft:Fi.normal)});let l=()=>{for(let e of s)e();requestAnimationFrame(l)};return requestAnimationFrame(l),i}var Ki=`@internal`,qi=`@none`,Ji=`moa.mixerInputs`,Yi=class{host;jacks;storage;storageKey;slots=new Map;listeners=new Set;ready=!1;constructor(e,t,n={},r=Xi(),i=Ji){this.host=e,this.jacks=t,this.storage=r,this.storageKey=i;let a=Zi(r,i);for(let r of t)this.slots.set(r,{selection:a[r]??n[r]??(e.hasInternal(r)?`@internal`:`@none`),internal:!0,status:`idle`})}selection(e){return this.slot(e).selection}status(e){return this.slot(e).status}hasInternal(e){return this.host.hasInternal(e)}portNames(){return[...new Set(this.host.ports().map(e=>e.name))]}setSelection(e,t,n=!0){if(this.slot(e).selection=t,n)try{this.storage?.setItem(this.storageKey,JSON.stringify(Object.fromEntries([...this.slots].map(([e,t])=>[e,t.selection]))))}catch{}this.reconcile()}start(){this.ready=!0,this.reconcile()}reconcile(){for(let[e,t]of this.slots)this.reconcileOne(e,t);for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}reconcileOne(e,t){let n=t.selection===Ki;if(!this.ready){t.status=`idle`;return}let r=n||t.selection===`@none`?void 0:this.host.ports().find(e=>e.name===t.selection);r||this.release(t),t.internal!==n&&(this.host.setInternal(e,n),t.internal=n),r?t.portId!==r.id&&t.pending!==r.id&&(this.release(t),t.pending=r.id,t.status=`connecting`,this.host.attach(e,r.id).then(e=>{if(t.pending!==r.id)e();else{t.pending=void 0,t.portId=r.id,t.detach=e,t.status=`live`;for(let e of this.listeners)e()}},()=>{t.pending===r.id&&(t.pending=void 0),t.status=`missing`;for(let e of this.listeners)e()})):t.status=n?`internal`:t.selection===`@none`?`none`:`missing`}release(e){e.detach?.(),e.detach=void 0,e.portId=void 0,e.pending=void 0}slot(e){let t=this.slots.get(e);if(!t)throw Error(`Unknown input: ${e}`);return t}};function Xi(){try{return typeof localStorage>`u`?void 0:localStorage}catch{return}}function Zi(e,t){try{let n=JSON.parse(e?.getItem(t)??`{}`);return n&&typeof n==`object`?n:{}}catch{return{}}}var Qi=`moa.monitor`,$i=class{audience;apply;storage;mode=`auto`;listeners=new Set;constructor(e,t,n=ea()){this.audience=e,this.apply=t,this.storage=n;let r=n?.getItem(Qi);(r===`on`||r===`off`||r===`auto`)&&(this.mode=r)}get on(){return this.mode===`on`||this.mode===`auto`&&this.audience()===0}setMode(e){this.mode=e;try{this.storage?.setItem(Qi,e)}catch{}this.update()}update(){this.apply(this.on);for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}};function ea(){try{return typeof localStorage>`u`?void 0:localStorage}catch{return}}var ta=`moa-pcm-send`,na=`moa-pcm-recv`,ra=`
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

registerProcessor('${ta}', PcmSend);
registerProcessor('${na}', PcmRecv);
`,ia=new WeakSet;async function aa(e){if(ia.has(e))return;let t=URL.createObjectURL(new Blob([ra],{type:`text/javascript`}));await e.audioWorklet.addModule(t),ia.add(e)}var oa=()=>Math.random().toString(36).slice(2,10),sa=class{id=oa();channel;remote=new Map;listeners=new Set;audienceListeners=new Set;outlets=new Map;sinks=new Map;constructor(e=`moa-audio-pcm`,t){let n=t??(typeof BroadcastChannel>`u`?void 0:e=>new BroadcastChannel(e));this.channel=n?.(e),this.channel&&(this.channel.onmessage=e=>this.handle(e.data),this.send({type:`hello`,from:this.id}),typeof window<`u`&&window.addEventListener(`pagehide`,e=>{e.persisted||this.close()}))}get supported(){return this.channel!==void 0&&typeof AudioWorkletNode<`u`}get ports(){return[...this.remote].map(([e,t])=>({id:e,name:t.name}))}get audience(){let e=0;for(let t of this.outlets.values())e+=t.audience.size;return e}openOutlet(e){let t=oa(),n={name:e,audience:new Set};return this.outlets.set(t,n),this.send({type:`announce`,from:this.id,port:t,name:e}),{id:t,get listened(){return n.audience.size>0},send:(e,r,i)=>{n.audience.size>0&&this.send({type:`pcm`,from:this.id,port:t,rate:i,l:e,r})},close:()=>{this.outlets.delete(t)&&(n.stop?.(),this.send({type:`bye`,from:this.id,port:t}),this.audienceChanged())}}}listen(e,t){return this.sinks.set(e,e=>t(e.rate,e.l,e.r)),this.send({type:`listen`,from:this.id,port:e}),()=>{this.sinks.delete(e)&&this.send({type:`unlisten`,from:this.id,port:e})}}async publish(e,t,n){await aa(e);let r=new AudioWorkletNode(e,ta,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:`explicit`}),i=e.createGain();i.gain.value=0,t.connect(r),r.connect(i).connect(e.destination);let a=this.openOutlet(n);return r.port.onmessage=t=>a.send(t.data.l,t.data.r,e.sampleRate),this.outlets.get(a.id).listening=e=>r.port.postMessage({active:e}),this.outlets.get(a.id).stop=()=>{t.disconnect(r),r.disconnect(),i.disconnect(),r.port.onmessage=null},a.close}async subscribe(e,t,n=30){await aa(e);let r=new AudioWorkletNode(e,na,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{targetMs:n,capacityMs:400}}),i={fill:0,underruns:0,drops:0};r.port.onmessage=e=>{i=e.data};let a=this.listen(t,(e,t,n)=>r.port.postMessage({rate:e,l:t,r:n},[t.buffer,n.buffer]));return{node:r,stats:()=>i,close:()=>{a(),r.disconnect(),r.port.onmessage=null}}}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}onAudience(e){return this.audienceListeners.add(e),()=>this.audienceListeners.delete(e)}close(){for(let e of[...this.sinks.keys()])this.send({type:`unlisten`,from:this.id,port:e});this.sinks.clear();for(let e of this.outlets.values())e.stop?.();this.outlets.clear(),this.send({type:`bye`,from:this.id}),this.channel?.close()}emit(){for(let e of this.listeners)e()}audienceChanged(){for(let e of this.audienceListeners)e()}send(e){this.channel?.postMessage(e)}handle(e){if(e.from!==this.id)switch(e.type){case`hello`:for(let[e,t]of this.outlets)this.send({type:`announce`,from:this.id,port:e,name:t.name});return;case`announce`:this.remote.set(e.port,{owner:e.from,name:e.name}),this.emit();return;case`bye`:for(let[t,n]of[...this.remote])n.owner===e.from&&(e.port===void 0||e.port===t)&&this.remote.delete(t);if(e.port===void 0){let t=!1;for(let n of this.outlets.values())n.audience.delete(e.from)&&(t=!0,n.audience.size===0&&n.listening?.(!1));t&&this.audienceChanged()}this.emit();return;case`listen`:{let t=this.outlets.get(e.port);if(!t||t.audience.has(e.from))return;t.audience.add(e.from),t.listening?.(!0),this.audienceChanged();return}case`unlisten`:{let t=this.outlets.get(e.port);t?.audience.delete(e.from)&&(t.audience.size===0&&t.listening?.(!1),this.audienceChanged());return}case`pcm`:this.sinks.get(e.port)?.(e);return}}};function ca(e){let t=e[0];if(t===void 0)return;if(t>=240)switch(t){case 248:return{type:`clock`};case 250:return{type:`start`};case 251:return{type:`continue`};case 252:return{type:`stop`};default:return}let n=t&240,r=(t&15)+1,i=(e[1]??0)&127,a=(e[2]??0)&127;switch(n){case 128:return{type:`noteOff`,channel:r,note:i,velocity:a};case 144:return a===0?{type:`noteOff`,channel:r,note:i,velocity:0}:{type:`noteOn`,channel:r,note:i,velocity:a};case 176:return{type:`cc`,channel:r,controller:i,value:a};case 192:return{type:`programChange`,channel:r,program:i};case 224:return{type:`pitchBend`,channel:r,value:(a<<7|i)/8192-1};default:return}}var la=[`C`,`C#`,`D`,`D#`,`E`,`F`,`F#`,`G`,`G#`,`A`,`A#`,`B`];function ua(e){return`${la[e%12]}${Math.floor(e/12)-2}`}function da(e){switch(e.type){case`noteOn`:case`noteOff`:return`note`;case`cc`:return`cc`;case`clock`:case`start`:case`continue`:case`stop`:return`clock`;default:return`other`}}function fa(e){switch(e.type){case`noteOn`:return`ch${e.channel}  note on  ${ua(e.note)}  vel ${e.velocity}`;case`noteOff`:return`ch${e.channel}  note off  ${ua(e.note)}`;case`cc`:return`ch${e.channel}  cc ${e.controller}  = ${e.value}`;case`pitchBend`:return`ch${e.channel}  bend  ${e.value.toFixed(2)}`;case`programChange`:return`ch${e.channel}  program  ${e.program}`;case`clock`:return`clock`;default:return`clock ${e.type}`}}var pa=40,ma=class{lines=[];lastSeen={note:-1/0,cc:-1/0,clock:-1/0,other:-1/0};listeners=new Set;record(e,t){if(this.lastSeen[da(e)]=t,e.type!==`clock`){this.lines.push({text:fa(e),kind:da(e)}),this.lines.length>pa&&this.lines.shift();for(let e of this.listeners)e()}}clear(){this.lines.length=0;for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}},ha=`moa.midiBus`,ga=()=>performance.timeOrigin+performance.now(),_a=class{now;later;enabled;onMessage;lastSeen=0;channel;listeners=new Set;constructor(e=`moa-midi`,t=ga,n=(e,t)=>setTimeout(e,t),r){this.now=t,this.later=n,this.enabled=va();let i=r??(typeof BroadcastChannel>`u`?void 0:e=>new BroadcastChannel(e));this.channel=i?.(e),this.channel&&(this.channel.onmessage=e=>{if(!this.enabled)return;let{at:t,data:n}=e.data;if(!Array.isArray(n)||typeof t!=`number`)return;this.lastSeen=performance.now();let r=t-this.now(),i=()=>this.onMessage?.(Uint8Array.from(n),performance.now());r<=1?i():this.later(i,r)})}get supported(){return this.channel!==void 0}send(e,t=this.now()){this.channel?.postMessage({at:t,data:Array.from(e)})}setEnabled(e){this.enabled=e;try{localStorage.setItem(ha,e?`1`:`0`)}catch{}for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}close(){this.channel?.close()}};function va(){try{return localStorage.getItem(ha)!==`0`}catch{return!0}}var ya=[`mixer`,`synth`,`poly`,`drums`,`lynch`,`duo`,`df2`,`pipe`],ba=[`reverb`,`delay`,`ouroboros`,`buscomp`,`granular`],xa=[`m2600`];[...ya,...ba,...xa],[...ba,...xa];var Sa=e=>`moa-control-${e}`,Ca=`moa-control-status`,wa=e=>`moa-song-${e}`;function Ta(e){return typeof BroadcastChannel>`u`?void 0:new BroadcastChannel(e)}function Ea(e,t){let n=Ta(Sa(e));return n?(n.onmessage=e=>{e.data&&typeof e.data.type==`string`&&t(e.data)},()=>n.close()):()=>{}}function Da(e,t){let n=Ta(Ca);n?.postMessage({page:e,state:t}),n?.close()}var Oa=e=>typeof e==`string`?e===`1`||e===`true`||e===`on`:typeof e==`number`?e!==0:e;function ka(e,t){let n=[];for(let[r,i]of Object.entries(t)){let t=e.devices.get(r);if(!t){n.push(`no device ${r}`);continue}if(i.preset!==void 0){let e=t,a=i.preset;t instanceof fi&&Number.isInteger(a)&&a>=0&&a<Jr.length?t.loadPreset(Jr[a]):typeof e.loadSlot==`function`&&Number.isInteger(a)&&a>=0&&a<(e.slots?.length??0)?e.loadSlot(a):n.push(`${r}: cannot load preset ${a}`)}let a=t.transport;if(i.channel!==void 0)try{if(!a?.channel)throw Error(`no channel setting`);a.channel.set(i.channel)}catch(e){n.push(`${r}: channel ${i.channel}: ${e.message}`)}for(let[e,a]of Object.entries(i.controls??{}))try{let n=t.control(e);if(n.kind===`number`){let e=typeof a==`number`?a:Number(a);if(Number.isNaN(e))throw Error(`not a number`);n.set(e)}else n.kind===`choice`?n.set(String(a)):n.set(Oa(a))}catch(t){n.push(`${r}.${e}: ${t.message}`)}}return n}var Aa=`moa.midiInput`,ja=`moa.midiOutput`,Ma=class{status=typeof navigator<`u`&&`requestMIDIAccess`in navigator?`idle`:`unsupported`;inputs=[];selectedId;outputs=[];selectedOutputId;onMessage;access;listeners=new Set;async connect(){if(this.status!==`unsupported`){try{this.access=await navigator.requestMIDIAccess({sysex:!1})}catch{this.status=`denied`,this.emit();return}this.status=`ready`,this.access.onstatechange=()=>this.refresh(),this.refresh()}}async connectIfPermitted(){if(this.status===`idle`)try{(await navigator.permissions.query({name:`midi`})).state===`granted`&&await this.connect()}catch{}}select(e){if(this.access)for(let e of this.access.inputs.values())e.onmidimessage=null;if(this.selectedId=e,e){let t=this.access?.inputs.get(e);t&&(t.onmidimessage=e=>{e.data&&this.onMessage?.(e.data,e.timeStamp)});try{localStorage.setItem(Aa,e)}catch{}}this.emit()}selectOutput(e){this.selectedOutputId=e;try{e?localStorage.setItem(ja,e):localStorage.removeItem(ja)}catch{}this.emit()}send(e,t){let n=this.selectedOutputId?this.access?.outputs.get(this.selectedOutputId):void 0;n&&n.send(e,t===void 0?void 0:t-performance.timeOrigin)}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}refresh(){if(this.inputs=[...this.access?.inputs.values()??[]].map(e=>({id:e.id,name:e.name??e.id})),this.outputs=[...this.access?.outputs.values()??[]].map(e=>({id:e.id,name:e.name??e.id})),this.selectedOutputId&&!this.outputs.some(e=>e.id===this.selectedOutputId)&&(this.selectedOutputId=void 0),!this.selectedOutputId)try{let e=localStorage.getItem(ja);e&&this.outputs.some(t=>t.id===e)&&(this.selectedOutputId=e)}catch{}this.selectedId&&this.inputs.some(e=>e.id===this.selectedId)?this.emit():this.select(this.pickDefault())}pickDefault(){let e=null;try{e=localStorage.getItem(Aa)}catch{}return this.inputs.find(t=>t.id===e)?.id??this.inputs.find(e=>/torso|t-?1/i.test(e.name))?.id??(this.inputs.length===1?this.inputs[0]?.id:void 0)}emit(){for(let e of this.listeners)e()}},Na=[[`auto`,`Auto`],[`on`,`On`],[`off`,`Off`]];function Pa(e,t){let n=$(`div`,`midi-block`);n.append($(`div`,`fader-label`,`Audio bus`));let r=$(`div`,`midi-bus`),i=$(`span`,`led input-led`),a=$(`span`,`bus-listening`);r.append(i,a);let o=$(`div`,`bus-monitor`);o.append($(`span`,`fader-label`,`Speakers`));let s=Na.map(([e,n])=>{let r=$(`button`,`btn btn-small`,n);return r.type=`button`,r.setAttribute(`aria-label`,`Own speakers: ${n}`),r.addEventListener(`click`,()=>t.setMode(e)),o.append(r),[e,r]}),c=()=>{let n=e.audience;a.textContent=n===0?`Nothing listening`:n===1?`1 listener`:`${n} listeners`,i.classList.toggle(`input-led-live`,n>0);for(let[e,n]of s)n.setAttribute(`aria-pressed`,String(t.mode===e));o.title=t.on?`Playing on this page's speakers`:`This page's speakers are muted`};return e.onAudience(c),t.onChange(c),c(),n.append(r,o),n}var Fa={idle:`Start audio to connect`,internal:`Using the instrument on this page`,none:`No input`,connecting:`Connecting`,live:`Receiving audio from another tab`,missing:`That tab is not open`};function Ia(e,t,n,r){let i=$(`div`,`mix-input`),a=$(`span`,`led`),o=$(`select`,`patch-select mix-input-select`);o.setAttribute(`aria-label`,`${n} input`);let s=()=>{let n=e.selection(t),s=e.portNames();o.replaceChildren(...e.hasInternal(t)?[new Option(r,Ki)]:[],new Option(`None`,qi));for(let e of s)o.add(new Option(e,e));n!==`@internal`&&n!==`@none`&&!s.includes(n)&&o.add(new Option(`${n} (not open)`,n)),o.value=n;let c=e.status(t);a.className=`led input-led input-led-${c}`,i.title=Fa[c]};return o.addEventListener(`change`,()=>e.setSelection(t,o.value)),e.onChange(s),s(),i.append(a,o),i}function La(){new URLSearchParams(location.search).has(`embed`)&&(document.body.classList.add(`embed`),document.addEventListener(`keydown`,e=>{e.key===`Escape`&&window.parent.postMessage({type:Ra},location.origin)}))}var Ra=`moa-close-panel`,za=150;function Ba(e,t,n,r,i){let a=$(`section`,`midi-strip`),o=$(`div`,`midi-block`);o.append($(`div`,`fader-label`,`Audio`),r);let s=$(`div`,`midi-block`);s.append($(`div`,`fader-label`,`MIDI input`));let c=$(`div`,`midi-device`);s.append(c);let l=()=>{if(c.replaceChildren(),e.status===`unsupported`)c.append($(`div`,`midi-message`,`MIDI is not available in this browser. Try Chrome or Edge.`));else if(e.status===`denied`)c.append($(`div`,`midi-message`,`MIDI access was blocked. Allow it in the site settings, then reload.`));else if(e.status===`idle`){let t=$(`button`,`btn midi-connect`,`Connect MIDI`);t.type=`button`,t.addEventListener(`click`,()=>void e.connect()),c.append(t)}else{let t=$(`select`,`patch-select`);t.setAttribute(`aria-label`,`MIDI input device`),t.add(new Option(e.inputs.length?`No device selected`:`No MIDI devices found`,``));for(let n of e.inputs)t.add(new Option(n.name,n.id));t.value=e.selectedId??``,t.addEventListener(`change`,()=>e.select(t.value||void 0)),c.append(t)}};e.onChange(l),l();let u,d;if(i?.supported){u=$(`div`,`midi-block`),u.append($(`div`,`fader-label`,`Sequencer bus`));let e=$(`div`,`midi-bus`);d=$(`span`,`led`);let t=$(`button`,`btn btn-small midi-bus-toggle`);t.type=`button`,t.setAttribute(`aria-label`,`Listen to MIDI from the sequencer page in another tab`);let n=()=>{t.textContent=i.enabled?`On`:`Off`,t.setAttribute(`aria-pressed`,String(i.enabled))};t.addEventListener(`click`,()=>i.setEnabled(!i.enabled)),i.onChange(n),n(),e.append(d,t),u.append(e)}let f=$(`div`,`midi-block`);f.append($(`div`,`fader-label`,`Incoming clock`));let p=$(`div`,`midi-bpm`,`--.-`),m=$(`div`,`midi-badges`),h=$(`span`,`badge`,`No clock`),g=$(`span`,`badge`,`Stopped`);m.append(h,g),f.append(p,m);let _=$(`div`,`midi-block`);_.append($(`div`,`fader-label`,`Activity`));let v=$(`div`,`midi-leds`),y={note:$(`span`,`led`),cc:$(`span`,`led`),clock:$(`span`,`led`)};for(let[e,t]of[[`note`,`Notes`],[`cc`,`CC`],[`clock`,`Clock`]]){let n=$(`div`,`led-item`);n.append(y[e],$(`span`,void 0,t)),v.append(n)}_.append(v);let b=$(`div`,`midi-block midi-monitor-block`),x=$(`div`,`midi-monitor-head`);x.append($(`div`,`fader-label`,`Monitor`));let S=$(`button`,`btn btn-small midi-clear`,`Clear`);S.type=`button`,S.addEventListener(`click`,()=>n.clear()),x.append(S);let C=$(`div`,`midi-log`);C.setAttribute(`role`,`log`),C.setAttribute(`aria-label`,`Recent MIDI messages`),b.append(x,C);let ee=()=>{C.replaceChildren(...n.lines.slice(-5).map(e=>$(`div`,`midi-line midi-line-${e.kind}`,e.text)))};n.onChange(ee),ee(),a.append(o,s,...u?[u]:[],f,_,b);let te=()=>{let e=performance.now(),r=t.bpm,a=t.isLocked(e);p.textContent=r!==void 0&&a?r.toFixed(1):`--.-`,h.textContent=a?`Clock locked`:`No clock`,h.classList.toggle(`on`,a),g.textContent=t.running?`Running`:`Stopped`,g.classList.toggle(`on`,t.running),i&&d&&d.classList.toggle(`on`,e-i.lastSeen<za);for(let t of[`note`,`cc`,`clock`])y[t].classList.toggle(`on`,e-n.lastSeen[t]<za);requestAnimationFrame(te)};return requestAnimationFrame(te),a}var Va=[[`/mixer/`,`The mixer`],[`/synth/`,`MOA-1`],[`/poly/`,`MOA-6`],[`/drums/`,`MOA-DR`],[`/lynch/`,`Lynch 106`],[`/duo/`,`MOA-DUO`],[`/2600/`,`MOA-2600`],[`/df2/`,`MOA-DF2`],[`/pipe/`,`MOA-PIPE`],[`/seq/`,`MOA-SEQ`],[`/reverb/`,`Reverb`],[`/delay/`,`Delay`],[`/ouroboros/`,`Ouroboros`],[`/buscomp/`,`Bus Comp`],[`/granular/`,`Granular`],[`/records/`,`Records`],[`/`,`moaswift.no`]];function Ha(e){let t=document.createElement(`nav`);return t.className=`pipe-nav`,t.innerHTML=Va.filter(([t])=>t!==e).map(([e,t])=>`<a href="${e}">${t}</a>`).join(``),t}function Ua(e){let{engine:t,clock:n}=e;La();let r=new ma,i=new Ma,a=new sa,o=new $i(()=>a.audience,e=>t.setMonitor(e));a.onAudience(()=>o.update());let s=document.querySelector(`#app`),c=e.inputs?.length?new Yi({ports:()=>a.ports,hasInternal:()=>!1,setInternal:()=>{},attach:async(n,r)=>{let i=t.context,o=e.inputs.find(e=>e.jack===n),s=t.jackNode(o.device,`in`,o.jack);if(!i||!s)throw Error(`Audio is not running`);let c=await a.subscribe(i,r,14);if(o.mono){let e=i.createGain();return e.channelCount=1,e.channelCountMode=`explicit`,c.node.connect(e).connect(s),()=>{e.disconnect(),c.close()}}return c.node.connect(s),()=>c.close()}},e.inputs.map(e=>e.jack),Object.fromEntries(e.inputs.map(e=>[e.jack,e.defaultPort])),void 0,`moa.inputs.${e.id}`):void 0;a.onChange(()=>c?.reconcile());let l=!1,u=async()=>{if(l)return;l=!0,await t.start(),o.update();let n=t.context;if(n)for(let r of e.ports){let e=t.jackNode(r.device,`out`,r.jack);e&&await a.publish(n,e,r.name)}c?.start(),d.textContent=`Audio running`,d.disabled=!0,Da(e.id,`started`)},d=document.createElement(`button`);d.className=`start`,d.textContent=`Start audio`,d.addEventListener(`click`,()=>void u());function f(t,i=performance.now()){let a=ca(t);a&&(n.handle(a,i),r.record(a,i),e.onMidi(a))}i.onMessage=(e,t)=>f(e,t),i.connectIfPermitted();let p=new _a;p.onMessage=(e,t)=>f(e,t);let m=new _a(wa(e.id));m.enabled=!0,m.onMessage=(e,t)=>f(e,t),Ea(e.id,t=>{t.type===`start`?u():t.settings&&ka(e.patch,t.settings)}),Da(e.id,`loaded`);let h=Ba(i,n,r,d,p);if(c&&e.inputs){let t=$(`div`,`midi-block`);t.append($(`div`,`fader-label`,e.inputs.length>1?`Inputs`:`Input`));for(let n of e.inputs)t.append(Ia(c,n.jack,n.label,`None`));h.append(t)}return h.append(Pa(a,o)),s.append(Ha(e.self),h,...Array.isArray(e.panel)?e.panel:[e.panel]),{handleMidiBytes:f,pcm:a}}var Wa=new O,Ga=gi.drums(Wa),Ka=new ue(Ga),qa=Ga.device(`drums`),Ja=new vt(qa,Wa,()=>Ka.currentTime);setInterval(()=>Ja.tick(),25),Ua({id:`drums`,patch:Ga,engine:Ka,clock:Wa,self:`/drums/`,panel:Gi(qa,Ja,`drums`,Ka),ports:A.map(e=>({device:`drums`,jack:e,name:`Drums: ${rt[e]}`})),onMidi:e=>{qa.handleMidi(e),Ja.handleMidi(e)}});