import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { VehicleLiveSignal, VehicleLiveSignalsResponse, UseVehicleLiveSignalsOptions } from '@/api/hooks/useTelemetry';
import type { Vehicle } from '@/types/vehicle';
import * as settingsHook from '@/hooks/useSettings';
import TireWarningsWidget from './TireWarningsWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import type { WidgetProps } from './types';

type QueryFixture<T> = DataStateSource<T> & {
  dataUpdatedAt: number;
  isFetching: boolean;
  refetch: () => Promise<void>;
};
const mocks = vi.hoisted(() => ({
  live: vi.fn<(id?: number, options?: UseVehicleLiveSignalsOptions) => QueryFixture<VehicleLiveSignalsResponse>>(),
  vehicles: vi.fn<() => QueryFixture<Vehicle[]>>(),
  refreshLive: vi.fn<() => Promise<void>>(),
  refreshVehicles: vi.fn<() => Promise<void>>(),
}));
vi.mock('@/api/hooks/useTelemetry', () => ({ useVehicleLiveSignals: mocks.live }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: mocks.vehicles }));
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const { createInstance } = await vi.importActual<typeof import('i18next')>('i18next');
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } });
  return { ...actual, useTranslation: (ns?: string) => ({ t: i18n.getFixedT('en', ns), i18n }) };
});
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

const NOW = Date.parse('2026-11-07T02:00:00.000Z');
const RECENT = new Date(NOW - 10_000).toISOString();
const SENSOR = new Date(NOW - 30_000).toISOString();
const OLD = new Date(NOW - 180_000).toISOString();
const PACKS = [
  ['v1', 'studio'], ['v2', 'elevated'], ['v3', 'precision'], ['v4', 'owner'],
  ['v5', 'iconic'], ['v6', 'expressive'], ['v7', 'pixel'],
] as const;
const WHEELS = [
  ['Fl', 'FrontLeft', 'Front left', 280_000],
  ['Fr', 'FrontRight', 'Front right', 285_000],
  ['Rl', 'RearLeft', 'Rear left', 290_000],
  ['Rr', 'RearRight', 'Rear right', 295_000],
] as const;
const SECTIONS = ['Live TPMS evidence', 'Per-wheel tire status', 'Evidence limits'];
const NOTE = 'Warnings and timestamps must be reported; no alert is inferred from a missing value.';
const vehicles: Vehicle[] = [7, 9].map(id => ({
  id, vehicle_id: id, vin: `TEST-VEHICLE-${id}`, display_name: `Vehicle ${id}`,
  model: id === 7 ? 'Model 3' : 'Model Y', trim_badging: '', exterior_color: 'PearlWhite',
  wheel_type: '', state: 'online', healthy: true, created_at: RECENT, updated_at: RECENT,
}));

