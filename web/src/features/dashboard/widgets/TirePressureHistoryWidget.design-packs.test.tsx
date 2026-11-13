import { cloneElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as settingsHook from '@/hooks/useSettings';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import TirePressureHistoryWidget from './TirePressureHistoryWidget';

const { historyMock, vehiclesMock, refetch } = vi.hoisted(() => ({
  historyMock: vi.fn(),
  vehiclesMock: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useTirePressureAnalysisHistory: historyMock,
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vehiclesMock }));
vi.mock('@/components/charts', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/charts')>(),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
    cloneElement(children, { width: 640, height: 300 }),
}));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    start: '2026-11-01',
    end: '2026-11-06',
    startInstant: '2026-11-01T00:00:00.000Z',
    endInstantExclusive: '2026-11-07T00:00:00.000Z',
    presetId: '30d',
  }),
}));

interface Sample {
  created_at: string;
  frontLeft: number | null;
  frontRight: number | null;
  rearLeft: number | null;
  rearRight: number | null;
}

// Canonical Pa, intentionally unordered, with a genuine gap in each series.
const samples: Sample[] = [
  { created_at: '2026-11-06T12:00:00.000Z', frontLeft: 280_000, frontRight: 285_000, rearLeft: 290_000, rearRight: 295_000 },
  { created_at: '2026-11-01T12:00:00.000Z', frontLeft: 279_000, frontRight: 284_000, rearLeft: 289_000, rearRight: 294_000 },
  { created_at: '2026-11-04T12:00:00.000Z', frontLeft: null, frontRight: null, rearLeft: null, rearRight: null },
];

const packCases = PACK_IDS
  .filter((packId): packId is Exclude<PackId, 'classic'> => packId !== 'classic')
  .map(packId => [packId, PACK_APPEARANCES[packId]] as const);

function makeQuery(data: Sample[] | undefined, overrides: {
  isLoading?: boolean;
  isPending?: boolean;
  isFetching?: boolean;
  isError?: boolean;
  error?: Error;
} = {}) {
  return {
    data,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isStale: false,
    isError: false,
    error: null,
    fetchStatus: 'idle',
    dataUpdatedAt: data?.length ? Date.now() : 0,
    refetch,
    ...overrides,
  };
}

function widget(packId?: PackId, cols = 2) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <TirePressureHistoryWidget vehicleId={7} size={{ cols, rows: 4 }} />
      </PackBoundary>
    </MemoryRouter>
  );
}

