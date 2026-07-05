/**
 * RecentActivity — behavioural + unit tests.
 *
 * RecentActivity is a pure presentation component: the parent hands it three
 * data sources (recent drives, recent charges, fleet analytics) plus the user's
 * display-unit preferences, and it renders three panels — a merged activity
 * timeline, a battery-trend chart, and a fleet-performance summary — each with
 * its own empty state. The exercised surface:
 *   - the merged timeline: drive + charge rows, SI→display conversion (km/mi),
 *     duration/SOC/cost subtitles, and most-recent-first ordering,
 *   - the empty state when there is no drive/charge activity,
 *   - null-safety: missing distance/duration/SOC coerce to 0/"?", absent cost
 *     drops the cost segment, and — the bug this file pins — an invalid
 *     `started_at` sinks the row to the bottom (instead of scrambling the sort
 *     via a NaN comparator) and renders "—" for its relative time,
 *   - the battery-trend chart vs its ≤1-point placeholder,
 *   - the fleet-performance metrics, the CO₂ derivation, and the
 *     most-efficient-vehicle badge driven by the `toEfficiencyDisplay` callback,
 *   - a11y: decorative header icons are aria-hidden and "View all" links to
 *     /drives,
 *   - the exported `formatTimeAgo` utility across every bucket + its
 *     invalid-input guard.
 *
 * `@/hooks/useFormatting` is mocked so the currency/format boundary is
 * deterministic without a SettingsProvider/QueryClient (it also feeds the real
 * <Currency> renderer, which reads `currencySymbol` from the same hook), and
 * `react-i18next` is stubbed to a passthrough `t(key, default)` (repo
 * convention — see LayoutManager / FleetComparisonPanel tests). Renders are
 * wrapped in <MemoryRouter> because the panel renders a react-router <Link>.
 * No network is touched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (amount: number, decimals = 2) => `$${amount.toFixed(decimals)}`,
    currencySymbol: '$',
    costPerKwh: 0.12,
    formatEnergyCost: (kwh: number) => `$${(kwh * 0.12).toFixed(2)}`,
    costPerDistanceUnit: () => null,
    estimateGasCost: () => null,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | object) =>
      typeof defaultValue === 'string' ? defaultValue : key,
  }),
}));

import { RecentActivity, formatTimeAgo } from './RecentActivity';
import { formatDateShort } from '@/lib/dateFormat';
import type { Drive, ChargingSession, FleetAnalytics } from '../types';

type Props = ComponentProps<typeof RecentActivity>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Return an ISO string `offsetMs` in the past from now. */
function isoAgo(offsetMs: number): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

function makeDrive(over: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    vehicle_id: 1,
    started_at: isoAgo(2 * HOUR),
    ended_at: isoAgo(HOUR),
    start_ts: isoAgo(2 * HOUR),
    distance_m: 12_000,
    duration_s: 3720,
    max_speed_mps: 30,
    avg_speed_mps: 20,
    avg_power_w: 15_000,
    start_soc_pct: 80,
    end_soc_pct: 60,
    energy_used_wh: 4000,
    regen_energy_wh: 500,
    ...over,
  };
}

function makeCharge(over: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 1,
    vehicle_id: 1,
    started_at: isoAgo(HOUR),
    ended_at: isoAgo(30 * MINUTE),
    total_energy_added_wh: 25_000,
    start_soc_pct: 30,
    end_soc_pct: 80,
    cost_decimal: 5,
    cost: 5,
    startedAt: isoAgo(HOUR),
    duration_min: 30,
    ...over,
  };
}

function makeAnalytics(over: Partial<FleetAnalytics> = {}): FleetAnalytics {
  return {
    total_vehicles: 2,
    total_drives: 42,
    total_charging_sessions: 7,
    total_distance_km: 1000,
    total_energy_kwh: 200,
    total_cost: 123.45,
    avg_efficiency_wh_km: 150,
    period_days: 30,
    ...over,
  };
}

function renderActivity(over: Partial<Props> = {}) {
  const props: Props = {
    recentDrives: undefined,
    recentCharges: undefined,
    analytics: undefined,
    toEfficiencyDisplay: (x: number) => x,
    distanceUnit: 'km',
    efficiencyUnit: 'Wh/km',
    ...over,
  };
  return render(
    <MemoryRouter>
      <RecentActivity {...props} />
    </MemoryRouter>,
  );
}

