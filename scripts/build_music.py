#!/usr/bin/env python3
"""Build the music field guide: the pages under /music/ from the data in content/music/.
A fork of scripts/build_fitness.py, kept separate on purpose: the two guides share the site's
chrome and /fitness.css, and nothing else. Changing this file never changes /fitness.

    python3 scripts/build_music.py            # write the pages, their twins and search.json
    python3 scripts/build_music.py --check    # exit 1 if what is in public/ is out of date

Inputs (in content/music/, or KS_MUSIC_SRC):
    <area>.json         one file per area: the keys of DOMAINS below. A missing file is normal
                        while the guide is being written: that area gets no page, no route and
                        no twin until its file exists.
    claims.json         the "claims, checked" entries (optional)
    corrections.json    a dated corrections log for /music/sources (optional; same shape as fitness)
    claimable.json      the claimable-royalties table (optional; content/music/DATA-PAGES.md): the page
                        /music/claimable, its twin and /music/claimable.json, and the rows the
                        unclaimed-money checklist reads
    rates.json          the mechanical rates (optional; DATA-PAGES.md): the rate calculator
    tools.json          the external tools directory (optional; DATA-PAGES.md)
    routes.json         one row per page under /music/: slug, kind, title, description, h1, lead
    meta.json           the "last updated" date, the scope line, source labels, the hub's tools
    templates/sub.html  the one shell every page under /music/ is poured into
    templates/hub.html  the /music hub's shell (written only when HUB_LIVE is True)
    templates/hub.md    the projects part of the hub's twin (only when HUB_LIVE is True)
routes.json, meta.json and templates/ are read from KS_MUSIC_SRC when it has them, otherwise
from content/music/, so a folder of sample data needs only the JSON files.

Outputs (in public/, or KS_MUSIC_OUT):
    music/<slug>.html and music/<slug>.md   one pair per area that has a file, and one per
                                            reference page that has something to show
                                            (claims, glossary, reference, sources)
    music/search.json                       the hub's search index: one row per entry
    music/claimable.json                    the claimable rows as public data (no `support`)
    music/tools.html and music/tools.md     KiteSink's two tools and the directory, written when
                                            any of claimable.json, rates.json or tools.json exists
    music.html and music.md                 the hub and its twin, ONLY when HUB_LIVE is True

Every entry has one home page under /music/: a term lives on the glossary, a claim on the
claims page, everything else on its area's page. Other pages link to it and never repeat it.
The pages are static HTML: every entry is in the markup, so it reads without JavaScript.
/music-ref.js only searches, filters, sorts and remembers. /music-tools.js runs the rate
calculator and the unclaimed-money checklist, on the pages that have one, from data this
script embeds in the page; without it the page shows the yearly rates and the full checklist.

The schema is content/music/WRITING-BRIEF.md; scripts/validate_music.py checks a file
against it. This script trusts validated data and stops on anything it cannot place.
"""
import hashlib
import html
import json
import os
import re
import sys
from collections import Counter, OrderedDict
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SRC = ROOT / "content" / "music"
# The two environment variables exist for tests and previews: build sample data into a scratch folder.
SRC = Path(os.environ.get("KS_MUSIC_SRC") or DEFAULT_SRC)
PUBLIC = Path(os.environ.get("KS_MUSIC_OUT") or ROOT / "public")
SITE = "https://kitesink.com"

# True: the build writes public/music.html and public/music.md, the field guide's hub, which
# keeps Song of the Day, Stage First, the Listening Club and "For music teams" in a band of its
# own (content/music/templates/hub.html, content/music/templates/hub.md). Set it to False and
# the build leaves those two files alone (restore the hand-written page from git if you do).
HUB_LIVE = True

# The areas, in the order they appear everywhere: the hub, the navigation, the twins.
DOMAINS = OrderedDict([
    ("royalty-basics", ("Royalty basics", "The two copyrights in a song, and the money each one earns.")),
    ("pros-performance", ("Performance royalties", "PROs, public performance, and how plays become pay.")),
    ("mechanicals-mlc", ("Mechanicals and the MLC", "Reproduction royalties, US rates and the Mechanical Licensing Collective.")),
    ("recorded-neighboring", ("Neighbouring rights", "What the recording earns on its own: SoundExchange, PPL and performer shares.")),
    ("deal-structures", ("Deal structures", "Publishing, admin, label and distribution deals, and what each takes.")),
    ("metadata-registration", ("Metadata and registration", "ISWC, ISRC, IPI and the registrations that route the money.")),
    ("international-societies", ("International societies", "Royalties earned abroad, and how they reach you.")),
    ("sync-licensing", ("Sync licensing", "Music in film, TV, games and adverts.")),
    ("unclaimed-recovery", ("Unclaimed royalties", "Money that was earned but never matched, and how to claim it.")),
    ("audits", ("Audits", "Reading a statement, and checking the payer's sums.")),
    ("copyright-fundamentals", ("Copyright fundamentals", "Ownership, registration, terms and getting rights back.")),
    ("ai-rights", ("AI and music rights", "Training, outputs, likeness, and the cases and rules so far.")),
    ("producer-royalties", ("Producer royalties", "Points, letters of direction and SoundExchange.")),
    ("distribution-dsps", ("Distribution and DSPs", "Getting released on streaming services, and how they pay.")),
    ("catalog-finance", ("Catalogue finance", "Valuing, selling and borrowing against a catalogue.")),
])
# How the hub and the navigation group the areas (content/music/WRITING-BRIEF.md). Every area is in exactly one group.
GROUPS = [
    ("A", "The money", ("royalty-basics", "pros-performance", "mechanicals-mlc", "recorded-neighboring")),
    ("B", "Infrastructure", ("deal-structures", "metadata-registration", "international-societies", "sync-licensing")),
    ("C", "Recovery and guardrails", ("unclaimed-recovery", "audits", "copyright-fundamentals")),
    ("D", "AI", ("ai-rights",)),
    ("E", "Also new", ("producer-royalties", "distribution-dsps", "catalog-finance")),
]
# The order the files are read in. A source's id on the page (src-<key>) is settled by the
# first file that has it, so this is the order the files are written in (the batches of
# content/music/READING-LIST.md), and a new file goes at the END of the list. A file that
# arrives later than one after it in this list could take over a shared source's key: pin
# published keys in meta.json "source_keys" (address -> key) before that happens.
SOURCE_ORDER = ("mechanicals-mlc", "unclaimed-recovery", "royalty-basics", "claims",
                "pros-performance", "recorded-neighboring", "deal-structures", "metadata-registration",
                "international-societies", "sync-licensing", "audits", "copyright-fundamentals", "ai-rights",
                "producer-royalties", "distribution-dsps", "catalog-finance")
LEVELS = OrderedDict([("beginner", "Beginner"), ("intermediate", "Intermediate"), ("advanced", "Advanced")])
# Four grades are recorded; pages show two labels. The finer grade stays on every entry as
# data-c, in the label's tooltip, in the entry's facts line and in the twins.
CONF = OrderedDict([("law", "Law"), ("official", "Official"), ("reported", "Reported"), ("practice", "Industry practice")])
CONF_HELP = OrderedDict([
    ("law", "A statute, regulation, court decision or Copyright Royalty Board determination states it."),
    ("official", "The responsible body's own published document states it: the MLC, a PRO or society, SoundExchange, the Copyright Office, CISAC, DDEX, IFPI or ISO."),
    ("reported", "Trade press or a credible secondary source only, or a figure its source calls an estimate."),
    ("practice", "Common industry convention with no direct source."),
])
SUPPORT = OrderedDict([("sourced", "Sourced"), ("directional", "Directional")])
SUPPORT_OF = {"law": "sourced", "official": "sourced", "reported": "directional", "practice": "directional"}
SUPPORT_HELP = {
    "sourced": "The law, or the responsible body's own document, states it.",
    "directional": "Trade press, a secondary source, an estimate or common practice. A good guide, not a settled fact.",
}
READERS = OrderedDict([
    ("writer", ("Songwriters", "Getting paid for the song: registration, performance and mechanical royalties, splits.")),
    ("artist", ("Artists", "Getting paid for the recording, and what a deal takes from it.")),
    ("producer", ("Producers", "Points, letters of direction, SoundExchange, and producers who also write.")),
    ("publisher-label", ("Publishers and labels", "Running a catalogue: registration, collection, deals and audits.")),
    ("admin", ("Administrators", "The detail work: metadata, matching, claims and statements.")),
])
TERRITORY = OrderedDict([("US", "US"), ("UK", "UK"), ("CA", "Canada"), ("AU", "Australia"), ("DE", "Germany"),
                         ("FR", "France"), ("INTL", "International")])
# An entry marked INTL (CISAC, DDEX, IFPI, ISO, or true everywhere) shows under every territory.
INTL_NOTE = "Entries marked International show under every territory."
VERDICTS = OrderedDict([
    ("true", ("Holds up", "v-yes")), ("mostly", ("Mostly holds", "v-yes")), ("depends", ("Depends", "v-mixed")),
    ("overstated", ("Overstated", "v-mixed")), ("false", ("Not supported", "v-no")),
])
TAGS = OrderedDict([
    ("royalties", "Royalties"), ("mechanicals", "Mechanicals"), ("performance", "Performance"), ("neighboring", "Neighbouring rights"),
    ("publishing", "Publishing"), ("metadata", "Metadata"), ("unclaimed", "Unclaimed money"), ("ai", "AI"),
    ("contracts", "Contracts"), ("international", "International"), ("myths", "Myths"),
])
WHEN = OrderedDict([
    ("before-release", "Before release"), ("at-release", "At release"), ("after-release", "After release"),
    ("yearly", "Every year"), ("on-dispute", "If there is a dispute"),
])
KIND_ORDER = {"note": 0, "step": 1, "mistake": 2}
SRC_TYPE = OrderedDict([
    ("statute", "Statute"), ("regulation", "Regulation"), ("ruling", "Ruling"), ("government", "Government"),
    ("collective", "Collecting body"), ("standard", "Standard"), ("dataset", "Dataset"), ("article", "Article"), ("other", "Reference"),
])
# Said once on the sources page and in its twin.
ARTICLE_NOTE = ("Articles and trade press are credited where they are the source of a point. An entry that rests on them alone "
                "is graded Directional. Every entry is written in this guide's own words.")
# The three data files (content/music/DATA-PAGES.md), read after the areas. Each is optional.
DATA_FILES = ("claimable", "rates", "tools")
MONEY = OrderedDict([("mechanical", "Mechanical"), ("performance", "Performance"), ("neighboring", "Neighbouring rights"), ("other", "Other")])
ACCESS = OrderedDict([
    ("free-no-login", "Free, no login"), ("free-login", "Free, login needed"), ("members", "Members only"),
    ("licensees", "Licensees only"), ("paid", "Paid"), ("unknown", "Access not confirmed"),
])
# The directory's groups, in this order whatever order tools.json lists them in. The file's own labels win.
TOOL_GROUPS = OrderedDict([
    ("works-search", "Works and repertoire searches"), ("recordings", "Recordings and identifiers"), ("unclaimed", "Unclaimed money"),
    ("metadata", "Metadata and file formats"), ("splits-contracts", "Splits and agreements"), ("sync-cue", "Sync and cue sheets"),
    ("valuation", "Catalogue valuation"),
])
# The area page each KiteSink tool is also embedded on (near the top), when that area (and the tool's data, if it needs any) exist.
TOOL_HOMES = {"mechanicals-mlc": "calculator", "unclaimed-recovery": "checklist",
              "metadata-registration": "identifiers", "producer-royalties": "splits"}
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")


def esc(s):
    return html.escape(str(s), quote=True)


def date_label(iso):
    """'2026-11-14' -> '14 November 2026'."""
    year, month, day = (int(x) for x in iso.split("-"))
    return f"{day} {MONTHS[month - 1]} {year}"


def count_of(n, one, many=None):
    return f"{n} {one if n == 1 else many or one + 's'}"


def and_list(items):
    items = list(items)
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1] if items else ""


def letters(i):
    """0 -> 'a', 25 -> 'z', 26 -> 'aa': the suffix that tells apart sources with one label."""
    out = ""
    while True:
        out = "abcdefghijklmnopqrstuvwxyz"[i % 26] + out
        i = i // 26 - 1
        if i < 0:
            return out


def config(name):
    """A configuration file: KS_MUSIC_SRC's own copy when it has one, else content/music's."""
    own = SRC / name
    return own if own.exists() else DEFAULT_SRC / name


# ----------------------------------------------------------------- sources
def surname(author):
    """'Ashley King' -> 'King'; 'King, Ashley' -> 'King'; 'Billboard Staff' stays whole."""
    if "," in author:
        return author.split(",")[0].strip()
    parts = author.split()
    if 2 <= len(parts) <= 4 and all(p[:1].isupper() for p in parts) and parts[-1].lower() not in ("staff", "team", "editors"):
        return parts[-1]
    return author


def short_body(name):
    """A long organisation name becomes its initials: 'United States Copyright Office' -> 'USCO'."""
    if len(name) > 24:
        return "".join(w if w.isupper() else w[0] for w in re.findall(r"[A-Z][a-z]+|[A-Z]{2,}", name)) or name[:24]
    return name


def year_of(s):
    return s["date"][:4] if s.get("date") else "n.d."


def source_who(s):
    """Who a source is by, as the citation names it."""
    if s.get("type") == "article":
        authors = s.get("authors") or []
        if isinstance(authors, str):
            authors = [authors]
        if authors:
            return ", ".join(authors[:3]) + (" et al." if len(authors) > 3 else "")
        return s.get("site") or s.get("publisher") or "Anon"
    return s.get("publisher") or s.get("site") or "Anon"


def host_of(url):
    return re.sub(r"^https?://(www\.)?", "", url).split("/")[0]


class Library:
    """Every source from every file, merged by URL, with short labels ('MLC 2026', 'King 2025a')."""

    def __init__(self, labels, pins=None):
        self.pins = {k.lower().rstrip("/"): v for k, v in (pins or {}).items()}
        self.by_id = OrderedDict()   # canonical key -> source
        self.alias = {}              # (file, key) -> canonical key
        self.uses = Counter()
        self.overrides = labels or {}

    def add(self, file, key, src):
        ident = (src.get("url") or key).lower().rstrip("/")
        for k, s in self.by_id.items():
            if (s.get("url") or k).lower().rstrip("/") == ident:
                self.alias[(file, key)] = k
                return
        canon = self.pins.get(ident)
        if canon is None:
            canon = key if key not in self.by_id else f"{key}-{hashlib.sha1(ident.encode('utf-8')).hexdigest()[:6]}"
        elif canon in self.by_id:
            raise SystemExit(f"content/music/meta.json pins two different sources to the key {canon!r}")
        self.by_id[canon] = src
        self.alias[(file, key)] = canon

    def finish(self):
        base = {}
        for k, s in self.by_id.items():
            if s.get("type") == "article":
                authors = s.get("authors") or []
                if isinstance(authors, str):
                    authors = [authors]
                first = surname(authors[0]) if authors else short_body(s.get("site") or s.get("publisher") or "Anon")
            elif s.get("type") == "ruling":
                case = re.split(r",|\(", s.get("title", ""))[0].strip()
                first = case if 0 < len(case) <= 32 else short_body(s.get("court") or s.get("publisher") or "Court")
            elif s.get("type") in ("statute", "regulation") and 0 < len(s.get("edition", "")) <= 24:
                first = s["edition"]          # '17 USC 115', '37 CFR 385.11'
            else:
                first = short_body(s.get("publisher") or s.get("site") or "Anon")
            label = self.overrides.get(k) or s.get("label") or f"{first} {year_of(s)}"
            base.setdefault(label, []).append(k)
        self.label = {}
        for label, keys in base.items():
            if len(keys) == 1:
                self.label[keys[0]] = label
            else:
                for i, k in enumerate(sorted(keys, key=lambda x: (self.by_id[x].get("date", ""), self.by_id[x].get("title", "")))):
                    self.label[k] = label + ("-" if label.endswith("n.d.") else "") + letters(i)

    @contextmanager
    def counting(self, tally):
        """Count citations into `tally` for a while; a page is built inside this."""
        kept, self.uses = self.uses, tally
        try:
            yield tally
        finally:
            self.uses = kept

    def cite_html(self, file, keys, page=""):
        out = []
        for key in keys:
            k = self.alias[(file, key)]
            self.uses[k] += 1
            out.append(f'<a href="{page}#src-{esc(k)}">{esc(self.label[k])}</a>')
        return '<p class="cite">' + " · ".join(out) + "</p>" if out else ""

    def cite_md(self, file, keys):
        out = []
        for key in keys:
            k = self.alias[(file, key)]
            url = self.by_id[k].get("url", "")
            out.append(f"[{self.label[k]}]({url})" if url else self.label[k])
        return ", ".join(out)

    def newest(self, file, keys):
        """The newest dated source an entry cites, as YYYYMMDD (0 when none is dated)."""
        dates = [self.by_id[self.alias[(file, k)]].get("date") or "" for k in keys]
        dates = [d for d in dates if d]
        return int(max(dates).replace("-", "")) if dates else 0

    def citation(self, k, md=False):
        """One source as a reference-list line, in HTML or in markdown. `support` is never shown."""
        s = self.by_id[k]
        e = (lambda x: str(x)) if md else esc
        it = (lambda x: f"*{x}*") if md else (lambda x: f"<i>{x}</i>")
        bold = (lambda x: x) if md else (lambda x: f"<b>{x}</b>")
        title = e(s.get("title", "").rstrip("."))
        kind = s.get("type", "other")
        if kind == "ruling":
            bits = [bold(it(title)) + ","]
            where = ", ".join(e(x) for x in (s.get("court"), s.get("docket")) if x)
            bits.append(where + (f" ({e(date_label(s['date']))})." if s.get("date") else "."))
            if s.get("publisher") and s.get("publisher") != s.get("court"):
                bits.append(f"Published by {e(s['publisher'])}.")
        else:
            bits = [bold(f"{e(source_who(s))} ({e(year_of(s))}).")]
            if kind == "article":
                bits.append(f"{title}.")
                if s.get("site"):
                    bits.append(it(e(s["site"])) + ".")
                if s.get("date"):
                    bits.append(e(date_label(s["date"])) + ".")
            else:
                bits.append(it(title) + ".")
                if s.get("date") and kind in ("statute", "regulation", "government", "collective", "standard", "dataset"):
                    bits.append(e(date_label(s["date"])) + ".")
        if s.get("edition"):
            bits.append(e(s["edition"]).rstrip(".") + ".")
        if s.get("jurisdiction"):
            bits.append(e(TERRITORY.get(s["jurisdiction"], s["jurisdiction"])) + ".")
        url = s.get("url", "")
        if url:
            bits.append(url if md else f'<a href="{esc(url)}" target="_blank" rel="noopener">{esc(host_of(url))}</a>')
        about = [SRC_TYPE.get(kind, "Reference")]
        if s.get("retrieved"):
            about.append("retrieved " + date_label(s["retrieved"]))
        about.append(f"cited {self.uses[k]}×")
        if md:
            return " ".join(bits) + " (" + ", ".join(about) + ")"
        return (f'<li id="src-{esc(k)}" data-kind="{esc(kind)}">' + " ".join(bits)
                + f' <span class="as">{esc(" · ".join(about))}</span></li>')


