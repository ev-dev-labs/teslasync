import { Children, isValidElement, type ReactNode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataState, DataStateSource } from '@/api/dataState';
import { deriveDataState } from '@/api/dataState';
import type { ChartCardProps } from '@/components/layout';
import type { OperationalBriefProps } from '@/components/data-display/OperationalBrief';
import type { Drive } from '@/types/driving';
import type { MileageBudgetConfig, MileageBudgetResult } from '../lib/mileageBudget';
import { computeMileageBudget } from '../lib/mileageBudget';
import MileageBudgetPage from './MileageBudgetPage';
import { YAxis, Tooltip, ChartTooltip } from '@/components/charts';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  vehicle: vi.fn(),
  units: vi.fn(),
  config: vi.fn(),
  update: vi.fn(),
  summary: vi.fn(),
  chart: vi.fn(),
  metric: vi.fn(),
  hidden: vi.fn(),
  brief: vi.fn(),
  monthly: vi.fn(),
}));

vi.mock('../lib/mileageBudget', async () => {
  const actual = await vi.importActual<typeof import('../lib/mileageBudget')>('../lib/mileageBudget');
  return {
    ...actual,
    computeMileageBudget: (...args: Parameters<typeof actual.computeMileageBudget>) => {
      const result = actual.computeMileageBudget(...args);
      return { ...result, monthly: mocks.monthly() ?? result.monthly };
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)), fallback,
      ),
  }),
}));
vi.mock('@/api/hooks/useDriving', () => ({ useDriveHistory: mocks.history }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: mocks.vehicle }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: mocks.units }));
vi.mock('../hooks/useMileageBudget', () => ({ useMileageBudget: mocks.config }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ formatCurrency: (value: number) => `$${value.toFixed(2)}` }),
}));
vi.mock('@/hooks/useHiddenSeries', () => ({ useHiddenSeries: mocks.hidden }));
vi.mock('@/components/charts', () => ({
  ChartLegend: vi.fn(() => null),
  ChartTooltip: vi.fn(() => null),
  ComposedChart: vi.fn(() => null),
  Line: vi.fn(() => null),
  Area: vi.fn(() => null),
  XAxis: vi.fn(() => null),
  YAxis: vi.fn(() => null),
  CartesianGrid: vi.fn(() => null),
  Tooltip: vi.fn(() => null),
  ResponsiveContainer: vi.fn(() => null),
}));
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui')>('@/components/ui');
  return { ...actual, HelpTooltip: ({ ariaLabel }: { ariaLabel: string }) => <span>{ariaLabel}</span> };
});
vi.mock('@/components/layout', () => ({
  PageLayout: ({ title, children }: { title: string; children: ReactNode }) =>
    <main><h1>{title}</h1>{children}</main>,
  LayoutCard: ({ title, actions, children }: { title: string; actions: ReactNode; children: ReactNode }) =>
    <section aria-label={title}><h2>{title}</h2>{actions}{children}</section>,
  ChartCard: (props: ChartCardProps) => {
    mocks.chart(props);
    return <section aria-label={props.title}>
      <h2>{props.title}</h2>
      {props.loading ? <p>Loading history</p> : props.error ? <p>History failed</p> :
        props.empty ? <p>{props.emptyMessage}</p> : <p>Returned chart</p>}
    </section>;
  },
}));
vi.mock('@/components/data-display', () => ({
  OperationalBrief: (props: OperationalBriefProps) => {
    mocks.brief(props);
    return <section aria-label={props.title}>{props.metrics.map(metric =>
      <div key={metric.key} aria-label={metric.label}>{metric.value}{metric.detail}</div>,
    )}</section>;
  },
  MetricBar: (props: { label: string; value: number | null; max: number; fill: string; sublabel: string }) => {
    mocks.metric(props);
    return <div aria-label={props.label}>{props.sublabel}</div>;
  },
}));
vi.mock('@/components/feedback', () => ({
  AlertBanner: ({ title, children }: { title: string; children: ReactNode }) =>
    <aside><p>{title}</p>{children}</aside>,
  StaleRefreshWarning: ({ state }: { state: DataState<Drive[]> }) =>
    state.refreshError || state.isRefreshBlocked ? <aside>Retained history</aside> : null,
}));
vi.mock('../components/operationalbrief-a-m/MileageBudgetBrief', () => ({
  MileageBudgetBrief: (props: { budget: MileageBudgetResult; source: DataState<Drive[]>; period: unknown }) => {
    mocks.summary(props);
    return <section aria-label="Mileage budget summary metrics">Summary</section>;
  },
}));
vi.mock('@/features/onboarding/components/NoVehicleSelected', () => ({
  NoVehicleSelected: ({ pageTitle }: { pageTitle: string }) => <p>{pageTitle}: select a vehicle</p>,
}));

