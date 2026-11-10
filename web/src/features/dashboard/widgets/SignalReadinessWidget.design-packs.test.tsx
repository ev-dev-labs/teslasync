import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { AvailableSignalsResponse, FleetTelemetryCoverageResponse } from '@/api/types';
import type { VehicleLiveSignalsResponse } from '@/api/hooks/useTelemetry';
import { Text } from '@/components/ui';
import SignalReadinessWidget from './SignalReadinessWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetProps } from './types';

type QueryFixture<T> = DataStateSource<T> & { refetch: () => Promise<void> };
const mocks = vi.hoisted(() => ({
  catalog: vi.fn<(id: number) => QueryFixture<AvailableSignalsResponse>>(),
  routing: vi.fn<() => QueryFixture<FleetTelemetryCoverageResponse>>(),
  live: vi.fn<(id?: number, options?: { refetchInterval: number }) => QueryFixture<VehicleLiveSignalsResponse>>(),
  vehicles: vi.fn<() => QueryFixture<{ id: number }[]>>(),
  refreshCatalog: vi.fn<() => Promise<void>>(),
  refreshRouting: vi.fn<() => Promise<void>>(),
  refreshLive: vi.fn<() => Promise<void>>(),
  refreshVehicles: vi.fn<() => Promise<void>>(),
}));
vi.mock('@/api/hooks/useSignals', () => ({ useAvailableSignals: mocks.catalog }));
vi.mock('@/api/hooks/useFleetTelemetry', () => ({ useFleetTelemetryCoverage: mocks.routing }));
vi.mock('@/api/hooks/useTelemetry', () => ({ useVehicleLiveSignals: mocks.live }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: mocks.vehicles }));
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const { createInstance } = await vi.importActual<typeof import('i18next')>('i18next');
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } });
  return { ...actual, useTranslation: () => ({ t: i18n.getFixedT('en'), i18n }) };
});
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: Date) => value.toISOString(),
    formatTime: (value: Date) => value.toISOString(),
  }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

const NOW = Date.parse('2026-11-07T02:00:00Z');
const RECENT = new Date(NOW - 10_000).toISOString();
const OLD = new Date(NOW - 180_000).toISOString();
const PACKS = Object.entries(PACK_APPEARANCES);
const SECTIONS = [
  'Repository signal catalog', 'Server subscription and routing',
  'Selected vehicle snapshot', 'Vehicle configuration evidence',
];
const NOTE = 'Catalog definitions are not proof that a vehicle is configured or has reported a signal.';
const catalog: AvailableSignalsResponse = {
  vehicle_id: 7, count: 4, source: 'protomodel',
  signals: [
    { name: 'BatteryLevel', category: 'battery', value_kind: 'float', unit_kind: 'charge', is_compound: false, is_setting_unit: false },
    { name: 'BrakePedal', category: 'driving', value_kind: 'bool', unit_kind: 'none', is_compound: false, is_setting_unit: false },
    { name: 'DoorState', category: 'security', value_kind: 'unknown', unit_kind: 'none', is_compound: true, is_setting_unit: false },
    { name: 'RearDefrostEnabled', category: 'climate', value_kind: 'bool', unit_kind: 'none', is_compound: false, is_setting_unit: false },
  ],
};
const routing: FleetTelemetryCoverageResponse = {
  categories: [{
    category: 'test', total_fields: 5, destinations: { signal_log: 3, drop: 2 },
    fields: [
      { field: 'BatteryLevel', destination: 'signal_log', subscribed: true },
      { field: 'BrakePedal', destination: 'signal_log', subscribed: true },
      { field: 'DoorStateDriverFront', destination: 'security_event', subscribed: true },
      { field: 'RearDefrostEnabled', destination: 'drop', subscribed: false },
      { field: 'RearDisplayHvacEnabled', destination: 'drop', subscribed: false },
    ],
  }], destination_totals: { signal_log: 3, drop: 2 },
};

