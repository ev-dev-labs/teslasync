import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetSize } from './types';
import WeeklySummaryCardWidget from './WeeklySummaryCardWidget';

const { weeklyDigestMock, vehiclesMock, unitsMock, refresh } = vi.hoisted(() => ({
  weeklyDigestMock: vi.fn<(id: string) => unknown>(),
  vehiclesMock: vi.fn<() => unknown>(),
  unitsMock: vi.fn<() => { unitPrefs: { distance: 'km' | 'mi' } }>(),
  refresh: vi.fn<() => void>(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : key;
      const values = typeof fallback === 'object' ? fallback : options;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''));
    },
  }),
}));
vi.mock('@/api/hooks/useAnalytics', () => ({ useWeeklyDigest: (id: string) => weeklyDigestMock(id) }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => vehiclesMock() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => unitsMock() }));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    currencySymbol: '$',
    formatCurrency: (value: number) => `$${value.toFixed(2)}`,
  }),
}));

const packs = Object.entries(PACK_APPEARANCES);
const NOW = Date.parse('2026-11-06T12:00:00Z');
const digest = {
  drives: 8, prevDrives: 4, distanceKm: 200, prevDistanceKm: 100,
  energyWh: 40000, prevEnergyWh: 50000, cost: 5.6, prevCost: 7,
  efficiency: 200, prevEfficiency: 250,
};
interface QueryFixture {
  data: Partial<typeof digest> | null | undefined;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  error: Error | null;
  dataUpdatedAt: number;
  refetch: typeof refresh;
}
function query(overrides: Partial<QueryFixture> = {}): QueryFixture {
  return {
    data: digest, isLoading: false, isPending: false, isFetching: false,
    isStale: false, isError: false, error: null, dataUpdatedAt: NOW,
    refetch: refresh, ...overrides,
  };
}
function renderWidget(packId: string, size: WidgetSize = { cols: 2, rows: 2 }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (requestedPackId: string) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <WeeklySummaryCardWidget vehicleId={7} size={size} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(tree(packId));
  return { ...result, selectPack: (id: string) => result.rerender(tree(id)) };
}
async function presentation(container: HTMLElement, appearance: string) {
  const selector = `[data-widget-family="bars"][data-widget-appearance="${appearance}"]`;
  await waitFor(() => expect(container.querySelector(selector)).not.toBeNull());
  return within(container.querySelector<HTMLElement>(selector)!);
}

beforeEach(() => {
  vi.clearAllMocks();
  weeklyDigestMock.mockReturnValue(query());
  vehiclesMock.mockReturnValue({ ...query(), data: [{ id: 3 }] });
  unitsMock.mockReturnValue({ unitPrefs: { distance: 'km' } });
});
afterEach(cleanup);

