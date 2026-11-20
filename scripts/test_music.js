// Zero-dependency checks for public/music-tools.js: the mechanical rate calculator's maths (37 CFR 385.11,
// content/music/DATA-PAGES.md section 3) and the unclaimed-money checklist's filter, against hand-worked values.
// Run: node scripts/test_music.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { window: {}, Math, console, Date };
ctx.window.window = ctx.window;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'music-tools.js'), 'utf8'), ctx);
const M = ctx.window.KSMusic; let fail = 0;
const ok = (name, cond, got) => { if (!cond) fail++; console.log((cond ? 'ok   ' : 'FAIL ') + name + (got === undefined ? '' : ': ' + got)); };
const eq = (name, got, want) => ok(name + (got === want ? '' : ' (want ' + JSON.stringify(want) + ')'), got === want, JSON.stringify(got));

// Rates shaped like content/music/rates.json. 2026 is the Phonorecords IV figure for that year (13.1 cents or
// 2.52 cents a minute); the 2024 row is only here to check that the year chosen is the year used.
const rates = {
  physical: [{ year: 2024, per_work_cents: 12.4, per_minute_cents: 2.39 }, { year: 2026, per_work_cents: 13.1, per_minute_cents: 2.52 }],
  streaming_revenue_percent: [{ year: 2026, percent: 15.3 }],
  ringtone_cents: { value: 24 }
};
const at = (min, sec, copies = 1, year = 2026) => M.calc(rates, year, M.seconds(min, sec), copies);

// Minutes are charged whole: a part minute counts as one ("per minute of playing time or fraction thereof").
eq('minutes 3:30', M.minutesCharged(210), 4); eq('minutes 5:00', M.minutesCharged(300), 5); eq('minutes 5:01', M.minutesCharged(301), 6);
eq('minutes 0:01', M.minutesCharged(1), 1); eq('minutes 6:12', M.minutesCharged(372), 7);

// 3:30 -> 4 minutes x 2.52 = 10.08 < 13.1, so the per-work rate: 13.1 cents
let r = at(3, 30); eq('3:30 cents', M.formatCents(r.h), '13.1'); eq('3:30 rule', r.rule, 'per-work'); eq('3:30 per-minute figure', M.formatCents(r.minuteH), '10.08');
// 5:00 -> 5 x 2.52 = 12.6 < 13.1: still 13.1
r = at(5, 0); eq('5:00 cents', M.formatCents(r.h), '13.1'); eq('5:00 rule', r.rule, 'per-work'); eq('5:00 per-minute figure', M.formatCents(r.minuteH), '12.6');
// 5:01 -> 6 x 2.52 = 15.12 > 13.1: per minute
r = at(5, 1); eq('5:01 cents', M.formatCents(r.h), '15.12'); eq('5:01 rule', r.rule, 'per-minute');
// 10:00 -> 10 x 2.52 = 25.2
r = at(10, 0); eq('10:00 cents', M.formatCents(r.h), '25.2'); eq('10:00 cents (number)', r.cents, 25.2);
// 1000 copies of a 6:12 track -> 7 x 2.52 = 17.64 cents -> $176.40, worked in whole hundredths of a cent
r = at(6, 12, 1000); eq('6:12 cents', M.formatCents(r.h), '17.64'); eq('6:12 x 1000 total', r.dollars, '$176.40');
eq('6:12 x 1000 total cents', r.totalCents, 17640); eq('6:12 x 1000 exact', r.exact, true);
// floating point: 4 x 2.52 is 10.08 exactly here, not 10.079999...
eq('no float drift', M.hundredths(2.52) * 4, 1008);
// 3 copies at 13.1 = 39.3 cents -> $0.39, flagged as rounded
r = at(3, 0, 3); eq('3 copies total', r.dollars, '$0.39'); eq('3 copies exact', r.exact, false);
// a million copies of a 3:00 track -> 13,100,000 cents -> $131,000.00
r = at(3, 0, 1000000); eq('1,000,000 copies', r.dollars, '$131,000.00');
// the year chosen is the year used: 2024, 3:00 -> 12.4; 6:00 -> 6 x 2.39 = 14.34
eq('2024 3:00', M.formatCents(at(3, 0, 1, 2024).h), '12.4'); eq('2024 6:00', M.formatCents(at(6, 0, 1, 2024).h), '14.34');
// a tie is reported as one: per-work 12 cents, per-minute 2.4 -> 5:00 gives 12 both ways
const tie = M.perCopy({ per_work_cents: 12, per_minute_cents: 2.4 }, 300); eq('tie flagged', tie.tie, true); eq('tie cents', M.formatCents(tie.h), '12');
// years: only those in the data; no year, no rate
eq('unknown year', at(3, 0, 1, 2019), null); eq('years', JSON.stringify(M.years(rates)), '[2024,2026]');
eq('default year when present', M.defaultYear(rates, 2026), 2026); eq('default year falls back to the latest', M.defaultYear(rates, 2031), 2026);
// bad input gives no answer rather than a wrong one
eq('zero time', at(0, 0), null); eq('negative seconds', Number.isNaN(M.seconds(3, -1)), true);
eq('fractional minutes', Number.isNaN(M.seconds(2.5, 0)), true); eq('no copies', at(3, 0, 0), null); eq('part copies', at(3, 0, 1.5), null);
eq('parse 3:30', M.parseTime('3:30'), 210); eq('parse 4', M.parseTime('4'), 240); eq('parse bad', Number.isNaN(M.parseTime('3:75')), true);
// formatting
eq('format 13', M.formatCents(1300), '13'); eq('format 0.5', M.formatCents(50), '0.5');
eq('dollars thousands', M.dollars(123456789), '$1,234,567.89'); eq('dollars small', M.dollars(7), '$0.07');
// the streaming illustration is looked up by year, never multiplied into anything
eq('streaming 2026', M.streamingPercent(rates, 2026).percent, 15.3); eq('streaming 2024 missing', M.streamingPercent(rates, 2024), null);

// The checklist: reader and territory filter; INTL rows show under every territory; empty is no filter.
const rows = [
  { id: 'clm-a', readers: ['writer', 'admin'], territory: ['US'] },
  { id: 'clm-b', readers: ['artist'], territory: ['UK'] },
  { id: 'clm-c', readers: ['writer', 'artist'], territory: ['INTL'] },
  { id: 'clm-d', readers: ['publisher-label'], territory: ['US', 'CA'] },
];
const ids = (r, t) => M.places(rows, r, t).map(x => x.id).join(' ');
eq('everyone everywhere', ids('', ''), 'clm-a clm-b clm-c clm-d');
eq('writer', ids('writer', ''), 'clm-a clm-c');
eq('writer in UK (INTL holds)', ids('writer', 'UK'), 'clm-c');
eq('artist in UK', ids('artist', 'UK'), 'clm-b clm-c');
eq('anyone in CA', ids('', 'CA'), 'clm-c clm-d');
eq('INTL only', ids('', 'INTL'), 'clm-c');
eq('producer', ids('producer', ''), '');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
