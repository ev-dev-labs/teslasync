import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { ChargingSession, Drive, VehicleState } from '@/api/types';
import { VehicleDetailHistory } from './VehicleDetailHistory';
import { VehicleDetailStats } from './VehicleDetailStats';

const state: VehicleState = {
  vehicle_id: 1, state: 'online', latitude: 0, longitude: 0, speed: 0, power: 0,
  battery_level: 20, rated_range: 123000, ideal_range: 124000, odometer: 789000,
  inside_temp: 0, outside_temp: -7, is_climate_on: false, is_charging: false,
  charger_power: 0, charge_rate: 0, time_to_full_charge: 0, is_locked: true,
  sentry_mode: false, software_version: 'test-only',
};

function drive(id: number, distance: number): Drive {
  return {
    id, vehicle_id: 1, start_ts: `2026-10-0${id}T10:00:00Z`, end_ts: `2026-10-0${id}T11:00:00Z`,
    duration_s: 3600, distance_m: distance, start_address: null, end_address: null,
    start_lat: null, start_lon: null, end_lat: null, end_lon: null,
    start_soc_pct: 80, end_soc_pct: 70, energy_used_wh: null, regen_energy_wh: null,
    avg_speed_mps: null, max_speed_mps: null, avg_power_w: null,
    outside_temp_avg_c: null, inside_temp_avg_c: null, score: null, ended_status: null,
    created_at: '2026-10-05T12:00:00Z', updated_at: '2026-10-05T12:00:00Z',
  };
}
const drives = [drive(1, 40000), drive(2, 9000), drive(3, 100000)];
const emptyCharges: ChargingSession[] = [];
const retryState = vi.fn();
const retryDrives = vi.fn();
const retryCharges = vi.fn();

function view(
  stateQuery: DataStateSource<{ state: VehicleState }>,
  drivesQuery: DataStateSource<Drive[]>,
  sessionsQuery: DataStateSource<ChargingSession[]>,
) {
  return (
    <MemoryRouter>
      <VehicleDetailStats state={stateQuery.data?.state} status="online"
        stateQuery={{ ...stateQuery, refetch: retryState }} />
      <VehicleDetailHistory
        drivesQuery={{ ...drivesQuery, refetch: retryDrives }}
        sessionsQuery={{ ...sessionsQuery, refetch: retryCharges }} />
    </MemoryRouter>
  );
}

function driveRows(): string[][] {
  return within(screen.getByRole('region', { name: 'Recent activity' }))
    .getAllByRole('row').slice(1).map(row =>
      within(row).getAllByRole('cell').map(cell => cell.textContent ?? ''),
    );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('actual detail stats and history source preservation', () => {
  it('retains the same stats, sorted table, focus and completed-empty neighbor through independent refresh failures', () => {
    const original = JSON.stringify({ state, drives, emptyCharges });
    const { rerender } = render(view(
      { data: { state }, isSuccess: true },
      { data: drives, isSuccess: true },
      { data: emptyCharges, isSuccess: true },
    ));
    const stats = screen.getByRole('region', { name: 'Quick stats' });
    expect(stats.querySelector('[data-testid="vehicle-quick-stats-summary"][data-operational-brief]')).not.toBeNull();
    const cards = Array.from(stats.querySelectorAll('[data-operational-metric]'));
    expect(cards).toHaveLength(8);
    const battery = within(stats).getByText('Battery').closest('[data-operational-metric]');
    expect(battery?.querySelector('[data-battery-color]')).toHaveAttribute('data-battery-color', 'red');
    expect(battery).toHaveTextContent('20.00%');
    const distance = screen.getByRole('button', { name: 'Distance' });
    fireEvent.click(distance);
    distance.focus();
    const sortedRows = driveRows();
    expect(sortedRows.map(row => row[1])).toEqual(['100.00 km', '40.00 km', '9.00 km']);

    rerender(view(
      { data: { state }, isError: true, error: new Error('State refresh failed') },
      { data: drives, isError: true, error: new Error('Drive refresh failed') },
      { data: emptyCharges, isError: true, error: new Error('Charge refresh failed') },
    ));
    expect(screen.getByRole('button', { name: 'Distance' })).toBe(distance);
    expect(distance).toHaveFocus();
    expect(driveRows()).toEqual(sortedRows);
    const retainedCards = Array.from(stats.querySelectorAll('[data-operational-metric]'));
    expect(retainedCards).toHaveLength(8);
    retainedCards.forEach((card, index) => expect(card).toBe(cards[index]));
    expect(screen.getByText('No charging sessions recorded yet')).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    const chargeSource = screen.getByText('No charging sessions recorded yet')
      .closest('[data-vehicle-source="Recent charges"]');
    if (!chargeSource) throw new Error('Recent charges source missing');
    fireEvent.click(within(chargeSource as HTMLElement).getByRole('button', { name: 'Refresh' }));
    expect(retryCharges).toHaveBeenCalledOnce();
    expect(retryState).not.toHaveBeenCalled();
    expect(retryDrives).not.toHaveBeenCalled();
    const links = within(screen.getByRole('region', { name: 'Recent activity' }))
      .getAllByRole('link', { name: 'View all' });
    expect(links.map(link => link.getAttribute('href'))).toEqual(['/drives', '/charging']);

    const nextState = { ...state, battery_level: 51 };
    rerender(view(
      { data: { state: nextState }, isSuccess: true },
      { data: [drive(4, 150000), ...drives], isSuccess: true },
      { data: emptyCharges, isSuccess: true },
    ));
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Distance' })).toBe(distance);
    expect(driveRows().map(row => row[1])).toEqual(['150.00 km', '100.00 km', '40.00 km', '9.00 km']);
    expect(battery?.querySelector('[data-battery-color]')).toHaveAttribute('data-battery-color', 'green');
    expect(battery).toHaveTextContent('51.00%');
    expect(JSON.stringify({ state, drives, emptyCharges })).toBe(original);
  });

  it('keeps actual history and its sort control while only the live source has failed', () => {
    render(view(
      { isError: true, error: new Error('Live read failed') },
      { data: drives, isSuccess: true },
      { data: emptyCharges, isSuccess: true },
    ));
    const stats = screen.getByRole('region', { name: 'Quick stats' });
    expect(stats.querySelector('[data-operational-brief]')).toBeNull();
    expect(screen.getByText('No charging sessions recorded yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Distance' }));
    expect(driveRows()).toHaveLength(3);
    fireEvent.click(within(stats).getByRole('button', { name: 'Retry' }));
    expect(retryState).toHaveBeenCalledOnce();
    expect(retryDrives).not.toHaveBeenCalled();
    expect(retryCharges).not.toHaveBeenCalled();
  });
});
