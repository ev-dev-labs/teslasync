import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { VehicleStateReadings } from '@/api/types';
import type { DistanceUnitPref } from '@/lib/unitConversion';
import RangeEstimateWidget from './RangeEstimateWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import type { WidgetSize } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

type RangeState = Pick<VehicleStateReadings,
  'vehicle_id' | 'state' | 'rated_range' | 'ideal_range' | 'battery_level'>;
interface QueryFixture {
  data: { state?: RangeState; live: boolean } | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  error: Error | null;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

let distanceUnit: DistanceUnitPref;
let vehicles: { id: number }[];
let query: QueryFixture;
const stateCalls = vi.fn();
const clients: QueryClient[] = [];

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: distanceUnit } }),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: vehicles }),
  useVehicleState: (id: number) => {
    stateCalls(id);
    return query;
  },
}));

const productionPacks = PACK_IDS.filter((id): id is Exclude<PackId, 'classic'> => id !== 'classic');
const comparisonTitle = 'Rated and ideal range comparison';
const disclaimer = 'Estimates are not guarantees of real-world range.';

function makeState(overrides: Partial<RangeState> = {}): RangeState {
  return {
    vehicle_id: 7, state: 'online', rated_range: 410_000,
    ideal_range: 430_000, battery_level: 72, ...overrides,
  };
}

function makeQuery(overrides: Partial<QueryFixture> = {}): QueryFixture {
  return {
    data: { state: makeState(), live: true },
    isLoading: false, isFetching: false, isStale: false, isError: false,
    error: null, dataUpdatedAt: Date.now(), refetch: vi.fn(), ...overrides,
  };
}

function renderWidget(packId: unknown = 'classic', options: {
  size?: WidgetSize;
  vehicleId?: number;
  unit?: DistanceUnitPref;
} = {}) {
  distanceUnit = options.unit ?? 'km';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const tree = (requestedPackId: unknown) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <RangeEstimateWidget vehicleId={options.vehicleId} size={options.size ?? { cols: 2, rows: 3 }} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(packId));
  return { ...view, selectPack: (next: unknown) => view.rerender(tree(next)) };
}

async function expectPack(container: HTMLElement, packId: Exclude<PackId, 'classic'>) {
  await waitFor(() => {
    expect(container.querySelector(`[data-widget-family="bars"][data-widget-appearance="${PACK_APPEARANCES[packId]}"]`))
      .not.toBeNull();
  });
}

beforeEach(() => {
  distanceUnit = 'km';
  vehicles = [{ id: 7 }];
  query = makeQuery();
  stateCalls.mockClear();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, 600, 240));
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.restoreAllMocks();
});

