// Zero-dependency checks for public/fitness.js: the calculator maths (on the guide numbers the build puts in
// the hub), My numbers and its migration, the hub's search ranking, and the script in the hub's <head> that
// forwards old /fitness#<id> links.  Run after python3 scripts/build_fitness.py: node scripts/test_fitness.js
const fs = require('fs'), vm = require('vm');
const ctx = { window: {}, document: { getElementById: () => null }, Math, console };
ctx.window.window = ctx.window;
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname, '..', 'public', 'fitness.js'), 'utf8'), ctx);
const F = ctx.window.KSFit; let fail = 0;
const eq = (name, got, want, tol = 0.01) => { const ok = Math.abs(got - want) <= tol; if (!ok) fail++; console.log((ok ? 'ok   ' : 'FAIL ') + name + ': ' + got + (ok ? '' : ' (want ' + want + ')')); };
// Mifflin-St Jeor, hand-computed: man 80 kg, 180 cm, 30 y → 800 + 1125 − 150 + 5 = 1780; woman 60/165/40 → 600 + 1031.25 − 200 − 161 = 1270.25
eq('mifflin m', F.mifflin('m', 80, 180, 30), 1780);
eq('mifflin f', F.mifflin('f', 60, 165, 40), 1270.25);
// Cunningham 1991: 80 kg at 20% → FFM 64 → 370 + 1382.4 = 1752.4
eq('cunningham', F.cunningham(80, 20), 1752.4);
// energy: maintain
let e = F.energy({ sex: 'm', kg: 80, cm: 180, age: 30, bf: NaN, pal: 1.6, goal: 'hold', rate: 0, protein: 1.6, fatPct: 25 });
eq('maint', e.maint, 2848); eq('kcal hold', e.kcal, 2848); eq('protein g', e.protein, 128); eq('fat g', e.fat, 2848 * .25 / 9, 0.01);
eq('macro kcal sum', e.protein * 4 + e.carbs * 4 + e.fat * 9, e.kcal, 0.001);
// lose 0.5%/wk at 80 kg → 0.4 kg/wk → 3080 kcal/wk → 440/day
e = F.energy({ sex: 'm', kg: 80, cm: 180, age: 30, pal: 1.6, goal: 'lose', rate: 0.5, protein: 2, fatPct: 25 });
eq('deficit', e.delta, -440); eq('weekly kg', e.weekly, -0.4); eq('kcal lose', e.kcal, 2408);
// gain +10%
e = F.energy({ sex: 'f', kg: 60, cm: 165, age: 40, pal: 1.4, goal: 'gain', rate: 10, protein: 1.6, fatPct: 30 });
eq('gain kcal', e.kcal, 1270.25 * 1.4 * 1.1, 0.01);
// below RMR flag: tiny person, big deficit
e = F.energy({ sex: 'f', kg: 50, cm: 155, age: 60, pal: 1.4, goal: 'lose', rate: 1, protein: 2, fatPct: 25 });
console.log('belowRmr flag:', e.belowRmr, 'kcal', Math.round(e.kcal), 'rmr', Math.round(e.rmr));
if (!e.belowRmr) fail++;
// uses body fat when given
e = F.energy({ sex: 'm', kg: 80, cm: 180, age: 30, bf: 20, pal: 1.6, goal: 'hold', rate: 0, protein: 1.6, fatPct: 25 });
eq('rmr via bf', e.rmr, 1752.4); console.log('equation:', e.equation);
// effective reps table: 10 reps @ RIR 0,2,4,5 → 5,3,1,0 ; 3 reps @0 → 3
[[10,0,5],[10,2,3],[10,4,1],[10,5,0],[10,6,0],[3,0,3],[3,1,3],[1,0,1],[25,0,5]].forEach(([r,i,w]) => eq(`eff ${r}@${i}`, F.effective(r, i), w));
eq('rpe', F.rpe(2), 8);
// Epley 100×5 = 116.67 ; Brzycki 100×5 = 100·36/32 = 112.5 ; single = itself
eq('epley', F.epley(100, 5), 116.6667, 0.001); eq('brzycki', F.brzycki(100, 5), 112.5); eq('epley single', F.epley(100, 1), 100); eq('brzycki single', F.brzycki(100, 1), 100);
// The tool's estimate: up to 10 reps the mean of the two factors, above 10 Epley alone.
//   100×5 → 100·(1.166667 + 1.125)/2 = 114.5833 ; 100×10 → both give 133.3333 ; 100×12 → Epley, 140 ; a single is itself
eq('oneRm 100x5', F.oneRm(100, 5), 114.5833, 0.001); eq('oneRm 100x10', F.oneRm(100, 10), 133.3333, 0.001);
eq('oneRm 100x12', F.oneRm(100, 12), 140, 0.001); eq('oneRm single', F.oneRm(100, 1), 100);
// no step where the two meet: 10 and 11 reps differ by one Epley increment (100/30)
eq('oneRm 10 to 11', F.oneRm(100, 11) - F.oneRm(100, 10), 3.3333, 0.001);
// loadFor inverts the same estimate: 114.5833 for 5 @0 → 100 ; 120 for 8 @2 (ten reps) → 90 ;
// one rep with one in reserve (two reps) → 100/((1.066667 + 1.028571)/2) = 95.4545
eq('loadFor', F.loadFor(114.5833, 5, 0), 100, 0.001); eq('loadFor 8@2', F.loadFor(120, 8, 2), 90); eq('loadFor 1@1', F.loadFor(100, 1, 1), 95.4545, 0.001);
// reps at a percentage inverts it again: 75% → 10 ; 100% → 1 ; 60% → Epley's 20 ; 95% → about 2.16, shown as 2
eq('repsAt 75%', F.repsAt(0.75), 10, 0.001); eq('repsAt 100%', F.repsAt(1), 1); eq('repsAt 60%', F.repsAt(0.6), 20, 0.001);
eq('repsAt 95%', F.repsAt(0.95), 2.158, 0.01); eq('repsAt 95% rounds to 2', Math.round(F.repsAt(0.95)), 2);
// the hero's bar: a share of the max to the nearest 2.5 kg, never under the 20 kg bar; plates biggest first
eq('heroLoad 85% of 100', F.heroLoad(100, 85), 85); eq('heroLoad 82.5% of 100', F.heroLoad(100, 82.5), 82.5);
eq('heroLoad rounds to 2.5', F.heroLoad(143, 70), 100); eq('heroLoad never under the bar', F.heroLoad(25, 60), 20);
eq('heroLoad with no max', F.heroLoad(NaN, 70), 20);
const pl = (kg, c) => F.plates(kg, c).join(' ');
const same = (name, got, want) => { const ok = got === want; if (!ok) fail++; console.log((ok ? 'ok   ' : 'FAIL ') + name + ': ' + got + (ok ? '' : ' (want ' + want + ')')); };
same('plates 85', pl(85), '25 5 2.5'); same('plates 60', pl(60), '20'); same('plates 20', pl(20), '');
same('plates 82.5 with collars', pl(82.5, true), '25 2.5 1.25'); same('plates 220 with collars', pl(220, true), '25 25 25 20 2.5');
// every load the hero can show (20 to 350 kg in 2.5 kg steps) is made exactly by its plates
let off = 0;
for (let kg = 20; kg <= 350; kg += 2.5) for (const c of [false, true]) {
  if (c && kg < 25) continue;
  const p = F.plates(kg, c), sum = 20 + (c ? 5 : 0) + 2 * p.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - kg) > 1e-9 || p.some((x, i) => i && x > p[i - 1])) { off++; console.log('BAD plates', kg, c, p); }
}
eq('plates: every load from 20 to 350 kg adds up, biggest first', off, 0);
// navy body fat (Hodgdon & Beckett 1984, inch form), worked by hand:
//   man 70 in tall, neck 15, abdomen 34: 86.010·log10(19) − 70.041·log10(70) + 36.76 = 17.51
//   woman 65 in, neck 13, waist 28, hip 38: 163.205·log10(53) − 97.684·log10(65) − 78.387 = 25.93
eq('navy man', F.navy('m', 70 * 2.54, 15 * 2.54, 34 * 2.54), 17.51, 0.01);
eq('navy woman', F.navy('f', 65 * 2.54, 13 * 2.54, 28 * 2.54, 38 * 2.54), 25.93, 0.01);
same('navy: abdomen not above the neck is not a reading', String(F.navy('m', 178, 40, 40)), 'NaN');
same('navy: a woman needs her hips', String(F.navy('f', 165, 33, 71)), 'NaN');
// activity multiplier (KiteSink's own numbers): BMR = weight x 22 / 19.8 / 17.6 kcal per kg by body-fat category;
// a usual day x 1.1-1.5; each hour of training adds 0.1-0.4 to that day
same('bmr category: men (15.x is "15% or less")', [10, 15, 15.9, 16, 25.9, 26].map(b => F.bmrCategory('m', b)).join(' '), '1 1 1 2 2 3');
same('bmr category: women', [20, 24.9, 25, 34.9, 35].map(b => F.bmrCategory('f', b)).join(' '), '1 1 2 2 3');
same('bmr category: unknown body fat', String(F.bmrCategory('m', NaN)), '0');
eq('category BMR, 80 kg, category 2', F.categoryBmr(80, 2), 1584);
eq('category BMR per lb matches the table', F.categoryBmr(100 / 2.2, 1), 1000, 1e-9);   // 100 lb at 10 kcal/lb
eq('a day: light plus an hour of moderate weights and 30 min of low cardio', F.dayMult(1.2, [{ id: 'wt1', min: 60 }, { id: 'aer1', min: 30 }]), 1.4, 1e-9);
eq('a day with no exercise is the usual day', F.dayMult(1.3, []), 1.3);
eq('one activity: an hour of medium cardio adds 0.3', F.activityMult('aer2', 60), 0.3, 1e-12);
eq('one activity: 90 min of heavy weights adds 0.3', F.activityMult('wt2', 90), 0.3, 1e-12);
eq('one activity: no minutes adds nothing', F.activityMult('aer3', 0), 0);
// one resting energy for Energy & macros, the planner and the activity multiplier
let R = F.resting({ method: 'cat', sex: 'm', kg: 80, bf: 18 });
eq('resting: category from body fat (men 18% is 2)', R.rmr, 80 * 19.8, 1e-9); same('resting: category 2', String(R.cat), '2');
R = F.resting({ method: 'cat', sex: 'f', kg: 60, bf: NaN, cat: 3 });
eq('resting: no body fat uses the chosen category', R.rmr, 60 * 17.6, 1e-9);
eq('resting: Cunningham without body fat falls back to Mifflin', F.resting({ method: 'cunningham', sex: 'm', kg: 80, cm: 180, age: 30 }).rmr, 1780);
eq('resting: no method keeps the old rule', F.resting({ sex: 'm', kg: 80, cm: 180, age: 30, bf: 20 }).rmr, 1752.4);
eq('energy with the category method', F.energy({ method: 'cat', sex: 'm', kg: 80, cm: 180, age: 30, bf: 18, pal: 1.2, goal: 'hold', rate: 0, protein: 2, fatPct: 25 }).maint, 80 * 19.8 * 1.2, 1e-9);
same('exercise bands: medium 130-155, high 155-180', F.exercise('aer2').d + ' / ' + F.exercise('aer3').d, 'HR 130\u2013155 / HR 155\u2013180');
same('levels and exercise: every multiplier in range', String(F.LEVELS.every(l => l.m >= 1.1 && l.m <= 1.5) && F.EXERCISE.every(e => e.m >= 0.1 && e.m <= 0.4)), 'true');
// travel builder: every combination produces a session with moves, only using allowed kit and level
const kits = [[], ['db'], ['kb', 'band'], ['bar', 'bench', 'sus'], ['db', 'kb', 'band', 'bar', 'bench', 'sus']];
let n = 0, bad = 0;
for (const equip of kits) for (const minutes of [15, 20, 30, 45]) for (const level of [1, 2, 3]) for (const format of ['circuit', 'emom', 'amrap', 'intervals', 'sets']) for (let seed = 1; seed <= 6; seed++) {
  const s = F.travel({ equip, minutes, level, format, seed }); n++;
  const moves = s.main.flatMap(b => b.items);
  if (!moves.length || !s.rule) { bad++; console.log('EMPTY', equip, minutes, level, format); continue; }
  for (const m of moves) {
    const ex = F.EXERCISES.find(x => x.n === m.name);
    const okKit = [].concat(ex.e).some(k => k === 'bw' || equip.includes(k));
    if (!okKit || ex.l > level || !m.dose) { bad++; console.log('BAD', JSON.stringify(m), equip, level); }
  }
  // the main block must fit the minutes it was given
  if (!(s.mainSec > 0) || s.mainSec > s.budgetSec) { bad++; console.log('TOO LONG', minutes, level, format, s.mainSec + 's of ' + s.budgetSec + 's'); }
  if (/emom|amrap/.test(s.title)) { bad++; console.log('TITLE CASE', s.title); }
}
console.log('travel sessions built:', n, 'bad:', bad); fail += bad;
// same seed → same session
const a = JSON.stringify(F.travel({ equip: ['db'], minutes: 30, level: 2, format: 'circuit', seed: 42 })), b = JSON.stringify(F.travel({ equip: ['db'], minutes: 30, level: 2, format: 'circuit', seed: 42 }));
console.log('deterministic:', a === b); if (a !== b) fail++;
console.log(F.travelText(F.travel({ equip: ['db', 'bench'], minutes: 30, level: 2, format: 'circuit', seed: 7 })));
// the load tool inverts the same estimate it shows: what you lifted comes back out
for (const [w, r] of [[100, 5], [60, 12], [142.5, 3], [225, 1], [80, 10], [80, 11]]) eq(`round trip ${w}x${r}`, F.loadFor(F.oneRm(w, r), r, 0), w, 1e-9);
// a 15-minute session and a 20-minute session are not the same workout
for (const format of ['circuit', 'intervals', 'sets']) {
  const a = F.travel({ equip: [], minutes: 15, level: 2, format, seed: 3 }), b = F.travel({ equip: [], minutes: 20, level: 2, format, seed: 3 });
  const size = s => s.main.reduce((n, blk) => n + blk.items.length, 0) + '|' + s.rule;
  if (size(a) === size(b)) { fail++; console.log('FAIL 15 and 20 minute ' + format + ' are identical'); } else console.log('ok   15 vs 20 minute ' + format + ' differ');
}
// meet attempts: every attempt is a multiple of 2.5 kg, each is heavier than the last,
// "standard" ends on the lifter's best, and the warm-up ladder climbs to just under the opener
for (const style of ['first', 'standard', 'bold']) for (const best of [42.5, 60, 100, 137.5, 182.5, 300, 20]) {
  const a = F.attempts(best, style);
  const good = a.length === 3 && a.every(v => Math.abs(v / 2.5 - Math.round(v / 2.5)) < 1e-9) && a[0] < a[1] && a[1] < a[2] && a[0] > best * 0.8 && a[2] < best * 1.08 + 2.5;
  if (!good) { fail++; console.log(`FAIL attempts ${style} ${best}: ${a}`); }
  const w = F.warmups(a[0]);
  const climbing = w.every((x, i) => x.kg < a[0] && (!i || x.kg > w[i - 1].kg) && x.reps >= 1 && Math.abs(x.kg / 2.5 - Math.round(x.kg / 2.5)) < 1e-9);
  if (!climbing) { fail++; console.log(`FAIL warm-ups to ${a[0]}: ${JSON.stringify(w)}`); }
}
console.log('ok   meet attempts and warm-up ladders (21 cases)');
eq('standard third attempt is the best single', F.attempts(180, 'standard')[2], 180, 1e-9);
eq('unknown style falls back to standard', F.attempts(180, 'nope')[0], F.attempts(180, 'standard')[0], 1e-9);

