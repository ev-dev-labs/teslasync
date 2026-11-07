import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { VampireDrainEvent, VampireDrainStats, VampireDrainWatch } from '@/types/energy';
import { MockResizeObserver, patchMatchMedia } from '@/test/setup';
import VampireDrainWidget from './VampireDrainWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, type PackId } from './designPacks/types';

const mocks = vi.hoisted(() => ({
  vehicles: vi.fn(),
  stats: vi.fn(),
  events: vi.fn(),
  watch: vi.fn(),
  refreshVehicles: vi.fn(),
  refreshStats: vi.fn(),
  refreshEvents: vi.fn(),
  refreshWatch: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => mocks.vehicles() }));
vi.mock('@/api/hooks/useEnergy', () => ({
  useVampireDrainStats: (id: string | null) => mocks.stats(id),
  useVampireDrainEvents: (id: string | null, limit: number) => mocks.events(id, limit),
  useVampireDrainWatch: (id: string | null) => mocks.watch(id),
}));

function query<T>(data: T | undefined, extra: Partial<DataStateSource<T>> = {}) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isPending: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...extra,
  };
}

const stats: VampireDrainStats = {
  avg_drain_pct_per_day: 0.8, median_drain_pct_per_day: 0.7,
  p95_drain_pct_per_day: 2.4, total_observed_hours: 48, event_count: 12, sample_window_days: 90,
};
const events: VampireDrainEvent[] = [0, Number.NaN, -0.5, 2.4].map((rate, index) => ({
  started_at: `2026-10-0${index + 1}T12:00:00Z`,
  ended_at: `2026-10-0${index + 2}T06:00:00Z`,
  duration_hours: 18, start_battery_pct: 80, end_battery_pct: 78,
  drain_pct: 2, drain_pct_per_day: rate, ambient_temp_c_avg: null,
}));
const watch: VampireDrainWatch = {
  status: 'ok', threshold_pct_per_day: 3, avg_drain_pct_per_day: 0.8,
  events_evaluated: 12, breach_streak: 0, breaches_last_7_days: 0,
  worst_event: null, recommendation: 'Monitor',
};

function tree(pack: PackId, options: { cols?: number; vehicleId?: number } = {}) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={pack}>
        <VampireDrainWidget vehicleId={options.vehicleId} size={{ cols: options.cols ?? 2, rows: 4 }} />
      </PackBoundary>
    </MemoryRouter>
  );
}

const packs = Object.entries(PACK_APPEARANCES) as [Exclude<PackId, 'classic'>, string][];
let restoreMedia: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  restoreMedia = patchMatchMedia(query => /prefers-reduced-motion/.test(query)).restore;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 640, 240));
  vi.stubGlobal('ResizeObserver', class extends MockResizeObserver {
    override observe(target: Element) {
      super.observe(target);
      this.trigger(target);
    }
  });
  mocks.vehicles.mockReturnValue(query([{ id: 1 }], { refetch: mocks.refreshVehicles }));
  mocks.stats.mockReturnValue(query(stats, { refetch: mocks.refreshStats }));
  mocks.events.mockReturnValue(query(events, { refetch: mocks.refreshEvents }));
  mocks.watch.mockReturnValue(query(watch, { refetch: mocks.refreshWatch }));
});

