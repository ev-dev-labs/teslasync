import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('Phase 4 battery presentation preservation', () => {
  it.each([
    'BatteryCare', 'BatteryCells', 'BatteryDegradation', 'BatteryHealth',
    'BatteryPassport', 'ChargeAdvisor', 'CycleStress', 'EnergyFlow',
    'EnergyLedger', 'Energy', 'EnergyProducts', 'PackCapacity',
    'PowerFlowDashboard', 'ProjectedRange', 'RangeSimulator', 'SleepEfficiency', 'VampireDrain',
  ])('%s keeps its canonical page shell without a second workspace selector', page => {
    const source = read(`../../pages/${page}Page.tsx`);
    expect(source).toContain('<PageLayout');
    expect(source).not.toMatch(/<(RangePicker|DateRangeFilter|VehicleSelect)\b/);
    expect(source).not.toMatch(/from ['"]@\/components\/layout\/layout-reference['"]/);
    expect(source).not.toMatch(/<(button|input|textarea|select|table)\b/);
  });

  it('retains all four Energy chart exports, complete prepared rows and interaction identities', () => {
    const source = read('../../pages/EnergyPage.tsx');
    expect(source.match(/<ChartCard\b/g)).toHaveLength(4);
    for (const rows of ['dailyConsumptionCostData', 'dailyEfficiencyData', 'timeOfDayData', 'chargerEvidence']) {
      expect(source).toContain(`data={${rows}}`);
      expect(source).toContain(`exportData={${rows}}`);
    }
    for (const key of ['energy-cost-daily', 'energy-efficiency-trend', 'energy-charging-time-of-day']) {
      expect(source).toContain(`useHiddenSeries('${key}')`);
    }
    for (const key of ['energy', 'cost', 'efficiency', 'distance', 'count']) {
      expect(source).toContain(`dataKey="${key}"`);
    }
    expect(source).toContain('data={sessions.slice(0, 15)}');
    expect(source).toContain('tableId="battery:energy-sessions"');
    expect(source).toContain('<Brush');
    expect(source).toContain('renderAnnotationLines(chartAnnotations');
    expect(source).toContain('connectNulls={false}');
    expect(source).toContain('syncMethod={sync.syncMethod}');
    expect(source).toContain('currentQuery={savedView.currentQuery}');
  });

  it('keeps simulator inputs, exact deterministic trial count, calibration, quantiles and reserve', () => {
    const source = read('../../pages/RangeSimulatorPage.tsx');
    for (const fact of [
      'simulateTrip(drivesQuery.data ?? [], tripKm, startSoc, { seed: 1337, trials: 2000 })',
      'tripDisplay * KM_PER_MILE', 'result.successProb * 100', 'result.p10', 'result.p50', 'result.p90',
      'result.packWhEstimate', 'result.sampleSize', 'result.trials',
      'b.count > 0 || (b.fromPct >= 0 && b.fromPct < 60)',
      'SIM_RESERVE_PCT + 5', 'onChange={setTripDisplay}', 'onChange={setStartSoc}',
    ]) expect(source).toContain(fact);
    expect(source).toContain('const isError = drivesState.fatalError != null');
    expect(source).not.toContain('const isError = drivesQuery.isError');
    expect(source).toContain('<StaleRefreshWarning state={drivesState}');
  });

  it('keeps source clocks, caps, certificate identity and exact export lifecycle', () => {
    const passport = read('../../pages/BatteryPassportPage.tsx');
    for (const fact of [
      'const payloadResolved =\n    passportQuery.data !== undefined',
      'useVerifyPassport(', 'passport?.provenance_hash ?? null',
      'const [pageNowMs] = useState(', 'JSON.stringify(certificate, null, 2)',
      'toBatteryPassportCertificate(passport)', 'URL.revokeObjectURL(url)',
      'anchor.download', 'verifyQuery.data?.valid === false', 'passportSource.refreshError',
    ]) expect(passport).toContain(fact);
    const advisor = read('../../pages/ChargeAdvisorPage.tsx');
    for (const fact of [
      'HISTORY_LIMIT = 1_000', 'useDriveHistory(vehicleIdStr, HISTORY_LIMIT)',
      'useChargingHistory(vehicleIdStr, HISTORY_LIMIT)', 'const [analysisNowMs]',
      'currentStateNowMs', 'Math.max(previous, Date.now())',
      'charge-advisor-reserve-floor', '[10, 20, 30]',
      'driveSource.fatalError ?? chargingSource.fatalError',
      'driveSource.refreshError ?? chargingSource.refreshError',
    ]) expect(advisor).toContain(fact);
  });

  it('keeps passport UTC date provenance and advisor complete scenario rows in canonical chart frames', () => {
    const passport = read('../battery-passport/BatteryPassportTrendTimeline.tsx');
    expect(passport).toContain('<ChartCard toolbar size="standard"');
    expect(passport).toContain('exportable={false}');
    expect(passport).toContain('height={280}');
    expect(passport).toContain('height={240}');
    expect(passport).toContain('analysis.trend.points.map');
    expect(passport).toContain('calendar dates in UTC');
    const advisor = read('../charge-advisor/ChargeAdvisorScenarioChart.tsx');
    expect(advisor).toContain('<EmbeddedChart toolbar exportable size="standard"');
    expect(advisor).toContain('chartKey="charge-advisor-scenarios"');
    expect(advisor).toContain('analysis.scenarios.meanPath.map');
    for (const key of ['mean', 'p75', 'meanBurn', 'p75Burn']) {
      expect(advisor).toContain(`key: '${key}'`);
    }
    expect(advisor).toContain('domain={[0, 100]}');
    expect(advisor).toContain("hiddenSeries?.isHidden('mean')");
    expect(advisor).toContain("hiddenSeries?.isHidden('p75')");
  });

  it('keeps specialist fatal-recovery ownership without labelling unavailable evidence as a successful empty response', () => {
    const passport = read('../battery-passport/BatteryPassportSectionBody.tsx');
    expect(passport).toContain('if (!state.isLoading && state.initialError)');
    expect(passport).not.toContain('const passiveContent = state.initialError');
    const advisor = read('../charge-advisor/ChargeAdvisorSection.tsx');
    expect(advisor).toContain('state.vehicleSelected && !loading && (missingDrive || missingCharging)');
    expect(advisor).not.toContain("missingDrive || missingCharging ? 'empty'");
  });

  it.each([
    'CapacityContext', 'FieldDirectory', 'GradeAudit', 'Methodology', 'ProvenanceMatrix',
    'Recommendations', 'ThermalProfile', 'TrendDiagnostics', 'TrendDistribution',
    'UsageProfile', 'VerificationDiagnostics',
  ])('keeps the %s certificate evidence inside a canonical card', section => {
    const source = read(`../battery-passport/BatteryPassport${section}.tsx`);
    expect(source).toContain('<LayoutCard title=');
    expect(source).not.toContain('<GlassPanel');
    if (section !== 'Methodology') expect(source).toContain('<BatteryPassportSectionBody state={state}>');
  });

  it('retains specialist certificate ratios, score terms, exact thermal accounting and both data directories', () => {
    const capacity = read('../battery-passport/BatteryPassportCapacityContext.tsx');
    for (const field of ['capacityKwh', 'originalCapacityKwh', 'capacityRatio']) {
      expect(capacity).toContain(`metrics.${field} != null`);
    }
    expect(capacity).toContain('metrics.capacityRatio * 100');
    const scoring = read('../battery-passport/BatteryPassportGradeAudit.tsx');
    for (const field of ['clampedSohPct', 'fastChargePenalty', 'cyclePenalty', 'score']) {
      expect(scoring).toContain(`grade.${field} != null`);
    }
    expect(scoring).toContain('grade.matchesReported === true');
    expect(scoring).toContain('grade.matchesReported === false');
    const thermal = read('../battery-passport/BatteryPassportThermalProfile.tsx');
    expect(thermal).toContain('thermal.sumPct != null');
    expect(thermal).toContain('thermal.differenceFrom100PctPoints != null');
    expect(read('../battery-passport/BatteryPassportProvenanceMatrix.tsx')).toContain('tableId="battery:passport-provenance"');
    expect(read('../battery-passport/BatteryPassportFieldDirectory.tsx')).toContain('tableId="battery:passport-fields"');
  });

  it('retains the ledger accounting, signed monthly series, weakest-month ordering and source isolation', () => {
    const source = read('../../pages/EnergyLedgerPage.tsx');
    for (const fact of [
      'buildEnergyLedger(sessionsQuery.data ?? [], drivesQuery.data ?? [])',
      'driven: -Math.round(m.drivenWh / 100) / 10',
      'standby: -Math.round(m.standbyWh / 100) / 10',
      'stored: Math.round(m.storedDeltaWh / 100) / 10',
      'residual: Math.round(m.residualWh / 100) / 10',
      'm.closureRate < worst.closureRate', 'summary.packCapacityWh != null',
      'm.residualWh >= 0', 'summary.months.map((m)', 'energy-ledger-monthly',
      'sessionsState.fatalError ?? drivesState.fatalError',
    ]) expect(source).toContain(fact);
    for (const key of ['charged', 'driven', 'standby', 'stored', 'residual']) {
      expect(source).toContain(`key: '${key}'`);
    }
  });

  it('preserves null live/history readings, real zero, signed flows, complete export rows and chart identities', () => {
    const page = read('../../pages/PowerFlowDashboardPage.tsx');
    for (const key of ['solar_power', 'battery_power', 'grid_power', 'load_power', 'percentage_charged']) {
      expect(page).toContain(`s.${key} ?? null`);
      expect(page).not.toContain(`s.${key} ?? 0`);
    }
    expect(page).toContain('value={soc}');
    expect(page).not.toContain('value={soc ?? 0}');
    expect(page).toContain('const liveIsError = liveState.fatalError != null');
    expect(page).toContain('const historyError = historyState.fatalError');
    expect(page).toContain('Math.abs(power)');
    expect(page).toContain('power == null ? null : inbound');
    expect(page).toContain('useTeslaEnergyLiveStatusHistory(siteId, since, until, 1000)');
    for (const chart of ['PowerHistoryChart', 'BatterySocChart']) {
      const source = read(`../power-flow/${chart}.tsx`);
      expect(source).toContain('<ChartCard toolbar exportable size="standard"');
      expect(source).toContain('data={evidence}');
      expect(source).toContain('exportData={evidence}');
    }
    expect(read('../power-flow/PowerHistoryChart.tsx')).toContain('chartKey="power-flow-history"');
  });
});
