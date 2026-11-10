import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ClimateSnapshot } from '@/api/types';
import { setGlobalLocale } from '@/lib/numberFormat';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, type PackId } from './designPacks/types';
import type { WidgetSize } from './types';

const source = vi.hoisted(() => ({
  temperature: '°C' as '°C' | '°F',
  vehicles: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useVehicles')>(),
  useVehicles: () => source.vehicles(),
}));
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: vi.fn(),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { temperature: source.temperature } }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (value: unknown) => String(value) }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key).replace(
        /\{\{(\w+)\}\}/g,
        (match: string, name: string) => String(options?.[name] ?? match),
      ),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

import { request } from '@/api/client';
import ClimateControlPanelWidget from './ClimateControlPanelWidget';

const mockedRequest = vi.mocked(request);
const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const packs = Object.entries(PACK_APPEARANCES) as [Exclude<PackId, 'classic'>, string][];
const clients: QueryClient[] = [];

function climate(overrides: Partial<ClimateSnapshot> = {}): ClimateSnapshot {
  return {
    vehicle_id: 7, ts: new Date().toISOString(), source: 'signal',
    inside_temp_c: null, outside_temp_c: null,
    driver_setpoint_c: null, passenger_setpoint_c: null,
    hvac_state: null, defrost_mode: null,
    is_climate_on: null, is_preconditioning: null, fan_status: null,
    seat_heater_left: null, seat_heater_right: null,
    seat_heater_rear_left: null, seat_heater_rear_right: null,
    steering_wheel_heater: null, cabin_overheat_protection: null,
    inside_temp: null, outside_temp: null, driver_temp_setting: null,
    hvac_power: null, is_ac_on: null, fan_speed: null,
    hvac_steering_wheel_heat_level: null, battery_heater: null,
    seat_heater_rear_center: null,
    ...overrides,
  };
}

function fullClimate(): ClimateSnapshot {
  return climate({
    inside_temp_c: 21, outside_temp_c: 18, driver_setpoint_c: 22,
    hvac_power: true, is_ac_on: false, fan_speed: 3, defrost_mode: 'Front',
    seat_heater_left: 1, seat_heater_right: 2, seat_heater_rear_left: 0,
    seat_heater_rear_center: 3, seat_heater_rear_right: 0,
    hvac_steering_wheel_heat_level: 2, cabin_overheat_protection: true,
    battery_heater: false,
  });
}

function renderPack(packId: unknown, size = FULL, vehicleId?: number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  clients.push(client);
  const tree = (pack: unknown) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={pack}>
          <ClimateControlPanelWidget size={size} vehicleId={vehicleId} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(packId));
  return { ...view, client, selectPack: (pack: unknown) => view.rerender(tree(pack)) };
}

async function expectAppearance(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector(
    `[data-widget-family="climate"][data-widget-appearance="${appearance}"]`,
  )).not.toBeNull());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequest.mockReset();
  mockedRequest.mockResolvedValue(fullClimate());
  source.temperature = '°C';
  source.vehicles.mockReturnValue({ data: [{ id: 7, display_name: 'Selected car' }] });
  setGlobalLocale('en-US');
});

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

