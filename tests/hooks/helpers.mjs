// Runs a hook the way Claude Code does: the command string from its config, through sh, with
// CLAUDE_PROJECT_DIR set and the PreToolUse JSON on stdin (AST-46).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The PreToolUse Bash command from .claude/settings.json (every agent).
export function guardCommand() {
  const settings = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8'));
  const entry = settings.hooks.PreToolUse.find((h) => new RegExp(`^(${h.matcher})$`).test('Bash'));
  return entry.hooks[0].command;
}

// The PreToolUse Bash command from an agent file's frontmatter (`hooks:`), or null when it has none.
export function agentHookCommand(agent) {
  const text = readFileSync(join(ROOT, '.claude/agents', `${agent}.md`), 'utf8');
  const front = text.match(/^---\n([\s\S]*?)\n---/)[1];
  const hooks = front.match(/^hooks:\n((?:[ \t]+.*\n?)+)/m);
  if (!hooks) return null;
  const matcher = hooks[1].match(/matcher:\s*(.+)/)[1].trim();
  if (!new RegExp(`^(${matcher})$`).test('Bash')) return null;
  return hooks[1].match(/command:\s*(.+)/)[1].trim();
}

export function runHook(hookCommand, command, { cwd = ROOT, tool = 'Bash', agentType } = {}) {
  const r = spawnSync('sh', ['-c', hookCommand], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command }, cwd, ...(agentType ? { agent_type: agentType } : {}) }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    encoding: 'utf8',
  });
  return { status: r.status, stderr: r.stderr };
}
