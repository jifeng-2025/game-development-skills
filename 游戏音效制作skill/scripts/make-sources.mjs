#!/usr/bin/env node
/**
 * Generate <audio>/SOURCES.md from synth.mjs manifest + a trigger map (and optional CC0 overrides).
 *   node make-sources.mjs <audio-dir> <triggers.json> [--license "Apache-2.0"] [--cc0 cc0.json]
 * triggers.json: { "<sound name>": "<event that plays it>" }
 * cc0.json (replacements): { "<file.wav>": { "source": "Kenney Impact Sounds / impactMetal_002.ogg", "license": "CC0 1.0", "url": "https://kenney.nl/assets/impact-sounds" } }
 */
import fs from 'node:fs';
import path from 'node:path';
const [dir, trigFile] = process.argv.slice(2);
if (!dir || !trigFile) { console.error('usage: node make-sources.mjs <audio-dir> <triggers.json> [--license X] [--cc0 cc0.json]'); process.exit(2); }
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const rows = JSON.parse(fs.readFileSync(path.join(dir, 'tools/manifest.json'), 'utf8'));
const trig = JSON.parse(fs.readFileSync(trigFile, 'utf8'));
const cc0 = arg('--cc0') ? JSON.parse(fs.readFileSync(arg('--cc0'), 'utf8')) : {};
const lic = arg('--license', 'project-owned original');
const missing = rows.filter((r) => !trig[r.name]).map((r) => r.name);
if (missing.length) { console.error(`no trigger for: ${[...new Set(missing)].join(', ')}`); process.exit(1); }
let out = `# 音效来源与许可\n\n- 程序合成文件由 \`tools/synth.mjs\` 离线生成（固定种子，可逐字节复现），无第三方素材，许可：${lic}。\n- CC0 替换文件逐条注明包名 / 原文件 / 链接；非 CC0 素材禁止入库。\n- 重新生成：\`node synth.mjs --audio <audio-dir> --ns <uuid> --key-prefix <prefix>\`，然后重跑本脚本。\n\n| 文件 | 音 | 时长 s | 峰值 dBFS | 触发事件 | 生成参数 / 描述 | sha256[:12] | 来源 / 许可 |\n|---|---|---|---|---|---|---|---|\n`;
for (const r of rows) {
  const c = cc0[r.file];
  out += `| \`sfx/${r.file}\` | ${r.name} | ${r.seconds} | ${r.peak} | ${trig[r.name]} | ${c ? '替换素材' : r.desc} | ${r.sha} | ${c ? `${c.source}（${c.license}，${c.url}）` : `程序合成 / ${lic}`} |\n`;
}
fs.writeFileSync(path.join(dir, 'SOURCES.md'), out);
console.log(JSON.stringify({ ok: true, files: rows.length, cc0: Object.keys(cc0).length }));
