# 切图与剧情图提示词模板

占位符：`{MEDIUM}` 画面媒介和风格（一句话），`{MOCKUP}` 参考 mockup 文件名，`{HEX_*}` 色值。
每条都要写成完整提示词再交给生图工具，不让执行者自己拼。

## 效果图（mockup）骨架

按顺序拼接：

```text
References: <场景图> ONLY environment style and camera angle; <角色图> ONLY character style; <配色图> ONLY palette; <已有 UI 素材> ONLY the named UI element shape. Do not copy their composition or existing UI.
game UI mockup, full 1920x1080 in-game screenshot, {MEDIUM}, <镜头>, <场景>; UI language: <底材>, <字体感>, <点缀材质> used only for thin borders and small accents, <警示色> reserved strictly for <允许的位置>, everything matte with no glow, clean readable flat shapes, generous negative space, professional console game UI layout
UI DIRECTION <A|B|C> "<方向名>": <这个方向的结构，一句话>
<共用正文：这屏所有元素、数量、位置、状态、中文文案。HUD 要写：all elements small and at the screen edges, total HUD area under 8 percent; the center of the screen stays clean; keep <角落> completely empty>
<该方案追加正文：只写这个方向下元素长什么样>
Do not include: glow, bloom, lens flare, neon, gold frames with gemstones, mobile game UI, gacha UI, glossy plastic buttons, bevel-emboss buttons, sci-fi hologram, too much <警示色>, cluttered layout, tiny unreadable text, English words, watermark, photorealistic
```

三个方向的结构要明显不同，例如：面板式（材质面板 + 文字）/ 无框极简（元素直接画在画面上）/ 器物式（硬质边框 + 小装饰）。

## 共用片段

- 前缀 `SP`：`Single isolated game UI element for {MEDIUM}, style exactly matching the reference mockup, matte, no glow, crisp readable silhouette, centered with generous empty margin, nothing cut off.`
- 背景 `T`：`Transparent background (PNG with alpha). Everything outside the element is fully transparent, with no halo, shadow or gradient. If transparency is not supported, use a perfectly flat solid pure green #00FF00 background.`
- 背景 `K`：`Pure black #000000 background. The element is drawn only in white and light greys, SOLID WHITE FILL inside its shape, not an outline, monochrome, no color at all; brightness will be used as alpha.`
- 负面 `NEG`：`Do not include: any text, letters, characters, numbers, glow, bloom, lens flare, gemstones, glossy plastic, bevel or emboss, drop shadow, 3D render look, photorealism, background scenery, multiple copies, cropped edges.`
- 参考说明：`Reference image: {MOCKUP}. Use it ONLY for <哪个元素的哪一点>; do not copy text, scene or anything else.`

K 类元素的正文里**不要写主体是 ink / black / dark，也不要写 dense core**，一律写 white shape。之前用这些词时，生成的图中心发黑、只有边缘亮。这个改法是推断，还没实测；出现中心发黑时仍用 spec 的 `fill` 修。

## 元素模板（SP + 正文 + 背景 + NEG）

