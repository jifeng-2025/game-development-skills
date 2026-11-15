#!/usr/bin/env node
/**
 * Offline SFX synthesizer (authoring tool only; never loaded by the game). Copied from inkblade AU001.
 * Deterministic: every sound uses a fixed seed, so re-running reproduces identical bytes.
 *
 *   node synth.mjs --audio <game>/assets/audio --ns <package-uuid> --key-prefix <game>/audio [--rate 44100]
 *
 * Writes: <audio>/sfx/<name>[-a|-b..].wav + .wav.meta.json (ForgeaX audio importer), <audio>/clips.ts,
 *         <audio>/tools/manifest.json (file, tier, peak, seconds, sha, desc, guid → feed make-sources.mjs).
 * To add/replace a sound: edit SOUNDS below (and TIERS), re-run. Recipe building blocks are reusable.
 *
 * Palette (GDD: 水墨武侠): inharmonic metal partials (sword ring), filtered noise (cloth / paper / ink),
 * pitch-dropping sine (body / ground impact), short resonant clicks (brass mechanism). No oscillator
 * timbres are exposed raw, so nothing reads as "electronic".
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARGS = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]] : acc), []));
if (!ARGS.audio || !ARGS.ns || !ARGS['key-prefix']) {
  console.error('usage: node synth.mjs --audio <game>/assets/audio --ns <uuid> --key-prefix <game>/audio [--rate 44100]');
  process.exit(2);
}
const SR = Number(ARGS.rate ?? 44100);
const AUDIO = path.resolve(ARGS.audio);
const HERE = path.join(AUDIO, 'tools');
const OUT = path.join(AUDIO, 'sfx');
/** UUID namespace for clip GUIDs: UUIDv5(NS, "<key-prefix>/<file>"). Use the audio plugin's packageId. */
const NS = ARGS.ns;
const KEY_PREFIX = ARGS['key-prefix'];
void fileURLToPath;

// ---------- deterministic helpers ----------
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const buf = (sec) => new Float32Array(Math.max(1, Math.round(sec * SR)));
const TAU = Math.PI * 2;

/** Exponential decay envelope with linear attack. */
function env(t, attack, decay) {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / decay);
}
/** Smooth bell (rise then fall), peak at `peak` seconds. */
function bell(t, peak, width) {
  const x = (t - peak) / width;
  return Math.exp(-x * x);
}

/** State-variable filter run over a noise source with time-varying cutoff and Q. */
function svf(input, cutoff, q, mode) {
  const out = new Float32Array(input.length);
  let low = 0, band = 0;
  for (let i = 0; i < input.length; i += 1) {
    const fc = Math.min(SR * 0.22, Math.max(20, typeof cutoff === 'function' ? cutoff(i / SR) : cutoff));
    const f = 2 * Math.sin(Math.PI * fc / SR);
    const damp = 1 / (typeof q === 'function' ? q(i / SR) : q);
    // two passes for stability at high cutoff
    for (let k = 0; k < 2; k += 1) {
      const high = input[i] - low - damp * band;
      band += f * 0.5 * high;
      low += f * 0.5 * band;
      if (k === 1) out[i] = mode === 'low' ? low : mode === 'high' ? high : band;
    }
  }
  return out;
}
function noise(sec, seed) {
  const r = rng(seed); const b = buf(sec);
  for (let i = 0; i < b.length; i += 1) b[i] = r() * 2 - 1;
  return b;
}
function mix(target, src, gain = 1, offsetSec = 0) {
  const o = Math.round(offsetSec * SR);
  for (let i = 0; i < src.length && i + o < target.length; i += 1) if (i + o >= 0) target[i + o] += src[i] * gain;
  return target;
}
function shape(b, fn) { for (let i = 0; i < b.length; i += 1) b[i] *= fn(i / SR); return b; }

