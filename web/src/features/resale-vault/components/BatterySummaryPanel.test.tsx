import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BatterySummaryPanel } from './BatterySummaryPanel';
import type { BatteryEvidence } from '../lib/types';

const SAMPLE: BatteryEvidence = {
  soh_pct: 94.2,
  capacity_wh: 74000,
  original_capacity_wh: 78000,
  equivalent_full_cycles: 210.5,
  fast_charge_ratio: 0.15,
  avg_charge_limit_pct: 82,
  health_grade: 'A-',
  thermal_exposure: { cold_pct: 10, nominal_pct: 80, hot_pct: 10 },
  degradation_trend: [{ date: '2024-01-01', soh_pct: 96 }],
  recommendations: ['Avoid frequent DC fast charging above 90% SoC.'],
  source_provenance_hash: 'abc123',
  issued_at: '2024-06-01',
  first_observed_at: '2023-01-01',
};

describe('BatterySummaryPanel', () => {
  it('renders an empty state when battery evidence is null', () => {
    render(<BatterySummaryPanel battery={null} />);
    expect(screen.getByText(/No battery passport evidence/i)).toBeInTheDocument();
  });

  it('renders SOH, capacity, cycles, and health grade badge', () => {
    render(<BatterySummaryPanel battery={SAMPLE} />);
    expect(screen.getByText('A-')).toBeInTheDocument();
    expect(screen.getByText('94.2%')).toBeInTheDocument();
    expect(screen.getByText('210.5')).toBeInTheDocument();
  });

  it('renders thermal exposure badges', () => {
    render(<BatterySummaryPanel battery={SAMPLE} />);
    expect(screen.getByText(/Cold: 10%/)).toBeInTheDocument();
    expect(screen.getByText(/Nominal: 80%/)).toBeInTheDocument();
    expect(screen.getByText(/Hot: 10%/)).toBeInTheDocument();
  });

  it('renders recommendations list', () => {
    render(<BatterySummaryPanel battery={SAMPLE} />);
    expect(screen.getByText(/Avoid frequent DC fast charging/i)).toBeInTheDocument();
  });

  it('renders the provenance hash when present', () => {
    render(<BatterySummaryPanel battery={SAMPLE} />);
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it('gracefully handles missing optional fields', () => {
    render(
      <BatterySummaryPanel
        battery={{ ...SAMPLE, thermal_exposure: null, recommendations: [], source_provenance_hash: null, health_grade: null }}
      />,
    );
    expect(screen.queryByText(/Thermal exposure/i)).not.toBeInTheDocument();
  });
});
