#!/usr/bin/env python3
"""
Turn cached the reference source player salary tables into build/salary-splits.json.

Provenance / one-time harvest: the reference source player pages are fetched separately (respecting the 3s
crawl-delay) into a cache dir, one JSON per player of [ [season,"Team Name",amount], ... ].
This reads that cache + our current data and emits two kinds of correction:

  * dead-money split — a season our data files under ONE team but the reference source shows split across
    several, where our attributed team's real (the reference source) share is < half the total. The player was
    bought out and signed a minimum elsewhere; we replace the single row with the reference source's exact
    per-team figures so no min-signing shows as a team's top earner.
  * 2025-26 fill — a player who logged 2025-26 minutes but has no salary yet; add the reference source's figure.

Output format (consumed by apply_salary_splits.py):  {pid: {season: [[abbr, amount], ...]}}
"""
import json, os, glob, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
CACHE = sys.argv[1] if len(sys.argv) > 1 else "/tmp/bbr_salaries"
CURRENT = 2026  # 2025-26 season key

meta = json.load(open(os.path.join(DATA, "meta.json")))
# the reference source full team name -> our abbr (modern era; 2016-2026 all use current names)
NAME2AB = {
    "atlanta hawks": "ATL", "boston celtics": "BOS", "brooklyn nets": "BKN",
    "charlotte hornets": "CHA", "charlotte bobcats": "CHA", "chicago bulls": "CHI",
    "cleveland cavaliers": "CLE", "dallas mavericks": "DAL", "denver nuggets": "DEN",
    "detroit pistons": "DET", "golden state warriors": "GSW", "houston rockets": "HOU",
    "indiana pacers": "IND", "los angeles clippers": "LAC", "la clippers": "LAC",
    "los angeles lakers": "LAL", "memphis grizzlies": "MEM", "miami heat": "MIA",
    "milwaukee bucks": "MIL", "minnesota timberwolves": "MIN", "new orleans pelicans": "NOP",
    "new york knicks": "NYK", "oklahoma city thunder": "OKC", "orlando magic": "ORL",
    "philadelphia 76ers": "PHI", "phoenix suns": "PHX", "portland trail blazers": "POR",
    "sacramento kings": "SAC", "san antonio spurs": "SAS", "toronto raptors": "TOR",
    "utah jazz": "UTA", "washington wizards": "WAS",
    # relocated/renamed franchises that existed within our split window (era-accurate abbrs,
    # matching how our bySeason attributes them; team pages aggregate these onto the modern club)
    "seattle supersonics": "SEA", "new jersey nets": "NJN", "new orleans hornets": "NOH",
    "new orleans/oklahoma city hornets": "NOK", "vancouver grizzlies": "VAN",
}
JUNK = {"team", "", "career", "(may be incomplete)"}
VALID = set(meta["teams"].keys())


def end_year(s):  # "2022-23" -> 2023 ; "1999-00" -> 2000
    a, b = s.split("-")
    cent = int(a) // 100 * 100
    yr = cent + int(b) if int(b) != 0 else cent + 100
    return yr


sal = json.load(open(os.path.join(DATA, "salaries.json")))
bs = sal["bySeason"]
# our current single-team attribution per (pid, season)
ours = {}
for s, rows in bs.items():
    for pid, nm, ab, amt in rows:
        ours.setdefault((pid, int(s)), []).append((ab, amt))
# game-log teams per player per season (abbr -> games): the teams a player actually suited up
# for. A salary the reference source files under a team NOT in this set is dead money (a former team's guaranteed
# money after a buyout / stretch). Used for both the 2025-26 fill test and dead-money detection.
log_by = {}  # pid -> season -> {abbr: games}
for f in glob.glob(os.path.join(DATA, "player", "*.json")):
    d = json.load(open(f)); pid = d["id"]; seas = {}
    for r in d.get("log", []):
        yr = int(r[0])
        if r[2] and r[2] in VALID:
            seas.setdefault(yr, {})
            seas[yr][r[2]] = seas[yr].get(r[2], 0) + (r[4] or 0)
    if seas:
        log_by[pid] = seas
