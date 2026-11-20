#!/usr/bin/env python3
"""Build /fitness (the hub) and the pages under /fitness/ from the data in content/fitness/.

    python3 scripts/build_fitness.py            # write the pages, their twins and the two data files
    python3 scripts/build_fitness.py --check    # exit 1 if what is in public/ is out of date

Inputs (all in content/fitness/):
    page.html           the /fitness shell: head, hero, search box, Vantix feature, the calculators
    hero.json           the hero's goal picker: per goal, the load, the week, the entry and what it rings
    templates/sub.html  the one shell every page under /fitness/ is poured into
    routes.json         one row per page under /fitness/: slug, kind, title, description, h1, lead
    corrections.json    the dated corrections log shown on /fitness/sources
    meta.json           the "last updated" date and a few labels
    tools.json          sources the calculators cite
    tool-data.json      the guide entries the calculators take their numbers from (see TOOL_DATA below)
    <area>.json         one file per area: the keys of DOMAINS below
    claims.json         the "claims, checked" entries
and scripts/fixtures/fitness-legacy-ids.txt, every id the one-page /fitness had.

Outputs:
    public/fitness.html                the hub: search, a card per page, the calculators
    public/fitness/<slug>.html         one per row of routes.json
    public/fitness/search.json         the hub's search index: one row per entry
    public/fitness/ids.json            id -> page, for old links of the form /fitness#<id>
    public/fitness.md and public/fitness/<slug>.md  (plain-text twins for AI readers)

Every entry has one home page under /fitness/: a term lives on the glossary, a claim on the
claims page, everything else on its area's page. Other pages link to it and never repeat it.

The pages are static HTML: every entry is in the markup, so it reads without JavaScript.
/fitness.js (the hub) and /fitness-ref.js (the pages under it) only search, filter, sort and
remember. To add an entry, add it to the right JSON file and run this script.
scripts/check_site.py runs the --check form, so a stale page fails the audit.

To add an area: write content/fitness/<area>.json, add it to DOMAINS, GROUPS and
SOURCE_ORDER below, give it a row in routes.json, then list its page as README.md says.
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
# The two environment variables exist for tests: build sample data into a scratch folder.
SRC = Path(os.environ.get("KS_FITNESS_SRC") or ROOT / "content" / "fitness")
PUBLIC = Path(os.environ.get("KS_FITNESS_OUT") or ROOT / "public")
SITE = "https://kitesink.com"

# The areas, in the order they appear everywhere: the hub, the navigation, the twins, llms.txt.
DOMAINS = OrderedDict([
    ("basics", ("Training basics", "Starting out, and building a first programme.")),
    ("technique", ("Technique", "How to do the main lifts, and how to change a habit.")),
    ("hypertrophy", ("Hypertrophy", "Training for muscle size.")),
    ("powerlifting", ("Powerlifting", "A bigger squat, bench press and deadlift.")),
    ("meet", ("Meet day", "Your first competition, in order.")),
    ("conditioning", ("Conditioning", "Cardio and intervals, and how they fit with lifting.")),
    ("recovery", ("Recovery", "Rest, fatigue and coming back after time off.")),
    ("nutrition", ("Nutrition", "Eating to support training, and tracking it honestly.")),
    ("diet", ("Diet", "Losing or gaining weight on purpose.")),
    ("bodycomp", ("Body composition", "Fat, lean mass and how to track them.")),
    ("women", ("Women", "What the research on women shows.")),
    ("health", ("Health", "Training for a long working life.")),
])
# How the hub and the navigation group the areas. Every area is in exactly one group.
GROUPS = [
    ("Training", ("basics", "technique", "hypertrophy", "powerlifting", "meet", "conditioning", "recovery")),
    ("Food and body", ("nutrition", "diet", "bodycomp")),
    ("People and health", ("women", "health")),
]
# The order the files are read in. A source's id on the page (src-<key>) is settled by the
# first file that has it, so a new file goes at the END of this list, whatever its place in
# DOMAINS. Reordering it can rename a published source id.
SOURCE_ORDER = ("tools", "hypertrophy", "powerlifting", "meet", "nutrition", "diet", "health", "claims",
                "basics", "technique", "conditioning", "recovery", "bodycomp", "women")
LEVELS = OrderedDict([("beginner", "Beginner"), ("intermediate", "Intermediate"), ("advanced", "Advanced")])
CONF = OrderedDict([
    ("strong", "Well supported"), ("rule", "Rulebook"), ("moderate", "Some support"),
    ("limited", "Thin evidence"), ("practice", "Coaching practice"),
])
CONF_HELP = {
    "strong": "Meta-analyses, position stands, guidelines or several consistent trials.",
    "rule": "A federation rule or an official guideline value.",
    "moderate": "A few trials or consistent observational data.",
    "limited": "One or two small studies, or mixed findings.",
    "practice": "Common coaching convention. No direct study.",
}
VERDICTS = OrderedDict([
    ("true", ("Holds up", "v-yes")), ("mostly", ("Mostly holds", "v-yes")), ("depends", ("Depends", "v-mixed")),
    ("overstated", ("Overstated", "v-mixed")), ("false", ("Not supported", "v-no")),
])
EVIDENCE = OrderedDict([
    ("meta-analysis", "Meta-analysis"), ("guideline", "Guideline"), ("position", "Position stand"),
    ("rct", "Randomised trial"), ("rulebook", "Rulebook"), ("review", "Review"), ("cohort", "Cohort study"), ("mixed", "Mixed"),
])
TAGS = OrderedDict([
    ("training", "Training"), ("strength", "Strength"), ("muscle-gain", "Muscle gain"), ("recovery", "Recovery"),
    ("competition", "Competition"), ("protein", "Protein"), ("calories", "Calories"), ("timing", "Timing"),
    ("tracking", "Tracking"), ("supplements", "Supplements"), ("weight-loss", "Weight loss"), ("cardio", "Cardio"),
    ("health", "Health"), ("myths", "Myths"),
])
WHEN = OrderedDict([
    ("months-out", "Months out"), ("weeks-out", "Weeks out"), ("week-before", "The week before"),
    ("day-before", "The day before"), ("weigh-in", "Weigh-in"), ("warm-up", "The warm-up room"),
    ("platform", "On the platform"), ("between-lifts", "Between lifts"), ("after", "Afterwards"),
])
SRC_TYPE = {
    "meta-analysis": "meta-analysis", "systematic-review": "systematic review", "rct": "randomised trial", "trial": "trial",
    "review": "review", "cohort": "cohort study", "position": "position stand", "guideline": "guideline",
    "rulebook": "rulebook", "book": "book", "article": "article", "other": "reference",
}
# Said once on the sources page and in its twin.
ARTICLE_NOTE = ("Articles are credited where an author's analysis or position shaped an entry. "
                "Every entry is written in this guide's own words.")


def src_type(s):
    """A source's type as it is shown: 'Meta-analysis', 'Article', 'Reference'."""
    label = SRC_TYPE.get(s.get("type"), "reference")
    return label[0].upper() + label[1:]


def esc(s):
    return html.escape(str(s), quote=True)


def family(author):
    """'Morton RW' -> 'Morton'; 'van Loon LJC' -> 'van Loon'; an organisation stays whole."""
    parts = author.split()
    if len(parts) > 1 and re.fullmatch(r"[A-Z][A-Za-z\-]{0,4}", parts[-1]) and parts[-1].upper() == parts[-1]:
        return " ".join(parts[:-1])
    return author


def letters(i):
    """0 -> 'a', 25 -> 'z', 26 -> 'aa': the suffix that tells apart sources with one author and year."""
    out = ""
    while True:
        out = "abcdefghijklmnopqrstuvwxyz"[i % 26] + out
        i = i // 26 - 1
        if i < 0:
            return out


class Library:
    """Every source from every file, merged by DOI or URL, with short labels."""

    def __init__(self, labels, pins=None):
        # pins: source address (DOI or URL) -> the key it must keep. A source's key is its id on
        # the page (src-<key>), so once published it should not move.
        self.pins = {k.lower().rstrip("/"): v for k, v in (pins or {}).items()}
        self.by_id = OrderedDict()   # canonical key -> source
        self.alias = {}              # (file, key) -> canonical key
        self.uses = Counter()
        self.overrides = labels or {}

    def add(self, file, key, src):
        ident = (src.get("doi") or src.get("url") or key).lower().rstrip("/")
        for k, s in self.by_id.items():
            if (s.get("doi") or s.get("url") or k).lower().rstrip("/") == ident:
                self.alias[(file, key)] = k
                return
        canon = self.pins.get(ident)
        if canon is None:
            # Two different sources filed under one key: the second gets a suffix made from its
            # own address, so it stays the same whatever else is added later. (It used to be a
            # running count, which renumbered the id whenever a source was added.)
            canon = key if key not in self.by_id else f"{key}-{hashlib.sha1(ident.encode('utf-8')).hexdigest()[:6]}"
        elif canon in self.by_id:
            raise SystemExit(f"content/fitness/meta.json pins two different sources to the key {canon!r}")
        self.by_id[canon] = src
        self.alias[(file, key)] = canon

    def finish(self):
        base = {}
        for k, s in self.by_id.items():
            first = family(s["authors"][0]) if s.get("authors") else "Anon"
            if len(first) > 24:      # a long organisation name: use its initials
                first = "".join(w[0] for w in re.findall(r"[A-Z][a-z]+|[A-Z]{2,}", first)) or first[:24]
            label = self.overrides.get(k) or s.get("label") or f"{first} {s.get('year', '')}".strip()
            base.setdefault(label, []).append(k)
        self.label = {}
        for label, keys in base.items():
            if len(keys) == 1:
                self.label[keys[0]] = label
            else:
                for i, k in enumerate(sorted(keys, key=lambda x: self.by_id[x].get("title", ""))):
                    self.label[k] = label + letters(i)

    @contextmanager
    def counting(self, tally):
        """Count citations into `tally` for a while. A page under /fitness/ is built inside
        this, so it knows which sources it cites and how often."""
        kept, self.uses = self.uses, tally
        try:
            yield tally
        finally:
            self.uses = kept

    def cite_html(self, file, keys, page=""):
        """The citation line. page is the address of the page that lists the sources, when
        that is not the page being written (the hub's calculators cite /fitness/sources)."""
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
            s = self.by_id[k]
            url = ("https://doi.org/" + s["doi"]) if s.get("doi") else s.get("url", "")
            out.append(f"[{self.label[k]}]({url})" if url else self.label[k])
        return ", ".join(out)

    def year(self, file, keys):
        years = [self.by_id[self.alias[(file, k)]].get("year") or 0 for k in keys]
        return max(years) if years else 0

    def entry_html(self, k):
        s = self.by_id[k]
        authors = s.get("authors") or []
        who = ", ".join(authors[:3]) + (" et al." if len(authors) > 3 else "")
        bits = [f"<b>{esc(who)} ({esc(s.get('year', ''))}).</b> {esc(s.get('title', '').rstrip('.'))}."]
        if s.get("journal"):
            ref = f"<i>{esc(s['journal'])}</i>"
            if s.get("volume"):
                ref += " " + esc(s["volume"]) + (f"({esc(s['issue'])})" if s.get("issue") else "")
            if s.get("pages"):
                ref += ":" + esc(s["pages"])
            bits.append(ref + ".")
        if s.get("edition"):
            bits.append(esc(s["edition"]) + ".")
        if s.get("doi"):
            bits.append(f'<a href="https://doi.org/{esc(s["doi"])}" target="_blank" rel="noopener">doi:{esc(s["doi"])}</a>')
        elif s.get("url"):
            host = re.sub(r"^https?://(www\.)?", "", s["url"]).split("/")[0]
            bits.append(f'<a href="{esc(s["url"])}" target="_blank" rel="noopener">{esc(host)}</a>')
        n = self.uses[k]
        bits.append(f'<span class="as">{esc(src_type(s))} · cited {n}×</span>')
        return f'<li id="src-{esc(k)}" data-kind="{esc(s.get("type", "other"))}">' + " ".join(bits) + "</li>"


def load():
    meta = json.loads((SRC / "meta.json").read_text(encoding="utf-8"))
    lib = Library(meta.get("labels"), meta.get("source_keys"))
    data = OrderedDict()
    if sorted(SOURCE_ORDER) != sorted(["tools", "claims"] + list(DOMAINS)):
        raise SystemExit("SOURCE_ORDER must name tools, claims and every area in DOMAINS, once each")
    if sorted(d for _, ds in GROUPS for d in ds) != sorted(DOMAINS):
        raise SystemExit("GROUPS must hold every area in DOMAINS, once each")
    for name in SOURCE_ORDER:
        f = SRC / f"{name}.json"
        d = json.loads(f.read_text(encoding="utf-8"))
        for key, src in d.get("sources", {}).items():
            lib.add(name, key, src)
        data[name] = d
    lib.finish()
    return meta, lib, data


def tag(cls, text, title=None):
    t = f' title="{esc(title)}"' if title else ""
    return f'<span class="tg {cls}"{t}>{esc(text)}</span>'


def facet(name, options, label, all_label="All", counts=None):
    """A single-choice filter group. options: [(value, label)]. With counts ({value: n}) each
    button carries its number before any script runs; without, the page script fills it in."""
    btns = [f'<button type="button" class="fx" value="all" aria-pressed="true">{esc(all_label)}</button>']
    btns += [f'<button type="button" class="fx" value="{esc(v)}" aria-pressed="false">{esc(l)} <b>{counts[v] if counts else ""}</b></button>' for v, l in options]
    return (f'<div class="fx-group" data-facet="{name}" role="group" aria-label="{esc(label)}">'
            f'<span class="fx-label">{esc(label)}</span><div class="fx-row">' + "".join(btns) + "</div></div>")


