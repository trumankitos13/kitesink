# KiteSink — site audit & improvement backlog

A review of the whole site (`public/` + `vantix/`) for things worth improving, grouped by area
and prioritized. Severity: **P1** = do before/just after launch · **P2** = soon · **P3** = nice
to have. Each item notes whether I can do it for you (no new assets/decisions needed) or whether it
needs input from you.

Snapshot of what's already good: every page has `<html lang="en">`, a `<title>`, a meta
description, and `alt` text on all images; the 404 page works; the marquees correctly duplicate
text with `aria-hidden`; fonts use `display=swap`.

---

## ✅ Applied (this pass)
- **SEO:** Open Graph + Twitter cards on every page (with a generated `/og-image.png`), `robots.txt`,
  `sitemap.xml`, and `<link rel=canonical>` sitewide. *(Items 1.P1, 1.P2 done.)*
- **Accessibility:** global `prefers-reduced-motion` block + `:focus-visible` ring on every page.
  *(2.P1, part of 2.P2.)*
- **Icons/PWA:** `apple-touch-icon.png`, `favicon-32/16.png`, and `theme-color` sitewide. *(6.P2, 6.P3.)*
- **Security:** `public/_headers` + `vantix/_headers` with nosniff, Referrer-Policy, frame options,
  Permissions-Policy, and a CSP that allows Google Fonts + the itch.io embed. *(7.P2.)*
- **Cleanup:** pruned the dead Campground build-menu JS. *(4.P3.)*
- **Content/links:** added Song of the Day **Privacy** + **Terms** pages and wired the footer;
  added the 7 Campground screenshots; fixed the Vantix `.co`→`.com` text on Home.

### Still open (need your input or a decision)
- Contrast tweak on gold-on-cream (2.P2) — changes the look, your call.
- Shared header/footer partials + stylesheet refactor (4.P2/P3) — structural.
- Self-hosted fonts (3.P3); the slim bar's extra Geist load on SOTD/Vantix (3.P2).
- Real per-post blog pages + RSS (5.P2); analytics token (5.P3).
- Remaining real links: contact email, X/Instagram/website URLs, App Store URL (see
  UPDATE-LINKS-AND-IMAGES.md).
- Legal: set the `<TODO: jurisdiction>` in the Terms page once incorporated.

---

## 1. Discoverability / SEO

- **P1 — No social-share previews (Open Graph / Twitter cards).** Only `song-of-the-day.html` has
  any. Home, About, Blog, the blog post, Campground, and Vantix have **none**, so links pasted into
  iMessage/X/Slack/Discord show a bare URL with no title, description, or image. *I can add
  `og:`/`twitter:` tags to every page.* Needs: one share image per page (or a single default
  `og-image.png` — I can wire a placeholder until you design one).
- **P1 — No `sitemap.xml` or `robots.txt`.** Search engines have to guess your URLs. *I can generate
  both* (`public/robots.txt` + `public/sitemap.xml` listing the 6 main URLs and the subdomain).
- **P2 — No canonical URLs.** Add `<link rel="canonical">` per page to avoid duplicate-content
  ambiguity (e.g. `kitesink.com` vs `kitesink.com/index.html`). *I can do this.*
- **P2 — `www` vs apex not redirected.** Decide a primary host and 301 the other (e.g. `www` →
  apex). Configure once added in Cloudflare. *Guidance, you click.*
- **P3 — No structured data.** `Person` / `WebSite` JSON-LD would enrich search results. *I can add.*

## 2. Accessibility

- **P1 — Motion ignores `prefers-reduced-motion`.** The marquees, pulsing dots, the song-card
  equalizer, and spinners animate for everyone, including users who set "reduce motion" (a real
  vestibular-accessibility issue). *I can add a global `@media (prefers-reduced-motion: reduce)`
  block that pauses/disables these on every page.*
- **P2 — Color contrast on gold-on-cream.** The gold `#d8b07a`/`#b07227` on the cream `#ece2cb`
  (used for small labels and the About email underline) is likely below WCAG AA for small text.
  *I can darken those specific tones; needs your OK since it shifts the look slightly.*
- **P2 — Focus visibility.** Keyboard focus styles are inconsistent (SOTD has a skip link + focus
  ring; most pages rely on the browser default, and a few elements set `outline:none`). *I can add
  a consistent `:focus-visible` ring sitewide.*
- **P3 — Icon-only links need labels.** The About social links and some nav arrows are icon-only;
  add `aria-label` so screen readers announce them. *I can do this.*

## 3. Performance

- **P2 — Project pages now load two font families.** The slim KiteSink bar pulls in **Geist** on
  Song of the Day (which already loads Newsreader + JetBrains Mono) and Vantix (Space Grotesk +
  JetBrains Mono). That's an extra render-blocking request per page. *Options: scope the bar to a
  system font, or accept it. I can switch the bar to `system-ui` on those two pages.*
