// Zero-dependency checks for public/music-tools.js: the mechanical rate calculator's maths (37 CFR 385.11,
// content/music/DATA-PAGES.md section 3), the unclaimed-money checklist's filter, the identifier checker
// (ISRC, ISNI, ISWC, IPI) and the split sheet's totals, against hand-worked values and real identifiers.
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

// ---------------- the identifier checker ----------------
const id = (t) => M.idCheck(t);
// ISRC: 12 characters, no check digit. Lower case is read as capitals; "ISRC", spaces and hyphens are not part of it.
// GB-1AB-06-12345 is made up here, in the right form; AA-6Q7-20-00047 is the ISRC Handbook's own made-up example.
let x = id('GB-1AB-06-12345'); eq('isrc hyphens', x.kind, 'isrc'); eq('isrc hyphens valid', x.valid, true); eq('isrc compact', x.compact, 'GB1AB0612345');
eq('isrc display', x.display, 'ISRC GB-1AB-06-12345'); eq('isrc has no check digit', x.check.exists, false);
x = id('isrc gb1ab0612345'); eq('isrc lower case + label', x.valid, true); eq('isrc lower case compact', x.compact, 'GB1AB0612345');
eq('isrc lower case noted', x.notes.some(n => /Lower-case/.test(n)), true);
x = id('ISRC AA-6Q7-20-00047'); eq('isrc handbook example valid form', x.valid, true); eq('isrc handbook example warned', /made-up example/.test(x.warn || ''), true);
eq('isrc never-allocated prefix warned', /never allocated/.test(id('US-S1Z-99-00001').warn || ''), true);
x = id('GB-1AB-06-1234'); eq('isrc 11 chars invalid', x.valid, false); eq('isrc 11 chars kind', x.kind, 'isrc'); eq('isrc 11 chars problem', x.problems.some(p => /11 characters; 12/.test(p)), true);
x = id('G1-1AB-06-12345'); eq('isrc digit in country part invalid', x.valid, false);
x = id('GB-1AB-0A-12345'); eq('isrc letter in year invalid', x.valid, false); eq('isrc year problem', x.problems.some(p => /year/.test(p)), true);
eq('isrc bad character invalid', id('GB-1AB-06-1234*').valid, false);
// ISNI: 15 digits and a MOD 11-2 check character. Real ISNIs from pages opened 2026-11-20:
// 0000 0001 2149 1740 and 0000 0003 6864 7620 (isni.org FAQs), 0000 0001 2139 4035 and 0000 0001 2407 618X (isni.org linked-data
// page; 618X is shown there as a deprecated ISNI), 0000 0001 2124 1960 (IANA's ISNI registration), and ISO 27729's own 1422 4586 3573 0476.
['0000 0001 2149 1740', '0000 0003 6864 7620', '0000000121394035', '000000012407618X', 'ISNI 0000 0001 2124 1960', 'urn:isni:0000000121241960', '1422 4586 3573 0476']
  .forEach(t => { const r = id(t); ok('isni valid: ' + t, r.kind === 'isni' && r.valid && r.check.ok === true, r.check && r.check.text); });