cur_log = {pid: s[CURRENT] for pid, s in log_by.items() if CURRENT in s}
played_cur = set(cur_log)

splits = {}
n_dead = n_fill = skipped = 0
unmapped = set()
for fp in glob.glob(os.path.join(CACHE, "*.json")):
    pid = os.path.basename(fp)[:-5]
    try:
        rows = json.load(open(fp))
    except Exception:
        continue
    if not isinstance(rows, list):
        continue
    # group the reference source rows by end-year season -> {abbr: amount}
    by_season = {}
    for season, team, amt in rows:
        tn = team.strip().lower()
        if tn in JUNK or not amt:
            continue
        ab = NAME2AB.get(tn)
        if not ab:
            unmapped.add(team); continue
        yr = end_year(season)
        by_season.setdefault(yr, {})
        by_season[yr][ab] = by_season[yr].get(ab, 0) + int(amt)

    for yr, parts in by_season.items():
        if yr < 2000 or yr > CURRENT:
            continue
        bbr_total = sum(parts.values())
        cur = ours.get((pid, yr))
        if cur is None:
            # 2025-26 fill for a player who actually played but has no salary row
            if yr == CURRENT and pid in played_cur and bbr_total > 0:
                logset = cur_log.get(pid, {})
                # if NONE of the reference source's teams are teams our game data shows him on (a trade/discrepancy),
                # trust our games: attribute the whole figure to his primary (most-GP) 2025-26 team.
                if logset and not (set(parts) & set(logset)):
                    primary = max(logset, key=logset.get)
                    entry = [[primary, bbr_total]]
                else:
                    entry = [[a, v] for a, v in sorted(parts.items(), key=lambda x: -x[1])]
                splits.setdefault(pid, {})[str(yr)] = entry
                n_fill += 1
            continue
        # existing player-season the reference source shows split across teams → replace our single-team figure with
        # the reference source's exact per-team split so every team-payroll page is precise. Applies to ALL trades,
        # not only dead money. Guarded so verified single-team data is only overwritten when the reference source is
        # trustworthy here: either the season totals agree (a clean mid-season trade), or there's a
        # dead-money signature (off-log money / a minimum-signing mis-attribution) where our single
        # total was itself incomplete. Totals that disagree with no dead-money signal are left alone.
        if len(parts) < 2:
            continue
        if bbr_total > 90_000_000 or any(v <= 0 for v in parts.values()):
            skipped += 1; continue            # implausible parse — leave it
        our_total = sum(a for _, a in cur)
        totals_ok = our_total > 0 and abs(bbr_total - our_total) / our_total <= 0.10
        logset = set(log_by.get(pid, {}).get(yr, {}))
        off_log = sum(v for ab, v in parts.items() if ab not in logset) if logset else 0
        our_ab = cur[0][0] if len(cur) == 1 else None
        dead_money = off_log >= bbr_total * 0.25 or (our_ab is not None and parts.get(our_ab, 0) < bbr_total * 0.5)
        if not (totals_ok or dead_money):
            skipped += 1; continue            # totals disagree and no dead-money signal — leave it
        splits.setdefault(pid, {})[str(yr)] = [[a, v] for a, v in sorted(parts.items(), key=lambda x: -x[1])]
        n_dead += 1

json.dump(splits, open(os.path.join(HERE, "salary-splits.json"), "w"), separators=(",", ":"), ensure_ascii=False, sort_keys=True)
print(f"per-team trade splits: {n_dead} · 2025-26 fills: {n_fill} · skipped (total mismatch): {skipped}")
print(f"players with corrections: {len(splits)}")
if unmapped:
    print("UNMAPPED team names (ignored):", sorted(unmapped)[:20])
