import type { ComponentProps, ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatMetric } from '@/components/data-display/stat-reference';
import type { MetricPreferences } from '@/lib/metric-reference';
import type { UnitPref } from '@/lib/unitConversion';
import { useUnits } from '@/hooks/useUnits';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { convertDistanceFromSI, convertSpeedFromSI, convertTempFromSI } from '@/lib/unitConversion';
import { deriveDataState } from '@/api/dataState';
import { NestedDrivingBrief } from './NestedDrivingBrief';
import { DriveDnaCadenceMetrics } from '../drive-dna/DriveDnaCadenceMetrics';
import { DriveDnaSignalCoverageGrid } from '../drive-dna/DriveDnaSignalCoverageGrid';
import { ColdWarmComparison } from '../cold-start/ColdWarmComparison';
import { CoverageMetrics } from '../explorer/CoverageMetrics';
import { DiscoveryCadenceSummary } from '../explorer/DiscoveryCadenceSummary';
import { RhythmCoverageSummary } from '../driving-rhythm/RhythmCoverageSummary';
import { WeekdayWeekendComparison } from '../driving-rhythm/WeekdayWeekendComparison';
import { EnergyIntensityPanel } from '../journey-fragmentation/EnergyIntensityPanel';
import { ElapsedComposition } from '../journey-fragmentation/ElapsedComposition';
import { StructureIndicators } from '../journey-fragmentation/StructureIndicators';
import { LiveMotorPanel } from '../drivetrain-health-modernization/LiveMotorPanel';
import { driveFixture, motorFixture } from '../drivetrain-health-modernization/fixtures';
import RideOverview from '../driving-dynamics-modernization/RideOverview';
import { GoalPulse } from '../efficiency-target/GoalPulse';
import { FsdObservatoryPanel } from '../fsd-insights/FsdObservatoryPanel';
import { FsdDriveAnalyticsPanels } from '../fsd-insights/FsdDriveAnalyticsPanels';
import { buildDriveDnaModel } from '../../lib/driveDNA';
import { summarizeColdStarts } from '../../lib/coldStart';
import { summarizeExplorer } from '../../lib/explorer';
import { buildDrivingRhythm } from '../../lib/drivingRhythm';
import { analyzeJourneyFragmentation } from '../../lib/journeyFragmentation';
import { summarizeTarget } from '../../lib/efficiencyTarget';

const h = vi.hoisted(() => {
  const units: UnitPref = {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', power: 'kW', duration: 'min', precision: 2, locale: 'en-US',
  };
  return { units, capture: vi.fn<(metrics: readonly StatMetric[]) => void>() };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDateTime: (value: string | null | undefined) => value ?? '—' }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: h.units,
    formatDistance: (raw: number | null | undefined) => raw == null ? '—' : `${convertDistanceFromSI(raw, h.units.distance).toFixed(2)} ${h.units.distance}`,
    formatEnergy: (raw: number | null | undefined) => raw == null ? '—' : `${(raw / 1000).toFixed(2)} kWh`,
    formatDuration: (raw: number | null | undefined, options?: { precision?: number }) => raw == null ? '—' : `${(raw / 60).toFixed(options?.precision ?? 2)} min`,
    formatPower: (raw: number | null | undefined) => raw == null ? '—' : `${(raw / 1000).toFixed(2)} kW`,
    formatTemperature: (raw: number | null | undefined) => raw == null ? '—' : `${convertTempFromSI(raw, h.units.temperature).toFixed(2)} ${h.units.temperature}`,
    formatSpeed: (raw: number | null | undefined) => raw == null ? '—' : `${convertSpeedFromSI(raw, h.units.speed).toFixed(2)} ${h.units.speed}`,
  }),
}));
vi.mock('@/hooks/useOperationalMetrics', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOperationalMetrics')>('@/hooks/useOperationalMetrics');
  return {
    useOperationalMetrics: (metrics: readonly StatMetric[], preferences?: MetricPreferences) => {
      h.capture(metrics);
      return actual.useOperationalMetrics(metrics, preferences);
    },
  };
});

