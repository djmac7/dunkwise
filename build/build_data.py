#!/usr/bin/env python3
"""
Dunkwise data pipeline.
Reads the public historical NBA/ABA/BAA CSVs (via the six-spins checkout) and
emits the static JSON the site loads on demand:

  data/meta.json              teams directory (colors/logos/conf) + season list
  data/search.json            every player: id, name, span, pos, last team, nba id
  data/player/<id>.json       bio, accolades, full season log, career line
  data/season/<year>.json     per-game leaders, standings, champion, MVP
  data/team/<abbr>.json       franchise season-by-season + latest roster

Deterministic transform of local data. Team logos are vendored into assets/logos/ (served
from our own origin); player headshots stay on the NBA CDN. Both fall back to monograms.
"""
import csv, json, math, os, re, unicodedata
from collections import defaultdict
import pandas as pd

SRC   = "/Users/d/six-spins/data"
RAW   = os.path.join(SRC, "raw")
RAW2  = os.path.join(SRC, "raw2")
CUR   = os.path.join(SRC, "curated")
OUT   = "/Users/d/claude-nba/data"

# ---- current-franchise directory (colors, conference, official CDN codes) ----
# the live source logo code + nba.com team id (both official CDNs; either works)
TEAMS = {
 "ATL":("Atlanta","Hawks","East","#E03A3E","atl"),      "BOS":("Boston","Celtics","East","#007A33","bos"),
 "BKN":("Brooklyn","Nets","East","#5B6770","bkn"),       "CHA":("Charlotte","Hornets","East","#00788C","cha"),
 "CHI":("Chicago","Bulls","East","#CE1141","chi"),       "CLE":("Cleveland","Cavaliers","East","#860038","cle"),
 "DAL":("Dallas","Mavericks","West","#00538C","dal"),    "DEN":("Denver","Nuggets","West","#0E2240","den"),
 "DET":("Detroit","Pistons","East","#C8102E","det"),     "GSW":("Golden State","Warriors","West","#1D428A","gs"),
 "HOU":("Houston","Rockets","West","#CE1141","hou"),     "IND":("Indiana","Pacers","East","#FDBB30","ind"),
 "LAC":("Los Angeles","Clippers","West","#1D428A","lac"),"LAL":("Los Angeles","Lakers","West","#552583","lal"),
 "MEM":("Memphis","Grizzlies","West","#5D76A9","mem"),   "MIA":("Miami","Heat","East","#98002E","mia"),
 "MIL":("Milwaukee","Bucks","East","#00471B","mil"),     "MIN":("Minnesota","Timberwolves","West","#236192","min"),
 "NOP":("New Orleans","Pelicans","West","#0C2340","no"), "NYK":("New York","Knicks","East","#F58426","ny"),
 "OKC":("Oklahoma City","Thunder","West","#007AC1","okc"),"ORL":("Orlando","Magic","East","#0077C0","orl"),
 "PHI":("Philadelphia","76ers","East","#006BB6","phi"),  "PHX":("Phoenix","Suns","West","#E56020","phx"),
 "POR":("Portland","Trail Blazers","West","#E03A3E","por"),"SAC":("Sacramento","Kings","West","#5A2D81","sac"),
 "SAS":("San Antonio","Spurs","West","#8A8D8F","sa"),    "TOR":("Toronto","Raptors","East","#CE1141","tor"),
 "UTA":("Utah","Jazz","West","#F9A01B","utah"),          "WAS":("Washington","Wizards","East","#E31837","wsh"),
}
ESPN_LOGO = "https://a.espncdn.com/i/teamlogos/nba/500/{}.png"
HEADSHOT  = "https://cdn.nba.com/headshots/nba/latest/1040x760/{}.png"

