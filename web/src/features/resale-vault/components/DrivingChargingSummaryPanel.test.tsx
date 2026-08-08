import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
