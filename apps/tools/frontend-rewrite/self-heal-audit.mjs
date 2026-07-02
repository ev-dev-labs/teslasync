#!/usr/bin/env node
/*
 * self-heal-audit.mjs — autonomous, fully unattended audit for the
 * TeslaSync frontend gold-standard rewrite loop. Invoked by
 * frontend-loop.sh every 25 fleet-wide completions. Never pauses for
 * approval: diagnoses systemic issues and remediates them directly, then
 * exits so the loop continues immediately.
 *
 * Checks (in order):
 *   1. done.txt reconciliation: every entry in done.txt MUST be reachable
 *      from HEAD. It won't be if the runner's per-merge fast-forward
 *      (added to run-prompts.sh this session) failed or an operator killed
 *      the loop before an older run's end-of-invocation fast-forward ran.
 *      Remediation: find the real commit for each stranded entry (grep
 *      git log --all for the unit's slug) and cherry-pick it onto HEAD.
 *      Clean cherry-picks are kept; anything that conflicts is aborted and
 *      logged loudly for manual review (never guess a conflict resolution
 *      unattended). This exact scenario struck 7 real Radix-migration
 *      units on 2026-07-01 and required manual recovery.
 *   2. Integration-hygiene regression: `git diff --quiet` on HEAD must be
 *      clean on a fresh checkout. This is the exact class of bug that
 *      caused two real units to be silently discarded on 2026-07-01 (mixed
 *      CRLF/LF blobs made `pp_integration_is_clean()` always fail).
 *      Remediation: re-run the safe CRLF->LF normalization sweep (text
 *      extensions only, binary-guarded, skips eol=crlf-declared files),
 *      verify zero semantic diff, commit.
 *   3. Stale parallel worktrees/branches: `.teslasync-parallel/<runid>/*`
 *      dirs or `auto/<runid>/*` / `parallel/<runid>` refs left over from a
 *      run that isn't currently active. Remediation: prune them so disk
 *      space and branch-list clutter don't grow unbounded over a
 *      599-prompt run.
 *   4. Systemic gate-failure pattern: re-run the phase-boundary full gate
 *      (lint+tsc+test). If it fails, log full output for the next human
 *      review pass (this one genuinely can't self-remediate blindly —
 *      logged loudly, loop continues, does NOT block).
 *   5. Regenerate the manifest from done.txt + git log.
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

/* ---- Check 1: done.txt reconciliation (stranded-merge safety net) ------ */
function checkDoneTxtReconciliation() {
  const doneFile = path.join(PROMPTS, 'logs', 'done.txt');
  if (!fs.existsSync(doneFile)) {
    log('CHECK 1 (done.txt reconciliation): no done.txt yet — no action');
    return;
  }
  const entries = fs.readFileSync(doneFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const stranded = [];
  for (const relpath of entries) {
    // Find the real (non-merge, non-WIP) commit for this unit by slug.
    const slug = path.basename(relpath, '.prompt.md').replace(/^\d+-/, '');
    const grepTerm = slug.split('-').slice(0, 3).join(' ');
    const candidates = sh(`git log --all --format="%H %ci" --grep="${grepTerm}" -i`)
      .split('\n').filter(Boolean)
      .filter((l) => {
        const hash = l.split(' ')[0];
        const msg = sh(`git log -1 --format=%s ${hash}`);
        return !/^(merge|WIP|index)/i.test(msg.trim());
      });
    if (candidates.length === 0) continue; // can't identify — skip, don't guess
    // Most recent candidate by commit date.
    candidates.sort((a, b) => new Date(b.split(' ').slice(1).join(' ')) - new Date(a.split(' ').slice(1).join(' ')));
    const commit = candidates[0].split(' ')[0];
    const isAncestor = sh(`git merge-base --is-ancestor ${commit} HEAD && echo yes || echo no`).trim();
    if (isAncestor !== 'yes') stranded.push({ relpath, commit });
  }
  if (stranded.length === 0) {
    log('CHECK 1 (done.txt reconciliation): all done.txt entries reachable from HEAD — no action');
    return;
  }
  log(`CHECK 1 (done.txt reconciliation): ${stranded.length} done.txt entries NOT reachable from HEAD (stranded merges) — attempting recovery`);
  for (const { relpath, commit } of stranded) {
    const before = sh('git rev-parse HEAD').trim();
    const out = sh(`git cherry-pick ${commit} 2>&1`);
    const stillConflicted = sh('git status --short').split('\n').some((l) => /^(UU|AA)/.test(l));
    if (stillConflicted) {
      sh('git cherry-pick --abort');
      log(`  ABORT: ${relpath} (${commit}) conflicts on cherry-pick — needs manual review, NOT auto-resolving. Aborted cleanly.`);
      continue;
    }
    const after = sh('git rev-parse HEAD').trim();
    if (after !== before) {
      log(`  recovered: ${relpath} <- ${commit}`);
    } else {
      log(`  no-op (already applied or empty): ${relpath} <- ${commit}: ${out.slice(0, 200)}`);
    }
  }
}
checkDoneTxtReconciliation();

log('self-heal-audit START');

/* ---- Check 1: integration-hygiene (CRLF/blob) regression --------------- */
function checkIntegrationHygiene() {
  const dirty = sh('git diff --quiet; echo $?').trim() !== '0';
  if (!dirty) {
    log('CHECK 2 (integration hygiene): clean — no action');
    return;
  }
  log('CHECK 2 (integration hygiene): DIRTY ON FRESH HEAD — this is the exact bug class from 2026-07-01. Remediating.');
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
    log('CHECK 3 (stale parallel state): none found — no action');
    return;
  }
  log(`CHECK 3 (stale parallel state): ${staleDirs.length} stale worktree(s) from inactive runs — pruning`);
  for (const d of staleDirs) {
    sh(`git worktree remove --force "${d}"`);
    log(`  removed worktree: ${d}`);
  }
  sh('git worktree prune');
}
checkStaleParallelState();

/* ---- Check 3: systemic gate-failure pattern (advisory only) ------------ */
function checkFullGate() {
  log('CHECK 4 (full gate): running scripts/frontend-gate.sh --full (advisory, non-blocking)...');
  const out = sh('bash scripts/frontend-gate.sh --full', { cwd: path.join(REPO, 'web') });
  const pass = /GATE=PASS/.test(out);
  log(`CHECK 4 (full gate): ${pass ? 'PASS' : 'FAIL — logged for human review, loop continues (per-unit gates already caught unit-local regressions)'}`);
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
    log('CHECK 5 (manifest): gen-manifest.mjs not found — skipping');
    return;
  }
  sh(`node "${manifestScript}"`);
  log('CHECK 5 (manifest): regenerated');
}
regenerateManifest();

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.writeFileSync(LOG_FILE, lines.join('\n') + '\n');
log(`self-heal-audit DONE — full log: ${path.relative(REPO, LOG_FILE)}`);
