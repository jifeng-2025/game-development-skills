#!/usr/bin/env node
/**
 * CLI over the shared dev owner for live evidence in the page realm (dev owner started with engine workers OFF).
 * Never starts/stops the owner.
 *   DRIVER=<abs path to live-driver.ts> GAME=<project root> node live.mjs eval '<code; D = driver module, simulation available>'
 *   ... node live.mjs video <out.webm>     # download the last D.recStart()/recStop() recording in slices
 *   ... node live.mjs snaps <out dir>      # download frames grabbed in-page with D.snap()/D.snapOn()
 * Return plain JSON from eval (no undefined inside arrays/objects that could be engine handles).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const game = path.resolve(process.env.GAME ?? process.cwd());
const driver = process.env.DRIVER;
if (!driver) { console.error('set DRIVER=<abs path to live-driver.ts>'); process.exit(2); }
const cli = (args) => JSON.parse(execFileSync('pnpm', ['exec', 'forgeax', ...args, '--json'], { cwd: game, encoding: 'utf8', maxBuffer: 64 << 20 }));
const ready = () => { for (let i = 0; i < 120; i++) { const v = cli(['dev', 'status']).value; if (v.phase === 'ready') return v.revision; execFileSync('sleep', ['5']); } throw new Error('dev owner not ready'); };
const evaluate = (code, timeoutMs = 600000) => {
  const r = cli(['dev', 'eval', '--revision', ready(), '--timeoutMs', String(timeoutMs), '--code', `const D=await import('/@fs${driver}');\n${code}`]);
  if (!r.ok) throw new Error(JSON.stringify(r.error).slice(0, 600));
  return r.value.result;
};
const [cmd, arg] = process.argv.slice(2);
if (cmd === 'eval') console.log(JSON.stringify(evaluate(arg)));
else if (cmd === 'video') {
  const parts = [];
  for (let i = 0; ; i++) { const s = evaluate(`return D.recSlice(${i});`); parts.push(Buffer.from(s.b64, 'base64')); if (s.last) break; }
  fs.writeFileSync(arg, Buffer.concat(parts)); console.log(JSON.stringify({ file: arg, bytes: fs.statSync(arg).size }));
} else if (cmd === 'snaps') {
  fs.mkdirSync(arg, { recursive: true });
  for (const name of evaluate('return D.snapNames();')) { const b64 = evaluate(`return await D.snapGet(${JSON.stringify(name)});`); fs.writeFileSync(path.join(arg, `${name}.jpg`), Buffer.from(b64, 'base64')); console.log(name); }
} else { console.error('usage: live.mjs eval|video|snaps'); process.exit(2); }