eq('isni X check char', M.isniCheckChar('000000012407618'), 'X'); eq('isni lower-case x accepted', id('000000012407618x').check.ok, true);
eq('isni ISO example check char', M.isniCheckChar('142245863573047'), '6');
x = id('0000 0001 2124 1961'); eq('isni wrong check char', x.check.ok, false); eq('isni expected', x.check.expected, '0');
x = id('0000 0001 2407 6180'); eq('isni X written as 0 is wrong', x.check.ok, false); eq('isni X expected', x.check.expected, 'X');
eq('isni display', id('000000012407618X').display, 'ISNI 0000 0001 2407 618X');
eq('isni lookup links the record', id('0000000121241960').lookup.url, 'https://isni.org/isni/0000000121241960');
x = id('0000 0001 2124 196'); eq('isni 15 chars invalid', x.valid, false); eq('isni 15 chars kind', x.kind, 'isni');
// ISWC: T, 9 digits, check digit; the formula from ISO/TC 46/SC 9 N 268 (1999). T-034.524.680-1 is ISO 15707's example.
x = id('T-034.524.680-1'); eq('iswc ISO example', x.kind, 'iswc'); eq('iswc ISO example check', x.check.ok, true); eq('iswc consistent wording', /consistent with the published formula/.test(x.check.text), true);
eq('iswc compact', x.compact, 'T0345246801'); eq('iswc display', x.display, 'ISWC T-034.524.680-1');
eq('iswc check digit 034524680', M.iswcCheckDigit('034524680'), 1);
eq('iswc no separators', id('T0345246801').check.ok, true); eq('iswc label and lower case', id('iswc t-034524680-1').check.ok, true);
x = id('T-034.524.680-2'); eq('iswc wrong check digit', x.check.ok, false); eq('iswc expected', x.check.expected, '1');
x = id('T-034.524.608-1'); eq('iswc transposed digits caught', x.check.ok, false);
// iswc.org's usage page shows "T-345246800-1" as a written example; the formula gives 3, so the checker flags it.
eq('iswc.org usage example does not fit the formula', id('T-345246800-1').check.ok, false);
x = id('T-034.524.68-1'); eq('iswc short invalid', x.valid, false); eq('iswc short problem', x.problems.some(p => /10 characters; 11/.test(p)), true);
eq('iswc check is 0 when the sum is a multiple of 10', M.iswcCheckDigit('000000001'), 0);
// IPI: form only, no check digit published.
x = id('00045620792'); eq('ipi name 11 digits', x.kind, 'ipi-name'); eq('ipi name valid', x.valid, true); eq('ipi no check', x.check.exists, false);
eq('ipi says no rule is published', /No check-digit rule/.test(x.check.text), true);
x = id('IPI 123456789'); eq('ipi 9 digits padded', x.compact, '00123456789'); eq('ipi 9 digits valid', x.valid, true);
x = id('I-001068130-6'); eq('ipi base', x.kind, 'ipi-base'); eq('ipi base valid', x.valid, true); eq('ipi base display', x.display, 'I-001068130-6');
eq('ipi base no check', x.check.exists, false);
x = id('I-00106813-6'); eq('ipi base short invalid', x.valid, false); eq('ipi base short kind', x.kind, 'ipi-base');
x = id('0004562079'); eq('ipi 10 digits invalid', x.valid, false); eq('ipi 10 digits kind', x.kind, 'ipi-name');
eq('ipi lookup says ask your PRO', /PRO or society/.test(id('00045620792').lookup.text), true);
// nothing recognisable
x = id('hello'); eq('unknown kind', x.kind, ''); eq('unknown invalid', x.valid, false); eq('empty input', id('   '), null);
eq('label for another kind is not trusted', id('ISRC 00045620792').valid, false);

