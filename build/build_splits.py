#!/usr/bin/env python3
"""
Precompute per-player game logs, splits and full playoff box scores from the
per-game box-score source (raw2/PlayerStatistics.csv — full history, 1946→today,
with a gameType flag). The season-level a public historical dataset CSVs the main pipeline uses have no
per-game data, so this is the only source for:

  - current-season game log (every game, full box)
  - career splits: home/away, wins/losses, and vs each current franchise
  - playoff box by season (G/MPG/PPG/RPG/APG/SPG/BPG/FG%/3P%/TS%) + career

Writes data/splits/<bbref_id>.json. Keyed by bbref id via the personId map in
search.json. Playoff *advanced* metrics (PER/WS/BPM/VORP) are NOT derivable from
box scores and are intentionally absent.

Run with the six-spins venv (has pandas):
    /Users/d/six-spins/.venv/bin/python build/build_splits.py
"""
import json, os
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SRC = "/Users/d/six-spins/data/raw2/PlayerStatistics.csv"
GAMES_SRC = "/Users/d/six-spins/data/raw2/Games.csv"
OUT = DATA / "splits"

META = json.load(open(DATA / "meta.json"))
CUR = META["current"]
NICK2ABBR = {t["name"]: ab for ab, t in META["teams"].items()}   # "Spurs" -> "SAS"

# personId (NBA) -> bbref id, from search.json rows [id, name, from, to, pos, team, nbaId]
SEARCH = json.load(open(DATA / "search.json"))
PID2BBREF = {row[6]: row[0] for row in SEARCH if len(row) > 6 and row[6]}


def season_of(dt):
    return dt.year + 1 if dt.month >= 9 else dt.year


def ts_pct(pts, fga, fta):
    denom = 2 * (fga + 0.44 * fta)
    return round(pts / denom, 3) if denom else None


def main():
    OUT.mkdir(exist_ok=True)
    cols = ["personId", "gameId", "gameDate", "gameType", "opponentteamName", "home", "win",
            "numMinutes", "points", "reboundsTotal", "assists", "steals", "blocks",
            "fieldGoalsMade", "fieldGoalsAttempted", "threePointersMade", "threePointersAttempted",
            "freeThrowsMade", "freeThrowsAttempted", "plusMinusPoints"]
    print("reading Games.csv …")
    gm = pd.read_csv(GAMES_SRC, usecols=["gameId", "homeScore", "awayScore"])
    SCORE = {int(r.gameId): (int(r.homeScore), int(r.awayScore))
             for r in gm.itertuples() if pd.notna(r.homeScore) and pd.notna(r.awayScore)}
    print("reading PlayerStatistics.csv …")
    df = pd.read_csv(SRC, usecols=cols, parse_dates=["gameDate"])
    df = df[df["gameType"].isin(["Regular Season", "Playoffs"])].copy()
    numcols = ["numMinutes", "points", "reboundsTotal", "assists", "steals", "blocks",
               "fieldGoalsMade", "fieldGoalsAttempted", "threePointersMade", "threePointersAttempted",
               "freeThrowsMade", "freeThrowsAttempted", "plusMinusPoints"]
    for c in numcols:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df[numcols[1:]] = df[numcols[1:]].fillna(0)   # counting stats -> 0 (minutes/plusminus may stay NaN)
    df["bbref"] = df["personId"].map(PID2BBREF)
    df = df[df["bbref"].notna()]
    df["season"] = df["gameDate"].apply(season_of)
    df["po"] = df["gameType"].eq("Playoffs")
    df["opp"] = df["opponentteamName"].map(NICK2ABBR)
    df["win"] = df["win"].astype(bool)
    df["home"] = df["home"].astype(bool)
    print(f"rows mapped to bbref players: {len(df):,} · players: {df.bbref.nunique():,}")

    def avg_block(g):
        n = len(g)
        if not n:
            return None
        return {"g": int(n), "ppg": round(g.points.mean(), 1), "rpg": round(g.reboundsTotal.mean(), 1),
                "apg": round(g.assists.mean(), 1), "w": int(g.win.sum()), "l": int(n - g.win.sum())}

    def po_season_block(g):
        n = len(g)
        fga, fta = g.fieldGoalsAttempted.sum(), g.freeThrowsAttempted.sum()
        return {"g": int(n), "mpg": round(g.numMinutes.mean(), 1), "ppg": round(g.points.mean(), 1),
                "rpg": round(g.reboundsTotal.mean(), 1), "apg": round(g.assists.mean(), 1),
                "spg": round(g.steals.mean(), 1), "bpg": round(g.blocks.mean(), 1),
                "fg": round(g.fieldGoalsMade.sum() / g.fieldGoalsAttempted.sum(), 3) if g.fieldGoalsAttempted.sum() else None,
                "tp": round(g.threePointersMade.sum() / g.threePointersAttempted.sum(), 3) if g.threePointersAttempted.sum() else None,
                "ts": ts_pct(g.points.sum(), fga, fta)}

    written = 0
    for bbref, pg in df.groupby("bbref"):
        reg = pg[~pg.po]
        po = pg[pg.po]
        out = {}

        # ---- career splits (regular season) ----
        splits = {}
        for key, sub in [("home", reg[reg.home]), ("away", reg[~reg.home]),
                         ("wins", reg[reg.win]), ("losses", reg[~reg.win])]:
            b = avg_block(sub)
            if b:
                splits[key] = b
        if splits:
            out["splits"] = splits

        # ---- vs each current franchise (regular season, career) ----
        vs = {}
        for opp, sub in reg[reg.opp.notna()].groupby("opp"):
            b = avg_block(sub)
            if b and b["g"] >= 2:
                vs[opp] = b
        if vs:
            out["vsOpp"] = vs

        # ---- playoff box by season + career ----
        if len(po):
            by_season = []
            for season, sub in po.groupby("season"):
                blk = po_season_block(sub)
                blk["season"] = int(season)
                by_season.append(blk)
            by_season.sort(key=lambda r: r["season"])
            career = po_season_block(po)
            out["po"] = {"bySeason": by_season, "career": career}

        # ---- current-season game log (regular season) ----
        cur = reg[reg.season == CUR].sort_values("gameDate")
        if len(cur):
            log = []
            for _, r in cur.iterrows():
                gid = int(r.gameId)
                sc = SCORE.get(gid)
                us = them = None
                if sc:
                    us, them = (sc[0], sc[1]) if r.home else (sc[1], sc[0])
                log.append({"id": str(gid), "date": r.gameDate.strftime("%Y-%m-%d"),
                            "opp": r.opp if pd.notna(r.opp) else "", "home": bool(r.home), "w": bool(r.win),
                            "us": us, "them": them,
                            "min": None if pd.isna(r.numMinutes) else round(float(r.numMinutes)),
                            "pts": int(r.points), "reb": int(r.reboundsTotal), "ast": int(r.assists),
                            "stl": int(r.steals), "blk": int(r.blocks),
                            "fgm": int(r.fieldGoalsMade), "fga": int(r.fieldGoalsAttempted),
                            "tpm": int(r.threePointersMade), "tpa": int(r.threePointersAttempted),
                            "pm": None if pd.isna(r.plusMinusPoints) else int(r.plusMinusPoints)})
            out["log"] = log

        if out:
            (OUT / f"{bbref}.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
            written += 1

    print(f"wrote data/splits/*.json for {written} players")


if __name__ == "__main__":
    main()
