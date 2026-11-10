import { cloneElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { FSMStats, FSMTransitionResponse } from '@/types/fsm';
import { queryResult, renderWidget } from '../components/continuation-dashboard-2/testSupport';
import FSMDistributionWidget from './FSMDistributionWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, type PackId } from './designPacks/types';

const api = vi.hoisted(() => ({
  stats: vi.fn(), transitions: vi.fn(), vehicles: vi.fn(),
  refreshStats: vi.fn(), refreshTransitions: vi.fn(), refreshVehicles: vi.fn(),
}));

vi.mock('@/api/hooks/useFSM', () => ({
  useFSMStats: api.stats,
  useFSMTransitions: api.transitions,
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: api.vehicles }));
vi.mock('@/components/charts', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/charts')>(),
  // Only provide jsdom geometry; keep the real donut, tooltip and accessible table.
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
    cloneElement(children, { width: 360, height: 180 }),
}));

const stats: FSMStats = {
  enabled: true,
  stats: { driving: 3_600_000, charging: 1_800_000, asleep: 600_000 },
};
const transitions: FSMTransitionResponse = {
  data: Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    vehicle_id: 7,
    fsm_name: 'vehicle',
    from_state: index === 0 ? 'parked' : 'driving',
    to_state: index === 0 ? 'driving' : 'parked',
    ts: `2026-11-06T12:0${index}:00Z`,
    trigger: 'telemetry',
  })),
  total: 6,
  page: 1,
  per_page: 5,
};
const packs = Object.keys(PACK_APPEARANCES) as Array<Exclude<PackId, 'classic'>>;

function mount(packId: unknown = 'classic', cols = 2, vehicleId: number | null = 7) {
  const content = (requestedPackId: unknown) => (
    <PackBoundary requestedPackId={requestedPackId}>
      <FSMDistributionWidget vehicleId={vehicleId ?? undefined} size={{ cols, rows: 4 }} />
    </PackBoundary>
  );
  const view = renderWidget(content(packId));
  return { ...view, selectPack: (next: unknown) => view.rerender(content(next)) };
}

async function expectPack(container: HTMLElement, packId: Exclude<PackId, 'classic'>) {
  await waitFor(() => {
    expect(container.querySelector(`[data-widget-family="segments"][data-widget-appearance="${PACK_APPEARANCES[packId]}"]`))
      .not.toBeNull();
  });
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
}

function chartRows() {
  return within(screen.getByRole('table', { name: 'State distribution — data table' }))
    .getAllByRole('row').slice(1).map(row => {
      const cells = within(row).getAllByRole('cell');
      return [cells[0].textContent, cells[1].textContent, Number.parseFloat(cells[2].textContent ?? '')];
    });
}

function expectTransitions(container: HTMLElement) {
  const feed = screen.getByRole('list', { name: 'Recent transitions' });
  const rows = within(feed).getAllByRole('listitem');
  expect(rows).toHaveLength(5);
  expect(rows[0]).toHaveTextContent('parked');
  expect(rows[0]).toHaveTextContent('driving');
  expect(Array.from(container.querySelectorAll('time[datetime]')).map(time => time.getAttribute('datetime')))
    .toEqual(transitions.data.slice(0, 5).map(row => row.ts));
  expect(container.querySelector(`time[datetime="${transitions.data[5].ts}"]`)).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  api.vehicles.mockReturnValue(queryResult([{ id: 99 }], { refetch: api.refreshVehicles }));
  api.stats.mockReturnValue(queryResult(stats, { refetch: api.refreshStats }));
  api.transitions.mockReturnValue(queryResult(transitions, { refetch: api.refreshTransitions }));
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)', media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(),
    removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(packs)('FSM distribution %s', packId => {
  it('preserves the actual donut, ranked shares, five timestamped transitions and refresh', async () => {
    const { container } = mount(packId);
    await expectPack(container, packId);

    expect(screen.getByTitle('State distribution')).toBeVisible();
    expect(screen.getByText('Percentages are based on the returned states.')).toBeVisible();
    expect(container.querySelector('.recharts-pie')).not.toBeNull();
    expect(chartRows()).toEqual([
      ['driving', '1h 0m', 60], ['charging', '30m', 30], ['asleep', '10m', 10],
    ]);
    const ranked = within(screen.getByRole('list', { name: 'State shares' })).getAllByRole('listitem');
    expect(ranked.map(row => row.textContent)).toEqual(['driving60%', 'charging30%', 'asleep10%']);
    expectTransitions(container);
    expect(api.stats).toHaveBeenCalledWith('7');
    expect(api.transitions).toHaveBeenCalledWith('7', 'vehicle', 24, 1, 5);
    expect(api.stats).toHaveBeenCalledTimes(1);
    expect(api.transitions).toHaveBeenCalledTimes(1);

    const icon = container.querySelector('[data-instrument-appearance] svg.lucide-git-branch');
    expect(icon).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    expect(api.refreshStats).toHaveBeenCalledOnce();
    expect(api.refreshTransitions).toHaveBeenCalledOnce();
  });

  it('keeps the compact leading share, state and duration without mounting the full chart or feed', async () => {
    const { container } = mount(packId, 1);
    await expectPack(container, packId);
    expect(screen.getByText('60%')).toBeVisible();
    expect(screen.getByText('driving')).toBeVisible();
    expect(screen.getByText('1h 0m')).toBeVisible();
    expect(container.querySelector('.recharts-pie')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Recent transitions' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    expect(api.refreshStats).toHaveBeenCalledOnce();
    expect(api.refreshTransitions).not.toHaveBeenCalled();
  });

  it('keeps empty sections visible and rejects invalid durations instead of inventing a healthy percentage', async () => {
    api.stats.mockReturnValue(queryResult<FSMStats>({
      enabled: true, stats: { driving: 0, charging: -1, asleep: Number.NaN, online: Number.POSITIVE_INFINITY },
    }));
    api.transitions.mockReturnValue(queryResult<FSMTransitionResponse>({ ...transitions, data: [], total: 0 }));
    const { container } = mount(packId);
    await expectPack(container, packId);
    expect(screen.getByText('No state data')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Recent transitions' })).toBeVisible();
    expect(screen.getByText('No recent transitions')).toBeVisible();
    expect(screen.getByRole('list', { name: 'State shares' })).toBeInTheDocument();
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'partial');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByText(/^0%$/)).not.toBeInTheDocument();
    expect(screen.queryByText('67%')).not.toBeInTheDocument();
  });
});

