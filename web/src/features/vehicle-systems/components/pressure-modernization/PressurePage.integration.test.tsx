import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import TirePressurePage, { type TirePressureReading } from '../../pages/TirePressurePage';

const H = vi.hoisted(() => ({
  unit: 'bar' as 'bar' | 'psi' | 'kPa',
  vehicle: 42 as number | null,
  latest: null as TirePressureReading | null,
  history: [] as TirePressureReading[],
  failLatest: false,
  failHistory: false,
  pendingLatest: false,
  calls: [] as string[],
  observed: [] as Element[],
  csv: vi.fn(),
}));

vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: (url: string) => {
    H.calls.push(url);
    if (url.startsWith('/tire-pressure/latest?')) {
      if (H.pendingLatest) return new Promise<never>(() => {});
      if (H.failLatest) return Promise.reject(new Error('latest refresh failed'));
      return Promise.resolve(H.latest);
    }
    if (url.startsWith('/tire-pressure?')) {
      if (H.failHistory) return Promise.reject(new Error('history refresh failed'));
      return Promise.resolve(H.history);
    }
    return Promise.resolve({});
  },
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: H.vehicle, vehicles: [], vehicle: null, setVehicleId: vi.fn() }),
}));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    start: '2026-06-01', end: '2026-06-30',
    startInstant: '2026-06-01T00:00:00Z', endInstantExclusive: '2026-07-01T00:00:00Z',
    timezone: 'UTC',
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km', speed: 'km/h', temperature: '°C', pressure: H.unit,
      energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US',
    },
    formatPressure: vi.fn(),
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
vi.mock('@/components/ai/AITirePressureTrendReasoning', () => ({
  AITirePressureTrendReasoning: ({ vehicleId }: { vehicleId?: number }) =>
    <div data-testid="pressure-ai-scope" data-vehicle={vehicleId} />,
}));
vi.mock('@/components/motion', async importOriginal => ({
  // Keep all actual named exports needed by transitive shared components.
  ...await importOriginal<typeof import('@/components/motion')>(),
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/csvExport', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/csvExport')>(),
  downloadCSV: (...args: unknown[]) => H.csv(...args),
}));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...actual, // Real ChartContainer, ThresholdBar, export menu and a11y table.
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    LineChart: ({ children, data }: { children: ReactNode; data: unknown }) =>
      <div data-testid="pressure-series" data-rows={JSON.stringify(data)}>{children}</div>,
    Line: ({ dataKey, hide }: { dataKey: string; hide?: boolean }) =>
      <span data-series={dataKey} data-hidden={String(hide)} />,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    ChartLegend: () => null,
  };
});

const originalFormatting = getFormatterPreferences();
const row = (overrides: Partial<TirePressureReading> = {}): TirePressureReading => ({
  id: 1, vehicle_id: 42, created_at: '2026-06-15T09:00:00Z',
  front_left: 280_000, front_right: 285_000, rear_left: 290_000, rear_right: 295_000,
  ...overrides,
});
function mount(entry = '/tire-pressure') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={client}><TirePressurePage /></QueryClientProvider>
    </MemoryRouter>
  );
  return { ...render(tree()), client, tree };
}
function stat(container: HTMLElement, metric: string) {
  const occurrence: Record<string, string> = {
    pressure: 'tire-pressure-average', count: 'tire-pressure-warning-count',
    text: 'tire-pressure-range-last-updated',
  };
  const tile = container.querySelector(`[data-operational-metric="${occurrence[metric]}"]`);
  if (!tile) throw new Error(`Missing metric ${metric}`);
  return within(tile as HTMLElement);
}
function historyTable() {
  const card = screen.getByRole('heading', { name: 'History table' }).closest('[data-card]');
  if (!card) throw new Error('History table shell absent');
  return within(card as HTMLElement);
}

