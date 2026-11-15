---
name: game-fix-preview-bugs
description: 修只在构建产物（project build + preview、web-zip）里出现的 ForgeaX 游戏 bug：在 preview 下用真实键鼠复现 → 二分定位（逐个去掉插件、逐个回退资源，全在隔离 worktree 里做）→ 修复 → 官方 playthrough 加 preview 驱动连续回归 → 从干净副本打包。附 preview 与 dev 差异清单（重复发布贴图、/@fs 路径、DOM 每帧重建丢点击、加载竞态、package 不带 html-head、node_modules 软链接等）和可参数化脚本。触发词：preview 崩溃、打包后坏了、zip 里不显示、dev 正常 preview 不正常、app-system-update-failed、plugin-startup-failed、asset-dependency-failed、点不中、修 QA 问题、F00N、回归、重新打包。
---

# 修构建形态下的游戏 bug（ForgeaX）

## 适用场景 / 不适用

适用：
- dev（`forgeax dev start`）正常，**preview 或 zip 里**崩溃、卡启动、图片缺失、点击无效。
- QA 报告给出了复现步骤，需要定位根因、修复并给出前后证据。
- 交付前要做「官方 playthrough + preview 整局」的回归，并从干净副本重新打包。

不适用：
- 纯玩法 / 数值调整（没有构建形态差异，直接在 dev 改）。
- 做新特效、新音效、新 UI 切图：交给对应 pipeline skill。本 skill 只修它们在构建形态下的问题，并把需要它们改的地方写成**接口请求**。
- 引擎本身的修复：只做游戏侧绕过，并按 `templates/engine-feedback-entry.md` 写进游戏的 `docs/feedback.md`。

## 输入

| 输入 | 说明 |
|---|---|
| 游戏仓库与基线提交 | 记下 `git rev-parse --short HEAD`；先 `git status --short`，看有没有别的会话的未提交改动 |
| 问题描述 / QA 报告 | 复现步骤、出现频率、截图位置（修复前截图要和它同位置） |
| 写权限范围 | 哪些目录不能改（例如特效、音频目录）；那里的问题只写接口请求 |
| 游戏的页面钩子 | 页面上能读的状态快照、能发的调试命令、按键表 → 写进 profile（步骤 2） |
| 构建参数 | `--html-head` 片段、dev 端口（不能占）、可用的测试端口 |
| 环境 | macOS；游戏目录有 `node_modules`；系统 Chrome；`python3` + Pillow（`pip install Pillow`）。启动浏览器 / GPU 的命令都要在 agent 沙箱**外**运行 |

## 步骤

所有脚本在 `scripts/`，用绝对路径调用（下文 `$S` = 本 skill 的 `scripts` 目录，`$K` = 本 skill 目录，`$G` = 游戏目录）。脚本是 bash / sh，在 zsh 里直接调用即可。

| 脚本 | 用途 | 沙箱 | 实测耗时（130 MB 构建，缓存热） |
|---|---|---|---|
| `build-preview.sh` | 构建（可选从提交的干净 worktree）+ 常驻 preview | 沙箱外（构建会被批量删除保护拦） | 带缓存约 80 s；缓存失效 7–15 min |
| `bisect-build.sh` | 在 `/tmp` worktree 里做一个改动并构建 | 沙箱外 | 约 55 s |
| `fast-run.mjs` + `driver.mjs` | 用系统 Chrome 跑 profile 的某个模式 | 沙箱外（GPU 浏览器） | start 15 s，hold 26 s，shots 33 s，full 约 40 s |
| `play.sh` + `driver.mjs` | 同一驱动走官方 `project play` 门禁 | 沙箱外 | 约 13 min（大部分是 play 启动自己的运行时） |
| `play.sh` + `playthrough.mjs` | 官方冒烟 | 沙箱外 | 约 6 min |
| `package-clean.sh` | 干净 worktree 打 web-zip | 沙箱外 | 约 10–15 min |
| `check-commits.sh` | 在临时 worktree 里对 base..HEAD 的**每个**提交跑 typecheck（可加测试） | 沙箱外 | 每个提交约 10–20 s（只跑 tsc） |
| `stage-hunks.py` / `compare.py` / `inline-images.py` | 分块暂存 / 并排图 / 图片内联 | 沙箱内即可 | 秒级 |

