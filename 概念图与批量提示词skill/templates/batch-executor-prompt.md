# 给生图执行者（Codex 等）的批量指令模板

把 `<...>` 换掉后整段贴给生图执行者。它没看过你的对话，所有路径和规则都要写在里面。

```
你是《<游戏名>》的生图执行者。只做下面列出的图，不碰其他文件。
生图用你能用的最高质量模型；无法选择或查询模型名时，就在日志里如实写「模型未知」，不要编造。

## 依据
ROOT = <项目根>
SPEC = $ROOT/assets/concepts/PROMPTS.md
先完整读 SPEC。每张图的画幅、背景、文件名、正文、负面以 SPEC 为准，不要自己改设计。

## 开工前检查
1. 确认风格参考图存在：<路径列表>。不存在就停止并回报，不生成任何图。
2. 列出 $ROOT/assets/concepts/ 下已有文件，已存在的不重复生成。

## 本次任务（按顺序）
<只列编号，例如：SPEC §3 的 E1–E6、C1–C3；或「只生成 §3.1.1 一张，生成后停下」>

## 提示词组装（用英文）
(1) 参考说明：「Use the attached reference image(s) only for style: <笔触、配色、材质>. Do not copy their composition or background.」
    角色视图另加：「Keep the character's outfit, colors and proportions identical to the attached character reference.」
(2) SPEC §1 对应风格前缀，整段照抄
(3) 该行正文
(4) SPEC §2 对应背景块
(5) 画幅：「Aspect ratio <x:y>.」
(6) 负面改写为一句「Do not include: …」= §1.3 + 该行追加 + 背景块负面。<例外：预警/危招图删掉 large red areas>

## 参考图规则
- 每张都附风格参考图 <路径>。
- 角色的 side / back / threequarter 额外附同一角色已生成的 front 和设定板。
- 3D 参考图必须：纯灰底、无投影、全身入画、A 字姿势、四肢分开、武器不遮挡躯干。

## 保存
- 路径 $ROOT/assets/concepts/<asset-id>/<asset-id>__<view>__v<NN>.png；同名存在就版本号 +1，绝不覆盖。
- 保存 PNG，不缩放、不裁剪、不调色；用 `sips -g pixelWidth -g pixelHeight` 记录实际尺寸。
- 每张旁边写同名 .prompt.txt：最终提示词全文、参考图路径、实际模型名、生成时间、尺寸。

## 自查（只看这些）
- 视角对不对（背面看不到脸和前襟；侧面是纯侧面；plan 是正上方没有透视）
- 有没有文字、水印
- 禁用颜色是否只出现在允许的地方
- 3D 参考图背景是否纯灰、无投影、完整入画
以下不算问题，不要因此重生：尺寸低于规格（工具上限）、画幅与规格略有出入、纯侧面时双腿前后重叠。
<本轮是否允许自动重生：「疑似问题也不要重生，最后统一审图」或「明显不合格重生一次，同一张最多 2 次，旧版本保留」>

## 写入边界
- 只在 $ROOT/assets/concepts/ 下新建图片和 .prompt.txt。
- PROMPTS.md 只改 §4 勾选清单（打勾、填模型名、写自查；重生在对应行下方追加一行）。
- 不删除、不移动任何已有文件。

## 汇报
一张表：路径、尺寸、版本、自查结果、问题说明。不要自评风格是否统一。
```
