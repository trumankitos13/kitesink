# KiteSink

The personal site / portfolio for **kitesink.com** — apps, games & tools by one independent maker.

Plain static HTML/CSS/JS. No build step, no framework, no runtime dependency. Every page
runs in any browser by opening the file directly.

## Structure

```
public/                     ← deploy root for kitesink.com
  index.html                Home (curated work, From-the-log feed, song-of-the-day card)
  work.html                 Work — full index of everything built + external tools
  games.html                Games — my games + games I love
  projects.js               Shared data for Work + Games (KS_WORK / KS_GAMES). Edit to add more.
  about.html                About
  now.html, uses.html, colophon.html   Now / Uses / Colophon (linked from the shared footer)
  listening-club.html       Album Listening Club — dark landing page, Discord front door
                            (served extensionless at /listening-club)
  repost.html               Phone composer for new posts/reposts (discreet ✎ link in the footer)
  blog.html                 Writing index (live filter; your essays + external reposts)
  blog/
    posts.js                Shared blog entries (KS_POSTS) — blog index + home feed read this
    campground-tycoon-the-story-so-far.html   First post (reading-progress bar)
  song-of-the-day.html      Landing for the Song of the Day iOS app (FAQ + theme switcher)
  song-of-the-day/
    privacy.html, terms.html  Legal pages
    logos/                  Exported brand SVGs (marks, app icons, lockup)
  campground-tycoon.html    Campground Tycoon landing + interactive demo
  campground-tycoon/
    roadmap.html            Dev roadmap — trail of milestones + suggestion box
  vantix.html               Vantix — the periodization OS (landing)
  vantix/
    roadmap.html, changelog.html, privacy.html   Vantix marketing sub-pages
  ks.js, ks.css             Shared chrome: header / dark footer / mobile pill nav / clock —
                            plus the analytics token (CF_TOKEN) and forms key (KS_FORM_KEY)
  feed.xml                  Atom feed (hand-maintained; see docs/ADDING-A-BLOG-POST.md)
  favicon.svg
  site_assets/              Campground screenshot PNGs

vantix/                     ← deploy root for vantix.kitesink.com (separate Worker)
  index.html                Vantix brand / identity placeholder
  favicon.svg

source/                     ← archived ORIGINAL design-tool exports (.dc.html). Not deployed.
                              Kept for reference; safe to delete once you're confident.
```

## Local preview

These are static files — just open `public/index.html` in a browser, or serve the folder:

```bash
cd public && python3 -m http.server 8000   # then visit http://localhost:8000
```

(Use a server rather than `file://` so the root-relative links like `/about.html` resolve.)

## How this was built

The pages were hand-converted from design-tool exports (`source/`) that relied on a
proprietary runtime (`support.js`). The conversion inlined all styles, expanded the
templating/loops, and reimplemented the interactive bits (clock, blog filter, reading
progress, FAQ accordion, theme switcher, Campground demo controls) in small vanilla JS —
so nothing depends on an external runtime anymore.

## Things to review / finish

- **Contact email** — placeholder `hello@kitesink.com` is used on a few pages. Replace with
  your real address (search the repo for `hello@kitesink.com`).
- **Campground screenshots** — ✅ added in `public/site_assets/` (the 7 PNGs are wired and live).
- **Social links** — some footer handles (`@tkitos`, `@murdocnu`, `@rummaging13`) are `#`
  placeholders; fill in real profile URLs.
- **Vantix `.co` vs `.com`** — ✅ fixed; the Home work-card now reads `vantix.kitesink.com`.
- **Blog posts** — entries live in `public/blog/posts.js`; per-post pages under `public/blog/`
  (copy `_template.html`). Full steps in `docs/ADDING-A-BLOG-POST.md`.
- **Listening club** — replace the `discord.gg/INVITE` placeholder (4 links) and the Spotify
  embed placeholder in `public/listening-club.html`; edit the next-session date band monthly.
- **Analytics** — off until you paste a Cloudflare Web Analytics token into `CF_TOKEN` in
  `public/ks.js` (see `docs/ANALYTICS-AND-FORMS.md`). Forms are live via `KS_FORM_KEY`.

## Deploying

See **[docs/DEPLOY-CLOUDFLARE.md](docs/DEPLOY-CLOUDFLARE.md)** for full step-by-step Cloudflare setup
(apex `kitesink.com` + `vantix.kitesink.com` subdomain).
