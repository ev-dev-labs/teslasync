import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DailyMileageBucket } from '@/types/analytics';
import OdometerCounterWidget from './OdometerCounterWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import type { PackAppearance, PackId } from './designPacks/types';

const { vehiclesMock, vehicleStateMock, dailyMileageMock, unitPreference } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  vehicleStateMock: vi.fn(),
  dailyMileageMock: vi.fn(),
  unitPreference: { distance: 'km' as 'km' | 'mi' },
}));

vi.mock('@/api/hooks/useVehicles', async () => ({
  ...await vi.importActual<typeof import('@/api/hooks/useVehicles')>('@/api/hooks/useVehicles'),
  useVehicles: vehiclesMock,
  useVehicleState: vehicleStateMock,
}));
vi.mock('@/api/hooks/useAnalytics', () => ({ useDailyMileage: dailyMileageMock }));
vi.mock('@/hooks/useUnits', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useUnits')>('@/hooks/useUnits');
  return {
    ...actual,
    useUnits: () => {
      const units = actual.useUnits();
      return { ...units, unitPrefs: { ...units.unitPrefs, distance: unitPreference.distance } };
    },
  };
});

const appearances: [Exclude<PackId, 'classic'>, PackAppearance][] = [
  ['v1', 'studio'], ['v2', 'elevated'], ['v3', 'precision'], ['v4', 'owner'],
  ['v5', 'iconic'], ['v6', 'expressive'], ['v7', 'pixel'],
];
const compact = { cols: 1, rows: 1 };
const full = { cols: 2, rows: 2 };
const mileage: DailyMileageBucket[] = [
  { date: '2025-12-31', total_km: 900, drive_count: 1, end_odometer_km: null },
  { date: '2026-10-01', total_km: 100, drive_count: 1, end_odometer_km: null },
  { date: '2026-11-01', total_km: 30, drive_count: 1, end_odometer_km: null },
  { date: '2026-11-02', total_km: 14, drive_count: 1, end_odometer_km: null },
  { date: '2026-11-06', total_km: 3, drive_count: 1, end_odometer_km: null },
  { date: '2026-11-07', total_km: 800, drive_count: 1, end_odometer_km: null },
];

function queryFlags() {
  return {
    isLoading: false, isFetching: false, isStale: false, isError: false,
    error: null as Error | null, dataUpdatedAt: Date.now(), refetch: vi.fn(),
  };
}

function stateQuery(odometer: number | undefined = 32_100_000) {
  return {
    ...queryFlags(),
    data: {
      state: { odometer }, observedAt: Date.now(), live: true,
      freshness: 'fresh' as const, verifiedFields: ['odometer'],
    },
  };
}

function dailyQuery(data: DailyMileageBucket[] = mileage) {
  return { ...queryFlags(), data };
}

function widget(pack: unknown = 'classic', size = full) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={pack}>
        <OdometerCounterWidget size={size} vehicleId={7} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function expectAppearance(container: HTMLElement, appearance: PackAppearance) {
  await waitFor(() => {
    expect(container.querySelector(`[data-widget-family="bars"][data-widget-appearance="${appearance}"]`))
      .toBeInTheDocument();
  });
}

