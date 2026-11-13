# KiteSink

The personal site for **kitesink.com** — one person's workshop, organised into five sections:
**Consulting · Fitness · Music · Library · About**.

Plain static HTML/CSS/JS. No build step, no framework, no runtime dependency. Every page
runs in any browser by opening the file directly.

## How the site is organised (2027 refresh)

| Section | Hub page | What lives under it |
|---|---|---|
| Consulting | `/consulting` | Services for music teams, how a project runs, the AI concierge teaser, contact |
| Fitness | `/fitness` | Vantix (`/vantix` + roadmap, changelog, privacy), four free tools, training & nutrition notes with sources |
| Music | `/music` | Song of the Day, Backline, Album Listening Club |
| Library | `/library` | **Everything** — every project, tool, game, post and page, searchable. `/work`, `/games`, `/blog` and Campground Tycoon live here |
| About | `/about` | About, Now, Uses |

The home page (`/`) is the landing page: a five-row index of the sections, a card deck that
responds to it, then one band per section.

**Nothing was deleted in the refresh.** Every pre-existing page still exists at the same URL;
the product pages (Vantix, Backline, Song of the Day, Campground Tycoon, Listening Club) keep
their own art direction and only their KiteSink nav changed.

## Structure

```
public/                     ← deploy root for kitesink.com
  index.html                Landing page (index + deck + five section bands)
  consulting.html           Consulting hub — music-team services + AI concierge teaser
  fitness.html              Fitness hub — Vantix feature, four tools, notes, claims, sources
  fitness.js                The four calculators (pure maths in window.KSFit + page wiring)
  music.html                Music hub — Song of the Day, Backline, Listening Club
  library.html              The full index, rendered from site-index.js + blog/posts.js
  about.html                About
  site-index.js             ONE list of every page/tool/project (KS_INDEX + KS_SHELVES). The Find
                            palette, /library and the home search all read it. Add a page → add a line.
  ks.js, ks.css             Shared chrome + design system: header, slim bar, footer, mobile pill nav,
                            the Find palette (⌘K / Ctrl K / "/"), theme toggle, tokens (--k-*), the
                            .k-* component kit — plus the analytics token (CF_TOKEN) and forms key
  work.html, games.html     Older index pages, now shelved under Library (still linked, still work)
  projects.js               Data for work.html + games.html (KS_WORK / KS_GAMES)
  now.html, uses.html, colophon.html   Now / Uses / Colophon
  blog.html                 Writing index (live filter; your essays + external reposts)
  blog/
    posts.js                Blog entries (KS_POSTS) — the blog index, Library and Find read this
    campground-tycoon-the-story-so-far.html   First post
  repost.html               Phone composer for new posts/reposts (discreet ✎ link in the footer)
  listening-club.html       Album Listening Club — its own palette; Discord front door
  song-of-the-day.html      Landing for the Song of the Day iOS app (+ support/privacy/terms)
  campground-tycoon.html    Campground Tycoon landing + demo (+ features/regions/roadmap)
  backline.html             Backline prototype landing
  vantix.html               Vantix — the periodization OS (+ roadmap/changelog/privacy)
  feed.xml                  Atom feed (hand-maintained; see docs/ADDING-A-BLOG-POST.md)
  sitemap.xml, robots.txt, _headers, 404.html

vantix/                     ← deploy root for vantix.kitesink.com (separate Worker)
scripts/
  check_site.py             Site audit (metadata, a11y basics, links, site index, sitemap, asset versions)
  test_fitness.js           Checks the calculator maths against hand-worked values
source/                     ← archived ORIGINAL design-tool exports (.dc.html). Not deployed.
```

## Changing things

- **Add a page:** create the HTML, then add one entry to `public/site-index.js` and one line to
  `public/sitemap.xml`. `scripts/check_site.py` fails if you forget either, so a page can't
  become unreachable.
- **Change the nav / sections:** `SECTIONS` at the top of `public/ks.js`. Vantix, Backline,
  the Listening Club and the blog post template carry their own small KiteSink nav — search for
  `/consulting` in those files.
- **Change `ks.css`, `ks.js`, `site-index.js` or `fitness.js`:** bump the `?v=2027.3` on the
  `<link>`/`<script>` tags in every page (find-and-replace) and `ASSET_V` at the top of `ks.js`. Those files are cached for an hour or more, and a new page with an
  old cached stylesheet looks broken. The audit checks every page uses the same version.
