#!/usr/bin/env python3
"""
Static SEO pre-render for Dunkwise.

The site itself is a hash-routed SPA (index.html + app.js), which Google cannot
index per-entity — the #fragment never reaches the crawler, so every player and
team collapses to a single URL. This script emits real, crawlable, self-contained
HTML pages for every player and team at stable paths:

    /players/<id>.html      e.g. /players/jamesle01.html
    /teams/<abbr>.html      e.g. /teams/BOS.html

Each page ships full server-rendered content (bio, career stats, a season-by-season
table, contract/earnings), a query-matched <title> ("<Player> Stats, Contract &
Career"), meta description, Open Graph/Twitter tags, and JSON-LD — everything the
research flagged as bbref's structural SEO moat. Pages progressively link into the
interactive SPA via "View interactive →". Also writes sitemap.xml and robots.txt.

Run:  python3 build/build_seo.py            (from the project root)
Set the canonical host:  SITE_URL=https://yourdomain.com python3 build/build_seo.py
"""
import json, os, sys, html

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize_colleges import normalize as normalize_college
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
_now = datetime.now(timezone.utc)
BUILD_DATE = _now.date().isoformat()   # sitemap <lastmod> + age reference
BUILD_YEAR = _now.year
# The site is served at the custom-domain root (dunkwise.com), so internal links,
# assets and canonicals all resolve from "/". Override BASE_PATH=/subpath (and
# SITE_URL) for a project-pages / subdirectory deploy.
BASE = os.environ.get("BASE_PATH", "").rstrip("/")
SITE_URL = (os.environ.get("SITE_URL") or ("https://dunkwise.com" + BASE)).rstrip("/")

# ---------- formatting helpers (mirror app.js) ----------
def esc(s): return html.escape(str(s), quote=True)
def one(v): return f"{v:.1f}" if isinstance(v, (int, float)) else "—"
def pctf(v):
    if not isinstance(v, (int, float)): return "—"
    return f"{v:.3f}".lstrip("0") if 0 < v < 1 else f"{v:.3f}"
def season_label(s):  # 2004 -> "2003-04"
    return f"{s-1}-{str(s)[2:]}" if s else "—"
def money(n):
    if not n: return "—"
    if n >= 1e9: return f"${n/1e9:.1f}B"
    if n >= 1e6: return f"${n/1e6:.1f}M"
    if n >= 1e3: return f"${n/1e3:.0f}K"
    return f"${n:,}"
def money_full(n): return f"${n:,}" if n else "—"
def intc(v): return f"{int(v):,}" if isinstance(v, (int, float)) else "—"      # thousands-separated int
def intor(v): return v if v is not None else "—"
def signed(v, nd=1): return "—" if v is None else (("+" if v >= 0 else "") + f"{v:.{nd}f}")
def ws48(v):
    if v is None: return "—"
    s = f"{v:.3f}"
    return s[1:] if s.startswith("0.") else (("-" + s[2:]) if s.startswith("-0.") else s)

def canonical(path): return (SITE_URL + path) if SITE_URL else path

META = json.load(open(DATA / "meta.json"))
TEAMS = META["teams"]
try:
    SAL = json.load(open(DATA / "salaries.json"))
except FileNotFoundError:
    SAL = {"byPlayer": {}, "careerEarn": {}}
try:
    AWARDS = json.load(open(DATA / "awards.json"))
except FileNotFoundError:
    AWARDS = {}

try:
    TWOK = json.load(open(DATA / "twok.json"))
except FileNotFoundError:
    TWOK = {"ratings": {}, "edition": ""}
TWOK_R = TWOK.get("ratings", {})
SHOW_2K = False   # hide all 2K sections+page while the dataset is incomplete/stale
try:
    INJ = json.load(open(DATA / "injuries.json"))
except FileNotFoundError:
    INJ = {"byPlayer": {}}

# Reverse draft index: pid -> (year, round, overall, team). Powers the "Draft" bio fact
# on player pages and links back to the per-year draft page.
DRAFT_INDEX = {}
for _df in (DATA / "draft").glob("*.json"):
    try:
        _d = json.load(open(_df))
    except Exception:
        continue
    for pk in _d.get("picks", []):
        # pick row: [overall, round, team, pid, name, college]
        overall, rnd, tm, dpid = pk[0], pk[1], pk[2], pk[3]
        if dpid and dpid not in DRAFT_INDEX:
            DRAFT_INDEX[dpid] = (_d.get("year"), rnd, overall, tm)

def tname(ab): return TEAMS.get(ab, {}).get("full", ab)
def is_real_team(ab): return ab in TEAMS
def team_cell(ab):  # linked team abbr for aggregate tables (plain text if not a real team)
    return f'<a href="{BASE}/teams/{esc(ab)}.html">{esc(ab)}</a>' if is_real_team(ab) else esc(ab)

# ---------- shared page shell ----------
def page(title, desc, canon, body, jsonld=None, og_type="website"):
    blocks = jsonld if isinstance(jsonld, list) else ([jsonld] if jsonld else [])
    ld = "".join(f'<script type="application/ld+json">{json.dumps(b)}</script>' for b in blocks)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>{esc(title)} — Dunkwise</title>
<meta name="description" content="{esc(desc)}" />
<link rel="canonical" href="{esc(canon)}" />
<meta name="theme-color" content="#faf9f5" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#1f1e1c" media="(prefers-color-scheme: dark)" />
<meta property="og:site_name" content="Dunkwise" />
<meta property="og:type" content="{og_type}" />
<meta property="og:title" content="{esc(title)} — Dunkwise" />
<meta property="og:description" content="{esc(desc)}" />
<meta property="og:url" content="{esc(canon)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{esc(title)} — Dunkwise" />
<meta name="twitter:description" content="{esc(desc)}" />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Schibsted+Grotesk:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="{BASE}/ds/tokens.css?v=105" />
<link rel="stylesheet" href="{BASE}/styles.css?v=105" />
{ld}
</head>
<body>
<aside class="ad-rail ad-rail-l" aria-hidden="true"><div class="slot">Ad</div></aside>
<aside class="ad-rail ad-rail-r" aria-hidden="true"><div class="slot">Ad</div></aside>
<header class="topbar"><div class="wrap">
  <a href="{BASE}/" class="brand"><span class="dot"></span> Dunkwise</a>
  <nav class="mainnav">
    <a href="{BASE}/#/players">Players</a><a href="{BASE}/#/teams">Teams</a><a href="{BASE}/leaders.html">Leaders</a>
    <a href="{BASE}/standings.html">Standings</a><a href="{BASE}/salaries.html">Salaries</a><a href="{BASE}/awards.html">Awards</a>
  </nav>