function entry(value: unknown, kind = 'ValueKindFloat', overrides: Partial<VehicleLiveSignal> = {}): VehicleLiveSignal {
  return { value, kind, ts: RECENT, source: 'l1', age_ms: 10_000, ...overrides };
}
function snapshot(overrides: Record<string, unknown> = {}, vehicleId = 7): VehicleLiveSignalsResponse {
  const signals: Record<string, VehicleLiveSignal | unknown> = {};
  for (const [suffix, corner, , pressure] of WHEELS) {
    signals[`TpmsPressure${suffix}`] = entry(pressure);
    signals[`TpmsLastSeenPressureTime${suffix}`] = entry(Date.parse(SENSOR) / 1000);
    signals[`TpmsHardWarnings${corner}`] = entry(corner === 'FrontLeft', 'ValueKindBool');
    signals[`TpmsSoftWarnings${corner}`] = entry(corner === 'FrontRight', 'ValueKindBool');
  }
  return { vehicle_id: vehicleId, at: new Date(NOW).toISOString(), signals: { ...signals, ...overrides } };
}
function query<T>(data: T | undefined, refetch: () => Promise<void>, overrides: Partial<QueryFixture<T>> = {}): QueryFixture<T> {
  return {
    data, refetch, isSuccess: true, isPending: false, isLoading: false, isFetching: false,
    isError: false, error: null, fetchStatus: 'idle', dataUpdatedAt: data == null ? 0 : NOW,
    ...overrides,
  };
}
function tree(pack?: unknown, props: Partial<WidgetProps> = {}) {
  return <MemoryRouter><PackBoundary requestedPackId={pack}>
    <TireWarningsWidget size={{ cols: 2, rows: 4 }} {...props} />
  </PackBoundary></MemoryRouter>;
}
async function presentation(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector(`[data-widget-family="tire"][data-widget-appearance="${appearance}"]`))
    .toHaveAttribute('data-instrument-appearance', appearance));
}
function wheel(label: string) { return within(screen.getByRole('group', { name: label })); }
function summary() { return within(screen.getByRole('region', { name: 'Evidence limits' })); }
function expectSections() {
  for (const name of SECTIONS) expect(screen.getByRole('region', { name })).toBeInTheDocument();
  for (const [, , label] of WHEELS) expect(screen.getByRole('group', { name: label })).toBeInTheDocument();
  expect(screen.getByText(NOTE)).toBeInTheDocument();
  expect(screen.getByText('Pressure and last-seen history are not established by this live source.')).toBeInTheDocument();
  expect(screen.getByText('Vehicle support and applied telemetry configuration remain unknown.')).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  mocks.refreshLive.mockResolvedValue(undefined);
  mocks.refreshVehicles.mockResolvedValue(undefined);
  mocks.vehicles.mockReturnValue(query(vehicles, mocks.refreshVehicles));
  mocks.live.mockReturnValue(query(snapshot(), mocks.refreshLive));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('TireWarningsWidget production design packs', () => {
  it.each(PACKS)('%s / %s keeps Pa pressures, actual vehicle, wheel timestamps, flattened warnings and refresh', async (pack, appearance) => {
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expectSections();
    expect(screen.getByRole('heading', { name: 'Tire warnings & freshness' })).toBeInTheDocument();
    for (const [, , label, pressure] of WHEELS) {
      expect(wheel(label).getByText(new RegExp(`^${(pressure / 100_000).toFixed(2).replace('.', '\\.')}\\s+bar$`))).toBeInTheDocument();
      expect(wheel(label).getByText(/^Pressure observed:/).querySelector('time')).toHaveAttribute('datetime', RECENT);
      expect(wheel(label).getByText(/^Last sensor report:/).querySelector('time')).toHaveAttribute('datetime', SENSOR);
      expect(wheel(label).getByText(/^Sensor age:/)).toHaveTextContent('30s ago');
      expect(wheel(label).getByText(/^Fresh$/, { selector: '[data-pressure-trust]' })).toBeInTheDocument();
    }
    const hard = within(wheel('Front left').getByRole('group', { name: 'Hard warning' }));
    const soft = within(wheel('Front right').getByRole('group', { name: 'Soft warning' }));
    expect(hard.getByText('Reported')).toBeInTheDocument();
    expect(soft.getByText('Reported')).toBeInTheDocument();
    expect(hard.getByText(/^Fresh ·/).querySelector('time')).toHaveAttribute('datetime', RECENT);
    expect(summary().getByText('Hard warning reported')).toBeInTheDocument();
    expect(view.container.querySelector('.widget-big-number')).toHaveTextContent('4/4');
    expect(view.container.querySelector('[data-vehicle-studio] [data-vehicle-twin] img')).toHaveAttribute('src');
    expect(view.container.querySelector('[data-instrument-family="tire"] .lucide-circle-dot')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(mocks.live).toHaveBeenLastCalledWith(7, { refetchInterval: 5_000 });
    expect(screen.getByRole('link', { name: 'Open tire pressure' })).toHaveAttribute('href', '/tire-pressure');

    fireEvent.click(screen.getByRole('button', { name: /refresh data/i }));
    expect(mocks.refreshLive).toHaveBeenCalledTimes(1);
    expect(mocks.refreshVehicles).toHaveBeenCalledTimes(1);
  });

  it.each(PACKS)('%s / %s preserves compact unknowns and measured zero without deriving alerts or using compound parents', async (pack, appearance) => {
    const overrides: Record<string, unknown> = {
      TpmsPressureFl: entry(Number.NaN), TpmsPressureFr: entry(0),
      TpmsPressureRl: entry(-1), TpmsPressureRr: entry(Number.POSITIVE_INFINITY),
      TpmsLastSeenPressureTimeFr: undefined,
      TpmsHardWarnings: entry({ FrontLeft: true }, 'ValueKindCompound'),
      TpmsSoftWarnings: entry({ FrontRight: false }, 'ValueKindCompound'),
    };
    for (const [, corner] of WHEELS) {
      overrides[`TpmsHardWarnings${corner}`] = undefined;
      overrides[`TpmsSoftWarnings${corner}`] = undefined;
    }
    mocks.live.mockReturnValue(query(snapshot(overrides), mocks.refreshLive));
    const view = render(tree(pack, { size: { cols: 1, rows: 3 } }));
    await presentation(view.container, appearance);
    expectSections();
    expect(wheel('Front right').getByText(/^0\.00\s+bar$/)).toBeInTheDocument();
    for (const label of ['Front left', 'Rear left', 'Rear right']) {
      expect(wheel(label).getByText('—')).toBeInTheDocument();
    }
    expect(wheel('Front right').getByText(/^Last sensor report:/)).toHaveTextContent('Not reported');
    expect(wheel('Front right').getByText(/^Sensor age:/)).toHaveTextContent('Unknown');
    expect(wheel('Front right').getByText('Freshness unknown', { selector: '[data-pressure-trust]' })).toBeInTheDocument();
    for (const [, , label] of WHEELS) {
      const hard = within(wheel(label).getByRole('group', { name: 'Hard warning' }));
      expect(hard.getByText('Not reported', { selector: 'span' })).toBeInTheDocument();
    }
    expect(summary().getByText('Warnings unknown')).toBeInTheDocument();
    expect(screen.queryByText('No warnings reported')).not.toBeInTheDocument();
    expect(screen.queryByText('Hard warning reported')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-vehicle-studio]')).toHaveAttribute('data-studio-layout', 'compact');
  });
});

it.each([1, 2])('keeps Classic default and unknown-pack recovery with every source section at %i columns', cols => {
  const view = render(tree(undefined, { size: { cols, rows: 4 } }));
  expectSections();
  expect(view.container.querySelector('[data-widget-pack="classic"]')).toBeInTheDocument();
  expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(wheel('Front left').getByText(/^2\.80\s+bar$/)).toBeInTheDocument();
  view.rerender(tree('missing-pack', { size: { cols, rows: 4 } }));
  expectSections();
  expect(view.container.querySelector('[data-widget-pack="classic"]')).toBeInTheDocument();
});

it('changes all seven presentations and returns to Classic without replacing data, images or issuing extra actions', async () => {
  const view = render(tree('classic'));
  const image = view.container.querySelector('[data-vehicle-twin] img')?.getAttribute('src');
  expect(image).toBeTruthy();
  for (const [pack, appearance] of PACKS) {
    view.rerender(tree(pack));
    await presentation(view.container, appearance);
    expectSections();
    expect(wheel('Rear right').getByText(/^2\.95\s+bar$/)).toBeInTheDocument();
    expect(view.container.querySelector('[data-vehicle-twin] img')).toHaveAttribute('src', image);
  }
  view.rerender(tree('classic'));
  expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(summary().getByText('Hard warning reported')).toBeInTheDocument();
  expect(mocks.refreshLive).not.toHaveBeenCalled();
  expect(mocks.refreshVehicles).not.toHaveBeenCalled();
});

it.each([
  ['loading', undefined, { isPending: true, isLoading: true, isFetching: true, isSuccess: false }],
  ['first failure', undefined, { isError: true, error: new Error('Signal source failed'), isSuccess: false }],
  ['empty', { vehicle_id: 7, signals: {}, at: RECENT }, {}],
] satisfies [string, VehicleLiveSignalsResponse | undefined, Partial<QueryFixture<VehicleLiveSignalsResponse>>][])(
  'keeps all wheel and evidence shells during %s', async (kind, data, overrides) => {
    mocks.live.mockReturnValue(query(data, mocks.refreshLive, overrides));
    const view = render(tree('v4'));
    await presentation(view.container, 'owner');
    expectSections();
    for (const [, , label] of WHEELS) expect(wheel(label).getByText('—')).toBeInTheDocument();
    expect(summary().getByText('Warnings unknown')).toBeInTheDocument();
    expect(screen.queryByText('No warnings reported')).not.toBeInTheDocument();
    if (kind === 'loading') {
      expect(screen.getByRole('status', { name: 'Loading Live TPMS evidence' })).toBeInTheDocument();
    } else if (kind === 'first failure') {
      expect(screen.getByText('Tire signal evidence is unavailable.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
      expect(mocks.refreshLive).toHaveBeenCalledTimes(1);
    } else expect(screen.getByText('No tire signals have been reported for this vehicle.')).toBeInTheDocument();
  },
);

it('retains failed-refresh readings but never claims retained warning evidence is current, and disables an in-flight refresh', async () => {
  mocks.live.mockReturnValue(query(snapshot(), mocks.refreshLive, { isError: true, error: new Error('Refresh failed') }));
  const view = render(tree('v7'));
  await presentation(view.container, 'pixel');
  expectSections();
  expect(view.container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
  expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  expect(wheel('Front left').getByText(/^2\.80\s+bar$/)).toBeInTheDocument();
  expect(wheel('Front left').getByText('Retained', { selector: '[data-pressure-trust]' })).toBeInTheDocument();
  expect(within(wheel('Front left').getByRole('group', { name: 'Hard warning' })).getByText('Reported')).toBeInTheDocument();
  expect(summary().getByText('Warnings unknown')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /refresh data/i }));
  expect(mocks.refreshLive).toHaveBeenCalledTimes(1);
  mocks.live.mockReturnValue(query(snapshot(), mocks.refreshLive, { isFetching: true }));
  view.rerender(tree('v7'));
  expect(screen.getByRole('button', { name: /refresh data/i })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /refresh data/i }));
  expect(mocks.refreshLive).toHaveBeenCalledTimes(1);
});

it('does not refresh old sensor times or stale warning reports just because the HTTP snapshot was polled recently', async () => {
  const overrides: Record<string, unknown> = { TpmsLastSeenPressureTimeFl: entry(Date.parse(OLD) / 1000) };
  for (const [, corner] of WHEELS) {
    overrides[`TpmsHardWarnings${corner}`] = entry(corner === 'FrontLeft', 'ValueKindBool', { ts: OLD, source: 'stale', age_ms: 180_000 });
    overrides[`TpmsSoftWarnings${corner}`] = entry(false, 'ValueKindBool', { ts: OLD, source: 'stale', age_ms: 180_000 });
  }
  mocks.live.mockReturnValue(query(snapshot(overrides), mocks.refreshLive));
  const view = render(tree('v3'));
  await presentation(view.container, 'precision');
  expect(wheel('Front left').getByText('Stale', { selector: '[data-pressure-trust]' })).toBeInTheDocument();
  expect(wheel('Front left').getByText(/^Sensor age:/)).toHaveTextContent('3m ago');
  expect(wheel('Front left').getByText(/^Last sensor report:/).querySelector('time')).toHaveAttribute('datetime', OLD);
  const hard = within(wheel('Front left').getByRole('group', { name: 'Hard warning' }));
  expect(hard.getByText('Reported')).toBeInTheDocument();
  expect(hard.getByText(/^Stale ·/).querySelector('time')).toHaveAttribute('datetime', OLD);
  expect(summary().getByText('Warnings unknown')).toBeInTheDocument();
});

it('keeps unknown-source, future, malformed and absent timestamps unknown rather than clearing warnings', async () => {
  mocks.live.mockReturnValue(query(snapshot({
    TpmsPressureFl: entry(280_000, 'ValueKindFloat', { ts: '', source: 'l2' }),
    TpmsLastSeenPressureTimeFl: entry(0),
    TpmsLastSeenPressureTimeFr: entry((NOW + 60_000) / 1000),
    TpmsHardWarningsFrontLeft: entry(false, 'ValueKindBool', { source: 'unknown' }),
    TpmsHardWarningsFrontRight: entry(false, 'ValueKindBool', { ts: new Date(NOW + 60_000).toISOString() }),
    TpmsSoftWarningsFrontRight: entry(false, 'ValueKindBool', { ts: 'invalid' }),
    TpmsHardWarningsRearLeft: entry('false', 'ValueKindBool'),
  }), mocks.refreshLive));
  const view = render(tree('v6'));
  await presentation(view.container, 'expressive');
  expect(wheel('Front left').getByText(/^2\.80\s+bar$/)).toBeInTheDocument();
  expect(wheel('Front left').getByText('Freshness unknown', { selector: '[data-pressure-trust]' })).toBeInTheDocument();
  expect(wheel('Front left').getByText(/^Pressure observed:/)).toHaveTextContent('Not reported');
  expect(wheel('Front right').getByText(/^Last sensor report:/)).toHaveTextContent('Not reported');
  expect(summary().getByText('Warnings unknown')).toBeInTheDocument();
  expect(screen.queryByText('No warnings reported')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /refresh data.*up to date/i })).not.toBeInTheDocument();
});

