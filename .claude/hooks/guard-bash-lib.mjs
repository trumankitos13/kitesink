// The Bash guard behind .claude/hooks/guard-bash.mjs (AST-46, ported from Keyring's KEY-82 guard). It
// runs for every agent in this repo, and refuses the Bash forms of what no agent here does:
//   - deploying: wrangler deploy, publish, versions deploy/upload, pages deploy, rollback, secrets and
//     any other wrangler command not on its short read/local list (dev, types, whoami, tail, listings);
//     npm/pnpm/yarn/bun publish; writes to api.cloudflare.com by curl or wget;
//   - pushing: every git push (and send-pack, http-push, subtree/lfs push, svn dcommit), gh repo sync,
//     gh repo create --push, gh release changes; writes to the GitHub API by gh api, curl or wget;
//   - merging: gh pr merge, gh pr update-branch.
// verdict(command, cwd) returns null to let the line run, or the reason it refuses.
//
// It is a deny-list for those commands and fails closed around them: a line it can't lex, a command
// named at run time, a git or gh alias it can't resolve, a shell reading a script from stdin, or a
// script file that doesn't exist yet is refused. The line is read the way bash reads it (quotes,
// escapes, $'…', brace expansion, substitutions, heredocs), every wrapper it knows (env, command,
// exec, nohup, nice, timeout, sudo, xargs, find -exec, watch, script -c, bash/sh -c, eval, trap,
// source, npx and the package managers' exec/dlx/run) is unwrapped, and any other command that has
// git, gh, wrangler or a runner as a later word is checked from that word on (stdbuf, caffeinate,
// a shell function used as a wrapper). Package scripts (npm run X, pnpm X, and the install
// lifecycle scripts) are read from package.json and checked as lines; shell scripts run by path
// or by bash/sh/source are read and checked.
//
// It is a filter, not a sandbox. Known gaps that need deliberate evasion: a program in another
// language (python3 x.py, node x.js, a Makefile) that runs git push itself (inline -c/-e code is
// scanned, script files are not); a git hook the agent writes; a glob that matches a file the
// agent made; ssh to another host. That is why settings.json also denies the plain forms,
// AGENTS.md states the rule, and branch protection on main still matters. The hook fails open only
// if it runs past its 30 s timeout (a Claude Code limit).
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix } from 'node:path';

class Refuse extends Error {}
const refuse = (why) => { throw new Refuse(why); };
const OPAQUE = '\0'; // text the shell fills in at run time: $VAR, ${...}, $(...), `...`, an unquoted glob
const SPLIT = '\x01'; // follows OPAQUE when the expansion was unquoted: the shell may split it into more words
const opaque = (w) => w.includes(OPAQUE);
const shown = (w) => String(w).replace(/\0\x01?/g, '$…');

// ---------- lexing (Keyring's guard lexer, staging parts dropped) ----------

function subEnd(src, start) { return lex(src, [], start, true).end; }

// $(...), $((...)), `...`, ${...}, $NAME at src[i]: nested commands go on `lines`; returns the end
// index, or -1 when the $ is just a character.
// Index of the ) that closes a ( whose contents start at `start` (quotes skipped), or -1.
function closeParen(src, start) {
  let depth = 1;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (c === "'") { const e = src.indexOf("'", j + 1); if (e < 0) return -1; j = e; continue; }
    if (c === '"') { for (j++; j < src.length && src[j] !== '"'; j++) if (src[j] === '\\') j++; continue; }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return j;
  }
  return -1;
}

// (( ... )) starting at src[i] (i at the first '('): the index just past it, or -1 when it isn't arithmetic.
function arithmeticEnd(src, i) {
  const end = closeParen(src, i + 1);
  if (end < 0 || closeParen(src, i + 2) !== end - 1) return -1;
  return end + 1;
}

