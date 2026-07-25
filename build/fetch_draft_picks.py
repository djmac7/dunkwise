#!/usr/bin/env python3
"""Fetch the future draft-pick ledger from the draft source and rebuild data/draft_picks.json.

the draft source sits behind a bot protection JS challenge, so plain HTTP (requests / curl /
curl_cffi / headless-shell) all get a 403 "Just a moment…" page. Only a *headful*
real browser clears it — so this drives Playwright Chromium with a display
(locally: a real window; in CI: `xvfb-run`). See [[draft-picks-source]].

Pipeline:
  the draft source page  →  extract tables (same JS the manual harvest used)
               →  build/draft_picks_raw.json  →  build_draft_picks.py  →  data/draft_picks.json

Safety: refuses to overwrite when it can't scrape all 30 teams, so a blocked run
(e.g. bot protection flagging a datacenter IP) leaves the last-good data in place and
exits non-zero instead of shipping an empty ledger.

Requirements (once):  pip install playwright  &&  playwright install chromium
Run:                  python3 build/fetch_draft_picks.py
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "draft_picks_raw.json")
URL = "https://basketball.realgm.com/nba/draft/future_drafts/team"

# Extraction runs in the page: map team names → the reference source abbrs, normalise the draft source's abbr
# tokens to the site's, and split each cell into {n, note, total}. Kept in sync with
# the one-off browser harvest that seeded the data.
EXTRACT_JS = r"""
() => {
  const NAME2AB = {
    "Atlanta Hawks":"ATL","Boston Celtics":"BOS","Brooklyn Nets":"BKN","Charlotte Hornets":"CHA",
    "Chicago Bulls":"CHI","Cleveland Cavaliers":"CLE","Dallas Mavericks":"DAL","Denver Nuggets":"DEN",
    "Detroit Pistons":"DET","Golden State Warriors":"GSW","Houston Rockets":"HOU","Indiana Pacers":"IND",
    "Los Angeles Clippers":"LAC","Los Angeles Lakers":"LAL","Memphis Grizzlies":"MEM","Miami Heat":"MIA",
    "Milwaukee Bucks":"MIL","Minnesota Timberwolves":"MIN","New Orleans Pelicans":"NOP","New York Knicks":"NYK",
    "Oklahoma City Thunder":"OKC","Orlando Magic":"ORL","Philadelphia Sixers":"PHI","Phoenix Suns":"PHX",
    "Portland Trail Blazers":"POR","Sacramento Kings":"SAC","San Antonio Spurs":"SAS","Toronto Raptors":"TOR",
    "Utah Jazz":"UTA","Washington Wizards":"WAS"
  };
  const REMAP = {SAN:"SAS", GOS:"GSW", BRK:"BKN", PHL:"PHI", UTH:"UTA"};
  const norm = (s) => s.replace(/\b(SAN|GOS|BRK|PHL|UTH)\b/g, m => REMAP[m]);
  const parseCell = (raw) => {
    let lines = raw.split("\n").map(l => l.trim());
    while (lines.length && lines[lines.length-1] === "") lines.pop();
    let n = "0";
    const last = lines[lines.length-1] || "";
    if (/^\d+(\s*\+\s*\d+)*$/.test(last)) { n = last.replace(/\s+/g,""); lines.pop(); }
    while (lines.length && lines[lines.length-1] === "") lines.pop();
    let note = norm(lines.join("\n").replace(/\n{3,}/g,"\n\n").trim());
    const total = n.split("+").reduce((a,b)=>a+(parseInt(b,10)||0),0);
    return { n, note, total };
  };
  const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5')].filter(h => /Future NBA Draft Picks/i.test(h.textContent));
  const teams = {};
  heads.forEach(h => {
    let el = h, tbl = null;
    while ((el = el.nextElementSibling)) { if (el.tagName === 'TABLE') { tbl = el; break; } if (el.querySelector && el.querySelector('table')) { tbl = el.querySelector('table'); break; } }
    if (!tbl) return;
    const name = h.textContent.replace(/Future NBA Draft Picks/i,'').trim();
    const ab = NAME2AB[name];
    if (!ab) return;
    const trs = [...tbl.querySelectorAll('tr')].slice(1);
    teams[ab] = trs.map(tr => {
      const c = [...tr.querySelectorAll('td,th')].map(td => td.innerText.replace(/ /g,' '));
      return { y: parseInt(c[0].trim(),10), r1: parseCell(c[1]||""), r2: parseCell(c[2]||"") };
    });
  });
  return teams;
}
"""

EXPECT_TEAMS = 30


def scrape():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        # Headful is required — headless Chromium is fingerprinted and stuck on the
        # bot protection challenge. In CI, wrap the whole command in `xvfb-run`.
        browser = p.chromium.launch(headless=False, args=["--disable-blink-features=AutomationControlled"])
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
            viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        page.goto(URL, wait_until="domcontentloaded", timeout=45000)
        # give the bot protection interstitial up to ~30s to auto-clear
        teams = {}
        for _ in range(30):
            teams = page.evaluate(EXTRACT_JS)
            if len(teams) >= EXPECT_TEAMS:
                break
            time.sleep(1)
        browser.close()
        return teams


def main():
    try:
        teams = scrape()
    except Exception as e:
        print(f"fetch_draft_picks: scrape failed ({type(e).__name__}: {e})", file=sys.stderr)
        return 1
    if len(teams) < EXPECT_TEAMS:
        print(f"fetch_draft_picks: only {len(teams)}/{EXPECT_TEAMS} teams "
              f"(bot protection block?) — keeping existing data, not overwriting.", file=sys.stderr)
        return 1
    json.dump(teams, open(RAW, "w"), ensure_ascii=False)
    print(f"fetch_draft_picks: harvested {len(teams)} teams → {os.path.relpath(RAW)}")
    # transform raw → data/draft_picks.json
    import build_draft_picks
    build_draft_picks.main()
    return 0


if __name__ == "__main__":
    sys.path.insert(0, HERE)
    sys.exit(main())
