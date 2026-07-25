#!/usr/bin/env python3
"""Bake a per-number jersey history into each player record: bio.numHist.

bio.numbers is only a flat list ("23", "6"), so the player page could do no
better than "#23 +1" behind a tooltip — invisible on a phone, and it never said
WHEN a number was worn. Basketball-Reference lists jersey numbers with their
seasons; this builds the same thing, plus the team, from the per-season data in
build/jersey_by_season.json (pid -> "season|abbr" -> number).

Shape (most-worn number first, spans oldest-first):
  bio.numHist = [{"n": "23", "sp": [["CLE", 2004, 2010], ["LAL", 2019, 2026]]}, ...]

Consecutive seasons on the same team collapse into one span; a gap or a team
change starts a new one. Idempotent — re-run after a player-data rebuild.
"""
import json, os, glob, collections

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")

by_season = json.load(open(os.path.join(HERE, "jersey_by_season.json")))

# pid -> number -> [(season, team)]
per_player = {}
for pid, rows in by_season.items():
    acc = collections.defaultdict(list)
    for key, num in rows.items():
        season, _, team = key.partition("|")
        if not num:
            continue
        acc[str(num)].append((int(season), team))
    per_player[pid] = acc


def spans(entries):
    """[(season, team)] -> [[team, from, to]] collapsing consecutive same-team runs."""
    out = []
    for season, team in sorted(entries):
        if out and out[-1][0] == team and season == out[-1][2] + 1:
            out[-1][2] = season
        else:
            out.append([team, season, season])
    return out


written = 0
for f in glob.glob(os.path.join(DATA, "player", "*.json")):
    d = json.load(open(f))
    acc = per_player.get(d.get("id"))
    if not acc:
        continue
    b = d.setdefault("bio", {})
    # order by seasons worn (desc) so the number they're known for leads
    hist = sorted(acc.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    b["numHist"] = [{"n": n, "sp": spans(e)} for n, e in hist]
    json.dump(d, open(f, "w"), separators=(",", ":"), ensure_ascii=False)
    written += 1

print(f"wrote bio.numHist for {written} players")