# Team logos are vendored into assets/logos/ and served from our own origin (dunkwise.com on
# GitHub Pages / Fastly): same-origin means no extra DNS/TLS to espncdn+ssref and no rate-limits,
# so it's as fast or faster and never breaks. Headshots stay on the NBA CDN (too many/too large).
import subprocess as _sub
ASSETS = os.path.join(HERE, "..", "assets", "logos")
def vendor_logo(url, subdir):
    """Download a logo into assets/logos/<subdir>/ once; return its site-relative path, or None
    if the source 404s (so the caller falls through to a monogram). Idempotent — skips existing."""
    fn = url.split("/")[-1]
    rel, dst = f"assets/logos/{subdir}/{fn}", os.path.join(ASSETS, subdir, fn)
    if os.path.exists(dst) and os.path.getsize(dst) > 200:
        return rel
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        r = _sub.run(["curl", "-s", "-A", "Mozilla/5.0", "--max-time", "20", "-o", dst,
                      "-w", "%{http_code} %{size_download}", url], capture_output=True, text=True, timeout=30)
        code, _, size = r.stdout.partition(" ")
        if code == "200" and int(size or 0) > 200:
            return rel
    except Exception:
        pass
    if os.path.exists(dst) and os.path.getsize(dst) <= 200:
        os.remove(dst)
    return None

def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn")
def norm_name(s):
    s = strip_accents(s).lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", s)
    s = re.sub(r"[^a-z ]", "", s)
    return re.sub(r"\s+", " ", s).strip()

def num(v, nd=1):
    if v is None: return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f): return None
    return round(f, nd)

def fmt_ht(inches):
    try:
        i = int(float(inches))
        return f"{i//12}-{i%12}"
    except (TypeError, ValueError):
        return None

MULTI = re.compile(r"^(?:[2-9]TM|TOT)$")
def dedup(df):
    """One row per (player, season): the combined multi-team row if the player
    was traded, else the sole team row."""
    df = df.copy()
    df["_m"] = df["team"].astype(str).str.match(MULTI)
    hasmulti = df.groupby(["player_id", "season"])["_m"].transform("any")
    return df[(~hasmulti) | df["_m"]].drop(columns="_m")

def clean(o):
    """Recursively turn NaN/NaT into null so output is spec-valid JSON."""
    if isinstance(o, float):
        return None if math.isnan(o) else o
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    return o

def cs(x):
    return x if isinstance(x, str) else ""

def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(clean(obj), f, separators=(",", ":"), ensure_ascii=False, allow_nan=False)

# ---------------------------------------------------------------- load
print("loading csvs…")
pg  = pd.read_csv(f"{RAW}/Player Per Game.csv")
adv = pd.read_csv(f"{RAW}/Advanced.csv")
tot = pd.read_csv(f"{RAW}/Player Totals.csv")
info= pd.read_csv(f"{RAW}/Player Career Info.csv")
awd = pd.read_csv(f"{RAW}/Player Award Shares.csv")
ast = pd.read_csv(f"{RAW}/All-Star Selections.csv")
eos = pd.read_csv(f"{RAW}/End of Season Teams.csv")
tsum= pd.read_csv(f"{RAW}/Team Summaries.csv")
fmvp= pd.read_csv(f"{CUR}/finals_mvp.csv")
nbap= pd.read_csv(f"{RAW2}/Players.csv", low_memory=False)

# the reference source uses PHO/BRK/CHO for the current Phoenix/Brooklyn/Charlotte
# franchises; normalize to the NBA tricodes our logos + team directory use.
ALIAS = {"PHO": "PHX", "BRK": "BKN", "CHO": "CHA"}
for _df in (pg, adv, tot):
    _df["team"] = _df["team"].replace(ALIAS)
tsum["abbreviation"] = tsum["abbreviation"].replace(ALIAS)

draft = pd.read_csv(f"{RAW}/Draft Pick History.csv")
draft["tm"] = draft["tm"].replace(ALIAS)
try:
    playoffs = pd.read_parquet(f"{SRC}/work/playoffs.parquet")
except Exception:
    playoffs = pd.DataFrame(columns=["player_id", "season", "po_g", "po_mp", "po_pts", "po_fga", "po_fta", "po_ppg", "po_ts"])

# Full (un-deduped) frames keep every team stint for a traded season, so player
# pages can show the combined "2TM" line plus each team row (the reference source
# style). The deduped frames (combined line only) drive leaders/careers/rosters.
pgF, advF, totF = pg.copy(), adv.copy(), tot.copy()
pg, adv, tot = dedup(pg), dedup(adv), dedup(tot)
IS_MULTI = lambda t: bool(MULTI.match(str(t)))

