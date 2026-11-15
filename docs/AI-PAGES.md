# Pages for AI readers

Plain-text versions ("twins") of the main pages, written to be read and quoted by AI
assistants. They are not in the navigation, the Library or the sitemap, and search
engines are told not to index them. Anyone with the address can read them.

## What exists

| Page | Twin |
|---|---|
| `/` | `/index.md` |
| `/consulting` | `/consulting.md` |
| `/fitness` | `/fitness.md` |
| `/fitness/hypertrophy`, `powerlifting`, `meet`, `nutrition`, `diet`, `health` | `/fitness/<area>.md`, one file per area |
| `/fitness/claims`, `glossary`, `reference`, `sources` | `/fitness/claims.md`, `glossary.md`, `reference.md`, `sources.md` |
| `/vantix` | `/vantix.md` |
| `/music` | `/music.md` |
| `/listening-club` | `/listening-club.md` |
| `/about` | `/about.md` |

`/llms.txt` lists them all. The fitness twins are generated from the same data as the
pages (`python3 scripts/build_fitness.py`). The others are hand-written files in
`public/`: when a fact on a page changes, change its twin too. `scripts/check_site.py`
checks that every twin exists, is linked from its page and has no broken links.

The ten pages under `/fitness/` are built but unlisted for now (`noindex`, out of the nav,
the Library and the sitemap). Each announces its twin in its `<head>`, and `/llms.txt`
lists all ten twins. The optional worker below does not answer for them until they are
listed: `run_worker_first` holds only the seven listed pages, and the audit checks that.

`/llms-full.txt` is every twin in one file, for readers that want the whole site in one
request. `python3 scripts/build_llms_full.py` writes it; run it after the fitness build
and after editing any hand-written twin. The audit fails if it is out of date.

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

That deploys the same site with the worker in front of the seven listed pages that have
a twin; every other request is served as before. To make it permanent, copy the `main`,
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
