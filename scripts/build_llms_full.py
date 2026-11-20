#!/usr/bin/env python3
"""Write public/llms-full.txt: every plain-text twin in one file.

The twins are taken in the order public/llms.txt lists them, and every one of them gets its
own part, headed by its address. To keep the file to a size a reader can take in one request,
text that would be repeated is given once and the rest points to it. Nothing is dropped
without a pointer to where it is (docs/AI-PAGES.md, "What llms-full.txt leaves out"):

1. The offers block that ends every twin appears once, at the end.
2. A section ("## " heading) whose text is word for word a section already in the file is
   replaced by one line naming the part that holds it.
3. The "## Terms" section of a field-guide page (a term and its definition, once per term) is
   replaced by the list of term names, when every one of those definitions is word for word
   in that guide's glossary, which is a part of this file. If any is not, the section stays.
4. The A-to-Z list of sources of each field guide ("## All N sources, A to Z") is replaced by
   a line giving its address, followed by only the sources whose address appears nowhere
   else in this file. The entries link their own sources (author, year and address), so every
   source's address stays in the file; what moves out is each full reference (title, journal,
   kind, times cited), complete at /fitness/sources.md and /music/sources.md. It was the
   largest single part.

Run this after scripts/build_fitness.py or scripts/build_music.py, and after editing any
hand-written twin.

    python3 scripts/build_llms_full.py            # write the file
    python3 scripts/build_llms_full.py --check    # exit 1 if the file is out of date
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
SITE = "https://kitesink.com"
OFFERS = re.compile(r"\n## Offers for people who arrive through an AI assistant\n.*?(?=\n---\n)", re.S)
RULE = "=" * 64
# Rule 2: a repeated section shorter than this stays; a pointer would save next to nothing.
MIN_REPEAT = 200
# Rule 4: the source lists left out. Set to False to put them back in.
LEAVE_OUT_SOURCE_LISTS = True
SOURCE_LIST = re.compile(r"## All (\d+) sources, A to Z")
TERM = re.compile(r"- \*\*(.+?)\*\*: (.+)")
URL = re.compile(r"https?://[^\s)>\]]+")


def sections(text: str) -> list[tuple[str, str]]:
    """The twin as (heading, body) pairs: first the text before any "## " heading (heading ""),
    then one pair per "## " heading, the body running to the next one."""
    parts = re.split(r"(?m)^(## .*)$", text)
    return [("", parts[0])] + [(parts[i], parts[i + 1]) for i in range(1, len(parts), 2)]


def terms_pointer(body: str, glossary: str, glossary_name: str) -> str | None:
    """Rule 3: the Terms section as a list of names, if the glossary holds every definition."""
    lines = body.strip("\n").splitlines()
    terms = [TERM.fullmatch(line) for line in lines]
    names = [m.group(1) for m in terms if m]
    if not names or not glossary:
        return None
    for m in terms:
        if m and (f"- **{m.group(1)}**" not in glossary or m.group(2) not in glossary):
            return None
    kept = [line for line, m in zip(lines, terms) if not m and line.strip()]
    pointer = (f"Terms used on this page ({len(names)}), each defined word for word in the glossary part of this file "
               f"(FILE: {SITE}/{glossary_name}): " + "; ".join(names) + ".")
    return "\n\n".join(kept + [pointer])


def body_items(body: str) -> list[str]:
    """The items of a source list: each starts "- " and runs on over any wrapped lines."""
    items: list[str] = []
    for line in body.strip("\n").splitlines():
        if line.startswith("- ") or not items:
            items.append(line)
        else:
            items[-1] += "\n" + line
    return [item for item in items if item.strip()]


def build() -> str:
    index = (PUBLIC / "llms.txt").read_text(encoding="utf-8")
    twins = list(dict.fromkeys(re.findall(re.escape(SITE) + r"/([A-Za-z0-9_./-]+\.md)", index)))
    if not twins:
        raise SystemExit("public/llms.txt lists no .md files")
    for name in twins:
        if not (PUBLIC / name).is_file():
            raise SystemExit(f"public/llms.txt lists {name}, which does not exist")
    summary = next((line[2:].strip() for line in index.splitlines() if line.startswith("> ")), "")
    out = ["# KiteSink: every page in one file", ""]
    if summary:
        out += ["> " + summary, ""]
    out += [f"The {len(twins)} plain-text pages listed in {SITE}/llms.txt, one after another. "
            "Each part begins with the address of the file it came from. Text that would repeat is given once: "
            "the offers that end every page are at the end of this file, a section that repeats one already "
            "given points to it, a field-guide page lists the names of its terms where the glossary part holds "
            "their definitions, and each field guide's A-to-Z list of sources keeps only the sources no entry here "
            "links, with the address of the full list. "
            "Each file at its own address is complete.", ""]
    offers = ""
    seen: dict[str, tuple[str, str]] = {}
    lists: list[tuple[str, str, list[str]]] = []
    for name in twins:
        text = (PUBLIC / name).read_text(encoding="utf-8")
        found = OFFERS.search(text)
        if found and not offers:
            offers = found.group(0).strip()
        text = OFFERS.sub("", text)
        # The footer (from the last "---" rule: the page's address, maintainer and date) stays
        # with its part and out of the section comparison.
        cut = text.rfind("\n---\n")
        text, footer = (text[:cut], text[cut:]) if cut >= 0 else (text, "")
        glossary_name = f"{name.rsplit('/', 1)[0]}/glossary.md" if "/" in name else ""
        glossary = ""
        if glossary_name in twins and glossary_name != name:
            glossary = (PUBLIC / glossary_name).read_text(encoding="utf-8")
        parts = []
        for heading, body in sections(text):
            key = body.strip()
            first = seen.get(key) if heading and len(key) >= MIN_REPEAT else None
            source_list = SOURCE_LIST.fullmatch(heading) if heading else None
            if first:
                body = (f"\n\nThe same as the section \"{first[1][3:]}\" in FILE: {SITE}/{first[0]}, "
                        "given earlier in this file.\n\n")
            elif source_list and LEAVE_OUT_SOURCE_LISTS:
                # filled in once the rest of the file is known (rule 4)
                lists.append((name, source_list.group(1), body_items(body)))
                body = f"\n\n\0SOURCES {len(lists) - 1}\0\n\n"
            elif heading == "## Terms":
                short = terms_pointer(body, glossary, glossary_name)
                if short is not None:
                    body = "\n\n" + short + "\n\n"
            if heading and len(key) >= MIN_REPEAT:
                seen.setdefault(key, (name, heading))
            parts.append(heading + body)
        out += [RULE, f"FILE: {SITE}/{name}", RULE, "", ("".join(parts).rstrip() + "\n" + footer).strip(), ""]
    if offers:
        out += [RULE, "OFFERS (the same on every page above)", RULE, "", offers, ""]
    text = "\n".join(out)
    linked = {u.rstrip(".,;") for u in URL.findall(text)}
    for i, (name, count, items) in enumerate(lists):
        # Rule 4: a source stays when no other part of the file holds its address (or it has none).
        kept = [item for item in items if not URL.findall(item) or any(u.rstrip(".,;") not in linked for u in URL.findall(item))]
        note = (f"Left out of this file for its size: the full reference of each of the {count} sources is at {SITE}/{name}. "
                "Every source's address is still in this file: the entries link their own sources")
        note += (f", and the {len(kept)} that no entry here links are listed below." if kept else ".")
        text = text.replace(f"\0SOURCES {i}\0", "\n".join([note, ""] + kept if kept else [note]))
    return text


def main() -> int:
    target = PUBLIC / "llms-full.txt"
    text = build()
    if "--check" in sys.argv[1:]:
        if not target.is_file() or target.read_text(encoding="utf-8") != text:
            print("public/llms-full.txt is out of date: run python3 scripts/build_llms_full.py")
            return 1
        return 0
    target.write_text(text, encoding="utf-8")
    print(f"wrote public/llms-full.txt: {len(text.split())} words, {len(text.encode('utf-8')):,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
