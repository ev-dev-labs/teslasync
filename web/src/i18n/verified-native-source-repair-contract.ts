import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'vitest';
import repair from './__fixtures__/native-source-repair-preservation.json';
import mobilePresentation from './__fixtures__/mobile-presentation-preservation.json';
import { producerProjection, projectionDigest } from './producer-projection';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fingerprint = '358282a7f7b01b2dbd41b3b4a076ebb922fd69fcd667d8cfffffd79c6e169188';
const mobileFingerprint = '83543e52518859d67e10b0e351986676ee4b5c8395ec70b0b751859c965cd084';
const touchTokenFile = 'web/src/lib/tokens.ts';
const touchTargetSuccessor = '95f986e34f191508c59e89e79afd47fe090972bd8f3bcb36c3979e3f8e0935cb';
const touchTokenAdditions = [
  'export const touchTargetPixels = 44\n\n',
  '    touchSize: touchTargetPixels,\n',
];
const touchBrushFile = 'web/src/features/battery/pages/BatteryDegradationPage.tsx';
const touchBrushHunks = [
  ["import { useMediaQuery } from '@/hooks/useMediaQuery';\n", ''],
  ["  const touchBrush = useMediaQuery('(max-width: 767px), (pointer: coarse)');\n", ''],
  [
    `                    {ChartBrush({
                      dataKey: 'label',
                      ariaLabel: t('signalQuery.preset.aria', '{{label}} time range', {
                        label: t('battery.degradation.trendTitle', 'Health trend & projection'),
                      }),
                      ...(touchBrush ? {
                        height: chartTokens.brush.touchSize,
                        travellerWidth: chartTokens.brush.touchSize,
                      } : {}),
                    })}`,
    "                    {ChartBrush({ dataKey: 'label' })}",
  ],
] as const;
const mobileTranslationAdditions: Record<string, string[]> = {
  'web/src/features/admin/pages/RedisSignalViewerPage.tsx': [
    "t('common.unknown', 'Unknown')",
    't(`redis.categoryName.${row.category}`, row.category)',
  ],
  'web/src/features/admin/components/ApiLogsEvidenceTable.tsx': [
    "t('apiLogs.na', 'N/A')",
    "t('apiLogs.rateLimited', 'Rate limited')",
  ],
  'web/src/features/admin/components/continuation-admin-3/CoverageCategory.tsx': [
    "t('coverage.dualWrite.yes', 'signal_log')",
    "t('coverage.subscribed.yes', 'yes')",
    "t('coverage.subscribed.no', 'no')",
  ],
  'web/src/features/admin/components/live-signal-inspector/LiveSignalsTable.tsx': [
    't(KIND_LABELS[category].key, KIND_LABELS[category].fallback)',
  ],
  'web/src/features/admin/components/structural-closure/audit-log/AuditLogEntries.tsx': [
    "t('admin.auditLog.statusOk', 'OK')",
    "t('admin.auditLog.statusFail', 'Fail')",
  ],
  'web/src/features/system/pages/DataExportPage.tsx': [
    't(type.labelKey, type.label)',
    't(status.labelKey, status.label)',
  ],
  'web/src/features/settings/components/WidgetDesignPackThumbnail.tsx': [
    "t('theme.appDesignPreview.overview', 'Overview')",
    "t('theme.widgetDesignPacks.battery', 'Battery')",
    "t('theme.widgetDesignPacks.history', 'History')",
  ],
};
const mobileTranslationRemovals: Record<string, string[]> = {
  'web/src/features/settings/components/WidgetDesignPackThumbnail.tsx': [
    "t('theme.widgetDesignPacks.sampleBattery', 'Sample battery level')",
  ],
};
export const actualRepairSource = (file: string): string =>
  readFileSync(resolve(process.cwd(), '..', file), 'utf8');

function restoreRepairDependency(file: string, source: string): string {
  if (file !== touchTokenFile) return source;
  expect(hash(source), file + ': exact touch target successor').toBe(touchTargetSuccessor);
  let previous = source;
  for (const addition of touchTokenAdditions) {
    expect(previous.split(addition), file + ': unique touch target addition').toHaveLength(2);
    previous = previous.replace(addition, '');
  }
  return previous;
}

function restoreTouchBrushSource(file: string, source: string): string {
  if (file !== touchBrushFile) return source;
  expect(hash(source), file + ': exact touch brush successor')
    .toBe('d80353a6f69ef004dd02f98f19961eee8c59675ff4d91861b934ed9b2a7ff706');
  let previous = source;
  for (const [current, original] of touchBrushHunks) {
    expect(previous.split(current), file + ': unique touch brush hunk').toHaveLength(2);
    previous = previous.replace(current, original);
  }
  expect(hash(previous), file + ': exact pre-touch brush source')
    .toBe('365ef9546ad59d74b442dc9a85d2ee3382f4379b952a4de9643a608100667379');
  return previous;
}

