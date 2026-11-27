// AST-46#2: .claude/settings.json runs guard-bash for every agent; it refuses wrangler deploy,
// git push and gh pr merge in their obvious variants, and lets ordinary work through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardCommand, runHook, ROOT } from './helpers.mjs';

const hook = guardCommand();
const scratch = mkdtempSync(join('/tmp', 'ast46-guard-'));

const script = join(scratch, 'ship.sh');
writeFileSync(script, '#!/bin/sh\necho shipping\ngit push origin HEAD\n');
chmodSync(script, 0o755);
const noShebang = join(scratch, 'plain');
writeFileSync(noShebang, 'npx wrangler deploy\n');
chmodSync(noShebang, 0o755);
const pkg = mkdtempSync(join(tmpdir(), 'ast46-pkg-'));
writeFileSync(join(pkg, 'package.json'), JSON.stringify({ scripts: { ship: 'npm run build && wrangler deploy', build: 'echo build', postinstall: 'git push', test: 'node --test' } }));

const PUSH = [
  'git push', 'git push origin claude/ast-46', 'git push --force origin main', 'git push -u origin HEAD',
  'git -C /tmp push', 'git -c push.default=current push', 'git --no-pager push', 'GIT_TRACE=1 git push',
  'FOO=1 BAR=2 git push', 'env git push', 'env -i PATH=/usr/bin git push', 'env -S "git push"', '/usr/bin/git push',
  '\\git push', '"git" push', "g''it pu\"\"sh", "$'\\x67it' push", '{git,push}', 'git pu\\sh', 'git \\\npush',
  'echo a; git push', 'true && git push', 'false || git push', 'ls | git push', 'git push 2>&1 | tail -3',
  '(git push)', '{ git push; }', 'echo $(git push)', 'echo `git push`', 'cat <(git push)',
  "bash -c 'git push'", 'sh -c "git push"', "bash -lc 'git push'", "zsh -c 'git push'", "bash -e -c 'git push'",
  "eval 'git push'", 'eval git push', 'echo x | xargs git push', 'xargs -n1 git push', 'find . -exec git push \\;',
  'timeout 5 git push', 'nohup git push', 'nice -n 5 git push', 'command git push', 'exec git push', 'sudo git push',
  'stdbuf -oL git push', 'caffeinate -i git push', 'script -q /dev/null git push', 'watch git push', 'time git push',
  '! git push', 'if true; then git push; fi', 'for b in a; do git push; done', 'while true; do git push; done',
  'f() { git push; }; f', 'r() { "$@"; }; r git push', 'function f { git push; }',
  '$(git --exec-path)/git-push origin', 'git-push origin', 'git subtree push --prefix=x origin y', 'git send-pack origin',
  "echo 'git push' | bash", 'bash <<EOF\ngit push\nEOF', 'bash -s < /tmp/x', 'sh', "trap 'git push' EXIT",
  'git -c alias.p=push p', "git -c 'alias.p=!git push' p", 'git config alias.p push && git p',
  '$G push', '"$GIT" push origin', 'x=git; $x push', "python3 -c 'import os; os.system(\"git push\")'",
  "node -e 'require(\"child_process\").execSync(\"git push\")'", "awk 'BEGIN{system(\"git push\")}'",
  `bash ${script}`, `sh ${script}`, `source ${script}`, `. ${script}`, script, noShebang,
  'bash /tmp/ast46-does-not-exist.sh', 'cat > /tmp/ast46-new.sh <<EOF\ngit push\nEOF\nbash /tmp/ast46-new.sh',
];
const MERGE = [
  'gh pr merge', 'gh pr merge 12 --squash --auto', 'gh -R owner/repo pr merge 1', 'gh pr --repo owner/repo merge 1',
  'gh pr update-branch 3', 'gh api -X PUT repos/o/r/pulls/1/merge', 'gh api repos/o/r/pulls/1/merge -f merge_method=squash',
  'gh api --method=PUT repos/o/r/pulls/1/merge', "gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'",
  'gh api repos/o/r/git/refs/heads/main -X PATCH -f sha=abc', 'gh m 12', 'gh alias set m "pr merge"',
  "bash -c 'gh pr merge 1'", 'echo 1 | xargs gh pr merge', 'env GH_REPO=o/r gh pr merge 1',
  'curl -X PUT https://api.github.com/repos/o/r/pulls/1/merge', 'curl -d @b.json https://api.github.com/repos/o/r/merges',
  'curl -sX PUT -H "Authorization: x" https://api.github.com/repos/o/r/pulls/1/merge', 'wget --post-data=x https://api.github.com/x',
  'gh repo sync', 'gh release create v1', 'gh workflow run deploy.yml',
];
const DEPLOY = [
  'wrangler deploy', 'wrangler publish', 'npx wrangler deploy', 'npx -y wrangler@4 deploy', 'npx wrangler@latest publish',
  'npx --package wrangler wrangler deploy', 'npx -p wrangler wrangler deploy', 'pnpm wrangler deploy', 'pnpm dlx wrangler deploy',
  'pnpm exec wrangler deploy', 'yarn wrangler deploy', 'yarn dlx wrangler deploy', 'bunx wrangler deploy', 'bun x wrangler deploy',
  'npm exec wrangler -- deploy', 'npm exec -- wrangler deploy', "npx -c 'wrangler deploy'", 'node_modules/.bin/wrangler deploy',
  'node node_modules/wrangler/bin/wrangler.js deploy', 'wrangler versions deploy', 'wrangler versions upload --preview-alias x',
  'wrangler pages deploy public', 'wrangler rollback', 'wrangler secret put TOKEN', 'wrangler triggers deploy',
  'wrangler -c vantix/wrangler.jsonc deploy', 'wrangler --config=vantix/wrangler.jsonc deploy', 'wrangler --env production deploy',
  'CLOUDFLARE_API_TOKEN=x wrangler deploy', 'cd vantix && wrangler deploy', '(cd vantix; npx wrangler deploy)',
  "bash -c 'npx wrangler deploy'", "sh -c 'cd vantix && wrangler deploy'", 'wrangler dev --remote', 'wrangler $CMD',
  'timeout 60 npx wrangler deploy', 'env -C vantix npx wrangler deploy', 'echo y | npx wrangler deploy',
  'curl -X POST https://api.cloudflare.com/client/v4/accounts/x/workers/scripts/kitesink',
  'npm publish', 'pnpm publish', 'yarn npm publish',
];
const PKG_SCRIPTS = ['npm run ship', 'npm install', 'pnpm ship', 'yarn run ship', 'npm --prefix . run ship'];

