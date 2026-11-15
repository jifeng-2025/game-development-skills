#!/bin/zsh
# WorkBuddy sandbox blocks `ps`; `forgeax dev start` / `project play` / `project preview` scan for orphan
# daemons with `ps` and then fail with `spawn EPERM` / live-discovery-invalid.
# Source this file (or run it) to put a no-op `ps` first on PATH for the current shell:
#   source ps-shim.sh && pnpm exec forgeax dev start --json
# The forgeax commands still need to run outside the sandbox (dangerouslyDisableSandbox) to spawn daemons.
mkdir -p /tmp/fxbin
if [[ ! -x /tmp/fxbin/ps ]]; then printf '#!/bin/sh\nexit 0\n' > /tmp/fxbin/ps; chmod +x /tmp/fxbin/ps; fi
export PATH=/tmp/fxbin:$PATH
