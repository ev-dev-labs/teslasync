import type { ReactNode } from 'react';
import type { OperationalBriefProps } from '@/components/data-display/OperationalBrief';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ChartContainerProps } from '@/components/charts/ChartContainer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { Drive } from '@/types/driving';
import { SpeedBandScorecard } from '../components/speed-sweet-spot/SpeedBandScorecard';
import { computeSweetSpot } from '../lib/speedSweetSpot';

const {
  pageTitleMock,
  selectedVehicleMock,
  unitsMock,
  useDrivesMock,
  sharedRange,
  chartController,
} = vi.hoisted(() => ({
  pageTitleMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  unitsMock: vi.fn(),
  useDrivesMock: vi.fn(),
  sharedRange: { set: (_range: { start: string; end: string }) => {} },
  chartController: { enabled: false },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) =>
          text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: (...args: unknown[]) => useDrivesMock(...args),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => selectedVehicleMock(),
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: (title: string) => pageTitleMock(title),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => unitsMock(),
}));

vi.mock('@/hooks/useRangeState', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    useRangeState: () => {
      const [range, setRange] = React.useState({
        start: '2025-01-01',
        end: '2026-08-07',
      });
      sharedRange.set = setRange;
      return {
        ...range,
        startInstant: `${range.start}T07:00:00.000Z`,
        endInstantExclusive: range.end === '2026-07-31'
          ? '2026-08-01T07:00:00.000Z'
          : '2026-08-08T07:00:00.000Z',
        setRange,
      };
    },
  };
});

vi.mock('@/components/forms', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    VehicleSelect: () =>
      React.createElement('div', { 'data-testid': 'vehicle-select' }),
    RangePicker: (props: {
      value: { start: string; end: string };
      onChange: (range: { start: string; end: string }) => void;
      triggerTestId?: string;
    }) =>
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': props.triggerTestId,
          'data-range': `${props.value.start}:${props.value.end}`,
          onClick: () =>
            props.onChange({ start: '2026-07-01', end: '2026-07-31' }),
        },
        'range',
      ),
  };
});