# name -> nba personId (for headshots). Players.csv carries synthetic ~1.96e9
# duplicate ids (no photo — a grey silhouette) alongside the real NBA id; the
# junk rows even have toYear filled while active stars leave it blank, so a naive
# "most recent" tiebreak picks the wrong one. Skip synthetic ids and prefer the
# row that actually looks like an NBA player (nbaFlag / gamesPlayed / real draft).
nba_cand = {}
for _, r in nbap.iterrows():
    if pd.isna(r["personId"]): continue
    pid = int(r["personId"])
    if pid >= 900_000_000: continue                      # synthetic / G-League id
    nm = norm_name(f"{r['firstName']} {r['lastName']}")
    if not nm: continue
    score = 0
    if r.get("nbaFlag") == 1: score += 4
    if r.get("gamesPlayedFlag") == 1: score += 2
    dy = r.get("draftYear")
    if pd.notna(dy) and int(dy) > 0: score += 1
    ty = r.get("toYear"); ty = int(ty) if (pd.notna(ty) and int(ty) > 0) else 0
    cand = (score, ty, -pid)                              # best score, most recent, smallest id
    if nm not in nba_cand or cand > nba_cand[nm][0]:
        nba_cand[nm] = (cand, pid)
nba_id = {k: v[1] for k, v in nba_cand.items()}

SEASONS = sorted(pg["season"].unique().tolist())
CUR_SEASON = SEASONS[-1]
print(f"{pg['player_id'].nunique()} players · seasons {SEASONS[0]}–{CUR_SEASON}")

# quick lookups
name_of = pg.drop_duplicates("player_id").set_index("player_id")["player"].to_dict()

# merged per-season log (per-game + advanced rate stats)
advk = adv[["player_id", "season", "per", "ts_percent", "ws", "bpm"]]
log = pg.merge(advk, on=["player_id", "season"], how="left")

# ---------------------------------------------------------------- season files + leaders
print("season files…")
scoring_titles = defaultdict(int)
team_games_by_season = {}
for s in SEASONS:
    ts = tsum[(tsum.season == s) & (tsum.team != "League Average")]
    tg = int((ts.w + ts.l).max()) if len(ts) else 82
    team_games_by_season[s] = tg

def leaders_for(s):
    d = log[log.season == s]
    tg = team_games_by_season[s]
    qc = d[d.g >= 0.55 * tg]        # counting-stat qualifier
    qr = d[d.g >= 0.68 * tg]        # rate-stat qualifier
    out = {}
    def top(frame, col, n=10, asc=False, extra=None):
        f = frame.dropna(subset=[col])
        if extra is not None: f = f[extra(f)]
        f = f.sort_values(col, ascending=asc).head(n)
        rows = []
        for _, r in f.iterrows():
            rows.append([r.player_id, r.player, r.team, num(r[col], 3 if "percent" in col or col in ("ts_percent",) else 1)])
        return rows
    out["pts"] = top(qc, "pts_per_game")
    out["trb"] = top(qc, "trb_per_game")
    out["ast"] = top(qc, "ast_per_game")
    out["stl"] = top(qc, "stl_per_game")
    out["blk"] = top(qc, "blk_per_game")
    out["fg_percent"]  = top(qr, "fg_percent",  extra=lambda f: f.fga_per_game * f.g >= 3.0 * tg)
    out["x3p_percent"] = top(qr, "x3p_percent", extra=lambda f: f.x3pa_per_game * f.g >= 1.0 * tg)
    out["ft_percent"]  = top(qr, "ft_percent",  extra=lambda f: f.fta_per_game * f.g >= 1.25 * tg)
    out["per"] = top(qr, "per")
    out["ts_percent"] = top(qr, "ts_percent", extra=lambda f: f.fga_per_game * f.g >= 3.0 * tg)
    return out

# champions (finals MVP's team that season) + mvp
fmvp_by_season = {int(r.season): r for _, r in fmvp.iterrows()}
def mvp_of(s):
    w = awd[(awd.season == s) & (awd.award == "nba mvp") & (awd.winner == True)]
    return (w.iloc[0].player_id, w.iloc[0].player) if len(w) else None

