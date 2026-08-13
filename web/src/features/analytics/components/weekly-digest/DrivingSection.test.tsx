/**
 * DrivingSection — behaviour, branch, computation, a11y + null-safety.
 *
 * DrivingSection is the driving half of the weekly-digest bento. It takes a
 * fully-aggregated `DigestMetrics` plus the daily-distance chart series and the
 * drives domain's query state, and renders three independent regions under a
 * persistent panel title:
 *
 *   1. Daily-distance chart area — the ONLY part gated by query state:
 *        isLoading                 → <Skeleton>
 *        isError                   → <QueryError>   (retry wired to onRetry)
 *        some distance > 0         → the bar chart (role="img", labelled)
 *        otherwise                 → <EmptyState>   (no distance this week)
 *   2. Four <MiniStat>s (avg efficiency, total driving time = h/m split from
 *      minutes, efficiency change vs. prev week, drives count) — always shown,
 *      never gated, so a mid-error panel still renders its stat shells.
 *   3. Top-drive card — the best drive by distance, or an <EmptyState>.
 *
 * The branch order is asserted directly (loading beats error beats empty), the
 * derived values are pinned (h/m split, pctChange sign + the improved/worsened
 * trend glyph colour, fmtInt grouping), and every optional field is exercised
 * nullish to prove the `?? 0` / `?? []` guards hold.
 *
 * Strategy: the component takes its data as props, so no network is touched.
 * <QueryError> reaches for useNavigate + useOnlineStatus, so the tree is wrapped
 * in QueryClientProvider + MemoryRouter (mirrors the sibling section tests).
 * Only `react-i18next` is mocked so `t(key, 'fallback')` renders deterministic
 * English. The global test-setup stubs useSettings + ResizeObserver, so
 * fmtNumber uses en-US and recharts' ResponsiveContainer doesn't crash at the
 * 0x0 layout jsdom gives it (the SVG never paints — assertions target the
 * labelled chart region + the surrounding DOM, not chart pixels).
 *
 * `@testing-library/user-event` is intentionally NOT a dependency of this repo;
 * `fireEvent.click` is the established interaction convention for the Retry CTA.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; install a benign stub before any module that might
// read it at import time evaluates (defensive — shared UI pulls it in).
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// i18n → return the developer fallback string, interpolating {{vars}} so any
// error/empty copy reads as real English instead of a raw key.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { DrivingSection } from './DrivingSection';
import type { DigestMetrics, Drive, DailyDistanceEntry } from './types';
import { formatDate } from '@/lib/dateFormat';
import { ApiError } from '@/lib/resilience';

// A fully-zeroed DigestMetrics so each test overrides only the fields the
// driving section actually reads (avgEfficiencyWhPerM,
// prevAvgEfficiencyWhPerM, totalDurationS, totalDrives, topDrive).
function makeMetrics(over: Partial<DigestMetrics> = {}): DigestMetrics {
  return {
    totalDistanceM: 0,
    prevDistanceM: 0,
    totalDrives: 0,
    prevDriveCount: 0,
    energyUsedWh: 0,
    prevEnergyWh: 0,
    chargingCost: 0,
    prevChargingCost: 0,
    co2Saved: 0,
    prevCo2: 0,
    avgEfficiencyWhPerM: 0,
    prevAvgEfficiencyWhPerM: 0,
    totalDurationS: 0,
    topDrive: undefined,
    chargeEnergyAddedWh: 0,
    prevChargeEnergyWh: 0,
    avgChargePowerW: 0,
    chargingSessionCount: 0,
    batteryStart: 0,
    batteryEnd: 0,
    alertsByType: {},
    alertTotal: 0,
    ...over,
  };
}

function makeTopDrive(over: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    startTs: '2026-04-04T12:00:00Z',
    distanceM: 120_600,
    durationS: 5_220,
    energyUsedWh: 19_078.92,
    ...over,
  };
}

// Seven weekday bins is the real shape (see useWeeklyDigest.dailyDistanceData);
// only the total-across-days matters to `hasChart`, so a short array is enough.
const CHART_DATA: DailyDistanceEntry[] = [
  { day: 'Mon', distanceM: 10_000 },
  { day: 'Tue', distanceM: 25_000 },
  { day: 'Wed', distanceM: 0 },
];
const ZERO_CHART_DATA: DailyDistanceEntry[] = [
  { day: 'Mon', distanceM: 0 },
  { day: 'Tue', distanceM: 0 },
];

interface RenderOverrides {
  dailyDistanceData?: DailyDistanceEntry[];
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

function renderSection(metrics: DigestMetrics, over: RenderOverrides = {}) {
  // Only substitute the default series when the caller omitted the key
  // entirely — an explicit `dailyDistanceData: undefined` must reach the
  // component so its `?? []` guard is genuinely exercised (a destructuring
  // default would silently swallow it).
  const hasSeries = Object.prototype.hasOwnProperty.call(over, 'dailyDistanceData');
  const dailyDistanceData = (hasSeries ? over.dailyDistanceData : CHART_DATA) as DailyDistanceEntry[];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DrivingSection
          metrics={metrics}
          dailyDistanceData={dailyDistanceData}
          isLoading={over.isLoading}
          isError={over.isError}
          error={over.error}
          onRetry={over.onRetry}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function title(): HTMLElement {
  return screen.getByRole('heading', { level: 3, name: 'Driving' });
}

function chartRegion(): HTMLElement | null {
  return screen.queryByRole('img', { name: /daily driving distance/i });
}

describe('DrivingSection — structure & always-on regions', () => {
  it('renders the panel title as an h3 whose accessible name excludes the decorative Car icon', () => {
    renderSection(makeMetrics());
    const heading = title();
    expect(heading.tagName).toBe('H3');
    expect(heading).toHaveAccessibleName('Driving');
  });

  it('always renders the chart caption and all four mini-stat labels, even with no data', () => {
    renderSection(makeMetrics(), { dailyDistanceData: [] });

    expect(screen.getByText('Daily Distance (km)')).toBeInTheDocument();
    expect(screen.getByText('Avg Efficiency')).toBeInTheDocument();
    expect(screen.getByText('Total Driving Time')).toBeInTheDocument();
    expect(screen.getByText('Efficiency Change')).toBeInTheDocument();
    expect(screen.getByText('Drives')).toBeInTheDocument();
  });
});

describe('DrivingSection — populated', () => {
  it('renders the labelled chart region and pins every derived stat + the top-drive card', () => {
    const { container } = renderSection(
      makeMetrics({
        avgEfficiencyWhPerM: 0.1524,
        prevAvgEfficiencyWhPerM: 0.1905,
        totalDurationS: 9_000,
        totalDrives: 42,
        topDrive: makeTopDrive(),
      }),
    );

    // Chart branch: the bar chart region carries an accessible name (role=img),
    // and neither the skeleton nor the empty placeholder leaks alongside it.
    expect(chartRegion()).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(
      screen.queryByText('No driving distance data is available for this week.'),
    ).toBeNull();

    // MiniStats: efficiency, h/m split, pctChange (sign preserved), fmtInt count.
    expect(screen.getByText('152.4 Wh/km')).toBeInTheDocument();
    expect(screen.getByText('2.5 h')).toBeInTheDocument();
    expect(screen.getByText('-20.0%')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();

    // Top-drive card: badge, formatted date, and each unit-suffixed metric.
    expect(screen.getByText('Top Drive')).toBeInTheDocument();
    expect(screen.getByText(formatDate('2026-04-04T12:00:00Z'))).toBeInTheDocument();
    expect(screen.getByText('120.6 km')).toBeInTheDocument();
    expect(screen.getByText('1.5 h')).toBeInTheDocument();
    expect(screen.getByText('158.2 Wh/km')).toBeInTheDocument();
  });

  it('shows a green TrendingDown glyph when efficiency improved (lower Wh/km than last week)', () => {
    // Lower Wh/m means efficiency improved.
    const { container } = renderSection(
      makeMetrics({ avgEfficiencyWhPerM: 0.15, prevAvgEfficiencyWhPerM: 0.2 }),
    );

    // pctChange((150−200)/200) = −25 → "-25.0%".
    expect(screen.getByText('-25.0%')).toBeInTheDocument();
    // Improved → emerald down-trend glyph, never the rose up-trend one.
    expect(container.querySelector('.text-emerald-300')).not.toBeNull();
    expect(container.querySelector('.text-rose-300')).toBeNull();
  });

  it('shows a rose TrendingUp glyph when efficiency worsened (higher Wh/km than last week)', () => {
    const { container } = renderSection(
      makeMetrics({ avgEfficiencyWhPerM: 0.22, prevAvgEfficiencyWhPerM: 0.2 }),
    );

    // pctChange((220−200)/200) = +10 → "10.0%".
    expect(screen.getByText('10.0%')).toBeInTheDocument();
    expect(container.querySelector('.text-rose-300')).not.toBeNull();
    expect(container.querySelector('.text-emerald-300')).toBeNull();
  });

  it('renders an em-dash for efficiency change when there is no prior-week baseline', () => {
    renderSection(makeMetrics({ avgEfficiencyWhPerM: 0.175, prevAvgEfficiencyWhPerM: 0 }));
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0.0%')).toBeNull();
  });

  it('groups a large drive count through fmtInt (locale thousands separator)', () => {
    renderSection(makeMetrics({ totalDrives: 1234 }));
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });
});

describe('DrivingSection — daily-distance chart branch', () => {
  it('renders the chart region only when at least one day has distance > 0', () => {
    renderSection(makeMetrics(), { dailyDistanceData: CHART_DATA });
    expect(chartRegion()).toBeInTheDocument();
    expect(
      screen.queryByText('No driving distance data is available for this week.'),
    ).toBeNull();
  });

  it('falls back to the empty placeholder (role=status) when every day is zero', () => {
    renderSection(makeMetrics(), { dailyDistanceData: ZERO_CHART_DATA });

    expect(chartRegion()).toBeNull();
    const status = screen.getAllByRole('status');
    expect(
      status.some((el) =>
        within(el).queryByText('No driving distance data is available for this week.'),
      ),
    ).toBe(true);
  });

  it('treats an empty distance array as no chart data', () => {
    renderSection(makeMetrics(), { dailyDistanceData: [] });
    expect(chartRegion()).toBeNull();
    expect(
      screen.getByText('No driving distance data is available for this week.'),
    ).toBeInTheDocument();
  });

  it('treats a nullish distance series as no chart data via the `?? []` guard', () => {
    // Force the prop undefined to exercise `dailyDistanceData ?? []`.
    renderSection(makeMetrics(), {
      dailyDistanceData: undefined as unknown as DailyDistanceEntry[],
    });
    expect(chartRegion()).toBeNull();
    expect(
      screen.getByText('No driving distance data is available for this week.'),
    ).toBeInTheDocument();
  });
});

describe('DrivingSection — loading', () => {
  it('shows a skeleton (no chart, no empty copy) but keeps the title + mini-stats mounted', () => {
    const { container } = renderSection(
      makeMetrics({ avgEfficiencyWhPerM: 0.1524, totalDrives: 42 }),
      { isLoading: true },
    );

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(chartRegion()).toBeNull();
    expect(
      screen.queryByText('No driving distance data is available for this week.'),
    ).toBeNull();

    // Only the chart area is gated — the title + stat shells remain visible.
    expect(title()).toBeInTheDocument();
    expect(screen.getByText('Avg Efficiency')).toBeInTheDocument();
    expect(screen.getByText('152.4 Wh/km')).toBeInTheDocument();
  });

  it('gives loading precedence over an error (skeleton wins, no QueryError)', () => {
    const { container } = renderSection(makeMetrics(), {
      isLoading: true,
      isError: true,
      error: new ApiError('boom', 500),
    });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Server error')).toBeNull();
  });
});

describe('DrivingSection — error + retry', () => {
  it('surfaces a retryable 5xx error in the chart slot and wires Retry to onRetry', () => {
    const onRetry = vi.fn();
    renderSection(makeMetrics({ avgEfficiencyWhPerM: 0.1524 }), {
      isError: true,
      error: new ApiError('drives feed exploded', 500),
      onRetry,
    });

    // QueryError branches on ApiError.status → the 5xx "Server error" copy.
    expect(screen.getByText('Server error')).toBeInTheDocument();
    // The chart region is replaced, never rendered alongside the error.
    expect(chartRegion()).toBeNull();

    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the title + always-on mini-stats mounted through the error branch', () => {
    renderSection(makeMetrics({ avgEfficiencyWhPerM: 0.1524 }), {
      isError: true,
      error: new ApiError('down', 503),
    });

    expect(title()).toBeInTheDocument();
    // Never a blank panel: the stat shells still render beneath the error.
    expect(screen.getByText('Avg Efficiency')).toBeInTheDocument();
    expect(screen.getByText('152.4 Wh/km')).toBeInTheDocument();
  });
});

describe('DrivingSection — top-drive card', () => {
  it('renders the empty placeholder when there is no top drive', () => {
    renderSection(makeMetrics({ topDrive: undefined }));

    expect(screen.getByText('No top drive is available for this week yet.')).toBeInTheDocument();
    expect(screen.queryByText('Top Drive')).toBeNull();
  });

  it('renders each top-drive field with its unit label when a drive is present', () => {
    renderSection(
      makeMetrics({
        topDrive: makeTopDrive({
          distanceM: 88_400,
          durationS: 3_660,
          energyUsedWh: 12_526.28,
        }),
      }),
    );

    expect(screen.getByText('Top Drive')).toBeInTheDocument();
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('88.4 km')).toBeInTheDocument();
    expect(screen.getByText('1.0 h')).toBeInTheDocument();
    expect(screen.getByText('141.7 Wh/km')).toBeInTheDocument();
  });
});

describe('DrivingSection — null safety', () => {
  it('renders zeroed stats without crashing when the numeric metric fields are undefined', () => {
    const sparse = makeMetrics();
    const holes = sparse as Record<string, unknown>;
    holes.avgEfficiencyWhPerM = undefined;
    holes.prevAvgEfficiencyWhPerM = undefined;
    holes.totalDurationS = undefined;
    holes.totalDrives = undefined;

    renderSection(sparse, { dailyDistanceData: ZERO_CHART_DATA });

    expect(screen.getByText('0.0 Wh/km')).toBeInTheDocument();
    expect(screen.getByText('0.0 h')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    // prevAvgEfficiency ?? 0 = 0 → efficiency change collapses to "—".
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('guards a present top drive whose numeric fields are undefined (zeros + em-dash date)', () => {
    const drive = makeTopDrive();
    const holes = drive as Record<string, unknown>;
    holes.distanceM = undefined;
    holes.durationS = undefined;
    holes.energyUsedWh = undefined;
    holes.startTs = undefined;

    renderSection(makeMetrics({ topDrive: drive, avgEfficiencyWhPerM: 0.2 }));

    expect(screen.getByText('0.0 km')).toBeInTheDocument();
    expect(screen.getAllByText('0.0 h')).toHaveLength(2);
    expect(screen.getByText('0.0 Wh/km')).toBeInTheDocument();
    // formatDate(undefined) → "—" placeholder, never "Invalid Date".
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Invalid Date')).toBeNull();
  });
});
