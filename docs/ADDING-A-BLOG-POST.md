# How to add a blog post

The blog is plain static HTML — no build step. A post is **one HTML file** in `public/blog/`,
plus **one entry** in the list on `public/blog.html`. Takes ~5 minutes.

---

## 1. Create the post page

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

Open `public/blog.html`, find the `POSTS` array near the top of the `<script>`, and add an object
**at the top** (newest first):

```js
var POSTS = [
  {
    cat: "Training",                       // category — chips are built from these automatically
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

That's the single source of truth for the index — the featured card, the category filter chips,
the post list, and the counts all render from it. The empty-state message disappears as soon as
there's one post.

---

## 3. Add it to the sitemap (good for SEO)

Open `public/sitemap.xml` and add one line before `</urlset>`:

```xml
  <url><loc>https://kitesink.com/blog/my-post-slug.html</loc><lastmod>2026-07-01</lastmod><priority>0.6</priority></url>
```

---

## 4. Preview, then publish

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
- **Home page:** the "From the log" section currently shows an empty-state note. Once you have
  posts, tell me and I'll wire it to feature your latest few (or you can copy the card markup).
- **Template file** `public/blog/_template.html` starts with `_` so it's ignored as a real post;
  leave it in place to spin up the next one.
