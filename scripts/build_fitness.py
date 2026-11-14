#!/usr/bin/env python3
"""Build /fitness and the pages under /fitness/ from the data in content/fitness/.

    python3 scripts/build_fitness.py            # write the pages and their markdown twins
    python3 scripts/build_fitness.py --check    # exit 1 if what is in public/ is out of date

Inputs (all in content/fitness/):
    page.html           the /fitness shell: head, hero, Vantix feature, the calculators
    templates/sub.html  the one shell every page under /fitness/ is poured into
    routes.json         one row per page under /fitness/: slug, kind, title, description, h1, lead
    corrections.json    the dated corrections log shown on /fitness/sources
    meta.json           the "last updated" date and a few labels
    tools.json          sources the calculators cite
    <domain>.json       one file per area (hypertrophy, powerlifting, meet, nutrition, diet, health)
    claims.json         the "claims, checked" entries

Outputs:
    public/fitness.html
    public/fitness/<slug>.html, one per row of routes.json
    public/fitness.md and public/fitness/<domain>.md, claims.md, glossary.md, reference.md,
    sources.md  (plain-text twins for AI readers)

Every entry has one home page under /fitness/: a term lives on the glossary, a claim on the
claims page, everything else on its area's page. Other pages link to it and never repeat it.

The pages are static HTML: every entry is in the markup, so it reads without
JavaScript. /fitness.js and /fitness-ref.js only filter, sort and remember. To add an
entry, add it to the right JSON file and run this script. scripts/check_site.py runs the
--check form, so a stale page fails the audit.
"""
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

DOMAINS = OrderedDict([
    ("hypertrophy", ("Hypertrophy", "Training for muscle size.")),
    ("powerlifting", ("Powerlifting", "A bigger squat, bench press and deadlift.")),
    ("meet", ("Meet day", "Your first competition, in order.")),
    ("nutrition", ("Nutrition", "Eating to support training, and tracking it honestly.")),
    ("diet", ("Diet", "Losing or gaining weight on purpose.")),
    ("health", ("Health", "Training for a long working life.")),
])
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
    "rulebook": "rulebook", "book": "book", "other": "reference",
}


def esc(s):
    return html.escape(str(s), quote=True)


def family(author):
    """'Morton RW' -> 'Morton'; 'van Loon LJC' -> 'van Loon'; an organisation stays whole."""
    parts = author.split()
    if len(parts) > 1 and re.fullmatch(r"[A-Z][A-Za-z\-]{0,4}", parts[-1]) and parts[-1].upper() == parts[-1]:
        return " ".join(parts[:-1])
    return author


class Library:
    """Every source from every file, merged by DOI or URL, with short labels."""

    def __init__(self, labels):
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
        canon = key if key not in self.by_id else f"{key}-{len(self.by_id)}"
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
                    self.label[k] = label + "abcdefgh"[i]

    @contextmanager
    def counting(self, tally):
        """Count citations into `tally` for a while. A page under /fitness/ is built inside
        this, so it knows which sources it cites and how often."""
        kept, self.uses = self.uses, tally
        try:
            yield tally
        finally:
            self.uses = kept

    def cite_html(self, file, keys):
        out = []
        for key in keys:
            k = self.alias[(file, key)]
            self.uses[k] += 1
            out.append(f'<a href="#src-{esc(k)}">{esc(self.label[k])}</a>')
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
        bits.append(f'<span class="as">{esc(SRC_TYPE.get(s.get("type"), "reference"))} · cited {n}×</span>')
        return f'<li id="src-{esc(k)}" data-kind="{esc(s.get("type", "other"))}">' + " ".join(bits) + "</li>"


def load():
    meta = json.loads((SRC / "meta.json").read_text(encoding="utf-8"))
    lib = Library(meta.get("labels"))
    data = OrderedDict()
    for name in ["tools"] + list(DOMAINS) + ["claims"]:
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


