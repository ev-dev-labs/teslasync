import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { VehicleLiveSignalsResponse, UseVehicleLiveSignalsOptions } from '@/api/hooks/useTelemetry';
import type { WidgetProps, WidgetSize } from './types';
import { PackBoundary } from './designPacks/PackBoundary';
import UnitContextWidget from './UnitContextWidget';

type QueryFixture<T> = DataStateSource<T> & {
  refetch: () => Promise<void>;
};
const mocks = vi.hoisted(() => ({
  live: vi.fn<(id?: number, options?: UseVehicleLiveSignalsOptions) => QueryFixture<VehicleLiveSignalsResponse>>(),
  vehicles: vi.fn<() => QueryFixture<Array<{ id: number }>>>(),
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
  return { ...actual, useTranslation: () => ({ t: i18n.getFixedT('en'), i18n }) };
});
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: string | number) => new Date(value).toISOString(),
    formatTime: (value: string | number) => new Date(value).toISOString(),
  }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

const packs = [
  ['v1', 'studio'], ['v2', 'elevated'], ['v3', 'precision'], ['v4', 'owner'],
  ['v5', 'iconic'], ['v6', 'expressive'], ['v7', 'pixel'],
] as const;
const full: WidgetSize = { cols: 2, rows: 4 };
const compact: WidgetSize = { cols: 1, rows: 2 };
const NOW = Date.parse('2026-11-07T02:25:00Z');
const OBSERVED = new Date(NOW - 10_000).toISOString();
const fields = [
  ['SettingDistanceUnit', 'Distance', 'Kilometers'],
  ['SettingTemperatureUnit', 'Temperature', 'Fahrenheit'],
  ['SettingTirePressureUnit', 'Tire pressure', 'Psi'],
  ['SettingChargeUnit', 'Charge', 'Percent'],
] as const;
const note = 'Unit settings are ingestion metadata; missing context must not be silently guessed.';
const historyNote = 'Live preferences do not confirm the unit context used for normalization. A vehicle unit-history reader is not available here.';
const supportNote = 'Vehicle support and applied subscription state remain unknown; configuration is not observation evidence.';
const retainedNotice = 'Previously loaded unit settings remain visible; the latest refresh is unconfirmed.';

