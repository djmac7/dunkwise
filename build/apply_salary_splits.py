#!/usr/bin/env python3
"""
Apply reference-source-verified per-team salary splits + current-season fills.

Two problems this fixes, both sourced from the reference source player pages (build/salary-splits.json):

1. Dead-money mis-attribution. A bought-out veteran's full guaranteed salary was filed under
   the minimum-salary team he later signed with (Kemba Walker's $37.3M 2022-23 landing on the
   Mavericks). the reference source itemises the real per-team split — the small figure the playing team actually
   paid, plus the dead money owed by the team(s) that waived him — so team-payroll pages become
   exact and no min-signing shows up as a top earner.

2. Current-season gaps. The open CSVs stop at 2024-25, leaving 2025-26 (season 2026) with only a
   partial top-up. the reference source player pages carry the completed 2025-26 figure, added here.

Format:  {pid: {season: [[teamAbbr, amount], ...]}}  — a season's list REPLACES that player's
bySeason rows for the season; byPlayer[season] becomes the sum (career-earnings total intact).

Run order: … apply_salary_overrides → restore_future_salaries → apply_salary_splits (last;
it recomputes every derived structure from the final byPlayer / bySeason).
"""
import json, os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
SPLITS = os.path.join(HERE, "salary-splits.json")


def main():
    if not os.path.exists(SPLITS):
        print("no salary-splits.json — nothing to apply")
        return
    sal = json.load(open(os.path.join(DATA, "salaries.json")))
    splits = json.load(open(SPLITS))
    cpi = json.load(open(os.path.join(DATA, "cpi.json")))
    bp, bs = sal["byPlayer"], sal["bySeason"]
    # name lookup for rebuilding bySeason rows
    name_of = {}
    for rows in bs.values():
        for pid, nm, ab, v in rows:
            name_of.setdefault(pid, nm)

    applied = 0
    for pid, seasons in splits.items():
        for ys, parts in seasons.items():
            yr = int(ys)
            total = sum(int(a) for _, a in parts)
            nm = name_of.get(pid, pid)
            # replace this player's rows for the season with the split
            bs.setdefault(ys, [])
            bs[ys] = [r for r in bs[ys] if r[0] != pid] + [[pid, nm, ab, int(a)] for ab, a in parts]
            # byPlayer carries one total per season (career earnings stay whole)
            arr = bp.setdefault(pid, [])
            hit = False
            for pair in arr:
                if pair[0] == yr:
                    pair[1] = total; hit = True
            if not hit:
                arr.append([yr, total]); arr.sort()
            applied += 1
    print(f"salary splits applied: {applied} player-seasons")

    # recompute every derived structure from the corrected byPlayer / bySeason
    sal["careerEarn"] = {pid: sum(s for _, s in a) for pid, a in bp.items()}
    all_rows = [(pid, nm, ab, int(y), v) for y, rows in bs.items() for pid, nm, ab, v in rows]
    sal["topAllTime"] = [[p, n, a, s, v] for p, n, a, s, v in sorted(all_rows, key=lambda x: -x[4])[:60]]
    CPI, BSE = cpi["cpi"], cpi["base"]
    adj = lambda v, s: int(v * CPI[str(BSE)] / CPI[str(s)]) if CPI.get(str(s)) else v
    sal["topAllTimeReal"] = [[p, n, a, s, adj(v, s)] for p, n, a, s, v in sorted(all_rows, key=lambda x: -adj(x[4], x[3]))[:60]]
    tp, pr, pay = defaultdict(list), defaultdict(list), defaultdict(int)
    for pid, nm, ab, s, v in all_rows:
        if ab:
            pay[(ab, s)] += v
    for (ab, s), tot in pay.items():
        tp[ab].append([s, int(tot)]); pr[s].append([ab, int(tot)])
    for ab in tp:
        tp[ab].sort()
    for s in pr:
        pr[s].sort(key=lambda x: -x[1])
    sal["teamPayroll"] = tp
    sal["payrollRank"] = {str(k): v for k, v in pr.items()}
    for s in bs:
        bs[s].sort(key=lambda x: -x[3])
    sal["range"] = [min(int(s) for s in bs), max(int(s) for s in bs)]

    json.dump(sal, open(os.path.join(DATA, "salaries.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    print("rewrote data/salaries.json with splits")


if __name__ == "__main__":
    main()
