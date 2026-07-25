#!/usr/bin/env python3
"""
Live refresh from the live source's public JSON API -> data/*.json.

The bundled dataset is a fixed historical snapshot that ends at the 2025-26 season.
The live source's public endpoints are reachable and, in this
environment, report the same 2026 timeline as our data — so we can layer the
freshest bits on top without conflicting with the historical set.

Modules (run all, or pass names):
  draft      -> data/draft/2026.json  (+ registers the year in meta.draftYears)

Usage:  python3 build/fetch_live.py [draft ...]
Schedule it (cron / launchd) to keep the offseason current. No API key needed.
"""
import json, os, re, sys, unicodedata, urllib.request

BASE = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(BASE, "data")
UA = {"User-Agent": "Mozilla/5.0 (DunkwiseBot; live refresh)"}
SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
DRAFT_YEAR = 2026

# the live source uses a few different team abbreviations than we do.
ABBR = {"NY": "NYK", "SA": "SAS", "GS": "GSW", "UTAH": "UTA", "WSH": "WAS", "NO": "NOP", "PHO": "PHX"}
def our_abbr(e): return ABBR.get(e, e)


def get(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25).read().decode("utf-8"))


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[.'’‘`]", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def name_index():
    idx = {}
    for e in json.load(open(os.path.join(DATA, "search.json"))):
        idx.setdefault(norm(e[1]), []).append(((e[3] or 0), e[0]))
    for k in idx:
        idx[k].sort(reverse=True)
    return idx


def draft():
    d = get(f"{SITE}/draft")
    year = d.get("year") or DRAFT_YEAR
    teams = {str(t["id"]): our_abbr(t.get("abbreviation", "")) for t in d.get("teams", [])}
    idx = name_index()
    picks = []
    for p in d.get("picks", []):
        a = p.get("athlete") or {}
        nm = a.get("displayName") or ""
        if not nm:
            continue
        college = ((a.get("college") or {}).get("name")) or ""
        hit = idx.get(norm(nm))                      # link only if the player already has a page
        pid = hit[0][1] if hit else ""
        picks.append([p.get("overall"), p.get("round"), teams.get(str(p.get("teamId")), ""), pid, nm, college])
    picks.sort(key=lambda x: (x[0] is None, x[0] or 0))
    out = os.path.join(DATA, "draft", f"{year}.json")
    with open(out, "w") as f:
        json.dump({"year": year, "picks": picks}, f, separators=(",", ":"), ensure_ascii=False)
    # make the year selectable
    meta = json.load(open(os.path.join(DATA, "meta.json")))
    yrs = sorted(set(meta.get("draftYears", []) + [year]), reverse=True)
    meta["draftYears"] = yrs
    with open(os.path.join(DATA, "meta.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"), ensure_ascii=False)
    print(f"draft {year}: {len(picks)} picks -> data/draft/{year}.json ({sum(1 for p in picks if p[3])} linked to existing players)")


def contracts():
    """Refresh current+future contract years on data/salaries.json from the live source rosters
    (whose figures match the reference-source gold standard).

    Unlike the old add-only version this OVERWRITES future-year (> current season)
    figures and teams every run, so trades, re-signings and extensions actually
    propagate instead of freezing the first value ever seen. A rostered player's
    current team is applied to ALL of his future years — the whole guaranteed
    contract travels with the player — which corrects the out-years the live source doesn't
    itemize. Long-term years the live source omits keep their stored (the contract reference-aligned) figure,
    so we never lose the far-out guaranteed money the live source's short array can't see.

    Never touched: seasons <= current (completed/historical), careerEarn, and the
    all-time salary leaderboards (topAllTime / topAllTimeReal) — all defined as
    through-current-season only."""
    sal = json.load(open(os.path.join(DATA, "salaries.json")))
    meta = json.load(open(os.path.join(DATA, "meta.json")))
    CUR = meta["current"]
    idx = name_index()
    pid2name = {e[0]: e[1] for e in json.load(open(os.path.join(DATA, "search.json")))}

    # existing team per (pid, season) — byPlayer carries no team, bySeason does
    stored_team = {}
    for s, rows in sal["bySeason"].items():
        for pid, nm, ab, v in rows:
            stored_team[(pid, int(s))] = ab

    # ---- pull the live source: current team + each contract year (> CUR) per rostered player ----
    espn_team, espn_year, matched = {}, {}, 0
    teams = get(f"{SITE}/teams")["sports"][0]["leagues"][0]["teams"]
    for t in teams:
        tid = t["team"]["id"]
        r = get(f"{SITE}/teams/{tid}/roster")
        ab = our_abbr((r.get("team") or {}).get("abbreviation", ""))
        for a in r.get("athletes", []):
            hit = idx.get(norm(a.get("fullName", "")))
            if not hit:
                continue
            pid = hit[0][1]; matched += 1
            espn_team[pid] = ab
            for c in (a.get("contracts") or []):
                yr = (c.get("season") or {}).get("year")
                salv = c.get("salary")
                if yr and salv is not None and yr > CUR:
                    espn_year.setdefault(pid, {})[yr] = int(salv)

    # ---- rebuild the future portion (> CUR) of byPlayer, and the team for each row ----
    fut_team = {}                                     # (pid, year) -> team abbr
    for pid, arr in list(sal["byPlayer"].items()):
        keep = [row for row in arr if row[0] <= CUR]
        futrows = {row[0]: row[1] for row in arr if row[0] > CUR}   # stored out-years
        futrows.update(espn_year.get(pid, {}))                       # overwrite/add ESPN years
        cur_ab = espn_team.get(pid)                                  # rostered -> current team wins
        for yr, salv in futrows.items():
            keep.append([yr, salv])
            fut_team[(pid, yr)] = cur_ab or stored_team.get((pid, yr))
        keep.sort()
        sal["byPlayer"][pid] = keep
    for pid, years in espn_year.items():              # brand-new players not in byPlayer
        if pid not in sal["byPlayer"]:
            sal["byPlayer"][pid] = sorted([yr, salv] for yr, salv in years.items())
            for yr in years:
                fut_team[(pid, yr)] = espn_team.get(pid)

    # ---- rebuild bySeason / teamPayroll / payrollRank for seasons > CUR from byPlayer ----
    for s in [s for s in sal["bySeason"] if int(s) > CUR]:
        del sal["bySeason"][s]
    for ab in sal["teamPayroll"]:
        sal["teamPayroll"][ab] = [r for r in sal["teamPayroll"][ab] if r[0] <= CUR]
    for s in [s for s in sal["payrollRank"] if int(s) > CUR]:
        del sal["payrollRank"][s]

    fut_seasons = sorted({yr for arr in sal["byPlayer"].values() for yr, _ in arr if yr > CUR})
    for season in fut_seasons:
        rows, tot = [], {}
        for pid, arr in sal["byPlayer"].items():
            salv = next((v for yy, v in arr if yy == season), None)
            if salv is None:
                continue
            ab = fut_team.get((pid, season)) or ""
            rows.append([pid, pid2name.get(pid, ""), ab, salv])
            if ab:
                tot[ab] = tot.get(ab, 0) + salv
        rows.sort(key=lambda x: -x[3])
        sal["bySeason"][str(season)] = rows
        sal["payrollRank"][str(season)] = sorted(([ab, v] for ab, v in tot.items()), key=lambda x: -x[1])
        for ab, v in tot.items():
            sal["teamPayroll"].setdefault(ab, []).append([season, v])
    for ab in list(sal["teamPayroll"]):
        sal["teamPayroll"][ab].sort()
        if not sal["teamPayroll"][ab]:
            del sal["teamPayroll"][ab]

    all_seasons = {yr for arr in sal["byPlayer"].values() for yr, _ in arr}
    sal["range"] = [min(all_seasons), max(all_seasons)]
    with open(os.path.join(DATA, "salaries.json"), "w") as f:
        json.dump(sal, f, separators=(",", ":"), ensure_ascii=False)
    lo = fut_seasons[0] if fut_seasons else "-"; hi = fut_seasons[-1] if fut_seasons else "-"
    print(f"contracts: {matched} roster matches; refreshed future seasons {lo}-{hi}; range {sal['range']}")


def rosters():
    """Replace each team's roster with the live source's current roster (reflects offseason
    trades / signings). Stats come from each player's own cur line; unmatched
    incomers (rookies not yet in the historical set) are skipped."""
    search = json.load(open(os.path.join(DATA, "search.json")))
    meta_cur = json.load(open(os.path.join(DATA, "meta.json")))["current"]
    # the live source fullName -> our stored name, for players the live source lists under a different form
    # (e.g. "Ronald Holland II" vs our "Ron Holland") so the roster match doesn't drop them.
    NAME_ALIAS = {"ronald holland": "ron holland"}
    idx, pid2name = {}, {}
    for e in search:
        idx.setdefault(norm(e[1]), []).append(((e[3] or 0), e[0])); pid2name[e[0]] = e[1]
    for k in idx:
        idx[k].sort(reverse=True)
    pcache = {}
    def cur(pid):
        if pid not in pcache:
            try: pcache[pid] = json.load(open(os.path.join(DATA, "player", f"{pid}.json"))).get("cur", {})
            except Exception: pcache[pid] = {}
        return pcache[pid]
    teams = get(f"{SITE}/teams")["sports"][0]["leagues"][0]["teams"]
    updated = 0
    for t in teams:
        r = get(f"{SITE}/teams/{t['team']['id']}/roster")
        ab = our_abbr((r.get("team") or {}).get("abbreviation", ""))
        tf = os.path.join(DATA, "team", f"{ab}.json")
        if not os.path.exists(tf):
            continue
        roster, seen = [], set()
        for a in r.get("athletes", []):
            key = norm(a.get("fullName", ""))
            hit = idx.get(key) or idx.get(NAME_ALIAS.get(key, "\x00"))
            if not hit or hit[0][1] in seen:
                continue
            pid = hit[0][1]; seen.add(pid)
            pos = (a.get("position") or {}).get("abbreviation", "") or ""
            c = cur(pid)
            roster.append([pid, pid2name.get(pid, a.get("fullName")), pos, c.get("g"), c.get("pts"), c.get("trb"), c.get("ast")])
            # keep the player's own current team in sync with the live roster, so a
            # traded player's masthead reflects his new team (not last season's).
            pf = os.path.join(DATA, "player", f"{pid}.json")
            if c.get("season") == meta_cur and c.get("team") != ab and os.path.exists(pf):
                pj = json.load(open(pf)); pj.setdefault("cur", {})["team"] = ab
                json.dump(pj, open(pf, "w"), separators=(",", ":"), ensure_ascii=False)
                pcache[pid] = pj["cur"]
        if not roster:
            continue
        roster.sort(key=lambda x: (x[4] is None, -(x[4] or 0)))
        tj = json.load(open(tf))
        tj["roster"] = roster
        with open(tf, "w") as f:
            json.dump(tj, f, separators=(",", ":"), ensure_ascii=False)
        updated += 1
    print(f"rosters: refreshed {updated} teams from ESPN current rosters")


STYPE = {1: "Preseason", 2: "Regular Season", 3: "Playoffs", 4: "Play-In"}


def scores():
    """Append newly-final games to the season index + a minimal detail file.
    Dedupes on (date, home, away) so re-runs and the existing dataset never
    duplicate. Run daily during the season and each night's games flow in."""
    sb = get(f"{SITE}/scoreboard")
    season = (sb.get("season") or {}).get("year")
    # the scoreboard's day.date is the US game date (matches our dataset); the
    # per-event date is UTC, which would shift late games to the next day.
    date = (sb.get("day") or {}).get("date")
    if not season or not date:
        print("scores: no season/day"); return
    gp = os.path.join(DATA, "games", f"{season}.json")
    idxf = json.load(open(gp)) if os.path.exists(gp) else {"season": season, "games": []}
    have = {(g["date"], g["h"], g["a"]) for g in idxf["games"]}
    added = 0
    for e in sb.get("events", []):
        c = e["competitions"][0]
        if c["status"]["type"]["name"] != "STATUS_FINAL":
            continue
        comp = {t["homeAway"]: t for t in c["competitors"]}
        h, a = comp.get("home"), comp.get("away")
        if not h or not a:
            continue
        hab, aab = our_abbr(h["team"]["abbreviation"]), our_abbr(a["team"]["abbreviation"])
        if (date, hab, aab) in have:
            continue
        gid, styp = e["id"], STYPE.get((e.get("season") or {}).get("type"), "")
        sc = lambda t: int(float(t.get("score") or 0))
        idxf["games"].append({"id": gid, "date": date, "type": styp, "label": "", "h": hab, "hs": sc(h), "a": aab, "as": sc(a)})
        have.add((date, hab, aab)); added += 1
        ln = lambda t: {"abbr": our_abbr(t["team"]["abbreviation"]), "score": sc(t),
                        "q": [int(float(l["displayValue"])) for l in t.get("linescores", []) if l.get("displayValue")]}
        detail = {"id": gid, "date": date, "season": season, "type": styp, "label": "",
                  "arena": "", "arenaCity": "", "attendance": None, "officials": "",
                  "home": ln(h), "away": ln(a), "box": {"home": [], "away": []}}
        with open(os.path.join(DATA, "game", f"{gid}.json"), "w") as f:
            json.dump(detail, f, separators=(",", ":"), ensure_ascii=False)
    idxf["games"].sort(key=lambda g: (g["date"], g["id"]))
    with open(gp, "w") as f:
        json.dump(idxf, f, separators=(",", ":"), ensure_ascii=False)
    print(f"scores: season {season}, +{added} final game(s)")


def standings():
    """Refresh W/L for the current season's standings (safe — leaves the richer
    ORtg/DRtg/SRS untouched on seasons we already have; builds a minimal
    standings list for a brand-new season)."""
    season = (get(f"{SITE}/scoreboard").get("season") or {}).get("year")
    st = get("https://site.api.espn.com/apis/v2/sports/basketball/nba/standings")
    ent, seen = [], set()
    def walk(o):
        if isinstance(o, dict):
            s = o.get("standings")
            if isinstance(s, dict) and isinstance(s.get("entries"), list):
                for x in s["entries"]:
                    tid = x.get("team", {}).get("id")
                    if tid not in seen: seen.add(tid); ent.append(x)
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(st)
    def statmap(e): return {s["name"]: s.get("value") for s in e.get("stats", [])}
    rows = {}
    for e in ent:
        ab = our_abbr(e["team"].get("abbreviation", "")); m = statmap(e)
        rows[ab] = (int(m.get("wins") or 0), int(m.get("losses") or 0), m.get("avgPointsFor"), m.get("avgPointsAgainst"), m.get("pointDifferential"))
    if not rows:
        print("standings: none"); return
    sp = os.path.join(DATA, "season", f"{season}.json")
    if os.path.exists(sp):
        sj = json.load(open(sp))
        for r in sj.get("standings", []):
            if r["abbr"] in rows:
                r["w"], r["l"] = rows[r["abbr"]][0], rows[r["abbr"]][1]
        with open(sp, "w") as f:
            json.dump(sj, f, separators=(",", ":"), ensure_ascii=False)
        print(f"standings: updated W/L for {len(rows)} teams · season {season}")
    else:
        meta = json.load(open(os.path.join(DATA, "meta.json")))
        std = []
        for ab, (w, l, pf, pa, pd) in rows.items():
            m = meta["teams"].get(ab, {})
            std.append({"abbr": ab, "name": m.get("full", ab), "w": w, "l": l, "po": False,
                        "o": round(pf, 1) if pf else None, "d": round(pa, 1) if pa else None,
                        "srs": round(pd / (w + l), 1) if (w + l) else None})
        std.sort(key=lambda x: -(x["w"] / max(1, x["w"] + x["l"])))
        with open(sp, "w") as f:
            json.dump({"season": season, "lg": "NBA", "leaders": {}, "standings": std, "champion": None, "mvp": None, "honors": {}}, f, separators=(",", ":"), ensure_ascii=False)
        print(f"standings: created new season {season} with {len(std)} teams")


# In the offseason the live source's /injuries feed is dominated by transaction / draft / rest
# blurbs it defaults to "Day-To-Day" — notes that have nothing to do with an injury.
# Keep only players genuinely sidelined by injury, normalise the status to "Out", and
# tag the injury type. (Mirrored in build/clean_offseason_data.py.)
_SIDELINED = ["miss the remainder", "season-ending", "season ending", "out for the season",
              "remainder of the 2025-26", "remainder of the season", "torn", "ruptured",
              "tearing", "lisfranc", "sesamoid", "venous condition", "will require surgery",
              "undergo surgery", "underwent surgery", "undergoing surgery", "set to undergo",
              "ruled out for the"]
_BODY = ["acl", "achilles", "patellar tendon", "patellar", "ucl", "lisfranc", "hamstring",
         "knee", "ankle", "wrist", "forearm", "thumb", "finger", "foot", "calf", "hip",
         "back", "shoulder", "elbow", "quad", "neck", "oblique", "groin", "toe", "heel"]


def _is_injury(note, status):
    n = (note or "").lower()
    if "not injury related" in n:
        return False
    if (status or "") == "Out":
        return True
    return any(s in n for s in _SIDELINED)


def _injury_type(note):
    m = re.match(r"^[^()]+\(([^)]+)\)", note or "")
    tag = (m.group(1).strip().lower() if m else "")
    if tag and tag.split()[0] in _BODY:
        return tag.upper() if tag in ("acl", "ucl") else tag.title()
    n = (note or "").lower()
    for b in _BODY:
        if re.search(r"\b" + re.escape(b) + r"\b", n):
            return b.upper() if b in ("acl", "ucl") else b.title()
    return "Injury"


def injuries():
    """Current injury report from the live source -> data/injuries.json (by player + by team).
    Filtered to genuine injuries only; see _is_injury above."""
    meta = json.load(open(os.path.join(DATA, "meta.json")))
    name2ab = {v.get("full"): k for k, v in meta["teams"].items()}
    idx = name_index()
    d = get(f"{SITE}/injuries")
    by_player, by_team = {}, {}
    n = 0
    for grp in d.get("injuries", []):
        ab = name2ab.get(grp.get("displayName", ""), "")
        for inj in grp.get("injuries", []):
            nm = (inj.get("athlete") or {}).get("displayName") or ""
            if not nm:
                continue
            note = (inj.get("shortComment") or (inj.get("type") or {}).get("description") or "").strip()
            if not _is_injury(note, inj.get("status")):
                continue
            n += 1
            hit = idx.get(norm(nm)); pid = hit[0][1] if hit else None
            rec = {"status": "Out", "injury": _injury_type(note), "note": note[:180], "date": (inj.get("date") or "")[:10]}
            if pid:
                by_player[pid] = dict(rec, team=ab)
            if ab:
                by_team.setdefault(ab, []).append(dict(rec, pid=pid, name=nm))
    out = {"count": n, "byPlayer": by_player, "byTeam": by_team}
    with open(os.path.join(DATA, "injuries.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print(f"injuries: {n} genuine injuries · {len(by_player)} matched to players · {len(by_team)} teams")


def odds():
    """Game lines (spread / total / moneyline) from the odds provider -> data/odds.json.
    Free tier: set ODDS_API_KEY (the-odds-api.com). Keyed by AWAY@HOME (our abbrs)."""
    key = os.environ.get("ODDS_API_KEY")
    if not key:
        print("odds: set ODDS_API_KEY (free tier at the-odds-api.com) to enable — skipping"); return
    meta = json.load(open(os.path.join(DATA, "meta.json")))
    name2ab = {v.get("full"): k for k, v in meta["teams"].items()}
    url = f"https://api.the-odds-api.com/v4/sports/basketball_nba/odds?apiKey={key}&regions=us&markets=h2h,spreads,totals&oddsFormat=american"
    events = json.loads(urllib.request.urlopen(url, timeout=25).read().decode("utf-8"))
    by_game, book = {}, "consensus"
    for e in events:
        h, a = name2ab.get(e.get("home_team")), name2ab.get(e.get("away_team"))
        if not h or not a:
            continue
        bk = (e.get("bookmakers") or [{}])[0]; book = bk.get("title", book)
        rec = {}
        for m in bk.get("markets", []):
            outs = m.get("outcomes", [])
            if m.get("key") == "totals" and outs:
                rec["total"] = outs[0].get("point")
            elif m.get("key") == "spreads":
                for o in outs:
                    if name2ab.get(o.get("name")) == h:
                        rec["spread"] = o.get("point")
            elif m.get("key") == "h2h":
                for o in outs:
                    ab = name2ab.get(o.get("name"))
                    if ab == h: rec["mlH"] = o.get("price")
                    if ab == a: rec["mlA"] = o.get("price")
        by_game[f"{a}@{h}"] = rec
    with open(os.path.join(DATA, "odds.json"), "w") as f:
        json.dump({"book": book, "byGame": by_game}, f, separators=(",", ":"), ensure_ascii=False)
    print(f"odds: {len(by_game)} games from {book}")


MODULES = {"draft": draft, "contracts": contracts, "rosters": rosters, "scores": scores, "standings": standings, "injuries": injuries, "odds": odds}

if __name__ == "__main__":
    names = [a for a in sys.argv[1:] if a in MODULES] or list(MODULES)
    for n in names:
        try:
            MODULES[n]()
        except Exception as e:
            print(f"! {n} failed: {type(e).__name__}: {e}")
