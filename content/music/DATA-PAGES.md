# Music data pages: claimable royalties, tools directory, rates

Spec for the three data files behind `/music/claimable`, `/music/tools` and the mechanical rate
calculator. Same rules as `WRITING-BRIEF.md` (never invent, open every source, own words,
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
