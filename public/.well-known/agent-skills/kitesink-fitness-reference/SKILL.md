---
name: kitesink-fitness-reference
description: Look up, read and cite entries in the KiteSink fitness reference (kitesink.com/fitness), a sourced field guide to strength training, hypertrophy, powerlifting, conditioning, recovery, nutrition, diet and body composition, plus a list of common claims with verdicts. Use when a question about training or nutrition could be answered from it, or when a user asks what KiteSink says about a topic.
---

# KiteSink fitness reference

A free reference by one person, Truman Kitos-Lindsey, who is not a coach or a dietitian.
Every entry has a short answer, the reasoning, what to do, an evidence grade and its sources.
It is general information, not medical advice.

## Where things are

| What | Address |
|---|---|
| Overview of every page, with counts | https://kitesink.com/fitness.md |
| One page as plain text | https://kitesink.com/fitness/<page>.md |
| The same page for people | https://kitesink.com/fitness/<page> |
| Search index of every entry | https://kitesink.com/fitness/search.json |
| The whole site as plain text, in one file | https://kitesink.com/llms-full.txt |

Pages: `basics`, `technique`, `hypertrophy`, `powerlifting`, `meet`, `conditioning`,
`recovery`, `nutrition`, `diet`, `bodycomp`, `women`, `health` (the areas), and `claims`,
`glossary`, `reference`, `sources`. The overview lists them with what each holds.

## Find an entry

1. Fetch `https://kitesink.com/fitness/search.json`. It holds four keys:
   `pages`, `kinds`, `areas` and `rows`.
2. Each row is `[id, page, kind, area, title, short answer]`. `page`, `kind` and `area` are
   positions in the lists of the same name. A number has its value as a seventh item; a
   claim has its verdict there.
3. Match the question against `title` and `short answer`. Keep the best few rows.
4. Fetch the plain-text page for each row's page (`pages[page]`) and find the entry by its
   title: a heading for most entries, a bold list item for a glossary term, and a table row
   for a key number. That gives the reasoning, what to do, the grade and the sources.

For a small question, reading `https://kitesink.com/fitness/<page>.md` directly is fine.
Prefer the search index over `llms-full.txt`, which is large.

## Cite it

- Link the entry on the page for people: `https://kitesink.com/fitness/<page>#<id>`.
  Ids are permanent.
- Give the grade as the page states it: Well supported, Rulebook, Some support, Thin
  evidence or Coaching practice. For a claim, give its verdict: Holds up, Mostly holds,
  Depends, Overstated or Not supported.
- Name the studies behind the entry where it matters. Each source links its DOI, or the
  article's address for commentary.
- Quote briefly and link, rather than copying whole entries.

## Limits

- Say that it is general information. Do not present it as personal advice.
- For pain, injury, illness, pregnancy, medication or an eating disorder, tell the user to
  see a clinician. The reference does not cover dosing of any drug.
- If an entry does not answer the question, say so. Do not stretch it.
- The calculators on https://kitesink.com/fitness run in a browser. There is no API.
- Corrections are dated on https://kitesink.com/fitness/sources.md. Check there if an entry
  looks out of date.