长任务放后台跑（构建、preview、play、package），等完成通知，不要轮询。

1. **锁定基线，构建 preview（不碰主工作区）**
   - 如果工作区有别人的未提交改动，从提交构建：`FIX_HTML_HEAD=<参数里的 html-head> $S/build-preview.sh $G /tmp/fix-base <port> <基线sha>`（后台运行；它先 build 再常驻 preview）。没有别人改动时可省略最后的 ref 参数。
   - 输出目录一律放 `/tmp`；不要用游戏的 `dist/`，也不要占 dev 端口。
   - 首次构建 7–15 分钟，之后带缓存约 1 分钟。`curl -s -o /dev/null -w '%{http_code}' http://localhost:<port>/` 返回 200 后再继续。
   - 带 ref 时 worktree 在 `/tmp/fix-wt-<ref>`，preview 运行期间要一直保留；停掉 preview 后在第 7 步删除。

2. **写 profile，用真实输入复现**
   - 复制 `templates/profile.inkblade.mjs` 为 `profile.<游戏>.mjs`，改写：`readState`（页面里读状态，返回扁平对象）、`sendCommand`、`position`、`answer`（等待期间怎样推进对话），以及 `modes`（`start` / `hold` / `full` 等）。`readState`、`sendCommand` 在页面里执行，不能引用模块里的变量。
   - 快速复现（几秒启动）：
     `FIX_GAME_DIR=$G FIX_URL=http://localhost:<port>/ FIX_PROFILE=/abs/profile.mjs FIX_MODE=hold FIX_RUNS=3 FIX_TAG=base FIX_OUT=<证据目录> node $S/fast-run.mjs $S/driver.mjs`
   - `driver.mjs` 的 summary 每局一行：`ok`、`open`（开页到可输入的秒数）、`failed`（错误页前两行）、`pageErrors`、`consoleErrors`、`devOnlyRoutes`（`/@fs` 请求数）、`dupRows`（`FIX_TRACE=1` 时）。任何一项非 0 或有 error，这一局就算失败。
   - 每局一个 `<tag>-<mode>-<n>.json`：开页耗时、错误页全文（`failed.text`）、page/console 错误、`/@fs` 请求、截图列表。**错误页全文**是定位的第一手材料：先找 `code`、`stage`、`reason`、`subject`、`dependencyGuid`。
   - 记下复现率（例如 3/4），后面每个二分构建用同样的局数比较。
   - 点击类问题：先 `ctx.hitProbe(selector)` 看中心点最上层是不是目标元素；再分别用 `ctx.click(x, y, 0)` 和 `ctx.click(x, y, 120)` 对照（只有 120 ms 失败 = 重绘竞态，见 references B1）。

3. **二分定位（一次只改一个变量，全部在隔离 worktree 里）**
   - `$S/bisect-build.sh $G <名字> <基线sha> "<改动命令或 patch 文件>" <port>`（需要加载页时同样设 `FIX_HTML_HEAD`）。改动命令用 perl，例如去掉某个子插件：`"perl -pi -e 's{^(\s*)(.*<插件GUID或键>.*)}{\$1// BISECT \$2}' assets/<根插件>.pack.ts"`；不要用 `sed -i ''`（这台机器上 sed 可能是 GNU 版，参数含义不同）。改动没有改到任何文件时，脚本会直接停下。主工作区始终不动。
   - 输出在 `/tmp/fix-bisect-<名字>`，改动 patch 在 `/tmp/fix-bisect-<名字>.patch`，worktree 构建完自动删除。
   - 顺序：① 逐个去掉根插件的子插件（先去最可疑的：每帧改材质 / 资源的插件）；② 逐个回退资源目录或 meta：`git checkout <旧sha> -- assets/<目录>`；③ 在被怀疑的插件里只去掉某一个调用（例如每帧 `assets.update` 里的贴图绑定）。
   - 每个变体用和基线相同的 mode、局数跑 driver。对比表要写进报告。
   - 需要看引擎内部时：读 `$G/node_modules/.pnpm/@forgeax+engine@<版本>_*/node_modules/@forgeax/engine/node_modules/@forgeax/<包>/src/`，按报错的 `stage` / `code` 搜索发出点。渲染发布问题加 `FIX_TRACE=1`，看 `[FIX] dup-row`。
   - 对照 `references/preview-vs-dev.md`，大部分问题属于其中一类。

