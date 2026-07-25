"""Canonical college names.

the reference source gives the college field as a single free-text string that
packs a player's whole school history into one comma-separated run:

    "Blinn College, Brown Mackie College, Houston"

which is unparseable as-is and inconsistently styled ("Jackson State University"
next to "Alcorn State"). normalize() turns that into a clean list plus a single
primary school.

Two things make this less trivial than a str.split(","):

1. Some school names contain a comma ("University of California, Irvine").
   Those are protected before the split and restored after — see _PROTECTED.
2. The trailing "University"/"College" is usually noise, but for a handful of
   names it *is* the school: Boston College and Boston University are different
   institutions. _KEEP_SUFFIX lists every such collision found in the data.

Primary school = the LAST one listed, which is the one the player left for the
NBA and the one draft coverage credits them to.
"""

import re

# School names that legitimately contain a comma. Matched case-sensitively
# against the raw string before splitting, then restored verbatim.
_PROTECTED = [
    "University of California, Irvine",
    "University of California, Riverside",
    "California State University, Los Angeles",
    "State College of Florida, Manatee-Sarasota",
    "Montana State University, Billings",
    "Iowa Western Community College, Clarinda Campus",
    "Southeastern Iowa Community College, West Burlington Campus",
]

# Names where a trailing "University"/"College" distinguishes two genuinely
# different schools, so the suffix must survive normalization. Each of these is
# a junior/senior college pair that happens to share a city name.
#
# Deliberately NOT here: "Assumption College"/"Assumption University" (one
# school, renamed in 2020) and "Montana State University"/"Montana State" (one
# school — the apparent conflict was "Montana State University, Billings", a
# separate campus, which is protected above instead).
_KEEP_SUFFIX = {
    "Boston College", "Boston University",
    "Howard College", "Howard University",
    "Jacksonville College", "Jacksonville University",
    "Murray State College",
}

_SUFFIX_RE = re.compile(r"\s+(?:University|College)$")

# Stripping the suffix is wrong when what's left ends in a generic institutional
# qualifier that can't stand alone as a name: "Moberly Area Community College"
# must not become "Moberly Area Community". Note this deliberately excludes
# words that ARE the school's identity — Wesleyan, Baptist, Valley — so
# "Utah Valley University" still shortens to "Utah Valley".
_DANGLING_RE = re.compile(r"\b(?:Community|Junior|Technical|Area)$")
# "City College" is always a two-year school ("Long Beach City College"), while
# "City University" is not ("Oklahoma City University" -> "Oklahoma City").
_CITY_COLLEGE_RE = re.compile(r"\bCity College$")
_SENTINEL = "\x00%d\x00"


def _canon(name):
    """Canonical form of a single school name."""
    n = " ".join(name.split()).strip(" ,")
    if not n:
        return None
    if n in _KEEP_SUFFIX or _CITY_COLLEGE_RE.search(n):
        return n
    stripped = _SUFFIX_RE.sub("", n).strip()
    if _DANGLING_RE.search(stripped):
        return n
    # Never strip down to nothing, and never strip when what remains would
    # collide with a school whose suffix we deliberately keep.
    if not stripped:
        return n
    if any(k.startswith(stripped + " ") for k in _KEEP_SUFFIX):
        return n
    return stripped


def normalize(raw):
    """(primary, schools) for a raw the reference source college string.

    Returns (None, []) for empty input. `schools` preserves the source order
    (earliest school first); `primary` is the last entry.
    """
    if not raw or not str(raw).strip():
        return None, []
    s = str(raw)

    for i, p in enumerate(_PROTECTED):
        s = s.replace(p, _SENTINEL % i)

    out = []
    for part in s.split(","):
        for i, p in enumerate(_PROTECTED):
            part = part.replace(_SENTINEL % i, p)
        c = _canon(part)
        if c and c not in out:
            out.append(c)

    return (out[-1] if out else None), out