vi.mock('@/components/layout', () => ({
  PageLayout: ({
    title,
    subtitle,
    actions,
    children,
  }: {
    title: string;
    subtitle: string;
    actions: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {actions}
      {children}
    </main>
  ),
  Grid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Keep the real state/recovery widgets without importing unrelated barrel widgets.
vi.mock('@/components/feedback', async () => {
  const empty = await vi.importActual<typeof import('@/components/feedback/EmptyState')>(
    '@/components/feedback/EmptyState',
  );
  const warning = await vi.importActual<typeof import('@/components/feedback/StaleRefreshWarning')>(
    '@/components/feedback/StaleRefreshWarning',
  );
  const alert = await vi.importActual<typeof import('@/components/feedback/AlertBanner')>(
    '@/components/feedback/AlertBanner',
  );
  return {
    AlertBanner: alert.AlertBanner,
    EmptyState: empty.EmptyState,
    StaleRefreshWarning: warning.StaleRefreshWarning,
    QueryError: ({ error, onRetry }: { error: unknown; onRetry?: () => void }) => (
      <div role="alert">{String(error)}<button type="button" onClick={onRetry}>Retry</button></div>
    ),
  };
});

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));

// Only isolate the shared renderer. The summary, trust labels, metric validation,
// preference hooks and SI display formatters all run their production code.
vi.mock('@/components/data-display', () => ({
  OperationalBrief: ({ testId, statusLabel, metrics, loading, actions }: OperationalBriefProps) => (
    <div data-testid={testId}>
      <p>{statusLabel}</p>
      {metrics.map((metric) => (
        <div key={metric.key} data-testid={`metric-${metric.key}`}
          data-raw-value={metric.rawValue ?? undefined} data-value-state={metric.valueState}>
          <span>{metric.label}</span>
          <span>{loading ? 'Loading measurement' : metric.value}</span>
          {metric.detail}
        </div>
      ))}
      {actions}
    </div>
  ),
}));

vi.mock('@/features/onboarding/components/NoVehicleSelected', () => ({
  NoVehicleSelected: ({ pageTitle }: { pageTitle: string }) => (
    <div data-testid="no-vehicle">{pageTitle}</div>
  ),
}));

type State = { isLoading: boolean; error: unknown; onRetry?: () => void };
type SummaryProbe = {
  sweetSpot: { fromKph: number; whPerKm: number } | null;
};
const status = (state: State) =>
  state.error ? 'error' : state.isLoading ? 'loading' : 'ready';
const section = (
  testId: string,
  state: State,
  summary?: SummaryProbe,
) => (
  <section
    data-testid={testId}
    data-model-from={summary?.sweetSpot?.fromKph}
    data-model-wh={summary?.sweetSpot?.whPerKm}
  >
    {status(state)}
    {state.error != null && <button type="button" onClick={state.onRetry}>Retry {testId}</button>}
  </section>
);

vi.mock('../components/operationalbrief-n-z/SweetSpotSummaryBrief', async () => {
  const actual = await vi.importActual<
    typeof import('../components/operationalbrief-n-z/SweetSpotSummaryBrief')
  >('../components/operationalbrief-n-z/SweetSpotSummaryBrief');
  const ActualSummary = actual.SweetSpotSummaryBrief;

  return {
    SweetSpotSummaryBrief: (props: Parameters<typeof ActualSummary>[0]) => (
      <div data-testid="speed-sweet-spot-kpi-state" data-state={status(props)}>
        <ActualSummary {...props} />
      </div>
    ),
  };
});

vi.mock('../components/operationalbrief-n-z/SweetSpotEvidenceBrief', () => ({
    SweetSpotEvidenceBrief: (props: {
      state: State;
      summary: SummaryProbe;
    }) => section('speed-sweet-spot-evidence', props.state, props.summary),
}));

vi.mock('../components/operationalbrief-n-z/SweetSpotMethodBrief', () => ({
    SweetSpotMethodBrief: (props: { state: State }) =>
      section('speed-sweet-spot-method', props.state),
}));

vi.mock('@/components/charts', async () => {
  const { ChartHiddenSeriesProvider, useChartHiddenSeries } = await vi.importActual<
    typeof import('@/components/charts/ChartHiddenSeriesContext')
  >('@/components/charts/ChartHiddenSeriesContext');
  const { LegendSeriesLabel } = await vi.importActual<
    typeof import('@/components/charts/ChartLegend')
  >('@/components/charts/ChartLegend');
  const seriesKeys = [
    'distance', 'qualifiedConsumption', 'unqualifiedConsumption',
    'Other eligible drives', 'Best-band drives',
  ];
  const series = (props: { dataKey?: string; name?: string; hide?: boolean; data?: unknown[] }) => (
    <div data-testid={`series-${props.dataKey ?? props.name}`}
      data-hidden={String(props.hide)} data-point-count={props.data?.length} />
  );
  const children = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    ChartContainer: (props: ChartContainerProps) => (
      <div data-testid={`${props.chartKey}-frame`}
        data-row-count={props.data?.length ?? 0}
        data-columns={props.dataColumns?.map((column) => column.key).join(',')}
        data-export-rows={props.exportData?.length ?? 0}
        data-export-filename={props.exportFilename}
        data-exportable={String(props.exportable)}
        data-chart-state={props.loading ? 'loading' : props.error ? 'error' : 'ready'}>
        {props.subtitle}
        {props.action}
        {props.loading ? 'loading' : props.error ? (
          <div>error<button type="button" onClick={props.onRetry}>Retry</button></div>
        ) : (
          <>ready{chartController.enabled ? (
            <ChartHiddenSeriesProvider chartKey={props.chartKey}>
              {(hiddenSeries) => typeof props.children === 'function'
                ? props.children({ hiddenSeries, hidden: false, annotations: [] })
                : props.children}
            </ChartHiddenSeriesProvider>
          ) : typeof props.children === 'function'
            ? props.children({ hiddenSeries: null, hidden: false, annotations: [] })
            : props.children}</>
        )}
      </div>
    ),
    ResponsiveContainer: ({ children }: { children?: ReactNode }) =>
      <div data-testid="evidence-plot">{children}</div>,
    EmbeddedChart: () => <div data-testid="unexpected-inner-controller" />,
    CHART_COLORS: [],
    Bar: series,
    Cell: () => null,
    ChartLegend: () => {
      const resolved = useChartHiddenSeries();
      return resolved ? <>{seriesKeys.map((key) =>
        <LegendSeriesLabel key={key} resolved={resolved} value={key} entry={{ dataKey: key }} />,
      )}</> : null;
    },
    ChartTooltip: () => null,
    ComposedChart: children,
    Line: series,
    ScatterChart: children,
    Scatter: series,
    CartesianGrid: () => null,
    ReferenceArea: () => null,
    ZAxis: () => null,
    LineChart: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
    axisTick: {},
    chartGrid: null,
  };
});

vi.mock('../components/speed-sweet-spot', async () => ({
    ...(await vi.importActual<typeof import('../components/speed-sweet-spot/SpeedBandCoverage')>(
      '../components/speed-sweet-spot/SpeedBandCoverage')),
    ...(await vi.importActual<typeof import('../components/speed-sweet-spot/DriveEvidenceScatter')>(
      '../components/speed-sweet-spot/DriveEvidenceScatter')),
    ...(await vi.importActual<typeof import('../components/speed-sweet-spot/MonthlyOperatingContext')>(
      '../components/speed-sweet-spot/MonthlyOperatingContext')),
    ConsumptionSpeedCurve: (props: { state: State }) =>
      section('speed-sweet-spot-curve', props.state),
    SpeedBandScorecard: (props: { state: State }) =>
      section('speed-sweet-spot-scorecard', props.state),
}));

import SpeedSweetSpotPage from './SpeedSweetSpotPage';

const { SweetSpotEvidenceBrief } = await vi.importActual<
  typeof import('../components/operationalbrief-n-z/SweetSpotEvidenceBrief')
>('../components/operationalbrief-n-z/SweetSpotEvidenceBrief');
const { ConsumptionSpeedCurve } = await vi.importActual<
  typeof import('../components/speed-sweet-spot/ConsumptionSpeedCurve')
>('../components/speed-sweet-spot/ConsumptionSpeedCurve');
const { DriveEvidenceScatter } = await vi.importActual<
  typeof import('../components/speed-sweet-spot/DriveEvidenceScatter')
>('../components/speed-sweet-spot/DriveEvidenceScatter');

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
    ...overrides,
  };
}

