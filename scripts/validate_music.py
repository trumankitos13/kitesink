#!/usr/bin/env python3
"""Validate one music content file (or several). Usage:
     python3 scripts/validate_music.py content/music/FILE.json [...] [--offline]
Checks the schema in content/music/WRITING-BRIEF.md: ids, types, enums (readers, territory,
confidence), writing limits, as_of on anything that moves, every cited source defined and
every defined source cited, source fields by type, and that each source URL answers.
A URL that is blocked (401, 403, 429) is a warning: the owner checks it by hand.
The three data files (claimable.json, tools.json, rates.json) are recognised by their "kind"
key and checked against content/music/DATA-PAGES.md instead.
Exit 1 on any error."""
import json, re, sys, urllib.request, urllib.error
from collections import Counter
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

def check_sources(path, sources, used, offline):
    """Every defined source cited, and each source's fields and URL (the same rules for every file)."""
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

# ----------------------------------------------------------------- the three data files (DATA-PAGES.md)
MONEY_TYPES = {"mechanical", "performance", "neighboring", "other"}
TOOL_GROUPS = ["works-search", "recordings", "unclaimed", "metadata", "splits-contracts", "sync-cue", "valuation"]
ACCESS = {"free-no-login", "free-login", "members", "licensees", "paid", "unknown"}
TOOL_STATUS = {"verified", "check"}

def check_text(w, label, v):
    """The voice and standing-correction rules, for any published string."""
    if not isinstance(v, str):
        return
    if "—" in v: err(f"{w}: {label} uses an em dash; use a full stop, comma or colon")
    for rx, why in STANDING:
        if rx.search(v): err(f"{w}: {label}: standing correction: {why}")
    if re.search(r"\b(game[- ]changer|unlock|supercharge|secret|hack|skyrocket)\b", v, re.I): warn(f"{w}: {label} sounds like marketing")
    if re.search(r"\byou should (sign|terminate|sue|file suit)\b", v, re.I): err(f"{w}: {label} reads as legal advice")

def check_list(w, label, v, allowed, lo=1, hi=None):
    if not isinstance(v, list) or len(v) < lo or (hi and len(v) > hi) or any(x not in allowed for x in v) or len(set(v)) != len(v):
        err(f"{w}: {label}: {lo}-{hi or 'any'} distinct of {sorted(allowed)}")

def check_link(w, label, url, offline, required=True, hard=True):
    """A link a page shows (not a source): https, and it answers. hard=False turns a bad answer into a warning."""
    if not url:
        if required: err(f"{w}: {label} is missing")
        return
    if not isinstance(url, str) or not url.startswith("https://"):
        err(f"{w}: {label} must be an https:// address"); return
    if offline:
        return
    code = url_status(url)
    if code in (401, 403, 429): warn(f"{w}: {label} blocked automated reading ({code}); owner checks by hand: {url}")
    elif code != 200: (err if hard else warn)(f"{w}: {label} answered {code}: {url}")

def cite(w, srcs, sources, used, conf=None):
    if not isinstance(srcs, list) or not srcs:
        err(f"{w}: needs at least one source"); return
    for k in srcs:
        if k not in sources: err(f"{w}: source key {k!r} is not defined")
        used.add(k)
    if conf in ("law", "official"):
        best = max((RANK[GRADE_FROM.get(sources.get(k, {}).get("type"), "reported")] for k in srcs), default=0)
        if best < RANK[conf]:
            err(f"{w}: confidence {conf} needs a source of that kind (law: statute, regulation or ruling; official: the responsible body's own document)")

def check_claimable(path, data, offline):
    sources = data.get("sources")
    if not isinstance(sources, dict): err(f"{path}: needs a sources object"); sources = {}
    rows = data.get("rows")
    if not isinstance(rows, list) or not rows: err(f"{path}: needs rows, a non-empty list"); rows = []
    used, ids = set(), set()
    for i, r in enumerate(rows):
        w = f"{path} row {i} ({r.get('id')})"
        rid = r.get("id", "")
        if not ID_RE.match(rid) or not rid.startswith("clm-"): err(f"{w}: id must be lowercase-hyphenated and start with clm-")
        if rid in ids: err(f"{w}: duplicate id")
        ids.add(rid)
        text_len("holder", r.get("holder"), 2, 80, w)
        text_len("pot", r.get("pot"), 20, 200, w)
        text_len("who_can_claim", r.get("who_can_claim"), 20, 200, w)
        text_len("how_to_claim", r.get("how_to_claim"), 20, 240, w)
        text_len("rule", r.get("rule"), 20, 200, w)
        text_len("cost", r.get("cost"), 2, 60, w)
        text_len("link_label", r.get("link_label"), 2, 40, w)
        if r.get("money_type") not in MONEY_TYPES: err(f"{w}: money_type must be one of {sorted(MONEY_TYPES)}")
        check_list(w, "territory", r.get("territory"), TERRITORY)
        check_list(w, "readers", r.get("readers"), READERS, 1, 5)
        if r.get("confidence") not in ("law", "official"):
            err(f"{w}: confidence must be law or official; a row the holder's own page or the law does not back goes to HOLDS.md")
        cite(w, r.get("sources"), sources, used, r.get("confidence"))
        check_date("as_of", r.get("as_of"), w, True)
        check_link(w, "link", r.get("link"), offline)
        for f in ("holder", "pot", "who_can_claim", "how_to_claim", "rule", "cost", "link_label"):
            check_text(w, f, r.get(f))
    check_sources(path, sources, used, offline)
    return len(rows), Counter(r.get("money_type") for r in rows)