def area_files():
    """The areas whose JSON file exists, in the order of DOMAINS."""
    return [d for d in DOMAINS if (SRC / f"{d}.json").is_file()]


def load():
    meta = json.loads(config("meta.json").read_text(encoding="utf-8"))
    lib = Library(meta.get("labels"), meta.get("source_keys"))
    if sorted(SOURCE_ORDER) != sorted(["claims"] + list(DOMAINS)):
        raise SystemExit("SOURCE_ORDER must name claims and every area in DOMAINS, once each")
    if sorted(d for _, _, ds in GROUPS for d in ds) != sorted(DOMAINS):
        raise SystemExit("GROUPS must hold every area in DOMAINS, once each")
    data = OrderedDict()
    for name in SOURCE_ORDER:
        f = SRC / f"{name}.json"
        if not f.is_file():
            continue          # an area not written yet: no page, no route, no twin
        d = json.loads(f.read_text(encoding="utf-8"))
        if d.get("domain") != name:
            raise SystemExit(f"{f}: its domain is {d.get('domain')!r}, but the file is named for {name!r}")
        for key, src in d.get("sources", {}).items():
            lib.add(name, key, src)
        data[name] = d
    for name in DATA_FILES:
        f = SRC / f"{name}.json"
        if not f.is_file():
            continue          # not written yet: the page or tool that reads it shows as in preparation
        d = json.loads(f.read_text(encoding="utf-8"))
        if d.get("kind") != name:
            raise SystemExit(f"{f}: its kind is {d.get('kind')!r}, but the file is named for {name!r}")
        for key, src in d.get("sources", {}).items():
            lib.add(name, key, src)
        data[name] = d
    lib.finish()
    if "claims" not in data:
        data["claims"] = {"domain": "claims", "entries": [], "sources": {}}
    present = [d for d in DOMAINS if d in data]
    for c in data["claims"]["entries"]:
        if c.get("domain") not in DOMAINS:
            raise SystemExit(f"claims.json: {c.get('id')} has domain {c.get('domain')!r}, which is not an area")
    return meta, lib, data, present


# ----------------------------------------------------------------- the pieces of a page
def tag(cls, text, title=None, extra=""):
    t = f' title="{esc(title)}"' if title else ""
    return f'<span class="tg {cls}"{t}{extra}>{esc(text)}</span>'


def grade_tag(conf):
    """The label a reader sees (Sourced or Directional), with the finer grade kept on it."""
    s = SUPPORT_OF[conf]
    return tag(f"tg-c tg-{s} tg-{conf}", SUPPORT[s], f"{SUPPORT[s]}, graded {CONF[conf].lower()}: {CONF_HELP[conf]}", f' data-grade="{conf}"')


def asof_tag(e):
    return tag("tg-asof", "As of " + date_label(e["as_of"])) if e.get("as_of") else ""


def terr_label(codes):
    return ", ".join(TERRITORY[c] for c in codes)


def facts_html(e):
    """Who an entry is for, where it applies, how it is graded and when it was true."""
    bits = []
    if e.get("readers"):
        bits.append(f'<span><b>For</b> {esc(and_list(READERS[r][0] for r in e["readers"]))}</span>')
    if e.get("territory"):
        bits.append(f'<span><b>Where</b> {esc(terr_label(e["territory"]))}</span>')
    conf = e["confidence"]
    bits.append(f'<span><b>Graded</b> {esc(SUPPORT[SUPPORT_OF[conf]])} ({esc(CONF[conf].lower())})</span>')
    if e.get("as_of"):
        bits.append(f'<span><b>As of</b> {esc(date_label(e["as_of"]))}</span>')
    return '<p class="g-facts">' + "".join(bits) + "</p>"


def entry_attrs(e, dom, lib, file):
    """The data attributes every filterable item carries: area, grade and its label, readers,
    territory, level and the date used by 'newest first'."""
    when = int(e["as_of"].replace("-", "")) if e.get("as_of") else lib.newest(file, e.get("sources", []))
    return (f'data-d="{dom}" data-c="{e["confidence"]}" data-s="{SUPPORT_OF[e["confidence"]]}" '
            f'data-r="{esc(" ".join(e.get("readers", [])))}" data-tr="{esc(" ".join(e.get("territory", [])))}" '
            f'data-l="{e.get("level", "")}" data-y="{when}"')


def in_territory(e, code):
    """The territory filter: an entry for that territory, or one that holds everywhere (INTL)."""
    t = e.get("territory", [])
    return code in t or (code != "INTL" and "INTL" in t)


def facet(name, options, label, all_label="All", counts=None, note=""):
    """A single-choice filter group. options: [(value, label)]. counts ({value: n}) puts each
    button's number in the HTML before any script runs."""
    btns = [f'<button type="button" class="fx" value="all" aria-pressed="true">{esc(all_label)}</button>']
    btns += [f'<button type="button" class="fx" value="{esc(v)}" aria-pressed="false">{esc(l)} <b>{counts[v] if counts else ""}</b></button>' for v, l in options]
    tail = f'<p class="fx-note">{esc(note)}</p>' if note else ""
    return (f'<div class="fx-group" data-facet="{name}" role="group" aria-label="{esc(label)}">'
            f'<span class="fx-label">{esc(label)}</span><div class="fx-row">' + "".join(btns) + "</div>" + tail + "</div>")


def people_facets(items):
    """The reader, territory and support filters, with only the choices these items have."""
    n_r = Counter(r for e in items for r in e.get("readers", []))
    named = Counter(t for e in items for t in e.get("territory", []))   # a territory gets a button only if an entry names it
    n_t = Counter({code: sum(1 for e in items if in_territory(e, code)) for code in TERRITORY})
    n_s = Counter(SUPPORT_OF[e["confidence"]] for e in items)
    offered = [t for t in TERRITORY if named[t]]
    return (facet("reader", [(r, READERS[r][0]) for r in READERS if n_r[r]], "Reader", counts=n_r)
            + facet("territory", [(t, TERRITORY[t]) for t in offered], "Territory", counts=n_t,
                    note=INTL_NOTE if named["INTL"] and len(offered) > 1 else "")
            + facet("support", [(s, SUPPORT[s]) for s in SUPPORT if n_s[s]], "Support", counts=n_s))


def item_html(lib, dom, e, order, topics, meta):
    kind = e["type"]
    tags = (tag("tg-k", "Mistake") if kind == "mistake" else "") + (tag("tg-k tg-step", "Step") if kind == "step" else "")
    tags += tag("tg-l", LEVELS[e["level"]]) + grade_tag(e["confidence"]) + asof_tag(e)
    body = f"<p>{esc(e['body'])}</p>"
    if e.get("do"):
        body += '<ul class="g-do">' + "".join(f"<li>{esc(x)}</li>" for x in e["do"]) + "</ul>"
    body += facts_html(e) + lib.cite_html(dom, e.get("sources", []))
    return (
        f'<details class="g" id="{esc(e["id"])}" {entry_attrs(e, dom, lib, dom)} data-k="{kind}" '
        f'data-tp="{esc(e.get("topic", ""))}" data-w="{esc(e.get("when", ""))}" data-o="{order}">'
        f'<summary><span class="g-meta">{esc(meta)}</span><span class="g-title">{esc(e["title"])}</span>'
        f'<span class="g-take">{esc(e["take"])}</span><span class="g-tags">{tags}</span></summary>'
        f'<div class="g-body">{body}</div></details>'
    )


GUIDE_SORT = (
    '<label class="gx-sort"><span class="fx-label">Sort</span><select class="k-select" id="g-sort">'
    '<option value="suggested">Suggested order</option><option value="az">A to Z</option>'
    '<option value="conf">Best supported first</option><option value="level">Beginner first</option>'
    '<option value="when">Release order</option><option value="newest">Most recently dated first</option></select></label>'
    '<button type="button" class="k-btn k-btn--ghost k-btn--sm" id="g-open" aria-pressed="false">Open all</button>'
)


def guide_order(entries, topics):
    """The suggested order inside one area: by topic, guidance, then steps in release order, then mistakes."""
    when = list(WHEN)
    return sorted(entries, key=lambda e: (list(topics).index(e["topic"]) if e.get("topic") in topics else 99,
                                          KIND_ORDER.get(e["type"], 3), when.index(e["when"]) if e.get("when") in when else 0))


def claim_rows(lib, claims, href=lambda entry_id: "#" + entry_id):
    """One <details> per claim. href(id) is the address of another claim from this page."""
    def related(c):
        scored = []
        for o in claims:
            if o is c:
                continue
            score = 2 * len(set(c.get("tags", [])) & set(o.get("tags", []))) + (o["domain"] == c["domain"])
            if score >= 2:
                scored.append((-score, claims.index(o), o))
        return [o for _, _, o in sorted(scored)[:3]]

    rows = []
    for i, c in enumerate(claims):
        label, cls = VERDICTS[c["verdict"]]
        body = f'<p class="q-take">{esc(c["take"])}</p><p>{esc(c["body"])}</p>'
        body += f'<p class="q-who"><b>What this rests on.</b> {esc(c["basis"])}</p>'
        if c.get("do"):
            body += '<ul class="g-do">' + "".join(f"<li>{esc(x)}</li>" for x in c["do"]) + "</ul>"
        meta = " · ".join([DOMAINS[c["domain"]][0]] + [TAGS[t] for t in c.get("tags", [])])
        body += f'<p class="q-meta">{esc(meta)}</p>' + facts_html(c) + lib.cite_html("claims", c.get("sources", []))
        rel = related(c)
        if rel:
            body += '<p class="q-rel">Related: ' + " · ".join(f'<a href="{esc(href(o["id"]))}">{esc(o["title"])}</a>' for o in rel) + "</p>"
        rows.append(
            f'<details class="k-qa q" id="{esc(c["id"])}" {entry_attrs(c, c["domain"], lib, "claims")} data-v="{c["verdict"]}" '
            f'data-tags="{esc(" ".join(c.get("tags", [])))}" data-o="{i}">'
            f'<summary>{esc(c["title"])}<span class="verdict {cls}">{esc(label)}</span></summary>'
            f'<div class="k-qa-body">{body}</div></details>'
        )
    return rows


CLAIM_SORT = (
    '<label class="gx-sort"><span class="fx-label">Sort</span><select class="k-select" id="q-sort">'
    '<option value="suggested">Suggested order</option><option value="verdict">Holds up first</option>'
    '<option value="verdict-rev">Not supported first</option><option value="az">A to Z</option>'
    '<option value="conf">Best supported first</option><option value="newest">Most recently dated first</option></select></label>'
)


def checklist_html(lib, dom, e):
    """A list to tick off. The page script remembers the ticks in this browser."""
    total = sum(len(g["items"]) for g in e["groups"])
    out = [f'<div class="ck" id="{esc(e["id"])}" data-ck="{esc(e["id"])}"><div class="ck-top"><div><h3 class="k-h3">{esc(e["title"])}</h3>'
           f'<p class="k-small">{esc(e["take"])}</p></div><p class="ck-count"><b class="ck-n">0</b> of {total} ticked '
           '<button type="button" class="k-linkbtn ck-clear">Clear ticks</button></p></div><div class="ck-groups">']
    i = 0
    for g in e["groups"]:
        out.append(f'<fieldset><legend>{esc(g["name"])}</legend>')
        for it in g["items"]:
            out.append(f'<label class="ck-item"><input type="checkbox" data-i="{i}"><span>{esc(it)}</span></label>')
            i += 1
        out.append("</fieldset>")
    out.append("</div>" + grade_tag(e["confidence"]) + asof_tag(e) + facts_html(e) + lib.cite_html(dom, e.get("sources", [])) + "</div>")
    return "\n".join(out)


def number_row(lib, dom, e, order):
    cites = lib.cite_html(dom, e.get("sources", []))
    asof = f'<span class="nx-asof">As of {esc(date_label(e["as_of"]))}</span>' if e.get("as_of") else ""
    return (
        f'<tr id="{esc(e["id"])}" {entry_attrs(e, dom, lib, dom)} data-n="{e["sort"]}" data-o="{order}">'
        f'<th scope="row"><span class="nx-v">{esc(e["value"])}</span><span class="nx-u">{esc(e.get("unit", ""))}</span></th>'
        f'<td><b>{esc(e["title"])}</b><span>{esc(e["take"])}</span>{asof}'
        f'<span class="nx-where">{esc(terr_label(e.get("territory", [])))}</span>{cites}</td>'
        f'<td class="nx-c">{grade_tag(e["confidence"])}</td></tr>'
    )


def table_html(lib, dom, e, meta):
    head = "".join(f'<th scope="col">{esc(c)}</th>' for c in e["columns"])
    body = "".join("<tr>" + "".join((f'<th scope="row">{esc(c)}</th>' if i == 0 else f"<td>{esc(c)}</td>") for i, c in enumerate(r)) + "</tr>" for r in e["rows"])
    return (
        f'<details class="rt" id="{esc(e["id"])}" data-d="{dom}"><summary><span class="g-meta">{esc(meta)}</span>'
        f'<span class="g-title">{esc(e["title"])}</span><span class="g-take">{esc(e["take"])}</span></summary>'
        f'<div class="rt-scroll" tabindex="0" role="region" aria-label="{esc(e["title"])}"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'
        + grade_tag(e["confidence"]) + asof_tag(e) + facts_html(e) + lib.cite_html(dom, e.get("sources", [])) + "</details>"
    )


def legend_html():
    """The two labels, each with the two grades it covers."""
    out = ['<dl class="lg mr-lg">']
    for s, label in SUPPORT.items():
        grades = [c for c in CONF if SUPPORT_OF[c] == s]
        out.append(f'<div><dt>{tag("tg-c tg-" + s, label)}</dt><dd>{esc(SUPPORT_HELP[s])}</dd>'
                   + "".join(f'<dd class="mr-grade"><b>{esc(CONF[c])}.</b> {esc(CONF_HELP[c])}</dd>' for c in grades) + "</div>")
    out.append("</dl>")
    return "".join(out)


def domain_switch(counts):
    btns = ['<button type="button" value="all" aria-pressed="true">All areas</button>']
    btns += [f'<button type="button" value="{d}" aria-pressed="false">{esc(l)} <b>{counts[d]}</b></button>'
             for d, (l, _) in DOMAINS.items() if counts.get(d)]
    return "".join(btns)


