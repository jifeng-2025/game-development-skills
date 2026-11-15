#!/bin/zsh
# Deterministic VFX preview screenshot on the shared dev owner (never starts/stops it).
#
#   GAME=<project root> PREVIEW_MODULE=<abs path to preview.ts> \
#   [PLAYER_NAME=Player] [YAW_DEG=38] [SHIFT=0] [HIDE_SELECTOR='[id^="ui-"]'] [POST=off] \
#   [POST_OFF_JS='globalThis.__inkSet?.(false)'] [POST_ON_JS='globalThis.__inkSet?.(true)'] \
#   capture-preview.sh <scenario> <freezeAt seconds> <out.png> [extra preview opts as JSON, e.g. '{"hex":"ink"}']
#
# preview.ts must export: preview(simulation, {scenario, freezeAt, player, ...extra}) and stopPreview().
# - Waits for phase=ready, reads the live player position with `dev find`, places the scenario around it.
# - SHIFT moves the whole scenario SHIFT world units toward the bottom of the screen (negative = up),
#   to clear a centred dialog box or title text. YAW_DEG = camera yaw on the ground plane.
# - Page realm (engine workers off): hides HIDE_SELECTOR layers during the shot and restores them.
#   Engine Worker realm: there is no `document`; HUD stays (use SHIFT).
# - POST=off is for diagnosis only: runs POST_OFF_JS before and POST_ON_JS after (always restored).
set -e
: ${GAME:?set GAME} ${PREVIEW_MODULE:?set PREVIEW_MODULE}
PLAYER_NAME=${PLAYER_NAME:-Player}; YAW_DEG=${YAW_DEG:-38}; SHIFT=${SHIFT:-0}
HIDE_SELECTOR=${HIDE_SELECTOR:-'[id^="ui-"]'}
POST_OFF_JS=${POST_OFF_JS:-'globalThis.__inkSet?.(false)'}; POST_ON_JS=${POST_ON_JS:-'globalThis.__inkSet?.(true)'}
SCEN=$1; FREEZE=$2; OUT=$3; EXTRA=${4:-'{}'}
cd "$GAME"
MOD="/@fs${PREVIEW_MODULE}"
st() { pnpm exec forgeax dev status --json | python3 -c "import json,sys;print(json.load(sys.stdin)['value'].get('$1',''))"; }
for i in {1..60}; do [[ $(st phase) == ready ]] && break; sleep 5; done
[[ $(st phase) == ready ]] || { echo "dev owner not ready" >&2; exit 1; }
R=$(st revision)
POS=$(pnpm exec forgeax dev find --json --name "$PLAYER_NAME" --limit 10 | PLAYER_NAME=$PLAYER_NAME SHIFT=$SHIFT YAW_DEG=$YAW_DEG python3 -c '
import json,sys,math,os
m=[x for x in json.load(sys.stdin)["value"]["matches"] if x["name"]==os.environ["PLAYER_NAME"]]
p=m[0]["position"] if m else [0,0,0]
d=float(os.environ["SHIFT"]); y=float(os.environ["YAW_DEG"])*math.pi/180
print("[%.3f,0.8,%.3f]"%(p[0]-math.sin(y)*d,p[2]+math.cos(y)*d))')
POSTFLAG=${POST:-on}
pnpm exec forgeax dev eval --json --revision "$R" --code "
const m=await import('$MOD');
if('$POSTFLAG'==='off'){ $POST_OFF_JS; }
let hidden=[];
if(typeof document!=='undefined'){
  const box=[...document.querySelectorAll('$HIDE_SELECTOR')].filter(d=>!d.querySelector('canvas'));
  hidden=box.filter(d=>!box.some(o=>o!==d&&o.contains(d))&&getComputedStyle(d).visibility!=='hidden');
  for(const d of hidden){d.dataset.vfxHidden='1';d.style.visibility='hidden';}
}
const r=await m.preview(simulation,{scenario:'$SCEN',freezeAt:$FREEZE,player:$POS,...$EXTRA});
await new Promise(res=>setTimeout(res,$FREEZE*1000+900));
return {...r,player:$POS,hiddenOverlays:hidden.length};" | head -c 400; echo
pnpm exec forgeax dev capture --json --output "$OUT" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("capture",d["ok"],d.get("value",{}).get("frameId"),d.get("value",{}).get("errors"))'
pnpm exec forgeax dev eval --json --revision "$R" --code "
const m=await import('$MOD'); m.stopPreview(); if('$POSTFLAG'==='off'){ $POST_ON_JS; }
if(typeof document!=='undefined') for(const d of document.querySelectorAll('[data-vfx-hidden]')){d.style.visibility='';delete d.dataset.vfxHidden;}
return 'restored';" | head -c 200; echo
