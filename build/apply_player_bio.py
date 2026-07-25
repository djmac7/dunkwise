#!/usr/bin/env python3
"""Merge build/player_bio.json (reference-sourced jersey numbers + nicknames) into the player
records: bio.num (primary/most-worn number), bio.numbers (all NBA numbers worn), bio.nickname.

Idempotent; re-run after build_data.py (which rebuilds player files from the source CSVs and
would otherwise drop these fields). Same pattern as fill_highschools.py."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
BIO = os.path.join(HERE, "player_bio.json")

if not os.path.exists(BIO):
    print("no player_bio.json — nothing to apply"); raise SystemExit

bio = json.load(open(BIO))
# curated marquee nicknames (King James, The Black Mamba, …) fill/override the ones the reference source lacks
CUR = os.path.join(HERE, "curated_nicknames.json")
curated = json.load(open(CUR)) if os.path.exists(CUR) else {}
pids = set(bio) | set(curated)
nick_of, nums_of = {}, {}
n = miss = 0
for pid in pids:
    path = os.path.join(DATA, "player", pid + ".json")
    if not os.path.exists(path):
        miss += 1; continue
    info = bio.get(pid, {})
    d = json.load(open(path))
    b = d.setdefault("bio", {})
    nick = curated.get(pid) or info.get("nickname")   # curated canonical wins
    if nick:
        b["nickname"] = nick; nick_of[pid] = nick
    if info.get("num"):
        b["num"] = info["num"]
        nums = info.get("numbers") or [info["num"]]
        if len(nums) > 1:
            b["numbers"] = nums
        nums_of[pid] = " ".join(nums)
    with open(path, "w") as f:
        json.dump(d, f, separators=(",", ":"), ensure_ascii=False)
    n += 1
print(f"applied bio to {n} players ({len(curated)} curated nicknames) · {miss} missing")

# make nickname + numbers searchable: extend each search.json row to
# [id,name,from,to,pos,team,nbaId, nickname, "num num …"] (indices 7,8)
sp = os.path.join(DATA, "search.json")
search = json.load(open(sp))
for e in search:
    pid = e[0]
    e[7:] = [nick_of.get(pid, ""), nums_of.get(pid, "")]   # replace any prior 7,8 (idempotent)
with open(sp, "w") as f:
    json.dump(search, f, separators=(",", ":"), ensure_ascii=False)
print(f"enriched search.json: {sum(1 for e in search if e[7])} nicknames · {sum(1 for e in search if e[8])} with numbers")
