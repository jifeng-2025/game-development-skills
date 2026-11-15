---
name: game-sfx-pipeline
description: 给 ForgeaX 网页游戏做一套基础音效并接进游戏：先出设计表请主控确认，再用固定种子程序合成（必要时换 CC0 素材），按档统一响度并设冷却，写 engine 子插件订阅战斗/UI 事件、spawn AudioSource 播放，用 frontend 小插件同步主音量，最后用 project play 统计每个音的实机触发次数。触发词：音效、音频、SFX、打击音、挥砍声、UI 音、试听合集、音效设计表、接音频、主音量、Kenney、CC0 音效、AudioSource。
---

# 游戏音效流水线（设计表 → 合成 → 接入 → 实机统计）

## 适用场景 / 不适用
适用：
- 用 ForgeaX（`@forgeax/engine`）做的游戏，需要一批 0.05–1.5 s 的一次性音效：攻击、命中、技能、敌人、受击、UI、转场、机关。
- 当天就要能跑的基础版。允许程序合成，以后再替换成更好的素材。
- 游戏已经有统一的战斗事件总线（`emit` / `onCombatEvent` 这类）和一个可读的游戏阶段（phase）。

不适用（需要另写方案）：
- 背景音乐和长环境底噪：要用 `playback: "stream"` 加循环，或者走 `MusicScore` 分层音乐，见 `references/forgeax-audio-notes.md`。
- 3D 空间音（需要 `AudioListener` 和 `Transform`）。
- 语音、对白。
- 非 ForgeaX 引擎：步骤 3–6 不适用，步骤 1、2、7 仍然可以照用。

## 输入
- GDD 或风格说明：要有风格关键词和明确不要的东西（本项目的写法见「参数」的「风格」一行）。
- 音效清单（P0/P1），每条写清时长范围和变体数。
- 游戏仓库里的：
  - 战斗事件类型定义文件，例如 `assets/combat/events.ts`。所有 `kind` 和字段都要知道，比如 `crit`、`heavy`、`phase`、`step`。
  - 发出事件的系统文件，用来查时序。例如瞬移类技能，起手和落地在同一帧发出。
  - 游戏阶段（phase）状态模块，以及标题、字幕、选择界面、死亡等阶段名。
  - 设置页主音量写到哪个全局变量（例如 `globalThis.__xxPrefs.volume`）。
  - engine 父插件（带 `children` 数组的那个 `*.pack.ts`），以及 frontend 根插件（`forge.json#roots.frontend` 对应的 pack）。
- 写入许可：只能写 `assets/audio/**`、两行注册、`reports/audio/**`、`evidence/audio/**`。注册行数要事先得到主控批准。
- 取证条件：flow 插件要用 `gameProjection.registerRead({ id, read })` 注册一个读投影，至少返回 `phase` 和 `kills`，否则 `play-audio.mjs` 走不了流程。没有的话，在设计表里提出来，由写游戏代码的人加。
- 环境：项目内的 pnpm（看 `packageManager`），Node ≥ 22。不需要 numpy，也不需要外部音频库。
- 本目录的 `scripts/`、`templates/` 路径都相对于这个 SKILL.md，命令里的 `scripts/...` 要换成绝对路径或先 `cd` 到这里。

## 步骤

### 1. 侦察（只读，约 15 分钟）
```bash
cd <GAME>
pnpm exec forgeax dev status --json        # 有 dev owner 就复用，不要另起，也不要结束别人的进程
                                           # 看 value.workers.engine：true 表示 engine-worker 模式
cat forge.json                             # roots.engine / roots.frontend 的 GUID
grep -rn "onCombatEvent\|emit({ kind" assets --include=*.ts | grep -v __tests__   # 事件订阅点和发出点
grep -rn "AudioContext\|createOscillator" assets --include=*.ts                   # 有没有现成的占位音
```
- 用 `scripts/plugin-guid.mjs` 把 `forge.json#roots` 的 GUID 反算出来。依次试各 pack 的 packageId 加 `plugin/engine`、`plugin/host`、`plugin/scene`，就能知道每个根是哪个文件。用法见脚本头部注释。
- **关键判断**：如果是 engine-worker 模式，战斗事件只在 Worker 里发出，frontend 那份 `events.ts` 是另一份模块副本，永远收不到事件。这时音频必须写成 engine 子插件；frontend 里基于 `onCombatEvent` 写的占位音实际上从来没响过。
- 读引擎音频文档：游戏仓库的 `skills/forgeax-engine-audio/SKILL.md`，再按 `references/forgeax-audio-notes.md` 里的「自查命令」核对当前版本的 API。

