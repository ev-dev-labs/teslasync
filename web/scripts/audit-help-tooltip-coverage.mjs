#!/usr/bin/env node
/**
 * Phase-45 / 09 — HelpTooltip coverage audit.
 *
 * Asserts that every deeply-technical surface references the shared
 * `<HelpTooltip>` primitive (Phase-40 / Prompt 47) — either directly or
 * via `<MetricCard help={…}>` / similar wrappers that take a
 * `HelpTooltipProps` object.
 *
 * Detection rules (any one is enough):
 *   1. Source contains the literal string `HelpTooltip` (direct import).
 *   2. Source contains `\bhelp\s*=\s*\{` (component-prop form, e.g.
 *      `<MetricCard help={{ i18nKey: 'help.X', defaultValue: '…' }} />`).
 *   3. Source contains `helpKey=` (legacy/alternate prop name, in case any
 *      surface uses a wrapper exposing it).
 *
 * Surfaces are pinned by their REAL paths in the repo (the prompt's draft
 * list mentioned `StateMachinePage.tsx` and `SleepAnalyticsPage.tsx`,
 * which don't exist — the actual files are `StateMachineDebuggerPage.tsx`
 * and `SleepEfficiencyPage.tsx`).
 *
 * Exit 0 = all targets adopt help. Exit 1 + per-file MISSING_HELP[…]
 * lines when the audit regresses. Run from anywhere; paths resolve from
 * the script's own location, not `process.cwd()`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(SCRIPT_DIR, '..');

const TECHNICAL_SURFACES = [
  'src/features/telemetry/pages/SignalExplorerPage.tsx',
  'src/features/telemetry/pages/SignalDiffPage.tsx',
  'src/features/telemetry/components/SignalDiffTable.tsx',
  'src/features/system/pages/StateMachineDebuggerPage.tsx',
  'src/features/driving/pages/TripReplayPage.tsx',
  'src/features/battery/pages/BatteryDegradationPage.tsx',
  'src/features/analytics/pages/LifetimeStatsPage.tsx',
  'src/features/battery/pages/SleepEfficiencyPage.tsx',
  'src/features/charging/pages/ChargingDetailPage.tsx',
];

const HELP_PROP_RE = /\bhelp\s*=\s*\{/;
const HELP_KEY_RE = /\bhelpKey\s*=/;

const missing = [];
for (const rel of TECHNICAL_SURFACES) {
  const abs = resolve(WEB_ROOT, rel);
  let src;
  try {
    src = readFileSync(abs, 'utf8');
  } catch {
    missing.push({ file: rel, why: 'file not found' });
    continue;
  }
  const hasHelp =
    src.includes('HelpTooltip') || HELP_PROP_RE.test(src) || HELP_KEY_RE.test(src);
  if (!hasHelp) {
    missing.push({ file: rel, why: 'no HelpTooltip / help={…} / helpKey= reference' });
  }
}

for (const m of missing) {
  console.log(`MISSING_HELP[${m.file}] reason=${m.why}`);
}
const adopted = TECHNICAL_SURFACES.length - missing.length;
console.log(`Coverage: ${adopted}/${TECHNICAL_SURFACES.length}`);
process.exit(missing.length === 0 ? 0 : 1);
