#!/bin/bash
# Type-check (and optionally test) EVERY commit in a range, each in a throwaway worktree, so a split commit that
# only compiles together with its neighbours is caught before it is reported or pushed.
#
#   check-commits.sh <game-dir> <base-ref> [head-ref=HEAD]
#     checks every commit in base..head (base itself excluded), oldest first
#   env  FIX_CHECK_CMD   command run in each worktree (default: pnpm exec tsc --noEmit)
#        e.g. FIX_CHECK_CMD="pnpm exec tsc --noEmit && pnpm test"   (tests take minutes per commit)
#
# Why: stage-hunks.py stages context-free (-U0) hunks; combined with `git stash push --keep-index` / `stash pop`
# round-trips this has inserted the same declaration twice and overwritten a renamed file. The final working
# tree compiled, one intermediate commit did not. Checking only HEAD does not catch it.
# Exit 1 and print the failing commits; fix with `git commit --amend` (last commit) or an interactive-free
# rebuild of the series (git reset --soft <base>, re-commit item by item) — never ship a red intermediate commit.
set -uo pipefail
GAME=$(cd "$1" && pwd); BASE=$2; HEAD_REF=${3:-HEAD}
CMD=${FIX_CHECK_CMD:-pnpm exec tsc --noEmit}
WT=/tmp/fix-check-commits
git -C "$GAME" worktree remove --force "$WT" 2>/dev/null || rm -rf "$WT"
git -C "$GAME" worktree prune
COMMITS=$(git -C "$GAME" rev-list --reverse "$BASE..$HEAD_REF")
[ -n "$COMMITS" ] || { echo "[fix] no commits in $BASE..$HEAD_REF" >&2; exit 0; }
FIRST=$(echo "$COMMITS" | head -1)
git -C "$GAME" worktree add -q --detach "$WT" "$FIRST"
trap 'git -C "$GAME" worktree remove --force "$WT" 2>/dev/null || true' EXIT
ln -s "$GAME/node_modules" "$WT/node_modules"
grep -qx '/node_modules' "$GAME/.git/info/exclude" 2>/dev/null || echo '/node_modules' >> "$GAME/.git/info/exclude"
FAILED=()
for c in $COMMITS; do
  git -C "$WT" checkout -q --detach "$c"
  LOG=$(mktemp -t fix-check)
  if (cd "$WT" && bash -c "$CMD") > "$LOG" 2>&1; then
    echo "ok   $(git -C "$GAME" log --oneline -1 "$c" | cut -c1-100)"
  else
    echo "FAIL $(git -C "$GAME" log --oneline -1 "$c" | cut -c1-100)"
    grep -m5 -E "error TS|FAIL|Error" "$LOG" | sed 's/^/     /'
    echo "     full log: $LOG"
    FAILED+=("$c")
  fi
done
[ ${#FAILED[@]} -eq 0 ] || { echo "[fix] ${#FAILED[@]} commit(s) fail: ${FAILED[*]}" >&2; exit 1; }
