#!/usr/bin/env python3
"""Audit KiteSink's static HTML for metadata, accessibility, and link regressions."""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
SPECIAL_PAGES = {PUBLIC / "404.html", PUBLIC / "repost.html", PUBLIC / "blog/_template.html"}
# The pages under /fitness/, in the order of the hub: one per row of content/fitness/routes.json
# (scripts/build_fitness.py writes them). They are listed pages like any other, so the audit
# wants each in site-index.js and sitemap.xml, and each has a twin (see TWINS below), which
# wants a line in llms.txt and a route in run_worker_first in wrangler.jsonc.
FITNESS_ROUTES = json.loads((ROOT / "content" / "fitness" / "routes.json").read_text(encoding="utf-8"))["routes"]
FITNESS_SUBPAGES = tuple(route["slug"] for route in FITNESS_ROUTES)
# The pages under /music/, in the order of the hub. content/music/routes.json has a row for every
# planned page, but scripts/build_music.py writes one only once it has something to show (an area
# once its file exists), so the listed ones are the rows whose page is in public/music/. The
# `build_music.py --check` audit below fails if a page the data calls for is missing or out of date.
# Like the fitness pages, each is listed (site-index.js, sitemap.xml) and has a twin (llms.txt,
# run_worker_first in wrangler.jsonc).
MUSIC_ROUTES = json.loads((ROOT / "content" / "music" / "routes.json").read_text(encoding="utf-8"))["routes"]
MUSIC_SUBPAGES = tuple(route["slug"] for route in MUSIC_ROUTES if (PUBLIC / "music" / f"{route['slug']}.html").is_file())
# Kept at their addresses but hidden on purpose: not in the site index or the sitemap,
# not linked from any listed page, and marked noindex. The audit holds them to that.
# (They may link to each other and to listed pages.)
UNLISTED_PAGES = {PUBLIC / "vantix/roadmap.html", PUBLIC / "vantix/changelog.html"}


class Document(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_depth = 0
        self.title_parts: list[str] = []
        self.h1_count = 0
        self.ids: list[str] = []
        self.links: list[dict[str, str]] = []
        self.images: list[dict[str, str]] = []
        self.meta: list[dict[str, str]] = []
        self.canonicals: list[str] = []
        self.lang = ""
        self.ks_styles = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): value or "" for key, value in attrs}
        tag = tag.lower()
        if tag == "html":
            self.lang = values.get("lang", "")
        if tag == "title":
            self.title_depth += 1
        if tag == "h1":
            self.h1_count += 1
        if values.get("id"):
            self.ids.append(values["id"])
        if tag == "a":
            self.links.append(values)
        if tag == "img":
            self.images.append(values)
        if tag == "meta":
            self.meta.append(values)
        if tag == "link" and "canonical" in values.get("rel", "").lower().split():
            self.canonicals.append(values.get("href", ""))
        if tag == "style" and values.get("id") == "ks-a11y":
            self.ks_styles += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self.title_depth = max(0, self.title_depth - 1)

    def handle_data(self, data: str) -> None:
        if self.title_depth:
            self.title_parts.append(data)


def route_for(path: Path) -> str:
    relative = path.relative_to(PUBLIC)
    if relative == Path("index.html"):
        return "/"
    if relative.name == "index.html":
        return "/" + relative.parent.as_posix()
    return "/" + relative.with_suffix("").as_posix()


def resolves(path: str) -> bool:
    if path == "/":
        return (PUBLIC / "index.html").is_file()
    candidate = PUBLIC / path.lstrip("/")
    return candidate.is_file() or candidate.with_suffix(".html").is_file() or (candidate / "index.html").is_file()


def page_routes() -> dict[str, Path]:
    """Every public page that should be reachable, keyed by its route."""
    return {route_for(path): path for path in sorted(PUBLIC.rglob("*.html")) if path not in SPECIAL_PAGES | UNLISTED_PAGES}


def unlisted_routes() -> set[str]:
    return {route_for(path) for path in UNLISTED_PAGES}


