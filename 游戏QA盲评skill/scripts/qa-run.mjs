/**
 * Blind-review QA driver (profile-driven). Opens a BUILT preview URL inside the `forgeax project play`
 * browser and plays it with real keyboard / mouse. It only READS the page's exposed state snapshot to
 * know where it is; it never imports game code. Everything game-specific lives in a profile JSON
 * (see ../templates/profile.inkblade.json for a filled example; the profile path is mandatory).
 *
 *   QA_PROFILE=/abs/profile.json QA_URL=http://localhost:4841/ QA_MODE=hold|full|boss|death|pick \
 *   QA_RUNS=3 QA_PICKS=mouse0,mouse1,Digit3 QA_OUT=/abs/evidence/qa/Q00N QA_W=1280 QA_H=720 \
 *   pnpm exec forgeax project play /abs/qa-run.mjs --port <free> --json --progress false --timeout-ms 1800000
 *
 * Modes
 *   (also see manual-run.mjs for the no-helper player and its boss-death switch)
 *   hold  : play into profile.holdRoom, stay QA_HOLD seconds (crash / stability check), screenshots at 1/5/10/N s
 *   full  : title -> ... -> ending, with god key + auto helper
 *   boss  : god key, skip to boss, auto until boss hp < bossManualFrac, then REAL input only; post-boss pick
 *           is done by hand (auto would take it); after ending press confirm and record where it goes
 *   death : skip to boss WITHOUT god, stand still until dead, screenshot death screen, press confirm, then
 *           FOLLOW the restarted run (god + auto) for QA_DEATH_FOLLOW_S s (default 90): record the spawn point,
 *           walk to the first exit, pass only if the hero leaves the first room (catches "restart soft-lock")
 *   pick  : stop right after the first pick screen is confirmed (repeat card-click checks cheaply)
 * QA_PICKS : per run / per pick plan, cycled: mouseN (N = 0-based card), DigitN (key) or id:<cardId> (click the
 *           card whose id attribute matches - use it for post-boss upgrade picks, the card order can change)
 * Extras (env):
 *   QA_TEXT_FOLLOW_MS=1500  on each new subtitle: shoot again after N ms and log hold/kills/bossHp before/after
 *                           (checks "fight lines must not pause combat")
 *   QA_BURST_AUDIO_MS=400   burst-capture 6 frames whenever a sound of that buffer length starts (e.g. 3rd swing)
 *   QA_SWING_PRE=N          boss mode: before skipping to the boss, do N real attack combos (auto off) toward an empty
 *                           direction and burst after each 3rd hit (clean frames of "every 3rd hit" effects)
 *   QA_POST_MANUAL=1        boss mode: after the post-boss pick, do QA_POST_MANUAL_N (3) manual actions before auto;
 *   QA_POST_SWING_ONLY=1      each action = Q + burst (default) or, with SWING_ONLY, an attack combo + burst (no Q/E)
 *
 * Output: <QA_OUT>/<QA_TAG|mode>-<i>/NNN-<name>.png|jpg + run.json (timeline, 50 ms page log, pick probes,
 * dialogue probes, kills, bounds, stalls, audio starts with buffer durations, errors, warnings).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (!process.env.QA_PROFILE) throw new Error('qa-run: set QA_PROFILE=/abs/path/profile.json (copy templates/profile.inkblade.json and edit)');
const P = JSON.parse(readFileSync(process.env.QA_PROFILE, 'utf8'));
const URL = process.env.QA_URL ?? 'http://localhost:4841/';
const MODE = process.env.QA_MODE ?? 'hold';
const RUNS = Number(process.env.QA_RUNS ?? 1);
const PICKS = (process.env.QA_PICKS ?? 'mouse0').split(',');
const ROOT = process.env.QA_OUT ?? '/tmp/qa-evidence';
const TAG = process.env.QA_TAG ?? MODE;
const W = Number(process.env.QA_W ?? 1280);
const H = Number(process.env.QA_H ?? 720);
const HOLD_S = Number(process.env.QA_HOLD ?? P.holdSeconds ?? 15);
const F = P.fields; // logical name -> state key
const PH = P.phases;
const K = P.keys;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const view = (page) => page.evaluate(({ g, f }) => {
  const v = globalThis[g]; if (!v) return null; const o = {};
  for (const [name, key] of Object.entries(f)) o[name] = v[key];
  return o;
}, { g: P.stateGlobal, f: F });
const tap = async (page, key, ms = 70) => { await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key); };
const hold = async (page, keys, ms) => { for (const k of keys) await page.keyboard.down(k); await sleep(ms); for (const k of keys) await page.keyboard.up(k); };
const send = (page, cmd) => (P.sendGlobal && cmd ? page.evaluate(({ g, c }) => globalThis[g]?.(c), { g: P.sendGlobal, c: cmd }) : Promise.resolve());
const setAuto = (page, on) => send(page, on ? P.autoOn : P.autoOff);
const errorPage = (page) => page.evaluate((re) => { const t = document.body?.innerText ?? ''; return new RegExp(re).test(t) ? t.slice(0, 2000) : null; }, P.errorPageRegex);
const uiText = (page) => page.evaluate((sel) => (document.querySelector(sel)?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 400), P.uiRoot);
const isPick = (ph) => PH.pick.includes(ph);

/** Init script: black-box audio counter (browser API, not game code) + 50 ms state/text recorder. */
const INIT = ({ g, logKeys, uiRoot }) => {
  const s = (globalThis.__qaAudio = { contexts: 0, starts: 0, log: [] });
  const AC = globalThis.AudioContext;
  if (AC) globalThis.AudioContext = class extends AC { constructor(...a) { super(...a); s.contexts += 1; s.ctx = this; } };
  const proto = globalThis.AudioBufferSourceNode?.prototype;
  if (proto) { const start = proto.start; proto.start = function (...a) { s.starts += 1; s.lastByMs = s.lastByMs || {}; s.lastByMs[Math.round((this.buffer?.duration ?? 0) * 1000)] = performance.now(); if (s.log.length < 4000) s.log.push([Math.round(performance.now()), Math.round((this.buffer?.duration ?? 0) * 1000)]); return start.apply(this, a); }; }
  const log = (globalThis.__qaLog = []); const prev = {};
  setInterval(() => {
    const v = globalThis[g]; if (!v) return;
    for (const k of logKeys) { const val = v[k]; if (val !== prev[k]) { prev[k] = val; if (log.length < 3000) log.push([Math.round(performance.now()), k, val]); } }
    const t = document.querySelector(uiRoot)?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 300) ?? '';
    if (t !== prev.__ui) { prev.__ui = t; if (log.length < 3000) log.push([Math.round(performance.now()), 'ui', t]); }
  }, 50);
};
const audio = (page) => page.evaluate(() => ({ contexts: globalThis.__qaAudio?.contexts, starts: globalThis.__qaAudio?.starts, state: globalThis.__qaAudio?.ctx?.state }));

