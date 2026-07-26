#!/usr/bin/env python3
"""
Augment existing data/player/<id>.json files (in place) with two extra fields the
UI needs but the core pipeline didn't emit:

  accy : accolade YEARS keyed by type -> for hover detail on the accolade chips
         {allstar:[yr], allnba:[[yr,'1st']], alldef:[[yr,tm]], allrookie:[[yr,tm]],
          mvp:[yr], dpoy:[yr], roy:[yr], smoy:[yr], mip:[yr], clutchpoy:[yr], fmvp:[yr]}
  shot : shooting tendencies by season (distance-band frequency + FG%), for the
         interactive shot-tendency chart. {season:{ranges,dunk,corner3,avgDist,fg,fga}}

Reads the public season CSVs in six-spins/data/raw. Season = end year (matches ours).
Run:  python3 build/build_extras.py
"""
import csv, json, os
from collections import defaultdict

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, "..", "data")
RAW = "/Users/d/six-spins/data/raw"
csv.field_size_limit(1 << 24)
def rows(name): return list(csv.DictReader(open(os.path.join(RAW, name), encoding="utf-8")))
def yr(s):
    try: return int(s)
    except (ValueError, TypeError): return None
def f(v):
    try: return round(float(v), 3)
    except (ValueError, TypeError): return None

accy = defaultdict(lambda: defaultdict(list))
for r in rows("All-Star Selections.csv"):
    if yr(r["season"]): accy[r["player_id"]]["allstar"].append(yr(r["season"]))
for r in rows("End of Season Teams.csv"):
    t, y = r["type"], yr(r["season"])
    if not y: continue
    key = {"All-NBA": "allnba", "All-Defense": "alldef", "All-Rookie": "allrookie"}.get(t)
    if key: accy[r["player_id"]][key].append([y, r.get("number_tm", "")])
AW = {"nba mvp": "mvp", "nba dpoy": "dpoy", "nba roy": "roy", "nba smoy": "smoy",
      "nba mip": "mip", "nba clutch_poy": "clutchpoy"}
for r in rows("Player Award Shares.csv"):
    if r.get("winner", "").upper() == "TRUE" and r["award"] in AW and yr(r["season"]):
        accy[r["player_id"]][AW[r["award"]]].append(yr(r["season"]))
# Finals MVP: curated per-season winners (not part of the Award Shares table).
CURATED = os.path.join(os.path.dirname(RAW), "curated")
try:
    for r in csv.DictReader(open(os.path.join(CURATED, "finals_mvp.csv"), encoding="utf-8")):
        if yr(r["season"]) and r.get("player_id"):
            accy[r["player_id"]]["fmvp"].append(yr(r["season"]))
except FileNotFoundError:
    pass

# shooting tendencies by season
RANGES = [("0-3 ft", "x0_3_range"), ("3-10 ft", "x3_10_range"), ("10-16 ft", "x10_16_range"),
          ("16 ft-3P", "x16_3p_range"), ("3-pointers", "x3p_range")]
shot = defaultdict(dict)
for r in rows("Player Shooting.csv"):
    y = yr(r["season"]); pid = r["player_id"]
    if not y: continue
    rr = []
    for label, suf in RANGES:
        pct, fgp = f(r.get(f"percent_fga_from_{suf}")), f(r.get(f"fg_percent_from_{suf}"))
        if pct is not None: rr.append({"z": label, "pct": pct, "fg": fgp})
    if not rr: continue
    shot[pid][y] = {"ranges": rr, "dunk": f(r.get("percent_dunks_of_fga")),
                    "corner3": f(r.get("percent_corner_3s_of_3pa")), "corner3fg": f(r.get("corner_3_point_percent")),
                    "avgDist": f(r.get("avg_dist_fga")), "fg": f(r.get("fg_percent"))}

pdir = os.path.join(DATA, "player")
n_acc = n_shot = 0
for fn in os.listdir(pdir):
    if not fn.endswith(".json"): continue
    pid = fn[:-5]
    a, s = accy.get(pid), shot.get(pid)
    if not a and not s: continue
    p = os.path.join(pdir, fn)
    d = json.load(open(p))
    if a:
        for k in a:                                  # sort year lists
            a[k] = sorted(a[k], key=lambda x: x[0] if isinstance(x, list) else x)
        d["accy"] = a; n_acc += 1
    if s:
        d["shot"] = {str(k): v for k, v in sorted(s.items())}; n_shot += 1
    json.dump(d, open(p, "w"), separators=(",", ":"), ensure_ascii=False)
print(f"augmented: {n_acc} players with accolade-years, {n_shot} with shooting profiles")
