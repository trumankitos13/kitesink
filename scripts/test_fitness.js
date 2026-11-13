// Zero-dependency checks for the calculator maths in public/fitness.js.  Run: node scripts/test_fitness.js
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
// loadFor is Epley inverted: 1RM 116.67, 5 reps @0 → 100
eq('loadFor', F.loadFor(116.6667, 5, 0), 100, 0.001); eq('loadFor 8@2', F.loadFor(120, 8, 2), 90);
eq('repsAt 75%', F.repsAt(0.75), 10);
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
// the load tool inverts the same equation it estimates with: what you lifted comes back out
for (const [w, r] of [[100, 5], [60, 12], [142.5, 3], [225, 1]]) eq(`round trip ${w}x${r}`, F.loadFor(F.epley(w, r), r, 0), w, 1e-9);
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
console.log(fail ? 'FAILURES: ' + fail : 'ALL PASS');
process.exit(fail ? 1 : 0);
