#!/usr/bin/env node
// PreToolUse hook for every Bash and Monitor call in this repo, for every agent (AST-46,
// .claude/settings.json). It refuses with exit 2, and a reason the agent sees, any command that
// deploys (wrangler deploy and the rest), pushes (git push) or merges (gh pr merge); see
// guard-bash-lib.mjs. This file always runs the check (it has no "am I the main module" test), and
// it fails closed: unreadable input or any error refuses.
//
// It is also the Reviewer's backstop: Claude Code skips an agent file's frontmatter hooks (the
// Reviewer's read-only-bash.mjs) while the repo folder isn't trusted, but runs this one, and names
// the agent in agent_type. For a read-only agent it applies the read-only check too, matching the
// name case-insensitively and with or without a plugin prefix (Reviewer, kitesink:reviewer).
import { readFileSync } from 'node:fs';

const READ_ONLY_AGENTS = new Set(['reviewer']);
const agentName = (t) => (typeof t === 'string' ? t.trim().toLowerCase().split(':').pop().trim() : '');
let why, readOnly = false;
try {
  const { verdict } = await import('./guard-bash-lib.mjs');
  let input = null;
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { /* unreadable input: refused below */ }
  const command = input?.tool_input?.command;
  // Monitor runs a shell command like Bash does, or opens a WebSocket (no shell, nothing to check).
  const wsOnly = input?.tool_name === 'Monitor' && command === undefined && typeof input?.tool_input?.ws?.url === 'string';
  why = wsOnly ? null : typeof command === 'string' ? verdict(command, input?.cwd) : 'the hook got no command to check';
  if (!why && !wsOnly && READ_ONLY_AGENTS.has(agentName(input?.agent_type))) {
    const ro = await import('./read-only-bash-lib.mjs');
    why = ro.verdict(command);
    readOnly = !!why;
  }
} catch (e) {
  why = `the hook failed (${e?.message ?? e})`;
}
if (why && readOnly) {
  process.stderr.write(`Blocked for the read-only Reviewer (.claude/hooks/guard-bash.mjs): ${why}. This role reads, searches and runs the site checks and tests; it writes only under /tmp.\n`);
  process.exit(2);
}
if (why) {
  process.stderr.write(`Blocked by .claude/hooks/guard-bash.mjs: ${why}. No agent in KiteSink deploys, pushes or merges: pushing or merging to main, or wrangler deploy, publishes production, and those are Truman's (AGENTS.md). Commit locally and report.\n`);
  process.exit(2);
}
process.exit(0);
