# Update checklist — links & images

Work top to bottom. Each item lists the **file**, **line**, **current value**, and **what to
put**. Check the box when done. Line numbers are approximate — search the quoted text if they've
shifted.

> Fastest path: fill in the blanks in section 0, then either make the edits yourself or hand this
> file back to me and I'll apply everything except the images in one pass.

---

## 0. Fill these in first (your real values)

- Contact email: `__________________`  (replacing `hello@kitesink.com`)
- X / Twitter URL (@tkitos): `__________________`
- Instagram URL (@murdocnu): `__________________`
- Website/other URL (@rummaging13): `__________________`
- App Store URL for Song of the Day: `__________________`  (or "not live yet")
- Privacy page URL: `__________________`  (or "none yet")
- Terms page URL: `__________________`  (or "none yet")
- Make footer handles on Home clickable? (y/n): `____`
- Change Home "vantix.kitesink.**co**" → "**.com**"? (y/n): `____`

---

## 1. Images — add 7 screenshots (Campground Tycoon)

Drop these files into `public/site_assets/`. Names must match exactly. Until then the page shows
styled placeholder blocks (no broken-image icons), and they appear automatically once added.

- [ ] `season_spring.png`  — season switcher
- [ ] `season_summer.png`  — season switcher
- [ ] `season_fall.png`    — default season shot + region area (referenced 3×)
- [ ] `season_winter.png`  — season switcher
- [ ] `region_board.png`   — "CAMP·OS terminal" screenshot
- [ ] `usa_map.png`        — regions map background
- [ ] `picker_bg.png`      — Hero B + final-CTA background (referenced 2×)

Suggested size: match the source art's native resolution; PNG, `image-rendering:pixelated` is
already applied so pixel art stays crisp.

---

## 2. Contact email — replace `hello@kitesink.com` (3 places)

- [ ] `public/about.html` ~line 69 — "Say hello →" button → `mailto:YOUR_EMAIL`
- [ ] `public/about.html` ~line 180 — visible link text + href → `YOUR_EMAIL`
- [ ] `public/song-of-the-day.html` (footer mailto) → `mailto:YOUR_EMAIL`

> Tip: one find-replace of `hello@kitesink.com` → your address covers all three.

---

## 3. Social links — replace `#` placeholders (About page)

`public/about.html`:
- [ ] ~line 183 — **@tkitos** (X/Twitter) — `href="#"` → your X URL
- [ ] ~line 185 — **@murdocnu** (Instagram) — `href="#"` → your Instagram URL
- [ ] ~line 186 — **@rummaging13** (website/globe) — `href="#"` → your URL
- (line 184 — **@trumankitos13** GitHub — already correct, leave it)

If a profile doesn't exist, either delete that `<a>` row or leave it as `#` for now.

---

## 4. App Store link — Song of the Day

`public/song-of-the-day.html`:
- [ ] ~line 89 — App Store button currently `https://apps.apple.com/app/song-of-the-day`
      (placeholder). Replace with the real store URL (includes your numeric app ID), **or** if the
      app isn't live, change the button label to "Coming soon" and remove the link.

---

## 5. Privacy / Terms — Song of the Day footer

`public/song-of-the-day.html`:
- [ ] ~line 380 — **Privacy** — `href="#"` → real privacy URL (or remove)
- [ ] ~line 381 — **Terms** — `href="#"` → real terms URL (or remove)

> These pages don't exist yet. Options: (a) point to existing pages, (b) I can generate simple
> `/song-of-the-day/privacy.html` + `terms.html` pages in the site style, or (c) remove the links.

---

## 6. Optional polish (Home page)

`public/index.html`:
- [ ] ~line 263 — footer handles (@tkitos / @trumankitos13 / @murdocnu / @rummaging13) are plain
      text. Make them clickable links (same URLs as section 3) — if you said yes in section 0.
- [ ] Vantix work-card display text reads `vantix.kitesink.co`; the link is already `.com`.
      Change the visible text to `.com` — if you said yes in section 0.

---

## 7. Don't touch (already correct)

Internal nav (`/`, `/about.html`, `/blog.html`, `/campground-tycoon.html`, `/song-of-the-day.html`,
`/blog/normalize.html`), the Campground **itch.io embed** + "Open on itch.io" link, GitHub
`@trumankitos13`, Vantix's `https://kitesink.com/…` back-links, and all Google Fonts links.

Known-by-design: the 13 non-featured posts on `blog.html` all point to `/blog.html` until those
posts have their own pages.

---

## 8. Ship it

```bash
git add -A && git commit -m "Update real links, contact email, and add screenshots"
git push                       # to dev, then PR → main, or push main directly
```
The `kitesink` Worker redeploys on merge to `main`. Verify with `curl -I https://kitesink.com`.
