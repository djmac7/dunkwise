#!/usr/bin/env python3
"""
Build data/salaries.json by merging several OPEN, publicly-published salary
datasets (salaries are facts, not copyrightable). Figures are nominal (not
inflation adjusted). Coverage: 1990-91 through the current season + future deals.

Sources (precedence high->low per player-season):
  1. a public salary dataset  nba-salaries.csv   — 2000-2020, has team (full name)
  2. a public salary dataset  "NBA Player Stats and Salaries_2010-2025.csv"
       — 2010-2025, team as tricode; used to fill 2021-2025 with team info
  3. a public salary dataset  "NBA Player Salaries_2000-2025.csv"
       — 2000-2025, no team; backfills any 2021-2025 player-season missing above
  4. a public salary dataset  NBASalaries1990to2016.csv (from the reference source)
       — season-gated to the pre-2000 gap (1991-1999); team dropped, re-derived from logs

We deliberately do NOT scrape the contract reference (its ToS forbids automated scraping and its
contract database is a licensed commercial product). the current-salary source's /salaries/ is
robots-allowed and is a fine manual top-up source if you ever need the in-progress
season; drop a CSV at build/nba-salaries-current.csv (name,team,season,salary) and
it will be merged in as source 0 (highest precedence).

Drop any local CSV to override a remote fetch (see LOCAL_* paths).
Re-run:  python3 build/fetch_salaries.py   then   python3 build/build_seo.py
"""
import csv, io, json, os, re, unicodedata, urllib.request
from collections import defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, "..", "data")

SRC_ERIK = "https://raw.githubusercontent.com/erikgregorywebb/datasets/master/nba-salaries.csv"
SRC_STATSAL = "https://raw.githubusercontent.com/edwinjeon/NBA-Salary-Prediction/main/data/NBA%20Player%20Stats%20and%20Salaries_2010-2025.csv"
SRC_SALONLY = "https://raw.githubusercontent.com/edwinjeon/NBA-Salary-Prediction/main/data/NBA%20Player%20Salaries_2000-2025.csv"
# Historical backfill: per-team salaries 1990-91 → 2015-16, sourced from the reference source.
# We use it only for the pre-2000 gap (1991-1999) below our other sources' floor; verified
# against known-true figures (Jordan 1997-98 = $33.14M to the dollar). Team names are dropped
# on ingest — attribution is re-derived stint-accurately from player logs in fix_salary_teams.py.
SRC_HIST = "https://raw.githubusercontent.com/datadavis2/nbasalaries/master/NBASalaries1990to2016.csv"
LOCAL_ERIK = os.path.join(HERE, "nba-salaries.csv")
LOCAL_STATSAL = os.path.join(HERE, "nba-statsalaries.csv")
LOCAL_SALONLY = os.path.join(HERE, "nba-salaries-2000-2025.csv")
LOCAL_HIST = os.path.join(HERE, "nba-salaries-1990-2016.csv")
LOCAL_CURRENT = os.path.join(HERE, "nba-salaries-current.csv")  # optional manual top-up: name,team,season,salary

def fetch(url, local):
    if os.path.exists(local):
        print(f"using local {os.path.basename(local)}")
        return open(local, "rb").read()
    print(f"fetching {url.rsplit('/',1)[-1]}")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=30).read()

def rows_of(raw):
    return list(csv.DictReader(io.StringIO(raw.decode("utf-8", "replace"))))

def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn")
def norm(s):
    s = strip_accents(s).lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", s)
    s = re.sub(r"[^a-z ]", "", s)
    return re.sub(r"\s+", " ", s).strip()

# ---- our canonical players + team names ----
search = json.load(open(os.path.join(DATA, "search.json")))
by_name = defaultdict(list)
for e in search:
    by_name[norm(e[1])].append((e[0], e[2], e[3]))
meta = json.load(open(os.path.join(DATA, "meta.json")))
name_to_abbr = {norm(nm): ab for ab, nm in meta["names"].items()}
TEAM_ALIAS = {
    "la clippers": "LAC", "los angeles clippers": "LAC", "la lakers": "LAL",
    "golden state warriors": "GSW", "portland trail blazers": "POR",
    "new orleans hornets": "NOH", "new orleans/oklahoma city hornets": "NOK",
    "charlotte bobcats": "CHA", "new jersey nets": "NJN", "seattle supersonics": "SEA",
    "washington wizards": "WAS", "utah jazz": "UTA", "phoenix suns": "PHX", "brooklyn nets": "BKN",
}
TRICODE_ALIAS = {"BRK": "BKN", "CHO": "CHA", "PHO": "PHX"}  # bbref/stats tricodes -> our abbrs
VALID_ABBR = set(meta["teams"].keys())

