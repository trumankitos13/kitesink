/* ===================== KiteSink — the fitness reference pages =====================
   Loaded by the pages under /fitness/ (an area, the claims, the glossary, the reference
   index, the sources), after /ks.js. /fitness itself, the hub, uses /fitness.js.

   Every entry, table and source is already in the page (scripts/build_fitness.py writes
   it), so nothing here adds content. It only:
     - filters, searches and sorts the lists (guidance, claims, terms, sources)
     - sorts a numbers table by its column headings
     - remembers the meet bag's ticks (localStorage "ksFit", under "ck", as /fitness does)
     - folds the list of sources, and opens it when a source link is followed
     - opens the entry named in the address (/fitness/hypertrophy#hyp-…)
   The list of pages at the top folds behind a button on small screens; the few lines that
   do that sit in the page itself (content/fitness/templates/sub.html), next to the list.
   Each page has only some of these lists, so every block looks for its own markup first
   and does nothing when it is not there.
   ================================================================================== */
(function () {
  "use strict";

  // The areas in the order of the hub: the build writes them on <body data-areas="…">.
  var AREAS = (document.body.getAttribute("data-areas") || "").split(" ");
  var CONF = ["strong", "rule", "moderate", "limited", "practice"], LEVEL = ["beginner", "intermediate", "advanced"];
  var VERD = ["true", "mostly", "depends", "overstated", "false"];
  var EVID = ["meta-analysis", "guideline", "position", "rct", "rulebook", "review", "cohort", "mixed"];

  function $(id) { return document.getElementById(id); }
  function all(sel, root) { return root ? [].slice.call(root.querySelectorAll(sel)) : []; }
  function attr(el, name) { return el.getAttribute("data-" + name) || ""; }
  function rank(list, v) { var i = list.indexOf(v); return i < 0 ? 99 : i; }
  function words(input) { return input ? input.value.toLowerCase().split(/\s+/).filter(Boolean) : []; }
  function byOrder(a, b) { return attr(a, "o") - attr(b, "o"); }
  function reorder(parent, els, cmp) { els.slice().sort(function (a, b) { return cmp(a, b) || byOrder(a, b); }).forEach(function (el) { parent.appendChild(el); }); }
  function eq(name) { return function (el, v) { return attr(el, name) === v; }; }
  function title(el) { var t = el.querySelector(".g-title") || el.querySelector("summary") || el; return t.textContent.toLowerCase(); }
  function byTitle(a, b) { return title(a) < title(b) ? -1 : title(a) > title(b) ? 1 : 0; }
  // Each block starts inside boot(), so a failure in one cannot stop the others.
  function boot(fn) { try { fn(); } catch (err) { if (window.console) console.error("A fitness list failed to start:", err); } }

  var store = {
    get: function () { try { return JSON.parse(localStorage.getItem("ksFit") || "{}") || {}; } catch (e) { return {}; } },
    set: function (patch) { try { var s = store.get(); for (var k in patch) s[k] = patch[k]; localStorage.setItem("ksFit", JSON.stringify(s)); } catch (e) {} }
  };

  /* ---------- a filterable list ----------
     cfg: items, noun, q (search box), count, empty, drawer, active, and
     facets {name: {el, test(el, value)}}. A facet is a group of buttons, one pressed at a
     time; "all" is no filter. Facets whose element is missing are dropped. */
  var lists = [];
  function makeList(cfg) {
    var rows = cfg.items.map(function (el) { return { el: el, text: el.textContent.toLowerCase() }; });
    var facets = {}, state = {};
    Object.keys(cfg.facets || {}).forEach(function (n) { if (cfg.facets[n].el) { facets[n] = cfg.facets[n]; state[n] = "all"; } });
    var names = Object.keys(facets);
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
          // the button is about to be replaced: keep the keyboard's place on the count, not on a
          // text box (which would bring up the on-screen keyboard on a phone)
          x.addEventListener("click", function () { api.reset(); apply(); cfg.count.setAttribute("tabindex", "-1"); cfg.count.focus({ preventScroll: true }); });
          cfg.count.appendChild(x);
        }
      }
      if (cfg.empty) cfg.empty.hidden = shown !== 0;
      if (cfg.active) cfg.active.textContent = active ? "· " + active + " on" : "";
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

  /* ---------- guidance and mistakes (an area page) ---------- */
  boot(function () {
    var box = $("g-list"); if (!box) return;
    var items = all("details.g", box), rail = $("g-rail"), sort = $("g-sort"), open = $("g-open");
    var list = makeList({
      items: items, noun: "entries", q: $("g-q"), count: $("g-count"), empty: $("g-empty"), active: $("g-active"),
      facets: {
        topic: { el: facetIn(rail, "topic"), test: eq("tp") },
        kind: { el: facetIn(rail, "kind"), test: eq("k") },
        level: { el: facetIn(rail, "level"), test: eq("l") },
        conf: { el: facetIn(rail, "conf"), test: eq("c") }
      }
    });
    if (sort) sort.addEventListener("change", function () {
      reorder(box, items, {
        suggested: function () { return 0; },
        az: byTitle,
        conf: function (a, b) { return rank(CONF, attr(a, "c")) - rank(CONF, attr(b, "c")); },
        level: function (a, b) { return rank(LEVEL, attr(a, "l")) - rank(LEVEL, attr(b, "l")); },
        newest: function (a, b) { return attr(b, "y") - attr(a, "y"); }
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
    makeList({
      items: items, noun: "claims", q: $("q-q"), count: $("q-count"), empty: $("q-empty"), active: $("q-active"),
      facets: {
        area: { el: facetIn(ctl, "area"), test: eq("d") },
        verdict: { el: facetIn(ctl, "verdict"), test: eq("v") },
        tag: { el: facetIn(ctl, "tag"), test: function (el, v) { return (" " + attr(el, "tags") + " ").indexOf(" " + v + " ") >= 0; } },
        evidence: { el: facetIn(ctl, "evidence"), test: eq("e") }
      }
    });
    if (sort) sort.addEventListener("change", function () {
      reorder(box, items, {
        suggested: function () { return 0; },
        verdict: function (a, b) { return rank(VERD, attr(a, "v")) - rank(VERD, attr(b, "v")); },
        "verdict-rev": function (a, b) { return rank(VERD, attr(b, "v")) - rank(VERD, attr(a, "v")); },
        az: byTitle,
        evidence: function (a, b) { return rank(EVID, attr(a, "e")) - rank(EVID, attr(b, "e")); },
        newest: function (a, b) { return attr(b, "y") - attr(a, "y"); }
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

  /* ---------- the full list of sources (the sources page has a search box) ---------- */
  boot(function () {
    var q = $("src-q"), box = $("src-list"); if (!q || !box) return;
    makeList({ items: all("li", box), noun: "sources", q: q, count: $("src-count"), empty: $("src-empty") });
  });

  /* ---------- a numbers table: the column headings sort it ----------
     data-sort on a heading's button names what to sort by: n the number (data-n), c how well
     supported (data-c), d the area (data-d); anything else sorts by the text of that column. */
  boot(function () {
    var table = $("n-table"); if (!table || !table.tBodies[0]) return;
    var body = table.tBodies[0], rows = all("tr", body), key = null, dir = 1;
    function getter(k, col) {
      if (k === "n") return function (r) { return +attr(r, "n"); };
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

  // A filter drawer is a side column (or an open block) on wide screens and a closed drawer on small ones.
  boot(function () {
    var drawers = all("details.gx-filters", document); if (!drawers.length || !window.matchMedia) return;
    var wide = window.matchMedia("(min-width: 1000px)");
    function fit() { drawers.forEach(function (d) { d.open = wide.matches; }); }
    fit(); if (wide.addEventListener) wide.addEventListener("change", fit); else wide.addListener(fit);
  });

  // The meet bag: ticks are remembered in this browser.
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
  // link, #sources or a #src-… address is followed. (On the sources page it is not a
  // <details>, so it is never folded.)
  var srcWrap = $("src-wrap");
  if (srcWrap && srcWrap.tagName !== "DETAILS") srcWrap = null;
  function wantsSources(id) { return id === "sources" || id.indexOf("src-") === 0; }
  if (srcWrap && !wantsSources(location.hash.slice(1))) srcWrap.open = false;
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#src-"], a[href="#sources"]');
    if (a && srcWrap) srcWrap.open = true;   // before the browser scrolls to it
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
    if (!el || !el.matches("details.g, details.q, details.rt, .gl-item, #n-table tr, .ck")) return false;
    if (el.hidden) resetAll();
    if (el.tagName === "DETAILS") el.open = true;
    el.scrollIntoView({ block: "center" });
    return true;
  }
  window.addEventListener("hashchange", function () { reveal(location.hash.slice(1)); });

  applyAll();
  if (location.hash) setTimeout(function () { reveal(location.hash.slice(1)); }, 90);
})();
