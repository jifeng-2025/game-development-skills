#!/bin/sh
# Export the commit under test into an isolated dir, build it, and (optionally) serve it.
# Never builds in the shared working tree, never touches other sessions' ports or processes.
#
#   [QA_HEAD_MARK=<text>] export-build.sh <game-repo> <commit|HEAD> <out-dir> [html-head-file] [preview-port]
#   e.g. export-build.sh ~/Desktop/1/inkblade 37955da /tmp/qa/sut boot/ink-loading.html 4841
#
# - preview runs in the FOREGROUND when a port is given: start this with your tool's background mode,
#   and stop it yourself when done (only the process you started).
# - node_modules is symlinked from the repo (pnpm store lives inside it), so no install is needed.
set -eu
REPO=$1; REF=$2; OUT=$3; HEAD_FILE=${4:-}; PORT=${5:-}
SHA=$(git -C "$REPO" rev-parse --short "$REF")
echo "[qa] repo=$REPO ref=$REF sha=$SHA out=$OUT"
git -C "$REPO" status --short | sed 's/^/[qa] dirty: /' || true
rm -rf "$OUT"; mkdir -p "$OUT"
git -C "$REPO" archive "$SHA" | tar -x -C "$OUT"
ln -s "$REPO/node_modules" "$OUT/node_modules"
echo "$SHA" > "$OUT/.qa-commit"
cd "$OUT"
if [ -n "$HEAD_FILE" ]; then
  pnpm exec forgeax project build --html-head "$HEAD_FILE" --json | grep '^{"ok"' || { echo "[qa] build failed"; exit 1; }
else
  pnpm exec forgeax project build --json | grep '^{"ok"' || { echo "[qa] build failed"; exit 1; }
fi
if [ -n "${QA_HEAD_MARK:-}" ]; then
  # e.g. QA_HEAD_MARK=墨研中 : proves the loading page fragment really made it into the built page
  grep -q "$QA_HEAD_MARK" dist/index.html && echo "[qa] html-head marker present: $QA_HEAD_MARK" || echo "[qa] WARNING html-head marker NOT found: $QA_HEAD_MARK"
fi
if [ -n "$PORT" ]; then
  echo "[qa] preview on http://localhost:$PORT/ (commit $SHA)"
  exec pnpm exec forgeax project preview --port "$PORT" --json
fi
