#!/usr/bin/env python3
"""
Top up the current season's salaries from the current-salary source (robots-allowed /salaries/
and /player/ paths), in two polite passes:

  Pass 1 — 30 team pages (/salaries/<full_name_underscored>/): each embeds its
           full roster with multi-year contracts. Fast, gets most players.
  Pass 2 — per-player pages (/player/<slug>/salary/) for anyone who played the
           current season (per our search.json) but wasn't captured in pass 1 —
           i.e. offseason team-changers and extension signees whose current-team
           contract row no longer lists the just-completed season.

Season convention: the current-salary source labels seasons by START year (their 2025 = 2025-26);
our data uses END year (our 2026 = 2025-26). So our_season = hoopshype_season + 1.

Output: build/nba-salaries-current.csv (name,team,season,salary), consumed as the
highest-precedence source by fetch_salaries.py. Rows use OUR canonical player names
(from search.json) so the downstream name-join is exact.

Run:  python3 build/fetch_salaries_current.py
then: python3 build/fetch_salaries.py && python3 build/build_seo.py
"""
import csv, json, os, re, time, unicodedata, urllib.request
from collections import defaultdict

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, "..", "data")
OUT = os.path.join(HERE, "nba-salaries-current.csv")
UA = {"User-Agent": "Mozilla/5.0"}
DELAY = 0.6

meta = json.load(open(os.path.join(DATA, "meta.json")))
CUR = meta["current"]            # our end-year season (e.g. 2026)
HH = CUR - 1                      # matching salary-source start-year (e.g. 2025)
search = json.load(open(os.path.join(DATA, "search.json")))
season_cur = json.load(open(os.path.join(DATA, "season", f"{CUR}.json")))
ACTIVE_ABBR = [r["abbr"] for r in season_cur["standings"]]
full_of = {ab: meta["teams"][ab]["full"] for ab in meta["teams"]}
slug_team = lambda ab: full_of[ab].lower().replace(" ", "_")

def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn")
def norm(s):
    s = strip_accents(s).lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", s)
    return re.sub(r"\s+", " ", re.sub(r"[^a-z ]", "", s)).strip()
def player_slug(name):
    s = strip_accents(name).lower().replace(".", "").replace("'", "")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode("utf-8", "replace")
def next_data(html):
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    return json.loads(m.group(1)) if m else None

# ---- team name -> our abbr (for mapping the salary source's teamIDs) ----
name_to_abbr = {norm(nm): ab for ab, nm in meta["names"].items()}
name_to_abbr.update({norm(full_of[ab]): ab for ab in full_of})

def build_teamid_map(nd):
    """From a player page's teams query -> {salary-source teamID: our abbr}."""
    out = {}
    for item in nd["props"]["pageProps"].get("dehydratedState", {}).get("queries", []):
        data = item.get("state", {}).get("data", {})
        teams = (data or {}).get("teams", {})
        lst = teams.get("teams") if isinstance(teams, dict) else None
        if lst:
            for t in lst:
                ab = name_to_abbr.get(norm(t.get("teamName", "")))
                if ab and t.get("id"):
                    out[str(t["id"])] = ab
    return out

def contracts_from_query(nd, want_500=True):
    """Return the contracts list from either a team page ([yr,500,teamID]) or a
    single-player page (contractsSalariesSinglePlayer)."""
    for item in nd["props"]["pageProps"].get("dehydratedState", {}).get("queries", []):
        k = item.get("queryKey")
        data = item.get("state", {}).get("data", {})
        if want_500 and isinstance(k, list) and len(k) == 3 and k[1] == 500:
            return data.get("contracts", {}).get("contracts", [])
        if isinstance(k, list) and "contractsSalariesSinglePlayer" in k:
            c = data.get("contracts", {}).get("contracts", []) if isinstance(data.get("contracts"), dict) else data.get("contracts", [])
            return c or []
    return []

def cur_season_entry(contract):
    return next((s for s in contract.get("seasons", []) if s.get("season") == HH), None)