### 2. 设计表 → 主控确认（先确认，再动手）
- 复制 `templates/design-table.md`，写到 `reports/audio/<TASK>-design.md`。每个音写清：文件名、时长、合成手法、触发事件、变体数、所属响度档。
- 必须写出的内容：
  - 架构表（Engine / Host / frontend 各做什么）。
  - 注册需要几行、各在哪个文件。主音量同步一般要第 2 行，提前说明，让主控批。
  - 哪些事件不发声。
  - 防叠音规则。
- 确认前**不生成文件、不改代码**。

### 3. 合成音效
```bash
mkdir -p <GAME>/assets/audio/tools
cp scripts/synth.mjs <GAME>/assets/audio/tools/synth.mjs     # 进游戏仓库，SOURCES.md 里写的「重新生成」命令才有效
# 按设计表编辑 synth.mjs 里的 SOUNDS_ALL（名字 → tier、make、desc）和 TIERS。
# 脚本里现有的配方（slash/hit/dash…）是上一款游戏的样例：能用就改参数，用不上就删，积木函数保留
node <GAME>/assets/audio/tools/synth.mjs --audio <GAME>/assets/audio --ns <AUDIO_PACKAGE_ID> --key-prefix <GAME_ID>/audio
node scripts/wav-stats.mjs <GAME>/assets/audio/sfx            # 检查峰值、RMS、亮度，以及 PEAK / SILENT / LONG 标记
```
- 一次生成：`sfx/<name>[-a|-b|-c].wav`（PCM16、44.1 kHz、单声道）、`*.wav.meta.json`、`clips.ts`（音名 → GUID 和时长）、`tools/manifest.json`。
- GUID = UUIDv5(ns, "<key-prefix>/<file>")。ns 用音频插件自己的 packageId。
- packageId 怎么取：`grep -rn "definePackageId(" assets` 看项目现有编号，取一个没用过的同格式 UUID，再 `grep` 确认不重复。
- wav 要放在 `forge.json#assetRoots` 覆盖的目录下（一般是 `assets/`），否则不会被导入。
- 合成积木（都在 `synth.mjs` 里）：
  - `metal`：非谐波模态，比例 1 / 2.756 / 5.404 / 8.933，用于金属鸣响、磬。
  - `whoosh`：带通扫频噪声，用于破风。
  - `flutter`：30–46 Hz 调幅噪声，用于布料。
  - `thump`：下滑正弦加低通瞬态，用于肉体和地面冲击。
  - `crackle`：稀疏脉冲经高通，用于纸屑、碎裂声。
  - `clack`：极短激励加两三个共振，用于金属机关。
  - `room`：5 个早期反射加 9 kHz 低通，去掉「干、数码」感，每个音都过一遍。
- 不要裸用振荡器音色（方波、锯齿），那是「电子感」的主要来源。
- 合成脚本固定种子，可以逐字节复现。改了某个音之后，重跑会重新生成全部文件，这是正常的，只需 0.3 s。
- 拼试听合集交给制作人（`scripts/play-full.mjs` 是墨刃的整局 + 音量取证脚本，换项目时改顶部 CONFIG 和流程分支）：
  ```bash
  node scripts/preview-reel.mjs <GAME>/assets/audio/sfx <EVIDENCE>/<TASK>-preview-reel.wav --order <GAME>/assets/audio/tools/manifest.json
  ```
  同时会生成 `.txt` 时间轴。
- 写来源清单：
  ```bash
  node scripts/make-sources.mjs <GAME>/assets/audio <triggers.json> --license "<游戏许可>"
  ```
  `triggers.json` 参考 `templates/triggers.example.json`，每个音名都要写触发事件，缺了会报错。

