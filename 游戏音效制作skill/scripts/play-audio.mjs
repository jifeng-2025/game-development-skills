/**
 * Audio evidence playthrough for `forgeax project play` (evidence tooling only; never loaded by the game).
 * Copied from inkblade AU001 and parameterized. Real input only (keyboard / mouse through `play`).
 *
 *   AUDIO_OUT=<evidence dir> AUDIO_SECONDS=60 AUDIO_GOD=never \
 *     pnpm exec forgeax project play <path-to>/play-audio.mjs --json --timeout-ms 1200000 >/tmp/play.out 2>/tmp/play.err
 *   grep '^{"ok"' /tmp/play.out | tail -1          # stdout carries texture-compressor logs; never pipe to head (EPIPE)
 *
 * It reads three read-only taps the audio code exposes (names in CONFIG):
 *   Engine realm  globalThis[CONFIG.statsGlobal]  { loaded, failed[], events{}, played{}, skipped{}, peakVoices }
 *   Host page     globalThis[CONFIG.hostGlobal]() { master, active, state:{ contextState, lastError } }
 *   Engine realm  optional aim helpers (CONFIG.aim*) — a VFX/debug tap with player + foe positions and the camera.
 * Output: <AUDIO_OUT>/audio-play.json (final), audio-progress.json (every 5 ticks; survives a crash),
 *         screenshots <tag>-fight-start/mid/end.png, and a `missing` list of sounds that never played.
 *
 * Game-specific flow (menus, phase names, keys) lives ONLY in CONFIG + enterGame(); adapt those for a new game.
 */
import fs from 'node:fs';
import path from 'node:path';

const env = process.env;
const CONFIG = {
  out: env.AUDIO_OUT ?? path.resolve('.forgeax/diag/audio-play'),
  tag: env.AUDIO_TAG ?? 'audio',
  seconds: Number(env.AUDIO_SECONDS ?? 60),
  /** 'start' = invincible from the first frame, 'never' = never (needed for hurt/death sounds), else seconds until enabled. */
  god: env.AUDIO_GOD ?? '15',
  godKey: env.AUDIO_GOD_KEY ?? 'F2',
  /** Game projection read registered by the flow plugin (`gameProjection.registerRead({ id })`); must return { phase, kills }. */
  read: { read: env.AUDIO_READ ?? 'ink-run' },
  engineWorkerUrl: 'engine-worker',
  statsGlobal: env.AUDIO_STATS_GLOBAL ?? '__inkAudioStats',
  hostGlobal: env.AUDIO_HOST_GLOBAL ?? '__inkAudioHost',
  /** Optional aim tap: { player:[x,z], foes:{ id:[x,z,t] }, events:{} } and a camera { pos, quat, forward, fovY, aspect }. */
  aimStatsGlobal: env.AUDIO_AIM_GLOBAL ?? '__inkVfxStats',
  aimCameraGlobal: env.AUDIO_CAMERA_GLOBAL ?? '__inkVfxCamera',
  /** Camera yaw (deg) for turning a world direction into WASD on an oblique camera. */
  cameraYawDeg: Number(env.AUDIO_YAW ?? 38),
  /** Settings volume slider (CSS selector, Host page). When set, the run ends by moving it to 30 and recording master before/after. */
  volumeSelector: env.AUDIO_VOLUME_SELECTOR ?? '',
  /** Expected sound names (comma list); anything never played is reported in `missing`. */
  expect: (env.AUDIO_EXPECT ?? '').split(',').filter(Boolean),
  skills: [ // pressed in priority order when off cooldown (ms) and the nearest foe is within `range` (m, 0 = any)
    { key: 'KeyR', every: 3000, range: 0 },
    { key: 'KeyE', every: 3400, range: 6.5 },
    { key: 'KeyQ', every: 2600, range: 5 },
    { key: 'Space', every: 5000, range: 0 },
  ],
  pickPhases: ['hex', 'hexMid', 'hex2'], pickKey: 'Digit2',
  advancePhases: ['title', 'lines', 'bossCue'], advanceKey: 'Enter',
  deadPhase: 'dead', restartKey: 'Enter',
};

