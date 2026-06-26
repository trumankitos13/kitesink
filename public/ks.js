/* ===================== KiteSink shared chrome =====================
   Loaded on every page. Injects the shared header / footer / cream bar into
   [data-ks] placeholders, runs the live clock, and loads analytics — so the
   nav, footer, and tracking live in ONE place instead of being copied across
   every page. Page-unique chrome (the Vantix scroll-spy nav, the Campground
   game nav, the SOTD masthead) stays inline on those pages.

   Placeholders a page can use:
     <div data-ks="bar"></div>                         slim cream KiteSink bar
     <div data-ks="header" data-active="work"></div>   full Geist header (active: work|games|writing|about|"")
     <div data-ks="footer" data-active="…"></div>      shared footer (wordmark + nav + ©)
     <div data-ks="bottombar"></div>                   cream KiteSink bottom strip (project pages)
   ================================================================= */
(function () {
  "use strict";

  // Paste your Cloudflare Web Analytics token here to turn on analytics
  // (Cloudflare dashboard → Analytics & Logs → Web Analytics → add a site → copy the token).
  var CF_TOKEN = "";

  // Web3Forms access key for the site's forms (Vantix signup, Campground suggestion
  // box). Register the key at https://web3forms.com using suggestions@kitesink.com,
  // then paste it here — every form then emails there. Empty = friendly demo mode
  // (forms confirm to the visitor but send nothing).
  var KS_FORM_KEY = "";

  var NAV = [["Work", "/work.html", "work"], ["Games", "/games.html", "games"], ["Writing", "/blog.html", "writing"], ["About", "/about.html", "about"]];

  var LOGO30 = '<svg width="30" height="30" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><path d="M37 13 Q33 19 30 25" stroke="#5e5238" stroke-width="1.3" stroke-linecap="round"/><polygon points="46,3 55,13 46,23 37,13" fill="#b07227"/><line x1="46" y1="3" x2="46" y2="23" stroke="#ece2cb" stroke-width="1.3"/><line x1="37" y1="13" x2="55" y2="13" stroke="#ece2cb" stroke-width="1.3"/><path d="M46 23 Q49 27 46 31 Q43 35 46 39" stroke="#b07227" stroke-width="1.4" stroke-linecap="round"/><path d="M21 40 L21 28 Q21 25 24 25 L30 25" stroke="#2f5436" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="29" r="2.6" fill="#2f5436"/><path d="M16 31 L16 40" stroke="#2f5436" stroke-width="4" stroke-linecap="round"/><path d="M8 40 L44 40 L38 54 Q38 57 34 57 L18 57 Q14 57 14 54 Z" fill="#2f5436"/><ellipse cx="26" cy="40" rx="18" ry="4.6" fill="#3a6b46"/><ellipse cx="26" cy="40" rx="13.5" ry="3" fill="#23402b"/></svg>';
  var LOGO18 = '<svg width="18" height="18" viewBox="0 0 64 64" fill="none" style="flex-shrink:0"><polygon points="46,3 55,13 46,23 37,13" fill="#b07227"/><path d="M21 40 L21 28 Q21 25 24 25 L30 25" stroke="#2f5436" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 40 L44 40 L38 54 Q38 57 34 57 L18 57 Q14 57 14 54 Z" fill="#2f5436"/><ellipse cx="26" cy="40" rx="18" ry="4.6" fill="#3a6b46"/></svg>';

  function navFull(active) {
    return NAV.map(function (n) {
      var on = n[2] === active;
      var style = on ? 'color:#2f5436;border-bottom:2px solid #2f5436;padding-bottom:2px' : 'color:inherit;text-decoration:none';
      return '<a href="' + n[1] + '" class="' + (on ? '' : 'ks-nav-link') + '" style="' + style + '">' + n[0] + '</a>';
    }).join('');
  }
  function navBar(active) {
    return NAV.map(function (n) {
      var on = n[2] === active;
      return '<a href="' + n[1] + '" class="ks-link" style="color:' + (on ? '#2f5436' : 'inherit') + ';text-decoration:none">' + n[0] + '</a>';
    }).join('');
  }

  function header(active) {
    return '<header style="display:flex;justify-content:space-between;align-items:center;gap:14px 24px;flex-wrap:wrap;padding:16px clamp(20px,4vw,40px);border-bottom:1px solid rgba(34,28,16,.16);position:sticky;top:0;background:rgba(236,226,203,.85);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:30">' +
      '<a href="/" style="display:flex;align-items:center;gap:11px;text-decoration:none">' + LOGO30 +
        '<span style="font:800 19px \'Geist\',sans-serif;letter-spacing:-.035em;color:#221c10"><span style="color:#2f5436">Kite</span>Sink</span></a>' +
      '<nav style="display:flex;gap:clamp(16px,2.4vw,24px);font:500 13px \'Geist Mono\',monospace;color:#5e5238;flex-wrap:wrap">' + navFull(active) + '</nav>' +
      '<div style="display:flex;align-items:center;gap:9px;font:500 12px \'Geist Mono\',monospace;color:#2f5436">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:#2f5436;animation:ks-pulse 2.4s ease-in-out infinite"></span>' +
        '<span><span class="clock">--:--:--</span> · online</span></div>' +
    '</header>';
  }

  function bar(active) {
    return '<div style="position:sticky;top:0;z-index:1000;height:38px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 clamp(16px,4vw,40px);background:rgba(236,226,203,.94);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-bottom:1px solid rgba(34,28,16,.18);font-family:\'Geist\',-apple-system,system-ui,sans-serif;box-sizing:border-box">' +
      '<a href="/" class="ks-link" style="display:flex;align-items:center;gap:7px;color:#221c10;text-decoration:none">' + LOGO18 +
        '<span style="font:800 14px \'Geist\',sans-serif;letter-spacing:-.03em"><span style="color:#2f5436">Kite</span>Sink</span></a>' +
      '<nav style="display:flex;align-items:center;gap:clamp(12px,2.4vw,22px);font:500 12px \'Geist Mono\',ui-monospace,monospace;color:#5e5238">' + navBar(active) + '</nav>' +
    '</div>';
  }

  function footer(active) {
    return '<footer style="padding:clamp(40px,5vw,54px) clamp(20px,4vw,40px) 46px;max-width:1240px;margin:0 auto;border-top:1px solid rgba(34,28,16,.18)">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:30px;flex-wrap:wrap">' +
        '<div><div style="font:800 clamp(40px,6vw,72px)/.9 \'Geist\',sans-serif;letter-spacing:-.045em;color:#1d1810"><span style="color:#2f5436">Kite</span>Sink</div>' +
        '<p style="font:400 15px \'Geist\',sans-serif;color:#8a7a58;margin:14px 0 0;max-width:360px">Independent maker &amp; founder. One workshop, many surfaces.</p></div>' +
        '<nav style="display:flex;gap:16px;font:500 13px \'Geist Mono\',monospace;color:#2f5436;flex-wrap:wrap">' +
          '<a href="/" class="ks-nav-link">Home</a><a href="/work.html" class="ks-nav-link">Work</a><a href="/games.html" class="ks-nav-link">Games</a><a href="/blog.html" class="ks-nav-link">Writing</a><a href="/about.html" class="ks-nav-link">About</a>' +
        '</nav></div>' +
      '<div style="margin-top:30px;padding-top:18px;border-top:1px solid rgba(34,28,16,.18);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;font:400 12px \'Geist Mono\',monospace;color:#a89878">' +
        '<span>&copy; 2026 KiteSink — all rights reserved.</span>' +
        '<a href="/repost.html" rel="nofollow" title="New post / repost" class="ks-nav-link" style="color:#a89878">✎ compose</a>' +
      '</div></footer>';
  }

  function bottomBar() {
    return '<div style="background:#ece2cb;border-top:1px solid rgba(34,28,16,.18);padding:16px clamp(16px,4vw,40px);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-family:\'Geist Mono\',ui-monospace,monospace;font-size:12px;color:#8a7a58">' +
      '<span style="display:flex;align-items:center;gap:8px">' + LOGO18.replace('width="18" height="18"', 'width="15" height="15"') + '<span style="color:#221c10">&copy; 2026 KiteSink</span></span>' +
      '<span style="display:flex;gap:16px;flex-wrap:wrap"><a href="/" class="ks-link" style="color:#5e5238;text-decoration:none">Home</a><a href="/blog.html" class="ks-link" style="color:#5e5238;text-decoration:none">Blog</a><a href="/about.html" class="ks-link" style="color:#5e5238;text-decoration:none">About</a></span>' +
    '</div>';
  }

  function startClock() {
    var els = document.querySelectorAll(".clock");
    if (!els.length) return;
    function tick() {
      var t = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
      for (var i = 0; i < els.length; i++) els[i].textContent = t;
    }
    tick(); setInterval(tick, 1000);
  }

  function loadAnalytics() {
    if (!CF_TOKEN) return;
    var s = document.createElement("script");
    s.defer = true; s.src = "https://static.cloudflareinsights.com/beacon.min.js";
    s.setAttribute("data-cf-beacon", JSON.stringify({ token: CF_TOKEN }));
    document.head.appendChild(s);
  }

  // Shared form submit → Web3Forms → the inbox that registered KS_FORM_KEY.
  // payload: flat field object (e.g. {subject, email, message, from_name}). cb(err, data).
  // Honeypot: if payload.botcheck is truthy the submit is silently skipped. In demo
  // mode (no key) it calls cb(null,{demo:true}) so the page can still confirm to the user.
  function ksSubmitForm(payload, cb) {
    cb = cb || function () {};
    payload = payload || {};
    if (payload.botcheck) { cb(null, { skipped: true }); return; }
    if (!KS_FORM_KEY) { cb(null, { demo: true }); return; }
    var body = { access_key: KS_FORM_KEY };
    for (var k in payload) { if (payload.hasOwnProperty(k) && k !== "botcheck") body[k] = payload[k]; }
    if (!body.subject) body.subject = "New KiteSink form submission";
    fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.success) cb(null, d); else cb(new Error((d && d.message) || "submit failed"));
    }).catch(cb);
  }
  window.ksSubmitForm = ksSubmitForm;

  function inject() {
    var nodes = document.querySelectorAll("[data-ks]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i], kind = el.getAttribute("data-ks"), active = el.getAttribute("data-active") || "";
      if (kind === "header") el.outerHTML = header(active);
      else if (kind === "bar") el.outerHTML = bar(active);
      else if (kind === "footer") el.outerHTML = footer(active);
      else if (kind === "bottombar") el.outerHTML = bottomBar();
    }
    startClock();
    loadAnalytics();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
})();
