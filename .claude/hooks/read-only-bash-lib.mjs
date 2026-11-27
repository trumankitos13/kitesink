// The read-only Bash check behind .claude/hooks/read-only-bash.mjs (AST-46; ported from Keyring's
// KEY-77 hook, with its Supabase, Postgres, Docker and Next.js rules dropped and KiteSink's site
// scripts added), kept apart so the hook file always runs it and the tests can call it. verdict(command) returns null when every command in the line is a
// known read, search or test command used read-only and every file it writes is under /tmp (the
// scratchpad); otherwise the reason it refuses. It is an allow-list: anything it doesn't know, or can't
// lex, is refused.
//
// The line is lexed the way bash reads it, for the parts that decide what runs and what gets written:
// quotes, escapes, line continuations, comments, control operators, redirections with or without
// spaces, heredocs, and command, process and arithmetic substitutions (each substitution is checked as
// a command line of its own). It is a filter, not a sandbox: a probe script under /tmp can do what it
// likes. It stops honest slips by agents that are told not to write.
//
// KiteSink's checks run as they are: python3 scripts/check_site.py, scripts/build_*.py --check,
// scripts/validate_*.py (their Crossref cache is in the system temp folder) and
// scripts/check_overlap.py, node scripts/test_*.js, and node --test on tests/. wrangler, npm
// scripts and the package managers are not on the list.
import { realpathSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

class Refuse extends Error {}
const refuse = (why) => { throw new Refuse(why); };

// ---------- paths ----------

let REAL_TMP = '/tmp';
try { REAL_TMP = realpathSync('/tmp'); } catch { /* keep /tmp */ }

// The longest part of the path that exists decides, so a /tmp path through a link out of /tmp fails.
function realInTmp(abs) {
  for (let cur = abs; ; cur = posix.dirname(cur)) {
    try { const r = realpathSync(cur); return r === REAL_TMP || r.startsWith(`${REAL_TMP}/`); }
    catch { if (cur === '/') return false; }
  }
}
function scratchPath(p) {
  if (typeof p !== 'string' || !p.startsWith('/') || /[\0$`]/.test(p)) return false;
  const n = posix.normalize(p);
  return (n === '/tmp' || n.startsWith('/tmp/')) && realInTmp(n);
}
const DEV = ['/dev/null', '/dev/stdout', '/dev/stderr'];
function scratch(p, ctx) {
  if (typeof p !== 'string') return false;
  if (DEV.includes(p)) return true;
  const tail = (rest) => !rest.split('/').includes('..');
  const v = p.match(/^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))((?:\/[^/$`\0]*)*)$/);
  if (v) return ctx.vars.has(v[1] || v[2]) && tail(v[3]);
  const s = p.match(/^\0(\d+)\0((?:\/[^/$`\0]*)*)$/);
  if (s) { const m = ctx.shared.mktemp.get(Number(s[1])); return !!m && mktempSafe(m, ctx, ctx.env.tmpdir) && tail(s[2]); }
  return scratchPath(p);
}
const out = (p, ctx) => p === '-' || scratch(p, ctx); // '-' is stdout for the commands that take an output file

// mktemp makes its file in -p/--tmpdir DIR, else $TMPDIR, else /tmp; a template with no -p or -t is
// relative to the current directory.
function mktempSafe(args, ctx, tmpdir) {
  const envOk = !tmpdir || scratch(tmpdir, ctx);
  let dir = null, t = false, template = null;
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (['-d', '--directory', '-q', '--quiet', '-u', '--dry-run'].includes(a) || a.startsWith('--suffix=')) continue;
    if (a === '-p') dir = args[++k];
    else if (a.startsWith('--tmpdir=')) dir = a.slice(9);
    else if (a === '-t' || a === '--tmpdir') t = true;
    else if (a.startsWith('-')) return false;
    else template = a;
  }
  if (dir !== null) return scratch(dir, ctx) && !(template || '').includes('/');
  if (template === null) return envOk;
  if (t) return envOk && !template.includes('/');
  return scratchPath(template);
}

// ---------- lexing ----------

// Index of the ) that closes a ( whose contents start at `start`.
function closeParen(src, start) {
  let depth = 1;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (c === "'") { const e = src.indexOf("'", j + 1); if (e < 0) break; j = e; continue; }
    if (c === '"') { for (j++; j < src.length && src[j] !== '"'; j++) if (src[j] === '\\') j++; continue; }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return j;
  }
  return refuse('an unclosed (');
}

// A substitution's command runs, so it is checked like a line of its own; its output becomes \0id\0.
function substitute(inner, ctx) {
  const toks = checkLine(inner, child(ctx)).filter((t) => !(t.k === 'op' && t.v === '\n'));
  const id = ctx.shared.subs.push(inner) - 1;
  if (toks.length && toks.every((t) => t.k === 'w') && toks[0].w === 'mktemp') ctx.shared.mktemp.set(id, toks.slice(1).map((t) => t.w));
  return `\0${id}\0`;
}

// $((...)), $(...), `...` and ${...} at src[i]; null when the $ is just a character.
function expansion(src, i, ctx) {
  if (src.startsWith('$((', i)) {
    const end = closeParen(src, i + 2);
    if (closeParen(src, i + 3) === end - 1) { scanExpansions(src.slice(i + 3, end - 1), ctx); return { text: '0', end: end + 1 }; }
    // not arithmetic after all: $( (subshell) ... ), a command substitution
  }
  if (src.startsWith('$(', i)) { const end = closeParen(src, i + 2); return { text: substitute(src.slice(i + 2, end), ctx), end: end + 1 }; }
  if (src[i] === '`') {
    let j = i + 1;
    for (; j < src.length && src[j] !== '`'; j++) if (src[j] === '\\') j++;
    if (j >= src.length) refuse('an unclosed backtick');
    return { text: substitute(src.slice(i + 1, j).replace(/\\([`$\\])/g, '$1'), ctx), end: j + 1 };
  }
  if (src.startsWith('${', i)) {
    const end = src.indexOf('}', i + 2);
    if (end < 0) refuse('an unclosed ${');
    if (/\$\(|`|["']/.test(src.slice(i + 2, end))) refuse('a command or quote inside ${...}');
    return { text: src.slice(i, end + 1), end: end + 1 };
  }
  return null;
}

// Commands inside an unquoted heredoc's body still run.
function scanExpansions(text, ctx) {
  for (let j = 0; j < text.length; j++) {
    if (text[j] === '\\') { j++; continue; }
    if (text[j] === '$' || text[j] === '`') { const e = expansion(text, j, ctx); if (e) j = e.end - 1; }
  }
}

function heredocBodies(src, i, pending, ctx) {
  while (pending.length) {
    const h = pending.shift();
    for (;;) {
      if (i >= src.length) refuse(`a heredoc with no closing ${h.delim} line`);
      let e = src.indexOf('\n', i);
      if (e < 0) e = src.length;
      const line = src.slice(i, e);
      i = e + 1;
      if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break;
      if (!h.quoted) scanExpansions(line, ctx);
    }
  }
  return i;
}

// Tokens: { k: 'w', w, q } a word (q: part of it was quoted or escaped); { k: 'op', v } a control
// operator; { k: 'r', op } a redirection, whose target is the next word.
function lex(src, ctx) {
  const toks = [], pending = [];
  let cur = '', q = false, any = false, i = 0, inTest = false, cmdPos = true; // inTest: inside [[ ... ]], where < and > compare
  const push = () => {
    if (any) {
      const start = cmdPos;
      toks.push({ k: 'w', w: cur, q });
      cmdPos = start && !q && KEYWORD.includes(cur); // a keyword in command position keeps it
      if (!q && cur === '[[' && start) inTest = true;
      if (!q && cur === ']]') inTest = false;
    }
    cur = ''; q = false; any = false;
  };
  const op = (v) => { toks.push({ k: 'op', v }); cmdPos = true; };
  const KEYWORD = ['if', 'while', 'until', 'then', 'do', 'else', 'elif', '!', 'time', 'for', '{'];
  const atCommand = () => !any && cmdPos;
  while (i < src.length) {
    const c = src[i], next = src[i + 1];
    if (c === '\\') {
      if (next === '\n') { i += 2; continue; } // line continuation
      if (next === undefined) refuse('a trailing backslash');
      cur += next; q = any = true; i += 2; continue;
    }
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      if (j < 0) refuse('an unclosed quote');
      cur += src.slice(i + 1, j); q = any = true; i = j + 1; continue;
    }
    if (c === '$' && next === "'") { // $'...'
      let j = i + 2;
      for (; j < src.length && src[j] !== "'"; j++) cur += src[j] === '\\' ? (src[++j] ?? '') : src[j];
      if (j >= src.length) refuse('an unclosed quote');
      q = any = true; i = j + 1; continue;
    }
    if (c === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= src.length) refuse('an unclosed quote');
        const d = src[j];
        if (d === '"') break;
        if (d === '\\' && j + 1 < src.length && '$`"\\\n'.includes(src[j + 1])) { if (src[j + 1] !== '\n') cur += src[j + 1]; j += 2; continue; }
        if (d === '$' || d === '`') { const e = expansion(src, j, ctx); if (e) { cur += e.text; j = e.end; continue; } }
        cur += d; j++;
      }
      q = any = true; i = j + 1; continue;
    }
    if (c === '$' || c === '`') { const e = expansion(src, i, ctx); if (e) { cur += e.text; any = true; i = e.end; continue; } }
    if (c === '#' && !any) { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
    if (c === ' ' || c === '\t') { push(); i++; continue; }
    if (c === '\n') { push(); inTest = false; op('\n'); i = heredocBodies(src, i + 1, pending, ctx); continue; }
    if (inTest && ('<>()'.includes(c) || (c === '|' && next !== '|')) && !(any && cur === ']]') && !('<>'.includes(c) && next === '(')) { cur += c; any = true; i++; continue; } // [[ a > b ]] compares; =~ (a|b)
    if (c === '(' && next === '(' && atCommand()) { // (( arithmetic )): a test; only its substitutions run
      const end = closeParen(src, i + 2);
      if (src[end + 1] !== ')') refuse('an unclosed ((');
      scanExpansions(src.slice(i + 2, end), ctx);
      toks.push({ k: 'w', w: 'true', q: false }); cmdPos = false; i = end + 2; continue;
    }
    if ((c === '<' || c === '>') && next === '(') {
      if (c === '>') refuse('a process substitution that writes');
      const end = closeParen(src, i + 2);
      checkLine(src.slice(i + 2, end), child(ctx));
      cur += '/dev/fd/63'; any = true; i = end + 1; continue;
    }
    if (c === '<' || c === '>' || (c === '&' && next === '>')) {
      if (any && !q && /^\d+$/.test(cur)) { cur = ''; any = false; } else push(); // N> names a descriptor
      const op = src.slice(i).match(/^(&>>|&>|<<<|<<-|<<|<>|<&|>>|>&|>\||<|>)/)[1];
      i += op.length;
      if (op === '<<' || op === '<<-') {
        const m = src.slice(i).match(/^[ \t]*((?:'[^'\n]*'|"[^"\n]*"|\\.|[^\s;&|<>()])+)/);
        if (!m) refuse('a heredoc with no delimiter');
        pending.push({ delim: m[1].replace(/['"\\]/g, ''), strip: op === '<<-', quoted: /['"\\]/.test(m[1]) });
        i += m[0].length; continue;
      }
      toks.push({ k: 'r', op }); continue;
    }
    if (c === '(' || c === ')') { push(); inTest = false; op(c); i++; continue; }
    if (inTest && /^(&&|\|\|)/.test(src.slice(i)) && !(any && !q && cur === ']]')) { push(); toks.push({ k: 'w', w: src.slice(i, i + 2), q: false }); i += 2; continue; } // [[ a && b ]]
    if (c === ';' || c === '|' || c === '&') {
      push(); inTest = false;
      const o = src.slice(i).match(/^(;;&|;;|;&|&&|\|\||\|&|;|\||&)/)[1];
      op(o); i += o.length; continue;
    }
    cur += c; any = true; i++;
  }
  push();
  if (pending.length) refuse('a heredoc with no body');
  return toks;
}

// ---------- options ----------

// getopt-style: bundled short flags (-sLo f), -oVALUE, --name=value and --name value. `takes` lists the
// letters and long names that take a value. With stop, the first operand ends the options.
function getopt(args, takes, stop = false) {
  const opts = [], pos = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '--') { pos.push(...args.slice(k + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq < 0 ? a.slice(2) : a.slice(2, eq);
      opts.push([name, eq >= 0 ? a.slice(eq + 1) : takes.includes(name) ? args[++k] : undefined]);
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        if (takes.includes(a[j])) { opts.push([a[j], j + 1 < a.length ? a.slice(j + 1) : args[++k]]); break; }
        opts.push([a[j], undefined]);
      }
      continue;
    }
    if (stop) { pos.push(...args.slice(k)); break; }
    pos.push(a);
  }
  return { opts, pos };
}
const has = (opts, ...names) => opts.some(([n]) => names.includes(n));
const values = (opts, ...names) => opts.filter(([n]) => names.includes(n)).map(([, v]) => v);

// ---------- variables ----------

// A subshell or child shell: its variables don't come back out.
const child = (ctx) => ({ ...ctx, vars: new Set(ctx.vars), env: { ...ctx.env }, cond: false, chain: null });
// Variables that change what a later command runs or reads its config from.
const RISKY_VAR = /^(LD_\w+|DYLD_\w+|NODE_OPTIONS|NODE_PATH|BASH_ENV|ENV|PROMPT_COMMAND|PS[0-4]|IFS|PATH|PYTHON\w*|KS_\w+|NODE_V8_COVERAGE|npm_config_\w+|NPM_CONFIG_\w+|GIT_(TRACE\w*|EXTERNAL_DIFF|SSH|SSH_COMMAND|ASKPASS|EDITOR|SEQUENCE_EDITOR|CONFIG\w*|EXEC_PATH|PROXY_COMMAND|INDEX_FILE|OBJECT_DIRECTORY))$/;
function checkAssign(name, value) {
  if (RISKY_VAR.test(name)) refuse(`setting ${name} (it changes what other commands run)`);
  if (/^(GIT_PAGER|PAGER|MANPAGER|EDITOR|VISUAL)$/.test(name) && !['', 'cat', 'less'].includes(value)) refuse(`setting ${name} to a program`);
}
// A variable is trusted as a /tmp path while its last assignment was one. An assignment that may not
// run (after ||, inside if/while/until/for/case, in a pipeline or subshell) can take trust away but never
// give it. One after && gives trust only to the rest of its && chain, which runs only if it did.
function setVar(name, value, ctx) {
  checkAssign(name, value);
  const safe = scratch(value, ctx);
  if (name === 'TMPDIR' && ((!ctx.cond && !ctx.chain) || !safe)) ctx.env.tmpdir = value;
  if (!safe) ctx.vars.delete(name);
  else if (!ctx.cond) { ctx.vars.add(name); ctx.chain?.add(name); }
}

// ---------- the command line ----------

function checkLine(src, ctx) {
  const toks = lex(src, ctx);
  let words = [], redirs = [], depth = 0, blocks = 0, prev = null;
  const chain = new Set(); // trusted only while the current && chain runs
  const flush = (next) => {
    const cond = depth > 0 || blocks > 0 || ['||', '|', '|&'].includes(prev) || ['|', '|&', '&'].includes(next);
    const c = cond ? { ...ctx, cond: true } : prev === '&&' ? { ...ctx, chain } : ctx;
    if (words.length || redirs.length) checkSimple(words, redirs, c);
    const head = words.find((w) => !['then', 'do', 'else', 'elif', '!', '{', 'time'].includes(w));
    if (['if', 'while', 'until', 'for', 'select', 'case'].includes(head)) blocks++;
    if (['fi', 'done', 'esac'].includes(head)) blocks = Math.max(0, blocks - 1);
    if (!['&&', '|', '|&'].includes(next)) { for (const n of chain) ctx.vars.delete(n); chain.clear(); } // A && B | C: C runs only if the chain did
    words = []; redirs = [];
  };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.k === 'op' && t.v === '\n' && !words.length && !redirs.length && ['&&', '||', '|', '|&'].includes(prev)) continue; // a && at line end continues
    if (t.k === 'op') { flush(t.v); if (t.v === '(') depth++; if (t.v === ')') depth = Math.max(0, depth - 1); prev = t.v; }
    else if (t.k === 'r') {
      const target = toks[++k];
      if (target?.k !== 'w') refuse(`a ${t.op} with nothing after it`);
      redirs.push({ op: t.op, target: target.w });
    } else words.push(t.w);
  }
  flush(null);
  return toks;
}

const WRITES = new Set(['>', '>>', '>|', '&>', '&>>', '<>']);
const shown = (p) => String(p).replace(/\0\d+\0/g, '$(...)');

function checkSimple(words, redirs, ctx) {
  for (const { op, target } of redirs) {
    if (WRITES.has(op) && !scratch(target, ctx)) refuse(`a redirect to ${shown(target)} (only /tmp is writable)`);
    if (op === '>&' && !/^(\d+|-)$/.test(target) && !scratch(target, ctx)) refuse(`a redirect to ${shown(target)} (only /tmp is writable)`);
  }
  let t = words;
  const assigns = [];
  for (;;) {
    if (!t.length) break;
    const a = t[0];
    const asg = a.match(/^([A-Za-z_]\w*)=([\s\S]*)$/);
    if (asg) { assigns.push([asg[1], asg[2]]); t = t.slice(1); continue; }
    if (['then', 'do', 'else', 'elif'].includes(a)) { ctx = { ...ctx, cond: true }; t = t.slice(1); continue; }
    if (['if', 'while', 'until', '!', '{', '}', 'fi', 'done', 'esac', 'nohup'].includes(a)) { t = t.slice(1); continue; }
    if (a === 'time') { t = t.slice(t[1] === '-p' ? 2 : 1); continue; }
    if (a === 'for' || a === 'select') {
      const name = t[1], items = t[2] === 'in' ? t.slice(3) : [];
      if (/^[A-Za-z_]\w*$/.test(name || '')) {
        if (!items.length || !items.every((x) => scratch(x, ctx))) ctx.vars.delete(name); else if (!ctx.cond) { ctx.vars.add(name); ctx.chain?.add(name); }
      }
      return;
    }
    if (a === 'case' || a === 'in') return;
    if (a === 'command') { if (t[1] === '-v' || t[1] === '-V') return; t = t.slice(1); continue; }
    if (a === 'timeout') {
      const { pos } = getopt(t.slice(1), ['s', 'k', 'signal', 'kill-after'], true);
      t = pos.slice(1); continue; // drop the duration
    }
    if (a === 'nice') { t = getopt(t.slice(1), ['n', 'adjustment'], true).pos; continue; }
    if (a === 'env') {
      const { opts, pos } = getopt(t.slice(1), ['u', 'unset', 'C', 'chdir', 'S', 'split-string'], true);
      if (has(opts, 'S', 'split-string')) refuse('env -S');
      t = pos;
      while (t[0] && /^[A-Za-z_]\w*=/.test(t[0])) { const [n, ...v] = t[0].split('='); assigns.push([n, v.join('=')]); t = t.slice(1); }
      if (!t.length) { for (const [n, v] of assigns) checkAssign(n, v); return; } // env alone prints the environment
      continue;
    }
    break;
  }
  if (!t.length) { for (const [n, v] of assigns) setVar(n, v, ctx); return; }
  for (const [n, v] of assigns) checkAssign(n, v);
  const tmp = assigns.find(([n]) => n === 'TMPDIR'); // TMPDIR=x mktemp ...
  return checkCommand(commandName(t[0]), t.slice(1), tmp ? { ...ctx, env: { ...ctx.env, tmpdir: tmp[1] } } : ctx);
}

function commandName(w) {
  if (/[\0$`]/.test(w)) refuse('a command name that comes from a variable or substitution');
  const name = w.split('/').pop();
  if (name !== w && !/^(\/usr)?\/(local\/)?s?bin\/[^/]+$/.test(w)) refuse(`${w} by path`);
  return name;
}

// ---------- the allow-list ----------

const READ = new Set(['cat', 'head', 'tail', 'ls', 'grep', 'egrep', 'fgrep', 'wc', 'cut', 'tr', 'diff',
  'cmp', 'comm', 'jq', 'file', 'stat', 'du', 'df', 'realpath', 'readlink', 'dirname', 'basename', 'pwd',
  'cd', 'pushd', 'popd', 'echo', 'true', 'false', 'test', '[', '[[', 'which', 'type', 'whoami', 'id',
  'uname', 'ps', 'seq', 'od', 'hexdump', 'md5sum', 'sha256sum', 'sha1sum', 'base64', 'column', 'nl', 'rev',
  'tac', 'fold', 'fmt', 'paste', 'join', 'expand', 'unexpand', 'strings', 'pdfinfo', 'exit', 'wait',
  'sleep', 'set', 'printenv', 'nproc', 'free', 'uptime', 'lsof', ':']);
const SCRATCH_ONLY = new Set(['mkdir', 'rm', 'rmdir', 'touch', 'cp', 'mv', 'ln', 'truncate', 'dd', 'install', 'rsync', 'patch', 'chmod']);
const NEVER = new Set(['sudo', 'su', 'doas', 'eval', 'source', '.', 'exec', 'trap', 'alias', 'builtin', 'enable']);
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'blame', 'grep', 'ls-files', 'ls-tree', 'ls-remote',
  'rev-parse', 'rev-list', 'merge-base', 'describe', 'cat-file', 'shortlog', 'show-ref', 'for-each-ref',
  'name-rev', 'check-ignore', 'count-objects', 'help', 'version', 'whatchanged', 'range-diff', 'cherry',
  'diff-tree', 'diff-index', 'diff-files', 'show-branch']);
// KiteSink's own check scripts, and the arguments each may take: none of them writes in the repo.
const REPO_TOP = (() => { try { return realpathSync(fileURLToPath(new URL('../..', import.meta.url))); } catch { return null; } })();
const SITE_SCRIPTS = [
  [/^scripts\/check_site\.py$/, (a) => a.length === 0],
  [/^scripts\/build_(fitness|music|llms_full|agent_files)\.py$/, (a) => a.length === 1 && a[0] === '--check'],
  [/^scripts\/validate_(fitness|music)\.py$/, (a) => a.every((x) => !x.startsWith('-') || x === '--offline')],
  [/^scripts\/check_overlap\.py$/, (a) => a.every((x) => !x.startsWith('-') || x === '--corpus')],
];
// A path in this repository, relative to its top: scripts/x.py, ./scripts/x.py or the absolute path.
function repoPath(p) {
  if (typeof p !== 'string' || /[\0$`]/.test(p)) return null;
  if (p.startsWith('/')) return REPO_TOP && p.startsWith(`${REPO_TOP}/`) ? posix.normalize(p.slice(REPO_TOP.length + 1)) : null;
  const n = posix.normalize(p);
  return n.startsWith('../') ? null : n;
}

function checkCommand(cmd, args, ctx) {
  if (READ.has(cmd)) return;
  if (NEVER.has(cmd)) refuse(cmd);
  if (cmd === 'printf') { if (args[0] === '-v') ctx.vars.delete(args[1]); return; }
  if (cmd === 'date') { if (args.some((a) => /^(-s|--set)/.test(a))) refuse('date --set'); return; }
  if (['export', 'declare', 'typeset', 'local', 'readonly'].includes(cmd)) {
    for (const a of args) { const m = a.match(/^([A-Za-z_]\w*)=([\s\S]*)$/); if (m) setVar(m[1], m[2], ctx); }
    return;
  }
  if (cmd === 'read' || cmd === 'unset') { for (const a of args) ctx.vars.delete(a); return; }
  if (['bash', 'sh', 'zsh', 'dash'].includes(cmd)) {
    const c = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
    const script = args.find((a) => !a.startsWith('-'));
    const before = args.slice(0, Math.max(c, 0)).filter((a, k, all) => !['-o', '+o'].includes(all[k - 1])); // set -o pipefail values
    if (c >= 0 && args[c + 1] !== undefined && !before.some((a) => !/^[-+]/.test(a))) { checkLine(args[c + 1], child(ctx)); return; }
    if (c < 0 && script !== undefined && scratch(script, ctx)) return; // a probe under /tmp, like node and python
    refuse(`${cmd} without -c, or a script outside /tmp`);
  }
  if (cmd === 'kill') { // only the jobs this shell started (kill %1, kill $!)
    const targets = getopt(args, ['s', 'n']).pos;
    if (!targets.length || targets.some((a) => !/^(%\d*|\$!)$/.test(a))) refuse('kill of a process this command line did not start');
    return;
  }
  if (cmd === 'rg') { if (args.some((a) => /^--(pre|hostname-bin)(=|$)/.test(a))) refuse('rg --pre (it runs a program)'); return; }
  if (cmd === 'sort') {
    const { opts } = getopt(args, ['o', 'output', 'k', 'key', 't', 'field-separator', 'S', 'buffer-size', 'T', 'temporary-directory', 'parallel', 'files0-from', 'compress-program']);
    if (has(opts, 'compress-program')) refuse('sort --compress-program');
    for (const f of values(opts, 'o', 'output')) if (!out(f, ctx)) refuse(`sort -o ${shown(f)} (only /tmp is writable)`);
    return;
  }
  if (cmd === 'uniq') {
    const { pos } = getopt(args, ['f', 's', 'w', 'skip-fields', 'skip-chars', 'check-chars']);
    if (pos.length > 1 && !out(pos[1], ctx)) refuse(`uniq writing ${shown(pos[1])} (only /tmp is writable)`);
    return;
  }
  if (cmd === 'sed') {
    const { opts, pos } = getopt(args, ['e', 'expression', 'f', 'file', 'l', 'line-length']);
    const scripts = values(opts, 'e', 'expression');
    if (!scripts.length && !has(opts, 'f', 'file')) scripts.push(pos.shift() ?? '');
    for (const s of scripts) {
      const S = /s(.)(?:\\.|(?!\1)[^\\\n])*\1(?:\\.|(?!\1)[^\\\n])*\1([a-zA-Z0-9]*)/g;
      const flags = [...s.matchAll(S)].map((m) => m[2]).join('');
      const bare = s.replace(S, 's').replace(/\/(?:\\.|[^\\/\n])*\/[IM]*/g, 'A').replace(/\\(.)(?:\\.|(?!\1)[^\\\n])*\1[IM]*/g, 'A'); // s commands and addresses out of the way
      if (/[we]/.test(flags) || /(?:^|[;\n{}])[\s0-9$,A!~+]*[wWe](?:\s|$)/.test(bare)) refuse('a sed script that writes a file or runs a command');
    }
    if (has(opts, 'i', 'in-place') && (!pos.length || pos.some((f) => !scratch(f, ctx)))) refuse('sed -i outside /tmp');
    return;
  }
  if (['awk', 'gawk', 'mawk'].includes(cmd)) {
    const { opts, pos } = getopt(args, ['f', 'v', 'F', 'i', 'l', 'E', 'e', 'assign', 'field-separator', 'file', 'include', 'load', 'source']);
    if (has(opts, 'i', 'include', 'o', 'p', 'd', 'D', 'profile', 'pretty-print', 'dump-variables', 'debug', 'l', 'load')) refuse(`${cmd} with an option that writes or loads code`);
    for (const f of values(opts, 'f', 'file', 'E')) if (!scratch(f, ctx)) refuse(`${cmd} -f with a program outside /tmp`);
    const programs = [...values(opts, 'e', 'source'), ...(has(opts, 'f', 'file', 'E', 'e', 'source') ? [] : [pos[0] ?? ''])];
    for (let prog of programs) {
      prog = String(prog ?? '').replace(/"(?:\\.|[^"\\])*"/g, '""'); // strings can hold ; } > |
      while (/\([^()]*\)/.test(prog) && !/\bsystem\s*\(/.test(prog)) prog = prog.replace(/\([^()]*\)/g, ' 0 '); // (a > b) compares
      if (/\bsystem\s*\(|\|\s*getline|\bprintf?\b[^;}\n]*[>|]/.test(prog)) refuse(`${cmd} program that writes a file or runs a command`);
    }
    return;
  }
  if (cmd === 'tee') { for (const p of getopt(args, []).pos) if (!scratch(p, ctx)) refuse(`tee ${shown(p)} (only /tmp is writable)`); return; }
  if (cmd === 'mktemp') { if (!mktempSafe(args, ctx, ctx.env.tmpdir)) refuse('mktemp outside /tmp'); return; }
  if (SCRATCH_ONLY.has(cmd)) return checkWrites(cmd, args, ctx);
  if (cmd === 'find') return checkFind(args, ctx);
  if (cmd === 'xargs') {
    const { pos } = getopt(args, ['n', 'L', 'I', 'P', 'd', 's', 'E', 'a', 'max-args', 'max-lines', 'replace', 'max-procs', 'delimiter', 'max-chars', 'eof', 'arg-file', 'process-slot-var'], true);
    if (!pos.length) return;
    const inner = commandName(pos[0]);
    if (SCRATCH_ONLY.has(inner) || ['tee', 'sed', 'uniq', 'xxd', 'pdftotext'].includes(inner)) refuse(`xargs ${inner} (its paths come from input)`);
    return checkCommand(inner, pos.slice(1), ctx);
  }
  if (cmd === 'git') return checkGit(args, ctx);
  if (cmd === 'gh') return checkGh(args);
  if (cmd === 'node') return checkNode(args, ctx);
  if (cmd === 'python3' || cmd === 'python') {
    if (args[0] === '-m' && args[1] === 'json.tool') {
      const { pos } = getopt(args.slice(2), ['indent']);
      if (pos.length > 1 && !out(pos[1], ctx)) refuse(`json.tool writing ${shown(pos[1])} (only /tmp is writable)`);
      return;
    }
    const { opts, pos } = getopt(args, ['c', 'm', 'W', 'X'], true);
    if (opts.some(([n]) => !['B', 'u', 'I', 'E', 's', 'm'].includes(n))) refuse(`${cmd} -${opts.find(([n]) => !['B', 'u', 'I', 'E', 's', 'm'].includes(n))[0]} (only the site's check scripts and probes under /tmp)`);
    const mod = values(opts, 'm')[0];
    if (mod === 'http.server') { // serves the site to look at; it writes nothing
      const { opts: o } = getopt(pos, ['b', 'bind', 'd', 'directory', 'p', 'protocol']);
      if (o.some(([n]) => !['b', 'bind', 'd', 'directory', 'p', 'protocol'].includes(n))) refuse('python3 -m http.server with an option this check doesn\'t know');
      return;
    }
    if (mod === undefined && pos.length && scratch(pos[0], ctx)) return;
    const rel = mod === undefined ? repoPath(pos[0]) : null;
    const site = rel && SITE_SCRIPTS.find(([re]) => re.test(rel));
    if (site && site[1](pos.slice(1))) return;
    refuse(`${cmd} ${shown(pos.join(' '))} (only the site's check scripts as documented: scripts/check_site.py, scripts/build_*.py --check, scripts/validate_*.py, scripts/check_overlap.py, and probes under /tmp)`);
  }
  if (cmd === 'npx' || cmd === 'bunx') return checkRunner(cmd, args, ctx);
  if (['pnpm', 'npm', 'yarn', 'bun'].includes(cmd)) {
    if (args.length === 1 && ['--version', '-v'].includes(args[0])) return;
    refuse(`${cmd} (KiteSink has no package scripts; only --version)`);
  }
  if (cmd === 'curl') return checkCurl(args, ctx);
  if (cmd === 'wget') return checkWget(args, ctx);
  if (cmd === 'pandoc') {
    const { opts } = getopt(args, ['o', 'output', 'f', 'from', 'r', 'read', 't', 'to', 'w', 'write', 'extract-media', 'log', 'M', 'metadata', 'V', 'variable', 'd', 'defaults', 'resource-path', 'reference-doc', 'template', 'L', 'lua-filter', 'F', 'filter', 'data-dir', 'metadata-file', 'c', 'css', 'H', 'include-in-header', 'B', 'include-before-body', 'A', 'include-after-body', 'columns', 'wrap', 'track-changes', 'pdf-engine', 'shift-heading-level-by']);
    for (const f of values(opts, 'o', 'output')) if (!out(f, ctx)) refuse(`pandoc -o ${shown(f)} (only /tmp is writable)`);
    for (const f of values(opts, 'extract-media', 'log', 'L', 'lua-filter', 'F', 'filter', 'd', 'defaults')) if (!scratch(f, ctx)) refuse('a pandoc option that writes outside /tmp or runs a filter');
    return;
  }
  if (cmd === 'pdftoppm') { const root = args.filter((a) => !a.startsWith('-')).pop(); if (!scratch(root, ctx)) refuse('pdftoppm output outside /tmp'); return; }
  if (cmd === 'pdftotext') {
    const pos = args.filter((a, k) => (a === '-' || !a.startsWith('-')) && !['-f', '-l', '-r', '-x', '-y', '-W', '-H', '-enc', '-eol', '-opw', '-upw', '-fixed'].includes(args[k - 1]));
    if (pos.length < 2 || !out(pos[1], ctx)) refuse('pdftotext without - or a /tmp output (it writes next to the PDF)');
    return;
  }
  if (cmd === 'xxd') {
    const pos = args.filter((a, k) => !a.startsWith('-') && !['-c', '-cols', '-g', '-groupsize', '-l', '-len', '-s', '-seek', '-o', '-offset', '-n', '-name'].includes(args[k - 1]));
    if (pos.length > 1 && !out(pos[1], ctx)) refuse(`xxd writing ${shown(pos[1])} (only /tmp is writable)`);
    return;
  }
  if (cmd === 'tree') {
    if (args.includes('-R')) refuse('tree -R (it writes a file in each directory)');
    const o = args.indexOf('-o'); if (o >= 0 && !scratch(args[o + 1], ctx)) refuse('tree -o outside /tmp');
    return;
  }
  if (cmd === 'unzip') {
    const d = args.findIndex((a) => /^-[a-zA-Z]*d$/.test(a));
    if (d >= 0) { if (scratch(args[d + 1], ctx)) return; refuse('unzip -d outside /tmp'); }
    if (args.some((a) => /^-[a-zA-Z]*[lvtZpcz]/.test(a))) return; // lists or prints
    refuse('unzip into the current directory');
  }
  if (cmd === 'tar') return checkTar(args, ctx);
  refuse(`${cmd} is not on the read-only list`);
}

const WRITE_TAKES = {
  mkdir: ['m', 'mode', 'context'], touch: ['d', 'date', 't', 'r', 'reference'], rm: [], rmdir: [], truncate: ['s', 'size', 'r', 'reference'],
  cp: ['t', 'target-directory', 'S', 'suffix'], mv: ['t', 'target-directory', 'S', 'suffix'],
  install: ['m', 'mode', 'o', 'owner', 'g', 'group', 't', 'target-directory', 'S', 'suffix'],
  rsync: ['e', 'rsh', 'exclude', 'include', 'filter', 'f', 'chmod', 'chown', 'backup-dir', 'suffix', 'T', 'temp-dir', 'log-file', 'out-format', 'files-from', 'exclude-from', 'include-from', 'max-size', 'min-size', 'timeout', 'port', 'bwlimit', 'rsync-path', 'write-batch', 'only-write-batch', 'read-batch'],
};
function checkWrites(cmd, args, ctx) {
  if (cmd === 'ln') refuse('ln (a link can point a /tmp path anywhere)');
  if (cmd === 'dd') { for (const a of args) if (a.startsWith('of=') && !scratch(a.slice(3), ctx)) refuse('dd outside /tmp'); return; }
  if (cmd === 'patch') {
    const { opts } = getopt(args, ['d', 'directory', 'p', 'strip', 'i', 'input', 'o', 'output', 'r', 'reject-file', 'B', 'prefix', 'z', 'suffix', 'D', 'F', 'fuzz']);
    const dir = values(opts, 'd', 'directory');
    if (!dir.length || dir.some((d) => !scratch(d, ctx)) || values(opts, 'o', 'output', 'r', 'reject-file').some((f) => !scratch(f, ctx))) refuse('patch outside /tmp');
    return;
  }
  if (cmd === 'chmod') {
    const { opts, pos } = getopt(args, ['reference']);
    const files = has(opts, 'reference') ? pos : pos.slice(1);
    if (!files.length || files.some((p) => !scratch(p, ctx))) refuse('chmod outside /tmp');
    return;
  }
  const { opts, pos } = getopt(args, WRITE_TAKES[cmd] ?? []);
  if (cmd === 'rsync') {
    for (const f of values(opts, 'log-file', 'write-batch', 'only-write-batch', 'backup-dir', 'temp-dir', 'T')) if (!scratch(f, ctx)) refuse('an rsync option that writes outside /tmp');
    if (has(opts, 'e', 'rsh', 'rsync-path')) refuse('rsync running a remote command');
  }
  const target = values(opts, 't', 'target-directory');
  if (['cp', 'mv', 'install', 'rsync'].includes(cmd) && !(cmd === 'install' && has(opts, 'd', 'directory'))) {
    if (!pos.length) refuse(`${cmd} with no path`);
    const dests = target.length ? target : [pos[pos.length - 1]];
    if (cmd === 'mv' || (cmd === 'rsync' && has(opts, 'remove-source-files'))) dests.push(...pos); // they remove their sources
    for (const d of dests) if (!scratch(d, ctx)) refuse(`${cmd} into ${shown(d)} (only /tmp is writable)`);
    return;
  }
  if (!pos.length) refuse(`${cmd} with no path`);
  for (const p of pos) if (!scratch(p, ctx)) refuse(`${cmd} ${shown(p)} (only /tmp is writable)`);
  if (['rm', 'rmdir'].includes(cmd) && pos.some((p) => /^\/tmp\/*(\*|$)/.test(posix.normalize(p)))) refuse(`${cmd} of /tmp itself`);
}

function checkFind(args, ctx) {
  let k = 0;
  while (k < args.length && /^-(H|L|P|O\d*|D)$/.test(args[k])) k += args[k] === '-D' ? 2 : 1;
  const starts = [];
  while (k < args.length && !/^[-(!)]/.test(args[k])) starts.push(args[k++]);
  if (!starts.length) starts.push('.');
  for (; k < args.length; k++) {
    const a = args[k];
    if (a === '-delete') refuse('find -delete');
    if (['-fprint', '-fprint0', '-fls', '-fprintf'].includes(a)) { if (!scratch(args[k + 1], ctx)) refuse(`find ${a} outside /tmp`); k++; continue; }
    if (['-exec', '-execdir', '-ok', '-okdir'].includes(a)) {
      const sub = [];
      for (k++; k < args.length && ![';', '+'].includes(args[k]); k++) sub.push(args[k]);
      if (!sub.length) refuse(`find ${a} with no command`);
      // {} stands for the files found, which sit under the start paths.
      for (const s of starts) { const w = sub.map((x) => x.split('{}').join(s)); checkCommand(commandName(w[0]), w.slice(1), ctx); }
    }
  }
}

function checkGit(args, ctx) {
  let k = 0;
  while (k < args.length && args[k].startsWith('-')) {
    const a = args[k];
    if (/^-c|^--config/.test(a)) refuse('git -c (it can change what a command does)');
    if (['-C', '--git-dir', '--work-tree', '--namespace'].includes(a)) k += 2;
    else if (/^--(git-dir|work-tree|namespace)=/.test(a) || ['--no-pager', '-P', '--paginate', '-p', '--no-optional-locks', '--literal-pathspecs', '--no-replace-objects'].includes(a)) k++;
    else refuse(`git ${a}`);
  }
  const sub = args[k], rest = args.slice(k + 1);
  for (let j = 0; j < rest.length; j++) {
    const m = rest[j].match(/^--output(?:=([\s\S]*))?$/);
    if (m) { const f = m[1] ?? rest[j + 1]; if (!scratch(f, ctx)) refuse(`git ${sub} --output ${shown(f)} (only /tmp is writable)`); }
    if (sub === 'grep' && /^(-O|--open-files-in-pager)/.test(rest[j])) refuse('git grep -O (it runs a pager program)');
    if (/^--(upload-pack|receive-pack|exec)(=|$)/.test(rest[j])) refuse(`git ${sub} ${rest[j]} (it runs a program)`);
    if (/^--set-upstream$/.test(rest[j])) refuse(`git ${sub} --set-upstream (it changes branch config)`);
    if (/^--(depth|deepen|shallow-since|shallow-exclude|unshallow|refetch)(=|$)/.test(rest[j])) refuse(`git ${sub} ${rest[j]} (it rewrites local history)`);
  }
  if (!sub || GIT_READ.has(sub)) return;
  if (sub === 'branch') {
    const listing = rest.includes('--list') || rest.includes('-l');
    for (let j = 0; j < rest.length; j++) {
      const a = rest[j];
      if (['--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--sort', '--format'].includes(a)) { j++; continue; }
      if (/^(--show-current|-a|-r|--all|--remotes|-v|-vv|--verbose|--list|-l|--color|--no-color|--(format|contains|no-contains|merged|no-merged|points-at|sort)=.*)$/.test(a)) continue;
      if (listing && !a.startsWith('-')) continue; // patterns after --list
      refuse(`git branch ${a}`);
    }
    return;
  }
  if (sub === 'tag') {
    if (rest.some((a) => /^(-[a-zA-Z]*[dfasumF]|--(delete|force|annotate|sign|local-user|message|file|create-reflog))/.test(a) && !/^--(sort|format|contains|no-contains|merged|no-merged|points-at|column|color)/.test(a))) refuse('git tag that makes or deletes a tag');
    if (!rest.length || rest.includes('-l') || rest.includes('--list') || rest.every((a, j) => a.startsWith('-') || /^--(contains|no-contains|merged|no-merged|points-at|sort|format)$/.test(rest[j - 1] ?? ''))) return;
    refuse('git tag that makes a tag');
  }
  if (sub === 'fetch') { if (rest.some((a) => a.includes(':') || a.startsWith('+') || /^(--prune|-p|--update-head-ok|--refmap.*)$/.test(a))) refuse('git fetch into a local branch'); return; }
  if (sub === 'remote') { const r = rest.filter((a) => !['-v', '--verbose'].includes(a)); if (!r.length || ['show', 'get-url'].includes(r[0])) return; }
  if (sub === 'archive') {
    for (let j = 0; j < rest.length; j++) { const m = rest[j].match(/^-o([\s\S]*)$/); if (m && !scratch(m[1] || rest[j + 1], ctx)) refuse('git archive -o outside /tmp'); }
    return;
  }
  if (sub === 'config' && rest.some((a) => ['--get', '--get-all', '--list', '-l', '--get-regexp'].includes(a))
    && !rest.some((a) => /^(--(add|unset|unset-all|replace-all|rename-section|remove-section|edit|file|blob)|-e|-f)$/.test(a))) return;
  if (sub === 'worktree' && rest[0] === 'list') return;
  if (sub === 'stash' && ['list', 'show'].includes(rest[0])) return;
  if (sub === 'notes' && ['list', 'show'].includes(rest[0])) return;
  if (sub === 'reflog' && (rest.length === 0 || ['show'].includes(rest[0]) || rest[0].startsWith('-'))) return;
  refuse(`git ${sub} changes the repo or its history`);
}

// Read-only gh: views, lists, checks and diffs; never api, download or anything that acts.
const GH_READ = { run: ['view', 'list', 'watch'], pr: ['view', 'checks', 'diff', 'list', 'status'], issue: ['view', 'list', 'status'],
  release: ['view', 'list'], repo: ['view'], workflow: ['view', 'list'], auth: ['status'], search: null };
function checkGh(args) {
  const [area, action] = args;
  if (['--version', 'version'].includes(area)) return;
  if (area in GH_READ && (GH_READ[area] === null || GH_READ[area].includes(action))) return;
  refuse(`gh ${area ?? ''} ${action ?? ''} (only gh views, lists, checks and diffs)`);
}

function checkNode(args, ctx) {
  const testMode = args.includes('--test');
  let k = 0;
  for (; k < args.length && args[k].startsWith('-'); k++) {
    const a = args[k];
    if (/^--test-reporter-destination=/.test(a)) { const f = a.split('=')[1]; if (!['stdout', 'stderr'].includes(f) && !scratch(f, ctx)) refuse('node --test-reporter-destination outside /tmp'); continue; }
    if (/^(--test|--test-only|--test-force-exit|--no-warnings|--trace-warnings|--trace-uncaught|--enable-source-maps|--test-(name|skip)-pattern=.*|--test-concurrency=\d+|--test-timeout=\d+|--test-reporter=[\w-]+|--version|-v|--check|-c|--experimental-[\w-]+)$/.test(a)) continue;
    refuse(`node ${a} (only tests, scripts/test_*.js, the repo's hook scripts, and probes under /tmp)`);
  }
  if (testMode) {
    for (const p of args.slice(k)) if (!/^tests\/[\w/.*-]*$/.test(repoPath(p) ?? '') && !scratch(p, ctx)) refuse(`node --test ${shown(p)} (only tests/ and /tmp)`);
    return;
  }
  const script = args[k];
  if (script === undefined && args.length) return; // --version, --check
  if (script && (scratch(script, ctx) || /^(\.claude\/hooks\/[\w.-]+\.mjs|scripts\/test_[\w-]+\.js|tests\/[\w/.-]+\.test\.mjs)$/.test(repoPath(script) ?? ''))) return;
  refuse(`node ${shown(script ?? '')} (only tests, scripts/test_*.js, the repo's hook scripts, and probes under /tmp)`);
}

function checkRunner(cmd, args, ctx) {
  let k = 0;
  for (; k < args.length && args[k].startsWith('-'); k++) {
    if (['-c', '--call', '--node-options', '--shell'].includes(args[k].split('=')[0])) refuse(`${cmd} ${args[k]} (it runs a shell command)`);
    if (args[k] === '--') { k++; break; }
    if (['--prefix', '-C', '--dir', '-p', '--package', '-w', '--workspace'].includes(args[k])) k++;
  }
  const pkg = args[k] || '';
  const rest = args.slice(k + 1).filter((a) => a !== '--');
  const name = pkg.replace(/^(@[^/@]+\/)?([^@]+)(@.*)?$/, '$1$2');
  if (!pkg && args.some((a) => ['--version', '-v'].includes(a))) return;
  if (name === 'playwright' || name === '@playwright/test') {
    if (['--version', '-V'].includes(rest[0])) return;
    if (['screenshot', 'pdf'].includes(rest[0])) {
      const { opts, pos } = getopt(rest.slice(1), ['device', 'viewport-size', 'wait-for-selector', 'wait-for-timeout', 'b', 'browser', 'color-scheme', 'geolocation', 'lang', 'proxy-server', 'timezone', 'user-agent', 'load-storage', 'save-storage', 'save-har', 'save-har-glob', 'timeout', 'paper-format', 'channel']);
      if (values(opts, 'save-storage', 'save-har').some((f) => !scratch(f, ctx))) refuse('playwright saving outside /tmp');
      if (pos.length < 2 || !scratch(pos[pos.length - 1], ctx)) refuse(`playwright ${rest[0]} into a file outside /tmp`);
      return;
    }
    refuse(`playwright ${rest[0] ?? ''} (only screenshot and pdf into /tmp)`);
  }
  refuse(`${cmd} ${pkg} (not on the read-only list)`);
}

// curl: an allow-list of options; anything that sends data or writes outside /tmp is refused.
const CURL_VAL = ['H', 'header', 'A', 'user-agent', 'e', 'referer', 'm', 'max-time', 'connect-timeout', 'retry', 'retry-delay', 'retry-max-time', 'max-redirs', 'r', 'range', 'cacert', 'capath', 'x', 'proxy', 'U', 'proxy-user', 'u', 'user', 'b', 'cookie', 'resolve', 'connect-to', 'url', 'limit-rate', 'max-filesize', 'w', 'write-out', 'oauth2-bearer', 'C', 'continue-at', 'z', 'time-cond'];
const CURL_FLAG = ['s', 'silent', 'S', 'show-error', 'L', 'location', 'f', 'fail', 'fail-with-body', 'I', 'head', 'i', 'include', 'v', 'verbose', 'k', 'insecure', 'g', 'globoff', 'G', 'get', 'compressed', '4', '6', 'N', 'no-buffer', '#', 'progress-bar', 'http1.1', 'http2', 'http1.0', 'location-trusted', 'no-progress-meter', 'retry-all-errors', 'retry-connrefused', 'ipv4', 'ipv6', 'Z', 'parallel', 'ssl-reqd', 'no-keepalive', 'raw', 'path-as-is', 'q', 'disable', 'create-dirs'];
const CURL_WRITE = ['o', 'output', 'D', 'dump-header', 'c', 'cookie-jar', 'trace', 'trace-ascii', 'stderr', 'etag-save', 'libcurl', 'output-dir'];
function checkCurl(args, ctx) {
  const { opts } = getopt(args, [...CURL_VAL, ...CURL_WRITE, 'X', 'request']);
  for (const [n, v] of opts) {
    if (n === 'X' || n === 'request') { if (!/^(GET|HEAD)$/i.test(v ?? '')) refuse(`curl ${v || 'with a method'}`); continue; }
    if (CURL_WRITE.includes(n)) { if (!out(v, ctx)) refuse(`curl writes ${shown(v)} (only /tmp is writable)`); continue; }
    if ((n === 'w' || n === 'write-out') && /%output\{/.test(v ?? '')) refuse('curl -w %output');
    if (CURL_VAL.includes(n) || CURL_FLAG.includes(n)) continue;
    refuse(`curl ${n.length === 1 ? '-' : '--'}${n} (it sends data, writes a file or isn't on the read-only list)`);
  }
}

const WGET_VAL = ['header', 'U', 'user-agent', 'T', 'timeout', 't', 'tries', 'w', 'wait', 'max-redirect', 'read-timeout', 'connect-timeout', 'user', 'password'];
const WGET_FLAG = ['q', 'quiet', 'nv', 'no-verbose', 'S', 'server-response', 'spider', 'no-check-certificate', '4', '6', 'inet4-only', 'inet6-only', 'show-progress', 'no-cache', 'v', 'verbose'];
function checkWget(args, ctx) {
  const { opts } = getopt(args, [...WGET_VAL, 'O', 'output-document', 'o', 'output-file', 'a', 'append-output']);
  let target = has(opts, 'spider');
  for (const [n, v] of opts) {
    if (n === 'O' || n === 'output-document') { if (!out(v, ctx)) refuse(`wget writes ${shown(v)} (only /tmp is writable)`); target = true; continue; }
    if (['o', 'output-file', 'a', 'append-output'].includes(n)) { if (!scratch(v, ctx)) refuse('wget logs outside /tmp'); continue; }
    if (WGET_VAL.includes(n) || WGET_FLAG.includes(n)) continue;
    refuse(`wget ${n.length === 1 ? '-' : '--'}${n} (it sends data, writes a file or isn't on the read-only list)`);
  }
  if (!target) refuse('wget without -O (it writes into the current directory)');
}

function checkTar(args, ctx) {
  const first = args[0] && /^[a-zA-Z]+$/.test(args[0]) ? args[0] : '';
  const letters = first + args.filter((a) => /^-[a-zA-Z]+$/.test(a)).map((a) => a.slice(1)).join('');
  const long = args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')[0]);
  if (/[IF]/.test(letters) || long.some((l) => ['to-command', 'use-compress-program', 'checkpoint-action', 'info-script', 'new-volume-script', 'rmt-command', 'rsh-command'].includes(l))) refuse('tar running another program');
  const extract = /x/.test(letters) || long.some((l) => ['extract', 'get'].includes(l));
  const create = /[cruA]/.test(letters) || long.some((l) => ['create', 'append', 'update', 'catenate', 'concatenate', 'delete'].includes(l));
  for (let k = 0; k < args.length; k++) {
    const m = args[k].match(/^--(index-file|listed-incremental|volno-file)(?:=(.*))?$/);
    if (m && !scratch(m[2] ?? args[k + 1], ctx)) refuse(`tar --${m[1]} outside /tmp`);
  }
  if (/g/.test(letters)) refuse('tar -g (it writes a snapshot file)');
  if (!extract && !create) return; // lists
  const dirs = [], files = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    const d = a.match(/^(?:-C|--directory)(?:=(.*))?$/); if (d) dirs.push(d[1] ?? args[k + 1]);
    const f = a.match(/^--file(?:=(.*))?$/); if (f) files.push(f[1] ?? args[k + 1]);
    if ((k === 0 && a === first && /f/.test(a)) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a)) files.push(args[k + 1]);
  }
  if (extract && (!dirs.length || dirs.some((d) => !scratch(d, ctx)))) refuse('tar extracting outside /tmp');
  if (create && (!files.length || files.some((f) => !out(f, ctx)))) refuse('tar writing an archive outside /tmp');
}

export function verdict(command) {
  try {
    const src = String(command ?? '');
    if (src.includes('\0')) refuse('a NUL character');
    const tmpdir = process.env.TMPDIR || '';
    const ctx = { vars: new Set(), env: { tmpdir }, cond: false, shared: { subs: [], mktemp: new Map() } };
    if (tmpdir && scratchPath(tmpdir)) ctx.vars.add('TMPDIR');
    checkLine(src, ctx);
    return null;
  } catch (e) {
    if (e instanceof Refuse) return e.message;
    return `the hook couldn't read this command (${e.message})`;
  }
}