def honors_for(s):
    def named(df):
        return [[r.player_id, r.player] for _, r in df.iterrows()]
    e = eos[eos.season == s]
    def teams(kind):
        d = e[e.type == kind]
        out = {}
        for tno in ["1st", "2nd", "3rd"]:
            rows = named(d[d.number_tm == tno])
            if rows: out[tno] = rows
        return out
    astar = named(ast[ast.season == s].drop_duplicates("player_id"))
    mvote = awd[(awd.season == s) & (awd.award == "nba mvp")].sort_values("share", ascending=False).head(6)
    voting = [[r.player_id, r.player, num(r.share, 3), int(r.pts_won) if pd.notna(r.pts_won) else None] for _, r in mvote.iterrows()]
    return {"allNBA": teams("All-NBA"), "allDef": teams("All-Defense"), "allRook": teams("All-Rookie"),
            "allStar": astar, "mvpVote": voting}

for s in SEASONS:
    ld = leaders_for(s)
    if ld["pts"]:
        scoring_titles[ld["pts"][0][0]] += 1
    # standings
    ts = tsum[(tsum.season == s) & (tsum.team != "League Average")].copy()
    ts = ts[ts.w.notna()]
    rows = []
    for _, r in ts.iterrows():
        rows.append({"abbr": r.abbreviation, "name": r.team, "w": int(r.w), "l": int(r.l),
                     "po": bool(r.playoffs), "o": num(r.o_rtg), "d": num(r.d_rtg), "srs": num(r.srs)})
    rows.sort(key=lambda x: (x["w"] / max(1, x["w"] + x["l"])), reverse=True)
    # champion
    champ = None; fm = fmvp_by_season.get(s)
    if fm is not None:
        pid = fm.player_id
        prow = log[(log.season == s) & (log.player_id == pid)]
        cteam = prow.iloc[0].team if len(prow) else None
        champ = {"fmvp_id": pid, "fmvp": fm.player, "team": cteam}
    mv = mvp_of(s)
    write(f"{OUT}/season/{s}.json", {
        "season": int(s), "lg": str(tsum[tsum.season == s].iloc[0].lg),
        "leaders": ld, "standings": rows,
        "champion": champ,
        "mvp": ({"id": mv[0], "name": mv[1]} if mv else None),
        "honors": honors_for(s),
        "teamGames": team_games_by_season[s],
    })

# ---------------------------------------------------------------- accolades
print("accolades…")
def winners(award):
    w = awd[(awd.award == award) & (awd.winner == True)]
    return w.groupby("player_id").size().to_dict()
mvp_ct  = winners("nba mvp"); dpoy_ct = winners("nba dpoy"); roy_ct = winners("nba roy")
smoy_ct = winners("nba smoy"); mip_ct = winners("nba mip"); clutch_ct = winners("nba clutch_poy")
allstar_ct = ast.groupby("player_id").size().to_dict()
allnba_ct  = eos[eos.type == "All-NBA"].groupby("player_id").size().to_dict()
alldef_ct  = eos[eos.type == "All-Defense"].groupby("player_id").size().to_dict()
fmvp_ct    = fmvp.groupby("player_id").size().to_dict()
hof_ids    = set(info[info.hof == True].player_id)

def accolades(pid):
    a = []
    def add(n, label, gold=True):
        if n: a.append({"t": (f"{n}× " if n > 1 else "") + label, "g": gold})
    add(mvp_ct.get(pid, 0), "MVP")
    add(fmvp_ct.get(pid, 0), "Finals MVP")
    add(dpoy_ct.get(pid, 0), "Defensive POY")
    add(roy_ct.get(pid, 0), "Rookie of the Year")
    add(mip_ct.get(pid, 0), "Most Improved")
    add(smoy_ct.get(pid, 0), "Sixth Man")
    add(clutch_ct.get(pid, 0), "Clutch POY")
    add(scoring_titles.get(pid, 0), "Scoring champion")
    add(allstar_ct.get(pid, 0), "All-Star", gold=False)
    add(allnba_ct.get(pid, 0), "All-NBA", gold=False)
    add(alldef_ct.get(pid, 0), "All-Defense", gold=False)
    if pid in hof_ids: a.insert(0, {"t": "Hall of Fame", "g": True})
    return a

