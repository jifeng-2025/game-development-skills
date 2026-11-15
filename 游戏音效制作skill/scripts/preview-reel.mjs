#!/usr/bin/env node
/**
 * Concatenate every clip into one listening reel for the producer (+ a timeline .txt).
 *   node preview-reel.mjs <sfx-dir> <out.wav> [--gap 0.4] [--order manifest.json]
 * All inputs must share sample rate / channels (synth.mjs output does). Order defaults to file name;
 * pass --order <manifest.json> (from synth.mjs) to follow the design-table order.
 */
import fs from 'node:fs';
import path from 'node:path';
const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('usage: node preview-reel.mjs <sfx-dir> <out.wav> [--gap 0.4] [--order manifest.json]'); process.exit(2); }
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const gapSec = Number(arg('--gap', '0.4'));
const order = arg('--order') ? JSON.parse(fs.readFileSync(arg('--order'), 'utf8')).map((r) => r.file) : fs.readdirSync(dir).filter((f) => f.endsWith('.wav')).sort();
const chunk = (b, want) => { let o = 12; while (o + 8 <= b.length) { const id = b.toString('ascii', o, o + 4), len = b.readUInt32LE(o + 4); if (id === want) return b.subarray(o + 8, o + 8 + len); o += 8 + len + (len & 1); } throw new Error(`no ${want}`); };
let fmt; const parts = [], lines = []; let t = 0;
for (const f of order) {
  const b = fs.readFileSync(path.join(dir, f)); const fm = chunk(b, 'fmt '); fmt ??= fm;
  if (!fm.equals(fmt)) throw new Error(`${f}: format differs from first clip`);
  const d = chunk(b, 'data'); const bps = fmt.readUInt32LE(8);
  lines.push(`${t.toFixed(2)}s  ${f}`); parts.push(d, Buffer.alloc(Math.round(bps * gapSec / fmt.readUInt16LE(12)) * fmt.readUInt16LE(12)));
  t += d.length / bps + gapSec;
}
const data = Buffer.concat(parts); const h = Buffer.alloc(12 + 8 + fmt.length + 8);
h.write('RIFF', 0); h.writeUInt32LE(h.length - 8 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(fmt.length, 16); fmt.copy(h, 20);
h.write('data', 20 + fmt.length); h.writeUInt32LE(data.length, 24 + fmt.length);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([h, data])); fs.writeFileSync(out.replace(/\.wav$/, '.txt'), lines.join('\n') + '\n');
console.log(JSON.stringify({ ok: true, out, clips: order.length, seconds: +t.toFixed(1) }));
