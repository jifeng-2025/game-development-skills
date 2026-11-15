/**
 * Locate upng-js without adding a dependency: the ForgeaX SDK already installs it under the game's
 * node_modules (pnpm layout). Order: <game>/node_modules/.pnpm/upng-js@* → <game>/node_modules/upng-js → require('upng-js').
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export function loadUpng(gameRoot) {
  const require = createRequire(import.meta.url);
  const candidates = [];
  if (gameRoot) {
    const pnpm = path.join(gameRoot, 'node_modules/.pnpm');
    if (fs.existsSync(pnpm)) {
      const hit = fs.readdirSync(pnpm).find((n) => n.startsWith('upng-js@'));
      if (hit) candidates.push(path.join(pnpm, hit, 'node_modules/upng-js'));
    }
    candidates.push(path.join(gameRoot, 'node_modules/upng-js'));
  }
  for (const c of candidates) if (fs.existsSync(c)) return require(c);
  try { return require('upng-js'); } catch {
    throw new Error(`upng-js not found (looked in ${candidates.join(', ') || '(no --game)'}); pass --game <ForgeaX project root>`);
  }
}

export function readPng(UPNG, file) {
  const b = fs.readFileSync(file);
  const d = UPNG.decode(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  return { w: d.width, h: d.height, p: new Uint8Array(UPNG.toRGBA8(d)[0]), bytes: b };
}

/** Tiny argv parser: --key value / --flag. */
export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const n = argv[i + 1]; if (n === undefined || n.startsWith('--')) out[k] = true; else { out[k] = n; i++; } }
    else out._.push(a);
  }
  return out;
}
