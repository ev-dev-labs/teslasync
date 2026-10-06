import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DrivingChargingSummaryPanel } from './DrivingChargingSummaryPanel';
import type { ChargingHistoryEvidence, DrivingHistoryEvidence } from '../lib/types';

const DRIVING: DrivingHistoryEvidence = {
  observed_drive_count: 42,
  total_distance_m: 500_000,
  total_duration_s: 36_000,
  avg_efficiency_wh_per_km: 180,
  regen_ratio: 0.22,
  co2_saved_kg: 120.4,
  score_overall: 88,
  score_grade: 'B+',
  earliest_drive_at: '2024-01-01',
  latest_drive_at: '2024-06-01',
};

const CHARGING: ChargingHistoryEvidence = {
  observed_session_count: 10,
  total_energy_added_wh: 250_000,
  fast_charge_session_count: 3,
  avg_peak_power_w: 90_000,
  total_cost: 45.5,
  earliest_session_at: '2024-01-05',
  latest_session_at: '2024-06-02',
};

describe('DrivingChargingSummaryPanel', () => {
  it('renders an empty state when both sections are null', () => {
    render(<DrivingChargingSummaryPanel driving={null} charging={null} />);
    expect(screen.getByText(/No driving or charging history evidence/i)).toBeInTheDocument();
  });

  it('renders driving distance/duration/efficiency using useUnits formatting', () => {
    render(<DrivingChargingSummaryPanel driving={DRIVING} charging={null} />);
    // default settings mock: unit_of_length 'km' → 500,000 m = 500.0 km
    expect(screen.getByText(/500(\.\d+)? km/)).toBeInTheDocument();
    // efficiency: 180 Wh/km → 0.18 kWh/km (fixed kWh energy pref)
    expect(screen.getByText(/0\.18 kWh\/km/)).toBeInTheDocument();
    expect(screen.getByText(/Driving score/)).toBeInTheDocument();
  });

  it('renders charging energy/power/session counts', () => {
    render(<DrivingChargingSummaryPanel driving={null} charging={CHARGING} />);
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('45.50')).toBeInTheDocument();
  });

  it('shows the observed-window scope note when either section is present', () => {
    render(<DrivingChargingSummaryPanel driving={DRIVING} charging={null} />);
    expect(screen.getByText(/observed window of recent records/i)).toBeInTheDocument();
  });

  it('retains independent driving and charging facts while distinguishing missing physical measurements from observed zero', () => {
    const driving: DrivingHistoryEvidence = {
      ...DRIVING, total_distance_m: null, total_duration_s: null, avg_efficiency_wh_per_km: null,
      regen_ratio: null, co2_saved_kg: null, score_overall: null, score_grade: null,
    };
    const charging: ChargingHistoryEvidence = {
      ...CHARGING, total_energy_added_wh: null, avg_peak_power_w: null, total_cost: null,
    };
    const value = (label: string) => {
      const row = screen.getByText(label).closest('[data-operational-metric]');
      if (!row) throw new Error(`Missing usage row ${label}`);
      const rendered = row.querySelector('[data-operational-value]');
      if (!rendered) throw new Error(`Missing operational value ${label}`);
      return rendered;
    };
    const { rerender } = render(<DrivingChargingSummaryPanel driving={driving} charging={charging} />);
    for (const label of ['Total distance', 'Total duration', 'Avg. efficiency', 'Regen ratio', 'CO2 saved', 'Total energy added', 'Avg. peak power', 'Total cost']) {
      expect(value(label)).toHaveTextContent(/^—$/);
      expect(value(label).closest('[data-operational-metric]')).toHaveAttribute('data-value-state', 'missing');
    }
    expect(value('Drives observed')).toHaveTextContent(/^42$/);
    expect(value('Sessions observed')).toHaveTextContent(/^10$/);
    expect(screen.queryByText(/Driving score:/)).not.toBeInTheDocument();
    expect(screen.getByText(/observed window of recent records/)).toBeInTheDocument();

    rerender(<DrivingChargingSummaryPanel driving={{
      ...driving, total_distance_m: 0, total_duration_s: 0, avg_efficiency_wh_per_km: 0,
      regen_ratio: 0, co2_saved_kg: 0, score_overall: 0,
    }} charging={{ ...charging, total_energy_added_wh: 0, avg_peak_power_w: 0, total_cost: 0 }} />);
    expect(value('Total distance')).toHaveTextContent(/^0\.00 km$/);
    expect(value('Avg. efficiency')).toHaveTextContent(/^0\.00 kWh\/km$/);
    expect(value('Regen ratio')).toHaveTextContent(/^0\.00%$/);
    expect(value('CO2 saved')).toHaveTextContent(/^0\.00 kg$/);
    expect(value('Total energy added')).toHaveTextContent(/^0\.00 kWh$/);
    expect(value('Avg. peak power')).toHaveTextContent(/^0\.00 kW$/);
    expect(value('Total cost')).toHaveTextContent(/^0\.00$/);
    expect(screen.getByText(/Driving score: 0/)).toBeInTheDocument();

    rerender(<DrivingChargingSummaryPanel driving={null} charging={CHARGING} />);
    expect(value('Sessions observed')).toHaveTextContent(/^10$/);
    expect(value('Total cost')).toHaveTextContent(/^45\.50$/);
    expect(screen.queryByText(/No driving or charging history/)).not.toBeInTheDocument();
    expect(screen.getByText(/observed window of recent records/)).toBeInTheDocument();
  });

  it('keeps charging denomination unknown and independent windows in the real details drawer', () => {
    render(<DrivingChargingSummaryPanel driving={DRIVING} charging={CHARGING} />);
    const chargingBrief = screen.getByTestId('vault-charging-brief');
    expect(within(chargingBrief).getByText('45.50')).toBeInTheDocument();
    expect(within(chargingBrief).getAllByText('Observed evidence: 2024-01-05 → 2024-06-02')).toHaveLength(6);
    expect(within(screen.getByTestId('vault-driving-brief')).getAllByText('Observed evidence: 2024-01-01 → 2024-06-01')).toHaveLength(7);
    fireEvent.click(within(chargingBrief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('45.50')).toBeInTheDocument();
    expect(within(drawer).getByText(/source does not supply a currency denomination/)).toBeInTheDocument();
    expect(within(drawer).queryByText(/500(\.\d+)? km/)).not.toBeInTheDocument();
  });
});
