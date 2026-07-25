#!/usr/bin/env python3
"""
Harvest per-edition NBA 2K overall ratings -> data/twok_history.json.

the ratings site blocks automated clients (403, bot protection), so we read archived
copies from a web archive instead. Player pages from ~2019-2022 embed a
Chart.js "Ratings Over the Years" line chart whose config carries one OVR per
edition, e.g. LeBron: 2K4=78 ... 2K21=97. Later snapshots dropped that chart in
a redesign, so we deliberately target the window that still has it.

Only plain player slugs are used (/kevin-durant). Season-specific classic cards
(/kobe-bryant-1997-98-los-angeles-lakers) are a different dataset — one rating
for one historical season, not a progression — and are skipped.

Resumable: every fetched slug is appended to a cache file, so re-running picks
up where it stopped. Rate-limited on purpose; the archive returns 429 if pushed.

Run:  python3 build/harvest_2k_history.py [--limit N]
"""
import json, os, re, sys, time, unicodedata, urllib.error, urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(BASE, "..")
CACHE = os.path.join(BASE, ".2k-history-cache.jsonl")
UA = {"User-Agent": "Mozilla/5.0 (DunkwiseBot; dataset import; contact via github)"}

CDX = ("http://web.archive.org/cdx/search/cdx?url=2kratings.com&matchType=domain"
       "&output=json&fl=original,timestamp&filter=statuscode:200"
       "&limit=120000&from=20160101&to=20221231")
DELAY = 1.6          # seconds between page fetches
CANDIDATES = 6       # snapshots to try per player before giving up
SEASON_SLUG = re.compile(r"-\d{4}-\d{2}-")     # classic-card slugs carry a season
PLAIN_SLUG = re.compile(r"^https?://(?:www\.)?2kratings\.com/([a-z][a-z0-9-]{3,})/?$")


def fetch(url, timeout=60, tries=5):
    """GET with backoff; the archive 429s readily."""
    for a in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and a < tries - 1:
                time.sleep(6 * (a + 1))
                continue
            if e.code == 404:
                return None
            if a == tries - 1:
                return None
        except Exception:
            if a == tries - 1:
                return None
            time.sleep(3 * (a + 1))
    return None


