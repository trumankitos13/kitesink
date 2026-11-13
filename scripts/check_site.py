#!/usr/bin/env python3
"""Audit KiteSink's static HTML for metadata, accessibility, and link regressions."""

from __future__ import annotations

import re
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
SPECIAL_PAGES = {PUBLIC / "404.html", PUBLIC / "repost.html", PUBLIC / "blog/_template.html"}


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
    return {route_for(path): path for path in sorted(PUBLIC.rglob("*.html")) if path not in SPECIAL_PAGES}


def audit_index() -> list[str]:
    """The site index (public/site-index.js + blog/posts.js) is what the Find palette,
    the Library and the home page read. Hold it to two rules: every entry points at
    something real, and every public page is in it — so nothing can go missing."""
    issues: list[str] = []
    index_js = (PUBLIC / "site-index.js").read_text(encoding="utf-8")
    posts_js = (PUBLIC / "blog/posts.js").read_text(encoding="utf-8")
    def code(js: str) -> str:  # drop /* block */ comments and whole-line // comments (the templates)
        js = re.sub(r"/\*.*?\*/", "", js, flags=re.S)
        return "\n".join(line for line in js.splitlines() if not line.lstrip().startswith("//"))

    hrefs = re.findall(r"""\bh:\s*["']([^"']+)["']""", code(index_js))
    hrefs += re.findall(r"""\bhref:\s*["']([^"']+)["']""", code(posts_js))
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
            if target.is_file() and not re.search(rf"""\bid=["']{re.escape(parsed.fragment)}["']""", target.read_text(encoding="utf-8")):
                issues.append(f"public/site-index.js: {href} — no element with id=\"{parsed.fragment}\" on that page")

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


def audit_asset_versions() -> list[str]:
    """Every page must request the same ?v= of the shared CSS/JS, or returning
    visitors can get a new page with an old cached stylesheet."""
    seen: dict[str, set[str]] = {}
    for path in sorted(PUBLIC.rglob("*.html")):
        for name, version in re.findall(r"""["']/(ks\.css|ks\.js)(?:\?v=([^"']*))?["']""", path.read_text(encoding="utf-8")):
            seen.setdefault(name, set()).add(version or "(none)")
    return [f"public: pages request different versions of /{name}: {', '.join(sorted(v))}" for name, v in seen.items() if len(v) > 1]


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

    return issues


def main() -> int:
    pages = sorted(PUBLIC.rglob("*.html"))
    issues = [issue for page in pages for issue in audit(page)]
    issues += audit_index()
    issues += audit_asset_versions()

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
