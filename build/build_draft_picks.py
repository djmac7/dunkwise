#!/usr/bin/env python3
"""Build data/draft_picks.json — the future draft-pick ledger for all 30 teams.

Source: RealGM "NBA Future Draft Picks By Team"
        https://basketball.realgm.com/nba/draft/future_drafts/team
RealGM is the ground truth for pick ownership (own picks, incoming picks from
trades, swap rights and protections) — it's re-scraped into build/draft_picks_raw.json,
which this script normalises into the site's shape.

The raw harvest (build/draft_picks_raw.json) keeps RealGM's per-team / per-year
first- and second-round cells. Each cell is {n, note, total}:
  n     — pick count as RealGM shows it ("1", "0", "1 + 2"): guaranteed + conditional
  note  — the plain-language description of which picks (already abbr-normalised to
          the site's convention: SAN→SAS, GOS→GSW, BRK→BKN, PHL→PHI, UTH→UTA)
  total — n summed to a single integer, for headline counts

Re-harvest is automated by fetch_draft_picks.py (headful Playwright — RealGM 403s
every non-browser fetch), which rewrites draft_picks_raw.json and calls this. The
refresh-picks GitHub Action runs it weekly. Rerun build_seo.py afterwards (or just
the team pages) so the static SEO pages pick up the new ledger.
"""
import datetime
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(HERE, "draft_picks_raw.json")
OUT = os.path.join(ROOT, "data", "draft_picks.json")

# "as of" tracks when the raw harvest was last refreshed (its file mtime), so an
# automated re-fetch re-stamps the date without a manual edit.
try:
    AS_OF = datetime.date.fromtimestamp(os.path.getmtime(RAW)).isoformat()
except OSError:
    AS_OF = datetime.date.today().isoformat()
SOURCE = "RealGM"
SOURCE_URL = "https://basketball.realgm.com/nba/draft/future_drafts/team"


def main():
    raw = json.load(open(RAW))
    teams = {}
    years = set()
    for ab, rows in raw.items():
        rows = sorted(rows, key=lambda r: r["y"])
        firsts = seconds = 0
        out_rows = []
        for r in rows:
            years.add(r["y"])
            r1, r2 = r["r1"], r["r2"]
            firsts += r1.get("total", 0)
            seconds += r2.get("total", 0)
            out_rows.append({
                "y": r["y"],
                "r1": {"n": r1["n"], "note": r1["note"]},
                "r2": {"n": r2["n"], "note": r2["note"]},
            })
        teams[ab] = {"firsts": firsts, "seconds": seconds, "rows": out_rows}

    doc = {
        "source": SOURCE,
        "url": SOURCE_URL,
        "asOf": AS_OF,
        "years": sorted(years),
        "teams": teams,
    }
    json.dump(doc, open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {OUT}: {len(teams)} teams, years {min(years)}–{max(years)}")


if __name__ == "__main__":
    main()
