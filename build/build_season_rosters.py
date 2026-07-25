#!/usr/bin/env python3
"""
Add per-season rosters to each data/team/<abbr>.json.

The team files ship a single `roster` (the latest season — refreshed live from the live source for
active teams). Historical season views (#/team/CLE/2025) had no season-specific roster, so
they showed the latest roster mislabelled. This backfills `rostersBySeason` for every PAST
season from the shipped player logs, which are stint-accurate (a traded player appears on
each team he actually played for, never the combined 2TM line) — matching the roster
convention the rest of the site uses.

Reads only already-published data (data/player/*.json + data/team/*.json), so it runs
without the raw a public historical dataset CSVs. Idempotent: re-run any time after a player-data rebuild.

log row layout (see build_data.py):
  [0 season, 1 lg, 2 team, 3 age, 4 g, 5 mp, 6 fg%, 7 3p%, 8 ft%,
   9 trb, 10 ast, 11 stl, 12 blk, 13 pts, 14 per, 15 ts%, 16 stint_flag]
roster row (matches the live `roster` shape): [id, name, pos, g, pts, reb, ast, number]
"""
import json, os, glob, re

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, "..", "data")
MULTI = re.compile(r"^\d+TM$")            # 2TM / 3TM … combined-stint line — skip
NON_TEAM = {"NBA", "ABA", "BAA", "TOT", ""}
CAP = 18                                  # top scorers kept per season (keeps files lean + the card tidy)
# jersey number per (player, season, team) — looked up by the REAL team a player logged that
# season, so a traded player shows the right number on each team (and crawl phantoms never match).
JERSEY = json.load(open(os.path.join(HERE, "jersey_by_season.json")))

# team -> season -> list of roster rows
rosters = {}
for f in glob.glob(os.path.join(DATA, "player", "*.json")):
    d = json.load(open(f))
    pid, nm = d.get("id"), d.get("name")
    pos = (d.get("bio") or {}).get("pos", "")
    for r in d.get("log", []):
        season, team, g, trb, ast, pts = r[0], r[2], r[4], r[9], r[10], r[13]
        if not team or MULTI.match(str(team)) or team in NON_TEAM:
            continue
        num = JERSEY.get(pid, {}).get(f"{season}|{team}", "")
        rosters.setdefault(team, {}).setdefault(int(season), []).append(
            [pid, nm, pos, g, pts, trb, ast, num]
        )

# sort each season by points (desc, None last) and cap; write into the team files
teams_written = 0
for tf in glob.glob(os.path.join(DATA, "team", "*.json")):
    t = json.load(open(tf))
    ab = t.get("abbr")
    last = t.get("lastSeason")
    by_season = rosters.get(ab, {})
    out = {}
    for season, rows in by_season.items():
        # Every season, including the most recent. The live `roster` used to stand in
        # for the latest one, but the live source serves the *upcoming* roster once the offseason
        # starts — so in July the finished 2025-26 page was listing 2026-27 signings
        # (Jaylen Brown on PHI) beside their 2025-26 stats. Log-derived rows are the
        # players who actually appeared for the team that season, which is what a
        # season view means.
        rows.sort(key=lambda x: (x[4] is None, -(x[4] or 0)))
        out[season] = rows[:CAP]
    t["rostersBySeason"] = {str(s): out[s] for s in sorted(out, reverse=True)}
    json.dump(t, open(tf, "w"), separators=(",", ":"), ensure_ascii=False)
    teams_written += 1

# quick size + sanity report
import os as _os
sizes = sorted(((_os.path.getsize(p), _os.path.basename(p)) for p in glob.glob(os.path.join(DATA, "team", "*.json"))), reverse=True)
total = sum(s for s, _ in sizes)
print(f"wrote rostersBySeason into {teams_written} team files · total data/team = {total/1e6:.2f} MB")
print("largest:", ", ".join(f"{n} {s//1024}KB" for s, n in sizes[:5]))
