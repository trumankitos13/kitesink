# Music field guide: how to write an entry

**Status: DRAFT for the owner's approval (2026-11-19). No entries are written until it is approved.**

The data behind kitesink.com/music will live in this folder: one JSON file per area and
`claims.json`. `scripts/build_music.py` (a fork of `scripts/build_fitness.py`, still to be
built) will turn them into the hub at `/music` and the pages under `/music/`. This file is the
format and the rules for anyone, person or agent, who adds or changes an entry. The batch
process itself is the `site-content-pass` skill (`.claude/skills/site-content-pass/`).

The guide is a large set of short, sourced entries that are easy to filter by reader,
territory and topic. Every word is written for this site.

## Absolute rules

1. **Not legal advice.** Never tell a reader to sign, terminate, sue, or rely on a reading of
   a contract. Where a topic needs a lawyer (contracts, termination notices, disputes,
   litigation), say what the risk is and that a music lawyer should be involved. Every page
   carries the scope line (wording held for the owner, see `HOLDS.md`).
2. **Never invent.** No rate, figure, date, docket number, deal, quote or rule that you did not
   read in the source you cite. Open every source before you state what it says. A number in
   your text must appear in the part of the source a reader can open.
3. **If you cannot verify something, leave it out** and list it in your report. A source page
   that blocks you (403, CAPTCHA) cannot be cited as read: put it on the holds list for the
   owner to check by hand.
4. **Write to the evidence and state the scope.** Say who it applies to, where and when:
   "in the US, for digital mechanicals the MLC administers", "for 2026 usage". One trade
   report is not a settled fact.
5. **Never copy.** Do not copy or closely paraphrase the wording, tables, numbering or named
   frameworks of any society, CISAC, publisher, guide or article. US statutes, regulations and
   Copyright Office text are public domain and may be quoted briefly when the exact words
   matter (a rate, a defined term); otherwise paraphrase. No run of 8 words in common with any
   source or private corpus document; runs of 6 are reviewed.
6. **Nothing from the owner's day job.** Use public sources only. Nothing from the owner's
   employer's internal systems, data, clients, contracts or practices, and never name the
   employer.
7. **Be fair to people and companies.** A lawsuit is an allegation until decided: name the
   court, the docket and the date. Claims about living people are sourced.
8. **Date anything that moves.** Rates, unclaimed totals, pending cases, bills, deals and
   policies carry `as_of`. Prefer the newest primary source. Where sources disagree, or a
   correction exists, the entry says so.
9. **Standing corrections** (from the master plan; never reintroduce):
   - The MLC has no single April 2027 claim deadline. Market-share distribution of unclaimed
     accrued royalties starts in April 2027 with January 2021 usage, one month at a time.
   - No "producers leave ~50% on the table" claim. BMI pays the publisher share to a writer
     with no publisher; the ASCAP rule is unverified (hold).
   - The ISWC standard is ISO 15707:2022, not 2001.
   - The "$419.2M adjusted 2018-2022" figure is a separate DSP-audit number; do not use it
     without its own primary source.

## Voice

Plain, direct, second person or neutral. Short sentences. Define a term the first time it
appears and link it to the glossary. Money as "$" for US dollars; name the currency for any
other ("GBP 500", "CAD 120"). No hype, no slogans, no em dashes, no rhetorical questions, no
"it's not X, it's Y". A first-time songwriter and a publishing administrator should both
follow it.

## The files

One file per area, fifteen in all, plus `claims.json`:

| Group | File | Id prefix |
| --- | --- | --- |
| A. The money | `royalty-basics.json`, `pros-performance.json`, `mechanicals-mlc.json`, `recorded-neighboring.json` | `roy-`, `pro-`, `mech-`, `nbr-` |
| B. Infrastructure | `deal-structures.json`, `metadata-registration.json`, `international-societies.json`, `sync-licensing.json` | `deal-`, `meta-`, `intl-`, `sync-` |
| C. Recovery and guardrails | `unclaimed-recovery.json`, `audits.json`, `copyright-fundamentals.json` | `unc-`, `aud-`, `copy-` |
| D. AI | `ai-rights.json` | `ai-` |
| E. Also new | `producer-royalties.json`, `distribution-dsps.json`, `catalog-finance.json` | `prod-`, `dist-`, `cat-` |
| Claims | `claims.json` | `claim-` |

`/music/claimable` (the claimable-royalties table) and `/music/ai-tools` (the AI tools
directory) are data pages with their own files, specified separately before their batch.

```json
{
  "domain": "mechanicals-mlc",
  "topics": [ {"id": "rates", "label": "Rates"}, {"id": "unclaimed", "label": "Unclaimed money"} ],
  "entries": [ ... ],
  "sources": { "fr-2025-21695": { ... } }
}
```

`topics`: 5 to 10 per area, each a filter chip. Not used in the claims file.

### Fields on every entry

- `id`: lowercase-hyphenated, starting with the area prefix.
- `type`: `note`, `mistake`, `number`, `term`, `table`, `checklist`, `step`, or `claim`.
- `title`: 6-90 chars, sentence case, says the point, not just the subject.
- `topic`: one of the area's topic ids.
- `level`: `beginner` (new to the topic) | `intermediate` | `advanced`.
- `readers`: 1-5 of `writer`, `artist`, `producer`, `publisher-label`, `admin`. These build
  the five reader paths on the hub.
