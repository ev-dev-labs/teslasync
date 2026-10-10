import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { DrivingStats } from '@/types/driving';
import { HeroGauges } from './HeroGauges';
import { driveFixture, statsFixture } from './detailTestFixtures';
import { fmtWithUnit } from '@/lib/numberFormat';
const state = vi.hoisted(() => ({
  distance: 'km' as 'mi' | 'km',
  speed: 'km/h' as 'mph' | 'km/h',
  data: undefined as DrivingStats | undefined,
  error: null as Error | null,
  refetch: vi.fn(),
  deltas: [] as { current: number; previous: number; comparedTo: string; metric: { direction: string } }[],
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(opts?.[token] ?? token)),
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: state, formatEnergy: (wh: number) => fmtWithUnit(wh / 1000, 'kWh') }),
}));
vi.mock('@/api/hooks/useDriving', () => ({
  useDrivingStats: () => ({ data: state.data, error: state.error, isError: state.error != null, isFetching: false, dataUpdatedAt: 1000, refetch: state.refetch }),
}));
vi.mock('@/components/data-display', async () => ({
  ...await vi.importActual<typeof import('@/components/data-display')>('@/components/data-display'),
  Delta: (props: typeof state.deltas[number]) => { state.deltas.push(props); return <span data-testid="delta" />; },
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    costPerKwh: 0.12, currencySymbol: '$',
    formatEnergyCost: (kwh: number) => `$${(kwh * 0.12).toFixed(2)}`,
  }),
}));
vi.mock('@/components/motion', () => ({ FadeIn: ({ children }: { children: ReactNode }) => <>{children}</> }));
const fleet: DrivingStats = {
  totalDrives: 10, totalDistanceKm: 300, totalDurationS: 18000, avgEfficiencyWhKm: 180,
  avgSpeedKmh: 60, topSpeedKmh: 144, regenRatio: 0.1, regenEnergyWh: 10000, co2SavedKg: 0,
};
beforeEach(() => {
  state.refetch.mockClear();
  Object.assign(state, { distance: 'km', speed: 'km/h', data: fleet, error: null, deltas: [] });
});
const reading = (label: string) => screen.getByText(label).closest('[data-operational-metric]')?.textContent;

