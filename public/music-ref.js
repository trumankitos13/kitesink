/* ===================== KiteSink — the music field guide pages =====================
   Loaded by the pages under /music/ (an area, the claims, the glossary, the reference index,
   the sources, the claimable royalties, the tools) after /ks.js, and by the /music hub once it is generated. A fork of
   /fitness-ref.js: the music guide filters by reader and territory, and grades entries
   law | official | reported | practice, shown as Sourced or Directional.

   Every entry, table and source is already in the page (scripts/build_music.py writes it),
   so nothing here adds content. It only:
     - filters, searches and sorts the lists (guidance, steps and mistakes, claims, terms, sources,
       the claimable royalties, the tools directory)
     - presets the reader and territory filters from the address (?reader=writer&territory=UK),
       which is how the hub's five reader paths link in
     - sorts a numbers table by its column headings
     - remembers checklist ticks (localStorage "ksMusic", under "ck")
     - folds the list of sources, and opens it when a source link is followed
     - opens the entry named in the address (/music/mechanicals-mlc#mech-…)
     - on the hub, runs the search box over /music/search.json
   Each page has only some of these, so every block looks for its own markup first.
   The rate calculator and the unclaimed-money checklist are /music-tools.js.
   ================================================================================== */
(function () {
  "use strict";

  var AREAS = (document.body.getAttribute("data-areas") || "").split(" ");
  var CONF = ["law", "official", "reported", "practice"], LEVEL = ["beginner", "intermediate", "advanced"];
  var VERD = ["true", "mostly", "depends", "overstated", "false"];
  var WHEN = ["before-release", "at-release", "after-release", "yearly", "on-dispute"];

  function $(id) { return document.getElementById(id); }
  function all(sel, root) { return root ? [].slice.call(root.querySelectorAll(sel)) : []; }
  function attr(el, name) { return el.getAttribute("data-" + name) || ""; }
  function rank(list, v) { var i = list.indexOf(v); return i < 0 ? 99 : i; }
  function words(input) { return input ? input.value.toLowerCase().split(/\s+/).filter(Boolean) : []; }
  function byOrder(a, b) { return attr(a, "o") - attr(b, "o"); }
  function reorder(parent, els, cmp) { els.slice().sort(function (a, b) { return cmp(a, b) || byOrder(a, b); }).forEach(function (el) { parent.appendChild(el); }); }
  function eq(name) { return function (el, v) { return attr(el, name) === v; }; }
  function has(name) { return function (el, v) { return (" " + attr(el, name) + " ").indexOf(" " + v + " ") >= 0; }; }
  // An entry for that territory, or one marked International (true everywhere).
  function inTerritory(el, v) { var t = " " + attr(el, "tr") + " "; return t.indexOf(" " + v + " ") >= 0 || (v !== "INTL" && t.indexOf(" INTL ") >= 0); }
  function title(el) { var t = el.querySelector(".g-title") || el.querySelector("summary") || el; return t.textContent.toLowerCase(); }
  function byTitle(a, b) { return title(a) < title(b) ? -1 : title(a) > title(b) ? 1 : 0; }
  function boot(fn) { try { fn(); } catch (err) { if (window.console) console.error("A music list failed to start:", err); } }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var store = {
    get: function () { try { return JSON.parse(localStorage.getItem("ksMusic") || "{}") || {}; } catch (e) { return {}; } },
    set: function (patch) { try { var s = store.get(); for (var k in patch) s[k] = patch[k]; localStorage.setItem("ksMusic", JSON.stringify(s)); } catch (e) {} }
  };

  // ?reader=writer&territory=UK, read once: the filters a list starts with.
  var PRESET = {};
  (function () {
    var q = location.search.replace(/^\?/, "").split("&");
    q.forEach(function (pair) { var kv = pair.split("="); if (kv[0] && kv[1]) PRESET[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]); });
  })();

  /* ---------- a filterable list ----------
     cfg: items, noun, q (search box), count, empty, active, and facets {name: {el, test(el, value)}}.
     A facet is a group of buttons, one pressed at a time; "all" is no filter. */
  var lists = [];
  function makeList(cfg) {
    var rows = cfg.items.map(function (el) { return { el: el, text: el.textContent.toLowerCase() }; });
    var facets = {}, state = {};
    Object.keys(cfg.facets || {}).forEach(function (n) { if (cfg.facets[n].el) { facets[n] = cfg.facets[n]; state[n] = "all"; } });
    var names = Object.keys(facets);
    // a preset applies only when the page offers that choice
    names.forEach(function (n) { var v = PRESET[n]; if (v && facets[n].el.querySelector('button[value="' + v.replace(/"/g, "") + '"]')) state[n] = v; });
    function ok(r, skip, w) {
      for (var i = 0; i < names.length; i++) { var n = names[i]; if (n !== skip && state[n] !== "all" && !facets[n].test(r.el, state[n])) return false; }
      for (var j = 0; j < w.length; j++) if (r.text.indexOf(w[j]) < 0) return false;
      return true;
    }
    function apply() {
      var w = words(cfg.q), shown = 0;
      rows.forEach(function (r) { var v = ok(r, null, w); r.el.hidden = !v; if (v) shown++; });
      names.forEach(function (n) {
        all("button", facets[n].el).forEach(function (b) {
          b.setAttribute("aria-pressed", b.value === state[n] ? "true" : "false");
          var c = b.querySelector("b"); if (!c) return;
          var k = 0; rows.forEach(function (r) { if (ok(r, n, w) && facets[n].test(r.el, b.value)) k++; });
          c.textContent = k; b.classList.toggle("is-zero", k === 0);
        });
      });
      var active = names.filter(function (n) { return state[n] !== "all"; }).length + (w.length ? 1 : 0);
      if (cfg.count) {
        cfg.count.textContent = "Showing " + shown + " of " + rows.length + " " + cfg.noun + (active ? ". " : "");
        if (active) {
          var x = document.createElement("button"); x.type = "button"; x.className = "k-linkbtn"; x.textContent = "Clear filters";
          x.addEventListener("click", function () { api.reset(); apply(); cfg.count.setAttribute("tabindex", "-1"); cfg.count.focus({ preventScroll: true }); });
          cfg.count.appendChild(x);
        }
      }
      if (cfg.empty) cfg.empty.hidden = shown !== 0;
      if (cfg.active) cfg.active.textContent = active ? "· " + active + " on" : "";
      if (cfg.after) cfg.after();
    }
    names.forEach(function (n) {
      facets[n].el.addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b || !facets[n].el.contains(b)) return; state[n] = b.value; apply(); });
    });
    if (cfg.q) cfg.q.addEventListener("input", apply);
    var api = { apply: apply, reset: function () { names.forEach(function (n) { state[n] = "all"; }); if (cfg.q) cfg.q.value = ""; } };
    lists.push(api);
    return api;
  }
  function facetIn(root, name) { return root ? root.querySelector('[data-facet="' + name + '"]') : null; }
  function people(root) {
    return {
      reader: { el: facetIn(root, "reader"), test: has("r") },
      territory: { el: facetIn(root, "territory"), test: inTerritory },
      support: { el: facetIn(root, "support"), test: eq("s") }
    };
  }
  function newest(a, b) { return attr(b, "y") - attr(a, "y"); }
  function byConf(a, b) { return rank(CONF, attr(a, "c")) - rank(CONF, attr(b, "c")); }

  /* ---------- guidance, steps and mistakes (an area page) ---------- */
  boot(function () {
    var box = $("g-list"); if (!box) return;
    var items = all("details.g", box), rail = $("g-rail"), sort = $("g-sort"), open = $("g-open");
    var f = people(rail);
    f.topic = { el: facetIn(rail, "topic"), test: eq("tp") };
    f.kind = { el: facetIn(rail, "kind"), test: eq("k") };
    f.level = { el: facetIn(rail, "level"), test: eq("l") };
    var list = makeList({ items: items, noun: "entries", q: $("g-q"), count: $("g-count"), empty: $("g-empty"), active: $("g-active"), facets: f });
    if (sort) sort.addEventListener("change", function () {
      reorder(box, items, {
        suggested: function () { return 0; },
        az: byTitle,
        conf: byConf,
        level: function (a, b) { return rank(LEVEL, attr(a, "l")) - rank(LEVEL, attr(b, "l")); },
        when: function (a, b) { return rank(WHEN, attr(a, "w")) - rank(WHEN, attr(b, "w")); },
        newest: newest
      }[sort.value] || function () { return 0; });
      list.apply();
    });
    if (open) open.addEventListener("click", function () {
      var on = open.getAttribute("aria-pressed") !== "true";
      open.setAttribute("aria-pressed", on ? "true" : "false"); open.textContent = on ? "Close all" : "Open all";
      items.forEach(function (el) { if (!el.hidden || !on) el.open = on; });
    });
  });

  /* ---------- claims ---------- */
  boot(function () {
    var box = $("q-list"); if (!box) return;
    var items = all("details.q", box), ctl = $("q-controls"), sort = $("q-sort");
    var f = people(ctl);
    f.area = { el: facetIn(ctl, "area"), test: eq("d") };
    f.verdict = { el: facetIn(ctl, "verdict"), test: eq("v") };
    f.tag = { el: facetIn(ctl, "tag"), test: has("tags") };
    makeList({ items: items, noun: "claims", q: $("q-q"), count: $("q-count"), empty: $("q-empty"), active: $("q-active"), facets: f });
    if (sort) sort.addEventListener("change", function () {
      reorder(box, items, {
        suggested: function () { return 0; },
        verdict: function (a, b) { return rank(VERD, attr(a, "v")) - rank(VERD, attr(b, "v")); },
        "verdict-rev": function (a, b) { return rank(VERD, attr(b, "v")) - rank(VERD, attr(a, "v")); },
        az: byTitle,
        conf: byConf,
        newest: newest
      }[sort.value] || function () { return 0; });
    });
  });

  /* ---------- glossary ---------- */
  boot(function () {
    var box = $("gl-list"); if (!box) return;
    makeList({
      items: all(".gl-item", box), noun: "terms", q: $("gl-q"), count: $("gl-count"), empty: $("gl-empty"),
      facets: { area: { el: facetIn(box.parentNode, "area"), test: eq("d") } }
    });
  });

  /* ---------- claimable royalties ---------- */
  boot(function () {
    var box = $("cl-list"); if (!box) return;
    var f = people($("cl-rail"));
    delete f.support;
    f.money = { el: facetIn($("cl-rail"), "money"), test: eq("mt") };
    makeList({ items: all("article.cl", box), noun: "places", q: $("cl-q"), count: $("cl-count"), empty: $("cl-empty"), active: $("cl-active"), facets: f });
  });

  /* ---------- the tools directory: a group whose tools are all filtered out hides its heading ---------- */
  boot(function () {
    var box = $("ot-list"); if (!box) return;
    var f = people($("ot-rail"));
    delete f.support;
    makeList({
      items: all("li.ot", box), noun: "tools", count: $("ot-count"), empty: $("ot-empty"), active: $("ot-active"), facets: f,
      after: function () { all(".ot-g", box).forEach(function (g) { g.hidden = !all("li.ot", g).some(function (el) { return !el.hidden; }); }); }
    });
  });

  /* ---------- the full list of sources (the sources page has a search box) ---------- */
  boot(function () {
    var q = $("src-q"), box = $("src-list"); if (!q || !box) return;
    makeList({ items: all("li", box), noun: "sources", q: q, count: $("src-count"), empty: $("src-empty") });
  });

  /* ---------- a numbers table: the column headings sort it ----------
     data-sort: n the number (data-n), c the grade (data-c), d the area (data-d), y the date
     (data-y); anything else sorts by the text of that column. */
  boot(function () {
    var table = $("n-table"); if (!table || !table.tBodies[0]) return;
    var body = table.tBodies[0], rows = all("tr", body), key = null, dir = 1;
    function getter(k, col) {
      if (k === "n" || k === "y") return function (r) { return +attr(r, k); };
      if (k === "c") return function (r) { return rank(CONF, attr(r, "c")); };
      if (k === "d") return function (r) { return rank(AREAS, attr(r, "d")); };
      return function (r) { return r.cells[col] ? r.cells[col].textContent.toLowerCase() : ""; };
    }
    all("thead button", table).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var k = attr(btn, "sort"), get = getter(k, btn.parentNode.cellIndex);
        dir = key === k ? -dir : 1; key = k;
        reorder(body, rows, function (a, b) { var x = get(a), y = get(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
        all("thead th", table).forEach(function (th) { th.removeAttribute("aria-sort"); });
        btn.parentNode.setAttribute("aria-sort", dir > 0 ? "ascending" : "descending");
      });
    });
  });

  /* ---------- shared wiring ---------- */
  function applyAll() { lists.forEach(function (l) { l.apply(); }); }
  function resetAll() { lists.forEach(function (l) { l.reset(); }); applyAll(); }
  all("[data-reset]", document).forEach(function (b) { b.addEventListener("click", resetAll); });

  // A filter drawer is a side column on wide screens and a closed drawer on small ones,
  // except when the address preset a filter: then it stays open so the choice is visible.
  boot(function () {
    var drawers = all("details.gx-filters", document); if (!drawers.length || !window.matchMedia) return;
    var wide = window.matchMedia("(min-width: 1000px)"), preset = !!(PRESET.reader || PRESET.territory);
    function fit() { drawers.forEach(function (d) { d.open = wide.matches || preset; }); }
    fit(); if (wide.addEventListener) wide.addEventListener("change", fit); else wide.addListener(fit);
  });

  // Checklists: ticks are remembered in this browser.
  all(".ck", document).forEach(function (box) {
    boot(function () {
      var key = attr(box, "ck"), inputs = all("input[type=checkbox]", box), out = box.querySelector(".ck-n"), clear = box.querySelector(".ck-clear");
      var ticks = (store.get().ck || {})[key] || [];
      inputs.forEach(function (i) { i.checked = ticks.indexOf(+attr(i, "i")) >= 0; });
      function count() { return inputs.filter(function (i) { return i.checked; }); }
      function save() {
        var on = count().map(function (i) { return +attr(i, "i"); });
        var ck = store.get().ck || {}; ck[key] = on; store.set({ ck: ck }); if (out) out.textContent = on.length;
      }
      if (out) out.textContent = count().length;
      box.addEventListener("change", save);
      if (clear) clear.addEventListener("click", function () { inputs.forEach(function (i) { i.checked = false; }); save(); });
    });
  });

  // The list of sources is open in the HTML. Fold it here, and open it whenever a source
  // link, #sources or a #src-… address is followed.
  var srcWrap = $("src-wrap");
  if (srcWrap && srcWrap.tagName !== "DETAILS") srcWrap = null;
  function wantsSources(id) { return id === "sources" || id.indexOf("src-") === 0; }
  if (srcWrap && !wantsSources(location.hash.slice(1))) srcWrap.open = false;
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#src-"], a[href="#sources"]');
    if (a && srcWrap) srcWrap.open = true;
  });

  // #<entry id> opens that entry, clearing the filters first if they hide it.
  function reveal(id) {
    if (!id) return false;
    var el = $(id);
    if (wantsSources(id)) {
      if (srcWrap) srcWrap.open = true;
      if (el && id !== "sources") { if (el.hidden) resetAll(); el.scrollIntoView({ block: "center" }); }
      return true;
    }
    if (!el || !el.matches("details.g, details.q, details.rt, .gl-item, #n-table tr, .ck, article.cl, li.ot")) return false;
    if (el.hidden) resetAll();
    if (el.tagName === "DETAILS") el.open = true;
    el.scrollIntoView({ block: "center" });
    return true;
  }
  window.addEventListener("hashchange", function () { reveal(location.hash.slice(1)); });

  applyAll();
  if (location.hash) setTimeout(function () { reveal(location.hash.slice(1)); }, 90);

  /* ---------- the hub's search box ----------
     index is /music/search.json: { pages, kinds, areas, rows: [[id, page, kind, area, title,
     short answer, extra?], …] }. Every word of the query has to be in a row's title or short
     answer; a word in the title counts for more, the start of a word for more than the middle. */
  function wordHit(text, w) {
    var i = text.indexOf(w), found = 0;
    while (i >= 0) {
      if (i === 0 || !/[a-z0-9]/.test(text.charAt(i - 1))) return 2;
      found = 1; i = text.indexOf(w, i + 1);
    }
    return found;
  }
  function search(index, query) {
    var text = String(query || "").toLowerCase().replace(/\s+/g, " ").replace(/^ | $/g, "");
    var ws = text ? text.split(" ") : [], rows = (index && index.rows) || [], scored = [];
    if (!ws.length) return { total: 0, hits: [] };
    if (!index.lower) index.lower = rows.map(function (r) { return [String(r[4]).toLowerCase(), String(r[5]).toLowerCase()]; });
    rows.forEach(function (r, n) {
      var t0 = index.lower[n][0], a0 = index.lower[n][1], score = 0;
      for (var i = 0; i < ws.length; i++) {
        var t = wordHit(t0, ws[i]), a = t ? 0 : wordHit(a0, ws[i]);
        if (!t && !a) return;
        score += t === 2 ? 8 : t === 1 ? 4 : a === 2 ? 2 : 1;
      }
      if (t0 === text) score += 20; else if (t0.indexOf(text) === 0) score += 10; else if (t0.indexOf(text) > 0) score += 3;
      scored.push([score, n]);
    });
    scored.sort(function (x, y) { return y[0] - x[0] || x[1] - y[1]; });
    return { total: scored.length, hits: scored.map(function (s) {
      var r = rows[s[1]];
      return { href: "/music/" + index.pages[r[1]] + "#" + r[0], title: r[4], take: r[5], kind: index.kinds[r[2]], area: index.areas[r[3]], extra: r[6] || "" };
    }) };
  }
  boot(function () {
    var box = $("find"), q = $("f-q"); if (!box || !q) return;
    var count = $("f-count"), list = $("f-list"), more = $("f-more"), clear = $("f-clear"), say = $("f-say");
    var FIRST = 20, index = null, state = "idle", every = false, timer;
    box.hidden = false;
    function load(again) {
      if (index || state === "loading" || (state === "failed" && !again)) return;
      state = "loading";
      window.fetch("/music/search.json").then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (data) { index = data; state = "idle"; render(); }, function () { state = "failed"; render(); });
    }
    function tell(text) { count.textContent = text; clearTimeout(timer); timer = setTimeout(function () { if (say) say.textContent = text; }, 600); }
    function render() {
      var text = q.value.replace(/\s+/g, " ").replace(/^ | $/g, "");
      clear.hidden = !q.value;
      if (!text || !index) {
        list.hidden = true; list.innerHTML = ""; more.hidden = true;
        tell(!text ? "" : state === "failed" ? "The search index did not load. Check your connection, then type again." : "Loading the index.");
        return;
      }
      var found = search(index, text), hits = every ? found.hits : found.hits.slice(0, FIRST);
      list.innerHTML = hits.map(function (h) {
        return "<li><a href=\"" + esc(h.href) + "\"><span class=\"hub-hit-m\">" + esc(h.area + " · " + h.kind + (h.extra ? " · " + h.extra : "")) + "</span>" +
          "<span class=\"hub-hit-t\">" + esc(h.title) + "</span><span class=\"hub-hit-s\">" + esc(h.take) + "</span></a></li>";
      }).join("");
      list.hidden = !hits.length;
      more.hidden = hits.length >= found.total;
      more.textContent = "Show all " + found.total + " results";
      tell(!found.total ? "Nothing matches “" + text + "”. Try one word, or pick an area below."
        : found.total === 1 ? "1 result."
        : hits.length < found.total ? "Showing the first " + hits.length + " of " + found.total + " results. Add a word to narrow them."
        : found.total + " results.");
    }
    function links() { return [].slice.call(list.querySelectorAll("a")); }
    function reset() { q.value = ""; every = false; render(); q.focus(); }
    q.addEventListener("focus", function () { load(false); });
    q.addEventListener("input", function () { every = false; load(true); render(); });
    q.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { var first = links()[0]; if (first) { e.preventDefault(); first.focus(); } }
      else if (e.key === "Escape" && q.value) { e.preventDefault(); reset(); }
    });
    list.addEventListener("keydown", function (e) {
      var a = links(), i = a.indexOf(document.activeElement); if (i < 0) return;
      if (e.key === "ArrowDown" && a[i + 1]) { e.preventDefault(); a[i + 1].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); (a[i - 1] || q).focus(); }
      else if (e.key === "Escape") { e.preventDefault(); reset(); }
    });
    more.addEventListener("click", function () { var had = links().length; every = true; render(); var next = links()[had]; if (next) next.focus(); });
    clear.addEventListener("click", reset);
    if (q.value) { load(true); render(); }
  });

  // The hub's projects band (kept from the old /music): the meter and the on-call demo.
  boot(function () {
    var btn = $("eq-toggle"), eqEl = $("eq"); if (!btn || !eqEl) return;
    btn.addEventListener("click", function () { var paused = eqEl.classList.toggle("paused"); btn.textContent = paused ? "Run the meter" : "Pause the meter"; });
  });
  boot(function () {
    var sw = $("oncall"); if (!sw) return;
    var t = $("oncall-t"), sub = $("oncall-s"), on = true;
    function flip() {
      on = !on; sw.setAttribute("aria-checked", on ? "true" : "false");
      t.textContent = on ? "You’re on call" : "You’re off call";
      sub.textContent = on ? "Demo · bass, guitar" : "Flip on to appear in searches";
    }
    sw.addEventListener("click", flip);
    sw.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
  });
})();