/** Inharmonic metal ring: partial ratios of a free bar / blade, each with its own decay and slight beating. */
function metal(sec, f0, { ratios = [1, 2.756, 5.404, 8.933], decays = [0.5, 0.3, 0.18, 0.1], gains = [1, 0.55, 0.35, 0.2], attack = 0.002, beat = 1.6, glide = 0, seed = 1 } = {}) {
  const r = rng(seed); const b = buf(sec);
  const phases = ratios.map(() => r() * TAU);
  for (let p = 0; p < ratios.length; p += 1) {
    let ph = phases[p], ph2 = phases[p] + 1;
    for (let i = 0; i < b.length; i += 1) {
      const t = i / SR;
      const f = f0 * ratios[p] * (1 + glide * Math.min(1, t / sec));
      ph += TAU * f / SR; ph2 += TAU * (f + beat * (p + 1)) / SR;
      b[i] += (Math.sin(ph) + 0.6 * Math.sin(ph2)) * 0.62 * gains[p] * env(t, attack, decays[p]);
    }
  }
  return b;
}
/** Body / ground impact: sine with a fast pitch drop plus a lowpassed noise transient. */
function thump(sec, fHi, fLo, { decay = 0.12, drop = 0.04, click = 0.6, seed = 2, clickCut = 1800 } = {}) {
  const b = buf(sec); let ph = 0;
  for (let i = 0; i < b.length; i += 1) {
    const t = i / SR;
    const f = fLo + (fHi - fLo) * Math.exp(-t / drop);
    ph += TAU * f / SR;
    b[i] = Math.sin(ph) * env(t, 0.001, decay);
  }
  const n = shape(svf(noise(sec, seed), clickCut, 0.8, 'low'), (t) => env(t, 0.0005, 0.018));
  return mix(b, n, click * 2.2);
}
/** Whoosh: bandpassed noise with a moving centre, bell-shaped amplitude. */
function whoosh(sec, f0, f1, { peak = sec * 0.4, width = sec * 0.22, q = 1.6, seed = 3, curve = 1 } = {}) {
  const n = noise(sec, seed);
  const f = svf(n, (t) => f0 + (f1 - f0) * Math.pow(Math.min(1, t / sec), curve), q, 'band');
  return shape(f, (t) => bell(t, peak, width));
}
/** Cloth flutter: amplitude-modulated lowish band noise. */
function flutter(sec, centre, rate, seed) {
  const r = rng(seed + 9);
  const n = svf(noise(sec, seed), centre, 1.2, 'band');
  let ph = 0;
  return shape(n, (t) => { ph += TAU * (rate * (0.8 + 0.4 * r())) / SR; return 0.5 + 0.5 * Math.sin(ph); });
}
/** Paper crackle: sparse random clicks through a highpass. */
function crackle(sec, density, seed, cut = 3000) {
  const r = rng(seed); const b = buf(sec);
  for (let i = 0; i < b.length; i += 1) if (r() < density / SR) {
    const len = 30 + Math.floor(r() * 90); const a = (r() * 2 - 1);
    for (let k = 0; k < len && i + k < b.length; k += 1) b[i + k] += a * Math.exp(-k / (len * 0.25)) * (r() * 2 - 1);
  }
  return svf(b, cut, 0.9, 'high');
}
/** Brass mechanism click: tiny noise burst exciting two resonances. */
function clack(sec, freqs, seed, decay = 0.03) {
  const b = buf(sec); const r = rng(seed);
  for (const f of freqs) {
    const ph0 = r() * TAU;
    for (let i = 0; i < b.length; i += 1) { const t = i / SR; b[i] += Math.sin(ph0 + TAU * f * t) * env(t, 0.0004, decay) * 0.5; }
  }
  return mix(b, shape(svf(noise(sec, seed + 1), 2600, 1.5, 'band'), (t) => env(t, 0.0003, 0.006)), 1.2);
}
/** Tiny room: a few early reflections and a short damped tail, keeps synthesized sounds from feeling dry/digital. */
function room(b, wet = 0.18, size = 1) {
  const taps = [[0.011, 0.5], [0.019, 0.35], [0.029, 0.28], [0.041, 0.2], [0.057, 0.14]];
  const out = Float32Array.from(b);
  for (const [d, g] of taps) mix(out, b, g * wet * 2, d * size);
  return svf(out, 9000, 0.7, 'low');
}
function normalize(b, peakDb) {
  let m = 0; for (const v of b) m = Math.max(m, Math.abs(v));
  const g = m > 0 ? Math.pow(10, peakDb / 20) / m : 0;
  const fadeIn = Math.round(0.0015 * SR), fadeOut = Math.round(0.006 * SR);
  for (let i = 0; i < b.length; i += 1) {
    let k = g;
    if (i < fadeIn) k *= i / fadeIn;
    if (i > b.length - fadeOut) k *= (b.length - i) / fadeOut;
    b[i] *= k;
  }
  return b;
}
/** Trim trailing near-silence so clips stay short. */
function trim(b, floorDb = -60) {
  const floor = Math.pow(10, floorDb / 20); let end = b.length;
  while (end > SR * 0.03 && Math.abs(b[end - 1]) < floor) end -= 1;
  return b.subarray(0, Math.min(b.length, end + Math.round(0.01 * SR)));
}
function semis(n) { return Math.pow(2, n / 12); }

