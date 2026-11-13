/* ===================== KiteSink — fitness tools =====================
   The five calculators on /fitness, and the filters for its reference
   lists. Plain JS, no dependencies, nothing leaves the browser (inputs
   are remembered in localStorage only).

   The maths lives in KSFit (pure functions, exported on window so they
   can be checked from the console or a test); the bottom half wires
   those functions to the page.

   Formulas and their sources (full references on /fitness#sources):
     • Resting energy  — Mifflin-St Jeor (1990): 10·kg + 6.25·cm − 5·age + 5 (men) / − 161 (women)
                         or, when body-fat % is given, Cunningham (1991): 370 + 21.6·FFM
     • Maintenance     — resting energy × physical activity level (FAO/WHO/UNU 2004 bands)
     • 1RM             — Epley: w·(1 + r/30)   ·   Brzycki (1993): w·36/(37 − r)
     • Effective reps  — a coaching heuristic, not a measured quantity: the reps that
                         fall inside the last five before failure
     • Meet attempts   — a coaching convention: fixed fractions of a current best single,
                         rounded to the 2.5 kg a meet loads
   ================================================================== */
(function () {
  "use strict";

  var LB = 2.2046226218, KCAL_PER_KG = 7700; // 7,700 kcal/kg is the usual rule of thumb, not a constant

  var F = {
    kg: function (lb) { return lb / LB; },
    lb: function (kg) { return kg * LB; },
    round: function (v, step) { return Math.round(v / step) * step; },

    // Mifflin-St Jeor resting energy expenditure, kcal/day
    mifflin: function (sex, kg, cm, age) { return 10 * kg + 6.25 * cm - 5 * age + (sex === "f" ? -161 : 5); },
    // Cunningham 1991 (the textbook "Katch-McArdle" form): from fat-free mass
    cunningham: function (kg, bodyFatPct) { return 370 + 21.6 * kg * (1 - bodyFatPct / 100); },

    /* energy(opts) → the whole plan.
       opts: sex 'm'|'f', kg, cm, age, bf (body-fat %, optional), pal,
             goal 'lose'|'hold'|'gain', rate (lose: % body weight / week; gain: % above maintenance),
             protein (g per kg), fatPct (% of calories) */
    energy: function (o) {
      var useBf = o.bf > 0 && o.bf < 60;
      var rmr = useBf ? F.cunningham(o.kg, o.bf) : F.mifflin(o.sex, o.kg, o.cm, o.age);
      var maint = rmr * o.pal, delta = 0;
      if (o.goal === "lose") delta = -(o.rate / 100) * o.kg * KCAL_PER_KG / 7;
      else if (o.goal === "gain") delta = maint * (o.rate / 100);
      var kcal = maint + delta;
      var p = o.protein * o.kg, f = kcal * (o.fatPct / 100) / 9, c = (kcal - p * 4 - f * 9) / 4;
      return {
        rmr: rmr, maint: maint, kcal: kcal, delta: delta, equation: useBf ? "Cunningham" : "Mifflin-St Jeor",
        protein: p, fat: f, carbs: c,
        weekly: delta * 7 / KCAL_PER_KG,                       // kg per week implied by the rule of thumb
        belowRmr: kcal < rmr, deficitPct: delta < 0 ? -delta / maint * 100 : 0, carbsLow: c < 50
      };
    },

    // Effective reps under the "last five before failure" heuristic
    effective: function (reps, rir) { return Math.max(0, Math.min(reps, 5 - rir)); },
    rpe: function (rir) { return Math.max(1, 10 - rir); },

    epley: function (w, r) { return r <= 1 ? w : w * (1 + r / 30); },
    brzycki: function (w, r) { return r <= 1 ? w : (r >= 37 ? NaN : w * 36 / (37 - r)); },
    // load to use for `reps` reps with `rir` left in the tank (Epley, inverted)
    loadFor: function (oneRm, reps, rir) { var r = reps + rir; return r <= 1 ? oneRm : oneRm / (1 + r / 30); },

    // Meet attempts. Opener, second and third as fractions of the best single you could
    // lift today. A convention, not a rule: "first" aims for nine good lifts, "bold" ends
    // on a small personal best. Rounded to 2.5 kg and always rising by at least one step.
    ATTEMPT_STYLES: { first: [0.88, 0.94, 0.98], standard: [0.91, 0.96, 1], bold: [0.92, 0.975, 1.025] },
    attempts: function (bestKg, style) {
      var p = F.ATTEMPT_STYLES[style] || F.ATTEMPT_STYLES.standard, out = [], prev = 0;
      for (var i = 0; i < 3; i++) { var v = F.round(bestKg * p[i], 2.5); if (v <= prev) v = prev + 2.5; out.push(v); prev = v; }
      return out;
    },
    // Warm-up ladder to an opener: the empty 20 kg bar, then rising fractions of the opener
    // with fewer reps each time. Every step is heavier than the last and lighter than the opener.
    warmups: function (openerKg) {
      var steps = [[0.4, 5], [0.55, 3], [0.7, 2], [0.8, 1], [0.9, 1]], out = [], prev = 0;
      if (openerKg > 25) { out.push({ kg: 20, reps: 8 }); prev = 20; }
      steps.forEach(function (st) {
        var v = F.round(openerKg * st[0], 2.5);
        if (v > prev && v < openerKg) { out.push({ kg: v, reps: st[1] }); prev = v; }
      });
      return out;
    },
    // reps to failure at a fraction of 1RM (Epley, inverted)
    repsAt: function (pct) { return 30 * (1 / pct - 1); }
  };

  /* ---------- travel workout builder ---------- */
  // n name · p pattern · e equipment key ('bw' or one of EQUIP, or a list = any of) · l minimum level
  // m maximum level (optional) · u unit: r reps, e reps each side, s seconds, h seconds each side
  var X = [
    { n: "Incline push-up (hands on a bench)", p: "push", e: "bench", l: 1, m: 1, u: "r" },
    { n: "Knee push-up", p: "push", e: "bw", l: 1, m: 1, u: "r" },
    { n: "Push-up", p: "push", e: "bw", l: 1, u: "r" },
    { n: "Close-grip push-up", p: "push", e: "bw", l: 2, u: "r" },
    { n: "Pike push-up", p: "push", e: "bw", l: 2, u: "r" },
    { n: "Feet-elevated push-up", p: "push", e: "bench", l: 2, u: "r" },
    { n: "Dumbbell floor press", p: "push", e: "db", l: 1, u: "r", w: 1 },
    { n: "Dumbbell overhead press", p: "push", e: "db", l: 1, u: "r", w: 1 },
    { n: "Kettlebell overhead press", p: "push", e: "kb", l: 1, u: "e", w: 1 },
    { n: "Band chest press", p: "push", e: "band", l: 1, u: "r", w: 1 },
    { n: "Suspension push-up", p: "push", e: "sus", l: 2, u: "r" },

    { n: "Prone Y-T-W raise", p: "pull", e: "bw", l: 1, u: "r" },
    { n: "Reverse snow angel", p: "pull", e: "bw", l: 1, u: "r" },
    { n: "Dumbbell bent-over row", p: "pull", e: "db", l: 1, u: "r", w: 1 },
    { n: "Single-arm dumbbell row", p: "pull", e: "db", l: 1, u: "e", w: 1 },
    { n: "Kettlebell row", p: "pull", e: "kb", l: 1, u: "e", w: 1 },
    { n: "Band row", p: "pull", e: "band", l: 1, u: "r", w: 1 },
    { n: "Band pull-apart", p: "pull", e: "band", l: 1, u: "r", w: 1 },
    { n: "Suspension row", p: "pull", e: "sus", l: 1, u: "r" },
    { n: "Slow-lowering pull-up", p: "pull", e: "bar", l: 1, m: 2, u: "r", few: 1 },
    { n: "Chin-up", p: "pull", e: "bar", l: 2, u: "r", few: 1 },
    { n: "Pull-up", p: "pull", e: "bar", l: 3, u: "r", few: 1 },

    { n: "Bodyweight squat", p: "squat", e: "bw", l: 1, u: "r" },
    { n: "Reverse lunge", p: "squat", e: "bw", l: 1, u: "e" },
    { n: "Split squat", p: "squat", e: "bw", l: 1, u: "e" },
    { n: "Wall sit", p: "squat", e: "bw", l: 1, u: "s" },
    { n: "Jump squat", p: "squat", e: "bw", l: 2, u: "r" },
    { n: "Step-up", p: "squat", e: "bench", l: 1, u: "e" },
    { n: "Bulgarian split squat", p: "squat", e: "bench", l: 2, u: "e" },
    { n: "Single-leg squat to a chair", p: "squat", e: "bench", l: 3, u: "e", few: 1 },
    { n: "Goblet squat", p: "squat", e: ["db", "kb"], l: 1, u: "r", w: 1 },
    { n: "Dumbbell reverse lunge", p: "squat", e: "db", l: 2, u: "e", w: 1 },

    { n: "Glute bridge", p: "hinge", e: "bw", l: 1, u: "r" },
    { n: "Single-leg glute bridge", p: "hinge", e: "bw", l: 2, u: "e" },
    { n: "Single-leg Romanian deadlift", p: "hinge", e: "bw", l: 2, u: "e" },
    { n: "Hip thrust (shoulders on a bench)", p: "hinge", e: "bench", l: 1, u: "r" },
    { n: "Dumbbell Romanian deadlift", p: "hinge", e: "db", l: 1, u: "r", w: 1 },
    { n: "Kettlebell deadlift", p: "hinge", e: "kb", l: 1, u: "r", w: 1 },
    { n: "Kettlebell swing", p: "hinge", e: "kb", l: 2, u: "r", w: 1 },
    { n: "Band good morning", p: "hinge", e: "band", l: 1, u: "r", w: 1 },
    { n: "Suspension hamstring curl", p: "hinge", e: "sus", l: 2, u: "r" },

    { n: "Front plank", p: "core", e: "bw", l: 1, u: "s" },
    { n: "Side plank", p: "core", e: "bw", l: 1, u: "h" },
    { n: "Dead bug", p: "core", e: "bw", l: 1, u: "e" },
    { n: "Bicycle crunch", p: "core", e: "bw", l: 1, u: "r" },
    { n: "Hollow hold", p: "core", e: "bw", l: 2, u: "s" },
    { n: "Hanging knee raise", p: "core", e: "bar", l: 2, u: "r" },
    { n: "Suitcase carry", p: "core", e: ["db", "kb"], l: 1, u: "h", w: 1 },
    { n: "Band Pallof press", p: "core", e: "band", l: 1, u: "e", w: 1 },

    { n: "Jumping jacks", p: "cond", e: "bw", l: 1, u: "s" },
    { n: "High knees", p: "cond", e: "bw", l: 1, u: "s" },
    { n: "Mountain climbers", p: "cond", e: "bw", l: 1, u: "s" },
    { n: "Skater hops", p: "cond", e: "bw", l: 1, u: "s" },
    { n: "Shadow boxing", p: "cond", e: "bw", l: 1, u: "s" },
    { n: "Squat thrust", p: "cond", e: "bw", l: 1, u: "r" },
    { n: "Burpee", p: "cond", e: "bw", l: 2, u: "r" },
    { n: "Fast step-ups", p: "cond", e: "bench", l: 1, u: "s" }
  ];
  var EQUIP = { db: "Dumbbells", kb: "Kettlebell", band: "Bands", bar: "Pull-up bar", bench: "Bench or sturdy chair", sus: "Suspension trainer" };
  var LEVELS = ["", "Beginner", "Intermediate", "Advanced"];
  var FORMATS = { circuit: "Circuit", emom: "EMOM", amrap: "AMRAP", intervals: "Intervals", sets: "Straight sets" };

  function rng(seed) { // small seeded PRNG (mulberry32) so a session can be rebuilt from its seed
    var a = seed >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function has(ex, equip) { return [].concat(ex.e).some(function (k) { return k === "bw" || equip.indexOf(k) >= 0; }); }
  function usesKit(ex, equip) { return [].concat(ex.e).some(function (k) { return k !== "bw" && equip.indexOf(k) >= 0; }); }

  // how much of one exercise: dose(ex, level, mode) → "12", "8 / side", "30 s" …
  function dose(ex, level, mode) {
    var easy = mode === "emom" || mode === "amrap";
    if (ex.u === "s") return [0, 20, 30, 40][level] + " s";
    if (ex.u === "h") return [0, 15, 20, 30][level] + " s / side";
    var n = ex.few ? [0, 3, 5, 6][level] : ex.w ? (easy ? 8 : 10) : [0, 8, 12, 15][level];
    if (easy && !ex.few && !ex.w) n = [0, 6, 8, 10][level];
    if (ex.u === "e") return Math.max(3, Math.round(n * 0.7)) + " / side";
    return String(n);
  }

  /* build({equip:[keys], minutes, level:1-3, format, seed}) → session object */
  F.travel = function (o) {
    var rand = rng(o.seed || 1), level = o.level, used = {};
    function pick(pattern) {
      var pool = X.filter(function (ex) { return ex.p === pattern && ex.l <= level && (!ex.m || ex.m >= level) && has(ex, o.equip) && !used[ex.n]; });
      if (!pool.length) pool = X.filter(function (ex) { return ex.p === pattern && ex.l <= level && has(ex, o.equip); });
      if (!pool.length) return null;
      // weight toward exercises that use the kit you said you have
      var bag = [];
      pool.forEach(function (ex) { var k = usesKit(ex, o.equip) ? 3 : 1; while (k--) bag.push(ex); });
      var ex = bag[Math.floor(rand() * bag.length)];
      used[ex.n] = 1;
      return ex;
    }
    function line(ex) { return { name: ex.n, dose: dose(ex, level, o.format), loaded: !!ex.w }; }
    function take(patterns) { return patterns.map(pick).filter(Boolean).map(line); }

    var T = { 15: [3, 10, 2], 20: [4, 14, 2], 30: [5, 22, 3], 45: [6, 35, 4] }[o.minutes] || [4, 14, 2];
    // M = minutes for the main block. `sec` is how long the plan below should take,
    // counting about 45 s per set or station; it must not exceed M (the tests check).
    var M = T[1], rest = [0, 90, 60, 45][level], main = [], rule = "", sec = 0;

    if (o.format === "circuit") {
      var pats = M < 14 ? ["squat", "push", "hinge", "pull"] : ["squat", "push", "hinge", "pull", "core"]; if (M >= 22) pats.push("cond");
      var items = take(pats), rounds = Math.max(2, Math.min(6, Math.floor(M * 60 / (items.length * 45 + rest))));
      rule = rounds + " rounds · move straight from one exercise to the next · rest " + rest + " s between rounds";
      main.push({ title: "The circuit", items: items });
      sec = rounds * (items.length * 45 + rest) - rest;
    } else if (o.format === "emom") {
      var st = take(M >= 14 ? ["squat", "push", "hinge", "pull"] : ["squat", "push"]), mins = M - (M % st.length);
      rule = "Every minute on the minute for " + mins + " minutes · do the reps, rest for whatever is left of the minute";
      main.push({ title: "Rotate each minute", items: st.map(function (it, i) { it.tag = "Min " + (i + 1); return it; }) });
      sec = mins * 60;
    } else if (o.format === "amrap") {
      if (M >= 22) {
        var each = Math.floor((M - 3) / 2);
        rule = "Two blocks of " + each + " minutes · as many good rounds as you can · rest 3 minutes between blocks";
        main.push({ title: "Block A · " + each + " min", items: take(["squat", "push", "core"]) });
        main.push({ title: "Block B · " + each + " min", items: take(["hinge", "pull", "cond"]) });
        sec = (each * 2 + 3) * 60;
      } else {
        rule = M + " minutes · as many good rounds as you can · note your score";
        main.push({ title: "One round", items: take(["squat", "push", "hinge", "pull"]) });
        sec = M * 60;
      }
    } else if (o.format === "intervals") {
      // a block is 4 minutes of work plus a minute's rest before the next
      var blocks = Math.max(2, Math.min(6, Math.floor((M + 1) / 5))), plan = [["squat", "push"], ["cond", "core"], ["hinge", "pull"], ["cond", "squat"], ["push", "core"], ["cond", "hinge"]];
      rule = blocks + " blocks · 20 s work / 10 s rest × 8, alternating the two moves · rest 1 minute between blocks";
      for (var b = 0; b < blocks; b++) main.push({ title: "Block " + (b + 1) + " · 4 min", items: take(plan[b]).map(function (it) { it.dose = "20 s"; return it; }) });
      sec = blocks * 240 + (blocks - 1) * 60;
    } else { // straight sets: pick as many moves as fit at two sets each (three in a longer session)
      var sr = [0, 90, 75, 60][level], per = 45 + sr, aim = M >= 22 ? 3 : 2;
      var count = Math.max(2, Math.min(6, Math.floor(M * 60 / (aim * per))));
      var list = take(["squat", "push", "pull", "hinge", "core", "push"].slice(0, count));
      var sets = Math.max(2, Math.min(4, Math.floor(M * 60 / (list.length * per))));
      rule = sets + " sets of each · rest " + sr + " s between sets · leave 1–3 reps in reserve";
      main.push({ title: "In order", items: list.map(function (it) { it.dose = sets + " × " + it.dose; return it; }) });
      sec = list.length * sets * per;
    }

    var warm = ["Easy march or jog on the spot · " + (T[0] >= 4 ? "90 s" : "60 s"), "Arm circles and hip circles · 30 s each", "Bodyweight squat × 8, then walk the hands out to a plank × 4"];
    if (T[0] >= 5) warm.push("One easy practice set of the first two exercises");
    var cool = T[2] <= 2 ? ["Walk and slow your breathing · 60 s", "Hip-flexor stretch · 30 s per side"]
      : ["Walk and slow your breathing · " + (T[2] > 3 ? "2 min" : "60 s"), "Hip-flexor stretch and doorway chest stretch · 30 s per side"];
    var fname = o.format === "emom" || o.format === "amrap" ? FORMATS[o.format] : FORMATS[o.format].toLowerCase();
    return {
      title: o.minutes + "-minute " + fname + " · " + LEVELS[level].toLowerCase(),
      kit: ["Bodyweight"].concat(o.equip.map(function (k) { return EQUIP[k]; })).join(", "),
      rule: rule, warm: warm, warmMin: T[0], main: main, cool: cool, coolMin: T[2],
      mainSec: sec, budgetSec: M * 60,
      loaded: main.some(function (blk) { return blk.items.some(function (it) { return it.loaded; }); })
    };
  };
  F.travelText = function (s) {
    var out = [s.title.toUpperCase(), "Kit: " + s.kit, "", "WARM-UP (" + s.warmMin + " min)"];
    s.warm.forEach(function (w) { out.push("- " + w); });
    out.push("", "MAIN", s.rule);
    s.main.forEach(function (blk) { out.push("", blk.title); blk.items.forEach(function (it) { out.push("- " + (it.tag ? it.tag + ": " : "") + it.name + " — " + it.dose); }); });
    out.push("", "COOL-DOWN (" + s.coolMin + " min)");
    s.cool.forEach(function (c) { out.push("- " + c); });
    if (s.loaded) out.push("", "Weighted moves: pick a load that leaves about 2 reps in reserve.");
    out.push("", "Built at kitesink.com/fitness");
    return out.join("\n");
  };
  F.EXERCISES = X; F.EQUIP = EQUIP;
  window.KSFit = F;

  /* =====================================================================
     Page wiring. Everything below needs the /fitness markup; it does
     nothing on a page that doesn't have it.
     ===================================================================== */
  function $(id) { return document.getElementById(id); }
  if (!$("tools")) return;

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function num(v, d) { return Number(v).toLocaleString("en-US", { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }); }
  function val(id) { var v = parseFloat($(id).value); return isFinite(v) ? v : NaN; }
  function pressed(group, value) { [].forEach.call(group.querySelectorAll("button"), function (b) { b.setAttribute("aria-pressed", b.value === value ? "true" : "false"); }); }
  // a segmented button group that behaves like a radio set: seg(el, wanted, fallback, onChange) → getter.
  // `wanted` usually comes from localStorage, so anything that isn't one of the buttons falls back.
  function seg(el, wanted, fallback, onChange) {
    var values = [].map.call(el.querySelectorAll("button"), function (b) { return b.value; });
    var cur = values.indexOf(String(wanted)) >= 0 ? String(wanted) : fallback; pressed(el, cur);
    el.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b || b.value === cur) return;
      cur = b.value; pressed(el, cur); onChange(cur);
    });
    return { get: function () { return cur; }, set: function (v) { cur = v; pressed(el, cur); } };
  }
  var store = {
    get: function () { try { return JSON.parse(localStorage.getItem("ksFit") || "{}") || {}; } catch (e) { return {}; } },
    set: function (patch) { try { var s = store.get(); for (var k in patch) s[k] = patch[k]; localStorage.setItem("ksFit", JSON.stringify(s)); } catch (e) {} }
  };
  var saved = store.get();
  // Screen-reader status: one short sentence per tool, sent once the sliders settle,
  // instead of a live region around a whole results card.
  var sayTimers = {}, booting = true; // nothing is announced while the page is still setting itself up
  function say(id, text) {
    if (booting) return;
    clearTimeout(sayTimers[id]);
    sayTimers[id] = setTimeout(function () { var el = $(id); if (el) el.textContent = text; }, 700);
  }
  function copy(text, btn) {
    if (!btn.getAttribute("data-label")) btn.setAttribute("data-label", btn.textContent); // remember the real label once
    function done(ok) {
      btn.textContent = ok ? "Copied ✓" : "Press ⌘C / Ctrl C";
      clearTimeout(btn._ksT); btn._ksT = setTimeout(function () { btn.textContent = btn.getAttribute("data-label"); }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    else done(false);
  }

  // Each tool starts inside boot(), so a failure in one cannot stop the others.
  function boot(fn) { try { fn(); } catch (err) { if (window.console) console.error("A fitness tool failed to start:", err); } }

  /* ---------- tabs: one tool at a time; each has its own #hash ---------- */
  boot(function () {
    var ids = ["macros", "reps", "loads", "travel", "attempts"].filter(function (id) { return $("tab-" + id) && $(id); });
    var tabs = ids.map(function (id) { return $("tab-" + id); }), panels = ids.map($);
    function show(id, focus) {
      var i = ids.indexOf(id); if (i < 0) return false;
      tabs.forEach(function (t, j) { t.setAttribute("aria-selected", j === i ? "true" : "false"); t.tabIndex = j === i ? 0 : -1; });
      panels.forEach(function (p, j) { p.hidden = j !== i; });
      if (focus) tabs[i].focus();
      var bar = tabs[i].parentNode; // centre the tab in its own strip; never move the page
      if (bar.scrollWidth > bar.clientWidth) bar.scrollLeft += tabs[i].getBoundingClientRect().left - bar.getBoundingClientRect().left - (bar.clientWidth - tabs[i].offsetWidth) / 2;
      return true;
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { show(ids[i]); history.replaceState(null, "", "#" + ids[i]); });
      t.addEventListener("keydown", function (e) {
        var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (!d) return;
        e.preventDefault(); var n = ids[(i + d + ids.length) % ids.length]; show(n, true); history.replaceState(null, "", "#" + n);
      });
    });
    function fromHash() {
      var id = location.hash.slice(1);
      if (show(id)) { var top = $("tools").getBoundingClientRect().top + window.scrollY - 110; window.scrollTo(0, top); }
    }
    show("macros");
    window.addEventListener("hashchange", fromHash);
    if (location.hash) setTimeout(fromHash, 60);
  });

  /* ---------- 1. energy & macros ---------- */
  boot(function () {
    var units = seg($("m-units"), saved.units, "metric", function () { showBody(); paintUnits(); calc(); });
    var sex = seg($("m-sex"), saved.sex, "m", calc);
    var goal = seg($("m-goal"), saved.goal, "lose", function () { goalChanged(); calc(); });
    var protTouched = !!saved.protTouched;
    // The maths runs on these metric values. The fields only display them, so switching
    // units back and forth cannot drift the number that was entered.
    var body = { kg: saved.kg > 0 ? +saved.kg : val("m-weight"), cm: saved.cm > 0 ? +saved.cm : val("m-cm") };
    function showBody() {
      var imp = units.get() === "imperial";
      if (isFinite(body.kg)) $("m-weight").value = imp ? Math.round(F.lb(body.kg)) : Math.round(body.kg * 10) / 10;
      if (isFinite(body.cm)) {
        if (imp) { var tot = Math.round(body.cm / 2.54); $("m-ft").value = Math.floor(tot / 12); $("m-in").value = tot % 12; }
        else $("m-cm").value = Math.round(body.cm);
      }
    }
    $("m-weight").addEventListener("input", function () { var v = val("m-weight"); body.kg = units.get() === "imperial" ? F.kg(v) : v; calc(); });
    ["m-cm", "m-ft", "m-in"].forEach(function (id) {
      $(id).addEventListener("input", function () {
        var inch = val("m-in");
        body.cm = units.get() === "imperial" ? ((val("m-ft") * 12) + (isFinite(inch) ? inch : 0)) * 2.54 : val("m-cm");
        calc();
      });
    });
    ["m-age", "m-bf", "m-act", "m-rate", "m-fat", "m-diet", "m-meals", "m-cook", "m-avoid"].forEach(function (id) { $(id).addEventListener("input", calc); });
    $("m-prot").addEventListener("input", function () { protTouched = true; calc(); });
    $("m-copy").addEventListener("click", function () { copy($("m-prompt").value, $("m-copy")); });

    if (saved.age) $("m-age").value = saved.age;
    if (saved.bf) $("m-bf").value = saved.bf;
    if (saved.pal) [].forEach.call($("m-act").options, function (o) { if (parseFloat(o.value) === parseFloat(saved.pal)) $("m-act").value = o.value; }); // 2 must find "2.0"
    if (saved.fatPct) $("m-fat").value = saved.fatPct;
    if (saved.protein && protTouched) $("m-prot").value = saved.protein;

    function paintUnits() {
      var imp = units.get() === "imperial";
      $("m-h-metric").hidden = imp; $("m-h-imperial").hidden = !imp;
      $("m-w-unit").textContent = imp ? "lb" : "kg";
    }
    function goalChanged() {
      var g = goal.get(), r = $("m-rate");
      $("m-rate-wrap").hidden = g === "hold";
      if (g === "lose") { r.min = 0.25; r.max = 1; r.step = 0.05; r.value = saved.loseRate || 0.5; }
      else if (g === "gain") { r.min = 5; r.max = 20; r.step = 1; r.value = saved.gainRate || 10; }
      if (!protTouched) $("m-prot").value = g === "lose" ? 2 : 1.6;
    }

    function calc() {
      var imp = units.get() === "imperial", kg = body.kg, cm = body.cm;
      var age = val("m-age"), bf = val("m-bf"), g = goal.get(), rate = val("m-rate");
      var act = $("m-act").selectedOptions[0] || $("m-act").options[1];
      var prot = val("m-prot"), fatPct = val("m-fat"), pal = parseFloat(act.value);
      $("m-prot-read").textContent = num(prot, 1) + " g/kg" + (isFinite(kg) ? " · " + num(prot / LB, 2) + " g/lb" : "");
      $("m-fat-read").textContent = num(fatPct) + "% of calories";
      $("m-rate-label").textContent = g === "gain" ? "Surplus" : "Rate of loss";
      $("m-rate-read").textContent = g === "gain" ? "+" + num(rate) + "% over maintenance" : num(rate, 2) + "% of body weight / week";

      var ok = kg > 30 && kg < 300 && cm > 120 && cm < 230 && age >= 16 && age <= 95;
      $("m-out").classList.toggle("is-empty", !ok);
      if (!ok) {
        $("m-kcal").textContent = "—"; $("m-sub").textContent = "Enter age, height and weight to see your numbers."; $("m-warn").hidden = true;
        $("m-prompt").value = ""; $("m-copy").disabled = true;
        say("m-say", "Enter age, height and weight to see your numbers.");
        return;
      }

      var r = F.energy({ sex: sex.get(), kg: kg, cm: cm, age: age, bf: bf, pal: pal, goal: g, rate: rate, protein: prot, fatPct: fatPct });
      var carbs = Math.max(0, r.carbs);
      $("m-kcal").textContent = num(F.round(r.kcal, 10));
      $("m-sub").textContent = g === "hold" ? "to hold your weight" : (g === "lose" ? "about " + num(F.round(-r.delta, 10)) + " kcal under maintenance" : "about " + num(F.round(r.delta, 10)) + " kcal over maintenance");
      $("m-maint").textContent = num(F.round(r.maint, 10)) + " kcal";
      $("m-rmr").textContent = num(F.round(r.rmr, 10)) + " kcal";
      $("m-eq").textContent = r.equation;
      $("m-pal").textContent = "× " + num(pal, 1);
      var wk = imp ? F.lb(r.weekly) : r.weekly, u = imp ? " lb" : " kg";
      $("m-change").textContent = g === "hold" ? "steady" : (wk > 0 ? "+" : "−") + num(Math.abs(wk), 2) + u + " / week";
      $("m-p").textContent = num(r.protein) + " g"; $("m-c").textContent = num(carbs) + " g"; $("m-f").textContent = num(r.fat) + " g";
      var tot = r.protein * 4 + carbs * 4 + r.fat * 9;
      $("m-bar-p").style.flexGrow = r.protein * 4 / tot; $("m-bar-c").style.flexGrow = carbs * 4 / tot; $("m-bar-f").style.flexGrow = r.fat * 9 / tot;
      $("m-bar").setAttribute("aria-label", "Calorie split: protein " + num(r.protein * 4 / tot * 100) + "%, carbohydrate " + num(carbs * 4 / tot * 100) + "%, fat " + num(r.fat * 9 / tot * 100) + "%");

      var over = r.carbs < 0, warns = []; // over: protein + fat alone are more than the target
      if (over) warns.push("Protein and fat alone come to more than this calorie target, so the split below does not add up. Lower one of them or ease the deficit.");
      if (r.belowRmr) warns.push("This target is below your estimated resting energy use. That is an aggressive deficit — slow the rate, or talk to a clinician before running it.");
      else if (r.deficitPct > 25) warns.push("That is a deficit of more than 25% of maintenance. Expect it to be hard to sustain; a slower rate usually keeps more muscle.");
      if (!warns.length && r.carbs < 50) warns.push("Protein and fat use almost all of this budget, leaving very little carbohydrate. Lower one of them or ease the deficit.");
      var warn = warns.join(" ");
      $("m-warn").hidden = !warn; $("m-warn").textContent = warn;
      say("m-say", "Daily target " + num(F.round(r.kcal, 10)) + " kilocalories: " + num(r.protein) + " grams protein, " + num(carbs) + " grams carbohydrate, " + num(r.fat) + " grams fat." + (warn ? " Warning: " + warn : ""));

      // meal-plan prompt
      var meals = val("m-meals"), diet = $("m-diet").value, cook = $("m-cook").value, avoid = $("m-avoid").value.trim();
      var who = Math.round(age) + "-year-old " + (sex.get() === "f" ? "woman" : "man") + ", " + (imp ? num(F.lb(kg)) + " lb" : num(kg, 1) + " kg") + ", " + act.getAttribute("data-short");
      var aim = g === "hold" ? "hold my current weight" : g === "lose" ? "lose about " + num(rate, 2) + "% of my body weight per week" : "gain slowly on a " + num(rate) + "% surplus";
      $("m-copy").disabled = over;
      $("m-prompt").value = over ? "Protein and fat alone exceed the calorie target, so there is no plan to ask for yet. Lower the protein or fat slider, or ease the deficit." :
        "Build me a 7-day meal plan.\n\n" +
        "Daily targets (stay within 5%): " + num(F.round(r.kcal, 10)) + " kcal · " + num(r.protein) + " g protein · " + num(carbs) + " g carbohydrate · " + num(r.fat) + " g fat.\n" +
        "About me: " + who + ". Goal: " + aim + ".\n" +
        "Constraints: " + (diet === "none" ? "no dietary restrictions" : diet) + "; " + meals + " meals a day (about " + num(r.protein / meals) + " g protein each); " + cook + " cooking per meal" + (avoid ? "; avoid " + avoid : "") + ".\n\n" +
        "For each day give every meal with ingredient weights in grams and its calories and protein, then a daily total against the targets. After day 7 add one consolidated shopping list and two swap options per meal.\n" +
        "Show the arithmetic for each daily total and flag any day that misses a target by more than 5%. Use ordinary supermarket food. Ask me before assuming anything about allergies or medical conditions.";

      var patch = { units: units.get(), sex: sex.get(), goal: g, age: age, cm: cm, kg: kg, bf: isFinite(bf) ? bf : "", pal: pal, fatPct: fatPct, protein: prot, protTouched: protTouched };
      if (g === "lose") patch.loseRate = rate; else if (g === "gain") patch.gainRate = rate;
      store.set(patch); saved = store.get();
    }

    showBody(); paintUnits(); goalChanged(); calc();
  });

  /* ---------- 2. effective reps ---------- */
  boot(function () {
    var log = [];
    function paint() {
      var reps = val("r-reps"), rir = val("r-rir"), eff = F.effective(reps, rir), html = "";
      $("r-reps-read").textContent = reps + (reps === 1 ? " rep" : " reps");
      $("r-rir-read").textContent = rir >= 6 ? "6+ in reserve" : rir + " in reserve" + (rir === 0 ? " (failure)" : "");
      for (var i = 1; i <= reps + rir; i++) {
        var done = i <= reps, hot = i > reps + rir - 5;
        html += '<i class="' + (done ? (hot ? "eff" : "done") : (hot ? "left hot" : "left")) + '"></i>';
      }
      $("r-dots").innerHTML = html;
      $("r-dots").setAttribute("aria-label", reps + " reps performed, " + rir + " left in reserve; " + eff + " fall inside the last five before failure");
      $("r-eff").firstChild.nodeValue = eff;
      $("r-rpe").textContent = "RPE " + F.rpe(rir);
      say("r-say", eff + " effective " + (eff === 1 ? "rep" : "reps") + " from " + reps + " at " + rir + " in reserve.");
      $("r-msg").textContent = eff === 0 ? "None of these reps reach the last five before failure. Under this model the set is a warm-up."
        : rir === 0 ? "Taken to failure, so the set scores as much as this model allows."
        : eff + " of the " + reps + (reps === 1 ? " rep lands" : " reps land") + " inside the last five before failure. Taken to failure, the set would score " + Math.min(5, reps + rir) + ".";
    }
    function paintLog() {
      var list = $("r-log"), sets = log.length, eff = 0, reps = 0;
      log.forEach(function (s) { eff += s.eff; reps += s.reps; });
      list.innerHTML = log.map(function (s, i) { return '<li><span>Set ' + (i + 1) + '</span><b>' + s.reps + ' × ' + s.rir + ' RIR</b><em>' + s.eff + ' eff.</em></li>'; }).join("");
      $("r-total").textContent = sets ? sets + (sets === 1 ? " set" : " sets") + " · " + reps + " reps · " + eff + " effective" : "No sets yet. Set the sliders and add one.";
      $("r-clear").hidden = !sets;
    }
    $("r-reps").addEventListener("input", paint); $("r-rir").addEventListener("input", paint);
    $("r-add").addEventListener("click", function () { var reps = val("r-reps"), rir = val("r-rir"); if (log.length < 30) log.push({ reps: reps, rir: rir, eff: F.effective(reps, rir) }); paintLog(); });
    $("r-clear").addEventListener("click", function () { log = []; paintLog(); });
    paint(); paintLog();
  });

  /* ---------- 3. 1RM & loads ---------- */
  boot(function () {
    // The lift is kept in kg; the field shows it in the chosen unit, so switching units never changes it.
    var liftKg = saved.loadKg > 0 ? +saved.loadKg : val("l-w");
    var units = seg($("l-units"), saved.loadUnits, "kg", function () { showLift(); calc(); });
    function showLift() { if (isFinite(liftKg)) $("l-w").value = Math.round((units.get() === "lb" ? F.lb(liftKg) : liftKg) * 10) / 10; }
    $("l-w").addEventListener("input", function () { var v = val("l-w"); liftKg = units.get() === "lb" ? F.kg(v) : v; calc(); });
    ["l-reps", "l-treps", "l-trir"].forEach(function (id) { $(id).addEventListener("input", calc); });
    if (saved.loadReps) $("l-reps").value = saved.loadReps;
    showLift();
    function wt(v) { return num(v, v % 1 ? 1 : 0); } // 85 → "85", 82.5 → "82.5"
    function calc() {
      var u = units.get(), step = u === "lb" ? 5 : 2.5, w = u === "lb" ? F.lb(liftKg) : liftKg, reps = val("l-reps"), tr = val("l-treps"), ti = val("l-trir");
      $("l-unit").textContent = u; $("l-treps-read").textContent = tr + (tr === 1 ? " rep" : " reps"); $("l-trir-read").textContent = ti + " in reserve";
      var ok = w > 0 && reps >= 1 && reps <= 20;
      $("l-out").classList.toggle("is-empty", !ok);
      if (!ok) {
        $("l-e1rm").firstChild.nodeValue = "—"; $("l-load").firstChild.nodeValue = "—"; $("l-rows").innerHTML = ""; $("l-pct").textContent = "";
        $("l-note").textContent = "Enter a weight and the reps you got with it (20 at most).";
        say("l-say", "Enter a weight and the reps you got with it.");
        return;
      }
      // Epley gives the estimate and, inverted, every load below, so the numbers agree with
      // each other: the load for the reps you entered at 0 RIR is the weight you entered.
      var e = F.epley(w, reps), b = F.brzycki(w, reps), one = e;
      $("l-e1rm").firstChild.nodeValue = num(one, one < 100 ? 1 : 0); $("l-e1rm-u").textContent = u;
      $("l-epley").textContent = num(e, 1) + " " + u; $("l-brzycki").textContent = num(b, 1) + " " + u;
      var load = F.loadFor(one, tr, ti);
      $("l-load").firstChild.nodeValue = wt(F.round(load, step)); $("l-load-u").textContent = u;
      $("l-pct").textContent = "≈ " + num(load / one * 100) + "% of the estimate · rounded to the nearest " + step + " " + u;
      $("l-note").textContent = reps > 10 ? "Above 10 reps these equations drift. Treat this as a rough guide and re-test with a heavier set." : reps === 1 ? "A true single: the estimate is simply what you lifted." : "Estimated from " + wt(Math.round(w * 10) / 10) + " " + u + " × " + reps + ".";
      $("l-rows").innerHTML = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6].map(function (p) {
        return "<tr><th scope=\"row\">" + Math.round(p * 100) + "%</th><td>" + wt(F.round(one * p, step)) + " " + u + "</td><td>≈ " + Math.max(1, Math.round(F.repsAt(p))) + "</td></tr>";
      }).join("");
      say("l-say", "Estimated one-rep max " + wt(Math.round(one * 10) / 10) + " " + u + ". Load " + wt(F.round(load, step)) + " " + u + " for " + tr + (tr === 1 ? " rep" : " reps") + " with " + ti + " in reserve.");
      store.set({ loadUnits: u, loadKg: liftKg, loadReps: reps });
    }
    calc();
  });

  /* ---------- 4. travel workout ---------- */
  boot(function () {
    var time = seg($("t-time"), saved.tMin, "20", build), level = seg($("t-level"), saved.tLevel, "2", build), format = seg($("t-format"), saved.tFormat, "circuit", build);
    var seed = Math.floor(Math.random() * 1e9), last = null;
    var toggles = [].slice.call($("t-equip").querySelectorAll("button[value]"));
    (saved.tEquip || []).forEach(function (k) { toggles.forEach(function (b) { if (b.value === k) b.setAttribute("aria-pressed", "true"); }); });
    $("t-equip").addEventListener("click", function (e) {
      var b = e.target.closest("button[value]"); if (!b) return;
      b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"); build();
    });
    $("t-again").addEventListener("click", function () { seed = Math.floor(Math.random() * 1e9); build(); });
    $("t-copy").addEventListener("click", function () { if (last) copy(F.travelText(last), $("t-copy")); });
    function build() {
      var equip = toggles.filter(function (b) { return b.getAttribute("aria-pressed") === "true"; }).map(function (b) { return b.value; });
      var s = last = F.travel({ equip: equip, minutes: +time.get(), level: +level.get(), format: format.get(), seed: seed });
      function items(list) { return list.map(function (it) { return "<li>" + (it.tag ? '<span class="tag">' + esc(it.tag) + "</span>" : "") + "<b>" + esc(it.name) + "</b><em>" + esc(it.dose) + "</em></li>"; }).join(""); }
      $("t-out").innerHTML =
        '<p class="k-label">' + esc(s.kit) + '</p><h3 class="k-h3">' + esc(s.title.charAt(0).toUpperCase() + s.title.slice(1)) + '</h3>' +
        '<div class="wk"><h4>Warm-up · ' + s.warmMin + ' min</h4><ul class="plain">' + s.warm.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + '</ul></div>' +
        '<div class="wk wk--main"><h4>Main</h4><p class="rule">' + esc(s.rule) + '</p>' +
          s.main.map(function (blk) { return '<p class="blk">' + esc(blk.title) + '</p><ol class="moves">' + items(blk.items) + '</ol>'; }).join("") + '</div>' +
        '<div class="wk"><h4>Cool-down · ' + s.coolMin + ' min</h4><ul class="plain">' + s.cool.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + '</ul></div>' +
        (s.loaded ? '<p class="k-small">Weighted moves: pick a load that leaves about two reps in reserve.</p>' : '');
      say("t-say", "Built: " + s.title + ", " + s.main.reduce(function (n, blk) { return n + blk.items.length; }, 0) + " moves.");
      store.set({ tMin: +time.get(), tLevel: +level.get(), tFormat: format.get(), tEquip: equip });
    }
    build();
  });

  /* ---------- Vantix instrument: tap a row to read its state ---------- */
  boot(function () {
    var box = $("vx-rows"); if (!box) return;
    var out = $("vx-read"), rows = [].slice.call(box.querySelectorAll("button"));
    function pick(btn) {
      rows.forEach(function (r) { r.setAttribute("aria-pressed", r === btn ? "true" : "false"); });
      out.textContent = btn.getAttribute("data-read");
    }
    box.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) pick(b); });
  });

  /* ---------- 5. meet attempts ---------- */
  boot(function () {
    if (!$("a-rows")) return;
    var LIFTS = [["squat", "Squat", "a-squat"], ["bench", "Bench", "a-bench"], ["dead", "Deadlift", "a-dead"]];
    var NOTES = {
      first: "First meet: an opener you could triple on a bad day and a third just under your best. The aim is nine good lifts.",
      standard: "Standard: open near 91% and finish on your current best.",
      bold: "Chasing PRs: the third is a small personal best. Take it only if the second moved well."
    };
    var sv = saved.att || {}, kg = {};
    var units = seg($("a-units"), sv.units, "kg", function () { show(); calc(); });
    var style = seg($("a-style"), sv.style, "first", calc);
    var warm = seg($("a-warm"), sv.warm, "squat", calc);
    LIFTS.forEach(function (l) {
      kg[l[0]] = sv[l[0]] > 0 ? +sv[l[0]] : val(l[2]);   // kept in kg, shown in the chosen unit
      $(l[2]).addEventListener("input", function () { var v = val(l[2]); kg[l[0]] = units.get() === "lb" ? F.kg(v) : v; calc(); });
    });
    function show() {
      var u = units.get();
      LIFTS.forEach(function (l) { if (isFinite(kg[l[0]])) $(l[2]).value = Math.round((u === "lb" ? F.lb(kg[l[0]]) : kg[l[0]]) * 10) / 10; });
      [].forEach.call(document.querySelectorAll(".a-unit"), function (el) { el.textContent = u; });
    }
    function wt(v) { return num(v, v % 1 ? 1 : 0); }
    // A meet loads kilograms, so kilograms always lead; pounds follow when that is the chosen unit.
    function cell(v) { return wt(v) + " kg" + (units.get() === "lb" ? "<small>" + num(F.lb(v)) + " lb</small>" : ""); }
    function calc() {
      var st = style.get(), sets = {}, valid = 0;
      $("a-style-note").textContent = NOTES[st];
      $("a-rows").innerHTML = LIFTS.map(function (l) {
        var ok = kg[l[0]] > 0; if (ok) { sets[l[0]] = F.attempts(kg[l[0]], st); valid++; }
        return "<tr><th scope=\"row\">" + l[1] + "</th>" + (ok ? sets[l[0]].map(function (v) { return "<td>" + cell(v) + "</td>"; }).join("") : "<td colspan=\"3\">Enter your best single.</td>") + "</tr>";
      }).join("");
      var allIn = valid === LIFTS.length;
      $("a-out").classList.toggle("is-empty", !allIn);
      function sum(i) { return LIFTS.reduce(function (t, l) { return t + sets[l[0]][i]; }, 0); }
      $("a-total").innerHTML = allIn ? cell(sum(2)) : "—";
      $("a-total2").innerHTML = allIn ? cell(sum(1)) : "—";
      var w = warm.get(), name = LIFTS.filter(function (l) { return l[0] === w; })[0][1];
      $("a-warm-h").textContent = name + " warm-up ladder";
      $("a-ladder").innerHTML = sets[w] ? F.warmups(sets[w][0]).map(function (x) {
        return "<li><span>" + wt(x.kg) + " kg" + (units.get() === "lb" ? " · " + num(F.lb(x.kg)) + " lb" : "") + "</span><span>× " + x.reps + "</span></li>";
      }).join("") + "<li><span>" + wt(sets[w][0]) + " kg</span><span>opener, on the platform</span></li>" : "";
      say("a-say", allIn ? "Suggested openers: squat " + wt(sets.squat[0]) + ", bench " + wt(sets.bench[0]) + ", deadlift " + wt(sets.dead[0]) + " kilograms. Total if every third goes: " + wt(sum(2)) + " kilograms."
        : "Enter your best single for each lift.");
      store.set({ att: { units: units.get(), style: st, warm: w, squat: kg.squat, bench: kg.bench, dead: kg.dead } });
    }
    show(); calc();
  });

  /* ---------- The reference: field guide, claims, numbers, tables, glossary ----------
     Every entry is already in the page (scripts/build_fitness.py writes it), so this only
     hides, counts and reorders. One "area" lens is shared by all five lists; each list
     adds its own facets, search box and sort. */
  boot(function () {
    var guide = $("g-list"); if (!guide) return;
    var AREAS = ["hypertrophy", "powerlifting", "meet", "nutrition", "diet", "health"];
    var CONF = ["strong", "rule", "moderate", "limited", "practice"], LEVEL = ["beginner", "intermediate", "advanced"];
    var VERD = ["true", "mostly", "depends", "overstated", "false"];
    var EVID = ["meta-analysis", "guideline", "position", "rct", "rulebook", "review", "cohort", "mixed"];
    var area = "all", lists = [];
    function all(sel, root) { return [].slice.call((root || document).querySelectorAll(sel)); }
    function attr(el, name) { return el.getAttribute("data-" + name) || ""; }
    function rank(list, v) { var i = list.indexOf(v); return i < 0 ? 99 : i; }
    function words(input) { return input ? input.value.toLowerCase().split(/\s+/).filter(Boolean) : []; }
    function byOrder(a, b) { return attr(a, "o") - attr(b, "o"); }
    function reorder(parent, els, cmp) { els.slice().sort(function (a, b) { return cmp(a, b) || byOrder(a, b); }).forEach(function (el) { parent.appendChild(el); }); }

    // A filterable list. cfg: items, noun, lens, facets {name: {el, test(el, value)}}, q, count, empty, after(state, shown, active)
    function makeList(cfg) {
      var rows = cfg.items.map(function (el) { return { el: el, d: attr(el, "d"), text: el.textContent.toLowerCase() }; });
      var facets = cfg.facets || {}, names = Object.keys(facets), state = {};
      names.forEach(function (n) { state[n] = "all"; });
      function ok(r, skip, w) {
        if (skip !== "area" && area !== "all" && r.d !== area) return false;
        for (var i = 0; i < names.length; i++) { var n = names[i]; if (n !== skip && state[n] !== "all" && !facets[n].test(r.el, state[n])) return false; }
        for (var j = 0; j < w.length; j++) if (r.text.indexOf(w[j]) < 0) return false;
        return true;
      }
      function apply() {
        var w = words(cfg.q), shown = 0;
        rows.forEach(function (r) { var v = ok(r, null, w); r.el.hidden = !v; if (v) shown++; });
        names.forEach(function (n) {
          all("button.fx", facets[n].el).forEach(function (b) {
            b.setAttribute("aria-pressed", b.value === state[n] ? "true" : "false");
            var c = b.querySelector("b"); if (!c) return;
            var k = 0; rows.forEach(function (r) { if (ok(r, n, w) && facets[n].test(r.el, b.value)) k++; });
            c.textContent = k; b.classList.toggle("is-zero", k === 0);
          });
        });
        if (cfg.lens) all("button", cfg.lens).forEach(function (b) {
          b.setAttribute("aria-pressed", b.value === area ? "true" : "false");
          var c = b.querySelector("b"); if (!c) return;
          var k = 0; rows.forEach(function (r) { if (r.d === b.value && ok(r, "area", w)) k++; });
          c.textContent = k;
        });
        var active = (area !== "all" ? 1 : 0) + names.filter(function (n) { return state[n] !== "all"; }).length + (w.length ? 1 : 0);
        if (cfg.count) {
          cfg.count.textContent = "Showing " + shown + " of " + rows.length + " " + cfg.noun + (active ? ". " : "");
          if (active) { var x = document.createElement("button"); x.type = "button"; x.className = "k-linkbtn"; x.textContent = "Clear filters"; x.addEventListener("click", function () { api.reset(); setArea("all"); }); cfg.count.appendChild(x); }
        }
        if (cfg.empty) cfg.empty.hidden = shown !== 0;
        if (cfg.after) cfg.after(state, shown, active);
      }
      names.forEach(function (n) {
        facets[n].el.addEventListener("click", function (e) { var b = e.target.closest("button.fx"); if (!b) return; state[n] = b.value; apply(); });
      });
      if (cfg.q) cfg.q.addEventListener("input", apply);
      var api = { apply: apply, state: state, rows: rows, reset: function () { names.forEach(function (n) { state[n] = "all"; }); if (cfg.q) cfg.q.value = ""; } };
      lists.push(api);
      return api;
    }
    function applyAll() { lists.forEach(function (l) { l.apply(); }); }
    function setArea(v, quiet) {
      area = AREAS.indexOf(v) >= 0 ? v : "all";
      if (gList) gList.state.topic = "all";
      applyAll();
      if (!quiet) history.replaceState(null, "", area === "all" ? location.pathname + location.search : "#" + area);
    }
    function lensOf(id) { var sec = $(id); return sec ? sec.querySelector(".lens") : null; }
    all(".lens").forEach(function (lens) {
      lens.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) setArea(b.value); });
    });
    function facetEl(root, name) { return root.querySelector('[data-facet="' + name + '"]'); }
    function eq(name) { return function (el, v) { return attr(el, name) === v; }; }

    // ---- field guide
    var gHeads = all(".g-head", guide), gItems = all("details.g", guide), gRail = $("g-rail"), gTopic = facetEl(gRail, "topic");
    var gList = makeList({
      items: gItems, noun: "entries", lens: lensOf("guide"), q: $("g-q"), count: $("g-count"), empty: $("g-empty"),
      facets: {
        kind: { el: facetEl(gRail, "kind"), test: eq("k") },
        level: { el: facetEl(gRail, "level"), test: eq("l") },
        conf: { el: facetEl(gRail, "conf"), test: eq("c") },
        topic: { el: gTopic, test: function (el, v) { return attr(el, "d") + ":" + attr(el, "tp") === v; } }
      },
      after: function (state, shown, active) {
        var sorted = $("g-sort").value !== "suggested";
        gHeads.forEach(function (h) { h.hidden = sorted || !gItems.some(function (el) { return !el.hidden && attr(el, "d") === attr(h, "d"); }); });
        gTopic.hidden = area === "all";   // topics only make sense inside one area
        all("button.fx[data-d]", gTopic).forEach(function (b) { b.hidden = attr(b, "d") !== area; });
        $("g-active").textContent = active ? "· " + active + " on" : "";
      }
    });
    function title(el) { var t = el.querySelector(".g-title") || el.querySelector("summary") || el; return t.textContent.toLowerCase(); }
    $("g-sort").addEventListener("change", function () {
      var v = this.value;
      if (v === "suggested") reorder(guide, gHeads.concat(gItems), function () { return 0; });
      else reorder(guide, gItems, {
        az: function (a, b) { return title(a) < title(b) ? -1 : title(a) > title(b) ? 1 : 0; },
        conf: function (a, b) { return rank(CONF, attr(a, "c")) - rank(CONF, attr(b, "c")); },
        level: function (a, b) { return rank(LEVEL, attr(a, "l")) - rank(LEVEL, attr(b, "l")); },
        newest: function (a, b) { return attr(b, "y") - attr(a, "y"); }
      }[v]);
      gList.apply();
    });
    $("g-open").addEventListener("click", function () {
      var on = this.getAttribute("aria-pressed") !== "true";
      this.setAttribute("aria-pressed", on ? "true" : "false"); this.textContent = on ? "Close all" : "Open all";
      gItems.forEach(function (el) { if (!el.hidden || !on) el.open = on; });
    });
    // the filter rail is a side column on wide screens and a closed drawer on small ones
    var wide = window.matchMedia("(min-width: 1000px)"), drawer = $("g-filters");
    function fitDrawer() { drawer.open = wide.matches; }
    fitDrawer(); if (wide.addEventListener) wide.addEventListener("change", fitDrawer); else wide.addListener(fitDrawer);

    // ---- claims
    var qBox = $("q-list"), qCtl = $("q-controls"), qItems = all("details.q", qBox);
    var qList = makeList({
      items: qItems, noun: "claims", lens: lensOf("claims"), q: $("q-q"), count: $("q-count"), empty: $("q-empty"),
      facets: {
        verdict: { el: facetEl(qCtl, "verdict"), test: eq("v") },
        tag: { el: facetEl(qCtl, "tag"), test: function (el, v) { return (" " + attr(el, "tags") + " ").indexOf(" " + v + " ") >= 0; } },
        evidence: { el: facetEl(qCtl, "evidence"), test: eq("e") }
      }
    });
    $("q-sort").addEventListener("change", function () {
      reorder(qBox, qItems, {
        suggested: function () { return 0; },
        verdict: function (a, b) { return rank(VERD, attr(a, "v")) - rank(VERD, attr(b, "v")); },
        "verdict-rev": function (a, b) { return rank(VERD, attr(b, "v")) - rank(VERD, attr(a, "v")); },
        az: function (a, b) { return title(a) < title(b) ? -1 : title(a) > title(b) ? 1 : 0; },
        evidence: function (a, b) { return rank(EVID, attr(a, "e")) - rank(EVID, attr(b, "e")); },
        newest: function (a, b) { return attr(b, "y") - attr(a, "y"); }
      }[this.value]);
    });

    // ---- key numbers: the lens filters, the column headings sort
    var nTable = $("n-table");
    if (nTable) {
      var nBody = nTable.tBodies[0], nRows = all("tr", nBody), nKey = null, nDir = 1;
      makeList({ items: nRows, noun: "numbers", lens: lensOf("numbers"), empty: $("n-empty") });
      var nGet = {
        n: function (r) { return +attr(r, "n"); }, t: function (r) { return r.cells[1].textContent.toLowerCase(); },
        d: function (r) { return rank(AREAS, attr(r, "d")); }, c: function (r) { return rank(CONF, attr(r, "c")); }
      };
      all("thead button", nTable).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var k = attr(btn, "sort"); nDir = nKey === k ? -nDir : 1; nKey = k;
          reorder(nBody, nRows, function (a, b) { var x = nGet[k](a), y = nGet[k](b); return (x < y ? -1 : x > y ? 1 : 0) * nDir; });
          all("thead th", nTable).forEach(function (th) { th.removeAttribute("aria-sort"); });
          btn.parentNode.setAttribute("aria-sort", nDir > 0 ? "ascending" : "descending");
        });
      });
    }

    // ---- reference tables and glossary
    makeList({ items: all("#t-list details.rt"), noun: "tables", lens: lensOf("tables"), empty: $("t-empty") });
    makeList({ items: all("#gl-list .gl-item"), noun: "terms", lens: lensOf("glossary"), q: $("gl-q"), count: $("gl-count"), empty: $("gl-empty") });

    all("[data-reset]").forEach(function (b) { b.addEventListener("click", function () { lists.forEach(function (l) { l.reset(); }); setArea("all"); }); });

    // ---- the meet bag: ticks are remembered in this browser
    all(".ck").forEach(function (box) {
      var key = attr(box, "ck"), inputs = all("input[type=checkbox]", box), out = box.querySelector(".ck-n");
      var ticks = (store.get().ck || {})[key] || [];
      inputs.forEach(function (i) { i.checked = ticks.indexOf(+attr(i, "i")) >= 0; });
      function save() {
        var on = inputs.filter(function (i) { return i.checked; }).map(function (i) { return +attr(i, "i"); });
        var ck = store.get().ck || {}; ck[key] = on; store.set({ ck: ck }); out.textContent = on.length;
      }
      out.textContent = inputs.filter(function (i) { return i.checked; }).length;
      box.addEventListener("change", save);
      box.querySelector(".ck-clear").addEventListener("click", function () { inputs.forEach(function (i) { i.checked = false; }); save(); });
    });

    // ---- links: #hypertrophy and friends choose an area; #<entry id> opens that entry
    function reveal(id) {
      if (!id) return false;
      if (AREAS.indexOf(id) >= 0) { setArea(id, true); var top = $("guide").getBoundingClientRect().top + window.scrollY - 100; window.scrollTo(0, top); return true; }
      var el = $(id);
      if (!el || !el.matches("details.g, details.q, details.rt, .gl-item, #n-table tr, .ck")) return false;
      if (el.hidden) { lists.forEach(function (l) { l.reset(); }); setArea("all", true); }
      if (el.tagName === "DETAILS") el.open = true;
      el.scrollIntoView({ block: "center" });
      return true;
    }
    window.addEventListener("hashchange", function () { reveal(location.hash.slice(1)); });
    applyAll();
    if (location.hash) setTimeout(function () { reveal(location.hash.slice(1)); }, 90);
  });

  booting = false; // from here on, changes are announced
})();