def build_guide(lib, data):
    """Notes and mistakes from all six areas, grouped by area then topic."""
    rows, n, topic_opts = [], 0, []
    for dom, (label, blurb) in DOMAINS.items():
        d = data[dom]
        topics = OrderedDict((t["id"], t["label"]) for t in d.get("topics", []))
        entries = [e for e in d["entries"] if e["type"] in ("note", "mistake")]
        if not entries:
            continue
        topic_opts += [(f"{dom}:{tid}", tl, dom) for tid, tl in topics.items() if any(e.get("topic") == tid for e in entries)]
        rows.append(f'<h3 class="g-head" id="{dom}" data-d="{dom}" data-o="{n}"><span>{esc(label)}</span> <small>{esc(blurb)} {len(entries)} entries.</small></h3>')
        n += 1
        for e in guide_order(entries, topics):
            rows.append(item_html(lib, dom, e, n, topics))
            n += 1
    topic_btns = "".join(f'<button type="button" class="fx" value="{esc(v)}" data-d="{d}" aria-pressed="false">{esc(l)} <b></b></button>' for v, l, d in topic_opts)
    rail = (
        '<div class="gx-rail" id="g-rail">'
        + facet("kind", [("note", "Guidance"), ("mistake", "Mistakes")], "Kind")
        + facet("level", list(LEVELS.items()), "Level")
        + facet("conf", list(CONF.items()), "Support")
        + '<div class="fx-group" data-facet="topic" role="group" aria-label="Topic" hidden><span class="fx-label">Topic</span>'
          '<div class="fx-row"><button type="button" class="fx" value="all" aria-pressed="true">All</button>' + topic_btns + "</div></div>"
        + "</div>"
    )
    bar = (
        '<div class="gx-bar">'
        '<label class="k-vh" for="g-q">Search the field guide</label>'
        '<input class="k-input gx-q" id="g-q" type="search" placeholder="Search: volume, deload, protein, zone 2…" autocomplete="off">'
        + GUIDE_SORT +
        "</div>"
        '<p class="gx-count" id="g-count" aria-live="polite"></p>'
    )
    count = sum(1 for dom in DOMAINS for e in data[dom]["entries"] if e["type"] in ("note", "mistake"))
    html_out = (
        '<div class="gx"><details class="gx-filters" id="g-filters" open><summary>Filters <span id="g-active"></span></summary>' + rail + "</details>"
        '<div class="gx-main">' + bar + '<div class="g-list" id="g-list">' + "\n".join(rows) + "</div>"
        '<p class="gx-empty" id="g-empty" hidden>Nothing matches those filters. <button type="button" class="k-linkbtn" data-reset="guide">Clear them</button></p>'
        "</div></div>"
    )
    return html_out, count


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


def build_claims(lib, data):
    claims = data["claims"]["entries"]
    used_tags = [t for t in TAGS if any(t in c.get("tags", []) for c in claims)]
    used_ev = [v for v in EVIDENCE if any(c.get("evidence") == v for c in claims)]
    rows = claim_rows(lib, claims)
    controls = (
        '<div class="qx-controls" id="q-controls">'
        + facet("verdict", [(v, VERDICTS[v][0]) for v in VERDICTS], "Verdict")
        + facet("tag", [(t, TAGS[t]) for t in used_tags], "Topic")
        + facet("evidence", [(v, EVIDENCE[v]) for v in used_ev], "Evidence")
        + '<div class="gx-bar"><label class="k-vh" for="q-q">Search the claims</label>'
          '<input class="k-input gx-q" id="q-q" type="search" placeholder="Search: creatine, failure, fasting, kidneys…" autocomplete="off">'
          + CLAIM_SORT + "</div>"
        + '<p class="gx-count" id="q-count" aria-live="polite"></p></div>'
    )
    out = (controls + '<div id="q-list">' + "\n".join(rows) + "</div>"
           '<p class="gx-empty" id="q-empty" hidden>No claim matches. <button type="button" class="k-linkbtn" data-reset="claims">Clear the filters</button></p>')
    return out, len(claims)


def build_meet(lib, data, dom="meet"):
    d = data[dom]
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
    for e in d["entries"]:
        if e["type"] != "checklist":
            continue
        total = sum(len(g["items"]) for g in e["groups"])
        out.append(f'<div class="ck" id="{esc(e["id"])}" data-ck="{esc(e["id"])}"><div class="ck-top"><div><h3 class="k-h3">{esc(e["title"])}</h3>'
                   f'<p class="k-small">{esc(e["take"])}</p></div><p class="ck-count"><b class="ck-n">0</b> of {total} packed '
                   '<button type="button" class="k-linkbtn ck-clear">Clear ticks</button></p></div><div class="ck-groups">')
        i = 0
        for g in e["groups"]:
            out.append(f'<fieldset><legend>{esc(g["name"])}</legend>')
            for it in g["items"]:
                out.append(f'<label class="ck-item"><input type="checkbox" data-i="{i}"><span>{esc(it)}</span></label>')
                i += 1
            out.append("</fieldset>")
        out.append("</div>" + lib.cite_html(dom, e.get("sources", [])) + "</div>")
    return "\n".join(out), len(steps)