def team_from_name(name):
    n = norm(name)
    return name_to_abbr.get(n) or TEAM_ALIAS.get(n)
def team_from_tricode(code):
    code = (code or "").strip().upper()
    if not code or code in ("TOT", "2TM", "3TM"): return None
    ab = TRICODE_ALIAS.get(code, code)
    return ab if ab in VALID_ABBR else None

def match_player(name, season):
    cands = by_name.get(norm(name))
    if not cands: return None
    covering = [c for c in cands if c[1] <= season <= c[2]]
    if covering: return covering[0][0]
    return min(cands, key=lambda c: min(abs(season - c[1]), abs(season - c[2])))[0]

# ---- merge sources into unified {(norm_name, season): {"salary":..,"team":abbr,"name":raw}} ----
merged = {}
def add(name, season, salary, team_abbr, precedence):
    """precedence: lower number wins; only overwrite if strictly higher priority
    or if it adds a team where none existed."""
    if not name or salary is None or salary <= 0: return
    k = (norm(name), season)
    cur = merged.get(k)
    if cur is None:
        merged[k] = {"name": name, "salary": salary, "team": team_abbr, "prec": precedence}
    elif precedence < cur["prec"]:
        merged[k] = {"name": name, "salary": salary, "team": team_abbr, "prec": precedence}
    elif team_abbr and not cur["team"]:
        cur["team"] = team_abbr  # enrich with team without changing the salary

def to_int(v):
    try: return int(float(str(v).replace("$", "").replace(",", "")))
    except (ValueError, TypeError): return None

counts = defaultdict(int)

# source 0 (optional) manual current-season top-up: name,team,season,salary
if os.path.exists(LOCAL_CURRENT):
    for r in rows_of(open(LOCAL_CURRENT, "rb").read()):
        s, sal = to_int(r.get("season")), to_int(r.get("salary"))
        if s and sal:
            add(r.get("name", ""), s, sal, team_from_tricode(r.get("team", "")) or team_from_name(r.get("team", "")), 0)
            counts["current"] += 1

# source 1: public dataset, 2000-2020 (authoritative, has team full-name)
for r in rows_of(fetch(SRC_ERIK, LOCAL_ERIK)):
    s, sal = to_int(r.get("season")), to_int(r.get("salary"))
    if s and sal:
        add((r.get("name") or "").strip(), s, sal, team_from_name(r.get("team") or ""), 1)
        counts["erik"] += 1

# source 2: edwin stats+salaries 2010-2025 (team as tricode) — fills 2021-2025 w/ team
for r in rows_of(fetch(SRC_STATSAL, LOCAL_STATSAL)):
    pkey = next((k for k in r if k.lstrip("﻿").lower() == "player"), "Player")
    name = (r.get(pkey) or "").strip()
    s, sal = to_int(r.get("Year")), to_int(r.get("Salary"))
    if s and sal:
        add(name, s, sal, team_from_tricode(r.get("Team")), 2)
        counts["statsal"] += 1

# source 3: edwin salaries-only 2000-2025 (no team) — backfill remaining player-seasons
for r in rows_of(fetch(SRC_SALONLY, LOCAL_SALONLY)):
    s, sal = to_int(r.get("Season")), to_int(r.get("Salary"))
    if s and sal:
        add((r.get("Player") or "").strip(), s, sal, None, 3)
        counts["salonly"] += 1

# source 4: historical backfill for the pre-2000 gap only (1991-1999). Lowest precedence and
# season-gated, so it never touches a player-season any 2000+ source already carries — it only
# adds the years below our floor. Team=None: fix_salary_teams.py derives era-accurate teams from
# player logs (which handle mid-season trades that this single-team-per-season source cannot).
for r in rows_of(fetch(SRC_HIST, LOCAL_HIST)):
    s, sal = to_int(r.get("Season_End")), to_int(r.get("Salary"))
    if s and sal and s < 2000:
        add((r.get("Player") or "").strip(), s, sal, None, 4)
        counts["hist"] += 1