def audit_index() -> list[str]:
    """The site index (public/site-index.js + blog/posts.js) is what the Find palette,
    the Library and the home page read. Hold it to two rules: every entry points at
    something real, and every public page is in it — so nothing can go missing."""
    issues: list[str] = []
    index_js = (PUBLIC / "site-index.js").read_text(encoding="utf-8")
    posts_js = (PUBLIC / "blog/posts.js").read_text(encoding="utf-8")
    def code(js: str) -> str:
        """Drop comments that start a line: /* block */ and // (the entry templates).
        Anchoring to the line start keeps a "/*" inside a string from eating real entries."""
        js = re.sub(r"(?ms)^[ \t]*/\*.*?\*/", "", js)
        return "\n".join(line for line in js.splitlines() if not line.lstrip().startswith("//"))

    quoted = r"""(?:"([^"]+)"|'([^']+)'|`([^`$]+)`)"""   # "x", 'x' or a plain `x`
    def values(js: str, key: str) -> list[str]:
        return ["".join(m) for m in re.findall(rf"""(?<![\w$])["']?{key}["']?\s*:\s*{quoted}""", code(js))]

    hrefs = values(index_js, "h") + values(posts_js, "href")
    # ids that exist only once JavaScript has rendered them: the Library's shelves
    shelf_ids = set(re.findall(r"""\bid\s*:\s*["']([\w-]+)["']""", code(index_js)))
    if not hrefs:
        return ["public/site-index.js: no entries found"]

    listed: set[str] = set()
    for href in hrefs:
        parsed = urlsplit(href)
        if parsed.scheme or parsed.netloc:
            continue
        path = parsed.path or "/"
        if path.endswith(".xml"):
            if not (PUBLIC / path.lstrip("/")).is_file():
                issues.append(f"public/site-index.js: entry points at a missing file: {href}")
            continue
        if not resolves(path):
            issues.append(f"public/site-index.js: entry points at a missing page: {href}")
        listed.add(path.rstrip("/") or "/")
        if parsed.fragment:
            target = PUBLIC / (path.strip("/") + ".html")
            built = path == "/library" and parsed.fragment in shelf_ids
            if target.is_file() and not built and not re.search(rf"""\bid=["']{re.escape(parsed.fragment)}["']""", target.read_text(encoding="utf-8")):
                issues.append(f"public/site-index.js: {href} — no element with id=\"{parsed.fragment}\" on that page")

    for route in sorted(unlisted_routes() & listed):
        issues.append(f"public/site-index.js: lists {route}, which is meant to be unlisted")
    for route in page_routes():
        if route != "/" and route not in listed:
            issues.append(f"public/site-index.js: page {route} is not in the site index (add it, or it is unreachable from the Library)")

    sitemap = (PUBLIC / "sitemap.xml").read_text(encoding="utf-8")
    in_sitemap = {urlsplit(loc).path.rstrip("/") or "/" for loc in re.findall(r"<loc>([^<]+)</loc>", sitemap)}
    for route in page_routes():
        if route not in in_sitemap:
            issues.append(f"public/sitemap.xml: missing {route}")
    for route in sorted(in_sitemap - set(page_routes())):
        issues.append(f"public/sitemap.xml: lists {route}, which has no page")
    return issues


# Plain-text twins for AI readers (docs/AI-PAGES.md): page route -> file in public/.
TWINS = {
    "/": "index.md", "/consulting": "consulting.md", "/fitness": "fitness.md", "/vantix": "vantix.md",
    "/music": "music.md", "/listening-club": "listening-club.md", "/about": "about.md",
    **{f"/fitness/{slug}": f"fitness/{slug}.md" for slug in FITNESS_SUBPAGES},
    **{f"/music/{slug}": f"music/{slug}.md" for slug in MUSIC_SUBPAGES},
}