function snapshot(vehicle_id = 42): VehicleLiveSignalsResponse {
  return {
    vehicle_id, at: new Date(NOW).toISOString(), count: fields.length,
    signals: Object.fromEntries(fields.map(([field, , value]) => [
      field, { kind: 'ValueKindEnum', value, ts: OBSERVED, source: 'l1', age_ms: 10_000 },
    ])),
  };
}
function query<T>(data: T | undefined, refetch: () => Promise<void>, overrides: Partial<QueryFixture<T>> = {}): QueryFixture<T> {
  return {
    data, refetch, error: null, isError: false, isSuccess: true, isPending: false,
    isLoading: false, isFetching: false, isStale: false, fetchStatus: 'idle',
    dataUpdatedAt: NOW, ...overrides,
  };
}
function tree(pack?: unknown, size = full, props: Pick<WidgetProps, 'vehicleId' | 'config'> = { vehicleId: 42 }) {
  return <MemoryRouter><PackBoundary requestedPackId={pack}>
    <UnitContextWidget size={size} {...props} />
  </PackBoundary></MemoryRouter>;
}
async function presentation(container: HTMLElement, appearance: string) {
  return waitFor(() => {
    const selected = container.querySelector<HTMLElement>(
      `[data-widget-family="status"][data-widget-appearance="${appearance}"]`,
    );
    if (!selected) throw new Error('The requested status presentation has not loaded');
    return selected;
  });
}
function setting(label: string) {
  return within(within(screen.getByRole('list', { name: 'Telemetry preferences' }))
    .getByRole('listitem', { name: label }));
}
function preservedSections() {
  expect(screen.getAllByRole('listitem')).toHaveLength(4);
  expect(screen.getByText('Unit context')).toBeInTheDocument();
  expect(screen.getByText('Normalization context: Unknown')).toBeInTheDocument();
  expect(screen.getByText(note)).toBeInTheDocument();
  expect(screen.getByText(historyNote)).toBeInTheDocument();
  expect(screen.getByText(supportNote)).toBeInTheDocument();
  expect(screen.getByText('Source: vehicle live signal snapshot, not application display preferences.')).toBeInTheDocument();
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  mocks.refreshLive.mockResolvedValue(undefined);
  mocks.refreshVehicles.mockResolvedValue(undefined);
  mocks.vehicles.mockReturnValue(query([{ id: 7 }], mocks.refreshVehicles));
  mocks.live.mockReturnValue(query(snapshot(), mocks.refreshLive));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('UnitContextWidget production design packs', () => {
  it.each(packs)('%s preserves four real enum observations, evidence limits and refresh in %s', async (pack, appearance) => {
    const view = render(tree(pack));
    const selected = await presentation(view.container, appearance);
    preservedSections();
    expect(selected).toHaveAttribute('data-instrument-family', 'status');
    expect(selected.querySelector('svg path[d="M20 7h-9"]')).not.toBeNull();
    for (const [field, label, value] of fields) {
      expect(setting(label).getByText(value === 'Psi' ? 'PSI' : value)).toBeInTheDocument();
      expect(setting(label).getByText(field)).toBeInTheDocument();
      expect(setting(label).getByText('Fresh observation')).toBeInTheDocument();
      expect(setting(label).getByText(`Observed: ${OBSERVED}`)).toBeInTheDocument();
    }
    expect(mocks.live).toHaveBeenCalledOnce();
    expect(mocks.live).toHaveBeenLastCalledWith(42, { refetchInterval: 5_000 });
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    expect(mocks.refreshLive).toHaveBeenCalledOnce();
    expect(mocks.refreshVehicles).not.toHaveBeenCalled();
  });

  it.each(packs)('%s keeps all compact sections and successful-empty context honest in %s', async (pack, appearance) => {
    const view = render(tree(pack, compact));
    await presentation(view.container, appearance);
    preservedSections();
    expect(setting('Charge').getByText('Percent')).toBeInTheDocument();
    expect(screen.queryByText('SettingChargeUnit')).not.toBeInTheDocument();

    mocks.live.mockReturnValue(query({ vehicle_id: 42, signals: {}, at: new Date(NOW).toISOString() }, mocks.refreshLive));
    view.rerender(tree(pack, compact));
    preservedSections();
    expect(screen.getByText('No unit-setting observations are available for this vehicle.')).toBeInTheDocument();
    for (const [, label] of fields) {
      expect(setting(label).getByText('Unknown')).toBeInTheDocument();
      expect(setting(label).getByText('Not observed')).toBeInTheDocument();
      expect(setting(label).getByText('Observed: Unknown')).toBeInTheDocument();
    }
    expect(screen.queryByText('Fresh observation')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('keeps Classic as default and invalid-pack recovery while switching all seven presentations and sizes', async () => {
    const view = render(tree());
    preservedSections();
    expect(view.container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    for (const [pack, appearance] of packs) {
      view.rerender(tree(pack, compact));
      await presentation(view.container, appearance);
      preservedSections();
      expect(setting('Tire pressure').getByText('PSI')).toBeInTheDocument();
      view.rerender(tree(pack, full));
      expect(setting('Tire pressure').getByText('SettingTirePressureUnit')).toBeInTheDocument();
    }
    for (const pack of ['classic', 'retired-pack']) {
      view.rerender(tree(pack));
      preservedSections();
      expect(view.container.querySelector('[data-widget-family]')).toBeNull();
      expect(setting('Distance').getByText('Kilometers')).toBeInTheDocument();
    }
  });

  it('shows source enum preferences, not converted measurements, and accepts a real zero observation age', async () => {
    const values = {
      SettingDistanceUnit: 'Miles', SettingTemperatureUnit: 'Celsius',
      SettingTirePressureUnit: 'Bar', SettingChargeUnit: 'Distance',
    } as const;
    mocks.live.mockReturnValue(query({
      vehicle_id: 42, signals: Object.fromEntries(fields.map(([field]) => [
        field, { kind: 'ValueKindEnum', value: values[field], ts: new Date(NOW).toISOString(), source: 'l1', age_ms: 0 },
      ])),
    }, mocks.refreshLive));
    const view = render(tree('v2'));
    await presentation(view.container, 'elevated');
    fields.forEach(([field, label]) => expect(setting(label).getByText(values[field])).toBeInTheDocument());
    expect(screen.getAllByText('Fresh observation')).toHaveLength(4);
    expect(screen.getByText('Normalization context: Unknown')).toBeInTheDocument();
  });

  it.each([
    ['ValueKindEnum', 'Unknown'],
    ['ValueKindEnum', 'DistanceUnitMiles'],
    ['ValueKindString', 'Miles'],
  ] as const)('does not guess context for %s / %s', (kind, value) => {
    mocks.live.mockReturnValue(query({
      ...snapshot(), signals: {
        ...snapshot().signals,
        SettingDistanceUnit: { kind, value, ts: OBSERVED, source: 'l1', age_ms: 10_000 },
      },
    }, mocks.refreshLive));
    render(tree());
    expect(setting('Distance').getByText('Unknown')).toBeInTheDocument();
    expect(setting('Distance').getByText('Unknown context')).toBeInTheDocument();
    expect(setting('Distance').queryByText('Fresh observation')).not.toBeInTheDocument();
  });

  it('does not reinterpret invalid enums, missing timestamps, legacy freshness or stale values as usable context', async () => {
    mocks.live.mockReturnValue(query({
      vehicle_id: 42, signals: {
        SettingDistanceUnit: { kind: 'ValueKindEnum', value: 0, ts: OBSERVED, source: 'l1', age_ms: 10_000 },
        SettingTemperatureUnit: { kind: 'ValueKindEnum', value: 'Celsius', ts: '', source: 'l2' },
        SettingTirePressureUnit: { kind: 'ValueKindEnum', value: 'Bar', ts: new Date(NOW - 180_000).toISOString(), source: 'stale', age_ms: 180_000 },
        SettingChargeUnit: { kind: 'ValueKindEnum', value: 'Distance', ts: new Date(NOW + 1_000).toISOString(), source: 'l1', age_ms: -1_000 },
      },
    }, mocks.refreshLive));
    const view = render(tree('v7'));
    await presentation(view.container, 'pixel');
    preservedSections();
    expect(setting('Distance').getByText('Unknown context')).toBeInTheDocument();
    expect(setting('Distance').getByText('Unknown')).toBeInTheDocument();
    expect(setting('Temperature').getByText('Celsius')).toBeInTheDocument();
    expect(setting('Temperature').getByText('Freshness unknown')).toBeInTheDocument();
    expect(setting('Tire pressure').getByText('Bar')).toBeInTheDocument();
    expect(setting('Tire pressure').getByText('Stale observation')).toBeInTheDocument();
    expect(setting('Charge').getByText('Freshness unknown')).toBeInTheDocument();
    expect(setting('Charge').getByText('Observed: Unknown')).toBeInTheDocument();
    expect(screen.queryByText('Fresh observation')).not.toBeInTheDocument();
  });

  it.each(['error', 'paused'] as const)('retains settings with an honest %s notice and independent retry', async condition => {
    mocks.live.mockReturnValue(query(snapshot(), mocks.refreshLive, {
      error: condition === 'error' ? new Error('synthetic refresh outage') : null,
      isError: condition === 'error', fetchStatus: condition === 'paused' ? 'paused' : 'idle',
    }));
    const view = render(tree('v4'));
    await presentation(view.container, 'owner');
    preservedSections();
    expect(view.container.querySelector('[data-data-state="stale"]')).not.toBeNull();
    expect(screen.getByText(retainedNotice)).toBeInTheDocument();
    expect(screen.getAllByText('Retained observation')).toHaveLength(4);
    expect(setting('Distance').getByText('Kilometers')).toBeInTheDocument();
    expect(screen.queryByText('Fresh observation')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refreshLive).toHaveBeenCalledOnce();
    expect(mocks.refreshVehicles).not.toHaveBeenCalled();
  });

  it('keeps every section during first loading/failure and disables duplicate refresh while in flight', async () => {
    mocks.live.mockReturnValue(query<VehicleLiveSignalsResponse>(undefined, mocks.refreshLive, {
      isLoading: true, isPending: true, isSuccess: false, isFetching: true, dataUpdatedAt: 0,
    }));
    const view = render(tree('v1'));
    await presentation(view.container, 'studio');
    preservedSections();
    expect(screen.getByRole('status', { name: 'Loading Signal unit context' })).toBeInTheDocument();
    expect(view.container.querySelector('[data-data-state="initial"]')).not.toBeNull();
    const refresh = screen.getByRole('button', { name: /^Refresh data/i });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(mocks.refreshLive).not.toHaveBeenCalled();
    expect(screen.queryByText('Not observed')).not.toBeInTheDocument();

    mocks.live.mockReturnValue(query<VehicleLiveSignalsResponse>(undefined, mocks.refreshLive, {
      isError: true, error: new Error('synthetic initial outage'), dataUpdatedAt: 0,
    }));
    view.rerender(tree('v1'));
    preservedSections();
    expect(screen.getByText('Unit-setting evidence could not be loaded.')).toBeInTheDocument();
    expect(view.container.querySelector('[data-data-state="initialFailure"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refreshLive).toHaveBeenCalledOnce();
  });

  it('honors explicit/configured vehicle scope and never displays another vehicle’s retained settings', async () => {
    const view = render(tree('v3', full, { config: { vehicleId: 8 } }));
    await presentation(view.container, 'precision');
    expect(mocks.live).toHaveBeenLastCalledWith(8, { refetchInterval: 5_000 });
    expect(setting('Distance').getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('Kilometers')).not.toBeInTheDocument();
    view.rerender(tree('v3', full, { vehicleId: 42, config: { vehicleId: 8 } }));
    expect(setting('Distance').getByText('Kilometers')).toBeInTheDocument();
    expect(mocks.live).toHaveBeenLastCalledWith(42, { refetchInterval: 5_000 });
    mocks.live.mockReturnValue(query(snapshot(7), mocks.refreshLive));
    view.rerender(tree('v3', full, {}));
    expect(mocks.live).toHaveBeenLastCalledWith(7, { refetchInterval: 5_000 });
    expect(setting('Distance').getByText('Kilometers')).toBeInTheDocument();
  });

  it('keeps no-vehicle context unknown and refreshes vehicle discovery rather than a disabled signal query', async () => {
    mocks.vehicles.mockReturnValue(query([], mocks.refreshVehicles));
    const view = render(tree('v5', compact, {}));
    await presentation(view.container, 'iconic');
    preservedSections();
    expect(screen.getByText('Select a vehicle to inspect its unit context.')).toBeInTheDocument();
    expect(mocks.live).toHaveBeenLastCalledWith(undefined, { refetchInterval: 5_000 });
    expect(screen.queryByText('Kilometers')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    expect(mocks.refreshVehicles).toHaveBeenCalledOnce();
    expect(mocks.refreshLive).not.toHaveBeenCalled();
  });
});