</div></header>
<main id="app">{body}</main>
</body>
</html>
"""

# ---------- player stat tables (bbref-parity depth: totals, per-36, advanced, playoffs, shooting) ----------
def _thead(cols):
    return "<thead><tr>" + "".join(f'<th class="{"l" if i < 2 else ""}">{esc(h)}</th>' for i, h in enumerate(cols)) + "</tr></thead>"

_SHOT_ZONES = [("0-3 ft", "At the rim"), ("3-10 ft", "In the paint"), ("10-16 ft", "Mid-range"),
               ("16 ft-3P", "Long two"), ("3-pointers", "Three-pointers")]

# ---------- per-game logs, career splits & full playoff box (from data/splits — precomputed
#            by build_splits.py from the full per-game box-score history, 1946→today) ----------
SPLITS = DATA / "splits"
def _load_splits(pid):
    f = SPLITS / f"{pid}.json"
    if not f.exists(): return {}
    try: return json.load(open(f))
    except Exception: return {}

def _gamelog_table(sp, cur):
    log = sp.get("log") or []
    if not log: return ""
    def row(g):
        loc = "vs" if g.get("home") else "@"
        pm = g.get("pm")
        pmf = ("+" + str(pm)) if isinstance(pm, int) and pm > 0 else (str(pm) if pm is not None else "—")
        res = (f'{"W" if g.get("w") else "L"} {g["us"]}–{g["them"]}') if g.get("us") is not None else ("W" if g.get("w") else "L")
        return (f'<tr><td class="l"><a href="{BASE}/#/game/{esc(g["id"])}">{esc(g["date"])}</a></td>'
                f'<td>{loc} {team_cell(g["opp"]) if g.get("opp") else "—"}</td><td>{res}</td>'
                f'<td>{intor(g.get("min"))}</td><td class="hi">{intor(g.get("pts"))}</td>'
                f'<td>{intor(g.get("reb"))}</td><td>{intor(g.get("ast"))}</td>'
                f'<td>{intor(g.get("stl"))}</td><td>{intor(g.get("blk"))}</td>'
                f'<td>{intor(g.get("fgm"))}-{intor(g.get("fga"))}</td>'
                f'<td>{intor(g.get("tpm"))}-{intor(g.get("tpa"))}</td><td>{pmf}</td></tr>')
    cols = ["Date", "Opp", "Result", "MIN", "PTS", "REB", "AST", "STL", "BLK", "FG", "3P", "+/−"]
    return (f'<h2>Game log — {esc(season_label(cur))}</h2><div class="tbl-wrap"><table class="ref" style="min-width:720px">'
            f'{_thead(cols)}<tbody>{"".join(row(g) for g in log)}</tbody></table></div>')

def _splits_table(sp):
    s = sp.get("splits") or {}
    vs = sp.get("vsOpp") or {}
    if not s and not vs: return ""
    def srow(label, b):
        return (f'<tr><td class="l">{esc(label)}</td><td>{b["g"]}</td><td class="hi">{one(b["ppg"])}</td>'
                f'<td>{one(b["rpg"])}</td><td>{one(b["apg"])}</td><td>{b["w"]}–{b["l"]}</td></tr>')
    out = ""
    if s:
        order = [("home", "Home"), ("away", "Away"), ("wins", "In wins"), ("losses", "In losses")]
        rows = "".join(srow(lbl, s[k]) for k, lbl in order if k in s)
        out += (f'<h2>Career splits</h2><div class="tbl-wrap"><table class="ref" style="min-width:0">'
                f'{_thead(["Split", "G", "PPG", "RPG", "APG", "W–L"])}<tbody>{rows}</tbody></table></div>'
                f'<p class="muted">Regular-season career splits by venue and result.</p>')
    if vs:
        rows = "".join(
            f'<tr><td class="l">{team_cell(ab)} {esc(tname(ab))}</td><td>{b["g"]}</td>'
            f'<td class="hi">{one(b["ppg"])}</td><td>{one(b["rpg"])}</td><td>{one(b["apg"])}</td>'
            f'<td>{b["w"]}–{b["l"]}</td></tr>'
            for ab, b in sorted(vs.items(), key=lambda kv: tname(kv[0])))
        out += (f'<h2>Career stats vs each team</h2><div class="tbl-wrap"><table class="ref" style="min-width:420px">'
                f'{_thead(["Opponent", "G", "PPG", "RPG", "APG", "W–L"])}<tbody>{rows}</tbody></table></div>'
                f'<p class="muted">Regular-season career averages against each current franchise.</p>')
    return out

def _tot_table(p):
    tot = p.get("tot") or []
    if not tot: return ""
    ct = p.get("ctot") or {}
    def row(r):
        st = len(r) > 19 and r[19] == 2
        return (f'<tr class="{"stint" if st else ""}"><td class="l">{"" if st else esc(season_label(r[0]))}</td><td>{esc(r[1])}</td>'
                f'<td>{intor(r[2])}</td><td>{intor(r[3])}</td><td>{intc(r[4])}</td><td>{intc(r[5])}</td><td>{intc(r[6])}</td><td>{pctf(r[7])}</td>'
                f'<td>{intor(r[8])}</td><td>{intor(r[9])}</td><td>{intor(r[10])}</td><td>{intor(r[11])}</td>'
                f'<td>{intor(r[12])}</td><td>{intor(r[13])}</td><td>{intor(r[14])}</td><td>{intor(r[15])}</td><td>{intor(r[16])}</td><td class="hi">{intc(r[17])}</td></tr>')
    fgp = (ct.get("fg") / ct.get("fga")) if ct.get("fg") and ct.get("fga") else None
    career = (f'<tr class="total"><td class="l">Career</td><td></td><td>{intor(ct.get("g"))}</td><td>—</td><td>—</td>'
              f'<td>{intc(ct.get("fg"))}</td><td>{intc(ct.get("fga"))}</td><td>{pctf(fgp)}</td>'
              f'<td>{intor(ct.get("x3p"))}</td><td>{intor(ct.get("x3pa"))}</td><td>{intor(ct.get("ft"))}</td><td>{intor(ct.get("fta"))}</td>'
              f'<td>{intor(ct.get("trb"))}</td><td>{intor(ct.get("ast"))}</td><td>{intor(ct.get("stl"))}</td><td>{intor(ct.get("blk"))}</td>'
              f'<td>{intor(ct.get("tov"))}</td><td class="hi">{intc(ct.get("pts"))}</td></tr>') if ct else ""
    cols = ["Season", "Tm", "G", "GS", "MP", "FG", "FGA", "FG%", "3P", "3PA", "FT", "FTA", "REB", "AST", "STL", "BLK", "TOV", "PTS"]
    return (f'<h2>Stats by season — totals</h2><div class="tbl-wrap"><table class="ref" style="min-width:840px">{_thead(cols)}'
            f'<tbody>{"".join(row(r) for r in tot)}{career}</tbody></table></div>')

def _per36_table(p):
    tot = p.get("tot") or []
    if not tot: return ""
    def p36(v, mp): return one(v / mp * 36) if mp and v is not None else "—"
    def row(r):
        st = len(r) > 19 and r[19] == 2
        mp = r[4]
        return (f'<tr class="{"stint" if st else ""}"><td class="l">{"" if st else esc(season_label(r[0]))}</td><td>{esc(r[1])}</td>'
                f'<td>{intor(r[2])}</td><td>{one(mp / r[2]) if mp and r[2] else "—"}</td>'
                f'<td>{p36(r[5], mp)}</td><td>{p36(r[6], mp)}</td><td>{pctf(r[7])}</td>'
                f'<td>{p36(r[8], mp)}</td><td>{p36(r[9], mp)}</td><td>{p36(r[10], mp)}</td><td>{p36(r[11], mp)}</td>'
                f'<td>{p36(r[12], mp)}</td><td>{p36(r[13], mp)}</td><td>{p36(r[14], mp)}</td><td>{p36(r[15], mp)}</td><td>{p36(r[16], mp)}</td><td class="hi">{p36(r[17], mp)}</td></tr>')
    cols = ["Season", "Tm", "G", "MPG", "FG", "FGA", "FG%", "3P", "3PA", "FT", "FTA", "REB", "AST", "STL", "BLK", "TOV", "PTS"]
    return (f'<h2>Per 36 minutes</h2><div class="tbl-wrap"><table class="ref" style="min-width:820px">{_thead(cols)}'
            f'<tbody>{"".join(row(r) for r in tot)}</tbody></table></div>'
            f'<p class="muted">Counting stats scaled to a per-36-minute pace.</p>')

def _adv_table(p):
    adv = p.get("adv") or []
    if not adv: return ""
    def row(r):
        st = len(r) > 15 and r[15] == 2
        return (f'<tr class="{"stint" if st else ""}"><td class="l">{"" if st else esc(season_label(r[0]))}</td><td>{esc(r[1])}</td>'
                f'<td>{intor(r[2])}</td><td>{intc(r[3])}</td><td>{one(r[4])}</td><td>{pctf(r[5])}</td><td>{one(r[6])}</td>'
                f'<td>{one(r[7])}</td><td>{one(r[8])}</td><td class="hi">{one(r[9])}</td><td>{ws48(r[10])}</td>'
                f'<td>{signed(r[11])}</td><td>{signed(r[12])}</td><td>{signed(r[13])}</td><td>{signed(r[14])}</td></tr>')
    real = [r for r in adv if not (len(r) > 15 and r[15] == 2)]
    cg = sum(r[2] or 0 for r in real)
    cws = sum(r[9] or 0 for r in real)
    cvorp = sum(r[14] or 0 for r in real)
    career = (f'<tr class="total"><td class="l">Career</td><td></td><td>{intor(cg)}</td><td>—</td><td>—</td><td>—</td><td>—</td>'
              f'<td>—</td><td>—</td><td class="hi">{one(cws)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>{signed(cvorp)}</td></tr>')
    cols = ["Season", "Tm", "G", "MP", "PER", "TS%", "USG%", "OWS", "DWS", "WS", "WS/48", "OBPM", "DBPM", "BPM", "VORP"]
    return (f'<h2>Advanced stats</h2><div class="tbl-wrap"><table class="ref" style="min-width:720px">{_thead(cols)}'
            f'<tbody>{"".join(row(r) for r in adv)}{career}</tbody></table></div>'
            f'<p class="muted">PER, True Shooting %, Usage %, Win Shares (Off/Def/Total, per 48), Box Plus/Minus (Off/Def/Total) and Value Over Replacement Player.</p>')

def _po_table(p, sp):
    # Prefer the full box-derived playoff data (all seasons); fall back to the minimal p.po log.
    spo = sp.get("po") or {}
    by = spo.get("bySeason") or []
    if by:
        def brow(b, total=False):
            season = "Career" if total else season_label(b["season"])
            cls = ' class="total"' if total else ""
            return (f'<tr{cls}><td class="l">{esc(season)}</td><td>{intor(b.get("g"))}</td><td>{one(b.get("mpg"))}</td>'
                    f'<td class="hi">{one(b.get("ppg"))}</td><td>{one(b.get("rpg"))}</td><td>{one(b.get("apg"))}</td>'
                    f'<td>{one(b.get("spg"))}</td><td>{one(b.get("bpg"))}</td>'
                    f'<td>{pctf(b.get("fg"))}</td><td>{pctf(b.get("tp"))}</td><td>{pctf(b.get("ts"))}</td></tr>')
        rows = "".join(brow(b) for b in by)
        career = brow(spo.get("career", {}), total=True) if spo.get("career") else ""
        cols = ["Season", "G", "MPG", "PPG", "RPG", "APG", "SPG", "BPG", "FG%", "3P%", "TS%"]
        return (f'<h2>Playoff stats</h2><div class="tbl-wrap"><table class="ref" style="min-width:640px">'
                f'{_thead(cols)}<tbody>{rows}{career}</tbody></table></div>'
                f'<p class="muted">Full postseason box-score averages by season, from every playoff game played.</p>')
    # fallback: minimal stored playoff log [season, G, PPG, TS%]
    po = p.get("po") or {}
    log = po.get("log") or []
    if not log: return ""
    rows = "".join(f'<tr><td class="l">{esc(season_label(r[0]))}</td><td>{intor(r[1])}</td>'
                   f'<td class="hi">{one(r[2])}</td><td>{pctf(r[3])}</td></tr>' for r in log)
    career = (f'<tr class="total"><td class="l">Career</td><td>{intor(po.get("g"))}</td>'
              f'<td class="hi">{one(po.get("ppg"))}</td><td>{pctf(po.get("ts"))}</td></tr>')
    return (f'<h2>Playoff stats</h2><div class="tbl-wrap"><table class="ref" style="min-width:0">'
            f'{_thead(["Season", "G", "PPG", "TS%"])}<tbody>{rows}{career}</tbody></table></div>')

def _shot_court_svg(ranges):
    # Self-contained SVG half-court: concentric distance bands shaded by shot frequency.
    # No external deps, no JS — crawlable and works in light/dark. Basket at bottom-centre.
    radii = [22, 64, 102, 150, 228]   # px outer radius per zone (rim→beyond arc), ~6.3px/ft
    zones = [(z, name, ranges.get(z)) for z, name in _SHOT_ZONES]
    found = [(r, name, d) for (z, name, d), r in zip(zones, radii) if d]
    if not found: return ""
    maxpct = max(d["pct"] for _, _, d in found) or 1
    cx, cy = 250, 300
    disks, labels, prev = "", "", 0
    for r, name, d in reversed(found):  # outer disk first so inner paints on top
        op = 0.16 + 0.80 * (d["pct"] / maxpct)
        disks += (f'<path d="M {cx-r} {cy} A {r} {r} 0 0 1 {cx+r} {cy} Z" fill="#cc5b3b" fill-opacity="{op:.3f}" />')
    for r, name, d in found:
        mid = (prev + r) / 2
        labels += (f'<text x="{cx}" y="{cy-mid+4}" text-anchor="middle" font-size="13" font-weight="600" '
                   f'fill="#fff" style="paint-order:stroke;stroke:#00000055;stroke-width:3px">{pctf(d.get("fg"))}</text>')
        prev = r
    return (f'<svg viewBox="0 40 500 280" width="440" height="246" role="img" aria-label="Shot frequency by distance" '
            f'style="max-width:100%;height:auto;display:block;margin:10px 0">'
            f'<rect x="10" y="50" width="480" height="260" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.18"/>'
            f'{disks}'
            f'<circle cx="{cx}" cy="{cy}" r="7" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="2"/>'
            f'{labels}</svg>'
            f'<p class="muted">Darker = a larger share of this player’s shots came from that range; the number is field-goal % from there.</p>')

def _shot_table(p):
    shot = p.get("shot") or {}
    if not shot: return ""
    yr = max(int(y) for y in shot.keys())
    s = shot[str(yr)]
    ranges = {r["z"]: r for r in (s.get("ranges") or [])}
    body = ""
    for z, name in _SHOT_ZONES:
        d = ranges.get(z)
        if not d: continue
        body += (f'<tr><td class="l">{esc(name)} <span class="muted">({esc(z)})</span></td>'
                 f'<td>{round(d["pct"] * 100)}%</td><td class="hi">{pctf(d.get("fg"))}</td></tr>')
    if not body: return ""
    court = _shot_court_svg(ranges)
    extras = []
    if s.get("avgDist") is not None: extras.append(f'Average shot distance {s["avgDist"]:.1f} ft')
    if s.get("dunk") is not None: extras.append(f'{round(s["dunk"] * 100)}% of attempts were dunks')
    if s.get("corner3") is not None: extras.append(f'{round(s["corner3"] * 100)}% of threes from the corner')
    extra_line = f'<p class="muted">{esc(" · ".join(extras))}</p>' if extras else ""
    return (f'<h2>Shooting by distance — {esc(season_label(yr))}</h2>{court}'
            f'<div class="tbl-wrap"><table class="ref" style="min-width:0">'
            f'{_thead(["Range", "% of shots", "FG%"])}<tbody>{body}</tbody></table></div>{extra_line}')

_TWOK_SKILLS = [("Outside scoring", ["closeShot", "midRangeShot", "threePointShot", "freeThrow"]),
                ("Inside scoring", ["layup", "drivingDunk", "standingDunk", "postControl"]),
                ("Playmaking", ["passAccuracy", "ballHandle", "passVision", "speedWithBall"]),
                ("Defense", ["interiorDefense", "perimeterDefense", "steal", "block"]),
                ("Athleticism", ["speed", "agility", "strength", "vertical"])]

def _twok_block(pid, name):
    if not SHOW_2K: return ""
    r = TWOK_R.get(pid)
    if not r: return ""
    ed = esc(TWOK.get("edition", "NBA 2K"))
    # per-category averages of the underlying attributes (rounded), plus overall
    cats = []
    for label, keys in _TWOK_SKILLS:
        vals = [r[k] for k in keys if isinstance(r.get(k), (int, float))]
        if vals: cats.append((label, round(sum(vals) / len(vals))))
    rows = "".join(f'<tr><td class="l">{esc(l)}</td><td class="hi">{v}</td></tr>' for l, v in cats)
    return (f'<h2>{ed} rating</h2>'
            f'<p><strong>{esc(name)}</strong> has a <strong>{r.get("ovr","—")} overall</strong> rating in {ed}.</p>'
            f'<div class="tbl-wrap"><table class="ref" style="min-width:0"><thead><tr><th class="l">Attribute group</th><th>Rating</th></tr></thead>'
            f'<tbody><tr><td class="l"><strong>Overall</strong></td><td class="hi"><strong>{r.get("ovr","—")}</strong></td></tr>{rows}</tbody></table></div>'
            f'<p class="muted"><a href="{BASE}/2k-ratings.html">See the full {ed} player ratings →</a></p>')

# ---------- player pages ----------
def render_player(p):
    pid, name, b, cur = p["id"], p["name"], p.get("bio", {}), p.get("cur", {})
    _sp = _load_splits(pid)
    cr = p.get("career", {})
    log = p.get("log", [])
    acc = p.get("acc", [])
    team = cur.get("team", "")
    pos = cur.get("pos") or b.get("pos") or ""
    yrs = f"{season_label(b.get('from') or (log[0][0] if log else None))}–{season_label(b.get('to') or cur.get('season'))}"
    seasons = len({r[0] for r in log})
    career_line = f"{one(cr.get('pts'))} PPG, {one(cr.get('trb'))} RPG, {one(cr.get('ast'))} APG"
    top_acc = ", ".join(a["t"] for a in acc if a.get("g"))[:120]

    sal_rows = SAL.get("byPlayer", {}).get(pid) or []
    sal_line = ""
    if sal_rows:
        ls = sal_rows[-1]
        sal_line = f" Latest tracked salary {money_full(ls[1])} ({season_label(ls[0])}); career earnings {money(SAL.get('careerEarn', {}).get(pid))}."

    desc = (f"{name} career stats, contract & salary — "
            f"{pos + ' ' if pos else ''}{'for the ' + tname(team) + '. ' if is_real_team(team) else ''}"
            f"{career_line} across {seasons} season{'s' if seasons != 1 else ''} ({yrs})."
            f"{' ' + top_acc + '.' if top_acc else ''}{sal_line}")

    # per-game season table (crawlable)
    def prow(r):
        st = len(r) > 16 and r[16] == 2
        return ("<tr>"
                f"<td>{'' if st else esc(season_label(r[0]))}</td>"
                f"<td>{esc(r[2])}</td><td>{r[3] if r[3] is not None else '—'}</td><td>{r[4]}</td>"
                f"<td>{one(r[5])}</td><td>{pctf(r[6])}</td><td>{pctf(r[7])}</td><td>{pctf(r[8])}</td>"
                f"<td>{one(r[9])}</td><td>{one(r[10])}</td><td>{one(r[11])}</td><td>{one(r[12])}</td>"
                f"<td>{one(r[13])}</td><td>{one(r[14])}</td><td>{pctf(r[15])}</td></tr>")
    thead = ("<thead><tr><th>Season</th><th>Tm</th><th>Age</th><th>GP</th><th>MPG</th><th>FG%</th><th>3P%</th>"
             "<th>FT%</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>PTS</th><th>PER</th><th>TS%</th></tr></thead>")
    stat_table = (f'<div class="tbl-wrap"><table class="ref" style="min-width:760px">{thead}'
                  f'<tbody>{"".join(prow(r) for r in log)}</tbody></table></div>')

    # contract table
    contract = ""
    if sal_rows:
        rows = "".join(f'<tr><td>{esc(season_label(s))}</td><td class="hi">{money_full(a)}</td></tr>' for s, a in sal_rows)
        contract = (f'<h2>Contract & salary</h2><p class="muted">Nominal salaries; tracked coverage is limited to '
                    f'seasons in the current dataset.</p><div class="tbl-wrap"><table class="ref" style="min-width:0">'
                    f'<thead><tr><th>Season</th><th>Salary</th></tr></thead><tbody>{rows}'
                    f'<tr class="total"><td>Career earnings</td><td class="hi">{money_full(SAL.get("careerEarn", {}).get(pid))}</td></tr>'
                    f'</tbody></table></div>')

    team_link = (f'<a href="{BASE}/teams/{esc(team)}.html">{esc(tname(team))}</a>' if is_real_team(team) else esc(team))
    acc_html = "".join(f'<span class="chip {"gold" if a.get("g") else ""}">{"★ " if a.get("g") else ""}{esc(a["t"])}</span>' for a in acc)

    # ---- bio facts (targets "how tall / how old / what college" + featured snippets) ----
    active = (b.get("to") or cur.get("season") or 0) >= (META["current"] - 1)
    def _age(born):
        try:
            y, m, d = (int(x) for x in born.split("-"))
            return BUILD_YEAR - y - ((_now.month, _now.day) < (m, d))
        except Exception:
            return None
    dr = DRAFT_INDEX.get(pid)
    facts = []
    if b.get("nickname"): facts.append(("Nickname", esc(b["nickname"])))
    if pos: facts.append(("Position", esc(pos)))
    if b.get("num"):
        nums = b.get("numbers") or [b["num"]]
        others = [n for n in nums if n != b["num"]]
        facts.append(("Number", "#" + esc(b["num"]) + (f' <span class="muted">(also {", ".join("#" + esc(n) for n in others)})</span>' if others else "")))
    if is_real_team(team): facts.append(("Team", team_link))
    if b.get("ht"): facts.append(("Height", esc(b["ht"])))
    if b.get("wt"): facts.append(("Weight", f"{b['wt']} lb"))
    if b.get("born"):
        ag = _age(b["born"])
        facts.append(("Born", esc(b["born"]) + (f" (age {ag})" if ag is not None and active else "")))
    _cprim, _call = normalize_college(b.get("college"))
    # transfers read as the full path ("Vincennes -> UNC"); alumniOf below stays
    # the single school they left for the NBA
    if _cprim: facts.append(("College", esc(" → ".join(_call))))
    if b.get("highSchool"): facts.append(("High school", esc(b["highSchool"])))
    if dr and dr[0]:
        dy, drnd, dov, dtm = dr
        dtl = f'<a href="{BASE}/teams/{esc(dtm)}.html">{esc(tname(dtm))}</a>' if is_real_team(dtm) else esc(dtm)
        facts.append(("Drafted", f'<a href="{BASE}/draft/{dy}.html">{dy}</a> · Round {drnd}, Pick {dov} · {dtl}'))
    facts.append(("Seasons", f"{esc(yrs)} ({seasons})"))
    facts_html = ""
    if facts:
        rows = "".join(f'<tr><th class="l">{k}</th><td>{v}</td></tr>' for k, v in facts)
        facts_html = f'<h2>Player info</h2><div class="tbl-wrap"><table class="ref" style="min-width:0"><tbody>{rows}</tbody></table></div>'

    # ---- FAQ (rendered visibly + FAQPage JSON-LD; Google requires the answer be on-page) ----
    faqs = []
    if is_real_team(team):
        faqs.append((f"What team does {name} play for?",
                     f"{name} plays {pos + ' ' if pos else ''}for the {tname(team)}."))
    faqs.append((f"What are {name}'s career stats?",
                 f"{name} has averaged {career_line} over {seasons} season{'s' if seasons != 1 else ''} ({yrs})."))
    if sal_rows:
        ls = sal_rows[-1]
        faqs.append((f"How much does {name} make?",
                     f"{name}'s salary is {money_full(ls[1])} for the {season_label(ls[0])} season, "
                     f"with career earnings of about {money(SAL.get('careerEarn', {}).get(pid))}."))
    if b.get("ht"):
        faqs.append((f"How tall is {name}?", f"{name} is {b['ht']}" + (f" ({b['wt']} lb)." if b.get("wt") else ".")))
    if b.get("born") and active and _age(b["born"]) is not None:
        faqs.append((f"How old is {name}?", f"{name} was born {b['born']} and is {_age(b['born'])} years old."))
    if dr and dr[0]:
        faqs.append((f"When was {name} drafted?",
                     f"{name} was drafted in {dr[0]}, round {dr[1]}, pick {dr[2]}"
                     + (f", by the {tname(dr[3])}." if is_real_team(dr[3]) else ".")))
    faq_html = ("<h2>Frequently asked questions</h2>"
                + "".join(f'<h3>{esc(q)}</h3><p>{esc(a)}</p>' for q, a in faqs)) if faqs else ""

    body = f"""
    <div class="wrap page">
      <nav class="crumb" aria-label="Breadcrumb"><a href="{BASE}/">Home</a><span class="sep">/</span><a href="{BASE}/#/players">Players</a><span class="sep">/</span><span>{esc(name)}</span></nav>
      <h1>{esc(name)}</h1>
      <p class="pos">{esc(pos)} · {team_link}</p>
      <p class="muted">Seasons {esc(yrs)} · {seasons} on record{' · Ht ' + esc(b['ht']) if b.get('ht') else ''}{' · b. ' + esc(b['born'][:4]) if b.get('born') else ''}</p>
      <div class="chip-row">{acc_html}</div>
      <p style="margin:14px 0"><a class="btn" href="{BASE}/#/player/{esc(pid)}">View interactive stats & charts →</a></p>
      {facts_html}
      <h2>Career averages</h2>
      <p><strong>{esc(career_line)}</strong> · {cr.get('g','—')} games · {pctf(cr.get('fg'))} FG% · {pctf(cr.get('tp'))} 3P%.</p>
      <h2>Stats by season — per game</h2>
      {stat_table}
      {_tot_table(p)}
      {_per36_table(p)}
      {_adv_table(p)}
      {_po_table(p, _sp)}
      {_gamelog_table(_sp, META["current"])}
      {_splits_table(_sp)}
      {_shot_table(p)}
      {contract}
      {_twok_block(pid, name)}
      {faq_html}
    </div>"""

    ld = {"@context": "https://schema.org", "@type": "Person", "name": name,
          "jobTitle": "Basketball player", "url": canonical(f"/players/{pid}.html")}
    if b.get("ht"): ld["height"] = b["ht"]
    if b.get("wt"): ld["weight"] = f"{b['wt']} lb"
    if b.get("born"): ld["birthDate"] = b["born"]
    if _cprim: ld["alumniOf"] = _cprim
    if is_real_team(team): ld["affiliation"] = {"@type": "SportsTeam", "name": tname(team), "sport": "Basketball"}

    crumb_ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": canonical("/")},
        {"@type": "ListItem", "position": 2, "name": "Players", "item": canonical("/#/players")},
        {"@type": "ListItem", "position": 3, "name": name, "item": canonical(f"/players/{pid}.html")}]}
    blocks = [ld, crumb_ld]
    if faqs:
        blocks.append({"@context": "https://schema.org", "@type": "FAQPage",
                       "mainEntity": [{"@type": "Question", "name": q,
                                       "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faqs]})

    return page(f"{name} Stats, Contract & Career", desc, canonical(f"/players/{pid}.html"), body, blocks, "profile")

# ---------- team pages ----------
def render_team(ab, t):
    latest = t["seasons"][0] if t.get("seasons") else None
    m = TEAMS.get(ab, {})
    conf = m.get("conf")
    net = (latest["o"] - latest["d"]) if latest and latest.get("o") is not None and latest.get("d") is not None else None
    rec = ""
    if latest:
        wl = f"{latest['w']}–{latest['l']}"
        rec = f"{season_label(latest['season'])} record {wl}" + (f", {'+' if net >= 0 else ''}{net:.1f} net rating" if net is not None else "") + "."
    span = f"{season_label(t['seasons'][-1]['season'])}" if t.get("seasons") else ""
    desc = (f"{t['name']} roster, record, standings and stats. {rec} "
            f"{conf + 'ern Conference. ' if conf else ''}Franchise since {span} — {len(t.get('seasons', []))} seasons on record.")

    roster = t.get("roster", [])
    r_rows = "".join(
        f'<tr><td><a href="{BASE}/players/{esc(r[0])}.html">{esc(r[1])}</a></td><td>{esc(r[2])}</td>'
        f'<td>{r[3]}</td><td>{one(r[4])}</td><td>{one(r[5])}</td><td class="hi">{one(r[6])}</td></tr>'
        for r in roster)
    roster_tbl = (f'<div class="tbl-wrap"><table class="ref"><thead><tr><th>Player</th><th>Pos</th><th>GP</th>'
                  f'<th>REB</th><th>AST</th><th>PTS</th></tr></thead><tbody>{r_rows}</tbody></table></div>') if roster else ""

    s_rows = "".join(
        f'<tr><td>{esc(season_label(s["season"]))}</td><td>{s["w"]}–{s["l"]}</td>'
        f'<td>{("+" if (s.get("srs") or 0) >= 0 else "") + one(s["srs"]) if s.get("srs") is not None else "—"}</td></tr>'
        for s in t.get("seasons", [])[:30])
    season_tbl = (f'<div class="tbl-wrap"><table class="ref"><thead><tr><th>Season</th><th>Record</th><th>SRS</th></tr>'
                  f'</thead><tbody>{s_rows}</tbody></table></div>')

    body = f"""
    <div class="wrap page">
      <nav class="crumb" aria-label="Breadcrumb"><a href="{BASE}/">Home</a><span class="sep">/</span><a href="{BASE}/#/teams">Teams</a><span class="sep">/</span><span>{esc(t['name'])}</span></nav>
      <h1>{esc(t['name'])}</h1>
      <p class="muted">{esc(conf + 'ern Conference' if conf else '')} · {rec}</p>
      <p style="margin:14px 0"><a class="btn" href="{BASE}/#/team/{esc(ab)}">View interactive team page →</a></p>
      {'<h2>Current roster leaders</h2>' + roster_tbl if roster_tbl else ''}
      <h2>Season-by-season</h2>
      {season_tbl}
    </div>"""

    ld = {"@context": "https://schema.org", "@type": "SportsTeam", "name": t["name"],
          "sport": "Basketball", "url": canonical(f"/teams/{ab}.html")}
    if conf: ld["memberOf"] = {"@type": "SportsOrganization", "name": conf + "ern Conference"}
    return page(f"{t['name']} — Roster, Record & Stats", desc, canonical(f"/teams/{ab}.html"), body, ld)

# ---------- game box-score pages (the high-traffic SEO surface: "[team] vs [team] box score") ----------
_MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
def date_pretty(d):
    try: y, m, day = d.split("-"); return f"{_MO[int(m) - 1]} {int(day)}, {y}"
    except Exception: return d

def render_game(g):
    h, a = g["home"], g["away"]
    ht, at = tname(h["abbr"]), tname(a["abbr"])
    dp = date_pretty(g["date"])
    lbl = f" · {g['label']}" if g.get("label") else (f" · {g['type']}" if g.get("type") and g["type"] != "Regular Season" else "")
    ncols = max(len(h.get("q", [])), len(a.get("q", [])))
    cols = ["1", "2", "3", "4"] + [f"OT{i+1}" if ncols - 4 > 1 else "OT" for i in range(max(0, ncols - 4))]
    def line(side):
        s = g[side]
        qs = "".join(f"<td>{s['q'][i] if s.get('q') and i < len(s['q']) else '—'}</td>" for i in range(len(cols)))
        return f"<tr><td class='l'>{esc(tname(s['abbr']))}</td>{qs}<td class='hi'>{s.get('score','—')}</td></tr>"
    def prow(p):
        nm = esc(p["name"])
        who = f'<a href="{BASE}/players/{p["pid"]}.html">{nm}</a>' if p.get("pid") else nm
        pm = ("+" + str(p["pm"]) if (p.get("pm") or 0) > 0 else str(p["pm"])) if p.get("pm") is not None else "—"
        return (f"<tr><td class='l'>{who}</td><td>{p.get('min','—')}</td><td class='hi'>{p.get('pts','—')}</td>"
                f"<td>{p.get('reb','—')}</td><td>{p.get('ast','—')}</td><td>{p.get('stl','—')}</td><td>{p.get('blk','—')}</td>"
                f"<td>{p.get('fgm','—')}-{p.get('fga','—')}</td><td>{p.get('tpm','—')}-{p.get('tpa','—')}</td><td>{pm}</td></tr>")
    def box(side):
        s = g[side]
        rows = "".join(prow(p) for p in g["box"][side] if p.get("min") is not None)
        return (f"<h2>{esc(tname(s['abbr']))} · {s.get('score','')}</h2><div class='tbl-wrap'><table class='ref' style='min-width:600px'>"
                f"<thead><tr><th class='l'>Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG</th><th>3P</th><th>+/−</th></tr></thead>"
                f"<tbody>{rows}</tbody></table></div>")
    title = f"{at} vs {ht}, {dp} — Box Score"
    desc = (f"{at} {a.get('score','')}, {ht} {h.get('score','')} — {dp}{lbl.replace(' · ', ', ')}. "
            f"Full box score with quarter scores, points, rebounds, assists and plus-minus for every player.")
    body = f"""
    <div class="wrap page">
      <nav class="crumb" aria-label="Breadcrumb"><a href="{BASE}/">Home</a><span class="sep">/</span><a href="{BASE}/#/games">Games</a><span class="sep">/</span><span>{esc(a['abbr'])} @ {esc(h['abbr'])}</span></nav>
      <h1>{esc(at)} vs {esc(ht)}</h1>
      <p class="pos">{esc(dp)}{esc(lbl)} · Final: {esc(at)} {a.get('score','')}, {esc(ht)} {h.get('score','')}</p>
      <p style="margin:14px 0"><a class="btn" href="{BASE}/#/game/{esc(g['id'])}">View interactive box score →</a></p>
      <div class="tbl-wrap"><table class="ref" style="min-width:0"><thead><tr><th class="l">Team</th>{''.join(f'<th>{c}</th>' for c in cols)}<th>T</th></tr></thead>
        <tbody>{line('away')}{line('home')}</tbody></table></div>
      {box('away')}{box('home')}
      {'<p class="muted" style="margin-top:14px">' + esc(g.get('arena','')) + (' · ' + esc(g['arenaCity']) if g.get('arenaCity') else '') + '</p>' if g.get('arena') else ''}
    </div>"""
    winner = ht if (h.get("score") or 0) > (a.get("score") or 0) else at
    ld = {"@context": "https://schema.org", "@type": "SportsEvent", "name": f"{at} vs {ht}",
          "startDate": g["date"], "sport": "Basketball", "url": canonical(f"/game/{g['id']}.html"),
          "competitor": [{"@type": "SportsTeam", "name": at}, {"@type": "SportsTeam", "name": ht}]}
    if g.get("arena"): ld["location"] = {"@type": "Place", "name": g["arena"]}
    return page(title, desc, canonical(f"/game/{g['id']}.html"), body, ld)

# ---------- aggregate landing pages (head-term SEO: "highest paid NBA players",
#            "NBA standings", "NBA scoring leaders") ----------
def season_nav(kind, years, cur, active):
    # Compact "browse other seasons" strip linking every season page of this kind — strong
    # internal linking for the long-tail (/standings/2019.html etc.). Current season -> /<kind>.html.
    def href(y): return f"{BASE}/{kind}.html" if y == cur else f"{BASE}/{kind}/{y}.html"
    links = " ".join(
        (f'<strong>{esc(season_label(y))}</strong>' if y == active
         else f'<a href="{href(y)}">{esc(season_label(y))}</a>')
        for y in years)
    return f'<nav class="season-nav" aria-label="Other seasons"><p class="muted">Browse by season: {links}</p></nav>'


def render_salaries(cur):
    yr = season_label(cur)
    by = sorted(SAL.get("bySeason", {}).get(str(cur), []), key=lambda r: -(r[3] or 0))
    top = by[:150]
    prank = dict(SAL.get("payrollRank", []))
    pr = prank.get(str(cur), [])

    prows = "".join(
        f'<tr><td>{i+1}</td>'
        f'<td class="l"><a href="{BASE}/players/{esc(r[0])}.html">{esc(r[1])}</a></td>'
        f'<td>{team_cell(r[2])}</td>'
        f'<td class="hi">{money_full(r[3])}</td></tr>'
        for i, r in enumerate(top))
    player_tbl = (f'<div class="tbl-wrap"><table class="ref"><thead><tr><th>#</th><th class="l">Player</th>'
                  f'<th>Team</th><th>{esc(yr)} salary</th></tr></thead><tbody>{prows}</tbody></table></div>')

    trows = "".join(
        f'<tr><td>{i+1}</td>'
        f'<td class="l"><a href="{BASE}/teams/{esc(ab)}.html">{esc(tname(ab))}</a></td>'
        f'<td class="hi">{money_full(tot)}</td></tr>'
        for i, (ab, tot) in enumerate(pr))
    team_tbl = (f'<div class="tbl-wrap"><table class="ref"><thead><tr><th>#</th><th class="l">Team</th>'
                f'<th>{esc(yr)} payroll</th></tr></thead><tbody>{trows}</tbody></table></div>') if pr else ""

    top1 = top[0] if top else None
    lead = (f"{top1[1]} tops the NBA at {money_full(top1[3])}" if top1 else "")
    desc = (f"The highest-paid NBA players in {yr}. {lead}. Full salary rankings for all "
            f"{len(by)} players under contract, plus team payroll totals. Updated from the current season.")
    body = f"""
    <div class="wrap page">
      <nav class="crumb" aria-label="Breadcrumb"><a href="{BASE}/">Home</a><span class="sep">/</span><span>Salaries</span></nav>
      <h1>Highest-Paid NBA Players — {esc(yr)}</h1>
      <p class="muted">Nominal salaries for the {esc(yr)} season, ranked highest to lowest. {esc(SAL.get('note',''))}</p>
      <p style="margin:14px 0"><a class="btn" href="{BASE}/#/salaries">Explore salaries interactively →</a></p>
      <h2>Player salary rankings — {esc(yr)}</h2>
      {player_tbl}
      <h2>Team payroll rankings — {esc(yr)}</h2>
      {team_tbl}
    </div>"""
    ld = {"@context": "https://schema.org", "@type": "Dataset",
          "name": f"NBA Player Salaries {yr}",
          "description": f"Salary rankings for every NBA player under contract in the {yr} season.",
          "url": canonical("/salaries.html"),
          "creator": {"@type": "Organization", "name": "Dunkwise"},
          "keywords": ["NBA salaries", "NBA player salary", "highest paid NBA players", yr]}
    return page(f"Highest-Paid NBA Players {yr} — Salaries", desc, canonical("/salaries.html"), body, ld)


def render_standings(year, season, cur, years):
    yr = season_label(year)
    is_cur = (year == cur)
    path = "/standings.html" if is_cur else f"/standings/{year}.html"
    st = season.get("standings", [])
    for row in st:
        row["_conf"] = TEAMS.get(row["abbr"], {}).get("conf", "")
    east = [r for r in st if r["_conf"] == "East"]
    west = [r for r in st if r["_conf"] == "West"]

    def conf_tbl(rows):
        body = "".join(
            f'<tr><td>{i+1}</td>'
            f'<td class="l"><a href="{BASE}/teams/{esc(r["abbr"])}.html">{esc(r["name"])}</a></td>'
            f'<td class="hi">{r["w"]}–{r["l"]}</td>'
            f'<td>{one(r["o"])}</td><td>{one(r["d"])}</td>'
            f'<td>{("+" if (r.get("srs") or 0) >= 0 else "") + one(r["srs"]) if r.get("srs") is not None else "—"}</td></tr>'
            for i, r in enumerate(rows))
        return (f'<div class="tbl-wrap"><table class="ref"><thead><tr><th>#</th><th class="l">Team</th>'
                f'<th>W–L</th><th>ORtg</th><th>DRtg</th><th>SRS</th></tr></thead><tbody>{body}</tbody></table></div>')

    lead_e = f"{east[0]['name']} ({east[0]['w']}–{east[0]['l']})" if east else ""
    lead_w = f"{west[0]['name']} ({west[0]['w']}–{west[0]['l']})" if west else ""
    champ = (season.get("champion") or {}).get("team")
    champ_txt = f" {tname(champ)} won the title." if champ and is_real_team(champ) else ""
    desc = (f"NBA standings for the {yr} season — Eastern and Western Conference records, "
            f"offensive and defensive ratings, and SRS. East leader {lead_e}; West leader {lead_w}.{champ_txt}")
    east_html = f"<h2>Eastern Conference</h2>{conf_tbl(east)}" if east else ""
    west_html = f"<h2>Western Conference</h2>{conf_tbl(west)}" if west else ""
    if not east and not west:  # pre-conference / all-time seasons — flat table
        east_html = f"<h2>League standings</h2>{conf_tbl(st)}"
    spa = f"{BASE}/#/standings" if is_cur else f"{BASE}/#/season/{year}"
    body = f"""
    <div class="wrap page">
      <nav class="crumb" aria-label="Breadcrumb"><a href="{BASE}/">Home</a><span class="sep">/</span><a href="{BASE}/standings.html">Standings</a><span class="sep">/</span><span>{esc(yr)}</span></nav>
      <h1>NBA Standings — {esc(yr)}</h1>
      <p class="muted">Regular-season records by conference for the {esc(yr)} season, with offensive/defensive ratings and Simple Rating System (SRS).{esc(champ_txt)}</p>
      <p style="margin:14px 0"><a class="btn" href="{spa}">View interactive standings →</a></p>
      {east_html}
      {west_html}
      {season_nav('standings', years, cur, year)}
    </div>"""
    ld = {"@context": "https://schema.org", "@type": "Dataset",
          "name": f"NBA Standings {yr}",
          "description": f"Eastern and Western Conference standings for the {yr} NBA season.",
          "url": canonical(path),
          "creator": {"@type": "Organization", "name": "Dunkwise"},
          "keywords": ["NBA standings", "NBA records", "Eastern Conference", "Western Conference", yr]}
    return path, page(f"NBA Standings {yr} — East & West", desc, canonical(path), body, ld)


_LEADER_CATS = [
    ("pts", "Points per game", "PPG", one),
    ("trb", "Rebounds per game", "RPG", one),
    ("ast", "Assists per game", "APG", one),
    ("stl", "Steals per game", "SPG", one),
    ("blk", "Blocks per game", "BPG", one),
    ("fg_percent", "Field goal percentage", "FG%", pctf),
    ("x3p_percent", "3-point percentage", "3P%", pctf),
    ("ft_percent", "Free throw percentage", "FT%", pctf),
    ("per", "Player efficiency rating", "PER", one),
    ("ts_percent", "True shooting percentage", "TS%", pctf),
]

def render_leaders(year, season, cur, years):
    yr = season_label(year)
    is_cur = (year == cur)
    path = "/leaders.html" if is_cur else f"/leaders/{year}.html"
    L = season.get("leaders", {})

    def cat_block(key, label, unit, fmt):
        rows = L.get(key, [])[:10]
        if not rows:
            return ""
        body = "".join(
            f'<tr><td>{i+1}</td>'
            f'<td class="l"><a href="{BASE}/players/{esc(r[0])}.html">{esc(r[1])}</a></td>'
            f'<td>{team_cell(r[2])}</td>'
            f'<td class="hi">{fmt(r[3])}</td></tr>'
            for i, r in enumerate(rows))
        return (f'<h2>{esc(label)} leaders</h2><div class="tbl-wrap"><table class="ref"><thead><tr><th>#</th>'
                f'<th class="l">Player</th><th>Team</th><th>{esc(unit)}</th></tr></thead>'
                f'<tbody>{body}</tbody></table></div>')

    blocks = "".join(cat_block(*c) for c in _LEADER_CATS)
    pts = L.get("pts", [])
    lead = f"{pts[0][1]} leads scoring at {one(pts[0][3])} PPG" if pts else ""
    desc = (f"NBA league leaders for the {yr} season — points, rebounds, assists, steals, blocks, "
            f"and shooting percentages. {lead}.")
    spa = f"{BASE}/#/leaders" if is_cur else f"{BASE}/#/season/{year}"
    body = f"""
    <div class="wrap page">
      <nav class="crumb" aria-label="Breadcrumb"><a href="{BASE}/">Home</a><span class="sep">/</span><a href="{BASE}/leaders.html">Leaders</a><span class="sep">/</span><span>{esc(yr)}</span></nav>
      <h1>NBA League Leaders — {esc(yr)}</h1>
      <p class="muted">Statistical leaders for the {esc(yr)} season across scoring, rebounding, playmaking, defense and shooting efficiency.</p>
      <p style="margin:14px 0"><a class="btn" href="{spa}">View interactive leaders →</a></p>
      {blocks}
      {season_nav('leaders', years, cur, year)}
    </div>"""
    ld = {"@context": "https://schema.org", "@type": "Dataset",
          "name": f"NBA League Leaders {yr}",
          "description": f"Statistical leaders for the {yr} NBA season.",
          "url": canonical(path),
          "creator": {"@type": "Organization", "name": "Dunkwise"},
          "keywords": ["NBA leaders", "NBA scoring leaders", "points per game", "rebounds", "assists", yr]}
    return path, page(f"NBA League Leaders {yr} — Scoring, Rebounds, Assists", desc, canonical(path), body, ld)


_AWARD_META = [
    ("mvp", "Most Valuable Player (MVP)", "NBA MVP winners by year"),
    ("fmvp", "Finals MVP", "NBA Finals MVP winners by year"),
    ("dpoy", "Defensive Player of the Year", "NBA DPOY winners by year"),
    ("roy", "Rookie of the Year", "NBA Rookie of the Year winners by year"),
    ("smoy", "Sixth Man of the Year", "NBA Sixth Man of the Year winners by year"),
    ("mip", "Most Improved Player", "NBA Most Improved Player winners by year"),
    ("clutch", "Clutch Player of the Year", "NBA Clutch Player of the Year winners by year"),
]

def render_awards(champions):
    def winner_tbl(rows):
        body = "".join(
            f'<tr><td>{esc(season_label(r[0]))}</td>'
            f'<td class="l"><a href="{BASE}/players/{esc(r[1])}.html">{esc(r[2])}</a></td>'
            f'<td>{team_cell(r[3])}</td></tr>'
            for r in rows)
        return (f'<div class="tbl-wrap"><table class="ref"><thead><tr><th>Season</th>'
                f'<th class="l">Winner</th><th>Team</th></tr></thead><tbody>{body}</tbody></table></div>')

    sections = ""
    for key, label, _ in _AWARD_META:
        rows = AWARDS.get(key, [])
        if rows:
            sections += f'<h2 id="{esc(key)}">{esc(label)}</h2>{winner_tbl(rows)}'

    champ_tbl = ""
    if champions:
        crows = "".join(
            f'<tr><td>{esc(season_label(y))}</td>'
            f'<td class="l"><a href="{BASE}/teams/{esc(ab)}.html">{esc(tname(ab))}</a></td>'
            f'<td><a href="{BASE}/standings/{y}.html">Standings</a></td></tr>'
            if not (y == META["current"]) else
            f'<tr><td>{esc(season_label(y))}</td>'
            f'<td class="l"><a href="{BASE}/teams/{esc(ab)}.html">{esc(tname(ab))}</a></td>'
            f'<td><a href="{BASE}/standings.html">Standings</a></td></tr>'
            for y, ab in champions)
        champ_tbl = ('<h2 id="champions">NBA Champions by year</h2>'
                     f'<div class="tbl-wrap"><table class="ref"><thead><tr><th>Season</th>'
                     f'<th class="l">Champion</th><th></th></tr></thead><tbody>{crows}</tbody></table></div>')

    mvp = AWARDS.get("mvp", [])
    latest_mvp = f"{mvp[0][2]} is the reigning MVP" if mvp else ""
    desc = (f"Complete list of NBA award winners by year — MVP, Finals MVP, Defensive Player of the Year, "
            f"Rookie of the Year, Sixth Man, Most Improved and Clutch Player — plus NBA champions by season. {latest_mvp}.")
    body = f"""
    <div class="wrap page">
      <nav class="crumb" aria-label="Breadcrumb"><a href="{BASE}/">Home</a><span class="sep">/</span><span>Awards</span></nav>
      <h1>NBA Awards & Champions — Winners by Year</h1>
      <p class="muted">Year-by-year winners of every major NBA award, and the league champion each season.</p>
      <p style="margin:14px 0"><a class="btn" href="{BASE}/#/awards">View interactive awards →</a></p>
      {champ_tbl}
      {sections}
    </div>"""
    ld = {"@context": "https://schema.org", "@type": "Dataset",
          "name": "NBA Award Winners & Champions by Year",
          "description": "Year-by-year NBA award winners (MVP, Finals MVP, DPOY, ROY, and more) and league champions.",
          "url": canonical("/awards.html"),
          "creator": {"@type": "Organization", "name": "Dunkwise"},
          "keywords": ["NBA MVP winners", "NBA champions", "NBA awards", "Finals MVP", "Defensive Player of the Year"]}
    return page("NBA Awards & Champions — Winners by Year", desc, canonical("/awards.html"), body, ld)


# ---------- all-time leaders (evergreen: "NBA all-time scoring leaders", "most rebounds all time") ----------
_ALLTIME_CAREER = [("pts", "Points"), ("trb", "Rebounds"), ("ast", "Assists"), ("stl", "Steals"),
                   ("blk", "Blocks"), ("x3p", "3-Pointers Made"), ("g", "Games Played"), ("tov", "Turnovers")]
_ALLTIME_SEASON = [("pts", "Points per game", "PPG"), ("trb", "Rebounds per game", "RPG"),
                   ("ast", "Assists per game", "APG"), ("stl", "Steals per game", "SPG"), ("blk", "Blocks per game", "BPG")]

def _alltime_data():
    try:
        return json.load(open(DATA / "alltime.json"))
    except FileNotFoundError:
        return {"career": {}, "season": {}}

def render_alltime_career(at):
    def block(key, label):
        rows = at.get("career", {}).get(key, [])[:25]
        if not rows:
            return ""
        # row: [pid, name, team, total, fromYr, toYr]
        body = "".join(
            f'<tr><td>{i+1}</td>'
            f'<td class="l"><a href="{BASE}/players/{esc(r[0])}.html">{esc(r[1])}</a></td>'
            f'<td>{team_cell(r[2])}</td>'
            f'<td>{season_label(r[4])[:4] if len(r) > 4 and r[4] else "—"}–{str(r[5])[2:] if len(r) > 5 and r[5] else ""}</td>'
            f'<td class="hi">{r[3]:,}</td></tr>'
            for i, r in enumerate(rows))
        return (f'<h2 id="{esc(key)}">Career {esc(label.lower())} leaders</h2><div class="tbl-wrap"><table class="ref">'
                f'<thead><tr><th>#</th><th class="l">Player</th><th>Team</th><th>Span</th><th>{esc(label)}</th></tr></thead>'
                f'<tbody>{body}</tbody></table></div>')
    blocks = "".join(block(k, l) for k, l in _ALLTIME_CAREER)
    pts = at.get("career", {}).get("pts", [])
    lead = f"{pts[0][1]} is the all-time scoring leader with {pts[0][3]:,} points" if pts else ""
    desc = (f"NBA all-time career leaders — points, rebounds, assists, steals, blocks and more, "
            f"across every season from 1947 to today. {lead}.")
    body = f"""
    <div class="wrap page">
      <nav class="crumb" aria-label="Breadcrumb"><a href="{BASE}/">Home</a><span class="sep">/</span><a href="{BASE}/leaders.html">Leaders</a><span class="sep">/</span><span>All-time</span></nav>
      <h1>NBA All-Time Career Leaders</h1>
      <p class="muted">Career totals across every NBA/BAA season since 1947. See also <a href="{BASE}/leaders/single-season.html">single-season records</a> and <a href="{BASE}/leaders.html">current-season leaders</a>.</p>
      {blocks}
    </div>"""
    ld = {"@context": "https://schema.org", "@type": "Dataset", "name": "NBA All-Time Career Leaders",
          "description": "Career statistical leaders across NBA history.", "url": canonical("/leaders/all-time.html"),
          "creator": {"@type": "Organization", "name": "Dunkwise"},
          "keywords": ["NBA all-time scoring leaders", "most points all time", "career rebounds", "career assists"]}
    return "/leaders/all-time.html", page("NBA All-Time Career Leaders — Points, Rebounds, Assists", desc,
                                          canonical("/leaders/all-time.html"), body, ld)

def render_alltime_season(at):
    def block(key, label, unit):
        rows = at.get("season", {}).get(key, [])[:25]
        if not rows:
            return ""
        # row: [pid, name, team, year, value]
        body = "".join(
            f'<tr><td>{i+1}</td>'
            f'<td class="l"><a href="{BASE}/players/{esc(r[0])}.html">{esc(r[1])}</a></td>'
            f'<td>{team_cell(r[2])}</td>'
            f'<td><a href="{BASE}/leaders/{r[3]}.html">{esc(season_label(r[3]))}</a></td>'
            f'<td class="hi">{one(r[4])}</td></tr>'
            for i, r in enumerate(rows))
        return (f'<h2 id="{esc(key)}">Single-season {esc(label.lower())} records</h2><div class="tbl-wrap"><table class="ref">'
                f'<thead><tr><th>#</th><th class="l">Player</th><th>Team</th><th>Season</th><th>{esc(unit)}</th></tr></thead>'
                f'<tbody>{body}</tbody></table></div>')
    blocks = "".join(block(*c) for c in _ALLTIME_SEASON)
    pts = at.get("season", {}).get("pts", [])
    lead = f"{pts[0][1]} holds the single-season scoring record at {one(pts[0][4])} per game ({season_label(pts[0][3])})" if pts else ""
    desc = (f"NBA single-season records — the highest scoring, rebounding, assist, steal and block "
            f"averages in a season. {lead}.")
    body = f"""
    <div class="wrap page">
      <nav class="crumb" aria-label="Breadcrumb"><a href="{BASE}/">Home</a><span class="sep">/</span><a href="{BASE}/leaders.html">Leaders</a><span class="sep">/</span><span>Single-season</span></nav>
      <h1>NBA Single-Season Records</h1>
      <p class="muted">The best statistical seasons in NBA history, per game. See also <a href="{BASE}/leaders/all-time.html">all-time career leaders</a>.</p>
      {blocks}
    </div>"""
    ld = {"@context": "https://schema.org", "@type": "Dataset", "name": "NBA Single-Season Records",
          "description": "Highest single-season statistical averages in NBA history.", "url": canonical("/leaders/single-season.html"),
          "creator": {"@type": "Organization", "name": "Dunkwise"},
          "keywords": ["most points in a season", "single season records", "highest scoring average"]}
    return "/leaders/single-season.html", page("NBA Single-Season Records — Highest Scoring Seasons", desc,
                                               canonical("/leaders/single-season.html"), body, ld)

# ---------- per-year draft pages ("2003 NBA draft", "NBA draft 2023 results") ----------
def draft_nav(years, active):
    def href(y): return f"{BASE}/draft/{y}.html"
    links = " ".join(
        (f'<strong>{y}</strong>' if y == active else f'<a href="{href(y)}">{y}</a>') for y in years)
    return f'<nav class="season-nav" aria-label="Other drafts"><p class="muted">Browse drafts: {links}</p></nav>'

def render_draft(year, d, years):
    picks = d.get("picks", [])
    def prow(pk):
        overall, rnd, tm, dpid, dname = pk[0], pk[1], pk[2], pk[3], pk[4]
        college = pk[5] if len(pk) > 5 and pk[5] else ""
        who = f'<a href="{BASE}/players/{esc(dpid)}.html">{esc(dname)}</a>' if dpid else esc(dname)
        return (f'<tr><td>{overall}</td><td>{rnd}</td><td>{team_cell(tm)}</td>'
                f'<td class="l">{who}</td><td>{esc(college)}</td></tr>')
    rows = "".join(prow(pk) for pk in picks)
    tbl = (f'<div class="tbl-wrap"><table class="ref"><thead><tr><th>Pick</th><th>Rd</th><th>Team</th>'
           f'<th class="l">Player</th><th>College/From</th></tr></thead><tbody>{rows}</tbody></table></div>') if picks else "<p>No draft data.</p>"
    top = picks[0] if picks else None
    lead = f"The {year} NBA Draft's No. 1 pick was {top[4]} ({tname(top[2]) if is_real_team(top[2]) else top[2]})" if top else ""
    desc = (f"Complete results of the {year} NBA Draft — all {len(picks)} picks with teams, players and colleges. {lead}.")
    body = f"""
    <div class="wrap page">
      <nav class="crumb" aria-label="Breadcrumb"><a href="{BASE}/">Home</a><span class="sep">/</span><a href="{BASE}/draft/index.html">Draft</a><span class="sep">/</span><span>{year}</span></nav>
      <h1>{year} NBA Draft</h1>
      <p class="muted">Every pick from the {year} NBA Draft, with the selecting team and college or prior team.</p>
      {tbl}
      {draft_nav(years, year)}
    </div>"""
    ld = {"@context": "https://schema.org", "@type": "Dataset", "name": f"{year} NBA Draft Results",
          "description": f"All picks in the {year} NBA Draft.", "url": canonical(f"/draft/{year}.html"),
          "creator": {"@type": "Organization", "name": "Dunkwise"},
          "keywords": [f"{year} NBA draft", "NBA draft results", "draft picks"]}
    return f"/draft/{year}.html", page(f"{year} NBA Draft — Full Results & Picks", desc, canonical(f"/draft/{year}.html"), body, ld)

def render_draft_index(years):
    links = "".join(f'<li><a href="{BASE}/draft/{y}.html">{y} NBA Draft</a></li>' for y in years)
    body = f"""
    <div class="wrap page">
      <nav class="crumb" aria-label="Breadcrumb"><a href="{BASE}/">Home</a><span class="sep">/</span><span>Draft</span></nav>
      <h1>NBA Draft History — Every Year</h1>
      <p class="muted">Full results for every NBA Draft from {years[-1]} to {years[0]}.</p>
      <ul class="link-cols">{links}</ul>
    </div>"""
    desc = f"NBA Draft results by year, {years[-1]}–{years[0]} — every pick, team and player for all {len(years)} drafts."
    ld = {"@context": "https://schema.org", "@type": "CollectionPage", "name": "NBA Draft History",
          "url": canonical("/draft/index.html")}
    return "/draft/index.html", page("NBA Draft History — Results by Year", desc, canonical("/draft/index.html"), body, ld)

# ---------- head-to-head comparison pages ("LeBron vs Jordan", "Curry vs Durant") ----------
MARQUEE = ["jamesle01", "jordami01", "bryanko01", "curryst01", "duranke01", "abdulka01", "johnsma02",
           "birdla01", "onealsh01", "duncati01", "garneke01", "nowitdi01", "hardeja01", "antetgi01",
           "doncilu01", "jokicni01", "gilgesh01", "embiijo01", "tatumja01", "chambwi01", "iversal01", "westbru01"]

def render_compare(pa, pb):
    a, b = pa["id"], pb["id"]
    na, nb = pa["name"], pb["name"]
    ca, cb = pa.get("career", {}), pb.get("career", {})
    ba, bb = pa.get("bio", {}), pb.get("bio", {})
    def seasons(p): return len({r[0] for r in p.get("log", [])})
    def golds(p): return sum(1 for x in p.get("acc", []) if x.get("g"))
    metrics = [
        ("Points per game", one(ca.get("pts")), one(cb.get("pts"))),
        ("Rebounds per game", one(ca.get("trb")), one(cb.get("trb"))),
        ("Assists per game", one(ca.get("ast")), one(cb.get("ast"))),
        ("Field goal %", pctf(ca.get("fg")), pctf(cb.get("fg"))),
        ("3-point %", pctf(ca.get("tp")), pctf(cb.get("tp"))),
        ("Games", str(ca.get("g", "—")), str(cb.get("g", "—"))),
        ("Seasons", str(seasons(pa)), str(seasons(pb))),
        ("Major honors", str(golds(pa)), str(golds(pb))),
        ("Height", esc(ba.get("ht", "—")), esc(bb.get("ht", "—"))),
    ]
    rows = "".join(f'<tr><th class="l">{esc(m)}</th><td class="hi">{va}</td><td class="hi">{vb}</td></tr>' for m, va, vb in metrics)
    tbl = (f'<div class="tbl-wrap"><table class="ref"><thead><tr><th class="l">Stat</th>'
           f'<th><a href="{BASE}/players/{esc(a)}.html">{esc(na)}</a></th>'
           f'<th><a href="{BASE}/players/{esc(b)}.html">{esc(nb)}</a></th></tr></thead><tbody>{rows}</tbody></table></div>')
    desc = (f"{na} vs {nb} — career comparison. "
            f"{na}: {one(ca.get('pts'))} PPG, {one(ca.get('trb'))} RPG, {one(ca.get('ast'))} APG. "
            f"{nb}: {one(cb.get('pts'))} PPG, {one(cb.get('trb'))} RPG, {one(cb.get('ast'))} APG.")
    body = f"""
    <div class="wrap page">
      <nav class="crumb" aria-label="Breadcrumb"><a href="{BASE}/">Home</a><span class="sep">/</span><a href="{BASE}/#/players">Players</a><span class="sep">/</span><span>Compare</span></nav>
      <h1>{esc(na)} vs {esc(nb)}</h1>
      <p class="muted">Career statistical comparison. View full profiles: <a href="{BASE}/players/{esc(a)}.html">{esc(na)}</a> · <a href="{BASE}/players/{esc(b)}.html">{esc(nb)}</a>.</p>
      <h2>Career averages, head to head</h2>
      {tbl}
    </div>"""
    ld = {"@context": "https://schema.org", "@type": "Dataset", "name": f"{na} vs {nb} — Career Comparison",
          "description": f"Head-to-head career statistical comparison of {na} and {nb}.",
          "url": canonical(f"/compare/{a}-vs-{b}.html"),
          "creator": {"@type": "Organization", "name": "Dunkwise"},
          "keywords": [f"{na} vs {nb}", "NBA player comparison", na, nb]}
    return f"/compare/{a}-vs-{b}.html", page(f"{na} vs {nb} — Career Comparison", desc,
                                             canonical(f"/compare/{a}-vs-{b}.html"), body, ld)

# ---------- index / hub pages (crawl discovery + "list of NBA players / teams") ----------
def render_players_index(players):
    # players: list of (pid, name). Group A–Z by last-name initial.
    def initial(nm):
        parts = nm.split()
        ch = (parts[-1] if parts else nm)[:1].upper()
        return ch if ch.isalpha() else "#"
    groups = {}
    for pid, nm in sorted(players, key=lambda x: x[1].split()[-1].lower() if x[1].split() else x[1].lower()):
        groups.setdefault(initial(nm), []).append((pid, nm))
    sections = ""
    for letter in sorted(groups):
        items = "".join(f'<li><a href="{BASE}/players/{esc(pid)}.html">{esc(nm)}</a></li>' for pid, nm in groups[letter])
        sections += f'<h2 id="{letter}">{letter}</h2><ul class="link-cols">{items}</ul>'
    desc = f"Complete A–Z index of all {len(players)} NBA and BAA players in Dunkwise, 1947 to today, with career stats, salaries and contracts for each."
    body = f"""
    <div class="wrap page">
      <nav class="crumb" aria-label="Breadcrumb"><a href="{BASE}/">Home</a><span class="sep">/</span><span>Players</span></nav>
      <h1>NBA Players — A to Z</h1>
      <p class="muted">Every player in NBA/BAA history ({len(players)} total). Browse the full interactive list at <a href="{BASE}/#/players">Players</a>.</p>
      {sections}
    </div>"""
    ld = {"@context": "https://schema.org", "@type": "CollectionPage", "name": "NBA Players A–Z",
          "url": canonical("/players/index.html")}
    return "/players/index.html", page("NBA Players A–Z — Full Player List", desc, canonical("/players/index.html"), body, ld)

def render_teams_index(teams):
    # teams: list of (abbr, name). Simple alphabetical hub.
    items = "".join(f'<li><a href="{BASE}/teams/{esc(ab)}.html">{esc(nm)}</a></li>'
                    for ab, nm in sorted(teams, key=lambda x: x[1]))
    desc = f"Every NBA and BAA franchise — {len(teams)} teams with rosters, records, standings and season-by-season history."
    body = f"""
    <div class="wrap page">
      <nav class="crumb" aria-label="Breadcrumb"><a href="{BASE}/">Home</a><span class="sep">/</span><span>Teams</span></nav>
      <h1>NBA Teams — Full List</h1>
      <p class="muted">All {len(teams)} franchises in NBA/BAA history. Browse the interactive list at <a href="{BASE}/#/teams">Teams</a>.</p>
      <ul class="link-cols">{items}</ul>
    </div>"""
    ld = {"@context": "https://schema.org", "@type": "CollectionPage", "name": "NBA Teams",
          "url": canonical("/teams/index.html")}
    return "/teams/index.html", page("NBA Teams — Full List of Franchises", desc, canonical("/teams/index.html"), body, ld)

# ---------- unique differentiators: NBA 2K ratings + injury report (bbref has neither) ----------
def render_2k(meta2k):
    # meta2k: pid -> (name, team). Rank all rated players by overall.
    ed = esc(TWOK.get("edition", "NBA 2K"))
    ranked = sorted(TWOK_R.items(), key=lambda kv: -(kv[1].get("ovr") or 0))
    def prow(i, pid, r):
        nm, tm = meta2k.get(pid, (pid, ""))
        return (f'<tr><td>{i+1}</td>'
                f'<td class="l"><a href="{BASE}/players/{esc(pid)}.html">{esc(nm)}</a></td>'
                f'<td>{team_cell(tm) if tm else "—"}</td>'
                f'<td class="hi">{r.get("ovr","—")}</td>'
                f'<td>{r.get("threePointShot","—")}</td><td>{r.get("drivingDunk","—")}</td>'
                f'<td>{r.get("perimeterDefense","—")}</td><td>{r.get("speed","—")}</td></tr>')
    rows = "".join(prow(i, pid, r) for i, (pid, r) in enumerate(ranked))
    cols = ["#", "Player", "Team", "OVR", "3PT", "Dunk", "Perim. D", "Speed"]
    thcells = "".join(f'<th class="{"l" if i == 1 else ""}">{c}</th>' for i, c in enumerate(cols))
    tbl = f'<div class="tbl-wrap"><table class="ref"><thead><tr>{thcells}</tr></thead><tbody>{rows}</tbody></table></div>'
    top = ranked[0] if ranked else None
    lead = f"{meta2k.get(top[0], (top[0],))[0]} is the highest-rated player at {top[1].get('ovr')} overall" if top else ""
    desc = (f"Complete {TWOK.get('edition','NBA 2K')} player ratings — all {len(ranked)} rated players ranked by overall, "
            f"with three-point, dunk, perimeter defense and speed attributes. {lead}.")
    body = f"""
    <div class="wrap page">
      <nav class="crumb" aria-label="Breadcrumb"><a href="{BASE}/">Home</a><span class="sep">/</span><span>2K Ratings</span></nav>
      <h1>{ed} Player Ratings</h1>
      <p class="muted">Every rated player in {ed}, ranked by overall rating. Source: {esc(TWOK.get('source',''))}.</p>
      {tbl}
    </div>"""
    ld = {"@context": "https://schema.org", "@type": "Dataset", "name": f"{TWOK.get('edition','NBA 2K')} Player Ratings",
          "description": f"Overall and attribute ratings for all players in {TWOK.get('edition','NBA 2K')}.",
          "url": canonical("/2k-ratings.html"), "creator": {"@type": "Organization", "name": "Dunkwise"},
          "keywords": [f"{TWOK.get('edition','NBA 2K')} ratings", "NBA 2K player ratings", "highest rated NBA 2K players"]}
    return "/2k-ratings.html", page(f"{TWOK.get('edition','NBA 2K')} Player Ratings — Full List", desc,
                                    canonical("/2k-ratings.html"), body, ld)

def render_injuries(namemap):
    bp = INJ.get("byPlayer", {})
    items = sorted(bp.items(), key=lambda kv: kv[1].get("date", ""), reverse=True)
    def row(pid, d):
        nm = namemap.get(pid, pid)
        return (f'<tr><td class="l"><a href="{BASE}/players/{esc(pid)}.html">{esc(nm)}</a></td>'
                f'<td>{team_cell(d.get("team","")) if d.get("team") else "—"}</td>'
                f'<td class="hi">{esc(d.get("status","—"))}</td><td>{esc(d.get("injury","—"))}</td>'
                f'<td>{esc(d.get("date","—"))}</td></tr>')
    rows = "".join(row(pid, d) for pid, d in items)
    tbl = (f'<div class="tbl-wrap"><table class="ref"><thead><tr><th class="l">Player</th><th>Team</th>'
           f'<th>Status</th><th>Injury</th><th>Updated</th></tr></thead><tbody>{rows}</tbody></table></div>') if items else "<p>No active injuries tracked.</p>"
    desc = (f"NBA injury report — {len(items)} players currently listed, with status, injury and last update. "
            f"Track who's out, questionable or day-to-day across the league.")
    body = f"""
    <div class="wrap page">
      <nav class="crumb" aria-label="Breadcrumb"><a href="{BASE}/">Home</a><span class="sep">/</span><span>Injuries</span></nav>
      <h1>NBA Injury Report</h1>
      <p class="muted">Current player injury statuses across the league, most recently updated first.</p>
      {tbl}
    </div>"""
    ld = {"@context": "https://schema.org", "@type": "Dataset", "name": "NBA Injury Report",
          "description": "Current NBA player injury statuses.", "url": canonical("/injuries.html"),
          "creator": {"@type": "Organization", "name": "Dunkwise"},
          "keywords": ["NBA injury report", "NBA injuries", "who is injured NBA"]}
    return "/injuries.html", page("NBA Injury Report — Current Player Statuses", desc, canonical("/injuries.html"), body, ld)

# ---------- Stathead-style query tool: filter/sort all current players by any stat ----------
def render_query(rows, cur):
    # rows: list of dicts with keys pid,name,team,pos,g,mp,pts,trb,ast,stl,blk,fg,tp,ft,per,ts
    yr = season_label(cur)
    rows = sorted(rows, key=lambda r: -(r["pts"] or 0))
    teams = sorted({r["team"] for r in rows if r["team"]})
    poss = sorted({r["pos"] for r in rows if r["pos"]})
    def td(v, fmt):
        return f'<td data-v="{v if v is not None else -1}">{fmt(v)}</td>'
    def tr(r):
        return (f'<tr data-name="{esc(r["name"].lower())}" data-team="{esc(r["team"])}" data-pos="{esc(r["pos"])}">'
                f'<td class="l"><a href="{BASE}/players/{esc(r["pid"])}.html">{esc(r["name"])}</a></td>'
                f'<td>{team_cell(r["team"])}</td><td>{esc(r["pos"])}</td>'
                f'{td(r["g"], lambda v: intor(v))}{td(r["mp"], one)}{td(r["pts"], one)}{td(r["trb"], one)}'
                f'{td(r["ast"], one)}{td(r["stl"], one)}{td(r["blk"], one)}'
                f'{td(r["fg"], pctf)}{td(r["tp"], pctf)}{td(r["ft"], pctf)}{td(r["per"], one)}{td(r["ts"], pctf)}</tr>')
    cols = ["Player", "Tm", "Pos", "GP", "MPG", "PTS", "REB", "AST", "STL", "BLK", "FG%", "3P%", "FT%", "PER", "TS%"]
    thead = "".join(f'<th class="{"l" if i == 0 else ""}" data-col="{i}"{" data-num=1" if i >= 3 else ""}>{c}</th>' for i, c in enumerate(cols))
    body_rows = "".join(tr(r) for r in rows)
    team_opts = "".join(f'<option value="{esc(t)}">{esc(t)}</option>' for t in teams)
    pos_opts = "".join(f'<option value="{esc(p)}">{esc(p)}</option>' for p in poss)
    controls = f"""
    <div class="query-controls" style="display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin:14px 0">
      <label>Player<br><input id="qName" type="text" placeholder="name…" autocomplete="off"></label>
      <label>Team<br><select id="qTeam"><option value="">All</option>{team_opts}</select></label>
      <label>Pos<br><select id="qPos"><option value="">All</option>{pos_opts}</select></label>
      <label>Min GP<br><input id="qG" type="number" min="0" style="width:80px"></label>
      <label>Min PTS<br><input id="qPts" type="number" min="0" style="width:80px"></label>
      <label>Min REB<br><input id="qReb" type="number" min="0" style="width:80px"></label>
      <label>Min AST<br><input id="qAst" type="number" min="0" style="width:80px"></label>
      <label>Min 3P%<br><input id="q3p" type="number" min="0" max="100" step="1" placeholder="%" style="width:80px"></label>
      <button id="qReset" class="btn" type="button">Reset</button>
    </div>
    <p class="muted" id="qCount"></p>"""
    script = """
    <script>(function(){
      var tb=document.getElementById('qBody'), rows=[].slice.call(tb.querySelectorAll('tr'));
      var f={name:qName,team:qTeam,pos:qPos,g:qG,pts:qPts,reb:qReb,ast:qAst,tp:q3p};
      function cv(tr,i){return parseFloat(tr.children[i].getAttribute('data-v'));}
      var COL={g:3,pts:5,reb:6,ast:7,tp:11};
      function num(el,scale){return el.value===''?null:(+el.value)*(scale||1);}
      function ge(tr,col,min){return min==null||cv(tr,col)>=min;}   // empty filter -> no constraint
      function apply(){
        var nm=f.name.value.trim().toLowerCase(), tm=f.team.value, ps=f.pos.value;
        var mg=num(f.g), mp=num(f.pts), mr=num(f.reb), ma=num(f.ast), m3=num(f.tp,0.01);
        var n=0;
        rows.forEach(function(tr){
          var ok = (!nm||tr.getAttribute('data-name').indexOf(nm)>=0)
            && (!tm||tr.getAttribute('data-team')===tm)
            && (!ps||tr.getAttribute('data-pos')===ps)
            && ge(tr,COL.g,mg) && ge(tr,COL.pts,mp) && ge(tr,COL.reb,mr)
            && ge(tr,COL.ast,ma) && ge(tr,COL.tp,m3);
          tr.hidden=!ok; if(ok)n++;
        });
        document.getElementById('qCount').textContent=n+' players match.';
      }
      Object.keys(f).forEach(function(k){f[k].addEventListener('input',apply);});
      document.getElementById('qReset').addEventListener('click',function(){Object.keys(f).forEach(function(k){f[k].value='';});apply();});
      var dir={};
      document.querySelectorAll('th[data-col]').forEach(function(th){
        th.style.cursor='pointer';
        th.addEventListener('click',function(){
          var i=+th.getAttribute('data-col'), num=th.hasAttribute('data-num'); dir[i]=!dir[i]; var s=dir[i]?1:-1;
          rows.sort(function(a,b){
            if(num){return (cv(a,i)-cv(b,i))*s;}
            return a.children[i].textContent.localeCompare(b.children[i].textContent)*s;
          });
          rows.forEach(function(tr){tb.appendChild(tr);});
        });
      });
      apply();
    })();</script>"""
    desc = (f"Interactive NBA {yr} player stats — filter and sort every current player by points, rebounds, assists, "
            f"shooting and more. Build custom leaderboards: find players averaging 25+ points, 10+ rebounds, and more.")
    body = f"""
    <div class="wrap page">
      <nav class="crumb" aria-label="Breadcrumb"><a href="{BASE}/">Home</a><span class="sep">/</span><span>Stat Finder</span></nav>
      <h1>NBA Stat Finder — {esc(yr)} Player Stats</h1>
      <p class="muted">Filter and sort every {esc(yr)} player by any stat. Click a column header to sort. All {len(rows)} players are listed below.</p>
      {controls}
      <div class="tbl-wrap"><table class="ref" style="min-width:900px"><thead><tr>{thead}</tr></thead>
        <tbody id="qBody">{body_rows}</tbody></table></div>
      {script}
    </div>"""
    ld = {"@context": "https://schema.org", "@type": "Dataset", "name": f"NBA {yr} Player Stats — Stat Finder",
          "description": f"Filterable per-player statistics for the {yr} NBA season.", "url": canonical("/query.html"),
          "creator": {"@type": "Organization", "name": "Dunkwise"},
          "keywords": ["NBA stat finder", f"NBA player stats {yr}", "NBA stats filter", "custom NBA leaderboard"]}
    return "/query.html", page(f"NBA Stat Finder — {yr} Player Stats", desc, canonical("/query.html"), body, ld)

# ---------- driver ----------
def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0  # optional: build only N players (for testing)
    (ROOT / "players").mkdir(exist_ok=True)
    (ROOT / "teams").mkdir(exist_ok=True)
    urls = ["/"]  # only crawlable URLs belong in the sitemap; SPA #hash routes collapse to "/"

    pfiles = sorted((DATA / "player").glob("*.json"))
    if limit: pfiles = pfiles[:limit]
    players_list = []            # (pid, name) for the A–Z index hub
    marquee = {}                 # pid -> full player dict, for comparison pages
    marquee_set = set(MARQUEE)
    namemap = {}                 # pid -> name (for injuries page)
    meta2k = {}                  # pid -> (name, team) for the 2K ratings page
    cur_rows = []                # current-season stat rows for the Stat Finder
    curyr = META["current"]
    for i, f in enumerate(pfiles):
        p = json.load(open(f))
        (ROOT / "players" / f"{p['id']}.html").write_text(render_player(p), encoding="utf-8")
        urls.append(f"/players/{p['id']}.html")
        players_list.append((p["id"], p["name"]))
        namemap[p["id"]] = p["name"]
        if p["id"] in marquee_set:
            marquee[p["id"]] = p
        c = p.get("cur") or {}
        if p["id"] in TWOK_R:
            meta2k[p["id"]] = (p["name"], c.get("team", ""))
        if c.get("season") == curyr and c.get("g"):
            cur_rows.append({"pid": p["id"], "name": p["name"], "team": c.get("team", ""),
                             "pos": c.get("pos") or (p.get("bio") or {}).get("pos") or "",
                             "g": c.get("g"), "mp": c.get("mp"), "pts": c.get("pts"), "trb": c.get("trb"),
                             "ast": c.get("ast"), "stl": c.get("stl"), "blk": c.get("blk"), "fg": c.get("fg"),
                             "tp": c.get("tp"), "ft": c.get("ft"), "per": c.get("per"), "ts": c.get("ts")})
    print(f"players: {len(pfiles)}")

    tfiles = sorted((DATA / "team").glob("*.json"))
    teams_list = []              # (abbr, name) for the teams index hub
    for f in tfiles:
        t = json.load(open(f))
        (ROOT / "teams" / f"{t['abbr']}.html").write_text(render_team(t["abbr"], t), encoding="utf-8")
        urls.append(f"/teams/{t['abbr']}.html")
        teams_list.append((t["abbr"], t["name"]))
    print(f"teams: {len(tfiles)}")

    # aggregate landing pages for head-term queries
    cur = META["current"]
    (ROOT / "salaries.html").write_text(render_salaries(cur), encoding="utf-8")
    urls.append("/salaries.html")

    # per-season standings & leaders (year-qualified long-tail: "NBA standings 2019",
    # "2016 scoring leaders"). Current season lives at /standings.html & /leaders.html.
    sfiles = sorted((DATA / "season").glob("*.json"), key=lambda f: -int(f.stem))
    years = [int(f.stem) for f in sfiles]  # newest-first, drives the season-nav strip
    (ROOT / "standings").mkdir(exist_ok=True)
    (ROOT / "leaders").mkdir(exist_ok=True)
    champions = []
    for f in sfiles:
        year = int(f.stem)
        sd = json.load(open(f))
        sp, shtml = render_standings(year, sd, cur, years)
        (ROOT / sp.lstrip("/")).write_text(shtml, encoding="utf-8")
        urls.append(sp)
        lp, lhtml = render_leaders(year, sd, cur, years)
        (ROOT / lp.lstrip("/")).write_text(lhtml, encoding="utf-8")
        urls.append(lp)
        ch = (sd.get("champion") or {}).get("team")
        if ch and is_real_team(ch):
            champions.append((year, ch))
    print(f"standings + leaders: {len(sfiles)} seasons each")

    (ROOT / "awards.html").write_text(render_awards(champions), encoding="utf-8")
    urls.append("/awards.html")
    print(f"aggregate pages: salaries.html, awards.html ({len(champions)} champions)")

    def emit(path, html):
        out = ROOT / path.lstrip("/")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(html, encoding="utf-8")
        urls.append(path)

    # all-time career + single-season leaders
    at = _alltime_data()
    emit(*render_alltime_career(at))
    emit(*render_alltime_season(at))
    print("all-time leaders: career + single-season")

    # per-year draft pages + index
    dfiles = sorted((DATA / "draft").glob("*.json"), key=lambda f: -int(f.stem))
    draft_years = [int(f.stem) for f in dfiles]
    for f in dfiles:
        emit(*render_draft(int(f.stem), json.load(open(f)), draft_years))
    emit(*render_draft_index(draft_years))
    print(f"draft: {len(dfiles)} years + index")

    # head-to-head comparison pages for marquee players (all unique pairs)
    mp = [pid for pid in MARQUEE if pid in marquee]
    ncmp = 0
    for ai in range(len(mp)):
        for bi in range(ai + 1, len(mp)):
            a, b = sorted((mp[ai], mp[bi]))  # canonical ordering -> one URL per pair
            emit(*render_compare(marquee[a], marquee[b]))
            ncmp += 1
    print(f"comparison pages: {ncmp} ({len(mp)} marquee players)")

    # index / hub pages
    emit(*render_players_index(players_list))
    emit(*render_teams_index(teams_list))
    print("index hubs: players/index.html, teams/index.html")

    # unique differentiators (bbref has neither)
    if TWOK_R and SHOW_2K:
        emit(*render_2k(meta2k))
        print(f"2K ratings: {len(TWOK_R)} players")
    if INJ.get("byPlayer"):
        emit(*render_injuries(namemap))
        print(f"injury report: {len(INJ['byPlayer'])} players")
    if cur_rows:
        emit(*render_query(cur_rows, cur))
        print(f"stat finder: {len(cur_rows)} current players")

    # game box-score pages — the biggest long-tail SEO surface. Scoped to recent seasons for size;
    # override with GAME_SEASONS="2026,2025,..." (or "all"). Default: last 4 seasons.
    gs_env = os.environ.get("GAME_SEASONS", "")
    if gs_env == "all":
        game_seasons = None
    elif gs_env:
        game_seasons = set(int(x) for x in gs_env.split(","))
    else:
        game_seasons = set(range(cur - 3, cur + 1))
    (ROOT / "game").mkdir(exist_ok=True)
    ng = 0
    for idxf in sorted((DATA / "games").glob("*.json")):
        season = int(idxf.stem)
        if game_seasons is not None and season not in game_seasons:
            continue
        for row in json.load(open(idxf))["games"]:
            gf = DATA / "game" / f"{row['id']}.json"
            if not gf.exists():
                continue
            g = json.load(open(gf))
            if not g.get("box") or not (g["box"]["home"] or g["box"]["away"]):
                continue   # skip score-only games (no box) — thin for SEO
            (ROOT / "game" / f"{row['id']}.html").write_text(render_game(g), encoding="utf-8")
            urls.append(f"/game/{row['id']}.html")
            ng += 1
    print(f"game box scores: {ng}")

    loc = lambda u: (SITE_URL + u) if SITE_URL else u
    sm = ['<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">'.replace("www.sitemap.org", "www.sitemaps.org")]
    for u in urls:
        sm.append(f"  <url><loc>{esc(loc(u))}</loc><lastmod>{BUILD_DATE}</lastmod></url>")
    sm.append("</urlset>")
    (ROOT / "sitemap.xml").write_text("\n".join(sm), encoding="utf-8")

    robots = f"User-agent: *\nAllow: /\nSitemap: {loc('/sitemap.xml')}\n"
    (ROOT / "robots.txt").write_text(robots, encoding="utf-8")
    print(f"sitemap.xml: {len(urls)} urls · robots.txt written")

if __name__ == "__main__":
    main()