const { MileageBudgetBrief } = await vi.importActual<
  typeof import('../components/operationalbrief-a-m/MileageBudgetBrief')
>('../components/operationalbrief-a-m/MileageBudgetBrief');

const drive: Drive = {
  id: 10, vehicleId: 4, startTs: '2026-02-01T12:00:00Z', endTs: '2026-02-01T13:00:00Z',
  durationS: 3600, distanceM: 1609.344, startAddress: null, endAddress: null,
  startLat: null, startLon: null, endLat: null, endLon: null,
  startBatteryPct: null, endBatteryPct: null, energyUsedWh: null, regenEnergyWh: null,
  avgSpeedMps: null, maxSpeedMps: null, avgPowerW: null,
  outsideTempAvgC: null, insideTempAvgC: null, score: null, endedStatus: null,
  createdAt: '2026-02-01T13:00:00Z', updatedAt: '2026-02-01T13:00:00Z',
};
let config: MileageBudgetConfig;
let distance: 'km' | 'mi';
let history: DataStateSource<Drive[]>;
const retry = vi.fn();

function latestChart(): ChartCardProps {
  return mocks.chart.mock.calls.at(-1)![0] as ChartCardProps;
}
function chartFormatters() {
  let axis: ((value: unknown) => string) | undefined;
  let tooltip: ((value: unknown, name: string) => ReactNode) | undefined;
  function visit(nodes: ReactNode): void {
    Children.forEach(nodes, node => {
      if (!isValidElement<{
        children?: ReactNode;
        tickFormatter?: typeof axis;
        content?: ReactNode;
        valueFormatter?: typeof tooltip;
      }>(node)) return;
      if (node.type === YAxis) axis = node.props.tickFormatter;
      if (node.type === ChartTooltip) tooltip = node.props.valueFormatter;
      if (node.type === Tooltip) visit(node.props.content);
      visit(node.props.children);
    });
  }
  visit(latestChart().children);
  expect(axis).toBeTypeOf('function');
  expect(tooltip).toBeTypeOf('function');
  return { axis: axis!, tooltip: tooltip! };
}
function latestSummary(): { budget: MileageBudgetResult; source: DataState<Drive[]>; period: {
  kind: string; eventId: string; start: string; end: string; provenance: string;
} } {
  return mocks.summary.mock.calls.at(-1)![0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.monthly.mockReset();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
  config = { annualAllowanceKm: 15000, termStartIso: '2026-01-01', termMonths: 36, overagePerKm: 0.1 };
  distance = 'km';
  history = { data: [drive], dataUpdatedAt: Date.now(), fetchStatus: 'idle', refetch: retry };
  mocks.history.mockImplementation(() => history);
  mocks.vehicle.mockReturnValue({ vehicleId: 4 });
  mocks.units.mockImplementation(() => ({
    unitPrefs: { distance },
    formatDistance: (value: number) => `${value} m`,
  }));
  mocks.update.mockImplementation((patch: Partial<MileageBudgetConfig>) => { config = { ...config, ...patch }; });
  mocks.config.mockImplementation(() => ({ config, update: mocks.update }));
  mocks.hidden.mockReturnValue({ isHidden: (key: string) => key === 'allowed' });
});
afterEach(() => {
  vi.useRealTimers();
  act(() => {
    setGlobalLocale('en-US');
    setGlobalPrecision(2);
  });
});

