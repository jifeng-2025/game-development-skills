#!/bin/sh
# Run `forgeax project play` with a browser that survives the WorkBuddy agent sandbox.
# Engine-launched Chromium uses chromiumSandbox:true and dies with "browser.newPage: Target crashed"
# (play-not-ready / browser-capture-failed). This points FORGEAX_BROWSER_EXECUTABLE at system Chrome
# with --no-sandbox and puts a no-op `ps` first on PATH (the sandbox forbids ps).
# Must itself run OUTSIDE the agent sandbox.
#
#   play.sh <project-dir> <script.mjs> [extra forgeax args...]
#   e.g. play.sh /abs/game scripts/playthrough.mjs --require-ui
#        FIX_URL=... FIX_PROFILE=... play.sh /abs/game /abs/skill/scripts/driver.mjs --timeout-ms 1500000
# Prints the final JSON line and the log path. Do not pipe play's stdout to `head` (it kills the run).
set -u
DIR=$1; SCRIPT=$2; shift 2
CHROME=${FIX_CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
BIN=${TMPDIR:-/tmp}/fix-fxbin
mkdir -p "$BIN"
printf '#!/bin/sh\nexec "%s" --no-sandbox "$@"\n' "$CHROME" > "$BIN/chrome-nosandbox"
printf '#!/bin/sh\nexit 0\n' > "$BIN/ps"
chmod +x "$BIN/chrome-nosandbox" "$BIN/ps"
LOG=$(mktemp -t fix-play)
cd "$DIR"
PATH="$BIN:$PATH" FORGEAX_BROWSER_EXECUTABLE="$BIN/chrome-nosandbox" \
  pnpm exec forgeax project play "$SCRIPT" --json --progress false "$@" > "$LOG" 2>&1
CODE=$?
grep '^{"ok"' "$LOG" | tail -1 || tail -c 2000 "$LOG"
echo "[fix] exit=$CODE full log: $LOG"
exit $CODE