/** Every CSS custom property with the skin prefix must resolve to a decodable data URL; count dev-only /@fs/ loads. */
const skinCheck = (page) => page.evaluate(async (prefix) => {
  if (!prefix) return null;
  const style = getComputedStyle(document.documentElement);
  const names = [...new Set([...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules]; } catch { return []; } })
    .flatMap((r) => (r.style ? [...r.style] : [])).filter((n) => n.startsWith(prefix)))];
  const res = await Promise.all(names.map(async (n) => { const u = /url\("?([^")]+)"?\)/.exec(style.getPropertyValue(n))?.[1]; if (!u) return { n, ok: false }; const im = new Image(); im.src = u; try { await im.decode(); return { n, ok: im.naturalWidth > 0 }; } catch { return { n, ok: false }; } }));
  return { count: res.length, failed: res.filter((r) => !r.ok).map((r) => r.n), fs: performance.getEntriesByType('resource').filter((e) => e.name.includes('/@fs/')).length };
}, P.skinVarPrefix ?? null);

/** Pick cards: centre point + whether the card itself is the topmost element there (occlusion probe). */
const cards = (page) => page.evaluate(({ sel, id }) => [...document.querySelectorAll(sel)].map((c) => {
  const r = c.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2; const top = document.elementFromPoint(x, y);
  return { id: c.getAttribute(id), text: c.innerText.replace(/\s+/g, ' ').slice(0, 60), x: Math.round(x), y: Math.round(y), hitsCard: top === c || c.contains(top) };
}), { sel: P.pick.cardSelector, id: P.pick.idAttr });
const armed = (page) => page.evaluate(({ sel, cls, id }) => document.querySelector(`${sel}.${cls}`)?.getAttribute(id) ?? null, { sel: P.pick.cardSelector, cls: P.pick.armedClass, id: P.pick.idAttr });