# ---------------------------------------------------------------- career lines (from totals)
print("careers…")
tg = tot.groupby("player_id")
career = {}
for pid, g in tg:
    G = g.g.sum()
    if G <= 0: continue
    def per(c): return num(g[c].sum() / G) if c in g else None
    career[pid] = {
        "g": int(G), "pts": per("pts"), "trb": per("trb"), "ast": per("ast"),
        "stl": per("stl"), "blk": per("blk"),
        "fg": num(g.fg.sum() / g.fga.sum(), 3) if g.fga.sum() else None,
        "tp": num(g.x3p.sum() / g.x3pa.sum(), 3) if g.x3pa.sum() else None,
        "ft": num(g.ft.sum() / g.fta.sum(), 3) if g.fta.sum() else None,
    }

# ---------------------------------------------------------------- player files + search
print("player files…")
info_by = info.set_index("player_id")
log_by = {pid: g.sort_values("season") for pid, g in log.groupby("player_id")}
tot_by = {pid: g.sort_values("season") for pid, g in tot.groupby("player_id")}  # deduped, for career sums
adv_by = {pid: g.sort_values("season") for pid, g in adv.groupby("player_id")}
po_by  = {pid: g.sort_values("season") for pid, g in playoffs.groupby("player_id")}
def I(v): return int(v) if pd.notna(v) else None

# full (stint-inclusive) frames for the season-by-season display tables
logF = pgF.merge(advF[["player_id", "season", "team", "per", "ts_percent"]], on=["player_id", "season", "team"], how="left")
multi_seasons = set(map(tuple, logF[logF.team.map(IS_MULTI)][["player_id", "season"]].itertuples(index=False, name=None)))
def stint_flag(pid, season, team):
    if IS_MULTI(team): return 1                                  # combined 2TM/TOT line
    if (pid, season) in multi_seasons: return 2                  # a single-team stint
    return 0
def order(df):
    d = df.copy(); d["_o"] = ~d.team.map(IS_MULTI)               # combined line first within a season
    return d.sort_values(["season", "_o"])
logF_by = {pid: order(g) for pid, g in logF.groupby("player_id")}
totF_by = {pid: order(g) for pid, g in totF.groupby("player_id")}
advF_by = {pid: order(g) for pid, g in advF.groupby("player_id")}

