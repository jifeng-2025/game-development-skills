/**
 * AU002 audio evidence run (evidence tooling only; never loaded by the game). Built from the
 * 游戏音效制作skill skill's play-audio.mjs; adds a full no-god run and a master-volume output probe.
 *
 *   AUDIO_OUT=<dir> AUDIO_MINUTES=9 pnpm exec forgeax project play assets/audio/tools/play-full.mjs --json --timeout-ms 1500000 >/tmp/p.out 2>/tmp/p.err
 *   grep '^{"ok"' /tmp/p.out | tail -1
 *
 * Part 1 — volume: on the title, real keys move the menu (ui-move, a fixed clip with no pitch spread) while an
 *   AnalyserNode tapped on the Host master fader records the output peak. Real mouse drags the settings slider
 *   80 → 30 → 80; each step reads the slider value, __inkPrefs, the applied master and the fader AudioParam.
 * Part 2 — full run, invincibility never enabled: the game's existing `auto` aim command fights (as in F001/F003
 *   full runs); R is a real key press whenever ink is full; the first hex pick uses a real mouse click (hexArm via
 *   mouse), later picks use digits (hexArm via key); dialogue/plates use Enter; exits are walked with real WASD.
 *   Death → Enter re-enters. Stops at the ending or the time limit.
 * Read-only taps: Engine `__inkAudioStats`; Host `__inkAudioHost()`, `__inkAudioEngine()`, `__inkView`.
 */
import fs from 'node:fs';
import path from 'node:path';

const env = process.env;
const CONFIG = {
  out: env.AUDIO_OUT ?? path.resolve('.forgeax/diag/audio-full'),
  minutes: Number(env.AUDIO_MINUTES ?? 9),
  read: { read: 'ink-run' },
  exits: [[0, -2.15], [0, 60.5], [0, -56]],
  expect: ['ult-start', 'ult-slash', 'ult-end', 'e-refresh', 'player-hurt', 'kill-ink-heavy', 'ui-hex-select'],
};