// ---------- sound recipes ----------
// Loudness tiers (peak dBFS): skill & hit −3, slash & dash −6, enemy & hurt −6, UI −12.
const TIERS = { skill: -3, hit: -3, swing: -6, foe: -6, ui: -12 };

function slash(v, step) {
  const s = 1000 + v * 37 + step * 101;
  const r = rng(s);
  const pitch = 1 + (r() - 0.5) * 0.12;
  if (step < 3) {
    const sec = step === 1 ? 0.2 : 0.22;
    const lo = (step === 1 ? 900 : 650) * pitch, hi = (step === 1 ? 5200 : 4200) * pitch;
    const b = whoosh(sec, step === 1 ? lo : hi, step === 1 ? hi : lo, { peak: 0.06, width: 0.045, q: 1.3, seed: s });
    mix(b, whoosh(sec, 2500 * pitch, 7000 * pitch, { peak: 0.055, width: 0.025, q: 3, seed: s + 1 }), 0.35);
    mix(b, shape(metal(sec, 1800 * pitch, { decays: [0.06, 0.04, 0.03, 0.02], gains: [0.5, 0.3, 0.2, 0.1], seed: s }), (t) => env(t - 0.05, 0.004, 1)), 0.12, 0);
    return room(b, 0.12);
  }
  const sec = 0.4;
  const b = whoosh(sec, 280 * pitch, 2400 * pitch, { peak: 0.11, width: 0.07, q: 1.1, seed: s, curve: 0.6 });
  mix(b, flutter(sec, 420, 38, s), 0.25);
  mix(b, shape(thump(sec, 140, 70, { decay: 0.09, drop: 0.03, click: 0.2, seed: s }), () => 1), 0.55, 0.1);
  mix(b, metal(0.3, 1400 * pitch, { decays: [0.16, 0.1, 0.06, 0.04], gains: [0.6, 0.35, 0.2, 0.1], seed: s }), 0.14, 0.12);
  return room(b, 0.16);
}
function hit(v, crit) {
  const s = 2000 + v * 53 + (crit ? 500 : 0);
  const r = rng(s); const p = 1 + (r() - 0.5) * 0.14;
  const sec = crit ? 0.34 : 0.17;
  const b = thump(sec, 210 * p, 70 * p, { decay: 0.055, drop: 0.018, click: 0.9, seed: s, clickCut: 2400 });
  // wood/iron body: short damped resonances
  mix(b, metal(sec, 620 * p, { ratios: [1, 1.58, 2.31], decays: [0.035, 0.025, 0.016], gains: [0.8, 0.5, 0.3], beat: 7, seed: s }), 0.75);
  // mid "crack" so the hit still reads on laptop speakers
  mix(b, shape(svf(noise(sec, s + 3), 1300 * p, 0.9, 'band'), (t) => env(t, 0.001, 0.035)), 1.6);
  if (crit) {
    mix(b, metal(sec, 3150 * p, { ratios: [1, 1.414, 1.903, 2.62], decays: [0.18, 0.12, 0.08, 0.05], gains: [0.8, 0.6, 0.45, 0.3], beat: 11, seed: s }), 0.38, 0.004);
    mix(b, crackle(0.08, 900, s + 4, 4500), 0.6, 0.002);
  }
  return room(b, 0.1);
}
function dash(v) {
  const s = 3000 + v * 71; const sec = 0.3;
  const b = whoosh(sec, 350, 3600, { peak: 0.12, width: 0.08, q: 0.9, seed: s, curve: 1.4 });
  mix(b, shape(flutter(sec, 650 + v * 60, 46, s), (t) => bell(t, 0.13, 0.08)), 0.6);
  return room(b, 0.1);
}
function qThrust() {
  const s = 4000; const sec = 0.62;
  const b = whoosh(sec, 1200, 5200, { peak: 0.07, width: 0.05, q: 1.8, seed: s });
  mix(b, metal(sec, 1180, { ratios: [1, 2.756, 5.404, 8.933], decays: [0.32, 0.2, 0.12, 0.07], gains: [1, 0.5, 0.3, 0.15], glide: 0.035, beat: 2.2, attack: 0.012, seed: s }), 0.5, 0.025);
  mix(b, whoosh(0.3, 2600, 900, { peak: 0.04, width: 0.05, q: 1.2, seed: s + 2 }), 0.3, 0.06);
  return room(b, 0.2, 1.3);
}
function eWindup() {
  const s = 5000; const sec = 0.28;
  // reversed-feel inhale: rising noise that cuts off sharply
  const b = shape(svf(noise(sec, s), (t) => 300 + 2600 * Math.pow(t / sec, 2), 1.4, 'band'), (t) => Math.pow(Math.min(1, t / (sec * 0.92)), 2.4) * (t > sec * 0.92 ? 0.15 : 1));
  const low = buf(sec); let ph = 0;
  for (let i = 0; i < low.length; i += 1) { const t = i / SR; ph += TAU * (55 + 30 * t / sec) / SR; low[i] = Math.sin(ph) * Math.pow(t / sec, 1.6); }
  mix(b, low, 0.45);
  return room(b, 0.12);
}
function eLand() {
  const s = 5100; const sec = 0.55;
  const b = thump(sec, 120, 38, { decay: 0.2, drop: 0.035, click: 1, seed: s, clickCut: 1400 });
  mix(b, shape(svf(noise(sec, s + 1), (t) => 1600 * Math.exp(-t / 0.08) + 200, 0.8, 'low'), (t) => env(t, 0.001, 0.09)), 0.9);
  mix(b, crackle(0.25, 400, s + 2, 1800), 0.25, 0.01);
  mix(b, metal(0.45, 980, { decays: [0.22, 0.14, 0.08, 0.05], gains: [0.7, 0.4, 0.25, 0.1], seed: s }), 0.22, 0.012);
  return room(b, 0.22, 1.5);
}
function eRefresh() {
  const s = 5200; const sec = 0.85;
  const b = metal(sec, 1568, { ratios: [1, 2.0, 2.756, 5.404], decays: [0.5, 0.32, 0.2, 0.08], gains: [1, 0.35, 0.4, 0.15], attack: 0.004, beat: 2.5, seed: s });
  mix(b, metal(sec, 2349, { ratios: [1, 2.756], decays: [0.35, 0.15], gains: [0.6, 0.25], attack: 0.006, beat: 3.1, seed: s + 1 }), 0.45, 0.05);
  mix(b, whoosh(0.12, 3000, 8000, { peak: 0.02, width: 0.02, q: 2, seed: s + 2 }), 0.15);
  return room(b, 0.3, 1.6);
}
function ultStart() {
  const s = 6000; const sec = 1.25;
  const b = buf(sec); let ph = 0, ph2 = 0;
  for (let i = 0; i < b.length; i += 1) {
    const t = i / SR; const f = 42 + 36 * (t / sec);
    ph += TAU * f / SR; ph2 += TAU * f * 1.5 / SR;
    b[i] = (Math.sin(ph) + 0.35 * Math.sin(ph2)) * bell(t, 0.7, 0.38);
  }
  mix(b, shape(svf(noise(sec, s), (t) => 180 + 900 * (t / sec), 0.9, 'low'), (t) => bell(t, 0.75, 0.35)), 0.9);
  mix(b, shape(crackle(sec, 260, s + 1, 2200), (t) => bell(t, 0.6, 0.35)), 0.45);
  mix(b, metal(0.5, 784, { decays: [0.25, 0.15, 0.1, 0.05], gains: [0.6, 0.3, 0.2, 0.1], attack: 0.03, seed: s }), 0.18, 0.95);
  return room(b, 0.25, 1.8);
}
function ultSlash(v) {
  const s = 6100 + v * 13; const r = rng(s); const p = 0.9 + r() * 0.2; const sec = 0.16;
  const b = whoosh(sec, 1500 * p, 6500 * p, { peak: 0.035, width: 0.025, q: 1.6, seed: s });
  mix(b, metal(sec, 2200 * p, { decays: [0.07, 0.05, 0.03, 0.02], gains: [0.8, 0.4, 0.2, 0.1], seed: s }), 0.4, 0.03);
  mix(b, thump(sec, 160, 80, { decay: 0.03, drop: 0.01, click: 0.6, seed: s }), 0.5, 0.03);
  return room(b, 0.08);
}
function ultEnd() {
  const s = 6200; const sec = 1.3;
  const b = thump(sec, 110, 32, { decay: 0.35, drop: 0.05, click: 1.2, seed: s, clickCut: 1200 });
  mix(b, shape(svf(noise(sec, s + 1), (t) => 2400 * Math.exp(-t / 0.15) + 150, 0.7, 'low'), (t) => env(t, 0.002, 0.22)), 1.1);
  mix(b, crackle(0.6, 700, s + 2, 1500), 0.35, 0.02);
  mix(b, metal(1.1, 1046, { decays: [0.6, 0.38, 0.22, 0.1], gains: [1, 0.45, 0.3, 0.12], attack: 0.01, beat: 1.8, seed: s }), 0.3, 0.06);
  return room(b, 0.3, 2);
}
function telegraph() {
  const s = 7000; const sec = 0.26;
  const b = clack(sec, [880, 1320], s, 0.025);
  mix(b, clack(sec, [740, 1110], s + 1, 0.03), 0.9, 0.075);
  // soft wooden "tok" underneath for urgency without harshness
  mix(b, metal(0.2, 520, { ratios: [1, 2.3], decays: [0.06, 0.03], gains: [0.8, 0.3], beat: 0, seed: s }), 0.5, 0.075);
  return svf(room(b, 0.1), 2000, 0.7, 'low');
}
function killInk(heavy) {
  const s = 8000 + (heavy ? 1 : 0); const sec = heavy ? 0.85 : 0.62; const p = heavy ? semis(-3) : 1;
  const b = shape(svf(noise(sec, s), (t) => (900 * p) * Math.exp(-t / 0.25) + 160, 0.8, 'low'), (t) => env(t, 0.01, heavy ? 0.3 : 0.2));
  // wet blobs: short sine bubbles
  const r = rng(s + 5);
  for (let k = 0; k < (heavy ? 9 : 6); k += 1) {
    const at = 0.02 + r() * sec * 0.5; const f0 = (220 + r() * 260) * p; const bub = buf(0.06); let ph = 0;
    for (let i = 0; i < bub.length; i += 1) { const t = i / SR; ph += TAU * f0 * (1 + 2.5 * t / 0.06) / SR; bub[i] = Math.sin(ph) * env(t, 0.002, 0.012); }
    mix(b, bub, 0.25, at);
  }
  mix(b, shape(crackle(sec, 500, s + 2, 2600), (t) => env(t, 0.02, 0.15)), 0.5, 0.02);
  if (heavy) mix(b, thump(sec, 90, 35, { decay: 0.3, drop: 0.05, click: 0.4, seed: s }), 0.7);
  return room(b, 0.2, 1.4);
}
function playerHurt(v) {
  const s = 9000 + v * 17; const sec = 0.32;
  const b = thump(sec, 150 - v * 12, 55, { decay: 0.08, drop: 0.02, click: 0.7, seed: s, clickCut: 1100 });
  mix(b, shape(flutter(sec, 500, 30, s), (t) => env(t, 0.003, 0.07)), 0.9);
  mix(b, shape(svf(noise(sec, s + 4), 1100, 1, 'band'), (t) => env(t, 0.001, 0.03)), 1.3);
  mix(b, metal(sec, 330, { ratios: [1, 1.5], decays: [0.05, 0.03], gains: [0.6, 0.3], beat: 4, seed: s }), 0.25);
  return svf(room(b, 0.12), 2600, 0.7, 'low');
}
function uiMove() {
  const s = 10000; const sec = 0.07;
  const b = metal(sec, 1180, { ratios: [1, 2.62], decays: [0.018, 0.008], gains: [1, 0.3], beat: 0, glide: -0.04, seed: s });
  mix(b, shape(svf(noise(sec, s), 2000, 2, 'band'), (t) => env(t, 0.0003, 0.004)), 0.4);
  return room(b, 0.08);
}
function uiConfirm() {
  const s = 10100; const sec = 0.24;
  const b = metal(sec, 1318, { ratios: [1, 2.71, 5.15], decays: [0.11, 0.06, 0.03], gains: [1, 0.35, 0.15], beat: 1.2, attack: 0.002, seed: s });
  mix(b, metal(sec, 1976, { ratios: [1, 2.71], decays: [0.08, 0.04], gains: [0.5, 0.15], beat: 1.5, seed: s + 1 }), 0.4, 0.03);
  return room(b, 0.2);
}
function uiHexSelect() {
  const s = 10200; const sec = 0.13;
  const b = shape(svf(noise(sec, s), (t) => 1800 + 3000 * t / sec, 1.1, 'band'), (t) => bell(t, 0.04, 0.025));
  mix(b, crackle(sec, 1400, s + 1, 3500), 0.6);
  mix(b, metal(0.06, 900, { ratios: [1, 2.4], decays: [0.012, 0.006], gains: [1, 0.3], beat: 0, seed: s }), 0.5, 0.05);
  return room(b, 0.1);
}
function uiHexConfirm() {
  const s = 10300; const sec = 0.5;
  const b = metal(sec, 1046, { ratios: [1, 2.71, 5.15], decays: [0.26, 0.14, 0.06], gains: [1, 0.35, 0.12], beat: 1.4, seed: s });
  mix(b, metal(sec, 1568, { ratios: [1, 2.71], decays: [0.2, 0.08], gains: [0.6, 0.2], beat: 1.9, seed: s + 1 }), 0.5, 0.06);
  mix(b, shape(svf(noise(sec, s + 2), 600, 0.8, 'low'), (t) => bell(t, 0.18, 0.12)), 0.35);
  return room(b, 0.25, 1.4);
}
function uiTransition() {
  const s = 10400; const sec = 0.95;
  const b = shape(svf(noise(sec, s), (t) => 250 + 1100 * bell(t, 0.4, 0.3), 0.8, 'low'), (t) => bell(t, 0.42, 0.26));
  const low = buf(sec); let ph = 0;
  for (let i = 0; i < low.length; i += 1) { const t = i / SR; ph += TAU * 62 / SR; low[i] = Math.sin(ph) * bell(t, 0.45, 0.25); }
  mix(b, low, 0.35);
  mix(b, shape(crackle(sec, 120, s + 1, 2500), (t) => bell(t, 0.4, 0.3)), 0.25);
  return room(b, 0.3, 1.8);
}
function roomSeal() {
  const s = 11000; const sec = 0.45;
  const b = buf(sec);
  // ratchet: three brass clicks, then a heavier latch
  for (let k = 0; k < 3; k += 1) mix(b, clack(0.06, [1240 - k * 90, 1860 - k * 120], s + k, 0.018), 0.55, 0.02 + k * 0.055);
  mix(b, clack(0.2, [620, 930, 1450], s + 9, 0.06), 1, 0.2);
  mix(b, thump(0.25, 130, 60, { decay: 0.06, drop: 0.015, click: 0.5, seed: s }), 0.6, 0.2);
  return svf(room(b, 0.2, 1.3), 4200, 0.7, 'low');
}