describe.each(packs)('Weekly summary %s (%s)', (packId, appearance) => {
  it('uses the real presentation with both distance samples, every comparison and the source refresh action', async () => {
    const { container } = renderWidget(packId);
    const view = await presentation(container, appearance);
    expect(view.getByText('Distance this week')).toBeInTheDocument();
    expect(view.getByText('This week vs last week')).toBeInTheDocument();
    for (const label of ['Distance', 'Energy', 'Cost', 'Efficiency']) {
      expect(view.getByText(label, { exact: true })).toBeInTheDocument();
    }
    expect(view.getByRole('progressbar', { name: 'Last week' })).toHaveAttribute('aria-valuenow', '100');
    expect(view.getByRole('progressbar', { name: 'this week' })).toHaveAttribute('aria-valuenow', '200');
    expect(view.getByRole('progressbar', { name: 'this week' })).toHaveAttribute('aria-valuemax', '200');
    for (const previous of ['Last week 100.00 km', 'Last week 50.00 kWh', 'Last week $7.00', 'Last week 250.00 Wh/km']) {
      expect(view.getByText(previous)).toBeInTheDocument();
    }
    expect(view.getByText('40.00')).toBeInTheDocument();
    expect(view.getByText('$5.60')).toBeInTheDocument();
    expect(view.getByText('Wh/km')).toBeInTheDocument();
    expect(view.getByTitle('200.00 vs 100.00')).toHaveTextContent('100.00%');
    expect(weeklyDigestMock).toHaveBeenCalledWith('7');
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refresh).toHaveBeenCalledOnce();
    if (packId === 'v7') {
      expect(container.querySelectorAll('[data-metric-fill]')).toHaveLength(0);
      expect(view.getAllByRole('progressbar')).toHaveLength(2);
      expect(container.querySelector('.lucide-calendar-days')).not.toBeNull();
    }
  });

  it('retains the compact distance and energy branch without adding the full-only metrics', async () => {
    const { container } = renderWidget(packId, { cols: 1, rows: 1 });
    const view = await presentation(container, appearance);
    expect(view.getByText('Distance', { exact: true })).toBeInTheDocument();
    expect(view.getByText('Energy', { exact: true })).toBeInTheDocument();
    expect(view.queryByText('Cost', { exact: true })).not.toBeInTheDocument();
    expect(view.queryByText('Efficiency', { exact: true })).not.toBeInTheDocument();
    expect(view.getAllByRole('progressbar')).toHaveLength(2);
  });

  it('keeps missing samples unknown and independent energy evidence visible', async () => {
    weeklyDigestMock.mockReturnValue(query({
      data: { ...digest, distanceKm: Number.NaN, prevDistanceKm: undefined, cost: undefined, efficiency: undefined },
    }));
    const { container } = renderWidget(packId);
    const view = await presentation(container, appearance);
    for (const label of ['Last week', 'this week']) {
      const track = view.getByRole('progressbar', { name: label });
      expect(track).not.toHaveAttribute('aria-valuenow');
      expect(track).toHaveAttribute('aria-valuetext', 'No reading');
    }
    expect(view.getByText('40.00')).toBeInTheDocument();
    expect(view.getAllByTestId('delta-empty')).toHaveLength(3);
    expect(view.queryByText('$0.00')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
    expect(container.querySelector('[data-metric-fill]')).toBeNull();
  });
});