4. **修复**
   - 只改允许的目录。根本修复在别人的目录里时：在自己的目录做兜底（例如常驻插件、重试），把根本修复写成「已在隔离 worktree 验证 x/x、未提交」交给对方。
   - 每修一项：`pnpm typecheck`，`pnpm test`，并给关键行为补一个单测（例如「样式表里没有 `@fs`」「常驻列表覆盖所有原型」）。
   - 多个修复改到同一文件时，用 `python3 $S/stage-hunks.py <文件> <关键词…>` 分块暂存，**一项一提交**；提交前 `git diff --cached` 过一遍。只 `git add` 自己的文件，别人的未提交改动原样保留。
   - **一组提交做完后，每个提交都要单独编译**：`$S/check-commits.sh $G <基线sha>`（默认跑 `pnpm exec tsc --noEmit`；想连测试一起跑，设 `FIX_CHECK_CMD="pnpm exec tsc --noEmit && pnpm test"`）。只检查 HEAD 不够：HEAD 能编译，不代表中间的提交能编译。任何一个提交失败都要修好再交付：如果是最后一个提交，用 `git commit --amend`；如果是中间的提交，先 `git reset --soft <基线>`，再按项逐个重新提交，然后重跑检查。报告里写「逐提交 tsc：N/N 通过」。
   - 分块暂存时**不要用 `git stash push --keep-index` / `git stash pop` 来回切换**，也不要把改名（例如 `git mv README.md …`）和分块暂存放在同一组提交里。如果确实需要隔离检查，用临时 worktree，不要用 stash。
   - 引擎问题按 `templates/engine-feedback-entry.md` 追加到 `$G/docs/feedback.md`，和对应修复一起提交。

5. **回归（顺序固定）**
   1. 构建最终版 preview：`FIX_HTML_HEAD=<html-head> $S/build-preview.sh $G /tmp/fix-final <port> HEAD`（后台）。
   2. preview 逐屏截图：模板里有一个 `shots` 模式，按任务把截图点改成「每个问题在原截图的同一位置截一张」，每张都调用 `ctx.overlaps(文字层选择器, { modal: [菜单卡选择器] })`。被声明为 modal 的菜单整块盖住 HUD 文字，记为 `covered`（正常）；HUD 文字或面板压在菜单上，或者两层文字互相压，记为重叠，这一局失败。运行：`FIX_VIEWPORT=1920x1080 FIX_MODE=shots … node $S/fast-run.mjs $S/driver.mjs`。修复前想先拍全一套，加 `FIX_OVERLAP=warn`（只记录、不失败）。前后对比：`python3 $S/compare.py pairs.json <证据>/compare`（pairs 格式见脚本头注释）。
   3. preview 整局 ×2，走官方门禁：`FIX_URL=… FIX_PROFILE=… FIX_MODE=full FIX_RUNS=2 FIX_OUT=<证据>/full sh $S/play.sh $G $S/driver.mjs --timeout-ms 1500000`。play 自己的报告写在 `$G/artifacts/play/external/driver-<hash>/play.json`（已被 gitignore），复制到证据目录。
   4. 官方 playthrough ×2：`sh $S/play.sh $G scripts/playthrough.mjs --require-ui` 连续两次。如果工作区有别人的改动，在干净 worktree 里跑，否则会报 `plugin-bootstrap-failed`：
      `git -C $G worktree add -q --detach /tmp/fix-wt-pt HEAD && ln -s $G/node_modules /tmp/fix-wt-pt/node_modules && FORGEAX_BUILD_CACHE_DIR=$G/.forgeax/ddc sh $S/play.sh /tmp/fix-wt-pt scripts/playthrough.mjs --require-ui`（跑完 `git -C $G worktree remove --force /tmp/fix-wt-pt`）。脚本本身要能自己推进开场和对话，参考 `templates/playthrough.inkblade.mjs`。
   5. 有任何一步失败：修了再从第 1 步开始，不要只重跑失败的那一步。

6. **从干净副本打包并实测 zip**
   - `$S/package-clean.sh $G HEAD release/<id>-web.zip`：输出 bytes、sha256、commit，`dirty` 必须是 `false`。
   - 解压到 `/tmp/fix-zip`，`python3 -m http.server <port> --bind 127.0.0.1`，用同一个 shots 模式跑一遍。
   - 把 zip 和 `.sha256` 单独提交一次（提交信息写「Package …」）。