/** True when `a` appears before `b` in document order. */
function isBefore(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RecentActivity — activity feed', () => {
  it('renders drives and charges as timeline rows with SI→km conversion and rich subtitles', () => {
    renderActivity({
      recentDrives: [makeDrive({ distance_m: 12_000, duration_s: 3720, start_soc_pct: 80, end_soc_pct: 60 })],
      recentCharges: [makeCharge({ total_energy_added_wh: 25_000, start_soc_pct: 30, end_soc_pct: 80, cost: 5 })],
    });

    expect(screen.getByTestId('activity-timeline')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-empty')).not.toBeInTheDocument();

    // 12000 m → 12.0 km; 25000 Wh → 25.0 kWh.
    expect(screen.getByText('12.0 km drive')).toBeInTheDocument();
    expect(screen.getByText('25.0 kWh charged')).toBeInTheDocument();
    // 3720 s → 1h 2m; SOC transition rendered.
    expect(screen.getByText('1h 2m · 80% → 60%')).toBeInTheDocument();
    // Cost segment uses the mocked formatCurrency.
    expect(screen.getByText('30% → 80% · $5.00')).toBeInTheDocument();
  });

  it('orders the merged feed most-recent first (a newer charge outranks an older drive)', () => {
    renderActivity({
      recentDrives: [makeDrive({ started_at: isoAgo(3 * HOUR), distance_m: 12_000 })],
      recentCharges: [makeCharge({ started_at: isoAgo(1 * HOUR), total_energy_added_wh: 25_000 })],
    });

    const charge = screen.getByText('25.0 kWh charged');
    const drive = screen.getByText('12.0 km drive');
    // Charge (1h ago) must render before drive (3h ago).
    expect(isBefore(charge, drive)).toBe(true);
  });

  it('converts distance to miles and labels the unit when distanceUnit is "mi"', () => {
    renderActivity({
      // 1609.344 m == exactly 1 mile.
      recentDrives: [makeDrive({ distance_m: 1609.344 })],
      distanceUnit: 'mi',
    });

    expect(screen.getByText('1.0 mi drive')).toBeInTheDocument();
    expect(screen.queryByText(/km drive/)).not.toBeInTheDocument();
  });

  it('shows the empty state (no timeline) when there is no drive or charge activity', () => {
    renderActivity({ recentDrives: undefined, recentCharges: undefined });

    expect(screen.getByTestId('activity-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-timeline')).not.toBeInTheDocument();
    expect(screen.getByText('No activity yet. Start driving!')).toBeInTheDocument();
  });
});

