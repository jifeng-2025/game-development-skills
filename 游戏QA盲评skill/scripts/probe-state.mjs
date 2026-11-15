/**
 * Discover what a built game page exposes, WITHOUT reading its source: lists `__*` globals, dumps the
 * state snapshot on the title screen, after one confirm key, and after advancing until the state stops
 * being a dialogue phase; also dumps the visible UI text. Use the output to fill a qa-run profile.
 *
 *   QA_URL=http://localhost:4841/ QA_STATE=__inkView QA_OUT=/tmp/qa-probe.json QA_CONFIRM=Enter \
 *   pnpm exec forgeax project play /abs/probe-state.mjs --port <free> --json --progress false
 * QA_STATE empty -> only the global list is reported (pick the snapshot-looking one, rerun).
 */
import { writeFileSync } from 'node:fs';

const URL = process.env.QA_URL ?? 'http://localhost:4841/';
const STATE = process.env.QA_STATE ?? '';
const OUT = process.env.QA_OUT ?? '/tmp/qa-probe.json';
const CONFIRM = process.env.QA_CONFIRM ?? 'Enter';
const UI = process.env.QA_UI_ROOT ?? 'body';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function probe(play) {
  const browser = play.page.context().browser();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const out = { url: URL, errors: [] };
  page.on('pageerror', (e) => out.errors.push(String(e).slice(0, 300)));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.forgeaxInput === 'open', null, { timeout: 180000 });
  await sleep(2500);
  out.globals = await page.evaluate(() => Object.keys(globalThis).filter((k) => k.startsWith('__')).map((k) => [k, typeof globalThis[k]]));
  const dump = () => page.evaluate((g) => { const v = globalThis[g]; if (!v) return null; return JSON.parse(JSON.stringify(v, (k, x) => (Array.isArray(x) && x.length > 8 ? x.slice(0, 8) : typeof x === 'function' ? 'fn' : x))); }, STATE);
  const text = () => page.evaluate((sel) => (document.querySelector(sel)?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 600), UI);
  if (STATE) {
    out.title = { state: await dump(), text: await text() };
    await page.keyboard.press(CONFIRM); await sleep(1500);
    out.afterConfirm = { state: await dump(), text: await text() };
    // Keep pressing until the first field that looks like a phase changes (dialogue -> next screen), max ~24 s.
    const phaseKey = process.env.QA_PHASE_KEY ?? 'phase';
    const startPhase = out.afterConfirm.state?.[phaseKey];
    for (let i = 0; i < 40; i += 1) { await page.keyboard.press(CONFIRM); await sleep(600); if ((await dump())?.[phaseKey] !== startPhase) break; }
    await sleep(800);
    out.later = { state: await dump(), text: await text() };
  }
  await page.screenshot({ path: OUT.replace(/\.json$/, '.png') });
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  await ctx.close();
  return { ok: true, out: OUT };
}