describe('Canonical drive overview', () => {
  it('puts cost and recorded endpoint odometers in the primary summary before performance comparisons', () => {
    const { container } = render(<HeroGauges drive={driveFixture({ start_odometer_m: 120000000, end_odometer_m: 120040000 })} stats={statsFixture()} />);
    expect(reading('Drive cost')).toContain('$0.96');
    expect(reading('Odometer (from → to)')).toContain('120,000.00 → 120,040.00');
    expect(screen.queryByText('Start odometer')).toBeNull();
    expect(screen.queryByText('End odometer')).toBeNull();
    expect(container.querySelectorAll('[data-operational-metric="odometer"]')).toHaveLength(1);
    const primaryMetrics = screen.getByRole('group', { name: 'Drive summary' }).querySelectorAll('[data-operational-metric]');
    expect(primaryMetrics).toHaveLength(7);
    expect(screen.getByRole('group', { name: 'Drive summary' }).querySelector('[role="list"]'))
      .toHaveClass('rounded-shape-md', 'border-[var(--border-subtle)]', 'bg-[var(--border-subtle)]');
    for (const metric of primaryMetrics) {
      expect(metric).toHaveClass('bg-[var(--surface-2)]');
      expect(metric.querySelector('[class~="border"]')).toBeNull();
    }
    for (const key of ['average-speed', 'maximum-speed', 'battery-rate']) {
      expect(container.querySelector(`[data-operational-metric="${key}"]`)).not.toHaveClass('border');
    }
    expect(reading('Battery change')).toContain('80.00% → 70.00%');
    expect(reading('Drive energy')).toContain('8.00 kWh');
    expect(container.textContent).toContain('Configured-rate estimate, not a charging invoice');
    expect(screen.getByText('Drive cost').compareDocumentPosition(screen.getByText('Average speed')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows unknown cost and odometers without turning missing evidence into free driving or zero mileage', () => {
    render(<HeroGauges drive={driveFixture({ energyUsedWh: null, avgPowerW: null })} stats={statsFixture({ odometerStart: 0, odometerEnd: 0 })} />);
    expect(reading('Drive cost')).toContain('—');
    expect(reading('Odometer (from → to)')).toContain('—');
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  it('calls the ongoing endpoint latest rather than a final end odometer', () => {
    render(<HeroGauges drive={driveFixture({ endTs: null })} stats={statsFixture()} />);
    expect(reading('Odometer (start → latest)')).toContain('10,000.00 → 10,040.00');
    expect(screen.queryByText('End odometer')).toBeNull();
  });

  it.each([
    [82.6, '82.60'], [0, '0.00'], [null, '—'], [NaN, '—'], [Infinity, '—'],
  ] as const)('shows the recorded score %s once without inventing a grade or estimate', (score, expected) => {
    render(<HeroGauges drive={driveFixture({ score })} stats={statsFixture()} />);
    expect(screen.getAllByText(`Recorded score: ${expected}`)).toHaveLength(1);
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
  });

  it('renders each canonical metric once, without neon or arbitrary relative gauges', () => {
    const { container } = render(<HeroGauges drive={driveFixture()} stats={statsFixture()} />);
    for (const label of ['Distance', 'Duration', 'Average speed', 'Maximum speed', 'Consumption', 'Battery use per 100 km']) {
      expect(screen.getAllByText(label)).toHaveLength(1);
    }
    expect(container.querySelector('[class*="gradient"], [class*="text-neon"]')).toBeNull();
    expect(container.querySelector('[data-operational-value] svg')).toBeNull();
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(2);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(reading('Distance')).toContain('40.00');
    expect(reading('Maximum speed')).toContain('108.00');
    expect(reading('Consumption')).toContain('200.00');
    // Correct scale: 10 SOC points / 40 km × 100, not ×10.
    expect(reading('Battery use per 100 km')).toContain('25.0');
  });

  it('compares SI-derived distance and duration against this vehicle’s actual mean', () => {
    render(<HeroGauges drive={driveFixture()} stats={statsFixture()} />);
    expect(state.deltas.find((row) => row.current === 40)?.previous).toBe(30);
    expect(state.deltas.find((row) => row.current === 30)?.previous).toBe(30);
  });

  it('compares maximum speed to the record, not an average and marks consumption lower-better', () => {
    render(<HeroGauges drive={driveFixture()} stats={statsFixture()} />);
    expect(state.deltas.find((row) => row.current === 108)).toMatchObject({ previous: 144, comparedTo: 'vs your record' });
    expect(state.deltas.find((row) => row.current === 200)).toMatchObject({ previous: 180, metric: { direction: 'lower_better' } });
  });

  it('converts SI aggregates and baselines to independently chosen distance/speed preferences', () => {
    Object.assign(state, { distance: 'mi', speed: 'mph' });
    render(<HeroGauges drive={driveFixture()} stats={statsFixture()} />);
    expect(reading('Distance')).toContain('24.85');
    expect(reading('Maximum speed')).toContain('67.11');
    expect(reading('Consumption')).toContain('321.87');
    expect(screen.getByText('Battery use per 100 mi')).toBeInTheDocument();
    expect(state.deltas[0].previous).toBeCloseTo(18.641, 2);
  });

  it('does not create distance/duration baselines for a zero-count vehicle history', () => {
    state.data = { ...fleet, totalDrives: 0 };
    render(<HeroGauges drive={driveFixture()} stats={statsFixture()} />);
    expect(state.deltas.some((row) => row.current === 40 || row.current === 30)).toBe(false);
  });

  it('keeps metrics without baselines on a first drive or failed baseline request', () => {
    state.data = undefined;
    state.error = new Error('baseline unavailable');
    render(<MemoryRouter><HeroGauges drive={driveFixture()} stats={statsFixture()} /></MemoryRouter>);
    expect(screen.getByTestId('drive-canonical-summary')).toBeInTheDocument();
    expect(reading('Distance')).toContain('40.00');
    expect(state.deltas).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Retry|Try again/i }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });

  it('keeps timestamp duration but placeholders telemetry-dependent metrics in a telemetry gap', () => {
    render(<HeroGauges drive={driveFixture()} stats={statsFixture()} meaningful={false} />);
    expect(reading('Distance')).toContain('—');
    expect(reading('Average speed')).toContain('—');
    expect(reading('Duration')).toContain('30.00');
  });

  it('preserves missing speed and SOC instead of showing derived zero values', () => {
    render(<HeroGauges drive={driveFixture({ avgSpeedMps: null, maxSpeedMps: null, startBatteryPct: null })} stats={statsFixture()} />);
    expect(reading('Average speed')).toContain('—');
    expect(reading('Maximum speed')).toContain('—');
    expect(reading('Battery use per 100 km')).toContain('—');
  });

  it('labels consumption based on estimated energy and never duplicates the energy total', () => {
    render(<HeroGauges drive={driveFixture({ energyUsedWh: null })} stats={statsFixture()} />);
    expect(screen.getByText(/Consumption uses estimated energy/)).toBeInTheDocument();
    expect(screen.queryByText('Energy consumed')).toBeNull();
  });

  it('does not leak non-finite SI aggregates into user-visible numbers', () => {
    render(<HeroGauges drive={driveFixture({ distanceM: NaN, durationS: NaN, avgSpeedMps: Infinity, maxSpeedMps: NaN })} stats={statsFixture()} />);
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
    expect(reading('Distance')).toContain('—');
  });
});
