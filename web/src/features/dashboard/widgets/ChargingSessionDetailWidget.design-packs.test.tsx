import type { ComponentProps, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ChargingSession as ApiChargingSession, ChargeTelemetryReading } from '@/api/types';
import type { DataStateSource } from '@/api/dataState';
import type { ChargingSession } from '@/types/charging';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { formatTime } from '@/lib/dateFormat';
import ChargingSessionDetailWidget from './ChargingSessionDetailWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, type PackId } from './designPacks/types';

const presentationPackIds = Object.keys(PACK_APPEARANCES) as Exclude<PackId, 'classic'>[];

const mocks = vi.hoisted(() => ({
  sessions: vi.fn(),
  detail: vi.fn(),
  telemetry: vi.fn(),
  retrySessions: vi.fn(),
  retryDetail: vi.fn(),
  retryTelemetry: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: [{ id: 7 }] }),
}));
vi.mock('@/api/hooks/useCharging', () => ({
  useChargingSessions: mocks.sessions,
  useChargingSessionDetail: mocks.detail,
  useChargeTelemetry: mocks.telemetry,
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

// Supply jsdom's missing plot dimensions; retain the real chart, legend,
// accessible table, source boundaries and lazily loaded pack presentation.
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { cloneElement } = await import('react');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: ComponentProps<typeof actual.ResponsiveContainer>) =>
      cloneElement(children as ReactElement<{ width?: number; height?: number }>, { width: 640, height: 224 }),
  };
});

const detail: ApiChargingSession = {
  id: 701,
  vehicle_id: 7,
  started_at: '2026-10-03T12:50:00Z',
  startedAt: '2026-10-03T12:50:00Z',
  ended_at: '2026-10-03T16:50:00Z',
  start_soc_pct: 30,
  end_soc_pct: 72,
  delta_soc_pct: 42,
  start_odometer_m: null,
  end_odometer_m: null,
  start_lat: null,
  start_lng: null,
  start_place: 'Home',
  total_energy_added_wh: 42_000,
  peak_power_w: 11_000,
  avg_power_w: 10_500,
  cost_decimal: null,
  cost_currency: null,
  charger_type: 'AC',
  cable_type: 'IEC',
  duration_s: 14_400,
  live: false,
};
const session: ChargingSession = {
  ...detail,
  id: String(detail.id),
  vehicle_id: String(detail.vehicle_id),
  start_ts: detail.started_at,
  duration_min: 240,
};

function reading(created_at: string, power_w: number | null, battery_level: number | null): ChargeTelemetryReading {
  return {
    session_id: detail.id,
    vehicle_id: detail.vehicle_id,
    ts: created_at,
    created_at,
    power_w,
    battery_level,
    soc: null,
    ac_charging_power_w: power_w,
    dc_charging_power_w: null,
    ac_charging_energy_in_wh: null,
    dc_charging_energy_in_wh: null,
    charger_voltage_v: null,
    charger_actual_current_a: null,
    charger_pilot_current_a: null,
    charger_phases: null,
    battery_heater_on: null,
    battery_heater_power_w: null,
    charge_limit_soc_pct: null,
    charge_request: null,
    fast_charger_type: null,
    charging_cable_type: null,
    charge_port_door_open: null,
    charge_port_latch: null,
  };
}
const samples = [
  reading(detail.started_at, 10_000, 30),
  reading('2026-10-03T14:50:00Z', null, null),
  reading(detail.ended_at!, 11_000, 72),
];
const sampleTimes = samples.map(sample => formatTime(sample.created_at, { locale: 'en-US', tz: 'UTC' }));

function query<T>(data: T | undefined, refetch: () => unknown, overrides: Partial<DataStateSource<T>> = {}) {
  return {
    data, refetch, isLoading: false, isFetching: false, isError: false,
    isStale: false, error: null, dataUpdatedAt: Date.now(), ...overrides,
  };
}

function widget(packId: PackId | string, cols = 3) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <ChargingSessionDetailWidget vehicleId={42} size={{ cols, rows: 4 }} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function mount(packId: Exclude<PackId, 'classic'>, cols = 3) {
  const view = render(widget(packId, cols));
  await waitFor(() => expect(view.container.querySelector(
    `[data-widget-family="line"][data-widget-appearance="${PACK_APPEARANCES[packId]}"]`,
  )).toBeInTheDocument());
  return view;
}

function sourceTable() {
  return screen.getByRole('table', { name: 'Charge session detail — data table' });
}

beforeEach(() => {
  vi.clearAllMocks();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: (label: string) => ({ width: label.length * 6 }),
  } as unknown as CanvasRenderingContext2D);
  mocks.sessions.mockReturnValue(query([session], mocks.retrySessions));
  mocks.detail.mockReturnValue(query(detail, mocks.retryDetail));
  mocks.telemetry.mockReturnValue(query(samples, mocks.retryTelemetry));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

