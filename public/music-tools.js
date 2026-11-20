/* ===================== KiteSink — music tools =====================
   The mechanical rate calculator and the unclaimed-money checklist. Loaded by the pages under
   /music/ that hold one of them (/music/tools, the mechanicals area, the unclaimed area), after
   /music-ref.js. Plain JS, no dependencies, nothing leaves the browser.

   The maths lives in KSMusic (pure functions, exported on window so they can be checked from
   the console or from scripts/test_music.js); the bottom half wires them to the page.

   Both tools read data the build embeds in the page (scripts/build_music.py, from
   content/music/rates.json and content/music/claimable.json) in a
   <script type="application/json"> inside the tool. Without JavaScript the page shows the
   static version the build wrote: the table of yearly rates, and the full checklist.

   The calculator (content/music/DATA-PAGES.md, section 3), for physical copies and permanent
   downloads under 37 CFR 385.11:
     per copy = the larger of the per-work rate and the per-minute rate x the playing time in
                minutes, a part minute counting as a whole one ("per minute of playing time or
                fraction thereof")
     total    = per copy x copies
   Money is worked in hundredths of a cent, as whole numbers, so 4 x 2.52 is exactly 10.08.
   ================================================================== */
(function () {
  "use strict";

  // 13.1 cents -> 1310 hundredths of a cent. Rates are stated to at most two decimal places.
  function hundredths(cents) { return Math.round(cents * 100); }

  var M = {
    hundredths: hundredths,

    // Seconds from minutes and seconds; NaN when either is not a whole number >= 0 or the time is zero.
    seconds: function (min, sec) {
      min = Number(min); sec = Number(sec);
      if (!isFinite(min) || !isFinite(sec) || min < 0 || sec < 0 || Math.floor(min) !== min || Math.floor(sec) !== sec) return NaN;
      var s = min * 60 + sec;
      return s > 0 ? s : NaN;
    },

    // "3:30" or "3" or "0:45" -> seconds; NaN when it is not a time.
    parseTime: function (text) {
      var m = /^\s*(\d{1,3})(?::([0-5]?\d))?\s*$/.exec(String(text || ""));
      return m ? M.seconds(+m[1], m[2] ? +m[2] : 0) : NaN;
    },

    // Minutes charged: every part minute counts as a whole one. 300 s -> 5, 301 s -> 6.
    minutesCharged: function (seconds) { return seconds > 0 ? Math.ceil(seconds / 60) : NaN; },

    // The row of rates.json "physical" for a year, or null.
    yearRow: function (rates, year) {
      var rows = (rates && rates.physical) || [];
      for (var i = 0; i < rows.length; i++) if (rows[i].year === +year) return rows[i];
      return null;
    },
    years: function (rates) { return ((rates && rates.physical) || []).map(function (r) { return r.year; }).sort(function (a, b) { return a - b; }); },
    // The year a calculator starts on: this year when the data has it, else the latest it has.
    defaultYear: function (rates, now) {
      var ys = M.years(rates), y = now == null ? new Date().getFullYear() : now;
      return ys.indexOf(y) >= 0 ? y : ys[ys.length - 1];
    },

    // The rate per copy for one year's row and a playing time.
    //   -> { h: hundredths of a cent, cents, rule: "per-work" | "per-minute", tie (both give the same), minutes, workH, minuteH }
    perCopy: function (row, seconds) {
      var minutes = M.minutesCharged(seconds);
      if (!row || !(minutes > 0)) return null;
      var workH = hundredths(row.per_work_cents), minuteH = hundredths(row.per_minute_cents) * minutes;
      var h = Math.max(workH, minuteH);
      return { h: h, cents: h / 100, rule: minuteH > workH ? "per-minute" : "per-work", tie: minuteH === workH, minutes: minutes, workH: workH, minuteH: minuteH };
    },

    // The whole calculation. copies is a whole number >= 1. -> perCopy's result plus
    // totalH (hundredths of a cent), totalCents (to the cent) and dollars (a string, "$176.40"), or null.
    calc: function (rates, year, seconds, copies) {
      var row = M.yearRow(rates, year), one = M.perCopy(row, seconds);
      copies = Number(copies);
      if (!one || !isFinite(copies) || copies < 1 || Math.floor(copies) !== copies) return null;
      var totalH = one.h * copies;
      one.year = row.year; one.copies = copies; one.totalH = totalH;
      one.totalCents = Math.round(totalH / 100);           // whole cents; exact for whole hundredths
      one.exact = totalH % 100 === 0;                       // false when the total has a part cent
      one.dollars = M.dollars(one.totalCents);
      return one;
    },

    // 1764 -> "17.64", 1310 -> "13.1", 2520 -> "25.2", 1300 -> "13"
    formatCents: function (h) { return (h / 100).toFixed(2).replace(/\.?0+$/, ""); },
    // 17640 cents -> "$176.40"; 123456789 -> "$1,234,567.89"
    dollars: function (cents) {
      var whole = Math.floor(cents / 100), part = cents % 100;
      return "$" + String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + (part < 10 ? "0" : "") + part;
    },

    // The streaming first-prong percentage for a year (an illustration only), or null.
    streamingPercent: function (rates, year) {
      var rows = (rates && rates.streaming_revenue_percent) || [];
      for (var i = 0; i < rows.length; i++) if (rows[i].year === +year) return rows[i];
      return null;
    },

    /* ---------- the unclaimed-money checklist ----------
       rows: the claimable rows (id, readers, territory, ...). A row marked INTL holds
       everywhere, so it shows under every territory, as the field guide's filters do.
       An empty reader or territory is no filter. */
    inTerritory: function (row, code) {
      var t = row.territory || [];
      return !code || t.indexOf(code) >= 0 || (code !== "INTL" && t.indexOf("INTL") >= 0);
    },
    forReader: function (row, reader) { return !reader || (row.readers || []).indexOf(reader) >= 0; },
    places: function (rows, reader, territory) {
      return (rows || []).filter(function (r) { return M.forReader(r, reader) && M.inTerritory(r, territory); });
    }
  };
  window.KSMusic = M;

  /* ---------------------------------------------------------------- the page */
  if (typeof document === "undefined" || !document.querySelectorAll) return;

  function all(sel, root) { return [].slice.call((root || document).querySelectorAll(sel)); }
  function data(box, cls) {
    var el = box.querySelector("script." + cls);
    try { return el ? JSON.parse(el.textContent) : null; } catch (e) { return null; }
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function boot(fn) { try { fn(); } catch (err) { if (window.console) console.error("A music tool failed to start:", err); } }
  // Storage may be missing or blocked (a private window, a test browser): every call is guarded,
  // and the tools work without it.
  var store = {
    get: function () { try { return JSON.parse(window.localStorage.getItem("ksMusic") || "{}") || {}; } catch (e) { return {}; } },
    set: function (patch) { try { var s = store.get(); for (var k in patch) s[k] = patch[k]; window.localStorage.setItem("ksMusic", JSON.stringify(s)); } catch (e) {} }
  };
  function cites(list) {
    return (list || []).map(function (c) { return '<a href="' + esc(c[1]) + '">' + esc(c[0]) + "</a>"; }).join(" · ");
  }

  /* ---------- the mechanical rate calculator ---------- */
  all("[data-rate-calc]").forEach(function (box) {
    boot(function () {
      var rates = data(box, "rc-data"), form = box.querySelector(".rc-form");
      if (!rates || !form || !M.years(rates).length) return;
      var year = form.querySelector('[name="year"]'), min = form.querySelector('[name="min"]'), sec = form.querySelector('[name="sec"]'),
          copies = form.querySelector('[name="copies"]'), out = box.querySelector(".rc-out"), table = box.querySelector(".rc-table");
      function o(name) { return box.querySelector('[data-o="' + name + '"]'); }
      var saved = store.get().rc || {};
      year.value = String(M.years(rates).indexOf(+saved.year) >= 0 ? saved.year : M.defaultYear(rates));
      if (saved.min != null) min.value = saved.min;
      if (saved.sec != null) sec.value = saved.sec;
      if (saved.copies != null) copies.value = saved.copies;

      // Every figure shows its source and the date the rates were checked.
      function srcLine(row) {
        return "Rates for " + esc(row.year) + (rates.as_of_label ? ", as of " + esc(rates.as_of_label) : "") + ". Source: " + cites(row.cite);
      }
      function render() {
        var s = M.seconds(min.value === "" ? 0 : min.value, sec.value === "" ? 0 : sec.value);
        var r = M.calc(rates, year.value, s, copies.value), row = M.yearRow(rates, year.value);
        store.set({ rc: { year: year.value, min: min.value, sec: sec.value, copies: copies.value } });
        if (!r) {
          o("cents").textContent = "–"; o("total").textContent = "–";
          o("rule").textContent = !(s > 0) ? "Enter a playing time: whole minutes and seconds, more than zero."
            : "Enter the number of copies: a whole number, 1 or more.";
          o("src").innerHTML = row ? srcLine(row) : "";
          return;
        }
        var work = M.formatCents(r.workH), perMin = M.formatCents(hundredths(row.per_minute_cents));
        var charged = r.minutes + (r.minutes === 1 ? " minute" : " minutes");
        o("cents").textContent = M.formatCents(r.h);
        o("rule").textContent = r.tie
          ? "Both rates give the same: " + work + " cents per work, and " + charged + " x " + perMin + " cents = " + M.formatCents(r.minuteH) + " cents."
          : r.rule === "per-minute"
          ? "The per-minute rate applies: " + charged + " x " + perMin + " cents = " + M.formatCents(r.minuteH) + " cents, more than the " + work + "-cent per-work rate."
          : "The per-work rate applies: " + work + " cents is more than " + charged + " x " + perMin + " cents = " + M.formatCents(r.minuteH) + " cents.";
        o("total").textContent = r.dollars;
        o("total-note").textContent = r.copies.toLocaleString("en-US") + (r.copies === 1 ? " copy" : " copies") + " x " + M.formatCents(r.h) + " cents"
          + (r.exact ? "" : ", rounded to the nearest cent");
        o("src").innerHTML = srcLine(row);
        var sp = M.streamingPercent(rates, year.value), spBox = o("stream");
        if (spBox) {
          spBox.innerHTML = sp
            ? "In " + esc(sp.year) + " the first prong is <b>" + esc(sp.percent) + "%</b> of the service's revenue for the offering. " + cites(sp.cite)
            : "The rates data gives no streaming percentage for " + esc(year.value) + ".";
        }
      }
      [year, min, sec, copies].forEach(function (el) { el.addEventListener("input", render); el.addEventListener("change", render); });
      form.addEventListener("submit", function (e) { e.preventDefault(); render(); });
      form.hidden = false;
      if (out) out.hidden = false;
      box.classList.add("is-live");
      if (table && table.tagName === "DETAILS") table.open = false;
      render();
    });
  });

  /* ---------- the unclaimed-money checklist ---------- */
  all("[data-unclaimed]").forEach(function (box) {
    boot(function () {
      var rows = (data(box, "uc-data") || {}).rows || [];
      var items = all(".uc-item", box), pick = box.querySelector(".uc-pick");
      var reader = box.querySelector('[name="reader"]'), terr = box.querySelector('[name="territory"]');
      var n = box.querySelector(".uc-n"), of = box.querySelector(".uc-of"), empty = box.querySelector(".uc-empty"), clear = box.querySelector(".uc-clear");
      var saved = store.get(), ticks = saved.uc || [];
      if (!Array.isArray(ticks)) ticks = [];
      if (reader && saved.ucReader) reader.value = saved.ucReader;
      if (terr && saved.ucTerritory) terr.value = saved.ucTerritory;
      if (reader && reader.selectedIndex < 0) reader.value = "";
      if (terr && terr.selectedIndex < 0) terr.value = "";
      items.forEach(function (li) { var i = li.querySelector("input[type=checkbox]"); if (i) i.checked = ticks.indexOf(i.getAttribute("data-id")) >= 0; });

      function render() {
        var want = {};
        M.places(rows, reader ? reader.value : "", terr ? terr.value : "").forEach(function (r) { want[r.id] = true; });
        var shown = 0, ticked = 0;
        items.forEach(function (li) {
          var on = !!want[li.getAttribute("data-id")]; li.hidden = !on;
          if (on) { shown++; if (li.querySelector("input:checked")) ticked++; }
        });
        if (n) n.textContent = ticked;
        if (of) of.textContent = shown;
        if (empty) empty.hidden = shown !== 0;
      }
      function save() {
        // ticks are kept by row id, so a tick survives new rows being added or the order changing
        var on = items.map(function (li) { return li.querySelector("input[type=checkbox]"); })
          .filter(function (i) { return i && i.checked; }).map(function (i) { return i.getAttribute("data-id"); });
        var keep = ticks.filter(function (id) { return !box.querySelector('input[data-id="' + id.replace(/"/g, "") + '"]'); });
        ticks = keep.concat(on);
        store.set({ uc: ticks });
        render();
      }
      box.addEventListener("change", function (e) {
        if (e.target === reader || e.target === terr) {
          store.set({ ucReader: reader ? reader.value : "", ucTerritory: terr ? terr.value : "" });
          render();
        } else if (e.target.type === "checkbox") save();
      });
      if (clear) clear.addEventListener("click", function () { items.forEach(function (li) { var i = li.querySelector("input[type=checkbox]"); if (i) i.checked = false; }); save(); });
      if (pick) pick.hidden = false;
      box.classList.add("is-live");
      render();
    });
  });
})();
