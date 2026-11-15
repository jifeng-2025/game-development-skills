# PROMPTS.md · <游戏名> 生图清单（v<N>）

- 版本：v<N>（<日期>，<维护者>）。旧版归档到 `_archive/PROMPTS_v<N-1>.md`，旧图在 `_archive/`。
- **画风（已定）**：<一句话：场景怎么画 / 角色道具怎么画 / 特效怎么画>
- **风格参考图（每张都要附上）**：
  - 场景：`<锚点或画风标准图路径>`
  - 角色和道具：`<路径>`
  - 配色：`<路径>`
- **已确认的设定**：<会影响画面的设定，例如武器形态、血的表现、禁用颜色>

---

## A. 设计目标与审美原则（与生图工具无关）

- **设计目标**：<一句话>。画面要让玩家一眼看清：<主角在哪 / 危险在哪 / 往哪打>。
- **元素 → 表达功能**（只写本作用到的）：

| 元素 | 表达功能 | 本作用法 |
|---|---|---|
| <低饱和> | <…> | <…> |

- **拒绝的俗套**：<列出该题材 AI 最爱反复生成的元素>，写进 §1.3 负面词。
- **可控差异（签名设计）**：每个主要资产 1–2 个，写清楚表达什么、怎么控制。
- **判断顺序**：设计目标 → 可读性 → 签名设计 → 俗套 → 好看。

---

## 0. 批量生成规则（生图执行者必读）

1. 按 §3 表格**从上到下**生成，每行 1 张。提示词 = 风格前缀（§1）+ 该行正文 + 背景块（§2）+「Do not include: …」（§1.3 + 该行追加）。
2. 保存到 `assets/concepts/<asset-id>/<asset-id>__<view>__v01.png`。**同名已存在就把版本号 +1，不覆盖。** 每张旁边写同名 `.prompt.txt`（完整提示词、参考图路径、实际模型名、尺寸、时间）。
3. 每生成一张就在 §4 打勾并写自查（通过 / 疑似问题 + 一句话）。**疑似问题也不要重生**，继续往下，最后交给审图。
4. 画幅按表格要求，做不到就取最接近的比例；不裁剪、不调色、不缩放。尺寸低于规格不算问题。
5. 全部生成完停下，输出汇总表：文件名、尺寸、自查结果。
6. 只写 `assets/concepts/` 下的新图和 `.prompt.txt`，PROMPTS.md 只改 §4。

**view 取值**：`front`、`side`（纯 90° 侧面，朝画面右）、`back`、`threequarter`、`topdown`（游戏相机斜俯视）、`plan`（正上方正交平面图）、`sheet`（合图 / 设定板）、`tile`（四边无缝贴图）、`seq`（序列帧网格）。

---

## 1. 风格前缀（英文，整段照抄）

### 1.1 S-SCENE（地面、墙面、背景）
> <…>

### 1.2 S-CHAR（角色、道具参考）
> <…>

### 1.3 共用负面（改写为 Do not include）
> photorealistic, photograph, fine noisy detail, text, chinese characters, letters, watermark, signature, logo, frame, border, oversaturated colors, <题材俗套>, <禁用颜色相关>

### 1.4 S-VFX（特效贴图）
> game VFX texture, pure white <brush> element on pure black background, high contrast, brightness will be used as alpha, single element centered with margin, nothing cut off

---

## 2. 背景块

| 代号 | 内容 |
|---|---|
| BG-3D | plain flat medium grey background (#808080), no shadow, no ground, orthographic, no perspective distortion, even flat lighting, full subject with margin |
| BG-PLAN | straight top-down orthographic view, flat even lighting, no cast shadows, fills the whole square image edge to edge |
| BG-TILE | straight top-down orthographic, flat lighting, seamless tileable on all four edges, evenly distributed, no focal point |
| BG-VFX | pure black background (#000000), white only, monochrome |
| BG-UI | plain flat white background (#FFFFFF), centered, margin, no shadow |

---

## 3. 批量清单

| # | asset-id / view | 进游戏方式 | 画幅 | 背景 | 正文（英文） | 追加负面 |
|---|---|---|---|---|---|---|
| E1 | `env-...` / `plan` | 直接贴图 | 1:1 ≥2048² | BG-PLAN | <…> | perspective, horizon, rain streaks, … |
| C1 | `char-...` / `sheet` | 3D 参考 | 16:9 | BG-3D | <…> | … |
| V1 | `vfx-...` / `front` | 特效 | 2:1 | BG-VFX | <…> | … |
| U1 | `ui-...` / `front` | UI | 16:9 | BG-UI | <…> | … |

---

## 4. 勾选清单

| # | 文件 | 已生成 | 模型 | 自查 |
|---|---|---|---|---|
| E1 | `env-.../env-...__plan__v01.png` | [ ] | | |

### 定向重生
| # | 文件 | 已生成 | 模型 | 自查 |
|---|---|---|---|---|

## 5. 保留的现有图（不用重生）

| 用途 | 文件 |
|---|---|
| 3D 生成：<角色> | front / side / back 的具体版本 |
| 画面验收标准 | <路径> |
