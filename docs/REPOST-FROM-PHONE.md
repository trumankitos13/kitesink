# Reposting from your phone

A repost is just **one object** in `public/blog/posts.js` (`window.KS_POSTS`) — no page,
no sitemap edit. Three ways to add one, easiest first. They all edit the same file, so
the blog index **and** the home "From the log" update automatically on the next deploy.

> Heads-up: `posts.js` lives on whatever branch you deploy. While it's still in a PR
> (not merged to `main`), point the GitHub steps below at that branch instead of `main`.

---

## 1. The composer page — `kitesink.com/repost.html`

A mobile-first form that writes the `posts.js` snippet for you (so you never hand-type JS on a
phone). A toggle at the top switches between **↗ Repost** (a link out) and **✍ Original** (your
own essay) — the fields, the live preview, and the generated snippet change to match.

**Repost:**
1. Open **`/repost.html`** — add it to your Home Screen for one-tap access.
2. Paste the article URL and fill in source, your take, etc. Date is pre-filled to today;
   `Category` accepts a comma list (`Reading, AI`) for multiple chips.
3. Tap **Copy snippet** → **Open posts.js ↗** → paste just after the `window.KS_POSTS = [` line
   → **Commit changes**. Done.

**Original (your own essay):** flip the toggle to **✍ Original**. The **slug** auto-fills from the
title (→ `/blog/<slug>.html`), and you get a **New post page ↗** button that opens GitHub to create
that file — paste the contents of `public/blog/_template.html`, write the post, commit. Then Copy
the snippet and paste it into `posts.js` as above (two commits: the page, then the index entry).
On a phone the writing is the slow part, so long essays are still easier on a laptop.

It's read-only/stateless — it just generates valid JS; the actual commit is the GitHub step, so the
page is safe to leave public. A live preview shows how the entry will land (brass for reposts,
green for your own).

---

## 2. iOS Shortcut — "Repost to KiteSink" (opens the composer pre-filled)

The easiest hands-off setup: share any article and the composer opens with the URL (and title)
already in. **No token, nothing to break.** Pairs with method 1 for the copy/commit tail.

**Build it in the Shortcuts app → New Shortcut:**
1. Tap the ⓘ (settings) → enable **Show in Share Sheet**; accept types **URLs** and
   **Safari web pages**.
2. Add **Get URLs from Input**.  → (this is your `URLs`)
3. Add **URL Encode** (Input: the `URLs` from step 2).  → call it `EncURL`.
4. *(Optional title)* Add **Get Details of Safari web pages** → Detail **Name**, then another
   **URL Encode** on it → `EncTitle`. (Works when you share from Safari.)
5. Add **Text**:
   `https://kitesink.com/repost.html?url=[EncURL]&title=[EncTitle]`
   (insert the variables where shown; drop the `&title=…` part if you skipped step 4).
6. Add **Open URLs** (Input: the Text from step 5).
7. Name it **"Repost to KiteSink"**.

Now: reading anything → **Share → Repost to KiteSink** → composer opens pre-filled → add your
take → **Copy** → **Open posts.js** → paste → Commit.

---

## 3. iOS Shortcut — "Repost (auto-commit)" via the GitHub API

The fewest taps end-to-end: share → type a sentence → it commits the entry for you (no GitHub
app, no paste). More setup, and **advanced** — read the two gotchas at the bottom.

### One-time: a token
1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens →
   Generate**.
2. Repository access: **Only select repositories → `trumankitos13/kitesink`**.
3. Permissions: **Repository → Contents → Read and write**. Generate, copy the token.
4. Treat it like a password; you can revoke it anytime.

### Build it (Shortcuts app → New Shortcut)
Settings → **Show in Share Sheet**, accept **URLs / Safari web pages**. Then:

1. **Get URLs from Input** → `URL`.
2. *(Optional)* **Get Details of Safari web pages** → **Name** → `Title`.
3. **Ask for Input** (Text, "Source?") → `Source`.
4. **Ask for Input** (Text, "Your take?") → `Note`.
5. **Current Date**, then **Format Date** → custom format `yyyy.MM.dd` → `Today`.
6. **Text** → the entry (`Entry`). Use the variables; keep the leading two spaces:
   ```
     {
       external: true,
       cat: "Reading",
       date: "[Today]",
       title: "[Title]",
       source: "[Source]",
       url: "[URL]",
       note: "[Note]"
     },
   ```
7. **Get Contents of URL** (read the file + its sha):
   - URL: `https://api.github.com/repos/trumankitos13/kitesink/contents/public/blog/posts.js?ref=main`
   - Method **GET**; Headers: `Authorization` = `Bearer YOUR_TOKEN`, `Accept` = `application/vnd.github+json`.
8. **Get Dictionary from Input**, then two **Get Dictionary Value**s: key `sha` → `Sha`; key `content` → `B64`.
9. **Replace Text** on `B64`: find `\n` (a real newline) → replace with nothing → `B64clean`.
10. **Base64 Encode** → set the toggle to **Decode**, input `B64clean` → `FileText`.
11. **Replace Text** on `FileText`: find `window.KS_POSTS = [` → replace with
    `window.KS_POSTS = [` + a newline + `[Entry]` → `NewText`.
12. **Base64 Encode** (Encode) input `NewText` → `NewB64`.
13. **Get Contents of URL** (commit):
    - URL: `https://api.github.com/repos/trumankitos13/kitesink/contents/public/blog/posts.js`
    - Method **PUT**; Headers: `Authorization` = `Bearer YOUR_TOKEN`, `Accept` = `application/vnd.github+json`.
    - Request Body **JSON**:
      `message` = `Blog: repost [Title]`, `content` = `[NewB64]`, `sha` = `[Sha]`, `branch` = `main`.
14. **Show Notification** → "Reposted ✓".

The PUT is a commit; Cloudflare redeploys and the repost is live in under a minute.

### Two gotchas
- **Quotes in your inputs.** A `"` in Source/Note/Title will break the JS. Either avoid them, or
  add a **Replace Text** on each input (`"` → `\"`) before step 6.
- **The newline strip (step 9) matters.** GitHub returns the file base64-encoded *with* line
  breaks; decoding fails unless you remove them first.

> Prefer not to keep a token on your phone? A cleaner power-path is a tiny Cloudflare Worker
> endpoint that holds the token server-side and does the commit — the Shortcut then just POSTs
> the fields with a shared secret. Ask and I'll build it.
