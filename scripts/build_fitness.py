#!/usr/bin/env python3
"""Build /fitness from the data in content/fitness/.

    python3 scripts/build_fitness.py            # write the page and its markdown twins
    python3 scripts/build_fitness.py --check    # exit 1 if what is in public/ is out of date

Inputs (all in content/fitness/):
    page.html     the page shell: head, hero, Vantix feature, the calculators
    meta.json     the "last updated" date and a few labels
    tools.json    sources the calculators cite
    <domain>.json one file per area (hypertrophy, powerlifting, meet, nutrition, diet, health)
    claims.json   the "claims, checked" entries

Outputs:
    public/fitness.html
    public/fitness.md and public/fitness/<domain>.md, claims.md  (plain-text twins for AI readers)

The page is static HTML: every entry is in the markup, so it reads without
JavaScript. /fitness.js only filters, sorts and remembers. To add an entry, add
it to the right JSON file and run this script. scripts/check_site.py runs the
--check form, so a stale page fails the audit.
"""
import html
import json
import os
import re
import sys
from collections import Counter, OrderedDict
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


def facet(name, options, label, all_label="All"):
    """A single-choice filter group. options: [(value, label)]."""
    btns = [f'<button type="button" class="fx" value="all" aria-pressed="true">{esc(all_label)}</button>']
    btns += [f'<button type="button" class="fx" value="{esc(v)}" aria-pressed="false">{esc(l)} <b></b></button>' for v, l in options]
    return (f'<div class="fx-group" data-facet="{name}" role="group" aria-label="{esc(label)}">'
            f'<span class="fx-label">{esc(label)}</span><div class="fx-row">' + "".join(btns) + "</div></div>")


def item_html(lib, dom, e, order, topics, extra_tags=""):
    kind = e["type"]
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
        rows.append(f'<h3 class="g-head" id="{dom}" data-d="{dom}" data-o="{n}"><span>{esc(label)}</span><small>{esc(blurb)} {len(entries)} entries.</small></h3>')
        n += 1
        entries.sort(key=lambda e: (list(topics).index(e["topic"]) if e.get("topic") in topics else 99, e["type"] == "mistake"))
        for e in entries:
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
        '<label class="gx-sort"><span class="fx-label">Sort</span><select class="k-select" id="g-sort">'
        '<option value="suggested">Suggested order</option><option value="az">A to Z</option>'
        '<option value="conf">Best supported first</option><option value="level">Beginner first</option>'
        '<option value="newest">Newest source first</option></select></label>'
        '<button type="button" class="k-btn k-btn--ghost k-btn--sm" id="g-open" aria-pressed="false">Open all</button>'
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


def build_claims(lib, data):
    claims = data["claims"]["entries"]
    used_tags = [t for t in TAGS if any(t in c.get("tags", []) for c in claims)]
    used_ev = [v for v in EVIDENCE if any(c.get("evidence") == v for c in claims)]
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
            body += '<p class="q-rel">Related: ' + " · ".join(f'<a href="#{esc(o["id"])}">{esc(o["title"])}</a>' for o in rel) + "</p>"
        rows.append(
            f'<details class="k-qa q" id="{esc(c["id"])}" data-d="{c["domain"]}" data-v="{c["verdict"]}" data-e="{c["evidence"]}" '
            f'data-tags="{esc(" ".join(c.get("tags", [])))}" data-l="{c["level"]}" data-c="{c["confidence"]}" data-y="{lib.year("claims", c.get("sources", []))}" data-o="{i}">'
            f'<summary>{esc(c["title"])}<span class="verdict {cls}">{esc(label)}</span></summary>'
            f'<div class="k-qa-body">{body}</div></details>'
        )
    controls = (
        '<div class="qx-controls" id="q-controls">'
        + facet("verdict", [(v, VERDICTS[v][0]) for v in VERDICTS], "Verdict")
        + facet("tag", [(t, TAGS[t]) for t in used_tags], "Topic")
        + facet("evidence", [(v, EVIDENCE[v]) for v in used_ev], "Evidence")
        + '<div class="gx-bar"><label class="k-vh" for="q-q">Search the claims</label>'
          '<input class="k-input gx-q" id="q-q" type="search" placeholder="Search: creatine, failure, fasting, kidneys…" autocomplete="off">'
          '<label class="gx-sort"><span class="fx-label">Sort</span><select class="k-select" id="q-sort">'
          '<option value="suggested">Suggested order</option><option value="verdict">Holds up first</option>'
          '<option value="verdict-rev">Not supported first</option><option value="az">A to Z</option>'
          '<option value="evidence">Strongest evidence first</option><option value="newest">Newest source first</option></select></label></div>'
        + '<p class="gx-count" id="q-count" aria-live="polite"></p></div>'
    )
    out = (controls + '<div id="q-list">' + "\n".join(rows) + "</div>"
           '<p class="gx-empty" id="q-empty" hidden>No claim matches. <button type="button" class="k-linkbtn" data-reset="claims">Clear the filters</button></p>')
    return out, len(claims)


