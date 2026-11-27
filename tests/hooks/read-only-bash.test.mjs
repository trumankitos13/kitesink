// AST-46#1: the Reviewer's frontmatter runs read-only-bash; a write command from the Reviewer is
// refused, while reads, searches, the site checks and tests are allowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentHookCommand, guardCommand, runHook } from './helpers.mjs';

const hook = agentHookCommand('reviewer');

test('AST-46#1 the reviewer agent file wires read-only-bash.mjs as a PreToolUse Bash hook', () => {
  assert.match(hook ?? '', /\.claude\/hooks\/read-only-bash\.mjs/);
});

const WRITES = [
  'echo x > notes.txt', 'echo x >> README.md', 'printf x > public/index.html', 'cat a 2> err.log', 'rm README.md',
  'rm -rf public', 'touch public/new.html', 'mkdir drafts', 'mv README.md x', 'cp README.md x', 'tee notes.txt',
  'echo x | tee -a README.md', 'git commit -m x', 'git add .', 'git checkout -- README.md', 'git stash', 'git reset --hard',
  'git push', 'git tag v1', 'git branch -D x', "sed -i '' s/a/b/ README.md", 'sed -i s/a/b/ public/index.html',
  "sed 's/a/b/w out.txt' README.md", 'python3 scripts/build_music.py', 'python3 scripts/build_fitness.py',
  "python3 -c 'open(\"x\", \"w\").write(\"y\")'", "node -e 'require(\"fs\").writeFileSync(\"x\", \"y\")'",
  "perl -pi -e 's/a/b/' README.md", "awk '{ print > \"out\" }' README.md", 'curl -o page.html https://kitesink.com/',
  'wget https://kitesink.com/', 'npx wrangler dev', 'wrangler deploy', 'gh pr merge 1', 'gh pr comment 1 -b x',
  'find . -name x -delete', 'chmod +x scripts/check_site.py', 'ln -s /tmp/x y', "bash -c 'rm README.md'",
  'KS_CROSSREF_CACHE=cache python3 scripts/validate_fitness.py', 'npm install', 'echo x > /tmp/../Users/x',
];
const READS = [
  'cat README.md', 'ls -la public', 'grep -rn kitesink public | head -5', 'rg -n "wrangler" docs', 'wc -l public/*.html',
  'git status', 'git diff origin/main...HEAD', 'git log --oneline -5', 'git show HEAD:README.md', 'find . -name "*.html"',
  'python3 scripts/check_site.py', 'python3 ./scripts/check_site.py', 'python3 scripts/build_fitness.py --check',
  'python3 scripts/build_music.py --check', 'python3 scripts/validate_music.py --offline', 'node scripts/test_fitness.js',
  'node --test tests/', 'echo probe > /tmp/ast46-probe.txt', 'sed -n 1,5p README.md', 'jq . public/fitness/ids.json',
  'gh pr view 3', 'gh pr diff 3', 'head -20 wrangler.jsonc', 'python3 -m http.server 8000 -d public',
];

for (const cmd of WRITES) {
  test(`AST-46#1 reviewer hook refuses a write: ${JSON.stringify(cmd)}`, () => {
    const r = runHook(hook, cmd);
    assert.equal(r.status, 2, `expected a refusal, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /^Blocked for the read-only Reviewer: /);
    // Backstop: the repo-wide guard refuses it too when Claude Code names the agent as the reviewer
    // (it skips frontmatter hooks while the folder isn't trusted).
    const g = runHook(guardCommand(), cmd, { agentType: 'reviewer' });
    assert.equal(g.status, 2, g.stderr);
    assert.match(g.stderr, /^Blocked (for the read-only Reviewer|by \.claude\/hooks\/guard-bash\.mjs)/);
  });
}

test('AST-46#1 the repo-wide guard applies the read-only check only to the reviewer', () => {
  assert.equal(runHook(guardCommand(), 'echo x > /tmp/ast46-ok && touch notes.txt', { agentType: 'builder' }).status, 0);
  assert.equal(runHook(guardCommand(), 'touch notes.txt').status, 0);
  assert.match(runHook(guardCommand(), 'touch notes.txt', { agentType: 'reviewer' }).stderr, /^Blocked for the read-only Reviewer/);
});

// Claude Code may name the agent with another case or a plugin prefix; the backstop still applies.
for (const agentType of ['Reviewer', 'REVIEWER', 'kitesink:reviewer', 'Some-Plugin:Reviewer', ' reviewer ']) {
  test(`AST-46#1 the repo-wide guard treats agent_type ${JSON.stringify(agentType)} as the read-only reviewer`, () => {
    const r = runHook(guardCommand(), 'touch notes.txt', { agentType });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /^Blocked for the read-only Reviewer/);
  });
}
for (const agentType of ['builder', 'kitesink:builder', 'reviewer-helper', 'reviewer:builder']) {
  test(`AST-46#1 the repo-wide guard leaves agent_type ${JSON.stringify(agentType)} to the deny list only`, () => {
    assert.equal(runHook(guardCommand(), 'touch notes.txt', { agentType }).status, 0);
  });
}

for (const cmd of READS) {
  test(`AST-46#1 reviewer hook allows a read: ${JSON.stringify(cmd)}`, () => {
    const r = runHook(hook, cmd);
    assert.equal(r.status, 0, r.stderr);
    // The repo-wide guard runs for the reviewer too, and lets every read through.
    assert.equal(runHook(guardCommand(), cmd, { agentType: 'reviewer' }).status, 0);
  });
}

test('AST-46#1 reviewer hook fails closed on input it cannot read', () => {
  assert.equal(runHook(hook, undefined).status, 2);
});