afterEach(() => {
  cleanup();
  restoreMedia?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(packs)('Vampire drain %s (%s)', (pack, appearance) => {
  it('renders the real measured line, source windows and refresh action through PackBoundary', async () => {
    const { container } = render(tree(pack, { vehicleId: 42 }));
    await waitFor(() => expect(container.querySelector(`[data-widget-appearance="${appearance}"]`))
      .toHaveAttribute('data-widget-family', 'line'));
    expect(screen.getByRole('heading', { name: 'Vampire drain', level: 3 })).toBeVisible();
    expect(screen.getByText('0.8')).toBeVisible();
    expect(screen.getByText('Average while parked')).toBeVisible();
    expect(screen.getByLabelText('Normal')).toBeVisible();
    expect(screen.getByText('Charging excluded')).toBeVisible();
    expect(screen.getByText('Derived from observed parked, non-charging windows.')).toBeVisible();
    expect(screen.getByText(/Highest: 2.4%\/day on/)).toBeVisible();
    await waitFor(() => expect(container.querySelector('.recharts-line-curve')).not.toBeNull());
    expect(container.querySelector('.recharts-bar')).toBeNull();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Recent parked drain — data table' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(5);
    expect(within(rows[1]).getByText('0.0')).toBeInTheDocument();
    expect(within(rows[2]).getByText('—')).toBeInTheDocument();
    expect(within(rows[3]).getByText('-0.5')).toBeInTheDocument();
    expect(within(rows[4]).getByText('2.4')).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Window started' })).toBeInTheDocument();
    expect(mocks.stats).toHaveBeenCalledWith('42');
    expect(mocks.events).toHaveBeenCalledWith('42', 30);
    expect(mocks.watch).toHaveBeenCalledWith('42');

    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(mocks.refreshStats).toHaveBeenCalledOnce();
    expect(mocks.refreshEvents).toHaveBeenCalledOnce();
    expect(mocks.refreshWatch).toHaveBeenCalledOnce();
    expect(mocks.refreshVehicles).not.toHaveBeenCalled();
  });

  it('preserves the compact headline without adding the full-size plot or highest annotation', async () => {
    const { container } = render(tree(pack, { cols: 1 }));
    await waitFor(() => expect(container.querySelector(`[data-widget-appearance="${appearance}"]`)).not.toBeNull());
    expect(screen.getByText('0.8')).toBeVisible();
    expect(screen.getByText('%/day')).toBeVisible();
    expect(screen.getByLabelText('Normal')).toBeVisible();
    expect(screen.queryByText(/Highest:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(container.querySelector('.recharts-wrapper')).toBeNull();
  });

  it('keeps an empty source honest and leaves its trend and supporting sections visible', async () => {
    mocks.stats.mockReturnValue(query(undefined));
    mocks.events.mockReturnValue(query([]));
    mocks.watch.mockReturnValue(query(null));
    const { container } = render(tree(pack));
    await waitFor(() => expect(container.querySelector(`[data-widget-appearance="${appearance}"]`)).not.toBeNull());
    expect(screen.getByText('Average unavailable')).toBeVisible();
    expect(screen.getByText('Average while parked')).toBeVisible();
    expect(screen.getByText('No vampire drain data')).toBeVisible();
    expect(screen.getByText('Observed parked windows will appear when drain history is available.')).toBeVisible();
    expect(screen.getByText('Highest parked drain unavailable')).toBeVisible();
    expect(screen.getByText('Charging excluded')).toBeVisible();
    expect(screen.queryByLabelText('Normal')).not.toBeInTheDocument();
    expect(screen.queryByText('0.0')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(container.querySelector('.recharts-line-curve')).toBeNull();
  });
});

it('preserves Classic bars and recovers the original body after switching among production packs', async () => {
  const view = render(tree('classic'));
  await waitFor(() => expect(view.container.querySelector('.recharts-bar')).not.toBeNull());
  expect(view.container.querySelector('[data-widget-family]')).toBeNull();
  expect(screen.getByText('0.8')).toBeVisible();
  expect(screen.getByText(/Highest: 2.4%\/day on/)).toBeVisible();
  expect(screen.queryByText('Charging excluded')).not.toBeInTheDocument();

  for (const pack of ['v1', 'v7'] as const) {
    view.rerender(tree(pack));
    await waitFor(() => expect(view.container.querySelector(`[data-widget-appearance="${PACK_APPEARANCES[pack]}"]`)).not.toBeNull());
    expect(screen.getByText('0.8')).toBeVisible();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  }
  expect(view.container.querySelector('[data-widget-appearance="pixel"] .lucide-battery-warning')).not.toBeNull();
  view.rerender(tree('classic'));
  await waitFor(() => expect(view.container.querySelector('.recharts-bar')).not.toBeNull());
  expect(view.container.querySelector('[data-widget-family]')).toBeNull();
  expect(screen.queryByText('Charging excluded')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
  expect(mocks.refreshVehicles).toHaveBeenCalledOnce();
  expect(mocks.refreshEvents).toHaveBeenCalledOnce();
});

it('does not trust an aggregate average with an empty measured population', async () => {
  mocks.stats.mockReturnValue(query({ ...stats, event_count: 0 }));
  const { container } = render(tree('v3'));
  await waitFor(() => expect(container.querySelector('[data-widget-appearance="precision"]')).not.toBeNull());
  expect(screen.getByText('Average unavailable')).toBeVisible();
  expect(screen.queryByText('0.8')).not.toBeInTheDocument();
  expect(screen.getByText(/Highest: 2.4%\/day on/)).toBeVisible();
  expect(screen.getByRole('table', { name: 'Recent parked drain — data table' })).toBeInTheDocument();
});

it('retains a genuinely measured zero rather than treating it as missing', async () => {
  mocks.stats.mockReturnValue(query({ ...stats, avg_drain_pct_per_day: 0, event_count: 1 }));
  const { container } = render(tree('v7', { cols: 1 }));
  await waitFor(() => expect(container.querySelector('[data-widget-appearance="pixel"]')).not.toBeNull());
  expect(screen.getByText('0.0')).toBeVisible();
  expect(screen.getByText('%/day')).toBeVisible();
  expect(screen.getByLabelText('Normal')).toBeVisible();
  expect(screen.queryByText('Average unavailable')).not.toBeInTheDocument();
});

it('keeps other source sections usable when the aggregate fails its initial request', async () => {
  mocks.stats.mockReturnValue(query(undefined, { isError: true, error: new Error('Statistics failed') }));
  const { container } = render(tree('v4'));
  await waitFor(() => expect(container.querySelector('[data-widget-appearance="owner"]')).not.toBeNull());
  expect(container.querySelector('[data-data-state="partial"]')).not.toBeNull();
  expect(screen.getByText('Average unavailable')).toBeVisible();
  expect(screen.getByText(/Highest: 2.4%\/day on/)).toBeVisible();
  expect(screen.getByRole('table', { name: 'Recent parked drain — data table' })).toBeInTheDocument();
});

it('keeps the measured headline and retries only the parked-window source after its initial failure', async () => {
  mocks.events.mockReturnValue(query(undefined, {
    isError: true, error: new Error('Drain windows failed'), refetch: mocks.refreshEvents,
  }));
  const { container } = render(tree('v5'));
  await waitFor(() => expect(container.querySelector('[data-widget-appearance="iconic"]')).not.toBeNull());
  expect(screen.getByText('0.8')).toBeVisible();
  expect(screen.getByText('Highest parked drain unavailable')).toBeVisible();
  expect(screen.queryByText('No vampire drain data')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mocks.refreshEvents).toHaveBeenCalledOnce();
  expect(mocks.refreshStats).not.toHaveBeenCalled();
  expect(mocks.refreshWatch).not.toHaveBeenCalled();
});

it('shows initial loading without fabricated readings and then renders the resolved source', async () => {
  const pending = { isPending: true, isLoading: true, isFetching: true, dataUpdatedAt: 0 };
  mocks.stats.mockReturnValue(query(undefined, pending));
  mocks.events.mockReturnValue(query(undefined, pending));
  mocks.watch.mockReturnValue(query(undefined, pending));
  const view = render(tree('v5'));
  expect(view.container.querySelector('[data-data-state="initial"]')).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByText('0.8')).not.toBeInTheDocument();
  expect(screen.queryByText('0.0')).not.toBeInTheDocument();
  expect(screen.queryByText('No vampire drain data')).not.toBeInTheDocument();
  mocks.stats.mockReturnValue(query(stats));
  mocks.events.mockReturnValue(query(events));
  mocks.watch.mockReturnValue(query(watch));
  view.rerender(tree('v5'));
  await waitFor(() => expect(view.container.querySelector('[data-widget-appearance="iconic"]')).not.toBeNull());
  expect(screen.getByText('0.8')).toBeVisible();
});

it('retains readings and the original source age warning when a background refresh fails', async () => {
  mocks.stats.mockReturnValue(query(stats, {
    isError: true, error: new Error('Refresh failed'), isStale: true,
    dataUpdatedAt: Date.now() - 3_600_000, refetch: mocks.refreshStats,
  }));
  const { container } = render(tree('v2'));
  await waitFor(() => expect(container.querySelector('[data-widget-appearance="elevated"]')).not.toBeNull());
  expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull();
  expect(screen.getByTestId('stale-refresh-warning')).toBeVisible();
  expect(screen.getByText('0.8')).toBeVisible();
  expect(screen.getByText(/Highest: 2.4%\/day on/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /Refresh data.*error/ }));
  expect(mocks.refreshStats).toHaveBeenCalledOnce();
});

it('keeps refresh disabled while its existing source queries are in flight', async () => {
  mocks.events.mockReturnValue(query(events, { isFetching: true, refetch: mocks.refreshEvents }));
  const { container } = render(tree('v6'));
  await waitFor(() => expect(container.querySelector('[data-widget-appearance="expressive"]')).not.toBeNull());
  expect(screen.getByText('0.8')).toBeVisible();
  const refresh = screen.getByRole('button', { name: /Refresh data/ });
  expect(refresh).toBeDisabled();
  fireEvent.click(refresh);
  expect(mocks.refreshEvents).not.toHaveBeenCalled();
});