/** name → { tier, variants: () => Float32Array[], desc } */
const SOUNDS_ALL = {
  'slash-1': { tier: 'swing', make: () => [0, 1, 2].map((v) => slash(v, 1)), desc: '轻破风：带通噪声上扫 + 2.5–7 kHz 刃口擦音 + 极弱金属尾' },
  'slash-2': { tier: 'swing', make: () => [0, 1, 2].map((v) => slash(v, 2)), desc: '反手破风：带通噪声下扫（4.2→0.65 kHz），比 1 段略低' },
  'slash-3': { tier: 'swing', make: () => [0, 1].map((v) => slash(v, 3)), desc: '重劈：低频布风上扫 + 衣袂抖动 + 140→70 Hz 闷压 + 1.4 kHz 金属余振' },
  hit: { tier: 'hit', make: () => [0, 1, 2].map((v) => hit(v, false)), desc: '闷击：210→70 Hz 冲击正弦 + 低通噪声瞬态 + 620 Hz 木/铁短共振' },
  'hit-crit': { tier: 'hit', make: () => [0, 1].map((v) => hit(v, true)), desc: '闷击 + 3.15 kHz 非谐波金属脆响 + 高通纸屑碎响' },
  dash: { tier: 'swing', make: () => [0, 1].map(dash), desc: '布料破风：0.35→3.6 kHz 噪声扫频 + 46 Hz 调幅衣袂抖动' },
  'q-thrust': { tier: 'skill', make: () => [qThrust()], desc: '长虹突刺：快破风 + 1.18 kHz 剑身模态（1/2.756/5.404/8.933）上滑 3.5%' },
  'e-windup': { tier: 'skill', make: () => [eWindup()], desc: '吸气：0.3→2.9 kHz 渐强带通噪声，尾端截断 + 55→85 Hz 墨涌' },
  'e-land': { tier: 'skill', make: () => [eLand()], desc: '落地重击：120→38 Hz 冲击 + 低通扫频尘土 + 碎纸 + 980 Hz 短剑鸣' },
  'e-refresh': { tier: 'skill', make: () => [eRefresh()], desc: '饮墨·再斩：G6(1568 Hz)+D7 双层清亮剑鸣，长衰减，房间尾' },
  'ult-start': { tier: 'skill', make: () => [ultStart()], desc: '千刃开大：42→78 Hz 膨胀低鸣 + 低通墨涌噪声 + 纸张抖动 + 尾部 784 Hz 鸣' },
  'ult-slash': { tier: 'skill', make: () => [0, 1, 2].map(ultSlash), desc: '每斩：极短刃风 + 2.2 kHz 金属点 + 小冲击，音高 ±10%' },
  'ult-end': { tier: 'skill', make: () => [ultEnd()], desc: '收尾大爆：110→32 Hz 重冲击 + 低通墨爆 + 碎纸 + C6 长剑鸣余韵' },
  telegraph: { tier: 'foe', make: () => [telegraph()], desc: '敌人预警：两声黄铜机关「咔嗒」+ 520 Hz 木音，整体低通 2 kHz 不刺耳' },
  'kill-ink': { tier: 'foe', make: () => [killInk(false)], desc: '化墨：低通湿噪声 + 6 个上滑气泡 + 纸撕碎响' },
  'kill-ink-heavy': { tier: 'foe', make: () => [killInk(true)], desc: '化墨（Boss/heavy）：低 3 个半音、更长，加 90→35 Hz 冲击' },
  'player-hurt': { tier: 'foe', make: () => [0, 1].map(playerHurt), desc: '玩家受击：暗色闷钝冲击 + 布料抖动 + 330 Hz 短共振，低通 2.6 kHz' },
  'ui-move': { tier: 'ui', make: () => [uiMove()], desc: '菜单移动：1.18 kHz 木鱼式轻敲，极短' },
  'ui-confirm': { tier: 'ui', make: () => [uiConfirm()], desc: '确认：E6 轻磬音（1/2.71/5.15 模态）+ 五度泛音' },
  'ui-hex-select': { tier: 'ui', make: () => [uiHexSelect()], desc: '三选一选中：纸页翻动（扫频噪声 + 纸屑）+ 轻敲' },
  'ui-hex-confirm': { tier: 'ui', make: () => [uiHexConfirm()], desc: '三选一确认：C6+G6 磬音 + 低通墨晕' },
  'ui-transition': { tier: 'ui', make: () => [uiTransition()], desc: '转场墨晕：低通噪声起伏 + 62 Hz 低鸣 + 稀疏纸声' },
  'room-seal': { tier: 'foe', make: () => [roomSeal()], desc: '房门机关：三声棘轮黄铜咔嗒 + 一声重闩 + 闷响' },
};