def audit_twins() -> list[str]:
    """Every twin exists, is announced by its page and by /llms.txt, and links only to
    things that exist. The optional worker must route exactly the listed pages that have
    one; an unlisted page announces its twin but stays out of the worker until it is listed."""
    issues: list[str] = []
    llms = (PUBLIC / "llms.txt").read_text(encoding="utf-8") if (PUBLIC / "llms.txt").is_file() else ""
    if not llms:
        issues.append("public/llms.txt is missing")
    routes = {route_for(path): path for path in PUBLIC.rglob("*.html") if path not in SPECIAL_PAGES}
    for route, name in TWINS.items():
        twin = PUBLIC / name
        if not twin.is_file():
            issues.append(f"public/{name}: missing (the plain-text twin of {route})")
            continue
        page = routes.get(route)
        tag = f'<link rel="alternate" type="text/markdown" href="https://kitesink.com/{name}"'
        if page is None or tag not in page.read_text(encoding="utf-8"):
            issues.append(f"{route}: the page does not announce its twin; add {tag} …> to its <head>")
    for twin in sorted(list(PUBLIC.glob("*.md")) + list(PUBLIC.glob("*/*.md")) + [PUBLIC / "llms.txt"]):
        if not twin.is_file():
            continue
        label = twin.relative_to(ROOT).as_posix()
        if twin.suffix == ".md" and f"https://kitesink.com/{twin.relative_to(PUBLIC).as_posix()}" not in llms:
            issues.append(f"{label}: not listed in public/llms.txt")
        for url in set(re.findall(r"https://kitesink\.com(/[^\s)>\]#?]*)", twin.read_text(encoding="utf-8"))):
            url = url.rstrip(".,")
            target = PUBLIC / url.lstrip("/")
            if not (target.is_file() if re.search(r"\.[a-z0-9]+$", url) else resolves(url)):
                issues.append(f"{label}: links to https://kitesink.com{url}, which does not exist")
    config = ROOT / "wrangler.jsonc"
    if config.is_file():
        match = re.search(r'"run_worker_first"\s*:\s*\[([^\]]*)\]', config.read_text(encoding="utf-8"))
        routed = set(re.findall(r'"([^"]+)"', match.group(1))) if match else set()
        listed = set(TWINS) - unlisted_routes()
        if routed != listed:
            issues.append(f"wrangler.jsonc: run_worker_first lists {sorted(routed)} but the twins are for {sorted(listed)}")
    return issues


