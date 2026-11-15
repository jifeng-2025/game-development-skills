#!/bin/bash
# Build a ForgeaX game the way the demo/player sees it and serve it, without touching the main
# working tree, its dist/, or the dev server.
#
#   build-preview.sh <game-dir> <out-dir> <port> [ref]
#     ref   optional git ref: build a detached clean worktree of that commit instead of the working tree
#           (use it whenever other sessions have uncommitted edits — a source change during the build
#            fails with plugin-bootstrap-failed / package-source-changed)
#   env   FIX_HTML_HEAD   project-relative head fragment passed to --html-head (e.g. the loading page);
#                         empty = none. Set it whenever the demo uses one: preview without it is not what players see
#         FIX_SERVE=0     build only
#
# out-dir MUST be outside the repo (e.g. /tmp/fix-<name>): the agent sandbox's bulk-delete guard
# aborts the build when it cleans a previous output inside the workspace (SAFE_DELETE_BULK_CONFIRM_REQUIRED),
# and a build output inside the repo shows up in git status.
# Runs `project build` then `project preview --dist <out> --port <port>` in the foreground
# (run this script in the background; it prints the preview JSON line once serving).
set -euo pipefail
GAME=$(cd "$1" && pwd); OUT=$2; PORT=$3; REF=${4:-}
SRC=$GAME
if [ -n "$REF" ]; then
  # The worktree stays while preview serves from it; remove it after stopping preview:
  #   git -C <game> worktree remove --force /tmp/fix-wt-<ref>
  SRC=/tmp/fix-wt-$(echo "$REF" | tr -c 'a-zA-Z0-9\n' '-' | tr -d '\n')
  git -C "$GAME" worktree remove --force "$SRC" 2>/dev/null || rm -rf "$SRC"
  git -C "$GAME" worktree prune
  git -C "$GAME" worktree add -q --detach "$SRC" "$REF"
  ln -s "$GAME/node_modules" "$SRC/node_modules"
  # .gitignore's `node_modules/` does not match a symlink; without this the tree is dirty and
  # project package reads the link as a file (EISDIR).
  grep -qx '/node_modules' "$GAME/.git/info/exclude" 2>/dev/null || echo '/node_modules' >> "$GAME/.git/info/exclude"
  export FORGEAX_BUILD_CACHE_DIR=${FORGEAX_BUILD_CACHE_DIR:-$GAME/.forgeax/ddc}
  echo "[fix] building $REF from clean worktree $SRC (cache $FORGEAX_BUILD_CACHE_DIR)" >&2
fi
HEAD_FRAGMENT=${FIX_HTML_HEAD:-}
if [ -n "$HEAD_FRAGMENT" ] && [ ! -f "$SRC/$HEAD_FRAGMENT" ]; then echo "[fix] FIX_HTML_HEAD $HEAD_FRAGMENT not found in $SRC" >&2; exit 1; fi
cd "$SRC"
LOG=$(mktemp -t fix-build)
ARGS=(project build --out-dir "$OUT" --json)
[ -n "$HEAD_FRAGMENT" ] && ARGS+=(--html-head "$HEAD_FRAGMENT")
START=$(date +%s)
if ! pnpm exec forgeax "${ARGS[@]}" > "$LOG" 2>&1; then :; fi
if ! grep -q '"ok":true,"command":"project build"' "$LOG"; then
  echo "[fix] build failed after $(( $(date +%s) - START ))s; log $LOG" >&2
  grep -o '{"ok":false.*' "$LOG" | head -c 2000 >&2; echo >&2
  exit 1
fi
echo "[fix] built $OUT in $(( $(date +%s) - START ))s (head: ${HEAD_FRAGMENT:-none})" >&2
[ "${FIX_SERVE:-1}" = "0" ] && exit 0
exec pnpm exec forgeax project preview --dist "$OUT" --port "$PORT" --json
