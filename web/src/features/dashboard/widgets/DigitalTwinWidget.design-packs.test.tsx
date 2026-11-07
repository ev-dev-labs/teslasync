import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ChargingTelemetry, SecurityEvent, Vehicle, VehicleStateReadings } from '@/api/types';
import type { useVehicleState } from '@/api/hooks/useVehicles';
import { buildCompositorUrl } from '@/lib/teslaCompositor';
import DigitalTwinWidget from './DigitalTwinWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetSize } from './types';

const { vehiclesMock, stateMock, securityMock, chargingMock } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(), stateMock: vi.fn(), securityMock: vi.fn(), chargingMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
  useVehicleState: (...args: unknown[]) => stateMock(...args),
  useSecurityLatest: (...args: unknown[]) => securityMock(...args),
  useChargingTelemetryLatest: (...args: unknown[]) => chargingMock(...args),
}));
vi.mock('react-i18next', () => {
  const labels: Record<string, string> = {
    'digitalTwin.title': 'Vehicle visualization',
    'digitalTwin.doorDriverFront': 'Driver front',
    'teslaOnly.door': 'door',
    'common.open': 'Open', 'common.closed': 'Closed', 'common.unknown': 'Unknown',
    'common.locked': 'Locked', 'common.unlocked': 'Unlocked',
    'common.on': 'On', 'common.off': 'Off',
    'common.charging': 'Charging', 'common.notCharging': 'Not charging',
  };
  return {
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
        const text = typeof fallback === 'string' ? fallback : labels[key] ?? key;
        return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (value: unknown) => String(value) }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

const FULL: WidgetSize = { cols: 3, rows: 5 };
const COMPACT: WidgetSize = { cols: 2, rows: 3 };
type StatePayload = NonNullable<ReturnType<typeof useVehicleState>['data']>;

function vehicle(id: number, overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id, vehicle_id: id, vin: `FIXTURE-${id}`, display_name: 'Selected blue car',
    model: 'model3', trim_badging: 'p74d', exterior_color: 'DeepBlue', wheel_type: 'Stiletto20',
    state: 'online', healthy: true, created_at: '', updated_at: '', ...overrides,
  };
}

function readings(overrides: Partial<VehicleStateReadings> = {}): VehicleStateReadings {
  return {
    vehicle_id: 9, state: null, latitude: null, longitude: null, speed: null, power: null,
    battery_level: null, rated_range: null, ideal_range: null, odometer: null,
    inside_temp: null, outside_temp: null, is_climate_on: null, is_charging: null,
    charger_power: null, charge_rate: null, time_to_full_charge: null,
    is_locked: null, sentry_mode: null, software_version: null, ...overrides,
  };
}

function security(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    vehicle_id: 9, ts: new Date().toISOString(), event_type: 'state', doors_open: null,
    windows_open: 'closed', locked: false, sentry_mode: true, user_present: null,
    detail: null, source: 'signal', created_at: '',
    door_state: JSON.stringify({ DriverFront: true, PassengerRear: true, TrunkFront: true, TrunkRear: true }),
    lights_high_beams: true, lights_hazards_active: true, ...overrides,
  };
}

function charging(overrides: Partial<ChargingTelemetry> = {}): ChargingTelemetry {
  return {
    vehicle_id: 9, ts: new Date().toISOString(), session_id: null, battery_level: null,
    battery_range_mi: null, charging_state: 'Charging', charger_voltage: null,
    charger_actual_current: null, charger_power_w: null, charger_phases: null,
    charge_energy_added_wh: null, range_added_meters: null, range_added_meters_per_hour: null,
    charger_pilot_current: null, scheduled_charging_at: null, source: 'signal',
    charge_port_door_open: true, ...overrides,
  };
}

function query<T>(data: T | undefined) {
  return {
    data, error: null as Error | null, isLoading: false, isPending: false,
    isFetching: false, isStale: false, isError: false, dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  };
}