describe.each(presentationPackIds)('charging-session-detail %s', packId => {
  it('retains the real dual-axis plot, every sample and summary, selected vehicle and refresh action', async () => {
    const { container } = await mount(packId);
    expect(container.querySelector('[data-role="widget-header-title"]')).toHaveAccessibleName('Charge session detail');
    expect(screen.getByText('Last sampled power')).toBeInTheDocument();
    expect(screen.getByText('42.0')).toBeInTheDocument();
    expect(screen.getByText('Energy added')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('4h')).toBeInTheDocument();
    expect(screen.getByText('Peak power')).toBeInTheDocument();
    expect(screen.getAllByText('11.0')).toHaveLength(2);
    expect(screen.getByText('AC')).toBeInTheDocument();
    expect(screen.getByText(/Home ·/)).toBeInTheDocument();
    expect(container.querySelector('.lucide-zap')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();

    const table = sourceTable();
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent))
      .toEqual(['Time', 'Power (kW)', 'SOC %']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map(row => within(row).getAllByRole('cell').map(cell => cell.textContent)))
      .toEqual([[sampleTimes[0], '10', '30'], [sampleTimes[1], '—', '—'], [sampleTimes[2], '11', '72']]);
    expect(container.querySelector('[data-chart-key="dashboard-charging-session-detail"]')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('.recharts-line-curve')).toHaveAttribute('stroke-dasharray', '4 3'), { timeout: 3000 });
    expect(container.querySelectorAll('.recharts-yAxis')).toHaveLength(2);
    expect(container.querySelectorAll('.recharts-yAxis')[1]).toHaveTextContent('100.00%');

    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    expect(mocks.retrySessions).toHaveBeenCalledOnce();
    expect(mocks.retryDetail).toHaveBeenCalledOnce();
    expect(mocks.retryTelemetry).toHaveBeenCalledOnce();
    expect(mocks.sessions).toHaveBeenCalledWith('42');
    expect(mocks.detail).toHaveBeenCalledWith(701);
    expect(mocks.telemetry).toHaveBeenCalledWith(701);
    expect(detail.total_energy_added_wh).toBe(42_000);
    expect(samples[0].power_w).toBe(10_000);
  });

  it('preserves the compact energy readout without mounting a hidden plot or stat grid', async () => {
    const { container } = await mount(packId, 1);
    expect(screen.getByText('42.0')).toBeInTheDocument();
    expect(screen.getByText('kWh added')).toBeInTheDocument();
    expect(screen.getByText('AC')).toBeInTheDocument();
    expect(screen.queryByText('Last sampled power')).not.toBeInTheDocument();
    expect(screen.queryByText('Peak power')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(container.querySelector('.recharts-wrapper')).not.toBeInTheDocument();
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
  });

  it('keeps the final source gap unknown instead of reusing an older power reading', async () => {
    mocks.detail.mockReturnValue(query({ ...detail, charger_type: null }, mocks.retryDetail));
    mocks.telemetry.mockReturnValue(query([
      samples[0],
      reading(detail.ended_at!, null, 72),
    ], mocks.retryTelemetry));
    await mount(packId, 2);
    const headline = screen.getByText('Last sampled power').closest('.widget-big-number');
    expect(headline).toHaveTextContent('—');
    expect(headline).not.toHaveTextContent('10.0');
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('AC')).not.toBeInTheDocument();
    const rows = within(sourceTable()).getAllByRole('row').slice(1);
    expect(within(rows[1]).getAllByRole('cell').map(cell => cell.textContent))
      .toEqual([sampleTimes[2], '—', '72']);
  });

  it('keeps invalid measurements unknown without replacing them with zero', async () => {
    mocks.detail.mockReturnValue(query({
      ...detail,
      total_energy_added_wh: Number.NaN,
      duration_s: -60,
      peak_power_w: Number.POSITIVE_INFINITY,
      charger_type: '<invalid>',
    }, mocks.retryDetail));
    mocks.telemetry.mockReturnValue(query([
      reading(detail.started_at, Number.POSITIVE_INFINITY, Number.NaN),
      reading(detail.ended_at!, Number.NaN, Number.NEGATIVE_INFINITY),
    ], mocks.retryTelemetry));
    await mount(packId);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('Last sampled power').closest('.widget-big-number')).toHaveTextContent('—');
    for (const label of ['Energy added', 'Duration', 'Peak power']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText('—')).toHaveLength(8);
    const rows = within(sourceTable()).getAllByRole('row').slice(1);
    expect(rows.map(row => within(row).getAllByRole('cell').slice(1).map(cell => cell.textContent)))
      .toEqual([['—', '—'], ['—', '—']]);
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
  });

  it('keeps the telemetry and summary shells visible for an empty session list', async () => {
    mocks.sessions.mockReturnValue(query([], mocks.retrySessions));
    mocks.detail.mockReturnValue(query<ApiChargingSession>(undefined, mocks.retryDetail));
    mocks.telemetry.mockReturnValue(query([], mocks.retryTelemetry));
    await mount(packId);
    expect(screen.getByText('No charge sessions')).toBeInTheDocument();
    expect(screen.getByText('No charging telemetry is available for this session')).toBeInTheDocument();
    expect(screen.getByText('Energy added')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Peak power')).toBeInTheDocument();
    expect(screen.getByText('Last sampled power').closest('.widget-big-number')).toHaveTextContent('—');
    expect(screen.queryByText('0.0')).not.toBeInTheDocument();
    expect(mocks.detail).toHaveBeenCalledWith(null);
    expect(mocks.telemetry).toHaveBeenCalledWith(null);
  });
});

