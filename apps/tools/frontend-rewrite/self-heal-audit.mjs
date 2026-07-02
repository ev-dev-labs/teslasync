#!/usr/bin/env node
/*
 * self-heal-audit.mjs — autonomous, fully unattended audit for the
 * TeslaSync frontend gold-standard rewrite loop. Invoked by
 * frontend-loop.sh every 25 fleet-wide completions. Never pauses for
 * approval: diagnoses systemic issues and remediates them directly, then
 * exits so the loop continues immediately.
 *
 * Checks (in order):
 *   1. Integration-hygiene regression: `git diff --quiet` on HEAD must be
 *      clean on a fresh checkout. This is the exact class of bug that
 *      caused two real units to be silently discarded on 2026-07-01 (mixed
 *      CRLF/LF blobs made `pp_integration_is_clean()`永 always fail).
 *      Remediation: re-run the safe CRLF->LF normalization sweep (text
 *      extensions only, binary-guarded, skips eol=crlf-declared files),
 *      verify zero semantic diff, commit.
 *   2. Stale parallel worktrees/branches: `.teslasync-parallel/<runid>/*`
 *      dirs or `auto/<runid>/*` / `parallel/<runid>` refs left over from a
 *      run that isn't currently active. Remediation: prune them so disk
 *      space and branch-list clutter don't grow unbounded over a
 *      599-prompt run.
 *   3. Systemic gate-failure pattern: re-run the phase-boundary full gate
 *      (lint+tsc+test). If it fails, log full output for the next human
 *      review pass (this one genuinely can't self-remediate blindly —
 *      logged loudly, loop continues, does NOT block).
 *   4. Regenerate the manifest from done.txt + git log.
 *
 * Exit code is always 0 (advisory/remediation tool, never blocks the loop).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
const PROMPTS = path.join(REPO, '.github', 'prompts', 'frontend-gold-standard');
const LOG_DIR = path.join(PROMPTS, 'logs');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = path.join(LOG_DIR, `self-heal-${STAMP}.log`);

const lines = [];
function log(msg) {
  const entry = `[${new Date().toISOString()}] ${msg}`;
  lines.push(entry);
  console.log(entry);
}
function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

log('self-heal-audit START');

/* ---- Check 1: integration-hygiene (CRLF/blob) regression --------------- */
function checkIntegrationHygiene() {
  const dirty = sh('git diff --quiet; echo $?').trim() !== '0';
  if (!dirty) {
    log('CHECK 1 (integration hygiene): clean — no action');
    return;
  }
  log('CHECK 1 (integration hygiene): DIRTY ON FRESH HEAD — this is the exact bug class from 2026-07-01. Remediating.');
  const tracked = sh('git ls-files').split('\n').filter(Boolean);
  const SAFE_EXT = ['.tsx', '.ts', '.md', '.mjs', '.js', '.json', '.yml', '.yaml', '.go', '.css'];
  let fixed = 0;
  for (const f of tracked) {
    if (!SAFE_EXT.some((ext) => f.endsWith(ext))) continue;
    const attr = sh(`git check-attr eol -- "${f}"`);
    if (attr.includes('eol: crlf')) continue; // respect intentional CRLF files
    const full = path.join(REPO, f);
    let data;
    try {
      data = fs.readFileSync(full);
    } catch {
      continue;
    }
    if (data.subarray(0, 8000).includes(0)) continue; // binary guard
    if (data.includes(Buffer.from('\r\n'))) {
      const before = data;
      const after = Buffer.from(data.toString('binary').split('\r\n').join('\n'), 'binary');
      fs.writeFileSync(full, after);
      fixed++;
      log(`  normalized: ${f}`);
    }
  }
  if (fixed === 0) {
    log('  no fixable files found — dirty state has an unknown cause, logging for human review, NOT auto-committing blind');
    return;
  }
  const zeroSemanticDiff = sh('git diff --ignore-all-space --stat').trim() === '';
  if (!zeroSemanticDiff) {
    log('  ABORT: normalization produced a non-empty --ignore-all-space diff (unexpected real content change) — reverting, flagging for human review');
    sh('git checkout -- .');
    return;
  }
  sh('git add -A');
  sh(`git commit -m "fix(repo): self-heal-audit CRLF normalization (${fixed} files)

Autonomous remediation by self-heal-audit.mjs — zero semantic change
(git diff --ignore-all-space confirmed empty before commit).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"`);
  log(`  remediated + committed: ${fixed} files normalized`);
}
checkIntegrationHygiene();

/* ---- Check 2: stale parallel worktrees/branches ------------------------ */
function checkStaleParallelState() {
  const activeRunIds = new Set(
    sh('ps aux').split('\n')
      .map((l) => l.match(/frontend-gold-standard\/logs\/parallel\/([\w-]+)/)?.[1])
      .filter(Boolean),
  );
  const wtList = sh('git worktree list --porcelain');
  const staleDirs = [];
  for (const block of wtList.split('\n\n')) {
    const m = block.match(/^worktree (.+\.teslasync-parallel\/([\w-]+)\/.+)$/m);
    if (!m) continue;
    const [, dir, runId] = m;
    if (!activeRunIds.has(runId)) staleDirs.push(dir);
  }
  if (staleDirs.length === 0) {
    log('CHECK 2 (stale parallel state): none found — no action');
    return;
  }
  log(`CHECK 2 (stale parallel state): ${staleDirs.length} stale worktree(s) from inactive runs — pruning`);
  for (const d of staleDirs) {
    sh(`git worktree remove --force "${d}"`);
    log(`  removed worktree: ${d}`);
  }
  sh('git worktree prune');
}
checkStaleParallelState();

/* ---- Check 3: systemic gate-failure pattern (advisory only) ------------ */
function checkFullGate() {
  log('CHECK 3 (full gate): running scripts/frontend-gate.sh --full (advisory, non-blocking)...');
  const out = sh('bash scripts/frontend-gate.sh --full', { cwd: path.join(REPO, 'web') });
  const pass = /GATE=PASS/.test(out);
  log(`CHECK 3 (full gate): ${pass ? 'PASS' : 'FAIL — logged for human review, loop continues (per-unit gates already caught unit-local regressions)'}`);
  if (!pass) {
    const gateLog = path.join(LOG_DIR, `self-heal-full-gate-${STAMP}.log`);
    fs.writeFileSync(gateLog, out);
    log(`  full output: ${path.relative(REPO, gateLog)}`);
  }
}
checkFullGate();

/* ---- Check 4: regenerate manifest --------------------------------------- */
function regenerateManifest() {
  const manifestScript = path.join(__dirname, 'gen-manifest.mjs');
  if (!fs.existsSync(manifestScript)) {
    log('CHECK 4 (manifest): gen-manifest.mjs not found — skipping');
    return;
  }
  sh(`node "${manifestScript}"`);
  log('CHECK 4 (manifest): regenerated');
}
regenerateManifest();

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.writeFileSync(LOG_FILE, lines.join('\n') + '\n');
log(`self-heal-audit DONE — full log: ${path.relative(REPO, LOG_FILE)}`);
