"""Print the facts of each qa-run.mjs run directory (reads <dir>/run.json).

    python3 summarize.py RUN_DIR [RUN_DIR ...] [--log key1,key2,...] [--table]

--log    : which page-log keys to print in time order (default: phase,room,subtitle,speaker-ish keys)
--table  : one line per run (load time, rooms, end/held/death, errors, warnings, audio, stalls) — paste into report §0
"""
import json
import sys

args = [a for a in sys.argv[1:] if not a.startswith("--")]
table = "--table" in sys.argv
logkeys = None
if "--log" in sys.argv:
    logkeys = sys.argv[sys.argv.index("--log") + 1].split(",")
    args = [a for a in args if a != sys.argv[sys.argv.index("--log") + 1]]
DEFAULT = ("phase", "room", "subtitle", "subtitleWho", "teach", "banner", "bossHalf", "treeAsh", "endingStep", "hex", "rank")

for d in args:
    r = json.load(open(d.rstrip("/") + "/run.json"))
    a = r.get("audioFinal") or {}
    if table:
        print(r["tag"], "open", (r.get("load") or {}).get("openS"), "rooms", r["rooms"], "end", r.get("ending"), "held", r.get("held"),
              "death", (r.get("death") or {}).get("t"), "restartLeft", bool(((r.get("death") or {}).get("follow") or {}).get("leftFirstRoom")), "err", len(r["pageErrors"]), len(r["consoleErrors"]), "warn", len(r["warnings"]),
              "audio", a.get("starts"), "stall", len(r["stalls"]), "timedOut", bool(r.get("timedOut")), "exc", bool(r.get("exception")), "sec", r["seconds"])
        continue
    print("=====", r["tag"], "pickPlan", r.get("pickPlan"))
    for k in ["load", "rooms", "held", "ending", "death", "afterEndingConfirm", "failed", "exception", "timedOut", "pause", "godAfterKey", "skin", "skinFight", "bounds", "autoSwitch"]:
        if k in r:
            print("  ", k, json.dumps(r.get(k), ensure_ascii=False)[:400])
    f = (r.get("death") or {}).get("follow")
    if f:
        print("   death-follow spawn", f.get("spawn"), "leftFirstRoom", f.get("leftFirstRoom"), "STUCK" if f.get("stuck") else "", "track", f.get("track", [])[:6])
    if r.get("textFollow"):
        for x in r["textFollow"]:
            print("   text-follow", x["text"][:16], "before", x["before"], "after", x["after"])
    print("   stalls", len(r["stalls"]), json.dumps(r["stalls"], ensure_ascii=False)[:300])
    print("   errors page", len(r["pageErrors"]), "console", len(r["consoleErrors"]), r["pageErrors"][:2], r["consoleErrors"][:2])
    print("   warnings", len(r["warnings"]), r["warnings"][:3])
    print("   picks", [(p["phase"], p["plan"], p.get("picked"), p.get("armedAfterFirst"), p.get("phaseAfterFirst"), p.get("after"), p.get("pickNow"), p.get("audioDelta"), [c["hitsCard"] for c in p["cards"]]) for p in r["picks"]])
    print("   dialog (before, idle, afterKey)", [(x["phase"], x["lineBefore"], x["lineIdle"], x["lineAfterKey"], x["phaseAfterKey"]) for x in r["dialog"]])
    print("   kills", [(k["t"], k["room"], k["kills"]) for k in r["kills"]])
    print("   audio contexts", a.get("contexts"), "starts", a.get("starts"), "state", a.get("state"))
    for t, k, v in (r.get("pageLog") or []):
        if k in (logkeys or DEFAULT) and v not in ("", None, False):
            print("    ", t, k, v)