describe.each(productionPacks)('Range Estimate %s production appearance', packId => {
  it.each([{ cols: 1, rows: 1 }, { cols: 2, rows: 3 }])(
    'keeps the rated headline, two source-backed columns, ideal/battery facts and caveat at %j',
    async size => {
      query = makeQuery({ data: { state: makeState({ vehicle_id: 9 }), live: true } });
      const { container } = renderWidget(packId, { size, vehicleId: 9 });
      await expectPack(container, packId);
      expect(screen.getByRole('heading', { name: 'Range', level: 3 })).toBeVisible();
      expect(screen.getByText('Estimate')).toBeVisible();
      expect(screen.getAllByText('410 km')).toHaveLength(2);
      expect(screen.getAllByText('430 km')).toHaveLength(2);
      expect(screen.getByText('Battery')).toBeVisible();
      expect(screen.getByText('72%')).toBeVisible();
      expect(screen.getByText(disclaimer)).toBeVisible();
      const figure = screen.getByRole('figure', { name: comparisonTitle });
      const table = within(figure).getByRole('table');
      expect(within(table).getAllByRole('row')).toHaveLength(3);
      expect(within(table).getByRole('row', { name: 'Rated range 410 km' })).toBeInTheDocument();
      expect(within(table).getByRole('row', { name: 'Ideal range 430 km' })).toBeInTheDocument();
      await waitFor(() => expect(figure.querySelector('.recharts-bar')).not.toBeNull());
      await waitFor(() => expect(figure.querySelectorAll('pattern')).toHaveLength(packId === 'v7' ? 2 : 0));
      if (packId === 'v7') {
        for (const bar of figure.querySelectorAll('.recharts-bar-rectangle path')) {
          expect(bar.getAttribute('fill')).toMatch(/^url\(#bar-/);
        }
      }
      expect(stateCalls).toHaveBeenCalledWith(9);
      expect(screen.queryByText('Realistic estimate')).not.toBeInTheDocument();
    },
  );

  it('keeps every section when readings are unavailable without inventing measured zero', async () => {
    query = makeQuery({ data: { state: undefined, live: false } });
    const { container } = renderWidget(packId);
    await expectPack(container, packId);
    expect(screen.getAllByText('Rated range').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ideal range').length).toBeGreaterThan(0);
    expect(screen.getByText('Battery')).toBeVisible();
    expect(screen.getByText('No range data')).toBeInTheDocument();
    expect(screen.getByText(disclaimer)).toBeVisible();
    const figure = screen.getByRole('figure', { name: comparisonTitle });
    expect(figure).toHaveAttribute('data-chart-state', 'empty');
    expect(within(figure).getByRole('row', { name: 'Rated range —' })).toBeInTheDocument();
    expect(within(figure).getByRole('row', { name: 'Ideal range —' })).toBeInTheDocument();
    expect(screen.queryByText('0 km')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('retains the range and refresh action after a background failure', async () => {
    const refetch = vi.fn();
    query = makeQuery({ error: new Error('Refresh failed'), isError: true, isStale: true, refetch });
    const { container } = renderWidget(packId);
    await expectPack(container, packId);
    expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getAllByText('410 km')).toHaveLength(2);
    expect(screen.getAllByText('430 km')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: /^Refresh/i })[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(disclaimer)).toBeVisible();
  });
});

it.each(productionPacks)('converts all %s comparison readings and labels to the selected display unit', async packId => {
  query = makeQuery({ data: { state: makeState({ rated_range: 482_803.2, ideal_range: 321_868.8 }), live: true } });
  const { container } = renderWidget(packId, { unit: 'mi' });
  await expectPack(container, packId);
  expect(screen.getAllByText('300 mi')).toHaveLength(2);
  expect(screen.getAllByText('200 mi')).toHaveLength(2);
  expect(screen.queryByText(/\bkm\b/)).not.toBeInTheDocument();
});

describe.each(productionPacks)('Range Estimate %s source and controller states', packId => {
  it.each([
    { rated_range: 0, ideal_range: 0, battery_level: 0, rated: '0 km', ideal: '0 km', battery: '0%' },
    { rated_range: Number.NaN, ideal_range: -10, battery_level: 101, rated: '—', ideal: '—', battery: '—' },
    { rated_range: null, ideal_range: 430_000, battery_level: null, rated: '—', ideal: '430 km', battery: '—' },
  ])('distinguishes zero, invalid and partial source readings: %j', async reading => {
    query = makeQuery({ data: { state: makeState(reading), live: true } });
    const { container } = renderWidget(packId);
    await expectPack(container, packId);
    const table = within(screen.getByRole('figure', { name: comparisonTitle })).getByRole('table');
    expect(within(table).getByRole('row', { name: `Rated range ${reading.rated}` })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: `Ideal range ${reading.ideal}` })).toBeInTheDocument();
    const facts = screen.getByText('Battery').closest('li');
    expect(facts).not.toBeNull();
    expect(within(facts!).getByText(reading.battery)).toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    expect(screen.queryByText('-0 km')).not.toBeInTheDocument();
  });

  it('preserves Classic during default, unknown selection and recovery from a production appearance', async () => {
    const refetch = vi.fn();
    query = makeQuery({ refetch });
    const view = renderWidget();
    expect(view.container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
    expect(screen.getByText('410 km')).toBeInTheDocument();
    expect(screen.getByText('430 km')).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
    expect(screen.queryByText('Battery')).not.toBeInTheDocument();
    expect(screen.queryByText(disclaimer)).not.toBeInTheDocument();
    view.selectPack(packId);
    await expectPack(view.container, packId);
    fireEvent.click(screen.getAllByRole('button', { name: /^Refresh/i })[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
    view.selectPack('unknown-pack');
    expect(view.container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
    expect(screen.getByText('410 km')).toBeInTheDocument();
    expect(screen.getByText('430 km')).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  });

  it('keeps the source shell while loading and uses fatalError only when no data is retained', () => {
    query = makeQuery({ data: undefined, isLoading: true, dataUpdatedAt: 0 });
    const view = renderWidget(packId);
    expect(view.container.querySelector(`[data-widget-pack="${packId}"]`)).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('410 km')).not.toBeInTheDocument();
    query = makeQuery({ data: undefined, error: new Error('No source'), isError: true, dataUpdatedAt: 0 });
    view.selectPack(packId);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });
});