- `territory`: 1 or more of `US`, `UK`, `CA`, `AU`, `DE`, `FR`, `INTL` (CISAC, DDEX, IFPI,
  ISO, or true everywhere). Smaller territories are not covered: point the reader to
  consulting instead.
- `confidence`: see grading below.
- `sources`: list of source keys.
- `as_of`: `YYYY-MM-DD`. Required for every `number`, and for any entry with a rate, total,
  status, deadline, pending case, bill, deal or platform policy.

### Entry types (same shapes as /fitness)

- `note`: guidance. `take` (30-190 chars, the one sentence to remember), `body` (120-620
  chars: why, when, and who it applies to), `do` (0-3 actions, 8-140 chars each).
- `mistake`: a common error. Same fields as note. The title names the mistake.
- `step`: something that happens in an order (registering a song, claiming at the MLC). Same
  fields as note plus `when`: `before-release` | `at-release` | `after-release` | `yearly` |
  `on-dispute`.
- `number`: one key figure. `value` (as displayed, e.g. "13.1"), `unit` (e.g. "cents per
  track, physical and downloads"), `sort` (plain number), `take` (20-170 chars: what it means
  and for whom), plus `as_of`.
- `term`: glossary. `title` is the term, `take` (25-240 chars) defines it. Use `practice`
  for plain definitions; `sources` may be empty.
- `table`: `take`, `columns` (2-6), `rows` (2-16, each cell under 110 chars). Never copy a
  society's or CISAC's table; build your own from cited facts.
- `checklist`: `take`, `groups`: [{ "name": "...", "items": ["..."] }].
- `claim` (claims file only): `title` (the question as people ask it, ending "?"), `domain`
  (which area it belongs to), `tags` (1-3 of: royalties, mechanicals, performance,
  neighboring, publishing, metadata, unclaimed, ai, contracts, international, myths),
  `verdict` (true | mostly | depends | overstated | false), `take`, `body`, `do` (0-3),
  `basis` (15-220 chars: what the answer rests on, e.g. "17 USC 115 and 37 CFR 385.11, as of
  2026"), `level`, `confidence`, `sources`, `as_of` where it moves.

## Grading

Each entry records one of four grades. Pages show two: **Sourced** (`law`, `official`) and
**Directional** (`reported`, `practice`). Be honest; readers filter on it.

| `confidence` | Meaning | Shown as |
| --- | --- | --- |
| `law` | A statute, regulation, court decision or Copyright Royalty Board determination states it | Sourced |
| `official` | The responsible body's own published document states it: the MLC, a PRO or society, SoundExchange, the Copyright Office, CISAC, DDEX, IFPI, ISO | Sourced |
| `reported` | Trade press or a credible secondary source only, or a figure the source itself labels an estimate | Directional |
| `practice` | Common industry convention with no direct source. Sources optional. Never dress practice up as evidence | Directional |

An entry takes the grade of its weakest load-bearing source. Market figures (Goldman Sachs,
MIDiA, IFPI, Luminate, BPI) are always `reported`.

## Sources

```json
"fr-2025-21695": {
  "type": "regulation",
  "publisher": "Copyright Royalty Board",
  "title": "Determination of Royalty Rates and Terms for Making and Distributing Phonorecords (Phonorecords IV): cost of living adjustment for 2026",
  "url": "https://www.govinfo.gov/content/pkg/FR-2025-12-01/html/2025-21695.htm",
  "date": "2025-12-01",
  "edition": "90 FR, Docket 25-CRB-0012-PR COLA (2026)",
  "jurisdiction": "US",
  "retrieved": "2026-11-19",
  "support": "a short pointer to the passage that backs the entry"
}
```

- `type`: `statute` | `regulation` | `ruling` | `government` (agency guidance, reports,
  forms) | `collective` (MLC, PRO, society, SoundExchange, HFA own documents) | `standard`
  (CISAC, DDEX, IFPI, ISO) | `article` (trade press, guides, blogs) | `dataset` | `other`.
- `publisher` is the body; an `article` also gives `authors` (as published) and `site`.
- A `ruling` gives `court`, `docket` and `date`.
- `url` must open the exact item; `retrieved` is the date you opened it.
- `support` is for the reviewer and is not published. For US government text it may quote
  the passage; for anything else it is a pointer in your own words, 240 characters at most.
- Prefer the primary text (the statute, the CFR section, the MLC's own page) over an article
  about it. Reuse a source across entries rather than citing a weaker second one.

## Validate before you report

Still to be built in setup (see the pull request): `python3 scripts/validate_music.py
content/music/<file>.json` (schema, lengths, enums, `as_of` where required, every URL
opens or is flagged), `python3 scripts/check_overlap.py <file> <private-corpus-dir>` (8-word
runs are errors, 6-word runs are reviewed; the corpus stays outside the repository), then
`python3 scripts/build_music.py`. Fix every ERROR. Read the warnings.

Anything that only the owner can decide goes in `HOLDS.md`. Any change to an entry from an
earlier batch goes in `PROPOSED-REVISIONS.md`, never into the entry itself.
