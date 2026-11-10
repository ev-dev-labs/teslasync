import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { VehicleLiveSignal } from '@/api/hooks/useTelemetry';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetProps, WidgetSize } from './types';
import ArrivalEnergyWidget from './ArrivalEnergyWidget';

const api = vi.hoisted(() => ({ request: vi.fn<(path: string) => Promise<unknown>>() }));
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: api.request,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? `{{${name}}}`));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
// Keep WidgetMapView and both presentations real; only the Leaflet boundary is replaced.
vi.mock('@/components/maps', () => ({
  MapContainer: ({ children, center, dragging }: { children?: ReactNode; center: [number, number]; dragging?: boolean }) =>
    <div data-testid="destination-tiles" data-center={JSON.stringify(center)} data-interactive={String(dragging)}>{children}</div>,
  CircleMarker: ({ children, center }: { children?: ReactNode; center: [number, number] }) =>
    <div data-testid="destination-pin" data-center={JSON.stringify(center)}>{children}</div>,
  Popup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  MapTileLayer: () => null,
  MapInvalidator: () => null,
}));

const FULL: WidgetSize = { cols: 3, rows: 3 };
const COMPACT: WidgetSize = { cols: 1, rows: 2 };
const clients: QueryClient[] = [];
let signals: Record<string, VehicleLiveSignal>;
let vehicles: { id: number }[];
let failure: boolean;

