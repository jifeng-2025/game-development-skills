# <TASK-ID> 音效 — 执行报告

- 状态：review / blocked（写清原因）
- 输入：设计表 <路径>（主控确认时间与结论）、引擎版本、基线提交号

## 1. 改动路径
新增：`assets/audio/sfx/*.wav`（N 个）+ `*.wav.meta.json`、`SOURCES.md`、`tools/synth.mjs`、`tools/manifest.json`、`clips.ts`、`cues.ts`、`audio.pack.ts`（plugin/audio GUID <guid>）、`volume.ts`、`__tests__/cues.test.ts`、`tools/play-audio.mjs`
注册：
| 文件 | 行 | 内容 | 现状 |
|---|---|---|---|
| <engine 父插件> | <行号> | `{ $asset: '<guid>' }, // <TASK> plugin/audio` | 在 / 被还原（时间、谁） |
| <frontend 根插件> | <行号> | `yield (await import('../audio/volume.ts')).startAudioVolume(ctx.gameHost);` | 在 |
加注册前的 `git status`：<目标文件是否有他人未提交改动>

## 2. 清单逐项
| # | 音 | 文件（变体） | 触发 | 实机触发次数 |
|---|---|---|---|---|
未触发项单列原因（资源没攒满 / 开了无敌 / 没到 Boss），并注明「仅单测」。

## 3. 实机
- 命令、结果（passed / 失败 code）、console/page 错误数
- 片段加载 loaded/failed；Host contextState、lastError、master；滑杆 volumeProbe（before/after）；Host 活跃声源峰值；音频事件计数 vs VFX 事件计数是否一致
- 未能录到声音的说明 + 试听合集路径

## 4. 检查
`project check --json` / `pnpm typecheck` / `pnpm test`（文件数 / 用例数）

## 5. 限制与下一步
