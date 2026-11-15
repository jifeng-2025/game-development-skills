#!/bin/sh
# Wait for another session's pending work to land before fixing the version under test.
# Exits as soon as HEAD moves OR the watched path has no tracked modifications; otherwise polls
# every 60 s up to MAX minutes. Run with your tool's background mode; read the last lines.
#
#   wait-for-commit.sh <game-repo> [watched-path=.] [max-minutes=150]
set -u
REPO=$1; WATCH=${2:-.}; MAX=${3:-150}
START=$(git -C "$REPO" rev-parse HEAD)
i=0
while [ "$i" -lt "$MAX" ]; do
  H=$(git -C "$REPO" rev-parse HEAD)
  D=$(git -C "$REPO" status --short -- "$WATCH" | grep -v '^??' | wc -l | tr -d ' ')
  if [ "$H" != "$START" ] || [ "$D" = "0" ]; then
    echo "[qa] settled at $(date '+%F %T') HEAD=$H dirty($WATCH)=$D"
    git -C "$REPO" log -3 --format='%h %ad %s' --date=iso
    git -C "$REPO" status --short
    exit 0
  fi
  sleep 60; i=$((i + 1))
done
echo "[qa] TIMEOUT $(date '+%F %T') — still dirty; test HEAD as-is and say so in the report"
git -C "$REPO" log -3 --oneline; git -C "$REPO" status --short
exit 2