it('reports no warnings only from eight fresh explicit false child readings, never pressure thresholds', async () => {
  const overrides: Record<string, unknown> = { TpmsPressureFl: entry(0) };
  for (const [, corner] of WHEELS) {
    overrides[`TpmsHardWarnings${corner}`] = entry(false, 'ValueKindBool');
    overrides[`TpmsSoftWarnings${corner}`] = entry(false, 'ValueKindBool');
  }
  mocks.live.mockReturnValue(query(snapshot(overrides), mocks.refreshLive));
  const view = render(tree('v1'));
  await presentation(view.container, 'studio');
  expect(wheel('Front left').getByText(/^0\.00\s+bar$/)).toBeInTheDocument();
  expect(summary().getByText('No warnings reported')).toBeInTheDocument();
  expect(screen.queryByText('Hard warning reported')).not.toBeInTheDocument();
});

it('formats canonical Pa using the saved pressure preference and decimal precision', async () => {
  const base = settingsHook.useSettings();
  vi.spyOn(settingsHook, 'useSettings').mockReturnValue({
    ...base, settings: { ...base.settings, unit_of_pressure: 'psi', decimal_precision: 1 },
  });
  const view = render(tree('v2'));
  await presentation(view.container, 'elevated');
  expect(wheel('Front left').getByText(/^40\.6\s+psi$/)).toBeInTheDocument();
  expect(wheel('Rear right').getByText(/^42\.8\s+psi$/)).toBeInTheDocument();
});

