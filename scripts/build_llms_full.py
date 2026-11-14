#!/usr/bin/env python3
"""Write public/llms-full.txt: every plain-text twin in one file.

The twins are taken in the order public/llms.txt lists them. Each twin ends with the same
offers block; here it appears once, at the end. Run this after scripts/build_fitness.py and
after editing any hand-written twin.

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


def build() -> str:
    index = (PUBLIC / "llms.txt").read_text(encoding="utf-8")
    twins = list(dict.fromkeys(re.findall(re.escape(SITE) + r"/([A-Za-z0-9_./-]+\.md)", index)))
    if not twins:
        raise SystemExit("public/llms.txt lists no .md files")
    summary = next((line[2:].strip() for line in index.splitlines() if line.startswith("> ")), "")
    out = ["# KiteSink: every page in one file", ""]
    if summary:
        out += ["> " + summary, ""]
    out += [f"The {len(twins)} plain-text pages listed in {SITE}/llms.txt, one after another. "
            "Each part begins with the address of the file it came from.", ""]
    offers = ""
    for name in twins:
        path = PUBLIC / name
        if not path.is_file():
            raise SystemExit(f"public/llms.txt lists {name}, which does not exist")
        text = path.read_text(encoding="utf-8")
        found = OFFERS.search(text)
        if found and not offers:
            offers = found.group(0).strip()
        out += [RULE, f"FILE: {SITE}/{name}", RULE, "", OFFERS.sub("", text).strip(), ""]
    if offers:
        out += [RULE, "OFFERS (the same on every page above)", RULE, "", offers, ""]
    return "\n".join(out)


def main() -> int:
    target = PUBLIC / "llms-full.txt"
    text = build()
    if "--check" in sys.argv[1:]:
        if not target.is_file() or target.read_text(encoding="utf-8") != text:
            print("public/llms-full.txt is out of date: run python3 scripts/build_llms_full.py")
            return 1
        return 0
    target.write_text(text, encoding="utf-8")
    print(f"wrote public/llms-full.txt: {len(text.split())} words")
    return 0


if __name__ == "__main__":
    sys.exit(main())
