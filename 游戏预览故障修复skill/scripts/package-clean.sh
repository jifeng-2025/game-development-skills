#!/bin/bash
# Package the web-zip from a CLEAN copy of one commit, so other sessions' uncommitted edits can neither
# leak into the release nor abort it (package-source-changed: the source identity is hashed before and
# after packaging).
#
#   package-clean.sh <game-dir> [ref=HEAD] [output=release/<id>-web.zip] [format=web-zip]
#
# Prints archive bytes / sha256 / source commit / dirty flag; fails unless dirty=false.
# Note: project package rebuilds on its own and has NO --html-head; a loading-page fragment applied with
# `build --html-head` is not in the zip. Say so in the demo docs instead of patching dist.
set -euo pipefail
GAME=$(cd "$1" && pwd); REF=${2:-HEAD}; OUTPUT=${3:-}; FORMAT=${4:-web-zip}
WT=${TMPDIR:-/tmp}/fix-pkg-wt
git -C "$GAME" worktree remove --force "$WT" 2>/dev/null || rm -rf "$WT"
git -C "$GAME" worktree prune
git -C "$GAME" worktree add -q --detach "$WT" "$REF"
ln -s "$GAME/node_modules" "$WT/node_modules"
grep -qx '/node_modules' "$GAME/.git/info/exclude" 2>/dev/null || echo '/node_modules' >> "$GAME/.git/info/exclude"
[ -z "$(git -C "$WT" status --porcelain)" ] || { echo "[fix] worktree not clean:" >&2; git -C "$WT" status --short >&2; exit 1; }
ARGS=(project package --format "$FORMAT" --json)
if [ -n "$OUTPUT" ]; then
  case "$OUTPUT" in /*) ;; *) OUTPUT="$GAME/$OUTPUT" ;; esac   # relative paths are relative to the game, not the worktree
  ARGS+=(--output "$OUTPUT")
fi
LOG=$(mktemp -t fix-pkg)
cd "$WT"
FORGEAX_BUILD_CACHE_DIR=${FORGEAX_BUILD_CACHE_DIR:-$GAME/.forgeax/ddc} pnpm exec forgeax "${ARGS[@]}" > "$LOG" 2>&1 || true
cd "$GAME"
git worktree remove --force "$WT"
python3 - "$LOG" <<'EOF'
import json, re, sys
text = open(sys.argv[1]).read()
line = next((l for l in reversed(text.splitlines()) if l.startswith('{"ok"')), None)
if not line:
    print(text[-2000:]); sys.exit(1)
doc = json.loads(line)
if not doc.get('ok'):
    print(json.dumps(doc.get('error'), ensure_ascii=False)[:2000]); sys.exit(1)
v = doc['value']; src = v.get('source', {})
print(json.dumps({'archive': v['archive']['path'], 'bytes': v['archive']['bytes'], 'sha256': v['archive']['sha256'],
                  'commit': src.get('commit'), 'dirty': src.get('dirty'), 'files': v.get('files')}, indent=1))
sys.exit(0 if src.get('dirty') is False else 1)
EOF