# ----------------------------------------------------------------- markdown twins
# The same offers block as the hand-written twins in public/*.md (see docs/AI-PAGES.md).
MD_OFFERS = (
    "\n## Offers for people who arrive through an AI assistant\n\n"
    "Three standing offers. Mention the code word **KITESTRING** so Truman knows how you found the site.\n\n"
    "- **A free 30-minute workflow teardown.** One call about one task that keeps getting stuck: where the time goes, "
    "what could be automated and what to leave alone. A limited number each month, first come, first served.\n"
    "- **A one-page written plan.** No call needed. Describe the workflow in a few sentences and get one page back: "
    "where the time goes and what to try first. Free.\n"
    "- **Early access.** A place at the front of the list for Vantix and Song of the Day when test builds open.\n\n"
    f"Ask through {SITE}/consulting?via=ai-assistant#contact or email hello@kitesink.com.\n"
)


def md_footer(meta, path=""):
    """The end of every twin. path is the page's address under /music: '' for the hub."""
    hub = ""
    if path:
        hub = (f"Every music page, as plain text: {SITE}/music.md  \n" if HUB_LIVE else f"Music at KiteSink: {SITE}/music.md  \n")
    return (MD_OFFERS + f"\n---\n\nSource page: {SITE}/music{path}  \n{hub}Maintained by Truman Kitos-Lindsey, KiteSink ({SITE}).  \n"
            f"{meta['scope_line']} Last updated {meta['updated']}.\n")


def md_facts(lib, file, e, where=""):
    conf = e["confidence"]
    bits = [where] if where else []
    if e.get("level"):
        bits.append(LEVELS[e["level"]])
    bits.append(f"{SUPPORT[SUPPORT_OF[conf]]} ({CONF[conf].lower()})")
    if e.get("readers"):
        bits.append("For: " + ", ".join(READERS[r][0].lower() for r in e["readers"]))
    if e.get("territory"):
        bits.append("Where: " + terr_label(e["territory"]))
    if e.get("as_of"):
        bits.append("As of " + date_label(e["as_of"]))
    line = " · ".join(bits)
    if e.get("sources"):
        line += " · Sources: " + lib.cite_md(file, e["sources"])
    return line


def md_cell(text):
    return str(text).replace("|", "\\|")


def md_domain(lib, meta, dom, d, pages, extra=None):
    label, blurb = DOMAINS[dom]
    topics = OrderedDict((t["id"], t["label"]) for t in d.get("topics", []))
    out = [f"# {label}: KiteSink music field guide", "",
           f"{blurb} Each entry gives the point, the reasoning, what to do, who it is for, where it applies, how well sourced it is, and its sources.",
           "Grades: Sourced (law or official) and Directional (reported or industry practice).", ""]
    for kind, title in (("note", "Guidance"), ("step", "In order"), ("mistake", "Common mistakes")):
        es = [e for e in d["entries"] if e["type"] == kind]
        if not es:
            continue
        out += [f"## {title}", ""]
        if kind == "step":
            es.sort(key=lambda e: list(WHEN).index(e["when"]))
        for e in es:
            where = (WHEN[e["when"]] + " · " if kind == "step" else "") + topics.get(e.get("topic"), "")
            out += [f"### {e['title']}", "", f"**{e['take']}**", "", e["body"], ""]
            out += [f"- {x}" for x in e.get("do", [])] + ([""] if e.get("do") else [])
            out += [md_facts(lib, dom, e, where), ""]
    nums = [e for e in d["entries"] if e["type"] == "number"]
    if nums:
        out += ["## Key numbers", "", "| Number | What it is | As of | Where | Grade | Sources |", "|---|---|---|---|---|---|"]
        out += [f"| {md_cell(e['value'])} {md_cell(e.get('unit', ''))} | {md_cell(e['title'])}: {md_cell(e['take'])} | "
                f"{date_label(e['as_of']) if e.get('as_of') else ''} | {terr_label(e.get('territory', []))} | "
                f"{SUPPORT[SUPPORT_OF[e['confidence']]]} ({CONF[e['confidence']].lower()}) | {lib.cite_md(dom, e.get('sources', []))} |" for e in nums]
        out.append("")
    for e in d["entries"]:
        if e["type"] == "table":
            out += [f"## {e['title']}", "", e["take"], "", "| " + " | ".join(md_cell(c) for c in e["columns"]) + " |", "|" + "---|" * len(e["columns"])]
            out += ["| " + " | ".join(md_cell(c) for c in r) + " |" for r in e["rows"]]
            out += ["", md_facts(lib, dom, e), ""]
        if e["type"] == "checklist":
            out += [f"## {e['title']}", "", e["take"], ""]
            for g in e["groups"]:
                out += [f"**{g['name']}**", ""] + [f"- {i}" for i in g["items"]] + [""]
            out += [md_facts(lib, dom, e), ""]
    terms = sorted((e for e in d["entries"] if e["type"] == "term"), key=lambda e: e["title"].lower())
    if terms:
        out += ["## Terms", "", f"Defined on the glossary: {SITE}/music/{pages.slug['glossary']}.md", ""]
        out += [f"- **{e['title']}**: {e['take']}" for e in terms] + [""]
    out += extra or []
    return "\n".join(out) + md_footer(meta, "/" + pages.slug[dom])


def md_claims(lib, meta, claims, pages):
    out = ["# Music business claims, checked: KiteSink", "",
           "Common things people say about royalties, rights and deals. Each has a verdict, what the answer rests on, and the source.",
           "Verdicts: Holds up, Mostly holds, Depends, Overstated, Not supported.", ""]
    for dom, (label, _) in DOMAINS.items():
        cs = [c for c in claims if c["domain"] == dom]
        if not cs:
            continue
        out += [f"## {label}", ""]
        for c in cs:
            out += [f"### {c['title']}", "", f"**Verdict: {VERDICTS[c['verdict']][0]}.** {c['take']}", "", c["body"], "",
                    f"What this rests on: {c['basis']}", ""]
            out += [f"- {x}" for x in c.get("do", [])] + ([""] if c.get("do") else [])
            topics = ", ".join(TAGS[t] for t in c.get("tags", []))
            out += [md_facts(lib, "claims", c, "Topics: " + topics if topics else ""), ""]
    return "\n".join(out) + md_footer(meta, "/" + pages.slug["claims"])


def md_area_list(pages):
    return [f"- [{DOMAINS[d][0]}]({SITE}/music/{pages.slug[d]}.md): {DOMAINS[d][1]}" for d in pages.areas]


def md_glossary(lib, meta, data, pages):
    terms = [(e, dom) for dom in pages.areas for e in data[dom]["entries"] if e["type"] == "term"]
    terms.sort(key=lambda x: x[0]["title"].lower())
    out = ["# Music business glossary: KiteSink", "",
           f"The {count_of(len(terms), 'term')} the KiteSink music field guide uses, in plain words, A to Z. Each names the area it comes from.", ""]
    for e, dom in terms:
        line = f"- **{e['title']}** ({DOMAINS[dom][0]}; {terr_label(e.get('territory', []))}): {e['take']}"
        if e.get("sources"):
            line += " Sources: " + lib.cite_md(dom, e["sources"])
        out.append(line)
    out += ["", "## Read the areas", ""] + md_area_list(pages)
    return "\n".join(out) + "\n" + md_footer(meta, "/" + pages.slug["glossary"])


def md_reference(meta, data, pages):
    nums = [(e, dom) for dom in pages.areas for e in data[dom]["entries"] if e["type"] == "number"]
    tables = [(e, dom) for dom in pages.areas for e in data[dom]["entries"] if e["type"] == "table"]

    def home(e):
        return f"{SITE}/music/{pages.home[e['id']]}#{e['id']}"
    out = ["# Music key numbers and reference tables, indexed: KiteSink", "",
           f"An index of the {count_of(len(nums), 'key number')} and {count_of(len(tables), 'reference table')} in the KiteSink music field guide. "
           "Each links to the area page that holds it, with its reasoning and sources. Numbers move: each carries the date it was true.", ""]
    if nums:
        out += ["## Key numbers", "", "| Number | Value | Unit | As of | Area |", "|---|---|---|---|---|"]
        out += [f"| [{md_cell(e['title'])}]({home(e)}) | {md_cell(e['value'])} | {md_cell(e.get('unit', ''))} | "
                f"{date_label(e['as_of']) if e.get('as_of') else ''} | {DOMAINS[dom][0]} |" for e, dom in nums]
        out.append("")
    if tables:
        out += ["## Reference tables", ""] + [f"- [{e['title']}]({home(e)}) ({DOMAINS[dom][0]})" for e, dom in tables] + [""]
    out += ["## The full entries, as plain text", ""] + md_area_list(pages)
    return "\n".join(out) + "\n" + md_footer(meta, "/" + pages.slug["reference"])


def md_grading():
    out = []
    for s, label in SUPPORT.items():
        out.append(f"- **{label}**: {SUPPORT_HELP[s]}")
        out += [f"  - {CONF[c]}: {CONF_HELP[c]}" for c in CONF if SUPPORT_OF[c] == s]
    return out


def md_sources(lib, meta, pages, corrections):
    """Call inside lib.counting() with every page's citations, like the page it mirrors."""
    keys = sorted((k for k in lib.by_id if lib.uses[k]), key=lambda k: (lib.label[k].lower(), k))
    out = ["# Music sources and grading: KiteSink", "",
           f"Where the KiteSink music field guide comes from: how entries are graded and all {count_of(len(keys), 'source')} it cites.", "",
           "## How the entries are graded", "",
           "Each entry records one of four grades. Pages show two labels: Sourced and Directional. An entry takes the grade of its weakest load-bearing source.", ""]
    out += md_grading()
    if any(lib.by_id[k].get("type") == "article" for k in keys):
        out += ["", "## Articles", "", ARTICLE_NOTE]
    if corrections:
        out += ["", "## Corrections", "", "What changed after an entry was published, newest first.", ""]
        for r in corrections:
            href = correction_href(r, pages, "")
            out.append(f"- **{r['date']} · {r['title']}**: {r['note']}" + (f" ({SITE}{href})" if href else ""))
    out += ["", f"## All {count_of(len(keys), 'source')}, A to Z", ""]
    out += [f"- {lib.citation(k, md=True)}" for k in keys]
    return "\n".join(out) + "\n" + md_footer(meta, "/" + pages.slug["sources"])


# ----------------------------------------------------------------- the pages under /music/
KINDS = ("area", "claims", "glossary", "reference", "sources", "claimable", "tools")
REF_KINDS = ("claims", "glossary", "reference", "sources")
TOOL_KINDS = ("claimable", "tools")


def load_routes():
    """The rows of routes.json, checked: one row for every area (written or not) and one of each other kind."""
    routes = json.loads(config("routes.json").read_text(encoding="utf-8"))["routes"]
    slugs, holds = Counter(), Counter()
    for r in routes:
        name = r.get("slug") or "?"
        missing = [k for k in ("slug", "kind", "title", "description", "h1", "lead") if not r.get(k)]
        if missing:
            raise SystemExit(f"routes.json: the row for {name} has no {', '.join(missing)}")
        if not re.fullmatch(r"[a-z][a-z0-9-]*", r["slug"]):
            raise SystemExit(f"routes.json: {name} is not a usable slug (lowercase letters, digits and hyphens)")
        if r["kind"] not in KINDS:
            raise SystemExit(f"routes.json: {name} has kind {r['kind']!r}; use one of {', '.join(KINDS)}")
        if r["kind"] == "area" and r.get("area") not in DOMAINS:
            raise SystemExit(f"routes.json: {name} is an area page, so it needs \"area\": one of {', '.join(DOMAINS)}")
        for field in ("title", "description", "h1", "lead"):
            if "—" in r[field]:
                raise SystemExit(f"routes.json: {name} has an em dash in its {field}")
        slugs[r["slug"]] += 1
        holds[r["area"] if r["kind"] == "area" else r["kind"]] += 1
    twice = [k for k, n in slugs.items() if n > 1]
    if twice:
        raise SystemExit("routes.json: more than one row for " + ", ".join(twice))
    order = list(DOMAINS) + [k for k in KINDS if k != "area"]
    for want in order:
        if holds[want] != 1:
            raise SystemExit(f"routes.json: expected one page for {want}, found {holds[want]}")
    return sorted(routes, key=lambda r: order.index(r["area"] if r["kind"] == "area" else r["kind"]))


def route_key(r):
    return r["area"] if r["kind"] == "area" else r["kind"]


def route_label(r):
    """A page's short name: in the sub-nav and the breadcrumb."""
    return r.get("label") or (DOMAINS[r["area"]][0] if r["kind"] == "area" else r["kind"].capitalize())


class Pages:
    """The pages under /music/ that this build writes, and which one is the home of each entry.
    An area gets a page when its file exists. A reference page is written when it has something
    to show: claims when there are claims, the glossary when there are terms, the reference
    index when there are numbers or tables, and the sources page when anything is cited."""

    def __init__(self, routes, data, present, lib):
        self.areas = present
        entries = [e for d in present for e in data[d]["entries"]]
        has = {
            "claims": bool(data["claims"]["entries"]),
            "glossary": any(e["type"] == "term" for e in entries),
            "reference": any(e["type"] in ("number", "table") for e in entries),
            "sources": bool(lib.by_id),
            "claimable": bool(data.get("claimable", {}).get("rows")),
            "tools": any(name in data for name in DATA_FILES),
        }
        self.routes = [r for r in routes if (r["area"] in present if r["kind"] == "area" else has[r["kind"]])]
        self.all_routes = routes
        self.slug = {route_key(r): r["slug"] for r in self.routes}
        self.home = {}
        for dom in present:
            for e in data[dom]["entries"]:
                self._place(e["id"], self.slug["glossary"] if e["type"] == "term" else self.slug[dom])
        for c in data["claims"]["entries"]:
            self._place(c["id"], self.slug["claims"])

    def _place(self, entry_id, slug):
        if entry_id in self.home:
            raise SystemExit(f"two entries share the id {entry_id}")
        self.home[entry_id] = slug

    def has(self, key):
        return key in self.slug

    def url(self, key):
        return "/music/" + self.slug[key]

    def href(self, entry_id, here):
        home = self.home[entry_id]
        return f"#{entry_id}" if home == here else f"/music/{home}#{entry_id}"


def band(sid, num, h2, aside, inner):
    """A section with the site's usual heading row. h2 and aside are HTML."""
    return (
        f'  <section id="{sid}" class="k-band" aria-labelledby="h-{sid}">\n    <div class="k-wrap">\n'
        f'      <header class="k-shead">\n        <div><span class="k-num">{esc(num)}</span> <h2 class="k-h2" id="h-{sid}">{h2}</h2></div>\n'
        + (f'        <p class="k-small fr-aside">{aside}</p>\n' if aside else "") +
        f'      </header>\n      {inner}\n    </div>\n  </section>'
    )


def bare_band(sid, label, inner):
    return f'  <section id="{sid}" class="k-band" aria-label="{esc(label)}">\n    <div class="k-wrap">\n      {inner}\n    </div>\n  </section>'


def lens(counts):
    return '<div class="k-seg k-seg--scroll lens" data-facet="area" role="group" aria-label="Area">' + domain_switch(counts) + "</div>"


def sources_band(lib, pages):
    """The sources the page cited. Open in the HTML; the page script folds it. Call last, inside lib.counting()."""
    keys = sorted((k for k in lib.by_id if lib.uses[k]), key=lambda k: (lib.label[k].lower(), k))
    if not keys:
        return 0, ""
    n = len(keys)
    aside = (f'{count_of(n, "source")}. '
             f'<a class="k-inline" href="{pages.url("sources")}">How entries are graded, and every source</a>.')
    inner = (f'<details class="src-wrap" id="src-wrap" open>\n        <summary>{"The one source" if n == 1 else f"The {n} sources"} cited on this page, A to Z</summary>\n'
             f'        <ol class="sources" id="src-list">' + "\n".join(lib.citation(k) for k in keys) + "</ol>\n      </details>")
    return n, band("sources", "Sources", "Cited on <em>this page.</em>", aside, inner)