def check_tools(path, data, offline):
    groups = data.get("groups")
    if not isinstance(groups, list) or not groups: err(f"{path}: needs groups, a non-empty list"); groups = []
    gids = [g.get("id") for g in groups]
    for g in groups:
        if g.get("id") not in TOOL_GROUPS: err(f"{path}: group {g.get('id')!r} is not one of the fixed groups {TOOL_GROUPS}")
        if not g.get("label"): err(f"{path}: group {g.get('id')!r} has no label")
    if len(set(gids)) != len(gids): err(f"{path}: a group is listed twice")
    tools = data.get("tools")
    if not isinstance(tools, list) or not tools: err(f"{path}: needs tools, a non-empty list"); tools = []
    ids = set()
    for i, t in enumerate(tools):
        w = f"{path} tool {i} ({t.get('id')})"
        tid = t.get("id", "")
        if not ID_RE.match(tid) or not tid.startswith("tool-"): err(f"{w}: id must be lowercase-hyphenated and start with tool-")
        if tid in ids: err(f"{w}: duplicate id")
        ids.add(tid)
        text_len("name", t.get("name"), 2, 80, w)
        text_len("owner", t.get("owner"), 2, 80, w)
        text_len("what", t.get("what"), 30, 160, w)
        if t.get("note") is not None: text_len("note", t.get("note"), 1, 140, w)
        if t.get("group") not in gids: err(f"{w}: group {t.get('group')!r} is not one of this file's groups")
        check_list(w, "readers", t.get("readers"), READERS, 1, 5)
        check_list(w, "territory", t.get("territory"), TERRITORY)
        if t.get("access") not in ACCESS: err(f"{w}: access must be one of {sorted(ACCESS)}")
        status = t.get("status")
        if status not in TOOL_STATUS: err(f"{w}: status must be verified or check")
        check_date("checked", t.get("checked"), w, status == "verified")
        # a verified tool was opened by the writer and the reviewer: a dead link is an error; a 'check' row only warns
        check_link(w, "url", t.get("url"), offline, hard=status == "verified")
        for f in ("name", "owner", "what", "note"):
            check_text(w, f, t.get(f))
    return len(tools), Counter(t.get("status") for t in tools)

def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)

def check_rates(path, data, offline):
    sources = data.get("sources")
    if not isinstance(sources, dict): err(f"{path}: needs a sources object"); sources = {}
    used = set()
    check_date("as_of", data.get("as_of"), path, True)
    phys = data.get("physical")
    if not isinstance(phys, list) or not phys:
        err(f"{path}: physical needs at least one year: the calculator cannot run without one"); phys = []
    def years(rows, label):
        seen = set()
        for i, r in enumerate(rows):
            w = f"{path} {label} {i} ({r.get('year')})"
            y = r.get("year")
            if not isinstance(y, int) or isinstance(y, bool) or not (2000 <= y <= 2100): err(f"{w}: year must be a whole year like 2026")
            elif y in seen: err(f"{w}: the year {y} is listed twice")
            else:
                seen.add(y)
                if not (2023 <= y <= 2027): warn(f"{w}: {y} is outside Phonorecords IV (2023-2027); check the source")
            cite(w, r.get("sources"), sources, used)
            yield w, r
    for w, r in years(phys, "physical"):
        pw, pm = r.get("per_work_cents"), r.get("per_minute_cents")
        if not is_num(pw) or pw <= 0: err(f"{w}: per_work_cents must be a positive number")
        if not is_num(pm) or pm <= 0: err(f"{w}: per_minute_cents must be a positive number")
        if is_num(pw) and is_num(pm) and pw > 0 and pm > 0:
            if pm >= pw: err(f"{w}: per_minute_cents should be well below per_work_cents; check the figures")
            # the calculator's maths (DATA-PAGES.md section 3) on a 5:01 track, in hundredths of a cent
            hw, hm = round(pw * 100), round(pm * 100)
            if abs(hw - pw * 100) > 1e-6 or abs(hm - pm * 100) > 1e-6:
                err(f"{w}: rates are given to at most two decimal places of a cent")
            per_copy = max(hw, hm * 6)
            if per_copy <= 0: err(f"{w}: the calculator would give no rate")
    sp = data.get("streaming_revenue_percent", [])
    if not isinstance(sp, list): err(f"{path}: streaming_revenue_percent must be a list"); sp = []
    for w, r in years(sp, "streaming_revenue_percent"):
        v = r.get("percent")
        if not is_num(v) or not (0 < v < 100): err(f"{w}: percent must be a number between 0 and 100")
    ring = data.get("ringtone_cents")
    if ring is not None:
        w = f"{path} ringtone_cents"
        if not isinstance(ring, dict) or not is_num(ring.get("value")) or ring.get("value") <= 0:
            err(f"{w}: needs value, a positive number")
        else:
            cite(w, ring.get("sources"), sources, used)
    check_sources(path, sources, used, offline)
    return len(phys), Counter({"physical years": len(phys), "streaming years": len(sp)})

DATA_KINDS = {"claimable": check_claimable, "tools": check_tools, "rates": check_rates}


def check_file(path, offline):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception as e:
        err(f"{path}: not valid JSON ({e})"); return None
    if "kind" in data:
        if data["kind"] not in DATA_KINDS:
            err(f"{path}: kind must be one of {sorted(DATA_KINDS)}"); return None
        n, tally = DATA_KINDS[data["kind"]](path, data, offline)
        print(f"{path}: {data['kind']}, {n} rows {dict(tally)}; {len(data.get('sources', {}))} sources")
        return None
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
    check_sources(path, sources, used, offline)
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
