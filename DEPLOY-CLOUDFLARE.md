# Deploying KiteSink on Cloudflare

This site is static, so the simplest, free, fast path is **Cloudflare Pages**. You'll set up
two Pages projects from this one repo:

| Project        | Output folder | Custom domain            |
|----------------|---------------|--------------------------|
| `kitesink`     | `public/`     | `kitesink.com` + `www`   |
| `kitesink-vantix` | `vantix/`  | `vantix.kitesink.com`    |

> Why two projects? Each Pages project serves one folder at its own domain. The main site
> lives in `public/`; the Vantix placeholder lives in `vantix/` and gets its own subdomain.
> (You can skip the Vantix project for now and add it later — the link on the home page will
> just 404 until then.)

---

## 0. Prerequisites

- A Cloudflare account (free) — https://dash.cloudflare.com
- This repo pushed to GitHub (recommended) so Pages can auto-build on every push.
  ```bash
  git push -u origin dev-site-consolidation     # or merge to main first, then push main
  ```

---

## 1. Add `kitesink.com` to Cloudflare (DNS)

You need the domain's DNS managed by Cloudflare. Two cases:

**A. You registered kitesink.com with Cloudflare Registrar** → DNS is already on Cloudflare.
Skip to step 2.

**B. The domain is registered elsewhere (GoDaddy, Namecheap, Google, etc.):**
1. Cloudflare dashboard → **Add a site** → enter `kitesink.com` → choose the **Free** plan.
2. Cloudflare scans existing DNS records. Review them.
3. Cloudflare shows two **nameservers** (e.g. `xxx.ns.cloudflare.com`). Log in to your current
   registrar and replace its nameservers with these two.
4. Wait for activation (minutes to a few hours). Cloudflare emails you when `kitesink.com` is
   **Active**.

> Optional: you can transfer the registration to Cloudflare Registrar later
> (Registrar → Manage Domains). Not required for hosting.

---

## 2. Create the main Pages project (`kitesink.com`)

**Dashboard → Workers & Pages → Create → Pages → Connect to Git.**

1. Authorize GitHub and pick this repo.
2. Build settings:
   - **Production branch:** `main` (merge your work to `main` first) — or `dev-site-consolidation` while testing.
   - **Framework preset:** `None`
   - **Build command:** *(leave empty)*
   - **Build output directory:** `public`
3. **Save and Deploy.** You get a preview URL like `kitesink.pages.dev` — open it and click
   through every page to confirm it works.

### Attach the custom domain
In the project → **Custom domains → Set up a custom domain**:
1. Add `kitesink.com`. Because the domain is already on Cloudflare, Pages creates the DNS
   record for you automatically. Click **Activate**.
2. Add `www.kitesink.com` the same way (Pages will redirect it to the apex, or vice-versa).

That's it — `https://kitesink.com` now serves `public/`.

---

## 3. Create the Vantix Pages project (`vantix.kitesink.com`)

Repeat step 2 with one change:

**Create → Pages → Connect to Git → same repo**, but set:
- **Project name:** `kitesink-vantix`
- **Build output directory:** `vantix`
- Build command empty, preset None.

Then **Custom domains → Set up a custom domain → `vantix.kitesink.com` → Activate.**
Pages adds the `vantix` CNAME automatically.

Now `https://vantix.kitesink.com` serves `vantix/`.

---

## 4. Verify

- `https://kitesink.com` → Home loads, nav works, blog filter + clock animate.
- `https://kitesink.com/about.html`, `/blog.html`, `/blog/normalize.html`,
  `/song-of-the-day.html`, `/campground-tycoon.html` all load.
- The Vantix card on the home page → `https://vantix.kitesink.com` loads.
- HTTPS padlock is present (Cloudflare issues the certificate automatically — may take a few
  minutes after activating each domain).

---

## Updating the site later

With the Git integration, **just push to `main`**:
```bash
git add -A && git commit -m "update site" && git push
```
Cloudflare Pages rebuilds and redeploys both projects automatically (each watches the repo;
the main project publishes `public/`, the Vantix project publishes `vantix/`).

---

## Alternative: deploy without GitHub (direct upload)

If you'd rather not connect Git, use Wrangler from your machine:
```bash
npm i -g wrangler
wrangler login
# main site
wrangler pages deploy public --project-name kitesink
# vantix
wrangler pages deploy vantix --project-name kitesink-vantix
```
Then attach the custom domains in the dashboard as in steps 2–3. You re-run the
`wrangler pages deploy …` command each time you want to publish changes.

---

## Notes & gotchas

- **Root-relative links** (`/about.html`, `/blog/normalize.html`) require serving from a
  domain root — which Pages does. They won't resolve from `file://`; use a local server for
  testing (see README).
- **Campground screenshots:** add the PNGs to `public/site_assets/` (see README) before they
  show; the page degrades gracefully without them.
- **Email placeholder:** replace `hello@kitesink.com` across the repo with your real contact
  address before launch.
- **Caching:** after redeploys, Cloudflare may cache aggressively. If you don't see a change,
  purge cache: dashboard → the zone → **Caching → Configuration → Purge Everything**.
