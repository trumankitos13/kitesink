# Fitness field guide: how to write an entry

The data behind kitesink.com/fitness lives in this folder: one JSON file per area and
`claims.json`. `scripts/build_fitness.py` turns them into the page. This file is the
format and the rules for anyone, person or agent, who adds or changes an entry.

The page should be a large set of information that is easy to digest, filter and sort.
Every word is written for this site: never copy or closely paraphrase another site's
sentences, numbering or named frameworks.

## Absolute rules
1. NO SOURCE MAY HAVE SCHOENFELD AS AN AUTHOR, in any author position, and the
   name must not appear anywhere in your file. Many well-known hypertrophy and
   protein papers include him as a co-author (for example Morton 2018 in BJSM,
   Coleman 2024 on deloads, several ISSN papers). Check the FULL author list of
   every paper on Crossref before using it. Find another source or drop the
   point.
2. Never invent a study, a DOI, an author list, a sample size, an effect size or
   a quote. Look every paper up:
   `curl -s "https://api.crossref.org/works/<DOI>" -H "User-Agent: site-source-checker/1.0"`
   and read its abstract on PubMed
   (`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=...&retmode=json`
   then `efetch.fcgi?db=pubmed&id=<PMID>&rettype=abstract&retmode=text`) before
   you state what it found. A number in your text (participants, studies,
   percentages, grams) must be one you read in the abstract or the paper.
3. If you cannot verify something, leave it out. Fewer, true entries beat more
   entries.
4. Write the statement to fit the evidence. Say "in trained men over eight
   weeks" when that is who was studied. Do not turn one small trial into a law.
5. Not medical advice. Do not tell anyone to start, stop or change medication,
   diagnose anything, or attempt dangerous practices (severe dehydration, extreme
   weight cuts). Where a topic is risky, say what the risk is and that a
   clinician or an experienced coach should be involved.
6. Federation rules (weight classes, equipment, commands, weigh-in times) come
   from the federation's current rulebook. Fetch it, cite it with its URL and
   edition/date, and write only what it says.

## Voice
Plain, direct, second person or neutral. Short sentences. Define a term the
first time it appears. Give both kg and lb, cm and in, where a number is a body
weight, load or height. No hype, no slogans, no em dashes, no rhetorical
questions, no "it's not X, it's Y". A sixteen-year-old lifter and a
fifty-year-old beginner should both follow it.

## The file
One file per area in this folder: `hypertrophy.json`, `powerlifting.json`, `meet.json`,
`nutrition.json`, `diet.json`, `health.json`, plus `claims.json`.

```json
{
  "domain": "hypertrophy",
  "topics": [ {"id": "volume", "label": "Volume"}, {"id": "effort", "label": "Effort"} ],
  "entries": [ ... ],
  "sources": { "pelland-2026": { ... } }
}
```
`topics`: 5 to 10 per domain, each a filter chip. Not used in the claims file.

### Entry types
Every entry has: `id` (lowercase-hyphenated, starting with your domain prefix:
`hyp-`, `pl-`, `meet-`, `nut-`, `diet-`, `hlth-`, `claim-`), `type`, `title`
(6-90 chars, sentence case, says the point, not just the subject), `topic`
(one of your topic ids), `level`, `confidence`, `sources` (list of source keys).

- `note`: guidance. `take` (30-190 chars, the one sentence to remember),
  `body` (120-620 chars, why and when it applies, who was studied),
  `do` (0-3 actions, 8-140 chars each).
- `mistake`: a common error. Same fields as note. Title names the mistake.
- `step`: (meet domain) something that happens at a point in time. Same fields
  as note plus `when`: months-out | weeks-out | week-before | day-before |
  weigh-in | warm-up | platform | between-lifts | after.
- `number`: one key figure. `value` (as displayed, e.g. "1.6-2.2"), `unit`
  (e.g. "g per kg per day"), `sort` (a plain number for sorting, e.g. 1.6),
  `take` (20-170 chars: what the number means and for whom).
- `term`: glossary. `title` is the term, `take` (25-240 chars) defines it.
  `sources` may be empty. Use confidence "practice" for plain definitions.
- `table`: a reference table. `take` (what it shows), `columns` (2-6),
  `rows` (2-16 rows, each cell under 110 chars).
- `checklist`: `take`, `groups`: [{ "name": "...", "items": ["..."] }].
- `claim`: (claims file only) see below.

`level`: beginner (first year, or new to the topic) | intermediate | advanced.

`confidence`, be honest, this is a filter people will rely on:
- `strong`: meta-analysis, systematic review, position stand or guideline, or
  several consistent trials.
- `moderate`: a few trials or consistent observational data.
- `limited`: one or two small studies, mixed findings, or mechanism only.
- `rule`: a federation rule or official guideline value. Must cite it.
- `practice`: widely used coaching convention with no direct study. Sources
  optional. Do not dress practice up as evidence.

### Claims file (`"domain": "claims"`)
Each entry: `id` (claim-...), `type` "claim", `title` (the question as people
ask it, ending with "?"), `domain` (which of the six it belongs to), `tags`
(1-3 of: protein, calories, timing, training, cardio, supplements, weight-loss,
muscle-gain, recovery, health, myths, strength, competition, tracking),
`verdict` (true | mostly | depends | overstated | false), `take` (the short
answer), `body` (what the research shows), `do` (0-3), `studied` (15-220 chars:
who was studied, how many, how long, as read in the source), `evidence`
(meta-analysis | rct | review | cohort | position | guideline | rulebook |
mixed), `level`, `confidence`, `sources`.

### Sources
```json
"pelland-2026": {
  "type": "meta-analysis",
  "authors": ["Pelland JC", "Remmert JF", "Robinson ZP", "Hinson SR", "Zourdos MC"],
  "year": 2026,
  "title": "The Resistance Training Dose Response: ...",
  "journal": "Sports Medicine", "volume": "56", "issue": "2", "pages": "481-505",
  "doi": "10.1007/s40279-025-02344-w",
  "pmid": "…",
  "n_studies": 67, "n_participants": 2058,
  "support": "one or two sentences copied from the abstract that back what you cite it for"
}
```
`authors` is the FULL list exactly as Crossref has it (family name + initials),
or the organisation for a rulebook/guideline. `type`: meta-analysis |
systematic-review | rct | review | cohort | position | guideline | rulebook |
book | trial | other. A rulebook or guideline uses `url` (and `edition` or
`retrieved`: "2026-11-13") instead of `doi`. `n_studies` / `n_participants` only
if stated in the abstract. `support` is for the reviewer and is not published.
Prefer recent meta-analyses, systematic reviews, position stands and official
guidelines; then well-run trials. Reuse a source across entries rather than
citing a weaker second one.

## Validate before you report
`python3 scripts/validate_fitness.py content/fitness/<file>.json`, then `python3 scripts/build_fitness.py`
It checks the schema, text lengths, that every DOI exists on Crossref with a
matching title, year, first author and author count, and that Schoenfeld is not
among any paper's authors. Fix everything it reports as ERROR. Read the warnings.
Work in passes: write a batch of entries, validate, fix, continue.
