#!/usr/bin/env node
/**
 * Loudness / brightness check for PCM16 mono or stereo WAVs (no numpy needed).
 *   node wav-stats.mjs <sfx-dir> [--json]
 * Prints per file: seconds, peak dBFS, RMS dBFS, zero-crossing "brightness" (Hz). Flags:
 *   PEAK>-0.5 (clipping risk), SILENT (rms < -45), LONG (> 1.5 s for a one-shot).
 */
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
if (!dir) { console.error('usage: node wav-stats.mjs <sfx-dir> [--json]'); process.exit(2); }
const rows = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.wav')).sort()) {
  const b = fs.readFileSync(path.join(dir, f));
  let off = 12, fmt, data;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), len = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    if (id === 'data') { data = b.subarray(off + 8, off + 8 + len); break; }
    off += 8 + len + (len & 1);
  }
  if (!fmt || !data || fmt.bits !== 16) { rows.push({ file: f, error: 'not PCM16 WAV' }); continue; }
  const n = data.length / 2; let pk = 0, ss = 0, zc = 0, prev = 0;
  for (let i = 0; i < n; i += fmt.ch) { const v = data.readInt16LE(i * 2) / 32768; pk = Math.max(pk, Math.abs(v)); ss += v * v; if ((v >= 0) !== (prev >= 0)) zc++; prev = v; }
  const frames = n / fmt.ch, sec = frames / fmt.sr, rms = 10 * Math.log10(ss / frames + 1e-12), peak = 20 * Math.log10(pk + 1e-12);
  const flags = [peak > -0.5 && 'PEAK>-0.5', rms < -45 && 'SILENT', sec > 1.5 && 'LONG'].filter(Boolean);
  rows.push({ file: f, seconds: +sec.toFixed(3), peak: +peak.toFixed(1), rms: +rms.toFixed(1), zcrHz: Math.round(zc / 2 / sec), sr: fmt.sr, ch: fmt.ch, flags });
}
if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
else for (const r of rows) console.log(r.error ? `${r.file} ${r.error}` : `${r.file.padEnd(26)} ${r.seconds.toFixed(2)}s peak ${r.peak} rms ${r.rms} zcr~${r.zcrHz}Hz ${r.flags.join(' ')}`);
