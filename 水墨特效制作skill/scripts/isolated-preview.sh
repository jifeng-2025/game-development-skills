#!/bin/zsh
# Build + serve an isolated preview of <base commit> + the current uncommitted changes (tracked + untracked) under <paths>,
# without touching the main checkout or the shared dev owner.
#
#   isolated-preview.sh <game root> <base ref> <port> [diff paths, default assets/vfx] [extra build args...]
#   e.g. isolated-preview.sh ~/game HEAD 4813 assets/vfx --html-head boot/ink-loading.html
#
# ISO_STEP=build  → create/refresh the worktree and build, then exit (run this in the FOREGROUND, outside the sandbox:
#                    a build inside a background task fails with native-cook-failed / ECONNREFUSED sandbox-broker.sock)
# ISO_STEP=serve  → only serve the existing build (run this as the background task)
# ISO_STEP=sync   → copy the current changed + untracked files under <paths> into the existing worktree, then build
# default (all)   → build then serve in one go (only safe when the whole command runs in the foreground)
# Prints the worktree path and URL; the preview server runs in the foreground (start it as a background
# task, stop it with the task tool when done), then clean up with:
#   git -C <game root> worktree remove --force <worktree>
set -e
GAME=${1:?game root}; BASE=${2:?base ref}; PORT=${3:?port}; DIFF_PATHS=${4:-assets/vfx}; shift 4 2>/dev/null || shift $#
WT=/tmp/vfx-iso-$PORT
STEP=${ISO_STEP:-all}
SHIM=$(dirname "$0")/ps-shim.sh
source "$SHIM"
if [[ $STEP == serve ]]; then cd "$WT"; echo "url http://localhost:$PORT/"; exec pnpm exec forgeax project preview --port "$PORT" --json; fi
if [[ $STEP == sync ]]; then
  (cd "$GAME" && { git diff --name-only -- ${=DIFF_PATHS}; git ls-files --others --exclude-standard -- ${=DIFF_PATHS}; }) | while read -r f; do mkdir -p "$WT/$(dirname "$f")"; cp "$GAME/$f" "$WT/$f"; done
else
rm -rf "$WT"; git -C "$GAME" worktree prune
git -C "$GAME" worktree add --detach "$WT" "$BASE" >/dev/null
# Tracked changes (binary-safe), then untracked new files (e.g. a freshly generated texture) under the same paths.
git -C "$GAME" diff --binary -- ${=DIFF_PATHS} | (cd "$WT" && git apply --allow-empty)
(cd "$GAME" && git ls-files --others --exclude-standard -- ${=DIFF_PATHS}) | while read -r f; do mkdir -p "$WT/$(dirname "$f")"; cp "$GAME/$f" "$WT/$f"; done
ln -s "$GAME/node_modules" "$WT/node_modules"
fi
echo "worktree $WT (base $(git -C "$WT" rev-parse --short HEAD)); changed:"; git -C "$WT" status --short | grep -v node_modules || true
cd "$WT"
pnpm exec forgeax project build --json "$@" > "$WT/.build.json" 2>"$WT/.build.err" || true
python3 -c "import json,sys;d=json.load(open('$WT/.build.json'));print('build ok' if d.get('ok') else 'BUILD FAILED '+str(d.get('error'))[:400]);sys.exit(0 if d.get('ok') else 1)"
[[ $STEP == build || $STEP == sync ]] && exit 0
echo "url http://localhost:$PORT/"
exec pnpm exec forgeax project preview --port "$PORT" --json
