/**
 * Preview driver core (游戏预览故障修复skill). Opens a BUILT page (project preview / static zip server)
 * in a browser context, plays it with real keyboard/mouse, and writes one JSON record per run.
 * Everything game-specific lives in a profile module (see templates/profile.inkblade.mjs).
 *
 * Two ways to run the same driver:
 *   1. fast loop (seconds to start, your own headed Chrome):
 *        FIX_URL=http://localhost:4801/ FIX_PROFILE=/abs/profile.mjs FIX_MODE=hold \
 *        node scripts/fast-run.mjs scripts/driver.mjs
 *   2. official gate (`project play`, applies the dev-verify final-frame gate; 3–6 min startup):
 *        cd <game> && FIX_URL=... FIX_PROFILE=... pnpm exec forgeax project play /abs/scripts/driver.mjs --json
 *
 * Env:
 *   FIX_URL        built page URL (required)
 *   FIX_PROFILE    absolute path to the profile module (required)
 *   FIX_MODE       profile mode name, e.g. hold | full | shots | start (profile decides)
 *   FIX_RUNS       repeat count (default 1); each run gets a fresh browser context
 *   FIX_TAG        file prefix for records/screenshots (default "run")
 *   FIX_OUT        evidence directory (default ./fix-evidence)
 *   FIX_VIEWPORT   WxH (default 1280x720)
 *   FIX_TRACE      1 = inject the render-publication duplicate-row tracer into every worker (pub-trace.mjs)
 *   FIX_OPEN_MS    max wait for input to open (default 150000)
 *   FIX_DEADLINE_S whole-run budget in seconds (default 540)
 * Any other FIX_* variable is passed to the profile as ctx.env.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installPublicationTrace } from './pub-trace.mjs';

const env = process.env;
const URL = env.FIX_URL;
const MODE = env.FIX_MODE ?? 'start';
const RUNS = Number(env.FIX_RUNS ?? 1);
const TAG = env.FIX_TAG ?? 'run';
const OUT = env.FIX_OUT ?? join(process.cwd(), 'fix-evidence');
const [VW, VH] = (env.FIX_VIEWPORT ?? '1280x720').split('x').map(Number);
const OPEN_MS = Number(env.FIX_OPEN_MS ?? 150_000);
const DEADLINE_S = Number(env.FIX_DEADLINE_S ?? 540);

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Helpers every profile gets. All input goes through the real page keyboard and mouse. */
function helpers(page, record, profile, t0) {
  const stamp = () => Number(((Date.now() - t0) / 1000).toFixed(1));
  const ctx = {
    page, record, env, mode: MODE, out: OUT, stamp, sleep,
    /** Game state snapshot through the profile's reader (a page.evaluate function). */
    state: () => page.evaluate(profile.readState).catch(() => null),
    /** Send a debug/game command the page exposes (profile.sendCommand runs in the page). */
    send: (cmd) => (profile.sendCommand ? page.evaluate(profile.sendCommand, cmd) : Promise.resolve()),
    tap: async (key, ms = 70) => { await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key); },
    hold: async (keys, ms) => { for (const k of keys) await page.keyboard.down(k); await sleep(ms); for (const k of keys) await page.keyboard.up(k); },
    /** A person holds the mouse button ~100–120 ms; instantaneous clicks hide redraw races. */
    click: (x, y, delay = 120) => page.mouse.click(x, y, { delay }),
    shot: async (name, settle = 0) => {
      if (settle) await sleep(settle);
      const file = join(OUT, `${record.tag}-${name}.png`);
      try { await page.screenshot({ path: file }); record.shots.push(name); } catch (error) { record.notes.push(`shot ${name}: ${error}`); }
    },
    /** Error page text if the engine replaced the game with its failure page. */
    failure: () => page.evaluate((pattern) => {
      const text = document.body?.innerText ?? '';
      return new RegExp(pattern).test(text) ? text : null;
    }, profile.failurePattern ?? 'AppError|app-system-update-failed|Unable to start the game').catch(() => null),
    /** Wait until test(state) holds; profile.answer(ctx, state) may press keys meanwhile (dialogue etc.). */
    until: async (test, ms, label, { answer = true } = {}) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const failed = await ctx.failure();
        if (failed) { record.failed = { t: stamp(), label, text: failed }; throw new Error(`error page while waiting for ${label}`); }
        const s = await ctx.state();
        if (s && test(s)) return s;
        if (answer && s && profile.answer) await profile.answer(ctx, s);
        await sleep(120);
      }
      record.timeouts.push(label);
      throw new Error(`timed out waiting for ${label}: ${JSON.stringify(await ctx.state())}`);
    },
    /** What is really on top of each element's centre (finds blocking layers and redraw races). */
    hitProbe: (selector) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2; const y = r.top + r.height / 2;
      const describe = (n) => {
        if (!n) return null;
        const s = getComputedStyle(n);
        return `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}${typeof n.className === 'string' && n.className ? `.${n.className.trim().split(/\s+/).join('.')}` : ''} [pe=${s.pointerEvents} z=${s.zIndex}]`;
      };
      const top = document.elementFromPoint(x, y);
      return { x: Math.round(x), y: Math.round(y), top: describe(top), hits: top === el || el.contains(top),
        stack: document.elementsFromPoint(x, y).slice(0, 6).map(describe) };
    }), selector),
    /**
     * Text-layer overlap check. Boxes of visible layers are intersected; inside each intersection 9 points are
     * sampled with elementFromPoint. If every sample's top element is inside one `modal` selector (a menu meant to
     * cover the HUD, e.g. the pause card), the pair is `covered` (fine). Otherwise it is an overlap — including a
     * HUD layer drawn on top of the modal (the "dialog over the pause card" bug).
     */
    overlaps: (selectors, { modal = [] } = {}) => page.evaluate(([sels, modals]) => {
      const boxes = sels.map((sel) => {
        const el = document.querySelector(sel);
        if (!el || !el.isConnected) return null;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null;
        if (!el.textContent?.trim() && !el.querySelector('img,button,canvas')) return null;
        const r = el.getBoundingClientRect();
        return r.width && r.height ? { sel, el, l: r.left, r: r.right, t: r.top, b: r.bottom } : null;
      }).filter(Boolean);
      const modalEls = modals.map((sel) => document.querySelector(sel)).filter(Boolean);
      const pairs = []; const covered = [];
      for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]; const b = boxes[j];
        const l = Math.max(a.l, b.l); const r = Math.min(a.r, b.r); const t = Math.max(a.t, b.t); const bt = Math.min(a.b, b.b);
        if (l >= r || t >= bt) continue;
        const owners = new Set();
        for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.2, 0.5, 0.8]) {
          const top = document.elementFromPoint(l + (r - l) * fx, t + (bt - t) * fy);
          const m = modalEls.find((el) => el.contains(top));
          owners.add(m ? `modal:${modals[modalEls.indexOf(m)]}` : a.el.contains(top) ? a.sel : b.el.contains(top) ? b.sel : 'other');
        }
        const label = `${a.sel} x ${b.sel}`;
        if (owners.size === 1 && [...owners][0].startsWith('modal:')) covered.push(`${label} (under ${[...owners][0].slice(6)})`);
        else pairs.push(label);
      }
      return { shown: boxes.map((b) => b.sel), pairs, covered };
    }, [selectors, modal]),
    /**
     * Walk to (tx, tz) with real WASD on a camera that is not axis-aligned: learn what each key does
     * on the ground first (paired presses so a wall cannot zero an axis), then steer.
     * profile.position(state) -> [x, z]; stop(state) ends the walk.
     */
    walkTo: async (tx, tz, stop, { keys = ['KeyW', 'KeyS', 'KeyD', 'KeyA'], stepMs = 220 } = {}) => {
      const pos = async () => { const s = await ctx.state(); return [s, ...profile.position(s)]; };
      const step = async (key) => { const [, x0, z0] = await pos(); await ctx.hold([key], 260); await sleep(60); const [, x1, z1] = await pos(); return [x1 - x0, z1 - z0]; };
      const axis = async (plus, minus) => { const p = await step(plus); const m = await step(minus); return [(p[0] - m[0]) / 2, (p[1] - m[1]) / 2]; };
      const w = await axis(keys[0], keys[1]);
      const d = await axis(keys[2], keys[3]);
      record.notes.push({ walkBasis: { w, d } });
      for (let i = 0; i < 120; i += 1) {
        const [s, x, z] = await pos();
        if (stop(s)) return true;
        const vx = tx - x; const vz = tz - z;
        if (Math.hypot(vx, vz) < 0.6) { await sleep(120); continue; }
        const a = vx * w[0] + vz * w[1]; const b = vx * d[0] + vz * d[1];
        const scale = Math.max(Math.abs(a), Math.abs(b)) || 1;
        const press = [];
        if (Math.abs(a) > 0.25 * scale) press.push(a > 0 ? keys[0] : keys[1]);
        if (Math.abs(b) > 0.25 * scale) press.push(b > 0 ? keys[2] : keys[3]);
        await ctx.hold(press, stepMs);
      }
      return false;
    },
  };
  return ctx;
}

