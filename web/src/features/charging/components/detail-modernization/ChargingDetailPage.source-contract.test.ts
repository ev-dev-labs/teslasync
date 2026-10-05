import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Match repository source-read prior art (url-state-adoption.test.ts), using
// filesystem paths rather than jsdom/Vite's transformed HTTP import.meta.url.
// Support the existing runner's web cwd and invocation from the repository root.
const sourceRoot = resolve(process.cwd(), existsSync(resolve(process.cwd(), 'src')) ? 'src' : 'web/src');
const chargingRoot = resolve(sourceRoot, 'features/charging');
const page = readFileSync(resolve(chargingRoot, 'pages/ChargingDetailPage.tsx'), 'utf8');
const stats = readFileSync(resolve(chargingRoot, 'components/detail-modernization/DetailSessionStats.tsx'), 'utf8');
const placement = readFileSync(resolve(chargingRoot, 'components/detail-modernization/DetailPlacement.tsx'), 'utf8');

describe('charging detail source preservation (not mounted/runtime evidence)', () => {
  it('keeps the original four queries and specialist/AI/share owners and arguments', () => {
    for (const binding of [
      'useChargingSessionDetail(sessionId || null)',
      'useChargeTelemetry(session?.id ?? null)',
      "useVehicle(String(session?.vehicle_id ?? ''))",
      'session?.vehicle_id ?? 0',
      '<ChargeBillTruthPanel session={session}',
      '<ChargePhysicsPanel sessionId={id}',
      '<ChargeLedgerCompactPanel sessionId={id}',
      '<AIChargingDiagnosis sessionId={id}',
      '<ShareSessionDialog',
      'sessionId={id}',
      'open={shareDialogOpen}',
      'onClose={() => setShareDialogOpen(false)}',
    ]) expect(page).toContain(binding);
    expect(page).not.toMatch(/\bfetch\s*\(|\brequest\s*[<(]|\/api\/v1\//);
  });
  it('uses one canonical measurement pipeline and keeps full chart width and original group headings', () => {
    expect(page.match(/<CardGrid\b/g)).toHaveLength(1);
    expect(placement).toContain('useCardPlacement()');
    expect(page + placement).not.toMatch(/ResizeObserver|window\.innerWidth|packCardRows|useContainerWidth/);
    expect(page).not.toMatch(/max-w-\[?1600|mx-auto/);
    for (const id of ['charging-battery-power', 'charging-analysis', 'charging-session-details'])
      expect(page).toContain(`id="${id}"`);
    for (const id of ['charge-curve', 'session-timeline'])
      expect(page).toContain(`id: '${id}', size: 'full'`);
  });
  it('keeps every sample/series, legend/brush/cursor contracts, persistence IDs and dense-table safety', () => {
    expect(page.match(/<EmbeddedChart\b/g)).toHaveLength(4);
    expect(page.match(/<ChartLegend\b/g)).toHaveLength(3);
    expect(page.match(/<ReferenceLine\b/g)).toHaveLength(3);
    expect(page).toContain('<ChartBrush dataKey="time"');
    expect(page).toContain('syncId="charging.session" syncMethod="value"');
    for (const key of ['charging-detail-session-timeline', 'charging-detail-temperature', 'charging-detail-voltage-current'])
      expect(page).toContain(`chartKey="${key}"`);
    for (const series of ['soc', 'energy', 'range', 'battery', 'inside', 'outside', 'voltage', 'current'])
      expect(page).toContain(`hiddenSeries?.isHidden('${series}')`);
    expect(page).toContain('const A11Y_TABLE_ROW_CAP = 2000');
    expect(page).toContain('telemetryCount > A11Y_TABLE_ROW_CAP');
    expect(page.match(/data=\{isLargeDataset \? undefined : /g)).toHaveLength(4);
    expect(page.match(/\{\.\.\.seriesPerfProps\}/g)).toHaveLength(9);
    expect(page).toContain('return synthesizeCurve(session)');
  });
  it('retains original business derivations, nullable specialist values and exactly eight stat occurrences', () => {
    for (const source of [
      'durationMinutes(session.started_at, session.ended_at)',
      'distanceAddedM(session)',
      'billedEnergyWh != null && billedEnergyWh > 0 ? billedEnergyWh : vehicleEnergyWh',
      '(displayEnergyWh / 1000 / durationMin) * 60',
      'billedCost ?? session.cost_decimal ?? null',
      'displayCost / (displayEnergyWh / 1000)',
      'perKwhRate ?? settingsCostPerKwh',
      'formatEnergyCost(displayEnergyWh / 1000)',
      'toDistanceDisplay(addedDistanceM)',
      'liveCharging.range_added_meters_per_hour',
      'liveCharging.range_added_meters',
      'session.avg_power_w != null',
      'session.cost_currency ??',
    ]) expect(page).toContain(source);
    // Authorized correction: the positive delta is already SI meters at all
    // three display sites; do not preserve the inherited double conversion.
    expect(page.match(/toDistanceDisplay\(addedDistanceM\)/g)).toHaveLength(3);
    expect(page).not.toContain('toDistanceDisplay((addedDistanceM ?? 0) / 1000)');
    for (const id of ['17201', '17203', '17205', '17207', '17209', '17211', '17213', '17215'])
      expect(stats).toContain(`occurrenceId: 'jsx-${id}'`);
    expect(stats.match(/occurrenceId:/g)).toHaveLength(8);
    expect(stats).toContain("kind: 'event'");
    expect(stats).toContain('end: session.ended_at');
    expect(stats).not.toMatch(/kind: 'alltime'|completeness: 'complete'/);
  });
  it('leaves plot headings with each original EmbeddedChart instead of duplicating LayoutCard chrome', () => {
    for (const [key, label] of [
      ['chargeCurve', 'Charge Curve'],
      ['socOverTime', 'SoC, Energy & Range over Time'],
      ['temperature', 'Temperature'],
      ['voltageCurrent', 'Voltage & Current'],
    ]) {
      expect(page).not.toContain(`<LayoutCard title={t('charging.detail.${key}', '${label}')}`);
      expect(page).toContain(`<section aria-label={t('charging.detail.${key}', '${label}')}`);
    }
    for (const id of ['jsx-17259', 'jsx-17287', 'jsx-17310', 'jsx-17330'])
      expect(page).toContain(`<DetailPlacement sourceId="${id}"`);
  });
  it('keeps source shells/recovery and original actions while fatal errors alone replace retained charts', () => {
    expect(page).toContain('telemetryDataState.fatalError');
    expect(page).toContain('sessionDataState.fatalError');
    expect(page).toContain('liveDataState.fatalError');
    expect(page.match(/telemetryLoading && !telemetryDataState.hasData/g)).toHaveLength(3);
    expect(page.match(/onRetry=\{\(\) => refetchTelemetry\(\)\}/g)).toHaveLength(3);
    expect(page).toContain('<DetailSourceOutline loading');
    expect(page).toContain('<DetailSourceOutline />');
    expect(page).toContain('onClick={() => setShareDialogOpen(true)}');
    expect(page).toContain('<PrintButton');
    expect(page).toContain('to="/charging"');
    expect(page).not.toMatch(/<button\b|<input\b|<textarea\b|<select\b|style=\{\{/);
    expect(page).not.toMatch(/from ['"](?:recharts|react-leaflet|framer-motion)['"]/);
  });
});
