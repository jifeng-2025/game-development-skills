"""Attribute counted audio playbacks to sound names by buffer duration (black-box SFX verification).

qa-run.mjs logs every AudioBufferSourceNode.start as [ms, bufferDurationMs]. Sound files with a
unique duration identify themselves; duplicates are reported as "a|b" (state it as such in the report).

    python3 audio-attrib.py SFX_DIR RUN_DIR [RUN_DIR ...] [--by-phase]

SFX_DIR: folder of .wav files (reading the duration of an asset is not reading game code).
--by-phase also splits counts by the phase/room active when each sound started (needs pageLog).
"""
import glob
import json
import os
import sys
import wave
from collections import Counter, defaultdict

sfx = sys.argv[1]
runs = [a for a in sys.argv[2:] if not a.startswith("--")]
by_phase = "--by-phase" in sys.argv
names = defaultdict(set)
for f in sorted(glob.glob(os.path.join(sfx, "**", "*.wav"), recursive=True)):
    w = wave.open(f)
    ms = round(w.getnframes() / w.getframerate() * 1000)
    base = os.path.basename(f)[:-4]
    stem = base.rsplit("-", 1)[0] if len(base.rsplit("-", 1)[-1]) == 1 else base  # slash-1-a -> slash-1
    names[ms].add(stem)


def name(ms):
    for d in (0, 1, 2):  # tolerate ±2 ms rounding
        for m in (ms - d, ms + d):
            if m in names:
                return "|".join(sorted(names[m]))
    return f"?{ms}ms"


print("duration table:", {k: sorted(v) for k, v in sorted(names.items())})
total = Counter()
for d in runs:
    r = json.load(open(d.rstrip("/") + "/run.json"))
    log = (r.get("audioFinal") or {}).get("log") or []
    c = Counter(name(x[1]) for x in log)
    total += c
    print(r["tag"], "starts", len(log), dict(c))
    if by_phase:
        ev = [(t, k, v) for t, k, v in (r.get("pageLog") or []) if k in ("phase", "room")]
        def where(ts):
            ph, rm = "pre", 0
            for t, k, v in ev:
                if t <= ts:
                    if k == "phase": ph = v
                    else: rm = v
            return f"{ph}/r{rm}"
        print("   by phase", dict(Counter(where(x[0]) for x in log)))
print("ALL", dict(total))
never = sorted({n for v in names.values() for n in v} - {p for k in total for p in k.split("|")})
print("NEVER HEARD (candidates, check ambiguity):", never)
