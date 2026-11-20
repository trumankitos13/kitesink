# Music data pages: claimable royalties, tools directory, rates, AI tools directory

Spec for the data files behind `/music/claimable`, `/music/tools`, the mechanical rate
calculator and `/music/ai-tools`. Same rules as `WRITING-BRIEF.md` (never invent, open every source, own words,
not legal advice, nothing from the owner's day job, `as_of` on anything that moves). Sources use
the same source schema as the area files.

## 1. `claimable.json`: the claimable-royalties table

One row per pot of money that someone may be owed and can claim or check for. Written so an AI
assistant can quote a row accurately. The build publishes it three ways from this one file:
the page `/music/claimable`, its `.md` twin, and `/music/claimable.json` (public, without
`support`), with schema.org `Dataset` markup. The unclaimed-money checklist tool reads the same
rows.

```json
{
  "kind": "claimable",
  "rows": [
    {
      "id": "clm-mlc-unclaimed-accrued",
      "holder": "The MLC",
      "pot": "Unclaimed accrued US digital mechanicals under the blanket licence (2021 onward)",
      "money_type": "mechanical",
      "territory": ["US"],
      "readers": ["writer", "publisher-label", "admin"],
      "who_can_claim": "20-200 chars: who is owed this money",
      "how_to_claim": "20-240 chars: the steps, in plain words",
      "rule": "20-200 chars: what happens if nobody claims, with dates",
      "cost": "up to 60 chars, e.g. Free to join and claim",
      "link": "https://... the lookup or claiming page",
      "link_label": "up to 40 chars, e.g. Missing Member Lookup",
      "confidence": "official",
      "sources": ["mlc-unclaimed"],
      "as_of": "2026-11-19"
    }
  ],
  "sources": { }
}
```

- `id` starts `clm-`. `money_type`: `mechanical` | `performance` | `neighboring` | `other`.
- `confidence` must be `law` or `official`: a row rests on the holder's own published page or
  the law. A row whose holder's page could not be opened is not added; it goes to `HOLDS.md`.
- Every row has `as_of`.

## 2. `tools.json`: the external tools directory

Tools and portals worth linking, grouped. The build publishes only rows with
`"status": "verified"`; rows marked `check` stay in the file for the owner to test by hand.

```json
{
  "kind": "tools",
  "groups": [ {"id": "works-search", "label": "Works and repertoire searches"} ],
  "tools": [
    {
      "id": "tool-mlc-public-search",
      "name": "MLC Public Work Search",
      "url": "https://...",
      "owner": "The MLC",
      "group": "works-search",
      "what": "30-160 chars, own words: what it does and what it does not show",
      "readers": ["writer", "publisher-label", "admin"],
      "territory": ["US"],
      "access": "free-no-login",
      "status": "verified",
      "checked": "2026-11-20",
      "note": "optional, up to 140 chars"
    }
  ]
}
```

- `id` starts `tool-`. `access`: `free-no-login` | `free-login` | `members` | `licensees` |
  `paid` | `unknown`. `status`: `verified` (page opened by the writer and the reviewer, and
  `what` and `access` confirmed on it) | `check` (blocked or unconfirmed).
- Groups (fixed): `works-search` (works and repertoire searches), `recordings` (recordings and
  identifiers), `unclaimed` (unclaimed money), `metadata` (metadata and file formats),
  `splits-contracts` (splits and agreements), `sync-cue` (sync and cue sheets),
  `valuation` (catalogue valuation).
- Never copy a tool's own description. No ranking, no affiliate links.

## 3. `rates.json`: data for the mechanical rate calculator

```json
{
  "kind": "rates",
  "physical": [
    {"year": 2026, "per_work_cents": 13.1, "per_minute_cents": 2.52, "sources": ["fr-2025-21695"]}
  ],
  "streaming_revenue_percent": [
    {"year": 2026, "percent": 15.3, "sources": ["cfr-385-21"]}
  ],
  "ringtone_cents": {"value": 24, "sources": ["cfr-385-11"]},
  "as_of": "2026-11-20",
  "sources": { }
}
```

- `physical`: one row per year of Phonorecords IV that a primary source states (the CFR text
  or the Federal Register notice for that year). Leave a year out rather than guess it.
- The calculator computes, for physical copies and permanent downloads: per copy =
  the larger of `per_work_cents` and `per_minute_cents` x minutes of playing time rounded up
  to the next whole minute; total = per copy x copies. The streaming figure is shown only as a
  labelled illustration of the first prong of 37 CFR 385.21, never as a per-stream rate.

## 4. `ai-tools.json`: the AI tools directory

AI tools that touch music rights work, grouped by the job they do, published as
`/music/ai-tools` and its `.md` twin. The same schema as `tools.json` (section 2), with
`kind: "ai-tools"`, `ait-` ids, two more access values and two more fields per row: what the
user hands the tool (`uploads`) and what the tool's own terms say about outputs and the user's
data (`output_terms`). The build publishes only rows with `"status": "verified"`, and writes
the page only when the file has at least one; with no file (or no verified row) nothing is
built for it and the hub shows the AI tools directory as in preparation.

```json
{
  "kind": "ai-tools",
  "groups": [ {"id": "detection-attribution", "label": "AI-content detection and attribution"} ],
  "tools": [
    {
      "id": "ait-example-detector",
      "name": "Example Detector",
      "url": "https://... the tool's own page",
      "owner": "Example Ltd",
      "group": "detection-attribution",
      "what": "30-160 chars, own words: what it does and what it does not do",
      "readers": ["publisher-label", "admin"],
      "territory": ["INTL"],
      "access": "enterprise",
      "status": "verified",
      "checked": "2026-11-20",
      "note": "optional, up to 140 chars. The 99 percent accuracy figure is the vendor's own claim.",
      "uploads": "3-120 chars: what the user gives the tool, e.g. Audio files or links to tracks",
      "output_terms": {
        "summary": "20-240 chars, own words: who owns outputs, whether inputs or outputs train models, any licence back",
        "terms_url": "https://... the terms, privacy or data-use page the summary rests on",
        "quote": "a short quote from those terms, at most 200 chars, without quotation marks; or null"
      }
    }
  ]
}
```

- `id` starts `ait-`. `name`, `url`, `owner`, `group`, `what`, `readers`, `territory`,
  `status`, `checked` and `note` are as in `tools.json`.
- `access`: the `tools.json` values plus `waitlist` (open by waitlist or invitation only) and
  `enterprise` (sold through a sales contact, no self-serve plan): `free-no-login` |
  `free-login` | `members` | `licensees` | `paid` | `waitlist` | `enterprise` | `unknown`.
- Groups (fixed ids and labels, in this order): `metadata-matching` (Metadata and matching),
  `detection-attribution` (AI-content detection and attribution), `generators` (Licensed
  generators and output terms), `catalogue-analysis` (Catalogue and statement analysis),
  `voice-likeness` (Voice and likeness), `assistants` (AI assistants: data-use terms).
- `uploads` (3-120 chars): what the user gives the tool: audio, stems, lyrics, statements,
  a catalogue export, a voice sample, prompts.
- `output_terms` (required on every row): `summary` (20-240 chars, own words), `terms_url`
  (https, the page the summary and quote rest on, opened by the writer and the reviewer), and
  `quote` (a short quote from the tool's own terms, at most 200 chars, without the quotation
  marks, which the page adds; `null` when the terms give nothing short enough to quote). The
  quote is the one place a vendor's own words appear; everything else is own words.
- `terms_url` is the row's source: the file has no `sources` object. Where the terms page
  and another page of the same vendor disagree (a help page, a press report), say so in
  `note` or `summary`, and quote the terms.
- Vendor claims stay the vendor's: an accuracy figure, a detection rate, or a claim that a
  model was trained only on licensed or "ethically sourced" data is never stated as fact. If
  `what`, `uploads`, `note` or `output_terms.summary` mentions one, `note` says it is the
  vendor's own claim (for example "The accuracy figure is the vendor's own claim").
- `status`: `verified` only when the tool's own page and its `terms_url` were opened by the
  writer and the reviewer, and `what`, `access`, `uploads` and the summary were confirmed on
  them. A tool whose terms could not be read stays `check`, or is left out and goes to
  `HOLDS.md`. Never copy a tool's own description. No ranking, no affiliate links.
- Check it with `python3 scripts/validate_music.py content/music/ai-tools.json` and
  `python3 scripts/check_overlap.py content/music/ai-tools.json --corpus <dir>` (which reads
  `what`, `note`, `uploads` and `output_terms.summary`, not the quote). The launch steps for
  the page, once the file exists, are in `README.md` under "Music entries".
