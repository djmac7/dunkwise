#!/usr/bin/env python3
"""
Fetch NBA headlines from public RSS/Atom feeds -> data/news.json.
Stores only headline + link + source + timestamp (a headlines aggregator that
links out to each publisher; no article text is copied). Re-run to refresh.
"""
import html, json, os, re, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import xml.etree.ElementTree as ET

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "news.json")
# Mainstream NBA outlets plus r/nba as a community aggregator. Each item links out to
# its publisher; we store only headline + link + source + timestamp.
FEEDS = [
    ("ESPN", "https://www.espn.com/espn/rss/nba/news"),
    ("CBS Sports", "https://www.cbssports.com/rss/headlines/nba/"),
    ("Yahoo Sports", "https://sports.yahoo.com/nba/rss/"),
    ("Hoops Rumors", "https://www.hoopsrumors.com/feed"),
    ("Sporting News", "https://www.sportingnews.com/us/rss/nba"),
    ("r/nba", "https://www.reddit.com/r/nba/.rss"),
]
# Skip r/nba's recurring mod/discussion posts — they aren't news.
REDDIT_SKIP = re.compile(
    r"\b(game thread|daily discussion|weekly .*thread|free talk|megathread|"
    r"self-?promotion|fan art|post[- ]?game thread|highlights? thread|"
    r"moronic monday|thursday|writing team|awards?[- ]?thread)\b", re.I)
UA = {"User-Agent": "Mozilla/5.0 (DunkwiseBot; headlines aggregator)"}

def tag(el):  # strip namespace
    return el.tag.split("}")[-1]

def parse_date(s):
    if not s: return None
    try:
        return parsedate_to_datetime(s).astimezone(timezone.utc)
    except Exception:
        for f in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ"):
            try:
                d = datetime.strptime(s, f)
                return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d.astimezone(timezone.utc)
            except Exception:
                pass
    return None

def clean(t):
    # feeds arrive HTML-encoded ("It&#39;s", "Golden State &amp; …"); decode entities to
    # real characters first, then strip tags and collapse whitespace. Without the unescape
    # the render layer re-escapes the "&", so "&#39;" leaks through to the page as text.
    t = html.unescape(t or "")
    t = re.sub(r"<[^>]+>", "", t)
    return re.sub(r"\s+", " ", t).strip()

def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=12) as r:
        return r.read()

def find_image(it):
    """Best-effort image URL from RSS/Atom media tags or an <img> in the body."""
    for ch in it:
        tg = tag(ch)
        if tg in ("thumbnail", "content") and ch.get("url", "").startswith("http") and \
           (tg == "thumbnail" or (ch.get("medium") == "image" or "image" in ch.get("type", ""))):
            return ch.get("url")
        if tg == "enclosure" and "image" in (ch.get("type", "")) and ch.get("url"):
            return ch.get("url")
        if tg == "group":                          # media:group wraps media:content
            u = find_image(ch)
            if u: return u
    for ch in it:                                   # fall back to first <img> in html body
        if tag(ch) in ("encoded", "description", "summary", "content") and ch.text:
            m = re.search(r'<img[^>]+src="([^"]+)"', ch.text)
            if m and m.group(1).startswith("http"): return m.group(1)
    return None

def find_summary(it):
    # gather every candidate (description / summary / content:encoded) and keep the
    # richest one — some feeds put only a line in <description> but the fuller lede in
    # <content:encoded>. Capped to a clear excerpt so we never reproduce a full body.
    cands = []
    for ch in it:
        if tag(ch) in ("description", "summary", "encoded", "content") and ch.text:
            s = clean(ch.text)
            if s and not s.startswith("submitted by"):
                cands.append(s)
    if not cands:
        return None
    s = max(cands, key=len)
    return s[:900].rsplit(" ", 1)[0] + ("…" if len(s) > 900 else "")

