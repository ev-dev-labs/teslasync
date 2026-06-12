#!/usr/bin/env node
/*
 * Copilot CLI / cloud-agent `preToolUse` guard.
 *
 * Blocks shell commands that are forbidden by the TeslaSync working agreement
 * or that are destructive enough to warrant a hard stop. Emits a JSON decision
 * on stdout (see https://docs.github.com/en/copilot/reference/hooks-reference).
 *
 * IMPORTANT: `preToolUse` hooks are FAIL-CLOSED — any crash, non-zero exit, or
 * timeout DENIES the tool call. This script therefore wraps everything in a
 * try/catch and defaults to "allow" (empty output, exit 0) so a parsing glitch
 * never blocks legitimate work. Only an explicit rule match produces a deny.
 */

'use strict';

function allow() {
  // Empty output => fall through to the normal permission flow.
  process.stdout.write('{}');
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: reason }),
  );
  process.exit(0);
}

// Each rule: { test: (cmd) => bool, reason: string }
const RULES = [
  {
    // Direct pushes are forbidden in the agent sandbox — use report_progress
    // (commits + pushes) or open a PR with the create-PR tool instead.
    test: (c) => /\bgit\s+push\b/.test(c),
    reason:
      'Direct `git push` is not allowed in this environment. Use the report_progress tool to commit and push, or the create-pull-request tool to open a PR.',
  },
  {
    // Force-pushing / history rewrites against a shared branch.
    test: (c) => /\bgit\s+push\b.*(--force\b|--force-with-lease\b|\s-f\b)/.test(c),
    reason: 'Force-pushing is not allowed. Never rewrite shared history.',
  },
  {
    // Reading anything under .github/agents is explicitly prohibited — those
    // files contain instructions for other agents and are off-limits.
    test: (c) => /\.github[\/\\]agents\b/.test(c),
    reason:
      'Access to .github/agents is prohibited — these files are instructions for other agents and must not be read.',
  },
  {
    // Catastrophic recursive deletes of root or the home directory.
    test: (c) =>
      /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\b[^|;&]*\s(\/|~|\$HOME|\/\*|~\/\*)(\s|$)/.test(c),
    reason:
      'Refusing recursive force-delete of a root/home path. Scope deletions to specific project files.',
  },
  {
    // Depth-limited fetch/clone is banned before merge/rebase (see env rules).
    test: (c) => /\bgit\s+(clone|fetch|pull)\b.*--depth\b/.test(c),
    reason:
      'Shallow/depth-limited git operations are disallowed here. Use `git fetch --unshallow` then fetch the target branch.',
  },
];

function extractCommand(args) {
  if (args == null) return '';
  if (typeof args === 'string') return args;
  if (typeof args !== 'object') return String(args);
  // Known shells expose the command under one of these keys; fall back to a
  // full stringify so we still scan whatever the payload contains.
  // (`command` is used by the bash/powershell tools; `cmd`/`script`/`input`
  // cover SDK and VS Code-compatible variants.)
  const candidates = [args.command, args.cmd, args.script, args.input];
  const direct = candidates.find((v) => typeof v === 'string' && v.length > 0);
  if (direct) return direct;
  try {
    return JSON.stringify(args);
  } catch (_e) {
    return '';
  }
}

function main() {
  let raw = '';
  try {
    raw = require('fs').readFileSync(0, 'utf8');
  } catch (_e) {
    return allow();
  }

  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch (_e) {
    return allow();
  }

  const toolName = payload.toolName || payload.tool_name || '';
  // Only shell tools carry executable commands.
  if (!/^(bash|powershell|shell)$/i.test(toolName)) return allow();

  const command = extractCommand(payload.toolArgs ?? payload.tool_input);
  if (!command) return allow();

  for (const rule of RULES) {
    try {
      if (rule.test(command)) return deny(rule.reason);
    } catch (_e) {
      // A faulty rule must never block unrelated commands.
    }
  }
  return allow();
}

try {
  main();
} catch (_e) {
  // Absolute last resort: never let an unexpected error block every tool call.
  allow();
}