def audit_fitness_homes() -> list[str]:
    """Nothing the old one-page /fitness could be linked to may go missing.
    scripts/fixtures/fitness-legacy-ids.txt holds every id that page had. Two rules:

    One home. Each id that names an entry in content/fitness/ must be an element id on exactly
    one page under /fitness/, its home: a term on the glossary, a claim on the claims page,
    anything else on its area's page. It is never on the hub.

    Old links. /fitness#<id> must still land on that id. So each id in the file is either an
    element of the hub, or public/fitness/ids.json (the map the hub forwards by) sends it to a
    page that has an element with that id. No row of the map may point at a page that lacks
    its id, and the hub must link to every page under it."""
    content = ROOT / "content" / "fitness"
    fixture = ROOT / "scripts" / "fixtures" / "fitness-legacy-ids.txt"
    if not fixture.is_file():
        return ["scripts/fixtures/fitness-legacy-ids.txt is missing"]
    legacy = fixture.read_text(encoding="utf-8").split()
    routes = FITNESS_ROUTES
    slug_of = {(r.get("area") if r["kind"] == "area" else r["kind"]): r["slug"] for r in routes}
    home: dict[str, str] = {}
    for r in routes:
        if r["kind"] == "area":
            for entry in json.loads((content / f"{r['area']}.json").read_text(encoding="utf-8"))["entries"]:
                home[entry["id"]] = slug_of["glossary"] if entry["type"] == "term" else r["slug"]
    for entry in json.loads((content / "claims.json").read_text(encoding="utf-8"))["entries"]:
        home[entry["id"]] = slug_of["claims"]

    issues: list[str] = []
    ids: dict[str, set[str]] = {}
    for r in routes:
        page = PUBLIC / "fitness" / f"{r['slug']}.html"
        if not page.is_file():
            issues.append(f"fitness: public/fitness/{r['slug']}.html is missing (run python3 scripts/build_fitness.py)")
            continue
        doc = Document()
        doc.feed(page.read_text(encoding="utf-8"))
        ids[r["slug"]] = set(doc.ids)
    hub = Document()
    hub.feed((PUBLIC / "fitness.html").read_text(encoding="utf-8"))
    hub_ids = set(hub.ids)
    hub_links = {urlsplit(link.get("href", "")).path for link in hub.links}
    for r in routes:
        if f"/fitness/{r['slug']}" not in hub_links:
            issues.append(f"fitness: /fitness has no link to /fitness/{r['slug']}")

    for entry_id, where in home.items():
        on = sorted(slug for slug, found in ids.items() if entry_id in found)
        if on != [where] or entry_id in hub_ids:
            found = ", ".join(["/fitness"] * (entry_id in hub_ids) + ["/fitness/" + slug for slug in on]) or "no page"
            issues.append(f"fitness: the entry {entry_id} must be on /fitness/{where} and nowhere else; it is on {found}")

    map_file = PUBLIC / "fitness" / "ids.json"
    if not map_file.is_file():
        return issues + ["fitness: public/fitness/ids.json is missing (run python3 scripts/build_fitness.py)"]
    data = json.loads(map_file.read_text(encoding="utf-8"))
    sent = {old: data["pages"][n] for old, n in data["ids"].items()}
    for old, slug in sent.items():
        if old not in ids.get(slug, set()):
            issues.append(f"fitness: ids.json sends #{old} to /fitness/{slug}, which has no element with that id")
        if old in hub_ids:
            issues.append(f"fitness: #{old} is an element of /fitness, and ids.json also sends it to /fitness/{slug}")
    for old in legacy:
        if old not in hub_ids and old not in sent:
            issues.append(f"fitness: the old link /fitness#{old} goes nowhere: no element of the hub has that id and ids.json has no row for it")
    for entry_id, where in home.items():
        if sent.get(entry_id) != where:
            issues.append(f"fitness: ids.json must send #{entry_id} to /fitness/{where}; it sends it to {sent.get(entry_id) or 'no page'}")
    return issues


def audit_fitness_build() -> list[str]:
    """/fitness, the pages under it, their twins, the search index and the id map are
    generated; fail if any of them is older than its data."""
    import subprocess
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "build_fitness.py"), "--check"], capture_output=True, text=True)
    if result.returncode:
        return ["fitness: " + (result.stdout.strip() or result.stderr.strip().splitlines()[-1])]
    return []


def audit_music_build() -> list[str]:
    """/music, the pages under it, their twins, search.json and claimable.json are generated
    (scripts/build_music.py); fail if any of them is older than its data."""
    import subprocess
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "build_music.py"), "--check"], capture_output=True, text=True)
    if result.returncode:
        return ["music: " + (result.stdout.strip() or result.stderr.strip().splitlines()[-1])]
    return []


def audit_llms_full() -> list[str]:
    """/llms-full.txt is every twin in one file; fail if a twin changed and it was not rebuilt."""
    import subprocess
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "build_llms_full.py"), "--check"], capture_output=True, text=True)
    if result.returncode:
        return ["llms-full: " + (result.stdout.strip() or result.stderr.strip().splitlines()[-1])]
    return []