it.each([
  [{ vehicleId: 9, config: { vehicleId: 7 } }, 9],
  [{ config: { vehicleId: 9 } }, 9],
  [{}, 7],
] satisfies [Partial<WidgetProps>, number][])('respects explicit, configured and fallback vehicle selection: %j', (props, id) => {
  mocks.live.mockReturnValue(query(snapshot({}, id), mocks.refreshLive));
  render(tree('classic', props));
  expect(mocks.live).toHaveBeenLastCalledWith(id, { refetchInterval: 5_000 });
  expect(wheel('Front left').getByText(/^2\.80\s+bar$/)).toBeInTheDocument();
});

it('keeps live evidence independent of the vehicle illustration source failure', async () => {
  mocks.vehicles.mockReturnValue(query<Vehicle[]>(undefined, mocks.refreshVehicles, { isError: true, error: new Error('Vehicles failed') }));
  const view = render(tree('v5', { vehicleId: 7 }));
  await presentation(view.container, 'iconic');
  expectSections();
  expect(screen.getByText('Vehicle illustration could not be loaded.')).toBeInTheDocument();
  expect(wheel('Front left').getByText(/^2\.80\s+bar$/)).toBeInTheDocument();
  expect(summary().getByText('Hard warning reported')).toBeInTheDocument();
});