7. **收尾**：停掉自己启动的 preview 和 http.server；`git -C $G worktree remove --force /tmp/fix-wt-<ref>` 加 `git -C $G worktree prune`；`git worktree list` 里只剩别人的 worktree；`git status --short` 只剩别人的文件；按交接格式写报告。

## 验收标准

- 复现：修复前在 preview 下有明确复现率（例如 3/4），附错误页全文或截图。
- 二分：至少一张「构建 × 结果」对比表，能把根因归到一个插件、资源或调用上。
- 修复后：同样的局数、同样的 mode **全部通过**；渲染类问题 `dupRows = 0`；图片类问题 `devOnlyRoutes = 0`，所有图片都能解码。
- 文字 / 布局：shots 模式里 `overlaps.pairs` 为空，官方 play 的 `layout` 警告为 0。
- 官方 `project play scripts/playthrough.mjs --require-ui` 在最终代码上**连续 2 次** `passed: true`，console 0、page 0。
- preview 整局 ×2 到达结局，0 错误；zip 解压实测 PASS。
- 每个问题都有前后并排图，修复前用的是原问题的截图。
- `pnpm test`、`pnpm typecheck` 通过；`check-commits.sh` 显示从基线到 HEAD 的**每个提交**都编译通过；git 干净（只剩别人的文件），每项一提交；zip 的 `dirty=false`。

## 踩坑与对策

（完整清单和验证方法见 `references/preview-vs-dev.md`，最常见的几条：）

1. **每帧给材质 patch 贴图绑定 → 贴图被重复发布 → `draw / shape / asset payload` 整页崩**：每帧 update 只传数值；兜底是让原型材质常驻。
2. **启动随机 `asset-dependency-failed`（每次 GUID 不同）**：Catalog 分批到达的竞态；根场景加载对 `asset-dependency-failed` / `asset-superseded` 退避重试。
3. **`/@fs/` 图片在 preview / zip 全部不显示**：内联成 webp data URL（`inline-images.py`）；不能用 `import.meta.glob` / `?url`（Pack 在 Node 里烹饪插件）。
4. **真人点不中、脚本点得中**：DOM 每 40 ms 重建；改成按上下文只生成一次。复现时点击一定要按住 120 ms。
5. **别的会话同时在改** → build / play 报 `plugin-bootstrap-failed`，package 报 `package-source-changed`：从提交的干净 worktree 构建和打包，只 stage 自己的文件。
6. **worktree 的 `node_modules` 软链接** → dirty 或 `EISDIR`：主仓 `.git/info/exclude` 加 `/node_modules`（脚本已自动加）。
7. **`project package` 没有 `--html-head`**：zip 里没有加载页，这是预期；在演示文档里写清。
8. **`project play` 不服务 dist**：测 built 页面要用驱动模块在 play 浏览器里另开 `browser.newContext()`；官方 playthrough 跑的是它自己的运行时，两者都要过。
9. **沙箱里 Chromium 崩（`Target crashed`）**：用 `play.sh`，并在沙箱外运行。
10. **构建输出放在仓库里** → 沙箱批量删除保护让第二次构建失败：输出放 `/tmp`。
11. **Worker 页面里 HUD 直接改状态无效、`emit` 不到引擎侧**：HUD 发端口命令 → flow 写共享状态 → 引擎侧插件按状态变化 `emit`（例如 `hexArm`）。
12. **一条 shell 命令偶尔被执行两次**：编辑写成幂等的，以 `grep` 结果为准，不要信断言报错。
13. **注入了 Worker 钩子后 `browser.close()` 会挂住好几分钟**，外层命令因此被 SIGTERM：`fast-run.mjs` 已经限时 10 s 关闭并强制退出；自己写的运行器也要这样做。
14. **文字层重叠只比包围盒会误报**：菜单卡整块盖住 HUD 文字是正常的。用 `overlaps` 的 `modal` 参数区分；判断前先看截图。
15. **点击坐标写死**：换了视口（1280×720 换成 1920×1080）就点不到。按 `page.viewportSize()` 的比例计算，或者用 `hitProbe` 取元素中心。
16. **静态服务器的 favicon 404** 会进 console error：driver 已经忽略；其他 404 仍然要算。
17. **分块暂存会重复插入一行，导致中间某个提交编译失败**（F004 实测）：`stage-hunks.py` 用不带上下文的 `-U0` 分块，`git apply` 只按行号放置。中间夹了 `git stash --keep-index` / `stash pop` 来回切换后，同一个 `let` 声明在中间提交里出现了两次（`TS2451 Cannot redeclare`），工作区最终版本反而能编译。同一轮里，一个改名文件的内容也被另一个文件覆盖了。对策：提交完用 `check-commits.sh` 逐个提交跑 typecheck；不和 stash 来回切换混用；改名单独提交，并 `git show --stat -M` 核对行数。
18. **`project play` 和 `project build` 同时跑会报 `commit-failed`**（`stage: commit`，`subject: <游戏>/assets`）：两者共用同一个构建缓存。错开运行，等构建或 preview 的构建阶段结束后再开始 play。
19. **zsh 里 `"$c:assets/x.ts"` 会被当成 `:a` 修饰符**，路径被改写，`git show` 报 ambiguous argument：写成 `"${c}:assets/x.ts"`。