async function one(context, index) {
  const tag = `${TAG}-${index + 1}`;
  const OUT = join(ROOT, tag);
  mkdirSync(OUT, { recursive: true });
  const rec = { tag, url: URL, mode: MODE, pickPlan: PICKS[index % PICKS.length], started: new Date().toISOString(), timeline: [], texts: [], picks: [],
    dialog: [], shots: [], kills: [], pageErrors: [], consoleErrors: [], warnings: [], failed: null, rooms: {}, bounds: {}, stalls: [], flags: {} };
  const page = await context.newPage();
  await page.addInitScript(INIT, { g: P.stateGlobal, logKeys: P.logKeys, uiRoot: P.uiRoot });
  page.on('pageerror', (e) => rec.pageErrors.push(String(e?.stack ?? e).slice(0, 600)));
  page.on('console', (m) => { if (m.type() === 'error') rec.consoleErrors.push(m.text().slice(0, 600)); else if (m.type() === 'warning') rec.warnings.push(m.text().slice(0, 300)); });
  const t0 = Date.now();
  const stamp = () => Number(((Date.now() - t0) / 1000).toFixed(2));
  const once = (k) => (rec.flags[k] ? false : (rec.flags[k] = stamp(), true));
  let n = 0;
  const shot = async (name, jpeg = false) => {
    n += 1; const file = `${String(n).padStart(3, '0')}-${name}.${jpeg ? 'jpg' : 'png'}`;
    try { await page.screenshot({ path: join(OUT, file), ...(jpeg ? { type: 'jpeg', quality: 80 } : {}) }); rec.shots.push({ t: stamp(), file }); } catch (e) { rec.shots.push({ t: stamp(), file, error: String(e) }); }
  };
  const burst = async (name, count = 6, gap = 60) => { for (let i = 0; i < count; i += 1) { await shot(`${name}-b${i}`, true); if (gap) await sleep(gap); } };

  let lastKey = ''; let lastText = ''; let last = null; let stillSince = Date.now(); let lastSig = '';
  const sample = async () => {
    const v = await view(page); if (!v) return null;
    const key = ['phase', 'room', 'wave', 'kills', 'meter', 'pick', 'line', 'subtitle', 'teach', 'banner', 'exitOpen', 'endingStep', 'paused', 'god', 'auto'].map((k) => JSON.stringify(v[k])).join('|');
    if (key !== lastKey) { rec.timeline.push({ t: stamp(), ...v }); lastKey = key; }
    const tx = await uiText(page).catch(() => '');
    if (tx && tx !== lastText) { rec.texts.push({ t: stamp(), phase: v.phase, room: v.room, text: tx }); lastText = tx; }
    if (Number.isFinite(v.x) && Number.isFinite(v.z)) {
      // Skip transition frames: the room index flips before the body is teleported, which would smear bounds.
      if (!(v.transition > 0) && rec.timeline.length && rec.timeline[rec.timeline.length - 1].room === v.room && stamp() - (rec.rooms[v.room] ?? 0) > 0.5) {
        const b = (rec.bounds[v.room] ??= { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 });
        b.minX = Math.min(b.minX, v.x); b.maxX = Math.max(b.maxX, v.x); b.minZ = Math.min(b.minZ, v.z); b.maxZ = Math.max(b.maxZ, v.z);
      }
    } else if (v.x !== undefined) rec.stalls.push({ t: stamp(), nonFinite: [v.x, v.z] });
    const sig = `${v.phase}|${v.room}|${v.kills}|${(+v.x || 0).toFixed(1)}|${(+v.z || 0).toFixed(1)}|${v.hp}|${v.bossHp}|${v.line}|${v.endingStep}`;
    if (sig !== lastSig) { lastSig = sig; stillSince = Date.now(); } else if (Date.now() - stillSince > 20000 && v.phase === PH.fight) { rec.stalls.push({ t: stamp(), v }); stillSince = Date.now(); }
    if (last && v.kills > last.kills) rec.kills.push({ t: stamp(), room: v.room, kills: v.kills, meter: v.meter });
    last = v; return v;
  };

  /** Learn what each move key does in this room (camera may be oblique), then steer to the exit. */
  const bases = new Map();
  async function walkTo(room, tx, tz) {
    const [up, down, right, left] = K.move;
    const at = async () => { const v = await view(page); return [v.x, v.z, v]; };
    const step = async (k) => { const [x0, z0] = await at(); await hold(page, [k], 260); await sleep(60); const [x1, z1] = await at(); return [x1 - x0, z1 - z0]; };
    const axis = async (p, m) => { const a = await step(p); const b = await step(m); return [(a[0] - b[0]) / 2, (a[1] - b[1]) / 2]; };
    let basis = bases.get(room);
    if (!basis) { basis = { w: await axis(up, down), d: await axis(right, left) }; if (Math.hypot(...basis.w) > 0.05 && Math.hypot(...basis.d) > 0.05) bases.set(room, basis); }
    for (let i = 0; i < 90; i += 1) {
      const [x, z, v] = await at();
      if (!v.exitOpen || v.transition > 0 || v.phase !== PH.fight) return;
      const vx = tx - x; const vz = tz - z;
      if (Math.hypot(vx, vz) < 0.6) { await sleep(120); continue; }
      const a = vx * basis.w[0] + vz * basis.w[1]; const b = vx * basis.d[0] + vz * basis.d[1];
      const s = Math.max(Math.abs(a), Math.abs(b)) || 1; const keys = [];
      if (Math.abs(a) > 0.25 * s) keys.push(a > 0 ? up : down);
      if (Math.abs(b) > 0.25 * s) keys.push(b > 0 ? right : left);
      await hold(page, keys, 220);
    }
  }

  /** One real attack combo (P.comboHits clicks, ~280 ms apart) toward a screen direction, then a dense burst. */
  async function swingCombo(label, ang) {
    const hits = P.comboHits ?? 3;
    await page.mouse.move(W / 2 + Math.cos(ang) * W * 0.22, H / 2 + Math.sin(ang) * H * 0.22);
    for (let i = 0; i < hits; i += 1) { await page.mouse.down(); await sleep(60); await page.mouse.up(); if (i < hits - 1) await sleep(220); }
    await burst(label, 8, 30);
    await sleep(900);
  }

  /** Pick screen: open -> hover -> first input (arm) -> second input (confirm); records state + audio delta. */
  let pickCount = 0;
  async function doPick(v) {
    pickCount += 1;
    const plan = PICKS[(index + pickCount - 1) % PICKS.length];
    await sleep(500);
    const cs = await cards(page);
    const entry = { t: stamp(), phase: v.phase, plan, cards: cs };
    rec.picks.push(entry);
    await shot(`pick${pickCount}-open`);
    const a0 = await audio(page);
    if (plan.startsWith('mouse') || plan.startsWith('id:')) {
      // `id:<cardId>` clicks the card whose id attribute matches (upgrade cards change order).
      const c = plan.startsWith('id:') ? (cs.find((x) => x.id === plan.slice(3)) ?? cs[0]) : (cs[Number(plan.slice(5))] ?? cs[0]);
      entry.picked = c?.id;
      await page.mouse.move(c.x, c.y, { steps: 8 }); await sleep(300);
      await shot(`pick${pickCount}-hover`);
      await page.mouse.click(c.x, c.y, { delay: 120 }); await sleep(350); // ~120 ms = a real human click
      entry.armedAfterFirst = await armed(page); entry.phaseAfterFirst = (await view(page))?.phase;
      await shot(`pick${pickCount}-armed`);
      if (P.pick.confirmTwice) await page.mouse.click(c.x, c.y, { delay: 120 });
    } else {
      entry.picked = cs[Number(plan.replace(/\D/g, '')) - 1]?.id;
      await tap(page, plan); await sleep(350);
      entry.armedAfterFirst = await armed(page); entry.phaseAfterFirst = (await view(page))?.phase;
      await shot(`pick${pickCount}-armed`);
      if (P.pick.confirmTwice) await tap(page, plan);
    }
    await sleep(200);
    const after = await view(page);
    entry.after = after?.phase; entry.pickNow = after?.pick;
    entry.audioDelta = (await audio(page)).starts - a0.starts;
    await shot(`pick${pickCount}-confirmed`);
    await sleep(900); await shot(`pick${pickCount}-after1s`);
  }

  /** Dialogue probe (first 3 lines): wait 3.5 s without input (must NOT advance), then one key (must advance). */
  let probes = 0;
  async function advanceDialog() {
    if (probes < 3) {
      probes += 1;
      const before = await view(page); await sleep(3500); const idle = await view(page);
      await shot(`dialog-${before.phase}-${before.line}`);
      await tap(page, K.confirm); await sleep(400); const after = await view(page);
      rec.dialog.push({ t: stamp(), phase: before.phase, lineBefore: before.line, lineIdle: idle.line, phaseIdle: idle.phase, lineAfterKey: after.line, phaseAfterKey: after.phase });
    } else { await tap(page, K.confirm); await sleep(220); }
  }

  try {
    await page.goto(URL, { waitUntil: 'load' });
    const opened = await page.waitForFunction(({ ok, fail }) => (document.documentElement.dataset.forgeaxInput === ok ? 'open' : (new RegExp(fail).test(document.body?.innerText ?? '') ? 'failed' : false)),
      { ok: 'open', fail: P.startFailRegex }, { timeout: 180000, polling: 200 });
    rec.load = { openS: stamp(), result: await opened.jsonValue() };
    if (rec.load.result !== 'open') throw new Error('preview did not start');
    for (let i = 0; i < 150 && (await view(page))?.phase !== PH.title; i += 1) await sleep(100);
    rec.load.titleS = stamp();
    await sleep(800); await shot('title');
    rec.skin = await skinCheck(page);
    await tap(page, K.confirm);

    const limit = Date.now() + (MODE === 'full' || MODE === 'boss' ? 8 : 5) * 60000;
    const S = K.skills ?? {};
    const FOLLOW_TEXT_MS = Number(process.env.QA_TEXT_FOLLOW_MS ?? 0);
    // Extras: burst when a sound of a given duration starts (e.g. 3rd-swing SFX), and dense Q bursts after the 2nd pick.
    const AUDIO_MS = Number(process.env.QA_BURST_AUDIO_MS ?? 0); let audioBursts = 0; let lastAudioSeen = 0;
    let upgradeBursts = 0; let lastUpQ = 0;
    let helpers = false; let holdAt = 0; let periodic = 0; let skillBursts = 0; let lastE = 0; let lastQ = 0; let deathDone = false;
    let lastHp = Infinity; let hurtShots = 0; let killShots = 0;
    const FOLLOW_S = MODE === 'death' ? Number(process.env.QA_DEATH_FOLLOW_S ?? 90) : 0; let followHelpers = false;
    while (Date.now() < limit) {
      const bad = await errorPage(page);
      if (bad) { rec.failed = { t: stamp(), text: bad, view: await view(page).catch(() => null) }; await shot('ERROR'); break; }
      const v = await sample();
      if (!v) { await sleep(200); continue; }
      if (rec.rooms[v.room] === undefined) { rec.rooms[v.room] = stamp(); if (Object.keys(rec.rooms).length > 1) { await sleep(200); await shot(`room${v.room}-enter`); } }
      if (v.transition > 0 && once(`tr${v.room}`)) await shot(`transition-from${v.room}`, true);
      if (Date.now() - periodic > 4000 && v.phase === PH.fight) { periodic = Date.now(); await shot(`p-r${v.room}-w${v.wave}`, true); }
      for (const k of ['subtitle', 'teach', 'banner']) if (v[k] && once(`${k}:${v[k]}`)) {
        await shot(`${k}-r${v.room}`, true);
        // QA_TEXT_FOLLOW_MS: a second shot + state sample later proves whether the line went away / combat kept running
        if (FOLLOW_TEXT_MS && k === 'subtitle') { const a = await view(page); await sleep(FOLLOW_TEXT_MS); const b = await view(page); await shot(`${k}-r${v.room}-later`, true);
          (rec.textFollow ??= []).push({ text: v[k], before: { hold: a.holdLine, kills: a.kills, bossHp: a.bossHp, hp: a.hp, x: a.x, z: a.z }, after: { sub: b.subtitle, hold: b.holdLine, kills: b.kills, bossHp: b.bossHp, hp: b.hp, x: b.x, z: b.z }, ms: FOLLOW_TEXT_MS }); }
      }

      if (v.phase === PH.ending) {
        if (once(`end${v.endingStep}`)) await shot(`ending-step${v.endingStep}`);
        if (v.endingStep >= P.endingDoneStep && !rec.ending) {
          rec.ending = stamp(); await sleep(1500); await shot('ending-final');
          if (MODE === 'boss') { await tap(page, K.confirm); await sleep(1800); const a = await view(page); rec.afterEndingConfirm = { phase: a?.phase, room: a?.room }; await shot('ending-after-confirm'); }
          break;
        }
        // Confirm on the last ending line may restart the run: advance ending lines with a click instead.
        if (v.holdLine) { await page.mouse.click(W / 2, H * 0.88, { delay: 90 }); await sleep(250); } else await sleep(200);
        continue;
      }
      if (v.phase === PH.dead && !deathDone) {
        deathDone = true; rec.death = { t: stamp(), room: v.room, x: v.x, z: v.z };
        await sleep(400); await shot('death-0.4s'); await sleep(1500); await shot('death-1.9s');
        await tap(page, K.confirm); await sleep(1500); const after = await view(page); rec.death.afterConfirm = { phase: after?.phase, room: after?.room, x: after?.x, z: after?.z };
        await shot('death-after-confirm');
        if (FOLLOW_S <= 0) break;
        rec.death.follow = { from: stamp(), track: [] }; followHelpers = false; continue;
      }
      if (deathDone && rec.death?.follow) {
        const f = rec.death.follow;
        if (v.phase === PH.fight && !f.spawn) { f.spawn = { t: stamp(), room: v.room, x: v.x, z: v.z }; await sleep(400); await shot('restart-spawn'); }
        if (f.spawn && (f.track.length === 0 || stamp() - f.track[f.track.length - 1][0] >= 1)) f.track.push([stamp(), v.room, +(+v.x).toFixed(2), +(+v.z).toFixed(2)]);
        if (f.spawn && v.room !== f.spawn.room) { f.leftFirstRoom = { t: stamp(), room: v.room }; await sleep(1200); await shot('restart-left-first-room'); break; }
        if (stamp() - f.from > FOLLOW_S) { f.stuck = { t: stamp(), view: v }; await shot('restart-STUCK'); break; }
        if (v.phase === PH.fight && !followHelpers) { followHelpers = true; await tap(page, K.god); await setAuto(page, true); }
      }
      if (v.phase === PH.title) { if (rec.ending) break; await tap(page, K.confirm); await sleep(400); continue; }
      if (v.phase === PH.lines || v.holdLine) { await advanceDialog(); continue; }
      if (isPick(v.phase)) { await doPick(v); if (MODE === 'pick') { await sleep(1500); rec.pickOnly = (await view(page))?.pick; await shot('pick-only-after'); break; } continue; }
      if (PH.bossCue && v.phase === PH.bossCue) { if (once('bossCue')) await shot('bossCue'); await sleep(600); await tap(page, K.confirm); await sleep(300); continue; }
      if (v.phase !== PH.fight) { await sleep(150); continue; }

      if (!helpers) {
        helpers = true;
        await sleep(300); await shot('hud-first-fight');
        rec.skinFight = await skinCheck(page);
        await tap(page, K.pause); await sleep(600); rec.pause = (await view(page))?.paused; await shot('pause'); await tap(page, K.pause); await sleep(400);
        if (MODE === 'death') { await tap(page, K.skipToBoss); rec.skip = stamp(); continue; } // god stays OFF until the death
        await tap(page, K.god); await sleep(200); rec.godAfterKey = (await view(page))?.god;
        if (MODE === 'boss') {
          const pre = Number(process.env.QA_SWING_PRE ?? 0);
          if (pre) { await setAuto(page, false); for (let i = 0; i < pre; i += 1) await swingCombo(`swingpre-r${v.room}-n${i + 1}`, 0.35 + i * 0.9); }
          await tap(page, K.skipToBoss); rec.skip = stamp(); continue;
        }
        await setAuto(page, true);
      }
      if (MODE === 'boss') {
        const bossFight = v.room === P.bossRoom && v.bossHp > 0;
        // auto until the boss is below bossManualFrac; real input after that; auto again for the
        // post-boss wave once the post-boss pick has been made by hand (auto would have taken it).
        const wantAuto = bossFight ? v.bossHp > P.bossManualFrac * P.bossMaxHp : (v.room === P.bossRoom && rec.picks.length >= 2 && (!process.env.QA_POST_MANUAL || upgradeBursts >= Number(process.env.QA_POST_MANUAL_N ?? 3)));
        if (!!wantAuto !== !!v.auto) { await setAuto(page, wantAuto); (rec.autoSwitch ??= []).push({ t: stamp(), on: wantAuto, bossHp: v.bossHp }); }
        if (bossFight && !wantAuto) {
          const ang = (Date.now() / 300) % (2 * Math.PI);
          await page.mouse.click(W / 2 + Math.cos(ang) * W * 0.12, H / 2 + Math.sin(ang) * H * 0.15, { delay: 60 });
          if (S.e && Date.now() - lastE > 1200) { lastE = Date.now(); await tap(page, S.e, 40); }
          if (S.q && Date.now() - lastQ > 1500) { lastQ = Date.now(); await tap(page, S.q, 40); }
          if (S.ult && v.meter >= P.meterFull) await tap(page, S.ult, 50);
          if (v.bossHp < 0.2 * P.bossMaxHp && once('bossLow')) await shot('boss-low');
          continue;
        }
        if (v.room === P.bossRoom && v.bossHp <= 0 && once('bossDead')) await burst('boss-dead', 6, 150);
        if (process.env.QA_POST_MANUAL && rec.picks.length >= 2 && v.room === P.bossRoom && !v.exitOpen && upgradeBursts < Number(process.env.QA_POST_MANUAL_N ?? 3) && Date.now() - lastUpQ > 4500) {
          // post-boss wave by hand; Q toward a rotating aim point, dense burst after each press.
          lastUpQ = Date.now(); upgradeBursts += 1;
          const ang = upgradeBursts * 1.1; await page.mouse.move(W / 2 + Math.cos(ang) * W * 0.2, H / 2 + Math.sin(ang) * H * 0.2);
          if (process.env.QA_POST_SWING_ONLY) { await swingCombo(`swingpost-r${v.room}-n${upgradeBursts}`, ang); continue; }
          await tap(page, S.q, 40); await burst(`upQ-r${v.room}-n${upgradeBursts}`, 6, 0);
          if (AUDIO_MS && audioBursts < 6) { audioBursts += 1; for (let i = 0; i < 3; i += 1) { await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(220); } await burst(`swing3-r${v.room}-n${audioBursts}`, 6, 40); }
          continue;
        }
        if (!wantAuto && v.room === P.bossRoom && !v.exitOpen) { await page.mouse.click(W / 2, H * 0.4, { delay: 60 }); if (S.e && Date.now() - lastE > 1500) { lastE = Date.now(); await tap(page, S.e, 40); } continue; }
      }
      if (MODE === 'death' && !deathDone) { if (v.hp < lastHp && hurtShots < 2) { hurtShots += 1; await shot('hurt', true); } lastHp = v.hp; await sleep(150); continue; }

      if (AUDIO_MS && audioBursts < 6) {
        const at = await page.evaluate((ms) => { const l = globalThis.__qaAudio?.lastByMs ?? {}; for (const d of [ms - 1, ms, ms + 1]) if (l[d]) return l[d]; return 0; }, AUDIO_MS);
        if (at && at !== lastAudioSeen) { lastAudioSeen = at; audioBursts += 1; await burst(`audio${AUDIO_MS}-r${v.room}-n${audioBursts}`, 6, 40); }
      }
      if (S.q && rec.picks.length >= 2 && upgradeBursts < 6 && !v.exitOpen && Date.now() - lastUpQ > 1800) { lastUpQ = Date.now(); upgradeBursts += 1; await tap(page, S.q, 40); await burst(`upQ-r${v.room}-n${upgradeBursts}`, 6, 0); }
      if (rec.kills.length && rec.kills[rec.kills.length - 1].t > stamp() - 0.6 && killShots < 4) { killShots += 1; await burst(`kill-r${v.room}`, 5, 120); }
      if (S.q && !v.exitOpen && Date.now() - lastQ > 2500) { lastQ = Date.now(); await tap(page, S.q, 40); if (skillBursts < 6) { skillBursts += 1; await burst(`Q-r${v.room}`, 5, 0); } }
      if (S.e && !v.exitOpen && Date.now() - lastE > 3200) { lastE = Date.now(); await tap(page, S.e, 40); if (skillBursts < 9) { skillBursts += 1; await burst(`E-r${v.room}`, 4, 0); } }
      if (S.ult && v.meter >= P.meterFull && !v.exitOpen) { await tap(page, S.ult, 50); if (once('ult')) await burst('ult', 8, 100); }
      if (MODE === 'hold' && v.room === P.holdRoom && !(v.transition > 0)) {
        if (!holdAt) holdAt = Date.now();
        const held = (Date.now() - holdAt) / 1000;
        for (const s of [1, 5, 10]) if (held > s && once(`hold${s}`)) await shot(`hold-${s}s`);
        if (held > HOLD_S) { await shot(`hold-${HOLD_S}s-end`); rec.held = HOLD_S; break; }
      }
      if (v.exitOpen && !(v.transition > 0) && !(MODE === 'hold' && v.room === P.holdRoom)) {
        await sleep(400); await shot(`exit-open-r${v.room}`, true);
        const exit = P.exits[v.room];
        if (exit) { await setAuto(page, false); try { await walkTo(v.room, exit[0], exit[1]); } finally { await setAuto(page, true); } }
        continue;
      }
      await sleep(120);
    }
    if (!rec.failed && !rec.ending && !rec.held && !rec.death && !rec.pickOnly) rec.timedOut = { t: stamp(), view: await view(page) };
  } catch (e) {
    rec.exception = String(e?.stack ?? e).slice(0, 1500);
    await shot('EXCEPTION').catch(() => {});
  } finally {
    rec.seconds = stamp();
    rec.audioFinal = await page.evaluate(() => ({ contexts: globalThis.__qaAudio?.contexts, starts: globalThis.__qaAudio?.starts, state: globalThis.__qaAudio?.ctx?.state, log: globalThis.__qaAudio?.log })).catch(() => null);
    rec.pageLog = await page.evaluate(() => globalThis.__qaLog ?? null).catch(() => null);
    writeFileSync(join(OUT, 'run.json'), JSON.stringify(rec, null, 2));
    await page.close();
  }
  return rec;
}