it.each(['classic', 'unrecognized-pack'])('preserves the original layout for %s', packId => {
  const { container } = render(widget(packId));
  expect(container.querySelector('[data-widget-pack="classic"]')).toBeInTheDocument();
  expect(container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
  expect(screen.queryByText('Last sampled power')).not.toBeInTheDocument();
  expect(screen.getByText('42.0')).toBeInTheDocument();
  expect(screen.getByText('11.0')).toBeInTheDocument();
  expect(within(sourceTable()).getAllByRole('row')).toHaveLength(4);
});

it.each(presentationPackIds)('retains the legend selection when switching to %s without refetching source data', async packId => {
  const view = await mount('v1');
  const legend = await screen.findByRole('button', { name: 'SOC %' });
  fireEvent.click(legend);
  expect(screen.getByRole('button', { name: 'SOC %' })).toHaveAttribute('aria-pressed', 'true');
  view.rerender(widget(packId));
  await waitFor(() => expect(view.container.querySelector(`[data-widget-appearance="${PACK_APPEARANCES[packId]}"]`)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'SOC %' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(sourceTable()).getAllByRole('row')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'SOC %' }));
  expect(screen.getByRole('button', { name: 'SOC %' })).toHaveAttribute('aria-pressed', 'false');
  expect(mocks.retrySessions).not.toHaveBeenCalled();
  expect(mocks.retryDetail).not.toHaveBeenCalled();
  expect(mocks.retryTelemetry).not.toHaveBeenCalled();
});

it.each(presentationPackIds)('%s preserves signed and measured-zero readings during a failed background refresh', async packId => {
  mocks.detail.mockReturnValue(query({ ...detail, total_energy_added_wh: 0 }, mocks.retryDetail));
  mocks.telemetry.mockReturnValue(query([
    reading(detail.started_at, -2_000, 30),
    reading(detail.ended_at!, 0, 72),
  ], mocks.retryTelemetry, { error: new Error('Refresh failed'), isError: true }));
  await mount(packId);
  expect(screen.getAllByTestId('stale-refresh-warning').length).toBeGreaterThan(0);
  expect(screen.getByText('Previously loaded charging telemetry remains visible while it refreshes.')).toBeInTheDocument();
  const rows = within(sourceTable()).getAllByRole('row').slice(1);
  expect(rows.map(row => within(row).getAllByRole('cell')[1].textContent)).toEqual(['-2', '0']);
  expect(screen.getByText('Last sampled power').closest('.widget-big-number')).toHaveTextContent('0.0');
  expect(screen.queryByText('Charging telemetry could not be loaded.')).not.toBeInTheDocument();
});

it.each(presentationPackIds)('%s keeps ready summary data while telemetry loads or fails and retries only the failed source', async packId => {
  mocks.telemetry.mockReturnValue(query<ChargeTelemetryReading[]>(undefined, mocks.retryTelemetry, {
    isLoading: true,
  }));
  const view = await mount(packId);
  expect(screen.getByRole('status', { name: 'Loading Charging telemetry' })).toBeInTheDocument();
  expect(screen.getByText('42.0')).toBeInTheDocument();
  mocks.telemetry.mockReturnValue(query<ChargeTelemetryReading[]>(undefined, mocks.retryTelemetry, {
    error: new Error('Source unavailable'), isError: true,
  }));
  view.rerender(widget(packId));
  expect(screen.getByText('Charging telemetry could not be loaded.')).toBeInTheDocument();
  expect(screen.getByText('42.0')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  expect(mocks.retryTelemetry).toHaveBeenCalledOnce();
  expect(mocks.retryDetail).not.toHaveBeenCalled();
  expect(mocks.retrySessions).not.toHaveBeenCalled();
});

it.each(presentationPackIds)('%s does not allow a refresh to duplicate an in-flight request', async packId => {
  mocks.detail.mockReturnValue(query(detail, mocks.retryDetail, { isFetching: true }));
  await mount(packId);
  const refresh = screen.getByRole('button', { name: /^Refresh data/ });
  expect(refresh).toBeDisabled();
  fireEvent.click(refresh);
  expect(mocks.retrySessions).not.toHaveBeenCalled();
  expect(mocks.retryDetail).not.toHaveBeenCalled();
  expect(mocks.retryTelemetry).not.toHaveBeenCalled();
});
