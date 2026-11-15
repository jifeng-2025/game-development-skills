# F00N · <问题一句话> 修复报告

- 执行：<会话>，<日期>。基线 `<game>@<sha>`。未改：<禁区目录>；引擎 <版本>；没有动 dev 服务和 <dev 端口>（测试端口 <…>）。
- **最终提交：`<sha>`**（git 干净，无残留 worktree）。代码最终提交 `<sha>`；`<sha>` 只含打包产物。
- **web-zip**：`<path>`，<bytes> 字节，sha256 `<sha256>`，源提交 `<sha>`，dirty=false（从 HEAD 干净副本打包）。
- 证据：`evidence/fix/F00N/`（`compare/` 修复前后并排、`after/` 修复后逐屏、`zip/` 解压后实测、`playthrough/` 官方脚本报告、`full/` 整局）。

## 问题 1：<现象>
**复现**（preview，真实输入）：<步骤>，<N> 次中 <M> 次出现，<时间点>。
**二分**：
| 构建 | 结果 |
|---|---|
| 基线 | … |
| 去掉 <插件/资源 X> | … |
| 只改 <Y>（隔离 worktree，未提交） | … |
**根因**：<报错位置（文件:函数）> + <触发条件> + <为何 dev 不出现>。证据：<文件 / 日志关键行>。
**修复**（`<sha>`，在 <允许改的目录>）：<做了什么>。修复后 <N/N>。
**转交**：<需要别的会话改的根本修复，已验证 x/x，未提交>。

## 问题 2 …

## 验收
1. 官方 `project play <playthrough> --require-ui` 在最终代码上连续 2 次 `passed: true`，console 0 / page 0 / layout 0。
2. preview（`build --html-head …` + `preview`）：<逐屏 / 整局 ×2>，0 错误，<关键数字>。
3. zip：解压后静态服务器打开，同一脚本 PASS。
4. 单测 <N> 条、tsc 通过；逐提交 tsc（`check-commits.sh <game> <基线>`）<N>/<N> 通过。

## 没修 / 需要配合
- <会话>：<接口请求，写清事件名、字段、触发时机>
- <未验证项>

## 引擎反馈
已记入 `docs/feedback.md`：<标题>（Status: workaround）。
