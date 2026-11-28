// AST-46#2 (Review 2 HOLD): the Bash tool runs commands in /bin/zsh, and a variable could be set in a
// way the guard didn't read: a name filled in at run time (export "$v"=…), zsh-only forms (${HOME::=…},
// ${(P)v::=…}, ${(e)x}, *(e:…:) and *(+f) glob qualifiers), arithmetic that evaluates a value such as
// HOME=5, zsh's tables (functions[], commands[], options[]) and {NAME}>file. Each form here is shown
// live in zsh with a harmless marker, then the same form with git is run through the hook from
// .claude/settings.json and must be refused. AST-46#3: ordinary builder git still passes and runs in zsh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { guardCommand, runHook } from './helpers.mjs';

const hook = guardCommand();
const ZSH = '/bin/zsh';
const refused = (cmd) => {
  const r = runHook(hook, cmd);
  assert.equal(r.status, 2, `expected a refusal, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /^Blocked by \.claude\/hooks\/guard-bash\.mjs: /);
  return r.stderr;
};

// The forms quoted in Review 2, verbatim or completed into a full line. Each exited 0 on the old guard.
const REVIEW_2 = [
  `v=GIT_EDITOR; export "$v"='git push origin HEAD:main;:'; git commit --allow-empty`,
  `v=GIT_CONFIG_PARAMETERS; export "$v"="'core.fsmonitor=git push origin HEAD:main'"; git status`,
  `v=GIT_SSH_COMMAND; declare -x "$v=sh -c 'git push origin HEAD:main'"; git fetch`,
  `v=HOME; typeset -x "$v"=/tmp/d; git status`,
  `f() { local v=HOME; local -x "$v"=/tmp/d; git status; }; f`,
  'x=; export H${x}OME=/tmp/d; git status',
  'x=; H${x}OME=/tmp/d git status',
  'export $(echo HOME)=/tmp/d; git status',
  '$(echo HOME)=/tmp/d git status',
  `v=HOME; printf -v "$v" %s /tmp/d; git status`,
  `v=HOME; read "$v" <<< /tmp/d; git status`,
  `v=HOME; declare -n r="$v"; r=/tmp/d; git status`,
  'v=HOME; (( $v = 5 )); git status',
  ': ${HOME::=/tmp/d}; git status',
  'v=HOME; : ${(P)v::=/tmp/d}; git status',
  "ls -d /tmp/*(e:'git push origin HEAD':)",
  'print -r -- /tmp/*(+f)',
  "x='$(git push origin HEAD)'; echo ${(e)x}",
];

// The rest of the class: every other way found to set a variable git reads, or to make zsh run code.
const CLASS = [
  // a name filled in at run time, through each builtin that takes one
  `v=HOME; unset "$v"; git status`, `v=HOME; let "$v=5"; git status`, `v=HOME; : \${!v:=/tmp/d}; git status`,
  `v=HOME; print -v "$v" /tmp/d; git status`, `v=HOME; getopts a "$v"; git status`, `v=HOME; export "$v"; git status`,
  // arithmetic that evaluates a value such as HOME=5 (zsh and bash)
  `v='HOME=5'; (( v )); git status`, `v='HOME=5'; echo $((v)); git status`, `v='HOME=5'; echo $[v]; git status`,
  `v='HOME=5'; let v; git status`, `v='HOME=5'; [[ v -eq 5 ]]; git status`, `v='HOME=5'; a=(x); echo \${a[v]}; git status`,
  `v='HOME=5'; echo $x[v]; git status`, `v='HOME=5'; echo \${x:v}; git status`, `v='HOME=5'; printf %d v; git status`,
  `v='HOME=5'; integer i=v; git status`, `v='HOME=5'; typeset -i i=v; git status`, `v='HOME=5'; SECONDS=v; git status`,
  `v='HOME=5'; for ((i=v; i<0; i++)); do :; done; git status`, `v='HOME=5'; repeat v true; git status`,
  `v='HOME=5'; a[v]=1; git status`, `v='HOME=5'; f() { return v; }; f; git status`, `read SECONDS < /tmp/f; git status`,
  // zsh tables, prompts, startup files and other variables that hold code or command paths
  `functions[f]='git push origin HEAD'; f`, 'commands[x]=/tmp/d/git; x status', `aliases[gp]='git push'`,
  `options[globsubst]=on; x='*(e:"git push":)'; echo $x`, 'chpwd_functions=(f)', `PS4='$(git push origin HEAD)'; set -x; true`,
  'BASH_ENV=/tmp/x.sh bash -c true', 'ZDOTDIR=/tmp/z zsh -c true', 'ENV=/tmp/x.sh sh -i', 'fpath=(/tmp/f); autoload f; f',
  'CDPATH=/tmp/d; cd scripts; ./x.sh', 'hash -d nd=/tmp/d; cd ~nd; ./x.sh', 'hash git=/tmp/d/git; git status',
  'PATH=/tmp/d:$PATH git status', 'path=(/tmp/d $path); git status', 'LD_PRELOAD=/tmp/x.so git status',
  'DYLD_INSERT_LIBRARIES=/tmp/x.dylib git status', 'git status {HOME}>/dev/null', 'coproc HOME { cat; }; git status',
  'read -A HOME < /tmp/f; git status', 'set -A HOME /tmp/d; git status', 'for x HOME in a /tmp/d; do :; done; git status',
  'zstyle :x y /tmp/d; zstyle -s :x y HOME; git status', `zstyle -e :x y 'git push'`, 'zparseopts -A HOME a:=x; git status',
  // zsh forms that run code or change how the line is read
  'setopt globsubst', 'set -o globsubst', 'emulate sh -c true', 'zmodload zsh/mapfile', 'enable -f /tmp/x.so push',
  `x='*(e:"git push":)'; echo $~x`, 'x=git; $=x push origin HEAD', '=git push origin HEAD', 'echo =(git push)',
  'for x (a b) git push', `(echo hi)(e:'git push':)`, 'echo ${(l:5:)x}',
  // nested shells read the same way
  `zsh -c 'v=HOME; export "$v"=/tmp/d; git status'`, `bash -c 'v=HOME; (( $v = 5 )); git status'`,
];

for (const cmd of REVIEW_2) test(`AST-46#2 guard refuses the Review 2 form: ${JSON.stringify(cmd)}`, () => refused(cmd));
for (const cmd of CLASS) test(`AST-46#2 guard refuses a variable set where it couldn't read it: ${JSON.stringify(cmd)}`, () => refused(cmd));

test('AST-46#2 guard says why', () => {
  assert.match(refused(`v=HOME; export "$v"=/tmp/d; git status`), /a variable named at run time/);
  assert.match(refused(`v='HOME=5'; (( v )); git status`), /git with arithmetic on a variable \(zsh and bash evaluate/);
  assert.match(refused(': ${HOME::=/tmp/d}; git status'), /an assignment to HOME inside \$\{…\}/);
  assert.match(refused("ls -d /tmp/*(e:'git push':)"), /glob qualifier/);
  assert.match(refused(`functions[f]='git push'; f`), /setting functions/);
  assert.match(refused('zstyle :x y v; zstyle -s :x y v; git status'), /git with the shell builtin zstyle on the same line/);
});

// Each form is live in zsh: run with a marker instead of git, it sets HOME or runs code.
const LIVE = [
  ['export "$v"=', `v=HOME; export "$v"=/tmp/ast46-live; print -r -- $HOME`, /^\/tmp\/ast46-live$/],
  ['typeset -x "$v=…"', `v=HOME; typeset -x "$v=/tmp/ast46-live"; print -r -- $HOME`, /^\/tmp\/ast46-live$/],
  ['read "$v"', `v=HOME; read "$v" <<< /tmp/ast46-live; print -r -- $HOME`, /^\/tmp\/ast46-live$/],
  ['printf -v "$v"', `v=HOME; printf -v "$v" %s /tmp/ast46-live; print -r -- $HOME`, /^\/tmp\/ast46-live$/],
  ['(( $v = 5 ))', 'v=HOME; (( $v = 5 )); print -r -- $HOME', /^5$/],
  ['${HOME::=…}', ': ${HOME::=/tmp/ast46-live}; print -r -- $HOME', /^\/tmp\/ast46-live$/],
  ['${(P)v::=…}', 'v=HOME; : ${(P)v::=/tmp/ast46-live}; print -r -- $HOME', /^\/tmp\/ast46-live$/],
  ['${(e)x}', `x='$(print -r MARK)'; print -r -- \${(e)x}`, /^MARK$/],
  ['(( v )) with v=HOME=5', `v='HOME=5'; (( v )); print -r -- $HOME`, /^5$/],
  ['printf %d v', `v='HOME=5'; printf %d v >/dev/null; print -r -- $HOME`, /^5$/],
  ['SECONDS=v', `v='HOME=5'; SECONDS=v; print -r -- $HOME`, /^5$/],
  ['$x[v]', `v='HOME=5'; x=abc; : $x[v]; print -r -- $HOME`, /^5$/],
  ['{HOME}>file', 'true {HOME}>/dev/null; print -r -- $HOME', /^\d+$/],
  ['functions[f]=', `functions[f]='print -r MARK'; f`, /^MARK$/],
  ['commands[x]=', 'commands[x]=/bin/echo; x MARK', /^MARK$/],
];
const zshOk = existsSync(ZSH);
for (const [what, snippet, expect] of LIVE) {
  test(`AST-46#2 the form ${what} is live in ${ZSH}`, { skip: !zshOk && `${ZSH} not found` }, () => {
    const r = spawnSync(ZSH, ['-fc', snippet], { encoding: 'utf8', env: { ...process.env, HOME: '/tmp/ast46-home' } });
    assert.match(r.stdout.trim(), expect, r.stderr);
  });
}

test(`AST-46#2 zsh glob qualifiers (e:…:) and (+f) run code in ${ZSH}`, { skip: !zshOk && `${ZSH} not found` }, () => {
  const dir = mkdtempSync(join('/tmp', 'ast46-qual-'));
  writeFileSync(join(dir, 'a'), '');
  const e = spawnSync(ZSH, ['-fc', `print -r -- ${dir}/*(e:'print -r MARK-E >&2':)`], { encoding: 'utf8' });
  assert.match(e.stderr, /MARK-E/);
  const f = spawnSync(ZSH, ['-fc', `f() { print -r MARK-F >&2 }; print -r -- ${dir}/*(+f)`], { encoding: 'utf8' });
  assert.match(f.stderr, /MARK-F/);
});

// AST-46#3: the git a builder runs passes the guard and really runs in zsh, in a scratch repo with a
// local bare remote (fetch, merge-base); gh pr create passes the guard (it isn't run).
test('AST-46#3 ordinary builder git passes the guard and runs in zsh', { skip: !zshOk && `${ZSH} not found` }, () => {
  const base = mkdtempSync(join('/tmp', 'ast46-zshgit-'));
  const remote = join(base, 'remote.git');
  const repo = join(base, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'builder@example.invalid');
  git('config', 'user.name', 'Builder');
  git('remote', 'add', 'origin', remote);
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'main']); // test setup only, to a local bare repo
  const steps = [
    'set -euo pipefail; git status --short',
    'git fetch -q origin',
    'git switch -q -c claude/ast-99',
    'echo b > b.txt && git add -A && git commit -q -m "AST-46: b (HOME and PATH in text only)"',
    `git commit -q --allow-empty -m "$(cat <<'EOF'\nAST-46: heredoc message (with parens)\n\nCo-Authored-By: x\nEOF\n)"`,
    'git -c user.email=other@example.invalid commit -q --allow-empty -m "AST-46: -c user"',
    'GIT_EDITOR=true git commit -q --amend --allow-empty',
    'export GIT_EDITOR=true; git commit -q --amend --allow-empty',
    'echo c > c.txt && git stash push -q -u -m ast46-stash && git stash list --format="%gs" | head -1',
    'git stash apply -q && git add -A && git commit -q -m "AST-46: c"',
    'git merge-base HEAD origin/main',
    'git rebase -q origin/main',
    'git diff origin/main...HEAD --stat',
    'git log --oneline -3 | wc -l',
    'git worktree add -q ../wt-ast99 -b claude/ast-99-wt && git worktree list && git worktree remove ../wt-ast99',
    'if git diff --quiet; then echo clean; fi',
    'for f in a.txt b.txt; do git log -1 --format=%s -- "$f"; done',
    'n=$(git rev-list --count HEAD); echo "$n commits"',
    'echo "$HOME" > /dev/null && git status --short',
    'cd "$(git rev-parse --show-toplevel)" && git branch --show-current',
  ];
  for (const cmd of steps) {
    const g = runHook(hook, cmd, { cwd: repo });
    assert.equal(g.status, 0, `guard refused ${cmd}: ${g.stderr}`);
    const run = spawnSync(ZSH, ['-fc', cmd], { cwd: repo, encoding: 'utf8' });
    assert.equal(run.status, 0, `${cmd} failed in zsh: ${run.stderr}`);
  }
  assert.equal(git('branch', '--show-current').trim(), 'claude/ast-99');
  assert.equal(git('rev-list', '--count', 'HEAD').trim(), '5');
  const pr = `gh pr create --base main --title "AST-46: x" --body "$(cat <<'EOF'\nSummary (x)\nEOF\n)"`;
  assert.equal(runHook(hook, pr, { cwd: repo }).status, 0);
});