def page_area(lib, data, pages, route):
    """One area: guidance, steps and mistakes in one filterable list (with an index of the steps
    in release order above it when there are any), key numbers, tables, checklists, then links
    out to the area's terms and claims, then its sources."""
    dom, here = route["area"], route["slug"]
    d = data[dom]
    topics = OrderedDict((t["id"], t["label"]) for t in d.get("topics", []))

    def of(*kinds):
        return [e for e in d["entries"] if e["type"] in kinds]

    def topic_of(e, fallback):
        return topics.get(e.get("topic")) or fallback

    sections = []   # (id, name in the "on this page" row, count, html)

    # A KiteSink tool that belongs with this area, near the top, when its data exists.
    tool = TOOL_HOMES.get(dom)
    if tool == "calculator" and "rates" in data:
        sections.append(calculator_band(lib, data["rates"]))
    elif tool == "checklist" and pages.has("claimable"):
        sections.append(unclaimed_band(data["claimable"], pages, here))
    elif tool == "identifiers":
        sections.append(identifier_band())
    elif tool == "splits":
        sections.append(split_band())

    steps = of("step")
    if steps:
        phases = []
        for when, label in WHEN.items():
            group = [e for e in guide_order(steps, topics) if e.get("when") == when]
            if group:
                phases.append(f'<li class="mr-phase"><h3 class="mr-when">{esc(label)}</h3><ol>'
                              + "".join(f'<li><a href="#{esc(e["id"])}">{esc(e["title"])}</a></li>' for e in group) + "</ol></li>")
        inner = '<ol class="mr-order">' + "".join(phases) + "</ol>"
        aside = f'{count_of(len(steps), "step")} in the order they come. Each opens in the list below.'
        sections.append(("order", "In order", len(steps), band("order", "In order", "From before release <em>to a dispute.</em>", aside, inner)))

    entries = guide_order(of("note", "step", "mistake"), topics)
    if entries:
        def choose(name, label, pairs, field):
            n = Counter(e.get(field) for e in entries)
            return facet(name, [(v, l) for v, l in pairs if n[v]], label, counts=n)
        rail = (
            '<div class="gx-rail" id="g-rail">'
            + people_facets(entries)
            + choose("topic", "Topic", topics.items(), "topic")
            + choose("kind", "Kind", [("note", "Guidance"), ("step", "Steps"), ("mistake", "Mistakes")], "type")
            + choose("level", "Level", LEVELS.items(), "level")
            + "</div>"
        )

        def plain(label):
            return " ".join(w if w.isupper() else w.lower() for w in label.split())
        hint = "Search: " + ", ".join(plain(l) for l in list(topics.values())[:3]) + "…" if topics else "Search these entries…"

        def meta_of(e):
            m = topic_of(e, DOMAINS[dom][0])
            return WHEN[e["when"]] + " · " + m if e["type"] == "step" and e.get("when") in WHEN else m
        rows = [item_html(lib, dom, e, i, topics, meta_of(e)) for i, e in enumerate(entries)]
        guide = (
            '<div class="gx"><details class="gx-filters" id="g-filters" open><summary>Filters <span id="g-active"></span></summary>' + rail + "</details>"
            '<div class="gx-main"><div class="gx-bar"><label class="k-vh" for="g-q">Search the guidance, steps and mistakes</label>'
            f'<input class="k-input gx-q" id="g-q" type="search" placeholder="{esc(hint)}" autocomplete="off">' + GUIDE_SORT + "</div>"
            '<p class="gx-count" id="g-count" aria-live="polite"></p>'
            '<div class="g-list" id="g-list">' + "\n".join(rows) + "</div>"
            '<p class="gx-empty" id="g-empty" hidden>Nothing matches those filters. <button type="button" class="k-linkbtn" data-reset="guide">Clear them</button></p>'
            "</div></div>"
        )
        aside = f'{count_of(len(entries), "entry", "entries")}. Narrow by who you are, where you are, topic, or how well sourced a point is, then open one.'
        sections.append(("guide", "Guidance", len(entries), band("guide", "Field guide", "Guidance, steps <em>and mistakes.</em>", aside, guide)))

    nums = of("number")
    if nums:
        head = ('<thead><tr><th scope="col"><button type="button" data-sort="n">Number</button></th>'
                '<th scope="col"><button type="button" data-sort="t">What it is</button></th>'
                '<th scope="col"><button type="button" data-sort="c">Support</button></th></tr></thead>')
        table = ('<div class="nx-wrap"><table class="nx" id="n-table">' + head + "<tbody>"
                 + "\n".join(number_row(lib, dom, e, i) for i, e in enumerate(nums)) + "</tbody></table></div>")
        aside = f'{count_of(len(nums), "number")}, each with the date it was true. Choose a column heading to sort by it.'
        sections.append(("numbers", "Key numbers", len(nums), band("numbers", "Key numbers", "The figures, <em>dated.</em>", aside, table)))

    tables = of("table")
    if tables:
        inner = '<div id="t-list">\n' + "\n".join(table_html(lib, dom, e, topic_of(e, "Table")) for e in tables) + "\n      </div>"
        aside = f'{count_of(len(tables), "table")}. Open one; wide ones scroll sideways.'
        sections.append(("tables", "Tables", len(tables), band("tables", "Reference", "Tables to <em>look things up.</em>", aside, inner)))

    lists = of("checklist")
    if lists:
        inner = '<div class="ck-list">\n' + "\n".join(checklist_html(lib, dom, e) for e in lists) + "\n      </div>"
        aside = f'{count_of(len(lists), "checklist")}. Your ticks are remembered in this browser and go nowhere else.'
        sections.append(("checklists", "Checklists", len(lists), band("checklists", "Checklists", "Lists to <em>work through.</em>", aside, inner)))

    terms = sorted(of("term"), key=lambda e: e["title"].lower())
    claims = [c for c in data["claims"]["entries"] if c["domain"] == dom]
    halves = []
    if terms:
        halves.append(
            '<div id="terms"><h2 class="k-h3" id="h-terms">Terms used here</h2>'
            f'<p class="k-small">{count_of(len(terms), "term")}, each defined in the <a class="k-inline" href="{pages.url("glossary")}">glossary</a>.</p>'
            '<ul class="fr-terms">' + "".join(f'<li><a href="{esc(pages.href(e["id"], here))}">{esc(e["title"])}</a></li>' for e in terms) + "</ul></div>"
        )
    if claims:
        halves.append(
            '<div id="claims"><h2 class="k-h3" id="h-claims">Claims about this area</h2>'
            f'<p class="k-small">{count_of(len(claims), "claim")}, each checked on the <a class="k-inline" href="{pages.url("claims")}">claims page</a>.</p>'
            '<ul class="fr-claims">' + "".join(
                f'<li><a href="{esc(pages.href(c["id"], here))}"><span>{esc(c["title"])}</span>'
                f'<span class="verdict {VERDICTS[c["verdict"]][1]}">{esc(VERDICTS[c["verdict"]][0])}</span></a></li>' for c in claims) + "</ul></div>"
        )
    if halves:
        related = ('  <section id="related" class="k-band" aria-label="Terms and claims for this area">\n    <div class="k-wrap fr-two">\n      '
                   + "\n      ".join(halves) + "\n    </div>\n  </section>")
        first = True
        for sid, name, items in (("terms", "Terms", terms), ("claims", "Claims", claims)):
            if items:
                sections.append((sid, name, len(items), related if first else ""))
                first = False

    n_src, src = sources_band(lib, pages)
    if n_src:
        sections.append(("sources", "Sources", n_src, src))
    return sections


def page_claims(lib, data, pages, route):
    """Every claim, with the area switch as one more filter."""
    here = route["slug"]
    claims = data["claims"]["entries"]
    rows = claim_rows(lib, claims, lambda entry_id: pages.href(entry_id, here))
    n_area = Counter(c["domain"] for c in claims)
    n_verdict = Counter(c["verdict"] for c in claims)
    n_tag = Counter(t for c in claims for t in c.get("tags", []))
    controls = (
        '<div class="qx-controls" id="q-controls">' + lens(n_area)
        + '<details class="gx-filters qx-filters" id="q-filters" open><summary>Filters <span id="q-active"></span></summary><div class="gx-rail">'
        + facet("verdict", [(v, VERDICTS[v][0]) for v in VERDICTS if n_verdict[v]], "Verdict", counts=n_verdict)
        + facet("tag", [(t, TAGS[t]) for t in TAGS if n_tag[t]], "Topic", counts=n_tag)
        + people_facets(claims)
        + "</div></details>"
        + '<div class="gx-bar"><label class="k-vh" for="q-q">Search the claims</label>'
          '<input class="k-input gx-q" id="q-q" type="search" placeholder="Search: mechanicals, splits, unclaimed, AI…" autocomplete="off">'
          + CLAIM_SORT + "</div>"
        + '<p class="gx-count" id="q-count" aria-live="polite"></p></div>'
    )
    inner = (controls + '<div id="q-list">' + "\n".join(rows) + "</div>"
             '<p class="gx-empty" id="q-empty" hidden>No claim matches. <button type="button" class="k-linkbtn" data-reset="claims">Clear the filters</button></p>')
    sections = [("claims", "Claims", len(claims), bare_band("claims", "The claims", inner))]
    n_src, src = sources_band(lib, pages)
    if n_src:
        sections.append(("sources", "Sources", n_src, src))
    return sections


def page_glossary(lib, data, pages, route):
    """Every term, A to Z. This is the one place a term is defined, so it shows its sources."""
    terms = [(e, dom) for dom in pages.areas for e in data[dom]["entries"] if e["type"] == "term"]
    terms.sort(key=lambda x: x[0]["title"].lower())
    rows = []
    for e, dom in terms:
        cite = lib.cite_html(dom, e.get("sources", [])).replace('<p class="cite">', '<dd class="cite">').replace("</p>", "</dd>")
        where = terr_label(e.get("territory", []))
        asof = f' <span class="gl-d">as of {esc(date_label(e["as_of"]))}</span>' if e.get("as_of") else ""
        rows.append(f'<div class="gl-item" id="{esc(e["id"])}" data-d="{dom}" data-c="{e["confidence"]}"><dt>{esc(e["title"])}</dt>'
                    f'<dd>{esc(e["take"])} <span class="gl-d">{esc(DOMAINS[dom][0])} · {esc(where)}</span>{asof}</dd>{cite}</div>')
    n_area = Counter(dom for _, dom in terms)
    inner = (lens(n_area)
             + '<div class="gx-bar"><label class="k-vh" for="gl-q">Search the glossary</label>'
               '<input class="k-input gx-q" id="gl-q" type="search" placeholder="Search a term: ISWC, mechanical, PRO, recoupment…" autocomplete="off">'
               '<p class="gx-count" id="gl-count" aria-live="polite"></p></div>'
               '<dl class="gl" id="gl-list">' + "\n".join(rows) + "</dl>"
               '<p class="gx-empty" id="gl-empty" hidden>No term matches. <button type="button" class="k-linkbtn" data-reset="glossary">Clear the search</button></p>')
    sections = [("terms", "Terms", len(terms), bare_band("terms", "The terms", inner))]
    n_src, src = sources_band(lib, pages)
    if n_src:
        sections.append(("sources", "Sources", n_src, src))
    return sections


def page_reference(data, pages, route):
    """An index and nothing more: every key number and every table, each linking to its home."""
    here = route["slug"]
    nums = [(e, dom) for dom in pages.areas for e in data[dom]["entries"] if e["type"] == "number"]
    tables = [(e, dom) for dom in pages.areas for e in data[dom]["entries"] if e["type"] == "table"]
    head = ('<thead><tr><th scope="col"><button type="button" data-sort="t">Number</button></th>'
            '<th scope="col"><button type="button" data-sort="n">Value</button></th>'
            '<th scope="col"><button type="button" data-sort="u">Unit</button></th>'
            '<th scope="col"><button type="button" data-sort="y">As of</button></th>'
            '<th scope="col"><button type="button" data-sort="d">Area</button></th></tr></thead>')
    rows = [
        f'<tr data-d="{dom}" data-n="{e["sort"]}" data-y="{e["as_of"].replace("-", "") if e.get("as_of") else 0}" data-o="{i}">'
        f'<th scope="row"><a href="{esc(pages.href(e["id"], here))}">{esc(e["title"])}</a></th>'
        f'<td class="ix-v">{esc(e["value"])}</td><td class="ix-u">{esc(e.get("unit", ""))}</td>'
        f'<td class="ix-a">{esc(date_label(e["as_of"])) if e.get("as_of") else ""}</td><td class="nx-d">{esc(DOMAINS[dom][0])}</td></tr>'
        for i, (e, dom) in enumerate(nums)
    ]
    table = '<div class="nx-wrap"><table class="nx ix" id="n-table">' + head + "<tbody>" + "\n".join(rows) + "</tbody></table></div>"
    groups = []
    for dom in pages.areas:
        mine = [e for e, d in tables if d == dom]
        if mine:
            groups.append(f'<div><h3 class="fx-label">{esc(DOMAINS[dom][0])}</h3><ul>'
                          + "".join(f'<li><a href="{esc(pages.href(e["id"], here))}">{esc(e["title"])}</a></li>' for e in mine) + "</ul></div>")
    sections = []
    if nums:
        aside = f'{count_of(len(nums), "number")}. Choose a column heading to sort by it; choose a number to read it, with its sources, on its own page.'
        sections.append(("numbers", "Key numbers", len(nums), band("numbers", "Key numbers", "The figures, <em>dated.</em>", aside, table)))
    if tables:
        aside = f'{count_of(len(tables), "table")}. Each opens on the page of its area.'
        sections.append(("tables", "Tables", len(tables), band("tables", "Reference", "Tables to <em>look things up.</em>", aside, '<div class="ix-tables">' + "\n".join(groups) + "</div>")))
    return sections


def load_corrections(pages):
    """content/music/corrections.json, if there is one: dated rows, newest first."""
    f = SRC / "corrections.json"
    if not f.is_file():
        return []
    rows = json.loads(f.read_text(encoding="utf-8"))["corrections"]
    for r in rows:
        missing = [k for k in ("date", "title", "note") if not r.get(k)]
        if missing:
            raise SystemExit(f"corrections.json: a row has no {', '.join(missing)}")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", r["date"]):
            raise SystemExit(f"corrections.json: {r['date']!r} is not a date like 2026-11-14")
        if r.get("entry") and r["entry"] not in pages.home:
            raise SystemExit(f"corrections.json: no entry has the id {r['entry']}")
    return sorted(rows, key=lambda r: r["date"], reverse=True)


def correction_href(r, pages, here):
    return pages.href(r["entry"], here) if r.get("entry") else r.get("href", "")


LOG_SHOWN = 6


def page_sources(lib, pages, route, corrections):
    """How entries are graded, the corrections log, and every source. Call inside lib.counting()
    with the citations of every page added up, so each source shows how often it is cited."""
    here = route["slug"]
    keys = sorted((k for k in lib.by_id if lib.uses[k]), key=lambda k: (lib.label[k].lower(), k))
    listing = (
        '<div class="gx-bar"><label class="k-vh" for="src-q">Search the sources</label>'
        '<input class="k-input gx-q" id="src-q" type="search" placeholder="Search: a body, a court, a year, a title…" autocomplete="off">'
        '<p class="gx-count" id="src-count" aria-live="polite"></p></div>'
        '<div id="src-wrap"><ol class="sources" id="src-list">' + "\n".join(lib.citation(k) for k in keys) + "</ol></div>"
        '<p class="gx-empty" id="src-empty" hidden>No source matches. <button type="button" class="k-linkbtn" data-reset="sources">Clear the search</button></p>'
    )
    sections = [("graded", "Grading", None, band("graded", "Grading", "How entries <em>are graded.</em>",
                 "Each entry records one of four grades and shows one of two labels. An entry takes the grade of its weakest load-bearing source.",
                 legend_html()))]
    log = []
    for r in corrections:
        href = correction_href(r, pages, here)
        title = f'<a href="{esc(href)}">{esc(r["title"])}</a>' if href else esc(r["title"])
        log.append(f'<li><time datetime="{esc(r["date"])}">{esc(date_label(r["date"]))}</time>'
                   f'<div><p class="fr-log-t">{title}</p><p>{esc(r["note"])}</p></div></li>')
    if log:
        shown, rest = log[:LOG_SHOWN], log[LOG_SHOWN:]
        body = '<ul class="fr-log">' + "\n".join(shown) + "</ul>"
        if rest:
            body += (f'<details class="fr-log-more"><summary>All {len(log)} corrections</summary>'
                     '<ul class="fr-log">' + "\n".join(rest) + "</ul></details>")
        sections.append(("corrections", "Corrections", len(log), band("corrections", "Corrections", "What has <em>been corrected.</em>",
                                                                       "What changed after an entry was published, and when. Newest first.", body)))
    if any(lib.by_id[k].get("type") == "article" for k in keys):
        listing = f'<p class="k-small fr-note">{esc(ARTICLE_NOTE)}</p>' + listing
    aside = "Primary texts first where they exist: the statute, the regulation, the ruling, the collecting body's own page. Search by body, court, year or title."
    sections.append(("sources", "All sources", len(keys), band("sources", "Sources", f"All {count_of(len(keys), 'source')}, <em>A to Z.</em>", aside, listing)))
    return sections


def nav_groups(pages):
    """The pages under /music/ as the hub and the navigation group them: [(name, [route])]."""
    by = {route_key(r): r for r in pages.routes}
    groups = [(f"{letter}. {name}", [by[d] for d in doms if d in by]) for letter, name, doms in GROUPS]
    groups.append(("Tools and data", [by[k] for k in TOOL_KINDS if k in by]))
    groups.append(("Reference", [by[k] for k in REF_KINDS if k in by]))
    return [(name, routes) for name, routes in groups if routes]


def subnav_links(routes, slug):
    return "".join(f'<li><a href="/music/{r["slug"]}"' + (' class="on" aria-current="page"' if r["slug"] == slug else "")
                   + f">{esc(route_label(r))}</a></li>" for r in routes)


