/**
 * No-helper player ("manual" mode of 游戏QA盲评skill): a scripted PLAYER with real keyboard / mouse only. No god key, no `auto`
 * aim command, no skip key. It reads only (a) the exposed state snapshot to know phase / hp / room /
 * exit, and (b) the rendered screenshot to find the vermilion warning shapes (what a human sees).
 *
 * Policy (a deliberately simple "casual player"):
 *   - swing toward the side the red warning comes from (else sweep 8 directions), E on cooldown
 *     (auto-targets within its range), Q every 4.5 s, R when the meter is full;
 *   - if red warning pixels cover the hero's screen position -> dash away from the red centroid;
 *   - when the exit opens, walk to it (learned WASD basis, same as qa-run.mjs);
 *   - on death: screenshot, confirm key, pick a card, keep playing (death count recorded);
 *   - "stuck": no kill, no room change and no boss damage for STUCK_S seconds in a fight -> screenshot + note.
 * This is NOT a human: it measures difficulty for a weak, honest bot. Report it as such.
 *
 *   QA_PROFILE=... QA_URL=... QA_OUT=... QA_TAG=manual QA_RUNS=2 QA_PICKS=Digit1,Digit2 QA_LIMIT_S=600 \
 *   QA_JPEG=<game>/node_modules/.pnpm/jpeg-js@<v>/node_modules/jpeg-js play.sh <dir> manual-run.mjs --port N
 * QA_BOSS_DIE_RUNS=1      comma list of 1-based run numbers that put the controller down on their FIRST boss fight
 *                         until the hero dies (forced boss death), then play on normally (tests death -> restart)
 * run.json: deaths[] (room, position), respawns[] (where each new run starts), stuck[] (no kill / room change /
 * boss damage for QA_STUCK_S, default 45 s - walking does NOT reset it), track[] (1 Hz room,x,z), roomFirst.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const P = JSON.parse(readFileSync(process.env.QA_PROFILE, 'utf8'));
const jpeg = createRequire(import.meta.url)(process.env.QA_JPEG);
const URL = process.env.QA_URL ?? 'http://localhost:4861/';
const RUNS = Number(process.env.QA_RUNS ?? 1);
const PICKS = (process.env.QA_PICKS ?? 'Digit1').split(',');
const ROOT = process.env.QA_OUT ?? '/tmp/qa-evidence';
const TAG = process.env.QA_TAG ?? 'manual';
const LIMIT_S = Number(process.env.QA_LIMIT_S ?? 600);
const STUCK_S = Number(process.env.QA_STUCK_S ?? 45);
const DIE_RUNS = (process.env.QA_BOSS_DIE_RUNS ?? '').split(',').filter(Boolean).map(Number);
const W = 1280; const H = 720;
const F = P.fields; const PH = P.phases; const K = P.keys; const S = K.skills;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const view = (page) => page.evaluate(({ g, f }) => { const v = globalThis[g]; if (!v) return null; const o = {}; for (const [n, k] of Object.entries(f)) o[n] = v[k]; return o; }, { g: P.stateGlobal, f: F });
const tap = async (page, key, ms = 60) => { await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key); };
const hold = async (page, keys, ms) => { for (const k of keys) await page.keyboard.down(k); await sleep(ms); for (const k of keys) await page.keyboard.up(k); };

/** Screen analysis on a 1/4-scale grid: vermilion pixels (warning) and the hero (bright, unsaturated blob). */
function analyse(buf) {
  const img = jpeg.decode(buf, { useTArray: true });
  const { width, height, data } = img; const step = 4;
  let rn = 0; let rx = 0; let ry = 0; const red = [];
  const bright = new Map();
  for (let y = Math.floor(height * 0.12); y < height * 0.82; y += step) {
    for (let x = Math.floor(width * 0.04); x < width * 0.96; x += step) {
      const i = (y * width + x) * 4; const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      if (r > 140 && r - g > 80 && r - b > 70) { rn += 1; rx += x; ry += y; red.push([x, y]); }
      if (r > 190 && g > 190 && b > 180 && Math.max(r, g, b) - Math.min(r, g, b) < 30) { const key = `${Math.floor(x / 32)},${Math.floor(y / 32)}`; bright.set(key, (bright.get(key) ?? 0) + 1); }
    }
  }
  // hero = densest 32px cell of bright pixels within the central 70 % (rain streaks are sparse)
  let best = null; let bestN = 0;
  for (const [key, n] of bright) { const [cx, cy] = key.split(',').map(Number); const x = cx * 32 + 16; const y = cy * 32 + 16; if (x < width * 0.15 || x > width * 0.85) continue; if (n > bestN) { bestN = n; best = [x, y]; } }
  return { red: rn, redC: rn ? [rx / rn, ry / rn] : null, redPts: red, hero: bestN >= 6 ? best : null, heroN: bestN, w: width, h: height };
}