// ---------- the hub's search: KSFit.search(index, query, limit) ----------
const ok = (name, cond, detail) => { if (!cond) fail++; console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond || detail === undefined ? '' : ': ' + detail)); };
const tiny = { pages: ['hypertrophy', 'glossary', 'claims'], kinds: ['Guidance', 'Term', 'Claim', 'Number'], areas: ['Hypertrophy', 'Nutrition'], rows: [
  ['hyp-a', 0, 0, 0, 'Train each muscle about twice a week', 'Frequency matters less than weekly volume, which a deload can reset.'],
  ['hyp-t', 1, 1, 0, 'Deload', 'A planned easier week.'],
  ['hyp-b', 0, 0, 0, 'Take a deload when fatigue builds', 'A lighter week lets fatigue fall.'],
  ['claim-c', 2, 2, 1, 'Does creatine harm the kidneys?', 'Not in healthy people at normal doses.', 'Not supported'],
  ['nut-n', 0, 3, 1, 'Protein per day', 'A range that covers most lifters.', '1.6-2.2 g per kg per day'],
  ['hyp-r', 0, 0, 0, 'Preloading is not a word here', 'Nothing about rest weeks.'] ] };
let r = F.search(tiny, 'deload');
ok('search: a title that is the query comes first, then a title word, then the short answer', r.hits.map(h => h.id).join() === 'hyp-t,hyp-b,hyp-a', r.hits.map(h => h.id).join());
ok('search: the middle of a word counts least and still matches', F.search(tiny, 'load').hits.map(h => h.id).join() === 'hyp-t,hyp-b,hyp-r,hyp-a', F.search(tiny, 'load').hits.map(h => h.id).join());
r = F.search(tiny, '  CREATINE   kidneys ');
ok('search: every word must match; case and spacing do not matter', r.total === 1 && r.hits[0].id === 'claim-c');
ok('search: a hit carries its address, area, kind and extra', r.hits[0].href === '/fitness/claims#claim-c' && r.hits[0].area === 'Nutrition' && r.hits[0].kind === 'Claim' && r.hits[0].extra === 'Not supported');
ok('search: a term lives on the glossary', F.search(tiny, 'deload').hits[0].href === '/fitness/glossary#hyp-t');
ok('search: no match is an empty list', F.search(tiny, 'deload zzz').total === 0 && F.search(tiny, 'zzz').hits.length === 0);
ok('search: an empty query finds nothing', F.search(tiny, '').total === 0 && F.search(tiny, '   ').total === 0 && F.search(tiny).total === 0);
r = F.search(tiny, 'a', 2);
ok('search: limit cuts the list, not the total', r.hits.length === 2 && r.total > 2, r.hits.length + ' of ' + r.total);
ok('search: a word in the title beats the same word in the answer', F.search(tiny, 'week').hits[0].id === 'hyp-a');