def subnav_html(pages, slug):
    out = []
    for i, (name, routes) in enumerate(nav_groups(pages), 1):
        out.append(f'<div class="fr-nav-g"><p class="fr-nav-l" id="fr-nav-g{i}">{esc(name)}</p><ul aria-labelledby="fr-nav-g{i}">{subnav_links(routes, slug)}</ul></div>')
    return "\n    ".join(out)


def subnav_here_html(pages, slug):
    for name, routes in nav_groups(pages):
        if any(r["slug"] == slug for r in routes):
            return (f'<div class="fr-nav-here"><p class="fr-nav-l">{esc(name)}</p>'
                    f'<ul aria-label="{esc(name)} pages">{subnav_links(routes, slug)}</ul></div>')
    return ""


def ids_in(text):
    return re.findall(r'\sid="([^"]+)"', text)


def fill_numbers(text, numbers, where):
    def one(m):
        if m.group(1) not in numbers:
            raise SystemExit(f"{where} uses {m.group(0)}, which the build does not know")
        return str(numbers[m.group(1)])
    return re.sub(r"\{\{([^}]+)\}\}", one, text)


def render_sub(template, route, pages, sections, numbers, meta, head=""):
    """Pour one page into the shell. numbers fills {{n:…}} and {{updated}} in the route's own text.
    head is more for <head> (the claimable page's Dataset markup). A page that holds one of
    KiteSink's tools (calculator, checklist, identifier checker, split sheet) also loads /music-tools.js."""
    def filled(text):
        return fill_numbers(text, numbers, f"routes.json: {route['slug']}")

    slug, label = route["slug"], route_label(route)
    crumbs = [("Home", SITE + "/"), ("Music", SITE + "/music"), (label, f"{SITE}/music/{slug}")]
    breadcrumb = json.dumps({
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [{"@type": "ListItem", "position": i, "name": name, "item": url} for i, (name, url) in enumerate(crumbs, 1)],
    }, ensure_ascii=False).replace("</", "<\\/")
    crumb = f'<li><a href="/">Home</a></li><li><a href="/music">Music</a></li><li aria-current="page">{esc(label)}</li>'
    jump = ""
    if len(sections) > 1 and route["kind"] not in ("claims", "glossary"):
        jump = ('<nav class="fr-jump" aria-label="On this page">'
                + "".join(f'<a href="#{sid}">{esc(name)}' + (f" <b>{n}</b>" if n is not None else "") + "</a>" for sid, name, n, _ in sections) + "</nav>")
    fills = {
        "slug": slug, "title": esc(filled(route["title"])), "description": esc(filled(route["description"])),
        "h1": filled(route["h1"]), "lead": esc(filled(route["lead"])), "breadcrumb": breadcrumb, "crumb": crumb,
        "subnav": subnav_html(pages, slug), "subnav_here": subnav_here_html(pages, slug), "n:pages": str(len(pages.routes)),
        "areas": " ".join(pages.areas), "scope": esc(meta["scope_line"]),
        "jump": jump, "body": "\n\n".join(html for _, _, _, html in sections if html),
        "head": head, "foot": "",
    }
    if any(hook in fills["body"] for hook in ("data-rate-calc", "data-unclaimed", "data-id-check", "data-split-sheet")):
        fills["foot"] = '<script src="/music-tools.js?v=2027.14"></script>'

    def fill(m):
        if m.group(1) not in fills:
            raise SystemExit(f"content/music/templates/sub.html uses {m.group(0)}, which the build does not fill")
        return fills[m.group(1)]
    page = re.sub(r"\{\{([a-z0-9:_-]+)\}\}", fill, template)
    unused = [k for k in fills if "{{" + k + "}}" not in template]
    if unused:
        raise SystemExit("content/music/templates/sub.html has no {{" + "}}, {{".join(unused) + "}}")
    return page


def build_subpages(lib, meta, data, numbers, pages):
    """Every page under /music/ and the twins that belong to no one area. Returns ({path: text}, {slug: html})."""
    corrections = load_corrections(pages)
    template = config("templates/sub.html").read_text(encoding="utf-8")
    built, total = {}, Counter()
    for r in pages.routes:
        if r["kind"] == "sources":
            continue
        with lib.counting(Counter()) as tally:
            if r["kind"] == "area":
                sections = page_area(lib, data, pages, r)
            elif r["kind"] == "claims":
                sections = page_claims(lib, data, pages, r)
            elif r["kind"] == "glossary":
                sections = page_glossary(lib, data, pages, r)
            elif r["kind"] == "claimable":
                sections = page_claimable(lib, data, pages, r)
            elif r["kind"] == "tools":
                sections = page_tools(lib, data, pages, r)
            else:
                sections = page_reference(data, pages, r)
        total.update(tally)
        head = dataset_jsonld(data["claimable"], r, meta) if r["kind"] == "claimable" else ""
        built[r["slug"]] = render_sub(template, r, pages, sections, numbers, meta, head)
    unused = [k for k in lib.by_id if not total[k]]
    if unused:
        raise SystemExit("sources no page cites: " + ", ".join(unused))
    if pages.has("sources"):
        r = next(r for r in pages.routes if r["kind"] == "sources")
        with lib.counting(total):
            built[r["slug"]] = render_sub(template, r, pages, page_sources(lib, pages, r, corrections), numbers, meta)
    check_subpages(built, pages, lib)

    out = OrderedDict((PUBLIC / "music" / f"{r['slug']}.html", built[r["slug"]]) for r in pages.routes)
    if pages.has("glossary"):
        out[PUBLIC / "music" / f"{pages.slug['glossary']}.md"] = md_glossary(lib, meta, data, pages)
    if pages.has("reference"):
        out[PUBLIC / "music" / f"{pages.slug['reference']}.md"] = md_reference(meta, data, pages)
    if pages.has("sources"):
        with lib.counting(total):
            out[PUBLIC / "music" / f"{pages.slug['sources']}.md"] = md_sources(lib, meta, pages, corrections)
    if pages.has("claimable"):
        out[PUBLIC / "music" / f"{pages.slug['claimable']}.md"] = md_claimable(lib, meta, data, pages)
        out[PUBLIC / "music" / "claimable.json"] = claimable_public(lib, data["claimable"], meta)
    if pages.has("tools"):
        out[PUBLIC / "music" / f"{pages.slug['tools']}.md"] = md_tools(lib, meta, data, pages)
    return out, built, total


def check_subpages(built, pages, lib):
    """The one-home rule: every entry is on its home page and no other, every source is on the
    sources page, every link from one page to another lands on something, and no page shows a
    source's `support` text."""
    ids = {slug: Counter(ids_in(text)) for slug, text in built.items()}
    problems = []
    for slug, found in ids.items():
        problems += [f"/music/{slug}: the id {i} is used {n} times" for i, n in found.items() if n > 1]
    for entry_id, home in pages.home.items():
        on = [slug for slug, found in ids.items() if entry_id in found]
        if on != [home]:
            problems.append(f"{entry_id} belongs on /music/{home} and nowhere else; it is on {', '.join(on) or 'no page'}")
    if pages.has("sources"):
        all_sources = ids[pages.slug["sources"]]
        problems += [f"/music/{pages.slug['sources']} is missing the source {k}" for k in lib.by_id if "src-" + k not in all_sources]
    supports = [s["support"] for s in lib.by_id.values() if len(s.get("support", "")) >= 24]
    for slug, text in built.items():
        for target, frag in set(re.findall(r'href="(/music/[a-z0-9-]+)?#([^"]+)"', text)):
            where = target[len("/music/"):] if target else slug
            if where not in ids:
                problems.append(f"/music/{slug} links to {target}, which is not a page")
            elif frag not in ids[where]:
                problems.append(f"/music/{slug} links to {target}#{frag}, and nothing there has that id")
        linked = set(re.findall(r'href="/music/([a-z0-9-]+)"', text))
        problems += [f"/music/{slug} has no link to /music/{r['slug']}" for r in pages.routes if r["slug"] not in linked]
        if 'href="/music"' not in text:
            problems.append(f"/music/{slug} has no link back to /music")
        problems += [f"/music/{slug} shows a source's support text" for s in supports if esc(s) in text or s in text]
    if problems:
        raise SystemExit("the pages under /music/ break the one-home rule:\n  " + "\n  ".join(problems))


SEARCH_KINDS = OrderedDict([
    ("note", "Guidance"), ("mistake", "Mistake"), ("step", "Step"), ("number", "Number"), ("table", "Table"),
    ("checklist", "Checklist"), ("term", "Term"), ("claim", "Claim"),
])


def search_index(data, pages):
    """What the hub's search box reads, loaded when the box is first used. One row per entry:
    [id, page, kind, area, title, short answer] and, for a number its value, for a claim its
    verdict. page, kind and area are positions in the three lists at the top."""
    slugs, kinds, areas = [r["slug"] for r in pages.routes], list(SEARCH_KINDS), list(DOMAINS)
    rows = []
    for dom in pages.areas:
        for e in data[dom]["entries"]:
            row = [e["id"], slugs.index(pages.home[e["id"]]), kinds.index(e["type"]), areas.index(dom), e["title"], e["take"]]
            if e["type"] == "number":
                row.append(f'{e["value"]} {e.get("unit", "")}'.strip())
            rows.append(row)
    for c in data["claims"]["entries"]:
        rows.append([c["id"], slugs.index(pages.home[c["id"]]), kinds.index("claim"), areas.index(c["domain"]), c["title"], c["take"], VERDICTS[c["verdict"]][0]])
    return {"pages": slugs, "kinds": list(SEARCH_KINDS.values()), "areas": [DOMAINS[d][0] for d in DOMAINS], "rows": rows}


# ----------------------------------------------------------------- the data pages and KiteSink's tools
# content/music/DATA-PAGES.md: /music/claimable (claimable.json), /music/tools (tools.json), the
# mechanical rate calculator (rates.json) and the unclaimed-money checklist (claimable.json again).
# The two tools run in /music-tools.js from data embedded here; the HTML around them is what a
# reader without JavaScript gets: the yearly rates as a table, and the full checklist.
def embed(obj, cls):
    """Data for /music-tools.js, inside the tool's own markup. '</' is escaped so it cannot end the script."""
    return f'<script type="application/json" class="{cls}">' + json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/") + "</script>"


def cite_pairs(lib, file, keys):
    """[label, #src-…] for each source, for a citation the script writes. Counted by the static table beside it."""
    return [[lib.label[k], "#src-" + k] for k in (lib.alias[(file, key)] for key in keys)]


def bare_cite(lib, file, keys):
    """The citation links without their paragraph, for a table cell or a sentence."""
    return lib.cite_html(file, keys).replace('<p class="cite">', "").replace("</p>", "")


def cents_label(v):
    """13.1 -> '13.1', 24.0 -> '24', 12.40 -> '12.4'."""
    return f"{v:.2f}".rstrip("0").rstrip(".")


def terr_options(items):
    return [t for t in TERRITORY if any(t in i.get("territory", []) for i in items)]


def reader_options(items):
    return [r for r in READERS if any(r in i.get("readers", []) for i in items)]


CALC_METHOD = ("For physical copies and permanent downloads made and distributed in the US. Per copy, the rate is the larger "
               "of the per-work rate and the per-minute rate times the playing time, with a part minute counted as a whole "
               "one (37 CFR 385.11). This is the statutory rate; a licence agreed directly with the publisher can set a different one.")
STREAM_NOTE = ("Streaming mechanicals are not a per-stream rate. Under 37 CFR 385.21 a service works out a royalty pool for each "
               "offering, the larger of a share of its revenue and other measures the rule sets, takes off what it pays for "
               "performance rights, and divides the rest among the works by their share of plays.")


def calculator_html(lib, rates):
    """The mechanical rate calculator: the form (hidden until /music-tools.js shows it), the method,
    the ringtone note, the streaming illustration, and the yearly rates as a table."""
    rows = sorted(rates["physical"], key=lambda r: r["year"])
    stream = OrderedDict((r["year"], r) for r in sorted(rates.get("streaming_revenue_percent", []), key=lambda r: r["year"]))
    latest = rows[-1]["year"]
    asof = date_label(rates["as_of"])
    payload = {
        "as_of": rates["as_of"], "as_of_label": asof,
        "physical": [{"year": r["year"], "per_work_cents": r["per_work_cents"], "per_minute_cents": r["per_minute_cents"],
                      "cite": cite_pairs(lib, "rates", r["sources"])} for r in rows],
        "streaming_revenue_percent": [{"year": y, "percent": r["percent"], "cite": cite_pairs(lib, "rates", r["sources"])} for y, r in stream.items()],
    }
    head = ('<thead><tr><th scope="col">Year</th><th scope="col">Per work</th><th scope="col">Per minute or part minute</th>'
            + ('<th scope="col">Streaming, first prong (illustration)</th>' if stream else "") + '<th scope="col">Sources</th></tr></thead>')
    body = []
    for r in rows:
        keys = list(r["sources"]) + [k for k in (stream[r["year"]]["sources"] if r["year"] in stream else []) if k not in r["sources"]]
        cells = (f'<th scope="row">{r["year"]}</th><td>{cents_label(r["per_work_cents"])} cents</td><td>{cents_label(r["per_minute_cents"])} cents</td>'
                 + ((f'<td>{esc(stream[r["year"]]["percent"])}% of revenue</td>' if r["year"] in stream else "<td>Not given</td>") if stream else "")
                 + "<td>" + bare_cite(lib, "rates", keys) + "</td>")
        body.append(f"<tr>{cells}</tr>")
    years = "".join(f'<option value="{r["year"]}"' + (" selected" if r["year"] == latest else "") + f'>{r["year"]}</option>' for r in rows)
    form = (
        '<form class="rc-form" hidden><div class="rc-in">'
        f'<label class="k-field" for="rc-year"><span class="k-label">Year</span><select class="k-select" id="rc-year" name="year">{years}</select></label>'
        '<fieldset class="k-field rc-time"><legend class="k-label">Playing time</legend><div class="rc-pair">'
        '<span class="rc-unit"><input class="k-input" id="rc-min" name="min" type="number" inputmode="numeric" min="0" max="999" step="1" value="3" aria-label="Playing time, minutes"><span aria-hidden="true">min</span></span>'
        '<span class="rc-unit"><input class="k-input" id="rc-sec" name="sec" type="number" inputmode="numeric" min="0" max="59" step="1" value="30" aria-label="Playing time, seconds"><span aria-hidden="true">sec</span></span>'
        '</div></fieldset>'
        '<label class="k-field" for="rc-copies"><span class="k-label">Copies</span><input class="k-input" id="rc-copies" name="copies" type="number" inputmode="numeric" min="1" step="1" value="1000"></label>'
        '</div>'
        '<div class="rc-out" aria-live="polite">'
        '<div class="rc-fig"><p class="k-label">Per copy</p><p class="rc-stat"><span data-o="cents">–</span><small>cents</small></p></div>'
        '<div class="rc-fig"><p class="k-label">Total</p><p class="rc-stat"><span data-o="total">–</span></p><p class="k-small" data-o="total-note"></p></div>'
        '<p class="rc-rule" data-o="rule"></p><p class="rc-src" data-o="src"></p>'
        '</div></form>'
    )
    ring = rates.get("ringtone_cents")
    ring_html = (f'<p class="rc-note"><b>Ringtones.</b> {cents_label(ring["value"])} cents per ringtone, whatever its length (37 CFR 385.11). '
                 + lib.cite_html("rates", ring["sources"]).replace('<p class="cite">', '<span class="cite">').replace("</p>", "</span>") + "</p>") if ring else ""
    stream_html = ""
    if stream:
        last = stream[next(reversed(stream))]
        stream_html = (
            '<div class="rc-stream"><p class="k-label">Streaming: an illustration, not a rate</p>'
            f'<p>{esc(STREAM_NOTE)}</p>'
            f'<p data-o="stream">In {last["year"]} the first prong is <b>{esc(last["percent"])}%</b> of the service\'s revenue for the offering. '
            + " · ".join(f'<a href="{esc(h)}">{esc(l)}</a>' for l, h in cite_pairs(lib, "rates", last["sources"])) + "</p></div>"
        )
    table = (f'<details class="rc-table" open><summary>The yearly rates, as of {esc(asof)}</summary>'
             f'<div class="rt-scroll" tabindex="0" role="region" aria-label="Mechanical rates by year"><table><caption class="k-vh">US mechanical rates by year, as of {esc(asof)}</caption>'
             + head + "<tbody>" + "".join(body) + "</tbody></table></div></details>")
    return (f'<div class="rc" id="rate-calc" data-rate-calc>{embed(payload, "rc-data")}'
            f'<p class="rc-method">{esc(CALC_METHOD)} <span class="rc-asof">Rates as of {esc(asof)}.</span></p>'
            + form + table + ring_html + stream_html + "</div>")


def calculator_band(lib, rates):
    aside = "The US statutory rate per copy for a year, a playing time and a number of copies. Not legal advice."
    return ("calculator", "Rate calculator", None,
            band("calculator", "Calculator", "Mechanical rates, <em>per copy.</em>", aside, calculator_html(lib, rates)))


