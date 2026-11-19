#!/usr/bin/env python3
"""Validate one music content file (or several). Usage:
     python3 scripts/validate_music.py content/music/FILE.json [...] [--offline]
Checks the schema in content/music/WRITING-BRIEF.md: ids, types, enums (readers, territory,
confidence), writing limits, as_of on anything that moves, every cited source defined and
every defined source cited, source fields by type, and that each source URL answers.
A URL that is blocked (401, 403, 429) is a warning: the owner checks it by hand.
Exit 1 on any error."""
import json, re, sys, urllib.request, urllib.error
from datetime import date
from pathlib import Path

DOMAINS = {"royalty-basics", "pros-performance", "mechanicals-mlc", "recorded-neighboring",
           "deal-structures", "metadata-registration", "international-societies", "sync-licensing",
           "unclaimed-recovery", "audits", "copyright-fundamentals", "ai-rights",
           "producer-royalties", "distribution-dsps", "catalog-finance"}
PREFIX = {"royalty-basics": "roy-", "pros-performance": "pro-", "mechanicals-mlc": "mech-",
          "recorded-neighboring": "nbr-", "deal-structures": "deal-", "metadata-registration": "meta-",
          "international-societies": "intl-", "sync-licensing": "sync-", "unclaimed-recovery": "unc-",
          "audits": "aud-", "copyright-fundamentals": "copy-", "ai-rights": "ai-",
          "producer-royalties": "prod-", "distribution-dsps": "dist-", "catalog-finance": "cat-",
          "claims": "claim-"}
TYPES = {"note", "mistake", "number", "term", "table", "checklist", "step", "claim"}
LEVELS = {"beginner", "intermediate", "advanced"}
READERS = {"writer", "artist", "producer", "publisher-label", "admin"}
TERRITORY = {"US", "UK", "CA", "AU", "DE", "FR", "INTL"}
CONF = {"law", "official", "reported", "practice"}
VERDICTS = {"true", "mostly", "depends", "overstated", "false"}
CLAIM_TAGS = {"royalties", "mechanicals", "performance", "neighboring", "publishing", "metadata",
              "unclaimed", "ai", "contracts", "international", "myths"}
WHEN = {"before-release", "at-release", "after-release", "yearly", "on-dispute"}
SRC_TYPES = {"statute", "regulation", "ruling", "government", "collective", "standard", "article", "dataset", "other"}
# The grade an entry may claim given its strongest source type.
GRADE_FROM = {"statute": "law", "regulation": "law", "ruling": "law",
              "government": "official", "collective": "official", "standard": "official",
              "dataset": "official", "article": "reported", "other": "reported"}
RANK = {"practice": 0, "reported": 1, "official": 2, "law": 3}
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Words that mean an entry states something that moves, so it needs as_of.
MOVES = re.compile(r"(\$\s?\d|\b\d+(\.\d+)?\s?(%|percent|cents?|million|billion)\b|\bpending\b|\bproposed\b|"
                   r"\bas of\b|\bcurrently\b|\bdeadline\b|\b20(2[4-9]|3\d)\b)", re.I)
STANDING = [  # corrections from the master plan that must never come back
    (re.compile(r"(deadline|window)[^.]{0,60}april 2027|april 2027[^.]{0,60}(deadline|window closes|last chance)", re.I),
     "April 2027 is the start of MLC market-share distribution, not a claim deadline"),
    (re.compile(r"(50\s?%|half)[^.]{0,80}(on the table|publisher share)", re.I),
     "the '~50% on the table' producer claim is dropped"),
    (re.compile(r"ISO\s?15707:2001"), "the ISWC standard is ISO 15707:2022"),
    (re.compile(r"419\.2"), "the $419.2M figure needs its own primary source; see the brief"),
]

errors, warns = [], []
def err(m): errors.append(m)
def warn(m): warns.append(m)

def url_status(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; site-source-checker/1.0)"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception as e:
        return str(e)[:60]

def text_len(label, s, lo, hi, where):
    if not isinstance(s, str) or not s.strip():
        err(f"{where}: {label} is missing"); return
    n = len(s.strip())
    if n < lo or n > hi:
        err(f"{where}: {label} is {n} chars (allowed {lo}-{hi})")
    if "  " in s or s != s.strip():
        warn(f"{where}: {label} has stray whitespace")

def check_date(label, v, where, required):
    if v is None:
        if required: err(f"{where}: {label} is required (YYYY-MM-DD)")
        return
    if not isinstance(v, str) or not DATE_RE.match(v):
        err(f"{where}: {label} must be YYYY-MM-DD"); return
    try:
        d = date.fromisoformat(v)
    except ValueError:
        err(f"{where}: {label} {v} is not a real date"); return
    if d > date.today():
        err(f"{where}: {label} {v} is in the future")