def fut_entries(contract):
    """All contract years from the current season forward -> {our_season: salary}
    (our_season = the current-salary source start-year + 1). Captures the ENTIRE remaining contract,
    not just the current season, so the site can show future guaranteed money."""
    out = {}
    for s in contract.get("seasons", []):
        hh = s.get("season")
        if hh is None or hh < HH:
            continue
        sal = int(s.get("salary", 0) or 0)
        if sal > 0:
            out[hh + 1] = sal
    return out

TEAMID = {}
rows = {}   # norm_name -> (canonical_name, abbr, {our_season: salary})

# ---------------- Pass 1: team pages ----------------
print(f"Pass 1 — {len(ACTIVE_ABBR)} team pages")
for ab in ACTIVE_ABBR:
    try:
        nd = next_data(get(f"https://hoopshype.com/salaries/{slug_team(ab)}/"))
        if not TEAMID:
            TEAMID = build_teamid_map(nd)
        for c in contracts_from_query(nd, want_500=True):
            name = c.get("playerName", "").strip()
            ents = fut_entries(c)
            if name and ents:
                e = cur_season_entry(c)
                team = TEAMID.get(str(e.get("teamID")), ab) if e else ab
                rows[norm(name)] = (name, team, ents)
    except Exception as ex:
        print(f"  ! {ab}: {ex}")
    time.sleep(DELAY)
print(f"  captured {len(rows)} players from team rosters")

# ---------------- Pass 2: per-player pages for the rest ----------------
# the current-salary source throttles rapid bursts (returns a fallback index page with no
# contractsSalariesSinglePlayer query), so we go slow and DETECT the fallback to
# distinguish "wrong slug / throttled" from "genuinely no tracked salary".
DELAY_PLAYER = 1.3
def is_player_page(nd):
    if not nd: return False
    for item in nd["props"]["pageProps"].get("dehydratedState", {}).get("queries", []):
        k = item.get("queryKey")
        if isinstance(k, list) and "contractsSalariesSinglePlayer" in k:
            return True
    return False

active = [e for e in search if e[3] == CUR]                 # played current season
missing = [e for e in active if norm(e[1]) not in rows]
print(f"Pass 2 — {len(missing)} active players not in pass 1 (slow, ~{len(missing)*DELAY_PLAYER/60:.0f} min)")
resolved = no_salary = slug_miss = 0
unresolved, slugmiss_names = [], []
for i, e in enumerate(missing):
    name = e[1]
    try:
        nd = next_data(get(f"https://hoopshype.com/player/{player_slug(name)}/salary/"))
    except Exception:
        nd = None
    if not is_player_page(nd):
        slug_miss += 1; slugmiss_names.append(name)          # wrong slug or throttled/blocked
    else:
        cs = contracts_from_query(nd, want_500=False)
        ents, team = {}, ""
        for c in cs:
            e = fut_entries(c)
            if e:
                ents = e
                ce = cur_season_entry(c)
                if ce: team = TEAMID.get(str(ce.get("teamID")), "")
                break
        if ents:
            rows[norm(name)] = (name, team, ents)
            resolved += 1
        else:
            no_salary += 1; unresolved.append(name)          # real page, no current-season salary
    if (i + 1) % 25 == 0:
        print(f"  ...{i+1}/{len(missing)} (resolved {resolved}, no-salary {no_salary}, slug/throttle miss {slug_miss})")
    time.sleep(DELAY_PLAYER)
print(f"  pass 2: resolved {resolved} · no tracked salary {no_salary} · slug/throttle miss {slug_miss}")
if slugmiss_names:
    print("  slug/throttle-miss (retry later): " + ", ".join(slugmiss_names[:30]) + (" …" if len(slugmiss_names) > 30 else ""))

# ---------------- write ----------------
# one row per (player, season) — full contract length, not just the current year
out_rows = sorted(([name, team, season, sal] for (name, team, ents) in rows.values()
                   for season, sal in ents.items()), key=lambda r: (r[0], r[2]))
with open(OUT, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["name", "team", "season", "salary"])
    w.writerows(out_rows)
_players = len(rows); _seasons = sorted({r[2] for r in out_rows})
print(f"\nwrote {OUT}: {len(out_rows)} contract-years for {_players} players "
      f"(seasons {_seasons[0]}–{_seasons[-1]})" if out_rows else f"\nwrote {OUT}: 0 rows")
print("next: python3 build/fetch_salaries.py && python3 build/build_seo.py")