function drive(id: number): Drive {
  return {
    id,
    vehicleId: 42,
    startTs: `2026-07-0${id}T08:00:00Z`,
    endTs: null,
    durationS: 600,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 1_500,
    regenEnergyWh: null,
    avgSpeedMps: 100 / 3.6,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
  };
}

const SECTION_IDS = [
  'speed-sweet-spot-kpis',
  'speed-sweet-spot-evidence',
  'speed-sweet-spot-coverage',
  'speed-sweet-spot-curve',
  'speed-sweet-spot-scatter',
  'speed-sweet-spot-monthly',
  'speed-sweet-spot-scorecard',
  'speed-sweet-spot-method',
];

beforeEach(() => {
  vi.clearAllMocks();
  chartController.enabled = false;
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  useDrivesMock.mockReturnValue(query());
  unitsMock.mockReturnValue({
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
    },
  });
});

describe('Speed Sweet Spot chart controller ownership', () => {
  it('restores shared outer URL state and toggles every populated series without inner controllers', async () => {
    chartController.enabled = true;
    const summary = computeSweetSpot([
      drive(1), drive(2), drive(3),
      { ...drive(4), avgSpeedMps: 80 / 3.6, energyUsedWh: 1200 },
    ]);
    function LocationProbe() {
      return <output data-testid="chart-url">{useLocation().search}</output>;
    }
    render(
      <MemoryRouter initialEntries={[
        '/driving/speed-sweet-spot?from=2026-07-01&hidden_speed-sweet-spot-curve=qualifiedConsumption&hidden_speed-sweet-spot-drive-evidence=Best-band%20drives',
      ]}>
        <ConsumptionSpeedCurve summary={summary} state={{ isLoading: false, error: null }} />
        <DriveEvidenceScatter summary={summary} state={{ isLoading: false, error: null }}
          resolved retained={false} />
        <LocationProbe />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('unexpected-inner-controller')).not.toBeInTheDocument();
    expect(screen.getByRole('group', {
      name: 'Qualified and unqualified energy consumption across speed bands',
    })).toBeInTheDocument();
    expect(screen.getByRole('group', {
      name: 'Individual drive evidence scatter plot across speed and energy consumption',
    })).toBeInTheDocument();
    const cases = [
      {
        key: 'speed-sweet-spot-curve',
        series: ['distance', 'qualifiedConsumption', 'unqualifiedConsumption'],
        hidden: 'qualifiedConsumption',
        rows: summary.points.length,
        columns: 'band,qualifiedConsumption,unqualifiedConsumption,distance,drives,qualification',
      },
      {
        key: 'speed-sweet-spot-drive-evidence',
        series: ['Other eligible drives', 'Best-band drives'],
        hidden: 'Best-band drives',
        rows: summary.driveEvidence.length,
        columns: 'driveId,date,group,speed,consumption,distance',
      },
    ];
    for (const chart of cases) {
      const frame = screen.getByTestId(`${chart.key}-frame`);
      expect(frame).toHaveAttribute('data-exportable', 'true');
      expect(frame).toHaveAttribute('data-export-filename', chart.key);
      expect(frame).toHaveAttribute('data-export-rows', String(chart.rows));
      expect(frame).toHaveAttribute('data-row-count', String(chart.rows));
      expect(frame).toHaveAttribute('data-columns', chart.columns);
      for (const key of chart.series) {
        const plotSeries = within(frame).getByTestId(`series-${key}`);
        const legend = within(frame).getByRole('button', { name: key });
        const initiallyHidden = key === chart.hidden;
        expect(plotSeries).toHaveAttribute('data-hidden', String(initiallyHidden));
        expect(legend).toHaveAttribute('aria-pressed', String(initiallyHidden));
        await userEvent.click(legend);
        expect(plotSeries).toHaveAttribute('data-hidden', String(!initiallyHidden));
        expect(legend).toHaveAttribute('aria-pressed', String(!initiallyHidden));
        const params = new URLSearchParams(screen.getByTestId('chart-url').textContent ?? '');
        expect((params.get(`hidden_${chart.key}`) ?? '').split(',').includes(key))
          .toBe(!initiallyHidden);
        expect(params.get('from')).toBe('2026-07-01');
        expect(params.has('hidden_consumption-speed')).toBe(false);
        expect(params.has('hidden_drive-evidence')).toBe(false);
        await userEvent.click(legend);
        expect(plotSeries).toHaveAttribute('data-hidden', String(initiallyHidden));
      }
    }
    expect(screen.getByTestId('series-Other eligible drives')).toHaveAttribute('data-point-count', '1');
    expect(screen.getByTestId('series-Best-band drives')).toHaveAttribute('data-point-count', '3');
    const restored = new URLSearchParams(screen.getByTestId('chart-url').textContent ?? '');
    expect(restored.get('hidden_speed-sweet-spot-curve')).toBe('qualifiedConsumption');
    expect(restored.get('hidden_speed-sweet-spot-drive-evidence')).toBe('Best-band drives');
  });
});

