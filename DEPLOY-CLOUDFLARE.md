# Deploying KiteSink on Cloudflare

This site deploys as a **Cloudflare Worker with Static Assets** (the modern successor to
Pages). The repo already contains the Worker config, so deploying is mostly "push to `main`".

| What                | Config file           | Serves folder | Domain                  |
|---------------------|-----------------------|---------------|-------------------------|
| Main site           | `wrangler.jsonc`      | `public/`     | `kitesink.com` (+ `www`)|
| Vantix placeholder  | `vantix/wrangler.jsonc` | `vantix/`   | `vantix.kitesink.com`   |

> **Why not Pages?** A `wrangler.jsonc` was added when Cloudflare auto-configured Workers
> Builds for this repo. With that file present, Cloudflare deploys a **Worker**, not a Pages
> project — and a Worker route wins over a Pages custom domain. So we use Workers Static
> Assets for both. (If you ever want plain Pages instead, you must delete `wrangler.jsonc`
> *and* delete the Worker + its Workers-Build connection in the dashboard first.)

---

## The bug this just fixed

The original auto-generated `wrangler.jsonc` had `"assets": { "directory": "." }` — it served
the **repo root**, which has no `index.html` (the site lives in `public/`). Result:
`kitesink.com` returned a **404 with an empty body**. It now points at `./public`, so once
this lands on `main` and the Worker redeploys, the site loads.

---

## 1. DNS — get `kitesink.com` onto Cloudflare

If you registered the domain with Cloudflare, this is already done. Otherwise:
1. Dashboard → **Add a site** → `kitesink.com` → Free plan.
2. Point your registrar's nameservers at the two Cloudflare gives you.
3. Wait for the zone to go **Active**.

---

## 2. Main site Worker (`kitesink.com`)

The repo is already connected via Workers Builds (that's where `wrangler.jsonc` came from).
**To deploy: merge to `main` and the Worker rebuilds automatically.** Verify in the dashboard:

- **Workers & Pages → `kitesink`** → latest build is green, serving `./public`.
- **Settings → Domains & Routes** → ensure `kitesink.com` is attached. Add `www.kitesink.com`
  too (this also creates the `www` DNS record — that's why `www` currently fails to resolve).

If the Worker is **not** yet connected to the repo:
- **Workers & Pages → Create → Workers → Connect to Git** → pick this repo, leave the build
  defaults (it reads `wrangler.jsonc`), deploy. Then attach the domain as above.

### Deploy manually instead (optional)
```bash
npm i -g wrangler
wrangler login
wrangler deploy            # reads ./wrangler.jsonc, serves ./public
```

---

## 3. Vantix subdomain (`vantix.kitesink.com`)

`vantix.kitesink.com` currently doesn't resolve because no Worker/DNS exists for it yet.
There's a ready config at `vantix/wrangler.jsonc` (a separate Worker named `kitesink-vantix`).

**Connect a second Workers project** pointing at the `vantix/` folder:
- **Workers & Pages → Create → Workers → Connect to Git** → same repo.
- In the build settings set the **root directory** to `vantix` (so it uses
  `vantix/wrangler.jsonc` and serves that folder).
- Deploy, then **Settings → Domains & Routes → Add** `vantix.kitesink.com`.

Or manually:
```bash
cd vantix && wrangler deploy
# then add the custom domain in the dashboard
```

---

## 4. Verify

```bash
curl -I https://kitesink.com            # expect HTTP 200
curl -I https://kitesink.com/about.html # 200
curl -I https://www.kitesink.com        # 200 (after adding www)
curl -I https://vantix.kitesink.com     # 200 (after step 3)
```
Then open `https://kitesink.com` and click through Home → About → Blog → the project pages.
A 404 on a real page means the asset path is wrong; a 404 on a *missing* path correctly serves
`public/404.html`.

---

## Updating later

Push to `main`. Workers Builds rebuilds and redeploys each connected Worker automatically
(`kitesink` → `public/`, `kitesink-vantix` → `vantix/`).

## Gotchas

- **`www` / `vantix` "can't resolve"** = no DNS record yet. Adding the custom domain to the
  Worker (step 2/3) creates it.
- **Still 404 after deploy?** Confirm the `kitesink` Worker's latest build is green and that
  `wrangler.jsonc` shows `directory: ./public`. Purge cache: zone → **Caching → Purge
  Everything**.
- **Campground screenshots** still need to be added to `public/site_assets/` (see README); the
  page degrades gracefully without them.
- **Contact email** placeholder `hello@kitesink.com` should be replaced before launch.