- **P3 — Google Fonts are third-party + render-blocking.** Self-hosting the woff2 files (or
  `preload`ing them) trims a DNS/TLS hop and a flash of unstyled text. *I can self-host if you want;
  adds font files to the repo.*
- **P3 — Large inline HTML.** Campground (67K) and SOTD (49K) ship a lot of inline style. Fine for
  now; only worth addressing if you extract a shared stylesheet (see Maintainability).

## 4. Maintainability / code quality

- **P2 — Header & footer are copy-pasted across 7 files.** Changing a nav link means editing every
  page (we just lived this with the slim bar). Since the site is static with no build step, options:
  (a) a tiny build script that injects shared partials, (b) a small client-side include, or
  (c) leave as-is and accept the duplication. *I can set up a minimal build step (e.g. a 30-line
  Node script or a `_partials` include) if you want maintainability over zero-tooling.*
- **P3 — Inline styles everywhere, no shared stylesheet.** A shared `styles.css` with design tokens
  (the cream/green palette, type scale) would cut duplication and make theming possible. Larger
  refactor; *I can do it incrementally per page.*
- **P3 — Dead JS after the Campground demo removal.** The page still defines `setTool`/`setSeason`
  helpers and queries `.seasonchip`/`.tool` that no longer exist (harmless no-ops). *I can prune.*
- **P3 — `source/` archive still in the repo.** The original `.dc.html` exports are committed.
  Fine as reference, but consider removing once you're confident in the conversions to slim the repo.

## 5. Content / UX

- **P2 — Blog is mostly non-functional links.** 13 of 14 posts link back to `/blog.html`; only
  "normalize" has a page. The category filter is client-side only (no per-category URLs). *I can
  scaffold empty post pages from the existing data, and/or add an RSS feed.* Needs: the post content.
- **P2 — Vantix page is a thin brand placeholder.** Good enough as a holding page; worth a short
  "what it is / coming soon / notify me" line so visitors who click through aren't confused.
  *I can add copy; needs your wording.*
- **P2 — Privacy/Terms for Song of the Day are dead `#` links.** If the iOS app collects anything,
  the App Store requires a reachable privacy policy. *I can generate styled `privacy.html`/
  `terms.html`; needs the policy text.*
- **P3 — itch.io embed on small screens.** The game embeds at a 1280×740 (wide) aspect, so on
  phones it renders small. Consider a "best played on desktop" hint or a tap-to-open-fullscreen
  affordance. *I can add a note.*
- **P3 — No analytics.** If you want traffic insight, Cloudflare Web Analytics is free and
  cookieless (one script tag). *I can add it; needs your token.*

## 6. Icons / PWA polish

- **P2 — No `apple-touch-icon` or `theme-color`.** Saving to an iOS home screen shows a blank icon,
  and mobile browser chrome isn't tinted. *I can add a 180×180 `apple-touch-icon.png` (from the kite
  logo) and a `theme-color` meta sitewide.* Needs: I can render the PNG from the existing SVG.
- **P3 — Only an SVG favicon.** Old browsers want a `favicon.ico`/PNG fallback. *I can add one.*
- **P3 — No web app manifest.** A `site.webmanifest` enables "install" and richer mobile metadata.
  *Optional; I can add.*

## 7. Security / headers

- **P2 — No security headers.** Add a `public/_headers` (supported by the Worker) with
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, a basic `Content-Security-Policy`
  (allowing Google Fonts + the itch.io frame), and `Permissions-Policy`. *I can add this; the CSP
  needs light testing so the itch embed and fonts still load.*
- **P3 — Plain `mailto:` invites spam.** Now that the Cloudflare email obfuscation is gone, the
  address is scrapeable. Consider a contact form (Cloudflare Worker/Form) or simple obfuscation.
  *Optional.*

---

## Suggested order (my recommendation)

1. **P1 quick wins I can do now, no assets needed:** `robots.txt` + `sitemap.xml`, OG/Twitter tags
   (with a placeholder share image), `prefers-reduced-motion` block, `apple-touch-icon` +
   `theme-color`. One PR, big SEO/a11y lift.
2. **P2 correctness:** security `_headers`, focus styles, contrast fixes, canonical URLs, prune dead
   Campground JS.
3. **Content (needs you):** real post pages + RSS, SOTD privacy/terms, Vantix copy, analytics token.
4. **P3 / structural:** shared header/footer partials + stylesheet refactor, self-hosted fonts.

Tell me which bucket to start on and I'll open a branch. Items marked "I can do" need nothing from
you; the rest I've noted what input they need.
