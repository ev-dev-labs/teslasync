import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import TirePressurePage, { type TirePressureReading } from '../../pages/TirePressurePage';
import summarySource from './PressureSummary.tsx?raw';
import historySource from './PressureHistoryCard.tsx?raw';

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
  observers: new Map<Element, ResizeObserverCallback>(),
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
  H.observers.clear();
  H.csv.mockClear();
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) { H.observed.push(target); H.observers.set(target, this.callback); }
    unobserve(target: Element) { H.observers.delete(target); }
    disconnect() { H.observers.forEach((callback, target) => {
      if (callback === this.callback) H.observers.delete(target);
    }); }
  });
});
afterEach(() => {
  onlineManager.setOnline(true);
  delete document.documentElement.dataset.theme;
  setGlobalPrecision(originalFormatting.precision);
  setGlobalLocale(originalFormatting.locale);
  vi.unstubAllGlobals();
});

describe('pressure page live composition — authored, execution owned by parent', () => {
  it.each([
    ['PressureSummary', summarySource],
    ['PressureHistoryCard', historySource],
  ])('%s consumes the existing placement hook through the public layout barrel', (_name, source) => {
    expect(source).toMatch(/import\s*\{\s*useCardPlacement\s*\}\s*from\s*['"]@\/components\/layout['"]/);
    expect(source).not.toMatch(/from\s*['"]@\/components\/layout\//);
  });

  it('keeps pending idle sources unresolved rather than claiming empty readings', async () => {
    H.pendingLatest = true;
    const { client } = mount();
    await historyTable().findByRole('columnheader', { name: /Front left/ });
    const query = client.getQueryCache().find({ queryKey: ['tire-pressure-latest', 42], exact: true });
    if (!query) throw new Error('Missing latest pressure query');
    act(() => query.setState({ fetchStatus: 'idle' }));
    const card = screen.getByRole('heading', { name: 'Current readings' }).closest('[data-card]');
    if (!(card instanceof HTMLElement)) throw new Error('Missing current pressure shell');
    await within(card).findByText('Loading Latest tire pressure');
    expect(within(card).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('No current readings available')).not.toBeInTheDocument();
    expect(screen.getByTestId('pressure-series')).toBeInTheDocument();
  });

  it('shows paused source feedback instead of empty claims and recovers independently', async () => {
    onlineManager.setOnline(false);
    const { client } = mount();
    await waitFor(() => expect(client.getQueryState(['tire-pressure-latest', 42])?.fetchStatus).toBe('paused'));
    expect(screen.getAllByText('Refresh paused').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('No current readings available')).not.toBeInTheDocument();
    expect(screen.queryByText('No history data')).not.toBeInTheDocument();
    expect(historyTable().getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(H.calls).toHaveLength(0);
    H.pendingLatest = true;
    act(() => onlineManager.setOnline(true));
    await historyTable().findByRole('columnheader', { name: /Front left/ });
    expect(screen.getByTestId('pressure-series')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByText('No current readings available')).not.toBeInTheDocument();
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    for (const title of ['Tire pressure summary', 'Current readings', 'Pressure history', 'History table']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });

  it('keeps retained current readings on refresh failure and clears the warning on retry recovery', async () => {
    const { client } = mount();
    await waitFor(() => expect(screen.getAllByRole('meter')).toHaveLength(4));
    H.failLatest = true;
    await act(async () => { await client.refetchQueries({ queryKey: ['tire-pressure-latest', 42] }); });
    await screen.findByText('Could not refresh Latest tire pressure. Retained readings remain available.');
    expect(screen.getAllByRole('meter')).toHaveLength(4);
    expect(screen.getByTestId('pressure-series')).toBeInTheDocument();
    const historyCalls = H.calls.filter(url => url.startsWith('/tire-pressure?')).length;
    H.failLatest = false;
    const card = screen.getByRole('heading', { name: 'Current readings' }).closest('[data-card]');
    if (!(card instanceof HTMLElement)) throw new Error('Missing current pressure shell');
    fireEvent.click(within(card).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText(
      'Could not refresh Latest tire pressure. Retained readings remain available.',
    )).not.toBeInTheDocument());
    expect(screen.getAllByRole('meter')).toHaveLength(4);
    expect(H.calls.filter(url => url.startsWith('/tire-pressure?'))).toHaveLength(historyCalls);
  });

  it.each(['light', 'dark'])('keeps all history fields in keyboard-accessible mobile details and desktop columns (%s)', async theme => {
    document.documentElement.dataset.theme = theme;
    H.history = [row({ id: 2, front_left: 230_000, tpms_hard_warnings: '{"fl":true}' }), row()];
    const { container } = mount();
    await historyTable().findByRole('columnheader', { name: /Front left/ });
    const resize = (width: number) => act(() => H.observers.forEach((callback, target) => callback(
      [{ target, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
    )));
    resize(375);
    const mobile = container.querySelector('[data-mobile-table]');
    if (!(mobile instanceof HTMLElement)) throw new Error('Mobile history absent');
    expect(within(mobile).getByRole('button', { name: /Front left.*filter/i })).toBeInTheDocument();
    expect(mobile.querySelectorAll('[data-row-key]')).toHaveLength(2);
    const first = mobile.querySelector('[data-row-key="2"]');
    if (!(first instanceof HTMLElement)) throw new Error('Stable history row identity absent');
    first.focus();
    fireEvent.keyDown(first, { key: 'Enter' });
    const detail = await screen.findByRole('dialog', { name: 'History table' });
    for (const field of ['Time', 'Front left (bar)', 'Front right (bar)', 'Rear left (bar)', 'Rear right (bar)', 'Warnings']) {
      expect(within(detail).getByText(field)).toBeInTheDocument();
    }
    expect(within(detail).getByText('2.30 bar · Low')).toBeInTheDocument();
    expect(within(detail).getByText('Hard warning')).toBeInTheDocument();
    fireEvent.keyDown(detail, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'History table' })).not.toBeInTheDocument());
    await waitFor(() => expect(first).toHaveFocus());
    resize(640);
    expect(container.querySelector('[data-mobile-table]')).not.toBeInTheDocument();
    for (const cell of [...historyTable().getAllByRole('columnheader'), ...historyTable().getAllByRole('cell')]) {
      expect(cell).not.toHaveClass('hidden');
    }
    resize(1280);
    expect(container.querySelector('[data-mobile-table]')).not.toBeInTheDocument();
    expect(historyTable().getAllByRole('columnheader')).toHaveLength(6);
    expect(historyTable().getAllByRole('row').slice(1).every(item => within(item).getAllByRole('cell').length === 6)).toBe(true);
    delete document.documentElement.dataset.theme;
  });

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
    expect(H.calls).toContain('/tire-pressure?vehicle_id=42&start=2026-06-01T00%3A00%3A00Z&end=2026-07-01T00%3A00%3A00Z');
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
    const summary = screen.getByRole('region', { name: 'Tire pressure summary' });
    expect(summary.querySelectorAll('[aria-busy="true"]')).toHaveLength(3);
    expect(summary.querySelectorAll('[data-operational-value]')).toHaveLength(1);
    expect(stat(container, 'count').queryByText('0', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByTestId('pressure-series')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('preserves chart, table and snapshot on a failed history refresh', async () => {
    const { container, client } = mount();
    await screen.findAllByText('Front left (bar)');
    H.failHistory = true;
    await act(async () => { await client.refetchQueries({ queryKey: [
      'tire-pressure-history', 42, '2026-06-01T00:00:00Z', '2026-07-01T00:00:00Z',
    ] }); });
    await waitFor(() => expect(historyTable().getByText(
      'Could not refresh Tire pressure history. Retained readings remain available.',
    )).toBeInTheDocument());
    expect(client.getQueryState(['tire-pressure-latest', 42])?.status).toBe('success');
    expect(client.getQueryState(['tire-pressure-latest', 42])?.error).toBeNull();
    expect(client.getQueryState(['tire-pressure-history', 42, '2026-06-01T00:00:00Z', '2026-07-01T00:00:00Z'])?.status).toBe('error');
    expect(screen.getByTestId('pressure-series')).toBeInTheDocument();
    expect(historyTable().getByText('Front left (bar)')).toBeInTheDocument();
    expect(screen.getAllByRole('meter')).toHaveLength(4);
    expect(stat(container, 'pressure').getByText('2.88 bar')).toBeInTheDocument();
    expect(container.querySelector('[data-operational-metric="tire-pressure-average"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('[data-source-retained]')).toHaveAttribute('data-source-retained', 'true');
    expect(screen.getAllByRole('button', { name: /^Retry$/ }).length).toBeGreaterThan(0);
    H.failHistory = false;
    fireEvent.click(historyTable().getByRole('button', { name: /^Retry$/ }));
    await waitFor(() => expect(historyTable().queryByText(
      'Could not refresh Tire pressure history. Retained readings remain available.',
    )).not.toBeInTheDocument());
    expect(screen.getByTestId('pressure-series')).toBeInTheDocument();
    expect(screen.getAllByRole('meter')).toHaveLength(4);
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

  it('keeps all shells and explains unavailable KPIs when both sources authoritatively have no readings', async () => {
    H.latest = null;
    H.history = [];
    mount();
    await screen.findByText('No current readings available');
    expect(screen.getAllByText('No history data').length).toBeGreaterThanOrEqual(2);
    const summary = screen.getByRole('region', { name: 'Tire pressure summary' });
    expect(within(summary).getByText('No metric values are available yet.')).toBeVisible();
    expect(within(summary).getByText('Warning count')).toBeVisible();
    expect(within(summary).getByText('Last updated')).toBeVisible();
    expect(summary.querySelector('[data-operational-value]')).not.toBeInTheDocument();
    expect(within(summary).queryByText('0', { exact: true })).not.toBeInTheDocument();
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
    const summary = screen.getByRole('region', { name: 'Tire pressure summary' });
    expect(summary.querySelector('[data-operational-metric="tire-pressure-range-last-updated"]')).not.toBeInTheDocument();
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    const details = screen.getByRole('dialog');
    expect(within(details).getByText('1 empty field is hidden.')).toBeVisible();
    expect(within(details).queryByText('Last updated')).not.toBeInTheDocument();
    fireEvent.keyDown(details, { key: 'Escape' });
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
