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
    ATTEMPT_STYLES: { first: [0.85, 0.90, 0.95], standard: [0.91, 0.96, 1], bold: [0.92, 0.975, 1.025] },
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
  /* ---------- diet planner: a week of diet days and maintenance days ----------
     Maintenance is one figure a day: resting energy × an activity level that already counts
     training (the macro tool's FAO/WHO/UNU bands), or the person's own tracked figure. Losing
     fat, a chosen number of days a week are diet days at a chosen share below maintenance; the
     rest stay at maintenance. Everything else follows from that: the weekly deficit, protein,
     and the lowest a diet day can go. Sources are in content/fitness/tools.json. */
  var PLAN = {
    VLOW_SHARE: 0.25,  // a diet day never goes under 25% of maintenance (Trepanowski 2017's fast days)
    FLOOR: 1200,       // the week's average a day; below it NICE NG246 means specialist care
    BIG_DEFICIT: 25,   // % of the week's maintenance: protein tops out here, and a warning shows
    EA_WARN: 30,       // kcal per kg fat-free mass a day: a risk marker, not a safe floor
    FAT_SHARE: 0.25,   // fat as a share of each day's calories: a convention inside FAO/WHO 2010's 15-35%
    EFA_SHARE: 0.03,   // linoleic plus alpha-linolenic acid, at least 2.5% + 0.5% of energy (FAO/WHO 2010)
    FIBRE_G: 25,       // grams a day of total dietary fibre, at least (FAO/WHO 2003)
    GAIN: [5, 10, 15]  // surplus options, % over maintenance (Helms 2023 compared 5 and 15)
  };
  // Protein in g a day. Losing fat it rises with the deficit, as Helms 2014 says needs do:
  // 2.3 to 3.1 g per kg of fat-free mass when body fat is known; without it 1.6 to 2.3 g per kg
  // of body weight, so a person with a lot of body fat is not over-served. Otherwise 1.6 g/kg
  // (Nunes 2022). The straight line between the ends is a convention.
  F.planProtein = function (kg, bf, phase, deficitPct) {
    if (phase !== "lose") return 1.6 * kg;
    var t = Math.max(0, Math.min(deficitPct, PLAN.BIG_DEFICIT)) / PLAN.BIG_DEFICIT;
    return bf > 0 && bf < 60 ? kg * (1 - bf / 100) * (2.3 + 0.8 * t) : kg * (1.6 + 0.7 * t);
  };
  // Which days are diet days: n of L, rest days (training false) first, spread out evenly.
  F.planPlace = function (train, n, L) {
    var days = [], out = [];
    for (var i = 0; i < L; i++) days.push(i);
    var ideal = days.map(function (i) { return (i + 0.5) * L / n; });
    // greedy: rest days first; among them the ones closest to an even spacing
    var free = days.slice(), pick = [];
    for (var k = 0; k < n; k++) {
      var target = (k + 0.5) * L / n, best = null, bestScore = Infinity;
      free.forEach(function (d) {
        var s = (train[d % 7] ? 100 : 0) + Math.min(Math.abs(d - target), L - Math.abs(d - target));
        pick.forEach(function (q) { if (Math.abs(q - d) === 1 || Math.abs(q - d) === L - 1) s += 0.5; });
        if (s < bestScore) { bestScore = s; best = d; }
      });
      pick.push(best); free.splice(free.indexOf(best), 1);
    }
    for (var j = 0; j < L; j++) out.push(pick.indexOf(j) >= 0);
    return out;
  };
  function dayMacros(kcal, protein, maint) {
    var efa = PLAN.EFA_SHARE * maint / 9;                     // g of linoleic + alpha-linolenic
    var fat = Math.max(kcal * PLAN.FAT_SHARE / 9, efa);
    fat = Math.min(fat, Math.max(efa, (kcal - protein * 4) / 9));
    return { kcal: kcal, protein: protein, fat: fat, carbs: Math.max(0, (kcal - protein * 4 - fat * 9) / 4) };
  }
  /* plan(o) → the week.
     o: sex, kg, cm, age, bf (optional), pal, maint (optional: the person's own figure),
        phase 'lose'|'hold'|'gain', days (diet days a week, 0.5 steps), size (% below maintenance
        on a diet day), gain (% surplus), train: 7 booleans, diet (optional): L booleans set by hand */
  F.plan = function (o) {
    var useBf = o.bf > 0 && o.bf < 60;
    var rmr = useBf ? F.cunningham(o.kg, o.bf) : F.mifflin(o.sex, o.kg, o.cm, o.age);
    var own = o.maint > 0, maint = own ? o.maint : rmr * o.pal;
    var res = { rmr: rmr, maint: maint, own: own, equation: useBf ? "Cunningham" : "Mifflin-St Jeor", phase: o.phase };
    if (o.phase !== "lose") {
      var kcal = o.phase === "gain" ? maint * (1 + o.gain / 100) : maint, p = F.planProtein(o.kg, o.bf, o.phase, 0);
      res.len = 7; res.diet = [false, false, false, false, false, false, false];
      res.dietDay = null; res.maintDay = dayMacros(kcal, p, maint);
      res.weekBalance = (kcal - maint) * 7; res.avgKcal = kcal; res.deficitPct = 0;
      res.weekKg = res.weekBalance / KCAL_PER_KG; res.protein = p;
      res.minSize = 0; res.maxSize = 0;
      return res;
    }
    var L = Math.round(o.days * 2) % 2 ? 14 : 7, n = Math.round(o.days * L / 7);
    var diet = o.diet && o.diet.length === L ? o.diet.slice() : F.planPlace(o.train || [], n, L);
    n = diet.filter(Boolean).length;
    // the deepest a diet day can go: protein (at the deficit that size makes) + essential fat,
    // or 25% of maintenance, whichever is more; and the week's average must stay at 1,200 or more
    function at(size) {
      var dk = maint * (1 - size / 100), wb = -(maint - dk) * n * 7 / L, dp = -wb / (maint * 7) * 100;
      var pr = F.planProtein(o.kg, o.bf, "lose", dp);
      return { dk: dk, wb: wb, dp: dp, pr: pr, low: Math.max(pr * 4 + PLAN.EFA_SHARE * maint, PLAN.VLOW_SHARE * maint),
               avg: maint + wb / 7 };
    }
    var maxSize = 10;
    for (var sz = 10; sz <= 75; sz++) { var t = at(sz); if (t.dk < t.low - 1e-9 || t.avg < PLAN.FLOOR) break; maxSize = sz; }
    var floorBinds = at(10).avg < PLAN.FLOOR;
    var size = Math.max(10, Math.min(o.size, maxSize)), c = at(size);
    res.len = L; res.diet = diet; res.n = n; res.daysPerWeek = n * 7 / L;
    res.size = size; res.minSize = 10; res.maxSize = maxSize; res.clampedSize = o.size > maxSize; res.floorBinds = floorBinds;
    res.protein = c.pr; res.deficitPct = c.dp; res.weekBalance = c.wb; res.weekKg = c.wb / KCAL_PER_KG; res.avgKcal = c.avg;
    res.dietDay = n ? dayMacros(c.dk, c.pr, maint) : null; res.maintDay = dayMacros(maint, c.pr, maint);
    res.dietOnTraining = diet.filter(function (d, i) { return d && o.train && o.train[i % 7]; }).length;
    res.belowFloor = c.avg < PLAN.FLOOR;
    res.ea = useBf ? c.avg / (o.kg * (1 - o.bf / 100)) : NaN;   // intake per kg FFM; training energy is inside maintenance, so this is an upper bound
    return res;
  };
  F.PLAN = PLAN;

  /* ---------- navy body fat ----------
     Hodgdon & Beckett (1984), the US Navy circumference equations, in inches as the Navy and the
     DoD print them. Men: abdomen at the navel; women: waist at the narrowest and hips at the widest.
     navy(sex, height, neck, waist, hip) takes centimetres and returns % body fat, or NaN when the
     tape readings cannot be right (waist not bigger than neck, a non-positive log). */
  F.navy = function (sex, hCm, neckCm, waistCm, hipCm) {
    var h = hCm / 2.54, n = neckCm / 2.54, w = waistCm / 2.54, hip = hipCm / 2.54, log = Math.log10 || function (x) { return Math.log(x) / Math.LN10; };
    if (!(h > 0) || !(n > 0) || !(w > 0)) return NaN;
    if (sex === "f") {
      if (!(hip > 0) || !(w + hip - n > 1)) return NaN;
      return 163.205 * log(w + hip - n) - 97.684 * log(h) - 78.387;
    }
    if (!(w - n > 1)) return NaN;
    return 86.010 * log(w - n) - 70.041 * log(h) + 36.76;
  };

  /* ---------- activity multiplier ----------
     KiteSink's own working numbers (the owner's coaching convention, not a study):
       BMR by body-fat category: 10, 9 or 8 kcal per lb of body weight (22, 19.8, 17.6 per kg).
         Category 1: men 15% body fat or less, women 24% or less; 2: men 16-25%, women 25-34%;
         3: men 26% or more, women 35% or more.
       A usual day's multiplier, from how active life is outside training: 1.1, 1.2, 1.3 or 1.5.
       Each hour of exercise adds to that day's multiplier, by intensity: 0.1 to 0.4.
     Maintenance = BMR x (day multiplier + exercise). */
  F.BMR_CATS = [
    { cat: 1, lb: 10, kg: 22, m: 15, f: 24 },
    { cat: 2, lb: 9, kg: 19.8, m: 25, f: 34 },
    { cat: 3, lb: 8, kg: 17.6, m: Infinity, f: Infinity }
  ];
  F.LEVELS = [
    { id: "inactive", n: "Inactive", d: "Desk job or mostly sitting", steps: "5,000 steps or fewer", m: 1.1 },
    { id: "light", n: "Light", d: "A job with some walking", steps: "5,000\u201310,000 steps", m: 1.2 },
    { id: "moderate", n: "Moderate", d: "A busy day or an active job", steps: "10,000\u201320,000 steps", m: 1.3 },
    { id: "high", n: "High", d: "Construction or other hard labour", steps: "20,000 steps or more", m: 1.5 }
  ];
  F.EXERCISE = [
    { id: "aer1", n: "Cardio, low", d: "HR \u2264130", m: 0.2 },
    { id: "aer2", n: "Cardio, medium", d: "HR 130\u2013150", m: 0.3 },
    { id: "aer3", n: "Cardio, high", d: "HR 160\u2013180", m: 0.4 },
    { id: "hiit", n: "HIIT", d: "", m: 0.3 },
    { id: "wt1", n: "Weight training, moderate", d: "", m: 0.1 },
    { id: "wt2", n: "Weight training, high intensity", d: "", m: 0.2 }
  ];
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  F.level = function (id) { return byId(F.LEVELS, id); };
  F.exercise = function (id) { return byId(F.EXERCISE, id); };
  F.bmrCategory = function (sex, bf) {   // 1, 2 or 3; 0 when body fat is unknown
    if (!(bf > 0)) return 0;
    for (var i = 0; i < F.BMR_CATS.length; i++) if (bf <= F.BMR_CATS[i][sex === "f" ? "f" : "m"]) return F.BMR_CATS[i].cat;
    return 3;
  };
  F.categoryBmr = function (kg, cat) { var c = F.BMR_CATS[cat - 1]; return c && kg > 0 ? kg * c.kg : NaN; };
  // a day: the usual day's multiplier plus each session's multiplier per hour times its hours
  F.dayMult = function (base, sessions) {
    return sessions.reduce(function (m, x) { var e = F.exercise(x.id); return m + (e && x.min > 0 ? e.m * x.min / 60 : 0); }, base);
  };
  // one activity done `times` a week: its training days, and the multiplier averaged over the week
  F.weekMult = function (base, id, min, times) {
    var e = F.exercise(id), add = e ? e.m * min / 60 : 0;
    return { train: base + add, rest: base, avg: base + add * times / 7 };
  };

  /* ---------- the hero's bar ----------
     heroLoad: the load for a share of a max, to the nearest 2.5 kg and never below the 20 kg bar.
     plates: what goes on each side, biggest first (so innermost), from 25, 20, 15, 10, 5, 2.5 and
     1.25 kg plates; with collars, 2.5 kg a side of the load is theirs. */
  F.HERO_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
  F.heroLoad = function (max, pct) {
    if (!(max > 0) || !(pct > 0)) return 20;
    return Math.max(20, Math.round(max * pct / 100 / 2.5) * 2.5);
  };
  F.plates = function (kg, collars) {
    var per = (kg - 20 - (collars ? 5 : 0)) / 2, out = [];
    F.HERO_PLATES.forEach(function (p) { while (per >= p - 1e-9) { out.push(p); per -= p; } });
    return out;
  };

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
    var ids = ["reps", "loads", "attempts", "travel", "macros", "activity", "bodyfat", "plan"].filter(function (id) { return $("tab-" + id) && $(id); });
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
    window.addEventListener("ks:tool", function (e) { if (!location.hash) show(e.detail); });   // the hero's goal picker
    window.addEventListener("hashchange", fromHash);
    if (location.hash) setTimeout(fromHash, 60);
  });

  /* ---------- 1. energy & macros ---------- */
  boot(function () {
    var units = seg($("m-units"), saved.units, "metric", function () { showBody(); paintUnits(); calc(); });
    var sex = seg($("m-sex"), saved.sex, "m", calc);
    var goal = seg($("m-goal"), saved.goal, "lose", function () { goalChanged(); calc(); });
    var protTouched = !!saved.protTouched;
    // mTouched: the visitor has changed something here, so the numbers are theirs, not the examples
    // the fields start with. The activity multiplier only borrows weight and body fat once it is set.
    var mTouched = !!saved.mTouched;
    ["input", "click"].forEach(function (t) { $("macros").addEventListener(t, function (e) { if (e.isTrusted && (t === "input" || e.target.closest("button"))) mTouched = true; }, true); });
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
    if (saved.bf !== "" && isFinite(saved.bf)) $("m-bf").value = saved.bf;
    if (saved.pal) {
      var found = false;
      [].forEach.call($("m-act").options, function (o) { if (parseFloat(o.value) === parseFloat(saved.pal)) { $("m-act").value = o.value; found = true; } }); // 2 must find "2.0"
      if (!found && saved.pal >= 1.2 && saved.pal <= 2.5) {   // a multiplier the activity tool put there
        var v = (+saved.pal).toFixed(2), o = document.createElement("option");
        o.value = v; o.setAttribute("data-custom", "1"); o.setAttribute("data-short", "with an activity multiplier of " + v);
        o.textContent = "Your own \u00b7 \u00d7 " + v + " from the activity multiplier"; $("m-act").appendChild(o); $("m-act").value = v;
      }
    }
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
      $("m-pal").textContent = "× " + num(pal, Math.round(pal * 10) === pal * 10 ? 1 : 2);
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

      var patch = { units: units.get(), sex: sex.get(), goal: g, age: age, cm: cm, kg: kg, bf: isFinite(bf) ? bf : "", pal: pal, fatPct: fatPct, protein: prot, protTouched: protTouched, mTouched: mTouched };
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

  /* ---------- 7. navy body fat ----------
     The fields show the chosen unit; the maths runs on centimetres kept in `cm`, so switching
     units cannot drift what was typed. "Use in Energy & macros" fills that tool's body-fat box,
     which moves it to the Cunningham equation. */
  boot(function () {
    if (!$("bodyfat")) return;
    var mine = saved.navy || {}, FIELDS = ["h", "neck", "waist", "hip"];
    var cm = {}; FIELDS.forEach(function (f) { cm[f] = mine[f] > 0 ? +mine[f] : val("bf-" + f); });
    var kg = mine.kg > 0 ? +mine.kg : NaN;
    var units = seg($("bf-units"), mine.units || (saved.units === "imperial" ? "in" : ""), "cm", function () { show(); calc(); });
    var sex = seg($("bf-sex"), mine.sex || saved.sex, "m", function () { calc(); });
    function inch() { return units.get() === "in"; }
    function show() {
      FIELDS.forEach(function (f) { if (isFinite(cm[f])) $("bf-" + f).value = Math.round((inch() ? cm[f] / 2.54 : cm[f]) * 2) / 2; });
      if (isFinite(kg)) $("bf-kg").value = inch() ? Math.round(F.lb(kg)) : Math.round(kg * 10) / 10;
      [].forEach.call(document.querySelectorAll(".bf-u"), function (u) { u.textContent = inch() ? "in" : "cm"; });
      $("bf-kg-u").textContent = inch() ? "lb" : "kg";
    }
    FIELDS.forEach(function (f) { $("bf-" + f).addEventListener("input", function () { var v = val("bf-" + f); cm[f] = inch() ? v * 2.54 : v; calc(); }); });
    $("bf-kg").addEventListener("input", function () { var v = val("bf-kg"); kg = inch() ? F.kg(v) : v; calc(); });
    $("bf-use").addEventListener("click", function () {
      var pct = $("bf-out").getAttribute("data-pct"); if (!pct) return;
      var box = $("m-bf"); if (!box) return;
      box.value = pct; box.dispatchEvent(new Event("input", { bubbles: true }));
      $("bf-use").textContent = "Added ✓";
      clearTimeout($("bf-use")._t); $("bf-use")._t = setTimeout(function () { $("bf-use").textContent = "Use in Energy & macros"; }, 1600);
    });
    function calc() {
      var f = sex.get() === "f";
      $("bf-hip-wrap").hidden = !f;
      $("bf-waist-l").innerHTML = f ? 'Waist <span style="text-transform:none;letter-spacing:0">at the narrowest</span>' : 'Abdomen <span style="text-transform:none;letter-spacing:0">at the navel</span>';
      $("bf-how").textContent = "Stand relaxed and breathe out normally. Keep the tape level and snug on bare skin without pressing in. Neck: just below the larynx (Adam’s apple), the tape sloping down slightly to the front. " +
        (f ? "Waist: around the narrowest point of the abdomen. Hips: around the widest part of the buttocks, feet together. "
           : "Abdomen: around the navel, level with the floor. ") +
        "Measure each one three times and use the average. Weigh and measure at the same time of day, each time.";
      var pct = F.navy(sex.get(), cm.h, cm.neck, cm.waist, cm.hip);
      var ok = isFinite(pct) && cm.h >= 120 && cm.h <= 230, out = $("bf-out");
      out.classList.toggle("is-empty", !ok); out.setAttribute("data-pct", ok ? Math.round(pct * 10) / 10 : "");
      $("bf-warn").hidden = true;
      if (!ok) {
        $("bf-pct").innerHTML = "—<small>%</small>"; $("bf-mass").hidden = true;
        $("bf-sub").textContent = isFinite(pct) || !(cm.h > 0) ? "Enter your measurements." : (f ? "Waist and hips together must be more than the neck." : "The abdomen must measure more than the neck.");
        say("bf-say", $("bf-sub").textContent);
      } else {
        var shown = Math.max(0, pct);
        $("bf-pct").innerHTML = num(shown, 1) + "<small>%</small>";
        $("bf-sub").textContent = "Navy equation for " + (f ? "women" : "men") + ". Expect the true value to lie a few points either side.";
        if (pct < 3 || pct > 60) { $("bf-warn").hidden = false; $("bf-warn").textContent = "That is outside the range the equations were built on. Check each measurement and the units."; }
        var mass = isFinite(kg) && kg > 25 && kg < 300;
        $("bf-mass").hidden = !mass;
        if (mass) {
          var fm = kg * shown / 100, u = inch() ? " lb" : " kg", conv = function (x) { return inch() ? F.lb(x) : x; };
          $("bf-fm").textContent = num(conv(fm), 1) + u; $("bf-lm").textContent = num(conv(kg - fm), 1) + u;
        }
        say("bf-say", "Estimated body fat " + num(shown, 1) + " percent" + (mass ? ", " + num(inch() ? F.lb(kg * shown / 100) : kg * shown / 100, 1) + (inch() ? " pounds" : " kilograms") + " of fat." : "."));
      }
      store.set({ navy: { units: units.get(), sex: sex.get(), h: cm.h, neck: cm.neck, waist: cm.waist, hip: cm.hip, kg: isFinite(kg) ? kg : "", pct: isFinite(pct) ? Math.round(pct * 10) / 10 : "" } });
    }
    show(); calc();
  });

  /* ---------- 8. activity multiplier ----------
     BMR is body weight times the rate for the body-fat category. Weight, sex and body fat come
     from Energy & macros (body fat from the navy tool when Energy & macros has none); without a
     weight there, the tool asks for it there first. A BMR typed here overrides all of that.
     "Use in Energy & macros" puts the multiplier into that tool's activity list. */
  boot(function () {
    if (!$("activity")) return;
    var mine = saved.ac || {}, result = null;
    var mode = seg($("ac-mode"), mine.mode, "one", calc);
    var levelEl = $("ac-level"), cat = seg($("ac-cat"), mine.cat, "2", calc);
    levelEl.innerHTML = F.LEVELS.map(function (l) {
      return '<button type="button" class="ac-lv" value="' + l.id + '" aria-pressed="false"><b>' + esc(l.n) + '<span>\u00d7 ' + l.m.toFixed(1) + "</span></b><small>" + esc(l.d) + "</small><small>" + esc(l.steps) + "</small></button>";
    }).join("");
    var level = seg(levelEl, mine.level, "light", calc);
    var exOpts = F.EXERCISE.map(function (e) { return '<option value="' + e.id + '">' + esc(e.n) + (e.d ? " \u00b7 " + e.d : "") + "</option>"; }).join("");
    $("ac-ex").innerHTML = exOpts;
    $("ac-ex").value = F.exercise(mine.ex) ? mine.ex : "wt1";
    ["min", "times"].forEach(function (k) { if (mine[k] > 0) $("ac-" + k).value = mine[k]; });
    if (mine.bmr > 0) $("ac-bmr").value = mine.bmr;
    var rows = Array.isArray(mine.rows) ? mine.rows.filter(function (r) { return F.exercise(r[0]); }) : [["wt1", 60], ["aer1", 30]];
    function drawRows() {
      $("ac-rows").innerHTML = rows.map(function (r, i) {
        return '<li><select class="k-select" aria-label="Exercise ' + (i + 1) + '" data-i="' + i + '">' + exOpts + "</select>" +
          '<span class="with-unit"><input class="k-input" type="number" inputmode="numeric" min="5" max="600" step="5" value="' + r[1] + '" aria-label="Minutes of exercise ' + (i + 1) + '" data-i="' + i + '"><span>min</span></span>' +
          '<button type="button" class="ac-x" data-i="' + i + '" aria-label="Remove exercise ' + (i + 1) + '">\u00d7</button></li>';
      }).join("");
      [].forEach.call($("ac-rows").querySelectorAll("select"), function (s, i) { s.value = rows[i][0]; });
      $("ac-none").hidden = rows.length > 0;
    }
    function rowEdit(e) {
      var i = +e.target.getAttribute("data-i"); if (!(i >= 0) || !rows[i]) return;
      if (e.target.tagName === "SELECT") rows[i][0] = e.target.value; else rows[i][1] = parseFloat(e.target.value) || 0;
      calc();
    }
    $("ac-rows").addEventListener("input", rowEdit); $("ac-rows").addEventListener("change", rowEdit);
    $("ac-rows").addEventListener("click", function (e) {
      var b = e.target.closest(".ac-x"); if (!b) return;
      var i = +b.getAttribute("data-i"); rows.splice(i, 1); drawRows(); calc();
      var x = $("ac-rows").querySelectorAll(".ac-x"); (x[Math.min(i, x.length - 1)] || $("ac-add")).focus();
    });
    $("ac-add").addEventListener("click", function () { if (rows.length >= 8) return; rows.push(["aer1", 30]); drawRows(); calc(); var s = $("ac-rows").querySelectorAll("select"); s[s.length - 1].focus(); });
    $("ac-ex").addEventListener("change", calc);
    ["ac-min", "ac-times", "ac-bmr"].forEach(function (id) { $(id).addEventListener("input", calc); });
    $("ac-bmr-clear").addEventListener("click", function () { $("ac-bmr").value = ""; calc(); $("ac-bmr").focus(); });
    $("ac-go").addEventListener("click", function () {   // take the visitor to Energy & macros, then to its weight box
      if (window.CustomEvent) window.dispatchEvent(new CustomEvent("ks:tool", { detail: "macros" }));
      var t = $("tab-macros"); if (t) t.click();
      var w = $("m-weight"); if (w) setTimeout(function () { w.focus(); }, 60);
    });
    // Energy & macros and the navy tool save as they change; follow them
    ["macros", "bodyfat"].forEach(function (id) { var p = $(id); if (p) { p.addEventListener("input", function () { setTimeout(calc, 0); }); p.addEventListener("click", function () { setTimeout(calc, 0); }); } });

    function person() {   // what Energy & macros and the navy tool know
      var m = store.get(), kg = m.mTouched ? +m.kg : NaN, sex = m.sex === "f" ? "f" : "m", bf = m.bf === "" || m.bf == null ? NaN : +m.bf, from = "Energy & macros";
      if (!(bf > 0) && m.navy && m.navy.pct > 0) { bf = +m.navy.pct; from = "Navy body fat"; }
      return { kg: kg > 30 && kg < 300 ? kg : NaN, sex: sex, bf: bf > 0 ? bf : NaN, bfFrom: from, imp: m.units === "imperial" };
    }
    function baseline() {   // {bmr, text} or {missing: true}
      var own = val("ac-bmr"), p = person();
      $("ac-bmr-clear").hidden = !(own > 0);
      if (own >= 800 && own <= 5000) return { bmr: own, p: p, own: true, text: "Your BMR: " + num(own) + " kcal a day." };
      var c = F.bmrCategory(p.sex, p.bf), auto = c > 0;
      $("ac-cat-wrap").hidden = auto || !isFinite(p.kg);
      if (!auto) c = +cat.get();
      var C = F.BMR_CATS[c - 1];
      [].forEach.call($("ac-cat").querySelectorAll("button"), function (b) {
        var k = F.BMR_CATS[+b.value - 1], cut = p.sex === "f" ? ["24% or less", "25\u201334%", "35% or more"] : ["15% or less", "16\u201325%", "26% or more"];
        b.innerHTML = b.value + " <small>" + cut[+b.value - 1] + "</small>";
      });
      if (!isFinite(p.kg)) return { missing: true, p: p };
      var bmr = F.categoryBmr(p.kg, c), rate = p.imp ? C.lb + " kcal per lb" : C.kg + " kcal per kg";
      return { bmr: bmr, p: p, cat: c, text: num(F.round(bmr, 10)) + " kcal a day: " + (p.imp ? num(F.lb(p.kg)) + " lb" : num(p.kg, 1) + " kg") + " \u00d7 " + rate +
        ", category " + c + (auto ? " from your " + num(p.bf, 1) + "% body fat (" + p.bfFrom + ")." : ".") };
    }
    function setUse(pal) {
      var act = $("m-act"); if (!act) return;
      var v = (Math.round(pal * 100) / 100).toFixed(2), opt = act.querySelector("option[data-custom]");
      if (!opt) { opt = document.createElement("option"); opt.setAttribute("data-custom", "1"); act.appendChild(opt); }
      opt.value = v; opt.textContent = "Your own \u00b7 \u00d7 " + v + " from the activity multiplier"; opt.setAttribute("data-short", "with an activity multiplier of " + v);
      act.value = v; act.dispatchEvent(new Event("input", { bubbles: true })); act.dispatchEvent(new Event("change", { bubbles: true }));
    }
    $("ac-use").addEventListener("click", function () {
      if (!result) return; setUse(result);
      var b = $("ac-use"); b.textContent = "Added \u2713"; clearTimeout(b._t); b._t = setTimeout(function () { b.textContent = "Use in Energy & macros"; }, 1600);
    });

    function empty(text) {
      result = null; $("ac-out").classList.add("is-empty");
      $("ac-big").textContent = "\u2014"; $("ac-sub").textContent = text; say("ac-say", text);
    }
    function calc() {
      var one = mode.get() === "one", b = baseline(), L = F.level(level.get()), out = $("ac-out");
      $("ac-one").hidden = !one; $("ac-day").hidden = one;
      $("ac-need").hidden = !b.missing; $("ac-from").hidden = !!b.missing; $("ac-from").textContent = b.text || "";
      store.set({ ac: { mode: mode.get(), level: level.get(), cat: cat.get(), ex: $("ac-ex").value, min: val("ac-min"), times: val("ac-times"), bmr: val("ac-bmr") || "", rows: rows } });
      if (b.missing) return empty("Needs your weight: fill in Energy & macros, or type your BMR.");
      var perLb = function (kcal) { return b.p && isFinite(b.p.kg) ? (b.p.imp ? num(kcal / F.lb(b.p.kg), 1) + " kcal per lb" : num(kcal / b.p.kg, 1) + " kcal per kg") : ""; };
      if (one) {
        var e = F.exercise($("ac-ex").value), min = val("ac-min"), times = val("ac-times");
        if (!(min >= 5 && min <= 600 && times >= 1 && times <= 14)) return empty("Check the minutes and the times a week.");
        var w = F.weekMult(L.m, e.id, min, times);
        result = w.avg; out.classList.remove("is-empty");
        $("ac-big-l").textContent = "Your multiplier, averaged over the week";
        $("ac-big").textContent = "\u00d7 " + num(w.avg, 2);
        $("ac-sub").textContent = "Training days \u00d7 " + num(w.train, 2) + ", other days \u00d7 " + num(w.rest, 2) + ". Each session burns about " + num(F.round(e.m * min / 60 * b.bmr, 5)) + " kcal.";
        $("ac-k1-l").textContent = "Maintenance, average"; $("ac-k1").textContent = num(F.round(b.bmr * w.avg, 10)) + " kcal";
        $("ac-k2-l").textContent = "On a training day"; $("ac-k2").textContent = num(F.round(b.bmr * w.train, 10)) + " kcal";
        $("ac-k3").textContent = perLb(b.bmr * w.avg);
        say("ac-say", "Multiplier " + num(w.avg, 2) + " averaged over the week; maintenance about " + num(F.round(b.bmr * w.avg, 10)) + " kilocalories a day.");
      } else {
        var m = F.dayMult(L.m, rows.map(function (r) { return { id: r[0], min: +r[1] }; }));
        result = m; out.classList.remove("is-empty");
        $("ac-big-l").textContent = "This day\u2019s multiplier";
        $("ac-big").textContent = "\u00d7 " + num(m, 2);
        $("ac-sub").textContent = L.n + " day \u00d7 " + num(L.m, 1) + (m > L.m ? " plus " + num(m - L.m, 2) + " from exercise." : ", no exercise.");
        $("ac-k1-l").textContent = "Maintenance"; $("ac-k1").textContent = num(F.round(b.bmr * m, 10)) + " kcal";
        $("ac-k2-l").textContent = "Resting energy"; $("ac-k2").textContent = num(F.round(b.bmr, 10)) + " kcal";
        $("ac-k3").textContent = perLb(b.bmr * m);
        say("ac-say", "This day's multiplier " + num(m, 2) + "; maintenance about " + num(F.round(b.bmr * m, 10)) + " kilocalories.");
      }
    }
    drawRows(); calc();
  });

  /* ---------- the hero: a goal picker, a bar, a week ----------
     content/fitness/hero.json, checked and resolved by scripts/build_fitness.py, arrives as
     #fx-data. Picking a goal loads the bar (a share of the best squat, in plates), lays out a
     typical week, shows one field-guide entry, and rings the tools, areas and Vantix below.
     The picker and its card are hidden in the HTML and shown here. The only motion is the
     plates sliding on and the bar settling, then a slow breath, which the pause button stops;
     none of it runs when the visitor asks for reduced motion, or while the card is off screen. */
  boot(function () {
    var dataEl = $("fx-data"), rig = $("fx-rig"); if (!dataEl || !rig) return;
    var D = JSON.parse(dataEl.textContent), goalsEl = $("fx-goals"), lvEl = $("fx-lv"), clear = $("fx-clear");
    var L = $("fx-l"), R = $("fx-r"), shaft = $("fx-shaft"), knurl = $("fx-knurl"), maxIn = $("fx-max"), pause = $("fx-pause");
    var days = $("fx-days"), dayEl = $("fx-day"), rx = $("fx-rx"), ent = $("fx-ent"), then = $("fx-then");
    var RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var DN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    var PLATE = { 25: [15, 118, "var(--k-brass-fill)"], 20: [13, 118, "var(--k-green-fill)"], 15: [11, 118, "var(--k-tan)"], 10: [9, 118, "var(--fx-iron)"], 5: [7, 72, "var(--fx-bar)"], 2.5: [6, 54, "var(--k-copy)"], 1.25: [5, 44, "var(--k-mute)"] };
    var mine = saved.hero || {}, goal = D.goals[mine.goal] ? mine.goal : null, today = (new Date().getDay() + 6) % 7, sel = today;
    var level = seg(lvEl, mine.level, "mid", function () { paint(true); keep(); });
    var load = 20, shown = "", impulse = 0, t0 = 0, moving = !RM, onScreen = true, frame = 0;
    if (mine.max >= 20 && mine.max <= 350) maxIn.value = mine.max;
    $("fx-pick").hidden = false; rig.hidden = false;

    var k = ""; for (var x = 128; x <= 232; x += 4) if (x < 172 || x > 188) k += '<line x1="' + x + '" y1="71" x2="' + x + '" y2="79"/>';
    knurl.innerHTML = k;
    function keep() { store.set({ hero: { goal: goal, level: level.get(), max: maxOf() } }); }
    function maxOf() { var v = parseFloat(maxIn.value); return isFinite(v) ? Math.max(20, Math.min(350, v)) : D.max; }
    function side(g, plates, dir, collars, animate) {
      var x = dir < 0 ? 88 : 272, cls = animate && !RM ? (dir < 0 ? " in-l" : " in-r") : "";
      var h = '<rect x="' + (dir < 0 ? 8 : 272) + '" y="70" width="80" height="10" rx="3" fill="var(--fx-bar)"/><rect x="' + (dir < 0 ? 88 : 266) + '" y="60" width="6" height="30" rx="2" fill="var(--fx-bar-hi)"/>';
      plates.forEach(function (p, i) {
        var d = PLATE[p];
        h += '<rect class="fx-plate' + cls + '" style="animation-delay:' + (i * 70) + 'ms" x="' + (dir < 0 ? x - d[0] : x) + '" y="' + (75 - d[1] / 2) + '" width="' + d[0] + '" height="' + d[1] + '" rx="2.5" fill="' + d[2] + '"/>';
        x += dir * (d[0] + 1.5);
      });
      if (collars) h += '<rect class="fx-plate' + cls + '" style="animation-delay:' + (plates.length * 70) + 'ms" x="' + (dir < 0 ? x - 10 : x) + '" y="61" width="10" height="28" rx="2" fill="var(--k-brass)"/>';
      g.innerHTML = h;
    }
    function swap(el, html, animate) {
      if (!animate || RM || !el.innerHTML) { el.innerHTML = html; return; }
      el.classList.add("swap"); setTimeout(function () { el.innerHTML = html; el.classList.remove("swap"); }, 180);
    }
    function entryHTML(id) {
      var e = D.entries[id]; if (!e) return "";
      var src = e.src.map(function (s) { return '<a href="' + esc(s.href) + '">' + esc(s.label) + "</a> · " + esc(s.type); }).join("");
      return '<div class="fx-ent-top"><span class="k-label">Field guide</span><span class="fx-badge ' + esc(e.c) + '">' + esc(e.cl) + "</span></div>" +
        '<b><a href="' + esc(e.href) + '">' + esc(e.t) + "</a></b><p>" + esc(e.take) + "</p>" + (src ? '<p class="cite">' + src + "</p>" : "");
    }
    function showDay(i, week) {
      sel = i;
      [].forEach.call(days.children, function (b, j) { b.setAttribute("aria-pressed", j === i ? "true" : "false"); });
      if (!week) { dayEl.textContent = "Pick a goal to see what a typical week looks like."; return; }
      var d = week[i];
      dayEl.innerHTML = "<b>" + (i === today ? "Today, " : "") + DN[i] + ": " + esc(d[1]) + ".</b> " + esc(d[2]);
    }
    var word = $("fx-word"), wordNow = word ? word.textContent : "";
    function headline(text, animate) {
      if (!word || text === wordNow) return;
      wordNow = text;
      if (!animate || RM) { word.textContent = text; return; }
      word.classList.remove("in"); word.classList.add("out");
      setTimeout(function () { word.textContent = text; word.classList.remove("out"); void word.offsetWidth; word.classList.add("in"); }, 240);
    }
    function ring(lv) {
      [].forEach.call(document.querySelectorAll(".fx-match"), function (el) { el.classList.remove("fx-match"); });
      if (!lv) return;
      lv.areas.forEach(function (a) { var c = document.querySelector('#guide .hub-card[href="' + D.areas[a].href + '"]'); if (c) c.classList.add("fx-match"); });
      lv.tools.forEach(function (t) { var b = $("tab-" + t); if (b) b.classList.add("fx-match"); });
      if (lv.vantix) { var v = document.querySelector(".vx-card"); if (v) v.classList.add("fx-match"); }
    }
    function paint(animate) {
      var g = goal && D.goals[goal], lv = g && g.levels[level.get()], max = maxOf();
      load = lv ? F.heroLoad(max, lv.pct) : 20;
      var plates = lv ? F.plates(load, lv.collars) : [], sig = (goal || "") + load + (lv && lv.collars);
      if (sig !== shown) { shown = sig; side(L, plates, -1, lv && lv.collars, animate); side(R, plates, 1, lv && lv.collars, animate); if (animate) { impulse = 1; t0 = now(); } }
      $("fx-kg").textContent = num(load, load % 1 ? 1 : 0) + " kg";
      $("fx-plates").textContent = !lv ? "The empty bar. Pick a goal to load it." : (plates.length ? plates.join(" · ") + " kg a side" : "Just the bar") + (lv.collars ? ", 2.5 kg collars" : "");
      swap(rx, !lv ? "Pick what you’re after. The bar loads a share of your best squat, and the week below lays out the training."
        : "<span>" + num(lv.pct, lv.pct % 1 ? 1 : 0) + "%</span> of " + num(max, max % 1 ? 1 : 0) + " kg, for " + esc(lv.how) +
          "<small>" + (lv.rest ? "Rest " + esc(lv.rest) + " · " : "") + (/\d/.test(lv.days) ? "Lifting days: " + esc(lv.days) : esc(lv.days.charAt(0).toUpperCase() + lv.days.slice(1))) + (lv.example ? ' · <span>an example load: the guide gives reps for this goal, not a %</span>' : "") + "</small>", animate);
      swap(ent, entryHTML(lv ? lv.entry : D.daysFrom), animate);
      then.innerHTML = !lv ? "" : lv.tools.map(function (t) { return '<a class="fx-chip" href="' + esc(D.tools[t].href) + '"><small>Tool</small>' + esc(D.tools[t].label) + "</a>"; }).join("") +
        lv.areas.map(function (a) { return '<a class="fx-chip" href="' + esc(D.areas[a].href) + '"><small>Guide</small>' + esc(D.areas[a].label) + "</a>"; }).join("") +
        (lv.vantix ? '<a class="fx-chip" href="/vantix"><small>Track</small>Vantix</a>' : "");
      var week = lv && lv.week, lifts = week ? week.filter(function (d) { return d[0] === "lift"; }).length : 0;
      days.innerHTML = DN.map(function (n, i) {
        var d = week && week[i];
        return '<button type="button" class="fx-day ' + (d ? d[0] : "empty") + (i === today ? " today" : "") + '" aria-pressed="false" aria-label="' + n + (d ? ": " + esc(d[1]) : "") + (i === today ? " (today)" : "") + '">' +
          '<span class="dl">' + n.slice(0, 2) + '</span><span class="blk" style="animation-delay:' + (i * 45) + 'ms"></span></button>';
      }).join("");
      if (animate) { days.classList.remove("go"); void days.offsetWidth; days.classList.add("go"); }
      $("fx-wk-t").textContent = !lv ? "A typical week" : goal === "meet" ? "Meet week" : "A typical week · " + lifts + " lifting day" + (lifts === 1 ? "" : "s");
      showDay(week ? sel : today, week);
      [].forEach.call(goalsEl.querySelectorAll(".fx-goal"), function (b) { b.setAttribute("aria-pressed", b.value === goal ? "true" : "false"); });
      clear.hidden = !goal;
      headline(g ? g.h1 : "lift.", animate);
      ring(lv);
      if (lv) say("fx-say", g.label + ": " + num(load, load % 1 ? 1 : 0) + " kg on the bar, " + lv.pct + "% of " + max + " kg, for " + lv.how + ". " + (goal === "meet" ? "A meet week." : "Lifting days a week: " + lv.days + "."));
    }
    function now() { return window.performance ? performance.now() : Date.now(); }
    function step(t) {
      frame = 0;
      var kk = 1.5 + load / 220 * 4, b = Math.sin(t / 1600) * kk * .22;
      if (impulse) { var s = (t - t0) / 1000; b += kk * 1.1 * Math.exp(-s * 3.2) * Math.sin(s * 11); if (s > 2) impulse = 0; }
      shaft.setAttribute("d", "M8 " + (75 + b) + " Q180 " + (75 - b) + " 352 " + (75 + b));
      L.setAttribute("transform", "translate(0 " + (b * .8).toFixed(2) + ") rotate(" + (-b * .25).toFixed(2) + " 92 75)");
      R.setAttribute("transform", "translate(0 " + (b * .8).toFixed(2) + ") rotate(" + (b * .25).toFixed(2) + " 268 75)");
      knurl.setAttribute("transform", "translate(0 " + (-b * .5).toFixed(2) + ")");
      run();
    }
    function run() { if (moving && onScreen && !document.hidden && !frame) frame = requestAnimationFrame(step); }
    function setPause() {
      pause.setAttribute("aria-pressed", moving ? "false" : "true");
      pause.setAttribute("aria-label", moving ? "Stop the bar moving" : "Let the bar move");
      pause.innerHTML = moving ? '<svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true" focusable="false"><rect x="2" y="1" width="3.5" height="12" rx="1"/><rect x="8.5" y="1" width="3.5" height="12" rx="1"/></svg>'
        : '<svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true" focusable="false"><path d="M3 1.5v11l9-5.5z"/></svg>';
    }

    goalsEl.addEventListener("click", function (e) {
      var b = e.target.closest(".fx-goal"); if (!b) return;
      goal = b.value; paint(true); keep();
      var lv = D.goals[goal].levels[level.get()];
      if (lv.tools.length && window.CustomEvent) window.dispatchEvent(new CustomEvent("ks:tool", { detail: lv.tools[0] }));
    });
    clear.addEventListener("click", function () { goal = null; paint(true); keep(); });
    days.addEventListener("click", function (e) {
      var b = e.target.closest(".fx-day"), lv = goal && D.goals[goal].levels[level.get()];
      if (b) showDay([].indexOf.call(days.children, b), lv && lv.week);
    });
    maxIn.addEventListener("input", function () { paint(false); keep(); });
    pause.addEventListener("click", function () { moving = !moving; setPause(); run(); });
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; run(); }).observe(rig);
    document.addEventListener("visibilitychange", run);
    setPause(); paint(false); run();
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

  /* ---------- 6. diet planner. It saves nothing: it only reads what the macro tool remembered. ---------- */
  boot(function () {
    if (!$("plan")) return;
    var P = F.PLAN, DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    var DAYLONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    var mem = store.get(); // read only
    var body = { kg: mem.kg > 0 ? +mem.kg : 75, cm: mem.cm > 0 ? +mem.cm : 175 };
    if (mem.age) $("d-age").value = mem.age;
    if (mem.bf) $("d-bf").value = mem.bf;
    if (mem.pal) [].forEach.call($("d-act").options, function (o) { if (parseFloat(o.value) === parseFloat(mem.pal)) $("d-act").value = o.value; });
    var train = [true, true, false, true, true, false, false], days = 3.5, manual = null, last = null, prevBal = null, changed = -1, deltaT = 0;
    var units = seg($("d-units"), mem.units, "metric", function () { showBody(); calc(); });
    var sex = seg($("d-sex"), mem.sex, "m", calc);
    var phase = seg($("d-phase"), "lose", "lose", function () { manual = null; calc(); });
    var gainPct = seg($("d-gainseg"), "5", "5", calc);

    $("d-train").innerHTML = DAY.map(function (d, i) { return '<button type="button" aria-label="' + DAYLONG[i] + '" aria-pressed="' + train[i] + '">' + d + "</button>"; }).join("");
    $("d-train").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var i = [].indexOf.call($("d-train").children, b); train[i] = !train[i]; b.setAttribute("aria-pressed", train[i]);
      manual = null; calc(); say("d-say", DAYLONG[i] + (train[i] ? " is a training day. " : " is a rest day. ") + summary());
    });
    function step(d) { days = Math.max(1, Math.min(7, days + d)); manual = null; calc(); say("d-say", summary()); }
    $("d-days-dn").addEventListener("click", function () { step(-0.5); });
    $("d-days-up").addEventListener("click", function () { step(0.5); });
    $("d-reset").addEventListener("click", function () { manual = null; changed = -1; calc(); say("d-say", "Diet days back on your rest days. " + summary()); });

    function showBody() {
      var imp = units.get() === "imperial";
      $("d-w-unit").textContent = imp ? "lb" : "kg"; $("d-h-unit").textContent = imp ? "in" : "cm";
      $("d-w").value = imp ? Math.round(F.lb(body.kg)) : Math.round(body.kg * 10) / 10;
      $("d-h").value = imp ? Math.round(body.cm / 2.54) : Math.round(body.cm);
    }
    $("d-w").addEventListener("input", function () { var v = val("d-w"); body.kg = units.get() === "imperial" ? F.kg(v) : v; calc(); });
    $("d-h").addEventListener("input", function () { var v = val("d-h"); body.cm = units.get() === "imperial" ? v * 2.54 : v; calc(); });
    ["d-age", "d-bf", "d-act", "d-own", "d-size"].forEach(function (id) { $(id).addEventListener("input", calc); });
    $("d-size").addEventListener("change", function () { say("d-say", summary()); });

    function kgText(kg) { var imp = units.get() === "imperial"; return num(Math.abs(imp ? F.lb(kg) : kg), 2) + (imp ? " lb" : " kg"); }
    function kc(v) { return num(F.round(v, 10)); }
    function signed(v) { return (v < 0 ? "−" : "+") + kc(Math.abs(v)); }
    function summary() {
      var r = last; if (!r) return "";
      if (r.phase === "hold") return "Maintenance " + kc(r.maint) + " kcal a day.";
      if (r.phase === "gain") return "Surplus " + kc(r.weekBalance / 7) + " kcal a day, about " + kgText(r.weekKg) + " a week.";
      return num(r.daysPerWeek, 1) + " diet days a week. Weekly deficit " + kc(-r.weekBalance) + " kcal, about " + kgText(r.weekKg) + " a week.";
    }
    var narrow = window.matchMedia ? window.matchMedia("(max-width: 479px)") : { matches: false };
    if (narrow.addEventListener) narrow.addEventListener("change", function () { if (last) drawWeek(last); });

    function cell(r, i) {
      var tr = train[i % 7], dt = r.diet[i], wk = r.len === 14 ? "Week " + (i < 7 ? 1 : 2) + ", " : "";
      return '<button type="button" class="d-c' + (i === changed ? " is-new" : "") + '" data-i="' + i + '" aria-pressed="' + dt + '" aria-label="' + wk + DAYLONG[i % 7] +
        (tr ? ", training day" : "") + '">' + (dt ? "Diet" : "Maint") + (tr ? '<i class="d-dot" aria-hidden="true"></i>' : "") + "</button>";
    }
    function drawWeek(r) {
      var weeks = r.len / 7, h = "";
      if (narrow.matches) {
        h = '<table class="d-tab"><thead><tr><th scope="col"><span class="k-vh">Day</span></th>' + (weeks > 1 ? "<th scope=\"col\">Week 1</th><th scope=\"col\">Week 2</th>" : "<th scope=\"col\">Day type</th>") + "</tr></thead><tbody>";
        for (var d = 0; d < 7; d++) { h += '<tr><th scope="row">' + DAY[d] + "</th>"; for (var w = 0; w < weeks; w++) h += "<td>" + cell(r, w * 7 + d) + "</td>"; h += "</tr>"; }
      } else {
        h = '<table class="d-tab"><thead><tr><th scope="col"><span class="k-vh">Week</span></th>' + DAY.map(function (d) { return '<th scope="col">' + d + "</th>"; }).join("") + "</tr></thead><tbody>";
        for (var w2 = 0; w2 < weeks; w2++) { h += '<tr><th scope="row">' + (weeks > 1 ? "Week " + (w2 + 1) : "Week") + "</th>"; for (var d2 = 0; d2 < 7; d2++) h += "<td>" + cell(r, w2 * 7 + d2) + "</td>"; h += "</tr>"; }
      }
      $("d-week").innerHTML = h + "</tbody></table>";
    }
    $("d-week").addEventListener("click", function (e) {
      var b = e.target.closest(".d-c"); if (!b || !last) return;
      var i = +b.getAttribute("data-i");
      manual = last.diet.slice(); manual[i] = !manual[i]; changed = i;
      calc();
      var nb = $("d-week").querySelector('.d-c[data-i="' + i + '"]'); if (nb) nb.focus();
      say("d-say", (last.len === 14 ? "Week " + (i < 7 ? 1 : 2) + " " : "") + DAYLONG[i % 7] + " is now a " + (manual[i] ? "diet" : "maintenance") + " day. " + summary());
    });

    function dayCard(title, m, diet) {
      return '<div class="d-card' + (diet ? " is-diet" : "") + '"><p class="d-card-h">' + title + "</p><b>" + kc(m.kcal) + ' <small style="font-size:13px;font-weight:500">kcal</small></b><p>Protein ' + num(m.protein) + " g<br>Carbohydrate " + num(m.carbs) + " g<br>Fat " + num(m.fat) + " g</p></div>";
    }

    function calc() {
      var ph = phase.get(), kg = body.kg, cm = body.cm, age = val("d-age"), bf = val("d-bf"), own = val("d-own");
      $("d-lose").hidden = ph !== "lose"; $("d-gain").hidden = ph !== "gain"; $("d-train-wrap").hidden = ph !== "lose"; $("d-week-wrap").hidden = ph !== "lose";
      var ok = kg > 30 && kg < 300 && cm > 120 && cm < 230 && age >= 18 && age <= 95;
      $("d-out").classList.toggle("is-empty", !ok);
      if (!ok) { $("d-head").textContent = "—"; $("d-sub").textContent = "Enter age (18 or over), height and weight to see a plan."; $("d-cards").innerHTML = ""; $("d-req").innerHTML = ""; $("d-warn").hidden = true; return; }
      var r = F.plan({ sex: sex.get(), kg: kg, cm: cm, age: age, bf: bf, pal: parseFloat($("d-act").value), maint: own >= 1000 && own <= 6000 ? own : 0,
        phase: ph, days: days, size: val("d-size"), gain: +gainPct.get(), train: train, diet: manual });
      last = r;
      var warns = [], req = [];
      if (ph === "lose") {
        days = r.daysPerWeek; if (manual && r.len === 7) days = r.n;
        $("d-days").textContent = num(r.daysPerWeek, r.daysPerWeek % 1 ? 1 : 0);
        $("d-days-dn").disabled = r.daysPerWeek <= 1; $("d-days-up").disabled = r.daysPerWeek >= 7;
        var sl = $("d-size"); sl.max = r.maxSize; if (+sl.value > r.maxSize) sl.value = r.maxSize;
        $("d-size-read").textContent = num(r.size) + "% below maintenance" + (r.dietDay ? " · " + kc(r.dietDay.kcal) + " kcal" : "");
        $("d-size-note").textContent = r.floorBinds ? "Your maintenance is low enough that even small diet days take the week under 1,200 kcal a day on average." :
          r.size >= r.maxSize ? "That is as low as a diet day goes for you: " + (r.avgKcal <= P.FLOOR + 30 ? "any lower and the week averages under 1,200 kcal a day, which UK clinical guidance keeps for specialist care." : "protein and the essential-fat minimum, and no less than a quarter of maintenance.") : "";
        $("d-head-l").textContent = "Weekly deficit"; $("d-head").textContent = kc(-r.weekBalance); $("d-head-u").textContent = "kcal a week";
        $("d-sub").textContent = num(r.deficitPct) + "% of the week’s maintenance · about " + kgText(r.weekKg) + " a week · average " + kc(r.avgKcal) + " kcal a day" + (r.dietOnTraining ? ". " + r.dietOnTraining + " diet day" + (r.dietOnTraining > 1 ? "s fall" : " falls") + " on a training day." : ".");
        drawWeek(r);
        var suggested = F.planPlace(train, r.n, r.len);
        $("d-reset").hidden = !manual || suggested.join() === r.diet.join();
        $("d-cards").innerHTML = (r.dietDay ? dayCard("Diet day · " + r.n + (r.len === 14 ? " in 14" : " a week"), r.dietDay, true) : "") + dayCard("Maintenance day · " + (r.len - r.n) + (r.len === 14 ? " in 14" : " a week"), r.maintDay, false);
        if (r.deficitPct > P.BIG_DEFICIT) warns.push("A deficit of " + num(r.deficitPct) + "% of the week is a lot. Expect it to be hard to keep up and to cost more muscle than a smaller one; protein is already at its top end.");
        if (isFinite(r.ea) && r.ea < P.EA_WARN) warns.push("The week averages about " + num(r.ea) + " kcal per kg of fat-free mass before training, so energy availability is lower still. Lower levels go with rising risk to hormones and bone, for women most of all. <a href=\"/fitness/women#wom-ea-no-threshold\" style=\"color:#d8b07a\">Why 30 is a warning, not a line</a>.");
        req.push(["Protein", "<b>" + num(r.protein) + " g a day</b>, every day. It rises with the deficit" + (bf > 0 ? ": " + num(r.protein / (kg * (1 - bf / 100)), 1) + " g per kg of fat-free mass, inside the 2.3 to 3.1 g that dieting lifters need." : ": " + num(r.protein / kg, 1) + " g per kg of body weight. Add body fat for a sharper figure."), false]);
      } else if (ph === "hold") {
        $("d-head-l").textContent = "Maintenance"; $("d-head").textContent = kc(r.maint); $("d-head-u").textContent = "kcal a day";
        $("d-sub").textContent = "The same every day; your weight should hold.";
        $("d-cards").innerHTML = dayCard("Every day", r.maintDay, false);
        req.push(["Protein", "<b>" + num(r.protein) + " g a day</b>, 1.6 g per kg of body weight.", false]);
      } else {
        var add = r.weekBalance / 7, five = r.maint * 0.05;
        $("d-head-l").textContent = "Weekly surplus"; $("d-head").textContent = "+" + kc(r.weekBalance); $("d-head-u").textContent = "kcal a week";
        $("d-sub").textContent = "+" + kc(add) + " kcal a day · about " + kgText(r.weekKg) + " a week · " + kc(r.maintDay.kcal) + " kcal a day in all.";
        $("d-cards").innerHTML = dayCard("Every day", r.maintDay, false);
        $("d-gain-note").textContent = "+5% is " + kc(five) + " kcal a day for you. In trained lifters, +15% built no more muscle than +5% and added more fat. KiteSink’s rule of thumb: 150 to 300 kcal over maintenance is enough.";
        if (add > 300) warns.push("+" + kc(add) + " kcal a day is past the point where more food builds more muscle. In a trial of trained lifters the extra over +5% went mostly to fat.");
        req.push(["Protein", "<b>" + num(r.protein) + " g a day</b>, 1.6 g per kg of body weight.", false]);
      }
      var efa = P.EFA_SHARE * r.maint / 9, low = r.dietDay || r.maintDay;
      req.push(["Essential fats", "<b>At least " + num(efa) + " g a day of linoleic and alpha-linolenic acid</b> (2.5% + 0.5% of energy). " + (r.dietDay ? "Diet days have " + num(r.dietDay.fat) + " g of fat, so most of it should be seed oils, nuts, seeds or oily fish." : "Get it from seed oils, nuts, seeds or oily fish."), r.dietDay && r.dietDay.fat < efa * 2]);
      req.push(["Fibre", "<b>25 g a day or more</b>, which takes about 400 g of fruit and vegetables. " + (low.carbs < 60 ? "Diet days have only " + num(low.carbs) + " g of carbohydrate: spend it on vegetables first." : ""), low.carbs < 60]);
      req.push(["Vitamins and minerals", "<b>The planner cannot check these.</b> Varied food covers most needs." + (low.kcal < P.FLOOR ? " Days under 1,200 kcal make that hard, which is why clinical low-energy diets are built to be nutritionally complete." : ""), low.kcal < P.FLOOR]);
      $("d-req").innerHTML = req.map(function (x) { return '<li' + (x[2] ? ' class="is-watch"' : "") + '><span class="d-req-k">' + x[0] + "</span> " + x[1] + "</li>"; }).join("");
      $("d-warn").innerHTML = warns.map(function (w) { return '<p class="warn">' + w + "</p>"; }).join(""); $("d-warn").hidden = !warns.length;
      $("d-maint").textContent = r.own ? "Maintenance: your figure, " + kc(r.maint) + " kcal a day." :
        "Maintenance: resting " + kc(r.rmr) + " kcal (" + r.equation + ") × " + num(parseFloat($("d-act").value), 1) + " = " + kc(r.maint) + " kcal a day, training included. If your own tracking says otherwise, enter that figure above.";
      // what changed, made visible
      var bal = Math.round(r.weekBalance);
      if (prevBal !== null && bal !== prevBal && !booting) {
        $("d-delta").textContent = "was " + signed(prevBal) + " kcal a week"; $("d-delta").hidden = false;
        clearTimeout(deltaT); deltaT = setTimeout(function () { $("d-delta").hidden = true; }, 4000);
      }
      prevBal = bal; changed = -1;
    }
    showBody(); calc();
  });

  booting = false; // from here on, changes are announced
})();
