#!/usr/bin/env python3
"""Bake season-accurate jersey numbers into team rosters (roster + rostersBySeason).

Appends the number a player wore that season for that franchise as index 7 of each roster
entry [pid, name, pos, gp, pts, reb, ast, num]. Source: build/jersey_by_season.json
(pid -> "season|abbr" -> num), harvested from the reference source. Idempotent; re-run after the team files
are rebuilt. Numbers surface on the team page's roster tables."""
import json, os, glob

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
LK = os.path.join(HERE, "jersey_by_season.json")
if not os.path.exists(LK):
    print("no jersey_by_season.json — nothing to apply"); raise SystemExit
jersey = json.load(open(LK))

def num_for(pid, season, ab):
    return (jersey.get(pid) or {}).get(f"{season}|{ab}")

def stamp(entry, season, ab):
    # entry is [pid, name, pos, gp, pts, reb, ast, (num?)]; set index 7
    pid = entry[0]
    n = num_for(pid, season, ab)
    if len(entry) >= 8:
        entry[7] = n or entry[7]
    else:
        entry += [None] * (7 - len(entry)) + [n]
    return entry

n_players = 0
for fp in glob.glob(os.path.join(DATA, "team", "*.json")):
    t = json.load(open(fp))
    era = {s["season"]: s.get("ab") for s in t.get("seasons", [])}  # season -> era abbr
    modern = os.path.basename(fp)[:-5]
    latest = (t.get("seasons") or [{}])[0].get("season")
    for r in t.get("roster", []):
        stamp(r, latest, era.get(latest, modern)); n_players += 1
    for season, rows in (t.get("rostersBySeason") or {}).items():
        ab = era.get(int(season), modern)
        for r in rows:
            stamp(r, int(season), ab); n_players += 1
    with open(fp, "w") as f:
        json.dump(t, f, separators=(",", ":"), ensure_ascii=False)
print(f"stamped jersey numbers onto {n_players} roster rows across {len(glob.glob(os.path.join(DATA, 'team', '*.json')))} teams")