### 4. 写接入代码（只新增文件）
从 `templates/` 复制到 `<GAME>/assets/audio/`，按文件头的 TEMPLATE 注释替换占位：
- `cues.ts`：
  - 纯映射：事件 → `Cue[]`，可以带 `delay`。
  - 每个音一条 `SoundSpec`：档位、冷却秒数、复音上限、随机变调幅度。
  - `TIER_VOLUME`：技能/命中 1.0，挥砍与敌方 0.8，UI 0.5。
  - `createUiCues()`：根据阶段跳变和本帧按键推出 UI 音。
- `audio.pack.ts`（engine 子插件）：
  - 加载全部片段，订阅**所有模块副本**的事件（见踩坑 3），按 cue spawn `AudioSource`，到时 despawn。
  - 维护全局 24 声部上限，同一个音不连续两次用同一个变体。
  - 写只读统计 `globalThis[STATS_GLOBAL]`。
  - 启动失败只记录、保持静音，**不能让游戏崩溃**。
  - `definePack` 的 config 里用 `$asset` 引用每个片段，让片段进入持久闭包。
- `volume.ts`（frontend）：每 150 ms 读一次设置页音量，变化时调用 `gameHost.audio.setBusVolume('master', v)`。同时暴露取证用的 `globalThis[HOST_GLOBAL]()`。
- `__tests__/cues.test.ts`：
  - 每个音都有片段，`SOUNDS` 和 `CLIPS` 的键一致。
  - 关键事件映射正确：暴击、敌方命中不发声、一个事件出两段音时的延迟、成对事件的结束段不发声。
  - UI 边沿：选中只响一次、阶段离开时响确认。
- 先对新文件做类型检查和单测：`pnpm exec tsc --noEmit`、`pnpm exec vitest run assets/audio`。

### 5. 两行注册（最后做）
```bash
git status --short -- <engine 父插件> <frontend 根插件>   # 有别人未提交的改动：只用精确替换插 1 行，不覆盖其他内容
cp scripts/plugin-guid.mjs <GAME>/.g.tmp.mjs && (cd <GAME> && node .g.tmp.mjs <AUDIO_PACKAGE_ID> plugin/audio); rm <GAME>/.g.tmp.mjs
```
- engine 父插件的 `children` 数组末尾加一行：`{ $asset: '<plugin/audio GUID>' }, // <TASK> plugin/audio`。要挂在能拿到 `world` 和 `assets` 的父插件下，例如场景插件，放在 vfx 后面。
- frontend 根插件 `ctx.effect` 生成器的开头（第一个 `yield` 附近）加一行：`yield (await import('../audio/volume.ts')).startAudioVolume(ctx.gameHost);`
- 报告里写清楚这两行在哪个文件、第几行、行内容是什么。用 `grep -n "<TASK>" <文件>` 取行号。

### 6. 检查与实机统计
```bash
pnpm exec forgeax project check --json && pnpm typecheck && pnpm test
cp scripts/play-audio.mjs <GAME>/assets/audio/tools/play-audio.mjs   # 改 CONFIG 和 enterGame() 适配游戏流程
AUDIO_OUT=<EVIDENCE>/<TASK> AUDIO_GOD=never AUDIO_SECONDS=90 AUDIO_EXPECT=<逗号分隔的全部音名> \
  pnpm exec forgeax project play assets/audio/tools/play-audio.mjs --json --timeout-ms 1200000 >/tmp/play.out 2>/tmp/play.err
grep '^{"ok"' /tmp/play.out | tail -1
python3 -c "import json;d=json.load(open('<EVIDENCE>/<TASK>/audio-play.json'));e=d['engine'];print(e['loaded'],e['failed'],d['hostActivePeak']);print(e['played']);print('missing',d['missing']);print(d['host'])"
```
- `project play` 一次就要 4–6 分钟，必须阻塞运行，单次超时给足 20 分钟，不要放后台轮询。
- 要做两局：
  - 一局 `AUDIO_GOD=15`：前 15 s 正常打，之后开无敌，用来稳定覆盖大部分音。
  - 一局 `AUDIO_GOD=never`：覆盖受击、死亡、大招资源攒满、关底敌人这类音。
