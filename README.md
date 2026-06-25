# KiteSink

The personal site / portfolio for **kitesink.com** — apps, games & tools by one independent maker.

Plain static HTML/CSS/JS. No build step, no framework, no runtime dependency. Every page
runs in any browser by opening the file directly.

## Structure

```
public/                     ← deploy root for kitesink.com
  index.html                Home (selected work, blog teaser, song-of-the-day card)
  about.html                About
  blog.html                 Writing index (live category filter)
  blog/
    normalize.html          Blog post — "Why I normalize every set…" (reading-progress bar)
  song-of-the-day.html      Landing page for the Song of the Day iOS app (FAQ + theme switcher)
  campground-tycoon.html    Campground Tycoon landing + interactive demo
  favicon.svg
  site_assets/              ← drop Campground screenshot PNGs here (see note below)

vantix/                     ← deploy root for vantix.kitesink.com (separate Pages project)
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
- **Blog posts** — only the first post has a real page (`/blog/normalize.html`); the other 13
  link back to the index. Add per-post pages under `public/blog/` as you write them.

## Deploying

See **[docs/DEPLOY-CLOUDFLARE.md](docs/DEPLOY-CLOUDFLARE.md)** for full step-by-step Cloudflare setup
(apex `kitesink.com` + `vantix.kitesink.com` subdomain).
