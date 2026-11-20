# Pages for AI readers

Plain-text versions ("twins") of the main pages, written to be read and quoted by AI
assistants. They are not in the navigation, the Library or the sitemap, and search
engines are told not to index them. Anyone with the address can read them.

## What exists

| Page | Twin |
|---|---|
| `/` | `/index.md` |
| `/consulting` | `/consulting.md` |
| `/fitness` (the hub) | `/fitness.md` |
| `/fitness/basics`, `technique`, `hypertrophy`, `powerlifting`, `meet`, `conditioning`, `recovery`, `nutrition`, `diet`, `bodycomp`, `women`, `health` | `/fitness/<area>.md`, one file per area |
| `/fitness/claims`, `glossary`, `reference`, `sources` | `/fitness/claims.md`, `glossary.md`, `reference.md`, `sources.md` |
| `/vantix` | `/vantix.md` |
| `/music` (the hub) | `/music.md` |
| `/music/royalty-basics`, `pros-performance`, `mechanicals-mlc`, `recorded-neighboring`, `unclaimed-recovery`, `ai-rights` (the areas written so far) | `/music/<area>.md`, one file per area |
| `/music/claims`, `glossary`, `reference`, `sources`, `claimable`, `tools`, `ai-tools` | `/music/claims.md`, `glossary.md`, `reference.md`, `sources.md`, `claimable.md`, `tools.md`, `ai-tools.md` |
| `/listening-club` | `/listening-club.md` |
| `/about` | `/about.md` |

`/llms.txt` lists them all. The fitness twins are generated from the same data as the
pages (`python3 scripts/build_fitness.py`), and the music twins, `/music.md` included, likewise
(`python3 scripts/build_music.py`). The others are hand-written files in
`public/`: when a fact on a page changes, change its twin too. `scripts/check_site.py`
checks that every twin exists, is linked from its page and has no broken links.

`/fitness.md` is the hub's twin: what the section is, each area with its number of entries
and the address of its twin, the four reference twins, the calculators, and how sources are
handled. The sixteen pages under `/fitness/` are listed pages. Each announces its twin in
its `<head>`, `/llms.txt` lists all sixteen twins in the order of the hub, and
`run_worker_first` in `wrangler.jsonc` holds their routes, so the worker below answers
for them too. The audit checks all three. Every fitness twin ends with the
address of its page and of `/fitness.md`.

`/music.md` is the music hub's twin, built the same way: what the guide is, each area with its
number of entries and the address of its twin (an area not written yet says "In preparation"),
the reference twins, how entries are graded, and then the music projects (from
`content/music/templates/hub.md`). The pages under `/music/` are listed pages with a twin each,
announced in their `<head>`, listed in `/llms.txt` in the order of the hub, and routed in
`run_worker_first`; the audit checks all three for every page the build has written. When the
build writes a new music page, add its line and route by hand, as for a fitness area, and its
slug to the `Pages:` paragraph of the music agent skill (see Agent discovery below).
`/music/search.json` (the hub's search index) and `/music/claimable.json` (the claimable table
as data, linked from its twin) are not twins.