def number_row(lib, dom, e, order, area=True):
    cites = lib.cite_html(dom, e.get("sources", []))
    return (
        f'<tr id="{esc(e["id"])}" data-d="{dom}" data-c="{e["confidence"]}" data-n="{e["sort"]}" data-o="{order}">'
        f'<th scope="row"><span class="nx-v">{esc(e["value"])}</span><span class="nx-u">{esc(e.get("unit", ""))}</span></th>'
        f'<td><b>{esc(e["title"])}</b><span>{esc(e["take"])}</span>{cites}</td>'
        + (f'<td class="nx-d">{esc(DOMAINS[dom][0])}</td>' if area else "") +
        f'<td class="nx-c">{tag("tg-c tg-" + e["confidence"], CONF[e["confidence"]], CONF_HELP[e["confidence"]])}</td></tr>'
    )


def build_numbers(lib, data):
    rows = []
    for dom in DOMAINS:
        for e in data[dom]["entries"]:
            if e["type"] != "number":
                continue
            rows.append(number_row(lib, dom, e, len(rows)))
    head = ('<thead><tr><th scope="col"><button type="button" data-sort="n">Number</button></th>'
            '<th scope="col"><button type="button" data-sort="t">What it is</button></th>'
            '<th scope="col"><button type="button" data-sort="d">Area</button></th>'
            '<th scope="col"><button type="button" data-sort="c">Support</button></th></tr></thead>')
    out = ('<div class="nx-wrap"><table class="nx" id="n-table">' + head + "<tbody>" + "\n".join(rows) + "</tbody></table></div>"
           '<p class="gx-empty" id="n-empty" hidden>No numbers for that area yet.</p>')
    return out, len(rows)


def table_html(lib, dom, e, meta=None):
    head = "".join(f'<th scope="col">{esc(c)}</th>' for c in e["columns"])
    body = "".join("<tr>" + "".join((f'<th scope="row">{esc(c)}</th>' if i == 0 else f"<td>{esc(c)}</td>") for i, c in enumerate(r)) + "</tr>" for r in e["rows"])
    return (
        f'<details class="rt" id="{esc(e["id"])}" data-d="{dom}"><summary><span class="g-meta">{esc(DOMAINS[dom][0] if meta is None else meta)}</span>'
        f'<span class="g-title">{esc(e["title"])}</span><span class="g-take">{esc(e["take"])}</span></summary>'
        f'<div class="rt-scroll" tabindex="0" role="region" aria-label="{esc(e["title"])}"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'
        + tag("tg-c tg-" + e["confidence"], CONF[e["confidence"]], CONF_HELP[e["confidence"]]) + lib.cite_html(dom, e.get("sources", [])) + "</details>"
    )


def build_tables(lib, data):
    out, n = [], 0
    for dom in DOMAINS:
        for e in data[dom]["entries"]:
            if e["type"] != "table":
                continue
            out.append(table_html(lib, dom, e))
            n += 1
    return "\n".join(out) + '<p class="gx-empty" id="t-empty" hidden>No tables for that area yet.</p>', n


def build_glossary(lib, data):
    terms = [(e, dom) for dom in DOMAINS for e in data[dom]["entries"] if e["type"] == "term"]
    terms.sort(key=lambda x: x[0]["title"].lower())
    rows = [f'<div class="gl-item" id="{esc(e["id"])}" data-d="{dom}"><dt>{esc(e["title"])}</dt><dd>{esc(e["take"])} <span class="gl-d">{esc(DOMAINS[dom][0])}</span></dd></div>' for e, dom in terms]
    out = ('<div class="gx-bar"><label class="k-vh" for="gl-q">Search the glossary</label>'
           '<input class="k-input gx-q" id="gl-q" type="search" placeholder="Search a term: RIR, taper, TDEE, ApoB…" autocomplete="off">'
           '<p class="gx-count" id="gl-count" aria-live="polite"></p></div>'
           '<dl class="gl" id="gl-list">' + "\n".join(rows) + "</dl>"
           '<p class="gx-empty" id="gl-empty" hidden>No term matches.</p>')
    return out, len(rows)


