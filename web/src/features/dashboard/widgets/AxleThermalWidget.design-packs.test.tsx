import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { AppSettings } from '@/api/types';
import { telemetryKeys, type VehicleLiveSignal, type VehicleLiveSignalsResponse } from '@/api/hooks/useTelemetry';
import type { Vehicle } from '@/types/vehicle';
import { Text } from '@/components/ui';
import AxleThermalWidget from './AxleThermalWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import type { WidgetProps } from './types';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn<(path: string) => Promise<unknown>>(),
}));
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: requestMock,
}));
vi.mock('@/hooks/useSettings', async importOriginal =>
  await importOriginal<typeof import('@/hooks/useSettings')>());
vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/setup');
  return createReactI18nextMock();
});
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));
vi.mock('@/hooks/useDateFormat', () => {
  const iso = (value: string | number | Date) => (value instanceof Date ? value : new Date(value)).toISOString();
  return { useDateFormat: () => ({ formatDateTime: iso, formatTime: iso }) };
});

const NOW = Date.parse('2026-11-07T02:00:00Z');
const RECENT = new Date(NOW - 5_000).toISOString();
const OLD = new Date(NOW - 180_000).toISOString();
const PACKS = [
  ['v1', 'studio'], ['v2', 'elevated'], ['v3', 'precision'], ['v4', 'owner'],
  ['v5', 'iconic'], ['v6', 'expressive'], ['v7', 'pixel'],
] as const;
const SECTIONS = [
  'Live axle evidence', 'Powertrain axle matrix', 'Front axle', 'Rear axle', 'Configuration & evidence limits',
];
const HISTORY_NOTE = 'These axle signals have no established signal-log history. This view shows live-source observations only.';
const BASE_FIELDS = [
  'DiStatorTempF', 'DiStatorTempR', 'DiInverterTF', 'DiInverterTR',
  'DiTorqueActualF', 'DiTorqueActualR', 'DiStateF', 'DiStateR',
];
const vehicles: Vehicle[] = [7, 9].map(id => ({
  id, vehicle_id: id, vin: `TEST-AXLE-${id}`, display_name: `Vehicle ${id}`,
  model: id === 7 ? 'Model 3' : 'Model Y', trim_badging: '', exterior_color: 'PearlWhite',
  wheel_type: '', state: 'online', healthy: true, created_at: RECENT, updated_at: RECENT,
}));
const settings: Partial<AppSettings> = {
  unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar',
  decimal_precision: 1, locale: 'en-US', preferred_range: 'rated',
};
let client: QueryClient;
let live: VehicleLiveSignalsResponse;
let vehicleResponse: Vehicle[];
let failLive: boolean;
let failVehicles: boolean;
let pendingLive: Promise<VehicleLiveSignalsResponse> | null;