- `missing` 不为空时：在报告里逐个写明原因（资源没攒满 / 开了无敌 / 没打到关底）。不要为了取证去改游戏代码。
- 主音量滑杆要单独验，分两档：
  - 快速档：`play-audio.mjs` 设 `AUDIO_VOLUME_SELECTOR=<滑杆 CSS 选择器>`，脚本直接改滑杆值并派发 input，`volumeProbe.after.master` 应为 0.3。这只证明桥接通了。
  - 验收档（推荐）：用 `scripts/play-full.mjs` 的做法：
    - 真实鼠标拖动滑杆。
    - 在 Host `WebAudioEngine` 的 master 总线增益节点后挂一个 AnalyserNode（`engine.graph.buses.get('master').nodes.fader`，private 只是 TS 层面的）。
    - 用一个**单文件、无变调**的 UI 音（例如菜单移动）在拖动前后各播一次，确认「输出峰值比 = 增益比」。
    - 需要音量桥额外暴露取证口 `globalThis.__xxAudioEngine = () => engine`。
- 跑不起来时先看踩坑 15–19。
- 想要无需等运气的整局覆盖（大招、受击、关底）：可以借用游戏自带的自动瞄准调试指令（如果有），但**不开无敌**；大招键按固定节奏真实按下，资源不满时游戏会忽略。
- `engine.events` 全空、但游戏明明在打：是模块副本问题（踩坑 3），不是播放问题。

### 7. 交付与替换
- 按 `templates/report.md` 写 `reports/audio/<TASK>.md`。
- 制作人试听合集后，点名「发假 / 电子味」的音，只替换这几个：
  - 换参数重合成；或者用 Kenney CC0（Freesound 只用 CC0）：把文件放进 `sfx/`，在 `SOUNDS_ALL` 里把该音的 `make` 换成 `external: [{ file: 'xxx.ogg', seconds: 0.21 }]`，再重跑 `synth.mjs`。它会沿用原 GUID、改写 meta、删掉被替换的 wav，不会覆盖你的素材。不要只手改 meta，下次重跑就被冲掉了。
  - `make-sources.mjs --cc0 cc0.json` 登记包名、原文件、链接、CC0。
  - 外部素材先转成 PCM16 wav，再用 `wav-stats.mjs` 把峰值对齐到该档（这个脚本只读 wav；`.ogg` 要自己确认响度）。
- 调冷却、响度时以主控给的基线提交号为准，改完重跑步骤 6。

## 验收标准（照这次实际用过的清单）
1. 清单逐项：每个音有文件、来源/许可、触发事件、实机触发次数。未触发的音单列原因，并注明「仅单测」。
2. 片段全部加载：`loaded` 等于文件数，`failed: []`。
3. 声音真的到了 Host：
   - Host `contextState: "running"`，`lastError: null`，`master` 等于设置页数值，拖动滑杆后 `master` 跟着变（`volumeProbe`）。
   - 战斗中 Host 活跃声源峰值 ≥ 1（这次是 5，Engine 侧声部峰值 8）。
   - 只有事件计数不算通过。
4. 音频统计到的战斗事件计数与 VFX（或其他订阅者）的计数**逐项相等**，证明既没有重复订阅，也没有漏订。
5. 响度：`wav-stats.mjs` 显示峰值按档落位（−3 / −6 / −12 dBFS），没有 `PEAK>-0.5`，单个音不超过 1.5 s（可以加 `LONG` 豁免说明）。
6. `project check --json` 返回 `ok: true`，`pnpm typecheck` 退出码 0，`pnpm test` 全过（这次：14 个文件 / 86 个用例，其中音频 3 个）。
7. `project play` 结果为 `passed: true`，console 和 page 错误都是 0。截图有开局、中段、结尾 3 张。
8. 有试听合集 `.wav` 和时间轴 `.txt`，由制作人主观验收音色。AI 听不到声音，不要自己宣称「好听」。
9. 只改了被允许的路径，两行注册的位置和内容在报告里写清。