def legend_html():
    return '<dl class="lg">' + "".join(f'<div><dt>{tag("tg-c tg-" + c, CONF[c])}</dt><dd>{esc(CONF_HELP[c])}</dd></div>' for c in CONF) + "</dl>"


def lens_counts(html, pattern):
    """How many items of one list sit in each area, counted from the list's own markup, so the
    area buttons are right before any script runs (the page script recounts as filters change)."""
    found = Counter(re.findall(pattern, html))
    return {d: found.get(d, 0) for d in DOMAINS}


def domain_switch(counts):
    btns = ['<button type="button" value="all" aria-pressed="true">All areas</button>']
    btns += [f'<button type="button" value="{d}" aria-pressed="false">{esc(l)} <b>{counts[d]}</b></button>' for d, (l, _) in DOMAINS.items()]
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


def md_footer(meta, anchor=""):
    return (MD_OFFERS + f"\n---\n\nSource page: {SITE}/fitness{anchor}  \nMaintained by Truman Kitos-Lindsey, KiteSink ({SITE}).  \n"
            f"General information, not medical advice. Last updated {meta['updated']}.\n")


def md_domain(lib, meta, dom, d):
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
    terms = sorted((e for e in d["entries"] if e["type"] == "term"), key=lambda e: e["title"].lower())
    if terms:
        out += ["## Terms", ""] + [f"- **{e['title']}**: {e['take']}" for e in terms] + [""]
    return "\n".join(out) + md_footer(meta, "#" + dom)


def md_claims(lib, meta, claims):
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
    return "\n".join(out) + md_footer(meta, "#claims")


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
        line += (f" {url}" if url else "") + f" ({SRC_TYPE.get(src.get('type'), 'reference')}, cited {lib.uses[k]}×)"
        out.append(line)
    return "\n".join(out) + "\n" + md_footer(meta, "/" + pages.slug["sources"])