const ALLOWED = [
  'git status', 'git commit -m "AST-46: deny git push, gh pr merge and wrangler deploy"', 'git log --grep=push --oneline',
  'git add -A && git commit -m x', 'git diff origin/main...HEAD', 'git fetch -q origin', 'git -C /tmp log -1',
  'git commit -m "$(cat /tmp/msg)"', 'gh pr view 3', 'gh pr create --draft --title x --body y', 'gh api repos/o/r/pulls',
  'gh pr diff 3', 'wrangler dev', 'npx wrangler dev', 'wrangler whoami', 'npx wrangler types', 'wrangler --version',
  'wrangler deployments list', 'python3 scripts/check_site.py', 'node --test tests/', 'grep -rn "git push" docs',
  'echo "run git push later"', 'cat docs/DEPLOY-CLOUDFLARE.md', 'ls | head', '[[ -f x ]] && echo y', '(( n > 1 )) && echo y',
  'echo $(( $a + 1 ))', 'for f in public/*.html; do echo "$f"; done', 'curl -s https://api.github.com/repos/o/r',
  'curl -s https://kitesink.com/', 'npm test', 'node scripts/test_music.js',
];

for (const [label, list] of [['push', PUSH], ['merge', MERGE], ['deploy', DEPLOY]]) {
  for (const cmd of list) {
    test(`AST-46#2 guard refuses ${label}: ${JSON.stringify(cmd)}`, () => {
      const r = runHook(hook, cmd);
      assert.equal(r.status, 2, `expected a refusal, got ${r.status}: ${r.stderr}`);
      assert.match(r.stderr, /^Blocked by \.claude\/hooks\/guard-bash\.mjs: /);
    });
  }
}

for (const cmd of PKG_SCRIPTS) {
  test(`AST-46#2 guard reads package scripts: ${JSON.stringify(cmd)}`, () => {
    const r = runHook(hook, cmd, { cwd: pkg });
    assert.equal(r.status, 2, r.stderr);
  });
}

for (const [cmd, why] of [['git push', /: git push \(agents commit locally/], ['gh pr merge 1', /: merging a PR \(Truman merges\)/],
  ['npx wrangler deploy', /: wrangler deploy \(deploys and Cloudflare changes are Truman's/]]) {
  test(`AST-46#2 guard names the reason: ${cmd}`, () => assert.match(runHook(hook, cmd).stderr, why));
}

test('AST-46#2 guard checks Monitor commands too', () => {
  assert.equal(runHook(hook, 'git push', { tool: 'Monitor' }).status, 2);
});

test('AST-46#2 guard fails closed on input it cannot read', () => {
  assert.equal(runHook(hook, undefined).status, 2);
});

for (const cmd of ALLOWED) {
  test(`AST-46#2 guard allows: ${JSON.stringify(cmd)}`, () => {
    const r = runHook(hook, cmd, { cwd: cmd === 'npm test' ? pkg : ROOT });
    assert.equal(r.status, 0, r.stderr);
  });
}
