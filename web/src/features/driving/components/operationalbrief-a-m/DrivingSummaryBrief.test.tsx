import { fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatMetric } from '@/components/data-display/stat-reference';
import type { UnitPref } from '@/lib/unitConversion';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';
import { ExplorerKpis } from '../explorer/ExplorerKpis';
import { summarizeExplorer } from '../../lib/explorer';
import { summarizeColdStarts } from '../../lib/coldStart';
import { summarizeTarget } from '../../lib/efficiencyTarget';
import { buildDrivingRhythm } from '../../lib/drivingRhythm';
import { analyzeArrivalReliability } from '../../lib/arrivalReliability';
import { forecastDepartures } from '../../lib/departureForecast';
import { buildDestinationTransitions } from '../../lib/destinationTransitions';
import { analyzeJourneyFragmentation } from '../../lib/journeyFragmentation';
import { buildDriveDnaModel } from '../../lib/driveDNA';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { ColdStartBrief } from './ColdStartBrief';
import { DrivingRhythmBrief } from './DrivingRhythmBrief';
import { EfficiencyTargetBrief } from './EfficiencyTargetBrief';
import { ArrivalEvidenceBrief } from './ArrivalEvidenceBrief';
import { DepartureEvidenceBrief } from './DepartureEvidenceBrief';
import { DestinationEvidenceBrief } from './DestinationEvidenceBrief';
import { JourneyEvidenceBrief } from './JourneyEvidenceBrief';
import { DriveDnaEvidenceBrief } from './DriveDnaEvidenceBrief';
import { FsdEvidenceBrief } from './FsdEvidenceBrief';
import { CompareVerdictBrief } from './CompareVerdictBrief';
import { DrivetrainSummary } from './DrivetrainSummary';
import { sensorsFor } from '../drivetrain-health-modernization/model';
import { deriveDataState } from '@/api/dataState';
import { useUnits } from '@/hooks/useUnits';

const h = vi.hoisted(() => ({
  distance: 'km' as 'km' | 'mi',
  formatDistance: vi.fn((raw: number | null | undefined) => raw == null ? '—' : `${raw / 1000} km`),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: h.distance, speed: h.distance === 'mi' ? 'mph' : 'km/h',
      temperature: '°C', pressure: 'kPa', energy: 'kWh', power: 'kW',
      duration: 'min', precision: 2, locale: 'en-US',
    } satisfies UnitPref,
    formatDistance: h.formatDistance,
    formatEnergy: (raw: number | null | undefined) => raw == null ? '—' : `${raw / 1000} kWh`,
    formatDuration: (raw: number | null | undefined) => raw == null ? '—' : `${raw / 60} min`,
    formatSpeed: (raw: number | null | undefined) => raw == null ? '—' : `${raw * 3.6} km/h`,
  }),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));

beforeEach(() => {
  h.distance = 'km';
  h.formatDistance.mockClear();
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
});

const metrics: readonly StatMetric[] = [
  { metricId: 'distance', occurrenceId: 'distance', rawValue: 1000,
    label: 'Observed distance', description: 'Returned drive totals, not lifetime travel.',
    context: 'Vehicle 42; selected window.' },
  { metricId: 'count', occurrenceId: 'zero', rawValue: 0,
    label: 'Eligible arrivals', description: 'A successful empty result is a measured count of zero.' },
  { metricId: 'distance', occurrenceId: 'unknown', rawValue: null,
    label: 'Unknown distance', description: 'No measurement supplied.' },
  { metricId: 'number', occurrenceId: 'invalid', rawValue: Number.NaN,
    label: 'Invalid source', description: 'Non-finite measurements remain invalid.' },
];

function summary(extra: Partial<ComponentProps<typeof DrivingSummaryBrief>> = {}) {
  return <MemoryRouter><DrivingSummaryBrief metrics={metrics}
    title="Observed drive evidence" description="One returned analysis window."
    scope="2026-08-01–2026-08-08; returned subset."
    provenance="Recorded drives; coverage unknown." onRetry={vi.fn()} {...extra} /></MemoryRouter>;
}