def item_html(lib, dom, e, order, topics, extra_tags="", meta=None):
    kind = e["type"]
    if meta is None:
        meta = DOMAINS[dom][0] + (" · " + topics.get(e.get("topic"), "") if topics.get(e.get("topic")) else "")
    tags = (tag("tg-k", "Mistake") if kind == "mistake" else "") + extra_tags
    tags += tag("tg-l", LEVELS[e["level"]]) + tag("tg-c tg-" + e["confidence"], CONF[e["confidence"]], CONF_HELP[e["confidence"]])
    body = f"<p>{esc(e['body'])}</p>"
    if e.get("do"):
        body += '<ul class="g-do">' + "".join(f"<li>{esc(x)}</li>" for x in e["do"]) + "</ul>"
    body += lib.cite_html(dom, e.get("sources", []))
    return (
        f'<details class="g" id="{esc(e["id"])}" data-d="{dom}" data-k="{kind}" data-l="{e["level"]}" data-c="{e["confidence"]}" '
        f'data-tp="{esc(e.get("topic", ""))}" data-y="{lib.year(dom, e.get("sources", []))}" data-o="{order}">'
        f'<summary><span class="g-meta">{esc(meta)}</span><span class="g-title">{esc(e["title"])}</span>'
        f'<span class="g-take">{esc(e["take"])}</span><span class="g-tags">{tags}</span></summary>'
        f'<div class="g-body">{body}</div></details>'
    )


GUIDE_SORT = (
    '<label class="gx-sort"><span class="fx-label">Sort</span><select class="k-select" id="g-sort">'
    '<option value="suggested">Suggested order</option><option value="az">A to Z</option>'
    '<option value="conf">Best supported first</option><option value="level">Beginner first</option>'
    '<option value="newest">Newest source first</option></select></label>'
    '<button type="button" class="k-btn k-btn--ghost k-btn--sm" id="g-open" aria-pressed="false">Open all</button>'
)


def guide_order(entries, topics):
    """The suggested order inside one area: by topic, and mistakes after guidance."""
    return sorted(entries, key=lambda e: (list(topics).index(e["topic"]) if e.get("topic") in topics else 99, e["type"] == "mistake"))


def claim_rows(lib, claims, href=lambda entry_id: "#" + entry_id):
    """One <details> per claim. href(id) is the address of another claim from this page."""
    def related(c):
        """Up to three other claims that share the most topics with this one."""
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
        body += f'<p class="q-who"><b>Who was studied.</b> {esc(c["studied"])}</p>'
        if c.get("do"):
            body += '<ul class="g-do">' + "".join(f"<li>{esc(x)}</li>" for x in c["do"]) + "</ul>"
        meta = " · ".join([DOMAINS[c["domain"]][0], EVIDENCE[c["evidence"]]] + [TAGS[t] for t in c.get("tags", [])])
        body += f'<p class="q-meta">{esc(meta)}</p>' + lib.cite_html("claims", c.get("sources", []))
        rel = related(c)
        if rel:
            body += '<p class="q-rel">Related: ' + " · ".join(f'<a href="{esc(href(o["id"]))}">{esc(o["title"])}</a>' for o in rel) + "</p>"
        rows.append(
            f'<details class="k-qa q" id="{esc(c["id"])}" data-d="{c["domain"]}" data-v="{c["verdict"]}" data-e="{c["evidence"]}" '
            f'data-tags="{esc(" ".join(c.get("tags", [])))}" data-l="{c["level"]}" data-c="{c["confidence"]}" data-y="{lib.year("claims", c.get("sources", []))}" data-o="{i}">'
            f'<summary>{esc(c["title"])}<span class="verdict {cls}">{esc(label)}</span></summary>'
            f'<div class="k-qa-body">{body}</div></details>'
        )
    return rows


CLAIM_SORT = (
    '<label class="gx-sort"><span class="fx-label">Sort</span><select class="k-select" id="q-sort">'
    '<option value="suggested">Suggested order</option><option value="verdict">Holds up first</option>'
    '<option value="verdict-rev">Not supported first</option><option value="az">A to Z</option>'
    '<option value="evidence">Strongest evidence first</option><option value="newest">Newest source first</option></select></label>'
)


def timeline_html(lib, dom, d):
    """The steps of an area that happens in order (a meet), grouped by when they happen."""
    topics = OrderedDict((t["id"], t["label"]) for t in d.get("topics", []))
    steps = [e for e in d["entries"] if e["type"] == "step"]
    out, n = ['<ol class="tl">'], 0
    for when, label in WHEN.items():
        group = [e for e in steps if e.get("when") == when]
        if not group:
            continue
        out.append(f'<li class="tl-phase"><h3 class="tl-when">{esc(label)}</h3><div class="tl-steps">')
        for e in group:
            out.append(item_html(lib, dom, e, n, topics))
            n += 1
        out.append("</div></li>")
    out.append("</ol>")
    return "\n".join(out), len(steps)


def checklist_html(lib, dom, e, done="ticked"):
    """A list to tick off. The page script remembers the ticks in this browser. done is the
    word after the count: a bag is packed, anything else is ticked."""
    total = sum(len(g["items"]) for g in e["groups"])
    out = [f'<div class="ck" id="{esc(e["id"])}" data-ck="{esc(e["id"])}"><div class="ck-top"><div><h3 class="k-h3">{esc(e["title"])}</h3>'
           f'<p class="k-small">{esc(e["take"])}</p></div><p class="ck-count"><b class="ck-n">0</b> of {total} {done} '
           '<button type="button" class="k-linkbtn ck-clear">Clear ticks</button></p></div><div class="ck-groups">']
    i = 0
    for g in e["groups"]:
        out.append(f'<fieldset><legend>{esc(g["name"])}</legend>')
        for it in g["items"]:
            out.append(f'<label class="ck-item"><input type="checkbox" data-i="{i}"><span>{esc(it)}</span></label>')
            i += 1
        out.append("</fieldset>")
    out.append("</div>" + tag("tg-c tg-" + e["confidence"], CONF[e["confidence"]], CONF_HELP[e["confidence"]])
               + lib.cite_html(dom, e.get("sources", [])) + "</div>")
    return "\n".join(out)


def number_row(lib, dom, e, order, area=True):
    cites = lib.cite_html(dom, e.get("sources", []))
    return (
        f'<tr id="{esc(e["id"])}" data-d="{dom}" data-c="{e["confidence"]}" data-n="{e["sort"]}" data-o="{order}">'
        f'<th scope="row"><span class="nx-v">{esc(e["value"])}</span><span class="nx-u">{esc(e.get("unit", ""))}</span></th>'
        f'<td><b>{esc(e["title"])}</b><span>{esc(e["take"])}</span>{cites}</td>'
        + (f'<td class="nx-d">{esc(DOMAINS[dom][0])}</td>' if area else "") +
        f'<td class="nx-c">{tag("tg-c tg-" + e["confidence"], CONF[e["confidence"]], CONF_HELP[e["confidence"]])}</td></tr>'
    )


def table_html(lib, dom, e, meta=None):
    head = "".join(f'<th scope="col">{esc(c)}</th>' for c in e["columns"])
    body = "".join("<tr>" + "".join((f'<th scope="row">{esc(c)}</th>' if i == 0 else f"<td>{esc(c)}</td>") for i, c in enumerate(r)) + "</tr>" for r in e["rows"])
    return (
        f'<details class="rt" id="{esc(e["id"])}" data-d="{dom}"><summary><span class="g-meta">{esc(DOMAINS[dom][0] if meta is None else meta)}</span>'
        f'<span class="g-title">{esc(e["title"])}</span><span class="g-take">{esc(e["take"])}</span></summary>'
        f'<div class="rt-scroll" tabindex="0" role="region" aria-label="{esc(e["title"])}"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'
        + tag("tg-c tg-" + e["confidence"], CONF[e["confidence"]], CONF_HELP[e["confidence"]]) + lib.cite_html(dom, e.get("sources", [])) + "</details>"
    )


def legend_html():
    return '<dl class="lg">' + "".join(f'<div><dt>{tag("tg-c tg-" + c, CONF[c])}</dt><dd>{esc(CONF_HELP[c])}</dd></div>' for c in CONF) + "</dl>"


def domain_switch(counts):
    btns = ['<button type="button" value="all" aria-pressed="true">All areas</button>']
    btns += [f'<button type="button" value="{d}" aria-pressed="false">{esc(l)} <b>{counts[d]}</b></button>'
             for d, (l, _) in DOMAINS.items() if counts[d]]   # an area with nothing in this list gets no button
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
    """The end of every twin. path is the page's address under /fitness: '' for the hub."""
    hub = f"Every fitness page, as plain text: {SITE}/fitness.md  \n" if path else ""
    return (MD_OFFERS + f"\n---\n\nSource page: {SITE}/fitness{path}  \n{hub}Maintained by Truman Kitos-Lindsey, KiteSink ({SITE}).  \n"
            f"General information, not medical advice. Last updated {meta['updated']}.\n")


def md_domain(lib, meta, dom, d, pages):
    label, blurb = DOMAINS[dom]
    topics = OrderedDict((t["id"], t["label"]) for t in d.get("topics", []))
    out = [f"# {label}: KiteSink fitness field guide", "", f"{blurb} Each entry gives the point, the reasoning, what to do, how well supported it is, and its sources.", ""]
    kinds = [("note", "Guidance"), ("mistake", "Common mistakes"), ("step", "In order")]
    for kind, title in kinds:
        es = [e for e in d["entries"] if e["type"] == kind]
        if not es:
            continue
        out += [f"## {title}", ""]
        if kind == "step":
            es.sort(key=lambda e: list(WHEN).index(e["when"]))
        for e in es:
            where = WHEN[e["when"]] if kind == "step" else topics.get(e.get("topic"), "")
            out += [f"### {e['title']}", "", f"**{e['take']}**", "", e["body"], ""]
            out += [f"- {x}" for x in e.get("do", [])] + ([""] if e.get("do") else [])
            line = f"{where} · {LEVELS[e['level']]} · {CONF[e['confidence']]}"
            if e.get("sources"):
                line += " · Sources: " + lib.cite_md(dom, e["sources"])
            out += [line, ""]
    nums = [e for e in d["entries"] if e["type"] == "number"]
    if nums:
        out += ["## Key numbers", "", "| Number | What it is | Support | Sources |", "|---|---|---|---|"]
        out += [f"| {e['value']} {e.get('unit', '')} | {e['title']}: {e['take']} | {CONF[e['confidence']]} | {lib.cite_md(dom, e.get('sources', []))} |" for e in nums]
        out.append("")
    for e in d["entries"]:
        if e["type"] == "table":
            out += [f"## {e['title']}", "", e["take"], "", "| " + " | ".join(e["columns"]) + " |", "|" + "---|" * len(e["columns"])]
            out += ["| " + " | ".join(str(c) for c in r) + " |" for r in e["rows"]]
            out += ["", f"{CONF[e['confidence']]}" + (" · Sources: " + lib.cite_md(dom, e["sources"]) if e.get("sources") else ""), ""]
        if e["type"] == "checklist":
            out += [f"## {e['title']}", "", e["take"], ""]
            for g in e["groups"]:
                out += [f"**{g['name']}**", ""] + [f"- {i}" for i in g["items"]] + [""]
            out += [f"{CONF[e['confidence']]}" + (" · Sources: " + lib.cite_md(dom, e["sources"]) if e.get("sources") else ""), ""]
    terms = sorted((e for e in d["entries"] if e["type"] == "term"), key=lambda e: e["title"].lower())
    if terms:
        out += ["## Terms", ""] + [f"- **{e['title']}**: {e['take']}" for e in terms] + [""]
    return "\n".join(out) + md_footer(meta, "/" + pages.slug[dom])


def md_claims(lib, meta, claims, pages):
    out = ["# Fitness claims, checked: KiteSink", "",
           "Common things people say about training, eating and health. Each has a verdict, the reason, who was studied, and the source.",
           "Verdicts: Holds up, Mostly holds, Depends, Overstated, Not supported.", ""]
    for dom, (label, _) in DOMAINS.items():
        cs = [c for c in claims if c["domain"] == dom]
        if not cs:
            continue
        out += [f"## {label}", ""]
        for c in cs:
            out += [f"### {c['title']}", "", f"**Verdict: {VERDICTS[c['verdict']][0]}.** {c['take']}", "", c["body"], "",
                    f"Who was studied: {c['studied']}", ""]
            out += [f"- {x}" for x in c.get("do", [])] + ([""] if c.get("do") else [])
            out += [f"Evidence: {EVIDENCE[c['evidence']]} · {CONF[c['confidence']]}" + (" · Sources: " + lib.cite_md("claims", c["sources"]) if c.get("sources") else ""), ""]
    return "\n".join(out) + md_footer(meta, "/" + pages.slug["claims"])


def md_cell(text):
    return str(text).replace("|", "\\|")


def md_glossary(lib, meta, data, pages):
    terms = [(e, dom) for dom in DOMAINS for e in data[dom]["entries"] if e["type"] == "term"]
    terms.sort(key=lambda x: x[0]["title"].lower())
    out = ["# Fitness glossary: KiteSink", "",
           f"The {len(terms)} terms the KiteSink fitness field guide uses, in plain words, A to Z. Each names the area it comes from.", ""]
    for e, dom in terms:
        line = f"- **{e['title']}** ({DOMAINS[dom][0]}): {e['take']}"
        if e.get("sources"):
            line += " Sources: " + lib.cite_md(dom, e["sources"])
        out.append(line)
    out += ["", "## Read the areas", ""]
    out += [f"- [{l}]({SITE}/fitness/{d}.md): {b}" for d, (l, b) in DOMAINS.items()]
    return "\n".join(out) + "\n" + md_footer(meta, "/" + pages.slug["glossary"])


