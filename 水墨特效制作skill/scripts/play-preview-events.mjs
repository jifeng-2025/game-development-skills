/**
 * Live evidence on a BUILT game (`forgeax project preview`) driven from `forgeax project play`.
 * Shoots screenshots at fixed beats after REAL combat events counted by the VFX plugin.
 *
 *   VFX_URL=http://localhost:4812/ VFX_OUT=<evidence dir> VFX_PLAN=<plan.json> \
 *   pnpm exec forgeax project play <abs path>/play-preview-events.mjs --json --timeout-ms 900000
 *
 * plan.json:
 * {
 *   "statsGlobal": "__inkVfxStats",          // object with .events {kind: count}, written by the VFX plugin
 *   "viewGlobal": "__inkView",               // page-side read-only game state (phase/holdLine/subtitle…)
 *   "sendGlobal": "__inkSend",               // page → engine command channel (optional)
 *   "start": { "advanceKey": "Enter", "pickKey": "Digit1", "fightPhase": "fight", "pickPhaseRe": "^hex",
 *              "advancePhases": ["title","lines"], "afterStart": [{"t":"god","on":true},{"t":"auto","on":true}] },
 *   "targets": [
 *     { "name": "ignite", "kind": "ignite", "minDelta": 1, "maxDelta": 99, "requireZero": ["skillCast"],
 *       "noSubtitle": true, "beats": [["flame-ignite-a", 500], ["flame-ignite-b", 1100]] }
 *   ],
 *   "timeoutMs": 90000,
 *   "walk": { "exits": [[0,-2.15],[0,60.5]], "x": "x", "z": "z", "room": "room", "exitOpen": "exitOpen",
 *             "autoOff": {"t":"auto","on":false}, "autoOn": {"t":"auto","on":true} }   // optional
 * }
 * Watching starts right after afterStart (auto fight can clear a room during the intro dialogue).
 * walk: when view[exitOpen] is true, turn auto off and walk to exits[view[room]] with WASD (axes learned by
 * probing each key and reading view x/z, so any camera yaw works), then turn auto back on.
 * Every target is watched at once and shot once (first matching frame). Beats = [file stem, ms after event].
 * Writes <OUT>/<plan name>-result.json with log, page errors, final event counts.
 */
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.VFX_URL ?? 'http://localhost:4812/';
const OUT = process.env.VFX_OUT ?? '/tmp/vfx-live';
const PLAN_FILE = process.env.VFX_PLAN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function playPreviewEvents(play) {
  if (!PLAN_FILE) throw new Error('set VFX_PLAN=<plan.json>');
  const plan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
  const tag = path.basename(PLAN_FILE, '.json');
  const S = plan.statsGlobal ?? '__vfxStats', V = plan.viewGlobal, C = plan.sendGlobal;
  const st = plan.start ?? {};
  fs.mkdirSync(OUT, { recursive: true });
  // A fresh context on the play browser: `project play` only serves the dev runtime, not dist.
  const ctx = await play.page.context().browser().newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const log = [], errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await page.goto(URL);
  const view = () => (V ? page.evaluate((V) => { const v = globalThis[V]; return v ? JSON.parse(JSON.stringify(v)) : null; }, V) : Promise.resolve(null));
  const send = (m) => (C ? page.evaluate(([C, m]) => globalThis[C]?.(m), [C, m]) : Promise.resolve());
  const tap = async (k) => { await page.keyboard.down(k); await sleep(70); await page.keyboard.up(k); };
  // The VFX plugin runs in the Engine Worker when workers are on, else in the page.
  let W;
  for (let i = 0; i < 300 && !W; i++) {
    for (const w of [...page.workers(), page]) if (await w.evaluate((S) => !!globalThis[S], S).catch(() => false)) { W = w; break; }
    if (!W) await sleep(100);
  }
  if (!W) throw new Error(`no realm exposes globalThis.${S}`);
  const events = () => W.evaluate((S) => ({ ...globalThis[S].events }), S);
  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); log.push(`shot ${name}`); };
  const pickRe = new RegExp(st.pickPhaseRe ?? '^hex');
  const keepAlive = async (v) => {
    if (!v) return;
    if (pickRe.test(v.phase) && st.pickKey) { await tap(st.pickKey); await sleep(200); await tap(st.pickKey); }
    if (v.holdLine || (st.advancePhases ?? []).includes(v.phase)) await tap(st.advanceKey ?? 'Enter');
  };
  // Start: advance title/lines with real keys, pick with the digit key, then the game's own debug commands.
  for (let i = 0; i < 200; i++) {
    const v = await view(); if (!v) { await sleep(100); continue; }
    if (v.phase === (st.fightPhase ?? 'fight')) break;
    await keepAlive(v); await sleep(250);
  }
  // Snapshot BEFORE the debug commands: auto fight may clear the first room during the intro dialogue.
  let prev = await events();
  for (const m of st.afterStart ?? []) await send(m);
  log.push(`fight ${JSON.stringify(await view())}`);
  const wk = plan.walk, basis = new Map();
  const hold = async (keys, ms) => { for (const k of keys) await page.keyboard.down(k); await sleep(ms); for (const k of keys) await page.keyboard.up(k); };
  const pos = async () => { const v = await view(); return [v?.[wk.x ?? 'x'] ?? 0, v?.[wk.z ?? 'z'] ?? 0, v]; };
  const walkStep = async (v) => {
    const room = v[wk.room ?? 'room'], exit = wk.exits?.[room]; if (!exit) return;
    let b = basis.get(room);
    if (!b) {
      const probe = async (k) => { const [x0, z0] = await pos(); await hold([k], 260); await sleep(60); const [x1, z1] = await pos(); return [x1 - x0, z1 - z0]; };
      const axis = async (p, m) => { const a = await probe(p), c = await probe(m); return [(a[0] - c[0]) / 2, (a[1] - c[1]) / 2]; };
      b = { w: await axis('KeyW', 'KeyS'), d: await axis('KeyD', 'KeyA') }; basis.set(room, b); log.push(`basis r${room} ${JSON.stringify(b)}`);
    }
    const [x, z] = await pos(), tx = exit[0] - x, tz = exit[1] - z;
    const a = tx * b.w[0] + tz * b.w[1], c = tx * b.d[0] + tz * b.d[1], m = Math.max(Math.abs(a), Math.abs(c)) || 1, keys = [];
    if (Math.abs(a) > .25 * m) keys.push(a > 0 ? 'KeyW' : 'KeyS');
    if (Math.abs(c) > .25 * m) keys.push(c > 0 ? 'KeyD' : 'KeyA');
    await hold(keys, 200);
  };
  let walking = false;
  // Watch all targets together.
  const left = new Map(plan.targets.map((t) => [t.name, t]));
  const end = Date.now() + (plan.timeoutMs ?? 90000);
  while (left.size && Date.now() < end) {
    const cur = await events(), v = await view();
    const d = (k) => (cur[k] ?? 0) - (prev[k] ?? 0);
    let shotAny = false;
    for (const t of [...left.values()]) {
      const delta = d(t.kind);
      if (delta < (t.minDelta ?? 1) || delta > (t.maxDelta ?? 1e9)) continue;
      if ((t.requireZero ?? []).some((k) => d(k) !== 0)) continue;
      if (t.noSubtitle && v?.subtitle) continue;
      left.delete(t.name); shotAny = true;
      const t0 = Date.now();
      for (const [name, at] of t.beats) { const w = at - (Date.now() - t0); if (w > 0) await sleep(w); await shot(name); }
    }
    prev = shotAny ? await events() : cur;
    await keepAlive(v);
    if (wk && v) {
      const open = !!v[wk.exitOpen ?? 'exitOpen'] && v.phase === (st.fightPhase ?? 'fight') && !v.holdLine;
      if (open && !walking) { walking = true; if (wk.autoOff) await send(wk.autoOff); }
      if (!open && walking) { walking = false; if (wk.autoOn) await send(wk.autoOn); }
      if (open) await walkStep(v);
    }
    await sleep(12);
  }
  for (const n of left.keys()) log.push(`miss ${n}`);
  const final = await W.evaluate((S) => { const s = globalThis[S]; return { events: s.events, peakEffects: s.peakEffects, peakParticles: s.peakParticles, dropped: s.dropped, probe: s.probe }; }, S); // probe: optional plugin debug field
  fs.writeFileSync(path.join(OUT, `${tag}-result.json`), JSON.stringify({ url: URL, log, errors, stats: final, view: await view() }, null, 2));
  await ctx.close();
  return { log, errors: errors.length, missed: [...left.keys()] };
}