search = []
n = 0
for pid, g in log_by.items():
    nm = g.iloc[-1].player
    seasons_rows = []
    for _, r in logF_by[pid].iterrows():
        seasons_rows.append([
            int(r.season), r.lg, r.team, int(r.age) if pd.notna(r.age) else None,
            int(r.g), num(r.mp_per_game), num(r.fg_percent, 3), num(r.x3p_percent, 3), num(r.ft_percent, 3),
            num(r.trb_per_game), num(r.ast_per_game), num(r.stl_per_game), num(r.blk_per_game), num(r.pts_per_game),
            num(r.per), num(r.ts_percent, 3), stint_flag(pid, int(r.season), r.team),
        ])
    # totals rows: season, team, G, GS, MP, FG, FGA, FG%, 3P, 3PA, FT, FTA, TRB, AST, STL, BLK, TOV, PTS, 3Dbl, flag
    tot_rows = []
    for _, r in totF_by.get(pid, totF.iloc[0:0]).iterrows():
        tot_rows.append([int(r.season), r.team, I(r.g), I(r.gs), I(r.mp), I(r.fg), I(r.fga), num(r.fg_percent, 3),
                         I(r.x3p), I(r.x3pa), I(r.ft), I(r.fta), I(r.trb), I(r.ast), I(r.stl), I(r.blk), I(r.tov), I(r.pts), I(r.get("trp_dbl")),
                         stint_flag(pid, int(r.season), r.team)])
    # advanced rows: season, team, G, MP, PER, TS%, USG%, OWS, DWS, WS, WS/48, OBPM, DBPM, BPM, VORP, flag
    adv_rows = []
    for _, r in advF_by.get(pid, advF.iloc[0:0]).iterrows():
        adv_rows.append([int(r.season), r.team, I(r.g), I(r.mp), num(r.per), num(r.ts_percent, 3), num(r.usg_percent),
                         num(r.ows), num(r.dws), num(r.ws), num(r.ws_48, 3), num(r.obpm), num(r.dbpm), num(r.bpm), num(r.vorp),
                         stint_flag(pid, int(r.season), r.team)])
    tgw = tot_by.get(pid)
    agw = adv_by.get(pid)
    # career totals + playoffs
    ctot = None
    if tgw is not None and tgw.g.sum() > 0:
        s3 = lambda c: I(tgw[c].sum())
        ctot = {"g": s3("g"), "fg": s3("fg"), "fga": s3("fga"), "x3p": s3("x3p"), "x3pa": s3("x3pa"),
                "ft": s3("ft"), "fta": s3("fta"), "trb": s3("trb"), "ast": s3("ast"), "stl": s3("stl"),
                "blk": s3("blk"), "tov": s3("tov"), "pts": s3("pts"),
                "tpl": I(tgw["trp_dbl"].sum()) if "trp_dbl" in tgw else None,
                "ws": num(agw.ws.sum()) if agw is not None else None,
                "vorp": num(agw.vorp.sum()) if agw is not None else None}
    po = None
    pgw = po_by.get(pid)
    if pgw is not None and pgw.po_g.sum() > 0:
        G = pgw.po_g.sum()
        po = {"g": int(G), "ppg": num(pgw.po_pts.sum() / G), "ts": num((pgw.po_ts * pgw.po_g).sum() / G, 3),
              "log": [[int(r.season), int(r.po_g), num(r.po_ppg), num(r.po_ts, 3)] for _, r in pgw.iterrows()]}
    bio = {}
    if pid in info_by.index:
        ir = info_by.loc[pid]
        if hasattr(ir, "iloc") and getattr(ir, "ndim", 1) > 1:
            ir = ir.iloc[0]
        bio = {"pos": (None if pd.isna(ir.pos) else ir.pos), "ht": fmt_ht(ir.ht_in_in),
               "wt": (None if pd.isna(ir.wt) else int(ir.wt)),
               "born": (str(ir.birth_date)[:10] if pd.notna(ir.birth_date) else None),
               "college": (None if pd.isna(ir.colleges) else str(ir.colleges)),
               "from": int(ir["from"]), "to": int(ir["to"]), "hof": bool(ir.hof)}
    pid_nba = nba_id.get(norm_name(nm))
    last = g.iloc[-1]
    doc = {"id": pid, "name": nm, "bio": bio, "nba": pid_nba,
           "acc": accolades(pid), "career": career.get(pid),
           "cur": {"season": int(last.season), "team": last.team, "pos": last.pos,
                   "pts": num(last.pts_per_game), "trb": num(last.trb_per_game), "ast": num(last.ast_per_game),
                   "fg": num(last.fg_percent, 3), "tp": num(last.x3p_percent, 3), "ft": num(last.ft_percent, 3),
                   "per": num(last.per), "ts": num(last.ts_percent, 3), "g": int(last.g), "mp": num(last.mp_per_game),
                   "stl": num(last.stl_per_game), "blk": num(last.blk_per_game)},
           "log": seasons_rows, "tot": tot_rows, "adv": adv_rows, "ctot": ctot, "po": po}
    write(f"{OUT}/player/{pid}.json", doc)
    search.append([pid, nm, int(g.iloc[0].season), int(g.iloc[-1].season),
                   (cs(bio.get("pos")) or cs(last.pos)), last.team, pid_nba])
    n += 1
    if n % 1000 == 0: print(f"  {n} players…")
print(f"{n} player files")

# ---------------------------------------------------------------- team files
print("team files…")
all_abbr = sorted(tsum[tsum.team != "League Average"].abbreviation.dropna().unique().tolist())
# franchise display name = most recent full name for that abbr
name_for_abbr = {}
for _, r in tsum[tsum.team != "League Average"].sort_values("season").iterrows():
    if pd.notna(r.abbreviation): name_for_abbr[r.abbreviation] = r.team