## 踩坑与对策
1. **Worker 模式下 frontend 收不到战斗事件。** 事件在 Engine Worker 里发出，frontend 只能收到 flow 每帧 postMessage 过来的状态。原来写在 HUD 里的 `onCombatEvent → AudioContext` 占位音从来没响过。对策：音频写成 engine 子插件，由 Host 播放。动手前先用 `dev status` 看 `workers.engine`。
2. **主音量在 frontend，Worker 读不到。** 所以注册天然要 2 行（engine 一行、frontend 一行）。在设计表里就说明，让主控批准，不要临时超出「一行例外」。
3. **模块副本。** 插件加载器给每个插件单独一份 `events.ts` 和 `run.ts`，只有战斗图里那份会 emit，`globalThis.__xxRun` 也可能指向过期的那份。对策：
   - 订阅全局桥注册表里登记的所有副本的订阅函数，再加上自己这份，按函数去重。
   - 读阶段时采用「实际发过事件」的那份，或者「已经离开初始状态」的那份。
   - 验收时核对音频和 VFX 的事件计数是否相等。
   - `templates/audio.pack.ts` 依赖 `BRIDGES_GLOBAL` 这个注册表，它是 VFX 插件写的。新游戏没有这个注册表时，音频只订到自己那份，会一直静音。此时要让事件模块把监听器集合放到 `globalThis` 上共享（改事件模块一两行，要主控批准）。这个改法这次没实测过，做完先看 `engine.events` 有没有计数。
4. **瞬移类技能，起手和落地在同一帧发出。** 用 `Cue.delay`（0.08 s）把落地音错开，否则两个音糊成一个。
5. **游戏阶段在同一帧里被切走。** 例如选择界面按数字键，flow 插件在同一帧就把 phase 改掉了，只按「当前 phase 是选择界面」判断会漏掉选中音。对策：判断「当前或上一帧 phase 属于该阶段」。另外用鼠标点卡片的第一次预选不会产生按键，只有确认音靠阶段变化能触发，这条要写进限制。
6. **算事件密度要用游戏时间，不能用墙钟。** `play.advance(0.2)` 推进的是游戏时间，脚本里 40 多秒墙钟实际跑了约 190 秒游戏时间。曾经把 885 次攻击算成 22 次/秒，真实是约 4.7 次/秒，已被普攻间隔封顶。对策：设冷却前先查攻击间隔（规则文件里的 swing 之类）。冷却小于间隔时冷却不起作用；冷却大于间隔时会吞掉正常的挥砍。想让连击不吵，优先调响度和变体，不要靠冷却。
7. **`project play` 的 stdout 夹带大量贴图压缩日志**（basis 的 `Slice:` 行）。接 `| head` 会让 CLI 报 EPIPE 崩掉。对策：重定向到文件，再 `grep '^{"ok"' | tail -1`。
8. **崩溃时最终 JSON 会丢。** 要让脚本每 5 个 tick 写一次 `audio-progress.json`，崩溃后才知道崩之前触发了哪些音、走到了哪个阶段。
9. **渲染崩溃 `app-system-update-failed`（stage draw、reason shape、subject asset payload）不是音频造成的。** 音频片段不走渲染发布。这次的根因已由修复会话抓包证实：VFX 每帧调用 `assets.update` 时带着贴图绑定，共享贴图反复进出发布闭包，引擎发布端重发了 revision 没前进的存活贴图行，接收端拒收。对策：
   - 看到这个错误先查同期别人改的渲染/VFX 文件（`find assets -newer <你的文件>`）。
   - 想证明清白，就做「撤掉注册行再跑」的对照；对照没跑成时，结论只能写「未验证的判断」。
10. **并行开发时注册行会被别人还原**（对方把整份文件恢复成 HEAD）。对策：
    - 注册放到最后加，加之前看 `git status`。
    - 发现被还原不要自己抢着加回，回报主控，由当时唯一的写入者加。
    - 集成期只有一个写入者。
