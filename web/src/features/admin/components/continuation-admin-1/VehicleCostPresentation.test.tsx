import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { VehicleCostSummary } from './VehicleCostSummary';
import { VehicleCostTalkers } from './VehicleCostTalkers';
import type { VehicleCostBar } from '../vehicle-cost/helpers';

vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtInt: (value: number) => String(value),
    fmtNumber: (value: number) => String(value),
    fmtPercent: (value: number) => `${value}%`,
    formatBytes: (value: number) => `${value} B`,
  }),
}));

afterEach(cleanup);

const talkers: VehicleCostBar[] = [
  { vehicle_id: 2, name: 'Top vehicle', rows: 80, bytes: 7680, rate: 4, failures: 0 },
  { vehicle_id: 1, name: 'Second vehicle', rows: 20, bytes: 1920, rate: 1, failures: 0 },
];

describe('vehicle cost presentation preserves source evidence', () => {
  it('shows unknown fleet counters without treating them as real zero, while keeping a known vehicle count', () => {
    render(<VehicleCostSummary totals={undefined} vehicleCount={2} windowDays={30}
      loading={false} error={null} onRetry={vi.fn()} />);
    const region = screen.getByRole('region', { name: 'Fleet ingest totals' });
    expect(within(region).getAllByText('—')).toHaveLength(5);
    expect(within(region).getByText('2')).toBeInTheDocument();
    expect(within(region).getByText('Window: 30d')).toBeInTheDocument();
    expect(within(region).getByText('96 bytes/row average')).toBeInTheDocument();
    expect(within(region).getByText('DLQ failures (24h)')).toBeInTheDocument();
  });

  it('retains every measured zero as zero instead of an unknown placeholder', () => {
    render(<VehicleCostSummary totals={{
      total_rows: 0, total_bytes_est: 0, total_rate_per_minute_24h: 0, total_failures_24h: 0,
    }} vehicleCount={0} windowDays={7} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.getAllByText('0')).toHaveLength(5);
    expect(screen.getByText('0 B')).toBeInTheDocument();
  });

  it('keeps ranked names and raw row counts but does not invent proportions when the denominator is missing', () => {
    render(<VehicleCostTalkers talkers={talkers} totalRows={undefined}
      loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText('Top vehicle')).toBeInTheDocument();
    expect(screen.getByText('Second vehicle')).toBeInTheDocument();
    expect(screen.getByText('80 · —')).toBeInTheDocument();
    expect(screen.getByText('20 · —')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('Partial data')).toBeInTheDocument();
  });

  it('uses the original ranked order, max and percentage clamping for a known fleet denominator', () => {
    render(<VehicleCostTalkers talkers={talkers} totalRows={100}
      loading={false} error={null} onRetry={vi.fn()} />);
    const meters = screen.getAllByRole('progressbar');
    expect(meters.map(meter => meter.getAttribute('aria-label'))).toEqual(['Top vehicle', 'Second vehicle']);
    expect(meters[0]).toHaveAttribute('aria-valuenow', '80');
    expect(meters[0]).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('80 · 80%')).toBeInTheDocument();
    expect(screen.getByText('20 · 20%')).toBeInTheDocument();
  });
});