function expansion(src, i, lines, inDq = false) {
  if (src.startsWith('$((', i)) {
    const end = arithmeticEnd(src, i + 1);
    if (end > 0) { scanExpansions(src.slice(i + 3, end - 2), lines); return end; }
  }
  if (src.startsWith('$(', i)) { const end = subEnd(src, i + 2); lines.push(src.slice(i + 2, end - 1)); return end; }
  if (src[i] === '`') {
    let j = i + 1;
    for (; j < src.length && src[j] !== '`'; j++) if (src[j] === '\\') j++;
    if (j >= src.length) refuse('an unclosed backtick');
    lines.push(src.slice(i + 1, j).replace(/\\([`$\\])/g, '$1'));
    return j + 1;
  }
  if (src.startsWith('${', i)) {
    let end = -1;
    for (let k = i + 2, depth = 1, dollar = -1; k < src.length; k++) {
      if (src[k] === '\\') { k++; continue; }
      if (src[k] === '$') { dollar = k; continue; }
      if (src[k] === "'") {
        if (inDq) refuse('a single quote inside ${…} within double quotes (bash and sh read it differently)');
        const ansi = dollar === k - 1;
        let e = k + 1;
        for (; e < src.length && src[e] !== "'"; e++) if (ansi && src[e] === '\\') e++;
        if (e >= src.length) break;
        k = e; continue;
      }
      if (src[k] === '"') { for (k++; k < src.length && src[k] !== '"'; k++) if (src[k] === '\\') k++; continue; }
      if (src[k] === '{') depth++;
      else if (src[k] === '}' && --depth === 0) { end = k; break; }
    }
    if (end < 0) refuse('an unclosed ${');
    const inner = src.slice(i + 2, end);
    if (inner.includes('\\\n')) refuse('a backslash-newline inside ${…}');
    for (let k = 0; k < inner.length; k++) if (inner[k] === '$' || inner[k] === '`') { const e = expansion(inner, k, lines); if (e > 0) k = e - 1; }
    return end + 1;
  }
  const m = src.slice(i + 1).match(/^([A-Za-z_]\w*|[0-9@*#?$!-])/);
  if (m && /^[A-Za-z_]/.test(m[0]) && src.startsWith('\\\n', i + 1 + m[0].length)) refuse('a variable name continued onto the next line');
  return m ? i + 1 + m[0].length : -1;
}

// The body of $'...' as bash expands it.
const ANSI = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };
function ansiC(body) {
  const out = body.replace(/\\(?:([0-7]{1,3})|x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8})|c(.)|(.))/gs, (m, oct, hex, u4, u8, ctl, ch) => {
    if (oct) return String.fromCharCode(parseInt(oct, 8) & 0xff);
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    if (u4 || u8) { const n = parseInt(u4 || u8, 16); return n <= 0x10ffff ? String.fromCodePoint(n) : ''; }
    if (ctl) return String.fromCharCode(ctl.toUpperCase().charCodeAt(0) & 0x1f);
    return ANSI[ch] ?? m;
  });
  const nul = out.indexOf('\0');
  return nul < 0 ? out : out.slice(0, nul);
}

// Brace expansion on unquoted braces: {git,push} is two words, a{b,c} is ab ac, {1..3} is 1 2 3.
function braceExpand(word, mask, budget = { n: 0 }) {
  for (let i = 0; i < word.length; i++) {
    if (word[i] !== '{' || mask[i] !== '1') continue;
    let depth = 0, close = -1;
    const commas = [];
    for (let j = i; j < word.length; j++) {
      if (mask[j] !== '1') continue;
      if (word[j] === '{') depth++;
      else if (word[j] === '}' && --depth === 0) { close = j; break; }
      else if (word[j] === ',' && depth === 1) commas.push(j);
    }
    if (close < 0) continue;
    const pre = word.slice(0, i), preM = mask.slice(0, i), post = word.slice(close + 1), postM = mask.slice(close + 1);
    const parts = [];
    if (commas.length) {
      const cuts = [i, ...commas, close];
      for (let k = 0; k + 1 < cuts.length; k++) parts.push([word.slice(cuts[k] + 1, cuts[k + 1]), mask.slice(cuts[k] + 1, cuts[k + 1])]);
    } else {
      const r = word.slice(i + 1, close).match(/^(-?\d+|[A-Za-z])\.\.(-?\d+|[A-Za-z])(?:\.\.(-?\d+))?$/);
      if (!r || mask.slice(i + 1, close).includes('0')) continue;
      const num = /\d/.test(r[1]), a = num ? +r[1] : r[1].charCodeAt(0), b = num ? +r[2] : r[2].charCodeAt(0);
      const step = Math.abs(+(r[3] ?? 1)) || 1;
      if (Math.abs(b - a) / step > 256) refuse('a brace expansion too long to check');
      for (let v = a; a <= b ? v <= b : v >= b; v += a <= b ? step : -step) { const t = num ? String(v) : String.fromCharCode(v); parts.push([t, '0'.repeat(t.length)]); }
    }
    const out = [];
    for (const [t, m] of parts) {
      if (++budget.n > 512) refuse('a brace expansion too long to check');
      out.push(...braceExpand(pre + t + post, preM + m + postM, budget));
    }
    return out;
  }
  return [word];
}

// An unquoted *, ? or [..] makes the word a pattern the shell fills in from the file system.
function globbed(word, mask) {
  for (let k = 0; k < word.length; k++) {
    if (mask[k] !== '1') continue;
    if (word[k] === '*' || word[k] === '?') return true;
    if (word[k] === '[' && [...word.slice(k + 1)].some((c, j) => c === ']' && mask[k + 1 + j] === '1')) return true;
  }
  return false;
}

function scanExpansions(text, lines) {
  for (let j = 0; j < text.length; j++) {
    if (text[j] === '\\') { j++; continue; }
    if (text[j] === '$' || text[j] === '`') { const e = expansion(text, j, lines); if (e > 0) j = e - 1; }
  }
}

// Splits a line into simple commands { words, redirs, stdin } the way bash reads it. Every
// substitution's command goes on `lines` to be checked on its own. ( and ) come through as { op }.
function lex(src, lines, start = 0, nested = false) {
  const items = [], heredocs = [];
  let words = [], redirs = [], stdin = false, cur = '', mask = '', any = false, redirect = false, redirIn = false, i = start, depth = 0;
  const add = (t, unquoted = false) => { cur += t; mask += (unquoted ? '1' : '0').repeat(t.length); };
  const endWord = () => {
    if (nested && any && !redirect && !words.length && cur === 'case' && mask === '1111') refuse('a case statement inside $(…), <(…) or >(…)');
    if (any) {
      if (redirect) { redirs.push(cur); if (redirIn) stdin = true; redirect = false; }
      else {
        const g = globbed(cur, mask);
        words.push(...braceExpand(cur, mask).map((w) => (g ? w + OPAQUE : w)));
      }
    }
    cur = ''; mask = ''; any = false;
  };
  const endCmd = (op) => {
    endWord();
    if (words.length || redirs.length || stdin) items.push({ words, redirs, stdin });
    words = []; redirs = []; stdin = false;
    if (op) items.push({ op });
  };
  const bodies = () => {
    while (heredocs.length) {
      const h = heredocs.shift();
      for (;;) {
        if (i >= src.length) refuse(`a heredoc with no closing ${h.delim} line`);
        let e = src.indexOf('\n', i);
        if (e < 0) e = src.length;
        let line = src.slice(i, e);
        i = e + 1;
        while (!h.quoted && /(^|[^\\])(\\\\)*\\$/.test(line) && i <= src.length) {
          let n = src.indexOf('\n', i);
          if (n < 0) n = src.length;
          line = line.slice(0, -1) + src.slice(i, n);
          i = n + 1;
        }
        if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break;
        if (!h.quoted) scanExpansions(line, lines);
      }
    }
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      if (src[i + 1] === '\n') { i += 2; continue; }
      add(src[i + 1] ?? ''); any = true; i += 2; continue;
    }
    if (c === "'") {
      const e = src.indexOf("'", i + 1);
      if (e < 0) refuse('an unclosed quote');
      add(src.slice(i + 1, e)); any = true; i = e + 1; continue;
    }
    if (c === '"') {
      any = true;
      for (i++; ; i++) {
        if (i >= src.length) refuse('an unclosed quote');
        const d = src[i];
        if (d === '"') { i++; break; }
        if (d === '\\' && '"\\$`\n'.includes(src[i + 1])) { if (src[i + 1] !== '\n') add(src[i + 1]); i++; continue; }
        if (d === '$' || d === '`') { const e = expansion(src, i, lines, true); if (e > 0) { add(OPAQUE); i = e - 1; continue; } }
        add(d);
      }
      continue;
    }
    if (c === '$' && src[i + 1] === "'") {
      let j = i + 2;
      for (; j < src.length && src[j] !== "'"; j++) if (src[j] === '\\') j++;
      if (j >= src.length) refuse('an unclosed quote');
      add(ansiC(src.slice(i + 2, j))); any = true; i = j + 1; continue;
    }
    if (c === '$' && src[i + 1] === '"') { i++; continue; }
    if (c === '$' || c === '`') {
      const e = expansion(src, i, lines);
      if (e > 0) { add(OPAQUE + SPLIT); any = true; i = e; continue; }
      add(c, true); any = true; i++; continue;
    }
    if ((c === '<' || c === '>') && src[i + 1] === '(') {
      const end = subEnd(src, i + 2);
      lines.push(src.slice(i + 2, end - 1)); add(OPAQUE + SPLIT); any = true; i = end; continue;
    }
    if (c === '#' && !any) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === ' ' || c === '\t') { endWord(); i++; continue; }
    if (c === '\n') { endCmd(); items.push({ sep: '\n' }); i++; bodies(); continue; }
    if (c === '<' || c === '>' || (c === '&' && src[i + 1] === '>')) {
      if (any && /^\d+$/.test(cur) && !redirect) { cur = ''; mask = ''; any = false; } else endWord();
      if (src.startsWith('<<<', i)) { i += 3; redirect = true; redirIn = true; continue; }
      if (src.startsWith('<<', i)) {
        const strip = src[i + 2] === '-';
        i += strip ? 3 : 2;
        while (src[i] === ' ' || src[i] === '\t') i++;
        let delim = '', quoted = false;
        while (i < src.length && !/[\s;&|<>()]/.test(src[i])) {
          if (src[i] === "'" || src[i] === '"') {
            const e = src.indexOf(src[i], i + 1);
            if (e < 0) refuse('an unclosed quote');
            delim += src.slice(i + 1, e); quoted = true; i = e + 1;
          } else if (src[i] === '\\') { delim += src[i + 1] ?? ''; quoted = true; i += 2; }
          else if (src[i] === '$' || src[i] === '`') refuse('a heredoc delimiter with an expansion in it');
          else delim += src[i++];
        }
        if (!delim && !quoted) refuse('a heredoc with no delimiter');
        heredocs.push({ delim, quoted, strip });
        stdin = true;
        continue;
      }
      const op = i++;
      while ('<>&|'.includes(src[i]) && src[i] !== undefined) i++;
      redirect = true;
      const o = src.slice(op, i);
      redirIn = o.startsWith('<') && o !== '<&';
      if (src[i - 1] === '&' && /^[\d-]/.test(src[i] ?? '')) { while (/[\d-]/.test(src[i] ?? '')) i++; redirect = false; }
      continue;
    }
    if (c === ';' || c === '&' || c === '|') {
      endCmd();
      let sep = '';
      while (';&|'.includes(src[i]) && src[i] !== undefined) sep += src[i++];
      items.push({ sep });
      continue;
    }
    if (c === '(' && src[i + 1] === '(' && !any && !words.length) { // (( arithmetic )): a test; only its substitutions run
      const end = arithmeticEnd(src, i);
      if (end > 0) { scanExpansions(src.slice(i + 2, end - 2), lines); i = end; continue; }
    }
    if (c === '(') { depth++; endCmd(c); i++; continue; }
    if (c === ')') {
      if (nested && depth === 0) {
        endCmd();
        if (heredocs.length) refuse(`a heredoc with no closing ${heredocs[0].delim} line`);
        return { items, end: i + 1 };
      }
      depth = Math.max(0, depth - 1); endCmd(c); i++; continue;
    }
    add(c, true); any = true; i++;
  }
  if (nested) refuse('an unclosed (');
  endCmd();
  if (heredocs.length) refuse(`a heredoc with no closing ${heredocs[0].delim} line`);
  return { items, end: i };
}

// ---------- helpers ----------

const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '!', '{', '}', 'time', 'case', 'esac', 'in', 'for', 'select']);

