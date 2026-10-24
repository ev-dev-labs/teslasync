import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ClimateSnapshot } from '@/api/types';
import type { WidgetSize } from './types';

const { vehiclesMock, climateMock, unitsMock } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  climateMock: vi.fn(),
  unitsMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
  useClimateLatest: (...args: unknown[]) => climateMock(...args),
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => unitsMock() }));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (value: unknown) => String(value) }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, options?: Record<string, unknown>) =>
      (fallback ?? _key).replace(/\{\{(\w+)\}\}/g, (_m: string, key: string) =>
        String(options?.[key] ?? _m)),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

import ClimateControlPanelWidget from './ClimateControlPanelWidget';

const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

function makeClimate(over: Partial<ClimateSnapshot> = {}): ClimateSnapshot {
  return {
    vehicle_id: 7,
    ts: '2026-07-05T12:00:00.000Z',
    inside_temp_c: null,
    outside_temp_c: null,
    driver_setpoint_c: null,
    passenger_setpoint_c: null,
    hvac_state: null,
    defrost_mode: null,
    is_climate_on: null,
    is_preconditioning: null,
    fan_status: null,
    seat_heater_left: null,
    seat_heater_right: null,
    seat_heater_rear_left: null,
    seat_heater_rear_right: null,
    steering_wheel_heater: null,
    cabin_overheat_protection: null,
    source: 'signal',
    inside_temp: null,
    outside_temp: null,
    driver_temp_setting: null,
    hvac_power: null,
    is_ac_on: null,
    fan_speed: null,
    hvac_steering_wheel_heat_level: null,
    battery_heater: null,
    seat_heater_rear_center: null,
    ...over,
  };
}

function setQuery(over: Record<string, unknown> = {}) {
  const query = {
    data: undefined as ClimateSnapshot | undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.parse('2026-07-05T12:00:00.000Z'),
    refetch: vi.fn(),
    ...over,
  };
  climateMock.mockReturnValue(query);
  return query;
}

function renderWidget(size: WidgetSize = FULL, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <ClimateControlPanelWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue({ data: [{ id: 7, display_name: 'Car' }] });
  unitsMock.mockReturnValue({
    unitPrefs: {
      distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
      energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US',
    },
  });
  setQuery({ data: makeClimate() });
});

describe('ClimateControlPanelWidget — After card layout', () => {
  it('renders headline cabin and secondary outside temperatures with a setpoint and unit', () => {
    setQuery({ data: makeClimate({
      inside_temp_c: 22, outside_temp_c: 23, driver_setpoint_c: 21,
    }) });
    renderWidget();
    expect(screen.getByRole('heading', { name: 'Climate control' })).toBeInTheDocument();
    expect(screen.getByText('Inside · set 21°C')).toBeInTheDocument();
    expect(screen.getByText('22')).toBeInTheDocument();
    expect(screen.getByText('°C')).toBeInTheDocument();
    expect(screen.getByText('Outside')).toBeInTheDocument();
    expect(screen.getByText('23°C')).toBeInTheDocument();
  });

  it('uses the user temperature unit and SI-to-display conversion', () => {
    unitsMock.mockReturnValue({
      unitPrefs: {
        distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'psi',
        energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US',
      },
    });
    setQuery({ data: makeClimate({ inside_temp_c: 20, outside_temp_c: 0, driver_setpoint_c: 21 }) });
    renderWidget();
    expect(screen.getByText('68')).toBeInTheDocument();
    expect(screen.getByText('°F')).toBeInTheDocument();
    expect(screen.getByText('32°F')).toBeInTheDocument();
  });

  it('renders fan, HVAC, defrost, seats, wheel heat and overheat without repeating source data', () => {
    setQuery({ data: makeClimate({
      inside_temp_c: 22, outside_temp_c: 23, hvac_power: true, is_ac_on: false,
      fan_speed: 3, defrost_mode: 'Front', seat_heater_left: 2,
      seat_heater_right: 0, seat_heater_rear_center: 1,
      hvac_steering_wheel_heat_level: 0, cabin_overheat_protection: true,
    }) });
    renderWidget();
    expect(screen.getByText('HVAC on')).toBeInTheDocument();
    expect(screen.getByText('Fan 3')).toBeInTheDocument();
    expect(screen.getByText('Defrost')).toBeInTheDocument();
    expect(screen.getByText('Seats')).toBeInTheDocument();
    expect(screen.getByText('FL2/3 · RC1/3')).toBeInTheDocument();
    expect(screen.getByText('Steering heat')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByText('Cabin overheat')).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
  });

  it('renders compact as cabin temperature only with no full-card labels', () => {
    setQuery({ data: makeClimate({ inside_temp_c: 21 }) });
    renderWidget(COMPACT);
    expect(screen.getByText('21°C')).toBeInTheDocument();
    expect(screen.queryByText('Outside')).not.toBeInTheDocument();
    expect(screen.queryByText('HVAC on')).not.toBeInTheDocument();
  });

  it('shows honest unknowns instead of fabrication for missing values', () => {
    setQuery({ data: makeClimate({
      inside_temp_c: null, outside_temp_c: null, hvac_power: null,
      is_ac_on: null, seat_heater_left: null, seat_heater_right: null,
      seat_heater_rear_left: null, seat_heater_rear_center: null,
      seat_heater_rear_right: null,
    }) });
    renderWidget();
    expect(screen.getByText('Inside')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('HVAC off')).not.toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('keeps retained data and reports refresh state, and the freshness control refetches', () => {
    const query = setQuery({
      data: makeClimate({ inside_temp_c: 21, hvac_power: true }),
      isError: true,
      error: new Error('refresh failed'),
    });
    renderWidget();
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });

  it('shows loading and initial error states honestly', () => {
    setQuery({ isLoading: true, data: undefined });
    const loading = renderWidget();
    expect(loading.container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    loading.unmount();

    const query = setQuery({ data: undefined, isError: true, error: new Error('source failed') });
    renderWidget();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });

  it('uses the resolved vehicle id and empty state', () => {
    setQuery({ data: undefined });
    renderWidget(FULL, 42);
    expect(climateMock).toHaveBeenCalledWith(42, 5000);
    expect(screen.getByRole('status')).toHaveTextContent('No climate data');
  });
});