items, seen = [], set()
for source, url in FEEDS:
    try:
        root = ET.fromstring(fetch(url))
    except Exception as e:
        print(f"  ! {source}: {e}", file=sys.stderr); continue
    nodes = [e for e in root.iter() if tag(e) in ("item", "entry")]
    got = 0
    for it in nodes:
        title = link = date = None
        for ch in it:
            tg = tag(ch)
            if tg == "title": title = clean(ch.text)
            elif tg == "link": link = (ch.get("href") or ch.text or "").strip()
            elif tg in ("pubDate", "published", "updated") and not date:
                date = parse_date(ch.text)
        if not title or not link: continue
        if source == "r/nba" and REDDIT_SKIP.search(title): continue   # drop recurring threads
        key = re.sub(r"[^a-z0-9]", "", title.lower())[:60]
        if key in seen: continue
        seen.add(key)
        items.append({"title": title, "url": link, "source": source,
                      "ts": date.isoformat() if date else None,
                      "img": find_image(it), "summary": find_summary(it)})
        got += 1
        if got >= 12: break
    print(f"  {source}: {got}")

items.sort(key=lambda x: (x["ts"] or ""), reverse=True)
items = items[:48]

# The NBA CDN serves this exact-size PNG (a grey silhouette) for any valid personId that has
# no real headshot — with HTTP 200, so the client can't tell it apart from a photo. A cheap
# HEAD request reveals it via Content-Length, so we flag photo-less players and the cover-art
# generator drops them (see newsCover) instead of rendering a grey cutout.
SILHOUETTE_LEN = 12430
HEADSHOT = "https://cdn.nba.com/headshots/nba/latest/1040x760/{}.png"
def probe_photo(person_id):
    """True if this NBA personId has a real headshot (not the generic silhouette).
    Uses curl for the HEAD probe: cdn.nba.com (Akamai) hangs on urllib requests."""
    if not person_id: return False
    try:
        out = subprocess.run(["curl", "-sI", "-A", UA["User-Agent"], "--max-time", "12",
                              HEADSHOT.format(person_id)], capture_output=True, text=True, timeout=15).stdout
        for line in out.splitlines():
            if line.lower().startswith("content-length:"):
                return int(line.split(":", 1)[1].strip()) != SILHOUETTE_LEN
        return True   # no Content-Length seen -> keep the face
    except Exception:
        return True   # inconclusive probe -> keep the face rather than hide a real photo

# ---- tag players mentioned in each headline/summary (link to our player pages) ----
try:
    search = json.load(open(os.path.join(os.path.dirname(OUT), "search.json")))
    # prefer more-recent players when two share a name; full-name (has space) only
    people = sorted([(e[1], e[0], e[3]) for e in search if " " in e[1]], key=lambda x: x[2])
    by_name = {}
    for nm, pid, _to in people:
        by_name[nm.lower()] = (pid, nm)          # later (more recent) overwrites -> current player wins
    nba_by_pid = {e[0]: e[6] for e in search if len(e) > 6 and e[6]}   # bbref id -> NBA personId
    names = sorted(by_name.keys(), key=len, reverse=True)  # match longer names first
    for it in items:
        text = (it["title"] + " " + (it["summary"] or "")).lower()
        tags, used = [], []
        for nm in names:
            if nm in text and not any(nm in u for u in used):
                pid, disp = by_name[nm]
                tags.append([pid, disp]); used.append(nm)
                if len(tags) >= 4: break
        it["players"] = tags
    # Probe each tagged player's headshot once, in parallel, then flag it (3rd element) so
    # newsCover can skip silhouettes. Kept out of the tag loop to avoid serial HEAD latency.
    person_of = {p[0]: nba_by_pid.get(p[0]) for it in items for p in it["players"]}
    uniq = list({v for v in person_of.values() if v})
    with ThreadPoolExecutor(max_workers=16) as ex:
        photo = dict(zip(uniq, ex.map(probe_photo, uniq)))
    for it in items:
        for p in it["players"]:
            person = person_of.get(p[0])
            p.append(bool(person) and photo.get(person, True))
except Exception as e:
    print(f"  ! player tagging skipped: {e}", file=sys.stderr)
    for it in items: it["players"] = []

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump({"fetched": datetime.now(timezone.utc).isoformat(), "items": items},
              f, separators=(",", ":"), ensure_ascii=False)
withimg = sum(1 for i in items if i.get("img"))
withtags = sum(1 for i in items if i.get("players"))
print(f"wrote {len(items)} headlines ({withimg} with image, {withtags} tagged) -> {OUT}")
