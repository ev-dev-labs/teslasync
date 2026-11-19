import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'vitest';
import repair from './__fixtures__/native-source-repair-preservation.json';
import mobilePresentation from './__fixtures__/mobile-presentation-preservation.json';
import { producerProjection, projectionDigest } from './producer-projection';
import { restoreHorizontalNavigationSource } from './verified-horizontal-navigation-contract';
import { restoreCommandBoardSource } from './verified-command-board-contract';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fingerprint = '358282a7f7b01b2dbd41b3b4a076ebb922fd69fcd667d8cfffffd79c6e169188';
const mobileFingerprint = 'bbb151f55fe928cc3f45467e36f2e58cd49c7feaf63da18cc49ed3da41789e44';
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
  expect(hash(source), file + ': exact shared heatmap cell successor')
    .toBe('f798659dc9392ec7d651d0947d803b62f6fb02f6a8104442aa76060654d786f0');
  const heatmapAddition = "  heatmap: {\n    cell: 'rounded-[3px] border border-[var(--border-subtle)]',\n  },\n";
  expect(source.split(heatmapAddition), file + ': unique shared heatmap cell addition').toHaveLength(2);
  let previous = source.replace(heatmapAddition, '');
  expect(hash(previous), file + ': exact touch target successor').toBe(touchTargetSuccessor);
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
  const actualSource = source;
  if (file === 'web/src/features/dashboard/components/LayoutSwitcher.tsx') {
    expect(hash(source), file + ': exact phone menu containment repair')
      .toBe('b98148c3037df4252fab0167a0fe46e3422b416a6bb4d367a29a1083ab55ac93');
    const containment = "            'max-sm:w-full max-sm:min-w-0 max-sm:max-w-full',\n";
    expect(source.split(containment), file + ': unique phone menu containment').toHaveLength(2);
    source = source.replace(containment, '');
  }
  expect(hash(source), file + ': actual mobile presentation source').toBe(patch.after);
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact mobile presentation hunk')
      .toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(hash(previous), file + ': preserved pre-mobile source').toBe(patch.before);
  const currentProjection = producerProjection(file, actualSource);
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

const keyIdentityRepairs: Record<string, {
  before: string;
  after: string;
  hunks: readonly (readonly [string, string])[];
  parameter?: readonly [string, string];
}> = {
  'web/src/features/advanced-intelligence/pages/ComponentSurvivalPage.tsx': {
    before: 'deff0b009d17029953dcdc2494453cc19ee34776b3de0d7ea5641e69749b96ee',
    after: '742594a3ef1af18fadf59d0ab26286027f3e73ba2c03ec9a08219c78071f3c51',
    hunks: [
      ['item.competing_risks.map((risk, riskIndex) => (', 'item.competing_risks.map((risk) => ('],
      ['                        key={`${risk.risk}:${riskIndex}`}', '                        key={risk.risk}'],
      ['<div key={`${risk.risk}:${riskIndex}`}', '<div key={risk.risk}'],
    ],
    parameter: ['parameters:risk, riskIndex', 'parameters:risk'],
  },
  'web/src/features/dashboard/widgets/MaintenanceTrackerWidget.tsx': {
    before: '411f3a8cbb68bd5007cf4fb860f317e8f0c7298499493607d3c28e2c726a9d1f',
    after: '179b64644b11bd23f983ad58885ba5f44eca282dd3268d3c5db1ddca7ee9941b',
    hunks: [['<li key={`${rec.itemId}:${rec.date}:${index}`}', '<li key={rec.itemId || index}']],
  },
  'web/src/features/system/components/status/TeslaApiUsageCard.tsx': {
    before: '3abc8237c4a02ae7dd467d10ccf2f7cb5720b1dc9a8e80ed360fe9b2167277ec',
    after: 'b1e3d6cef39df182b33a368173e6c0eb875b3b6988ee54b44f8f834bc8bd6b33',
    hunks: [
      ['apiUsage.history.map((c, index) => ({', 'apiUsage.history.map(c => ({'],
      ['key: `${c.start}:${index}`,', 'key: c.start,'],
    ],
    parameter: ['parameters:c, index', 'parameters:c'],
  },
};

export function restoreKeyIdentitySource(file: string, source: string): string {
  const patch = keyIdentityRepairs[file];
  if (!patch) return source;
  expect(hash(source), file + ': exact keyed-record successor').toBe(patch.after);
  let previous = source;
  for (const [current, original] of patch.hunks) {
    expect(previous.split(current), file + ': unique key-only repair').toHaveLength(2);
    previous = previous.replace(current, original);
  }
  expect(hash(previous), file + ': complete unchanged pre-key source').toBe(patch.before);
  const projection = producerProjection(file, source);
  if (patch.parameter) {
    const [current, original] = patch.parameter;
    for (const call of projection.calls) {
      call.controls = call.controls.map(control => control === current ? original : control);
    }
  }
  expect(projection, file + ': unchanged calls and controls apart from the key ordinal parameter')
    .toEqual(producerProjection(file, previous));
  return previous;
}

function restoreAtlasFilterFragmentSource(file: string, source: string): string {
  if (file !== 'web/src/components/layout/sidebar/AtlasPanel.tsx') return source;
  expect(hash(source), file + ': exact filter-fragment repair successor')
    .toBe('a7662a6d0ec5229ff333e57fe66844b9b7b3e83bddbf4f966c0095b987d93fb6');
  const comment = '/* not-destructive: clears transient section-filter text only; saved groups, pins and page data are unchanged */';
  const replacements = [
    ['suffix={query ?\n', 'suffix={query ? <>\n'],
    [comment, `{${comment}}`],
    ['      : undefined} /></div>}', '      </> : undefined} /></div>}'],
  ];
  let previous = source;
  for (const [current, original] of replacements) {
    expect(previous.split(current), file + ': unique fragment-only repair').toHaveLength(2);
    previous = previous.replace(current, original);
  }
  expect(hash(previous), file + ': unchanged historical filter source')
    .toBe('6a0f4dd720fbb6b527f7131b2c497c2fe904e28b098e9db645d0518c11af9a84');
  expect(producerProjection(file, source), file + ': unchanged filter calls and controls')
    .toEqual(producerProjection(file, previous));
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
  source = restoreCommandBoardSource(file, source);
  source = restoreHorizontalNavigationSource(file, source);
  source = restoreKeyIdentitySource(file, source);
  source = restoreAtlasFilterFragmentSource(file, source);
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
