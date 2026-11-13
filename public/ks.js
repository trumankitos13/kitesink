/* ===================== KiteSink shared chrome =====================
   Loaded on every page. Injects the shared header / footer / slim bar into
   [data-ks] placeholders, adds the mobile pill nav and the Find palette,
   runs the live clock, and loads analytics — so the nav, footer, and
   tracking live in ONE place instead of being copied across every page.
   Page-unique chrome (the Vantix scroll-spy nav, the Campground game nav,
   the SOTD masthead) stays inline on those pages.

   Placeholders a page can use:
     <div data-ks="header" data-active="fitness"></div>   full header
     <div data-ks="footer"></div>                          shared footer
     <div data-ks="bar" data-active="music"></div>         slim KiteSink bar (project pages)
     <div data-ks="bottombar"></div>                       cream bottom strip (project pages)
     <div data-ks="page" data-active="music"></div>        no chrome, just the pill nav + active state

   data-active is one of the five sections below. The older values still
   work and are mapped onto their new home (work/games/writing → library,
   club → music, now → about), so legacy pages need no edits.

   The site map itself (every page, tool and project) lives in
   /site-index.js — the Find palette, the Library page and the home page
   all read that one list.
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
  var KS_FORM_KEY = "f164a9ec-56c5-4caa-9898-d238812f2073";

  // Status shown next to the live clock in the header & footer.
  // Options from the design: "online" | "in the workshop" | "heads down" | "open to work"
  var KS_STATUS = "online";

  // The release of the shared files. It must match the ?v= on every page's
  // ks.css / ks.js / site-index.js tags (scripts/check_site.py checks), so a
  // file fetched from here and the same file named by a page are one cache entry.
  var ASSET_V = "2027.4";

  // The five sections. Order = nav order. `quiet` renders Library understated:
  // always reachable, never the loudest thing on the page.
  var SECTIONS = [
    { id: "consulting", label: "Consulting", href: "/consulting" },
    { id: "fitness",    label: "Fitness",    href: "/fitness" },
    { id: "music",      label: "Music",      href: "/music" },
    { id: "library",    label: "Library",    href: "/library", quiet: true },
    { id: "about",      label: "About",      href: "/about" }
  ];
  var ALIAS = { work: "library", games: "library", writing: "library", blog: "library", club: "music", now: "about" };
  // A page can name its section with data-active; when it doesn't (the slim bar
  // on project pages), work it out from the URL.
  var BY_PATH = [[/^\/(vantix|fitness)/, "fitness"], [/^\/(song-of-the-day|backline|listening-club|music)/, "music"], [/^\/consulting/, "consulting"],
                 [/^\/(campground-tycoon|blog|work|games|library|colophon)/, "library"], [/^\/(about|now|uses)/, "about"]];
  function sectionOf(active) {
    if (active) return ALIAS[active] || active;
    for (var i = 0; i < BY_PATH.length; i++) if (BY_PATH[i][0].test(location.pathname)) return BY_PATH[i][1];
    return "";
  }

  var IS_MAC = /Mac|iPhone|iPad/.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "");

  function logo(size) {
    return '<svg class="ks-logo" width="' + size + '" height="' + size + '" viewBox="0 0 64 64" fill="none" aria-hidden="true">' +
      '<path d="M37 13 Q33 19 30 25" stroke="#5e5238" stroke-width="1.3" stroke-linecap="round"/>' +
      '<polygon points="46,3 55,13 46,23 37,13" fill="#b07227"/>' +
      '<line x1="46" y1="3" x2="46" y2="23" stroke="#ece2cb" stroke-width="1.3"/><line x1="37" y1="13" x2="55" y2="13" stroke="#ece2cb" stroke-width="1.3"/>' +
      '<path d="M46 23 Q49 27 46 31 Q43 35 46 39" stroke="#b07227" stroke-width="1.4" stroke-linecap="round"/>' +
      '<path class="lgs" d="M21 40 L21 28 Q21 25 24 25 L30 25" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle class="lg" cx="16" cy="29" r="2.6"/><path class="lgs" d="M16 31 L16 40" stroke-width="4" stroke-linecap="round"/>' +
      '<path class="lg" d="M8 40 L44 40 L38 54 Q38 57 34 57 L18 57 Q14 57 14 54 Z"/>' +
      '<ellipse class="lgl" cx="26" cy="40" rx="18" ry="4.6"/><ellipse class="lgd" cx="26" cy="40" rx="13.5" ry="3"/></svg>';
  }
  var ICON_FIND = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/></svg>';

  function brand(size) {
    return '<a class="ks-brand" href="/" aria-label="KiteSink — home">' + logo(size) + '<span><b>Kite</b>Sink</span></a>';
  }
  function navLinks(active) {
    var sec = sectionOf(active);
    return SECTIONS.map(function (s) {
      var on = s.id === sec;
      return '<a href="' + s.href + '"' + (s.quiet ? ' class="is-quiet"' : '') + (on ? ' aria-current="page"' : '') + '>' + s.label + '</a>';
    }).join('');
  }
  function status() {
    return '<span class="ks-status"><i></i><span><span class="clock">--:--:--</span> · ' + KS_STATUS + '</span></span>';
  }

  function header(active) {
    return '<header class="ks-hd">' + brand(30) +
      '<nav class="ks-nav" aria-label="Primary">' + navLinks(active) + '</nav>' +
      '<div class="ks-tools">' +
        '<button class="ks-findbtn" type="button" data-ks-find aria-haspopup="dialog" aria-label="Find anything on the site">' + ICON_FIND +
          '<span>Find</span><kbd class="ks-kbd">' + (IS_MAC ? '⌘K' : 'Ctrl K') + '</kbd></button>' +
        '<button class="ks-theme-toggle" type="button" aria-label="Toggle dark mode"></button>' +
        status() +
      '</div></header>';
  }

  function bar(active) {
    return '<div class="ks-bar">' + brand(18) +
      '<nav class="ks-barnav" aria-label="KiteSink">' + navLinks(active) +
      '<button type="button" data-ks-find aria-haspopup="dialog" aria-label="Find anything on KiteSink">' + ICON_FIND + '</button></nav></div>';
  }

  function col(title, links) {
    return '<div class="ks-ft-col"><h2>' + title + '</h2>' + links.map(function (l) {
      return '<a href="' + l[1] + '"' + (l[2] ? ' target="_blank" rel="noopener"' : '') + '>' + l[0] + '</a>';
    }).join('') + '</div>';
  }
  function footer() {
    return '<footer class="ks-ft"><div class="ks-ft-in">' +
      '<div class="ks-ft-top">' +
        '<div><div class="ks-ft-word"><b>Kite</b>Sink</div>' +
          '<div class="ks-ft-me"><picture><source srcset="/img/pin-avatar-80.avif" type="image/avif"><source srcset="/img/pin-avatar-80.webp" type="image/webp">' +
          '<img src="/img/pin-avatar.jpg" alt="Truman" width="40" height="40" loading="lazy" decoding="async"></picture>' +
          '<p>Independent maker &amp; founder. One workshop, many surfaces — built &amp; maintained by one person.</p></div></div>' +
        '<div class="ks-ft-cols">' +
          col("Sections", SECTIONS.map(function (s) { return [s.label, s.href]; })) +
          col("Current", [["Vantix", "/vantix"], ["Fitness tools", "/fitness#tools"], ["Song of the Day", "/song-of-the-day"], ["Backline", "/backline"], ["Listening Club", "/listening-club"]]) +
          col("Library", [["Full index", "/library"], ["Games", "/games"], ["Writing", "/blog"], ["Now", "/now"], ["Uses", "/uses"], ["Colophon", "/colophon"]]) +
          col("Elsewhere", [["hello@kitesink.com", "mailto:hello@kitesink.com"], ["GitHub", "https://github.com/trumankitos13", 1], ["YouTube", "https://www.youtube.com/@rummaging13", 1], ["Bluesky", "https://bsky.app/profile/signal-shift.bsky.social", 1], ["Atom feed", "/feed.xml"]]) +
        '</div>' +
      '</div>' +
      '<div class="ks-ft-base"><span>&copy; 2026 KiteSink — all rights reserved.</span>' + status() +
        '<a href="/repost" rel="nofollow" title="New post / repost">✎ compose</a></div>' +
    '</div></footer>';
  }

  function bottomBar() {
    return '<div class="ks-bottombar"><span style="display:flex;align-items:center;gap:8px">' + logo(15) + '<span>&copy; 2026 KiteSink</span></span>' +
      '<span style="display:flex;gap:16px;flex-wrap:wrap"><a href="/">Home</a><a href="/library">Library</a><a href="/about">About</a></span></div>';
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

  // Floating mobile pill nav (shown ≤700px via ks.css; the top nav hides there).
  // The five sections; the wordmark in the header is the way home.
  function pillNav(active) {
    var sec = sectionOf(active);
    var nav = document.createElement("nav");
    nav.className = "ks-pillnav";
    nav.setAttribute("aria-label", "Sections, bottom bar");
    nav.innerHTML = SECTIONS.map(function (s) {
      return '<a href="' + s.href + '"' + (s.id === sec ? ' class="on" aria-current="page"' : '') + '>' + s.label + '</a>';
    }).join('');
    document.body.appendChild(nav);
    var current = nav.querySelector(".on");
    if (current) nav.scrollLeft = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
    document.body.classList.add("ks-haspill");
  }

  // ---- Night mode: follows the system (prefers-color-scheme) by default; the
  // header toggle stores an override in localStorage.ksTheme. Picking the side
  // the system is already on clears the override, so the page goes back to
  // auto-following. The dark palette lives in ks.css (html[data-theme="dark"]);
  // a pre-paint snippet in each cream page's <head> mirrors this resolution so
  // there's no flash. Cream pages only (body.ks-paper) — the product pages
  // art-direct their own palettes. ----
  function ksSysDark() { try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { return false; } }
  function ksStored() { try { var s = localStorage.getItem("ksTheme"); return s === "dark" || s === "light" ? s : null; } catch (e) { return null; } }
  function ksTheme() { return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
  function ksThemeIcon(dark) {
    return dark
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.1"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4l1.4-1.4M18 6l1.4-1.4"/></svg>'
      : '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.5 14.8A8.2 8.2 0 1 1 9.2 3.5a8 8 0 0 0 11.3 11.3z"/></svg>';
  }
  function ksPaintToggle() {
    var dark = ksTheme() === "dark", btns = document.querySelectorAll(".ks-theme-toggle");
    for (var i = 0; i < btns.length; i++) { btns[i].innerHTML = ksThemeIcon(dark); btns[i].setAttribute("aria-pressed", dark ? "true" : "false"); btns[i].setAttribute("title", dark ? "Switch to light" : "Switch to dark"); }
  }
  function ksApplyTheme(t) {
    if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#16130d" : "#ece2cb");
    ksPaintToggle();
  }
  function ksSaveTheme(t) {
    try {
      if ((t === "dark") === ksSysDark()) localStorage.removeItem("ksTheme"); // matches the system → back to auto
      else localStorage.setItem("ksTheme", t);
    } catch (e) {}
  }
  function initTheme() {
    if (!document.body || !document.body.classList.contains("ks-paper")) return;
    ksApplyTheme(ksStored() || (ksSysDark() ? "dark" : "light"));
    var btns = document.querySelectorAll(".ks-theme-toggle");
    for (var i = 0; i < btns.length; i++) btns[i].addEventListener("click", function () {
      var next = ksTheme() === "dark" ? "light" : "dark";
      ksApplyTheme(next); ksSaveTheme(next);
    });
    window.addEventListener("storage", function (e) {
      if (e.key === "ksTheme") ksApplyTheme(e.newValue === "dark" || (e.newValue !== "light" && ksSysDark()) ? "dark" : "light");
    });
    try {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      var onSys = function (ev) { if (!ksStored()) ksApplyTheme(ev.matches ? "dark" : "light"); };
      if (mq.addEventListener) mq.addEventListener("change", onSys); else if (mq.addListener) mq.addListener(onSys);
    } catch (e) {}
  }

  // ---- The site index + search (shared by the Find palette, /library, and home) ----
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function loadScript(src, done) {
    var s = document.createElement("script");
    s.src = src; s.onload = function () { done(); }; s.onerror = function () { done(); };
    document.head.appendChild(s);
  }
  var indexCache = null, indexWaiters = null;
  // loadIndex(cb): cb(items, ok) — ok is false when /site-index.js could not be loaded. Items are /site-index.js entries plus the blog
  // posts from /blog/posts.js, both fetched on first use and then cached.
  function loadIndex(cb) {
    if (indexCache) { cb(indexCache, true); return; }
    if (indexWaiters) { indexWaiters.push(cb); return; }
    indexWaiters = [cb];
    var pending = 0;
    function finish() {
      if (--pending > 0) return;
      var items = (window.KS_INDEX || []).slice();
      (window.KS_POSTS || []).forEach(function (p) {
        var ext = !!p.external;
        items.push({ t: p.title, h: ext ? p.url : p.href, s: "library", k: ext ? "Reading" : "Writing", d: p.dek || "", w: [].concat(p.cat || []).join(" ") + " " + (p.source || "") + " blog log post essay", ext: ext, date: p.date });
      });
      var ok = !!window.KS_INDEX;   // posts alone are not the index
      if (ok) indexCache = items;   // a failed load is not remembered, so the next call tries again
      var w = indexWaiters; indexWaiters = null;
      w.forEach(function (fn) { fn(items, ok); });
    }
    var need = [];
    if (!window.KS_INDEX) need.push("/site-index.js?v=" + ASSET_V);
    if (!window.KS_POSTS) need.push("/blog/posts.js");
    if (!need.length) { pending = 1; finish(); return; }
    pending = need.length;
    need.forEach(function (src) { loadScript(src, finish); });
  }
  // search(items, query) → ranked matches. Every word must match somewhere;
  // title hits outrank description / keyword hits.
  function search(items, query) {
    var terms = norm(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return items.slice();
    var out = [];
    items.forEach(function (it, i) {
      var title = norm(it.t), hay = title + " " + norm(it.d) + " " + norm(it.w) + " " + norm(it.k) + " " + norm(it.s), sc = 0;
      for (var j = 0; j < terms.length; j++) {
        var term = terms[j];
        if (hay.indexOf(term) < 0) return;
        if (title.indexOf(term) === 0) sc += 6;
        else if (title.indexOf(" " + term) >= 0) sc += 4;
        else if (title.indexOf(term) >= 0) sc += 3;
        else sc += 1;
      }
      if (it.k === "Section") sc += .6;
      if (it.now) sc += .4;
      out.push({ it: it, sc: sc, i: i });
    });
    out.sort(function (a, b) { return b.sc - a.sc || a.i - b.i; });
    return out.map(function (o) { return o.it; });
  }
  function sectionLabel(id) {
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].id === id) return SECTIONS[i].label;
    return "";
  }

  // ---- Find palette: ⌘K / Ctrl K / "/" or any [data-ks-find] button ----
  var find = null;
  function buildFind() {
    var dlg = document.createElement("dialog");
    dlg.className = "ks-find";
    dlg.setAttribute("aria-label", "Find anything on KiteSink");
    dlg.innerHTML =
      '<div class="ks-find-top">' + ICON_FIND +
        '<input class="ks-find-in" type="search" placeholder="Find a project, tool or page…" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" role="combobox" aria-expanded="true" aria-controls="ks-find-list" aria-autocomplete="list" aria-label="Find anything on KiteSink">' +
        '<button class="ks-find-x" type="button" aria-label="Close">esc</button></div>' +
      '<ul class="ks-find-list" id="ks-find-list" role="listbox" aria-label="Results"></ul>' +
      '<p class="k-vh" role="status"></p>' +
      '<div class="ks-find-foot"><span>↑↓ to move · ↵ to open</span><a href="/library">Browse the full library →</a></div>';
    document.body.appendChild(dlg);
    var input = dlg.querySelector(".ks-find-in"), list = dlg.querySelector(".ks-find-list"), items = [], shown = [], cur = 0, loaded = false, indexOk = false, sayT = null;
    var status = dlg.querySelector('[role="status"]');

    function row(it, i) {
      return '<li role="option" id="ks-find-o' + i + '" aria-selected="' + (i === cur) + '"' + (i === cur ? ' class="on"' : '') + '>' +
        '<a href="' + esc(it.h) + '"' + (it.ext ? ' target="_blank" rel="noopener"' : '') + ' tabindex="-1">' +
        '<span class="t">' + esc(it.t) + (it.ext ? ' ↗' : '') + '</span><span class="s">' + esc(sectionLabel(it.s) + (it.k && it.k !== "Section" ? ' · ' + it.k : '')) + '</span>' +
        (it.d ? '<span class="d">' + esc(it.d) + '</span>' : '') + '</a></li>';
    }
    function render() {
      var q = input.value.trim(), html = "";
      if (!loaded || !indexOk) {   // still fetching, or /site-index.js did not arrive
        shown = [];
        list.innerHTML = '<li class="ks-find-empty">' + (loaded ? 'The index didn’t load. <a href="/library" style="display:inline;padding:0;color:var(--k-green);text-decoration:underline">Open the library</a> instead, or close this and try again.' : 'Loading the index…') + '</li>';
        input.removeAttribute("aria-activedescendant");
        return;
      }
      if (!q) {
        // Nothing typed: the five sections, then what's current.
        var secs = items.filter(function (it) { return it.k === "Section"; });
        var now = items.filter(function (it) { return it.now && it.k !== "Section"; });
        shown = secs.concat(now);
        cur = Math.min(cur, shown.length - 1);
        html = '<li class="ks-find-group" role="presentation">Sections</li>' + secs.map(row).join("") +
               '<li class="ks-find-group" role="presentation">Current</li>' + now.map(function (it, i) { return row(it, i + secs.length); }).join("");
      } else {
        shown = search(items, q).slice(0, 14);
        cur = Math.min(cur, Math.max(0, shown.length - 1));
        html = shown.length ? shown.map(row).join("")
          : '<li class="ks-find-empty">Nothing matches “' + esc(q) + '”. The <a href="/library" style="display:inline;padding:0;color:var(--k-green);text-decoration:underline">library</a> lists everything.</li>';
      }
      list.innerHTML = html;
      if (shown.length) input.setAttribute("aria-activedescendant", "ks-find-o" + cur); else input.removeAttribute("aria-activedescendant");
      clearTimeout(sayT); // tell screen-reader users how the search went, once typing pauses
      if (q) sayT = setTimeout(function () { status.textContent = shown.length ? shown.length + (shown.length === 1 ? " result" : " results") : "No results"; }, 500);
      else status.textContent = "";
    }
    function move(d) {
      if (!shown.length) return;
      cur = (cur + d + shown.length) % shown.length;
      render();
      var on = list.querySelector("li.on");
      if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
    }
    function go() {
      var it = shown[cur];
      if (!it) return;
      dlg.close();
      if (it.ext) window.open(it.h, "_blank", "noopener"); else location.href = it.h;
    }
    input.addEventListener("input", function () { cur = 0; render(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); go(); }
      else if (e.key === "Escape") { e.preventDefault(); dlg.close(); } // a search field's own Esc only clears the text
    });
    dlg.querySelector(".ks-find-x").addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); }); // click the backdrop
    list.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("a")) dlg.close(); });
    return {
      open: function (prefill) {
        if (dlg.open) return;
        input.value = prefill || ""; cur = 0;
        if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
        render(); input.focus();
        loadIndex(function (all, ok) { items = all; loaded = true; indexOk = ok; render(); });
      }
    };
  }
  function openFind(prefill) {
    if (!find) find = buildFind();
    find.open(typeof prefill === "string" ? prefill : "");
  }
  function initFind() {
    document.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("[data-ks-find]");
      if (t) { e.preventDefault(); openFind(); }
    });
    document.addEventListener("keydown", function (e) {
      var k = (e.key || "").toLowerCase();
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && k === "k") { e.preventDefault(); openFind(); return; }
      if (k === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        var el = document.activeElement, tag = el && el.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el && el.isContentEditable)) return;
        e.preventDefault(); openFind();
      }
    });
  }

  // Prefetch same-site pages on hover/touch-start so section hops feel quick
  // (Chromium's Speculation Rules; everything else just ignores the tag).
  // Prefetch, not prerender: a prerendered page runs its scripts before anyone
  // sees it, which would count page views that never happened once analytics is on.
  function speculate() {
    try {
      if (!(HTMLScriptElement.supports && HTMLScriptElement.supports("speculationrules"))) return;
      var s = document.createElement("script");
      s.type = "speculationrules";
      s.textContent = JSON.stringify({ prefetch: [{ where: { and: [{ href_matches: "/*" }, { not: { href_matches: "/repost*" } }, { not: { selector_matches: "[target=_blank],[download]" } }] }, eagerness: "moderate" }] });
      document.head.appendChild(s);
    } catch (e) {}
  }

  // Scroll-spy for a hub page's in-page nav (.k-subnav): marks the link whose
  // section holds a reference line a quarter of the way down the viewport.
  function initSpy() {
    var nav = document.querySelector(".k-subnav");
    if (!nav) return;
    var links = [].slice.call(nav.querySelectorAll('a[href^="#"]')), pairs = [], current = null, queued = false;
    links.forEach(function (a) { var el = document.getElementById(a.getAttribute("href").slice(1)); if (el) pairs.push([el, a]); });
    if (!pairs.length) return;
    function update() {
      queued = false;
      var line = window.innerHeight * 0.26, hit = null;
      for (var i = 0; i < pairs.length; i++) if (pairs[i][0].getBoundingClientRect().top <= line) hit = pairs[i][1];
      if (hit === current) return;
      if (current) { current.classList.remove("on"); current.removeAttribute("aria-current"); }
      current = hit;
      if (!hit) return;
      hit.classList.add("on"); hit.setAttribute("aria-current", "true");
      var row = hit.parentNode;
      if (row.scrollWidth > row.clientWidth) row.scrollBy({ left: hit.getBoundingClientRect().left - row.getBoundingClientRect().left - (row.clientWidth - hit.offsetWidth) / 2, behavior: "smooth" });
    }
    function queue() { if (!queued) { queued = true; requestAnimationFrame(update); } }
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    update();
  }

  function inject() {
    var nodes = document.querySelectorAll("[data-ks]");
    var pageActive = null;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i], kind = el.getAttribute("data-ks"), active = el.getAttribute("data-active") || "";
      if (kind === "page") {
        if (pageActive === null) pageActive = active;
        el.remove();
      }
      else if (kind === "header" || kind === "footer") {
        if (pageActive === null) pageActive = active;
        if (kind === "header") el.outerHTML = header(active);
        else el.outerHTML = footer();
      }
      else if (kind === "bar") el.outerHTML = bar(active);
      else if (kind === "bottombar") el.outerHTML = bottomBar();
    }
    if (pageActive !== null) pillNav(pageActive);
    startClock();
    initTheme();
    initFind();
    initSpy();
    speculate();
    loadAnalytics();
  }

  window.KS = { sections: SECTIONS, loadIndex: loadIndex, search: search, openFind: openFind, sectionLabel: sectionLabel, esc: esc };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
})();