function positional(args, takes) {
  const out = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '--') { out.push(...args.slice(k + 1)); break; }
    if (a.startsWith('-') && a.length > 1) { if (takes.includes(a)) k++; continue; }
    out.push(a);
  }
  return out;
}

function stripOptions(words, takes) {
  let k = 0;
  for (; k < words.length; k++) {
    const a = words[k];
    if (a === '--') { k++; break; }
    if (!a.startsWith('-') || a === '-') break;
    if (takes.includes(a)) k++;
  }
  return words.slice(k);
}

function git(dir, args) {
  try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim(); }
  catch { return null; }
}

function cdTo(cwd, target) {
  if (target === undefined || target === '~') return homedir();
  if (opaque(target) || target === '-') return null;
  if (target.startsWith('~/')) return posix.join(homedir(), target.slice(2));
  if (target.startsWith('/')) return posix.normalize(target);
  return cwd ? posix.join(cwd, target) : null;
}

function resolve(cwd, p) {
  if (opaque(p)) return null;
  if (p.startsWith('~/')) return posix.join(homedir(), p.slice(2));
  if (p.startsWith('/')) return posix.normalize(p);
  return cwd ? posix.join(cwd, p) : null;
}

// A script file the line runs: read it and check it as a line. A path that can't be told, or a file
// that doesn't exist yet (written earlier on the same line), is refused.
function checkScriptFile(path, state, depth, what) {
  const abs = resolve(state.cwd, path);
  if (!abs) refuse(`${what} whose path is filled in at run time or relative to a folder the guard can't tell`);
  let text;
  try {
    const st = statSync(abs);
    if (!st.isFile()) refuse(`${what} that isn't a regular file (${shown(path)})`);
    if (st.size > 1024 * 1024) refuse(`${what} too large to check (${shown(path)})`);
    text = readFileSync(abs, 'utf8');
  } catch (e) {
    if (e instanceof Refuse) throw e;
    refuse(`${what} the guard can't read yet (${shown(path)}); write it in one call and run it in the next`);
  }
  checkLine(text.replace(/^#![^\n]*\n?/, ''), { ...state }, depth + 1);
}

// ---------- git ----------

const GIT_BUILTIN = new Set(('add am annotate apply archive bisect blame branch bundle cat-file check-attr check-ignore '
  + 'check-ref-format checkout cherry cherry-pick clean clone column commit commit-tree config count-objects credential '
  + 'describe diff diff-files diff-index diff-tree difftool fetch for-each-ref format-patch fsck gc grep hash-object '
  + 'help init lfs log ls-files ls-remote ls-tree maintenance merge merge-base mergetool mktree mv name-rev notes '
  + 'pull push range-diff read-tree rebase reflog remote repack replace reset restore rev-list rev-parse revert rm '
  + 'shortlog show show-ref sparse-checkout stash status submodule switch symbolic-ref tag update-index update-ref var '
  + 'verify-commit version whatchanged worktree write-tree subtree svn send-pack http-push').split(' '));
const PUSH_WHY = 'git push (agents commit locally; Truman pushes)';

function checkGit(args, state, depth, fromXargs) {
  let dir = state.cwd, i = 0;
  const configs = [];
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '-C') { dir = cdTo(dir, args[++i]); continue; }
    if (a === '-c' || a === '--config-env') { configs.push(args[++i] ?? ''); continue; }
    if (a.startsWith('--config-env=')) { configs.push(a.slice(13)); continue; }
    if (['--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--attr-source', '--list-cmds'].includes(a)) { i++; continue; }
    if (/^--(git-dir|work-tree|namespace|exec-path|super-prefix|attr-source|list-cmds)=/.test(a)) continue;
    if (/^(-p|--paginate|-P|--no-pager|--bare|--no-replace-objects|--no-lazy-fetch|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks|--no-advice|--exec-path|--html-path|--man-path|--info-path|--version|--help|-h|-v)$/.test(a)) continue;
    if (!a.startsWith('-')) break;
    if (opaque(a)) refuse('a git option filled in at run time');
    refuse(`git ${a}, an option this guard doesn't know`);
  }
  const sub = args[i];
  if (sub === undefined) { if (fromXargs) refuse('a git command whose subcommand comes from xargs, find or a wrapper'); return; }
  if (opaque(sub)) refuse('a git subcommand named at run time');
  const rest = args.slice(i + 1);
  if (sub === 'push') refuse(PUSH_WHY);
  if (sub === 'send-pack' || sub === 'http-push') refuse(`git ${sub} (it writes to a remote; Truman pushes)`);
  if (['subtree', 'lfs'].includes(sub) && rest.some((w) => w === 'push' || opaque(w))) refuse(`git ${sub} push (Truman pushes)`);
  if (sub === 'svn' && rest.some((w) => ['dcommit', 'set-tree'].includes(w) || opaque(w))) refuse('git svn dcommit (it pushes)');
  if (sub === 'config') {
    const pos = rest.filter((w) => !w.startsWith('-'));
    const reads = rest.some((w) => /^(--get|--get-all|--get-regexp|--list|-l|--show-origin|--name-only)$/.test(w));
    if (!reads && pos.length >= 1 && (opaque(pos[0]) || /^(alias|include|includeif)\./i.test(pos[0]))) state.configWrite = true;
  }
  if (sub === 'submodule' && rest.includes('foreach')) {
    const cmd = rest.slice(rest.indexOf('foreach') + 1).filter((w) => !w.startsWith('--'));
    if (cmd.some(opaque)) refuse('a git submodule foreach command built at run time');
    checkLine(cmd.join(' '), { ...state, cwd: null }, depth + 1);
  }
  if (sub === 'rebase') {
    rest.forEach((w, k) => {
      if (w === '-x' || w === '--exec') checkLine(rest[k + 1] ?? '', { ...state }, depth + 1);
      else if (w.startsWith('--exec=')) checkLine(w.slice(7), { ...state }, depth + 1);
      else if (/^-x./.test(w)) checkLine(w.slice(2), { ...state }, depth + 1);
    });
  }
  if (sub === 'bisect' && rest[0] === 'run') checkSimple(rest.slice(1), { ...state }, depth + 1, true);
  if (!GIT_BUILTIN.has(sub)) {
    // An alias (inline with -c, or in the config the cwd sees) can stand for a push.
    const inline = configs.findLast((c) => c.toLowerCase().startsWith(`alias.${sub.toLowerCase()}=`));
    if (configs.some((c) => opaque(c) && /^alias\./i.test(c))) refuse('git -c alias.… filled in at run time');
    if (!inline && state.configWrite) refuse(`git ${sub} after a git config write on the same line (it may be an alias set there)`);
    if (!inline && !dir) refuse(`git ${sub} from a folder the guard can't tell, so it can't read whether ${sub} is an alias`);
    const alias = inline ? inline.slice(inline.indexOf('=') + 1) : git(dir, ['config', '--get', `alias.${sub}`]);
    if (alias) {
      const inner = { ...state, cwd: dir };
      if (alias.startsWith('!')) checkLine(alias.slice(1), inner, depth + 1);
      else checkGit([...configs.flatMap((c) => ['-c', c]), ...alias.split(/\s+/).filter(Boolean), ...rest], inner, depth + 1, fromXargs);
    } else if (fromXargs) refuse(`git ${sub}, which isn't a git command this guard knows, under xargs, find or a wrapper`);
  }
}

