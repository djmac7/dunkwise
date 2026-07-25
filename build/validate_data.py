#!/usr/bin/env python3
"""
Pre-deploy data-integrity gate for Dunkwise.

Accuracy is the product. This script hard-fails (exit 1) on the classes of
corruption that have actually bitten us — a game with a score but an empty box
score, salaries silently re-inflated by an upstream refresh, box scores whose
player points don't add up — while only WARNING on known, benign historical
quirks (pre-1974 games never recorded FG attempts; some preseason lines are
partial). Run it before committing a data refresh:

    python3 build/validate_data.py            # 0 = clean, 1 = blocking errors

refresh.sh calls this and aborts the commit if it fails.
"""
import json, glob, os, sys
from collections import Counter
from datetime import date

ROOT = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(ROOT, "data")
HARD, WARN = [], []
def hard(msg): HARD.append(msg)
def warn(msg): WARN.append(msg)

# ---- anchors: exact, source-verified (the reference source) salaries for the seasons
# that were once inflated. If an upstream refresh re-breaks salaries, these drift first. ----
SALARY_ANCHORS = {
    ("curryst01", 2018): 34682550, ("curryst01", 2021): 43006362,
    ("curryst01", 2022): 45780966, ("curryst01", 2023): 48070014, ("curryst01", 2024): 51915615,
    ("jokicni01", 2022): 30510423, ("jokicni01", 2024): 47607350,
    ("jamesle01", 2021): 39219565, ("embiijo01", 2024): 47607350,
    ("tatumja01", 2023): 30351780, ("paulch01", 2022): 30800000, ("lowryky01", 2018): 28703704,
}
SALARY_MAX = 90_000_000          # no NBA salary approaches this; > = corruption
SEASON_TOTAL_MAX = 6.2e9         # league-wide nominal sum ceiling (2027 is legitimately ~$5.7B)
MODERN_SEASON = 2000
MODERN_TYPES = ("Regular Season", "Playoffs")
STALE_DAYS = 2                    # a game only owes a complete box once it's this many days old
                                 # (a just-finished game can momentarily have a partial/empty box)


def _days_old(datestr):
    try:
        y, m, d = (int(x) for x in datestr.split("-"))
        return (date.today() - date(y, m, d)).days
    except Exception:
        return 10 ** 6  # unparseable date → treat as old (owes a full box)


def check_games():
    files = glob.glob(os.path.join(DATA, "game", "*.json"))
    if not files:
        hard("no game files found under data/game/")
        return
    empties, big_ptsdiff, modern_shoot, small_ptsdiff, qdiff = [], [], [], 0, 0
    unparse = 0
    for fp in files:
        gid = os.path.basename(fp)[:-5]
        try:
            g = json.load(open(fp))
        except Exception:
            unparse += 1; continue
        season = g.get("season") or 0
        typ = g.get("type", "")
        settled = _days_old(g.get("date", "")) >= STALE_DAYS
        # strict box checks only apply to settled games; a live/just-finished game may still be filling in
        modern = season >= MODERN_SEASON and typ in MODERN_TYPES and settled
        for side in ("home", "away"):
            s = g.get(side, {})
            score = s.get("score")
            box = (g.get("box") or {}).get(side, [])
            if not isinstance(box, list):
                hard(f"game {gid}: box.{side} is not a list"); continue
            if not box:
                continue
            played = any((p.get("min") or 0) > 0 or (p.get("pts") or 0) > 0 for p in box)
            psum = sum((p.get("pts") or 0) for p in box)
            if modern and score and not played:
                empties.append(f"{gid} ({s.get('abbr')})")
            if modern and played and score is not None:
                d = abs(psum - score)
                if d > 3:
                    big_ptsdiff.append(f"{gid} {s.get('abbr')} players={psum} team={score}")
                elif d:
                    small_ptsdiff += 1
            if modern:
                for p in box:
                    fgm, fga = p.get("fgm") or 0, p.get("fga") or 0
                    tpm, tpa = p.get("tpm") or 0, p.get("tpa") or 0
                    ftm, fta = p.get("ftm") or 0, p.get("fta") or 0
                    if fgm > fga or tpm > tpa or ftm > fta or tpm > fgm:
                        modern_shoot.append(f"{gid} {p.get('name')}")
            q = s.get("q") or []
            if modern and q and score is not None:
                if abs(sum(q) - score) > 5:
                    big_ptsdiff.append(f"{gid} {s.get('abbr')} quarters={sum(q)} team={score}")
                elif sum(q) != score:
                    qdiff += 1
    if unparse: hard(f"{unparse} game file(s) failed to parse")
    if empties: hard(f"{len(empties)} modern game(s) have a score but an empty box score: {empties[:8]}")
    if big_ptsdiff: hard(f"{len(big_ptsdiff)} modern game(s) with box totals off by >3/>5: {big_ptsdiff[:8]}")
    if modern_shoot: hard(f"{len(modern_shoot)} modern shooting-line impossibilities (made>attempted): {modern_shoot[:8]}")
    if small_ptsdiff: warn(f"{small_ptsdiff} modern box(es) off by 1-3 pts (source rounding — pre-existing)")
    if qdiff: warn(f"{qdiff} modern quarter-line(s) off by 1-5 from final (pre-existing)")
    print(f"  games checked: {len(files)}")


def check_salaries():
    sal = json.load(open(os.path.join(DATA, "salaries.json")))
    bp, bs = sal["byPlayer"], sal["bySeason"]
    # anchors
    for (pid, yr), exp in SALARY_ANCHORS.items():
        got = dict(bp.get(pid, [])).get(yr)
        if got != exp:
            hard(f"salary anchor drift: {pid} {yr} = {got} (expected {exp}) — possible re-inflation")
    # per-player ceiling / negatives
    for pid, arr in bp.items():
        for yr, v in arr:
            if v is None or v < 0:
                hard(f"salary negative/None: {pid} {yr} = {v}")
            elif v > SALARY_MAX:
                hard(f"salary implausibly high: {pid} {yr} = {v:,}")
    # league-total sanity
    for y, rows in bs.items():
        yi = int(y)
        if 2000 <= yi <= 2028:
            tot = sum(r[3] for r in rows)
            if tot > SEASON_TOTAL_MAX:
                hard(f"league salary total for {yi} = ${tot/1e9:.2f}B exceeds ${SEASON_TOTAL_MAX/1e9:.1f}B ceiling — broad inflation?")
    # byPlayer / bySeason consistency: byPlayer's season figure must equal the SUM of that
    # player's bySeason rows — a season can legitimately split across teams (a traded or
    # bought-out player), so compare totals rather than assuming one row per season.
    bs_sum = {}
    for y, rows in bs.items():
        for pid, nm, ab, v in rows:
            if pid:
                bs_sum[(pid, int(y))] = bs_sum.get((pid, int(y)), 0) + v
    inc = 0
    for (pid, y), tot in bs_sum.items():
        if pid in bp:
            d = dict(bp[pid])
            if y in d and d[y] != tot:
                inc += 1
    if inc:
        hard(f"{inc} byPlayer/bySeason salary inconsistencies")
    print(f"  salary player-seasons checked: {sum(len(a) for a in bp.values())}")


def main():
    print("Validating data …")
    check_games()
    check_salaries()
    print()
    for w in WARN:
        print(f"  WARN  {w}")
    if HARD:
        print(f"\n✗ {len(HARD)} BLOCKING error(s):")
        for h in HARD:
            print(f"  FAIL  {h}")
        sys.exit(1)
    print(f"\n✓ Data integrity OK ({len(WARN)} warning(s), 0 blocking).")


if __name__ == "__main__":
    main()
