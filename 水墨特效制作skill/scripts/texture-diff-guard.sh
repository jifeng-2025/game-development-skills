#!/bin/zsh
# Guard for texture re-generation (the preprocessor rewrites the whole texture dir):
#   texture-diff-guard.sh before <texture dir>      # snapshot hashes
#   (run prepare-textures.mjs)
#   texture-diff-guard.sh after  <texture dir>      # list only files whose bytes changed
# Expect exactly the textures you meant to change; anything else = regression, revert.
set -e
MODE=${1:?before|after}; DIR=${2:?texture dir}
SNAP=/tmp/vfx-texture-$(echo "$DIR" | shasum | cut -c1-8).sha
cd "$DIR"
if [[ $MODE == before ]]; then shasum *.png *.meta.json > "$SNAP"; echo "snapshot $(wc -l < "$SNAP") files → $SNAP"
else shasum -c "$SNAP" 2>/dev/null | grep -v ": OK$" || echo "no texture changed"; fi
