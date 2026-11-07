import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { SignalHistoryPoint } from '@/api/types';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import LiveSignalSparklinesWidget, { SIGNAL_COLORS } from './LiveSignalSparklinesWidget';
import type { WidgetSize } from './types';

const api = vi.hoisted(() => ({ request: vi.fn<(path: string) => Promise<unknown>>() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [] }) }));
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: api.request,
}));

const FULL: WidgetSize = { cols: 4, rows: 3 };
const NARROW: WidgetSize = { cols: 2, rows: 2 };
const SIGNALS = ['BatteryLevel', 'VehicleSpeed', 'OutsideTemp', 'PackCurrent'];
const clients: QueryClient[] = [];
let live: Record<string, { value: unknown; timestamp: string }>;
let history: Record<string, SignalHistoryPoint[]>;
let historyFailure: boolean;

function points(...values: SignalHistoryPoint['value'][]): SignalHistoryPoint[] {
  return values.map((value, index) => ({
    ts: `2026-11-06T18:0${index}:00Z`,
    kind: typeof value === 'number' ? 'ValueKindDouble' : 'ValueKindUnknown',
    value,
    ingest_origin: null,
    source_emitted_at: null,
    received_at: null,
    normalization_version: null,
  }));
}

function countRequests(suffix: string): number {
  return api.request.mock.calls.filter(([path]) => path.endsWith(suffix)).length;
}

function renderWidget(pack: string, size = FULL, signals = SIGNALS) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(queryClient);
  const tree = (requestedPackId: string) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <LiveSignalSparklinesWidget vehicleId={7} size={size} config={{ signals }} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(pack));
  return { ...view, queryClient, selectPack: (next: string) => view.rerender(tree(next)) };
}

function signalPresentation(label: string): HTMLElement {
  const element = screen.getByText(label).closest<HTMLElement>('[data-widget-family="line"]');
  if (!element) throw new Error(`Missing signal presentation: ${label}`);
  return element;
}

beforeEach(() => {
  historyFailure = false;
  live = {
    BatteryLevel: { value: 0, timestamp: new Date().toISOString() },
    VehicleSpeed: { value: 10, timestamp: new Date().toISOString() },
    OutsideTemp: { value: null, timestamp: new Date().toISOString() },
    PackCurrent: { value: -3.2, timestamp: new Date().toISOString() },
  };
  history = {
    BatteryLevel: points(70, 71, 72, 73),
    VehicleSpeed: points(20, 19, 18, 17),
    OutsideTemp: [],
    PackCurrent: points(-4, -3, -2, -1),
  };
  api.request.mockReset();
  api.request.mockImplementation(async path => {
    if (path === '/signals/7/available') return { signals: SIGNALS };
    if (path === '/signals/7/live') return { signals: live };
    const match = path.match(/^\/signals\/7\/([^/]+)\/history\?hours=1$/);
    if (match) {
      if (historyFailure && match[1] === 'BatteryLevel') throw new Error('History unavailable');
      return { data: history[decodeURIComponent(match[1])] ?? [] };
    }
    return {};
  });
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
});

