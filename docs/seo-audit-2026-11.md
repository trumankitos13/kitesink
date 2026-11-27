# SEO audit, November 2026 (AST-42)

Checklists used (read only, nothing installed): `seo-title-optimization`, `internal-linking` and `seo-roast`
from github.com/Illyism/seo-skills (MIT). Not used: ahrefs-research, dataforseo-serp, block-ai-scrapers
(it would conflict with `ai-train=yes`). No paid APIs, no keys.

Measured from `<title>` and `<meta name="description">` in every `public/**/*.html` (60 files, including
`404.html` and `blog/_template.html`).

| Check | Before | After |
|---|---|---|
| Missing title or description | 0 | 0 |
| Duplicate titles / descriptions | 0 / 0 | 0 / 0 |
| Titles over 60 characters | 23 | 0 |
| Descriptions over 160 characters | 32 | 0 |

## Findings and fixes, by page group

**Fitness sub-pages (`/fitness/*`)** are generated from `content/fitness/routes.json`.
- Titles over 60: basics, bodycomp, conditioning, glossary, meet, powerlifting, recovery, women. Fixed in `routes.json`.
- Descriptions over 160: basics, technique, hypertrophy, powerlifting, meet, conditioning, recovery, nutrition, diet, bodycomp, women, health, claims, reference. Fixed in `routes.json`; the `{{n:...}}` count placeholders are kept.
- Left: titles that were already 60 or under, and the `· KiteSink Fitness` suffix.

**Fitness hub (`/fitness`)** comes from `content/fitness/page.html`. Title (69) and description (233) shortened. The og/twitter descriptions were already short.

**Music sub-pages (`/music/*`)** are generated from `content/music/routes.json`.
- Titles over 60: 13 pages (royalty-basics, pros-performance, mechanicals-mlc, recorded-neighboring, metadata-registration, unclaimed-recovery, ai-rights, producer-royalties, claims, glossary, claimable, tools, ai-tools). Fixed.
- Descriptions over 160: pros-performance, ai-rights, producer-royalties, claims, claimable, tools, ai-tools. Fixed.
- Left: routes for areas not written yet (deal-structures, international-societies, sync-licensing, audits, copyright-fundamentals, distribution-dsps, catalog-finance) have long titles, but no page is built from them. Shorten them when each page is written.

**Music hub (`/music`)** comes from `content/music/templates/hub.html`. Title (81) and description (197) shortened.

**Hand-written pages** were edited in `public/` directly because no generator makes them: the Campground Tycoon overview, features, regions and roadmap pages, the devlog post, colophon, consulting, now, song-of-the-day and stage-first. Only the `description` text changed (they were 161 to 261 characters). Their titles were already 60 or under.
- Wording was tightened, not changed in meaning. Dropped phrases: "eight true landscape families", "Pin your own feature idea to the ranger station" (roadmap now says "Pin your own idea"), "known so far as Backline" and "Prototype and design stage" (stage-first now ends "Prototype."). The page bodies still carry all of that.
- Where a hand page repeated the description in og/twitter tags or JSON-LD, it was updated by the same replacement.

**Internal links**
- Added a "Devlog" link to the Campground Tycoon footer on all four Campground Tycoon pages, pointing at `/blog/campground-tycoon-the-story-so-far`. That post had only one in-body inbound link (from `/games`). The footer already wraps on narrow screens.
- Left: `/vantix/changelog` and `/vantix/roadmap`. `check_site.py` treats them as hidden on purpose (not in the site index or sitemap), so linking them from `vantix.html` fails the gate. Linking them is Truman's call.
- Left: `/colophon`, `/uses` and `/games` show one static inbound link, but the shared chrome in `ks.js` links them from every page, so there is no real gap.
- Left: fitness and music sub-pages already have 15 to 17 inbound links each from the hubs and each other.

## Left alone on purpose
- `robots.txt`, Content-Signal (`ai-train=yes`), `llms.txt`, `llms-full.txt`: unchanged.
- Sitemap, canonicals and JSON-LD: already present; the gate passes.
- Visual design, page copy bodies, slugs and URLs.
- `seo-roast` suggestions about crawl blockers and authority: nothing fatal found; the rest is out of scope (no Search Console data, no paid tools).
- Not checked: whether the shorter titles rank better. There is no SERP or Search Console data in this run.