def audit_skill_search(label: str, skill: str, section: str, subpages: tuple[str, ...]) -> list[str]:
    """What a field-guide skill says about its section, held to the build that owns it: the
    pages it names (its "Pages:" paragraph), the layout of /<section>/search.json, and how an
    entry is found in its page's twin (a heading, a bold glossary item or a table row)."""
    issues: list[str] = []
    pages_line = re.search(r"^Pages: (.*?)\n\n", skill, re.M | re.S)
    named = re.findall(r"`([a-z-]+)`", pages_line.group(1)) if pages_line else []
    if named != list(subpages):
        issues.append(f"{label}: names the pages {named}, but the pages under /{section}/ are {list(subpages)}")
    search_path = PUBLIC / section / "search.json"
    if not search_path.is_file():
        return issues + [f"public/{section}/search.json: missing (the {section} skill relies on it)"]
    search = json.loads(search_path.read_text(encoding="utf-8"))
    if sorted(search) != ["areas", "kinds", "pages", "rows"]:
        return issues + [f"{label}: says search.json holds pages, kinds, areas and rows; it holds {sorted(search)}"]
    if search["pages"] != list(subpages):
        issues.append(f"{label}: search.json lists the pages {search['pages']}, not the pages under /{section}/")
    twins: dict[str, str] = {}
    lost = []
    for row in search["rows"]:
        ok = (isinstance(row, list) and 6 <= len(row) <= 7 and all(isinstance(row[i], int) for i in (1, 2, 3))
              and all(isinstance(row[i], str) for i in (0, 4, 5)))
        if not ok:
            issues.append(f"{label}: a search.json row is not [id, page, kind, area, title, short answer(, extra)]: {str(row)[:80]}")
            break
        page = search["pages"][row[1]]
        if page not in twins:
            twin = PUBLIC / section / f"{page}.md"
            twins[page] = twin.read_text(encoding="utf-8") if twin.is_file() else ""
        title = re.escape(row[4])
        if not any(re.search(p, twins[page], re.M) for p in (rf"^#{{2,4}} {title}\s*$", rf"^- \*\*{title}\*\*", rf"^\|.*\| {title}:")):
            lost.append(f"{row[0]} on {page}")
    if lost:
        issues.append(f"{label}: {len(lost)} entries cannot be found in their twin the way the skill says, e.g. {', '.join(lost[:3])}")
    return issues


def audit_fitness_skill() -> list[str]:
    """The kitesink-fitness-reference skill describes internals that scripts/build_fitness.py
    owns. Fail when they drift apart: the pages it names, the layout of search.json, and how
    an entry is found in its page's twin (a heading, a bold glossary item or a table row)."""
    label = "public/.well-known/agent-skills/kitesink-fitness-reference/SKILL.md"
    skill_path = ROOT / label
    if not skill_path.is_file():
        return []
    return audit_skill_search(label, skill_path.read_text(encoding="utf-8"), "fitness", FITNESS_SUBPAGES)


# The keys of /music/claimable.json and of each of its rows, as the music skill names them.
# scripts/build_music.py writes the file from content/music/claimable.json (DATA-PAGES.md).
CLAIMABLE_KEYS = ["name", "url", "publisher", "note", "dateModified", "rows", "sources"]
CLAIMABLE_ROW_KEYS = ["id", "holder", "pot", "money_type", "territory", "readers", "who_can_claim", "how_to_claim",
                      "rule", "cost", "link", "link_label", "confidence", "sources", "as_of"]


def audit_music_skill() -> list[str]:
    """The kitesink-music-reference skill describes internals that scripts/build_music.py owns.
    Fail when they drift apart: the pages it names (the music pages written so far), the layout
    of search.json, how an entry is found in its twin, the keys of claimable.json, and the
    scope line, which must be the one in content/music/meta.json word for word."""
    label = "public/.well-known/agent-skills/kitesink-music-reference/SKILL.md"
    skill_path = ROOT / label
    if not skill_path.is_file():
        return []
    skill = skill_path.read_text(encoding="utf-8")
    issues = audit_skill_search(label, skill, "music", MUSIC_SUBPAGES)
    claimable_path = PUBLIC / "music" / "claimable.json"
    if not claimable_path.is_file():
        issues.append("public/music/claimable.json: missing (the music skill relies on it)")
    else:
        claimable = json.loads(claimable_path.read_text(encoding="utf-8"))
        if list(claimable) != CLAIMABLE_KEYS:
            issues.append(f"{label}: says claimable.json holds {CLAIMABLE_KEYS}; it holds {list(claimable)}")
        odd = sorted({key for row in claimable.get("rows", []) for key in row} ^ set(CLAIMABLE_ROW_KEYS))
        if odd:
            issues.append(f"{label}: the claimable.json row keys differ from the ones the skill names: {odd}")
        unnamed = [key for key in CLAIMABLE_KEYS + CLAIMABLE_ROW_KEYS if f"`{key}`" not in skill]
        if unnamed:
            issues.append(f"{label}: does not name the claimable.json keys {unnamed}")
    scope = json.loads((ROOT / "content" / "music" / "meta.json").read_text(encoding="utf-8")).get("scope_line", "")
    if scope and f'"{scope}"' not in skill:
        issues.append(f"{label}: must quote the scope line in content/music/meta.json word for word")
    return issues


