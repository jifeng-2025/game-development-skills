// TEMPLATE (project-bound): globals __inkRun / __inkVfxStats / __inkKeys and phases title/lines/hex/fight belong to one game.
// Rename them to the target game's debug globals; keep recStart/recStop/recSlice, timingStart/Stop, snap/snapOn as-is.
/**
 * V003 evidence driver for the dev owner page (engine workers off → one realm). Not loaded by the game.
 * Uses the game's own auto fight (`run.auto`, which drives real aim/attack/Q/E), god mode, synthetic keys for R,
 * canvas MediaRecorder for video and rAF intervals for frame time. Import via `/@fs/<abs>/assets/vfx/live-driver.ts`.
 */
type Run = Record<string, unknown> & { phase: string; auto: boolean; god: boolean; hex: string | null; ink: number; room: number; wave: number; exitOpen?: boolean; transition?: number };
type Stats = { events: Record<string, number>; peakEffects: number; peakParticles: number; peakMeshes: number; dropped: number; updateMs: number[]; player?: [number, number]; foes?: Record<string, number[]>; hex?: string };
const g = globalThis as unknown as { __inkRun: Run; __inkVfxStats: Stats; __vfxLive?: Live; __inkKeys?: Record<string, number> };
interface Live { rec?: { mr: MediaRecorder; chunks: Blob[]; t0: number }; blob?: Uint8Array; timing?: { d: number[]; on: boolean; last: number; u0: number }; log: string[] }
const live: Live = (g.__vfxLive ??= { log: [] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const canvas = () => document.querySelector('canvas')!;

export function key(code: string, type: 'keydown' | 'keyup') {
  const e = new KeyboardEvent(type, { code, key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code, bubbles: true });
  canvas().dispatchEvent(e); window.dispatchEvent(e); document.dispatchEvent(e);
}
export async function press(code: string) { key(code, 'keydown'); await sleep(90); key(code, 'keyup'); await sleep(120); }
export const run = () => { const r = g.__inkRun; return { phase: r.phase, room: r.room, wave: r.wave, hex: r.hex, ink: r.ink, exitOpen: r.exitOpen, transition: r.transition, auto: r.auto, god: r.god }; };
export const stats = () => { const s = g.__inkVfxStats; return { events: { ...s.events }, peak: [s.peakEffects, s.peakParticles, s.peakMeshes], dropped: s.dropped, player: s.player, hex: s.hex }; };
const count = (k: string) => g.__inkVfxStats.events[k] ?? 0;

/** Title → lines → hex pick (UI click) → fight with god + auto fight. */
export async function start(hex: 'ink' | 'flame' | 'gear') {
  for (let i = 0; i < 40 && g.__inkRun.phase === 'title'; i++) await press('Enter');
  for (let i = 0; i < 40 && g.__inkRun.phase === 'lines'; i++) await press('Escape');
  for (let i = 0; i < 40 && g.__inkRun.phase !== 'fight'; i++) {
    const card = document.querySelector<HTMLElement>(`[data-hex="${hex}"]`);
    if (card) card.click(); else if (g.__inkRun.phase === 'hex') g.__inkRun.hex = hex;
    await sleep(150);
  }
  g.__inkRun.god = true; g.__inkRun.auto = true;
  return run();
}
/** Keep fighting; pick mid/upgrade hexes as they appear; press R when the ink meter allows. */
export async function fight(ms: number, opts: { ult?: boolean; hex?: string } = {}) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    const r = g.__inkRun;
    if (/^hex/.test(r.phase)) { (document.querySelector<HTMLElement>(`[data-hex="${opts.hex ?? r.hex ?? 'ink'}"]`) ?? document.querySelector<HTMLElement>('[data-hex]'))?.click(); }
    if (r.phase === 'bossCue') await press('Enter');
    if (opts.ult && r.ink >= 5) await press('KeyR');
    await sleep(100);
  }
  return run();
}
/** Wait (fighting) until event `kind` count passes n; then wait `delay` ms and pause the simulation for a capture. */
export async function holdOn(sim: { pause(): void }, kind: string, ms: number, delay = 0, opts: { ult?: boolean } = {}) {
  const n = count(kind), end = performance.now() + ms;
  while (performance.now() < end) {
    if (count(kind) > n) { await sleep(delay); sim.pause(); return { hit: true, kind, run: run() }; }
    if (opts.ult && g.__inkRun.ink >= 5) await press('KeyR');
    if (/^hex/.test(g.__inkRun.phase)) document.querySelector<HTMLElement>('[data-hex]')?.click();
    await sleep(25);
  }
  return { hit: false, kind, run: run() };
}
export function recStart(bps = 3e6) {
  const mr = new MediaRecorder(canvas().captureStream(30), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: bps });
  const chunks: Blob[] = []; mr.ondataavailable = (e) => chunks.push(e.data); mr.start(500);
  live.rec = { mr, chunks, t0: performance.now() };
}
export async function recStop() {
  const r = live.rec!; r.mr.stop(); await new Promise((res) => (r.mr.onstop = res));
  live.blob = new Uint8Array(await new Blob(r.chunks, { type: 'video/webm' }).arrayBuffer());
  return { seconds: (performance.now() - r.t0) / 1000, bytes: live.blob.length };
}
/** Base64 slice of the recorded video (eval results are size-bounded). */
export function recSlice(i: number, size = 1_200_000) {
  const b = live.blob!.subarray(i * size, (i + 1) * size); let s = '';
  for (let k = 0; k < b.length; k += 0x8000) s += String.fromCharCode(...b.subarray(k, k + 0x8000));
  return { b64: btoa(s), last: (i + 1) * size >= live.blob!.length };
}
export function timingStart() {
  const t = (live.timing = { d: [] as number[], on: true, last: performance.now(), u0: g.__inkVfxStats.updateMs.length });
  const loop = () => { if (!t.on) return; const n = performance.now(); t.d.push(n - t.last); t.last = n; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
export function timingStop() {
  const t = live.timing!; t.on = false;
  const d = t.d.slice(2).sort((a, b) => a - b), q = (p: number) => +d[Math.min(d.length - 1, Math.floor(d.length * p))]!.toFixed(2);
  const u = g.__inkVfxStats.updateMs.slice(-d.length).sort((a, b) => a - b), uq = (p: number) => +u[Math.min(u.length - 1, Math.floor(u.length * p))]!.toFixed(3);
  return { frames: d.length, p50: q(.5), p95: q(.95), p99: q(.99), max: +d.at(-1)!.toFixed(2), vfxUpdateP95: uq(.95), vfxUpdateMax: uq(1) };
}

/** Walk with the game's own key channel (__inkKeys w/a/s/d, camera-relative) until within 0.6 m or a transition starts. */
export async function walkTo(x: number, z: number, ms = 15000) {
  const yaw = 38 * Math.PI / 180, keys = (g.__inkKeys ??= {} as Record<string, number>);
  const end = performance.now() + ms, t0 = count('roomTransition');
  while (performance.now() < end) {
    const p = g.__inkVfxStats.player; if (!p) break;
    const dx = x - p[0], dz = z - p[1]; if (Math.hypot(dx, dz) < .6 || count('roomTransition') > t0) break;
    const v = dx * Math.sin(yaw) - dz * Math.cos(yaw), h = dx * Math.cos(yaw) + dz * Math.sin(yaw), n = Math.hypot(v, h) || 1;
    keys.w = v / n > .35 ? 1 : 0; keys.s = v / n < -.35 ? 1 : 0; keys.d = h / n > .35 ? 1 : 0; keys.a = h / n < -.35 ? 1 : 0;
    await sleep(50);
  }
  keys.w = keys.a = keys.s = keys.d = 0;
  return { player: g.__inkVfxStats.player, transitions: count('roomTransition') - t0, run: run() };
}
/** Fight until a foe telegraphs (enemies alive and near), then fill the ink meter and cast 千刃 with a real R press. */
export async function ultWhenFoes(sim: { pause(): void }, delay: number, ms = 40000) {
  const t0 = count('enemyTelegraph'), end = performance.now() + ms;
  while (performance.now() < end && count('enemyTelegraph') <= t0) { if (/^hex/.test(g.__inkRun.phase)) document.querySelector<HTMLElement>('[data-hex]')?.click(); if (g.__inkRun.phase === 'bossCue') await press('Enter'); await sleep(50); }
  g.__inkRun.ink = Math.max(g.__inkRun.ink, 5);
  const s0 = count('ultSlash');
  for (let i = 0; i < 10 && count('ultStart') === 0 + (g.__inkVfxStats.events.ultStart ?? 0) && count('ultSlash') === s0; i++) { await press('KeyR'); await sleep(80); if (count('ultSlash') > s0) break; }
  const e2 = performance.now() + 3000;
  while (performance.now() < e2 && count('ultSlash') <= s0) await sleep(15);
  await sleep(delay); sim.pause();
  return { slashes: count('ultSlash') - s0, run: run() };
}
export const sleepPause = async (sim: { pause(): void; resume(): void }, ms: number) => { sim.resume(); await sleep(ms); sim.pause(); return 1; };

/** Canvas-only snapshot (no DOM HUD) taken in-page at an exact beat; kept until `snapGet`. */
const snaps: Record<string, Blob> = ((live as unknown as { snaps?: Record<string, Blob> }).snaps ??= {});
let grab: { track: MediaStreamTrack; cap: { grabFrame(): Promise<ImageBitmap> } } | undefined;
export async function snap(name: string) {
  if (!grab) { const track = canvas().captureStream(60).getVideoTracks()[0]!; grab = { track, cap: new (globalThis as unknown as { ImageCapture: new (t: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> } }).ImageCapture(track) }; }
  const bmp = await grab.cap.grabFrame();
  const c = new OffscreenCanvas(bmp.width, bmp.height); c.getContext('2d')!.drawImage(bmp, 0, 0);
  snaps[name] = await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return { name, w: bmp.width, h: bmp.height, bytes: snaps[name]!.size };
}
export async function snapGet(name: string) {
  const b = new Uint8Array(await snaps[name]!.arrayBuffer()); let s = '';
  for (let k = 0; k < b.length; k += 0x8000) s += String.fromCharCode(...b.subarray(k, k + 0x8000));
  return btoa(s);
}
export const snapNames = () => Object.keys(snaps);
/** Wait for event `kind` (fighting meanwhile), then snapshot at each delay (ms after the event). */
export async function snapOn(kind: string, ms: number, beats: [string, number][], opts: { ult?: boolean; keepHex?: string } = {}) {
  const n = count(kind), end = performance.now() + ms;
  while (performance.now() < end && count(kind) <= n) {
    if (opts.keepHex && g.__inkRun.phase === 'fight' && g.__inkRun.hex !== opts.keepHex) g.__inkRun.hex = opts.keepHex;
    if (opts.ult && g.__inkRun.ink >= 5) await press('KeyR');
    if (/^hex/.test(g.__inkRun.phase)) document.querySelector<HTMLElement>('[data-hex]')?.click();
    if (g.__inkRun.phase === 'bossCue') await press('Enter');
    await sleep(10);
  }
  if (count(kind) <= n) return { hit: false, kind };
  const t0 = performance.now(), out = [];
  for (const [name, at] of beats) { const w = at - (performance.now() - t0); if (w > 0) await sleep(w); out.push({ ...(await snap(name)), at: Math.round(performance.now() - t0) }); }
  return { hit: true, kind, out, run: run() };
}
