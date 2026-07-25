#!/usr/bin/env python3
"""
Import NBA 2K player ratings -> data/twok.json.

Source: a freely-published public GitHub ratings dataset
(data/league.json), which itself aggregates the public 2K ratings. We pull the
already-published JSON rather than scraping the ratings site directly (that host
returns 403 to automated clients — bot protection). This keeps
us to a plain, permitted data download.

Ratings are keyed to our own player ids by name match (accent/suffix-insensitive,
preferring the most recent player when a name repeats). Re-run to refresh.
"""
import json, os, re, sys, unicodedata, urllib.request
from datetime import datetime, timezone

SRC = "https://raw.githubusercontent.com/MikeYan01/nba2k-player-ratings/HEAD/data/league.json"
BASE = os.path.join(os.path.dirname(__file__), "..")
UA = {"User-Agent": "Mozilla/5.0 (DunkwiseBot; dataset import)"}

# attributes we keep for display (friendly subset of the full 37)
KEEP = ["closeShot", "midRangeShot", "threePointShot", "freeThrow", "layup", "drivingDunk",
        "standingDunk", "postControl", "passAccuracy", "ballHandle", "speedWithBall", "passVision",
        "interiorDefense", "perimeterDefense", "steal", "block", "helpDefenseIQ",
        "speed", "agility", "strength", "vertical", "stamina", "offensiveRebound", "defensiveRebound"]


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[.'’‘`]", "", s)   # strip straight + curly apostrophes, backtick
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", " ", s)   # collapse generational suffixes
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def main():
    search = json.load(open(os.path.join(BASE, "data", "search.json")))
    idx = {}
    for e in search:                      # [id, name, from, to, pos, team, nbaId]
        idx.setdefault(norm(e[1]), []).append(((e[3] or 0), e[0]))
    for k in idx:
        idx[k].sort(reverse=True)         # most-recent (largest "to") first

    league = json.loads(urllib.request.urlopen(urllib.request.Request(SRC, headers=UA), timeout=30).read().decode("utf-8"))

    ratings, unmatched = {}, []
    for p in league:
        hit = idx.get(norm(p.get("name", "")))
        if not hit:
            unmatched.append(p.get("name"))
            continue
        pid = hit[0][1]
        rec = {"ovr": p.get("overallAttribute")}
        for a in KEEP:
            if p.get(a) is not None:
                rec[a] = p[a]
        # keep the higher OVR if a name maps to an id already seen (dupes in source)
        if pid not in ratings or (rec["ovr"] or 0) > (ratings[pid].get("ovr") or 0):
            ratings[pid] = rec

    out = {
        "edition": "NBA 2K25",
        "source": "github.com/MikeYan01/nba2k-player-ratings",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "count": len(ratings),
        "ratings": ratings,
    }
    with open(os.path.join(BASE, "data", "twok.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"league players: {len(league)}  matched: {len(ratings)}  unmatched: {len(unmatched)}")
    if unmatched:
        print("unmatched sample:", ", ".join([u for u in unmatched if u][:20]))


if __name__ == "__main__":
    main()
