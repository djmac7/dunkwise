#!/usr/bin/env python3
"""One-off reconciliation for the current offseason snapshot. Safe to re-run.

(1) Teams: set each player's cur.team from the current the live source roster they appear on
    (data/team/*.json rosters are refreshed by fetch_live.rosters(), which reflects
    offseason trades — but it never wrote the new team back to the player files, so
    a traded player's masthead still showed his last on-court team, e.g. AD on DAL).

(2) Injuries: rewrite data/injuries.json to keep only players genuinely sidelined by
    injury. In the offseason the live source's /injuries feed is mostly transaction/draft/rest
    news defaulted to "Day-To-Day"; those notes have nothing to do with an injury.
    We keep only entries whose note describes a real injury, normalise the status to
    "Out", and attach a short injury type.

The classification helpers here are mirrored in build/fetch_live.py so scheduled
refreshes stay clean.
"""
import json, os, re

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")


def reconcile_teams():
    meta = json.load(open(os.path.join(DATA, "meta.json")))
    cur_season = meta["current"]
    pid2team, ambiguous = {}, set()
    for ab in meta["teams"]:                     # current franchises only
        tf = os.path.join(DATA, "team", ab + ".json")
        if not os.path.exists(tf):
            continue
        for r in json.load(open(tf)).get("roster", []):
            pid = r[0]
            if pid in pid2team and pid2team[pid] != ab:
                ambiguous.add(pid)
            pid2team[pid] = ab
    changed = 0
    for pid, ab in pid2team.items():
        if pid in ambiguous:
            continue
        pf = os.path.join(DATA, "player", pid + ".json")
        if not os.path.exists(pf):
            continue
        pj = json.load(open(pf))
        cur = pj.get("cur") or {}
        if cur.get("season") == cur_season and cur.get("team") != ab:
            cur["team"] = ab
            pj["cur"] = cur
            json.dump(pj, open(pf, "w"), separators=(",", ":"), ensure_ascii=False)
            changed += 1
    print(f"teams: reconciled cur.team for {changed} players ({len(ambiguous)} ambiguous skipped)")


# ---- injury classification (kept in sync with build/fetch_live.py) ----
SIDELINED = ["miss the remainder", "season-ending", "season ending", "out for the season",
             "remainder of the 2025-26", "remainder of the season", "torn", "ruptured",
             "tearing", "lisfranc", "sesamoid", "venous condition", "will require surgery",
             "undergo surgery", "underwent surgery", "undergoing surgery", "set to undergo",
             "ruled out for the"]
BODY = ["acl", "achilles", "patellar tendon", "patellar", "ucl", "lisfranc", "hamstring",
        "knee", "ankle", "wrist", "forearm", "thumb", "finger", "foot", "calf", "hip",
        "back", "shoulder", "elbow", "quad", "neck", "oblique", "groin", "toe", "heel"]


def is_injury(note, status):
    n = (note or "").lower()
    if "not injury related" in n:
        return False
    if (status or "") == "Out":
        return True
    return any(s in n for s in SIDELINED)


def injury_type(note):
    m = re.match(r"^[^()]+\(([^)]+)\)", note or "")
    tag = (m.group(1).strip().lower() if m else "")
    if tag and tag.split()[0] in BODY:
        return tag.upper() if tag in ("acl", "ucl") else tag.title()
    n = (note or "").lower()
    for b in BODY:
        if re.search(r"\b" + re.escape(b) + r"\b", n):
            return b.upper() if b in ("acl", "ucl") else b.title()
    return "Injury"


def clean_injuries():
    d = json.load(open(os.path.join(DATA, "injuries.json")))
    new_bp = {}
    for pid, v in d.get("byPlayer", {}).items():
        if is_injury(v.get("note"), v.get("status")):
            new_bp[pid] = {"status": "Out", "injury": injury_type(v.get("note")),
                           "note": v.get("note"), "date": v.get("date"), "team": v.get("team")}
    new_bt = {}
    for ab, lst in d.get("byTeam", {}).items():
        for v in lst:
            if v.get("pid") in new_bp:
                b = new_bp[v["pid"]]
                new_bt.setdefault(ab, []).append({"status": "Out", "injury": b["injury"],
                    "note": v.get("note"), "date": v.get("date"), "pid": v.get("pid"), "name": v.get("name")})
    out = {"count": len(new_bp), "byPlayer": new_bp, "byTeam": new_bt}
    json.dump(out, open(os.path.join(DATA, "injuries.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    print(f"injuries: kept {len(new_bp)} genuine injuries across {len(new_bt)} teams")


if __name__ == "__main__":
    reconcile_teams()
    clean_injuries()
