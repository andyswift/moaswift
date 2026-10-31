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
`,n=[`chrom`,`major`,`minor`,`pent`,`dorian`,`blues`],r={chrom:[0,1,2,3,4,5,6,7,8,9,10,11],major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10],pent:[0,3,5,7,10],dorian:[0,2,3,5,7,9,10],blues:[0,3,5,6,7,10]},i={"1/4":24,"1/8":12,"1/8T":8,"1/16":6,"1/16T":4},a=(e,t,n,r,i,a=``,o=`linear`)=>({id:e,label:t,kind:`number`,min:n,max:r,def:i,unit:a,curve:o}),o=(e,t,n,r)=>({id:e,label:t,kind:`choice`,min:0,max:n.length-1,def:n.indexOf(r),options:n}),s=[.2,.35,.5,.35,.2,.6,.5,.35,.2,.35,.5,.7,.6,.5,.35,.2],c=[...Array.from({length:16},(e,t)=>a(`sq.step.${t+1}`,`Step ${t+1}`,0,1,s[t])),...Array.from({length:16},(e,t)=>o(`sq.gate.${t+1}`,`Step ${t+1} gate`,[`off`,`1`,`2`,`3`],`1`)),o(`sq.mode`,`Steps`,[`16`,`8x2`],`16`),o(`sq.dir`,`Direction`,[`fwd`,`rev`,`pingpong`,`random`],`fwd`),o(`sq.skip`,`Bus 3 does`,[`skip`,`off`,`reset`],`off`),o(`sq.trig`,`Start/stop input`,[`trig`,`gate`],`trig`),a(`sq.rate`,`Clock frequency`,.2,40,6,`Hz`,`log`),a(`sq.fm`,`Clock FM`,0,1,0),a(`sq.pw`,`Pulse width`,.05,.95,.5),o(`sq.scale`,`Quantizer scale`,n,`chrom`),o(`sq.range`,`Quantizer range`,[`1`,`2`,`4`],`2`),o(`sq.sync`,`Clock source`,[`int`,`midi`],`int`),o(`sq.div`,`MIDI division`,Object.keys(i),`1/16`)],l=[`sq.a`,`sq.b`,`sq.qa`,`sq.qb`,`sq.bus1`,`sq.bus2`,`sq.bus3`,`sq.pos1`,`sq.cgate1`,`sq.clk`],u=[{id:`sq.cvin`},{id:`sq.ina`,normal:`sq.a`},{id:`sq.inb`,normal:`sq.b`},{id:`sq.start`},{id:`sq.stop`},{id:`sq.startstop`},{id:`sq.stepin`},{id:`sq.resetin`},{id:`sq.fmin`,slider:`sq.fm`},{id:`sq.pwm`},{id:`sq.extclk`}],d=(e,t,n,r,i,a=``,o=`linear`)=>({id:e,label:t,kind:`number`,min:n,max:r,def:i,unit:a,curve:o}),f=(e,t,n,r)=>({id:e,label:t,kind:`choice`,min:0,max:n.length-1,def:n.indexOf(r),options:n}),p=(e,t,n=0)=>({id:e,label:t,kind:`toggle`,min:0,max:1,def:n}),m=(e,t,n=0)=>d(e,t,0,1,n),h=[d(`kb.porta`,`Portamento`,0,1,.25),p(`kb.portaOn`,`Portamento on`,0),f(`kb.voice`,`Voice mode`,[`mono`,`duo`],`mono`),f(`kb.repeat`,`Repeat`,[`kybd`,`off`,`auto`],`off`),f(`kb.trig`,`Trigger mode`,[`single`,`multi`],`multi`),d(`lfo.speed`,`LFO speed`,.1,30,5,`Hz`,`log`),d(`lfo.delay`,`Vibrato delay`,0,3,0,`s`),m(`lfo.depth`,`Vibrato depth`,0),m(`pre.gain`,`Preamp gain`,.5),f(`pre.range`,`Preamp range`,[`x10`,`x100`,`x1000`],`x10`),m(`envf.gain`,`Env follower gain`,.5),f(`ring.mode`,`Ring mod mode`,[`audio`,`dc`],`audio`),m(`ring.a`,`Ring mod A level`,1),m(`ring.b`,`Ring mod B level`,1),m(`noise.color`,`Noise color`,0),m(`noise.level`,`Noise level`,.8),d(`vco1.freq`,`Initial frequency`,10,1e4,261.63,`Hz`,`log`),d(`vco1.fine`,`Fine tune`,-6,6,0,`st`),d(`vco1.pw`,`Pulse width`,.1,.9,.5),f(`vco1.range`,`Range`,[`audio`,`lf`],`audio`),m(`vco1.fm.sh`,`FM S/H`),m(`vco1.fm.adsr`,`FM ADSR`),m(`vco1.fm.lfo`,`FM LFO`),d(`vco2.freq`,`Initial frequency`,10,1e4,261.63,`Hz`,`log`),d(`vco2.fine`,`Fine tune`,-6,6,0,`st`),d(`vco2.pw`,`Pulse width`,.1,.9,.5),f(`vco2.range`,`Range`,[`audio`,`lf`],`audio`),p(`vco2.sync`,`Sync to VCO 1`),m(`vco2.fm.sh`,`FM S/H`),m(`vco2.fm.adsr`,`FM ADSR`),m(`vco2.fm.vco1`,`FM VCO 1`),m(`vco2.pwm`,`PWM noise`),d(`vco3.freq`,`Initial frequency`,10,1e4,261.63,`Hz`,`log`),d(`vco3.fine`,`Fine tune`,-6,6,0,`st`),d(`vco3.pw`,`Pulse width`,.1,.9,.5),f(`vco3.range`,`Range`,[`audio`,`lf`],`audio`),p(`vco3.sync`,`Sync to VCO 1`),m(`vco3.fm.noise`,`FM noise`),m(`vco3.fm.adsr`,`FM ADSR`),m(`vco3.fm.vco2`,`FM VCO 2`),m(`vco3.pwm`,`PWM ADSR`),d(`vcf.freq`,`Initial frequency`,10,16e3,1200,`Hz`,`log`),d(`vcf.fine`,`Fine tune`,-1,1,0,`oct`),m(`vcf.res`,`Resonance`,0),f(`vcf.mode`,`Mode`,[`4012`,`4072`],`4072`),m(`vcf.in.ring`,`Audio ring mod`),m(`vcf.in.vco1`,`Audio VCO 1`,.8),m(`vcf.in.vco2`,`Audio VCO 2`),m(`vcf.in.vco3`,`Audio VCO 3`),m(`vcf.in.noise`,`Audio noise`),m(`vcf.cv.kybd`,`Control keyboard`,1),m(`vcf.cv.adsr`,`Control ADSR`,.3),m(`vcf.cv.vco2`,`Control VCO 2`),d(`sem.freq`,`Frequency`,10,16e3,16e3,`Hz`,`log`),m(`sem.res`,`Resonance`,0),m(`sem.mode`,`LP / notch / HP`,0),p(`sem.bp`,`Band pass`),m(`sem.in.vco1`,`Audio VCO 1`),m(`sem.in.vco2`,`Audio VCO 2`),m(`sem.in.vco3`,`Audio VCO 3`),m(`sem.in.noise`,`Audio noise`),m(`sem.cv.kybd`,`Control keyboard`,1),m(`sem.cv.adsr`,`Control ADSR`),m(`sem.cv.lfo`,`Control LFO`),d(`adsr.attack`,`Attack`,.001,10,.005,`s`,`log`),d(`adsr.decay`,`Decay`,.002,10,.4,`s`,`log`),m(`adsr.sustain`,`Sustain`,.6),d(`adsr.release`,`Release`,.002,10,.3,`s`,`log`),f(`adsr.factor`,`Time factor`,[`x0.5`,`x1`,`x2`],`x1`),d(`ar.attack`,`Attack`,.001,10,.005,`s`,`log`),d(`ar.release`,`Release`,.002,10,.3,`s`,`log`),f(`ar.factor`,`Time factor`,[`x0.5`,`x1`,`x2`],`x1`),f(`ar.source`,`AR gate`,[`kybd`,`sh`],`kybd`),m(`vca.gain`,`Initial gain`,0),m(`vca.in.vcf`,`Audio VCF`,.8),m(`vca.in.sem`,`Audio SEM`),m(`vca.in.ring`,`Audio ring mod`),m(`vca.cv.ar`,`Control AR (lin)`),m(`vca.cv.adsr`,`Control ADSR (exp)`,1),m(`vp.2`,`Processor 2 (-10 V)`),m(`vp.4`,`Processor 4 (KYBD CV)`),m(`vp.6`,`Processor 6 (+10 V)`),m(`vp.lag`,`Lag time`,.3),m(`sh.level`,`S/H input level`,1),d(`sh.rate`,`S/H clock rate`,.1,50,6,`Hz`,`log`),m(`mix.vcf`,`Mixer VCF`),m(`mix.vca`,`Mixer VCA`,.8),m(`reverb.left`,`Reverb left`,.15),m(`reverb.right`,`Reverb right`,.15),d(`mix.pan`,`Pan`,-1,1,0),m(`out.volume`,`Volume`,.8),...c],g=[d(`bend`,`Bend`,-2,2,0,`st`),m(`modw`,`Mod wheel`)],ee=new Set(h.filter(e=>e.kind!==`number`).map(e=>e.id)),_=[`kb.cv`,`kb.upper`,`kb.gate`,`kb.trig`,`lfo.tri`,`lfo.square`,`lfo.delayed`,`pre.out`,`envf.out`,`ring.out`,`noise.out`,`vco1.saw`,`vco1.pulse`,`vco2.tri`,`vco2.saw`,`vco2.sine`,`vco2.pulse`,`vco3.tri`,`vco3.saw`,`vco3.sine`,`vco3.pulse`,`vcf.out`,`sem.out`,`adsr.out`,`ar.out`,`vca.out`,`mix.out`,`reverb.out`,`vp.inv1`,`vp.inv2`,`vp.lag`,`sh.out`,`sh.clk`,`esw.c`,...l],v=[{id:`kb.extvib`},{id:`pre.in`},{id:`envf.in`,normal:`pre.out`,slider:`envf.gain`},{id:`ring.a`,normal:`vco1.saw`,slider:`ring.a`},{id:`ring.b`,normal:`vco2.tri`,slider:`ring.b`},{id:`vco1.fm.kybd`,normal:`kb.cv`},{id:`vco1.fm.sh`,normal:`sh.out`,slider:`vco1.fm.sh`},{id:`vco1.fm.adsr`,normal:`adsr.out`,slider:`vco1.fm.adsr`},{id:`vco1.fm.lfo`,normal:`lfo.tri`,slider:`vco1.fm.lfo`},{id:`vco2.fm.kybd`,normal:`kb.upper`},{id:`vco2.fm.sh`,normal:`sh.out`,slider:`vco2.fm.sh`},{id:`vco2.fm.adsr`,normal:`adsr.out`,slider:`vco2.fm.adsr`},{id:`vco2.fm.vco1`,normal:`vco1.pulse`,slider:`vco2.fm.vco1`},{id:`vco2.pwm`,normal:`noise.out`,slider:`vco2.pwm`},{id:`vco3.fm.kybd`,normal:`kb.upper`},{id:`vco3.fm.noise`,normal:`noise.out`,slider:`vco3.fm.noise`},{id:`vco3.fm.adsr`,normal:`adsr.out`,slider:`vco3.fm.adsr`},{id:`vco3.fm.vco2`,normal:`vco2.sine`,slider:`vco3.fm.vco2`},{id:`vco3.pwm`,normal:`adsr.out`,slider:`vco3.pwm`},{id:`vcf.in.ring`,normal:`ring.out`,slider:`vcf.in.ring`},{id:`vcf.in.vco1`,normal:`vco1.pulse`,slider:`vcf.in.vco1`},{id:`vcf.in.vco2`,normal:`vco2.pulse`,slider:`vcf.in.vco2`},{id:`vcf.in.vco3`,normal:`vco3.saw`,slider:`vcf.in.vco3`},{id:`vcf.in.noise`,normal:`noise.out`,slider:`vcf.in.noise`},{id:`vcf.cv.kybd`,normal:`kb.cv`,slider:`vcf.cv.kybd`},{id:`vcf.cv.adsr`,normal:`adsr.out`,slider:`vcf.cv.adsr`},{id:`vcf.cv.vco2`,normal:`vco2.sine`,slider:`vcf.cv.vco2`},{id:`sem.in.vco1`,normal:`vco1.saw`,slider:`sem.in.vco1`},{id:`sem.in.vco2`,normal:`vco2.saw`,slider:`sem.in.vco2`},{id:`sem.in.vco3`,normal:`vco3.pulse`,slider:`sem.in.vco3`},{id:`sem.in.noise`,normal:`noise.out`,slider:`sem.in.noise`},{id:`sem.cv.kybd`,normal:`kb.cv`,slider:`sem.cv.kybd`},{id:`sem.cv.adsr`,normal:`adsr.out`,slider:`sem.cv.adsr`},{id:`sem.cv.lfo`,normal:`lfo.tri`,slider:`sem.cv.lfo`},{id:`adsr.gate`,normal:`kb.gate`},{id:`adsr.trig`,normal:`kb.trig`},{id:`ar.gate`,normal:`kb.gate`},{id:`vca.in.vcf`,normal:`vcf.out`,slider:`vca.in.vcf`},{id:`vca.in.sem`,normal:`sem.out`,slider:`vca.in.sem`},{id:`vca.in.ring`,normal:`ring.out`,slider:`vca.in.ring`},{id:`vca.cv.ar`,normal:`ar.out`,slider:`vca.cv.ar`},{id:`vca.cv.adsr`,normal:`adsr.out`,slider:`vca.cv.adsr`},{id:`mix.in.vcf`,normal:`vcf.out`,slider:`mix.vcf`},{id:`mix.in.vca`,normal:`vca.out`,slider:`mix.vca`},{id:`vp.1`},{id:`vp.2`,normal:`-10V`,slider:`vp.2`},{id:`vp.3`},{id:`vp.4`,normal:`kb.cv`,slider:`vp.4`},{id:`vp.5`},{id:`vp.6`,normal:`+10V`,slider:`vp.6`},{id:`vp.7`,normal:`envf.out`},{id:`sh.in`,normal:`noise.out`,slider:`sh.level`},{id:`sh.extclk`},{id:`esw.a`},{id:`esw.b`},{id:`out.left`},{id:`out.right`},...u],te=`moa-duo`,y=`
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
  registerProcessor('${te}', MoaDuo);
}
`,b=`moa-fold`,ne=`
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
  registerProcessor('${b}', MoaFold);
}
`,re=`moa-ladder`,ie=`
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
  registerProcessor('${re}', MoaLadder);
}
`,ae=`moa-60`,oe=`
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
  registerProcessor('${ae}', Moa60);
}
`,se=`moa-string`,ce=`
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
  registerProcessor('${se}', MoaString);
}
`,le=`moa-voice`,ue=`
/** The speed of sound in warm, moist air, m/s. */
const VOICE_C = 350;
/** How far the ring narrows (or widens) the tube above the folds across its range, as a fraction of its width. */
const RING_NARROW = 0.8;
/** The tract area (at its narrowest) at which the airflow through the folds is halved: a nearly closed mouth. */
const FLOW_AREA = 0.05;
/** How loud the breath of an h, or after a p t k, is: about 10 dB under the vowel, as speech has it. */
const ASP_LEVEL = 1.3;
/** How loud the turbulence at a constriction is (a fricative, a burst), against the tone. */
const FRIC_LEVEL = 4, BURST_LEVEL = 0.2;
/**
 * The walls' losses, more at high frequencies (the soft walls give, the air rubs): each section's waves pass through a
 * gentle low-pass, this much of the step before. Its small delay makes each section act longer, so the tract is built
 * of that many fewer sections for its length. Without it the tube's upper formants ring and the top end rises: a
 * squeaky, scratchy voice.
 */
const WALL = 0.2;
/**
 * The aspiration noise's level, set where the formants live (2 to 3 kHz): the default breath (0.25) about 15 dB under
 * the harmonics there (a clear voice), full breath about 3 (very breathy). Set by the whole band it was 22 dB, but the
 * tone's loud low end hid the noise drowning F2 and F3, and with them which vowel and which consonant it was.
 */
const NOISE_LEVEL = 0.08;

class VoiceCore {
  constructor(sampleRate, lengthCm, seed) {
    this.sr = sampleRate;
    this.seed = seed || 12345;
    // the voice
    this.on = false;
    this.hz = 220; this.targetHz = 220; this.glide = 0.06;
    this.amp = 0; this.targetAmp = 0; this.attack = 0.08; this.release = 0.25;
    this.tension = 0.6; this.breath = 0.25;
    this.vibRate = 5.5; this.vibDepth = 30; this.vibDelay = 0.35; this.vibPhase = 0; this.sinceOn = 0;
    this.bend = 0; // semitones
    this.drift = 0; this.driftTarget = 0; this.driftAt = 0;
    // expression: how a note starts (0 breathy, 1 a hard glottal attack), the scoop up into it (cents), the cycle-to-
    // cycle roughness (jitter and shimmer), and the expression pedal (a multiplier on how loud)
    this.onset = 0.5; this.scoop = 40; this.roughness = 0.3; this.expression = 1;
    this.air = 0; this.onsetBreath = 0; this.onsetTense = 0; this.attackScale = 1; this.scoopOff = 0; this.exhale = 0;
    this.jitter = 0; this.shimmer = 1; this.vibRateMul = 1; this.vibDepthMul = 1;
    this.phase = 0; // through the glottal period, 0..1
    this.lf = null;
    // the consonant articulators: each where it closes (in sections; -1 not yet), its width now and where it is going
    // (9: open, no say); the velum; the folds voicing (a gate); turbulence at a constriction and at the glottis
    this.arts = [0, 1, 2].map(() => ({ index: -1, diam: 9, target: 9 }));
    this.noiseAt = -1; this.gap = 0; this.burstAt = -1;
    this.velumNow = 0.01; this.velumTarget = 0.01;
    this.vg = 1; this.voicedTarget = 1; this.fric = 0; this.fricTarget = 0; this.asp = 0; this.aspTarget = 0; this.burst = 0; this.burstNow = 0;
    // a syllable's gestures: the one under way, those to come, and what the note's end will do
    this.gesture = null; this.gLeft = 0; this.queue = []; this.ending = false; this.vowel2 = null; this.coda = [];
    this.fHp = 0; this.fHpX = 0; this.fLp = 0;
    this.setLength(lengthCm || 16.5);
    this.shape = { tongueIndex: 14, tongueDiameter: 2.8, lips: 1.5, velum: 0.01 };
    this.setShape(this.shape, true);
    this.updateTract(1); this.updateTract(1); // the areas and reflections, before the first block
    // aspiration noise (its filters' state, and the turbulence's slow flutter), and the output's DC blocker
    this.nHp = 0; this.nHpX = 0; this.nLp = 0; this.flutter = 0;
    this.hpX = 0; this.hpY = 0;
  }

  /** The tract's length, cm: the number of sections (each half a sample of travel). */
  setLength(cm) {
    const step = VOICE_C / (2 * this.sr);
    const n = Math.max(24, Math.min(80, Math.round(cm / 100 / step / (1 + WALL))));
    if (n === this.n) return;
    this.n = n;
    this.R = new Float64Array(n); this.L = new Float64Array(n); this.pR = new Float64Array(n); this.pL = new Float64Array(n);
    this.jR = new Float64Array(n + 1); this.jL = new Float64Array(n + 1);
    this.diameter = new Float64Array(n); this.target = new Float64Array(n); this.rest = new Float64Array(n); this.vdiam = new Float64Array(n);
    this.A = new Float64Array(n);
    this.refl = new Float64Array(n + 1); this.newRefl = new Float64Array(n + 1);
    const at = (k) => Math.round((k * n) / 44); // landmarks on Pink Trombone's 44-section grid, scaled
    this.bladeStart = at(10); this.tipStart = at(32); this.lipStart = at(39); this.noseStart = at(17);
    this.larynxEnd = at(7);
    for (let i = 0; i < n; i++) {
      const d = i < at(7) - 0.5 ? 0.6 : i < at(12) ? 1.1 : 1.5; // the larynx narrow, the pharynx opening out
      this.rest[i] = d; this.diameter[i] = d; this.target[i] = d; this.vdiam[i] = d;
    }
    // the nose: 28 sections on the same grid, widening then narrowing to the nostrils
    const m = at(28);
    this.nm = m;
    this.nR = new Float64Array(m); this.nL = new Float64Array(m);
    this.njR = new Float64Array(m + 1); this.njL = new Float64Array(m + 1);
    this.nA = new Float64Array(m); this.nRefl = new Float64Array(m + 1);
    for (let i = 0; i < m; i++) {
      const d = 2 * (i / m);
      const dia = Math.min(1.9, d < 1 ? 0.4 + 1.6 * d : 0.5 + 1.5 * (2 - d));
      this.nA[i] = dia * dia;
    }
    for (let i = 1; i < m; i++) this.nRefl[i] = (this.nA[i - 1] - this.nA[i]) / (this.nA[i - 1] + this.nA[i]);
    if (this.shape) this.setShape(this.shape, true);
  }

  /** The tongue, the lips and the velum: the diameters the tract moves toward (now, if \`jump\`). */
  setShape(s, jump) {
    this.shape = s;
    const n = this.n, t = this.target;
    for (let i = 0; i < n; i++) t[i] = this.rest[i];
    // the ring (the singer's formant): the tube just above the folds (about 2.5 cm, a sixth of the throat's area as it
    // rests) narrowed, so its own resonance near 3 kHz gathers the third to fifth formants into one bright peak;
    // widened, the ring goes. 0.5 is the tract at rest
    const ring = (s.ring === undefined ? 0.5 : s.ring) - 0.5;
    for (let i = 0; i < this.larynxEnd; i++) t[i] *= 1 - RING_NARROW * ring;
    // the tongue's body: a bump along the mouth, centred at tongueIndex, its height from tongueDiameter
    const index = (s.tongueIndex * n) / 44, dia = s.tongueDiameter;
    for (let i = this.bladeStart; i < this.lipStart; i++) {
      const tt = (1.1 * Math.PI * (index - i)) / (this.tipStart - this.bladeStart);
      const fixed = 2 + (dia - 2) / 1.5;
      let curve = (1.5 - fixed + 1.7) * Math.cos(tt);
      if (i === this.bladeStart - 2 || i === this.lipStart - 1) curve *= 0.8;
      if (i === this.bladeStart || i === this.lipStart - 2) curve *= 0.94;
      t[i] = Math.max(0.05, 1.5 - curve);
    }
    for (let i = this.lipStart; i < n; i++) t[i] = Math.max(0.05, s.lips);
    this.velum = Math.max(0.01, s.velum);
    if (!this.gesture) this.velumTarget = this.velum;
    if (jump) { for (let i = 0; i < n; i++) { this.vdiam[i] = t[i]; this.diameter[i] = t[i]; } this.velumNow = this.velumTarget; }
  }

  /** The pitch (Hz), how loud (0..1), and whether the note glides from the last one (legato) or starts afresh. */
  noteOn(hz, intensity, legato, syllable) {
    this.targetHz = hz;
    if (syllable) {
      // a syllable (legato too: the voice sings on through its consonants): the tongue to its vowel and its first
      // consonants under way. From silence (nothing sounding, not even a breath out) the mouth is set at once; if it
      // is open from the last note, a consonant that closes it is formed first, silently, the folds still, before it
      // sounds (as a singer closes the mouth in the gap between notes), so a na is not an a-na
      const fromSilence = !legato && this.amp === 0 && this.exhale < 1e-3 && this.air < 1e-3;
      this.setShape(syllable.vowel, fromSilence);
      this.vowel2 = syllable.vowel2 || null; this.coda = syllable.coda || []; this.ending = false;
      this.queue = syllable.onset.slice();
      const first = this.queue[0];
      if (first && !fromSilence && !legato && first.index >= 0 && first.diameter < 0.3) {
        this.queue.unshift({ ...first, voiced: false, voicing: 0, noise: 0, aspirate: 0, dur: 0.03 });
        this.vg = Math.min(this.vg, this.amp < 0.05 ? 0 : this.vg);
      }
      if (this.queue.length) {
        this.nextGesture();
        if (fromSilence) for (const a of this.arts) a.diam = a.target; // the mouth is shaped before the sound starts
      } else this.clearGesture();
    }
    if (!legato) {
      // a new note: on its pitch but scooped up into it, its vibrato to come; breathy onsets lead with air and let the
      // tone in slowly, hard ones snap the folds shut (tense for a moment) and start at once
      this.hz = hz; this.sinceOn = 0;
      this.scoopOff = -this.scoop;
      this.onsetBreath = 1.0 * (1 - this.onset);
      this.onsetTense = 0.4 * this.onset;
      this.attackScale = 0.3 + 2.2 * (1 - this.onset);
      if (syllable && syllable.onset.length) this.attackScale = Math.min(this.attackScale, 0.4); // the consonant starts it
    }
    this.on = true;
    this.targetAmp = intensity;
  }

  /** The note let go: the tone dies away, with a little breath out after it. */
  noteOff() {
    if (this.on && !this.ending && (this.vowel2 || this.coda.length)) {
      // sing on to the end of the syllable: a diphthong's second vowel, then its last consonants
      this.ending = true;
      this.queue = [];
      if (this.vowel2) { this.setShape(this.vowel2, false); this.queue.push({ index: -1, diameter: 9, velum: -1, voiced: true, noise: 0, aspirate: 0, dur: 0.12 }); }
      this.queue.push(...this.coda);
      this.vowel2 = null; this.coda = [];
      this.nextGesture();
      return;
    }
    this.finishOff();
  }

  /** The tone dies away, with a little breath out after it. */
  finishOff() {
    if (this.on) this.exhale = 0.15 * this.amp;
    this.on = false; this.targetAmp = 0; this.ending = false;
  }

  random() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }

  /** The LF pulse's shape for a voice quality Rd (Fant's equations, as Pink Trombone solves them). */
  setupLF(rd) {
    rd = Math.max(0.5, Math.min(2.7, rd));
    const ra = -0.01 + 0.048 * rd, rk = 0.224 + 0.118 * rd;
    const rg = (rk / 4) * (0.5 + 1.2 * rk) / (0.11 * rd - ra * (0.5 + 1.2 * rk));
    const ta = ra, tp = 1 / (2 * rg), te = tp + tp * rk;
    const epsilon = 1 / ta, shift = Math.exp(-epsilon * (1 - te)), delta = 1 - shift;
    let rhs = (1 / epsilon) * (shift - 1) + (1 - te) * shift;
    rhs /= delta;
    const lower = -(te - tp) / 2 + rhs, upper = -lower;
    const omega = Math.PI / tp, s = Math.sin(omega * te);
    const y = (-Math.PI * s * upper) / (tp * 2);
    const alpha = Math.log(y) / (tp / 2 - te);
    const e0 = -1 / (s * Math.exp(alpha * te));
    this.lf = { alpha, e0, epsilon, shift, delta, te, omega };
  }

  /** The glottal flow's derivative at a point in the period (0..1). */
  pulse(t) {
    const g = this.lf;
    if (t > g.te) return (-Math.exp(-g.epsilon * (t - g.te)) + g.shift) / g.delta;
    return g.e0 * Math.exp(g.alpha * t) * Math.sin(g.omega * t);
  }

  /** One step of the tract (and the nose), with this much glottal input; returns what leaves the lips and nostrils. */
  step(input, frac, turbulence) {
    const n = this.n, R = this.R, L = this.L, jR = this.jR, jL = this.jL;
    const r0 = this.refl, r1 = this.newRefl;
    // turbulence made just past the constriction, going both ways
    if (turbulence && this.noiseAt >= 0) {
      const k = Math.min(n - 1, Math.max(1, Math.round(this.noiseAt) + 1));
      R[k] += turbulence / 2; L[k] += turbulence / 2;
    }
    // the glottis end reflects most of the wave back; the lips reflect it inverted
    jR[0] = L[0] * 0.75 + input;
    jL[n] = R[n - 1] * -0.85;
    const J = this.noseStart;
    for (let i = 1; i < n; i++) {
      if (i === J) continue;
      const r = r0[i] + (r1[i] - r0[i]) * frac;
      const w = r * (R[i - 1] - L[i]);
      jR[i] = R[i - 1] + w;
      jL[i] = L[i] + w;
    }
    // the velum: a three-way junction, the pressure there shared out by area
    {
      const aL = this.A[J - 1], aR = this.A[J], aN = this.nA[0];
      const p = (2 * (aL * R[J - 1] + aR * L[J] + aN * this.nL[0])) / (aL + aR + aN);
      jL[J] = p - R[J - 1];
      jR[J] = p - L[J];
      this.njR[0] = p - this.nL[0];
    }
    const pR = this.pR, pL = this.pL;
    for (let i = 0; i < n; i++) {
      const r = jR[i], l = jL[i + 1];
      R[i] = 0.999 * ((1 - WALL) * r + WALL * pR[i]); L[i] = 0.999 * ((1 - WALL) * l + WALL * pL[i]);
      pR[i] = r; pL[i] = l;
    }
    // the nose
    const m = this.nm, nR = this.nR, nL = this.nL, njR = this.njR, njL = this.njL, nr = this.nRefl;
    njL[m] = nR[m - 1] * -0.85;
    for (let i = 1; i < m; i++) {
      const w = nr[i] * (nR[i - 1] - nL[i]);
      njR[i] = nR[i - 1] + w;
      njL[i] = nL[i] + w;
    }
    // the nose's soft, lined walls and sinuses soak up far more than the mouth's
    for (let i = 0; i < m; i++) { nR[i] = njR[i] * 0.985; nL[i] = njL[i + 1] * 0.985; }
    // what leaves the lips and the nostrils is the airflow, the pressure wave times the opening's area (none from a
    // shut mouth, little from the small nostrils), against an open mouth's
    // (the lips' area glides through the block, as the reflections do: stepping it would click as the lips open)
    const lipA = this.lipFrom + (this.lipTo - this.lipFrom) * frac;
    return (R[n - 1] * lipA + nR[m - 1] * this.nA[m - 1]) / 2.25;
  }

  /** The block's areas and reflections: the diameters moved toward the shape at the speed a tongue moves. */
  updateTract(seconds) {
    const n = this.n, d = this.diameter, t = this.target, v = this.vdiam, A = this.A;
    // the tongue's body moves toward the vowel at its own pace; a constriction (the tip, the lips) is quicker
    // (an articulator closes fast and opens more slowly: the formants' glide out of a consonant, 40 to 60 ms, is where
    // a listener hears where it was made)
    const k = 1 - Math.exp(-seconds / 0.035), kc = 1 - Math.exp(-seconds / 0.01), ko = 1 - Math.exp(-seconds / 0.02), kv = 1 - Math.exp(-seconds / 0.015);
    for (let i = 0; i < n; i++) v[i] += (t[i] - v[i]) * k;
    this.velumNow += (this.velumTarget - this.velumNow) * kv;
    for (let i = 0; i < n; i++) d[i] = v[i];
    // each articulator closes the tract where it is; the narrowest gap is where the air hisses
    this.gap = 0; this.noiseAt = -1;
    for (const a of this.arts) {
      if (a.index >= 0 && a.target >= 8 && a.diam < 8) {
        // letting go: back to the vowel's own width there, at the pace the formants glide out of a consonant (where a
        // listener hears which consonant it was), and only then off. (Aimed at "wide open", it was past the vowel in a
        // few milliseconds: no glide at all.)
        const open = this.vowelWidthAt(a.index);
        a.diam += (open - a.diam) * ko;
        if (a.diam >= open * 0.97) a.diam = 9;
      } else a.diam += (a.target - a.diam) * (a.target > a.diam ? ko : kc);
      if (a.index < 0 || a.diam >= 8) continue;
      const c = a.index, cd = Math.max(0, a.diam);
      // (only a fricative's gap hisses; an l, r, w or y is too open for turbulence)
      const gap = cd < 0.005 ? 0 : Math.max(0, Math.min(1, (0.3 - cd) / 0.3));
      if (gap > this.gap) { this.gap = gap; this.noiseAt = c; }
      if (c >= this.lipStart) for (let i = this.lipStart; i < n; i++) d[i] = Math.min(d[i], cd);
      else {
        // a constriction's shape along the tract, as Pink Trombone's: wide at the back of the mouth, narrow at the front
        const g = (k44) => (k44 * n) / 44;
        const width = c < g(25) ? g(10) : c >= this.tipStart ? g(5) : g(10) - (g(5) * (c - g(25))) / (this.tipStart - g(25));
        for (let i = 0; i < n; i++) {
          const rel = Math.abs(i - c) - 0.5;
          const shrink = rel <= 0 ? 0 : rel > width ? 1 : 0.5 * (1 - Math.cos((Math.PI * rel) / width));
          if (d[i] > cd) d[i] = cd + (d[i] - cd) * shrink;
        }
      }
    }
    if (this.burst > this.gap && this.burstAt >= 0) this.noiseAt = this.burstAt; // a closure let go bursts where it was
    for (let i = 0; i < n; i++) A[i] = d[i] * d[i];
    this.lipFrom = this.lipTo === undefined ? A[n - 1] : this.lipTo; this.lipTo = A[n - 1];
    // the folds feel the mouth: a narrow point above them lets pressure build behind it, the push across the folds
    // falls and so does the airflow, to almost nothing behind a closure (a b's voice bar is faint, an l's murmur soft,
    // and nothing is pumped into a shut tube to burst out as it opens). No say in an open vowel's
    let narrowest = 9;
    for (let i = this.larynxEnd; i < n; i++) if (A[i] < narrowest) narrowest = A[i];
    if (this.velumNow > 0.1) narrowest = Math.max(narrowest, this.velumNow * this.velumNow); // the nose lets the air out
    this.flowFrom = this.flowTo === undefined ? 1 : this.flowTo;
    this.flowTo = Math.min(1, (narrowest / (narrowest + FLOW_AREA)) / (1 / (1 + FLOW_AREA)));
    this.nA[0] = this.velumNow * this.velumNow; // the velum's opening, as an area at the nose's mouth
    this.nRefl[1] = (this.nA[0] - this.nA[1]) / (this.nA[0] + this.nA[1]); // and so how much of the wave it lets into the nose
    const r0 = this.refl, r1 = this.newRefl;
    for (let i = 1; i <= n; i++) r0[i] = r1[i];
    for (let i = 1; i < n; i++) r1[i] = A[i - 1] + A[i] < 1e-9 ? 0 : (A[i - 1] - A[i]) / (A[i - 1] + A[i]);
  }

  /** Which articulator closes at a place on the 44-section grid: the lips, the tongue's tip and blade, or its back. */
  artFor(index44) {
    return this.arts[index44 >= 39 ? 2 : index44 >= 26 ? 1 : 0];
  }

  /**
   * Sends an articulator toward a width. One that was shut and now opens bursts where it was, if air had built up
   * behind it: not for a nasal, the air going out through the nose all along.
   */
  /** How wide the vowel has the tract where an articulator acts (the lips: their narrowest). */
  vowelWidthAt(c) {
    const v = this.vdiam;
    if (c >= this.lipStart) { let m = 9; for (let i = this.lipStart; i < this.n; i++) m = Math.min(m, v[i]); return m; }
    return v[Math.max(0, Math.min(this.n - 1, Math.round(c)))];
  }

  moveArt(a, target) {
    // closing from open, it starts from where the vowel has the tract (not from "wide open", which it would take a
    // while to come in from)
    if (a.diam >= 8 && target < 8 && a.index >= 0) a.diam = this.vowelWidthAt(a.index);
    if (a.target <= 0.02 && target > 0.02 && a.index >= 0 && this.velumNow < 0.1) {
      this.burst = this.gesture && this.gesture.voiced ? 0.5 : 1; // less pressure builds behind a b d g than a p t k
      this.burstAt = a.index;
      this.burstTau = [0.022, 0.012, 0.008][this.arts.indexOf(a)]; // longest from the tongue's back, shortest from the lips
    }
    a.target = target;
  }

  /** Starts a gesture of a syllable's consonants (or holds one: a hum, a hiss); the articulators it does not use let go. */
  applyGesture(g) {
    this.gesture = g; this.gLeft = g.dur;
    const targets = [9, 9, 9];
    if (g.index >= 0) {
      const a = this.artFor(g.index);
      a.index = (g.index * this.n) / 44;
      targets[this.arts.indexOf(a)] = g.diameter;
    }
    if (typeof g.lips === 'number') {
      const lips = this.arts[2];
      if (lips.index < 0 || targets[2] === 9) lips.index = this.lipStart;
      targets[2] = Math.min(targets[2], g.lips);
    }
    this.arts.forEach((a, k) => this.moveArt(a, targets[k]));
    this.velumTarget = g.velum >= 0 ? g.velum : this.velum;
    this.voicedTarget = g.voiced ? (typeof g.voicing === 'number' ? g.voicing : 1) : 0;
    this.fricTarget = g.noise || 0; this.aspTarget = g.aspirate || 0;
  }

  /** Back to the vowel: every articulator let go (a closure bursts), the velum as the vowel has it, the folds voicing. */
  clearGesture() {
    for (const a of this.arts) this.moveArt(a, 9);
    this.gesture = null; this.velumTarget = this.velum;
    this.voicedTarget = 1; this.fricTarget = 0; this.aspTarget = 0;
  }

  /** The next gesture, or the vowel; at the note's end, once the last consonant is done, the voice stops. */
  nextGesture() {
    const g = this.queue.shift();
    if (g) return this.applyGesture(g);
    if (this.ending) { this.ending = false; this.gesture = null; this.finishOff(); return; } // the mouth stays as it ends
    this.clearGesture();
  }

  process(out, len, p) {
    const sr = this.sr;
    this.updateTract(len / sr);
    if (!this.lf) this.setupLF(this.rdFor());
    // aspiration noise: turbulence at the glottis is broadband, so white noise with only its extremes taken off (a
    // one-pole high-pass at 250 Hz, a low-pass at 4 kHz); the tract shapes it into the vowel, as it does the tone
    const hpA = Math.exp((-2 * Math.PI * 250) / sr), lpA = Math.exp((-2 * Math.PI * 4000) / sr), flA = Math.exp((-2 * Math.PI * 30) / sr);
    // the attack and release are the times to get there (within a few per cent, and -43 dB)
    const target = this.targetAmp * this.expression;
    const rising = target > this.amp;
    const ampK = 1 - Math.exp(-1 / (sr * (rising ? (this.attack * this.attackScale) / 3 : this.release / 5)));
    const airK = 1 - Math.exp(-1 / (sr * (rising ? 0.01 : this.release / 5))); // the air comes at once
    const hzK = 1 - Math.exp(-1 / (sr * Math.max(0.002, this.glide)));
    const gateK = 1 - Math.exp(-1 / (sr * 0.005)), burstD = Math.exp(-1 / (sr * (this.burstTau || 0.012))), burstK = 1 - Math.exp(-1 / (sr * 0.0008));
    const fHpA = Math.exp((-2 * Math.PI * 1000) / sr), fLpA = Math.exp((-2 * Math.PI * 8000) / sr);
    const fast = Math.exp(-1 / (sr * 0.04)), medium = Math.exp(-1 / (sr * 0.08)), slow = Math.exp(-1 / (sr * 0.1));
    for (let i = 0; i < len; i++) {
      this.amp += (target - this.amp) * ampK;
      this.air += (target - this.air) * airK;
      if (!this.on && this.amp < 1e-4) { this.amp = 0; if (this.air < 1e-4) this.air = 0; }
      this.onsetBreath *= medium; this.onsetTense *= fast; this.scoopOff *= medium; this.exhale *= slow;
      // the syllable's gestures run on; the folds' voicing and the turbulence follow them quickly
      if (this.gesture && this.gLeft !== Infinity && (this.gLeft -= 1 / sr) <= 0) this.nextGesture();
      this.vg += (this.voicedTarget - this.vg) * gateK;
      this.fric += (this.fricTarget - this.fric) * gateK;
      this.asp += (this.aspTarget - this.asp) * gateK;
      this.burst *= burstD;
      this.burstNow += (this.burst - this.burstNow) * burstK; // even a burst takes a moment to rise
      this.hz *= Math.pow(this.targetHz / this.hz, hzK);
      // vibrato fading in after the note starts and deepening as it is held, its rate and depth never quite even;
      // and a slow wander of a few cents
      this.sinceOn += 1 / sr;
      const held = this.sinceOn - this.vibDelay;
      const fadeIn = Math.min(1, Math.max(0, held / 0.4)) * (0.75 + 0.25 * Math.min(1, Math.max(0, held / 1.5)));
      this.vibPhase += (this.vibRate * this.vibRateMul) / sr;
      if (this.vibPhase > 1) {
        this.vibPhase -= 1;
        this.vibRateMul = 1 + (this.random() - 0.5) * 0.16;
        this.vibDepthMul = 1 + (this.random() - 0.5) * 0.3;
      }
      if (--this.driftAt <= 0) { this.driftTarget = (this.random() - 0.5) * 8; this.driftAt = sr * (0.2 + 0.3 * this.random()); }
      this.drift += (this.driftTarget - this.drift) * (4 / sr);
      const vib = this.vibDepth * this.vibDepthMul * fadeIn * Math.sin(2 * Math.PI * this.vibPhase);
      const cents = vib + this.drift + this.scoopOff + this.bend * 100;
      const f = this.hz * Math.pow(2, cents / 1200) * (1 + this.jitter);
      // the glottis: the pulse, louder and a little tenser the louder the note, worked out at each of the tract's two
      // steps (its sharp closing edge, taken once a sample, would fold back down as a gritty haze); and turbulence while
      // it is open (more at a breathy onset, and a breath out after the note)
      const flow = this.flowFrom + (this.flowTo - this.flowFrom) * (i / len);
      const loud = this.amp, k = loud > 1e-5 ? loud * this.vg * flow : 0;
      const voiced = k ? this.pulse(this.phase) * k * this.shimmer : 0;
      this.advancePhase(f / (2 * sr));
      const voiced2 = k ? this.pulse(this.phase) * k * this.shimmer : 0;
      const white = this.random() * 2 - 1;
      this.nHp = hpA * (this.nHp + white - this.nHpX); this.nHpX = white;
      this.nLp = this.nHp + lpA * (this.nLp - this.nHp);
      // turbulence is never steady: its level flutters (a random wobble below 30 Hz)
      this.flutter = flA * this.flutter + (1 - flA) * (this.random() * 2 - 1);
      const noise = this.nLp * (1 + 0.5 * Math.max(-1, Math.min(1, this.flutter * 8)));
      const open = this.phase < this.lf.te ? Math.sin((Math.PI * this.phase) / this.lf.te) : 0;
      // the turbulence pulses with the airflow: strong while the glottis is open, little while it is shut
      const shut = 1 - this.vg; // folds held apart (an h, a p t k), the air flows steadily, not in pulses
      const aspiration = noise * (this.air * (this.breath + this.onsetBreath) * (0.1 + 0.9 * (open * this.vg + shut)) + this.air * this.asp * ASP_LEVEL + this.exhale) * NOISE_LEVEL;
      const g = voiced + aspiration, g2 = voiced2 + aspiration;
      // turbulence at the constriction: air through a narrow gap (none through a shut one), and a closure's burst
      let turbulence = 0;
      if (this.noiseAt >= 0 && this.air > 1e-4) {
        const white2 = this.random() * 2 - 1;
        this.fHp = fHpA * (this.fHp + white2 - this.fHpX); this.fHpX = white2;
        this.fLp = this.fHp + fLpA * (this.fLp - this.fHp); // and above 8 kHz it fades
        turbulence = this.fLp * this.air * (this.gap * Math.max(0, this.fric) * FRIC_LEVEL + this.burstNow * BURST_LEVEL);
      }
      // two steps of the tract a sample
      const frac = i / len;
      let o = this.step(g, frac, turbulence);
      o += this.step(g2, frac + 0.5 / len, turbulence);
      this.advancePhase(f / (2 * sr));
      o *= 0.5;
      // the DC blocker, then the level and a soft limit
      const y = o - this.hpX + 0.995 * this.hpY;
      this.hpX = o; this.hpY = y;
      const v = y * 1.8 * p.level;
      out[i] = v > 3 ? 1 : v < -3 ? -1 : v * (27 + v * v) / (27 + 9 * v * v);
    }
  }

  /** Moves through the glottal period; a new period takes its shape for the tension now, and the roughness, its length and height a little off. */
  advancePhase(dp) {
    this.phase += dp;
    if (this.phase >= 1) {
      this.phase -= 1;
      this.setupLF(this.rdFor());
      this.jitter = (this.random() - 0.5) * 0.012 * this.roughness;
      this.shimmer = 1 + (this.random() - 0.5) * 0.16 * this.roughness;
    }
  }

  /** Rd from the tension and how loud the note is: louder voices are a little tenser. */
  rdFor() {
    const tense = Math.max(0, Math.min(1, this.tension + 0.15 * (this.amp - 0.7) + this.onsetTense));
    return 2.7 - 2.2 * tense;
  }

  /** The tract's diameters now (and the velum's opening), for drawing. */
  view() {
    return { diameters: Float32Array.from(this.diameter), velum: this.velum, hz: this.hz, amp: this.amp, lipStart: this.lipStart, noseStart: this.noseStart };
  }
}

/**
 * One singer or several (a backing trio): a VoiceCore each, their own tract lengths (a soprano's shorter than a
 * tenor's), their own randomness (each drifts, wobbles and breathes its own way) and vibrato rates a little apart, so
 * they sound like people singing together rather than one voice copied. A setting goes to them all; a note to one.
 */
class VoiceChoir {
  constructor(sampleRate, cfg) {
    const count = Math.max(1, cfg.voices || 1);
    this.cores = [];
    for (let k = 0; k < count; k++) {
      const core = new VoiceCore(sampleRate, (cfg.lengths && cfg.lengths[k]) || cfg.length, 12345 + 7919 * k);
      if (cfg.shape) core.setShape(cfg.shape, true);
      this.cores.push(core);
    }
    this.mix = new Float32Array(128);
    this.apply(cfg);
  }

  apply(m) {
    this.cores.forEach((c, k) => {
      const length = (m.lengths && m.lengths[k]) || m.length;
      if (length) c.setLength(length);
      if (m.shape) c.setShape(m.shape, false);
      for (const key of ['tension', 'breath', 'vibDepth', 'vibDelay', 'glide', 'attack', 'release', 'bend', 'onset', 'scoop', 'roughness', 'expression']) if (typeof m[key] === 'number') c[key] = m[key];
      if (typeof m.vibRate === 'number') c.vibRate = m.vibRate * (1 + 0.07 * (k - (this.cores.length - 1) / 2));
    });
  }

  noteOn(voice, hz, intensity, legato, syllable) { (this.cores[voice || 0] || this.cores[0]).noteOn(hz, intensity, legato, syllable); }
  noteOff(voice) { (this.cores[voice || 0] || this.cores[0]).noteOff(); }

  /** Every singer into the output, together a little quieter than they are apart (as a section balances). */
  process(out, len, p) {
    if (this.cores.length === 1) return this.cores[0].process(out, len, p);
    if (this.mix.length < len) this.mix = new Float32Array(len);
    const mix = this.mix, g = 1 / Math.sqrt(this.cores.length);
    out.fill(0, 0, len);
    for (const c of this.cores) {
      c.process(mix, len, p);
      for (let i = 0; i < len; i++) out[i] += mix[i] * g;
    }
  }

  /** The first singer's tract (for drawing), and how loud each is. */
  view() {
    const v = this.cores[0].view();
    v.amps = this.cores.map((c) => c.amp);
    return v;
  }
}

if (typeof registerProcessor === 'function') {
  class MoaVoice extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [{ name: 'level', defaultValue: 0.8, minValue: 0, maxValue: 2, automationRate: 'k-rate' }];
    }
    constructor(options) {
      super();
      const cfg = (options && options.processorOptions && options.processorOptions.config) || {};
      this.choir = new VoiceChoir(sampleRate, cfg);
      this.p = {};
      this.since = 0;
      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m) return;
        if (m.type === 'configure') this.choir.apply(m);
        else if (m.type === 'note') this.choir.noteOn(m.voice, m.hz, m.intensity, m.legato, m.syllable);
        else if (m.type === 'off') this.choir.noteOff(m.voice);
      };
    }
    process(inputs, outputs, params) {
      const out = outputs[0][0];
      this.p.level = params.level[0];
      this.choir.process(out, out.length, this.p);
      this.since += out.length;
      if (this.since >= sampleRate / 30) {
        this.since = 0;
        this.port.postMessage(this.choir.view());
      }
      return true;
    }
  }
  registerProcessor('${le}', MoaVoice);
}
`,de=`moa-drum`,fe=`
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
  registerProcessor('${de}', MoaDrum);
}
`,pe=`moa-tone`,me=`
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
  registerProcessor('${pe}', MoaTone);
}
`,he=`moa-granular`,ge=`
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
  registerProcessor('${he}', MoaGranular);
}
`,_e=n.map(e=>r[e]),ve=`
const M26_SQ_STEPS = 16;
const M26_SQ_SCALES = ${JSON.stringify(_e)};
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
`,ye=`moa-2600`,be=[...h,...g].map(e=>[e.id,e.def,e.min,e.max]),xe=v.map(e=>({id:e.id,normal:e.normal??null})),Se=`
const M26_TWO_PI = Math.PI * 2;
// name, default, min, max
const M26_PARAM_DEFS = ${JSON.stringify(be)};
const M26_DEFAULTS = {};
for (const d of M26_PARAM_DEFS) M26_DEFAULTS[d[0]] = d[1];
const M26_OUTPUTS = ${JSON.stringify(_)};
const M26_INPUTS = ${JSON.stringify(xe)};
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

${ve}
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
  registerProcessor('${ye}', Moa2600);
}
`,Ce=`moa-pipe`,we=`moa-spring`,Te=`
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
  registerProcessor('${Ce}', MoaPipe);

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
  registerProcessor('${we}', MoaSpring);
}
`,Ee=[`
const PL_PITCH_RATIO_HIGH = Float32Array.from([6.151958251e-04,6.517772725e-04,6.905339660e-04,7.315952524e-04,7.750981699e-04,8.211879055e-04,8.700182794e-04,9.217522585e-04,9.765625000e-04,1.034631928e-03,1.096154344e-03,1.161335073e-03,1.230391650e-03,1.303554545e-03,1.381067932e-03,1.463190505e-03,1.550196340e-03,1.642375811e-03,1.740036559e-03,1.843504517e-03,1.953125000e-03,2.069263856e-03,2.192308688e-03,2.322670146e-03,2.460783301e-03,2.607109090e-03,2.762135864e-03,2.926381010e-03,3.100392680e-03,3.284751622e-03,3.480073118e-03,3.687009034e-03,3.906250000e-03,4.138527712e-03,4.384617376e-03,4.645340293e-03,4.921566601e-03,5.214218180e-03,5.524271728e-03,5.852762019e-03,6.200785359e-03,6.569503244e-03,6.960146235e-03,7.374018068e-03,7.812500000e-03,8.277055425e-03,8.769234752e-03,9.290680586e-03,9.843133202e-03,1.042843636e-02,1.104854346e-02,1.170552404e-02,1.240157072e-02,1.313900649e-02,1.392029247e-02,1.474803614e-02,1.562500000e-02,1.655411085e-02,1.753846950e-02,1.858136117e-02,1.968626640e-02,2.085687272e-02,2.209708691e-02,2.341104808e-02,2.480314144e-02,2.627801298e-02,2.784058494e-02,2.949607227e-02,3.125000000e-02,3.310822170e-02,3.507693901e-02,3.716272234e-02,3.937253281e-02,4.171374544e-02,4.419417382e-02,4.682209615e-02,4.960628287e-02,5.255602595e-02,5.568116988e-02,5.899214454e-02,6.250000000e-02,6.621644340e-02,7.015387802e-02,7.432544469e-02,7.874506562e-02,8.342749089e-02,8.838834765e-02,9.364419230e-02,9.921256575e-02,1.051120519e-01,1.113623398e-01,1.179842891e-01,1.250000000e-01,1.324328868e-01,1.403077560e-01,1.486508894e-01,1.574901312e-01,1.668549818e-01,1.767766953e-01,1.872883846e-01,1.984251315e-01,2.102241038e-01,2.227246795e-01,2.359685782e-01,2.500000000e-01,2.648657736e-01,2.806155121e-01,2.973017788e-01,3.149802625e-01,3.337099635e-01,3.535533906e-01,3.745767692e-01,3.968502630e-01,4.204482076e-01,4.454493591e-01,4.719371563e-01,5.000000000e-01,5.297315472e-01,5.612310242e-01,5.946035575e-01,6.299605249e-01,6.674199271e-01,7.071067812e-01,7.491535384e-01,7.937005260e-01,8.408964153e-01,8.908987181e-01,9.438743127e-01,1.000000000e+00,1.059463094e+00,1.122462048e+00,1.189207115e+00,1.259921050e+00,1.334839854e+00,1.414213562e+00,1.498307077e+00,1.587401052e+00,1.681792831e+00,1.781797436e+00,1.887748625e+00,2.000000000e+00,2.118926189e+00,2.244924097e+00,2.378414230e+00,2.519842100e+00,2.669679708e+00,2.828427125e+00,2.996614154e+00,3.174802104e+00,3.363585661e+00,3.563594873e+00,3.775497251e+00,4.000000000e+00,4.237852377e+00,4.489848193e+00,4.756828460e+00,5.039684200e+00,5.339359417e+00,5.656854249e+00,5.993228308e+00,6.349604208e+00,6.727171322e+00,7.127189745e+00,7.550994501e+00,8.000000000e+00,8.475704755e+00,8.979696386e+00,9.513656920e+00,1.007936840e+01,1.067871883e+01,1.131370850e+01,1.198645662e+01,1.269920842e+01,1.345434264e+01,1.425437949e+01,1.510198900e+01,1.600000000e+01,1.695140951e+01,1.795939277e+01,1.902731384e+01,2.015873680e+01,2.135743767e+01,2.262741700e+01,2.397291323e+01,2.539841683e+01,2.690868529e+01,2.850875898e+01,3.020397801e+01,3.200000000e+01,3.390281902e+01,3.591878555e+01,3.805462768e+01,4.031747360e+01,4.271487533e+01,4.525483400e+01,4.794582646e+01,5.079683366e+01,5.381737058e+01,5.701751796e+01,6.040795601e+01,6.400000000e+01,6.780563804e+01,7.183757109e+01,7.610925536e+01,8.063494719e+01,8.542975067e+01,9.050966799e+01,9.589165292e+01,1.015936673e+02,1.076347412e+02,1.140350359e+02,1.208159120e+02,1.280000000e+02,1.356112761e+02,1.436751422e+02,1.522185107e+02,1.612698944e+02,1.708595013e+02,1.810193360e+02,1.917833058e+02,2.031873347e+02,2.152694823e+02,2.280700718e+02,2.416318240e+02,2.560000000e+02,2.712225522e+02,2.873502844e+02,3.044370214e+02,3.225397888e+02,3.417190027e+02,3.620386720e+02,3.835666117e+02,4.063746693e+02,4.305389646e+02,4.561401437e+02,4.832636481e+02,5.120000000e+02,5.424451043e+02,5.747005687e+02,6.088740429e+02,6.450795775e+02,6.834380053e+02,7.240773439e+02,7.671332234e+02,8.127493386e+02,8.610779292e+02,9.122802874e+02,9.665272962e+02,1.024000000e+03,1.084890209e+03,1.149401137e+03,1.217748086e+03,1.290159155e+03,1.366876011e+03,1.448154688e+03,1.534266447e+03]);
const PL_PITCH_RATIO_LOW = Float32Array.from([1.000000000e+00,1.000225659e+00,1.000451370e+00,1.000677131e+00,1.000902943e+00,1.001128806e+00,1.001354720e+00,1.001580685e+00,1.001806701e+00,1.002032768e+00,1.002258886e+00,1.002485055e+00,1.002711275e+00,1.002937546e+00,1.003163868e+00,1.003390242e+00,1.003616666e+00,1.003843141e+00,1.004069668e+00,1.004296246e+00,1.004522874e+00,1.004749554e+00,1.004976285e+00,1.005203068e+00,1.005429901e+00,1.005656786e+00,1.005883722e+00,1.006110709e+00,1.006337747e+00,1.006564836e+00,1.006791977e+00,1.007019169e+00,1.007246412e+00,1.007473707e+00,1.007701053e+00,1.007928450e+00,1.008155898e+00,1.008383398e+00,1.008610949e+00,1.008838551e+00,1.009066205e+00,1.009293910e+00,1.009521667e+00,1.009749475e+00,1.009977334e+00,1.010205245e+00,1.010433207e+00,1.010661221e+00,1.010889286e+00,1.011117403e+00,1.011345571e+00,1.011573790e+00,1.011802061e+00,1.012030384e+00,1.012258758e+00,1.012487183e+00,1.012715661e+00,1.012944189e+00,1.013172770e+00,1.013401401e+00,1.013630085e+00,1.013858820e+00,1.014087607e+00,1.014316445e+00,1.014545335e+00,1.014774277e+00,1.015003270e+00,1.015232315e+00,1.015461411e+00,1.015690560e+00,1.015919760e+00,1.016149011e+00,1.016378315e+00,1.016607670e+00,1.016837077e+00,1.017066536e+00,1.017296046e+00,1.017525609e+00,1.017755223e+00,1.017984889e+00,1.018214607e+00,1.018444376e+00,1.018674198e+00,1.018904071e+00,1.019133996e+00,1.019363973e+00,1.019594002e+00,1.019824083e+00,1.020054216e+00,1.020284401e+00,1.020514637e+00,1.020744926e+00,1.020975266e+00,1.021205659e+00,1.021436104e+00,1.021666600e+00,1.021897149e+00,1.022127749e+00,1.022358402e+00,1.022589107e+00,1.022819863e+00,1.023050672e+00,1.023281533e+00,1.023512446e+00,1.023743411e+00,1.023974428e+00,1.024205498e+00,1.024436619e+00,1.024667793e+00,1.024899019e+00,1.025130297e+00,1.025361627e+00,1.025593009e+00,1.025824444e+00,1.026055931e+00,1.026287470e+00,1.026519061e+00,1.026750705e+00,1.026982401e+00,1.027214149e+00,1.027445949e+00,1.027677802e+00,1.027909707e+00,1.028141664e+00,1.028373674e+00,1.028605736e+00,1.028837851e+00,1.029070017e+00,1.029302237e+00,1.029534508e+00,1.029766832e+00,1.029999209e+00,1.030231638e+00,1.030464119e+00,1.030696653e+00,1.030929239e+00,1.031161878e+00,1.031394569e+00,1.031627313e+00,1.031860109e+00,1.032092958e+00,1.032325859e+00,1.032558813e+00,1.032791820e+00,1.033024879e+00,1.033257991e+00,1.033491155e+00,1.033724372e+00,1.033957641e+00,1.034190964e+00,1.034424338e+00,1.034657766e+00,1.034891246e+00,1.035124779e+00,1.035358364e+00,1.035592003e+00,1.035825694e+00,1.036059437e+00,1.036293234e+00,1.036527083e+00,1.036760985e+00,1.036994940e+00,1.037228947e+00,1.037463008e+00,1.037697121e+00,1.037931287e+00,1.038165506e+00,1.038399777e+00,1.038634102e+00,1.038868479e+00,1.039102910e+00,1.039337393e+00,1.039571929e+00,1.039806518e+00,1.040041160e+00,1.040275855e+00,1.040510603e+00,1.040745404e+00,1.040980258e+00,1.041215165e+00,1.041450125e+00,1.041685138e+00,1.041920204e+00,1.042155323e+00,1.042390495e+00,1.042625720e+00,1.042860998e+00,1.043096329e+00,1.043331714e+00,1.043567151e+00,1.043802642e+00,1.044038185e+00,1.044273782e+00,1.044509433e+00,1.044745136e+00,1.044980892e+00,1.045216702e+00,1.045452565e+00,1.045688481e+00,1.045924450e+00,1.046160473e+00,1.046396549e+00,1.046632678e+00,1.046868860e+00,1.047105096e+00,1.047341385e+00,1.047577727e+00,1.047814123e+00,1.048050572e+00,1.048287074e+00,1.048523630e+00,1.048760239e+00,1.048996902e+00,1.049233618e+00,1.049470387e+00,1.049707210e+00,1.049944086e+00,1.050181015e+00,1.050417999e+00,1.050655035e+00,1.050892125e+00,1.051129269e+00,1.051366466e+00,1.051603717e+00,1.051841021e+00,1.052078378e+00,1.052315790e+00,1.052553255e+00,1.052790773e+00,1.053028345e+00,1.053265971e+00,1.053503650e+00,1.053741383e+00,1.053979169e+00,1.054217010e+00,1.054454903e+00,1.054692851e+00,1.054930852e+00,1.055168907e+00,1.055407016e+00,1.055645178e+00,1.055883395e+00,1.056121664e+00,1.056359988e+00,1.056598366e+00,1.056836797e+00,1.057075282e+00,1.057313821e+00,1.057552413e+00,1.057791060e+00,1.058029760e+00,1.058268515e+00,1.058507323e+00,1.058746185e+00,1.058985101e+00,1.059224071e+00]);
const PL_SINE = Float32Array.from([0.000000000e+00,1.227153829e-02,2.454122852e-02,3.680722294e-02,4.906767433e-02,6.132073630e-02,7.356456360e-02,8.579731234e-02,9.801714033e-02,1.102222073e-01,1.224106752e-01,1.345807085e-01,1.467304745e-01,1.588581433e-01,1.709618888e-01,1.830398880e-01,1.950903220e-01,2.071113762e-01,2.191012402e-01,2.310581083e-01,2.429801799e-01,2.548656596e-01,2.667127575e-01,2.785196894e-01,2.902846773e-01,3.020059493e-01,3.136817404e-01,3.253102922e-01,3.368898534e-01,3.484186802e-01,3.598950365e-01,3.713171940e-01,3.826834324e-01,3.939920401e-01,4.052413140e-01,4.164295601e-01,4.275550934e-01,4.386162385e-01,4.496113297e-01,4.605387110e-01,4.713967368e-01,4.821837721e-01,4.928981922e-01,5.035383837e-01,5.141027442e-01,5.245896827e-01,5.349976199e-01,5.453249884e-01,5.555702330e-01,5.657318108e-01,5.758081914e-01,5.857978575e-01,5.956993045e-01,6.055110414e-01,6.152315906e-01,6.248594881e-01,6.343932842e-01,6.438315429e-01,6.531728430e-01,6.624157776e-01,6.715589548e-01,6.806009978e-01,6.895405447e-01,6.983762494e-01,7.071067812e-01,7.157308253e-01,7.242470830e-01,7.326542717e-01,7.409511254e-01,7.491363945e-01,7.572088465e-01,7.651672656e-01,7.730104534e-01,7.807372286e-01,7.883464276e-01,7.958369046e-01,8.032075315e-01,8.104571983e-01,8.175848132e-01,8.245893028e-01,8.314696123e-01,8.382247056e-01,8.448535652e-01,8.513551931e-01,8.577286100e-01,8.639728561e-01,8.700869911e-01,8.760700942e-01,8.819212643e-01,8.876396204e-01,8.932243012e-01,8.986744657e-01,9.039892931e-01,9.091679831e-01,9.142097557e-01,9.191138517e-01,9.238795325e-01,9.285060805e-01,9.329927988e-01,9.373390119e-01,9.415440652e-01,9.456073254e-01,9.495281806e-01,9.533060404e-01,9.569403357e-01,9.604305194e-01,9.637760658e-01,9.669764710e-01,9.700312532e-01,9.729399522e-01,9.757021300e-01,9.783173707e-01,9.807852804e-01,9.831054874e-01,9.852776424e-01,9.873014182e-01,9.891765100e-01,9.909026354e-01,9.924795346e-01,9.939069700e-01,9.951847267e-01,9.963126122e-01,9.972904567e-01,9.981181129e-01,9.987954562e-01,9.993223846e-01,9.996988187e-01,9.999247018e-01,1.000000000e+00,9.999247018e-01,9.996988187e-01,9.993223846e-01,9.987954562e-01,9.981181129e-01,9.972904567e-01,9.963126122e-01,9.951847267e-01,9.939069700e-01,9.924795346e-01,9.909026354e-01,9.891765100e-01,9.873014182e-01,9.852776424e-01,9.831054874e-01,9.807852804e-01,9.783173707e-01,9.757021300e-01,9.729399522e-01,9.700312532e-01,9.669764710e-01,9.637760658e-01,9.604305194e-01,9.569403357e-01,9.533060404e-01,9.495281806e-01,9.456073254e-01,9.415440652e-01,9.373390119e-01,9.329927988e-01,9.285060805e-01,9.238795325e-01,9.191138517e-01,9.142097557e-01,9.091679831e-01,9.039892931e-01,8.986744657e-01,8.932243012e-01,8.876396204e-01,8.819212643e-01,8.760700942e-01,8.700869911e-01,8.639728561e-01,8.577286100e-01,8.513551931e-01,8.448535652e-01,8.382247056e-01,8.314696123e-01,8.245893028e-01,8.175848132e-01,8.104571983e-01,8.032075315e-01,7.958369046e-01,7.883464276e-01,7.807372286e-01,7.730104534e-01,7.651672656e-01,7.572088465e-01,7.491363945e-01,7.409511254e-01,7.326542717e-01,7.242470830e-01,7.157308253e-01,7.071067812e-01,6.983762494e-01,6.895405447e-01,6.806009978e-01,6.715589548e-01,6.624157776e-01,6.531728430e-01,6.438315429e-01,6.343932842e-01,6.248594881e-01,6.152315906e-01,6.055110414e-01,5.956993045e-01,5.857978575e-01,5.758081914e-01,5.657318108e-01,5.555702330e-01,5.453249884e-01,5.349976199e-01,5.245896827e-01,5.141027442e-01,5.035383837e-01,4.928981922e-01,4.821837721e-01,4.713967368e-01,4.605387110e-01,4.496113297e-01,4.386162385e-01,4.275550934e-01,4.164295601e-01,4.052413140e-01,3.939920401e-01,3.826834324e-01,3.713171940e-01,3.598950365e-01,3.484186802e-01,3.368898534e-01,3.253102922e-01,3.136817404e-01,3.020059493e-01,2.902846773e-01,2.785196894e-01,2.667127575e-01,2.548656596e-01,2.429801799e-01,2.310581083e-01,2.191012402e-01,2.071113762e-01,1.950903220e-01,1.830398880e-01,1.709618888e-01,1.588581433e-01,1.467304745e-01,1.345807085e-01,1.224106752e-01,1.102222073e-01,9.801714033e-02,8.579731234e-02,7.356456360e-02,6.132073630e-02,4.906767433e-02,3.680722294e-02,2.454122852e-02,1.227153829e-02,1.224646799e-16,-1.227153829e-02,-2.454122852e-02,-3.680722294e-02,-4.906767433e-02,-6.132073630e-02,-7.356456360e-02,-8.579731234e-02,-9.801714033e-02,-1.102222073e-01,-1.224106752e-01,-1.345807085e-01,-1.467304745e-01,-1.588581433e-01,-1.709618888e-01,-1.830398880e-01,-1.950903220e-01,-2.071113762e-01,-2.191012402e-01,-2.310581083e-01,-2.429801799e-01,-2.548656596e-01,-2.667127575e-01,-2.785196894e-01,-2.902846773e-01,-3.020059493e-01,-3.136817404e-01,-3.253102922e-01,-3.368898534e-01,-3.484186802e-01,-3.598950365e-01,-3.713171940e-01,-3.826834324e-01,-3.939920401e-01,-4.052413140e-01,-4.164295601e-01,-4.275550934e-01,-4.386162385e-01,-4.496113297e-01,-4.605387110e-01,-4.713967368e-01,-4.821837721e-01,-4.928981922e-01,-5.035383837e-01,-5.141027442e-01,-5.245896827e-01,-5.349976199e-01,-5.453249884e-01,-5.555702330e-01,-5.657318108e-01,-5.758081914e-01,-5.857978575e-01,-5.956993045e-01,-6.055110414e-01,-6.152315906e-01,-6.248594881e-01,-6.343932842e-01,-6.438315429e-01,-6.531728430e-01,-6.624157776e-01,-6.715589548e-01,-6.806009978e-01,-6.895405447e-01,-6.983762494e-01,-7.071067812e-01,-7.157308253e-01,-7.242470830e-01,-7.326542717e-01,-7.409511254e-01,-7.491363945e-01,-7.572088465e-01,-7.651672656e-01,-7.730104534e-01,-7.807372286e-01,-7.883464276e-01,-7.958369046e-01,-8.032075315e-01,-8.104571983e-01,-8.175848132e-01,-8.245893028e-01,-8.314696123e-01,-8.382247056e-01,-8.448535652e-01,-8.513551931e-01,-8.577286100e-01,-8.639728561e-01,-8.700869911e-01,-8.760700942e-01,-8.819212643e-01,-8.876396204e-01,-8.932243012e-01,-8.986744657e-01,-9.039892931e-01,-9.091679831e-01,-9.142097557e-01,-9.191138517e-01,-9.238795325e-01,-9.285060805e-01,-9.329927988e-01,-9.373390119e-01,-9.415440652e-01,-9.456073254e-01,-9.495281806e-01,-9.533060404e-01,-9.569403357e-01,-9.604305194e-01,-9.637760658e-01,-9.669764710e-01,-9.700312532e-01,-9.729399522e-01,-9.757021300e-01,-9.783173707e-01,-9.807852804e-01,-9.831054874e-01,-9.852776424e-01,-9.873014182e-01,-9.891765100e-01,-9.909026354e-01,-9.924795346e-01,-9.939069700e-01,-9.951847267e-01,-9.963126122e-01,-9.972904567e-01,-9.981181129e-01,-9.987954562e-01,-9.993223846e-01,-9.996988187e-01,-9.999247018e-01,-1.000000000e+00,-9.999247018e-01,-9.996988187e-01,-9.993223846e-01,-9.987954562e-01,-9.981181129e-01,-9.972904567e-01,-9.963126122e-01,-9.951847267e-01,-9.939069700e-01,-9.924795346e-01,-9.909026354e-01,-9.891765100e-01,-9.873014182e-01,-9.852776424e-01,-9.831054874e-01,-9.807852804e-01,-9.783173707e-01,-9.757021300e-01,-9.729399522e-01,-9.700312532e-01,-9.669764710e-01,-9.637760658e-01,-9.604305194e-01,-9.569403357e-01,-9.533060404e-01,-9.495281806e-01,-9.456073254e-01,-9.415440652e-01,-9.373390119e-01,-9.329927988e-01,-9.285060805e-01,-9.238795325e-01,-9.191138517e-01,-9.142097557e-01,-9.091679831e-01,-9.039892931e-01,-8.986744657e-01,-8.932243012e-01,-8.876396204e-01,-8.819212643e-01,-8.760700942e-01,-8.700869911e-01,-8.639728561e-01,-8.577286100e-01,-8.513551931e-01,-8.448535652e-01,-8.382247056e-01,-8.314696123e-01,-8.245893028e-01,-8.175848132e-01,-8.104571983e-01,-8.032075315e-01,-7.958369046e-01,-7.883464276e-01,-7.807372286e-01,-7.730104534e-01,-7.651672656e-01,-7.572088465e-01,-7.491363945e-01,-7.409511254e-01,-7.326542717e-01,-7.242470830e-01,-7.157308253e-01,-7.071067812e-01,-6.983762494e-01,-6.895405447e-01,-6.806009978e-01,-6.715589548e-01,-6.624157776e-01,-6.531728430e-01,-6.438315429e-01,-6.343932842e-01,-6.248594881e-01,-6.152315906e-01,-6.055110414e-01,-5.956993045e-01,-5.857978575e-01,-5.758081914e-01,-5.657318108e-01,-5.555702330e-01,-5.453249884e-01,-5.349976199e-01,-5.245896827e-01,-5.141027442e-01,-5.035383837e-01,-4.928981922e-01,-4.821837721e-01,-4.713967368e-01,-4.605387110e-01,-4.496113297e-01,-4.386162385e-01,-4.275550934e-01,-4.164295601e-01,-4.052413140e-01,-3.939920401e-01,-3.826834324e-01,-3.713171940e-01,-3.598950365e-01,-3.484186802e-01,-3.368898534e-01,-3.253102922e-01,-3.136817404e-01,-3.020059493e-01,-2.902846773e-01,-2.785196894e-01,-2.667127575e-01,-2.548656596e-01,-2.429801799e-01,-2.310581083e-01,-2.191012402e-01,-2.071113762e-01,-1.950903220e-01,-1.830398880e-01,-1.709618888e-01,-1.588581433e-01,-1.467304745e-01,-1.345807085e-01,-1.224106752e-01,-1.102222073e-01,-9.801714033e-02,-8.579731234e-02,-7.356456360e-02,-6.132073630e-02,-4.906767433e-02,-3.680722294e-02,-2.454122852e-02,-1.227153829e-02,-2.449293598e-16,1.227153829e-02,2.454122852e-02,3.680722294e-02,4.906767433e-02,6.132073630e-02,7.356456360e-02,8.579731234e-02,9.801714033e-02,1.102222073e-01,1.224106752e-01,1.345807085e-01,1.467304745e-01,1.588581433e-01,1.709618888e-01,1.830398880e-01,1.950903220e-01,2.071113762e-01,2.191012402e-01,2.310581083e-01,2.429801799e-01,2.548656596e-01,2.667127575e-01,2.785196894e-01,2.902846773e-01,3.020059493e-01,3.136817404e-01,3.253102922e-01,3.368898534e-01,3.484186802e-01,3.598950365e-01,3.713171940e-01,3.826834324e-01,3.939920401e-01,4.052413140e-01,4.164295601e-01,4.275550934e-01,4.386162385e-01,4.496113297e-01,4.605387110e-01,4.713967368e-01,4.821837721e-01,4.928981922e-01,5.035383837e-01,5.141027442e-01,5.245896827e-01,5.349976199e-01,5.453249884e-01,5.555702330e-01,5.657318108e-01,5.758081914e-01,5.857978575e-01,5.956993045e-01,6.055110414e-01,6.152315906e-01,6.248594881e-01,6.343932842e-01,6.438315429e-01,6.531728430e-01,6.624157776e-01,6.715589548e-01,6.806009978e-01,6.895405447e-01,6.983762494e-01,7.071067812e-01,7.157308253e-01,7.242470830e-01,7.326542717e-01,7.409511254e-01,7.491363945e-01,7.572088465e-01,7.651672656e-01,7.730104534e-01,7.807372286e-01,7.883464276e-01,7.958369046e-01,8.032075315e-01,8.104571983e-01,8.175848132e-01,8.245893028e-01,8.314696123e-01,8.382247056e-01,8.448535652e-01,8.513551931e-01,8.577286100e-01,8.639728561e-01,8.700869911e-01,8.760700942e-01,8.819212643e-01,8.876396204e-01,8.932243012e-01,8.986744657e-01,9.039892931e-01,9.091679831e-01,9.142097557e-01,9.191138517e-01,9.238795325e-01,9.285060805e-01,9.329927988e-01,9.373390119e-01,9.415440652e-01,9.456073254e-01,9.495281806e-01,9.533060404e-01,9.569403357e-01,9.604305194e-01,9.637760658e-01,9.669764710e-01,9.700312532e-01,9.729399522e-01,9.757021300e-01,9.783173707e-01,9.807852804e-01,9.831054874e-01,9.852776424e-01,9.873014182e-01,9.891765100e-01,9.909026354e-01,9.924795346e-01,9.939069700e-01,9.951847267e-01,9.963126122e-01,9.972904567e-01,9.981181129e-01,9.987954562e-01,9.993223846e-01,9.996988187e-01,9.999247018e-01,1.000000000e+00]);
const PL_FM_FREQUENCY_QUANTIZER = Float32Array.from([-1.200000000e+01,-1.200000000e+01,-1.200000000e+01,-1.184000000e+01,-1.184000000e+01,-1.184000000e+01,-1.111000000e+01,-1.038000000e+01,-9.650000000e+00,-8.920000000e+00,-8.190000000e+00,-7.460000000e+00,-6.730000000e+00,-6.000000000e+00,-6.000000000e+00,-6.000000000e+00,-5.545511612e+00,-5.091023223e+00,-4.636534835e+00,-4.182046446e+00,-4.182046446e+00,-4.182046446e+00,-3.659290641e+00,-3.136534835e+00,-2.613779029e+00,-2.091023223e+00,-1.568267417e+00,-1.045511612e+00,-5.227558058e-01,0.000000000e+00,0.000000000e+00,0.000000000e+00,1.600000000e-01,1.600000000e-01,1.600000000e-01,8.900000000e-01,1.620000000e+00,2.350000000e+00,3.080000000e+00,3.810000000e+00,4.540000000e+00,5.270000000e+00,6.000000000e+00,6.000000000e+00,6.000000000e+00,6.454488388e+00,6.908976777e+00,7.363465165e+00,7.817953554e+00,7.817953554e+00,7.817953554e+00,8.285529931e+00,8.753106309e+00,9.220682687e+00,9.688259065e+00,9.688259065e+00,9.688259065e+00,1.026619430e+01,1.084412953e+01,1.142206477e+01,1.200000000e+01,1.200000000e+01,1.200000000e+01,1.216000000e+01,1.216000000e+01,1.216000000e+01,1.262977500e+01,1.309955001e+01,1.356932501e+01,1.403910002e+01,1.403910002e+01,1.403910002e+01,1.490761987e+01,1.577613972e+01,1.664465957e+01,1.751317942e+01,1.751317942e+01,1.751317942e+01,1.800000000e+01,1.800000000e+01,1.800000000e+01,1.850977500e+01,1.901955001e+01,1.901955001e+01,1.901955001e+01,1.981795355e+01,1.981795355e+01,1.981795355e+01,2.066386428e+01,2.150977500e+01,2.150977500e+01,2.150977500e+01,2.213233125e+01,2.275488750e+01,2.337744375e+01,2.400000000e+01,2.400000000e+01,2.400000000e+01,2.450977500e+01,2.501955001e+01,2.501955001e+01,2.501955001e+01,2.547403840e+01,2.592852679e+01,2.638301517e+01,2.683750356e+01,2.683750356e+01,2.683750356e+01,2.735032035e+01,2.786313714e+01,2.786313714e+01,2.786313714e+01,2.839735285e+01,2.893156857e+01,2.946578428e+01,3.000000000e+01,3.000000000e+01,3.000000000e+01,3.075000000e+01,3.150000000e+01,3.225000000e+01,3.300000000e+01,3.375000000e+01,3.450000000e+01,3.525000000e+01,3.600000000e+01,3.600000000e+01,3.600000000e+01,3.600000000e+01,3.600000000e+01]);
const PL_FOLD = Float32Array.from([-9.980545825e-01,-9.970653772e-01,-9.960649692e-01,-9.950532582e-01,-9.940301939e-01,-9.929957802e-01,-9.919500809e-01,-9.908932239e-01,-9.898254054e-01,-9.887468930e-01,-9.876580288e-01,-9.865592310e-01,-9.854509946e-01,-9.843338912e-01,-9.832085672e-01,-9.820757409e-01,-9.809361977e-01,-9.797907840e-01,-9.786403995e-01,-9.774859869e-01,-9.763285207e-01,-9.751689938e-01,-9.740084017e-01,-9.728477255e-01,-9.716879129e-01,-9.705298570e-01,-9.693743743e-01,-9.682221804e-01,-9.670738649e-01,-9.659298654e-01,-9.647904408e-01,-9.636556431e-01,-9.625252914e-01,-9.613989436e-01,-9.602758714e-01,-9.591550347e-01,-9.580350590e-01,-9.569142144e-01,-9.557903981e-01,-9.546611197e-01,-9.535234911e-01,-9.523742208e-01,-9.512096130e-01,-9.500255727e-01,-9.488176173e-01,-9.475808937e-01,-9.463102039e-01,-9.450000364e-01,-9.436446065e-01,-9.422379038e-01,-9.407737471e-01,-9.392458479e-01,-9.376478811e-01,-9.359735625e-01,-9.342167345e-01,-9.323714562e-01,-9.304321011e-01,-9.283934575e-01,-9.262508342e-01,-9.240001674e-01,-9.216381294e-01,-9.191622368e-01,-9.165709565e-01,-9.138638086e-01,-9.110414630e-01,-9.081058297e-01,-9.050601387e-01,-9.019090092e-01,-8.986585056e-01,-8.953161780e-01,-8.918910851e-01,-8.883937990e-01,-8.848363883e-01,-8.812323792e-01,-8.775966932e-01,-8.739455595e-01,-8.702964016e-01,-8.666676980e-01,-8.630788161e-01,-8.595498195e-01,-8.561012493e-01,-8.527538811e-01,-8.495284571e-01,-8.464453973e-01,-8.435244910e-01,-8.407845708e-01,-8.382431741e-01,-8.359161932e-01,-8.338175206e-01,-8.319586927e-01,-8.303485360e-01,-8.289928229e-01,-8.278939413e-01,-8.270505833e-01,-8.264574602e-01,-8.261050485e-01,-8.259793727e-01,-8.260618323e-01,-8.263290765e-01,-8.267529332e-01,-8.273003972e-01,-8.279336816e-01,-8.286103366e-01,-8.292834393e-01,-8.299018559e-01,-8.304105799e-01,-8.307511441e-01,-8.308621097e-01,-8.306796276e-01,-8.301380721e-01,-8.291707415e-01,-8.277106225e-01,-8.256912103e-01,-8.230473793e-01,-8.197162939e-01,-8.156383519e-01,-8.107581485e-01,-8.050254496e-01,-7.983961624e-01,-7.908332902e-01,-7.823078566e-01,-7.727997861e-01,-7.622987256e-01,-7.508047928e-01,-7.383292372e-01,-7.248949979e-01,-7.105371474e-01,-6.953032052e-01,-6.792533125e-01,-6.624602549e-01,-6.450093250e-01,-6.269980173e-01,-6.085355495e-01,-5.897422068e-01,-5.707485064e-01,-5.516941858e-01,-5.327270153e-01,-5.140014423e-01,-4.956770752e-01,-4.779170191e-01,-4.608860753e-01,-4.447488219e-01,-4.296675951e-01,-4.158003906e-01,-4.032987090e-01,-3.923053718e-01,-3.829523325e-01,-3.753585132e-01,-3.696276948e-01,-3.658464920e-01,-3.640824427e-01,-3.643822430e-01,-3.667701571e-01,-3.712466318e-01,-3.777871433e-01,-3.863413015e-01,-3.968322361e-01,-4.091562858e-01,-4.231830080e-01,-4.387555229e-01,-4.556912047e-01,-4.737827239e-01,-4.927994449e-01,-5.124891750e-01,-5.325802587e-01,-5.527840042e-01,-5.727974254e-01,-5.923062779e-01,-6.109883621e-01,-6.285170609e-01,-6.445650789e-01,-6.588083399e-01,-6.709300033e-01,-6.806245487e-01,-6.876018827e-01,-6.915914142e-01,-6.923460464e-01,-6.896460314e-01,-6.833026329e-01,-6.731615438e-01,-6.591060076e-01,-6.410595911e-01,-6.189885640e-01,-5.929038395e-01,-5.628624373e-01,-5.289684349e-01,-4.913733765e-01,-4.502761195e-01,-4.059220990e-01,-3.586020036e-01,-3.086498600e-01,-2.564405314e-01,-2.023866445e-01,-1.469349657e-01,-9.056225673e-02,-3.377064458e-02,2.291744737e-02,7.896475831e-02,1.338249802e-01,1.869488164e-01,2.377902398e-01,2.858128778e-01,3.304964479e-01,3.713431643e-01,4.078840357e-01,4.396849726e-01,4.663526243e-01,4.875398649e-01,5.029508548e-01,5.123456023e-01,5.155439593e-01,5.124289894e-01,5.029496521e-01,4.871227568e-01,4.650341465e-01,4.368390827e-01,4.027618100e-01,3.630942908e-01,3.181941105e-01,2.684815644e-01,2.144359470e-01,1.565910778e-01,9.553010345e-02,3.187963220e-02,-3.369674102e-02,-1.005054456e-01,-1.678304053e-01,-2.349408810e-01,-3.010995956e-01,-3.655710438e-01,-4.276298873e-01,-4.865693337e-01,-5.417093944e-01,-5.924049204e-01,-6.380533123e-01,-6.781018093e-01,-7.120542597e-01,-7.394772881e-01,-7.600057749e-01,-7.733475770e-01,-7.792874237e-01,-7.776899338e-01,-7.685017108e-01,-7.517524823e-01,-7.275552655e-01,-6.961055475e-01,-6.576794884e-01,-6.126311602e-01,-5.613888527e-01,-5.044504876e-01,-4.423781911e-01,-3.757920909e-01,-3.053634092e-01,-2.318069348e-01,-1.558729654e-01,-7.833881626e-02,0.000000000e+00,7.833881626e-02,1.558729654e-01,2.318069348e-01,3.053634092e-01,3.757920909e-01,4.423781911e-01,5.044504876e-01,5.613888527e-01,6.126311602e-01,6.576794884e-01,6.961055475e-01,7.275552655e-01,7.517524823e-01,7.685017108e-01,7.776899338e-01,7.792874237e-01,7.733475770e-01,7.600057749e-01,7.394772881e-01,7.120542597e-01,6.781018093e-01,6.380533123e-01,5.924049204e-01,5.417093944e-01,4.865693337e-01,4.276298873e-01,3.655710438e-01,3.010995956e-01,2.349408810e-01,1.678304053e-01,1.005054456e-01,3.369674102e-02,-3.187963220e-02,-9.553010345e-02,-1.565910778e-01,-2.144359470e-01,-2.684815644e-01,-3.181941105e-01,-3.630942908e-01,-4.027618100e-01,-4.368390827e-01,-4.650341465e-01,-4.871227568e-01,-5.029496521e-01,-5.124289894e-01,-5.155439593e-01,-5.123456023e-01,-5.029508548e-01,-4.875398649e-01,-4.663526243e-01,-4.396849726e-01,-4.078840357e-01,-3.713431643e-01,-3.304964479e-01,-2.858128778e-01,-2.377902398e-01,-1.869488164e-01,-1.338249802e-01,-7.896475831e-02,-2.291744737e-02,3.377064458e-02,9.056225673e-02,1.469349657e-01,2.023866445e-01,2.564405314e-01,3.086498600e-01,3.586020036e-01,4.059220990e-01,4.502761195e-01,4.913733765e-01,5.289684349e-01,5.628624373e-01,5.929038395e-01,6.189885640e-01,6.410595911e-01,6.591060076e-01,6.731615438e-01,6.833026329e-01,6.896460314e-01,6.923460464e-01,6.915914142e-01,6.876018827e-01,6.806245487e-01,6.709300033e-01,6.588083399e-01,6.445650789e-01,6.285170609e-01,6.109883621e-01,5.923062779e-01,5.727974254e-01,5.527840042e-01,5.325802587e-01,5.124891750e-01,4.927994449e-01,4.737827239e-01,4.556912047e-01,4.387555229e-01,4.231830080e-01,4.091562858e-01,3.968322361e-01,3.863413015e-01,3.777871433e-01,3.712466318e-01,3.667701571e-01,3.643822430e-01,3.640824427e-01,3.658464920e-01,3.696276948e-01,3.753585132e-01,3.829523325e-01,3.923053718e-01,4.032987090e-01,4.158003906e-01,4.296675951e-01,4.447488219e-01,4.608860753e-01,4.779170191e-01,4.956770752e-01,5.140014423e-01,5.327270153e-01,5.516941858e-01,5.707485064e-01,5.897422068e-01,6.085355495e-01,6.269980173e-01,6.450093250e-01,6.624602549e-01,6.792533125e-01,6.953032052e-01,7.105371474e-01,7.248949979e-01,7.383292372e-01,7.508047928e-01,7.622987256e-01,7.727997861e-01,7.823078566e-01,7.908332902e-01,7.983961624e-01,8.050254496e-01,8.107581485e-01,8.156383519e-01,8.197162939e-01,8.230473793e-01,8.256912103e-01,8.277106225e-01,8.291707415e-01,8.301380721e-01,8.306796276e-01,8.308621097e-01,8.307511441e-01,8.304105799e-01,8.299018559e-01,8.292834393e-01,8.286103366e-01,8.279336816e-01,8.273003972e-01,8.267529332e-01,8.263290765e-01,8.260618323e-01,8.259793727e-01,8.261050485e-01,8.264574602e-01,8.270505833e-01,8.278939413e-01,8.289928229e-01,8.303485360e-01,8.319586927e-01,8.338175206e-01,8.359161932e-01,8.382431741e-01,8.407845708e-01,8.435244910e-01,8.464453973e-01,8.495284571e-01,8.527538811e-01,8.561012493e-01,8.595498195e-01,8.630788161e-01,8.666676980e-01,8.702964016e-01,8.739455595e-01,8.775966932e-01,8.812323792e-01,8.848363883e-01,8.883937990e-01,8.918910851e-01,8.953161780e-01,8.986585056e-01,9.019090092e-01,9.050601387e-01,9.081058297e-01,9.110414630e-01,9.138638086e-01,9.165709565e-01,9.191622368e-01,9.216381294e-01,9.240001674e-01,9.262508342e-01,9.283934575e-01,9.304321011e-01,9.323714562e-01,9.342167345e-01,9.359735625e-01,9.376478811e-01,9.392458479e-01,9.407737471e-01,9.422379038e-01,9.436446065e-01,9.450000364e-01,9.463102039e-01,9.475808937e-01,9.488176173e-01,9.500255727e-01,9.512096130e-01,9.523742208e-01,9.535234911e-01,9.546611197e-01,9.557903981e-01,9.569142144e-01,9.580350590e-01,9.591550347e-01,9.602758714e-01,9.613989436e-01,9.625252914e-01,9.636556431e-01,9.647904408e-01,9.659298654e-01,9.670738649e-01,9.682221804e-01,9.693743743e-01,9.705298570e-01,9.716879129e-01,9.728477255e-01,9.740084017e-01,9.751689938e-01,9.763285207e-01,9.774859869e-01,9.786403995e-01,9.797907840e-01,9.809361977e-01,9.820757409e-01,9.832085672e-01,9.843338912e-01,9.854509946e-01,9.865592310e-01,9.876580288e-01,9.887468930e-01,9.898254054e-01,9.908932239e-01,9.919500809e-01,9.929957802e-01,9.940301939e-01,9.950532582e-01,9.960649692e-01,9.970653772e-01,9.980545825e-01,9.990327291e-01,1.000000000e+00,1.000000000e+00]);
const PL_FOLD_2 = Float32Array.from([1.000000000e+00,9.992967758e-01,9.985815484e-01,9.978540078e-01,9.971138332e-01,9.963606927e-01,9.955942426e-01,9.948141269e-01,9.940199768e-01,9.932114103e-01,9.923880310e-01,9.915494283e-01,9.906951760e-01,9.898248319e-01,9.889379369e-01,9.880340145e-01,9.871125695e-01,9.861730874e-01,9.852150334e-01,9.842378513e-01,9.832409624e-01,9.822237646e-01,9.811856308e-01,9.801259079e-01,9.790439155e-01,9.779389442e-01,9.768102539e-01,9.756570727e-01,9.744785949e-01,9.732739786e-01,9.720423447e-01,9.707827737e-01,9.694943044e-01,9.681759305e-01,9.668265989e-01,9.654452060e-01,9.640305956e-01,9.625815548e-01,9.610968112e-01,9.595750288e-01,9.580148040e-01,9.564146617e-01,9.547730501e-01,9.530883359e-01,9.513587989e-01,9.495826263e-01,9.477579060e-01,9.458826201e-01,9.439546371e-01,9.419717041e-01,9.399314380e-01,9.378313157e-01,9.356686640e-01,9.334406481e-01,9.311442591e-01,9.287763006e-01,9.263333739e-01,9.238118615e-01,9.212079094e-01,9.185174075e-01,9.157359677e-01,9.128589003e-01,9.098811874e-01,9.067974538e-01,9.036019347e-01,9.002884395e-01,8.968503119e-01,8.932803854e-01,8.895709331e-01,8.857136124e-01,8.816994016e-01,8.775185304e-01,8.731603996e-01,8.686134921e-01,8.638652705e-01,8.589020627e-01,8.537089293e-01,8.482695142e-01,8.425658723e-01,8.365782715e-01,8.302849649e-01,8.236619269e-01,8.166825462e-01,8.093172692e-01,8.015331811e-01,7.932935143e-01,7.845570677e-01,7.752775176e-01,7.654025961e-01,7.548731062e-01,7.436217337e-01,7.315716072e-01,7.186345391e-01,7.047088637e-01,6.896767601e-01,6.734009108e-01,6.557202943e-01,6.364448402e-01,6.153485688e-01,5.921606903e-01,5.665539193e-01,5.381289295e-01,5.063933787e-01,4.707331500e-01,4.303722225e-01,3.843155503e-01,3.312659247e-01,2.694998552e-01,1.966767932e-01,1.095358294e-01,3.393987745e-03,-1.040028802e-01,-1.920923242e-01,-2.656393469e-01,-3.279705091e-01,-3.814696578e-01,-4.278897766e-01,-4.685487258e-01,-5.044563616e-01,-5.363995499e-01,-5.650004958e-01,-5.676277376e-01,-5.456089430e-01,-5.216251172e-01,-4.954009254e-01,-4.666070735e-01,-4.348464092e-01,-3.996354923e-01,-3.603798149e-01,-3.163399611e-01,-2.665845916e-01,-2.099238522e-01,-1.448129904e-01,-6.920937281e-02,1.895794740e-02,1.019348852e-01,1.729075540e-01,2.343052184e-01,2.879430943e-01,3.352048344e-01,3.771635871e-01,4.146644691e-01,4.483820782e-01,4.788614349e-01,5.065476686e-01,5.318078998e-01,5.549476117e-01,5.762230650e-01,5.958508275e-01,6.140151734e-01,6.308738858e-01,6.465628523e-01,6.611997355e-01,6.748869294e-01,6.877139581e-01,6.925931401e-01,6.755415987e-01,6.569329565e-01,6.365437238e-01,6.141054921e-01,5.892930521e-01,5.617085284e-01,5.308598832e-01,4.961313087e-01,4.567416977e-01,4.116851906e-01,3.596440735e-01,2.988577649e-01,2.269196964e-01,1.404511108e-01,3.455499060e-02,-8.308691439e-02,-1.798594632e-01,-2.595549970e-01,-3.263272740e-01,-3.830839556e-01,-4.319212812e-01,-4.743886570e-01,-5.116560503e-01,-5.446234410e-01,-5.739944533e-01,-6.003271365e-01,-6.109475507e-01,-5.895686806e-01,-5.661619434e-01,-5.404244477e-01,-5.119898195e-01,-4.804106515e-01,-4.451347882e-01,-4.054727657e-01,-3.605522997e-01,-3.092533873e-01,-2.501136501e-01,-1.811866822e-01,-9.982372580e-02,-2.325458569e-03,9.596728942e-02,1.779431078e-01,2.473476588e-01,3.068667711e-01,3.584720417e-01,4.036434517e-01,4.435136052e-01,4.789639990e-01,5.106909591e-01,5.392518362e-01,5.650980300e-01,5.885990231e-01,6.100601564e-01,6.297359696e-01,6.478403436e-01,6.645543074e-01,6.585194180e-01,6.406121537e-01,6.211278553e-01,5.998486007e-01,5.765143776e-01,5.508124062e-01,5.223630380e-01,4.907008769e-01,4.552491217e-01,4.152841095e-01,3.698853971e-01,3.178639957e-01,2.576567279e-01,1.871664560e-01,1.035128010e-01,2.628828896e-03,-9.918255595e-02,-1.835455764e-01,-2.545841775e-01,-3.152240342e-01,-3.675927060e-01,-4.132744159e-01,-4.534730876e-01,-4.891200006e-01,-5.209468346e-01,-5.495364245e-01,-5.753587781e-01,-5.987971175e-01,-6.201670260e-01,-6.397307408e-01,-6.255537426e-01,-6.058657960e-01,-5.844073505e-01,-5.609283358e-01,-5.351292603e-01,-5.066483683e-01,-4.750445715e-01,-4.397744409e-01,-4.001606981e-01,-3.553483015e-01,-3.042420289e-01,-2.454157756e-01,-1.769773894e-01,-9.636135435e-02,0.000000000e+00,9.636135435e-02,1.769773894e-01,2.454157756e-01,3.042420289e-01,3.553483015e-01,4.001606981e-01,4.397744409e-01,4.750445715e-01,5.066483683e-01,5.351292603e-01,5.609283358e-01,5.844073505e-01,6.058657960e-01,6.255537426e-01,6.397307408e-01,6.201670260e-01,5.987971175e-01,5.753587781e-01,5.495364245e-01,5.209468346e-01,4.891200006e-01,4.534730876e-01,4.132744159e-01,3.675927060e-01,3.152240342e-01,2.545841775e-01,1.835455764e-01,9.918255595e-02,-2.628828896e-03,-1.035128010e-01,-1.871664560e-01,-2.576567279e-01,-3.178639957e-01,-3.698853971e-01,-4.152841095e-01,-4.552491217e-01,-4.907008769e-01,-5.223630380e-01,-5.508124062e-01,-5.765143776e-01,-5.998486007e-01,-6.211278553e-01,-6.406121537e-01,-6.585194180e-01,-6.645543074e-01,-6.478403436e-01,-6.297359696e-01,-6.100601564e-01,-5.885990231e-01,-5.650980300e-01,-5.392518362e-01,-5.106909591e-01,-4.789639990e-01,-4.435136052e-01,-4.036434517e-01,-3.584720417e-01,-3.068667711e-01,-2.473476588e-01,-1.779431078e-01,-9.596728942e-02,2.325458569e-03,9.982372580e-02,1.811866822e-01,2.501136501e-01,3.092533873e-01,3.605522997e-01,4.054727657e-01,4.451347882e-01,4.804106515e-01,5.119898195e-01,5.404244477e-01,5.661619434e-01,5.895686806e-01,6.109475507e-01,6.003271365e-01,5.739944533e-01,5.446234410e-01,5.116560503e-01,4.743886570e-01,4.319212812e-01,3.830839556e-01,3.263272740e-01,2.595549970e-01,1.798594632e-01,8.308691439e-02,-3.455499060e-02,-1.404511108e-01,-2.269196964e-01,-2.988577649e-01,-3.596440735e-01,-4.116851906e-01,-4.567416977e-01,-4.961313087e-01,-5.308598832e-01,-5.617085284e-01,-5.892930521e-01,-6.141054921e-01,-6.365437238e-01,-6.569329565e-01,-6.755415987e-01,-6.925931401e-01,-6.877139581e-01,-6.748869294e-01,-6.611997355e-01,-6.465628523e-01,-6.308738858e-01,-6.140151734e-01,-5.958508275e-01,-5.762230650e-01,-5.549476117e-01,-5.318078998e-01,-5.065476686e-01,-4.788614349e-01,-4.483820782e-01,-4.146644691e-01,-3.771635871e-01,-3.352048344e-01,-2.879430943e-01,-2.343052184e-01,-1.729075540e-01,-1.019348852e-01,-1.895794740e-02,6.920937281e-02,1.448129904e-01,2.099238522e-01,2.665845916e-01,3.163399611e-01,3.603798149e-01,3.996354923e-01,4.348464092e-01,4.666070735e-01,4.954009254e-01,5.216251172e-01,5.456089430e-01,5.676277376e-01,5.650004958e-01,5.363995499e-01,5.044563616e-01,4.685487258e-01,4.278897766e-01,3.814696578e-01,3.279705091e-01,2.656393469e-01,1.920923242e-01,1.040028802e-01,-3.393987745e-03,-1.095358294e-01,-1.966767932e-01,-2.694998552e-01,-3.312659247e-01,-3.843155503e-01,-4.303722225e-01,-4.707331500e-01,-5.063933787e-01,-5.381289295e-01,-5.665539193e-01,-5.921606903e-01,-6.153485688e-01,-6.364448402e-01,-6.557202943e-01,-6.734009108e-01,-6.896767601e-01,-7.047088637e-01,-7.186345391e-01,-7.315716072e-01,-7.436217337e-01,-7.548731062e-01,-7.654025961e-01,-7.752775176e-01,-7.845570677e-01,-7.932935143e-01,-8.015331811e-01,-8.093172692e-01,-8.166825462e-01,-8.236619269e-01,-8.302849649e-01,-8.365782715e-01,-8.425658723e-01,-8.482695142e-01,-8.537089293e-01,-8.589020627e-01,-8.638652705e-01,-8.686134921e-01,-8.731603996e-01,-8.775185304e-01,-8.816994016e-01,-8.857136124e-01,-8.895709331e-01,-8.932803854e-01,-8.968503119e-01,-9.002884395e-01,-9.036019347e-01,-9.067974538e-01,-9.098811874e-01,-9.128589003e-01,-9.157359677e-01,-9.185174075e-01,-9.212079094e-01,-9.238118615e-01,-9.263333739e-01,-9.287763006e-01,-9.311442591e-01,-9.334406481e-01,-9.356686640e-01,-9.378313157e-01,-9.399314380e-01,-9.419717041e-01,-9.439546371e-01,-9.458826201e-01,-9.477579060e-01,-9.495826263e-01,-9.513587989e-01,-9.530883359e-01,-9.547730501e-01,-9.564146617e-01,-9.580148040e-01,-9.595750288e-01,-9.610968112e-01,-9.625815548e-01,-9.640305956e-01,-9.654452060e-01,-9.668265989e-01,-9.681759305e-01,-9.694943044e-01,-9.707827737e-01,-9.720423447e-01,-9.732739786e-01,-9.744785949e-01,-9.756570727e-01,-9.768102539e-01,-9.779389442e-01,-9.790439155e-01,-9.801259079e-01,-9.811856308e-01,-9.822237646e-01,-9.832409624e-01,-9.842378513e-01,-9.852150334e-01,-9.861730874e-01,-9.871125695e-01,-9.880340145e-01,-9.889379369e-01,-9.898248319e-01,-9.906951760e-01,-9.915494283e-01,-9.923880310e-01,-9.932114103e-01,-9.940199768e-01,-9.948141269e-01,-9.955942426e-01,-9.963606927e-01,-9.971138332e-01,-9.978540078e-01,-9.985815484e-01,-9.992967758e-01,-1.000000000e+00,-1.000691521e+00,-1.001371627e+00,-1.001371627e+00]);
const PL_STIFFNESS = Float32Array.from([-6.250000000e-02,-5.859375000e-02,-5.468750000e-02,-5.078125000e-02,-4.687500000e-02,-4.296875000e-02,-3.906250000e-02,-3.515625000e-02,-3.125000000e-02,-2.734375000e-02,-2.343750000e-02,-1.953125000e-02,-1.562500000e-02,-1.171875000e-02,-7.812500000e-03,-3.906250000e-03,0.000000000e+00,0.000000000e+00,0.000000000e+00,0.000000000e+00,1.009582073e-03,2.416076364e-03,4.002252878e-03,5.791066350e-03,7.808404022e-03,1.008346028e-02,1.264915914e-02,1.554263074e-02,1.880574864e-02,2.248573583e-02,2.663584813e-02,3.131614488e-02,3.659435812e-02,4.254687278e-02,4.925983210e-02,5.683038428e-02,6.536808837e-02,7.499649981e-02,8.585495846e-02,9.810060511e-02,1.119106556e-01,1.274849653e-01,1.450489216e-01,1.648567056e-01,1.871949702e-01,2.123869891e-01,2.407973346e-01,2.728371538e-01,3.089701187e-01,3.497191360e-01,3.956739150e-01,4.474995013e-01,5.059459012e-01,5.718589358e-01,6.461924814e-01,7.300222738e-01,8.245614757e-01,9.311782340e-01,1.000037649e+00,1.005639154e+00,1.048005353e+00,1.183990632e+00,1.457101344e+00,2.000000000e+00,2.000000000e+00]);
const PL_SVF_SHIFT = Float32Array.from([7.500000000e-01,7.591880421e-01,7.683455389e-01,7.774424499e-01,7.864497239e-01,7.953397451e-01,8.040867240e-01,8.126670211e-01,8.210593968e-01,8.292451828e-01,8.372083767e-01,8.449356653e-01,8.524163823e-01,8.596424124e-01,8.666080494e-01,8.733098228e-01,8.797462999e-01,8.859178746e-01,8.918265520e-01,8.974757332e-01,9.028700082e-01,9.080149595e-01,9.129169800e-01,9.175831064e-01,9.220208696e-01,9.262381615e-01,9.302431183e-01,9.340440198e-01,9.376492031e-01,9.410669892e-01,9.443056230e-01,9.473732226e-01,9.502777394e-01,9.530269262e-01,9.556283121e-01,9.580891845e-01,9.604165758e-01,9.626172547e-01,9.646977214e-01,9.666642057e-01,9.685226683e-01,9.702788030e-01,9.719380415e-01,9.735055596e-01,9.749862835e-01,9.763848977e-01,9.777058532e-01,9.789533760e-01,9.801314757e-01,9.812439545e-01,9.822944161e-01,9.832862746e-01,9.842227627e-01,9.851069409e-01,9.859417053e-01,9.867297957e-01,9.874738036e-01,9.881761792e-01,9.888392394e-01,9.894651739e-01,9.900560522e-01,9.906138300e-01,9.911403551e-01,9.916373732e-01,9.921065333e-01,9.925493929e-01,9.929674233e-01,9.933620136e-01,9.937344761e-01,9.940860496e-01,9.944179041e-01,9.947311441e-01,9.950268127e-01,9.953058946e-01,9.955693195e-01,9.958179650e-01,9.960526598e-01,9.962741861e-01,9.964832825e-01,9.966806459e-01,9.968669346e-01,9.970427696e-01,9.972087374e-01,9.973653916e-01,9.975132546e-01,9.976528197e-01,9.977845524e-01,9.979088923e-01,9.980262540e-01,9.981370293e-01,9.982415876e-01,9.983402778e-01,9.984334293e-01,9.985213529e-01,9.986043419e-01,9.986826732e-01,9.987566083e-01,9.988263939e-01,9.988922628e-01,9.989544348e-01,9.990131175e-01,9.990685067e-01,9.991207871e-01,9.991701333e-01,9.992167099e-01,9.992606725e-01,9.993021676e-01,9.993413338e-01,9.993783018e-01,9.994131950e-01,9.994461297e-01,9.994772160e-01,9.995065576e-01,9.995342523e-01,9.995603927e-01,9.995850659e-01,9.996083544e-01,9.996303357e-01,9.996510834e-01,9.996706665e-01,9.996891506e-01,9.997065972e-01,9.997230647e-01,9.997386078e-01,9.997532786e-01,9.997671260e-01,9.997801962e-01,9.997925329e-01,9.998041771e-01,9.998151678e-01,9.998255416e-01,9.998353332e-01,9.998445753e-01,9.998532986e-01,9.998615323e-01,9.998693039e-01,9.998766393e-01,9.998835630e-01,9.998900981e-01,9.998962664e-01,9.999020885e-01,9.999075839e-01,9.999127708e-01,9.999176666e-01,9.999222876e-01,9.999266493e-01,9.999307661e-01,9.999346519e-01,9.999383196e-01,9.999417815e-01,9.999450491e-01,9.999481332e-01,9.999510443e-01,9.999537919e-01,9.999563854e-01,9.999588333e-01,9.999611438e-01,9.999633246e-01,9.999653831e-01,9.999673260e-01,9.999691598e-01,9.999708907e-01,9.999725245e-01,9.999740666e-01,9.999755221e-01,9.999768960e-01,9.999781927e-01,9.999794167e-01,9.999805719e-01,9.999816623e-01,9.999826915e-01,9.999836630e-01,9.999845799e-01,9.999854454e-01,9.999862623e-01,9.999870333e-01,9.999877611e-01,9.999884480e-01,9.999890964e-01,9.999897083e-01,9.999902860e-01,9.999908312e-01,9.999913458e-01,9.999918315e-01,9.999922900e-01,9.999927227e-01,9.999931311e-01,9.999935167e-01,9.999938805e-01,9.999942240e-01,9.999945482e-01,9.999948542e-01,9.999951430e-01,9.999954156e-01,9.999956729e-01,9.999959157e-01,9.999961450e-01,9.999963613e-01,9.999965656e-01,9.999967583e-01,9.999969403e-01,9.999971120e-01,9.999972741e-01,9.999974271e-01,9.999975715e-01,9.999977078e-01,9.999978364e-01,9.999979579e-01,9.999980725e-01,9.999981807e-01,9.999982828e-01,9.999983792e-01,9.999984701e-01,9.999985560e-01,9.999986370e-01,9.999987135e-01,9.999987857e-01,9.999988539e-01,9.999989182e-01,9.999989789e-01,9.999990362e-01,9.999990903e-01,9.999991414e-01,9.999991896e-01,9.999992351e-01,9.999992780e-01,9.999993185e-01,9.999993568e-01,9.999993929e-01,9.999994269e-01,9.999994591e-01,9.999994895e-01,9.999995181e-01,9.999995452e-01,9.999995707e-01,9.999995948e-01,9.999996175e-01,9.999996390e-01,9.999996593e-01,9.999996784e-01,9.999996964e-01,9.999997135e-01,9.999997296e-01,9.999997447e-01,9.999997591e-01,9.999997726e-01,9.999997853e-01,9.999997974e-01,9.999998088e-01,9.999998195e-01,9.999998296e-01,9.999998392e-01,9.999998482e-01,9.999998567e-01,9.999998648e-01,9.999998724e-01,9.999998795e-01]);
const PL_4X_DOWNSAMPLER_FIR = Float32Array.from([2.442415000e-02,9.297315000e-02,1.671293800e-01,2.154733200e-01]);
const PL_WS_INVERSE_TAN = Int16Array.from([-32767,-26872,-24921,-23661,-22748,-22047,-21486,-21026,-20640,-20310,-20025,-19775,-19554,-19358,-19181,-19021,-18875,-18742,-18620,-18507,-18402,-18304,-18213,-18128,-18047,-17971,-17900,-17832,-17767,-17706,-17647,-17591,-17537,-17485,-17435,-17387,-17341,-17296,-17253,-17211,-17170,-17130,-17092,-17054,-17017,-16981,-16945,-16911,-16877,-16843,-16810,-16778,-16746,-16715,-16683,-16652,-16622,-16592,-16561,-16531,-16502,-16472,-16442,-16413,-16384,-16354,-16325,-16295,-16265,-16236,-16206,-16175,-16145,-16115,-16084,-16052,-16021,-15989,-15957,-15924,-15890,-15856,-15822,-15786,-15750,-15713,-15675,-15637,-15597,-15556,-15514,-15471,-15426,-15380,-15332,-15282,-15230,-15176,-15120,-15061,-15000,-14935,-14867,-14796,-14720,-14639,-14554,-14463,-14365,-14260,-14147,-14025,-13892,-13746,-13586,-13409,-13213,-12992,-12742,-12457,-12127,-11741,-11281,-10720,-10019,-9106,-7846,-5895,0,5895,7846,9106,10019,10720,11281,11741,12127,12457,12742,12992,13213,13409,13586,13746,13892,14025,14147,14260,14365,14463,14554,14639,14720,14796,14867,14935,15000,15061,15120,15176,15230,15282,15332,15380,15426,15471,15514,15556,15597,15637,15675,15713,15750,15786,15822,15856,15890,15924,15957,15989,16021,16052,16084,16115,16145,16175,16206,16236,16265,16295,16325,16354,16384,16413,16442,16472,16502,16531,16561,16592,16622,16652,16683,16715,16746,16778,16810,16843,16877,16911,16945,16981,17017,17054,17092,17130,17170,17211,17253,17296,17341,17387,17435,17485,17537,17591,17647,17706,17767,17832,17900,17971,18047,18128,18213,18304,18402,18507,18620,18742,18875,19021,19181,19358,19554,19775,20025,20310,20640,21026,21486,22047,22748,23661,24921,26872,32767]);
const PL_WS_INVERSE_SIN = Int16Array.from([-32767,-30921,-30153,-29561,-29060,-28617,-28215,-27843,-27496,-27169,-26858,-26561,-26276,-26001,-25736,-25479,-25229,-24986,-24748,-24517,-24290,-24068,-23850,-23636,-23425,-23218,-23014,-22813,-22614,-22419,-22225,-22034,-21845,-21657,-21472,-21288,-21106,-20926,-20747,-20569,-20393,-20218,-20043,-19870,-19698,-19527,-19357,-19188,-19019,-18851,-18684,-18517,-18351,-18185,-18020,-17855,-17691,-17527,-17363,-17199,-17036,-16873,-16709,-16546,-16384,-16221,-16058,-15894,-15731,-15568,-15404,-15240,-15076,-14912,-14747,-14582,-14416,-14250,-14083,-13916,-13748,-13579,-13410,-13240,-13069,-12897,-12724,-12549,-12374,-12198,-12020,-11841,-11661,-11479,-11295,-11110,-10922,-10733,-10542,-10348,-10153,-9954,-9753,-9549,-9342,-9131,-8917,-8699,-8477,-8250,-8019,-7781,-7538,-7288,-7031,-6766,-6491,-6206,-5909,-5598,-5271,-4924,-4552,-4150,-3707,-3206,-2614,-1846,0,1846,2614,3206,3707,4150,4552,4924,5271,5598,5909,6206,6491,6766,7031,7288,7538,7781,8019,8250,8477,8699,8917,9131,9342,9549,9753,9954,10153,10348,10542,10733,10922,11110,11295,11479,11661,11841,12020,12198,12374,12549,12724,12897,13069,13240,13410,13579,13748,13916,14083,14250,14416,14582,14747,14912,15076,15240,15404,15568,15731,15894,16058,16221,16384,16546,16709,16873,17036,17199,17363,17527,17691,17855,18020,18185,18351,18517,18684,18851,19019,19188,19357,19527,19698,19870,20043,20218,20393,20569,20747,20926,21106,21288,21472,21657,21845,22034,22225,22419,22614,22813,23014,23218,23425,23636,23850,24068,24290,24517,24748,24986,25229,25479,25736,26001,26276,26561,26858,27169,27496,27843,28215,28617,29060,29561,30153,30921,32767]);
const PL_WS_LINEAR = Int16Array.from([-32767,-32511,-32255,-31999,-31743,-31487,-31231,-30975,-30719,-30463,-30207,-29951,-29695,-29439,-29183,-28927,-28671,-28415,-28159,-27903,-27647,-27391,-27135,-26879,-26623,-26367,-26111,-25855,-25599,-25343,-25087,-24831,-24575,-24319,-24063,-23807,-23551,-23295,-23039,-22783,-22527,-22271,-22015,-21759,-21503,-21247,-20991,-20735,-20479,-20223,-19967,-19711,-19455,-19199,-18943,-18687,-18431,-18175,-17919,-17663,-17407,-17151,-16895,-16639,-16384,-16128,-15872,-15616,-15360,-15104,-14848,-14592,-14336,-14080,-13824,-13568,-13312,-13056,-12800,-12544,-12288,-12032,-11776,-11520,-11264,-11008,-10752,-10496,-10240,-9984,-9728,-9472,-9216,-8960,-8704,-8448,-8192,-7936,-7680,-7424,-7168,-6912,-6656,-6400,-6144,-5888,-5632,-5376,-5120,-4864,-4608,-4352,-4096,-3840,-3584,-3328,-3072,-2816,-2560,-2304,-2048,-1792,-1536,-1280,-1024,-768,-512,-256,0,256,512,768,1024,1280,1536,1792,2048,2304,2560,2816,3072,3328,3584,3840,4096,4352,4608,4864,5120,5376,5632,5888,6144,6400,6656,6912,7168,7424,7680,7936,8192,8448,8704,8960,9216,9472,9728,9984,10240,10496,10752,11008,11264,11520,11776,12032,12288,12544,12800,13056,13312,13568,13824,14080,14336,14592,14848,15104,15360,15616,15872,16128,16384,16639,16895,17151,17407,17663,17919,18175,18431,18687,18943,19199,19455,19711,19967,20223,20479,20735,20991,21247,21503,21759,22015,22271,22527,22783,23039,23295,23551,23807,24063,24319,24575,24831,25087,25343,25599,25855,26111,26367,26623,26879,27135,27391,27647,27903,28159,28415,28671,28927,29183,29439,29695,29951,30207,30463,30719,30975,31231,31487,31743,31999,32255,32511,32767]);
const PL_WS_BUMP = Int16Array.from([0,-36,-150,-348,-636,-1017,-1496,-2074,-2752,-3528,-4401,-5366,-6417,-7548,-8750,-10013,-11327,-12679,-14056,-15444,-16829,-18197,-19530,-20816,-22039,-23185,-24239,-25190,-26025,-26733,-27306,-27736,-28018,-28214,-28391,-28550,-28690,-28810,-28912,-28994,-29056,-29099,-29122,-29125,-29109,-29073,-29017,-28941,-28846,-28732,-28599,-28446,-28275,-28085,-27877,-27651,-27407,-27145,-26867,-26572,-26260,-25933,-25590,-25233,-24861,-24475,-24075,-23663,-23238,-22802,-22354,-21896,-21428,-20951,-20465,-19971,-19469,-18961,-18447,-17928,-17404,-16877,-16346,-15813,-15278,-14742,-14206,-13670,-13136,-12603,-12073,-11547,-11025,-10507,-9995,-9489,-8990,-8499,-8015,-7541,-7076,-6621,-6178,-5745,-5324,-4916,-4521,-4140,-3773,-3420,-3082,-2760,-2454,-2165,-1892,-1636,-1398,-1178,-976,-792,-627,-481,-354,-246,-158,-89,-39,-10,0,10,39,89,158,246,354,481,627,792,976,1178,1398,1636,1892,2165,2454,2760,3082,3420,3773,4140,4521,4916,5324,5745,6178,6621,7076,7541,8015,8499,8990,9489,9995,10507,11025,11547,12073,12603,13136,13670,14206,14742,15278,15813,16346,16877,17404,17928,18447,18961,19469,19971,20465,20951,21428,21896,22354,22802,23238,23663,24075,24475,24861,25233,25590,25933,26260,26572,26867,27145,27407,27651,27877,28085,28275,28446,28599,28732,28846,28941,29017,29073,29109,29125,29122,29099,29056,28994,28912,28810,28690,28550,28391,28214,28018,27736,27306,26733,26025,25190,24239,23185,22039,20816,19530,18197,16829,15444,14056,12679,11327,10013,8750,7548,6417,5366,4401,3528,2752,2074,1496,1017,636,348,150,36,0]);
const PL_WS_DOUBLE_BUMP = Int16Array.from([32767,32745,32678,32567,32412,32213,31971,31685,31356,30985,30571,30117,29621,29085,28510,27896,27245,26556,25832,25072,24279,23452,22594,21705,20787,19841,18868,17869,16846,15800,14732,13645,12539,11417,10278,9126,7962,6786,5602,4410,3212,2009,804,-402,-1608,-2811,-4011,-5205,-6393,-7571,-8739,-9896,-11039,-12167,-13279,-14372,-15446,-16499,-17530,-18537,-19519,-20475,-21403,-22301,-23170,-24007,-24811,-25582,-26319,-27019,-27683,-28310,-28898,-29447,-29956,-30424,-30852,-31237,-31580,-31880,-32137,-32351,-32521,-32646,-32728,-32765,-32757,-32705,-32609,-32469,-32285,-32057,-31785,-31470,-31113,-30714,-30273,-29791,-29268,-28706,-28105,-27466,-26790,-26077,-25329,-24547,-23731,-22884,-22005,-21096,-20159,-19195,-18204,-17189,-16151,-15090,-14010,-12910,-11793,-10659,-9512,-8351,-7179,-5998,-4808,-3612,-2410,-1206,0,1206,2410,3612,4808,5998,7179,8351,9512,10659,11793,12910,14010,15090,16151,17189,18204,19195,20159,21096,22005,22884,23731,24547,25329,26077,26790,27466,28105,28706,29268,29791,30273,30714,31113,31470,31785,32057,32285,32469,32609,32705,32757,32765,32728,32646,32521,32351,32137,31880,31580,31237,30852,30424,29956,29447,28898,28310,27683,27019,26319,25582,24811,24007,23170,22301,21403,20475,19519,18537,17530,16499,15446,14372,13279,12167,11039,9896,8739,7571,6393,5205,4011,2811,1608,402,-804,-2009,-3212,-4410,-5602,-6786,-7962,-9126,-10278,-11417,-12539,-13645,-14732,-15800,-16846,-17869,-18868,-19841,-20787,-21705,-22594,-23452,-24279,-25072,-25832,-26556,-27245,-27896,-28510,-29085,-29621,-30117,-30571,-30985,-31356,-31685,-31971,-32213,-32412,-32567,-32678,-32745,-32767]);
const PL_LPC_EXCITATION_PULSE = Int8Array.from([0,0,0,0,1,1,1,2,3,3,4,5,6,7,8,9,10,12,13,15,17,19,21,23,25,28,30,33,36,38,41,44,48,51,54,57,61,64,68,71,75,78,82,85,89,92,95,99,102,105,108,110,113,115,118,120,121,123,124,125,126,127,127,127,127,126,125,124,122,121,118,116,113,110,107,104,100,96,92,87,83,78,73,68,63,58,53,47,42,37,31,26,21,16,11,6,1,-3,-8,-12,-16,-20,-23,-26,-29,-32,-35,-37,-39,-40,-42,-43,-43,-44,-44,-44,-44,-44,-43,-42,-41,-40,-39,-38,-36,-35,-33,-32,-30,-29,-27,-26,-24,-23,-22,-20,-19,-18,-18,-17,-16,-16,-16,-16,-16,-16,-17,-17,-18,-19,-20,-21,-23,-24,-26,-27,-29,-30,-32,-34,-35,-37,-39,-40,-42,-43,-44,-46,-47,-48,-48,-49,-49,-50,-50,-50,-49,-49,-48,-47,-46,-45,-44,-42,-41,-39,-37,-35,-33,-31,-29,-27,-25,-23,-20,-18,-16,-14,-13,-11,-9,-8,-7,-6,-5,-4,-3,-3,-3,-3,-3,-4,-5,-6,-7,-9,-10,-12,-14,-16,-18,-21,-23,-26,-29,-32,-34,-37,-40,-43,-46,-49,-51,-54,-56,-59,-61,-63,-65,-67,-68,-70,-71,-72,-72,-73,-73,-73,-73,-72,-72,-71,-70,-69,-67,-66,-64,-63,-61,-59,-57,-54,-52,-50,-48,-45,-43,-41,-39,-37,-35,-33,-31,-29,-27,-26,-25,-23,-22,-21,-20,-20,-19,-19,-19,-18,-18,-18,-19,-19,-19,-20,-20,-21,-21,-22,-22,-23,-23,-24,-24,-25,-25,-25,-26,-26,-26,-25,-25,-25,-24,-24,-23,-22,-21,-20,-19,-18,-16,-15,-13,-12,-10,-8,-6,-4,-3,-1,1,3,5,7,8,10,12,13,15,16,17,18,19,20,21,21,22,22,22,22,22,22,22,22,21,21,20,19,19,18,17,16,15,14,14,13,12,11,10,10,9,9,8,8,8,8,8,8,8,8,8,9,9,10,11,12,13,14,15,16,17,18,19,21,22,23,24,26,27,28,29,30,31,32,33,33,34,35,35,35,36,36,36,36,35,35,35,34,34,33,33,32,31,30,30,29,28,27,26,25,25,24,23,22,22,21,20,20,19,19,19,19,19,19,19,19,19,19,20,20,21,21,22,22,23,23,24,25,25,26,27,27,28,29,29,29,30,30,30,31,31,31,31,30,30,30,29,29,28,28,27,26,26,25,24,23,22,21,20,19,18,17,16,15,15,14,13,12,12,11,10,10,10,9,9,9,9,9,9,9,9,10,10,10,11,11,12,12,12,13,13,14,14,14,15,15,15,15,15,15,15,15,15,15,14,14,14,13,12,12,11,10,9,8,8,7,6,5,4,3,2,1,0,-1,-2,-3,-4,-4,-5,-6,-6,-7,-7,-8,-8,-8,-9,-9,-9,-9,-9,-9,-9,-9,-8,-8,-8,-7,-7,-7,-6,-6,-5,-5,-5,-4,-4,-4,-3,-3,-3,-2,-2,-2,-2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-2,-1,-1,-1,-1,-1,-1,0,0,0,0,0]);
const PL_INTEGRATED_WAVES = Int16Array.from([-20556,-20706,-20806,-20857,-20857,-20806,-20706,-20556,-20356,-20107,-19810,-19465,-19073,-18635,-18152,-17626,-17057,-16447,-15798,-15110,-14386,-13627,-12835,-12013,-11162,-10283,-9380,-8454,-7508,-6544,-5564,-4571,-3567,-2554,-1535,-512,512,1535,2554,3567,4571,5564,6544,7508,8454,9380,10283,11162,12013,12835,13627,14386,15110,15798,16447,17057,17626,18152,18635,19073,19465,19810,20107,20356,20556,20706,20806,20857,20857,20806,20706,20556,20356,20107,19810,19465,19073,18635,18152,17626,17057,16447,15798,15110,14386,13627,12835,12013,11162,10283,9380,8454,7508,6544,5564,4571,3567,2554,1535,512,-512,-1535,-2554,-3567,-4571,-5564,-6544,-7508,-8454,-9380,-10283,-11162,-12013,-12835,-13627,-14386,-15110,-15798,-16447,-17057,-17626,-18152,-18635,-19073,-19465,-19810,-20107,-20356,-20556,-20706,-20806,-20857,-9825,-10122,-10322,-10422,-10422,-10322,-10122,-9825,-9433,-8950,-8381,-7732,-7007,-6216,-5364,-4461,-3515,-2535,-1531,-512,512,1531,2535,3515,4461,5364,6216,7007,7732,8381,8950,9433,9825,10122,10322,10422,10422,10322,10122,9825,9433,8950,8381,7732,7007,6216,5364,4461,3515,2535,1531,512,-512,-1531,-2535,-3515,-4461,-5364,-6216,-7007,-7732,-8381,-8950,-9433,-9825,-10122,-10322,-10422,-10422,-10322,-10122,-9825,-9433,-8950,-8381,-7732,-7007,-6216,-5364,-4461,-3515,-2535,-1531,-512,512,1531,2535,3515,4461,5364,6216,7007,7732,8381,8950,9433,9825,10122,10322,10422,10422,10322,10122,9825,9433,8950,8381,7732,7007,6216,5364,4461,3515,2535,1531,512,-512,-1531,-2535,-3515,-4461,-5364,-6216,-7007,-7732,-8381,-8950,-9433,-9825,-10122,-10322,-10422,-6056,-6494,-6791,-6941,-6941,-6791,-6494,-6056,-5487,-4799,-4008,-3129,-2183,-1190,-171,852,1856,2820,3724,4546,5270,5880,6363,6708,6908,6958,6857,6609,6217,5690,5041,4282,3431,2505,1525,512,-512,-1525,-2505,-3431,-4282,-5041,-5690,-6217,-6609,-6857,-6958,-6908,-6708,-6363,-5880,-5270,-4546,-3724,-2820,-1856,-852,171,1190,2183,3129,4008,4799,5487,6056,6494,6791,6941,6941,6791,6494,6056,5487,4799,4008,3129,2183,1190,171,-852,-1856,-2820,-3724,-4546,-5270,-5880,-6363,-6708,-6908,-6958,-6857,-6609,-6217,-5690,-5041,-4282,-3431,-2505,-1525,-512,512,1525,2505,3431,4282,5041,5690,6217,6609,6857,6958,6908,6708,6363,5880,5270,4546,3724,2820,1856,852,-171,-1190,-2183,-3129,-4008,-4799,-5487,-6056,-6494,-6791,-6941,-4038,-4607,-4999,-5198,-5198,-4999,-4607,-4038,-3314,-2462,-1516,-512,512,1516,2462,3314,4038,4607,4999,5198,5198,4999,4607,4038,3314,2462,1516,512,-512,-1516,-2462,-3314,-4038,-4607,-4999,-5198,-5198,-4999,-4607,-4038,-3314,-2462,-1516,-512,512,1516,2462,3314,4038,4607,4999,5198,5198,4999,4607,4038,3314,2462,1516,512,-512,-1516,-2462,-3314,-4038,-4607,-4999,-5198,-5198,-4999,-4607,-4038,-3314,-2462,-1516,-512,512,1516,2462,3314,4038,4607,4999,5198,5198,4999,4607,4038,3314,2462,1516,512,-512,-1516,-2462,-3314,-4038,-4607,-4999,-5198,-5198,-4999,-4607,-4038,-3314,-2462,-1516,-512,512,1516,2462,3314,4038,4607,4999,5198,5198,4999,4607,4038,3314,2462,1516,512,-512,-1516,-2462,-3314,-4038,-4607,-4999,-5198,-2732,-3420,-3902,-4151,-4151,-3902,-3420,-2732,-1881,-916,103,1116,2062,2884,3534,3972,4171,4121,3824,3297,2573,1695,715,-308,-1312,-2238,-3029,-3639,-4031,-4181,-4081,-3736,-3167,-2408,-1505,-512,512,1505,2408,3167,3736,4081,4181,4031,3639,3029,2238,1312,308,-715,-1695,-2573,-3297,-3824,-4121,-4171,-3972,-3534,-2884,-2062,-1116,-103,916,1881,2732,3420,3902,4151,4151,3902,3420,2732,1881,916,-103,-1116,-2062,-2884,-3534,-3972,-4171,-4121,-3824,-3297,-2573,-1695,-715,308,1312,2238,3029,3639,4031,4181,4081,3736,3167,2408,1505,512,-512,-1505,-2408,-3167,-3736,-4081,-4181,-4031,-3639,-3029,-2238,-1312,-308,715,1695,2573,3297,3824,4121,4171,3972,3534,2884,2062,1116,103,-916,-1881,-2732,-3420,-3902,-4151,-1794,-2585,-3154,-3452,-3452,-3154,-2585,-1794,-848,171,1176,2079,2803,3285,3485,3385,2993,2343,1492,512,-512,-1492,-2343,-2993,-3385,-3485,-3285,-2803,-2079,-1176,-171,848,1794,2585,3154,3452,3452,3154,2585,1794,848,-171,-1176,-2079,-2803,-3285,-3485,-3385,-2993,-2343,-1492,-512,512,1492,2343,2993,3385,3485,3285,2803,2079,1176,171,-848,-1794,-2585,-3154,-3452,-3452,-3154,-2585,-1794,-848,171,1176,2079,2803,3285,3485,3385,2993,2343,1492,512,-512,-1492,-2343,-2993,-3385,-3485,-3285,-2803,-2079,-1176,-171,848,1794,2585,3154,3452,3452,3154,2585,1794,848,-171,-1176,-2079,-2803,-3285,-3485,-3385,-2993,-2343,-1492,-512,512,1492,2343,2993,3385,3485,3285,2803,2079,1176,171,-848,-1794,-2585,-3154,-3452,-1078,-1956,-2606,-2951,-2951,-2606,-1956,-1078,-73,939,1843,2530,2922,2972,2675,2065,1214,220,-799,-1724,-2449,-2886,-2987,-2738,-2169,-1347,-367,656,1602,2361,2844,2994,2794,2268,1476,512,-512,-1476,-2268,-2794,-2994,-2844,-2361,-1602,-656,367,1347,2169,2738,2987,2886,2449,1724,799,-220,-1214,-2065,-2675,-2972,-2922,-2530,-1843,-939,73,1078,1956,2606,2951,2951,2606,1956,1078,73,-939,-1843,-2530,-2922,-2972,-2675,-2065,-1214,-220,799,1724,2449,2886,2987,2738,2169,1347,367,-656,-1602,-2361,-2844,-2994,-2794,-2268,-1476,-512,512,1476,2268,2794,2994,2844,2361,1602,656,-367,-1347,-2169,-2738,-2987,-2886,-2449,-1724,-799,220,1214,2065,2675,2972,2922,2530,1843,939,-73,-1078,-1956,-2606,-2951,-512,-1458,-2182,-2574,-2574,-2182,-1458,-512,512,1458,2182,2574,2574,2182,1458,512,-512,-1458,-2182,-2574,-2574,-2182,-1458,-512,512,1458,2182,2574,2574,2182,1458,512,-512,-1458,-2182,-2574,-2574,-2182,-1458,-512,512,1458,2182,2574,2574,2182,1458,512,-512,-1458,-2182,-2574,-2574,-2182,-1458,-512,512,1458,2182,2574,2574,2182,1458,512,-512,-1458,-2182,-2574,-2574,-2182,-1458,-512,512,1458,2182,2574,2574,2182,1458,512,-512,-1458,-2182,-2574,-2574,-2182,-1458,-512,512,1458,2182,2574,2574,2182,1458,512,-512,-1458,-2182,-2574,-2574,-2182,-1458,-512,512,1458,2182,2574,2574,2182,1458,512,-512,-1458,-2182,-2574,-2574,-2182,-1458,-512,512,1458,2182,2574,2574,2182,1458,512,-512,-1458,-2182,-2574,-9825,-10122,-10322,-10422,-10422,-10322,-10122,-9825,-9433,-8950,-8381,-7732,-7007,-6216,-5364,-4461,-3515,-2535,-1531,-512,512,1531,2535,3515,4461,5364,6216,7007,7732,8381,8950,9433,9825,10122,10322,10422,10422,10322,10122,9825,9433,8950,8381,7732,7007,6216,5364,4461,3515,2535,1531,512,-512,-1531,-2535,-3515,-4461,-5364,-6216,-7007,-7732,-8381,-8950,-9433,-9825,-10122,-10322,-10422,-10422,-10322,-10122,-9825,-9433,-8950,-8381,-7732,-7007,-6216,-5364,-4461,-3515,-2535,-1531,-512,512,1531,2535,3515,4461,5364,6216,7007,7732,8381,8950,9433,9825,10122,10322,10422,10422,10322,10122,9825,9433,8950,8381,7732,7007,6216,5364,4461,3515,2535,1531,512,-512,-1531,-2535,-3515,-4461,-5364,-6216,-7007,-7732,-8381,-8950,-9433,-9825,-10122,-10322,-10422,-6056,-6494,-6791,-6941,-6941,-6791,-6494,-6056,-5487,-4799,-4008,-3129,-2183,-1190,-171,852,1856,2820,3724,4546,5270,5880,6363,6708,6908,6958,6857,6609,6217,5690,5041,4282,3431,2505,1525,512,-512,-1525,-2505,-3431,-4282,-5041,-5690,-6217,-6609,-6857,-6958,-6908,-6708,-6363,-5880,-5270,-4546,-3724,-2820,-1856,-852,171,1190,2183,3129,4008,4799,5487,6056,6494,6791,6941,6941,6791,6494,6056,5487,4799,4008,3129,2183,1190,171,-852,-1856,-2820,-3724,-4546,-5270,-5880,-6363,-6708,-6908,-6958,-6857,-6609,-6217,-5690,-5041,-4282,-3431,-2505,-1525,-512,512,1525,2505,3431,4282,5041,5690,6217,6609,6857,6958,6908,6708,6363,5880,5270,4546,3724,2820,1856,852,-171,-1190,-2183,-3129,-4008,-4799,-5487,-6056,-6494,-6791,-6941,-4038,-4607,-4999,-5198,-5198,-4999,-4607,-4038,-3314,-2462,-1516,-512,512,1516,2462,3314,4038,4607,4999,5198,5198,4999,4607,4038,3314,2462,1516,512,-512,-1516,-2462,-3314,-4038,-4607,-4999,-5198,-5198,-4999,-4607,-4038,-3314,-2462,-1516,-512,512,1516,2462,3314,4038,4607,4999,5198,5198,4999,4607,4038,3314,2462,1516,512,-512,-1516,-2462,-3314,-4038,-4607,-4999,-5198,-5198,-4999,-4607,-4038,-3314,-2462,-1516,-512,512,1516,2462,3314,4038,4607,4999,5198,5198,4999,4607,4038,3314,2462,1516,512,-512,-1516,-2462,-3314,-4038,-4607,-4999,-5198,-5198,-4999,-4607,-4038,-3314,-2462,-1516,-512,512,1516,2462,3314,4038,4607,4999,5198,5198,4999,4607,4038,3314,2462,1516,512,-512,-1516,-2462,-3314,-4038,-4607,-4999,-5198,-1794,-2585,-3154,-3452,-3452,-3154,-2585,-1794,-848,171,1176,2079,2803,3285,3485,3385,2993,2343,1492,512,-512,-1492,-2343,-2993,-3385,-3485,-3285,-2803,-2079,-1176,-171,848,1794,2585,3154,3452,3452,3154,2585,1794,848,-171,-1176,-2079,-2803,-3285,-3485,-3385,-2993,-2343,-1492,-512,512,1492,2343,2993,3385,3485,3285,2803,2079,1176,171,-848,-1794,-2585,-3154,-3452,-3452,-3154,-2585,-1794,-848,171,1176,2079,2803,3285,3485,3385,2993,2343,1492,512,-512,-1492,-2343,-2993,-3385,-3485,-3285,-2803,-2079,-1176,-171,848,1794,2585,3154,3452,3452,3154,2585,1794,848,-171,-1176,-2079,-2803,-3285,-3485,-3385,-2993,-2343,-1492,-512,512,1492,2343,2993,3385,3485,3285,2803,2079,1176,171,-848,-1794,-2585,-3154,-3452,-512,-1458,-2182,-2574,-2574,-2182,-1458,-512,512,1458,2182,2574,2574,2182,1458,512,-512,-1458,-2182,-2574,-2574,-2182,-1458,-512,512,1458,2182,2574,2574,2182,1458,512,-512,-1458,-2182,-2574,-2574,-2182,-1458,-512,512,1458,2182,2574,2574,2182,1458,512,-512,-1458,-2182,-2574,-2574,-2182,-1458,-512,512,1458,2182,2574,2574,2182,1458,512,-512,-1458,-2182,-2574,-2574,-2182,-1458,-512,512,1458,2182,2574,2574,2182,1458,512,-512,-1458,-2182,-2574,-2574,-2182,-1458,-512,512,1458,2182,2574,2574,2182,1458,512,-512,-1458,-2182,-2574,-2574,-2182,-1458,-512,512,1458,2182,2574,2574,2182,1458,512,-512,-1458,-2182,-2574,-2574,-2182,-1458,-512,512,1458,2182,2574,2574,2182,1458,512,-512,-1458,-2182,-2574,831,-173,-1119,-1688,-1688,-1119,-173,831,1556,1755,1363,512,-512,-1363,-1755,-1556,-831,173,1119,1688,1688,1119,173,-831,-1556,-1755,-1363,-512,512,1363,1755,1556,831,-173,-1119,-1688,-1688,-1119,-173,831,1556,1755,1363,512,-512,-1363,-1755,-1556,-831,173,1119,1688,1688,1119,173,-831,-1556,-1755,-1363,-512,512,1363,1755,1556,831,-173,-1119,-1688,-1688,-1119,-173,831,1556,1755,1363,512,-512,-1363,-1755,-1556,-831,173,1119,1688,1688,1119,173,-831,-1556,-1755,-1363,-512,512,1363,1755,1556,831,-173,-1119,-1688,-1688,-1119,-173,831,1556,1755,1363,512,-512,-1363,-1755,-1556,-831,173,1119,1688,1688,1119,173,-831,-1556,-1755,-1363,-512,512,1363,1755,1556,831,-173,-1119,-1688,1236,512,-512,-1236,-1236,-512,512,1236,1236,512,-512,-1236,-1236,-512,512,1236,1236,512,-512,-1236,-1236,-512,512,1236,1236,512,-512,-1236,-1236,-512,512,1236,1236,512,-512,-1236,-1236,-512,512,1236,1236,512,-512,-1236,-1236,-512,512,1236,1236,512,-512,-1236,-1236,-512,512,1236,1236,512,-512,-1236,-1236,-512,512,1236,1236,512,-512,-1236,-1236,-512,512,1236,1236,512,-512,-1236,-1236,-512,512,1236,1236,512,-512,-1236,-1236,-512,512,1236,1236,512,-512,-1236,-1236,-512,512,1236,1236,512,-512,-1236,-1236,-512,512,1236,1236,512,-512,-1236,-1236,-512,512,1236,1236,512,-512,-1236,-1236,-512,512,1236,1236,512,-512,-1236,-1236,-512,512,1236,1236,512,-512,-1236,512,904,180,-766,-766,180,904,512,-512,-904,-180,766,766,-180,-904,-512,512,904,180,-766,-766,180,904,512,-512,-904,-180,766,766,-180,-904,-512,512,904,180,-766,-766,180,904,512,-512,-904,-180,766,766,-180,-904,-512,512,904,180,-766,-766,180,904,512,-512,-904,-180,766,766,-180,-904,-512,512,904,180,-766,-766,180,904,512,-512,-904,-180,766,766,-180,-904,-512,512,904,180,-766,-766,180,904,512,-512,-904,-180,766,766,-180,-904,-512,512,904,180,-766,-766,180,904,512,-512,-904,-180,766,766,-180,-904,-512,512,904,180,-766,-766,180,904,512,-512,-904,-180,766,766,-180,-904,-512,512,904,180,-766,-1114,-2082,-2836,-3249,-3249,-2836,-2082,-1114,-90,834,1535,1940,2042,1888,1567,1179,820,551,398,344,344,340,282,135,-106,-417,-757,-1074,-1320,-1460,-1479,-1379,-1175,-892,-555,-188,188,555,892,1175,1379,1479,1460,1320,1074,757,417,106,-135,-282,-340,-344,-344,-398,-551,-820,-1179,-1567,-1888,-2042,-1940,-1535,-834,90,1114,2082,2836,3249,3249,2836,2082,1114,90,-834,-1535,-1940,-2042,-1888,-1567,-1179,-820,-551,-398,-344,-344,-340,-282,-135,106,417,757,1074,1320,1460,1479,1379,1175,892,555,188,-188,-555,-892,-1175,-1379,-1479,-1460,-1320,-1074,-757,-417,-106,135,282,340,344,344,398,551,820,1179,1567,1888,2042,1940,1535,834,-90,-1114,-2082,-2836,-3249,-1,-1025,-1892,-2388,-2388,-1892,-1025,-1,939,1592,1848,1708,1273,702,158,-239,-444,-481,-427,-369,-369,-444,-565,-668,-686,-575,-329,15,392,728,961,1053,998,811,526,182,-182,-526,-811,-998,-1053,-961,-728,-392,-15,329,575,686,668,565,444,369,369,427,481,444,239,-158,-702,-1273,-1708,-1848,-1592,-939,1,1025,1892,2388,2388,1892,1025,1,-939,-1592,-1848,-1708,-1273,-702,-158,239,444,481,427,369,369,444,565,668,686,575,329,-15,-392,-728,-961,-1053,-998,-811,-526,-182,182,526,811,998,1053,961,728,392,15,-329,-575,-686,-668,-565,-444,-369,-369,-427,-481,-444,-239,158,702,1273,1708,1848,1592,939,-1,-1025,-1892,-2388,657,-367,-1338,-1927,-1927,-1338,-367,657,1404,1662,1411,803,89,-487,-779,-780,-589,-351,-182,-118,-118,-100,4,206,452,648,703,573,277,-106,-475,-735,-829,-746,-513,-182,182,513,746,829,735,475,106,-277,-573,-703,-648,-452,-206,-4,100,118,118,182,351,589,780,779,487,-89,-803,-1411,-1662,-1404,-657,367,1338,1927,1927,1338,367,-657,-1404,-1662,-1411,-803,-89,487,779,780,589,351,182,118,118,100,-4,-206,-452,-648,-703,-573,-277,106,475,735,829,746,513,182,-182,-513,-746,-829,-735,-475,-106,277,573,703,648,452,206,4,-100,-118,-118,-182,-351,-589,-780,-779,-487,89,803,1411,1662,1404,657,-367,-1338,-1927,1162,425,-599,-1324,-1324,-599,425,1162,1225,644,-191,-796,-890,-532,-18,342,416,286,128,58,58,27,-103,-289,-400,-320,-45,298,526,513,260,-111,-428,-558,-457,-175,175,457,558,428,111,-260,-513,-526,-298,45,320,400,289,103,-27,-58,-58,-128,-286,-416,-342,18,532,890,796,191,-644,-1225,-1162,-425,599,1324,1324,599,-425,-1162,-1225,-644,191,796,890,532,18,-342,-416,-286,-128,-58,-58,-27,103,289,400,320,45,-298,-526,-513,-260,111,428,558,457,175,-175,-457,-558,-428,-111,260,513,526,298,-45,-320,-400,-289,-103,27,58,58,128,286,416,342,-18,-532,-890,-796,-191,644,1225,1162,425,-599,-1324,1114,856,-168,-1084,-1084,-168,856,1114,444,-511,-936,-564,168,609,490,63,-245,-258,-119,-38,-38,8,158,281,197,-99,-380,-390,-86,302,473,300,-82,-398,-438,-187,187,438,398,82,-300,-473,-302,86,390,380,99,-197,-281,-158,-8,38,38,119,258,245,-63,-490,-609,-168,564,936,511,-444,-1114,-856,168,1084,1084,168,-856,-1114,-444,511,936,564,-168,-609,-490,-63,245,258,119,38,38,-8,-158,-281,-197,99,380,390,86,-302,-473,-300,82,398,438,187,-187,-438,-398,-82,300,473,302,-86,-390,-380,-99,197,281,158,8,-38,-38,-119,-258,-245,63,490,609,168,-564,-936,-511,444,1114,856,-168,-1084,-11,791,366,-658,-658,366,791,-11,-731,-293,514,455,-234,-445,-3,304,120,-118,-98,-18,-18,45,144,38,-200,-176,145,287,2,-303,-175,201,292,-16,-294,-176,176,294,16,-292,-201,175,303,-2,-287,-145,176,200,-38,-144,-45,18,18,98,118,-120,-304,3,445,234,-455,-514,293,731,11,-791,-366,658,658,-366,-791,11,731,293,-514,-455,234,445,3,-304,-120,118,98,18,18,-45,-144,-38,200,176,-145,-287,-2,303,175,-201,-292,16,294,176,-176,-294,-16,292,201,-175,-303,2,287,145,-176,-200,38,144,45,-18,-18,-98,-118,120,304,-3,-445,-234,455,514,-293,-731,-11,791,366,-658,-626,225,585,-439,-439,585,225,-626,0,560,-178,-415,269,244,-265,-100,188,19,-82,-11,-11,61,60,-136,-57,202,14,-238,45,241,-98,-222,135,196,-157,-174,174,157,-196,-135,222,98,-241,-45,238,-14,-202,57,136,-60,-61,11,11,82,-19,-188,100,265,-244,-269,415,178,-560,0,626,-225,-585,439,439,-585,-225,626,0,-560,178,415,-269,-244,265,100,-188,-19,82,11,11,-61,-60,136,57,-202,-14,238,-45,-241,98,222,-135,-196,157,174,-174,-157,196,135,-222,-98,241,45,-238,14,202,-57,-136,60,61,-11,-11,-82,19,188,-100,-265,244,269,-415,-178,560,0,-626,225,585,-439,462,-562,456,-175,-175,456,-562,462,-205,-97,325,-403,325,-150,-31,145,-162,106,-32,-7,-7,56,-93,79,-5,-99,180,-189,112,21,-149,209,-171,51,91,-186,186,-91,-51,171,-209,149,-21,-112,189,-180,99,5,-79,93,-56,7,7,32,-106,162,-145,31,150,-325,403,-325,97,205,-462,562,-456,175,175,-456,562,-462,205,97,-325,403,-325,150,31,-145,162,-106,32,7,7,-56,93,-79,5,99,-180,189,-112,-21,149,-209,171,-51,-91,186,-186,91,51,-171,209,-149,21,112,-189,180,-99,-5,79,-93,56,-7,-7,-32,106,-162,145,-31,-150,325,-403,325,-97,-205,462,-562,456,-175,-17260,-17514,-17685,-17770,-17770,-17685,-17514,-17260,-16924,-16508,-16016,-15451,-14817,-14119,-13361,-12549,-11688,-10785,-9845,-8875,-7882,-6872,-5852,-4828,-3807,-2795,-1798,-822,127,1044,1923,2762,3555,4300,4992,5630,6212,6736,7201,7608,7956,8246,8480,8658,8784,8861,8890,8876,8822,8733,8612,8464,8294,8105,7904,7694,7479,7265,7056,6855,6666,6493,6339,6206,6097,6013,5957,5928,5928,5957,6013,6097,6206,6339,6493,6666,6855,7056,7265,7479,7694,7904,8105,8294,8464,8612,8733,8822,8876,8890,8861,8784,8658,8480,8246,7956,7608,7201,6736,6212,5630,4992,4300,3555,2762,1923,1044,127,-822,-1798,-2795,-3807,-4828,-5852,-6872,-7882,-8875,-9845,-10785,-11688,-12549,-13361,-14119,-14817,-15451,-16016,-16508,-16924,-17260,-17514,-17685,-17770,-14591,-14946,-15185,-15306,-15306,-15185,-14946,-14591,-14127,-13558,-12894,-12144,-11319,-10428,-9486,-8504,-7495,-6472,-5448,-4435,-3445,-2489,-1577,-717,83,817,1479,2067,2579,3014,3374,3662,3880,4034,4130,4174,4174,4137,4073,3989,3893,3794,3698,3613,3545,3500,3480,3490,3532,3607,3716,3856,4025,4222,4442,4680,4931,5190,5450,5706,5952,6182,6390,6572,6723,6839,6918,6958,6958,6918,6839,6723,6572,6390,6182,5952,5706,5450,5190,4931,4680,4442,4222,4025,3856,3716,3607,3532,3490,3480,3500,3545,3613,3698,3794,3893,3989,4073,4137,4174,4174,4130,4034,3880,3662,3374,3014,2579,2067,1479,817,83,-717,-1577,-2489,-3445,-4435,-5448,-6472,-7495,-8504,-9486,-10428,-11319,-12144,-12894,-13558,-14127,-14591,-14946,-15185,-15306,-10925,-11467,-11839,-12029,-12029,-11839,-11467,-10925,-10234,-9416,-8500,-7516,-6496,-5472,-4474,-3528,-2657,-1880,-1209,-652,-210,121,350,491,559,572,551,514,480,463,476,529,628,773,963,1191,1450,1729,2016,2299,2565,2805,3009,3172,3288,3359,3386,3374,3329,3262,3182,3098,3023,2963,2927,2921,2947,3006,3096,3211,3347,3494,3644,3787,3915,4018,4091,4129,4129,4091,4018,3915,3787,3644,3494,3347,3211,3096,3006,2947,2921,2927,2963,3023,3098,3182,3262,3329,3374,3386,3359,3288,3172,3009,2805,2565,2299,2016,1729,1450,1191,963,773,628,529,476,463,480,514,551,572,559,491,350,121,-210,-652,-1209,-1880,-2657,-3528,-4474,-5472,-6496,-7516,-8500,-9416,-10234,-10925,-11467,-11839,-12029,-7628,-8407,-8966,-9258,-9258,-8966,-8407,-7628,-6693,-5676,-4652,-3690,-2847,-2161,-1649,-1308,-1115,-1036,-1027,-1042,-1042,-996,-885,-704,-464,-182,116,403,654,851,985,1056,1074,1056,1024,999,999,1037,1119,1241,1393,1561,1727,1872,1984,2054,2081,2069,2030,1979,1931,1902,1902,1936,2004,2099,2208,2318,2413,2481,2514,2510,2472,2409,2334,2260,2202,2170,2170,2202,2260,2334,2409,2472,2510,2514,2481,2413,2318,2208,2099,2004,1936,1902,1902,1931,1979,2030,2069,2081,2054,1984,1872,1727,1561,1393,1241,1119,1037,999,999,1024,1056,1074,1056,985,851,654,403,116,-182,-464,-704,-885,-996,-1042,-1042,-1027,-1036,-1115,-1308,-1649,-2161,-2847,-3690,-4652,-5676,-6693,-7628,-8407,-8966,-9258,-4585,-5604,-6428,-6888,-6888,-6428,-5604,-4585,-3561,-2697,-2092,-1760,-1644,-1637,-1631,-1545,-1351,-1072,-765,-497,-315,-229,-217,-229,-217,-146,-13,161,336,472,549,567,552,537,555,621,728,852,962,1034,1058,1044,1017,1005,1028,1091,1179,1269,1336,1365,1355,1322,1291,1283,1311,1369,1441,1503,1535,1530,1495,1450,1418,1415,1446,1499,1553,1588,1588,1553,1499,1446,1415,1418,1450,1495,1530,1535,1503,1441,1369,1311,1283,1291,1322,1355,1365,1336,1269,1179,1091,1028,1005,1017,1044,1058,1034,962,852,728,621,555,537,552,567,549,472,336,161,-13,-146,-217,-229,-217,-229,-315,-497,-765,-1072,-1351,-1545,-1631,-1637,-1644,-1760,-2092,-2697,-3561,-4585,-5604,-6428,-6888,-2258,-3160,-4184,-4869,-4869,-4184,-3160,-2258,-1761,-1637,-1639,-1535,-1273,-974,-783,-735,-739,-682,-530,-353,-239,-215,-221,-182,-75,50,127,139,130,159,241,337,392,396,384,406,473,549,590,586,573,589,645,707,737,728,711,724,770,822,843,829,810,818,858,901,915,896,873,878,913,949,955,931,905,906,937,966,966,937,906,905,931,955,949,913,878,873,896,915,901,858,818,810,829,843,822,770,724,711,728,737,707,645,589,573,586,590,549,473,406,384,396,392,337,241,159,130,139,127,50,-75,-182,-221,-215,-239,-353,-530,-682,-739,-735,-783,-974,-1273,-1535,-1639,-1637,-1761,-2258,-3160,-4184,-4869,-1529,-1723,-2622,-3646,-3646,-2622,-1723,-1529,-1503,-1217,-952,-923,-874,-683,-562,-563,-497,-358,-305,-307,-230,-132,-116,-107,-29,35,33,55,128,163,156,191,252,264,260,303,348,345,350,396,423,413,428,471,481,470,494,529,524,518,549,571,558,560,592,600,583,594,622,616,602,621,639,623,615,638,644,623,623,644,638,615,623,639,621,602,616,622,594,583,600,592,560,558,571,549,518,524,529,494,470,481,471,428,413,423,396,350,345,348,303,260,264,252,191,156,163,128,55,33,35,-29,-107,-116,-132,-230,-307,-305,-358,-497,-563,-562,-683,-874,-923,-952,-1217,-1503,-1529,-1723,-2622,-3646,-935,-1169,-1256,-2280,-2280,-1256,-1169,-935,-788,-735,-574,-574,-442,-432,-352,-311,-280,-213,-212,-141,-141,-89,-72,-48,-10,-8,39,35,74,81,102,124,127,160,155,187,187,206,219,222,246,240,266,262,279,285,289,306,300,321,314,330,330,335,345,339,356,346,361,356,362,367,361,374,362,376,367,372,372,367,376,362,374,361,367,362,356,361,346,356,339,345,335,330,330,314,321,300,306,289,285,279,262,266,240,246,222,219,206,187,187,155,160,127,124,102,81,74,35,39,-8,-10,-48,-72,-89,-141,-141,-212,-213,-280,-311,-352,-432,-442,-574,-574,-735,-788,-935,-1169,-1256,-2280,-11045,-11619,-12033,-12251,-12251,-12033,-11619,-11045,-10360,-9620,-8874,-8167,-7524,-6953,-6446,-5978,-5511,-5006,-4426,-3745,-2951,-2051,-1069,-45,972,1930,2781,3489,4034,4415,4651,4776,4835,4877,4947,5080,5294,5589,5945,6326,6688,6978,7152,7174,7025,6704,6231,5640,4979,4299,3648,3066,2575,2181,1873,1623,1394,1145,840,453,-26,-589,-1210,-1847,-2448,-2959,-3331,-3528,-3528,-3331,-2959,-2448,-1847,-1210,-589,-26,453,840,1145,1394,1623,1873,2181,2575,3066,3648,4299,4979,5640,6231,6704,7025,7174,7152,6978,6688,6326,5945,5589,5294,5080,4947,4877,4835,4776,4651,4415,4034,3489,2781,1930,972,-45,-1069,-2051,-2951,-3745,-4426,-5006,-5511,-5978,-6446,-6953,-7524,-8167,-8874,-9620,-10360,-11045,-11619,-12033,-12251,-6418,-7272,-8015,-8452,-8452,-8015,-7272,-6418,-5623,-4956,-4371,-3750,-2991,-2066,-1042,-42,822,1507,2045,2514,2967,3399,3741,3903,3841,3587,3241,2917,2675,2481,2225,1790,1126,303,-507,-1106,-1356,-1252,-916,-536,-270,-177,-199,-208,-90,195,590,982,1271,1420,1470,1504,1582,1700,1793,1773,1592,1282,941,676,544,503,437,221,-201,-769,-1318,-1657,-1657,-1318,-769,-201,221,437,503,544,676,941,1282,1592,1773,1793,1700,1582,1504,1470,1420,1271,982,590,195,-90,-208,-199,-177,-270,-536,-916,-1252,-1356,-1106,-507,303,1126,1790,2225,2481,2675,2917,3241,3587,3841,3903,3741,3399,2967,2514,2045,1507,822,-42,-1042,-2066,-2991,-3750,-4371,-4956,-5623,-6418,-7272,-8015,-8452,-3929,-4693,-5552,-6153,-6153,-5552,-4693,-3929,-3314,-2646,-1759,-735,194,892,1419,1886,2273,2458,2376,2120,1833,1549,1192,728,264,-47,-181,-259,-374,-439,-285,99,475,567,370,187,329,784,1216,1301,1029,662,432,330,193,-50,-289,-377,-311,-216,-171,-114,53,312,532,624,645,710,816,827,655,398,255,272,251,-41,-571,-1004,-1004,-571,-41,251,272,255,398,655,827,816,710,645,624,532,312,53,-114,-171,-216,-311,-377,-289,-50,193,330,432,662,1029,1301,1216,784,329,187,370,567,475,99,-285,-439,-374,-259,-181,-47,264,728,1192,1549,1833,2120,2376,2458,2273,1886,1419,892,194,-735,-1759,-2646,-3314,-3929,-4693,-5552,-6153,-2734,-3386,-4247,-5001,-5001,-4247,-3386,-2734,-1987,-963,27,725,1245,1674,1845,1694,1414,1116,717,256,-66,-212,-307,-331,-156,131,336,499,740,913,829,670,675,602,100,-539,-673,-282,23,-23,-51,181,425,476,487,569,559,386,218,130,0,-174,-229,-158,-109,-70,90,295,371,380,470,515,345,153,180,178,-215,-723,-723,-215,178,180,153,345,515,470,380,371,295,90,-70,-109,-158,-229,-174,0,130,218,386,559,569,487,476,425,181,-51,-23,23,-282,-673,-539,100,602,675,670,829,913,740,499,336,131,-156,-331,-307,-212,-66,256,717,1116,1414,1694,1845,1674,1245,725,27,-963,-1987,-2734,-3386,-4247,-5001,-1834,-2524,-3289,-4139,-4139,-3289,-2524,-1834,-810,145,757,1236,1450,1282,1003,654,203,-102,-228,-288,-162,104,302,502,676,640,531,428,178,-31,-50,-144,-155,163,233,-103,-6,502,538,233,156,78,-123,-138,-63,-50,80,244,278,322,344,218,107,38,-100,-152,-85,-66,22,201,243,264,358,239,78,167,-9,-542,-542,-9,167,78,239,358,264,243,201,22,-66,-85,-152,-100,38,107,218,344,322,278,244,80,-50,-63,-138,-123,78,156,233,538,502,-6,-103,233,163,-155,-144,-50,-31,178,428,531,640,676,502,302,104,-162,-288,-228,-102,203,654,1003,1282,1450,1236,757,145,-810,-1834,-2524,-3289,-4139,-1039,-1925,-2598,-3496,-3496,-2598,-1925,-1039,-15,613,1075,1152,902,590,150,-129,-234,-216,22,235,435,558,476,373,161,-31,-85,-141,-2,142,235,418,320,302,276,-318,-409,33,-16,26,239,223,291,246,106,54,-79,-97,-50,-12,131,183,217,222,104,50,-52,-109,-48,-41,95,177,176,266,107,80,97,-417,-417,97,80,107,266,176,177,95,-41,-48,-109,-52,50,104,222,217,183,131,-12,-50,-97,-79,54,106,246,291,223,239,26,-16,33,-409,-318,276,302,320,418,235,142,-2,-141,-85,-31,161,373,476,558,435,235,22,-216,-234,-129,150,590,902,1152,1075,613,-15,-1039,-1925,-2598,-3496,-383,-1407,-2047,-2928,-2928,-2047,-1407,-383,360,841,939,690,351,-41,-184,-208,10,212,407,436,338,170,-25,-87,-103,54,153,299,279,232,99,-27,-33,-96,181,-109,-39,359,106,95,-41,-64,-24,28,150,158,194,88,38,-63,-62,-36,39,126,144,160,60,24,-77,-43,-35,66,126,146,172,18,130,-315,-315,130,18,172,146,126,66,-35,-43,-77,24,60,160,144,126,39,-36,-62,-63,38,88,194,158,150,28,-24,-64,-41,95,106,359,-39,-109,181,-96,-33,-27,99,232,279,299,153,54,-103,-87,-25,170,338,436,407,212,10,-208,-184,-41,351,690,939,841,360,-383,-1407,-2047,-2928,22,-1002,-1731,-2605,-2605,-1731,-1002,22,583,854,626,288,-85,-197,-126,117,312,393,297,117,-46,-103,-24,108,240,249,195,41,-26,-83,36,84,242,139,237,-185,-252,72,-30,161,131,176,56,12,-67,-24,21,111,131,115,39,-27,-55,-29,44,97,131,78,32,-52,-32,-31,87,81,168,20,122,-248,-248,122,20,168,81,87,-31,-32,-52,32,78,131,97,44,-29,-55,-27,39,115,131,111,21,-24,-67,12,56,176,131,161,-30,72,-252,-185,237,139,242,84,36,-83,-26,41,195,249,240,108,-24,-103,-46,117,297,393,312,117,-126,-197,-85,288,626,854,583,22,-1002,-1731,-2605,-23288,-23584,-23805,-23935,-23935,-23805,-23584,-23288,-22923,-22499,-22019,-21489,-20914,-20295,-19638,-18943,-18215,-17455,-16665,-15849,-15008,-14143,-13257,-12351,-11427,-10487,-9532,-8564,-7583,-6593,-5594,-4587,-3574,-2556,-1535,-512,512,1535,2556,3574,4587,5594,6593,7583,8564,9532,10487,11427,12351,13257,14143,15008,15849,16665,17455,18215,18943,19638,20295,20914,21489,22019,22499,22923,23288,23584,23805,23935,23935,23805,23584,23288,22923,22499,22019,21489,20914,20295,19638,18943,18215,17455,16665,15849,15008,14143,13257,12351,11427,10487,9532,8564,7583,6593,5594,4587,3574,2556,1535,512,-512,-1535,-2556,-3574,-4587,-5594,-6593,-7583,-8564,-9532,-10487,-11427,-12351,-13257,-14143,-15008,-15849,-16665,-17455,-18215,-18943,-19638,-20295,-20914,-21489,-22019,-22499,-22923,-23288,-23584,-23805,-23935,-12795,-13401,-13864,-14157,-14157,-13864,-13401,-12795,-12083,-11279,-10406,-9474,-8502,-7498,-6481,-5457,-4444,-3454,-2508,-1621,-852,-205,360,844,1252,1561,1754,1873,1936,1956,1944,1909,1859,1802,1749,1708,1708,1752,1817,1903,2003,2120,2250,2399,2565,2757,2981,3274,3601,3933,4246,4524,4711,4805,4850,4856,4834,4787,4724,4645,4558,4463,4366,4268,4177,4093,4025,3979,3979,4025,4093,4177,4268,4366,4463,4558,4645,4724,4787,4834,4856,4850,4805,4711,4524,4246,3933,3601,3274,2981,2757,2565,2399,2250,2120,2003,1903,1817,1752,1708,1708,1749,1802,1859,1909,1944,1956,1936,1873,1754,1561,1252,844,360,-205,-852,-1621,-2508,-3454,-4444,-5457,-6481,-7498,-8502,-9474,-10406,-11279,-12083,-12795,-13401,-13864,-14157,-5039,-5863,-6517,-6952,-6952,-6517,-5863,-5039,-4112,-3114,-2090,-1074,-110,729,1387,1860,2169,2322,2340,2276,2119,1909,1721,1615,1547,1529,1563,1633,1721,1834,1986,2117,2144,2117,2038,1920,1730,1485,1218,956,722,574,447,292,138,12,-65,-23,72,155,146,62,-92,-303,-525,-721,-864,-1011,-1184,-1285,-1314,-1312,-1286,-1245,-1196,-1144,-1097,-1062,-1062,-1097,-1144,-1196,-1245,-1286,-1312,-1314,-1285,-1184,-1011,-864,-721,-525,-303,-92,62,146,155,72,-23,-65,12,138,292,447,574,722,956,1218,1485,1730,1920,2038,2117,2144,2117,1986,1834,1721,1633,1563,1529,1547,1615,1721,1909,2119,2276,2340,2322,2169,1860,1387,729,-110,-1074,-2090,-3114,-4112,-5039,-5863,-6517,-6952,-3914,-4821,-5558,-6060,-6060,-5558,-4821,-3914,-2925,-1901,-912,-43,608,1045,1288,1369,1333,1213,1085,1029,1026,1088,1203,1393,1585,1746,1821,1844,1773,1634,1500,1355,1186,1085,1019,982,979,1012,1035,1032,947,867,752,575,319,28,-214,-284,-250,-194,-175,-182,-183,-185,-264,-373,-469,-584,-740,-854,-959,-1027,-1029,-1011,-973,-931,-889,-856,-856,-889,-931,-973,-1011,-1029,-1027,-959,-854,-740,-584,-469,-373,-264,-185,-183,-182,-175,-194,-250,-284,-214,28,319,575,752,867,947,1032,1035,1012,979,982,1019,1085,1186,1355,1500,1634,1773,1844,1821,1746,1585,1393,1203,1088,1026,1029,1085,1213,1333,1369,1288,1045,608,-43,-912,-1901,-2925,-3914,-4821,-5558,-6060,-1705,-2714,-3572,-4185,-4185,-3572,-2714,-1705,-681,255,913,1276,1383,1306,1122,959,887,904,991,1133,1227,1227,1131,980,752,532,351,234,170,121,149,120,19,-103,-278,-443,-560,-604,-615,-556,-490,-427,-424,-427,-493,-644,-776,-700,-519,-365,-265,-134,-42,-6,-37,-52,-13,5,63,169,281,380,470,502,495,470,439,411,411,439,470,495,502,470,380,281,169,63,5,-13,-52,-37,-6,-42,-134,-265,-365,-519,-700,-776,-644,-493,-427,-424,-427,-490,-556,-615,-604,-560,-443,-278,-103,19,120,149,121,170,234,351,532,752,980,1131,1227,1227,1133,991,904,887,959,1122,1306,1383,1276,913,255,-681,-1705,-2714,-3572,-4185,-477,-1501,-2421,-3111,-3111,-2421,-1501,-477,430,1008,1213,1156,938,752,679,710,805,857,791,633,385,139,-39,-115,-132,-119,-148,-220,-339,-491,-529,-515,-461,-359,-296,-261,-264,-278,-262,-188,-96,67,182,245,283,210,87,162,298,353,387,412,341,263,154,62,71,69,59,48,-8,-101,-185,-264,-291,-281,-260,-236,-236,-260,-281,-291,-264,-185,-101,-8,48,59,69,71,62,154,263,341,412,387,353,298,162,87,210,283,245,182,67,-96,-188,-262,-278,-264,-261,-296,-359,-461,-515,-529,-491,-339,-220,-148,-119,-132,-115,-39,139,385,633,791,857,805,710,679,752,938,1156,1213,1008,430,-477,-1501,-2421,-3111,-198,-1222,-2181,-2924,-2924,-2181,-1222,-198,570,930,953,787,640,624,714,838,863,762,554,341,194,126,113,99,9,-127,-281,-375,-401,-388,-310,-284,-315,-368,-403,-375,-300,-176,-95,-35,-33,-14,40,104,214,257,177,233,277,239,255,286,293,288,198,110,58,16,5,4,-2,-61,-134,-209,-255,-255,-236,-214,-214,-236,-255,-255,-209,-134,-61,-2,4,5,16,58,110,198,288,293,286,255,239,277,233,177,257,214,104,40,-14,-33,-35,-95,-176,-300,-375,-403,-368,-315,-284,-310,-388,-401,-375,-281,-127,9,99,113,126,194,341,554,762,863,838,714,624,640,787,953,930,570,-198,-1222,-2181,-2924,391,-571,-1595,-2428,-2428,-1595,-571,391,866,914,704,551,548,653,689,572,336,104,-27,-50,-50,-109,-238,-356,-406,-362,-271,-217,-215,-265,-219,-126,-5,94,133,127,125,156,217,263,250,206,151,129,126,124,-36,-31,-63,-129,-134,-138,-140,-173,-216,-238,-164,-101,-46,-30,-26,-24,27,94,159,179,167,147,147,167,179,159,94,27,-24,-26,-30,-46,-101,-164,-238,-216,-173,-140,-138,-134,-129,-63,-31,-36,124,126,129,151,206,250,263,217,156,125,127,133,94,-5,-126,-219,-265,-215,-217,-271,-362,-406,-356,-238,-109,-50,-50,-27,104,336,572,689,653,548,551,704,914,866,391,-571,-1595,-2428,-11878,-12319,-12618,-12770,-12770,-12618,-12319,-11878,-11306,-10615,-9822,-8943,-7997,-7005,-5987,-4963,-3953,-2974,-2044,-1176,-384,325,944,1468,1897,2234,2483,2650,2745,2777,2758,2699,2613,2511,2404,2302,2213,2145,2103,2090,2109,2158,2236,2340,2465,2606,2756,2910,3061,3202,3329,3436,3520,3579,3611,3616,3596,3553,3491,3413,3326,3234,3143,3057,2983,2923,2881,2859,2859,2881,2923,2983,3057,3143,3234,3326,3413,3491,3553,3596,3616,3611,3579,3520,3436,3329,3202,3061,2910,2756,2606,2465,2340,2236,2158,2109,2090,2103,2145,2213,2302,2404,2511,2613,2699,2758,2777,2745,2650,2483,2234,1897,1468,944,325,-384,-1176,-2044,-2974,-3953,-4963,-5987,-7005,-7997,-8943,-9822,-10615,-11306,-11878,-12319,-12618,-12770,-14120,-14675,-15058,-15253,-15253,-15058,-14675,-14120,-13414,-12585,-11663,-10677,-9658,-8634,-7628,-6657,-5734,-4864,-4049,-3283,-2560,-1870,-1203,-552,90,725,1349,1957,2538,3077,3558,3966,4283,4498,4602,4591,4470,4247,3938,3566,3155,2735,2334,1982,1703,1518,1441,1480,1634,1896,2252,2681,3161,3667,4171,4651,5087,5462,5767,5998,6157,6252,6292,6294,6271,6238,6209,6192,6192,6209,6238,6271,6294,6292,6252,6157,5998,5767,5462,5087,4651,4171,3667,3161,2681,2252,1896,1634,1480,1441,1518,1703,1982,2334,2735,3155,3566,3938,4247,4470,4591,4602,4498,4283,3966,3558,3077,2538,1957,1349,725,90,-552,-1203,-1870,-2560,-3283,-4049,-4864,-5734,-6657,-7628,-8634,-9658,-10677,-11663,-12585,-13414,-14120,-14675,-15058,-15253,-11898,-12626,-13145,-13414,-13414,-13145,-12626,-11898,-11013,-10029,-9005,-7992,-7029,-6138,-5325,-4583,-3891,-3226,-2564,-1888,-1194,-487,210,866,1444,1906,2220,2366,2342,2161,1855,1472,1066,695,412,258,258,417,722,1143,1635,2150,2641,3068,3404,3638,3775,3835,3849,3849,3868,3931,4050,4223,4434,4654,4847,4975,5007,4920,4709,4384,3972,3514,3061,2664,2369,2212,2212,2369,2664,3061,3514,3972,4384,4709,4920,5007,4975,4847,4654,4434,4223,4050,3931,3868,3849,3849,3835,3775,3638,3404,3068,2641,2150,1635,1143,722,417,258,258,412,695,1066,1472,1855,2161,2342,2366,2220,1906,1444,866,210,-487,-1194,-1888,-2564,-3226,-3891,-4583,-5325,-6138,-7029,-7992,-9005,-10029,-11013,-11898,-12626,-13145,-13414,-11438,-12308,-12954,-13299,-13299,-12954,-12308,-11438,-10442,-9418,-8447,-7578,-6828,-6176,-5582,-4995,-4375,-3700,-2976,-2238,-1536,-929,-462,-161,-16,10,-19,-30,44,249,595,1058,1581,2086,2495,2741,2792,2652,2365,2004,1657,1409,1324,1433,1729,2168,2686,3209,3672,4032,4278,4427,4517,4598,4711,4879,5098,5334,5534,5638,5591,5366,4965,4432,3838,3275,2837,2596,2596,2837,3275,3838,4432,4965,5366,5591,5638,5534,5334,5098,4879,4711,4598,4517,4427,4278,4032,3672,3209,2686,2168,1729,1433,1324,1409,1657,2004,2365,2652,2792,2741,2495,2086,1581,1058,595,249,44,-30,-19,10,-16,-161,-462,-929,-1536,-2238,-2976,-3700,-4375,-4995,-5582,-6176,-6828,-7578,-8447,-9418,-10442,-11438,-12308,-12954,-13299,-11893,-12837,-13568,-13969,-13969,-13568,-12837,-11893,-10869,-9876,-8975,-8169,-7410,-6632,-5779,-4833,-3831,-2853,-1998,-1355,-967,-814,-818,-862,-825,-621,-221,336,960,1536,1966,2193,2222,2115,1964,1859,1859,1970,2145,2305,2368,2284,2056,1745,1458,1312,1400,1761,2363,3117,3895,4575,5067,5342,5432,5410,5364,5360,5420,5512,5567,5504,5265,4842,4285,3698,3209,2931,2931,3209,3698,4285,4842,5265,5504,5567,5512,5420,5360,5364,5410,5432,5342,5067,4575,3895,3117,2363,1761,1400,1312,1458,1745,2056,2284,2368,2305,2145,1970,1859,1859,1964,2115,2222,2193,1966,1536,960,336,-221,-621,-825,-862,-818,-814,-967,-1355,-1998,-2853,-3831,-4833,-5779,-6632,-7410,-8169,-8975,-9876,-10869,-11893,-12837,-13568,-13969,-8150,-9174,-10117,-10684,-10684,-10117,-9174,-8150,-7312,-6790,-6541,-6401,-6179,-5756,-5120,-4347,-3527,-2714,-1902,-1065,-206,606,1249,1614,1670,1505,1298,1235,1417,1805,2240,2528,2544,2302,1944,1664,1598,1751,1996,2152,2085,1790,1399,1113,1096,1390,1896,2428,2807,2941,2856,2655,2453,2309,2219,2142,2065,2026,2106,2368,2789,3238,3515,3446,2981,2242,1492,1022,1022,1492,2242,2981,3446,3515,3238,2789,2368,2106,2026,2065,2142,2219,2309,2453,2655,2856,2941,2807,2428,1896,1390,1096,1113,1399,1790,2085,2152,1996,1751,1598,1664,1944,2302,2544,2528,2240,1805,1417,1235,1298,1505,1670,1614,1249,606,-206,-1065,-1902,-2714,-3527,-4347,-5120,-5756,-6179,-6401,-6541,-6790,-7312,-8150,-9174,-10117,-10684,-5646,-6670,-7672,-8291,-8291,-7672,-6670,-5646,-4925,-4659,-4787,-5094,-5333,-5344,-5102,-4686,-4201,-3699,-3168,-2564,-1886,-1217,-702,-478,-584,-911,-1243,-1354,-1124,-608,-10,424,532,325,-25,-283,-283,-20,349,598,563,243,-197,-502,-465,-28,691,1466,2077,2416,2515,2505,2525,2649,2865,3122,3394,3725,4206,4906,5790,6686,7339,7524,7173,6432,5622,5100,5100,5622,6432,7173,7524,7339,6686,5790,4906,4206,3725,3394,3122,2865,2649,2525,2505,2515,2416,2077,1466,691,-28,-465,-502,-197,243,563,598,349,-20,-283,-283,-25,325,532,424,-10,-608,-1124,-1354,-1243,-911,-584,-478,-702,-1217,-1886,-2564,-3168,-3699,-4201,-4686,-5102,-5344,-5333,-5094,-4787,-4659,-4925,-5646,-6670,-7672,-8291,-1658,-2370,-3128,-3616,-3616,-3128,-2370,-1658,-1249,-1211,-1403,-1564,-1462,-1015,-322,409,986,1340,1538,1724,2005,2376,2717,2872,2762,2448,2113,1955,2069,2366,2613,2548,2029,1128,104,-719,-1117,-1082,-819,-637,-781,-1305,-2057,-2764,-3182,-3218,-2960,-2607,-2342,-2229,-2194,-2091,-1810,-1356,-852,-456,-254,-189,-90,235,868,1712,2519,3016,3050,2678,2150,1780,1780,2150,2678,3050,3016,2519,1712,868,235,-90,-189,-254,-456,-852,-1356,-1810,-2091,-2194,-2229,-2342,-2607,-2960,-3218,-3182,-2764,-2057,-1305,-781,-637,-819,-1082,-1117,-719,104,1128,2029,2548,2613,2366,2069,1955,2113,2448,2762,2872,2717,2376,2005,1724,1538,1340,986,409,-322,-1015,-1462,-1564,-1403,-1211,-1249,-1658,-2370,-3128,-3616,-11982,-12450,-12913,-13204,-13204,-12913,-12450,-11982,-11627,-11392,-11165,-10789,-10154,-9270,-8261,-7300,-6514,-5911,-5386,-4781,-3990,-3021,-1997,-1089,-421,5,299,624,1094,1709,2352,2860,3119,3132,3019,2949,3042,3305,3626,3846,3854,3656,3374,3175,3182,3398,3709,3953,4017,3900,3720,3640,3776,4125,4570,4942,5123,5109,5011,4992,5163,5521,5945,6269,6373,6254,6028,5856,5856,6028,6254,6373,6269,5945,5521,5163,4992,5011,5109,5123,4942,4570,4125,3776,3640,3720,3900,4017,3953,3709,3398,3182,3175,3374,3656,3854,3846,3626,3305,3042,2949,3019,3132,3119,2860,2352,1709,1094,624,299,5,-421,-1089,-1997,-3021,-3990,-4781,-5386,-5911,-6514,-7300,-8261,-9270,-10154,-10789,-11165,-11392,-11627,-11982,-12450,-12913,-13204,-7496,-8520,-9407,-9925,-9925,-9407,-8520,-7496,-6555,-5823,-5302,-4905,-4519,-4076,-3574,-3062,-2592,-2178,-1789,-1375,-913,-433,-10,276,394,391,375,459,698,1052,1404,1617,1614,1420,1154,968,968,1158,1438,1665,1725,1600,1372,1181,1149,1318,1634,1984,2259,2411,2464,2496,2575,2726,2918,3093,3211,3278,3338,3430,3545,3605,3491,3109,2456,1652,913,470,470,913,1652,2456,3109,3491,3605,3545,3430,3338,3278,3211,3093,2918,2726,2575,2496,2464,2411,2259,1984,1634,1318,1149,1181,1372,1600,1725,1665,1438,1158,968,968,1154,1420,1614,1617,1404,1052,698,459,375,391,394,276,-10,-433,-913,-1375,-1789,-2178,-2592,-3062,-3574,-4076,-4519,-4905,-5302,-5823,-6555,-7496,-8520,-9407,-9925,-9783,-10807,-11664,-12155,-12155,-11664,-10807,-9783,-8783,-7923,-7218,-6603,-5992,-5329,-4612,-3883,-3188,-2551,-1957,-1376,-792,-226,271,647,888,1033,1164,1358,1645,1980,2263,2390,2313,2071,1784,1592,1592,1788,2093,2373,2518,2495,2358,2216,2174,2278,2502,2767,2991,3130,3196,3235,3291,3377,3469,3527,3528,3483,3429,3399,3379,3304,3080,2634,1974,1210,528,125,125,528,1210,1974,2634,3080,3304,3379,3399,3429,3483,3528,3527,3469,3377,3291,3235,3196,3130,2991,2767,2502,2278,2174,2216,2358,2495,2518,2373,2093,1788,1592,1592,1784,2071,2313,2390,2263,1980,1645,1358,1164,1033,888,647,271,-226,-792,-1376,-1957,-2551,-3188,-3883,-4612,-5329,-5992,-6603,-7218,-7923,-8783,-9783,-10807,-11664,-12155,-9318,-10342,-11211,-11714,-11714,-11211,-10342,-9318,-8336,-7505,-6818,-6189,-5518,-4758,-3933,-3122,-2402,-1811,-1325,-886,-446,5,433,796,1078,1315,1578,1928,2368,2818,3146,3230,3028,2618,2171,1883,1883,2174,2635,3077,3333,3333,3122,2828,2585,2476,2499,2593,2685,2738,2762,2799,2874,2974,3040,3009,2850,2590,2300,2049,1855,1661,1361,863,156,-659,-1387,-1818,-1818,-1387,-659,156,863,1361,1661,1855,2049,2300,2590,2850,3009,3040,2974,2874,2799,2762,2738,2685,2593,2499,2476,2585,2828,3122,3333,3333,3077,2635,2174,1883,1883,2171,2618,3028,3230,3146,2818,2368,1928,1578,1315,1078,796,433,5,-446,-886,-1325,-1811,-2402,-3122,-3933,-4758,-5518,-6189,-6818,-7505,-8336,-9318,-10342,-11211,-11714,-8348,-9330,-10117,-10557,-10557,-10117,-9330,-8348,-7324,-6368,-5525,-4787,-4122,-3509,-2947,-2452,-2031,-1668,-1323,-951,-527,-61,403,810,1128,1364,1555,1748,1966,2188,2362,2431,2374,2222,2055,1965,2015,2206,2479,2747,2932,3004,2990,2947,2929,2957,3010,3040,3009,2909,2770,2644,2571,2559,2580,2582,2523,2380,2157,1864,1498,1031,428,-321,-1176,-2030,-2729,-3125,-3125,-2729,-2030,-1176,-321,428,1031,1498,1864,2157,2380,2523,2582,2580,2559,2571,2644,2770,2909,3009,3040,3010,2957,2929,2947,2990,3004,2932,2747,2479,2206,2015,1965,2055,2222,2374,2431,2362,2188,1966,1748,1555,1364,1128,810,403,-61,-527,-951,-1323,-1668,-2031,-2452,-2947,-3509,-4122,-4787,-5525,-6368,-7324,-8348,-9330,-10117,-10557,-5699,-6574,-7222,-7566,-7566,-7222,-6574,-5699,-4697,-3673,-2724,-1923,-1313,-903,-672,-577,-566,-587,-597,-571,-501,-396,-270,-144,-31,61,134,201,275,370,493,644,816,992,1155,1290,1388,1449,1482,1500,1521,1560,1625,1716,1823,1934,2033,2110,2161,2192,2219,2259,2328,2434,2569,2706,2804,2811,2673,2347,1812,1077,184,-792,-1756,-2601,-3230,-3565,-3565,-3230,-2601,-1756,-792,184,1077,1812,2347,2673,2811,2804,2706,2569,2434,2328,2259,2219,2192,2161,2110,2033,1934,1823,1716,1625,1560,1521,1500,1482,1449,1388,1290,1155,992,816,644,493,370,275,201,134,61,-31,-144,-270,-396,-501,-571,-597,-587,-566,-577,-672,-903,-1313,-1923,-2724,-3673,-4697,-5699,-6574,-7222,-7566,-2245,-3174,-3879,-4260,-4260,-3879,-3174,-2245,-1221,-236,590,1176,1484,1526,1353,1043,686,360,125,9,9,98,236,377,487,545,548,512,459,415,396,413,459,520,577,610,610,577,520,459,413,396,415,459,512,548,545,487,377,236,98,9,9,125,360,686,1043,1353,1526,1484,1176,590,-236,-1221,-2245,-3174,-3879,-4260,-4260,-3879,-3174,-2245,-1221,-236,590,1176,1484,1526,1353,1043,686,360,125,9,9,98,236,377,487,545,548,512,459,415,396,413,459,520,577,610,610,577,520,459,413,396,415,459,512,548,545,487,377,236,98,9,9,125,360,686,1043,1353,1526,1484,1176,590,-236,-1221,-2245,-3174,-3879,-4260,-2455,-3479,-4342,-4836,-4836,-4342,-3479,-2455,-1484,-723,-233,14,98,106,99,104,124,154,186,212,212,156,16,-209,-475,-692,-747,-545,-56,672,1520,2345,3029,3512,3797,3923,3923,3797,3512,3029,2345,1520,672,-56,-545,-747,-692,-475,-209,16,156,212,212,186,154,124,104,99,106,98,14,-233,-723,-1484,-2455,-3479,-4342,-4836,-4836,-4342,-3479,-2455,-1484,-723,-233,14,98,106,99,104,124,154,186,212,212,156,16,-209,-475,-692,-747,-545,-56,672,1520,2345,3029,3512,3797,3923,3923,3797,3512,3029,2345,1520,672,-56,-545,-747,-692,-475,-209,16,156,212,212,186,154,124,104,99,106,98,14,-233,-723,-1484,-2455,-3479,-4342,-4836,-24465,-24934,-25303,-25650,-25650,-25303,-24934,-24465,-23963,-23391,-22788,-22130,-21445,-20715,-19962,-19170,-18359,-17515,-16655,-15767,-14865,-13941,-13004,-12049,-11085,-10106,-9119,-8121,-7118,-6106,-5092,-4071,-3051,-2027,-1006,17,1035,2051,3060,4066,5062,6051,7028,7997,8951,9893,10819,11729,12621,13494,14346,15176,15981,16762,17514,18238,18929,19588,20209,20793,21335,21833,22282,22680,23019,23296,23499,23620,23620,23499,23296,23019,22680,22282,21833,21335,20793,20209,19588,18929,18238,17514,16762,15981,15176,14346,13494,12621,11729,10819,9893,8951,7997,7028,6051,5062,4066,3060,2051,1035,17,-1006,-2027,-3051,-4071,-5092,-6106,-7118,-8121,-9119,-10106,-11085,-12049,-13004,-13941,-14865,-15767,-16655,-17515,-18359,-19170,-19962,-20715,-21445,-22130,-22788,-23391,-23963,-24465,-24934,-25303,-25650,-13219,-13414,-13578,-13708,-13781,-13269,-12847,-12321,-11825,-11266,-10725,-10139,-9565,-8958,-8361,-7738,-7125,-6491,-5866,-5225,-4594,-3950,-3316,-2673,-2041,-1401,-773,-141,479,1102,1710,2320,2915,3509,4087,4663,5221,5776,6312,6842,7354,7858,8341,8815,9268,9710,10129,10535,10917,11285,11626,11952,12250,12530,12780,13010,13208,13384,13524,13640,13718,13767,13775,13750,13677,13566,13398,13181,12880,12508,12074,11596,11066,10502,9893,9255,8574,7870,7126,6363,5561,4745,3889,3025,2118,1212,256,-681,-1705,-2536,-2635,-2789,-2931,-3110,-3287,-3492,-3699,-3930,-4163,-4416,-4673,-4947,-5224,-5515,-5809,-6116,-6425,-6743,-7064,-7391,-7720,-8055,-8389,-8727,-9063,-9400,-9735,-10069,-10397,-10723,-11042,-11355,-11659,-11955,-12238,-12509,-12764,-13002,-13219,-13414,-13578,-13708,-23535,-24447,-25205,-26106,-26106,-25205,-24447,-23535,-22674,-21723,-20801,-19819,-18859,-17855,-16869,-15851,-14851,-13827,-12819,-11796,-10789,-9772,-8772,-7767,-6779,-5792,-4822,-3856,-2909,-1970,-1051,-143,745,1617,2468,3300,4111,4899,5665,6405,7121,7808,8471,9101,9706,10275,10817,11319,11794,12224,12627,12980,13305,13575,13817,13997,14150,14232,14288,14264,14214,14072,13909,13632,13346,12906,12495,11801,11801,12495,12906,13346,13632,13909,14072,14214,14264,14288,14232,14150,13997,13817,13575,13305,12980,12627,12224,11794,11319,10817,10275,9706,9101,8471,7808,7121,6405,5665,4899,4111,3300,2468,1617,745,-143,-1051,-1970,-2909,-3856,-4822,-5792,-6779,-7767,-8772,-9772,-10789,-11796,-12819,-13827,-14851,-15851,-16869,-17855,-18859,-19819,-20801,-21723,-22674,-23535,-24447,-25205,-26106,-14958,-15580,-16101,-16732,-16732,-16101,-15580,-14958,-14379,-13744,-13138,-12496,-11879,-11236,-10616,-9979,-9365,-8738,-8134,-7523,-6935,-6344,-5777,-5209,-4666,-4125,-3612,-3101,-2619,-2142,-1696,-1256,-848,-448,-82,275,596,908,1180,1444,1664,1877,2041,2203,2305,2416,2449,3279,4303,5226,6153,7019,7868,8665,9436,10157,10846,11486,12088,12640,13149,13606,14014,14367,14664,14900,15069,15165,15165,15069,14900,14664,14367,14014,13606,13149,12640,12088,11486,10846,10157,9436,8665,7868,7019,6153,5226,4303,3279,2449,2416,2305,2203,2041,1877,1664,1444,1180,908,596,275,-82,-448,-848,-1256,-1696,-2142,-2619,-3101,-3612,-4125,-4666,-5209,-5777,-6344,-6935,-7523,-8134,-8738,-9365,-9979,-10616,-11236,-11879,-12496,-13138,-13744,-14379,-14958,-15580,-16101,-16732,-12888,-13434,-13895,-14463,-14463,-13895,-13434,-12888,-12387,-11844,-11332,-10798,-10288,-9768,-9269,-8769,-8288,-7813,-7355,-6909,-6479,-6065,-5667,-5290,-4927,-4591,-4265,-3973,-3688,-3445,-3201,-3011,-2809,-2682,-2510,-2487,-1964,-940,-68,846,1679,2519,3297,4067,4784,5482,6133,6759,7340,7890,8397,8868,9298,9687,10036,10338,10602,10812,10986,11098,11177,11185,11162,11055,10925,10684,10446,10012,10012,10446,10684,10925,11055,11162,11185,11177,11098,10986,10812,10602,10338,10036,9687,9298,8868,8397,7890,7340,6759,6133,5482,4784,4067,3297,2519,1679,846,-68,-940,-1964,-2487,-2510,-2682,-2809,-3011,-3201,-3445,-3688,-3973,-4265,-4591,-4927,-5290,-5667,-6065,-6479,-6909,-7355,-7813,-8288,-8769,-9269,-9768,-10288,-10798,-11332,-11844,-12387,-12888,-13434,-13895,-14463,-13569,-13655,-13735,-13799,-13825,-13236,-12767,-12209,-11706,-11158,-10651,-10119,-9623,-9114,-8639,-8158,-7711,-7264,-6849,-6441,-6065,-5700,-5367,-5048,-4762,-4494,-4258,-4044,-3861,-3707,-3576,-3497,-3340,-2353,-1381,-428,474,1359,2191,3003,3762,4500,5182,5842,6445,7025,7544,8040,8473,8881,9223,9542,9789,10014,10160,10289,10327,10358,10276,10218,9971,10347,11118,11702,12289,12756,13181,13494,13724,13826,13862,13805,13689,13494,13245,12924,12550,12113,11624,11077,10478,9828,9125,8376,7572,6733,5828,4909,3885,3036,2973,2815,2661,2429,2191,1885,1567,1189,797,347,-115,-633,-1164,-1747,-2341,-2988,-3643,-4350,-5061,-5826,-6591,-7411,-8224,-9097,-9953,-10881,-11764,-12770,-13027,-12966,-13018,-13031,-13094,-13144,-13223,-13297,-13388,-13475,-13569,-13655,-13735,-13799,-13405,-13971,-14453,-15057,-15057,-14453,-13971,-13405,-12897,-12349,-11845,-11321,-10835,-10340,-9882,-9423,-9000,-8582,-8199,-7827,-7490,-7168,-6880,-6612,-6378,-6168,-5991,-5843,-5725,-5627,-4745,-3721,-2795,-1862,-998,-141,651,1430,2147,2847,3483,4102,4656,5190,5657,6105,6481,6839,7121,7388,7568,7744,7814,7906,7828,8069,8984,9749,10509,11175,11805,12352,12849,13267,13622,13896,14094,14203,14203,14094,13896,13622,13267,12849,12352,11805,11175,10509,9749,8984,8069,7828,7906,7814,7744,7568,7388,7121,6839,6481,6105,5657,5190,4656,4102,3483,2847,2147,1430,651,-141,-998,-1862,-2795,-3721,-4745,-5627,-5725,-5843,-5991,-6168,-6378,-6612,-6880,-7168,-7490,-7827,-8199,-8582,-9000,-9423,-9882,-10340,-10835,-11321,-11845,-12349,-12897,-13405,-13971,-14453,-15057,-12208,-12681,-13100,-13654,-13654,-13100,-12681,-12208,-11804,-11395,-11035,-10695,-10392,-10128,-9890,-9710,-9539,-9455,-9344,-9400,-8957,-8016,-7246,-6454,-5755,-5075,-4465,-3894,-3378,-2918,-2501,-2156,-1836,-1616,-1383,-1330,-791,233,1074,1925,2671,3386,4019,4602,5118,5566,5960,6270,6543,6704,6866,6836,7278,8194,8913,9628,10224,10775,11229,11616,11919,12136,12280,12319,12297,12138,11950,11533,11533,11950,12138,12297,12319,12280,12136,11919,11616,11229,10775,10224,9628,8913,8194,7278,6836,6866,6704,6543,6270,5960,5566,5118,4602,4019,3386,2671,1925,1074,233,-791,-1330,-1383,-1616,-1836,-2156,-2501,-2918,-3378,-3894,-4465,-5075,-5755,-6454,-7246,-8016,-8957,-9400,-9344,-9455,-9539,-9710,-9890,-10128,-10392,-10695,-11035,-11395,-11804,-12208,-12681,-13100,-13654,-20923,-21864,-22661,-23685,-23685,-22661,-21864,-20923,-20077,-19154,-18293,-17380,-16516,-15613,-14751,-13861,-13005,-12128,-11282,-10419,-9586,-8740,-7921,-7092,-6290,-5481,-4696,-3908,-3143,-2377,-1633,-890,-170,549,1245,1938,2609,3274,3918,4556,5171,5779,6365,6942,7497,8041,8564,9074,9563,10038,10491,10930,11346,11745,12122,12481,12817,13133,13425,13696,13942,14165,14360,14531,14672,14785,14864,14910,14910,14864,14785,14672,14531,14360,14165,13942,13696,13425,13133,12817,12481,12122,11745,11346,10930,10491,10038,9563,9074,8564,8041,7497,6942,6365,5779,5171,4556,3918,3274,2609,1938,1245,549,-170,-890,-1633,-2377,-3143,-3908,-4696,-5481,-6290,-7092,-7921,-8740,-9586,-10419,-11282,-12128,-13005,-13861,-14751,-15613,-16516,-17380,-18293,-19154,-20077,-20923,-21864,-22661,-23685,-11488,-12034,-12560,-13357,-13539,-12843,-12250,-11488,-10751,-9911,-9081,-8179,-7283,-6333,-5390,-4405,-3428,-2420,-1423,-402,606,1630,2638,3656,4656,5659,6641,7620,8575,9522,10440,11346,12219,13073,13891,14683,15434,16152,16824,17456,18032,18560,19024,19425,19748,19989,20119,20100,19954,19723,19408,19029,18585,18088,17537,16942,16302,15625,14910,14164,13386,12582,11751,10899,10026,9136,8229,7310,6379,5440,4494,3543,2590,1637,687,-258,-1196,-2124,-3038,-3937,-4816,-5674,-6503,-7303,-8066,-8789,-9461,-10077,-10620,-11064,-11371,-11596,-11750,-11855,-11908,-11926,-11906,-11861,-11786,-11695,-11579,-11456,-11313,-11168,-11009,-10854,-10689,-10533,-10371,-10224,-10074,-9945,-9816,-9713,-9614,-9547,-9486,-9465,-9452,-9486,-9531,-9632,-9747,-9928,-10124,-10401,-10691,-11086,-11488,-12034,-12560,-13357,-15902,-16725,-17398,-18143,-18143,-17398,-16725,-15902,-15093,-14194,-13301,-12346,-11397,-10404,-9420,-8404,-7401,-6377,-5369,-4349,-3350,-2348,-1371,-399,543,1472,2364,3234,4061,4857,5600,6301,6936,7514,8006,8414,8674,8796,8824,8776,8660,8489,8266,8000,7693,7353,6980,6582,6159,5718,5259,4789,4307,3821,3329,2839,2351,1870,1400,944,506,92,-294,-647,-958,-1221,-1421,-1547,-1547,-1421,-1221,-958,-647,-294,92,506,944,1400,1870,2351,2839,3329,3821,4307,4789,5259,5718,6159,6582,6980,7353,7693,8000,8266,8489,8660,8776,8824,8796,8674,8414,8006,7514,6936,6301,5600,4857,4061,3234,2364,1472,543,-399,-1371,-2348,-3350,-4349,-5369,-6377,-7401,-8404,-9420,-10404,-11397,-12346,-13301,-14194,-15093,-15902,-16725,-17398,-18143,-12797,-13668,-14382,-15143,-15143,-14382,-13668,-12797,-11932,-10976,-10027,-9022,-8030,-7006,-6004,-4989,-4005,-3026,-2089,-1176,-320,493,1229,1892,2446,2857,3057,3141,3121,3034,2875,2674,2423,2146,1836,1515,1175,838,497,172,-141,-423,-674,-873,-1018,-1078,-1033,-798,-431,24,543,1115,1724,2364,3022,3695,4371,5047,5712,6362,6988,7584,8140,8650,9099,9480,9769,9951,9951,9769,9480,9099,8650,8140,7584,6988,6362,5712,5047,4371,3695,3022,2364,1724,1115,543,24,-431,-798,-1033,-1078,-1018,-873,-674,-423,-141,172,497,838,1175,1515,1836,2146,2423,2674,2875,3034,3121,3141,3057,2857,2446,1892,1229,493,-320,-1176,-2089,-3026,-4005,-4989,-6004,-7006,-8030,-9022,-10027,-10976,-11932,-12797,-13668,-14382,-15143,-11230,-12144,-12895,-13678,-13678,-12895,-12144,-11230,-10321,-9326,-8346,-7322,-6328,-5323,-4367,-3429,-2565,-1753,-1053,-460,-96,63,91,32,-105,-290,-520,-770,-1040,-1306,-1566,-1798,-1995,-2134,-2195,-2148,-1903,-1453,-903,-266,419,1150,1898,2663,3420,4170,4887,5571,6195,6755,7213,7554,7677,7584,7370,7060,6680,6245,5772,5272,4759,4242,3739,3257,2816,2428,2123,1921,1921,2123,2428,2816,3257,3739,4242,4759,5272,5772,6245,6680,7060,7370,7584,7677,7554,7213,6755,6195,5571,4887,4170,3420,2663,1898,1150,419,-266,-903,-1453,-1903,-2148,-2195,-2134,-1995,-1798,-1566,-1306,-1040,-770,-520,-290,-105,32,91,63,-96,-460,-1053,-1753,-2565,-3429,-4367,-5323,-6328,-7322,-8346,-9326,-10321,-11230,-12144,-12895,-13678,-10073,-10189,-10326,-10735,-10783,-9998,-9240,-8309,-7385,-6375,-5388,-4364,-3385,-2409,-1506,-648,94,733,1141,1296,1292,1190,1001,763,480,182,-128,-420,-691,-909,-1060,-1106,-989,-606,-74,562,1260,2008,2778,3560,4332,5084,5793,6446,7015,7476,7776,7805,7632,7344,6960,6515,6020,5500,4964,4435,3922,3453,3038,2715,2514,2553,2807,3169,3617,4115,4651,5200,5752,6285,6789,7239,7623,7904,8062,7989,7660,7192,6618,5970,5266,4527,3768,3006,2256,1536,866,271,-221,-531,-582,-493,-306,-57,238,553,880,1193,1486,1731,1921,2022,2014,1830,1375,729,-25,-876,-1781,-2739,-3714,-4711,-5691,-6661,-7577,-8445,-9207,-9851,-10231,-10426,-10502,-10512,-10456,-10385,-10278,-10198,-10107,-10085,-10073,-10189,-10326,-10735,-10338,-11294,-12084,-12896,-12896,-12084,-11294,-10338,-9390,-8366,-7371,-6353,-5391,-4455,-3611,-2854,-2259,-1919,-1817,-1819,-1930,-2087,-2299,-2519,-2753,-2958,-3137,-3242,-3262,-3122,-2723,-2137,-1462,-707,81,899,1710,2513,3270,3978,4593,5102,5410,5442,5301,5056,4727,4351,3936,3514,3092,2701,2350,2083,1915,1959,2255,2683,3199,3773,4380,5002,5616,6208,6752,7232,7611,7861,7861,7611,7232,6752,6208,5616,5002,4380,3773,3199,2683,2255,1959,1915,2083,2350,2701,3092,3514,3936,4351,4727,5056,5301,5442,5410,5102,4593,3978,3270,2513,1710,899,81,-707,-1462,-2137,-2723,-3122,-3262,-3242,-3137,-2958,-2753,-2519,-2299,-2087,-1930,-1819,-1817,-1919,-2259,-2854,-3611,-4455,-5391,-6353,-7371,-8366,-9390,-10338,-11294,-12084,-12896,-8818,-9842,-10709,-11586,-11586,-10709,-9842,-8818,-7842,-6846,-5978,-5217,-4811,-4713,-4771,-4905,-5077,-5227,-5313,-5263,-4911,-4233,-3444,-2566,-1690,-828,-67,564,859,831,660,401,115,-159,-360,-433,-197,358,1031,1787,2546,3287,3930,4441,4618,4469,4180,3800,3396,3001,2683,2489,2607,3042,3597,4232,4873,5493,6019,6408,6468,6198,5791,5291,4769,4253,3817,3502,3502,3817,4253,4769,5291,5791,6198,6468,6408,6019,5493,4873,4232,3597,3042,2607,2489,2683,3001,3396,3800,4180,4469,4618,4441,3930,3287,2546,1787,1031,358,-197,-433,-360,-159,115,401,660,831,859,564,-67,-828,-1690,-2566,-3444,-4233,-4911,-5263,-5313,-5227,-5077,-4905,-4771,-4713,-4811,-5217,-5978,-6846,-7842,-8818,-9842,-10709,-11586,-2052,-2183,-2314,-2533,-2664,-2708,-2665,-2537,-2327,-2037,-1673,-1238,-738,-179,432,1088,1782,2505,3249,4006,4768,5525,6269,6992,7686,8342,8953,9512,10012,10447,10812,11101,11312,11439,11482,11439,11307,11089,10783,10393,9920,9368,8741,8043,7280,6459,5585,4667,3711,2725,1718,699,-325,-1345,-2352,-3337,-4293,-5212,-6086,-6907,-7669,-8367,-8994,-9546,-10019,-10410,-10715,-10934,-11065,-11109,-11066,-10938,-10728,-10438,-10073,-9638,-9138,-8579,-7968,-7312,-6619,-5896,-5152,-4394,-3633,-2876,-2131,-1408,-715,-59,552,1111,1611,2046,2411,2280,2148,2017,1886,1755,1623,1492,1361,1230,1098,967,836,705,573,442,311,180,48,-83,-214,-346,-477,-608,-739,-871,-1002,-1133,-1264,-1396,-1527,-1658,-1789,-1921,-2052,-2183,-2314,-2533,-2730,-2842,-2953,-2952,-3064,-3063,-2952,-2735,-2415,-2000,-1498,-917,-269,436,1185,1965,2764,3566,4358,5128,5861,6545,7167,7718,8186,8564,8843,9019,9086,9042,8885,8618,8241,7760,7179,6505,5748,4916,4021,3074,2089,1077,53,-970,-1977,-2956,-3894,-4777,-5595,-6336,-6992,-7553,-8014,-8369,-8615,-8748,-8770,-8681,-8485,-8185,-7789,-7303,-6737,-6102,-5407,-4666,-3890,-3095,-2292,-1497,-722,20,714,1350,1916,2402,2798,3098,3294,3383,3361,3228,2982,2627,2166,2055,1944,1832,1721,1610,1499,1387,1276,1165,1053,942,831,720,608,497,386,274,163,52,-60,-171,-282,-393,-505,-616,-727,-839,-950,-1061,-1172,-1284,-1395,-1506,-1618,-1729,-1840,-1951,-2063,-2174,-2285,-2397,-2508,-2619,-2730,-2842,-2953,-2952,-3253,-3312,-3370,-3571,-3629,-3547,-3325,-2971,-2494,-1904,-1217,-448,385,1263,2164,3070,3958,4808,5600,6317,6940,7457,7853,8119,8249,8237,8084,7791,7363,6808,6137,5363,4501,3570,2587,1574,550,-464,-1446,-2377,-3239,-4013,-4684,-5239,-5667,-5960,-6114,-6125,-5995,-5729,-5333,-4817,-4193,-3476,-2684,-1834,-946,-41,861,1739,2572,3341,4028,4618,5095,5449,5670,5753,5695,5494,5155,4684,4089,3382,2577,1690,740,-255,-314,-373,-432,-491,-549,-608,-667,-726,-784,-843,-902,-961,-1019,-1078,-1137,-1196,-1255,-1313,-1372,-1431,-1490,-1548,-1607,-1666,-1725,-1784,-1842,-1901,-1960,-2019,-2077,-2136,-2195,-2254,-2312,-2371,-2430,-2489,-2548,-2606,-2665,-2724,-2783,-2841,-2900,-2959,-3018,-3076,-3135,-3194,-3253,-3312,-3370,-3571,-2499,-2498,-2496,-2694,-2693,-2492,-2099,-1529,-805,47,993,1998,3022,4026,4972,5824,6548,7118,7511,7712,7713,7515,7126,6559,5838,4989,4046,3045,2024,1023,80,-769,-1490,-2057,-2446,-2644,-2643,-2442,-2049,-1479,-755,97,1043,2047,3071,4076,5022,5874,6598,7168,7561,7762,7763,7565,7176,6609,5888,5039,4096,3095,2074,1073,130,-719,-1440,-2007,-2397,-2594,-2593,-2591,-2590,-2588,-2587,-2585,-2584,-2582,-2580,-2579,-2577,-2576,-2574,-2573,-2571,-2570,-2568,-2566,-2565,-2563,-2562,-2560,-2559,-2557,-2556,-2554,-2552,-2551,-2549,-2548,-2546,-2545,-2543,-2541,-2540,-2538,-2537,-2535,-2534,-2532,-2531,-2529,-2527,-2526,-2524,-2523,-2521,-2520,-2518,-2517,-2515,-2513,-2512,-2510,-2509,-2507,-2506,-2504,-2503,-2501,-2499,-2498,-2496,-2694,-1662,-1690,-1719,-1990,-2019,-1806,-1365,-725,75,984,1946,2903,3795,4566,5169,5566,5732,5654,5336,4795,4061,3178,2196,1172,166,-764,-1563,-2185,-2596,-2771,-2702,-2395,-1870,-1161,-311,626,1594,2531,3381,4090,4615,4922,4991,4816,4405,3783,2984,2054,1048,24,-958,-1841,-2575,-3116,-3434,-3512,-3346,-2949,-2346,-1575,-683,274,245,216,187,158,129,100,71,43,14,-15,-44,-73,-102,-131,-160,-189,-217,-246,-275,-304,-333,-362,-391,-420,-448,-477,-506,-535,-564,-593,-622,-651,-680,-708,-737,-766,-795,-824,-853,-882,-911,-939,-968,-997,-1026,-1055,-1084,-1113,-1142,-1171,-1199,-1228,-1257,-1286,-1315,-1344,-1373,-1402,-1430,-1459,-1488,-1517,-1546,-1575,-1604,-1633,-1662,-1690,-1719,-1990,-895,-901,-907,-1302,-1308,-924,-209,726,1739,2674,3389,3773,3767,3372,2646,1700,676,-271,-997,-1392,-1398,-1014,-299,636,1649,2584,3299,3683,3677,3282,2556,1610,586,-361,-1087,-1482,-1488,-1104,-389,546,1559,2494,3209,3593,3587,3192,2466,1520,496,-451,-457,-462,-468,-473,-479,-485,-490,-496,-502,-507,-513,-518,-524,-530,-535,-541,-547,-552,-558,-563,-569,-575,-580,-586,-592,-597,-603,-608,-614,-620,-625,-631,-637,-642,-648,-653,-659,-665,-670,-676,-682,-687,-693,-698,-704,-710,-715,-721,-727,-732,-738,-743,-749,-755,-760,-766,-772,-777,-783,-788,-794,-800,-805,-811,-817,-822,-828,-833,-839,-845,-850,-856,-862,-867,-873,-878,-884,-890,-895,-901,-907,-1302,39,44,50,-665,-659,67,1091,1817,1822,1108,95,-620,-614,112,1136,1862,1867,1153,140,-575,-569,157,1181,1907,1912,1198,185,-530,-524,202,1226,1952,1957,1243,230,-485,-479,-473,-468,-462,-456,-451,-445,-440,-434,-428,-423,-417,-411,-406,-400,-395,-389,-383,-378,-372,-366,-361,-355,-350,-344,-338,-333,-327,-321,-316,-310,-305,-299,-293,-288,-282,-276,-271,-265,-260,-254,-248,-243,-237,-231,-226,-220,-214,-209,-203,-198,-192,-186,-181,-175,-169,-164,-158,-153,-147,-141,-136,-130,-124,-119,-113,-108,-102,-96,-91,-85,-79,-74,-68,-63,-57,-51,-46,-40,-34,-29,-23,-18,-12,-6,-1,5,11,16,22,27,33,39,44,50,-665,96,96,96,-928,-928,96,96,-928,-928,96,96,-928,-928,96,96,-928,-928,96,96,-928,-928,96,96,-928,-928,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,96,-928,-3776,-3851,-3919,-3983,-4046,-3936,-3660,-3229,-2654,-1952,-1142,-244,719,1724,2748,3767,4757,5696,6564,7341,8011,8561,8978,9255,9387,9373,9214,8915,8484,7931,7270,6515,5683,4792,3861,2910,1959,1027,132,-709,-1480,-2166,-2757,-3244,-3618,-3876,-4017,-4041,-3952,-3756,-3461,-3077,-2617,-2092,-1518,-910,-283,347,966,1559,2112,2612,3050,3417,3703,3906,4020,4046,3983,3835,3606,3302,2930,2501,2023,1508,967,410,-150,-702,-1237,-1744,-2215,-2642,-3019,-3341,-3604,-3807,-3949,-4031,-4056,-4027,-3948,-3825,-3665,-3474,-3259,-3029,-2791,-2551,-2318,-2097,-1894,-1714,-1561,-1439,-1349,-1293,-1271,-1282,-1324,-1397,-1496,-1618,-1759,-1915,-2083,-2257,-2434,-2610,-2782,-2946,-3101,-3244,-3375,-3494,-3599,-3693,-3776,-3851,-3919,-3983,-2399,-2422,-2454,-2492,-2532,-2327,-1893,-1256,-453,474,1475,2499,3494,4411,5205,5837,6278,6508,6518,6308,5892,5290,4534,3660,2712,1734,772,-129,-929,-1593,-2094,-2412,-2538,-2471,-2220,-1804,-1246,-580,158,930,1696,2416,3055,3582,3972,4208,4279,4185,3931,3531,3007,2385,1696,972,247,-445,-1074,-1613,-2040,-2340,-2503,-2528,-2418,-2184,-1845,-1420,-935,-417,106,607,1060,1443,1738,1932,2016,1989,1853,1618,1295,903,460,-12,-491,-955,-1385,-1762,-2073,-2308,-2460,-2528,-2513,-2423,-2267,-2058,-1812,-1542,-1267,-1001,-759,-554,-394,-288,-239,-247,-311,-425,-582,-774,-989,-1217,-1448,-1672,-1880,-2065,-2222,-2348,-2441,-2503,-2537,-2546,-2536,-2512,-2481,-2449,-2419,-2397,-2386,-2386,-2399,-2422,-2454,-2492,-1722,-1771,-1810,-1841,-1870,-1582,-1009,-207,750,1774,2774,3663,4364,4818,4987,4859,4448,3792,2947,1988,995,53,-763,-1387,-1771,-1891,-1742,-1345,-741,11,843,1678,2444,3073,3513,3726,3697,3431,2953,2305,1545,737,-51,-756,-1320,-1702,-1875,-1832,-1585,-1161,-603,34,694,1315,1844,2235,2456,2491,2337,2012,1545,978,358,-262,-831,-1306,-1650,-1841,-1870,-1742,-1475,-1098,-650,-174,286,690,1001,1195,1257,1183,983,676,289,-143,-585,-1001,-1359,-1633,-1807,-1873,-1831,-1694,-1480,-1213,-921,-633,-376,-172,-39,14,-14,-121,-293,-515,-767,-1027,-1275,-1494,-1669,-1791,-1857,-1868,-1831,-1757,-1657,-1546,-1437,-1343,-1272,-1230,-1219,-1239,-1285,-1350,-1428,-1510,-1590,-1661,-1722,-1771,-1810,-1841,-1113,-1158,-1190,-1213,-1232,-785,31,1052,2076,2904,3378,3410,2997,2222,1234,223,-624,-1150,-1265,-957,-297,580,1500,2283,2778,2894,2611,1987,1144,242,-548,-1084,-1270,-1083,-569,164,969,1686,2178,2353,2180,1696,996,215,-502,-1022,-1255,-1167,-786,-195,486,1121,1587,1796,1712,1353,792,137,-490,-973,-1228,-1217,-953,-497,56,594,1013,1232,1213,963,532,6,-518,-944,-1197,-1240,-1076,-745,-321,110,461,667,690,529,219,-180,-591,-941,-1170,-1243,-1158,-941,-643,-328,-60,110,151,59,-145,-420,-713,-973,-1155,-1235,-1207,-1088,-910,-715,-544,-431,-395,-441,-555,-714,-887,-1043,-1159,-1222,-1229,-1191,-1124,-1050,-987,-949,-942,-964,-1007,-1061,-1113,-1158,-1190,-1213,-794,-833,-862,-881,-895,-315,651,1669,2393,2582,2175,1314,290,-557,-951,-773,-96,840,1712,2227,2213,1680,811,-103,-760,-949,-622,99,961,1668,1983,1803,1194,362,-414,-881,-895,-465,253,1007,1540,1676,1372,735,-19,-642,-933,-807,-321,350,974,1339,1325,942,321,-328,-795,-932,-707,-210,382,865,1077,950,531,-36,-563,-881,-895,-614,-146,344,687,770,569,157,-329,-727,-915,-842,-547,-139,236,451,437,203,-168,-554,-829,-914,-792,-519,-197,63,171,96,-132,-435,-713,-881,-895,-764,-544,-319,-166,-136,-233,-422,-638,-813,-898,-877,-772,-629,-503,-437,-451,-535,-658,-779,-864,-896,-878,-829,-775,-740,-735,-757,-794,-833,-862,-881,-781,-770,-766,-773,-785,-142,870,1816,2294,2106,1336,312,-537,-862,-541,276,1231,1917,2046,1566,687,-223,-784,-774,-212,651,1443,1826,1644,978,112,-593,-849,-562,131,926,1483,1568,1151,411,-340,-791,-766,-291,420,1060,1356,1188,631,-77,-641,-835,-590,-26,609,1042,1092,743,147,-446,-794,-762,-380,177,668,884,737,295,-254,-682,-821,-626,-194,281,595,618,345,-105,-543,-793,-763,-480,-77,268,410,292,-30,-419,-716,-808,-669,-374,-58,144,147,-43,-345,-631,-789,-768,-590,-344,-141,-65,-146,-343,-573,-744,-795,-721,-566,-407,-312,-321,-423,-572,-708,-783,-778,-711,-623,-557,-541,-577,-645,-716,-765,-784,-781,-770,-766,-773,-605,-636,-663,-679,-690,3,1027,1845,2034,1501,527,-386,-776,-455,393,1318,1839,1690,952,10,-654,-710,-145,734,1464,1668,1245,419,-385,-759,-525,179,977,1453,1363,760,-43,-635,-721,-275,459,1092,1297,972,291,-396,-741,-581,-16,651,1070,1026,549,-113,-621,-725,-388,202,730,922,684,144,-420,-723,-624,-191,340,690,679,319,-200,-615,-723,-483,-36,379,545,381,-22,-457,-706,-655,-347,46,315,324,72,-306,-618,-715,-563,-255,39,166,65,-208,-510,-693,-676,-485,-232,-53,-39,-192,-430,-631,-704,-627,-455,-287,-212,-265,-412,-578,-683,-687,-604,-491,-413,-408,-473,-572,-656,-691,-677,-635,-599,-588,-605,-636,-663,-679,-362,-359,-376,-390,-396,561,1286,887,-137,-529,173,1084,1078,169,-522,-160,786,1141,473,-390,-396,439,1072,723,-169,-512,97,888,881,94,-504,-193,622,927,352,-390,-396,318,858,559,-202,-494,22,691,685,19,-486,-225,458,712,230,-390,-396,197,643,395,-235,-476,-53,494,488,-56,-469,-258,294,498,109,-390,-396,75,429,231,-267,-459,-128,298,292,-131,-451,-291,130,284,-12,-390,-396,-46,215,67,-300,-441,-203,101,95,-207,-433,-323,-34,70,-134,-390,-396,-167,1,-96,-332,-423,-279,-95,-101,-282,-416,-356,-198,-144,-255,-390,-396,-289,-213,-260,-365,-406,-354,-292,-298,-357,-398,-389,-362,-359,-376,-390,-5054,-5064,-5079,-5103,-5185,-5080,-4798,-4355,-3766,-3051,-2229,-1324,-356,651,1675,2694,3689,4639,5528,6341,7065,7689,8206,8611,8901,9076,9138,9091,8942,8700,8372,7971,7507,6992,6440,5861,5269,4673,4086,3516,2971,2460,1988,1559,1177,844,559,323,133,-13,-119,-189,-227,-240,-230,-205,-169,-127,-82,-40,-3,26,44,52,46,29,-1,-42,-93,-153,-219,-289,-361,-433,-503,-570,-631,-684,-731,-768,-797,-818,-832,-838,-839,-836,-832,-827,-825,-827,-835,-853,-881,-921,-975,-1044,-1128,-1229,-1345,-1478,-1625,-1786,-1960,-2144,-2337,-2537,-2741,-2947,-3152,-3354,-3550,-3739,-3918,-4086,-4241,-4383,-4509,-4621,-4717,-4798,-4865,-4919,-4960,-4991,-5013,-5028,-5039,-5046,-5054,-5064,-5079,-5103,-1700,-1736,-1781,-1830,-1860,-1471,-740,212,1236,2183,2924,3370,3485,3286,2837,2242,1617,1078,716,588,705,1037,1514,2044,2525,2868,3005,2904,2572,2051,1412,744,136,-334,-611,-674,-532,-225,186,628,1029,1330,1490,1498,1364,1124,825,524,270,104,48,102,249,456,682,883,1021,1072,1022,879,662,400,129,-117,-311,-435,-482,-458,-381,-272,-156,-57,7,28,3,-60,-150,-250,-346,-423,-473,-494,-489,-465,-433,-403,-385,-386,-410,-454,-514,-585,-659,-728,-789,-839,-878,-908,-934,-958,-984,-1014,-1049,-1086,-1123,-1156,-1183,-1203,-1214,-1220,-1222,-1226,-1236,-1254,-1284,-1325,-1375,-1430,-1486,-1538,-1582,-1615,-1636,-1647,-1652,-1655,-1661,-1676,-1700,-1736,-1781,-1830,-1133,-1152,-1199,-1256,-1276,-703,256,1280,2054,2371,2199,1675,1052,599,502,801,1384,2026,2481,2564,2221,1543,729,17,-400,-435,-129,368,859,1168,1203,979,607,247,45,85,358,771,1182,1453,1498,1306,946,534,191,3,-3,133,328,488,543,469,295,86,-85,-158,-114,27,214,382,480,486,407,278,144,43,-8,-11,11,30,23,-20,-90,-171,-241,-285,-300,-292,-274,-260,-259,-268,-282,-292,-291,-282,-273,-276,-301,-350,-417,-487,-543,-574,-577,-560,-541,-538,-563,-618,-693,-766,-817,-832,-808,-759,-705,-672,-677,-724,-804,-893,-968,-1009,-1009,-977,-933,-902,-904,-945,-1020,-1108,-1187,-1236,-1246,-1222,-1182,-1146,-1133,-1152,-1199,-1256,-1365,-1391,-1419,-1445,-1468,-1004,-169,855,1862,2670,3154,3270,3054,2602,2041,1494,1050,748,582,509,473,430,361,283,237,272,429,718,1109,1536,1910,2139,2155,1933,1496,920,311,-217,-565,-677,-545,-215,230,690,1069,1300,1355,1247,1023,747,484,279,155,105,103,115,108,70,3,-70,-119,-115,-41,96,272,445,567,600,521,337,75,-215,-477,-662,-738,-696,-556,-357,-148,22,118,124,46,-92,-255,-409,-526,-594,-616,-605,-583,-570,-577,-608,-653,-697,-726,-726,-696,-644,-587,-546,-540,-581,-669,-792,-931,-1059,-1154,-1200,-1192,-1139,-1058,-973,-906,-874,-886,-938,-1019,-1112,-1201,-1272,-1318,-1340,-1345,-1342,-1341,-1348,-1365,-1391,-1419,-1445,-5683,-5796,-5904,-6002,-6095,-5744,-5033,-4089,-3065,-2115,-1370,-921,-805,-1006,-1456,-2051,-2665,-3177,-3480,-3504,-3222,-2652,-1854,-917,54,954,1695,2216,2492,2537,2397,2143,1858,1628,1522,1589,1847,2284,2863,3521,4191,4800,5289,5618,5767,5745,5583,5328,5036,4766,4566,4471,4496,4637,4868,5153,5445,5697,5868,5929,5866,5684,5400,5045,4659,4280,3944,3676,3490,3385,3348,3356,3378,3382,3341,3233,3046,2782,2450,2070,1668,1271,903,584,325,129,-12,-112,-190,-268,-366,-500,-680,-908,-1179,-1480,-1796,-2108,-2400,-2656,-2868,-3032,-3153,-3238,-3300,-3354,-3415,-3495,-3601,-3736,-3900,-4084,-4279,-4474,-4656,-4816,-4946,-5046,-5114,-5159,-5186,-5206,-5229,-5263,-5313,-5383,-5470,-5573,-5683,-5796,-5904,-6002,-1269,-1284,-1283,-1281,-1300,-750,180,1204,2042,2511,2572,2322,1933,1580,1363,1285,1267,1195,989,643,235,-107,-258,-150,194,667,1123,1426,1510,1391,1161,938,818,833,938,1037,1024,835,480,45,-339,-548,-505,-219,226,699,1066,1242,1208,1015,751,505,335,246,201,146,42,-114,-286,-409,-425,-304,-66,227,489,643,648,513,290,53,-129,-223,-232,-198,-174,-200,-286,-409,-520,-568,-524,-389,-203,-24,91,107,21,-136,-315,-470,-569,-611,-615,-612,-627,-669,-724,-767,-770,-719,-621,-503,-406,-364,-396,-497,-641,-790,-908,-976,-991,-973,-945,-932,-942,-971,-1003,-1021,-1012,-977,-930,-892,-883,-914,-981,-1069,-1157,-1227,-1269,-1284,-1283,-1281,-600,-621,-601,-582,-591,433,1242,1029,394,386,1048,1414,875,-15,-310,132,603,575,312,352,719,956,791,444,241,203,171,138,230,418,505,430,394,532,641,440,29,-150,106,449,426,105,-5,327,694,583,78,-227,-12,362,360,-1,-200,63,463,496,142,-145,-58,191,215,-21,-193,-84,149,221,94,-34,-31,24,4,-76,-116,-97,-83,-92,-69,-7,6,-87,-197,-192,-95,-71,-191,-315,-267,-94,-23,-156,-327,-322,-169,-102,-237,-413,-410,-244,-142,-233,-391,-413,-295,-220,-300,-439,-472,-386,-315,-351,-435,-460,-415,-383,-413,-468,-492,-484,-481,-494,-503,-500,-508,-533,-550,-541,-531,-554,-600,-621,-601,-582,-420,-374,-394,-443,-450,574,805,203,361,1154,994,33,-148,412,358,-184,25,778,839,319,274,587,382,-129,-100,309,376,210,337,574,465,183,111,148,87,59,174,277,305,340,322,174,69,114,108,-12,33,266,311,118,90,256,186,-105,-112,159,175,-54,-2,282,233,-91,-107,141,89,-191,-131,176,156,-115,-89,147,69,-216,-188,56,24,-187,-131,84,29,-191,-176,-18,-73,-239,-193,-38,-67,-195,-171,-78,-130,-241,-225,-154,-177,-231,-206,-165,-191,-233,-235,-235,-257,-264,-258,-266,-270,-253,-259,-300,-311,-286,-301,-351,-347,-299,-310,-368,-364,-317,-340,-408,-403,-352,-371,-430,-420,-374,-394,-443,-6257,-6312,-6374,-6443,-6550,-5920,-5032,-4051,-3036,-2012,-992,16,1008,1982,2934,3864,4770,5650,6504,7328,8117,8863,9534,10022,10293,10480,10618,10704,10711,10559,10240,9794,9192,8502,7783,7057,6334,5619,4917,4232,3571,2952,2445,2095,1802,1532,1276,1032,797,571,355,150,-39,-198,-295,-332,-343,-337,-303,-210,-60,59,79,64,37,5,-31,-70,-112,-156,-202,-251,-301,-354,-410,-467,-527,-590,-660,-744,-816,-820,-800,-776,-757,-750,-770,-840,-946,-1066,-1192,-1321,-1452,-1584,-1716,-1850,-1985,-2123,-2268,-2433,-2650,-2888,-3128,-3365,-3590,-3804,-4013,-4217,-4418,-4615,-4809,-4997,-5179,-5350,-5499,-5619,-5723,-5818,-5899,-5946,-5978,-6005,-6033,-6063,-6095,-6130,-6168,-6210,-6257,-6312,-6374,-6443,-2471,-2554,-2630,-2678,-2719,-1835,-832,192,1207,2198,3140,3896,3934,3714,3455,3181,2901,2621,2381,2458,2616,2830,3038,3238,3425,3573,3398,3102,2517,1838,1161,501,-120,-522,-707,-724,-349,122,601,1066,1438,1567,1662,1714,1528,1291,1053,849,871,915,939,899,1024,1170,1296,1231,1113,988,856,694,361,20,-200,-318,-421,-508,-550,-511,-319,-160,-134,-121,-112,-107,-108,-144,-281,-300,-305,-311,-320,-339,-388,-426,-477,-546,-617,-688,-758,-827,-894,-929,-991,-1054,-1117,-1178,-1237,-1286,-1345,-1430,-1461,-1487,-1512,-1536,-1559,-1570,-1514,-1494,-1516,-1543,-1573,-1606,-1649,-1759,-1883,-1967,-2022,-2074,-2123,-2168,-2177,-2163,-2153,-2180,-2224,-2271,-2320,-2383,-2471,-2554,-2630,-2678,-1639,-1713,-1777,-1781,-1808,-857,167,1187,2158,2601,2410,2173,1925,1695,1905,2485,2766,2986,3156,2879,2190,1407,636,-76,-364,-417,-146,389,933,1123,1230,1007,769,600,732,898,1356,1806,1984,1844,1666,1254,768,452,290,150,111,266,235,202,250,277,92,111,169,231,304,563,636,677,681,599,378,274,182,94,9,-48,-127,-206,-280,-339,-325,-304,-287,-271,-259,-296,-307,-299,-291,-281,-198,-166,-215,-271,-333,-494,-660,-721,-774,-819,-759,-690,-710,-721,-737,-851,-969,-1001,-1012,-1012,-924,-835,-794,-812,-861,-991,-1123,-1238,-1281,-1302,-1259,-1215,-1179,-1208,-1269,-1364,-1455,-1541,-1575,-1559,-1517,-1477,-1442,-1430,-1490,-1563,-1639,-1713,-1777,-1781,-1772,-1783,-1769,-1762,-1790,-848,173,1197,2198,3138,3592,3912,4091,3492,2638,1829,1442,1099,775,470,196,-24,64,256,463,675,904,1442,2037,2572,2766,2623,2378,1809,1218,634,70,-453,-739,-538,-117,330,773,1193,1377,1469,1518,1354,1077,698,542,412,288,171,61,-37,-149,-188,-152,-106,-50,151,415,661,759,791,733,466,176,-114,-395,-660,-843,-756,-636,-459,-267,-84,2,13,7,-95,-243,-392,-464,-523,-580,-635,-687,-734,-795,-849,-892,-903,-906,-854,-747,-646,-607,-611,-628,-738,-884,-1032,-1176,-1314,-1422,-1390,-1342,-1290,-1231,-1165,-1130,-1146,-1169,-1228,-1317,-1404,-1441,-1472,-1507,-1542,-1575,-1607,-1646,-1681,-1715,-1747,-1772,-1783,-1769,-1762,-5427,-5514,-5568,-5621,-5708,-4878,-3911,-2896,-1872,-863,97,825,582,103,-397,-889,-1362,-1802,-2147,-1946,-1281,-507,270,1031,1767,2448,2769,2892,2642,2329,2011,1702,1417,1290,1398,1591,2085,2608,3123,3619,4047,4232,4372,4415,4212,3988,3765,3566,3552,3577,3617,3773,4091,4413,4716,4897,4997,5075,5119,4994,4736,4435,4138,3912,3679,3443,3218,3146,3126,3093,2971,2836,2699,2556,2395,2088,1758,1490,1243,1000,761,528,321,242,150,30,-92,-212,-334,-459,-610,-854,-1070,-1282,-1493,-1700,-1904,-2102,-2263,-2375,-2484,-2590,-2695,-2800,-2904,-3011,-3144,-3318,-3493,-3667,-3838,-4007,-4171,-4334,-4452,-4538,-4615,-4682,-4737,-4781,-4817,-4842,-4914,-4998,-5082,-5167,-5251,-5336,-5427,-5514,-5568,-5621,-1380,-1399,-1418,-1437,-1459,-493,531,1545,2500,2914,3058,2695,2278,1671,1328,1006,776,988,866,637,409,217,307,509,707,904,1092,1122,927,1013,1122,989,1117,1272,1406,1329,1098,576,58,-400,-599,-426,-3,430,854,1243,1350,1376,1191,815,500,374,261,172,210,52,-130,-250,-221,-158,-3,145,289,424,427,342,261,99,-58,-45,-19,4,-26,-132,-363,-513,-589,-645,-543,-365,-185,-12,137,140,38,-151,-343,-467,-520,-567,-608,-615,-714,-746,-752,-754,-737,-659,-584,-513,-450,-478,-597,-712,-819,-916,-931,-940,-949,-969,-1019,-1063,-1099,-1132,-1160,-1120,-1060,-1002,-950,-923,-993,-1072,-1161,-1247,-1294,-1323,-1350,-1374,-1380,-1399,-1418,-1437,-649,-707,-760,-745,-756,268,1253,1090,876,1158,1393,1354,590,-276,-571,112,429,649,597,852,1314,1071,797,522,281,58,225,433,663,846,657,556,461,514,322,-205,-325,125,588,659,446,434,645,825,426,-13,-355,-55,318,184,-12,43,359,502,363,17,-78,60,135,183,39,95,204,210,139,49,-20,-94,-150,-114,13,49,-63,-44,-62,48,-5,-221,-313,-217,-38,-22,-156,-267,-111,0,-118,-298,-460,-365,-238,-249,-365,-399,-280,-166,-200,-341,-377,-363,-341,-342,-429,-427,-418,-412,-423,-464,-488,-514,-540,-559,-494,-494,-525,-542,-542,-491,-509,-590,-664,-663,-617,-618,-679,-736,-696,-655,-649,-707,-760,-745,-503,-465,-469,-506,-514,510,730,529,1093,1415,845,-71,-233,5,99,-90,355,1062,1099,600,446,249,-99,-126,177,406,538,715,636,439,198,8,-145,-8,285,439,321,406,549,398,-33,-162,123,223,56,181,546,423,49,86,239,-84,-263,66,382,206,16,181,317,1,-277,-50,182,16,-23,234,205,-60,-122,15,-38,-192,-148,65,92,-57,-94,3,-50,-169,-166,-121,-102,-87,-63,-88,-127,-163,-196,-225,-208,-192,-193,-181,-116,-142,-266,-294,-218,-222,-315,-306,-201,-197,-310,-327,-258,-291,-396,-349,-263,-330,-406,-336,-278,-367,-454,-402,-343,-408,-468,-408,-361,-430,-468,-430,-437,-496,-503,-465,-469,-506,-30208,-31232,-32256,-31264,-30271,-29279,-28286,-27294,-26301,-25309,-24316,-23324,-22331,-21339,-20346,-19354,-18361,-17369,-16376,-15384,-14391,-13399,-12406,-11414,-10421,-9429,-8436,-7444,-6451,-5459,-4466,-3474,-2481,-1489,-496,496,1489,2481,3474,4466,5459,6451,7444,8436,9429,10421,11414,12406,13399,14391,15384,16376,17369,18361,19354,20346,21339,22331,23324,24316,25309,26301,27294,28286,29279,30271,31264,32256,31232,30208,29184,28160,27136,26112,25088,24064,23040,22016,20992,19968,18944,17920,16896,15872,14848,13824,12800,11776,10752,9728,8704,7680,6656,5632,4608,3584,2560,1536,512,-512,-1536,-2560,-3584,-4608,-5632,-6656,-7680,-8704,-9728,-10752,-11776,-12800,-13824,-14848,-15872,-16896,-17920,-18944,-19968,-20992,-22016,-23040,-24064,-25088,-26112,-27136,-28160,-29184,-30208,-31232,-32256,-31264,-25689,-26412,-27136,-26112,-25088,-24064,-23040,-22016,-20992,-19968,-18944,-17920,-16896,-15872,-14848,-13824,-12800,-11776,-10752,-9728,-8704,-7680,-6656,-5632,-4608,-3584,-2560,-1536,-512,512,1536,2560,3584,4608,5632,6656,7680,8704,9728,10752,11776,12800,13824,14848,15872,16896,17920,18944,19968,20992,22016,23040,24064,25088,26112,27136,26412,25689,24965,24241,23518,22794,22071,21347,20623,19900,19176,18452,17729,17005,16282,15558,14834,14111,13387,12663,11940,11216,10493,9769,9045,8322,7598,6874,6151,5427,4704,3980,3256,2533,1809,1085,362,-362,-1085,-1809,-2533,-3256,-3980,-4704,-5427,-6151,-6874,-7598,-8322,-9045,-9769,-10493,-11216,-11940,-12663,-13387,-14111,-14834,-15558,-16282,-17005,-17729,-18452,-19176,-19900,-20623,-21347,-22071,-22794,-23518,-24241,-24965,-25689,-26412,-27136,-26112,-21455,-21992,-22528,-21504,-20480,-19456,-18432,-17408,-16384,-15360,-14336,-13312,-12288,-11264,-10240,-9216,-8192,-7168,-6144,-5120,-4096,-3072,-2048,-1024,0,1024,2048,3072,4096,5120,6144,7168,8192,9216,10240,11264,12288,13312,14336,15360,16384,17408,18432,19456,20480,21504,22528,21992,21455,20919,20382,19846,19310,18773,18237,17701,17164,16628,16091,15555,15019,14482,13946,13410,12873,12337,11800,11264,10728,10191,9655,9118,8582,8046,7509,6973,6437,5900,5364,4827,4291,3755,3218,2682,2146,1609,1073,536,0,-536,-1073,-1609,-2146,-2682,-3218,-3755,-4291,-4827,-5364,-5900,-6437,-6973,-7509,-8046,-8582,-9118,-9655,-10191,-10728,-11264,-11800,-12337,-12873,-13410,-13946,-14482,-15019,-15555,-16091,-16628,-17164,-17701,-18237,-18773,-19310,-19846,-20382,-20919,-21455,-21992,-22528,-21504,-16185,-16540,-16896,-15872,-14848,-13824,-12800,-11776,-10752,-9728,-8704,-7680,-6656,-5632,-4608,-3584,-2560,-1536,-512,512,1536,2560,3584,4608,5632,6656,7680,8704,9728,10752,11776,12800,13824,14848,15872,16896,16540,16185,15829,15473,15117,14762,14406,14050,13695,13339,12983,12628,12272,11916,11560,11205,10849,10493,10138,9782,9426,9070,8715,8359,8003,7648,7292,6936,6581,6225,5869,5513,5158,4802,4446,4091,3735,3379,3023,2668,2312,1956,1601,1245,889,534,178,-178,-534,-889,-1245,-1601,-1956,-2312,-2668,-3023,-3379,-3735,-4091,-4446,-4802,-5158,-5513,-5869,-6225,-6581,-6936,-7292,-7648,-8003,-8359,-8715,-9070,-9426,-9782,-10138,-10493,-10849,-11205,-11560,-11916,-12272,-12628,-12983,-13339,-13695,-14050,-14406,-14762,-15117,-15473,-15829,-16185,-16540,-16896,-15872,-13277,-13550,-13824,-12800,-11776,-10752,-9728,-8704,-7680,-6656,-5632,-4608,-3584,-2560,-1536,-512,512,1536,2560,3584,4608,5632,6656,7680,8704,9728,10752,11776,12800,13824,13550,13277,13003,12729,12455,12182,11908,11634,11360,11087,10813,10539,10265,9992,9718,9444,9170,8897,8623,8349,8075,7802,7528,7254,6980,6707,6433,6159,5885,5612,5338,5064,4790,4517,4243,3969,3696,3422,3148,2874,2601,2327,2053,1779,1506,1232,958,684,411,137,-137,-411,-684,-958,-1232,-1506,-1779,-2053,-2327,-2601,-2874,-3148,-3422,-3696,-3969,-4243,-4517,-4790,-5064,-5338,-5612,-5885,-6159,-6433,-6707,-6980,-7254,-7528,-7802,-8075,-8349,-8623,-8897,-9170,-9444,-9718,-9992,-10265,-10539,-10813,-11087,-11360,-11634,-11908,-12182,-12455,-12729,-13003,-13277,-13550,-13824,-12800,-8390,-8547,-8704,-7680,-6656,-5632,-4608,-3584,-2560,-1536,-512,512,1536,2560,3584,4608,5632,6656,7680,8704,8547,8390,8234,8077,7920,7763,7606,7449,7293,7136,6979,6822,6665,6508,6352,6195,6038,5881,5724,5567,5411,5254,5097,4940,4783,4626,4470,4313,4156,3999,3842,3685,3529,3372,3215,3058,2901,2745,2588,2431,2274,2117,1960,1804,1647,1490,1333,1176,1019,863,706,549,392,235,78,-78,-235,-392,-549,-706,-863,-1019,-1176,-1333,-1490,-1647,-1804,-1960,-2117,-2274,-2431,-2588,-2745,-2901,-3058,-3215,-3372,-3529,-3685,-3842,-3999,-4156,-4313,-4470,-4626,-4783,-4940,-5097,-5254,-5411,-5567,-5724,-5881,-6038,-6195,-6352,-6508,-6665,-6822,-6979,-7136,-7293,-7449,-7606,-7763,-7920,-8077,-8234,-8390,-8547,-8704,-7680,-4453,-4531,-4608,-3584,-2560,-1536,-512,512,1536,2560,3584,4608,4531,4453,4376,4298,4221,4143,4066,3988,3911,3834,3756,3679,3601,3524,3446,3369,3291,3214,3137,3059,2982,2904,2827,2749,2672,2594,2517,2440,2362,2285,2207,2130,2052,1975,1897,1820,1743,1665,1588,1510,1433,1355,1278,1200,1123,1046,968,891,813,736,658,581,503,426,349,271,194,116,39,-39,-116,-194,-271,-349,-426,-503,-581,-658,-736,-813,-891,-968,-1046,-1123,-1200,-1278,-1355,-1433,-1510,-1588,-1665,-1743,-1820,-1897,-1975,-2052,-2130,-2207,-2285,-2362,-2440,-2517,-2594,-2672,-2749,-2827,-2904,-2982,-3059,-3137,-3214,-3291,-3369,-3446,-3524,-3601,-3679,-3756,-3834,-3911,-3988,-4066,-4143,-4221,-4298,-4376,-4453,-4531,-4608,-3584,-2477,-2518,-2560,-1536,-512,512,1536,2560,2518,2477,2435,2393,2352,2310,2269,2227,2185,2144,2102,2060,2019,1977,1936,1894,1852,1811,1769,1727,1686,1644,1603,1561,1519,1478,1436,1394,1353,1311,1270,1228,1186,1145,1103,1061,1020,978,937,895,853,812,770,728,687,645,604,562,520,479,437,395,354,312,271,229,187,146,104,62,21,-21,-62,-104,-146,-187,-229,-271,-312,-354,-395,-437,-479,-520,-562,-604,-645,-687,-728,-770,-812,-853,-895,-937,-978,-1020,-1061,-1103,-1145,-1186,-1228,-1270,-1311,-1353,-1394,-1436,-1478,-1519,-1561,-1603,-1644,-1686,-1727,-1769,-1811,-1852,-1894,-1936,-1977,-2019,-2060,-2102,-2144,-2185,-2227,-2269,-2310,-2352,-2393,-2435,-2477,-2518,-2560,-1536,-25205,-26158,-26912,-27331,-27331,-26912,-26158,-25205,-24192,-23221,-22326,-21487,-20652,-19773,-18831,-17840,-16836,-15849,-14893,-13957,-13016,-12048,-11045,-10021,-8998,-7993,-7013,-6048,-5082,-4101,-3104,-2102,-1113,-150,786,1703,2615,3530,4445,5350,6230,7077,7891,8680,9456,10223,10978,11709,12405,13060,13675,14261,14826,15373,15898,16388,16835,17234,17591,17915,18212,18486,18729,18932,19086,19190,19251,19278,19278,19251,19190,19086,18932,18729,18486,18212,17915,17591,17234,16835,16388,15898,15373,14826,14261,13675,13060,12405,11709,10978,10223,9456,8680,7891,7077,6230,5350,4445,3530,2615,1703,786,-150,-1113,-2102,-3104,-4101,-5082,-6048,-7013,-7993,-8998,-10021,-11045,-12048,-13016,-13957,-14893,-15849,-16836,-17840,-18831,-19773,-20652,-21487,-22326,-23221,-24192,-25205,-26158,-26912,-27331,-22542,-23430,-23985,-24156,-24156,-23985,-23430,-22542,-21541,-20619,-19838,-19151,-18470,-17715,-16848,-15889,-14904,-13953,-13061,-12206,-11341,-10424,-9444,-8420,-7396,-6411,-5473,-4564,-3652,-2712,-1741,-761,193,1100,1955,2777,3589,4406,5224,6024,6781,7481,8128,8736,9324,9898,10454,10977,11450,11868,12239,12574,12886,13178,13446,13681,13876,14032,14156,14258,14345,14418,14476,14516,14539,14550,14553,14554,14554,14553,14550,14539,14516,14476,14418,14345,14258,14156,14032,13876,13681,13446,13178,12886,12574,12239,11868,11450,10977,10454,9898,9324,8736,8128,7481,6781,6024,5224,4406,3589,2777,1955,1100,193,-761,-1741,-2712,-3652,-4564,-5473,-6411,-7396,-8420,-9444,-10424,-11341,-12206,-13061,-13953,-14904,-15889,-16848,-17715,-18470,-19151,-19838,-20619,-21541,-22542,-23430,-23985,-24156,-18887,-19656,-19957,-19986,-19986,-19957,-19656,-18887,-17908,-17078,-16482,-16021,-15568,-15012,-14277,-13380,-12432,-11550,-10773,-10058,-9327,-8507,-7567,-6543,-5521,-4572,-3714,-2907,-2094,-1231,-311,626,1516,2319,3033,3693,4337,4989,5643,6267,6827,7305,7714,8075,8412,8735,9037,9303,9522,9693,9827,9936,10031,10115,10185,10239,10276,10300,10315,10325,10332,10338,10341,10342,10343,10343,10343,10343,10343,10343,10343,10343,10342,10341,10338,10332,10325,10315,10300,10276,10239,10185,10115,10031,9936,9827,9693,9522,9303,9037,8735,8412,8075,7714,7305,6827,6267,5643,4989,4337,3693,3033,2319,1516,626,-311,-1231,-2094,-2907,-3714,-4572,-5521,-6543,-7567,-8507,-9327,-10058,-10773,-11550,-12432,-13380,-14277,-15012,-15568,-16021,-16482,-17078,-17908,-18887,-19656,-19957,-19986,-14425,-15003,-15092,-15092,-15092,-15092,-15003,-14425,-13489,-12816,-12470,-12262,-12062,-11759,-11233,-10447,-9568,-8808,-8219,-7719,-7198,-6542,-5679,-4655,-3634,-2756,-2035,-1400,-755,-28,800,1657,2431,3059,3558,3983,4388,4803,5221,5602,5907,6131,6294,6421,6532,6634,6723,6792,6839,6867,6885,6897,6906,6912,6917,6920,6921,6922,6922,6922,6922,6922,6922,6922,6922,6922,6922,6922,6922,6922,6922,6922,6922,6922,6922,6922,6922,6922,6922,6921,6920,6917,6912,6906,6897,6885,6867,6839,6792,6723,6634,6532,6421,6294,6131,5907,5602,5221,4803,4388,3983,3558,3059,2431,1657,800,-28,-755,-1400,-2035,-2756,-3634,-4655,-5679,-6542,-7198,-7719,-8219,-8808,-9568,-10447,-11233,-11759,-12062,-12262,-12470,-12816,-13489,-14425,-15003,-15092,-15092,-9768,-10095,-10103,-10103,-10103,-10103,-10095,-9768,-8913,-8471,-8354,-8312,-8273,-8183,-7913,-7310,-6555,-5992,-5652,-5409,-5143,-4723,-3997,-2973,-1953,-1200,-693,-299,107,624,1292,2010,2595,2981,3224,3400,3560,3728,3899,4040,4131,4180,4206,4222,4234,4244,4252,4257,4259,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4260,4259,4257,4252,4244,4234,4222,4206,4180,4131,4040,3899,3728,3560,3400,3224,2981,2595,2010,1292,624,107,-299,-693,-1200,-1953,-2973,-3997,-4723,-5143,-5409,-5652,-5992,-6555,-7310,-7913,-8183,-8273,-8312,-8354,-8471,-8913,-9768,-10095,-10103,-10103,-5824,-5928,-5928,-5928,-5928,-5928,-5928,-5824,-5110,-4920,-4906,-4904,-4903,-4895,-4824,-4468,-3912,-3602,-3489,-3432,-3363,-3190,-2675,-1651,-637,-82,168,320,481,742,1178,1681,2016,2161,2218,2249,2274,2301,2330,2349,2357,2360,2360,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2361,2360,2360,2357,2349,2330,2301,2274,2249,2218,2161,2016,1681,1178,742,481,320,168,-82,-637,-1651,-2675,-3190,-3363,-3432,-3489,-3602,-3912,-4468,-4824,-4895,-4903,-4904,-4906,-4920,-5110,-5824,-5928,-5928,-5928,-3202,-3212,-3212,-3212,-3212,-3212,-3212,-3202,-2704,-2669,-2668,-2668,-2668,-2668,-2663,-2540,-2238,-2144,-2132,-2128,-2124,-2095,-1836,-812,194,494,555,577,603,669,855,1102,1211,1232,1235,1236,1237,1237,1238,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1239,1238,1237,1237,1236,1235,1232,1211,1102,855,669,603,577,555,494,194,-812,-1836,-2095,-2124,-2128,-2132,-2144,-2238,-2540,-2663,-2668,-2668,-2668,-2668,-2669,-2704,-3202,-3212,-3212,-3212,-1892,-1892,-1892,-1892,-1892,-1892,-1892,-1892,-1650,-1649,-1649,-1649,-1649,-1649,-1649,-1634,-1545,-1536,-1536,-1536,-1536,-1535,-1470,-446,541,629,633,633,634,638,672,732,743,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,744,743,732,672,638,634,633,633,629,541,-446,-1470,-1535,-1536,-1536,-1536,-1536,-1545,-1634,-1649,-1649,-1649,-1649,-1649,-1649,-1650,-1892,-1892,-1892,-1892,-11705,-12211,-12571,-12800,-12800,-12571,-12211,-11705,-11057,-10270,-9392,-8442,-7445,-6425,-5401,-4380,-3391,-2459,-1602,-806,-89,544,1088,1548,1915,2207,2433,2592,2676,2714,2726,2710,2656,2581,2500,2412,2308,2200,2096,1996,1902,1823,1750,1694,1664,1665,1686,1729,1814,1920,2043,2185,2350,2520,2695,2879,3067,3238,3405,3574,3736,3877,4005,4119,4217,4286,4336,4364,4364,4336,4286,4217,4119,4005,3877,3736,3574,3405,3238,3067,2879,2695,2520,2350,2185,2043,1920,1814,1729,1686,1665,1664,1694,1750,1823,1902,1996,2096,2200,2308,2412,2500,2581,2656,2710,2726,2714,2676,2592,2433,2207,1915,1548,1088,544,-89,-806,-1602,-2459,-3391,-4380,-5401,-6425,-7445,-8442,-9392,-10270,-11057,-11705,-12211,-12571,-12800,-11513,-12026,-12383,-12626,-12626,-12383,-12026,-11513,-10829,-10015,-9148,-8205,-7190,-6166,-5166,-4159,-3169,-2238,-1364,-516,277,1003,1671,2293,2855,3353,3803,4205,4543,4836,5080,5269,5396,5472,5491,5437,5336,5181,4957,4697,4402,4079,3738,3402,3074,2755,2461,2199,1964,1741,1552,1387,1225,1070,926,786,637,487,345,192,36,-102,-224,-353,-462,-540,-592,-628,-628,-592,-540,-462,-353,-224,-102,36,192,345,487,637,786,926,1070,1225,1387,1552,1741,1964,2199,2461,2755,3074,3402,3738,4079,4402,4697,4957,5181,5336,5437,5491,5472,5396,5269,5080,4836,4543,4205,3803,3353,2855,2293,1671,1003,277,-516,-1364,-2238,-3169,-4159,-5166,-6166,-7190,-8205,-9148,-10015,-10829,-11513,-12026,-12383,-12626,-7753,-8376,-8825,-9124,-9124,-8825,-8376,-7753,-6945,-5994,-4994,-3970,-2946,-1961,-1056,-240,476,1077,1566,1961,2248,2431,2536,2576,2546,2459,2327,2151,1937,1712,1470,1209,942,708,503,318,171,88,79,121,216,386,613,887,1187,1507,1835,2143,2416,2628,2770,2840,2828,2715,2513,2245,1916,1533,1122,703,282,-123,-489,-806,-1079,-1288,-1426,-1499,-1499,-1426,-1288,-1079,-806,-489,-123,282,703,1122,1533,1916,2245,2513,2715,2828,2840,2770,2628,2416,2143,1835,1507,1187,887,613,386,216,121,79,88,171,318,503,708,942,1209,1470,1712,1937,2151,2327,2459,2546,2576,2536,2431,2248,1961,1566,1077,476,-240,-1056,-1961,-2946,-3970,-4994,-5994,-6945,-7753,-8376,-8825,-9124,-12891,-13248,-13449,-13716,-13716,-13449,-13248,-12891,-12367,-11747,-11092,-10321,-9457,-8546,-7619,-6626,-5605,-4601,-3577,-2562,-1603,-662,227,1052,1794,2489,3125,3661,4102,4508,4849,5019,5171,5305,5327,5253,5173,5083,4894,4679,4474,4247,3974,3716,3488,3245,3017,2817,2649,2520,2392,2306,2251,2198,2181,2189,2205,2242,2310,2363,2421,2508,2598,2650,2678,2752,2802,2784,2784,2802,2752,2678,2650,2598,2508,2421,2363,2310,2242,2205,2189,2181,2198,2251,2306,2392,2520,2649,2817,3017,3245,3488,3716,3974,4247,4474,4679,4894,5083,5173,5253,5327,5305,5171,5019,4849,4508,4102,3661,3125,2489,1794,1052,227,-662,-1603,-2562,-3577,-4601,-5605,-6626,-7619,-8546,-9457,-10321,-11092,-11747,-12367,-12891,-13248,-13449,-13716,-7156,-7842,-8581,-9416,-9416,-8581,-7842,-7156,-6232,-5208,-4489,-4058,-3664,-3378,-3251,-3293,-3466,-3628,-3691,-3617,-3496,-3309,-2884,-2204,-1525,-931,-299,348,822,1122,1386,1591,1657,1626,1547,1494,1522,1604,1695,1862,2101,2324,2532,2748,2982,3229,3410,3492,3523,3566,3565,3417,3161,2916,2696,2413,2064,1892,1911,1925,1948,2120,2408,2677,2870,3020,3164,3266,3266,3164,3020,2870,2677,2408,2120,1948,1925,1911,1892,2064,2413,2696,2916,3161,3417,3565,3566,3523,3492,3410,3229,2982,2748,2532,2324,2101,1862,1695,1604,1522,1494,1547,1626,1657,1591,1386,1122,822,348,-299,-931,-1525,-2204,-2884,-3309,-3496,-3617,-3691,-3628,-3466,-3293,-3251,-3378,-3664,-4058,-4489,-5208,-6232,-7156,-7842,-8581,-9416,-8028,-8537,-9395,-10253,-10253,-9395,-8537,-8028,-7592,-7001,-6338,-5533,-4512,-3488,-2736,-2212,-1727,-1256,-856,-473,-49,372,677,778,732,756,977,1295,1547,1683,1725,1728,1779,1980,2243,2420,2522,2674,2858,2959,3007,3106,3283,3421,3405,3281,3145,2989,2802,2634,2461,2178,1788,1448,1213,985,710,512,460,443,400,417,528,638,688,723,781,831,831,781,723,688,638,528,417,400,443,460,512,710,985,1213,1448,1788,2178,2461,2634,2802,2989,3145,3281,3405,3421,3283,3106,3007,2959,2858,2674,2522,2420,2243,1980,1779,1728,1725,1683,1547,1295,977,756,732,778,677,372,-49,-473,-856,-1256,-1727,-2212,-2736,-3488,-4512,-5533,-6338,-7001,-7592,-8028,-8537,-9395,-10253,-12194,-12261,-12614,-13177,-13177,-12614,-12261,-12194,-11954,-11353,-10698,-10033,-9318,-8483,-7689,-6925,-6123,-5159,-4135,-3204,-2494,-1766,-838,129,871,1524,2216,2882,3481,4105,4700,5182,5531,5871,6251,6594,6836,6988,7053,7059,7091,7083,6991,6812,6541,6205,5935,5682,5288,4764,4267,3830,3378,2881,2386,1878,1327,832,449,57,-374,-754,-1090,-1384,-1546,-1633,-1789,-1959,-1959,-1789,-1633,-1546,-1384,-1090,-754,-374,57,449,832,1327,1878,2386,2881,3378,3830,4267,4764,5288,5682,5935,6205,6541,6812,6991,7083,7091,7059,7053,6988,6836,6594,6251,5871,5531,5182,4700,4105,3481,2882,2216,1524,871,129,-838,-1766,-2494,-3204,-4135,-5159,-6123,-6925,-7689,-8483,-9318,-10033,-10698,-11353,-11954,-12194,-12261,-12614,-13177,-11519,-11750,-11930,-12347,-12347,-11930,-11750,-11519,-10983,-10334,-9753,-9002,-8145,-7265,-6386,-5433,-4455,-3460,-2436,-1460,-544,393,1362,2182,2927,3742,4457,5011,5601,6161,6555,6908,7272,7536,7667,7824,7913,7860,7777,7698,7482,7170,6875,6521,6083,5628,5134,4558,3962,3376,2734,2093,1443,774,99,-531,-1110,-1709,-2306,-2801,-3272,-3744,-4104,-4374,-4667,-4888,-5007,-5063,-5063,-5007,-4888,-4667,-4374,-4104,-3744,-3272,-2801,-2306,-1709,-1110,-531,99,774,1443,2093,2734,3376,3962,4558,5134,5628,6083,6521,6875,7170,7482,7698,7777,7860,7913,7824,7667,7536,7272,6908,6555,6161,5601,5011,4457,3742,2927,2182,1362,393,-544,-1460,-2436,-3460,-4455,-5433,-6386,-7265,-8145,-9002,-9753,-10334,-10983,-11519,-11750,-11930,-12347,-1683,-2437,-3315,-4339,-4339,-3315,-2437,-1683,-1014,-241,521,1283,1859,2101,1996,1708,1385,1047,613,261,39,27,131,222,231,236,215,172,149,-6,-243,-433,-495,-556,-716,-867,-859,-648,-424,-227,-124,-24,130,269,401,553,688,750,773,835,815,809,827,736,642,596,565,455,214,-13,-147,-284,-500,-692,-800,-906,-1060,-1202,-1202,-1060,-906,-800,-692,-500,-284,-147,-13,214,455,565,596,642,736,827,809,815,835,773,750,688,553,401,269,130,-24,-124,-227,-424,-648,-859,-867,-716,-556,-495,-433,-243,-6,149,172,215,236,231,222,131,27,39,261,613,1047,1385,1708,1996,2101,1859,1283,521,-241,-1014,-1683,-2437,-3315,-4339,-2160,-2663,-3352,-4376,-4376,-3352,-2663,-2160,-1750,-1288,-920,-592,32,953,1457,1668,1638,1566,1394,1310,1310,1297,1149,905,581,273,-83,-348,-487,-501,-527,-503,-418,-317,-310,-334,-223,45,285,433,497,574,637,691,758,912,1096,1247,1243,1177,1024,927,844,675,506,382,238,13,-294,-533,-666,-765,-891,-953,-960,-1016,-1179,-1329,-1329,-1179,-1016,-960,-953,-891,-765,-666,-533,-294,13,238,382,506,675,844,927,1024,1177,1243,1247,1096,912,758,691,637,574,497,433,285,45,-223,-334,-310,-317,-418,-503,-527,-501,-487,-348,-83,273,581,905,1149,1297,1310,1310,1394,1566,1638,1668,1457,953,32,-592,-920,-1288,-1750,-2160,-2663,-3352,-4376,-1003,-1766,-2700,-3724,-3724,-2700,-1766,-1003,-358,332,964,1474,1724,1688,1318,797,272,-258,-896,-1514,-1719,-1289,-802,-398,-109,206,523,838,1057,1110,991,829,675,476,191,-64,-138,-10,184,350,421,487,589,679,697,640,578,520,436,252,-21,-248,-388,-410,-377,-319,-292,-290,-267,-236,-171,-143,-156,-144,-136,-176,-323,-456,-456,-323,-176,-136,-144,-156,-143,-171,-236,-267,-290,-292,-319,-377,-410,-388,-248,-21,252,436,520,578,640,697,679,589,487,421,350,184,-10,-138,-64,191,476,675,829,991,1110,1057,838,523,206,-109,-398,-802,-1289,-1719,-1514,-896,-258,272,797,1318,1688,1724,1474,964,332,-358,-1003,-1766,-2700,-3724,-1955,-2748,-3711,-4735,-4735,-3711,-2748,-1955,-1262,-537,168,915,1660,2186,2318,2129,1867,1690,1423,1031,624,366,153,-116,-401,-635,-868,-1189,-1412,-1245,-983,-697,-426,-228,-117,-14,204,473,665,718,657,569,516,526,572,666,780,849,860,767,612,468,358,200,-18,-202,-343,-455,-521,-552,-524,-454,-353,-211,-57,30,-3,-49,-49,-3,30,-57,-211,-353,-454,-524,-552,-521,-455,-343,-202,-18,200,358,468,612,767,860,849,780,666,572,526,516,569,657,718,665,473,204,-14,-117,-228,-426,-697,-983,-1245,-1412,-1189,-868,-635,-401,-116,153,366,624,1031,1423,1690,1867,2129,2318,2186,1660,915,168,-537,-1262,-1955,-2748,-3711,-4735,-1483,-2328,-3352,-4340,-4340,-3352,-2328,-1483,-839,-136,651,1428,2030,2312,2217,1860,1429,1030,632,295,105,121,239,317,353,488,627,635,376,-68,-504,-828,-1049,-1301,-1688,-2095,-2239,-1831,-1196,-644,-200,186,587,977,1280,1465,1533,1450,1240,952,632,375,210,117,77,38,-19,-67,-62,-27,-8,-67,-164,-244,-277,-301,-396,-512,-512,-396,-301,-277,-244,-164,-67,-8,-27,-62,-67,-19,38,77,117,210,375,632,952,1240,1450,1533,1465,1280,977,587,186,-200,-644,-1196,-1831,-2239,-2095,-1688,-1301,-1049,-828,-504,-68,376,635,627,488,353,317,239,121,105,295,632,1030,1429,1860,2217,2312,2030,1428,651,-136,-839,-1483,-2328,-3352,-4340,-1307,-2045,-2957,-3981,-3981,-2957,-2045,-1307,-764,-182,446,1073,1592,1872,1811,1511,1099,711,355,87,-70,-81,-76,-98,-146,-108,-11,52,19,-62,-121,-76,43,159,115,-44,-195,-259,-259,-287,-348,-361,-371,-422,-527,-373,130,607,901,996,952,923,955,991,935,728,399,50,-200,-318,-347,-408,-501,-520,-449,-383,-404,-450,-450,-404,-383,-449,-520,-501,-408,-347,-318,-200,50,399,728,935,991,955,923,952,996,901,607,130,-373,-527,-422,-371,-361,-348,-287,-259,-259,-195,-44,115,159,43,-76,-121,-62,19,52,-11,-108,-146,-98,-76,-81,-70,87,355,711,1099,1511,1811,1872,1592,1073,446,-182,-764,-1307,-2045,-2957,-3981,-1435,-2272,-3217,-4241,-4241,-3217,-2272,-1435,-782,-129,552,1232,1754,1965,1787,1398,936,484,21,-371,-581,-546,-447,-379,-331,-215,-41,111,158,99,7,-16,38,61,-46,-165,-114,163,544,861,1061,1264,1503,1658,1607,1385,1131,829,414,-80,-613,-1090,-1517,-1724,-1481,-1137,-815,-522,-239,33,304,477,510,435,275,49,-200,-361,-361,-200,49,275,435,510,477,304,33,-239,-522,-815,-1137,-1481,-1724,-1517,-1090,-613,-80,414,829,1131,1385,1607,1658,1503,1264,1061,861,544,163,-114,-165,-46,61,38,-16,7,99,158,111,-41,-215,-331,-379,-447,-546,-581,-371,21,484,936,1398,1787,1965,1754,1232,552,-129,-782,-1435,-2272,-3217,-4241,-2191,-3081,-4105,-5066,-5066,-4105,-3081,-2191,-1420,-674,111,939,1686,2110,2117,1897,1599,1224,768,362,152,128,163,176,179,222,275,285,256,203,129,79,37,-46,-169,-259,-210,-20,233,421,504,587,718,878,1023,1146,1274,1398,1432,1347,1212,1026,734,325,-113,-505,-889,-1217,-1458,-1630,-1795,-1840,-1457,-827,-286,-11,-10,-75,-75,-10,-11,-286,-827,-1457,-1840,-1795,-1630,-1458,-1217,-889,-505,-113,325,734,1026,1212,1347,1432,1398,1274,1146,1023,878,718,587,504,421,233,-20,-210,-259,-169,-46,37,79,129,203,256,285,275,222,179,176,163,128,152,362,768,1224,1599,1897,2117,2110,1686,939,111,-674,-1420,-2191,-3081,-4105,-5066,-20598,-20751,-20852,-20913,-20913,-20852,-20751,-20598,-20397,-20146,-19847,-19499,-19107,-18668,-18183,-17651,-17081,-16469,-15819,-15130,-14404,-13643,-12852,-12029,-11174,-10295,-9392,-8464,-7517,-6552,-5570,-4577,-3571,-2557,-1536,-512,512,1536,2557,3571,4577,5570,6552,7517,8464,9392,10295,11174,12029,12852,13643,14404,15130,15819,16469,17081,17651,18183,18668,19107,19499,19847,20146,20397,20598,20751,20852,20913,20913,20852,20751,20598,20397,20146,19847,19499,19107,18668,18183,17651,17081,16469,15819,15130,14404,13643,12852,12029,11174,10295,9392,8464,7517,6552,5570,4577,3571,2557,1536,512,-512,-1536,-2557,-3571,-4577,-5570,-6552,-7517,-8464,-9392,-10295,-11174,-12029,-12852,-13643,-14404,-15130,-15819,-16469,-17081,-17651,-18183,-18668,-19107,-19499,-19847,-20146,-20397,-20598,-20751,-20852,-20913,-10108,-10547,-10853,-11035,-11035,-10853,-10547,-10108,-9554,-8873,-8091,-7223,-6289,-5304,-4289,-3270,-2261,-1274,-324,564,1369,2077,2683,3175,3539,3780,3899,3898,3775,3536,3192,2756,2243,1667,1044,389,-278,-945,-1587,-2184,-2714,-3164,-3524,-3779,-3919,-3931,-3819,-3572,-3196,-2697,-2079,-1359,-547,343,1297,2295,3315,4339,5345,6314,7230,8076,8839,9496,10042,10460,10738,10877,10877,10738,10460,10042,9496,8839,8076,7230,6314,5345,4339,3315,2295,1297,343,-547,-1359,-2079,-2697,-3196,-3572,-3819,-3931,-3919,-3779,-3524,-3164,-2714,-2184,-1587,-945,-278,389,1044,1667,2243,2756,3192,3536,3775,3898,3899,3780,3539,3175,2683,2077,1369,564,-324,-1274,-2261,-3270,-4289,-5304,-6289,-7223,-8091,-8873,-9554,-10108,-10547,-10853,-11035,-17901,-18342,-18803,-19228,-19228,-18803,-18342,-17901,-17436,-16807,-16103,-15368,-14576,-13653,-12677,-11766,-10847,-9864,-8852,-7914,-7046,-6187,-5363,-4604,-3924,-3270,-2658,-2141,-1729,-1316,-893,-564,-341,-167,21,189,289,342,424,557,739,993,1345,1737,2141,2603,3154,3801,4514,5292,6129,7038,8004,8994,10018,11020,11963,12861,13752,14589,15337,16041,16670,17218,17648,18012,18331,18573,18573,18331,18012,17648,17218,16670,16041,15337,14589,13752,12861,11963,11020,10018,8994,8004,7038,6129,5292,4514,3801,3154,2603,2141,1737,1345,993,739,557,424,342,289,189,21,-167,-341,-564,-893,-1316,-1729,-2141,-2658,-3270,-3924,-4604,-5363,-6187,-7046,-7914,-8852,-9864,-10847,-11766,-12677,-13653,-14576,-15368,-16103,-16807,-17436,-17901,-18342,-18803,-19228,-10200,-11150,-12174,-12991,-12991,-12174,-11150,-10200,-9660,-9444,-9418,-9382,-9147,-8662,-8047,-7405,-6810,-6198,-5604,-5052,-4567,-4162,-3802,-3460,-3049,-2455,-1773,-1132,-642,-353,-146,61,414,969,1665,2333,2828,3133,3303,3452,3594,3753,3928,4099,4328,4645,5102,5588,5940,6054,5899,5579,5265,5107,5173,5445,5789,6021,6074,5935,5688,5499,5447,5525,5646,5765,5869,5972,5972,5869,5765,5646,5525,5447,5499,5688,5935,6074,6021,5789,5445,5173,5107,5265,5579,5899,6054,5940,5588,5102,4645,4328,4099,3928,3753,3594,3452,3303,3133,2828,2333,1665,969,414,61,-146,-353,-642,-1132,-1773,-2455,-3049,-3460,-3802,-4162,-4567,-5052,-5604,-6198,-6810,-7405,-8047,-8662,-9147,-9382,-9418,-9444,-9660,-10200,-11150,-12174,-12991,-15200,-16184,-16972,-17454,-17454,-16972,-16184,-15200,-14223,-13348,-12651,-12132,-11807,-11610,-11515,-11442,-11333,-11125,-10771,-10226,-9508,-8637,-7661,-6642,-5618,-4630,-3711,-2895,-2200,-1626,-1161,-764,-400,-34,377,864,1447,2132,2906,3750,4618,5450,6185,6800,7276,7631,7884,8056,8163,8242,8320,8439,8627,8920,9309,9776,10278,10735,11089,11301,11354,11268,11072,10788,10480,10180,9942,9820,9820,9942,10180,10480,10788,11072,11268,11354,11301,11089,10735,10278,9776,9309,8920,8627,8439,8320,8242,8163,8056,7884,7631,7276,6800,6185,5450,4618,3750,2906,2132,1447,864,377,-34,-400,-764,-1161,-1626,-2200,-2895,-3711,-4630,-5618,-6642,-7661,-8637,-9508,-10226,-10771,-11125,-11333,-11442,-11515,-11610,-11807,-12132,-12651,-13348,-14223,-15200,-16184,-16972,-17454,-7131,-8003,-9027,-9971,-9971,-9027,-8003,-7131,-6349,-5525,-4667,-4002,-3565,-3119,-2739,-2513,-2332,-2056,-1686,-1265,-807,-245,326,786,1296,1841,2262,2516,2564,2518,2473,2332,2117,1960,1826,1646,1503,1512,1588,1716,1917,2093,2207,2209,2047,1910,1873,1803,1673,1586,1523,1483,1486,1497,1537,1601,1650,1707,1723,1715,1707,1568,1361,1044,611,312,213,167,167,213,312,611,1044,1361,1568,1707,1715,1723,1707,1650,1601,1537,1497,1486,1483,1523,1586,1673,1803,1873,1910,2047,2209,2207,2093,1917,1716,1588,1512,1503,1646,1826,1960,2117,2332,2473,2518,2564,2516,2262,1841,1296,786,326,-245,-807,-1265,-1686,-2056,-2332,-2513,-2739,-3119,-3565,-4002,-4667,-5525,-6349,-7131,-8003,-9027,-9971,-9368,-9777,-9731,-10755,-10755,-9731,-9777,-9368,-8645,-8247,-7761,-6955,-6090,-5586,-4752,-3823,-3293,-2598,-1795,-1143,-541,215,815,1291,1854,2358,2883,3295,3683,4064,4329,4621,4761,4908,5046,5074,5120,5046,4898,4746,4638,4367,4061,3937,3655,3286,3079,2969,2591,2278,2269,1876,1542,1473,1100,728,462,100,-262,-537,-753,-1039,-1244,-1448,-1680,-1817,-1897,-1882,-1882,-1897,-1817,-1680,-1448,-1244,-1039,-753,-537,-262,100,462,728,1100,1473,1542,1876,2269,2278,2591,2969,3079,3286,3655,3937,4061,4367,4638,4746,4898,5046,5120,5074,5046,4908,4761,4621,4329,4064,3683,3295,2883,2358,1854,1291,815,215,-541,-1143,-1795,-2598,-3293,-3823,-4752,-5586,-6090,-6955,-7761,-8247,-8645,-9368,-9777,-9731,-10755,-4414,-4670,-4246,-5270,-5270,-4246,-4670,-4414,-3907,-3762,-3598,-3200,-2765,-2558,-2357,-1914,-1737,-1558,-1158,-990,-860,-494,-248,-147,211,509,593,887,1181,1219,1380,1642,1778,1765,1910,2089,2091,1993,2041,2079,1841,1872,1892,1636,1509,1561,1414,1291,1330,1201,1194,1056,1071,1198,919,899,861,721,660,599,451,394,287,161,175,94,111,86,86,111,94,175,161,287,394,451,599,660,721,861,899,919,1198,1071,1056,1194,1201,1330,1291,1414,1561,1509,1636,1892,1872,1841,2079,2041,1993,2091,2089,1910,1765,1778,1642,1380,1219,1181,887,593,509,211,-147,-248,-494,-860,-990,-1158,-1558,-1737,-1914,-2357,-2558,-2765,-3200,-3598,-3762,-3907,-4414,-4670,-4246,-5270,-19825,-20072,-20279,-20427,-20427,-20279,-20072,-19825,-19569,-19291,-19004,-18698,-18373,-17994,-17552,-17029,-16430,-15773,-15078,-14370,-13675,-12982,-12278,-11541,-10757,-9915,-9023,-8084,-7125,-6151,-5180,-4232,-3312,-2394,-1451,-479,523,1540,2564,3585,4583,5544,6456,7317,8147,8973,9808,10658,11512,12356,13166,13925,14619,15244,15807,16330,16820,17290,17745,18195,18623,19003,19311,19539,19694,19786,19831,19844,19844,19831,19786,19694,19539,19311,19003,18623,18195,17745,17290,16820,16330,15807,15244,14619,13925,13166,12356,11512,10658,9808,8973,8147,7317,6456,5544,4583,3585,2564,1540,523,-479,-1451,-2394,-3312,-4232,-5180,-6151,-7125,-8084,-9023,-9915,-10757,-11541,-12278,-12982,-13675,-14370,-15078,-15773,-16430,-17029,-17552,-17994,-18373,-18698,-19004,-19291,-19569,-19825,-20072,-20279,-20427,-10881,-11316,-11665,-11893,-11893,-11665,-11316,-10881,-10406,-9886,-9317,-8655,-7888,-7006,-6041,-5025,-4001,-2993,-2023,-1079,-143,814,1786,2741,3645,4466,5187,5814,6363,6851,7284,7663,7970,8190,8290,8266,8134,7934,7702,7445,7145,6786,6338,5802,5197,4569,3941,3329,2738,2157,1579,976,346,-293,-910,-1469,-1961,-2393,-2780,-3137,-3486,-3821,-4121,-4356,-4523,-4619,-4671,-4692,-4692,-4671,-4619,-4523,-4356,-4121,-3821,-3486,-3137,-2780,-2393,-1961,-1469,-910,-293,346,976,1579,2157,2738,3329,3941,4569,5197,5802,6338,6786,7145,7445,7702,7934,8134,8266,8290,8190,7970,7663,7284,6851,6363,5814,5187,4466,3645,2741,1786,814,-143,-1079,-2023,-2993,-4001,-5025,-6041,-7006,-7888,-8655,-9317,-9886,-10406,-10881,-11316,-11665,-11893,-19536,-19886,-20149,-20318,-20318,-20149,-19886,-19536,-19137,-18680,-18164,-17566,-16878,-16098,-15244,-14343,-13417,-12486,-11554,-10616,-9657,-8663,-7649,-6625,-5622,-4659,-3750,-2885,-2053,-1235,-424,371,1133,1849,2511,3116,3676,4207,4730,5248,5754,6241,6685,7083,7443,7791,8148,8520,8901,9285,9655,10003,10323,10612,10895,11181,11476,11779,12074,12332,12548,12722,12867,13004,13132,13251,13347,13403,13403,13347,13251,13132,13004,12867,12722,12548,12332,12074,11779,11476,11181,10895,10612,10323,10003,9655,9285,8901,8520,8148,7791,7443,7083,6685,6241,5754,5248,4730,4207,3676,3116,2511,1849,1133,371,-424,-1235,-2053,-2885,-3750,-4659,-5622,-6625,-7649,-8663,-9657,-10616,-11554,-12486,-13417,-14343,-15244,-16098,-16878,-17566,-18164,-18680,-19137,-19536,-19886,-20149,-20318,-18344,-19191,-19841,-20219,-20219,-19841,-19191,-18344,-17385,-16364,-15340,-14354,-13445,-12607,-11830,-11087,-10365,-9658,-8965,-8282,-7598,-6907,-6215,-5525,-4842,-4148,-3435,-2702,-1976,-1284,-643,-60,465,942,1385,1805,2214,2638,3095,3575,4063,4554,5055,5574,6103,6635,7167,7711,8266,8820,9336,9780,10120,10356,10500,10582,10629,10655,10676,10715,10787,10886,10995,11108,11220,11327,11414,11464,11464,11414,11327,11220,11108,10995,10886,10787,10715,10676,10655,10629,10582,10500,10356,10120,9780,9336,8820,8266,7711,7167,6635,6103,5574,5055,4554,4063,3575,3095,2638,2214,1805,1385,942,465,-60,-643,-1284,-1976,-2702,-3435,-4148,-4842,-5525,-6215,-6907,-7598,-8282,-8965,-9658,-10365,-11087,-11830,-12607,-13445,-14354,-15340,-16364,-17385,-18344,-19191,-19841,-20219,-9058,-9967,-10703,-11149,-11149,-10703,-9967,-9058,-8069,-7045,-6056,-5162,-4375,-3664,-3009,-2411,-1865,-1356,-875,-415,11,390,705,955,1167,1394,1655,1938,2213,2443,2593,2631,2557,2403,2217,2034,1870,1752,1686,1656,1652,1671,1725,1808,1898,1988,2087,2209,2354,2519,2674,2777,2786,2684,2489,2235,1959,1703,1502,1368,1270,1180,1091,1038,1033,1055,1072,1077,1077,1072,1055,1033,1038,1091,1180,1270,1368,1502,1703,1959,2235,2489,2684,2786,2777,2674,2519,2354,2209,2087,1988,1898,1808,1725,1671,1652,1656,1686,1752,1870,2034,2217,2403,2557,2631,2593,2443,2213,1938,1655,1394,1167,955,705,390,11,-415,-875,-1356,-1865,-2411,-3009,-3664,-4375,-5162,-6056,-7045,-8069,-9058,-9967,-10703,-11149,-4016,-4483,-5507,-6477,-6477,-5507,-4483,-4016,-3874,-3602,-3269,-3158,-3175,-2979,-2523,-2053,-1686,-1282,-778,-301,53,294,382,227,-96,-318,-262,13,364,716,943,859,421,-119,-443,-462,-287,-21,268,501,627,731,915,1131,1229,1160,1052,1068,1267,1630,2077,2453,2613,2549,2351,2073,1729,1462,1509,1903,2320,2376,2057,1702,1567,1576,1543,1465,1465,1543,1576,1567,1702,2057,2376,2320,1903,1509,1462,1729,2073,2351,2549,2613,2453,2077,1630,1267,1068,1052,1160,1229,1131,915,731,627,501,268,-21,-287,-462,-443,-119,421,859,943,716,364,13,-262,-318,-96,227,382,294,53,-301,-778,-1282,-1686,-2053,-2523,-2979,-3175,-3158,-3269,-3602,-3874,-4016,-4483,-5507,-6477,-6317,-6712,-7736,-8749,-8749,-7736,-6712,-6317,-6229,-5932,-5543,-5412,-5426,-5175,-4621,-4083,-3689,-3239,-2632,-2037,-1604,-1313,-1150,-1191,-1388,-1502,-1363,-1008,-556,-78,290,333,8,-420,-624,-524,-242,120,514,859,1101,1323,1632,1983,2208,2250,2251,2378,2681,3121,3610,4025,4265,4322,4242,4050,3780,3605,3743,4190,4618,4689,4414,4100,3969,3968,3950,3901,3901,3950,3968,3969,4100,4414,4689,4618,4190,3743,3605,3780,4050,4242,4322,4265,4025,3610,3121,2681,2378,2251,2250,2208,1983,1632,1323,1101,859,514,120,-242,-524,-624,-420,8,333,290,-78,-556,-1008,-1363,-1502,-1388,-1191,-1150,-1313,-1604,-2037,-2632,-3239,-3689,-4083,-4621,-5175,-5426,-5412,-5543,-5932,-6229,-6317,-6712,-7736,-8749,-19345,-19701,-20465,-21212,-21212,-20465,-19701,-19345,-19158,-18760,-18247,-17889,-17619,-17145,-16438,-15715,-15058,-14324,-13457,-12580,-11793,-11054,-10335,-9704,-9167,-8587,-7836,-6922,-5928,-4904,-3941,-3173,-2617,-2101,-1443,-617,295,1259,2267,3257,4160,5022,5937,6885,7745,8462,9117,9831,10653,11549,12446,13265,13943,14481,14919,15266,15525,15793,16205,16774,17317,17634,17715,17723,17795,17921,18018,18058,18058,18018,17921,17795,17723,17715,17634,17317,16774,16205,15793,15525,15266,14919,14481,13943,13265,12446,11549,10653,9831,9117,8462,7745,6885,5937,5022,4160,3257,2267,1259,295,-617,-1443,-2101,-2617,-3173,-3941,-4904,-5928,-6922,-7836,-8587,-9167,-9704,-10335,-11054,-11793,-12580,-13457,-14324,-15058,-15715,-16438,-17145,-17619,-17889,-18247,-18760,-19158,-19345,-19701,-20465,-21212,-10337,-11101,-11660,-11984,-11984,-11660,-11101,-10337,-9445,-8463,-7453,-6429,-5433,-4469,-3560,-2700,-1902,-1159,-483,132,668,1119,1476,1725,1852,1841,1698,1442,1097,699,272,-160,-576,-961,-1304,-1591,-1809,-1953,-2033,-2036,-1973,-1851,-1677,-1449,-1157,-787,-317,254,904,1598,2304,2988,3625,4197,4709,5158,5541,5857,6115,6328,6492,6623,6730,6821,6903,6971,7023,7052,7052,7023,6971,6903,6821,6730,6623,6492,6328,6115,5857,5541,5158,4709,4197,3625,2988,2304,1598,904,254,-317,-787,-1157,-1449,-1677,-1851,-1973,-2036,-2033,-1953,-1809,-1591,-1304,-961,-576,-160,272,699,1097,1442,1698,1841,1852,1725,1476,1119,668,132,-483,-1159,-1902,-2700,-3560,-4469,-5433,-6429,-7453,-8463,-9445,-10337,-11101,-11660,-11984,-7356,-8142,-8738,-9147,-9147,-8738,-8142,-7356,-6493,-5642,-4760,-3808,-2841,-1817,-820,24,708,1223,1560,1842,2128,2370,2598,2753,2764,2708,2609,2473,2397,2358,2252,2088,1794,1337,809,262,-298,-789,-1254,-1765,-2292,-2837,-3366,-3751,-3953,-3975,-3763,-3405,-2965,-2418,-1799,-1103,-286,599,1471,2299,2994,3533,3988,4364,4676,4985,5225,5347,5384,5318,5198,5143,5143,5198,5318,5384,5347,5225,4985,4676,4364,3988,3533,2994,2299,1471,599,-286,-1103,-1799,-2418,-2965,-3405,-3763,-3975,-3953,-3751,-3366,-2837,-2292,-1765,-1254,-789,-298,262,809,1337,1794,2088,2252,2358,2397,2473,2609,2708,2764,2753,2598,2370,2128,1842,1560,1223,708,24,-820,-1817,-2841,-3808,-4760,-5642,-6493,-7356,-8142,-8738,-9147,-7261,-8135,-8813,-9271,-9271,-8813,-8135,-7261,-6313,-5388,-4450,-3459,-2474,-1450,-463,395,1136,1760,2253,2728,3233,3713,4177,4563,4779,4897,4948,4939,4953,4986,4963,4906,4757,4476,4154,3801,3404,3017,2589,2017,1313,473,-458,-1316,-2042,-2607,-2969,-3195,-3345,-3368,-3292,-3121,-2824,-2456,-2088,-1744,-1496,-1333,-1145,-905,-599,-182,233,562,824,965,1006,1041,1041,1006,965,824,562,233,-182,-599,-905,-1145,-1333,-1496,-1744,-2088,-2456,-2824,-3121,-3292,-3368,-3345,-3195,-2969,-2607,-2042,-1316,-458,473,1313,2017,2589,3017,3404,3801,4154,4476,4757,4906,4963,4986,4953,4939,4948,4897,4779,4563,4177,3713,3233,2728,2253,1760,1136,395,-463,-1450,-2474,-3459,-4450,-5388,-6313,-7261,-8135,-8813,-9271,-9051,-10030,-10829,-11318,-11318,-10829,-10030,-9051,-8034,-7037,-6098,-5215,-4405,-3660,-2971,-2315,-1672,-1028,-357,357,1116,1901,2660,3334,3890,4331,4675,4952,5191,5427,5683,5986,6353,6793,7283,7791,8289,8741,9085,9219,9058,8582,7851,6975,6052,5139,4246,3372,2522,1694,878,53,-801,-1701,-2650,-3653,-4677,-5629,-6410,-6921,-7141,-7124,-6961,-6737,-6509,-6313,-6160,-6072,-6072,-6160,-6313,-6509,-6737,-6961,-7124,-7141,-6921,-6410,-5629,-4677,-3653,-2650,-1701,-801,53,878,1694,2522,3372,4246,5139,6052,6975,7851,8582,9058,9219,9085,8741,8289,7791,7283,6793,6353,5986,5683,5427,5191,4952,4675,4331,3890,3334,2660,1901,1116,357,-357,-1028,-1672,-2315,-2971,-3660,-4405,-5215,-6098,-7037,-8034,-9051,-10030,-10829,-11318,-7729,-8753,-9617,-10144,-10144,-9617,-8753,-7729,-6746,-5902,-5234,-4703,-4260,-3845,-3410,-2917,-2366,-1755,-1106,-434,226,873,1509,2139,2774,3402,3988,4516,4961,5326,5625,5892,6147,6392,6616,6814,6994,7166,7301,7333,7184,6815,6254,5584,4884,4222,3625,3086,2578,2073,1546,955,275,-520,-1441,-2447,-3460,-4362,-5062,-5497,-5677,-5675,-5584,-5466,-5360,-5264,-5193,-5145,-5145,-5193,-5264,-5360,-5466,-5584,-5675,-5677,-5497,-5062,-4362,-3460,-2447,-1441,-520,275,955,1546,2073,2578,3086,3625,4222,4884,5584,6254,6815,7184,7333,7301,7166,6994,6814,6616,6392,6147,5892,5625,5326,4961,4516,3988,3402,2774,2139,1509,873,226,-434,-1106,-1755,-2366,-2917,-3410,-3845,-4260,-4703,-5234,-5902,-6746,-7729,-8753,-9617,-10144,-8206,-9230,-10123,-10694,-10694,-10123,-9230,-8206,-7241,-6436,-5866,-5474,-5142,-4767,-4322,-3788,-3170,-2517,-1943,-1503,-1219,-1049,-931,-770,-476,-30,501,1052,1596,2091,2500,2834,3129,3409,3665,3922,4228,4585,4933,5209,5391,5436,5317,5058,4742,4434,4147,3865,3592,3298,2945,2515,2024,1478,873,254,-288,-680,-909,-961,-841,-622,-394,-191,-10,159,276,334,334,276,159,-10,-191,-394,-622,-841,-961,-909,-680,-288,254,873,1478,2024,2515,2945,3298,3592,3865,4147,4434,4742,5058,5317,5436,5391,5209,4933,4585,4228,3922,3665,3409,3129,2834,2500,2091,1596,1052,501,-30,-476,-770,-931,-1049,-1219,-1503,-1943,-2517,-3170,-3788,-4322,-4767,-5142,-5474,-5866,-6436,-7241,-8206,-9230,-10123,-10694,-6999,-7755,-8427,-8923,-8923,-8427,-7755,-6999,-6118,-5094,-4086,-3121,-2127,-1104,-204,526,1157,1668,1948,1972,1817,1533,1118,654,260,-19,-265,-447,-486,-374,-188,82,526,1140,1816,2525,3306,4077,4676,5055,5294,5407,5317,5008,4591,4099,3476,2713,1889,1049,164,-707,-1444,-1984,-2361,-2588,-2607,-2466,-2256,-1999,-1619,-1139,-659,-216,231,658,951,1076,1076,951,658,231,-216,-659,-1139,-1619,-1999,-2256,-2466,-2607,-2588,-2361,-1984,-1444,-707,164,1049,1889,2713,3476,4099,4591,5008,5317,5407,5294,5055,4676,4077,3306,2525,1816,1140,526,82,-188,-374,-486,-447,-265,-19,260,654,1118,1533,1817,1972,1948,1668,1157,526,-204,-1104,-2127,-3121,-4086,-5094,-6118,-6999,-7755,-8427,-8923,-2844,-3638,-4433,-5141,-5141,-4433,-3638,-2844,-2286,-2185,-2159,-1939,-1471,-570,454,1130,1448,1363,942,666,711,995,1454,1747,1597,1157,548,19,-43,303,769,1194,1308,1049,713,495,590,1109,1695,1990,1934,1443,671,67,-210,-168,117,237,-22,-527,-1178,-1705,-1751,-1383,-850,-355,-189,-395,-666,-809,-609,54,835,1409,1696,1564,1160,893,893,1160,1564,1696,1409,835,54,-609,-809,-666,-395,-189,-355,-850,-1383,-1751,-1705,-1178,-527,-22,237,117,-168,-210,67,671,1443,1934,1990,1695,1109,590,495,713,1049,1308,1194,769,303,-43,19,548,1157,1597,1747,1454,995,711,666,942,1363,1448,1130,454,-570,-1471,-1939,-2159,-2185,-2286,-2844,-3638,-4433,-5141,-3499,-4234,-4919,-5676,-5676,-4919,-4234,-3499,-2475,-1776,-1488,-959,-283,199,783,1452,1692,1531,1241,699,-19,-516,-798,-1050,-1165,-1178,-1340,-1552,-1559,-1425,-1161,-577,185,797,1288,1711,1874,1855,1947,2103,2167,2218,2222,1990,1571,1144,753,432,247,176,147,106,26,-67,-112,-103,-45,77,244,379,448,492,531,546,576,659,731,740,740,731,659,576,546,531,492,448,379,244,77,-45,-103,-112,-67,26,106,147,176,247,432,753,1144,1571,1990,2222,2218,2167,2103,1947,1855,1874,1711,1288,797,185,-577,-1161,-1425,-1559,-1552,-1340,-1178,-1165,-1050,-798,-516,-19,699,1241,1531,1692,1452,783,199,-283,-959,-1488,-1776,-2475,-3499,-4234,-4919,-5676,-4975,-5929,-6953,-7814,-7814,-6953,-5929,-4975,-4095,-3498,-3165,-2801,-2343,-1748,-927,-112,395,584,450,-12,-578,-1043,-1379,-1546,-1586,-1698,-1954,-2271,-2634,-2948,-2988,-2659,-2114,-1492,-828,-194,358,871,1396,1929,2462,2997,3446,3673,3624,3342,2905,2395,1885,1466,1177,951,760,672,671,659,687,866,1188,1607,2136,2736,3302,3774,4108,4264,4286,4264,4264,4286,4264,4108,3774,3302,2736,2136,1607,1188,866,687,659,671,672,760,951,1177,1466,1885,2395,2905,3342,3624,3673,3446,2997,2462,1929,1396,871,358,-194,-828,-1492,-2114,-2659,-2988,-2948,-2634,-2271,-1954,-1698,-1586,-1546,-1379,-1043,-578,-12,450,584,395,-112,-927,-1748,-2343,-2801,-3165,-3498,-4095,-4975,-5929,-6953,-7814,-6928,-7860,-8704,-9384,-9384,-8704,-7860,-6928,-5904,-5106,-4608,-4076,-3452,-2844,-2190,-1562,-1224,-1218,-1480,-2002,-2616,-3085,-3386,-3549,-3533,-3452,-3467,-3486,-3391,-3193,-2836,-2175,-1312,-460,348,1088,1612,1978,2362,2729,3004,3255,3424,3353,3132,2921,2677,2440,2383,2450,2502,2616,2798,2901,2971,3153,3379,3584,3866,4166,4329,4425,4553,4635,4687,4827,4956,4976,4976,4956,4827,4687,4635,4553,4425,4329,4166,3866,3584,3379,3153,2971,2901,2798,2616,2502,2450,2383,2440,2677,2921,3132,3353,3424,3255,3004,2729,2362,1978,1612,1088,348,-460,-1312,-2175,-2836,-3193,-3391,-3486,-3467,-3452,-3533,-3549,-3386,-3085,-2616,-2002,-1480,-1218,-1224,-1562,-2190,-2844,-3452,-4076,-4608,-5106,-5904,-6928,-7860,-8704,-9384,-16974,-17487,-18008,-18713,-18713,-18008,-17487,-16974,-16042,-15133,-14387,-13406,-12486,-11909,-11228,-10449,-10067,-9866,-9521,-9345,-9338,-9127,-8879,-8780,-8488,-7965,-7559,-7106,-6363,-5571,-4792,-3797,-2773,-1907,-960,50,849,1600,2486,3281,3952,4678,5332,5869,6481,7088,7518,7957,8497,8957,9359,9825,10269,10667,11118,11588,12039,12540,13063,13524,13951,14353,14672,14945,15225,15455,15590,15649,15649,15590,15455,15225,14945,14672,14353,13951,13524,13063,12540,12039,11588,11118,10667,10269,9825,9359,8957,8497,7957,7518,7088,6481,5869,5332,4678,3952,3281,2486,1600,849,50,-960,-1907,-2773,-3797,-4792,-5571,-6363,-7106,-7559,-7965,-8488,-8780,-8879,-9127,-9338,-9345,-9521,-9866,-10067,-10449,-11228,-11909,-12486,-13406,-14387,-15133,-16042,-16974,-17487,-18008,-18713,-14011,-14613,-15136,-15657,-15657,-15136,-14613,-14011,-13172,-12423,-11878,-11211,-10454,-9817,-9210,-8588,-8172,-7972,-7850,-7817,-7880,-7863,-7734,-7569,-7307,-6891,-6456,-5988,-5364,-4639,-3897,-2997,-1973,-1043,-164,744,1491,2053,2645,3209,3628,4073,4584,4979,5296,5667,5992,6248,6603,7042,7464,7948,8491,8953,9374,9835,10235,10536,10889,11248,11476,11698,11981,12136,12182,12314,12400,12336,12336,12400,12314,12182,12136,11981,11698,11476,11248,10889,10536,10235,9835,9374,8953,8491,7948,7464,7042,6603,6248,5992,5667,5296,4979,4584,4073,3628,3209,2645,2053,1491,744,-164,-1043,-1973,-2997,-3897,-4639,-5364,-5988,-6456,-6891,-7307,-7569,-7734,-7863,-7880,-7817,-7850,-7972,-8172,-8588,-9210,-9817,-10454,-11211,-11878,-12423,-13172,-14011,-14613,-15136,-15657,-17928,-18524,-19085,-19500,-19500,-19085,-18524,-17928,-17359,-16925,-16636,-16302,-15809,-15174,-14445,-13676,-12968,-12408,-11990,-11619,-11197,-10706,-10120,-9401,-8619,-7877,-7183,-6488,-5787,-5039,-4187,-3219,-2195,-1182,-203,726,1573,2351,3147,3977,4790,5583,6365,7080,7685,8235,8766,9280,9800,10358,10922,11453,11934,12372,12789,13180,13559,13954,14351,14698,14992,15255,15465,15614,15738,15860,15938,15964,15964,15938,15860,15738,15614,15465,15255,14992,14698,14351,13954,13559,13180,12789,12372,11934,11453,10922,10358,9800,9280,8766,8235,7685,7080,6365,5583,4790,3977,3147,2351,1573,726,-203,-1182,-2195,-3219,-4187,-5039,-5787,-6488,-7183,-7877,-8619,-9401,-10120,-10706,-11197,-11619,-11990,-12408,-12968,-13676,-14445,-15174,-15809,-16302,-16636,-16925,-17359,-17928,-18524,-19085,-19500,-19438,-19943,-20335,-20614,-20614,-20335,-19943,-19438,-18847,-18248,-17664,-17032,-16358,-15675,-14985,-14302,-13663,-13078,-12560,-12073,-11570,-11033,-10445,-9775,-9040,-8285,-7516,-6706,-5865,-4995,-4071,-3080,-2056,-1035,-22,966,1890,2764,3623,4465,5266,6042,6801,7504,8139,8741,9313,9859,10398,10947,11492,12010,12497,12955,13393,13805,14184,14556,14907,15205,15471,15724,15928,16083,16223,16333,16398,16430,16430,16398,16333,16223,16083,15928,15724,15471,15205,14907,14556,14184,13805,13393,12955,12497,12010,11492,10947,10398,9859,9313,8741,8139,7504,6801,6042,5266,4465,3623,2764,1890,966,-22,-1035,-2056,-3080,-4071,-4995,-5865,-6706,-7516,-8285,-9040,-9775,-10445,-11033,-11570,-12073,-12560,-13078,-13663,-14302,-14985,-15675,-16358,-17032,-17664,-18248,-18847,-19438,-19943,-20335,-20614,-19700,-20124,-20524,-20851,-20851,-20524,-20124,-19700,-19248,-18865,-18582,-18231,-17721,-17077,-16326,-15483,-14628,-13844,-13139,-12453,-11728,-10929,-10037,-9045,-8021,-7054,-6156,-5281,-4421,-3564,-2645,-1651,-674,240,1136,1993,2753,3471,4225,4990,5728,6461,7173,7802,8352,8868,9379,9902,10436,10966,11475,11934,12325,12680,13038,13382,13710,14048,14371,14634,14848,15035,15177,15283,15394,15519,15615,15660,15660,15615,15519,15394,15283,15177,15035,14848,14634,14371,14048,13710,13382,13038,12680,12325,11934,11475,10966,10436,9902,9379,8868,8352,7802,7173,6461,5728,4990,4225,3471,2753,1993,1136,240,-674,-1651,-2645,-3564,-4421,-5281,-6156,-7054,-8021,-9045,-10037,-10929,-11728,-12453,-13139,-13844,-14628,-15483,-16326,-17077,-17721,-18231,-18582,-18865,-19248,-19700,-20124,-20524,-20851,16913,17897,18905,19929,19097,18274,17466,16667,15875,15100,14333,13573,12822,12087,11360,10641,9938,9243,8556,7885,7222,6575,5936,5305,4691,4084,3493,2911,2344,1786,1243,709,191,-319,-814,-1300,-1770,-2232,-2678,-3116,-3538,-3952,-4350,-4731,-5105,-5463,-5812,-6146,-6463,-6773,-7066,-7344,-7613,-7866,-8103,-8332,-8545,-8742,-8931,-9104,-9261,-9402,-9535,-9651,-9752,-9836,-9905,-9965,-10010,-10038,-10050,-10046,-10026,-9999,-9955,-9894,-9818,-9726,-9618,-9494,-9353,-9197,-9024,-8836,-8631,-8418,-8190,-7945,-7684,-7407,-7114,-6797,-6464,-6114,-5749,-5368,-4970,-4557,-4127,-3682,-3220,-2742,-2248,-1730,-1196,-646,-80,502,1100,1723,2361,3016,3686,4373,5083,5810,6553,7312,8095,8894,9709,10548,11404,12275,13163,14074,15002,15945,16913,17897,18905,19929,29437,30461,31485,32509,31501,30493,29485,28477,27469,26461,25453,24445,23436,22428,21420,20412,19404,18396,17388,16380,15372,14364,13356,12348,11340,10332,9324,8316,7307,6299,5291,4283,3275,2267,1259,251,-757,-1765,-2773,-3781,-4789,-5797,-6805,-7813,-8822,-9830,-10838,-11846,-12854,-13862,-14870,-15878,-16886,-17894,-18902,-19910,-20918,-21926,-22934,-23942,-24951,-25959,-26967,-27975,-28983,-29991,-30999,-32007,-32003,-30979,-29955,-28931,-27907,-26883,-25859,-24835,-23811,-22787,-21763,-20739,-19715,-18691,-17667,-16643,-15619,-14595,-13571,-12547,-11523,-10499,-9475,-8451,-7427,-6403,-5379,-4355,-3331,-2307,-1283,-259,765,1789,2813,3837,4861,5885,6909,7933,8957,9981,11005,12029,13053,14077,15101,16125,17149,18173,19197,20221,21245,22269,23293,24317,25341,26365,27389,28413,29437,30461,31485,32509,9219,10122,11074,12083,11059,10083,9163,8292,7469,6694,5975,5304,4682,4100,3566,3080,2634,2229,1863,1538,1253,1000,779,591,434,302,194,109,49,5,-23,-35,-39,-34,-22,-10,10,22,34,39,35,23,-5,-49,-109,-194,-302,-434,-591,-779,-1000,-1253,-1538,-1863,-2229,-2634,-3080,-3566,-4100,-4682,-5304,-5975,-6694,-7469,-8292,-9163,-10083,-11059,-12083,-11074,-10122,-9219,-8363,-7556,-6805,-6102,-5447,-4832,-4266,-3748,-3270,-2832,-2434,-2076,-1759,-1474,-1221,-1000,-811,-646,-505,-389,-296,-220,-159,-115,-79,-51,-30,-10,10,30,51,79,115,159,220,296,389,505,646,811,1000,1221,1474,1759,2076,2434,2832,3270,3748,4266,4832,5447,6102,6805,7556,8363,9219,10122,11074,12083,-19411,-19801,-20191,-20580,-20577,-20573,-20570,-20566,-20563,-20559,-20556,-20552,-20163,-19775,-19386,-18997,-18608,-18219,-17830,-17442,-16716,-15990,-15264,-14538,-13812,-13086,-12360,-11634,-10691,-9748,-8806,-7863,-6920,-5977,-5035,-4092,-3069,-2046,-1023,0,1023,2046,3069,4092,5035,5977,6920,7863,8806,9748,10691,11634,12360,13086,13812,14538,15264,15990,16716,17442,17830,18219,18608,18997,19386,19775,20163,20552,20556,20559,20563,20566,20570,20573,20577,20580,20191,19801,19411,19021,18631,18241,17852,17462,16735,16008,15281,14554,13827,13100,12373,11646,10702,9758,8815,7871,6927,5983,5040,4096,3072,2048,1024,0,-1024,-2048,-3072,-4096,-5040,-5983,-6927,-7871,-8815,-9758,-10702,-11646,-12373,-13100,-13827,-14554,-15281,-16008,-16735,-17462,-17852,-18241,-18631,-19021,-19411,-19801,-20191,-20580,-20556,-20705,-20805,-20857,-20861,-20809,-20709,-20560,-20364,-20119,-19817,-19476,-19087,-18649,-18163,-17637,-17071,-16464,-15818,-15131,-14404,-13645,-12854,-12031,-11176,-10296,-9393,-8465,-7521,-6554,-5570,-4578,-3570,-2554,-1538,-514,510,1534,2550,3566,4574,5566,6550,7517,8461,9389,10292,11172,12027,12850,13641,14400,15127,15814,16460,17067,17633,18159,18645,19083,19472,19813,20115,20360,20556,20705,20805,20857,20861,20809,20709,20560,20364,20119,19817,19476,19087,18649,18163,17637,17071,16464,15818,15131,14404,13645,12854,12031,11176,10296,9393,8465,7521,6554,5570,4578,3570,2554,1538,514,-510,-1534,-2550,-3566,-4574,-5566,-6550,-7517,-8461,-9389,-10292,-11172,-12027,-12850,-13641,-14400,-15127,-15814,-16460,-17067,-17633,-18159,-18645,-19083,-19472,-19813,-20115,-20360,-20556,-20705,-20805,-20857,-13901,-13905,-13909,-13913,-13910,-13906,-13902,-13898,-13894,-13882,-13854,-13818,-13757,-13681,-13573,-13432,-13260,-13047,-12786,-12477,-12112,-11698,-11228,-10694,-10104,-9458,-8755,-7996,-7189,-6334,-5439,-4503,-3535,-2544,-1536,-512,512,1536,2544,3535,4503,5439,6334,7189,7996,8755,9458,10104,10694,11228,11698,12112,12477,12786,13047,13260,13432,13573,13681,13757,13818,13854,13882,13894,13898,13902,13906,13910,13913,13909,13905,13901,13897,13885,13857,13821,13760,13684,13576,13435,13262,13049,12788,12479,12114,11700,11230,10696,10106,9459,8756,7997,7190,6335,5439,4504,3536,2544,1536,512,-512,-1536,-2544,-3536,-4504,-5439,-6335,-7190,-7997,-8756,-9459,-10106,-10696,-11230,-11700,-12114,-12479,-12788,-13049,-13262,-13435,-13576,-13684,-13760,-13821,-13857,-13885,-13897,-13901,-13905,-13909,-13913,-11131,-11135,-11139,-11143,-11139,-11135,-11131,-11127,-11123,-11119,-11115,-11111,-11099,-11087,-11067,-11031,-10979,-10903,-10794,-10654,-10473,-10244,-9959,-9618,-9213,-8735,-8185,-7571,-6884,-6125,-5302,-4423,-3495,-2528,-1528,-512,512,1528,2528,3495,4423,5302,6125,6884,7571,8185,8735,9213,9618,9959,10244,10473,10654,10794,10903,10979,11031,11067,11087,11099,11111,11115,11119,11123,11127,11131,11135,11139,11143,11139,11135,11131,11127,11122,11118,11114,11102,11090,11070,11034,10981,10905,10797,10656,10475,10246,9961,9620,9214,8736,8186,7572,6885,6126,5303,4423,3496,2528,1528,512,-512,-1528,-2528,-3496,-4423,-5303,-6126,-6885,-7572,-8186,-8736,-9214,-9620,-9961,-10246,-10475,-10656,-10797,-10905,-10981,-11034,-11070,-11090,-11102,-11114,-11118,-11122,-11127,-11131,-11135,-11139,-11143,2976,2016,1024,0,-1024,-2016,-2976,-3903,-4799,-5662,-6493,-7292,-8059,-8794,-9497,-10160,-10790,-11388,-11955,-12489,-12991,-13461,-13898,-14304,-14677,-15019,-15328,-15605,-15850,-16063,-16243,-16392,-16508,-16593,-16645,-16665,-16645,-16593,-16508,-16392,-16243,-16063,-15850,-15605,-15328,-15019,-14677,-14304,-13898,-13461,-12991,-12489,-11955,-11388,-10790,-10160,-9497,-8794,-8059,-7292,-6493,-5662,-4799,-3903,-2976,-2016,-1024,0,1024,2016,2976,3903,4799,5662,6493,7292,8059,8794,9497,10160,10790,11388,11955,12489,12991,13461,13898,14304,14677,15019,15328,15605,15850,16063,16243,16392,16508,16593,16645,16665,16645,16593,16508,16392,16243,16063,15850,15605,15328,15019,14677,14304,13898,13461,12991,12489,11955,11388,10790,10160,9497,8794,8059,7292,6493,5662,4799,3903,2976,2016,1024,0,7102,8045,9029,10053,9222,8406,7614,6847,6096,5368,4665,3978,3315,2676,2061,1471,904,362,-157,-651,-1121,-1568,-1990,-2387,-2761,-3103,-3420,-3714,-3975,-4212,-4418,-4599,-4747,-4872,-4965,-5033,-5070,-5074,-5046,-4994,-4910,-4794,-4646,-4465,-4252,-4008,-3731,-3422,-3081,-2707,-2302,-1864,-1387,-877,-335,248,862,1516,2203,2930,3689,4488,5319,6190,7102,8045,9029,10053,9222,8406,7614,6847,6096,5368,4665,3978,3315,2676,2061,1471,904,362,-157,-651,-1121,-1568,-1990,-2387,-2761,-3103,-3420,-3714,-3975,-4212,-4418,-4599,-4747,-4872,-4965,-5033,-5070,-5074,-5046,-4994,-4910,-4794,-4646,-4465,-4252,-4008,-3731,-3422,-3081,-2707,-2302,-1864,-1387,-877,-335,248,862,1516,2203,2930,3689,4488,5319,6190,7102,8045,9029,10053,13051,14075,15099,16123,15131,14138,13146,12154,11161,10169,9176,8184,7192,6199,5207,4215,3222,2230,1238,245,-747,-1740,-2732,-3724,-4717,-5709,-6701,-7694,-8686,-9679,-10671,-11663,-12656,-13648,-14640,-15633,-15621,-14597,-13573,-12549,-11525,-10501,-9477,-8453,-7429,-6405,-5381,-4357,-3333,-2309,-1285,-261,763,1787,2811,3835,4859,5883,6907,7931,8955,9979,11003,12027,13051,14075,15099,16123,15131,14138,13146,12154,11161,10169,9176,8184,7192,6199,5207,4215,3222,2230,1238,245,-747,-1740,-2732,-3724,-4717,-5709,-6701,-7694,-8686,-9679,-10671,-11663,-12656,-13648,-14640,-15633,-15621,-14597,-13573,-12549,-11525,-10501,-9477,-8453,-7429,-6405,-5381,-4357,-3333,-2309,-1285,-261,763,1787,2811,3835,4859,5883,6907,7931,8955,9979,11003,12027,13051,14075,15099,16123,3484,4267,5155,6139,5115,4196,3381,2662,2040,1514,1076,719,442,237,89,-3,-47,-59,-47,-18,18,47,59,47,3,-89,-237,-442,-719,-1076,-1514,-2040,-2662,-3381,-4196,-5115,-6139,-5155,-4267,-3484,-2796,-2206,-1703,-1281,-940,-670,-457,-300,-184,-107,-55,-18,18,55,107,184,300,457,670,940,1281,1703,2206,2796,3484,4267,5155,6139,5115,4196,3381,2662,2040,1514,1076,719,442,237,89,-3,-47,-59,-47,-18,18,47,59,47,3,-89,-237,-442,-719,-1076,-1514,-2040,-2662,-3381,-4196,-5115,-6139,-5155,-4267,-3484,-2796,-2206,-1703,-1281,-940,-670,-457,-300,-184,-107,-55,-18,18,55,107,184,300,457,670,940,1281,1703,2206,2796,3484,4267,5155,6139,-9121,-9511,-9900,-10290,-10287,-10283,-10280,-10276,-9887,-9498,-9110,-8721,-7995,-7269,-6543,-5817,-4874,-3931,-2989,-2046,-1023,0,1023,2046,2989,3931,4874,5817,6543,7269,7995,8721,9110,9498,9887,10276,10280,10283,10287,10290,9900,9511,9121,8731,8004,7277,6550,5823,4879,3935,2992,2048,1024,0,-1024,-2048,-2992,-3935,-4879,-5823,-6550,-7277,-8004,-8731,-9121,-9511,-9900,-10290,-10287,-10283,-10280,-10276,-9887,-9498,-9110,-8721,-7995,-7269,-6543,-5817,-4874,-3931,-2989,-2046,-1023,0,1023,2046,2989,3931,4874,5817,6543,7269,7995,8721,9110,9498,9887,10276,10280,10283,10287,10290,9900,9511,9121,8731,8004,7277,6550,5823,4879,3935,2992,2048,1024,0,-1024,-2048,-2992,-3935,-4879,-5823,-6550,-7277,-8004,-8731,-9121,-9511,-9900,-10290,-9829,-10130,-10327,-10427,-10424,-10323,-10127,-9826,-9436,-8951,-8385,-7738,-7012,-6221,-5366,-4462,-3519,-2535,-1528,-512,512,1528,2535,3519,4462,5366,6221,7012,7738,8385,8951,9436,9826,10127,10323,10424,10427,10327,10130,9829,9439,8953,8387,7740,7013,6222,5367,4463,3520,2536,1528,512,-512,-1528,-2536,-3520,-4463,-5367,-6222,-7013,-7740,-8387,-8953,-9439,-9829,-10130,-10327,-10427,-10424,-10323,-10127,-9826,-9436,-8951,-8385,-7738,-7012,-6221,-5366,-4462,-3519,-2535,-1528,-512,512,1528,2535,3519,4462,5366,6221,7012,7738,8385,8951,9436,9826,10127,10323,10424,10427,10327,10130,9829,9439,8953,8387,7740,7013,6222,5367,4463,3520,2536,1528,512,-512,-1528,-2536,-3520,-4463,-5367,-6222,-7013,-7740,-8387,-8953,-9439,-9829,-10130,-10327,-10427,-6922,-6950,-6954,-6958,-6954,-6950,-6947,-6919,-6859,-6750,-6578,-6317,-5952,-5482,-4892,-4189,-3382,-2487,-1520,-512,512,1520,2487,3382,4189,4892,5482,5952,6317,6578,6750,6859,6919,6947,6950,6954,6958,6954,6950,6922,6861,6753,6580,6319,5953,5484,4893,4190,3383,2488,1520,512,-512,-1520,-2488,-3383,-4190,-4893,-5484,-5953,-6319,-6580,-6753,-6861,-6922,-6950,-6954,-6958,-6954,-6950,-6947,-6919,-6859,-6750,-6578,-6317,-5952,-5482,-4892,-4189,-3382,-2487,-1520,-512,512,1520,2487,3382,4189,4892,5482,5952,6317,6578,6750,6859,6919,6947,6950,6954,6958,6954,6950,6922,6861,6753,6580,6319,5953,5484,4893,4190,3383,2488,1520,512,-512,-1520,-2488,-3383,-4190,-4893,-5484,-5953,-6319,-6580,-6753,-6861,-6922,-6950,-6954,-6958,-5565,-5569,-5573,-5577,-5573,-5569,-5565,-5561,-5550,-5530,-5478,-5369,-5189,-4904,-4498,-3948,-3262,-2439,-1512,-512,512,1512,2439,3262,3948,4498,4904,5189,5369,5478,5530,5550,5561,5565,5569,5573,5577,5573,5569,5565,5552,5532,5480,5371,5191,4905,4500,3950,3263,2440,1512,512,-512,-1512,-2440,-3263,-3950,-4500,-4905,-5191,-5371,-5480,-5532,-5552,-5565,-5569,-5573,-5577,-5573,-5569,-5565,-5561,-5550,-5530,-5478,-5369,-5189,-4904,-4498,-3948,-3262,-2439,-1512,-512,512,1512,2439,3262,3948,4498,4904,5189,5369,5478,5530,5550,5561,5565,5569,5573,5577,5573,5569,5565,5552,5532,5480,5371,5191,4905,4500,3950,3263,2440,1512,512,-512,-1512,-2440,-3263,-3950,-4500,-4905,-5191,-5371,-5480,-5532,-5552,-5565,-5569,-5573,-5577,3044,2181,1253,261,-763,-1723,-2618,-3449,-4216,-4919,-5550,-6116,-6618,-7056,-7429,-7738,-7983,-8164,-8280,-8333,-8312,-8228,-8080,-7867,-7590,-7248,-6843,-6373,-5839,-5240,-4578,-3843,-3044,-2181,-1253,-261,763,1723,2618,3449,4216,4919,5550,6116,6618,7056,7429,7738,7983,8164,8280,8333,8312,8228,8080,7867,7590,7248,6843,6373,5839,5240,4578,3843,3044,2181,1253,261,-763,-1723,-2618,-3449,-4216,-4919,-5550,-6116,-6618,-7056,-7429,-7738,-7983,-8164,-8280,-8333,-8312,-8228,-8080,-7867,-7590,-7248,-6843,-6373,-5839,-5240,-4578,-3843,-3044,-2181,-1253,-261,763,1723,2618,3449,4216,4919,5550,6116,6618,7056,7429,7738,7983,8164,8280,8333,8312,8228,8080,7867,7590,7248,6843,6373,5839,5240,4578,3843,3044,2181,1253,261]);
const PL_WORD_BANK_0 = Uint8Array.from([0x30,0x4a,0x57,0xd8,0x23,0x2c,0xc9,0xa9,0x62,0xa1,0x88,0xb2,0x36,0xa7,0xca,0x95,0xc3,0xc3,0x66,0x9f,0xb2,0x64,0x09,0x4f,0x9b,0x7d,0x8a,0x52,0x24,0x35,0xb3,0xec,0xc9,0x6b,0x92,0xb2,0xe8,0xb0,0x27,0xcf,0x41,0x2a,0x63,0xcc,0x9e,0x22,0x3b,0x8d,0xf2,0x0e,0x7b,0xca,0x1c,0x34,0xca,0xda,0xec,0x29,0xb3,0xb7,0x28,0x6b,0xb3,0xa7,0xce,0xc1,0xbc,0xb2,0xad,0x9e,0x2e,0x05,0xcd,0x8c,0x96,0x7a,0xfa,0xe4,0xcd,0x3b,0xd3,0xcc,0xe9,0x8b,0x76,0xab,0xa8,0xd2,0x67,0xac,0x5e,0xdc,0x63,0xe2,0x9c,0xa9,0x45,0x71,0xd3,0x8e,0x72,0xa6,0xee,0x44,0x43,0x6a,0x2a,0xc0,0x98,0x07,0x0b,0xb5,0xb0,0x38,0x6d,0xae,0x5a,0x38,0x7d,0x8a,0x00,0x00,0xfc,0xa3,0x0d,0xa3,0x9a,0x39,0x23,0x9f,0xcc,0xd7,0x0d,0x57,0x8b,0x73,0x92,0x50,0x2e,0x8d,0xad,0xc9,0x89,0x43,0x99,0x74,0x8c,0xba,0x23,0xf6,0xc3,0xd3,0xc8,0x1b,0x8d,0xc4,0x4f,0xb7,0x64,0x9d,0x3c,0x92,0x30,0x92,0x4b,0x69,0xf2,0xc8,0xc2,0x54,0x69,0x91,0x39,0xab,0x08,0xc3,0xa9,0x8c,0xeb,0x8e,0x3a,0x4e,0xaa,0xc2,0x2c,0xd3,0xda,0x38,0xb0,0x92,0xb3,0xe8,0xe8,0x63,0xa3,0x0a,0x8d,0x30,0xa3,0x4f,0x85,0xda,0x3d,0x83,0xac,0x21,0x67,0x6a,0xb3,0x0a,0xb3,0x86,0x92,0xb0,0xdc,0x33,0xcc,0x18,0xb3,0xa3,0x8c,0xd6,0xc0,0x6b,0x2c,0x01,0xd3,0x3a,0x2d,0x8d,0x29,0x4b,0x4a,0x5d,0xb5,0x5c,0x66,0xcb,0x6d,0xd9,0x2c,0x49,0x99,0x8d,0xb4,0xd1,0x34,0x36,0x69,0xe1,0xc6,0x2a,0xd2,0x91,0xa4,0x95,0x1b,0xcf,0xce,0x82,0xdb,0xd6,0x28,0x39,0xbc,0xc5,0xb1,0x03,0x02,0xe5,0x48,0xc0,0x0c,0x42,0x0e,0x18,0xa7,0x4b,0x01,0x73,0xa7,0x01,0x00,0xfc,0xa9,0xda,0x94,0xdc,0x32,0xe4,0xb6,0xaa,0x03,0xf2,0xe8,0xb2,0x3b,0x8a,0x01,0xb8,0xb2,0xc7,0xea,0xca,0x33,0x36,0xef,0x0e,0x31,0x27,0x2f,0x92,0x3d,0x3b,0xa5,0x9c,0xac,0x78,0xca,0xae,0xb0,0x7c,0xb2,0x1a,0x39,0x23,0xd3,0xca,0xc9,0x4a,0x96,0x28,0x6b,0x2b,0x27,0xcb,0x59,0x33,0xac,0xc2,0x9c,0x3c,0x57,0x2b,0xb3,0xb6,0x72,0xf2,0xd4,0x2c,0xdd,0x2a,0xcc,0xca,0x63,0x4e,0x37,0x8d,0x28,0xad,0x08,0x3e,0x9a,0xa4,0x23,0x8f,0x3a,0xd4,0x0a,0xe6,0xae,0xdc,0x6a,0x5f,0xcb,0x59,0x3a,0xca,0x68,0x43,0x19,0x55,0xa9,0xb2,0xa3,0x0b,0x3d,0xd5,0x3c,0xa3,0xae,0x2e,0x94,0x51,0xf3,0x8a,0xb2,0xfa,0x58,0xd3,0xdc,0x2a,0xec,0xe9,0x53,0x8a,0x92,0x68,0x2b,0x67,0x48,0x29,0x53,0xbd,0xc2,0x9c,0x21,0x87,0x4a,0xd3,0x18,0x73,0xc6,0x1c,0xb2,0x5c,0x7d,0xcc,0x19,0xb3,0xaf,0x72,0x93,0x31,0x6b,0xcc,0x3e,0xda,0x55,0xa6,0xac,0x29,0xbb,0x2a,0x33,0xae,0x3c,0xa6,0xe4,0x2b,0x4d,0xa5,0x72,0x9b,0x63,0xee,0x14,0xb1,0xca,0x61,0x8d,0xb5,0x9d,0x58,0x2a,0x9b,0x29,0x84,0x0a,0x64,0xae,0xa2,0xa6,0xe8,0xda,0xd0,0xc9,0x0a,0x00,0xc0,0xff,0x80,0x1a,0xf0,0xd7,0x88,0x25,0x8d,0x68,0x40,0x37,0x9f,0x4a,0x4b,0xa5,0xce,0x37,0xdd,0xd5,0x62,0xaf,0xb2,0x94,0x74,0x17,0xb6,0x3d,0x6a,0x1f,0xdc,0xc2,0x23,0x4e,0x2b,0x4d,0xe5,0xcc,0x08,0x27,0xa5,0xb0,0x05,0xab,0xcd,0x63,0xb7,0xc2,0x47,0x8a,0x71,0x2f,0xb2,0x0a,0xef,0xd4,0xb6,0x38,0xf4,0x2a,0x92,0x21,0xdf,0xb4,0xc0,0xa7,0xc8,0x9a,0x6c,0x5b,0x43,0x9f,0x22,0x6b,0xb2,0x19,0x0b,0x7d,0xea,0xaa,0x48,0x7b,0xdc,0xf4,0xe9,0xaa,0x22,0xeb,0x36,0x2b,0x67,0x68,0x86,0x34,0xdb,0xac,0x9c,0xa1,0x1b,0x92,0x6c,0x8b,0x73,0x86,0x61,0x98,0xb3,0x3d,0xce,0x19,0xba,0x25,0x8d,0x8c,0x28,0x67,0xea,0x9e,0x2c,0x3c,0xe3,0x8c,0xa9,0x7a,0x92,0xd4,0x2c,0x33,0xa6,0xe2,0xd0,0x5c,0x3b,0xea,0x98,0x6b,0x40,0x57,0x1b,0x3b,0x6b,0xae,0x91,0x4c,0xb4,0x93,0xb6,0x29,0x19,0x0a,0x8f,0x56,0x92,0xca,0xa0,0xc5,0xad,0x3c,0x76,0xf0,0x9b,0x56,0x47,0xb7,0x35,0x00,0x00,0xff,0xa2,0x81,0x39,0xd2,0x2c,0xa3,0xa8,0x12,0x14,0x2f,0xf5,0xb4,0xa2,0x4a,0xd2,0x39,0x3d,0xcd,0x71,0xcb,0xbb,0x4e,0x17,0xb5,0x26,0x2b,0x8b,0x2a,0xd3,0xc2,0xcb,0xac,0x3a,0xe8,0x4d,0x53,0xab,0xda,0x2a,0xaf,0xde,0xd1,0xa3,0x72,0x29,0x9d,0xfc,0x20,0xf7,0x3a,0xa5,0x70,0x62,0x4b,0x5d,0xe3,0x94,0x5c,0x9b,0x09,0x53,0xaf,0x33,0x72,0xa7,0x3a,0xc4,0xa3,0xce,0x28,0x8c,0xdb,0x70,0xc9,0xd2,0xa3,0x50,0x61,0x3a,0x39,0x2a,0xaf,0x5a,0xfb,0xae,0xd2,0x2a,0x7c,0x5a,0xe7,0xc2,0x23,0xbb,0xd2,0xe9,0x92,0x72,0x77,0xcf,0x45,0xa7,0xcf,0xca,0x4d,0xc3,0x57,0x9e,0x3e,0x49,0x0b,0x0f,0x5b,0x78,0x86,0xa4,0x2d,0xdc,0xec,0xf6,0x1a,0xa2,0xf6,0x70,0xb5,0xdb,0x6d,0x08,0x3e,0x5d,0xd9,0x6e,0xb7,0x31,0xa4,0x54,0x56,0xaf,0x13,0x46,0xef,0xd2,0x4c,0xb5,0xb6,0x99,0xa2,0x0b,0x55,0xe5,0x70,0x66,0x8e,0xc9,0x82,0x49,0xa3,0xb2,0x49,0x07,0x4d,0x61,0xb7,0x0b,0x00,0xf0,0xae,0xa8,0x86,0xbc,0x33,0x94,0x9e,0x62,0x04,0x43,0x8b,0xae,0x7b,0x8a,0xa6,0x48,0x63,0xda,0xca,0xc9,0x47,0x74,0x62,0xef,0x26,0x27,0xef,0x8a,0xd5,0xbb,0x2d,0x8f,0x2c,0x49,0x72,0xef,0xb2,0x3d,0x92,0x20,0x39,0xb3,0xd2,0x76,0x4b,0x9c,0x92,0xf2,0x4d,0x86,0x25,0x51,0x56,0xc6,0x57,0x6c,0xa5,0x8c,0x26,0x1f,0x2b,0x72,0x14,0x32,0x12,0xa2,0xd3,0x9d,0xce,0xca,0x87,0x4d,0x15,0x6d,0xab,0xa7,0xa8,0x86,0xcd,0x6a,0x6c,0x9f,0x2a,0x1b,0xb6,0xae,0xb6,0x72,0xaa,0x62,0xd8,0xb2,0xdb,0xce,0x69,0xab,0x65,0xa9,0x9c,0x28,0xad,0xcf,0x9a,0x22,0xbd,0x95,0xa8,0x91,0x29,0xeb,0xc9,0x90,0x4c,0x00,0x6c,0xa9,0x03,0x90,0x03,0xf9,0xca,0x8b,0x13,0xce,0xec,0x2a,0x67,0x28,0x4a,0xad,0x3d,0x8b,0x9c,0x21,0x5b,0xb7,0xf0,0xae,0x72,0x86,0xe8,0x2c,0x23,0x26,0xca,0x19,0x83,0x2f,0x0f,0xef,0xd2,0x67,0x8c,0x21,0x3d,0xbc,0xaa,0x9c,0x31,0xa4,0x54,0x8f,0xaa,0x72,0xc6,0x10,0x46,0xdd,0x73,0xd2,0x19,0x83,0x5f,0x35,0xcf,0xca,0x67,0x4c,0x31,0x8a,0xa5,0x5a,0x9d,0x29,0xc6,0x2c,0xd6,0x6c,0x39,0xa6,0x98,0x33,0x49,0x6b,0xe5,0x98,0x42,0xaa,0x44,0x8d,0x56,0x63,0x0a,0xb9,0x02,0x35,0x5b,0x8e,0xc5,0xd5,0x74,0xd6,0x6e,0xa4,0x96,0xe4,0xc3,0xcd,0x3c,0x09,0x00,0xfc,0xa9,0x11,0x36,0xb3,0x5c,0x23,0xa6,0x2e,0x48,0x73,0x55,0x4b,0x5a,0x9a,0xa4,0x5d,0x4d,0xd9,0xc9,0x68,0xaa,0x32,0x77,0x27,0x2b,0xab,0xae,0x32,0x22,0x1c,0x1d,0x9f,0x32,0xd9,0x88,0x14,0xa9,0x73,0xca,0x18,0xcb,0x43,0x6d,0xea,0xa9,0xe2,0x28,0x0d,0xcd,0x2a,0xa7,0x8a,0x3b,0xb8,0x22,0x43,0x9f,0x3c,0xf6,0xd2,0xd2,0x1c,0x7d,0xf2,0xd8,0xd2,0x4b,0xaa,0xf4,0xc9,0x53,0x1e,0xa9,0xb4,0x4a,0x27,0x4f,0x2d,0x74,0xd2,0x23,0x9f,0x3c,0xd5,0xd0,0xf1,0x0c,0x73,0xca,0x9c,0x2c,0xca,0x26,0xcc,0xa9,0x4a,0x74,0x2b,0x9b,0x2a,0xa7,0xc9,0xd1,0x3c,0x7d,0xad,0x9c,0x2e,0x9b,0xd2,0xb4,0x2a,0x7d,0xfa,0x24,0x47,0xc3,0xa3,0xca,0xe9,0x33,0x1f,0x57,0xb5,0x39,0x6b,0x88,0xba,0xdc,0xb8,0xea,0x9c,0x21,0xe9,0x54,0xd7,0xae,0x72,0x86,0xa4,0x53,0x43,0xbb,0xca,0x19,0x8a,0xd2,0x28,0xe9,0x2a,0x67,0x2c,0xd6,0xcc,0x6d,0xaa,0x9e,0x39,0x6b,0xd7,0xb0,0x1a,0x72,0xd6,0x64,0xdc,0xc2,0x6b,0x6c,0x1a,0xa2,0x57,0xb5,0x98,0xa2,0xa6,0x51,0xcd,0xc3,0x35,0xac,0x08,0x20,0x11,0x4d,0x06,0x34,0x2e,0xc6,0x80,0x2c,0xdc,0x08,0x90,0x94,0x39,0x00,0xc0,0xff]);
const PL_WORD_BANK_1 = Uint8Array.from([0x69,0xfc,0x59,0xdd,0x51,0xd5,0xd7,0xa1,0x8f,0x0a,0x78,0xc0,0x52,0x01,0x0f,0x50,0xac,0xfc,0xa8,0x16,0x15,0xf2,0x7b,0xb2,0x19,0x47,0xd0,0x64,0xeb,0x4d,0x77,0xba,0xb3,0x91,0x97,0x24,0x6e,0x62,0x6d,0x5b,0x15,0x0a,0xa7,0xb9,0xc5,0xab,0xd5,0xaa,0x63,0xf0,0xf0,0xe2,0x6c,0xb3,0x19,0x5d,0x52,0x1d,0x19,0x94,0x6f,0x76,0x7d,0xe8,0x43,0x19,0x83,0xdc,0x48,0xc7,0x2e,0x71,0x8c,0x93,0x9f,0xe0,0xff,0xa6,0x4e,0xa8,0x7a,0x8d,0xed,0xc4,0xb6,0xd5,0x89,0xd4,0xbc,0xa2,0xdb,0x91,0x25,0xbe,0x33,0x4c,0xd9,0x4f,0x92,0x4d,0x57,0x8a,0x76,0xbe,0xf1,0x89,0xaa,0x2e,0x4f,0xd5,0xcd,0x37,0xd9,0x45,0x6b,0x87,0x13,0x4c,0x0d,0xa7,0xb5,0xab,0x7d,0x1e,0xe3,0x18,0x67,0x3f,0xa7,0xa5,0xf9,0xd0,0x30,0x5b,0x1d,0x96,0x9a,0x34,0x44,0xbc,0xb6,0x5d,0xe0,0xff,0x06,0xb8,0x59,0x34,0x00,0x27,0xd6,0x38,0x60,0x58,0xd3,0x11,0x55,0x2d,0xaa,0x65,0x9d,0x4f,0xd2,0xb8,0x39,0x17,0x67,0xbf,0xc9,0xce,0x5a,0x1e,0xb5,0x7a,0x06,0xf6,0xa9,0x75,0xed,0x52,0x6f,0x55,0xa5,0x26,0x75,0xc9,0x93,0x9f,0xfc,0x6c,0x16,0x63,0x3a,0x34,0x70,0xaf,0x5e,0xe1,0xff,0x0c,0xe8,0x2e,0x94,0x01,0x4d,0xba,0x4a,0x40,0x03,0x16,0x68,0x41,0x36,0x1c,0xe9,0xba,0xb8,0x45,0x39,0x70,0x72,0x84,0xdb,0x11,0xa7,0xa8,0x4e,0xa3,0xc9,0x77,0xbc,0x92,0xd6,0x52,0xa8,0x71,0xed,0x4a,0x7a,0x4b,0xa6,0xe0,0x37,0x37,0x5d,0xe5,0x48,0x8e,0x94,0xf1,0x64,0x76,0xad,0x1f,0x55,0x91,0xbc,0x6e,0xd7,0xb1,0xce,0x75,0xad,0x5b,0xda,0xc7,0x70,0x22,0xcd,0xc7,0x79,0x8f,0x3b,0xfc,0x08,0x68,0x21,0x0d,0x03,0x1c,0x90,0xc0,0x70,0x93,0xb2,0x29,0x87,0x76,0x2b,0x28,0x5c,0x7b,0x06,0xd9,0xed,0x60,0x04,0x51,0x54,0x4d,0xa2,0xba,0x19,0xb5,0x2c,0xf8,0xea,0x74,0xca,0xd3,0xeb,0xde,0x97,0x29,0xa4,0xd4,0x4e,0xc9,0x5f,0xa7,0xb2,0xa5,0x9c,0x1c,0x63,0xde,0xf2,0x91,0xce,0x34,0x84,0x27,0x2d,0x4b,0xb8,0x52,0x09,0x9c,0x0e,0xb7,0xee,0xcc,0x5b,0x70,0xdd,0xb2,0xc0,0xff,0x08,0x68,0x4e,0x9d,0x02,0x1c,0x60,0xc0,0x8c,0x69,0x12,0xb0,0xc0,0x88,0xaa,0x8c,0x9c,0xc0,0x2d,0x3b,0x3a,0x41,0x31,0x15,0xa3,0xb6,0xe4,0x46,0x37,0xda,0xc9,0xce,0x56,0xde,0x54,0x5b,0x85,0xbe,0xd9,0xd5,0x6c,0x47,0xdf,0x6d,0xb1,0xa5,0xbf,0x99,0x7d,0x1b,0x5b,0x30,0x09,0xaf,0x2f,0x6d,0xea,0x31,0xc4,0x5c,0xbe,0xd6,0x29,0x2d,0xad,0x88,0x87,0xe2,0xd2,0xb2,0xf6,0xe0,0x16,0x2a,0xb2,0xe3,0x6a,0x57,0xb9,0xf2,0x15,0xfe,0x04,0xf8,0xb9,0x55,0x01,0xbf,0xa5,0x1b,0xe0,0x37,0x0f,0x03,0xfc,0x96,0x61,0x80,0xdf,0x3c,0x0c,0xf0,0x93,0xda,0xea,0x86,0x49,0x53,0x91,0x37,0xab,0x6b,0xd2,0x55,0x23,0xde,0xac,0xb9,0xb9,0x16,0x09,0xff,0xb2,0xf6,0x66,0x93,0x3c,0x63,0xf3,0xbc,0x11,0x3e,0x45,0xa9,0x0a,0xd5,0x00,0x00,0x02,0x14,0x97,0xaa,0x80,0xab,0x6b,0x0d,0xf0,0x63,0xa5,0x01,0x7e,0xcb,0x30,0xc0,0x6f,0xe9,0x0a,0xf8,0x25,0x93,0x01,0x3f,0x57,0xc0,0xff,0x0c,0x78,0xc6,0x95,0x01,0x3f,0xa5,0x28,0xe0,0xb7,0x52,0x0b,0x04,0xe0,0xb7,0x54,0x07,0xfc,0x52,0x66,0x80,0x9f,0xcb,0x56,0x5d,0x6c,0x98,0x47,0x3e,0x59,0x5d,0x89,0x69,0x66,0xb9,0x7a,0x74,0x39,0x86,0x9b,0xd9,0xa6,0x34,0xe4,0x10,0xae,0xca,0xad,0xc7,0x90,0x5d,0x9a,0xa9,0xae,0x1a,0x6d,0xb1,0xa5,0x66,0xf9,0xb2,0xb4,0x4d,0x63,0xb6,0x84,0x9a,0x52,0x77,0x45,0x11,0x1a,0xaa,0x4b,0x35,0x0c,0x79,0x4a,0xb0,0x49,0xd5,0x50,0xa2,0x41,0xa1,0xc9,0xe5,0xd9,0xab,0x89,0x56,0x04,0xf8,0x6d,0x18,0xde,0x58,0x23,0x17,0xaf,0x61,0xe8,0x20,0xeb,0x5c,0xbc,0xba,0x61,0x03,0xad,0x73,0xf6,0x6a,0x66,0x4a,0xd0,0xcc,0xd9,0xab,0x1b,0x45,0xc1,0xa3,0x66,0xaf,0x69,0x36,0x03,0x8b,0x5a,0x9c,0xd6,0x51,0x04,0xa2,0x66,0x96,0x7b,0xba,0x47,0xec,0xed,0x8a,0x08,0x9a,0xa2,0x54,0x85,0x6a,0x00,0x80,0x02,0x86,0x74,0x63,0xc0,0xe6,0x6a,0xf0,0xa2,0x73,0xdc,0x33,0xb5,0x62,0xb9,0x36,0x0b,0x8e,0x34,0x8f,0xd3,0xea,0xae,0x59,0xd2,0x34,0xe9,0xa8,0x86,0x27,0xc9,0xd0,0x78,0x2b,0x6f,0xce,0xc2,0x45,0x1b,0xaf,0xb4,0xf8,0x51,0x73,0x9d,0xb3,0xd2,0x12,0xc7,0x2c,0x6d,0xc9,0x4a,0x72,0x4b,0xf3,0x88,0x26,0x2b,0xc9,0x2d,0xcc,0x23,0xea,0xac,0x34,0xb7,0xd0,0x88,0x98,0xb3,0xf2,0x5c,0x43,0x32,0x7d,0xce,0x2a,0x4b,0x0a,0xcd,0xf4,0x39,0xab,0xae,0x3e,0x24,0xcb,0x67,0xaf,0xae,0xd9,0xe4,0x18,0x5f,0xb4,0x86,0x6e,0x92,0x62,0x7d,0xd1,0x18,0xbb,0x09,0xf2,0x8d,0x59,0x6d,0xec,0x3a,0xd8,0x27,0x16,0xa6,0xa5,0x7b,0xf2,0x74,0x4f,0x92,0xd6,0x1e,0xc8,0x4a,0xc3,0x49,0x5a,0x9b,0x25,0x2b,0xf5,0x24,0x69,0xe9,0xd1,0x24,0x25,0x27,0xba,0xa5,0x25,0x51,0xd3,0xaa,0x24,0xe6,0x5e,0x54,0x55,0x3a,0x14,0xfc,0x0a,0xd8,0x5c,0x4d,0x03,0x2b,0xa8,0x5e,0xc4,0x33,0x2b,0xaf,0x78,0x84,0x12,0x0d,0x7b,0xb3,0xe2,0x66,0x43,0xa2,0xe3,0xf6,0x4a,0xaa,0x4e,0xc9,0x89,0xdb,0x2b,0x6b,0xba,0xc5,0xdb,0x66,0xaf,0xb6,0xe8,0xe6,0x4c,0xbf,0x3d,0xda,0x6a,0xc4,0x4b,0xca,0x49,0x19,0xba,0x61,0x2b,0x09,0x25,0x6d,0xea,0x5a,0xb4,0xc4,0xed,0xa6,0x65,0x18,0xe1,0x56,0xb7,0x9a,0x96,0xa6,0x44,0x47,0xdc,0x6e,0x5e,0xc2,0xda,0xa5,0xf0,0xb8,0xd9,0x85,0xff]);
const PL_WORD_BANK_2 = Uint8Array.from([0xa5,0x2f,0x96,0xad,0x7b,0x6a,0x9f,0x6a,0xe4,0x20,0x8d,0x9c,0x73,0xf3,0x9b,0xdd,0xec,0xe6,0x37,0xbf,0xe5,0xaa,0x66,0x28,0xa0,0xce,0xd5,0xbb,0xd9,0xed,0xee,0x66,0x3f,0x87,0x36,0xce,0x9c,0x80,0x51,0x8b,0xeb,0x54,0xe7,0xbc,0xc2,0xff,0xa6,0x2a,0xaa,0x05,0x5c,0xd6,0x8c,0xb8,0xc7,0x16,0x70,0x59,0x33,0xa2,0x95,0x0b,0xc1,0xfd,0xcd,0x8c,0x66,0x38,0xe3,0x91,0xad,0x98,0x00,0x55,0x8b,0x67,0xd1,0xdb,0xde,0xd5,0xa9,0xce,0x75,0x2e,0xeb,0x2c,0x4d,0x60,0xbe,0x26,0xef,0xf1,0x88,0x27,0xfc,0x04,0xf8,0xa5,0x83,0x03,0x12,0xb0,0x80,0x07,0x22,0xb0,0x9c,0xee,0x8d,0x45,0x7d,0xc9,0x8a,0x66,0x29,0x42,0xf5,0x35,0x3b,0xda,0xd1,0x88,0x67,0x0d,0x40,0xcf,0xd7,0x33,0x19,0xf9,0xac,0x06,0x14,0xb5,0x68,0xd6,0xbd,0xeb,0x7d,0x1f,0xd3,0x32,0x5b,0x02,0x44,0xbd,0xce,0x6b,0x5e,0xf3,0x96,0xb6,0x55,0x0a,0xc1,0x73,0x4d,0xde,0xf3,0x0e,0xff,0x08,0x20,0xba,0x0d,0x03,0x6d,0x38,0x2c,0x55,0x45,0xb3,0x8c,0xba,0x05,0x65,0xd5,0x78,0x32,0xaa,0xee,0x85,0x34,0xf2,0xf6,0xa8,0x87,0x33,0xe0,0xca,0xc7,0xad,0x9e,0xce,0x81,0xbb,0x66,0xb7,0x76,0x06,0x07,0xee,0x9c,0xd5,0xba,0xa9,0x1d,0x65,0x72,0x11,0xfc,0xa2,0x5a,0x95,0x51,0xba,0x17,0xf7,0x62,0xe5,0xab,0x38,0x42,0xe4,0x92,0x9d,0xef,0x6c,0x65,0x33,0x3b,0x50,0xd6,0x92,0x9d,0xaf,0x62,0xc5,0x04,0xa8,0x5a,0xbc,0xcb,0x5d,0xed,0x7a,0x37,0xbb,0xdd,0xc3,0x1e,0xf6,0x34,0xa7,0xbe,0xf4,0xa5,0xad,0xb3,0x34,0x81,0xf9,0x1a,0xf8,0xab,0x1a,0x61,0x94,0xdd,0xd6,0xdc,0xf6,0x54,0xdd,0x37,0xb9,0xe7,0xea,0x53,0x35,0xb3,0x1c,0xe1,0xaf,0x6f,0x75,0xdb,0x35,0xd4,0xe0,0x56,0x9c,0x77,0xdb,0x58,0x9d,0xeb,0x98,0x8c,0x61,0xc0,0x30,0xe9,0x1a,0xb0,0x80,0x05,0x14,0x30,0x6d,0xbb,0x06,0x24,0x20,0x01,0x0e,0x10,0xa0,0x06,0x35,0xf8,0x6e,0x3e,0x29,0x8d,0x98,0x95,0xcd,0x39,0x00,0xab,0x38,0x95,0xf4,0xd4,0xeb,0x34,0x81,0x7a,0xe2,0x51,0x53,0x50,0x75,0xeb,0x8e,0x76,0xb4,0xc3,0x15,0x8d,0x92,0x48,0x99,0xab,0x77,0xbc,0xd3,0x5d,0x8e,0x76,0x96,0x04,0x8c,0x5a,0x3c,0xfb,0xd9,0xf7,0xa9,0x4e,0x75,0x2b,0xdb,0x2a,0x85,0xe0,0xb9,0x26,0x1e,0xf1,0x80,0xff,0xa5,0x1d,0x6d,0x90,0x2d,0xd6,0xec,0xf2,0xe6,0x37,0xbb,0xe9,0x2e,0x46,0x3b,0xa3,0x01,0x6d,0x2d,0xce,0xa3,0x5d,0xdd,0xdc,0x3c,0x61,0x76,0xc5,0x25,0xb3,0x08,0xe5,0x2e,0x22,0x1b,0x00,0x80,0x01,0x2b,0x87,0x38,0x60,0xe5,0xed,0x08,0x58,0xc0,0x02,0x16,0xb0,0x80,0x06,0x34,0x40,0x80,0x76,0xd3,0xe0,0xff,0x2a,0x8b,0x63,0xa8,0xaa,0x66,0xad,0xb6,0xa8,0xcb,0x08,0xdd,0x7c,0x8b,0x9b,0xde,0xf4,0x66,0x37,0x3b,0x59,0xb5,0xa3,0x15,0xba,0xf8,0xe6,0xbb,0xd8,0xcd,0x6e,0x57,0xdf,0x5c,0x49,0xa5,0x2d,0xde,0x63,0x1b,0x6b,0x76,0x29,0xaf,0xc7,0x6d,0xec,0x31,0xd8,0x5c,0x1e,0xf7,0xb1,0x4e,0x75,0x4a,0xf3,0x28,0x89,0xe2,0xf2,0x38,0x2f,0x79,0x85,0xff,0xae,0x5e,0xc1,0x99,0x54,0xb2,0x09,0x60,0x49,0x22,0x07,0xec,0xa8,0x16,0x80,0x5d,0x26,0x47,0xd5,0xa3,0x92,0x78,0x74,0x3e,0x71,0x2f,0x21,0x6a,0xb1,0xfa,0xc6,0x37,0xbe,0xf1,0x4d,0x6f,0x7a,0xf3,0x5d,0x8d,0x7e,0xb4,0x22,0x36,0x7f,0x53,0xe7,0xbe,0xb4,0x6d,0x96,0x61,0x34,0xdb,0x52,0xb7,0xb4,0x8f,0xdc,0x88,0xe1,0x5f,0xf2,0x9a,0x57,0xf8,0x01,0x18,0x91,0xb9,0x00,0x4d,0x91,0x46,0x60,0x05,0x2d,0xb3,0xb8,0x67,0xed,0x13,0xf7,0x14,0x64,0x11,0x4b,0x6e,0x7c,0xe3,0x1b,0xdf,0xf8,0x14,0xc3,0x05,0x6a,0xe7,0xea,0x5d,0xef,0x7a,0xf7,0x6d,0x1a,0xb1,0x00,0x2b,0xdf,0xf4,0xa9,0x4d,0xb3,0x24,0x60,0xd4,0xe2,0xba,0xe6,0x35,0x6f,0x69,0x1b,0x43,0x48,0xa3,0xeb,0xe4,0x0d,0xfe,0xab,0x6c,0x2e,0xd8,0x2a,0x37,0xdf,0xe2,0x16,0xa7,0xa8,0x21,0xbc,0xc4,0x17,0xdf,0xe2,0x16,0xa7,0xcc,0x6a,0xc3,0x4d,0x3a,0xdf,0x72,0xd5,0x95,0x6c,0xa6,0x71,0x9e,0xd1,0x35,0x98,0x53,0x49,0x5e,0x7b,0x57,0xc6,0x0a,0x7a,0x43,0xd9,0x4f,0x1c,0xc3,0x54,0xe0,0xf4,0x08,0xf9,0x09,0x53,0x03,0x31,0x19,0xa2,0x25,0x4e,0xf0,0x29,0xea,0xc5,0xd8,0x73,0x16,0xcf,0xe8,0x56,0x37,0xbf,0xd9,0x49,0xbb,0x6f,0xf1,0xf0,0xd5,0x37,0xbd,0xd9,0xce,0x47,0x55,0x63,0x72,0x98,0x58,0xee,0x6d,0xef,0xdb,0xd0,0x62,0x72,0x98,0x58,0xae,0x63,0x1d,0xd3,0x58,0x45,0x72,0x93,0xd8,0x8d,0x93,0x9d,0xec,0x64,0xe7,0x30,0x97,0x58,0xe1,0xa2,0x4d,0xe2,0x12,0x57,0xf8,0x81,0xed,0xd1,0xc8,0xb3,0x16,0xef,0xe2,0x64,0xc3,0x35,0x59,0xc4,0xe3,0x9b,0xde,0xf4,0xa6,0x3b,0x5f,0xf9,0x92,0xcd,0x91,0xb4,0x78,0xb7,0xa3,0x1f,0x9e,0x38,0x2c,0x9c,0xce,0xbe,0x0f,0x75,0x0e,0xf3,0xb0,0xc2,0x61,0x1e,0x35,0xce,0x71,0x89,0x6b,0xdc,0xd2,0xd6,0x4d,0x49,0xb8,0xce,0x0e,0xdb,0x34,0xad,0x16,0xbc,0x19,0xfe,0xa3,0x68,0xb4,0xba,0x8d,0xbc,0xad,0xbc,0x92,0xec,0x0e,0xf2,0xb6,0xd3,0x1d,0x8f,0xb8,0xe0,0xee,0x16,0xf6,0x3f,0x93,0x59,0xcf,0xa6,0x0c,0x91,0xe5,0x0c,0x8b,0xbf,0x30,0x39,0xd3,0x1d,0x28,0x59,0xe2,0xe2,0x17,0xbb,0xfa,0x1d,0xfe,0x02,0x88,0x26,0xd4,0x00,0x6d,0x96,0xb5,0xb8,0x25,0x05,0x89,0x6c,0x3d,0x92,0xe6,0x51,0xb3,0xa6,0xf4,0x48,0x66,0x09,0xa0,0x8c,0xc7,0x33,0x9d,0x79,0xcb,0x67,0x0e,0x80,0xca,0xd7,0xbd,0x6c,0xe5,0x72,0x06,0xb4,0xb5,0xba,0x37,0xbd,0xab,0x53,0x5d,0xf2,0x9e,0xf7,0x78,0xc0,0xff,0x0e,0x98,0xd5,0x28,0x02,0x11,0x18,0xc9,0xcc,0x46,0x98,0xf1,0x66,0x27,0x27,0x19,0x21,0x99,0x92,0xb6,0xdc,0x6c,0xe7,0xab,0x28,0xd2,0x2d,0x13,0x3b,0xef,0xb2,0xb5,0xce,0x94,0x47,0xd0,0xee,0xda,0xc7,0x31,0xcf,0x61,0x31,0x31,0xa2,0x50,0xb6,0xf8,0xd5,0xef,0xf0,0x2b,0xce,0x72,0x33,0x93,0xbb,0xdc,0xf2,0x16,0x37,0xbf,0xd9,0x28,0x52,0x5c,0xa9,0xa6,0x4d,0xb3,0x6c,0x5d,0x0a,0xcb,0x71,0xd8,0xbb,0x0f,0x7d,0x2a,0x73,0xb6,0xc7,0xf4,0x94,0x37,0x2d,0xa9,0x34,0xf8,0x53,0x97,0xb8,0xc2,0xff,0xab,0x6f,0xd9,0x34,0x6c,0xe6,0xdc,0xe2,0x16,0x37,0xbf,0xf9,0x69,0xaa,0x0f,0x2d,0xda,0x25,0x7b,0x18,0x53,0x4d,0x9a,0xa2,0xe7,0xb8,0x2d,0x23,0xa5,0x26,0x71,0x2a,0x03,0xfc,0x94,0xe6,0x01,0x0f,0x68,0x40,0x03,0x12,0xe0,0x00,0x07,0x30,0x00,0xff,0x01,0xd8,0xb6,0xdd,0x01,0x2f,0xf4,0x38,0x60,0xd5,0xd1,0x91,0x4c,0x97,0x84,0xe6,0x4b,0x4e,0x32,0xb2,0x10,0x67,0xcd,0x19,0xc9,0x2c,0x01,0x94,0xf1,0x78,0x26,0x33,0xe9,0x69,0x2f,0x7b,0x53,0xbb,0x36,0xae,0x52,0x08,0x9e,0x6b,0xea,0x5c,0x97,0xba,0x95,0x7d,0x45,0x47,0xac,0x5a,0x9c,0x0f,0xf8,0xa1,0x99,0x9c,0x94,0x72,0x26,0x8d,0x6a,0x07,0x55,0x90,0x78,0x3c,0x8b,0x99,0x9f,0xac,0x87,0x60,0x76,0xda,0x72,0xb3,0x93,0x35,0xa5,0x64,0x2d,0x7b,0x6e,0xbe,0x9a,0x24,0xdc,0x32,0xb1,0x73,0xef,0xfa,0x10,0x46,0xab,0xc6,0xca,0xe0,0xb5,0x5f,0xcc,0xaa,0xd4,0x78,0x1b,0xb6,0x53,0xbb,0x74,0xa7,0x21,0xbc,0x04,0xfe,0x66,0xf0,0xd2,0x38,0x43,0xb3,0xd8,0x21,0xf4,0x4d,0xbb,0x70,0xb0,0xdb,0xd0,0x0f,0x17,0x2c,0x26,0xae,0x53,0x37,0x6c,0xbb,0x32,0xab,0x19,0x75,0xf7,0x21,0x6c,0x9c,0xe5,0x64,0x33,0xb6,0x80,0xcb,0x9a,0x1b,0xae,0x60,0xe5,0x42,0x70,0x7f,0xb3,0x83,0xed,0xef,0x70,0x25,0x2b,0x26,0x40,0xd5,0xe2,0x99,0xf7,0xba,0xb7,0x75,0xa8,0x63,0x9d,0xca,0x32,0x4b,0x13,0x98,0xaf,0xa9,0x4b,0xde,0xf3,0x91,0x8e,0x19,0x0b,0x31,0xf3,0x0d,0xfc,0x21,0xdb,0xc2,0x44,0xc2,0xfc,0x9c,0x64,0x88,0x70,0x09,0x59,0x7b,0xe2,0xca,0x3b,0x3d,0xa4,0xcf,0x0d,0x56,0x90,0xc4,0xa6,0xbb,0xf4,0x6e,0x41,0xe2,0x9d,0xea,0xe2,0x4a,0x65,0x12,0x65,0xbb,0xb3,0xeb,0x91,0x55,0x12,0x99,0xc1,0xd9,0x6e,0xb1,0x9b,0xd1,0x36,0x92,0x6a,0xc9,0x9b,0x47,0x3b,0x4c,0x12,0x46,0x6c,0x99,0x5d,0xef,0x5b,0xdf,0x92,0x92,0x64,0x6c,0xee,0x43,0x19,0x6b,0x22,0x71,0x8f,0xcf,0x65,0x29,0x41,0xd4,0xdd,0x36,0xa5,0x2d,0x19,0xf5,0x0c,0xee,0x13,0xb7,0x7c,0x98,0xc3,0x85,0xc8,0x62,0xee,0x6d,0x4f,0xf8,0xad,0x69,0xc9,0xc5,0x32,0x56,0xdf,0xfe,0x74,0x2d,0x35,0x7b,0xf8,0xea,0xdb,0xdd,0xe1,0x6c,0x6d,0x04,0xa6,0xc5,0xea,0xb9,0x87,0xa3,0x75,0x23,0x37,0x4f,0x83,0x60,0x11,0xca,0x5d,0x44,0x36,0x00,0x28,0xa0,0xe6,0x31,0x0f,0x68,0xc0,0x00,0xbf,0x8d,0x79,0xc0,0x03,0x16,0xd0,0x00,0x07,0xe0,0xff,0xaa,0xb3,0xa2,0xa7,0x95,0xd2,0xd8,0x2e,0x57,0x23,0x2f,0xb2,0x7a,0x1c,0xb3,0xde,0xec,0xa4,0x45,0x6d,0x56,0xca,0x9a,0x9b,0xde,0xf4,0xe6,0xbb,0xd8,0xc5,0xaa,0x8a,0x6f,0x2b,0xf3,0x37,0xbb,0x1b,0x5d,0xd3,0x25,0x39,0xfa,0xb9,0x0f,0x6d,0xe8,0x31,0xc4,0x5c,0x1e,0xf7,0xa1,0x4f,0x65,0x1e,0xa5,0x48,0x5c,0x1e,0xd7,0x25,0x2f,0x79,0x81,0xff,0xad,0xfb,0xc6,0x5c,0x95,0xd5,0xf5,0xce,0x02,0xbb,0x5b,0xf9,0x51,0x2d,0x2a,0xe4,0x77,0xe5,0xa3,0x3a,0xb1,0xfa,0x9b,0x9d,0xec,0x78,0xc5,0x33,0x27,0x60,0xd4,0xe2,0x99,0xce,0x74,0xd6,0xb3,0x9b,0x43,0x9f,0xfa,0x54,0xe6,0x55,0x0a,0xc1,0x73,0x4d,0x9d,0xeb,0x92,0xd6,0x15,0x12,0xa0,0x6b,0x75,0x5e,0xe1,0xff]);
const PL_WORD_BANK_3 = Uint8Array.from([0x63,0xac,0x21,0xb4,0x3c,0x16,0xaf,0xb2,0x84,0xd2,0x0a,0x5f,0xb3,0xf2,0xe2,0xda,0x32,0xf4,0xcd,0xca,0x92,0xdf,0x28,0xd7,0x27,0x2b,0xcd,0xe2,0x5b,0x93,0x57,0xaf,0xac,0xd0,0x1b,0x0b,0xee,0xb2,0xb2,0x24,0xae,0xc3,0x28,0x4b,0x29,0x0a,0xaf,0x0e,0x13,0x47,0x02,0xa8,0xa6,0x4c,0x00,0x4d,0x57,0x08,0xa0,0x99,0x0c,0x01,0x74,0xed,0xb1,0x8a,0x22,0xba,0xd4,0xa9,0xcd,0x2a,0x2a,0xef,0xd6,0xe0,0xbd,0x6b,0x6c,0xac,0x5a,0x83,0xf7,0xae,0xad,0xb1,0x6a,0x0b,0xde,0x32,0x96,0xa2,0x3a,0xc2,0x79,0x73,0xdd,0xf3,0x01,0xff,0x02,0x10,0x2c,0x34,0x94,0x46,0xaf,0xc8,0x8a,0xbd,0x54,0x84,0xa9,0xe6,0x2d,0xfc,0x46,0x1e,0x7b,0x48,0x87,0x2a,0x5f,0x59,0x76,0x13,0xe9,0xba,0x7a,0xa7,0x3b,0x9d,0x59,0x29,0xa3,0xab,0x48,0xd7,0xd5,0xb1,0x0e,0x6d,0xf7,0xa1,0xe6,0x2a,0x3b,0xb6,0xa5,0x0d,0xa9,0x52,0x55,0x56,0x8d,0xb2,0x92,0x6a,0x77,0xf1,0xbb,0xda,0x86,0xb2,0x3a,0x44,0xfd,0xec,0xdb,0x50,0x48,0xd7,0x38,0xb9,0xef,0x73,0x9d,0xc3,0xec,0x7d,0x67,0xb0,0xf4,0x89,0x6b,0xdc,0xe0,0xff,0x06,0xd8,0x2d,0x2c,0x01,0x33,0xb7,0x67,0xa0,0xb9,0xc5,0x8d,0xc8,0xb2,0xb7,0x16,0x16,0xbf,0x26,0x87,0xf9,0x5a,0x94,0xf3,0xb0,0x1f,0x75,0x19,0x51,0xce,0xcd,0x71,0xd4,0x65,0xc4,0x39,0x8e,0xda,0x71,0xb6,0x91,0xc7,0x30,0xe9,0x6e,0x69,0x4b,0x5b,0x51,0x8f,0x15,0x66,0x49,0xe3,0x80,0x31,0xa2,0xe6,0x7d,0xcd,0x55,0xb6,0x59,0xd8,0xea,0xb1,0x0e,0xde,0xca,0xe5,0x9b,0xc7,0xd6,0x65,0x92,0x55,0x6c,0x2e,0xfb,0x30,0x49,0x92,0xb1,0x3a,0xed,0xc3,0x04,0x72,0xe7,0xe6,0x70,0x74,0xeb,0xa8,0x93,0xab,0xe1,0xff,0x0a,0x28,0x30,0x6c,0x8d,0xc3,0xa7,0xaa,0x70,0xd7,0x55,0x76,0x5d,0x22,0xee,0x5b,0x57,0xd6,0xf9,0xb8,0xa6,0x6d,0x59,0x59,0x16,0x9b,0xa1,0xde,0x7b,0x15,0x99,0x6d,0xa5,0x58,0xde,0x55,0x64,0x11,0x5d,0xc2,0x69,0x4a,0x3b,0x25,0x5b,0x85,0x32,0x21,0x40,0x96,0x26,0x0e,0x58,0x4a,0x33,0x00,0x4b,0xb5,0xad,0xaa,0x9a,0xf0,0x30,0xdf,0xb2,0xbb,0xd1,0x37,0x55,0xe9,0x21,0x5d,0x7b,0x3f,0x96,0xaa,0xc6,0x3c,0xa5,0x73,0x5f,0xe1,0xff,0x2b,0x6e,0xb1,0xd9,0xd3,0x36,0xdf,0xf2,0x16,0x37,0x27,0xa9,0x08,0xe5,0x2e,0x22,0x1b,0x20,0x00,0x25,0xac,0x2a,0x20,0xcf,0xd3,0x92,0x45,0x53,0x6a,0xa9,0x9e,0x4f,0x99,0x54,0x47,0xb9,0xe4,0xdf,0xed,0x6c,0x47,0x9b,0x45,0x65,0xbb,0x78,0x9f,0xc3,0x1c,0xd2,0xe8,0x43,0x67,0xb0,0xe5,0xcd,0x73,0x58,0x9d,0xad,0x2c,0x15,0x37,0x71,0x85,0xff,0x04,0x18,0xb6,0x82,0x00,0xd3,0x57,0x08,0x60,0xba,0xf4,0x91,0xc7,0x58,0x15,0xca,0x8b,0x47,0x9e,0xfc,0x64,0x1a,0xaf,0x19,0x45,0x4a,0x9d,0xa1,0xfa,0x64,0x14,0xa9,0x65,0x86,0xe4,0xe2,0x51,0xa5,0xee,0x99,0x92,0xab,0x04,0xe0,0xa2,0x93,0x04,0x08,0x90,0x9d,0x33,0x03,0x9e,0x71,0x65,0xc0,0x4f,0x29,0x0a,0xf8,0xad,0xd4,0x02,0x08,0x9e,0xa2,0x54,0x85,0x6a,0x80,0x00,0x86,0x21,0x57,0xc0,0x48,0x53,0x01,0x18,0x36,0xbc,0x15,0xa9,0x4b,0xaa,0x4b,0x9b,0xd6,0xc7,0xee,0x11,0x41,0x6b,0xdb,0x9a,0xec,0x94,0x36,0xed,0x6d,0x5b,0x76,0x93,0x9e,0xfc,0xa5,0x5d,0xd9,0x4d,0x58,0xea,0x9a,0x7e,0xb5,0x37,0xc5,0x76,0x4f,0x7f,0x14,0xfe,0xd8,0xcd,0x2b,0x7a,0xb2,0xfa,0x9b,0xf2,0x88,0xf0,0xae,0x08,0x16,0xa1,0xdc,0x45,0x64,0x03,0x80,0x00,0x8e,0xe0,0x30,0xc0,0xb2,0x53,0xf0,0x0a,0x88,0xa1,0x71,0x65,0x85,0x76,0x45,0x8a,0xff,0x9b,0xde,0x78,0xc5,0x99,0x5c,0xb7,0x72,0xde,0x1d,0xef,0x7c,0xd7,0xb3,0x6f,0x63,0x54,0x35,0x63,0xe4,0xa6,0xae,0x79,0x33,0x47,0x94,0x39,0x63,0xe4,0x86,0x1f,0x04,0x98,0x34,0xdd,0x02,0x0e,0x98,0x32,0x5d,0x03,0x12,0xe0,0x00,0xfc,0x08,0xc8,0x4a,0x0c,0x01,0xc5,0x74,0x11,0xa0,0xca,0xea,0xd1,0x35,0x5a,0xdd,0x46,0xde,0x56,0x5d,0x49,0x76,0x07,0x79,0xdb,0xd5,0xa8,0x0a,0xee,0x6e,0x61,0xff,0xbd,0xaa,0x2d,0x82,0x44,0x70,0x17,0x11,0xd9,0x00,0x02,0xe8,0x54,0x2d,0x00,0xd5,0x84,0x05,0x60,0x2a,0xb3,0x93,0x37,0x67,0x66,0x9c,0x6b,0x4e,0x5e,0xbd,0x9b,0x6a,0xdd,0x39,0x79,0xf1,0xae,0x6e,0xbd,0xf8,0x54,0xc5,0xa7,0x85,0xe5,0xe2,0x53,0x17,0xd5,0x9e,0x2e,0x9f,0xcf,0x58,0xe4,0xa6,0x07,0xbf,0x59,0x5b,0xc5,0x33,0x19,0xd8,0xa5,0x9c,0x89,0xce,0x94,0x61,0x9b,0x74,0x79,0xdd,0x13,0xc4,0x4b,0xfc,0xe5,0x2e,0xa7,0xae,0x0a,0xa5,0x0d,0xfc,0xa3,0x98,0xd6,0x99,0x32,0x17,0x8f,0x7c,0x86,0x16,0x74,0x5f,0xb3,0xf2,0xe1,0x4a,0xc4,0xf4,0xce,0x4e,0x47,0xdc,0x1d,0x5a,0x46,0x3a,0x99,0x71,0x8b,0xab,0x82,0xac,0x08,0x27,0x3e,0x5d,0xe5,0x0c,0x25,0x42,0xbc,0x7b,0x55,0xd3,0x17,0x61,0xf8,0x96,0x5d,0xed,0x7a,0xf4,0xcd,0x8a,0x44,0xc6,0xe3,0x31,0x55,0x1b,0x62,0x69,0xaf,0xc7,0x92,0x9c,0x7b,0x66,0x2c,0x6e,0x5b,0xf6,0x69,0x11,0xf6,0xaa,0x1c,0x29,0xa4,0x87,0xdb,0xe7,0x74,0xe6,0x14,0x1e,0x1a,0xab,0xdd,0x95,0x62,0x7a,0x68,0xac,0x82,0xff,0x61,0x5d,0x96,0x49,0x34,0xd2,0x06,0x60,0xc7,0x90,0x0c,0x8c,0x66,0xf6,0x15,0x22,0x4d,0x37,0xaa,0x6a,0xc8,0x2c,0x6d,0xcd,0x28,0xb2,0x15,0x8b,0xe4,0x35,0xb3,0x68,0x79,0x51,0xe6,0xda,0x9c,0xbe,0x15,0x43,0x89,0xf0,0xa2,0xdb,0x95,0x77,0xa7,0xa6,0x66,0x49,0x77,0xb1,0x9a,0x9e,0x0a,0xd5,0x75,0xeb,0xee,0xf6,0xb0,0xc6,0xe6,0x83,0xd2,0xe3,0xeb,0x5e,0xd7,0xda,0x5c,0x48,0x87,0x6d,0x9e,0x7b,0xdf,0xf3,0x89,0x40,0x11,0xca,0x5d,0x44,0x36,0x00,0x38,0x60,0xea,0x8c,0x00,0x2c,0xb3,0x6d,0x01,0x01,0x14,0x5f,0x8e,0x01,0xf8,0x06,0xe8,0x12,0xd9,0x02,0x12,0x68,0xee,0x8c,0x86,0xd4,0xf5,0x76,0x7a,0xd3,0x1d,0xee,0x74,0x4a,0x54,0x1e,0x6f,0xfa,0x2b,0x5c,0xdc,0x42,0x93,0xb2,0xed,0x66,0xb5,0x95,0x7b,0x8e,0x53,0xdf,0x3d,0xac,0xa1,0xb0,0xcc,0x2a,0xee,0xbb,0xa7,0xb6,0x24,0x53,0xd9,0x4a,0x7d,0xfb,0x52,0x36,0x1f,0x2b,0x1b,0x75,0x4d,0xdc,0xe2,0x1e,0x8e,0xa0,0xa6,0x32,0xc8,0xaf,0xbb,0x92,0x18,0xaf,0x20,0x7d,0xf0,0xa1,0x5f,0x90,0xba,0xc0,0xd7,0xa6,0x7e,0x00,0x19,0x85,0x6a,0xda,0xca,0xcd,0x24,0xd9,0xcc,0xcb,0x4a,0x47,0x76,0x66,0xf5,0x37,0x3b,0x9e,0xe1,0x88,0x7a,0x50,0xd4,0x8e,0xd9,0x3d,0xad,0x45,0x2b,0xb3,0x62,0xee,0xf4,0xb8,0xb5,0xac,0xf5,0xa8,0x1b,0xaf,0xcc,0xa2,0xce,0xbb,0xdd,0xcb,0xd8,0xb2,0xda,0xc8,0xd0,0x55,0xfd,0xac,0x57,0xbd,0xe0,0xff,0x66,0x31,0x3c,0x7c,0x52,0xe3,0xc4,0x69,0xf5,0x85,0x57,0x86,0x51,0xaa,0xd3,0x56,0x75,0xa1,0x69,0x9d,0x6f,0x7d,0xca,0x6a,0x57,0x23,0x6d,0xf5,0xcd,0x57,0xd1,0x4b,0x50,0x78,0x2c,0xda,0x75,0x69,0x46,0x77,0xb4,0xce,0xdb,0xb1,0x45,0xad,0x08,0xe5,0x2e,0x22,0x1b,0x00,0x18,0xd0,0x3c,0x91,0x03,0x5a,0x09,0xb1,0x80,0x00,0xb2,0x13,0x86,0xff,0x66,0x2c,0x02,0x62,0x4b,0xe3,0x8e,0xa1,0xeb,0x10,0x77,0x6e,0xb3,0xb2,0x2a,0x2a,0x39,0x74,0xcb,0x4a,0x0b,0xcb,0xb2,0xe4,0xae,0x2b,0x4d,0xbc,0xdb,0x9c,0xfa,0xb6,0x2c,0x8a,0x29,0x33,0xee,0x93,0xf2,0xa0,0xa6,0xc4,0xb9,0x55,0xa8,0x92,0xa8,0x54,0xa7,0xc4,0xae,0x1d,0x32,0xcc,0x54,0x2d,0xb7,0xb1,0xa9,0x72,0x53,0x51,0xbc,0xb2,0xe2,0x53,0x2c,0xb4,0xf5,0x4a,0x8b,0x2b,0xb5,0xd2,0xd5,0x2b,0x2d,0xa6,0xd4,0xda,0x5a,0xaf,0x34,0xfb,0x32,0x2b,0x4b,0xd3,0xd2,0x14,0xdc,0xda,0xc8,0x4e,0xc9,0x52,0x24,0x6b,0x53,0xb9,0xaa,0xf5,0x51,0xb5,0x42,0xe9,0x31,0xc0,0x9b,0xb0,0xd4,0xa7,0xa6,0xd4,0x85,0x6f,0xca,0x58,0xc2,0x0a,0x2e,0xe6,0x6b,0x6b,0x89,0xc3,0xb4,0xd8,0x2f,0x6d,0x25,0x0d,0xd3,0x52,0xdf,0x74,0x14,0xdf,0x44,0x47,0xfb,0xd2,0x51,0x72,0xa2,0x1e,0x75,0x09,0x47,0x89,0x8d,0x7c,0xb4,0x07,0xfe,0xab,0xcd,0xe2,0xb2,0x42,0x3a,0xdf,0xe2,0xa6,0x27,0x49,0xae,0x7d,0xc4,0x17,0xb7,0x38,0x45,0xaf,0xa4,0xb6,0x6d,0x80,0x03,0xd8,0x0c,0xf0,0xa7,0x9b,0x07,0x3c,0xe0,0x80,0xeb,0xb5,0x11,0x38,0x45,0xa9,0x0a,0xd5,0x00,0x02,0x34,0x75,0x65,0xe6,0xa6,0xae,0xa2,0x34,0x6e,0xaa,0x8b,0x9b,0x24,0x13,0xa5,0xad,0xca,0xa9,0xc8,0x86,0xf3,0xce,0x7a,0x76,0x6d,0xcc,0xcd,0xb0,0x5a,0x7a,0xcf,0xb9,0x2e,0x75,0x4b,0x47,0x89,0x83,0x3a,0xa9,0x37,0xdf,0xe1,0x29,0xad,0x48,0x87,0xb3,0xc0,0xff,0x0a,0x28,0x56,0xb9,0xe5,0x45,0x55,0x84,0x49,0xcc,0x93,0x67,0xd7,0x19,0x26,0x4b,0x4e,0x91,0xdd,0x44,0xba,0xae,0xbe,0xc5,0x2c,0x10,0x24,0x42,0xb9,0x8b,0xc8,0x06,0x60,0x80,0xf1,0xe9,0xab,0xc9,0xa6,0x23,0xd4,0x36,0xdf,0xe9,0xcc,0x55,0x74,0x86,0x6b,0x9f,0x71,0x66,0xbd,0xe1,0xe6,0xbb,0xdb,0x9f,0x53,0x45,0x88,0xcf,0xae,0x3f,0xfc,0x0c,0x88,0x7e,0x8c,0x02,0xa5,0x0c,0x31,0xdd,0x5c,0xb2,0xac,0x3a,0x5b,0xcf,0x4c,0xee,0xbb,0xbb,0xde,0xa5,0xcd,0xa8,0xb4,0x75,0x4d,0x1c,0xb7,0xd1,0xd5,0x28,0xee,0xe6,0x5b,0x76,0x73,0xea,0x1a,0xc4,0x33,0xf3,0xf1,0xad,0x77,0x37,0xa7,0xb6,0xb6,0xec,0x12,0x91,0x9b,0xf2,0x8e,0x40,0x11,0xca,0x5d,0x44,0x36,0x80,0x00,0x7a,0x2f,0x53,0x40,0x2d,0x24,0x14,0x80,0xff,0x22,0xd7,0x39,0x38,0xca,0xec,0xdb,0xbe,0xb4,0xa1,0x98,0x5a,0xb9,0xf2,0x53,0x46,0x6f,0xe9,0x69,0xca,0x4e,0xd6,0x89,0x57,0x0e,0x69,0x3f,0x71,0x61,0xd9,0x95,0x98,0x65,0x87,0x25,0x6c,0x86,0x64,0x4c,0xac,0xf5,0xf8,0xa4,0xcd,0x86,0x7a,0xd0,0xe6,0x55,0x4f,0xd7,0x02,0xa5,0x7b,0x76,0xbd,0xdb,0xdd,0xaf,0xa1,0xaa,0x54,0x1d,0xdb,0xb2,0xa6,0xec,0xc3,0xd3,0x64,0x73,0x99,0x62,0xc8,0x2c,0xd5,0xdf,0x69,0x09,0xa1,0x33,0xd8,0xf2,0xe6,0x25,0xae,0x6e,0x0f,0xb6,0xb2,0x54,0xdc,0xf8,0x1d,0xfe,0x0c,0xf8,0xad,0x54,0x03,0x06,0xf8,0x2d,0xd5,0x01,0xbf,0x94,0x39,0xe0,0xe7,0x32,0x0b,0xb4,0xb0,0x3b,0x25,0x75,0x5f,0xbd,0xe2,0x11,0x0d,0x39,0x63,0xf5,0x48,0x46,0x34,0xe0,0xea,0x4d,0x23,0x1d,0x49,0x91,0xbb,0x56,0x8d,0x6c,0x78,0x45,0xd9,0x7c,0xb2,0xf2,0xe1,0x9c,0x78,0xe2,0xf1,0xc9,0x87,0x09,0x92,0xb1,0xd7,0x27,0x6b,0x2e,0xd9,0xc7,0x5e,0x9f,0xac,0x84,0xe4,0x1c,0x79,0xbd,0xd2,0xd4,0xc4,0xb2,0x79,0xcd,0xc8,0x52,0x97,0xf0,0xa6,0x3c,0xa3,0x4c,0x53,0xc3,0x9a,0xf2,0x8c,0x26,0x55,0x0b,0x1d,0xea,0xb3,0xa6,0x14,0x3d,0x2d,0x35,0xcf,0x99,0xb2,0x1b,0xf3,0xd0,0x3e,0x6b,0x29,0x7a,0xdc,0x53,0x36,0x8f,0x35,0xc5,0xd6,0x70,0x7f,0xd5,0xf6,0x14,0xdb,0xc2,0x7c,0x55,0x39,0x73,0x4c,0x2f,0xf1,0x97,0xe9,0xca,0x6a,0xb5,0xc2,0x76,0x96,0x2b,0x87,0xd2,0xd2,0x58,0x09,0xff,0x0e,0xd8,0x5c,0xcd,0x03,0xcb,0x2b,0xd9,0xd4,0x23,0x2b,0xad,0xa8,0x26,0x57,0x8f,0x58,0xb2,0xe2,0x56,0x5c,0x2d,0x63,0xf6,0x8a,0x5b,0x36,0xf5,0xcc,0x59,0x2b,0x6e,0x91,0xb5,0xdb,0x42,0xb7,0xa4,0x5a,0xea,0x34,0x57,0x5d,0xb2,0x62,0x68,0x5c,0x55,0xb5,0x2b,0xa2,0xa2,0x09,0x13,0xa7,0xa5,0xad,0x2a,0x98,0x53,0x56,0x8f,0xbe,0xb2,0x30,0x19,0xdd,0xb3,0xfa,0x22,0xcb,0xa4,0xb4,0xeb,0xe8,0xb2,0xea,0x90,0x92,0x2e,0x6d,0x0a,0xbe,0xc3,0x52,0x3a,0xa7,0x35,0xc4,0x0a,0x4b,0xd9,0x5b,0xf6,0x50,0x32,0x3c,0xa4,0x73,0xb8,0x43,0x0b,0x37,0x93,0xd5,0xe6,0xf6,0x35,0xdd,0x95,0x7f,0xab,0xdb,0x87,0xf2,0x34,0xde,0x07,0xff,0xa1,0x3f,0x56,0x98,0xd4,0xb6,0xe6,0xae,0xd5,0xc7,0xa8,0x01,0xc5,0xda,0x53,0x2d,0x97,0x06,0x12,0xd9,0x4f,0xdc,0x6d,0x30,0xa6,0x65,0xdf,0x61,0xf3,0x8b,0x11,0xcf,0xe0,0xae,0xc9,0xcf,0x4e,0x5d,0x38,0xea,0x75,0xff,0x04,0x45,0x47,0x84,0xca,0xe6,0x1d,0xf7,0x8c,0x01,0xcd,0x97,0x6a,0x40,0x03,0x1a,0x28,0x45,0xd0,0xdb,0x61,0xec,0x7d,0x17,0xbb,0x3e,0x4d,0x16,0xdb,0x9a,0xea,0xf5,0x76,0xab,0x2f,0x6a,0x43,0x46,0xbc,0xcd,0xb9,0x6d,0xd9,0xb5,0xda,0x70,0xdf,0xb2,0xe6,0x94,0xea,0xcd,0x9d,0xdd,0x9a,0xbc,0x73,0xa9,0x28,0x35,0x5b,0x12,0x41,0xe1,0x96,0xd4,0x6d,0x4d,0x24,0xa7,0x8a,0x94,0xb8,0xfb,0x3d,0x1c,0xcd,0x76,0x78,0x50,0xea,0x78,0xc0,0xff,0xae,0x6f,0x52,0x55,0xcd,0xdd,0xa8,0xb9,0x72,0x55,0x95,0x70,0xe3,0xe6,0xe9,0xdd,0xd4,0x84,0x4e,0x99,0xa7,0x4b,0x0b,0x65,0xa5,0x2b,0x6c,0x2e,0x4d,0x42,0xb6,0xac,0xa8,0xdb,0x12,0x49,0x5d,0xbd,0xe2,0x1e,0x02,0x2d,0x6c,0x35,0x30,0xa0,0x72,0x46,0x04,0x4e,0x51,0xaa,0x42,0x35,0x00,0x40,0x01,0x33,0x49,0x3a,0x60,0x5a,0xf1,0xd2,0x95,0x6c,0x2c,0x2d,0x5d,0x5a,0x9f,0x63,0x21,0x9f,0xe6,0x2f,0x73,0x29,0x4d,0xbc,0x94,0xaf,0x2d,0xa5,0x34,0xf1,0x72,0xb6,0xb4,0x94,0xba,0x82,0xc3,0xfe,0xcb,0x5a,0x46,0x93,0x34,0xe5,0x2b,0x5b,0xe9,0x85,0x5a,0xe2,0xc7,0xed,0xe5,0x0a,0xa7,0x4b,0x27,0xf8,0x04,0x88,0xae,0x8c,0x03,0x12,0x08,0x5e,0x74,0x65,0xe9,0xec,0x68,0x04,0x59,0x46,0x78,0x41,0xd7,0xe3,0x37,0x6d,0x62,0xc3,0x5b,0xaf,0xdf,0xc2,0xea,0x54,0xd2,0xe3,0x89,0x01,0x7e,0x2b,0xf7,0x80,0x07,0x14,0xd0,0xe5,0x15,0x38,0x60,0x8c,0x70,0x03,0x04,0x29,0x36,0xaa,0x5e,0x14,0x34,0x72,0xf6,0xa8,0xa6,0x6f,0x82,0xf4,0x2d,0xb3,0xeb,0x4b,0x5a,0x67,0x6a,0xc0,0xf0,0x2f,0x71,0x4f,0xc7,0xa8,0x8a,0x1c,0xb9,0xd8,0xdf,0xee,0x1e,0xbb,0x59,0xd0,0xd6,0xc2,0xff,0x2b,0xae,0xde,0xb4,0x62,0x66,0x9f,0xb0,0x75,0x73,0xd3,0x6e,0x72,0xfc,0x56,0x54,0xcb,0xba,0xb6,0x01,0x92,0xc7,0x26,0x40,0x4b,0x43,0x0c,0xc8,0x29,0xc5,0x01,0xcf,0xb8,0x1a,0xe0,0xa7,0x14,0x07,0xfc,0x56,0xea,0x01,0x05,0x98,0x60,0x5a,0x92,0xd4,0x29,0xb5,0xb8,0xeb,0xc8,0x52,0x17,0xb3,0x96,0x6e,0x23,0x2f,0x29,0x54,0x5b,0xf6,0x8d,0xae,0xa9,0x32,0x5e,0xdb,0x37,0xfa,0xa1,0xdb,0xb1,0x74,0xcb,0x68,0xbb,0x49,0x91,0xf6,0xcd,0x63,0x1e,0x3a,0x85,0x3a,0x56,0xb7,0x79,0x98,0x62,0xea,0xf8,0xdc,0xf6,0x9e,0x83,0xd4,0xe3,0x49,0x38,0x7a,0x71,0x54,0xaf,0xd9,0xe1,0xe8,0x53,0x55,0xb8,0xe7,0xc2,0xff,0x6e,0xe8,0x42,0x58,0xb6,0x6b,0xa7,0x61,0x68,0x25,0xcc,0x59,0xb4,0x86,0x11,0x82,0xc8,0x6a,0xf1,0x2a,0x47,0x2e,0x12,0x8d,0x37,0x27,0xef,0xc9,0xc9,0xa3,0x6e,0x9f,0x6c,0xd4,0x22,0x73,0x7f,0xb4,0x92,0x51,0x0b,0x2d,0x62,0xe2,0x48,0x46,0x43,0xd7,0x2e,0x29,0x2e,0x4b,0x92,0xaa,0x28,0x5c,0x8b,0xa6,0x6a,0xeb,0x24,0x95,0xe3,0x80,0x1d,0x93,0x35,0x90,0xf2,0x59,0x03,0x45,0xb3,0x75,0x29,0x47,0x27,0x96,0x98,0xc5,0x65,0x18,0xcd,0x88,0xbc,0x16,0xd7,0x21,0xad,0x63,0x10,0x49,0x6e,0xed,0xb8,0xf9,0x1d,0xfe,0x6d,0xf8,0xde,0xc4,0xc4,0xe8,0x29,0x60,0x00,0x2e,0x0f,0x9c,0x78,0x29,0x71,0x2a,0x4e,0x77,0xc3,0x15,0x74,0x2a,0xae,0xc3,0xce,0x76,0x30,0xc2,0xa5,0x44,0x78,0xd1,0x6d,0x4f,0x46,0x39,0xb8,0xbb,0x07,0xf6,0x5b,0x6d,0x91,0x6e,0xa9,0xf2,0x65,0xf4,0xc9,0x98,0x97,0x69,0x9f,0x3a,0xe7,0x2d,0x6c,0xc1,0x9a,0x8f,0xca,0xde,0x70,0x04,0x9d,0xee,0xc9,0x79,0xe2,0xe1,0x1f,0xf8]);
const PL_WORD_BANK_4 = Uint8Array.from([0xa7,0xa8,0x51,0xc3,0x3b,0xa4,0x9c,0xbc,0x66,0x73,0x8f,0xb2,0x73,0xf2,0x1a,0x35,0xbc,0x52,0xf6,0x49,0x6b,0x32,0xf3,0x48,0xc9,0x27,0xa9,0x5e,0xd3,0x3a,0x64,0x9f,0xa4,0x78,0x75,0x8f,0xb2,0x72,0xd2,0x6c,0xa4,0x35,0x43,0xce,0xc8,0x82,0xd6,0xd6,0x30,0x27,0x2d,0xf3,0x5a,0x5b,0x22,0x92,0x8e,0xdc,0x1b,0x6d,0x33,0x73,0xb2,0x0a,0x6f,0x23,0x4d,0xcd,0xf1,0xa8,0x7c,0x8d,0x20,0xcb,0xd4,0xa3,0xf6,0x35,0x9d,0x25,0x13,0xb7,0xda,0xc6,0x35,0x96,0x98,0xda,0x3a,0x67,0xce,0x59,0x7c,0xce,0xe8,0x6c,0x58,0x67,0xae,0x2a,0xa7,0x8b,0x6e,0x53,0x39,0xa3,0x9d,0x3e,0xba,0x4d,0xa5,0x1a,0x7d,0xfa,0x18,0x36,0x94,0xab,0xca,0xe9,0x93,0xbb,0x50,0xce,0x51,0x67,0x48,0xe1,0xc2,0x38,0xc7,0x9c,0x21,0xf9,0x0b,0x15,0x9f,0x7c,0xc6,0x58,0x56,0xcd,0x7c,0xf2,0x19,0x93,0xbb,0x30,0xd3,0xd9,0x67,0x2c,0x66,0x32,0x54,0xe6,0x9c,0xb9,0xa8,0x8a,0x52,0x99,0x7d,0xd6,0x22,0x53,0x8b,0x65,0x4e,0xd9,0xa2,0x35,0x4b,0xa8,0xb9,0x6a,0x83,0xc9,0x4f,0xd4,0xed,0x98,0x0d,0xa6,0x9a,0x64,0x89,0xac,0x00,0x27,0x78,0x08,0x20,0x04,0x1d,0x00,0xc0,0xff,0x0c,0x98,0xb2,0x4d,0x00,0x47,0x85,0x0b,0xe0,0xe8,0x0c,0x03,0xbc,0x90,0xe1,0x80,0x6f,0xdd,0x03,0x70,0xb5,0x79,0x01,0x2a,0x51,0x3f,0x65,0x72,0xea,0xe9,0x19,0xfb,0x94,0x29,0x8a,0x57,0x58,0xa3,0x53,0xa5,0x42,0x5e,0x6e,0x8d,0x4f,0x95,0x0a,0xeb,0x38,0x2f,0x59,0x75,0xac,0xa4,0x6b,0x32,0x65,0xd4,0x79,0x62,0x0c,0xc6,0xe8,0xd6,0xe6,0x8d,0x3e,0x14,0xb3,0x08,0xc0,0x13,0x36,0x01,0x54,0xc1,0x02,0x05,0x54,0xa3,0x62,0x80,0x20,0x25,0x4f,0xdf,0x2d,0x8b,0x67,0x46,0x3e,0x43,0x73,0x22,0x9a,0x59,0xe7,0xcc,0xcd,0x8a,0x5a,0x66,0xe5,0xb3,0x34,0x2f,0x66,0x59,0x55,0xcf,0x5a,0x3d,0xbb,0x57,0x85,0x3d,0x6b,0x35,0x62,0x11,0x55,0xf9,0x6c,0xd5,0xa8,0x46,0x56,0xe9,0xb6,0x44,0x61,0xd5,0x69,0xa6,0x08,0xe0,0x70,0x0c,0x01,0x06,0xa6,0x6a,0xf1,0xf6,0xa6,0x91,0x11,0x6b,0xc5,0x4b,0xa9,0x79,0x66,0x64,0xa3,0x36,0x11,0xdc,0x5d,0xb5,0x00,0x00,0xfe,0xa0,0x80,0x72,0x35,0x14,0x90,0x36,0xa5,0x01,0xf2,0x75,0x35,0x40,0x32,0x4b,0x06,0x88,0xba,0x59,0x01,0xca,0xb6,0xb6,0xda,0x84,0x35,0xd5,0xb4,0x57,0x6a,0x53,0xc7,0x58,0xc7,0x4e,0xab,0x5c,0x2b,0x32,0x6d,0x6b,0xa3,0xf2,0x23,0x54,0xb5,0x9d,0xac,0x2a,0xce,0x0c,0xf1,0x55,0xba,0x9a,0xb8,0x22,0x39,0x47,0xf1,0xe9,0xe2,0x8c,0xe4,0x6c,0xc5,0x67,0x88,0xdb,0x4b,0x3a,0x9c,0xac,0x39,0x1e,0x0f,0xf7,0x92,0xd3,0xb6,0x58,0x23,0x95,0xc3,0x4a,0x3b,0x73,0x8a,0x72,0x0a,0xcb,0xe3,0xaf,0xc9,0x26,0x38,0x22,0x1b,0x20,0x78,0x11,0x01,0x04,0xaf,0x44,0x80,0x10,0x04,0x08,0x10,0xb3,0x12,0x01,0x1c,0x77,0x41,0x7e,0x13,0x6e,0x51,0x9e,0xb8,0xf8,0xb5,0xb5,0x86,0x7b,0x9c,0xe6,0xb7,0xde,0xe4,0xee,0x75,0x14,0x50,0x92,0xa9,0x02,0x6a,0x61,0x61,0x40,0x89,0xcc,0x04,0x48,0x5a,0x89,0x00,0xd1,0x08,0x03,0x00,0xfc,0x50,0x82,0xda,0x56,0x32,0x3d,0xce,0x09,0x5a,0x38,0xb1,0x72,0xcb,0x27,0x69,0x75,0x4d,0x4d,0x93,0x9e,0xb2,0x06,0x55,0x57,0xaf,0x75,0x9a,0x1a,0x45,0x2d,0x22,0xd6,0x69,0x6a,0x10,0x55,0x8f,0xc6,0xa7,0xa9,0x96,0x9c,0x23,0x13,0xae,0x36,0x4a,0xca,0xf0,0xb2,0x3d,0x9a,0xa8,0xa8,0x2c,0xda,0xd1,0x68,0x82,0xe4,0xd4,0x1c,0x45,0xa3,0x89,0x9a,0x9d,0xa7,0x1d,0xb5,0xc6,0x2b,0x09,0xed,0x95,0x33,0x9a,0xa2,0xd0,0x2c,0x33,0x69,0x00,0x66,0x11,0x0a,0xc0,0x9c,0x1d,0x09,0x98,0x7d,0x3c,0x01,0xbd,0xa7,0x25,0xa0,0xd7,0xb4,0x00,0xb4,0x14,0x71,0xd2,0x16,0xc2,0x55,0x55,0xee,0x49,0x63,0xe1,0xb0,0x30,0xb7,0x27,0x8b,0x5d,0xd2,0x4c,0xd2,0x9e,0x22,0x36,0x69,0x31,0x69,0xbd,0xca,0x30,0x2c,0xc5,0xb4,0xd5,0xa9,0x43,0xcb,0x10,0xd3,0x4e,0xa7,0x0d,0xa5,0x43,0x55,0x56,0x9d,0x2e,0xe4,0x09,0x76,0x5d,0xb8,0xfa,0x90,0x36,0xc9,0x75,0xd5,0xea,0x43,0xda,0x24,0xd7,0x55,0x63,0xf0,0x75,0x9c,0xdc,0x66,0xb6,0xd1,0x5f,0x17,0xa9,0x2a,0xdc,0x46,0x77,0x43,0xa4,0xb2,0x50,0x99,0xdc,0x09,0x92,0xf1,0xd0,0x65,0xf2,0x7d,0x0c,0xcb,0x4b,0x95,0xd9,0xcd,0x36,0xf2,0xa8,0x99,0x16,0xdb,0x46,0xa1,0xa2,0x66,0x5a,0x6c,0xda,0x00,0xf3,0x59,0x69,0x35,0x71,0x0b,0xcc,0x6b,0x13,0x00,0x6f,0x67,0x00,0xf8,0x20,0x80,0xc4,0x6c,0x4e,0xb6,0x9c,0xb2,0x69,0xc6,0x39,0x79,0x77,0xc2,0x1a,0x13,0xe7,0xe4,0xdd,0x2a,0x9b,0x77,0x95,0x93,0x37,0xab,0xe4,0x59,0x95,0x4f,0xde,0xad,0x91,0x46,0x4d,0x3e,0x79,0xb7,0xca,0xea,0x5d,0xa5,0xe5,0x99,0xb3,0x67,0x56,0xa0,0x50,0x1a,0xe6,0x95,0x13,0x42,0x52,0x59,0x31,0x46,0x75,0xd7,0x6e,0xe9,0x72,0xca,0xa4,0x9e,0x24,0x00,0x8d,0xa2,0x25,0xa0,0x10,0x8c,0xd3,0x8c,0xa0,0x2a,0x66,0xad,0x4e,0x57,0xa4,0x9a,0x65,0xa5,0x3a,0x5d,0x51,0xe2,0xd2,0xde,0x38,0x00,0x2a,0x50,0x05,0x40,0x46,0xee,0xd5,0x87,0x2c,0xa1,0x13,0x8e,0xcf,0xe0,0x93,0xa6,0x79,0xd4,0x5e,0x83,0xef,0x6a,0xd6,0x19,0x65,0x0d,0x3e,0xa7,0x71,0x65,0xa5,0x31,0xf8,0xe1,0xa2,0x5d,0x61,0xd7,0x10,0x52,0x05,0x79,0x8d,0x5e,0x63,0xb4,0x5d,0x24,0x7e,0x7b,0x8d,0xd1,0x75,0x13,0xfb,0xec,0x35,0x46,0x37,0xc5,0xec,0x93,0xc6,0x14,0xec,0x34,0x71,0x4c,0x19,0x53,0x70,0xd3,0xc8,0x39,0xa6,0x4c,0xc1,0xcd,0x20,0xe7,0x59,0x00,0x80,0xff,0xa7,0xef,0xd2,0xc5,0xdd,0x2b,0x9f,0xbe,0x78,0x17,0xaf,0x8a,0x72,0xba,0x62,0x5d,0xcd,0xb3,0xcc,0xe9,0xb2,0xf6,0x50,0xab,0x29,0xab,0x8f,0xdc,0xd3,0x35,0xa6,0x8e,0x3e,0xd0,0x0e,0x33,0x1f,0xd3,0x3a,0x4f,0x36,0xb9,0xa2,0x76,0xeb,0x3c,0x5d,0x97,0x88,0x29,0xab,0x0d,0x36,0xcd,0x6c,0xc2,0x9e,0x36,0x79,0x37,0x8d,0x91,0x72,0xda,0x1c,0xdd,0xb5,0x46,0xca,0x69,0x4b,0x32,0xf7,0x6a,0xd9,0xa7,0x2d,0x51,0xc3,0xb2,0x2c,0x9f,0xa6,0x26,0x0e,0x89,0x92,0x1d,0xea,0xec,0xd5,0x53,0xdd,0x32,0xa9,0x9b,0x32,0xcd,0x8a,0x34,0x0a,0x68,0x8e,0x95,0x01,0x99,0x53,0x10,0x20,0x11,0x0a,0x07,0x34,0xa3,0x9d,0x80,0x55,0xd3,0x13,0x30,0xfa,0x54,0x02,0x5a,0xeb,0x4c,0x40,0x8e,0x6c,0x27,0xcf,0x8d,0xdd,0xd3,0xec,0x9c,0x22,0x35,0xae,0x70,0x4d,0x73,0x8a,0xd4,0xb4,0xcd,0xad,0xc9,0x29,0x52,0xf5,0x76,0x8d,0x29,0xa7,0x48,0x35,0x33,0x38,0xab,0x9c,0x32,0xe5,0xca,0xe4,0xa8,0x7a,0x9a,0x94,0x2a,0x5d,0x32,0xca,0xe9,0x52,0x8b,0x34,0x2f,0x39,0xa7,0x4f,0x39,0xc3,0x35,0xac,0x9c,0xb1,0x84,0x28,0x0d,0xb7,0xbc,0xe6,0x6a,0xa5,0x78,0x24,0x74,0xdb,0x82,0x92,0x94,0x76,0x2b,0x6b,0x2f,0xca,0x4a,0x2b,0x44,0x9f,0x2d,0x1b,0xb7,0x8a,0x10,0x73,0xf6,0x1a,0x54,0x2b,0x3d,0xf0,0xd9,0x5b,0x11,0x8d,0xf0,0xd0,0x67,0x6b,0x4d,0xc4,0xdd,0x4b,0x0b,0xc0,0x6a,0x32,0x02,0xc8,0xe0,0x4e,0x00,0x6a,0xd3,0x13,0xd9,0xc7,0x79,0x98,0x2a,0x29,0x64,0x6f,0xcd,0x6a,0xde,0x44,0x01,0x3d,0x3a,0x29,0xa0,0x79,0x25,0x01,0x14,0xc3,0xcc,0x80,0xac,0x54,0x08,0x90,0x0d,0x09,0x00,0xc0,0xff,0x8c,0x9f,0x69,0x2a,0x3d,0xe2,0x38,0x7e,0xfa,0x9d,0x72,0x8f,0xab,0x80,0x11,0xca,0x05,0xd0,0x4d,0x9a,0x02,0x86,0x73,0x73,0x40,0x57,0x69,0x09,0x90,0x2a,0xe2,0x14,0x45,0xbb,0x86,0x66,0xe5,0x53,0x45,0x33,0x1a,0x9e,0x45,0x56,0x15,0xe4,0xa7,0xa9,0x95,0x5a,0x55,0x12,0xb1,0x45,0x52,0x7b,0x55,0x81,0x6d,0x07,0x4b,0x95,0x51,0x05,0xbe,0x9d,0xa0,0x93,0x4b,0xe5,0xc5,0x85,0x92,0xcf,0x31,0x5d,0x04,0x91,0xe9,0xe1,0x14,0x1c,0xd0,0x58,0x59,0x00,0x36,0x31,0x4f,0x40,0xc6,0x66,0xa7,0xcf,0xc1,0xcc,0xdd,0x2b,0x9f,0xbe,0x24,0x89,0x08,0x8d,0xb3,0xa6,0x54,0xa8,0xc2,0xac,0xca,0x9a,0x53,0xa3,0x2a,0xf5,0xca,0x63,0x8e,0x85,0xb3,0x5d,0x26,0x8d,0x39,0x57,0xec,0x52,0x1b,0xd2,0xe6,0x5c,0xb1,0xda,0x74,0x50,0x5b,0x52,0xa1,0x2c,0xd3,0x08,0x65,0xc9,0x05,0x23,0x4d,0x23,0xa6,0x35,0x67,0xf4,0x70,0xac,0xe4,0xd6,0x14,0x31,0xdc,0xa8,0x8a,0x28,0x63,0x80,0x52,0xd7,0xb0,0x62,0xce,0x11,0x4c,0x5d,0x2a,0x03,0x00,0xfc,0x04,0xe8,0x21,0x9c,0x00,0xa3,0x94,0x33,0x60,0x78,0x33,0x03,0x54,0x13,0xe6,0x80,0x61,0x22,0x1c,0xd0,0x6d,0x78,0x00,0x9a,0x0a,0x73,0x40,0xd3,0x61,0x27,0x2e,0x2a,0xdc,0xdd,0x9c,0x8c,0x30,0x4c,0xb4,0x34,0x5d,0xbd,0x82,0xd8,0xc8,0xc3,0x74,0xca,0x09,0x72,0x25,0x0d,0xd7,0xc5,0x27,0xa8,0x95,0xc4,0xdd,0x6e,0x9f,0xb0,0x26,0xe2,0xcc,0x98,0x72,0xa2,0xea,0x89,0x27,0x73,0x54,0x4a,0x8a,0x27,0x2e,0xa9,0xb1,0xac,0x60,0xb6,0xad,0xc2,0x6a,0x97,0x28,0xe7,0xb2,0x0e,0x4f,0x32,0xdc,0x94,0xca,0x4b,0x34,0x76,0xcb,0xb3,0x2b,0x77,0x05,0xc7,0xab,0x8f,0xc9,0xc2,0x30,0xe6,0x9c,0x3e,0x59,0x8e,0x56,0x9b,0x7d,0xfa,0xe2,0x28,0x43,0xab,0xca,0x19,0x8a,0x23,0x77,0x9f,0x28,0x6b,0xcc,0x86,0x22,0x6c,0xa3,0x8c,0x31,0x6a,0xca,0xf4,0xb5,0x3c,0xa6,0x24,0x29,0x56,0xc7,0x6c,0x99,0x82,0xe4,0x7a,0x49,0xb1,0x63,0xec,0xc4,0x45,0xc3,0x13,0x2b,0xa0,0x00,0x77,0x05,0x2c,0x16,0xae,0x80,0x23,0xcd,0x15,0xb0,0x78,0xa8,0x01,0x96,0x4c,0x75,0x40,0xc1,0xae,0x09,0x10,0xd6,0xf3,0x8c,0xdd,0x2a,0x79,0xd4,0x94,0x33,0x76,0x23,0x14,0x59,0x93,0xcf,0xd4,0x8d,0x50,0x54,0x4d,0x3e,0x53,0x37,0x42,0xd1,0x35,0xe5,0xcc,0x4d,0x33,0x67,0x4f,0xd9,0x33,0x37,0xc3,0x1c,0xbd,0xa5,0xc7,0x52,0x24,0x66,0x4d,0x84,0x19,0x4b,0xb7,0x28,0xb1,0x19,0x65,0x2c,0xc3,0x22,0xfb,0x76,0x98,0xb6,0x0c,0x03,0x62,0x5b,0x61,0xcb,0xd2,0x0d,0xa8,0x5f,0x85,0x29,0x6b,0x65,0xa4,0x7d,0x1e,0x06,0x00,0xe0,0xff,0xc8,0x29,0x98,0xcb,0x23,0x24,0x1b,0x60,0x7a,0xce,0x04,0xac,0x28,0x9a,0x80,0xd5,0xdb,0x0b,0x90,0x05,0xc5,0x49,0x8b,0x67,0x8d,0xce,0xca,0x27,0x2d,0x5e,0x34,0x23,0x2b,0x9d,0x34,0x07,0xb5,0xf2,0x8a,0x74,0xd2,0x12,0xcd,0xda,0x32,0xf2,0x49,0x73,0xd4,0x28,0xab,0xc8,0x27,0xcb,0xc9,0xa2,0xb4,0x2c,0x9f,0x2c,0x45,0x4d,0xf3,0xb0,0xb5,0x8a,0xec,0xa5,0xb1,0x35,0xd2,0x29,0x72,0x90,0xa2,0xd6,0xca,0xa7,0xcc,0x49,0x52,0x86,0x8b,0xae,0x2a,0x17,0x2a,0x2d,0x1a,0xbb,0x9a,0xd4,0x29,0xbd,0xb0,0xe1,0x68,0x53,0xc7,0x31,0xb5,0x1a,0xad,0x8d,0x1d,0xc7,0xd4,0x6a,0xb6,0x2e,0x36,0x1c,0x31,0xab,0x3c,0xba,0xdc,0x31,0xc3,0x6d,0xc8,0xe9,0x52,0x14,0xeb,0xe6,0x4a,0xa7,0xcb,0x81,0xbd,0xc3,0x4b,0x9f,0xbe,0x18,0x89,0x0e,0x0b,0x73,0xfa,0x62,0x54,0x27,0x2d,0xf2,0xe9,0xb3,0x32,0xef,0xb2,0x30,0xa7,0xcf,0xc6,0xb4,0xd3,0xcd,0x9c,0x3e,0x19,0xb1,0xca,0x8c,0x74,0xfa,0xe2,0xd9,0xad,0xb2,0xd2,0xe9,0x93,0x93,0xf4,0x76,0x5b,0x67,0xc8,0x99,0xd2,0xdb,0x63,0xad,0x21,0x65,0x8a,0x18,0x89,0x3c,0x86,0x5c,0x30,0xb3,0x65,0x52,0x1b,0x52,0xa6,0xc8,0xe6,0x21,0x6d,0xc8,0x95,0x2c,0x97,0x86,0xb4,0xb1,0x2c,0x4c,0x0f,0x3d,0xda,0xc6,0xb2,0x30,0x3c,0xf4,0x70,0x19,0x4b,0x27,0xf3,0xe4,0x23,0x69,0xac,0x0b,0x53,0xcc,0x86,0x86,0xb1,0x66,0x0c,0x75,0x29,0xea,0x96,0x92,0x39,0xd4,0xb9,0x28,0x01,0xb8,0xc7,0x02,0x00,0xf8,0x27,0x2f,0x82,0xbd,0xa6,0xac,0x9c,0x7c,0x48,0x61,0xe9,0x9a,0x73,0xf2,0xee,0x58,0xb4,0xb2,0xca,0xc8,0xbd,0xe5,0x6c,0x6d,0xa6,0x2d,0x97,0xd6,0xda,0xdd,0xd5,0xac,0x34,0x13,0xb3,0x48,0x0f,0x9d,0x80,0x06,0x30,0x02,0xb0,0x9d,0x40,0x00,0x5e,0x2d,0x0f,0xc0,0xee,0xe3,0x06,0x58,0xad,0x52,0x01,0x63,0x76,0x18,0xa0,0xcf,0xee,0x00,0xf4,0x39,0x55,0x80,0x5e,0x55,0x4e,0x51,0xa3,0xaa,0x84,0xa7,0x3a,0x55,0xca,0x98,0x51,0x9e,0xf8,0xd4,0x29,0x63,0x44,0x79,0xe2,0xd5,0xa4,0x44,0x69,0xa1,0x8d,0x5b,0x1b,0x1d,0xb4,0x47,0xd4,0x6e,0x6d,0x72,0xd0,0x1e,0x59,0x7b,0xf4,0xc9,0x41,0x69,0x54,0xec,0xd5,0x17,0x8f,0x29,0x19,0x55,0x4e,0x5f,0x3c,0xb9,0xb9,0xd7,0x3e,0x7d,0x8d,0x66,0xea,0x56,0xeb,0xf4,0x35,0x9b,0x59,0x78,0x99,0x33,0xd4,0xa2,0x6e,0x1e,0x61,0xcf,0x58,0x93,0x99,0x46,0x9a,0x3e,0x63,0x4d,0x66,0x96,0x61,0xe5,0x8c,0x2d,0x9a,0xa9,0x97,0x95,0x33,0xb6,0x60,0xaa,0x56,0x56,0xda,0x54,0x2c,0x05,0x75,0xca,0x6a,0x63,0x31,0x98,0xd2,0x41,0x2b,0xf5,0x51,0x61,0xea,0xb4,0xec,0x54,0x55,0x6e,0x1e,0x61,0xb6,0x4f,0xb2,0x9c,0x97,0x55,0x99,0x56,0x40,0xe1,0x11,0x00,0x00,0xff,0xad,0x31,0xd2,0xb3,0x35,0xa2,0x96,0x5a,0x4a,0xef,0x33,0x37,0x5b,0x2a,0xad,0x64,0x32,0x8b,0xe1,0xa8,0x02,0x57,0xef,0xcc,0x52,0xa7,0x48,0x81,0x25,0x2a,0xac,0x9c,0x3c,0x7b,0x0d,0xcb,0x94,0x7c,0xb2,0x50,0xdd,0xc5,0x42,0xf2,0xc9,0x62,0x0f,0x09,0x0b,0xb3,0x27,0x8b,0x23,0x29,0xd2,0xcc,0xac,0x2c,0x2e,0x93,0x8c,0x10,0xbb,0xb2,0xb8,0x4d,0x32,0x5c,0xec,0x2a,0xe2,0x32,0x93,0x72,0x29,0xab,0x8e,0xd3,0x4d,0x32,0xc4,0x9e,0x26,0xcd,0xd0,0x88,0x30,0x73,0xfa,0x54,0x2b,0x4c,0x2b,0xec,0x19,0x52,0xae,0x08,0xcd,0x30,0x67,0x48,0x39,0x23,0x34,0xc2,0x9c,0x29,0x95,0x0a,0xd7,0x0c,0x73,0xe6,0x94,0x2a,0x42,0xbd,0xcc,0x99,0x53,0xcc,0x70,0xf5,0x32,0x63,0x49,0x2e,0x33,0x54,0xc7,0x98,0x85,0x04,0x2f,0xd1,0xae,0x62,0x26,0x9e,0x43,0xc3,0xdd,0x0e,0x01,0xc0,0x4b,0x23,0x80,0x8c,0x16,0x04,0x10,0xd1,0x02,0x00,0xfe,0xad,0x4a,0x1a,0xdb,0x2c,0xe4,0x94,0xd6,0x49,0xda,0xf4,0x92,0x53,0x5a,0x23,0x79,0xca,0xc6,0x74,0x6b,0x83,0xc6,0xae,0x68,0x4b,0xab,0x8a,0x96,0x2a,0xd3,0x4b,0xae,0x3a,0x19,0x8a,0x1a,0x29,0x72,0xea,0x1e,0x44,0x78,0x74,0x4c,0x00,0xbc,0xc0,0x28,0xc0,0x08,0x42,0x05,0x98,0xb3,0x2c,0x01,0xf3,0x74,0x24,0x60,0xae,0xcd,0x04,0xac,0xbd,0x99,0x80,0x39,0x4b,0x4e,0xdc,0x3d,0x71,0x64,0xd4,0x59,0x71,0x92,0xec,0xb3,0x16,0x7a,0xc5,0x49,0x72,0xec,0x9a,0xa8,0x95,0x64,0x49,0xbe,0x13,0x46,0x57,0x96,0x39,0xfb,0xae,0x88,0x59,0x79,0x11,0xe4,0xd7,0x26,0xfe,0xe4,0x4d,0xa1,0x4e,0x59,0x94,0x53,0x0d,0x4f,0x9c,0x15,0x56,0x4f,0xdb,0x3d,0x6a,0x46,0xd8,0x3d,0x7d,0xd3,0x68,0x1d,0x2e,0xf7,0x0c,0x85,0x4b,0x94,0x9b,0x9d,0x33,0x76,0x43,0x1e,0x1e,0x76,0xd6,0x58,0x3d,0xa9,0x6a,0xdb,0x19,0x63,0x71,0xe8,0x52,0x65,0xbb,0x8d,0xd9,0x60,0x6a,0x95,0xe3,0x36,0x65,0x8b,0xa1,0x5d,0xb6,0xc7,0x54,0x1c,0x9a,0x44,0x39,0x4a,0x53,0x50,0x94,0xd6,0x19,0xab,0x3c,0x49,0x60,0xf9,0x14,0x6d,0x02,0x78,0x2e,0x0d,0x00,0xf0,0xad,0x8e,0x86,0xd2,0xd3,0x9d,0x8c,0x3a,0x69,0xb2,0xf0,0x4a,0xb2,0xaa,0xa4,0xd8,0x42,0xd3,0xe9,0x2a,0x83,0xe4,0x48,0x2f,0xa7,0x23,0xb7,0x56,0x3d,0x34,0x93,0x9d,0x3c,0x84,0x08,0x13,0x89,0x73,0xe2,0x54,0xaa,0x55,0x3d,0xca,0x89,0x52,0xcd,0x16,0x8f,0x28,0x27,0x4c,0x2d,0x5b,0x2d,0xe2,0x9c,0x30,0x8d,0x28,0xf1,0xb2,0x7b,0xa2,0xb4,0x22,0xd5,0xdb,0xca,0x89,0xe3,0x8c,0x74,0x69,0xab,0x27,0x4d,0x35,0xca,0xb9,0xa3,0x9c,0x32,0x47,0xed,0x90,0x8e,0xd2,0xda,0x96,0xa8,0x45,0x2d,0xf1,0x1a,0xd7,0x70,0x22,0x8f,0xc4,0x67,0x18,0x86,0x39,0x3a,0x62,0x9f,0xbe,0x2a,0x72,0xef,0x6c,0xb0,0xfa,0x24,0x24,0xb3,0x2b,0xc2,0xea,0xa3,0xb4,0x8c,0xc9,0x52,0x6b,0x88,0xca,0x3c,0xab,0x0a,0xaf,0x21,0xe8,0xf0,0xa8,0x8c,0xbc,0xc6,0xe0,0x33,0xd8,0xb2,0xca,0x1a,0x42,0xa8,0x10,0xaf,0xd8,0x6b,0x88,0x2e,0x5b,0xcc,0x6b,0x8e,0x21,0x86,0x28,0x75,0x8d,0xb9,0x86,0xe4,0x3c,0x2d,0x25,0xc5,0x18,0x72,0xa1,0xd2,0xf4,0x50,0x63,0x28,0x99,0xdd,0x53,0x46,0x8d,0x21,0x47,0xce,0x08,0x2a,0x3d,0xc6,0x32,0xd9,0x2c,0x79,0xd4,0x1a,0x6b,0xe3,0xb0,0xe0,0x8a,0x6d,0xac,0x1d,0x53,0x4d,0x43,0x97,0xa9,0x54,0x0c,0x37,0x1a,0x52,0xa6,0x52,0xd1,0xcd,0x78,0x48,0x99,0x6a,0x27,0x57,0xe5,0xb1,0x61,0xa8,0x9d,0x5c,0x95,0xc7,0x00,0x00,0xfc,0xad,0x0e,0x9a,0xd2,0xd3,0x9d,0x8c,0x2a,0x69,0xb2,0xb0,0x4a,0x72,0xaa,0xa4,0xd8,0x42,0xd3,0xe9,0x28,0xbd,0x94,0x28,0xab,0x64,0x2b,0x0f,0x8a,0xb3,0xbc,0x92,0xad,0xcc,0x68,0x8b,0xf2,0xac,0x7b,0xe2,0xd0,0xbd,0xd8,0xc3,0xc9,0x89,0xe3,0x8c,0x10,0x73,0x3b,0x27,0x4a,0x23,0x4d,0x35,0xec,0x9c,0x30,0xd5,0x16,0x33,0x8f,0x72,0xc2,0x34,0xdd,0xdc,0xcd,0xca,0x89,0x52,0xf5,0x34,0x8b,0x28,0x27,0xc9,0x59,0x5b,0xbc,0xac,0x9c,0xac,0x44,0x09,0xc9,0xa8,0xd2,0x9a,0xe4,0xb4,0x54,0xd9,0x4e,0xa9,0xab,0x50,0xd7,0x30,0xcb,0xa7,0xd9,0x6b,0x4b,0x59,0x28,0x9f,0x6e,0x59,0x51,0x89,0x48,0x7d,0xba,0x6a,0xc5,0x3c,0x33,0xd6,0xe9,0x5b,0x54,0x17,0xf3,0x59,0xa7,0xaf,0x4e,0xc2,0x3c,0xa2,0x8c,0x21,0xca,0x2a,0x65,0x5b,0xd2,0x06,0x1f,0xcb,0xc9,0xb3,0xea,0xe8,0x43,0x28,0xe5,0x88,0xaa,0xab,0x8f,0x21,0xd4,0xdc,0xab,0x9e,0x3e,0x05,0x37,0x8b,0x8c,0x7b,0xfa,0x6a,0xd5,0xcd,0xb3,0xce,0xe9,0xab,0x13,0xf3,0xa8,0xaa,0xa7,0x2f,0x9e,0x2d,0xb2,0xa2,0x9e,0xa1,0x58,0xd6,0xca,0x2a,0xbd,0x86,0xa4,0xc4,0xb7,0x22,0xe4,0x18,0x92,0xe6,0x8c,0xaa,0x4a,0x63,0xc8,0x86,0xc2,0x2b,0x63,0xad,0xa1,0x44,0x0a,0x6b,0xaf,0xb5,0x86,0x92,0x30,0xbd,0xbc,0xd6,0x1a,0x4a,0x23,0xf7,0xd2,0x49,0x63,0x2c,0x03,0xd3,0xdc,0x27,0x8d,0xb1,0x4c,0xb2,0x48,0xbe,0xd4,0xc6,0xb2,0xb0,0xd5,0x7d,0x58,0x1a,0x53,0x26,0xcd,0xc1,0x4a,0x65,0xca,0x89,0xd5,0x0b,0x4b,0x85,0xb1,0x64,0x54,0x0f,0xa9,0xe5,0xe6,0x52,0x29,0x54,0xcc,0x92,0x9a,0x4a,0xc5,0x30,0x93,0x22,0x04,0xa0,0x0e,0x9b,0x00,0xc0,0x4a,0x01,0x00,0xfc,0x09,0x70,0x9d,0x2d,0x00,0x61,0x91,0x9e,0x2c,0xe5,0xca,0x14,0xab,0x72,0x92,0xd4,0xa3,0x8c,0x2b,0xec,0x89,0xd3,0xf2,0x52,0x2b,0x73,0x2b,0x8a,0xcf,0x2c,0x3c,0xc2,0xac,0x38,0x3e,0xe7,0x2c,0x8b,0xd2,0xe2,0xb0,0x2c,0xcd,0x2a,0xac,0xc9,0x42,0xa3,0x94,0x08,0x29,0x24,0x53,0x6e,0x42,0x59,0x9d,0x32,0xa0,0x28,0x55,0x06,0x64,0xad,0xca,0x00,0x6f,0xc4,0x5a,0x15,0x9b,0x99,0xb8,0xdb,0x2e,0xa5,0x1d,0xec,0x51,0xee,0xa4,0xb5,0x61,0x93,0x95,0xbb,0xdd,0xd2,0xba,0x89,0xde,0xe9,0x71,0x52,0xab,0x3a,0x65,0xa5,0xa5,0x5e,0x6d,0xac,0x6c,0x59,0x9a,0xa6,0x74,0x2e,0xf3,0x86,0x5b,0x91,0xd1,0xfb,0xe0,0xd1,0x45,0x95,0x47,0x1f,0x83,0xe8,0x0c,0x97,0x39,0x7d,0x8d,0x18,0x5a,0x55,0x7b,0xf5,0x35,0x60,0x58,0x75,0xe5,0xd1,0x47,0xc7,0x55,0x1d,0xb6,0xc6,0x90,0x2c,0x55,0x5c,0x58,0x6c,0x7d,0xab,0xec,0x64,0xde,0x78,0xf5,0xc5,0xb1,0xd9,0x44,0xad,0x31,0x44,0xc3,0x59,0x27,0xa1,0xc6,0x90,0x02,0x79,0x8e,0xcf,0x1c,0x63,0x8a,0x98,0x39,0x36,0xab,0x8d,0x31,0x62,0x57,0xf9,0xa4,0x36,0xc6,0x88,0xd9,0x6d,0x33,0xdb,0x54,0x26,0x36,0x65,0x05,0x6b,0x53,0x59,0x58,0x62,0x31,0xb4,0x4d,0x65,0x60,0xa9,0x45,0xe9,0x34,0x95,0x81,0x29,0x16,0xc5,0xcc,0x9c,0x33,0xba,0x99,0x0d,0x25,0x00,0xf0,0x34,0x00,0x00,0xff,0x27,0x4d,0xa5,0x23,0x3d,0x6b,0x9f,0x34,0xad,0xb4,0x8c,0x8a,0x72,0xd2,0x34,0x2a,0xc2,0x2a,0xca,0x49,0xd3,0x8c,0x34,0xef,0x28,0x27,0x8e,0x3b,0x34,0xa2,0xcd,0x9c,0x38,0x4e,0x0f,0x8b,0x96,0x7a,0xa2,0x94,0x7d,0x28,0x5b,0x8a,0x00,0x98,0x6c,0x13,0x40,0x27,0x69,0x02,0xd8,0x22,0x5c,0x01,0x5b,0x84,0x2b,0xe0,0x48,0x0f,0x03,0x0c,0xda,0xe6,0x80,0x28,0x3c,0x4f,0x1b,0x5c,0xbb,0x6a,0x54,0x1e,0xad,0xf3,0x23,0x6e,0x51,0x77,0xb5,0x51,0x76,0x18,0xc6,0x9c,0xd5,0x26,0x59,0x65,0x18,0x73,0x4e,0x5b,0x44,0x85,0xb3,0xd7,0x3d,0x6d,0x51,0xe5,0x2e,0x51,0xf7,0xb4,0xd5,0xb9,0x19,0x77,0x9d,0xd3,0x36,0x6f,0xe6,0xdc,0x55,0x4f,0xdf,0xa3,0x72,0x68,0x4d,0x39,0x7d,0x0f,0x46,0xe1,0x39,0xe5,0xf4,0x2d,0x89,0xa4,0xd5,0x98,0xd3,0xf7,0xa8,0x9c,0x96,0x67,0x56,0x5f,0x03,0x9b,0x59,0x54,0x3e,0x7d,0x4b,0x6c,0x5a,0x36,0xfb,0xf4,0xb5,0xb0,0x5a,0xd9,0xa2,0xd3,0xd7,0x46,0xee,0xe9,0xb3,0x4f,0x5f,0x3a,0x5a,0x86,0xce,0x1e,0x7d,0xe9,0x68,0x99,0x72,0x79,0xf5,0xa5,0xa3,0x57,0xc8,0xa5,0xd1,0x97,0x81,0x11,0x6a,0x63,0xda,0x50,0x16,0x36,0x45,0x15,0x6b,0x43,0x99,0x58,0x62,0x31,0xb4,0x0c,0x65,0x40,0x89,0x47,0xb1,0x34,0x94,0x8e,0x29,0x16,0xc5,0xcc,0x98,0x33,0x9a,0x99,0x0d,0x05,0x00,0x80,0xff,0xc8,0x2b,0x2a,0x3c,0xcd,0x12,0x23,0x2f,0xba,0xca,0xf4,0xb0,0xa3,0xbc,0xa1,0xdc,0xc3,0xd3,0x8a,0x01,0x82,0x09,0x0f,0x40,0xf4,0xee,0xa7,0xae,0x51,0xd2,0xcd,0x25,0x9d,0xa6,0x46,0x2d,0x8f,0x90,0x7c,0x9a,0x9a,0xb4,0x2c,0x42,0xca,0x69,0x4a,0xd6,0xb6,0x0c,0xcb,0xa7,0x2b,0xd5,0xca,0xa3,0xec,0x9c,0xbe,0x54,0x6b,0xad,0x92,0x73,0xfa,0x52,0xad,0xb5,0x4a,0xf1,0x19,0x4b,0xb5,0x96,0x4e,0xc5,0x67,0x2e,0x4d,0x5b,0x26,0x55,0x9f,0x25,0x37,0x1d,0x59,0x57,0x75,0xd6,0x52,0xb4,0x65,0x42,0xf1,0x39,0x6b,0xd4,0x72,0x6f,0x3b,0xe7,0xaa,0x41,0x53,0xb3,0x2c,0x9f,0xab,0x1a,0x49,0x8d,0x8a,0x92,0xd6,0xac,0xdd,0x2c,0xc3,0x8a,0xe9,0xaa,0xac,0x31,0xf3,0x38,0x25,0xdd,0x25,0xcb,0x32,0xe2,0x38,0x60,0x79,0xb1,0x00,0xec,0xde,0xe6,0x80,0xbd,0xc7,0x1d,0xb0,0x7b,0x87,0x01,0x56,0x16,0x04,0x40,0x74,0x57,0x61,0x6e,0x66,0x1b,0xfe,0x41,0xba,0xbe,0xdd,0xdd,0x93,0x28,0x60,0x09,0x35,0x05,0x4c,0x69,0xa2,0x80,0xa5,0x8c,0x0d,0x30,0x85,0x8b,0x03,0x96,0x73,0x09,0xc0,0xb4,0xc2,0x27,0xa8,0x92,0x35,0xa3,0xad,0xac,0xa0,0x28,0x8c,0xb8,0x60,0x7c,0x82,0xa6,0xc8,0x7c,0x4b,0xd6,0x09,0x9a,0x24,0x8b,0x2b,0x59,0x2b,0x6a,0x8c,0x35,0x37,0xad,0xac,0xb4,0x7b,0xe4,0xe8,0x8a,0x32,0xb2,0x1e,0x50,0xbc,0x2b,0x8a,0x00,0xb8,0xd2,0x14,0x40,0x94,0xcc,0x0c,0xc8,0xdc,0x90,0x00,0xbe,0x2a,0xa7,0xde,0x16,0xd6,0x4c,0x6f,0x5c,0x46,0x55,0xa4,0x39,0x36,0x6c,0x19,0x65,0xb2,0x71,0xe9,0xc2,0x67,0x4c,0x56,0xbd,0x4c,0x67,0x9f,0xb9,0x05,0x65,0x8f,0x28,0x73,0xe6,0x62,0x59,0x3d,0xaa,0xf4,0x9a,0xb3,0x42,0xeb,0xa8,0xda,0x6d,0x76,0x52,0x6a,0x3c,0xcd,0xb4,0xd9,0x09,0xcd,0xb1,0x0a,0x2d,0x00,0x8e,0xa6,0x15,0xf0,0x25,0xa9,0x03,0x9e,0x55,0x3f,0xe3,0xd2,0xa2,0x5a,0x96,0xfa,0x8c,0xd9,0xaa,0x5b,0x79,0xa2,0x31,0x9b,0x14,0x51,0x29,0x96,0xc6,0xec,0xa3,0x56,0x15,0xd9,0x6e,0x73,0x28,0x34,0x99,0x1a,0x6a,0xcc,0x29,0x51,0x67,0xf2,0x90,0x36,0xa7,0x44,0x9d,0xc9,0x43,0xdb,0x1c,0x13,0xad,0xba,0x87,0x19,0x6b,0xce,0x38,0xee,0x16,0xaa,0xad,0xa9,0xe2,0x68,0x58,0xd0,0xb2,0x96,0x86,0x83,0xe5,0x54,0xc2,0x5c,0x2a,0x24,0x59,0xdb,0x21,0x00,0x88,0xb4,0x00,0x08,0xed,0x32,0xcc,0xcd,0x6d,0xc3,0xff,0x0c,0xe8,0x22,0x54,0x01,0x93,0x87,0x2a,0x60,0x0b,0x57,0x01,0x1c,0x1b,0x2e,0x80,0x2b,0x3c,0x46,0xf8,0x5c,0x5a,0xb8,0xc6,0x1e,0xd6,0x15,0x6e,0xa6,0x56,0xfb,0x44,0xc9,0x49,0x68,0xa7,0xa2,0x13,0xa5,0xc0,0x91,0xd9,0xac,0x4f,0x94,0x22,0x7b,0x66,0x33,0x49,0xb1,0xb3,0x5c,0xb2,0xe9,0xca,0xc5,0x34,0x7a,0x9b,0xa7,0x6a,0x00,0x05,0x04,0x6b,0xb1,0xca,0xe4,0x24,0x34,0x47,0xce,0xa9,0xb2,0x91,0x70,0x5b,0x3b,0xa7,0x4a,0x56,0xdc,0xfc,0xec,0x8c,0x3a,0x59,0x35,0x8f,0x29,0xab,0x00,0xc9,0xca,0x15,0xd0,0x80,0xbb,0x00,0x36,0x73,0x55,0xc0,0x96,0xe5,0x06,0xd8,0xb2,0xdc,0x01,0x81,0x97,0x9d,0xa6,0x78,0x4b,0xb7,0x8c,0x72,0x9a,0xec,0x3d,0x5d,0x2b,0xca,0xe9,0x52,0xcc,0x08,0xad,0xca,0xa7,0x4b,0xb9,0x22,0x34,0x2b,0xaf,0x3e,0xb6,0x68,0x89,0xb6,0x7a,0xfa,0x14,0x23,0x8b,0x33,0xca,0xea,0x63,0x2c,0x6b,0x77,0x2b,0xa7,0xcf,0xc1,0xb5,0x2c,0x43,0x9f,0xa1,0x78,0xf5,0xf2,0x32,0x72,0x86,0x12,0xc4,0x3c,0x2a,0xcc,0x1a,0xb2,0x31,0x4d,0x9d,0x30,0x6d,0xc9,0x3c,0x28,0x2b,0x46,0x19,0x20,0x82,0x4e,0x03,0x2c,0xc0,0x66,0x80,0x2f,0xc9,0x03,0x50,0x80,0xf5,0x19,0xaa,0x72,0xd3,0xb0,0xc4,0x6b,0xc8,0x81,0x22,0x3c,0x1b,0x8d,0x21,0x79,0x4a,0x4f,0x8f,0x35,0x86,0x9c,0x30,0x23,0xad,0xd6,0x18,0x4a,0xc1,0xf4,0xb0,0xca,0x6d,0xc8,0x19,0xcb,0xd3,0x2a,0x95,0x31,0x25,0x2c,0x77,0x8f,0x5c,0xc6,0x52,0x31,0xcd,0xad,0x52,0x19,0x6b,0x47,0x57,0x97,0x49,0x61,0x2c,0x8d,0x54,0x5d,0x63,0xb8,0xb1,0x24,0x52,0x73,0xb3,0xe1,0xe6,0x5a,0xd8,0xc9,0x24,0x91,0x1b,0x6a,0x70,0x65,0x51,0x3b,0x00,0x00,0xff,0x69,0x10,0x36,0xb2,0x5c,0x23,0xa6,0xc1,0xab,0x70,0x75,0x8b,0x93,0xfa,0xa0,0xcc,0x54,0xd5,0xcd,0x6a,0x5b,0x0e,0x55,0x15,0xdb,0x2b,0xef,0xb1,0x55,0x99,0xec,0x9c,0xac,0x5a,0x66,0x2b,0xaf,0x72,0xb2,0xac,0xd8,0x72,0x32,0xcc,0xca,0x92,0x10,0xef,0xf5,0x30,0x2b,0x2f,0x1a,0x3d,0xa6,0xcc,0x8c,0xb2,0x70,0xcc,0x9e,0x92,0xbc,0xea,0xca,0xc9,0xba,0x5b,0xca,0x6a,0x86,0x21,0xf6,0x1a,0xcb,0xab,0xde,0x26,0x48,0x34,0x62,0x07,0x60,0x72,0x23,0x03,0x6c,0xe5,0xe2,0x80,0xa5,0x5d,0x1c,0x30,0x5c,0x52,0x00,0x88,0x89,0x59,0x7d,0x92,0x94,0x3d,0x45,0x7b,0x74,0x81,0x79,0x5e,0x39,0xdd,0xd1,0x45,0xae,0xb1,0x93,0x74,0x56,0x9b,0x88,0xe6,0x74,0x49,0x3d,0x6d,0x61,0xac,0xb5,0x2d,0xfb,0x34,0x9d,0xb3,0xe4,0xae,0x95,0xd3,0x34,0xc5,0x9c,0xd3,0x76,0x4e,0xdd,0x03,0xb3,0x57,0x5b,0x39,0x45,0x4f,0xc2,0x99,0x61,0xf9,0x14,0x3d,0x92,0x45,0x85,0x9d,0x93,0xf7,0x40,0x96,0x99,0x76,0x4f,0xde,0x23,0x59,0x56,0xda,0x39,0x55,0x4f,0xac,0x9e,0x65,0xe5,0x34,0xdd,0xb1,0x44,0x76,0xa4,0xd3,0x8d,0x20,0x6c,0x59,0x95,0xce,0x30,0x02,0x93,0x57,0x55,0x3a,0x53,0xf7,0x24,0x9e,0x5d,0xe9,0xac,0xcd,0xa2,0x65,0x4d,0xe4,0xb3,0x35,0x8b,0x56,0xd5,0x91,0xcf,0x31,0x12,0x8a,0x77,0xd7,0x4a,0x7d,0x33,0x98,0x95,0x61,0x15,0x00,0xe0,0xff,0xae,0x75,0x45,0x13,0x86,0xdd,0xa4,0xd6,0xe7,0x70,0x72,0x1b,0x9f,0x9a,0xe0,0x32,0x98,0xa5,0xf2,0xa8,0x86,0x09,0x57,0x17,0xc5,0xa7,0x48,0x3e,0xc3,0x4d,0xa3,0x9c,0x32,0xc6,0x31,0x09,0x49,0x72,0xca,0x68,0x27,0xd5,0x64,0xd6,0x28,0x7d,0x9c,0x12,0xf1,0x4b,0xa3,0x74,0x79,0x53,0xc4,0x2e,0x95,0xd2,0x8c,0x49,0x94,0x1c,0x5d,0x0a,0xdd,0xce,0x48,0x72,0x54,0x29,0x55,0x5f,0x67,0xca,0xda,0xad,0xf4,0x66,0xc3,0x28,0xa2,0x96,0xaa,0xe0,0xcc,0x50,0x49,0x02,0xe0,0x80,0xca,0x52,0x1c,0x70,0x98,0x59,0x02,0x02,0x76,0x3b,0x7d,0xf7,0xaa,0xae,0x3e,0xfb,0xf4,0xdd,0xaa,0x58,0xf8,0xec,0xd3,0x77,0xa7,0x62,0xe1,0x53,0x4e,0xd7,0x83,0x88,0x79,0xcc,0x3e,0x7d,0x77,0xaa,0xea,0xb1,0x68,0x0d,0x23,0x91,0x8a,0xfa,0xaa,0x31,0x8c,0x80,0x46,0x96,0x8d,0xc3,0xd8,0x34,0xa4,0xe6,0x54,0x5c,0xcb,0x74,0xec,0x1a,0x2a,0xc7,0x01,0xd3,0x10,0x05,0x60,0x4e,0xa7,0x00,0xcc,0x99,0x1a,0x80,0x35,0x3a,0x02,0x30,0x47,0x6a,0x00,0x66,0x4b,0x75,0xc0,0x1c,0xc6,0x0e,0x18,0x51,0x58,0x00,0x23,0x8b,0x00,0xc0,0xff,0xa9,0x65,0xd3,0xc3,0xc2,0x22,0xbb,0x96,0x3e,0x53,0x8d,0xb0,0x12,0x6a,0x7e,0x59,0x2d,0xd2,0x4a,0xaa,0xd8,0x34,0x33,0x4d,0xdb,0xad,0x10,0xcd,0x43,0xcd,0xed,0x8e,0xdc,0x74,0xa3,0x9a,0x8c,0x3d,0x32,0x5b,0xc5,0xab,0x22,0xec,0x8a,0xbd,0xf1,0xce,0xf0,0x32,0x27,0x0e,0x5a,0xb3,0x22,0xca,0x9e,0x38,0x29,0xee,0x69,0xb7,0x73,0x82,0x9e,0x48,0xbc,0x3b,0xf6,0x09,0x7a,0x44,0xc9,0x9a,0xd8,0x27,0x6a,0x8e,0x34,0xa7,0x63,0x9f,0xa4,0x79,0x94,0xaa,0x89,0x73,0xf2,0x16,0x50,0xaa,0xa6,0x4a,0x2b,0xb2,0x41,0xcb,0xa8,0xaa,0xa5,0x0d,0x5a,0xb5,0xd2,0xaa,0xa4,0x21,0x0a,0xd1,0x6e,0x2d,0xd3,0x86,0xa1,0x55,0xc4,0x2c,0xb6,0x00,0x02,0x13,0x15,0x40,0x15,0x26,0x02,0xe8,0xc6,0xb5,0x54,0xc3,0xb6,0xb9,0x7b,0xdc,0x56,0x65,0x6e,0x11,0xe9,0x51,0x56,0xef,0x43,0x97,0x9a,0x26,0x6e,0x83,0x8b,0xd3,0x2c,0xd6,0xba,0x0c,0xb6,0x6c,0x91,0x78,0x9b,0x32,0x9a,0x3a,0x45,0xea,0x69,0xda,0xe8,0x73,0x8e,0xb0,0xb6,0x6e,0x63,0xc8,0xbe,0x24,0xda,0x78,0x8c,0x61,0xba,0x9b,0x78,0xa3,0x31,0xc5,0xee,0x9e,0xaa,0x0d,0xc7,0x14,0xbb,0x85,0x9b,0x54,0x1a,0x4b,0x8a,0x12,0xe9,0x94,0x6a,0x2c,0xd1,0x8a,0x46,0x88,0xe7,0xb6,0x44,0xc7,0xe6,0xc1,0xa9,0xca,0xec,0x2d,0x65,0xba,0x36,0x2e,0x4b,0x32,0x18,0x11,0x56,0xbb,0x2c,0xd9,0xa2,0x45,0x59,0xcd,0x50,0x07,0x45,0xd5,0xa5,0x0d,0xcc,0x62,0xb4,0x65,0x8c,0x1e,0x54,0x4b,0x94,0xe2,0x3e,0x3a,0x1a,0x00,0xe0,0xff]);
const PL_LPC_PHONEMES = Int32Array.from([192,80,-18368,11584,52,29,23,14,-17,79,37,4,192,80,-14528,1536,38,29,11,14,-41,79,57,4,192,80,14528,9216,25,-54,-70,36,19,79,57,22,192,80,-14528,-13440,38,57,57,14,-53,7,37,77,192,80,-26368,4160,11,15,-1,36,-41,31,77,22,15,0,5184,9216,-29,-12,0,0,0,0,0,0,10,0,27968,17856,25,43,-24,-20,-53,55,-4,-51,128,160,14528,-3712,-43,-26,-24,-20,-53,55,-4,-51,128,160,10048,11584,-16,15,0,0,0,0,0,0,224,100,18368,-13440,-97,-26,-12,-53,-41,7,57,32,192,80,-10048,9216,-70,15,34,-20,-17,31,-24,22,96,160,-18368,17856,-29,-12,-35,3,-5,7,37,22,64,80,-21632,-6272,-83,29,57,3,-5,7,16,32,192,80,0,-1088,11,-26,-24,-9,-5,55,37,22,64,80,21632,-17536,-97,85,57,-20,-17,31,-4,59]);
`,`
const PL_MAX_BLOCK = 24;
const PL_MAX_FREQUENCY = 0.25;
let PL_SAMPLE_RATE = 48000;
let PL_A0 = 55 / 47872.34;
function plSetSampleRate(sr, a0) { PL_SAMPLE_RATE = sr; PL_A0 = a0 === undefined ? 55 / sr : a0; }

function plConstrain(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

function plSemitonesToRatio(semitones) {
  const pitch = semitones + 128;
  const i = pitch | 0, f = pitch - i;
  return PL_PITCH_RATIO_HIGH[i] * PL_PITCH_RATIO_LOW[(f * 256) | 0];
}

function plSemitonesToRatioSafe(semitones) {
  let scale = 1;
  while (semitones > 120) { semitones -= 120; scale *= 1024; }
  while (semitones < -120) { semitones += 120; scale *= 1 / 1024; }
  return scale * plSemitonesToRatio(semitones);
}

function plNoteToFrequency(note) {
  note = plConstrain(note - 9, -128, 127);
  return PL_A0 * 0.25 * plSemitonesToRatio(note);
}

function plInterpolate(table, index, size) {
  index *= size;
  const i = index | 0, f = index - i;
  const a = table[i], b = table[i + 1];
  return a + (b - a) * f;
}

function plInterpolateHermite(table, index, size) {
  index *= size;
  const i = index | 0, f = index - i;
  const xm1 = table[i - 1], x0 = table[i], x1 = table[i + 1], x2 = table[i + 2];
  const c = (x1 - xm1) * 0.5, v = x0 - x1, w = c + v, a = w + v + (x2 - x0) * 0.5, bNeg = w + a;
  return (((a * f) - bNeg) * f + c) * f + x0;
}

function plInterpolateWrap(table, index, size) {
  index -= index | 0;
  index *= size;
  const i = index | 0, f = index - i;
  const a = table[i], b = table[i + 1];
  return a + (b - a) * f;
}

function plSmoothStep(x) { return x * x * (3 - 2 * x); }
function plSoftLimit(x) { return x * (27 + x * x) / (27 + 9 * x * x); }
function plSoftClip(x) { return x < -3 ? -1 : x > 3 ? 1 : plSoftLimit(x); }

// polyBLEP and its integral (stmlib/dsp/polyblep.h)
function plThisBlepSample(t) { return 0.5 * t * t; }
function plNextBlepSample(t) { t = 1 - t; return -0.5 * t * t; }
function plNextIntegratedBlepSample(t) {
  const t1 = 0.5 * t, t2 = t1 * t1, t4 = t2 * t2;
  return 0.1875 - t1 + 1.5 * t2 - t4;
}
function plThisIntegratedBlepSample(t) { return plNextIntegratedBlepSample(1 - t); }

// stmlib/dsp/limiter.h: what Plaits puts on an engine's output when its gain is negative
class PlLimiter {
  constructor() { this.peak = 0.5; }
  process(preGain, buf, size) {
    let peak = this.peak;
    for (let i = 0; i < size; i++) {
      const s = buf[i] * preGain, a = s < 0 ? -s : s, e = a - peak;
      peak += (e > 0 ? 0.05 : 0.00002) * e;
      buf[i] = s * (peak <= 1 ? 1 : 1 / peak) * 0.8;
    }
    this.peak = peak;
  }
}

// Engine parameters, as Plaits passes them each block.
const PL_TRIGGER_LOW = 0, PL_TRIGGER_RISING_EDGE = 1, PL_TRIGGER_UNPATCHED = 2, PL_TRIGGER_HIGH = 4;

class PlVariableShapeOscillator {
  constructor() { this.init(); }

  init() {
    this.masterPhase = 0; this.slavePhase = 0; this.nextSample = 0; this.previousPw = 0.5; this.high = false;
    this.masterFrequency = 0; this.slaveFrequency = 0.01; this.pw = 0.5; this.waveshape = 0; this.phaseModulation = 0;
  }

  setMasterPhase(p) { this.masterPhase = p; }

  render(frequency, pw, waveshape, out, size) { this.renderFull(false, false, 0, frequency, pw, waveshape, 0, out, size); }

  renderSync(masterFrequency, frequency, pw, waveshape, out, size) {
    this.renderFull(true, false, masterFrequency, frequency, pw, waveshape, 0, out, size);
  }

  renderFull(enableSync, outputPhase, masterFrequency, frequency, pw, waveshape, phaseModulationAmount, out, size) {
    if (masterFrequency >= PL_MAX_FREQUENCY) masterFrequency = PL_MAX_FREQUENCY;
    if (frequency >= PL_MAX_FREQUENCY) frequency = PL_MAX_FREQUENCY;
    if (frequency >= 0.25) pw = 0.5;
    else pw = plConstrain(pw, frequency * 2, 1 - 2 * frequency);

    let mf = this.masterFrequency; const dmf = (masterFrequency - mf) / size;
    let sf = this.slaveFrequency; const dsf = (frequency - sf) / size;
    let pwv = this.pw; const dpw = (pw - pwv) / size;
    let ws = this.waveshape; const dws = (waveshape - ws) / size;
    let pm = this.phaseModulation; const dpm = (phaseModulationAmount - pm) / size;

    let nextSample = this.nextSample;
    for (let n = 0; n < size; n++) {
      let reset = false, transitionDuringReset = false, resetTime = 0;
      let thisSample = nextSample;
      nextSample = 0;
      mf += dmf; sf += dsf; pwv += dpw; ws += dws; pm += dpm;
      const masterF = mf, slaveF = sf, p = pwv;
      const squareAmount = Math.max(ws - 0.5, 0) * 2;
      const triangleAmount = Math.max(1 - ws * 2, 0);
      const slopeUp = 1 / p, slopeDown = 1 / (1 - p);

      if (enableSync) {
        this.masterPhase += masterF;
        if (this.masterPhase >= 1) {
          this.masterPhase -= 1;
          resetTime = this.masterPhase / masterF;
          let slavePhaseAtReset = this.slavePhase + (1 - resetTime) * slaveF;
          reset = true;
          if (slavePhaseAtReset >= 1) { slavePhaseAtReset -= 1; transitionDuringReset = true; }
          if (!this.high && slavePhaseAtReset >= p) transitionDuringReset = true;
          const value = this.naive(slavePhaseAtReset, p, slopeUp, slopeDown, triangleAmount, squareAmount);
          thisSample -= value * plThisBlepSample(resetTime);
          nextSample -= value * plNextBlepSample(resetTime);
        }
      } else if (outputPhase) {
        this.masterPhase += masterF;
        if (this.masterPhase >= 1) this.masterPhase -= 1;
      }

      this.slavePhase += slaveF;
      while (transitionDuringReset || !reset) {
        if (!this.high) {
          if (this.slavePhase < p) break;
          const t = (this.slavePhase - p) / (this.previousPw - p + slaveF);
          const triangleStep = (slopeUp + slopeDown) * slaveF * triangleAmount;
          thisSample += squareAmount * plThisBlepSample(t);
          nextSample += squareAmount * plNextBlepSample(t);
          thisSample -= triangleStep * plThisIntegratedBlepSample(t);
          nextSample -= triangleStep * plNextIntegratedBlepSample(t);
          this.high = true;
        }
        if (this.high) {
          if (this.slavePhase < 1) break;
          this.slavePhase -= 1;
          const t = this.slavePhase / slaveF;
          const triangleStep = (slopeUp + slopeDown) * slaveF * triangleAmount;
          thisSample -= (1 - triangleAmount) * plThisBlepSample(t);
          nextSample -= (1 - triangleAmount) * plNextBlepSample(t);
          thisSample += triangleStep * plThisIntegratedBlepSample(t);
          nextSample += triangleStep * plNextIntegratedBlepSample(t);
          this.high = false;
        }
      }
      if (enableSync && reset) { this.slavePhase = resetTime * slaveF; this.high = false; }

      nextSample += this.naive(this.slavePhase, p, slopeUp, slopeDown, triangleAmount, squareAmount);
      this.previousPw = p;

      if (outputPhase) {
        let phasor = this.masterPhase;
        if (enableSync) {
          const w = 4 * (1 - this.masterPhase) * this.masterPhase;
          thisSample *= w * (2 - w);
          const p2 = phasor * phasor;
          phasor += (p2 * p2 - phasor) * Math.abs(p - 0.5) * 2;
        }
        out[n] = phasor + pm * thisSample;
      } else {
        out[n] = 2 * thisSample - 1;
      }
    }
    this.nextSample = nextSample;
    this.masterFrequency = mf; this.slaveFrequency = sf; this.pw = pwv; this.waveshape = ws; this.phaseModulation = pm;
  }

  naive(phase, pw, slopeUp, slopeDown, triangleAmount, squareAmount) {
    let saw = phase;
    const square = phase < pw ? 0 : 1;
    const triangle = phase < pw ? phase * slopeUp : 1 - (phase - pw) * slopeDown;
    saw += (square - saw) * squareAmount;
    saw += (triangle - saw) * triangleAmount;
    return saw;
  }
}

const PL_VARIABLE_SAW_NOTCH_DEPTH = 0.2;

class PlVariableSawOscillator {
  constructor() { this.init(); }

  init() {
    this.phase = 0; this.nextSample = 0; this.previousPw = 0.5; this.high = false;
    this.frequency = 0.01; this.pw = 0.5; this.waveshape = 0;
  }

  render(frequency, pw, waveshape, out, size) {
    if (frequency >= PL_MAX_FREQUENCY) frequency = PL_MAX_FREQUENCY;
    if (frequency >= 0.25) pw = 0.5;
    else pw = plConstrain(pw, frequency * 2, 1 - 2 * frequency);

    let fv = this.frequency; const df = (frequency - fv) / size;
    let pwv = this.pw; const dpw = (pw - pwv) / size;
    let ws = this.waveshape; const dws = (waveshape - ws) / size;
    let nextSample = this.nextSample;
    const depth = PL_VARIABLE_SAW_NOTCH_DEPTH;
    for (let n = 0; n < size; n++) {
      let thisSample = nextSample;
      nextSample = 0;
      fv += df; pwv += dpw; ws += dws;
      const f = fv, p = pwv, triangleAmount = ws, notchAmount = 1 - ws;
      const slopeUp = 1 / p, slopeDown = 1 / (1 - p);
      this.phase += f;
      if (!this.high && this.phase >= p) {
        const triangleStep = (slopeUp + slopeDown) * f * triangleAmount;
        const notch = (depth + 1 - p) * notchAmount;
        const t = (this.phase - p) / (this.previousPw - p + f);
        thisSample += notch * plThisBlepSample(t);
        nextSample += notch * plNextBlepSample(t);
        thisSample -= triangleStep * plThisIntegratedBlepSample(t);
        nextSample -= triangleStep * plNextIntegratedBlepSample(t);
        this.high = true;
      } else if (this.phase >= 1) {
        this.phase -= 1;
        const triangleStep = (slopeUp + slopeDown) * f * triangleAmount;
        const notch = (depth + 1) * notchAmount;
        const t = this.phase / f;
        thisSample -= notch * plThisBlepSample(t);
        nextSample -= notch * plNextBlepSample(t);
        thisSample += triangleStep * plThisIntegratedBlepSample(t);
        nextSample += triangleStep * plNextIntegratedBlepSample(t);
        this.high = false;
      }
      const notchSaw = this.phase < p ? this.phase : 1 + depth;
      const triangle = this.phase < p ? this.phase * slopeUp : 1 - (this.phase - p) * slopeDown;
      nextSample += notchSaw * notchAmount + triangle * triangleAmount;
      this.previousPw = p;
      out[n] = (2 * thisSample - 1) / (1 + depth);
    }
    this.nextSample = nextSample;
    this.frequency = fv; this.pw = pwv; this.waveshape = ws;
  }
}

// ---- plaits/dsp/oscillator/oscillator.h: the band-limited basic shapes (the shape is a value here, not a template)
const PL_SHAPE_IMPULSE_TRAIN = 0, PL_SHAPE_SAW = 1, PL_SHAPE_TRIANGLE = 2, PL_SHAPE_SLOPE = 3, PL_SHAPE_SQUARE = 4;
const PL_SHAPE_SQUARE_BRIGHT = 5, PL_SHAPE_SQUARE_DARK = 6, PL_SHAPE_SQUARE_TRIANGLE = 7;
const PL_MIN_FREQUENCY = 0.000001;

class PlOscillator {
  constructor() { this.init(); }

  init() {
    this.phase = 0.5; this.nextSample = 0; this.lpState = 1; this.hpState = 0; this.high = true;
    this.frequency = 0.001; this.pw = 0.5;
  }

  // external FM (\`fm\`, a buffer) runs through zero, as in the original's Render(frequency, pw, fm, out, size)
  render(shape, frequency, pw, out, size, fm) {
    const ext = !!fm, tz = ext;
    if (!ext) {
      frequency = plConstrain(frequency, PL_MIN_FREQUENCY, PL_MAX_FREQUENCY);
      pw = plConstrain(pw, Math.abs(frequency) * 2, 1 - 2 * Math.abs(frequency));
    }
    let fv = this.frequency; const df = (frequency - fv) / size;
    let pv = this.pw; const dp = (pw - pv) / size;
    let nextSample = this.nextSample;
    for (let n = 0; n < size; n++) {
      let thisSample = nextSample;
      nextSample = 0;
      fv += df; pv += dp;
      let f = fv;
      if (ext) f = plConstrain(f * (1 + fm[n]), -PL_MAX_FREQUENCY, PL_MAX_FREQUENCY);
      let p = shape === PL_SHAPE_SQUARE_TRIANGLE || shape === PL_SHAPE_TRIANGLE ? 0.5 : pv;
      if (ext) p = plConstrain(p, Math.abs(f) * 2, 1 - 2 * Math.abs(f));
      this.phase += f;

      if (shape <= PL_SHAPE_SAW) {
        if (this.phase >= 1) {
          this.phase -= 1;
          const t = this.phase / f;
          thisSample -= plThisBlepSample(t); nextSample -= plNextBlepSample(t);
        } else if (tz && this.phase < 0) {
          const t = this.phase / f;
          this.phase += 1;
          thisSample += plThisBlepSample(t); nextSample += plNextBlepSample(t);
        }
        nextSample += this.phase;
        if (shape === PL_SHAPE_SAW) out[n] = 2 * thisSample - 1;
        else {
          this.lpState += 0.25 * ((this.hpState - thisSample) - this.lpState);
          out[n] = 4 * this.lpState;
          this.hpState = thisSample;
        }
      } else if (shape <= PL_SHAPE_SLOPE) {
        let up = 2, down = 2;
        if (shape === PL_SHAPE_SLOPE) { up = 1 / p; down = 1 / (1 - p); }
        if (this.high !== (this.phase < p)) {
          const t = (this.phase - p) / f;
          let d = (up + down) * f;
          if (tz && f < 0) d = -d;
          thisSample -= plThisIntegratedBlepSample(t) * d; nextSample -= plNextIntegratedBlepSample(t) * d;
          this.high = this.phase < p;
        }
        if (this.phase >= 1) {
          this.phase -= 1;
          const t = this.phase / f, d = (up + down) * f;
          thisSample += plThisIntegratedBlepSample(t) * d; nextSample += plNextIntegratedBlepSample(t) * d;
          this.high = true;
        } else if (tz && this.phase < 0) {
          const t = this.phase / f;
          this.phase += 1;
          const d = (up + down) * f;
          thisSample -= plThisIntegratedBlepSample(t) * d; nextSample -= plNextIntegratedBlepSample(t) * d;
          this.high = false;
        }
        nextSample += this.high ? this.phase * up : 1 - (this.phase - p) * down;
        out[n] = 2 * thisSample - 1;
      } else {
        if (this.high !== (this.phase >= p)) {
          const t = (this.phase - p) / f;
          const d = tz && f < 0 ? -1 : 1;
          thisSample += plThisBlepSample(t) * d; nextSample += plNextBlepSample(t) * d;
          this.high = this.phase >= p;
        }
        if (this.phase >= 1) {
          this.phase -= 1;
          const t = this.phase / f;
          thisSample -= plThisBlepSample(t); nextSample -= plNextBlepSample(t);
          this.high = false;
        } else if (tz && this.phase < 0) {
          const t = this.phase / f;
          this.phase += 1;
          thisSample += plThisBlepSample(t); nextSample += plNextBlepSample(t);
          this.high = true;
        }
        nextSample += this.phase < p ? 0 : 1;
        if (shape === PL_SHAPE_SQUARE_TRIANGLE) {
          thisSample = 128 * (thisSample - 0.5);
          this.lpState += f * 0.0625 * (thisSample - this.lpState);
          out[n] = this.lpState;
        } else if (shape === PL_SHAPE_SQUARE_DARK) {
          thisSample = 4 * (thisSample - 0.5);
          this.lpState += f * 2 * (thisSample - this.lpState);
          out[n] = this.lpState;
        } else if (shape === PL_SHAPE_SQUARE_BRIGHT) {
          thisSample = 2 * thisSample - 1;
          this.lpState += f * 2 * (thisSample - this.lpState);
          out[n] = (thisSample - this.lpState) * 0.5;
        } else {
          out[n] = 2 * thisSample - 1;
        }
      }
    }
    this.nextSample = nextSample;
    this.frequency = fv; this.pw = pv;
  }
}

// ---- plaits/dsp/oscillator/sine_oscillator.h
const PL_SINE_LUT_SIZE = 512, PL_SINE_LUT_BITS = 9;
function plSine(phase) { return plInterpolateWrap(PL_SINE, phase, PL_SINE_LUT_SIZE); }
function plSineNoWrap(phase) { return plInterpolate(PL_SINE, phase, PL_SINE_LUT_SIZE); }
// phase: a uint32; pm: phase modulation of up to an index of 32 either way
function plSinePM(phase, pm) {
  phase = (phase + (Math.imul(((pm + 32) * 67108864) >>> 0, 64) >>> 0)) >>> 0;
  const integral = phase >>> 23;
  const fractional = ((phase << 9) >>> 0) / 4294967296;
  const a = PL_SINE[integral], b = PL_SINE[integral + 1];
  return a + (b - a) * fractional;
}
function plSineRaw(phase) { return PL_SINE[phase >>> 23]; }

class PlSineOscillator {
  constructor() { this.init(); }
  init() { this.phase = 0; this.frequency = 0; this.amplitude = 0; }
  next(frequency) {
    if (frequency >= 0.5) frequency = 0.5;
    this.phase += frequency;
    if (this.phase >= 1) this.phase -= 1;
    return plSineNoWrap(this.phase);
  }
  // returns [sin, cos] scaled by amplitude
  nextQuadrature(frequency, amplitude, outPair) {
    if (frequency >= 0.5) frequency = 0.5;
    this.phase += frequency;
    if (this.phase >= 1) this.phase -= 1;
    outPair[0] = amplitude * plSineNoWrap(this.phase);
    outPair[1] = amplitude * plSineNoWrap(this.phase + 0.25);
  }
  // with an amplitude, adds into out (as the original's Render(frequency, amplitude, out, size)); without, writes
  render(frequency, out, size, amplitude) {
    const additive = amplitude !== undefined;
    if (frequency >= 0.5) frequency = 0.5;
    let fv = this.frequency; const df = (frequency - fv) / size;
    let av = this.amplitude; const da = additive ? (amplitude - av) / size : 0;
    for (let n = 0; n < size; n++) {
      fv += df;
      this.phase += fv;
      if (this.phase >= 1) this.phase -= 1;
      const s = plSineNoWrap(this.phase);
      if (additive) { av += da; out[n] += av * s; } else out[n] = s;
    }
    this.frequency = fv;
    if (additive) this.amplitude = av;
  }
}

const PL_FAST_NORMAL = 0, PL_FAST_ADDITIVE = 1, PL_FAST_QUADRATURE = 2;
class PlFastSineOscillator {
  constructor() { this.init(); }
  init() { this.x = 1; this.y = 0; this.epsilon = 0; this.amplitude = 0; }
  static fast2Sin(f) { const fp = f * Math.PI; return fp * (2 - (2 * 0.96 / 6) * fp * fp); }
  render(frequency, out, size) { this.renderInternal(PL_FAST_NORMAL, frequency, 1, out, null, size); }
  renderAdd(frequency, amplitude, out, size) { this.renderInternal(PL_FAST_ADDITIVE, frequency, amplitude, out, null, size); }
  renderQuadrature(frequency, amplitude, x, y, size) { this.renderInternal(PL_FAST_QUADRATURE, frequency, amplitude, x, y, size); }
  renderInternal(mode, frequency, amplitude, out, out2, size) {
    if (frequency >= 0.25) { frequency = 0.25; amplitude = 0; } else amplitude *= 1 - frequency * 4;
    let ev = this.epsilon; const de = (PlFastSineOscillator.fast2Sin(frequency) - ev) / size;
    let av = this.amplitude; const da = (amplitude - av) / size;
    let x = this.x, y = this.y;
    const norm = x * x + y * y;
    if (norm <= 0.5 || norm >= 2) { const scale = 1 / Math.sqrt(norm); x *= scale; y *= scale; }
    for (let n = 0; n < size; n++) {
      ev += de;
      x += ev * y;
      y -= ev * x;
      if (mode === PL_FAST_ADDITIVE) { av += da; out[n] += av * x; }
      else if (mode === PL_FAST_NORMAL) out[n] = x;
      else { av += da; out[n] = x * av; out2[n] = y * av; }
    }
    this.x = x; this.y = y; this.epsilon = ev;
    if (mode !== PL_FAST_NORMAL) this.amplitude = av;
  }
}

// ---- plaits/dsp/downsampler/4x_downsampler.h: a downsampler keeps one float of state between blocks
const PL_OVERSAMPLING = 4;

// ---- stmlib/dsp/filter.h: the tangent approximations, and the one-pole filter
const PL_FREQ_EXACT = 0, PL_FREQ_ACCURATE = 1, PL_FREQ_FAST = 2, PL_FREQ_DIRTY = 3;
const PL_PI3 = Math.PI ** 3, PL_PI5 = Math.PI ** 5, PL_PI7 = Math.PI ** 7, PL_PI9 = Math.PI ** 9, PL_PI11 = Math.PI ** 11;
function plTan(approximation, f) {
  if (approximation === PL_FREQ_EXACT) return Math.tan(Math.PI * (f < 0.497 ? f : 0.497));
  if (approximation === PL_FREQ_DIRTY) return f * (Math.PI + 3.736e-01 * PL_PI3 * f * f);
  const f2 = f * f;
  if (approximation === PL_FREQ_FAST) return f * (Math.PI + f2 * (3.260e-01 * PL_PI3 + 1.823e-01 * PL_PI5 * f2));
  return f * (Math.PI + f2 * (3.333314036e-01 * PL_PI3 + f2 * (1.333923995e-01 * PL_PI5
    + f2 * (5.33740603e-02 * PL_PI7 + f2 * (2.900525e-03 * PL_PI9 + f2 * 9.5168091e-03 * PL_PI11)))));
}
const PL_LOW_PASS = 0, PL_BAND_PASS = 1, PL_BAND_PASS_NORMALIZED = 2, PL_HIGH_PASS = 3;

class PlOnePole {
  constructor() { this.setF(PL_FREQ_DIRTY, 0.01); this.state = 0; }
  reset() { this.state = 0; }
  setF(approximation, f) { this.g = plTan(approximation, f); this.gi = 1 / (1 + this.g); }
  process(mode, x) {
    const lp = (this.g * x + this.state) * this.gi;
    this.state = this.g * (x - lp) + lp;
    return mode === PL_LOW_PASS ? lp : mode === PL_HIGH_PASS ? x - lp : 0;
  }
  processBuffer(mode, buf, size) { for (let i = 0; i < size; i++) buf[i] = this.process(mode, buf[i]); }
}

// ---- plaits/dsp/oscillator/grainlet_oscillator.h: grains of a formant, one per period of the carrier
class PlGrainletOscillator {
  constructor() { this.init(); }
  init() {
    this.carrierPhase = 0; this.formantPhase = 0; this.nextSample = 0;
    this.carrierFrequency = 0; this.formantFrequency = 0; this.carrierShape = 0; this.carrierBleed = 0;
  }
  render(carrierFrequency, formantFrequency, carrierShape, carrierBleed, out, size) {
    if (carrierFrequency >= PL_MAX_FREQUENCY * 0.5) carrierFrequency = PL_MAX_FREQUENCY * 0.5;
    if (formantFrequency >= PL_MAX_FREQUENCY) formantFrequency = PL_MAX_FREQUENCY;
    let cf = this.carrierFrequency; const dcf = (carrierFrequency - cf) / size;
    let ff = this.formantFrequency; const dff = (formantFrequency - ff) / size;
    let cs = this.carrierShape; const dcs = (carrierShape - cs) / size;
    let cb = this.carrierBleed; const dcb = (carrierBleed - cb) / size;
    let nextSample = this.nextSample;
    for (let n = 0; n < size; n++) {
      let thisSample = nextSample;
      nextSample = 0;
      cf += dcf; ff += dff;
      const f0 = cf, f1 = ff;
      this.carrierPhase += f0;
      if (this.carrierPhase >= 1) {
        this.carrierPhase -= 1;
        const resetTime = this.carrierPhase / f0;
        const before = this.grainlet(1, this.formantPhase + (1 - resetTime) * f1, cs + dcs * (1 - resetTime), cb + dcb * (1 - resetTime));
        const after = this.grainlet(0, 0, cs + dcs, cb + dcb);
        const d = after - before;
        thisSample += d * plThisBlepSample(resetTime);
        nextSample += d * plNextBlepSample(resetTime);
        this.formantPhase = resetTime * f1;
      } else {
        this.formantPhase += f1;
        if (this.formantPhase >= 1) this.formantPhase -= 1;
      }
      cs += dcs; cb += dcb;
      nextSample += this.grainlet(this.carrierPhase, this.formantPhase, cs, cb);
      out[n] = thisSample;
    }
    this.nextSample = nextSample;
    this.carrierFrequency = cf; this.formantFrequency = ff; this.carrierShape = cs; this.carrierBleed = cb;
  }
  carrier(phase, shape) {
    shape *= 3;
    const si = shape | 0;
    let t = 1 - (shape - si);
    if (si === 0) {
      phase = phase * (1 + t * t * t * 15);
      if (phase >= 1) phase = 1;
      phase += 0.75;
    } else if (si === 1) {
      const bp = 0.001 + 0.499 * t * t * t;
      phase = phase < bp ? phase * (0.5 / bp) : 0.5 + (phase - bp) * 0.5 / (1 - bp);
      phase += 0.75;
    } else {
      t = 1 - t;
      phase = 0.25 + phase * (0.5 + t * t * t * 14.5);
      if (phase >= 0.75) phase = 0.75;
    }
    return (plSine(phase) + 1) * 0.25;
  }
  grainlet(carrierPhase, formantPhase, shape, bleed) {
    return this.carrier(carrierPhase, shape) * (plSine(formantPhase) + bleed) / (1 + bleed);
  }
}

// ---- plaits/dsp/oscillator/z_oscillator.h: a formant reset, Casio CZ style, by a carrier at twice the rate
class PlZOscillator {
  constructor() { this.init(); }
  init() {
    this.carrierPhase = 0; this.discontinuityPhase = 0; this.formantPhase = 0; this.nextSample = 0;
    this.carrierFrequency = 0; this.formantFrequency = 0; this.carrierShape = 0; this.mode = 0;
  }
  render(carrierFrequency, formantFrequency, carrierShape, mode, out, size) {
    if (carrierFrequency >= PL_MAX_FREQUENCY * 0.5) carrierFrequency = PL_MAX_FREQUENCY * 0.5;
    if (formantFrequency >= PL_MAX_FREQUENCY) formantFrequency = PL_MAX_FREQUENCY;
    let cf = this.carrierFrequency; const dcf = (carrierFrequency - cf) / size;
    let ff = this.formantFrequency; const dff = (formantFrequency - ff) / size;
    let cs = this.carrierShape; const dcs = (carrierShape - cs) / size;
    let md = this.mode; const dmd = (mode - md) / size;
    let nextSample = this.nextSample;
    for (let n = 0; n < size; n++) {
      let thisSample = nextSample;
      nextSample = 0;
      cf += dcf; ff += dff;
      const f0 = cf, f1 = ff;
      this.discontinuityPhase += 2 * f0;
      this.carrierPhase += f0;
      if (this.discontinuityPhase >= 1) {
        this.discontinuityPhase -= 1;
        const resetTime = this.discontinuityPhase / (2 * f0);
        const cBefore = this.carrierPhase >= 1 ? 1 : 0.5, cAfter = this.carrierPhase >= 1 ? 0 : 0.5;
        const before = this.z(cBefore, 1, this.formantPhase + (1 - resetTime) * f1, cs + dcs * (1 - resetTime), md + dmd * (1 - resetTime));
        const after = this.z(cAfter, 0, 0, cs + dcs, md + dmd);
        const d = after - before;
        thisSample += d * plThisBlepSample(resetTime);
        nextSample += d * plNextBlepSample(resetTime);
        this.formantPhase = resetTime * f1;
        if (this.carrierPhase > 1) this.carrierPhase = this.discontinuityPhase * 0.5;
      } else {
        this.formantPhase += f1;
        if (this.formantPhase >= 1) this.formantPhase -= 1;
      }
      if (this.carrierPhase >= 1) this.carrierPhase -= 1;
      cs += dcs; md += dmd;
      nextSample += this.z(this.carrierPhase, this.discontinuityPhase, this.formantPhase, cs, md);
      out[n] = thisSample;
    }
    this.nextSample = nextSample;
    this.carrierFrequency = cf; this.formantFrequency = ff; this.carrierShape = cs; this.mode = md;
  }
  z(c, d, f, shape, mode) {
    let rampDown = 0.5 * (1 + plSine(0.5 * d + 0.25));
    let offset, phaseShift;
    if (mode < 0.333) { offset = 1; phaseShift = 0.25 + mode * 1.5; }
    else if (mode < 0.666) { phaseShift = 0.7495 - (mode - 0.33) * 0.75; offset = -plSine(phaseShift); }
    else { phaseShift = 0.7495 - (mode - 0.33) * 0.75; offset = 0.001; }
    const discontinuity = plSine(f + phaseShift);
    let contour;
    if (shape < 0.5) {
      shape *= 2;
      if (c >= 0.5) rampDown *= shape;
      contour = 1 + (plSine(c + 0.25) - 1) * shape;
    } else {
      contour = plSine(c + shape * 0.5);
    }
    return (rampDown * (offset + discontinuity) - offset) * contour;
  }
}

// ---- plaits/dsp/oscillator/harmonic_oscillator.h: a batch of harmonics by the Chebyshev recurrence
class PlHarmonicOscillator {
  constructor(numHarmonics) {
    this.n = numHarmonics;
    this.phase = 0; this.frequency = 0;
    this.amplitude = new Float64Array(numHarmonics);
    this.increment = new Float64Array(numHarmonics);
  }
  // the first batch (firstHarmonic 1) writes out; later batches add to it. \`amps\` is read from \`offset\`.
  render(firstHarmonic, frequency, amps, offset, out, size) {
    if (frequency >= 0.5) frequency = 0.5;
    const n = this.n, amp = this.amplitude, inc = this.increment;
    for (let i = 0; i < n; i++) {
      let f = frequency * (firstHarmonic + i);
      if (f >= 0.5) f = 0.5;
      inc[i] = (amps[offset + i] * (1 - f * 2) - amp[i]) / size;
    }
    let fv = this.frequency; const df = (frequency - fv) / size;
    for (let s = 0; s < size; s++) {
      fv += df;
      this.phase += fv;
      if (this.phase >= 1) this.phase -= 1;
      const twoX = 2 * plSineNoWrap(this.phase);
      let previous, current;
      if (firstHarmonic === 1) { previous = 1; current = twoX * 0.5; }
      else { previous = plSine(this.phase * (firstHarmonic - 1) + 0.25); current = plSine(this.phase * firstHarmonic); }
      let sum = 0;
      for (let i = 0; i < n; i++) {
        amp[i] += inc[i];
        sum += amp[i] * current;
        const temp = current;
        current = twoX * current - previous;
        previous = temp;
      }
      if (firstHarmonic === 1) out[s] = sum; else out[s] += sum;
    }
    this.frequency = fv;
  }
}

// ---- stmlib/dsp/hysteresis_quantizer.h (HysteresisQuantizer2)
class PlHysteresisQuantizer {
  constructor(numSteps, hysteresis, symmetric) {
    this.numSteps = numSteps; this.hysteresis = hysteresis;
    this.scale = symmetric ? numSteps - 1 : numSteps; this.offset = symmetric ? 0 : -0.5;
    this.quantizedValue = 0;
  }
  // in single precision, as on the module: a value right at a threshold falls the same side
  process(value, base = 0) {
    const f = Math.fround;
    value = f(f(f(f(value) * this.scale) + this.offset) + base);
    const sign = value > this.quantizedValue ? -1 : 1;
    const q = plConstrain(f(f(value + f(sign * f(this.hysteresis))) + 0.5) | 0, 0, this.numSteps - 1);
    this.quantizedValue = q;
    return q;
  }
}

// ---- plaits/dsp/oscillator/string_synth_oscillator.h: divide-down saws at 8', 4', 2', 1', as on a string machine
class PlStringSynthOscillator {
  constructor() {
    this.phase = 0; this.nextSample = 0; this.segment = 0;
    this.frequency = 0.001; this.saw8 = 0; this.saw4 = 0; this.saw2 = 0; this.saw1 = 0;
    this.registration = new Float64Array(7);
  }
  // adds into out
  render(frequency, unshifted, gain, out, size) {
    frequency *= 8;
    let shift = 0;
    while (frequency > 0.5) { shift += 2; frequency *= 0.5; }
    if (shift >= 8) return;
    const r = this.registration;
    for (let i = 0; i < 7; i++) r[i] = i < shift ? 0 : unshifted[i - shift];
    let fv = this.frequency; const df = (frequency - fv) / size;
    let g8 = this.saw8; const d8 = ((r[0] + 2 * r[1]) * gain - g8) / size;
    let g4 = this.saw4; const d4 = ((r[2] - r[1] + 2 * r[3]) * gain - g4) / size;
    let g2 = this.saw2; const d2 = ((r[4] - r[3] + 2 * r[5]) * gain - g2) / size;
    let g1 = this.saw1; const d1 = ((r[6] - r[5]) * gain - g1) / size;
    let phase = this.phase, nextSample = this.nextSample, segment = this.segment;
    for (let n = 0; n < size; n++) {
      let thisSample = nextSample;
      nextSample = 0;
      fv += df; g8 += d8; g4 += d4; g2 += d2; g1 += d1;
      phase += fv;
      let nextSegment = phase | 0;
      if (nextSegment !== segment) {
        let d = 0;
        if (nextSegment === 8) { phase -= 8; nextSegment -= 8; d -= g8; }
        if ((nextSegment & 3) === 0) d -= g4;
        if ((nextSegment & 1) === 0) d -= g2;
        d -= g1;
        if (d !== 0) {
          const t = (phase - nextSegment) / fv;
          thisSample += plThisBlepSample(t) * d;
          nextSample += plNextBlepSample(t) * d;
        }
      }
      segment = nextSegment;
      nextSample += (phase - 4) * g8 * 0.125;
      nextSample += (phase - (segment & 4) - 2) * g4 * 0.25;
      nextSample += (phase - (segment & 6) - 1) * g2 * 0.5;
      nextSample += (phase - (segment & 7) - 0.5) * g1;
      out[n] += 2 * thisSample;
    }
    this.nextSample = nextSample; this.phase = phase; this.segment = segment;
    this.frequency = fv; this.saw8 = g8; this.saw4 = g4; this.saw2 = g2; this.saw1 = g1;
  }
}

// ---- plaits/dsp/oscillator/wavetable_oscillator.h (approximate scale, high frequencies attenuated)
// \`waves\`: where each wave starts in \`table\` (Plaits' integrated waves); adds into out
class PlWavetableOscillator {
  constructor(tableSize, numWaves) {
    this.tableSize = tableSize; this.numWaves = numWaves;
    this.phase = 0; this.frequency = 0; this.amplitude = 0; this.waveform = 0; this.lp = 0;
    this.diffLp = 0; this.diffPrevious = 0;
  }
  render(frequency, amplitude, waveform, table, waves, out, size) {
    frequency = plConstrain(frequency, 0.0000001, PL_MAX_FREQUENCY);
    amplitude *= 1 - 2 * frequency;
    amplitude *= 1 / (frequency * 131072);
    let fv = this.frequency; const df = (frequency - fv) / size;
    let av = this.amplitude; const da = (amplitude - av) / size;
    let wv = this.waveform; const dw = (waveform * (this.numWaves - 1.0001) - wv) / size;
    let lp = this.lp, phase = this.phase;
    const N = this.tableSize;
    for (let n = 0; n < size; n++) {
      fv += df; wv += dw; av += da;
      const f0 = fv;
      const cutoff = Math.min(N * f0, 1);
      phase += f0;
      if (phase >= 1) phase -= 1;
      const wi = wv | 0, wf = wv - wi;
      const pp = phase * N, pi = pp | 0, pf = pp - pi;
      const o0 = waves[wi] + pi, o1 = waves[wi + 1] + pi;
      const x0 = table[o0] + (table[o0 + 1] - table[o0]) * pf;
      const x1 = table[o1] + (table[o1 + 1] - table[o1]) * pf;
      const sIn = x0 + (x1 - x0) * wf;
      this.diffLp += cutoff * (sIn - this.diffPrevious - this.diffLp);
      this.diffPrevious = sIn;
      lp += cutoff * (this.diffLp - lp);
      out[n] += av * lp;
    }
    this.lp = lp; this.phase = phase;
    this.frequency = fv; this.amplitude = av; this.waveform = wv;
  }
}

// ---- stmlib/utils/random.h: one generator shared by everything, as on the module (the tests seed it)
let PL_RNG = 0x21;
function plRandomSeed(seed) { PL_RNG = seed >>> 0; }
function plRandomWord() { PL_RNG = (Math.imul(PL_RNG, 1664525) + 1013904223) >>> 0; return PL_RNG; }
function plRandomSample() { return (plRandomWord() >>> 16) << 16 >> 16; }
function plRandomFloat() { return plRandomWord() / 4294967296; }

// ---- stmlib/dsp/filter.h: the state-variable filter (Svf)
class PlSvf {
  constructor() { this.setFQ(PL_FREQ_DIRTY, 0.01, 100); this.s1 = 0; this.s2 = 0; }
  reset() { this.s1 = 0; this.s2 = 0; }
  copyFrom(f) { this.g = f.g; this.r = f.r; this.h = f.h; }
  setGRH(g, r, h) { this.g = g; this.r = r; this.h = h; }
  setGR(g, r) { this.g = g; this.r = r; this.h = 1 / (1 + r * g + g * g); }
  setGQ(g, resonance) { this.g = g; this.r = 1 / resonance; this.h = 1 / (1 + this.r * g + g * g); }
  setFQ(approximation, f, resonance) {
    this.g = plTan(approximation, f); this.r = 1 / resonance;
    this.h = 1 / (1 + this.r * this.g + this.g * this.g);
  }
  // one sample; the mode picks the output
  process(mode, x) {
    const g = this.g, r = this.r;
    const hp = (x - r * this.s1 - g * this.s1 - this.s2) * this.h;
    const bp = g * hp + this.s1;
    this.s1 = g * hp + bp;
    const lp = g * bp + this.s2;
    this.s2 = g * bp + lp;
    return mode === PL_LOW_PASS ? lp : mode === PL_BAND_PASS ? bp : mode === PL_BAND_PASS_NORMALIZED ? bp * r : hp;
  }
  processBuffer(mode, input, out, size) { for (let i = 0; i < size; i++) out[i] = this.process(mode, input[i]); }
  processAdd(mode, input, out, size, gain) { for (let i = 0; i < size; i++) out[i] += gain * this.process(mode, input[i]); }
  // adds one mode's output into two buffers, with a gain each
  processAdd2(mode, input, out1, out2, size, gain1, gain2) {
    for (let i = 0; i < size; i++) { const v = this.process(mode, input[i]); out1[i] += v * gain1; out2[i] += v * gain2; }
  }
  processMultimode(input, out, size, mode) {
    const hpG = mode < 0.5 ? -mode * 2 : -2 + mode * 2, lpG = mode < 0.5 ? 1 - mode * 2 : 0, bpG = mode < 0.5 ? 0 : mode * 2 - 1;
    const g = this.g, r = this.r, h = this.h;
    let s1 = this.s1, s2 = this.s2;
    for (let i = 0; i < size; i++) {
      const hp = (input[i] - r * s1 - g * s1 - s2) * h, bp = g * hp + s1;
      s1 = g * hp + bp;
      const lp = g * bp + s2;
      s2 = g * bp + lp;
      out[i] = hpG * hp + bpG * bp + lpG * lp;
    }
    this.s1 = s1; this.s2 = s2;
  }
  processMultimodeLPtoHP(input, out, size, mode) {
    const hpG = Math.min(-mode * 2 + 1, 0), bpG = 1 - 2 * Math.abs(mode - 0.5), lpG = Math.max(1 - mode * 2, 0);
    const g = this.g, r = this.r, h = this.h;
    let s1 = this.s1, s2 = this.s2;
    for (let i = 0; i < size; i++) {
      const hp = (input[i] - r * s1 - g * s1 - s2) * h, bp = g * hp + s1;
      s1 = g * hp + bp;
      const lp = g * bp + s2;
      s2 = g * bp + lp;
      out[i] = hpG * hp + bpG * bp + lpG * lp;
    }
    this.s1 = s1; this.s2 = s2;
  }
}

// ---- stmlib/dsp/cosine_oscillator.h (the approximate one): a slow cosine for the FX engine's LFOs
class PlCosineOscillator {
  constructor(frequency) {
    let sign = 16;
    frequency -= 0.25;
    if (frequency < 0) frequency = -frequency;
    else if (frequency > 0.5) frequency -= 0.5;
    else sign = -16;
    this.iir = sign * frequency * (1 - 2 * frequency);
    this.y1 = this.iir * 0.25; this.y0 = 0.5;
  }
  value() { return this.y1 + 0.5; }
  next() { const t = this.y0; this.y0 = this.iir * this.y0 - this.y1; this.y1 = t; return t + 0.5; }
}

// ---- plaits/dsp/fx/fx_engine.h: delay memory for small reverbs and diffusers, stored at 12 bits as on the module
// \`lines\`: each delay line's length, in order (FxEngine's Reserve list); a line is { base, length }
class PlFxEngine {
  constructor(size, lines) {
    this.size = size; this.mask = size - 1;
    this.buffer = new Int16Array(size);
    let base = 0;
    this.lines = lines.map((length) => { const d = { base, length }; base += length + 1; return d; });
    this.writePtr = 0;
    this.lfo = [new PlCosineOscillator(0), new PlCosineOscillator(0)];
    this.acc = 0; this.previousRead = 0; this.lfoValue = [0, 0];
  }
  setLFOFrequency(index, frequency) { this.lfo[index] = new PlCosineOscillator(frequency * 32); }
  clear() { this.buffer.fill(0); this.writePtr = 0; }
  static compress(v) { const x = Math.trunc(v * 4096); return x < -32768 ? -32768 : x > 32767 ? 32767 : x; }
  start() {
    if (--this.writePtr < 0) this.writePtr += this.size;
    this.acc = 0; this.previousRead = 0;
    if ((this.writePtr & 31) === 0) { this.lfoValue[0] = this.lfo[0].next(); this.lfoValue[1] = this.lfo[1].next(); }
    else { this.lfoValue[0] = this.lfo[0].value(); this.lfoValue[1] = this.lfo[1].value(); }
  }
  load(v) { this.acc = v; }
  readValue(v, scale = 1) { this.acc += v * scale; }
  // reads a line at an offset (-1: its tail)
  read(d, offset, scale) {
    const at = offset === -1 ? this.writePtr + d.base + d.length - 1 : this.writePtr + d.base + offset;
    const r = this.buffer[at & this.mask] / 4096;
    this.previousRead = r;
    this.acc += r * scale;
  }
  write(d, offset, scale) {
    const at = offset === -1 ? this.writePtr + d.base + d.length - 1 : this.writePtr + d.base + offset;
    this.buffer[at & this.mask] = PlFxEngine.compress(this.acc);
    this.acc *= scale;
  }
  writeAllPass(d, offset, scale) { this.write(d, offset, scale); this.acc += this.previousRead; }
  // writes the accumulator out (returned), and scales what stays
  writeValue(scale) { const v = this.acc; this.acc *= scale; return v; }
  lp(state, coefficient) { state += coefficient * (this.acc - state); this.acc = state; return state; }
  hp(state, coefficient) { state += coefficient * (this.acc - state); this.acc -= state; return state; }
  interpolate(d, offset, lfoIndex, amplitude, scale) {
    if (lfoIndex >= 0) offset += amplitude * this.lfoValue[lfoIndex];
    const oi = offset | 0, of = offset - oi;
    const a = this.buffer[(this.writePtr + oi + d.base) & this.mask] / 4096;
    const b = this.buffer[(this.writePtr + oi + d.base + 1) & this.mask] / 4096;
    const x = a + (b - a) * of;
    this.previousRead = x;
    this.acc += x * scale;
  }
}

// ---- plaits/dsp/fx/diffuser.h: four all-passes and a modulated loop, smearing a signal in time
class PlDiffuser {
  constructor() {
    this.engine = new PlFxEngine(8192, [126, 180, 269, 444, 1653, 2010, 3411]);
    this.engine.setLFOFrequency(0, 0.3 / 48000);
    this.lpDecay = 0;
  }
  reset() { this.engine.clear(); }
  process(amount, rt, buf, size) {
    const e = this.engine, [ap1, ap2, ap3, ap4, dapa, dapb, del] = e.lines;
    const kap = 0.625, klp = 0.75;
    let lp = this.lpDecay;
    for (let i = 0; i < size; i++) {
      e.start();
      e.readValue(buf[i]);
      e.read(ap1, -1, kap); e.writeAllPass(ap1, 0, -kap);
      e.read(ap2, -1, kap); e.writeAllPass(ap2, 0, -kap);
      e.read(ap3, -1, kap); e.writeAllPass(ap3, 0, -kap);
      e.interpolate(ap4, 400, 0, 43, kap); e.writeAllPass(ap4, 0, -kap);
      e.interpolate(del, 3070, 0, 340, rt);
      lp = e.lp(lp, klp);
      e.read(dapa, -1, -kap); e.writeAllPass(dapa, 0, kap);
      e.read(dapb, -1, kap); e.writeAllPass(dapb, 0, -kap);
      e.write(del, 0, 2);
      const wet = e.writeValue(0);
      buf[i] += amount * (wet - buf[i]);
    }
    this.lpDecay = lp;
  }
}

// ---- plaits/dsp/noise/clocked_noise.h: sample-and-hold noise at a clock (band-limited steps)
class PlClockedNoise {
  constructor() { this.phase = 0; this.sample = 0; this.nextSample = 0; this.frequency = 0.001; }
  render(sync, frequency, out, size) {
    frequency = plConstrain(frequency, 0, 1);
    let fv = this.frequency; const df = (frequency - fv) / size;
    let nextSample = this.nextSample, sample = this.sample;
    if (sync) this.phase = 1;
    for (let n = 0; n < size; n++) {
      let thisSample = nextSample;
      nextSample = 0;
      fv += df;
      const f = fv;
      const raw = plRandomFloat() * 2 - 1;
      const rawAmount = plConstrain(4 * (f - 0.25), 0, 1);
      this.phase += f;
      if (this.phase >= 1) {
        this.phase -= 1;
        const t = this.phase / f, d = raw - sample;
        thisSample += d * plThisBlepSample(t);
        nextSample += d * plNextBlepSample(t);
        sample = raw;
      }
      nextSample += sample;
      out[n] = thisSample + rawAmount * (raw - thisSample);
    }
    this.nextSample = nextSample; this.sample = sample; this.frequency = fv;
  }
}

// ---- plaits/dsp/noise/particle.h: random impulses, each through a band-pass at a random pitch
class PlParticle {
  constructor() { this.preGain = 0; this.filter = new PlSvf(); }
  render(sync, density, gain, frequency, spread, q, out, aux, size) {
    let u = plRandomFloat();
    if (sync) u = density;
    let canRandomize = true;
    for (let n = 0; n < size; n++) {
      let s = 0;
      if (u <= density) {
        s = u * gain;
        if (canRandomize) {
          const v = 2 * plRandomFloat() - 1;
          const f = Math.min(plSemitonesToRatio(spread * v) * frequency, 0.25);
          this.preGain = 0.5 / Math.sqrt(q * f * Math.sqrt(density));
          this.filter.setFQ(PL_FREQ_DIRTY, f, q);
          canRandomize = false;
        }
      }
      aux[n] += s;
      out[n] += this.filter.process(PL_BAND_PASS, this.preGain * s);
      u = plRandomFloat();
    }
  }
}

// ---- plaits/dsp/noise/dust.h
function plDust(frequency) {
  const inv = 1 / frequency, u = plRandomFloat();
  return u < frequency ? u * inv : 0;
}

// ---- stmlib/dsp/filter.h (DCBlocker)
class PlDCBlocker {
  constructor(pole) { this.x = 0; this.y = 0; this.pole = pole; }
  process(v) { const oldX = this.x; this.x = v; this.y = this.y * this.pole + v - oldX; return this.y; }
}

// ---- plaits/dsp/physical_modelling/delay_line.h
class PlDelayLine {
  constructor(maxDelay) { this.max = maxDelay; this.line = new Float32Array(maxDelay); this.writePtr = 0; }
  reset() { this.line.fill(0); this.writePtr = 0; }
  write(s) { this.line[this.writePtr] = s; this.writePtr = (this.writePtr - 1 + this.max) % this.max; }
  allpass(s, delay, coefficient) {
    const read = this.line[(this.writePtr + delay) % this.max];
    const w = s + coefficient * read;
    this.write(w);
    return -w * coefficient + read;
  }
  read(delay) {
    const di = delay | 0, df = delay - di;
    const a = this.line[(this.writePtr + di) % this.max], b = this.line[(this.writePtr + di + 1) % this.max];
    return a + (b - a) * df;
  }
  readHermite(delay) {
    const di = delay | 0, f = delay - di, t = this.writePtr + di + this.max, M = this.max, L = this.line;
    const xm1 = L[(t - 1) % M], x0 = L[t % M], x1 = L[(t + 1) % M], x2 = L[(t + 2) % M];
    const c = (x1 - xm1) * 0.5, v = x0 - x1, w = c + v, a = w + v + (x2 - x0) * 0.5, bNeg = w + a;
    return (((a * f) - bNeg) * f + c) * f + x0;
  }
}

// ---- plaits/dsp/physical_modelling/string.cc: a Karplus-Strong string with a curved bridge (structure low) or
// dispersion (high), resampled so its delay fits the line at any pitch
const PL_STRING_DELAY = 1024;
class PlString {
  constructor() {
    this.string = new PlDelayLine(PL_STRING_DELAY);
    this.stretch = new PlDelayLine(PL_STRING_DELAY / 4);
    this.delay = 100;
    this.reset();
  }
  reset() {
    this.string.reset(); this.stretch.reset();
    this.iirDamping = new PlSvf();
    this.dcBlocker = new PlDCBlocker(1 - 20 / PL_SAMPLE_RATE);
    this.dispersionNoise = 0; this.curvedBridge = 0;
    this.out0 = 0; this.out1 = 0; this.srcPhase = 0;
  }
  // adds into out
  process(f0, nonLinearity, brightness, damping, input, out, size) {
    const dispersion = nonLinearity > 0;
    const amount = dispersion ? nonLinearity : -nonLinearity;
    let delay = plConstrain(1 / f0, 4, PL_STRING_DELAY - 4);
    let srcRatio = delay * f0;
    if (srcRatio >= 0.9999) { this.srcPhase = 1; srcRatio = 1; }
    let dampingCutoff = Math.min(12 + damping * damping * 60 + brightness * 24, 84);
    let dampingF = Math.min(f0 * plSemitonesToRatio(dampingCutoff), 0.499);
    if (damping >= 0.95) {
      const toInfinite = 20 * (damping - 0.95);
      brightness += toInfinite * (1 - brightness);
      dampingF += toInfinite * (0.4999 - dampingF);
      dampingCutoff += toInfinite * (128 - dampingCutoff);
    }
    this.iirDamping.setFQ(PL_FREQ_FAST, dampingF, 0.5);
    const compensation = plInterpolate(PL_SVF_SHIFT, dampingCutoff, 1);
    // the delay steps only when the resampler takes a sample, so it may end the block short of its target
    let dv = this.delay; const dd = (delay * compensation - dv) / size;
    const stretchPoint = amount * (2 - amount) * 0.225;
    const stretchCorrection = plConstrain((160 / PL_SAMPLE_RATE) * delay, 1, 2.1);
    const noiseSqrt = amount > 0.75 ? 4 * (amount - 0.75) : 0;
    const noiseAmount = noiseSqrt * noiseSqrt * 0.1;
    const noiseFilter = 0.06 + 0.94 * brightness * brightness;
    const bridgeCurving = amount * amount * 0.01;
    const apGain = -0.618 * amount / (0.15 + Math.abs(amount));
    for (let n = 0; n < size; n++) {
      this.srcPhase += srcRatio;
      if (this.srcPhase > 1) {
        this.srcPhase -= 1;
        dv += dd;
        let d = dv, s = 0;
        if (dispersion) {
          const noise = plRandomFloat() - 0.5;
          this.dispersionNoise += noiseFilter * (noise - this.dispersionNoise);
          d *= 1 + this.dispersionNoise * noiseAmount;
          const apDelay = d * stretchPoint;
          const mainDelay = d - apDelay * (0.408 - stretchPoint * 0.308) * stretchCorrection;
          if (apDelay >= 4 && mainDelay >= 4) {
            s = this.string.read(mainDelay);
            s = this.stretch.allpass(s, apDelay | 0, apGain);
          } else {
            s = this.string.readHermite(d);
          }
        } else {
          d *= 1 - this.curvedBridge * bridgeCurving;
          s = this.string.readHermite(d);
          const value = Math.abs(s) - 0.025, sign = s > 0 ? 1 : -1.5;
          this.curvedBridge = (Math.abs(value) + value) * sign;
        }
        s = plConstrain(s + input[n], -20, 20);
        s = this.dcBlocker.process(s);
        s = this.iirDamping.process(PL_LOW_PASS, s);
        this.string.write(s);
        this.out1 = this.out0;
        this.out0 = s;
      }
      out[n] += this.out1 + (this.out0 - this.out1) * this.srcPhase;
    }
    this.delay = dv;
  }
}

// ---- plaits/dsp/physical_modelling/string_voice.cc: a string, plucked by a burst of filtered noise (or bowed
// by dust when the trigger is not patched)
class PlStringVoice {
  constructor() { this.excitationFilter = new PlSvf(); this.string = new PlString(); this.remainingNoiseSamples = 0; }
  reset() { this.string.reset(); }
  render(sustain, trigger, accent, f0, structure, brightness, damping, temp, out, aux, size) {
    const density = brightness * brightness;
    brightness += 0.25 * accent * (1 - brightness);
    damping += 0.25 * accent * (1 - damping);
    if (trigger || sustain) {
      const f = 4 * f0;
      const cutoff = Math.min(f * plSemitonesToRatio((brightness * (2 - brightness) - 0.5) * 72), 0.499);
      this.remainingNoiseSamples = (1 / f0) >>> 0;
      this.excitationFilter.setFQ(PL_FREQ_DIRTY, cutoff, sustain ? 1 : 0.5);
    }
    if (sustain) {
      const dustF = 0.00005 + 0.99995 * density * density;
      for (let i = 0; i < size; i++) temp[i] = plDust(dustF) * (8 - dustF * 6) * accent;
    } else if (this.remainingNoiseSamples) {
      const noiseSamples = Math.min(this.remainingNoiseSamples, size);
      this.remainingNoiseSamples -= noiseSamples;
      for (let i = 0; i < size; i++) temp[i] = i < noiseSamples ? 2 * plRandomFloat() - 1 : 0;
    } else {
      temp.fill(0, 0, size);
    }
    this.excitationFilter.processBuffer(PL_LOW_PASS, temp, temp, size);
    for (let i = 0; i < size; i++) aux[i] += temp[i];
    const nonLinearity = structure < 0.24 ? (structure - 0.24) * 4.166 : structure > 0.26 ? (structure - 0.26) * 1.35135 : 0;
    this.string.process(f0, nonLinearity, brightness, damping, temp, out, size);
  }
}

// ---- plaits/dsp/physical_modelling/resonator.h, .cc: a bank of band-passes, tuned to a stiff bar or string
class PlResonatorSvf {
  constructor(n) {
    this.n = n;
    this.s1 = new Float64Array(n); this.s2 = new Float64Array(n);
    this.g = new Float64Array(n); this.rg = new Float64Array(n); this.h = new Float64Array(n); this.gains = new Float64Array(n);
  }
  init() { this.s1.fill(0); this.s2.fill(0); }
  // f, q, gain: one each per filter; lowPass or band-pass; add into out, or write it
  process(lowPass, add, f, q, gain, input, out, size) {
    const n = this.n, g = this.g, rg = this.rg, h = this.h, gains = this.gains, s1 = this.s1, s2 = this.s2;
    for (let i = 0; i < n; i++) {
      g[i] = plTan(PL_FREQ_FAST, f[i]);
      const r = 1 / q[i];
      h[i] = 1 / (1 + r * g[i] + g[i] * g[i]);
      rg[i] = r + g[i];
      gains[i] = gain[i];
    }
    for (let k = 0; k < size; k++) {
      const x = input[k];
      let y = 0;
      for (let i = 0; i < n; i++) {
        const hp = (x - rg[i] * s1[i] - s2[i]) * h[i];
        const bp = g[i] * hp + s1[i];
        s1[i] = g[i] * hp + bp;
        const lp = g[i] * bp + s2[i];
        s2[i] = g[i] * bp + lp;
        y += gains[i] * (lowPass ? lp : bp);
      }
      if (add) out[k] += y; else out[k] = y;
    }
  }
}

const PL_MAX_MODES = 24, PL_MODE_BATCH = 4;
function plNthHarmonicCompensation(n, stiffness) {
  let stretch = 1;
  for (let i = 0; i < n - 1; i++) { stretch += stiffness; stiffness *= stiffness < 0 ? 0.93 : 0.98; }
  return 1 / stretch;
}

class PlResonator {
  constructor() {
    this.resolution = PL_MAX_MODES;
    this.modeAmplitude = new Float64Array(PL_MAX_MODES);
    this.modeFilters = Array.from({ length: PL_MAX_MODES / PL_MODE_BATCH }, () => new PlResonatorSvf(PL_MODE_BATCH));
    this.modeQ = new Float64Array(PL_MODE_BATCH); this.modeF = new Float64Array(PL_MODE_BATCH); this.modeA = new Float64Array(PL_MODE_BATCH);
  }
  init(position, resolution) {
    this.resolution = Math.min(resolution, PL_MAX_MODES);
    const amplitudes = new PlCosineOscillator(position);
    for (let i = 0; i < resolution; i++) this.modeAmplitude[i] = amplitudes.next() * 0.25;
    for (const f of this.modeFilters) f.init();
  }
  // adds into out
  process(f0, structure, brightness, damping, input, out, size) {
    let stiffness = plInterpolate(PL_STIFFNESS, structure, 64);
    f0 *= plNthHarmonicCompensation(3, stiffness);
    let harmonic = f0, stretch = 1;
    const qSqrt = plSemitonesToRatio(damping * 79.7);
    let q = 500 * qSqrt * qSqrt;
    brightness *= 1 - structure * 0.3;
    brightness *= 1 - damping * 0.3;
    const qLoss = brightness * (2 - brightness) * 0.85 + 0.15;
    let batch = 0, filter = 0;
    for (let i = 0; i < this.resolution; i++) {
      let mf = harmonic * stretch;
      if (mf >= 0.499) mf = 0.499;
      this.modeF[batch] = mf;
      this.modeQ[batch] = 1 + mf * q;
      this.modeA[batch] = this.modeAmplitude[i] * (1 - mf * 2);
      if (++batch === PL_MODE_BATCH) {
        batch = 0;
        this.modeFilters[filter++].process(false, true, this.modeF, this.modeQ, this.modeA, input, out, size);
      }
      stretch += stiffness;
      stiffness *= stiffness < 0 ? 0.93 : 0.98;
      harmonic += f0;
      q *= qLoss;
    }
  }
}

// ---- plaits/dsp/physical_modelling/modal_voice.cc: the resonator struck by a filtered impulse (or bowed by dust)
class PlModalVoice {
  constructor() {
    this.excitationFilter = new PlResonatorSvf(1);
    this.resonator = new PlResonator();
    this.one = [1]; this.cutoff = [0]; this.q = [0];
  }
  init() { this.excitationFilter.init(); this.resonator.init(0.015, PL_MAX_MODES); }
  render(sustain, trigger, accent, f0, structure, brightness, damping, temp, out, aux, size) {
    const density = brightness * brightness;
    brightness += 0.25 * accent * (1 - brightness);
    damping += 0.25 * accent * (1 - damping);
    const range = sustain ? 36 : 60, f = sustain ? 4 * f0 : 2 * f0;
    const cutoff = Math.min(f * plSemitonesToRatio((brightness * (2 - brightness) - 0.5) * range), 0.499);
    const q = sustain ? 0.7 : 1.5;
    if (sustain) {
      const dustF = 0.00005 + 0.99995 * density * density;
      for (let i = 0; i < size; i++) temp[i] = plDust(dustF) * (4 - dustF * 3) * accent;
    } else {
      temp.fill(0, 0, size);
      if (trigger) {
        const attenuation = 1 - damping * 0.5;
        const amplitude = (0.12 + 0.08 * accent) * attenuation;
        temp[0] = amplitude * plSemitonesToRatio(cutoff * cutoff * 24) / cutoff;
      }
    }
    this.cutoff[0] = cutoff; this.q[0] = q;
    this.excitationFilter.process(true, false, this.cutoff, this.q, this.one, temp, temp, size);
    for (let i = 0; i < size; i++) aux[i] += temp[i];
    this.resonator.process(f0, structure, brightness, damping, temp, out, size);
  }
}
`,`
// ---- 1: virtual analog (virtual_analog_engine.cc, VA_VARIANT 2, as the module ships)
// OUT: a variable square (TIMBRE: width, then hard sync) and a variable saw (MORPH: saw, notched, triangle),
// detuned by HARMONICS. AUX: the "monster sync" pair, both shaped by MORPH and synced by TIMBRE.
const PL_VA_INTERVALS = [0, 7.01, 12.01, 19.01, 24.01];
function plSquash(x) { return x * x * (3 - 2 * x); }

class PlVirtualAnalogEngine {
  constructor() {
    this.primary = new PlVariableShapeOscillator();
    this.auxiliary = new PlVariableShapeOscillator();
    this.auxiliary.setMasterPhase(0.25);
    this.sync = new PlVariableShapeOscillator();
    this.variableSaw = new PlVariableSawOscillator();
    this.auxiliaryAmount = 0;
    this.xmodAmount = 0;
    this.temp = new Float32Array(PL_MAX_BLOCK);
  }

  reset() {}

  computeDetuning(detune) {
    detune = plConstrain(2.05 * detune - 1.025, -1, 1);
    const sign = detune < 0 ? -1 : 1;
    detune = detune * sign * 3.9999;
    const i = detune | 0, f = detune - i;
    const a = PL_VA_INTERVALS[i], b = PL_VA_INTERVALS[i + 1];
    return (a + (b - a) * plSquash(plSquash(f))) * sign;
  }

  render(p, out, aux, size) {
    const syncAmount = p.timbre * p.timbre;
    const auxiliaryDetune = this.computeDetuning(p.harmonics);
    const primaryF = plNoteToFrequency(p.note);
    const auxiliaryF = plNoteToFrequency(p.note + auxiliaryDetune);
    const primarySyncF = plNoteToFrequency(p.note + syncAmount * 48);
    const auxiliarySyncF = plNoteToFrequency(p.note + auxiliaryDetune + syncAmount * 48);

    const shape = plConstrain(p.morph * 1.5, 0, 1);
    const pw = plConstrain(0.5 + (p.morph - 0.66) * 1.46, 0.5, 0.995);

    // the monster sync, to AUX
    this.primary.renderSync(primaryF, primarySyncF, pw, shape, out, size);
    this.auxiliary.renderSync(auxiliaryF, auxiliarySyncF, pw, shape, aux, size);
    for (let i = 0; i < size; i++) aux[i] = (aux[i] - out[i]) * 0.5;

    // the double varishape, to OUT
    const squarePw = plConstrain(1.3 * p.timbre - 0.15, 0.005, 0.5);
    const squareSyncRatio = p.timbre < 0.5 ? 0 : (p.timbre - 0.5) * (p.timbre - 0.5) * 4 * 48;
    const squareGain = Math.min(p.timbre * 8, 1);
    let sawPw = p.morph < 0.5 ? p.morph + 0.5 : 1 - (p.morph - 0.5) * 2;
    sawPw = plConstrain(sawPw * 1.1, 0.005, 1);
    const sawShape = plConstrain(10 - 21 * p.morph, 0, 1);
    const sawGain = plConstrain(8 * (1 - p.morph), 0.02, 1);
    const squareSyncF = plNoteToFrequency(p.note + squareSyncRatio);

    this.sync.renderSync(primaryF, squareSyncF, squarePw, 1, this.temp, size);
    this.variableSaw.render(auxiliaryF, sawPw, sawShape, out, size);

    const norm = 1 / Math.max(squareGain, sawGain);
    let sq = this.auxiliaryAmount; const dsq = (squareGain * 0.3 * norm - sq) / size;
    let sw = this.xmodAmount; const dsw = (sawGain * 0.5 * norm - sw) / size;
    for (let i = 0; i < size; i++) {
      sw += dsw; sq += dsq;
      out[i] = out[i] * sw + sq * this.temp[i];
    }
    this.auxiliaryAmount = sq;
    this.xmodAmount = sw;
    return false;
  }
}

// ---- 2: waveshaping (waveshaping_engine.cc)
// A slope (MORPH: its symmetry) through a waveshaper (HARMONICS: which curve) into a wavefolder (TIMBRE: how far).
// AUX: a sine folded by the second folder.
const PL_WS_TABLES = [PL_WS_INVERSE_TAN, PL_WS_INVERSE_SIN, PL_WS_LINEAR, PL_WS_BUMP, PL_WS_DOUBLE_BUMP, PL_WS_DOUBLE_BUMP];
function plTame(f0, harmonics, order) {
  f0 *= harmonics;
  const maxF = 0.5 / order;
  const maxAmount = plConstrain(1 - (f0 - maxF) / (0.5 - maxF), 0, 1);
  return maxAmount * maxAmount * maxAmount;
}
// Hermite-interpolates \`table\` from \`offset\` on (the original passes lut_fold + 1)
function plInterpolateHermiteAt(table, offset, index, size) {
  index *= size;
  const i = (index | 0) + offset, f = index - (index | 0);
  const xm1 = table[i - 1], x0 = table[i], x1 = table[i + 1], x2 = table[i + 2];
  const c = (x1 - xm1) * 0.5, v = x0 - x1, w = c + v, a = w + v + (x2 - x0) * 0.5, bNeg = w + a;
  return (((a * f) - bNeg) * f + c) * f + x0;
}

class PlWaveshapingEngine {
  constructor() {
    this.slope = new PlOscillator();
    this.triangle = new PlOscillator();
    this.previousShape = 0; this.previousWavefolderGain = 0; this.previousOvertoneGain = 0;
  }

  reset() {}

  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const pw = p.morph * 0.45 + 0.5;
    this.slope.render(PL_SHAPE_SLOPE, f0, pw, out, size);
    this.triangle.render(PL_SHAPE_SLOPE, f0, 0.5, aux, size);

    const slope = 3 + Math.abs(p.morph - 0.5) * 5;
    const shapeAmount = Math.abs(p.harmonics - 0.5) * 2;
    const shapeAttenuation = plTame(f0, slope, 16);
    const wavefolderGain = p.timbre;
    const wavefolderAttenuation = plTame(f0, slope * (3 + shapeAmount * shapeAttenuation * 5), 12);

    let sh = this.previousShape; const dsh = (0.5 + (p.harmonics - 0.5) * shapeAttenuation - sh) / size;
    let wf = this.previousWavefolderGain; const dwf = (0.03 + 0.46 * wavefolderGain * wavefolderAttenuation - wf) / size;
    const overtone = p.timbre * (2 - p.timbre);
    let og = this.previousOvertoneGain; const dog = (overtone * (2 - overtone) - og) / size;

    for (let i = 0; i < size; i++) {
      sh += dsh; wf += dwf; og += dog;
      const shape = sh * 3.9999;
      const si = shape | 0, sf = shape - si;
      const t1 = PL_WS_TABLES[si], t2 = PL_WS_TABLES[si + 1];
      const wsIndex = 127 * out[i] + 128;
      let wi = Math.floor(wsIndex);
      const wfrac = wsIndex - wi;
      wi = (wsIndex | 0) & 255;
      const x0 = t1[wi] / 32768, x1 = t1[wi + 1] / 32768, x = x0 + (x1 - x0) * wfrac;
      const y0 = t2[wi] / 32768, y1 = t2[wi + 1] / 32768, y = y0 + (y1 - y0) * wfrac;
      const mix = x + (y - x) * sf;
      const index = mix * wf + 0.5;
      const fold = plInterpolateHermiteAt(PL_FOLD, 1, index, 512);
      const fold2 = -plInterpolateHermiteAt(PL_FOLD_2, 1, index, 512);
      const sine = plSine(aux[i] * 0.25 + 0.5);
      out[i] = fold;
      aux[i] = sine + (fold2 - sine) * og;
    }
    this.previousShape = sh; this.previousWavefolderGain = wf; this.previousOvertoneGain = og;
    return false;
  }
}

// ---- 3: two-operator FM (fm_engine.cc), 4x oversampled
// HARMONICS: the ratio (quantized to musical ones), TIMBRE: the index, MORPH: feedback (into the modulator to the
// right, into its phase to the left). AUX: a sub-oscillator an octave down, phase-modulated by the carrier.
class PlFMEngine {
  constructor() {
    this.carrierPhase = 0; this.modulatorPhase = 0; this.subPhase = 0;
    this.previousCarrierFrequency = PL_A0; this.previousModulatorFrequency = PL_A0;
    this.previousAmount = 0; this.previousFeedback = 0; this.previousSample = 0;
    this.carrierFir = 0; this.subFir = 0;
  }

  reset() {}

  render(p, out, aux, size) {
    const note = p.note - 24;
    const ratio = plInterpolate(PL_FM_FREQUENCY_QUANTIZER, p.harmonics, 128);
    const modulatorNote = note + ratio;
    const targetModulatorFrequency = plConstrain(plNoteToFrequency(modulatorNote), 0, 0.5);
    let hfTaming = plConstrain(1 - (modulatorNote - 72) * 0.025, 0, 1);
    hfTaming *= hfTaming;

    let cf = this.previousCarrierFrequency; const dcf = (plNoteToFrequency(note) - cf) / size;
    let mf = this.previousModulatorFrequency; const dmf = (targetModulatorFrequency - mf) / size;
    let am = this.previousAmount; const dam = (2 * p.timbre * p.timbre * hfTaming - am) / size;
    let fb = this.previousFeedback; const dfb = (2 * p.morph - 1 - fb) / size;
    const fir = PL_4X_DOWNSAMPLER_FIR;
    let cHead = this.carrierFir, cTail = 0, sHead = this.subFir, sTail = 0;
    let prev = this.previousSample;
    let cp = this.carrierPhase, mp = this.modulatorPhase, sp = this.subPhase;

    for (let n = 0; n < size; n++) {
      am += dam; fb += dfb; cf += dcf; mf += dmf;
      const amount = am, feedback = fb;
      const phaseFeedback = feedback < 0 ? 0.5 * feedback * feedback : 0;
      const carrierIncrement = (4294967296 * cf) >>> 0;
      for (let j = 0; j < PL_OVERSAMPLING; j++) {
        mp = (mp + ((4294967296 * mf * (1 + prev * phaseFeedback)) >>> 0)) >>> 0;
        cp = (cp + carrierIncrement) >>> 0;
        sp = (sp + (carrierIncrement >>> 1)) >>> 0;
        const modulatorFb = feedback > 0 ? 0.25 * feedback * feedback : 0;
        const modulator = plSinePM(mp, modulatorFb * prev);
        const carrier = plSinePM(cp, amount * modulator);
        const sub = plSinePM(sp, amount * carrier * 0.25);
        prev += 0.05 * (carrier - prev);
        cHead += carrier * fir[3 - j]; cTail += carrier * fir[j];
        sHead += sub * fir[3 - j]; sTail += sub * fir[j];
      }
      out[n] = cHead; cHead = cTail; cTail = 0;
      aux[n] = sHead; sHead = sTail; sTail = 0;
    }
    this.carrierFir = cHead; this.subFir = sHead;
    this.previousSample = prev;
    this.carrierPhase = cp; this.modulatorPhase = mp; this.subPhase = sp;
    this.previousCarrierFrequency = cf; this.previousModulatorFrequency = mf;
    this.previousAmount = am; this.previousFeedback = fb;
    return false;
  }
}

// ---- 4: granular formant oscillator (grain_engine.cc)
// OUT: two grainlet oscillators, formants at TIMBRE and TIMBRE times HARMONICS' ratio, carrier shape on MORPH.
// AUX: the Z oscillator, a filter sweep (TIMBRE) of a carrier shape (MORPH) reset in different ways (HARMONICS).
class PlGrainEngine {
  constructor() {
    this.grainlet = [new PlGrainletOscillator(), new PlGrainletOscillator()];
    this.zOscillator = new PlZOscillator();
    this.dcBlocker = [new PlOnePole(), new PlOnePole()];
  }

  reset() {}

  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const f1 = plNoteToFrequency(24 + 84 * p.timbre);
    const ratio = plSemitonesToRatio(-24 + 48 * p.harmonics);
    const bleed = p.harmonics < 0.5 ? 1 - 2 * p.harmonics : 0;
    const bleedFixed = bleed * (2 - bleed);
    const carrierShape = 0.33 + (p.morph - 0.33) * Math.max(1 - f0 * 24, 0);
    this.grainlet[0].render(f0, f1, carrierShape, bleedFixed, out, size);
    this.grainlet[1].render(f0, f1 * ratio, carrierShape, bleedFixed, aux, size);
    this.dcBlocker[0].setF(PL_FREQ_DIRTY, 0.3 * f0);
    for (let i = 0; i < size; i++) out[i] = this.dcBlocker[0].process(PL_HIGH_PASS, out[i] + aux[i]);
    const cutoff = plNoteToFrequency(p.note + 96 * p.timbre);
    this.zOscillator.render(f0, cutoff, p.morph, p.harmonics, aux, size);
    this.dcBlocker[1].setF(PL_FREQ_DIRTY, 0.3 * f0);
    this.dcBlocker[1].processBuffer(PL_HIGH_PASS, aux, size);
    return false;
  }
}

// ---- 5: additive (additive_engine.cc)
// OUT: 24 harmonics, a bump of them centred on TIMBRE, as wide as MORPH, with peaks HARMONICS adds.
// AUX: the same bump on the eight harmonics of a drawbar organ.
const PL_INTEGER_HARMONICS = Array.from({ length: 24 }, (_, i) => i);
const PL_ORGAN_HARMONICS = [0, 1, 2, 3, 5, 7, 9, 11];

class PlAdditiveEngine {
  constructor() {
    this.amplitudes = new Float64Array(36);
    this.harmonicOscillator = [new PlHarmonicOscillator(12), new PlHarmonicOscillator(12), new PlHarmonicOscillator(12)];
  }

  reset() { this.amplitudes.fill(0); }

  updateAmplitudes(centroid, slope, bumps, offset, harmonicIndices) {
    const amplitudes = this.amplitudes, num = harmonicIndices.length;
    const n = num - 1;
    const margin = (1 / slope - 1) / (1 + bumps);
    const center = centroid * (n + margin) - 0.5 * margin;
    let sum = 0.001;
    for (let i = 0; i < num; i++) {
      const order = Math.abs(i - center) * slope;
      let gain = 1 - order;
      gain += Math.abs(gain);
      gain *= gain;
      gain *= 1 + plSine(0.25 + order * bumps);
      gain *= gain;
      gain *= gain;
      const j = offset + harmonicIndices[i];
      amplitudes[j] += 0.001 * (gain - amplitudes[j]);
      sum += amplitudes[j];
    }
    sum = 1 / sum;
    for (let i = 0; i < num; i++) amplitudes[offset + harmonicIndices[i]] *= sum;
  }

  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const centroid = p.timbre, rawBumps = p.harmonics;
    const rawSlope = (1 - 0.6 * rawBumps) * p.morph;
    const slope = 0.01 + 1.99 * rawSlope * rawSlope * rawSlope;
    const bumps = 16 * rawBumps * rawBumps;
    this.updateAmplitudes(centroid, slope, bumps, 0, PL_INTEGER_HARMONICS);
    this.harmonicOscillator[0].render(1, f0, this.amplitudes, 0, out, size);
    this.harmonicOscillator[1].render(13, f0, this.amplitudes, 12, out, size);
    this.updateAmplitudes(centroid, slope, bumps, 24, PL_ORGAN_HARMONICS);
    this.harmonicOscillator[2].render(1, f0, this.amplitudes, 24, aux, size);
    return false;
  }
}

// ---- 6: wavetable (wavetable_engine.cc)
// Four banks of 8 x 8 waves: TIMBRE moves along a row, MORPH down a column, HARMONICS between banks (past the
// fourth it runs back, the waves snapping to the grid). AUX: the same at 5 bits.
const PL_WT_TABLE = 128, PL_WT_STRIDE = PL_WT_TABLE + 4, PL_WT_WAVES = 192, PL_WT_PER_BANK = 64;
// where each wave starts in PL_INTEGRATED_WAVES; the fourth bank (the module's user bank) is its default, a mix
const PL_WT_MAP = Int32Array.from({ length: 4 * PL_WT_PER_BANK }, (_, i) => (i >= 3 * PL_WT_PER_BANK ? (i * 101) % PL_WT_WAVES : i) * PL_WT_STRIDE);
function plWtClamp(x, amount) { return plConstrain((x - 0.5) * amount, -0.5, 0.5) + 0.5; }
// a position, its fraction pulled toward the nearest wave as HARMONICS goes into the last banks
function plWtSnap(v, quantization) { const i = v | 0; let f = v - i; f += quantization * (plWtClamp(f, 16) - f); return i + f; }

class PlWavetableEngine {
  constructor() {
    this.phase = 0;
    this.xLp = 0; this.yLp = 0; this.zLp = 0;
    this.xPreLp = 0; this.yPreLp = 0; this.zPreLp = 0;
    this.previousX = 0; this.previousY = 0; this.previousZ = 0; this.previousF0 = PL_A0;
    this.diffLp = 0; this.diffPrevious = 0;
  }

  reset() {}

  readWave(x, y, z, pi, pf) {
    const t = PL_INTEGRATED_WAVES, o = PL_WT_MAP[x + y * 8 + z * PL_WT_PER_BANK] + pi;
    const xm1 = t[o], x0 = t[o + 1], x1 = t[o + 2], x2 = t[o + 3];
    const c = (x1 - xm1) * 0.5, v = x0 - x1, w = c + v, a = w + v + (x2 - x0) * 0.5, bNeg = w + a;
    return (((a * pf) - bNeg) * pf + c) * pf + x0;
  }

  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    this.xPreLp += 0.2 * (p.timbre * 6.9999 - this.xPreLp);
    this.yPreLp += 0.2 * (p.morph * 6.9999 - this.yPreLp);
    this.zPreLp += 0.05 * (p.harmonics * 6.9999 - this.zPreLp);
    const quantization = Math.min(Math.max(this.zPreLp - 3, 0), 1);
    const lpCoefficient = Math.min(Math.max(2 * f0 * (4 - 3 * quantization), 0.01), 0.1);
    let xv = this.previousX; const dx = (plWtSnap(this.xPreLp, quantization) - xv) / size;
    let yv = this.previousY; const dy = (plWtSnap(this.yPreLp, quantization) - yv) / size;
    let zv = this.previousZ; const dz = (plWtSnap(this.zPreLp, quantization) - zv) / size;
    let fv = this.previousF0; const df = (f0 - fv) / size;

    for (let n = 0; n < size; n++) {
      fv += df; xv += dx; yv += dy; zv += dz;
      const f = fv;
      const gain = (1 / (f * 131072)) * (0.95 - f);
      const cutoff = Math.min(PL_WT_TABLE * f, 1);
      this.xLp += lpCoefficient * (xv - this.xLp);
      this.yLp += lpCoefficient * (yv - this.yLp);
      this.zLp += lpCoefficient * (zv - this.zLp);
      const xi = this.xLp | 0, xf = this.xLp - xi;
      const yi = this.yLp | 0, yf = this.yLp - yi;
      const zi = this.zLp | 0, zf = this.zLp - zi;
      this.phase += f;
      if (this.phase >= 1) this.phase -= 1;
      const ph = this.phase * PL_WT_TABLE, pi = ph | 0, pf = ph - pi;
      let z0 = zi, z1 = zi + 1;
      if (z0 >= 4) z0 = 7 - z0;
      if (z1 >= 4) z1 = 7 - z1;
      const x0 = xi, x1 = xi + 1, y0 = yi, y1 = yi + 1;
      const xy0z0 = this.readWave(x0, y0, z0, pi, pf) + (this.readWave(x1, y0, z0, pi, pf) - this.readWave(x0, y0, z0, pi, pf)) * xf;
      const xy1z0 = this.readWave(x0, y1, z0, pi, pf) + (this.readWave(x1, y1, z0, pi, pf) - this.readWave(x0, y1, z0, pi, pf)) * xf;
      const xyz0 = xy0z0 + (xy1z0 - xy0z0) * yf;
      const xy0z1 = this.readWave(x0, y0, z1, pi, pf) + (this.readWave(x1, y0, z1, pi, pf) - this.readWave(x0, y0, z1, pi, pf)) * xf;
      const xy1z1 = this.readWave(x0, y1, z1, pi, pf) + (this.readWave(x1, y1, z1, pi, pf) - this.readWave(x0, y1, z1, pi, pf)) * xf;
      const xyz1 = xy0z1 + (xy1z1 - xy0z1) * yf;
      let mix = xyz0 + (xyz1 - xyz0) * zf;
      // the waves are stored integrated: differentiate (gently low-passed) to play them
      this.diffLp += cutoff * (mix - this.diffPrevious - this.diffLp);
      this.diffPrevious = mix;
      mix = this.diffLp * gain;
      out[n] = mix;
      aux[n] = Math.trunc(mix * 32) / 32;
    }
    this.previousX = xv; this.previousY = yv; this.previousZ = zv; this.previousF0 = fv;
    return false;
  }
}

// ---- 7: chords (chord_engine.cc, plaits/dsp/chords/chord_bank.cc)
// HARMONICS: which chord (11), TIMBRE: its inversion and voicing, MORPH: from a string machine's divide-down saws
// (organ-like registrations) to wavetables. AUX: the root alone, an octave down (the voice the inversion drops).
const PL_CHORD_NOTES = 4, PL_CHORD_VOICES = 5, PL_CHORD_HARMONICS = 3;
const PL_CHORDS = [
  [0, 0.01, 11.99, 12], [0, 7, 7.01, 12], [0, 5, 7, 12], [0, 3, 7, 12], [0, 3, 7, 10], [0, 3, 10, 14],
  [0, 3, 10, 17], [0, 2, 9, 16], [0, 4, 11, 14], [0, 4, 7, 11], [0, 4, 7, 12],
];

class PlChordBank {
  constructor() {
    this.ratios = new Float64Array(PL_CHORDS.length * PL_CHORD_NOTES);
    this.noteCount = new Int32Array(PL_CHORDS.length);
    this.sortedRatios = new Float64Array(PL_CHORD_NOTES);
    this.quantizer = new PlHysteresisQuantizer(PL_CHORDS.length, 0.075, false);
  }
  reset() {
    PL_CHORDS.forEach((chord, i) => {
      let count = 0;
      chord.forEach((st, j) => {
        this.ratios[i * PL_CHORD_NOTES + j] = plSemitonesToRatio(st);
        if (st !== 0.01 && st !== 7.01 && st !== 11.99 && st !== 12) count++;
      });
      this.noteCount[i] = count;
    });
  }
  setChord(parameter) { this.quantizer.process(parameter * 1.02); }
  chordIndex() { return this.quantizer.quantizedValue; }
  // fills ratios and amplitudes for the five voices; returns which voices go to AUX
  computeChordInversion(inversion, ratios, amplitudes) {
    const base = this.chordIndex() * PL_CHORD_NOTES;
    inversion = inversion * (PL_CHORD_NOTES * PL_CHORD_VOICES);
    const ii = inversion | 0, fi = inversion - ii;
    const numRotations = (ii / PL_CHORD_NOTES) | 0, rotatedNote = ii % PL_CHORD_NOTES;
    const kBaseGain = 0.25;
    let mask = 0;
    for (let i = 0; i < PL_CHORD_NOTES; i++) {
      const transposition = 0.25 * (1 << (((PL_CHORD_NOTES - 1 + ii - i) / PL_CHORD_NOTES) | 0));
      const target = (i - numRotations + PL_CHORD_VOICES) % PL_CHORD_VOICES;
      const previous = (target - 1 + PL_CHORD_VOICES) % PL_CHORD_VOICES;
      if (i === rotatedNote) {
        ratios[target] = this.ratios[base + i] * transposition;
        ratios[previous] = ratios[target] * 2;
        amplitudes[previous] = kBaseGain * fi;
        amplitudes[target] = kBaseGain * (1 - fi);
      } else if (i < rotatedNote) {
        ratios[previous] = this.ratios[base + i] * transposition;
        amplitudes[previous] = kBaseGain;
      } else {
        ratios[target] = this.ratios[base + i] * transposition;
        amplitudes[target] = kBaseGain;
      }
      if (i === 0) {
        if (i >= rotatedNote) mask |= 1 << target;
        if (i <= rotatedNote) mask |= 1 << previous;
      }
    }
    return mask;
  }
}

const PL_FADE_POINT = [0.55, 0.47, 0.49, 0.51, 0.53];
const PL_REGISTRATIONS = [
  [0, 1, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0], [0.5, 0, 0.5, 0, 0, 0], [0.33, 0, 0.33, 0, 0.33, 0],
  [0.33, 0, 0, 0.33, 0, 0.33], [0.5, 0, 0, 0, 0, 0.5], [0, 0.5, 0, 0, 0, 0.5], [0, 0.1, 0.1, 0, 0.2, 0.6],
];
const PL_CHORD_WAVES = Int32Array.from([
  [2, 6, 1], [2, 6, 6], [2, 6, 4], [0, 6, 0], [0, 6, 1], [0, 6, 2], [0, 6, 7], [2, 4, 7], [2, 4, 6], [2, 4, 5],
  [2, 4, 4], [2, 4, 3], [2, 4, 2], [2, 4, 1], [2, 4, 0],
], ([bank, row, column]) => (bank * 64 + row * 8 + column) * 132);

class PlChordEngine {
  constructor() {
    this.divideDownVoice = Array.from({ length: PL_CHORD_VOICES }, () => new PlStringSynthOscillator());
    this.wavetableVoice = Array.from({ length: PL_CHORD_VOICES }, () => new PlWavetableOscillator(128, 15));
    this.chords = new PlChordBank();
    this.morphLp = 0; this.timbreLp = 0;
    this.harmonics = new Float64Array(PL_CHORD_HARMONICS * 2 + 2);
    this.ratios = new Float64Array(PL_CHORD_VOICES);
    this.noteAmplitudes = new Float64Array(PL_CHORD_VOICES);
  }

  reset() { this.chords.reset(); }

  render(p, out, aux, size) {
    this.morphLp += 0.1 * (p.morph - this.morphLp);
    this.timbreLp += 0.1 * (p.timbre - this.timbreLp);
    this.chords.setChord(p.harmonics);
    const harmonics = this.harmonics;
    let registration = Math.max(1 - this.morphLp * 2.15, 0) * (PL_REGISTRATIONS.length - 1.001);
    const ri = registration | 0, rf = registration - ri;
    for (let i = 0; i < PL_CHORD_HARMONICS * 2; i++) {
      const a = PL_REGISTRATIONS[ri][i], b = PL_REGISTRATIONS[ri + 1][i];
      harmonics[i] = a + (b - a) * rf;
    }
    harmonics[PL_CHORD_HARMONICS * 2] = 0;
    const auxMask = this.chords.computeChordInversion(this.timbreLp, this.ratios, this.noteAmplitudes);
    out.fill(0, 0, size);
    aux.fill(0, 0, size);
    const f0 = plNoteToFrequency(p.note) * 0.998;
    const waveform = Math.max((this.morphLp - 0.535) * 2.15, 0);
    for (let note = 0; note < PL_CHORD_VOICES; note++) {
      const wavetableAmount = plConstrain(50 * (this.morphLp - PL_FADE_POINT[note]), 0, 1);
      let divideDownAmount = 1 - wavetableAmount;
      const destination = (1 << note) & auxMask ? aux : out;
      const noteF0 = f0 * this.ratios[note];
      divideDownAmount *= plConstrain(4 - noteF0 * 32, 0, 1);
      if (wavetableAmount) {
        this.wavetableVoice[note].render(noteF0 * 1.004, this.noteAmplitudes[note] * wavetableAmount, waveform,
          PL_INTEGRATED_WAVES, PL_CHORD_WAVES, destination, size);
      }
      if (divideDownAmount) {
        this.divideDownVoice[note].render(noteF0, harmonics, this.noteAmplitudes[note] * divideDownAmount, destination, size);
      }
    }
    for (let i = 0; i < size; i++) { out[i] += aux[i]; aux[i] *= 3; }
    return false;
  }
}

// ---- 8: speech (speech_engine.cc and plaits/dsp/speech/*)
// HARMONICS: a formant synth fading into SAM, then an LPC synth (Speak & Spell style) fading into SAM, then four
// banks of LPC words. MORPH: the vowel, or which word; TIMBRE: the formants' shift (and so the speed of words).
// AUX: the excitation, before the formants.

// naive_speech_synth.cc: five formants per phoneme and register, [frequency, amplitude] as notes and /256
const PL_NAIVE_PHONEMES = [
  [[[74, 255], [83, 114], [97, 90], [98, 90], [100, 25]], [[75, 255], [84, 128], [100, 114], [101, 101], [103, 20]], [[76, 255], [85, 128], [100, 18], [102, 16], [104, 3]], [[79, 255], [85, 161], [101, 25], [104, 4], [110, 0]], [[79, 255], [85, 128], [101, 6], [106, 25], [110, 0]]],
  [[[67, 255], [91, 64], [98, 90], [101, 64], [102, 32]], [[67, 255], [92, 51], [99, 64], [103, 51], [105, 25]], [[69, 255], [93, 51], [100, 32], [102, 25], [103, 25]], [[67, 255], [91, 16], [100, 8], [103, 4], [110, 0]], [[65, 255], [95, 25], [101, 45], [105, 2], [110, 0]]],
  [[[59, 255], [92, 8], [99, 40], [102, 20], [104, 10]], [[61, 255], [94, 45], [101, 32], [103, 25], [105, 8]], [[60, 255], [93, 16], [101, 16], [104, 4], [105, 4]], [[65, 255], [92, 25], [100, 8], [105, 4], [110, 0]], [[60, 255], [96, 64], [101, 12], [106, 12], [110, 1]]],
  [[[67, 255], [78, 72], [98, 22], [99, 25], [101, 2]], [[67, 255], [79, 80], [99, 64], [101, 64], [102, 12]], [[68, 255], [79, 80], [100, 12], [102, 20], [103, 5]], [[69, 255], [79, 90], [101, 40], [104, 10], [110, 0]], [[69, 255], [79, 72], [101, 20], [106, 20], [110, 0]]],
  [[[65, 255], [74, 25], [98, 6], [100, 10], [101, 4]], [[65, 255], [74, 25], [100, 36], [101, 51], [103, 12]], [[66, 255], [75, 25], [100, 18], [102, 8], [104, 5]], [[63, 255], [77, 64], [99, 8], [104, 2], [110, 0]], [[63, 255], [77, 40], [100, 4], [106, 2], [110, 0]]],
];

class PlNaiveSpeechSynth {
  constructor() {
    this.pulse = new PlOscillator();
    this.clickDuration = 0;
    this.filter = Array.from({ length: 5 }, () => new PlSvf());
    this.pulseColoration = new PlSvf();
    this.pulseColoration.setFQ(PL_FREQ_DIRTY, 800 / PL_SAMPLE_RATE, 0.5);
  }
  render(click, frequency, phoneme, register, temp, excitation, output, size) {
    if (click) this.clickDuration = (PL_SAMPLE_RATE * 0.05) | 0;
    this.clickDuration -= Math.min(this.clickDuration, size);
    if (this.clickDuration) frequency *= 0.5;
    this.pulse.render(PL_SHAPE_IMPULSE_TRAIN, frequency, 0.5, excitation, size);
    this.pulseColoration.processBuffer(PL_BAND_PASS, excitation, excitation, size);
    for (let i = 0; i < size; i++) excitation[i] *= 4;
    const pv = phoneme * (5 - 1.001), rv = register * (5 - 1.001);
    const pi = pv | 0, pf = pv - pi, ri = rv | 0, rf = rv - ri;
    output.fill(0, 0, size);
    for (let i = 0; i < 5; i++) {
      const p0r0 = PL_NAIVE_PHONEMES[pi][ri][i], p0r1 = PL_NAIVE_PHONEMES[pi][ri + 1][i];
      const p1r0 = PL_NAIVE_PHONEMES[pi + 1][ri][i], p1r1 = PL_NAIVE_PHONEMES[pi + 1][ri + 1][i];
      const f0 = p0r0[0] + (p0r1[0] - p0r0[0]) * rf, f1 = p1r0[0] + (p1r1[0] - p1r0[0]) * rf;
      let f = f0 + (f1 - f0) * pf;
      const a0v = p0r0[1] + (p0r1[1] - p0r0[1]) * rf, a1v = p1r0[1] + (p1r1[1] - p1r0[1]) * rf;
      const a = (a0v + (a1v - a0v) * pf) / 256;
      if (f >= 160) f = 160;
      f = PL_A0 * plSemitonesToRatio(f - 33);
      if (this.clickDuration && i === 0) f *= 0.5;
      this.filter[i].setFQ(PL_FREQ_DIRTY, f, 20);
      this.filter[i].processAdd(PL_BAND_PASS, excitation, output, size, a);
    }
  }
}

// sam_speech_synth.cc: three sine formants reset every pitch period, as SAM on the C64
const PL_SAM_PHONEMES = [
  [[60, 15], [90, 13], [200, 1]], [[40, 13], [114, 12], [139, 6]], [[33, 14], [155, 12], [209, 7]], [[22, 13], [189, 10], [247, 8]],
  [[51, 15], [99, 12], [195, 1]], [[29, 13], [65, 8], [180, 0]], [[13, 12], [103, 3], [182, 0]], [[20, 15], [114, 3], [213, 0]],
  [[13, 7], [164, 3], [222, 14]], [[13, 9], [121, 9], [254, 0]], [[40, 12], [112, 10], [114, 5]], [[24, 13], [54, 8], [157, 0]],
  [[33, 14], [155, 12], [166, 7]], [[36, 14], [83, 8], [249, 1]], [[40, 14], [114, 12], [139, 6]], [[13, 5], [58, 5], [182, 5]],
  [[13, 7], [164, 10], [222, 14]], [[13, 7], [164, 10], [222, 14]],
];
const PL_SAM_AMPLITUDE = [0.03125, 0.03756299, 0.04515131, 0.05427259, 0.06523652, 0.07841532, 0.09425646, 0.11329776,
  0.1361857, 0.16369736, 0.19676682, 0.23651683, 0.28429697, 0.34172946, 0.41076422, 0.49374509];
const PL_SAM_VOWELS = 9, PL_SAM_CONSONANTS = 8;

class PlSAMSpeechSynth {
  constructor() {
    this.phase = 0; this.frequency = 0; this.pulseNextSample = 0; this.pulseLp = 0;
    this.formantPhase = new Uint32Array(3); this.consonantSamples = 0; this.consonantIndex = 0;
    this.formantFrequency = new Uint32Array(3); this.formantAmplitude = new Float64Array(3);
  }
  interpolate(phoneme, formantShift) {
    const pi = phoneme | 0, pf = phoneme - pi;
    const p1 = PL_SAM_PHONEMES[pi], p2 = PL_SAM_PHONEMES[pi + 1];
    formantShift = 1 + formantShift * 2.5;
    for (let i = 0; i < 3; i++) {
      let f = p1[i][0] + (p2[i][0] - p1[i][0]) * pf;
      f *= 8 * formantShift * 4294967296 / PL_SAMPLE_RATE;
      this.formantFrequency[i] = f >>> 0;
      const a1 = PL_SAM_AMPLITUDE[p1[i][1]], a2 = PL_SAM_AMPLITUDE[p2[i][1]];
      this.formantAmplitude[i] = a1 + (a2 - a1) * pf;
    }
  }
  render(consonant, frequency, vowel, formantShift, excitation, output, size) {
    if (frequency >= 0.0625) frequency = 0.0625;
    if (consonant) {
      this.consonantSamples = (PL_SAMPLE_RATE * 0.05) | 0;
      const r = ((vowel + 3 * frequency + 7 * formantShift) * 8) | 0;
      this.consonantIndex = r % PL_SAM_CONSONANTS;
    }
    this.consonantSamples -= Math.min(this.consonantSamples, size);
    const phoneme = this.consonantSamples ? this.consonantIndex + PL_SAM_VOWELS : vowel * (PL_SAM_VOWELS - 1.0001);
    this.interpolate(phoneme, formantShift);
    const ff = this.formantFrequency, fa = this.formantAmplitude, fp = this.formantPhase;
    let fv = this.frequency; const df = (frequency - fv) / size;
    let pulseNextSample = this.pulseNextSample;
    for (let n = 0; n < size; n++) {
      let pulseThisSample = pulseNextSample;
      pulseNextSample = 0;
      fv += df;
      const f = fv;
      this.phase += f;
      if (this.phase >= 1) {
        this.phase -= 1;
        const t = this.phase / f;
        fp[0] = t * ff[0]; fp[1] = t * ff[1]; fp[2] = t * ff[2];
        pulseThisSample -= plThisBlepSample(t);
        pulseNextSample -= plNextBlepSample(t);
      } else {
        fp[0] += ff[0]; fp[1] += ff[1]; fp[2] += ff[2];
      }
      pulseNextSample += this.phase;
      const d = pulseThisSample - 0.5 - this.pulseLp;
      this.pulseLp += Math.min(16 * f, 1) * d;
      excitation[n] = d;
      let s = plSineRaw(fp[0]) * fa[0] + plSineRaw(fp[1]) * fa[1] + plSineRaw(fp[2]) * fa[2];
      output[n] = s * (1 - this.phase);
    }
    this.pulseNextSample = pulseNextSample;
    this.frequency = fv;
  }
}

// lpc_speech_synth.cc: a ten-pole lattice filter, excited by a glottal pulse or noise, at 8 kHz
const PL_LPC_ORDER = 10, PL_LPC_DEFAULT_F0 = 100;
// a frame: [energy, period, k0 .. k9] (k0, k1 in 1/32768, the others in 1/128), as in PL_LPC_PHONEMES
class PlLPCSpeechSynth {
  constructor() {
    this.phase = 0; this.frequency = 0.0125; this.noiseEnergy = 0; this.pulseEnergy = 0;
    this.nextSample = 0; this.pulseIndex = 0;
    this.k = new Float64Array(PL_LPC_ORDER); this.s = new Float64Array(PL_LPC_ORDER + 1); this.e = new Float64Array(11);
  }
  // renders one sample into excitation[0] and output[0] (the controller calls it once per 8 kHz tick)
  // the pitch phase is kept in single precision, as on the module: where it wraps picks a step of the glottal pulse
  // (32 a tick), and a drift of a few steps is audible through the lattice
  render(prosodyAmount, pitchShift, out) {
    const fr = Math.fround;
    const baseF0 = fr(PL_LPC_DEFAULT_F0 / 8000);
    const f = plConstrain(fr(fr(baseF0 + fr(fr(this.frequency - baseF0) * prosodyAmount)) * pitchShift), 0, 0.5);
    const pulse = PL_LPC_EXCITATION_PULSE, N = PL_LPC_EXCITATION_PULSE.length;
    let nextSample = this.nextSample;
    this.phase = fr(this.phase + f);
    let thisSample = nextSample;
    nextSample = 0;
    if (this.phase >= 1) {
      this.phase = fr(this.phase - 1);
      const resetTime = fr(this.phase / f);
      const resetSample = (32 * resetTime) | 0;
      let d = 0;
      if (this.pulseIndex < N) {
        this.pulseIndex -= resetSample;
        d = pulse[this.pulseIndex] / 128 * this.pulseEnergy;
      }
      thisSample += -d * plThisBlepSample(resetTime);
      nextSample += -d * plNextBlepSample(resetTime);
      this.pulseIndex = resetSample;
    }
    const e = this.e, k = this.k, s = this.s;
    e[10] = plRandomSample() > 0 ? this.noiseEnergy : -this.noiseEnergy;
    if (this.pulseIndex < N) {
      nextSample += pulse[this.pulseIndex] / 128 * this.pulseEnergy;
      this.pulseIndex += 32;
    }
    e[10] = (e[10] + thisSample) * 1.5;
    for (let i = 9; i >= 0; i--) e[i] = e[i + 1] - k[i] * s[i];
    e[0] = plConstrain(e[0], -2, 2);
    for (let i = 9; i >= 1; i--) s[i] = s[i - 1] + k[i - 1] * e[i - 1];
    s[0] = e[0];
    out[0] = e[10];
    out[1] = e[0];
    this.nextSample = nextSample;
  }
  // frames: a flat Int32Array of 12 values each; frame: where, between two of them
  playFrame(frames, frame, interpolate) {
    const fi = frame | 0;
    const blend = interpolate ? frame - fi : 0;
    // at a blend of 0 the second frame does not count: the original reads past the last phoneme there (unused)
    const a = fi * 12, b = blend === 0 ? a : (fi + 1) * 12;
    const freq1 = frames[a + 1] === 0 ? this.frequency : 1 / frames[a + 1];
    const freq2 = frames[b + 1] === 0 ? this.frequency : 1 / frames[b + 1];
    this.frequency = freq1 + (freq2 - freq1) * blend;
    const e1 = frames[a] / 256, e2 = frames[b] / 256;
    const n1 = frames[a + 1] === 0 ? e1 : 0, n2 = frames[b + 1] === 0 ? e2 : 0;
    this.noiseEnergy = n1 + (n2 - n1) * blend;
    const p1 = frames[a + 1] !== 0 ? e1 : 0, p2 = frames[b + 1] !== 0 ? e2 : 0;
    this.pulseEnergy = p1 + (p2 - p1) * blend;
    for (let i = 0; i < PL_LPC_ORDER; i++) {
      const scale = i < 2 ? 32768 : 128;
      const x = frames[a + 2 + i] / scale, y = frames[b + 2 + i] / scale;
      this.k[i] = x + (y - x) * blend;
    }
  }
}

// lpc_speech_synth_controller.cc: words, from the banks' bit streams into frames
const PL_LPC_ENERGY = [0x00, 0x02, 0x03, 0x04, 0x05, 0x07, 0x0a, 0x0f, 0x14, 0x20, 0x29, 0x39, 0x51, 0x72, 0xa1, 0xff];
const PL_LPC_PERIOD = [0, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
  41, 42, 43, 45, 47, 49, 51, 53, 54, 57, 59, 61, 63, 66, 69, 71, 73, 77, 79, 81, 85, 87, 92, 95, 99, 102, 106, 110, 115,
  119, 123, 128, 133, 138, 143, 149, 154, 160];
const PL_LPC_K = [
  [-32064, -31872, -31808, -31680, -31552, -31424, -31232, -30848, -30592, -30336, -30016, -29696, -29376, -28928, -28480,
    -27968, -26368, -24256, -21632, -18368, -14528, -10048, -5184, 0, 5184, 10048, 14528, 18368, 21632, 24256, 26368, 27968],
  [-20992, -19328, -17536, -15552, -13440, -11200, -8768, -6272, -3712, -1088, 1536, 4160, 6720, 9216, 11584, 13824, 15936,
    17856, 19648, 21248, 22656, 24000, 25152, 26176, 27072, 27840, 28544, 29120, 29632, 30080, 30464, 32384],
  [-110, -97, -83, -70, -56, -43, -29, -16, -2, 11, 25, 38, 52, 65, 79, 92],
  [-82, -68, -54, -40, -26, -12, 1, 15, 29, 43, 57, 71, 85, 99, 113, 126],
  [-82, -70, -59, -47, -35, -24, -12, -1, 11, 23, 34, 46, 57, 69, 81, 92],
  [-64, -53, -42, -31, -20, -9, 3, 14, 25, 36, 47, 58, 69, 80, 91, 102],
  [-77, -65, -53, -41, -29, -17, -5, 7, 19, 31, 43, 55, 67, 79, 90, 102],
  [-64, -40, -16, 7, 31, 55, 79, 102],
  [-64, -44, -24, -4, 16, 37, 57, 77],
  [-51, -33, -15, 4, 22, 32, 59, 77],
];
const PL_LPC_K_BITS = [5, 5, 4, 4, 4, 4, 4, 3, 3, 3];
const PL_WORD_BANKS = [PL_WORD_BANK_0, PL_WORD_BANK_1, PL_WORD_BANK_2, PL_WORD_BANK_3, PL_WORD_BANK_4];
const PL_LPC_MAX_WORDS = 32, PL_LPC_MAX_FRAMES = 1024, PL_LPC_VOWELS = 5, PL_LPC_CONSONANTS = 10, PL_LPC_FPS = 40;

class PlBitStream {
  constructor(data, at) { this.data = data; this.p = at; this.available = 0; this.bits = 0; }
  static reverse(b) {
    b = ((b >> 4) | (b << 4)) & 0xff;
    b = (((b & 0xcc) >> 2) | ((b & 0x33) << 2)) & 0xff;
    return (((b & 0xaa) >> 1) | ((b & 0x55) << 1)) & 0xff;
  }
  getBits(n) {
    let shift = n;
    if (n > this.available) {
      this.bits = (this.bits << this.available) & 0xffff;
      shift -= this.available;
      this.bits |= PlBitStream.reverse(this.data[this.p++]);
      this.available += 8;
    }
    this.bits = (this.bits << shift) & 0xffff;
    const result = (this.bits >> 8) & 0xff;
    this.bits &= 0xff;
    this.available -= n;
    return result;
  }
  flush() { while (this.available) this.getBits(1); }
}

class PlLPCWordBank {
  constructor() {
    this.frames = new Int32Array(PL_LPC_MAX_FRAMES * 12);
    this.wordBoundaries = new Int32Array(PL_LPC_MAX_WORDS);
    this.reset();
  }
  reset() { this.loadedBank = -1; this.numFrames = 0; this.numWords = 0; this.wordBoundaries.fill(0); }
  loadNextWord(data, at) {
    const bs = new PlBitStream(data, at);
    const frame = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (;;) {
      const energy = bs.getBits(4);
      if (energy === 0) frame[0] = 0;
      else if (energy === 0xf) { bs.flush(); break; }
      else {
        frame[0] = PL_LPC_ENERGY[energy];
        const repeat = bs.getBits(1);
        frame[1] = PL_LPC_PERIOD[bs.getBits(6)];
        if (!repeat) {
          const last = frame[1] ? 10 : 4;
          for (let i = 0; i < last; i++) frame[2 + i] = PL_LPC_K[i][bs.getBits(PL_LPC_K_BITS[i])];
        }
      }
      this.frames.set(frame, this.numFrames++ * 12);
    }
    return bs.p - at;
  }
  load(bank) {
    if (bank === this.loadedBank || bank >= PL_WORD_BANKS.length) return false;
    this.numFrames = 0; this.numWords = 0;
    const data = PL_WORD_BANKS[bank];
    let at = 0;
    while (at < data.length) {
      this.wordBoundaries[this.numWords] = this.numFrames;
      at += this.loadNextWord(data, at);
      this.numWords++;
    }
    this.wordBoundaries[this.numWords] = this.numFrames;
    this.loadedBank = bank;
    return true;
  }
  // [first frame, last frame] of the word at address 0..1
  wordBoundariesAt(address, out) {
    if (this.numWords === 0) { out[0] = out[1] = -1; return; }
    let word = (address * this.numWords) | 0;
    if (word >= this.numWords) word = this.numWords - 1;
    out[0] = this.wordBoundaries[word];
    out[1] = this.wordBoundaries[word + 1] - 1;
  }
}

class PlLPCSpeechSynthController {
  constructor(wordBank) {
    this.wordBank = wordBank;
    this.clockPhase = 0; this.playbackFrame = -1; this.lastPlaybackFrame = -1; this.remainingFrameSamples = 0;
    this.sample = [0, 0]; this.nextSample = [0, 0]; this.gain = 0;
    this.synth = new PlLPCSpeechSynth();
    this.newSample = [0, 0]; this.bounds = [0, 0];
  }
  render(freeRunning, trigger, bank, frequency, prosodyAmount, speed, address, formantShift, gain, excitation, output, size) {
    const fr = Math.fround;
    const rateRatio = fr(plSemitonesToRatio(fr(fr(formantShift - 0.5) * 36)));
    // the synth runs at 8 kHz (the module's 48 kHz / 6), whatever the rate here; in single precision, as above
    const rate = fr(rateRatio * fr(8000 / PL_SAMPLE_RATE));
    const pitchShift = fr(frequency / fr(fr(rateRatio * PL_LPC_DEFAULT_F0) / fr(55 / PL_A0)));
    const timeStretch = plSemitonesToRatio(-speed * 24
      + (formantShift < 0.4 ? (formantShift - 0.4) * -45 : formantShift > 0.6 ? (formantShift - 0.6) * -45 : 0));
    if (bank !== -1 && this.wordBank.load(bank)) { this.playbackFrame = -1; this.lastPlaybackFrame = -1; }
    // a word still playing when HARMONICS drops back to the vowels would go on past the 15 phoneme frames (in the
    // original, reading whatever memory follows them): here it goes back to scanning the vowels
    if (bank === -1 && this.playbackFrame >= PL_LPC_VOWELS + PL_LPC_CONSONANTS) { this.playbackFrame = -1; this.lastPlaybackFrame = -1; }
    const numFrames = bank === -1 ? PL_LPC_VOWELS : this.wordBank.numFrames;
    const frames = bank === -1 ? PL_LPC_PHONEMES : this.wordBank.frames;
    if (trigger) {
      if (bank === -1) {
        const r = ((address + 3 * formantShift + 7 * frequency) * 8) | 0;
        this.playbackFrame = (r % PL_LPC_CONSONANTS) + PL_LPC_VOWELS;
        this.lastPlaybackFrame = this.playbackFrame + 1;
      } else {
        this.wordBank.wordBoundariesAt(address, this.bounds);
        this.playbackFrame = this.bounds[0]; this.lastPlaybackFrame = this.bounds[1];
      }
      this.remainingFrameSamples = 0;
    }
    if (this.playbackFrame === -1 && this.remainingFrameSamples === 0) {
      this.synth.playFrame(frames, address * (numFrames - 1.0001), true);
    } else {
      if (this.remainingFrameSamples === 0) {
        this.synth.playFrame(frames, this.playbackFrame, false);
        this.remainingFrameSamples = Math.max(0, (PL_SAMPLE_RATE / PL_LPC_FPS * timeStretch) >>> 0);
        this.playbackFrame++;
        if (this.playbackFrame >= this.lastPlaybackFrame) {
          this.playbackFrame = bank === -1 || freeRunning ? -1 : this.lastPlaybackFrame;
        }
      }
      this.remainingFrameSamples -= Math.min(size, this.remainingFrameSamples);
    }
    let gv = this.gain; const dg = (gain - gv) / size;
    const smp = this.sample, nxt = this.nextSample, ns = this.newSample;
    for (let n = 0; n < size; n++) {
      const t0 = nxt[0], t1 = nxt[1];
      let this0 = t0, this1 = t1;
      nxt[0] = 0; nxt[1] = 0;
      this.clockPhase = fr(this.clockPhase + rate);
      if (this.clockPhase >= 1) {
        this.clockPhase = fr(this.clockPhase - 1);
        const resetTime = this.clockPhase / rate;
        this.synth.render(prosodyAmount, pitchShift, ns);
        const d0 = ns[0] - smp[0], d1 = ns[1] - smp[1];
        this0 += d0 * plThisBlepSample(resetTime); nxt[0] += d0 * plNextBlepSample(resetTime);
        this1 += d1 * plThisBlepSample(resetTime); nxt[1] += d1 * plNextBlepSample(resetTime);
        smp[0] = ns[0]; smp[1] = ns[1];
      }
      nxt[0] += smp[0]; nxt[1] += smp[1];
      gv += dg;
      excitation[n] = this0 * gv;
      output[n] = this1 * gv;
    }
    this.gain = gv;
  }
}

class PlSpeechEngine {
  constructor() {
    this.sam = new PlSAMSpeechSynth();
    this.naive = new PlNaiveSpeechSynth();
    this.wordBank = new PlLPCWordBank();
    this.lpc = new PlLPCSpeechSynthController(this.wordBank);
    this.wordBankQuantizer = new PlHysteresisQuantizer(PL_WORD_BANKS.length + 1, 0.1, false);
    this.temp = [new Float32Array(PL_MAX_BLOCK), new Float32Array(PL_MAX_BLOCK)];
    this.prosodyAmount = 0; this.speed = 0;
  }

  reset() { this.wordBank.reset(); }

  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const group = p.harmonics * 6;
    // as in the original, the formant and SAM synths click on a bare rising edge, which the module never sends
    const click = p.trigger === PL_TRIGGER_RISING_EDGE;
    if (group <= 2) {
      let blend = group;
      if (group <= 1) {
        this.naive.render(click, f0, p.morph, p.timbre, this.temp[0], aux, out, size);
      } else {
        this.lpc.render(p.trigger & PL_TRIGGER_UNPATCHED, p.trigger & PL_TRIGGER_RISING_EDGE, -1, f0, 0, 0, p.morph, p.timbre, 1, aux, out, size);
        blend = 2 - blend;
      }
      this.sam.render(click, f0, p.morph, p.timbre, this.temp[0], this.temp[1], size);
      blend *= blend * (3 - 2 * blend);
      blend *= blend * (3 - 2 * blend);
      const t0 = this.temp[0], t1 = this.temp[1];
      for (let i = 0; i < size; i++) { aux[i] += (t0[i] - aux[i]) * blend; out[i] += (t1[i] - out[i]) * blend; }
      return false;
    }
    const f = Math.fround;
    const wordBank = this.wordBankQuantizer.process(f(f(f(f(p.harmonics) * 6) - 2) * f(0.275))) - 1;
    const replayProsody = wordBank >= 0 && !(p.trigger & PL_TRIGGER_UNPATCHED);
    this.lpc.render(p.trigger & PL_TRIGGER_UNPATCHED, p.trigger & PL_TRIGGER_RISING_EDGE, wordBank, f0,
      this.prosodyAmount, this.speed, p.morph, p.timbre, replayProsody ? p.accent : 1, aux, out, size);
    return replayProsody;
  }
}

// ---- 9: swarm (swarm_engine.h, .cc)
// Eight sawtooths (OUT) and sines (AUX), each moved in pitch by a grain envelope: TIMBRE how often, MORPH how long
// the grains last (from glides to drones), HARMONICS how far they spread. On a trigger, a burst.
class PlGrainEnvelope {
  constructor() { this.from = 0; this.interval = 1; this.phase = 1; this.fm = 0; this.amplitude = 0.5; this.previousSizeRatio = 0; this.filterCoefficient = 0; }
  step(rate, burstMode, startBurst) {
    let randomize = false;
    if (startBurst) { this.phase = 0.5; this.fm = 16; randomize = true; }
    else {
      this.phase += rate * this.fm;
      if (this.phase >= 1) { this.phase -= this.phase | 0; randomize = true; }
    }
    if (randomize) {
      this.from += this.interval;
      this.interval = plRandomFloat() - this.from;
      if (burstMode) this.fm *= 0.8 + 0.2 * plRandomFloat();
      else this.fm = 0.5 + 1.5 * plRandomFloat();
    }
  }
  frequency(sizeRatio) { return sizeRatio < 1 ? 2 * (this.from + this.interval * this.phase) - 1 : this.from; }
  amplitudeAt(sizeRatio) {
    let target = 1;
    if (sizeRatio >= 1) {
      const phase = plConstrain((this.phase - 0.5) * sizeRatio, -1, 1);
      target = 0.5 * (plSine(0.5 * phase + 1.25) + 1);
    }
    if ((sizeRatio >= 1) !== (this.previousSizeRatio >= 1)) this.filterCoefficient = 0.5;
    this.filterCoefficient *= 0.95;
    this.previousSizeRatio = sizeRatio;
    this.amplitude += (0.5 - this.filterCoefficient) * (target - this.amplitude);
    return this.amplitude;
  }
}

class PlAdditiveSawOscillator {
  constructor() { this.phase = 0; this.nextSample = 0; this.frequency = 0.01; this.gain = 0; }
  // adds into out
  render(frequency, level, out, size) {
    if (frequency >= PL_MAX_FREQUENCY) frequency = PL_MAX_FREQUENCY;
    let fv = this.frequency; const df = (frequency - fv) / size;
    let gv = this.gain; const dg = (level - gv) / size;
    let nextSample = this.nextSample, phase = this.phase;
    for (let n = 0; n < size; n++) {
      let thisSample = nextSample;
      nextSample = 0;
      fv += df;
      phase += fv;
      if (phase >= 1) {
        phase -= 1;
        const t = phase / fv;
        thisSample -= plThisBlepSample(t);
        nextSample -= plNextBlepSample(t);
      }
      nextSample += phase;
      gv += dg;
      out[n] += (2 * thisSample - 1) * gv;
    }
    this.phase = phase; this.nextSample = nextSample; this.frequency = fv; this.gain = gv;
  }
}

const PL_SWARM_VOICES = 8;
class PlSwarmVoice {
  constructor(rank) {
    this.rank = rank;
    this.envelope = new PlGrainEnvelope();
    this.saw = new PlAdditiveSawOscillator();
    this.sine = new PlFastSineOscillator();
  }
  render(f0, density, burstMode, startBurst, spread, sizeRatio, saw, sine, size) {
    this.envelope.step(density, burstMode, startBurst);
    const amplitude = this.envelope.amplitudeAt(sizeRatio) * (1 / PL_SWARM_VOICES);
    const expo = this.envelope.frequency(sizeRatio);
    f0 *= plSemitonesToRatio(48 * expo * spread * this.rank);
    f0 *= 1 + this.rank * (this.rank + 0.01) * spread * 0.25;
    this.saw.render(f0, amplitude, saw, size);
    this.sine.renderAdd(f0, amplitude, sine, size);
  }
}

class PlSwarmEngine {
  constructor() { this.voices = []; }
  reset() {
    const n = (PL_SWARM_VOICES - 1) >> 1;
    this.voices = Array.from({ length: PL_SWARM_VOICES }, (_, i) => new PlSwarmVoice((i - n) / n));
  }
  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const density = plNoteToFrequency(p.timbre * 120) * 0.025 * size;
    const spread = p.harmonics * p.harmonics * p.harmonics;
    let sizeRatio = 0.25 * plSemitonesToRatio((1 - p.morph) * 84);
    const burstMode = !(p.trigger & PL_TRIGGER_UNPATCHED);
    const startBurst = !!(p.trigger & PL_TRIGGER_RISING_EDGE);
    out.fill(0, 0, size);
    aux.fill(0, 0, size);
    for (const v of this.voices) {
      v.render(f0, density, burstMode, startBurst, spread, sizeRatio, out, aux, size);
      sizeRatio *= 0.97;
    }
    return false;
  }
}

// ---- 10: filtered noise (noise_engine.cc)
// Clocked noise (TIMBRE: the clock), through a low-pass to high-pass filter (HARMONICS: its mode, MORPH: its Q) to
// OUT; AUX: through two band-passes, the second's frequency set by HARMONICS against the first.
class PlNoiseEngine {
  constructor() {
    this.clockedNoise = [new PlClockedNoise(), new PlClockedNoise()];
    this.lpHpFilter = new PlSvf();
    this.bpFilter = [new PlSvf(), new PlSvf()];
    this.previousF0 = 0; this.previousF1 = 0; this.previousQ = 0; this.previousMode = 0;
    this.temp = new Float32Array(PL_MAX_BLOCK);
    this.one = new Float32Array(1); this.oneOut = new Float32Array(1);
  }
  reset() {}
  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const f1 = plNoteToFrequency(p.note + p.harmonics * 48 - 24);
    const clockLowestNote = p.trigger & PL_TRIGGER_UNPATCHED ? 0 : -24;
    const clockF = plNoteToFrequency(p.timbre * (128 - clockLowestNote) + clockLowestNote);
    const q = 0.5 * plSemitonesToRatio(p.morph * 120);
    const sync = !!(p.trigger & PL_TRIGGER_RISING_EDGE);
    this.clockedNoise[0].render(sync, clockF, aux, size);
    this.clockedNoise[1].render(sync, clockF * f1 / f0, this.temp, size);
    let a = this.previousF0; const da = (f0 - a) / size;
    let b = this.previousF1; const db = (f1 - b) / size;
    let qv = this.previousQ; const dq = (q - qv) / size;
    let mv = this.previousMode; const dm = (p.harmonics - mv) / size;
    for (let n = 0; n < size; n++) {
      a += da; b += db; qv += dq; mv += dm;
      const gain = 1 / Math.sqrt((0.5 + qv) * 40 * a);
      this.lpHpFilter.setFQ(PL_FREQ_ACCURATE, a, qv);
      this.bpFilter[0].setFQ(PL_FREQ_ACCURATE, a, qv);
      this.bpFilter[1].setFQ(PL_FREQ_ACCURATE, b, qv);
      const in1 = aux[n] * gain, in2 = this.temp[n] * gain;
      this.one[0] = in1;
      this.lpHpFilter.processMultimodeLPtoHP(this.one, this.oneOut, 1, mv);
      out[n] = this.oneOut[0];
      aux[n] = this.bpFilter[0].process(PL_BAND_PASS, in1) + this.bpFilter[1].process(PL_BAND_PASS, in2);
    }
    this.previousF0 = a; this.previousF1 = b; this.previousQ = qv; this.previousMode = mv;
    return false;
  }
}

// ---- 11: particles (particle_engine.cc)
// Six streams of random impulses (TIMBRE: how many) through band-passes at random pitches (HARMONICS: how far they
// spread); MORPH: to the left, a diffuser smears them; to the right, the filters ring. AUX: the bare impulses.
const PL_PARTICLES = 6;
class PlParticleEngine {
  constructor() {
    this.particles = Array.from({ length: PL_PARTICLES }, () => new PlParticle());
    this.diffuser = new PlDiffuser();
    this.postFilter = new PlSvf();
  }
  reset() { this.diffuser.reset(); }
  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const densitySqrt = plNoteToFrequency(60 + p.timbre * p.timbre * 72);
    const density = densitySqrt * densitySqrt * (1 / PL_PARTICLES);
    const gain = 1 / density;
    const qSqrt = plSemitonesToRatio(p.morph >= 0.5 ? (p.morph - 0.5) * 120 : 0);
    const q = 0.5 + qSqrt * qSqrt;
    const spread = 48 * p.harmonics * p.harmonics;
    const rawSqrt = 2 * Math.abs(p.morph - 0.5);
    const diffusion = p.morph < 0.5 ? rawSqrt * rawSqrt : 0;
    const sync = !!(p.trigger & PL_TRIGGER_RISING_EDGE);
    out.fill(0, 0, size);
    aux.fill(0, 0, size);
    for (const particle of this.particles) particle.render(sync, density, gain, f0, spread, q, out, aux, size);
    this.postFilter.setFQ(PL_FREQ_DIRTY, Math.min(f0, 0.49), 0.5);
    this.postFilter.processBuffer(PL_LOW_PASS, out, out, size);
    this.diffuser.process(0.8 * diffusion * diffusion, 0.5 * diffusion + 0.25, out, size);
    return false;
  }
}

// ---- 12: string (string_engine.cc)
// Three strings in turn, each trigger plucking the next (the last keeps ringing). HARMONICS: the structure (a curved
// bridge, then dispersion), TIMBRE: brightness, MORPH: damping. AUX: the excitation.
const PL_NUM_STRINGS = 3;
class PlStringEngine {
  constructor() {
    this.voices = Array.from({ length: PL_NUM_STRINGS }, () => new PlStringVoice());
    this.f0 = new Float64Array(PL_NUM_STRINGS).fill(0.01);
    this.activeString = PL_NUM_STRINGS - 1;
    this.f0Delay = new PlDelayLine(16);
    this.temp = new Float32Array(PL_MAX_BLOCK);
  }
  reset() { this.f0Delay.reset(); for (const v of this.voices) v.reset(); }
  render(p, out, aux, size) {
    if (p.trigger & PL_TRIGGER_RISING_EDGE) {
      this.f0[this.activeString] = this.f0Delay.read(14);
      this.activeString = (this.activeString + 1) % PL_NUM_STRINGS;
    }
    const f0 = plNoteToFrequency(p.note);
    this.f0[this.activeString] = f0;
    this.f0Delay.write(f0);
    out.fill(0, 0, size);
    aux.fill(0, 0, size);
    for (let i = 0; i < PL_NUM_STRINGS; i++) {
      this.voices[i].render(!!(p.trigger & PL_TRIGGER_UNPATCHED) && i === this.activeString,
        !!(p.trigger & PL_TRIGGER_RISING_EDGE) && i === this.activeString,
        p.accent, this.f0[i], p.harmonics, p.timbre * p.timbre, p.morph, this.temp, out, aux, size);
    }
    return true;
  }
}

// ---- 13: modal resonator (modal_engine.cc)
// A bank of 24 resonant modes struck by an impulse. HARMONICS: the structure (from a stiff bar's inharmonic modes
// through a string's to a bell's), TIMBRE: brightness, MORPH: damping. AUX: the excitation.
class PlModalEngine {
  constructor() { this.voice = new PlModalVoice(); this.harmonicsLp = 0; this.temp = new Float32Array(PL_MAX_BLOCK); this.reset(); }
  reset() { this.voice.init(); }
  render(p, out, aux, size) {
    out.fill(0, 0, size);
    aux.fill(0, 0, size);
    this.harmonicsLp += 0.01 * (p.harmonics - this.harmonicsLp);
    this.voice.render(!!(p.trigger & PL_TRIGGER_UNPATCHED), !!(p.trigger & PL_TRIGGER_RISING_EDGE), p.accent,
      plNoteToFrequency(p.note), this.harmonicsLp, p.timbre, p.morph, this.temp, out, aux, size);
    return true;
  }
}

// ---- the drums (plaits/dsp/drums/*, plaits/dsp/fx/overdrive.h). The engines use the trigger: unpatched (here,
// never), each sustains instead of striking.
function plDiode(x) { if (x >= 0) return x; x *= 2; return 0.7 * x / (1 + Math.abs(x)); }

class PlOverdrive {
  constructor() { this.preGain = 0; this.postGain = 0; }
  process(drive, buf, size) {
    const d2 = drive * drive, a = drive * 0.5, b = d2 * d2 * drive * 24;
    const preGain = a + (b - a) * d2;
    const squashed = drive * (2 - drive);
    const postGain = 1 / plSoftClip(0.33 + squashed * (preGain - 0.33));
    let pg = this.preGain; const dpg = (preGain - pg) / size;
    let og = this.postGain; const dog = (postGain - og) / size;
    for (let i = 0; i < size; i++) { pg += dpg; og += dog; buf[i] = plSoftClip(pg * buf[i]) * og; }
    this.preGain = pg; this.postGain = og;
  }
}

// analog_bass_drum.h: a pulse ringing a resonant filter, its pitch pushed by the attack and by its own output
class PlAnalogBassDrum {
  constructor() {
    this.pulseRemaining = 0; this.fmPulseRemaining = 0; this.pulse = 0; this.pulseHeight = 0; this.pulseLp = 0;
    this.fmPulseLp = 0; this.retrigPulse = 0; this.lpOut = 0; this.toneLp = 0; this.sustainGain = 0;
    this.resonator = new PlSvf(); this.oscillator = new PlSineOscillator(); this.pair = [0, 0];
  }
  render(sustain, trigger, accent, f0, tone, decay, attackFmAmount, selfFmAmount, out, size) {
    const SR = PL_SAMPLE_RATE;
    const triggerPulse = (Math.fround(1e-3) * SR) | 0, fmPulse = (Math.fround(6e-3) * SR) | 0;
    const pulseDecay = 0.2e-3 * SR, pulseFilter = 0.1e-3 * SR, retrigDuration = 0.05 * SR;
    const scale = 0.001 / f0;
    const q = 1500 * plSemitonesToRatio(decay * 80);
    const toneF = Math.min(4 * f0 * plSemitonesToRatio(tone * 108), 1);
    const leak = 0.08 * (tone + 0.25);
    if (trigger) { this.pulseRemaining = triggerPulse; this.fmPulseRemaining = fmPulse; this.pulseHeight = 3 + 7 * accent; this.lpOut = 0; }
    let sg = this.sustainGain; const dsg = (accent * decay - sg) / size;
    for (let n = 0; n < size; n++) {
      let pulse = 0;
      if (this.pulseRemaining) {
        --this.pulseRemaining;
        pulse = this.pulseRemaining ? this.pulseHeight : this.pulseHeight - 1;
        this.pulse = pulse;
      } else {
        this.pulse *= 1 - 1 / pulseDecay;
        pulse = this.pulse;
      }
      if (sustain) pulse = 0;
      this.pulseLp += (1 / pulseFilter) * (pulse - this.pulseLp);
      pulse = plDiode((pulse - this.pulseLp) + pulse * 0.044);
      let fmP = 0;
      if (this.fmPulseRemaining) {
        --this.fmPulseRemaining;
        fmP = 1;
        this.retrigPulse = this.fmPulseRemaining ? 0 : -0.8;
      } else {
        this.retrigPulse *= 1 - 1 / retrigDuration;
      }
      if (sustain) fmP = 0;
      this.fmPulseLp += (1 / pulseFilter) * (fmP - this.fmPulseLp);
      const punch = 0.7 + plDiode(10 * this.lpOut - 1);
      const f = plConstrain(f0 * (1 + this.fmPulseLp * 1.7 * attackFmAmount + punch * 0.08 * selfFmAmount), 0, 0.4);
      let resonatorOut;
      if (sustain) {
        sg += dsg;
        this.oscillator.nextQuadrature(f, sg, this.pair);
        resonatorOut = this.pair[0]; this.lpOut = this.pair[1];
      } else {
        const r = this.resonator;
        r.setFQ(PL_FREQ_DIRTY, f, 1 + q * f);
        const x = (pulse - this.retrigPulse * 0.2) * scale;
        const hp = (x - r.r * r.s1 - r.g * r.s1 - r.s2) * r.h, bp = r.g * hp + r.s1;
        r.s1 = r.g * hp + bp;
        const lp = r.g * bp + r.s2;
        r.s2 = r.g * bp + lp;
        resonatorOut = bp; this.lpOut = lp;
      }
      this.toneLp += toneF * (pulse * leak + resonatorOut - this.toneLp);
      out[n] = this.toneLp;
    }
    this.sustainGain = sg;
  }
}

// synthetic_bass_drum.h: a distorted sine with a pitch envelope, a click and a little noise
class PlSyntheticBassDrumClick {
  constructor() { this.lp = 0; this.hp = 0; this.filter = new PlSvf(); this.filter.setFQ(PL_FREQ_FAST, 5000 / PL_SAMPLE_RATE, 2); }
  process(x) {
    const e = x - this.lp;
    this.lp += (e > 0 ? 0.5 : 0.1) * e;
    this.hp += 0.04 * (this.lp - this.hp);
    return this.filter.process(PL_LOW_PASS, this.lp - this.hp);
  }
}
class PlSyntheticBassDrumAttackNoise {
  constructor() { this.lp = 0; this.hp = 0; }
  render() { const s = plRandomFloat(); this.lp += 0.05 * (s - this.lp); this.hp += 0.005 * (this.lp - this.hp); return this.lp - this.hp; }
}
class PlSyntheticBassDrum {
  constructor() {
    this.phase = 0; this.phaseNoise = 0; this.f0 = 0; this.fm = 0; this.fmLp = 0; this.bodyEnvLp = 0; this.bodyEnv = 0;
    this.transientEnv = 0; this.transientEnvLp = 0; // left unset by the original's Init: zero, as on a fresh start
    this.bodyEnvPulseWidth = 0; this.fmPulseWidth = 0; this.toneLp = 0; this.sustainGain = 0;
    this.click = new PlSyntheticBassDrumClick(); this.noise = new PlSyntheticBassDrumAttackNoise();
  }
  distortedSine(phase, phaseNoise, dirtiness) {
    phase += phaseNoise * dirtiness;
    phase -= phase | 0;
    const triangle = (phase < 0.5 ? phase : 1 - phase) * 4 - 1;
    const sine = 2 * triangle / (1 + Math.abs(triangle));
    return sine + (1 - dirtiness) * (plSine(phase + 0.75) - sine);
  }
  transistorVCA(s, gain) { s = (s - 0.6) * gain; return 3 * s / (2 + Math.abs(s)) + gain * 0.3; }
  render(sustain, trigger, accent, f0, tone, decay, dirtiness, fmEnvelopeAmount, fmEnvelopeDecay, out, size) {
    const SR = PL_SAMPLE_RATE;
    decay *= decay;
    fmEnvelopeDecay *= fmEnvelopeDecay;
    // the pitch steps only on the samples the oscillator moves, as in the original
    let fv = this.f0; const df = (f0 - fv) / size;
    dirtiness *= Math.max(1 - 8 * f0, 0);
    const fmDecay = 1 - 1 / (0.008 * (1 + fmEnvelopeDecay * 4) * SR);
    const bodyEnvDecay = 1 - 1 / (0.02 * SR) * plSemitonesToRatio(-decay * 60);
    const transientEnvDecay = 1 - 1 / (0.005 * SR);
    const toneF = Math.min(4 * f0 * plSemitonesToRatio(tone * 108), 1);
    const transientLevel = tone;
    if (trigger) {
      this.fm = 1;
      this.bodyEnv = this.transientEnv = 0.3 + 0.7 * accent;
      this.bodyEnvPulseWidth = (SR * 0.001) | 0;
      this.fmPulseWidth = (SR * 0.0013) | 0;
    }
    let sg = this.sustainGain; const dsg = (accent * decay - sg) / size;
    for (let n = 0; n < size; n++) {
      this.phaseNoise += 0.002 * (plRandomFloat() - 0.5 - this.phaseNoise);
      let mix = 0;
      if (sustain) {
        fv += df;
        this.phase += fv;
        if (this.phase >= 1) this.phase -= 1;
        sg += dsg;
        mix -= this.transistorVCA(this.distortedSine(this.phase, this.phaseNoise, dirtiness), sg);
      } else {
        if (this.fmPulseWidth) { --this.fmPulseWidth; this.phase = 0.25; }
        else {
          this.fm *= fmDecay;
          const fm = 1 + fmEnvelopeAmount * 3.5 * this.fmLp;
          fv += df;
          this.phase += Math.min(fv * fm, 0.5);
          if (this.phase >= 1) this.phase -= 1;
        }
        if (this.bodyEnvPulseWidth) --this.bodyEnvPulseWidth;
        else { this.bodyEnv *= bodyEnvDecay; this.transientEnv *= transientEnvDecay; }
        this.bodyEnvLp += 0.1 * (this.bodyEnv - this.bodyEnvLp);
        this.transientEnvLp += 0.1 * (this.transientEnv - this.transientEnvLp);
        this.fmLp += 0.1 * (this.fm - this.fmLp);
        const body = this.distortedSine(this.phase, this.phaseNoise, dirtiness);
        const transient = this.click.process(this.bodyEnvPulseWidth ? 0 : 1) + this.noise.render();
        mix -= this.transistorVCA(body, this.bodyEnvLp);
        mix -= transient * this.transientEnvLp * transientLevel;
      }
      this.toneLp += toneF * (mix - this.toneLp);
      out[n] = this.toneLp;
    }
    this.f0 = fv; this.sustainGain = sg;
  }
}

// ---- 14: bass drum (bass_drum_engine.cc). OUT: the analog model (HARMONICS: attack FM, self FM, then drive);
// AUX: the synthetic one. TIMBRE: tone, MORPH: decay.
class PlBassDrumEngine {
  constructor() { this.analog = new PlAnalogBassDrum(); this.synthetic = new PlSyntheticBassDrum(); this.overdrive = new PlOverdrive(); }
  reset() {}
  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const attackFm = Math.min(p.harmonics * 4, 1);
    const selfFm = Math.max(Math.min(p.harmonics * 4 - 1, 1), 0);
    const drive = Math.max(p.harmonics * 2 - 1, 0) * Math.max(1 - 16 * f0, 0);
    const sustain = !!(p.trigger & PL_TRIGGER_UNPATCHED), trigger = !!(p.trigger & PL_TRIGGER_RISING_EDGE);
    this.analog.render(sustain, trigger, p.accent, f0, p.timbre, p.morph, attackFm, selfFm, out, size);
    this.overdrive.process(0.5 + 0.5 * drive, out, size);
    this.synthetic.render(sustain, trigger, p.accent, f0, p.timbre, p.morph,
      sustain ? p.harmonics : 0.4 - 0.25 * p.morph * p.morph,
      Math.min(p.harmonics * 2, 1), Math.max(p.harmonics * 2 - 1, 0), aux, size);
    return true;
  }
}

// analog_snare_drum.h: five resonant modes of a shell and band-passed noise for the snares
const PL_SNARE_MODES = [1, 2, 3.18, 4.16, 5.62];
class PlAnalogSnareDrum {
  constructor() {
    this.pulseRemaining = 0; this.pulse = 0; this.pulseHeight = 0; this.pulseLp = 0; this.noiseEnvelope = 0; this.sustainGain = 0;
    this.resonator = PL_SNARE_MODES.map(() => new PlSvf());
    this.oscillator = PL_SNARE_MODES.map(() => new PlSineOscillator());
    this.noiseFilter = new PlSvf();
    this.f = new Float64Array(5); this.gain = new Float64Array(5);
  }
  render(sustain, trigger, accent, f0, tone, decay, snappy, out, size) {
    const SR = PL_SAMPLE_RATE;
    const decayXt = decay * (1 + decay * (decay - 1));
    const triggerPulse = (Math.fround(1e-3) * SR) | 0, pulseDecay = 0.1e-3 * SR;
    const q = 2000 * plSemitonesToRatio(decayXt * 84);
    const noiseEnvelopeDecay = 1 - 0.0017 * plSemitonesToRatio(-decay * (50 + snappy * 10));
    const leak = snappy * (2 - snappy) * 0.1;
    snappy = plConstrain(snappy * 1.1 - 0.05, 0, 1);
    if (trigger) { this.pulseRemaining = triggerPulse; this.pulseHeight = 3 + 7 * accent; this.noiseEnvelope = 2; }
    const f = this.f, gain = this.gain;
    for (let i = 0; i < 5; i++) {
      f[i] = Math.min(f0 * PL_SNARE_MODES[i], 0.499);
      this.resonator[i].setFQ(PL_FREQ_FAST, f[i], 1 + f[i] * (i === 0 ? q : q * 0.25));
    }
    if (tone < 0.666667) {
      tone *= 1.5;
      gain[0] = 1.5 + (1 - tone) * (1 - tone) * 4.5;
      gain[1] = 2 * tone + 0.15;
      gain[2] = gain[3] = gain[4] = 0;
    } else {
      tone = (tone - 0.666667) * 3;
      gain[0] = 1.5 - tone * 0.5;
      gain[1] = 2.15 - tone * 0.7;
      for (let i = 2; i < 5; i++) { gain[i] = tone; tone *= tone; }
    }
    const fNoise = plConstrain(f0 * 16, 0, 0.499);
    this.noiseFilter.setFQ(PL_FREQ_FAST, fNoise, 1 + fNoise * 1.5);
    let sg = this.sustainGain; const dsg = (accent * decay - sg) / size;
    for (let n = 0; n < size; n++) {
      let pulse = 0;
      if (this.pulseRemaining) {
        --this.pulseRemaining;
        pulse = this.pulseRemaining ? this.pulseHeight : this.pulseHeight - 1;
        this.pulse = pulse;
      } else {
        this.pulse *= 1 - 1 / pulseDecay;
        pulse = this.pulse;
      }
      sg += dsg;
      this.pulseLp += 0.75 * (pulse - this.pulseLp);
      let shell = 0;
      for (let i = 0; i < 5; i++) {
        const excitation = i === 0 ? (pulse - this.pulseLp) + 0.006 * pulse : 0.026 * pulse;
        shell += gain[i] * (sustain
          ? this.oscillator[i].next(f[i]) * sg * 0.25
          : this.resonator[i].process(PL_BAND_PASS, excitation) + excitation * leak);
      }
      shell = plSoftClip(shell);
      let noise = 2 * plRandomFloat() - 1;
      if (noise < 0) noise = 0;
      this.noiseEnvelope *= noiseEnvelopeDecay;
      noise *= (sustain ? sg : this.noiseEnvelope) * snappy * 2;
      noise = this.noiseFilter.process(PL_BAND_PASS, noise);
      out[n] = noise + shell * (1 - snappy);
    }
    this.sustainGain = sg;
  }
}

// synthetic_snare_drum.h: two distorted sines for the drum, filtered noise for the snares
class PlSyntheticSnareDrum {
  constructor() {
    this.phase = [0, 0]; this.drumAmplitude = 0; this.snareAmplitude = 0; this.fm = 0; this.holdCounter = 0; this.sustainGain = 0;
    this.drumLp = new PlOnePole(); this.snareHp = new PlOnePole(); this.snareLp = new PlSvf();
  }
  distortedSine(phase) { const t = (phase < 0.5 ? phase : 1 - phase) * 4 - 1.3; return 2 * t / (1 + Math.abs(t)); }
  render(sustain, trigger, accent, f0, fmAmount, decay, snappy, out, size) {
    const SR = PL_SAMPLE_RATE;
    const decayXt = decay * (1 + decay * (decay - 1));
    fmAmount *= fmAmount;
    const drumDecay = 1 - 1 / (0.015 * SR) * plSemitonesToRatio(-decayXt * 72 - fmAmount * 12 + snappy * 7);
    const snareDecay = 1 - 1 / (0.01 * SR) * plSemitonesToRatio(-decay * 60 - snappy * 7);
    const fmDecay = 1 - 1 / (0.007 * SR);
    snappy = plConstrain(snappy * 1.1 - 0.05, 0, 1);
    const drumLevel = Math.sqrt(1 - snappy), snareLevel = Math.sqrt(snappy);
    this.snareHp.setF(PL_FREQ_FAST, Math.min(10 * f0, 0.5));
    this.snareLp.setFQ(PL_FREQ_FAST, Math.min(35 * f0, 0.5), 0.5 + 2 * snappy);
    this.drumLp.setF(PL_FREQ_FAST, 3 * f0);
    if (trigger) {
      this.snareAmplitude = this.drumAmplitude = 0.3 + 0.7 * accent;
      this.fm = 1;
      this.phase[0] = this.phase[1] = 0;
      this.holdCounter = ((0.04 + decay * 0.03) * SR) | 0;
    }
    let sg = this.sustainGain; const dsg = (accent * decay - sg) / size;
    for (let n = 0; n < size; n++) {
      const remaining = size - 1 - n; // the original tests its countdown
      if (sustain) {
        sg += dsg;
        this.snareAmplitude = sg; this.drumAmplitude = sg; this.fm = 0;
      } else {
        this.drumAmplitude *= this.drumAmplitude > 0.03 || !(remaining & 1) ? drumDecay : 1;
        if (this.holdCounter) --this.holdCounter; else this.snareAmplitude *= snareDecay;
        this.fm *= fmDecay;
      }
      let resetNoiseAmount = plConstrain((0.125 - f0) * 8, 0, 1);
      resetNoiseAmount *= resetNoiseAmount;
      resetNoiseAmount *= fmAmount;
      let resetNoise = (this.phase[0] > 0.5 ? -1 : 1) + (this.phase[1] > 0.5 ? -1 : 1);
      resetNoise *= resetNoiseAmount * 0.025;
      const f = f0 * (1 + fmAmount * (4 * this.fm));
      this.phase[0] += f;
      this.phase[1] += f * 1.47;
      if (resetNoiseAmount > 0.1) {
        if (this.phase[0] >= 1 + resetNoise) this.phase[0] = 1 - this.phase[0];
        if (this.phase[1] >= 1 + resetNoise) this.phase[1] = 1 - this.phase[1];
      } else {
        if (this.phase[0] >= 1) this.phase[0] -= 1;
        if (this.phase[1] >= 1) this.phase[1] -= 1;
      }
      let drum = -0.1 + this.distortedSine(this.phase[0]) * 0.6 + this.distortedSine(this.phase[1]) * 0.25;
      drum *= this.drumAmplitude * drumLevel;
      drum = this.drumLp.process(PL_LOW_PASS, drum);
      let snare = this.snareLp.process(PL_LOW_PASS, plRandomFloat());
      snare = this.snareHp.process(PL_HIGH_PASS, snare);
      snare = (snare + 0.1) * (this.snareAmplitude + this.fm) * snareLevel;
      out[n] = snare + drum;
    }
    this.sustainGain = sg;
  }
}

// ---- 15: snare drum (snare_drum_engine.cc). OUT: the analog model, AUX: the synthetic one. HARMONICS: the snares'
// share, TIMBRE: the shell's tone (or FM), MORPH: decay.
class PlSnareDrumEngine {
  constructor() { this.analog = new PlAnalogSnareDrum(); this.synthetic = new PlSyntheticSnareDrum(); }
  reset() {}
  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const sustain = !!(p.trigger & PL_TRIGGER_UNPATCHED), trigger = !!(p.trigger & PL_TRIGGER_RISING_EDGE);
    this.analog.render(sustain, trigger, p.accent, f0, p.timbre, p.morph, p.harmonics, out, size);
    this.synthetic.render(sustain, trigger, p.accent, f0, p.timbre, p.morph, p.harmonics, aux, size);
    return true;
  }
}

// hi_hat.h: metallic noise (six square waves, or ring-modulated pairs) through a band-pass, mixed with clocked
// noise, through a VCA and a high-pass
const PL_HH_RATIOS = [1, 1.304, 1.466, 1.787, 1.932, 2.536];
class PlSquareNoise {
  constructor() { this.phase = new Uint32Array(6); this.increment = new Uint32Array(6); }
  render(f0, temp1, temp2, out, size) {
    const ph = this.phase, inc = this.increment;
    for (let i = 0; i < 6; i++) { let f = f0 * PL_HH_RATIOS[i]; if (f >= 0.499) f = 0.499; inc[i] = (f * 4294967296) >>> 0; }
    for (let n = 0; n < size; n++) {
      let noise = 0;
      for (let i = 0; i < 6; i++) { ph[i] += inc[i]; noise += ph[i] >>> 31; }
      out[n] = 0.33 * noise - 1;
    }
  }
}
class PlRingModNoise {
  constructor() { this.oscillator = Array.from({ length: 6 }, () => new PlOscillator()); }
  render(f0, temp1, temp2, out, size) {
    const SR = PL_SAMPLE_RATE, ratio = f0 / (0.01 + f0);
    const f = [[200 / SR * ratio, 7530 / SR * ratio], [510 / SR * ratio, 8075 / SR * ratio], [730 / SR * ratio, 10500 / SR * ratio]];
    out.fill(0, 0, size);
    for (let i = 0; i < 3; i++) {
      this.oscillator[2 * i].render(PL_SHAPE_SQUARE, f[i][0], 0.5, temp1, size);
      this.oscillator[2 * i + 1].render(PL_SHAPE_SAW, f[i][1], 0.5, temp2, size);
      for (let n = 0; n < size; n++) out[n] += temp1[n] * temp2[n];
    }
  }
}
function plSwingVCA(s, gain) { s *= s > 0 ? 4 : 0.1; s = s / (1 + Math.abs(s)); return (s + 0.1) * gain; }
function plLinearVCA(s, gain) { return s * gain; }

class PlHiHat {
  constructor(noise, vca, resonance, twoStageEnvelope) {
    this.metallicNoise = noise; this.vca = vca; this.resonance = resonance; this.twoStage = twoStageEnvelope;
    this.envelope = 0; this.noiseClock = 0; this.noiseSample = 0; this.sustainGain = 0;
    this.coloration = new PlSvf(); this.hpf = new PlSvf();
  }
  render(sustain, trigger, accent, f0, tone, decay, noisiness, temp1, temp2, out, size) {
    const SR = PL_SAMPLE_RATE;
    const envelopeDecay = 1 - 0.003 * plSemitonesToRatio(-decay * 84);
    const cutDecay = 1 - 0.0025 * plSemitonesToRatio(-decay * 36);
    if (trigger) this.envelope = (1.5 + 0.5 * (1 - decay)) * (0.3 + 0.7 * accent);
    this.metallicNoise.render(2 * f0, temp1, temp2, out, size);
    const cutoff = plConstrain(150 / SR * plSemitonesToRatio(tone * 72), 0, 16000 / SR);
    this.coloration.setFQ(PL_FREQ_ACCURATE, cutoff, this.resonance ? 3 + 3 * tone : 1);
    this.coloration.processBuffer(PL_BAND_PASS, out, out, size);
    noisiness *= noisiness;
    const noiseF = plConstrain(f0 * (16 + 16 * (1 - noisiness)), 0, 0.5);
    for (let i = 0; i < size; i++) {
      this.noiseClock += noiseF;
      if (this.noiseClock >= 1) { this.noiseClock -= 1; this.noiseSample = plRandomFloat() - 0.5; }
      out[i] += noisiness * (this.noiseSample - out[i]);
    }
    let sg = this.sustainGain; const dsg = (accent * decay - sg) / size;
    for (let i = 0; i < size; i++) {
      this.envelope *= this.envelope > 0.5 || !this.twoStage ? envelopeDecay : cutDecay;
      let gain = this.envelope;
      if (sustain) { sg += dsg; gain = sg; }
      out[i] = this.vca(out[i], gain);
    }
    this.sustainGain = sg;
    this.hpf.setFQ(PL_FREQ_ACCURATE, cutoff, 0.5);
    this.hpf.processBuffer(PL_HIGH_PASS, out, out, size);
  }
}

// ---- 16: hi-hat (hi_hat_engine.cc). OUT: six square waves through a resonant band-pass and a swing VCA; AUX:
// ring-modulated pairs, a two-stage envelope. HARMONICS: how much noise, TIMBRE: tone, MORPH: decay.
class PlHiHatEngine {
  constructor() {
    this.hiHat1 = new PlHiHat(new PlSquareNoise(), plSwingVCA, true, false);
    this.hiHat2 = new PlHiHat(new PlRingModNoise(), plLinearVCA, false, true);
    this.temp1 = new Float32Array(PL_MAX_BLOCK); this.temp2 = new Float32Array(PL_MAX_BLOCK);
  }
  reset() {}
  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const sustain = !!(p.trigger & PL_TRIGGER_UNPATCHED), trigger = !!(p.trigger & PL_TRIGGER_RISING_EDGE);
    this.hiHat1.render(sustain, trigger, p.accent, f0, p.timbre, p.morph, p.harmonics, this.temp1, this.temp2, out, size);
    this.hiHat2.render(sustain, trigger, p.accent, f0, p.timbre, p.morph, p.harmonics, this.temp1, this.temp2, aux, size);
    return true;
  }
}

// The engines in the module's order, with its output gains for OUT and AUX (negative: through a limiter). The same
// order as RIG_MACRO_MODELS (rigParams.ts): a patch keeps the index, so new engines go on the end.
const PL_ENGINES = [
  [PlVirtualAnalogEngine, 0.8, 0.8],
  [PlWaveshapingEngine, 0.7, 0.6],
  [PlFMEngine, 0.6, 0.6],
  [PlGrainEngine, 0.7, 0.6],
  [PlAdditiveEngine, 0.8, 0.8],
  [PlWavetableEngine, 0.6, 0.6],
  [PlChordEngine, 0.8, 0.8],
  [PlSpeechEngine, -0.7, 0.8],
  [PlSwarmEngine, -3.0, 1.0],
  [PlNoiseEngine, -1.0, -1.0],
  [PlParticleEngine, -2.0, 1.0],
  [PlStringEngine, -1.0, 0.8],
  [PlModalEngine, -1.0, 0.8],
  [PlBassDrumEngine, 0.8, 0.8],
  [PlSnareDrumEngine, 0.8, 0.8],
  [PlHiHatEngine, 0.8, 0.8],
];
`].join(`
`),De=[`A`,`B`,`C`,`D`],Oe=[...Array.from({length:16},(e,t)=>`p${t+1}`),...De.map(e=>`r${e}`)],ke=[`1/16`,`1/8T`,`1/8`,`3/16`,`1/4T`,`1/4`,`3/8`,`1/2`,`3/4`,`1`],Ae=[.25,1/3,.5,.75,2/3,1,1.5,2,3,4],je=[`SPRING`,`PLATE`,`HALL`],Me=[`I`,`II`,`I+II`],Ne=[`TUBE`,`DIODE`,`FUZZ`],Pe=[`off`,...Array.from({length:16},(e,t)=>String(t+1))],Fe=[`self`,...Array.from({length:16},(e,t)=>String(t+1))],x=(e,t,n,r,i,a=``,o=`linear`)=>({id:e,label:t,kind:`number`,min:n,max:r,def:i,unit:a,curve:o}),Ie=(e,t,n,r)=>({id:e,label:t,kind:`choice`,min:0,max:n.length-1,def:n.indexOf(r),options:n}),S=(e,t,n=0)=>({id:e,label:t,kind:`toggle`,min:0,max:1,def:n});function Le(e){return[x(`${e}.hi`,`High`,-30,6,0,`dB`),x(`${e}.mid`,`Mid`,-30,6,0,`dB`),x(`${e}.lo`,`Low`,-30,6,0,`dB`),x(`${e}.filter`,`Filter`,-1,1,0),x(`${e}.pan`,`Pan`,-1,1,0),x(`${e}.a`,`Send A`,0,1,0),x(`${e}.b`,`Send B`,0,1,0),x(`${e}.c`,`Send C`,0,1,0),x(`${e}.d`,`Send D`,0,1,0),S(`${e}.mute`,`Mute`),S(`${e}.solo`,`Solo`),S(`${e}.throw`,`Throw A`),x(`${e}.fader`,`Fader`,0,2,1)]}var Re=[...Oe.flatMap(Le),x(`dub.time`,`Time`,.02,2,.375,`s`,`log`),S(`dub.sync`,`Sync`,1),Ie(`dub.div`,`Division`,ke,`3/16`),x(`dub.fdbk`,`Feedback`,0,1.2,.5),x(`dub.tone`,`Tone`,300,8e3,2500,`Hz`,`log`),x(`dub.wow`,`Wow`,0,1,.25),x(`dub.sat`,`Saturation`,0,1,.3),S(`dub.throw`,`Throw`),x(`bbd.time`,`Time`,.02,.6,.32,`s`,`log`),S(`bbd.sync`,`Sync`),Ie(`bbd.div`,`Division`,ke,`1/8`),x(`bbd.fdbk`,`Feedback`,0,1.1,.4),x(`bbd.mod`,`Mod`,0,1,.25),x(`bbd.rate`,`Rate`,.05,5,.6,`Hz`,`log`),x(`bbd.age`,`Age`,0,1,.3),S(`bbd.ping`,`Ping-pong`,1),x(`rev.size`,`Size`,0,1,.5),x(`rev.damp`,`Damp`,0,1,.4),x(`rev.pre`,`Pre-delay`,0,.2,.02,`s`),x(`rev.tone`,`Tone`,0,1,.5),x(`rev.shimmer`,`Shimmer`,0,1,0),Ie(`rev.type`,`Type`,je,`PLATE`),S(`rev.freeze`,`Freeze`),x(`cho.rate`,`Rate`,0,1,.5),x(`cho.depth`,`Depth`,0,1,.5),x(`cho.width`,`Width`,0,1,1),Ie(`cho.mode`,`Mode`,Me,`I`),Ie(`drv.part`,`Part`,Pe,`off`),x(`drv.drive`,`Drive`,0,1,.5),x(`drv.tone`,`Tone`,0,1,.6),x(`drv.blend`,`Blend`,0,1,1),x(`drv.level`,`Level`,0,1.5,.7),Ie(`drv.type`,`Type`,Ne,`TUBE`),x(`cmp.thresh`,`Threshold`,-40,0,-10,`dB`),x(`cmp.ratio`,`Ratio`,1,20,1,`:1`,`log`),x(`cmp.atk`,`Attack`,.1,100,10,`ms`,`log`),x(`cmp.rel`,`Release`,20,1e3,150,`ms`,`log`),x(`cmp.makeup`,`Make-up`,0,18,0,`dB`),x(`cmp.mix`,`Mix`,0,1,1),Ie(`cmp.key`,`Key`,Fe,`self`),x(`cmp.hpf`,`Key HPF`,20,500,20,`Hz`,`log`),x(`master.fader`,`Master`,0,2,1),S(`master.limit`,`Feedback limit`,1)],ze=Object.fromEntries(Re.map(e=>[e.id,e.def])),Be=Re.map(e=>[e.id,e.def]),Ve=`
const MIX_DEFS = ${JSON.stringify(Be)};
const MIX_N = MIX_DEFS.length;
const MIX_P = {};
MIX_DEFS.forEach((d, i) => { MIX_P[d[0]] = i; });
const MIX_STRIPS = ${JSON.stringify(Oe)};
const MIX_PARTS = 16;
const MIX_DIV_BEATS = ${JSON.stringify(Ae)};
const MIX_BLOCK = 512;
const MIX_TAU = Math.PI * 2;
// strip param offsets (in the order rigMix.ts lists them)
const S_HI = 0, S_MID = 1, S_LO = 2, S_FILTER = 3, S_PAN = 4, S_SEND = 5, S_MUTE = 9, S_SOLO = 10, S_THROW = 11, S_FADER = 12, S_NP = 13;

// RBJ biquad coefficients [b0, b1, b2, a1, a2] (a0 normalised): 0 low shelf, 1 peak, 2 high shelf
function mixBiquad(type, f, q, db, sr) {
  const A = Math.pow(10, db / 40), w = MIX_TAU * f / sr, cw = Math.cos(w), sw = Math.sin(w);
  if (type === 1) {
    const al = sw / (2 * q), a0 = 1 + al / A;
    return [(1 + al * A) / a0, -2 * cw / a0, (1 - al * A) / a0, -2 * cw / a0, (1 - al / A) / a0];
  }
  const al = sw / 2 * Math.SQRT2, sA = 2 * Math.sqrt(A) * al;
  if (type === 0) {
    const a0 = (A + 1) + (A - 1) * cw + sA;
    return [A * ((A + 1) - (A - 1) * cw + sA) / a0, 2 * A * ((A - 1) - (A + 1) * cw) / a0, A * ((A + 1) - (A - 1) * cw - sA) / a0,
      -2 * ((A - 1) + (A + 1) * cw) / a0, ((A + 1) + (A - 1) * cw - sA) / a0];
  }
  const a0 = (A + 1) - (A - 1) * cw + sA;
  return [A * ((A + 1) + (A - 1) * cw + sA) / a0, -2 * A * ((A - 1) + (A + 1) * cw) / a0, A * ((A + 1) + (A - 1) * cw - sA) / a0,
    2 * ((A - 1) - (A + 1) * cw) / a0, ((A + 1) - (A - 1) * cw - sA) / a0];
}

// soft clipper: unity for small signals, bounded at +-1
function mixSoft(x) { return x > 3 ? 1 : x < -3 ? -1 : x * (27 + x * x) / (27 + 9 * x * x); }

// a delay line that reads between samples
class MixLine {
  constructor(n) { this.buf = new Float32Array(n); this.w = 0; this.n = n; }
  push(x) { this.buf[this.w] = x; this.w = (this.w + 1) % this.n; }
  // \`d\` samples ago (d >= 1), linear between samples
  read(d) {
    const p = this.w - d;
    let i = Math.floor(p);
    const f = p - i;
    i = ((i % this.n) + this.n) % this.n;
    const a = this.buf[i], b = this.buf[(i + 1) % this.n];
    return a + (b - a) * f;
  }
}

class MixStrip {
  constructor() {
    this.eq = [new Float64Array(5), new Float64Array(5), new Float64Array(5)];
    this.on = [false, false, false];
    this.z = new Float64Array(12); // 3 biquads x 2 channels x 2 states
    this.s1 = [0, 0]; this.s2 = [0, 0]; // filter
    this.fc = 0; // the filter knob, glided
    this.gL = 0; this.gR = 0; this.send = [0, 0, 0, 0];
    this.eqKey = '';
    this.started = false; // the first block starts at the settings rather than gliding up to them
    this.peakL = 0; this.peakR = 0;
    this.sqL = 0; this.sqR = 0; this.count = 0; // for the RMS since the meters were last read
  }
}

class RigMixer {
  constructor(sr, parts = MIX_PARTS) {
    this.sr = sr;
    this.parts = parts;
    this.v = new Float64Array(MIX_N);
    for (let i = 0; i < MIX_N; i++) this.v[i] = MIX_DEFS[i][1];
    this.strips = MIX_STRIPS.map(() => new MixStrip());
    const buf = () => new Float32Array(MIX_BLOCK);
    this.busL = [buf(), buf(), buf(), buf()]; this.busR = [buf(), buf(), buf(), buf()];
    // what the returns sent last block, for the effects this block
    this.carryL = [buf(), buf(), buf(), buf()]; this.carryR = [buf(), buf(), buf(), buf()];
    this.retL = [buf(), buf(), buf(), buf()]; this.retR = [buf(), buf(), buf(), buf()];
    this.mixL = buf(); this.mixR = buf(); this.tmpL = buf(); this.tmpR = buf();
    this.dub = { L: new MixLine(Math.ceil(sr * 2.2)), R: new MixLine(Math.ceil(sr * 2.2)), d: sr * 0.375, ph: 0, ph2: 0, tL: 0, tR: 0, hL: 0, hR: 0, drift: 0 };
    this.bbd = { L: new MixLine(Math.ceil(sr * 0.7)), R: new MixLine(Math.ceil(sr * 0.7)), d: sr * 0.32, ph: 0, a1: [0, 0], a2: [0, 0], seed: 22222 };
    this.rev = this.makeReverb();
    this.cho = { line: new MixLine(Math.ceil(sr * 0.05)), ph: 0, lp: [0, 0] };
    this.drv = { lp: [0, 0] };
    this.cmp = { gr: 0, hp: 0, hx: 0, minGr: 0 };
    this.masterG = 1;
    this.peak = [0, 0];
    this.masterSq = [0, 0]; this.masterCount = 0;
  }

  set(id, value) {
    const i = MIX_P[id];
    if (i !== undefined) this.v[i] = value;
  }

  p(id) { return this.v[MIX_P[id]]; }

  // ---- strips

  updateEq(st, base) {
    const v = this.v, key = v[base + S_LO] + ',' + v[base + S_MID] + ',' + v[base + S_HI];
    if (key === st.eqKey) return;
    st.eqKey = key;
    const bands = [[0, 250, 0.707, v[base + S_LO]], [1, 1000, 0.7, v[base + S_MID]], [2, 4000, 0.707, v[base + S_HI]]];
    bands.forEach((b, k) => {
      st.on[k] = Math.abs(b[3]) > 0.01;
      if (st.on[k]) st.eq[k].set(mixBiquad(b[0], b[1], b[2], b[3], this.sr));
    });
  }

  // one strip: \`inL/inR\` -> EQ, filter, gains -> adds to the mix and to the four send buses (sL/sR)
  runStrip(s, inL, inR, n, soloed, sL, sR) {
    const st = this.strips[s], v = this.v, base = s * S_NP, sr = this.sr;
    this.updateEq(st, base);
    const muted = v[base + S_MUTE] >= 0.5 || (soloed && v[base + S_SOLO] < 0.5);
    const fader = muted ? 0 : v[base + S_FADER], pan = v[base + S_PAN];
    const tL = fader * (pan > 0 ? 1 - pan : 1), tR = fader * (pan < 0 ? 1 + pan : 1);
    const throwA = v[base + S_THROW] >= 0.5;
    const tSend = [throwA ? 1 : v[base + S_SEND], v[base + S_SEND + 1], v[base + S_SEND + 2], v[base + S_SEND + 3]];
    // the filter knob glides, and sets a TPT SVF: low-pass from 20 kHz down to 100 Hz, or high-pass from 20 Hz up to 5 kHz
    const target = v[base + S_FILTER];
    if (!st.started) { st.started = true; st.gL = tL; st.gR = tR; st.send = tSend.slice(); st.fc = target; }
    st.fc += (target - st.fc) * Math.min(1, n / (0.03 * sr));
    const f = st.fc, filt = Math.abs(f) > 0.01;
    const fcHz = f < 0 ? 20000 * Math.pow(0.005, -f) : 20 * Math.pow(250, f);
    const g = Math.tan(Math.PI * Math.min(fcHz, sr * 0.45) / sr), k = 1.1, a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const z = st.z, E = st.eq, on = st.on;
    const dL = (tL - st.gL) / n, dR = (tR - st.gR) / n;
    const dS = tSend.map((x, j) => (x - st.send[j]) / n);
    let gL = st.gL, gR = st.gR, pkL = st.peakL, pkR = st.peakR, sqL = st.sqL, sqR = st.sqR;
    const snd = st.send.slice();
    for (let i = 0; i < n; i++) {
      let xl = inL[i], xr = inR[i];
      for (let b = 0; b < 3; b++) {
        if (!on[b]) continue;
        const c = E[b], o = b * 4;
        let y = c[0] * xl + z[o];
        z[o] = c[1] * xl - c[3] * y + z[o + 1]; z[o + 1] = c[2] * xl - c[4] * y; xl = y;
        y = c[0] * xr + z[o + 2];
        z[o + 2] = c[1] * xr - c[3] * y + z[o + 3]; z[o + 3] = c[2] * xr - c[4] * y; xr = y;
      }
      if (filt) {
        for (let ch = 0; ch < 2; ch++) {
          const x = ch ? xr : xl;
          const v3 = x - st.s2[ch], v1 = a1 * st.s1[ch] + a2 * v3, v2 = st.s2[ch] + a2 * st.s1[ch] + a3 * v3;
          st.s1[ch] = 2 * v1 - st.s1[ch]; st.s2[ch] = 2 * v2 - st.s2[ch];
          const y = f < 0 ? v2 : x - k * v1 - v2;
          if (ch) xr = y; else xl = y;
        }
      }
      gL += dL; gR += dR;
      const ol = xl * gL, or = xr * gR;
      this.mixL[i] += ol; this.mixR[i] += or;
      for (let j = 0; j < 4; j++) {
        snd[j] += dS[j];
        if (snd[j] > 1e-6) { sL[j][i] += ol * snd[j]; sR[j][i] += or * snd[j]; }
      }
      const al = ol < 0 ? -ol : ol, ar = or < 0 ? -or : or;
      if (al > pkL) pkL = al;
      if (ar > pkR) pkR = ar;
      sqL += ol * ol; sqR += or * or;
    }
    st.gL = tL; st.gR = tR; st.send = tSend;
    st.peakL = pkL; st.peakR = pkR; st.sqL = sqL; st.sqR = sqR; st.count += n;
    if (!Number.isFinite(st.s1[0] + st.s1[1] + st.s2[0] + st.s2[1] + z[0] + z[2] + z[4] + z[6] + z[8] + z[10])) { st.z.fill(0); st.s1 = [0, 0]; st.s2 = [0, 0]; }
  }

  // ---- the drive insert

  runDrive(L, R, n) {
    const v = this.v, d = this.drv, type = Math.round(this.p('drv.type'));
    const amt = this.p('drv.drive'), blend = this.p('drv.blend'), level = this.p('drv.level');
    const g = 1 + amt * [24, 40, 150][type];
    const comp = 1 / (1 + amt * [4, 5, 7][type]); // turning the drive up mostly changes the tone, not the level
    const lc = 1 - Math.exp(-MIX_TAU * 800 * Math.pow(25, this.p('drv.tone')) / this.sr);
    for (let ch = 0; ch < 2; ch++) {
      const X = ch ? R : L;
      let lp = d.lp[ch];
      for (let i = 0; i < n; i++) {
        const x = X[i], u = x * g;
        let y;
        if (type === 0) y = Math.tanh(u + 0.25) - 0.2449186624037092; // tube: lop-sided, so even harmonics too
        else if (type === 1) y = u >= 0 ? 1 - Math.exp(-u) : -0.8 * (1 - Math.exp(u / 0.8)); // diode
        else { const s = u < 0 ? -1 : 1; y = s * Math.min(0.85, 1 - Math.exp(-Math.abs(u))); } // fuzz, squared off
        lp += (y - lp) * lc;
        X[i] = (x * (1 - blend) + lp * comp * blend) * level;
      }
      d.lp[ch] = lp;
    }
  }

  // ---- A: dub delay

  runDub(inL, inR, outL, outR, n, bpm) {
    const e = this.dub, sr = this.sr;
    const time = this.p('dub.sync') >= 0.5 ? 60 / bpm * MIX_DIV_BEATS[Math.round(this.p('dub.div'))] : this.p('dub.time');
    const target = Math.min(2, Math.max(0.005, time)) * sr;
    const fb = this.p('dub.throw') >= 0.5 ? 1.08 : this.p('dub.fdbk');
    const lc = 1 - Math.exp(-MIX_TAU * this.p('dub.tone') / sr), hc = 1 - Math.exp(-MIX_TAU * 90 / sr);
    const wow = this.p('dub.wow') * 0.0025 * sr, sat = 1 + this.p('dub.sat') * 5;
    const glide = 1 - Math.exp(-1 / (0.15 * sr)); // tape: a new time glides, pitching what is in the loop
    if (!e.started) { e.started = true; e.d = target; }
    for (let i = 0; i < n; i++) {
      e.d += (target - e.d) * glide;
      e.ph += 0.45 / sr; e.ph2 += 5.3 / sr;
      if (e.ph > 1) e.ph -= 1;
      if (e.ph2 > 1) e.ph2 -= 1;
      const w = wow * (Math.sin(MIX_TAU * e.ph) + 0.15 * Math.sin(MIX_TAU * e.ph2));
      const x = (inL[i] + inR[i]) * 0.5;
      for (let ch = 0; ch < 2; ch++) {
        const line = ch ? e.R : e.L;
        let y = line.read(Math.max(1, e.d * (ch ? 1.012 : 1) + (ch ? -w : w)));
        if (ch) { e.tR += (y - e.tR) * lc; e.hR += (e.tR - e.hR) * hc; y = e.tR - e.hR; }
        else { e.tL += (y - e.tL) * lc; e.hL += (e.tL - e.hL) * hc; y = e.tL - e.hL; }
        y = mixSoft(y * sat) / sat;
        line.push(x + y * fb);
        if (ch) outR[i] = y; else outL[i] = y;
      }
    }
    if (!Number.isFinite(e.tL + e.tR)) { e.L.buf.fill(0); e.R.buf.fill(0); e.tL = e.tR = e.hL = e.hR = 0; }
  }

  // ---- B: bucket-brigade delay

  runBbd(inL, inR, outL, outR, n, bpm) {
    const e = this.bbd, sr = this.sr;
    const time = this.p('bbd.sync') >= 0.5 ? 60 / bpm * MIX_DIV_BEATS[Math.round(this.p('bbd.div'))] : this.p('bbd.time');
    const target = Math.min(0.6, Math.max(0.005, time)) * sr;
    const fb = this.p('bbd.fdbk'), age = this.p('bbd.age'), ping = this.p('bbd.ping') >= 0.5;
    const depth = this.p('bbd.mod') * 0.006 * sr, rate = this.p('bbd.rate');
    // the anti-alias and reconstruction filters close as the chip ages (and as the time gets longer, as on a real one)
    const fc = Math.max(1200, 9000 * (1 - age * 0.7) * Math.min(1, 0.12 * sr / Math.max(1, target)));
    const c = 1 - Math.exp(-MIX_TAU * fc / sr), grit = age * 0.004;
    const glide = 1 - Math.exp(-1 / (0.05 * sr));
    if (!e.started) { e.started = true; e.d = target; }
    for (let i = 0; i < n; i++) {
      e.d += (target - e.d) * glide;
      e.ph += rate / sr;
      if (e.ph > 1) e.ph -= 1;
      const tri = e.ph < 0.5 ? 4 * e.ph - 1 : 3 - 4 * e.ph;
      const x = (inL[i] + inR[i]) * 0.5;
      const out = [0, 0];
      for (let ch = 0; ch < 2; ch++) {
        const line = ch ? e.R : e.L;
        let y = line.read(Math.max(1, e.d + (ch ? -tri : tri) * depth));
        e.a1[ch] += (y - e.a1[ch]) * c; e.a2[ch] += (e.a1[ch] - e.a2[ch]) * c; y = e.a2[ch];
        e.seed = (e.seed * 1664525 + 1013904223) >>> 0;
        y = mixSoft(y * 1.2) / 1.2 + (e.seed / 4294967296 - 0.5) * grit * Math.abs(y); // grit rides the signal: silence stays silent
        out[ch] = y;
      }
      if (ping) { e.L.push(x + out[1] * fb); e.R.push(out[0] * fb); }
      else { e.L.push(x + out[0] * fb); e.R.push(x + out[1] * fb); }
      outL[i] = out[0]; outR[i] = out[1];
    }
    if (!Number.isFinite(e.a2[0] + e.a2[1])) { e.L.buf.fill(0); e.R.buf.fill(0); e.a1 = [0, 0]; e.a2 = [0, 0]; }
  }

  // ---- C: reverb, an eight-line feedback delay network

  makeReverb() {
    const sr = this.sr, max = Math.ceil(sr * 0.25);
    return {
      lines: Array.from({ length: 8 }, () => new MixLine(max)), lp: new Float64Array(8), pre: new MixLine(Math.ceil(sr * 0.25)),
      ap: [4.7, 3.6, 12.7, 9.3].map((ms) => new MixLine(Math.ceil(sr * ms / 1000) + 1)),
      apLen: [4.7, 3.6, 12.7, 9.3].map((ms) => Math.round(sr * ms / 1000)),
      disp: new Float64Array(16), // the spring's chirp: a chain of first-order all-passes
      ph: 0, x: new Float64Array(8), toneL: [0, 0], toneH: [0, 0],
      sh: new MixLine(Math.ceil(sr * 0.1)), shPh: 0, shLp: 0, fbL: 0, fbR: 0,
    };
  }

  runReverb(inL, inR, outL, outR, n) {
    const r = this.rev, sr = this.sr;
    const type = Math.round(this.p('rev.type')), size = this.p('rev.size'), freeze = this.p('rev.freeze') >= 0.5;
    // line lengths (ms) and decay range per type: spring, plate, hall
    const LEN = [[9.1, 11.3, 13.7, 15.1, 17.9, 19.3, 21.1, 23.7], [10.3, 12.9, 15.7, 18.1, 21.3, 23.9, 27.1, 30.7], [29.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.1, 73.9]][type];
    const RT = [[0.6, 4], [0.5, 6], [1.2, 12]][type];
    const scale = [1, 0.7 + size * 0.8, 0.6 + size * 1.4][type];
    const rt = RT[0] * Math.pow(RT[1] / RT[0], size);
    const lens = LEN.map((ms) => Math.min(r.lines[0].n - 2, ms * scale * sr / 1000));
    const gains = lens.map((l) => (freeze ? 1 : Math.pow(10, -3 * l / (rt * sr))));
    const dc = freeze ? 1 : 1 - Math.exp(-MIX_TAU * 12000 * Math.pow(0.06, this.p('rev.damp')) / sr);
    const pre = Math.max(1, this.p('rev.pre') * sr), shimmer = this.p('rev.shimmer');
    const tone = this.p('rev.tone');
    const tlc = tone < 0.5 ? 1 - Math.exp(-MIX_TAU * 1500 * Math.pow(13, tone * 2) / sr) : 1;
    const thc = tone > 0.5 ? 1 - Math.exp(-MIX_TAU * 20 * Math.pow(25, (tone - 0.5) * 2) / sr) : 0;
    const inGain = freeze ? 0 : 1, mod = type === 0 ? 0 : 0.0004 * sr;
    const x = r.x, sc = 1 / Math.sqrt(8);
    for (let i = 0; i < n; i++) {
      r.pre.push((inL[i] + inR[i]) * 0.5 * inGain);
      let u = r.pre.read(pre);
      // shimmer: the reverb an octave up (two taps sweeping a 50 ms window at twice the speed), back into its input
      if (shimmer > 0) {
        r.sh.push((r.fbL + r.fbR) * 0.5);
        r.shPh = (r.shPh + 1 / (0.05 * sr)) % 1;
        const win = 0.05 * sr, p1 = r.shPh, p2 = (r.shPh + 0.5) % 1;
        const s = r.sh.read(1 + (1 - p1) * win) * Math.sin(Math.PI * p1) + r.sh.read(1 + (1 - p2) * win) * Math.sin(Math.PI * p2);
        r.shLp += (s - r.shLp) * 0.3;
        u += r.shLp * shimmer * 0.6;
      }
      for (let a = 0; a < 4; a++) {
        const line = r.ap[a], d = line.read(r.apLen[a]), w = u + 0.6 * d;
        line.push(w);
        u = d - 0.6 * w;
      }
      if (type === 0) {
        // a spring disperses: highs arrive before lows, the chirp
        for (let a = 0; a < 16; a++) { const y = -0.62 * u + r.disp[a]; r.disp[a] = u + 0.62 * y; u = y; }
      }
      r.ph += 0.7 / sr;
      if (r.ph > 1) r.ph -= 1;
      const m = Math.sin(MIX_TAU * r.ph) * mod;
      for (let k = 0; k < 8; k++) {
        const y = r.lines[k].read(lens[k] + (k === 0 ? m : k === 4 ? -m : 0));
        r.lp[k] += (y - r.lp[k]) * dc;
        x[k] = r.lp[k] * gains[k];
      }
      // Hadamard mixing (fast, in place)
      for (let h = 1; h < 8; h *= 2) {
        for (let j = 0; j < 8; j += h * 2) {
          for (let q = j; q < j + h; q++) { const a = x[q], b = x[q + h]; x[q] = a + b; x[q + h] = a - b; }
        }
      }
      for (let k = 0; k < 8; k++) r.lines[k].push(mixSoft(x[k] * sc + u));
      let l = r.lp[0] - r.lp[2] + r.lp[4] - r.lp[6], rr = r.lp[1] - r.lp[3] + r.lp[5] - r.lp[7];
      r.fbL = l; r.fbR = rr;
      r.toneL[0] += (l - r.toneL[0]) * tlc; r.toneL[1] += (rr - r.toneL[1]) * tlc;
      l = r.toneL[0]; rr = r.toneL[1];
      if (thc > 0) { r.toneH[0] += (l - r.toneH[0]) * thc; r.toneH[1] += (rr - r.toneH[1]) * thc; l -= r.toneH[0]; rr -= r.toneH[1]; }
      outL[i] = l * 0.5; outR[i] = rr * 0.5;
    }
    if (!Number.isFinite(r.lp[0] + r.lp[7])) { for (const ln of r.lines) ln.buf.fill(0); r.lp.fill(0); r.disp.fill(0); }
  }

  // ---- D: chorus, after the Juno's: two taps on one line, swept in opposite directions

  runChorus(inL, inR, outL, outR, n) {
    const e = this.cho, sr = this.sr, mode = Math.round(this.p('cho.mode'));
    const rate = [0.513, 0.863, 9.75][mode] * Math.pow(4, (this.p('cho.rate') - 0.5) * 2);
    const depth = [1.85, 1.85, 0.3][mode] * 2 * this.p('cho.depth') * sr / 1000;
    const centre = 3.5 * sr / 1000, w = this.p('cho.width');
    const c = 1 - Math.exp(-MIX_TAU * 9000 / sr);
    for (let i = 0; i < n; i++) {
      e.line.push((inL[i] + inR[i]) * 0.5);
      e.ph += rate / sr;
      if (e.ph > 1) e.ph -= 1;
      const tri = e.ph < 0.5 ? 4 * e.ph - 1 : 3 - 4 * e.ph;
      const a = e.line.read(centre + tri * depth), b = e.line.read(centre - tri * depth);
      e.lp[0] += (a - e.lp[0]) * c; e.lp[1] += (b - e.lp[1]) * c;
      const l = e.lp[0], r = e.lp[1];
      outL[i] = l * (1 + w) / 2 + r * (1 - w) / 2;
      outR[i] = r * (1 + w) / 2 + l * (1 - w) / 2;
    }
  }

  // ---- the master compressor

  runComp(L, R, keyL, keyR, n) {
    const e = this.cmp, sr = this.sr;
    const thr = this.p('cmp.thresh'), ratio = this.p('cmp.ratio'), knee = 6;
    const atk = 1 - Math.exp(-1 / (this.p('cmp.atk') / 1000 * sr)), rel = 1 - Math.exp(-1 / (this.p('cmp.rel') / 1000 * sr));
    const makeup = this.p('cmp.makeup'), mix = this.p('cmp.mix');
    const hc = 1 - Math.exp(-MIX_TAU * this.p('cmp.hpf') / sr);
    let minGr = 0;
    for (let i = 0; i < n; i++) {
      const k = keyL ? (keyL[i] + keyR[i]) * 0.5 : (L[i] + R[i]) * 0.5;
      e.hp += (k - e.hp) * hc;
      const kx = Math.abs(k - e.hp);
      const lvl = 20 * Math.log10(kx + 1e-9), over = lvl - thr, slope = 1 / ratio - 1;
      const want = over <= -knee / 2 ? 0 : over < knee / 2 ? slope * (over + knee / 2) * (over + knee / 2) / (2 * knee) : slope * over;
      e.gr += (want - e.gr) * (want < e.gr ? atk : rel);
      if (e.gr < minGr) minGr = e.gr;
      const g = Math.pow(10, (e.gr + makeup) / 20), wet = mix * g + (1 - mix);
      L[i] *= wet; R[i] *= wet;
    }
    if (minGr < e.minGr) e.minGr = minGr; // the deepest since the meters were last read
  }

  // ---- a block: every part's bus in, the master out

  process(partL, partR, outL, outR, n, bpm) {
    const v = this.v, NS = this.strips.length;
    this.mixL.fill(0, 0, n); this.mixR.fill(0, 0, n);
    for (let j = 0; j < 4; j++) {
      this.busL[j].set(this.carryL[j].subarray(0, n)); this.busR[j].set(this.carryR[j].subarray(0, n));
      this.carryL[j].fill(0, 0, n); this.carryR[j].fill(0, 0, n);
    }
    let soloed = false;
    for (let s = 0; s < NS; s++) if (v[s * S_NP + S_SOLO] >= 0.5) { soloed = true; break; }
    const drivePart = Math.round(this.p('drv.part')) - 1;
    for (let p = 0; p < this.parts; p++) {
      let L = partL[p], R = partR[p];
      if (p === drivePart) {
        this.tmpL.set(L.subarray(0, n)); this.tmpR.set(R.subarray(0, n));
        L = this.tmpL; R = this.tmpR;
        this.runDrive(L, R, n);
      }
      this.runStrip(p, L, R, n, soloed, this.busL, this.busR);
    }
    if (this.p('master.limit') >= 0.5) {
      for (let j = 0; j < 4; j++) for (let i = 0; i < n; i++) { this.busL[j][i] = mixSoft(this.busL[j][i]); this.busR[j][i] = mixSoft(this.busR[j][i]); }
    }
    const bpmv = bpm || 120;
    this.runDub(this.busL[0], this.busR[0], this.retL[0], this.retR[0], n, bpmv);
    this.runBbd(this.busL[1], this.busR[1], this.retL[1], this.retR[1], n, bpmv);
    this.runReverb(this.busL[2], this.busR[2], this.retL[2], this.retR[2], n);
    this.runChorus(this.busL[3], this.busR[3], this.retL[3], this.retR[3], n);
    for (let r = 0; r < 4; r++) this.runStrip(this.parts + r, this.retL[r], this.retR[r], n, soloed, this.carryL, this.carryR);
    const key = Math.round(this.p('cmp.key')) - 1;
    if (this.p('cmp.ratio') > 1.001) this.runComp(this.mixL, this.mixR, key >= 0 ? partL[key] : null, key >= 0 ? partR[key] : null, n);
    const target = this.p('master.fader'), d = (target - this.masterG) / n;
    let g = this.masterG, pl = this.peak[0], pr = this.peak[1], ml = this.masterSq[0], mr = this.masterSq[1];
    for (let i = 0; i < n; i++) {
      g += d;
      // the ceiling: untouched up to 0.9, then bends into 1
      let l = this.mixL[i] * g, r = this.mixR[i] * g;
      const al = Math.abs(l), ar = Math.abs(r);
      if (al > 0.9) l = Math.sign(l) * (0.9 + 0.099 * Math.tanh((al - 0.9) / 0.099));
      if (ar > 0.9) r = Math.sign(r) * (0.9 + 0.099 * Math.tanh((ar - 0.9) / 0.099));
      outL[i] = l; outR[i] = r;
      if (al > pl) pl = al;
      if (ar > pr) pr = ar;
      ml += l * l; mr += r * r;
    }
    this.masterG = target;
    this.peak[0] = pl; this.peak[1] = pr;
    this.masterSq[0] = ml; this.masterSq[1] = mr; this.masterCount += n;
  }

  // Peaks and RMS since the last call (then cleared): per strip [L, R], the master [L, R], and the compressor's
  // deepest reduction (dB).
  meters() {
    const strips = new Float32Array(this.strips.length * 2), rms = new Float32Array(this.strips.length * 2);
    this.strips.forEach((st, s) => {
      strips[s * 2] = st.peakL; strips[s * 2 + 1] = st.peakR;
      const c = Math.max(1, st.count);
      rms[s * 2] = Math.sqrt(st.sqL / c); rms[s * 2 + 1] = Math.sqrt(st.sqR / c);
      st.peakL = 0; st.peakR = 0; st.sqL = 0; st.sqR = 0; st.count = 0;
    });
    const mc = Math.max(1, this.masterCount);
    const out = { strips, rms, master: [this.peak[0], this.peak[1]], masterRms: [Math.sqrt(this.masterSq[0] / mc), Math.sqrt(this.masterSq[1] / mc)], gr: this.cmp.minGr };
    this.peak = [0, 0];
    this.masterSq = [0, 0]; this.masterCount = 0;
    this.cmp.minGr = 0;
    return out;
  }
}
`,C=(e,t,n,r,i,a=``,o=`linear`)=>({id:e,label:t,kind:`number`,min:n,max:r,def:i,unit:a,curve:o}),w=(e,t,n,r)=>({id:e,label:t,kind:`choice`,min:0,max:n.length-1,def:n.indexOf(r),options:n}),He=(e,t,n=0)=>({id:e,label:t,kind:`toggle`,min:0,max:1,def:n}),Ue=[`-2`,`-1`,`0`,`+1`,`+2`],We=[`VA`,`WAVESHAPE`,`FM`,`GRAIN`,`ADDITIVE`,`WAVETABLE`,`CHORDS`,`SPEECH`,`SWARM`,`NOISE`,`PARTICLE`,`STRING`,`MODAL`,`BASS DRUM`,`SNARE`,`HI-HAT`],Ge=[`WAVETABLE`,`MACRO`],Ke=[`PPG RESO`,`PPG SYNC`,`PPG DIGI`,`PPG PULSE`,`VOX AEIOU`,`VOX CHOIR`],qe=[`4 bars`,`2 bars`,`1 bar`,`1/2`,`1/4`,`1/4T`,`1/8`,`1/8T`,`1/16`,`1/16T`,`1/32`],Je=[16,8,4,2,1,2/3,1/2,1/3,1/4,1/6,1/8],Ye=e=>[C(`lfo${e}.rate`,`Rate`,.03,30,e===1?2:.5,`Hz`,`log`),C(`lfo${e}.level`,`Level`,0,1,1),w(`lfo${e}.shape`,`Shape`,[`sine`,`triangle`,`square`,`ramp up`,`ramp down`,`random`],`triangle`),He(`lfo${e}.sync`,`Tempo sync`),w(`lfo${e}.div`,`Division`,qe,`1/4`),w(`lfo${e}.retrig`,`Retrigger`,[`on`,`off`,`global`],`on`)],Xe=[w(`osc1.oct`,`Octave`,Ue,`0`),C(`osc1.tune`,`Tune`,-7,7,0,`st`),C(`osc1.width`,`Width`,0,1,0),C(`osc1.blend`,`Blend`,0,1,0),He(`osc1.sub`,`Sub`),w(`osc2.oct`,`Octave`,Ue,`0`),C(`osc2.tune`,`Tune`,-7,7,0,`st`),C(`osc2.width`,`Width`,0,1,0),C(`osc2.blend`,`Blend`,0,1,0),He(`osc2.sync`,`Sync to OSC 1`),w(`osc3.oct`,`Octave`,Ue,`0`),C(`osc3.tune`,`Tune`,-7,7,0,`st`),w(`osc3.table`,`Table`,Ke,`PPG RESO`),C(`osc3.pos`,`Position`,0,1,0),He(`osc3.interp`,`Interpolate`,1),w(`osc3.mode`,`Mode`,Ge,`WAVETABLE`),w(`osc3.model`,`Model`,We,`VA`),C(`osc3.harm`,`Harmonics`,0,1,.5),C(`osc3.timbre`,`Timbre`,0,1,.5),C(`osc3.morph`,`Morph`,0,1,.5),C(`osc3.aux`,`Out/aux`,0,1,0),C(`mix.osc1`,`OSC 1 level`,0,1,.8),C(`mix.osc2`,`OSC 2 level`,0,1,0),C(`mix.osc3`,`OSC 3 level`,0,1,0),C(`mix.noise`,`Noise level`,0,1,0),w(`noise.type`,`Noise`,[`white`,`pink`,`xor`],`white`),C(`drive`,`Drive`,0,1,0),He(`overdrive`,`Overdrive`),C(`lad.cutoff`,`Ladder cutoff`,20,2e4,2e3,`Hz`,`log`),C(`lad.res`,`Ladder resonance`,0,1,0),C(`lad.eg1`,`Ladder EG 1`,-1,1,.3),C(`sem.cutoff`,`SEM cutoff`,20,2e4,8e3,`Hz`,`log`),C(`sem.res`,`SEM resonance`,0,1,0),C(`sem.mode`,`SEM mode`,0,1,0),He(`sem.bp`,`SEM band-pass`),C(`sem.eg1`,`SEM EG 1`,-1,1,0),w(`filter.route`,`Filter routing`,[`off`,`series`,`parallel`],`off`),C(`filter.key`,`Key track`,-1,1,.5),C(`eg1.a`,`EG 1 attack`,.001,20,.005,`s`,`log`),C(`eg1.d`,`EG 1 decay`,.001,20,.3,`s`,`log`),C(`eg1.s`,`EG 1 sustain`,0,1,0),C(`eg1.r`,`EG 1 release`,.001,20,.3,`s`,`log`),C(`eg1.level`,`EG 1 level`,0,1,1),He(`eg1.reset`,`EG 1 reset`),C(`eg2.a`,`EG 2 attack`,.001,20,.003,`s`,`log`),C(`eg2.d`,`EG 2 decay`,.001,20,.3,`s`,`log`),C(`eg2.s`,`EG 2 sustain`,0,1,1),C(`eg2.r`,`EG 2 release`,.001,20,.15,`s`,`log`),C(`eg2.level`,`EG 2 level`,0,1,1),He(`eg2.reset`,`EG 2 reset`),He(`eg2.drone`,`Drone`),...Ye(1),...Ye(2),C(`out.level`,`Level`,0,1,.8),C(`out.pan`,`Pan`,-1,1,0),C(`out.spin`,`Spin`,-1,1,0),C(`out.morph`,`Morph`,0,1,0),w(`voice.mode`,`Voice mode`,[`poly`,`mono`,`legato`],`poly`),w(`voice.unison`,`Unison`,[`1`,`2`,`3`,`4`],`1`),C(`voice.detune`,`Unison detune`,0,1,.3),C(`voice.glide`,`Glide`,0,2,0,`s`),C(`voice.bend`,`Bend range`,0,24,2,`st`),w(`panner.mode`,`Panner`,[`off`,`spread`,`ping-pong`],`off`),C(`panner.width`,`Panner width`,0,1,.7),C(`mod.time`,`Time ramp`,.06,240,4,`s`,`log`)],Ze=[`eg1`,`eg2`,`lfo1`,`lfo2`,`wave`,`kbd`,`vel`,`aft`,`mod`,`exp`,`pan`,`time`,`cc`,`seq`,`rand`,`set`],Qe=[[`osc1.tune`,`pitch`],[`osc1.width`,`lin`],[`osc1.blend`,`lin`],[`mix.osc1`,`lin`],[`osc2.tune`,`pitch`],[`osc2.width`,`lin`],[`osc2.blend`,`lin`],[`mix.osc2`,`lin`],[`osc3.tune`,`pitch`],[`osc3.pos`,`lin`],[`osc3.harm`,`lin`],[`osc3.timbre`,`lin`],[`osc3.morph`,`lin`],[`mix.osc3`,`lin`],[`mix.noise`,`lin`],[`lfo1.rate`,`rate`],[`lfo1.level`,`lin`],[`lfo2.rate`,`rate`],[`lfo2.level`,`lin`],[`lad.cutoff`,`freq`],[`lad.res`,`lin`],[`sem.cutoff`,`freq`],[`sem.res`,`lin`],[`sem.mode`,`lin`],[`drive`,`lin`],[`eg1.a`,`time`],[`eg1.d`,`time`],[`eg1.s`,`lin`],[`eg1.r`,`time`],[`eg1.level`,`lin`],[`eg2.a`,`time`],[`eg2.d`,`time`],[`eg2.s`,`lin`],[`eg2.r`,`time`],[`eg2.level`,`lin`],[`out.morph`,`lin`],[`out.pan`,`lin`]],$e=Object.fromEntries(Xe.map(e=>[e.id,e.def])),et=`moa-rig`,tt=Xe.map(e=>[e.id,e.def,e.min,e.max,e.kind===`number`?e.curve===`log`?2:1:0]),nt=`
const RIG_PARAM_DEFS = ${JSON.stringify(tt)};
const RIG_NP = RIG_PARAM_DEFS.length;
const RIG_P = {};
RIG_PARAM_DEFS.forEach((d, i) => { RIG_P[d[0]] = i; });
const RIG_DEFAULTS = {};
for (const d of RIG_PARAM_DEFS) RIG_DEFAULTS[d[0]] = d[1];
const RIG_SRC = ${JSON.stringify(Ze)};
const RIG_DEST = ${JSON.stringify(Qe)};
const RIG_NSRC = RIG_SRC.length, RIG_NDEST = RIG_DEST.length;
const RIG_S = {};
RIG_SRC.forEach((s, i) => { RIG_S[s] = i; });
const RIG_D = {};
RIG_DEST.forEach((d, i) => { RIG_D[d[0]] = i; });
const RIG_DEST_PARAM = Int32Array.from(RIG_DEST.map((d) => RIG_P[d[0]]));
// 0 pitch, 1 freq, 2 rate, 3 time, 4 lin (see RIG_DESTS)
const RIG_DEST_KIND = Int32Array.from(RIG_DEST.map((d) => ['pitch', 'freq', 'rate', 'time', 'lin'].indexOf(d[1])));
const RIG_DIV_BEATS = ${JSON.stringify(Je)};
const RIG_TABLE_NAMES = ${JSON.stringify(Ke)};
const RIG_CTRL = 8;
const RIG_MAX_BLOCK = 512;

// param indices the voice reads every tick
const Q_O1_OCT = RIG_P['osc1.oct'], Q_O1_TUNE = RIG_P['osc1.tune'], Q_O1_W = RIG_P['osc1.width'], Q_O1_B = RIG_P['osc1.blend'], Q_O1_SUB = RIG_P['osc1.sub'];
const Q_O2_OCT = RIG_P['osc2.oct'], Q_O2_TUNE = RIG_P['osc2.tune'], Q_O2_W = RIG_P['osc2.width'], Q_O2_B = RIG_P['osc2.blend'], Q_O2_SYNC = RIG_P['osc2.sync'];
const Q_O3_MODE = RIG_P['osc3.mode'], Q_O3_MODEL = RIG_P['osc3.model'], Q_O3_HARM = RIG_P['osc3.harm'];
const Q_O3_TIMBRE = RIG_P['osc3.timbre'], Q_O3_MORPH = RIG_P['osc3.morph'], Q_O3_AUX = RIG_P['osc3.aux'];
// Plaits' engines (PL_ENGINES, from the Plaits worklet source), if the module has them
const RIG_HAS_MACRO = typeof PL_ENGINES !== 'undefined';
const Q_O3_OCT = RIG_P['osc3.oct'], Q_O3_TUNE = RIG_P['osc3.tune'], Q_O3_TAB = RIG_P['osc3.table'], Q_O3_POS = RIG_P['osc3.pos'], Q_O3_INT = RIG_P['osc3.interp'];
const Q_M1 = RIG_P['mix.osc1'], Q_M2 = RIG_P['mix.osc2'], Q_M3 = RIG_P['mix.osc3'], Q_MN = RIG_P['mix.noise'], Q_NTYPE = RIG_P['noise.type'];
const Q_DRIVE = RIG_P['drive'], Q_OD = RIG_P['overdrive'];
const Q_LCUT = RIG_P['lad.cutoff'], Q_LRES = RIG_P['lad.res'], Q_LEG = RIG_P['lad.eg1'];
const Q_SCUT = RIG_P['sem.cutoff'], Q_SRES = RIG_P['sem.res'], Q_SMODE = RIG_P['sem.mode'], Q_SBP = RIG_P['sem.bp'], Q_SEG = RIG_P['sem.eg1'];
const Q_ROUTE = RIG_P['filter.route'], Q_KEY = RIG_P['filter.key'];
const Q_E1 = [RIG_P['eg1.a'], RIG_P['eg1.d'], RIG_P['eg1.s'], RIG_P['eg1.r'], RIG_P['eg1.level'], RIG_P['eg1.reset']];
const Q_E2 = [RIG_P['eg2.a'], RIG_P['eg2.d'], RIG_P['eg2.s'], RIG_P['eg2.r'], RIG_P['eg2.level'], RIG_P['eg2.reset']];
const Q_DRONE = RIG_P['eg2.drone'];
const Q_L = [1, 2].map((k) => [RIG_P['lfo' + k + '.rate'], RIG_P['lfo' + k + '.level'], RIG_P['lfo' + k + '.shape'], RIG_P['lfo' + k + '.sync'], RIG_P['lfo' + k + '.div'], RIG_P['lfo' + k + '.retrig']]);
const Q_LEVEL = RIG_P['out.level'], Q_PAN = RIG_P['out.pan'], Q_SPIN = RIG_P['out.spin'], Q_MORPH = RIG_P['out.morph'];
const Q_MODE = RIG_P['voice.mode'], Q_UNI = RIG_P['voice.unison'], Q_DET = RIG_P['voice.detune'], Q_GLIDE = RIG_P['voice.glide'], Q_BEND = RIG_P['voice.bend'];
const Q_PANNER = RIG_P['panner.mode'], Q_PWIDTH = RIG_P['panner.width'], Q_TIME = RIG_P['mod.time'];

// mod destinations the voice reads
const D_O1_TUNE = RIG_D['osc1.tune'], D_O2_TUNE = RIG_D['osc2.tune'], D_O3_TUNE = RIG_D['osc3.tune'];
const D_LCUT = RIG_D['lad.cutoff'], D_SCUT = RIG_D['sem.cutoff'];
const D_L_RATE = [RIG_D['lfo1.rate'], RIG_D['lfo2.rate']];
const D_E1 = [RIG_D['eg1.a'], RIG_D['eg1.d'], RIG_D['eg1.s'], RIG_D['eg1.r'], RIG_D['eg1.level']];
const D_E2 = [RIG_D['eg2.a'], RIG_D['eg2.d'], RIG_D['eg2.s'], RIG_D['eg2.r'], RIG_D['eg2.level']];
const D_MORPH = RIG_D['out.morph'], D_PAN = RIG_D['out.pan'];
const S_EG1 = RIG_S.eg1, S_EG2 = RIG_S.eg2, S_LFO1 = RIG_S.lfo1, S_LFO2 = RIG_S.lfo2, S_WAVE = RIG_S.wave, S_KBD = RIG_S.kbd;
const S_VEL = RIG_S.vel, S_AFT = RIG_S.aft, S_MOD = RIG_S.mod, S_EXP = RIG_S.exp, S_PANNER = RIG_S.pan, S_TIME = RIG_S.time;
const S_CC = RIG_S.cc, S_SEQ = RIG_S.seq, S_RAND = RIG_S.rand, S_SET = RIG_S.set;

function rigTanh(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

// PolyBLEP: the correction for an upward step of 2 at phase 0 (t = phase, dt = increment)
function rigBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// PolyBLAMP: the correction for a corner at phase 0 where the slope rises by one unit per sample
function rigBlamp(t, dt) {
  if (t < dt) { t = t / dt - 1; return -t * t * t / 3; }
  if (t > 1 - dt) { t = (t - 1) / dt + 1; return t * t * t / 3; }
  return 0;
}

// ---- wavetables: 32 frames each, built from a spectrum, one band-limited copy per octave

function rigFft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const br = re[b] * cr - im[b] * ci, bi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - br; im[b] = im[a] - bi;
        re[a] += br; im[a] += bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const RIG_FRAMES = 32, RIG_LEVELS = 10;

// Formants (Hz) of five vowels, and their bandwidths and levels.
const RIG_MALE = { A: [730, 1090, 2440], E: [530, 1840, 2480], I: [270, 2290, 3010], O: [570, 840, 2410], U: [300, 870, 2240] };
const RIG_FEMALE = { A: [850, 1220, 2810], E: [610, 1900, 2530], I: [310, 2790, 3310], O: [590, 920, 2710], U: [370, 950, 2670] };

// Harmonic amplitudes of a voice at f0 singing through the vowels in order, t scanning from the first to the last.
function rigVowels(t, set, order, f0, tilt, bw) {
  const pos = t * (order.length - 1), i = Math.min(order.length - 2, Math.floor(pos)), fr = pos - i;
  const va = set[order[i]], vb = set[order[i + 1]];
  const f = [0, 1, 2].map((k) => Math.exp(Math.log(va[k]) + (Math.log(vb[k]) - Math.log(va[k])) * fr));
  const gains = [1, 0.55, 0.3];
  const amps = new Float64Array(1025);
  for (let h = 1; h <= 1024; h++) {
    const hz = h * f0;
    let a = 0.04;
    for (let k = 0; k < 3; k++) { const d = (hz - f[k]) / (bw[k] / 2); a += gains[k] / (1 + d * d); }
    amps[h] = a / Math.pow(h, tilt) * (hz > 6000 ? Math.exp(-(hz - 6000) / 1500) : 1);
  }
  return { amps };
}

// One generator per table in RIG_TABLE_NAMES; t runs 0..1 across the frames. Each returns a single cycle
// (wave, 2048 samples) or sine amplitudes by harmonic (amps, index 1..1024).
const RIG_GENS = [
  // PPG RESO: a saw whose harmonics swell around a peak that climbs from the 2nd to about the 48th
  (t) => {
    const amps = new Float64Array(1025), c = 2 + 46 * Math.pow(t, 1.5), w = 1 + 0.15 * c;
    for (let h = 1; h <= 1024; h++) amps[h] = (0.35 + 6 * Math.exp(-((h - c) / w) * ((h - c) / w))) / h;
    return { amps };
  },
  // PPG SYNC: a saw hard-synced to the cycle, the slave from one to eight times as fast
  (t) => {
    const wave = new Float64Array(2048), r = 1 + 7 * t;
    for (let i = 0; i < 2048; i++) { const p = (i / 2048) * r; wave[i] = 2 * (p - Math.floor(p)) - 1; }
    return { wave };
  },
  // PPG DIGI: a phase-bent sine on fewer and fewer steps
  (t) => {
    const wave = new Float64Array(2048), q = Math.round(2 + 14 * (1 - t));
    for (let i = 0; i < 2048; i++) {
      const x = 2 * Math.PI * i / 2048;
      wave[i] = Math.round(Math.sin(x + t * 2.5 * Math.sin(x)) * q) / q;
    }
    return { wave };
  },
  // PPG PULSE: from a square to a 2 % sliver
  (t) => {
    const wave = new Float64Array(2048), pw = 0.5 - 0.48 * t;
    for (let i = 0; i < 2048; i++) wave[i] = i / 2048 < pw ? 1 : -1;
    return { wave };
  },
  // VOX AEIOU: a man's voice through the five vowels
  (t) => rigVowels(t, RIG_MALE, 'AEIOU', 110, 1, [90, 110, 160]),
  // VOX CHOIR: a softer, higher voice, oo to ee
  (t) => rigVowels(t, RIG_FEMALE, 'UOAEI', 220, 1.3, [130, 160, 220]),
];

// Level j keeps harmonics up to 1024 >> j, in a table of size max(128, min(2048, 4 * that)) (a power of two).
function rigBuildTable(gen) {
  const levels = [];
  for (let j = 0; j < RIG_LEVELS; j++) {
    const h = 1024 >> j, size = Math.max(128, Math.min(2048, 4 * h));
    levels.push({ h, size, data: new Float32Array(size * RIG_FRAMES) });
  }
  const re = new Float64Array(2048), im = new Float64Array(2048);
  const yr = new Float64Array(1025), yi = new Float64Array(1025);
  const work = {};
  for (let f = 0; f < RIG_FRAMES; f++) {
    const g = gen(f / (RIG_FRAMES - 1));
    if (g.wave) {
      re.set(g.wave); im.fill(0);
      rigFft(re, im, false);
      for (let k = 1; k <= 1024; k++) { yr[k] = re[k] / 2048; yi[k] = im[k] / 2048; }
    } else {
      for (let k = 1; k <= 1024; k++) { yr[k] = 0; yi[k] = -g.amps[k] / 2; }
    }
    let peak = 0;
    for (const lv of levels) {
      const s = lv.size;
      const w = work[s] || (work[s] = [new Float64Array(s), new Float64Array(s)]);
      const wr = w[0], wi = w[1];
      wr.fill(0); wi.fill(0);
      for (let k = 1; k <= Math.min(lv.h, s / 2 - 1); k++) { wr[k] = yr[k]; wi[k] = yi[k]; wr[s - k] = yr[k]; wi[s - k] = -yi[k]; }
      rigFft(wr, wi, true);
      if (lv === levels[0]) for (let i = 0; i < s; i++) peak = Math.max(peak, Math.abs(wr[i]));
      const scale = peak > 0 ? 1 / peak : 1;
      for (let i = 0; i < s; i++) lv.data[f * s + i] = wr[i] * scale;
    }
  }
  return levels;
}

let RIG_TABLE_CACHE = null;
function rigTables() {
  if (!RIG_TABLE_CACHE) RIG_TABLE_CACHE = RIG_GENS.map(rigBuildTable);
  return RIG_TABLE_CACHE;
}

// ---- one voice

class RigVoice {
  constructor(seed) {
    this.part = -1;
    this.active = false;
    this.gate = false;
    this.note = 60; this.target = 60; this.pitch = 60;
    this.vel = 0; this.age = 0; this.uni = 0; this.uniN = 1;
    this.panPos = 0; this.rand = 0; this.time = 0;
    this.p1 = 0; this.p2 = 0; this.p3 = 0; this.sub = 1;
    this.e1 = 0; this.st1 = 0; this.e2 = 0; this.st2 = 0;
    this.lph = [0, 0]; this.lval = [0, 0]; this.lhold = [0, 0];
    this.ld0 = 0; this.ld1 = 0; this.ld2 = 0; this.ld3 = 0;
    this.v1 = 0; this.v2 = 0;
    this.b0 = 0; this.b1 = 0; this.b2 = 0;
    this.seed = seed >>> 0 || 1;
    this.w3 = 0;
    // OSC 3 in MACRO mode: a Plaits engine of this voice's own (made when a model is first chosen)
    this.macro = null; this.macroModel = -1; this.macroTrig = false;
    this.mOut = new Float32Array(RIG_CTRL); this.mAux = new Float32Array(RIG_CTRL);
    this.mp = { trigger: 0, note: 60, timbre: 0.5, morph: 0.5, harmonics: 0.5, accent: 0.8 };
    this.mLimOut = null; this.mLimAux = null;
    this.q = new Float64Array(RIG_NP);
    this.md = new Float64Array(RIG_NDEST);
    this.src = new Float64Array(RIG_NSRC);
  }
  noise() {
    let x = this.seed;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    this.seed = x;
    return x / 2147483648 - 1;
  }
}

function rigClamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

class RigCore {
  constructor(sampleRate, voices = 24, parts = 16, random = Math.random) {
    this.sr = sampleRate;
    this.random = random;
    if (typeof plSetSampleRate === 'function') plSetSampleRate(sampleRate);
    this.bpm = 120;
    this.clock = 0;
    // timed messages ({ frame, m }) in time order, and the absolute frame the next block starts on
    this.queue = [];
    this.frame = 0;
    // the frame a message handled now takes effect on (inside a block, where the block was split for it)
    this.at = 0;
    // kit parts: a MOA-60 sampler each (SamplerCore, from the sampler's worklet source), all sharing one store of sounds
    this.samples = new Map();
    this.kits = [];
    this.kitL = new Float32Array(RIG_MAX_BLOCK);
    this.kitR = new Float32Array(RIG_MAX_BLOCK);
    // the mixer and effects (RigMixer, from the mixer's worklet source); without it the parts are simply summed
    this.mix = typeof RigMixer === 'function' ? new RigMixer(sampleRate, parts) : null;
    this.tables = rigTables();
    this.voices = [];
    for (let i = 0; i < voices; i++) {
      const v = new RigVoice(Math.floor(random() * 4294967295) + i);
      for (let k = 0; k < 2; k++) v.lph[k] = random();
      this.voices.push(v);
    }
    this.parts = [];
    this.partL = [];
    this.partR = [];
    for (let p = 0; p < parts; p++) {
      const a = new Float64Array(RIG_NP), b = new Float64Array(RIG_NP);
      for (let i = 0; i < RIG_NP; i++) { a[i] = RIG_PARAM_DEFS[i][1]; b[i] = a[i]; }
      this.parts.push({
        a, b, baseA: Float64Array.from(a), baseB: Float64Array.from(b), locks: new Map(),
        routes: [], fm1: [0, 0], fm2: [0, 0],
        ctrl: { bend: 0, mod: 0, aft: 0, exp: 0, cc: 0, seq: 0 },
        voices: [], stack: [], lastNote: 60, panIdx: 0, lfoPh: [0, 0],
      });
      this.partL.push(new Float32Array(RIG_MAX_BLOCK));
      this.partR.push(new Float32Array(RIG_MAX_BLOCK));
    }
    const all = new Array(parts).fill(0);
    all[0] = voices;
    this.setLayout(all);
  }

  // Voices per part, handed out from the pool in part order; whatever does not fit is left off.
  setLayout(counts) {
    let next = 0;
    for (const v of this.voices) { v.part = -1; v.active = false; v.gate = false; v.st1 = 0; v.st2 = 0; v.e1 = 0; v.e2 = 0; }
    this.parts.forEach((pt, p) => {
      pt.voices = [];
      pt.stack = [];
      const want = Math.max(0, Math.floor(counts[p] || 0));
      for (let k = 0; k < want && next < this.voices.length; k++) {
        const v = this.voices[next++];
        v.part = p;
        pt.voices.push(v);
      }
    });
  }

  // a, b: { params: { id: value }, matrix: [{ source, dest, amount }] }; with no b, side B is a copy of A.
  setPatch(part, a, b) {
    const pt = this.parts[part];
    const sb = b || a;
    for (let i = 0; i < RIG_NP; i++) {
      const id = RIG_PARAM_DEFS[i][0], def = RIG_PARAM_DEFS[i][1];
      const va = a.params[id], vb = sb.params[id];
      pt.baseA[i] = va === undefined ? def : va;
      pt.baseB[i] = vb === undefined ? def : vb;
    }
    this.applyLocks(pt);
    const map = new Map();
    const add = (list, side) => {
      for (const r of list || []) {
        const s = RIG_S[r.source], d = RIG_D[r.dest];
        if (s === undefined || d === undefined) continue;
        const key = s * RIG_NDEST + d;
        let e = map.get(key);
        if (!e) { e = { s, d, a: 0, b: 0, sens: 0 }; map.set(key, e); }
        e[side] += r.amount;
      }
    };
    add(a.matrix, 'a');
    add(sb.matrix, 'b');
    pt.routes = [];
    pt.fm1 = [0, 0];
    pt.fm2 = [0, 0];
    for (const e of map.values()) {
      // WAVE into OSC 1 or 2's tune is audio-rate FM, done per sample rather than at the tick
      if (e.s === S_WAVE && e.d === D_O1_TUNE) { pt.fm1 = [e.a, e.b]; continue; }
      if (e.s === S_WAVE && e.d === D_O2_TUNE) { pt.fm2 = [e.a, e.b]; continue; }
      if (e.s === S_VEL && (e.d === D_E1[4] || e.d === D_E2[4])) e.sens = 1;
      pt.routes.push(e);
    }
  }

  // A part becomes a kit ('kit'), its notes 36 to 51 playing pads 1 to 16, or goes back to being a synth ('synth').
  setKind(part, kind) {
    if (!this.parts[part]) return;
    this.allNotesOff(part);
    if (kind === 'kit') {
      if (this.kits[part]) return;
      const k = new SamplerCore(this.sr);
      k.samples = this.samples;
      this.kits[part] = k;
    } else this.kits[part] = null;
  }

  addSample(id, rate, channels) {
    this.samples.set(id, { rate, channels, length: channels[0] ? channels[0].length : 0 });
  }

  dropSample(id) {
    this.samples.delete(id);
    for (const k of this.kits) if (k) k.voices = k.voices.filter((v) => v.sample !== id);
  }

  setPad(part, pad, settings) {
    const k = this.kits[part];
    if (k) k.setPad(pad, settings);
  }

  // A sequencer step's parameter locks ({ id: value }): they hold the params on both sides until the next call.
  setLocks(part, locks) {
    const pt = this.parts[part];
    if (!pt) return;
    pt.locks = new Map();
    for (const id in locks || {}) if (RIG_P[id] !== undefined) pt.locks.set(RIG_P[id], locks[id]);
    this.applyLocks(pt);
  }

  applyLocks(pt) {
    pt.a.set(pt.baseA);
    pt.b.set(pt.baseB);
    for (const [i, v] of pt.locks) { pt.a[i] = v; pt.b[i] = v; }
  }

  // A message from the device; with a frame (an absolute sample time) it waits for that sample.
  post(m, frame) {
    if (frame === undefined || frame <= this.frame) { this.at = this.frame; this.handle(m); return; }
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].frame > frame) i--;
    this.queue.splice(i, 0, { frame, m });
  }

  handle(m) {
    if (m.type === 'patch') this.setPatch(m.part, m.a, m.b);
    else if (m.type === 'layout') this.setLayout(m.counts);
    else if (m.type === 'on') this.noteOn(m.part, m.note, m.vel);
    else if (m.type === 'off') this.noteOff(m.part, m.note);
    else if (m.type === 'lock') this.setLocks(m.part, m.locks);
    else if (m.type === 'kind') this.setKind(m.part, m.kind);
    else if (m.type === 'sample') this.addSample(m.id, m.rate, m.channels);
    else if (m.type === 'drop') this.dropSample(m.id);
    else if (m.type === 'pad') this.setPad(m.part, m.pad, m.settings);
    else if (m.type === 'ctrl') this.setControl(m.part, m.name, m.value);
    else if (m.type === 'bpm') this.bpm = m.bpm;
    else if (m.type === 'mix') { if (this.mix) this.mix.set(m.id, m.value); }
    else if (m.type === 'flush') this.queue = [];
    else if (m.type === 'panic') { this.queue = []; for (let p = 0; p < this.parts.length; p++) this.allNotesOff(p); }
  }

  setControl(part, name, value) {
    const c = this.parts[part].ctrl;
    if (name in c) c[name] = value;
  }

  // The voice to take for a new note in poly: a free one, else the oldest releasing, else the oldest.
  pick(pt, taken) {
    let best = null, bestScore = Infinity;
    for (const v of pt.voices) {
      if (taken.indexOf(v) >= 0) continue;
      const score = !v.active ? -1e15 + v.age : !v.gate ? -1e14 + v.age : v.age;
      if (score < bestScore) { bestScore = score; best = v; }
    }
    return best;
  }

  start(v, pt, note, vel, retrig) {
    const a = pt.a;
    v.vel = vel;
    v.target = note;
    if (retrig) {
      v.age = this.clock++;
      v.time = 0;
      v.macroTrig = true;
      v.rand = this.random() * 2 - 1;
      if (a[Q_E1[5]] >= 0.5) v.e1 = 0;
      if (a[Q_E2[5]] >= 0.5) v.e2 = 0;
      v.st1 = 1; v.st2 = 1;
      for (let k = 0; k < 2; k++) if (a[Q_L[k][5]] === 0) { v.lph[k] = 0; v.lhold[k] = this.random() * 2 - 1; }
    }
    v.gate = true;
    v.active = true;
  }

  noteOn(part, note, vel = 1) {
    const kit = this.kits[part];
    if (kit) { if (note >= 36 && note < 52) kit.hit(note - 36, vel, this.at); return; }
    const pt = this.parts[part];
    if (!pt || pt.voices.length === 0) return;
    const a = pt.a;
    const mode = a[Q_MODE], uniN = Math.min(pt.voices.length, Math.round(a[Q_UNI]) + 1);
    let pos = 0;
    const pm = a[Q_PANNER], w = a[Q_PWIDTH];
    if (pm === 1) pos = w * [-1, 0.5, -0.5, 1, 0][pt.panIdx++ % 5];
    else if (pm === 2) pos = w * (pt.panIdx++ % 2 ? 1 : -1);
    if (mode === 0) {
      const taken = [];
      for (let u = 0; u < uniN; u++) {
        const v = this.pick(pt, taken);
        if (!v) break;
        taken.push(v);
        v.note = note;
        v.uni = u; v.uniN = uniN;
        v.panPos = pos;
        if (a[Q_GLIDE] <= 0 || !v.active) v.pitch = a[Q_GLIDE] > 0 ? pt.lastNote : note;
        this.start(v, pt, note, vel, true);
      }
    } else {
      const held = pt.stack.length > 0;
      pt.stack = pt.stack.filter((x) => x !== note);
      pt.stack.push(note);
      const retrig = !(mode === 2 && held);
      for (let u = 0; u < uniN; u++) {
        const v = pt.voices[u];
        v.note = note;
        v.uni = u; v.uniN = uniN;
        if (retrig) v.panPos = pos;
        if (a[Q_GLIDE] <= 0) v.pitch = note;
        this.start(v, pt, note, vel, retrig);
      }
    }
    pt.lastNote = note;
  }

  noteOff(part, note) {
    const kit = this.kits[part];
    if (kit) { if (note >= 36 && note < 52) kit.release(note - 36, this.at); return; }
    const pt = this.parts[part];
    if (!pt) return;
    if (pt.a[Q_MODE] === 0) {
      for (const v of pt.voices) if (v.gate && v.note === note) { v.gate = false; v.st1 = 3; v.st2 = 3; }
      return;
    }
    const top = pt.stack[pt.stack.length - 1];
    pt.stack = pt.stack.filter((x) => x !== note);
    if (pt.stack.length > 0) {
      if (top === note) {
        const back = pt.stack[pt.stack.length - 1];
        for (const v of pt.voices) if (v.gate) { v.note = back; v.target = back; if (pt.a[Q_GLIDE] <= 0) v.pitch = back; }
      }
      return;
    }
    for (const v of pt.voices) if (v.gate) { v.gate = false; v.st1 = 3; v.st2 = 3; }
  }

  allNotesOff(part) {
    if (this.kits[part]) this.kits[part].stopAll();
    const pt = this.parts[part];
    pt.stack = [];
    for (const v of pt.voices) if (v.gate) { v.gate = false; v.st1 = 3; v.st2 = 3; }
  }

  // Number of voices sounding in a part.
  sounding(part) {
    return this.parts[part].voices.filter((v) => v.active).length;
  }

  // Renders n samples, handling the queued messages on their samples (the block is split at each).
  process(outL, outR, n) {
    let at = 0;
    while (at < n) {
      this.at = this.frame + at;
      while (this.queue.length && this.queue[0].frame <= this.frame + at) this.handle(this.queue.shift().m);
      const next = this.queue.length ? this.queue[0].frame - this.frame : n;
      const end = Math.min(n, Math.max(at + 1, next));
      if (at === 0 && end === n) this.render(outL, outR, 0, n);
      else this.render(outL, outR, at, end - at);
      at = end;
    }
    // the kits play their hits on their own frames, so they render the whole block at once
    for (let p = 0; p < this.kits.length; p++) {
      const k = this.kits[p];
      if (!k || (!k.voices.length && !k.queue.length)) continue;
      const L = this.kitL.subarray(0, n), R = this.kitR.subarray(0, n), pL = this.partL[p], pR = this.partR[p];
      k.frame = this.frame;
      k.process(L, R, n, 1);
      for (let i = 0; i < n; i++) { pL[i] += L[i]; pR[i] += R[i]; outL[i] += L[i]; outR[i] += R[i]; }
    }
    if (this.mix) this.mix.process(this.partL, this.partR, outL, outR, n, this.bpm);
    this.frame += n;
  }

  // Renders len samples into out (and each part's buffer) from sample off.
  render(outL, outR, off, len) {
    const whole = off === 0;
    const n = len;
    for (let p = 0; p < this.parts.length; p++) { this.partL[p].fill(0, off, off + n); this.partR[p].fill(0, off, off + n); }
    for (const pt of this.parts) {
      for (let k = 0; k < 2; k++) {
        const a = pt.a, L = Q_L[k];
        const rate = a[L[3]] >= 0.5 ? this.bpm / 60 / RIG_DIV_BEATS[a[L[4]]] : a[L[0]];
        pt.lfoPh[k] = (pt.lfoPh[k] + rate * n / this.sr) % 1;
      }
    }
    for (const v of this.voices) {
      if (!v.active || v.part < 0) continue;
      const L = this.partL[v.part], R = this.partR[v.part];
      this.runVoice(v, this.parts[v.part], whole ? L : L.subarray(off), whole ? R : R.subarray(off), n);
    }
    for (let i = off; i < off + n; i++) {
      let l = 0, r = 0;
      for (let p = 0; p < this.parts.length; p++) { l += this.partL[p][i]; r += this.partR[p][i]; }
      outL[i] = l;
      outR[i] = r;
    }
  }

  runVoice(v, pt, busL, busR, n) {
    const sr = this.sr, A = pt.a, B = pt.b, q = v.q, md = v.md, src = v.src, ctl = pt.ctrl;
    const drone = A[Q_DRONE] >= 0.5;
    for (let at = 0; at < n; at += RIG_CTRL) {
      const len = Math.min(RIG_CTRL, n - at);
      const tick = len / sr;

      // ---- sources (envelopes and LFOs as the last tick left them)
      src[S_EG1] = v.e1 * q[Q_E1[4]];
      src[S_EG2] = v.e2 * q[Q_E2[4]];
      src[S_WAVE] = v.w3;
      src[S_KBD] = (v.note - 60) / 64;
      src[S_VEL] = v.vel;
      src[S_AFT] = ctl.aft; src[S_MOD] = ctl.mod; src[S_EXP] = ctl.exp; src[S_CC] = ctl.cc; src[S_SEQ] = ctl.seq;
      src[S_PANNER] = v.panPos;
      src[S_RAND] = v.rand;
      src[S_SET] = 1;

      // ---- the matrix, at the morph the knob sets; then the morph the matrix moves
      const m0 = A[Q_MORPH];
      md.fill(0);
      let sensE1 = 1, sensE2 = 1;
      for (const r of pt.routes) {
        const amt = r.a + (r.b - r.a) * m0;
        if (amt === 0) continue;
        if (r.sens) {
          const s = Math.abs(amt), f = (1 - s) + s * (amt > 0 ? v.vel : 1 - v.vel);
          if (r.d === D_E1[4]) sensE1 *= f; else sensE2 *= f;
          continue;
        }
        md[r.d] += amt * src[r.s];
      }
      const m = rigClamp(m0 + md[D_MORPH], 0, 1);
      for (let i = 0; i < RIG_NP; i++) {
        const blend = RIG_PARAM_DEFS[i][4], x = A[i], y = B[i];
        q[i] = m === 0 || x === y ? x : blend === 0 ? (m < 0.5 ? x : y) : blend === 2 && x > 0 && y > 0 ? x * Math.pow(y / x, m) : x + (y - x) * m;
      }
      for (let d = 0; d < RIG_NDEST; d++) {
        const kind = RIG_DEST_KIND[d];
        if (md[d] === 0 || kind !== 4) continue;
        const pi = RIG_DEST_PARAM[d], lo = RIG_PARAM_DEFS[pi][2], hi = RIG_PARAM_DEFS[pi][3];
        q[pi] = rigClamp(q[pi] + md[d] * (hi - lo), d === D_PAN ? -2 : lo, d === D_PAN ? 2 : hi);
      }
      for (let d = 0; d < RIG_NDEST; d++) {
        if (md[d] === 0) continue;
        const kind = RIG_DEST_KIND[d], pi = RIG_DEST_PARAM[d];
        if (kind === 2) q[pi] *= Math.pow(2, 5 * md[d]);
        else if (kind === 3) q[pi] = rigClamp(q[pi] * Math.pow(2, 8 * md[d]), 0.0005, 30);
      }
      // mixer levels go bipolar under modulation (a negative level inverts the source)
      const lv1 = rigClamp(A[Q_M1] + (B[Q_M1] - A[Q_M1]) * m + md[RIG_D['mix.osc1']], -1, 1);
      const lv2 = rigClamp(A[Q_M2] + (B[Q_M2] - A[Q_M2]) * m + md[RIG_D['mix.osc2']], -1, 1);
      const lv3 = rigClamp(A[Q_M3] + (B[Q_M3] - A[Q_M3]) * m + md[RIG_D['mix.osc3']], -1, 1);
      const lvn = rigClamp(A[Q_MN] + (B[Q_MN] - A[Q_MN]) * m + md[RIG_D['mix.noise']], -1, 1);

      // ---- LFOs
      for (let k = 0; k < 2; k++) {
        const L = Q_L[k];
        const rate = q[L[3]] >= 0.5 ? this.bpm / 60 / RIG_DIV_BEATS[q[L[4]]] * Math.pow(2, 5 * md[D_L_RATE[k]]) : q[L[0]];
        let ph;
        if (q[L[5]] === 2) {
          ph = pt.lfoPh[k];
        } else {
          ph = v.lph[k] + rate * tick;
          if (ph >= 1) { ph -= Math.floor(ph); v.lhold[k] = this.random() * 2 - 1; }
          v.lph[k] = ph;
        }
        const shape = q[L[2]];
        const x = shape === 0 ? Math.sin(2 * Math.PI * ph)
          : shape === 1 ? (ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4)
          : shape === 2 ? (ph < 0.5 ? 1 : -1)
          : shape === 3 ? 2 * ph - 1
          : shape === 4 ? 1 - 2 * ph
          : v.lhold[k];
        v.lval[k] = x * q[L[1]];
      }
      src[S_LFO1] = v.lval[0];
      src[S_LFO2] = v.lval[1];
      v.time += tick;
      src[S_TIME] = Math.min(1, v.time / q[Q_TIME]);

      // ---- pitch
      const glide = q[Q_GLIDE];
      v.pitch = glide > 0 ? v.pitch + (v.target - v.pitch) * (1 - Math.exp(-tick * 4.6 / glide)) : v.target;
      const spread = v.uniN > 1 ? (v.uni / (v.uniN - 1)) * 2 - 1 : 0;
      const base = v.pitch + ctl.bend * q[Q_BEND] + spread * q[Q_DET] * 0.4;
      const hz = (st) => 440 * Math.pow(2, (st - 69) / 12);
      const lim = 0.45;
      const dt1 = Math.min(lim, hz(base + (q[Q_O1_OCT] - 2) * 12 + q[Q_O1_TUNE] + md[D_O1_TUNE] * 64) / sr);
      const dt2 = Math.min(lim, hz(base + (q[Q_O2_OCT] - 2) * 12 + q[Q_O2_TUNE] + md[D_O2_TUNE] * 64) / sr);
      const dt3 = Math.min(lim, hz(base + (q[Q_O3_OCT] - 2) * 12 + q[Q_O3_TUNE] + md[D_O3_TUNE] * 64) / sr);
      const fm1 = (pt.fm1[0] + (pt.fm1[1] - pt.fm1[0]) * m) * 64 / 12, fm2 = (pt.fm2[0] + (pt.fm2[1] - pt.fm2[0]) * m) * 64 / 12;
      const w1 = rigClamp(q[Q_O1_W], 0, 1), w2 = rigClamp(q[Q_O2_W], 0, 1);
      const bl1 = rigClamp(q[Q_O1_B], 0, 1), bl2 = rigClamp(q[Q_O2_B], 0, 1);
      const sub = q[Q_O1_SUB] >= 0.5, sync = q[Q_O2_SYNC] >= 0.5;
      const k1base = 1 - 0.5 * w1, k2base = 1 - 0.5 * w2;
      const pw1 = 0.5 - 0.45 * w1, pw2 = 0.5 - 0.45 * w2;

      // OSC 3: the octave's band-limited copy, and the frames either side of the position
      const levels = this.tables[Math.min(this.tables.length - 1, q[Q_O3_TAB] | 0)];
      const maxH = 0.45 / dt3;
      let lj = 0;
      while (lj < RIG_LEVELS - 1 && levels[lj].h > maxH) lj++;
      const tab = levels[lj], tsize = tab.size, tdata = tab.data;
      const fpos = rigClamp(q[Q_O3_POS], 0, 1) * (RIG_FRAMES - 1);
      const interp = q[Q_O3_INT] >= 0.5;
      const fa = interp ? Math.min(RIG_FRAMES - 2, Math.floor(fpos)) : Math.round(fpos);
      const ff = interp ? fpos - fa : 0;
      const offA = fa * tsize, offB = (interp ? fa + 1 : fa) * tsize;
      const ntype = q[Q_NTYPE];

      // OSC 3 in MACRO mode: the engine renders this tick's samples, at OSC 3's pitch, with the macro knobs
      const macro = RIG_HAS_MACRO && q[Q_O3_MODE] >= 0.5;
      let mOut = null, mAux = null, auxMix = 0;
      if (macro) {
        const model = Math.max(0, Math.min(PL_ENGINES.length - 1, q[Q_O3_MODEL] | 0));
        const E = PL_ENGINES[model];
        if (v.macroModel !== model) {
          v.macro = new E[0](); v.macro.reset(); v.macroModel = model;
          v.mLimOut = new PlLimiter(); v.mLimAux = new PlLimiter();
        }
        const mp = v.mp;
        mp.note = base + (q[Q_O3_OCT] - 2) * 12 + q[Q_O3_TUNE] + md[D_O3_TUNE] * 64;
        mp.harmonics = rigClamp(q[Q_O3_HARM], 0, 1);
        mp.timbre = rigClamp(q[Q_O3_TIMBRE], 0, 1);
        mp.morph = rigClamp(q[Q_O3_MORPH], 0, 1);
        mp.accent = v.vel;
        mp.trigger = v.macroTrig ? PL_TRIGGER_RISING_EDGE | PL_TRIGGER_HIGH : v.gate ? PL_TRIGGER_HIGH : PL_TRIGGER_LOW;
        v.macroTrig = false;
        mOut = v.mOut; mAux = v.mAux;
        v.macro.render(mp, mOut, mAux, len);
        const go = E[1], ga = E[2];
        if (go < 0) v.mLimOut.process(-go, mOut, len); else for (let i = 0; i < len; i++) mOut[i] *= go;
        if (ga < 0) v.mLimAux.process(-ga, mAux, len); else for (let i = 0; i < len; i++) mAux[i] *= ga;
        auxMix = rigClamp(q[Q_O3_AUX], 0, 1);
      }

      // ---- drive (clean at zero, as on the NINA) and filters
      const dr = rigClamp(q[Q_DRIVE], 0, 1);
      const gd = (1 + 8 * dr * dr) * (q[Q_OD] >= 0.5 ? 4 : 1), gdOut = 2 / (1 + 0.12 * (gd - 1));
      const key = (v.note - 60) * q[Q_KEY];
      const e1 = src[S_EG1] * sensE1;
      const ny = 0.45 * sr;
      const lfc = rigClamp(q[Q_LCUT] * Math.pow(2, (key + e1 * q[Q_LEG] * 120 + md[D_LCUT] * 64) / 12), 10, ny);
      const sfc = rigClamp(q[Q_SCUT] * Math.pow(2, (key + e1 * q[Q_SEG] * 120 + md[D_SCUT] * 64) / 12), 10, ny);
      const lg = Math.tan(Math.PI * lfc / sr), LG = lg / (1 + lg), lig = 1 / (1 + lg), LG2 = LG * LG, LG4 = LG2 * LG2;
      const lk = rigClamp(q[Q_LRES], 0, 1) * 4.15, lcomp = 1 + 0.55 * lk;
      const sg = Math.tan(Math.PI * sfc / sr), damp = 2 * (1 - 0.97 * rigClamp(q[Q_SRES], 0, 1));
      const sh = 1 / (1 + damp * sg + sg * sg);
      const smode = rigClamp(q[Q_SMODE], 0, 1), sbp = q[Q_SBP] >= 0.5, route = q[Q_ROUTE];

      // ---- envelopes: one-pole stages; attack aims past 1 so it lands in time, decay and release are 99 % times
      const e2lev = rigClamp(q[Q_E2[4]], 0, 1) * sensE2;
      const ca1 = 1 - Math.exp(-1.609 / (Math.max(0.0005, q[Q_E1[0]]) * sr)), cd1 = 1 - Math.exp(-4.6 / (Math.max(0.0005, q[Q_E1[1]]) * sr));
      const cr1 = 1 - Math.exp(-4.6 / (Math.max(0.0005, q[Q_E1[3]]) * sr)), sus1 = rigClamp(q[Q_E1[2]], 0, 1);
      const ca2 = 1 - Math.exp(-1.609 / (Math.max(0.0005, q[Q_E2[0]]) * sr)), cd2 = 1 - Math.exp(-4.6 / (Math.max(0.0005, q[Q_E2[1]]) * sr));
      const cr2 = 1 - Math.exp(-4.6 / (Math.max(0.0005, q[Q_E2[3]]) * sr)), sus2 = rigClamp(q[Q_E2[2]], 0, 1);

      // ---- output: infinite pan (past ±1 into anti-phase), with unison spread and the panner
      let pan = q[Q_PAN] + q[Q_SPIN] + spread * 0.8 * (v.uniN > 1 ? 1 : 0);
      if (A[Q_PANNER] > 0) pan += v.panPos;
      pan = rigClamp(pan, -2, 2);
      const th = (pan + 1) * Math.PI / 4, gL = Math.cos(th), gR = Math.sin(th);
      const level = rigClamp(q[Q_LEVEL], 0, 1) * 0.3;

      let p1 = v.p1, p2 = v.p2, p3 = v.p3, subS = v.sub;
      let s0 = v.ld0, s1 = v.ld1, s2 = v.ld2, s3 = v.ld3, sv1 = v.v1, sv2 = v.v2;
      let en1 = v.e1, st1 = v.st1, en2 = v.e2, st2 = v.st2, w3 = v.w3;
      for (let i = at; i < at + len; i++) {
        // OSC 3
        if (macro) {
          const k = i - at;
          w3 = mOut[k] + (mAux[k] - mOut[k]) * auxMix;
        } else {
          p3 += dt3;
          if (p3 >= 1) p3 -= 1;
          const x3 = p3 * tsize, i0 = x3 | 0, fr = x3 - i0, i1 = (i0 + 1) & (tsize - 1);
          const ra = tdata[offA + i0] + (tdata[offA + i1] - tdata[offA + i0]) * fr;
          w3 = ff > 0 ? ra + (tdata[offB + i0] + (tdata[offB + i1] - tdata[offB + i0]) * fr - ra) * ff : ra;
        }

        // OSC 1
        const d1 = fm1 !== 0 ? Math.min(lim, dt1 * Math.pow(2, fm1 * w3)) : dt1;
        p1 += d1;
        let wrapped = false, frac = 0;
        if (p1 >= 1) { p1 -= 1; wrapped = true; frac = p1 / d1; subS = -subS; }
        const k1 = rigClamp(k1base, 2 * d1, 1 - 2 * d1), corner1 = 2 / k1 + 2 / (1 - k1);
        let ts1 = p1 < k1 ? 2 * p1 / k1 - 1 : 1 - 2 * (p1 - k1) / (1 - k1);
        let tk = p1 - k1; if (tk < 0) tk += 1;
        ts1 += corner1 * d1 * (rigBlamp(p1, d1) - rigBlamp(tk, d1));
        let pl1;
        if (sub) {
          pl1 = subS + (p1 < d1 ? subS : -subS) * rigBlep(p1, d1);
        } else {
          let tp = p1 - pw1; if (tp < 0) tp += 1;
          pl1 = (p1 < pw1 ? 1 : -1) + rigBlep(p1, d1) - rigBlep(tp, d1);
        }
        const o1 = ts1 + (pl1 - ts1) * bl1;

        // OSC 2 (hard sync: restarts where OSC 1 wrapped)
        const d2 = fm2 !== 0 ? Math.min(lim, dt2 * Math.pow(2, fm2 * w3)) : dt2;
        p2 += d2;
        if (p2 >= 1) p2 -= 1;
        if (sync && wrapped) p2 = Math.min(0.999, frac * d2);
        const k2 = rigClamp(k2base, 2 * d2, 1 - 2 * d2), corner2 = 2 / k2 + 2 / (1 - k2);
        let ts2 = p2 < k2 ? 2 * p2 / k2 - 1 : 1 - 2 * (p2 - k2) / (1 - k2);
        let tk2 = p2 - k2; if (tk2 < 0) tk2 += 1;
        ts2 += corner2 * d2 * (rigBlamp(p2, d2) - rigBlamp(tk2, d2));
        let tp2 = p2 - pw2; if (tp2 < 0) tp2 += 1;
        const pl2 = (p2 < pw2 ? 1 : -1) + rigBlep(p2, d2) - rigBlep(tp2, d2);
        const o2 = ts2 + (pl2 - ts2) * bl2;

        // noise
        let nz = 0;
        if (lvn !== 0) {
          if (ntype === 2) nz = (p1 < pw1 ? 1 : -1) * (p2 < pw2 ? 1 : -1);
          else {
            const white = v.noise();
            if (ntype === 1) {
              v.b0 = 0.99765 * v.b0 + white * 0.099046;
              v.b1 = 0.963 * v.b1 + white * 0.2965164;
              v.b2 = 0.57 * v.b2 + white * 1.0526913;
              nz = (v.b0 + v.b1 + v.b2 + white * 0.1848) * 0.25;
            } else nz = white;
          }
        }

        // mixer, drive
        let x = o1 * lv1 + o2 * lv2 + w3 * lv3 + nz * lvn;
        if (gd > 1) x = rigTanh(x * gd * 0.5) * gdOut;

        // ladder: four TPT one-poles with the saturation where the feedback meets the input
        const S = (LG2 * LG * s0 + LG2 * s1 + LG * s2 + s3) * lig;
        const y4 = (LG4 * x + S) / (1 + lk * LG4);
        let u = rigTanh(x - lk * y4), vv, yy;
        vv = (u - s0) * LG; yy = vv + s0; s0 = yy + vv; u = yy;
        vv = (u - s1) * LG; yy = vv + s1; s1 = yy + vv; u = yy;
        vv = (u - s2) * LG; yy = vv + s2; s2 = yy + vv; u = yy;
        vv = (u - s3) * LG; yy = vv + s3; s3 = yy + vv; u = yy;
        const lad = u * lcomp;

        // SEM: a TPT state-variable filter, its band-pass state softly limited so it can ring without blowing up
        let out = lad;
        if (route > 0) {
          const xin = route === 1 ? lad : x;
          const hp = (xin - (damp + sg) * sv1 - sv2) * sh;
          const bp = sg * hp + sv1;
          sv1 = rigTanh((sg * hp + bp) * 0.3) / 0.3;
          const lp = sg * bp + sv2;
          sv2 = sg * bp + lp;
          let sem;
          if (sbp) sem = bp * damp;
          else if (smode < 0.5) sem = lp + hp * (smode * 2);
          else sem = hp + lp * (2 - smode * 2);
          out = route === 1 ? sem : (lad + sem) * 0.6;
        }

        // envelopes and the amp
        if (st1 === 1) { en1 += (1.25 - en1) * ca1; if (en1 >= 1) { en1 = 1; st1 = 2; } }
        else if (st1 === 2) en1 += (sus1 - en1) * cd1;
        else if (st1 === 3) { en1 -= en1 * cr1; if (en1 < 1e-5) { en1 = 0; st1 = 0; } }
        if (st2 === 1) { en2 += (1.25 - en2) * ca2; if (en2 >= 1) { en2 = 1; st2 = 2; } }
        else if (st2 === 2) en2 += (sus2 - en2) * cd2;
        else if (st2 === 3) { en2 -= en2 * cr2; if (en2 < 1e-5) { en2 = 0; st2 = 0; } }

        const y = out * (drone ? 1 : en2) * e2lev * level;
        busL[i] += y * gL;
        busR[i] += y * gR;
      }
      v.p1 = p1; v.p2 = p2; v.p3 = p3; v.sub = subS; v.w3 = w3;
      v.ld0 = s0; v.ld1 = s1; v.ld2 = s2; v.ld3 = s3; v.v1 = sv1; v.v2 = sv2;
      v.e1 = en1; v.st1 = st1; v.e2 = en2; v.st2 = st2;
      if (!Number.isFinite(s3) || !Number.isFinite(sv2)) { v.ld0 = v.ld1 = v.ld2 = v.ld3 = 0; v.v1 = v.v2 = 0; }
    }
    if (!drone && v.st2 === 0 && !v.gate) v.active = false;
  }
}

if (typeof registerProcessor === 'function') {
  class MoaRig extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.core = new RigCore(sampleRate);
      const st = (options && options.processorOptions && options.processorOptions.state) || {};
      if (st.counts) this.core.setLayout(st.counts);
      for (const p of st.patches || []) this.core.setPatch(p.part, p.a, p.b);
      if (st.bpm) this.core.bpm = st.bpm;
      (st.kinds || []).forEach((kind, p) => this.core.setKind(p, kind));
      if (this.core.mix) for (const id in st.mix || {}) this.core.mix.set(id, st.mix[id]);
      this.since = 0;
      // \`when\` (an audio-clock time) places a message on its sample: the sequencer sends ahead of time
      this.port.onmessage = (e) => {
        const m = e.data;
        this.core.post(m, m.when === undefined ? undefined : Math.round(m.when * sampleRate));
      };
      this.port.postMessage({ type: 'ready' }); // the device sends the kits' sounds and pads when it hears this
    }
    process(inputs, outputs) {
      const out = outputs[0];
      this.core.frame = currentFrame;
      if (this.core.mix && (this.since += out[0].length) >= sampleRate / 30) {
        this.since = 0;
        this.port.postMessage({ type: 'meters', ...this.core.mix.meters() });
      }
      this.core.process(out[0], out[1] || out[0], out[0].length);
      return true;
    }
  }
  registerProcessor('${et}', MoaRig);
}
`,rt=`
if (typeof registerProcessor === 'function') {
  class MoaTape extends AudioWorkletProcessor {
    constructor() {
      super();
      this.recording = false;
      this.size = 32768;
      this.fresh();
      this.port.onmessage = (e) => {
        if (e.data.type === 'start') { this.fresh(); this.recording = true; }
        else if (e.data.type === 'stop') { this.recording = false; this.send(); this.port.postMessage({ type: 'done' }); }
      };
    }
    fresh() { this.L = new Float32Array(this.size); this.R = new Float32Array(this.size); this.at = 0; }
    send() {
      if (!this.at) return;
      const L = this.L.slice(0, this.at), R = this.R.slice(0, this.at);
      this.port.postMessage({ type: 'chunk', L, R }, [L.buffer, R.buffer]);
      this.fresh();
    }
    process(inputs) {
      const input = inputs[0];
      if (!this.recording || !input || !input.length) return true;
      const l = input[0], r = input[1] || input[0];
      for (let i = 0; i < l.length; i++) {
        this.L[this.at] = l[i]; this.R[this.at] = r[i];
        if (++this.at === this.size) this.send();
      }
      return true;
    }
  }
  registerProcessor('moa-tape', MoaTape);
}
`,it=.01,at=class t{patch;ctx;compiled=new Map;monitor;monitorOn=!0;compressors=new Map;grainViews=new Map;pipeViews=new Map;dfViews=new Map;duoViews=new Map;m2600Views=new Map;rigMeters=new Map;stringViews=new Map;voiceViews=new Map;samplerViews=new Map;meters=new Map;constructor(e){this.patch=e}async start(){if(!this.ctx){let e=new AudioContext;await e.audioWorklet.addModule(Ft()),this.build(e)}await this.ctx?.resume()}static async render(e,n,r,i,a=2){let o=new OfflineAudioContext(a,Math.ceil(n*r),r);return await o.audioWorklet.addModule(Ft()),new t(e).build(o),i(),o.startRendering()}async stop(){await this.ctx?.suspend()}get context(){return this.ctx}setMonitor(e){this.monitorOn=e,this.monitor&&this.ctx&&this.monitor.gain.setTargetAtTime(+!!e,this.ctx.currentTime,.02)}jackNode(e,t,n){let r=this.patch.device(e).jack(t,n).nodeId;return this.compiled.get(e)?.get(r)}setCable(e,t,n){let r=this.jackNode(e.device,`out`,e.jack),i=this.jackNode(t.device,`in`,t.jack);r&&i&&(n?r.connect(i):r.disconnect(i))}get currentTime(){return this.ctx?.currentTime??0}readLevel(e,t){let n=this.meters.get(`${e}/${t}`);if(!n)return 0;n.analyser.getFloatTimeDomainData(n.buffer);let r=0;for(let e of n.buffer)r=Math.max(r,Math.abs(e));return r}readGranular(e,t){return this.grainViews.get(`${e}/${t}`)}readPipe(e,t){return this.pipeViews.get(`${e}/${t}`)}readDF(e,t){return this.dfViews.get(`${e}/${t}`)}readSampler(e,t){return this.samplerViews.get(`${e}/${t}`)}readString(e,t){return this.stringViews.get(`${e}/${t}`)}readVoice(e,t){return this.voiceViews.get(`${e}/${t}`)}readRigMeters(e,t){return this.rigMeters.get(`${e}/${t}`)}readM2600(e,t){return this.m2600Views.get(`${e}/${t}`)}readDuo(e,t){return this.duoViews.get(`${e}/${t}`)}readReduction(e,t){return this.compressors.get(`${e}/${t}`)?.reduction??0}build(e){e instanceof AudioContext&&(this.ctx=e);let t=new Map;for(let[n,r]of this.patch.devices)t.set(n,this.compileCircuit(e,n,r.circuit));this.compiled=t;let n=(e,n,r)=>{let i=this.patch.device(e).jack(n,r).nodeId,a=t.get(e)?.get(i);if(!a)throw Error(`No audio node for ${e}.${r}`);return a};for(let e of this.patch.connections)n(e.from.device,`out`,e.from.jack).connect(n(e.to.device,`in`,e.to.jack));if(this.patch.output){this.monitor=e.createGain(),this.monitor.gain.value=+!!this.monitorOn,this.monitor.connect(e.destination);for(let{device:e,jack:t}of[this.patch.output,...this.patch.extraOutputs])n(e,`out`,t).connect(this.monitor)}}compileCircuit(t,n,r){let i=new Map;for(let a of r.nodes.values())switch(a.kind){case`oscillator`:{let e=t.createOscillator();e.type=a.options.waveform,e.frequency.value=a.params.frequency??440,e.detune.value=a.params.detune??0,e.start(),i.set(a.id,e);break}case`filter`:{let e=t.createBiquadFilter();e.type=a.options.type,e.frequency.value=a.params.frequency??350,e.Q.value=a.params.Q??1,e.gain.value=a.params.gain??0,e.detune.value=a.params.detune??0,i.set(a.id,e);break}case`envelope`:{let e=t.createConstantSource();e.offset.value=0,e.start(),i.set(a.id,e);break}case`convolver`:{let e=t.createConvolver();e.buffer=Et(t,Tt[a.options.size??`medium`]??Tt.medium),i.set(a.id,e);break}case`follower`:{let e=new AudioWorkletNode(t,Nt,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],parameterData:{attack:a.params.attack??.003,release:a.params.release??.12}});i.set(a.id,e);break}case`granular`:{let{maxTime:e,...r}=a.params,o=new AudioWorkletNode(t,he,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],parameterData:r,processorOptions:{seconds:e??20}});o.port.onmessage=e=>this.grainViews.set(`${n}/${a.id}`,e.data),i.set(a.id,o);break}case`pipe`:{let e=new AudioWorkletNode(t,Ce,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params});e.port.onmessage=e=>this.pipeViews.set(`${n}/${a.id}`,e.data),i.set(a.id,e);break}case`spring`:i.set(a.id,new AudioWorkletNode(t,we,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params}));break;case`df`:{let r=new AudioWorkletNode(t,e,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:`explicit`,parameterData:a.params});r.port.onmessage=e=>this.dfViews.set(`${n}/${a.id}`,e.data),i.set(a.id,r);break}case`duo`:{let e=new AudioWorkletNode(t,te,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params});e.port.onmessage=e=>this.duoViews.set(`${n}/${a.id}`,e.data),i.set(a.id,e);break}case`string`:{let e=new AudioWorkletNode(t,se,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],parameterData:a.params,processorOptions:{config:JSON.parse(a.options.config??`{}`)}});e.port.onmessage=e=>this.stringViews.set(`${n}/${a.id}`,e.data),i.set(a.id,e);break}case`voice`:{let e=new AudioWorkletNode(t,le,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],parameterData:a.params,processorOptions:{config:JSON.parse(a.options.config??`{}`)}});e.port.onmessage=e=>this.voiceViews.set(`${n}/${a.id}`,e.data),i.set(a.id,e);break}case`drum`:{let e=new AudioWorkletNode(t,de,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],parameterData:a.params,processorOptions:{config:JSON.parse(a.options.config??`{}`)}});e.port.onmessage=e=>this.stringViews.set(`${n}/${a.id}`,e.data),i.set(a.id,e);break}case`tone`:i.set(a.id,new AudioWorkletNode(t,pe,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],parameterData:a.params,processorOptions:{role:a.options.role,preset:JSON.parse(a.options.preset??`{}`)}}));break;case`sampler`:{let e=new AudioWorkletNode(t,ae,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params});e.port.onmessage=e=>{e.data.type===`ready`?r.nodeReady(a.id):this.samplerViews.set(`${n}/${a.id}`,e.data)},i.set(a.id,e);break}case`ladder`:i.set(a.id,new AudioWorkletNode(t,re,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:`explicit`,parameterData:a.params}));break;case`fold`:i.set(a.id,new AudioWorkletNode(t,b,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:`explicit`,parameterData:a.params}));break;case`rig`:{let e=new AudioWorkletNode(t,et,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{state:JSON.parse(a.options.state??`{}`)}});e.port.onmessage=e=>{e.data.type===`ready`?r.nodeReady(a.id):this.rigMeters.set(`${n}/${a.id}`,e.data)},i.set(a.id,e);break}case`m2600`:{let e=new AudioWorkletNode(t,ye,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],parameterData:a.params,processorOptions:{cords:JSON.parse(a.options.cords??`[]`)}});e.port.onmessage=e=>this.m2600Views.set(`${n}/${a.id}`,e.data),i.set(a.id,e);break}case`compressor`:{let e=t.createDynamicsCompressor();this.compressors.set(`${n}/${a.id}`,e),e.threshold.value=a.params.threshold??-24,e.knee.value=a.params.knee??30,e.ratio.value=a.params.ratio??12,e.attack.value=a.params.attack??.003,e.release.value=a.params.release??.25,i.set(a.id,e);break}case`delay`:{let e=t.createDelay(a.params.maxTime??1);e.delayTime.value=a.params.delayTime??.25,i.set(a.id,e);break}case`trigger`:{let e=t.createConstantSource();e.offset.value=0,e.start(),i.set(a.id,e);break}case`constant`:{let e=t.createConstantSource();e.offset.value=a.params.offset??0,e.start(),i.set(a.id,e);break}case`waveshaper`:{let e=t.createWaveShaper();a.options.curve===`pulse`?e.curve=_t():a.options.curve===`soft`?e.curve=yt():a.options.curve===`limit`?e.curve=bt():a.options.curve===`warm`?e.curve=St():a.options.curve===`tube`?e.curve=xt():a.options.curve===`abs`?e.curve=Ct():a.options.curve===`crush`&&(e.curve=wt(a.params.bits??16)),e.oversample=`4x`,i.set(a.id,e);break}case`noise`:{let e=t.createBufferSource();e.buffer=Dt(t),e.loop=!0,e.start(),i.set(a.id,e);break}case`random`:{let e=t.createBufferSource();e.buffer=jt(t),e.loop=!0,e.playbackRate.value=(a.params.rate??4)/kt,e.start(),i.set(a.id,e);break}case`meter`:{let e=t.createAnalyser();e.fftSize=1024;let r=a.options.channel??`mono`;if(r===`mono`)i.set(a.id,e);else{let n=t.createChannelSplitter(2);n.connect(e,r===`left`?0:1),i.set(a.id,n)}this.meters.set(`${n}/${a.id}`,{analyser:e,buffer:new Float32Array(new ArrayBuffer(e.fftSize*4))});break}case`pan`:{let e=t.createStereoPanner();e.pan.value=a.params.pan??0,i.set(a.id,e);break}case`gain`:{let e=t.createGain();e.gain.value=a.params.gain??1,a.options.channels===`mono`&&(e.channelCount=1,e.channelCountMode=`explicit`),i.set(a.id,e);break}}for(let e of r.cables){let t=i.get(e.from),n=i.get(e.to);if(t&&n){if(e.port===`in`)t.connect(n);else{let r=ot(n,e.port);r&&t.connect(r)}}}return r.onChange(e=>{let n=i.get(e.nodeId);if(!n)return;if(e.type===`note`||e.type===`gate`||e.type===`play`){n instanceof AudioWorkletNode&&n.port.postMessage(e);return}if(e.type===`message`){n instanceof AudioWorkletNode&&n.port.postMessage(e.data);return}if(e.type===`trigger`||e.type===`choke`){n instanceof ConstantSourceNode&&(e.type===`trigger`?ht(t,n.offset,r.node(e.nodeId).params,r.node(e.nodeId).options.shape,e.velocity,e.when):gt(t,n.offset,e.when));return}if(r.node(e.nodeId).kind===`trigger`)return;if(n instanceof WaveShaperNode&&e.type===`param`&&e.name===`bits`){n.curve=wt(e.value);return}if(r.node(e.nodeId).kind===`envelope`){n instanceof ConstantSourceNode&&e.type===`param`&&e.name===`gate`&&ut(t,n.offset,r.node(e.nodeId).params,e.value>0);return}if(n instanceof AudioBufferSourceNode&&e.type===`param`&&e.name===`rate`){n.playbackRate.setTargetAtTime(e.value/kt,t.currentTime,it);return}if(e.type===`option`){n instanceof OscillatorNode&&e.name===`waveform`||n instanceof BiquadFilterNode&&e.name===`type`?n.type=e.value:n instanceof ConvolverNode&&e.name===`size`&&(n.buffer=Et(t,Tt[e.value]??Tt.medium));return}let a=ot(n,e.name);r.node(e.nodeId).kind===`m2600`&&ee.has(e.name)||r.node(e.nodeId).kind===`duo`&&ct.test(e.name)||r.node(e.nodeId).kind===`df`&&lt.test(e.name)?a?.setValueAtTime(e.value,t.currentTime):a?.setTargetAtTime(e.value,t.currentTime,Mt(r,e.nodeId,e.name))}),i}};function ot(e,t){if(e instanceof AudioWorkletNode)return e.parameters.get(t);let n=e[t];return n instanceof AudioParam?n:void 0}var st=.001,ct=/Wave$|Sync$|Route$|Hold$|Lfo$|Off$/,lt=/Type$|Src$|Inv$|Vca$|Gate$|Loop$|Exp$|Trig$|Link$|^mono$/;function ut(e,t,n,r){let i=e.currentTime;if(t.cancelScheduledValues(i),t.setValueAtTime(t.value,i),r){let e=Math.max(n.attack??.01,st);t.linearRampToValueAtTime(1,i+e),t.setTargetAtTime(n.sustain??.7,i+e,Math.max(n.decay??.2,st)/3)}else t.setTargetAtTime(0,i,Math.max(n.release??.3,st)/3)}var dt=.001,ft=3,pt=.0035,mt=.005;function ht(e,t,n,r,i,a){let o=n.velSens??1,s=(n.peak??1)*(1-o+o*i),c=Math.max(n.decay??.2,st)/4,l=Math.max(a??0,e.currentTime);t.cancelScheduledValues(l),t.setValueAtTime(t.value,l);let u=Math.max(n.attack??dt,dt);if(t.linearRampToValueAtTime(s,l+u),r!==`clap`){t.setTargetAtTime(0,l+u,c);return}let d=Math.max(n.spread??.012,.002);t.setTargetAtTime(0,l+dt,pt);for(let e=1;e<=ft;e++){let n=l+e*d;t.setValueAtTime(s,n),t.setTargetAtTime(0,n,e===ft?c:pt)}}function gt(e,t,n){let r=Math.max(n??0,e.currentTime);t.cancelScheduledValues(r),t.setValueAtTime(t.value,r),t.setTargetAtTime(0,r,mt)}function _t(){let e=1024,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++)t[n]=n<e/2?-1:1;return t}var vt=2.5;function yt(){let e=2048,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++){let e=n/2047*2-1;t[n]=Math.tanh(vt*e)/Math.tanh(vt)}return t}function bt(){let e=4097,t=new Float32Array(new ArrayBuffer(e*4)),n=.9;for(let r=0;r<e;r++){let e=r/4096*2-1,i=Math.abs(e);t[r]=Math.sign(e)*(i<n?i:n+.09999999999999998*Math.tanh((i-n)/.09999999999999998))}return t}function xt(){let e=4097,t=new Float32Array(new ArrayBuffer(e*4)),n=2.2,r=.35,i=n*(1-Math.tanh(r)**2);for(let a=0;a<e;a++){let e=a/4096*2-1;t[a]=(Math.tanh(n*e+r)-Math.tanh(r))/i}return t}function St(){let e=4097,t=new Float32Array(new ArrayBuffer(e*4)),n=.6;for(let r=0;r<e;r++){let e=r/4096*2-1,i=Math.abs(e)*3;t[r]=Math.sign(e)*(i<n?i:n+.4*Math.tanh((i-n)/.4))}return t}function Ct(){let e=1025,t=new Float32Array(new ArrayBuffer(e*4));for(let n=0;n<e;n++)t[n]=Math.abs(n/1024*2-1);return t}function wt(e){let t=8193,n=new Float32Array(new ArrayBuffer(t*4)),r=2**Math.max(1,Math.min(16,e))/2;for(let e=0;e<t;e++){let t=e/8192*2-1;n[e]=Math.round(t*r)/r}return n}var Tt={small:.9,medium:2.4,large:5};function Et(e,t){let n=e.sampleRate,r=Math.floor(n*t),i=e.createBuffer(2,r,n),a=Math.log(1e3)/t;for(let e=0;e<2;e++){let t=i.getChannelData(e),o=0;for(let e=0;e<r;e++){let r=e/n,i=Math.exp(-a*r)*Math.min(1,r/.004),s=.75*Math.exp(-r*1.2)+.06;o+=s*(Math.random()*2-1-o),t[e]=o*i}}return i}function Dt(e){let t=e.createBuffer(1,e.sampleRate*2,e.sampleRate),n=t.getChannelData(0);for(let e=0;e<n.length;e++)n[e]=Math.random()*2-1;return t}var Ot=64,kt=10,At=8e3;function jt(e){let t=At/kt,n=e.createBuffer(1,Ot*t,At),r=n.getChannelData(0);for(let e=0;e<Ot;e++)r.fill(Math.random()*2-1,e*t,(e+1)*t);return n}function Mt(e,t,n){let r=e.node(t);return r.kind===`constant`&&n===`offset`&&r.params.glide?Math.max(r.params.glide/3,it):it}var Nt=`moa-follower`,Pt=[`
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
registerProcessor('${Nt}', MoaFollower);
`,ge,Te,t,y,Se,ne,ie,ce,fe,oe,me,ue,Ee,Ve,nt,rt].join(`
`);function Ft(){return URL.createObjectURL(new Blob([Pt],{type:`text/javascript`}))}var It=()=>typeof location<`u`&&new URLSearchParams(location.search).has(`embed`),Lt=()=>{try{let e=window.frameElement;return!!e&&e.style.visibility===`hidden`}catch{return!1}};function Rt(){let e=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=t=>Lt()?window.setTimeout(()=>t(performance.now()),250):e(t)}function zt(){It()&&(document.body.classList.add(`embed`),Rt(),document.addEventListener(`keydown`,e=>{e.key===`Escape`&&window.parent.postMessage({type:Bt},location.origin)}))}var Bt=`moa-close-panel`,Vt=`@internal`,Ht=`@none`,Ut=`moa.mixerInputs`,Wt=class{host;jacks;storage;storageKey;slots=new Map;listeners=new Set;ready=!1;constructor(e,t,n={},r=Gt(),i=Ut){this.host=e,this.jacks=t,this.storage=r,this.storageKey=i;let a=Kt(r,i);for(let r of t)this.slots.set(r,{selection:a[r]??n[r]??(e.hasInternal(r)?`@internal`:`@none`),internal:!0,status:`idle`})}selection(e){return this.slot(e).selection}status(e){return this.slot(e).status}hasInternal(e){return this.host.hasInternal(e)}portNames(){return[...new Set(this.host.ports().map(e=>e.name))]}setSelection(e,t,n=!0){if(this.slot(e).selection=t,n)try{this.storage?.setItem(this.storageKey,JSON.stringify(Object.fromEntries([...this.slots].map(([e,t])=>[e,t.selection]))))}catch{}this.reconcile()}start(){this.ready=!0,this.reconcile()}reconcile(){for(let[e,t]of this.slots)this.reconcileOne(e,t);for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}reconcileOne(e,t){let n=t.selection===Vt;if(!this.ready){t.status=`idle`;return}let r=n||t.selection===`@none`?void 0:this.host.ports().find(e=>e.name===t.selection);r||this.release(t),t.internal!==n&&(this.host.setInternal(e,n),t.internal=n),r?t.portId!==r.id&&t.pending!==r.id&&(this.release(t),t.pending=r.id,t.status=`connecting`,this.host.attach(e,r.id).then(e=>{if(t.pending!==r.id)e();else{t.pending=void 0,t.portId=r.id,t.detach=e,t.status=`live`;for(let e of this.listeners)e()}},()=>{t.pending===r.id&&(t.pending=void 0),t.status=`missing`;for(let e of this.listeners)e()})):t.status=n?`internal`:t.selection===`@none`?`none`:`missing`}release(e){e.detach?.(),e.detach=void 0,e.portId=void 0,e.pending=void 0}slot(e){let t=this.slots.get(e);if(!t)throw Error(`Unknown input: ${e}`);return t}};function Gt(){try{return It()||typeof localStorage>`u`?void 0:localStorage}catch{return}}function Kt(e,t){try{let n=JSON.parse(e?.getItem(t)??`{}`);return n&&typeof n==`object`?n:{}}catch{return{}}}var qt=`moa-pcm-send`,Jt=`moa-pcm-recv`,Yt=`
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

registerProcessor('${qt}', PcmSend);
registerProcessor('${Jt}', PcmRecv);
`,Xt=e=>2*e+12,Zt=new WeakSet;async function Qt(e){if(Zt.has(e))return;let t=URL.createObjectURL(new Blob([Yt],{type:`text/javascript`}));await e.audioWorklet.addModule(t),Zt.add(e)}var $t=()=>Math.random().toString(36).slice(2,10),en=class{id=$t();channel;remote=new Map;listeners=new Set;audienceListeners=new Set;outlets=new Map;sinks=new Map;receiving=new Map;constructor(e=`moa-audio-pcm`,t){let n=t??(typeof BroadcastChannel>`u`?void 0:e=>new BroadcastChannel(e));this.channel=n?.(e),this.channel&&(this.channel.onmessage=e=>this.handle(e.data),this.send({type:`hello`,from:this.id}),typeof window<`u`&&window.addEventListener(`pagehide`,e=>{e.persisted||this.close()}))}get supported(){return this.channel!==void 0&&typeof AudioWorkletNode<`u`}get ports(){return[...this.remote].map(([e,t])=>({id:e,name:t.name}))}get audience(){let e=0;for(let t of this.outlets.values())e+=t.audience.size;return e}openOutlet(e){let t=$t(),n={name:e,audience:new Set};return this.outlets.set(t,n),this.send({type:`announce`,from:this.id,port:t,name:e}),{id:t,get listened(){return n.audience.size>0},send:(e,r,i)=>{n.audience.size>0&&this.send({type:`pcm`,from:this.id,port:t,rate:i,l:e,r})},close:()=>{this.outlets.delete(t)&&(n.stop?.(),this.send({type:`bye`,from:this.id,port:t}),this.audienceChanged())}}}listen(e,t){return this.sinks.set(e,e=>t(e.rate,e.l,e.r)),this.send({type:`listen`,from:this.id,port:e}),()=>{this.sinks.delete(e)&&this.send({type:`unlisten`,from:this.id,port:e})}}async publish(e,t,n){await Qt(e);let r=new AudioWorkletNode(e,qt,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:`explicit`}),i=e.createGain();i.gain.value=0,t.connect(r),r.connect(i).connect(e.destination);let a=this.openOutlet(n);return r.port.onmessage=t=>a.send(t.data.l,t.data.r,e.sampleRate),this.outlets.get(a.id).listening=e=>r.port.postMessage({active:e}),this.outlets.get(a.id).stop=()=>{t.disconnect(r),r.disconnect(),i.disconnect(),r.port.onmessage=null},a.close}async subscribe(e,t,n=30){await Qt(e);let r=new AudioWorkletNode(e,Jt,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{targetMs:n,capacityMs:400}}),i={fill:0,underruns:0,drops:0};r.port.onmessage=e=>{i=e.data};let a=this.listen(t,(e,t,n)=>r.port.postMessage({rate:e,l:t,r:n},[t.buffer,n.buffer])),o={node:r,stats:()=>i,close:()=>{a(),r.disconnect(),r.port.onmessage=null,this.receiving.delete(o)}};return this.receiving.set(o,this.remote.get(t)?.name??t),o}receiveStats(){return[...this.receiving].map(([e,t])=>({name:t,stats:e.stats()}))}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}onAudience(e){return this.audienceListeners.add(e),()=>this.audienceListeners.delete(e)}close(){for(let e of[...this.sinks.keys()])this.send({type:`unlisten`,from:this.id,port:e});this.sinks.clear();for(let e of this.outlets.values())e.stop?.();this.outlets.clear(),this.send({type:`bye`,from:this.id}),this.channel?.close()}emit(){for(let e of this.listeners)e()}audienceChanged(){for(let e of this.audienceListeners)e()}send(e){this.channel?.postMessage(e)}handle(e){if(e.from!==this.id)switch(e.type){case`hello`:for(let[e,t]of this.outlets)this.send({type:`announce`,from:this.id,port:e,name:t.name});return;case`announce`:this.remote.set(e.port,{owner:e.from,name:e.name}),this.emit();return;case`bye`:for(let[t,n]of[...this.remote])n.owner===e.from&&(e.port===void 0||e.port===t)&&this.remote.delete(t);if(e.port===void 0){let t=!1;for(let n of this.outlets.values())n.audience.delete(e.from)&&(t=!0,n.audience.size===0&&n.listening?.(!1));t&&this.audienceChanged()}this.emit();return;case`listen`:{let t=this.outlets.get(e.port);if(!t||t.audience.has(e.from))return;t.audience.add(e.from),t.listening?.(!0),this.audienceChanged();return}case`unlisten`:{let t=this.outlets.get(e.port);t?.audience.delete(e.from)&&(t.audience.size===0&&t.listening?.(!1),this.audienceChanged());return}case`pcm`:this.sinks.get(e.port)?.(e);return}}},tn=24,nn=48,rn=12,an=1e3,on=500,T=class{intervals=[];last;isRunning=!1;pulses=0;get running(){return this.isRunning}get ticks(){return this.pulses}get bpm(){if(this.intervals.length<rn)return;let e=[...this.intervals].sort((e,t)=>e-t),t=Math.floor(e.length/4),n=e.slice(t,e.length-t);return 6e4/(n.reduce((e,t)=>e+t,0)/n.length*tn)}isLocked(e){return this.last!==void 0&&this.intervals.length>=rn&&e-this.last<on}get position(){return sn(this.pulses)}handle(e,t){switch(e.type){case`clock`:if(this.last!==void 0){let e=t-this.last;e>an?this.intervals=[]:this.intervals.push(e),this.intervals.length>nn&&this.intervals.shift()}this.last=t,this.isRunning&&this.pulses++;break;case`start`:this.isRunning=!0,this.pulses=0;break;case`continue`:this.isRunning=!0;break;case`stop`:this.isRunning=!1}}};function sn(e){return{bar:Math.floor(e/96)+1,beat:Math.floor(e/tn)%4+1,sixteenth:Math.floor(e/(tn/4))%4+1}}function cn(e){let t=e[0];if(t===void 0)return;if(t>=240)switch(t){case 248:return{type:`clock`};case 250:return{type:`start`};case 251:return{type:`continue`};case 252:return{type:`stop`};default:return}let n=t&240,r=(t&15)+1,i=(e[1]??0)&127,a=(e[2]??0)&127;switch(n){case 128:return{type:`noteOff`,channel:r,note:i,velocity:a};case 144:return a===0?{type:`noteOff`,channel:r,note:i,velocity:0}:{type:`noteOn`,channel:r,note:i,velocity:a};case 176:return{type:`cc`,channel:r,controller:i,value:a};case 192:return{type:`programChange`,channel:r,program:i};case 224:return{type:`pitchBend`,channel:r,value:(a<<7|i)/8192-1};default:return}}var ln=[`C`,`C#`,`D`,`D#`,`E`,`F`,`F#`,`G`,`G#`,`A`,`A#`,`B`];function un(e){return`${ln[e%12]}${Math.floor(e/12)-2}`}function dn(e){switch(e.type){case`noteOn`:case`noteOff`:return`note`;case`cc`:return`cc`;case`clock`:case`start`:case`continue`:case`stop`:return`clock`;default:return`other`}}function fn(e){switch(e.type){case`noteOn`:return`ch${e.channel}  note on  ${un(e.note)}  vel ${e.velocity}`;case`noteOff`:return`ch${e.channel}  note off  ${un(e.note)}`;case`cc`:return`ch${e.channel}  cc ${e.controller}  = ${e.value}`;case`pitchBend`:return`ch${e.channel}  bend  ${e.value.toFixed(2)}`;case`programChange`:return`ch${e.channel}  program  ${e.program}`;case`clock`:return`clock`;default:return`clock ${e.type}`}}var pn=40,mn=class{lines=[];lastSeen={note:-1/0,cc:-1/0,clock:-1/0,other:-1/0};listeners=new Set;record(e,t){if(this.lastSeen[dn(e)]=t,e.type!==`clock`){this.lines.push({text:fn(e),kind:dn(e)}),this.lines.length>pn&&this.lines.shift();for(let e of this.listeners)e()}}clear(){this.lines.length=0;for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}},hn=class{nodes=new Map;cables=[];listeners=new Set;readyListeners=new Set;add(e,t,n={},r={}){if(this.nodes.has(e))throw Error(`Duplicate node id: ${e}`);return this.nodes.set(e,{id:e,kind:t,params:{...n},options:{...r}}),this}connect(e,t,n=`in`){this.node(e);let r=this.node(t);if(n!==`in`&&!(n in r.params))throw Error(`Node ${t} has no param ${n}`);if(this.cables.some(r=>r.from===e&&r.to===t&&r.port===n))throw Error(`Duplicate cable ${e} -> ${t}.${n}`);return this.cables.push({from:e,to:t,port:n}),this}setParam(e,t,n){let r=this.node(e);if(!(t in r.params))throw Error(`Node ${e} has no param ${t}`);r.params[t]=n,this.emit({type:`param`,nodeId:e,name:t,value:n})}setOption(e,t,n){let r=this.node(e);if(!(t in r.options))throw Error(`Node ${e} has no option ${t}`);r.options[t]=n,this.emit({type:`option`,nodeId:e,name:t,value:n})}trigger(e,t=1,n){this.expectKind(e,`trigger`),this.emit({type:`trigger`,nodeId:e,velocity:Math.min(1,Math.max(0,t)),when:n})}choke(e,t){this.expectKind(e,`trigger`),this.emit({type:`choke`,nodeId:e,when:t})}noteOn(e,t,n=1){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:t,velocity:Math.min(1,Math.max(0,n))})}noteOff(e,t){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:t,velocity:0})}allNotesOff(e){this.expectKind(e,`granular`,`pipe`),this.emit({type:`note`,nodeId:e,note:-1,velocity:0})}pedal(e,t){this.expectKind(e,`pipe`),this.emit({type:`note`,nodeId:e,note:-2,velocity:+!!t})}play(e,t,n,r,i){this.expectKind(e,`duo`,`m2600`),this.emit({type:`play`,nodeId:e,n1:t,n2:n,gate:r,retrig:i})}send(e,t){this.expectKind(e,`m2600`,`string`,`drum`,`sampler`,`tone`,`voice`,`rig`),this.emit({type:`message`,nodeId:e,data:t})}gate(e,t,n){this.expectKind(e,`df`),this.emit({type:`gate`,nodeId:e,target:t,on:n})}nodeReady(e){for(let t of this.readyListeners)t(e)}onReady(e){return this.readyListeners.add(e),()=>this.readyListeners.delete(e)}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}node(e){let t=this.nodes.get(e);if(!t)throw Error(`Unknown node: ${e}`);return t}expectKind(e,...t){if(!t.includes(this.node(e).kind))throw Error(`Node ${e} is not a ${t.join(` or `)}`)}emit(e){for(let t of this.listeners)t(e)}},E=class{circuit=new hn;controlList=[];inputList=[];outputList=[];meterList=[];get controls(){return this.controlList}get inputs(){return this.inputList}get outputs(){return this.outputList}get meters(){return this.meterList}control(e){let t=this.controlList.find(t=>t.id===e);if(!t)throw Error(`${this.name} has no control ${e}`);return t}jack(e,t){let n=(e===`in`?this.inputList:this.outputList).find(e=>e.name===t);if(!n)throw Error(`${this.name} has no ${e} jack ${t}`);return n}},gn=class{listeners=new Set;onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}notify(){for(let e of this.listeners)e()}},D=class extends gn{id;label;min;max;initial;unit;apply;curve;kind=`number`;current;constructor(e,t,n,r,i,a,o,s=`linear`){super(),this.id=e,this.label=t,this.min=n,this.max=r,this.initial=i,this.unit=a,this.apply=o,this.curve=s,this.current=vn(this.initial,n,r),this.apply(this.current)}get value(){return this.current}set(e){this.current=vn(e,this.min,this.max),this.apply(this.current),this.notify()}},O=class extends gn{id;label;options;apply;kind=`choice`;current;constructor(e,t,n,r,i){if(super(),this.id=e,this.label=t,this.options=n,this.apply=i,!n.includes(r))throw Error(`Invalid initial choice ${r}`);this.current=r,this.apply(this.current)}get value(){return this.current}set(e){if(!this.options.includes(e))throw Error(`Invalid choice ${e} for ${this.id}`);this.current=e,this.apply(e),this.notify()}},k=class extends gn{id;label;apply;kind=`toggle`;current;constructor(e,t,n,r){super(),this.id=e,this.label=t,this.apply=r,this.current=n,this.apply(n)}get value(){return this.current}set(e){this.current=e,this.apply(e),this.notify()}},_n=class extends gn{id;label;apply;kind=`text`;current;constructor(e,t,n,r){super(),this.id=e,this.label=t,this.apply=r,this.current=n,this.apply(n)}get value(){return this.current}set(e){this.current=e,this.apply(e),this.notify()}};function vn(e,t,n){return Math.min(n,Math.max(t,e))}var yn={"bc.threshold":-18,"bc.ratio":4,"bc.attack":10,"bc.release":200,"bc.knee":6,"bc.makeup":3,"bc.mix":1,"bc.duck.depth":0,"bc.duck.release":120,"bc.duck.keyHp":80,"bc.bypass":0,"bc.listen":0},bn=(e,t)=>({name:e,values:t}),xn=[bn(`Init`,{}),bn(`Glue`,{"bc.threshold":-14,"bc.ratio":2,"bc.attack":30,"bc.release":400,"bc.knee":12,"bc.makeup":2}),bn(`Kick Duck`,{"bc.threshold":-6,"bc.ratio":1.5,"bc.makeup":0,"bc.duck.depth":.7,"bc.duck.release":140}),bn(`Gentle Pump`,{"bc.threshold":-16,"bc.ratio":2,"bc.makeup":3,"bc.duck.depth":.35,"bc.duck.release":220}),bn(`Hard Pump`,{"bc.threshold":-12,"bc.ratio":4,"bc.makeup":2,"bc.duck.depth":.95,"bc.duck.release":90,"bc.duck.keyHp":120}),bn(`NY Parallel`,{"bc.threshold":-32,"bc.ratio":8,"bc.attack":3,"bc.release":100,"bc.knee":4,"bc.makeup":10,"bc.mix":.4}),bn(`Drum Smash`,{"bc.threshold":-28,"bc.ratio":20,"bc.attack":1,"bc.release":200,"bc.knee":0,"bc.makeup":8,"bc.mix":.7}),bn(`Limiter`,{"bc.threshold":-4,"bc.ratio":20,"bc.attack":1,"bc.release":100,"bc.knee":0,"bc.makeup":0})],Sn=4,Cn=e=>10**(e/20);function wn(e,t,n){let r=e+n/2<0?e+(0-e)/t:0;return-.6*Math.min(0,r)}var Tn=class extends E{name;slots=[...xn];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;mix=1;makeupDb=3;threshold=-18;ratio=4;knee=6;bypass=!1;listen=!1;constructor(e=`Bus Comp`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`duck`,`gain`,{gain:1}).add(`gate`,`gain`,{gain:1}).add(`comp`,`compressor`,{threshold:-18,knee:6,ratio:4,attack:.01,release:.2}).add(`wet`,`gain`,{gain:Cn(3)}).add(`dry`,`gain`,{gain:0}).add(`bypassPath`,`gain`,{gain:0}).add(`listenPath`,`gain`,{gain:0}).add(`out`,`gain`,{gain:1}).add(`inMeter`,`meter`,{},{channel:`mono`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`inMeter`).connect(`in`,`duck`).connect(`duck`,`gate`).connect(`gate`,`comp`).connect(`gate`,`dry`).connect(`comp`,`wet`).connect(`wet`,`out`).connect(`dry`,`out`).connect(`in`,`bypassPath`).connect(`bypassPath`,`out`).connect(`listenPath`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),t.add(`key`,`gain`,{gain:1},{channels:`mono`}).add(`keyHp`,`filter`,{frequency:80,Q:.707,detune:0},{type:`highpass`}).add(`follow`,`follower`,{attack:.003,release:.12}).add(`sense`,`gain`,{gain:Sn}).add(`keyShape`,`waveshaper`,{},{curve:`soft`}).add(`duckMeter`,`meter`,{},{channel:`mono`}).add(`depth`,`gain`,{gain:0}).connect(`key`,`keyHp`).connect(`keyHp`,`follow`).connect(`follow`,`sense`).connect(`sense`,`keyShape`).connect(`keyShape`,`duckMeter`).connect(`keyShape`,`depth`).connect(`depth`,`duck`,`gain`).connect(`keyHp`,`listenPath`),this.inputList.push({name:`in`,nodeId:`in`},{name:`key`,nodeId:`key`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`in`,nodeId:`inMeter`},{name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`},{name:`duck`,nodeId:`duckMeter`});let n=yn,r=(e,t,r,i,a,o,s)=>this.controlList.push(new D(e,t,r,i,n[e],a,o,s));r(`bc.threshold`,`Threshold`,-60,0,`dB`,e=>{this.threshold=e,t.setParam(`comp`,`threshold`,e),this.applyMix()}),r(`bc.ratio`,`Ratio`,1,20,`:1`,e=>{this.ratio=e,t.setParam(`comp`,`ratio`,e),this.applyMix()}),r(`bc.attack`,`Attack`,.3,100,`ms`,e=>t.setParam(`comp`,`attack`,e/1e3),`log`),r(`bc.release`,`Release`,30,1e3,`ms`,e=>t.setParam(`comp`,`release`,e/1e3),`log`),r(`bc.knee`,`Knee`,0,30,`dB`,e=>{this.knee=e,t.setParam(`comp`,`knee`,e),this.applyMix()}),r(`bc.makeup`,`Make-up`,0,24,`dB`,e=>{this.makeupDb=e,this.applyMix()}),r(`bc.mix`,`Mix`,0,1,``,e=>{this.mix=e,this.applyMix()}),r(`bc.duck.depth`,`Duck depth`,0,1,``,e=>t.setParam(`depth`,`gain`,-e)),r(`bc.duck.release`,`Duck release`,20,800,`ms`,e=>t.setParam(`follow`,`release`,e/1e3),`log`),r(`bc.duck.keyHp`,`Key HP`,20,300,`Hz`,e=>t.setParam(`keyHp`,`frequency`,e),`log`),this.controlList.push(new k(`bc.bypass`,`Bypass`,!1,e=>{this.bypass=e,this.applyPaths()}),new k(`bc.listen`,`Key listen`,!1,e=>{this.listen=e,this.applyPaths()}))}applyMix(){this.circuit.setParam(`dry`,`gain`,1-this.mix),this.circuit.setParam(`wet`,`gain`,this.mix*Cn(this.makeupDb-wn(this.threshold,this.ratio,this.knee)))}applyPaths(){let e=this.circuit;e.setParam(`gate`,`gain`,this.bypass||this.listen?0:1),e.setParam(`bypassPath`,`gain`,this.bypass&&!this.listen?1:0),e.setParam(`listenPath`,`gain`,+!!this.listen)}loadPreset(e){let t={...yn,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`bc.bypass`&&t.id!==`bc.listen`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}},En=[`internal`,`midi`],Dn=[`omni`,...Array.from({length:16},(e,t)=>String(t+1))],On=2e3,kn=4,An=class{clock;now;sync=new O(`transport.sync`,`Sync`,En,`internal`,()=>{});followStartStop=new k(`transport.followStartStop`,`Start/stop`,!0,()=>{});channel=new O(`transport.channel`,`Channel`,Dn,`1`,()=>{});tempo=new D(`transport.tempo`,`Tempo`,20,300,120,`BPM`,()=>{});taps=[];constructor(e,t=()=>performance.now()){this.clock=e,this.now=t}get synced(){return this.sync.value===`midi`}get bpm(){return this.synced?this.clock.bpm??this.tempo.value:this.tempo.value}get locked(){return this.synced&&this.clock.isLocked(this.now())}get running(){return this.synced&&this.followStartStop.value&&this.clock.running}get position(){return this.running?this.clock.position:sn(0)}acceptsChannel(e){return this.channel.value===`omni`||Number(this.channel.value)===e}tap(e=this.now()){let t=this.taps[this.taps.length-1];if(t!==void 0&&e-t>On&&(this.taps=[]),this.taps.push(e),this.taps.length>kn&&this.taps.shift(),this.taps.length>=2){let e=this.taps[this.taps.length-1]-this.taps[0];this.tempo.set(Math.round(6e4/(e/(this.taps.length-1))*10)/10)}}nudge(e){this.tempo.set(Math.round((this.tempo.value+e)*10)/10)}},jn=[`kick`,`snare`,`clap`,`closedHat`,`openHat`,`ride`],Mn=[`rim`,`lowTom`,`midTom`,`highTom`,`cowbell`,`crash`],Nn=[...jn,...Mn],Pn=[...jn,`perc`],Fn={35:`kick`,36:`kick`,38:`snare`,40:`snare`,39:`clap`,42:`closedHat`,44:`closedHat`,46:`openHat`,51:`ride`,59:`ride`,37:`rim`,41:`lowTom`,43:`lowTom`,45:`midTom`,47:`midTom`,48:`highTom`,50:`highTom`,56:`cowbell`,49:`crash`,57:`crash`},In=1200,Ln=[205.3,304.4,369.6,522.7,540,800],Rn=.2,zn=[[2930,-4,21],[4348,-8,53],[4793,-7,62],[5484,0,81],[5531,-8,68],[5695,-8,67],[5865,-5,20],[6369,-8,62],[6697,-8,81],[7154,-7,40],[7494,-5,63],[8186,-7,38],[8379,-6,89],[8637,-7,28]],Bn=[[416,-6,52],[2930,-5,31],[2977,-4,36],[3041,-3,15],[3492,0,29],[3803,-3,31],[3955,-5,44],[4336,-5,50],[5104,-2,35],[5561,-5,49],[5883,-2,50],[6152,-6,35],[7699,0,35],[8092,-5,55]],Vn=[[500,1e3,-14,6],[1e3,2e3,-14,9],[2e3,3e3,-6,13],[3e3,4e3,-12,12],[4e3,5e3,-3,21],[5e3,6e3,-2,30],[6e3,8e3,0,31],[8e3,1e4,-2,33],[1e4,13e3,-6,39],[13e3,17e3,-9,38]],Hn=[[500,1e3,-2,22],[1e3,2e3,-5,22],[2e3,3e3,-6,22],[3e3,4e3,0,15],[4e3,5e3,-3,23],[5e3,6e3,-6,23],[6e3,8e3,-5,22],[8e3,1e4,-6,17],[1e4,13e3,-9,21],[13e3,17e3,-17,20]],Un=1.3,Wn=1.1,Gn=1.3,Kn=4,qn=class extends E{name;transport;choke=new k(`hats.choke`,`Choke`,!0,()=>{});muted=new Set;soloed=new Set;envelopes=new Map;hitListeners=new Set;constructor(e=`Drums`,t=new T){super(),this.name=e,this.transport=new An(t),this.transport.channel.set(`10`);let n=this.circuit;this.addKick(n),this.addSnare(n),this.addClap(n),this.addHat(n,`closedHat`,{decay:[.015,.25,.04],tone:.7,level:.6,band:6800,body:`metal`,attack:0}),this.addHat(n,`openHat`,{decay:[.1,1.5,.32],tone:.65,level:.6,band:6800,body:`noise`,attack:.006}),this.addRide(n),this.addRim(n),this.addTom(n,`lowTom`,100),this.addTom(n,`midTom`,145),this.addTom(n,`highTom`,200),this.addCowbell(n),this.addCrash(n),n.add(`perc.out`,`gain`,{gain:1});for(let e of Nn)n.add(`${e}.mute`,`gain`,{gain:1}).add(`${e}.out`,`gain`,{gain:.8}).add(`${e}.meter`,`meter`,{},{channel:`mono`}).connect(`${e}.sum`,`${e}.mute`).connect(`${e}.mute`,`${e}.out`).connect(`${e}.out`,`${e}.meter`),this.meterList.push({name:e,nodeId:`${e}.meter`}),Mn.includes(e)?n.connect(`${e}.out`,`perc.out`):this.outputList.push({name:e,nodeId:`${e}.out`});this.outputList.push({name:`perc`,nodeId:`perc.out`}),this.addLevels(n),this.controlList.push(this.choke)}trigger(e,t=1,n){if(!(t<=0)){e===`closedHat`&&this.choke.value&&this.circuit.choke(`openHat.ampEnv`,n);for(let r of this.envelopes.get(e)??[])this.circuit.trigger(r,t,n);for(let r of this.hitListeners)r(e,t,n)}}onHit(e){return this.hitListeners.add(e),()=>this.hitListeners.delete(e)}handleMidi(e){if(e.type!==`noteOn`||!this.transport.acceptsChannel(e.channel))return;let t=Fn[e.note];t&&this.trigger(t,e.velocity/127)}get soloActive(){return this.soloed.size>0}register(e,...t){this.envelopes.set(e,[...this.envelopes.get(e)??[],...t])}num(...e){let t=new D(...e);return this.controlList.push(t),t}addKick(e){this.register(`kick`,`kick.pitchEnv`,`kick.ampEnv`,`kick.clickEnv`),e.add(`kick.osc`,`oscillator`,{frequency:48,detune:0},{waveform:`sine`}).add(`kick.pitchEnv`,`trigger`,{peak:2700,decay:.05,velSens:0}).add(`kick.ampEnv`,`trigger`,{peak:.8,decay:.38,velSens:.8}).add(`kick.amp`,`gain`,{gain:0}).add(`kick.noise`,`noise`).add(`kick.clickHp`,`filter`,{frequency:2500,Q:.707},{type:`highpass`}).add(`kick.clickAmp`,`gain`,{gain:0}).add(`kick.clickEnv`,`trigger`,{peak:.24,decay:.012,velSens:1}).add(`kick.sum`,`gain`,{gain:1}).connect(`kick.pitchEnv`,`kick.osc`,`detune`).connect(`kick.osc`,`kick.amp`).connect(`kick.ampEnv`,`kick.amp`,`gain`).connect(`kick.amp`,`kick.sum`).connect(`kick.noise`,`kick.clickHp`).connect(`kick.clickHp`,`kick.clickAmp`).connect(`kick.clickEnv`,`kick.clickAmp`,`gain`).connect(`kick.clickAmp`,`kick.sum`),this.num(`kick.tune`,`Tune`,30,120,48,`Hz`,t=>e.setParam(`kick.osc`,`frequency`,t),`log`),this.num(`kick.decay`,`Decay`,.08,1,.38,`s`,t=>e.setParam(`kick.ampEnv`,`decay`,t),`log`),this.num(`kick.click`,`Click`,0,1,.4,``,t=>e.setParam(`kick.clickEnv`,`peak`,t*.6))}addSnare(e){this.register(`snare`,`snare.pitchEnv`,`snare.bodyEnv`,`snare.noiseEnv`),e.add(`snare.osc1`,`oscillator`,{frequency:190,detune:0},{waveform:`triangle`}).add(`snare.osc2`,`oscillator`,{frequency:347.7,detune:0},{waveform:`triangle`}).add(`snare.pitchEnv`,`trigger`,{peak:500,decay:.03,velSens:0}).add(`snare.bodyEnv`,`trigger`,{peak:.4,decay:.1,velSens:.7}).add(`snare.bodyAmp`,`gain`,{gain:0}).add(`snare.noise`,`noise`).add(`snare.noiseHp`,`filter`,{frequency:1800,Q:.707},{type:`highpass`}).add(`snare.noiseEnv`,`trigger`,{peak:.42,decay:.18,velSens:1}).add(`snare.noiseAmp`,`gain`,{gain:0}).add(`snare.sum`,`gain`,{gain:1}).connect(`snare.osc1`,`snare.bodyAmp`).connect(`snare.osc2`,`snare.bodyAmp`).connect(`snare.pitchEnv`,`snare.osc1`,`detune`).connect(`snare.pitchEnv`,`snare.osc2`,`detune`).connect(`snare.bodyEnv`,`snare.bodyAmp`,`gain`).connect(`snare.bodyAmp`,`snare.sum`).connect(`snare.noise`,`snare.noiseHp`).connect(`snare.noiseHp`,`snare.noiseAmp`).connect(`snare.noiseEnv`,`snare.noiseAmp`,`gain`).connect(`snare.noiseAmp`,`snare.sum`),this.num(`snare.tune`,`Tune`,120,300,190,`Hz`,t=>{e.setParam(`snare.osc1`,`frequency`,t),e.setParam(`snare.osc2`,`frequency`,t*1.83)},`log`),this.num(`snare.decay`,`Decay`,.08,.5,.18,`s`,t=>{e.setParam(`snare.noiseEnv`,`decay`,t),e.setParam(`snare.bodyEnv`,`decay`,t*.55)},`log`),this.num(`snare.snap`,`Snap`,0,1,.6,``,t=>e.setParam(`snare.noiseEnv`,`peak`,t*.7))}addClap(e){this.register(`clap`,`clap.env`),e.add(`clap.noise`,`noise`).add(`clap.bp`,`filter`,{frequency:1200,Q:1.5},{type:`bandpass`}).add(`clap.amp`,`gain`,{gain:0}).add(`clap.env`,`trigger`,{peak:2.3,decay:.24,velSens:.8,spread:.012},{shape:`clap`}).add(`clap.sum`,`gain`,{gain:1}).connect(`clap.noise`,`clap.bp`).connect(`clap.bp`,`clap.amp`).connect(`clap.env`,`clap.amp`,`gain`).connect(`clap.amp`,`clap.sum`),this.num(`clap.tone`,`Tone`,600,3e3,1200,`Hz`,t=>e.setParam(`clap.bp`,`frequency`,t),`log`),this.num(`clap.decay`,`Decay`,.08,.6,.24,`s`,t=>e.setParam(`clap.env`,`decay`,t),`log`),this.num(`clap.spread`,`Spread`,0,1,.5,``,t=>e.setParam(`clap.env`,`spread`,.006+t*.012))}addMetal(e,t,n,r,i,a){e.add(`${t}.tune`,`constant`,{offset:0}).add(`${t}.metal`,`gain`,{gain:a}).add(`${t}.bp`,`filter`,{frequency:r,Q:.8},{type:`bandpass`}).add(`${t}.hp`,`filter`,{frequency:i,Q:.707},{type:`highpass`}).connect(`${t}.metal`,`${t}.bp`).connect(`${t}.bp`,`${t}.hp`),Ln.forEach((r,i)=>{let a=`${t}.sq${i+1}`;e.add(a,`oscillator`,{frequency:r*n,detune:0},{waveform:`square`}).connect(`${t}.tune`,a,`detune`).connect(a,`${t}.metal`)})}addPartials(e,t,n,r,i){e.add(`${t}.partials`,`gain`,{gain:r});let a=n.map(([n,r,i],a)=>{let o=`${t}.p${a+1}`;return e.add(`${o}.osc`,`oscillator`,{frequency:n,detune:0},{waveform:`sine`}).add(`${o}.amp`,`gain`,{gain:0}).add(`${o}.env`,`trigger`,{peak:10**(r/20),decay:Math.min(40/i,Gn),velSens:.8}).connect(`${t}.tune`,`${o}.osc`,`detune`).connect(`${o}.osc`,`${o}.amp`).connect(`${o}.env`,`${o}.amp`,`gain`).connect(`${o}.amp`,`${t}.partials`),`${o}.env`});return this.register(t,...a),t=>n.forEach(([,,n],r)=>e.setParam(a[r],`decay`,Math.min(40/n,Gn)*(t/i)))}addNoiseBands(e,t,n,r,i){e.add(`${t}.bandNoise`,`noise`).add(`${t}.bands`,`gain`,{gain:r});let a=e=>Math.min(40/e,Kn),o=n.map(([n,r,i,o],s)=>{let c=`${t}.b${s+1}`,l=Math.sqrt(n*r);return e.add(`${c}.bp`,`filter`,{frequency:l,Q:l/(r-n)},{type:`bandpass`}).add(`${c}.amp`,`gain`,{gain:0}).add(`${c}.env`,`trigger`,{peak:10**(i/20)/Math.sqrt((r-n)/1e3),decay:a(o),velSens:.8}).connect(`${t}.bandNoise`,`${c}.bp`).connect(`${c}.bp`,`${c}.amp`).connect(`${c}.env`,`${c}.amp`,`gain`).connect(`${c}.amp`,`${t}.bands`),`${c}.env`});return this.register(t,...o),t=>n.forEach(([,,,n],r)=>e.setParam(o[r],`decay`,a(n)*(t/i)))}addHat(e,t,n){this.register(t,`${t}.ampEnv`),this.addMetal(e,t,1.13,n.band,500+n.tone*5e3,.45),e.add(`${t}.noise`,`noise`).add(`${t}.noiseAmp`,`gain`,{gain:n.body===`metal`?.45:.65}).connect(`${t}.noise`,`${t}.noiseAmp`).connect(`${t}.noiseAmp`,`${t}.metal`).add(`${t}.gritPre`,`gain`,{gain:2.5}).add(`${t}.crush`,`waveshaper`,{bits:6},{curve:`crush`}).add(`${t}.gritPost`,`gain`,{gain:.5}).connect(`${t}.hp`,`${t}.gritPre`).add(`${t}.bodyLp`,`filter`,{frequency:n.body===`metal`?2e4:2500,Q:.5},{type:`lowpass`}).add(`${t}.body`,`gain`,{gain:n.body===`metal`?.1:.4}).connect(n.body===`metal`?`${t}.metal`:`${t}.noise`,`${t}.bodyLp`).connect(`${t}.bodyLp`,`${t}.body`).connect(`${t}.body`,`${t}.gritPre`).connect(`${t}.gritPre`,`${t}.crush`).connect(`${t}.crush`,`${t}.gritPost`).add(`${t}.amp`,`gain`,{gain:0}).add(`${t}.ampEnv`,`trigger`,{peak:1,decay:n.decay[2],velSens:.8,...n.attack?{attack:n.attack}:{}}).add(`${t}.sum`,`gain`,{gain:1}).connect(`${t}.gritPost`,`${t}.amp`).connect(`${t}.ampEnv`,`${t}.amp`,`gain`).connect(`${t}.amp`,`${t}.sum`),this.num(`${t}.tune`,`Tune`,0,1,.6,``,n=>e.setParam(`${t}.tune`,`offset`,(n-.6)*2*In)),this.num(`${t}.decay`,`Decay`,n.decay[0],n.decay[1],n.decay[2],`s`,n=>e.setParam(`${t}.ampEnv`,`decay`,n),`log`),this.num(`${t}.tone`,`Tone`,0,1,n.tone,``,n=>e.setParam(`${t}.hp`,`frequency`,500+n*5e3))}addRide(e){this.register(`ride`,`ride.ampEnv`,`ride.pingEnv`,`ride.bellEnv`,`ride.airEnv`,`ride.tickEnv`),e.add(`ride.sum`,`gain`,{gain:1}),this.addMetal(e,`ride`,1.75,7e3,3e3,.3),e.add(`ride.gritPre`,`gain`,{gain:2.2}).add(`ride.crush`,`waveshaper`,{bits:6},{curve:`crush`}).add(`ride.gritPost`,`gain`,{gain:.45}).connect(`ride.hp`,`ride.gritPre`).add(`ride.body`,`gain`,{gain:.1}).connect(`ride.metal`,`ride.body`).connect(`ride.body`,`ride.gritPre`).connect(`ride.gritPre`,`ride.crush`).connect(`ride.crush`,`ride.gritPost`).add(`ride.amp`,`gain`,{gain:0}).add(`ride.ampEnv`,`trigger`,{peak:.4,decay:1.4,velSens:.8}).connect(`ride.gritPost`,`ride.amp`).connect(`ride.ampEnv`,`ride.amp`,`gain`).add(`ride.pingBp`,`filter`,{frequency:6500,Q:.9},{type:`bandpass`}).add(`ride.pingAmp`,`gain`,{gain:0}).add(`ride.pingEnv`,`trigger`,{peak:.6,decay:.06,velSens:.9}).connect(`ride.gritPost`,`ride.pingBp`).connect(`ride.pingBp`,`ride.pingAmp`).connect(`ride.pingEnv`,`ride.pingAmp`,`gain`).add(`ride.bellBp`,`filter`,{frequency:2900,Q:10},{type:`bandpass`}).add(`ride.bellAmp`,`gain`,{gain:0}).add(`ride.bellEnv`,`trigger`,{peak:.4,decay:.55,velSens:.8}).connect(`ride.metal`,`ride.bellBp`).connect(`ride.bellBp`,`ride.bellAmp`).connect(`ride.bellEnv`,`ride.bellAmp`,`gain`).add(`ride.noise`,`noise`).add(`ride.airHp`,`filter`,{frequency:6e3,Q:.707},{type:`highpass`}).add(`ride.airAmp`,`gain`,{gain:0}).add(`ride.airEnv`,`trigger`,{peak:.12,decay:1.1,velSens:.8}).add(`ride.tickHp`,`filter`,{frequency:5e3,Q:.707},{type:`highpass`}).add(`ride.tickAmp`,`gain`,{gain:0}).add(`ride.tickEnv`,`trigger`,{peak:.3,decay:.005,velSens:1}).connect(`ride.noise`,`ride.airHp`).connect(`ride.airHp`,`ride.airAmp`).connect(`ride.airEnv`,`ride.airAmp`,`gain`).connect(`ride.noise`,`ride.tickHp`).connect(`ride.tickHp`,`ride.tickAmp`).connect(`ride.tickEnv`,`ride.tickAmp`,`gain`).add(`ride.layers`,`gain`,{gain:Rn});for(let t of[`ride.amp`,`ride.pingAmp`,`ride.bellAmp`,`ride.airAmp`,`ride.tickAmp`])e.connect(t,`ride.layers`);e.connect(`ride.layers`,`ride.sum`);let t=this.addPartials(e,`ride`,zn,.15,Un),n=this.addNoiseBands(e,`ride`,Vn,.7,Un);e.connect(`ride.partials`,`ride.sum`).connect(`ride.bands`,`ride.sum`),this.num(`ride.tune`,`Tune`,0,1,.5,``,t=>e.setParam(`ride.tune`,`offset`,(t-.5)*2*In)),this.num(`ride.decay`,`Decay`,.3,2.5,.75,`s`,r=>{e.setParam(`ride.ampEnv`,`decay`,r*1.15),e.setParam(`ride.airEnv`,`decay`,r*.9),e.setParam(`ride.bellEnv`,`decay`,r*.45),t(r),n(r)},`log`),this.num(`ride.bell`,`Bell`,0,1,.45,``,t=>e.setParam(`ride.bellEnv`,`peak`,t*.9))}addRim(e){this.register(`rim`,`rim.toneEnv`,`rim.clickEnv`),e.add(`rim.osc1`,`oscillator`,{frequency:480,detune:0},{waveform:`triangle`}).add(`rim.osc2`,`oscillator`,{frequency:1720,detune:0},{waveform:`sine`}).add(`rim.tune`,`constant`,{offset:0}).add(`rim.bp`,`filter`,{frequency:1600,Q:2.2},{type:`bandpass`}).add(`rim.toneAmp`,`gain`,{gain:0}).add(`rim.toneEnv`,`trigger`,{peak:1.4,decay:.03,velSens:.8}).add(`rim.noise`,`noise`).add(`rim.hp`,`filter`,{frequency:5e3,Q:.707},{type:`highpass`}).add(`rim.clickAmp`,`gain`,{gain:0}).add(`rim.clickEnv`,`trigger`,{peak:.3,decay:.008,velSens:1}).add(`rim.sum`,`gain`,{gain:1}).connect(`rim.tune`,`rim.osc1`,`detune`).connect(`rim.tune`,`rim.osc2`,`detune`).connect(`rim.osc1`,`rim.bp`).connect(`rim.osc2`,`rim.bp`).connect(`rim.bp`,`rim.toneAmp`).connect(`rim.toneEnv`,`rim.toneAmp`,`gain`).connect(`rim.toneAmp`,`rim.sum`).connect(`rim.noise`,`rim.hp`).connect(`rim.hp`,`rim.clickAmp`).connect(`rim.clickEnv`,`rim.clickAmp`,`gain`).connect(`rim.clickAmp`,`rim.sum`),this.num(`rim.tune`,`Tune`,0,1,.5,``,t=>e.setParam(`rim.tune`,`offset`,(t-.5)*2*In)),this.num(`rim.decay`,`Decay`,.01,.12,.03,`s`,t=>e.setParam(`rim.toneEnv`,`decay`,t),`log`),this.num(`rim.tone`,`Tone`,600,4e3,1600,`Hz`,t=>e.setParam(`rim.bp`,`frequency`,t),`log`)}addTom(e,t,n){this.register(t,`${t}.pitchEnv`,`${t}.ampEnv`,`${t}.noiseEnv`),e.add(`${t}.osc`,`oscillator`,{frequency:n,detune:0},{waveform:`sine`}).add(`${t}.pitchEnv`,`trigger`,{peak:700,decay:.09,velSens:0}).add(`${t}.ampEnv`,`trigger`,{peak:.9,decay:.4,velSens:.8}).add(`${t}.amp`,`gain`,{gain:0}).add(`${t}.noise`,`noise`).add(`${t}.bp`,`filter`,{frequency:n*4,Q:1.2},{type:`bandpass`}).add(`${t}.noiseAmp`,`gain`,{gain:0}).add(`${t}.noiseEnv`,`trigger`,{peak:.12,decay:.06,velSens:1}).add(`${t}.sum`,`gain`,{gain:1}).connect(`${t}.pitchEnv`,`${t}.osc`,`detune`).connect(`${t}.osc`,`${t}.amp`).connect(`${t}.ampEnv`,`${t}.amp`,`gain`).connect(`${t}.amp`,`${t}.sum`).connect(`${t}.noise`,`${t}.bp`).connect(`${t}.bp`,`${t}.noiseAmp`).connect(`${t}.noiseEnv`,`${t}.noiseAmp`,`gain`).connect(`${t}.noiseAmp`,`${t}.sum`),this.num(`${t}.tune`,`Tune`,n*.6,n*1.6,n,`Hz`,n=>{e.setParam(`${t}.osc`,`frequency`,n),e.setParam(`${t}.bp`,`frequency`,n*4)},`log`),this.num(`${t}.decay`,`Decay`,.1,1.2,.4,`s`,n=>e.setParam(`${t}.ampEnv`,`decay`,n),`log`),this.num(`${t}.bend`,`Bend`,0,1,.5,``,n=>e.setParam(`${t}.pitchEnv`,`peak`,n*1400))}addCowbell(e){this.register(`cowbell`,`cowbell.strikeEnv`,`cowbell.env`,`cowbell.pitchEnv`),e.add(`cowbell.tune`,`constant`,{offset:0}).add(`cowbell.pitchEnv`,`trigger`,{peak:120,decay:.015,velSens:.5}).add(`cowbell.sq1`,`oscillator`,{frequency:540,detune:0},{waveform:`square`}).add(`cowbell.sq2`,`oscillator`,{frequency:800,detune:0},{waveform:`square`}).add(`cowbell.bp`,`filter`,{frequency:900,Q:.9},{type:`bandpass`}).add(`cowbell.lp`,`filter`,{frequency:4500,Q:.6},{type:`lowpass`}).add(`cowbell.amp`,`gain`,{gain:0}).add(`cowbell.strikeEnv`,`trigger`,{peak:.75,decay:.012,velSens:.9}).add(`cowbell.env`,`trigger`,{peak:.22,decay:.4,velSens:.7}).add(`cowbell.sum`,`gain`,{gain:1}).connect(`cowbell.tune`,`cowbell.sq1`,`detune`).connect(`cowbell.tune`,`cowbell.sq2`,`detune`).connect(`cowbell.pitchEnv`,`cowbell.sq1`,`detune`).connect(`cowbell.pitchEnv`,`cowbell.sq2`,`detune`).connect(`cowbell.sq1`,`cowbell.bp`).connect(`cowbell.sq2`,`cowbell.bp`).connect(`cowbell.bp`,`cowbell.lp`).connect(`cowbell.lp`,`cowbell.amp`).connect(`cowbell.strikeEnv`,`cowbell.amp`,`gain`).connect(`cowbell.env`,`cowbell.amp`,`gain`).connect(`cowbell.amp`,`cowbell.sum`),this.num(`cowbell.tune`,`Tune`,0,1,.5,``,t=>e.setParam(`cowbell.tune`,`offset`,(t-.5)*In)),this.num(`cowbell.decay`,`Decay`,.05,1,.4,`s`,t=>e.setParam(`cowbell.env`,`decay`,t),`log`),this.num(`cowbell.tone`,`Tone`,500,6e3,900,`Hz`,t=>e.setParam(`cowbell.bp`,`frequency`,t),`log`)}addCrash(e){this.register(`crash`,`crash.ampEnv`,`crash.noiseEnv`),this.addMetal(e,`crash`,1.15,4500,2500,.35),e.add(`crash.gritPre`,`gain`,{gain:2.5}).add(`crash.crush`,`waveshaper`,{bits:6},{curve:`crush`}).add(`crash.gritPost`,`gain`,{gain:.5}).add(`crash.body`,`gain`,{gain:.35}).connect(`crash.hp`,`crash.gritPre`).connect(`crash.metal`,`crash.body`).connect(`crash.body`,`crash.gritPre`).connect(`crash.gritPre`,`crash.crush`).connect(`crash.crush`,`crash.gritPost`).add(`crash.amp`,`gain`,{gain:0}).add(`crash.ampEnv`,`trigger`,{peak:.15,decay:1.1,velSens:.8}).add(`crash.noise`,`noise`).add(`crash.noiseHp`,`filter`,{frequency:4e3,Q:.707},{type:`highpass`}).add(`crash.noiseAmp`,`gain`,{gain:0}).add(`crash.noiseEnv`,`trigger`,{peak:0,decay:.8,velSens:.8}).add(`crash.sum`,`gain`,{gain:1}).connect(`crash.gritPost`,`crash.amp`).connect(`crash.ampEnv`,`crash.amp`,`gain`).connect(`crash.amp`,`crash.sum`).connect(`crash.noise`,`crash.noiseHp`).connect(`crash.noiseHp`,`crash.noiseAmp`).connect(`crash.noiseEnv`,`crash.noiseAmp`,`gain`).connect(`crash.noiseAmp`,`crash.sum`);let t=this.addPartials(e,`crash`,Bn,.15,Wn),n=this.addNoiseBands(e,`crash`,Hn,.7,Wn);e.connect(`crash.partials`,`crash.sum`).connect(`crash.bands`,`crash.sum`),this.num(`crash.tune`,`Tune`,0,1,.5,``,t=>e.setParam(`crash.tune`,`offset`,(t-.5)*2*In)),this.num(`crash.decay`,`Decay`,.3,4,1.1,`s`,r=>{e.setParam(`crash.ampEnv`,`decay`,r),e.setParam(`crash.noiseEnv`,`decay`,r*.75),t(r),n(r)},`log`),this.num(`crash.tone`,`Tone`,0,1,.5,``,t=>e.setParam(`crash.hp`,`frequency`,1e3+t*3e3))}addLevels(e){let t={kick:.8,snare:.75,clap:.7,closedHat:.6,openHat:.6,ride:.55,rim:.6,lowTom:.7,midTom:.7,highTom:.7,cowbell:.5,crash:.5};for(let n of Nn)this.num(`${n}.level`,`Level`,0,1,t[n],``,t=>e.setParam(`${n}.out`,`gain`,t)),this.controlList.push(new k(`${n}.mute`,`Mute`,!1,e=>this.setFlag(this.muted,n,e)),new k(`${n}.solo`,`Solo`,!1,e=>this.setFlag(this.soloed,n,e)))}setFlag(e,t,n){n?e.add(t):e.delete(t);for(let e of Nn){let t=`${e}.mute`;if(!this.circuit.nodes.has(t))continue;let n=this.muted.has(e)||this.soloed.size>0&&!this.soloed.has(e);this.circuit.setParam(t,`gain`,+!n)}}},Jn=[`small`,`medium`,`large`],Yn=3.5,A=Math.tanh(2.5)/2.5,Xn=2,Zn=class extends E{name;constructor(e=`Reverb`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`pre`,`delay`,{delayTime:.02,maxTime:.3}).add(`conv`,`convolver`,{},{size:`medium`}).add(`lowcut`,`filter`,{frequency:150,Q:.707,detune:0},{type:`highpass`}).add(`damp`,`filter`,{frequency:5e3,Q:.707,detune:0},{type:`lowpass`}).add(`drive`,`gain`,{gain:Yn*A/Xn}).add(`sat`,`waveshaper`,{},{curve:`soft`}).add(`out`,`gain`,{gain:Xn}).connect(`in`,`pre`).connect(`pre`,`conv`).connect(`conv`,`lowcut`).connect(`lowcut`,`damp`).connect(`damp`,`drive`).connect(`drive`,`sat`).connect(`sat`,`out`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.controlList.push(new O(`reverb.size`,`Size`,Jn,`medium`,e=>t.setOption(`conv`,`size`,e)),new D(`reverb.predelay`,`Pre-delay`,0,250,20,`ms`,e=>t.setParam(`pre`,`delayTime`,e/1e3)),new D(`reverb.lowcut`,`Low cut`,40,600,150,`Hz`,e=>t.setParam(`lowcut`,`frequency`,e),`log`),new D(`reverb.damp`,`Damping`,1e3,16e3,5e3,`Hz`,e=>t.setParam(`damp`,`frequency`,e),`log`))}},Qn=class extends E{name;spread=.8;feedback=.45;constructor(e=`Delay`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`out`,`gain`,{gain:.5}).add(`wobble`,`oscillator`,{frequency:.9,detune:0},{waveform:`sine`}).add(`wobbleDepth`,`gain`,{gain:6e-4});for(let e of[`L`,`R`]){let n=t=>`${t}${e}`;t.add(n(`inGain`),`gain`,{gain:1}).add(n(`dly`),`delay`,{delayTime:.375,maxTime:2}).add(n(`tone`),`filter`,{frequency:3200,Q:.707,detune:0},{type:`lowpass`}).add(n(`hp`),`filter`,{frequency:120,Q:.707,detune:0},{type:`highpass`}).add(n(`drive`),`gain`,{gain:1.9}).add(n(`sat`),`waveshaper`,{},{curve:`soft`}).add(n(`make`),`gain`,{gain:A/1.9}).add(n(`fbSelf`),`gain`,{gain:0}).add(n(`fbCross`),`gain`,{gain:0}).add(n(`pan`),`pan`,{pan:e===`L`?-1:1}).connect(`in`,n(`inGain`)).connect(n(`inGain`),n(`dly`)).connect(n(`dly`),n(`tone`)).connect(n(`tone`),n(`hp`)).connect(n(`hp`),n(`drive`)).connect(n(`drive`),n(`sat`)).connect(n(`sat`),n(`make`)).connect(n(`make`),n(`fbSelf`)).connect(n(`make`),n(`fbCross`)).connect(n(`sat`),n(`pan`)).connect(n(`pan`),`out`).connect(`wobbleDepth`,n(`dly`),`delayTime`)}t.connect(`fbSelfL`,`dlyL`).connect(`fbCrossL`,`dlyR`).connect(`fbSelfR`,`dlyR`).connect(`fbCrossR`,`dlyL`).connect(`wobble`,`wobbleDepth`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`});let n=e=>{e(`L`),e(`R`)};this.controlList.push(new D(`delay.time`,`Time`,20,1500,375,`ms`,e=>n(n=>t.setParam(`dly${n}`,`delayTime`,e/1e3)),`log`),new D(`delay.feedback`,`Feedback`,0,1.1,.45,``,e=>{this.feedback=e,this.applyFeedback()}),new D(`delay.tone`,`Tone`,400,12e3,3200,`Hz`,e=>n(n=>t.setParam(`tone${n}`,`frequency`,e)),`log`),new D(`delay.spread`,`Ping-pong`,0,1,.8,``,e=>{this.spread=e,this.applyFeedback(),t.setParam(`inGainR`,`gain`,1-e)}),new D(`delay.wobble`,`Wobble`,0,1,.15,``,e=>t.setParam(`wobbleDepth`,`gain`,e*.004)),new D(`delay.drive`,`Drive`,0,1,.3,``,e=>{let r=1+e*3;n(e=>{t.setParam(`drive${e}`,`gain`,r),t.setParam(`make${e}`,`gain`,A/r)})}))}applyFeedback(){let e=this.circuit;for(let t of[`L`,`R`])e.setParam(`fbSelf${t}`,`gain`,this.feedback*(1-this.spread)),e.setParam(`fbCross${t}`,`gain`,this.feedback*this.spread)}},$n=1,er=2,tr=.8,nr={"gr.position":.3,"gr.size":120,"gr.pitch":0,"gr.rate":12,"gr.spread":.5,"gr.cloud":.2,"gr.detune":0,"gr.shape":.3,"gr.reverse":0,"gr.feedback":0,"gr.mix":1,"gr.freeze":0,"gr.filter":2e4,"gr.reso":.7,"gr.drive":0,"gr.reverb":0,"gr.tone":8e3,"gr.tail":`medium`,"gr.play":0,"gr.attack":20,"gr.decay":300,"gr.sustain":.8,"gr.release":600},rr=3.5,ir=2,ar=7,or=(e,t)=>({name:e,values:t}),sr=[or(`Init`,{}),or(`Cloud Wash`,{"gr.position":.5,"gr.size":350,"gr.rate":30,"gr.spread":1,"gr.cloud":.6,"gr.detune":12,"gr.shape":0,"gr.reverb":.35,"gr.tail":`large`}),or(`Frozen Pad`,{"gr.position":.15,"gr.size":700,"gr.rate":14,"gr.spread":.9,"gr.cloud":.25,"gr.detune":6,"gr.shape":0,"gr.freeze":1,"gr.filter":3500,"gr.reverb":.3,"gr.tail":`large`}),or(`Stutter`,{"gr.position":.02,"gr.size":90,"gr.rate":8,"gr.spread":.2,"gr.cloud":0,"gr.shape":.7}),or(`Octave Shimmer`,{"gr.position":.25,"gr.size":220,"gr.pitch":12,"gr.rate":24,"gr.spread":.8,"gr.cloud":.3,"gr.detune":8,"gr.feedback":.35,"gr.reverb":.25}),or(`Reverse Swell`,{"gr.position":.35,"gr.size":900,"gr.rate":6,"gr.spread":.6,"gr.cloud":.15,"gr.shape":0,"gr.reverse":1}),or(`Glitch Dust`,{"gr.position":.6,"gr.size":25,"gr.rate":70,"gr.spread":1,"gr.cloud":.9,"gr.detune":40,"gr.shape":.8,"gr.reverse":.3,"gr.drive":.35,"gr.filter":9e3,"gr.reso":3}),or(`Tape Drone`,{"gr.position":.1,"gr.size":500,"gr.pitch":-12,"gr.rate":18,"gr.spread":.4,"gr.cloud":.1,"gr.detune":4,"gr.shape":0,"gr.feedback":.6,"gr.filter":1800,"gr.reso":2,"gr.drive":.25})],cr=class extends E{name;slots=[...sr];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;noteListeners=new Set;performanceListeners=new Set;held=[];bend=0;modWheelValue=0;pitchSemitones=0;constructor(e=`Granular`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1},{channels:`mono`}).add(`grains`,`granular`,{maxTime:20,position:.3,size:.12,pitch:0,rate:12,spread:.5,cloud:.2,detune:0,shape:.3,reverse:0,feedback:0,freeze:0,play:0,attack:.02,decay:.3,sustain:.8,release:.6}).add(`filter`,`filter`,{frequency:2e4,Q:.7,gain:0,detune:0},{type:`lowpass`}).add(`preDrive`,`gain`,{gain:1}).add(`sat`,`waveshaper`,{},{curve:`soft`}).add(`postDrive`,`gain`,{gain:A}).add(`revSend`,`gain`,{gain:0}).add(`conv`,`convolver`,{},{size:`medium`}).add(`revTone`,`filter`,{frequency:8e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`revDrive`,`gain`,{gain:rr*A/ir}).add(`revSat`,`waveshaper`,{},{curve:`soft`}).add(`revOut`,`gain`,{gain:ir}).add(`wet`,`gain`,{gain:1}).add(`dry`,`gain`,{gain:0}).add(`out`,`gain`,{gain:1}).add(`inMeter`,`meter`,{},{channel:`mono`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`grains`).connect(`in`,`dry`).connect(`in`,`inMeter`).connect(`grains`,`filter`).connect(`filter`,`preDrive`).connect(`preDrive`,`sat`).connect(`sat`,`postDrive`).connect(`postDrive`,`wet`).connect(`wet`,`out`).connect(`postDrive`,`revSend`).connect(`revSend`,`conv`).connect(`conv`,`revTone`).connect(`revTone`,`revDrive`).connect(`revDrive`,`revSat`).connect(`revSat`,`revOut`).connect(`revOut`,`out`).connect(`dry`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`in`,nodeId:`inMeter`},{name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=nr,r=(e,t,r,i,a,o,s)=>this.controlList.push(new D(e,t,r,i,n[e],a,o,s)),i=(e,n,i,a,o,s,c=1,l)=>r(e,n,i,a,o,e=>t.setParam(`grains`,s,e*c),l);i(`gr.position`,`Position`,0,1,``,`position`),i(`gr.size`,`Size`,5,2e3,`ms`,`size`,1/1e3,`log`),r(`gr.pitch`,`Pitch`,-24,24,`st`,e=>{this.pitchSemitones=e,this.applyPitch()}),i(`gr.rate`,`Rate`,.5,100,`Hz`,`rate`,1,`log`),i(`gr.spread`,`Spread`,0,1,``,`spread`),i(`gr.cloud`,`Cloud`,0,1,``,`cloud`),i(`gr.detune`,`Detune`,0,100,`ct`,`detune`),i(`gr.shape`,`Shape`,0,1,``,`shape`),i(`gr.reverse`,`Reverse`,0,1,``,`reverse`),i(`gr.feedback`,`Feedback`,0,.95,``,`feedback`),r(`gr.filter`,`Filter`,40,2e4,`Hz`,e=>t.setParam(`filter`,`frequency`,e),`log`),r(`gr.reso`,`Reso`,.7,12,``,e=>t.setParam(`filter`,`Q`,e),`log`),r(`gr.drive`,`Drive`,0,1,``,e=>{t.setParam(`preDrive`,`gain`,1+ar*e),t.setParam(`postDrive`,`gain`,A/(1+2*e))}),r(`gr.reverb`,`Reverb`,0,1,``,e=>t.setParam(`revSend`,`gain`,e)),r(`gr.tone`,`Tone`,1e3,16e3,`Hz`,e=>t.setParam(`revTone`,`frequency`,e),`log`),r(`gr.mix`,`Mix`,0,1,``,e=>{t.setParam(`wet`,`gain`,e),t.setParam(`dry`,`gain`,1-e)}),r(`gr.attack`,`Attack`,1,4e3,`ms`,e=>t.setParam(`grains`,`attack`,e/1e3),`log`),r(`gr.decay`,`Decay`,5,4e3,`ms`,e=>t.setParam(`grains`,`decay`,e/1e3),`log`),r(`gr.sustain`,`Sustain`,0,1,``,e=>t.setParam(`grains`,`sustain`,e)),r(`gr.release`,`Release`,5,8e3,`ms`,e=>t.setParam(`grains`,`release`,e/1e3),`log`),this.controlList.push(new k(`gr.play`,`Keys`,!1,e=>{t.setParam(`grains`,`play`,+!!e),e||this.releaseAll()}),new O(`gr.channel`,`MIDI channel`,Dn,`3`,()=>{}),new O(`gr.tail`,`Tail`,Jn,`medium`,e=>t.setOption(`conv`,`size`,e)),new k(`gr.freeze`,`Freeze`,!1,e=>t.setParam(`grains`,`freeze`,+!!e)))}applyPitch(){this.circuit.setParam(`grains`,`pitch`,this.pitchSemitones+this.bend*er)}releaseAll(){if(this.circuit.allNotesOff(`grains`),this.held.length>0){this.held=[];for(let e of this.noteListeners)e()}}keyDown(e,t=tr){let n=this.control(`gr.play`);n.kind===`toggle`&&!n.value&&n.set(!0),this.held=this.held.filter(t=>t!==e),this.held.push(e),this.circuit.noteOn(`grains`,e,t);for(let e of this.noteListeners)e()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.circuit.noteOff(`grains`,e);for(let e of this.noteListeners)e()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.applyPitch();for(let e of this.performanceListeners)e()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e));for(let e of this.performanceListeners)e()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(!(`channel`in e))return;let t=this.control(`gr.channel`);if(!(t.kind!==`choice`||t.value!==`omni`&&Number(t.value)!==e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity/127);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===$n&&this.setModWheel(e.value/127);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...nr,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`gr.channel`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}},lr=[`series`,`parallel`,`pingpong`],ur=[`lfo`,`env`],dr=[`tri`,`ramp`,`sqr`,`rnd`],fr=[`lp`,`hp`],pr=[`a`,`b`],j=e=>e.toUpperCase(),mr=.25,hr=3600,gr=.8,_r=.5,vr=1,yr=8e-4,br={"ouro.input":1,"ouro.mix":.5,"ouro.output":1,"ouro.routing":`parallel`,"ouro.kill":0,"ouro.freeze":0,"ouro.a.on":1,"ouro.a.gain":1,"ouro.a.delay":380,"ouro.a.grit":.15,"ouro.a.cutoff":3e3,"ouro.a.resonance":1.2,"ouro.a.filter":`lp`,"ouro.a.clip":.25,"ouro.a.level":1,"ouro.b.on":1,"ouro.b.gain":1,"ouro.b.delay":530,"ouro.b.grit":.15,"ouro.b.cutoff":2200,"ouro.b.resonance":1.2,"ouro.b.filter":`lp`,"ouro.b.clip":.25,"ouro.b.level":1,"ouro.fb.aa":.35,"ouro.fb.ab":.15,"ouro.fb.ba":.15,"ouro.fb.bb":.35,"ouro.mod.mode":`lfo`,"ouro.mod.wave":`tri`,"ouro.mod.rate":.8,"ouro.mod.depth":.4,"ouro.mod.trigger":0,"ouro.mod.dlyA":.15,"ouro.mod.dlyB":-.15,"ouro.mod.cutA":0,"ouro.mod.cutB":0,"ouro.mod.gainA":0,"ouro.mod.gainB":0},xr=(e,t)=>({name:e,values:t}),Sr=[xr(`Tape Spiral`,{"ouro.routing":`series`,"ouro.a.delay":240,"ouro.b.delay":360,"ouro.fb.aa":.35,"ouro.fb.bb":.4,"ouro.fb.ab":0,"ouro.fb.ba":.15,"ouro.a.grit":.35,"ouro.a.cutoff":2200,"ouro.b.cutoff":1800,"ouro.mod.rate":.4,"ouro.mod.depth":.6,"ouro.mod.dlyA":.3,"ouro.mod.dlyB":.2,"ouro.mod.cutA":.1}),xr(`Karaoke Drone`,{"ouro.mix":.7,"ouro.fb.aa":.95,"ouro.fb.bb":.95,"ouro.a.gain":1.6,"ouro.b.gain":1.6,"ouro.a.grit":.5,"ouro.b.grit":.5,"ouro.a.clip":.6,"ouro.b.clip":.6,"ouro.a.delay":700,"ouro.b.delay":910,"ouro.a.cutoff":1400,"ouro.b.cutoff":1e3,"ouro.a.resonance":4,"ouro.b.resonance":4}),xr(`Ping Pong Mayhem`,{"ouro.routing":`pingpong`,"ouro.mix":.6,"ouro.a.delay":280,"ouro.b.delay":280,"ouro.fb.ab":0,"ouro.fb.ba":.15,"ouro.fb.aa":.1,"ouro.fb.bb":.1,"ouro.a.resonance":.7,"ouro.b.resonance":.7,"ouro.a.grit":.1,"ouro.mod.depth":0}),xr(`Dub Wash`,{"ouro.routing":`series`,"ouro.mix":.45,"ouro.a.delay":480,"ouro.b.delay":720,"ouro.fb.aa":.6,"ouro.fb.bb":.5,"ouro.fb.ab":.1,"ouro.fb.ba":.1,"ouro.a.cutoff":1800,"ouro.b.cutoff":1200,"ouro.a.resonance":2.5,"ouro.b.resonance":2.5,"ouro.a.clip":.2,"ouro.mod.rate":.25,"ouro.mod.depth":.5,"ouro.mod.cutA":.4,"ouro.mod.cutB":.3}),xr(`Self Oscillator`,{"ouro.input":.2,"ouro.mix":1,"ouro.fb.aa":1.1,"ouro.fb.bb":1.1,"ouro.fb.ab":.3,"ouro.fb.ba":.3,"ouro.a.resonance":18,"ouro.b.resonance":18,"ouro.a.cutoff":800,"ouro.b.cutoff":1200,"ouro.a.clip":.5,"ouro.b.clip":.5,"ouro.a.delay":60,"ouro.b.delay":90,"ouro.mod.rate":.1,"ouro.mod.depth":.3,"ouro.mod.cutA":.5}),xr(`Broken Echo`,{"ouro.a.grit":.85,"ouro.b.grit":.85,"ouro.a.delay":330,"ouro.b.delay":470,"ouro.fb.aa":.55,"ouro.fb.bb":.55,"ouro.a.clip":.7,"ouro.b.clip":.7,"ouro.mod.wave":`rnd`,"ouro.mod.rate":6,"ouro.mod.depth":.7,"ouro.mod.dlyA":.4,"ouro.mod.dlyB":-.3,"ouro.mod.gainA":.3}),xr(`Filter Scream`,{"ouro.routing":`series`,"ouro.mix":.8,"ouro.a.filter":`hp`,"ouro.a.cutoff":2500,"ouro.a.resonance":16,"ouro.b.cutoff":1500,"ouro.b.resonance":16,"ouro.fb.aa":.6,"ouro.fb.bb":.6,"ouro.fb.ab":.2,"ouro.fb.ba":.1,"ouro.a.clip":.8,"ouro.b.clip":.8,"ouro.mod.wave":`ramp`,"ouro.mod.rate":2,"ouro.mod.depth":.8,"ouro.mod.cutA":.8,"ouro.mod.cutB":-.8}),xr(`Slow Rot`,{"ouro.routing":`series`,"ouro.mix":.55,"ouro.a.delay":900,"ouro.b.delay":1300,"ouro.a.grit":.6,"ouro.b.grit":.6,"ouro.fb.aa":.55,"ouro.fb.bb":.55,"ouro.fb.ab":0,"ouro.fb.ba":.1,"ouro.a.cutoff":900,"ouro.b.cutoff":700,"ouro.a.resonance":1,"ouro.b.resonance":1,"ouro.mod.rate":.08,"ouro.mod.depth":.9,"ouro.mod.dlyA":.5,"ouro.mod.dlyB":.4,"ouro.a.level":.9,"ouro.b.level":.9})],Cr=class extends E{name;slots=[...Sr];currentSlot=0;currentPreset=this.slots[0];fb={aa:.35,ab:.15,ba:.15,bb:.35};on={a:!0,b:!0};clipDrive={a:1.25,b:1.25};routing=`parallel`;killed=!1;frozen=!1;modRate=.8;presetListeners=new Set;constructor(e=`Ouroboros`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`mono`,`gain`,{gain:1},{channels:`mono`}).add(`inGain`,`gain`,{gain:1}).add(`srcGate`,`gain`,{gain:1}).add(`srcA`,`gain`,{gain:1}).add(`srcB`,`gain`,{gain:1}).add(`dry`,`gain`,{gain:Math.SQRT1_2}).add(`wet`,`gain`,{gain:Math.SQRT1_2}).add(`sum`,`gain`,{gain:1}).add(`out`,`gain`,{gain:1}).connect(`in`,`mono`).connect(`mono`,`inGain`).connect(`inGain`,`srcGate`).connect(`srcGate`,`srcA`).connect(`srcGate`,`srcB`).connect(`in`,`dry`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`out`).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`L`,nodeId:`meterL`},{name:`R`,nodeId:`meterR`});for(let e of pr)this.addChannel(t,e);t.add(`linkAB`,`gain`,{gain:0}).add(`bounceBA`,`gain`,{gain:0}).connect(`lvlA`,`linkAB`).connect(`linkAB`,`inB`).connect(`lvlB`,`bounceBA`).connect(`bounceBA`,`inA`).connect(`srcA`,`inA`).connect(`srcB`,`inB`);for(let e of pr)for(let n of pr)t.add(`fb${j(e)}${j(n)}`,`gain`,{gain:0}).connect(`clip${j(e)}`,`fb${j(e)}${j(n)}`).connect(`fb${j(e)}${j(n)}`,`in${j(n)}`);t.add(`seedNoise`,`noise`).add(`seedGain`,`gain`,{gain:yr}).connect(`seedNoise`,`seedGain`).connect(`seedGain`,`inA`).connect(`seedGain`,`inB`),this.addModulator(t),this.addControls(t),this.applyRouting(),this.applyFeedback()}loadPreset(e){let t={...br,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)t.id!==`ouro.kill`&&t.id!==`ouro.mod.trigger`&&(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}addChannel(e,t){let n=j(t);e.add(`in${n}`,`gain`,{gain:1}).add(`on${n}`,`gain`,{gain:1}).add(`g${n}`,`gain`,{gain:A}).add(`sg${n}`,`waveshaper`,{},{curve:`soft`}).add(`dly${n}`,`delay`,{delayTime:.38,maxTime:2}).add(`tone${n}`,`filter`,{frequency:4800,Q:.707,detune:0},{type:`lowpass`}).add(`crush${n}`,`waveshaper`,{bits:16},{curve:`crush`}).add(`filt${n}`,`filter`,{frequency:3e3,Q:1.2,detune:0},{type:`lowpass`}).add(`cdrive${n}`,`gain`,{gain:A}).add(`clip${n}`,`waveshaper`,{},{curve:`soft`}).add(`lvl${n}`,`gain`,{gain:1}).add(`send${n}`,`gain`,{gain:1}).add(`pan${n}`,`pan`,{pan:t===`a`?-1:1}).connect(`in${n}`,`on${n}`).connect(`on${n}`,`g${n}`).connect(`g${n}`,`sg${n}`).connect(`sg${n}`,`dly${n}`).connect(`dly${n}`,`tone${n}`).connect(`tone${n}`,`crush${n}`).connect(`crush${n}`,`filt${n}`).connect(`filt${n}`,`cdrive${n}`).connect(`cdrive${n}`,`clip${n}`).connect(`clip${n}`,`lvl${n}`).connect(`lvl${n}`,`send${n}`).connect(`send${n}`,`pan${n}`).connect(`pan${n}`,`wet`)}addModulator(e){e.add(`lfoOsc`,`oscillator`,{frequency:.8,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:.8}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfoGate`,`gain`,{gain:1}).add(`follow`,`waveshaper`,{},{curve:`abs`}).add(`followLp`,`filter`,{frequency:.8,Q:.707,detune:0},{type:`lowpass`}).add(`followGain`,`gain`,{gain:4}).add(`modTrig`,`trigger`,{peak:1,decay:.6,velSens:0}).add(`envGate`,`gain`,{gain:0}).add(`mod`,`gain`,{gain:1}).add(`modOut`,`gain`,{gain:.4}).connect(`lfoOsc`,`lfoOscOut`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoOscOut`,`lfoGate`).connect(`lfoRndOut`,`lfoGate`).connect(`inGain`,`follow`).connect(`follow`,`followLp`).connect(`followLp`,`followGain`).connect(`followGain`,`envGate`).connect(`modTrig`,`envGate`).connect(`lfoGate`,`mod`).connect(`envGate`,`mod`).connect(`mod`,`modOut`);for(let t of pr){let n=j(t);e.add(`mDly${n}`,`gain`,{gain:0}).add(`mCut${n}`,`gain`,{gain:0}).add(`mGain${n}`,`gain`,{gain:0}).connect(`modOut`,`mDly${n}`).connect(`mDly${n}`,`dly${n}`,`delayTime`).connect(`modOut`,`mCut${n}`).connect(`mCut${n}`,`filt${n}`,`detune`).connect(`modOut`,`mGain${n}`).connect(`mGain${n}`,`g${n}`,`gain`)}}addControls(e){let t=br,n=e=>t[e],r=(e,t,r,i,a,o,s)=>this.controlList.push(new D(e,t,r,i,n(e),a,o,s)),i=(e,n,r,i)=>this.controlList.push(new O(e,n,r,t[e],i));r(`ouro.input`,`Input`,0,2,``,t=>e.setParam(`inGain`,`gain`,t)),r(`ouro.mix`,`Mix`,0,1,``,t=>{e.setParam(`dry`,`gain`,Math.cos(t*Math.PI/2)),e.setParam(`wet`,`gain`,Math.sin(t*Math.PI/2))}),r(`ouro.output`,`Output`,0,1.5,``,t=>e.setParam(`out`,`gain`,t)),i(`ouro.routing`,`Routing`,lr,e=>{this.routing=e,this.applyRouting(),this.applyFeedback()}),this.controlList.push(new k(`ouro.kill`,`Kill`,!1,e=>{this.killed=e,this.applyFeedback()}),new k(`ouro.freeze`,`Freeze`,!1,e=>{this.frozen=e,this.applyFeedback()}));for(let t of pr){let n=j(t),a=e=>`ouro.${t}.${e}`;this.controlList.push(new k(a(`on`),`On`,!0,r=>{this.on[t]=r,e.setParam(`on${n}`,`gain`,+!!r),this.applyFeedback()})),r(a(`gain`),`Gain`,.05,8,`×`,t=>e.setParam(`g${n}`,`gain`,t*A),`log`),r(a(`delay`),`Delay`,10,1800,`ms`,t=>e.setParam(`dly${n}`,`delayTime`,t/1e3),`log`),r(a(`grit`),`Grit`,0,1,``,t=>e.setParam(`crush${n}`,`bits`,16-t*13)),r(a(`cutoff`),`Cutoff`,20,18e3,`Hz`,t=>e.setParam(`filt${n}`,`frequency`,t),`log`),r(a(`resonance`),`Resonance`,.1,30,``,t=>e.setParam(`filt${n}`,`Q`,t)),i(a(`filter`),`Filter`,fr,t=>e.setOption(`filt${n}`,`type`,t===`hp`?`highpass`:`lowpass`)),r(a(`clip`),`Clip`,0,1,``,r=>{let i=1+r*7;e.setParam(`cdrive${n}`,`gain`,A*i),this.clipDrive[t]=i,this.applyFeedback()}),r(a(`level`),`Level`,0,1.5,``,t=>e.setParam(`lvl${n}`,`gain`,t))}for(let[e,t]of[[`aa`,`A>A`],[`ab`,`A>B`],[`ba`,`B>A`],[`bb`,`B>B`]])r(`ouro.fb.${e}`,t,0,1.2,``,t=>{this.fb[e]=t,this.applyFeedback()});i(`ouro.mod.mode`,`Mode`,ur,t=>{e.setParam(`lfoGate`,`gain`,+(t===`lfo`)),e.setParam(`envGate`,`gain`,+(t===`env`))}),i(`ouro.mod.wave`,`Wave`,dr,t=>{e.setOption(`lfoOsc`,`waveform`,t===`sqr`?`square`:t===`ramp`?`sawtooth`:`triangle`),e.setParam(`lfoOscOut`,`gain`,t===`rnd`?0:1),e.setParam(`lfoRndOut`,`gain`,+(t===`rnd`))}),r(`ouro.mod.rate`,`Rate`,.05,30,`Hz`,t=>{this.modRate=t,e.setParam(`lfoOsc`,`frequency`,t),e.setParam(`lfoRnd`,`rate`,t),e.setParam(`followLp`,`frequency`,t),e.setParam(`modTrig`,`decay`,Math.min(4,1.5/t))},`log`),r(`ouro.mod.depth`,`Depth`,0,1,``,t=>e.setParam(`modOut`,`gain`,t)),this.controlList.push(new k(`ouro.mod.trigger`,`Trigger`,!1,t=>{t&&e.trigger(`modTrig`,1)}));for(let t of pr){let n=j(t),i=(t,i,a,o)=>r(`ouro.mod.${t}${n}`,i,-1,1,``,t=>e.setParam(`${a}${n}`,`gain`,t*o));i(`dly`,`Delay ${n}`,`mDly`,mr),i(`cut`,`Cutoff ${n}`,`mCut`,hr),i(`gain`,`Gain ${n}`,`mGain`,gr)}}applyRouting(){let e=this.circuit,t=this.routing===`series`,n=this.routing===`parallel`;e.setParam(`srcB`,`gain`,+!!n),e.setParam(`sendA`,`gain`,+!t),e.setParam(`panA`,`pan`,-1),e.setParam(`panB`,`pan`,+!t)}applyFeedback(){let e=this.circuit;for(let t of pr)for(let n of pr){let r=`${t}${n}`,i=this.fb[r]/this.clipDrive[t];this.frozen&&t===n&&(i=vr/this.clipDrive[t]),(this.killed||!this.on[t]||!this.on[n])&&(i=0),e.setParam(`fb${j(t)}${j(n)}`,`gain`,i)}let t=this.routing!==`parallel`;e.setParam(`linkAB`,`gain`,t?1/this.clipDrive.a:0);let n=this.routing===`pingpong`&&!this.killed&&this.on.a&&this.on.b;e.setParam(`bounceBA`,`gain`,n?_r/this.clipDrive.b:0),e.setParam(`srcGate`,`gain`,+!this.frozen)}},wr={"osc1.wave":`saw`,"osc1.octave":`16`,"osc1.pw":0,"osc1.glide":0,"osc1.level":.8,"osc2.wave":`saw`,"osc2.octave":`8`,"osc2.detune":0,"osc2.glide":0,"osc2.level":.6,tune:0,sync:0,"vib.rate":5,"vib.level":0,noise:0,"route.vco":`nor`,"route.vcf":`lpf`,"route.mod":`single`,"filter.cutoff":1800,"filter.res":.2,"filter.post":0,"mod1.rise":.01,"mod1.fall":.5,"mod1.hold":0,"mod1.lfo":0,"mod1.level":.3,"mod2.rise":.01,"mod2.fall":.5,"mod2.hold":0,"mod2.lfo":0,"mod2.level":0,"vca.rise":.005,"vca.fall":.4,"vca.hold":1,"vca.lfo":0,"vca.level":.8,"reverb.time":.1,"reverb.decay":.35,"reverb.mix":.15,"play.legato":0,"play.mode":`duo`,"play.channel":0},Tr=[`play.channel`],M=(e,t)=>({name:e,values:t}),Er=[M(`Init`,{}),M(`Fat Bass`,{"osc1.octave":`32`,"osc1.wave":`square`,"osc1.pw":.2,"osc2.octave":`16`,"osc2.detune":.1,"filter.cutoff":260,"filter.res":.35,"mod1.rise":.002,"mod1.fall":.35,"mod1.level":.55,"vca.fall":.2,"play.mode":`mono`}),M(`Hard Sync Lead`,{"osc1.octave":`16`,"osc2.octave":`8`,"osc2.detune":7,sync:1,"filter.cutoff":2600,"filter.res":.3,"mod2.level":.5,"route.mod":`dual`,"mod2.lfo":1,"mod2.rise":.35,"mod2.fall":.35,"vib.level":.3,"vib.rate":5.5,"osc1.glide":.15,"osc2.glide":.15}),M(`Dual Fifths`,{"osc1.octave":`16`,"osc2.octave":`16`,"osc2.detune":.01,"osc2.wave":`tri`,"filter.cutoff":1400,"mod1.level":.3,"mod1.fall":.8,"mod1.hold":1,"reverb.mix":.25,"reverb.decay":.5}),M(`Resonant Squelch`,{"osc1.octave":`16`,"osc1.wave":`square`,"osc2.level":.3,"filter.cutoff":200,"filter.res":.85,"mod1.rise":.002,"mod1.fall":.22,"mod1.level":.8,"vca.fall":.25,"play.mode":`mono`}),M(`Split Pad`,{"route.vco":`split`,"route.vcf":`even`,"route.mod":`split`,"osc1.octave":`16`,"osc2.octave":`8`,"osc2.wave":`tri`,"osc2.detune":.03,"filter.cutoff":700,"filter.post":1.2,"mod1.rise":.9,"mod1.fall":1.6,"mod1.hold":1,"mod1.level":.35,"mod2.rise":1.4,"mod2.fall":2,"mod2.hold":1,"mod2.level":.45,"vca.rise":.7,"vca.fall":1.6,"reverb.mix":.35,"reverb.decay":.6,"reverb.time":.3}),M(`Band Pass Voice`,{"route.vcf":`odd`,"route.vco":`half`,"osc1.octave":`16`,"osc2.octave":`8`,"osc2.detune":12,"filter.cutoff":900,"filter.res":.6,"filter.post":-.8,"mod1.rise":.1,"mod1.fall":.6,"mod1.level":.4}),M(`Wobble Bass`,{"osc1.octave":`32`,"osc2.octave":`16`,"osc2.detune":.08,"filter.cutoff":180,"filter.res":.6,"mod1.lfo":1,"mod1.rise":.18,"mod1.fall":.18,"mod1.level":.6,"play.mode":`mono`}),M(`Tremolo Organ`,{"osc1.wave":`square`,"osc1.octave":`16`,"osc2.wave":`tri`,"osc2.octave":`8`,"filter.cutoff":3500,"vca.lfo":1,"vca.hold":1,"vca.rise":.06,"vca.fall":.06,"vib.level":.1,"reverb.mix":.3}),M(`Noise Hat`,{"osc1.level":0,"osc2.level":0,noise:.9,"route.vcf":`hpf`,"filter.cutoff":7e3,"filter.res":.2,"vca.hold":0,"vca.rise":.001,"vca.fall":.09,"reverb.mix":.1}),M(`Ringing Filters`,{"route.vco":`vca`,"route.vcf":`even`,"osc1.level":.05,"osc2.level":0,"filter.cutoff":300,"filter.post":.6,"filter.res":1,"mod1.level":.2,"mod1.rise":.01,"mod1.fall":.6,"vca.rise":.01,"vca.fall":.5,"reverb.mix":.3}),M(`Infinite Cathedral`,{"osc1.octave":`8`,"osc2.octave":`8`,"osc2.wave":`tri`,"osc2.detune":.02,"filter.cutoff":2200,"mod1.level":.2,"vca.rise":.5,"vca.fall":2.5,"reverb.mix":.7,"reverb.decay":1,"reverb.time":.5}),M(`Pulse Sweep`,{"osc1.wave":`square`,"osc1.pw":.7,"osc1.octave":`16`,"osc2.octave":`16`,"filter.cutoff":500,"filter.res":.4,"mod1.rise":1.4,"mod1.fall":1.8,"mod1.hold":1,"mod1.level":.7,"vca.rise":.3}),M(`Glide Mono`,{"osc1.octave":`16`,"osc2.octave":`16`,"osc2.detune":.01,"osc1.glide":.35,"osc2.glide":.35,"filter.cutoff":1100,"filter.res":.45,"mod1.level":.4,"mod1.fall":.4,"play.mode":`mono`,"play.legato":1}),M(`Dual Detune Strings`,{"osc1.octave":`8`,"osc2.octave":`8`,"osc2.detune":.12,"filter.cutoff":1900,"mod1.level":.15,"vca.rise":.25,"vca.fall":.9,"vib.level":.15,"vib.rate":5.8,"reverb.mix":.3,"reverb.decay":.55}),M(`Hoover`,{"osc1.wave":`square`,"osc1.pw":.35,"osc1.octave":`16`,"osc2.wave":`saw`,"osc2.octave":`16`,"osc2.detune":0,tune:42,"osc1.glide":.45,"osc2.glide":.5,"osc1.level":.8,"osc2.level":.8,"filter.cutoff":2600,"filter.res":.45,"route.mod":`dual`,"mod1.level":.15,"mod1.fall":.6,"mod1.hold":1,"mod2.lfo":1,"mod2.rise":.4,"mod2.fall":.4,"mod2.level":.5,"vib.level":.3,"vib.rate":6.5,"vca.fall":.5,"reverb.mix":.3,"reverb.decay":.45,"reverb.time":.2,"play.legato":1}),M(`Filter Echo`,{"osc1.octave":`16`,"osc2.octave":`8`,"osc2.detune":12,"route.mod":`dual`,"filter.cutoff":800,"filter.res":.55,"mod2.lfo":1,"mod2.rise":.25,"mod2.fall":.4,"mod2.level":.5,"mod1.level":.4,"reverb.mix":.4,"reverb.decay":.75,"reverb.time":.4})],Dr=Array.from({length:24},(e,t)=>Er[t]??M(`Init`,{})),Or=1,kr=64,Ar={32:-24,16:-12,8:0},jr={16:-12,8:0,4:12},Mr=`o1Wave.o1Off.o1Pw.o1Lvl.o1Gld.o2Wave.o2Off.o2Dtn.o2Lvl.o2Gld.tune.sync.vibRate.vibLvl.noise.vcoRoute.vcfRoute.modRoute.cutoff.res.post.m1Rise.m1Fall.m1Hold.m1Lfo.m1Lvl.m2Rise.m2Fall.m2Hold.m2Lfo.m2Lvl.vcaRise.vcaFall.vcaHold.vcaLfo.level.rvTime.rvDecay.rvMix.bend.modw`.split(`.`),Nr=class extends E{name;bendRange=3;slots=[...Dr];currentSlot=0;currentPreset=this.slots[0];held=[];latched=new Set;pedal=!1;bend=0;modWheelValue=0;gate=!1;lastChannel=1;lockedChannel;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`MOA-DUO`){super(),this.name=e;let t=this.circuit;t.add(`synth`,`duo`,Object.fromEntries(Mr.map(e=>[e,0]))).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`synth`,`meterL`).connect(`synth`,`meterR`),this.outputList.push({name:`out`,nodeId:`synth`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=wr,r=e=>n=>t.setParam(`synth`,e,n),i=(e,t,i,a,o,s,c)=>this.controlList.push(new D(e,t,i,a,n[e],o,r(s),c)),a=(e,t,i,a,o)=>this.controlList.push(new O(e,t,i,n[e],e=>r(a)(o?o(e):i.indexOf(e)))),o=(e,t,i)=>this.controlList.push(new k(e,t,n[e]>0,e=>r(i)(+!!e)));a(`osc1.wave`,`Wave`,[`saw`,`square`],`o1Wave`),a(`osc1.octave`,`Octave`,[`32`,`16`,`8`],`o1Off`,e=>Ar[e]),i(`osc1.pw`,`Pulse width`,0,1,``,`o1Pw`),i(`osc1.glide`,`Glide`,0,1,``,`o1Gld`),i(`osc1.level`,`Level`,0,1,``,`o1Lvl`),a(`osc2.wave`,`Wave`,[`saw`,`tri`],`o2Wave`),a(`osc2.octave`,`Octave`,[`16`,`8`,`4`],`o2Off`,e=>jr[e]),i(`osc2.detune`,`Detune`,0,24,`st`,`o2Dtn`),i(`osc2.glide`,`Glide`,0,1,``,`o2Gld`),i(`osc2.level`,`Level`,0,1,``,`o2Lvl`),i(`tune`,`Tune`,-100,100,`ct`,`tune`),o(`sync`,`Sync`,`sync`),i(`vib.rate`,`Vibrato rate`,.1,20,`Hz`,`vibRate`,`log`),i(`vib.level`,`Vibrato level`,0,1,``,`vibLvl`),i(`noise`,`Noise`,0,1,``,`noise`),a(`route.vco`,`VCO routing`,[`nor`,`split`,`half`,`vca`],`vcoRoute`),a(`route.vcf`,`VCF routing`,[`lpf`,`hpf`,`even`,`odd`],`vcfRoute`),a(`route.mod`,`Mod routing`,[`single`,`dual`,`split`,`odd`],`modRoute`),i(`filter.cutoff`,`Cutoff`,20,2e4,`Hz`,`cutoff`,`log`),i(`filter.res`,`Resonance`,0,1,``,`res`),i(`filter.post`,`Post`,-4,4,`oct`,`post`);for(let[e,t]of[[`1`,`m1`],[`2`,`m2`],[`vca`,`vca`]]){let n=e===`vca`?`vca`:`mod${e}`;i(`${n}.rise`,`Rise`,.001,5,`s`,`${t}Rise`,`log`),i(`${n}.fall`,`Fall`,.01,15,`s`,`${t}Fall`,`log`),o(`${n}.hold`,`Hold`,`${t}Hold`),o(`${n}.lfo`,`LFO`,`${t}Lfo`),e!==`vca`&&i(`${n}.level`,`Level`,0,1,``,`${t}Lvl`)}i(`vca.level`,`Level`,0,1.5,``,`level`),i(`reverb.time`,`Time`,0,1,``,`rvTime`),i(`reverb.decay`,`Decay`,0,1,``,`rvDecay`),i(`reverb.mix`,`Mix`,0,1,``,`rvMix`),this.controlList.push(new k(`play.legato`,`Legato`,n[`play.legato`]>0,()=>void 0),new O(`play.mode`,`Mode`,[`mono`,`duo`],n[`play.mode`],()=>void 0),new k(`play.channel`,`Channel lock`,!1,()=>void 0))}keyDown(e){let t=this.held.length===0;this.held=this.held.filter(t=>t!==e),this.held.push(e),this.latched.delete(e),this.sendNotes(t||!this.legato),this.notifyNotes()}keyUp(e){this.held.includes(e)&&(this.pedal?this.latched.add(e):this.release(e))}release(e){this.held=this.held.filter(t=>t!==e),this.latched.delete(e),this.sendNotes(!1),this.notifyNotes()}releaseLatched(){for(let e of[...this.latched])this.release(e)}get legato(){return this.control(`play.legato`).value}assign(){let e=this.held;if(e.length===0)return;let t=e[e.length-1];if(this.control(`play.mode`).value===`mono`||e.length===1)return{n1:t,n2:t};let n=Math.min(...e),r=Math.max(...e);return e.length===2?{n1:n,n2:r}:{n1:n,n2:t>n?t:r}}sendNotes(e){let t=this.assign();t?(this.gate=!0,this.circuit.play(`synth`,t.n1,t.n2,!0,e)):this.gate&&(this.gate=!1,this.circuit.play(`synth`,this.lastN1,this.lastN2,!1,!1)),t&&(this.lastN1=t.n1,this.lastN2=t.n2)}lastN1=60;lastN2=60;get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`synth`,`bend`,this.bend*3),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`synth`,`modw`,this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(`channel`in e){if(!this.control(`play.channel`).value)this.lastChannel=e.channel,this.lockedChannel=void 0;else if(this.lockedChannel??=this.lastChannel,e.channel!==this.lockedChannel)return;switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===Or?this.setModWheel(e.value/127):e.controller===kr&&(this.pedal=e.value>=64,this.pedal||this.releaseLatched());break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.currentPreset=t,this.applyValues({...wr,...t.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){if(Tr.includes(t))continue;let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)Tr.includes(t.id)||(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyPreset(){for(let e of this.presetListeners)e()}},Pr=.12,Fr=24,Ir=384,Lr=16,Rr=[[`×4`,6],[`×3`,8],[`×2`,12],[`×1½`,16],[`×1`,24],[`×¾`,32],[`×½`,48],[`×¼`,96]],zr=()=>({notes:[],vel:.8,gate:.5,prob:1,micro:0,mod:0,locks:{}}),Br=()=>({steps:Array.from({length:64},zr),length:16,clock:Fr,direction:`fwd`,prob:1,muted:!1,solo:!1}),Vr=()=>({length:64,tracks:Array.from({length:16},Br)});function Hr(e,t,n,r){if(e===`fwd`)return n%t;if(e===`rev`)return t-1-n%t;if(e===`random`)return Math.floor(r()*t);if(t<2)return 0;let i=n%(2*t-2);return i<t?i:2*t-2-i}var Ur=e=>({next:e,k:0,locked:!1,mod:0,touched:!1,offs:[],sent:[],played:[]}),Wr=class{out;random;patterns=Array.from({length:16},Vr);current=0;chain=[];next;tempo=120;shuffle=0;skip=new Set;playing=!1;t0=0;base=0;tempoUsed=120;scheduled=0;sentTick=0;patternStart=0;chainPos=0;runs=[];listeners=new Set;constructor(e,t=Math.random){this.out=e,this.random=t}get pattern(){return this.patterns[this.current]}get isPlaying(){return this.playing}get secondsPerTick(){return 60/(this.tempoUsed*96)}tickAt(e){return this.base+(e-this.t0)/this.secondsPerTick}timeAt(e){return this.t0+(e-this.base)*this.secondsPerTick}play(e){this.playing||(this.chain.length?(this.chainPos=0,this.current=this.chain[0]):this.next!==void 0&&(this.current=this.next),this.next=void 0,this.tempoUsed=this.tempo,this.t0=e+.05,this.base=0,this.scheduled=0,this.sentTick=0,this.patternStart=0,this.runs=Array.from({length:16},()=>Ur(0)),this.skip.clear(),this.playing=!0,this.notify())}stop(e){this.playing&&(this.playing=!1,this.out.flush(),this.runs.forEach((t,n)=>{let r=new Set([...t.offs.map(e=>e.note),...t.sent.filter(t=>t.time>e).map(e=>e.note)]);for(let e of r)this.out.off(n,e);t.touched&&(this.out.locks(n,{}),this.out.mod(n,0))}),this.runs=[],this.notify())}queue(e){this.chain=[],this.playing?this.next=e:this.current=e,this.notify()}setChain(e){this.chain=e.filter(e=>e>=0&&e<16),this.chainPos=this.chain.indexOf(this.current),!this.playing&&this.chain.length&&(this.current=this.chain[0]),this.notify()}stepAt(e,t){let n=this.runs[e]?.played??[];for(let e=n.length-1;e>=0;e--)if(n[e].time<=t)return n[e].step;return-1}stepNear(e,t){let n=this.runs[e];if(!this.playing||!n)return;let r=this.pattern.tracks[e],i=this.tickAt(t),a=Math.max(0,Math.round((i-this.trackStart(e))/r.clock));return{step:r.direction===`random`?a%r.length:Hr(r.direction,r.length,a,this.random),tick:this.trackStart(e)+a*r.clock}}recorded(e,t,n){n>=this.scheduled&&this.skip.add(`${e}:${t}`)}trackStart(e){let t=this.runs[e];return t.next-t.k*this.pattern.tracks[e].clock}schedule(e){if(!this.playing)return;if(this.tempo!==this.tempoUsed){let e=Math.max(this.scheduled,this.sentTick);this.t0=this.timeAt(e),this.base=e,this.tempoUsed=this.tempo}let t=this.tickAt(e+Pr);for(;this.scheduled<t;){let e=this.boundary(),n=Math.min(t,e);this.runTracks(n,e),this.scheduled=n,n===e&&this.turn(e)}for(let t of this.runs)t.sent=t.sent.filter(t=>t.time>e-.5)}boundary(){let e=this.pattern.length*Fr;return e>0?this.patternStart+e*(Math.floor((this.scheduled-this.patternStart)/e)+1):this.next!==void 0||this.chain.length>1?(Math.floor(this.scheduled/Ir)+1)*Ir:1/0}turn(e){let t=this.pattern.length*Fr,n=!1;if(this.chain.length?(this.chainPos=(this.chainPos+1)%this.chain.length,n=this.chain[this.chainPos]!==this.current,this.current=this.chain[this.chainPos]):this.next!==void 0&&(n=this.next!==this.current,this.current=this.next,this.next=void 0),n||t!==0){this.patternStart=e;for(let t of this.runs)t.next=e,t.k=0;this.skip.clear(),this.notify()}}runTracks(e,t){let n=this.pattern,r=n.tracks.some(e=>e.solo);n.tracks.forEach((n,i)=>{let a=this.runs[i];for(;a.next<t&&a.next-n.clock/2<e;){this.flushOffs(i,a,a.next);let e=Hr(n.direction,n.length,a.k,this.random),t=n.steps[e],o=(n.clock===Fr||n.clock===2*Fr)&&a.k%2==1?this.shuffle*n.clock:0,s=a.next+o+t.micro*n.clock;this.sentTick=Math.max(this.sentTick,a.next,s);let c=this.timeAt(Math.max(this.scheduled,s)),l=Object.keys(t.locks);if((l.length||a.locked)&&(this.out.locks(i,t.locks,this.timeAt(a.next)),a.locked=l.length>0,a.touched=!0),t.mod!==a.mod&&(this.out.mod(i,t.mod,this.timeAt(a.next)),a.mod=t.mod,a.touched=!0),!n.muted&&(!r||n.solo)&&!this.skip.delete(`${i}:${e}`)&&t.notes.length&&this.random()<t.prob*n.prob){let e=s+Math.max(1,Math.min(Lr,t.gate)*n.clock-1);for(let n of t.notes){let r=a.offs.findIndex(e=>e.note===n);r>=0&&(a.offs.splice(r,1),this.sendOff(i,a,n,c)),this.out.on(i,n,t.vels?.[n]??t.vel,c),a.offs.push({tick:e,note:n})}}a.played.push({step:e,time:this.timeAt(a.next)}),a.played.length>8&&a.played.shift(),a.next+=n.clock,a.k++}this.flushOffs(i,a,e)})}flushOffs(e,t,n){t.offs=t.offs.filter(r=>r.tick>=n||(this.sendOff(e,t,r.note,this.timeAt(r.tick)),!1))}sendOff(e,t,n,r){this.out.off(e,n,r),t.sent.push({note:n,time:r})}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}notify(){for(let e of this.listeners)e()}},Gr=4e4,Kr=2047,qr=Math.log1p(68);function Jr(e){let t=Math.round(Math.log1p(68*Math.min(1,Math.abs(e)))/qr*Kr)/Kr,n=Math.expm1(t*qr)/68;return e<0?-n:n}var Yr=16,Xr=256,Zr=8.6;function Qr(e){let t=1,n=1;for(let r=1;r<40&&(n*=(e/(2*r))**2,t+=n,!(n<t*1e-12));r++);return t}function $r(e,t,n){if(t===n)return e.slice();let r=n/t,i=.9*Math.min(1,r),a=Math.ceil(Yr/i),o=2*a,s=new Float64Array(257*o),c=Qr(Zr);for(let e=0;e<=Xr;e++)for(let t=0;t<o;t++){let n=t-a+1-e/Xr,r=n/a,l=Math.abs(r)>=1?0:Qr(Zr*Math.sqrt(1-r*r))/c,u=Math.PI*i*n;s[e*o+t]=i*(u===0?1:Math.sin(u)/u)*l}let l=Math.floor(e.length*r),u=new Float32Array(l);for(let t=0;t<l;t++){let n=t/r,i=Math.floor(n),c=(n-i)*Xr,l=Math.floor(c),d=c-l,f=l*o,p=f+o,m=0;for(let t=0;t<o;t++){let n=i-a+1+t;n<0||n>=e.length||(m+=e[n]*(s[f+t]+d*(s[p+t]-s[f+t])))}u[t]=m}return u}function ei(e,t){return{rate:Gr,channels:e.map(e=>{let n=$r(e,t,Gr);for(let e=0;e<n.length;e++)n[e]=Jr(n[e]);return n})}}var ti=[`A`,`B`,`C`,`D`],N=ti.length*16,ni=()=>({start:0,end:0,tune:0,level:.8,pan:0,attack:0,decay:8,mode:`oneshot`,reverse:!1,loop:!1,group:0,velLevel:1,cutoff:2e4,reso:0,velFilter:0}),ri=e=>`${ti[Math.floor(e/16)]}${String(e%16+1).padStart(2,`0`)}`,ii=e=>ti.indexOf(e[0])*16+Number(e.slice(1))-1,ai=Array.from({length:N},(e,t)=>ri(t)),oi=[`MOA Drums 60`,`Gaute Breaks`],si=0,ci=()=>`s${Date.now().toString(36)}${(si++).toString(36)}`,li=class extends E{name;transport;sounds=new Map;pads=Array.from({length:N},ni);programName=`New kit`;slots=oi.map(e=>({name:e,load:async()=>({sounds:[],program:{name:e,pads:[]}})}));bank=0;hitListeners=new Set;changeListeners=new Set;loading;built=this.circuit.add(`voices`,`sampler`,{level:.8}).add(`out`,`gain`,{gain:1}).add(`meter`,`meter`,{},{channel:`mono`}).connect(`voices`,`out`).connect(`out`,`meter`);level=this.num(`mpc.level`,`Level`,0,1.5,.8,``,e=>this.circuit.setParam(`voices`,`level`,e));character=this.choice(`mpc.character`,`New sounds`,[`MPC60`,`Clean`],`MPC60`,()=>{});selected=this.choice(`pad.select`,`Pad`,ai,`A01`,()=>this.showPad());levels=this.choice(`levels.mode`,`16 Levels`,[`off`,`tune`,`velocity`,`decay`,`filter`],`off`,()=>this.notifyChange());padControls={tune:this.num(`pad.tune`,`Tune`,-36,36,0,`st`,e=>this.editPad({tune:e})),level:this.num(`pad.level`,`Level`,0,1.5,.8,``,e=>this.editPad({level:e})),pan:this.num(`pad.pan`,`Pan`,-1,1,0,``,e=>this.editPad({pan:e})),attack:this.num(`pad.attack`,`Attack`,0,2,0,`s`,e=>this.editPad({attack:e})),decay:this.num(`pad.decay`,`Decay`,.01,8,8,`s`,e=>this.editPad({decay:e}),`log`),mode:this.choice(`pad.mode`,`Mode`,[`oneshot`,`noteon`],`oneshot`,e=>this.editPad({mode:e})),reverse:this.toggle(`pad.reverse`,`Reverse`,!1,e=>this.editPad({reverse:e})),loop:this.toggle(`pad.loop`,`Loop`,!1,e=>this.editPad({loop:e})),group:this.choice(`pad.group`,`Mute group`,[`off`,`1`,`2`,`3`,`4`,`5`,`6`,`7`,`8`],`off`,e=>this.editPad({group:e===`off`?0:Number(e)})),velLevel:this.num(`pad.velocity`,`Velocity`,0,1,1,``,e=>this.editPad({velLevel:e})),cutoff:this.num(`pad.cutoff`,`Filter`,40,2e4,2e4,`Hz`,e=>this.editPad({cutoff:e}),`log`),reso:this.num(`pad.reso`,`Resonance`,0,1,0,``,e=>this.editPad({reso:e})),velFilter:this.num(`pad.velFilter`,`Vel > filter`,0,1,0,``,e=>this.editPad({velFilter:e}))};showing=!1;constructor(e,t=`MOA-60`){super(),this.name=t,this.transport=new An(e),this.transport.channel.set(`11`),this.controlList.push(this.transport.channel),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out`,nodeId:`meter`}),this.circuit.onReady(e=>{e===`voices`&&this.sendAll()})}get selectedPad(){return ii(this.selected.value)}padMessage(e){let t=this.pads[e],n=t.sound?this.sounds.get(t.sound):void 0,r=n?.rate??1;return{type:`pad`,pad:e,settings:{...t,sample:n?t.sound:void 0,start:t.start*r,end:t.end>t.start?t.end*r:0}}}sendPad(e){this.circuit.send(`voices`,this.padMessage(e))}sendSound(e){this.circuit.send(`voices`,{type:`sample`,id:e.id,rate:e.rate,channels:e.channels})}sendAll(){for(let e of this.sounds.values())this.sendSound(e);for(let e=0;e<N;e++)this.sendPad(e)}addSound(e,t,n,r=this.character.value,i=ci()){let a={rate:t,channels:n},o=r===`MPC60`?ei(n,t):a,s={id:i,name:e,character:r,source:a,rate:o.rate,channels:o.channels};this.sounds.set(i,s),this.sendSound(s);for(let e=0;e<N;e++)this.pads[e].sound===i&&this.sendPad(e);return this.notifyChange(),s}setCharacter(e,t){let n=this.sounds.get(e);if(!n||n.character===t)return;let r=t===`MPC60`?ei(n.source.channels,n.source.rate):n.source;Object.assign(n,{character:t,rate:r.rate,channels:r.channels}),this.sendSound(n);for(let t=0;t<N;t++)this.pads[t].sound===e&&this.sendPad(t);this.notifyChange()}removeSound(e){if(this.sounds.delete(e)){this.circuit.send(`voices`,{type:`drop`,id:e});for(let t=0;t<N;t++)this.pads[t].sound===e&&this.setPad(t,{sound:void 0});this.notifyChange()}}duration(e){let t=this.sounds.get(e);return t?t.source.channels[0].length/t.source.rate:0}setPad(e,t){Object.assign(this.pads[e],t),this.sendPad(e),e===this.selectedPad&&this.showPad(),this.notifyChange()}assign(e,t,n=0,r=0){this.setPad(e,{sound:t,start:n,end:r})}editPad(e){this.showing||(Object.assign(this.pads[this.selectedPad],e),this.sendPad(this.selectedPad),this.notifyChange())}showPad(){if(!this.padControls)return;let e=this.pads[this.selectedPad];this.showing=!0;let t=this.padControls;t.tune.set(e.tune),t.level.set(e.level),t.pan.set(e.pan),t.attack.set(e.attack),t.decay.set(e.decay),t.mode.set(e.mode),t.reverse.set(e.reverse),t.loop.set(e.loop),t.group.set(e.group?String(e.group):`off`),t.velLevel.set(e.velLevel),t.cutoff.set(e.cutoff),t.reso.set(e.reso),t.velFilter.set(e.velFilter),this.showing=!1,this.notifyChange()}hit(e,t=1,n,r){if(!(e<0||e>=N||t<=0)){this.circuit.send(`voices`,{type:`hit`,pad:e,velocity:t,when:n,over:r});for(let r of this.hitListeners)r({pad:e,velocity:t,when:n})}}release(e,t){this.circuit.send(`voices`,{type:`release`,pad:e,when:t})}stopAll(){this.circuit.send(`voices`,{type:`stopAll`})}padFor(e,t=1){let n=this.levels.value;if(n===`off`)return{pad:this.bank*16+e,velocity:t};let r=this.selectedPad,i=this.pads[r],a=e/15;return n===`tune`?{pad:r,velocity:t,over:{tune:i.tune+e-8}}:n===`velocity`?{pad:r,velocity:(e+1)/16}:n===`decay`?{pad:r,velocity:t,over:{decay:.03*(8/.03)**a,mode:`oneshot`}}:{pad:r,velocity:t,over:{cutoff:100*200**a}}}press(e,t=1,n){let r=this.padFor(e,t);return this.hit(r.pad,r.velocity,n,r.over),r}unpress(e,t){this.release(this.levels.value===`off`?this.bank*16+e:this.selectedPad,t)}handleMidi(e,t){if(e.type!==`noteOn`&&e.type!==`noteOff`||!this.transport.acceptsChannel(e.channel))return;let n=e.note-36;n<0||n>=N||(e.type===`noteOn`&&e.velocity>0?this.hit(n,e.velocity/127,t):this.release(n,t))}program(){return{name:this.programName,pads:this.pads.map(e=>({...e}))}}loadProgram(e){this.programName=e.name;for(let t=0;t<N;t++)Object.assign(this.pads[t],ni(),{sound:void 0},e.pads[t]??{}),this.sendPad(t);this.showPad()}loadSlot(e){let t=this.slots[e];return t?(this.loading=t.load().then(({sounds:e,program:t})=>{for(let t of e)this.addSound(t.name,t.rate,t.channels,t.character??`MPC60`,t.id);this.loadProgram(t)}),this.loading):Promise.resolve()}ready(){return this.loading??Promise.resolve()}onHit(e){return this.hitListeners.add(e),()=>this.hitListeners.delete(e)}onChange(e){return this.changeListeners.add(e),()=>this.changeListeners.delete(e)}notifyChange(){for(let e of this.changeListeners)e()}num(...e){let t=new D(...e);return this.controlList.push(t),t}choice(...e){let t=new O(...e);return this.controlList.push(t),t}toggle(...e){let t=new k(...e);return this.controlList.push(t),t}},ui=[0,11,2,4,1,3,14,5,7,9,6,8,10,13,15,12],di=(e=`kick`,t={})=>({name:fi[e],src:`analog`,voice:e,analog:{},sound:``,start:0,end:0,tune:0,decay:8,level:.8,pan:0,cutoff:2e4,reso:0,group:0,reverse:!1,...t}),fi={kick:`BD`,snare:`SD`,clap:`CP`,closedHat:`CH`,openHat:`OH`,ride:`RD`,rim:`RS`,lowTom:`LT`,midTom:`MT`,highTom:`HT`,cowbell:`CB`,crash:`CR`};function pi(e){if(e.src===`sample`)return e.sound;let t=Object.keys(e.analog).sort().map(t=>`${t}=${+e.analog[t].toFixed(4)}`);return`dr:${e.voice}:${t.join(`,`)}`}var P=(e,t={})=>di(e,t),mi=`MOA Drums 60/f.break`,hi=60/92/4,gi=e=>e*hi+(e%2==1?(1.16-1)*hi:0),_i=(e,t,n,r={})=>di(`kick`,{name:e,src:`sample`,sound:mi,start:gi(t),end:gi(n),group:3,...r}),vi=[{name:`Analogue 909`,pads:[P(`kick`),P(`rim`),P(`snare`),P(`clap`),P(`snare`,{name:`SD2`,analog:{"snare.tune":260,"snare.decay":.12,"snare.snap":1}}),P(`lowTom`),P(`closedHat`,{group:1}),P(`midTom`),P(`closedHat`,{name:`PH`,group:1,analog:{"closedHat.decay":.08}}),P(`highTom`),P(`openHat`,{group:1}),P(`kick`,{name:`BD2`,analog:{"kick.tune":40,"kick.decay":.9,"kick.click":.15}}),P(`cowbell`),P(`crash`),P(`clap`,{name:`CP2`,analog:{"clap.spread":1,"clap.decay":.45}}),P(`ride`)]},{name:`Dub Mix`,pads:[P(`kick`,{analog:{"kick.tune":44,"kick.decay":.7,"kick.click":.2}}),P(`rim`,{analog:{"rim.tone":1100}}),P(`snare`,{analog:{"snare.decay":.3,"snare.snap":.45}}),P(`clap`,{analog:{"clap.tone":900}}),_i(`KB`,0,2),_i(`SB`,4,6),P(`closedHat`,{group:1}),_i(`GH`,7,8,{level:1}),P(`closedHat`,{name:`PH`,group:1,analog:{"closedHat.decay":.09}}),_i(`HB`,2,3),P(`openHat`,{group:1,analog:{"openHat.decay":.6}}),_i(`SR`,12,14,{reverse:!0}),P(`cowbell`,{analog:{"cowbell.tone":1800}}),P(`crash`),di(`kick`,{name:`BRK`,src:`sample`,sound:mi,group:3}),P(`ride`)]}],yi=e=>JSON.parse(JSON.stringify(e)),bi=e=>yi(e);new Map(Re.map(e=>[e.id,e])),new Map(Xe.map(e=>[e.id,e])),new Set(Ze),new Set(Qe.map(e=>e[0])),new Set(Rr.map(e=>e[1]));var F=(e,t=[])=>({params:e,matrix:t}),xi=[{name:`Init`,a:F({})},{name:`Acid Line`,a:F({"voice.mode":2,"voice.glide":.06,"lad.cutoff":300,"lad.res":.75,"lad.eg1":.45,drive:.35,"eg1.d":.25,"eg1.s":0,"eg2.a":.002,"eg2.d":.3,"eg2.s":.8,"eg2.r":.08,"filter.key":.3},[{source:`vel`,dest:`lad.cutoff`,amount:.15}])},{name:`Sub Bass`,a:F({"voice.mode":1,"osc1.blend":1,"osc1.sub":1,"mix.osc1":.8,"osc2.oct":1,"mix.osc2":.3,"lad.cutoff":400,"lad.res":.2,"lad.eg1":.2,"eg1.d":.2,"eg2.r":.1})},{name:`Glass Pad`,a:F({"mix.osc1":.3,"osc1.width":1,"mix.osc3":.7,"osc3.table":0,"osc3.pos":.2,"lad.cutoff":3500,"lad.res":.2,"lad.eg1":.1,"filter.route":2,"sem.cutoff":1200,"sem.res":.5,"sem.bp":1,"eg1.a":1.5,"eg1.d":3,"eg1.s":.5,"eg1.r":2,"eg2.a":1.2,"eg2.d":2,"eg2.s":.8,"eg2.r":2.5,"lfo1.rate":.15,"voice.unison":1,"voice.detune":.25,"panner.mode":1},[{source:`lfo1`,dest:`osc3.pos`,amount:.3}])},{name:`Vox Table`,a:F({"mix.osc1":0,"mix.osc3":1,"osc3.table":4,"osc3.pos":.5,"lad.cutoff":6e3,"lad.eg1":0,"eg2.a":.15,"eg2.s":1,"eg2.r":.6,"lfo1.rate":.3,"lfo2.rate":5,"lfo2.shape":0,"lfo2.level":0,"mod.time":1.5},[{source:`lfo1`,dest:`osc3.pos`,amount:.5},{source:`lfo2`,dest:`osc3.tune`,amount:.003},{source:`time`,dest:`lfo2.level`,amount:1}])},{name:`Choir`,a:F({"mix.osc1":0,"mix.osc3":1,"osc3.table":5,"osc3.pos":.3,"lad.cutoff":5e3,"lad.eg1":0,"eg2.a":.8,"eg2.s":1,"eg2.r":1.5,"lfo1.rate":.07,"voice.unison":2,"voice.detune":.5,"panner.mode":1},[{source:`lfo1`,dest:`osc3.pos`,amount:.4}])},{name:`Sync Lead`,a:F({"voice.mode":2,"voice.glide":.03,"mix.osc1":.3,"mix.osc2":1,"osc2.sync":1,"lad.cutoff":5e3,"lad.res":.3,"lad.eg1":.1,"eg1.d":.4,"eg1.s":.2,"eg2.r":.2,"lfo2.rate":5.5,"lfo2.shape":0,"lfo2.level":0},[{source:`eg1`,dest:`osc2.tune`,amount:.25},{source:`mod`,dest:`lfo2.level`,amount:1},{source:`lfo2`,dest:`osc1.tune`,amount:.004},{source:`lfo2`,dest:`osc2.tune`,amount:.004}])},{name:`Dub Chord`,a:F({"mix.osc1":.7,"mix.osc2":.7,"osc2.tune":.08,"lad.cutoff":4e3,"lad.eg1":0,"filter.route":1,"sem.cutoff":900,"sem.res":.6,"sem.bp":1,"sem.eg1":.15,"eg1.d":.2,"eg2.a":.002,"eg2.d":.25,"eg2.s":0,"eg2.r":.2})},{name:`Digi Keys`,a:F({"mix.osc1":0,"mix.osc3":1,"osc3.table":2,"osc3.pos":.6,"osc3.interp":0,"lad.cutoff":8e3,"lad.eg1":0,"eg1.d":.6,"eg2.d":1.2,"eg2.s":.3,"eg2.r":.5},[{source:`eg1`,dest:`osc3.pos`,amount:-.5}])},{name:`Morph Pad`,a:F({"mix.osc1":.8,"lad.cutoff":800,"lad.eg1":.1,"eg2.a":.6,"eg2.r":1.5,"voice.unison":1,"voice.detune":.3},[{source:`mod`,dest:`out.morph`,amount:1}]),b:F({"mix.osc1":.2,"mix.osc3":.8,"osc3.table":1,"osc3.pos":.7,"lad.cutoff":6e3,"lad.res":.3,"lad.eg1":.1,"eg2.a":.6,"eg2.r":1.5,"voice.unison":1,"voice.detune":.3},[{source:`mod`,dest:`out.morph`,amount:1}])},{name:`XOR Bell`,a:F({"mix.osc1":.2,"mix.noise":.6,"noise.type":2,"osc2.tune":7,"lad.cutoff":6e3,"lad.eg1":0,"eg2.d":1.5,"eg2.s":0,"eg2.r":1})},{name:`Wave FM`,a:F({"osc1.width":1,"osc3.oct":3,"osc3.table":0,"mix.osc3":0,"lad.cutoff":9e3,"lad.eg1":0,"eg2.d":2,"eg2.s":0,"eg2.r":1.5},[{source:`wave`,dest:`osc1.tune`,amount:.08}])},{name:`Drone`,a:F({"voice.mode":1,"eg2.drone":1,"mix.osc1":.6,"mix.osc2":.6,"osc2.tune":-.1,"osc2.oct":1,"lad.cutoff":600,"lad.res":.6,"lad.eg1":0,"lfo1.rate":.05,"lfo1.shape":0},[{source:`lfo1`,dest:`lad.cutoff`,amount:.3}])},{name:`Techno Bass`,a:F({"voice.mode":1,"osc1.oct":1,"osc1.blend":.25,"osc1.sub":1,"mix.osc1":1,drive:.7,overdrive:1,"lad.cutoff":90,"lad.res":.35,"lad.eg1":.42,"filter.key":.3,"eg1.a":.001,"eg1.d":.09,"eg1.s":0,"eg1.reset":1,"eg2.a":.001,"eg2.d":.18,"eg2.s":0,"eg2.r":.05,"eg2.reset":1},[{source:`vel`,dest:`lad.cutoff`,amount:.12}])},{name:`Metal Hit`,a:F({"mix.osc1":0,"mix.noise":1,"noise.type":2,"osc1.width":.3,"osc2.oct":3,"osc2.tune":5.6,"osc2.width":.55,drive:.4,"lad.cutoff":14e3,"lad.eg1":0,"filter.route":1,"sem.bp":1,"sem.cutoff":3200,"sem.res":.55,"sem.eg1":.1,"eg1.d":.05,"eg2.a":.001,"eg2.d":.11,"eg2.s":0,"eg2.r":.08},[{source:`rand`,dest:`sem.cutoff`,amount:.08}])},{name:`Techno Stab`,a:F({"osc3.mode":1,"osc3.model":6,"osc3.harm":.41,"osc3.timbre":.55,"osc3.morph":.1,"mix.osc1":0,"mix.osc3":1,drive:.7,overdrive:1,"lad.cutoff":900,"lad.res":.2,"lad.eg1":.3,"filter.route":1,"sem.mode":1,"sem.cutoff":250,"sem.res":.2,"eg1.d":.12,"eg2.a":.001,"eg2.d":.14,"eg2.s":0,"eg2.r":.12})},{name:`Noise Sweep`,a:F({"mix.osc1":0,"mix.noise":1,drive:.3,"lad.cutoff":200,"lad.res":.55,"lad.eg1":0,"filter.key":0,"eg2.a":.5,"eg2.s":1,"eg2.r":.8},[{source:`seq`,dest:`lad.cutoff`,amount:.85},{source:`mod`,dest:`lad.cutoff`,amount:.85}])},{name:`Bubbly Bass`,a:F({"voice.mode":2,"voice.glide":.03,"osc1.blend":.3,"osc1.sub":1,"mix.osc1":1,drive:.5,"lad.cutoff":180,"lad.res":.72,"lad.eg1":.38,"filter.key":.5,"eg1.a":.001,"eg1.d":.11,"eg1.s":0,"eg1.reset":1,"eg2.a":.001,"eg2.d":.16,"eg2.s":.25,"eg2.r":.05},[{source:`vel`,dest:`lad.cutoff`,amount:.2}])},{name:`Table Poly`,a:F({"mix.osc1":.84,"osc1.width":.22,"osc1.blend":.06,"mix.osc2":.37,"osc2.oct":1,"osc2.blend":.55,"osc2.width":.66,"mix.osc3":.8,"osc3.table":0,"osc3.pos":.25,"mix.noise":.18,"noise.type":1,drive:.74,overdrive:1,"lad.cutoff":140,"lad.res":.33,"lad.eg1":.59,"filter.key":.4,"eg1.a":.002,"eg1.d":.06,"eg1.s":0,"eg1.r":.15,"eg2.a":.002,"eg2.d":.15,"eg2.s":0,"eg2.r":.1,"lfo1.rate":.11,"lfo1.retrig":2,"voice.unison":1,"voice.detune":.2,"panner.mode":1,"panner.width":.8,"filter.route":1,"sem.bp":1,"sem.mode":1,"sem.cutoff":940,"sem.res":0,"lfo2.rate":.23,"lfo2.retrig":2},[{source:`lfo2`,dest:`sem.cutoff`,amount:.08},{source:`seq`,dest:`sem.cutoff`,amount:-.05},{source:`seq`,dest:`eg1.d`,amount:.45},{source:`seq`,dest:`eg2.d`,amount:.45},{source:`seq`,dest:`eg2.s`,amount:.6},{source:`seq`,dest:`eg2.r`,amount:.35},{source:`mod`,dest:`eg1.d`,amount:.45},{source:`mod`,dest:`eg2.d`,amount:.45},{source:`eg1`,dest:`osc3.pos`,amount:.3},{source:`lfo1`,dest:`osc3.pos`,amount:.2},{source:`vel`,dest:`lad.cutoff`,amount:.12}])},{name:`Digi Blip`,a:F({"mix.osc1":0,"mix.osc3":1,"osc3.table":2,"osc3.interp":0,"osc3.oct":3,"osc3.pos":.4,drive:.3,"lad.cutoff":9e3,"lad.eg1":0,"eg2.a":.001,"eg2.d":.09,"eg2.s":0,"eg2.r":.05,"filter.route":1,"sem.mode":1,"sem.cutoff":250,"sem.res":.1,"lfo2.rate":.4,"lfo2.retrig":2},[{source:`rand`,dest:`osc3.pos`,amount:.5},{source:`vel`,dest:`osc3.pos`,amount:.2},{source:`lfo2`,dest:`sem.cutoff`,amount:.08}])},{name:`Shaker`,a:F({"mix.osc1":0,"mix.noise":1,"lad.cutoff":2e4,"lad.eg1":0,"filter.route":1,"sem.bp":1,"sem.cutoff":7e3,"sem.res":.2,"filter.key":0,"eg2.a":.006,"eg2.d":.07,"eg2.s":0,"eg2.r":.04},[{source:`vel`,dest:`eg2.level`,amount:.7},{source:`vel`,dest:`sem.cutoff`,amount:.06},{source:`rand`,dest:`sem.cutoff`,amount:.04},{source:`rand`,dest:`eg2.d`,amount:.05}])},{name:`Tape Strings`,a:F({"osc1.width":.3,"mix.osc1":.6,"mix.osc2":.6,"osc2.width":.3,"osc2.tune":.06,"mix.noise":.03,"noise.type":1,drive:.15,"lad.cutoff":4500,"lad.res":.1,"lad.eg1":0,"filter.route":1,"sem.mode":1,"sem.cutoff":180,"eg2.a":.15,"eg2.d":1,"eg2.s":.9,"eg2.r":.45,"lfo1.rate":5.8,"lfo1.shape":0,"lfo1.retrig":1,"lfo2.rate":.7,"lfo2.shape":0,"lfo2.retrig":1,"voice.unison":1,"voice.detune":.15,"panner.mode":1},[{source:`lfo1`,dest:`osc1.tune`,amount:.002},{source:`lfo1`,dest:`osc2.tune`,amount:.002},{source:`lfo2`,dest:`osc1.tune`,amount:.003},{source:`lfo2`,dest:`osc2.tune`,amount:.003}])}],Si=24,Ci=.5,wi=1,Ti=11,Ei=e=>({params:{...e.params},matrix:e.matrix.map(e=>({...e}))}),Di=e=>JSON.parse(JSON.stringify(e));function Oi(e){return{name:e===0?xi[0].name:``,kind:`synth`,slot:0,voices:e===0?24:0,channel:e===0?0:e+1,lo:0,hi:127,octave:0,a:Ei(xi[0].a),b:Ei(xi[0].a)}}var ki=class e extends E{name;slots=[...xi];parts;multiNameValue=`Multi`;editListeners=new Set;editPart=0;editSide=`a`;syncing=!0;bpmValue=120;held=[];sounding=new Map;bend=0;followEdit=!1;modWheelValue=0;noteListeners=new Set;performanceListeners=new Set;partListeners=new Set;seq;now=()=>0;latency=()=>0;kitSounds;sentSounds=new Map;desk=[];mixValues={...ze};fetching=new Set;padSel=0;selStep=-1;lockStep;recording=!1;entryHeld=new Set;takes=new Map;constructor(e=`MOA-RIG`){super(),this.name=e,this.seq=new Wr({on:(e,t,n,r)=>this.circuit.send(`synth`,{type:`on`,part:e,note:t,vel:n,when:r}),off:(e,t,n)=>this.circuit.send(`synth`,{type:`off`,part:e,note:t,when:n}),locks:(e,t,n)=>this.circuit.send(`synth`,{type:`lock`,part:e,locks:t,when:n}),mod:(e,t,n)=>this.circuit.send(`synth`,{type:`ctrl`,part:e,name:`seq`,value:t,when:n}),flush:()=>this.circuit.send(`synth`,{type:`flush`})}),this.parts=Array.from({length:16},(e,t)=>Oi(t));let t=this.circuit;t.add(`synth`,`rig`,{},{state:`{}`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`synth`,`meterL`).connect(`synth`,`meterR`),this.outputList.push({name:`out`,nodeId:`synth`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});for(let e of Xe){let t=t=>this.edit(e.id,t);e.kind===`number`?this.controlList.push(new D(e.id,e.label,e.min,e.max,e.def,e.unit??``,t,e.curve)):e.kind===`choice`?this.controlList.push(new O(e.id,e.label,e.options,e.options[e.def],n=>t(e.options.indexOf(n)))):this.controlList.push(new k(e.id,e.label,e.def>0,e=>t(+!!e)))}for(let e of Re){let t=t=>this.setMix(e.id,t);e.kind===`number`?this.desk.push(new D(e.id,e.label,e.min,e.max,e.def,e.unit??``,t,e.curve)):e.kind===`choice`?this.desk.push(new O(e.id,e.label,e.options,e.options[e.def],n=>t(e.options.indexOf(n)))):this.desk.push(new k(e.id,e.label,e.def>0,e=>t(+!!e)))}this.syncing=!1,this.saveState(),t.onReady(e=>{e===`synth`&&(this.sentSounds.clear(),this.parts.forEach((e,t)=>this.sendKit(t)))})}deskControl(e){let t=this.desk.find(t=>t.id===e);if(!t)throw Error(`Unknown mixer control: ${e}`);return t}setMix(e,t){this.mixValues[e]!==t&&(this.mixValues[e]=t,this.circuit.send(`synth`,{type:`mix`,id:e,value:t}),!this.syncing&&this.saveState())}mixToSave(){return Object.fromEntries(Object.entries(this.mixValues).filter(([e])=>!e.endsWith(`throw`)))}setKind(e,t){let n=this.parts[e];n.kind!==t&&(n.kind=t,t===`kit`&&(n.voices&&this.setVoices(e,0),n.kit??=bi(vi[0]),n.name=n.kit.name),this.circuit.send(`synth`,{type:`kind`,part:e,kind:t}),this.saveState(),this.sendKit(e),this.notifyParts())}loadKit(e,t){let n=this.parts[e];n.kit=bi(t),n.name=t.name,n.kind===`kit`?(this.sendKit(e),this.saveState(),this.notifyParts()):this.setKind(e,`kit`)}get pad(){return this.padSel}selectPad(e){this.padSel=Math.max(0,Math.min(15,e)),this.notifyParts()}setPad(e,t,n){let r=this.parts[e]?.kit?.pads[t];r&&(Object.assign(r,n),this.sendPad(e,t),this.saveState(),this.notifyParts())}sendKit(e){let t=this.parts[e];if(t.kind===`kit`&&t.kit)for(let n=0;n<t.kit.pads.length;n++)this.sendPad(e,n)}sendPad(e,t){let n=this.parts[e]?.kit?.pads[t];if(!n)return;let r=pi(n),i=this.sentSounds.get(r);i===void 0?this.fetchSound(r,n):this.circuit.send(`synth`,{type:`pad`,part:e,pad:t,settings:{sample:r,start:n.start*i,end:n.end>n.start?n.end*i:0,tune:n.tune,level:n.level,pan:n.pan,attack:0,decay:n.decay,mode:`oneshot`,reverse:n.reverse,loop:!1,group:n.group,velLevel:1,cutoff:n.cutoff,reso:n.reso,velFilter:0}})}fetchSound(e,t){this.kitSounds&&!this.fetching.has(e)&&(this.fetching.add(e),this.kitSounds({...t,analog:{...t.analog}}).then(t=>{this.fetching.delete(e),t&&(this.circuit.send(`synth`,{type:`sample`,id:e,rate:t.rate,channels:t.channels}),this.sentSounds.set(e,t.rate),this.parts.forEach((t,n)=>t.kit?.pads.forEach((r,i)=>{t.kind===`kit`&&pi(r)===e&&this.sendPad(n,i)})),this.dropUnused())},()=>this.fetching.delete(e)))}dropUnused(){let e=new Set(this.parts.flatMap(e=>e.kind===`kit`&&e.kit?e.kit.pads.map(pi):[]));for(let t of[...this.sentSounds.keys()])e.has(t)||(this.sentSounds.delete(t),this.circuit.send(`synth`,{type:`drop`,id:t}))}get part(){return this.editPart}get side(){return this.editSide}selectPart(e){let t=this.editPart;if(this.editPart=Math.max(0,Math.min(15,e)),this.followEdit&&t!==this.editPart)for(let[e,n]of[[`bend`,this.bend],[`mod`,this.modWheelValue]])this.circuit.send(`synth`,{type:`ctrl`,part:t,name:e,value:0}),this.circuit.send(`synth`,{type:`ctrl`,part:this.editPart,name:e,value:n});this.lockStep&&this.lockStep.track!==this.editPart&&(this.lockStep=void 0),this.syncControls()}selectSide(e){this.editSide=e,this.syncControls()}loadSlot(e){let t=this.slots[e];if(!t)return;let n=this.parts[this.editPart];n.slot=e,n.name=t.name,n.a=Ei(t.a),n.b=Ei(t.b??t.a),this.syncControls(),this.sendPatch(this.editPart)}get routes(){return this.parts[this.editPart][this.editSide].matrix}setRoutes(e){this.parts[this.editPart][this.editSide].matrix=e.map(e=>({...e})),this.sendPatch(this.editPart)}copySide(){let e=this.parts[this.editPart];this.editSide===`a`?e.b=Ei(e.a):e.a=Ei(e.b),this.sendPatch(this.editPart)}get multiName(){return this.multiNameValue}set multiName(e){this.multiNameValue=e.slice(0,24),this.edited()}get midiToEdited(){return this.followEdit}set midiToEdited(e){this.followEdit=e,this.notifyParts()}onEdit(e){return this.editListeners.add(e),()=>this.editListeners.delete(e)}edited(){for(let e of this.editListeners)e()}setPartName(e,t){this.parts[e].name=t.slice(0,24),this.notifyParts(),this.edited()}saveSound(e){let t=this.parts[this.editPart],n={name:e.trim().slice(0,24)||`Sound`,a:Ei(t.a),b:Ei(t.b)},r=this.slots.findIndex((e,t)=>t>=this.factorySounds&&e.name===n.name);return r<0?r=this.slots.push(n)-1:this.slots[r]=n,t.slot=r,t.name=n.name,this.notifyParts(),this.edited(),r}get factorySounds(){return xi.length}get savedSounds(){return this.slots.slice(this.factorySounds)}setSavedSounds(e){this.slots.splice(this.factorySounds,1/0,...e.map(Di)),this.notifyParts()}toMulti(){return Di({v:1,name:this.multiName,parts:this.parts,patterns:this.seq.patterns,current:this.seq.current,chain:this.seq.chain,tempo:this.bpm,shuffle:this.seq.shuffle,mix:this.mixToSave()})}loadMulti(e){this.stop(),this.multiName=e.name,e.parts.forEach((e,t)=>{Object.assign(this.parts[t],Di(e),{voices:0,slot:e.slot<this.slots.length?e.slot:0,kit:e.kit?Di(e.kit):void 0})}),e.parts.forEach((e,t)=>{this.parts[t].voices=e.kind===`kit`?0:Math.max(0,Math.min(this.freeVoices,e.voices))}),this.seq.patterns=Di(e.patterns),this.seq.current=e.current,this.seq.next=void 0,this.seq.chain=[...e.chain],this.seq.shuffle=e.shuffle,this.bpm=e.tempo,this.syncing=!0;for(let t of this.desk)Ai(t,e.mix[t.id]??ze[t.id]);this.syncing=!1,this.circuit.send(`synth`,{type:`layout`,counts:this.parts.map(e=>e.voices)}),this.parts.forEach((e,t)=>{this.sendPatch(t),this.circuit.send(`synth`,{type:`kind`,part:t,kind:e.kind}),this.sendKit(t)}),this.dropUnused(),this.editPart=0,this.padSel=0,this.editSide=`a`,this.selStep=-1,this.lockStep=void 0,this.syncControls(),this.seq.notify()}newMulti(){let t=new e().toMulti();t.name=`Multi`,this.loadMulti(t)}setVoices(e,t){this.parts[e].kind===`kit`&&(t=0);let n=this.parts.reduce((t,n,r)=>t+(r===e?0:n.voices),0);this.parts[e].voices=Math.max(0,Math.min(24-n,Math.round(t))),this.circuit.send(`synth`,{type:`layout`,counts:this.parts.map(e=>e.voices)}),this.saveState(),this.notifyParts()}setPartSetting(e,t,n){this.parts[e][t]=Math.round(n),this.notifyParts(),this.edited()}get freeVoices(){return 24-this.parts.reduce((e,t)=>e+t.voices,0)}set bpm(e){this.bpmValue=e,this.seq.tempo=e,this.circuit.send(`synth`,{type:`bpm`,bpm:e}),this.saveState()}get bpm(){return this.bpmValue}onPartChange(e){return this.partListeners.add(e),()=>this.partListeners.delete(e)}edit(e,t){if(!this.syncing){if(this.lockStep){let{track:n,step:r}=this.lockStep;this.seq.pattern.tracks[n].steps[r].locks[e]=t,this.seq.notify()}else this.parts[this.editPart][this.editSide].params[e]=t,this.sendPatch(this.editPart)}}get step(){return this.selStep}selectStep(e,t){this.selStep=t,this.entryHeld.clear(),this.lockStep&&={track:e,step:t},e===this.editPart?this.lockStep?this.syncControls():this.notifyParts():this.selectPart(e)}holdStep(){this.selStep<0||(this.lockStep={track:this.editPart,step:this.selStep},this.syncControls())}releaseStep(){this.lockStep&&(this.lockStep=void 0,this.syncControls())}get holding(){return this.lockStep!==void 0}get isRecording(){return this.recording}setRecording(e){this.recording=e,this.entryHeld.clear(),this.takes.clear(),this.notifyParts()}play(){this.seq.play(this.now())}stop(){this.seq.stop(this.now()),this.takes.clear()}heard(){return this.now()-this.latency()}recordOn(e,t){let n=this.seq.pattern.tracks[this.editPart];if(this.seq.isPlaying){if(!this.recording)return;let r=this.seq.stepNear(this.editPart,this.heard());if(!r)return;let i=n.steps[r.step];!this.takes.size&&this.parts[this.editPart].kind!==`kit`&&(i.notes=[],delete i.vels),i.notes.includes(e)||i.notes.push(e),i.vels={...i.vels,[e]:t},i.gate=Ci,this.seq.recorded(this.editPart,r.step,r.tick),this.takes.set(e,{step:i,tick:this.seq.tickAt(this.heard()),clock:n.clock})}else{if(this.selStep<0&&!this.recording)return;this.selStep<0&&(this.selStep=0);let r=n.steps[this.selStep];this.entryHeld.size===0&&(r.notes=[],delete r.vels),this.entryHeld.add(e),r.notes.includes(e)||r.notes.push(e),r.vel=t}this.seq.notify()}recordOff(e){let t=this.takes.get(e);t&&(this.takes.delete(e),t.step.gate=Math.max(.25,Math.min(16,Math.round((this.seq.tickAt(this.heard())-t.tick)/t.clock*4)/4)),this.seq.notify()),this.entryHeld.delete(e)&&this.entryHeld.size===0&&this.recording&&!this.seq.isPlaying&&(this.selStep=(this.selStep+1)%this.seq.pattern.tracks[this.editPart].length,this.notifyParts())}audition(e,t){this.circuit.send(`synth`,t?{type:`on`,part:this.editPart,note:e,vel:.8}:{type:`off`,part:this.editPart,note:e})}toggleHit(e,t,n){let r=this.seq.pattern.tracks[e]?.steps[t];r&&(r.notes.includes(n)?(r.notes=r.notes.filter(e=>e!==n),r.vels&&(delete r.vels[n],Object.keys(r.vels).length||delete r.vels)):r.notes.push(n),this.seq.notify())}clearHits(e,t){let n=this.seq.pattern.tracks[e];if(n){for(let e of n.steps)e.notes.includes(t)&&(e.notes=e.notes.filter(e=>e!==t),e.vels&&(delete e.vels[t],Object.keys(e.vels).length||delete e.vels));this.seq.notify()}}moveRows(e,t,n){let r=this.seq.pattern.tracks[e],i=e=>ui.indexOf(e),a=[...new Set(t.map(i))].sort((e,t)=>(e-t)*-n);if(!r||!a.length||a.some(e=>e<0||e+n<0||e+n>=16))return t;let o=Array.from({length:16},(e,t)=>t);for(let e of a)[o[e],o[e+n]]=[o[e+n],o[e]];let s=e=>36+ui[e],c=new Map(o.map((e,t)=>[s(e),s(t)]));for(let e of r.steps)e.notes=e.notes.map(e=>c.get(e)??e),e.vels&&=Object.fromEntries(Object.entries(e.vels).map(([e,t])=>[c.get(Number(e))??Number(e),t]));return this.seq.notify(),a.map(e=>ui[e+n]).sort((e,t)=>i(e)-i(t))}setHitVelocity(e,t,n,r){let i=this.seq.pattern.tracks[e]?.steps[t];i?.notes.includes(n)&&(i.vels={...i.vels,[n]:Math.round(Math.max(.05,Math.min(1,r))*100)/100},this.seq.notify())}transposeStep(e,t,n){let r=this.seq.pattern.tracks[e]?.steps[t];if(!r?.notes.length)return;let i=Math.min(...r.notes),a=Math.max(...r.notes),o=Math.max(-i,Math.min(127-a,Math.round(n)));o&&(r.notes=r.notes.map(e=>e+o),r.vels&&=Object.fromEntries(Object.entries(r.vels).map(([e,t])=>[Number(e)+o,t])),this.seq.notify())}syncControls(){this.syncing=!0;let e=this.lockStep?this.seq.pattern.tracks[this.lockStep.track].steps[this.lockStep.step].locks:{},t={...this.parts[this.editPart][this.editSide].params,...e};for(let e of this.controlList)Ai(e,t[e.id]??$e[e.id]);this.syncing=!1,this.notifyParts()}sendPatch(e){let t=this.parts[e];this.circuit.send(`synth`,{type:`patch`,part:e,a:t.a,b:t.b}),this.saveState()}saveState(){this.circuit.setOption(`synth`,`state`,JSON.stringify({counts:this.parts.map(e=>e.voices),patches:this.parts.map((e,t)=>({part:t,a:e.a,b:e.b})),kinds:this.parts.map(e=>e.kind),mix:this.mixValues,bpm:this.bpmValue})),this.edited()}notifyParts(){for(let e of this.partListeners)e()}keyDown(e){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.start(`k${e}`,[this.editPart],this.parts[this.editPart].kind===`kit`?e-Si:e,.8),this.notifyNotes()}keyUp(e){this.held.includes(e)&&(this.held=this.held.filter(t=>t!==e),this.release(`k${e}`),this.notifyNotes())}handleMidi(e){switch(e.type){case`noteOn`:{let t=this.followEdit?[this.editPart]:this.parts.flatMap((t,n)=>(t.voices>0||t.kind===`kit`)&&(t.channel===0||t.channel===e.channel)&&e.note>=t.lo&&e.note<=t.hi?[n]:[]);this.start(`${e.channel}:${e.note}`,t,e.note,e.velocity/127);break}case`noteOff`:this.release(`${e.channel}:${e.note}`);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===wi?this.setModWheel(e.value/127):e.controller===Ti&&this.sendControl(`exp`,e.value/127)}}start(e,t,n,r){this.release(e);let i=t.map(e=>({part:e,note:this.parts[e].kind===`kit`?n:n+12*this.parts[e].octave}));for(let e of i)this.circuit.send(`synth`,{type:`on`,part:e.part,note:e.note,vel:r});i.length&&this.sounding.set(e,i);let a=i.find(e=>e.part===this.editPart);a&&this.recordOn(a.note,r)}release(e){for(let t of this.sounding.get(e)??[])this.circuit.send(`synth`,{type:`off`,part:t.part,note:t.note}),t.part===this.editPart&&this.recordOff(t.note);this.sounding.delete(e)}panic(){this.stop(),this.sounding.clear(),this.held=[],this.circuit.send(`synth`,{type:`panic`}),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.max(-1,Math.min(1,e)),this.sendControl(`bend`,this.bend),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.max(0,Math.min(1,e)),this.sendControl(`mod`,this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}sendControl(e,t){if(this.followEdit)this.circuit.send(`synth`,{type:`ctrl`,part:this.editPart,name:e,value:t});else for(let n=0;n<16;n++)this.circuit.send(`synth`,{type:`ctrl`,part:n,name:e,value:t})}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}};function Ai(e,t){e.kind===`number`?e.set(t):e.kind===`choice`?e.set(e.options[Math.round(t)]??e.options[0]):e.kind===`toggle`&&e.set(t>=.5)}var ji=[[`mult.1`,`mult.2`,`mult.3`,`mult.4`],[`sq.mult.1`,`sq.mult.2`,`sq.mult.3`,`sq.mult.4`]],Mi=ji.flat(),Ni=e=>ji.findIndex(t=>t.includes(e)),Pi=new Set(_),Fi=new Set(v.map(e=>e.id)),Ii=new Set(Mi);function Li(e){if(Pi.has(e))return`out`;if(Fi.has(e))return`in`;if(Ii.has(e))return`mult`}function Ri(e,t){let n=Li(e),r=Li(t);if(n&&r&&e!==t&&(n!==`mult`||r!==`mult`)){if(n===`out`&&r!==`out`)return{from:e,to:t};if(r===`out`&&n!==`out`)return{from:t,to:e};if(n===`mult`&&r===`in`)return{from:e,to:t};if(r===`mult`&&n===`in`)return{from:t,to:e}}}var zi=e=>Li(e)!==`out`;function Bi(e,t){let n=new Set([t.from,t.to].filter(zi)),r=Ii.has(t.to)?Ni(t.to):-1;return[...e.filter(e=>!n.has(e.from)&&!n.has(e.to)&&!(r>=0&&Ni(e.to)===r)),t]}var Vi=(e,t)=>e.filter(e=>e.from!==t&&e.to!==t);function Hi(e){let t=ji.map((t,n)=>e.find(e=>Ii.has(e.to)&&Ni(e.to)===n)?.from),n=[];for(let r of e)if(!Ii.has(r.to)){if(Ii.has(r.from)){let e=t[Ni(r.from)];e&&n.push({from:e,to:r.to})}else n.push(r)}return n}var Ui=e=>e.map(e=>`${e.from}>${e.to}`).join(`;`);function Wi(e){let t=[];for(let n of e.split(`;`)){let[e,r]=n.split(`>`),i=e&&r?Ri(e,r):void 0;i&&(t=Bi(t,i))}return t}new Map(h.map(e=>[e.id,e.label])),new Map(v.filter(e=>e.slider).map(e=>[e.id,e.slider])),[..._,...Mi],[...v.map(e=>e.id),...Mi];var I=`cords`,Gi={...Object.fromEntries(h.map(e=>[e.id,e.kind===`choice`?e.options[e.def]:e.def])),[I]:``},Ki=[`play.channel`],qi=[`sem.route`],L=(e,t)=>({name:e,values:t}),R=65.41,Ji=130.81,Yi=261.63,Xi=523.25,Zi=`vcf.out>sem.in.vco1`;function Qi(e,t=``,n=2,r=1){let i={};return e.forEach((e,t)=>{i[`sq.step.${r+t}`]=Math.min(1,Math.max(0,e/(12*n)))}),[...t].forEach((e,t)=>{i[`sq.gate.${r+t}`]=`123`.includes(e)?e:`off`}),i}function $i(e,t=1){return Object.fromEntries(e.map((e,n)=>[`sq.step.${t+n}`,e]))}var ea=[L(`Init`,{}),L(`Classic Bass`,{"vco1.freq":R,"vco2.freq":R,"vco2.fine":.08,"vco3.freq":R/2,"vcf.in.vco1":.7,"vcf.in.vco2":.6,"vcf.in.vco3":.4,"vcf.freq":180,"vcf.res":.35,"vcf.cv.adsr":.45,"adsr.attack":.002,"adsr.decay":.35,"adsr.sustain":.25,"adsr.release":.12}),L(`Sync Lead`,{"vco2.sync":1,"vco2.freq":Xi,"vco2.fm.adsr":.2,"vcf.in.vco1":0,"vcf.in.vco2":.8,"vcf.freq":3e3,"vcf.res":.2,"vcf.cv.adsr":.15,"adsr.decay":.8,"adsr.sustain":.7,"kb.portaOn":1,"kb.porta":.2,"lfo.delay":.4,"lfo.depth":.25}),L(`Ladder Squelch`,{"vcf.mode":`4012`,"vco1.freq":Ji,"vcf.freq":220,"vcf.res":.85,"vcf.cv.adsr":.5,"adsr.attack":.001,"adsr.decay":.25,"adsr.sustain":.1,"adsr.release":.1}),L(`Brass`,{"vcf.in.vco1":.6,"vcf.in.vco3":.6,"vco3.fine":.06,"vcf.freq":500,"vcf.res":.1,"vcf.cv.adsr":.35,"adsr.attack":.06,"adsr.decay":.5,"adsr.sustain":.7,"adsr.release":.25,"lfo.delay":.6,"lfo.depth":.15}),L(`Duo Lead`,{"kb.voice":`duo`,"vcf.in.vco1":.6,"vcf.in.vco2":.6,"vcf.in.vco3":.5,"vco3.fine":.05,"vcf.freq":2200,"vcf.res":.25,"adsr.decay":.6,"adsr.sustain":.7,"kb.portaOn":1,"kb.porta":.15,"lfo.delay":.5,"lfo.depth":.2}),L(`Ring Bells`,{"vcf.in.vco1":0,"vcf.in.ring":.9,"vco2.freq":Yi*2.76,"vcf.freq":6e3,"vcf.cv.adsr":0,"adsr.attack":.001,"adsr.decay":1.8,"adsr.sustain":0,"adsr.release":1.5,"reverb.left":.35,"reverb.right":.35}),L(`FM Clang`,{"vcf.in.vco1":0,"vcf.in.vco3":.8,"vco3.fm.vco2":.3,"vco2.freq":Yi*3.5,"vcf.freq":4e3,"vcf.cv.adsr":.2,"adsr.attack":.001,"adsr.decay":1.2,"adsr.sustain":0,"adsr.release":.8,"reverb.left":.25,"reverb.right":.25}),L(`Droid Chatter`,{"vco1.fm.sh":.25,"sh.rate":9,"vcf.freq":2500,"vcf.cv.adsr":0,"kb.repeat":`kybd`,"lfo.speed":9,"adsr.attack":.001,"adsr.decay":.08,"adsr.sustain":0,"adsr.release":.05}),L(`Laser Zap`,{"vco1.freq":Xi,"vco1.fm.adsr":.35,"vcf.freq":5e3,"vcf.res":.2,"vcf.cv.adsr":0,"adsr.attack":.001,"adsr.decay":.25,"adsr.sustain":0,"adsr.release":.2}),L(`Repeat Bleeps`,{"kb.repeat":`kybd`,"lfo.speed":7,"vcf.freq":900,"vcf.res":.6,"vcf.cv.adsr":.35,"adsr.attack":.001,"adsr.decay":.12,"adsr.sustain":0,"adsr.release":.1}),L(`Wind and Surf`,{"vcf.in.vco1":0,"vcf.in.noise":.9,"noise.color":.5,"vcf.freq":400,"vcf.res":.75,"vcf.cv.kybd":0,"vcf.cv.adsr":0,"vcf.cv.vco2":.35,"vco2.range":`lf`,"vco2.freq":33,"adsr.attack":1.5,"adsr.sustain":1,"adsr.release":3,"reverb.left":.4,"reverb.right":.4}),L(`Noise Snare`,{"vcf.in.vco1":.2,"vco1.freq":196,"vcf.in.noise":.9,"vcf.freq":3500,"vcf.cv.kybd":0,"vcf.cv.adsr":.1,"adsr.attack":.001,"adsr.decay":.18,"adsr.sustain":0,"adsr.release":.15}),L(`Kick Drum`,{"vco1.freq":50,"vco1.fm.adsr":.3,"vcf.in.vco1":.9,"vcf.freq":120,"vcf.res":.3,"vcf.cv.kybd":0,"vcf.cv.adsr":.35,"vca.in.vcf":1,"adsr.attack":.001,"adsr.decay":.22,"adsr.sustain":0,"adsr.release":.18,"reverb.left":.05,"reverb.right":.05}),L(`Space Organ`,{"vcf.in.vco1":.6,"vco2.freq":Xi,"vcf.in.vco2":.5,"vcf.freq":3e3,"vcf.cv.adsr":0,"adsr.attack":.01,"adsr.decay":.1,"adsr.sustain":1,"adsr.release":.1,"lfo.speed":6,"lfo.depth":.12,"reverb.left":.5,"reverb.right":.5}),L(`Dual Filter Pad`,{"vco2.fine":.1,"vco3.fine":-.1,"vcf.in.vco1":.6,"vcf.in.vco2":.6,"vcf.freq":700,"vcf.res":.3,"vcf.cv.adsr":.15,"sem.in.vco1":.6,"sem.in.vco3":.5,"sem.freq":1800,"sem.mode":.8,"sem.res":.4,"sem.cv.lfo":.08,"lfo.speed":.3,"vca.in.sem":.7,"adsr.attack":.8,"adsr.decay":1.5,"adsr.sustain":.8,"adsr.release":2,"reverb.left":.35,"reverb.right":.35}),L(`Notch Sweep`,{[I]:Zi,"sem.in.vco1":1,"vca.in.vcf":0,"vca.in.sem":.8,"vcf.in.vco1":0,"vcf.in.vco2":.6,"vcf.in.vco3":.6,"vco3.fine":.07,"vcf.freq":8e3,"vcf.cv.adsr":0,"sem.mode":.5,"sem.res":.5,"sem.freq":800,"sem.cv.kybd":0,"sem.cv.lfo":.25,"lfo.speed":.25,"adsr.sustain":1,"adsr.release":.6}),L(`Band Pass Voice`,{[I]:Zi,"sem.in.vco1":1,"vca.in.vcf":0,"vca.in.sem":.8,"vcf.in.vco1":.7,"vcf.in.vco3":.6,"vco3.fine":.07,"vcf.freq":5e3,"vcf.cv.adsr":0,"sem.bp":1,"sem.freq":900,"sem.res":.6,"sem.cv.adsr":.15,"adsr.attack":.03,"adsr.sustain":.8,"lfo.delay":.3,"lfo.depth":.15}),L(`Twin Resonance`,{[I]:Zi,"sem.in.vco1":1,"vca.in.vcf":0,"vca.in.sem":.8,"vco1.freq":Ji,"vcf.mode":`4012`,"vcf.freq":350,"vcf.res":.7,"vcf.cv.adsr":.4,"sem.freq":1400,"sem.res":.75,"sem.cv.adsr":.25,"sem.mode":.15,"adsr.attack":.002,"adsr.decay":.4,"adsr.sustain":.2,"adsr.release":.2}),L(`S&H Filter`,{[I]:`sh.out>vcf.cv.vco2`,"vcf.cv.vco2":.3,"vcf.freq":700,"vcf.res":.7,"vcf.cv.adsr":0,"sh.rate":7,"adsr.sustain":1,"adsr.release":.3}),L(`Inverted Envelope`,{[I]:`adsr.out>vp.1;vp.inv1>vcf.cv.vco2`,"vcf.cv.vco2":.4,"vcf.freq":5e3,"vcf.res":.5,"vcf.cv.adsr":0,"adsr.attack":.3,"adsr.decay":.8,"adsr.sustain":.4,"adsr.release":.5}),L(`Mult Wobble`,{[I]:`lfo.tri>mult.1;mult.2>vcf.cv.vco2;mult.3>vco2.pwm`,"vco2.freq":R,"vcf.in.vco1":0,"vcf.in.vco2":.8,"vco2.pwm":.5,"vcf.cv.vco2":.25,"vcf.freq":600,"vcf.res":.5,"vcf.cv.adsr":0,"lfo.speed":3,"adsr.sustain":1}),L(`Octave Switch`,{[I]:`vp.inv2>esw.b;esw.c>mult.1;mult.2>vco1.fm.sh;mult.3>vco2.fm.sh`,"vp.6":.1,"vco1.fm.sh":1,"vco2.fm.sh":1,"vco2.fine":.07,"vcf.in.vco2":.6,"vcf.freq":2e3,"vcf.res":.3,"vcf.cv.adsr":.1,"sh.rate":6,"adsr.sustain":.8}),L(`SQ16 Bass Line`,{[I]:`sq.qa>mult.1;mult.2>vco1.fm.kybd;mult.3>vco2.fm.kybd;sq.cgate1>adsr.gate`,"vco1.freq":R,"vco2.freq":R,"vco2.fine":.08,"vcf.in.vco2":.5,"vcf.freq":300,"vcf.res":.45,"vcf.cv.adsr":.4,"adsr.attack":.002,"adsr.decay":.2,"adsr.sustain":.2,"adsr.release":.1,"sq.scale":`minor`,"sq.rate":7}),L(`Keys Pitch, SQ16 Rhythm`,{[I]:`sq.cgate1>adsr.gate;sq.b>vcf.cv.vco2`,"vcf.cv.vco2":.25,"vcf.freq":400,"vcf.res":.5,"vcf.cv.adsr":.2,"vcf.in.vco3":.5,"vco3.fine":.07,"adsr.attack":.002,"adsr.decay":.15,"adsr.sustain":.3,"adsr.release":.1,"sq.mode":`8x2`,"sq.rate":8}),L(`SQ16 Random Bleeps`,{[I]:`sq.qa>vco1.fm.kybd;sq.cgate1>adsr.gate`,"vco1.freq":Ji,"vcf.freq":2500,"vcf.cv.adsr":.15,"adsr.attack":.001,"adsr.decay":.1,"adsr.sustain":0,"adsr.release":.08,"sq.dir":`random`,"sq.scale":`pent`,"sq.range":`4`,"sq.rate":9,"reverb.left":.35,"reverb.right":.35}),L(`Acid 8x2`,{[I]:`sq.qa>vco1.fm.kybd;sq.cgate1>adsr.gate;sq.b>vcf.cv.vco2`,"vco1.freq":R,"vcf.mode":`4012`,"vcf.freq":250,"vcf.res":.8,"vcf.cv.adsr":.35,"vcf.cv.vco2":.2,"vcf.cv.kybd":0,"adsr.attack":.002,"adsr.decay":.18,"adsr.sustain":0,"adsr.release":.1,"sq.mode":`8x2`,"sq.rate":8,...Qi([0,0,12,0,3,15,0,10],`1.111.11`),...$i([.2,0,.8,.1,.3,0,.6,.2],9)}),L(`Keys Transpose Arp`,{[I]:`kb.cv>sq.cvin;sq.qa>mult.1;mult.2>vco1.fm.kybd;mult.3>vco2.fm.kybd;sq.cgate1>adsr.gate`,"vco1.freq":Ji,"vco2.freq":Ji,"vco2.fine":.07,"vcf.in.vco2":.5,"vcf.freq":1800,"vcf.res":.2,"vcf.cv.adsr":.25,"adsr.attack":.002,"adsr.decay":.25,"adsr.sustain":.3,"adsr.release":.2,"reverb.left":.25,"reverb.right":.25,"sq.scale":`major`,"sq.rate":10,...Qi([0,4,7,12,16,12,7,4,0,4,7,11,14,11,7,4],`1111111111111111`)}),L(`Two-Voice Counterpoint`,{[I]:`sq.qa>vco1.fm.kybd;sq.qb>vco2.fm.kybd;sq.cgate1>adsr.gate`,"vco1.freq":Ji,"vco2.freq":Ji,"vcf.in.vco1":.6,"vcf.in.vco2":.6,"vcf.freq":2e3,"vcf.res":.15,"vcf.cv.adsr":.2,"adsr.attack":.005,"adsr.decay":.3,"adsr.sustain":.5,"adsr.release":.25,"sq.mode":`8x2`,"sq.scale":`dorian`,"sq.rate":5,...Qi([0,3,7,5,3,2,0,10],`11111111`),...Qi([12,14,15,17,15,14,12,19],``,2,9)}),L(`Random Pentatonic`,{[I]:`sh.out>vp.1;vp.inv1>sq.ina;sq.qa>vco1.fm.kybd;sh.clk>adsr.gate`,"vp.2":.5,"vco1.freq":Ji,"sh.rate":6,"vcf.freq":2200,"vcf.cv.adsr":.2,"adsr.attack":.002,"adsr.decay":.15,"adsr.sustain":.2,"adsr.release":.15,"sq.scale":`pent`,"reverb.left":.35,"reverb.right":.35}),L(`Swaying Tempo`,{[I]:`sq.qa>vco1.fm.kybd;sq.cgate1>adsr.gate;lfo.tri>sq.fmin`,"sq.fm":.12,"lfo.speed":.15,"vco1.freq":Ji,"vcf.in.vco3":.5,"vco3.fine":.05,"vcf.freq":1500,"vcf.res":.3,"vcf.cv.adsr":.3,"adsr.attack":.003,"adsr.decay":.3,"adsr.sustain":.2,"adsr.release":.3,"reverb.left":.3,"reverb.right":.3,"sq.scale":`minor`,"sq.rate":6,...Qi([0,7,3,10,12,10,7,3,5,7,8,12,15,12,8,7],`1111111111111111`)}),L(`Step Filter (hold a key)`,{[I]:`sq.a>vcf.cv.vco2`,"vcf.cv.vco2":.3,"vcf.freq":150,"vcf.res":.6,"vcf.cv.adsr":0,"vcf.in.vco1":.6,"vcf.in.vco3":.6,"vco3.fine":.07,"adsr.attack":.01,"adsr.sustain":1,"adsr.release":.4,"sq.rate":8,...$i([.1,.5,.25,.8,.1,.6,.35,.9,.15,.5,.2,.7,.1,.4,.6,1])}),L(`Odd Loop (5 steps)`,{[I]:`sq.qa>vco1.fm.kybd;sq.cgate1>adsr.gate`,"sq.skip":`reset`,"vco1.freq":R,"vco2.freq":R,"vco2.fine":.1,"vcf.in.vco2":.5,"vcf.freq":400,"vcf.res":.5,"vcf.cv.adsr":.4,"adsr.attack":.002,"adsr.decay":.2,"adsr.sustain":.1,"adsr.release":.1,"sq.scale":`minor`,"sq.rate":7,...Qi([0,12,7,10,3,0],`111113`)}),L(`Ring Mod Sequence`,{[I]:`sq.qa>vco2.fm.kybd;sq.cgate1>adsr.gate`,"vco2.freq":Yi*1.5,"vcf.in.vco1":0,"vcf.in.ring":.9,"vcf.freq":5e3,"vcf.cv.adsr":0,"adsr.attack":.001,"adsr.decay":.6,"adsr.sustain":0,"adsr.release":.5,"reverb.left":.4,"reverb.right":.4,"sq.rate":5,...Qi([0,7,12,5,10,3,15,8,0,12,7,19,5,14,10,2],`1111111111111111`)}),L(`SQ16 Chord Arp`,{[I]:`kb.cv>sq.cvin;sq.qa>mult.1;mult.2>vco1.fm.kybd;mult.3>vco2.fm.kybd;sq.cgate1>adsr.gate`,"vcf.in.vco1":.6,"vcf.in.vco2":.5,"vco2.fine":.08,"vcf.freq":1500,"vcf.res":.35,"vcf.cv.adsr":.3,"adsr.attack":.001,"adsr.decay":.16,"adsr.sustain":.1,"adsr.release":.12,"reverb.left":.15,"reverb.right":.15,"sq.sync":`midi`,"sq.div":`1/16`,"sq.dir":`random`,"sq.mode":`8x2`,"sq.pw":.4,...Qi([0,7,12,14,19,12,7,24],`11111111`)})],ta=Array.from({length:48},(e,t)=>ea[t]??L(`Init`,{})),na=1,ra=64,ia=[`omni`,...Array.from({length:16},(e,t)=>String(t+1))],aa=class extends E{name;bendRange=2;slots=[...ta];currentSlot=0;currentPreset=this.slots[0];held=[];latched=new Set;pedal=!1;bend=0;modWheelValue=0;gate=!1;last={n1:60,n2:60};portaHeld=!1;manualOn=!1;cordList=[];midiPulses=0;cordListeners=new Set;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`MOA-2600`){super(),this.name=e;let t=this.circuit,n=[...h,...g];t.add(`synth`,`m2600`,Object.fromEntries(n.map(e=>[e.id,e.def])),{cords:`[]`}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`synth`,`meterL`).connect(`synth`,`meterR`),this.outputList.push({name:`out`,nodeId:`synth`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let r=e=>n=>t.setParam(`synth`,e,n);for(let e of h){let t=Gi[e.id];if(e.kind===`number`)this.controlList.push(new D(e.id,e.label,e.min,e.max,t,e.unit??``,r(e.id),e.curve));else if(e.kind===`choice`){let n=e.options;this.controlList.push(new O(e.id,e.label,n,t,t=>r(e.id)(n.indexOf(t))))}else this.controlList.push(new k(e.id,e.label,t>0,t=>r(e.id)(+!!t)))}this.controlList.push(new O(`play.channel`,`MIDI channel`,ia,`omni`,()=>void 0))}get transport(){return{channel:this.control(`play.channel`)}}keyDown(e){let t=this.held.length===0;this.held=this.held.filter(t=>t!==e),this.held.push(e),this.latched.delete(e),this.sendNotes(t||this.multiTrigger),this.notifyNotes()}keyUp(e){this.held.includes(e)&&(this.pedal?this.latched.add(e):this.release(e))}release(e){this.held=this.held.filter(t=>t!==e),this.latched.delete(e),this.sendNotes(!1),this.notifyNotes()}get multiTrigger(){return this.control(`kb.trig`).value===`multi`}assign(){if(this.held.length===0)return;let e=Math.min(...this.held);return this.control(`kb.voice`).value===`mono`?{n1:e,n2:e}:{n1:e,n2:Math.max(...this.held)}}sendNotes(e){let t=this.assign();t?(this.gate=!0,this.last=t,this.circuit.play(`synth`,t.n1,t.n2,!0,e)):this.gate&&(this.gate=!1,this.circuit.play(`synth`,this.last.n1,this.last.n2,!1,!1))}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}setManual(e){e!==this.manualOn&&(this.manualOn=e,this.circuit.send(`synth`,{type:`manual`,on:e}))}setPortamentoHeld(e){e!==this.portaHeld&&(this.portaHeld=e,this.circuit.setParam(`synth`,`kb.portaOn`,e||this.control(`kb.portaOn`).value?1:0))}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`synth`,`bend`,this.bend*2),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`synth`,`modw`,this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}sequencer(e){this.circuit.send(`synth`,{type:`sq`,action:e})}jumpTo(e){this.circuit.send(`synth`,{type:`sq`,action:`jump`,index:e})}handleClock(e){if(this.control(`sq.sync`).value===`midi`){if(e.type===`start`)this.midiPulses=0,this.sequencer(`reset`),this.sequencer(`run`);else if(e.type===`continue`)this.sequencer(`run`);else if(e.type===`stop`)this.sequencer(`stop`);else if(e.type===`clock`){let e=i[this.control(`sq.div`).value];this.midiPulses%e===0&&this.circuit.send(`synth`,{type:`sqtick`}),this.midiPulses++}}}handleMidi(e){if(!(`channel`in e)){this.handleClock(e);return}let t=this.control(`play.channel`).value;if(t===`omni`||Number(t)===e.channel)switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:if(e.controller===na)this.setModWheel(e.value/127);else if(e.controller===ra&&(this.pedal=e.value>=64,!this.pedal))for(let e of[...this.latched])this.release(e);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}get cords(){return this.cordList}connect(e,t){let n=Ri(e,t);return n?(this.setCords(Bi(this.cordList,n)),!0):!1}unplug(e){this.setCords(Vi(this.cordList,e))}clearCords(){this.setCords([])}setCords(e){this.cordList=[...e];let t=Hi(this.cordList);this.circuit.setOption(`synth`,`cords`,JSON.stringify(t)),this.circuit.send(`synth`,{type:`cords`,cords:t});for(let e of this.cordListeners)e()}onCordsChange(e){return this.cordListeners.add(e),()=>this.cordListeners.delete(e)}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.currentPreset=t,this.applyValues({...Gi,...t.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){if(Ki.includes(t)||qi.includes(t))continue;if(t===`cords`){if(typeof n!=`string`)throw Error(`Patch: bad cords`);this.setCords(Wi(n));continue}let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)Ki.includes(t.id)||(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e[I]=Ui(this.cordList),e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyPreset(){for(let e of this.presetListeners)e()}},oa={steel:{name:`Steel`,rho:7850,E:2e11},nickel:{name:`Nickel-plated steel`,rho:8900,E:2e11},stainless:{name:`Stainless steel`,rho:8e3,E:193e9}},sa={round:{name:`Roundwound`,fill:.78,b2:2e-5},half:{name:`Half-round`,fill:.85,b2:4e-5},flat:{name:`Flatwound`,fill:.92,b2:9e-5},plain:{name:`Plain steel`,fill:0,b2:4e-6}},ca=[`round`,`half`,`flat`],z=.0254,la={E:{outer:.105*z,core:.04*z,wrap:`nickel`,winding:`round`,note:28},A:{outer:.085*z,core:.034*z,wrap:`nickel`,winding:`round`,note:33},D:{outer:.065*z,core:.028*z,wrap:`nickel`,winding:`round`,note:38},G:{outer:.045*z,core:.022*z,wrap:`nickel`,winding:`round`,note:43}},ua={short:30*z,medium:32*z,long:34*z,extra:35*z},da={E:{outer:.046*z,core:.018*z,wrap:`nickel`,winding:`round`,packing:.88,note:40},A:{outer:.036*z,core:.016*z,wrap:`nickel`,winding:`round`,packing:.88,note:45},D:{outer:.026*z,core:.012*z,wrap:`nickel`,winding:`round`,packing:.88,note:50},G:{outer:.017*z,core:.017*z,wrap:`steel`,winding:`plain`,note:55},B:{outer:.013*z,core:.013*z,wrap:`steel`,winding:`plain`,note:59},e:{outer:.01*z,core:.01*z,wrap:`steel`,winding:`plain`,note:64}},fa={'25.5"':25.5*z,'24.75"':24.75*z},pa=e=>440*2**((e-69)/12);function ma(e){return oa.steel.rho*(Math.PI/4)*e.core**2+oa[e.wrap].rho*(Math.PI/4)*(e.outer**2-e.core**2)*sa[e.winding].fill*(e.packing??1)}var ha=e=>oa.steel.E*(Math.PI*e.core**4)/64,ga=e=>oa.steel.E*(Math.PI/4)*e.core**2,_a=(e,t,n)=>ma(e)*(2*t*n)**2,va=(e,t,n)=>Math.sqrt(n/ma(e))/(2*t),ya=(e,t)=>e/2**(t/12),ba=(e,t,n)=>Math.PI**2*ha(e)/(n*t**2);function xa(e,t,n=.5){return n+sa[e].b2*t*t}function Sa(e,t,n,r,i=128){let a=va(e,t,n),o=ba(e,t,n),s=[];for(let t=1;t<=i;t++){let n=t*a*Math.sqrt(1+o*t*t);if(n>r)break;s.push({hz:n,sigma:xa(e.winding,n)})}return s}var Ca={width:.012,release:25e-5},wa={width:.0015,release:2e-5};function Ta(e,t,n){let r=Math.min(Math.max(n.position,.002),e-.002),i=[];for(let a=1;a<=t.length;a++){let o=a*Math.PI/e,s=2*n.height*e*e/(a*a*Math.PI*Math.PI*r*(e-r))*Math.sin(o*r),c=o*n.width/2,l=c<1e-9?1:Math.sin(c)/c,u=1/Math.sqrt(1+(2*Math.PI*t[a-1]*n.release)**2);i.push(s*l*u)}return i}function Ea(e,t,n,r=.01){let i=[];for(let a=1;a<=t;a++){let t=a*Math.PI/e,o=t*r/2;i.push(Math.sin(t*n)*(o<1e-9?1:Math.sin(o)/o))}return i}function Da(e,t,n){let r=Array(t).fill(0);for(let i of n)Ea(e,t,i.position).forEach((e,t)=>{r[t]+=i.gain*e});return r}function Oa(e,t,n,r){let i=[];for(let a=1;a<=t;a++)i.push(r*Math.sin(a*Math.PI*n/e)**2);return i}function ka(e){let t=69+12*Math.log2(e/440),n=Math.round(t);return{note:n,name:`${[`C`,`C#`,`D`,`D#`,`E`,`F`,`F#`,`G`,`G#`,`A`,`A#`,`B`][(n%12+12)%12]}${Math.floor(n/12)-1}`,cents:(t-n)*100}}function Aa(e){let t=ya(e.scale,e.fret),n=Sa(e.spec,t,e.tension,Math.min(12e3,.45*e.sampleRate)),r=n.length,i=Oa(t,r,Math.max(.005,t-.015),140).map(e=>e+30);return{length:t,hz:n.map(e=>e.hz),sigma:n.map(e=>e.sigma),pickup:typeof e.pickup==`number`?Ea(t,r,e.pickup):Da(t,r,e.pickup),strainK:n.map((e,n)=>((n+1)*Math.PI/t)**2/8),stretch:ga(e.spec)/e.tension,palm:Oa(t,r,e.palm.position,e.palm.amount*600),mute:i}}var ja=1,Ma=64,Na=2,Pa=48e3,Fa=6,Ia=class extends E{design;name;bendRange=Na;voices;frets;hand=3;held=[];bend=0;modWheelValue=0;pedal=!1;chorus={flange:0,depth:.5};latched=new Set;building=!0;noteListeners=new Set;performanceListeners=new Set;physicsListeners=new Set;pluckListeners=new Set;constructor(e,t){super(),this.design=t,this.name=e,this.frets=t.frets;let n=this.circuit;this.voices=t.strings.map((e,n)=>({name:e.name,node:`s${n+1}`,fret:0,length:t.scales[t.scale]})),n.add(`strings`,`gain`,{gain:1});for(let e of this.voices)n.add(e.node,`string`,{level:.5,tone:3500},{config:`{}`}).connect(e.node,`strings`);n.add(`pedalDry`,`gain`,{gain:1}).add(`odHp`,`filter`,{frequency:700,Q:.5},{type:`highpass`}).add(`odGain`,`gain`,{gain:1}).add(`odClip`,`waveshaper`,{},{curve:`soft`}).add(`odTone`,`filter`,{frequency:3e3,Q:.707},{type:`lowpass`}).add(`odLow`,`filter`,{frequency:700,Q:.5},{type:`lowpass`}).add(`odLevel`,`gain`,{gain:.4}).add(`odWet`,`gain`,{gain:0}).connect(`strings`,`pedalDry`).connect(`strings`,`odHp`).connect(`odHp`,`odGain`).connect(`odGain`,`odClip`).connect(`odClip`,`odTone`).connect(`odTone`,`odLevel`).connect(`strings`,`odLow`).connect(`odLow`,`odLevel`).connect(`odLevel`,`odWet`),n.add(`chIn`,`gain`,{gain:1}).add(`chDry`,`gain`,{gain:1}).add(`chHp`,`filter`,{frequency:t.chorusLowCut,Q:.5},{type:`highpass`}).add(`chLine`,`delay`,{delayTime:.007,maxTime:.03}).add(`chLfo`,`oscillator`,{frequency:.8,detune:0},{waveform:`sine`}).add(`chDepth`,`gain`,{gain:.0015}).add(`chRegen`,`gain`,{gain:0}).add(`chWet`,`gain`,{gain:0}).connect(`pedalDry`,`chIn`).connect(`odWet`,`chIn`).connect(`chIn`,`chDry`).connect(`chIn`,`chHp`).connect(`chHp`,`chLine`).connect(`chLine`,`chRegen`).connect(`chRegen`,`chLine`).connect(`chLine`,`chWet`).connect(`chLfo`,`chDepth`).connect(`chDepth`,`chLine`,`delayTime`);let r=t.toneStack;n.add(`ampIn`,`gain`,{gain:1}).add(`ampDrive`,`waveshaper`,{},{curve:`tube`}).add(`ampPost`,`gain`,{gain:1}).add(`ampBass`,`filter`,{frequency:r.bass,Q:.707,gain:0},{type:`lowshelf`}).add(`ampMid`,`filter`,{frequency:r.mid,Q:.8,gain:0},{type:`peaking`}).add(`ampTreble`,`filter`,{frequency:r.treble,Q:.707,gain:0},{type:`highshelf`}).add(`cabHp`,`filter`,{frequency:55,Q:1.1},{type:`highpass`}).add(`cabBump`,`filter`,{frequency:90,Q:1.2,gain:2},{type:`peaking`}).add(`cabCone`,`filter`,{frequency:2e3,Q:1.5,gain:4},{type:`peaking`}).add(`cabLp1`,`filter`,{frequency:5e3,Q:.707},{type:`lowpass`}).add(`cabLp2`,`filter`,{frequency:5e3,Q:.707},{type:`lowpass`}).add(`cabMic`,`filter`,{frequency:3e3,Q:.707,gain:0},{type:`highshelf`}).add(`cabOut`,`gain`,{gain:.8}).add(`diOut`,`gain`,{gain:.6}).add(`master`,`gain`,{gain:.8}).connect(`chDry`,`ampIn`).connect(`chWet`,`ampIn`).connect(`ampIn`,`ampDrive`).connect(`ampDrive`,`ampPost`).connect(`ampPost`,`ampBass`).connect(`ampBass`,`ampMid`).connect(`ampMid`,`ampTreble`).connect(`ampTreble`,`cabHp`).connect(`cabHp`,`cabBump`).connect(`cabBump`,`cabCone`).connect(`cabCone`,`cabLp1`).connect(`cabLp1`,`cabLp2`).connect(`cabLp2`,`cabMic`).connect(`cabMic`,`cabOut`).connect(`cabOut`,`master`).connect(`strings`,`diOut`).connect(`diOut`,`master`),this.outputList.push({name:`out`,nodeId:`master`});let i=()=>this.reconfigureAll();this.choice(`string.wrap`,`Wrap`,[`nickel`,`stainless`,`steel`],`nickel`,i),this.choice(`string.winding`,`Winding`,ca,`round`,i),this.choice(`string.scale`,`Scale`,Object.keys(t.scales),t.scale,i),t.strings.forEach((e,n)=>{let r=_a(this.specFor(n,`nickel`,`round`),t.scales[t.scale],pa(e.gauge.note));this.num(`${e.name}.tension`,`${e.name} tension`,t.tension[0],t.tension[1],Math.round(r*10)/10,`N`,()=>this.reconfigure(n))}),this.num(`palm`,`Palm mute`,0,1,0,``,i),this.choice(`pluck.style`,`Pluck with`,[`finger`,`pick`],t.pluck.style,()=>void 0),this.num(`pluck.position`,`Pluck at`,.02,.4,t.pluck.position,`m`,()=>void 0),this.num(`pluck.strength`,`Strength`,0,1,.5,``,()=>void 0),this.num(`drive.mix`,`Drive`,0,1,0,``,e=>{n.setParam(`pedalDry`,`gain`,Math.cos(e*Math.PI/2)),n.setParam(`odWet`,`gain`,Math.sin(e*Math.PI/2))}),this.num(`drive.gain`,`Gain`,0,1,.4,``,e=>n.setParam(`odGain`,`gain`,2*30**e)),this.num(`drive.tone`,`Tone`,800,8e3,3e3,`Hz`,e=>n.setParam(`odTone`,`frequency`,e),`log`),this.num(`drive.level`,`Level`,0,1.5,.4,``,e=>n.setParam(`odLevel`,`gain`,e)),this.num(`chorus.mix`,`Chorus`,0,1,0,``,e=>{n.setParam(`chWet`,`gain`,.8*e),n.setParam(`chDry`,`gain`,1-.3*e)}),this.num(`chorus.flange`,`Flange`,0,1,0,``,e=>{this.chorus.flange=e,this.applyChorus()}),this.num(`chorus.rate`,`Rate`,.1,6,.8,`Hz`,e=>n.setParam(`chLfo`,`frequency`,e),`log`),this.num(`chorus.depth`,`Depth`,0,1,.5,``,e=>{this.chorus.depth=e,this.applyChorus()}),this.num(`amp.gain`,`Gain`,0,1,t.gain,``,e=>{let{pre:r,post:i}=t.drive(e);n.setParam(`ampIn`,`gain`,r),n.setParam(`ampPost`,`gain`,i)}),this.num(`amp.bass`,`Bass`,-12,12,0,`dB`,e=>n.setParam(`ampBass`,`gain`,e)),this.num(`amp.mid`,`Mid`,-12,12,0,`dB`,e=>n.setParam(`ampMid`,`gain`,e)),this.num(`amp.treble`,`Treble`,-12,12,0,`dB`,e=>n.setParam(`ampTreble`,`gain`,e)),this.choice(`cab.type`,`Cabinet`,Object.keys(t.cabinets),t.cabinet,e=>this.applyCabinet(e)),this.choice(`cab.mic`,`Mic`,[`on-axis`,`off-axis`],`on-axis`,e=>n.setParam(`cabMic`,`gain`,e===`off-axis`?-8:0)),this.num(`cab.blend`,`DI / Cab`,0,1,t.blend,``,e=>{n.setParam(`diOut`,`gain`,Math.cos(e*Math.PI/2)),n.setParam(`cabOut`,`gain`,Math.sin(e*Math.PI/2))}),this.num(`level`,`Level`,0,1.5,t.level,``,e=>n.setParam(`master`,`gain`,e))}applyChorus(){let{flange:e,depth:t}=this.chorus;this.circuit.setParam(`chLine`,`delayTime`,.007-.0045*e),this.circuit.setParam(`chDepth`,`gain`,t*(.003-.001*e)),this.circuit.setParam(`chRegen`,`gain`,.6*e)}choice(e,t,n,r,i){this.controlList.push(new O(e,t,n,r,i))}num(e,t,n,r,i,a,o,s){this.controlList.push(new D(e,t,n,r,i,a,o,s))}ready(){this.building=!1,this.reconfigureAll()}pluckDelay(e){return 0}setTone(e){for(let t of this.voices)this.circuit.setParam(t.node,`tone`,e)}applyCabinet(e){let t=this.design.cabinets[e],n=this.circuit;n.setParam(`cabHp`,`frequency`,t.hp),n.setParam(`cabHp`,`Q`,t.hpQ),n.setParam(`cabBump`,`frequency`,t.bumpHz),n.setParam(`cabBump`,`gain`,t.bumpDb),n.setParam(`cabCone`,`frequency`,t.coneHz),n.setParam(`cabCone`,`gain`,t.coneDb),n.setParam(`cabCone`,`Q`,t.coneQ),n.setParam(`cabLp1`,`frequency`,t.top),n.setParam(`cabLp2`,`frequency`,t.top)}value(e){return this.control(e).value}specFor(e,t=this.value(`string.wrap`),n=this.value(`string.winding`)){let r=this.design.strings[e].gauge;return r.winding===`plain`?{outer:r.outer,core:r.core,wrap:r.wrap,winding:`plain`}:{outer:r.outer,core:r.core,wrap:t,winding:n,packing:r.packing}}spec(e){return this.specFor(e)}get scale(){return this.design.scales[this.value(`string.scale`)]}get palmAt(){return this.design.palmAt}tension(e){return this.value(`${this.voices[e].name}.tension`)*2**(2*this.bend*Na/12)}openNote(e){return ka(va(this.spec(e),this.scale,this.value(`${this.voices[e].name}.tension`))).note}get standardNotes(){return this.design.strings.map(e=>e.gauge.note)}readout(e){let t=this.spec(e),n=this.tension(e),r=this.voices[e],i=ya(this.scale,r.fret),a=va(t,this.scale,this.value(`${r.name}.tension`)),o=va(t,i,n)*Math.sqrt(1+ba(t,i,n));return{tension:n,mu:ma(t),speed:Math.sqrt(n/ma(t)),B:ba(t,i,n),open:{hz:a,...ka(a)},now:{hz:o,...ka(o)},length:i,fret:r.fret,wrap:oa[t.wrap].name,winding:sa[t.winding].name,gauge:t.outer}}tuneToStandard(){this.design.strings.forEach((e,t)=>{this.control(`${e.name}.tension`).set(Math.round(_a(this.spec(t),this.scale,pa(e.gauge.note))*10)/10)})}reconfigureAll(){for(let e=0;e<this.voices.length;e++)this.reconfigure(e)}reconfigure(e){if(this.building)return;let t=this.voices[e],n=Aa({spec:this.spec(e),scale:this.scale,tension:this.tension(e),fret:t.fret,pickup:this.pickup(e),palm:{position:this.design.palmAt,amount:this.value(`palm`)},sampleRate:Pa});t.length=n.length;let r={type:`configure`,...n};this.circuit.setOption(t.node,`config`,JSON.stringify(r)),this.circuit.send(t.node,r);for(let e of this.physicsListeners)e()}modeHz(e){return JSON.parse(this.circuit.node(this.voices[e].node).options.config).hz??[]}onPhysicsChange(e){return this.physicsListeners.add(e),()=>this.physicsListeners.delete(e)}setFret(e,t){let n=this.voices[e],r=Math.max(0,Math.min(this.frets,Math.round(t)));r!==n.fret&&(n.fret=r,r>0&&(this.hand=r),this.reconfigure(e))}pluck(e,t=this.value(`pluck.position`),n=this.value(`pluck.strength`),r=0){let i=this.voices[e],a=Math.min(Math.max(t,.01),i.length-.01),o=this.modeHz(e),s=this.value(`pluck.style`)===`pick`?wa:Ca,[c,l]=this.design.pluckHeight,u=c*(l/c)**+n,d=Ta(i.length,o,{position:a,height:u,...s}),f=Oa(i.length,o.length,a,.9).map(e=>1-e);this.circuit.send(i.node,{type:`mute`,on:!1}),this.circuit.send(i.node,r>0?{type:`pluck`,amps:d,grab:f,delay:r}:{type:`pluck`,amps:d,grab:f});for(let t of this.pluckListeners)t(e,a)}onPluck(e){return this.pluckListeners.add(e),()=>this.pluckListeners.delete(e)}release(e){this.circuit.send(this.voices[e].node,{type:`mute`,on:!0})}chooseString(e){let t,n=1/0;return this.voices.forEach((r,i)=>{let a=e-this.openNote(i);if(a<0||a>this.frets)return;let o=(a===0?.5:Math.abs(a-this.hand))+(r.note!==void 0&&r.note!==e?Fa:0);o<n&&(n=o,t=i)}),t}keyDown(e,t=96){let n=this.chooseString(e);if(n===void 0)return;let r=this.voices[n];r.note!==void 0&&r.note!==e&&(this.held=this.held.filter(e=>e!==r.note)),r.note=e,this.held=this.held.filter(t=>t!==e),this.held.push(e),this.latched.delete(e),this.setFret(n,e-this.openNote(n));let i=Math.min(1,Math.max(.05,this.value(`pluck.strength`)*t/96));t<=40?(this.pluck(n,void 0,i),this.circuit.send(r.node,{type:`mute`,on:!0,hard:!0})):this.pluck(n,void 0,i,this.pluckDelay(n)),this.notifyNotes()}keyUp(e){if(!this.held.includes(e))return;if(this.pedal){this.latched.add(e);return}this.held=this.held.filter(t=>t!==e);let t=this.voices.findIndex(t=>t.note===e);t>=0&&(this.voices[t].note=void 0,this.release(t)),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(this.design.bendDown?-1:0,e)),this.reconfigureAll(),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.control(`palm`).set(this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:if(e.controller===ja)this.setModWheel(e.value/127);else if(e.controller===Ma&&(this.pedal=e.value>=64,!this.pedal))for(let e of[...this.latched])this.latched.delete(e),this.keyUp(e)}}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}},La=[`E`,`A`,`D`,`G`],Ra={"4x10":{label:`4×10`,hp:55,hpQ:1.1,bumpHz:90,bumpDb:2,coneHz:2e3,coneDb:4,coneQ:1.5,top:5e3},"1x15":{label:`1×15`,hp:42,hpQ:1.3,bumpHz:70,bumpDb:3,coneHz:1200,coneDb:3,coneQ:1.2,top:2600},"8x10":{label:`8×10`,hp:38,hpQ:1,bumpHz:60,bumpDb:3.5,coneHz:1800,coneDb:3.5,coneQ:1.4,top:4500}},za=class extends Ia{constructor(e=`MOA-BASS`){super(e,{strings:La.map(e=>({name:e,gauge:la[e]})),frets:24,scales:ua,scale:`long`,tension:[40,400],pluckHeight:[3e-4,.006],palmAt:.03,pluck:{style:`finger`,position:.12},bendDown:!1,chorusLowCut:250,toneStack:{bass:100,mid:600,treble:2500},drive:e=>({pre:.4+e*4,post:1/(.4+e*2.2)}),gain:.3,cabinets:Ra,cabinet:`4x10`,blend:.6,level:.8}),this.num(`pickup.position`,`Pickup`,.03,.3,.15,`m`,()=>this.reconfigureAll()),this.num(`tone`,`Tone`,300,12e3,3500,`Hz`,e=>this.setTone(e),`log`),this.ready()}pickup(){return this.value(`pickup.position`)}pickups(){return[{position:this.pickup(),coils:1,on:!0}]}},Ba=[`E`,`A`,`D`,`G`,`B`,`e`],Va={"1x12":{label:`1×12`,hp:85,hpQ:1,bumpHz:120,bumpDb:2,coneHz:2500,coneDb:4,coneQ:1.4,top:5200},"2x12":{label:`2×12`,hp:75,hpQ:1.1,bumpHz:105,bumpDb:2.5,coneHz:2200,coneDb:4,coneQ:1.3,top:5e3},"4x12":{label:`4×12`,hp:65,hpQ:1.2,bumpHz:95,bumpDb:3.5,coneHz:2e3,coneDb:4.5,coneQ:1.2,top:4600}},Ha={neck:.16,middle:.1,bridge:.042},Ua=[`bridge`,`bridge+middle`,`middle`,`middle+neck`,`neck`],Wa=.018,Ga={single:5e3,humbucker:2700},Ka=1.3,qa=.7,Ja=40,Ya=class extends Ia{now=()=>performance.now();strum;wired=!1;constructor(e=`MOA-GUITAR`){super(e,{strings:Ba.map(e=>({name:e,gauge:da[e]})),frets:22,scales:fa,scale:`25.5"`,tension:[20,150],pluckHeight:[2e-4,.003],palmAt:.02,pluck:{style:`pick`,position:.09},bendDown:!0,chorusLowCut:120,toneStack:{bass:120,mid:750,treble:3e3},drive:e=>{let t=.15*70**e;return{pre:t,post:1/t+.42}},gain:.3,cabinets:Va,cabinet:`2x12`,blend:.85,level:.6});let t=()=>this.voicePickups();this.choice(`pickup.select`,`Pickups`,Ua,`bridge`,t),this.choice(`pickup.type`,`Type`,[`single`,`humbucker`],`single`,t),this.num(`tone`,`Tone`,0,10,10,``,t),this.choice(`strum`,`Strum`,[`off`,`down`,`up`],`down`,()=>void 0),this.num(`strum.time`,`Strum time`,2,40,10,`ms`,()=>void 0),this.wired=!0,this.voicePickups(),this.ready()}get selected(){return this.value(`pickup.select`).split(`+`)}get humbucker(){return this.value(`pickup.type`)===`humbucker`}voicePickups(){if(!this.wired)return;let e=this.selected.length>1,t=Ga[this.humbucker?`humbucker`:`single`]*(e?Ka:1);this.setTone(t*2**(-2.2*(10-this.value(`tone`))/10)),this.reconfigureAll()}pickup(e){let t=this.standardNotes,n=(pa(t[0])/pa(t[e]))**+qa,r=(this.selected.length>1?.6:1)*n;return this.selected.flatMap(e=>this.humbucker?[{position:Ha[e]-Wa/2,gain:.8*r},{position:Ha[e]+Wa/2,gain:.8*r}]:[{position:Ha[e],gain:r}])}pickups(){let e=this.selected;return Object.keys(Ha).map(t=>({position:Ha[t],coils:this.humbucker?2:1,on:e.includes(t)}))}pluckDelay(e){let t=this.value(`strum`);if(t===`off`)return 0;let n=this.now();if(!this.strum||n-this.strum.at>Ja)return this.strum={at:n,first:e},0;let r=t===`down`?e-this.strum.first:this.strum.first-e;return Math.max(0,r)*this.value(`strum.time`)/1e3}},Xa={rho:1.2,c:343},Za={rho:1390,E:45e8},B={rho:8600,E:105e9,nu:.34},V=.0254;function Qa(e,t){let n=Math.max(64,Math.ceil(2*(Math.abs(t)+e)+32)),r=0;for(let i=0;i<=n;i++){let a=Math.PI*i/n;r+=(i===0||i===n?.5:1)*Math.cos(e*a-t*Math.sin(a))}return r/n}var $a=new Map;function eo(e,t){let n=$a.get(e)??[];if(n.length>=t)return n.slice(0,t);let r=[...n],i=r.length?r[r.length-1]+.5:Math.max(.5,e),a=Qa(e,i);for(;r.length<t;){let t=i+.05,n=Qa(e,t);if(a*n<0){let n=i,o=t,s=a;for(let t=0;t<48;t++){let t=(n+o)/2,r=Qa(e,t);s*r<=0?o=t:(n=t,s=r)}r.push((n+o)/2)}i=t,a=n}return $a.set(e,r),r.slice(0,t)}var to={coated:{name:`Coated, one ply`,sigma:.4,thickness:254e-6,b2:3e-6},clear:{name:`Clear, one ply`,sigma:.353,thickness:254e-6,b2:15e-7},twoPly:{name:`Clear, two plies`,sigma:.495,thickness:356e-6,b2:9e-6}},no={kick:{diameter:22*V,depth:18*V,head:`twoPly`,striker:`beater`},snare:{diameter:14*V,depth:5.5*V,head:`coated`,striker:`stick`},tom:{diameter:12*V,depth:8*V,head:`coated`,striker:`stick`},floor:{diameter:16*V,depth:16*V,head:`coated`,striker:`stick`}},ro=[.15,.05,.02,.01],io=.2,ao=(e,t)=>2*Xa.rho*e/t,oo=(e,t,n)=>t===0?io*Xa.rho*Xa.c**2*(4/n**2)/e.depth:0;function so(e,t,n){let r=e.diameter/2,i=to[e.head],a=t/i.sigma,o=[];for(let t=0;t<40;t++)eo(t,16).forEach((n,s)=>{let c=i.sigma+ao(r,n),l=n*n*a/(r*r)*(i.sigma/c)+oo(e,t,n)/c,u=Math.sqrt(l)/(2*Math.PI),d=2*Math.PI*u/Xa.c*r,f=Xa.rho*Xa.c/c*(ro[t]??.005)*Math.min(1,d**(2*t+2));o.push({m:t,n:s+1,j:n,hz:u,sigma:1.5+i.b2*u*u+f})});return o.sort((e,t)=>e.hz-t.hz).slice(0,n)}function co(e,t){let n=e.diameter/2,r=to[e.head],i=eo(0,1)[0],a=r.sigma+ao(n,i);return((2*Math.PI*t)**2*a-oo(e,0,i))*n*n/(i*i)}var lo=(e,t)=>Qa(e.m,e.j*t),uo=e=>Qa(e.m+1,e.j)**2*(e.m===0?1:.5),fo={beater:.03,stick:.005,metal:.003};function po(e,t){let n=e*t;return n<1e-6?1:2*Qa(1,n)/n}function mo(e,t){return(e===`beater`?.003:e===`stick`?9e-4:3e-4)*Math.max(.05,t)**-.2}function ho(e,t){let n=2*e*t;return Math.abs(1-n)<1e-6?Math.PI/4:Math.cos(Math.PI*n/2)/(1-n*n)}function go(e,t,n){let[r,i]=e===`beater`?[.1,3]:[.05,5],a=.5+(i-.5)*n,o=t*.25;return 1.5*r*o*a/(r+o)}function _o(e,t,n){let r=e.diameter/2,i=Math.PI*r*r,a=go(e.striker,to[e.head].sigma*i,n.velocity);return t.map(t=>{let o=(to[e.head].sigma+ao(r,t.j))*i*uo(t);return a*lo(t,n.r)/o*ho(t.hz,n.contact)*po(t.j/r,fo[e.striker])})}function vo(e,t){return e.map(e=>t*160*lo(e,.9)**2/uo(e))}var yo=(e,t)=>Math.sqrt(1+(Xa.c/(2*Math.PI*e*t))**2);function bo(e,t,n){let r=e.diameter/2;return t.map(e=>{let t=2*Math.PI*e.hz,i=t/Xa.c*r;return t*t*yo(e.hz,n)*Math.min(1,i**e.m)*(e.m===0?1:.6)})}var xo=(e,t)=>t.map(t=>(t.j/(e.diameter/2))**2*uo(t)/4),So=.12,Co=(e,t)=>So*Za.E*to[e.head].thickness/t,wo={hat:{diameter:14*V,thickness:.0011,dome:1.1},crash:{diameter:18*V,thickness:9e-4,dome:1.6},ride:{diameter:21*V,thickness:.0014,dome:1.8}},To=e=>B.E*e**3/(12*(1-B.nu**2)),Eo=e=>Math.sqrt(B.E/(B.rho*(1-B.nu**2)))/(2*Math.PI*e.dome);function Do(e,t){let n=e.diameter/2,r=Math.sqrt(To(e.thickness)/(B.rho*e.thickness)),i=Eo(e),a=[];for(let e=0;e<90;e++)for(let t=0;t<45;t++){if(e+2*t<2)continue;let o=Math.PI/2*(e+2*t),s=o*o/(2*Math.PI*n*n)*r,c=t>0?Math.hypot(s,i):s;a.push({m:e,n:t,lambda:o,hz:c,sigma:.5+15e-5*c})}return a.sort((e,t)=>e.hz-t.hz).slice(0,t)}var Oo=(e,t)=>Qa(e.m,e.lambda*t);function ko(e,t,n){let r=e.diameter/2,i=B.rho*e.thickness*Math.PI*r*r,a=i*.25,o=go(`stick`,i,n.velocity);return t.map(e=>o*Oo(e,n.r)/a*ho(e.hz,n.contact)*po(e.lambda/r,fo.metal))}function Ao(e,t,n){let r=Math.sqrt(B.E/(B.rho*(1-B.nu**2))),i=Xa.c**2/(1.8*r*e.thickness);return t.map(e=>{let t=2*Math.PI*e.hz;return t*t*yo(e.hz,n)*Math.sqrt(Math.min(1,e.hz/i))})}var jo=44100,Mo={hat:{closed:{cut:`funk`,tune:0,decay:.2,level:1.6},open:{cut:`steady`,tune:0,decay:0,level:.85},pedal:{cut:`heavy`,tune:-1,decay:.06,level:1.1}},ride:{bow:{cut:`heavy`,tune:-3,decay:0,level:1.6},bell:{cut:`funk`,tune:4,decay:0,level:1.3}},crash:{hit:{cut:`steady`,tune:-2,decay:0,level:1}}},No=[`kick`,`snare`,`tom`,`floor`],Po=[`hat`,`crash`,`ride`],Fo=[...No,...Po],Io={kick:`Kick`,snare:`Snare`,tom:`Rack tom`,floor:`Floor tom`,hat:`Hi-hat`,crash:`Crash`,ride:`Ride`},Lo={kick:55,snare:210,tom:150,floor:95},Ro={kick:.6,snare:.2,tom:.1,floor:.15},zo={kick:90,snare:110,tom:110,floor:110,hat:220,crash:300,ride:300},Bo={kick:.15,snare:.3,tom:.4,floor:.4,hat:.6,crash:.85,ride:.6},Vo={kick:0,snare:.25,tom:-.05,floor:-.4,hat:.5,crash:.6,ride:-.6},Ho={kick:.15,snare:.1,tom:.1,floor:.1,hat:.6,crash:.8,ride:.8},Uo={kick:.02,snare:.00254,tom:.00172,floor:96e-5,hat:.04,crash:.019,ride:.036},Wo={kick:1,snare:1,tom:1,floor:1,hat:.5,crash:.5,ride:.6},Go={thin:.8,medium:1,heavy:1.25},Ko={hat:150,crash:1500,ride:150},qo={hat:1,crash:.65,ride:1},Jo={hat:.5,crash:1.4,ride:.5},Yo=260,Xo={hat:.15,ride:.45,crash:.9},Zo={hat:[Mo.hat.closed,Mo.hat.open,Mo.hat.pedal],ride:[Mo.ride.bow,Mo.ride.bell],crash:[Mo.crash.hit]},Qo={35:{piece:`kick`},36:{piece:`kick`},37:{piece:`snare`,at:.97},38:{piece:`snare`},40:{piece:`snare`,at:.1},41:{piece:`floor`},43:{piece:`floor`},45:{piece:`tom`,at:.55},47:{piece:`tom`},48:{piece:`tom`},50:{piece:`tom`,at:.25},42:{piece:`hat`,hat:`closed`},44:{piece:`hat`,hat:`pedal`},46:{piece:`hat`,hat:`open`},49:{piece:`crash`},52:{piece:`crash`},55:{piece:`crash`,at:.7},57:{piece:`crash`},51:{piece:`ride`},59:{piece:`ride`},53:{piece:`ride`,at:.12}},$o=e=>No.includes(e),es=e=>`${e}.s`,ts=class extends E{name;hatOpen=0;building=!0;modes=new Map;strikes=new Map;hitListeners=new Set;physicsListeners=new Set;cuts=new Map;constructor(e=`MOA-KIT`){super(),this.name=e;let t=this.circuit;t.add(`kit`,`gain`,{gain:1});for(let e of Fo)t.add(e,`drum`,{level:1},{config:`{}`}).add(`${e}.pan`,`pan`,{pan:Vo[e]}).connect(e,`${e}.pan`).connect(`${e}.pan`,`kit`);t.add(`tailHp`,`filter`,{frequency:1200,Q:.707},{type:`highpass`}).add(`tail`,`convolver`,{},{size:`medium`}).connect(`tailHp`,`tail`).connect(`tail`,`kit`);for(let e of Po)t.add(es(e),`sampler`,{level:1}).add(`${e}.tail`,`gain`,{gain:Xo[e]}).connect(es(e),`kit`).connect(es(e),`${e}.tail`).connect(`${e}.tail`,`tailHp`);t.onReady(e=>{let t=Po.find(t=>es(t)===e);t&&this.sendCymbal(t)}),t.add(`master`,`gain`,{gain:.8}).connect(`kit`,`master`),this.outputList.push({name:`out`,nodeId:`master`});let n=(e,t,n,r,i,a,o,s)=>this.controlList.push(new D(e,t,n,r,i,a,o,s)),r=(e,t,n,r,i)=>this.controlList.push(new O(e,t,n,r,i));for(let e of No){let t=Math.round(co(no[e],Lo[e]));n(`${e}.tension`,`${Io[e]} tension`,200,9e3,t,`N/m`,()=>this.reconfigure(e),`log`),n(`${e}.muffle`,`${Io[e]} muffling`,0,1,Ro[e],``,()=>this.reconfigure(e))}n(`snare.wires`,`Snare wires`,0,1,.4,``,()=>this.reconfigure(`snare`)),r(`snare.on`,`Snares`,[`on`,`off`],`on`,()=>this.reconfigure(`snare`));for(let e of Po)r(`${e}.weight`,Io[e],Object.keys(Go),`medium`,()=>this.reconfigure(e));n(`hat.open`,`Hi-hat open`,0,1,0,``,e=>this.setHat(e)),n(`strength`,`Strength`,0,1,.7,``,()=>void 0),r(`cymbals.source`,`Cymbals`,[`samples`,`model`],`samples`,()=>this.setLevels()),n(`cymbals.layer`,`Model under`,0,1,0,``,()=>this.setLevels()),n(`cymbals.tail`,`Tail`,0,1.5,1,``,e=>{for(let n of Po)t.setParam(`${n}.tail`,`gain`,Xo[n]*e)});for(let e of Fo)n(`${e}.level`,`${Io[e]} level`,0,2,1,``,()=>this.setLevels());n(`level`,`Level`,0,1.5,.6,``,e=>t.setParam(`master`,`gain`,e)),this.building=!1;for(let e of Fo)this.reconfigure(e);this.setHat(this.hatOpen),this.setLevels()}get sampledCymbals(){return this.value(`cymbals.source`)===`samples`}setLevels(){if(!this.building)for(let e of Fo){let t=this.value(`${e}.level`);if($o(e)){this.circuit.setParam(e,`level`,t);continue}let n=this.sampledCymbals;this.circuit.setParam(e,`level`,n?t*this.value(`cymbals.layer`):t),this.circuit.setParam(es(e),`level`,n?t:0)}}loadCymbals(e){for(let[t,n]of Object.entries(e))this.cuts.set(t,n);for(let e of Po)this.sendCymbal(e)}sendCymbal(e){let t=es(e);for(let[e,n]of this.cuts)this.circuit.send(t,{type:`sample`,id:e,rate:jo,channels:[n]});Zo[e].forEach((n,r)=>{let i={sample:n.cut,start:0,end:this.cuts.get(n.cut)?.length??0,tune:n.tune,level:n.level,pan:Vo[e],attack:.001,decay:n.decay>0?n.decay:8,mode:`oneshot`,group:+(e===`hat`),velLevel:.8,velFilter:.3,cutoff:2e4};this.circuit.send(t,{type:`pad`,pad:r,settings:i})})}hitSample(e,t,n,r,i=!1){let a={type:`hit`,pad:e===`hat`?i?2:this.hatOpen<.5?0:1:+(e===`ride`&&n<.25),velocity:t};r>0&&(a.delay=r),this.circuit.send(es(e),a)}value(e){return this.control(e).value}drumSpec(e){return no[e]}cymbalSpec(e){let t=wo[e];return{...t,thickness:t.thickness*Go[this.value(`${e}.weight`)]}}pieceModes(e){return this.modes.get(e)??[]}readout(e){let t=this.pieceModes(e);if($o(e)){let n=this.drumSpec(e),r=this.value(`${e}.tension`),i=to[n.head],a=t[0].hz;return{kind:`drum`,diameter:n.diameter,depth:n.depth,head:i.name,tension:r,speed:Math.sqrt(r/i.sigma),sigma:i.sigma,fundamental:{hz:a,...ka(a)},ratio11:(t.find(e=>e.m===1)?.hz??a)/a,ring:6.9/t[0].sigma,modes:t.length,top:t.at(-1).hz}}let n=this.cymbalSpec(e),r=t.find(e=>e.hz>150)??t[0];return{kind:`cymbal`,diameter:n.diameter,thickness:n.thickness,bending:To(n.thickness),mass:B.rho*n.thickness*Math.PI*(n.diameter/2)**2,fundamental:{hz:r.hz,...ka(r.hz)},ring:6.9/r.sigma,modes:t.length,top:t.at(-1).hz}}reconfigure(e){if(this.building)return;this.strikes.clear();let t;if($o(e)){let n=this.drumSpec(e),r=this.value(`${e}.tension`),i=so(n,r,zo[e]);this.modes.set(e,i);let a=vo(i,this.value(`${e}.muffle`));if(t={hz:i.map(e=>e.hz),sigma:i.map((e,t)=>e.sigma+a[t]),mic:bo(n,i,Ho[e]).map(t=>t*Uo[e]*.001),strainK:xo(n,i),stretch:Co(n,r)},e===`snare`&&this.value(`snare.on`)===`on`){let e=this.value(`snare.wires`);t.wires={weights:i.map(e=>e.m<=1?.33*(2*Math.PI*e.hz)**2*lo(e,.45):0),threshold:60+900*e,gain:.25,hz:5200}}}else{let n=this.cymbalSpec(e),r=Do(n,zo[e]);this.modes.set(e,r);let i=[0,500,1e3,2e3,4e3,8e3],a=[...i.map(e=>{let t=r.findIndex(t=>t.hz>=e);return t<0?r.length:t}),r.length],o=i.map(e=>(2*Math.PI*Math.max(250,e)*n.thickness)**2);t={hz:r.map(e=>e.hz),sigma:r.map(t=>t.sigma*qo[e]),mic:Ao(n,r,Ho[e]).map(t=>t*Uo[e]*.001),dampK:r.map(e=>1+e.hz/2e3),cascade:{edges:a,refs:o,rate:Ko[e]},band:{hz:r.at(-1).hz,gain:Jo[e]}},e===`hat`&&(t.damp=this.hatDamp())}let n={type:`configure`,...t};this.circuit.setOption(e,`config`,JSON.stringify(n)),this.circuit.send(e,n);for(let e of this.physicsListeners)e()}onPhysicsChange(e){return this.physicsListeners.add(e),()=>this.physicsListeners.delete(e)}strikeVelocities(e,t,n){let r=`${e}/${t.toFixed(2)}/${n.toFixed(2)}`,i=this.strikes.get(r);if(!i){let a={r:t,velocity:n,contact:mo($o(e)?no[e].striker:`metal`,n)};i=$o(e)?_o(this.drumSpec(e),this.modes.get(e),a):ko(this.cymbalSpec(e),this.modes.get(e),a),this.strikes.size>600&&this.strikes.clear(),this.strikes.set(r,i)}return i}hit(e,t,n=Bo[e],r=0){let i=Math.min(1,Math.max(.02,t)),a=Math.min(.97,Math.max(0,n));if(!$o(e)&&this.sampledCymbals){this.hitSample(e,i,a,r);for(let t of this.hitListeners)t(e,i,a);if(this.value(`cymbals.layer`)===0)return}let o=this.strikeVelocities(e,a,Math.round(i*50)/50),s=$o(e)?no[e].striker:`metal`,c=mo(s,i),l=$o(e)?to[no[e].head].sigma*Math.PI*(no[e].diameter/2)**2:1,u={type:`hit`,v:o,click:go(s===`beater`?`beater`:`stick`,l,i)*Wo[e],tau:c};e===`hat`&&this.hatOpen<.3&&(u.burst=.05*i,u.burstDecay=.012),r>0&&(u.delay=r),this.circuit.send(e,u);for(let t of this.hitListeners)t(e,i,a)}setHat(e){this.hatOpen=Math.min(1,Math.max(0,e));let t=this.hatDamp(),n=JSON.parse(this.circuit.node(`hat`).options.config);n.hz&&this.circuit.setOption(`hat`,`config`,JSON.stringify({...n,damp:t})),this.circuit.send(`hat`,{type:`damp`,...t})}hatDamp(){let e=Math.max(0,1-this.hatOpen/.5),t=this.hatOpen>.05&&this.hatOpen<.5;return{sigma:Yo*e*e,contact:t?4*this.hatOpen*e:0}}hatPedal(e){this.setHat(0),this.sampledCymbals&&this.hitSample(`hat`,e,0,0,!0),this.circuit.send(`hat`,{type:`hit`,v:[],click:0,tau:.001,burst:.08*e,burstDecay:.02});for(let t of this.hitListeners)t(`hat`,e,0)}onHit(e){return this.hitListeners.add(e),()=>this.hitListeners.delete(e)}handleMidi(e){if(e.type!==`noteOn`)return;let t=Qo[e.note];if(!t)return;let n=e.velocity/127;if(t.hat===`pedal`)return this.hatPedal(n);t.hat===`closed`&&this.setHat(0),t.hat===`open`&&this.setHat(1),this.hit(t.piece,n,t.at)}};function ns(e,t=16){let n=Array.from({length:t},()=>[]);for(let[r,i]of Object.entries(e))[...i.replace(/ /g,``)].forEach((e,i)=>{e!==`.`&&i<t&&n[i].push([r,e===`x`?1:.55])});return n}var rs={rock:{name:`Rock`,steps:16,pattern:ns({kick:`x... .... x.x. ....`,snare:`.... x... .... x...`,hat:`x.o. x.o. x.o. x.o.`})},pop:{name:`Pop`,steps:16,pattern:ns({kick:`x... ..x. x... ....`,clap:`.... x... .... x...`,hat:`.ox. .ox. .ox. .ox.`})},waltz:{name:`Waltz`,steps:12,pattern:ns({kick:`x... .... ....`,hat:`.... x... x...`,wood:`.... o... o...`},12)},march:{name:`March`,steps:16,pattern:ns({kick:`x... .... x... ....`,snare:`.... x.o. .... x.oo`,wood:`o... o... o... o...`})},disco:{name:`Disco`,steps:16,pattern:ns({kick:`x... x... x... x...`,clap:`.... x... .... x...`,hat:`..x. ..x. ..x. ..x.`,bell:`.... .... .... ..o.`})}},is=Object.keys(rs),H=60,U=62,W=64,G=65,K=67,as=69,os=71,ss=Object.keys({mikkel:{name:`Mikkel Rev`,notes:[[66,1],[69,1],[62,2],[66,1],[69,1],[62,2],[67,1],[71,1],[74,1],[71,1],[71,2],[69,2],[66,1],[69,1],[62,2],[66,1],[69,1],[62,2],[64,1],[66,1],[67,1],[61,1],[64,2],[62,2]]},twinkle:{name:`Twinkle Twinkle`,notes:[[H,1],[H,1],[K,1],[K,1],[as,1],[as,1],[K,2],[G,1],[G,1],[W,1],[W,1],[U,1],[U,1],[H,2],[K,1],[K,1],[G,1],[G,1],[W,1],[W,1],[U,2],[K,1],[K,1],[G,1],[G,1],[W,1],[W,1],[U,2],[H,1],[H,1],[K,1],[K,1],[as,1],[as,1],[K,2],[G,1],[G,1],[W,1],[W,1],[U,1],[U,1],[H,2]]},lamb:{name:`Mary Had a Little Lamb`,notes:[[W,1],[U,1],[H,1],[U,1],[W,1],[W,1],[W,2],[U,1],[U,1],[U,2],[W,1],[K,1],[K,2],[W,1],[U,1],[H,1],[U,1],[W,1],[W,1],[W,1],[W,1],[U,1],[U,1],[W,1],[U,1],[H,4]]},joy:{name:`Ode to Joy`,notes:[[W,1],[W,1],[G,1],[K,1],[K,1],[G,1],[W,1],[U,1],[H,1],[H,1],[U,1],[W,1],[W,1.5],[U,.5],[U,2],[W,1],[W,1],[G,1],[K,1],[K,1],[G,1],[W,1],[U,1],[H,1],[H,1],[U,1],[W,1],[U,1.5],[H,.5],[H,2]]},farm:{name:`Old MacDonald`,notes:[[K,1],[K,1],[K,1],[U,1],[W,1],[W,1],[U,2],[os,1],[os,1],[as,1],[as,1],[K,3],[U,1],[K,1],[K,1],[K,1],[U,1],[W,1],[W,1],[U,2],[os,1],[os,1],[as,1],[as,1],[K,3]]},bells:{name:`Jingle Bells`,notes:[[W,1],[W,1],[W,2],[W,1],[W,1],[W,2],[W,1],[K,1],[H,1.5],[U,.5],[W,4],[G,1],[G,1],[G,1.5],[G,.5],[G,1],[W,1],[W,1],[W,.5],[W,.5],[W,1],[U,1],[U,1],[W,1],[U,2],[K,2],[W,1],[W,1],[W,2],[W,1],[W,1],[W,2],[W,1],[K,1],[H,1.5],[U,.5],[W,4],[G,1],[G,1],[G,1.5],[G,.5],[G,1],[W,1],[W,1],[W,.5],[W,.5],[K,1],[K,1],[G,1],[U,1],[H,4]]}}),q=e=>({w1:`square`,w2:`square`,i2:12,mix2:0,a:.005,d:.3,s:.6,r:.2,vib:0,vibRate:5.5,vibDelay:.3,gain:1,...e}),cs=[{name:`Piano`,label:`Piano`,icon:`🎹`,magic:4500,sparkle:.1,sound:q({w1:`pulse25`,w2:`square`,i2:12,mix2:.3,a:.002,d:.9,s:0,r:.25})},{name:`Organ`,label:`Orgel`,icon:`🎶`,magic:6e3,sparkle:.05,sound:q({w1:`square`,w2:`square`,i2:12,mix2:.5,a:.005,d:.1,s:1,r:.08,gain:.8})},{name:`Flute`,label:`Fløyte`,icon:`🌬️`,magic:3e3,sparkle:.1,sound:q({w1:`sine`,w2:`triangle`,i2:12,mix2:.15,a:.06,d:.3,s:.9,r:.15,vib:12,vibDelay:.35,gain:1.3})},{name:`Trumpet`,label:`Trompet`,icon:`🎺`,magic:2500,sparkle:.3,sound:q({w1:`saw`,w2:`pulse25`,i2:0,mix2:.3,a:.04,d:.2,s:.8,r:.1,vib:10,gain:.8})},{name:`Violin`,label:`Fiolin`,icon:`🎻`,magic:3500,sparkle:.15,sound:q({w1:`saw`,w2:`saw`,i2:.08,mix2:.5,a:.12,d:.3,s:1,r:.3,vib:18,vibDelay:.4,gain:.8})},{name:`Bells`,label:`Bjeller`,icon:`🔔`,magic:8e3,sparkle:.1,sound:q({w1:`sine`,w2:`sine`,i2:19,mix2:.4,a:.001,d:1.5,s:0,r:1.2,gain:1.3})},{name:`Robot`,label:`Robot`,icon:`🤖`,magic:1200,sparkle:.85,sound:q({w1:`pulse12`,w2:`square`,i2:-12,mix2:.5,a:.001,d:.2,s:.7,r:.05,vib:60,vibRate:9,vibDelay:0})},{name:`Kitty`,label:`Pusekatt`,icon:`🐱`,magic:2e3,sparkle:.7,sound:q({w1:`triangle`,w2:`pulse25`,i2:12,mix2:.25,a:.02,d:.4,s:.3,r:.3,vib:40,vibRate:7,vibDelay:.1,gain:1.2})},{name:`Space`,label:`Romskip`,icon:`🚀`,magic:1500,sparkle:.6,sound:q({w1:`saw`,w2:`square`,i2:7,mix2:.5,a:.3,d:1,s:.7,r:1.5,vib:8,gain:.8})},{name:`Elephant`,label:`Elefant`,icon:`🐘`,magic:900,sparkle:.3,sound:q({w1:`square`,w2:`saw`,i2:-12,mix2:.6,a:.005,d:.3,s:.6,r:.1})}],ls=4,us=1,ds=15,fs=class extends E{name;transport;held=new Map;noteListeners=new Set;changeListeners=new Set;built=this.circuit.add(`voices`,`tone`,{level:.7},{role:`voices`,preset:JSON.stringify(cs[0].sound)}).add(`filter`,`ladder`,{cutoff:4500,detune:0,res:.1,drive:.15}).add(`drums`,`tone`,{level:.6},{role:`drums`,preset:`{}`}).add(`out`,`gain`,{gain:.8}).add(`meter`,`meter`,{},{channel:`mono`}).connect(`voices`,`filter`).connect(`filter`,`out`).connect(`drums`,`out`).connect(`out`,`meter`);preset=this.choice(`uni.preset`,`Sound`,cs.map(e=>e.name),`Piano`,()=>this.loadSound(!0));magic=this.num(`uni.magic`,`Magic`,150,12e3,4500,`Hz`,e=>this.circuit.setParam(`filter`,`cutoff`,e),`log`);sparkle=this.num(`uni.sparkle`,`Sparkle`,0,.95,.1,``,e=>this.circuit.setParam(`filter`,`res`,e));volume=this.num(`uni.volume`,`Volume`,0,1,.8,``,e=>this.circuit.setParam(`out`,`gain`,e));vibrato=this.toggle(`uni.vibrato`,`Vibrato`,!1,()=>this.loadSound(!1));sustain=this.toggle(`uni.sustain`,`Sustain`,!1,()=>this.loadSound(!1));octave=this.choice(`uni.octave`,`Octave`,[`-1`,`0`,`+1`],`0`,()=>this.notifyChange());rhythm=this.choice(`uni.rhythm`,`Rhythm`,[`off`,...is],`off`,()=>this.notifyChange());tempo=this.num(`uni.tempo`,`Tempo`,50,200,110,`BPM`,()=>this.notifyChange());beatLevel=this.num(`uni.beat`,`Drums`,0,1,.7,``,e=>this.circuit.setParam(`drums`,`level`,e));song=this.choice(`uni.song`,`Song`,[`off`,...ss],`off`,()=>this.notifyChange());constructor(e,t=`MOA-UNICORN`){super(),this.name=t,this.transport=new An(e),this.transport.channel.set(`omni`),this.controlList.push(this.transport.channel),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out`,nodeId:`meter`})}get currentPreset(){return cs.find(e=>e.name===this.preset.value)??cs[0]}get sound(){let e={...this.currentPreset.sound};return this.sustain.value&&(e.r=Math.max(us,e.r*ls)),this.vibrato.value&&e.vib===0&&(e.vib=ds),e}loadSound(e){if(!this.sustain||!this.vibrato)return;let t=this.sound;this.circuit.node(`voices`).options.preset=JSON.stringify(t),this.circuit.send(`voices`,{type:`preset`,preset:t}),e&&(this.magic.set(this.currentPreset.magic),this.sparkle.set(this.currentPreset.sparkle)),this.notifyChange()}get shift(){return 12*Number(this.octave.value)}keyDown(e,t=.8,n,r){let i=(r??e)+this.shift;if(!(i<0||i>127)){this.held.has(e)&&this.keyUp(e,n),this.held.set(e,i),this.circuit.send(`voices`,{type:`on`,note:i,velocity:t,when:n});for(let e of this.noteListeners)e(i,!0)}}keyUp(e,t){let n=this.held.get(e);if(n!==void 0){this.held.delete(e),this.circuit.send(`voices`,{type:`off`,note:n,when:t});for(let e of this.noteListeners)e(n,!1)}}playNote(e,t,n,r=.8){this.circuit.send(`voices`,{type:`on`,note:e+this.shift,velocity:r,when:t}),this.circuit.send(`voices`,{type:`off`,note:e+this.shift,when:t+n})}drum(e,t,n){this.circuit.send(`drums`,{type:`drum`,kind:e,velocity:t,when:n})}allOff(){for(let e of[...this.held.keys()])this.keyUp(e);this.circuit.send(`voices`,{type:`allOff`})}get heldKeys(){return[...this.held.keys()]}handleMidi(e){e.type!==`noteOn`&&e.type!==`noteOff`||!this.transport.acceptsChannel(e.channel)||(e.type===`noteOn`&&e.velocity>0?this.keyDown(e.note,e.velocity/127):this.keyUp(e.note))}onNote(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}onChange(e){return this.changeListeners.add(e),()=>this.changeListeners.delete(e)}notifyChange(){for(let e of this.changeListeners)e()}num(...e){let t=new D(...e);return this.controlList.push(t),t}choice(...e){let t=new O(...e);return this.controlList.push(t),t}toggle(...e){let t=new k(...e);return this.controlList.push(t),t}},ps={lips:41,teeth:40,alveolar:36,postalveolar:33.5,palatal:30,velar:22},ms=e=>({velum:.01,voiced:!0,noise:0,aspirate:0,dur:.06,...e}),hs=(e,t)=>t?[ms({index:ps[e],diameter:0,voicing:.15,dur:.06})]:[ms({index:ps[e],diameter:0,voiced:!1,dur:.07}),ms({index:-1,diameter:0,voiced:!1,aspirate:.8,dur:.07})],gs=e=>[ms({index:ps[e],diameter:0,velum:.4,dur:.08})],_s=(e,t,n,r,i)=>[ms({index:ps[e],diameter:t,voiced:n,noise:r,lips:i,dur:n?.09:.11})],vs=(e,t,n,r)=>[ms({index:ps[e],diameter:t,lips:r,dur:n})],ys={b:hs(`lips`,!0),p:hs(`lips`,!1),d:hs(`alveolar`,!0),t:hs(`alveolar`,!1),g:hs(`velar`,!0),k:hs(`velar`,!1),m:gs(`lips`),n:gs(`alveolar`),ng:gs(`velar`),f:_s(`teeth`,.15,!1,1.3),v:_s(`teeth`,.15,!0,.9),s:_s(`alveolar`,.12,!1,.58),z:_s(`alveolar`,.12,!0,.5),sh:_s(`postalveolar`,.25,!1,2,.9),l:vs(`alveolar`,.15,.07),r:vs(`palatal`,.6,.09,.8),w:vs(`velar`,.8,.09,.35),y:vs(`palatal`,.5,.08),h:[ms({index:-1,diameter:0,voiced:!1,aspirate:1,dur:.07})]},bs={ah:26.5,ee:26,oo:35.5,eh:25,oh:34,uh:32.5,ae:31.5,ih:25.5},xs={ah:26.5,ee:36.5,oo:33.5,eh:34.5,oh:34,uh:33.5,ae:27,ih:27.5},Ss={d:bs,t:bs,n:bs,g:xs,k:xs,ng:xs},Cs={oo:{tongueIndex:25,tongueDiameter:2.25,lips:.5},oh:{tongueIndex:19,tongueDiameter:2.4,lips:.7},ah:{tongueIndex:11,tongueDiameter:2.25,lips:1.5},eh:{tongueIndex:28,tongueDiameter:3.3,lips:1.3},ee:{tongueIndex:35.5,tongueDiameter:2.5,lips:.7},uh:{tongueIndex:20,tongueDiameter:3,lips:1.2},ae:{tongueIndex:19.5,tongueDiameter:2.75,lips:1.4},ih:{tongueIndex:31.75,tongueDiameter:2.9,lips:1}},ws=[[`ooh`,`oo`],[`aah`,`ah`],[`oo`,`oo`],[`ee`,`ee`],[`aa`,`ah`],[`ah`,`ah`],[`eh`,`eh`],[`oh`,`oh`],[`uh`,`uh`],[`ae`,`ae`],[`ih`,`ih`],[`ay`,`eh`,`ee`],[`ai`,`ah`,`ee`],[`oy`,`oh`,`ee`],[`ow`,`ah`,`oo`],[`a`,`ah`],[`e`,`eh`],[`i`,`ee`],[`o`,`oh`],[`u`,`oo`]],Ts=Object.keys(ys).sort((e,t)=>t.length-e.length);function Es(e){let t=e.toLowerCase().replace(/[^a-z]/g,``),n=[];for(let e=0;e<t.length;){if(t[e]===`y`&&e===t.length-1&&n.at(-1)?.kind===`c`){n.push({kind:`v`,spelled:`y`,vowel:`ee`}),e++;continue}let r=ws.find(([n])=>t.startsWith(n,e));if(r&&t[e]!==`y`){n.push({kind:`v`,spelled:r[0],vowel:r[1],vowel2:r[2]}),e+=r[0].length;continue}let i=Ts.find(n=>t.startsWith(n,e));i?(n.push({kind:`c`,spelled:i}),e+=i.length):e++}return n}var Ds=(e,t)=>[`r`,`l`,`w`,`y`].includes(t)&&[`b`,`p`,`d`,`t`,`g`,`k`,`f`,`sh`].includes(e)||e===`s`&&[`t`,`p`,`k`,`m`,`n`,`l`,`w`].includes(t);function Os(e){let t=Es(e),n=t.map((e,t)=>e.kind===`v`?t:-1).filter(e=>e>=0);if(n.length<2)return[e];let r=[];for(let e=1;e<n.length;e++){let i=n[e]-n[e-1]-1,a=n[e];i<=1?r.push(a-i):r.push(Ds(t[a-2].spelled,t[a-1].spelled)?a-2:a-1)}let i=[],a=0;for(let e of[...r,t.length])i.push(t.slice(a,e).map(e=>e.spelled).join(``)),a=e;return i}function ks(e){let t=Es(e),n=t.findIndex(e=>e.kind===`v`),r=(n<0?t:t.slice(0,n)).map(e=>e.spelled),i=[];for(let e of n<0?[]:t.slice(n+1))e.kind===`c`&&i.at(-1)!==e.spelled&&i.push(e.spelled);let a=(e,t)=>e.flatMap(e=>ys[e].map(n=>{let r=t&&n.index>=0?Ss[e]?.[t]:void 0;return r===void 0?{...n}:{...n,index:r}}));if(n<0){let t=r.find(e=>[`m`,`n`,`ng`,`s`,`sh`,`f`,`z`,`v`].includes(e));return t?{text:e,onset:[{...ys[t].at(-1),dur:1/0}],vowel:t===`m`?`uh`:`eh`,coda:[]}:{text:e,onset:a(r),vowel:`ah`,coda:[]}}let o=t[n],s={a:`ae`,i:`ih`,u:`uh`},c=i.length&&s[o.spelled]?s[o.spelled]:o.vowel;return{text:e,onset:a(r,c),vowel:c,vowel2:o.vowel2,coda:a(i,o.vowel2??c)}}function As(e){return e.split(/[\s\-]+/).flatMap(e=>/^_+$/.test(e)?[...e].map(()=>({text:`_`,onset:[],vowel:`ah`,coda:[],hold:!0})):/[a-z]/i.test(e)?Os(e).map(ks):[])}var js=1,Ms=2,Ns=11,Ps=74,Fs=2,Is=[{name:`oo`,formants:[300,870],shape:{tongueIndex:25,tongueDiameter:2.25,lips:.5}},{name:`oh`,formants:[500,850],shape:{tongueIndex:19,tongueDiameter:2.4,lips:.7}},{name:`ah`,formants:[730,1090],shape:{tongueIndex:11,tongueDiameter:2.25,lips:1.5}},{name:`eh`,formants:[530,1840],shape:{tongueIndex:28,tongueDiameter:3.3,lips:1.3}},{name:`ee`,formants:[270,2290],shape:{tongueIndex:35.5,tongueDiameter:2.5,lips:.7}}];function Ls(e,t){let n=Math.max(0,Math.min(Is.length-1,e)),r=Is[Math.floor(n)].shape,i=Is[Math.min(Is.length-1,Math.floor(n)+1)].shape,a=n-Math.floor(n),o=(e,t)=>e+(t-e)*a;return{tongueIndex:o(r.tongueIndex,i.tongueIndex),tongueDiameter:o(r.tongueDiameter,i.tongueDiameter),lips:o(r.lips,i.lips),velum:.01+.39*t}}var Rs=class extends E{voices;now;name;bendRange=Fs;held=[];velocities=new Map;bend=0;modWheelValue=0;noteListeners=new Set;performanceListeners=new Set;settings={};singing=[];lastPitch=[];syllableTakenAt=-1/0;chordSyllable;syllables=[];syllableAt=0;lyricIndex=-1;constructor(e=`MOA-VOX`,t=1,n=()=>performance.now()){super(),this.voices=t,this.now=n,this.name=e,this.singing=Array.from({length:t},()=>void 0),this.lastPitch=Array.from({length:t},(e,n)=>67-7*n/Math.max(1,t-1));let r=this.circuit;r.add(`voice`,`voice`,{level:.8},{config:`{}`}).add(`master`,`gain`,{gain:1}).connect(`voice`,`master`),this.outputList.push({name:`out`,nodeId:`master`});let i=()=>this.configure({shape:this.shape});this.num(`vowel`,`Vowel`,0,Is.length-1,2,``,i),this.num(`nasal`,`Nasal`,0,1,0,``,i),this.num(`ring`,`Ring`,0,1,.5,``,i),this.num(`size`,`Tract`,13,19,17,`cm`,e=>this.configure({voices:t,length:e,lengths:Array.from({length:t},(n,r)=>e-2.5*(t-1-r)/Math.max(1,t-1))})),this.num(`tension`,`Tension`,0,1,.6,``,e=>this.configure({tension:e})),this.num(`breath`,`Breath`,0,1,.25,``,e=>this.configure({breath:e})),this.num(`roughness`,`Rough`,0,1,.3,``,e=>this.configure({roughness:e})),this.num(`onset`,`Onset`,0,1,.5,``,e=>this.configure({onset:e})),this.num(`scoop`,`Scoop`,0,150,40,`ct`,e=>this.configure({scoop:e})),this.num(`vibrato.depth`,`Vibrato`,0,100,30,`ct`,e=>this.applyVibrato(e)),this.num(`vibrato.rate`,`Rate`,3,8,5.5,`Hz`,e=>this.configure({vibRate:e})),this.num(`vibrato.delay`,`Delay`,0,1.5,.35,`s`,e=>this.configure({vibDelay:e})),this.num(`glide`,`Glide`,.005,.5,.06,`s`,e=>this.configure({glide:e}),`log`),this.num(`attack`,`Attack`,.01,1,.08,`s`,e=>this.configure({attack:e}),`log`),this.num(`release`,`Release`,.02,2,.25,`s`,e=>this.configure({release:e}),`log`),this.num(`level`,`Level`,0,2,.8,``,e=>r.setParam(`voice`,`level`,e)),this.controlList.push(new _n(`lyrics`,`Lyrics`,``,e=>{this.syllables=As(e),this.resetLyrics()}))}num(e,t,n,r,i,a,o,s){this.controlList.push(new D(e,t,n,r,i,a,o,s))}value(e){let t=this.controlList.find(t=>t.id===e);return t?t.value:0}configure(e){this.settings={...this.settings,...e},this.circuit.setOption(`voice`,`config`,JSON.stringify(this.settings)),this.circuit.send(`voice`,{type:`configure`,...e})}applyVibrato(e=this.value(`vibrato.depth`)){this.configure({vibDepth:e+60*this.modWheelValue})}get shape(){return{...Ls(this.value(`vowel`),this.value(`nasal`)),ring:this.value(`ring`)}}get heldNotes(){return this.held}keyDown(e,t=100){if(this.voices>1)return this.sectionDown(e,t);let n=this.held.length>0;this.held=[...this.held.filter(t=>t!==e),e],this.velocities.set(e,t),this.sing(e,n),this.notifyNotes()}sectionDown(e,t){this.singing.includes(e)&&this.sectionUp(e);let n=this.singing.map((e,t)=>e===void 0?t:-1).filter(e=>e>=0),r=(n.length?n:this.singing.map((e,t)=>t)).reduce((t,n)=>Math.abs(this.lastPitch[n]-e)<Math.abs(this.lastPitch[t]-e)?n:t);this.singing[r]=e,this.lastPitch[r]=e,this.held=[...this.held.filter(t=>t!==e),e];let i=this.now();i-this.syllableTakenAt>40&&(this.chordSyllable=this.nextSyllable(),this.syllableTakenAt=i),this.circuit.send(`voice`,{type:`note`,voice:r,hz:pa(e),intensity:.35+t/127*.65,legato:!1,syllable:this.chordSyllable}),this.notifyNotes()}sectionUp(e){let t=this.singing.indexOf(e);t<0||(this.singing[t]=void 0,this.held=this.held.filter(t=>t!==e),this.circuit.send(`voice`,{type:`off`,voice:t}),this.notifyNotes())}keyUp(e){if(this.voices>1)return this.sectionUp(e);if(!this.held.includes(e))return;let t=this.held.at(-1)===e;this.held=this.held.filter(t=>t!==e),this.velocities.delete(e),this.held.length?t&&this.sing(this.held.at(-1),!0,!1):this.circuit.send(`voice`,{type:`off`}),this.notifyNotes()}sing(e,t,n=!0){let r=this.velocities.get(e)??100,i=n?this.nextSyllable():void 0;this.circuit.send(`voice`,{type:`note`,hz:pa(e),intensity:.35+r/127*.65,legato:t,syllable:i})}nextSyllable(){if(!this.syllables.length)return;let e=this.syllables[this.syllableAt%this.syllables.length];return this.lyricIndex=this.syllableAt%this.syllables.length,this.syllableAt++,e.hold?void 0:{onset:e.onset,vowel:this.vowelShape(e.vowel),vowel2:e.vowel2?this.vowelShape(e.vowel2):void 0,coda:e.coda}}vowelShape(e){return{...Cs[e],velum:.01+.39*this.value(`nasal`),ring:this.value(`ring`)}}resetLyrics(){this.syllableAt=0,this.lyricIndex=-1,this.notifyNotes()}get lyrics(){return this.syllables}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.configure({bend:this.bend*Fs}),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.applyVibrato(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===js?this.setModWheel(e.value/127):e.controller===Ms?this.control(`breath`).set(e.value/127):e.controller===Ns?this.configure({expression:e.value/127}):e.controller===Ps&&this.control(`vowel`).set((Is.length-1)*e.value/127)}}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}},zs={"f1.type":`GEN LP`,"f1.cutoff":1200,"f1.res":.25,"f1.depth":0,"f1.source":`env`,"f1.inv":0,"f1.noise":0,"f1.vca":0,"f1.gate":0,"f1.threshold":.3,"f2.type":`GEN LP`,"f2.cutoff":1200,"f2.res":.25,"f2.depth":0,"f2.source":`env`,"f2.inv":0,"f2.noise":0,"f2.vca":0,"f2.gate":0,"f2.threshold":.3,"env1.attack":.01,"env1.decay":.3,"env1.sustain":.6,"env1.release":.4,"env1.mode":`adsr`,"env1.curve":`lin`,"env1.trig":`keys`,"env2.attack":.01,"env2.decay":.3,"env2.sustain":.6,"env2.release":.4,"env2.mode":`adsr`,"env2.curve":`lin`,"env2.trig":`keys`,"link.env":0,"link.cutoff":0,"sh.rate":4,"sh.slew":.2,"sh.source":`noise`,"delay.time":.25,"delay.repeats":.3,"delay.level":0,"delay.mod":0,"delay.source":`s&h`,"mix.a":.8,"mix.b":.8,"mix.mode":`stereo`,"mix.volume":.8},J=(e,t)=>({name:e,values:t}),Bs=e=>{let t={};for(let[n,r]of Object.entries(e))t[`f1.${n}`]=r,t[`f2.${n}`]=r;return t},Vs=[J(`Init`,{}),J(`Dynamic Pluck`,{...Bs({cutoff:180,res:.45,depth:.85,vca:1}),"env1.attack":.002,"env1.decay":.22,"env1.sustain":0,"env1.release":.2,"env1.curve":`exp`,"link.env":1,"delay.level":.2,"delay.time":.18,"delay.repeats":.3}),J(`Auto Wah`,{"f1.type":`GEN BP`,"f1.cutoff":350,"f1.res":.7,"f1.depth":.7,"f2.type":`GEN BP`,"f2.cutoff":500,"f2.res":.7,"f2.depth":.7,"env1.trig":`thresh`,"f1.gate":1,"f1.threshold":.35,"env1.attack":.004,"env1.decay":.18,"env1.sustain":.1,"env1.release":.15,"env1.curve":`exp`,"link.env":1}),J(`Screaming Madman`,{"f1.type":`GEN LP`,"f1.cutoff":300,"f1.res":.93,"f1.depth":.6,"f2.type":`GEN HP`,"f2.cutoff":900,"f2.res":.9,"f2.depth":-.4,"env1.attack":.01,"env1.decay":.5,"env1.sustain":.2,"env1.release":.6,"link.env":1,"mix.a":.6,"mix.b":.45}),J(`Silk Sweep`,{...Bs({type:`2045 LP`,cutoff:250,res:.35,depth:.7}),"env1.attack":.45,"env1.decay":1.2,"env1.sustain":.7,"env1.release":1.5,"link.env":1,"delay.level":.25,"delay.time":.38,"delay.repeats":.45}),J(`Ringing 2045`,{"f1.type":`2045 LP`,"f1.cutoff":520,"f1.res":.96,"f1.depth":.3,"f2.type":`2045 LP`,"f2.cutoff":780,"f2.res":.96,"f2.depth":.3,"env1.attack":.05,"env1.sustain":.5,"link.env":1,"mix.a":.5,"mix.b":.5}),J(`Twin Peaks`,{...Bs({type:`BP+`,cutoff:700,res:.78,depth:.5}),"f2.cutoff":1100,"env1.attack":.02,"env1.decay":.6,"env1.sustain":.4,"env1.release":.5,"link.env":1}),J(`Phase Rooms`,{"f1.type":`NOTCH+`,"f1.cutoff":600,"f1.res":.6,"f1.depth":.8,"f1.source":`s&h`,"f2.type":`BANDSTOP+`,"f2.cutoff":900,"f2.res":.5,"f2.depth":.8,"sh.rate":1.2,"sh.slew":.65,"sh.source":`noise`}),J(`Random Steps`,{...Bs({cutoff:400,res:.6,depth:.9,source:`s&h`}),"f2.type":`GEN BP`,"sh.rate":7,"sh.slew":.05,"delay.level":.3,"delay.time":.21,"delay.repeats":.4,"delay.mod":.4,"delay.source":`s&h`}),J(`Looping LFO`,{...Bs({type:`2045 LP`,cutoff:300,res:.55,depth:.7}),"env1.mode":`loop`,"env1.attack":.35,"env1.release":.55,"link.env":1}),J(`Tremolo Gate`,{...Bs({cutoff:8e3,res:.1,depth:0,vca:1}),"env1.mode":`loop`,"env1.attack":.01,"env1.release":.09,"env1.curve":`exp`,"link.env":1}),J(`Crunch Echo`,{...Bs({type:`GEN LP`,cutoff:2400,res:.4}),"delay.level":.7,"delay.time":.42,"delay.repeats":.7,"delay.mod":.25,"delay.source":`env2`,"env2.mode":`loop`,"env2.attack":1.2,"env2.release":1.6}),J(`Noise Drums`,{"f1.type":`GEN BP`,"f1.cutoff":180,"f1.res":.8,"f1.depth":.8,"f1.noise":.9,"f1.vca":1,"f2.type":`GEN HP`,"f2.cutoff":3e3,"f2.res":.4,"f2.noise":.7,"f2.vca":1,"env1.attack":.001,"env1.decay":.12,"env1.sustain":0,"env1.release":.1,"env1.curve":`exp`,"env2.attack":.001,"env2.decay":.05,"env2.sustain":0,"env2.release":.05,"env2.curve":`exp`}),J(`Ghost Pad`,{"f1.type":`2045 LP`,"f1.cutoff":400,"f1.res":.5,"f1.depth":.5,"f1.noise":.15,"f2.type":`BANDSTOP+`,"f2.cutoff":1200,"f2.res":.4,"f2.depth":-.5,"env1.attack":.8,"env1.release":2,"env2.attack":1.5,"env2.release":2.5,"delay.level":.4,"delay.time":.5,"delay.repeats":.6}),J(`Mono Squelch`,{"f1.type":`2045 LP`,"f1.cutoff":120,"f1.res":.88,"f1.depth":.95,"f1.vca":1,"f2.type":`GEN LP`,"f2.cutoff":200,"f2.res":.85,"f2.depth":.9,"f2.vca":1,"env1.attack":.002,"env1.decay":.25,"env1.sustain":.15,"env1.release":.15,"env1.curve":`exp`,"link.env":1,"mix.mode":`mono`})],Hs=Array.from({length:16},(e,t)=>Vs[t]??J(`Init`,{})),Us=[`GEN LP`,`GEN BP`,`GEN HP`,`GEN NOTCH`,`2045 LP`,`BP+`,`NOTCH+`,`BANDSTOP+`],Ws=[`Type`,`Cut`,`Res`,`Depth`,`Src`,`Inv`,`Noise`,`Vca`,`Thr`,`Gate`].flatMap(e=>[`f1${e}`,`f2${e}`]).concat([`e1`,`e2`].flatMap(e=>[`Atk`,`Dec`,`Sus`,`Rel`,`Loop`,`Exp`,`Trig`].map(t=>e+t)),[`envLink`,`cutLink`,`shRate`,`shSlew`,`shSrc`,`dlTime`,`dlRep`,`dlLevel`,`dlMod`,`dlSrc`,`mixA`,`mixB`,`mono`,`vol`]),Gs=class extends E{name;slots=[...Hs];currentSlot=0;currentPreset=this.slots[0];presetListeners=new Set;constructor(e=`MOA-DF2`){super(),this.name=e;let t=this.circuit;t.add(`box`,`df`,Object.fromEntries(Ws.map(e=>[e,0]))).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`box`,`meterL`).connect(`box`,`meterR`),this.inputList.push({name:`in`,nodeId:`box`}),this.outputList.push({name:`out`,nodeId:`box`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=zs,r=e=>n=>t.setParam(`box`,e,n),i=(e,t,i,a,o,s,c)=>this.controlList.push(new D(e,t,i,a,n[e],o,r(s),c)),a=(e,t,i,a)=>this.controlList.push(new O(e,t,i,n[e],e=>r(a)(i.indexOf(e)))),o=(e,t,i)=>this.controlList.push(new k(e,t,n[e]>0,e=>r(i)(+!!e)));for(let e of[`1`,`2`]){let t=`f${e}`;a(`${t}.type`,`Filter type`,Us,`${t}Type`),i(`${t}.cutoff`,`Cutoff`,20,2e4,`Hz`,`${t}Cut`,`log`),i(`${t}.res`,`Resonance`,0,1,``,`${t}Res`),i(`${t}.depth`,`Depth`,-1,1,``,`${t}Depth`),a(`${t}.source`,`Source`,[`env`,`s&h`],`${t}Src`),o(`${t}.inv`,`Invert env`,`${t}Inv`),i(`${t}.noise`,`Noise`,0,1,``,`${t}Noise`),o(`${t}.vca`,`VCA`,`${t}Vca`),i(`${t}.threshold`,`Threshold`,0,1,``,`${t}Thr`),o(`${t}.gate`,`Gate on`,`${t}Gate`)}for(let e of[`1`,`2`]){let t=`env${e}`,n=`e${e}`;i(`${t}.attack`,`Attack`,.001,10,`s`,`${n}Atk`,`log`),i(`${t}.decay`,`Decay`,.005,10,`s`,`${n}Dec`,`log`),i(`${t}.sustain`,`Sustain`,0,1,``,`${n}Sus`),i(`${t}.release`,`Release`,.005,20,`s`,`${n}Rel`,`log`),a(`${t}.mode`,`Mode`,[`adsr`,`loop`],`${n}Loop`),a(`${t}.curve`,`Curve`,[`lin`,`exp`],`${n}Exp`),a(`${t}.trig`,`Gate from`,[`keys`,`thresh`],`${n}Trig`)}o(`link.env`,`Env I link`,`envLink`),o(`link.cutoff`,`Cutoff link`,`cutLink`),i(`sh.rate`,`Rate`,.05,40,`Hz`,`shRate`,`log`),i(`sh.slew`,`Slew`,0,1,``,`shSlew`),a(`sh.source`,`Source`,[`noise`,`env`],`shSrc`),i(`delay.time`,`Time`,.02,.6,`s`,`dlTime`,`log`),i(`delay.repeats`,`Repeats`,0,1,``,`dlRep`),i(`delay.level`,`Level`,0,1,``,`dlLevel`),i(`delay.mod`,`Mod depth`,-1,1,``,`dlMod`),a(`delay.source`,`Mod source`,[`s&h`,`env2`],`dlSrc`),i(`mix.a`,`Filter I`,0,1.5,``,`mixA`),i(`mix.b`,`Filter II`,0,1.5,``,`mixB`),a(`mix.mode`,`Output`,[`stereo`,`mono`],`mono`),i(`mix.volume`,`Volume`,0,1.5,``,`vol`)}setKeys(e){this.circuit.gate(`box`,`keys`,e)}setOpen(e,t){this.circuit.gate(`box`,e===1?`open1`:`open2`,t)}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.currentPreset=t,this.applyValues({...zs,...t.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyPreset(){for(let e of this.presetListeners)e()}},Ks={"lfo.rate":5,"lfo.delay":0,"dco.lfo":0,"dco.pwm":.5,"dco.pwmSource":`man`,"dco.range":`8`,"dco.pulse":1,"dco.saw":1,"dco.sub":.3,"dco.noise":0,"hpf.freq":`1`,"vcf.freq":3e3,"vcf.res":.2,"vcf.env":.4,"vcf.polarity":`plus`,"vcf.lfo":0,"vcf.kybd":.5,"vca.mode":`env`,"vca.level":.8,"env.attack":.005,"env.decay":.4,"env.sustain":.6,"env.release":.3,"chorus.i":0,"chorus.ii":0,"bend.dco":2,"bend.vcf":.2,"bend.lfo":.3,"bend.lfoTrig":0,"master.portamento":0,"assign.mode":`poly1`,"master.tune":0,"master.volume":.75,"key.hold":0,"key.transpose":`0`},qs=[`master.tune`,`master.volume`,`key.hold`,`key.transpose`],Js=[`A`,`B`],Ys=Js.length*8*8,Xs=(e,t,n)=>e*8*8+(t-1)*8+(n-1),Y=(e,t)=>({name:e,values:t}),Zs=[Y(`Brass 1`,{"dco.sub":.2,"vcf.freq":700,"vcf.res":.15,"vcf.env":.55,"vcf.kybd":.6,"env.attack":.07,"env.decay":.4,"env.sustain":.65,"env.release":.2,"chorus.i":1}),Y(`Brass 2`,{"dco.pwm":.35,"dco.pulse":1,"dco.saw":1,"vcf.freq":600,"vcf.res":.25,"vcf.env":.6,"env.attack":.12,"env.decay":.5,"env.sustain":.55,"env.release":.25,"chorus.ii":1}),Y(`Strings`,{"dco.pulse":0,"dco.saw":1,"dco.sub":.1,"hpf.freq":`2`,"vcf.freq":2600,"vcf.res":.05,"vcf.env":.1,"env.attack":.35,"env.decay":1,"env.sustain":.85,"env.release":.6,"chorus.i":1,"chorus.ii":1}),Y(`String Ensemble`,{"dco.pulse":1,"dco.saw":1,"dco.pwm":.6,"dco.pwmSource":`lfo`,"lfo.rate":.8,"dco.sub":.15,"hpf.freq":`2`,"vcf.freq":2200,"vcf.env":.1,"env.attack":.5,"env.decay":1,"env.sustain":.9,"env.release":.8,"chorus.i":1,"chorus.ii":1}),Y(`Choir`,{"dco.pulse":1,"dco.saw":0,"dco.pwm":.3,"dco.sub":.3,"dco.noise":.04,"vcf.freq":1300,"vcf.res":.35,"vcf.env":.1,"env.attack":.45,"env.decay":.8,"env.sustain":.8,"env.release":.9,"chorus.ii":1}),Y(`Warm Pad`,{"dco.sub":.4,"vcf.freq":900,"vcf.res":.1,"vcf.env":.15,"vcf.lfo":.1,"lfo.rate":.3,"env.attack":.9,"env.decay":1.5,"env.sustain":.8,"env.release":1.4,"chorus.i":1}),Y(`Slow Pad`,{"dco.pwmSource":`lfo`,"dco.pwm":.5,"lfo.rate":.2,"dco.sub":.25,"vcf.freq":1500,"vcf.res":.2,"vcf.env":.3,"env.attack":1.6,"env.decay":2,"env.sustain":.85,"env.release":2.2,"chorus.i":1,"chorus.ii":1}),Y(`Sweep Pad`,{"vcf.freq":400,"vcf.res":.55,"vcf.env":.7,"vcf.lfo":.25,"lfo.rate":.15,"env.attack":1.2,"env.decay":2.5,"env.sustain":.7,"env.release":1.8,"chorus.ii":1}),Y(`Sub Bass`,{"dco.range":`16`,"dco.pulse":0,"dco.saw":1,"dco.sub":.8,"vcf.freq":350,"vcf.res":.1,"vcf.env":.3,"vcf.kybd":.2,"env.attack":.003,"env.decay":.3,"env.sustain":.8,"env.release":.12,"master.portamento":.05}),Y(`Saw Bass`,{"dco.range":`16`,"dco.pulse":0,"dco.sub":.5,"hpf.freq":`1`,"vcf.freq":500,"vcf.res":.3,"vcf.env":.55,"vcf.kybd":.3,"env.attack":.002,"env.decay":.25,"env.sustain":.4,"env.release":.12}),Y(`Pluck Bass`,{"dco.range":`16`,"dco.pulse":1,"dco.saw":0,"dco.pwm":.4,"dco.sub":.6,"vcf.freq":300,"vcf.res":.4,"vcf.env":.7,"vcf.kybd":.4,"env.attack":.001,"env.decay":.22,"env.sustain":0,"env.release":.15}),Y(`Lead Saw`,{"dco.pulse":0,"dco.sub":.1,"vcf.freq":2400,"vcf.res":.3,"vcf.env":.25,"vcf.kybd":.8,"dco.lfo":.12,"lfo.rate":5.5,"lfo.delay":.6,"env.attack":.01,"env.decay":.3,"env.sustain":.85,"env.release":.2,"master.portamento":.15,"assign.mode":`unison`,"chorus.i":1}),Y(`Lead Pulse`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.55,"dco.pwmSource":`lfo`,"lfo.rate":3,"dco.sub":.2,"vcf.freq":2e3,"vcf.res":.35,"vcf.env":.3,"vcf.kybd":.8,"env.attack":.01,"env.decay":.3,"env.sustain":.8,"env.release":.2,"assign.mode":`unison`,"chorus.ii":1}),Y(`Whistle Lead`,{"dco.range":`4`,"dco.saw":0,"dco.pulse":1,"dco.pwm":.1,"dco.sub":0,"hpf.freq":`2`,"vcf.freq":3800,"vcf.res":.2,"vcf.env":.1,"dco.lfo":.1,"lfo.rate":5,"lfo.delay":.9,"env.attack":.04,"env.decay":.3,"env.sustain":.9,"env.release":.25,"master.portamento":.25,"assign.mode":`unison`}),Y(`Organ`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":0,"dco.sub":.7,"hpf.freq":`2`,"vcf.freq":6e3,"vcf.res":0,"vcf.env":0,"vca.mode":`gate`,"chorus.i":1,"chorus.ii":1}),Y(`Clav`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.25,"dco.sub":0,"hpf.freq":`3`,"vcf.freq":1500,"vcf.res":.35,"vcf.env":.55,"vcf.kybd":.9,"env.attack":.001,"env.decay":.18,"env.sustain":0,"env.release":.12}),Y(`Pluck`,{"dco.pulse":0,"dco.sub":.2,"vcf.freq":700,"vcf.res":.3,"vcf.env":.6,"env.attack":.001,"env.decay":.35,"env.sustain":0,"env.release":.3,"chorus.i":1}),Y(`Harp`,{"dco.range":`4`,"dco.pulse":0,"dco.sub":0,"vcf.freq":1500,"vcf.res":.15,"vcf.env":.35,"env.attack":.001,"env.decay":1.2,"env.sustain":0,"env.release":1,"chorus.ii":1}),Y(`Bell Pad`,{"dco.range":`4`,"dco.saw":0,"dco.pulse":1,"dco.pwm":.7,"dco.pwmSource":`lfo`,"lfo.rate":6,"dco.sub":0,"vcf.freq":2500,"vcf.res":.45,"vcf.env":.4,"env.attack":.002,"env.decay":1.6,"env.sustain":.1,"env.release":1.5,"chorus.i":1,"chorus.ii":1}),Y(`Noise Sweep`,{"dco.pulse":0,"dco.saw":0,"dco.sub":0,"dco.noise":.8,"hpf.freq":`2`,"vcf.freq":300,"vcf.res":.6,"vcf.env":.8,"env.attack":1.4,"env.decay":1.5,"env.sustain":.1,"env.release":1.2,"chorus.ii":1}),Y(`Wind`,{"dco.pulse":0,"dco.saw":0,"dco.sub":0,"dco.noise":.9,"vcf.freq":900,"vcf.res":.55,"vcf.env":.2,"vcf.lfo":.3,"lfo.rate":.25,"vcf.kybd":1,"env.attack":1,"env.decay":1,"env.sustain":.9,"env.release":1.5,"chorus.i":1}),Y(`Vibes`,{"dco.range":`4`,"dco.pulse":0,"dco.sub":0,"dco.lfo":.05,"lfo.rate":6,"vcf.freq":2400,"vcf.res":.1,"vcf.env":.2,"env.attack":.002,"env.decay":1.4,"env.sustain":0,"env.release":.9,"chorus.ii":1}),Y(`Glass`,{"dco.saw":0,"dco.pulse":1,"dco.pwm":.8,"dco.pwmSource":`lfo`,"lfo.rate":.5,"dco.sub":0,"dco.noise":.03,"hpf.freq":`2`,"vcf.freq":4e3,"vcf.res":.25,"vcf.env":.1,"env.attack":.6,"env.decay":1.5,"env.sustain":.7,"env.release":1.6,"chorus.i":1,"chorus.ii":1}),Y(`Funk Stab`,{"dco.sub":.3,"hpf.freq":`2`,"vcf.freq":500,"vcf.res":.25,"vcf.env":.65,"vcf.kybd":.7,"env.attack":.001,"env.decay":.16,"env.sustain":0,"env.release":.08,"chorus.ii":1})],Qs=Array.from({length:Ys},(e,t)=>Zs[t]??Y(`Init`,{})),$s=[`poly`,`mono`,`unison`],ec=class{count;mode=`poly`;prefer=`oldest`;voices;held=[];clock=0;constructor(e){this.count=e,this.voices=Array.from({length:e},()=>({gate:!1,since:0}))}isActive(e){return this.voices[e].gate}get activeCount(){return this.voices.filter(e=>e.gate).length}noteOn(e){return this.mode===`poly`?this.polyOn(e):this.stackOn(e)}noteOff(e){return this.mode===`poly`?this.polyOff(e):this.stackOff(e)}releaseAll(){this.held=[];let e=[];return this.voices.forEach((t,n)=>{t.gate&&(t.gate=!1,t.since=++this.clock,e.push({kind:`off`,voice:n}))}),e}get active(){return this.mode===`mono`?[0]:this.voices.map((e,t)=>t)}polyOn(e){let t=this.voices.findIndex(t=>t.gate&&t.note===e);if(t<0){let e=this.voices.map((e,t)=>({v:e,i:t})).filter(e=>!e.v.gate),n=e.length?e:this.voices.map((e,t)=>({v:e,i:t}));t=this.prefer===`lowest`&&e.length?e[0].i:n.reduce((e,t)=>t.v.since<e.v.since?t:e).i}let n=this.voices[t];return n.note=e,n.gate=!0,n.since=++this.clock,[{kind:`on`,voice:t,note:e,retrigger:!0,glide:!0}]}polyOff(e){let t=[];return this.voices.forEach((n,r)=>{n.gate&&n.note===e&&(n.gate=!1,n.since=++this.clock,t.push({kind:`off`,voice:r}))}),t}stackOn(e){let t=this.voices[this.active[0]].gate;return this.held=this.held.filter(t=>t!==e),this.held.push(e),this.play(e,!t,t)}stackOff(e){this.held=this.held.filter(t=>t!==e);let t=this.held[this.held.length-1];if(t!==void 0)return this.play(t,!1,!0);let n=[];for(let e of this.active){let t=this.voices[e];t.gate&&(t.gate=!1,t.since=++this.clock,n.push({kind:`off`,voice:e}))}return n}play(e,t,n){return this.active.map(r=>{let i=this.voices[r],a=t||!i.gate;return i.note=e,i.gate=!0,i.since=++this.clock,{kind:`on`,voice:r,note:e,retrigger:a,glide:n&&!a}})}},tc=[`poly1`,`poly2`,`unison`],nc=[`16`,`8`,`4`],rc=[`0`,`1`,`2`,`3`],ic=[`-2`,`-1`,`0`,`1`,`2`],ac=1200,oc=69,sc=1,cc=64,lc=.65,uc=12,dc={poly:.4,unison:.3},fc=[10,10,240,720],pc={16:-1200,8:0,4:ac},mc={i:{rate:.5,depth:.0013},ii:{rate:.83,depth:.0013},both:{rate:9,depth:25e-5}},hc=class extends E{name;transport;slots=[...Qs];currentSlot=0;currentPreset=this.slots[0];group=0;bank=1;manualState=!0;manualSnapshot;allocator=new ec(6);held=[];sounding=new Map;latched=new Set;pedal=!1;bend=0;modWheelValue=0;portamento=0;bendSemitones=2;bendFilter=.2;lfoSensitivity=.3;lfoDepthCents=0;pwmSource=`man`;pwm=.5;envDepth=.4;envSign=1;lfoTrig=!1;chorusI=!1;chorusII=!1;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`Lynch`,t=new T){super(),this.name=e,this.transport=new An(t),this.transport.channel.set(`omni`);let n=this.circuit;this.addShared(n);for(let e=0;e<6;e++)this.addVoice(n,e);this.addOutput(n),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`}),this.addControls(n)}keyDown(e){let t=e+Number(this.control(`key.transpose`).value)*12;this.held=this.held.filter(t=>t!==e),this.held.push(e),this.latched.delete(e),this.sounding.set(e,t),this.apply(this.allocator.noteOn(t)),this.updateLfoGate(),this.notifyNotes()}keyUp(e){let t=this.sounding.get(e);t!==void 0&&(this.holding?this.latched.add(e):this.release(e,t))}release(e,t){this.sounding.delete(e),this.latched.delete(e),this.held=this.held.filter(t=>t!==e),this.apply(this.allocator.noteOff(t)),this.updateLfoGate(),this.notifyNotes()}get holding(){return this.pedal||this.control(`key.hold`).value}releaseLatched(){for(let e of[...this.latched]){let t=this.sounding.get(e);t!==void 0&&this.release(e,t)}}releaseAll(){this.apply(this.allocator.releaseAll()),this.held=[],this.sounding.clear(),this.latched.clear(),this.updateLfoGate(),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}voiceActive(e){return this.allocator.isActive(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*this.bendSemitones*100),this.circuit.setParam(`bendVcf`,`offset`,this.bend*this.bendFilter*2400),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`lfoPitchMod`,`gain`,this.modWheelValue*this.lfoSensitivity*200),this.updateLfoGate(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}updateLfoGate(){let e=this.lfoTrig?this.modWheelValue>.05:this.held.length>0;this.circuit.setParam(`lfoFade`,`gate`,+!!e)}handleMidi(e){if(e.type!==`clock`&&`channel`in e&&this.transport.acceptsChannel(e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===sc?this.setModWheel(e.value/127):e.controller===cc&&(this.pedal=e.value>=64,this.pedal||this.releaseLatched());break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}get manual(){return this.manualState}get patchNumber(){let e=this.currentSlot%64;return{group:Math.floor(this.currentSlot/64),bank:Math.floor(e/8)+1,patch:e%8+1}}selectGroup(e){this.group=Math.min(Js.length-1,Math.max(0,e)),this.notifyPreset()}selectBank(e){this.bank=Math.min(8,Math.max(1,e)),this.notifyPreset()}selectPatch(e){this.loadSlot(Xs(this.group,this.bank,e))}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.manualState&&(this.manualSnapshot=this.snapshot()),this.manualState=!1,this.currentSlot=e;let{group:n,bank:r}=this.patchNumber;this.group=n,this.bank=r,this.loadPreset(t)}selectManual(){this.manualState||(this.manualState=!0,this.manualSnapshot&&this.applyValues(this.manualSnapshot),this.notifyPreset())}loadPreset(e){this.currentPreset=e,this.applyValues({...Ks,...e.values}),this.notifyPreset()}applyValues(e){for(let[t,n]of Object.entries(e)){if(qs.includes(t))continue;let e=this.control(t);if(e.kind===`number`&&typeof n==`number`)e.set(n);else if(e.kind===`toggle`&&typeof n==`number`)e.set(n>0);else if(e.kind===`choice`&&typeof n==`string`)e.set(n);else throw Error(`Patch: bad value for ${t}`)}}snapshot(){let e={};for(let t of this.controlList)qs.includes(t.id)||(e[t.id]=t.kind===`toggle`?+!!t.value:t.value);return e}write(e=Xs(this.group,this.bank,this.patchNumber.patch)){let t={name:this.slots[e].name,values:this.snapshot()};return this.slots[e]=t,this.currentSlot=e,this.currentPreset=t,this.manualState=!1,this.notifyPreset(),t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}apply(e){let t=this.circuit;for(let n of e){let e=e=>`v${n.voice}.${e}`;n.kind===`off`?(t.setParam(e(`env`),`gate`,0),t.setParam(e(`gate`),`gate`,0)):(t.setParam(e(`pitch`),`offset`,(n.note-oc)*100),n.retrigger&&(t.setParam(e(`env`),`gate`,1),t.setParam(e(`gate`),`gate`,1)))}}eachVoice(e){for(let t=0;t<6;t++)e(e=>`v${t}.${e}`)}applyMode(e){this.releaseAll(),this.allocator.mode=e===`unison`?`unison`:`poly`,this.allocator.prefer=e===`poly2`?`lowest`:`oldest`;let t=e===`unison`?dc.unison:dc.poly;this.eachVoice(e=>this.circuit.setParam(e(`out`),`gain`,t));let n=e===`unison`?uc:0,r=5/2;for(let e=0;e<6;e++){let t=(e-r)/r*n;this.circuit.setParam(`v${e}.det`,`offset`,t===0?0:t)}}notifyNotes(){for(let e of this.noteListeners)e()}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyPreset(){for(let e of this.presetListeners)e()}addShared(e){e.add(`bend`,`constant`,{offset:0}).add(`tune`,`constant`,{offset:0}).add(`rangeShift`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:-1200}).add(`pwCv`,`constant`,{offset:0}).add(`bendVcf`,`constant`,{offset:0}).add(`lfoOsc`,`oscillator`,{frequency:5,detune:0},{waveform:`triangle`}).add(`lfoFade`,`envelope`,{attack:.001,decay:.001,sustain:1,release:.02,gate:0}).add(`lfoFadeGain`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPitchMod`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0}).add(`noise`,`noise`).add(`voices`,`gain`,{gain:1}).connect(`lfoOsc`,`lfoFadeGain`).connect(`lfoFade`,`lfoFadeGain`,`gain`).connect(`lfoFadeGain`,`lfo`);for(let t of[`lfoPitch`,`lfoPitchMod`,`lfoPw`,`lfoFilter`])e.connect(`lfo`,t)}addVoice(e,t){let n=e=>`v${t}.${e}`;e.add(n(`pitch`),`constant`,{offset:0,glide:0}).add(n(`det`),`constant`,{offset:0}).add(n(`osc`),`oscillator`,{frequency:440,detune:0},{waveform:`sawtooth`}).add(n(`sub`),`oscillator`,{frequency:440,detune:0},{waveform:`square`}).add(n(`rawOut`),`gain`,{gain:1}).add(n(`pulseSum`),`gain`,{gain:1}).add(n(`shaper`),`waveshaper`,{},{curve:`pulse`}).add(n(`pulseOut`),`gain`,{gain:lc}).add(n(`subLevel`),`gain`,{gain:0}).add(n(`noiseLevel`),`gain`,{gain:0}).add(n(`mix`),`gain`,{gain:.5}).add(n(`boost`),`filter`,{frequency:120,Q:.707,gain:0,detune:0},{type:`lowshelf`}).add(n(`hpf`),`filter`,{frequency:10,Q:.707,gain:0,detune:0},{type:`highpass`}).add(n(`f1`),`filter`,{frequency:3e3,Q:1,detune:0},{type:`lowpass`}).add(n(`f2`),`filter`,{frequency:3e3,Q:.707,detune:0},{type:`lowpass`}).add(n(`keyFollow`),`gain`,{gain:.5}).add(n(`env`),`envelope`,{attack:.005,decay:.4,sustain:.6,release:.3,gate:0}).add(n(`envDepth`),`gain`,{gain:.4*6*ac}).add(n(`gate`),`envelope`,{attack:.003,decay:.001,sustain:1,release:.015,gate:0}).add(n(`envAmp`),`gain`,{gain:1}).add(n(`gateAmp`),`gain`,{gain:0}).add(n(`amp`),`gain`,{gain:0}).add(n(`out`),`gain`,{gain:dc.poly});for(let t of[`osc`,`sub`])for(let r of[n(`pitch`),n(`det`),`bend`,`tune`,`rangeShift`,`lfoPitch`,`lfoPitchMod`])e.connect(r,n(t),`detune`);e.connect(`subShift`,n(`sub`),`detune`).connect(n(`osc`),n(`rawOut`)).connect(n(`osc`),n(`pulseSum`)).connect(`pwCv`,n(`pulseSum`)).connect(`lfoPw`,n(`pulseSum`)).connect(n(`pulseSum`),n(`shaper`)).connect(n(`shaper`),n(`pulseOut`)).connect(n(`rawOut`),n(`mix`)).connect(n(`pulseOut`),n(`mix`)).connect(n(`sub`),n(`subLevel`)).connect(n(`subLevel`),n(`mix`)).connect(`noise`,n(`noiseLevel`)).connect(n(`noiseLevel`),n(`mix`)).connect(n(`mix`),n(`boost`)).connect(n(`boost`),n(`hpf`)).connect(n(`hpf`),n(`f1`)).connect(n(`f1`),n(`f2`)).connect(n(`f2`),n(`amp`)).connect(n(`env`),n(`envDepth`)).connect(n(`pitch`),n(`keyFollow`));for(let t of[`f1`,`f2`])e.connect(n(`envDepth`),n(t),`detune`).connect(n(`keyFollow`),n(t),`detune`).connect(`lfoFilter`,n(t),`detune`).connect(`bendVcf`,n(t),`detune`);e.connect(n(`env`),n(`envAmp`)).connect(n(`envAmp`),n(`amp`),`gain`).connect(n(`gate`),n(`gateAmp`)).connect(n(`gateAmp`),n(`amp`),`gain`).connect(n(`amp`),n(`out`)).connect(n(`out`),`voices`)}addOutput(e){e.add(`chDry`,`gain`,{gain:1}).add(`chLfo`,`oscillator`,{frequency:.5,detune:0},{waveform:`triangle`}).add(`chDelayL`,`delay`,{delayTime:.0035,maxTime:.02}).add(`chDelayR`,`delay`,{delayTime:.0035,maxTime:.02}).add(`chDepthL`,`gain`,{gain:mc.i.depth}).add(`chDepthR`,`gain`,{gain:-mc.i.depth}).add(`chToneL`,`filter`,{frequency:9e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`chToneR`,`filter`,{frequency:9e3,Q:.707,gain:0,detune:0},{type:`lowpass`}).add(`chPanL`,`pan`,{pan:-1}).add(`chPanR`,`pan`,{pan:1}).add(`chWet`,`gain`,{gain:0}).add(`chSum`,`gain`,{gain:1}).add(`vcaLevel`,`gain`,{gain:.8}).add(`volume`,`gain`,{gain:.75}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`voices`,`chDry`).connect(`chDry`,`chSum`).connect(`voices`,`chDelayL`).connect(`voices`,`chDelayR`).connect(`chDelayL`,`chToneL`).connect(`chDelayR`,`chToneR`).connect(`chToneL`,`chPanL`).connect(`chToneR`,`chPanR`).connect(`chPanL`,`chWet`).connect(`chPanR`,`chWet`).connect(`chWet`,`chSum`).connect(`chLfo`,`chDepthL`).connect(`chLfo`,`chDepthR`).connect(`chDepthL`,`chDelayL`,`delayTime`).connect(`chDepthR`,`chDelayR`,`delayTime`).connect(`chSum`,`vcaLevel`).connect(`vcaLevel`,`volume`).connect(`volume`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`)}addControls(e){let t=Ks,n=e=>t[e],r=(e,t,r,i,a,o,s)=>this.controlList.push(new D(e,t,r,i,n(e),a,o,s)),i=e=>t=>this.eachVoice(n=>e(n,t)),a=(e,t,r)=>this.controlList.push(new k(e,t,n(e)>0,r)),o=(e,n,r,i)=>this.controlList.push(new O(e,n,r,t[e],i));r(`lfo.rate`,`Rate`,.1,30,`Hz`,t=>e.setParam(`lfoOsc`,`frequency`,t),`log`),r(`lfo.delay`,`Delay time`,0,3,`s`,t=>e.setParam(`lfoFade`,`attack`,Math.max(.001,t))),r(`dco.lfo`,`LFO`,0,1,``,t=>{this.lfoDepthCents=t*150,e.setParam(`lfoPitch`,`gain`,this.lfoDepthCents)}),r(`dco.pwm`,`PWM`,0,1,``,e=>{this.pwm=e,this.applyPulseWidth()}),o(`dco.pwmSource`,`PWM source`,[`man`,`lfo`],e=>{this.pwmSource=e,this.applyPulseWidth()}),o(`dco.range`,`Range`,nc,t=>e.setParam(`rangeShift`,`offset`,pc[t])),a(`dco.pulse`,`Pulse`,t=>this.eachVoice(n=>e.setParam(n(`pulseOut`),`gain`,t?lc:0))),a(`dco.saw`,`Saw`,t=>this.eachVoice(n=>e.setParam(n(`rawOut`),`gain`,+!!t))),r(`dco.sub`,`Sub`,0,1,``,i((t,n)=>e.setParam(t(`subLevel`),`gain`,n*.6))),r(`dco.noise`,`Noise`,0,1,``,i((t,n)=>e.setParam(t(`noiseLevel`),`gain`,n*.5))),o(`hpf.freq`,`HPF`,rc,t=>{let n=Number(t);this.eachVoice(t=>{e.setParam(t(`boost`),`gain`,n===0?6:0),e.setParam(t(`hpf`),`frequency`,fc[n])})}),r(`vcf.freq`,`Freq`,20,2e4,`Hz`,i((t,n)=>{e.setParam(t(`f1`),`frequency`,n),e.setParam(t(`f2`),`frequency`,n)}),`log`),r(`vcf.res`,`Res`,0,1,``,i((t,n)=>e.setParam(t(`f1`),`Q`,.5*32**n))),r(`vcf.env`,`Env`,0,1,``,e=>{this.envDepth=e,this.applyEnvDepth()}),o(`vcf.polarity`,`Env polarity`,[`plus`,`minus`],e=>{this.envSign=e===`minus`?-1:1,this.applyEnvDepth()}),r(`vcf.lfo`,`LFO`,0,1,``,t=>e.setParam(`lfoFilter`,`gain`,t*3*ac)),r(`vcf.kybd`,`Kybd`,0,1,``,i((t,n)=>e.setParam(t(`keyFollow`),`gain`,n))),o(`vca.mode`,`VCA`,[`env`,`gate`],t=>this.eachVoice(n=>{e.setParam(n(`envAmp`),`gain`,+(t===`env`)),e.setParam(n(`gateAmp`),`gain`,+(t===`gate`))})),r(`vca.level`,`Level`,0,1,``,t=>e.setParam(`vcaLevel`,`gain`,t));let s=(t,n,a,o)=>r(`env.${t}`,n,a,o,`s`,i((n,r)=>e.setParam(n(`env`),t,r)),`log`);s(`attack`,`A`,.001,3),s(`decay`,`D`,.002,12),r(`env.sustain`,`S`,0,1,``,i((t,n)=>e.setParam(t(`env`),`sustain`,n))),s(`release`,`R`,.002,12),a(`chorus.i`,`Chorus I`,e=>{this.chorusI=e,this.applyChorus()}),a(`chorus.ii`,`Chorus II`,e=>{this.chorusII=e,this.applyChorus()}),r(`bend.dco`,`Bender DCO`,0,12,`st`,e=>{this.bendSemitones=e,this.setPitchBend(this.bend)}),r(`bend.vcf`,`Bender VCF`,0,1,``,e=>{this.bendFilter=e,this.setPitchBend(this.bend)}),r(`bend.lfo`,`Bender LFO`,0,1,``,e=>{this.lfoSensitivity=e,this.setModWheel(this.modWheelValue)}),a(`bend.lfoTrig`,`LFO trig`,e=>{this.lfoTrig=e,this.updateLfoGate()}),r(`master.portamento`,`Portamento`,0,1,``,t=>{this.portamento=t;let n=t*t*2.5;this.eachVoice(t=>e.setParam(t(`pitch`),`glide`,n))}),o(`assign.mode`,`Assign`,tc,e=>this.applyMode(e)),r(`master.tune`,`Tune`,-50,50,`ct`,t=>e.setParam(`tune`,`offset`,t)),r(`master.volume`,`Volume`,0,1,``,t=>e.setParam(`volume`,`gain`,t)),a(`key.hold`,`Hold`,e=>{e||this.releaseLatched()}),o(`key.transpose`,`Key transpose`,ic,()=>{})}applyPulseWidth(){let e=this.circuit;this.pwmSource===`man`?(e.setParam(`pwCv`,`offset`,1-2*((50-this.pwm*45)/100)),e.setParam(`lfoPw`,`gain`,0)):(e.setParam(`pwCv`,`offset`,0),e.setParam(`lfoPw`,`gain`,this.pwm*.9))}applyEnvDepth(){this.eachVoice(e=>this.circuit.setParam(e(`envDepth`),`gain`,this.envSign*this.envDepth*6*ac))}applyChorus(){let e=this.circuit,t=this.chorusI,n=this.chorusII,r=t&&n?mc.both:t?mc.i:n?mc.ii:void 0,i=r!==void 0,a=r??mc.i;e.setParam(`chLfo`,`frequency`,a.rate),e.setParam(`chDepthL`,`gain`,a.depth),e.setParam(`chDepthR`,`gain`,-a.depth),e.setParam(`chWet`,`gain`,i?.7:0),e.setParam(`chDry`,`gain`,i?.75:1)}},gc={"env.attack":1,"env.decay":30,"env.sustain":0,"env.release":200,"env.keytrack":0,"env.velocity":.5,"env.legato":0,"gen.noise":1,"gen.cutoff":100,"gen.reso":.2,"gen.keytrack":.5,"gen.envAmt":0,"gen.onePole":0,"gen.gain":1.5,"fb.push":0,"fb.decay":2,"fb.release":.4,"sat.hardness":.3,"sat.symmetry":0,"patch.volume":.8,"delay.tune":0,"delay.fine":0,"delay.harmonics":0,"delay.split":0,"delay.splitPoint":.5,"delay.polarity":0,"filter.highpass":-36,"filter.lowpass":36,"filter.hpComp":1,"filter.lpComp":1,"voice.mode":`poly`,"voice.detune":12,"voice.glide":100,"voice.glideOn":0,"lfo.wave":`sine`,"lfo.rate":5,"lfo.sync":0,"lfo.division":`1/8`,"lfo.delay":0,"lfo.amount":0,"lfo.dest":`pitch`,"rev.mix":.25,"rev.bass":120,"rev.treble":8e3,"rev.size":`medium`,"rev.spread":.5},X=(e,t)=>({name:e,values:t}),_c={"env.attack":60,"env.decay":200,"env.sustain":1,"env.release":250,"gen.noise":.06,"gen.gain":.3,"fb.push":1.2,"fb.decay":4,"fb.release":.3,"sat.hardness":.1,"filter.highpass":-36,"filter.lowpass":30},vc={"gen.gain":1.9},yc=[[X(`Nylon Pluck`,{...vc,"gen.cutoff":90,"gen.keytrack":.7,"fb.decay":1.8,"fb.release":.25,"filter.lowpass":30,"sat.hardness":.2,"rev.mix":.2}),X(`Steel String`,{...vc,"gen.cutoff":120,"delay.harmonics":.12,"fb.decay":3.5,"fb.release":.35,"filter.lowpass":48,"sat.hardness":.4,"env.velocity":.7}),X(`Muted Bass`,{...vc,"delay.tune":-12,"gen.cutoff":70,"gen.keytrack":.2,"fb.decay":.9,"fb.release":.15,"filter.lowpass":18,"filter.highpass":-48,"voice.mode":`mono`,"rev.mix":.08,"patch.volume":1}),X(`Harp`,{...vc,"gen.cutoff":100,"gen.keytrack":.6,"delay.harmonics":.05,"fb.decay":5,"fb.release":.6,"filter.lowpass":36,"rev.size":`large`,"rev.mix":.35}),X(`Marimba`,{...vc,"env.attack":1,"env.decay":20,"gen.cutoff":80,"delay.split":1,"delay.splitPoint":.4,"delay.harmonics":.4,"fb.decay":.7,"fb.release":.2,"filter.lowpass":24,"filter.highpass":-48,"rev.mix":.15}),X(`Glass Bell`,{...vc,"delay.tune":12,"delay.split":1,"delay.splitPoint":.3,"delay.harmonics":.6,"fb.decay":6,"fb.release":2,"sat.hardness":.1,"filter.lowpass":60,"filter.highpass":-48,"rev.size":`large`,"rev.mix":.4}),X(`Wood Block`,{...vc,"env.decay":15,"gen.gain":2,"delay.split":1,"delay.splitPoint":.5,"delay.harmonics":.2,"fb.decay":.25,"fb.release":.1,"filter.lowpass":40,"filter.highpass":-24,"rev.mix":.1}),X(`Kalimba`,{...vc,"delay.tune":12,"gen.noise":.8,"delay.split":1,"delay.splitPoint":.6,"delay.harmonics":.3,"fb.decay":1.2,"fb.release":.3,"filter.lowpass":42,"filter.highpass":-48,"rev.mix":.3})],[X(`Pan Flute`,{..._c,"delay.polarity":1,"voice.mode":`mono`,"env.legato":1,"voice.glideOn":1,"voice.glide":60,"lfo.amount":.12,"lfo.rate":5,"lfo.delay":.6,"lfo.dest":`pitch`,"rev.mix":.3}),X(`Clarinet`,{..._c,"delay.polarity":1,"gen.noise":.1,"gen.gain":.35,"env.attack":30,"sat.hardness":.5,"filter.lowpass":36,"voice.mode":`mono`,"env.legato":1,"rev.mix":.2}),X(`Reed Organ`,{..._c,"gen.noise":.08,"env.attack":40,"env.release":200,"sat.hardness":.6,"sat.symmetry":.2,"filter.lowpass":40,"rev.mix":.25}),X(`Pipe Organ`,{..._c,"gen.noise":.05,"env.attack":80,"env.release":500,"filter.lowpass":24,"rev.size":`large`,"rev.mix":.45}),X(`Brass`,{..._c,"gen.noise":.1,"gen.gain":.5,"env.attack":80,"env.decay":200,"env.sustain":.7,"sat.hardness":.7,"sat.symmetry":.6,"filter.lowpass":42,"lfo.dest":`filter`,"lfo.amount":.1,"lfo.rate":6,"rev.mix":.2}),X(`Overblown`,{..._c,"delay.polarity":1,"lfo.dest":`filter`,"lfo.amount":.6,"lfo.rate":.3,"lfo.wave":`sine`,"rev.mix":.3}),X(`Steam Drone`,{..._c,"env.attack":1500,"env.release":3e3,"gen.noise":.2,"fb.decay":20,"fb.release":3,"voice.mode":`unison`,"voice.detune":25,"rev.size":`large`,"rev.mix":.5,"rev.spread":1}),X(`Wind Chimes`,{"delay.tune":12,"delay.split":1,"delay.splitPoint":.2,"delay.harmonics":.5,"fb.decay":8,"fb.release":4,"filter.lowpass":54,"filter.highpass":-48,"sat.hardness":.05,"rev.size":`large`,"rev.mix":.5,"rev.spread":1})]].flat(),bc=[`poly`,`mono`,`unison`],xc=[`sine`,`tri`,`sqr`,`ramp`,`rnd`],Sc=[`pitch`,`filter`,`steam`,`sat`,`push`],Cc=[`1/1`,`1/2`,`1/4`,`1/8`,`1/16`,`1/32`],wc=1,Tc=64,Ec=2,Dc=.8,Oc=3,kc=class extends E{name;transport;slots=[...yc];currentSlot=0;currentPreset=this.slots[0];held=[];bend=0;modWheelValue=0;lfoHz=5;lfoSync=!1;lfoDivision=`1/8`;clockPulses=0;noteListeners=new Set;performanceListeners=new Set;presetListeners=new Set;constructor(e=`Pipe`,t=new T){super(),this.name=e,this.transport=new An(t),this.transport.channel.set(`omni`),this.circuit.add(`pipe`,`pipe`,{atk:.001,dec:.03,sus:0,rel:.2,envKey:0,vel:.5,legato:0,noise:1,nCut:100,nRes:.2,nKey:.5,nEnv:0,onePole:0,gain:.8,tune:0,fine:0,harm:0,split:0,splitPt:.5,pol:0,fbDec:2,fbRel:.4,push:0,satHard:.3,satSym:0,hp:-36,lp:36,hpComp:1,lpComp:1,mode:0,detune:12,glide:.1,glideOn:0,spread:.5,volume:.8,lfoRate:5,lfoShape:0,lfoDelay:0,lfoAmt:0,lfoDest:0,bend:0,mod:0}).add(`dry`,`gain`,{gain:1}).add(`revIn`,`gain`,{gain:1}).add(`conv`,`convolver`,{},{size:`medium`}).add(`revLow`,`filter`,{frequency:120,Q:.707,detune:0},{type:`highpass`}).add(`revHigh`,`filter`,{frequency:8e3,Q:.707,detune:0},{type:`lowpass`}).add(`wet`,`gain`,{gain:0}).add(`sum`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`pipe`,`dry`).connect(`pipe`,`revIn`).connect(`revIn`,`conv`).connect(`conv`,`revLow`).connect(`revLow`,`revHigh`).connect(`revHigh`,`wet`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`}),this.addControls(),this.transport.tempo.onChange(()=>this.applyLfoRate())}addControls(){let e=this.circuit,t=gc,n=(e,n,r,i,a,o,s)=>this.controlList.push(new D(e,n,r,i,t[e],a,o,s)),r=(t,r,i,a,o,s,c=1,l)=>n(t,r,i,a,o,t=>e.setParam(`pipe`,s,t*c),l),i=(n,r,i)=>this.controlList.push(new k(n,r,(t[n]??0)>0,t=>e.setParam(`pipe`,i,+!!t)));r(`env.attack`,`Attack`,.5,1e4,`ms`,`atk`,1/1e3,`log`),r(`env.decay`,`Decay`,1,1e4,`ms`,`dec`,1/1e3,`log`),r(`env.sustain`,`Sustain`,0,1,``,`sus`),r(`env.release`,`Release`,5,2e4,`ms`,`rel`,1/1e3,`log`),r(`env.keytrack`,`Keytrack`,0,1,``,`envKey`),r(`env.velocity`,`Velocity`,0,1,``,`vel`),i(`env.legato`,`Legato`,`legato`),r(`gen.noise`,`DC / Noise`,0,1,``,`noise`),r(`gen.cutoff`,`Cutoff`,30,140,`pitch`,`nCut`),r(`gen.reso`,`Resonance`,0,1,``,`nRes`),r(`gen.keytrack`,`Keytrack`,0,1,``,`nKey`),r(`gen.envAmt`,`Env amount`,-48,48,`st`,`nEnv`),r(`gen.gain`,`Gain`,0,2,``,`gain`),i(`gen.onePole`,`1-pole`,`onePole`),r(`fb.push`,`Push`,0,1.5,``,`push`),r(`fb.decay`,`Decay`,.05,30,`s`,`fbDec`,1,`log`),r(`fb.release`,`Release`,.02,20,`s`,`fbRel`,1,`log`),r(`sat.hardness`,`Soft / Hard`,0,1,``,`satHard`),r(`sat.symmetry`,`Symmetry`,0,1,``,`satSym`),r(`patch.volume`,`Volume`,0,1.2,``,`volume`),r(`delay.tune`,`Tune`,-24,24,`st`,`tune`),r(`delay.fine`,`Fine`,-100,100,`ct`,`fine`),r(`delay.harmonics`,`Harmonics`,0,1,``,`harm`),r(`delay.splitPoint`,`Split point`,.05,.95,``,`splitPt`),i(`delay.split`,`Split`,`split`),i(`delay.polarity`,`Polarity`,`pol`),r(`filter.highpass`,`Highpass`,-60,36,`st`,`hp`),r(`filter.lowpass`,`Lowpass`,0,84,`st`,`lp`),r(`filter.hpComp`,`HP comp`,0,1,``,`hpComp`),r(`filter.lpComp`,`LP comp`,0,1,``,`lpComp`),this.controlList.push(new O(`voice.mode`,`Mode`,bc,`poly`,t=>{this.releaseAll(),e.setParam(`pipe`,`mode`,bc.indexOf(t))})),r(`voice.detune`,`Detune`,0,100,`ct`,`detune`),r(`voice.glide`,`Glide`,1,5e3,`ms`,`glide`,1/1e3,`log`),i(`voice.glideOn`,`Glide on`,`glideOn`),this.controlList.push(new O(`lfo.wave`,`Wave`,xc,`sine`,t=>e.setParam(`pipe`,`lfoShape`,xc.indexOf(t))),new O(`lfo.dest`,`Destination`,Sc,`pitch`,t=>e.setParam(`pipe`,`lfoDest`,Sc.indexOf(t))),new O(`lfo.division`,`Division`,Cc,`1/8`,e=>{this.lfoDivision=e,this.applyLfoRate()}),new k(`lfo.sync`,`Sync`,!1,e=>{this.lfoSync=e,this.applyLfoRate()})),n(`lfo.rate`,`Rate`,.05,40,`Hz`,e=>{this.lfoHz=e,this.applyLfoRate()},`log`),r(`lfo.delay`,`Delay`,0,5,`s`,`lfoDelay`),r(`lfo.amount`,`Amount`,0,1,``,`lfoAmt`),n(`rev.mix`,`Mix`,0,1,``,t=>{e.setParam(`dry`,`gain`,Math.cos(t*Math.PI/2)),e.setParam(`wet`,`gain`,Math.sin(t*Math.PI/2)*Oc)}),n(`rev.bass`,`Bass`,20,800,`Hz`,t=>e.setParam(`revLow`,`frequency`,t),`log`),n(`rev.treble`,`Treble`,1500,16e3,`Hz`,t=>e.setParam(`revHigh`,`frequency`,t),`log`),r(`rev.spread`,`Spread`,0,1,``,`spread`),this.controlList.push(new O(`rev.size`,`Size`,Jn,`medium`,t=>e.setOption(`conv`,`size`,t)))}applyLfoRate(){let e=Number(this.lfoDivision.split(`/`)[1]),t=this.lfoSync?this.transport.bpm/60*e/4:this.lfoHz;this.circuit.setParam(`pipe`,`lfoRate`,Math.min(40,Math.max(.05,t)))}releaseAll(){this.circuit.allNotesOff(`pipe`),this.held.length>0&&(this.held=[],this.notifyNotes())}keyDown(e,t=Dc){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.circuit.noteOn(`pipe`,e,t),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e),this.circuit.noteOff(`pipe`,e),this.notifyNotes()}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}setSustain(e){this.circuit.pedal(`pipe`,e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`pipe`,`bend`,this.bend*Ec),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.circuit.setParam(`pipe`,`mod`,this.modWheelValue),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(e.type===`clock`)this.lfoSync&&this.transport.synced&&++this.clockPulses%24==0&&this.applyLfoRate();else if(`channel`in e&&this.transport.acceptsChannel(e.channel))switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity/127);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===wc?this.setModWheel(e.value/127):e.controller===Tc&&this.setSustain(e.value>=64);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...gc,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e){let t={name:this.slots[e].name,values:this.snapshot()};this.slots[e]=t,this.currentSlot=e,this.currentPreset=t;for(let e of this.presetListeners)e();return t}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}},Ac=[`up`,`down`,`updown`,`order`,`random`],jc=[`1`,`2`,`3`,`4`],Mc=[`1`,`2`,`3`],Nc=[`1/4`,`1/8`,`1/8T`,`1/16`,`1/16T`,`1/32`],Pc={"1/4":24,"1/8":12,"1/8T":8,"1/16":6,"1/16T":4,"1/32":3};function Fc(e,t){return 6e4/t*(Pc[e]/24)}var Ic=class{random;mode=`up`;octaves=1;group=1;position=-1;last;constructor(e=Math.random){this.random=e}pattern(e){let t=this.mode===`order`?[...e]:[...e].sort((e,t)=>e-t),n=[];for(let e=0;e<this.octaves;e++)for(let r of t)r+12*e<=127&&n.push(r+12*e);return this.mode===`down`?n.reverse():this.mode===`updown`&&n.length>2?[...n,...n.slice(1,-1).reverse()]:n}next(e){let t=this.pattern(e);if(t.length===0)return[];this.position=this.mode===`random`?Math.floor(this.random()*t.length):(this.anchor(t)+1)%t.length,this.last=t[this.position];let n=Math.min(this.group,t.length);return[...new Set(Array.from({length:n},(e,n)=>t[(this.position+n)%t.length]))]}reset(){this.position=-1,this.last=void 0}anchor(e){if(this.last===void 0||e[this.position]===this.last)return this.position;let t=this.position,n=1/0;return e.forEach((e,r)=>{e===this.last&&Math.abs(r-this.position)<n&&(t=r,n=Math.abs(r-this.position))}),t}},Lc={off:[0],maj:[0,4,7],min:[0,3,7],7:[0,4,7,10],m7:[0,3,7,10],maj7:[0,4,7,11],sus4:[0,5,7],"5th":[0,7],oct:[0,12]},Rc=[`off`,`maj`,`min`,`7`,`m7`,`maj7`,`sus4`,`5th`,`oct`,`memory`],zc=48;function Bc(e){let t=e.split(`,`).map(e=>Number(e.trim())).filter(e=>Number.isInteger(e)&&e>=0&&e<=zc);return[...new Set([0,...t])].sort((e,t)=>e-t).slice(0,6)}function Vc(e){if(e.length===0)throw Error(`No notes to learn a chord from`);let t=Math.min(...e);return Bc(e.map(e=>String(e-t)).join(`,`)).join(`,`)}function Hc(e,t){return t.map(t=>e+t).filter(e=>e>=0&&e<=127)}var Uc={"osc.wave":`saw`,"osc.width":50,"osc.pwm":0,"osc.vibrato":0,"osc.sub":.3,"filter.cutoff":2400,"filter.resonance":1,"filter.env":2,"filter.lfo":0,"filter.key":50,"amp.lfo":0,"amp.key":0,level:.7,"lfo.wave":`tri`,"lfo.rate":5,"lfo.sync":0,"lfo.division":`1/8`,"env1.attack":.005,"env1.decay":.4,"env1.sustain":.4,"env1.release":.4,"env2.attack":.005,"env2.decay":.3,"env2.sustain":.7,"env2.release":.35,"voices.mode":`poly`,"voices.portamento":0,"voices.detune":12,"fx.chorus":0,"fx.delayTime":.35,"fx.feedback":.3,"fx.mix":0,"arp.on":0,"arp.mode":`up`,"arp.octaves":`1`,"arp.group":`1`,"arp.rate":`1/16`,"arp.gate":50,"arp.latch":0,"chord.type":`off`,"chord.memory":`0,4,7`},Z=(e,t)=>({name:e,values:t}),Wc=[[Z(`Soft Pad`,{"osc.sub":.2,"filter.cutoff":900,"filter.resonance":1.2,"filter.env":1.5,"filter.lfo":.3,"env1.attack":.6,"env1.decay":1.2,"env1.sustain":.5,"env1.release":1.5,"env2.attack":.5,"env2.decay":.8,"env2.sustain":.8,"env2.release":1.6,"lfo.rate":.4,"fx.chorus":.7,"fx.mix":.15,"fx.delayTime":.45,"fx.feedback":.35,level:.6}),Z(`Warm Brass`,{"osc.sub":.3,"filter.cutoff":700,"filter.env":3.2,"osc.vibrato":8,"env1.attack":.12,"env1.decay":.5,"env1.sustain":.55,"env1.release":.25,"env2.attack":.06,"env2.decay":.3,"env2.sustain":.85,"env2.release":.2,"fx.chorus":.3}),Z(`Pluck Bass`,{"voices.mode":`mono`,"osc.sub":.6,"filter.cutoff":350,"filter.resonance":4,"filter.env":3.5,"env1.attack":.001,"env1.decay":.22,"env1.sustain":0,"env1.release":.15,"env2.attack":.001,"env2.decay":.35,"env2.sustain":.5,"env2.release":.1,"voices.portamento":.05}),Z(`Glass Keys`,{"osc.wave":`tri`,"osc.sub":0,"filter.cutoff":5200,"filter.resonance":.5,"filter.env":.5,"env1.attack":.001,"env1.decay":.8,"env1.sustain":.2,"env1.release":.6,"env2.attack":.002,"env2.decay":1.2,"env2.sustain":.1,"env2.release":.8,"fx.chorus":.45,"fx.mix":.2,"fx.delayTime":.3,"fx.feedback":.4}),Z(`Slow Strings`,{"filter.cutoff":3e3,"filter.env":.6,"filter.key":70,"osc.vibrato":12,"lfo.rate":5.5,"env1.attack":.8,"env1.decay":1,"env1.sustain":.7,"env1.release":1.2,"env2.attack":.9,"env2.decay":1,"env2.sustain":.9,"env2.release":1.4,"fx.chorus":.8}),Z(`Sweep Lead`,{"voices.mode":`mono`,"osc.wave":`pulse`,"osc.width":30,"osc.pwm":.4,"osc.sub":.2,"lfo.rate":.7,"filter.cutoff":1500,"filter.resonance":5,"filter.env":2.5,"env1.attack":.001,"env1.decay":.8,"env1.sustain":.35,"env1.release":.3,"env2.sustain":.9,"voices.portamento":.12,"fx.mix":.3,"fx.delayTime":.4,"fx.feedback":.45}),Z(`Wobble Sub`,{"voices.mode":`mono`,"osc.sub":.8,"filter.cutoff":260,"filter.resonance":6,"filter.lfo":2.2,"filter.env":.5,"lfo.sync":1,"lfo.division":`1/8`,"env2.sustain":.95,level:.55}),Z(`Bell Pluck`,{"osc.wave":`tri`,"osc.sub":0,"filter.cutoff":8e3,"filter.resonance":.3,"filter.env":.2,"osc.vibrato":4,"env1.attack":.001,"env1.decay":.5,"env1.sustain":0,"env1.release":.4,"env2.attack":.001,"env2.decay":1.6,"env2.sustain":0,"env2.release":1.4,"fx.chorus":.3,"fx.mix":.3,"fx.delayTime":.5,"fx.feedback":.5})],[Z(`Init`,{}),Z(`Analog Poly`,{"filter.cutoff":1800,"filter.resonance":1.5,"filter.env":2,"env1.attack":.01,"env1.decay":.5,"env1.sustain":.35,"env1.release":.4,"env2.attack":.01,"env2.decay":.4,"env2.sustain":.75,"env2.release":.4,"fx.chorus":.35}),Z(`Choir Air`,{"osc.wave":`pulse`,"osc.width":40,"osc.pwm":.2,"filter.cutoff":1600,"filter.resonance":2.5,"filter.env":1,"env2.attack":.35,"env2.decay":.6,"env2.sustain":.85,"env2.release":1.1,"fx.chorus":.6,"fx.mix":.2}),Z(`Retro Stab`,{"filter.cutoff":600,"filter.resonance":2,"filter.env":4,"env1.attack":.001,"env1.decay":.22,"env1.sustain":0,"env1.release":.2,"env2.attack":.001,"env2.decay":.25,"env2.sustain":0,"env2.release":.2,"fx.chorus":.5}),Z(`Fifth Lead`,{"voices.mode":`unison`,"voices.detune":18,"filter.cutoff":2600,"filter.resonance":2,"filter.env":1.5,"env2.sustain":.8,"voices.portamento":.08,"fx.mix":.25}),Z(`Dream Wash`,{"osc.sub":.4,"filter.cutoff":1100,"lfo.rate":.3,"filter.lfo":.4,"env1.attack":1.8,"env1.decay":1,"env1.sustain":.6,"env1.release":2.5,"env2.attack":1.5,"env2.decay":1,"env2.sustain":.85,"env2.release":3,"fx.chorus":.9,"fx.mix":.4,"fx.delayTime":.6,"fx.feedback":.6,level:.55}),Z(`Pulse Organ`,{"osc.wave":`pulse`,"osc.width":50,"osc.sub":.5,"filter.cutoff":3200,"filter.resonance":.5,"filter.env":.3,"osc.vibrato":6,"lfo.rate":6.5,"env2.attack":.005,"env2.decay":.1,"env2.sustain":1,"env2.release":.08,"fx.chorus":.3}),Z(`Space Arp`,{"osc.wave":`pulse`,"osc.width":25,"osc.pwm":.6,"lfo.rate":1.2,"filter.cutoff":1e3,"filter.resonance":3,"filter.env":3,"env1.attack":.001,"env1.decay":.25,"env1.sustain":.1,"env1.release":.2,"env2.attack":.002,"env2.decay":.3,"env2.sustain":.2,"env2.release":.25,"fx.mix":.4,"fx.delayTime":.38,"fx.feedback":.55,"fx.chorus":.2})]],Gc=Wc.flat(),Kc=`omni`,qc=1200,Jc=69,Yc=200,Xc=100,Zc=1,Qc=[`saw`,`pulse`,`tri`],$c=[`tri`,`up`,`down`,`sqr`,`rnd`],el=[`1/1`,`1/2`,`1/4`,`1/8`,`1/16`,`1/32`],tl={poly:.45,mono:.6,unison:.34},nl=.65,rl=250,il=class extends E{clock;now;name;transport;slots=[...Gc];currentSlot=Wc[0].length;currentPreset=this.slots[this.currentSlot];allocator=new ec(6);held=[];bend=0;modWheelValue=0;vibratoCents=0;portamento=0;unisonDetune=12;lfoHz=5;lfoSync=!1;lfoDivision=`1/8`;clockPulses=0;arp=new Ic;arpOn=!1;arpLatch=!1;arpRate=`1/16`;arpGate=.5;chordType=`off`;chordMemory=[0,4,7];keyNotes=new Map;noteHolds=new Map;arpKeys=[];arpRunning=!1;arpSounding=[];arpNextTime=0;arpOffTime;arpFreePulses=0;performanceListeners=new Set;noteListeners=new Set;presetListeners=new Set;constructor(e=`Poly`,t=new T,n=()=>performance.now()){super(),this.clock=t,this.now=n,this.name=e,this.transport=new An(t),this.transport.channel.set(Kc);let r=this.circuit;this.addShared(r);for(let e=0;e<6;e++)this.addVoice(r,e);this.addEffects(r),this.outputList.push({name:`out`,nodeId:`level`}),this.addControls(r),this.transport.tempo.onChange(()=>this.applyLfoRate())}keyDown(e){let t=this.held.length===0;this.held=this.held.filter(t=>t!==e),this.held.push(e),this.arpOn?(this.arpLatch&&t&&(this.arpKeys=[]),this.arpKeys=[...this.arpKeys.filter(t=>t!==e),e],this.startArp()):this.playKey(e),this.notifyNotes()}keyUp(e){if(this.held=this.held.filter(t=>t!==e),this.arpOn)this.arpLatch||(this.arpKeys=this.arpKeys.filter(t=>t!==e));else{for(let t of this.keyNotes.get(e)??[])this.unhold(t);this.keyNotes.delete(e)}this.notifyNotes()}tick(e=this.now()){if(this.arpOffTime!==void 0&&e>=this.arpOffTime&&this.arpRelease(),this.arpRunning&&!this.transport.synced)for(this.arpNextTime<e-rl&&(this.arpNextTime=e);this.arpRunning&&this.arpNextTime<=e;)this.arpStep(this.arpNextTime),this.arpNextTime+=Fc(this.arpRate,this.transport.bpm)}learnChord(){return this.held.length!==0&&(this.control(`chord.memory`).set(Vc(this.held)),this.control(`chord.type`).set(`memory`),!0)}get chordMemoryNotes(){return this.chordMemory}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}voiceActive(e){return this.allocator.isActive(e)}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*Yc),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.applyVibrato(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}handleMidi(e){if(e.type===`clock`)this.lfoSync&&this.transport.synced&&++this.clockPulses%24==0&&this.applyLfoRate(),this.arpClock();else if(!(`channel`in e&&!this.transport.acceptsChannel(e.channel)))switch(e.type){case`noteOn`:this.keyDown(e.note);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:e.controller===Zc&&this.setModWheel(e.value/127);break;case`programChange`:e.program<this.slots.length&&this.loadSlot(e.program)}}loadPreset(e){let t={...Uc,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else if(t.kind===`toggle`&&typeof r==`number`)t.set(r>0);else if(t.kind===`text`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}loadSlot(e){let t=this.slots[e];if(!t)throw Error(`No patch slot ${e}`);this.currentSlot=e,this.loadPreset(t)}snapshot(){let e={};for(let t of this.controlList)e[t.id]=t.kind===`toggle`?+!!t.value:t.value;return e}saveSlot(e,t=this.slots[e].name){let n={name:t,values:this.snapshot()};this.slots[e]=n,this.currentSlot=e,this.currentPreset=n;for(let e of this.presetListeners)e();return n}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}chordIntervals(){return this.chordType===`memory`?this.chordMemory:Lc[this.chordType]}playKey(e){let t=this.keyNotes.get(e)??[],n=Hc(e,this.chordIntervals());for(let e of n)this.hold(e);for(let e of t)this.unhold(e);this.keyNotes.set(e,n)}hold(e){this.noteHolds.set(e,(this.noteHolds.get(e)??0)+1),this.apply(this.allocator.noteOn(e))}unhold(e){let t=(this.noteHolds.get(e)??0)-1;t>0?this.noteHolds.set(e,t):(this.noteHolds.delete(e),this.apply(this.allocator.noteOff(e)))}setArpOn(e){if(e!==this.arpOn){if(this.arpOn=e,e){for(let e of this.keyNotes.values())for(let t of e)this.unhold(t);this.keyNotes.clear(),this.arpKeys=[...this.held],this.startArp()}else{this.stopArp();for(let e of this.held)this.playKey(e)}}}setArpLatch(e){this.arpLatch=e,e||(this.arpKeys=this.arpKeys.filter(e=>this.held.includes(e)))}arpNotes(){let e=this.chordIntervals();return[...new Set(this.arpKeys.flatMap(t=>Hc(t,e)))]}startArp(){if(!(this.arpRunning||this.arpKeys.length===0)&&(this.arpRunning=!0,this.arp.reset(),!this.transport.synced)){let e=this.now();this.arpStep(e),this.arpNextTime=e+Fc(this.arpRate,this.transport.bpm)}}stopArp(){this.arpRelease(),this.arpRunning=!1,this.arpKeys=[]}arpStep(e){this.arpRelease();let t=this.arp.next(this.arpNotes());if(t.length===0)this.arpRunning=!1;else{this.arpSounding=t;for(let e of t)this.hold(e);this.arpOffTime=e+this.arpGate*Fc(this.arpRate,this.transport.bpm)}}arpRelease(){for(let e of this.arpSounding)this.unhold(e);this.arpSounding=[],this.arpOffTime=void 0}arpClock(){if(!this.arpRunning||!this.transport.synced)return;let e=this.clock.running?this.clock.ticks-1:this.arpFreePulses++;e>=0&&e%Pc[this.arpRate]===0&&this.arpStep(this.now())}apply(e){let t=this.circuit;for(let n of e){let e=e=>`v${n.voice}.${e}`;n.kind===`off`?(t.setParam(e(`env1`),`gate`,0),t.setParam(e(`env2`),`gate`,0)):(n.glide||t.setParam(e(`pitch`),`glide`,0),t.setParam(e(`pitch`),`offset`,(n.note-Jc)*100),n.glide||t.setParam(e(`pitch`),`glide`,this.portamento),n.retrigger&&(t.setParam(e(`env1`),`gate`,1),t.setParam(e(`env2`),`gate`,1)))}}eachVoice(e){for(let t=0;t<6;t++)e(e=>`v${t}.${e}`)}applyMode(e){this.apply(this.allocator.releaseAll()),this.held=[],this.keyNotes.clear(),this.noteHolds.clear(),this.arpKeys=[],this.arpRunning=!1,this.arpSounding=[],this.arpOffTime=void 0,this.allocator.mode=e,this.eachVoice(t=>this.circuit.setParam(t(`out`),`gain`,tl[e])),this.applyDetune(),this.notifyNotes()}applyDetune(){let e=this.allocator.mode===`unison`?this.unisonDetune:0,t=5/2;for(let n=0;n<6;n++){let r=(n-t)/t*e;this.circuit.setParam(`v${n}.det`,`offset`,r===0?0:r)}}applyVibrato(){this.circuit.setParam(`lfoPitch`,`gain`,this.vibratoCents+this.modWheelValue*Xc)}applyLfoRate(){let e=Number(this.lfoDivision.split(`/`)[1]),t=this.lfoSync?this.transport.bpm/60*e/4:this.lfoHz;this.circuit.setParam(`lfoOsc`,`frequency`,t),this.circuit.setParam(`lfoRnd`,`rate`,t)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}addShared(e){e.add(`bend`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:-1200}).add(`pwCv`,`constant`,{offset:0}).add(`lfoOsc`,`oscillator`,{frequency:5,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:5}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoSign`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0}).add(`lfoAmp`,`gain`,{gain:0}).add(`voices`,`gain`,{gain:1}).connect(`lfoOsc`,`lfoOscOut`).connect(`lfoOscOut`,`lfoSign`).connect(`lfoSign`,`lfo`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoRndOut`,`lfo`);for(let t of[`lfoPitch`,`lfoPw`,`lfoFilter`,`lfoAmp`])e.connect(`lfo`,t)}addVoice(e,t){let n=e=>`v${t}.${e}`;e.add(n(`pitch`),`constant`,{offset:0,glide:0}).add(n(`det`),`constant`,{offset:0}).add(n(`osc`),`oscillator`,{frequency:440,detune:0},{waveform:`sawtooth`}).add(n(`sub`),`oscillator`,{frequency:440,detune:0},{waveform:`square`}).add(n(`rawOut`),`gain`,{gain:1}).add(n(`pulseSum`),`gain`,{gain:1}).add(n(`shaper`),`waveshaper`,{},{curve:`pulse`}).add(n(`pulseOut`),`gain`,{gain:0}).add(n(`subLevel`),`gain`,{gain:0}).add(n(`mix`),`gain`,{gain:.5}).add(n(`f1`),`filter`,{frequency:2400,Q:1,detune:0},{type:`lowpass`}).add(n(`f2`),`filter`,{frequency:2400,Q:.707,detune:0},{type:`lowpass`}).add(n(`keyFollow`),`gain`,{gain:.5}).add(n(`env1`),`envelope`,{attack:.005,decay:.4,sustain:.4,release:.4,gate:0}).add(n(`env1Depth`),`gain`,{gain:2*qc}).add(n(`env2`),`envelope`,{attack:.005,decay:.3,sustain:.7,release:.35,gate:0}).add(n(`amp`),`gain`,{gain:0}).add(n(`trem`),`gain`,{gain:1}).add(n(`ampKey`),`gain`,{gain:0}).add(n(`out`),`gain`,{gain:tl.poly});for(let t of[`osc`,`sub`])e.connect(n(`pitch`),n(t),`detune`).connect(n(`det`),n(t),`detune`).connect(`bend`,n(t),`detune`).connect(`lfoPitch`,n(t),`detune`);e.connect(`subShift`,n(`sub`),`detune`).connect(n(`osc`),n(`rawOut`)).connect(n(`osc`),n(`pulseSum`)).connect(`pwCv`,n(`pulseSum`)).connect(`lfoPw`,n(`pulseSum`)).connect(n(`pulseSum`),n(`shaper`)).connect(n(`shaper`),n(`pulseOut`)).connect(n(`rawOut`),n(`mix`)).connect(n(`pulseOut`),n(`mix`)).connect(n(`sub`),n(`subLevel`)).connect(n(`subLevel`),n(`mix`)).connect(n(`mix`),n(`f1`)).connect(n(`f1`),n(`f2`)).connect(n(`f2`),n(`amp`)).connect(n(`env1`),n(`env1Depth`)).connect(n(`pitch`),n(`keyFollow`));for(let t of[`f1`,`f2`])e.connect(n(`env1Depth`),n(t),`detune`).connect(n(`keyFollow`),n(t),`detune`).connect(`lfoFilter`,n(t),`detune`);e.connect(n(`env2`),n(`amp`),`gain`).connect(n(`amp`),n(`trem`)).connect(`lfoAmp`,n(`trem`),`gain`).connect(n(`pitch`),n(`ampKey`)).connect(n(`ampKey`),n(`trem`),`gain`).connect(n(`trem`),n(`out`)).connect(n(`out`),`voices`)}addEffects(e){e.add(`chorusDry`,`gain`,{gain:1}).add(`chorusWet`,`gain`,{gain:0}).add(`chDelayA`,`delay`,{delayTime:.016,maxTime:.05}).add(`chDelayB`,`delay`,{delayTime:.024,maxTime:.05}).add(`chLfoA`,`oscillator`,{frequency:.62,detune:0},{waveform:`sine`}).add(`chLfoB`,`oscillator`,{frequency:.83,detune:0},{waveform:`sine`}).add(`chDepthA`,`gain`,{gain:.0025}).add(`chDepthB`,`gain`,{gain:.003}).add(`fxMix`,`gain`,{gain:1}).connect(`voices`,`chorusDry`).connect(`chorusDry`,`fxMix`).connect(`voices`,`chDelayA`).connect(`voices`,`chDelayB`).connect(`chDelayA`,`chorusWet`).connect(`chDelayB`,`chorusWet`).connect(`chorusWet`,`fxMix`).connect(`chLfoA`,`chDepthA`).connect(`chDepthA`,`chDelayA`,`delayTime`).connect(`chLfoB`,`chDepthB`).connect(`chDepthB`,`chDelayB`,`delayTime`),e.add(`dlyLine`,`delay`,{delayTime:.35,maxTime:1.5}).add(`dlyTone`,`filter`,{frequency:4500,Q:.707,detune:0},{type:`lowpass`}).add(`dlyFb`,`gain`,{gain:.3}).add(`dlyWet`,`gain`,{gain:0}).add(`dlySum`,`gain`,{gain:1}).add(`level`,`gain`,{gain:.7}).connect(`fxMix`,`dlySum`).connect(`fxMix`,`dlyLine`).connect(`dlyLine`,`dlyTone`).connect(`dlyTone`,`dlyFb`).connect(`dlyFb`,`dlyLine`).connect(`dlyTone`,`dlyWet`).connect(`dlyWet`,`dlySum`).connect(`dlySum`,`level`)}addControls(e){let t=(e,t,n,r,i,a,o,s)=>this.controlList.push(new D(e,t,n,r,i,a,o,s)),n=e=>t=>this.eachVoice(n=>e(n,t)),r=Uc,i=e=>r[e],a=(r,a,o,s,c)=>t(`${r}.${a}`,o,s,c,i(`${r}.${a}`),`s`,n((t,n)=>e.setParam(t(r),a,n)),`log`),o=r=>t(`${r}.sustain`,`Sustain`,0,1,i(`${r}.sustain`),``,n((t,n)=>e.setParam(t(r),`sustain`,n)));this.controlList.push(new O(`osc.wave`,`Wave`,Qc,r[`osc.wave`],t=>this.eachVoice(n=>{e.setOption(n(`osc`),`waveform`,t===`tri`?`triangle`:`sawtooth`),e.setParam(n(`rawOut`),`gain`,t===`pulse`?0:1),e.setParam(n(`pulseOut`),`gain`,t===`pulse`?nl:0)}))),t(`osc.width`,`Width`,5,50,i(`osc.width`),`%`,t=>e.setParam(`pwCv`,`offset`,1-2*t/100)),t(`osc.pwm`,`LFO PWM`,0,100,i(`osc.pwm`)*100,`%`,t=>e.setParam(`lfoPw`,`gain`,t/100*.9)),t(`osc.vibrato`,`LFO Pitch`,0,100,i(`osc.vibrato`),`ct`,e=>{this.vibratoCents=e,this.applyVibrato()}),t(`osc.sub`,`Sub`,0,1,i(`osc.sub`),``,n((t,n)=>e.setParam(t(`subLevel`),`gain`,n*.6))),t(`filter.cutoff`,`Cutoff`,20,2e4,i(`filter.cutoff`),`Hz`,n((t,n)=>{e.setParam(t(`f1`),`frequency`,n),e.setParam(t(`f2`),`frequency`,n)}),`log`),t(`filter.resonance`,`Resonance`,.1,20,i(`filter.resonance`),``,n((t,n)=>e.setParam(t(`f1`),`Q`,n))),t(`filter.env`,`Env 1`,0,6,i(`filter.env`),`oct`,n((t,n)=>e.setParam(t(`env1Depth`),`gain`,n*qc))),t(`filter.lfo`,`LFO`,0,4,i(`filter.lfo`),`oct`,t=>e.setParam(`lfoFilter`,`gain`,t*qc)),t(`filter.key`,`Key track`,0,100,i(`filter.key`),`%`,n((t,n)=>e.setParam(t(`keyFollow`),`gain`,n/100))),t(`amp.lfo`,`LFO`,0,100,i(`amp.lfo`),`%`,t=>e.setParam(`lfoAmp`,`gain`,t/100*.8)),t(`amp.key`,`Key track`,0,100,i(`amp.key`),`%`,n((t,n)=>e.setParam(t(`ampKey`),`gain`,n/100/6e3))),t(`level`,`Volume`,0,1,i(`level`),``,t=>e.setParam(`level`,`gain`,t)),this.controlList.push(new O(`lfo.wave`,`Wave`,$c,r[`lfo.wave`],t=>{e.setOption(`lfoOsc`,`waveform`,t===`sqr`?`square`:t===`up`||t===`down`?`sawtooth`:`triangle`),e.setParam(`lfoSign`,`gain`,t===`down`?-1:1),e.setParam(`lfoOscOut`,`gain`,t===`rnd`?0:1),e.setParam(`lfoRndOut`,`gain`,+(t===`rnd`))})),t(`lfo.rate`,`Rate`,.1,30,i(`lfo.rate`),`Hz`,e=>{this.lfoHz=e,this.applyLfoRate()},`log`),this.controlList.push(new k(`lfo.sync`,`Sync`,!1,e=>{this.lfoSync=e,this.applyLfoRate()}),new O(`lfo.division`,`Division`,el,r[`lfo.division`],e=>{this.lfoDivision=e,this.applyLfoRate()}));for(let e of[`env1`,`env2`])a(e,`attack`,`Attack`,.001,5),a(e,`decay`,`Decay`,.005,5),o(e),a(e,`release`,`Release`,.005,10);this.controlList.push(new O(`voices.mode`,`Mode`,$s,r[`voices.mode`],e=>this.applyMode(e))),t(`voices.portamento`,`Portamento`,0,2,i(`voices.portamento`),`s`,t=>{this.portamento=t,this.eachVoice(n=>e.setParam(n(`pitch`),`glide`,t))}),t(`voices.detune`,`Detune`,0,50,i(`voices.detune`),`ct`,e=>{this.unisonDetune=e,this.applyDetune()}),t(`fx.chorus`,`Chorus`,0,1,i(`fx.chorus`),``,t=>{e.setParam(`chorusWet`,`gain`,t*.7),e.setParam(`chorusDry`,`gain`,1-t*.25)}),t(`fx.delayTime`,`Delay time`,.01,1,i(`fx.delayTime`),`s`,t=>e.setParam(`dlyLine`,`delayTime`,t),`log`),t(`fx.feedback`,`Feedback`,0,.9,i(`fx.feedback`),``,t=>e.setParam(`dlyFb`,`gain`,t)),t(`fx.mix`,`Delay mix`,0,1,i(`fx.mix`),``,t=>e.setParam(`dlyWet`,`gain`,t)),this.controlList.push(new k(`arp.on`,`Arp`,!1,e=>this.setArpOn(e)),new O(`arp.mode`,`Mode`,Ac,r[`arp.mode`],e=>{this.arp.mode=e}),new O(`arp.octaves`,`Octaves`,jc,r[`arp.octaves`],e=>{this.arp.octaves=Number(e)}),new O(`arp.group`,`Group`,Mc,r[`arp.group`],e=>{this.arp.group=Number(e)}),new O(`arp.rate`,`Rate`,Nc,r[`arp.rate`],e=>{this.arpRate=e})),t(`arp.gate`,`Gate`,5,100,i(`arp.gate`),`%`,e=>{this.arpGate=e/100}),this.controlList.push(new k(`arp.latch`,`Latch`,!1,e=>this.setArpLatch(e)),new O(`chord.type`,`Chord`,Rc,r[`chord.type`],e=>{this.chordType=e}),new _n(`chord.memory`,`Chord memory`,r[`chord.memory`],e=>{this.chordMemory=Bc(e)}))}},al={"spring.length":2,"spring.tension":.5,"spring.drip":.6,"spring.tilt":0,"spring.dwell":.4,"spring.mix":.25},ol=1.6,sl=class extends E{name;constructor(e=`Spring`){super(),this.name=e;let t=this.circuit;t.add(`in`,`gain`,{gain:1}).add(`spring`,`spring`,{tension:.5,drip:.6,decay:2,tilt:0,dwell:.4}).add(`dry`,`gain`,{gain:1}).add(`wet`,`gain`,{gain:0}).add(`sum`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`out`,`gain`,{gain:1}).add(`meterL`,`meter`,{},{channel:`left`}).add(`meterR`,`meter`,{},{channel:`right`}).connect(`in`,`spring`).connect(`in`,`dry`).connect(`spring`,`wet`).connect(`dry`,`sum`).connect(`wet`,`sum`).connect(`sum`,`limiter`).connect(`limiter`,`out`).connect(`out`,`meterL`).connect(`out`,`meterR`),this.inputList.push({name:`in`,nodeId:`in`}),this.outputList.push({name:`out`,nodeId:`out`}),this.meterList.push({name:`out.L`,nodeId:`meterL`},{name:`out.R`,nodeId:`meterR`});let n=(e,t,n,r,i,a,o)=>this.controlList.push(new D(e,t,n,r,al[e],i,a,o));n(`spring.length`,`Length`,.2,8,`s`,e=>t.setParam(`spring`,`decay`,e),`log`),n(`spring.tension`,`Tension`,0,1,``,e=>t.setParam(`spring`,`tension`,e)),n(`spring.drip`,`Drip`,0,1,``,e=>t.setParam(`spring`,`drip`,e)),n(`spring.tilt`,`Tilt`,-1,1,``,e=>t.setParam(`spring`,`tilt`,e)),n(`spring.dwell`,`Dwell`,0,1,``,e=>t.setParam(`spring`,`dwell`,e)),n(`spring.mix`,`Dry / wet`,0,1,``,e=>{t.setParam(`dry`,`gain`,Math.cos(e*Math.PI/2)),t.setParam(`wet`,`gain`,Math.sin(e*Math.PI/2)*ol)})}reset(){for(let e of this.controlList)e.kind===`number`&&e.set(e.initial)}},cl=75,ll=10,ul=15,dl=.3,fl=[`A`,`B`,`C`],pl=[[1,2],[3,4],[5,6]],ml=120,hl=6,gl=1.2,_l=1.5,vl=class extends E{channelCount;returnCount;returnFeeds;lineCount;name;muted=new Set;soloed=new Set;constructor(e=1,t=`Mixer`,n=0,r={},i=0){super(),this.channelCount=e,this.returnCount=n,this.returnFeeds=r,this.lineCount=i,this.name=t;let a=this.circuit;a.add(`main`,`gain`,{gain:1}).add(`limiter`,`compressor`,{threshold:-2,knee:0,ratio:20,attack:.002,release:.12}).add(`ceiling`,`waveshaper`,{},{curve:`limit`}).add(`mainMeter`,`meter`,{},{channel:`mono`}).connect(`main`,`limiter`).connect(`limiter`,`ceiling`).connect(`ceiling`,`mainMeter`),this.outputList.push({name:`main`,nodeId:`ceiling`}),a.add(`key`,`gain`,{gain:1}),this.outputList.push({name:`key`,nodeId:`key`}),this.meterList.push({name:`main`,nodeId:`mainMeter`});for(let e of fl){let t=`bus${e}`;a.add(t,`gain`,{gain:1}).add(`${t}.toMain`,`gain`,{gain:1}).add(`${t}.meterL`,`meter`,{},{channel:`left`}).add(`${t}.meterR`,`meter`,{},{channel:`right`}).connect(t,`${t}.toMain`).connect(`${t}.toMain`,`main`).connect(t,`${t}.meterL`).connect(t,`${t}.meterR`),this.outputList.push({name:t,nodeId:t}),this.meterList.push({name:`${t}.L`,nodeId:`${t}.meterL`},{name:`${t}.R`,nodeId:`${t}.meterR`}),this.controlList.push(new D(`${t}.fader`,`Bus ${e}`,0,1.5,1,``,e=>a.setParam(t,`gain`,e)),new k(`${t}.main`,`To main`,!0,e=>a.setParam(`${t}.toMain`,`gain`,+!!e)))}for(let e=1;e<=6;e++)a.add(`aux${e}`,`gain`,{gain:1}),this.outputList.push({name:`aux${e}`,nodeId:`aux${e}`}),this.controlList.push(new D(`aux${e}.master`,`Aux ${e}`,0,1.5,1,``,t=>a.setParam(`aux${e}`,`gain`,t)));for(let t=1;t<=e;t++)this.addStrip(`ch${t}`,t,`channel`);for(let e=1;e<=n;e++)this.addStrip(`ret${e}`,e,`return`);for(let e=1;e<=i;e++)this.addStrip(`line${e}`,e,`line`);this.controlList.push(new D(`comp.ms`,`Delay comp`,0,dl*1e3,0,`ms`,t=>{for(let n=1;n<=e;n++)a.setParam(`ch${n}.comp`,`delayTime`,t/1e3);for(let e=1;e<=i;e++)a.setParam(`line${e}.comp`,`delayTime`,t/1e3)}),new O(`key.source`,`Key source`,[`off`,...Array.from({length:e},(e,t)=>`${t+1}`)],`off`,t=>{for(let n=1;n<=e;n++)a.setParam(`ch${n}.keySend`,`gain`,+(t===`${n}`))}))}addStrip(e,t,n){let r=this.circuit,i=n!==`channel`,a=t=>`${e}.${t}`;r.add(a(`lowcut`),`filter`,{frequency:ll,Q:.707,gain:0},{type:`highpass`}).add(a(`eqLow`),`filter`,{frequency:80,Q:.707,gain:0},{type:`lowshelf`}).add(a(`eqMid`),`filter`,{frequency:2500,Q:1,gain:0},{type:`peaking`}).add(a(`eqHigh`),`filter`,{frequency:12e3,Q:.707,gain:0},{type:`highshelf`}).add(a(`tapePre`),`filter`,{frequency:ml,Q:.707,gain:0},{type:`lowshelf`}).add(a(`drive`),`gain`,{gain:1/3}).add(a(`sat`),`waveshaper`,{},{curve:`warm`}).add(a(`tapePost`),`filter`,{frequency:ml,Q:.707,gain:0},{type:`lowshelf`}).add(a(`tapeHf`),`filter`,{frequency:9e3,Q:.707,gain:0},{type:`highshelf`}).add(a(`tapeBump`),`filter`,{frequency:70,Q:1,gain:0},{type:`peaking`}).add(a(`tapeMakeup`),`gain`,{gain:1}).add(a(`mute`),`gain`,{gain:1}).add(a(`fader`),`gain`,{gain:.8}).add(a(`pan`),`pan`,{pan:0}).connect(a(`lowcut`),a(`eqLow`)).connect(a(`eqLow`),a(`eqMid`)).connect(a(`eqMid`),a(`eqHigh`)).connect(a(`eqHigh`),a(`tapePre`)).connect(a(`tapePre`),a(`drive`)).connect(a(`drive`),a(`sat`)).connect(a(`sat`),a(`tapePost`)).connect(a(`tapePost`),a(`tapeHf`)).connect(a(`tapeHf`),a(`tapeBump`)).connect(a(`tapeBump`),a(`tapeMakeup`)).connect(a(`tapeMakeup`),a(`mute`)).connect(a(`mute`),a(`fader`)).connect(a(`fader`),a(`pan`)),i?(r.add(a(`meterL`),`meter`,{},{channel:`left`}).add(a(`meterR`),`meter`,{},{channel:`right`}).connect(a(`pan`),a(`meterL`)).connect(a(`pan`),a(`meterR`)),this.meterList.push({name:`${e}.L`,nodeId:a(`meterL`)},{name:`${e}.R`,nodeId:a(`meterR`)})):(r.add(a(`meter`),`meter`,{},{channel:`mono`}).connect(a(`fader`),a(`meter`)).add(a(`keySend`),`gain`,{gain:0}).connect(a(`mute`),a(`keySend`)).connect(a(`keySend`),`key`),this.meterList.push({name:e,nodeId:a(`meter`)})),this.inputList.push({name:e,nodeId:a(`lowcut`)});let o=fl.filter(e=>n!==`return`||this.returnFeeds[t]!==e);n!==`return`&&r.add(a(`comp`),`delay`,{delayTime:0,maxTime:dl}).connect(a(`pan`),a(`comp`));for(let e of o){let t=a(e===`A`&&n!==`return`?`comp`:`pan`);r.add(a(`assign${e}`),`gain`,{gain:0}).connect(t,a(`assign${e}`)).connect(a(`assign${e}`),`bus${e}`)}for(let e=1;e<=6;e++)r.add(a(`aux${e}.pre`),`gain`,{gain:0}).add(a(`aux${e}.post`),`gain`,{gain:1}).add(a(`aux${e}`),`gain`,{gain:0}).connect(a(`mute`),a(`aux${e}.pre`)).connect(a(`fader`),a(`aux${e}.post`)).connect(a(`aux${e}.pre`),a(`aux${e}`)).connect(a(`aux${e}.post`),a(`aux${e}`)).connect(a(`aux${e}`),`aux${e}`);let s=(e,t,n,r,i,o,s,c)=>new D(a(e),t,n,r,i,o,s,c),c=(e,t,n)=>s(e,t,-15,ul,0,`dB`,e=>r.setParam(a(n),`gain`,e));this.controlList.push(new k(a(`lowcutOn`),`Low cut`,!1,e=>r.setParam(a(`lowcut`),`frequency`,e?cl:ll)),c(`eqHigh`,`High`,`eqHigh`),c(`eqMid`,`Mid`,`eqMid`),s(`eqMidFreq`,`Freq`,100,8e3,2500,`Hz`,e=>r.setParam(a(`eqMid`),`frequency`,e),`log`),c(`eqLow`,`Low`,`eqLow`),s(`tape`,`Tape`,0,1,0,``,e=>{let t=1/3+e*(gl-1/3);r.setParam(a(`tapePre`),`gain`,hl*e),r.setParam(a(`tapePost`),`gain`,-6*e),r.setParam(a(`drive`),`gain`,t),r.setParam(a(`tapeMakeup`),`gain`,1/(3*t)),r.setParam(a(`tapeHf`),`gain`,-4*e),r.setParam(a(`tapeBump`),`gain`,_l*e)}));for(let e=1;e<=6;e++)this.controlList.push(s(`aux${e}`,`${e}`,0,1,0,``,t=>r.setParam(a(`aux${e}`),`gain`,t)));for(let[e,t]of pl)this.controlList.push(new k(a(`auxPre${e}${t}`),`Pre ${e}-${t}`,!1,n=>{for(let i of[e,t])r.setParam(a(`aux${i}.pre`),`gain`,+!!n),r.setParam(a(`aux${i}.post`),`gain`,+!n)}));this.controlList.push(s(`pan`,i?`Balance`:`Pan`,-1,1,0,``,e=>r.setParam(a(`pan`),`pan`,e))),i?this.controlList.push(new k(a(`mute`),`Mute`,!1,e=>r.setParam(a(`mute`),`gain`,+!e))):this.controlList.push(new k(a(`mute`),`Mute`,!1,e=>this.setFlag(this.muted,t,e)),new k(a(`solo`),`Solo`,!1,e=>this.setFlag(this.soloed,t,e)));for(let e of o)this.controlList.push(new k(a(`bus${e}`),e,e===`A`,t=>r.setParam(a(`assign${e}`),`gain`,+!!t)));this.controlList.push(s(`fader`,`Fader`,0,1.5,.8,``,e=>r.setParam(a(`fader`),`gain`,e)))}get soloActive(){return this.soloed.size>0}setFlag(e,t,n){n?e.add(t):e.delete(t);for(let e=1;e<=this.channelCount;e++){let t=`ch${e}.mute`;if(!this.circuit.nodes.has(t))continue;let n=this.muted.has(e)||this.soloed.size>0&&!this.soloed.has(e);this.circuit.setParam(t,`gain`,+!n)}}},yl={"osc.range":`8'`,"osc.width":50,"osc.pwSource":`man`,"osc.pwm":0,"osc.mod":0,"osc.sub":`-1`,"mix.saw":.8,"mix.pulse":0,"mix.sub":.55,"mix.noise":.05,"filter.cutoff":800,"filter.resonance":1,"filter.keyFollow":50,"filter.lfo":0,"filter.model":`clean`,"filter.drive":0,"filterEnv.amount":2,"filterEnv.attack":.005,"filterEnv.decay":.3,"filterEnv.sustain":.3,"filterEnv.release":.3,"ampEnv.attack":.005,"ampEnv.decay":.2,"ampEnv.sustain":.7,"ampEnv.release":.3,"lfo.wave":`tri`,"lfo.rate":4.8,"perf.glide":0,"perf.notes":`legato`,accent:0,drive:0,"drive.tilt":0,"drive.even":0,"drive.harmonics":48,level:.5},Q=(e,t)=>({name:e,values:t}),bl=[Q(`Init`,{}),Q(`Sub Bass`,{"osc.range":`16'`,"mix.saw":.5,"mix.sub":.95,"mix.noise":0,"filter.cutoff":380,"filter.resonance":2,"filter.keyFollow":30,"filterEnv.amount":1.5,"filterEnv.attack":.001,"filterEnv.decay":.25,"filterEnv.sustain":.2,"ampEnv.attack":.002,"ampEnv.decay":.3,"ampEnv.sustain":.85,"ampEnv.release":.12,level:.6}),Q(`Acid Squelch`,{"osc.range":`16'`,"mix.saw":1,"mix.sub":.35,"mix.noise":0,"filter.cutoff":220,"filter.resonance":14,"filter.keyFollow":40,"filterEnv.amount":4,"filterEnv.attack":.001,"filterEnv.decay":.18,"filterEnv.sustain":0,"filterEnv.release":.1,"ampEnv.sustain":.9,"ampEnv.release":.08,"perf.glide":.08,accent:.7,level:.45}),Q(`Fat Pulse Bass`,{"osc.range":`16'`,"osc.width":30,"mix.saw":0,"mix.pulse":.9,"mix.sub":.5,"mix.noise":0,"filter.cutoff":520,"filter.resonance":3,"filterEnv.amount":2,"filterEnv.decay":.3,"filterEnv.sustain":.2,"ampEnv.sustain":.85,"ampEnv.release":.1}),Q(`Wobble Bass`,{"osc.range":`16'`,"mix.saw":.8,"mix.sub":.7,"mix.noise":0,"filter.cutoff":300,"filter.resonance":6,"filter.lfo":2,"filterEnv.amount":.5,"filterEnv.sustain":.5,"lfo.wave":`tri`,"lfo.rate":3,"ampEnv.sustain":1,"ampEnv.release":.12,level:.55}),Q(`Funk Pluck`,{"osc.range":`8'`,"osc.width":25,"mix.saw":.3,"mix.pulse":.8,"mix.sub":.3,"mix.noise":0,"filter.cutoff":260,"filter.resonance":5,"filter.keyFollow":60,"filterEnv.amount":3.5,"filterEnv.attack":.001,"filterEnv.decay":.15,"filterEnv.sustain":0,"ampEnv.attack":.001,"ampEnv.decay":.2,"ampEnv.sustain":.3,"ampEnv.release":.1}),Q(`Rubber Bass`,{"osc.range":`16'`,"mix.saw":.7,"mix.sub":.8,"mix.noise":0,"filter.cutoff":150,"filter.resonance":8,"filter.keyFollow":25,"filterEnv.amount":3,"filterEnv.attack":.001,"filterEnv.decay":.3,"filterEnv.sustain":.1,"ampEnv.sustain":.8,"ampEnv.release":.1,level:.55}),Q(`Saw Lead`,{"mix.saw":1,"mix.sub":.2,"mix.noise":0,"filter.cutoff":3e3,"filter.resonance":3,"filter.keyFollow":70,"filterEnv.amount":1,"perf.glide":.06,"osc.mod":15,"lfo.rate":5.5,"ampEnv.sustain":.9,"ampEnv.release":.25}),Q(`Hollow Pulse Lead`,{"osc.width":18,"mix.saw":0,"mix.pulse":1,"mix.sub":0,"mix.noise":0,"filter.cutoff":2500,"filter.resonance":2,"filter.keyFollow":80,"filterEnv.amount":1.5,"filterEnv.attack":.01,"filterEnv.decay":.4,"filterEnv.sustain":.5,"ampEnv.sustain":.8,"ampEnv.release":.2}),Q(`PWM Lead`,{"mix.saw":.2,"mix.pulse":.9,"mix.sub":.2,"mix.noise":0,"osc.pwSource":`lfo`,"osc.pwm":70,"lfo.rate":1.2,"filter.cutoff":3e3,"filter.resonance":2,"filter.keyFollow":70,"filterEnv.amount":1,"ampEnv.sustain":.9,"ampEnv.release":.3}),Q(`Vibrato Lead`,{"mix.saw":.8,"mix.pulse":.4,"mix.sub":.1,"mix.noise":0,"osc.mod":40,"lfo.rate":5.2,"filter.cutoff":2800,"filter.resonance":3,"filter.keyFollow":70,"filterEnv.amount":1.2,"perf.glide":.1,"ampEnv.attack":.01,"ampEnv.sustain":.9,"ampEnv.release":.3}),Q(`Portamento Solo`,{"mix.saw":1,"mix.sub":.3,"mix.noise":0,"perf.glide":.35,"perf.notes":`legato`,"filter.cutoff":2200,"filter.resonance":4,"filterEnv.amount":.8,"filterEnv.sustain":.6,"ampEnv.sustain":1,"ampEnv.release":.2}),Q(`Clarinet`,{"osc.width":50,"mix.saw":0,"mix.pulse":1,"mix.sub":0,"mix.noise":.03,"filter.cutoff":1800,"filter.resonance":1,"filter.keyFollow":70,"filterEnv.amount":1,"filterEnv.attack":.04,"filterEnv.sustain":.6,"ampEnv.attack":.04,"ampEnv.sustain":.9,"ampEnv.release":.12,"osc.mod":8,"lfo.rate":5}),Q(`Brass`,{"mix.saw":1,"mix.pulse":.4,"mix.sub":.2,"mix.noise":0,"filter.cutoff":500,"filter.resonance":2,"filter.keyFollow":60,"filterEnv.amount":3,"filterEnv.attack":.12,"filterEnv.decay":.3,"filterEnv.sustain":.6,"ampEnv.attack":.08,"ampEnv.decay":.2,"ampEnv.sustain":.85,"ampEnv.release":.2}),Q(`Siren`,{"mix.saw":1,"mix.sub":0,"mix.noise":0,"osc.mod":600,"lfo.wave":`tri`,"lfo.rate":.7,"filter.cutoff":4e3,"filter.resonance":2,"filterEnv.amount":0,"ampEnv.sustain":1,"ampEnv.release":.15}),Q(`Random SFX`,{"mix.saw":.5,"mix.pulse":.5,"mix.sub":0,"mix.noise":0,"lfo.wave":`rnd`,"lfo.rate":9,"osc.mod":500,"filter.cutoff":1200,"filter.resonance":8,"filter.lfo":2.5,"filterEnv.amount":0,"ampEnv.attack":.01,"ampEnv.sustain":1,"ampEnv.release":.1,level:.45}),Q(`Snare`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":1,"filter.cutoff":3e3,"filter.resonance":2,"filter.keyFollow":0,"filterEnv.amount":1,"filterEnv.attack":.001,"filterEnv.decay":.1,"filterEnv.sustain":0,"ampEnv.attack":.001,"ampEnv.decay":.18,"ampEnv.sustain":0,"ampEnv.release":.1,level:.6}),Q(`Wind`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":1,"filter.cutoff":500,"filter.resonance":8,"filter.keyFollow":0,"filterEnv.amount":4,"filterEnv.attack":2,"filterEnv.decay":2,"filterEnv.sustain":.5,"filterEnv.release":2,"ampEnv.attack":1.5,"ampEnv.sustain":1,"ampEnv.release":2,level:.5}),Q(`Whistle`,{"mix.saw":0,"mix.pulse":0,"mix.sub":0,"mix.noise":.6,"filter.cutoff":2e3,"filter.resonance":20,"filter.keyFollow":100,"filterEnv.amount":0,"osc.mod":20,"lfo.rate":5,"ampEnv.attack":.05,"ampEnv.sustain":1,"ampEnv.release":.2,level:.35}),Q(`Acid Fold`,{"osc.range":`16'`,"mix.saw":1,"mix.sub":.35,"mix.noise":0,"filter.cutoff":380,"filter.resonance":14,"filter.keyFollow":40,"filterEnv.amount":4,"filterEnv.attack":.001,"filterEnv.decay":.18,"filterEnv.sustain":0,"filterEnv.release":.1,"ampEnv.sustain":.9,"ampEnv.release":.08,"perf.glide":.07,"perf.notes":`legato`,accent:.7,drive:.45,"drive.tilt":6,level:.45}),Q(`Acid Ladder`,{"osc.range":`16'`,"mix.saw":1,"mix.sub":.35,"mix.noise":0,"filter.model":`ladder`,"filter.drive":.5,"filter.cutoff":300,"filter.resonance":15,"filter.keyFollow":40,"filterEnv.amount":4,"filterEnv.attack":.001,"filterEnv.decay":.18,"filterEnv.sustain":0,"filterEnv.release":.1,"ampEnv.sustain":.9,"ampEnv.release":.08,"perf.glide":.07,"perf.notes":`legato`,accent:.7,level:.45})],xl=new Map([[70,`filter.cutoff`],[71,`filter.resonance`],[72,`filterEnv.amount`],[73,`filterEnv.decay`],[74,`ampEnv.decay`],[75,`ampEnv.release`],[76,`osc.width`],[77,`osc.pwm`],[78,`mix.pulse`],[79,`mix.sub`],[80,`mix.noise`],[81,`lfo.rate`],[82,`osc.mod`],[83,`perf.glide`]]);function Sl(e,t){let n=Math.min(127,Math.max(0,t))/127;if(e.kind===`number`)e.set(e.curve===`log`?e.min*(e.max/e.min)**+n:e.min+n*(e.max-e.min));else if(e.kind===`choice`){let t=Math.min(e.options.length-1,Math.floor(n*e.options.length));e.set(e.options[t])}else e.kind===`toggle`&&e.set(t>=64)}var Cl=1200,wl=200,Tl=100,El=1,Dl=440,Ol=4.8,kl=[`man`,`lfo`,`env`],Al=[`legato`,`retrig`],jl=[`tri`,`sqr`,`rnd`],Ml={"16'":-1200,"8'":0,"4'":1200,"2'":2400},Nl={"-1":-1200,"-2":-2400},Pl=.6,Fl=.8,Il=.12,Ll=700,Rl=1.25,zl=class extends E{name;transport;ccMap=new Map(xl);held=[];presetListeners=new Set;currentPreset=bl[0];gateOpen=!1;glideSeconds=0;retrigger=!1;pwSource=`man`;pwmAmount=0;bend=0;modWheelValue=0;oscModCents=0;accentAmount=0;envAmount=2;envDecay=.3;accented=!1;performanceListeners=new Set;noteListeners=new Set;constructor(e=`Synth`,t=new T){super(),this.name=e,this.transport=new An(t);let n=this.circuit;n.add(`pitch`,`constant`,{offset:0,glide:0}).add(`range`,`constant`,{offset:0}).add(`bend`,`constant`,{offset:0}).add(`subShift`,`constant`,{offset:Nl[-1]}).add(`pulseWidthCv`,`constant`,{offset:0}).add(`sawOsc`,`oscillator`,{frequency:Dl,detune:0},{waveform:`sawtooth`}).add(`pulseOsc`,`oscillator`,{frequency:Dl,detune:0},{waveform:`sawtooth`}).add(`pulseSum`,`gain`,{gain:1}).add(`pulseShaper`,`waveshaper`,{},{curve:`pulse`}).add(`subOsc`,`oscillator`,{frequency:Dl,detune:0},{waveform:`square`}).add(`noise`,`noise`).add(`mix.saw`,`gain`,{gain:.8}).add(`mix.pulse`,`gain`,{gain:0}).add(`mix.sub`,`gain`,{gain:.55}).add(`mix.noise`,`gain`,{gain:.05}).add(`mix`,`gain`,{gain:.5}).add(`filter1`,`filter`,{frequency:800,Q:1,detune:0},{type:`lowpass`}).add(`filter2`,`filter`,{frequency:800,Q:.707,detune:0},{type:`lowpass`}).add(`ladder`,`ladder`,{cutoff:800,detune:0,res:.2,drive:0}).add(`filterClean`,`gain`,{gain:1}).add(`filterLadder`,`gain`,{gain:0}).add(`filterOut`,`gain`,{gain:1}).add(`keyFollow`,`gain`,{gain:.5}).add(`amp`,`gain`,{gain:0}).add(`accentAmp`,`gain`,{gain:1}).add(`level`,`gain`,{gain:.5}).add(`driveDry`,`gain`,{gain:1}).add(`driveTiltLo`,`filter`,{frequency:Ll,Q:.707,gain:0,detune:0},{type:`lowshelf`}).add(`driveTiltHi`,`filter`,{frequency:Ll,Q:.707,gain:0,detune:0},{type:`highshelf`}).add(`driveFold`,`fold`,{fold:1,even:0,harmonics:48,pitch:0}).add(`driveWet`,`gain`,{gain:0}).add(`ampEnv`,`envelope`,{attack:.005,decay:.2,sustain:.7,release:.3,gate:0}).add(`filterEnv`,`envelope`,{attack:.005,decay:.3,sustain:.3,release:.3,gate:0}).add(`filterEnvDepth`,`gain`,{gain:2*Cl}).add(`lfoOsc`,`oscillator`,{frequency:Ol,detune:0},{waveform:`triangle`}).add(`lfoRnd`,`random`,{rate:Ol}).add(`lfoOscOut`,`gain`,{gain:1}).add(`lfoRndOut`,`gain`,{gain:0}).add(`lfo`,`gain`,{gain:1}).add(`lfoPitch`,`gain`,{gain:0}).add(`lfoPw`,`gain`,{gain:0}).add(`envPw`,`gain`,{gain:0}).add(`lfoFilter`,`gain`,{gain:0});for(let e of[`sawOsc`,`pulseOsc`,`subOsc`])n.connect(`pitch`,e,`detune`).connect(`range`,e,`detune`).connect(`bend`,e,`detune`);n.connect(`subShift`,`subOsc`,`detune`).connect(`pulseOsc`,`pulseSum`).connect(`pulseWidthCv`,`pulseSum`).connect(`pulseSum`,`pulseShaper`).connect(`sawOsc`,`mix.saw`).connect(`pulseShaper`,`mix.pulse`).connect(`subOsc`,`mix.sub`).connect(`noise`,`mix.noise`);for(let e of[`mix.saw`,`mix.pulse`,`mix.sub`,`mix.noise`])n.connect(e,`mix`);n.connect(`mix`,`filter1`).connect(`filter1`,`filter2`).connect(`filter2`,`filterClean`).connect(`mix`,`ladder`).connect(`ladder`,`filterLadder`).connect(`filterClean`,`filterOut`).connect(`filterLadder`,`filterOut`).connect(`filterOut`,`driveDry`).connect(`filterOut`,`driveTiltLo`).connect(`driveTiltLo`,`driveTiltHi`).connect(`driveTiltHi`,`driveFold`).connect(`driveFold`,`driveWet`).connect(`pitch`,`driveFold`,`pitch`).connect(`range`,`driveFold`,`pitch`).connect(`bend`,`driveFold`,`pitch`).connect(`driveDry`,`amp`).connect(`driveWet`,`amp`).connect(`amp`,`accentAmp`).connect(`accentAmp`,`level`).connect(`ampEnv`,`amp`,`gain`).connect(`filterEnv`,`filterEnvDepth`).connect(`pitch`,`keyFollow`);for(let e of[`filter1`,`filter2`,`ladder`])n.connect(`filterEnvDepth`,e,`detune`).connect(`keyFollow`,e,`detune`).connect(`lfoFilter`,e,`detune`);for(let e of[`sawOsc`,`pulseOsc`,`subOsc`])n.connect(`lfoPitch`,e,`detune`);n.connect(`lfoOsc`,`lfoOscOut`).connect(`lfoRnd`,`lfoRndOut`).connect(`lfoOscOut`,`lfo`).connect(`lfoRndOut`,`lfo`).connect(`lfo`,`lfoPitch`).connect(`lfo`,`lfoPw`).connect(`lfo`,`lfoFilter`).connect(`lfoPw`,`pulseSum`).connect(`filterEnv`,`envPw`).connect(`envPw`,`pulseSum`),this.outputList.push({name:`out`,nodeId:`level`}),this.controlList.push(new O(`osc.range`,`Range`,Object.keys(Ml),`8'`,e=>n.setParam(`range`,`offset`,Ml[e])),new D(`osc.width`,`Width`,5,50,50,`%`,e=>n.setParam(`pulseWidthCv`,`offset`,1-2*e/100)),new O(`osc.sub`,`Sub`,Object.keys(Nl),`-1`,e=>n.setParam(`subShift`,`offset`,Nl[e])),Vl(n,`saw`,`Saw`,.8),Vl(n,`pulse`,`Pulse`,0),Vl(n,`sub`,`Sub`,.55),Vl(n,`noise`,`Noise`,.05),new D(`filter.cutoff`,`Cutoff`,20,2e4,800,`Hz`,e=>{n.setParam(`filter1`,`frequency`,e),n.setParam(`filter2`,`frequency`,e),n.setParam(`ladder`,`cutoff`,e)},`log`),new D(`filter.resonance`,`Resonance`,.1,20,1,``,e=>{n.setParam(`filter1`,`Q`,e),n.setParam(`ladder`,`res`,Math.sqrt((e-.1)/19.9))}),new O(`filter.model`,`Filter`,[`clean`,`ladder`],`clean`,e=>{n.setParam(`filterClean`,`gain`,+(e===`clean`)),n.setParam(`filterLadder`,`gain`,e===`ladder`?Rl:0)}),new D(`filter.drive`,`Filter drive`,0,1,0,``,e=>n.setParam(`ladder`,`drive`,e)),new D(`filter.keyFollow`,`Key`,0,100,50,`%`,e=>n.setParam(`keyFollow`,`gain`,e/100)),new D(`perf.glide`,`Glide`,0,3,0,`s`,e=>{this.glideSeconds=e,n.setParam(`pitch`,`glide`,e)}),new O(`perf.notes`,`Notes`,Al,`legato`,e=>{this.retrigger=e===`retrig`}),new O(`lfo.wave`,`Wave`,jl,`tri`,e=>{n.setOption(`lfoOsc`,`waveform`,e===`sqr`?`square`:`triangle`),n.setParam(`lfoOscOut`,`gain`,e===`rnd`?0:1),n.setParam(`lfoRndOut`,`gain`,+(e===`rnd`))}),new D(`lfo.rate`,`Rate`,.1,30,Ol,`Hz`,e=>{n.setParam(`lfoOsc`,`frequency`,e),n.setParam(`lfoRnd`,`rate`,e)},`log`),new D(`osc.mod`,`Mod`,0,600,0,`ct`,e=>{this.oscModCents=e,this.applyVibrato()}),new O(`osc.pwSource`,`PW src`,kl,`man`,e=>{this.pwSource=e,this.applyPwm()}),new D(`osc.pwm`,`PWM`,0,100,0,`%`,e=>{this.pwmAmount=e/100,this.applyPwm()}),new D(`filter.lfo`,`LFO`,0,4,0,`oct`,e=>n.setParam(`lfoFilter`,`gain`,e*Cl)),new D(`level`,`Level`,0,1,.5,``,e=>n.setParam(`level`,`gain`,e)),new D(`filterEnv.amount`,`Amount`,0,6,2,`oct`,e=>{this.envAmount=e,this.applyAccent()}),...Bl(n,`filterEnv`,{attack:.005,decay:.3,sustain:.3,release:.3},e=>{this.envDecay=e,this.applyAccent()}),new D(`accent`,`Accent`,0,1,0,``,e=>{this.accentAmount=e,this.applyAccent()}),new D(`drive`,`Drive`,0,1,0,``,e=>{let t=Math.min(1,e*3);n.setParam(`driveDry`,`gain`,1-t*.65),n.setParam(`driveFold`,`fold`,.8+e*9),n.setParam(`driveWet`,`gain`,t*.55)}),new D(`drive.even`,`Even`,0,1,0,``,e=>n.setParam(`driveFold`,`even`,e)),new D(`drive.harmonics`,`Harmonics`,4,128,48,``,e=>n.setParam(`driveFold`,`harmonics`,e),`log`),new D(`drive.tilt`,`Tilt`,-12,12,0,`dB`,e=>{n.setParam(`driveTiltLo`,`gain`,-e),n.setParam(`driveTiltHi`,`gain`,e)}),...Bl(n,`ampEnv`,{attack:.005,decay:.2,sustain:.7,release:.3}))}get pitchBend(){return this.bend}setPitchBend(e){this.bend=Math.min(1,Math.max(-1,e)),this.circuit.setParam(`bend`,`offset`,this.bend*wl),this.notifyPerformance()}get modWheel(){return this.modWheelValue}setModWheel(e){this.modWheelValue=Math.min(1,Math.max(0,e)),this.applyVibrato(),this.notifyPerformance()}onPerformanceChange(e){return this.performanceListeners.add(e),()=>this.performanceListeners.delete(e)}get heldNotes(){return this.held}onNoteChange(e){return this.noteListeners.add(e),()=>this.noteListeners.delete(e)}applyVibrato(){this.circuit.setParam(`lfoPitch`,`gain`,this.oscModCents+this.modWheelValue*Tl)}notifyPerformance(){for(let e of this.performanceListeners)e()}notifyNotes(){for(let e of this.noteListeners)e()}loadPreset(e){let t={...yl,...e.values};this.currentPreset=e;for(let[n,r]of Object.entries(t)){let t=this.control(n);if(t.kind===`number`&&typeof r==`number`)t.set(r);else if(t.kind===`choice`&&typeof r==`string`)t.set(r);else throw Error(`Preset "${e.name}": bad value for ${n}`)}for(let e of this.presetListeners)e()}onPresetChange(e){return this.presetListeners.add(e),()=>this.presetListeners.delete(e)}keyDown(e,t=100){this.held=this.held.filter(t=>t!==e),this.held.push(e),this.accented=t>=110,this.applyAccent(),this.noteOn(Hl(e)),this.notifyNotes()}keyUp(e){this.held=this.held.filter(t=>t!==e);let t=this.held[this.held.length-1];t===void 0?this.noteOff():this.noteOn(Hl(t)),this.notifyNotes()}handleMidi(e){if(!(`channel`in e&&!this.transport.acceptsChannel(e.channel)))switch(e.type){case`noteOn`:this.keyDown(e.note,e.velocity);break;case`noteOff`:this.keyUp(e.note);break;case`pitchBend`:this.setPitchBend(e.value);break;case`cc`:{if(e.controller===El){this.setModWheel(e.value/127);break}let t=this.ccMap.get(e.controller);t&&Sl(this.control(t),e.value);break}case`programChange`:{let t=bl[e.program];t&&this.loadPreset(t);break}}}applyAccent(){let e=this.accented?this.accentAmount:0,t=this.circuit;t.setParam(`accentAmp`,`gain`,1+e*Pl),t.setParam(`filterEnvDepth`,`gain`,this.envAmount*(1+e*Fl)*Cl),t.setParam(`filterEnv`,`decay`,e>0?Math.min(this.envDecay,Il+(1-e)*this.envDecay):this.envDecay)}applyPwm(){let e=this.pwmAmount*.9;this.circuit.setParam(`lfoPw`,`gain`,this.pwSource===`lfo`?e:0),this.circuit.setParam(`envPw`,`gain`,this.pwSource===`env`?e:0)}noteOn(e){let t=this.gateOpen,n=this.glideSeconds;t||this.circuit.setParam(`pitch`,`glide`,0),this.circuit.setParam(`pitch`,`offset`,Cl*Math.log2(e/Dl)),t||this.circuit.setParam(`pitch`,`glide`,n),(!t||this.retrigger)&&(this.circuit.setParam(`ampEnv`,`gate`,1),this.circuit.setParam(`filterEnv`,`gate`,1)),this.gateOpen=!0}noteOff(){this.circuit.setParam(`ampEnv`,`gate`,0),this.circuit.setParam(`filterEnv`,`gate`,0),this.gateOpen=!1}};function Bl(e,t,n,r){let i=(r,i,a,o)=>new D(`${t}.${r}`,i,a,o,n[r],`s`,n=>e.setParam(t,r,n),`log`);return[i(`attack`,`Attack`,.001,5),r?new D(`${t}.decay`,`Decay`,.005,5,n.decay,`s`,r,`log`):i(`decay`,`Decay`,.005,5),new D(`${t}.sustain`,`Sustain`,0,1,n.sustain,``,n=>e.setParam(t,`sustain`,n)),i(`release`,`Release`,.005,10)]}function Vl(e,t,n,r){return new D(`mix.${t}`,n,0,1,r,``,n=>e.setParam(`mix.${t}`,`gain`,n))}var Hl=e=>Dl*2**((e-69)/12),Ul=class e{devices=new Map;connections=[];output;extraOutputs=[];add(e,t){if(this.devices.has(e))throw Error(`Duplicate device id: ${e}`);return this.devices.set(e,t),this}device(e){let t=this.devices.get(e);if(!t)throw Error(`Unknown device: ${e}`);return t}connect(e,t){if(this.device(e.device).jack(`out`,e.jack),this.device(t.device).jack(`in`,t.jack),this.connections.some(n=>n.to.device===t.device&&n.to.jack===t.jack&&n.from.device===e.device&&n.from.jack===e.jack))throw Error(`Duplicate connection`);return this.connections.push({from:e,to:t}),this}setOutput(e,t){return this.device(e).jack(`out`,t),this.output={device:e,jack:t},this}addOutput(e,t){return this.device(e).jack(`out`,t),this.extraOutputs.push({device:e,jack:t}),this}static reverb(){return new e().add(`reverb`,new Zn(`Reverb`)).setOutput(`reverb`,`out`)}static delay(){return new e().add(`delay`,new Qn(`Delay`)).setOutput(`delay`,`out`)}static ouroboros(){return new e().add(`ouroboros`,new Cr(`Ouroboros`)).setOutput(`ouroboros`,`out`)}static buscomp(){return new e().add(`buscomp`,new Tn(`Bus Comp`)).setOutput(`buscomp`,`out`)}static granular(){return new e().add(`granular`,new cr(`Granular`)).setOutput(`granular`,`out`)}static poly(t=new T){return new e().add(`poly`,new il(`Poly`,t)).setOutput(`poly`,`out`)}static drums(t=new T){let n=new e().add(`drums`,new qn(`Drums`,t)).setOutput(`drums`,Pn[0]);for(let e of Pn.slice(1))n.addOutput(`drums`,e);return n}static synth(t=new T){return new e().add(`synth`,new zl(`Synth`,t)).setOutput(`synth`,`out`)}static lynch(t=new T){return new e().add(`lynch`,new hc(`Lynch`,t)).setOutput(`lynch`,`out`)}static vox(){return new e().add(`vox`,new Rs(`MOA-VOX`)).setOutput(`vox`,`out`)}static choir(){return new e().add(`vox`,new Rs(`MOA-VOX CHOIR`,3)).setOutput(`vox`,`out`)}static unicorn(t=new T){return new e().add(`uni`,new fs(t)).setOutput(`uni`,`out`)}static mpc(t=new T){return new e().add(`mpc`,new li(t)).setOutput(`mpc`,`out`)}static bass(){return new e().add(`bass`,new za(`MOA-BASS`)).setOutput(`bass`,`out`)}static guitar(){return new e().add(`guitar`,new Ya(`MOA-GUITAR`)).setOutput(`guitar`,`out`)}static kit(){return new e().add(`kit`,new ts(`MOA-KIT`)).setOutput(`kit`,`out`)}static m2600(){return new e().add(`m2600`,new aa(`MOA-2600`)).setOutput(`m2600`,`out`)}static rig(){return new e().add(`rig`,new ki(`MOA-RIG`)).setOutput(`rig`,`out`)}static duo(){return new e().add(`duo`,new Nr(`MOA-DUO`)).setOutput(`duo`,`out`)}static df2(t=new T){return new e().add(`lynch`,new hc(`Lynch`,t)).add(`box`,new Gs(`MOA-DF2`)).connect({device:`lynch`,jack:`out`},{device:`box`,jack:`in`}).setOutput(`box`,`out`)}static pipe(t=new T){return new e().add(`pipe`,new kc(`Pipe`,t)).add(`spring`,new sl(`Spring`)).connect({device:`pipe`,jack:`out`},{device:`spring`,jack:`in`}).setOutput(`spring`,`out`)}static mixerRack(){let t=new e().add(`mixer`,new vl(2+Pn.length,`Mixer`,5,{3:`C`,4:`B`},5)),n=t.device(`mixer`);return n.control(`busC.main`).set(!1),n.control(`busB.main`).set(!1),n.control(`key.source`).set(`3`),t.setOutput(`mixer`,`main`)}static default(t=new T){let n=new e().add(`synth`,new zl(`Synth`,t)).add(`poly`,new il(`Poly`,t)).add(`drums`,new qn(`Drums`,t));return e.addRack(n).connect({device:`synth`,jack:`out`},{device:`mixer`,jack:`ch1`}).connect({device:`poly`,jack:`out`},{device:`mixer`,jack:`ch2`}),Pn.forEach((e,t)=>n.connect({device:`drums`,jack:e},{device:`mixer`,jack:`ch${t+3}`})),e.wireRack(n)}static addRack(e,t=0){return e.add(`reverb`,new Zn(`Reverb`)).add(`delay`,new Qn(`Delay`)).add(`ouroboros`,new Cr(`Ouroboros`)).add(`buscomp`,new Tn(`Bus Comp`)).add(`granular`,new cr(`Granular`)).add(`mixer`,new vl(2+Pn.length,`Mixer`,5,{3:`C`,4:`B`},t))}static wireRack(e){e.connect({device:`mixer`,jack:`aux1`},{device:`reverb`,jack:`in`}).connect({device:`mixer`,jack:`aux2`},{device:`delay`,jack:`in`}).connect({device:`reverb`,jack:`out`},{device:`mixer`,jack:`ret1`}).connect({device:`delay`,jack:`out`},{device:`mixer`,jack:`ret2`}),e.connect({device:`mixer`,jack:`busC`},{device:`ouroboros`,jack:`in`}).connect({device:`ouroboros`,jack:`out`},{device:`mixer`,jack:`ret3`}),e.connect({device:`mixer`,jack:`busB`},{device:`buscomp`,jack:`in`}).connect({device:`mixer`,jack:`key`},{device:`buscomp`,jack:`key`}).connect({device:`buscomp`,jack:`out`},{device:`mixer`,jack:`ret4`}),e.connect({device:`mixer`,jack:`aux3`},{device:`granular`,jack:`in`}).connect({device:`granular`,jack:`out`},{device:`mixer`,jack:`ret5`});let t=e.device(`mixer`);return t.control(`busC.main`).set(!1),t.control(`busB.main`).set(!1),t.control(`key.source`).set(`3`),e.setOutput(`mixer`,`main`)}},Wl=`moa.midiBus`,Gl=()=>performance.timeOrigin+performance.now(),Kl=class{now;later;lead;enabled;onMessage;lastSeen=0;channel;listeners=new Set;constructor(e=`moa-midi`,t=Gl,n=(e,t)=>setTimeout(e,t),r,i=0){this.now=t,this.later=n,this.lead=i,this.enabled=ql();let a=r??(typeof BroadcastChannel>`u`?void 0:e=>new BroadcastChannel(e));this.channel=a?.(e),this.channel&&(this.channel.onmessage=e=>{if(!this.enabled)return;let{at:t,data:n}=e.data;if(!Array.isArray(n)||typeof t!=`number`)return;this.lastSeen=performance.now();let r=t-this.now(),i=()=>this.onMessage?.(Uint8Array.from(n),performance.now()+(this.lead>0?Math.max(0,t-this.now()):0));r-this.lead<=1?i():this.later(i,r-this.lead)})}get supported(){return this.channel!==void 0}send(e,t=this.now()){this.channel?.postMessage({at:t,data:Array.from(e)})}setEnabled(e){this.enabled=e;try{localStorage.setItem(Wl,e?`1`:`0`)}catch{}for(let e of this.listeners)e()}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}close(){this.channel?.close()}};function ql(){try{return localStorage.getItem(Wl)!==`0`}catch{return!0}}var Jl=`moa.midiInput`,Yl=`moa.midiOutput`,Xl=class{status=typeof navigator<`u`&&`requestMIDIAccess`in navigator?`idle`:`unsupported`;inputs=[];selectedId;outputs=[];selectedOutputId;onMessage;access;listeners=new Set;async connect(){if(this.status!==`unsupported`){try{this.access=await navigator.requestMIDIAccess({sysex:!1})}catch{this.status=`denied`,this.emit();return}this.status=`ready`,this.access.onstatechange=()=>this.refresh(),this.refresh()}}async connectIfPermitted(){if(this.status===`idle`)try{(await navigator.permissions.query({name:`midi`})).state===`granted`&&await this.connect()}catch{}}select(e){if(this.access)for(let e of this.access.inputs.values())e.onmidimessage=null;if(this.selectedId=e,e){let t=this.access?.inputs.get(e);t&&(t.onmidimessage=e=>{e.data&&this.onMessage?.(e.data,e.timeStamp)});try{localStorage.setItem(Jl,e)}catch{}}this.emit()}selectOutput(e){this.selectedOutputId=e;try{e?localStorage.setItem(Yl,e):localStorage.removeItem(Yl)}catch{}this.emit()}send(e,t){let n=this.selectedOutputId?this.access?.outputs.get(this.selectedOutputId):void 0;n&&n.send(e,t===void 0?void 0:t-performance.timeOrigin)}onChange(e){return this.listeners.add(e),()=>this.listeners.delete(e)}refresh(){if(this.inputs=[...this.access?.inputs.values()??[]].map(e=>({id:e.id,name:e.name??e.id})),this.outputs=[...this.access?.outputs.values()??[]].map(e=>({id:e.id,name:e.name??e.id})),this.selectedOutputId&&!this.outputs.some(e=>e.id===this.selectedOutputId)&&(this.selectedOutputId=void 0),!this.selectedOutputId)try{let e=localStorage.getItem(Yl);e&&this.outputs.some(t=>t.id===e)&&(this.selectedOutputId=e)}catch{}this.selectedId&&this.inputs.some(e=>e.id===this.selectedId)?this.emit():this.select(this.pickDefault())}pickDefault(){let e=null;try{e=localStorage.getItem(Jl)}catch{}return this.inputs.find(t=>t.id===e)?.id??this.inputs.find(e=>/torso|t-?1/i.test(e.name))?.id??(this.inputs.length===1?this.inputs[0]?.id:void 0)}emit(){for(let e of this.listeners)e()}},Zl=[`mixer`,`synth`,`poly`,`drums`,`lynch`,`duo`,`df2`,`pipe`],Ql=[`reverb`,`delay`,`ouroboros`,`buscomp`,`granular`],$l=[`m2600`,`bass`,`bass2`,`guitar`,`guitar2`,`kit`,`mpc`,`unicorn`,`vox`,`choir`,`rig`];[...Zl,...Ql,...$l],[...Ql,...$l];var eu=e=>`moa-control-${e}`,tu=`moa-control-status`;function nu(e){return typeof BroadcastChannel>`u`?void 0:new BroadcastChannel(e)}function ru(e,t){let n=nu(eu(e));return n?(n.onmessage=e=>{e.data&&typeof e.data.type==`string`&&t(e.data)},()=>n.close()):()=>{}}function iu(e,t){let n=nu(tu);n?.postMessage({page:e,state:t}),n?.close()}var au=e=>typeof e==`string`?e===`1`||e===`true`||e===`on`:typeof e==`number`?e!==0:e;function ou(e,t){let n=[];for(let[r,i]of Object.entries(t)){let t=e.devices.get(r);if(!t){n.push(`no device ${r}`);continue}if(i.preset!==void 0){let e=t,a=i.preset;t instanceof zl&&Number.isInteger(a)&&a>=0&&a<bl.length?t.loadPreset(bl[a]):typeof e.loadSlot==`function`&&Number.isInteger(a)&&a>=0&&a<(e.slots?.length??0)?e.loadSlot(a):n.push(`${r}: cannot load preset ${a}`)}let a=t.transport;if(i.channel!==void 0)try{if(!a?.channel)throw Error(`no channel setting`);a.channel.set(i.channel)}catch(e){n.push(`${r}: channel ${i.channel}: ${e.message}`)}for(let[e,a]of Object.entries(i.controls??{}))try{let n=t.control(e);if(n.kind===`number`){let e=typeof a==`number`?a:Number(a);if(Number.isNaN(e))throw Error(`not a number`);n.set(e)}else n.kind===`choice`||n.kind===`text`?n.set(String(a)):n.set(au(a))}catch(t){n.push(`${r}.${e}: ${t.message}`)}}return n}var su=1e3;function cu(e){let t=e.curve===`log`?Math.log(e.value/e.min)/Math.log(e.max/e.min):(e.value-e.min)/(e.max-e.min);return Math.round(t*su)}function lu(e,t){let n=t/su;return e.curve===`log`?e.min*(e.max/e.min)**+n:e.min+n*(e.max-e.min)}function uu(e){let t=e.value;return`${t>=100?t.toFixed(0):t>=10?t.toFixed(1):t>=1?t.toFixed(2):t.toFixed(3)}${e.unit?` `+e.unit:``}`}function du(e){let t=e.value;return`${Math.abs(t)>=100?t.toFixed(0):Math.abs(t)>=10?t.toFixed(1):t.toFixed(2)}${e.unit?` `+e.unit:``}`}function $(e,t,n){let r=document.createElement(e);return t&&(r.className=t),n!==void 0&&(r.textContent=n),r}function fu(e,t,n,{height:r=140,capHeight:i=36,tick:a=14,unity:o}={}){let s=$(`div`,`fader`);s.append($(`div`,`fader-label`,n));let c=$(`div`,`fader-slot`);if(c.style.setProperty(`--slot-h`,`${r}px`),c.style.setProperty(`--cap-h`,`${i}px`),c.style.setProperty(`--tick`,`${a}px`),c.append($(`div`,`fader-track`)),o!==void 0){let t=$(`div`,`fader-unity`),n=(o-e.min)/(e.max-e.min);t.style.top=`${Math.round((1-n)*(r-i)+i/2)}px`,c.append(t)}let l=$(`div`,`fader-cap`);l.append($(`span`,`fader-cap-line`)),c.append(l);let u=$(`input`,`fader-input`);u.type=`range`,u.min=`0`,u.max=String(su),u.setAttribute(`aria-label`,`${t} ${e.label}`),c.append(u);let d=$(`div`,`fader-value`),f=()=>{u.value=String(cu(e));let t=Number(u.value)/su;l.style.top=`${Math.round((1-t)*(r-i))}px`,d.textContent=uu(e),u.setAttribute(`aria-valuetext`,d.textContent)};return u.addEventListener(`input`,()=>{e.set(lu(e,Number(u.value))),f()}),c.addEventListener(`dblclick`,()=>{e.set(e.initial),f()}),e.onChange(f),f(),s.append(c,d),s}var pu=270,mu=160;function hu(e,t,n,r=34,i){let a=$(`div`,`knob-wrap`);a.append($(`div`,`knob-label`,n));let o=$(`div`,`knob`);o.style.width=`${r}px`,o.style.height=`${r}px`,o.tabIndex=0,o.setAttribute(`role`,`slider`),o.setAttribute(`aria-label`,`${t} ${e.label}`),o.setAttribute(`aria-orientation`,`vertical`),o.setAttribute(`aria-valuemin`,String(e.min)),o.setAttribute(`aria-valuemax`,String(e.max));let s=$(`div`,`knob-pointer`);o.append(s);let c=$(`div`,`knob-value`),l=()=>{let t=cu(e)/su;s.style.transform=`rotate(${-135+t*pu}deg)`,c.textContent=i?i(e.value):du(e),o.setAttribute(`aria-valuenow`,String(e.value)),o.setAttribute(`aria-valuetext`,c.textContent)},u=t=>{e.set(lu(e,Math.round(Math.min(1,Math.max(0,t))*su))),l()},d;o.addEventListener(`pointerdown`,t=>{o.setPointerCapture(t.pointerId),d={y:t.clientY,t:cu(e)/su}}),o.addEventListener(`pointermove`,e=>{d&&u(d.t+(d.y-e.clientY)/mu)});let f=()=>{d=void 0};return o.addEventListener(`pointerup`,f),o.addEventListener(`pointercancel`,f),o.addEventListener(`dblclick`,()=>{e.set(e.initial),l()}),o.addEventListener(`keydown`,t=>{let n=cu(e)/su,r=t.shiftKey?.1:.02,i={ArrowUp:n+r,ArrowRight:n+r,ArrowDown:n-r,ArrowLeft:n-r,Home:0,End:1};t.key in i&&(t.preventDefault(),u(i[t.key]))}),e.onChange(l),l(),a.append(o,c),a}function gu(e,t,n,r,i=`btn`){let a=$(`button`,i);a.type=`button`,a.setAttribute(`aria-label`,t);let o=()=>{a.textContent=n(e.value),a.setAttribute(`aria-pressed`,String(e.value)),a.style.background=e.value?r:``,a.style.borderColor=e.value?r:``};return a.addEventListener(`click`,()=>{e.set(!e.value),o()}),e.onChange(o),o(),a}var _u={idle:`Start audio to connect`,internal:`Using the instrument on this page`,none:`No input`,connecting:`Connecting`,live:`Receiving audio from another tab`,missing:`That tab is not open`};function vu(e,t,n,r){let i=$(`div`,`mix-input`),a=$(`span`,`led`),o=$(`select`,`patch-select mix-input-select`);o.setAttribute(`aria-label`,`${n} input`);let s=()=>{let n=e.selection(t),s=e.portNames();o.replaceChildren(...e.hasInternal(t)?[new Option(r,Vt)]:[],new Option(`None`,Ht));for(let e of s)o.add(new Option(e,e));n!==`@internal`&&n!==`@none`&&!s.includes(n)&&o.add(new Option(`${n} (not open)`,n)),o.value=n;let c=e.status(t);a.className=`led input-led input-led-${c}`,i.title=_u[c]};return o.addEventListener(`change`,()=>e.setSelection(t,o.value)),e.onChange(s),s(),i.append(a,o),i}var yu=150;function bu(e,t,n,r,i){let a=$(`section`,`midi-strip`),o=$(`div`,`midi-block`);o.append($(`div`,`fader-label`,`Audio`),r);let s=$(`div`,`midi-block`);s.append($(`div`,`fader-label`,`MIDI input`));let c=$(`div`,`midi-device`);s.append(c);let l=()=>{if(c.replaceChildren(),e.status===`unsupported`)c.append($(`div`,`midi-message`,`MIDI is not available in this browser. Try Chrome or Edge.`));else if(e.status===`denied`)c.append($(`div`,`midi-message`,`MIDI access was blocked. Allow it in the site settings, then reload.`));else if(e.status===`idle`){let t=$(`button`,`btn midi-connect`,`Connect MIDI`);t.type=`button`,t.addEventListener(`click`,()=>void e.connect()),c.append(t)}else{let t=$(`select`,`patch-select`);t.setAttribute(`aria-label`,`MIDI input device`),t.add(new Option(e.inputs.length?`No device selected`:`No MIDI devices found`,``));for(let n of e.inputs)t.add(new Option(n.name,n.id));t.value=e.selectedId??``,t.addEventListener(`change`,()=>e.select(t.value||void 0)),c.append(t)}};e.onChange(l),l();let u,d;if(i?.supported){u=$(`div`,`midi-block`),u.append($(`div`,`fader-label`,`Sequencer bus`));let e=$(`div`,`midi-bus`);d=$(`span`,`led`);let t=$(`button`,`btn btn-small midi-bus-toggle`);t.type=`button`,t.setAttribute(`aria-label`,`Listen to MIDI from the sequencer page in another tab`);let n=()=>{t.textContent=i.enabled?`On`:`Off`,t.setAttribute(`aria-pressed`,String(i.enabled))};t.addEventListener(`click`,()=>i.setEnabled(!i.enabled)),i.onChange(n),n(),e.append(d,t),u.append(e)}let f=$(`div`,`midi-block`);f.append($(`div`,`fader-label`,`Incoming clock`));let p=$(`div`,`midi-bpm`,`--.-`),m=$(`div`,`midi-badges`),h=$(`span`,`badge`,`No clock`),g=$(`span`,`badge`,`Stopped`);m.append(h,g),f.append(p,m);let ee=$(`div`,`midi-block`);ee.append($(`div`,`fader-label`,`Activity`));let _=$(`div`,`midi-leds`),v={note:$(`span`,`led`),cc:$(`span`,`led`),clock:$(`span`,`led`)};for(let[e,t]of[[`note`,`Notes`],[`cc`,`CC`],[`clock`,`Clock`]]){let n=$(`div`,`led-item`);n.append(v[e],$(`span`,void 0,t)),_.append(n)}ee.append(_);let te=$(`div`,`midi-block midi-monitor-block`),y=$(`div`,`midi-monitor-head`);y.append($(`div`,`fader-label`,`Monitor`));let b=$(`button`,`btn btn-small midi-clear`,`Clear`);b.type=`button`,b.addEventListener(`click`,()=>n.clear()),y.append(b);let ne=$(`div`,`midi-log`);ne.setAttribute(`role`,`log`),ne.setAttribute(`aria-label`,`Recent MIDI messages`),te.append(y,ne);let re=()=>{ne.replaceChildren(...n.lines.slice(-5).map(e=>$(`div`,`midi-line midi-line-${e.kind}`,e.text)))};n.onChange(re),re(),a.append(o,s,...u?[u]:[],f,ee,te);let ie=()=>{let e=performance.now(),r=t.bpm,a=t.isLocked(e);p.textContent=r!==void 0&&a?r.toFixed(1):`--.-`,h.textContent=a?`Clock locked`:`No clock`,h.classList.toggle(`on`,a),g.textContent=t.running?`Running`:`Stopped`,g.classList.toggle(`on`,t.running),i&&d&&d.classList.toggle(`on`,e-i.lastSeen<yu);for(let t of[`note`,`cc`,`clock`])v[t].classList.toggle(`on`,e-n.lastSeen[t]<yu);requestAnimationFrame(ie)};return requestAnimationFrame(ie),a}var xu=[[`/mixer/`,`The mixer`],[`/synth/`,`MOA-1`],[`/poly/`,`MOA-6`],[`/drums/`,`MOA-DR`],[`/lynch/`,`Lynch 106`],[`/duo/`,`MOA-DUO`],[`/2600/`,`MOA-2600`],[`/bass/`,`MOA-BASS`],[`/guitar/`,`MOA-GUITAR`],[`/kit/`,`MOA-KIT`],[`/vox/`,`MOA-VOX`],[`/mpc/`,`MOA-60`],[`/rig/`,`MOA-RIG`],[`/unicorn/`,`MOA-UNICORN`],[`/df2/`,`MOA-DF2`],[`/pipe/`,`MOA-PIPE`],[`/seq/`,`MOA-SEQ`],[`/reverb/`,`Reverb`],[`/delay/`,`Delay`],[`/ouroboros/`,`Ouroboros`],[`/buscomp/`,`Bus Comp`],[`/granular/`,`Granular`],[`/records/`,`Records`],[`/`,`moaswift.no`]];function Su(e){let t=document.createElement(`nav`);return t.className=`pipe-nav`,t.innerHTML=xu.filter(([t])=>t!==e).map(([e,t])=>`<a href="${e}">${t}</a>`).join(``),t}var Cu=`#4a9be0`,wu=`#e8742c`,Tu=`#4fb286`,Eu=`#dcb43c`,Du=`#d9628a`,Ou={height:240,capHeight:40,tick:24,unity:1},ku=240,Au=-60;function ju(e,t){let n=e.control(t);if(n.kind!==`number`)throw Error(`${t} is not a number control`);return n}function Mu(e,t){let n=e.control(t);if(n.kind!==`toggle`)throw Error(`${t} is not a toggle control`);return n}function Nu(e,t){let n=$(`div`,`mix-heading`),r=$(`span`,`mix-heading-bar`);return r.style.background=t,n.append(r,$(`h3`,void 0,e)),n}function Pu(e,t=ku){let n=$(`div`,`meter`);n.style.height=`${t}px`,n.setAttribute(`role`,`img`),n.setAttribute(`aria-label`,e);let r=$(`div`,`meter-mask`);n.append(r,$(`div`,`meter-grid`));let i=0;return{element:n,update:e=>{let n=e>0?20*Math.log10(e):Au,a=Math.min(1,Math.max(0,(n-Au)/66));i=Math.max(a,i-.03),r.style.height=`${Math.round((1-i)*t)}px`}}}function Fu(e,t,n,r,i,a,o,s,c){let l=e=>`${t}.${e}`,u=r!==`channel`,d=r===`return`?`FX return ${n}`:r===`line`?`Stereo input ${n}`:`Channel ${n}`,f=$(`section`,r===`return`?`mix-strip mix-strip-return`:r===`line`?`mix-strip mix-strip-line`:`mix-strip`),p=$(`header`,`mix-strip-head`);p.append($(`h2`,void 0,r===`return`?`FX${n}`:r===`line`?`ST${n}`:String(n)),$(`div`,`mix-strip-name`,i)),f.append(p),c&&f.append(vu(c,t,i||d,`Built-in`)),f.append(gu(Mu(e,l(`lowcutOn`)),`${d} low cut 75 Hz`,()=>`Low cut`,Cu,`btn btn-wide`));let m=$(`div`,`mix-group`);m.append(Nu(`EQ`,Cu));let h=$(`div`,`mix-grid-2`);for(let[t,n]of[[`eqHigh`,`High`],[`eqMid`,`Mid`],[`eqLow`,`Low`],[`eqMidFreq`,`Freq`]])h.append(hu(ju(e,l(t)),d,n,32));m.append(h),f.append(m);let g=$(`div`,`mix-group`);g.append(Nu(`Aux`,wu));for(let[t,n]of pl){let r=$(`div`,`aux-row`);r.append(hu(ju(e,l(`aux${t}`)),d,String(t),26),hu(ju(e,l(`aux${n}`)),d,String(n),26),gu(Mu(e,l(`auxPre${t}${n}`)),`${d} aux ${t}-${n} pre-fader`,e=>e?`Pre`:`Post`,wu,`btn btn-small`)),g.append(r)}f.append(g);let ee=$(`div`,`mix-row mix-tape-pan`);ee.append(hu(ju(e,l(`tape`)),d,`Tape`,32),hu(ju(e,l(`pan`)),d,u?`Bal`:`Pan`,32)),f.append(ee);let _=$(`div`,`mix-row`);_.append(gu(Mu(e,l(`mute`)),`${d} mute`,()=>`Mute`,`#e0524a`,`btn`)),r===`channel`&&_.append(gu(Mu(e,l(`solo`)),`${d} solo`,()=>`Solo`,Eu,`btn`)),f.append(_);let v=$(`div`,`mix-group`);v.append(Nu(`Bus`,Tu));let te=$(`div`,`mix-row`);for(let t of fl)e.controls.some(e=>e.id===l(`bus${t}`))&&te.append(gu(Mu(e,l(`bus${t}`)),`${d} assign to bus ${t}`,()=>t,Tu,`btn`));v.append(te),f.append(v);let y=$(`div`,`mix-fader-row`),b=fu(ju(e,l(`fader`)),d,`Level`,Ou);if(y.append(b),u){let n=$(`div`,`meter-pair`);for(let r of[`L`,`R`]){let i=Pu(`${d} ${r} level`),c=e.meters.find(e=>e.name===`${t}.${r}`).nodeId;s.push(()=>i.update(o.readLevel(a,c))),n.append(i.element)}y.append(n)}else{let n=Pu(`${d} level`),r=e.meters.find(e=>e.name===t).nodeId;s.push(()=>n.update(o.readLevel(a,r))),y.append(n.element)}return f.append(y),f}function Iu(e,t,n,r=[],i=[],a={},o,s=[]){let c=$(`div`,`mix-panel`),l=$(`div`,`mix-header`),u=$(`div`,`mix-brand`);u.append($(`div`,`mix-name`,`MOA-MIX`),$(`div`,`mix-subtitle`,`${e.channelCount} channel${e.channelCount===1?``:`s`} · ${e.lineCount>0?`${e.lineCount} stereo input${e.lineCount===1?``:`s`} · `:``}${e.returnCount} FX return${e.returnCount===1?``:`s`} · 3 stereo buses · 6 aux sends`)),l.append(u),c.append(l);let d=$(`div`,`mix-body`),f=[],p=$(`div`,`mix-strips`);for(let i=1;i<=e.channelCount;i++)p.append(Fu(e,`ch${i}`,i,`channel`,r[i-1]??``,t,n,f,o));for(let r=1;r<=e.lineCount;r++)p.append(Fu(e,`line${r}`,r,`line`,s[r-1]??``,t,n,f,o));for(let r=1;r<=e.returnCount;r++)p.append(Fu(e,`ret${r}`,r,`return`,i[r-1]??``,t,n,f));d.append(p);let m=$(`section`,`mix-master`),h=$(`div`,`synth-section-head`),g=$(`span`,`synth-section-bar`);g.style.background=Du,h.append(g,$(`h2`,void 0,`Master`)),m.append(h);let ee=$(`div`,`mix-group`);ee.append(Nu(`Aux masters`,wu));let _=$(`div`,`mix-grid-3`);for(let t=1;t<=6;t++)_.append(hu(ju(e,`aux${t}.master`),`Master`,`Aux ${t}`,36));ee.append(_),m.append(ee);let v=$(`div`,`mix-group`);v.append(Nu(`Monitor`,Eu));let te=$(`div`,`solo-led`);te.append($(`span`,`solo-led-dot`),$(`span`,void 0,`Solo active`)),v.append(te),m.append(v),f.push(()=>te.classList.toggle(`on`,e.soloActive));let y=e.control(`key.source`),b=$(`div`,`mix-group`);b.append(Nu(`Key source`,Du));let ne=$(`div`,`bus-route`),re=[`off`,...Array.from({length:e.channelCount},(e,t)=>`${t+1}`)].map(e=>{let t=$(`button`,`btn`,e===`off`?`Off`:r[Number(e)-1]||e);return t.type=`button`,t.addEventListener(`click`,()=>y.set(e)),ne.append(t),{b:t,value:e}}),ie=()=>{for(let{b:e,value:t}of re)e.setAttribute(`aria-pressed`,String(y.value===t))};y.onChange(ie),ie(),b.append(ne),m.append(b);let ae=$(`div`,`mix-group mix-group-grow`);ae.append(Nu(`Stereo buses`,Tu));let oe=$(`div`,`bus-row`);for(let r of fl){let i=$(`div`,`bus-col`),o=$(`div`,`mix-fader-row`);o.append(fu(ju(e,`bus${r}.fader`),`Bus`,`Bus ${r}`,Ou));let s=$(`div`,`meter-pair`);for(let i of[`L`,`R`]){let a=Pu(`Bus ${r} ${i} level`),o=e.meters.find(e=>e.name===`bus${r}.${i}`).nodeId;f.push(()=>a.update(n.readLevel(t,o))),s.append(a.element)}o.append(s),i.append(o);let c=$(`div`,`bus-route`);c.append(gu(Mu(e,`bus${r}.main`),`Bus ${r} to main`,()=>`To main`,Tu,`btn`));let l=$(`div`,`bus-tag`,a[r]?`→ ${a[r]}`:``);c.append(l);let u=Mu(e,`bus${r}.main`),d=()=>l.classList.toggle(`on`,!u.value&&!!a[r]);u.onChange(d),d(),i.append(c),oe.append(i)}ae.append(oe),m.append(ae),d.append(m),c.append(d);let se=()=>{for(let e of f)e();requestAnimationFrame(se)};return requestAnimationFrame(se),c}zt();var Lu=new T,Ru=new mn,zu=new Xl,Bu=Ul.mixerRack(),Vu=new at(Bu),Hu=document.querySelector(`#app`),Uu=[`Synth`,`Poly`,`Drums: Kick`,`Drums: Snare`,`Drums: Clap`,`Drums: Closed Hat`,`Drums: Open Hat`,`Drums: Ride`,`Drums: Perc`],Wu=[`Lynch 106`,`MOA-DUO`,`MOA-DF2`,`MOA-PIPE`,`MOA-2600`],Gu=[...[1,2,3,4,5,6].map(e=>[`aux${e}`,`Mixer: Aux ${e}`]),[`busB`,`Mixer: Bus B`],[`busC`,`Mixer: Bus C`],[`key`,`Mixer: Key`]],Ku=[`ret1`,`ret2`,`ret3`,`ret4`,`ret5`],qu=[`Reverb`,`Delay`,`Ouroboros`,`Bus Comp`,`Granular`],Ju=new en,Yu=new Wt({ports:()=>Ju.ports,hasInternal:e=>Bu.connections.some(t=>t.to.device===`mixer`&&t.to.jack===e),setInternal:(e,t)=>{let n=Bu.connections.find(t=>t.to.device===`mixer`&&t.to.jack===e);n&&Vu.setCable(n.from,n.to,t)},attach:async(e,t)=>{let n=Vu.context,r=Vu.jackNode(`mixer`,`in`,e);if(!n||!r)throw Error(`Audio is not running`);let i=It(),a=await Ju.subscribe(n,t,e.startsWith(`ret`)?i?80:14:i?90:void 0);if(e.startsWith(`line`)||e.startsWith(`ret`))return a.node.connect(r),()=>a.close();let o=n.createGain();return o.channelCount=1,o.channelCountMode=`explicit`,a.node.connect(o).connect(r),()=>{o.disconnect(),a.close()}}},[...Uu.map((e,t)=>`ch${t+1}`),...Wu.map((e,t)=>`line${t+1}`),...Ku],Object.fromEntries([...Uu.map((e,t)=>[`ch${t+1}`,e]),...Wu.map((e,t)=>[`line${t+1}`,e]),...Ku.map((e,t)=>[e,qu[t]])]));Ju.onChange(()=>Yu.reconcile());var Xu=Xt(It()?80:14);Yu.onChange(()=>{let e=Ku.some(e=>Yu.status(e)===`live`);Bu.device(`mixer`).control(`comp.ms`).set(e?Xu:0)});var Zu=!1,Qu=async()=>{if(Zu)return;Zu=!0,await Vu.start();let e=Vu.context;if(e)for(let[t,n]of Gu){let r=Vu.jackNode(`mixer`,`out`,t);r&&await Ju.publish(e,r,n)}Yu.start(),$u.textContent=`Audio running`,$u.disabled=!0,iu(`mixer`,`started`)},$u=document.createElement(`button`);$u.className=`start`,$u.textContent=`Start audio`,$u.addEventListener(`click`,()=>void Qu()),new URLSearchParams(location.search).has(`embed`)&&(ru(`mixer`,e=>{if(e.type===`start`)Qu();else{e.settings&&ou(Bu,e.settings);for(let[t,n]of Object.entries(e.inputs??{}))Yu.jacks.includes(t)&&Yu.setSelection(t,n,!1)}}),iu(`mixer`,`loaded`));function ed(e,t=performance.now()){let n=cn(e);n&&(Lu.handle(n,t),Ru.record(n,t))}zu.onMessage=(e,t)=>ed(e,t),zu.connectIfPermitted();var td=new Kl;td.onMessage=(e,t)=>ed(e,t),Hu.append(Su(`/mixer/`),bu(zu,Lu,Ru,$u,td)),Hu.append(Iu(Bu.device(`mixer`),`mixer`,Vu,[`Synth`,`Poly`,`Kick`,`Snare`,`Clap`,`Closed Hat`,`Open Hat`,`Ride`,`Perc`],[`Reverb`,`Delay`,`Ouroboros`,`Bus Comp`,`Granular`],{B:`to Bus Comp`,C:`to Ouroboros`},Yu,[`Lynch 106`,`DUO`,`DF2`,`Pipe`,`2600`]));