def unclaimed_html(claimable, pages, here):
    """The unclaimed-money checklist: every claimable row as a place to check, with its link, what to
    look for and the cost. /music-tools.js narrows it by reader and territory and remembers the ticks;
    without it, the full list shows and the boxes can still be ticked (not remembered)."""
    rows = claimable["rows"]
    payload = {"rows": [{"id": r["id"], "readers": r["readers"], "territory": r["territory"], "money_type": r["money_type"]} for r in rows]}
    readers = "".join(f'<option value="{r}">{esc(READERS[r][0])}</option>' for r in reader_options(rows))
    terrs = "".join(f'<option value="{t}">{esc(TERRITORY[t])}</option>' for t in terr_options(rows) if t != "INTL")
    pick = (
        '<div class="uc-pick" hidden>'
        f'<label class="k-field" for="uc-reader"><span class="k-label">I am</span><select class="k-select" id="uc-reader" name="reader"><option value="">Anyone</option>{readers}</select></label>'
        f'<label class="k-field" for="uc-territory"><span class="k-label">My music earns in</span><select class="k-select" id="uc-territory" name="territory"><option value="">Anywhere</option>{terrs}</select></label>'
        '</div>'
    )
    items = []
    for r in rows:
        details = f'/music/{pages.slug["claimable"]}#{r["id"]}'
        items.append(
            f'<li class="uc-item" data-id="{esc(r["id"])}">'
            f'<label class="ck-item"><input type="checkbox" data-id="{esc(r["id"])}"><span><b>{esc(r["holder"])}</b>: {esc(r["pot"])}</span></label>'
            f'<dl class="uc-facts"><div><dt>Where</dt><dd>{esc(terr_label(r["territory"]))} · {esc(MONEY[r["money_type"]])}</dd></div>'
            f'<div><dt>What to look for</dt><dd>{esc(r["how_to_claim"])}</dd></div>'
            f'<div><dt>Cost</dt><dd>{esc(r["cost"])}</dd></div></dl>'
            f'<p class="uc-go"><a class="k-btn k-btn--ghost k-btn--sm" href="{esc(r["link"])}" target="_blank" rel="noopener">{esc(r["link_label"])}'
            f'<span class="k-vh"> at {esc(r["holder"])} (opens in a new tab)</span></a>'
            f'<a class="k-inline" href="{esc(details)}">Who can claim, the rule and sources</a></p></li>'
        )
    n = len(rows)
    return (
        f'<div class="uc" id="unclaimed-checklist" data-unclaimed>{embed(payload, "uc-data")}'
        + pick
        + f'<p class="uc-count"><b class="uc-n">0</b> of <span class="uc-of">{n}</span> checked '
          '<button type="button" class="k-linkbtn uc-clear">Clear ticks</button></p>'
        # FUTURE: an "Email me this checklist" gate goes here, beside the count. It is not built: there is
        # no email capture on this site. When it is, it needs the owner's sign-off on what is stored and why.
        + '<!-- FUTURE: "Email me this checklist" gate (not built; no email capture). -->'
        + '<ol class="uc-list">' + "".join(items) + "</ol>"
        + '<p class="gx-empty uc-empty" hidden>Nothing listed for that choice yet. Choose Anyone or Anywhere to see every place.</p>'
        + '<p class="k-small uc-keep">Your ticks are remembered in this browser and go nowhere else.</p></div>'
    )


def unclaimed_band(claimable, pages, here):
    n = len(claimable["rows"])
    aside = (f'{count_of(n, "place")} where money can sit unclaimed. Choose who you are and where your music earns, then tick each one off. '
             f'<a class="k-inline" href="/music/{pages.slug["claimable"]}">The full table, with sources</a>.')
    return ("checklist", "Checklist", n,
            band("checklist", "Checklist", "Where to look for <em>unclaimed money.</em>", aside, unclaimed_html(claimable, pages, here)))


def claimable_row(lib, r, i):
    meta = " · ".join([MONEY[r["money_type"]], terr_label(r["territory"])])
    facts = "".join(f'<div><dt>{esc(label)}</dt><dd>{esc(r[key])}</dd></div>' for key, label in
                    (("who_can_claim", "Who can claim"), ("how_to_claim", "How to claim"), ("rule", "If nobody claims"), ("cost", "Cost")))
    return (
        f'<article class="cl" id="{esc(r["id"])}" data-r="{esc(" ".join(r["readers"]))}" data-tr="{esc(" ".join(r["territory"]))}" '
        f'data-mt="{esc(r["money_type"])}" data-c="{r["confidence"]}" data-y="{r["as_of"].replace("-", "")}" data-o="{i}">'
        f'<p class="g-meta">{esc(meta)}</p><h3 class="cl-holder">{esc(r["holder"])}</h3><p class="cl-pot">{esc(r["pot"])}</p>'
        f'<dl class="cl-facts">{facts}</dl>'
        f'<p class="cl-go"><a class="k-btn k-btn--sm" href="{esc(r["link"])}" target="_blank" rel="noopener">{esc(r["link_label"])}'
        f'<span class="k-vh"> at {esc(r["holder"])} (opens in a new tab)</span></a>{grade_tag(r["confidence"])}{asof_tag(r)}</p>'
        + facts_html(r) + lib.cite_html("claimable", r["sources"]) + "</article>"
    )


CLAIMABLE_SCOPE = ("Covers the holders whose own published pages or the law could be read and checked, in the territories this guide "
                   "covers. A holder not listed may still hold money for you. Each row is dated: rules and amounts change, so check the "
                   "holder's page before you act.")


def page_claimable(lib, data, pages, route):
    rows = data["claimable"]["rows"]
    n_r = Counter(x for r in rows for x in r["readers"])
    named = terr_options(rows)
    n_t = Counter({t: sum(1 for r in rows if in_territory(r, t)) for t in TERRITORY})
    n_m = Counter(r["money_type"] for r in rows)
    rail = ('<div class="gx-rail" id="cl-rail">'
            + facet("reader", [(r, READERS[r][0]) for r in READERS if n_r[r]], "Reader", counts=n_r)
            + facet("territory", [(t, TERRITORY[t]) for t in named], "Territory", counts=n_t,
                    note=INTL_NOTE if "INTL" in named and len(named) > 1 else "")
            + facet("money", [(m, MONEY[m]) for m in MONEY if n_m[m]], "Money type", counts=n_m) + "</div>")
    latest = max(r["as_of"] for r in rows)
    about = (f'<p class="k-small fr-note" id="about-data">{esc(CLAIMABLE_SCOPE)} This table is KiteSink\'s own summary of each holder\'s '
             'published pages and the law, not a copy of them, and not legal advice. The same rows as data: '
             f'<a class="k-inline" href="/music/{route["slug"]}.json">{route["slug"]}.json</a>; as plain text: '
             f'<a class="k-inline" href="/music/{route["slug"]}.md">{route["slug"]}.md</a>. Newest row checked {esc(date_label(latest))}.</p>')
    inner = (
        about
        + '<div class="gx"><details class="gx-filters" id="cl-filters" open><summary>Filters <span id="cl-active"></span></summary>' + rail + "</details>"
        '<div class="gx-main"><div class="gx-bar"><label class="k-vh" for="cl-q">Search the claimable royalties</label>'
        '<input class="k-input gx-q" id="cl-q" type="search" placeholder="Search: a holder, a country, a kind of money…" autocomplete="off"></div>'
        '<p class="gx-count" id="cl-count" aria-live="polite"></p>'
        '<div class="cl-list" id="cl-list">' + "\n".join(claimable_row(lib, r, i) for i, r in enumerate(rows)) + "</div>"
        '<p class="gx-empty" id="cl-empty" hidden>Nothing matches those filters. <button type="button" class="k-linkbtn" data-reset="claimable">Clear them</button></p>'
        "</div></div>"
    )
    aside = f'{count_of(len(rows), "place")}. Narrow by who you are, where your music earns, or the kind of money.'
    sections = [("rows", "The table", len(rows), band("rows", "Claimable", "Where money <em>is held.</em>", aside, inner))]
    if pages.has("tools"):
        sections.append(("tools", "Checklist", None, bare_band("tools", "The checklist",
            f'<p class="k-small">To work through these one by one, ticking each off, use the '
            f'<a class="k-inline" href="/music/{pages.slug["tools"]}#checklist">unclaimed-money checklist</a>.</p>')))
    n_src, src = sources_band(lib, pages)
    if n_src:
        sections.append(("sources", "Sources", n_src, src))
    return sections


# ----------------------------------------------------------------- the identifier checker and the split sheet
# Both run in /music-tools.js with no data file. Their copy and sources live here, not in content/music/,
# because they describe the tools rather than make field-guide entries. Every source was opened on TOOLS_OPENED.
TOOLS_OPENED = "20 November 2026"
ID_FORMATS = [
    {"id": "isrc", "name": "ISRC", "long": "International Standard Recording Code",
     "what": "A sound recording or music video. Each different recording has its own.",
     "form": "12 characters: a 5-character prefix (2 letters, then 3 letters or digits), 2 digits for the year the code was "
             "assigned, and a 5-digit number. Written for people as ISRC AA-6Q7-20-00047. The word ISRC, spaces and hyphens are "
             "not part of the code, and lower case is read as capitals.",
     "check": "None. ISRC has no check digit, so a checker can only test the form.",
     "lookup": ("ISRC Search (IFPI)", "https://isrcsearch.ifpi.org/"),
     "sources": [("IFPI: ISRC Handbook, 4th edition (2021), sections 3.3 and 5", "https://www.ifpi.org/wp-content/uploads/2021/02/ISRC_Handbook.pdf"),
                 ("IFPI: ISRC structure", "https://isrc.ifpi.org/isrc-standard/isrc-structure"),
                 ("International ISRC Agency: Bulletin 2015/01, validating an ISRC", "https://isrc.ifpi.org/images/downloads/Bulletin_2015-01_-_Validating_ISRC_Codes.pdf")]},
    {"id": "iswc", "name": "ISWC", "long": "International Standard Musical Work Code",
     "what": "A musical work: the song as written, not any one recording of it.",
     "form": "The letter T, a 9-digit work number and one check digit (ISO 15707:2022). Usually written ISWC T-034.524.680-1; "
             "the hyphens and dots are only there to help reading.",
     "check": "ISO 15707:2022 says the check digit is a weighted modulus 10 and sets out the formula in an annex its public preview "
              "leaves out. The checker uses the formula in the ISO committee's 1999 papers: 1 plus each work digit times its position "
              "(1 to 9), and the check digit makes the total a multiple of 10. It gives the standard's own example, so a pass reads "
              "“consistent with the published formula”.",
     "lookup": ("ISWC-Network (CISAC)", "https://iswcnet.cisac.org/"),
     "sources": [("ISO 15707:2022, clause 4 (preview)", "https://cdn.standards.iteh.ai/samples/83125/8adf68d27507472b892f3370f710813e/ISO-15707-2022.pdf"),
                 ("ISWC International Agency: the ISWC", "https://www.iswc.org/iswc"),
                 ("ISO/TC 46/SC 9 N 268 (1999): the check digit formula", "https://groups.niso.org/higherlogic/ws/public/download/2544/sc9n268.pdf")]},
    {"id": "isni", "name": "ISNI", "long": "International Standard Name Identifier",
     "what": "The public identity of a person or organisation, such as a performer, a writer or a label. A pseudonym can have its own.",
     "form": "16 characters: 15 digits and a check character, which is a digit or X. Written ISNI 0000 0001 2124 1960; the word "
             "ISNI and the spaces are not part of it.",
     "check": "The check character comes from the first 15 digits by the ISO/IEC 7064 MOD 11-2 method (ISO 27729, Annex A). "
              "X stands for 10.",
     "lookup": ("ISNI search", "https://isni.org/page/search-database/"),
     "sources": [("ISO 27729:2024, clause 4 and Annex A (preview)", "https://cdn.standards.iteh.ai/samples/87177/3bea4cd1719644159883964978cc57fa/ISO-27729-2024.pdf"),
                 ("ISNI: FAQs", "https://isni.org/page/faqs/"),
                 ("IANA: ISNI namespace registration", "https://www.iana.org/assignments/urn-namespaces/urn-formal/isni")]},
    {"id": "ipi", "name": "IPI", "long": "Interested Party Information",
     "what": "A writer or publisher in the IPI system the CISAC societies share. Each name has an IPI name number; the IPI base "
             "number ties all of one party's names together.",
     "form": "Name number: 11 digits. An older 9-digit number is written with two leading zeros. Base number: usually written "
             "I-NNNNNNNNN-C, the letter I, nine digits and a final digit.",
     "check": "No check-digit rule is published for either, so the checker tests the form only. A number in the right form may still be wrong.",
     "lookup": None,
     "sources": [("SUISA: What is the IPI number? (17 April 2025)", "https://blog.suisa.ch/en/what-is-the-ipi-number/"),
                 ("Harry Fox Agency: What is an IPI number?", "https://help.harryfox.com/what-is-an-ipi-number"),
                 ("CISAC: IPI", "https://www.cisac.org/services/information-services/ipi"),
                 ("Wikipedia: Interested Parties Information (the base number pattern; a secondary source)", "https://en.wikipedia.org/wiki/Interested_Parties_Information")]},
]
ID_EXAMPLES = [("T-034.524.680-1", "ISWC T-034.524.680-1", "the ISO 15707 example"),
               ("ISNI 1422 4586 3573 0476", "ISNI 1422 4586 3573 0476", "the ISO 27729 example"),
               ("ISRC AA-6Q7-20-00047", "ISRC AA-6Q7-20-00047", "the ISRC Handbook's made-up example")]
ID_METHOD = ("Paste or type one identifier. The checker says what kind it is, whether it is in the right form, whether the check "
             "digit adds up where the standard has one, and gives the form to store and the form to print. A code can pass every "
             "check and still belong to another song or person, so look it up before you rely on it. Nothing you type is sent "
             "anywhere or kept.")


def opened_links(pairs):
    return " · ".join(f'<a href="{esc(u)}">{esc(l)}</a>' for l, u in pairs) + f", opened {TOOLS_OPENED}"


def identifier_html():
    """The identifier checker: the form (hidden until /music-tools.js shows it) and, for every reader, the four formats
    with their sources. With JavaScript the formats fold away under their summary."""
    tries = " ".join(f'<button type="button" class="k-linkbtn" data-try="{esc(v)}" title="{esc(why)}">{esc(label)}</button>' for v, label, why in ID_EXAMPLES)
    form = ('<form class="idc-form" hidden><div class="idc-row">'
            '<label class="k-field idc-field" for="idc-q"><span class="k-label">Identifier</span>'
            '<input class="k-input idc-q" id="idc-q" name="q" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" '
            'placeholder="e.g. T-034.524.680-1"></label><button class="k-btn idc-go" type="submit">Check</button></div>'
            f'<p class="k-small idc-try">Or try an example from the standards: {tries}</p></form>'
            '<div class="idc-out" aria-live="polite" hidden></div>')
    fmts = []
    for f in ID_FORMATS:
        lookup = (f'<a class="k-inline" href="{esc(f["lookup"][1])}">{esc(f["lookup"][0])}</a>' if f["lookup"]
                  else "Ask your PRO or society for the IPI numbers they hold for you.")
        rows = "".join(f'<div><dt>{label}</dt><dd>{body}</dd></div>' for label, body in (
            ("Identifies", esc(f["what"])), ("Form", esc(f["form"])), ("Check digit", esc(f["check"])), ("Look it up", lookup)))
        fmts.append(f'<section class="idc-fmt" id="idc-{f["id"]}" aria-labelledby="idc-h-{f["id"]}"><h3 class="idc-fh" id="idc-h-{f["id"]}">'
                    f'{esc(f["name"])} <span>{esc(f["long"])}</span></h3><dl class="idc-fdl">{rows}</dl>'
                    f'<p class="cite idc-src">Sources: {opened_links(f["sources"])}.</p></section>')
    formats = ('<details class="idc-formats" open><summary>The four formats, and where each rule comes from</summary>'
               '<div class="idc-fmts">' + "".join(fmts) + "</div></details>")
    return (f'<div class="idc" id="id-check" data-id-check><p class="rc-method">{esc(ID_METHOD)}</p>' + form + formats + "</div>")


def identifier_band():
    aside = "ISRC, ISWC, ISNI and IPI: what each one identifies, whether a code is well formed, and where to look it up."
    return ("identifiers", "Identifier checker", None,
            band("identifiers", "Identifiers", "Check a code <em>before you send it.</em>", aside, identifier_html()))


SPLIT_NOTE = ("A split sheet records what the writers of a song agreed: who wrote it and each writer's share. It is not a "
              "publishing contract. For anything beyond recording the split, get a music lawyer.")
SPLIT_HOW = ("Fill it in together, check that the shares make exactly 100 percent, then print it and have every writer sign and "
             "date it. Give every writer a copy.")