function metric(label: string) {
  const element = screen.getAllByText(label)
    .map(node => node.closest('.widget-big-number'))
    .find(node => node instanceof HTMLElement);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing pressure readout: ${label}`);
  return within(element);
}

async function mountPack(packId: PackId, appearance: string, cols = 2) {
  const view = render(widget(packId, cols));
  await waitFor(() => {
    expect(view.container.querySelector(`[data-widget-appearance="${appearance}"]`))
      .toHaveAttribute('data-widget-family', 'line');
  });
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Supply layout, not a chart/presentation double, so the real legend mounts.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, 640, 300));
  vehiclesMock.mockReturnValue({ data: [{ id: 42 }] });
  historyMock.mockReturnValue(makeQuery(samples));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(packCases)('tire pressure history %s / %s', (packId, appearance) => {
  it('retains the four original series, every sample and gap, scoped history, timestamps and refresh', async () => {
    const { container } = await mountPack(packId, appearance);

    expect(screen.getByTitle('Tire pressure history')).toBeInTheDocument();
    expect(metric('Front-left pressure').getByText('2.80')).toBeInTheDocument();
    expect(metric('FR').getByText('2.85')).toBeInTheDocument();
    expect(metric('RL').getByText('2.90')).toBeInTheDocument();
    expect(metric('RR').getByText('2.95')).toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getAllByText('Last 30 days · bar').length).toBeGreaterThan(0);
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();

    // Keep the real EmbeddedChart/ChartContainer and its accessible data table.
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent))
      .toEqual(['Time', 'FL (bar)', 'FR (bar)', 'RL (bar)', 'RR (bar)']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map(row => within(row).getAllByRole('cell').slice(1).map(cell => cell.textContent)))
      .toEqual([
        ['2.79', '2.84', '2.89', '2.94'],
        ['—', '—', '—', '—'],
        ['2.8', '2.85', '2.9', '2.95'],
      ]);
    const newestTime = within(rows[2]).getAllByRole('cell')[0].textContent;
    expect(screen.getAllByText(`Last reported ${newestTime}`)).toHaveLength(4);
    expect(container.querySelector('.recharts-reference-area')).toBeNull();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(historyMock).toHaveBeenLastCalledWith('7', 30, {
      start: '2026-11-01T00:00:00.000Z',
      end: '2026-11-07T00:00:00.000Z',
    });

    const frontLeftToggle = await screen.findByRole('button', { name: /^fl$/i });
    expect(frontLeftToggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(frontLeftToggle);
    expect(frontLeftToggle).toHaveAttribute('aria-pressed', 'true');
    expect(metric('Front-left pressure').getByText('2.80')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    fireEvent.click(frontLeftToggle);
    expect(frontLeftToggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: /refresh data/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(samples[0].frontLeft).toBe(280_000);
  });

  it('preserves the compact summary without charting unknown or invalid corners as zero', async () => {
    historyMock.mockReturnValue(makeQuery([{
      created_at: samples[0].created_at,
      frontLeft: null,
      frontRight: 0,
      rearLeft: Number.NaN,
      rearRight: Number.POSITIVE_INFINITY,
    }]));
    await mountPack(packId, appearance, 1);

    expect(metric('Front-left pressure').getByText('—')).toBeInTheDocument();
    expect(metric('FR').getByText('0.00')).toBeInTheDocument();
    expect(metric('FR').getByText('bar')).toBeInTheDocument();
    expect(metric('RL').getByText('—')).toBeInTheDocument();
    expect(metric('RR').getByText('—')).toBeInTheDocument();
    expect(screen.getAllByText('Not reported')).toHaveLength(3);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });
});

it.each([1, 2, 3])('keeps Classic as the unchanged default at %i columns', cols => {
  const { container } = render(widget(undefined, cols));
  expect(container.querySelector('[data-widget-pack="classic"]')).toBeInTheDocument();
  expect(container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(screen.getByTitle('Tire pressure history')).toBeInTheDocument();
  expect(screen.queryByText('Front-left pressure')).not.toBeInTheDocument();
  if (cols === 1) {
    expect(screen.getByText('2.80')).toBeInTheDocument();
    expect(screen.getByText('FL')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  } else {
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4);
    expect(screen.getByText('Recommended')).toBeInTheDocument();
  }
});

it('retains source data and refresh behavior across every pack selection and return to Classic', async () => {
  const view = render(widget('classic', 3));
  for (const [packId, appearance] of packCases) {
    view.rerender(widget(packId, 3));
    await waitFor(() => expect(view.container.querySelector(`[data-widget-appearance="${appearance}"]`)).not.toBeNull());
    expect(metric('Front-left pressure').getByText('2.80')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4);
  }
  view.rerender(widget('classic', 3));
  expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(screen.getByText('Recommended')).toBeInTheDocument();
  expect(refetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /refresh data/i }));
  expect(refetch).toHaveBeenCalledTimes(1);
});

describe.each(packCases)('tire pressure history %s / %s source states', (packId, appearance) => {
  it.each([1, 2])('keeps an honest empty source visible at %i columns', async cols => {
    historyMock.mockReturnValue(makeQuery([]));
    await mountPack(packId, appearance, cols);
    expect(screen.getByText('No tire pressure history')).toBeInTheDocument();
    expect(metric('Front-left pressure').getByText('—')).toBeInTheDocument();
    expect(screen.getAllByText('Not reported')).toHaveLength(4);
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('keeps last-reported corner timestamps honest when a newer row is missing that corner', async () => {
    historyMock.mockReturnValue(makeQuery([
      { ...samples[1], frontRight: null },
      { ...samples[0], frontLeft: null },
    ]));
    await mountPack(packId, appearance);
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    const earlier = within(rows[0]).getAllByRole('cell')[0].textContent;
    const newer = within(rows[1]).getAllByRole('cell')[0].textContent;
    expect(metric('Front-left pressure').getByText('2.79')).toBeInTheDocument();
    expect(metric('Front-left pressure').getByText(`Last reported ${earlier}`)).toBeInTheDocument();
    expect(metric('FR').getByText(`Last reported ${newer}`)).toBeInTheDocument();
  });

  it('retains history and its warning on a failed refresh, and disables an in-flight refresh', async () => {
    historyMock.mockReturnValue(makeQuery(samples, { isError: true, error: new Error('Refresh failed') }));
    const view = await mountPack(packId, appearance);
    expect(view.container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(metric('Front-left pressure').getByText('2.80')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4);

    historyMock.mockReturnValue(makeQuery(samples, { isFetching: true }));
    view.rerender(widget(packId));
    expect(screen.getByRole('button', { name: /refresh data/i })).toHaveAttribute('aria-disabled', 'true');
    expect(metric('Front-left pressure').getByText('2.80')).toBeInTheDocument();
  });

  it('preserves loading and fatal-error recovery without manufacturing source data', async () => {
    historyMock.mockReturnValue(makeQuery(undefined, { isLoading: true, isPending: true, isFetching: true }));
    const view = render(widget(packId));
    expect(view.container.querySelector('[data-data-state="initial"]')).toHaveAttribute('aria-busy', 'true');
    expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();

    historyMock.mockReturnValue(makeQuery(undefined, { isError: true, error: new Error('History failed') }));
    view.rerender(widget(packId));
    expect(view.container.querySelector('[data-data-state="initialFailure"]')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /refresh data/i }));
    expect(refetch).toHaveBeenCalledTimes(1);

    historyMock.mockReturnValue(makeQuery(samples));
    view.rerender(widget(packId));
    await waitFor(() => expect(view.container.querySelector(`[data-widget-appearance="${appearance}"]`)).not.toBeNull());
    expect(metric('Front-left pressure').getByText('2.80')).toBeInTheDocument();
  });

  it('uses the existing Pa-to-display converter for psi in the headline, every series and the compact summary', async () => {
    const current = settingsHook.useSettings();
    const settings = vi.spyOn(settingsHook, 'useSettings').mockReturnValue({
      ...current,
      settings: { ...current.settings, unit_of_pressure: 'psi' },
    });
    try {
      const view = await mountPack(packId, appearance);
      expect(metric('Front-left pressure').getByText('40.61')).toBeInTheDocument();
      expect(metric('Front-left pressure').getByText('psi')).toBeInTheDocument();
      expect(within(screen.getByRole('table')).getAllByRole('columnheader').map(cell => cell.textContent))
        .toEqual(['Time', 'FL (psi)', 'FR (psi)', 'RL (psi)', 'RR (psi)']);
      const lastRow = within(screen.getByRole('table')).getAllByRole('row')[3];
      const pressures = within(lastRow).getAllByRole('cell').slice(1).map(cell => Number(cell.textContent));
      expect(pressures[0]).toBeCloseTo(40.61, 2);
      expect(pressures[1]).toBeCloseTo(41.34, 2);
      expect(pressures[2]).toBeCloseTo(42.06, 2);
      expect(pressures[3]).toBeCloseTo(42.79, 2);
      view.rerender(widget(packId, 1));
      expect(metric('Front-left pressure').getByText('40.61')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    } finally {
      settings.mockRestore();
    }
  });
});