export default async function fullRun(play) {
  const OUT = CONFIG.out;
  fs.mkdirSync(OUT, { recursive: true });
  const page = play.page;
  const read = CONFIG.read;
  const log = [];
  const t0 = Date.now();
  const note = (m) => { log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${m}`); };
  const engine = () => page.workers().find((w) => w.url().includes('engine-worker')) ?? page;
  const stats = () => engine().evaluate(() => { const s = globalThis.__inkAudioStats; return s ? JSON.parse(JSON.stringify(s)) : null; });
  const host = () => page.evaluate(() => { try { return JSON.parse(JSON.stringify(globalThis.__inkAudioHost?.() ?? null)); } catch (e) { return { error: String(e) }; } });
  const view = () => page.evaluate(() => {
    const v = globalThis.__inkView; if (!v) return null;
    return { phase: v.phase, room: v.room, wave: v.wave, hp: v.hp, kills: v.kills, ink: v.ink, x: v.x, z: v.z, exitOpen: v.exitOpen,
      transition: v.transition, holdLine: v.holdLine, endingStep: v.endingStep, settings: v.settings, paused: v.paused, god: v.god, auto: v.auto, hex: v.hex, bossHp: v.bossHp };
  });
  const shot = async (name) => {
    const r = await play.screenshot(`au002-${name}`);
    const src = typeof r === 'string' ? r : r?.path ?? r?.uri;
    if (src && fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, `au002-${name}.png`));
  };
  const wall = (ms) => page.waitForTimeout(ms);
  const tap = async (key) => { await page.keyboard.down(key); await play.advance(0.07, read); await page.keyboard.up(key); };
  const save = (name, data) => fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(data, null, 2)}\n`);

  // ---------- Part 1: master volume ----------
  await play.advance(0.5, read);
  note(`boot ${JSON.stringify(await stats())}`);
  await tap('KeyS'); await play.advance(0.4, read); await wall(600); // warm-up gesture: creates + resumes the Host context
  const tapInfo = await page.evaluate(() => {
    const eng = globalThis.__inkAudioEngine?.();
    const fader = eng?.graph?.buses?.get?.('master')?.nodes?.fader;
    if (!fader) return { ok: false, why: eng ? 'no master fader (context not created yet?)' : 'no __inkAudioEngine' };
    const an = fader.context.createAnalyser(); an.fftSize = 2048; fader.connect(an);
    const buf = new Float32Array(an.fftSize);
    const s = (globalThis.__au002 = { peak: 0, sumSq: 0, n: 0 });
    s.timer = setInterval(() => { an.getFloatTimeDomainData(buf); for (const v of buf) { const a = Math.abs(v); if (a > s.peak) s.peak = a; s.sumSq += v * v; s.n += 1; } }, 8);
    return { ok: true, contextState: fader.context.state, gain: fader.gain.value };
  });
  note(`analyser ${JSON.stringify(tapInfo)}`);
  const levels = () => page.evaluate(() => {
    const eng = globalThis.__inkAudioEngine?.(); const fader = eng?.graph?.buses?.get?.('master')?.nodes?.fader;
    const s = globalThis.__au002; const slider = document.querySelector('#ui-volume');
    return { peak: s?.peak ?? null, faderGain: fader?.gain.value ?? null, slider: slider ? Number(slider.value) : null,
      prefs: globalThis.__inkPrefs?.volume ?? null, applied: globalThis.__inkAudioHost?.()?.master ?? null };
  });
  /** Advance until the worker's run (mirrored in __inkView) satisfies `ok`; the HUD and the Engine Worker sync only while frames advance. */
  const settle = async (ok, what) => {
    for (let k = 0; k < 40; k += 1) { const s = await view(); if (s && ok(s)) return true; await play.advance(0.1, read); }
    note(`settle timeout: ${what} ${JSON.stringify(await view())}`); return false;
  };
  const moves = async () => (await stats())?.played?.['ui-move'] ?? 0;
  const measure = async (label, key) => {
    await settle((s) => s.phase === 'title' && !s.settings, 'title, settings closed');
    await play.advance(0.3, read); await wall(900); // let any earlier tail die out
    await page.evaluate(() => { const s = globalThis.__au002; if (s) s.peak = 0; });
    await wall(300);
    const quiet = (await levels()).peak;
    const before = await moves();
    await tap(key); await play.advance(0.4, read); await wall(800);
    const after = await levels();
    const row = { label, key, quietPeak: quiet, uiMovePlayed: (await moves()) - before, ...after };
    note(`measure ${JSON.stringify(row)}`);
    return row;
  };
  const drag = async (target) => {
    let box = null;
    for (let k = 0; k < 20 && !(box?.w > 0); k += 1) { // the panel draws a few frames after the worker reports settings open
      box = await page.evaluate(() => { const el = document.querySelector('#ui-volume'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width, v: Number(el.value) }; });
      if (!(box?.w > 0)) await play.advance(0.1, read);
    }
    if (!box || box.w === 0) return { ok: false, box };
    const at = (v) => box.x + box.w * v / 100;
    await page.mouse.move(at(box.v), box.y); await page.mouse.down();
    for (let k = 1; k <= 8; k += 1) { await page.mouse.move(at(box.v + (target - box.v) * k / 8), box.y); await play.advance(0.03, read); }
    await page.mouse.up(); await play.advance(0.3, read); await wall(400); // volume.ts polls every 150 ms
    return { ok: true, from: box.v, ...(await levels()) };
  };
  const clickAct = async (act) => {
    // The HUD redraws from worker state; a menu that is about to reappear needs a few frames before it is clickable.
    let p = null;
    for (let k = 0; k < 20 && !p; k += 1) {
      p = await page.evaluate((a) => { const el = [...document.querySelectorAll(`[data-act="${a}"]`)].find((n) => n.getBoundingClientRect().width > 0); if (!el) return null; const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, act);
      if (!p) await play.advance(0.1, read);
    }
    if (!p) return false;
    await page.mouse.click(p[0], p[1], { delay: 110 }); await play.advance(0.3, read); return true;
  };

  /** HUD title-menu cursor (read from the DOM) → move with real W/S until it sits on `act`. */
  const menuTo = async (act) => {
    for (let k = 0; k < 6; k += 1) {
      const cur = await page.evaluate(() => document.querySelector('#ui-menu .ui-menu-item.is-selected')?.getAttribute('data-act') ?? null);
      if (cur === act || cur === null) return cur;
      await tap('KeyW'); await play.advance(0.2, read);
    }
    return null;
  };
  /**
   * Title-menu 设置 is unusable for this (game bug: the flow plugin starts the run on any Enter/click on the title,
   * so settings opens on top of a started run). Route instead: start → pick → fight → Esc pause → 设置 → drag → 返回 → 回标题.
   */
  const setVolumeViaPause = async (target) => {
    const r = { target };
    await settle((s) => s.phase === 'title' && !s.settings, 'title');
    await play.advance(0.5, read);
    r.cursor = await menuTo('start');
    await tap('Enter');
    for (let k = 0; k < 60; k += 1) {
      const s = await view();
      if (s?.phase === 'fight' && !s.holdLine) break;
      if (s?.phase === 'hex' || s?.phase === 'hexMid' || s?.phase === 'hex2') { await tap('Digit1'); await play.advance(0.3, read); await tap('Digit1'); }
      else if (s?.phase === 'lines' || s?.holdLine) await tap('Enter');
      await play.advance(0.3, read);
    }
    await tap('Escape');
    r.paused = await settle((s) => s.paused === true, 'paused');
    await play.advance(0.3, read);
    r.clickedSettings = await clickAct('settings');
    r.opened = await settle((s) => s.settings === true, 'settings open');
    await play.advance(0.3, read);
    r.drag = await drag(target);
    if (target === 30) await shot('settings-30');
    r.clickedBack = await clickAct('back');
    r.closed = await settle((s) => !s.settings, 'settings closed');
    await play.advance(0.3, read);
    r.clickedTitle = await clickAct('title');
    r.title = await settle((s) => s.phase === 'title' && !s.settings, 'back on title');
    note(`via pause ${JSON.stringify(r)}`);
    return r;
  };

  const volume = { tap: tapInfo, steps: [], routes: [] };
  // warm-up S put the cursor on 设置; measure with S/W pairs so Enter always starts from 入院.
  await tap('KeyW'); await play.advance(0.3, read); await wall(900);
  volume.steps.push(await measure('at 80 (default)', 'KeyS'));
  volume.routes.push(await setVolumeViaPause(30));
  volume.steps.push(await measure('at 30 (dragged in settings)', 'KeyS'));
  volume.routes.push(await setVolumeViaPause(80));
  volume.steps.push(await measure('at 80 (dragged back)', 'KeyS'));
  const [a, b, c] = volume.steps;
  volume.ratio30 = a?.peak && b?.peak ? +(b.peak / a.peak).toFixed(3) : null;
  volume.ratio80 = a?.peak && c?.peak ? +(c.peak / a.peak).toFixed(3) : null;
  // Expected output ratio = fader gain ratio (same fixed clip, same tier volume).
  volume.expected30 = a?.faderGain && b?.faderGain ? +(b.faderGain / a.faderGain).toFixed(3) : null;
  volume.expected80 = a?.faderGain && c?.faderGain ? +(c.faderGain / a.faderGain).toFixed(3) : null;
  save('volume-probe.json', volume);
  note(`volume ratio30=${volume.ratio30} ratio80=${volume.ratio80}`);

  // ---------- Part 2: full run, never invincible ----------
  await settle((s) => s.phase === 'title' && !s.settings, 'title before start');
  await play.advance(0.5, read);
  await menuTo('start');
  await tap('Enter'); // 入院
  let v = await view();
  let lastR = 0;
  const deadline = Date.now() + CONFIG.minutes * 60_000;
  let autoOn = false;
  let firstPick = true;
  let deaths = 0, ults = 0, lastKey = '';
  const rooms = {};
  const hexPicks = [];
  const bases = new Map();
  const walkTo = async (room, tx, tz) => {
    const step = async (key) => { const p0 = await view(); await page.keyboard.down(key); await play.advance(0.26, read); await page.keyboard.up(key); await play.advance(0.06, read); const p1 = await view(); return [p1.x - p0.x, p1.z - p0.z]; };
    let basis = bases.get(room);
    if (!basis) {
      const w1 = await step('KeyW'), w2 = await step('KeyS'), d1 = await step('KeyD'), d2 = await step('KeyA');
      basis = { w: [(w1[0] - w2[0]) / 2, (w1[1] - w2[1]) / 2], d: [(d1[0] - d2[0]) / 2, (d1[1] - d2[1]) / 2] };
      if (Math.hypot(...basis.w) > 0.05 && Math.hypot(...basis.d) > 0.05) bases.set(room, basis);
    }
    for (let i = 0; i < 80; i += 1) {
      const p = await view();
      if (!p || !p.exitOpen || p.transition > 0 || p.phase !== 'fight') return;
      const tvx = tx - p.x, tvz = tz - p.z;
      if (Math.hypot(tvx, tvz) < 0.6) { await play.advance(0.12, read); continue; }
      const aa = tvx * basis.w[0] + tvz * basis.w[1], bb = tvx * basis.d[0] + tvz * basis.d[1];
      const keys = []; const sc = Math.max(Math.abs(aa), Math.abs(bb)) || 1;
      if (Math.abs(aa) > 0.25 * sc) keys.push(aa > 0 ? 'KeyW' : 'KeyS');
      if (Math.abs(bb) > 0.25 * sc) keys.push(bb > 0 ? 'KeyD' : 'KeyA');
      for (const k of keys) await page.keyboard.down(k);
      await play.advance(0.22, read);
      for (const k of keys) await page.keyboard.up(k);
    }
  };
  const setAuto = (on) => page.evaluate((o) => globalThis.__inkSend?.({ t: 'auto', on: o }), on);
  const pickHex = async (phase) => {
    const cards = await page.evaluate(() => [...document.querySelectorAll('.ui-hex-card')].map((c) => { const r = c.getBoundingClientRect(); return { hex: c.getAttribute('data-hex'), x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; }));
    const card = cards.find((k) => k.w > 0);
    const entry = { phase, via: firstPick && card ? 'mouse' : 'key' };
    const before = (await stats())?.played?.['ui-hex-select'] ?? 0;
    if (entry.via === 'mouse') {
      entry.card = card.hex;
      await page.mouse.move(card.x, card.y);
      await page.mouse.click(card.x, card.y, { delay: 120 }); await play.advance(0.4, read);
      entry.selectAfterFirst = ((await stats())?.played?.['ui-hex-select'] ?? 0) - before;
      await page.mouse.click(card.x, card.y, { delay: 120 });
    } else {
      await tap('Digit2'); await play.advance(0.4, read);
      entry.selectAfterFirst = ((await stats())?.played?.['ui-hex-select'] ?? 0) - before;
      await tap('Digit2');
    }
    await play.advance(0.5, read);
    entry.selectTotalDelta = ((await stats())?.played?.['ui-hex-select'] ?? 0) - before;
    entry.after = (await view())?.phase;
    hexPicks.push(entry); firstPick = false;
    note(`pick ${JSON.stringify(entry)}`);
  };

  for (let i = 0; Date.now() < deadline; i += 1) {
    v = await view();
    if (!v) { await play.advance(0.25, read); continue; }
    const key = `${v.phase}/${v.room}/${v.wave}/${v.exitOpen}`;
    if (key !== lastKey) { note(`state ${key} hp=${Math.round(v.hp)} ink=${v.ink} kills=${v.kills}`); lastKey = key; }
    if (rooms[v.room] === undefined) { rooms[v.room] = ((Date.now() - t0) / 1000).toFixed(1); if (v.room > 0) await shot(`room${v.room}`); }
    if (i % 8 === 0) save('audio-progress.json', { t: (Date.now() - t0) / 1000, view: v, deaths, ults, audio: await stats(), log });
    if (v.phase === 'ending' && v.endingStep >= 2) { await play.advance(0.6, read); await shot('ending'); note('ending'); break; }
    if (v.phase === 'ending' && v.holdLine) { await page.mouse.click(640, 640, { delay: 90 }); await play.advance(0.25, read); continue; }
    if (v.phase === 'title') { if (log.some((l) => l.includes('state ending'))) break; await tap('Enter'); await play.advance(0.4, read); continue; }
    if (v.phase === 'lines' || v.holdLine) { await tap('Enter'); await play.advance(0.18, read); continue; }
    if (v.phase === 'hex' || v.phase === 'hexMid' || v.phase === 'hex2') { await pickHex(v.phase); continue; }
    if (v.phase === 'dead') { deaths += 1; note(`dead #${deaths}`); if (deaths === 1) await shot('dead'); await tap('Enter'); await play.advance(0.5, read); continue; }
    if (v.phase === 'bossCue') { await tap('Enter'); await play.advance(0.2, read); continue; }
    if (v.phase === 'fight' && !autoOn) { await setAuto(true); autoOn = true; note('auto on (no god)'); }
    // R every ~1 s of play time: the game ignores it until ink is full (5), so this is plain real input, no state peeking.
    if (v.phase === 'fight' && i - lastR >= 4) {
      lastR = i; const before = (await stats())?.played?.['ult-start'] ?? 0;
      await tap('KeyR'); await play.advance(0.3, read);
      if (((await stats())?.played?.['ult-start'] ?? 0) > before) { ults += 1; note(`ult #${ults} (ink was ${v.ink})`); if (ults === 1) await shot('ult'); }
      continue;
    }
    if (v.phase === 'fight' && v.exitOpen && v.transition <= 0) {
      await setAuto(false);
      try { await walkTo(v.room, CONFIG.exits[v.room][0], CONFIG.exits[v.room][1]); } finally { await setAuto(true); }
      continue;
    }
    await play.advance(0.25, read);
  }
  await setAuto(false);
  const final = { volume, engine: await stats(), host: await host(), view: await view(), rooms, deaths, ults, hexPicks, log };
  final.missing = CONFIG.expect.filter((n) => !final.engine?.played?.[n]);
  save('audio-play.json', final);
  if (!final.engine) throw new Error('__inkAudioStats missing in the Engine realm');
  return { loaded: final.engine.loaded, failed: final.engine.failed, missing: final.missing, deaths, ults, rooms,
    volume: { ratio30: volume.ratio30, ratio80: volume.ratio80, gains: volume.steps.map((s) => s.faderGain) }, phase: final.view?.phase, hexPicks: hexPicks.length };
}