def md_reference(meta, data, pages):
    nums = [(e, dom) for dom in DOMAINS for e in data[dom]["entries"] if e["type"] == "number"]
    tables = [(e, dom) for dom in DOMAINS for e in data[dom]["entries"] if e["type"] == "table"]

    def home(e):
        return f"{SITE}/fitness/{pages.home[e['id']]}#{e['id']}"
    out = ["# Fitness key numbers and reference tables, indexed: KiteSink", "",
           f"An index of the {len(nums)} key numbers and {len(tables)} reference tables in the KiteSink fitness field guide. "
           "Each links to the area page that holds it, with its reasoning and sources. This file is the index only.", "",
           "## Key numbers", "", "| Number | Value | Unit | Area |", "|---|---|---|---|"]
    out += [f"| [{md_cell(e['title'])}]({home(e)}) | {md_cell(e['value'])} | {md_cell(e.get('unit', ''))} | {DOMAINS[dom][0]} |" for e, dom in nums]
    out += ["", "## Reference tables", ""]
    out += [f"- [{e['title']}]({home(e)}) ({DOMAINS[dom][0]})" for e, dom in tables]
    out += ["", "## The full entries, as plain text", ""]
    out += [f"- [{l}]({SITE}/fitness/{d}.md): {b}" for d, (l, b) in DOMAINS.items()]
    return "\n".join(out) + "\n" + md_footer(meta, "/" + pages.slug["reference"])


def md_sources(lib, meta, pages, corrections):
    """Call inside lib.counting() with every page's citations, like the page it mirrors."""
    keys = sorted((k for k in lib.by_id if lib.uses[k]), key=lambda k: (lib.label[k].lower(), k))
    out = ["# Fitness sources, grading and corrections: KiteSink", "",
           f"Where the KiteSink fitness field guide comes from: how entries are graded, what has been corrected, and all {len(keys)} sources. "
           "Each source was checked against its record.", "",
           "## How the entries are graded", ""]
    out += [f"- {CONF[c]}: {CONF_HELP[c]}" for c in CONF]
    if any(lib.by_id[k].get("type") == "article" for k in keys):
        out += ["", "## Articles", "", ARTICLE_NOTE]
    if corrections:
        out += ["", "## Corrections", "", "What changed after an entry was published, newest first.", ""]
        for r in corrections:
            href = correction_href(r, pages, "")
            out.append(f"- **{r['date']} · {r['title']}**: {r['note']}" + (f" ({SITE}{href})" if href else ""))
    out += ["", f"## All {len(keys)} sources, A to Z", ""]
    for k in keys:
        src = lib.by_id[k]
        authors = src.get("authors") or []
        line = f"- {', '.join(authors[:3])}{' et al.' if len(authors) > 3 else ''} ({src.get('year', '')}). {src.get('title', '').rstrip('.')}."
        if src.get("journal"):
            line += f" *{src['journal']}*"
            if src.get("volume"):
                line += " " + str(src["volume"]) + (f"({src['issue']})" if src.get("issue") else "")
            if src.get("pages"):
                line += ":" + str(src["pages"])
            line += "."
        if src.get("edition"):
            line += f" {src['edition']}."
        url = ("https://doi.org/" + src["doi"]) if src.get("doi") else src.get("url", "")
        line += (f" {url}" if url else "") + f" ({src_type(src)}, cited {lib.uses[k]}×)"
        out.append(line)
    return "\n".join(out) + "\n" + md_footer(meta, "/" + pages.slug["sources"])


def md_index(meta, numbers, counts, pages):
    """The hub's twin: what the section is, every page's twin, and how sources are handled."""
    def twin(key):
        return f"{SITE}/fitness/{pages.slug[key]}.md"
    out = ["# KiteSink Fitness", "",
           f"Free training and nutrition reference by Truman Kitos-Lindsey. The field guide holds {numbers['n:total']} entries in "
           f"{numbers['n:areas']} areas, and each entry names its sources and says how well supported it is. Around it: common claims "
           "checked against the research, a glossary, an index of key numbers and reference tables, and eight calculators that run in "
           "the browser. Vantix, a periodization app, is the flagship project on the page.",
           "", "## The field guide, by area", ""]
    for name, doms in GROUPS:
        out += [f"### {name}", ""]
        out += [f"- [{DOMAINS[d][0]}]({twin(d)}): {DOMAINS[d][1]} {count_of(counts[d], 'entry', 'entries')}." for d in doms]
        out.append("")
    out += ["## Reference", "",
            f"- [Claims, checked]({twin('claims')}): {numbers['n:claims']} common claims, each with a verdict, who was studied, and the source.",
            f"- [Glossary]({twin('glossary')}): the {numbers['n:terms']} terms the areas use, in plain words. Each term is defined here once.",
            f"- [Key numbers and tables, indexed]({twin('reference')}): {numbers['n:numbers']} key numbers and {numbers['n:tables']} reference tables, "
            "each with a link to the page that holds it.",
            f"- [Sources and corrections]({twin('sources')}): how entries are graded, the corrections log, and all {numbers['n:sources']} sources.", "",
            "## Calculators (on the page, no sign-up)", "",
            f"- Energy and macro calculator: {SITE}/fitness#macros", f"- Effective reps explorer: {SITE}/fitness#reps",
            f"- 1RM and load calculator: {SITE}/fitness#loads", f"- Travel workout builder: {SITE}/fitness#travel",
            f"- Meet attempt planner: {SITE}/fitness#attempts",
            f"- Diet planner (a weekly deficit from a chosen number of diet days a week, with protein that rises with the deficit; saves nothing): {SITE}/fitness#plan",
            f"- Activity multiplier (the daily activity factor from one activity or a whole day of them, on your own resting energy): {SITE}/fitness#activity",
            f"- Navy body fat (the US Navy tape method: height, neck, waist and, for women, hips): {SITE}/fitness#bodyfat", "",
            "## Vantix", "",
            "Vantix is a periodization app for lifters. Its free core (v1.0) is in progress, with a target of 31 December 2026. Paid tiers (Plus, and Pro for coaches) are planned with no prices set. "
            f"Details and the waiting list: {SITE}/vantix", "",
            "## How sources are handled", "",
            "Every entry names the sources it rests on, and each source was checked against its record. "
            "Papers link to their DOI; rulebooks, guidelines and articles link to their address. " + ARTICLE_NOTE + " "
            f"When a published entry changes what it says, the change is logged with its date at {twin('sources')}.", "",
            "## How the entries are graded", ""]
    out += [f"- {CONF[c]}: {CONF_HELP[c]}" for c in CONF]
    return "\n".join(out) + "\n" + md_footer(meta)


# ----------------------------------------------------------------- the pages under /fitness/
# One page per row of routes.json, all poured into templates/sub.html. Every entry has one
# home: a term on the glossary, a claim on the claims page, anything else on its area's page.
KINDS = ("area", "claims", "glossary", "reference", "sources")
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")


def date_label(iso):
    """'2026-11-14' -> '14 November 2026'."""
    year, month, day = (int(x) for x in iso.split("-"))
    return f"{day} {MONTHS[month - 1]} {year}"


def count_of(n, one, many=None):
    return f"{n} {one if n == 1 else many or one + 's'}"


def load_routes():
    """The rows of routes.json, checked: one page per area and one of each other kind."""
    routes = json.loads((SRC / "routes.json").read_text(encoding="utf-8"))["routes"]
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
        slugs[r["slug"]] += 1
        holds[r["area"] if r["kind"] == "area" else r["kind"]] += 1
    twice = [k for k, n in slugs.items() if n > 1]
    if twice:
        raise SystemExit("routes.json: more than one row for " + ", ".join(twice))
    order = list(DOMAINS) + [k for k in KINDS if k != "area"]
    for want in order:
        if holds[want] != 1:
            raise SystemExit(f"routes.json: expected one page for {want}, found {holds[want]}")
    # whatever order the file is in, the pages come out in the hub's: the areas, then the rest
    return sorted(routes, key=lambda r: order.index(r["area"] if r["kind"] == "area" else r["kind"]))


def route_label(r):
    """A page's short name: in the sub-nav and the breadcrumb."""
    return r.get("label") or (DOMAINS[r["area"]][0] if r["kind"] == "area" else r["kind"].capitalize())


class Pages:
    """The pages under /fitness/, and which one is the home of each entry."""

    def __init__(self, routes, data):
        self.routes = routes
        self.slug = {(r["area"] if r["kind"] == "area" else r["kind"]): r["slug"] for r in routes}
        self.home = {}
        for dom in DOMAINS:
            for e in data[dom]["entries"]:
                self._place(e["id"], self.slug["glossary"] if e["type"] == "term" else self.slug[dom])
        for c in data["claims"]["entries"]:
            self._place(c["id"], self.slug["claims"])

    def _place(self, entry_id, slug):
        if entry_id in self.home:
            raise SystemExit(f"two entries share the id {entry_id}")
        self.home[entry_id] = slug

    def url(self, key):
        """The address of the page for an area, or for 'claims', 'glossary', 'reference', 'sources'."""
        return "/fitness/" + self.slug[key]

    def href(self, entry_id, here):
        """How the page `here` links to an entry: #id on the entry's own page, its full address anywhere else."""
        home = self.home[entry_id]
        return f"#{entry_id}" if home == here else f"/fitness/{home}#{entry_id}"


def band(sid, num, h2, aside, inner):
    """A section with the site's usual heading row. h2 and aside are HTML."""
    return (
        f'  <section id="{sid}" class="k-band" aria-labelledby="h-{sid}">\n    <div class="k-wrap">\n'
        f'      <header class="k-shead">\n        <div><span class="k-num">{esc(num)}</span> <h2 class="k-h2" id="h-{sid}">{h2}</h2></div>\n'
        + (f'        <p class="k-small fr-aside">{aside}</p>\n' if aside else "") +
        f'      </header>\n      {inner}\n    </div>\n  </section>'
    )


def bare_band(sid, label, inner):
    """A section with no heading of its own: the page's one list, straight under the h1."""
    return f'  <section id="{sid}" class="k-band" aria-label="{esc(label)}">\n    <div class="k-wrap">\n      {inner}\n    </div>\n  </section>'


def lens(counts):
    """The area switch, as a filter of its own (the page script reads data-facet)."""
    return '<div class="k-seg k-seg--scroll lens" data-facet="area" role="group" aria-label="Area">' + domain_switch(counts) + "</div>"


def sources_band(lib, pages):
    """The sources the page cited, each with the number of times it did. Open in the HTML; the
    page script folds it. Call this last, inside the page's lib.counting()."""
    keys = sorted((k for k in lib.by_id if lib.uses[k]), key=lambda k: (lib.label[k].lower(), k))
    if not keys:
        return 0, ""
    n = len(keys)
    aside = (f'{count_of(n, "source")}, each checked against its record. '
             f'<a class="k-inline" href="{pages.url("sources")}">How entries are graded, and every source</a>.')
    inner = (f'<details class="src-wrap" id="src-wrap" open>\n        <summary>{"The one source" if n == 1 else f"The {n} sources"} cited on this page, A to Z</summary>\n'
             f'        <ol class="sources" id="src-list">' + "\n".join(lib.entry_html(k) for k in keys) + "</ol>\n      </details>")
    return n, band("sources", "Sources", "Cited on <em>this page.</em>", aside, inner)


