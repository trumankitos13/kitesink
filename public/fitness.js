/* ===================== KiteSink — fitness tools =====================
   The five calculators on /fitness, and the search box over the field
   guide. Plain JS, no dependencies, nothing leaves the browser (inputs
   are remembered in localStorage only). The pages under /fitness/ use
   /fitness-ref.js instead.

   The maths and the search ranking live in KSFit (pure functions,
   exported on window so they can be checked from the console or a
   test); the bottom half wires those functions to the page.

   Formulas and their sources (full references on /fitness/sources):
     • Resting energy  — Mifflin-St Jeor (1990): 10·kg + 6.25·cm − 5·age + 5 (men) / − 161 (women)
                         or, when body-fat % is given, Cunningham (1991): 370 + 21.6·FFM
     • Maintenance     — resting energy × physical activity level (FAO/WHO/UNU 2004 bands)
     • 1RM             — Epley: w·(1 + r/30)   ·   Brzycki (1993): w·36/(37 − r)
                         The tool uses their mean up to 10 reps and Epley alone above; they meet at 10.
     • Effective reps  — a coaching heuristic, not a measured quantity: the reps that
                         fall inside the last five before failure
     • Meet attempts   — a coaching convention: fixed fractions of a current best single,
                         rounded to the 2.5 kg a meet loads
   ================================================================== */
