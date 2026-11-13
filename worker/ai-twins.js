/* KiteSink: serve a page's plain-text twin at the page's own address.

   Off by default. It runs only if the site is deployed with wrangler.ai-twins.jsonc
   (see docs/AI-PAGES.md). The normal wrangler.jsonc does not use this file.

   Who gets the twin (public/<page>.md) instead of the HTML page:
     AI_TWINS = "accept"  only requests that ask for it with "Accept: text/markdown"
     AI_TWINS = "agents"  those, plus the AI crawlers and assistants named below
     AI_TWINS = "off"     nobody
   Everyone else, including Googlebot and Bingbot, always gets the normal page.
   The twin says the same things as the page, so this changes the format, not the facts.
   Anything unexpected falls through to the normal site. */

// Names taken from each company's published crawler documentation. Search engines are
// deliberately absent: showing them different content from people is against their rules.
const AI_AGENTS = /GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|PerplexityBot|Perplexity-User/i;

function twinFor(pathname) {
  const path = pathname.replace(/\/+$/, "");
  if (path === "") return "/index.md";
  if (/\.[a-z0-9]+$/i.test(path)) return null;      // already a file: /ks.css, /fitness.md
  return path + ".md";
}

function wantsTwin(request, mode) {
  if (mode === "off") return false;
  if (/\btext\/markdown\b/i.test(request.headers.get("Accept") || "")) return true;
  return mode === "agents" && AI_AGENTS.test(request.headers.get("User-Agent") || "");
}

export default {
  async fetch(request, env) {
    try {
      const mode = env.AI_TWINS || "accept";
      if ((request.method === "GET" || request.method === "HEAD") && wantsTwin(request, mode)) {
        const url = new URL(request.url);
        const twin = twinFor(url.pathname);
        if (twin) {
          const found = await env.ASSETS.fetch(new Request(new URL(twin, url.origin), { method: request.method }));
          if (found.ok) {
            return new Response(found.body, {
              status: 200,
              headers: {
                "Content-Type": "text/markdown; charset=utf-8",
                "Cache-Control": "public, max-age=600",
                "Vary": "Accept, User-Agent",
                "Link": "<https://kitesink.com" + (url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "")) + '>; rel="canonical"',
                "X-KiteSink-Twin": twin
              }
            });
          }
        }
      }
    } catch (err) {
      // fall through to the normal site
    }
    return env.ASSETS.fetch(request);
  }
};
