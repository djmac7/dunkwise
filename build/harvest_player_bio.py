#!/usr/bin/env python3
"""Turn the cached the reference source player-page crawl (jersey numbers + nickname) into the durable,
committed build/player_bio.json. One-time harvest from an ephemeral crawl cache (see the
bio crawler); apply_player_bio.py then merges it into the player records at build time.

Format: {pid: {"nickname": str?, "num": str?, "numbers": [str]}}"""
import json, os, glob, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = sys.argv[1] if len(sys.argv) > 1 else "/tmp/bbr_bio"

out = {}
nick = jersey = 0
for fp in glob.glob(os.path.join(CACHE, "*.json")):
    pid = os.path.basename(fp)[:-5]
    try:
        d = json.load(open(fp))
    except Exception:
        continue
    if not isinstance(d, dict) or "error" in d:
        continue
    entry = {}
    if d.get("nickname"):
        entry["nickname"] = d["nickname"]; nick += 1
    if d.get("num"):
        entry["num"] = d["num"]
        entry["numbers"] = d.get("numbers") or [d["num"]]
        jersey += 1
    if entry:
        out[pid] = entry

json.dump(out, open(os.path.join(HERE, "player_bio.json"), "w"), separators=(",", ":"), ensure_ascii=False, sort_keys=True)
print(f"player_bio.json: {len(out)} players · {jersey} with a jersey number · {nick} with a nickname")
