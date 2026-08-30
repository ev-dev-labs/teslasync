#!/usr/bin/env node
/**
 * HelpTooltip coverage audit.
 *
 * Asserts that every deeply-technical surface references the shared
 * `<HelpTooltip>` primitive — either directly or
 * via `<MetricCard help={…}>` / similar wrappers that take a
 * `HelpTooltipProps` object.
 *
 * Detection rules (any one is enough):
 * 1. Source contains the literal string `HelpTooltip` (direct import).
 * 2. Source contains `\bhelp\s*=\s*\{` (component-prop form, e.g.
 * `<MetricCard help={{i18nKey: 'help.X', defaultValue: '…' }} />`).
 * 3. Source contains `helpKey=` (legacy/alternate prop name, in case any
 * surface uses a wrapper exposing it).
 *
 * Surfaces are pinned by their REAL paths in the repo (the earlier draft
 * list mentioned `StateMachinePage.tsx` and `SleepAnalyticsPage.tsx`,
 * which don't exist — the actual files are `StateMachineDebuggerPage.tsx`
 * and `SleepEfficiencyPage.tsx`).
 *
 * Exit 0 = coverage sits exactly on the pinned floor
 * (AUDIT_HELP_TOOLTIP_FLOOR). Exit 1 + per-file MISSING_HELP[…] lines when a
 * surface regresses, when coverage improves without raising the floor, or when
 * a pinned path no longer exists. Run from anywhere; paths resolve from
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

// CLEAN-08: this used to be an unwired script that could only be run by hand
// and failed outright, so it was never wired into `npm run lint` and adoption
// silently stalled at 6/9. It is now an executable RATCHET: CI enforces the
// floor, adopting a surface lets the floor rise, and dropping HelpTooltip from
// an already-adopted surface fails the build.
//
// A file that vanished (`why === 'file not found'`) is always a hard failure —
// the pin list would otherwise rot into a no-op.
const FLOOR = Number(process.env.AUDIT_HELP_TOOLTIP_FLOOR ?? 6);
const vanished = missing.filter((m) => m.why === 'file not found');
if (vanished.length > 0) {
  console.error(
    `[audit:help-tooltip] FAIL — ${vanished.length} pinned surface(s) no longer exist. ` +
      'Repoint TECHNICAL_SURFACES at the renamed files or drop the entries.',
  );
  process.exit(1);
}
if (adopted < FLOOR) {
  console.error(
    `[audit:help-tooltip] FAIL — coverage ${adopted}/${TECHNICAL_SURFACES.length} dropped below ` +
      `the floor of ${FLOOR}. Restore <HelpTooltip> on the surface listed above.`,
  );
  process.exit(1);
}
if (adopted > FLOOR) {
  console.error(
    `[audit:help-tooltip] FAIL — coverage improved to ${adopted}/${TECHNICAL_SURFACES.length}. ` +
      `Raise AUDIT_HELP_TOOLTIP_FLOOR to ${adopted} in package.json so the gain is locked in.`,
  );
  process.exit(1);
}
console.log(
  `[audit:help-tooltip] OK — ${adopted}/${TECHNICAL_SURFACES.length} technical surfaces adopt help ` +
    `(floor ${FLOOR}; ${missing.length} remaining: ${missing.map((m) => m.file).join(', ') || 'none'})`,
);
process.exit(0);