function reported(value: unknown, timestamp = new Date().toISOString()): VehicleLiveSignal {
  return { value, kind: typeof value === 'string' ? 'ValueKindString' : 'ValueKindFloat', ts: timestamp, source: 'l1', age_ms: 0 };
}
function calls(path: string) {
  return api.request.mock.calls.filter(([requested]) => requested === path).length;
}
function section(container: HTMLElement, name: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-arrival-section="${name}"]`);
  if (!element) throw new Error(`Missing arrival section: ${name}`);
  return element;
}
function mount(pack: string, size = FULL, props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const tree = (requestedPackId: string) => <QueryClientProvider client={client}>
    <MemoryRouter><PackBoundary requestedPackId={requestedPackId}>
      <ArrivalEnergyWidget vehicleId={7} size={size} {...props} />
    </PackBoundary></MemoryRouter>
  </QueryClientProvider>;
  const result = render(tree(pack));
  return { ...result, client, selectPack: (next: string) => result.rerender(tree(next)) };
}

beforeEach(() => {
  const timestamp = new Date().toISOString();
  signals = {
    ExpectedEnergyPercentAtTripArrival: reported(65, timestamp),
    DestinationName: reported('Library', timestamp),
    DestinationLocationLatitude: reported(51.48, timestamp),
    DestinationLocationLongitude: reported(0, timestamp),
    MilesToArrival: reported(12_000, timestamp),
    MinutesToArrival: reported(12, timestamp),
    RouteTrafficMinutesDelay: reported(2, timestamp),
    RouteLastUpdated: reported(timestamp, timestamp),
  };
  vehicles = [{ id: 9 }];
  failure = false;
  api.request.mockReset();
  api.request.mockImplementation(async path => {
    if (path === '/vehicles') return vehicles;
    if (/^\/signals\/\d+\/live$/.test(path)) {
      if (failure) throw new Error('Arrival signal source unavailable');
      return { vehicle_id: Number(path.split('/')[2]), signals, count: Object.keys(signals).length, at: new Date().toISOString() };
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
});

describe.each(Object.entries(PACK_APPEARANCES))('arrival energy %s / %s', (pack, appearance) => {
  async function expectArrivalCharge(container: HTMLElement, value: string) {
    await waitFor(() => {
      expect(container.querySelector('[data-widget-family="map"]'))
        .toHaveAttribute('data-widget-appearance', appearance);
      expect(section(container, 'arrival-charge')
        .querySelector('.widget-big-number > div > span')?.textContent).toBe(value);
    });
  }

  it('keeps the real route, SI distance, every section and refresh through Classic transitions', async () => {
    const compact = ['v2', 'v4', 'v6'].includes(pack);
    const view = mount(pack, compact ? COMPACT : FULL);
    await waitFor(() => expect(view.container.querySelector('[data-widget-family="map"]'))
      .toHaveAttribute('data-widget-appearance', appearance));
    await expectArrivalCharge(view.container, '65.00');
    expect(screen.getByText('Destination: Library')).toBeVisible();
    expect(screen.getByText('12.00 min')).toBeVisible();
    expect(screen.getByText(/12\.00\s*km/)).toBeVisible();
    expect(screen.getByText('2.00 min')).toBeVisible();
    expect(screen.getByText(/^Route last updated:/)).not.toHaveTextContent('Unknown');
    expect(screen.getByRole('region', { name: 'Navigation destination map' })).toBeVisible();
    expect(screen.getByTestId('destination-pin')).toHaveAttribute('data-center', '[51.48,0]');
    expect(screen.getByTestId('destination-tiles')).toHaveAttribute('data-interactive', String(!compact));
    expect(view.container.querySelector('[data-widget-family="map"] .lucide-map-pin')).not.toBeNull();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(calls('/signals/7/live')).toBe(1);
    expect(calls('/vehicles')).toBe(1);

    signals = { ...signals, ExpectedEnergyPercentAtTripArrival: reported(64) };
    const refresh = screen.getByRole('button', { name: 'Refresh arrival estimates' });
    await waitFor(() => expect(refresh).toBeEnabled());
    fireEvent.click(refresh);
    await expectArrivalCharge(view.container, '64.00');
    expect(calls('/signals/7/live')).toBe(2);
    view.selectPack('classic');
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    expect(within(section(view.container, 'arrival-charge')).getByText('64.00')).toBeVisible();
    expect(screen.getByTestId('destination-pin')).toHaveAttribute('data-center', '[51.48,0]');
    expect(screen.getByText('Traffic delay')).toBeVisible();
    view.selectPack(pack);
    await waitFor(() => expect(view.container.querySelector('[data-widget-family="map"]'))
      .toHaveAttribute('data-widget-appearance', appearance));
    expect(within(section(view.container, 'arrival-charge')).getByText('64.00')).toBeVisible();
    expect(calls('/signals/7/live')).toBe(2);
    expect(calls('/vehicles')).toBe(1);
  });

  it('keeps all source sections for an empty response without zero readings or invented route geometry', async () => {
    signals = {};
    const { container } = mount(pack, COMPACT);
    await waitFor(() => expect(container.querySelector('[data-widget-family="map"]'))
      .toHaveAttribute('data-widget-appearance', appearance));
    await waitFor(() => expect(screen.getByText('Destination coordinates are unknown.')).toBeVisible());
    await expectArrivalCharge(container, 'Unknown');
    for (const label of ['ETA', 'Remaining', 'Traffic delay']) expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByText('Current route evidence is unavailable; the arrival forecast is unknown.')).toBeVisible();
    expect(screen.getByText('Destination pin only; route geometry is unavailable.')).toBeVisible();
    expect(screen.getByText('Missing signals do not establish vehicle support or an applied telemetry configuration.')).toBeVisible();
    expect(screen.queryByTestId('destination-pin')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(calls('/signals/7/live')).toBe(1);
  });
  it('preserves actual zero charge, zero ETA and zero traffic while rejecting invalid distance and coordinates', async () => {
    signals.ExpectedEnergyPercentAtTripArrival = reported(0);
    signals.MinutesToArrival = reported(0);
    signals.RouteTrafficMinutesDelay = reported(0);
    signals.MilesToArrival = reported(-1);
    signals.DestinationLocationLongitude = reported(null);
    const { container } = mount(pack);
    await expectArrivalCharge(container, '0.00');
    expect(screen.getAllByText('0.00 min')).toHaveLength(2);
    expect(screen.getByText('Destination coordinates are unknown.')).toBeVisible();
    expect(screen.queryByText(/-\s*1.*km/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('destination-pin')).not.toBeInTheDocument();
  });

  it.each([
    ['stale reading', { source: 'stale', age_ms: 130_000 }],
    ['untracked source', { source: 'unknown' }],
    ['missing observation', { ts: '' }],
    ['future observation', { ts: new Date(Date.now() + 86_400_000).toISOString() }],
  ] satisfies Array<[string, Partial<VehicleLiveSignal>]>)('does not present a current forecast for %s', async (_, patch) => {
    signals.ExpectedEnergyPercentAtTripArrival = { ...signals.ExpectedEnergyPercentAtTripArrival, ...patch };
    const { container } = mount(pack);
    await expectArrivalCharge(container, 'Unknown');
    expect(screen.getByText('A current arrival charge estimate is unavailable.')).toBeVisible();
    expect(screen.getByText('Last reported arrival charge: 65.00%')).toBeVisible();
    expect(screen.getByText(/12\.00\s*km/)).toBeVisible();
  });

  it('requires route evidence even when a fresh arrival percentage exists', async () => {
    delete signals.DestinationName;
    delete signals.DestinationLocationLatitude;
    delete signals.DestinationLocationLongitude;
    const { container } = mount(pack);
    await expectArrivalCharge(container, 'Unknown');
    expect(screen.getByText('Current route evidence is unavailable; the arrival forecast is unknown.')).toBeVisible();
    expect(screen.getByText('Last reported arrival charge: 65.00%')).toBeVisible();
  });

  it('retains route details and map on refresh failure, without calling the retained estimate current', async () => {
    const view = mount(pack);
    await expectArrivalCharge(view.container, '65.00');
    failure = true;
    await act(async () => { await view.client.refetchQueries({ queryKey: ['live-signals', 7] }); });
    expect(await screen.findByTestId('stale-refresh-warning')).toHaveTextContent('Previously loaded data remains visible');
    await expectArrivalCharge(view.container, 'Unknown');
    expect(screen.getByText('Last reported arrival charge: 65.00%')).toBeVisible();
    expect(screen.getByTestId('destination-pin')).toBeVisible();
    expect(screen.getByText(/12\.00\s*km/)).toBeVisible();
    failure = false;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh arrival estimates' }));
    await expectArrivalCharge(view.container, '65.00');
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument());
  });

  it('keeps forecast, map and all metric shells visible on initial failure and recovers through the source retry', async () => {
    failure = true;
    const { container } = mount(pack);
    await waitFor(() => expect(container.querySelector('[data-widget-family="map"]')).toHaveAttribute('data-widget-appearance', appearance));
    await screen.findByRole('alert');
    for (const name of ['arrival-charge', 'destination-map', 'route-details']) expect(section(container, name)).toBeVisible();
    expect(screen.getByText('ETA')).toBeVisible();
    const attempts = calls('/signals/7/live');
    failure = false;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    expect(calls('/signals/7/live')).toBe(attempts + 1);
    await expectArrivalCharge(container, '65.00');
  });

  it('keeps named sections mounted and disables refresh during the initial request', async () => {
    let resolve: ((response: unknown) => void) | undefined;
    api.request.mockImplementation(path => path === '/vehicles'
      ? Promise.resolve(vehicles)
      : new Promise(response => { resolve = response; }));
    const view = mount(pack);
    await waitFor(() => expect(view.container.querySelector('[data-widget-family="map"]')).toHaveAttribute('data-widget-appearance', appearance));
    expect(screen.getByText('Expected charge on arrival')).toBeVisible();
    for (const name of ['arrival-charge', 'destination-map', 'route-details']) expect(section(view.container, name)).toBeVisible();
    for (const label of ['ETA', 'Remaining', 'Traffic delay']) expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Refresh arrival estimates' })).toBeDisabled();
    expect(screen.queryByTestId('destination-pin')).not.toBeInTheDocument();
    await act(async () => { resolve?.({ vehicle_id: 7, signals }); });
    await expectArrivalCharge(view.container, '65.00');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 101, '65'])('rejects invalid arrival percentage %s instead of fabricating a scale', async value => {
    signals.ExpectedEnergyPercentAtTripArrival = { ...reported(value), kind: 'ValueKindFloat' };
    const { container } = mount(pack);
    await expectArrivalCharge(container, 'Unknown');
    expect(screen.getByText('A current arrival charge estimate is unavailable.')).toBeVisible();
    expect(screen.getByText('Last reported arrival charge: Unknown')).toBeVisible();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getByTestId('destination-pin')).toBeVisible();
  });

  it('uses the selected vehicle over configuration, then configuration over fleet discovery', async () => {
    const selected = mount(pack, FULL, { vehicleId: 7, config: { vehicleId: 8 } });
    await expectArrivalCharge(selected.container, '65.00');
    expect(calls('/signals/7/live')).toBe(1);
    expect(calls('/signals/8/live')).toBe(0);
    selected.unmount();
    const configured = mount(pack, FULL, { vehicleId: undefined, config: { vehicleId: 8 } });
    await expectArrivalCharge(configured.container, '65.00');
    expect(calls('/signals/8/live')).toBe(1);
  });

  it('does not request signals for a missing or invalid vehicle, and still exposes every section', async () => {
    vehicles = [];
    const view = mount(pack, COMPACT, { vehicleId: undefined });
    await expectArrivalCharge(view.container, 'Unknown');
    expect(screen.getByText('Select a vehicle to view arrival estimates.')).toBeVisible();
    expect(api.request.mock.calls.some(([path]) => path.startsWith('/signals/'))).toBe(false);
    view.unmount();
    const invalid = mount(pack, FULL, { vehicleId: -1 });
    await expectArrivalCharge(invalid.container, 'Unknown');
    expect(screen.getByRole('button', { name: 'Refresh arrival estimates' })).toBeDisabled();
    expect(api.request.mock.calls.some(([path]) => path.startsWith('/signals/'))).toBe(false);
  });
});
