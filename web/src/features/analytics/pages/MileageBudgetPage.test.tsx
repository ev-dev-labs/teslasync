import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataState, DataStateSource } from '@/api/dataState';
import type { ChartCardProps } from '@/components/layout';
import type { Drive } from '@/types/driving';
import type { MileageBudgetConfig, MileageBudgetResult } from '../lib/mileageBudget';
import MileageBudgetPage from './MileageBudgetPage';

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
}));

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
  MetricBar: (props: { label: string; value: number | null; max: number; fill: string; sublabel: string }) => {
    mocks.metric(props);
    return <div aria-label={props.label}>{props.sublabel}</div>;
  },
}));
vi.mock('@/components/feedback', () => ({
  AlertBanner: ({ title, children }: { title: string; children: ReactNode }) =>
    <aside>{title}{children}</aside>,
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
function latestSummary(): { budget: MileageBudgetResult; source: DataState<Drive[]>; period: {
  kind: string; eventId: string; start: string; end: string; provenance: string;
} } {
  return mocks.summary.mock.calls.at(-1)![0];
}

beforeEach(() => {
  vi.clearAllMocks();
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
afterEach(() => vi.useRealTimers());

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
    expect(latestChart().data?.[1]).toMatchObject({ month: '2026-02', used: 2 });
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
    expect(mocks.update).toHaveBeenLastCalledWith({ overagePerKm: 0.1 });
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
      expect(latestChart().data?.[1]).toMatchObject({ used: 2 });
    }
  });

  it('retains paused historical evidence and capped labels without claiming complete history', () => {
    history = { ...history, data: Array.from({ length: 1000 }, (_, index) => ({ ...drive, id: index })), fetchStatus: 'paused' };
    render(<MileageBudgetPage />);
    expect(screen.getByText('Retained history')).toBeInTheDocument();
    expect(screen.getByText('History window reached its row cap')).toBeInTheDocument();
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
