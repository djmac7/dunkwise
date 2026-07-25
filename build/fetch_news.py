#!/usr/bin/env python3
"""
Fetch NBA headlines from public RSS/Atom feeds -> data/news.json.
Stores only headline + link + source + timestamp (a headlines aggregator that
links out to each publisher; no article text is copied). Re-run to refresh.
"""
import html, json, os, re, sys, urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import xml.etree.ElementTree as ET

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "news.json")
FEEDS = [
    ("ESPN", "https://www.espn.com/espn/rss/nba/news"),
    ("CBS Sports", "https://www.cbssports.com/rss/headlines/nba/"),
    ("Yahoo Sports", "https://sports.yahoo.com/nba/rss/"),
    ("Bleacher Report", "https://bleacherreport.com/articles/feed?tag_id=19"),
    ("Sporting News", "https://www.sportingnews.com/us/rss/nba"),
    ("r/nba", "https://www.reddit.com/r/nba/.rss"),
]
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

# ---- tag players mentioned in each headline/summary (link to our player pages) ----
try:
    search = json.load(open(os.path.join(os.path.dirname(OUT), "search.json")))
    # prefer more-recent players when two share a name; full-name (has space) only
    people = sorted([(e[1], e[0], e[3]) for e in search if " " in e[1]], key=lambda x: x[2])
    by_name = {}
    for nm, pid, _to in people:
        by_name[nm.lower()] = (pid, nm)          # later (more recent) overwrites -> current player wins
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