describe('MileageBudgetBrief projection eligibility', () => {
  function renderBrief(patch: Partial<MileageBudgetResult> = {}, hasData = true) {
    const budget = { ...computeMileageBudget([drive], config, Date.now()), ...patch };
    return render(<MileageBudgetBrief budget={budget}
      source={deriveDataState({ ...history, data: hasData ? [drive] : undefined })}
      period={{ kind: 'unknown', label: 'Configured term', reason: 'Configured term' }}
      formatDistance={value => `${value} m`} formatCurrency={value => `$${value.toFixed(2)}`} />);
  }

  function overage() {
    const props = mocks.brief.mock.calls.at(-1)![0] as OperationalBriefProps;
    return props.metrics.find(metric => metric.key === 'budget-overage')!;
  }

  it.each([null, undefined, NaN, Infinity, -Infinity])(
    'withholds overage and its success context for unavailable projection %s',
    projectedTotalM => {
      renderBrief({ projectedTotalM });
      expect(screen.getByRole('region', { name: 'Mileage budget summary metrics' })).toBeInTheDocument();
      expect(overage()).toMatchObject({ rawValue: null, valueState: 'missing' });
      expect(screen.getByLabelText('Projected overage')).toHaveTextContent('No measurement supplied');
      expect(screen.queryByText('no overage projected')).not.toBeInTheDocument();
      expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    },
  );

  it.each([
    { name: 'absent history', patch: {}, hasData: false, reason: 'No measurement supplied' },
    { name: 'invalid terms', patch: { ok: false }, hasData: true, reason: 'No measurement supplied' },
    { name: 'capped history', patch: { historyCapReached: true }, hasData: true,
      reason: 'unavailable while history is capped' },
  ])('retains a missing overage reason for $name', ({ patch, hasData, reason }) => {
    renderBrief(patch, hasData);
    expect(overage()).toMatchObject({ rawValue: null, valueState: 'missing' });
    expect(screen.getByLabelText('Projected overage')).toHaveTextContent(reason);
    expect(screen.queryByText('no overage projected')).not.toBeInTheDocument();
  });

  it.each([0, -100.25, 100.25])('accepts finite projection %s with measured zero excess', projectedTotalM => {
    renderBrief({ projectedTotalM, projectedOverageM: 0, projectedOverageCost: 0 });
    expect(overage()).toMatchObject({ rawValue: 0, valueState: 'value' });
    expect(screen.getByLabelText('Projected overage')).toHaveTextContent('$0.00');
    expect(screen.getByLabelText('Projected overage')).toHaveTextContent('no overage projected');
  });

  it.each([0, -12.345, 12.345])('preserves signed and fractional overage cost %s', projectedOverageCost => {
    renderBrief({ projectedTotalM: 50000.125, projectedOverageM: 5000.125, projectedOverageCost });
    expect(overage()).toMatchObject({ rawValue: projectedOverageCost, valueState: 'value' });
    expect(screen.getByLabelText('Projected overage')).toHaveTextContent(`$${projectedOverageCost.toFixed(2)}`);
    expect(screen.getByLabelText('Projected overage')).toHaveTextContent('5000.125 m');
  });

  it('keeps overage missing until the first week of projection signal exists', () => {
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    const view = renderBrief();
    expect(overage()).toMatchObject({ rawValue: null, valueState: 'missing' });
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
    view.unmount();
    renderBrief();
    expect(overage()).toMatchObject({ rawValue: 0, valueState: 'value' });
  });
});