async function one(browser, profile, index) {
  const tag = `${TAG}-${MODE}-${index + 1}`;
  const record = { tag, url: URL, mode: MODE, started: new Date().toISOString(), events: [], shots: [], notes: [], timeouts: [],
    pageErrors: [], consoleErrors: [], warnings: [], network: [], workerConsole: [], failed: null, result: null };
  const context = await browser.newContext({ viewport: { width: VW, height: VH } });
  const page = await context.newPage();
  page.on('pageerror', (error) => record.pageErrors.push(String(error?.stack ?? error)));
  page.on('console', (m) => {
    // A static server's missing favicon is not a game error.
    if (m.type() === 'error' && !/favicon\.ico/.test(m.location()?.url ?? '')) record.consoleErrors.push(m.text().slice(0, 600));
    if (profile.warningPattern && new RegExp(profile.warningPattern).test(m.text())) record.warnings.push(m.text().slice(0, 400));
  });
  page.on('requestfailed', (r) => record.network.push({ failed: r.url(), why: r.failure()?.errorText }));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) record.network.push({ status: r.status(), url: r.url() });
    // Dev-only file routes answered by the preview's HTML fallback (the /@fs pitfall).
    if (r.url().includes('/@fs/')) record.network.push({ devOnlyRoute: r.url(), type: r.headers()['content-type'] });
  });
  if (env.FIX_TRACE === '1') page.on('worker', (worker) => {
    worker.on?.('console', (m) => { if (m.text().includes('[FIX]')) record.workerConsole.push(m.text().slice(0, 20000)); });
    worker.evaluate(installPublicationTrace).catch(() => undefined);
  });
  const t0 = Date.now();
  const ctx = helpers(page, record, profile, t0);
  try {
    await page.goto(URL, { waitUntil: 'load' });
    const opened = await page.waitForFunction(() => {
      if (document.documentElement.dataset.forgeaxInput === 'open') return 'open';
      return /Unable to start the game/.test(document.body?.innerText ?? '') ? 'failed' : false;
    }, null, { timeout: OPEN_MS, polling: 250 });
    record.open = { result: await opened.jsonValue(), t: ctx.stamp() };
    if (record.open.result !== 'open') {
      record.failed = { t: ctx.stamp(), label: 'startup', text: await ctx.failure() };
      await ctx.shot('startup-failed');
      throw new Error(`page did not start (${record.open.t}s)`);
    }
    const run = profile.modes[MODE];
    if (!run) throw new Error(`profile has no mode "${MODE}" (has: ${Object.keys(profile.modes).join(', ')})`);
    record.result = await Promise.race([
      run(ctx),
      sleep(DEADLINE_S * 1000).then(() => { throw new Error(`run deadline ${DEADLINE_S}s`); }),
    ]);
  } catch (error) {
    record.error = String(error?.message ?? error).slice(0, 3000);
    if (!record.failed) {
      const text = await ctx.failure();
      if (text) record.failed = { t: ctx.stamp(), label: 'during run', text };
    }
    await ctx.shot('failure');
  } finally {
    record.seconds = ctx.stamp();
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${tag}.json`), JSON.stringify(record, null, 2));
    await context.close();
  }
  return record;
}

/** Default export: the play-module shape (`project play` passes `play`; fast-run.mjs passes { page }). */
export default async function driver(play) {
  if (!URL || !env.FIX_PROFILE) throw new Error('driver: FIX_URL and FIX_PROFILE are required');
  const profile = (await import(pathToFileURL(env.FIX_PROFILE).href)).default;
  const browser = play.page.context().browser();
  if (!browser) throw new Error('driver: the play page has no browser to open a fresh context in');
  mkdirSync(OUT, { recursive: true });
  const records = [];
  for (let i = 0; i < RUNS; i += 1) records.push(await one(browser, profile, i));
  await play.page.bringToFront?.().catch(() => undefined);
  const summary = records.map((r) => ({ tag: r.tag, ok: !r.error && !r.failed && r.pageErrors.length === 0 && r.consoleErrors.length === 0,
    open: r.open?.t, seconds: r.seconds, failed: r.failed ? String(r.failed.text ?? '').split('\n').slice(0, 2).join(' | ').slice(0, 200) : null,
    error: r.error ?? null, pageErrors: r.pageErrors.length, consoleErrors: r.consoleErrors.length,
    devOnlyRoutes: r.network.filter((n) => n.devOnlyRoute).length, dupRows: r.workerConsole.filter((w) => w.includes('dup-row')).length,
    result: r.result }));
  console.log(JSON.stringify(summary));
  if (summary.some((s) => !s.ok)) throw new Error(`driver: ${JSON.stringify(summary).slice(0, 1500)}`);
  return summary.map((s) => ({ tag: s.tag, seconds: s.seconds }));
}
