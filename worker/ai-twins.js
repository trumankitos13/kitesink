/* KiteSink: serve a page's plain-text twin at the page's own address.

   Off by default. It runs only if the site is deployed with wrangler.ai-twins.jsonc
   (see docs/AI-PAGES.md). The normal wrangler.jsonc does not use this file.

   Who gets the twin (public/<page>.md) instead of the HTML page:
     AI_TWINS = "accept"  only requests whose Accept header prefers text/markdown to HTML
     AI_TWINS = "agents"  those, plus the AI crawlers and assistants named below
     AI_TWINS = "off"     nobody
   Everyone else, including Googlebot and Bingbot, always gets the normal page.
   The twin says the same things as the page, so this changes the format, not the facts.
   Anything unexpected falls through to the normal site.

   Cloudflare does not apply public/_headers to responses from a Worker, so this file applies
   the same rules itself (worker/asset-headers.js, generated from public/_headers by
   scripts/build_agent_files.py). Without that, the pages it answers would lose their
   security headers. */

import { RULES } from "./asset-headers.js";

// Names taken from each company's published crawler documentation. Search engines are
// deliberately absent: showing them different content from people is against their rules.
const AI_AGENTS = /GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|PerplexityBot|Perplexity-User/i;

export function twinFor(pathname) {
  const path = pathname.replace(/\/+$/, "");
  if (path === "") return "/index.md";
  if (/\.[a-z0-9]+$/i.test(path)) return null;      // already a file: /ks.css, /fitness.md
  return path + ".md";
}

// The q-value of each media range in an Accept header, in order.
function parseAccept(header) {
  return header.split(",").map((part, order) => {
    const [range, ...params] = part.trim().toLowerCase().split(";").map((s) => s.trim());
    const q = params.find((p) => p.startsWith("q="));
    const value = q ? Number(q.slice(2)) : 1;
    return { range, q: Number.isFinite(value) ? value : 0, order };
  }).filter((item) => item.range);
}

// Markdown only when the client names text/markdown and rates it at least as high as HTML.
// A browser's Accept (text/html, ..., */*;q=0.8) never qualifies; neither does */* alone.
export function prefersMarkdown(header) {
  const items = parseAccept(header || "");
  const best = (ranges) => items.filter((i) => ranges.includes(i.range))
    .reduce((top, i) => (i.q > top.q || (i.q === top.q && i.order < top.order) ? i : top), { q: 0, order: Infinity });
  const md = best(["text/markdown"]);
  const html = best(["text/html", "application/xhtml+xml"]);
  return md.q > 0 && (md.q > html.q || (md.q === html.q && md.order < html.order));
}

function wantsTwin(request, mode) {
  if (mode === "off") return false;
  if (prefersMarkdown(request.headers.get("Accept"))) return true;
  return mode === "agents" && AI_AGENTS.test(request.headers.get("User-Agent") || "");
}

// The _headers patterns used on this site: exact paths and * splats.
function matches(pattern, pathname) {
  const re = new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return re.test(pathname);
}

// Add each header the matching _headers rules set, unless the response already has it.
export function withSiteHeaders(response, pathname, extra = {}) {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(extra)) {
    const had = name === "Vary" ? out.headers.get("Vary") : null;
    out.headers.set(name, had ? `${had}, ${value}` : value);
  }
  for (const [pattern, headers] of RULES) {
    if (!matches(pattern, pathname)) continue;
    for (const [name, value] of Object.entries(headers)) {
      if (!out.headers.has(name)) out.headers.set(name, value);
    }
  }
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const mode = env.AI_TWINS || "accept";
    const vary = mode === "agents" ? "Accept, User-Agent" : "Accept";
    try {
      if ((request.method === "GET" || request.method === "HEAD") && wantsTwin(request, mode)) {
        const twin = twinFor(url.pathname);
        if (twin) {
          const found = await env.ASSETS.fetch(new Request(new URL(twin, url.origin), { method: request.method }));
          if (found.ok) {
            const page = "https://kitesink.com" + (url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, ""));
            // A fresh response: none of the twin file's own headers (its noindex above all)
            // carry over, because this is the page's address, and search engines must keep it.
            return withSiteHeaders(new Response(found.body, { status: 200 }), url.pathname, {
              "Content-Type": "text/markdown; charset=utf-8",
              "Cache-Control": "public, max-age=600",
              "Vary": vary,
              "Link": `<${page}>; rel="canonical"`,
              "X-KiteSink-Twin": twin
            });
          }
        }
      }
      // The normal page. It says Vary too, so no cache hands it to a reader who asked for markdown.
      const page = await env.ASSETS.fetch(request);
      return withSiteHeaders(page, url.pathname, { "Vary": vary });
    } catch (err) {
      return env.ASSETS.fetch(request);
    }
  }
};
