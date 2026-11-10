import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { WeeklyDigestData } from '@/types/analytics';
import type { WidgetSize } from './types';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS } from './designPacks/types';
import WeeklyDigestWidget from './WeeklyDigestWidget';

const mocks = vi.hoisted(() => ({
  digest: vi.fn(), vehicles: vi.fn(), units: vi.fn(),
  refreshDigest: vi.fn(), refreshVehicles: vi.fn(),
}));
vi.mock('@/api/hooks/useAnalytics', () => ({
  useWeeklyDigest: (id: string) => mocks.digest(id),
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => mocks.vehicles() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => mocks.units() }));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (value: unknown) => String(value), tz: 'UTC', locale: 'en-US' }),
}));

const PACKS = PACK_IDS
  .filter((pack): pack is keyof typeof PACK_APPEARANCES => pack !== 'classic')
  .map(pack => [pack, PACK_APPEARANCES[pack]] as const);
const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const CHART_LABEL = 'Drives this week compared with last week';
type DigestFixture = { [K in keyof WeeklyDigestData]: WeeklyDigestData[K] | null | undefined };

function digest(overrides: Partial<DigestFixture> = {}): DigestFixture {
  return {
    drives: 8, prevDrives: 5, distanceKm: 100, prevDistanceKm: 80,
    efficiency: 250, prevEfficiency: 300, energyWh: 25000, prevEnergyWh: 20000,
    cost: 3.5, prevCost: 2.8, ...overrides,
  };
}
function units(distance: 'mi' | 'km' = 'mi') {
  return { unitPrefs: {
    distance, speed: distance === 'mi' ? 'mph' : 'km/h', temperature: '°C', pressure: 'bar',
    energy: 'kWh', power: 'kW', duration: 'h', locale: 'en-US',
  } };
}
function query<T>(data: T, refetch = mocks.refreshDigest, overrides: {
  isLoading?: boolean; isPending?: boolean; isFetching?: boolean;
  isError?: boolean; error?: Error | null; fetchStatus?: 'idle' | 'paused';
} = {}) {
  return {
    data, refetch, isLoading: false, isPending: false, isFetching: false,
    isStale: false, isError: false, error: null, fetchStatus: 'idle',
    dataUpdatedAt: Date.parse('2026-11-06T12:00:00Z'), ...overrides,
  };
}
function tree(pack: unknown, size = FULL, vehicleId?: number) {
  return <MemoryRouter><PackBoundary requestedPackId={pack}>
    <WeeklyDigestWidget size={size} vehicleId={vehicleId} />
  </PackBoundary></MemoryRouter>;
}
async function mount(pack: (typeof PACKS)[number][0], appearance: string, size = FULL) {
  const view = render(tree(pack, size));
  await waitFor(() => expect(view.container.querySelector(`[data-widget-appearance="${appearance}"]`)).not.toBeNull());
  return view;
}
function rail(container: HTMLElement) {
  const element = container.querySelector<HTMLElement>('.widget-stat-rail');
  if (!element) throw new Error('Weekly comparisons are missing');
  return within(element);
}
function periods() {
  const table = screen.getByRole('table', { name: 'Drives — data table' });
  return within(table).getAllByRole('row').slice(1).map(row =>
    within(row).getAllByRole('cell').map(cell => cell.textContent),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.digest.mockReturnValue(query(digest()));
  mocks.vehicles.mockReturnValue(query([{ id: 7 }], mocks.refreshVehicles));
  mocks.units.mockReturnValue(units());
});
afterEach(cleanup);

describe.each(PACKS)('WeeklyDigestWidget %s (%s)', (pack, appearance) => {
  it('renders actual weekly bars, every comparison and the working source refresh', async () => {
    const { container } = await mount(pack, appearance);
    expect(container.querySelector('[data-widget-family="bars"]')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'This week', level: 3 })).toBeVisible();
    expect(screen.getByRole('img', { name: CHART_LABEL })).toBeInTheDocument();
    expect(periods()).toEqual([['last week', '5'], ['this week', '8']]);
    const metrics = rail(container);
    for (const label of ['Distance', 'Drives', 'Energy', 'Efficiency']) {
      expect(metrics.getByText(label)).toBeInTheDocument();
    }
    expect(metrics.getByText('62')).toBeInTheDocument();
    expect(metrics.getByText('402')).toBeInTheDocument();
    expect(metrics.getByText('25.0')).toBeInTheDocument();
    expect(metrics.getByText('last week 50 mi')).toBeInTheDocument();
    expect(metrics.getByText('last week 20.0 kWh')).toBeInTheDocument();
    expect(metrics.getByText('last week 483 Wh/mi')).toBeInTheDocument();
    expect(mocks.digest).toHaveBeenCalledWith('7');
    const refresh = screen.getAllByRole('button', { name: /^Refresh/i });
    expect(refresh).toHaveLength(1);
    fireEvent.click(refresh[0]);
    expect(mocks.refreshDigest).toHaveBeenCalledOnce();
    expect(mocks.refreshVehicles).not.toHaveBeenCalled();
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('8');
    expect(container.querySelector('.widget-big-number svg')).toBeNull();
    expect(container.querySelector('[data-widget-family="bars"] svg.lucide-calendar-days')).not.toBeNull();
  });

  it('retains the compact Distance and Drives branch without mounting a full plot', async () => {
    const { container } = await mount(pack, appearance, COMPACT);
    const metrics = rail(container);
    expect(metrics.getByText('Distance')).toBeInTheDocument();
    expect(metrics.getByText('Drives')).toBeInTheDocument();
    expect(screen.queryByText('Energy')).not.toBeInTheDocument();
    expect(screen.queryByText('Efficiency')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(container.querySelector('.widget-big-number')).toBeNull();
  });

  it('keeps unknown measurements separate from a genuine zero in the prior week', async () => {
    mocks.digest.mockReturnValue(query(digest({
      drives: null, prevDrives: 0, distanceKm: null, efficiency: null, energyWh: null,
    })));
    const { container } = await mount(pack, appearance);
    expect(periods()).toEqual([['last week', '0'], ['this week', '—']]);
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
    expect(container.querySelector('.widget-big-number')).not.toHaveTextContent('0');
    expect(rail(container).getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
  });

  it('preserves empty section shells and an honest empty plot without invented counts', async () => {
    mocks.digest.mockReturnValue(query(undefined));
    const { container } = await mount(pack, appearance);
    expect(screen.getByText('No weekly data yet')).toBeInTheDocument();
    expect(container.querySelector('[data-chart-state="empty"]')).toBeInTheDocument();
    expect(periods()).toEqual([['last week', '—'], ['this week', '—']]);
    for (const label of ['Distance', 'Drives', 'Energy', 'Efficiency']) {
      expect(rail(container).getByText(label)).toBeInTheDocument();
    }
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
  });
});