// ---------------- the split sheet ----------------
const tot = (a) => M.splitTotal(a);
eq('split 100', tot(['50', '50']).status, 'ok'); eq('split 100 total', tot(['50', '50']).totalH, 10000);
eq('split 99.99 under', tot(['50', '49.99']).status, 'under'); eq('split 99.99 short by', M.pct(-tot(['50', '49.99']).diffH), '0.01');
eq('split 100.01 over', tot(['50', '50.01']).status, 'over'); eq('split 100.01 over by', M.pct(tot(['50', '50.01']).diffH), '0.01');
eq('split thirds 33.33 x3 is under', tot(['33.33', '33.33', '33.33']).status, 'under');
eq('split thirds 33.34/33.33/33.33 ok', tot(['33.34', '33.33', '33.33']).status, 'ok');
// no float drift: 0.1 + 0.2 style sums are worked in hundredths of a percent
eq('split no float drift', tot(['10.1', '20.2', '69.7']).status, 'ok');
eq('split 100.004 rounds to 100', tot(['100.004']).status, 'ok'); eq('split rounding flagged', tot(['100.004']).rounded.join(), '0');
eq('split 99.995 rounds to 100', tot(['50', '49.995']).status, 'ok');
eq('split 33.333 x3 rounds to 99.99, under', tot(['33.333', '33.333', '33.333']).status, 'under');
eq('split percent sign and comma', tot(['50%', '50,00']).status, 'ok');
eq('split bad share', tot(['50', 'abc']).status, 'invalid'); eq('split over 100 share bad', tot(['150']).status, 'invalid');
eq('split negative bad', tot(['-10', '110']).status, 'invalid');
eq('split empty', tot(['', '']).status, 'empty'); eq('split one empty noted', tot(['100', '']).empty.join(), '1');
eq('even split 3', JSON.stringify(M.evenSplit(3)), '[3334,3333,3333]'); eq('even split 7 sums to 100', M.evenSplit(7).reduce((a, b) => a + b, 0), 10000);
eq('even split 1', JSON.stringify(M.evenSplit(1)), '[10000]'); eq('pct format', M.pct(3333) + ' ' + M.pct(5000) + ' ' + M.pct(1250), '33.33 50 12.5');
eq('total line under', M.totalLine(tot(['50', '49.99'])), 'The shares add up to 99.99 percent: 0.01 short of 100.');
eq('total line over', M.totalLine(tot(['50', '50.01'])), 'The shares add up to 100.01 percent: 0.01 over 100.');
// Roles: the standard writer designations, keyed by their CWR codes, each with one line of help.
eq('roles', Object.keys(M.ROLES).join(), 'C,A,CA,AR,AD,TR');
eq('role labels', Object.values(M.ROLES).join('|'), 'Composer|Author (lyricist)|Composer and author|Arranger|Adaptor|Translator');
eq('every role has help', Object.keys(M.ROLES).every(k => typeof M.ROLE_HELP[k] === 'string' && M.ROLE_HELP[k].length > 20), true);
eq('no producer role', Object.values(M.ROLES).some(l => /producer/i.test(l)), false);
eq('publisher roles', Object.keys(M.PUB_ROLES).join() + ' ' + Object.values(M.PUB_ROLES).join('|'), 'E,AM Original publisher|Administrator');
eq('role label with producer tick', M.roleLabel({ role: 'CA', producer: true }), 'Composer and author; also credited as the producer');
eq('role label not a role', M.roleLabel({ role: 'constructor' }), '');
// No em dashes in any copy the tool writes.
eq('no em dashes in role copy', /—/.test(JSON.stringify([M.ROLES, M.ROLE_HELP, M.PUB_ROLES, M.PUB_ROLE_HELP, M.SAMPLE_LINE, M.NOT_CONTRACT, M.CONFIRM])), false);
// The page's "What the roles mean" list and the script say the same thing (both are written by hand).
const toolsPage = path.join(__dirname, '..', 'public', 'music', 'tools.html');
if (fs.existsSync(toolsPage)) {
  const html = fs.readFileSync(toolsPage, 'utf8'), e = (t) => t.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
  eq('page lists every role and its help', Object.keys(M.ROLES).every(k => html.includes('<dt>' + e(M.ROLES[k]) + '</dt><dd>' + e(M.ROLE_HELP[k]) + '</dd>')), true);
  eq('page lists every publisher role and its help', Object.keys(M.PUB_ROLES).every(k => html.includes('<dt>' + e(M.PUB_ROLES[k]) + '</dt><dd>' + e(M.PUB_ROLE_HELP[k]) + '</dd>')), true);
  eq('page has the sample clearance line', html.includes(e(M.SAMPLE_LINE)), true);
}

