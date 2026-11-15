# ForgeaX：preview / zip 与 dev 的差异与坑（实测清单）

每条：**症状 → 原因 → 对策 → 怎么验证**。版本：`@forgeax/engine` 0.4.19。「dev」= `forgeax dev start`；「preview」= `project build` + `project preview`；「zip」= `project package` 解压后放静态服务器。

## A. 只在 preview / zip 出现的运行时问题

### A1 同一张贴图被重复发布，渲染 Worker 拒收整帧
- **症状**：进某个场景几秒后整页变成错误页，`AppError app-system-update-failed`，`detail.cause.stage: draw`、`cause.reason: shape`、`cause.subject: asset payload`。随机出现（例如 4 次中 3 次），dev 下不出现。
- **原因**：插件每帧对材质副本 `assets.update(copy, { values: { maskTexture: {texture}, …数字 } })`。只要 patch 里带贴图绑定，就会走完整依赖重建，共享贴图每帧进出发布闭包；0.4.19 发布端会把仍在接收端存活的贴图行**以不变的 revision 再发一次**，`engine-render/src/publication/receiver.ts` 的 `stageAssetRows` 拒收。
- **对策**：根本修法是每帧 `update` 只传数值，贴图绑定只在创建时设一次。改不了那个插件时的兜底：另写一个插件，让原型材质（连带贴图）整局常驻（放在地面下方不可见的小网格上，不投影）。
- **验证**：`driver.mjs` 加 `FIX_TRACE=1`，记录里 `dupRows` 应为 0；修复前能抓到 `[FIX] dup-row {handle, revision, known…}`。二分：去掉该插件 / 只去掉贴图绑定，各跑 3–4 次。

### A2 启动约 1.4 s 随机失败：`plugin-startup-failed → asset-dependency-failed`
- **症状**：开页就显示 Unable to start the game；`dependencyGuid` 每次可能不同（随机某个网格）；没有网络错误。
- **原因**：built 页面的 Catalog 分批到达，后到的 delta 让正在读的 scene 闭包里某个依赖失效（`asset-superseded`），`asset-graph.ts` 的 `visit()` 把子错误换成不带原因的 `asset-dependency-failed`。
- **对策**：根场景加载对 `asset-dependency-failed` / `asset-superseded` 重试几次（150 ms × 次数退避），这正是引擎 hint「retry the root asset」。打一行 `console.warn('[game] scene load … retrying')` 便于统计。
- **验证**：连开 7–10 次，`open.result === 'open'`；`warnings` 里能看到重试且重试一次就成功。

### A3 `/@fs/<绝对路径>` 图片在 preview / zip 全部不显示
- **症状**：HUD 框、按钮、血条底图全无，只剩文字；network 里 `/@fs/…` 返回 200 但 `content-type: text/html`（preview 的 index.html 回落）。
- **原因**：`/@fs/` 是 Vite dev 服务器的文件路由，build 不会拷贝这些文件。
- **对策**：把图片内联成 data URL 常量模块（`scripts/inline-images.py`，webp，显示尺寸 2 倍）。**不能**用 `import.meta.glob` 或 `?url` 导入：Pack 烹饪在 Node 里执行插件模块，会报 `glob is not a function`，改成懒调用又会报 `plugin-bootstrap-failed: compiler consumed an uncaptured program input`。
- **验证**：driver 记录 `devOnlyRoutes` 为 0；页面里每个 `--skin-*`/图片能 `Image.decode()`；单测断言样式表里没有 `@fs` / `/Users/`。

### A4 样式重置把切图边框清掉（dev 也错，但常在修 A3 时才看见）
- **症状**：图片已加载，但菜单按钮笔触、卡框不显示。
- **原因**：`#stage button{border:0}` 这类 ID 选择器重置的优先级高于 `.menu-item{border-image:…}`。
- **对策**：重置写成 `:where(#stage button){…}`（零优先级）。

## B. 输入与 DOM