def audit_agent_files() -> list[str]:
    """What agents read about the site: the skills index and its digests, the Link headers in
    _headers and the worker's copy of _headers are generated (scripts/build_agent_files.py);
    every file under /.well-known/ is one the index accounts for; robots.txt states all three
    Content Signals."""
    import subprocess
    issues: list[str] = []
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "build_agent_files.py"), "--check"], capture_output=True, text=True)
    if result.returncode:
        issues.append("agent files: " + (result.stdout.strip() or result.stderr.strip().splitlines()[-1]))
    index = PUBLIC / ".well-known" / "agent-skills" / "index.json"
    known = {index}
    if index.is_file():
        known |= {PUBLIC / skill["url"].lstrip("/") for skill in json.loads(index.read_text(encoding="utf-8"))["skills"]}
    for path in sorted((PUBLIC / ".well-known").rglob("*")):
        if path.is_file() and path not in known:
            issues.append(f"{path.relative_to(ROOT).as_posix()}: published under /.well-known/ but not in the skills index; list it or add a rule for it here")
    issues += audit_fitness_skill()
    issues += audit_music_skill()
    robots = (PUBLIC / "robots.txt").read_text(encoding="utf-8")
    signal = re.search(r"^User-agent: \*\n(?:.*\n)*?Content-Signal: (.+)$", robots, re.M)
    keys = dict(part.strip().split("=", 1) for part in signal.group(1).split(",")) if signal else {}
    if set(keys) != {"search", "ai-input", "ai-train"} or not set(keys.values()) <= {"yes", "no"}:
        issues.append("public/robots.txt: the User-agent: * group needs one Content-Signal line with search, ai-input and ai-train, each yes or no")
    return issues


def audit_asset_versions() -> list[str]:
    """Every page must request the same ?v= of the shared CSS/JS, or returning
    visitors can get a new page with an old cached stylesheet."""
    seen: dict[str, set[str]] = {}
    for path in sorted(PUBLIC.rglob("*.html")):
        for name, version in re.findall(r"""["']/(ks\.css|ks\.js|site-index\.js|fitness\.js|fitness\.css|fitness-ref\.js|music-ref\.css|music-ref\.js|music-tools\.js)(?:\?v=([^"']*))?["']""", path.read_text(encoding="utf-8")):
            seen.setdefault(name, set()).add(version or "(none)")
    issues = [f"public: pages request different versions of /{name}: {', '.join(sorted(v))}" for name, v in seen.items() if len(v) > 1]
    # ks.js fetches /site-index.js itself (for the Find palette) and must name the same release
    declared = re.search(r"""\bASSET_V\s*=\s*["']([^"']+)["']""", (PUBLIC / "ks.js").read_text(encoding="utf-8"))
    everywhere = set().union(*seen.values()) if seen else set()
    if not declared:
        issues.append("public/ks.js: ASSET_V is missing")
    elif everywhere and everywhere != {declared.group(1)}:
        issues.append(f"public/ks.js: ASSET_V is {declared.group(1)!r} but pages request {', '.join(sorted(everywhere))}")
    return issues