def build_meet(lib, data):
    d = data["meet"]
    topics = OrderedDict((t["id"], t["label"]) for t in d.get("topics", []))
    steps = [e for e in d["entries"] if e["type"] == "step"]
    out, n = ['<ol class="tl">'], 0
    for when, label in WHEN.items():
        group = [e for e in steps if e.get("when") == when]
        if not group:
            continue
        out.append(f'<li class="tl-phase"><h3 class="tl-when">{esc(label)}</h3><div class="tl-steps">')
        for e in group:
            out.append(item_html(lib, "meet", e, n, topics))
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
        out.append("</div>" + lib.cite_html("meet", e.get("sources", [])) + "</div>")
    return "\n".join(out), len(steps)


def build_numbers(lib, data):
    rows = []
    for dom in DOMAINS:
        for e in data[dom]["entries"]:
            if e["type"] != "number":
                continue
            cites = lib.cite_html(dom, e.get("sources", []))
            rows.append(
                f'<tr id="{esc(e["id"])}" data-d="{dom}" data-c="{e["confidence"]}" data-n="{e["sort"]}" data-o="{len(rows)}">'
                f'<th scope="row"><span class="nx-v">{esc(e["value"])}</span><span class="nx-u">{esc(e.get("unit", ""))}</span></th>'
                f'<td><b>{esc(e["title"])}</b><span>{esc(e["take"])}</span>{cites}</td>'
                f'<td class="nx-d">{esc(DOMAINS[dom][0])}</td>'
                f'<td class="nx-c">{tag("tg-c tg-" + e["confidence"], CONF[e["confidence"]], CONF_HELP[e["confidence"]])}</td></tr>'
            )
    head = ('<thead><tr><th scope="col"><button type="button" data-sort="n">Number</button></th>'
            '<th scope="col"><button type="button" data-sort="t">What it is</button></th>'
            '<th scope="col"><button type="button" data-sort="d">Area</button></th>'
            '<th scope="col"><button type="button" data-sort="c">Support</button></th></tr></thead>')
    out = ('<div class="nx-wrap"><table class="nx" id="n-table">' + head + "<tbody>" + "\n".join(rows) + "</tbody></table></div>"
           '<p class="gx-empty" id="n-empty" hidden>No numbers for that area yet.</p>')
    return out, len(rows)


def build_tables(lib, data):
    out, n = [], 0
    for dom in DOMAINS:
        for e in data[dom]["entries"]:
            if e["type"] != "table":
                continue
            head = "".join(f'<th scope="col">{esc(c)}</th>' for c in e["columns"])
            body = "".join("<tr>" + "".join((f'<th scope="row">{esc(c)}</th>' if i == 0 else f"<td>{esc(c)}</td>") for i, c in enumerate(r)) + "</tr>" for r in e["rows"])
            out.append(
                f'<details class="rt" id="{esc(e["id"])}" data-d="{dom}"><summary><span class="g-meta">{esc(DOMAINS[dom][0])}</span>'
                f'<span class="g-title">{esc(e["title"])}</span><span class="g-take">{esc(e["take"])}</span></summary>'
                f'<div class="rt-scroll" tabindex="0" role="region" aria-label="{esc(e["title"])}"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'
                + tag("tg-c tg-" + e["confidence"], CONF[e["confidence"]], CONF_HELP[e["confidence"]]) + lib.cite_html(dom, e.get("sources", [])) + "</details>"
            )
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


# ----------------------------------------------------------------- assemble
def build():
    meta, lib, data = load()
    page = (SRC / "page.html").read_text(encoding="utf-8")

    # 1. inline citations in the shell (the calculators): {{c:key,key}}
    def inline(m):
        keys = [k.strip() for k in m.group(1).split(",")]
        return lib.cite_html("tools", keys).replace('<p class="cite">', '<span class="cite">').replace("</p>", "</span>")
    page = re.sub(r"\{\{c:([^}]+)\}\}", inline, page)

    guide, n_guide = build_guide(lib, data)
    claims, n_claims = build_claims(lib, data)
    meet, n_steps = build_meet(lib, data)
    numbers, n_numbers = build_numbers(lib, data)
    tables, n_tables = build_tables(lib, data)
    glossary, n_terms = build_glossary(lib, data)

    counts = {d: len(data[d]["entries"]) for d in DOMAINS}
    counts["claims"] = n_claims
    total = sum(counts.values())

    kinds = Counter(s.get("type", "other") for s in lib.by_id.values())
    src_rows = "\n".join(lib.entry_html(k) for k in sorted(lib.by_id, key=lambda k: (lib.label[k].lower(), k)) if lib.uses[k])
    unused = [k for k in lib.by_id if not lib.uses[k]]
    if unused:
        raise SystemExit("sources never cited: " + ", ".join(unused))
    sources = f'<ol class="sources" id="src-list">{src_rows}</ol>'

    fills = {
        "guide": guide, "claims": claims, "meet": meet, "numbers": numbers, "tables": tables, "glossary": glossary, "sources": sources,
        "domains": domain_switch(counts),
        "legend": '<dl class="lg">' + "".join(f'<div><dt>{tag("tg-c tg-" + c, CONF[c])}</dt><dd>{esc(CONF_HELP[c])}</dd></div>' for c in CONF) + "</dl>",
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
    return out, {"entries": total, "sources": fills["n:sources"], "guide": n_guide, "claims": n_claims, "numbers": n_numbers,
                 "tables": n_tables, "terms": n_terms, "steps": n_steps}


def main():
    out, stats = build()
    if "--check" in sys.argv:
        stale = [p.name for p, text in out.items() if not p.is_file() or p.read_text(encoding="utf-8") != text]
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