def md_index(meta, counts):
    out = ["# KiteSink Fitness", "",
           "Free training and nutrition reference by Truman Kitos-Lindsey: a field guide in six areas, a set of common claims checked against the research, key numbers, reference tables, a first-meet timeline, and five calculators that run in the browser. Vantix, a periodization app, is the flagship project on the page.",
           "", "## Read by area", ""]
    out += [f"- [{l}]({SITE}/fitness/{d}.md): {b} {counts[d]} entries." for d, (l, b) in DOMAINS.items()]
    out += [f"- [Claims, checked]({SITE}/fitness/claims.md): {counts['claims']} common claims with a verdict, who was studied, and the source.", "",
            "## Calculators (on the page, no sign-up)", "",
            f"- Energy and macro calculator: {SITE}/fitness#macros", f"- Effective reps explorer: {SITE}/fitness#reps",
            f"- 1RM and load calculator: {SITE}/fitness#loads", f"- Travel workout builder: {SITE}/fitness#travel",
            f"- Meet attempt planner: {SITE}/fitness#attempts", "",
            "## Vantix", "",
            "Vantix is a periodization app for lifters. Its free core (v1.0) is in progress, with a target of 31 December 2026. Paid tiers (Plus, and Pro for coaches) are planned with no prices set. "
            f"Details and the waiting list: {SITE}/vantix", "",
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
    for want in list(DOMAINS) + [k for k in KINDS if k != "area"]:
        if holds[want] != 1:
            raise SystemExit(f"routes.json: expected one page for {want}, found {holds[want]}")
    return routes


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

    if of("step", "checklist"):
        timeline, n_steps = build_meet(lib, data, dom)
        aside = f'{count_of(n_steps, "step")}, then the bag list. Open a step to read it.'
        sections.append(("timeline", "Timeline", n_steps, band("timeline", "In order", "From sign-up <em>to the drive home.</em>", aside, timeline)))

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
        sections.append(("corrections", "Corrections", len(log), band("corrections", "Corrections", "What has <em>been corrected.</em>", aside, '<ul class="fr-log">' + "\n".join(log) + "</ul>")))
    aside = "Each one was checked against its record. Search by author, year, title or journal."
    sections.append(("sources", "All sources", len(keys), band("sources", "Sources", f"All {len(keys)} sources, <em>A to Z.</em>", aside, listing)))
    return sections


def render_sub(template, route, pages, sections, numbers):
    """Pour one page into the shell. numbers fills {{n:…}} and {{updated}} in the route's own text."""
    def filled(text):
        def one(m):
            if m.group(1) not in numbers:
                raise SystemExit(f"routes.json: {route['slug']} uses {m.group(0)}, which the build does not know")
            return str(numbers[m.group(1)])
        return re.sub(r"\{\{([^}]+)\}\}", one, text)

    slug, label = route["slug"], route_label(route)
    links = [("/fitness", "Fitness", False)] + [("/fitness/" + r["slug"], route_label(r), r["slug"] == slug) for r in pages.routes]
    subnav = "".join(f'<a href="{href}"' + (' class="on" aria-current="page"' if on else "") + f">{esc(name)}</a>" for href, name, on in links)
    crumbs = [("Home", SITE + "/"), ("Fitness", SITE + "/fitness"), (label, f"{SITE}/fitness/{slug}")]
    breadcrumb = json.dumps({
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [{"@type": "ListItem", "position": i, "name": name, "item": url} for i, (name, url) in enumerate(crumbs, 1)],
    }, ensure_ascii=False).replace("</", "<\\/")
    crumb = f'<li><a href="/">Home</a></li><li><a href="/fitness">Fitness</a></li><li aria-current="page">{esc(label)}</li>'
    jump = ""
    if len(sections) > 1 and route["kind"] not in ("claims", "glossary"):   # those two are one list each; the rest have sections to move between
        jump = ('<nav class="fr-jump" aria-label="On this page">'
                + "".join(f'<a href="#{sid}">{esc(name)}' + (f" <b>{n}</b>" if n is not None else "") + "</a>" for sid, name, n, _ in sections) + "</nav>")
    fills = {
        "slug": slug, "title": esc(filled(route["title"])), "description": esc(filled(route["description"])),
        "h1": filled(route["h1"]), "lead": esc(filled(route["lead"])), "breadcrumb": breadcrumb, "crumb": crumb,
        "subnav": subnav, "jump": jump, "body": "\n\n".join(html for _, _, _, html in sections if html),
    }

    def fill(m):
        if m.group(1) not in fills:
            raise SystemExit(f"content/fitness/templates/sub.html uses {m.group(0)}, which the build does not fill")
        return fills[m.group(1)]
    page = re.sub(r"\{\{([a-z0-9:_-]+)\}\}", fill, template)
    unused = [k for k in fills if "{{" + k + "}}" not in template]
    if unused:
        raise SystemExit("content/fitness/templates/sub.html has no {{" + "}}, {{".join(unused) + "}}")
    return page


def build_subpages(lib, meta, data, numbers, tool_uses):
    """Every page under /fitness/ and the three twins that have no older file. Returns
    ({path: text}, pages). tool_uses is what the calculators on /fitness cite."""
    routes = load_routes()
    pages = Pages(routes, data)
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
        built[r["slug"]] = render_sub(template, r, pages, sections, numbers)
    unused = [k for k in lib.by_id if not total[k]]
    if unused:
        raise SystemExit("sources no page cites: " + ", ".join(unused))
    for r in routes:   # last, so it can show how often each source is cited across all the pages
        if r["kind"] == "sources":
            with lib.counting(total):
                built[r["slug"]] = render_sub(template, r, pages, page_sources(lib, pages, r, corrections), numbers)
    check_subpages(built, pages, lib)

    out = OrderedDict((PUBLIC / "fitness" / f"{r['slug']}.html", built[r["slug"]]) for r in routes)
    out[PUBLIC / "fitness" / f"{pages.slug['glossary']}.md"] = md_glossary(lib, meta, data, pages)
    out[PUBLIC / "fitness" / f"{pages.slug['reference']}.md"] = md_reference(meta, data, pages)
    with lib.counting(total):
        out[PUBLIC / "fitness" / f"{pages.slug['sources']}.md"] = md_sources(lib, meta, pages, corrections)
    return out, pages


def check_subpages(built, pages, lib):
    """Hold the pages to the one-home rule: every entry is on its home page and no other, every
    source is on the sources page, and every link from one page to another lands on something."""
    ids = {slug: Counter(re.findall(r'\sid="([^"]+)"', text)) for slug, text in built.items()}
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
    if problems:
        raise SystemExit("the pages under /fitness/ break the one-home rule:\n  " + "\n  ".join(problems))


# ----------------------------------------------------------------- assemble
def build():
    meta, lib, data = load()
    page = (SRC / "page.html").read_text(encoding="utf-8")

    # 1. inline citations in the shell (the calculators): {{c:key,key}}
    def inline(m):
        keys = [k.strip() for k in m.group(1).split(",")]
        return lib.cite_html("tools", keys).replace('<p class="cite">', '<span class="cite">').replace("</p>", "</span>")
    page = re.sub(r"\{\{c:([^}]+)\}\}", inline, page)
    tool_uses = Counter(lib.uses)   # what the calculators cite; they stay on /fitness

    guide, n_guide = build_guide(lib, data)
    claims, n_claims = build_claims(lib, data)
    meet, n_steps = build_meet(lib, data)
    numbers, n_numbers = build_numbers(lib, data)
    tables, n_tables = build_tables(lib, data)
    glossary, n_terms = build_glossary(lib, data)

    counts = {d: len(data[d]["entries"]) for d in DOMAINS}
    counts["claims"] = n_claims
    lens = {
        "guide": (lens_counts(guide, r'<details class="g" id="[^"]*" data-d="([a-z]+)"'), n_guide),
        "claims": (lens_counts(claims, r'<details class="k-qa q" id="[^"]*" data-d="([a-z]+)"'), n_claims),
        "numbers": (lens_counts(numbers, r'<tr id="[^"]*" data-d="([a-z]+)"'), n_numbers),
        "tables": (lens_counts(tables, r'<details class="rt" id="[^"]*" data-d="([a-z]+)"'), n_tables),
        "glossary": (lens_counts(glossary, r'<div class="gl-item" id="[^"]*" data-d="([a-z]+)"'), n_terms),
    }
    for name, (per_area, n) in lens.items():
        if sum(per_area.values()) != n:
            raise SystemExit(f"area counts for the {name} list add up to {sum(per_area.values())}, not {n}")
    total = sum(counts.values())

    kinds = Counter(s.get("type", "other") for s in lib.by_id.values())
    src_rows = "\n".join(lib.entry_html(k) for k in sorted(lib.by_id, key=lambda k: (lib.label[k].lower(), k)) if lib.uses[k])
    unused = [k for k in lib.by_id if not lib.uses[k]]
    if unused:
        raise SystemExit("sources never cited: " + ", ".join(unused))
    sources = f'<ol class="sources" id="src-list">{src_rows}</ol>'

    fills = {
        "guide": guide, "claims": claims, "meet": meet, "numbers": numbers, "tables": tables, "glossary": glossary, "sources": sources,
        **{"domains:" + name: domain_switch(per_area) for name, (per_area, _) in lens.items()},
        "legend": legend_html(),
        "n:guide": n_guide, "n:claims": n_claims, "n:steps": n_steps, "n:numbers": n_numbers, "n:tables": n_tables,
        "n:terms": n_terms, "n:sources": sum(1 for k in lib.by_id if lib.uses[k]), "n:total": total, "updated": meta["updated_label"],
    }
    for key, value in fills.items():
        token = "{{" + key + "}}"
        if token not in page:
            raise SystemExit(f"content/fitness/page.html has no {token}")
        page = page.replace(token, str(value))
    left = re.findall(r"\{\{[^}]+\}\}", page)
    if left:
        raise SystemExit("unfilled tokens in page.html: " + ", ".join(sorted(set(left))))

    out = OrderedDict()
    out[PUBLIC / "fitness.html"] = page
    out[PUBLIC / "fitness.md"] = md_index(meta, counts)
    for dom in DOMAINS:
        out[PUBLIC / "fitness" / f"{dom}.md"] = md_domain(lib, meta, dom, data[dom])
    out[PUBLIC / "fitness" / "claims.md"] = md_claims(lib, meta, data["claims"]["entries"])

    # The pages under /fitness/. Built after /fitness, which they must not change.
    numbers = {"n:steps": n_steps, "n:claims": n_claims, "n:terms": n_terms, "n:numbers": n_numbers, "n:tables": n_tables,
               "n:sources": fills["n:sources"], "n:total": total, "updated": meta["updated_label"]}
    sub, pages = build_subpages(lib, meta, data, numbers, tool_uses)
    clash = [p.name for p in sub if p in out]
    if clash:
        raise SystemExit("routes.json would overwrite: " + ", ".join(clash))
    out.update(sub)
    return out, {"entries": total, "sources": fills["n:sources"], "guide": n_guide, "claims": n_claims, "numbers": n_numbers,
                 "tables": n_tables, "terms": n_terms, "steps": n_steps, "pages under /fitness/": len(pages.routes)}


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
    print("built /fitness: " + ", ".join(f"{v} {k}" for k, v in stats.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