// ---------- gh ----------

const GH_GROUPS = new Set(['agent-task', 'alias', 'api', 'attestation', 'auth', 'browse', 'cache', 'codespace', 'completion',
  'config', 'copilot', 'extension', 'gist', 'gpg-key', 'help', 'issue', 'label', 'org', 'pr', 'preview', 'project', 'release',
  'repo', 'ruleset', 'run', 'search', 'secret', 'ssh-key', 'status', 'variable', 'version', 'workflow']);
const GH_PR = new Set(['checkout', 'checks', 'close', 'comment', 'create', 'diff', 'edit', 'list', 'lock', 'ready', 'reopen',
  'review', 'status', 'unlock', 'view', undefined]);
const GH_TAKES = ['-R', '--repo', '-b', '--body', '-F', '--body-file', '-t', '--title', '-B', '--base', '-H', '--head',
  '-l', '--label', '-a', '--assignee', '-m', '--milestone', '-r', '--reviewer', '-L', '--limit', '-s', '--state', '-A',
  '--author', '--json', '-q', '--jq', '-T', '--template', '-S', '--search', '-n', '--notes', '--target', '-w', '--workflow',
  '--hostname', '-c', '--comment', '-e', '--editor'];
const MERGE_WHY = 'merging a PR (Truman merges)';

function checkGhApi(args) {
  let method = null, fields = false, endpoint = null;
  const values = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '-X' || a === '--method') { method = args[++k] ?? ''; continue; }
    if (a.startsWith('--method=')) { method = a.slice(9); continue; }
    if (/^-X./.test(a)) { method = a.slice(2); continue; }
    if (['-f', '-F', '--field', '--raw-field', '--input'].includes(a)) { fields = true; values.push(args[++k] ?? ''); if (a === '--input') values.push('@'); continue; }
    if (/^--(field|raw-field|input)=/.test(a)) { fields = true; values.push(a.slice(a.indexOf('=') + 1)); if (a.startsWith('--input')) values.push('@'); continue; }
    if (/^-[fF]./.test(a)) { fields = true; values.push(a.slice(2)); continue; }
    if (['-H', '--header', '-q', '--jq', '-t', '--template', '--hostname', '-p', '--preview', '--cache'].includes(a)) { k++; continue; }
    if (/^--(header|jq|template|hostname|preview|cache)=/.test(a)) continue;
    if (['--paginate', '--slurp', '-i', '--include', '--silent', '--verbose'].includes(a)) continue;
    if (a.startsWith('-')) refuse(`gh api ${a}, an option this guard doesn't know`);
    if (endpoint !== null) refuse('gh api with two endpoints');
    endpoint = a;
  }
  if (endpoint === null) return;
  if (opaque(endpoint)) refuse('a gh api endpoint filled in at run time');
  if (/^\/?graphql\b/i.test(endpoint)) {
    // A query reads; a mutation (mergePullRequest, createCommitOnBranch, updateRef) writes.
    if (method && method.toUpperCase() !== 'POST') refuse('gh api graphql with an unexpected method');
    if (values.some((v) => opaque(v) || /^@|=@|mutation/i.test(v) || v === '@')) refuse('gh api graphql with a mutation or a query from a file (GitHub writes are Truman\'s)');
    return;
  }
  const m = method ?? (fields ? 'POST' : 'GET');
  if (opaque(m) || m.toUpperCase() !== 'GET') refuse(`gh api ${opaque(m) ? 'with a method filled in at run time' : m.toUpperCase()} (gh api is for reads here; GitHub API writes can merge or push)`);
}

