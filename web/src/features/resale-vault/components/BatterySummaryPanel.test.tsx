import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
    expect(screen.getByText('94.20%')).toBeInTheDocument();
    expect(screen.getByText('210.50')).toBeInTheDocument();
  });

  it('renders thermal exposure badges', () => {
    render(<BatterySummaryPanel battery={SAMPLE} />);
    expect(screen.getByText(/Cold: 10\.00%/)).toBeInTheDocument();
    expect(screen.getByText(/Nominal: 80\.00%/)).toBeInTheDocument();
    expect(screen.getByText(/Hot: 10\.00%/)).toBeInTheDocument();
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

  it('keeps unknown health measurements distinct from genuine zero readings across a source update', () => {
    const unknown: BatteryEvidence = {
      ...SAMPLE,
      soh_pct: null,
      capacity_wh: null,
      original_capacity_wh: null,
      equivalent_full_cycles: null,
      fast_charge_ratio: null,
      avg_charge_limit_pct: null,
      health_grade: null,
      thermal_exposure: null,
    };
    const labels = ['State of health', 'Current capacity', 'Original capacity', 'Equivalent full cycles', 'Fast-charge ratio', 'Average charge limit'];
    const value = (label: string) => {
      const row = screen.getByText(label).closest('[data-operational-metric]');
      if (!row) throw new Error(`Missing metric row ${label}`);
      const rendered = row.querySelector('[data-operational-value]');
      if (!rendered) throw new Error(`Missing operational value ${label}`);
      return rendered;
    };
    const { rerender } = render(<BatterySummaryPanel battery={unknown} />);
    for (const label of labels) {
      expect(value(label)).toHaveTextContent(/^—$/);
      expect(value(label).closest('[data-operational-metric]')).toHaveAttribute('data-value-state', 'missing');
    }
    expect(screen.queryByText('A-')).not.toBeInTheDocument();
    expect(screen.queryByText(/No battery passport evidence/)).not.toBeInTheDocument();

    rerender(<BatterySummaryPanel battery={{
      ...unknown, soh_pct: 0, capacity_wh: 0, original_capacity_wh: 0,
      equivalent_full_cycles: 0, fast_charge_ratio: 0, avg_charge_limit_pct: 0,
    }} />);
    expect(value('State of health')).toHaveTextContent(/^0\.00%$/);
    expect(value('Current capacity')).toHaveTextContent(/^0\.00 kWh$/);
    expect(value('Original capacity')).toHaveTextContent(/^0\.00 kWh$/);
    expect(value('Equivalent full cycles')).toHaveTextContent(/^0\.00$/);
    expect(value('Fast-charge ratio')).toHaveTextContent(/^0\.00%$/);
    expect(value('Average charge limit')).toHaveTextContent(/^0\.00%$/);
    for (const label of labels) expect(value(label).closest('[data-operational-metric]')).toHaveAttribute('data-value-state', 'value');
  });

  it('preserves an upstream unknown-quality grade, complete provenance and every recommendation without inventing a health score', () => {
    const hash = `sha256:${'abcdef0123456789'.repeat(8)}`;
    const recommendations = Array.from({ length: 24 }, (_, index) => `Source recommendation ${index}`);
    render(<BatterySummaryPanel battery={{
      ...SAMPLE, soh_pct: null, health_grade: 'insufficient_data', source_provenance_hash: hash, recommendations,
    }} />);
    expect(screen.getByText('insufficient_data')).toBeInTheDocument();
    expect(screen.getByText(`Passport provenance hash: ${hash}`)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').filter((item) => !item.hasAttribute('data-operational-metric'))).toHaveLength(24);
    for (const recommendation of recommendations) expect(screen.getByText(recommendation)).toBeInTheDocument();
    const row = screen.getByText('State of health').closest('[data-operational-metric]');
    if (!row) throw new Error('Missing health metric');
    expect(row.querySelector('[data-operational-value]')).toHaveTextContent(/^—$/);
    expect(row).toHaveAttribute('data-value-state', 'missing');
  });

  it('opens the real details drawer with source measurements, provenance and observation bounds', () => {
    render(<BatterySummaryPanel battery={SAMPLE} />);
    const brief = screen.getByTestId('vault-battery-brief');
    expect(brief).toHaveAttribute('data-operational-brief');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('94.20%')).toBeInTheDocument();
    expect(within(drawer).getByText('abc123')).toBeInTheDocument();
    expect(within(drawer).getAllByText('Observed evidence: 2023-01-01 → 2024-06-01').length).toBe(6);
  });
});