function entry(value: unknown, kind = 'ValueKindFloat', extra: Partial<VehicleLiveSignal> = {}): VehicleLiveSignal {
  return { value, kind, ts: RECENT, source: 'l1', age_ms: 5_000, ...extra };
}
function snapshot(signals?: Record<string, unknown>, id = 7): VehicleLiveSignalsResponse {
  return { vehicle_id: id, at: new Date(NOW).toISOString(), signals: signals ?? {
    'DiStatorTempF': entry(60), DiStatorTempR: entry(65),
    DiInverterTF: entry(40), DiInverterTR: entry(45),
    DiTorqueActualF: entry(-32), DiTorqueActualR: entry(0),
    DiStateF: entry('Standby', 'ValueKindEnum'), DiStateR: entry('DriveInverterStateEnable', 'ValueKindEnum'),
    DiStatorTempREL: entry(55),
  } };
}
function LocationProbe() { return <Text data-testid="location">{useLocation().pathname}</Text>; }
function tree(pack?: unknown, props: Partial<WidgetProps> = {}) {
  return <QueryClientProvider client={client}><MemoryRouter><PackBoundary requestedPackId={pack}>
    <AxleThermalWidget vehicleId={7} size={{ cols: 3, rows: 4 }} {...props} />
  </PackBoundary><LocationProbe /></MemoryRouter></QueryClientProvider>;
}
async function settled() { await waitFor(() => expect(client.isFetching()).toBe(0)); }
async function presentation(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector('[data-widget-family="axle-map"]'))
    .toHaveAttribute('data-widget-appearance', appearance));
  await settled();
}
function row(field: string) {
  const element = screen.getByText(field).closest<HTMLElement>('[role="group"]');
  if (!element) throw new Error(`Missing axle reading: ${field}`);
  return within(element);
}
function expectSections() {
  for (const name of SECTIONS) expect(screen.getByRole('region', { name })).toBeInTheDocument();
  const limits = within(screen.getByRole('region', { name: 'Configuration & evidence limits' }));
  for (const label of ['Desired subscription', 'Applied to vehicle', 'Vehicle support']) {
    expect(limits.getByText(label)).toBeInTheDocument();
  }
  expect(limits.getAllByText('Unknown')).toHaveLength(3);
  expect(limits.getByText(HISTORY_NOTE)).toBeInTheDocument();
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
}
function requestCount(path: string) { return requestMock.mock.calls.filter(([url]) => url === path).length; }
function refresh() { fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ })); }
function image(container: HTMLElement) {
  const element = container.querySelector('[data-vehicle-twin] img');
  if (!element) throw new Error('Missing authentic selected vehicle image');
  return element;
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  requestMock.mockReset();
  live = snapshot();
  vehicleResponse = vehicles;
  failLive = false;
  failVehicles = false;
  pendingLive = null;
  client = new QueryClient({ defaultOptions: { queries: {
    retry: false, gcTime: Infinity, refetchOnWindowFocus: false,
  } } });
  requestMock.mockImplementation(async path => {
    if (path === '/settings') return settings;
    if (path === '/vehicles') {
      if (failVehicles) throw new Error('Vehicle source unavailable');
      return vehicleResponse;
    }
    if (path === '/signals/7/live' || path === '/signals/9/live') {
      if (failLive) throw new Error('Axle source unavailable');
      return pendingLive ?? live;
    }
    throw new Error(`Unexpected axle widget request: ${path}`);
  });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });

