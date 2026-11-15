"""混元 3D 多视图生成：提交 / 查询 / 下载（调用 WorkBuddy 内置 buddy-multimodal-generation 技能脚本）。

为什么要这个包装：4 张图的 base64 超过命令行长度上限（zsh: argument list too long），
所以在 Python 进程内用 runpy 调技能脚本，把参数放进 sys.argv。

输入目录约定（JPG，128~5000 px，单张 ≤6 MB）：
    <in>/front.jpg   主图（必需）
    <in>/right.jpg   侧视（角色朝画面右 = 角色左侧身；接口只认 back/left/right）
    <in>/back.jpg    背视
    <in>/left.jpg    可选
  ⚠ 不支持 right_front / left_front（3/4 视角），传了会报 GENERATION_FAILED（不扣分）。

用法：
  # 1) 先在会话里调用 connect_cloud_service 拿到 clientTempToken（约 15 分钟过期，过期就重新拿）
  python3 hunyuan_3d.py submit --in <in_dir> --out <out_dir> --token <ck_t_...> [--normal] [--face-count N]
      → 写 <out>/submit.json，打印 job_id，不阻塞
  python3 hunyuan_3d.py poll --out <out_dir> --job <job_id> --token <ck_t_...> [--max-wait 540]
      → 每 10 s 查一次，DONE 后下载 raw.glb、raw_preview.png，写 status.json（含 ResultCreditConsumed）
  同一任务只 poll，不要重复 submit（会重复扣分）。token 过期就重新拿 token 继续 poll 原 job。
"""
import argparse, base64, json, os, runpy, subprocess, sys, time, urllib.request

DEFAULT_SKILL = ('/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/resources/plugins/'
                 'workbuddy-builtin/skills/buddy-multimodal-generation/scripts/buddy-multimodal-generation.py')
SKILL = os.environ.get('HUNYUAN_SKILL_SCRIPT', DEFAULT_SKILL)


def submit(a):
    mv = []
    for v in ('right', 'back', 'left'):
        p = os.path.join(a.indir, v + '.jpg')
        if os.path.exists(p):
            mv.append({'ViewType': v, 'ViewImageBase64': base64.b64encode(open(p, 'rb').read()).decode()})
    fb = base64.b64encode(open(os.path.join(a.indir, 'front.jpg'), 'rb').read()).decode()
    argv = [SKILL, '3d', '--image-base64', fb, '--multi-view', json.dumps(mv), '--token', a.token, '--no-poll']
    if a.normal:
        argv += ['--model', '3.1']                       # Normal：3.1 质量更好，不支持 LowPoly
    else:
        argv += ['--model', '3.0', '--generate-type', 'LowPoly']
    if a.face_count:
        argv += ['--face-count', str(a.face_count)]      # 额外 +10 积分
    os.makedirs(a.out, exist_ok=True)
    out_path = os.path.join(a.out, 'submit.json')
    sys.argv = argv
    real = sys.stdout
    with open(out_path, 'w') as f:
        sys.stdout = f
        try:
            runpy.run_path(SKILL, run_name='__main__')
        except SystemExit:
            pass
        finally:
            sys.stdout = real
    txt = open(out_path).read()
    print(txt[-600:])


def poll(a):
    os.makedirs(a.out, exist_ok=True)
    st_path = os.path.join(a.out, 'status.json')
    t0 = time.time()
    while True:
        r = subprocess.run([sys.executable, SKILL, 'status', a.job, '--type', '3d', '--token', a.token],
                           capture_output=True, text=True)
        open(st_path, 'w').write(r.stdout)
        try:
            d = json.loads(r.stdout)
        except Exception:
            print('status 输出无法解析：', r.stdout[-400:], r.stderr[-400:]); return 2
        if d.get('status') in ('DONE', 'FAIL') or time.time() - t0 > a.max_wait:
            break
        time.sleep(10)
    raw = d.get('raw_result', {})
    print(d.get('status'), 'credits', raw.get('ResultCreditConsumed'), raw.get('ErrorMessage'))
    for f in raw.get('ResultFile3Ds', []):
        if f.get('Type', '').upper() == 'GLB':
            urllib.request.urlretrieve(f['Url'], os.path.join(a.out, 'raw.glb')); print('downloaded raw.glb')
        if f.get('PreviewImageUrl'):
            urllib.request.urlretrieve(f['PreviewImageUrl'], os.path.join(a.out, 'raw_preview.png'))
    return 0 if d.get('status') == 'DONE' else 1


ap = argparse.ArgumentParser()
sub = ap.add_subparsers(dest='cmd', required=True)
s1 = sub.add_parser('submit'); s1.add_argument('--in', dest='indir', required=True); s1.add_argument('--out', required=True)
s1.add_argument('--token', required=True); s1.add_argument('--normal', action='store_true'); s1.add_argument('--face-count', type=int)
s2 = sub.add_parser('poll'); s2.add_argument('--out', required=True); s2.add_argument('--job', required=True)
s2.add_argument('--token', required=True); s2.add_argument('--max-wait', type=int, default=540)
a = ap.parse_args()
sys.exit(submit(a) if a.cmd == 'submit' else poll(a))
