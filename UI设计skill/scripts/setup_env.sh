#!/bin/sh
# 创建图像处理用的 Python 环境。放在 ~/.cache，不放 /tmp（/tmp 可能隔天被清掉）。
# 用法：sh setup_env.sh  → 最后一行打印 python 路径，后续命令都用它
VENV="${UI_VENV:-$HOME/.cache/game-ui-skin/venv}"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/python" -c "import PIL, numpy, scipy" 2>/dev/null || "$VENV/bin/pip" install -q pillow numpy scipy 1>&2
"$VENV/bin/python" -c "from PIL import features; assert features.check('webp')" || { echo "Pillow 缺少 WebP 支持" >&2; exit 1; }
echo "$VENV/bin/python"