// the real index and the real map (scripts/build_fitness.py writes both): they must agree
const pub = require('path').join(__dirname, '..', 'public');
const index = JSON.parse(fs.readFileSync(pub + '/fitness/search.json', 'utf8')), map = JSON.parse(fs.readFileSync(pub + '/fitness/ids.json', 'utf8'));
const homeOf = id => Object.prototype.hasOwnProperty.call(map.ids, id) ? map.pages[map.ids[id]] : null;
ok('index: one row per entry, each id once', new Set(index.rows.map(x => x[0])).size === index.rows.length && index.rows.length > 0, index.rows.length);
ok('index: every row has a title and a short answer', index.rows.every(x => x[4] && x[5]));
ok('index and map send every entry to the same page', index.rows.every(x => homeOf(x[0]) === index.pages[x[1]]));
ok('index: terms are on the glossary and claims on the claims page', index.rows.every(x => index.kinds[x[2]] !== 'Term' || index.pages[x[1]] === 'glossary') && index.rows.every(x => index.kinds[x[2]] !== 'Claim' || index.pages[x[1]] === 'claims'));
r = F.search(index, 'protein');
ok('real search: "protein" finds entries, each with the word in its title or answer', r.total > 5 && r.hits.every(h => (h.title + ' ' + h.take).toLowerCase().includes('protein')), r.total);
ok('real search: the hits are in more than one area', new Set(r.hits.map(h => h.area)).size > 1);
ok('real search: every hit address is /fitness/<page>#<id> for a page in the map', F.search(index, 'a').hits.every(h => { const m = /^\/fitness\/([a-z0-9-]+)#(.+)$/.exec(h.href); return m && homeOf(m[2]) === m[1]; }));

// ---------- the forwarder: the first script of the hub, lifted out of the built page and run here ----------
const hubHtml = fs.readFileSync(pub + '/fitness.html', 'utf8');
const fwd = /<script id="fit-forward">([\s\S]*?)<\/script>/.exec(hubHtml);
ok('hub: the forwarding script is in the <head>, before the site stylesheet and the body', !!fwd && hubHtml.indexOf('id="fit-forward"') < hubHtml.indexOf('href="/ks.css') && hubHtml.indexOf('href="/ks.css') < hubHtml.indexOf('<body'));
const hubIds = new Set([...hubHtml.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
async function visit(hash, opts = {}) {
  const seen = { fetched: 0, replaced: null, hidden: false, listeners: {} };
  const classes = new Set();
  const win = {
    fetch: url => { seen.fetched++; seen.url = url; return opts.offline ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: !opts.missing, json: () => Promise.resolve(map) }); },
    addEventListener: (name, fn) => { seen.listeners[name] = fn; }
  };
  const box = { window: win, location: { hash, replace: url => { seen.replaced = url; } },
    document: { documentElement: { classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) } } },
    setTimeout: () => 1, clearTimeout: () => {}, decodeURIComponent, Object, Promise };
  vm.runInNewContext(fwd[1], box);
  seen.hiddenAtStart = classes.has('fwd');
  await new Promise(done => setImmediate(done)); await new Promise(done => setImmediate(done));
  seen.hidden = classes.has('fwd');
  return seen;
}

// ---------- diet planner ----------
{
  const P = F.PLAN, train = [true, false, true, false, true, true, false];
  const base = { sex: 'm', kg: 80, cm: 180, age: 30, pal: 1.6, train };
  const plan = o => F.plan(Object.assign({}, base, o));
  // maintenance by hand: Mifflin 1780 × 1.6 = 2848; an own figure replaces it
  let p = plan({ phase: 'hold' });
  eq('planner: maintenance is resting × activity', p.maint, 2848); ok('planner: maintain holds', p.weekBalance === 0 && !p.dietDay);
  eq('planner: own maintenance figure is used', plan({ phase: 'hold', maint: 2500 }).maint, 2500);
  eq('planner: maintain protein 1.6 g/kg', p.protein, 128);
  // the weekly deficit is diet days × the gap on each
  for (const d of [7, 4, 3.5, 2]) {
    p = plan({ phase: 'lose', days: d, size: 25 });
    eq(`planner: ${d} diet days a week at 25% below → weekly deficit`, p.weekBalance, -2848 * 0.25 * d, 0.01);
    ok(`planner: ${d} diet days uses a ${d % 1 ? 14 : 7}-day cycle with ${d * (d % 1 ? 2 : 1)} diet days`, p.len === (d % 1 ? 14 : 7) && p.n === d * p.len / 7);
    ok(`planner: ${d} diet days, macros add up`, [p.dietDay, p.maintDay].every(x => Math.abs(x.protein * 4 + x.carbs * 4 + x.fat * 9 - x.kcal) < 1e-6));
  }
  // protein rises with the deficit: 1.6 → 2.3 g/kg body weight, or 2.3 → 3.1 g/kg FFM with body fat
  eq('protein: no deficit, no body fat', F.planProtein(80, NaN, 'lose', 0), 128);
  eq('protein: 25% deficit, no body fat', F.planProtein(80, NaN, 'lose', 25), 184);
  eq('protein: capped past 25%', F.planProtein(80, NaN, 'lose', 40), 184);
  eq('protein: 12.5% deficit at 20% body fat', F.planProtein(80, 20, 'lose', 12.5), 64 * 2.7);
  ok('protein: a bigger deficit means more protein', plan({ phase: 'lose', days: 7, size: 30 }).protein > plan({ phase: 'lose', days: 2, size: 30 }).protein);
  // diet days go to rest days first
  p = plan({ phase: 'lose', days: 3, size: 25 });
  ok('placement: three diet days on the three rest days', p.diet.every((d, i) => !d || !train[i]) && p.dietOnTraining === 0);
  p = plan({ phase: 'lose', days: 3.5, size: 25 });
  ok('placement: 7 diet days in 14 with 6 rest days puts one on a training day', p.dietOnTraining === 1);
  // set by hand: the count follows the days chosen
  p = plan({ phase: 'lose', days: 3, size: 25, diet: [true, true, true, true, false, false, false] });
  ok('by hand: four days chosen means four diet days', p.n === 4 && p.dietOnTraining === 2);
  // the floor on a diet day: protein + essential fat, or 25% of maintenance
  p = plan({ phase: 'lose', days: 2, size: 90 });
  ok('floor: a diet day cannot go under protein + essential fat or 25% of maintenance',
    p.clampedSize && p.dietDay.kcal >= Math.max(p.protein * 4 + P.EFA_SHARE * p.maint, P.VLOW_SHARE * p.maint) - 1e-6, p.size);
  ok('floor: the diet day keeps the essential-fat minimum', p.dietDay.fat >= P.EFA_SHARE * p.maint / 9 - 1e-9);
  // the week's average stays at 1,200 or more
  const small = { sex: 'f', kg: 50, cm: 155, age: 60, pal: 1.4 };
  p = plan(Object.assign({}, small, { phase: 'lose', days: 7, size: 60 }));
  ok('floor: a small person dieting 7 days a week is held at 1,200 on average', p.avgKcal >= 1200 - 1e-6 && p.clampedSize, Math.round(p.avgKcal));
  // gaining
  p = plan({ phase: 'gain', gain: 5 });
  eq('gain: +5% over maintenance', p.maintDay.kcal, 2848 * 1.05, 0.01);
  // energy availability needs body fat
  ok('energy availability only with body fat', isNaN(plan({ phase: 'lose', days: 7, size: 20 }).ea) && plan({ phase: 'lose', days: 7, size: 20, bf: 20 }).ea > 0);
}

// ---------- the calculators' guide numbers: scripts/build_fitness.py puts them in the hub as #tool-data ----------
const TD = JSON.parse(/<script type="application\/json" id="tool-data">([\s\S]*?)<\/script>/.exec(fs.readFileSync(require('path').join(__dirname, '..', 'public', 'fitness.html'), 'utf8'))[1]);
ok('tool data: every piece names its guide entry', Object.keys(TD).filter(k => k !== 'suppItems').every(k => /^\/fitness\/[a-z-]+#[a-z0-9-]+$/.test(TD[k].href) && TD[k].title));

// ---------- 1RM: how hard was that set (reps in reserve count as reps), RIR or RPE ----------
{
  eq('rirFromRpe 10', F.rirFromRpe(10), 0); eq('rirFromRpe 9.5 is half a rep', F.rirFromRpe(9.5), 0.5); eq('rirFromRpe 8', F.rirFromRpe(8), 2); eq('rirFromRpe 5', F.rirFromRpe(5), 5);
  ok('rirFromRpe: below 5 or above 10 is not offered', isNaN(F.rirFromRpe(4.5)) && isNaN(F.rirFromRpe(11)));
  eq('the default (0 in reserve) is the estimate as it was: 100 x 5', F.oneRm(100, 5 + 0), 114.5833, 0.001);
  eq('100 x 5 with 2 in reserve reads as 7 reps', F.oneRm(100, 5 + 2), F.oneRm(100, 7), 1e-12);
  eq('round trip: 5 reps at 2 in reserve from that estimate is 100', F.loadFor(F.oneRm(100, 5 + 2), 5, 2), 100, 1e-9);
  eq('round trip at RPE 9.5 (half a rep)', F.loadFor(F.oneRm(140, 3 + F.rirFromRpe(9.5)), 3, 0.5), 140, 1e-9);
  ok('half steps land between whole ones', F.oneRm(100, 5.5) > F.oneRm(100, 5) && F.oneRm(100, 5.5) < F.oneRm(100, 6));
  const rows = TD.rpe.rows;
  same('rpe chart rows from the guide: RPE 9.5', F.rpeRow(rows, 9.5).rir, '0-1');
  same('rpe chart rows: RPE 6 and 5 share the 5-6 row', F.rpeRow(rows, 6).rir + ' ' + F.rpeRow(rows, 5).rir, '4-6 4-6');
  ok('rpe chart: every whole RPE from 5 to 10 has a row, and 10 - RPE sits in its range', [5, 6, 7, 8, 9, 9.5, 10].every(r => { const row = F.rpeRow(rows, r); const [lo, hi] = row.rir.split('-').map(Number); return F.rirFromRpe(r) >= lo && F.rirFromRpe(r) <= (hi === undefined ? lo : hi); }));
}

// ---------- weight class finder: the IPF classes from the guide's class table ----------
{
  const C = (kg, sex, jr) => F.ipfClass(kg, sex, jr, TD.ipf).name;
  same('class: 59.00 kg is the 59 class (a limit includes its number)', C(59.00, 'm', false), '59');
  same('class: 59.01 kg is the 66 class', C(59.01, 'm', false), '66');
  same('class: 120.0 kg is the 120 class, 120.01 is 120+', C(120, 'm', false) + ' ' + C(120.01, 'm', false), '120 120+');
  same('class: 52 kg is 59 for an open lifter, 53 for a junior', C(52, 'm', false) + ' ' + C(52, 'm', true), '59 53');
  same('class: women 84.0 and 84.01', C(84.0, 'f', false) + ' ' + C(84.01, 'f', false), '84 84+');
  same('class: women 43 is a junior class only', C(42, 'f', false) + ' ' + C(42, 'f', true), '47 43');
  const r = F.ipfClass(80, 'm', false, TD.ipf);
  ok('class: 80 kg is 3 under 83; the class below is 74, a cut of 6 kg, 7.5% of body weight', r.name === '83' && Math.abs(r.under - 3) < 1e-9 && r.below.name === '74' && Math.abs(r.below.cut - 6) < 1e-9 && Math.abs(r.below.pct - 7.5) < 1e-9);
  ok('class: the lightest open class has none below; the open class has no limit', F.ipfClass(55, 'm', false, TD.ipf).below === null && F.ipfClass(130, 'm', false, TD.ipf).open);
  ok('class: no weight, no class', F.ipfClass(NaN, 'm', false, TD.ipf) === null);
}

// ---------- FFMI & goal weight: the guide's worked example (comp-table-arithmetic) ----------
{
  const r = F.ffmi({ kg: 80, cm: 180, bf: 25, target: 15 }, TD.ffmiNorm);
  eq('ffmi: fat 80 x 0.25', r.fat, 20, 1e-9); eq('ffmi: lean 80 - 20', r.lean, 60, 1e-9); eq('ffmi: 60 / 1.8 squared = 18.5', r.ffmi, 18.52, 0.01);
  eq('ffmi: target 15% if lean holds, 60 / 0.85 = 70.6', r.goal, 70.6, 0.02); eq('ffmi: to lose 9.4', r.lose, 9.4, 0.02);
  eq('ffmi: at 1.80 m the height adjustment is nothing', r.norm, r.ffmi, 1e-9);
  const s = F.ffmi({ kg: 70, cm: 170, bf: 15, target: 10 }, TD.ffmiNorm);
  eq('ffmi: height-normalised at 1.70 m adds 6.3 x 0.10', s.norm - s.ffmi, TD.ffmiNorm.k * 0.1, 1e-9);
  same('ffmi: the adjustment read from the guide is 6.3 x (1.80 - h)', TD.ffmiNorm.k + ' ' + TD.ffmiNorm.h, '6.3 1.8');
  ok('ffmi: a target at or above body fat now gives no goal weight', F.ffmi({ kg: 80, cm: 180, bf: 25, target: 25 }).goal === null && F.ffmi({ kg: 80, cm: 180, bf: 25, target: 30 }).lose === null);
  ok('ffmi: the reference rows are read by sex', TD.ffmiRef.rows.filter(x => x.sex === 'f').map(x => x.value).join() === '16.3,23.9' && TD.ffmiRef.rows.some(x => x.value === 25 && x.sex === 'm'));
}

// ---------- heart-rate zones: the guide's age formula and five-zone scale ----------
{
  eq('hrMax(40) = 208 - 0.7 x 40 = 180', F.hrMax(40, TD.hrMax), 180, 1e-9);
  same('zones at 180: the five ranges', F.zones(180, TD.zones.rows).map(z => z.lo + '-' + z.hi).join(' '), '99-135 135-153 153-162 162-171 171-180');
  let r = F.hrPick({ age: 40, max: 190 }, TD.hrMax);
  ok('a measured maximum overrides the age formula', r.max === 190 && r.from === 'max');
  r = F.hrPick({ age: 40, max: '' }, TD.hrMax);
  ok('no measured maximum: from age', r.max === 180 && r.from === 'age');
  ok('a maximum out of range is an error, not a fallback', F.hrPick({ age: 40, max: 300 }, TD.hrMax).err === 'max');
  ok('resting at or above the maximum is rejected', F.hrPick({ age: 40, max: 100, rest: 100 }, TD.hrMax).restErr === 'max' && F.hrPick({ age: 40, rest: 55 }, TD.hrMax).rest === 55);
  ok('resting out of range is rejected', F.hrPick({ age: 40, rest: 20 }, TD.hrMax).restErr === 'range');
  same('zone middles in the activity bands at 180: low, medium, high, high, high', F.zones(180, TD.zones.rows).map(z => F.hrBand((z.lo + z.hi) / 2).id).join(' '), 'aer1 aer2 aer3 aer3 aer3');
  ok('above 180 there is no band', F.hrBand(181) === null && F.hrBand(130).id === 'aer1' && F.hrBand(130.5).id === 'aer2');
  same('resting ranges read from the guide', TD.hrRest.adult.join('-') + ' ' + TD.hrRest.athlete.join('-'), '60-100 40-60');
}

// ---------- my numbers: the shared `me`, and migrating what the tools saved before it ----------
{
  const J = x => JSON.stringify(x);
  const mig = b => F.migrate(b);
  same('migrate: nothing saved is an empty me', J(mig({})), J({ v: 1, units: '', own: {} }));
  same('migrate: not an object is an empty me', J(mig(null)) + J(mig([1, 2])) + J(mig('x')), J(F.meEmpty()).repeat(3));
  same('migrate: corrupt JSON reads as nothing', J(mig(F.parseBlob('{"kg": 80,'))), J(F.meEmpty()));
  same('migrate: a JSON array reads as nothing', J(F.parseBlob('[1]')), '{}');
  // the examples every tool saved on its first visit are nobody's numbers
  const untouched = { units: 'metric', sex: 'm', kg: 75, cm: 175, age: 30, bf: '', pal: 1.6, mTouched: false,
    att: { units: 'kg', style: 'first', warm: 'squat', squat: 140, bench: 90, dead: 170 }, hero: { goal: null, level: 'mid', max: 100 },
    navy: { units: 'cm', sex: 'm', h: 178, neck: 38, waist: 86, hip: 97, kg: '', pct: 17.9, touched: false } };
  same('migrate: untouched defaults own nothing', J(mig(untouched).own), '{}');
  same('migrate: units carry over without owning anything', mig(untouched).units, 'metric');
  // mTouched: the body fields are the visitor's
  let m = mig({ units: 'imperial', sex: 'f', kg: 61.2, cm: 166, age: 41, bf: 27, mTouched: true });
  same('migrate: mTouched owns sex, age, weight, height and body fat', Object.keys(m.own).sort().join(), 'age,bf,cm,kg,sex');
  ok('migrate: mTouched keeps the values and marks body fat as typed', m.kg === 61.2 && m.cm === 166 && m.age === 41 && m.bf === 27 && m.sex === 'f' && m.bfFrom === 'typed' && m.units === 'imperial');
  m = mig({ kg: 80, cm: 180, age: 30, bf: '', mTouched: true });
  ok('migrate: an empty body fat is not owned', !m.own.bf && !('bf' in m) && !m.bfFrom);
  // before the flag existed: values that differ from 75 / 175 / 30 were the visitor's
  ok('migrate: pre-flag, a weight other than 75 is the visitor\'s', mig({ kg: 82, cm: 175, age: 30 }).own.kg === 1);
  ok('migrate: pre-flag, body fat alone is enough', mig({ kg: 75, cm: 175, age: 30, bf: 20 }).bf === 20);
  ok('migrate: pre-flag, 75 / 175 / 30 with no body fat is the example', J(mig({ kg: 75, cm: 175, age: 30, bf: '' }).own) === '{}');
  ok('migrate: mTouched false wins over the old inference', J(mig({ kg: 90, cm: 190, age: 44, mTouched: false }).own) === '{}');
  // the navy tool: fills what is empty, and its result is the body fat when none was typed
  m = mig({ navy: { touched: true, sex: 'm', h: 180, kg: 92, pct: 17 } });
  ok('migrate: navy only fills sex, height, weight and body fat (from navy)', m.cm === 180 && m.kg === 92 && m.bf === 17 && m.bfFrom === 'navy' && m.sex === 'm');
  m = mig({ units: 'metric', sex: 'm', kg: 92, cm: 180, age: 35, bf: 18, pal: 1.6, mTouched: true, navy: { touched: true, pct: 17, h: 178, kg: 90 } });
  ok('migrate: a typed body fat and body numbers beat the navy tool\'s', m.bf === 18 && m.bfFrom === 'typed' && m.cm === 180 && m.kg === 92);
  ok('migrate: untouched navy readings are examples', J(mig({ navy: { touched: false, h: 178, kg: 80, pct: 17.9 } }).own) === '{}');
  ok('migrate: a navy reading out of range is skipped', mig({ navy: { touched: true, pct: 72, h: 180 } }).bf === undefined);
  // Meet attempts has no flag: a lift is the visitor's only when it is not the example
  m = mig({ att: { units: 'lb', squat: 150, bench: 90, dead: 200.5 } });
  ok('migrate: attempts only, lifts that differ from 140 / 90 / 170', m.squat === 150 && m.dead === 200.5 && !m.own.bench);
  ok('migrate: the hero\'s best squat when it is not 100', mig({ hero: { max: 120 } }).squat === 120 && !mig({ hero: { max: 100 } }).own.squat);
  ok('migrate: attempts beat the hero for the squat', mig({ att: { squat: 150 }, hero: { max: 120 } }).squat === 150);
  ok('migrate: the 1RM tool\'s set weight is not a best', J(mig({ loadKg: 120, loadReps: 5 }).own) === '{}');
  // the returning visitor the browser pass uses, and idempotence
  const visitor = { units: 'metric', sex: 'm', kg: 92, cm: 180, age: 35, bf: 18, pal: 1.6, mTouched: true, navy: { touched: true, pct: 17, h: 180, kg: 92 } };
  const once = mig(visitor);
  same('migrate: twice is the same as once', J(mig(Object.assign({}, visitor, { me: once }))), J(once));
  same('migrate: an existing me is kept, cleaned', J(mig({ kg: 50, mTouched: true, me: { v: 1, kg: 999, own: { kg: 1 }, units: 'x' } })), J(F.meEmpty()));
  // own marking
  let r = F.meSet(F.meEmpty(), { kg: 80, cm: '' });
  ok('meSet: a value in range is set and owned', r.me.kg === 80 && r.me.own.kg === 1 && J(r.changed) === '["kg"]');
  r = F.meSet(r.me, { kg: 12 });
  ok('meSet: a value out of range changes nothing', r.me.kg === 80 && r.changed.length === 0);
  r = F.meSet(r.me, { kg: '' });
  ok('meSet: clearing a field un-owns it', !('kg' in r.me) && !r.me.own.kg && J(r.changed) === '["kg"]');
  r = F.meSet(F.meEmpty(), { bf: 17.5 }, { bfFrom: 'navy' });
  ok('meSet: body fat remembers where it came from', r.me.bfFrom === 'navy' && F.meSet(r.me, { bf: 17.5 }).changed.join() === 'bf' && F.meSet(r.me, { bf: 17.5 }).me.bfFrom === 'typed');
  ok('meSet: the same value again changes nothing', F.meSet(F.meSet(F.meEmpty(), { age: 40 }).me, { age: '40' }).changed.length === 0);
  ok('meSet: units are a setting, not an owned number', F.meSet(F.meEmpty(), { units: 'imperial' }).me.units === 'imperial' && J(F.meSet(F.meEmpty(), { units: 'imperial' }).me.own) === '{}');
  ok('meSet: unknown keys are ignored', F.meSet(F.meEmpty(), { pal: 1.6, goal: 'lose' }).changed.length === 0);
  ok('meSet: the input is not changed', (() => { const a = F.meEmpty(); F.meSet(a, { kg: 80 }); return J(a) === J(F.meEmpty()); })());
}

(async () => {
  const entry = index.rows.find(x => index.kinds[x[2]] === 'Guidance')[0], term = index.rows.find(x => index.kinds[x[2]] === 'Term')[0];
  const source = Object.keys(map.ids).find(k => k.startsWith('src-') && homeOf(k) === 'sources');
  for (const [id, page] of [[entry, homeOf(entry)], [term, 'glossary'], [source, 'sources'], ['glossary', 'glossary'], ['meet-day', 'meet'], ['hypertrophy', 'hypertrophy'], ['claims', 'claims']]) {
    const s = await visit('#' + id);
    ok(`forward: /fitness#${id} goes to /fitness/${page}#${id}, with the page hidden meanwhile`, s.replaced === `/fitness/${page}#${id}` && s.hiddenAtStart && s.url === '/fitness/ids.json', s.replaced);
  }
  for (const id of ['tools', 'macros', 'reps', 'loads', 'travel', 'attempts', 'vantix', 'guide', 'training', 'reference', 'main']) {
    const s = await visit('#' + id);
    ok(`forward: /fitness#${id} stays on the hub and fetches nothing`, hubIds.has(id) && s.replaced === null && s.fetched === 0 && !s.hiddenAtStart);
  }
  let s = await visit('');
  ok('forward: no fragment, nothing happens', s.replaced === null && s.fetched === 0);
  s = await visit('#hyp-no-entry-has-this-id');
  ok('forward: an id no page has stays on the hub, shown again', s.replaced === null && s.fetched === 1 && s.hiddenAtStart && !s.hidden);
  s = await visit('#' + entry, { offline: true });
  ok('forward: if the map cannot be fetched the hub is shown', s.replaced === null && !s.hidden);
  s = await visit('#' + entry, { missing: true });
  ok('forward: if the map is not there the hub is shown', s.replaced === null && !s.hidden);
  s = await visit('#' + encodeURIComponent(entry));
  ok('forward: an encoded fragment is understood', s.replaced === `/fitness/${homeOf(entry)}#${encodeURIComponent(entry)}`);
  ok('forward: it listens for the fragment changing later', typeof s.listeners.hashchange === 'function');
  // leaving before the page was shown: the cross-fade between pages is skipped, and only then
  let skipped = 0; const swap = { viewTransition: { skipTransition: () => { skipped++; } } };
  s.listeners.pageswap(swap); s.listeners.pageswap({ viewTransition: null });
  ok('forward: while forwarding, the page-to-page transition is skipped', skipped === 1);
  s = await visit('#tools'); skipped = 0; s.listeners.pageswap(swap);
  ok('forward: a normal move away from the hub keeps its transition', skipped === 0);
  ok('map: no id in it is an element of the hub', Object.keys(map.ids).every(id => !hubIds.has(id)));
  const legacy = fs.readFileSync(require('path').join(__dirname, 'fixtures', 'fitness-legacy-ids.txt'), 'utf8').split(/\s+/).filter(Boolean);
  const lost = legacy.filter(id => !hubIds.has(id) && !homeOf(id));
  ok(`map: all ${legacy.length} ids of the one-page /fitness are on the hub or in the map`, lost.length === 0, lost.join(' '));
  console.log(fail ? 'FAILURES: ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
