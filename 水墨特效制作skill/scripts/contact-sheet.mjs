#!/usr/bin/env node
/**
 * Half-size 2-column contact sheet of PNG screenshots (one image read instead of 4–6; saves the agent's
 * per-run image budget). White 3 px separators.
 *   node contact-sheet.mjs --game <project root> out.png a.png b.png c.png d.png
 * JPG inputs: convert first on macOS: sips -s format png in.jpg --out in.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { args, loadUpng, readPng } from './lib-upng.mjs';

const a = args();
const [out, ...files] = a._;
if (!out || files.length === 0) { console.error('usage: contact-sheet.mjs --game <root> out.png in1.png [in2.png ...]'); process.exit(2); }
const UPNG = loadUpng(a.game && path.resolve(a.game));
const imgs = files.map((f) => readPng(UPNG, f));
const cw = Math.floor(imgs[0].w / 2), ch = Math.floor(imgs[0].h / 2), W = cw * 2, H = ch * Math.ceil(imgs.length / 2);
const o = new Uint8Array(W * H * 4);
imgs.forEach((im, k) => {
  const ox = (k % 2) * cw, oy = Math.floor(k / 2) * ch;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const sx = Math.min(im.w - 2, x * 2), sy = Math.min(im.h - 2, y * 2), s = (sy * im.w + sx) * 4, d = ((oy + y) * W + ox + x) * 4;
    for (let c = 0; c < 4; c++) o[d + c] = (im.p[s + c] + im.p[s + 4 + c] + im.p[s + im.w * 4 + c] + im.p[s + im.w * 4 + 4 + c]) >> 2;
    if (x < 3 || y < 3) o[d] = o[d + 1] = o[d + 2] = 255;
  }
});
fs.writeFileSync(out, Buffer.from(UPNG.encode([o.buffer], W, H, 0)));
console.log(JSON.stringify({ out, cells: imgs.length, width: W, height: H }));
