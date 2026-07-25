#!/usr/bin/env python3
"""Bake a per-number jersey history into each player record: bio.numHist.

bio.numbers is only a flat list ("23", "6"), so the player page could do no
better than "#23 +1" behind a tooltip — invisible on a phone, and it never said
WHEN a number was worn. the reference source lists jersey numbers with their
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


# ---- truth sources for which team(s) a player was really on each season ----
# The raw crawl sometimes bleeds a player's most-tenured team into seasons he spent
# elsewhere (A.C. Green shown on LAL through his PHX/DAL years). Team rosters are
# authoritative — a mid-season trade lists the player on BOTH teams that year — and
# franchise_map normalises era abbrs (SEA->OKC) so relocated clubs compare cleanly.
# A harvested jersey row survives only if a truth source confirms its team-season,
# or nothing can disprove it (a 2-team season with no roster on record).
fmap = json.load(open(os.path.join(DATA, "franchise_map.json")))
norm = lambda a: fmap.get(a, a)
roster_teams = collections.defaultdict(set)     # (pid, season) -> {modern abbr}
for tf in glob.glob(os.path.join(DATA, "team", "*.json")):
    try:
        tj = json.load(open(tf))
    except Exception:
        continue
    tid = norm(tj.get("id") or os.path.basename(tf)[:-5])
    for season, rows in (tj.get("rostersBySeason") or {}).items():
        for row in rows:
            if row and row[0]:
                roster_teams[(row[0], int(season))].add(tid)


def confirmed(pid, season, team, log_team):
    """Keep (season, team) only if a truth source confirms it (or can't disprove it)."""
    real = roster_teams.get((pid, season))
    nteam = norm(team)
    if real:                              # rosters are authoritative for this season
        return nteam in real
    lg = log_team.get(season)             # else the player's own single-team season log
    if lg and lg != "2TM":
        return norm(lg) == nteam
    return True                           # 2-team season, no roster on record -> keep


written = dropped = 0
for f in glob.glob(os.path.join(DATA, "player", "*.json")):
    d = json.load(open(f))
    pid = d.get("id")
    acc = per_player.get(pid)
    if not acc:
        continue
    b = d.setdefault("bio", {})
    log_team = {r[0]: r[2] for r in d.get("log", []) if len(r) > 16 and r[16] != 2}
    clean, d_here = {}, 0
    for n, entries in acc.items():
        kept = [(s, t) for (s, t) in entries if confirmed(pid, s, t, log_team)]
        d_here += len(entries) - len(kept)
        if kept:
            clean[n] = kept
    if not clean:                     # nothing confirmable (e.g. ancient abbr variants the
        clean = acc                   # franchise map can't bridge) -> keep original, never nuke
        d_here = 0
    dropped += d_here
    # order by seasons worn (desc) so the number they're known for leads
    hist = sorted(clean.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    b["numHist"] = [{"n": n, "sp": spans(e)} for n, e in hist]
    json.dump(d, open(f, "w"), separators=(",", ":"), ensure_ascii=False)
    written += 1

print(f"wrote bio.numHist for {written} players; dropped {dropped} unconfirmed team-seasons")