describe.each(packs)('climate control %s (%s)', (packId, appearance) => {
  it('composes the real cabin reading, setpoint, airflow, all statuses and the selected vehicle refresh', async () => {
    mockedRequest.mockResolvedValue({ ...fullClimate(), vehicle_id: 42 });
    const { container } = renderPack(packId, FULL, 42);
    await expectAppearance(container, appearance);

    expect(screen.getByRole('heading', { name: 'Climate control' })).toBeVisible();
    expect(screen.getByText('Inside · set 22°C')).toBeVisible();
    expect(screen.getByText('21')).toBeVisible();
    expect(screen.getByText('°C')).toBeVisible();
    expect(screen.getByText('18°C')).toBeVisible();
    for (const label of [
      'Outside', 'HVAC on', 'Fan 3', 'Defrost', 'Seats', 'FL1/3 · FR2/3 · RC3/3',
      'Steering heat', '2/3', 'Cabin overheat', 'On', 'Battery heater', 'Off',
    ]) expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByText('Climate readings only; no commands are sent.')).toBeVisible();
    expect(container.querySelectorAll('[data-climate-airflow="active"]')).toHaveLength(1);
    expect(container.querySelector('[data-climate-readout]')).toHaveAttribute('data-climate-readout', appearance);
    expect(container.querySelector('[data-widget-family="climate"] .lucide-thermometer')).not.toBeNull();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest.mock.calls[0]?.[0]).toBe('/climate/latest?vehicle_id=42');

    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.getByText('21')).toBeVisible();
    expect(container.querySelectorAll('[data-climate-airflow]')).toHaveLength(1);
  });

  it('keeps every full section visible for unknown and invalid readings without claiming off or zero', async () => {
    mockedRequest.mockResolvedValue(climate({
      inside_temp_c: Number.NaN, outside_temp_c: Infinity, driver_setpoint_c: Infinity,
      fan_speed: -1, seat_heater_left: -1, seat_heater_right: -1,
      seat_heater_rear_left: -1, seat_heater_rear_center: -1, seat_heater_rear_right: -1,
      hvac_steering_wheel_heat_level: -1,
    }));
    const { container } = renderPack(packId);
    await expectAppearance(container, appearance);

    for (const label of ['Inside', 'Outside', 'Seats', 'Steering heat', 'Cabin overheat', 'Battery heater']) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(screen.getByText('HVAC unknown')).toBeVisible();
    expect(screen.getByText('Fan · Unknown')).toBeVisible();
    expect(screen.getByText('Defrost · Unknown')).toBeVisible();
    expect(screen.getAllByText('Unknown')).toHaveLength(4);
    expect(screen.getAllByText('—')).toHaveLength(2);
    for (const fabricated of ['HVAC off', 'HVAC on', 'Off', 'On', '0', '-1/3', 'Fan -1', 'Infinity', 'NaN']) {
      expect(screen.queryByText(fabricated)).not.toBeInTheDocument();
    }
    expect(container.querySelector('[data-climate-airflow]')).toHaveAttribute('data-climate-airflow', 'static');
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('preserves measured zero temperatures and fan speed while distinguishing explicitly off statuses', async () => {
    mockedRequest.mockResolvedValue(climate({
      inside_temp_c: 0, outside_temp_c: 0, driver_setpoint_c: 0,
      hvac_power: false, fan_speed: 0, defrost_mode: 'Off',
      seat_heater_left: 0, seat_heater_right: 0, seat_heater_rear_left: 0,
      seat_heater_rear_center: 0, seat_heater_rear_right: 0,
      hvac_steering_wheel_heat_level: 0, cabin_overheat_protection: false,
      battery_heater: false,
    }));
    const { container } = renderPack(packId);
    await expectAppearance(container, appearance);

    expect(screen.getByText('0')).toBeVisible();
    expect(screen.getByText('0°C')).toBeVisible();
    expect(screen.getByText('Inside · set 0°C')).toBeVisible();
    expect(screen.getByText('HVAC off')).toBeVisible();
    expect(screen.getByText('Fan 0')).toBeVisible();
    expect(screen.getByText('Defrost · Off')).toBeVisible();
    expect(screen.getAllByText('Off')).toHaveLength(4);
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(container.querySelector('[data-climate-airflow]')).toHaveAttribute('data-climate-airflow', 'static');
  });

  it('retains the empty source shell, headline and status sections', async () => {
    mockedRequest.mockResolvedValue(null);
    const { container } = renderPack(packId);
    await expectAppearance(container, appearance);

    expect(screen.getByText('No climate data')).toBeVisible();
    expect(container.querySelector('[data-data-state="unavailable"]')).not.toBeNull();
    for (const label of ['Inside', 'Outside', 'Seats', 'Steering heat', 'Cabin overheat', 'Battery heater']) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(screen.getByText('HVAC unknown')).toBeVisible();
    expect(screen.getByText('Fan · Unknown')).toBeVisible();
    expect(screen.getByText('Defrost · Unknown')).toBeVisible();
    expect(screen.getAllByText('Unknown')).toHaveLength(4);
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
    expect(container.querySelector('[data-climate-airflow]')).toHaveAttribute('data-climate-airflow', 'static');
    expect(screen.getByRole('button', { name: /^Refresh data/i })).toBeEnabled();
  });

  it('preserves the compact cabin-only branch without adding full-card facts or airflow', async () => {
    const { container } = renderPack(packId, COMPACT);
    await expectAppearance(container, appearance);
    expect(screen.getByText('21°C')).toBeVisible();
    for (const label of ['Outside', 'Seats', 'Steering heat', 'HVAC on', 'Fan 3', 'Defrost']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(container.querySelector('[data-climate-airflow]')).toBeNull();
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest.mock.calls[0]?.[0]).toBe('/climate/latest?vehicle_id=7');
  });
});