export default async function qa(play) {
  const browser = play.page.context().browser();
  if (!browser) throw new Error('qa-run: the play page has no browser to open a preview context in');
  const out = [];
  for (let i = 0; i < RUNS; i += 1) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    try { out.push(await one(ctx, i)); } finally { await ctx.close(); }
  }
  await play.page.bringToFront().catch(() => undefined);
  const summary = out.map((r) => ({ tag: r.tag, load: r.load, failed: r.failed?.text?.split('\n')[0]?.slice(0, 200) ?? null, exception: r.exception?.slice(0, 200) ?? null,
    rooms: r.rooms, held: r.held ?? null, ending: r.ending ?? null,
    death: r.death ? { t: r.death.t, room: r.death.room, afterConfirm: r.death.afterConfirm, spawn: r.death.follow?.spawn ?? null, leftFirstRoom: r.death.follow?.leftFirstRoom ?? null, stuck: !!r.death.follow?.stuck } : null, timedOut: !!r.timedOut, kills: r.kills.length,
    errors: { page: r.pageErrors.length, console: r.consoleErrors.length },
    picks: r.picks.map((h) => ({ plan: h.plan, picked: h.picked, armed: h.armedAfterFirst, after: h.after, now: h.pickNow })),
    audio: r.audioFinal && { contexts: r.audioFinal.contexts, starts: r.audioFinal.starts }, skin: r.skin, stalls: r.stalls.length }));
  console.log(JSON.stringify(summary));
  return summary;
}
