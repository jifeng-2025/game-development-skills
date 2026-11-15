#!/bin/sh
# Run a `forgeax project play` script with a browser that works inside the WorkBuddy sandbox.
# Engine-launched Chromium uses chromiumSandbox:true and dies with "browser.newPage: Target crashed";
# we point FORGEAX_BROWSER_EXECUTABLE at the system Chrome with --no-sandbox and put a no-op `ps`
# first on PATH (the sandbox forbids ps, which some forgeax commands spawn).
# The command itself must run OUTSIDE the agent sandbox (it needs a GPU-capable browser).
# Long runs: start this with the tool's BACKGROUND mode. A foreground call can be cut at the tool timeout
# (exit 137) while the play keeps running; the port check below stops you from starting a second one.
#
#   play.sh <built-project-dir> <script.mjs> [extra forgeax args...]
#   e.g. QA_PROFILE=... QA_URL=http://localhost:4841/ QA_MODE=hold QA_RUNS=3 \
#        play.sh /tmp/qa/sut /abs/scripts/qa-run.mjs --port 4842 --timeout-ms 1800000
# Prints only the final JSON line (play stdout also carries lots of loader noise; never pipe it to `head`).
set -u
DIR=$1; SCRIPT=$2; shift 2
CHROME=${QA_CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
BIN=${TMPDIR:-/tmp}/qa-fxbin
mkdir -p "$BIN"
printf '#!/bin/sh\nexec "%s" --no-sandbox "$@"\n' "$CHROME" > "$BIN/chrome-nosandbox"
printf '#!/bin/sh\nexit 0\n' > "$BIN/ps"
chmod +x "$BIN/chrome-nosandbox" "$BIN/ps"
# Refuse to start if the requested play port is still listening: a previous `project play` killed by the
# tool (exit 137 / SIGTERM) keeps running in the background and would write into the same evidence dir.
PORT=$(printf '%s\n' "$@" | awk 'p{print;exit} $0=="--port"{p=1}')
if [ -n "$PORT" ] && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[qa] port $PORT is still in use (a previous play is probably still running). Wait for it or stop YOUR own task; not starting."
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | sed 's/^/[qa]   /'
  exit 3
fi
LOG=$(mktemp -t qa-play)
cd "$DIR"
PATH="$BIN:$PATH" FORGEAX_BROWSER_EXECUTABLE="$BIN/chrome-nosandbox" \
  pnpm exec forgeax project play "$SCRIPT" --json --progress false "$@" > "$LOG" 2>&1
CODE=$?
grep '^{"ok"' "$LOG" | tail -1 || tail -c 2000 "$LOG"
echo "[qa] exit=$CODE full log: $LOG"
exit $CODE
