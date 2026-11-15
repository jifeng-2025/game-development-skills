/**
 * Fast loop runner: start your own headed system Chrome (seconds) and run a play-module
 * (default export receiving { page }) — e.g. scripts/driver.mjs — without `project play`'s
 * 3–6 minute temporary runtime. Use for bisection and screenshots; use `project play` for the gate.
 *
 *   FIX_GAME_DIR=/abs/game node fast-run.mjs /abs/scripts/driver.mjs
 *
 * Env: FIX_GAME_DIR (game dir with node_modules; playwright-core is resolved from its pnpm store),
 *      FIX_CHROME_CHANNEL (default "chrome"; Playwright's bundled browser is often missing or a different build),
 *      FIX_HEADLESS=1 (WebGPU in headless Chrome is unreliable on macOS; default headed).
 * Must run outside the agent sandbox (GPU browser).
 */
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const game = process.env.FIX_GAME_DIR ?? process.cwd();
const store = join(game, 'node_modules/.pnpm');
const pkg = existsSync(store) ? readdirSync(store).filter((d) => d.startsWith('playwright-core@')).sort().pop() : undefined;
const require = createRequire(join(game, 'package.json'));
const pw = pkg ? require(join(store, pkg, 'node_modules/playwright-core')) : require('playwright-core');
const target = process.argv[2];
if (!target) { console.error('usage: node fast-run.mjs <play-module.mjs>'); process.exit(2); }
const { default: run } = await import(pathToFileURL(target).href);
const browser = await pw.chromium.launch({
  headless: process.env.FIX_HEADLESS === '1',
  channel: process.env.FIX_CHROME_CHANNEL ?? 'chrome',
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext()).newPage();
let code = 0;
try { console.log('PASS', JSON.stringify(await run({ page }))); }
catch (error) { console.log('FAIL', String(error?.message ?? error).slice(0, 3000)); code = 1; }
// browser.close() can hang for minutes after Worker evaluate hooks (FIX_TRACE); never let it hold the shell.
await Promise.race([browser.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 10_000))]);
process.exit(code);