describe('DrivingSummaryBrief — real OperationalBrief and numerical bridge', () => {
  it('retains raw SI operands and separates measured zero, missing and invalid', () => {
    const { result } = renderHook(() => useOperationalMetrics(metrics));
    expect(result.current.map(metric => metric.rawValue)).toEqual([1000, 0, null, Number.NaN]);
    expect(result.current.map(metric => metric.valueState)).toEqual(['value', 'value', 'missing', 'invalid']);
    const { container } = render(summary());
    expect(container.querySelector('[data-operational-metric="zero"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('[data-operational-metric="unknown"]')).toHaveAttribute('data-value-state', 'missing');
    expect(container.querySelector('[data-operational-metric="invalid"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(screen.getByText('1.00 km', { selector: '[data-operational-value]' })).toBeVisible();
  });

  describe('DrivetrainSummary — independent snapshot, recent-power and all-time sources', () => {
    const health: NonNullable<ComponentProps<typeof DrivetrainSummary>['health']> = {
      frontMotorTempC: 55, rearMotorTempC: 60, inverterTempC: 48, batteryTempC: 30,
      motorStatus: 'Nominal', overallHealth: 'good',
    };
    const stats: NonNullable<ComponentProps<typeof DrivetrainSummary>['stats']> = {
      totalDrives: 12, totalDistanceKm: 500, totalDurationS: 3600, avgEfficiencyWhKm: 150,
      avgSpeedKmh: 60, topSpeedKmh: 120, regenRatio: 0.15, regenEnergyWh: 2000, co2SavedKg: 30,
    };
    const received = Date.parse('2026-10-01T12:00:00Z');
    const healthState = deriveDataState({ data: health, dataUpdatedAt: received });
    const statsState = deriveDataState({ data: stats, dataUpdatedAt: received });
    const drivesState = deriveDataState({ data: [], dataUpdatedAt: received });
    const props: ComponentProps<typeof DrivetrainSummary> = {
      health, stats, sensors: sensorsFor(health), power: { peakPower: 75000, avgPowerMax: 50000, minRegenPower: null },
      healthState, statsState, drivesState, healthLoading: false, statsLoading: false,
    };

    it('retains policy-based gauge, raw-unit summaries, windows and the real details drawer', () => {
      const { container } = render(<MemoryRouter><DrivetrainSummary {...props} /></MemoryRouter>);
      expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(3);
      expect(container.querySelector('[data-operational-metric="frontMotor"]')).toHaveAttribute('data-value-state', 'value');
      expect(screen.getAllByText(/rating, not a measured percentage/).length).toBeGreaterThan(0);
      expect(screen.getByText('500.00 km', { selector: '[data-operational-value]' })).toBeVisible();
      expect(screen.getByText('75.00 kW', { selector: '[data-operational-value]' })).toBeVisible();
      const temperature = screen.getByRole('region', { name: 'Temperature Details' });
      fireEvent.click(within(temperature).getByRole('button', { name: 'Review details' }));
      const drawer = screen.getByRole('dialog', { name: 'Temperature Details details' });
      expect(within(drawer).getAllByText(/battery-module proxies, not direct motor measurements/).length).toBeGreaterThan(0);
      expect(within(drawer).getByText(/Response received 2026-10-01T12:00:00.000Z/)).toBeVisible();
      expect(within(drawer).getAllByText(/of max/).length).toBeGreaterThan(0);
    });

    it('retains temperatures after refresh failure independently of valid recent-power and all-time statistics', () => {
      const staleHealth = deriveDataState({ data: health, dataUpdatedAt: received, error: new Error('Health refresh failed'), isError: true });
      render(<MemoryRouter><DrivetrainSummary {...props} healthState={staleHealth} /></MemoryRouter>);
      const temperature = screen.getByRole('region', { name: 'Temperature Details' });
      expect(within(temperature).getByText('Retained evidence')).toBeVisible();
      expect(within(temperature).getByText('55.00°C', { selector: '[data-operational-value]' })).toBeVisible();
      expect(screen.getByText('75.00 kW', { selector: '[data-operational-value]' })).toBeVisible();
      expect(screen.getByText('500.00 km', { selector: '[data-operational-value]' })).toBeVisible();
    });
  });

  it('uses saved display units without changing raw meter inputs', () => {
    const view = render(summary());
    h.distance = 'mi';
    view.rerender(summary());
    expect(screen.getByText('0.62 mi', { selector: '[data-operational-value]' })).toBeVisible();
    const { result } = renderHook(() => useOperationalMetrics(metrics));
    expect(result.current[0].rawValue).toBe(1000);
  });

  it('marks loading while keeping every label and source limitation visible', () => {
    const { container } = render(summary({ loading: true, metrics: metrics.map(metric => ({ ...metric, rawValue: null })) }));
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(container.querySelector('[data-operational-value]')).toBeNull();
    expect(screen.getByText('Returned drive totals, not lifetime travel.')).toBeVisible();
    expect(screen.getByText('Loading evidence')).toBeVisible();
  });

  it('keeps retained evidence and real drawer context after a refresh failure', () => {
    render(summary({ retained: true }));
    expect(screen.getByText('Retained evidence')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Observed drive evidence details' });
    expect(within(drawer).getByText('Returned drive totals, not lifetime travel.')).toBeVisible();
    expect(within(drawer).getByText('Vehicle 42; selected window.')).toBeVisible();
    expect(within(drawer).getByText('Recorded drives; coverage unknown.')).toBeVisible();
    expect(within(drawer).queryByText(/100% confidence/i)).toBeNull();
  });

  it('keeps an actionable fatal source error beside the metric shell', () => {
    const retry = vi.fn();
    const { container } = render(summary({ error: new Error('source unavailable'), onRetry: retry,
      metrics: metrics.map(metric => ({ ...metric, rawValue: null })) }));
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(screen.getByText('Source unavailable')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('Explorer four-metric source contract', () => {
  it('preserves observed, inferred, eligibility, P90 and farthest distinctions in the real drawer', () => {
    const base = summarizeExplorer([]);
    const observed = {
      ...base, uniquePlaces: 3, radiusM: 25000,
      inferredBase: { label: 'Observed cluster', visits: 8, arrivalShare: 0.5,
        firstObservedAt: '2026-08-01T08:00:00Z', lastObservedAt: '2026-08-08T08:00:00Z' },
      farthest: { id: 'd-2', ordinal: 2, label: 'Observed destination', visits: 2, repeatVisits: 1,
        distanceFromBaseM: 40000, firstVisitedAt: '2026-08-01T08:00:00Z',
        lastVisitedAt: '2026-08-08T08:00:00Z', firstVisitMonth: '2026-08' },
      eligibility: { ...base.eligibility, observed: 20, eligible: 16 },
      evidence: { ...base.evidence, baseSufficient: true },
      historyCapReached: true,
    };
    const { container } = render(<MemoryRouter><ExplorerKpis summary={observed}
      state={{ isLoading: false, error: null, onRetry: vi.fn() }} formatDistance={h.formatDistance} retained /></MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    for (const label of ['Observed destinations', 'P90 roaming radius', 'Farthest observed destination', 'Inferred observed base']) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(h.formatDistance).toHaveBeenCalledWith(25000);
    expect(h.formatDistance).toHaveBeenCalledWith(40000);
    expect(screen.getByText('16 eligible located arrivals')).toBeVisible();
    expect(screen.getByText('8 arrivals; inferred, not a verified home')).toBeVisible();
    expect(screen.getByText(/history cap reached/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('90% of non-base arrivals are within this distance')).toBeVisible();
    expect(within(drawer).getByText('Observed destination')).toBeVisible();
    expect(within(drawer).getByText('Distance from the inferred observed base.')).toBeVisible();
  });

  const now = Date.parse('2026-08-08T12:00:00Z');
  const sectionState = { isLoading: false, error: null, onRetry: vi.fn() };
  const resolvedState = { ...sectionState, vehicleSelected: true, isResolved: true, refreshError: null };

  describe('Domain summaries retain their real operands and source contexts', () => {
    it('retains the fair A/B verdict, comparable denominator and trip-size neutrality in its drawer', () => {
      render(<MemoryRouter><CompareVerdictBrief summary={{ verdict: 'a', aWins: 2, bWins: 1, ties: 0, comparableCount: 3 }}
        state={{ ...sectionState, emptyMessage: null }} /></MemoryRouter>);
      expect(screen.getByRole('group', { name: 'Fair metric score: Drive A 2, Drive B 1' })).toBeInTheDocument();
      expect(screen.getByText('Drive A leads')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
      const drawer = within(screen.getByRole('dialog'));
      expect(drawer.getAllByText('Drive A wins 2 of 3 fair metrics.').length).toBeGreaterThan(0);
      expect(drawer.getAllByText('Distance, duration, total energy, and absolute battery use stay neutral because trip size changes those totals.').length).toBeGreaterThan(0);
    });

    it('preserves signed cold-versus-warm differences, estimated energy and configured-rate cost context', () => {
      const model = { ...summarizeColdStarts([]), penaltyWhPerKm: -20,
        totalPenaltyWh: -2000, penaltyShare: -0.1, coldShare: 0.25, analyzed: 12 };
      render(<MemoryRouter><ColdStartBrief summary={model} penaltyCostLabel="−$0.40"
        {...sectionState} scope="2026-08-01–2026-08-08; selected returned drives" retained /></MemoryRouter>);
      expect(screen.getByText('-20.00 Wh/km', { selector: '[data-operational-value]' })).toBeVisible();
      expect(screen.getByText('−10.00% vs warm starts')).toBeVisible();
      expect(screen.getByText('−$0.40')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
      expect(within(screen.getByRole('dialog')).getByText('drives with a known gap')).toBeVisible();
    });

    it('keeps zero rhythmic departures separate from an unknown favorite and an unsupported predictability index', () => {
      const model = buildDrivingRhythm([], { nowMs: now, timeZone: 'UTC', rangeStart: '2026-08-01', rangeEnd: '2026-08-08' });
      const { container } = render(<MemoryRouter><DrivingRhythmBrief summary={model}
        {...sectionState} scope="2026-08-01–2026-08-08 · UTC" retained={false} /></MemoryRouter>);
      expect(container.querySelector('[data-operational-metric="drives"]')).toHaveAttribute('data-value-state', 'value');
      expect(container.querySelector('[data-operational-metric="favorite"]')).toHaveAttribute('data-value-state', 'missing');
      expect(container.querySelector('[data-operational-metric="predictability"]')).toHaveAttribute('data-value-state', 'missing');
      expect(screen.getByRole('link', { name: 'Browse drives' })).toHaveAttribute('href', '/drives');
    });

    it('retains the saved target while completed-week hit-rate and overall consumption remain unknown without evidence', () => {
      const model = summarizeTarget([], 160, now, { historyLimit: 1000 });
      const { container } = render(<MemoryRouter><EfficiencyTargetBrief summary={model}
        targetWhPerKm={160} state={sectionState} retained={false} /></MemoryRouter>);
      expect(container.querySelector('[data-operational-metric="target"]')).toHaveAttribute('data-value-state', 'value');
      expect(container.querySelector('[data-operational-metric="hit-rate"]')).toHaveAttribute('data-value-state', 'missing');
      expect(screen.getByText('Across 0 completed weeks')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
      expect(within(screen.getByRole('dialog')).getByText('Saved canonically in Wh/km')).toBeVisible();
    });

    it('retains all six arrival measurements, descriptive index semantics and the p90 source buffer', () => {
      const model = analyzeArrivalReliability([], now, 'UTC', { historyLimit: 1000 });
      const { container } = render(<MemoryRouter><ArrivalEvidenceBrief analysis={model} state={resolvedState}
        locale="en-US" formatDuration={(raw) => raw == null ? '—' : `${raw / 60} min`} /></MemoryRouter>);
      expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
      expect(container.querySelector('[data-operational-metric="routes"]')).toHaveAttribute('data-value-state', 'value');
      expect(container.querySelector('[data-operational-metric="p90"]')).toHaveAttribute('data-value-state', 'missing');
      fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
      expect(within(screen.getByRole('dialog')).getByText('descriptive 0–100 index')).toBeVisible();
    });

    it('retains departure likelihood evidence without turning its support index into confidence', () => {
      const model = forecastDepartures([], now, 'UTC', { historyLimit: 1000 });
      const { container } = render(<MemoryRouter><DepartureEvidenceBrief forecast={model} state={resolvedState}
        locale="en-US" timeZone="UTC" /></MemoryRouter>);
      expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
      expect(container.querySelector('[data-operational-metric="included"]')).toHaveAttribute('data-value-state', 'value');
      expect(container.querySelector('[data-operational-metric="horizon"]')).toHaveAttribute('data-value-state', 'missing');
      fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
      expect(within(screen.getByRole('dialog')).getByText('Support index needs qualifying departures')).toBeVisible();
    });

    it('keeps absent latest destinations distinct from zero accepted transitions', () => {
      const model = buildDestinationTransitions([], now, 'UTC', { historyLimit: 1000 });
      const { container } = render(<MemoryRouter><DestinationEvidenceBrief model={model} state={resolvedState}
        locale="en-US" /></MemoryRouter>);
      expect(container.querySelector('[data-operational-metric="transitions"]')).toHaveAttribute('data-value-state', 'value');
      expect(container.querySelector('[data-operational-metric="latest"]')).toHaveAttribute('data-value-state', 'missing');
      expect(screen.getByText(/No returned row is available/)).toBeVisible();
    });

    it('shows unresolved journey counts as missing rather than zero when no vehicle source exists', () => {
      const model = analyzeJourneyFragmentation([], now, 'UTC', { maxParkingGapMin: 120, historyLimit: 1000 });
      const { container } = render(<MemoryRouter><JourneyEvidenceBrief result={model}
        {...sectionState} hasVehicle={false} available={false} retained={false} /></MemoryRouter>);
      expect(container.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(5);
      expect(screen.getByText('Choose a vehicle to populate this observed history window.')).toBeVisible();
    });

    it('separates unresolved selected-drive telemetry from aggregate drive metadata', () => {
      function Evidence() {
        const units = useUnits();
        return <DriveDnaEvidenceBrief drive={null} model={buildDriveDnaModel(undefined)}
          units={units} capReached={false} state={{ vehicleSelected: true, hasDrive: false,
            list: { ...sectionState, isResolved: true, refreshError: null },
            telemetry: { ...sectionState, isResolved: false, refreshError: null } }} />;
      }
      const { container } = render(<MemoryRouter><Evidence /></MemoryRouter>);
      expect(container.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(6);
      fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
      expect(within(screen.getByRole('dialog')).getByText('Power-available rows after forward fold, not time share')).toBeVisible();
    });

    it('does not invent zero counter distance, activity or a best day for an unavailable FSD source', () => {
      const { container } = render(<MemoryRouter><FsdEvidenceBrief insights={undefined}
        state={{ ...sectionState, noVehicle: true }} scope="2026-08-01–2026-08-08 (exclusive end) · UTC"
        retained={false} /></MemoryRouter>);
      expect(container.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(4);
      expect(screen.getByText('Select a vehicle')).toBeVisible();
      expect(screen.getByText('Self-driving counter not reported in this period')).toBeVisible();
      expect(screen.getByText('Needs the self-driving counter, which was not reported')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
      expect(within(screen.getByRole('dialog')).getByText('Nothing measured in this period')).toBeVisible();
    });
  });

  it('keeps a true empty destination count separate from unknown radius, farthest and inferred base', () => {
    const { container } = render(<MemoryRouter><ExplorerKpis summary={summarizeExplorer([])}
      state={{ isLoading: false, error: null, onRetry: vi.fn() }} formatDistance={h.formatDistance} /></MemoryRouter>);
    expect(container.querySelector('[data-operational-metric="observed-destinations"]')).toHaveAttribute('data-value-state', 'value');
    for (const key of ['p90-radius', 'farthest-destination', 'inferred-base']) {
      expect(container.querySelector(`[data-operational-metric="${key}"]`)).toHaveAttribute('data-value-state', 'missing');
    }
    expect(h.formatDistance).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Browse drives' })).toHaveAttribute('href', '/drives');
  });
});