- **Design tokens:** `--k-*` custom properties at the top of `ks.css` (light + dark). New pages
  opt into the component kit with `<body class="ks-paper k2">`.
- **Fitness notes:** every claim on `/fitness` links to an entry in its Sources list. Keep it
  that way — if you add a number, add its paper.

## Local preview

These are static files — just open `public/index.html` in a browser, or serve the folder:

```bash
cd public && python3 -m http.server 8000   # then visit http://localhost:8000
```

(Use a server rather than `file://` so root-relative links like `/about` resolve.)

Extensionless URLs (`/fitness`, `/about`) are how the site links to itself, and Python's
server doesn't resolve them. Wrangler's local server does, and behaves like production:

```bash
npx wrangler dev        # serves ./public on http://localhost:8787 — local only, deploys nothing
```

Run both checks before committing:

```bash
python3 scripts/check_site.py
```

```bash
node scripts/test_fitness.js
```

## How this was built

The pages were hand-converted from design-tool exports (`source/`) that relied on a
proprietary runtime (`support.js`). The conversion inlined all styles, expanded the
templating/loops, and reimplemented the interactive bits (clock, blog filter, reading
progress, FAQ accordion, theme switcher, Campground demo controls) in small vanilla JS —
so nothing depends on an external runtime anymore.

## Things to review / finish

- **Contact email** — `hello@kitesink.com` uses Cloudflare Email Routing. On 2026-10-10,
  routing was enabled and ready, with an enabled rule forwarding to a verified destination.
  The consulting page uses a direct email link; inbox delivery was not tested by sending a message.
- **Campground screenshots** — ✅ added in `public/site_assets/` with modern formats and PNG fallbacks.
- **Vantix `.co` vs `.com`** — ✅ fixed; the Home work-card now reads `vantix.kitesink.com`.
- **Blog posts** — entries live in `public/blog/posts.js`; per-post pages under `public/blog/`
  (copy `_template.html`). Full steps in `docs/ADDING-A-BLOG-POST.md`.
- **Listening club** — relaunched for 2027: the inaugural session is Sat 16 Jan 2027, then the last
  Saturday of every month. The pages do not say whether January also gets a session on the 30th.
  The Spotify playlist embed is still a placeholder.
- **Vantix tiers** — `/vantix#pricing` shows Free (v1.0 "The Free Core", in progress, target
  Dec 31, 2026), Plus (paid athlete tier, no price) and Pro · Coach (v2.5, planned, no dates).
- **Vantix roadmap and changelog** — hidden, not deleted. Both pages still load at their addresses
  but are `noindex` and out of the nav, the Library, the sitemap and every link. They are listed in
  `UNLISTED_PAGES` in `scripts/check_site.py`, which fails the audit if a listed page links to them.
  The plan is to rebuild them on the Vantix subdomain; delete the two files when that exists.
- **Vantix "500+ apps"** — the Vantix page still says it connects 500+ apps. Check that against the
  Free Core, which lists manual import.
- **Song of the Day** — "Coming soon" everywhere (`projects.js`, `site-index.js`, the product page),
  with no launch date printed. Every contact address is `hello@kitesink.com`.
  `song-of-the-day/terms.html` still has a `<TODO: jurisdiction>`.
- **AI concierge** — `/consulting#concierge` describes the offer (learn the industry, observe the
  work, then AI automation / deterministic programs / custom software). No prices, call cadence or
  response times are promised; add them when they are decided.
- **Backline** — the page shows player counts for a prototype. Kept on purpose for now.
- **Now page** — one "Last updated" date (in the hero box; edit it there). The project cards were
  rewritten on 2026-11-13. The three personal cards (On rotation, Under the bar, Inputs) were
  carried over from July and need the owner's own words.
- **Analytics** — off until you paste a Cloudflare Web Analytics token into `CF_TOKEN` in
  `public/ks.js` (see `docs/ANALYTICS-AND-FORMS.md`). Forms are live via `KS_FORM_KEY`.

## Deploying

See **[docs/DEPLOY-CLOUDFLARE.md](docs/DEPLOY-CLOUDFLARE.md)** for full step-by-step Cloudflare setup
(apex `kitesink.com` + `vantix.kitesink.com` subdomain).