it('keeps Classic and unknown-pack recovery as the original comparison card without extra instruments', () => {
  const { container, selectPack } = renderWidget('classic');
  for (const label of ['Distance', 'Energy', 'Cost', 'Efficiency']) {
    expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
  }
  expect(container.querySelector('[data-widget-family]')).toBeNull();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  selectPack('retired-pack');
  expect(screen.getByText('$5.60')).toBeInTheDocument();
  expect(container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
});

it('switches every pack on the same controller and keeps the existing refresh control and vehicle scope', async () => {
  const { container, selectPack } = renderWidget('classic');
  const control = screen.getByRole('button', { name: /^Refresh/i });
  control.focus();
  for (const [packId, appearance] of packs) {
    selectPack(packId);
    await presentation(container, appearance);
    expect(screen.getByRole('button', { name: /^Refresh/i })).toBe(control);
    expect(control).toHaveFocus();
    expect(screen.getByText('$5.60')).toBeInTheDocument();
  }
  selectPack('classic');
  expect(container.querySelector('[data-widget-family]')).toBeNull();
  fireEvent.click(control);
  expect(refresh).toHaveBeenCalledOnce();
  expect(weeklyDigestMock.mock.calls.every(([id]) => id === '7')).toBe(true);
});

it.each(packs)('%s converts the headline and both graphic samples once to the selected miles preference', async (packId, appearance) => {
  unitsMock.mockReturnValue({ unitPrefs: { distance: 'mi' } });
  const { container } = renderWidget(packId);
  const view = await presentation(container, appearance);
  expect(view.getByText('124.27 mi')).toBeInTheDocument();
  expect(view.getByText('62.14 mi')).toBeInTheDocument();
  expect(view.getByText('321.87')).toBeInTheDocument();
  expect(view.getByText('Wh/mi')).toBeInTheDocument();
  const current = Number(view.getByRole('progressbar', { name: 'this week' }).getAttribute('aria-valuenow'));
  expect(current).toBeCloseTo(124.274, 2);
  expect(view.queryByText('km', { exact: true })).not.toBeInTheDocument();
});

it.each(packs)('%s retains measured zero and signed monetary evidence rather than treating either as missing', async (packId, appearance) => {
  weeklyDigestMock.mockReturnValue(query({ data: { ...digest, distanceKm: 0, cost: -1.5 } }));
  const { container } = renderWidget(packId);
  const view = await presentation(container, appearance);
  expect(view.getByRole('progressbar', { name: 'this week' })).toHaveAttribute('aria-valuenow', '0');
  expect(view.getByText('0.00 km')).toBeInTheDocument();
  expect(view.getByText('$-1.50')).toBeInTheDocument();
});

it.each(packs)('%s does not invent a numeric scale when both measured distance samples are zero', async (packId, appearance) => {
  weeklyDigestMock.mockReturnValue(query({ data: { ...digest, distanceKm: 0, prevDistanceKm: 0 } }));
  const { container } = renderWidget(packId);
  const view = await presentation(container, appearance);
  expect(view.getByRole('group', { name: 'this week' })).not.toHaveAttribute('aria-valuemax');
  expect(view.getByRole('group', { name: 'Last week' })).not.toHaveAttribute('aria-valuemax');
  expect(view.getAllByText('0.00 km')).toHaveLength(2);
  expect(view.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(container.querySelector('[data-metric-fill]')).toBeNull();
});

it.each(packs)('%s keeps a successful empty source explicit and does not fabricate numeric content', async (packId, appearance) => {
  weeklyDigestMock.mockReturnValue(query({ data: null }));
  const { container } = renderWidget(packId);
  const view = await presentation(container, appearance);
  expect(view.getByText('No weekly data')).toBeInTheDocument();
  expect(view.getByText('Distance this week')).toBeInTheDocument();
  expect(view.getByRole('progressbar', { name: 'this week' })).not.toHaveAttribute('aria-valuenow');
  expect(view.queryByText('$0.00')).not.toBeInTheDocument();
});

it.each(packs)('%s retains all comparisons and a trust warning when a background refresh fails', async (packId, appearance) => {
  weeklyDigestMock.mockReturnValue(query({ isError: true, isStale: true, error: new Error('Digest refresh failed') }));
  const { container } = renderWidget(packId);
  await presentation(container, appearance);
  expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Previously loaded data remains visible');
  expect(screen.getByText('$5.60')).toBeInTheDocument();
  expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull();
});

it.each(packs)('%s keeps the loading shell without prematurely showing a source reading', (packId) => {
  weeklyDigestMock.mockReturnValue(query({
    data: undefined, dataUpdatedAt: 0, isLoading: true, isPending: true, isFetching: true,
  }));
  const { container } = renderWidget(packId);
  expect(screen.getByRole('heading', { name: 'Weekly summary' })).toBeInTheDocument();
  expect(container.querySelector('[data-data-state="initial"]')).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByText('Distance this week')).not.toBeInTheDocument();
  expect(screen.queryByText('No weekly data')).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

it.each(packs)('%s keeps the source shell and retry action on an initial failure instead of showing invented metrics', (packId) => {
  weeklyDigestMock.mockReturnValue(query({
    data: undefined, dataUpdatedAt: 0, isError: true, error: new Error('Digest unavailable'),
  }));
  const { container } = renderWidget(packId);
  expect(screen.getByRole('heading', { name: 'Weekly summary' })).toBeInTheDocument();
  expect(container.querySelector('[data-data-state="initialFailure"]')).not.toBeNull();
  expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
  expect(refresh).toHaveBeenCalledOnce();
});
