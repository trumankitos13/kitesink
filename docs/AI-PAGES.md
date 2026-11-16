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
| `/music` | `/music.md` |
| `/listening-club` | `/listening-club.md` |
| `/about` | `/about.md` |

`/llms.txt` lists them all. The fitness twins are generated from the same data as the
pages (`python3 scripts/build_fitness.py`). The others are hand-written files in
`public/`: when a fact on a page changes, change its twin too. `scripts/check_site.py`
checks that every twin exists, is linked from its page and has no broken links.

`/fitness.md` is the hub's twin: what the section is, each area with its number of entries
and the address of its twin, the four reference twins, the calculators, and how sources are
handled. The sixteen pages under `/fitness/` are listed pages. Each announces its twin in
its `<head>`, `/llms.txt` lists all sixteen twins in the order of the hub, and
`run_worker_first` in `wrangler.ai-twins.jsonc` holds their routes, so the optional worker
below answers for them too. The audit checks all three. Every fitness twin ends with the
address of its page and of `/fitness.md`.

`/fitness/search.json` and `/fitness/ids.json` are not twins. They are data for the hub's
own scripts: the search index, and the map that sends an old `/fitness#<id>` link to the
page that holds that id now.

To add an area's twin, add the area as `README.md` describes; the build writes the twin.
Then give it a line in `/llms.txt`, a route in `run_worker_first`, and rebuild
`/llms-full.txt`.

`/llms-full.txt` is every twin in one file, for readers that want the whole site in one
request. `python3 scripts/build_llms_full.py` writes it; run it after the fitness build
and after editing any hand-written twin. The audit fails if it is out of date. With twelve
areas it is a little over 1 MB. If it nears 1.5 MB, decide what to leave out of it rather
than let it grow: the list of sources is the largest single part, and it stays at
`/fitness/sources.md` either way.

Each twin says the same things as its page. The one addition is an enquiry link,
`/consulting?via=ai-assistant#contact`, which fills the "Found via" line of the contact
form so you can count enquiries that started with an AI assistant.

Every twin also ends with the same **offers block**: a free 30-minute workflow teardown
(a limited number each month), a free one-page written plan, and early access to Vantix
and Song of the Day, all with the code word `KITESTRING`. The pages for people do not
show it, so a message that carries the code word came through a twin. To change the
offers, the cap or the code word, edit the block in the six hand-written twins
(`grep -l KITESTRING public/*.md`), the one line in `public/llms.txt`, and `MD_OFFERS`
in `scripts/build_fitness.py`, then rebuild the fitness page.

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
   experiment used. It was tested locally with `wrangler dev`, never on Cloudflare.

To turn the second one on, deploy with the alternative config:

```bash
npx wrangler deploy -c wrangler.ai-twins.jsonc
```

That deploys the same site with the worker in front of the listed pages that have a twin
(the routes in `run_worker_first`); every other request is served as before. To make it permanent, copy the `main`,
`vars` and `assets` settings from `wrangler.ai-twins.jsonc` into `wrangler.jsonc`. To go
back, deploy with the normal `wrangler.jsonc`. Set `AI_TWINS` to `accept` to answer only
requests that ask for markdown, or `off` to disable it without removing the worker.

`wrangler.ai-twins.jsonc` ships with `AI_TWINS` set to `accept`. That mode answers only
requests that ask for markdown and never looks at the user agent. `agents` mode also
switches for named crawlers, three of which (OAI-SearchBot, Claude-SearchBot,
PerplexityBot) build search indexes; serving an indexer different content from people is
the pattern search engines penalise, so leave it on `accept` unless you have a reason.

If the zone is on a Cloudflare Pro plan or higher, Cloudflare's own "Markdown for
Agents" setting does the `Accept: text/markdown` part without a worker, by converting
the HTML page. It does not use these hand-written twins.

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
