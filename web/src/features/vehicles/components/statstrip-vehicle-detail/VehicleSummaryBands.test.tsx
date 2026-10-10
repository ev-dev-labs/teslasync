import { cleanup, render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClimateSnapshot, MotorSnapshot, SecurityEvent, TirePressureSnapshot, VehicleState } from '@/api/types';
import type { DataStateSource } from '@/api/dataState';
import { VehicleDetailOverview } from '../modernization/VehicleDetailOverview';
import { VehicleDetailStats } from '../modernization/VehicleDetailStats';
import { VehicleDetailSystems } from '../modernization/VehicleDetailSystems';
import { NextChargeDecisionStrip } from '../NextChargeDecisionStrip';
import { QuickStatsGrid } from '../vehicle-detail/QuickStatsGrid';
import { BatteryRangePanel } from '../vehicle-detail/BatteryRangePanel';
import { SecuritySection } from '../vehicle-detail/SecuritySection';
import { statText } from './testQueries';

const { formatObserved, decisionQuery, preferences } = vi.hoisted(() => ({
  formatObserved: vi.fn(),
  decisionQuery: vi.fn(),
  preferences: { units: {
    distance: 'km' as 'km' | 'mi', speed: 'km/h' as 'km/h' | 'mph',
    temperature: '°C' as '°C' | '°F', pressure: 'bar' as 'bar' | 'psi',
    energy: 'kWh' as const, power: 'kW' as const, duration: 'h' as const,
    precision: 2, locale: 'en-US',
  } },
}));

vi.mock('@/lib/metric-reference', async importActual => {
  const actual = await importActual<typeof import('@/lib/metric-reference')>();
  return { ...actual, formatMetric: (...args: Parameters<typeof actual.formatMetric>) => {
    formatObserved(...args);
    return actual.formatMetric(...args);
  } };
});
vi.mock('@/hooks/useUnits', async importActual => {
  const actual = await importActual<typeof import('@/hooks/useUnits')>();
  return { ...actual, useUnits: () => ({ ...actual.useUnits(), unitPrefs: preferences.units }) };
});
vi.mock('@/api/hooks/useCharging', async importActual => {
  const actual = await importActual<typeof import('@/api/hooks/useCharging')>();
  return { ...actual, useNextChargeDecision: decisionQuery };
});

const live: VehicleState = {
  vehicle_id: 1, state: 'online', latitude: 0, longitude: 0, speed: 0, power: 0,
  battery_level: 50, rated_range: 160934.4, ideal_range: 200000, odometer: 1000000,
  inside_temp: 0, outside_temp: -7, is_climate_on: false, is_charging: false,
  charger_power: 0, charge_rate: 48000, time_to_full_charge: 1.5, is_locked: false,
  sentry_mode: false, software_version: 'test-only',
};
const motor: MotorSnapshot = {
  ts: '2026-10-06T12:00:00Z', created_at: '2026-10-06T12:00:00Z', vehicle_id: 1,
  torque_nm_front: 78.51, torque_nm_rear: 64.24, di_torque: null,
  motor_rpm_front: 343, motor_rpm_rear: -343, motor_temp_c_front: 50.19,
  motor_temp_c_rear: 49, inverter_temp_c: null, inverter_temp_rear: null,
  heatsink_temp_front: null, heatsink_temp_rear: null, motor_current_front: 7.84,
  motor_current_rear: null, state_front: null, state_rear: null, shift_state: 'P',
  vbat_front: 390, vbat_rear: 400,
};
const climate: ClimateSnapshot = {
  vehicle_id: 1, ts: '2026-10-06T12:01:00Z', inside_temp_c: 0, outside_temp_c: -7,
  driver_setpoint_c: 22, passenger_setpoint_c: null, hvac_state: null,
  defrost_mode: null, is_climate_on: false, is_ac_on: false, is_preconditioning: null,
  fan_status: 0, seat_heater_left: 0, seat_heater_right: null,
  seat_heater_rear_left: null, seat_heater_rear_right: null, steering_wheel_heater: null,
  cabin_overheat_protection: null, source: 'test-only',
};
const security: SecurityEvent = {
  vehicle_id: 1, ts: '2026-10-06T12:02:00Z', created_at: '2026-10-06T12:02:00Z',
  event_type: 'test-only', doors_open: null, windows_open: null, locked: null,
  sentry_mode: null, user_present: null, detail: null, source: 'test-only',
  door_state: false, fd_window: false, fp_window: '0', rd_window: '0', rp_window: false,
};
const tires: TirePressureSnapshot = {
  id: 1, vehicle_id: 1, created_at: '2026-10-06T12:03:00Z',
  front_left: 300000, front_right: 220000, rear_left: 320000, rear_right: null,
};
function source<T>(data: T, offset: number): DataStateSource<T> {
  return { data, isSuccess: true, dataUpdatedAt: Date.parse('2026-10-06T12:04:00Z') + offset };
}
function tile(label: string, band: Element) {
  const metric = within(band as HTMLElement).getByText(label).closest('[data-operational-metric]');
  if (!metric) throw new Error(`Missing actual shared metric: ${label}`);
  return metric;
}
function band(id: string) {
  const summary = document.querySelector(`[data-testid="${id}"][data-operational-brief]`);
  if (!summary) throw new Error(`Missing actual production summary: ${id}`);
  return summary;
}