describe('AxleThermalWidget production design packs', () => {
  it.each(PACKS)('%s preserves real axle readings, vehicle, source evidence and actions in %s', async (pack, appearance) => {
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expectSections();
    expect(view.container.querySelector('[data-axle-layout]')).toHaveAttribute('data-axle-layout', 'full');
    expect(view.container.querySelector('.widget-big-number')).toHaveTextContent(/65(?:\.0+)?°C/);
    expect(row('DiStatorTempF').getByText(/^60(?:\.0+)?°C$/)).toBeInTheDocument();
    expect(row('DiInverterTR').getByText(/^45(?:\.0+)?°C$/)).toBeInTheDocument();
    expect(row('DiTorqueActualF').getByText(/^-32(?:\.0+)? Nm$/)).toBeInTheDocument();
    expect(row('DiTorqueActualR').getByText(/^0(?:\.0+)? Nm$/)).toBeInTheDocument();
    expect(row('DiStateF').getByText('Standby')).toBeInTheDocument();
    expect(row('DiStateR').getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Rear-left motor' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Rear-right motor' })).not.toBeInTheDocument();
    for (const field of [...BASE_FIELDS, 'DiStatorTempREL']) {
      expect(row(field).getByText('Fresh observation')).toBeInTheDocument();
      expect(row(field).getByText('Source: l1')).toBeInTheDocument();
      expect(row(field).getByText(RECENT)).toHaveAttribute('datetime', RECENT);
    }
    expect(image(view.container)).toHaveAttribute('src', expect.stringContaining('model='));
    expect(view.container.querySelector('[data-vehicle-studio]')).toHaveAttribute('data-activity', 'static');
    expect(view.container.querySelector('[data-instrument-family="axle-map"] .lucide-gauge')).toBeInTheDocument();
    expect(requestCount('/signals/7/live')).toBe(1);
    refresh();
    await waitFor(() => expect(requestCount('/signals/7/live')).toBe(2));
    await settled();
    expect(requestCount('/vehicles')).toBe(2);
    expect(requestMock.mock.calls.some(([path]) => path.includes('history') || path.includes('motor'))).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: 'Inspect signals' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/signals');
  });

  it.each(PACKS)('%s keeps compact empty sections honest in %s', async (pack, appearance) => {
    live = snapshot({});
    const view = render(tree(pack, { size: { cols: 1, rows: 1 } }));
    await presentation(view.container, appearance);
    expectSections();
    expect(view.container.querySelector('[data-axle-layout]')).toHaveAttribute('data-axle-layout', 'compact');
    expect(screen.getByText('No valid timestamped axle signals have been reported for this vehicle.')).toBeInTheDocument();
    expect(screen.getAllByText('No valid reading')).toHaveLength(8);
    expect(screen.getAllByText('Observation time unknown')).toHaveLength(8);
    expect(screen.queryByText('Fresh observation')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Rear-left motor' })).not.toBeInTheDocument();
    expect(row('DiTorqueActualR').getByText('Unknown')).toBeInTheDocument();
    refresh();
    await waitFor(() => expect(requestCount('/signals/7/live')).toBe(2));
    await settled();
  });

  it('switches Classic, all seven compact/full appearances and unknown-ID recovery without multiplying readers', async () => {
    const view = render(tree());
    await screen.findAllByText('Fresh observation');
    await settled();
    const originalImage = image(view.container).getAttribute('src');
    expectSections();
    expect(view.container.querySelector('[data-widget-pack="classic"]')).toBeInTheDocument();
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    for (const [pack, appearance] of PACKS) {
      for (const cols of [1, 3]) {
        view.rerender(tree(pack, { size: { cols, rows: 4 } }));
        await presentation(view.container, appearance);
        expectSections();
        expect(row('DiTorqueActualF').getByText(/^-32(?:\.0+)? Nm$/)).toBeInTheDocument();
        expect(image(view.container)).toHaveAttribute('src', originalImage);
      }
    }
    view.rerender(tree('not-a-pack'));
    expectSections();
    expect(view.container.querySelector('[data-widget-pack="classic"]')).toBeInTheDocument();
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    expect(requestCount('/signals/7/live')).toBe(1);
    expect(requestCount('/vehicles')).toBe(1);
  });

  it('preserves zero, negative torque and additional motor identity while converting SI only for display', async () => {
    live = snapshot({
      'DiStatorTempF': entry(0), DiStatorTempR: entry(-10), DiInverterTF: entry(0),
      DiTorqueActualF: entry(-240), DiStateF: entry(0, 'ValueKindEnum'),
      DiStatorTempREL: entry(0), DiStatorTempRER: entry(70),
    });
    const view = render(tree('v7'));
    await presentation(view.container, 'pixel');
    expect(row('DiStatorTempF').getByText(/^0(?:\.0+)?°C$/)).toBeInTheDocument();
    expect(row('DiStatorTempR').getByText(/^-10(?:\.0+)?°C$/)).toBeInTheDocument();
    expect(row('DiTorqueActualF').getByText(/^-240(?:\.0+)? Nm$/)).toBeInTheDocument();
    expect(row('DiStateF').getByText('Unknown')).toBeInTheDocument();
    expect(row('DiStatorTempREL').getByText(/^0(?:\.0+)?°C$/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Rear-right motor' })).toBeInTheDocument();
    act(() => { client.setQueryData(['settings'], { ...settings, unit_of_temp: 'F' }); });
    await waitFor(() => expect(row('DiStatorTempF').getByText(/^32(?:\.0+)?°F$/)).toBeInTheDocument());
    expect(row('DiStatorTempR').getByText(/^14(?:\.0+)?°F$/)).toBeInTheDocument();
    expect(row('DiTorqueActualF').getByText(/^-240(?:\.0+)? Nm$/)).toBeInTheDocument();
    expect((live.signals?.['DiStatorTempF'] as VehicleLiveSignal).value).toBe(0);
    expect(requestCount('/signals/7/live')).toBe(1);
  });

  it('never promotes stale, future, untimed, invalid or legacy evidence into fresh/supported/active readings', async () => {
    live = snapshot({
      'DiStatorTempF': entry(60, 'ValueKindFloat', { ts: '' }),
      DiStatorTempR: entry(65, 'ValueKindFloat', { ts: new Date(NOW + 1000).toISOString() }),
      DiInverterTF: entry(40, 'ValueKindFloat', { age_ms: -1 }),
      DiInverterTR: entry(45, 'ValueKindFloat', { source: 'l2' }),
      DiTorqueActualF: entry(-32, 'ValueKindFloat', { ts: OLD, source: 'stale', age_ms: 180_000 }),
      DiTorqueActualR: entry(0, 'ValueKindFloat', { source: 'unknown' }),
      DiStateF: entry('Running', 'ValueKindEnum'), DiStateR: 'Enable',
      DiStatorTempREL: entry(55, 'ValueKindFloat', { ts: '' }),
      DiStatorTempRER: entry(Number.NaN),
    });
    const view = render(tree('v3'));
    await presentation(view.container, 'precision');
    expectSections();
    expect(row('DiTorqueActualF').getByText('Stale observation')).toBeInTheDocument();
    for (const field of ['DiStatorTempF', 'DiStatorTempR', 'DiInverterTF', 'DiInverterTR', 'DiTorqueActualR']) {
      expect(row(field).getByText('Freshness unknown')).toBeInTheDocument();
    }
    expect(row('DiStateF').getByText('No valid reading')).toBeInTheDocument();
    expect(row('DiStateR').getByText('No valid reading')).toBeInTheDocument();
    expect(screen.queryByText('Fresh observation')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Rear-left motor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Rear-right motor' })).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-vehicle-studio]')).toHaveAttribute('data-activity', 'static');
  });

  it('retains data on refresh failure, marks its trust and recovers using the real refresh action', async () => {
    const view = render(tree('v4'));
    await presentation(view.container, 'owner');
    failLive = true;
    refresh();
    await screen.findByTestId('stale-refresh-warning');
    await settled();
    expectSections();
    expect(row('DiTorqueActualF').getByText(/^-32(?:\.0+)? Nm$/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Retained observation')).toHaveLength(9));
    expect(screen.queryByText('Fresh observation')).not.toBeInTheDocument();
    failLive = false;
    refresh();
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument());
    await settled();
    expect(row('DiStatorTempR').getByText('Fresh observation')).toBeInTheDocument();
  });

  it('keeps every section during first failure and retries without losing the authentic vehicle', async () => {
    failLive = true;
    const view = render(tree('v2'));
    await presentation(view.container, 'elevated');
    expectSections();
    expect(screen.getByText('Axle signal evidence is unavailable.')).toBeInTheDocument();
    expect(image(view.container)).toBeInTheDocument();
    expect(screen.queryByText('Fresh observation')).not.toBeInTheDocument();
    failLive = false;
    fireEvent.click(within(screen.getByRole('region', { name: 'Live axle evidence' })).getByRole('button', { name: 'Retry' }));
    await screen.findAllByText('Fresh observation');
    await settled();
  });

  it('preserves the source-shaped loading shell and disables refresh until its in-flight request settles', async () => {
    let finish: ((value: VehicleLiveSignalsResponse) => void) | undefined;
    pendingLive = new Promise(resolve => { finish = resolve; });
    const view = render(tree('v5'));
    await waitFor(() => expect(view.container.querySelector('[data-widget-family="axle-map"]'))
      .toHaveAttribute('data-widget-appearance', 'iconic'));
    expectSections();
    expect(screen.getByRole('status', { name: 'Loading Live axle evidence' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Refresh data/ })).toBeDisabled();
    expect(screen.queryByText('Fresh observation')).not.toBeInTheDocument();
    await act(async () => { finish?.(live); });
    await settled();
    expect(screen.getByRole('button', { name: /^Refresh data/ })).toBeEnabled();
    expect(row('DiStatorTempR').getByText(/^65(?:\.0+)?°C$/)).toBeInTheDocument();
  });

  it('marks paused refreshes retained instead of reporting current success', async () => {
    const view = render(tree('v6'));
    await presentation(view.container, 'expressive');
    const liveQuery = client.getQueryCache().find({ queryKey: telemetryKeys.liveSignals(7) });
    expect(liveQuery).toBeDefined();
    act(() => { liveQuery?.setState({ fetchStatus: 'paused' }); });
    expect(liveQuery?.state.fetchStatus).toBe('paused');
    expectSections();
    await waitFor(() => expect(screen.getAllByText('Retained observation')).toHaveLength(9));
    expect(screen.queryByText('Fresh observation')).not.toBeInTheDocument();
    expect(row('DiTorqueActualF').getByText(/^-32(?:\.0+)? Nm$/)).toBeInTheDocument();
  });

  it('honors config/prop vehicle scope, rejects mismatches and never reuses assembly time as observation time', async () => {
    live = snapshot({}, 9);
    const view = render(tree('v1', { vehicleId: undefined, config: { vehicleId: 9 } }));
    await presentation(view.container, 'studio');
    expect(requestCount('/signals/9/live')).toBe(1);
    const configuredImage = image(view.container).getAttribute('src');
    live = snapshot(undefined, 9);
    view.rerender(tree('v1', { vehicleId: 7, config: { vehicleId: 9 } }));
    await waitFor(() => expect(requestCount('/signals/7/live')).toBe(1));
    await settled();
    expectSections();
    expect(screen.getByText('Signal response does not match the selected vehicle.')).toBeInTheDocument();
    expect(screen.getAllByText('Observation time unknown')).toHaveLength(8);
    expect(screen.queryByText('Fresh observation')).not.toBeInTheDocument();
    expect(image(view.container).getAttribute('src')).not.toBe(configuredImage);
  });

  it('keeps front/rear and configuration shells without any vehicle instead of inventing a model', async () => {
    vehicleResponse = [];
    const view = render(tree('v7', { vehicleId: undefined }));
    await presentation(view.container, 'pixel');
    expectSections();
    expect(screen.getByText('Select a vehicle')).toBeInTheDocument();
    expect(screen.getByText('Vehicle model not reported.')).toBeInTheDocument();
    expect(view.container.querySelector('[data-vehicle-twin] img')).not.toBeInTheDocument();
    expect(requestCount('/signals/7/live')).toBe(0);
  });

  it('does not erase axle observations when only vehicle metadata fails', async () => {
    failVehicles = true;
    const view = render(tree('v3'));
    await presentation(view.container, 'precision');
    expectSections();
    expect(screen.getByText('Vehicle illustration could not be loaded.')).toBeInTheDocument();
    expect(row('DiStatorTempR').getByText(/^65(?:\.0+)?°C$/)).toBeInTheDocument();
    expect(row('DiStateR').getByText('Enabled')).toBeInTheDocument();
  });

  it('does not substitute a different model when no authentic illustration matches the selected vehicle', async () => {
    vehicleResponse = vehicles.map(vehicle => ({ ...vehicle, model: 'Cybertruck' }));
    const view = render(tree('v1'));
    await presentation(view.container, 'studio');
    expectSections();
    expect(screen.getByText('No matching vehicle illustration is available for the reported model.')).toBeInTheDocument();
    expect(view.container.querySelector('[data-vehicle-twin] img')).not.toBeInTheDocument();
    expect(row('DiStatorTempR').getByText(/^65(?:\.0+)?°C$/)).toBeInTheDocument();
  });
});