it('retains Classic as the default, lazy-loading body and unknown-pack recovery', async () => {
  const { container, selectPack } = mount();
  const originalRows = chartRows();
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', 'classic');
  expect(container.querySelector('[data-instrument-appearance]')).toBeNull();
  expect(container.querySelector('.recharts-pie')).not.toBeNull();
  expect(screen.queryByText('Percentages are based on the returned states.')).not.toBeInTheDocument();
  expectTransitions(container);

  for (const packId of packs) {
    selectPack(packId);
    expect(container.querySelector('.recharts-pie')).not.toBeNull();
    await expectPack(container, packId);
    expect(chartRows()).toEqual(originalRows);
    expectTransitions(container);
  }
  selectPack('unknown-pack');
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', 'classic');
  expect(container.querySelector('[data-instrument-appearance]')).toBeNull();
  expect(chartRows()).toEqual(originalRows);
  expect(api.stats.mock.calls.every(([id]) => id === '7')).toBe(true);
  expect(api.transitions.mock.calls.every(([id]) => id === '7')).toBe(true);
  expect(api.refreshStats).not.toHaveBeenCalled();
  expect(api.refreshTransitions).not.toHaveBeenCalled();
});

it.each(packs)('%s retains transition rows on refresh failure and retries that source independently', async packId => {
  api.transitions.mockReturnValue(queryResult(transitions, {
    isError: true, isStale: true, error: new Error('Transition refresh failed'), refetch: api.refreshTransitions,
  }));
  const { container } = mount(packId);
  await expectPack(container, packId);
  expectTransitions(container);
  expect(screen.getByText('Previously loaded transitions remain visible while they refresh.')).toBeVisible();
  expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  expect(container.querySelector('.recharts-pie')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(api.refreshTransitions).toHaveBeenCalledOnce();
  expect(api.refreshStats).not.toHaveBeenCalled();
});

it.each(packs)('%s keeps transitions and a source-specific retry when the distribution source fails', async packId => {
  api.stats.mockReturnValue(queryResult<FSMStats>(undefined, {
    isError: true, error: new Error('Stats unavailable'), refetch: api.refreshStats,
  }));
  const { container } = mount(packId);
  await expectPack(container, packId);
  expect(screen.getByText('State distribution could not be loaded.')).toBeVisible();
  expectTransitions(container);
  expect(screen.queryByText('0%')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(api.refreshStats).toHaveBeenCalledOnce();
  expect(api.refreshTransitions).not.toHaveBeenCalled();
});

it.each(packs)('%s keeps the distribution when transitions fail and exposes an independent transition retry', async packId => {
  api.transitions.mockReturnValue(queryResult<FSMTransitionResponse>(undefined, {
    isError: true, error: new Error('Transitions unavailable'), refetch: api.refreshTransitions,
  }));
  const { container } = mount(packId);
  await expectPack(container, packId);
  expect(screen.getByText('Recent transitions could not be loaded.')).toBeVisible();
  expect(chartRows()).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(api.refreshTransitions).toHaveBeenCalledOnce();
  expect(api.refreshStats).not.toHaveBeenCalled();
});

it.each(packs)('%s announces transition loading without claiming an empty history or hiding the donut', async packId => {
  api.transitions.mockReturnValue(queryResult<FSMTransitionResponse>(undefined, {
    isLoading: true, isPending: true, isFetching: true,
  }));
  const { container } = mount(packId);
  await expectPack(container, packId);
  expect(screen.getByRole('status', { name: 'Loading Recent transitions' })).toBeInTheDocument();
  expect(screen.queryByText('No recent transitions')).not.toBeInTheDocument();
  expect(chartRows()).toHaveLength(3);
});

it.each(packs)('%s keeps an empty compact presentation honest and resolves the original default vehicle', async packId => {
  api.stats.mockReturnValue(queryResult<FSMStats>({ enabled: false, stats: {} }));
  const { container } = mount(packId, 1, null);
  await expectPack(container, packId);
  expect(screen.getByText('No state data')).toBeVisible();
  expect(screen.queryByText('0%')).not.toBeInTheDocument();
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  expect(api.stats).toHaveBeenCalledWith('99');
});