function closeDrawer(dialog: HTMLElement) {
  const header = dialog.querySelector<HTMLElement>('[data-drawer-header]');
  if (!header) throw new Error('Missing actual shared drawer header');
  fireEvent.click(within(header).getByRole('button', { name: 'Close' }));
}

function renderBands() {
  const stateQuery = source({ state: live, live: true }, 0);
  return render(<MemoryRouter>
    <NextChargeDecisionStrip vehicleId={1} currentSoc={50} />
    <VehicleDetailOverview state={live} stateQuery={stateQuery} />
    <VehicleDetailStats state={live} status="online" stateQuery={stateQuery} />
    <VehicleDetailSystems state={live} stateQuery={stateQuery}
      motorQuery={source(motor, 1000)} climateQuery={source(climate, 2000)}
      securityQuery={source(security, 3000)} tireQuery={source(tires, 4000)}
      chargingTelemetryQuery={source(null, 5000)} />
  </MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  preferences.units.distance = 'km';
  preferences.units.speed = 'km/h';
  preferences.units.temperature = '°C';
  preferences.units.pressure = 'bar';
  decisionQuery.mockReturnValue(source({
    verdict: 'wait', reason_key: 'wait_offpeak', reason: 'Wait for off-peak',
    current_soc: 50, target_soc: 80, kwh_needed: 22.5, horizon_hours: 12,
    home_now_cost: 8.2, home_wait_cost: 6.1, home_wait_start: '2026-10-06T23:00:00Z',
    home_savings: 2.1, supercharger_cost: 12.34, supercharger_site: 'Test site',
    ready_by: '2026-10-07T07:30:00Z', capped_by_health_guardrail: false,
  }, 0));
});
afterEach(cleanup);

