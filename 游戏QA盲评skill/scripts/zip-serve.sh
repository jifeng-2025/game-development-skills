#!/bin/sh
# Unpack a web-zip deliverable the way a player would host it, and serve it with a plain static server.
#   zip-serve.sh <zip> <out-dir> <port> [expected-sha256]
# Prints: sha256 match, top-level files, README first lines, whether the loading-page marker ($QA_HEAD_MARK)
# is in index.html, then serves out-dir on 127.0.0.1:<port> in the FOREGROUND (use background mode; stop it yourself).
set -eu
ZIP=$1; OUT=$2; PORT=$3; WANT=${4:-}
GOT=$(shasum -a 256 "$ZIP" | cut -d' ' -f1)
echo "[qa] sha256 $GOT"
if [ -n "$WANT" ]; then [ "$GOT" = "$WANT" ] && echo "[qa] sha256 matches the report" || echo "[qa] WARNING sha256 differs from the report ($WANT)"; fi
rm -rf "$OUT"; mkdir -p "$OUT"; cd "$OUT"; unzip -q "$ZIP"
echo "[qa] files: $(ls | tr '\n' ' ')"
[ -f README.md ] && { echo "[qa] README.md head:"; head -12 README.md | sed 's/^/[qa]   /'; } || echo "[qa] no README.md"
if [ -n "${QA_HEAD_MARK:-}" ]; then grep -q "$QA_HEAD_MARK" index.html && echo "[qa] loading marker present" || echo "[qa] loading marker NOT in index.html"; fi
echo "[qa] serving http://127.0.0.1:$PORT/"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