describe.each(Object.entries(PACK_APPEARANCES))('live signal sparklines %s / %s', (pack, appearance) => {
  it('composes the real readings, plots, trends and refresh action without multiplying controllers', async () => {
    const size = pack === 'v2' || pack === 'v4' || pack === 'v6' ? NARROW : FULL;
    const view = renderWidget(pack, size);
    await waitFor(() => expect(
      view.container.querySelectorAll(`[data-widget-family="line"][data-widget-appearance="${appearance}"]`),
    ).toHaveLength(SIGNALS.length));
    const battery = signalPresentation('Battery Level');
    const speed = signalPresentation('Vehicle Speed');
    const outside = signalPresentation('Outside Temp');
    const current = signalPresentation('Pack Current');
    const plot = await within(battery).findByRole('img', { name: 'Battery Level trend' });
    expect(within(battery).getByText('0.0%')).toBeVisible();
    expect(within(speed).getByText('36.0 km/h')).toBeVisible();
    expect(within(current).getByText('-3.2 A')).toBeVisible();
    expect(within(outside).getByText('—')).toBeVisible();
    expect(within(outside).queryByText('0.0')).not.toBeInTheDocument();
    expect((await within(outside).findAllByText('no data')).length).toBeGreaterThan(0);
    expect(plot).toHaveAttribute('width', size.cols >= 3 ? '80' : '56');
    expect(plot.querySelector('polyline')).toHaveAttribute('stroke', SIGNAL_COLORS[0]);
    expect(within(speed).getByRole('img', { name: 'Trending down' })).toBeVisible();
    expect(within(battery).getByRole('img', { name: 'Trending up' })).toBeVisible();
    expect(battery.querySelector('.lucide-activity')).not.toBeNull();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(countRequests('/available')).toBe(1);
    expect(countRequests('/live')).toBe(1);
    expect(countRequests('/BatteryLevel/history?hours=1')).toBe(1);

    live = { ...live, BatteryLevel: { value: 1, timestamp: new Date().toISOString() } };
    await waitFor(() => expect(screen.getByRole('button', { name: /^Refresh data/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    await within(battery).findByText('1.0%');
    expect(countRequests('/live')).toBe(2);
    expect(countRequests('/available')).toBe(2);
    expect(countRequests('/BatteryLevel/history?hours=1')).toBe(1);

    view.selectPack('classic');
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    expect(screen.getByText('1.0%')).toBeVisible();
    const classicPlot = screen.getByRole('img', { name: 'Battery Level trend' });
    expect(classicPlot.querySelector('polyline')?.getAttribute('points')).toBe(plot.querySelector('polyline')?.getAttribute('points'));
    view.selectPack(pack);
    await waitFor(() => expect(signalPresentation('Battery Level')).toHaveAttribute('data-widget-appearance', appearance));
    expect(screen.getByText('1.0%')).toBeVisible();
    expect(countRequests('/live')).toBe(2);
    expect(countRequests('/BatteryLevel/history?hours=1')).toBe(1);
  });

  it('keeps the source shell and honest empty configuration rather than inventing a metric', async () => {
    const { container } = renderWidget(pack, NARROW, []);
    expect(await screen.findByText('No signals available')).toBeVisible();
    expect(screen.getByText('Live signal sparklines')).toBeVisible();
    expect(container.querySelector(`[data-widget-pack="${pack}"]`)).not.toBeNull();
    expect(screen.queryByText('Battery Level')).not.toBeInTheDocument();
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(countRequests('/BatteryLevel/history?hours=1')).toBe(0);
  });
});

it('keeps sparse sample positions, signed values and timestamps without joining across gaps', async () => {
  history.BatteryLevel = points(0, 1, null, 2, 3, null, -1, 4);
  const { queryClient } = renderWidget('v7', FULL, ['BatteryLevel']);
  await waitFor(() => expect(signalPresentation('Battery Level')).toHaveAttribute('data-widget-appearance', 'pixel'));
  const row = signalPresentation('Battery Level');
  const plot = await within(row).findByRole('img', { name: 'Battery Level trend' });
  const lines = [...plot.querySelectorAll('polyline[fill="none"]')];
  expect(lines).toHaveLength(3);
  const positions = lines.flatMap(line => (line.getAttribute('points') ?? '').split(' ')
    .map(point => Number(point.split(',')[0])));
  expect(positions).toHaveLength(6);
  expect(positions[2] - positions[1]).toBeCloseTo(2 * (positions[1] - positions[0]));
  expect(within(row).getByText('0.0%')).toBeVisible();
  expect(within(row).getAllByText('—')).toHaveLength(2);
  expect(within(row).getByText('2026-11-06T18:02:00Z')).toBeInTheDocument();
  expect(queryClient.getQueryData(['signal-history', 7, 'BatteryLevel', 1])).toEqual({ data: history.BatteryLevel });
});

it('retries only the failed history source while retaining the other signals and actual live reading', async () => {
  historyFailure = true;
  renderWidget('v4');
  await waitFor(() => expect(signalPresentation('Battery Level')).toHaveAttribute('data-widget-appearance', 'owner'));
  const battery = signalPresentation('Battery Level');
  const alert = await within(battery).findByRole('alert');
  expect(within(battery).getByText('0.0%')).toBeVisible();
  expect(within(battery).queryByRole('img', { name: 'Battery Level trend' })).not.toBeInTheDocument();
  expect(await within(signalPresentation('Vehicle Speed')).findByRole('img', { name: 'Vehicle Speed trend' })).toBeVisible();
  historyFailure = false;
  fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
  await within(battery).findByRole('img', { name: 'Battery Level trend' });
  expect(within(battery).queryByRole('alert')).not.toBeInTheDocument();
  expect(countRequests('/BatteryLevel/history?hours=1')).toBe(2);
  expect(countRequests('/VehicleSpeed/history?hours=1')).toBe(1);
  expect(countRequests('/live')).toBe(1);
  expect(countRequests('/available')).toBe(1);
});

it('retains the original plot and reports a nonblocking history refresh failure', async () => {
  const { queryClient } = renderWidget('v3', FULL, ['BatteryLevel']);
  await waitFor(() => expect(signalPresentation('Battery Level')).toHaveAttribute('data-widget-appearance', 'precision'));
  const battery = signalPresentation('Battery Level');
  const plot = await within(battery).findByRole('img', { name: 'Battery Level trend' });
  const coordinates = plot.querySelector('polyline')?.getAttribute('points');
  historyFailure = true;
  await act(async () => { await queryClient.refetchQueries({ queryKey: ['signal-history', 7, 'BatteryLevel', 1] }); });
  const warning = await within(battery).findByTestId('stale-refresh-warning');
  expect(warning).toHaveTextContent('Previously loaded data remains visible');
  expect(within(battery).getByText('0.0%')).toBeVisible();
  expect(within(battery).getByRole('img', { name: 'Battery Level trend' }).querySelector('polyline'))
    .toHaveAttribute('points', coordinates);
  expect(within(battery).queryByRole('alert')).not.toBeInTheDocument();
});

it('keeps a pending history source distinct from an empty result without hiding its live reading', async () => {
  let finish: ((value: unknown) => void) | undefined;
  const pending = new Promise<unknown>(resolve => { finish = resolve; });
  const respond = api.request.getMockImplementation();
  api.request.mockImplementation(path => path.endsWith('/BatteryLevel/history?hours=1')
    ? pending : respond ? respond(path) : Promise.resolve({}));
  renderWidget('v5', NARROW, ['BatteryLevel']);
  await waitFor(() => expect(signalPresentation('Battery Level')).toHaveAttribute('data-widget-appearance', 'iconic'));
  const battery = signalPresentation('Battery Level');
  expect(within(battery).getByRole('status', { name: 'Loading signal history' })).toBeVisible();
  expect(within(battery).getByText('0.0%')).toBeVisible();
  expect(within(battery).queryByRole('img', { name: 'Battery Level trend' })).not.toBeInTheDocument();
  await act(async () => { finish?.({ data: history.BatteryLevel }); });
  expect(await within(battery).findByRole('img', { name: 'Battery Level trend' })).toBeVisible();
  expect(within(battery).queryByRole('status', { name: 'Loading signal history' })).not.toBeInTheDocument();
});

it('recovers unknown pack selections through the unmodified Classic structure', async () => {
  const { container } = renderWidget('unknown-pack', NARROW, ['BatteryLevel']);
  expect(await screen.findByText('0.0%')).toBeVisible();
  const plot = await screen.findByRole('img', { name: 'Battery Level trend' });
  expect(plot).toHaveAttribute('width', '56');
  expect(container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
  expect(container.querySelector('[data-widget-family]')).toBeNull();
});