let vehiclesQuery: ReturnType<typeof query<Vehicle[]>>;
let stateQuery: ReturnType<typeof query<StatePayload | null>>;
let securityQuery: ReturnType<typeof query<SecurityEvent | null>>;
let chargingQuery: ReturnType<typeof query<ChargingTelemetry | null>>;

function widget(packId: string, size = FULL, vehicleId = 9) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <DigitalTwinWidget size={size} vehicleId={vehicleId} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function presentation(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(
    container.querySelector(`[data-widget-family="twin"][data-widget-appearance="${appearance}"]`),
  ).toBeInTheDocument());
}

function detail(label: string) {
  const row = screen.getByText(label, { selector: 'dt' }).parentElement;
  expect(row).not.toBeNull();
  return within(row as HTMLElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.removeItem('teslasync:vehicle:9:paint');
  vehiclesQuery = query([vehicle(7, { display_name: 'Other car', exterior_color: 'PearlWhite' }), vehicle(9)]);
  stateQuery = query<StatePayload | null>({
    state: readings({ state: 'driving', speed: 16 }),
    live: true, observedAt: Date.now(), freshness: 'fresh', verifiedFields: ['state', 'speed'],
  });
  securityQuery = query<SecurityEvent | null>(security());
  chargingQuery = query<ChargingTelemetry | null>(charging());
  vehiclesMock.mockReturnValue(vehiclesQuery);
  stateMock.mockReturnValue(stateQuery);
  securityMock.mockReturnValue(securityQuery);
  chargingMock.mockReturnValue(chargingQuery);
});