it('preserves Classic and unknown-ID recovery while switching presentation without resetting the controller', async () => {
  const view = render(tree('classic', FULL, 3));
  const body = screen.getByTestId('widget-body');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(rail(view.container).getByText('62')).toBeInTheDocument();
  for (const [pack, appearance] of PACKS) {
    view.rerender(tree(pack, FULL, 3));
    await waitFor(() => expect(view.container.querySelector(`[data-widget-appearance="${appearance}"]`)).not.toBeNull());
    expect(screen.getByTestId('widget-body')).toBe(body);
    expect(periods()).toEqual([['last week', '5'], ['this week', '8']]);
  }
  view.rerender(tree('unrecognized-pack', FULL, 3));
  expect(view.container.querySelector('[data-widget-pack="classic"]')).toBeInTheDocument();
  expect(view.container.querySelector('[data-widget-family]')).toBeNull();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(rail(view.container).getByText('62')).toBeInTheDocument();
  expect(rail(view.container).getByText('Energy')).toBeInTheDocument();
  expect(mocks.digest).toHaveBeenLastCalledWith('3');
  expect(mocks.refreshDigest).not.toHaveBeenCalled();
});

describe.each(PACKS)('WeeklyDigestWidget %s (%s) source states', (pack, appearance) => {
  it('retains bars and comparisons on background failure with one nonblocking warning and retry action', async () => {
    mocks.digest.mockReturnValue(query(digest(), mocks.refreshDigest, {
      isError: true, error: new Error('synthetic refresh failure'),
    }));
    const { container } = await mount(pack, appearance);
    expect(container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
    expect(periods()).toEqual([['last week', '5'], ['this week', '8']]);
    expect(rail(container).getByText('Energy')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refreshDigest).toHaveBeenCalledOnce();
  });

  it('preserves kilometre and efficiency preferences in the production presentation', async () => {
    mocks.units.mockReturnValue(units('km'));
    const { container } = await mount(pack, appearance);
    const metrics = rail(container);
    expect(metrics.getByText('100')).toBeInTheDocument();
    expect(metrics.getByText('250')).toBeInTheDocument();
    expect(metrics.getByText('Wh/km')).toBeInTheDocument();
    expect(metrics.getByText('last week 80 km')).toBeInTheDocument();
    expect(metrics.getByText('25.0')).toBeInTheDocument();
    expect(periods()).toEqual([['last week', '5'], ['this week', '8']]);
  });

  it('shows a reported zero this week without treating an unknown prior week as zero', async () => {
    mocks.digest.mockReturnValue(query(digest({ drives: 0, prevDrives: undefined })));
    const { container } = await mount(pack, appearance);
    expect(periods()).toEqual([['last week', '—'], ['this week', '0']]);
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('0');
    expect(container.querySelector('.widget-big-number')).not.toHaveTextContent('—');
  });

  it('keeps initial loading and fatal errors in the source shell, then retries vehicle discovery when scope is empty', async () => {
    mocks.digest.mockReturnValue(query(undefined, mocks.refreshDigest, { isLoading: true, isPending: true }));
    const view = render(tree(pack));
    expect(view.container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    view.unmount();
    mocks.digest.mockReturnValue(query(undefined, mocks.refreshDigest, { isError: true, error: new Error('offline') }));
    const failed = render(tree(pack));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    failed.unmount();
    mocks.digest.mockReturnValue(query(undefined));
    mocks.vehicles.mockReturnValue(query([], mocks.refreshVehicles));
    await mount(pack, appearance);
    expect(mocks.digest).toHaveBeenLastCalledWith('');
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refreshVehicles).toHaveBeenCalledOnce();
    expect(mocks.refreshDigest).not.toHaveBeenCalled();
  });

  it.each([undefined, null, NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'does not round invalid or unreported drive counts (%s) into valid measurements',
    async value => {
      mocks.digest.mockReturnValue(query(digest({ drives: value, prevDrives: 0 })));
      const { container } = await mount(pack, appearance);
      expect(periods()).toEqual([['last week', '0'], ['this week', '—']]);
      expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
    },
  );
});