def audit(path: Path) -> list[str]:
    source = path.read_text(encoding="utf-8")
    doc = Document()
    doc.feed(source)
    issues: list[str] = []
    label = path.relative_to(ROOT).as_posix()

    def add(message: str) -> None:
        issues.append(f"{label}: {message}")

    if not doc.lang:
        add("missing html[lang]")
    if not "".join(doc.title_parts).strip():
        add("missing title")
    if doc.h1_count != 1:
        add(f"expected one h1, found {doc.h1_count}")
    if doc.ks_styles:
        add("contains duplicate inline #ks-a11y styles")

    duplicate_ids = sorted(key for key, count in Counter(doc.ids).items() if count > 1)
    if duplicate_ids:
        add("duplicate IDs: " + ", ".join(duplicate_ids))

    meta_names = {item.get("name", "").lower(): item.get("content", "") for item in doc.meta}
    if not meta_names.get("viewport"):
        add("missing viewport metadata")
    if path not in SPECIAL_PAGES and not meta_names.get("description"):
        add("missing meta description")

    if path in UNLISTED_PAGES and "noindex" not in meta_names.get("robots", "").lower():
        add("unlisted page must be noindex")
    if path.parent == PUBLIC / "fitness" and "noindex" in meta_names.get("robots", "").lower():
        add("a listed fitness page must not be noindex")
    if path.parent == PUBLIC / "music" and "noindex" in meta_names.get("robots", "").lower():
        add("a listed music page must not be noindex")

    if path == PUBLIC / "404.html":
        if "noindex" not in meta_names.get("robots", "").lower():
            add("404 page must be noindex")
        if doc.canonicals:
            add("404 page must not declare a canonical URL")
    elif path not in SPECIAL_PAGES:
        expected = "https://kitesink.com" + route_for(path)
        if doc.canonicals != [expected]:
            add(f"canonical must be {expected!r}; found {doc.canonicals!r}")

    for image in doc.images:
        src = image.get("src", "<missing src>")
        if "alt" not in image:
            add(f"image missing alt: {src}")
        if not image.get("width") or not image.get("height"):
            add(f"image missing intrinsic dimensions: {src}")

    for link in doc.links:
        href = link.get("href", "")
        if link.get("target", "").lower() == "_blank" and "noopener" not in link.get("rel", "").lower().split():
            add(f"target=_blank link missing rel=noopener: {href}")
        parsed = urlsplit(href)
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        if parsed.netloc and parsed.netloc != "kitesink.com":
            continue
        internal_path = parsed.path
        if internal_path.endswith(".html"):
            add(f"internal URL is not extensionless: {href}")
        if internal_path.startswith("/") and not resolves(internal_path):
            add(f"broken internal link: {href}")
        if path not in UNLISTED_PAGES and (internal_path.rstrip("/") or "/") in unlisted_routes():
            add(f"links to an unlisted page: {href}")

    return issues


def main() -> int:
    pages = sorted(PUBLIC.rglob("*.html"))
    issues = [issue for page in pages for issue in audit(page)]
    issues += audit_index()
    issues += audit_asset_versions()
    issues += audit_twins()
    issues += audit_fitness_build()
    issues += audit_fitness_homes()
    issues += audit_music_build()
    issues += audit_llms_full()
    issues += audit_agent_files()

    deployed_text = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted(PUBLIC.rglob("*"))
        if path.is_file() and path.suffix in {".html", ".js", ".xml"}
    )
    if "discord.gg/INVITE" in deployed_text:
        issues.append("public: placeholder Discord invite remains")
    if re.search(r"(?:href|src)=[\"']https://kitesink\.com/[^\"']+\.html", deployed_text):
        issues.append("public: same-origin absolute .html URL remains")

    if issues:
        print(f"Site audit failed with {len(issues)} issue(s):")
        for issue in issues:
            print(f"- {issue}")
        return 1

    print(f"Site audit passed: {len(pages)} HTML pages checked; site index and sitemap cover every page.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