it('preserves Classic and switches every supported pack and unknown-ID recovery without another acquisition', async () => {
  const view = renderPack('classic');
  await screen.findByText('21');
  expect(view.container.querySelector('[data-widget-family]')).toBeNull();
  expect(view.container.querySelector('[data-climate-readout]')).toBeNull();
  expect(screen.queryByText('Climate readings only; no commands are sent.')).not.toBeInTheDocument();
  expect(screen.getByText('Inside · set 22°C')).toBeVisible();
  expect(screen.getByText('18°C')).toBeVisible();

  for (const [packId, appearance] of packs) {
    view.selectPack(packId);
    await expectAppearance(view.container, appearance);
    expect(screen.getByText('FL1/3 · FR2/3 · RC3/3')).toBeVisible();
    expect(screen.getByText('2/3')).toBeVisible();
    expect(view.container.querySelectorAll('[data-climate-airflow]')).toHaveLength(1);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  }

  for (const recovery of ['classic', 'unrecognized-pack']) {
    view.selectPack(recovery);
    await waitFor(() => expect(view.container.querySelector('[data-widget-family]')).toBeNull());
    expect(view.container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
    expect(screen.getByText('21')).toBeVisible();
    expect(screen.getByText('Fan 3')).toBeVisible();
    expect(screen.getByText('Battery heater')).toBeVisible();
    expect(screen.queryByText('Climate readings only; no commands are sent.')).not.toBeInTheDocument();
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  }
});

it('keeps retained readings, source age, static airflow and retry after a failed refresh and pack change', async () => {
  const view = renderPack('v4');
  await expectAppearance(view.container, 'owner');
  const refresh = screen.getByRole('button', { name: /^Refresh data/i });
  const lastSuccessAt = view.client.getQueryState(['climate-latest', 7])?.dataUpdatedAt;
  expect(lastSuccessAt).toBeGreaterThan(0);
  mockedRequest.mockRejectedValueOnce(new Error('Climate refresh failed'));
  fireEvent.click(refresh);

  await waitFor(() => expect(view.container.querySelector('[data-data-state="stale"]')).not.toBeNull());
  expect(screen.getByTestId('stale-refresh-warning')).toBeVisible();
  expect(screen.getByText('21')).toBeVisible();
  expect(screen.getByText('HVAC on')).toBeVisible();
  expect(view.client.getQueryState(['climate-latest', 7])?.dataUpdatedAt).toBe(lastSuccessAt);
  expect(view.container.querySelector('[data-climate-airflow]')).toHaveAttribute('data-climate-airflow', 'static');

  for (const [packId, appearance] of packs) {
    view.selectPack(packId);
    await expectAppearance(view.container, appearance);
    expect(screen.getByText('FL1/3 · FR2/3 · RC3/3')).toBeVisible();
    expect(screen.getByTestId('stale-refresh-warning')).toBeVisible();
    expect(view.container.querySelector('[data-climate-airflow]')).toHaveAttribute('data-climate-airflow', 'static');
    expect(mockedRequest).toHaveBeenCalledTimes(2);
    expect(view.client.getQueryState(['climate-latest', 7])?.dataUpdatedAt).toBe(lastSuccessAt);
    expect(screen.getByRole('button', { name: /^Refresh data/i })).toHaveAccessibleName(/error/i);
  }

  fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
  await waitFor(() => expect(view.container.querySelector('[data-data-state="ok"]')).not.toBeNull());
  expect(mockedRequest).toHaveBeenCalledTimes(3);
  expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
});

it.each(packs)('%s converts only at display, including negative outside temperatures, without a fabricated dial range', async (packId, appearance) => {
  source.temperature = '°F';
  mockedRequest.mockResolvedValue(climate({
    inside_temp_c: 20, outside_temp_c: -10, driver_setpoint_c: 21,
    hvac_power: false, fan_speed: 0,
  }));
  const { container } = renderPack(packId);
  await expectAppearance(container, appearance);
  expect(screen.getByText('68')).toBeVisible();
  expect(screen.getByText('°F')).toBeVisible();
  expect(screen.getByText('14°F')).toBeVisible();
  expect(screen.getByText('Inside · set 70°F')).toBeVisible();
  expect(screen.getByText('HVAC off')).toBeVisible();
  expect(screen.getByText('Fan 0')).toBeVisible();
  expect(container.querySelector('[data-climate-airflow]')).toHaveAttribute('data-climate-airflow', 'static');
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
});

it.each(packs)('%s keeps old active observations static while preserving their measured HVAC status', async (packId, appearance) => {
  mockedRequest.mockResolvedValue({
    ...fullClimate(), ts: new Date(Date.now() - 10 * 60_000).toISOString(),
  });
  const { container } = renderPack(packId);
  await expectAppearance(container, appearance);
  expect(screen.getByText('HVAC on')).toBeVisible();
  expect(container.querySelector('[data-climate-airflow]')).toHaveAttribute('data-climate-airflow', 'static');
});

it.each(packs)('%s keeps loading and fatal-error recovery in the original shell rather than fabricating a reading', async (packId, appearance) => {
  let resolveSource: ((value: ClimateSnapshot) => void) | undefined;
  mockedRequest.mockReturnValueOnce(new Promise<ClimateSnapshot>(resolve => { resolveSource = resolve; }));
  const loading = renderPack(packId);
  expect(loading.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
  await act(async () => { resolveSource?.(fullClimate()); });
  await expectAppearance(loading.container, appearance);
  loading.unmount();

  mockedRequest.mockRejectedValueOnce(new Error('Climate source failed'));
  const failed = renderPack(packId);
  await screen.findByRole('alert');
  expect(failed.container.querySelector('[data-data-state="initialFailure"]')).not.toBeNull();
  expect(screen.queryByText('HVAC off')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
  await expectAppearance(failed.container, appearance);
  expect(screen.getByText('21')).toBeVisible();
});