function checkGh(args, fromXargs) {
  const [group, sub] = positional(args, GH_TAKES);
  if (group === undefined) { if (fromXargs) refuse('gh with its command supplied by xargs, find or a wrapper'); return; }
  if (opaque(group)) refuse('a gh command named at run time');
  if (!GH_GROUPS.has(group)) refuse(`gh ${group}, which isn't a gh command this guard knows (an alias or extension?)`);
  if (sub !== undefined && opaque(sub)) refuse(`gh ${group} with a subcommand named at run time`);
  if (fromXargs && sub === undefined) refuse(`gh ${group} with its subcommand supplied by xargs, find or a wrapper`);
  if (group === 'pr') {
    if (sub === 'merge') refuse(MERGE_WHY);
    if (sub === 'update-branch') refuse('gh pr update-branch (it merges the base into the PR branch on GitHub)');
    if (!GH_PR.has(sub)) refuse(`gh pr ${sub}, which this guard doesn't know`);
  }
  if (group === 'api') return checkGhApi(args.slice(args.indexOf('api') + 1));
  if (group === 'repo' && sub === 'sync') refuse('gh repo sync (it pushes)');
  if (group === 'repo' && sub === 'create' && args.some((a) => a === '--push' || a.startsWith('--push='))) refuse('gh repo create --push');
  if (group === 'repo' && ['delete', 'archive', 'unarchive', 'rename', 'edit'].includes(sub)) refuse(`gh repo ${sub} (repo settings are Truman's)`);
  if (group === 'release' && !['list', 'view', 'download', undefined].includes(sub)) refuse(`gh release ${sub} (it makes or changes a tag or release; Truman tags)`);
  if (group === 'workflow' && ['run', 'enable'].includes(sub)) refuse(`gh workflow ${sub} (a workflow can deploy)`);
  if (group === 'run' && ['rerun'].includes(sub)) refuse('gh run rerun (a workflow can deploy)');
  if (['secret', 'variable'].includes(group) && ['set', 'delete', 'remove'].includes(sub)) refuse(`gh ${group} ${sub} (repo secrets and variables are Truman's)`);
  if (group === 'alias' && ['set', 'import', 'delete'].includes(sub)) refuse('changing gh aliases');
  if (group === 'extension' && !['list', 'search', 'browse', undefined].includes(sub)) refuse(`gh extension ${sub} (an extension can run anything)`);
}

// ---------- wrangler ----------

const WR_TAKES = ['-c', '--config', '-e', '--env', '--cwd', '--env-file', '--experimental-provision', '--x-provision'];
const DEPLOY_WHY = 'deploys and Cloudflare changes are Truman\'s; only dev, types, whoami, tail and listings run here';
function checkWrangler(args, fromXargs) {
  const [s, s2] = positional(args, WR_TAKES);
  if (fromXargs) refuse('wrangler under xargs, find or a wrapper that adds arguments');
  if (s === undefined) {
    if (args.every((a) => ['-v', '--version', '-h', '--help'].includes(a))) return;
    refuse(`wrangler with options only (${DEPLOY_WHY})`);
  }
  if (opaque(s) || (s2 !== undefined && opaque(s2))) refuse('a wrangler command named at run time');
  if (s === 'dev' && args.some((a) => /^--(remote|x-remote-bindings)(=|$)/.test(a) || opaque(a))) refuse(`wrangler dev --remote (it runs on Cloudflare; ${DEPLOY_WHY})`);
  if (['dev', 'whoami', 'types', 'docs', 'help', 'check', 'tail', 'login', 'logout'].includes(s)) return;
  if (s === 'deployments' && ['list', 'status', 'view'].includes(s2)) return;
  if (s === 'versions' && ['list', 'view'].includes(s2)) return;
  refuse(`wrangler ${[s, s2].filter((x) => x !== undefined && !x.startsWith('-')).join(' ')} (${DEPLOY_WHY})`);
}

// ---------- package managers and runners ----------

const PM_TAKES = ['-C', '--dir', '-F', '--filter', '--prefix', '-w', '--workspace', '--cwd', '--config', '--reporter', '--loglevel',
  '--registry', '--cache', '--userconfig', '-p', '--package'];
const RUNNERS = new Set(['npx', 'bunx', 'pnpx']);
const PMS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const INSTALL = ['install', 'i', 'ci', 'add', 'rebuild', 'pack', 'link'];
const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare', 'prepack', 'postpack', 'dependencies'];

