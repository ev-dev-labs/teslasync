import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { VehicleLiveSignal, VehicleLiveSignalsResponse } from '@/api/hooks/useTelemetry';
import type { WidgetConfig } from './types';
import type { PackId } from './designPacks/types';
import { PackBoundary } from './designPacks/PackBoundary';
import CabinComfortWidget from './CabinComfortWidget';

const { requestMock, preferences } = vi.hoisted(() => ({
  requestMock: vi.fn<(path: string) => Promise<unknown>>(),
  preferences: { temperature: 'F' },
}));
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: requestMock,
}));
vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/setup');
  return createReactI18nextMock();
});
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { unit_of_temp: preferences.temperature, unit_of_length: 'km', decimal_precision: 1, locale: 'en-US' },
    locale: 'en-US',
  }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));
vi.mock('@/hooks/useDateFormat', () => {
  const format = (value: string | number | Date | null | undefined) => value == null ? '—' : new Date(value).toISOString();
  return { useDateFormat: () => ({
    formatDateTime: format, formatRelativeTime: format, formatRelative: format, formatTime: format,
  }) };
});

const NOW = Date.parse('2026-11-07T02:00:00Z');
const OBSERVED = '2026-11-07T01:59:50Z';
const PACKS = [
  ['v1', 'studio'], ['v2', 'elevated'], ['v3', 'precision'], ['v4', 'owner'],
  ['v5', 'iconic'], ['v6', 'expressive'], ['v7', 'pixel'],
] as const;
const SECTIONS = ['Reported temperatures', 'Front seat climate', 'Occupancy and belts', 'Ventilation', 'Observation limits'];
const FIELDS = [
  'InsideTemp', 'OutsideTemp', 'DriverSeatOccupied', 'DriverSeatBelt', 'PassengerSeatBelt',
  'SeatHeaterLeft', 'SeatHeaterRight', 'ClimateSeatCoolingFrontLeft', 'ClimateSeatCoolingFrontRight', 'HvacFanSpeed',
];
let client: QueryClient;
let live: VehicleLiveSignalsResponse;
let failLive: boolean;
let failVehicles: boolean;

function envelope(value: unknown, kind = 'ValueKindFloat', overrides: Partial<VehicleLiveSignal> = {}): VehicleLiveSignal {
  return { value, kind, ts: OBSERVED, timestamp: OBSERVED, source: 'l1', age_ms: 10_000, ...overrides };
}

function tree(pack: PackId = 'v1', cols = 2, vehicleId: number | null = 7, config?: WidgetConfig) {
  return <QueryClientProvider client={client}><MemoryRouter><PackBoundary requestedPackId={pack}>
    <CabinComfortWidget vehicleId={vehicleId ?? undefined} size={{ cols, rows: cols === 1 ? 2 : 5 }} config={config} />
  </PackBoundary></MemoryRouter></QueryClientProvider>;
}

function signal(field: string) {
  const element = document.querySelector(`[data-cabin-signal="${field}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing signal: ${field}`);
  return element;
}

function sections() {
  for (const name of SECTIONS) expect(screen.getByRole('region', { name })).toBeInTheDocument();
  for (const field of FIELDS) expect(signal(field)).toBeInTheDocument();
}

async function settled() {
  await waitFor(() => expect(client.isFetching()).toBe(0), { timeout: 10_000 });
}

async function presentation(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector('[data-widget-family="climate"]'))
    .toHaveAttribute('data-widget-appearance', appearance));
  await settled();
}