// Migration: a draft saved with the old roles.
const old = { title: 'Old Song', date: '2026-10-01', alt: 'Demo', artist: '',
  writers: [{ name: 'L', role: 'lyrics', pro: 'BMI', ipi: '', publisher: '', share: '25' }, { name: 'M', role: 'music', share: '25' },
            { name: 'B', role: 'both', share: '25' }, { name: 'P', role: 'producer', share: '25' }, { name: 'X', role: 'drums', share: '' }, null] };
const mig = M.splitMigrate(old);
eq('migrate roles', mig.writers.map(w => w.role).join(), 'A,C,CA,C,');
eq('migrate producer tick', mig.writers.map(w => w.producer).join(), 'false,false,false,true,false');
eq('migrate keeps fields', mig.title + '|' + mig.alt + '|' + mig.writers[0].pro + '|' + mig.writers[0].share, 'Old Song|Demo|BMI|25');
eq('migrate adds new fields empty', mig.iswc + mig.isrc + mig.samples + mig.writers[0].pubRole, '');
eq('migrate drops non-objects', mig.writers.length, 5); eq('migrate version', mig.v, 2);
eq('migrate is stable on a new draft', JSON.stringify(M.splitMigrate(mig)), JSON.stringify(mig));
eq('migrate keeps a new role and publisher role', M.splitMigrate({ writers: [{ role: 'TR', pubRole: 'AM' }] }).writers[0].role + M.splitMigrate({ writers: [{ role: 'TR', pubRole: 'AM' }] }).writers[0].pubRole, 'TRAM');
eq('migrate drops an unknown publisher role', M.splitMigrate({ writers: [{ pubRole: 'SE' }] }).writers[0].pubRole, '');
eq('migrate nothing', M.splitMigrate(null), null);
eq('migrated old draft totals 100', M.splitTotal(mig.writers.map(w => w.share)).status, 'ok');

