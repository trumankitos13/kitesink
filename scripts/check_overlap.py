#!/usr/bin/env python3
"""Check content entries for copied wording. Usage:
     python3 scripts/check_overlap.py content/music/FILE.json [...] --corpus DIR [--corpus DIR2]
DIR holds the private source material as .txt (or .pdf, converted with pdftotext). It stays
outside the repository: pass a path in the session's scratch area, never a tracked folder.

Every entry's published text (title, take, body, do, basis, table cells, checklist items) is
compared with every corpus file, word by word after lower-casing and dropping punctuation.
  ERROR  a run of 8 or more words in common
  review a run of 6 or 7 words in common (read it; common phrases are fine)
Text inside double quotes is a quotation, attributed in the entry, and is left out of the
check; a quotation over 25 words is flagged, since the brief allows brief quotes only.
Exit 1 on any error."""
import json, re, subprocess, sys
from pathlib import Path

ERR_N, REVIEW_N, QUOTE_MAX = 8, 6, 25
QUOTE = re.compile(r"[\"“]([^\"”]{1,2000})[\"”]")

def words(text):
    text = text.lower().replace("’", "'")
    return re.findall(r"[a-z0-9]+(?:'[a-z]+)?", text)

def load_corpus(dirs):
    docs = {}
    for d in dirs:
        p = Path(d)
        if not p.is_dir():
            sys.exit(f"corpus dir not found: {d}")
        repo = Path(__file__).resolve().parents[1]
        if repo in p.resolve().parents or p.resolve() == repo:
            sys.exit(f"corpus dir {d} is inside the repository; private material stays outside it")
        for f in sorted(p.iterdir()):
            if f.suffix == ".txt":
                docs[f.name] = words(f.read_text(encoding="utf-8", errors="ignore"))
            elif f.suffix == ".pdf" and not f.with_suffix(".txt").exists():
                out = subprocess.run(["pdftotext", str(f), "-"], capture_output=True, text=True)
                docs[f.name] = words(out.stdout)
    return docs

def ngrams(ws, n):
    return {tuple(ws[i:i + n]) for i in range(len(ws) - n + 1)}

def entry_fields(e):
    out = []
    for k in ("title", "take", "body", "basis"):
        if isinstance(e.get(k), str): out.append((k, e[k]))
    for i, x in enumerate(e.get("do") or []): out.append((f"do[{i}]", x))
    for r, row in enumerate(e.get("rows") or []):
        for c, cell in enumerate(row): out.append((f"rows[{r}][{c}]", str(cell)))
    for g in e.get("groups") or []:
        for i, x in enumerate(g.get("items") or []): out.append((f"{g.get('name', 'group')}[{i}]", x))
    return out

def longest_runs(ws, index, n):
    """Return the maximal runs (as word lists) of length >= n found in the corpus index."""
    hits, i = [], 0
    while i <= len(ws) - n:
        if tuple(ws[i:i + n]) in index:
            j = i + n
            while j < len(ws) and tuple(ws[j - n + 1:j + 1]) in index:
                j += 1
            hits.append(ws[i:j]); i = j
        else:
            i += 1
    return hits

def main():
    argv = sys.argv[1:]
    files, dirs = [], []
    while argv:
        a = argv.pop(0)
        if a == "--corpus" and argv: dirs.append(argv.pop(0))
        elif not a.startswith("--"): files.append(a)
    if not files or not dirs:
        print(__doc__); return 2
    docs = load_corpus(dirs)
    idx6 = {name: ngrams(ws, REVIEW_N) for name, ws in docs.items()}
    errors = reviews = 0
    for path in files:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        for e in data.get("entries", []):
            for field, text in entry_fields(e):
                for q in QUOTE.findall(text):
                    if len(words(q)) > QUOTE_MAX:
                        print(f"review {path} {e.get('id')} {field}: quotation of {len(words(q))} words; keep quotes brief")
                ws = words(QUOTE.sub(" ", text))
                for name, ix in idx6.items():
                    for run in longest_runs(ws, ix, REVIEW_N):
                        level = "ERROR " if len(run) >= ERR_N else "review"
                        if len(run) >= ERR_N: errors += 1
                        else: reviews += 1
                        print(f"{level} {path} {e.get('id')} {field}: {len(run)} words in common with {name}: \"{' '.join(run)}\"")
    print(f"{errors} error(s), {reviews} to review, against {len(docs)} corpus file(s)")
    return 1 if errors else 0

if __name__ == "__main__":
    sys.exit(main())