### B1 DOM 每帧重建导致真人点击丢失
- **症状**：脚本里的瞬时点击能选中，真人点不中；`elementFromPoint` 查不到遮挡层。
- **原因**：HUD 每 40 ms `row.innerHTML = …`；真人按下到松开约 100–120 ms，按钮在 mousedown 与 mouseup 之间被替换，click 落到父元素上。
- **对策**：元素按「上下文」只生成一次（例如 `phase|hex` 变了才重建），之后只切 class。
- **验证**：`ctx.click(x, y, 120)`（按住 120 ms）对每张卡点一次再确认；对照 `delay 0` 能复现差异，证明是竞态不是遮挡。

### B2 静止鼠标抢走菜单高亮
- **症状**：暂停时高亮落在鼠标正下方的项（可能是「回标题」），按 Enter 误退。
- **原因**：选中态用 `:hover`。
- **对策**：菜单自己维护光标（打开时归零，方向键/WS 移动，`mousemove` 才跟随鼠标）。

### B3 引擎 Worker 页面的 HUD 与游戏状态不在同一 realm
- 默认 Worker 模式下 HUD（presentation realm）拿到的是端口推来的快照，直接改 `run` 不会生效，`emit()` 也到不了引擎侧订阅者（音频、特效）。
- HUD → 游戏：经 `port.postMessage({t:…})` 发命令，由 flow 插件写入共享状态；需要广播事件时，由引擎侧插件（拿得到“活”的事件模块副本的那个）根据状态变化 `emit`。
- 插件加载器会给不同插件各自一份模块副本；跨插件订阅事件要通过已有的 bridge 注册表（例如 `globalThis.__inkVfxBridges`），别在新插件里自己 `import events.ts` 指望能收到。

## C. 构建、回归、打包流程里的坑

| 坑 | 症状 | 对策 |
|---|---|---|
| 别的会话在改文件 | `project build`/`play` 报 `plugin-bootstrap-failed: source changed during plugin compilation`；`package` 报 `package-source-changed` | 从提交的干净 worktree 构建/打包（`build-preview.sh … <ref>`、`package-clean.sh`）；只 stage 自己的文件 |
| worktree 里的 `node_modules` 软链接 | worktree 显示 dirty；`package` 报 `executor-threw … EISDIR` | `.gitignore` 的 `node_modules/`（带斜杠）不匹配软链接；在主仓 `.git/info/exclude` 加 `/node_modules` |
| `project package` 不带 html-head | zip 里没有自定义加载页 | 包里本来就没有；在 DEMO/README 写明「演示用 build --html-head + preview」，不要事后改 dist |
| 构建输出放在仓库里 | 第二次构建同目录时被沙箱的批量删除保护拦下（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`），或输出出现在 git status | 输出到 `/tmp/fix-<名字>`；仓库内目录务必在 `.git/info/exclude` |
| `project play` 不服务 dist | 官方 play 跑的是自己的临时 Vite 运行时，不是你的构建 | 要测 built 页面：play 一个驱动模块，在 play 浏览器里另开 context 打开 preview URL（`driver.mjs`）。官方 `playthrough.mjs` 照常跑，作为 dev 运行时的门禁 |
| play 浏览器上下文不能 `newPage` | `Please use browser.newContext()` | `play.page.context().browser().newContext()` |
| 沙箱里引擎 Chromium 崩 | `browser.newPage: Target crashed`（`play-not-ready`/`browser-capture-failed`） | `scripts/play.sh`（系统 Chrome + `--no-sandbox` + 假 `ps`），在沙箱外运行 |
| play 很慢 | 启动 3–6 分钟，第一次构建 7–15 分钟（缓存失效时） | 二分和截图用 `fast-run.mjs`（几秒启动）；官方 play 只在最终验收跑；构建统一用 `FORGEAX_BUILD_CACHE_DIR` 指向主仓 `.forgeax/ddc` |
| 自动战斗走不到出口 | 清房后 `auto` 仍每 1/3 s 朝旧目标冲刺 | 走路前关 auto，到出口后再开 |
| 结局按 Enter 被当成「重开」 | 脚本卡在新一局 | 结局对话用点击推进；回到标题后忽略 0.4 s 内的 Enter |
| zsh 变量不分词 | `for c in "a b"` 当成一个参数 | 写成独立参数或用 bash |
| 单个 shell 调用被执行两次 | 断言失败但改动其实已写入 | 用幂等编辑（先检查再替换），以 `grep` 核对结果为准 |
