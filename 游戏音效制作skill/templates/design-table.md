# <TASK-ID> 音效设计表（待主控确认）

- 状态：review（设计表待确认，未生成文件、未改代码）
- 输入：<GDD 路径>、<战斗事件定义文件>、<发事件的系统文件>、<UI/HUD 文件>、引擎音频技能文档
- 实测：`forgeax dev status` → execution = <engine-worker | main-serial>（决定事件和音频在哪个 realm）

## 一、架构（需拍板）
| 部分 | Realm | 做什么 |
|---|---|---|
| `assets/audio/audio.pack.ts`（engine 子插件） | Engine | 订阅战斗事件 + 读阶段/输入，spawn 一次性 `AudioSource` |
| Host 播放 | 主线程 | ForgeaX bootstrap 自带 `createHostAudioConsumer`，不自己写 |
| `assets/audio/volume.ts` | frontend | 设置页主音量 → `gameHost.audio.setBusVolume('master', v)` |

注册：engine 父插件 `children` +1 行；frontend 根插件 effect +1 行；合计 2 行（写明文件与位置）。
现有占位音（如 HUD 里的 blip）：在 Worker 模式下是否真的响？是否保留？

## 二、音源
A 程序合成（默认，`synth.mjs` 固定种子）/ B CC0（Kenney；Freesound 仅 CC0）。写明哪些音允许换 CC0。

## 三、清单
响度分档（峰值 dBFS / 播放音量）：技能与命中 −3 / 1.0，挥砍与冲刺 −6 / 0.8，敌方与受击 −6 / 0.8，UI −12 / 0.5。

| # | 文件 `sfx/` | 时长 | 描述（合成手法） | 触发事件 | 变体 |
|---|---|---|---|---|---|
| 1 | `slash-1` | 0.18 s | … | `attack step=1` | 3 |

不发声的事件：<列出>。防叠音：同音冷却 <x> s，每音复音上限，全局 24 声部。

## 四、写入范围
`assets/audio/**`、两行注册、`reports/audio/**`、`evidence/audio/**`。

## 五、请主控回复
1. 架构 2. 注册行数 3. 音源 4. 清单增删