(function () {
  "use strict";

  var LB = 2.2046226218, KCAL_PER_KG = 7700; // 7,700 kcal/kg is the usual rule of thumb, not a constant

  // One-rep-max factor: estimate = weight × factor(reps). Up to ten reps it is the mean of
  // the Epley and Brzycki factors, which sit either side of the usual percentage charts
  // (two reps → 95.5%). Above ten it is Epley alone: the two are equal at ten reps, so there
  // is no step, and Brzycki drifts badly past that. One rep is always the weight itself.
  function e1Factor(r) { return r <= 1 ? 1 : r <= 10 ? ((1 + r / 30) + 36 / (37 - r)) / 2 : 1 + r / 30; }

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
    // the estimate the load tool uses (see e1Factor)
    oneRm: function (w, r) { return w * e1Factor(r); },
    // load to use for `reps` reps with `rir` left in the tank: the same estimate, inverted
    loadFor: function (oneRm, reps, rir) { return oneRm / e1Factor(reps + rir); },

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
    // reps to failure at a fraction of the estimate: e1Factor inverted by bisection
    repsAt: function (pct) {
      var target = 1 / pct, lo = 1, hi = 60, mid;
      if (!(target > 1)) return 1;
      for (var i = 0; i < 50; i++) { mid = (lo + hi) / 2; if (e1Factor(mid) < target) lo = mid; else hi = mid; }
      return (lo + hi) / 2;
    }
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

  /* ---------- search over the field guide ----------
     index is /fitness/search.json, written by scripts/build_fitness.py:
       { pages, kinds, areas, rows: [[id, page, kind, area, title, short answer, extra?], …] }
     where page, kind and area are positions in the three lists, and extra is a number's
     value or a claim's verdict. Every word of the query has to be in a row's title or short
     answer. A word in the title counts for more than one in the answer, the start of a word
     for more than the middle of one, and a title that is the query comes first.
     Returns { total, hits: [{ id, href, title, take, kind, area, extra }] }, best first. */
  function wordHit(text, w) {   // 2: w starts a word of text, 1: w is inside one, 0: not there
    var i = text.indexOf(w), found = 0;
    while (i >= 0) {
      if (i === 0 || !/[a-z0-9]/.test(text.charAt(i - 1))) return 2;
      found = 1; i = text.indexOf(w, i + 1);
    }
    return found;
  }
  F.search = function (index, query, limit) {
    var text = String(query == null ? "" : query).toLowerCase().replace(/\s+/g, " ").replace(/^ | $/g, "");
    var words = text ? text.split(" ") : [], rows = (index && index.rows) || [], scored = [];
    if (!words.length) return { total: 0, hits: [] };
    if (!index.lower) index.lower = rows.map(function (r) { return [String(r[4]).toLowerCase(), String(r[5]).toLowerCase()]; });
    rows.forEach(function (r, n) {
      var title = index.lower[n][0], take = index.lower[n][1], score = 0;
      for (var i = 0; i < words.length; i++) {
        var t = wordHit(title, words[i]), a = t ? 0 : wordHit(take, words[i]);
        if (!t && !a) return;
        score += t === 2 ? 8 : t === 1 ? 4 : a === 2 ? 2 : 1;
      }
      if (title === text) score += 20; else if (title.indexOf(text) === 0) score += 10; else if (title.indexOf(text) > 0) score += 3;
      scored.push([score, n]);
    });
    scored.sort(function (x, y) { return y[0] - x[0] || x[1] - y[1]; });
    var hits = (limit > 0 ? scored.slice(0, limit) : scored).map(function (s) {
      var r = rows[s[1]];
      return { id: r[0], href: "/fitness/" + index.pages[r[1]] + "#" + r[0], title: r[4], take: r[5],
        kind: index.kinds[r[2]], area: index.areas[r[3]], extra: r[6] || "" };
    });
    return { total: scored.length, hits: hits };
  };
  /* ---------- diet planner: a 7- or 14-day plan of day types ----------
     Each day's maintenance = resting energy × a daily-life factor (no training) + that day's
     session. Day types: "vlow" (very low), "maint" (maintenance), "surplus", and "flex" days,
     which absorb whatever is left of the plan's target balance and show as low or surplus.
     Sources (content/fitness/tools.json): FAO/WHO/UNU 2004 table 5.3 for the daily-life bands,
     Tudor-Locke 2004 for the step counts, the 2024 Adult Compendium for session METs,
     Trepanowski 2017 for a very low day at 25% of needs, NICE NG246 for the 1,200 kcal floor,
     Hall 2008 for 7,700 kcal per kg. */
  var PLAN = {
    // Daily life, not counting training sessions. 1.40, 1.70 and 2.00 are the floors of the FAO
    // bands; 1.53 is FAO's worked example of an office job with an hour of walking.
    LIFE: { desk: 1.4, walk: 1.53, feet: 1.7, labour: 2.0 },
    // m: METs from the 2024 Adult Compendium (code in c); hard: counts as a hard session when
    // the planner places day types (a KiteSink convention, not a study result)
    SESSIONS: {
      rest: { m: 1, hard: false },
      liftHard: { m: 6.0, hard: true, c: "02050" },
      liftLight: { m: 3.5, hard: false, c: "02054" },
      walk: { m: 4.8, hard: false, c: "17200" },
      steady: { m: 7.5, hard: true, c: "12020" },
      hardCardio: { m: 10.0, hard: true, c: "01040" },
      intervals: { m: 8.8, hard: true, c: "01305" },
      circuits: { m: 7.5, hard: true, c: "02040" },
      mobility: { m: 2.3, hard: false, c: "02101" }
    },
    VLOW_SHARE: 0.25,   // a very low day eats 25% of that day's needs (Trepanowski 2017)
    FLOOR: 1200,        // average kcal a day; below it NICE NG246 sends people to specialist care
    BIG_DEFICIT: 25,    // % of maintenance; the macro tool warns at the same point
    EA_WARN: 30         // kcal per kg fat-free mass a day: a risk marker, not a safe floor
  };
  // Which day types each template asks for. "hard" days are the ones with a hard session.
  PLAN.TEMPLATES = {
    lose: {
      steady: function () { return { fixed: {}, hardKind: "flex", restKind: "flex" }; },
      train: function () { return { fixed: {}, hardKind: "maint", restKind: "flex" }; },
      two: function (len) { return { fixed: { vlow: 2 * len / 7 }, restKind: "maint" }; },
      alternate: function (len) { return { fixed: { vlow: Math.floor(len / 2) }, restKind: "maint" }; }
    },
    hold: {
      steady: function () { return { fixed: {}, hardKind: "maint", restKind: "maint" }; },
      train: function () { return { fixed: {}, hardKind: "surplus", restKind: "flex" }; }
    },
    gain: {
      steady: function () { return { fixed: {}, hardKind: "flex", restKind: "flex" }; },
      train: function () { return { fixed: {}, hardKind: "flex", restKind: "maint" }; }
    }
  };

  // Where very low days go: n of the `loads` (0 rest, 1 light, 2 hard), never two in a row
  // (the cycle wraps), never on a hard day, lightest days first. Every set of positions is
  // tried (at most 14 choose 7 = 3,432), so the answer is the best there is. clash = the
  // rules could not all be kept.
  F.placeVlow = function (loads, n) {
    var L = loads.length, best = null, bestScore = Infinity, pick = [];
    function score(set) {
      var s = 0;
      for (var i = 0; i < set.length; i++) {
        s += loads[set[i]] === 2 ? 1000 : loads[set[i]] * 10;
        if (set.indexOf((set[i] + 1) % L) >= 0) s += 100000;
        s += set[i] * 0.001; // earlier days first when all else is equal
      }
      return s;
    }
    (function walk(start) {
      if (pick.length === n) { var sc = score(pick); if (sc < bestScore) { bestScore = sc; best = pick.slice(); } return; }
      for (var i = start; i <= L - (n - pick.length); i++) { pick.push(i); walk(i + 1); pick.pop(); }
    })(0);
    return { days: best || [], adjacent: bestScore >= 100000, onHard: bestScore % 100000 >= 1000 };
  };

  /* plan(o) → the whole plan.
     o: sex, kg, cm, age, bf (optional), life (key of PLAN.LIFE), phase 'lose'|'hold'|'gain',
        template (key of PLAN.TEMPLATES[phase]), len 7|14, rate (lose: % body weight a week),
        surplus (% over maintenance), protein (g/kg), fatPct, week: [{ s: session key, min }] × 7,
        kinds (optional): a day-type list the person arranged by hand, used instead of placing */
  F.plan = function (o) {
    var useBf = o.bf > 0 && o.bf < 60;
    var rmr = useBf ? F.cunningham(o.kg, o.bf) : F.mifflin(o.sex, o.kg, o.cm, o.age);
    var life = PLAN.LIFE[o.life] || PLAN.LIFE.walk, L = o.len === 14 ? 14 : 7;
    var tplFn = (PLAN.TEMPLATES[o.phase] || PLAN.TEMPLATES.lose)[o.template] || PLAN.TEMPLATES[o.phase].steady;
    var tpl = tplFn(L), protG = o.protein * o.kg, protKcal = protG * 4;
    var days = [];
    for (var i = 0; i < L; i++) {
      var w = (o.week && o.week[i % 7]) || { s: "rest", min: 0 }, ses = PLAN.SESSIONS[w.s] || PLAN.SESSIONS.rest;
      var min = w.s === "rest" ? 0 : Math.max(0, +w.min || 0);
      var exKcal = (ses.m - 1) * o.kg * min / 60;   // net of the resting share already counted
      days.push({ i: i, session: w.s, min: min, hard: ses.hard && min > 0, load: ses.hard && min > 0 ? 2 : min > 0 ? 1 : 0,
                  exKcal: exKcal, maint: rmr * life + exKcal });
    }
    // day types: by hand, or placed
    var kinds, placed = { adjacent: false, onHard: false };
    if (o.kinds && o.kinds.length === L) kinds = o.kinds.slice();
    else {
      kinds = days.map(function (d) { return d.hard ? (tpl.hardKind || tpl.restKind) : tpl.restKind; });
      var nv = Math.round(tpl.fixed.vlow || 0);
      if (nv) { placed = F.placeVlow(days.map(function (d) { return d.load; }), nv); placed.days.forEach(function (j) { kinds[j] = "vlow"; }); }
    }
    // a training-days template with no days left to take up the target: every day takes a share
    if (!o.kinds && !tpl.fixed.vlow && kinds.indexOf("flex") < 0 && o.phase !== "hold") kinds = kinds.map(function () { return "flex"; });
    for (var a = 0; a < L; a++) {
      if (kinds[a] === "vlow" && kinds[(a + 1) % L] === "vlow") placed.adjacent = true;
      if (kinds[a] === "vlow" && days[a].hard) placed.onHard = true;
    }
    // the target balance over the cycle, then each day
    var totMaint = days.reduce(function (s, d) { return s + d.maint; }, 0);
    var target = o.phase === "lose" ? -(o.rate / 100) * o.kg * KCAL_PER_KG * L / 7 : o.phase === "gain" ? (o.surplus / 100) * totMaint : 0;
    var fixedBal = 0, flexMaint = 0;
    days.forEach(function (d, j) {
      d.kind = kinds[j];
      if (d.kind === "vlow") d.kcal = Math.max(PLAN.VLOW_SHARE * d.maint, protKcal * 1.1);
      else if (d.kind === "surplus") d.kcal = d.maint * (1 + o.surplus / 100);
      else if (d.kind === "maint") d.kcal = d.maint;
      if (d.kind !== "flex") fixedBal += d.kcal - d.maint; else flexMaint += d.maint;
    });
    var rest = target - fixedBal, clamped = false;
    days.forEach(function (d) {
      if (d.kind !== "flex") return;
      d.kcal = d.maint + rest * d.maint / flexMaint;
      var low = Math.max(PLAN.VLOW_SHARE * d.maint, protKcal * 1.1);
      if (d.kcal < low) { d.kcal = low; clamped = true; }
    });
    var totKcal = 0, totEx = 0;
    days.forEach(function (d) {
      var r = d.kcal / d.maint;
      d.type = d.kind === "vlow" ? "vlow" : r < 0.97 ? "low" : r > 1.03 ? "surplus" : "maint";
      d.protein = protG;
      d.fat = Math.max(0, Math.min(d.kcal * o.fatPct / 100, d.kcal - protKcal) / 9);
      d.carbs = Math.max(0, (d.kcal - protKcal - d.fat * 9) / 4);
      totKcal += d.kcal; totEx += d.exKcal;
    });
    var avgKcal = totKcal / L, avgMaint = totMaint / L, weekBal = (totKcal - totMaint) * 7 / L;
    var ffm = useBf ? o.kg * (1 - o.bf / 100) : NaN;
    return {
      days: days, len: L, rmr: rmr, life: life, equation: useBf ? "Cunningham" : "Mifflin-St Jeor",
      avgKcal: avgKcal, avgMaint: avgMaint, weekBalance: weekBal, weekKg: weekBal / KCAL_PER_KG,
      setsOwnRate: flexMaint === 0, clamped: clamped,
      adjacent: placed.adjacent, vlowOnHard: placed.onHard,
      belowFloor: avgKcal < PLAN.FLOOR, belowRmr: avgKcal < rmr,
      deficitPct: weekBal < 0 ? -weekBal / (avgMaint * 7) * 100 : 0,
      ea: useBf ? (avgKcal - totEx / L) / ffm : NaN
    };
  };
  // The fastest rate (% body weight a week, in steps of 0.05) a template can run without the
  // average falling under the floor, or 0 when none can.
  F.planMaxRate = function (o) {
    for (var r = 1; r >= 0.25 - 1e-9; r -= 0.05) {
      var p = F.plan(Object.assign({}, o, { rate: Math.round(r * 100) / 100 }));
      if (!p.belowFloor) return Math.round(r * 100) / 100;
    }
    return 0;
  };
  // A long fat-loss plan with a week at maintenance after every three (the ICECAP trial's
  // pattern, Peos 2021): which weeks are breaks, and the projected change over the plan.
  F.planWeeks = function (weeks, weekKg, breaks) {
    var out = [], kg = 0;
    for (var w = 1; w <= weeks; w++) { var br = breaks && w % 4 === 0; out.push(br ? "break" : "diet"); if (!br) kg += weekKg; }
    return { weeks: out, kg: kg, dietWeeks: out.filter(function (x) { return x === "diet"; }).length };
  };
  F.PLAN = PLAN;

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
      // One estimate (F.oneRm) gives the headline and, inverted, every load below, so the numbers
      // agree with each other: the load for the reps you entered at 0 RIR is the weight you entered.
      var e = F.epley(w, reps), b = F.brzycki(w, reps), one = F.oneRm(w, reps);
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
        '<div class="wk"><h3>Warm-up · ' + s.warmMin + ' min</h3><ul class="plain">' + s.warm.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + '</ul></div>' +
        '<div class="wk wk--main"><h3>Main</h3><p class="rule">' + esc(s.rule) + '</p>' +
          s.main.map(function (blk) { return '<p class="blk">' + esc(blk.title) + '</p><ol class="moves">' + items(blk.items) + '</ol>'; }).join("") + '</div>' +
        '<div class="wk"><h3>Cool-down · ' + s.coolMin + ' min</h3><ul class="plain">' + s.cool.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + '</ul></div>' +
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
      }).join("") + "<li><span>" + wt(sets[w][0]) + " kg" + (units.get() === "lb" ? " · " + num(F.lb(sets[w][0])) + " lb" : "") + "</span><span>opener, on the platform</span></li>" : "";
      say("a-say", allIn ? "Suggested openers: squat " + wt(sets.squat[0]) + ", bench " + wt(sets.bench[0]) + ", deadlift " + wt(sets.dead[0]) + " kilograms. Total if every third goes: " + wt(sum(2)) + " kilograms."
        : "Enter your best single for each lift.");
      store.set({ att: { units: units.get(), style: st, warm: w, squat: kg.squat, bench: kg.bench, dead: kg.dead } });
    }
    show(); calc();
  });

  /* ---------- search the field guide ----------
     The box is hidden in the HTML and shown here, so it is never there without the script
     that runs it. Its index (about a thousand short rows) is fetched the first time the box
     is used. Results are plain links, best first; the arrow keys move through them and
     Escape clears. The count is shown under the box and announced once typing settles. */
  boot(function () {
    var box = $("find"), q = $("f-q"); if (!box || !q) return;
    var count = $("f-count"), list = $("f-list"), more = $("f-more"), clear = $("f-clear");
    var FIRST = 20, index = null, state = "idle", all = false;   // state: idle | loading | failed
    box.hidden = false;
    function load(again) {   // a failed load is tried again only when asked: on the next keystroke
      if (index || state === "loading" || (state === "failed" && !again)) return;
      state = "loading";
      window.fetch("/fitness/search.json").then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (data) { index = data; state = "idle"; render(); }, function () { state = "failed"; render(); });
    }
    function tell(text) { count.textContent = text; say("f-say", text); }
    function render() {
      var text = q.value.replace(/\s+/g, " ").replace(/^ | $/g, "");
      clear.hidden = !q.value;
      if (!text || !index) {
        list.hidden = true; list.innerHTML = ""; more.hidden = true;
        tell(!text ? "" : state === "failed" ? "The search index did not load. Check your connection, then type again." : "Loading the index.");
        return;
      }
      var found = F.search(index, text), hits = all ? found.hits : found.hits.slice(0, FIRST);
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
    function reset() { q.value = ""; all = false; render(); q.focus(); }
    q.addEventListener("focus", function () { load(false); });
    q.addEventListener("input", function () { all = false; load(true); render(); });
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
    more.addEventListener("click", function () {
      var had = links().length; all = true; render();
      var next = links()[had]; if (next) next.focus();   // carry on from the first new result
    });
    clear.addEventListener("click", reset);
    if (q.value) { load(true); render(); }   // a browser can restore the text when you come Back to the page
  });

  booting = false; // from here on, changes are announced
})();