export function restoreMobilePresentationSource(file: string, source: string): string {
  expect(hash(JSON.stringify(mobilePresentation)), 'pinned mobile presentation successor').toBe(mobileFingerprint);
  const patch = mobilePresentation.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': actual mobile presentation source').toBe(patch.after);
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact mobile presentation hunk')
      .toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(hash(previous), file + ': preserved pre-mobile source').toBe(patch.before);
  const currentProjection = producerProjection(file, source);
  const previousProjection = producerProjection(file, previous);
  expect(currentProjection.bindings, file + ': original translation bindings').toEqual(previousProjection.bindings);
  const remaining = currentProjection.calls.map(call => ({
    ...call,
    controls: call.controls.map(control =>
      file === 'web/src/features/settings/components/WidgetDesignPackSettings.tsx'
        && control === 'parameters:{ chartColor }: {\n    chartColor: string;\n}'
        ? 'parameters:'
        : control),
  }));
  const removed = [...(mobileTranslationRemovals[file] ?? [])];
  for (const original of previousProjection.calls) {
    const index = remaining.findIndex(call => JSON.stringify(call) === JSON.stringify(original));
    if (index >= 0) {
      remaining.splice(index, 1);
    } else {
      const removedIndex = removed.indexOf(original.call);
      expect(removedIndex, file + ': original translation call and control').toBeGreaterThanOrEqual(0);
      removed.splice(removedIndex, 1);
    }
  }
  expect(removed, file + ': approved removed thumbnail labels').toEqual([]);
  expect(remaining.map(call => call.call), file + ': approved mobile label calls')
    .toEqual(mobileTranslationAdditions[file] ?? []);
  return previous;
}

/**
 * One explicit successor of e1fb, not a new historical baseline. The caller
 * supplies ACTUAL bytes. Old endpoints, partial edits and stale approvals fail.
 * No Git, map, cached source or fixture text is substituted for shipping input.
 */
export function restoreNativeSourceRepair(
  file: string,
  source: string,
  readDependency: (file: string) => string = actualRepairSource,
): string {
  expect(hash(JSON.stringify(repair)), 'pinned exact native source repair').toBe(fingerprint);
  source = restoreMobilePresentationSource(file, source);
  source = restoreTouchBrushSource(file, source);
  const patch = repair.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': actual complete accepted successor').toBe(patch.after);
  const currentProjection = producerProjection(file, source);
  expect(currentProjection.calls, file + ': actual producer occurrences').toHaveLength(patch.currentCallCount);
  expect(projectionDigest(currentProjection), file + ': actual calls/defaults/options/origins/gates')
    .toBe(patch.currentProjectionSha256);
  // Includes the new private producer, the additive barrel and its actual
  // Tooltip implementation. These are never checked against restored bytes.
  for (const dependency of repair.dependencies) {
    const actual = readDependency(dependency.file);
    expect(hash(restoreRepairDependency(dependency.file, actual)), dependency.file + ': actual native repair dependency')
      .toBe(dependency.sha256);
  }
  let previous = source;
  for (const hunk of [...patch.hunks].reverse()) {
    expect(previous.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact native repair hunk')
      .toBe(hunk.new);
    previous = previous.slice(0, hunk.start) + hunk.old + previous.slice(hunk.start + hunk.new.length);
  }
  expect(hash(previous), file + ': complete e1fb predecessor bytes').toBe(patch.before);
  if (patch.proof.sha256) {
    expect(patch.before, file + ': independently verified predecessor receipt').toBe(patch.proof.sha256);
  } else {
    expect(file).toBe('web/src/features/vehicles/components/FleetSourceStatus.tsx');
    expect(previous, 'new module has no historical producer').toBe('');
  }
  const projection = producerProjection(file, previous);
  expect(projection.calls, file + ': original producer occurrences').toHaveLength(patch.originalCallCount);
  expect(projectionDigest(projection), file + ': original calls/defaults/options/origins/gates')
    .toBe(patch.originalProjectionSha256);
  return previous;
}

/** Historical dependency guards still read, pin and invert the actual file. */
export function nativeRepairPredecessor(
  file: string,
  readDependency: (file: string) => string = actualRepairSource,
): string {
  return restoreRepairDependency(file, restoreNativeSourceRepair(file, readDependency(file), readDependency));
}