function comparison() {
  return screen.getByRole('figure', { name: 'Distance by period' });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
  vi.clearAllMocks();
  unitPreference.distance = 'km';
  vehiclesMock.mockReturnValue({ data: [{ id: 42 }] });
  vehicleStateMock.mockReturnValue(stateQuery());
  dailyMileageMock.mockReturnValue(dailyQuery());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('OdometerCounterWidget design packs', () => {
  it.each(appearances)('%s composes the actual odometer, period samples, original statistics and refresh', async (pack, appearance) => {
    const state = stateQuery();
    const daily = dailyQuery();
    vehicleStateMock.mockReturnValue(state);
    dailyMileageMock.mockReturnValue(daily);
    const { container } = render(widget(pack));
    await expectAppearance(container, appearance);

    expect(screen.getByText('Total odometer')).toBeInTheDocument();
    expect(screen.getByText('Lifetime')).toBeInTheDocument();
    expect(screen.getByText('32,100')).toBeInTheDocument();
    const table = within(comparison()).getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'km' })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: 'Day 3' })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: 'Week 17' })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: 'Month 47' })).toBeInTheDocument();
    for (const label of ['This week', 'This month', 'This year', 'Per day']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('147')).toBeInTheDocument();
    expect(screen.getAllByText('Periods overlap and are shown separately.').length).toBeGreaterThan(0);
    expect(vehicleStateMock).toHaveBeenCalledWith(7);
    expect(dailyMileageMock).toHaveBeenCalledWith('7', 366);
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
    expect(daily.refetch).toHaveBeenCalledTimes(1);
  });

  it.each(appearances)('%s retains the compact headline without the full period sections', async (pack, appearance) => {
    const { container } = render(widget(pack, compact));
    await expectAppearance(container, appearance);
    expect(screen.getByText('32,100')).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
    expect(screen.queryByText('This year')).not.toBeInTheDocument();
    expect(container.querySelector('[data-instrument-family="bars"] svg')).toBeInTheDocument();
  });

  it.each(appearances)('%s keeps unknown odometer and empty distance honest and retains every full section', async (pack, appearance) => {
    vehicleStateMock.mockReturnValue({ ...stateQuery(), data: undefined });
    dailyMileageMock.mockReturnValue(dailyQuery([]));
    const { container } = render(widget(pack));
    await expectAppearance(container, appearance);
    expect(screen.getByText('No odometer data')).toBeInTheDocument();
    expect(comparison()).toHaveAttribute('data-chart-state', 'empty');
    expect(screen.getByText('No measured distance for these periods')).toBeInTheDocument();
    expect(screen.getByText('This week')).toBeInTheDocument();
    expect(screen.getByText('This year')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('keeps Classic and unknown pack recovery on the original full and compact bodies', () => {
    const view = render(widget());
    expect(screen.getByText('32,100')).toBeInTheDocument();
    expect(screen.getByText('This year')).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
    view.rerender(widget('retired', compact));
    expect(screen.getByText('32,100')).toBeInTheDocument();
    expect(screen.queryByText('This year')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-widget-pack="classic"]')).toBeInTheDocument();
  });

  it('changes all seven presentations and recovers Classic without losing measurements or actions', async () => {
    const state = stateQuery();
    const daily = dailyQuery();
    vehicleStateMock.mockReturnValue(state);
    dailyMileageMock.mockReturnValue(daily);
    const view = render(widget());
    for (const [pack, appearance] of appearances) {
      view.rerender(widget(pack));
      await expectAppearance(view.container, appearance);
      expect(screen.getByText('32,100')).toBeInTheDocument();
      expect(within(comparison()).getByRole('row', { name: 'Week 17' })).toBeInTheDocument();
    }
    view.rerender(widget());
    expect(screen.getByText('32,100')).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
    expect(daily.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps history and its statistics visible when the independent odometer source fails', async () => {
    vehicleStateMock.mockReturnValue({
      ...stateQuery(), data: undefined, isError: true, error: new Error('state unavailable'),
    });
    const { container } = render(widget('v4'));
    await expectAppearance(container, 'owner');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(within(comparison()).getByRole('row', { name: 'Day 3' })).toBeInTheDocument();
    expect(screen.getByText('This year')).toBeInTheDocument();
  });

  it('retains the headline, chart and source warnings after background failures', async () => {
    vehicleStateMock.mockReturnValue({
      ...stateQuery(), isError: true, error: new Error('state refresh unavailable'),
    });
    dailyMileageMock.mockReturnValue({
      ...dailyQuery(), isError: true, error: new Error('history refresh unavailable'),
    });
    const { container } = render(widget('v7'));
    await expectAppearance(container, 'pixel');
    expect(screen.getByText('32,100')).toBeInTheDocument();
    expect(within(comparison()).getByRole('row', { name: 'Month 47' })).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning').length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('scopes an initial history error and retry to history without hiding the headline or statistics', async () => {
    const daily = {
      ...dailyQuery(), data: undefined, isError: true, error: new Error('history unavailable'),
    };
    dailyMileageMock.mockReturnValue(daily);
    const { container } = render(widget('v2'));
    await expectAppearance(container, 'elevated');
    expect(screen.getByText('32,100')).toBeInTheDocument();
    expect(comparison()).toHaveAttribute('data-chart-state', 'error');
    expect(screen.getByText('This month')).toBeInTheDocument();
    fireEvent.click(within(comparison()).getByRole('button', { name: /retry/i }));
    expect(daily.refetch).toHaveBeenCalledTimes(1);
  });

  it('shows independent history loading geometry beside the real headline', async () => {
    dailyMileageMock.mockReturnValue({ ...dailyQuery(), data: undefined, isLoading: true });
    const { container } = render(widget('v3'));
    await expectAppearance(container, 'precision');
    expect(screen.getByText('32,100')).toBeInTheDocument();
    expect(comparison()).toHaveAttribute('data-chart-state', 'loading');
    expect(screen.getByText('Per day')).toBeInTheDocument();
  });

  it('converts the lifetime reading and every period sample to the selected display unit', async () => {
    unitPreference.distance = 'mi';
    vehicleStateMock.mockReturnValue(stateQuery(1_609_344));
    dailyMileageMock.mockReturnValue(dailyQuery([
      { ...mileage[4], total_km: 1.609344 },
    ]));
    const { container } = render(widget('v1'));
    await expectAppearance(container, 'studio');
    expect(screen.getByText('1,000')).toBeInTheDocument();
    const table = within(comparison()).getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'mi' })).toBeInTheDocument();
    for (const period of ['Day', 'Week', 'Month']) {
      expect(within(table).getByRole('row', { name: `${period} 1` })).toBeInTheDocument();
    }
  });

  it('does not coerce null or blank distance buckets into measured zero', async () => {
    dailyMileageMock.mockReturnValue({
      ...dailyQuery([]),
      data: [
        { ...mileage[4], total_km: null },
        { ...mileage[4], total_km: '' },
        { ...mileage[4], total_km: Number.NaN },
      ],
    });
    const { container } = render(widget('v7'));
    await expectAppearance(container, 'pixel');
    expect(comparison()).toHaveAttribute('data-chart-state', 'empty');
    expect(within(comparison()).getByRole('row', { name: 'Day —' })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows a resolved missing compact odometer instead of an indefinite loading skeleton', async () => {
    vehicleStateMock.mockReturnValue({ ...stateQuery(), data: undefined });
    const { container } = render(widget('v7', compact));
    await expectAppearance(container, 'pixel');
    expect(screen.getByText('No odometer data')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('does not present invalid odometer %s as a zero reading', async odometer => {
    vehicleStateMock.mockReturnValue(stateQuery(odometer));
    const { container } = render(widget('v5', compact));
    await expectAppearance(container, 'iconic');
    expect(screen.getByText('No odometer data')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('distinguishes a verified zero reading from unverified retained fields', async () => {
    vehicleStateMock.mockReturnValue(stateQuery(0));
    const view = render(widget('v6', compact));
    await expectAppearance(view.container, 'expressive');
    expect(screen.getByText('0')).toBeInTheDocument();
    vehicleStateMock.mockReturnValue({
      ...stateQuery(), data: { ...stateQuery().data, freshness: 'unknown', verifiedFields: [] },
    });
    view.rerender(widget('v6', compact));
    expect(screen.getByText('No odometer data')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