11. **别的会话正在改的 pack 文件会让启动直接失败**（`plugin-bootstrap-failed`，sourcePath 指向对方的文件）。对策：这不是你的问题，等对方交付后再跑，在报告里写明时间和文件。
12. **`AudioSource.playing` 只认 false → true 的变化。** 一次性音效每次都 spawn 新实体最稳。记得按片段时长除以变调倍率、再加 0.15 s 后 despawn，否则实体会越积越多。
13. **首次手势之前 Host context 是 `suspended`。** 这不是故障。playthrough 里的第一次按键会让它 resume。
14. **脚本用 python 字符串替换来修改时，可能把同一行插两次**（这次 playthrough 里 Enter 被连按了两次）。改完 `grep -c` 核对一遍，或者干脆整文件重写。zsh 下用 `sed -i ''` 改含引号的 JS 也很容易出错，而且一失败整条 `&&` 链就断了（这次因此丢了一局证据），统一改用 python 替换并 `assert` 原文存在。
15. **`project play` 报 `browser.newPage: Target crashed`。** 原因是 WorkBuddy 沙箱里的 Chrome 和它自带的 sandbox 冲突。光是在沙箱外运行还不够，要用 `游戏QA盲评skill` skill 的 `scripts/play.sh`（无沙箱 Chrome 包装，加 no-op `ps`），并在沙箱外运行。
16. **HUD 与 Engine Worker 状态同步有延迟。** `project play` 只在 `play.advance` 期间推进帧，界面操作后立刻按下一个键，Worker 那边可能还在旧状态。对策：
    - 每步之后循环 `advance(0.1)`，直到读投影或 `__xxView` 显示目标状态（设置已开/已关、回到标题）。
    - 点按钮、取滑杆位置之前，等它 `getBoundingClientRect().width > 0`，菜单会晚几帧才画出来。
    - 每次测量都用 `played[音名]` 的增量确认「恰好响了一次」，否则这次测量作废。
17. **标题菜单的 Enter 可能被游戏流程当成「任意键开局」。** 选「设置」会同时开局，设置面板就一直盖在游戏上。取证时用暂停菜单进设置，按 Enter 前先把菜单光标移到「开始」。发现这种情况要作为游戏 bug 转交，不要在音频侧绕。
18. **主工作区有别人进行中的改动导致启动失败时**（`plugin-bootstrap-failed`），用 `git worktree add --detach /tmp/<game>-<task> <基线提交>`，把 `assets/audio/` rsync 过去，再软链 `node_modules`，在副本里跑实机和三项检查。不碰别人的文件，结论注明「针对 <基线> + 音频改动」。用完 `git worktree remove --force`。
19. **一局拿不齐全部音是常态**（例如大招要先攒满资源，自动打法可能先打死关底）。最多跑 3–5 局，按局归档（`runN-<要点>/`），报告里列逐局表；连续两局没有新证据就停，不要无限重跑。

## 交接格式
- 设计表：`reports/audio/<TASK>-design.md`（模板 `templates/design-table.md`）。状态写「review（设计表待确认）」，末尾列出 4 个待主控回复的问题。
- 执行报告：`reports/audio/<TASK>.md`（模板 `templates/report.md`）。必须包含：
  - 状态（review / blocked）、输入版本和基线提交号。
  - 改动路径。
  - 两行注册的「文件 / 行号 / 内容 / 现状」表。
  - 清单逐项和触发次数。
  - Host 状态。
  - 三项检查结果。
  - 未验证项、限制、下一步。
- 证据：`evidence/audio/<TASK>/`，包括：
  - `audio-play.json`：通过的那局，可改名为 `runN-pass-audio-play.json`。
  - 崩溃局的 `audio-progress.json`：改名为 `crash-run-<HHMM>-progress.json`。
  - `<tag>-fight-start/mid/end.png`。
  - `evidence/audio/<TASK>-preview-reel.wav` 和 `.txt`。
- 游戏内：`assets/audio/SOURCES.md` 是来源与许可的唯一权威；`tools/synth.mjs` 和 `tools/manifest.json` 随仓库提交。
- 对话里的回报：结论一句话（能不能听到），注册位置，触发统计摘要，阻断项，以及需要主控做的决定。