async function one(context, index) {
  const tag = `${TAG}-${index + 1}`; const OUT = join(ROOT, tag); mkdirSync(OUT, { recursive: true });
  const rec = { tag, url: URL, mode: 'manual', started: new Date().toISOString(), helpers: 'none (no god, no auto, no skip)', deaths: [], respawns: [], track: [], forcedBossDeath: null, stuck: [], rooms: {}, roomFirst: {}, picks: [], kills: 0, shots: [], timeline: [], pageErrors: [], consoleErrors: [], dashes: 0, inRedFrames: 0, frames: 0, heroMiss: 0 };
  const page = await context.newPage();
  page.on('pageerror', (e) => rec.pageErrors.push(String(e).slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error') rec.consoleErrors.push(m.text().slice(0, 400)); });
  const t0 = Date.now(); const stamp = () => Number(((Date.now() - t0) / 1000).toFixed(1));
  let n = 0;
  const shot = async (name) => { n += 1; const file = `${String(n).padStart(3, '0')}-${name}.jpg`; await page.screenshot({ path: join(OUT, file), type: 'jpeg', quality: 80 }).catch(() => {}); rec.shots.push({ t: stamp(), file }); };
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
      const vx = tx - x; const vz = tz - z; if (Math.hypot(vx, vz) < 0.6) { await sleep(120); continue; }
      const a = vx * basis.w[0] + vz * basis.w[1]; const b = vx * basis.d[0] + vz * basis.d[1];
      const s = Math.max(Math.abs(a), Math.abs(b)) || 1; const keys = [];
      if (Math.abs(a) > 0.25 * s) keys.push(a > 0 ? up : down);
      if (Math.abs(b) > 0.25 * s) keys.push(b > 0 ? right : left);
      await hold(page, keys, 220);
    }
  }
  try {
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.forgeaxInput === 'open', null, { timeout: 180000 });
    rec.openS = stamp();
    for (let i = 0; i < 150 && (await view(page))?.phase !== PH.title; i += 1) await sleep(100);
    await tap(page, K.confirm);
    let lastE = 0; let lastQ = 0; let sweep = 0; let lastProgress = Date.now(); let lastKills = 0; let lastBoss = null; let lastRoom = -1; let lastPhase = ''; let pickN = 0; let lastDeathT = -99; let lastHp = 100;
    let periodic = 0; let lastAim = null; let lastTrack = 0; let awaitingRespawn = false;
    const dieOnce = DIE_RUNS.includes(index + 1); let dieDone = false;
    while (stamp() < LIMIT_S) {
      const v = await view(page); if (!v) { await sleep(200); continue; }
      if (Date.now() - lastTrack > 1000) { lastTrack = Date.now(); rec.track.push([stamp(), v.phase, v.room, +(+v.x).toFixed(2), +(+v.z).toFixed(2), v.hp]); }
      if (awaitingRespawn && v.phase === PH.fight) { awaitingRespawn = false; rec.respawns.push({ t: stamp(), room: v.room, x: +(+v.x).toFixed(2), z: +(+v.z).toFixed(2) }); await shot(`respawn${rec.respawns.length}-r${v.room}`); lastProgress = Date.now(); }
      if (v.phase !== lastPhase) { rec.timeline.push({ t: stamp(), phase: v.phase, room: v.room, hp: v.hp, kills: v.kills }); lastPhase = v.phase; }
      if (v.room !== lastRoom) { lastRoom = v.room; rec.roomFirst[v.room] ??= stamp(); lastProgress = Date.now(); }
      if (v.phase === PH.ending) { if (v.endingStep >= P.endingDoneStep) { rec.endingS = stamp(); await sleep(1200); await shot('ending'); break; } if (v.holdLine) await page.mouse.click(W / 2, H * 0.88, { delay: 90 }); await sleep(250); continue; }
      if (v.phase === PH.dead) {
        if (stamp() - lastDeathT > 3) {
          if (dieOnce && !dieDone && v.room === P.bossRoom) { dieDone = true; rec.forcedBossDeath.died = stamp(); }
          lastDeathT = stamp(); rec.deaths.push({ t: stamp(), room: v.room, wave: v.wave, bossHp: v.bossHp, kills: v.kills, x: +(+v.x).toFixed(1), z: +(+v.z).toFixed(1) });
          await sleep(600); await shot(`death${rec.deaths.length}-r${v.room}`);
          awaitingRespawn = true;
        }
        await tap(page, K.confirm); await sleep(800); continue;
      }
      if (v.phase === PH.title) { await tap(page, K.confirm); await sleep(400); continue; }
      if (v.phase === PH.lines || v.holdLine) { await tap(page, K.confirm); await sleep(250); continue; }
      if (PH.pick.includes(v.phase)) {
        pickN += 1; const plan = PICKS[(index + pickN - 1) % PICKS.length];
        await sleep(400); await tap(page, plan); await sleep(300); await tap(page, plan); await sleep(500);
        rec.picks.push({ t: stamp(), phase: v.phase, plan, after: (await view(page))?.pick }); continue;
      }
      if (PH.bossCue && v.phase === PH.bossCue) { await sleep(500); await tap(page, K.confirm); await sleep(300); continue; }
      if (v.phase !== PH.fight) { await sleep(150); continue; }
      // ---- fight ----
      if (dieOnce && !dieDone && v.room === P.bossRoom && v.bossHp > 0) {
        // controller down: no input until the hero dies (screenshots every 6 s)
        if (!rec.forcedBossDeath) { rec.forcedBossDeath = { start: stamp(), hp: v.hp }; await shot('forced-boss-death-start'); }
        if (Date.now() - periodic > 6000) { periodic = Date.now(); await shot(`forced-r${v.room}`); }
        lastProgress = Date.now(); await sleep(250); continue;
      }
      if (v.kills > lastKills) { lastKills = v.kills; lastProgress = Date.now(); }
      if (lastBoss !== null && v.bossHp < lastBoss) lastProgress = Date.now();
      lastBoss = v.bossHp;
      if (v.hp < lastHp) rec.hits = (rec.hits ?? 0) + 1; lastHp = v.hp;
      if ((Date.now() - lastProgress) / 1000 > STUCK_S) {
        rec.stuck.push({ t: stamp(), room: v.room, wave: v.wave, exitOpen: v.exitOpen, x: +(+v.x).toFixed(1), z: +(+v.z).toFixed(1), hp: v.hp, bossHp: v.bossHp });
        await shot(`stuck${rec.stuck.length}-r${v.room}`); lastProgress = Date.now();
      }
      if (Date.now() - periodic > 6000) { periodic = Date.now(); await shot(`p-r${v.room}-w${v.wave}`); }
      if (v.exitOpen && !(v.transition > 0)) { const ex = P.exits[v.room]; if (ex) await walkTo(v.room, ex[0], ex[1]); else await sleep(200); continue; }
      const a = analyse(await page.screenshot({ type: 'jpeg', quality: 60 }));
      rec.frames += 1;
      const hero = a.hero ?? [W / 2, H * 0.5]; if (!a.hero) rec.heroMiss += 1;
      // warning under the hero? (any red sample within 28 px of the hero point)
      const under = a.redPts.some(([x, y]) => Math.abs(x - hero[0]) < 28 && Math.abs(y - hero[1]) < 28);
      if (under) {
        rec.inRedFrames += 1;
        const c = a.redC; let dx = hero[0] - c[0]; let dy = hero[1] - c[1]; if (Math.hypot(dx, dy) < 4) { dx = 1; dy = 0; }
        const keys = []; if (Math.abs(dy) > Math.abs(dx) * 0.4) keys.push(dy < 0 ? K.move[0] : K.move[1]); if (Math.abs(dx) > Math.abs(dy) * 0.4) keys.push(dx > 0 ? K.move[2] : K.move[3]);
        for (const k of keys) await page.keyboard.down(k); await sleep(30); await tap(page, 'Space', 50); await sleep(120); for (const k of keys) await page.keyboard.up(k);
        rec.dashes += 1;
        if (a.redC) lastAim = a.redC;
        continue;
      }
      // aim: toward the red centroid (the attacker's side), else last aim, else sweep
      let aim;
      if (a.redC) { aim = a.redC; lastAim = aim; } else if (lastAim && Math.random() < 0.6) aim = lastAim; else { sweep += 1; const ang = sweep * Math.PI / 4; aim = [hero[0] + Math.cos(ang) * 160, hero[1] + Math.sin(ang) * 110]; }
      await page.mouse.move(aim[0], aim[1]);
      await page.mouse.down(); await sleep(50); await page.mouse.up();
      if (S.e && Date.now() - lastE > 1500) { lastE = Date.now(); await tap(page, S.e, 40); }
      if (S.q && Date.now() - lastQ > 4500) { lastQ = Date.now(); await tap(page, S.q, 40); }
      if (S.ult && v.meter >= P.meterFull) await tap(page, S.ult, 50);
      // drift toward the room centre a little so enemies come into reach
      if (Math.random() < 0.15) { const keys = [K.move[Math.floor(Math.random() * 4)]]; await hold(page, keys, 160); }
      await sleep(60);
    }
    if (!rec.endingS) { rec.timedOut = stamp(); await shot('timeout'); }
  } catch (e) { rec.exception = String(e?.stack ?? e).slice(0, 1200); await shot('EXCEPTION'); }
  finally {
    rec.seconds = stamp(); rec.final = await view(page).catch(() => null);
    writeFileSync(join(OUT, 'run.json'), JSON.stringify(rec, null, 2)); await page.close();
  }
  return rec;
}

export default async function manual(play) {
  const browser = play.page.context().browser(); const out = [];
  for (let i = 0; i < RUNS; i += 1) { const ctx = await browser.newContext({ viewport: { width: W, height: H } }); try { out.push(await one(ctx, i)); } finally { await ctx.close(); } }
  await play.page.bringToFront().catch(() => undefined);
  const summary = out.map((r) => ({ tag: r.tag, seconds: r.seconds, forcedBossDeath: r.forcedBossDeath, respawns: r.respawns, endingS: r.endingS ?? null, timedOut: r.timedOut ?? null, deaths: r.deaths.length, deathRooms: r.deaths.map((d) => d.room), stuck: r.stuck.length, rooms: r.roomFirst, picks: r.picks.length, errors: r.pageErrors.length + r.consoleErrors.length, dashes: r.dashes, frames: r.frames, heroMiss: r.heroMiss, exception: r.exception?.slice(0, 200) ?? null }));
  console.log(JSON.stringify(summary)); return summary;
}