function checkRunner(args, state, depth) {
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '-c' || a === '--call') { const s = args[k + 1] ?? ''; if (opaque(s)) refuse('a runner -c command built at run time'); return checkLine(s, { ...state }, depth + 1); }
    if (/^--call=/.test(a)) return checkLine(a.slice(7), { ...state }, depth + 1);
    if (PM_TAKES.includes(a)) { k++; continue; }
    if (a === '--') continue;
    if (a.startsWith('-')) continue;
    const name = a.replace(/^(@[^/@]+\/[^@]+|[^@]+)@.*$/, '$1');
    if (opaque(name)) refuse('a package to run named at run time');
    return checkSimple([name.replace(/^@[^/]+\//, ''), ...args.slice(k + 1).filter((x, j) => !(j === 0 && x === '--'))], state, depth);
  }
}

function packageScripts(state, args) {
  let dir = state.cwd;
  for (let k = 0; k < args.length; k++) {
    const m = args[k].match(/^(-C|--dir|--prefix|--cwd)(?:=(.*))?$/);
    if (m) dir = cdTo(dir, m[2] ?? args[++k]);
    if (/^(-r|--recursive|-w|--workspace|--workspaces|-ws|-F|--filter|--include-workspace-root)(=|$)/.test(args[k])) refuse('a package script run across workspaces (the guard reads one package.json)');
  }
  if (!dir) refuse('a package script from a folder the guard can\'t tell, so it can\'t read package.json');
  let text;
  try { text = readFileSync(posix.join(dir, 'package.json'), 'utf8'); } catch { return {}; }
  try { const s = JSON.parse(text).scripts; return s && typeof s === 'object' ? s : {}; }
  catch { refuse('a package script from a package.json the guard can\'t parse'); }
}

function runScripts(names, scripts, state, depth) {
  for (const n of names) {
    const body = scripts[n];
    if (typeof body === 'string') checkLine(body, { ...state }, depth + 1);
  }
}

function checkPackageManager(name, rest, state, depth, fromXargs) {
  const r = stripOptions(rest, PM_TAKES);
  if (r.length && rest.slice(0, rest.length - r.length).some((w) => w.includes(SPLIT))) refuse(`${name} with an unquoted option filled in at run time`);
  const sub = r[0];
  if (sub === undefined) { if (fromXargs) refuse(`${name} with its command supplied by xargs, find or a wrapper`); return; }
  if (opaque(sub)) refuse(`${name} with a command named at run time`);
  if (sub === 'publish' || (name === 'yarn' && sub === 'npm' && r[1] === 'publish')) refuse(`${name} publish (publishing is Truman's)`);
  if (['exec', 'x', 'dlx'].includes(sub)) return checkRunner(r.slice(1), state, depth);
  if (fromXargs) refuse(`${name} ${sub} under xargs, find or a wrapper that adds arguments`);
  if (INSTALL.includes(sub)) return runScripts(LIFECYCLE, packageScripts(state, rest), state, depth);
  if (['run', 'run-script', 'rum', 'urn'].includes(sub)) {
    const script = r.slice(1).find((w) => !w.startsWith('-'));
    if (script === undefined) return; // lists the scripts
    if (opaque(script)) refuse(`${name} run with a script named at run time`);
    return runScripts([`pre${script}`, script, `post${script}`], packageScripts(state, rest), state, depth);
  }
  if (['test', 't', 'tst', 'start', 'stop', 'restart'].includes(sub)) {
    const s = { t: 'test', tst: 'test' }[sub] ?? sub;
    return runScripts([`pre${s}`, s, `post${s}`], packageScripts(state, rest), state, depth);
  }
  if (name !== 'npm') {
    // pnpm, yarn and bun run a package script or a bin by name (pnpm wrangler deploy).
    const scripts = packageScripts(state, rest);
    if (typeof scripts[sub] === 'string') return runScripts([`pre${sub}`, sub, `post${sub}`], scripts, state, depth);
    return checkSimple(r, state, depth);
  }
}

// ---------- http ----------

const HOSTS = /(^|[/@.])(api\.github\.com|uploads\.github\.com|github\.com|api\.cloudflare\.com)([/:?]|$)/i;
function checkHttp(name, args) {
  const host = args.find((a) => HOSTS.test(a));
  const runTime = args.some((a) => opaque(a) && !a.startsWith('-') && /^\0|^https?:\/\/\0/.test(a));
  if (!host && !runTime) return;
  let write = false;
  const setMethod = (m) => { if (m === undefined || opaque(m) || !['GET', 'HEAD'].includes(m.toUpperCase())) write = true; };
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '--request' || a === '--method') { setMethod(args[++k]); continue; }
    if (/^--(request|method)=/.test(a)) { setMethod(a.split('=')[1]); continue; }
    if (/^--(data|data-\w+|json|form|form-string|upload-file|post-data|post-file|body-data|body-file)(=|$)/.test(a)) { write = true; continue; }
    if (!/^-[^-]/.test(a)) continue;
    for (let c = 1; c < a.length; c++) {
      const ch = a[c];
      if ('dFT'.includes(ch)) { write = true; break; }
      if (ch === 'X') { setMethod(c + 1 < a.length ? a.slice(c + 1) : args[++k]); break; }
      if ('HAbcCDeEKmoruUwxyYzQtPO'.includes(ch)) { if (c === a.length - 1) k++; break; }
    }
  }
  if (write) refuse(`a ${name} write to ${host ? host.match(HOSTS)[2] : 'a host filled in at run time'} (GitHub and Cloudflare API writes can merge, push or deploy)`);
}

// ---------- commands ----------

// Inline code for another language: scanned for the denied commands (a heuristic; script files are not read).
const DANGER_TEXT = [/\bgit\b[\s\S]{0,80}?\b(push|send-pack|http-push)\b/, /\bwrangler\b[\s\S]{0,80}?\b(deploy|publish|rollback)\b/, /\bgh\b[\s\S]{0,80}?\bmerge\b/,
  /pulls\/[^/\s]+\/merge\b/, /git\/refs\b[\s\S]{0,80}?\b(POST|PATCH|PUT)\b/i];
const CODE_FLAGS = { python: ['-c'], python3: ['-c'], node: ['-e', '--eval', '-p', '--print'], bun: ['-e', '--eval', '-p', '--print'],
  deno: ['eval'], perl: ['-e', '-E'], ruby: ['-e'], php: ['-r'], osascript: ['-e'], awk: [], gawk: [], mawk: [] };
function checkInlineCode(name, rest) {
  const flags = CODE_FLAGS[name];
  const code = [];
  rest.forEach((w, k) => {
    if (flags.includes(w)) code.push(rest[k + 1] ?? '');
    else if (flags.some((f) => f.startsWith('--') && w.startsWith(`${f}=`))) code.push(w.slice(w.indexOf('=') + 1));
    else if (flags.some((f) => /^-[a-zA-Z]$/.test(f) && w.startsWith(f) && w.length > 2 && name !== 'node')) code.push(w.slice(2));
  });
  if (['awk', 'gawk', 'mawk'].includes(name)) code.push(...rest.filter((w) => !w.startsWith('-')).slice(0, 1));
  for (const c of code) if (DANGER_TEXT.some((re) => re.test(c))) refuse(`${name} code that runs a push, merge or deploy`);
}

// Commands whose words are text, not a command to run: the wrapper fallback skips them.
const TEXT = new Set(['echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'cat', 'head', 'tail', 'less', 'more', 'wc', 'ls',
  'test', '[', ':', 'true', 'false', 'man', 'which', 'type', 'whereis', 'mkdir', 'touch', 'rm', 'cp', 'mv', 'diff', 'cd', 'pushd',
  'popd', 'export', 'declare', 'typeset', 'readonly', 'local', 'unset', 'read', 'basename', 'dirname', 'realpath', 'readlink',
  'stat', 'file', 'jq', 'sort', 'uniq', 'cut', 'tr', 'tee', 'sed', 'claude', 'open', 'wait', 'kill',
  'sleep', 'exit', 'return', 'shift', 'set', 'shopt']);
