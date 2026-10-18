import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { DrivingStats } from '@/types/driving';
import { HeroGauges } from './HeroGauges';
import { driveFixture, statsFixture } from './detailTestFixtures';
import { fmtWithUnit } from '@/lib/numberFormat';
import { driveOdometerEvidence } from './odometerEvidence';
const state = vi.hoisted(() => ({
  distance: 'km' as 'mi' | 'km',
  speed: 'km/h' as 'mph' | 'km/h',
  data: undefined as DrivingStats | undefined,
  error: null as Error | null,
  refetch: vi.fn(),
  deltas: [] as { current: number; previous: number; comparedTo: string; metric: { direction: string } }[],
  translations: {} as Record<string, string>,
  rate: 0.12 as number | null,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) =>
      (state.translations[key] ?? fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(opts?.[token] ?? token)),
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
    costPerKwh: state.rate, currencySymbol: '$',
    formatEnergyCost: (kwh: number) => state.rate == null ? '—' : `$${(kwh * state.rate).toFixed(2)}`,
  }),
}));
vi.mock('@/components/motion', async () => ({
  ...await vi.importActual<typeof import('@/components/motion')>('@/components/motion'),
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
// The journey sequence owns places, times and batteries (tested on its own);
// here it only needs to surface the leg values HeroGauges hands it.
vi.mock('./JourneySequence', () => ({
  JourneySequence: ({ distance, duration, comparisons }: { distance: ReactNode; duration: ReactNode; comparisons?: ReactNode[] }) => (
    <ol data-testid="journey-sequence">
      <li data-overview-metric="distance"><span>Distance</span> {distance}</li>
      <li data-overview-metric="duration"><span>Duration</span> {duration}</li>
      <li>{comparisons}</li>
    </ol>
  ),
}));
const fleet: DrivingStats = {
  totalDrives: 10, totalDistanceKm: 300, totalDurationS: 18000, avgEfficiencyWhKm: 180,
  avgSpeedKmh: 60, topSpeedKmh: 144, regenRatio: 0.1, regenEnergyWh: 10000, co2SavedKg: 0,
};
beforeEach(() => {
  state.refetch.mockClear();
  Object.assign(state, { distance: 'km', speed: 'km/h', data: fleet, error: null, deltas: [], translations: {}, rate: 0.12 });
});
const reading = (label: string) => screen.getByText(label).closest('[data-overview-metric]')?.textContent;
const openDetails = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  return screen.getByRole('dialog');
};
const detail = (dialog: HTMLElement, label: string) =>
  within(dialog).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;

describe('Drive overview hero and grid', () => {
  it.each([
    ['aggregate', { start_odometer_m: 120000000, end_odometer_m: 120040000 }, 'persisted', 'Persisted drive aggregate'],
    ['sampled', {}, 'sampled', 'Recorded telemetry samples'],
    ['mixed', { start_odometer_m: 120000000 }, 'odometerMixed', 'Recorded endpoints with telemetry fallback'],
  ] as const)('localizes %s odometer provenance in the details drawer without changing the adapter enum', (source, endpoints, key, label) => {
    const drive = driveFixture(endpoints);
    const stats = statsFixture();
    state.translations[`driveDetail.report.${key}`] = `Localized: ${label}`;
    render(<HeroGauges drive={drive} stats={stats} />);
    // Sources stay off the card face.
    expect(screen.queryByText(/Odometer endpoints use/)).toBeNull();
    const dialog = openDetails();
    expect(detail(dialog, 'Odometer (from → to)')).toBe(`Odometer endpoints use Localized: ${label} evidence; missing endpoints are not zero.`);
    expect(detail(dialog, 'Odometer (from → to)')).not.toContain(`use ${source} evidence`);
    expect(driveOdometerEvidence(drive, stats, 'km').source).toBe(source);
  });

  it('lays out one hero (map beside the journey and key numbers) above one even metric grid', () => {
    render(<HeroGauges drive={driveFixture({ start_odometer_m: 120000000, end_odometer_m: 120040000 })} stats={statsFixture()}
      map={<div data-testid="map" />} />);
    const hero = screen.getByTestId('drive-overview-hero');
    expect(hero).toHaveClass('lg:grid-cols-[minmax(0,3fr)_minmax(300px,2fr)]');
    expect(hero.children[0]).toContainElement(screen.getByTestId('map'));
    expect(hero.children[0]).toHaveAttribute('id', 'route');
    expect(hero.children[1]).toHaveAttribute('id', 'journey');
    expect(within(hero.children[1] as HTMLElement).getByTestId('journey-sequence')).toBeInTheDocument();

    const keyNumbers = screen.getByRole('group', { name: 'Energy and cost' });
    expect(Array.from(keyNumbers.querySelectorAll('[data-overview-metric]'), (cell) => cell.getAttribute('data-overview-metric')))
      .toEqual(['drive-energy', 'consumption', 'drive-cost']);
    expect(reading('Energy used')).toContain('8.00 kWh');
    expect(reading('Drive cost')).toContain('$0.96');

    const grid = screen.getByTestId('drive-overview-grid');
    expect(grid).toHaveClass('grid-cols-2', 'lg:grid-cols-4');
    expect(Array.from(grid.querySelectorAll('[data-overview-metric]'), (cell) => cell.getAttribute('data-overview-metric')))
      .toEqual(['average-speed', 'maximum-speed', 'battery-rate', 'odometer']);
    expect(reading('Odometer (from → to)')).toContain('120,000.00 → 120,040.00 km');
    expect(screen.queryByText('Start odometer')).toBeNull();
  });

  it('keeps one heading and moves per-field sources into a single details drawer', () => {
    const { container } = render(<HeroGauges drive={driveFixture()} stats={statsFixture()} />);
    expect(screen.getByText('Overview')).toBeInTheDocument();
    for (const stacked of ['Drive summary', 'Performance and comparisons']) {
      expect(screen.queryByRole('heading', { name: stacked })).toBeNull();
    }
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(0);
    expect(container.textContent).not.toContain('Configured-rate estimate, not a charging invoice');
    const dialog = openDetails();
    expect(detail(dialog, 'Drive cost')).toBe('Configured-rate estimate, not a charging invoice');
    expect(detail(dialog, 'Energy used')).toBe('Persisted drive aggregate');
  });

  it('shows unknown cost and odometers without turning missing evidence into free driving or zero mileage', () => {
    render(<HeroGauges drive={driveFixture({ energyUsedWh: null, avgPowerW: null })} stats={statsFixture({ odometerStart: 0, odometerEnd: 0 })} />);
    expect(reading('Drive cost')).toContain('—');
    expect(reading('Odometer (from → to)')).toContain('—');
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  it('shows "No rate configured" for drive cost when the rate is missing but energy is known', () => {
    state.rate = null;
    render(<HeroGauges drive={driveFixture()} stats={statsFixture()} />);
    expect(reading('Drive cost')).toContain('No rate configured');
  });

  it('calls the ongoing endpoint latest rather than a final end odometer', () => {
    render(<HeroGauges drive={driveFixture({ endTs: null })} stats={statsFixture()} />);
    expect(reading('Odometer (start → latest)')).toContain('10,000.00 → 10,040.00');
    expect(screen.queryByText('End odometer')).toBeNull();
  });

  it.each([
    [82.6, '82.60'], [0, '0.00'], [null, '—'], [NaN, '—'], [Infinity, '—'],
  ] as const)('shows the recorded score %s once, in the details drawer, without inventing a grade', (score, expected) => {
    render(<HeroGauges drive={driveFixture({ score })} stats={statsFixture()} />);
    expect(screen.queryByText(/Recorded score/)).toBeNull();
    const dialog = openDetails();
    expect(detail(dialog, 'Recorded score')).toBe(expected);
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
  });

  it('renders each metric once, without neon or arbitrary relative gauges', () => {
    const { container } = render(<HeroGauges drive={driveFixture()} stats={statsFixture()} />);
    for (const label of ['Distance', 'Duration', 'Average speed', 'Maximum speed', 'Consumption', 'Energy used', 'Drive cost', 'Battery use per 100 km']) {
      expect(screen.getAllByText(label)).toHaveLength(1);
    }
    expect(container.querySelector('[class*="gradient"], [class*="text-neon"]')).toBeNull();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(reading('Distance')).toContain('40.00');
    expect(reading('Maximum speed')).toContain('108.00');
    expect(reading('Consumption')).toContain('200.00');
    // Correct scale: 10 SOC points / 40 km × 100, not ×10.
    expect(reading('Battery use per 100 km')).toContain('25.0');
  });

  it('compares SI-derived distance and duration against this vehicle’s actual mean, naming each', () => {
    render(<HeroGauges drive={driveFixture()} stats={statsFixture()} />);
    expect(state.deltas.find((row) => row.current === 40)).toMatchObject({ previous: 30, comparedTo: 'distance vs your average' });
    expect(state.deltas.find((row) => row.current === 30)).toMatchObject({ previous: 30, comparedTo: 'duration vs your average' });
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
    expect(state.deltas.find((row) => row.comparedTo === 'distance vs your average')?.previous).toBeCloseTo(18.641, 2);
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

  it('notes estimated consumption in the details drawer and never duplicates the energy total', () => {
    render(<HeroGauges drive={driveFixture({ energyUsedWh: null })} stats={statsFixture()} />);
    expect(screen.queryByText('Energy consumed')).toBeNull();
    const dialog = openDetails();
    expect(within(dialog).getByText(/Consumption uses estimated energy/)).toBeInTheDocument();
  });

  it('does not leak non-finite SI aggregates into user-visible numbers', () => {
    render(<HeroGauges drive={driveFixture({ distanceM: NaN, durationS: NaN, avgSpeedMps: Infinity, maxSpeedMps: NaN })} stats={statsFixture()} />);
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
    expect(reading('Distance')).toContain('—');
  });
});
