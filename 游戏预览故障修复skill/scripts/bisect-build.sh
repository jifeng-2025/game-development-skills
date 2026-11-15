#!/bin/bash
# Bisection build: apply one experimental change in a throwaway worktree, build it, never touch the
# main working tree (other sessions see the main tree; a half-edited file there poisons their work).
#
#   bisect-build.sh <game-dir> <name> <ref> <change> [port]
#     change  either a patch file (applied with git apply), or a shell command run inside the worktree,
#             e.g.  "perl -pi -e 's{^(\s*)(.*plugin/vfx.*)}{\$1// BISECT \$2}' assets/world/world.pack.ts"
#             (use perl, not `sed -i`: macOS may resolve sed to GNU sed, where `-i ''` means something else;
#              the script stops if the change leaves the tree unchanged)
#     port    if given, serve the build there (foreground; run the script in the background)
#   out:    /tmp/fix-bisect-<name>   (dist; fixed /tmp, not $TMPDIR, so reports can name it)  and the worktree is removed afterwards
#
# Typical axes (one change per build, keep the rest equal to the failing build):
#   - drop one plugin from the root's children list           (which plugin triggers it)
#   - revert one asset folder / meta to its previous commit:   git checkout <old> -- assets/art/<dir>
#   - stub one call (e.g. a per-frame update) in a plugin you are not allowed to commit to
set -euo pipefail
GAME=$(cd "$1" && pwd); NAME=$2; REF=$3; CHANGE=$4; PORT=${5:-}
WT=${TMPDIR:-/tmp}/fix-bisect-wt-$NAME
OUT=/tmp/fix-bisect-$NAME
git -C "$GAME" worktree remove --force "$WT" 2>/dev/null || rm -rf "$WT"
git -C "$GAME" worktree prune
git -C "$GAME" worktree add -q --detach "$WT" "$REF"
trap 'git -C "$GAME" worktree remove --force "$WT" 2>/dev/null || true' EXIT
ln -s "$GAME/node_modules" "$WT/node_modules"
grep -qx '/node_modules' "$GAME/.git/info/exclude" 2>/dev/null || echo '/node_modules' >> "$GAME/.git/info/exclude"
cd "$WT"
if [ -f "$CHANGE" ]; then git apply "$CHANGE"; else bash -c "$CHANGE"; fi
echo "[fix] variant $NAME diff:" >&2; git diff --stat >&2
[ -n "$(git diff --name-only)" ] || { echo "[fix] the change did not modify any file" >&2; exit 1; }
git diff > "${OUT}.patch"
FIX_SERVE=0 FORGEAX_BUILD_CACHE_DIR=${FORGEAX_BUILD_CACHE_DIR:-$GAME/.forgeax/ddc} \
  "$(dirname "$0")/build-preview.sh" "$WT" "$OUT" 0
cd "$GAME"
git worktree remove --force "$WT"   # explicit: `exec` below skips the EXIT trap
echo "[fix] variant $NAME built at $OUT (patch ${OUT}.patch)" >&2
[ -z "$PORT" ] && exit 0
exec pnpm exec forgeax project preview --dist "$OUT" --port "$PORT" --json
