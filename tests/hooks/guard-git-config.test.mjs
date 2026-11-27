// AST-46#2 (Review 1 HOLD): git config from variables, --config-env, include files, HOME or
// --exec-path could make an alias push past the guard. The guard now refuses any git subcommand
// that isn't a built-in it knows, and any git on a line that changes where git reads config or which
// program it runs. Ordinary builder git still runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { guardCommand, runHook } from './helpers.mjs';

const hook = guardCommand();

// The six forms from Review 1, each of which exited 0 on the old guard and lets `git p` push.
const REVIEW_1 = [
  'V=push git --config-env=alias.p=V p',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.p GIT_CONFIG_VALUE_0=push git p',
  'GIT_CONFIG_PARAMETERS="\'alias.p=push\'" git p',
  'GIT_CONFIG_GLOBAL=/tmp/f git p',
  'HOME=/tmp/d git p',
  'git -c include.path=/tmp/f p',
  'git --exec-path=/tmp/d p',
];

// The same class reached through a built-in (config can name a program git runs) or another way
// of setting the variable.
const CLASS = [
  'git p', 'git st', 'git Push', 'git lfs ls-files', 'git svn log', 'git filter-branch', 'git-lfs ls-files',
  'V="git push" git --config-env=core.fsmonitor=V status', 'git --config-env alias.p=V p',
  'GIT_CONFIG_PARAMETERS="\'core.fsmonitor=git push\'" git status', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0="git push" git status',
  'GIT_CONFIG_GLOBAL=/tmp/f git status', 'GIT_CONFIG_SYSTEM=/tmp/f git status', 'HOME=/tmp/d git status', 'XDG_CONFIG_HOME=/tmp/x git status',
  'GIT_EXEC_PATH=/tmp/d git status', 'GIT_SSH_COMMAND="sh -c \'git push\'" git fetch', 'EDITOR="git push #" git commit',
  'VISUAL="git push #" git commit', 'GIT_EDITOR="git push #" git commit', 'GIT_SEQUENCE_EDITOR="git push #" git rebase -i HEAD~1',
  'env HOME=/tmp/d git status', 'nohup env GIT_CONFIG_GLOBAL=/tmp/f git status', 'export HOME=/tmp/d; git status',
  'export HOME=/tmp/d && git status', 'HOME=/tmp/d; export HOME; git status', 'declare -x GIT_CONFIG_GLOBAL=/tmp/f; git status',
  'read -r HOME < /tmp/h; git status', 'printf -v HOME %s /tmp/d; git status', 'declare -n r=HOME; r=/tmp/d; git status',
  'for HOME in /tmp/d; do git status; done', ': ${XDG_CONFIG_HOME:=/tmp/x}; git status', '(( HOME = 1 )); git status',
  'f() { git status; }; export HOME=/tmp/d; f', 'git status; export GIT_CONFIG_GLOBAL=/tmp/f',
  "bash -c 'export HOME=/tmp/d; git status'", 'HOME=/tmp/d bash -c "git status"',
  'git -c core.fsmonitor="git push" status', 'git -c core.hooksPath=/tmp/h commit -m x', 'git -c core.sshCommand="git push" fetch',
  'git -c core.editor="git push #" commit', 'git -c alias.p=push p', 'git -c "$KEY=x" status',
  'git config core.fsmonitor "git push" && git status', 'git config --global alias.p push', 'git config set include.path /tmp/f',
  'git config --add core.hooksPath /tmp/h', 'git config -e', 'git config --rename-section x core',
  'git fetch --upload-pack="git push" origin', 'git clone -u "git push" origin x', 'git clone --config core.fsmonitor=x origin x',
  'git clone -c core.fsmonitor=x origin x', 'git init --template=/tmp/t x', 'git ls-remote --upload-pack="git push" origin',
  'git archive --remote=origin --exec="git push" HEAD', 'git grep -O"git push" x', 'git difftool -x "git push"',
  'git fetch "$OPT" origin',
];

for (const cmd of REVIEW_1) {
  test(`AST-46#2 guard refuses the Review 1 alias bypass: ${JSON.stringify(cmd)}`, () => {
    const r = runHook(hook, cmd);
    assert.equal(r.status, 2, `expected a refusal, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /^Blocked by \.claude\/hooks\/guard-bash\.mjs: /);
  });
}

for (const cmd of CLASS) {
  test(`AST-46#2 guard refuses git with changed config or programs: ${JSON.stringify(cmd)}`, () => {
    const r = runHook(hook, cmd);
    assert.equal(r.status, 2, `expected a refusal, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /^Blocked by \.claude\/hooks\/guard-bash\.mjs: /);
  });
}

test('AST-46#2 guard names why a git alias and a config variable are refused', () => {
  assert.match(runHook(hook, 'git p').stderr, /git p, which isn't a built-in git command/);
  assert.match(runHook(hook, 'HOME=/tmp/d git status').stderr, /git with HOME set on the same line/);
  assert.match(runHook(hook, 'git -c include.path=/tmp/f status').stderr, /git -c include\.path \(only a short list of harmless keys/);
});

// Ordinary builder git: each line passes the guard, then really runs in a scratch repo.
test('AST-46#2 ordinary builder git (add, commit, status, diff, log, switch, worktree, rebase) still passes and runs', () => {
  const base = mkdtempSync(join('/tmp', 'ast46-gitwork-'));
  const repo = join(base, 'repo');
  mkdirSync(repo);
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'builder@example.invalid');
  git('config', 'user.name', 'Builder');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  const steps = [
    'git status --short',
    'git add -A',
    'git commit -q -m "AST-46: a (mentions HOME and GIT_CONFIG_GLOBAL in text only)"',
    'git switch -q -c claude/ast-99',
    'echo b > b.txt && git add b.txt && git commit -q -m "AST-46: b"',
    'git switch -q main',
    'echo c > c.txt && git add c.txt && git commit -q -m "AST-46: c"',
    'git switch -q claude/ast-99',
    'git rebase -q main',
    'git diff main...HEAD --stat',
    'git diff --cached',
    'git log --oneline -3',
    'git worktree add -q ../wt-ast99 -b claude/ast-99-wt',
    'git worktree list',
    'git worktree remove ../wt-ast99',
    'GIT_EDITOR=true git commit -q --amend',
    'git -c user.email=other@example.invalid commit -q --allow-empty -m "AST-46: empty"',
    'git config user.name Builder2',
    'git config --get user.name',
    'git -C . log -1 --format=%s',
    'echo "$HOME" > /dev/null && git status',
  ];
  for (const cmd of steps) {
    const g = runHook(hook, cmd, { cwd: repo });
    assert.equal(g.status, 0, `guard refused ${cmd}: ${g.stderr}`);
    const run = spawnSync('sh', ['-c', cmd], { cwd: repo, encoding: 'utf8' });
    assert.equal(run.status, 0, `${cmd} failed: ${run.stderr}`);
  }
  assert.equal(git('rev-list', '--count', 'HEAD').trim(), '4');
  assert.equal(git('log', '-1', '--format=%s', 'HEAD~2').trim(), 'AST-46: c');
});