describe('SweetSpotEvidenceBrief measurements', () => {
  function evidence(summary = computeSweetSpot([]), resolved = true) {
    return <SweetSpotEvidenceBrief summary={summary} resolved={resolved} retained={false}
      scope="Selected window" state={{ isLoading: false, error: null }} />;
  }

  function metric(key: string) {
    return within(screen.getByTestId('speed-sweet-spot-evidence-brief'))
      .getByTestId(`metric-${key}`);
  }

  it('keeps every measurement unknown before the source resolves', () => {
    render(evidence(computeSweetSpot([drive(1), drive(2), drive(3)]), false));
    for (const key of ['eligible', 'qualified-bands', 'winning-drives', 'winning-distance', 'distance-share']) {
      expect(metric(key)).toHaveAttribute('data-value-state', 'missing');
      expect(metric(key)).not.toHaveAttribute('data-raw-value');
    }
    expect(screen.queryByText('Qualified comparison')).not.toBeInTheDocument();
  });

  it.each([0, 2])('shows resolved counts for %s eligible drives without inventing winning coverage', (count) => {
    render(evidence(computeSweetSpot(Array.from({ length: count }, (_, index) => drive(index + 1)))));
    expect(metric('eligible')).toHaveAttribute('data-raw-value', String(count));
    expect(metric('eligible')).toHaveAttribute('data-value-state', 'value');
    expect(metric('qualified-bands')).toHaveAttribute('data-raw-value', '0');
    expect(metric('qualified-bands')).toHaveAttribute('data-value-state', 'value');
    for (const key of ['winning-drives', 'winning-distance', 'distance-share']) {
      expect(metric(key)).toHaveAttribute('data-value-state', 'missing');
      expect(metric(key)).not.toHaveAttribute('data-raw-value');
    }
    expect(screen.getByText('Insufficient evidence')).toBeInTheDocument();
    expect(screen.getByText('No speed band has enough eligible drives to support a best-band comparison in this window.'))
      .toBeInTheDocument();
  });

  it.each(['winner', 'coverage'] as const)('requires both winner and coverage when %s is missing', (missing) => {
    const summary = computeSweetSpot([drive(1), drive(2), drive(3)]);
    render(evidence({ ...summary,
      sweetSpot: missing === 'winner' ? null : summary.sweetSpot,
      winningBandCoverage: missing === 'coverage' ? null : summary.winningBandCoverage,
    }));
    expect(metric('eligible')).toHaveAttribute('data-raw-value', '3');
    expect(metric('qualified-bands')).toHaveAttribute('data-raw-value', '1');
    for (const key of ['winning-drives', 'winning-distance', 'distance-share']) {
      expect(metric(key)).toHaveAttribute('data-value-state', 'missing');
    }
  });

  it.each([NaN, Infinity, -Infinity, -1, 1.5])('rejects invalid count %s without hiding resolved counts', (value) => {
    const summary = computeSweetSpot([drive(1), drive(2), drive(3)]);
    render(evidence({ ...summary, eligible: value, qualifiedBandCount: value,
      winningBandCoverage: { drives: value, driveShare: 1, distanceM: 30_000, distanceShare: 1 },
    }));
    for (const key of ['eligible', 'qualified-bands', 'winning-drives']) {
      expect(metric(key)).toHaveAttribute('data-value-state', 'invalid');
    }
    expect(metric('winning-distance')).toHaveAttribute('data-value-state', 'value');
  });

  it.each([NaN, Infinity, -Infinity])('keeps invalid coverage %s distinct from zero', (value) => {
    const summary = computeSweetSpot([drive(1), drive(2), drive(3)]);
    render(evidence({ ...summary,
      winningBandCoverage: { drives: 3, driveShare: 1, distanceM: value, distanceShare: value },
    }));
    for (const key of ['winning-distance', 'distance-share']) {
      expect(metric(key)).toHaveAttribute('data-value-state', 'invalid');
    }
  });

  it.each([null, undefined])('keeps absent numeric inputs (%s) missing, not measured zero', (value) => {
    const summary = computeSweetSpot([drive(1), drive(2), drive(3)]);
    for (const key of ['eligible', 'qualifiedBandCount']) {
      Object.defineProperty(summary, key, { value });
    }
    for (const key of ['drives', 'distanceM', 'distanceShare']) {
      Object.defineProperty(summary.winningBandCoverage, key, { value });
    }
    render(evidence(summary));
    for (const key of ['eligible', 'qualified-bands', 'winning-drives', 'winning-distance', 'distance-share']) {
      expect(metric(key)).toHaveAttribute('data-value-state', 'missing');
      expect(metric(key)).not.toHaveAttribute('data-raw-value');
    }
  });

  it.each([0, -0.125, 0.125])('preserves measured zero, signed and fractional coverage %s', (value) => {
    const summary = computeSweetSpot([drive(1), drive(2), drive(3)]);
    render(evidence({ ...summary,
      winningBandCoverage: { drives: 0, driveShare: 0, distanceM: value, distanceShare: value },
    }));
    expect(metric('winning-drives')).toHaveAttribute('data-raw-value', '0');
    expect(metric('winning-drives')).toHaveAttribute('data-value-state', 'value');
    expect(metric('winning-distance')).toHaveAttribute('data-raw-value', String(value));
    expect(metric('distance-share')).toHaveAttribute('data-raw-value', String(value * 100));
    for (const key of ['winning-distance', 'distance-share']) {
      expect(metric(key)).toHaveAttribute('data-value-state', 'value');
    }
  });
});