describe('MileageBudgetPage scoped modernization', () => {
  it('preserves all three sections, four terms, SI summary, business period and chart capabilities', () => {
    render(<MileageBudgetPage />);
    expect(mocks.history).toHaveBeenCalledWith('4', 1000);
    expect(mocks.hidden).toHaveBeenCalledWith('mileage-budget');
    expect(screen.getByRole('region', { name: 'Mileage budget summary metrics' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Allowance terms' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Distance vs allowance' })).toBeInTheDocument();
    expect(screen.getByLabelText('Allowance per year')).toHaveValue(15000);
    expect(screen.getByLabelText('Term start')).toHaveValue('2026-01-01');
    expect(screen.getByLabelText('Term length (months)')).toHaveValue(36);
    expect(screen.getByLabelText('Overage fee')).toHaveValue(0.1);
    expect(latestSummary().budget.usedM).toBe(1609.344);
    expect(latestSummary().period).toMatchObject({
      kind: 'event', eventId: 'mileage-budget:2026-01-01', start: '2026-01-01',
      provenance: 'Configured term; observed drive-history coverage may be incomplete.',
    });
    expect(latestChart()).toMatchObject({ chartKey: 'mileage-budget', exportable: true, height: 340, size: 'standard' });
    expect(latestChart().data?.[1]).toMatchObject({ month: '2026-02', used: 1.6 });
  });

  it('synchronizes both displayed numeric terms with external storage updates and unit preference changes', () => {
    const view = render(<MileageBudgetPage />);
    config = { ...config, annualAllowanceKm: 16093.44, overagePerKm: 0.2 };
    view.rerender(<MileageBudgetPage />);
    expect(screen.getByLabelText('Allowance per year')).toHaveValue(16093);
    expect(screen.getByLabelText('Overage fee')).toHaveValue(0.2);
    distance = 'mi';
    view.rerender(<MileageBudgetPage />);
    expect(screen.getByLabelText('Allowance per year')).toHaveValue(10000);
    expect(screen.getByLabelText('Overage fee')).toHaveValue(0.3219);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(latestSummary().budget.usedM).toBe(1609.344);
  });

  it('retains editable drafts while converting miles and per-mile fees to the existing saved term shape', () => {
    distance = 'mi';
    render(<MileageBudgetPage />);
    fireEvent.change(screen.getByLabelText('Allowance per year'), { target: { value: '10000' } });
    expect(mocks.update).toHaveBeenLastCalledWith({ annualAllowanceKm: 16093.44 });
    expect(screen.getByLabelText('Allowance per year')).toHaveValue(10000);
    fireEvent.change(screen.getByLabelText('Overage fee'), { target: { value: '0.1609344' } });
    // Preserve the unrounded IEEE-754 division; the saved rate is not display-rounded.
    expect(mocks.update).toHaveBeenLastCalledWith({ overagePerKm: 0.09999999999999999 });
    expect(config.overagePerKm).toBeCloseTo(0.1, 15);
    expect(screen.getByLabelText('Overage fee')).toHaveValue(0.1609344);
    fireEvent.change(screen.getByLabelText('Overage fee'), { target: { value: '0' } });
    expect(mocks.update).toHaveBeenLastCalledWith({ overagePerKm: 0 });
  });

  it('keeps invalid or cleared numeric edits visible with feedback without changing saved terms', () => {
    render(<MileageBudgetPage />);
    fireEvent.change(screen.getByLabelText('Allowance per year'), { target: { value: '' } });
    expect(screen.getByLabelText('Allowance per year')).toHaveValue(null);
    expect(screen.getByLabelText('Allowance per year')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid number');
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Overage fee'), { target: { value: '-1' } });
    expect(screen.getByLabelText('Overage fee')).toHaveValue(-1);
    expect(screen.getByLabelText('Overage fee')).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Allowance per year'), { target: { value: '5000' } });
    expect(mocks.update).toHaveBeenLastCalledWith({ annualAllowanceKm: 5000 });
    expect(screen.getByLabelText('Allowance per year')).not.toHaveAttribute('aria-invalid');
  });

  it('preserves independent business-date edits and the existing unbounded positive integer month domain', () => {
    render(<MileageBudgetPage />);
    fireEvent.change(screen.getByLabelText('Term start'), { target: { value: '2026-02-01' } });
    expect(mocks.update).toHaveBeenLastCalledWith({ termStartIso: '2026-02-01' });
    fireEvent.change(screen.getByLabelText('Term length (months)'), { target: { value: '121' } });
    expect(mocks.update).toHaveBeenLastCalledWith({ termMonths: 121 });
    expect(screen.getByLabelText('Term length (months)')).not.toHaveAttribute('max');
    const calls = mocks.update.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Term length (months)'), { target: { value: '0' } });
    expect(mocks.update).toHaveBeenCalledTimes(calls);
  });

  it.each(['km', 'mi'] as const)('labels chart metadata and numeric export columns in selected %s without changing SI', unit => {
    distance = unit;
    render(<MileageBudgetPage />);
    expect(latestChart().metadata?.unitLabel).toBe(unit);
    expect(latestChart().ariaLabel).toContain(`(${unit})`);
    expect(latestChart().dataColumns?.map(column => column.label)).toEqual(['Month', `Driven (${unit})`, `Allowed (${unit})`]);
    expect(latestSummary().budget.usedM).toBe(1609.344);
  });

  it.each(['km', 'mi'] as const)('retains fractional and signed monthly readings nondestructively in %s', unit => {
    distance = unit;
    const monthly = Object.freeze([
      Object.freeze({ month: '2026-01', usedKm: 0, allowedKm: 0 }),
      Object.freeze({ month: '2026-02', usedKm: -12.345678, allowedKm: 1234.56789 }),
    ]);
    mocks.monthly.mockReturnValue(monthly);
    const view = render(<MileageBudgetPage />);
    const divisor = unit === 'mi' ? 1.609344 : 1;
    expect(latestChart().data).toEqual([
      { month: '2026-01', used: 0, allowed: 0 },
      { month: '2026-02', used: (-12.345678 * 1000) / (divisor * 1000),
        allowed: (1234.56789 * 1000) / (divisor * 1000) },
    ]);
    expect(latestSummary().budget.monthly).toBe(monthly);
    expect(mocks.update).not.toHaveBeenCalled();
    distance = unit === 'mi' ? 'km' : 'mi';
    view.rerender(<MileageBudgetPage />);
    expect(latestSummary().budget.monthly).toBe(monthly);
    expect(monthly[1]).toEqual({ month: '2026-02', usedKm: -12.345678, allowedKm: 1234.56789 });
  });

  it.each([null, undefined, NaN, Infinity, -Infinity, '', '12.5'])(
    'keeps unavailable monthly input %s distinct from measured zero at every display boundary',
    value => {
      mocks.monthly.mockReturnValue([
        { month: '2026-01', usedKm: value, allowedKm: value },
        { month: '2026-02', usedKm: 0, allowedKm: 0 },
      ]);
      render(<MileageBudgetPage />);
      expect(latestChart().data).toEqual([
        { month: '2026-01', used: null, allowed: null },
        { month: '2026-02', used: 0, allowed: 0 },
      ]);
      expect(latestChart().exportData).toEqual([
        { month: '2026-01', 'Driven (km)': '—', 'Allowed (km)': '—' },
        { month: '2026-02', 'Driven (km)': '0.00', 'Allowed (km)': '0.00' },
      ]);
      const { axis, tooltip } = chartFormatters();
      for (const reading of [value, null]) {
        expect(axis(reading)).toBe('—');
        expect(tooltip(reading, 'Driven')).toBe('—');
        for (const column of latestChart().dataColumns!.slice(1)) {
          expect(column.format!(reading)).toBe('—');
        }
      }
      expect(axis(0)).toBe('0.00');
      expect(tooltip(0, 'Driven')).toBe('0.00 km');
      for (const column of latestChart().dataColumns!.slice(1)) {
        expect(column.format!(0)).toBe('0.00');
      }
    },
  );

  it.each(['km', 'mi'] as const)('reacts to locale and precision without rounding chart data in %s', unit => {
    distance = unit;
    mocks.monthly.mockReturnValue([
      { month: '2026-01', usedKm: 0, allowedKm: 0 },
      { month: '2026-02', usedKm: -1234.56789, allowedKm: 1234.56789 },
    ]);
    setGlobalLocale('de-DE');
    setGlobalPrecision(3);
    const view = render(<MileageBudgetPage />);
    const data = latestChart().data;
    const raw = Number(data![1].used);
    const expected = raw.toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    const { axis, tooltip } = chartFormatters();
    expect(axis(raw)).toBe(expected);
    expect(tooltip(raw, 'Driven')).toBe(`${expected} ${unit}`);
    for (const column of latestChart().dataColumns!.slice(1)) {
      expect(column.format!(raw)).toBe(expected);
    }
    expect(latestChart().exportData![1][`Driven (${unit})`]).toBe(expected);
    act(() => {
      setGlobalLocale('en-US');
      setGlobalPrecision(1);
    });
    view.rerender(<MileageBudgetPage />);
    expect(latestChart().data).toBe(data);
    expect(chartFormatters().axis(raw)).toBe(raw.toLocaleString('en-US', {
      minimumFractionDigits: 1, maximumFractionDigits: 1,
    }));
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('uses allocated-width thirds, reachable mobile fields and solid progress while preserving both indicators', () => {
    render(<MileageBudgetPage />);
    const terms = screen.getByRole('region', { name: 'Allowance terms' });
    expect(terms.parentElement).toHaveClass('@5xl:grid-cols-3');
    expect(screen.getByRole('region', { name: 'Distance vs allowance' }).parentElement).toHaveClass('@5xl:col-span-2');
    for (const control of within(terms).getAllByRole('spinbutton').concat(within(terms).getByLabelText('Term start'))) {
      expect(control).toHaveClass('min-h-11', 'md:min-h-10');
    }
    expect(mocks.metric.mock.calls.map(([props]) => ({ label: props.label, fill: props.fill }))).toEqual([
      { label: 'Term elapsed', fill: 'solid' }, { label: 'Allowance used', fill: 'solid' },
    ]);
  });

  it('explains absent returned history without hiding terms or chart and withholds the usage reading', () => {
    history = { ...history, data: [] };
    render(<MileageBudgetPage />);
    expect(screen.getByText('No data available for this period')).toBeInTheDocument();
    expect(screen.getByLabelText('Allowance per year')).toHaveValue(15000);
    expect(latestChart().empty).toBe(true);
    expect(mocks.metric.mock.calls.at(-1)![0]).toMatchObject({ value: null, sublabel: '—' });
    expect(screen.getByRole('region', { name: 'Mileage budget summary metrics' })).toBeInTheDocument();
  });

  it.each([
    { name: 'loading', data: undefined, error: undefined, loading: true },
    { name: 'fatal failure', data: undefined, error: new Error('History unavailable'), loading: false },
    { name: 'retained refresh failure', data: [drive], error: new Error('Refresh unavailable'), loading: false },
  ])('retains independent terms and chart retry in $name', ({ data, error, loading }) => {
    history = { ...history, data, error };
    render(<MileageBudgetPage />);
    expect(screen.getByLabelText('Term start')).toHaveValue('2026-01-01');
    expect(latestChart().loading).toBe(loading);
    expect(Boolean(latestChart().error)).toBe(data === undefined && error !== undefined);
    latestChart().onRetry?.();
    expect(retry).toHaveBeenCalledOnce();
    if (data) {
      expect(screen.getByText('Retained history')).toBeInTheDocument();
      expect(latestChart().data?.[1]).toMatchObject({ used: 1.6 });
    }
  });

  it('retains paused historical evidence and capped labels without claiming complete history', () => {
    history = { ...history, data: Array.from({ length: 1000 }, (_, index) => ({ ...drive, id: index })), fetchStatus: 'paused' };
    render(<MileageBudgetPage />);
    expect(screen.getByText('Retained history')).toBeInTheDocument();
    expect(screen.getByText('History window reached its row cap')).toBeInTheDocument();
    expect(screen.getByText('History window reached its row cap').parentElement).toHaveTextContent(
      'The request returned 1000 drives. Older term drives may be absent, so pace, term-total, and overage projections are withheld until the selected history is complete.',
    );
    expect(latestChart().title).toBe('Observed distance vs allowance');
    expect(latestChart().dataColumns?.[1].label).toBe('Observed driven (km)');
    expect(latestSummary().budget.historyCapReached).toBe(true);
    expect(latestSummary().source.isRefreshBlocked).toBe(true);
    expect(latestChart().error).toBeNull();
  });

  it('reanchors the injected calculation clock on a real rerender without creating a new query policy', () => {
    const view = render(<MileageBudgetPage />);
    const before = latestSummary().budget.elapsedDays;
    vi.setSystemTime(new Date('2026-03-02T12:00:00Z'));
    view.rerender(<MileageBudgetPage />);
    expect(latestSummary().budget.elapsedDays).toBe(before + 1);
    expect(mocks.history).toHaveBeenLastCalledWith('4', 1000);
  });

  it('retains no-vehicle onboarding without introducing another workspace selector', () => {
    mocks.vehicle.mockReturnValue({ vehicleId: null });
    render(<MileageBudgetPage />);
    expect(screen.getByText('Mileage budget: select a vehicle')).toBeInTheDocument();
    expect(mocks.history).toHaveBeenCalledWith(undefined, 1000);
    expect(mocks.chart).not.toHaveBeenCalled();
  });
});