def page_area(lib, data, pages, route):
    """One area: the timeline first where the area has one, then guidance and mistakes, key
    numbers and tables, then links out to the area's terms and claims, then its sources."""
    dom, here = route["area"], route["slug"]
    d = data[dom]
    topics = OrderedDict((t["id"], t["label"]) for t in d.get("topics", []))

    def of(*kinds):
        return [e for e in d["entries"] if e["type"] in kinds]

    def topic_of(e, fallback):
        return topics.get(e.get("topic")) or fallback

    sections = []   # (id, name in the "on this page" row, count, html)

    # An area with steps (a meet) opens with its timeline and keeps its lists, the bag, under it.
    # Any other area's checklists get a section of their own further down.
    lists = of("checklist")
    if of("step"):
        timeline, n_steps = timeline_html(lib, dom, d)
        timeline += "".join("\n" + checklist_html(lib, dom, e, "packed") for e in lists)
        aside = f'{count_of(n_steps, "step")}, then the bag list. Open a step to read it.'
        sections.append(("timeline", "Timeline", n_steps, band("timeline", "In order", "From sign-up <em>to the drive home.</em>", aside, timeline)))
        lists = []

    entries = guide_order(of("note", "mistake"), topics)
    if entries:
        def choose(name, label, pairs, field):   # only the choices this page has, each with its count
            n = Counter(e.get(field) for e in entries)
            return facet(name, [(v, l) for v, l in pairs if n[v]], label, counts=n)
        rail = (
            '<div class="gx-rail" id="g-rail">'
            + choose("topic", "Topic", topics.items(), "topic")
            + choose("kind", "Kind", [("note", "Guidance"), ("mistake", "Mistakes")], "type")
            + choose("level", "Level", LEVELS.items(), "level")
            + choose("conf", "Support", CONF.items(), "confidence")
            + "</div>"
        )
        def plain(label):   # "RPE and velocity" keeps its capitals; "Weekly volume" loses its one
            return " ".join(w if w.isupper() else w.lower() for w in label.split())
        hint = "Search: " + ", ".join(plain(l) for l in list(topics.values())[:3]) + "…" if topics else "Search these entries…"
        rows = [item_html(lib, dom, e, i, topics, meta=topic_of(e, DOMAINS[dom][0])) for i, e in enumerate(entries)]
        guide = (
            '<div class="gx"><details class="gx-filters" id="g-filters" open><summary>Filters <span id="g-active"></span></summary>' + rail + "</details>"
            '<div class="gx-main"><div class="gx-bar"><label class="k-vh" for="g-q">Search the guidance and mistakes</label>'
            f'<input class="k-input gx-q" id="g-q" type="search" placeholder="{esc(hint)}" autocomplete="off">' + GUIDE_SORT + "</div>"
            '<p class="gx-count" id="g-count" aria-live="polite"></p>'
            '<div class="g-list" id="g-list">' + "\n".join(rows) + "</div>"
            '<p class="gx-empty" id="g-empty" hidden>Nothing matches those filters. <button type="button" class="k-linkbtn" data-reset="guide">Clear them</button></p>'
            "</div></div>"
        )
        aside = f'{count_of(len(entries), "entry", "entries")}. Narrow by topic, level or by how well supported a point is, then open one.'
        sections.append(("guide", "Guidance", len(entries), band("guide", "Field guide", "Guidance and <em>mistakes.</em>", aside, guide)))

    nums = of("number")
    if nums:
        head = ('<thead><tr><th scope="col"><button type="button" data-sort="n">Number</button></th>'
                '<th scope="col"><button type="button" data-sort="t">What it is</button></th>'
                '<th scope="col"><button type="button" data-sort="c">Support</button></th></tr></thead>')
        table = ('<div class="nx-wrap"><table class="nx" id="n-table">' + head + "<tbody>"
                 + "\n".join(number_row(lib, dom, e, i, area=False) for i, e in enumerate(nums)) + "</tbody></table></div>")
        aside = f'{count_of(len(nums), "number")}. Choose a column heading to sort by it.'
        sections.append(("numbers", "Key numbers", len(nums), band("numbers", "Key numbers", "The figures <em>worth knowing.</em>", aside, table)))

    tables = of("table")
    if tables:
        inner = '<div id="t-list">\n' + "\n".join(table_html(lib, dom, e, meta=topic_of(e, "Table")) for e in tables) + "\n      </div>"
        aside = f'{count_of(len(tables), "table")}. Open one; wide ones scroll sideways.'
        sections.append(("tables", "Tables", len(tables), band("tables", "Reference", "Tables to <em>look things up.</em>", aside, inner)))

    if lists:
        inner = '<div class="ck-list">\n' + "\n".join(checklist_html(lib, dom, e) for e in lists) + "\n      </div>"
        aside = f'{count_of(len(lists), "checklist")}. Your ticks are remembered in this browser and go nowhere else.'
        sections.append(("checklists", "Checklists", len(lists), band("checklists", "Checklists", "Lists to <em>work through.</em>", aside, inner)))

    # The area's terms and claims live on other pages: link to them, never repeat them.
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
    n_ev = Counter(c["evidence"] for c in claims)
    controls = (
        '<div class="qx-controls" id="q-controls">' + lens({d: n_area[d] for d in DOMAINS})
        + '<details class="gx-filters qx-filters" id="q-filters" open><summary>Filters <span id="q-active"></span></summary><div class="gx-rail">'
        + facet("verdict", [(v, VERDICTS[v][0]) for v in VERDICTS if n_verdict[v]], "Verdict", counts=n_verdict)
        + facet("tag", [(t, TAGS[t]) for t in TAGS if n_tag[t]], "Topic", counts=n_tag)
        + facet("evidence", [(v, EVIDENCE[v]) for v in EVIDENCE if n_ev[v]], "Evidence", counts=n_ev)
        + "</div></details>"
        + '<div class="gx-bar"><label class="k-vh" for="q-q">Search the claims</label>'
          '<input class="k-input gx-q" id="q-q" type="search" placeholder="Search: creatine, failure, fasting, kidneys…" autocomplete="off">'
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
    terms = [(e, dom) for dom in DOMAINS for e in data[dom]["entries"] if e["type"] == "term"]
    terms.sort(key=lambda x: x[0]["title"].lower())
    rows = []
    for e, dom in terms:
        cite = lib.cite_html(dom, e.get("sources", [])).replace('<p class="cite">', '<dd class="cite">').replace("</p>", "</dd>")
        rows.append(f'<div class="gl-item" id="{esc(e["id"])}" data-d="{dom}"><dt>{esc(e["title"])}</dt>'
                    f'<dd>{esc(e["take"])} <span class="gl-d">{esc(DOMAINS[dom][0])}</span></dd>{cite}</div>')
    n_area = Counter(dom for _, dom in terms)
    inner = (lens({d: n_area[d] for d in DOMAINS})
             + '<div class="gx-bar"><label class="k-vh" for="gl-q">Search the glossary</label>'
               '<input class="k-input gx-q" id="gl-q" type="search" placeholder="Search a term: RIR, taper, TDEE, ApoB…" autocomplete="off">'
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
    nums = [(e, dom) for dom in DOMAINS for e in data[dom]["entries"] if e["type"] == "number"]
    tables = [(e, dom) for dom in DOMAINS for e in data[dom]["entries"] if e["type"] == "table"]
    head = ('<thead><tr><th scope="col"><button type="button" data-sort="t">Number</button></th>'
            '<th scope="col"><button type="button" data-sort="n">Value</button></th>'
            '<th scope="col"><button type="button" data-sort="u">Unit</button></th>'
            '<th scope="col"><button type="button" data-sort="d">Area</button></th></tr></thead>')
    rows = [
        f'<tr data-d="{dom}" data-n="{e["sort"]}" data-o="{i}"><th scope="row"><a href="{esc(pages.href(e["id"], here))}">{esc(e["title"])}</a></th>'
        f'<td class="ix-v">{esc(e["value"])}</td><td class="ix-u">{esc(e.get("unit", ""))}</td><td class="nx-d">{esc(DOMAINS[dom][0])}</td></tr>'
        for i, (e, dom) in enumerate(nums)
    ]
    table = '<div class="nx-wrap"><table class="nx ix" id="n-table">' + head + "<tbody>" + "\n".join(rows) + "</tbody></table></div>"
    groups = []
    for dom, (label, _) in DOMAINS.items():
        mine = [e for e, d in tables if d == dom]
        if mine:
            groups.append(f'<div><h3 class="fx-label">{esc(label)}</h3><ul>'
                          + "".join(f'<li><a href="{esc(pages.href(e["id"], here))}">{esc(e["title"])}</a></li>' for e in mine) + "</ul></div>")
    sections = []
    if nums:
        aside = f'{count_of(len(nums), "number")}. Choose a column heading to sort by it; choose a number to read it, with its sources, on its own page.'
        sections.append(("numbers", "Key numbers", len(nums), band("numbers", "Key numbers", "The figures <em>worth knowing.</em>", aside, table)))
    if tables:
        aside = f'{count_of(len(tables), "table")}. Each opens on the page of its area.'
        sections.append(("tables", "Tables", len(tables), band("tables", "Reference", "Tables to <em>look things up.</em>", aside, '<div class="ix-tables">' + "\n".join(groups) + "</div>")))
    return sections


def load_corrections(pages):
    """The rows of corrections.json, newest first (rows of one day keep the order of the file)."""
    rows = json.loads((SRC / "corrections.json").read_text(encoding="utf-8"))["corrections"]
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


LOG_SHOWN = 6   # corrections shown before the fold on /fitness/sources


def page_sources(lib, pages, route, corrections):
    """How entries are graded, the corrections log, and every source. Call inside lib.counting()
    with the citations of every page added up, so each source shows how often it is cited."""
    here = route["slug"]
    keys = sorted((k for k in lib.by_id if lib.uses[k]), key=lambda k: (lib.label[k].lower(), k))
    log = []
    for r in corrections:
        href = correction_href(r, pages, here)
        title = f'<a href="{esc(href)}">{esc(r["title"])}</a>' if href else esc(r["title"])
        log.append(f'<li><time datetime="{esc(r["date"])}">{esc(date_label(r["date"]))}</time>'
                   f'<div><p class="fr-log-t">{title}</p><p>{esc(r["note"])}</p></div></li>')
    listing = (
        '<div class="gx-bar"><label class="k-vh" for="src-q">Search the sources</label>'
        '<input class="k-input gx-q" id="src-q" type="search" placeholder="Search: an author, a year, a journal…" autocomplete="off">'
        '<p class="gx-count" id="src-count" aria-live="polite"></p></div>'
        '<div id="src-wrap"><ol class="sources" id="src-list">' + "\n".join(lib.entry_html(k) for k in keys) + "</ol></div>"
        '<p class="gx-empty" id="src-empty" hidden>No source matches. <button type="button" class="k-linkbtn" data-reset="sources">Clear the search</button></p>'
    )
    sections = [("graded", "Grading", None, band("graded", "Grading", "How entries <em>are graded.</em>",
                 "Every entry carries one of these five labels. It says how much stands behind the point.", legend_html()))]
    if log:
        aside = "What changed after an entry was published, and when. Newest first."
        # the newest few stay in view; the rest fold away, still in the HTML
        shown, rest = log[:LOG_SHOWN], log[LOG_SHOWN:]
        body = '<ul class="fr-log">' + "\n".join(shown) + "</ul>"
        if rest:
            body += (f'<details class="fr-log-more"><summary>All {len(log)} corrections</summary>'
                     '<ul class="fr-log">' + "\n".join(rest) + "</ul></details>")
        sections.append(("corrections", "Corrections", len(log), band("corrections", "Corrections", "What has <em>been corrected.</em>", aside, body)))
    aside = "Each one was checked against its record. Search by author, year, title or journal."
    if any(lib.by_id[k].get("type") == "article" for k in keys):
        listing = f'<p class="k-small fr-note">{esc(ARTICLE_NOTE)}</p>' + listing
    sections.append(("sources", "All sources", len(keys), band("sources", "Sources", f"All {len(keys)} sources, <em>A to Z.</em>", aside, listing)))
    return sections


def nav_groups(pages):
    """The pages under /fitness/ as the hub and the navigation group them: [(name, [route])]."""
    by = {(r["area"] if r["kind"] == "area" else r["kind"]): r for r in pages.routes}
    groups = [(name, [by[d] for d in doms]) for name, doms in GROUPS]
    return groups + [("Reference", [by[k] for k in KINDS if k != "area"])]


def subnav_links(routes, slug):
    return "".join(f'<li><a href="/fitness/{r["slug"]}"' + (' class="on" aria-current="page"' if r["slug"] == slug else "")
                   + f">{esc(route_label(r))}</a></li>" for r in routes)


def subnav_html(pages, slug):
    """The navigation between the fitness pages, grouped as on the hub, the current page marked."""
    out = []
    for i, (name, routes) in enumerate(nav_groups(pages), 1):
        out.append(f'<div class="fr-nav-g"><p class="fr-nav-l" id="fr-nav-g{i}">{esc(name)}</p><ul aria-labelledby="fr-nav-g{i}">{subnav_links(routes, slug)}</ul></div>')
    return "\n    ".join(out)


def subnav_here_html(pages, slug):
    """The current page's own group, shown in the bar on wide screens: the pages a reader is
    most likely to want next, one click away, while the full list stays folded."""
    for name, routes in nav_groups(pages):
        if any(r["slug"] == slug for r in routes):
            return (f'<div class="fr-nav-here"><p class="fr-nav-l">{esc(name)}</p>'
                    f'<ul aria-label="{esc(name)} pages">{subnav_links(routes, slug)}</ul></div>')
    return ""


# ---- old links. The one-page /fitness put everything under /fitness#<id>. Entries and sources
# keep their ids on their new pages. This table is for the rest, the sections and controls of
# the old page that are not on the hub: old id -> (the page that replaces it, the section of that
# page the id is pinned to when no element there carries it already; None is the top of the page).
# A key that ends in "-" stands for every old id that starts with it.
# scripts/fixtures/fitness-legacy-ids.txt lists every id the old page had.
LEGACY_SECTIONS = {
    **{d: (d, None) for d in ("hypertrophy", "powerlifting", "meet", "nutrition", "diet", "health")},   # #diet chose that area
    "meet-day": ("meet", "timeline"), "h-meet": ("meet", "timeline"),
    "g-": ("basics", "guide"),            # the field guide's own controls: every area page has them
    "claims": ("claims", "claims"), "h-claims": ("claims", "claims"), "q-": ("claims", "claims"),
    "glossary": ("glossary", "terms"), "h-glossary": ("glossary", "terms"), "gl-": ("glossary", "terms"),
    "numbers": ("reference", "numbers"), "h-numbers": ("reference", "numbers"),
    "n-table": ("reference", "numbers"), "n-empty": ("reference", "numbers"),
    "tables": ("reference", "tables"), "h-tables": ("reference", "tables"),
    "t-list": ("reference", "tables"), "t-empty": ("reference", "tables"),
    "sources": ("sources", "sources"), "h-sources": ("sources", "sources"),
    "src-wrap": ("sources", "sources"), "src-list": ("sources", "sources"),
}
LEGACY_IDS = ROOT / "scripts" / "fixtures" / "fitness-legacy-ids.txt"


def legacy_place(old):
    """(page key, section) for a section or control id of the old page, or None."""
    if old in LEGACY_SECTIONS:
        return LEGACY_SECTIONS[old]
    return next((v for k, v in LEGACY_SECTIONS.items() if k.endswith("-") and old.startswith(k)), None)


def ids_in(text):
    return re.findall(r'\sid="([^"]+)"', text)


def pin_legacy(page, key, legacy):
    """Give a page the old ids it replaces and does not have yet, as empty anchors, so an old
    link lands on the right part of it. key is the page's area or kind."""
    have = set(ids_in(page))
    for old in legacy:
        place = legacy_place(old)
        if not place or place[0] != key or old in have:
            continue
        anchor = f'<span class="fr-was" id="{esc(old)}"></span>'
        if place[1] is None:
            opening = re.search(r'<main id="main">\n', page)
        else:
            opening = re.search(rf'<section id="{place[1]}" class="k-band"[^>]*>\n\s*<div class="k-wrap[^"]*">\n', page)
        if not opening:
            raise SystemExit(f"the old id {old} belongs in the {place[1] or 'top'} section of the {key} page, which has no such section")
        page = page[:opening.end()] + f"      {anchor}\n" + page[opening.end():]
        have.add(old)
    return page


# ----------------------------------------------------------------- each page's hero card
# The card in the top right of every page under /fitness/: a small working widget on six pages,
# a rotating key number (or claim, or term) on the rest, and "on this page" under it. All of it
# is in the HTML; /fitness-ref.js only cycles the rotator and runs the widgets' arithmetic.
# Each widget names the entry its numbers come from, and the build checks that entry exists.
CARD_WIDGETS = {
    "nutrition": ("protein", "nut-protein-range"),
    "diet": ("rate", "diet-deficit-rate"),
    "health": ("who", "hlth-who-weekly-targets"),
    "powerlifting": ("zones", "pl-table-intensity-zones"),
    "meet": ("meet", None),
    "sources": ("mix", None),
}
# The numbers a widget computes with must be what its entry says. If an entry is revised, the build
# stops here until the widget (in widget_html and /fitness-ref.js) is brought into line.
WIDGET_SAYS = {
    "nut-protein-range": ("1.6 to 2.2 g per kg",),
    "diet-deficit-rate": ("0.5 to 1 percent of body weight a week",),
    "hlth-who-weekly-targets": ("150 to 300 minutes of moderate", "75 to 150 minutes of vigorous", "2 or more days"),
}
ROTATE = 12   # items in a rotator: enough to browse, few enough to keep the page light
MEET_STAGES = [   # WHEN keys -> (days before the meet at which the stage starts; the meet is day 0)
    ("months-out", 9999), ("weeks-out", 28), ("week-before", 7), ("day-before", 1), ("weigh-in", 0),
    ("warm-up", 0), ("platform", 0), ("between-lifts", 0), ("after", -1),
]


def conf_badge(c):
    return f'<span class="fc-badge c-{esc(c)}">{esc(CONF[c])}</span>'


def spread(items, n=ROTATE):
    """n items spread evenly through a list, the best supported first."""
    order = {c: i for i, c in enumerate(CONF)}
    items = sorted(items, key=lambda e: order.get(e.get("confidence"), 9))
    if len(items) <= n:
        return items
    return [items[round(i * (len(items) - 1) / (n - 1))] for i in range(n)]


def rotator(label, items, render):
    if not items:
        return ""
    lis = "".join(f'<li{"" if i == 0 else " hidden"}>{render(e)}</li>' for i, e in enumerate(items))
    more = (f'<button type="button" class="fc-next" hidden>Another <span aria-hidden="true">→</span></button>' if len(items) > 1 else "")
    return (f'<div class="fc-rot" data-rot><div class="fc-top"><p class="k-label">{esc(label)}</p>'
            f'<span class="fc-of" aria-hidden="true">1 of {len(items)}</span></div><ul class="fc-items" aria-live="polite">{lis}</ul>{more}</div>')


def number_card(e, href):
    return (f'<a class="fc-num" href="{href}"><b>{esc(e["value"])}</b>' + (f' <small>{esc(e.get("unit", ""))}</small>' if e.get("unit") else "") + "</a>"
            f'<p class="fc-t"><a href="{href}">{esc(e["title"])}</a></p>{conf_badge(e["confidence"])}')


def widget_html(kind, entry, data, lib, pages, here):
    def ref(eid):
        dom = next(d for d in DOMAINS if any(x["id"] == eid for x in data[d]["entries"]))
        e = next(x for x in data[dom]["entries"] if x["id"] == eid)
        return e, pages.href(eid, here)
    if kind == "protein":
        e, href = ref(entry)
        return ('<div class="fw" data-w="protein" data-lo="1.6" data-hi="2.2"><p class="k-label">Protein for you</p>'
                '<div class="fw-in"><label for="fc-kg">Body weight</label><span class="with-unit"><input class="k-input" id="fc-kg" type="number" inputmode="decimal" min="30" max="660" step="0.5" value="75"><span class="fw-u">kg</span></span>'
                '<button type="button" class="fw-unit" aria-label="Switch to pounds">lb</button></div>'
                '<p class="fw-out"><b class="fw-a">120–165</b> g a day</p>'
                f'<p class="fw-note">1.6 to 2.2 g per kg (0.7 to 1.0 g per lb). <a href="{href}">The entry</a> {conf_badge(e["confidence"])}</p></div>')
    if kind == "rate":
        e, href = ref(entry)
        return ('<div class="fw" data-w="rate" data-lo="0.5" data-hi="1"><p class="k-label">A pace for you</p>'
                '<div class="fw-in"><label for="fc-kg">Body weight</label><span class="with-unit"><input class="k-input" id="fc-kg" type="number" inputmode="decimal" min="30" max="660" step="0.5" value="75"><span class="fw-u">kg</span></span>'
                '<button type="button" class="fw-unit" aria-label="Switch to pounds">lb</button></div>'
                '<p class="fw-out"><b class="fw-a">0.38–0.75</b> <span class="fw-ou">kg</span> a week</p>'
                f'<p class="fw-note">0.5 to 1 percent of body weight a week, the usual pace for keeping muscle. <a href="{href}">The entry</a> {conf_badge(e["confidence"])}</p></div>')
    if kind == "who":
        e, href = ref(entry)
        ring = lambda cls, label: (f'<div class="fw-ring {cls}"><svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18"/><circle class="fw-arc" cx="22" cy="22" r="18" pathLength="100"/></svg>'
                                   f'<p><b class="fw-rv">0</b><small>{label}</small></p></div>')
        return ('<div class="fw" data-w="who"><p class="k-label">Your week against WHO</p><div class="fw-rings">'
                + ring("r-act", "of 150 min") + ring("r-str", "of 2 days") + '</div>'
                '<label class="fw-sl"><span>Moderate activity <b class="fw-mod">90</b> min a week</span><input type="range" class="k-range" id="fc-mod" min="0" max="420" step="10" value="90"></label>'
                '<label class="fw-sl"><span>Vigorous <b class="fw-vig">0</b> min, counted double</span><input type="range" class="k-range" id="fc-vig" min="0" max="210" step="5" value="0"></label>'
                '<label class="fw-sl"><span>Strength days <b class="fw-str">1</b> a week</span><input type="range" class="k-range" id="fc-str" min="0" max="7" step="1" value="1"></label>'
                f'<p class="fw-note">150 to 300 minutes of moderate activity, or half as much vigorous, plus strength work on 2 or more days. <a href="{href}">The entry</a> {conf_badge(e["confidence"])}</p></div>')
    if kind == "zones":
        e, href = ref(entry)
        rows = e["rows"]
        def pcts(cell):
            lo, hi = re.findall(r"\d+", cell)[:2]
            return int(lo), int(hi)
        btns = "".join(f'<button type="button" class="fw-zone" aria-pressed="{"true" if i == 2 else "false"}" data-lo="{pcts(r[1])[0]}" data-hi="{pcts(r[1])[1]}" data-reps="{esc(r[2])}" data-why="{esc(r[3])}" '
                       f'><span>{esc(r[0])}</span><small>{pcts(r[1])[0]}–{pcts(r[1])[1]}%</small></button>' for i, r in enumerate(rows))
        r = rows[2]
        lo, hi = pcts(r[1])
        return ('<div class="fw" data-w="zones"><p class="k-label">Intensity zones</p>'
                f'<div class="fw-zones" role="group" aria-label="Zones by percent of one-rep max">{btns}</div>'
                f'<p class="fw-out"><b class="fw-a">{esc(r[0])} · {lo}–{hi}%</b></p><p class="fw-z">{esc(r[2])} reps a set. {esc(r[3])}.</p>'
                '<div class="fw-in"><label for="fc-max">Your max</label><span class="with-unit"><input class="k-input" id="fc-max" type="number" inputmode="decimal" min="20" max="500" step="2.5" placeholder="—"><span class="fw-u">kg</span></span>'
                '<button type="button" class="fw-unit" aria-label="Switch to pounds">lb</button></div>'
                '<p class="fw-kg" hidden></p>'
                f'<p class="fw-note">Common coaching zones; reps at a given percentage vary by lifter. <a href="{href}">The table</a> {conf_badge(e["confidence"])}</p></div>')
    if kind == "meet":
        steps = [x for x in data["meet"]["entries"] if x["type"] == "step"]
        lis = []
        for when, starts in MEET_STAGES:
            group = [x for x in steps if x.get("when") == when]
            if not group:
                continue
            lis.append(f'<li data-from="{starts}"><a href="#{esc(group[0]["id"])}"><span>{esc(WHEN[when])}</span><b>{len(group)}</b></a></li>')
        return ('<div class="fw" data-w="meet"><p class="k-label">From sign-up to the platform</p>'
                '<div class="fw-in"><label for="fc-date">Meet date</label><input class="k-input" id="fc-date" type="date"></div>'
                '<p class="fw-out fw-when" hidden></p>'
                f'<ol class="fw-tl">{"".join(lis)}</ol>'
                '<p class="fw-note">The steps in each stage, in order. Put in your date to see where you are.</p></div>')
    if kind == "mix":
        rows = [e for d in DOMAINS for e in data[d]["entries"] if e["type"] != "term"] + data["claims"]["entries"]
        n = Counter(e.get("confidence") for e in rows)
        total = sum(n[c] for c in CONF)
        bar = "".join(f'<i class="c-{c}" style="flex-grow:{n[c]}" title="{esc(CONF[c])}: {n[c]}"></i>' for c in CONF if n[c])
        legend = "".join(f'<li><i class="c-{c}"></i>{esc(CONF[c])}<b>{n[c]}</b></li>' for c in CONF if n[c])
        types = Counter(src_type(s) for s in lib.by_id.values())
        tlist = "".join(f"<li>{esc(t)}<b>{k}</b></li>" for t, k in types.most_common(6))
        return ('<div class="fw" data-w="mix"><p class="k-label">How well supported the guide is</p>'
                f'<div class="fw-bar" role="img" aria-label="{total} entries by grade: ' + ", ".join(f"{CONF[c]} {n[c]}" for c in CONF if n[c]) + f'">{bar}</div>'
                f'<ul class="fw-leg">{legend}</ul>'
                f'<p class="k-label fw-sub">{len(lib.by_id)} sources, by kind</p><ul class="fw-types">{tlist}</ul></div>')
    raise SystemExit(f"unknown card widget {kind}")


def hero_card(route, data, lib, pages, jump):
    """The card for one page: a widget or a rotator, then the jump links."""
    here, kind = route["slug"], route["kind"]
    key = route["area"] if kind == "area" else kind
    body = ""
    if key in CARD_WIDGETS:
        w, entry = CARD_WIDGETS[key]
        if entry and entry not in pages.home:
            raise SystemExit(f"the {key} page's card names {entry}, which is not an entry")
        if entry in WIDGET_SAYS:
            take = next(e["take"] for d in DOMAINS for e in data[d]["entries"] if e["id"] == entry)
            lost = [w for w in WIDGET_SAYS[entry] if w not in take]
            if lost:
                raise SystemExit(f"the {key} page's widget computes with numbers its entry {entry} no longer states: {lost}")
        body = widget_html(w, entry, data, lib, pages, here)
    elif kind == "area":
        nums = [e for e in data[key]["entries"] if e["type"] == "number"]
        body = rotator("Key number", spread(nums), lambda e: number_card(e, pages.href(e["id"], here)))
    elif kind == "reference":
        nums = [e for d in DOMAINS for e in data[d]["entries"] if e["type"] == "number"]
        body = rotator("Key number", spread(nums), lambda e: number_card(e, pages.href(e["id"], here))
                       .replace('<p class="fc-t">', f'<p class="fc-t"><span class="fc-area">{esc(DOMAINS[next(d for d in DOMAINS if e in data[d]["entries"])][0])}</span> ', 1))
    elif kind == "claims":
        cl = data["claims"]["entries"]
        n = Counter(c["verdict"] for c in cl)
        meter = "".join(f'<i class="{VERDICTS[v][1]}" style="flex-grow:{n[v]}"></i>' for v in VERDICTS if n[v])
        legend = "".join(f'<li><i class="{VERDICTS[v][1]}"></i>{esc(VERDICTS[v][0])}<b>{n[v]}</b></li>' for v in VERDICTS if n[v])
        body = (f'<div class="fw"><p class="k-label">{len(cl)} claims, by verdict</p><div class="fw-bar" role="img" aria-label="'
                + ", ".join(f"{VERDICTS[v][0]} {n[v]}" for v in VERDICTS if n[v]) + f'">{meter}</div><ul class="fw-leg">{legend}</ul></div>'
                + rotator("A claim", spread(cl), lambda c: f'<p class="fc-t"><a href="{pages.href(c["id"], here)}">{esc(c["title"])}</a></p><span class="fc-verdict {VERDICTS[c["verdict"]][1]}">{esc(VERDICTS[c["verdict"]][0])}</span>'))
    elif kind == "glossary":
        terms = [e for d in DOMAINS for e in data[d]["entries"] if e["type"] == "term"]
        body = rotator("A term", spread(terms), lambda e: f'<p class="fc-term"><a href="{pages.href(e["id"], here)}">{esc(e["title"])}</a></p><p class="fc-def">{esc(e["take"])}</p>')
    if not body and not jump:
        return ""
    return f'<aside class="fr-card" aria-label="{esc(route_label(route))} at a glance">{body}{jump}</aside>'


def render_sub(template, route, pages, sections, numbers, legacy=(), card=None):
    """Pour one page into the shell. numbers fills {{n:…}} and {{updated}} in the route's own text."""
    def filled(text):
        def one(m):
            if m.group(1) not in numbers:
                raise SystemExit(f"routes.json: {route['slug']} uses {m.group(0)}, which the build does not know")
            return str(numbers[m.group(1)])
        return re.sub(r"\{\{([^}]+)\}\}", one, text)

    slug, label = route["slug"], route_label(route)
    crumbs = [("Home", SITE + "/"), ("Fitness", SITE + "/fitness"), (label, f"{SITE}/fitness/{slug}")]
    breadcrumb = json.dumps({
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [{"@type": "ListItem", "position": i, "name": name, "item": url} for i, (name, url) in enumerate(crumbs, 1)],
    }, ensure_ascii=False).replace("</", "<\\/")
    crumb = f'<li><a href="/">Home</a></li><li><a href="/fitness">Fitness</a></li><li aria-current="page">{esc(label)}</li>'
    jump = ""
    if len(sections) > 1 and route["kind"] not in ("claims", "glossary"):   # those two are one list each; the rest have sections to move between
        jump = ('<nav class="fr-jump" aria-label="On this page"><p class="k-label">On this page</p>'
                + "".join(f'<a href="#{sid}">{esc(name)}' + (f" <b>{n}</b>" if n is not None else "") + "</a>" for sid, name, n, _ in sections) + "</nav>")
    fills = {
        "slug": slug, "title": esc(filled(route["title"])), "description": esc(filled(route["description"])),
        "h1": filled(route["h1"]), "lead": esc(filled(route["lead"])), "breadcrumb": breadcrumb, "crumb": crumb,
        "subnav": subnav_html(pages, slug), "subnav_here": subnav_here_html(pages, slug), "n:pages": str(len(pages.routes)), "areas": " ".join(DOMAINS),
        "card": card(jump) if card else jump, "body": "\n\n".join(html for _, _, _, html in sections if html),
    }

    def fill(m):
        if m.group(1) not in fills:
            raise SystemExit(f"content/fitness/templates/sub.html uses {m.group(0)}, which the build does not fill")
        return fills[m.group(1)]
    page = re.sub(r"\{\{([a-z0-9:_-]+)\}\}", fill, template)
    unused = [k for k in fills if "{{" + k + "}}" not in template]
    if unused:
        raise SystemExit("content/fitness/templates/sub.html has no {{" + "}}, {{".join(unused) + "}}")
    return pin_legacy(page, route["area"] if route["kind"] == "area" else route["kind"], legacy)


def build_subpages(lib, meta, data, numbers, tool_uses, pages, legacy):
    """Every page under /fitness/ and the three twins that belong to no one area. Returns
    ({path: text}, {slug: html}). tool_uses is what the calculators on /fitness cite."""
    routes = pages.routes
    corrections = load_corrections(pages)
    template = (SRC / "templates" / "sub.html").read_text(encoding="utf-8")

    built, total = {}, Counter(tool_uses)
    for r in routes:
        if r["kind"] == "sources":
            continue
        with lib.counting(Counter()) as tally:
            if r["kind"] == "area":
                sections = page_area(lib, data, pages, r)
            elif r["kind"] == "claims":
                sections = page_claims(lib, data, pages, r)
            elif r["kind"] == "glossary":
                sections = page_glossary(lib, data, pages, r)
            else:
                sections = page_reference(data, pages, r)
        total.update(tally)
        built[r["slug"]] = render_sub(template, r, pages, sections, numbers, legacy, lambda jump, r=r: hero_card(r, data, lib, pages, jump))
    unused = [k for k in lib.by_id if not total[k]]
    if unused:
        raise SystemExit("sources no page cites: " + ", ".join(unused))
    for r in routes:   # last, so it can show how often each source is cited across all the pages
        if r["kind"] == "sources":
            with lib.counting(total):
                built[r["slug"]] = render_sub(template, r, pages, page_sources(lib, pages, r, corrections), numbers, legacy, lambda jump, r=r: hero_card(r, data, lib, pages, jump))
    check_subpages(built, pages, lib)

    out = OrderedDict((PUBLIC / "fitness" / f"{r['slug']}.html", built[r["slug"]]) for r in routes)
    out[PUBLIC / "fitness" / f"{pages.slug['glossary']}.md"] = md_glossary(lib, meta, data, pages)
    out[PUBLIC / "fitness" / f"{pages.slug['reference']}.md"] = md_reference(meta, data, pages)
    with lib.counting(total):
        out[PUBLIC / "fitness" / f"{pages.slug['sources']}.md"] = md_sources(lib, meta, pages, corrections)
    return out, built


def check_subpages(built, pages, lib):
    """Hold the pages to the one-home rule: every entry is on its home page and no other, every
    source is on the sources page, and every link from one page to another lands on something."""
    ids = {slug: Counter(ids_in(text)) for slug, text in built.items()}
    problems = []
    for slug, found in ids.items():
        problems += [f"/fitness/{slug}: the id {i} is used {n} times" for i, n in found.items() if n > 1]
    for entry_id, home in pages.home.items():
        on = [slug for slug, found in ids.items() if entry_id in found]
        if on != [home]:
            problems.append(f"{entry_id} belongs on /fitness/{home} and nowhere else; it is on {', '.join(on) or 'no page'}")
    all_sources = ids[pages.slug["sources"]]
    problems += [f"/fitness/{pages.slug['sources']} is missing the source {k}" for k in lib.by_id if "src-" + k not in all_sources]
    for slug, text in built.items():
        for target, frag in set(re.findall(r'href="(/fitness/[a-z0-9-]+)?#([^"]+)"', text)):
            where = target[len("/fitness/"):] if target else slug
            if where not in ids:
                problems.append(f"/fitness/{slug} links to {target}, which is not a page")
            elif frag not in ids[where]:
                problems.append(f"/fitness/{slug} links to {target}#{frag}, and nothing there has that id")
        linked = set(re.findall(r'href="/fitness/([a-z0-9-]+)"', text))
        problems += [f"/fitness/{slug} has no link to /fitness/{r['slug']}" for r in pages.routes if r["slug"] not in linked]
        if 'href="/fitness"' not in text:
            problems.append(f"/fitness/{slug} has no link back to /fitness")
    if problems:
        raise SystemExit("the pages under /fitness/ break the one-home rule:\n  " + "\n  ".join(problems))


# ----------------------------------------------------------------- the hub, /fitness
# What the hub says on the cards of the pages that are not areas: a blurb and what to count.
# The card's title is the page's own name, as in the navigation.
REFERENCE_CARDS = OrderedDict([
    ("claims", ("Things people say, each with a verdict, who was studied, and the source.", "{n:claims} claims")),
    ("glossary", ("Every term the areas use, defined once in plain words.", "{n:terms} terms")),
    ("reference", ("The key numbers and the look-up tables, each linked to the page that holds it.", "{n:numbers} numbers, {n:tables} tables")),
    ("sources", ("How entries are graded, what has been corrected, and every source.", "{n:sources} sources")),
])


def hub_card(href, title, blurb, count):
    return (f'<li><a class="hub-card" href="{href}"><span class="hub-t">{esc(title)}</span>'
            f'<span class="hub-b">{esc(blurb)}</span><span class="hub-n">{esc(count)}</span></a></li>')


def hub_areas(pages, counts):
    """A card per area, under the three group headings. The first heading keeps the old
    page's id "training", which the home page links to."""
    out = []
    for name, doms in GROUPS:
        gid = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        cards = "\n          ".join(hub_card(pages.url(d), DOMAINS[d][0], DOMAINS[d][1], count_of(counts[d], "entry", "entries")) for d in doms)
        out.append(f'<div class="hub-group">\n        <h3 class="hub-gh" id="{gid}">{esc(name)}</h3>\n'
                   f'        <ul class="hub-cards" aria-labelledby="{gid}">\n          {cards}\n        </ul>\n      </div>')
    return "\n      ".join(out)


def hub_reference(pages, numbers):
    if list(REFERENCE_CARDS) != [k for k in KINDS if k != "area"]:
        raise SystemExit("REFERENCE_CARDS must have a row for each kind of page that is not an area, in order")
    names = {r["kind"]: route_label(r) for r in pages.routes if r["kind"] != "area"}
    cards = []
    for key, (blurb, count) in REFERENCE_CARDS.items():
        cards.append(hub_card(pages.url(key), names[key], blurb, re.sub(r"\{([^}]+)\}", lambda m: str(numbers[m.group(1)]), count)))
    return '<ul class="hub-cards hub-cards--ref" aria-labelledby="h-reference">\n        ' + "\n        ".join(cards) + "\n      </ul>"


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
    for dom in DOMAINS:
        for e in data[dom]["entries"]:
            row = [e["id"], slugs.index(pages.home[e["id"]]), kinds.index(e["type"]), areas.index(dom), e["title"], e["take"]]
            if e["type"] == "number":
                row.append(f'{e["value"]} {e.get("unit", "")}'.strip())
            rows.append(row)
    for c in data["claims"]["entries"]:
        rows.append([c["id"], slugs.index(pages.home[c["id"]]), kinds.index("claim"), areas.index(c["domain"]), c["title"], c["take"], VERDICTS[c["verdict"]][0]])
    return {"pages": slugs, "kinds": list(SEARCH_KINDS.values()), "areas": [DOMAINS[d][0] for d in DOMAINS], "rows": rows}


def id_map(pages, lib, built, hub, legacy):
    """Where /fitness#<id> goes now: {id: slug} for every entry, every source and every id of
    the old page that is not an element of the hub. Nothing is sent to a page that lacks it."""
    hub_ids = set(ids_in(hub))
    where = OrderedDict(pages.home)
    where.update(("src-" + k, pages.slug["sources"]) for k in lib.by_id)
    lost = []
    for old in legacy:
        if old in hub_ids or old in where:
            continue
        place = legacy_place(old)
        if place:
            where[old] = pages.slug[place[0]]
        else:
            lost.append(old)
    if lost:
        raise SystemExit("ids the one-page /fitness had that are on no page now (put them back, or give them a row in LEGACY_SECTIONS): " + ", ".join(lost))
    on_page = {slug: set(ids_in(text)) for slug, text in built.items()}
    problems = [f"{i} is sent to /fitness/{slug}, which has no element with that id" for i, slug in where.items() if i not in on_page[slug]]
    problems += [f"{i} is an element of the hub and is also sent to /fitness/{where[i]}" for i in where if i in hub_ids]
    problems += [f"{i} is not an id a link can carry" for i in where if not re.fullmatch(r"[A-Za-z0-9._-]+", i)]
    if problems:
        raise SystemExit("the id map for old /fitness links is wrong:\n  " + "\n  ".join(problems))
    return where


def forward_test(where, pages, hub):
    """A regular expression for the hub's first script: true for an id that may have moved, so
    the map is fetched only then. Entries and sources are known by their prefix (src-, hyp-, …);
    the few section ids are listed whole. No element of the hub may match it."""
    families = sorted({i.split("-")[0] for i in pages.home} | {"src"})
    family = re.compile("(?:" + "|".join(families) + ")-")
    exact = sorted(i for i in where if not family.match(i))
    pattern = "^(?:(?:" + "|".join(families) + ")-|(?:" + "|".join(re.escape(i).replace("\\-", "-") for i in exact) + ")$)"
    caught = [i for i in ids_in(hub) if re.match(pattern, i)]
    if caught:
        raise SystemExit("ids on the hub that look like ids that moved (rename them): " + ", ".join(caught))
    return pattern


def check_hub(hub, pages, built):
    """The hub lists every page and links only to things that exist."""
    ids = Counter(ids_in(hub))
    on_page = {slug: set(ids_in(text)) for slug, text in built.items()}
    problems = [f"the id {i} is used {n} times" for i, n in ids.items() if n > 1]
    problems += [f"no link to /fitness/{r['slug']}" for r in pages.routes if f'href="/fitness/{r["slug"]}"' not in hub]
    for target, frag in set(re.findall(r'href="(/fitness/[a-z0-9-]+)?#([^"]+)"', hub)):
        where = target[len("/fitness/"):] if target else None
        if where is None and frag not in ids:
            problems.append(f"links to #{frag}, and nothing on the hub has that id")
        elif where is not None and frag not in on_page.get(where, ()):
            problems.append(f"links to {target}#{frag}, and nothing there has that id")
    for slug, text in built.items():   # a page under the hub may link back to a part of it (a calculator, the cards)
        problems += [f"/fitness/{slug} links to /fitness#{frag}, and nothing on the hub has that id"
                     for frag in set(re.findall(r'href="/fitness#([^"]+)"', text)) if frag not in ids]
    if problems:
        raise SystemExit("/fitness, the hub:\n  " + "\n  ".join(problems))


# ----------------------------------------------------------------- the hero's goal picker
HERO_LEVELS = ("new", "mid", "adv")
HERO_WEEK_KINDS = ("lift", "cardio", "rest", "meet")
HERO_OVERRIDES = ("pct", "pct_from", "how", "entry", "areas", "vantix", "week")


def hero(lib, data, pages, page):
    """content/fitness/hero.json, checked against the field guide, as two things for page.html:
    the goal buttons (HTML) and everything else /fitness.js needs (JSON). Each goal is resolved
    for each level, so the script does no merging. An entry is sent with its title, short answer,
    grade, home and first source; nothing here counts as a citation on the sources page."""
    spec = json.loads((SRC / "hero.json").read_text(encoding="utf-8"))
    where = {e["id"]: (dom, e) for dom in DOMAINS for e in data[dom]["entries"]}
    problems, entries = [], OrderedDict()

    def entry(eid, what):
        if eid not in where:
            problems.append(f"{what}: {eid!r} is not an entry in any area")
            return
        dom, e = where[eid]
        src = []
        for key in e.get("sources", [])[:1]:
            k = lib.alias[(dom, key)]
            src.append({"label": lib.label[k], "type": src_type(lib.by_id[k]), "href": pages.url("sources") + "#src-" + k})
        entries[eid] = {"t": e["title"], "take": e["take"], "c": e["confidence"], "cl": CONF[e["confidence"]],
                        "href": pages.href(eid, None), "src": src}

    tools = spec.get("tools", {})
    for t in tools:
        if f'id="tab-{t}"' not in page:
            problems.append(f"tools: page.html has no calculator tab tab-{t}")
    for t in re.findall(r'role="tab" id="tab-([a-z0-9-]+)"', page):
        if t not in tools:
            problems.append(f"tools: the calculator tab tab-{t} has no label here")
    if sorted(spec.get("days_by_level", {})) != sorted(HERO_LEVELS):
        problems.append("days_by_level needs new, mid and adv")
    entry(spec.get("days_from", ""), "days_from")
    goals, buttons, keys = OrderedDict(), [], set()
    for g in spec.get("goals", []):
        name = g.get("key") or "?"
        missing = [f for f in ("key", "label", "h1", "sub", "icon", "pct", "how", "entry", "tools", "areas", "week") if f not in g]
        if missing:
            problems.append(f"goal {name}: no {', '.join(missing)}")
            continue
        if name in keys or not re.fullmatch(r"[a-z]+", name):
            problems.append(f"goal {name}: keys are unique lowercase words")
        keys.add(name)
        if not re.fullmatch(r'(<path d="[^"<>]*"/>)+', g["icon"]):
            problems.append(f"goal {name}: the icon is one or more <path d=\"...\"/> and nothing else")
        bad = [lv for lv in g.get("by_level", {}) if lv not in HERO_LEVELS]
        bad += [f"{lv}.{f}" for lv, o in g.get("by_level", {}).items() for f in o if f not in HERO_OVERRIDES]
        if bad:
            problems.append(f"goal {name}: by_level has {', '.join(bad)}; it takes {', '.join(HERO_LEVELS)} and the fields {', '.join(HERO_OVERRIDES)}")
        levels = OrderedDict()
        for lv in HERO_LEVELS:
            m = dict(g, **g.get("by_level", {}).get(lv, {}))
            what = f"goal {name} ({lv})"
            if not (isinstance(m["pct"], (int, float)) and 20 <= m["pct"] <= 100):
                problems.append(f"{what}: pct is a share of max between 20 and 100")
            if m.get("pct_from"):
                entry(m["pct_from"], what + " pct_from")
            entry(m["entry"], what + " entry")
            problems += [f"{what}: {a!r} is not an area" for a in m["areas"] if a not in DOMAINS]
            problems += [f"{what}: {t!r} is not one of the tools" for t in m["tools"] if t not in tools]
            week = m["week"]
            if len(week) != 7 or any(len(d) != 3 or d[0] not in HERO_WEEK_KINDS or not d[1] or not d[2] for d in week):
                problems.append(f"{what}: a week is seven [kind, name, what happens] rows, kind one of {', '.join(HERO_WEEK_KINDS)}")
            levels[lv] = {"pct": m["pct"], "example": not m.get("pct_from"), "how": m["how"], "rest": m.get("rest", ""),
                          "days": m.get("days") or spec.get("days_by_level", {}).get(lv, ""), "collars": bool(m.get("collars")),
                          "entry": m["entry"], "tools": m["tools"], "areas": m["areas"], "vantix": bool(m.get("vantix")), "week": week}
        goals[name] = {"label": g["label"], "h1": g["h1"], "levels": levels}
        buttons.append(f'<button type="button" class="fx-goal" value="{esc(name)}" aria-pressed="false">'
                       f'<span class="fx-goal-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" '
                       f'stroke-linecap="round" stroke-linejoin="round" focusable="false">{g["icon"]}</svg></span>'
                       f'<span class="fx-goal-t">{esc(g["label"])}</span><span class="fx-goal-s">{esc(g["sub"])}</span></button>')
    if len(goals) != 6:
        problems.append(f"there are {len(goals)} goals; the picker is laid out for six (two rows of three, three rows of two)")
    if problems:
        raise SystemExit("content/fitness/hero.json:\n  " + "\n  ".join(problems))
    used = {a for g in goals.values() for lv in g["levels"].values() for a in lv["areas"]}
    blob = {"max": spec.get("max", 100), "daysFrom": spec["days_from"],
            "tools": {t: {"label": label, "href": "#" + t} for t, label in tools.items()},
            "areas": {a: {"label": DOMAINS[a][0], "href": pages.url(a)} for a in DOMAINS if a in used},
            "entries": entries, "goals": goals}
    data_json = json.dumps(blob, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return "\n            ".join(buttons), data_json


# ----------------------------------------------------------------- the calculators' numbers, from the field guide
# A calculator that shows a number from the guide reads it here, never from a copy typed into
# /fitness.js. content/fitness/tool-data.json names, for each piece of data, the guide entry it
# comes from (and, for a table, the columns it must still have); a parser below turns that
# entry into numbers. If an entry goes, or a table's columns or rows change shape, the build
# stops and says which. page.html takes the result through these tokens:
#     {{tools:data}}            the parsed data, as JSON, for /fitness.js (#tool-data)
#     {{tools:table:<id>}}      a guide table as static HTML: the visible source, and what a reader without scripts sees
#     {{tools:entry:<id>}}      a guide entry (or claim) as a small card: title, short answer, grade
#     {{tools:entry-do:<id>}}   the same with its "do" list
#     {{tools:n}} {{tools:N}}   how many calculators there are (the tabs), in words: "thirteen", "Thirteen"
#     {{e:<id>}} {{e:<id>|text}} a link to an entry on its home page, with its title or the text given
TOOL_DATA = "tool-data.json"
NUMBER_WORDS = ("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
                "seventeen eighteen nineteen twenty").split()


class ToolDataError(Exception):
    pass


def guide_index(data):
    """id -> (area or 'claims', entry), for every entry and claim."""
    idx = {}
    for dom in DOMAINS:
        for e in data[dom]["entries"]:
            idx[e["id"]] = (dom, e)
    for c in data["claims"]["entries"]:
        idx[c["id"]] = ("claims", c)
    return idx


def _n(s):
    f = float(s)
    return int(f) if f.is_integer() else f


def _range(s, what):
    m = re.fullmatch(r"(?:about\s+)?(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)", s.strip(), re.I)
    if not m:
        raise ToolDataError(f"{what}: {s!r} is not a range such as 55-75")
    return [_n(m.group(1)), _n(m.group(2))]


def _one_or_range(s, what):
    s = s.strip()
    return [_n(s), _n(s)] if re.fullmatch(r"\d+(?:\.\d+)?", s) else _range(s, what)


def _find(pattern, text, what):
    m = re.search(pattern, text)
    if not m:
        raise ToolDataError(f"{what}: the text no longer says what the calculator reads (looked for /{pattern}/)")
    return m


def _rows(e, n, what):
    if len(e["rows"]) != n:
        raise ToolDataError(f"{what}: expected {n} rows, found {len(e['rows'])}")
    return e["rows"]


def td_zones(e, spec):
    out, prev = [], None
    for i, r in enumerate(_rows(e, 5, "zones")):
        if r[0].strip() != str(i + 1):
            raise ToolDataError(f"zones: row {i + 1} is zone {r[0]!r}")
        pct = _range(r[1], f"zones row {i + 1}")
        if prev is not None and pct[0] != prev:
            raise ToolDataError(f"zones: zone {i + 1} starts at {pct[0]}%, not where zone {i} ends ({prev}%)")
        prev = pct[1]
        out.append({"zone": i + 1, "pct": pct, "time": r[3]})
    if out[0]["pct"][0] <= 0 or out[-1]["pct"][1] != 100:
        raise ToolDataError("zones: the scale must end at 100% of max")
    return {"rows": out}


def td_zone_feel(e, spec):
    out = []
    for i, r in enumerate(_rows(e, 5, "zoneFeel")):
        m = re.fullmatch(r"(\d) (.+)", r[0].strip())
        if not m or int(m.group(1)) != i + 1:
            raise ToolDataError(f"zoneFeel: row {i + 1} starts {r[0]!r}, not with its zone number")
        out.append({"name": m.group(2), "feel": r[1], "talk": r[2]})
    return {"rows": out}


def td_hr_max(e, spec):
    m = _find(r"(\d+) minus (\d+(?:\.\d+)?) times age", e["body"], "hrMax")
    return {"a": _n(m.group(1)), "b": _n(m.group(2))}


def td_hr_rest(e, spec):
    m = _find(r"(\d+) to (\d+) beats a minute as the adult resting range and (\d+) to (\d+) for well-trained athletes", e["body"], "hrRest")
    return {"adult": [int(m.group(1)), int(m.group(2))], "athlete": [int(m.group(3)), int(m.group(4))]}


def td_ffmi_ref(e, spec):
    sexes = spec.get("sex", [])
    if len(sexes) != len(e["rows"]) or any(s not in ("m", "f") for s in sexes):
        raise ToolDataError(f"ffmiRef: tool-data.json gives a sex for {len(sexes)} rows; the table has {len(e['rows'])}")
    out = []
    for r, sex in zip(e["rows"], sexes):
        m = re.match(r"(above )?(\d+(?:\.\d+)?)", r[1])
        if not m:
            raise ToolDataError(f"ffmiRef: {r[1]!r} does not start with an FFMI")
        out.append({"group": r[0], "value": _n(m.group(2)), "above": bool(m.group(1)), "shown": r[1], "how": r[2], "sex": sex})
    return {"rows": out}


def td_ffmi_norm(e, spec):
    m = _find(r"gives (\d+(?:\.\d+)?) x \((\d+(?:\.\d+)?) - height in m\)", e["body"], "ffmiNorm")
    return {"k": _n(m.group(1)), "h": _n(m.group(2))}


def td_rpe(e, spec):
    out = []
    for r in e["rows"]:
        rpe, rir = _one_or_range(r[0], "rpe"), _one_or_range(r[1], "rpe")
        # KiteSink reads reps in reserve as 10 - RPE. Every row of the chart must agree with that.
        for v in (rpe[0], rpe[1]):
            if not (rir[0] <= 10 - v <= rir[1]):
                raise ToolDataError(f"rpe: RPE {r[0]} is {r[1]} in reserve, which 10 - RPE does not give")
        out.append({"rpe": rpe, "rir": r[1], "feel": r[2], "use": r[3]})
    if out[0]["rpe"] != [10, 10] or out[-1]["rpe"][0] < 5:
        raise ToolDataError("rpe: the chart must run from RPE 10 down to no lower than 5")
    return {"rows": out}


def _ipf_column(cells, who):
    out = []
    for i, c in enumerate(cells):
        c = c.strip()
        m = re.fullmatch(r"Sub-junior and junior only: up to (\d+(?:\.\d+)?) kg", c)
        if m:
            if i:
                raise ToolDataError(f"ipf {who}: the sub-junior and junior class must come first")
            out.append({"name": f"{_n(m.group(1)):g}", "limit": float(m.group(1)), "junior": True})
            continue
        m = re.fullmatch(r"(\d+(?:\.\d+)?) kg: (?:up to|\d+(?:\.\d+)? to) (\d+(?:\.\d+)?) kg", c)
        if m:
            if float(m.group(1)) != float(m.group(2)):
                raise ToolDataError(f"ipf {who}: {c!r} names one limit and gives another")
            out.append({"name": f"{float(m.group(1)):g}", "limit": float(m.group(2)), "junior": False})
            continue
        m = re.fullmatch(r"(\d+(?:\.\d+)?)\+ kg: over (\d+(?:\.\d+)?) kg", c)
        if m and i == len(cells) - 1:
            out.append({"name": f"{float(m.group(1)):g}+", "limit": None, "over": float(m.group(2)), "junior": False})
            continue
        raise ToolDataError(f"ipf {who}: cannot read the class {c!r}")
    limits = [x["limit"] for x in out if x["limit"] is not None]
    if limits != sorted(limits) or out[-1]["limit"] is not None or out[-1]["over"] != limits[-1]:
        raise ToolDataError(f"ipf {who}: the classes must rise and end with an open class over the last limit")
    return out


def td_ipf(e, spec):
    rows = e["rows"]
    return {"m": _ipf_column([r[0] for r in rows], "men"), "f": _ipf_column([r[2] for r in rows], "women")}


def td_comeback(e, spec):
    want = spec.get("rows", [])
    got = [r[0] for r in e["rows"]]
    if got != want:
        raise ToolDataError(f"comeback: the rows are {got}; the calculator's cuts are set for {want}")
    return {"columns": e["columns"], "rows": e["rows"]}


def td_return_ratio(e, spec):
    m = re.fullmatch(r"(\d+(?:\.\d+)?)x", e["value"].strip())
    if not m or e.get("unit") != "the time off":
        raise ToolDataError(f"returnRatio: value {e['value']!r} {e.get('unit')!r} is not 'Nx the time off'")
    _find(r"once the break reaches a month", e["take"], "returnRatio")
    return {"factor": _n(m.group(1)), "take": e["take"]}


def td_return_load(e, spec):
    m = re.fullmatch(r"(\d+)-(\d+)%", e["value"].strip())
    if not m:
        raise ToolDataError(f"returnLoad: value {e['value']!r} is not a range of percentages")
    return {"pct": [int(m.group(1)), int(m.group(2))], "take": e["take"]}


def td_supps(e, spec):
    return {"rows": [{"name": r[0], "evidence": r[1], "does": r[2], "dose": r[3]} for r in e["rows"]]}


def td_fat_loss(e, spec):
    return {"rows": [{"name": r[0], "found": r[1], "cautions": r[2]} for r in e["rows"]]}


def td_caffeine(e, spec):
    if e.get("unit") != "mg per kg":
        raise ToolDataError(f"caffeine: the unit is {e.get('unit')!r}, not mg per kg")
    return {"mgkg": _range(e["value"], "caffeine"), "take": e["take"]}


def td_sets(e, spec):
    rows = {r[0]: r[1] for r in e["rows"]}
    general, trained = rows.get("Weekly sets, general", ""), rows.get("Weekly sets, trained men", "")
    m = re.fullmatch(r"At least (\d+) per muscle", general)
    t = re.fullmatch(r"(\d+)-(\d+) per muscle", trained)
    if not m or not t:
        raise ToolDataError(f"sets: the weekly-sets rows read {general!r} and {trained!r}")
    return {"min": int(m.group(1)), "range": [int(t.group(1)), int(t.group(2))], "general": general, "trained": trained}


def td_sets_helper(e, spec):
    m = _find(r"as a helper (half|a third|a quarter) the credit of a direct set", e["body"], "setsHelper")
    return {"credit": {"half": 0.5, "a third": 1 / 3, "a quarter": 0.25}[m.group(1)]}


TOOL_PARSERS = {
    "zones": td_zones, "zoneFeel": td_zone_feel, "hrMax": td_hr_max, "hrRest": td_hr_rest,
    "ffmiRef": td_ffmi_ref, "ffmiNorm": td_ffmi_norm, "rpe": td_rpe, "ipf": td_ipf,
    "comeback": td_comeback, "returnRatio": td_return_ratio, "returnLoad": td_return_load,
    "supps": td_supps, "fatLoss": td_fat_loss, "caffeine": td_caffeine, "sets": td_sets, "setsHelper": td_sets_helper,
}


def entry_brief(eid, idx, pages):
    """What a card needs: title, short answer, grade (or verdict), home, and the do list."""
    dom, e = idx[eid]
    if e["type"] == "claim":
        label, cls = VERDICTS[e["verdict"]][0], "v-" + e["verdict"]
    else:
        label, cls = CONF[e["confidence"]], e["confidence"]
    return {"id": eid, "t": e["title"], "take": e["take"], "c": cls, "cl": label, "href": pages.href(eid, None),
            "area": "Claims, checked" if dom == "claims" else DOMAINS[dom][0], "do": e.get("do", [])}


def entry_card(eid, idx, pages, with_do=False):
    b = entry_brief(eid, idx, pages)
    do = ('<ul class="te-do">' + "".join(f"<li>{esc(x)}</li>" for x in b["do"]) + "</ul>") if with_do and b["do"] else ""
    return (f'<div class="te"><p class="te-top"><span>{esc(b["area"])}</span><span class="fx-badge {esc(b["c"])}">{esc(b["cl"])}</span></p>'
            f'<p class="te-t"><a href="{esc(b["href"])}">{esc(b["t"])}</a></p><p class="te-s">{esc(b["take"])}</p>{do}</div>')


def tool_table(eid, idx, pages):
    dom, e = idx[eid]
    if e["type"] != "table":
        raise ToolDataError(f"{{{{tools:table:{eid}}}}}: {eid} is a {e['type']}, not a table")
    head = "".join(f'<th scope="col">{esc(c)}</th>' for c in e["columns"])
    body = "".join("<tr>" + "".join((f'<th scope="row">{esc(c)}</th>' if i == 0 else f"<td>{esc(c)}</td>") for i, c in enumerate(r)) + "</tr>" for r in e["rows"])
    return (f'<div class="tt"><p class="tt-h"><a href="{esc(pages.href(eid, None))}">{esc(e["title"])}</a> '
            f'<span class="fx-badge {esc(e["confidence"])}">{esc(CONF[e["confidence"]])}</span></p>'
            f'<div class="tt-scroll" tabindex="0" role="region" aria-label="{esc(e["title"])}"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div></div>')


def tool_data(data, pages):
    """content/fitness/tool-data.json, read against the guide: {key: {entry's href and title, parsed numbers}}."""
    spec = json.loads((SRC / TOOL_DATA).read_text(encoding="utf-8"))
    idx, out, problems = guide_index(data), OrderedDict(), []
    items = spec.get("data", {})
    for key in sorted(set(items) ^ set(TOOL_PARSERS)):
        problems.append(f"{key}: " + ("no parser in scripts/build_fitness.py" if key in items else "the build has a parser for it, but tool-data.json does not name its entry"))
    for key, s in items.items():
        if key not in TOOL_PARSERS:
            continue
        eid = s.get("entry", "")
        if eid not in idx:
            problems.append(f"{key}: {eid!r} is not an entry in the field guide")
            continue
        e = idx[eid][1]
        if "columns" in s and e.get("columns") != s["columns"]:
            problems.append(f"{key}: {eid} has the columns {e.get('columns')}; the calculator reads {s['columns']}")
            continue
        try:
            parsed = TOOL_PARSERS[key](e, s)
        except ToolDataError as err:
            problems.append(str(err))
            continue
        out[key] = dict({"href": pages.href(eid, None), "title": e["title"]}, **parsed)
    groups = []
    for g in spec.get("supplements", []):
        missing = [i for i in g.get("entries", []) if i not in idx]
        if missing or not g.get("name"):
            problems.append(f"supplements: {g.get('name') or '?'} names {', '.join(missing) or 'no entries'}, not in the field guide")
            continue
        groups.append({"name": g["name"], "group": g.get("group", ""), "entries": [entry_brief(i, idx, pages) for i in g["entries"]]})
    out["suppItems"] = groups
    if problems:
        raise SystemExit("content/fitness/tool-data.json, read against the field guide:\n  " + "\n  ".join(problems))
    return out


def fill_tools(page, data, pages):
    """The {{tools:…}} and {{e:…}} tokens of page.html (see the comment above TOOL_DATA)."""
    idx, problems = guide_index(data), []

    def link(m):
        eid, text = m.group(1), m.group(2)
        if eid not in idx:
            problems.append(f"{{{{e:{eid}}}}}: no such entry")
            return ""
        return f'<a href="{esc(pages.href(eid, None))}">{esc(text) if text else esc(idx[eid][1]["title"])}</a>'

    def block(m):
        kind, eid = m.group(1), m.group(2)
        if eid not in idx:
            problems.append(f"{{{{tools:{kind}:{eid}}}}}: no such entry")
            return ""
        try:
            return tool_table(eid, idx, pages) if kind == "table" else entry_card(eid, idx, pages, kind == "entry-do")
        except ToolDataError as err:
            problems.append(str(err))
            return ""
    page = re.sub(r"\{\{e:([a-z0-9-]+)(?:\|([^}]+))?\}\}", link, page)
    page = re.sub(r"\{\{tools:(table|entry|entry-do):([a-z0-9-]+)\}\}", block, page)
    if problems:
        raise SystemExit("content/fitness/page.html:\n  " + "\n  ".join(problems))
    tabs = re.findall(r'role="tab" id="tab-([a-z0-9-]+)"', page)
    if not 0 < len(tabs) < len(NUMBER_WORDS):
        raise SystemExit("content/fitness/page.html: cannot count the calculator tabs")
    word = NUMBER_WORDS[len(tabs)]
    blob = json.dumps(tool_data(data, pages), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    for token, value in (("{{tools:data}}", blob), ("{{tools:n}}", word), ("{{tools:N}}", word.capitalize())):
        if token == "{{tools:data}}" and token not in page:
            raise SystemExit("content/fitness/page.html has no {{tools:data}}")
        page = page.replace(token, value)
    return page, tabs


# ----------------------------------------------------------------- assemble
def build():
    meta, lib, data = load()
    page = (SRC / "page.html").read_text(encoding="utf-8")
    pages = Pages(load_routes(), data)
    if not LEGACY_IDS.is_file():
        raise SystemExit("scripts/fixtures/fitness-legacy-ids.txt is missing")
    legacy = LEGACY_IDS.read_text(encoding="utf-8").split()

    # 1. inline citations in the shell (the calculators): {{c:key,key}}. Their sources are
    #    listed on the sources page, so the links go there.
    def inline(m):
        keys = [k.strip() for k in m.group(1).split(",")]
        return lib.cite_html("tools", keys, pages.url("sources")).replace('<p class="cite">', '<span class="cite">').replace("</p>", "</span>")
    page = re.sub(r"\{\{c:([^}]+)\}\}", inline, page)
    tool_uses = Counter(lib.uses)   # what the calculators cite; they stay on /fitness
    page, tabs = fill_tools(page, data, pages)   # the calculators' guide numbers, cards, tables and links

    # 2. the counts every page prints
    kinds = Counter(e["type"] for dom in DOMAINS for e in data[dom]["entries"])
    counts = {d: len(data[d]["entries"]) for d in DOMAINS}          # an area's entries, its terms included
    n_claims = len(data["claims"]["entries"])
    total = sum(counts.values()) + n_claims
    numbers = {"n:steps": kinds["step"], "n:claims": n_claims, "n:terms": kinds["term"], "n:numbers": kinds["number"],
               "n:tables": kinds["table"], "n:sources": len(lib.by_id), "n:total": total, "n:areas": len(DOMAINS),
               "n:pages": len(pages.routes), "n:tools": len(tabs), "updated": meta["updated_label"]}

    # 3. the pages under /fitness/
    sub, built = build_subpages(lib, meta, data, numbers, tool_uses, pages, legacy)

    # 4. the hub
    hero_goals, hero_data = hero(lib, data, pages, page)
    fills = {"hub:areas": hub_areas(pages, counts), "hub:reference": hub_reference(pages, numbers),
             "hero:goals": hero_goals, "hero:data": hero_data,
             **{k: numbers[k] for k in ("n:total", "n:areas", "updated")}}
    for key, value in fills.items():
        token = "{{" + key + "}}"
        if token not in page:
            raise SystemExit(f"content/fitness/page.html has no {token}")
        page = page.replace(token, str(value))
    where = id_map(pages, lib, built, page, legacy)
    if "{{fwd:test}}" not in page:
        raise SystemExit("content/fitness/page.html has no {{fwd:test}}")
    page = page.replace("{{fwd:test}}", forward_test(where, pages, page))
    left = re.findall(r"\{\{[^}]+\}\}", page)
    if left:
        raise SystemExit("unfilled tokens in page.html: " + ", ".join(sorted(set(left))))
    check_hub(page, pages, built)
    index = search_index(data, pages)
    if len(index["rows"]) != total or {row[0] for row in index["rows"]} != set(pages.home):
        raise SystemExit("the search index does not hold every entry once")

    def compact(obj):
        return json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n"
    slugs = [r["slug"] for r in pages.routes]
    out = OrderedDict()
    out[PUBLIC / "fitness.html"] = page
    out[PUBLIC / "fitness.md"] = md_index(meta, numbers, counts, pages)
    for dom in DOMAINS:
        out[PUBLIC / "fitness" / f"{pages.slug[dom]}.md"] = md_domain(lib, meta, dom, data[dom], pages)
    out[PUBLIC / "fitness" / f"{pages.slug['claims']}.md"] = md_claims(lib, meta, data["claims"]["entries"], pages)
    out[PUBLIC / "fitness" / "search.json"] = compact(index)
    out[PUBLIC / "fitness" / "ids.json"] = compact({"pages": slugs, "ids": {i: slugs.index(slug) for i, slug in where.items()}})
    clash = [p.name for p in sub if p in out]
    if clash:
        raise SystemExit("routes.json would overwrite: " + ", ".join(clash))
    out.update(sub)
    return out, {"entries": total, "pages": len(pages.routes), "sources": len(lib.by_id), "claims": n_claims, "numbers": kinds["number"],
                 "tables": kinds["table"], "terms": kinds["term"], "steps": kinds["step"], "old ids": len(where)}


def main():
    out, stats = build()
    if "--check" in sys.argv:
        stale = [p.relative_to(PUBLIC).as_posix() for p, text in out.items() if not p.is_file() or p.read_text(encoding="utf-8") != text]
        if stale:
            print("Out of date (run python3 scripts/build_fitness.py): " + ", ".join(stale))
            return 1
        return 0
    for p, text in out.items():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    print(f"built /fitness: {stats['entries']} entries on {stats['pages']} sub-pages, each entry with exactly one home; "
          + ", ".join(f"{stats[k]} {k}" for k in ("sources", "claims", "numbers", "tables", "terms", "steps"))
          + f"; {stats['old ids']} ids in the map for old links")
    return 0


if __name__ == "__main__":
    sys.exit(main())