// Identifiers on the sheet, through the identifier checker.
eq('sheet ipi ok', JSON.stringify(M.splitId('ipi', '00045620792', 'A')), JSON.stringify({ ok: true, shown: '00045620792' }));
eq('sheet ipi 9 digits padded', M.splitId('ipi', '123456789', 'A').shown, '00123456789');
eq('sheet ipi short', M.splitId('ipi', '12345', 'A').ok, false); eq('sheet ipi short says why', /A's IPI name number is not in the right form/.test(M.splitId('ipi', '12345', 'A').why), true);
eq('sheet ipi base number asks for the name number', /base number/.test(M.splitId('ipi', 'I-001068130-6', 'A').why), true);
eq('sheet ipi an ISWC is not an IPI', M.splitId('ipi', 'T-034.524.680-1', 'A').ok, false);
eq('sheet ipi empty', M.splitId('ipi', '  ', 'A'), null);
eq('sheet iswc ok', M.splitId('iswc', 'T0345246801').shown, 'T-034.524.680-1');
eq('sheet iswc bad check digit', /gives 1/.test(M.splitId('iswc', 'T-034.524.680-2').why), true);
eq('sheet iswc bad form', /not in the right form/.test(M.splitId('iswc', 'T-034.524.68-1').why), true);
eq('sheet isrc ok', M.splitId('isrc', 'gbaye0601498').shown, 'GB-AYE-06-01498');
eq('sheet isrc bad form', /12 characters/.test(M.splitId('isrc', 'GBAYE060149').why), true);
eq('sheet isrc example prefix flagged', M.splitId('isrc', 'US-S1Z-99-00001').ok, false);
eq('sheet isrc an ISWC is not an ISRC', M.splitId('isrc', 'T0345246801').ok, false);

const sheet = { title: 'Example Song', date: '2026-11-20', alt: 'Example (Demo)', artist: 'The Examples', iswc: 'T-034.524.680-2', isrc: 'GBAYE0601498',
  samples: 'yes', samplesNote: '',
  writers: [{ name: 'A Writer', role: 'A', pro: 'ASCAP', ipi: '00045620792', publisher: '', pubRole: '', share: '50' },
            { name: 'B Writer', role: 'C', producer: true, pro: 'PRS', ipi: '12345', publisher: 'B Music', pubRole: 'E', share: '49.99' },
            { name: 'C Writer', role: '', pro: '', ipi: '', publisher: '', pubRole: 'AM', share: '0' }] };
const issues = M.splitIssues(sheet);
eq('issues flag a bad IPI', issues.some(i => /B Writer's IPI/.test(i)), true); eq('issues flag the total', issues.some(i => /0.01 short/.test(i)), true);
eq('issues accept a good IPI', issues.some(i => /A Writer's IPI/.test(i)), false);
eq('issues flag the ISWC check digit', issues.some(i => /ISWC's check digit/.test(i)), true);
eq('issues accept a good ISRC', issues.some(i => /ISRC/.test(i)), false);
eq('issues flag a missing role', issues.some(i => /C Writer has no role/.test(i)), true);
eq('issues flag a publisher role with no publisher', issues.some(i => /C Writer has a publisher role but no publisher name/.test(i)), true);
eq('issues ask to name the samples', issues.some(i => /Name each sample/.test(i)), true);
eq('issues ask about samples when unanswered', M.splitIssues({ title: 'X', writers: [{ name: 'X', role: 'CA', share: '100' }] }).join('|'), 'Say whether the song uses samples or interpolations.');
eq('issues none when complete', M.splitIssues({ title: 'X', samples: 'no', writers: [{ name: 'X', role: 'CA', share: '100' }] }).length, 0);
eq('issues: no title', M.splitIssues({ title: '', writers: [{ name: 'X', share: '100' }] }).some(i => /title/.test(i)), true);
const txt = M.splitText(sheet);
eq('text has song', /Song: Example Song/.test(txt), true); eq('text has date', /Date agreed: 20 November 2026/.test(txt), true);
eq('text has alternate titles', /Also known as: Example \(Demo\)/.test(txt), true);
eq('text has ISWC, marked', /ISWC: T-034\.524\.680-2 \(check this\)/.test(txt), true);
eq('text has ISRC, printed form', /ISRC of the recording: GB-AYE-06-01498\n/.test(txt), true);
eq('text has samples and the clearance line', /Samples or interpolations: Yes, not yet listed\nSamples and interpolations need clearance/.test(txt), true);
eq('text has a writer line', txt.includes('1. A Writer: 50%.\n   Role: Author (lyricist).\n   PRO or society: ASCAP. IPI name number: 00045620792.\n   Publisher: none given.'), true);
eq('text spells out the producer note and publisher role', txt.includes('2. B Writer: 49.99%.\n   Role: Composer; also credited as the producer.\n   PRO or society: PRS. IPI name number: 12345 (check this).\n   Publisher: B Music (original publisher).'), true);
eq('text role not given', /Role: not given\./.test(txt), true);
eq('text flags the total', /Total: 99\.99% \(does not add up to 100%\)/.test(txt), true);
eq('text says not a contract', /not a publishing contract/.test(txt), true);
eq('text signature lines', (txt.match(/Signature: _+   Date: _+/g) || []).length, 3);
eq('text no em dashes', /—/.test(txt), false);
const txt2 = M.splitText({ title: 'Y', samples: 'no', writers: [{ name: 'Z', role: 'TR', share: '100' }] });
eq('text no samples', /Samples or interpolations: None\n/.test(txt2) && !/need clearance/.test(txt2), true);
eq('text total ok', /Total: 100%\n/.test(txt2), true); eq('text leaves out empty codes', /ISWC|ISRC/.test(txt2), false);
eq('date label', M.dateLabel('2026-02-03'), '3 February 2026'); eq('date label passthrough', M.dateLabel('soon'), 'soon');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
