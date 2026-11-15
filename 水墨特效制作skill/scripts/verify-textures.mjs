#!/usr/bin/env node
/**
 * Check every texture in <dir>/manifest.json: border alpha = 0, min alpha = 0, something visible
 * (noise keys: fully opaque). Exit 1 on any failure.
 *   node verify-textures.mjs --game <project root> --dir <texture dir> [--noise noise,other] [--out report.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { args, loadUpng, readPng } from './lib-upng.mjs';

const a = args();
if (!a.dir) { console.error('usage: verify-textures.mjs --game <root> --dir <texture dir> [--noise k1,k2] [--out file]'); process.exit(2); }
const UPNG = loadUpng(a.game && path.resolve(a.game));
const dir = path.resolve(a.dir);
const noise = new Set(String(a.noise ?? 'noise').split(','));
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const results = [];
for (const entry of manifest) {
  const { w, h, p } = readPng(UPNG, path.join(dir, entry.file));
  let borderMax = 0, min = 255, max = 0, visible = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const al = p[(y * w + x) * 4 + 3]; min = Math.min(min, al); max = Math.max(max, al); if (al > 0) visible++;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) borderMax = Math.max(borderMax, al);
  }
  const ok = noise.has(entry.key) ? min === 255 : borderMax === 0 && min === 0 && max > 0 && visible > 0;
  results.push({ key: entry.key, width: w, height: h, minAlpha: min, maxAlpha: max, borderMax, visible, ok });
}
const result = { textures: results.length, ok: results.every((r) => r.ok), failed: results.filter((r) => !r.ok).map((r) => r.key) };
if (a.out) fs.writeFileSync(a.out, JSON.stringify({ ...result, results }, null, 2) + '\n');
console.log(JSON.stringify(result));
if (!result.ok) process.exitCode = 1;