/** Title → story → first pick → fight. Exercises the UI sounds (menu move ×2, confirm, pick select/confirm). */
async function enterGame(play, read, note) {
  await play.keyboard.press('KeyS'); await play.advance(0.2, read);
  await play.keyboard.press('KeyW'); await play.advance(0.2, read);
  await play.keyboard.press('Enter');
  let s = await play.advance(0.6, read);
  for (let i = 0; i < 16 && s.phase === 'lines'; i += 1) { await play.keyboard.press('Enter'); s = await play.advance(0.5, read); }
  if (CONFIG.pickPhases.includes(s.phase)) {
    await play.keyboard.press('Digit1'); await play.advance(0.3, read); // first press = select (armed)
    await play.keyboard.press('Digit1'); s = await play.advance(0.5, read); // second press = confirm
  }
  note(`entered phase=${s.phase}`);
  return s;
}

export default async function audioPlay(play) {
  const OUT = CONFIG.out;
  fs.mkdirSync(OUT, { recursive: true });
  const page = play.page;
  const read = CONFIG.read;
  const log = [];
  const t0 = Date.now();
  const note = (m) => log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${m}`);
  // Engine Worker when the game runs in engine-worker mode; the page itself in main-serial mode.
  const engine = () => page.workers().find((w) => w.url().includes(CONFIG.engineWorkerUrl)) ?? page;
  const stats = () => engine().evaluate((g) => { const s = globalThis[g]; return s ? JSON.parse(JSON.stringify(s)) : null; }, CONFIG.statsGlobal);
  const host = () => page.evaluate((g) => { try { return JSON.parse(JSON.stringify(globalThis[g]?.() ?? null)); } catch (e) { return { error: String(e) }; } }, CONFIG.hostGlobal);
  const aim = () => engine().evaluate((g) => { const v = globalThis[g]; return v ? { player: v.player, foes: { ...(v.foes ?? {}) }, events: { ...(v.events ?? {}) } } : null; }, CONFIG.aimStatsGlobal);
  const project = (x, z, y = 0.9) => engine().evaluate(({ x, y, z, g }) => {
    const c = globalThis[g]; if (!c) return null;
    const [qx, qy, qz, qw] = c.quat;
    const rot = ([vx, vy, vz]) => { const ix = qw * vx + qy * vz - qz * vy, iy = qw * vy + qz * vx - qx * vz, iz = qw * vz + qx * vy - qy * vx, iw = -qx * vx - qy * vy - qz * vz;
      return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx]; };
    const r = rot([1, 0, 0]), u = rot([0, 1, 0]), f = c.forward, d = [x - c.pos[0], y - c.pos[1], z - c.pos[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const zz = dot(d, f); if (zz <= 0.1) return null;
    const t = Math.tan(c.fovY / 2);
    return [0.5 + dot(d, r) / (zz * t * c.aspect) / 2, 0.5 - dot(d, u) / (zz * t) / 2];
  }, { x, y, z, g: CONFIG.aimCameraGlobal });
  const shot = async (name) => {
    const r = await play.screenshot(`${CONFIG.tag}-${name}`);
    const src = typeof r === 'string' ? r : r?.path ?? r?.uri;
    if (src && fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, `${CONFIG.tag}-${name}.png`));
  };

  await play.advance(0.4, read);
  note(`boot stats ${JSON.stringify(await stats())}`);
  let s = await enterGame(play, read, note);
  let god = CONFIG.god === 'start';
  if (god) await play.keyboard.press(CONFIG.godKey);
  await shot('fight-start');

  const w = page.viewportSize()?.width ?? 1280, h = page.viewportSize()?.height ?? 720;
  const YAW = CONFIG.cameraYawDeg * Math.PI / 180;
  const held = new Set();
  const setMove = async (want) => {
    for (const [k, code] of Object.entries({ w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD' })) {
      if (want.has(k) && !held.has(k)) { await page.keyboard.down(code); held.add(k); }
      if (!want.has(k) && held.has(k)) { await page.keyboard.up(code); held.delete(k); }
    }
  };
  const moveToward = async (dx, dz) => {
    const v = dx * Math.sin(YAW) - dz * Math.cos(YAW), hh = dx * Math.cos(YAW) + dz * Math.sin(YAW), n = Math.hypot(v, hh) || 1;
    const want = new Set();
    if (v / n > .38) want.add('w'); if (v / n < -.38) want.add('s'); if (hh / n > .38) want.add('d'); if (hh / n < -.38) want.add('a');
    await setMove(want);
  };
  let cursor = [0.55, 0.45];
  const clocks = Object.fromEntries(CONFIG.skills.map((k) => [k.key, 0]));
  const start = Date.now();
  const hostSamples = [];
  for (let i = 0; Date.now() - start < CONFIG.seconds * 1000; i += 1) {
    const godAfter = Number(CONFIG.god);
    if (!god && Number.isFinite(godAfter) && Date.now() - start > godAfter * 1000) { await play.keyboard.press(CONFIG.godKey); god = true; note('god on'); }
    const v = await aim();
    if (i % 5 === 0) fs.writeFileSync(path.join(OUT, 'audio-progress.json'), JSON.stringify({ t: (Date.now() - start) / 1000, phase: s.phase, audio: await stats(), aimEvents: v?.events, log }, null, 1));
    let best, bd = 1e9;
    if (v?.player) for (const [id, f] of Object.entries(v.foes)) { if (id === 'hit' && Object.keys(v.foes).length > 1) continue; const d = Math.hypot(f[0] - v.player[0], f[1] - v.player[1]); if (d < bd) { bd = d; best = f; } }
    if (best) { const p = await project(best[0], best[1]); if (p) cursor = [Math.min(.95, Math.max(.05, p[0])), Math.min(.9, Math.max(.08, p[1]))]; }
    await page.mouse.move(cursor[0] * w, cursor[1] * h);
    if (best && bd > 2.2) await moveToward(best[0] - v.player[0], best[1] - v.player[1]); else await setMove(new Set());
    const now = Date.now();
    const skill = CONFIG.skills.find((k) => now - clocks[k.key] > k.every && (k.range === 0 || (best && bd < k.range)));
    if (skill) { clocks[skill.key] = now; await play.keyboard.press(skill.key); } else { await page.mouse.down(); await page.mouse.up(); }
    s = await play.advance(0.2, read);
    if (i % 4 === 0) hostSamples.push((await host())?.active ?? null);
    if (i === 60) await shot('fight-mid');
    if (CONFIG.advancePhases.includes(s.phase)) await play.keyboard.press(CONFIG.advanceKey);
    if (s.phase === CONFIG.deadPhase) { await play.keyboard.press(CONFIG.restartKey); note('dead → restart'); }
    if (CONFIG.pickPhases.includes(s.phase)) {
      await play.keyboard.press(CONFIG.pickKey); await play.advance(0.3, read); await play.keyboard.press(CONFIG.pickKey); note(`pick at ${s.phase}`);
    }
  }
  await setMove(new Set());
  await shot('fight-end');
  let volumeProbe = null;
  if (CONFIG.volumeSelector) {
    const before = (await host())?.master;
    const found = await page.evaluate((sel) => {
      const walk = (root) => root.querySelector(sel) ?? [...root.querySelectorAll('*')].map((n) => n.shadowRoot && walk(n.shadowRoot)).find(Boolean);
      const el = walk(document); if (!el) return false;
      el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); return true;
    }, CONFIG.volumeSelector);
    await new Promise((r) => setTimeout(r, 400)); // volume.ts polls every 150 ms
    volumeProbe = { found, before, after: (await host())?.master };
  }
  const engineStats = await stats();
  const played = engineStats?.played ?? {};
  const final = {
    aimEvents: (await aim())?.events ?? null, engine: engineStats, host: await host(),
    hostActiveSamples: hostSamples, hostActivePeak: Math.max(0, ...hostSamples.filter((x) => typeof x === 'number')),
    missing: CONFIG.expect.filter((n) => !played[n]), volumeProbe, run: s, log,
  };
  note(`final phase=${s.phase} kills=${s.kills}`);
  fs.writeFileSync(path.join(OUT, 'audio-play.json'), `${JSON.stringify(final, null, 2)}\n`);
  if (!final.engine) throw new Error(`${CONFIG.statsGlobal} missing in the Engine realm (plugin not registered?)`);
  if (final.engine.loaded === 0) throw new Error(`no clips loaded: ${JSON.stringify(final.engine.failed)}`);
  return { loaded: final.engine.loaded, failed: final.engine.failed, played, missing: final.missing, volumeProbe, hostActivePeak: final.hostActivePeak, phase: s.phase, kills: s.kills };
}