describe('SpeedSweetSpotPage', () => {
  it('mounts every workspace section and requests the selected server window', () => {
    render(<SpeedSweetSpotPage />);

    expect(
      screen.getByRole('heading', { name: 'Speed Sweet Spot' }),
    ).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(useDrivesMock).toHaveBeenCalledWith('42', {
      start: '2025-01-01T07:00:00.000Z',
      end: '2026-08-08T07:00:00.000Z',
      limit: 1000,
    });
    expect(pageTitleMock).toHaveBeenCalledWith('Speed Sweet Spot');
  });

    describe('SpeedBandScorecard field access', () => {
      const observers = new Map<Element, ResizeObserverCallback>();
      beforeEach(() => {
        localStorage.clear();
        observers.clear();
        vi.stubGlobal('ResizeObserver', class {
          constructor(private callback: ResizeObserverCallback) {}
          observe(element: Element) { observers.set(element, this.callback); }
          unobserve(element: Element) { observers.delete(element); }
          disconnect() {
            observers.forEach((callback, element) => {
              if (callback === this.callback) observers.delete(element);
            });
          }
        });
      });
      afterEach(() => vi.unstubAllGlobals());

      it.each([375, 1440])('preserves all nine fields and every band at %spx', async (width) => {
        const summary = computeSweetSpot([
          drive(1), drive(2), drive(3),
          { ...drive(4), avgSpeedMps: 80 / 3.6, energyUsedWh: 1200 },
          { ...drive(5), avgSpeedMps: 120 / 3.6, energyUsedWh: 1800 },
        ]);
        render(<SpeedBandScorecard summary={summary}
          state={{ isLoading: false, error: null, onRetry: vi.fn() }} />);
        act(() => observers.forEach((callback, element) => callback(
          [{ target: element, contentRect: { width } } as ResizeObserverEntry],
          {} as ResizeObserver,
        )));
        const headers = [
          'Rank', 'Speed band', 'Consumption', 'Distance', 'Drives',
          'Distance share', 'Qualification', 'Gap to best', 'Gap to overall',
        ];
        if (width === 375) {
          const quickViews = screen.getAllByRole('button', { name: 'Quick view' });
          expect(quickViews).toHaveLength(summary.bands.length);
          for (const [index, trigger] of quickViews.entries()) {
            trigger.focus();
            await userEvent.keyboard('{Enter}');
            const dialog = await screen.findByRole('dialog');
            for (const header of headers) expect(within(dialog).getByText(header)).toBeInTheDocument();
            expect(dialog.querySelectorAll('dt')).toHaveLength(9);
            expect(dialog.querySelectorAll('dd')).toHaveLength(9);
            const values = Array.from(dialog.querySelectorAll('dd'));
            expect(values[0]).toHaveTextContent(index === 0 ? '#1' : '—');
            expect(values[6]).toHaveTextContent(index === 0 ? 'Qualified' : 'Below sample floor');
            expect(values[7].textContent).toMatch(index === 0 ? /^0/ : index === 1 ? /^−/ : /^\+/);
            expect(values[8].textContent).toMatch(index === 0 ? /^0/ : index === 1 ? /^−/ : /^\+/);
            await userEvent.keyboard('{Escape}');
            await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
            expect(trigger).toHaveFocus();
          }
        } else {
          for (const header of headers) {
            expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
          }
          expect(screen.getAllByRole('row')).toHaveLength(summary.bands.length + 1);
        }
        expect(screen.getByTestId('speed-sweet-spot-scorecard')).toHaveTextContent('#1');
        expect(screen.getByTestId('speed-sweet-spot-scorecard')).toHaveTextContent('Below sample floor');
      });
    });
  it('re-queries when the selected range changes', async () => {
    render(<SpeedSweetSpotPage />);
    act(() => sharedRange.set({ start: '2026-07-01', end: '2026-07-31' }));
    expect(screen.queryByTestId('speed-sweetspot-range')).not.toBeInTheDocument();

    await waitFor(() =>
      expect(useDrivesMock).toHaveBeenLastCalledWith('42', {
        start: '2026-07-01T07:00:00.000Z',
        end: '2026-08-01T07:00:00.000Z',
        limit: 1000,
      }),
    );
  });

  it.each([
    ['loading', query({ data: undefined, isLoading: true })],
    ['error', query({ data: undefined, isError: true, error: new Error('unavailable') })],
  ])('propagates the %s state to every mounted section', (expected, result) => {
    useDrivesMock.mockReturnValue(result);
    render(<SpeedSweetSpotPage />);

    expect(screen.getByTestId('speed-sweet-spot-kpi-state')).toHaveAttribute(
      'data-state',
      expected,
    );
    for (const id of SECTION_IDS.slice(1)) {
      expect(screen.getByTestId(id)).toHaveTextContent(expected);
    }
  });

  it('preserves no-vehicle recovery while disabling the drives query', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    render(<SpeedSweetSpotPage />);

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent(
      'Speed Sweet Spot',
    );
    expect(useDrivesMock).toHaveBeenCalledWith(undefined, {
      start: '2025-01-01T07:00:00.000Z',
      end: '2026-08-08T07:00:00.000Z',
      limit: 1000,
    });
    expect(
      screen.queryByTestId('speed-sweet-spot-curve'),
    ).not.toBeInTheDocument();
  });

  it('converts to miles only at render while preserving SI model values', () => {
    unitsMock.mockReturnValue({
      unitPrefs: {
        distance: 'mi',
        speed: 'mph',
        temperature: '°F',
        pressure: 'psi',
        energy: 'kWh',
        duration: 'h',
        power: 'kW',
        locale: 'en-US',
      },
    });
    useDrivesMock.mockReturnValue(query({ data: [drive(1), drive(2), drive(3)] }));
    render(<SpeedSweetSpotPage />);

    expect(screen.getByText('62.14–68.35 mph')).toBeInTheDocument();
    expect(screen.getAllByText('241.40 Wh/mi')).toHaveLength(2);
    expect(screen.getByTestId('speed-sweet-spot-evidence')).toHaveAttribute(
      'data-model-from',
      '100',
    );
    expect(screen.getByTestId('speed-sweet-spot-evidence')).toHaveAttribute(
      'data-model-wh',
      '150',
    );
  });


  it.each([
    ['failed refresh', { isError: true, error: new Error('refresh unavailable') }],
    ['paused refresh', { fetchStatus: 'paused' }],
  ])('retains SI evidence and every section during a %s', (_reason, overrides) => {
    useDrivesMock.mockReturnValue(query({ data: [drive(1), drive(2), drive(3)], ...overrides }));
    render(<SpeedSweetSpotPage />);

    expect(screen.getAllByText('Retained source')).toHaveLength(4);
    expect(screen.queryByText('Source available')).not.toBeInTheDocument();
    expect(screen.getByText('100.00–110.00 km/h')).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId('speed-sweet-spot-evidence')).toHaveAttribute('data-model-wh', '150');
  });

  it('keeps a successfully empty window distinct from an unresolved source', () => {
    useDrivesMock.mockReturnValue(query({ data: [], isSuccess: true }));
    render(<SpeedSweetSpotPage />);

    expect(screen.getByText('No drives were returned for this selected window.')).toBeInTheDocument();
    expect(screen.getByText('Source available')).toBeInTheDocument();
    expect(screen.queryByText('The initial evidence query is paused; no empty result is inferred.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('keeps unresolved measurements unknown rather than reporting measured zero', () => {
    useDrivesMock.mockReturnValue(query({ data: undefined, isLoading: true }));
    render(<SpeedSweetSpotPage />);

    expect(screen.getByText('Loading source')).toBeInTheDocument();
    expect(screen.queryByText('The initial evidence query is paused; no empty result is inferred.')).not.toBeInTheDocument();
    expect(screen.queryByText('No drives were returned for this selected window.')).not.toBeInTheDocument();
    for (const key of ['best-qualified-band', 'band-consumption', 'overall-consumption', 'observed-gap']) {
      expect(screen.getByTestId(`metric-${key}`)).toHaveAttribute('data-value-state', 'missing');
      expect(screen.getByTestId(`metric-${key}`)).not.toHaveAttribute('data-raw-value');
    }
  });

  it('keeps an initial pause cause-neutral and unknown, retries the same source, and recovers', () => {
    const paused = query({
      data: undefined,
      dataUpdatedAt: 0,
      isPending: true,
      fetchStatus: 'paused',
    });
    useDrivesMock.mockReturnValue(paused);
    const { rerender } = render(<SpeedSweetSpotPage />);

    // Chart sections announce their own unavailable state; target the page-level paused notice.
    const notice = screen.getAllByRole('status').find((el) => el.hasAttribute('data-refresh-blocked'));
    if (!notice) throw new Error('paused notice not rendered');
    expect(notice).toHaveTextContent('Speed Sweet Spot');
    expect(notice).toHaveTextContent('The initial evidence query is paused; no empty result is inferred.');
    expect(notice).not.toHaveTextContent(/offline|network|failed|empty window/i);
    expect(screen.queryByText('Retained source')).not.toBeInTheDocument();
    expect(screen.queryByText('Source available')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading source')).not.toBeInTheDocument();
    expect(screen.queryByText('No drives were returned for this selected window.')).not.toBeInTheDocument();
    expect(screen.getByTestId('speed-sweet-spot-kpi-state')).toHaveAttribute('data-state', 'ready');
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    for (const key of ['best-qualified-band', 'band-consumption', 'overall-consumption', 'observed-gap']) {
      expect(screen.getByTestId(`metric-${key}`)).toHaveAttribute('data-value-state', 'missing');
      expect(screen.getByTestId(`metric-${key}`)).not.toHaveAttribute('data-raw-value');
    }
    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
    expect(paused.refetch).toHaveBeenCalledTimes(1);

    useDrivesMock.mockReturnValue(query({ data: undefined, isPending: true, isFetching: true, fetchStatus: 'fetching' }));
    rerender(<SpeedSweetSpotPage />);
    expect(screen.queryByText('The initial evidence query is paused; no empty result is inferred.')).not.toBeInTheDocument();
    expect(screen.getByText('Loading source')).toBeInTheDocument();

    useDrivesMock.mockReturnValue(query({ data: [drive(1), drive(2), drive(3)], isSuccess: true }));
    rerender(<SpeedSweetSpotPage />);
    expect(screen.queryByText('The initial evidence query is paused; no empty result is inferred.')).not.toBeInTheDocument();
    expect(screen.getByText('Source available')).toBeInTheDocument();
    expect(screen.getByTestId('metric-observed-gap')).toHaveAttribute('data-raw-value', '0');
    expect(screen.getByTestId('metric-observed-gap')).toHaveAttribute('data-value-state', 'value');
  });

  it('preserves initial errors and retry instead of presenting them as a pause', () => {
    const failed = query({
      data: undefined, isError: true, error: new Error('history unavailable'), fetchStatus: 'paused',
    });
    useDrivesMock.mockReturnValue(failed);
    render(<SpeedSweetSpotPage />);
    expect(screen.queryByText('The initial evidence query is paused; no empty result is inferred.')).not.toBeInTheDocument();
    expect(screen.getByTestId('speed-sweet-spot-kpi-state')).toHaveAttribute('data-state', 'error');
    fireEvent.click(within(screen.getByTestId('speed-sweet-spot-kpis')).getByRole('button', { name: 'Retry' }));
    expect(failed.refetch).toHaveBeenCalledTimes(1);
  });

  it('preserves a measured zero observed gap and the positive SI consumption', () => {
    useDrivesMock.mockReturnValue(query({ data: [drive(1), drive(2), drive(3)] }));
    render(<SpeedSweetSpotPage />);

    expect(screen.getByTestId('metric-observed-gap')).toHaveAttribute('data-raw-value', '0');
    expect(screen.getByTestId('metric-observed-gap')).toHaveAttribute('data-value-state', 'value');
    expect(screen.getByText('0.00%')).toBeInTheDocument();
    expect(screen.getByTestId('metric-band-consumption')).toHaveAttribute('data-raw-value', '0.15');
    expect(screen.getByTestId('metric-best-qualified-band')).toHaveAttribute('data-raw-value', String(100 / 3.6));
  });

  it('forwards fatal retry actions to the same drives source for every evidence section', () => {
    const result = query({ data: undefined, isError: true, error: new Error('unavailable') });
    useDrivesMock.mockReturnValue(result);
    render(<SpeedSweetSpotPage />);

    for (const id of SECTION_IDS.slice(1)) {
      fireEvent.click(within(screen.getByTestId(id)).getByRole('button', { name: /Retry/ }));
    }
    expect(result.refetch).toHaveBeenCalledTimes(7);
  });

  it('renders the same SI-derived model in metric display units', () => {
    useDrivesMock.mockReturnValue(query({ data: [drive(1), drive(2), drive(3)] }));
    render(<SpeedSweetSpotPage />);

    expect(screen.getByText('100.00–110.00 km/h')).toBeInTheDocument();
    expect(screen.getAllByText('150.00 Wh/km')).toHaveLength(2);
  });

  it.each([
    ['active loading', { isLoading: true, fetchStatus: 'fetching' }],
    ['paused without data', { isPending: true, fetchStatus: 'paused' }],
  ])('keeps chart counts unknown during %s', (_label, overrides) => {
    useDrivesMock.mockReturnValue(query({ data: undefined, dataUpdatedAt: 0, ...overrides }));
    render(<SpeedSweetSpotPage />);
    expect(within(screen.getByTestId('speed-sweet-spot-coverage')).getAllByText('Source unavailable').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('speed-sweet-spot-monthly')).getAllByText('Source unavailable').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('speed-sweet-spot-scatter')).getByText(/— eligible drives/)).toBeInTheDocument();
    for (const key of ['coverage', 'monthly', 'drive-evidence']) {
      expect(screen.getByTestId(`speed-sweet-spot-${key}-frame`)).toHaveAttribute('data-row-count', '0');
      expect(screen.getByTestId(`speed-sweet-spot-${key}-frame`)).toHaveAttribute('data-exportable', 'false');
    }
    expect(screen.queryByText('0 qualified')).not.toBeInTheDocument();
  });

  it('shows genuine zero chart counts after a successful empty result', () => {
    useDrivesMock.mockReturnValue(query({ data: [], isSuccess: true }));
    render(<SpeedSweetSpotPage />);
    expect(screen.getByText('0 qualified')).toBeInTheDocument();
    expect(screen.getByText('0 observed months')).toBeInTheDocument();
    expect(screen.getByText(/0 eligible drives; marker size/)).toBeInTheDocument();
    expect(screen.getByText('All eligible points')).toBeInTheDocument();
  });

  it('retains chart evidence on refresh failure and clears retained badges on recovery', () => {
    const data = [drive(1), drive(2), drive(3)];
    const failed = query({ data, isError: true, error: new Error('refresh failed') });
    useDrivesMock.mockReturnValue(failed);
    const { rerender } = render(<SpeedSweetSpotPage />);
    expect(screen.queryByText('The initial evidence query is paused; no empty result is inferred.')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(failed.refetch).toHaveBeenCalledTimes(1);
    for (const key of ['coverage', 'monthly', 'drive-evidence']) {
      const frame = screen.getByTestId(`speed-sweet-spot-${key}-frame`);
      expect(within(frame).getByText('Retained source')).toBeInTheDocument();
      expect(frame).toHaveAttribute('data-chart-state', 'ready');
      expect(frame).toHaveAttribute('data-exportable', 'true');
      expect(Number(frame.getAttribute('data-row-count'))).toBeGreaterThan(0);
    }
    useDrivesMock.mockReturnValue(query({ data, isSuccess: true }));
    rerender(<SpeedSweetSpotPage />);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.queryByText('Retained source')).not.toBeInTheDocument();
    expect(screen.getByText('1 qualified')).toBeInTheDocument();
    expect(screen.getByText('1 observed months')).toBeInTheDocument();
  });
});