// Always regenerate the full set (0.3 s; deterministic) so clips.ts/manifest never lose entries.
const SOUNDS = SOUNDS_ALL;

// ---------- output ----------
function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
function uuidv5(ns, name) {
  const nsBytes = Buffer.from(ns.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(Buffer.concat([nsBytes, Buffer.from(name)])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(HERE, { recursive: true });
const clips = {};
const rows = [];
for (const [name, def] of Object.entries(SOUNDS)) {
  if (def.external) {
    // CC0 / hand-made replacement: the file already sits in sfx/ and is never overwritten here.
    // def.external = [{ file: 'slash-1-a.ogg', seconds: 0.21 }, ...]; GUID derives from the original synth file name
    // ('<name>[-a..].wav') so clips.ts and the plugin config keep the same identity.
    clips[name] = [];
    def.external.forEach(({ file, seconds }, index) => {
      if (!fs.existsSync(path.join(OUT, file))) throw new Error(`external clip missing: sfx/${file}`);
      const orig = def.external.length > 1 ? `${name}-${String.fromCharCode(97 + index)}.wav` : `${name}.wav`;
      const guid = uuidv5(NS, `${KEY_PREFIX}/${orig}`);
      if (orig !== file && fs.existsSync(path.join(OUT, `${orig}.meta.json`))) fs.rmSync(path.join(OUT, `${orig}.meta.json`));
      if (orig !== file && fs.existsSync(path.join(OUT, orig))) fs.rmSync(path.join(OUT, orig));
      const meta = { schemaVersion: '1.0.0', kind: 'external-asset-package', importer: 'audio', source: file,
        importSettings: { playback: 'buffer' }, subAssets: [{ guid, sourceIndex: 0, kind: 'audio', sourceKey: 'audio:audio' }] };
      fs.writeFileSync(path.join(OUT, `${file}.meta.json`), `${JSON.stringify(meta, null, 2)}
`);
      const sha = createHash('sha256').update(fs.readFileSync(path.join(OUT, file))).digest('hex').slice(0, 12);
      clips[name].push({ guid, seconds });
      rows.push({ file, name, tier: def.tier, peak: 'external', seconds: String(seconds), sha, desc: def.desc, guid, external: true });
    });
    continue;
  }
  const variants = def.make();
  clips[name] = [];
  variants.forEach((raw, index) => {
    const file = variants.length > 1 ? `${name}-${String.fromCharCode(97 + index)}.wav` : `${name}.wav`;
    const samples = normalize(trim(raw), TIERS[def.tier]);
    fs.writeFileSync(path.join(OUT, file), wav(samples));
    const guid = uuidv5(NS, `${KEY_PREFIX}/${file}`);
    const meta = {
      schemaVersion: '1.0.0', kind: 'external-asset-package', importer: 'audio', source: file,
      importSettings: { playback: 'buffer' },
      subAssets: [{ guid, sourceIndex: 0, kind: 'audio', sourceKey: 'audio:audio' }],
    };
    fs.writeFileSync(path.join(OUT, `${file}.meta.json`), `${JSON.stringify(meta, null, 2)}\n`);
    const sha = createHash('sha256').update(fs.readFileSync(path.join(OUT, file))).digest('hex').slice(0, 12);
    clips[name].push({ guid, seconds: +(samples.length / SR).toFixed(3) });
    rows.push({ file, name, tier: def.tier, peak: TIERS[def.tier], seconds: (samples.length / SR).toFixed(3), sha, desc: def.desc, guid });
  });
}

const ts = `// GENERATED by synth.mjs (游戏音效制作skill) — do not edit by hand; re-run the tool instead.
/** Sound name → clip variants (GUID of the audio sub-asset, duration in seconds). */
export const CLIPS = ${JSON.stringify(clips, null, 2)} as const;
export type SoundName = keyof typeof CLIPS;
`;
fs.writeFileSync(path.join(AUDIO, 'clips.ts'), ts);
fs.writeFileSync(path.join(HERE, 'manifest.json'), `${JSON.stringify(rows, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, sounds: Object.keys(SOUNDS).length, files: rows.length, totalSeconds: rows.reduce((a, r) => a + Number(r.seconds), 0).toFixed(2) }));