describe('RecentActivity — null safety', () => {
  it('coerces missing distance/duration/SOC and omits the cost segment when cost is absent', () => {
    renderActivity({
      recentDrives: [
        makeDrive({
          distance_m: null as unknown as number,
          duration_s: null as unknown as number,
          start_soc_pct: 80,
          end_soc_pct: null,
        }),
      ],
      recentCharges: [makeCharge({ start_soc_pct: 30, end_soc_pct: 80, cost: undefined })],
    });

    // distance/duration coerce to 0; null end SOC renders "?".
    expect(screen.getByText('0.0 km drive')).toBeInTheDocument();
    expect(screen.getByText('0h 0m · 80% → ?%')).toBeInTheDocument();
    // No `· $x` cost tail when cost is undefined.
    expect(screen.getByText('30% → 80%')).toBeInTheDocument();
    expect(screen.queryByText(/→ 80% ·/)).not.toBeInTheDocument();
  });

  it('sinks rows with an invalid started_at and renders "—" for their relative time', () => {
    renderActivity({
      recentDrives: [
        makeDrive({ started_at: isoAgo(1 * HOUR), distance_m: 12_000 }),
        // Empty timestamp → Invalid Date → NaN epoch → must sink, not scramble.
        makeDrive({ started_at: '', distance_m: 24_000 }),
      ],
    });

    const valid = screen.getByText('12.0 km drive');
    const invalid = screen.getByText('24.0 km drive');
    // The valid, recent row outranks the timestamp-less one.
    expect(isBefore(valid, invalid)).toBe(true);
    // The invalid row's time cell is the universal placeholder, not "NaNm ago".
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});

describe('RecentActivity — battery trend', () => {
  it('renders the trend chart (no placeholder) when there is more than one drive', () => {
    renderActivity({
      recentDrives: [
        makeDrive({ id: 1, end_soc_pct: 70 }),
        makeDrive({ id: 2, end_soc_pct: 55 }),
      ],
    });

    expect(screen.getByText('Battery Trend')).toBeInTheDocument();
    expect(screen.queryByTestId('battery-empty')).not.toBeInTheDocument();
  });

  it('shows the battery placeholder when there is one or zero drives', () => {
    renderActivity({ recentDrives: [makeDrive({ id: 1, end_soc_pct: 70 })] });

    expect(screen.getByTestId('battery-empty')).toBeInTheDocument();
    expect(screen.getByText('Charge data will appear here')).toBeInTheDocument();
  });
});

describe('RecentActivity — fleet performance', () => {
  it('renders analytics metrics, the CO₂ derivation, and the most-efficient badge', () => {
    const toEfficiencyDisplay = vi.fn((whKm: number) => whKm * 2);
    renderActivity({
      analytics: makeAnalytics({
        total_drives: 42,
        total_charging_sessions: 7,
        total_cost: 123.45,
        total_energy_kwh: 200,
        most_efficient_vehicle: { name: 'Model 3', efficiency: 150 },
      }),
      toEfficiencyDisplay,
      efficiencyUnit: 'Wh/mi',
    });

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    // <Currency> renders symbol + locale number at precision 2.
    expect(screen.getByText('$123.45')).toBeInTheDocument();
    // CO₂: 200 kWh * 0.42 = 84 kg.
    expect(screen.getByText('84 kg')).toBeInTheDocument();

    const badge = screen.getByText('Most Efficient').closest('div') as HTMLElement;
    expect(within(badge).getByText('Model 3')).toBeInTheDocument();
    // efficiency 150 → toEfficiencyDisplay(150) → 300, with the passed unit.
    expect(toEfficiencyDisplay).toHaveBeenCalledWith(150);
    expect(within(badge).getByText('300 Wh/mi')).toBeInTheDocument();
  });

  it('falls back to zeros and hides the most-efficient badge when analytics is undefined', () => {
    renderActivity({ analytics: undefined });

    expect(screen.getByText('Total Drives (30d)')).toBeInTheDocument();
    // Both count metrics default to 0.
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.getByText('0 kg')).toBeInTheDocument();
    expect(screen.queryByText('Most Efficient')).not.toBeInTheDocument();
  });

  it('renders an em-dash for a blank most-efficient vehicle name', () => {
    renderActivity({
      analytics: makeAnalytics({ most_efficient_vehicle: { name: '', efficiency: 120 } }),
    });

    const badge = screen.getByText('Most Efficient').closest('div') as HTMLElement;
    expect(within(badge).getByText('—')).toBeInTheDocument();
  });
});

describe('RecentActivity — accessibility & navigation', () => {
  it('links "View all" to /drives and marks decorative header icons aria-hidden', () => {
    const { container } = renderActivity({ recentDrives: [makeDrive()] });

    const link = screen.getByRole('link', { name: /view all/i });
    expect(link).toHaveAttribute('href', '/drives');
    // Decorative lucide icons are hidden from assistive tech.
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  });
});

describe('formatTimeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T22:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats each relative bucket from a Date input', () => {
    const now = Date.now();
    expect(formatTimeAgo(new Date(now - 30 * 1000))).toBe('Just now');
    expect(formatTimeAgo(new Date(now - 5 * MINUTE))).toBe('5m ago');
    expect(formatTimeAgo(new Date(now - 3 * HOUR))).toBe('3h ago');
    expect(formatTimeAgo(new Date(now - 3 * DAY))).toBe('3d ago');
  });

  it('accepts epoch-ms and ISO-string inputs equivalently', () => {
    const ms = Date.now() - 5 * MINUTE;
    expect(formatTimeAgo(ms)).toBe('5m ago');
    expect(formatTimeAgo(new Date(ms).toISOString())).toBe('5m ago');
  });

  it('falls back to a short absolute date beyond a week', () => {
    const old = Date.now() - 10 * DAY;
    expect(formatTimeAgo(old)).toBe(formatDateShort(new Date(old)));
    expect(formatTimeAgo(old)).not.toMatch(/ago/);
  });

  it('returns the "—" placeholder for null / undefined / invalid input', () => {
    expect(formatTimeAgo(null)).toBe('—');
    expect(formatTimeAgo(undefined)).toBe('—');
    expect(formatTimeAgo('not-a-date')).toBe('—');
    expect(formatTimeAgo(NaN)).toBe('—');
  });
});
