#!/usr/bin/env python3
"""One-off: extend data/salaries.json with the FULL future contract length.

the current-salary source's team pages already carry every guaranteed year of a contract, but the
pipeline only kept the current season (plus one the live source forward year), so the site
could only show through 2026-27. This walks the 30 team pages, pulls each player's
remaining contract years, matches them to our player ids, and adds the future years
(> current season) to byPlayer / bySeason / range / payrollRank / teamPayroll.

Only ADDS seasons a player doesn't already have — existing rows are untouched, and
careerEarn (earned-to-date) is deliberately left alone. The extraction mirrors
build/fetch_salaries_current.py, which now emits full contracts for future refreshes.
"""
import json, os, re, time, unicodedata, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

meta = json.load(open(os.path.join(DATA, "meta.json")))
CUR = meta["current"]; HH = CUR - 1
full_of = {ab: meta["teams"][ab]["full"] for ab in meta["teams"]}
slug_team = lambda ab: full_of[ab].lower().replace(" ", "_")
ACTIVE = list(meta["teams"].keys())


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn")
def norm(s):
    s = strip_accents(s).lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", s)
    return re.sub(r"\s+", " ", re.sub(r"[^a-z ]", "", s)).strip()
def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode("utf-8", "replace")
def next_data(html):
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    return json.loads(m.group(1)) if m else None
def contracts_from_query(nd):
    for item in nd["props"]["pageProps"].get("dehydratedState", {}).get("queries", []):
        k = item.get("queryKey"); data = item.get("state", {}).get("data", {})
        if isinstance(k, list) and len(k) == 3 and k[1] == 500:
            return data.get("contracts", {}).get("contracts", [])
    return []
def fut_entries(contract):
    out = {}
    for s in contract.get("seasons", []):
        hh = s.get("season")
        if hh is None or hh < HH:
            continue
        v = int(s.get("salary", 0) or 0)
        if v > 0:
            out[hh + 1] = v          # our season = salary-source start-year + 1
    return out


# name -> player id (prefer the player active in the current era)
search = json.load(open(os.path.join(DATA, "search.json")))
by_name, pid2name = {}, {}
for e in search:
    by_name.setdefault(norm(e[1]), []).append((e[0], e[2], e[3])); pid2name[e[0]] = e[1]
def match_pid(name):
    cands = by_name.get(norm(name))
    if not cands:
        return None
    cov = [c for c in cands if c[1] <= CUR <= c[2]]
    return (cov[0] if cov else max(cands, key=lambda c: c[2]))[0]


fetched, unmatched = {}, []
for ab in ACTIVE:
    try:
        nd = next_data(get(f"https://hoopshype.com/salaries/{slug_team(ab)}/"))
        for c in contracts_from_query(nd):
            name = (c.get("playerName") or "").strip()
            ents = fut_entries(c)
            if not name or not ents:
                continue
            pid = match_pid(name)
            if pid:
                fetched[pid] = (ab, ents)
            else:
                unmatched.append(name)
    except Exception as ex:
        print("  !", ab, ex)
    time.sleep(0.4)
print(f"fetched contracts for {len(fetched)} players; {len(unmatched)} unmatched names")

sal = json.load(open(os.path.join(DATA, "salaries.json")))
byP, byS = sal["byPlayer"], sal["bySeason"]
added, maxseason = 0, sal["range"][1]
for pid, (ab, ents) in fetched.items():
    have = {r[0] for r in byP.get(pid, [])}
    for season, amount in ents.items():
        if season <= CUR or season in have:      # only future, never overwrite
            continue
        byP.setdefault(pid, []).append([season, amount])
        byS.setdefault(str(season), []).append([pid, pid2name.get(pid, ""), ab, amount])
        added += 1
        maxseason = max(maxseason, season)
for pid, _ in fetched.items():
    byP[pid].sort(key=lambda r: r[0])
for s in byS:
    byS[s].sort(key=lambda r: -r[3])
sal["range"][1] = maxseason
# rebuild team-payroll rollups for the newly added seasons
for season in range(CUR + 1, maxseason + 1):
    tot = {}
    for pid, nm, ab, amount in byS.get(str(season), []):
        tot[ab] = tot.get(ab, 0) + amount
    if tot:
        sal["payrollRank"][str(season)] = sorted(([ab, v] for ab, v in tot.items()), key=lambda x: -x[1])
        for ab, v in tot.items():
            sal["teamPayroll"].setdefault(ab, []).append([season, v])
for ab in sal["teamPayroll"]:
    sal["teamPayroll"][ab].sort(key=lambda r: r[0])
json.dump(sal, open(os.path.join(DATA, "salaries.json"), "w"), separators=(",", ":"), ensure_ascii=False)
print(f"added {added} future contract-years; range now {sal['range']}")