const GUARDED = (w) => ['git', 'gh', 'wrangler', 'npx', 'bunx', 'pnpx', 'npm', 'pnpm', 'yarn', 'bun', 'curl', 'wget', 'bash', 'sh', 'zsh', 'dash', 'ksh', 'eval'].includes(normalName(w));
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'mksh', 'yash', 'busybox']);
const REFUSED = { parallel: 'parallel (it runs its inputs as commands)', alias: null, rush: 'rush (it runs its inputs as commands)', at: 'at (it runs commands from stdin later)', batch: 'batch (it runs commands from stdin later)', crontab: 'crontab (it schedules commands)', launchctl: 'launchctl (it schedules commands)', tmux: 'tmux (it runs commands in another shell)', screen: 'screen (it runs commands in another shell)' };

function normalName(w) {
  const n = posix.basename(w);
  if (/^wrangler\d*(\.[cm]?js)?$/.test(n)) return 'wrangler';
  return n;
}

function checkShell(name, rest, state, depth, fromXargs, stdin) {
  if (name === 'busybox') { if (!rest.length) return; return checkSimple(rest, state, depth, fromXargs); }
  const c = rest.findIndex((x) => /^-[A-Za-z]*c[A-Za-z]*$/.test(x));
  if (c >= 0) {
    let k = c + 1;
    for (; k < rest.length; k++) {
      const x = rest[k];
      if (x === '--' || x === '-') { k++; break; }
      if (x === '-o' || x === '+o' || x === '-O' || x === '+O') { k++; continue; }
      if (!/^[-+]/.test(x)) break;
    }
    if (rest[k] === undefined && fromXargs) refuse(`a ${name} -c script that comes from xargs, find or a wrapper`);
    const script = rest[k] ?? '';
    if (opaque(script)) refuse(`a ${name} -c script built at run time`);
    return checkLine(script, { ...state }, depth + 1);
  }
  let k = 0;
  for (; k < rest.length; k++) {
    const x = rest[k];
    if (x === '--') { k++; break; }
    if (x === '-o' || x === '+o' || x === '-O' || x === '+O' || x === '--rcfile' || x === '--init-file') { k++; continue; }
    if (/^-[A-Za-z]*s/.test(x)) refuse(`${name} -s (it reads its script from stdin)`);
    if (!/^[-+]/.test(x)) break;
  }
  if (rest[k] === undefined) {
    if (fromXargs) refuse(`a ${name} script that comes from xargs, find or a wrapper`);
    if (stdin || !rest.some((x) => /^-[A-Za-z]*i/.test(x))) refuse(`${name} reading its script from stdin (run a script file or ${name} -c '…')`);
    return;
  }
  return checkScriptFile(rest[k], state, depth, `a ${name} script`);
}

