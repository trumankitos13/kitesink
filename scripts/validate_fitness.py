#!/usr/bin/env python3
"""Validate one fitness content file (or several). Usage:
     python3 -I validate_fitness.py FILE.json [FILE.json ...] [--offline]
Checks the schema, the writing limits, that every source resolves on Crossref
(or its URL answers), that the metadata matches, and that nobody named
Schoenfeld is an author of any source or mentioned anywhere. Exit 1 on any error."""
import hashlib, json, re, sys, time, urllib.request, urllib.parse, difflib, unicodedata
from pathlib import Path

CACHE = Path(__file__).resolve().parents[1] / "cache" / "crossref"
CACHE.mkdir(parents=True, exist_ok=True)
DOMAINS = {"hypertrophy", "powerlifting", "meet", "nutrition", "diet", "health"}
TYPES = {"note", "mistake", "number", "term", "table", "checklist", "step", "claim"}
LEVELS = {"beginner", "intermediate", "advanced"}
CONF = {"strong", "moderate", "limited", "rule", "practice"}
VERDICTS = {"true", "mostly", "depends", "overstated", "false"}
EVIDENCE = {"meta-analysis", "rct", "review", "cohort", "position", "guideline", "rulebook", "mixed"}
SRC_TYPES = {"meta-analysis", "systematic-review", "rct", "review", "cohort", "position", "guideline", "rulebook", "book", "trial", "other"}
CLAIM_TAGS = {"protein", "calories", "timing", "training", "cardio", "supplements", "weight-loss", "muscle-gain", "recovery", "health", "myths", "strength", "competition", "tracking"}
WHEN = {"months-out", "weeks-out", "week-before", "day-before", "weigh-in", "warm-up", "platform", "between-lifts", "after"}
BANNED = re.compile(r"schoenfeld", re.I)
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
PREFIX = {"hypertrophy": "hyp-", "powerlifting": "pl-", "meet": "meet-", "nutrition": "nut-", "diet": "diet-", "health": "hlth-", "claims": "claim-"}

errors, warns = [], []
def err(m): errors.append(m)
def warn(m): warns.append(m)

def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]+", " ", s).strip()

def crossref(doi):
    f = CACHE / (hashlib.sha1(doi.lower().encode()).hexdigest() + ".json")
    if f.exists():
        return json.loads(f.read_text())
    url = "https://api.crossref.org/works/" + urllib.parse.quote(doi, safe="/")
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "site-source-checker/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read())["message"]
            f.write_text(json.dumps(d))
            return d
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 + attempt * 3)
        except Exception:
            time.sleep(2 + attempt * 3)
    return "unreachable"

def url_ok(url):
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