for ab in all_abbr:
    ts = tsum[(tsum.abbreviation == ab) & (tsum.team != "League Average")].sort_values("season", ascending=False)
    seasons_rows = []
    for _, r in ts.iterrows():
        if pd.isna(r.w): continue
        seasons_rows.append({"season": int(r.season), "w": int(r.w), "l": int(r.l), "po": bool(r.playoffs),
                             "o": num(r.o_rtg), "d": num(r.d_rtg), "srs": num(r.srs)})
    # latest roster: players whose most recent season sits on this team in the franchise's last season
    last_season = seasons_rows[0]["season"] if seasons_rows else None
    roster = []
    if last_season is not None:
        # stint-inclusive: a traded player shows on each team he actually played for
        rr = pgF[(pgF.season == last_season) & (pgF.team == ab)].sort_values("pts_per_game", ascending=False)
        for _, r in rr.iterrows():
            roster.append([r.player_id, r.player, r.pos, int(r.g), num(r.pts_per_game), num(r.trb_per_game), num(r.ast_per_game)])
    write(f"{OUT}/team/{ab}.json", {"abbr": ab, "name": name_for_abbr.get(ab, ab),
                                    "seasons": seasons_rows, "roster": roster, "lastSeason": last_season})

# ---------------------------------------------------------------- all-time leaders
print("all-time leaders…")
name_of = pg.drop_duplicates("player_id").set_index("player_id")["player"].to_dict()
last_team = pg.sort_values("season").drop_duplicates("player_id", keep="last").set_index("player_id")["team"].to_dict()
span = pg.groupby("player_id").season.agg(["min", "max"])

def career_leaders(col, n=30):
    s = tot.groupby("player_id")[col].sum().sort_values(ascending=False).head(n)
    out = []
    for pid, v in s.items():
        if v <= 0: continue
        out.append([pid, name_of.get(pid, pid), last_team.get(pid, ""), int(v),
                    int(span.loc[pid, "min"]), int(span.loc[pid, "max"])])
    return out

# single-season records (per game), qualified by half a season of games
pgq = pg.copy()
pgq["_tg"] = pgq.season.map(team_games_by_season)
pgq = pgq[pgq.g >= 0.5 * pgq._tg]
def season_records(col, n=30):
    f = pgq.dropna(subset=[col]).sort_values(col, ascending=False).head(n)
    return [[r.player_id, r.player, r.team, int(r.season), num(r[col])] for _, r in f.iterrows()]

write(f"{OUT}/alltime.json", {
    "career": {
        "pts": career_leaders("pts"), "trb": career_leaders("trb"), "ast": career_leaders("ast"),
        "stl": career_leaders("stl"), "blk": career_leaders("blk"), "x3p": career_leaders("x3p"),
        "g": career_leaders("g"), "tov": career_leaders("tov"),
    },
    "season": {
        "pts": season_records("pts_per_game"), "trb": season_records("trb_per_game"),
        "ast": season_records("ast_per_game"), "stl": season_records("stl_per_game"),
        "blk": season_records("blk_per_game"),
    },
})

# ---------------------------------------------------------------- awards history
print("awards…")
seasonteam = {(r.player_id, r.season): r.team for r in pg[["player_id", "season", "team"]].itertuples(index=False)}
def award_history(award, use_fmvp=False):
    if use_fmvp:
        d = fmvp.sort_values("season", ascending=False)
    else:
        d = awd[(awd.award == award) & (awd.winner == True)].sort_values("season", ascending=False)
    out = []
    for _, r in d.iterrows():
        s = int(r.season)
        out.append([s, r.player_id, r.player, seasonteam.get((r.player_id, s))])
    return out
write(f"{OUT}/awards.json", {
    "mvp": award_history("nba mvp"), "fmvp": award_history(None, use_fmvp=True),
    "dpoy": award_history("nba dpoy"), "roy": award_history("nba roy"),
    "smoy": award_history("nba smoy"), "mip": award_history("nba mip"),
    "clutch": award_history("nba clutch_poy"),
})

