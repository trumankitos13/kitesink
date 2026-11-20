---
name: kitesink-music-reference
description: Look up, read and cite entries in the KiteSink music field guide (kitesink.com/music), a sourced guide to music rights and royalties (the two copyrights in a song, mechanical royalties and the MLC, unclaimed royalties), plus common claims with verdicts and a dated table of where unclaimed royalties are held and how to claim them. Use when a question about music royalties or rights could be answered from it, or when a user asks what KiteSink says about a topic.
---

# KiteSink music field guide

A free reference by one person, Truman Kitos-Lindsey. Every entry gives the point, the
reasoning, what to do, who it is for, where it applies, how well sourced it is, and its sources.
Its scope line, on every page: "General information on how music rights and royalties work, not legal advice. For a contract, a termination notice or a dispute, talk to a music lawyer."

## Where things are

| What | Address |
|---|---|
| Overview of every page, with counts | https://kitesink.com/music.md |
| One page as plain text | https://kitesink.com/music/<page>.md |
| The same page for people | https://kitesink.com/music/<page> |
| Search index of the entries, claims and terms | https://kitesink.com/music/search.json |
| The claimable royalties table as data | https://kitesink.com/music/claimable.json |
| The whole site as plain text, in one file | https://kitesink.com/llms-full.txt |

Pages: `royalty-basics`, `pros-performance`, `mechanicals-mlc`, `recorded-neighboring`,
`unclaimed-recovery`, `ai-rights` (the areas written so far), and
`claims`, `glossary`, `reference`, `sources`, `claimable`, `tools`, `ai-tools`.

- An area page holds guidance, steps in order, common mistakes, key numbers, reference tables,
  a checklist and the terms it uses. The overview lists every planned area; one not written
  yet says "In preparation".
- `claims`: common claims, each with a verdict, what the answer rests on, and its sources.
- `glossary`: every term the areas use, with its area and where it applies.
- `reference`: an index of the dated key numbers and the reference tables, each linked to the
  area that holds it.
- `sources`: how entries are graded, and every source, A to Z.
- `claimable`: places where royalties can sit unclaimed, one per holder and pot of money.
- `tools`: a mechanical rate calculator with the US rates by year, an unclaimed-money
  checklist, an identifier checker, a split-sheet generator, and a checked directory of other
  tools.
- `ai-tools`: AI tools that touch music rights work, grouped by job, each with what you give
  it, what its terms say about outputs and your data (with a short quote and the terms' address),
  and the date it was checked; accuracy and licensed-data claims are the vendor's own.

The overview, https://kitesink.com/music.md, also describes the music projects (Song of the
Day, Stage First, the Album Listening Club).

## Find an entry

1. Fetch `https://kitesink.com/music/search.json`. It holds four keys:
   `pages`, `kinds`, `areas` and `rows`.
2. Each row is `[id, page, kind, area, title, short answer]`. `page`, `kind` and `area` are
   positions in the lists of the same name. A number has its value as a seventh item; a
   claim has its verdict there.
3. Match the question against `title` and `short answer`. Keep the best few rows.
4. Fetch the plain-text page for each row's page (`pages[page]`) and find the entry by its
   title: a heading for most entries, a bold list item for a glossary term, and a table row
   for a key number. That gives the reasoning, what to do, who it is for, where it applies,
   the grade, the date and the sources.

For a small question, reading `https://kitesink.com/music/<page>.md` directly is fine.
Prefer the search index over `llms-full.txt`, which is large.

The search index does not hold the claimable rows or the tools. For money someone may be owed,
fetch `https://kitesink.com/music/claimable.json`. It holds `name`, `url`, `publisher`, `note`,
`dateModified`, `rows` and `sources`. Each row has:

- `holder` and `pot`: who holds the money, and which money it is
- `who_can_claim`, `how_to_claim`, and `rule`: what happens to the money if nobody claims it
- `cost`, and `link` with `link_label`: the holder's own lookup or claiming page
- `money_type`, `territory` and `readers`, as in the filters below
- `confidence`: the grade, always `law` or `official`
- `sources`: keys into the top-level `sources`, each with its publisher, title, address and
  the date it was retrieved
- `as_of`: the date the row was checked, and `id`

The same rows, as text, are on `https://kitesink.com/music/claimable.md`. The tools and the
directory of other tools are on `https://kitesink.com/music/tools.md`; each outside tool there
says its access, who it is for, where it applies and the date it was checked.

Entries say who they are for and where they apply, and the pages for people filter on
both. Readers: `writer` (songwriters), `artist`, `producer`, `publisher-label` (publishers and labels)
and `admin` (administrators). Territory: `US`, `UK`, `CA` (Canada) and `INTL` (international);
an entry marked International shows under every territory. A link can start a page with a
filter set, where that page offers it: `https://kitesink.com/music/<page>?reader=writer&territory=UK`.
In the plain-text pages they are the "For:" and "Where:" parts of an entry's last line.

## Cite it

- Link the entry on the page for people: `https://kitesink.com/music/<page>#<id>`, with the
  page and id from the search index. A claimable row's id works the same way on
  `https://kitesink.com/music/claimable`.
- Give the grade as the page states it. Each entry records one of four grades: law, official,
  reported or practice. The pages show two labels: Sourced (law or official) and Directional
  (reported or industry practice), written as, for example, "Sourced (official)". An entry
  takes the grade of its weakest load-bearing source. For a claim, give its verdict: Holds
  up, Mostly holds, Depends, Overstated or Not supported.
- Rates, totals, deadlines and rules change. An entry that holds one says "As of" a date in its
  last line, a key number has an "As of" column, and every claimable row has `as_of`. Quote
  the date with the fact, every time.
- Name the source behind the entry where it matters. Each source links its address.
- Quote briefly and link, rather than copying whole entries.

## Limits

- Repeat the scope line, or its sense: general information, not legal advice. For a contract,
  a termination notice or a dispute, tell the user to talk to a music lawyer.
- The guide covers the territories in its filters. A holder missing from the claimable table
  may still hold money for someone. Tell the user to check the holder's own page before acting.
- If an entry does not answer the question, say so. Do not stretch it.
- The tools on https://kitesink.com/music/tools run in a browser. There is no API;
  `search.json` and `claimable.json` are static files.
- Each plain-text page ends with the date it was last updated. Check the entry's own date
  before quoting a figure.