SPLIT_OFF = ("The generator needs JavaScript. A split sheet can also be written by hand: the song title and the date; any other "
             "titles and the recording artist; then for each writer their name, role (lyrics, music or both), PRO or society, IPI "
             "number, publisher and share, with the shares adding up to 100 percent; and a line for each writer to sign and date.")
SPLIT_SHARES = ("Shares are percentages of the song, to two decimal places, and must add up to exactly 100. "
                "Split evenly gives three writers 33.34, 33.33 and 33.33.")


def split_html():
    """The split-sheet generator. The form and the preview are hidden until /music-tools.js shows them; without it the
    reader gets what a split sheet holds. The writer rows are drawn by the script."""
    def field(name, label, extra="", typ="text", ph=""):
        return (f'<label class="k-field ss-f ss-f--{name}" for="ss-{name}"><span class="k-label">{label}</span>'
                f'<input class="k-input" id="ss-{name}" name="{name}" type="{typ}" autocomplete="off"' + (f' placeholder="{esc(ph)}"' if ph else "") + f'{extra}></label>')
    song = ('<fieldset class="ss-song"><legend class="ss-legend">The song</legend><div class="ss-grid ss-grid--song">'
            + field("title", "Song title", ' required')
            + field("date", "Date agreed", typ="date")
            + field("alt", "Other titles <i>optional</i>", ph="Working titles, translations")
            + field("artist", "Recording artist <i>optional</i>")
            + "</div></fieldset>")
    writers = ('<fieldset class="ss-writers"><legend class="ss-legend">The writers</legend>'
               f'<p class="k-small ss-help">{esc(SPLIT_SHARES)} The producer role is for a producer who helped write the song.</p>'
               '<ol class="ss-rows"></ol>'
               '<div class="ss-rowbtns"><button type="button" class="k-btn k-btn--ghost k-btn--sm" data-ss="add">Add a writer</button>'
               '<button type="button" class="k-btn k-btn--ghost k-btn--sm" data-ss="even">Split evenly</button></div>'
               '<p class="ss-total" aria-live="polite"></p></fieldset>')
    actions = ('<ul class="ss-issues" hidden></ul>'
               '<div class="ss-actions"><button type="button" class="k-btn" data-ss="print">Print or save as PDF</button>'
               '<button type="button" class="k-btn k-btn--ghost" data-ss="copy">Copy as text</button>'
               '<button type="button" class="k-linkbtn ss-clear" data-ss="clear">Clear the form</button>'
               '<span class="ss-status" role="status" aria-live="polite"></span></div>'
               '<p class="k-small ss-keep">Your draft is kept in this browser only, so you can come back to it. Nothing is sent anywhere.</p>')
    return ('<div class="ss" id="split-tool" data-split-sheet>'
            f'<div class="ss-note"><p class="ss-note-h">Not a contract</p><p>{esc(SPLIT_NOTE)}</p><p>{esc(SPLIT_HOW)}</p></div>'
            f'<p class="ss-off k-small">{esc(SPLIT_OFF)}</p>'
            '<form class="ss-form" hidden novalidate>' + song + writers + actions + "</form>"
            '<div class="ss-out" hidden><p class="k-label ss-out-h">The sheet, as it will print</p>'
            '<article class="ss-sheet" aria-label="Split sheet preview"></article></div></div>')


def split_band():
    aside = "For the co-writers of one song: who wrote it, in what role, and each writer's share, ready to print and sign."
    return ("split-sheet", "Split sheet", None,
            band("split-sheet", "Split sheet", "Agree the split, <em>then write it down.</em>", aside, split_html()))


# KiteSink's own tools, as cards at the top of /music/tools: (anchor, name, blurb, data file it needs or None).
# A tool with no anchor is not built yet and shows as in preparation.
KS_TOOLS = [
    ("calculator", "Mechanical rate calculator", "The US statutory rate per copy for physical copies and downloads, for a year, a playing time and a number of copies.", "rates"),
    ("checklist", "Unclaimed-money checklist", "The places that may hold royalties for you, for who you are and where your music earns, to tick off one by one.", "claimable"),
    ("identifiers", "Identifier checker", "Says whether an ISRC, ISWC, ISNI or IPI number is in the right form, and checks the check digit where there is one.", None),
    ("split-sheet", "Split-sheet generator", "Records who wrote a song and each writer's share, checks the shares make 100 percent, and prints a sheet to sign.", None),
    (None, "Society directory", "Collecting societies by territory, and the rights each one collects.", None),
]


def ks_tool_live(data, anchor, needs):
    return bool(anchor) and (needs is None or (needs in data and (needs != "claimable" or bool(data["claimable"].get("rows")))))


def ks_tool_cards(data):
    out = []
    for anchor, name, blurb, needs in KS_TOOLS:
        live = ks_tool_live(data, anchor, needs)
        inner = f'<span class="kt-t">{esc(name)}</span><span class="kt-b">{esc(blurb)}</span><span class="kt-n">{"Open" if live else "In preparation"}</span>'
        out.append(f'<li><a class="kt-card" href="#{anchor}">{inner}</a></li>' if live else
                   f'<li><div class="kt-card kt-card--soon">{inner}</div></li>')
    return '<ul class="kt-cards" aria-label="KiteSink tools">' + "".join(out) + "</ul>"


def tool_row(t):
    facts = (f'<span><b>Access</b> {esc(ACCESS[t["access"]])}</span>'
             f'<span><b>For</b> {esc(and_list(READERS[r][0] for r in t["readers"]))}</span>'
             f'<span><b>Where</b> {esc(terr_label(t["territory"]))}</span>'
             + (f'<span><b>Checked</b> {esc(date_label(t["checked"]))}</span>' if t.get("checked") else ""))
    note = f'<p class="ot-note">{esc(t["note"])}</p>' if t.get("note") else ""
    return (f'<li class="ot" id="{esc(t["id"])}" data-r="{esc(" ".join(t["readers"]))}" data-tr="{esc(" ".join(t["territory"]))}" data-g="{esc(t["group"])}">'
            f'<p class="ot-name"><a href="{esc(t["url"])}" target="_blank" rel="noopener">{esc(t["name"])}<span class="k-vh"> (opens in a new tab)</span></a>'
            f' <span class="ot-owner">{esc(t["owner"])}</span></p><p class="ot-what">{esc(t["what"])}</p>{note}<p class="g-facts">{facts}</p></li>')


def verified_tools(data):
    return [t for t in data.get("tools", {}).get("tools", []) if t.get("status") == "verified"]


def tool_group_labels(data):
    own = {g["id"]: g["label"] for g in data.get("tools", {}).get("groups", []) if g.get("id") and g.get("label")}
    return OrderedDict((g, own.get(g, label)) for g, label in TOOL_GROUPS.items())


def page_tools(lib, data, pages, route):
    here = route["slug"]
    live = sum(1 for anchor, _, _, needs in KS_TOOLS if ks_tool_live(data, anchor, needs))
    soon = len(KS_TOOLS) - live
    words = ("No", "One", "Two", "Three", "Four", "Five", "Six")
    aside = ((f"{words[live]} tool runs in this page and keeps" if live == 1 else f"{words[live]} tools run in this page and keep")
             + " nothing outside your browser." + (f" {words[soon]} more {'is' if soon == 1 else 'are'} in preparation." if soon else ""))
    sections = [("kitesink", "KiteSink tools", None, band("kitesink", "Built here", "KiteSink <em>tools.</em>", aside, ks_tool_cards(data)))]
    if "rates" in data:
        sections.append(calculator_band(lib, data["rates"]))
    if pages.has("claimable"):
        sections.append(unclaimed_band(data["claimable"], pages, here))
    sections.append(identifier_band())
    sections.append(split_band())
    tools = verified_tools(data)
    if tools:
        labels = tool_group_labels(data)
        n_r = Counter(r for t in tools for r in t["readers"])
        named = terr_options(tools)
        n_t = Counter({c: sum(1 for t in tools if in_territory(t, c)) for c in TERRITORY})
        rail = ('<div class="gx-rail" id="ot-rail">'
                + facet("reader", [(r, READERS[r][0]) for r in READERS if n_r[r]], "Reader", counts=n_r)
                + facet("territory", [(c, TERRITORY[c]) for c in named], "Territory", counts=n_t,
                        note=INTL_NOTE if "INTL" in named and len(named) > 1 else "") + "</div>")
        groups = []
        for g, label in labels.items():
            mine = [t for t in tools if t["group"] == g]
            if mine:
                groups.append(f'<section class="ot-g" data-g="{g}" aria-labelledby="og-{g}"><h3 class="fx-label ot-gh" id="og-{g}">{esc(label)}</h3>'
                              '<ul class="ot-list">' + "".join(tool_row(t) for t in mine) + "</ul></section>")
        inner = (
            '<p class="k-small fr-note">Each tool was opened and checked by two people before it was listed, and carries the date. '
            'Listed for what it does, in our words; no ranking, no paid placement.</p>'
            '<div class="gx"><details class="gx-filters" id="ot-filters" open><summary>Filters <span id="ot-active"></span></summary>' + rail + "</details>"
            '<div class="gx-main"><p class="gx-count" id="ot-count" aria-live="polite"></p><div id="ot-list">' + "\n".join(groups) + "</div>"
            '<p class="gx-empty" id="ot-empty" hidden>No tool matches. <button type="button" class="k-linkbtn" data-reset="tools">Clear the filters</button></p></div></div>'
        )
        aside = f'{count_of(len(tools), "tool")}, grouped by what they do. Narrow by who you are or where you work.'
        sections.append(("directory", "Other tools", len(tools), band("directory", "Directory", "Other tools <em>worth knowing.</em>", aside, inner)))
    else:
        sections.append(("directory", "Other tools", None, band("directory", "Directory", "Other tools <em>worth knowing.</em>", "",
                         '<p class="k-small">In preparation: a directory of outside tools for works searches, identifiers, unclaimed money, '
                         'metadata, splits, sync and valuation, each opened and checked before it is listed.</p>')))
    n_src, src = sources_band(lib, pages)
    if n_src:
        sections.append(("sources", "Sources", n_src, src))
    return sections


def dataset_jsonld(claimable, route, meta):
    """schema.org Dataset for /music/claimable, pointing at the public JSON and the twin."""
    rows = claimable["rows"]
    url = f"{SITE}/music/{route['slug']}"
    doc = {
        "@context": "https://schema.org", "@type": "Dataset",
        "name": "Claimable music royalties",
        "description": (f"{count_of(len(rows), 'place')} where music royalties can sit unclaimed, by holder and territory: who can claim, "
                        "how to claim, the cost, and what happens to money nobody claims. Each row is dated and sourced."),
        "url": url, "dateModified": max(r["as_of"] for r in rows), "inLanguage": "en", "isAccessibleForFree": True,
        "creator": {"@type": "Organization", "name": "KiteSink", "url": SITE + "/"},
        "license": {"@type": "CreativeWork", "url": url + "#about-data",
                    "name": "KiteSink's own summary of each holder's published pages and the law. Not legal advice."},
        "spatialCoverage": [TERRITORY[t] for t in terr_options(rows)],
        "keywords": ["unclaimed royalties", "music royalties"] + [MONEY[m].lower() for m in MONEY if any(r["money_type"] == m for r in rows)],
        "distribution": [
            {"@type": "DataDownload", "encodingFormat": "application/json", "contentUrl": url + ".json"},
            {"@type": "DataDownload", "encodingFormat": "text/markdown", "contentUrl": url + ".md"},
        ],
    }
    return '<script type="application/ld+json">' + json.dumps(doc, ensure_ascii=False).replace("</", "<\\/") + "</script>"


def public_source(s):
    return OrderedDict((k, v) for k, v in s.items() if k != "support")


def claimable_public(lib, claimable, meta):
    """/music/claimable.json: the rows, and the sources they cite, without `support`."""
    keys = []
    for r in claimable["rows"]:
        keys += [k for k in r["sources"] if k not in keys]
    doc = OrderedDict([
        ("name", "Claimable music royalties"),
        ("url", f"{SITE}/music/claimable"),
        ("publisher", "KiteSink"),
        ("note", "KiteSink's own summary of each holder's published pages and the law, checked on each row's as_of date. Not legal advice. "
                 + meta["scope_line"]),
        ("dateModified", max(r["as_of"] for r in claimable["rows"])),
        ("rows", claimable["rows"]),
        ("sources", OrderedDict((k, public_source(claimable["sources"][k])) for k in keys)),
    ])
    text = json.dumps(doc, ensure_ascii=False, indent=1) + "\n"
    if any(len(s.get("support", "")) >= 24 and s["support"] in text for s in claimable["sources"].values()):
        raise SystemExit("claimable.json (public) would carry a source's support text")
    return text


def md_claimable(lib, meta, data, pages):
    rows = data["claimable"]["rows"]
    slug = pages.slug["claimable"]
    out = ["# Claimable music royalties: KiteSink", "",
           f"{count_of(len(rows), 'place')} where music royalties can sit unclaimed, by holder and territory. Each row says who can claim, "
           "how, what it costs and what happens if nobody does, with the date it was checked and its sources.", "",
           CLAIMABLE_SCOPE, "", f"The same rows as data: {SITE}/music/{slug}.json", ""]
    for r in rows:
        out += [f"## {r['holder']}: {r['pot']}", "",
                f"- Money: {MONEY[r['money_type']]} · Where: {terr_label(r['territory'])} · For: {', '.join(READERS[x][0].lower() for x in r['readers'])}",
                f"- Who can claim: {r['who_can_claim']}", f"- How to claim: {r['how_to_claim']}", f"- If nobody claims: {r['rule']}",
                f"- Cost: {r['cost']}", f"- Link: [{r['link_label']}]({r['link']})",
                f"- {SUPPORT[SUPPORT_OF[r['confidence']]]} ({CONF[r['confidence']].lower()}) · As of {date_label(r['as_of'])} · Sources: {lib.cite_md('claimable', r['sources'])}", ""]
    if pages.has("tools"):
        out += [f"To work through these as a checklist: {SITE}/music/{pages.slug['tools']}.md", ""]
    return "\n".join(out) + md_footer(meta, "/" + slug)


def md_rates(lib, rates):
    """The calculator, as plain text: the method and the yearly rates."""
    stream = {r["year"]: r for r in rates.get("streaming_revenue_percent", [])}
    out = ["## Mechanical rate calculator", "", CALC_METHOD, "", f"Rates as of {date_label(rates['as_of'])}.", "",
           "| Year | Per work | Per minute or part minute | Streaming, first prong (illustration) | Sources |", "|---|---|---|---|---|"]
    for r in sorted(rates["physical"], key=lambda r: r["year"]):
        s = stream.get(r["year"])
        keys = list(r["sources"]) + [k for k in (s["sources"] if s else []) if k not in r["sources"]]
        out.append(f"| {r['year']} | {cents_label(r['per_work_cents'])} cents | {cents_label(r['per_minute_cents'])} cents | "
                   f"{str(s['percent']) + '% of revenue' if s else 'Not given'} | {lib.cite_md('rates', keys)} |")
    out += ["", "Example: a 5:01 track counts as 6 minutes; at 2.52 cents a minute that is 15.12 cents, more than a 13.1-cent per-work rate, so 15.12 cents per copy.", ""]
    if rates.get("ringtone_cents"):
        out += [f"Ringtones: {cents_label(rates['ringtone_cents']['value'])} cents per ringtone, whatever its length. Sources: {lib.cite_md('rates', rates['ringtone_cents']['sources'])}", ""]
    if stream:
        out += [STREAM_NOTE + " The percentages above are the first prong only, shown as an illustration.", ""]
    return out


def md_checklist(data, pages):
    out = ["## Unclaimed-money checklist", "", "Places that may hold royalties for you. Check each one that fits who you are and where your music earns.", ""]
    for r in data["claimable"]["rows"]:
        out.append(f"- [ ] **{r['holder']}** ({terr_label(r['territory'])}, {MONEY[r['money_type']].lower()}): {r['pot']}. "
                   f"What to look for: {r['how_to_claim']} Cost: {r['cost']}. [{r['link_label']}]({r['link']})")
    out += ["", f"Who can claim, the rules and the sources: {SITE}/music/{pages.slug['claimable']}.md", ""]
    return out


def md_identifiers(here):
    out = ["## Identifier checker", "", ID_METHOD, "", f"The checker itself: {here}#identifiers", ""]
    for f in ID_FORMATS:
        out += [f"### {f['name']} ({f['long']})", "", f"- Identifies: {f['what']}", f"- Form: {f['form']}", f"- Check digit: {f['check']}",
                f"- Look it up: [{f['lookup'][0]}]({f['lookup'][1]})" if f["lookup"] else "- Look it up: ask your PRO or society for the IPI numbers they hold for you.",
                "- Sources (opened " + TOOLS_OPENED + "): " + "; ".join(f"[{l}]({u})" for l, u in f["sources"]), ""]
    return out