# ---------------------------------------------------------------- draft classes
print("draft…")
valid_ids = set(log_by.keys())
draft_years = sorted([int(y) for y in draft.season.dropna().unique()], reverse=True)
for y in draft_years:
    d = draft[draft.season == y].sort_values("overall_pick")
    picks = []
    for _, r in d.iterrows():
        pid = r.player_id if pd.notna(r.player_id) else None
        picks.append([I(r.overall_pick), I(r["round"]), (r.tm if pd.notna(r.tm) else None),
                      (pid if pid in valid_ids else None), (r.player if pd.notna(r.player) else "—"),
                      (r.college if pd.notna(r.college) else None)])
    write(f"{OUT}/draft/{y}.json", {"year": y, "picks": picks})

# ---------------------------------------------------------------- meta + search
print("meta…")
teams_meta = {}
for ab, (city, name, conf, color, code) in TEAMS.items():
    teams_meta[ab] = {"city": city, "name": name, "conf": conf, "color": color,
                      "logo": vendor_logo(ESPN_LOGO.format(code), "team") or ESPN_LOGO.format(code),
                      "full": f"{city} {name}"}
# names/colors for every historical abbr (for tags), current ones override
names = {ab: name_for_abbr.get(ab, ab) for ab in all_abbr}
for ab in TEAMS: names[ab] = teams_meta[ab]["full"]
# former-franchise logos (NOH, SEA, VAN, …): the reference source hosts period,
# season-specific marks; use each franchise's final season. Current teams keep the live source.
BBREF_LOGO = "https://cdn.ssref.net/req/1/tlogo/bbr/{}-{}.png"
last_by_abbr = {}
for ab in all_abbr:
    ts = tsum[(tsum.abbreviation == ab) & (tsum.team != "League Average")]
    if len(ts): last_by_abbr[ab] = int(ts.season.max())
# vendor each former-franchise mark; drop the ones basketball-reference doesn't host (very
# early BAA/NBA teams 404) so they fall through to a monogram instead of a broken image.
hist_logos = {}
for ab in all_abbr:
    if ab in TEAMS or ab not in last_by_abbr: continue
    lp = vendor_logo(BBREF_LOGO.format(ab, last_by_abbr[ab]), "hist")
    if lp: hist_logos[ab] = lp

# champion + mvp history (from the season files we just wrote) for fast browsing
def winner_by_season(award):
    w = awd[(awd.award == award) & (awd.winner == True)]
    return {int(r.season): (r.player_id, r.player) for _, r in w.iterrows()}
roy_by, dpoy_by = winner_by_season("nba roy"), winner_by_season("nba dpoy")
history = []
for s in reversed(SEASONS):
    sd = json.load(open(f"{OUT}/season/{s}.json"))
    roy, dpoy = roy_by.get(int(s)), dpoy_by.get(int(s))
    history.append({"season": int(s), "lg": sd["lg"],
                    "champ": (sd["champion"] or {}).get("team"),
                    "fmvp": (sd["champion"] or {}).get("fmvp"),
                    "fmvp_id": (sd["champion"] or {}).get("fmvp_id"),
                    "mvp": (sd["mvp"] or {}).get("name"),
                    "mvp_id": (sd["mvp"] or {}).get("id"),
                    "roy": roy[1] if roy else None, "roy_id": roy[0] if roy else None,
                    "dpoy": dpoy[1] if dpoy else None, "dpoy_id": dpoy[0] if dpoy else None,
                    "pts_leader": (sd["leaders"]["pts"][0][1] if sd["leaders"]["pts"] else None)})

write(f"{OUT}/meta.json", {
    "seasons": [int(s) for s in reversed(SEASONS)],
    "current": int(CUR_SEASON),
    "teams": teams_meta,          # current franchises w/ logos+colors
    "names": names,               # abbr -> display name (all eras)
    "histLogos": hist_logos,      # former franchises -> period logo (bbref)
    "history": history,           # per-season champ/mvp/scoring-leader
    "draftYears": draft_years,
    "headshotBase": "https://cdn.nba.com/headshots/nba/latest/1040x760/",
})
write(f"{OUT}/search.json", search)

# current-season champion/mvp echo (sanity)
cs = json.load(open(f"{OUT}/season/{CUR_SEASON}.json"))
print("current season", CUR_SEASON, "champion", cs["champion"], "mvp", cs["mvp"])

# backfill per-season rosters into the team files (reads the player/team JSON just written)
import subprocess, sys
subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "build_season_rosters.py")], check=True)
print("done.")