describe.each(Object.entries(PACK_APPEARANCES))('Digital twin %s (%s)', (packId, appearance) => {
  it.each([FULL, COMPACT])('preserves the real selected vehicle, overlays, all status sections and controls at %j', async size => {
    const { container } = render(widget(packId, size));
    await presentation(container, appearance);

    expect(screen.getByRole('heading', { name: 'Digital twin' })).toBeVisible();
    expect(screen.getByText('Selected blue car')).toBeVisible();
    expect(screen.queryByText('Other car')).not.toBeInTheDocument();
    expect(screen.getByText('Interactive digital twin')).toBeVisible();
    const scene = screen.getByRole('img', { name: 'Vehicle visualization' });
    expect(container.querySelectorAll('[data-vehicle-twin]')).toHaveLength(1);
    expect(scene.closest('[data-vehicle-studio]')).toHaveAttribute('data-studio-layout', size === COMPACT ? 'bounded' : 'full');
    expect(scene).toHaveStyle({ width: size === COMPACT ? '300px' : '440px' });
    expect(scene.querySelector('desc')).toHaveTextContent('Driver front door: Open');
    expect(scene.querySelector('desc')).toHaveTextContent('Unlocked');
    const photo = scene.querySelector<HTMLImageElement>('img');
    expect(photo).toHaveAttribute('src', buildCompositorUrl('deep-blue', 'model3'));
    if (!photo) throw new Error('The authentic vehicle image must remain mounted');
    fireEvent.load(photo);
    expect(photo).toHaveStyle({ opacity: '1' });
    expect(scene.querySelector('g[id="doors"]')).toBeInTheDocument();
    expect(scene.querySelector('g[id="windows"]')).toBeInTheDocument();
    expect(scene.querySelector('g[id="lighting"]')).toBeInTheDocument();
    for (const label of ['Windows closed', 'Lights on', 'Hazards', '2 Doors open', 'Frunk open', 'Trunk open']) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(detail('Charge port').getByText('Open')).toBeVisible();
    expect(detail('Lock').getByText('Unlocked')).toBeVisible();
    expect(detail('Sentry').getByText('Active')).toBeVisible();
    expect(detail('Vehicle state').getByText('Driving')).toBeVisible();
    expect(detail('Charging state').getByText('Charging')).toBeVisible();
    expect(container.querySelector('[data-widget-family="twin"] .lucide-monitor')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/digital-twin');

    expect(vehiclesMock).toHaveBeenCalledOnce();
    expect(stateMock).toHaveBeenCalledExactlyOnceWith(9, { refetchInterval: 5_000 });
    expect(securityMock).toHaveBeenCalledExactlyOnceWith(9, 5_000);
    expect(chargingMock).toHaveBeenCalledExactlyOnceWith(9, 5_000);
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    for (const source of [vehiclesQuery, stateQuery, securityQuery, chargingQuery]) {
      expect(source.refetch).toHaveBeenCalledOnce();
    }
  });

  it('keeps unreported access, lock, sentry, charge port and activity unknown without inventing closed or zero readings', async () => {
    stateQuery.data = { live: false, observedAt: null, freshness: 'unknown', verifiedFields: [] };
    securityQuery.data = null;
    chargingQuery.data = null;
    const { container } = render(widget(packId));
    await presentation(container, appearance);

    expect(screen.getByRole('img', { name: 'Vehicle visualization' })).toBeInTheDocument();
    for (const label of ['Charge port', 'Sentry', 'Vehicle state', 'Charging state']) {
      expect(detail(label).getByText('Unknown')).toBeVisible();
    }
    expect(detail('Lock').getByText('Lock unknown')).toBeVisible();
    for (const cell of screen.getAllByRole('listitem')) expect(cell).toHaveAttribute('data-status', 'unknown');
    expect(screen.getByText('Windows unknown')).toBeVisible();
    expect(screen.getByText('Security state unavailable')).toBeVisible();
    expect(screen.getByText('Charging state unavailable')).toBeVisible();
    expect(screen.queryByText('Windows closed')).not.toBeInTheDocument();
    expect(screen.queryByText('Not charging')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-road-motion')).not.toBeInTheDocument();
  });

  it('keeps an empty fleet shell and unknown status cells without substituting a universal vehicle', async () => {
    vehiclesQuery.data = [];
    stateQuery.data = null;
    securityQuery.data = null;
    chargingQuery.data = null;
    const { container } = render(widget(packId));
    await presentation(container, appearance);
    expect(screen.getByText('No vehicle data')).toBeVisible();
    expect(container.querySelector('[data-vehicle-twin]')).not.toBeInTheDocument();
    expect(screen.queryByText('Interactive digital twin')).not.toBeInTheDocument();
    for (const cell of screen.getAllByRole('listitem')) expect(cell).toHaveAttribute('data-status', 'unknown');
    expect(stateMock).toHaveBeenCalledWith(0, { refetchInterval: 5_000 });
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/digital-twin');
  });
});

it('preserves Classic content and restores it after every production selection or an unknown pack ID', async () => {
  const view = render(widget('classic', COMPACT));
  expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(screen.getByText('Selected blue car')).toBeVisible();
  expect(screen.getByText('Unlocked')).toBeVisible();
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.queryByText('Interactive digital twin')).not.toBeInTheDocument();
  for (const [packId, appearance] of Object.entries(PACK_APPEARANCES)) {
    view.rerender(widget(packId, COMPACT));
    await presentation(view.container, appearance);
    expect(screen.getByText('Selected blue car')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Vehicle visualization' })).toBeInTheDocument();
  }
  for (const packId of ['classic', 'unrecognized-pack']) {
    view.rerender(widget(packId, COMPACT));
    expect(view.container.querySelector('[data-widget-pack="classic"]')).toBeInTheDocument();
    expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
    expect(screen.getByText('Unlocked')).toBeVisible();
    expect(screen.getByText('Windows closed')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Vehicle visualization' })).toBeInTheDocument();
    expect(screen.queryByText('Interactive digital twin')).not.toBeInTheDocument();
  }
});

it('does not infer a measured charge-port position from active charging and preserves a confirmed closed reading', async () => {
  chargingQuery.data = charging({ charge_port_door_open: null });
  const view = render(widget('v7'));
  await presentation(view.container, 'pixel');
  expect(detail('Charging state').getByText('Charging')).toBeVisible();
  expect(detail('Charge port').getByText('Unknown')).toBeVisible();
  chargingQuery.data = charging({ charge_port_door_open: false });
  view.rerender(widget('v7'));
  expect(detail('Charge port').getByText('Closed')).toBeVisible();
  expect(detail('Charging state').getByText('Charging')).toBeVisible();
});

it('retries one failed security source while the real twin and independent activity remain visible', async () => {
  securityQuery.data = undefined;
  securityQuery.isError = true;
  securityQuery.error = new Error('Security source failed');
  const { container } = render(widget('v4'));
  await presentation(container, 'owner');
  expect(container.querySelector('[data-data-state="partial"]')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Vehicle visualization' })).toBeInTheDocument();
  expect(detail('Vehicle state').getByText('Driving')).toBeVisible();
  expect(detail('Charging state').getByText('Charging')).toBeVisible();
  const failure = within(screen.getByRole('alert'));
  expect(failure.getByText('Security state unavailable')).toBeVisible();
  fireEvent.click(failure.getByRole('button', { name: 'Retry' }));
  expect(securityQuery.refetch).toHaveBeenCalledOnce();
  for (const source of [vehiclesQuery, stateQuery, chargingQuery]) expect(source.refetch).not.toHaveBeenCalled();
});

it('retains the actual vehicle and access readings with a source-specific warning and recovery after a failed state refresh', async () => {
  const view = render(widget('v6'));
  await presentation(view.container, 'expressive');
  stateQuery.isError = true;
  stateQuery.error = new Error('State refresh failed');
  view.rerender(widget('v6'));
  expect(screen.getByRole('img', { name: 'Vehicle visualization' })).toBeInTheDocument();
  expect(view.container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
  expect(screen.getByText('Vehicle state: previously loaded data remains visible while this source recovers.')).toBeVisible();
  expect(detail('Vehicle state').getByText('Driving')).toBeVisible();
  expect(detail('Lock').getByText('Unlocked')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByTestId('vehicle-road-motion')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(stateQuery.refetch).toHaveBeenCalledOnce();
  expect(securityQuery.refetch).not.toHaveBeenCalled();
  stateQuery.isError = false;
  stateQuery.error = null;
  view.rerender(widget('v6'));
  expect(view.container.querySelector('[data-data-state="ok"]')).toBeInTheDocument();
  expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
});

it('keeps loading and fatal telemetry failure distinct without fabricating a vehicle scene', () => {
  vehiclesQuery.data = undefined;
  vehiclesQuery.isLoading = true;
  stateQuery.data = undefined;
  stateQuery.isLoading = true;
  securityQuery.data = undefined;
  securityQuery.isLoading = true;
  chargingQuery.data = undefined;
  const view = render(widget('v2'));
  expect(view.container.querySelector('[data-data-state="initial"]')).toBeInTheDocument();
  expect(view.container.querySelector('[data-vehicle-twin]')).toBeNull();
  expect(screen.queryByText('No vehicle data')).not.toBeInTheDocument();

  vehiclesQuery.data = [vehicle(9)];
  vehiclesQuery.isLoading = false;
  for (const source of [stateQuery, securityQuery, chargingQuery]) {
    source.isLoading = false;
    source.isError = true;
    source.error = new Error('Source unavailable');
  }
  view.rerender(widget('v2'));
  expect(view.container.querySelector('[data-data-state="initialFailure"]')).toBeInTheDocument();
  expect(view.container.querySelector('[data-vehicle-twin]')).toBeNull();
  fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
  for (const source of [stateQuery, securityQuery, chargingQuery]) expect(source.refetch).toHaveBeenCalledOnce();
});
