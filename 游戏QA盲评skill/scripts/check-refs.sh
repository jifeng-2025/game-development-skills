#!/bin/sh
# Check that every evidence path quoted in a QA report exists (relative to the evidence dir).
#   check-refs.sh <report.md> <evidence-dir>
# Matches `dir/file.png|jpg|json` in backticks. Exit 1 if anything is missing.
REPORT=$1; EV=$2; MISS=0
cd "$EV" || exit 1
for f in $(grep -oE '`[A-Za-z0-9._-]+/[^`*{ ]+\.(png|jpg|json)`' "$REPORT" | tr -d '`' | sort -u); do
  [ -e "$f" ] || { echo "MISSING $f"; MISS=1; }
done
[ $MISS = 0 ] && echo "all referenced evidence exists"
exit $MISS