| 元素 | 背景 | 正文 |
|---|---|---|
| 大主视觉笔触 | T | `One huge diagonal {stroke type} rising from lower left to upper right at about 15 degrees, heavy blunt start, long tapering tail, spans about 90 percent of the canvas width.` |
| 印章 / 徽记 | T | `One {square/round} stamp impression in matte {HEX_ALERT}, slightly irregular border, uneven pressure with tiny gaps, the inside is a plain solid field with NO characters at all, flat front view.` |
| 按钮常态 | K | `One soft horizontal white wash stroke used as an unselected button backing, even in the middle, about 5 times wider than tall, both ends fade out softly.` |
| 按钮选中 | K | `One bold perfectly horizontal stroke, solid white core, rough top and bottom edges, heavy start on the left, tapering tail on the right, about 5 times wider than tall.` |
| 血条底槽 | K | `One long thin perfectly horizontal stroke used as an empty bar track, about 12 times wider than tall, even height, frayed tapered ends.` |
| 血条填充 | K | `One long perfectly horizontal solid stroke used as a bar fill, about 16 times wider than tall, uniform height, flat clean cut on the left, slightly tapered on the right.` |
| 资源格 空 | K | `One single empty slot icon: {shape} drawn with one thin confident outline, hollow inside.`（这一项例外：要空心，去掉背景 K 里的 SOLID WHITE FILL） |
| 资源格 满 | T | `One single full slot icon: {shape} filled with {HEX_DARK}, a thin {HEX_LIGHT} outline around it so it reads on a dark background.` |
| 技能圆框 | T | `One round skill icon frame: {ring style} around a dark disc, the center left empty for an icon placed on top, perfectly round overall, front view.` 负面加 `icon symbols inside the ring` |
| 冷却遮罩 | K | `One solid filled round white disc, flat even fill, perfectly round, edge slightly rough, no ring and no gap.` |
| 角标 | T | 同印章，改小尺寸的圆形 |
| 按键底标 | T | `One small horizontal key-label tag made of {material} ({HEX_ACCENT}), rounded rectangle about 2 times wider than tall, flat matte, the face left empty, front view.` 负面加 `{alert color name}` |
| Boss 血条框 | K | `One very long horizontal frame: a thin rough line border forming a hollow bar about 20 times wider than tall, one short heavy vertical cap at each end, inside completely empty.`（空心，同资源格 空） |
| 名牌底 | K | `One wide horizontal band about 10 times wider than tall, solid in the middle, both ends breaking up and fading out.` |
| 字幕条底 | K | `One very wide soft horizontal white strip about 14 times wider than tall, even in the middle 60 percent, fading smoothly to nothing at both ends, softly feathered edges, no hard outline.` |
| 卡框 | T | `One tall empty vertical card frame, about 2 by 3: {frame material}, a socket at the top center for an emblem, inner panel plain and clean.` 负面加 `icons, pictures inside the card, {alert color name}` |
| 分类色条 | K | `One bold horizontal swash about 7 times wider than tall, solid core, rough edges, both ends breaking into streaks.` |
| 转场晕染 | K | `One large soft round shape spreading outward from the center, SOLID WHITE center with no hole, irregular feathered edges with fine bleeding tendrils, fills about 80 percent of the square canvas.` |
| 全屏四角暗角 | K | `A full-frame vignette: the four corners solid white, white spreading inward along all four edges with uneven feathered fingers, thicker at the corners; the central 60 percent completely black and empty. Fill the whole canvas edge to edge.`（要贴边，负面去掉 cropped edges） |
| 纸 / 面板卡 | T | `One rectangular sheet of {material} ({HEX_LIGHT}), slightly taller than wide, irregular edges, subtle texture, flat even lighting, the center area clean and empty for text.` |

## 立绘

```text
References: <角色设定图> ONLY for the character's outfit, colors and proportions (keep them identical); <画风图> ONLY for the rendering style; <配色图> ONLY for the palette. Do not copy their poses, scenes or UI.
Stylized game character portrait for dialogue boxes, {MEDIUM}, not realistic.
Half-body portrait of <角色>, three-quarter view FACING <RIGHT|LEFT>, <逐条列出标志特征>. The figure fills about 85 percent of the frame height; the head and tall props are fully inside the frame with margin on every side.
Plain flat solid medium grey background (#808080), no shadow, no gradient, no ground, no scenery.
Do not include: photorealistic, 3D render look, glossy highlights, glow, <已废弃的设定>, text, letters, watermark, frame, border, cropped head.
```

## 剧情插画

先写清**镜头站在哪一侧**，再写人物动作。「走出门」只写动作会被画成任意方向，要写成：`The camera stands INSIDE <地点>, looking OUT through <门洞>; in the middle distance <人物> seen from behind is walking AWAY from <地点>.`
预留字幕位置：`Large calm dark negative space in the upper part of the frame for subtitle text.`
