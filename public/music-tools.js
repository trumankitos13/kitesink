/* ===================== KiteSink — music tools =====================
   The mechanical rate calculator, the unclaimed-money checklist, the identifier checker and the
   split-sheet generator. Loaded by the pages under /music/ that hold one of them (/music/tools,
   and the mechanicals, unclaimed, metadata and producer areas), after /music-ref.js. Plain JS, no
   dependencies, nothing leaves the browser.

   The maths lives in KSMusic (pure functions, exported on window so they can be checked from
   the console or from scripts/test_music.js); the bottom half wires them to the page.

   Both tools read data the build embeds in the page (scripts/build_music.py, from
   content/music/rates.json and content/music/claimable.json) in a
   <script type="application/json"> inside the tool. Without JavaScript the page shows the
   static version the build wrote: the table of yearly rates, and the full checklist. The identifier
   checker and the split-sheet generator need no data; without JavaScript the page shows what each
   identifier looks like, and what a split sheet holds.

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
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

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
    },

    /* ---------- the identifier checker ----------
       One input; it works out which of ISRC, ISWC, ISNI or IPI it is, checks the form, checks the
       check character where the standard has one, and gives the compact and the printed forms.
       Sources (opened 2026-11-20; cited on the page by scripts/build_music.py):
         ISRC  IFPI ISRC Handbook, 4th edition 2021, 3.3 and 5; ISRC Bulletin 2015/01. 12 characters:
               2 letters, 3 letters or digits, 2 digits (year assigned), 5 digits. No check digit.
               Lower case is read as upper case; "ISRC", spaces and hyphens are not part of the code.
         ISNI  ISO 27729:2024 (iTeh preview) 4 and Annex A; isni.org FAQs; IANA URN registration.
               15 digits and a check character 0-9 or X, by ISO/IEC 7064 MOD 11-2.
         ISWC  ISO 15707:2022 (iTeh preview) 4: "T", 9 digits, a check digit "calculated on a weighted
               modulus 10"; the formula itself is in Annex B, which the preview does not show. The
               formula used here is the one in ISO/TC 46/SC 9 N 268 (1999, the committee's response
               on the first edition's Annex B): 1 + the sum of digit x position (1 to 9), and the check
               digit brings that to a multiple of 10. So the page says "consistent with the published
               formula", not "valid".
         IPI   11-digit name number (SUISA, HFA); base number commonly written I-NNNNNNNNN-C. No
               check-digit rule is published for either: form only. */
    idClean: function (text) {
      return String(text == null ? "" : text).toUpperCase().replace(/[\s.\-‐-―−_\/]+/g, "");
    },
    // ISO/IEC 7064 MOD 11-2 over 15 digits: the same arithmetic as ISO 27729 Annex A's worked example.
    isniCheckChar: function (digits15) {
      var t = 0;
      for (var i = 0; i < digits15.length; i++) t = (t + (+digits15.charAt(i))) * 2;
      var r = (12 - t % 11) % 11;
      return r === 10 ? "X" : String(r);
    },
    // ISWC: sum = 1 + d1x1 + d2x2 + ... + d9x9; the check digit is what takes the sum to a multiple of 10.
    iswcCheckDigit: function (digits9) {
      var s = 1;
      for (var i = 0; i < 9; i++) s += (+digits9.charAt(i)) * (i + 1);
      return (10 - s % 10) % 10;
    },
    idCheck: function (text) {
      var raw = String(text == null ? "" : text).trim();
      if (!raw) return null;
      var c = M.idClean(raw), hint = "";
      var FORMS = { iswc: /^T\d{10}$/, "ipi-base": /^I\d{10}$/, isni: /^\d{15}[\dX]$/, isrc: /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/, "ipi-name": /^(\d{11}|\d{9})$/ };
      function kindOf(s) { for (var k in FORMS) if (FORMS[k].test(s)) return k; return ""; }
      // A label in front ("ISRC AA-6Q7-20-00047", "urn:isni:...", "IPI 00045620792") is not part of the code. With a space
      // or colon after it, it is always a label; run together with the code, only when the whole is not already a code.
      var LABEL = /^(URN:ISNI:|URNISNI|ISRC|ISWC|ISNI|IPI)/, spaced = /^\s*(urn:isni:|isrc|iswc|isni|ipi)\s*[\s:#]/i.test(raw);
      var kind = spaced ? "" : kindOf(c), lab = kind ? null : LABEL.exec(c);
      if (lab) {
        hint = { URNISNI: "isni", "URN:ISNI:": "isni" }[lab[1]] || lab[1].toLowerCase();
        c = c.slice(lab[1].length).replace(/^[:#]+/, "");
        if (hint === "ipi") hint = /^I/.test(c) ? "ipi-base" : "ipi-name";
        kind = kindOf(c);
        if (kind && kind.split("-")[0] !== hint.split("-")[0]) kind = "";   // "ISRC 00045620792" is not an ISRC
      }
      var r = { input: raw, kind: kind, compact: c, valid: !!kind, problems: [], notes: [], check: null, display: "", lookup: null };
      if (!kind) kind = r.kind = hint || M.idGuess(c);
      if (kind && /[a-z]/.test(raw.replace(/^\s*(urn:isni:|isrc|iswc|isni|ipi)/i, ""))) r.notes.push("Lower-case letters were read as capitals.");
      r.name = { isrc: "ISRC", iswc: "ISWC", isni: "ISNI", "ipi-name": "IPI name number", "ipi-base": "IPI base number" }[kind] || "";
      r.what = { isrc: "a sound recording or music video", iswc: "a musical work (the song, not a recording)", isni: "the public identity of a person or organisation",
                 "ipi-name": "a name of a writer or publisher in the societies' IPI system", "ipi-base": "a writer or publisher in the societies' IPI system, across all their names" }[kind] || "";
      if (!r.valid) r.problems = M.idProblems(kind, c);
      M.idDetails(r);
      return r;
    },
    // When nothing matches exactly: the kind it most looks like, for the explanation. "" when none.
    idGuess: function (c) {
      if (/^T\d/.test(c)) return "iswc";
      if (/^I\d/.test(c)) return "ipi-base";
      if (/^[A-Z]{2}/.test(c) && c.length >= 9 && c.length <= 14) return "isrc";
      if (/^\d+X?$/.test(c) && c.length >= 14) return "isni";
      if (/^\d+$/.test(c) && c.length >= 8 && c.length <= 12) return "ipi-name";
      return "";
    },
    idProblems: function (kind, c) {
      var p = [], bad = c.replace(/[A-Z0-9]/g, "");
      if (bad) p.push("It has characters no identifier here uses: " + bad.split("").filter(function (x, i, a) { return a.indexOf(x) === i; }).join(" ") + ".");
      function len(n) { if (c.length !== n) p.push("It has " + c.length + " characters; " + n + " are needed."); }
      if (kind === "isrc") {
        len(12);
        if (!/^[A-Z]{2}/.test(c)) p.push("Characters 1 and 2 must be letters.");
        if (c.length >= 5 && !/^[A-Z0-9]{3}$/.test(c.slice(2, 5))) p.push("Characters 3 to 5 must be letters or digits.");
        if (c.length >= 7 && !/^\d{2}$/.test(c.slice(5, 7))) p.push("Characters 6 and 7, the year the code was assigned, must be digits.");
        if (c.length > 7 && !/^\d+$/.test(c.slice(7))) p.push("The last five characters must be digits.");
      } else if (kind === "iswc") {
        len(11);
        if (c.charAt(0) !== "T") p.push("An ISWC starts with the letter T.");
        if (!/^\d*$/.test(c.slice(1))) p.push("After the T come only digits: nine for the work and one check digit.");
      } else if (kind === "isni") {
        len(16);
        if (!/^\d*$/.test(c.slice(0, 15))) p.push("The first 15 characters must be digits.");
        if (c.length === 16 && !/[\dX]/.test(c.charAt(15))) p.push("The last character must be a digit or X.");
      } else if (kind === "ipi-name") {
        if (c.length !== 11 && c.length !== 9) p.push("It has " + c.length + " digits; an IPI name number has 11 (older ones have 9).");
        if (!/^\d*$/.test(c)) p.push("An IPI name number is digits only.");
      } else if (kind === "ipi-base") {
        len(11);
        if (!/^I\d*$/.test(c)) p.push("An IPI base number is I followed by ten digits, written I-NNNNNNNNN-C.");
      } else {
        p.push("This is not in the form of an ISRC, ISWC, ISNI or IPI number. Check for a missing or extra character.");
      }
      return p;
    },
    // Fill in the check, the printed form, notes and where to look it up.
    idDetails: function (r) {
      var c = r.compact, k = r.kind, ok = r.valid;
      if (k === "isrc") {
        r.check = { exists: false, text: "ISRC has no check digit, so only the format can be checked. A code in the right format can still be mistyped or unassigned." };
        if (ok) {
          r.display = "ISRC " + c.slice(0, 2) + "-" + c.slice(2, 5) + "-" + c.slice(5, 7) + "-" + c.slice(7);
          r.notes.push("The two digits " + c.slice(5, 7) + " are the year the code was assigned, which is not always the year of the recording.");
          var pre = c.slice(0, 5);
          if (pre === "USS1Z" || pre === "JMK40") r.warn = "The prefix " + c.slice(0, 2) + "-" + c.slice(2, 5) + " is used only in examples and is never allocated, so this cannot be a real ISRC.";
          else if (c === "AA6Q72000047") r.warn = "This is the made-up example from the ISRC Handbook. It should never be used for a real recording.";
        }
        r.lookup = { label: "ISRC Search (IFPI)", url: "https://isrcsearch.ifpi.org/" };
      } else if (k === "isni") {
        if (ok) {
          var want = M.isniCheckChar(c.slice(0, 15));
          r.check = { exists: true, ok: want === c.charAt(15), expected: want,
                      text: want === c.charAt(15) ? "The check character " + want + " is right (ISO/IEC 7064 MOD 11-2)." + (want === "X" ? " X stands for 10." : "")
                        : "The check character should be " + want + ", not " + c.charAt(15) + ". A digit is probably mistyped." };
          r.display = "ISNI " + c.slice(0, 4) + " " + c.slice(4, 8) + " " + c.slice(8, 12) + " " + c.slice(12);
          r.lookup = { label: "This ISNI at isni.org", url: "https://isni.org/isni/" + c };
        } else {
          r.check = { exists: true, ok: null, text: "The check character can only be tested once the format is right." };
          r.lookup = { label: "ISNI search", url: "https://isni.org/page/search-database/" };
        }
      } else if (k === "iswc") {
        if (ok) {
          var d = M.iswcCheckDigit(c.slice(1, 10)), good = d === +c.charAt(10);
          r.check = { exists: true, ok: good, expected: String(d), consistent: true,
                      text: good ? "Check digit consistent with the published formula."
                        : "The check digit is not consistent with the published formula, which gives " + d + ". A digit is probably mistyped." };
          r.display = "ISWC T-" + c.slice(1, 4) + "." + c.slice(4, 7) + "." + c.slice(7, 10) + "-" + c.charAt(10);
        } else {
          r.check = { exists: true, ok: null, text: "The check digit can only be tested once the format is right." };
        }
        r.lookup = { label: "ISWC-Network (CISAC)", url: "https://iswcnet.cisac.org/" };
      } else if (k === "ipi-name" || k === "ipi-base") {
        r.check = { exists: false, text: "No check-digit rule for IPI numbers is published, so only the format is checked. A number in the right format may still be wrong." };
        if (ok && k === "ipi-name") {
          if (c.length === 9) { r.notes.push("Older IPI name numbers had nine digits; the 11-digit form adds two leading zeros."); c = r.compact = "00" + c; }
          r.display = c;
        }
        if (ok && k === "ipi-base") r.display = "I-" + c.slice(1, 10) + "-" + c.charAt(10);
        r.lookup = { label: "", url: "", text: "There is no IPI look-up here. Ask your PRO or society for the IPI numbers they hold for you." };
      }
      if (!ok) r.compact = "";
      return r;
    },

    /* ---------- the split-sheet generator ----------
       Shares are percentages of the song, entered to at most two decimal places and worked in
       hundredths of a percent, as whole numbers, so 33.33 + 33.33 + 33.34 is exactly 100. A share
       with more decimals is rounded to two (and the page says so), because the printed sheet must
       add up as printed. The total is right only at exactly 100.00. */
    shareH: function (v) {
      var s = String(v == null ? "" : v).trim().replace(/\s*%$/, "").replace(",", ".");
      if (s === "") return { h: NaN, empty: true };
      if (!/^\d+(\.\d*)?$|^\.\d+$/.test(s)) return { h: NaN, bad: true };
      var x = parseFloat(s), h = Math.round(x * 100);
      if (!isFinite(x) || h > 10000) return { h: NaN, bad: true };
      return { h: h, rounded: Math.abs(x * 100 - h) > 1e-6 };
    },
    splitTotal: function (shares) {
      var t = 0, bad = [], rounded = [], empty = [], any = false;
      (shares || []).forEach(function (v, i) {
        var s = M.shareH(v);
        if (s.empty) { empty.push(i); return; }
        if (s.bad) { bad.push(i); return; }
        any = true; t += s.h;
        if (s.rounded) rounded.push(i);
      });
      var status = bad.length ? "invalid" : !any ? "empty" : t === 10000 ? "ok" : t < 10000 ? "under" : "over";
      return { totalH: t, diffH: t - 10000, status: status, bad: bad, rounded: rounded, empty: empty };
    },
    // Shares that make exactly 100 for n writers: the odd hundredths go to the first rows. 3 -> [3334, 3333, 3333]
    evenSplit: function (n) {
      n = Math.floor(n);
      if (!(n >= 1)) return [];
      var base = Math.floor(10000 / n), rest = 10000 - base * n, out = [];
      for (var i = 0; i < n; i++) out.push(base + (i < rest ? 1 : 0));
      return out;
    },
    // 3333 -> "33.33", 5000 -> "50", 1250 -> "12.5"
    pct: function (h) { return (h / 100).toFixed(2).replace(/\.?0+$/, ""); },
    /* Writer roles: the designations societies use when a song is registered (the CISAC Common Works
       Registration user manual names composer, author, arranger, adaptor, translator, sub-arranger and
       sub-author; the combined composer-author is in the CWR lookup table). The keys are the CWR codes, so
       a sheet can be keyed in at a society or publisher without guessing. Sub-arranger and sub-author are
       left out: they are local versions a sub-publisher commissions for its territory, agreed in a
       publishing deal, not at a writing session. "Producer" is not a writer role; a producer who co-wrote
       picks the role for what they wrote and ticks "also credited as the producer". */
    ROLES: { C: "Composer", A: "Author (lyricist)", CA: "Composer and author", AR: "Arranger", AD: "Adaptor", TR: "Translator" },
    ROLE_HELP: {
      C: "Wrote music for the song, but none of the words.",
      A: "Wrote words for the song, but none of the music.",
      CA: "Wrote both music and words for the song.",
      AR: "Made a new arrangement of the music of a song that already existed.",
      AD: "Reworked the words of a song that already existed, other than by translating them.",
      TR: "Translated the words of a song that already existed into another language."
    },
    // The publisher's role for this writer's share of this song: the CWR codes E and AM.
    PUB_ROLES: { E: "Original publisher", AM: "Administrator" },
    PUB_ROLE_HELP: {
      E: "The publisher the writer signed their share of this song to. A writer who publishes themselves names their own company.",
      AM: "A company that registers the song and collects for the writer or their publisher under an admin deal, usually without owning it."
    },
    // Role values a draft saved before November 2026 used, and what each becomes.
    OLD_ROLES: { lyrics: "A", music: "C", both: "CA", producer: "C" },
    // A saved draft, of any version, as the current shape. Old roles are mapped; "Producer, as a writer"
    // becomes Composer with the producer tick. Unknown values are dropped, never guessed.
    splitMigrate: function (s) {
      if (!s || typeof s !== "object") return null;
      function str(x) { return x == null ? "" : String(x); }
      return {
        v: 2, title: str(s.title), alt: str(s.alt), date: str(s.date), artist: str(s.artist), iswc: str(s.iswc), isrc: str(s.isrc),
        samples: s.samples === "yes" || s.samples === "no" ? s.samples : "", samplesNote: str(s.samplesNote),
        writers: (Array.isArray(s.writers) ? s.writers : []).filter(function (w) { return w && typeof w === "object"; }).map(function (w) {
          var role = own(M.ROLES, w.role) ? w.role : own(M.OLD_ROLES, w.role) ? M.OLD_ROLES[w.role] : "";
          return { name: str(w.name), role: role, producer: w.producer === true || w.role === "producer", pro: str(w.pro), ipi: str(w.ipi),
                   publisher: str(w.publisher), pubRole: own(M.PUB_ROLES, w.pubRole) ? w.pubRole : "", share: str(w.share) };
        })
      };
    },
    // "Composer", "Composer; also credited as the producer", "" when no role is chosen.
    roleLabel: function (w) {
      var r = w && own(M.ROLES, w.role) ? M.ROLES[w.role] : "";
      return w && w.producer ? (r ? r + "; also credited as the producer" : "Also credited as the producer") : r;
    },
    // One identifier on the sheet, checked with the identifier checker above. kind: "ipi" (name number),
    // "iswc" or "isrc". null when empty; else { ok, shown (the form to print), why (a sentence, when not ok) }.
    splitId: function (kind, text, who) {
      var raw = String(text == null ? "" : text).trim();
      if (!raw) return null;
      var r = M.idCheck(raw), good = r && r.valid && r.kind === (kind === "ipi" ? "ipi-name" : kind);
      if (kind === "ipi") {
        if (good) return { ok: true, shown: r.display };
        if (r && r.valid && r.kind === "ipi-base") return { ok: false, shown: raw, why: who + "'s IPI number is a base number (I-NNNNNNNNN-C). The sheet asks for the IPI name number, 11 digits, which your PRO or society can give you." };
        return { ok: false, shown: raw, why: who + "'s IPI name number is not in the right form: 11 digits." };
      }
      if (kind === "iswc") {
        if (!good) return { ok: false, shown: raw, why: "The ISWC is not in the right form: T, then nine digits and a check digit." };
        if (!r.check.ok) return { ok: false, shown: raw, why: "The ISWC's check digit does not fit the published formula, which gives " + r.check.expected + ". A digit is probably mistyped." };
        return { ok: true, shown: r.display.replace(/^ISWC /, "") };
      }
      if (!good) return { ok: false, shown: raw, why: "The ISRC is not in the right form: 12 characters, written CC-XXX-YY-NNNNN." };
      if (r.warn) return { ok: false, shown: raw, why: "The ISRC: " + r.warn };
      return { ok: true, shown: r.display.replace(/^ISRC /, "") };
    },
    // What still needs doing before the sheet is ready to sign. The sheet still shows; this is advice.
    splitIssues: function (sheet) {
      var out = [], ws = (sheet && sheet.writers) || [];
      function has(x) { return !!String(x == null ? "" : x).trim(); }
      if (!has(sheet && sheet.title)) out.push("Add the song title.");
      [["iswc", sheet && sheet.iswc], ["isrc", sheet && sheet.isrc]].forEach(function (p) { var c = M.splitId(p[0], p[1]); if (c && !c.ok) out.push(c.why); });
      if (sheet && sheet.samples === "yes" && !has(sheet.samplesNote)) out.push("Name each sample or interpolation, and whose work it uses.");
      else if (!(sheet && (sheet.samples === "yes" || sheet.samples === "no"))) out.push("Say whether the song uses samples or interpolations.");
      if (!ws.length) out.push("Add at least one writer.");
      ws.forEach(function (w, i) {
        var who = has(w.name) ? String(w.name).trim() : "Writer " + (i + 1);
        if (!has(w.name)) out.push("Writer " + (i + 1) + " has no name.");
        if (!own(M.ROLES, w.role)) out.push(who + " has no role.");
        var c = M.splitId("ipi", w.ipi, who);
        if (c && !c.ok) out.push(c.why);
        if (w.pubRole && !has(w.publisher)) out.push(who + " has a publisher role but no publisher name.");
      });
      var t = M.splitTotal(ws.map(function (w) { return w.share; }));
      t.bad.forEach(function (i) { out.push("Writer " + (i + 1) + "'s share is not a percentage from 0 to 100."); });
      t.empty.forEach(function (i) { out.push("Writer " + (i + 1) + " has no share."); });
      t.rounded.forEach(function (i) { out.push("Writer " + (i + 1) + "'s share was rounded to " + M.pct(M.shareH(ws[i].share).h) + " percent (two decimal places)."); });
      if (t.status === "under" || t.status === "over") out.push(M.totalLine(t));
      return out;
    },
    totalLine: function (t) {
      if (t.status === "ok") return "The shares add up to 100 percent.";
      if (t.status === "under") return "The shares add up to " + M.pct(t.totalH) + " percent: " + M.pct(-t.diffH) + " short of 100.";
      if (t.status === "over") return "The shares add up to " + M.pct(t.totalH) + " percent: " + M.pct(t.diffH) + " over 100.";
      if (t.status === "invalid") return "A share is not a percentage from 0 to 100.";
      return "Enter each writer's share.";
    },
    SAMPLE_LINE: "Samples and interpolations need clearance from the owners of the work they use. This sheet does not clear them.",
    NOT_CONTRACT: "A split sheet records what the writers agreed. It is not a publishing contract.",
    CONFIRM: "By signing, each writer confirms that the details and shares above are what the writers agreed.",
    // The sheet as plain text, for "Copy as text".
    splitText: function (sheet) {
      var ws = sheet.writers || [], t = M.splitTotal(ws.map(function (w) { return w.share; })), L = [];
      function v(x, none) { x = String(x == null ? "" : x).trim(); return x || none; }
      function id(kind, x, who) { var c = M.splitId(kind, x, who); return c ? c.shown + (c.ok ? "" : " (check this)") : ""; }
      L.push("SPLIT SHEET", "");
      L.push("Song: " + v(sheet.title, "(no title)"));
      if (v(sheet.alt, "")) L.push("Also known as: " + v(sheet.alt, ""));
      if (v(sheet.artist, "")) L.push("Recording artist: " + v(sheet.artist, ""));
      if (id("iswc", sheet.iswc)) L.push("ISWC: " + id("iswc", sheet.iswc));
      if (id("isrc", sheet.isrc)) L.push("ISRC of the recording: " + id("isrc", sheet.isrc));
      L.push("Date agreed: " + v(M.dateLabel(sheet.date), "____________"));
      L.push("Samples or interpolations: " + (sheet.samples === "yes" ? "Yes" + (v(sheet.samplesNote, "") ? ". " + v(sheet.samplesNote, "") : ", not yet listed") : sheet.samples === "no" ? "None" : "Not stated"));
      if (sheet.samples === "yes") L.push(M.SAMPLE_LINE);
      L.push("", "Writers and shares:");
      ws.forEach(function (w, i) {
        var s = M.shareH(w.share), who = v(w.name, "Writer " + (i + 1));
        L.push((i + 1) + ". " + v(w.name, "(no name)") + ": " + (isNaN(s.h) ? "share not given" : M.pct(s.h) + "%") + ".");
        L.push("   Role: " + v(M.roleLabel(w), "not given") + ".");
        L.push("   PRO or society: " + v(w.pro, "not given") + ". IPI name number: " + v(id("ipi", w.ipi, who), "not given") + ".");
        L.push("   Publisher: " + (v(w.publisher, "") ? v(w.publisher, "") + (own(M.PUB_ROLES, w.pubRole) ? " (" + M.PUB_ROLES[w.pubRole].toLowerCase() + ")" : "") : "none given") + ".");
      });
      L.push("Total: " + M.pct(t.totalH) + "%" + (t.status === "ok" ? "" : " (does not add up to 100%)"), "");
      L.push(M.CONFIRM, "");
      ws.forEach(function (w, i) { L.push(v(w.name, "Writer " + (i + 1)) + "   Signature: ____________________   Date: ____________"); });
      L.push("", M.NOT_CONTRACT);
      return L.join("\n");
    },
    // "2026-11-20" -> "20 November 2026"; anything else is returned as typed.
    dateLabel: function (iso) {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
      var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      return m && +m[2] >= 1 && +m[2] <= 12 ? +m[3] + " " + months[+m[2] - 1] + " " + m[1] : String(iso || "");
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
  /* ---------- the identifier checker ---------- */
  all("[data-id-check]").forEach(function (box) {
    boot(function () {
      var form = box.querySelector(".idc-form"), q = box.querySelector(".idc-q"), out = box.querySelector(".idc-out"), fmts = box.querySelector(".idc-formats");
      if (!form || !q || !out) return;
      function badge(cls, text) { return '<span class="idc-badge idc-badge--' + cls + '">' + esc(text) + "</span> "; }
      function row(label, html) { return "<div><dt>" + esc(label) + "</dt><dd>" + html + "</dd></div>"; }
      function render() {
        var r = M.idCheck(q.value);
        if (!r) { out.hidden = true; out.innerHTML = ""; return; }
        var html = "";
        if (!r.kind) {
          html = '<p class="idc-verdict"><b>Not recognised.</b> ' + esc(r.problems.join(" ")) + "</p>"
            + '<p class="idc-hint">The four forms are below: ISRC, ISWC, ISNI and IPI.</p>';
        } else {
          var facts = row("Format", (r.valid ? badge("ok", "Valid") + "In the right form for an " + esc(r.name) + "."
              : badge("bad", "Not valid") + '<ul class="idc-list">' + r.problems.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>"));
          var ck = r.check;
          facts += row("Check digit", ck.exists === false ? badge("info", "None") + esc(ck.text)
              : ck.ok === true ? badge("ok", ck.consistent ? "Consistent" : "Valid") + esc(ck.text)
              : ck.ok === false ? badge("bad", ck.consistent ? "Not consistent" : "Wrong") + esc(ck.text)
              : badge("info", "Not tested") + esc(ck.text));
          if (r.valid) facts += row("Normalised", '<code class="idc-code">' + esc(r.compact) + "</code> as stored"
              + (r.display && r.display !== r.compact ? '; <code class="idc-code">' + esc(r.display) + "</code> as written for people" : ""));
          var lk = r.lookup;
          if (lk) facts += row("Look it up", lk.url ? '<a class="k-inline" href="' + esc(lk.url) + '" target="_blank" rel="noopener">' + esc(lk.label) + '<span class="k-vh"> (opens in a new tab)</span></a>' : esc(lk.text));
          html = '<p class="idc-verdict"><b>' + (r.valid ? "" : "Looks like an ") + esc(r.name) + "</b>" + (r.valid ? ", which identifies " : ". An " + esc(r.name) + " identifies ") + esc(r.what) + ".</p>"
            + (r.warn ? '<p class="idc-warn">' + esc(r.warn) + "</p>" : "")
            + '<dl class="idc-facts">' + facts + "</dl>"
            + (r.notes.length ? '<ul class="idc-notes">' + r.notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>" : "");
        }
        var state = !r.kind || !r.valid || (r.check && r.check.ok === false) || r.warn ? "bad" : "ok";
        out.innerHTML = '<div class="idc-res idc-res--' + state + '">' + html + "</div>";
        out.hidden = false;
      }
      q.addEventListener("input", render);
      form.addEventListener("submit", function (e) { e.preventDefault(); render(); });
      all("[data-try]", box).forEach(function (b) { b.addEventListener("click", function () { q.value = b.getAttribute("data-try"); render(); q.focus(); }); });
      form.hidden = false;
      box.classList.add("is-live");
      if (fmts && fmts.tagName === "DETAILS") fmts.open = false;
      render();
    });
  });

  /* ---------- the split-sheet generator ---------- */
  all("[data-split-sheet]").forEach(function (box) {
    boot(function () {
      var form = box.querySelector(".ss-form"), list = box.querySelector(".ss-rows"), sheetEl = box.querySelector(".ss-sheet"),
          outWrap = box.querySelector(".ss-out"), totalEl = box.querySelector(".ss-total"), issuesEl = box.querySelector(".ss-issues"),
          statusEl = box.querySelector(".ss-status"), off = box.querySelector(".ss-off");
      if (!form || !list || !sheetEl) return;
      var SONG = ["title", "date", "alt", "artist", "iswc", "isrc", "samplesNote"], song = {};
      SONG.forEach(function (k) { song[k] = form.querySelector('[name="' + k + '"]'); });
      var samples = all('[name="samples"]', form), sampleNote = box.querySelector(".ss-f--samplesNote");
      var uid = 0;
      function today() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
      function blank() { return { name: "", role: "", producer: false, pro: "", ipi: "", publisher: "", pubRole: "", share: "" }; }
      function options(map, chosen) {
        return '<option value="">Choose</option>' + Object.keys(map).map(function (k) {
          return '<option value="' + k + '"' + (chosen === k ? " selected" : "") + ">" + esc(map[k]) + "</option>"; }).join("");
      }

      function rowHtml(w, i) {
        var id = "ssw" + (++uid);
        function field(name, label, extra, help) {
          return '<div class="k-field ss-f ss-f--' + name + '"><label class="k-label" for="' + id + name + '">' + label + "</label>" + extra
            + (help != null ? '<p class="ss-fhelp" id="' + id + name + 'h">' + esc(help) + "</p>" : "") + "</div>";
        }
        function text(name, label, ph, attrs) {
          return field(name, label, '<input class="k-input" id="' + id + name + '" name="' + name + '" type="text" autocomplete="off" value="' + esc(w[name] || "") + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : "") + (attrs || "") + ">");
        }
        return '<li class="ss-row"><fieldset class="ss-fs"><legend class="ss-legend">Writer ' + (i + 1) + "</legend>"
          + '<div class="ss-grid">'
          + text("name", "Legal name", "As the writer's PRO or society has it")
          + field("role", "Role", '<select class="k-select" id="' + id + 'role" name="role" aria-describedby="' + id + 'roleh">' + options(M.ROLES, w.role) + "</select>", (own(M.ROLE_HELP, w.role) ? M.ROLE_HELP[w.role] : "Pick the role for what this writer wrote."))
          + field("share", "Share of the song", '<span class="ss-unit"><input class="k-input" id="' + id + 'share" name="share" type="text" inputmode="decimal" autocomplete="off" value="' + esc(w.share || "") + '" placeholder="0"><span aria-hidden="true">%</span></span>')
          + text("pro", "PRO or society", "e.g. ASCAP, BMI, PRS, SOCAN")
          + text("ipi", "IPI name number <i>optional</i>", "11 digits", ' inputmode="numeric" spellcheck="false"')
          + '<div class="ss-f ss-f--producer"><label class="ss-tick" for="' + id + 'producer"><input type="checkbox" id="' + id + 'producer" name="producer"' + (w.producer ? " checked" : "") + ' aria-describedby="' + id + 'producerh">'
          + "<span>Also credited as the producer</span></label>"
          + '<p class="ss-fhelp" id="' + id + 'producerh">Producer is not a writer role. Tick this as a note, and pick the role for what they wrote.</p></div>'
          + text("publisher", "Publisher <i>optional</i>", "Leave blank if none")
          + field("pubRole", "Publisher's role <i>optional</i>", '<select class="k-select" id="' + id + 'pubRole" name="pubRole" aria-describedby="' + id + 'pubRoleh">' + options(M.PUB_ROLES, w.pubRole) + "</select>", (own(M.PUB_ROLE_HELP, w.pubRole) ? M.PUB_ROLE_HELP[w.pubRole] : ""))
          + "</div>"
          + '<button type="button" class="k-linkbtn ss-remove" data-ss="remove">Remove writer ' + (i + 1) + "</button></fieldset></li>";
      }
      function drawRows(writers) {
        list.innerHTML = writers.map(rowHtml).join("");
        all(".ss-remove", list).forEach(function (b) { b.hidden = writers.length < 2; });
      }
      function sampleValue() { var c = samples.filter(function (r) { return r.checked; })[0]; return c ? c.value : ""; }
      function read() {
        var s = { v: 2, samples: sampleValue() };
        SONG.forEach(function (k) { s[k] = song[k] ? song[k].value : ""; });
        s.writers = all(".ss-row", list).map(function (li) {
          var w = {};
          ["name", "role", "pro", "ipi", "publisher", "pubRole", "share"].forEach(function (k) { var el = li.querySelector('[name="' + k + '"]'); w[k] = el ? el.value : ""; });
          var p = li.querySelector('[name="producer"]'); w.producer = !!(p && p.checked);
          return w;
        });
        return s;
      }
      function v(x) { return String(x == null ? "" : x).trim(); }
      function none(text) { return '<span class="ss-none">' + esc(text) + "</span>"; }
      // An identifier on the sheet: the printed form when it checks out; as typed, marked, when it does not.
      function idCell(c) { return c ? (c.ok ? esc(c.shown) : esc(c.shown) + ' <span class="ss-flag">check this</span>') : ""; }
      function sheetHtml(s) {
        var t = M.splitTotal(s.writers.map(function (w) { return w.share; }));
        var meta = [], iswc = M.splitId("iswc", s.iswc), isrc = M.splitId("isrc", s.isrc);
        if (v(s.alt)) meta.push("<span><b>Also known as</b> " + esc(v(s.alt)) + "</span>");
        if (v(s.artist)) meta.push("<span><b>Recording artist</b> " + esc(v(s.artist)) + "</span>");
        meta.push("<span><b>Date agreed</b> " + (v(s.date) ? esc(M.dateLabel(v(s.date))) : "____________") + "</span>");
        if (iswc) meta.push("<span><b>ISWC</b> " + idCell(iswc) + "</span>");
        if (isrc) meta.push("<span><b>ISRC of the recording</b> " + idCell(isrc) + "</span>");
        var smp = s.samples === "yes" ? "Yes" + (v(s.samplesNote) ? ": " + esc(v(s.samplesNote)) : ", " + none("not yet listed"))
          : s.samples === "no" ? "None" : none("Not stated");
        var rows = s.writers.map(function (w, i) {
          var sh = M.shareH(w.share), who = v(w.name) || "Writer " + (i + 1);
          function cell(label, html, cls) { return '<td data-l="' + label + '"' + (cls ? ' class="' + cls + '"' : "") + ">" + (html || none("Not given")) + "</td>"; }
          var role = own(M.ROLES, w.role) ? esc(M.ROLES[w.role]) : "";
          if (w.producer) role = (role || none("Not given")) + '<span class="ss-sub">Also credited as the producer</span>';
          var pub = v(w.publisher) ? esc(v(w.publisher)) + (own(M.PUB_ROLES, w.pubRole) ? '<span class="ss-sub">' + esc(M.PUB_ROLES[w.pubRole]) + "</span>" : "") : "";
          return "<tr>" + '<th scope="row" data-l="Writer">' + (v(w.name) ? esc(v(w.name)) : none("Writer " + (i + 1))) + "</th>"
            + cell("Role", role) + cell("PRO or society", esc(v(w.pro))) + cell("IPI name number", idCell(M.splitId("ipi", w.ipi, who)), "ss-id")
            + cell("Publisher", pub || none("None given")) + cell("Share", isNaN(sh.h) ? "" : M.pct(sh.h) + "%", "ss-num") + "</tr>";
        }).join("");
        var signs = s.writers.map(function (w, i) {
          return '<div class="ss-sign"><p class="ss-sign-n">' + (v(w.name) ? esc(v(w.name)) : "Writer " + (i + 1)) + "</p>"
            + '<p class="ss-line"><span>Signature</span></p><p class="ss-line ss-line--date"><span>Date</span></p></div>';
        }).join("");
        return '<header class="ss-sh"><p class="ss-kicker">Split sheet</p><h3 class="ss-song">' + (v(s.title) ? esc(v(s.title)) : none("Song title")) + "</h3>"
          + '<p class="ss-meta">' + meta.join("") + "</p>"
          + '<p class="ss-meta ss-meta--samples"><span><b>Samples or interpolations</b> ' + smp + "</span></p></header>"
          + (s.samples === "yes" ? '<p class="ss-sampleline">' + esc(M.SAMPLE_LINE) + "</p>" : "")
          + '<table class="ss-table"><caption class="k-vh">Writers, their roles and their shares</caption><thead><tr><th scope="col">Writer</th><th scope="col">Role</th><th scope="col">PRO or society</th>'
          + '<th scope="col">IPI name number</th><th scope="col">Publisher</th><th scope="col" class="ss-num">Share</th></tr></thead><tbody>' + rows + "</tbody>"
          + '<tfoot><tr><th scope="row" colspan="5">Total</th><td class="ss-num" data-l="Total">' + M.pct(t.totalH) + "%</td></tr></tfoot></table>"
          + (t.status === "ok" ? "" : '<p class="ss-warn">' + esc(M.totalLine(t)) + " Fix the shares before anyone signs.</p>")
          + '<p class="ss-confirm">' + esc(M.CONFIRM) + "</p>"
          + '<div class="ss-signs' + (s.writers.length > 4 ? " ss-signs--many" : "") + '">' + signs + "</div>"
          + '<p class="ss-foot">' + esc(M.NOT_CONTRACT) + " Made with the split-sheet generator at kitesink.com/music/tools.</p>";
      }
      // The parts of the form that follow what is typed: each row's role and publisher help, the sample note, bad identifiers.
      function liveForm(s) {
        all(".ss-row", list).forEach(function (li, i) {
          var w = s.writers[i] || {}, rh = li.querySelector(".ss-f--role .ss-fhelp"), ph = li.querySelector(".ss-f--pubRole .ss-fhelp");
          if (rh) rh.textContent = (own(M.ROLE_HELP, w.role) ? M.ROLE_HELP[w.role] : "Pick the role for what this writer wrote.");
          if (ph) { ph.textContent = (own(M.PUB_ROLE_HELP, w.pubRole) ? M.PUB_ROLE_HELP[w.pubRole] : ""); ph.hidden = !ph.textContent; }
          var ipi = li.querySelector('[name="ipi"]'), c = M.splitId("ipi", w.ipi, "");
          if (ipi) { if (c && !c.ok) ipi.setAttribute("aria-invalid", "true"); else ipi.removeAttribute("aria-invalid"); }
        });
        ["iswc", "isrc"].forEach(function (k) {
          var c = M.splitId(k, s[k]);
          if (song[k]) { if (c && !c.ok) song[k].setAttribute("aria-invalid", "true"); else song[k].removeAttribute("aria-invalid"); }
        });
        if (sampleNote) sampleNote.hidden = s.samples !== "yes";
      }
      function update() {
        var s = read(), t = M.splitTotal(s.writers.map(function (w) { return w.share; }));
        store.set({ ss: s });
        totalEl.textContent = "Total " + M.pct(t.totalH) + "%. " + M.totalLine(t);
        totalEl.className = "ss-total ss-total--" + (t.status === "ok" ? "ok" : t.status === "empty" ? "empty" : "bad");
        var issues = M.splitIssues(s);
        issuesEl.innerHTML = issues.length ? "<li>" + issues.map(esc).join("</li><li>") + "</li>" : "";
        issuesEl.hidden = !issues.length;
        liveForm(s);
        sheetEl.innerHTML = sheetHtml(s);
        return s;
      }
      function load(s) {
        s = M.splitMigrate(s) || M.splitMigrate({ date: today() });
        SONG.forEach(function (k) { if (song[k]) song[k].value = s[k] || ""; });
        samples.forEach(function (r) { r.checked = r.value === s.samples; });
        drawRows(s.writers.length ? s.writers : [blank(), blank()]);
        update();
      }
      function say(text) { if (statusEl) { statusEl.textContent = text; clearTimeout(say.t); say.t = setTimeout(function () { statusEl.textContent = ""; }, 4000); } }

      form.addEventListener("input", update);
      form.addEventListener("change", update);
      form.addEventListener("submit", function (e) { e.preventDefault(); update(); });
      form.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("[data-ss]") : null;
        if (!b) return;
        var s = read(), act = b.getAttribute("data-ss");
        if (act === "add") {
          s.writers.push(blank()); drawRows(s.writers); update();
          var rows = all(".ss-row", list), last = rows[rows.length - 1];
          if (last) last.querySelector("input").focus();
        } else if (act === "remove") {
          var li = b.closest(".ss-row"), at = all(".ss-row", list).indexOf(li);
          if (at >= 0 && s.writers.length > 1) { s.writers.splice(at, 1); drawRows(s.writers); update(); say("Writer removed."); }
        } else if (act === "even") {
          var even = M.evenSplit(s.writers.length);
          s.writers.forEach(function (w, i) { w.share = M.pct(even[i]); });
          drawRows(s.writers); update(); say("Shares split evenly.");
        } else if (act === "copy") {
          var text = M.splitText(update());
          var done = function () { say("Copied as text."); };
          var fallback = function () {
            var ta = document.createElement("textarea");
            ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
            document.body.appendChild(ta); ta.select();
            var ok = false; try { ok = document.execCommand("copy"); } catch (err) {}
            document.body.removeChild(ta);
            say(ok ? "Copied as text." : "Copying is blocked in this browser. Use Print, or select the preview and copy it.");
          };
          try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback(); } catch (err) { fallback(); }
        } else if (act === "print") {
          update();
          var host = box.closest("section") || box, root = document.documentElement;
          root.classList.add("ss-print"); host.classList.add("ss-print-host");
          var undo = function () { root.classList.remove("ss-print"); host.classList.remove("ss-print-host"); window.removeEventListener("afterprint", undo); };
          window.addEventListener("afterprint", undo);
          window.print();
        } else if (act === "clear") {
          if (window.confirm && !window.confirm("Clear the song and every writer from this form?")) return;
          load({ date: today(), writers: [] }); say("Form cleared.");
        }
      });

      // A draft saved by an earlier version of this page is read through splitMigrate (old roles mapped).
      var saved = store.get().ss;
      load(saved && typeof saved === "object" && Array.isArray(saved.writers) ? saved : { date: today(), writers: [] });
      form.hidden = false;
      if (outWrap) outWrap.hidden = false;
      if (off) off.hidden = true;
      box.classList.add("is-live");
    });
  });
})();