def parse_history(html):
    """{edition: ovr} from the line-year chart config, or None."""
    i = html.find('getElementById("chartjs-dashboard-line-year")')
    if i < 0:
        return None
    blk = html[i:i + 3000]
    lm = re.search(r"labels:\s*\[(.*?)\]", blk, re.S)
    dm = re.search(r"data:\s*\[(.*?)\]", blk, re.S)
    if not (lm and dm):
        return None
    labels = [l.replace("NBA ", "").strip() for l in re.findall(r'"([^"]+)"', lm.group(1))]
    vals = [v.strip() for v in dm.group(1).split(",")]
    # blank slots mean the player wasn't in that edition — keep them out entirely
    out = {labels[j]: int(v) for j, v in enumerate(vals) if j < len(labels) and v.isdigit()}
    return out or None


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[.'’‘`]", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


CHART_ERA = "20220101"   # the "Over the Years" chart lived until a mid-2022 redesign


def candidate_snapshots():
    """slug -> up to CANDIDATES timestamps, best chart-era captures first.

    One timestamp is not enough: the archive holds plenty of partial captures
    missing the chart script, and the site dropped the chart in a mid-2022
    redesign. So keep several and try them in turn — but pure newest-first is
    wrong, because a player whose only recent captures are post-redesign (all of
    Durant's are late 2022) never reaches a snapshot that still has the chart.
    Order by nearness to the chart era instead, preferring the latest capture
    that still predates the redesign (most editions, chart still present).
    """
    raw = fetch(CDX, timeout=240)
    if not raw:
        sys.exit("could not reach the archive CDX index")
    by_slug = {}
    for orig, ts in json.loads(raw.decode())[1:]:
        m = PLAIN_SLUG.match(orig)
        if not m or SEASON_SLUG.search(orig):
            continue
        by_slug.setdefault(m.group(1), []).append(ts)

    def rank(ts):
        # pre-redesign captures first (newest of them wins), then post-redesign
        # as a fallback, oldest-first so we still try something.
        return (0, -int(ts)) if ts < CHART_ERA else (1, int(ts))

    return {k: sorted(v, key=rank)[:CANDIDATES] for k, v in by_slug.items()}


def load_cache():
    done = {}
    if os.path.exists(CACHE):
        for line in open(CACHE):
            try:
                r = json.loads(line)
                done[r["slug"]] = r.get("hist")
            except Exception:
                pass
    return done


def main():
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])

    snaps = candidate_snapshots()

    # Only fetch slugs that look like a player we actually have — the site also
    # archives /about, /add-players-to-compare and similar, and every wasted
    # fetch is a second of someone else's bandwidth.
    search = json.load(open(os.path.join(ROOT, "data", "search.json")))
    known = {norm(e[1]) for e in search}
    snaps = {k: v for k, v in snaps.items() if norm(k.replace("-", " ")) in known}

    done = load_cache()
    todo = [s for s in sorted(snaps) if s not in done]
    if limit:
        todo = todo[:limit]
    print(f"archived player slugs: {len(snaps)}  cached: {len(done)}  to fetch: {len(todo)}", flush=True)

    with open(CACHE, "a") as cf:
        for n, slug in enumerate(todo, 1):
            hist = None
            for ts in snaps[slug]:            # newest first; stop at the first capture with a chart
                html = fetch(f"http://web.archive.org/web/{ts}id_/https://www.2kratings.com/{slug}")
                if html:
                    hist = parse_history(html.decode("utf-8", "replace"))
                    if hist:
                        break
                time.sleep(DELAY)
            cf.write(json.dumps({"slug": slug, "hist": hist}) + "\n")
            cf.flush()
            done[slug] = hist
            if n % 25 == 0 or n == len(todo):
                got = sum(1 for v in done.values() if v)
                print(f"  {n}/{len(todo)} fetched · {got} with history", flush=True)
            time.sleep(DELAY)

    # ---- match slugs to our player ids by name ----
    idx = {}
    for e in search:                       # [id, name, from, to, pos, team, nbaId]
        idx.setdefault(norm(e[1]), []).append(((e[3] or 0), e[0]))
    for k in idx:
        idx[k].sort(reverse=True)          # prefer the most recent player on a name clash

    hist_by_id, unmatched = {}, []
    for slug, hist in done.items():
        if not hist:
            continue
        hit = idx.get(norm(slug.replace("-", " ")))
        if not hit:
            unmatched.append(slug)
            continue
        pid = hit[0][1]
        # a name collision could map two slugs to one id; keep the longer history
        if pid not in hist_by_id or len(hist) > len(hist_by_id[pid]):
            hist_by_id[pid] = dict(hist)

    # The archived charts stop at 2K22 (the "Over the Years" chart was dropped in a
    # mid-2022 redesign, and every edition since renders the overall in CSS/JS that
    # leaves no parseable number in the HTML). Bridge the timeline to the present by
    # folding in the current-edition OVR we already ship in data/twok.json.
    merged_ed = None
    try:
        cur = json.load(open(os.path.join(ROOT, "data", "twok.json")))
        merged_ed = (cur.get("edition") or "").replace("NBA ", "").strip() or None
        if merged_ed:
            for pid, rec in (cur.get("ratings") or {}).items():
                if rec.get("ovr") is not None:
                    hist_by_id.setdefault(pid, {})[merged_ed] = rec["ovr"]
    except FileNotFoundError:
        pass

    editions = sorted({e for h in hist_by_id.values() for e in h},
                      key=lambda x: int(re.sub(r"\D", "", x) or 0) or -1)
    out = {
        "source": "2kratings.com charts 2K4-2K22 (via web.archive.org) + current edition from data/twok.json",
        "note": "overall rating per NBA 2K edition; a missing edition means no rating on record (e.g. 2K23-24, which no clean machine-readable source covers)",
        "editions": editions,
        "count": len(hist_by_id),
        "players": hist_by_id,
    }
    with open(os.path.join(ROOT, "data", "twok_history.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"\nmatched {len(hist_by_id)} players · {len(editions)} editions · unmatched {len(unmatched)}")
    if unmatched:
        print("unmatched sample:", ", ".join(unmatched[:15]))


if __name__ == "__main__":
    main()