beforeEach(() => {
  H.unit = 'bar';
  H.vehicle = 42;
  H.latest = row();
  H.history = [row({ id: 2, created_at: '2026-06-20T09:00:00Z' }), row()];
  H.failLatest = false;
  H.failHistory = false;
  H.pendingLatest = false;
  H.calls = [];
  H.observed = [];
  H.csv.mockClear();
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
  vi.stubGlobal('ResizeObserver', class {
    observe(target: Element) { H.observed.push(target); }
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => {
  setGlobalPrecision(originalFormatting.precision);
  setGlobalLocale(originalFormatting.locale);
  vi.unstubAllGlobals();
});

describe('pressure page live composition — authored, execution owned by parent', () => {
  it('refreshes empty current readings and history independently without creating pressure values', async () => {
    H.latest = null;
    H.history = [];
    mount();
    const currentMessage = await screen.findByText('No current readings available');
    const historyMessage = await historyTable().findByText('No history data');
    for (const [message, prefix, otherPrefix] of [
      [currentMessage, '/tire-pressure/latest?', '/tire-pressure?'],
      [historyMessage, '/tire-pressure?', '/tire-pressure/latest?'],
    ] as const) {
      const status = message.closest('[role="status"]');
      if (!(status instanceof HTMLElement)) throw new Error('Missing pressure empty state');
      const before = H.calls.filter(url => url.startsWith(prefix)).length;
      const otherBefore = H.calls.filter(url => url.startsWith(otherPrefix)).length;
      fireEvent.click(within(status).getByRole('button', { name: 'Refresh' }));
      await waitFor(() => expect(H.calls.filter(url => url.startsWith(prefix))).toHaveLength(before + 1));
      expect(H.calls.filter(url => url.startsWith(otherPrefix))).toHaveLength(otherBefore);
    }
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('has all four persistent surfaces, one allocated observer and an unduplicated heading outline', async () => {
    const { container } = mount();
    await screen.findAllByText('Front left (bar)');
    expect(screen.getByRole('heading', { name: 'Tire pressure', level: 1 })).toBeInTheDocument();
    for (const title of ['Tire pressure summary', 'Current readings', 'Pressure history', 'History table']) {
      expect(screen.getAllByRole('heading', { name: title })).toHaveLength(1);
    }
    expect(container.querySelectorAll('[data-card-grid]')).toHaveLength(1);
    expect(H.observed.filter(target => target.hasAttribute('data-card-grid'))).toHaveLength(1);
    expect(container.querySelectorAll('[data-card]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
    expect(container.querySelector('[data-operational-brief] [data-operational-value]')).toHaveTextContent('2.88 bar');
    expect(screen.getAllByRole('meter')).toHaveLength(4);
    expect(H.calls).toContain('/tire-pressure?vehicle_id=42&start=2026-06-01&end=2026-06-30');
    expect(screen.getByTestId('pressure-ai-scope')).toHaveAttribute('data-vehicle', '42');
  });

  it('renders null gaps and zero warning count only with real reported normal corners', async () => {
    H.latest = row({ front_left: null, front_right: 0, rear_left: undefined, rear_right: 300_000 });
    H.history = [H.latest];
    const { container } = mount();
    await waitFor(() => expect(stat(container, 'count').getByText('0')).toBeInTheDocument());
    expect(screen.getAllByRole('meter')).toHaveLength(1);
    expect(screen.queryByText('0.00 bar')).not.toBeInTheDocument();
    const chartRows = JSON.parse(screen.getByTestId('pressure-series').getAttribute('data-rows') ?? '[]') as Array<Record<string, unknown>>;
    expect(chartRows[0]).toMatchObject({ fl: null, fr: null, rl: null, rr: 3 });
    expect(historyTable().queryByText('OK')).not.toBeInTheDocument();
  });

  it('keeps the independent history timestamp and chart during initial latest loading', async () => {
    H.pendingLatest = true;
    const { container } = mount();
    await screen.findAllByText('Front left (bar)');
    expect(stat(container, 'text').queryByText('—')).not.toBeInTheDocument();
    expect(stat(container, 'count').getByText('—')).toBeInTheDocument();
    expect(screen.getByTestId('pressure-series')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('preserves chart, table and snapshot on a failed history refresh', async () => {
    const { container, client } = mount();
    await screen.findAllByText('Front left (bar)');
    H.failHistory = true;
    await act(async () => { await client.refetchQueries({ queryKey: ['tire-pressure-history', 42] }); });
    await waitFor(() => expect(historyTable().getByText(
      'Could not refresh Tire pressure history. Retained readings remain available.',
    )).toBeInTheDocument());
    expect(client.getQueryState(['tire-pressure-latest', 42])?.status).toBe('success');
    expect(client.getQueryState(['tire-pressure-latest', 42])?.error).toBeNull();
    expect(client.getQueryState(['tire-pressure-history', 42, '2026-06-01', '2026-06-30'])?.status).toBe('error');
    expect(screen.getByTestId('pressure-series')).toBeInTheDocument();
    expect(historyTable().getByText('Front left (bar)')).toBeInTheDocument();
    expect(screen.getAllByRole('meter')).toHaveLength(4);
    expect(stat(container, 'pressure').getByText('2.88 bar')).toBeInTheDocument();
    expect(container.querySelector('[data-operational-metric="tire-pressure-average"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('[data-source-retained]')).toHaveAttribute('data-source-retained', 'true');
    expect(screen.getAllByRole('button', { name: /^Retry$/ }).length).toBeGreaterThan(0);
  });

  it('keeps initial source retry reachable without hiding the successful chart', async () => {
    H.failLatest = true;
    mount();
    await screen.findByText("Can't reach server");
    expect(screen.getByTestId('pressure-series')).toBeInTheDocument();
    H.failLatest = false;
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/ }));
    await waitFor(() => expect(screen.getAllByRole('meter')).toHaveLength(4));
  });

  it('updates units and precision without refetching or rewriting source values', async () => {
    const view = mount();
    await screen.findAllByText('Front left (bar)');
    const requests = H.calls.filter(url => url.startsWith('/tire-pressure')).length;
    H.unit = 'psi';
    view.rerender(view.tree());
    await screen.findAllByText('Front left (psi)');
    expect(stat(view.container, 'pressure').getByText('41.70 psi')).toBeInTheDocument();
    act(() => setGlobalPrecision(3));
    expect(stat(view.container, 'pressure').getByText('41.698 psi')).toBeInTheDocument();
    expect(H.calls.filter(url => url.startsWith('/tire-pressure'))).toHaveLength(requests);
    expect(view.client.getQueryData(['tire-pressure-latest', 42])).toMatchObject({ front_left: 280_000, rear_right: 295_000 });
  });

  it('keeps all shells and missing KPIs when both sources authoritatively have no readings', async () => {
    H.latest = null;
    H.history = [];
    const { container } = mount();
    await screen.findByText('No current readings available');
    expect(screen.getAllByText('No history data').length).toBeGreaterThanOrEqual(2);
    expect(stat(container, 'count').getByText('—')).toBeInTheDocument();
    expect(stat(container, 'text').getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    for (const title of ['Tire pressure summary', 'Current readings', 'Pressure history', 'History table']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });

  it('keeps snapshot readings and summary when only history initially fails', async () => {
    H.failHistory = true;
    const { container } = mount();
    await waitFor(() => expect(screen.getAllByRole('meter')).toHaveLength(4));
    expect(stat(container, 'pressure').getByText('2.88 bar')).toBeInTheDocument();
    expect(stat(container, 'text').getByText('—')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Retry$/ }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('heading', { name: 'History table' })).toBeInTheDocument();
  });

  it('keeps URL-hidden series, sorting and chart export controls reachable', async () => {
    const { container } = mount('/tire-pressure?hidden_tire-pressure-history=fl');
    await screen.findAllByText('Front left (bar)');
    expect(container.querySelector('[data-series="fl"]')).toHaveAttribute('data-hidden', 'true');
    expect(container.querySelectorAll('[data-series]')).toHaveLength(4);
    const header = historyTable().getByRole('columnheader', { name: /Time/i });
    expect(header).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(within(header).getByRole('button'));
    expect(historyTable().getByRole('columnheader', { name: /Time/i })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
    expect(screen.getByRole('menuitem', { name: /CSV/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /CSV/i }));
    expect(H.csv).toHaveBeenCalledTimes(1);
    expect(String(H.csv.mock.calls[0][1])).toContain('2.8');
  });

  it('keeps warning actions and unclamped extreme source pressure visible', async () => {
    H.latest = row({ front_left: 500_000, tpms_hard_warnings: '{"fl":true}' });
    H.history = [H.latest];
    mount();
    expect(await screen.findByText('Hard TPMS warning active')).toBeInTheDocument();
    expect(screen.getByText('Reported pressure: 5.00 bar')).toBeInTheDocument();
    expect(historyTable().getByText('Hard warning')).toBeInTheDocument();
  });
});