function checkSimple(input, state, depth, fromXargs = false, stdin = false) {
  let w = input.slice();
  for (;;) {
    if (w[0] === 'coproc') {
      w.shift();
      if (/^[A-Za-z_]\w*$/.test(w[0] ?? '') && (KEYWORDS.has(w[1]) || ['(('].includes(w[1]))) w.shift();
      continue;
    }
    if (w[0] === 'time' && w[1] === '-p') { w.splice(0, 2); continue; }
    if (['for', 'select', 'case', '[['].includes(w[0])) return; // a loop's list, a case word or a [[ test ]], not a command
    if (!w.length || !(KEYWORDS.has(w[0]) || /^[A-Za-z_]\w*(\[[^\]]*\])?\+?=/.test(w[0]))) break;
    w.shift();
  }
  if (!w.length) { if (fromXargs) refuse('a command whose name comes from xargs, find or a wrapper'); return; }
  const head = w[0];
  // A name whose last part the shell fills in at run time: it could be anything.
  const base = head.slice(head.lastIndexOf('/') + 1);
  if (opaque(base) || base === '') refuse(`a command named at run time (${shown(head)})`);
  let name = normalName(head);
  let rest = w.slice(1);
  const dashed = name.match(/^git-([a-z][\w-]*)$/); // git-push, $(git --exec-path)/git-push
  if (dashed && !['git-lfs', 'git-receive-pack', 'git-upload-pack'].includes(name) || name === 'git-lfs') { rest = [name === 'git-lfs' ? 'lfs' : dashed[1], ...rest]; name = 'git'; }
  if (name in REFUSED && REFUSED[name]) refuse(REFUSED[name]);
  if (name === 'alias') { if (rest.some((x) => x.includes('='))) refuse('defining an alias (the guard reads the name, not what it stands for)'); return; }
  if (CODE_FLAGS[name]) checkInlineCode(name, rest);
  switch (name) {
    case 'cd': case 'pushd': state.cwd = cdTo(state.cwd, rest.filter((x) => !/^-[LPe@]+$/.test(x))[0]); return;
    case 'popd': state.cwd = null; return;
    case 'command': if (['-v', '-V'].includes(rest[0])) return; // falls through
    case 'builtin': case 'nohup':
      return checkSimple(stripOptions(rest, []), state, depth, fromXargs, stdin);
    case 'exec': return checkSimple(stripOptions(rest, ['-a']), state, depth, fromXargs, stdin);
    case 'nice': return checkSimple(stripOptions(rest, ['-n', '--adjustment']), state, depth, fromXargs, stdin);
    case 'timeout': case 'gtimeout': return checkSimple(stripOptions(rest, ['-s', '-k', '--signal', '--kill-after']).slice(1), state, depth, fromXargs, stdin);
    case 'sudo': case 'doas': return checkSimple(stripOptions(rest, ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U']), state, depth, fromXargs, stdin);
    case 'su': {
      const k = rest.findIndex((x) => x === '-c' || x === '--command');
      if (k >= 0) { const s = rest[k + 1] ?? ''; if (opaque(s)) refuse('a su -c command built at run time'); return checkLine(s, { ...state }, depth + 1); }
      refuse('su without -c (it reads commands from stdin)');
    }
    case 'trap': {
      const s = rest.find((x) => !x.startsWith('-'));
      if (s !== undefined) { if (opaque(s)) refuse('a trap command built at run time'); checkLine(s, { ...state }, depth + 1); }
      return;
    }
    case 'script': {
      for (let k = 0; k < rest.length; k++) {
        const x = rest[k];
        let cmd;
        if (x === '-c' || x === '--command') cmd = rest[k + 1] ?? '';
        else if (x.startsWith('--command=')) cmd = x.slice(10);
        else if (/^-[A-Za-z]*c/.test(x)) cmd = x.indexOf('c') < x.length - 1 ? x.slice(x.indexOf('c') + 1) : rest[k + 1] ?? '';
        else continue;
        if (opaque(cmd)) refuse('a script -c command built at run time');
        return checkLine(cmd, { ...state }, depth + 1);
      }
      // BSD script: script [-aq] [file [command ...]]
      const pos = stripOptions(rest, ['-t', '-T', '-F']);
      if (pos.length > 1) return checkSimple(pos.slice(1), state, depth, fromXargs);
      refuse('script without a command (it runs an interactive shell)');
    }
    case 'env': {
      const split = rest.findIndex((x) => x === '-S' || x === '--split-string' || /^(-S.|--split-string=)/.test(x));
      if (split >= 0) {
        const x = rest[split];
        const str = x === '-S' || x === '--split-string' ? rest[split + 1] ?? '' : x.startsWith('-S') ? x.slice(2) : x.slice(15);
        return checkLine([str, ...rest.slice(split + (x === '-S' || x === '--split-string' ? 2 : 1))].join(' '), { ...state }, depth + 1);
      }
      const chdir = rest.findIndex((x) => x === '-C' || x === '--chdir' || /^(-C.|--chdir=)/.test(x));
      if (chdir >= 0) {
        const x = rest[chdir];
        state = { ...state, cwd: cdTo(state.cwd, x === '-C' || x === '--chdir' ? rest[chdir + 1] : x.startsWith('-C') ? x.slice(2) : x.slice(8)) };
      }
      const r = stripOptions(rest, ['-u', '--unset', '-C', '--chdir', '-P']);
      return checkSimple(r, state, depth, fromXargs, stdin);
    }
    case 'xargs': {
      const cmd = stripOptions(rest, ['-I', '-i', '-n', '-P', '-d', '-L', '-l', '-s', '-E', '-e', '-a', '--max-args', '--max-procs', '--delimiter', '--replace', '--arg-file']);
      return cmd.length ? checkSimple(cmd, state, depth, true) : undefined;
    }
    case 'watch': {
      const cmd = stripOptions(rest, ['-n', '--interval', '-q', '--equexit']);
      const opts = rest.slice(0, rest.length - cmd.length);
      if (opts.some((x) => x === '--exec' || /^-[a-z]*x/.test(x))) return checkSimple(cmd, state, depth, fromXargs);
      if (cmd.some(opaque)) refuse('a watch command built at run time');
      return checkLine(cmd.join(' '), { ...state }, depth + 1);
    }
    case 'find': case 'fd': {
      for (let k = 0; k < rest.length; k++) {
        if (['-exec', '-execdir', '-ok', '-okdir', '-x', '--exec', '-X', '--exec-batch'].includes(rest[k])) {
          const end = rest.findIndex((x, j) => j > k && (x === ';' || x === '+'));
          checkSimple(rest.slice(k + 1, end < 0 ? rest.length : end), { ...state }, depth + 1, true);
        }
      }
      return;
    }
    case 'eval': {
      const script = rest.join(' ');
      if (opaque(script)) refuse('an eval built at run time');
      return checkLine(script, { ...state }, depth + 1);
    }
    case 'source': case '.': {
      if (!rest.length) refuse(`${name} with no file`);
      return checkScriptFile(rest[0], state, depth, `a ${name}d file`);
    }
    case 'git': return checkGit(rest, state, depth, fromXargs);
    case 'gh': return checkGh(rest, fromXargs);
    case 'wrangler': return checkWrangler(rest, fromXargs);
    case 'npx': case 'bunx': case 'pnpx': return checkRunner(rest, state, depth);
    case 'npm': case 'pnpm': case 'yarn': case 'bun': return checkPackageManager(name, rest, state, depth, fromXargs);
    case 'curl': case 'wget': case 'http': case 'https': case 'xh': return checkHttp(name, rest);
    default: break;
  }
  if (SHELLS.has(name)) return checkShell(name, rest, state, depth, fromXargs, stdin);
  // A program run by path: a shell script (or a file with no #! line, which bash runs as one) is
  // read and checked; one that doesn't exist yet is refused.
  if (head.includes('/') && !TEXT.has(name)) {
    const abs = resolve(state.cwd, head);
    if (!abs) refuse(`a program run by a relative path from a folder the guard can't tell (${shown(head)})`);
    let st, start = '';
    try { st = statSync(abs); } catch { refuse(`a program the guard can't read yet (${shown(head)}); write it in one call and run it in the next`); }
    if (st.isFile() && !/^\/(usr|bin|sbin|System)\//.test(abs)) {
      try { start = readFileSync(abs).subarray(0, 512).toString('latin1'); } catch { refuse(`a program the guard can't read (${shown(head)})`); }
      const first = start.split('\n', 1)[0];
      if (!start.includes('\0') && (!first.startsWith('#!') || /\b(ba|z|da|k|mk)?sh\b/.test(first))) checkScriptFile(head, state, depth, 'a shell script');
    }
  }
  // Any other command: if it has git, gh, wrangler, a shell or a runner as a later word, it may run it
  // (stdbuf -oL git push, caffeinate wrangler deploy, f git push for a function f() { "$@"; }).
  if (!TEXT.has(name)) {
    const k = rest.findIndex((x) => GUARDED(x) && !x.startsWith('-'));
    // An interpreter running wrangler's own script (node node_modules/wrangler/bin/wrangler.js dev)
    // passes it the arguments as typed; any other wrapper may add some.
    const direct = k === 0 && ['node', 'bun', 'deno'].includes(name) && normalName(rest[0]) === 'wrangler';
    if (k >= 0) checkSimple(rest.slice(k), { ...state }, depth + 1, !direct);
  }
}

function checkLine(src, state, depth = 0) {
  if (depth > 8) refuse('commands nested too deep to read');
  const lines = [];
  const { items } = lex(src, lines);
  const saved = [];
  let prev = null;
  for (const it of items) {
    if (it.sep) { prev = it.sep; continue; }
    if (it.op === '(') { saved.push(state.cwd); prev = null; continue; }
    if (it.op === ')') { if (saved.length) state.cwd = saved.pop(); continue; }
    const piped = prev === '|' || prev === '|&';
    checkSimple(it.words, state, depth, false, it.stdin || piped);
    prev = null;
  }
  for (const l of lines) checkLine(l, { ...state }, depth + 1);
}

export function verdict(command, cwd = process.cwd()) {
  try {
    const src = String(command ?? '');
    if (src.includes('\0')) refuse('a NUL character');
    const dir = typeof cwd === 'string' && cwd.startsWith('/') ? cwd : null;
    checkLine(src, { cwd: dir });
    return null;
  } catch (e) {
    if (e instanceof Refuse) return e.message;
    return `the guard couldn't read this command (${e.message})`;
  }
}