`/music/ai-tools` (the AI tools directory, from `content/music/ai-tools.json`) is ready in the
build but not written yet: it appears when that file has a verified row. Its launch steps (the
route, the site index, the sitemap, `llms.txt`, the skill's `Pages:` paragraph and this table)
are in `README.md` under "Launching `/music/ai-tools`".

`/fitness/search.json` and `/fitness/ids.json` are not twins. They are data for the hub's
own scripts: the search index, and the map that sends an old `/fitness#<id>` link to the
page that holds that id now.

To add an area's twin, add the area as `README.md` describes; the build writes the twin.
Then give it a line in `/llms.txt`, a route in `run_worker_first`, and rebuild
`/llms-full.txt`.

`/llms-full.txt` is every twin in one file, for readers that want the whole site in one
request. `python3 scripts/build_llms_full.py` writes it; run it after the fitness or music
build and after editing any hand-written twin. The audit fails if it is out of date.

### What llms-full.txt leaves out

Every twin listed in `/llms.txt` has its own part in `/llms-full.txt`, headed by its address,
in the same order. Within those parts, text that would be repeated is given once, and nothing
goes without a pointer to where it is. Each twin at its own address stays complete. The rules,
all in `scripts/build_llms_full.py`:

1. **Offers.** The offers block that ends every twin appears once, at the end of the file.
2. **Repeated sections.** A `## ` section (200 characters or more) whose text is word for
   word a section already in the file becomes one line naming the part that holds it. Today
   that is the fitness and music reference twins' "The full entries, as plain text" (the same
   as each glossary's "Read the areas"), "How the entries are graded" on `/fitness/sources.md`
   (the same as on `/fitness.md`), and the unclaimed-money checklist on `/music/tools.md` (the
   same as on `/music/unclaimed-recovery.md`).
3. **Terms.** The `## Terms` section at the end of a fitness or music area (each term and its
   definition) becomes the list of its term names, when every definition is word for word in
   that guide's glossary, which has its own part. If any is not, the section stays whole.
4. **Lists of sources.** The A-to-Z list on `/fitness/sources.md` and `/music/sources.md`
   (`## All N sources, A to Z`) becomes a line giving the twin's address, followed only by the
   sources whose address appears nowhere else in the file. The entries link their own sources
   (author, year and address), so every source's address stays in the file; what moves out is
   each full reference (title, journal, kind, times cited), which stays at its twin. The
   grading notes, articles and corrections on those twins stay. To put the lists back, set
   `LEAVE_OUT_SOURCE_LISTS` to `False`.

On 20 November 2026 this took the file from 1,498,232 bytes to 1,200,659: the source lists
saved about 257 KB, the terms about 38 KB, the repeated sections about 5 KB (the offers rule
was already in place). Nothing else is left out. When it grows again, look first for text
that repeats; the next candidates are the fitness reference twin (an index of numbers and
tables that the areas hold in full) and the mechanical rate calculator section, which
`/music/tools.md` and `/music/mechanicals-mlc.md` repeat except for one line.

Each twin says the same things as its page. The one addition is an enquiry link,
`/consulting?via=ai-assistant#contact`, which fills the "Found via" line of the contact
form so you can count enquiries that started with an AI assistant.

Every twin also ends with the same **offers block**: a free 30-minute workflow teardown
(a limited number each month), a free one-page written plan, and early access to Vantix
and Song of the Day, all with the code word `KITESTRING`. The pages for people do not
show it, so a message that carries the code word came through a twin. To change the
offers, the cap or the code word, edit the block in the five hand-written twins
(`grep -l KITESTRING public/*.md`, leaving out `fitness.md` and `music.md`, which are generated),
the one line in `public/llms.txt`, and `MD_OFFERS` in `scripts/build_fitness.py` and
`scripts/build_music.py`, then rebuild the fitness and music pages.

## How an AI reader finds a twin

1. **By default (nothing to switch on).** Each page's `<head>` has
   `<link rel="alternate" type="text/markdown" href="…">`, and `/llms.txt` indexes the
   twins. This is cheap and harmless, but weak: studies of server logs find that AI
   crawlers rarely fetch `llms.txt` (see Sources).
2. **At the page's own address (off until you deploy it).** `worker/ai-twins.js` answers
   a request for `/consulting` with `/consulting.md` when the request asks for markdown
   (`Accept: text/markdown`) or, in `agents` mode, when it comes from a named AI crawler
   or assistant (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User,
   Claude-SearchBot, PerplexityBot, Perplexity-User). Browsers and search engines
   (Googlebot, Bingbot) always get the normal page. This is the mechanism the Ramp
   experiment used, and what isitagentready.com checks as "Markdown negotiation". It was
   tested locally with `wrangler dev` (16 November 2026), never on Cloudflare.

   How it decides, in `accept` mode: markdown only when the `Accept` header names
   `text/markdown` with a q-value at least as high as `text/html`'s. `text/markdown` alone,
   or `text/markdown, text/html;q=0.9`, gets the twin; a browser's header, `*/*`, `text/*`
   and `text/markdown;q=0` get the page. Both answers carry `Vary: Accept`, so no cache
   hands one to a reader who asked for the other. The markdown answer has
   `Content-Type: text/markdown; charset=utf-8`, a `Link` to the page as canonical, and no
   `noindex` (the twin file's own `noindex` stays on `/<page>.md`; the page's address must
   stay in search). It sends no `x-markdown-tokens` header; the scanner treats that as
   optional, and the worker has no tokenizer to count with.

   Cloudflare does not apply `public/_headers` to responses from a Worker
   ([docs](https://developers.cloudflare.com/workers/static-assets/headers/)). The worker
   therefore applies the same rules itself, from `worker/asset-headers.js`, which
   `scripts/build_agent_files.py` generates from `_headers`. Without it, every page the
   worker answers would lose its security headers. Locally, the HTML it serves is
   byte-identical to the static site, with the same headers plus `Vary: Accept`.

   Cost: on the Workers Free plan, each request to a route in `run_worker_first` counts
   against 100,000 Worker requests a day, and past that those routes answer 429 instead of
   falling back to the static page
   ([billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/),
   [limits](https://developers.cloudflare.com/workers/platform/limits/)). Every other file,
   including the twins at their `.md` addresses, stays free and unlimited. Check the
   account's plan and the site's daily page views before deploying.

The worker is set up in `wrangler.jsonc`, so every merge to `main` deploys it with the site.
`AI_TWINS` is `accept`: it answers only requests that ask for markdown and never looks at the
user agent. `agents` mode also switches for named crawlers, three of which (OAI-SearchBot,
Claude-SearchBot, PerplexityBot) build search indexes; serving an indexer different content
from people is the pattern search engines penalise, so leave it on `accept` unless you have a
reason.

To stop it: `off` in `AI_TWINS` stops the answers but the worker still runs (and counts) on
its routes. To remove it entirely, delete `main`, `vars` and the lines marked `// worker` in
`wrangler.jsonc`, and merge.

On a Cloudflare Pro zone plan or higher, Cloudflare's own "Markdown for Agents" setting
does the `Accept: text/markdown` part without a worker, by converting the HTML page
([availability](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/)).
It does not use these hand-written twins, and it is not available on the Free plan.

## Agent discovery

What isitagentready.com looks for, and what the site publishes for it. The scan of
16 November 2026 scored level 1 of 5. After PR 31 merged, the rescan the same day scored
**level 2 (Bot-Aware)**: Link headers, Content Signals and the skills index pass. The one
requirement left for level 3 was markdown negotiation. PR 33 moved the worker into
`wrangler.jsonc`, and the rescan after it merged scored **level 4 (Agent-Integrated)**. DNS-AID
and the checks below marked not applicable still fail, by design. Keep an eye on the zone's
daily requests: the Workers Free plan allows 100,000 a day on the worker's routes.

| Check | State | Where |
|---|---|---|
| `Link` headers (RFC 8288) | Done | Every page with a twin sends `Link: </<twin>.md>; rel="alternate"; type="text/markdown"`; the home page adds `</llms.txt>; rel="describedby"`. Generated into `public/_headers` |
| Content Signals | Done | `Content-Signal: search=yes, ai-input=yes, ai-train=yes` in `public/robots.txt`, the owner's choice. It matches the Cloudflare setting that lets AI crawlers in |
| Markdown negotiation | Done | `worker/ai-twins.js` through `wrangler.jsonc`, above |
| Agent skills index | Done | `/.well-known/agent-skills/index.json` lists two skills, `kitesink-fitness-reference` and `kitesink-music-reference`: how to find, read and cite an entry using each guide's `search.json` and twins (and, for music, `claimable.json`) |
| WebMCP, ARD manifest | Not done, by choice | WebMCP is an experimental browser API; ARD would only re-list the skills index. Neither changes the level |
| MCP Server Card, A2A Agent Card, API catalog, OAuth discovery and protected resource, auth.md, DNS-AID | Not applicable | The site has no MCP server, agent, API or sign-in. Publishing descriptors for them would be untrue |

`python3 scripts/build_agent_files.py` writes the skills index (with each skill's SHA-256),
the `Link` block at the end of `public/_headers` and `worker/asset-headers.js`. Run it after
editing a `SKILL.md`, `_headers` or the list of twins. The audit fails if any of the three is
stale, if a file under `/.well-known/` is not in the index, or if `robots.txt` loses its
Content Signals.

To add a skill: write `public/.well-known/agent-skills/<name>/SKILL.md` with `name` and
`description` in its frontmatter (`name` equal to the folder), then run the build. Keep a
skill to things an agent can really do here.

Levels (from the scanner's guide): 2 needs Content Signals; 3 adds markdown negotiation;
4 adds a skills index. Merging to `main` deploys `wrangler.jsonc` through Workers Builds
(docs/DEPLOY-CLOUDFLARE.md). With the worker in it, the scan should reach level 4, since the
skills index is already live. Rescan after each deploy to confirm.

The audit also holds each skill to the site: the page slugs it names (its `Pages:` paragraph)
must be the pages under `/fitness/` or `/music/`, `search.json` must have the keys and row
layout it describes, and every row must be findable in its page's twin the way it says. For
the music skill it also checks that `claimable.json` has exactly the keys the skill names, for
the file and for each row, and that the skill quotes `scope_line` from `content/music/meta.json`
word for word. A change to the fitness or music build that breaks any of that fails the audit
until the skill is updated. When the music build writes a new area, add its slug to the music
skill's `Pages:` paragraph (and its description, if the area changes what the guide covers),
then run `python3 scripts/build_agent_files.py`.

## Before expecting any traffic

- **Check that Cloudflare is not blocking AI crawlers.** In the dashboard, look at the
  zone's AI crawler controls (AI Crawl Control; older zones call it "Block AI bots").
  Search, Training and Agent crawlers can each be allowed or blocked. If they are
  blocked, none of this is seen.
- **`robots.txt` allows everything**, including AI crawlers. Keep it that way if you want
  them.

## How to measure

- Cloudflare's AI Crawl Control shows which AI crawlers request which paths.
- Enquiries whose "Found via" line reads `ai-assistant`.
- Ask ChatGPT, Claude and Perplexity the questions a buyer would ask, on a schedule, and
  note whether KiteSink and the enquiry link come up. This is what Ramp did.

## What to expect

The Ramp write-ups report that the offer surfaced mostly on pages AI already cited, that
Claude relayed it far more than the others, that ChatGPT read the pages and never
mentioned it, and that nobody had acted on the offer when the results were published. A
small personal site starts with few or no AI citations, so treat this as groundwork.

The twins do carry an offer now: the block described near the top of this file, added on
13 November 2026 with the code word `KITESTRING`. Judge it on what Cloudflare's AI Crawl
Control and Web Analytics show after a month.

## Sources

- Ramp's experiment, as reported: https://app.dealroom.co/news/note/ramp-hid-an-ai-only-offer-on-50-web-pages-claude-relayed-it-370-times-in-32-days-chatgpt-never-did
  and https://x.com/CrowdReply_io/status/2119809230861746556 (secondary accounts; Ramp's
  own write-up was not found)
- Cloudflare, Markdown for Agents: https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents
- Cloudflare's AI crawler defaults (2026): https://www.helpnetsecurity.com/2026/07/02/cloudflare-ai-crawler-controls/
- How often `llms.txt` is read: https://ahrefs.com/blog/llmstxt-study/