const sectionState = { isLoading: false, error: null, onRetry: vi.fn() };
const now = Date.parse('2026-08-08T12:00:00Z');
function show(node: ReactNode) { return render(<MemoryRouter>{node}</MemoryRouter>); }
function captured(key: string) {
  return h.capture.mock.calls.flatMap(([metrics]) => metrics).find(metric => metric.occurrenceId === key);
}
beforeEach(() => {
  h.capture.mockClear();
  h.units.distance = 'km';
  h.units.speed = 'km/h';
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

describe('NestedDrivingBrief — real compact renderer and unconditional numerical bridge', () => {
  const metrics: StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'distance', rawValue: 1000, label: 'Recorded distance' },
    { metricId: 'count', occurrenceId: 'zero', rawValue: 0, label: 'Returned zero', display: { countTotal: 8 } },
    { metricId: 'power', occurrenceId: 'signed', rawValue: -5000, label: 'Signed power' },
    { metricId: 'percent', occurrenceId: 'missing', rawValue: null, label: 'Missing share' },
    { metricId: 'number', occurrenceId: 'invalid', rawValue: Infinity, label: 'Invalid operand' },
  ];
  const props: ComponentProps<typeof NestedDrivingBrief> = {
    metrics, title: 'Returned evidence', description: 'Independent source, not all-time coverage.',
    period: { kind: 'analysis', label: 'Selected range', start: '2026-08-01T00:00:00Z',
      endExclusive: '2026-08-09T00:00:00Z', timezone: 'UTC', completeness: 'subset',
      provenance: 'Returned records only.' },
  };
  it('preserves SI raw values, zero, signed power, null and invalid separately', () => {
    const { container } = show(<NestedDrivingBrief {...props} />);
    expect(h.capture).toHaveBeenCalledWith(metrics);
    expect(container.querySelector('[data-operational-metric="zero"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('[data-operational-metric="missing"]')).toHaveAttribute('data-value-state', 'missing');
    expect(container.querySelector('[data-operational-metric="invalid"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(screen.getByText('0/8', { selector: '[data-operational-value]' })).toBeVisible();
    expect(screen.getByText('-5.00 kW', { selector: '[data-operational-value]' })).toBeVisible();
    expect(captured('distance')?.rawValue).toBe(1000);
  });
  it('calls the real bridge in loading and retained states without dropping metric labels', () => {
    const view = show(<NestedDrivingBrief {...props} loading />);
    expect(view.container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(view.container.querySelectorAll('[data-operational-metric]')).toHaveLength(5);
    expect(screen.getByText('Recorded distance')).toBeVisible();
    view.rerender(<MemoryRouter><NestedDrivingBrief {...props} retained /></MemoryRouter>);
    expect(h.capture.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Retained source')).toBeVisible();
    expect(screen.getByText('1.00 km', { selector: '[data-operational-value]' })).toBeVisible();
  });
  it('keeps bounds, provenance and raw-denominator context in the actual Review details drawer', () => {
    show(<NestedDrivingBrief {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Returned evidence details' });
    expect(within(drawer).getByText('Returned records only.')).toBeVisible();
    expect(within(drawer).getByText(/2026-08-01T00:00:00Z.*2026-08-09T00:00:00Z.*UTC/)).toBeVisible();
    expect(within(drawer).getByText(/exclusive end/)).toBeVisible();
    expect(within(drawer).getByText(/Returned subset/)).toBeVisible();
    expect(within(drawer).getByText('0/8')).toBeVisible();
  });
  it.each([
    { loading: true, unavailable: false },
    { loading: false, unavailable: true },
    { loading: true, unavailable: true },
  ])('retains usable values and warning semantics during source refresh: %j', (state) => {
    const { container } = show(<NestedDrivingBrief {...props} {...state} retained testId="retained-driving" />);
    expect(screen.getByTestId('retained-driving')).toBeVisible();
    const status = screen.getByText('Retained source');
    expect(status).toBeVisible();
    expect(status).toHaveClass('text-[var(--semantic-warning)]');
    expect(screen.queryByText('Source unavailable')).not.toBeInTheDocument();
    expect(screen.getByText('1.00 km', { selector: '[data-operational-value]' })).toBeVisible();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('0/8')).toBeVisible();
  });
  it('preserves the initial and fatal source shells without manufacturing numerical readings', () => {
    const view = show(<NestedDrivingBrief {...props} loading />);
    expect(screen.getByText('Loading source')).toBeVisible();
    expect(view.container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).queryByText('1.00 km')).not.toBeInTheDocument();
    view.unmount();
    const fatal = show(<NestedDrivingBrief {...props} metrics={metrics.map(metric => ({ ...metric, rawValue: null }))} unavailable />);
    expect(screen.getByText('Source unavailable')).toBeVisible();
    expect(fatal.container.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(5);
    expect(screen.getByText('Recorded distance')).toBeVisible();
  });
  it('preserves specialist display and effective preferences while validating the raw operand', () => {
    const formatter = vi.fn(() => ({ value: 'specialist value', unit: 'source unit' }));
    const preferences: MetricPreferences = {
      units: { ...h.units, locale: 'de-DE', precision: 3 },
      currency: { kind: 'symbol', value: '€' },
    };
    const { container } = show(<NestedDrivingBrief {...props} preferences={preferences} metrics={[
      { metricId: 'number', occurrenceId: 'specialist', rawValue: -12, label: 'Specialist', display: { formatter } },
      { metricId: 'count', occurrenceId: 'source-display', rawValue: 0, label: 'Source display', displayValue: 'Measured zero observations' },
      { metricId: 'count', occurrenceId: 'invalid-source-display', rawValue: -1, label: 'Invalid source display', displayValue: 'Not a valid count' },
    ]} />);
    expect(formatter).toHaveBeenCalledWith(-12, preferences);
    expect(screen.getByText('specialist value source unit', { selector: '[data-operational-value]' })).toBeVisible();
    expect(screen.getByText('Measured zero observations', { selector: '[data-operational-value]' })).toBeVisible();
    expect(container.querySelector('[data-operational-metric="invalid-source-display"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(screen.queryByText('Not a valid count')).not.toBeInTheDocument();
    expect(captured('source-display')?.rawValue).toBe(0);
  });
  it('keeps long unknown-period receipts subdued and reachable through native keyboard review', async () => {
    const user = userEvent.setup();
    const label = 'حدود المصدر غير المعروفة '.repeat(20);
    const reason = 'Independent source did not establish its analysis coverage.';
    const { container } = show(<NestedDrivingBrief {...props} period={{ kind: 'unknown', label, reason }} testId="unknown-driving" />);
    const scope = within(screen.getByTestId('unknown-driving')).getByText(label.trim());
    expect(scope).toHaveClass('min-w-0', 'break-words', 'text-[var(--text-muted)]');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(5);
    const review = screen.getByRole('button', { name: 'Review details' });
    review.focus();
    await user.keyboard('{Enter}');
    const drawer = screen.getByRole('dialog', { name: 'Returned evidence details' });
    expect(within(drawer).getByText(reason)).toBeVisible();
    expect(within(drawer).getByText(label.trim())).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(review).toHaveFocus();
  });
});

describe('Released nested driving quantity contracts', () => {
  it('retains cadence seconds, independent invalid/duplicate counts and minimum precision', () => {
    const base = buildDriveDnaModel(undefined);
    const model = { ...base, sample: { ...base.sample, returnedRows: 8, validRows: 6,
      observedSpanS: 60, medianIntervalS: 0.5, largestGapS: 2,
      invalidTimestampCount: 2, duplicateTimestampCount: 1 } };
    function Cadence() { return <DriveDnaCadenceMetrics model={model} units={useUnits()} />; }
    show(<Cadence />);
    expect(captured('median-interval')?.rawValue).toBe(0.5);
    expect(captured('largest-gap')?.rawValue).toBe(2);
    expect(screen.getByText('0.008 min', { selector: '[data-operational-value]' })).toBeVisible();
    expect(screen.getByText('2 / 1', { selector: '[data-operational-value]' })).toBeVisible();
    expect(screen.getByText('Invalid / duplicate')).toBeVisible();
  });
  it('keeps all five forward-folded channel denominators and zero availability', () => {
    const base = buildDriveDnaModel(undefined);
    const model = { ...base, sample: { ...base.sample, validRows: 4 },
      coverage: { ...base.coverage, speed: { availableCount: 0, availablePct: 0 } } };
    const { container } = show(<DriveDnaSignalCoverageGrid model={model} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(5);
    expect(captured('speed')?.rawValue).toBe(0);
    expect(captured('speed')?.display?.countTotal).toBe(4);
    expect(screen.getByText('0.00% available')).toBeVisible();
  });
  it('preserves a signed supported cold/warm difference and both cohort populations', () => {
    const base = summarizeColdStarts([]);
    const summary = { ...base, sampleSufficient: true, penaltyWhPerKm: -20, penaltyShare: -0.1,
      cold: { ...base.cold, drives: 5, whPerKm: 180 },
      warm: { ...base.warm, drives: 7, whPerKm: 200 } };
    show(<ColdWarmComparison summary={summary} penaltyCostLabel={null} state={sectionState} />);
    expect(captured('cold-warm-penalty')?.rawValue).toBe(-0.02);
    expect(captured('cold-consumption')?.rawValue).toBe(0.18);
    expect(captured('warm-consumption')?.rawValue).toBe(0.2);
    expect(screen.getByText('-20.00 Wh/km', { selector: '[data-operational-value]' })).toBeVisible();
    expect(screen.getAllByText('5 cold and 7 warm observations').length).toBeGreaterThan(0);
    expect(screen.getByText(/no avoidable energy is claimed/)).toBeVisible();
  });
  it('retains Explorer eligibility denominator separately from coordinate and timestamp proxies', () => {
    const base = summarizeExplorer([]);
    show(<CoverageMetrics eligibility={{ ...base.eligibility, observed: 9, eligible: 4,
      coordinateEligible: 6, usedStartTimestamp: 2 }} />);
    expect(captured('eligible-arrivals')?.rawValue).toBe(4);
    expect(captured('eligible-arrivals')?.display?.countTotal).toBe(9);
    expect(captured('coordinate-rows')?.rawValue).toBe(6);
    expect(captured('timestamp-proxies')?.rawValue).toBe(2);
  });
  it('normalizes discovery days to canonical seconds without changing the specialist day display', () => {
    const base = summarizeExplorer([]);
    const summary = { ...base, evidence: { ...base.evidence, cadenceSufficient: true },
      cadence: { ...base.cadence, discoveries: 3, medianGapDays: 2, longestGapDays: 4, latestGapDays: 0 } };
    show(<DiscoveryCadenceSummary summary={summary} />);
    expect(captured('median-gap')?.rawValue).toBe(172800);
    expect(captured('latest-gap')?.rawValue).toBe(0);
    expect(screen.getByText('0 days', { selector: '[data-operational-value]' })).toBeVisible();
  });
  it('accounts for an empty returned rhythm history as measured zero rather than missing', () => {
    const summary = buildDrivingRhythm([], { nowMs: now, timeZone: 'UTC', rangeStart: '2026-08-01', rangeEnd: '2026-08-08' });
    const { container } = show(<RhythmCoverageSummary summary={summary} />);
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(4);
    expect(captured('returned')?.rawValue).toBe(0);
    expect(screen.getByText(/selected date scope returns drives/)).toBeVisible();
  });
  it('keeps weekday/weekend rates tied to their independent selected-local-day denominators', () => {
    const base = buildDrivingRhythm([], { nowMs: now, timeZone: 'UTC', rangeStart: '2026-08-01', rangeEnd: '2026-08-08' });
    const summary = { ...base, total: 4, dayTypes: {
      weekday: { ...base.dayTypes.weekday, drives: 3, calendarDays: 6, drivesPerCalendarDay: 0.5, activeDays: 2, averageDistanceM: 1000 },
      weekend: { ...base.dayTypes.weekend, drives: 1, calendarDays: 2, drivesPerCalendarDay: 0.5, activeDays: 1, averageDistanceM: null },
    } };
    show(<WeekdayWeekendComparison summary={summary} state={sectionState} />);
    expect(captured('weekday-rate')?.rawValue).toBe(0.5);
    expect(captured('weekend-rate')?.rawValue).toBe(0.5);
    expect(captured('weekend-distance')?.rawValue).toBeNull();
    expect(screen.getAllByText('6 selected local calendar days define the rate denominator.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2 selected local calendar days define the rate denominator.').length).toBeGreaterThan(0);
  });
  it('keeps linked-parking seconds and observed stopovers without changing journey arithmetic', () => {
    const base = analyzeJourneyFragmentation([], now, 'UTC', { maxParkingGapMin: 120, historyLimit: 1000 });
    show(<ElapsedComposition result={{ ...base, journeyCount: 1, drivingSeconds: 60, observedParkingSeconds: 0, linkedPairs: 0 }} />);
    expect(captured('driving-time')?.rawValue).toBe(60);
    expect(captured('parking-time')?.rawValue).toBe(0);
    expect(captured('linked-stopovers')?.rawValue).toBe(0);
    expect(screen.getByText('0.00 min', { selector: '[data-operational-value]' })).toBeVisible();
  });
  it('preserves signed whole-journey energy intensity and complete-energy coverage in the drawer', () => {
    const base = analyzeJourneyFragmentation([], now, 'UTC', { maxParkingGapMin: 120, historyLimit: 1000 });
    const result = { ...base, journeyCount: 4, energyComparison: { ...base.energyComparison,
      singleDrive: { ...base.energyComparison.singleDrive, energyIntensityWhPerM: 0.2, journeys: 2, completeEnergyJourneys: 2, completeEnergyDistanceM: 10000 },
      multiDrive: { ...base.energyComparison.multiDrive, energyIntensityWhPerM: 0.18, journeys: 2, completeEnergyJourneys: 1, completeEnergyDistanceM: 5000 },
      observedDifferenceWhPerM: -0.02 } };
    show(<EnergyIntensityPanel result={result} />);
    expect(captured('observed-difference')?.rawValue).toBe(-0.02);
    expect(screen.getByText('-0.02 kWh / km', { selector: '[data-operational-value]' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('5.00 km complete-energy distance')).toBeVisible();
    expect(within(screen.getByRole('dialog')).getByText(/Missing energy is excluded/)).toBeVisible();
  });
  it('retains the short-fragment denominator, zero compact chains and canonical included meters', () => {
    const base = analyzeJourneyFragmentation([], now, 'UTC', { maxParkingGapMin: 120, historyLimit: 1000 });
    show(<StructureIndicators result={{ ...base, includedDrives: 3, shortFragmentCount: 1,
      shortFragmentDenominator: 3, compactObservedChainCount: 0, totalDistanceM: 1000 }} />);
    expect(captured('short-fragments')?.display?.countTotal).toBe(3);
    expect(captured('compact-chains')?.rawValue).toBe(0);
    expect(captured('included-distance')?.rawValue).toBe(1000);
  });
  it('keeps thirteen motor fields with numeric RPM/torque and the non-positive isolation sentinel', () => {
    const motor = motorFixture({
      ts: '2026-08-08T12:00:00Z', vehicle_id: 42, shift_state: 'P', power_kw: 0,
      regen_kw: null, source: 'reported', motor_rpm_front: 0, motor_rpm_rear: 1500,
      torque_nm_front: -12, torque_nm_rear: 0, motor_temp_c_front: 30,
      motor_temp_c_rear: null, inverter_temp_c: null, battery_temp_c: null,
    });
    const state = deriveDataState({ data: motor, dataUpdatedAt: now });
    const { container } = show(<LiveMotorPanel motorLatest={motor} isolationResistance={0}
      state={state} loading={false} connected={false} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(13);
    expect(captured('rpm-front')).toMatchObject({ metricId: 'number', rawValue: 0 });
    expect(captured('torque-front')).toMatchObject({ metricId: 'number', rawValue: -12 });
    expect(captured('isolation')?.rawValue).toBeNull();
    expect(container.querySelector('[data-operational-metric="regen"]')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByText('Live motor record details')).toBeVisible();
    expect(screen.getAllByText(/freshness and continuous coverage are not established/).length).toBeGreaterThan(0);
  });
  it('preserves the selected-ride empty shell and selection instructions without inventing totals', () => {
    show(<RideOverview drive={null} />);
    expect(screen.getByText('No trip selected')).toBeVisible();
    expect(screen.getByText('Choose a trip with recorded data to review its outcome.')).toBeVisible();
    expect(h.capture).not.toHaveBeenCalled();
  });
  it('keeps selected-ride SI facts, actual event bounds, detail link and zero recovered energy', () => {
    const drive = driveFixture({ id: 82, startTs: '2026-08-08T10:00:00Z', endTs: '2026-08-08T10:10:00Z',
      distanceM: 1000, durationS: 600, energyUsedWh: 200, regenEnergyWh: 0 });
    const { container } = show(<RideOverview drive={drive} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(captured('ride-distance')?.rawValue).toBe(1000);
    expect(captured('ride-energy-recovered')?.rawValue).toBe(0);
    expect(screen.getByRole('link', { name: 'Open trip details' })).toHaveAttribute('href', '/drives/82');
    expect(screen.getByText(/#82.*2026-08-08T10:00:00Z.*2026-08-08T10:10:00Z/)).toBeVisible();
    expect(screen.getByText(/recorded regeneration, not peak regen power/)).toBeVisible();
  });
  it('keeps completed-week grading separate from the ungraded active-week snapshot', () => {
    const summary = summarizeTarget([
      driveFixture({ id: 1, startTs: '2026-08-01T12:00:00Z', endTs: '2026-08-01T12:10:00Z', distanceM: 1000, energyUsedWh: 150 }),
      driveFixture({ id: 2, startTs: '2026-08-05T12:00:00Z', endTs: '2026-08-05T12:10:00Z', distanceM: 1000, energyUsedWh: 170 }),
    ], 160, now);
    const { container } = show(<GoalPulse summary={summary} state={sectionState} />);
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(2);
    expect(captured('completed-consumption')?.rawValue).toBe(0.15);
    expect(captured('active-consumption')?.rawValue).toBe(0.17);
    expect(captured('active-drives')?.rawValue).toBe(1);
    expect(screen.getAllByText('In progress · not graded').length).toBeGreaterThan(0);
    fireEvent.click(within(screen.getByRole('region', { name: 'Completed-week consumption' }))
      .getByRole('button', { name: 'Review details' }));
    expect(screen.getAllByText(/target grading and streaks exclude the active week/).length).toBeGreaterThan(0);
  });
  it('does not label absent observatory reset or unknown-distance data as measured zero', () => {
    const { container } = show(<FsdObservatoryPanel insights={undefined} state={{ ...sectionState, noVehicle: false }} />);
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(4);
    expect(captured('counter-resets')?.rawValue).toBeUndefined();
    expect(captured('unknown-drive-distance')?.rawValue).toBeUndefined();
    expect(screen.getByText('Stitched journal')).toBeVisible();
    expect(screen.getByText('Commute stories')).toBeVisible();
  });
  it('retains the independent FSD comparison placeholders and all attribution/export section shells', () => {
    const { container } = show(<FsdDriveAnalyticsPanels insights={undefined} state={{ ...sectionState, noVehicle: false }} />);
    const comparison = screen.getByTestId('fsd-period-comparison');
    expect(comparison.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(3);
    expect(captured('previous-fsd-distance')?.rawValue).toBeUndefined();
    expect(container.querySelector('[data-testid="fsd-attribution"]')).not.toBeNull();
    expect(screen.getByText('Counter-reset timeline')).toBeVisible();
    expect(screen.getAllByText('Periods lack comparable trusted coverage').length).toBeGreaterThan(0);
  });
});