describe('seven unique vehicle-detail production summary bands', () => {
  it('mounts the original metrics, gauge, source snapshots and decision controls through actual page wrappers', () => {
    const original = JSON.stringify({ live, motor, climate, security, tires });
    renderBands();
    const counts = {
      'vehicle-next-charge-summary': 3, 'vehicle-live-overview-summary': 3,
      'vehicle-quick-stats-summary': 8, 'vehicle-powertrain-summary': 8,
      'vehicle-climate-summary': 8, 'vehicle-tire-pressure-summary': 4,
      'vehicle-security-summary': 4,
    };
    expect(document.querySelectorAll('[data-operational-brief]')).toHaveLength(7);
    expect(document.querySelectorAll('[data-stat-strip]')).toHaveLength(0);
    for (const [id, count] of Object.entries(counts)) {
      expect(band(id).querySelectorAll('[data-operational-metric]')).toHaveLength(count);
      expect(within(band(id) as HTMLElement).getByText('Source snapshot')).toBeInTheDocument();
      expect(band(id)).toHaveTextContent(/2026/);
      expect(within(band(id) as HTMLElement).getByRole('button', { name: 'Review details' })).toBeInTheDocument();
    }
    expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('button', { name: 'Open Autopilot' })).toBeInTheDocument();
    expect(screen.getByText(/50% → 80%.*22.50 kWh needed/)).toBeInTheDocument();
    expect(screen.getByText('Test site')).toBeInTheDocument();
    expect(screen.getByText('No charging telemetry available')).toBeInTheDocument();
    expect(tile('Speed', band('vehicle-quick-stats-summary'))).toHaveTextContent('Parked');
    expect(tile('Power', band('vehicle-quick-stats-summary'))).toHaveTextContent('0.00 kW');
    expect(tile('Pack voltage', band('vehicle-powertrain-summary'))).toHaveTextContent('400.00 V');
    expect(tile('Motor current (F)', band('vehicle-powertrain-summary'))).toHaveTextContent('7.84 A');
    expect(tile('Front torque', band('vehicle-powertrain-summary'))).toHaveTextContent('78.51 Nm');
    expect(tile('Rear torque', band('vehicle-powertrain-summary'))).toHaveTextContent('64.24 Nm');
    expect(tile('Front RPM', band('vehicle-powertrain-summary'))).toHaveTextContent('343 RPM');
    expect(tile('Rear RPM', band('vehicle-powertrain-summary'))).toHaveTextContent('-343 RPM');
    expect(tile('Motor temp (peak)', band('vehicle-powertrain-summary'))).toHaveTextContent('50.19°C');
    expect(tile('Defrost', band('vehicle-climate-summary'))).toHaveAttribute('data-value-state', 'missing');
    expect(tile('Climate on', band('vehicle-climate-summary'))).toHaveTextContent('Off');
    expect(tile('Seat heater left', band('vehicle-climate-summary'))).toHaveTextContent('0');
    expect(tile('Seat heater right', band('vehicle-climate-summary'))).toHaveAttribute('data-value-state', 'missing');
    expect(tile('Rear right', band('vehicle-tire-pressure-summary'))).toHaveTextContent('No data available');
    expect(tile('Front right', band('vehicle-tire-pressure-summary'))).toHaveTextContent('Low');
    expect(tile('Rear left', band('vehicle-tire-pressure-summary'))).toHaveTextContent('High');
    expect(tile('Locked', band('vehicle-security-summary'))).toHaveTextContent('No');
    expect(tile('Sentry', band('vehicle-security-summary'))).toHaveTextContent('Off');
    expect(tile('Doors', band('vehicle-security-summary'))).toHaveTextContent('Closed');
    expect(tile('Windows', band('vehicle-security-summary'))).toHaveTextContent('Closed');
    for (const [id, raw] of [['distance', 160934.4], ['power', 0], ['number', 400],
      ['number', 7.84], ['number', 78.51], ['number', -343], ['pressure', 300]] as const) {
      expect(formatObserved).toHaveBeenCalledWith(id, raw, expect.any(Object), undefined,
        id === 'number' ? expect.objectContaining({ formatter: expect.any(Function) }) : undefined);
    }
    for (const raw of [8.2, 6.1, 12.34]) {
      expect(formatObserved).toHaveBeenCalledWith('currency', raw, expect.any(Object), undefined,
        expect.objectContaining({ formatter: expect.any(Function) }));
    }
    expect(JSON.stringify({ live, motor, climate, security, tires })).toBe(original);
  });

  it('preserves saved imperial preference conversions and unknown-versus-zero speed/charging/battery states', () => {
    preferences.units.distance = 'mi';
    preferences.units.speed = 'mph';
    preferences.units.temperature = '°F';
    preferences.units.pressure = 'psi';
    const { rerender } = render(<MemoryRouter>
      <QuickStatsGrid state={live} status="online" />
      <BatteryRangePanel state={live} />
    </MemoryRouter>);
    expect(within(band('vehicle-quick-stats-summary') as HTMLElement).getByText(statText('100.00 mi'))).toBeInTheDocument();
    expect(tile('Inside temp', band('vehicle-quick-stats-summary'))).toHaveTextContent('32.00°F');
    expect(tile('Speed', band('vehicle-quick-stats-summary'))).toHaveTextContent('0.00 mph');
    expect(tile('Charging', band('vehicle-live-overview-summary'))).toHaveTextContent('Not charging');
    rerender(<MemoryRouter>
      <QuickStatsGrid state={undefined} status="offline" />
      <BatteryRangePanel state={undefined} />
    </MemoryRouter>);
    expect(band('vehicle-quick-stats-summary').querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(8);
    expect(tile('Speed', band('vehicle-quick-stats-summary'))).not.toHaveTextContent('Parked');
    expect(tile('Charging', band('vehicle-live-overview-summary'))).toHaveAttribute('data-value-state', 'missing');
    expect(screen.queryByRole('meter', { name: 'Battery' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Battery' })).toBeInTheDocument();
  });

  it.each([
    {
      id: 'vehicle-next-charge-summary', title: 'Charging options', source: 'Next charge decision',
      fields: ['Home now', 'Wait window', 'Supercharger'],
      values: ['$8.20', '$6.10', '$12.34', 'Test site', '50% → 80% · 22.50 kWh needed', 'Wait for off-peak'],
    },
    {
      id: 'vehicle-live-overview-summary', title: 'Range and charging', source: 'Live vehicle state',
      fields: ['Rated range', 'Ideal range', 'Charging'],
      values: ['160.93 km', '200.00 km', 'Not charging'],
    },
    {
      id: 'vehicle-quick-stats-summary', title: 'Live vehicle readings', source: 'Live vehicle state',
      fields: ['Battery', 'Range', 'Odometer', 'Speed', 'Inside temp', 'Outside temp', 'Power', 'State'],
      values: ['50.00%', '160.93 km', '1,000.00 km', '0.00 km/h', '0.00°C', '-7.00°C', '0.00 kW', 'online', 'Parked'],
    },
    {
      id: 'vehicle-powertrain-summary', title: 'Powertrain', source: 'Powertrain',
      fields: ['Shift state', 'Pack voltage', 'Motor current (F)', 'Front torque', 'Rear torque', 'Front RPM', 'Rear RPM', 'Motor temp (peak)'],
      values: ['P', '400.00 V', '7.84 A', '78.51 Nm', '64.24 Nm', '343 RPM', '-343 RPM', '50.19°C'],
    },
    {
      id: 'vehicle-climate-summary', title: 'Climate', source: 'Climate',
      fields: ['Inside temp', 'Outside temp', 'Driver setpoint', 'Fan speed', 'Seat heater left', 'Seat heater right', 'Defrost', 'Climate on'],
      values: ['0.00°C', '-7.00°C', '22.00°C', '0', 'Level', '—', 'Off'],
    },
    {
      id: 'vehicle-tire-pressure-summary', title: 'Tire pressure', source: 'Tire pressure',
      fields: ['Front left', 'Front right', 'Rear left', 'Rear right'],
      values: ['3.00 bar', '2.20 bar', '3.20 bar', '—', 'Normal', 'Low', 'High', 'No data available'],
    },
    {
      id: 'vehicle-security-summary', title: 'Security', source: 'Security',
      fields: ['Locked', 'Sentry', 'Doors', 'Windows'],
      values: ['No', 'Off', 'Closed'],
    },
  ])('preserves all $title measurements and rich context in the real shared Review details drawer', ({ id, title, source, fields, values }) => {
    const original = JSON.stringify({ live, motor, climate, security, tires });
    renderBands();
    const summary = band(id);
    const metricNodes = Array.from(summary.querySelectorAll('[data-operational-metric]'));
    const review = within(summary as HTMLElement).getByRole('button', { name: 'Review details' });
    fireEvent.click(review);
    const drawer = screen.getByRole('dialog', { name: `${title} details` });
    const detail = within(drawer);
    expect(detail.getByRole('heading', { name: 'Operational metrics' })).toBeInTheDocument();
    for (const label of fields) expect(detail.getByText(label)).toBeInTheDocument();
    for (const value of values) expect(detail.getAllByText(value).length).toBeGreaterThan(0);
    expect(detail.getByText('Not scored')).toBeInTheDocument();
    expect(detail.queryByText('On track')).not.toBeInTheDocument();
    expect(detail.queryByText('Historical')).not.toBeInTheDocument();
    expect(detail.getByText(new RegExp(`^${source} snapshot · .*2026`))).toBeInTheDocument();
    closeDrawer(drawer);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const retainedNodes = Array.from(band(id).querySelectorAll('[data-operational-metric]'));
    expect(retainedNodes).toHaveLength(fields.length);
    retainedNodes.forEach((node, index) => expect(node).toBe(metricNodes[index]));
    expect(screen.getByRole('button', { name: 'Open Autopilot' })).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '50');
    expect(JSON.stringify({ live, motor, climate, security, tires })).toBe(original);
  });

  it('keeps source loading distinct from unknown metrics and retained refresh failures', () => {
    const { rerender } = render(<MemoryRouter>
      <QuickStatsGrid state={undefined} status="offline" sourceQuery={{ isPending: true, isLoading: true }} />
    </MemoryRouter>);
    expect(band('vehicle-quick-stats-summary')).toHaveAttribute('aria-busy', 'true');
    expect(band('vehicle-quick-stats-summary').querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(band('vehicle-quick-stats-summary').querySelectorAll('[data-operational-metric]')).toHaveLength(8);
    rerender(<MemoryRouter>
      <QuickStatsGrid state={live} status="online" sourceQuery={{
        ...source({ state: live }, 0), isError: true, error: new Error('Live refresh failed'),
      }} />
    </MemoryRouter>);
    expect(within(band('vehicle-quick-stats-summary') as HTMLElement).getByText('Retained source snapshot')).toBeInTheDocument();
    expect(tile('Battery', band('vehicle-quick-stats-summary'))).toHaveTextContent('50.00%');
    expect(band('vehicle-quick-stats-summary').querySelectorAll('[data-operational-value]')).toHaveLength(8);
  });

  it('retains charging rate and available time-to-full context inside the overview drawer without replacing the gauge', () => {
    const charging = { ...live, is_charging: true };
    render(<MemoryRouter><BatteryRangePanel state={charging} sourceQuery={source({ state: charging }, 0)} /></MemoryRouter>);
    const gauge = screen.getByRole('meter', { name: 'Battery' });
    fireEvent.click(within(band('vehicle-live-overview-summary') as HTMLElement).getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog', { name: 'Range and charging details' });
    const drawer = within(dialog);
    expect(drawer.getByText('48.00 km/h')).toBeInTheDocument();
    expect(drawer.getByText('Full in 1.50h')).toBeInTheDocument();
    expect(drawer.getAllByText('Charging').length).toBeGreaterThan(0);
    closeDrawer(dialog);
    expect(screen.getByRole('meter', { name: 'Battery' })).toBe(gauge);
    expect(gauge).toHaveAttribute('aria-valuenow', '50');
  });

  it('preserves mixed live and security snapshots, an explicit false flag, and partial open-window evidence in the drawer', () => {
    const mixedSecurity = { ...security, fd_window: '25', rp_window: null, door_state: null };
    const mixedLive = { ...live, is_locked: null } as unknown as VehicleState;
    render(<MemoryRouter><SecuritySection securityData={mixedSecurity} state={mixedLive}
      sourceQuery={source(mixedSecurity, 3000)}
      liveStateQuery={{ ...source({ state: mixedLive }, 0), isError: true, error: new Error('Live refresh failed') }} />
    </MemoryRouter>);
    expect(tile('Locked', band('vehicle-security-summary'))).toHaveAttribute('data-value-state', 'missing');
    expect(tile('Doors', band('vehicle-security-summary'))).toHaveAttribute('data-value-state', 'missing');
    expect(tile('Sentry', band('vehicle-security-summary'))).toHaveTextContent('Off');
    expect(tile('Windows', band('vehicle-security-summary'))).toHaveTextContent('1 open');
    fireEvent.click(within(band('vehicle-security-summary') as HTMLElement).getByRole('button', { name: 'Review details' }));
    const drawer = within(screen.getByRole('dialog', { name: 'Security details' }));
    expect(drawer.getByText('1 open')).toBeInTheDocument();
    expect(drawer.getByText('Other window states are unknown.')).toBeInTheDocument();
    expect(drawer.getByText('Off')).toBeInTheDocument();
    expect(drawer.getAllByText(/Live vehicle state snapshot · .*Retained source snapshot/)).toHaveLength(2);
    expect(drawer.getByText(/^Security snapshot · .*2026/)).toBeInTheDocument();
    expect(drawer.queryByText('Closed')).not.toBeInTheDocument();
    expect(drawer.queryByText('No')).not.toBeInTheDocument();
  });
});
