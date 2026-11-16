# 游戏开发 Skills

从实际游戏开发项目中整理的 8 个 skill，包含操作指南、脚本、模板和参考资料。

## 目录

| 中文文件夹 | Skill 标识 | 用途 | 文件数 |
|---|---|---|---|
| [游戏主控协作skill](./游戏主控协作skill/SKILL.md) | `game-agent-coordination` | 多会话分工、任务单、集成与验收 | 4 |
| [概念图与批量提示词skill](./概念图与批量提示词skill/SKILL.md) | `game-concept-prompt-batch` | 统一美术风格、生成提示词与审图 | 7 |
| [3D资产制作skill](./3D资产制作skill/SKILL.md) | `game-3d-asset-pipeline` | 多视图、混元3D、Blender加工、GLB交付 | 25 |
| [UI设计skill](./UI设计skill/SKILL.md) | `game-ui-skin-pipeline` | UI效果图、切图、透明处理、HTML预览与接入 | 17 |
| [水墨特效制作skill](./水墨特效制作skill/SKILL.md) | `game-ink-vfx-pipeline` | 水墨贴图、Shader、事件时间线和性能检查 | 25 |
| [游戏音效制作skill](./游戏音效制作skill/SKILL.md) | `game-sfx-pipeline` | 音效设计、程序合成、接入与触发统计 | 16 |
| [游戏QA盲评skill](./游戏QA盲评skill/SKILL.md) | `game-qa-blind-review` | 独立盲评、测试矩阵、操作脚本与证据 | 17 |
| [游戏预览故障修复skill](./游戏预览故障修复skill/SKILL.md) | `game-fix-preview-bugs` | 预览问题复现、二分定位、回归和打包 | 17 |

## 使用方法

1. 打开对应目录的 `SKILL.md`，查看适用场景、输入要求和步骤。
2. 将需要的目录复制到项目的 `.workbuddy/skills/`，也可以复制全部 8 个目录，以保留跨 skill 引用。
3. 按各 skill 的「参数」章节配置项目路径、引擎版本与素材目录；脚本和模板中的示例路径也需按项目调整。
4. 按需准备 Node.js、Python、Blender、ForgeaX 等依赖，具体要求见各 skill。部分流程需要外部生成工具或服务。

文件夹使用中文名称；`SKILL.md` 中的英文 `name` 保留原始标识，方便识别来源。目录引用已同步更新为中文名称。

## 关于 ForgeAX

多项引擎接入步骤依赖 [ForgeAX（天工引擎）](https://forgeax.github.io/zh/)。ForgeAX 是一款 **AI Native（AI 原生）的 TypeScript 游戏引擎**，以 AI Agent 为第一用户：从数据、API 到工具链，都围绕让 AI 理解系统、编写代码、检查运行结果和修复问题来设计。

引擎提供基于 WebGPU 的渲染、ECS 游戏逻辑、2D/3D 物理、骨骼动画、音频和资产管线，并通过 CLI 串联项目创建、运行、检查与打包。AI 可以查询运行中的实体、检查渲染帧、获取截图和测试结果，用实际运行证据推进迭代。

你可以在 Codex、Cursor、Claude Code 等 AI 编程工具中接入 ForgeAX，把游戏想法逐步做成可玩的作品。本仓库的 skills 为其中的美术、UI、特效、音效、协作与验收环节提供可复用流程；使用其他引擎时，可保留通用方法并调整引擎相关步骤。

了解更多：[官网](https://forgeax.github.io/zh/) · [官方教程](https://forgeax.github.io/tutorials/) · [引擎源码](https://github.com/ForgeAX/forgeax-engine)