def md_split(here):
    return ["## Split-sheet generator", "", SPLIT_NOTE, "", SPLIT_HOW, "",
            "A sheet holds the song title, the date agreed, any other titles and the recording artist; and for each writer their name, "
            "role (lyrics, music, lyrics and music, or a producer who helped write the song), PRO or society, IPI number, publisher and "
            "share, with a line to sign and date. " + SPLIT_SHARES, "", f"The generator itself: {here}#split-sheet", ""]


def md_tools(lib, meta, data, pages):
    here = f"{SITE}/music/{pages.slug['tools']}"
    out = ["# Music rights tools: KiteSink", "",
           "Tools built here (a mechanical rate calculator, an unclaimed-money checklist, an identifier checker and a split-sheet "
           "generator) and a checked directory of other tools.", ""]
    out += md_rates(lib, data["rates"]) if "rates" in data else ["## Mechanical rate calculator", "", "In preparation.", ""]
    out += md_checklist(data, pages) if pages.has("claimable") else ["## Unclaimed-money checklist", "", "In preparation.", ""]
    out += md_identifiers(here) + md_split(here)
    out += ["## In preparation", ""] + [f"- {name}: {blurb}" for anchor, name, blurb, _ in KS_TOOLS if not anchor] + [""]
    out += ["## Other tools worth knowing", ""]
    tools = verified_tools(data)
    if not tools:
        out += ["In preparation.", ""]
    for g, label in tool_group_labels(data).items():
        mine = [t for t in tools if t["group"] == g]
        if mine:
            out += [f"### {label}", ""]
            for t in mine:
                out.append(f"- [{t['name']}]({t['url']}) ({t['owner']}): {t['what']}" + (f" {t['note']}" if t.get("note") else "")
                           + f" Access: {ACCESS[t['access']]}. For: {', '.join(READERS[r][0].lower() for r in t['readers'])}. "
                           f"Where: {terr_label(t['territory'])}." + (f" Checked {date_label(t['checked'])}." if t.get("checked") else ""))
            out.append("")
    return "\n".join(out) + md_footer(meta, "/" + pages.slug["tools"])


def md_area_tool(lib, dom, data, pages):
    """What an area's twin says about the KiteSink tool embedded on its page."""
    tool = TOOL_HOMES.get(dom)
    if tool == "calculator" and "rates" in data:
        return md_rates(lib, data["rates"]) + [f"The calculator itself: {SITE}/music/{pages.slug[dom]}#calculator", ""]
    if tool == "checklist" and pages.has("claimable"):
        return md_checklist(data, pages)
    if tool == "identifiers":
        return md_identifiers(f"{SITE}/music/{pages.slug[dom]}")
    if tool == "splits":
        return md_split(f"{SITE}/music/{pages.slug[dom]}")
    return []


# ----------------------------------------------------------------- the hub, /music (behind HUB_LIVE)
REFERENCE_CARDS = OrderedDict([
    ("claims", ("Things people say about royalties and rights, each with a verdict and its source.", "{n:claims} claims")),
    ("glossary", ("Every term the areas use, defined once in plain words.", "{n:terms} terms")),
    ("reference", ("The key numbers, each dated, and the look-up tables.", "{n:numbers} numbers, {n:tables} tables")),
    ("sources", ("How entries are graded, and every source.", "{n:sources} sources")),
])


def hub_card(href, title, blurb, count, extra=""):
    inner = f'<span class="hub-t">{esc(title)}</span><span class="hub-b">{esc(blurb)}</span>{extra}<span class="hub-n">{esc(count)}</span>'
    if href:
        return f'<li><a class="hub-card" href="{href}">{inner}</a></li>'
    return f'<li><div class="hub-card hub-card--soon" aria-disabled="true">{inner}</div></li>'


def hub_areas(pages, counts):
    """A card per area under the group headings A to E. An area with no file yet shows as in preparation."""
    out = []
    for letter, name, doms in GROUPS:
        gid = "g-" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        cards = "\n          ".join(
            hub_card(pages.url(d), DOMAINS[d][0], DOMAINS[d][1], count_of(counts[d], "entry", "entries")) if pages.has(d)
            else hub_card(None, DOMAINS[d][0], DOMAINS[d][1], "In preparation") for d in doms)
        out.append(f'<div class="hub-group">\n        <h3 class="hub-gh" id="{gid}"><span>{letter}</span> {esc(name)}</h3>\n'
                   f'        <ul class="hub-cards" aria-labelledby="{gid}">\n          {cards}\n        </ul>\n      </div>')
    return "\n      ".join(out)


def hub_reference(pages, numbers):
    names = {r["kind"]: route_label(r) for r in pages.routes if r["kind"] != "area"}
    cards = [hub_card(pages.url(key), names[key], blurb, re.sub(r"\{([^}]+)\}", lambda m: str(numbers[m.group(1)]), count))
             for key, (blurb, count) in REFERENCE_CARDS.items() if pages.has(key)]
    if not cards:
        return '<p class="k-small">The claims, the glossary, the index of numbers and the sources appear here once the first area is published.</p>'
    return '<ul class="hub-cards hub-cards--ref" aria-labelledby="h-reference">\n        ' + "\n        ".join(cards) + "\n      </ul>"


def reader_total(data, pages, r):
    """How many entries are for reader r, as the hub and its twin both say: every entry of a written
    area except terms (those live on the glossary), plus the claims for that reader."""
    return (sum(1 for d in pages.areas for e in data[d]["entries"] if r in e.get("readers", []) and e["type"] != "term")
            + sum(1 for c in data["claims"]["entries"] if r in c.get("readers", [])))


def hub_readers(data, pages):
    """Five ways in, one per reader: how many entries are for them, and the areas with most of them.
    Each link carries ?reader=, which the area page's script turns into its reader filter."""
    out = []
    for r, (label, blurb) in READERS.items():
        per = Counter({d: sum(1 for e in data[d]["entries"] if r in e.get("readers", []) and e["type"] != "term") for d in pages.areas})
        n = reader_total(data, pages, r)
        top = [d for d, k in sorted(per.items(), key=lambda x: (-x[1], list(DOMAINS).index(x[0]))) if k][:3]
        links = "".join(f'<li><a href="{pages.url(d)}?reader={r}">{esc(DOMAINS[d][0])} <b>{per[d]}</b></a></li>' for d in top)
        out.append(f'<li class="mr-path" id="for-{r}"><h3 class="mr-path-t">{esc(label)}</h3><p class="mr-path-b">{esc(blurb)}</p>'
                   + (f'<ul class="mr-path-l" aria-label="Start here, {esc(label.lower())}">{links}</ul>' if links else
                      '<p class="mr-path-n">Entries for you appear here as the areas are published.</p>')
                   + f'<p class="mr-path-c">{count_of(n, "entry", "entries")} for {esc(label.lower())}</p></li>')
    return '<ul class="mr-paths">' + "\n".join(out) + "</ul>"


def hub_tools(meta, pages):
    cards = []
    written = [r["slug"] for r in pages.routes]
    for t in meta.get("tools", []):
        href = t.get("href")
        if href and href.startswith("/music/"):
            href = href if href[len("/music/"):].split("#")[0] in written else None   # linked when this build writes the page, else shown as in preparation
        elif not t.get("live"):
            href = None
        cards.append(hub_card(href, t["title"], t["blurb"], "Open" if href else "In preparation"))
    return '<ul class="hub-cards mr-tools" aria-labelledby="h-tools">\n        ' + "\n        ".join(cards) + "\n      </ul>"


def hub_ai(data, pages, counts):
    """The AI band: the AI area's topics and the claims tagged AI, or a note that it is coming."""
    if not pages.has("ai-rights"):
        return ('<p class="mr-ai-soon">The AI area is in preparation: training on songs and recordings, who owns AI-assisted work, '
                'voice and likeness, licensing deals, and the court cases so far. Each entry will carry the date it was true.</p>')
    d = data["ai-rights"]
    topics = "".join(f'<li><a href="{pages.url("ai-rights")}">{esc(t["label"])}</a></li>' for t in d.get("topics", []))
    claims = [c for c in data["claims"]["entries"] if "ai" in c.get("tags", []) or c["domain"] == "ai-rights"]
    qs = "".join(f'<li><a href="{esc(pages.href(c["id"], ""))}"><span>{esc(c["title"])}</span>'
                 f'<span class="verdict {VERDICTS[c["verdict"]][1]}">{esc(VERDICTS[c["verdict"]][0])}</span></a></li>' for c in claims[:4])
    return (f'<p class="mr-ai-n"><a class="k-btn" href="{pages.url("ai-rights")}">Read the AI area</a> '
            f'<span>{count_of(counts["ai-rights"], "entry", "entries")}, each dated.</span></p>'
            + (f'<ul class="fr-terms mr-ai-topics" aria-label="AI topics">{topics}</ul>' if topics else "")
            + (f'<ul class="fr-claims mr-ai-claims" aria-label="Claims about AI">{qs}</ul>' if qs else ""))


def check_hub(hub, pages, built):
    ids = Counter(ids_in(hub))
    on_page = {slug: set(ids_in(text)) for slug, text in built.items()}
    problems = [f"the id {i} is used {n} times" for i, n in ids.items() if n > 1]
    problems += [f"no link to /music/{r['slug']}" for r in pages.routes if f'href="/music/{r["slug"]}"' not in hub]
    for target, frag in set(re.findall(r'href="(/music/[a-z0-9-]+)?#([^"]+)"', hub)):
        where = target[len("/music/"):] if target else None
        if where is None and frag not in ids:
            problems.append(f"links to #{frag}, and nothing on the hub has that id")
        elif where is not None and frag not in on_page.get(where, ()):
            problems.append(f"links to {target}#{frag}, and nothing there has that id")
    if problems:
        raise SystemExit("/music, the hub:\n  " + "\n  ".join(problems))


def md_index(meta, data, numbers, counts, pages):
    """The hub's twin: what the guide is, every page's twin, and the music projects (templates/hub.md)."""
    def twin(key):
        return f"{SITE}/music/{pages.slug[key]}.md"
    out = ["# KiteSink Music", "",
           f"A free field guide to music rights and royalties by Truman Kitos-Lindsey, and three music projects. The guide holds "
           f"{numbers['n:total']} sourced entries in {numbers['n:areas']} of {len(DOMAINS)} planned areas. Every entry says who it is for "
           "(songwriters, artists, producers, publishers and labels, administrators), where it applies, how well sourced it is, and the date "
           "of anything that moves.", "", meta["scope_line"], "", "## The field guide, by area", ""]
    for letter, name, doms in GROUPS:
        out += [f"### {letter}. {name}", ""]
        for d in doms:
            out.append(f"- [{DOMAINS[d][0]}]({twin(d)}): {DOMAINS[d][1]} {count_of(counts[d], 'entry', 'entries')}." if pages.has(d)
                       else f"- {DOMAINS[d][0]}: {DOMAINS[d][1]} In preparation.")
        out.append("")
    out += ["## By reader", ""]
    for r, (label, blurb) in READERS.items():
        n = reader_total(data, pages, r)
        out.append(f"- {label}: {blurb} {count_of(n, 'entry', 'entries')}.")
    ref = []
    if pages.has("claims"):
        ref.append(f"- [Claims, checked]({twin('claims')}): {numbers['n:claims']} common claims, each with a verdict, what it rests on, and the source.")
    if pages.has("glossary"):
        ref.append(f"- [Glossary]({twin('glossary')}): the {numbers['n:terms']} terms the areas use, in plain words.")
    if pages.has("reference"):
        ref.append(f"- [Key numbers and tables, indexed]({twin('reference')}): {numbers['n:numbers']} dated key numbers and {numbers['n:tables']} reference tables.")
    if pages.has("sources"):
        ref.append(f"- [Sources and grading]({twin('sources')}): how entries are graded, and all {numbers['n:sources']} sources.")
    if pages.has("claimable"):
        ref.append(f"- [Claimable royalties]({twin('claimable')}): {numbers['n:claimable']} places where royalties can sit unclaimed, and how to claim. As data: {SITE}/music/{pages.slug['claimable']}.json")
    if pages.has("tools"):
        ref.append(f"- [Tools]({twin('tools')}): a mechanical rate calculator, an unclaimed-money checklist, an identifier checker, "
                   "a split-sheet generator and a checked directory of other tools.")
    if ref:
        out += ["", "## Reference", ""] + ref
    out += ["", "## How the entries are graded", ""] + md_grading() + [""]
    projects = config("templates/hub.md")
    if projects.is_file():
        out += [projects.read_text(encoding="utf-8").strip(), ""]
    return "\n".join(out) + md_footer(meta)


def build_hub(meta, data, numbers, counts, pages, built):
    template = config("templates/hub.html").read_text(encoding="utf-8")
    fills = {"hub:readers": hub_readers(data, pages), "hub:tools": hub_tools(meta, pages), "hub:ai": hub_ai(data, pages, counts),
             "hub:areas": hub_areas(pages, counts), "hub:reference": hub_reference(pages, numbers), "scope": esc(meta["scope_line"]),
             **{k: numbers[k] for k in ("n:total", "n:areas", "n:planned", "updated")}}
    page = template
    for key, value in fills.items():
        token = "{{" + key + "}}"
        if token not in page:
            raise SystemExit(f"content/music/templates/hub.html has no {token}")
        page = page.replace(token, str(value))
    left = re.findall(r"\{\{[^}]+\}\}", page)
    if left:
        raise SystemExit("unfilled tokens in templates/hub.html: " + ", ".join(sorted(set(left))))
    check_hub(page, pages, built)
    return page


# ----------------------------------------------------------------- assemble
def build():
    meta, lib, data, present = load()
    pages = Pages(load_routes(), data, present, lib)
    kinds = Counter(e["type"] for dom in present for e in data[dom]["entries"])
    counts = {d: len(data[d]["entries"]) if d in data else 0 for d in DOMAINS}
    n_claims = len(data["claims"]["entries"])
    total = sum(counts.values()) + n_claims
    numbers = {"n:steps": kinds["step"], "n:claims": n_claims, "n:terms": kinds["term"], "n:numbers": kinds["number"],
               "n:tables": kinds["table"], "n:sources": len(lib.by_id), "n:total": total, "n:areas": len(present),
               "n:planned": len(DOMAINS), "n:pages": len(pages.routes), "updated": meta["updated_label"],
               "n:claimable": len(data.get("claimable", {}).get("rows", [])), "n:tools": len(verified_tools(data))}
    stats = {"areas": len(present), "entries": total, "pages": len(pages.routes), "sources": len(lib.by_id), "claims": n_claims,
             "numbers": kinds["number"], "tables": kinds["table"], "terms": kinds["term"], "steps": kinds["step"],
             "claimable rows": len(data.get("claimable", {}).get("rows", [])), "listed tools": len(verified_tools(data)),
             "rate years": len(data.get("rates", {}).get("physical", []))}
    out = OrderedDict()
    if not pages.routes:
        return out, stats   # nothing written yet: no pages, no index, and the hub stays as it is

    sub, built, _ = build_subpages(lib, meta, data, numbers, pages)
    index = search_index(data, pages)
    if len(index["rows"]) != total or {row[0] for row in index["rows"]} != set(pages.home):
        raise SystemExit("the search index does not hold every entry once")
    for dom in present:
        out[PUBLIC / "music" / f"{pages.slug[dom]}.md"] = md_domain(lib, meta, dom, data[dom], pages, md_area_tool(lib, dom, data, pages))
    if pages.has("claims"):
        out[PUBLIC / "music" / f"{pages.slug['claims']}.md"] = md_claims(lib, meta, data["claims"]["entries"], pages)
    out[PUBLIC / "music" / "search.json"] = json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n"
    clash = [p.name for p in sub if p in out]
    if clash:
        raise SystemExit("routes.json would overwrite: " + ", ".join(clash))
    out.update(sub)
    if HUB_LIVE:
        out[PUBLIC / "music.html"] = build_hub(meta, data, numbers, counts, pages, built)
        out[PUBLIC / "music.md"] = md_index(meta, data, numbers, counts, pages)
    return out, stats


def main():
    out, stats = build()
    if "--check" in sys.argv:
        stale = [p.relative_to(PUBLIC).as_posix() for p, text in out.items() if not p.is_file() or p.read_text(encoding="utf-8") != text]
        if stale:
            print("Out of date (run python3 scripts/build_music.py): " + ", ".join(stale))
            return 1
        return 0
    if not out:
        print(f"built nothing: no music area file in {SRC} yet (0 of {len(DOMAINS)} areas, {stats['claims']} claims). "
              "public/music.html is left as it is.")
        return 0
    for p, text in out.items():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    print(f"built /music/: {stats['areas']} of {len(DOMAINS)} areas, {stats['entries']} entries on {stats['pages']} pages, each entry with "
          "exactly one home; " + ", ".join(f"{stats[k]} {k}" for k in ("sources", "claims", "numbers", "tables", "terms", "steps",
                                                                         "claimable rows", "listed tools", "rate years"))
          + ("; hub written" if HUB_LIVE else "; hub not written (HUB_LIVE is False)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
