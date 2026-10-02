import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { DrivingStats } from '@/types/driving';
import { HeroGauges } from './HeroGauges';
import { driveFixture, statsFixture } from './detailTestFixtures';
const state = vi.hoisted(() => ({
  distance: 'km' as 'mi' | 'km',
  speed: 'km/h' as 'mph' | 'km/h',
  data: undefined as DrivingStats | undefined,
  error: null as Error | null,
  deltas: [] as { current: number; previous: number; comparedTo: string; metric: { direction: string } }[],
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(opts?.[token] ?? token)),
  }),
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({ unitPrefs: state }) }));
vi.mock('@/api/hooks/useDriving', () => ({
  useDrivingStats: () => ({ data: state.data, error: state.error, isError: state.error != null, isFetching: false, dataUpdatedAt: 1000 }),
}));
vi.mock('@/components/data-display', () => ({
  Delta: (props: typeof state.deltas[number]) => { state.deltas.push(props); return <span data-testid="delta" />; },
}));
vi.mock('@/components/motion', () => ({ FadeIn: ({ children }: { children: ReactNode }) => <>{children}</> }));
const fleet: DrivingStats = {
  totalDrives: 10, totalDistanceKm: 300, totalDurationS: 18000, avgEfficiencyWhKm: 180,
  avgSpeedKmh: 60, topSpeedKmh: 144, regenRatio: 0.1, regenEnergyWh: 10000, co2SavedKg: 0,
};
beforeEach(() => {
  Object.assign(state, { distance: 'km', speed: 'km/h', data: fleet, error: null, deltas: [] });
});
const reading = (label: string) => screen.getByText(label).parentElement!.textContent;

describe('Canonical drive overview', () => {
  it.each([
    [82.6, '82.6'], [0, '0.0'], [null, '—'], [NaN, '—'], [Infinity, '—'],
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
    expect(container.querySelector('[class*="gradient"], [class*="text-neon"], svg')).toBeNull();
    expect(reading('Distance')).toContain('40.0');
    expect(reading('Maximum speed')).toContain('108.0');
    expect(reading('Consumption')).toContain('200.0');
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
    expect(reading('Distance')).toContain('24.9');
    expect(reading('Maximum speed')).toContain('67.1');
    expect(reading('Consumption')).toContain('321.9');
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
    render(<HeroGauges drive={driveFixture()} stats={statsFixture()} />);
    expect(screen.getByTestId('drive-canonical-summary')).toBeInTheDocument();
    expect(reading('Distance')).toContain('40.0');
    expect(state.deltas).toHaveLength(0);
  });

  it('keeps timestamp duration but placeholders telemetry-dependent metrics in a telemetry gap', () => {
    render(<HeroGauges drive={driveFixture()} stats={statsFixture()} meaningful={false} />);
    expect(reading('Distance')).toContain('—');
    expect(reading('Average speed')).toContain('—');
    expect(reading('Duration')).toContain('30.0');
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