describe('CabinComfortWidget production design packs', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    requestMock.mockReset();
    preferences.temperature = 'F';
    failLive = false;
    failVehicles = false;
    live = { vehicle_id: 7, at: OBSERVED, signals: {
      InsideTemp: envelope(20), OutsideTemp: envelope(-10),
      DriverSeatOccupied: envelope(true, 'ValueKindBool'),
      DriverSeatBelt: envelope(true, 'ValueKindBool'),
      SeatHeaterLeft: envelope(1), SeatHeaterRight: envelope(0),
      ClimateSeatCoolingFrontLeft: envelope(0), ClimateSeatCoolingFrontRight: envelope(2),
      HvacFanSpeed: envelope(3),
    } };
    client = new QueryClient({ defaultOptions: { queries: {
      retry: false, gcTime: Infinity, refetchOnWindowFocus: false,
    } } });
    requestMock.mockImplementation(async path => {
      if (path === '/vehicles') {
        if (failVehicles) throw new Error('Vehicle inventory failed');
        return [];
      }
      if (/^\/signals\/\d+\/live$/.test(path)) {
        if (failLive) throw new Error('Cabin source failed');
        return live;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
    client.clear();
    vi.restoreAllMocks();
  });

  it.each(PACKS)('%s preserves real reported data, spatial seat positions, unknown passenger evidence and refresh', async (pack, appearance) => {
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    sections();
    expect(signal('InsideTemp')).toHaveTextContent('68.0°F');
    expect(signal('InsideTemp').querySelector('[data-climate-readout]')).toHaveAttribute('data-climate-readout', appearance);
    expect(view.container).not.toHaveTextContent('Never updated');
    expect(screen.getAllByRole('button', { name: /Refresh/ })).toHaveLength(1);
    expect(signal('OutsideTemp')).toHaveTextContent('14.0°F');
    expect(signal('DriverSeatOccupied')).toHaveTextContent('Occupied');
    expect(signal('DriverSeatBelt')).toHaveTextContent('Buckled');
    expect(signal('PassengerSeatBelt')).toHaveTextContent('Unknown');
    expect(signal('SeatHeaterLeft')).toHaveTextContent(/Level 1(?:\.0)?/);
    expect(signal('SeatHeaterRight')).toHaveTextContent(/Level 0(?:\.0)?/);
    expect(signal('ClimateSeatCoolingFrontRight')).toHaveTextContent(/Level 2(?:\.0)?/);
    expect(signal('HvacFanSpeed')).toHaveTextContent(/Level 3(?:\.0)?/);
    expect(signal('DriverSeatBelt')).toHaveTextContent(`Observed: ${OBSERVED.replace('Z', '.000Z')} · Source: l1`);
    expect(within(screen.getByRole('group', { name: 'Front left' })).getByText('Seat heat')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Front right' })).getByText('Seat cooling')).toBeInTheDocument();
    expect(view.container.querySelector('[data-instrument-family="climate"] .lucide-thermometer')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText(/Passenger occupancy is unknown/)).toBeInTheDocument();
    expect(screen.getByText(/both remain unknown/)).toBeInTheDocument();

    live = { ...live, signals: { ...live.signals,
      DriverSeatOccupied: envelope(false, 'ValueKindBool'),
      DriverSeatBelt: envelope(false, 'ValueKindBool'),
    } };
    fireEvent.click(screen.getByRole('button', { name: 'Refresh cabin observations' }));
    await waitFor(() => expect(signal('DriverSeatOccupied')).toHaveTextContent('Unoccupied'));
    await settled();
    expect(signal('DriverSeatBelt')).toHaveTextContent('Unbuckled');
    expect(requestMock.mock.calls.filter(([path]) => path === '/signals/7/live')).toHaveLength(2);
    expect(requestMock.mock.calls.every(([path]) => path === '/vehicles' || path === '/signals/7/live')).toBe(true);
  });

  it.each(PACKS)('%s keeps every source shell and unknown state when only unrelated signals were reported', async (pack, appearance) => {
    live = { vehicle_id: 7, signals: { BatteryLevel: envelope(75) } };
    const view = render(tree(pack, 1));
    await presentation(view.container, appearance);
    sections();
    expect(screen.getByText('No reported cabin signals. Missing readings remain unknown.')).toBeInTheDocument();
    for (const field of FIELDS) {
      expect(signal(field)).toHaveTextContent('Unknown');
      expect(signal(field)).not.toHaveTextContent('Level 0');
      expect(signal(field)).not.toHaveTextContent('Fresh observation');
    }
    expect(screen.queryByText('Unoccupied', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Buckled', { exact: true })).not.toBeInTheDocument();
  });

  it('switches Classic, seven packs and compact/full without remounting the live reader', async () => {
    const view = render(tree('classic', 1));
    await settled();
    sections();
    expect(signal('InsideTemp')).toHaveTextContent('68.0°F');
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-climate-readout]')).not.toBeInTheDocument();
    const count = requestMock.mock.calls.length;
    for (const [pack, appearance] of PACKS) {
      view.rerender(tree(pack, pack === 'v1' ? 1 : 3));
      await presentation(view.container, appearance);
      sections();
      expect(signal('DriverSeatBelt')).toHaveTextContent('Buckled');
    }
    preferences.temperature = 'C';
    view.rerender(tree('classic', 3));
    await waitFor(() => expect(signal('InsideTemp')).toHaveTextContent('20.0°C'));
    expect(signal('OutsideTemp')).toHaveTextContent('-10.0°C');
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-cabin-compact]')).toHaveAttribute('data-cabin-compact', 'false');
    expect(requestMock).toHaveBeenCalledTimes(count);
  });

  it('distinguishes per-field stale, unknown freshness, historical and valid zero evidence', async () => {
    live = { vehicle_id: 7, signals: {
      InsideTemp: envelope(0),
      OutsideTemp: envelope(-15, 'ValueKindFloat', { ts: '2026-11-07T01:50:00Z' }),
      DriverSeatOccupied: envelope(false, 'ValueKindBool', { ts: '', timestamp: '', source: 'l2', age_ms: undefined }),
      DriverSeatBelt: envelope('Faulted', 'ValueKindEnum'),
      PassengerSeatBelt: envelope(true, 'ValueKindBool', { source: 'log' }),
      HvacFanSpeed: envelope(0, 'ValueKindFloat', { age_ms: 180_000 }),
    } };
    render(tree());
    await settled();
    expect(signal('InsideTemp')).toHaveTextContent('32.0°F');
    expect(signal('InsideTemp')).toHaveTextContent('Fresh observation');
    expect(signal('OutsideTemp')).toHaveTextContent('Stale reading');
    expect(signal('DriverSeatOccupied')).toHaveTextContent('Unoccupied');
    expect(signal('DriverSeatOccupied')).toHaveTextContent('Freshness unknown');
    expect(signal('DriverSeatBelt')).toHaveTextContent('Unknown or invalid reading');
    expect(signal('PassengerSeatBelt')).toHaveTextContent('Historical fallback');
    expect(signal('HvacFanSpeed')).toHaveTextContent(/Level 0(?:\.0)?/);
    expect(signal('HvacFanSpeed')).toHaveTextContent('Stale reading');
  });

  it('does not coerce invalid scalars, wrong kinds, or prefixed enum strings into success', async () => {
    live = { vehicle_id: 7, signals: {
      InsideTemp: envelope(Number.NaN), OutsideTemp: envelope(Number.POSITIVE_INFINITY),
      DriverSeatOccupied: envelope('false', 'ValueKindBool'),
      DriverSeatBelt: envelope('BuckleStatusLatched', 'ValueKindEnum'),
      PassengerSeatBelt: envelope('true', 'ValueKindBool'),
      SeatHeaterLeft: envelope(-1), SeatHeaterRight: envelope('0'),
      ClimateSeatCoolingFrontLeft: 0,
      ClimateSeatCoolingFrontRight: envelope(2, 'ValueKindString'),
      HvacFanSpeed: envelope(null),
    } };
    render(tree('v7'));
    await settled();
    for (const field of FIELDS) expect(signal(field)).toHaveTextContent('Unknown or invalid reading');
    expect(screen.queryByText('Buckled', { exact: true })).not.toBeInTheDocument();
  });

  it('keeps all sections while initially loading, then exposes first-failure retry and recovery', async () => {
    requestMock.mockImplementation(async path => path === '/vehicles' ? []
      : new Promise<VehicleLiveSignalsResponse>(() => undefined));
    const view = render(tree('v3'));
    await waitFor(() => expect(screen.getByText('Loading cabin observations…')).toBeInTheDocument());
    sections();
    view.unmount();
    client.clear();
    failLive = true;
    requestMock.mockImplementation(async path => {
      if (path === '/vehicles') return [];
      if (failLive) throw new Error('Cabin source failed');
      return live;
    });
    render(tree('v3'));
    await screen.findByRole('button', { name: 'Retry' });
    sections();
    expect(signal('InsideTemp')).not.toHaveTextContent('68.0°F');
    failLive = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(signal('InsideTemp')).toHaveTextContent('68.0°F'));
    await settled();
  });

  it.each(PACKS)('%s retains measurements with a failed-refresh warning rather than reporting them fresh', async (pack, appearance) => {
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    failLive = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh cabin observations' }));
    await screen.findByTestId('stale-refresh-warning');
    await settled();
    sections();
    expect(signal('InsideTemp')).toHaveTextContent('68.0°F');
    expect(signal('InsideTemp')).toHaveTextContent('Retained reading');
    expect(signal('DriverSeatBelt')).toHaveTextContent('Buckled');
    expect(signal('DriverSeatBelt')).not.toHaveTextContent('Fresh observation');
  });

  it('uses the configured vehicle, ignores an unrelated vehicle-list failure, and rejects mismatched payloads', async () => {
    failVehicles = true;
    const view = render(tree('v1', 2, null, { vehicleId: 7 }));
    await presentation(view.container, 'studio');
    expect(signal('InsideTemp')).toHaveTextContent('68.0°F');
    expect(requestMock.mock.calls.some(([path]) => path === '/signals/7/live')).toBe(true);
    live = { ...live, vehicle_id: 9 };
    fireEvent.click(screen.getByRole('button', { name: 'Refresh cabin observations' }));
    await waitFor(() => expect(signal('InsideTemp')).toHaveTextContent('Unknown'));
    expect(signal('InsideTemp')).not.toHaveTextContent('68.0°F');
  });

  it('does not request a live endpoint without a selected vehicle', async () => {
    render(tree('classic', 1, 0));
    await screen.findByText('Select a vehicle to view reported cabin observations.');
    await settled();
    sections();
    expect(requestMock.mock.calls.map(([path]) => path)).toEqual(['/vehicles']);
  });
});
