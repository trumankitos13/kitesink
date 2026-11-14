# Analytics and forms

Both are on. This page says where each is switched on and how to check it.

---

## 1. Analytics (Cloudflare Web Analytics)

Cookie-free, with no personal data collected, so no consent banner is needed.

It is switched on in the Cloudflare dashboard, not in this repository: **Web Analytics →
Add a site → `kitesink.com`**, using the automatic setup. Cloudflare then adds its script
to each page as it serves it. There is no token in `public/ks.js` and nothing to deploy.

- **Do not paste a snippet or token into the site as well.** Two scripts would count every
  visit twice.
- **No header change is needed.** The CSP in `public/_headers` allows the script from
  `https://static.cloudflareinsights.com`, and automatic setup reports to the site's own
  origin (`/cdn-cgi/rum`), which `connect-src 'self'` covers. Only a hand-pasted snippet
  reports to `cloudflareinsights.com`, which the CSP does not allow.
- **Checking it.** Open the site in a browser, then DevTools → Network, and look for a
  `POST` to `/cdn-cgi/rum`. `curl` will not show the script: Cloudflare adds it for
  browsers only.

Source: https://developers.cloudflare.com/web-analytics/faq/

---

## 2. Forms (Web3Forms)

Five forms post to email through one shared helper, `ksSubmitForm` in `public/ks.js`:

| Form | Where |
|---|---|
| Consulting enquiry | `consulting.html`, `#contact` |
| Vantix list | `vantix.html`, `#join` |
| Listening Club question | `listening-club.html` |
| Campground suggestion box | `campground-tycoon/roadmap.html` |
| Song of the Day support | `song-of-the-day/support.html` |

The access key is `KS_FORM_KEY` at the top of `public/ks.js`. Every form emails the inbox
that key was registered with at https://web3forms.com. To change the inbox, register a new
key there and replace the constant. An empty key puts the forms in a demo mode that
confirms to the visitor and sends nothing.

The helper sends a JSON `POST` to `https://api.web3forms.com/submit`, which `connect-src`
in `public/_headers` names explicitly.

**Built in:**
- **Honeypot.** Each form has a hidden `botcheck` field; a submission that fills it is dropped.
- **States.** Sending, success and error messages, announced to screen readers.
- **Where an enquiry came from.** The consulting form records `?via=` from the address in a
  "Found via" line, which is how enquiries from the plain-text pages are counted.

**After any deploy that touches `ks.js`,** send one real consulting enquiry from
`/consulting?via=ai-assistant#contact` and confirm it arrives with that line.