def entry_text(e):
    parts = [e.get(k) or "" for k in ("title", "take", "body", "basis", "value", "unit")]
    parts += e.get("do") or []
    for r in e.get("rows") or []:
        parts += [str(c) for c in r]
    for g in e.get("groups") or []:
        parts += g.get("items") or []
    return " ".join(p for p in parts if isinstance(p, str))

def check_file(path, offline):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception as e:
        err(f"{path}: not valid JSON ({e})"); return None
    dom = data.get("domain")
    if dom not in DOMAINS | {"claims"}:
        err(f"{path}: domain must be one of {sorted(DOMAINS | {'claims'})}")
    topics = {t.get("id") for t in data.get("topics", [])}
    if dom != "claims" and not (5 <= len(topics) <= 10):
        err(f"{path}: give 5-10 topics, each {{id,label}} (found {len(topics)})")
    for t in data.get("topics", []):
        if not ID_RE.match(t.get("id", "")) or not t.get("label"):
            err(f"{path}: bad topic {t}")
    sources = data.get("sources", {})
    used, ids = set(), set()
    for i, e in enumerate(data.get("entries", [])):
        w = f"{path} entry {i} ({e.get('id')})"
        eid = e.get("id", "")
        if not ID_RE.match(eid): err(f"{w}: id must be lowercase-hyphenated")
        if eid in ids: err(f"{w}: duplicate id")
        ids.add(eid)
        if dom in PREFIX and not eid.startswith(PREFIX[dom]): err(f"{w}: id must start with {PREFIX[dom]}")
        t = e.get("type")
        if t not in TYPES: err(f"{w}: type must be one of {sorted(TYPES)}"); continue
        if dom == "claims" and t != "claim": err(f"{w}: the claims file holds only claims")
        if dom != "claims" and t == "claim": err(f"{w}: claims go in the claims file")
        text_len("title", e.get("title"), 6, 90, w)
        if t == "claim":
            if e.get("domain") not in DOMAINS: err(f"{w}: claim needs domain, one of {sorted(DOMAINS)}")
            if e.get("verdict") not in VERDICTS: err(f"{w}: verdict must be one of {sorted(VERDICTS)}")
            tags = e.get("tags", [])
            if not tags or len(tags) > 3 or any(x not in CLAIM_TAGS for x in tags): err(f"{w}: tags: 1-3 of {sorted(CLAIM_TAGS)}")
            if not e.get("title", "").strip().endswith("?"): err(f"{w}: a claim's title is the question people ask and ends with ?")
            text_len("basis", e.get("basis"), 15, 220, w)
        elif e.get("topic") not in topics:
            err(f"{w}: topic {e.get('topic')!r} is not in this file's topics")
        if e.get("level") not in LEVELS: err(f"{w}: level must be one of {sorted(LEVELS)}")
        readers = e.get("readers")
        if not isinstance(readers, list) or not (1 <= len(readers) <= 5) or any(r not in READERS for r in readers) or len(set(readers)) != len(readers):
            err(f"{w}: readers: 1-5 distinct of {sorted(READERS)}")
        terr = e.get("territory")
        if not isinstance(terr, list) or not terr or any(x not in TERRITORY for x in terr) or len(set(terr)) != len(terr):
            err(f"{w}: territory: 1 or more distinct of {sorted(TERRITORY)}")
        conf = e.get("confidence")
        if conf not in CONF: err(f"{w}: confidence must be one of {sorted(CONF)}")
        if t in ("note", "mistake", "claim", "step"):
            text_len("take", e.get("take"), 30, 190, w)
            text_len("body", e.get("body"), 120, 620, w)
            do = e.get("do", [])
            if not isinstance(do, list) or len(do) > 3 or any(not isinstance(x, str) or not (8 <= len(x) <= 140) for x in do):
                err(f"{w}: do is 0-3 short actions of 8-140 chars")
        if t == "step" and e.get("when") not in WHEN: err(f"{w}: when must be one of {sorted(WHEN)}")
        if t == "number":
            text_len("value", e.get("value"), 1, 28, w)
            text_len("take", e.get("take"), 20, 170, w)
            if not isinstance(e.get("sort"), (int, float)): err(f"{w}: number needs numeric 'sort'")
            if "unit" in e and len(e["unit"]) > 60: err(f"{w}: unit too long (60 chars at most)")
        if t == "term":
            text_len("take", e.get("take"), 25, 240, w)
        if t == "table":
            cols, rows = e.get("columns"), e.get("rows")
            text_len("take", e.get("take"), 20, 190, w)
            if not isinstance(cols, list) or not (2 <= len(cols) <= 6): err(f"{w}: table needs 2-6 columns")
            elif not isinstance(rows, list) or not (2 <= len(rows) <= 16) or any(not isinstance(r, list) or len(r) != len(cols) for r in rows):
                err(f"{w}: table needs 2-16 rows, each with {len(cols)} cells")
            elif any(len(str(c)) > 110 for r in rows for c in r): err(f"{w}: a table cell is over 110 chars")
        if t == "checklist":
            text_len("take", e.get("take"), 20, 190, w)
            groups = e.get("groups")
            if not isinstance(groups, list) or not groups or any(not g.get("name") or not (1 <= len(g.get("items", [])) <= 14) for g in groups):
                err(f"{w}: checklist needs groups of {{name, items[1-14]}}")
        srcs = e.get("sources", [])
        if not isinstance(srcs, list): err(f"{w}: sources must be a list"); srcs = []
        for s in srcs:
            if s not in sources: err(f"{w}: source key {s!r} is not defined")
            used.add(s)
        if conf in ("law", "official", "reported") and not srcs:
            err(f"{w}: confidence {conf} needs at least one source")
        if conf in ("law", "official") and srcs:
            best = max((RANK[GRADE_FROM.get(sources.get(s, {}).get("type"), "reported")] for s in srcs), default=0)
            if best < RANK[conf]:
                err(f"{w}: confidence {conf} needs a source of that kind (law: statute, regulation or ruling; official: the responsible body's own document)")
        text = entry_text(e)
        needs_date = t == "number" or bool(MOVES.search(text))
        check_date("as_of", e.get("as_of"), w, needs_date)
        for rx, why in STANDING:
            if rx.search(text): err(f"{w}: standing correction: {why}")
        for field in ("title", "take", "body", "basis"):
            v = e.get(field) or ""
            if "—" in v: err(f"{w}: {field} uses an em dash; use a full stop, comma or colon")
            if re.search(r"\b(game[- ]changer|unlock|supercharge|secret|hack|skyrocket)\b", v, re.I): warn(f"{w}: {field} sounds like marketing")
            if re.search(r"\byou should (sign|terminate|sue|file suit)\b", v, re.I): err(f"{w}: {field} reads as legal advice")
    for key in sources:
        if key not in used: err(f"{path}: source {key!r} is never cited")
    for key, s in sources.items():
        w = f"{path} source {key}"
        if not ID_RE.match(key): err(f"{w}: key must be lowercase-hyphenated, e.g. fr-2025-21695")
        st = s.get("type")
        if st not in SRC_TYPES: err(f"{w}: type must be one of {sorted(SRC_TYPES)}")
        for f in ("title", "url", "retrieved"):
            if not s.get(f): err(f"{w}: missing {f}")
        if st == "article":
            if not s.get("site"): err(f"{w}: an article needs site (the publication's name)")
            if not s.get("authors"): warn(f"{w}: an article usually names its authors; give them if published")
            if len(s.get("support", "")) > 240: err(f"{w}: support for an article is a pointer in your own words, 240 characters at most")
        elif not s.get("publisher"):
            err(f"{w}: needs publisher (the body that issued it)")
        if st == "ruling":
            for f in ("court", "docket", "date"):
                if not s.get(f): err(f"{w}: a ruling needs {f}")
        if st in ("collective", "standard", "dataset", "other") and len(s.get("support", "")) > 240:
            err(f"{w}: support is a pointer in your own words, 240 characters at most")
        check_date("retrieved", s.get("retrieved"), w, True)
        if s.get("date"): check_date("date", s.get("date"), w, False)
        url = s.get("url")
        if url and not url.startswith("https://"): warn(f"{w}: url is not https")
        if url and not offline:
            code = url_status(url)
            if code in (401, 403, 429): warn(f"{w}: URL blocked automated reading ({code}); owner checks by hand: {url}")
            elif code != 200: err(f"{w}: URL answered {code}: {url}")
    return data

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    offline = "--offline" in sys.argv
    if not args:
        print(__doc__); return 2
    total = 0
    from collections import Counter
    for p in args:
        d = check_file(p, offline)
        if d:
            c = Counter(e.get("type") for e in d.get("entries", []))
            g = Counter(e.get("confidence") for e in d.get("entries", []))
            total += sum(c.values())
            print(f"{p}: {sum(c.values())} entries {dict(c)}; grades {dict(g)}; {len(d.get('sources', {}))} sources")
    for m in warns: print("warn:", m)
    for m in errors: print("ERROR:", m)
    print(f"{len(errors)} error(s), {len(warns)} warning(s), {total} entries")
    return 1 if errors else 0

if __name__ == "__main__":
    sys.exit(main())
