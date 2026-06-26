# Analytics & forms — turning them on

Both are wired and ship **off by default** behind two empty constants at the top of
`public/ks.js`. Paste a key into each to switch it on — no other code changes needed.

```js
var CF_TOKEN  = "";   // Cloudflare Web Analytics  → analytics
var KS_FORM_KEY = ""; // Web3Forms access key      → the site's forms email you
```

Empty = the feature stays dormant (analytics simply doesn't load; forms run in a friendly
"demo mode" that confirms to the visitor but sends nothing). Nothing breaks while they're blank.

---

## 1. Analytics (Cloudflare Web Analytics)

Privacy-friendly and cookie-free — no consent banner required, no personal data collected.

1. Cloudflare dashboard → **Analytics & Logs → Web Analytics → Add a site** (`kitesink.com`).
2. Copy the **token** (the long string in the `data-cf-beacon` snippet Cloudflare shows you).
3. Paste it into `CF_TOKEN` in `public/ks.js`. Commit & deploy.

`ks.js` then injects the beacon on every page (it's loaded site-wide, including the two blog-post
pages). The CSP in `public/_headers` already allow-lists `https://static.cloudflareinsights.com`
for `script-src`, and `connect-src https:` covers the beacon's POST — so no header change is needed.

> Prefer something else? Any snippet works — drop it in `loadAnalytics()` in `ks.js` and add its
> host to `script-src` in `_headers`. Plausible / Fathom are good cookie-free alternatives.

---

## 2. Forms → suggestions@kitesink.com (Web3Forms)

Two forms post to email through one shared helper (`ksSubmitForm` in `ks.js`):

| Form | Where | What it sends |
|---|---|---|
| Vantix signup | bottom CTA of `vantix.html` | the visitor's email |
| Campground suggestion box | `campground-tycoon/roadmap.html` | the idea text + name (still pins locally too) |

**Setup (one key, both forms):**

1. Go to **https://web3forms.com**, enter **`suggestions@kitesink.com`** as the destination, and
   copy the **Access Key** (a UUID) it emails you.
2. Paste it into `KS_FORM_KEY` in `public/ks.js`. Commit & deploy.

That's it — every form now emails `suggestions@kitesink.com`. The helper sends a JSON `POST` to
`https://api.web3forms.com/submit`; `connect-src https:` in `_headers` already permits it.

**Built in:**
- **Honeypot** — each form has a hidden `botcheck` field; `ksSubmitForm` silently drops a submission
  if it's filled.
- **Inline UX** — sending / success / error states, `aria-live` for screen readers. The Vantix form
  validates the email and disables the button while sending; the suggestion box keeps its instant
  "pin it to the cork board" animation and emails in the background (best-effort).
- **Demo mode** — with no key, forms still confirm to the visitor so nothing looks broken in dev.

> Prefer Formspree (or another provider)? Point the `fetch` URL in `ksSubmitForm` at your endpoint
> and adjust the payload field names; the per-form wiring doesn't change.
