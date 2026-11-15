#!/usr/bin/env node
/**
 * White-ink-on-black concept PNGs → ForgeaX VFX textures (straight alpha) + .meta.json + manifest + textures.ts.
 *
 *   node prepare-textures.mjs --config textures.config.json
 *
 * Config (see templates/textures.config.example.json):
 *   game          ForgeaX project root (for upng-js)
 *   source        concepts dir; input file = <source>/<asset>/<asset>__<view>__v<version>.png
 *   output        texture dir inside the game (e.g. <game>/assets/art/vfx)
 *   tsOut         generated TS map { key: guid } + TextureKey type
 *   guidNamespace stable GUID seed prefix (change per project, never per run)
 *   entries       [[key, asset, view, version, grid], ...]  grid N splits an N×N sheet into key-00..key-NN
 *   noiseKeys     keys kept as opaque grayscale (dissolve noise), addressMode repeat
 *   thicken       { key: ratio }  close dry-brush gaps, then dilate until solid area = closed area × ratio,
 *                 and bake "rim permission" into RGB (0 = gap enclosed by the stroke silhouette → no outline)
 *   pad (4) closeRadius (6) hullRadius (30) edgeTaper (3)
 *
 * Output per texture: RGB = 255 (or rim permission for thickened ones), A = Rec.709 luminance × source alpha,
 * 4 px fully transparent pad + 3 px edge taper (so no rectangle edge can ever show), mipmaps on.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { args, loadUpng } from './lib-upng.mjs';

const a = args();
if (!a.config) { console.error('usage: prepare-textures.mjs --config <file.json>'); process.exit(2); }
const configPath = path.resolve(a.config);
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const rel = (p) => path.resolve(path.dirname(configPath), p);
const game = rel(cfg.game), source = rel(cfg.source), output = rel(cfg.output), tsOut = cfg.tsOut ? rel(cfg.tsOut) : null;
const PAD = cfg.pad ?? 4, CLOSE = cfg.closeRadius ?? 6, HULL = cfg.hullRadius ?? 30, TAPER = cfg.edgeTaper ?? 3;
const NOISE = new Set(cfg.noiseKeys ?? ['noise']);
const THICKEN = cfg.thicken ?? {};
const UPNG = loadUpng(game);

function morph(alpha, w, h, r, op) {
  const pick = op === 'max' ? Math.max : Math.min;
  const tmp = new Float32Array(alpha.length), out = new Float32Array(alpha.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = alpha[y * w + x];
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) v = pick(v, alpha[y * w + k]);
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = tmp[y * w + x];
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) v = pick(v, tmp[k * w + x]);
    out[y * w + x] = v;
  }
  return out;
}
const solidArea = (arr) => { let n = 0; for (const v of arr) if (v >= 128) n++; return n; };
function thicken(rgba, w, h, ratio, pad) {
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = rgba[i * 4 + 3];
  const closed = morph(morph(alpha, w, h, CLOSE, 'max'), w, h, CLOSE, 'min');
  const base = solidArea(closed);
  let d = 0, grown = closed;
  while (d < 40 && solidArea(grown) < base * ratio) grown = morph(closed, w, h, ++d, 'max');
  const hull = morph(morph(grown, w, h, HULL, 'max'), w, h, HULL, 'min');
  let gaps = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const taper = Math.max(0, Math.min(1, (x - pad) / TAPER, (y - pad) / TAPER, (w - 1 - pad - x) / TAPER, (h - 1 - pad - y) / TAPER));
    const enclosed = hull[i] >= 128 && grown[i] < 128;
    if (enclosed) gaps++;
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = enclosed ? 0 : 255;
    rgba[i * 4 + 3] = Math.round(grown[i] * taper);
  }
  return { closeRadius: CLOSE, dilate: d, hullRadius: HULL, rawSolid: solidArea(alpha), closedSolid: base, finalSolid: solidArea(grown), enclosedGapPx: gaps };
}
function guid(key) {
  const b = createHash('sha256').update((cfg.guidNamespace ?? 'game/vfx/texture/') + key).digest().subarray(0, 16);
  b[6] = (b[6] & 15) | 0x50; b[8] = (b[8] & 63) | 0x80;
  const h = b.toString('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const manifest = [];
fs.mkdirSync(output, { recursive: true });
for (const [key, asset, view, version, grid] of cfg.entries) {
  const input = path.join(source, asset, `${asset}__${view}__v${version}.png`);
  const bytes = fs.readFileSync(input);
  const decoded = UPNG.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const pixels = new Uint8Array(UPNG.toRGBA8(decoded)[0]);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const noise = NOISE.has(key);
  // Uneven source grids: rounded cell boundaries, no frame lost or stretched.
  for (let cell = 0; cell < grid * grid; cell++) {
    const x0 = Math.round((cell % grid) * decoded.width / grid);
    const y0 = Math.round(Math.floor(cell / grid) * decoded.height / grid);
    const cw = Math.round((cell % grid + 1) * decoded.width / grid) - x0;
    const ch = Math.round((Math.floor(cell / grid) + 1) * decoded.height / grid) - y0;
    const pad = noise ? 0 : PAD;
    const w = Math.ceil(decoded.width / grid) + pad * 2, h = Math.ceil(decoded.height / grid) + pad * 2;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = ((y + y0) * decoded.width + x + x0) * 4, j = ((y + pad) * w + x + pad) * 4;
      const lum = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) * pixels[i + 3] / 255;
      const border = noise ? 1 : Math.min(1, x / TAPER, y / TAPER, (cw - 1 - x) / TAPER, (ch - 1 - y) / TAPER);
      // Straight alpha: RGB stays white; the material multiplies exactly once.
      rgba[j] = rgba[j + 1] = rgba[j + 2] = noise ? Math.round(lum) : 255;
      rgba[j + 3] = noise ? 255 : Math.round(lum * border);
    }
    const name = grid === 1 ? key : `${key}-${String(cell).padStart(2, '0')}`;
    const thick = THICKEN[name] ? thicken(rgba, w, h, THICKEN[name], pad) : undefined;
    if (thick) console.log(JSON.stringify({ thicken: name, ...thick }));
    const filename = `${name}.png`;
    fs.writeFileSync(path.join(output, filename), Buffer.from(UPNG.encode([rgba.buffer], w, h, 0)));
    const id = guid(name);
    fs.writeFileSync(path.join(output, filename + '.meta.json'), JSON.stringify({
      schemaVersion: '1.0.0', kind: 'external-asset-package', importer: 'image', source: filename,
      importSettings: { colorSpace: 'linear', mipmap: true, addressMode: noise ? 'repeat' : 'clamp-to-edge', filterMode: 'linear' },
      subAssets: [{ guid: id, sourceIndex: 0, kind: 'texture', sourceKey: 'image:texture' }],
    }, null, 2) + '\n');
    manifest.push({ key: name, file: filename, guid: id, width: w, height: h, grid, cell,
      provenance: { source: input, sha256: hash, model: cfg.model ?? 'imagegen',
        operation: `Rec.709 encoded luminance to straight alpha; split grid; ${PAD}px transparent pad; ${TAPER}px edge taper; noise preserves grayscale`
          + (thick ? `; thicken: close r${thick.closeRadius} + dilate r${thick.dilate} (solid ${thick.closedSolid}→${thick.finalSolid}px)` : '') },
      alpha: { min: Math.min(...Array.from(rgba.filter((_, i) => i % 4 === 3)).slice(0, 10000)), border: pad ? 'zero' : 'opaque-noise' } });
  }
}
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
if (tsOut) fs.writeFileSync(tsOut, '// Generated by prepare-textures.mjs; GUIDs are stable.\nexport const VFX_TEXTURES = '
  + JSON.stringify(Object.fromEntries(manifest.map((x) => [x.key, x.guid])), null, 2) + ' as const;\nexport type TextureKey = keyof typeof VFX_TEXTURES;\n');
console.log(JSON.stringify({ textures: manifest.length, output, tsOut }));