## 交接格式

- 报告：`<指挥目录>/reports/fix/F00N.md`，按 `templates/report.template.md`。必须有：最终提交号（代码提交和打包提交分开写）、zip 字节数、sha256、源提交、dirty=false、每个问题的「复现 → 二分表 → 根因 → 修复提交 → 修复后结果」、验收四项、没修 / 转交 / 接口请求、引擎反馈条目。
- 证据：`<指挥目录>/evidence/fix/F00N/`，下面 `compare/`（`<问题号>-<短名>.png`，左修复前、右修复后）、`after/`、`zip/`、`playthrough/`（`run1-play.json`、`run2-play.json`）、`full/`。
- 提交信息：一句英文祈使句，说明玩家能看到的变化（例如 `Keep the dialogue strip left of the skill bar.`）；打包提交单独一条（`Package the F00N web build.`）。
- 对话里回报：最终提交号、zip sha256、验收结果（数字）、没修的项和需要谁配合。

## 参数（换项目只改这一节）

| 参数 | 墨刃 / inkblade 的值 |
|---|---|
| 游戏目录 `$G` | `/Users/huangjifeng/Desktop/1/inkblade` |
| 指挥目录（报告 / 证据） | `/Users/huangjifeng/Desktop/1/arpg-command-center`（`reports/fix/`、`evidence/fix/`） |
| 引擎 | `@forgeax/engine` 0.4.19；引擎源码 `$G/node_modules/.pnpm/@forgeax+engine@0.4.19_*/node_modules/@forgeax/engine/node_modules/@forgeax/` |
| html-head | `boot/ink-loading.html`（「墨研中」加载页；zip 里没有） |
| dev 端口（不要占） | 5173；dev 服务归音频会话 |
| 测试端口 | 4791–4799、4801–4802、4811–4814、4821 都用过；新任务从 48x0 起选一段 |
| 禁区目录 | `assets/vfx/**`（特效会话）、`assets/audio/**`（音频会话）；`skills/`（SDK 管理） |
| profile | `templates/profile.inkblade.mjs`：页面钩子 `__inkView`（状态）、`__inkSend`（命令：`auto` / `god` / `restart` / `reenter` / `hexArm`）；按键 Enter 推进，Digit1–3 两次选卡，F2 无敌，F4 跳 Boss，Esc 暂停；三个出口 `[0,-2.15]`、`[0,60.5]`、`[0,-59]` |
| 官方 playthrough | `$G/scripts/playthrough.mjs`（读取接口 `ink-run`；副本在 `templates/playthrough.inkblade.mjs`） |
| 皮肤内联 | `$G/scripts/inline-skin.py` → `assets/ui/skin-images.ts`（通用版 `scripts/inline-images.py`） |
| 构建缓存 | `FORGEAX_BUILD_CACHE_DIR=$G/.forgeax/ddc` |
| 已知兜底（别重复做） | `assets/world/vfx-residency.ts`（贴图常驻）、`assets/world/world.pack.ts` 的 `SCENE_RETRY_CODES`（启动重试） |
| 引擎反馈文件 | `$G/docs/feedback.md` |
