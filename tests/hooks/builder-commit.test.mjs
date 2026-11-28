// AST-46#3: with the guard in place the Builder can still commit locally, and the site check still
// passes under both hooks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentHookCommand, guardCommand, runHook, ROOT } from './helpers.mjs';

test('AST-46#3 the builder has no read-only hook; only the repo-wide guard applies', () => {
  assert.equal(agentHookCommand('builder'), null);
});

test('AST-46#3 builder commits locally through the guard', () => {
  const repo = mkdtempSync(join('/tmp', 'ast46-commit-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'claude/ast-46');
  git('config', 'user.email', 'builder@example.invalid');
  git('config', 'user.name', 'Builder');
  writeFileSync(join(repo, 'page.html'), '<p>hi</p>\n');
  const cmd = 'git add -A && git commit -q -m "AST-46: guard denies git push, gh pr merge and wrangler deploy"';
  const r = runHook(guardCommand(), cmd, { cwd: repo });
  assert.equal(r.status, 0, r.stderr);
  const run = spawnSync('sh', ['-c', cmd], { cwd: repo, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git('rev-list', '--count', 'HEAD').trim(), '1');
  // The same command from the Reviewer is refused.
  assert.equal(runHook(agentHookCommand('reviewer'), cmd, { cwd: repo }).status, 2);
});

test('AST-46#3 python3 scripts/check_site.py passes, and both hooks allow it', () => {
  const cmd = 'python3 scripts/check_site.py';
  assert.equal(runHook(guardCommand(), cmd).status, 0);
  assert.equal(runHook(agentHookCommand('reviewer'), cmd).status, 0);
  const run = spawnSync('sh', ['-c', cmd], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /Site audit passed/);
});
