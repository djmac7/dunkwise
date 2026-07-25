#!/usr/bin/env python3
"""Re-attach FULL future contract years (seasons > current) after a fetch_salaries.py rebuild.

fetch_salaries.py rebuilds salaries.json from the open source CSVs, which only run through the
current season — so a rebuild drops the guaranteed future contract years (2027+) that were added
separately. Those years originate from the current-salary source's team pages via patch_future_salaries.py, but
the current-salary source's robots.txt now disallows automated access, so we do NOT re-fetch them here. Instead we
carry the already-published future rows forward from the last committed salaries.json (git HEAD),
which is where patch_future_salaries.py deposited them.

Idempotent: only ADDS seasons a player doesn't already have; existing rows and careerEarn are left
untouched. Recomputes range + teamPayroll/payrollRank for the restored future seasons.

Run order:  fetch_salaries.py  ->  (fix_salary_teams, apply_salary_overrides run inside it)  ->
            restore_future_salaries.py  ->  build_seo.py
To genuinely refresh future contracts from source, run patch_future_salaries.py in an environment
permitted to access the current-salary source, then commit — this script will carry that snapshot forward after.
"""
import json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
meta = json.load(open(os.path.join(DATA, "meta.json")))
CUR = meta["current"]

sal = json.load(open(os.path.join(DATA, "salaries.json")))
# source the future rows from the last committed salaries.json (never from a live site)
prev_raw = subprocess.run(["git", "show", "HEAD:data/salaries.json"], cwd=os.path.join(HERE, ".."),
                          capture_output=True, text=True, check=True).stdout
prev = json.loads(prev_raw)

byP, byS = sal["byPlayer"], sal["bySeason"]
prevP, prevS = prev["byPlayer"], prev["bySeason"]
name_of = {}
for s, rows in prevS.items():
    for pid, nm, ab, amount in rows:
        name_of.setdefault(pid, nm)

added, maxseason = 0, sal["range"][1]
for pid, arr in prevP.items():
    have = {r[0] for r in byP.get(pid, [])}
    for season, amount in arr:
        if season <= CUR or season in have:      # only future years, never overwrite existing
            continue
        # team for this future season comes from the committed bySeason row
        ab = next((r[2] for r in prevS.get(str(season), []) if r[0] == pid), None)
        byP.setdefault(pid, []).append([season, amount])
        byS.setdefault(str(season), []).append([pid, name_of.get(pid, ""), ab, amount])
        added += 1
        maxseason = max(maxseason, season)
for pid in byP:
    byP[pid].sort(key=lambda r: r[0])
for s in byS:
    byS[s].sort(key=lambda r: -r[3])
sal["range"][1] = maxseason

# rebuild team-payroll rollups for the restored future seasons
for season in range(CUR + 1, maxseason + 1):
    tot = {}
    for pid, nm, ab, amount in byS.get(str(season), []):
        if ab:
            tot[ab] = tot.get(ab, 0) + amount
    if tot:
        sal["payrollRank"][str(season)] = sorted(([ab, v] for ab, v in tot.items()), key=lambda x: -x[1])
        # drop any stale rows for this season first, then append (idempotent)
        for ab in list(sal["teamPayroll"].keys()):
            sal["teamPayroll"][ab] = [r for r in sal["teamPayroll"][ab] if r[0] != season]
        for ab, v in tot.items():
            sal["teamPayroll"].setdefault(ab, []).append([season, v])
for ab in sal["teamPayroll"]:
    sal["teamPayroll"][ab].sort(key=lambda r: r[0])

json.dump(sal, open(os.path.join(DATA, "salaries.json"), "w"), separators=(",", ":"), ensure_ascii=False)
print(f"restored {added} future contract-years from git HEAD; range now {sal['range']}")