function snapshot(signals?: VehicleLiveSignalsResponse['signals']): VehicleLiveSignalsResponse {
  return {
    vehicle_id: 7, at: new Date(NOW).toISOString(),
    signals: signals ?? {
      BatteryLevel: { value: 0, kind: 'ValueKindFloat', ts: RECENT, source: 'l1', age_ms: 10_000 },
      BrakePedal: { value: false, kind: 'ValueKindBool', ts: RECENT, source: 'l2', age_ms: 10_000 },
      DoorStateDriverFront: { value: true, kind: 'ValueKindBool', ts: OLD, source: 'stale', age_ms: 180_000 },
      InvalidValue: { value: Number.NaN, kind: 'ValueKindFloat', ts: RECENT, source: 'l1' },
      UnknownSource: { value: 'reported', kind: 'ValueKindString', ts: RECENT, source: 'unknown' },
    },
  };
}
function query<T>(data: T | undefined, refetch: () => Promise<void>, overrides: Partial<QueryFixture<T>> = {}): QueryFixture<T> {
  return {
    data, refetch, error: null, isSuccess: true, isError: false, isLoading: false,
    isPending: false, isFetching: false, fetchStatus: 'idle', dataUpdatedAt: NOW,
    ...overrides,
  };
}
function LocationProbe() { return <Text data-testid="location">{useLocation().pathname}</Text>; }
function tree(pack?: unknown, props: Partial<WidgetProps> = {}) {
  return <MemoryRouter><PackBoundary requestedPackId={pack}>
    <SignalReadinessWidget size={{ cols: 2, rows: 4 }} {...props} />
  </PackBoundary><LocationProbe /></MemoryRouter>;
}
async function presentation(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector(`[data-widget-family="status"][data-widget-appearance="${appearance}"]`))
    .toHaveAttribute('data-instrument-appearance', appearance));
}
function metric(label: string) {
  const row = screen.getByText(label).closest('div');
  if (!row) throw new Error(`Missing readiness metric: ${label}`);
  const value = row.querySelector('dd');
  if (!value) throw new Error(`Missing readiness value: ${label}`);
  return value;
}
function expectUnknownConfiguration() {
  for (const label of ['Configured on vehicle', 'Applied to vehicle', 'Vehicle-supported signals']) {
    expect(metric(label)).toHaveTextContent(/^Unknown$/);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  for (const refresh of [mocks.refreshCatalog, mocks.refreshRouting, mocks.refreshLive, mocks.refreshVehicles]) {
    refresh.mockResolvedValue(undefined);
  }
  mocks.catalog.mockReturnValue(query(catalog, mocks.refreshCatalog));
  mocks.routing.mockReturnValue(query(routing, mocks.refreshRouting));
  mocks.live.mockReturnValue(query(snapshot(), mocks.refreshLive));
  mocks.vehicles.mockReturnValue(query([{ id: 7 }], mocks.refreshVehicles));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('SignalReadinessWidget production design packs', () => {
  it.each(PACKS)('%s composes all real source sections and actions in %s', async (pack, appearance) => {
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    for (const name of SECTIONS) expect(screen.getByRole('region', { name })).toBeInTheDocument();
    expect(view.container.querySelector('.widget-big-number')).toHaveTextContent('4');
    expect(metric('Desired by server')).toHaveTextContent(/^3$/);
    expect(metric('Dropped by routing')).toHaveTextContent(/^2$/);
    expect(metric('Observed in snapshot')).toHaveTextContent(/^4$/);
    expect(metric('Fresh observations')).toHaveTextContent(/^2$/);
    expect(metric('Stale observations')).toHaveTextContent(/^1$/);
    expect(metric('Unknown freshness or invalid evidence')).toHaveTextContent(/^2$/);
    expect(metric('Latest observed timestamp').querySelector('time')).toHaveAttribute('datetime', RECENT);
    expect(screen.getByText('RearDefrostEnabled')).toBeInTheDocument();
    expect(screen.getByText('RearDisplayHvacEnabled')).toBeInTheDocument();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expectUnknownConfiguration();
    const instrument = view.container.querySelector('[data-widget-family="status"]');
    expect(instrument?.querySelector('.lucide-radio')).not.toBeNull();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(mocks.catalog).toHaveBeenCalledOnce();
    expect(mocks.routing).toHaveBeenCalledOnce();
    expect(mocks.live).toHaveBeenCalledOnce();
    expect(mocks.live).toHaveBeenLastCalledWith(7, { refetchInterval: 5_000 });
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refreshCatalog).toHaveBeenCalledOnce();
    expect(mocks.refreshRouting).toHaveBeenCalledOnce();
    expect(mocks.refreshLive).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('link', { name: 'Inspect signals' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/signals');
  });

  it.each(PACKS)('%s keeps compact empty evidence unknown and retains every source shell in %s', async (pack, appearance) => {
    mocks.live.mockReturnValue(query(snapshot({}), mocks.refreshLive));
    mocks.catalog.mockReturnValue(query({ ...catalog, count: 0, signals: [] }, mocks.refreshCatalog));
    const view = render(tree(pack, { size: { cols: 1, rows: 1 } }));
    await presentation(view.container, appearance);
    for (const name of SECTIONS) expect(screen.getByRole('region', { name })).toBeInTheDocument();
    expect(view.container.querySelector('.widget-big-number')).toHaveTextContent('0');
    expect(screen.getByText('The catalog returned no definitions.')).toBeInTheDocument();
    expect(screen.getByText('This snapshot contains no reported signals; vehicle support remains unknown.')).toBeInTheDocument();
    for (const label of ['Observed in snapshot', 'Fresh observations', 'Stale observations', 'Latest observed timestamp']) {
      expect(metric(label)).toHaveTextContent(/^Unknown$/);
    }
    expectUnknownConfiguration();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refreshLive).toHaveBeenCalledOnce();
  });

  it('keeps Classic default/recovery and changes presentation without multiplying sources', async () => {
    const view = render(tree());
    expect(view.container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    expect(metric('Fresh observations')).toHaveTextContent(/^2$/);
    for (const [pack, appearance] of PACKS) {
      view.rerender(tree(pack));
      await presentation(view.container, appearance);
      expect(metric('Observed in snapshot')).toHaveTextContent(/^4$/);
      expectUnknownConfiguration();
    }
    view.rerender(tree('unrecognized-pack'));
    expect(view.container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
  });

  it.each(PACKS)('%s does not infer vehicle support, freshness or receipts from desired routes or invalid values in %s', async (pack, appearance) => {
    mocks.live.mockReturnValue(query(snapshot({
      Future: { kind: 'ValueKindFloat', value: 1, ts: new Date(NOW + 1000).toISOString(), source: 'l1' },
      Untimed: { kind: 'ValueKindBool', value: false, source: 'l1' },
      BatteryLevel: { kind: 'ValueKindFloat', value: 140, ts: RECENT, source: 'l1' },
      Coerced: { kind: 'ValueKindBool', value: 'false', ts: RECENT, source: 'l1' },
      Legacy: 42,
      Unclassified: { kind: 'ValueKindString', value: 'seen', ts: RECENT },
      LogFallback: { kind: 'ValueKindFloat', value: 0, ts: RECENT, source: 'log' },
      InvalidAge: { kind: 'ValueKindFloat', value: 5, ts: RECENT, source: 'l1', age_ms: -1 },
    }), mocks.refreshLive));
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expect(metric('Observed in snapshot')).toHaveTextContent(/^3$/);
    expect(metric('Fresh observations')).toHaveTextContent(/^Unknown$/);
    expect(metric('Stale observations')).toHaveTextContent(/^Unknown$/);
    expect(metric('Unknown freshness or invalid evidence')).toHaveTextContent(/^8$/);
    expectUnknownConfiguration();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Up to date/i })).not.toBeInTheDocument();
  });

  it.each(PACKS.flatMap(([pack, appearance]) => (['error', 'paused'] as const)
    .map(condition => [pack, appearance, condition] as const)))('%s retains observed evidence without calling it fresh in %s after refresh is %s', async (pack, appearance, condition) => {
    mocks.live.mockReturnValue(query(snapshot(), mocks.refreshLive, condition === 'error'
      ? { error: new Error('Refresh failed'), isError: true, isSuccess: false }
      : { fetchStatus: 'paused' }));
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expect(metric('Observed in snapshot')).toHaveTextContent(/^4$/);
    expect(metric('Fresh observations')).toHaveTextContent(/^Unknown$/);
    expect(metric('Stale observations')).toHaveTextContent(/^Unknown$/);
    expect(metric('Unknown freshness or invalid evidence')).toHaveTextContent(/^5$/);
    const source = screen.getByRole('region', { name: 'Selected vehicle snapshot' });
    expect(within(source).getByRole('status')).toHaveTextContent('Previously loaded data remains visible');
    fireEvent.click(within(source).getByRole('button', { name: 'Retry' }));
    expect(mocks.refreshLive).toHaveBeenCalledOnce();
    expect(view.container.querySelector('[data-motion-suppressed="true"]')).not.toBeNull();
    expect(metric('Desired by server')).toHaveTextContent(/^3$/);
  });

  it.each(PACKS)('%s isolates initial failure and loading while keeping the other source sections useful in %s', async (pack, appearance) => {
    mocks.catalog.mockReturnValue(query(undefined, mocks.refreshCatalog, {
      error: new Error('Catalog offline'), isError: true, isSuccess: false,
    }));
    mocks.live.mockReturnValue(query(undefined, mocks.refreshLive, {
      isPending: true, isLoading: true, isSuccess: false, fetchStatus: 'fetching',
    }));
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expect(screen.getByText('Signal catalog unavailable')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading Selected vehicle snapshot' })).toBeInTheDocument();
    expect(metric('Desired by server')).toHaveTextContent(/^3$/);
    expect(metric('Dropped by routing')).toHaveTextContent(/^2$/);
    expectUnknownConfiguration();
    fireEvent.click(within(screen.getByRole('region', { name: 'Repository signal catalog' }))
      .getByRole('button', { name: /Retry/i }));
    expect(mocks.refreshCatalog).toHaveBeenCalledOnce();
  });

  it.each(PACKS)('%s honors vehicle scope and rejects mismatched payloads in %s', async (pack, appearance) => {
    const view = render(tree(pack, { vehicleId: 9, config: { vehicleId: 8 } }));
    await presentation(view.container, appearance);
    expect(mocks.catalog).toHaveBeenLastCalledWith(9);
    expect(mocks.live).toHaveBeenLastCalledWith(9, { refetchInterval: 5_000 });
    expect(screen.getByText('No observed signal evidence is available for this vehicle.')).toBeInTheDocument();
    expect(screen.queryByText(RECENT)).not.toBeInTheDocument();
    expectUnknownConfiguration();
    view.rerender(tree(pack, { config: { vehicleId: 8 } }));
    expect(mocks.live).toHaveBeenLastCalledWith(8, { refetchInterval: 5_000 });
    view.rerender(tree(pack));
    expect(mocks.live).toHaveBeenLastCalledWith(7, { refetchInterval: 5_000 });
    expect(metric('Fresh observations')).toHaveTextContent(/^2$/);
    mocks.vehicles.mockReturnValue(query([], mocks.refreshVehicles));
    view.rerender(tree(pack));
    expect(mocks.live).toHaveBeenLastCalledWith(undefined, { refetchInterval: 5_000 });
    expect(screen.getByText('Select a vehicle to inspect signal readiness.')).toBeInTheDocument();
    expect(metric('Desired by server')).toHaveTextContent(/^3$/);
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refreshVehicles).toHaveBeenCalledOnce();
    expect(mocks.refreshLive).not.toHaveBeenCalled();
  });
});