## 参数（换项目只改这一节）
| 参数 | 墨刃（inkblade）取值 |
|---|---|
| 游戏根 `<GAME>` | `/Users/huangjifeng/Desktop/1/inkblade` |
| 游戏 ID / key 前缀 `<GAME_ID>/audio` | `inkblade/audio` |
| 主控目录（报告/证据） | `/Users/huangjifeng/Desktop/1/arpg-command-center`（`reports/audio/`、`evidence/audio/`） |
| 引擎版本 | `@forgeax/engine` 0.4.19（锁定，不升级）；项目 pnpm 12.15.0，Node 22.22.2 |
| 运行模式 | engine-worker（`dev status` 中 `workers.engine: true`） |
| 音频 packageId / 合成 `--ns` | `019fb7ce-4400-7000-8000-000000000000` |
| `plugin/audio` GUID | `8ace1b05-8a65-5855-93a2-1a11a603f84f` |
| engine 父插件（注册行 1） | `assets/world/world.pack.ts` 的 `children` 数组，在 `plugin/vfx` 下一行 |
| frontend 根插件（注册行 2） | `assets/ui/ui.pack.ts` 的 effect 里，`if (removeHud) yield removeHud;` 下一行（root GUID `62f18971-…` = ui pack 的 `plugin/host`） |
| 战斗事件 | `assets/combat/events.ts`：attack(step) / hit(crit, source) / kill(heavy) / skillCast(q\|e\|dash\|ult) / eRefresh / ultStart / ultSlash / ultEnd / enemyTelegraph(phase) / playerHurt / roomTransition / roomExit / inkMark / bolt |
| 阶段状态 | `assets/flow/run.ts` 的 `run.phase`：title / lines / hex / hexMid / hex2 / fight / bossCue / victory / ending / dead；`run.settings` |
| 主音量全局 | `globalThis.__inkPrefs.volume`（0..1，默认 0.8，滑杆 `#ui-volume`） |
| 模块副本桥 / run 全局 | `globalThis.__inkVfxBridges`（VFX 登记）、`globalThis.__inkRun` |
| 取证全局 | Engine：`__inkAudioStats`；Host：`__inkAudioHost`；瞄准：`__inkVfxStats`、`__inkVfxCamera` |
| play 读投影 | `{ read: 'ink-run' }`（flow 插件注册，返回 phase/room/wave/hp/kills/x/z） |
| 系统顺序 | `after: [FRAME_START_SCAN_SYSTEM_NAME, 'inkblade-combat', 'inkblade-flow']` |
| 按键 | 无敌 F2；技能 Q / E / Space(冲刺) / R(千刃)；三选一 Digit1–3（按两次确认）；Enter 确认/重开 |
| 相机偏航 | 38°（斜俯视，WASD 换算用） |
| 风格 | 水墨武侠：金属剑鸣 + 墨/纸/布质感 + 少量黄铜机关声；不要电子感、魔法闪光声 |
| 响度档 | 技能/命中 −3 dBFS·1.0；挥砍/冲刺 −6·0.8；敌方/受击/机关 −6·0.8；UI −12·0.5 |
| 冷却 | 挥砍目标 0.12 s（主控 11-05 定；`templates/cues.ts` 已是 0.12，**游戏内 `assets/audio/cues.ts` 截至 11-06 仍是 0.04，待改**）；普攻间隔 `COMBAT.swing` 0.18 s，所以 0.12 不会吞挥砍，实际也不起限流作用；命中 0.04 s、4 声部；全局 24 声部 |
| 当前音表 | 23 个音 / 35 个文件：slash-1/2/3、hit、hit-crit、dash、q-thrust、e-windup、e-land(+0.08 s)、e-refresh、ult-start/slash/end、telegraph、kill-ink、kill-ink-heavy、player-hurt、ui-move/confirm/hex-select/hex-confirm/transition、room-seal |
| 验证状态（截至 11-06 AU002） | 23 个音全部有实机触发记录（不开无敌，千刃 4 局中 3 局有）；hexArm 选中音鼠标/键盘各只响一次；主音量真实拖动 80→29→81，输出峰值比 0.362 / 1.012 与增益比一致。音色待制作人试听 |
| 选中卡片事件 | `hexArm { id, via: 'mouse' \| 'key' }`（`8773a14` 起），映射到 `ui-hex-select` |
| 取证口（新增） | Host：`__inkAudioEngine()`（音量探针挂分析器用）、`__inkView`（HUD 镜像的 Worker 状态） |
| 自动瞄准指令 | `__inkSend({ t: 'auto', on: true })`（调试指令，取证可用，不是无敌） |
| 已知游戏 bug | 标题菜单选「设置」会同时开局（`flow.pack.ts` 标题阶段任意键开局），音量取证改走暂停菜单 |
| 主音量滑杆选择器 | `#ui-volume` |
| 项目术语对照 | 选择界面 = 三选一（hex/hexMid/hex2）；瞬移技能 = E 饮墨落斩（落地延迟 0.08 s）；大招 = R 千刃；关底敌人 = Boss（`kill.heavy`） |
| 许可 | 合成音随游戏 Apache-2.0；替换只用 Kenney / Freesound 的 CC0 |
