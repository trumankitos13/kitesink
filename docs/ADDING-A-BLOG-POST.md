# How to add a blog post

The blog holds **two kinds of entry**, both driven by the `KS_POSTS` list in `public/blog/posts.js`
(one shared file — the blog index _and_ the home page's "From the log" both read it):

- **Your essay** — something you wrote. Needs its own HTML file in `public/blog/` _and_ a `POSTS`
  entry. Renders in green; this is the default. Steps 1–4 below.
- **A repost / external link** — a link out to someone else's writing you want to feature. **No
  page file** — just one `POSTS` entry with `external: true`. Renders in **brass with an ↗**, opens
  in a new tab, and can carry a short blurb on _why_ you're featuring it. See
  [Reposting an external link](#reposting-an-external-link) below.

The index makes the difference obvious at a glance (legend: `✍ Mine` vs `↗ External link`) and adds
a **↗ Reposts** filter chip automatically once at least one repost exists. The rest is plain static
HTML — no build step.

---

## 1. Create the post page (your own essays only)

> Skip this whole section for reposts — an external link needs no page file.


```bash
# from the repo root — pick a short, lowercase, hyphenated slug
cp public/blog/_template.html public/blog/my-post-slug.html
```

Open `public/blog/my-post-slug.html` and edit:

**In `<head>`:**
- `<title>` → `KiteSink — Your title`
- `<meta name="description">` → one-line summary (also used for the social-share card)
- `<link rel="canonical">` and `og:url` → `https://kitesink.com/blog/my-post-slug.html`
  (replace `POST-SLUG`)

**In the article:**
- The meta line — `CATEGORY` and `2026.01.01 · N min read`
- `<h1>` — your title
- The italic standfirst under the title
- The green banner caption (or delete that whole banner block if you don't want a header image)
- The body — write between the `POST BODY` comment markers. Available styles are shown in the
  template: drop-cap lead, `<h2>` headings, `<strong>`/`<em>`, a `<blockquote>` pull-quote, and a
  "Note" callout box.
- "Filed under" tag(s) at the bottom
- Prev / Next cards — set the titles + `href`s, or delete the block

The reading-progress bar, header, footer, and SEO/social tags all work automatically.

---

## 2. List it on the blog index

Open `public/blog/posts.js` and add an object to `window.KS_POSTS` **at the top** (newest first):

```js
window.KS_POSTS = [
  {
    cat: "Training",                       // category — chips are built from these automatically.
                                           // Use an array for several: cat: ["Devlog", "Gaming"]
    date: "2026.07.01",                    // YYYY.MM.DD
    read: "6 min",
    title: "Your title",
    dek: "One-sentence summary for the index.",
    href: "/blog/my-post-slug.html",
    featured: true                         // optional — the newest featured post gets the big card
  },
  // ...older posts below
];
```

`cat` can be a **string or an array** — an array lists the entry under every one of those filter
chips (e.g. `["Devlog", "Gaming"]` shows under both, and the eyebrow reads "Devlog · Gaming").

That single file is the source of truth — the blog index (featured card, category chips, list,
counts) **and** the home page's "From the log" (newest 4, plus the entry count in its header link)
both render from it. The empty-state message disappears as soon as there's one post.

---

## Reposting an external link

Want to feature someone else's article? Add **one** `POSTS` entry with `external: true` — that's the
whole job. No file under `public/blog/`, no sitemap entry (it's not your URL), no step 1.

```js
{
  external: true,                          // ← marks it as a repost (brass styling + ↗ + new tab)
  cat: "AI",                               // topical category — still feeds the filter chips
  date: "2026.07.01",                      // YYYY.MM.DD
  read: "12 min",                          // optional — the linked piece's length
  title: "The article's title",
  source: "Publication or Author",         // shown as the byline, e.g. "Stratechery"
  url: "https://example.com/the-article",  // the external link (opens in a new tab)
  dek: "One line on what the piece is about.",
  note: "Why I'm featuring this — my take in a sentence or two."   // optional but recommended
},
```

How it renders vs. your own essays:

| | Your essay | Repost (`external: true`) |
|---|---|---|
| Accent colour | green | **brass** |
| Marker | — | **↗** after the title + brass `↗ Source` eyebrow |
| Link | `href` → `/blog/slug.html`, same tab | `url` → external site, **new tab** (`rel="noopener"`) |
| Blurb | the `dek` | the `dek` **plus** your `note` ("Why I'm featuring this") |
| Needs a page file? | yes | **no** |

Set `featured: true` on a repost and the big top card switches to the brass variant too. The index
ships with one **example** repost (Paul Graham, _How to Do Great Work_) so you can see the styling —
edit it to your first real link, or delete that object.

---

## 3. Add it to the sitemap (good for SEO — your own essays only)

Open `public/sitemap.xml` and add one line before `</urlset>`:

```xml
  <url><loc>https://kitesink.com/blog/my-post-slug.html</loc><lastmod>2026-07-01</lastmod><priority>0.6</priority></url>
```

---

## 4. Add it to the RSS feed

The feed at `public/feed.xml` (Atom) is what readers subscribe to; it's discovered automatically via
the `<link rel="alternate" type="application/atom+xml">` tag in `blog.html`. It's a hand-maintained
static file (no build step), so add a matching `<entry>` **at the top** (newest first) and bump the
top-level `<updated>` to the new date:

```xml
<entry>
  <title>Your title</title>
  <link href="https://kitesink.com/blog/my-post-slug.html" rel="alternate" type="text/html"/>
  <id>https://kitesink.com/blog/my-post-slug.html</id>
  <published>2026-07-01T12:00:00Z</published>
  <updated>2026-07-01T12:00:00Z</updated>
  <category term="Training"/>
  <summary>One-sentence summary — the same dek is fine.</summary>
</entry>
```

For a **repost**, point `<link href>` at the external `url`, but keep the `<id>` namespaced to
kitesink.com (e.g. `https://kitesink.com/feed.xml#a-slug`) so the id stays stable and yours. Dates
are RFC-3339 (`YYYY-MM-DDT12:00:00Z`).

---

## 5. Preview, then publish

```bash
cd public && python3 -m http.server 8000     # open http://localhost:8000/blog.html
```
Check the index shows the post, the link opens the page, and the reading bar moves. Then:

```bash
git add -A
git commit -m "Blog: add 'Your title'"
git push          # to dev → PR → main, or push main directly
```

The Cloudflare Worker redeploys and the post is live at `https://kitesink.com/blog/my-post-slug.html`.

---

## Notes
- **Filenames:** keep slugs lowercase-hyphenated; the URL is the filename.
- **Categories** are free-form — a new `cat` value automatically becomes a new filter chip.
- **Home page:** the "From the log" section auto-renders the newest 5 entries from `posts.js` — no
  extra step. It falls back to an empty-state note only when there are no posts.
- **Template file** `public/blog/_template.html` starts with `_` so it's ignored as a real post;
  leave it in place to spin up the next one.