def check_file(path, offline):
    raw = Path(path).read_text(encoding="utf-8")
    if BANNED.search(raw):
        err(f"{path}: the name Schoenfeld appears in the file; no source or text may use it")
    try:
        data = json.loads(raw)
    except Exception as e:
        err(f"{path}: not valid JSON ({e})"); return
    dom = data.get("domain")
    if dom not in DOMAINS | {"claims"}:
        err(f"{path}: domain must be one of {sorted(DOMAINS | {'claims'})}")
    topics = {t.get("id") for t in data.get("topics", [])}
    if dom != "claims" and not (3 <= len(topics) <= 10):
        err(f"{path}: give 3-10 topics, each {{id,label}} (found {len(topics)})")
    for t in data.get("topics", []):
        if not ID_RE.match(t.get("id", "")) or not t.get("label"):
            err(f"{path}: bad topic {t}")
    sources = data.get("sources", {})
    used = set()
    ids = set()
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
            if e.get("domain") not in DOMAINS: err(f"{w}: claim needs domain (one of the six)")
            if e.get("verdict") not in VERDICTS: err(f"{w}: verdict must be one of {sorted(VERDICTS)}")
            if e.get("evidence") not in EVIDENCE: err(f"{w}: evidence must be one of {sorted(EVIDENCE)}")
            tags = e.get("tags", [])
            if not tags or any(x not in CLAIM_TAGS for x in tags) or len(tags) > 3: err(f"{w}: tags: 1-3 of {sorted(CLAIM_TAGS)}")
            if not e.get("title", "").strip().endswith("?"): err(f"{w}: a claim's title is the question people ask and ends with ?")
            text_len("studied", e.get("studied"), 15, 220, w)
        else:
            if e.get("topic") not in topics: err(f"{w}: topic {e.get('topic')!r} is not in this file's topics")
        if e.get("level") not in LEVELS: err(f"{w}: level must be one of {sorted(LEVELS)}")
        if e.get("confidence") not in CONF: err(f"{w}: confidence must be one of {sorted(CONF)}")
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
            if not isinstance(e.get("sort"), (int, float)): err(f"{w}: number needs numeric 'sort' (the value as a plain number, for sorting)")
            if "unit" in e and len(e["unit"]) > 28: err(f"{w}: unit too long")
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
        conf = e.get("confidence")
        if conf in ("strong", "moderate", "limited") and not srcs and t != "term": err(f"{w}: confidence {conf} needs at least one source")
        if conf == "rule" and not srcs: err(f"{w}: a rule cites the rulebook or guideline it comes from")
        if conf == "strong" and t in ("note", "claim", "number", "mistake", "step") and srcs:
            kinds = {sources.get(s, {}).get("type") for s in srcs}
            if not kinds & {"meta-analysis", "systematic-review", "position", "guideline"} and len(srcs) < 2:
                err(f"{w}: 'strong' needs a meta-analysis, systematic review, position stand or guideline, or two independent sources")
        for field in ("title", "take", "body", "studied"):
            v = e.get(field) or ""
            if "—" in v: warn(f"{w}: {field} uses an em dash; prefer a full stop, comma or colon")
            if re.search(r"\b(game[- ]changer|unlock|supercharge|secret|hack|crush it|shred)\b", v, re.I): warn(f"{w}: {field} sounds like marketing")
    for key in sources:
        if key not in used: err(f"{path}: source {key!r} is never cited")
    for key, s in sources.items():
        w = f"{path} source {key}"
        if not ID_RE.match(key): err(f"{w}: key must be lowercase-hyphenated, e.g. morton-2018")
        if s.get("type") not in SRC_TYPES: err(f"{w}: type must be one of {sorted(SRC_TYPES)}")
        for f in ("authors", "year", "title"):
            if not s.get(f): err(f"{w}: missing {f}")
        authors = s.get("authors") or []
        if not isinstance(authors, list) or not all(isinstance(a, str) for a in authors):
            err(f"{w}: authors is the FULL author list as strings like 'Morton RW' (or the organisation)"); authors = []
        if any(BANNED.search(a) for a in authors): err(f"{w}: Schoenfeld is an author; this source cannot be used")
        doi, url = s.get("doi"), s.get("url")
        if not doi and not url: err(f"{w}: needs a doi, or a url for rulebooks/guidelines/organisation pages")
        if doi and not offline:
            m = crossref(doi)
            if m is None: err(f"{w}: DOI {doi} does not exist on Crossref")
            elif m == "unreachable": warn(f"{w}: Crossref unreachable for {doi}; re-run")
            else:
                fam = [a.get("family", a.get("name", "")) for a in m.get("author", [])]
                if any(BANNED.search(x or "") for x in fam): err(f"{w}: Crossref lists Schoenfeld among the authors of {doi}; this source cannot be used")
                title = (m.get("title") or [""])[0]
                ratio = difflib.SequenceMatcher(None, norm(title), norm(s.get("title", ""))).ratio()
                if ratio < 0.72: err(f"{w}: title does not match Crossref ({ratio:.2f}). Crossref: {title[:110]!r}")
                years = {p[0] for k in ("issued", "published-print", "published-online", "published") for p in (m.get(k, {}).get("date-parts") or []) if p and p[0]}
                if years and s.get("year") not in years: err(f"{w}: year {s.get('year')} not among Crossref years {sorted(years)}")
                if fam and authors:
                    if norm(fam[0]).split()[-1:] != norm(authors[0]).split()[:1] and norm(fam[0]) not in norm(authors[0]):
                        err(f"{w}: first author {authors[0]!r} does not match Crossref {fam[0]!r}")
                    if len(fam) != len(authors): err(f"{w}: lists {len(authors)} authors but Crossref has {len(fam)}; give the full list")
                jr = (m.get("container-title") or [""])[0]
                if jr and s.get("journal") and difflib.SequenceMatcher(None, norm(jr), norm(s["journal"])).ratio() < 0.5 and norm(s["journal"]) not in norm(jr) and norm(jr) not in norm(s["journal"]):
                    short = (m.get("short-container-title") or [""])[0]
                    if not short or difflib.SequenceMatcher(None, norm(short), norm(s["journal"])).ratio() < 0.5:
                        warn(f"{w}: journal {s['journal']!r} vs Crossref {jr!r}")
        if url and not doi and not offline:
            st = url_ok(url)
            if st != 200: warn(f"{w}: URL answered {st}: {url}")
    return data

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    offline = "--offline" in sys.argv
    if not args:
        print(__doc__); return 2
    total = 0
    for p in args:
        d = check_file(p, offline)
        if d:
            from collections import Counter
            c = Counter(e.get("type") for e in d.get("entries", []))
            total += sum(c.values())
            print(f"{p}: {sum(c.values())} entries {dict(c)}; {len(d.get('sources', {}))} sources")
    for m in warns: print("warn:", m)
    for m in errors: print("ERROR:", m)
    print(f"{len(errors)} error(s), {len(warns)} warning(s), {total} entries")
    return 1 if errors else 0

if __name__ == "__main__":
    sys.exit(main())