# ---- match to players + assemble outputs (same schema as before) ----
by_player = defaultdict(list)      # pid -> [[season, salary]]
team_pay = defaultdict(float)      # (abbr, season) -> total
all_rows = []                      # (pid, name, abbr, season, salary)
seasons = set()
matched = unmatched = 0
for (nn, season), v in merged.items():
    salary, ab, name = v["salary"], v["team"], v["name"]
    seasons.add(season)
    pid = match_player(name, season)
    if pid:
        by_player[pid].append([season, salary]); matched += 1
    else:
        unmatched += 1
    if ab: team_pay[(ab, season)] += salary
    all_rows.append((pid, name, ab, season, salary))

for pid in by_player:
    by_player[pid].sort()
career_earn = {pid: sum(s for _, s in arr) for pid, arr in by_player.items()}

top_all = sorted(all_rows, key=lambda x: -x[4])[:60]
top_all = [[p, n, a, s, sal] for (p, n, a, s, sal) in top_all]

# inflation-adjusted all-time (restate every salary in base-year dollars, then rank)
try:
    _cpi = json.load(open(os.path.join(DATA, "cpi.json")))
    CPI, BASE = _cpi["cpi"], _cpi["base"]
    def adj(sal, season):
        c = CPI.get(str(season))
        return int(sal * CPI[str(BASE)] / c) if c else sal
    top_all_real = sorted(all_rows, key=lambda x: -adj(x[4], x[3]))[:60]
    top_all_real = [[p, n, a, s, adj(sal, s)] for (p, n, a, s, sal) in top_all_real]
except FileNotFoundError:
    top_all_real = top_all

by_season = defaultdict(list)
for (p, n, a, s, sal) in all_rows:
    by_season[s].append([p, n, a, sal])
for s in by_season:                                   # full list per season (hub filters/paginates)
    by_season[s] = sorted(by_season[s], key=lambda x: -x[3])

team_payroll = defaultdict(list)
for (ab, s), tot in team_pay.items():
    team_payroll[ab].append([s, int(tot)])
for ab in team_payroll:
    team_payroll[ab].sort()
payroll_rank = defaultdict(list)
for (ab, s), tot in team_pay.items():
    payroll_rank[s].append([ab, int(tot)])
for s in payroll_rank:
    payroll_rank[s].sort(key=lambda x: -x[1])

out = {
    "fetched": datetime.now(timezone.utc).isoformat(),
    "range": [min(seasons), max(seasons)] if seasons else None,
    "note": "Nominal salaries (not inflation-adjusted). Merged from public open datasets.",
    "byPlayer": by_player,
    "careerEarn": career_earn,
    "topAllTime": top_all,
    "topAllTimeReal": top_all_real,
    "bySeason": by_season,
    "teamPayroll": team_payroll,
    "payrollRank": payroll_rank,
}
os.makedirs(DATA, exist_ok=True)
with open(os.path.join(DATA, "salaries.json"), "w") as f:
    json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
print("source rows:", dict(counts))
print(f"seasons {min(seasons)}-{max(seasons)} · player-seasons {len(merged)} · "
      f"players {len(by_player)} · matched {matched} / unmatched {unmatched}")
print("wrote data/salaries.json")

# backfill team attribution from player logs + recompute team totals
import subprocess, sys
subprocess.run([sys.executable, os.path.join(HERE, "fix_salary_teams.py")], check=True)
# IMPORTANT: some upstream CSVs are inflation-adjusted (not nominal) for 2017-18 and
# 2020-21..2023-24. Re-apply the reference-source-verified figures last so a rebuild
# can never re-introduce the ~20% salary inflation. (See build/apply_salary_overrides.py.)
subprocess.run([sys.executable, os.path.join(HERE, "apply_salary_overrides.py")], check=True)
# Apply reference-source-verified per-team salary splits (dead-money re-attribution for
# bought-out vets) + 2025-26 fills. Must run after overrides so it splits corrected totals.
subprocess.run([sys.executable, os.path.join(HERE, "apply_salary_splits.py")], check=True)
# NOTE: run build/restore_future_salaries.py after this to re-attach 2027+ contract years.
