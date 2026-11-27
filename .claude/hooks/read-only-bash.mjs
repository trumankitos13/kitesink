#!/usr/bin/env node
// PreToolUse hook for KiteSink's read-only Reviewer (AST-46, wired in .claude/agents/reviewer.md):
// every Bash command must pass the read-only check in read-only-bash-lib.mjs, or it is refused
// with exit 2 and a reason the agent sees. This file always runs the check (it has no "am I the
// main module" test), and it fails closed: unreadable input or any error refuses.
import { readFileSync } from 'node:fs';

let why;
try {
  const { verdict } = await import('./read-only-bash-lib.mjs');
  let input = null;
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { /* unreadable input: refused below */ }
  const command = input?.tool_input?.command;
  why = typeof command === 'string' ? verdict(command) : 'the hook got no command to check';
} catch (e) {
  why = `the hook failed (${e?.message ?? e})`;
}
if (why) {
  process.stderr.write(`Blocked for the read-only Reviewer: ${why}. This role reads, searches and runs the site checks and tests; it writes only under /tmp.\n`);
  process.exit(2);
}
process.exit(0);
