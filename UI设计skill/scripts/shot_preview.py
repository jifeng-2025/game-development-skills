#!/usr/bin/env python3
"""无头截取拼装预览的每个界面（URL 参数 ?s=<screen>）。

  python shot_preview.py --html <preview/index.html> --screens title,hud,boss --out <目录> [--size 1920,1080]

浏览器：优先 $CHROME，其次 Playwright 缓存里最新的 chrome-headless-shell。
必须带 --no-sandbox，否则在受限环境里不报错也没有产物。
"""
import argparse
import glob
import os
import subprocess
import sys


def find_browser():
    if os.environ.get('CHROME'):
        return os.environ['CHROME']
    caches = [os.path.expanduser('~/Library/Caches/ms-playwright'), os.path.expanduser('~/.cache/ms-playwright')]
    found = [path for root in caches for path in glob.glob(f'{root}/chromium_headless_shell-*/*/chrome-headless-shell')]
    found += [path for root in caches for path in glob.glob(f'{root}/chromium_headless_shell-*/*/headless_shell')]
    if not found:
        sys.exit('找不到无头浏览器：设置 CHROME，或运行 npx playwright install chromium-headless-shell')
    return sorted(found, key=lambda p: int(p.split('chromium_headless_shell-')[1].split('/')[0]))[-1]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--html', required=True)
    parser.add_argument('--screens', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--size', default='1920,1080')
    parser.add_argument('--budget', default='1000', help='虚拟时间毫秒数，让进场动画走完')
    args = parser.parse_args()
    browser, html = find_browser(), os.path.abspath(args.html)
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    failed = []
    for screen in args.screens.split(','):
        target = os.path.join(out, f'{screen}.png')
        subprocess.run([browser, '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--hide-scrollbars',
                        f'--window-size={args.size}', f'--virtual-time-budget={args.budget}', f'--screenshot={target}',
                        f'file://{html}?s={screen}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
        print(target, 'ok' if os.path.exists(target) else '失败')
        if not os.path.exists(target):
            failed.append(screen)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