it('does not leak a different vehicle snapshot into the selected wheel readouts', async () => {
  mocks.live.mockReturnValue(query(snapshot({}, 9), mocks.refreshLive));
  const view = render(tree('v4', { vehicleId: 7 }));
  await presentation(view.container, 'owner');
  expectSections();
  expect(screen.getByText('Tire signal evidence is unavailable.')).toBeInTheDocument();
  for (const [, , label] of WHEELS) expect(wheel(label).getByText('—')).toBeInTheDocument();
  expect(summary().getByText('Warnings unknown')).toBeInTheDocument();
});

it('keeps all four corners and recovery visible when there is no selected vehicle', async () => {
  mocks.vehicles.mockReturnValue(query([], mocks.refreshVehicles));
  mocks.live.mockReturnValue(query<VehicleLiveSignalsResponse>(undefined, mocks.refreshLive, { isPending: true, isSuccess: false }));
  const view = render(tree('v7'));
  await presentation(view.container, 'pixel');
  expectSections();
  expect(screen.getByText('Select a vehicle')).toBeInTheDocument();
  expect(screen.getByText('Vehicle model illustration unavailable.')).toBeInTheDocument();
  expect(view.container.querySelector('[data-vehicle-twin]')).toBeNull();
  expect(mocks.live).toHaveBeenLastCalledWith(undefined, { refetchInterval: 5_000 });
  fireEvent.click(screen.getByRole('button', { name: /refresh data/i }));
  expect(mocks.refreshVehicles).toHaveBeenCalledTimes(1);
  expect(mocks.refreshLive).not.toHaveBeenCalled();
});

it('does not substitute a generic model illustration for an unrecognized vehicle model', async () => {
  mocks.vehicles.mockReturnValue(query([{ ...vehicles[0], model: 'Cybertruck' }], mocks.refreshVehicles));
  const view = render(tree('v1'));
  await presentation(view.container, 'studio');
  expect(screen.getByText('Vehicle model illustration unavailable.')).toBeInTheDocument();
  expect(view.container.querySelector('[data-vehicle-twin]')).toBeNull();
  expect(wheel('Front left').getByText(/^2\.80\s+bar$/)).toBeInTheDocument();
});
