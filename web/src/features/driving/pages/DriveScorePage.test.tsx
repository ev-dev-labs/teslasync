/**
 * DriveScorePage — behaviour + hardening coverage.
 *
 * DriveScorePage default-exports the page plus a set of pure helpers that are
 * unit-tested directly (the scoring algorithm, grade mapping, tip/achievement
 * builders, the default date window, and the newly-extracted
 * `computePeriodStats`). The page's file-local sub-components
 * (CategoryGaugeCard, the nine render bands) are exercised transitively through
 * the full page render.
 *
 * What is covered:
 *   1. READY   — every section landmark, KPI card, panel title, best/worst
 *      insight, and the "First Drive" achievement render for a scored fleet.
 *   2. API     — when the server DriveScore is present it wins over the
 *      client-side average (overall + grade + trend), and the "Based on N
 *      drives" caption surfaces the server drive count.
 *   3. LOADING — every panel shows a skeleton and no ready values leak.
 *   4. ERROR   — the KPI band AND every data section surface QueryError and
 *      the Retry action is wired to the query's refetch (failure + interaction).
 *   5. EMPTY   — each section shows its own EmptyState (never a blank panel)
 *      and no achievements / insights leak.
 *   6. FILTER  — committing an out-of-range date window empties every section
 *      (the date-filter + state wiring).
 *   7. REFRESH — the icon-only refresh control is labelled and calls refetch.
 *   8. HELPERS — scoreDrive branches (typical / null-fallbacks / floors),
 *      gradeFromScore boundaries, gradeVariant, gradeColor, the default date
 *      window, buildTips, buildAchievements checks, and computePeriodStats
 *      including the cross-month "Best Week" collision fix.
 *
 * Network is never hit: the data hooks, vehicle picker, form controls, and the
 * chart-annotation read are all stubbed. i18n is stubbed so visible copy is the
 * English fallback with {{placeholder}} interpolation applied.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { ToastProvider } from '@/components/feedback/Toast';
import type { Drive } from '@/types/driving';

// ── Hoisted, per-test controllable state ─────────────────────────────
// `drives` feeds the stubbed useDrives; `score` feeds useDriveScore;
// `vehicleId` feeds useSelectedVehicle.
const h = vi.hoisted(() => ({
  drives: undefined as unknown,
  score: undefined as unknown,
  vehicleId: 7 as number | null,
}));

const refetchMock = vi.fn();
const scoreRefetchMock = vi.fn();

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useDriving', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useDriving')>();
  return { ...actual, useDrives: () => h.drives, useDriveScore: () => h.score };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.vehicleId,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

// The trend chart uses <ChartContainer annotations={…}>, which fires a GET for
// saved annotations. Stub that read so the test stays network-free.
vi.mock('@/api/hooks/useAnnotations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useAnnotations')>();
  return { ...actual, useChartAnnotationsAsData: () => ({ annotations: [], isLoading: false }) };
});

// RangePicker → a button that commits a fixed far-future range so the date
// filter empties the page; VehicleSelect → an inert marker. The page owns the
// filter wiring; the picker's own calendar is out of scope here.
vi.mock('@/components/forms', () => ({
  RangePicker: ({
    value,
    onChange,
    triggerTestId,
  }: {
    value: { start: string; end: string };
    onChange: (r: { start: string; end: string }) => void;
    triggerTestId?: string;
    align?: string;
  }) => (
    <button
      type="button"
      data-testid={triggerTestId ?? 'range-picker'}
      data-start={value.start}
      data-end={value.end}
      onClick={() => onChange({ start: '2099-01-01', end: '2099-01-31' })}
    >
      change range
    </button>
  ),
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

import DriveScorePage, {
  scoreDrive,
  gradeFromScore,
  gradeVariant,
  gradeColor,
  getDefaultStartDate,
  getDefaultEndDate,
  buildTips,
  buildAchievements,
  computePeriodStats,
  type ComputedScore,
  type ScoredDrive,
} from './DriveScorePage';

// jsdom lacks matchMedia (framer-motion's useReducedMotion via FadeIn). The
// chart/observer polyfills already live in test-setup.ts.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// ── Fixtures ─────────────────────────────────────────────────────────
const DAY_MS = 86_400_000;
const recentIso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY_MS).toISOString();
const localIso = (y: number, monthIndex: number, day: number) =>
  new Date(y, monthIndex, day, 12, 0, 0).toISOString();

function makeDrive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    vehicleId: 7,
    startTs: recentIso(1),
    endTs: recentIso(1),
    durationS: 1800,
    distanceM: 100_000,
    startAddress: 'Home',
    endAddress: 'Office',
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 60,
    energyUsedWh: 16_000,
    regenEnergyWh: 2_000,
    avgSpeedMps: 20,
    maxSpeedMps: 40,
    avgPowerW: 30_000,
    outsideTempAvgC: 20,
    insideTempAvgC: 21,
    score: null,
    endedStatus: 'completed',
    createdAt: recentIso(1),
    updatedAt: recentIso(1),
    live: false,
    ...overrides,
  };
}

function makeScore(overrides: Partial<ComputedScore> = {}): ComputedScore {
  return {
    total: 70,
    efficiency: 20,
    smoothness: 20,
    speed: 30,
    grade: 'B',
    whPerKm: 160,
    ...overrides,
  };
}

// A+ (95): 130 Wh/km efficiency, gentle power, low speed.
const driveGreat = makeDrive({
  id: 1,
  energyUsedWh: 13_000,
  distanceM: 100_000,
  avgPowerW: 15_000,
  maxSpeedMps: 30,
  startTs: recentIso(1),
  startAddress: 'Home',
  endAddress: 'Office',
});
// F (~8): 400 Wh/km, high power, high speed.
const driveBad = makeDrive({
  id: 2,
  energyUsedWh: 40_000,
  distanceM: 100_000,
  avgPowerW: 120_000,
  maxSpeedMps: 60,
  startTs: recentIso(2),
  startAddress: 'Track',
  endAddress: null,
});
// D (~58): middling everything.
const driveMid = makeDrive({
  id: 3,
  energyUsedWh: 20_000,
  distanceM: 100_000,
  avgPowerW: 40_000,
  maxSpeedMps: 45,
  startTs: recentIso(3),
});

const apiScore = {
  overall: 88,
  efficiency: 34,
  smoothness: 27,
  speedDiscipline: 25,
  grade: 'A',
  totalDrives: 42,
  trend: 'up' as const,
};

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeQuery(overrides: Partial<QueryStub> = {}): QueryStub {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: refetchMock,
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/driving/score']}>
          <DriveScorePage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.drives = makeQuery({ data: [driveGreat, driveBad, driveMid] });
  h.score = makeQuery({ data: undefined, refetch: scoreRefetchMock });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DriveScorePage', () => {
  it('renders every section, KPI, and insight when the fleet is scored', () => {
    renderPage();

    // Page shell.
    expect(screen.getByRole('heading', { level: 1, name: /Drive Score/i })).toBeInTheDocument();

    // Section landmarks — every band is present (no hidden sections).
    for (const name of [
      'Key metrics',
      'Overall Score',
      'Category Breakdown',
      'Score Trend',
      'Score Distribution',
      'Best and worst drives',
      'Drive History',
      'Period averages',
      'Achievements',
    ]) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }

    // KPI band labels (unique to the summary cards).
    expect(screen.getByText('Avg Score')).toBeInTheDocument();
    expect(screen.getByText('Best Score')).toBeInTheDocument();
    expect(screen.getByText('Avg Efficiency')).toBeInTheDocument();

    // Panel titles across the page.
    for (const title of ['Improvement Tips', 'Best Drive', 'Worst Drive', 'Period Statistics']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    // "Grade" is both the hero panel title and the history table column header.
    expect(screen.getAllByText('Grade').length).toBeGreaterThanOrEqual(1);

    // Best / worst drive insight copy is derived from the real scoring.
    expect(
      screen.getByText('Outstanding energy efficiency — minimal energy wasted!'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('High energy consumption — possibly high speeds or cold weather.'),
    ).toBeInTheDocument();

    // With no server score the client average is used → "Stable" trend.
    expect(screen.getAllByText('Stable').length).toBeGreaterThanOrEqual(1);

    // Achievements render and "First Drive" unlocks with any scored drive.
    expect(screen.getByText('First Drive')).toBeInTheDocument();
    expect(screen.getAllByText('Unlocked').length).toBeGreaterThanOrEqual(1);
  });

  it('prefers the server DriveScore over the client average and shows its drive count', () => {
    h.score = makeQuery({ data: apiScore, refetch: scoreRefetchMock });

    renderPage();

    // Server grade + trend win.
    expect(screen.getByText('Grade: A')).toBeInTheDocument();
    expect(screen.getAllByText('Improving').length).toBeGreaterThanOrEqual(1);
    // The server-provided drive count surfaces in the overall panel caption.
    expect(screen.getByText('Based on 42 drives')).toBeInTheDocument();
  });

  it('shows a skeleton in every panel while loading and leaks no ready values', () => {
    h.drives = makeQuery({ isLoading: true, isFetching: true, data: undefined, dataUpdatedAt: 0 });

    const { container } = renderPage();

    expect(screen.getByRole('heading', { level: 1, name: /Drive Score/i })).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    // No resolved insight / achievement copy leaks while loading.
    expect(screen.queryByText('First Drive')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Outstanding energy efficiency — minimal energy wasted!'),
    ).not.toBeInTheDocument();
  });

  it('surfaces QueryError in the KPI band and every section, wiring Retry to refetch', () => {
    h.drives = makeQuery({
      isError: true,
      error: new Error('boom'),
      data: undefined,
      dataUpdatedAt: 0,
    });

    renderPage();

    // The KPI band plus every data section degrade to a QueryError banner.
    expect(screen.getAllByText(/Can't reach server/i).length).toBeGreaterThanOrEqual(10);

    const retryButtons = screen.getAllByRole('button', { name: /^Retry$/i });
    expect(retryButtons.length).toBeGreaterThanOrEqual(10);

    fireEvent.click(retryButtons[0]);
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders a per-section EmptyState (never a blank panel) when no drives are in range', () => {
    h.drives = makeQuery({ data: [] });
    h.score = makeQuery({ data: undefined, refetch: scoreRefetchMock });

    renderPage();

    // Distinct empty-state copy across the bands.
    expect(
      screen.getAllByText('Not enough drives in the selected period to calculate a score.').length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('No drives found for the selected period.')).toBeInTheDocument();
    expect(screen.getByText('Tips appear once drives are scored')).toBeInTheDocument();
    expect(screen.getByText('Achievements unlock as you complete scored drives')).toBeInTheDocument();
    expect(screen.getByText('No weekly/monthly averages available yet')).toBeInTheDocument();

    // The KPI band still renders its labels (never hidden), and no insight leaks.
    expect(screen.getByText('Avg Score')).toBeInTheDocument();
    expect(screen.queryByText('First Drive')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Outstanding energy efficiency — minimal energy wasted!'),
    ).not.toBeInTheDocument();
  });

  it('empties every section when an out-of-range date window is committed', () => {
    renderPage();

    // Ready first: the best-drive insight is on screen.
    expect(
      screen.getByText('Outstanding energy efficiency — minimal energy wasted!'),
    ).toBeInTheDocument();

    // Commit a far-future range that excludes all recent drives.
    fireEvent.click(screen.getByTestId('drive-score-range'));

    expect(
      screen.getAllByText('Not enough drives in the selected period to calculate a score.').length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.queryByText('Outstanding energy efficiency — minimal energy wasted!'),
    ).not.toBeInTheDocument();
  });

  it('exposes a labelled refresh control that triggers refetch', () => {
    renderPage();

    // Two controls share the "Refresh" name: the freshness chip (a span) and
    // the header's icon-only <button>. Target the real button element.
    const refreshButton = screen
      .getAllByRole('button', { name: 'Refresh' })
      .find((el) => el.tagName === 'BUTTON');
    expect(refreshButton).toBeDefined();

    fireEvent.click(refreshButton!);

    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('scoreDrive', () => {
  it('scores a typical drive using the documented category weightings', () => {
    const score = scoreDrive(
      makeDrive({ energyUsedWh: 16_000, distanceM: 100_000, avgPowerW: 30_000, maxSpeedMps: 40 }),
    );
    expect(score).toEqual({
      total: 80,
      efficiency: 30,
      smoothness: 20,
      speed: 30,
      grade: 'A',
      whPerKm: 160,
    });
  });

  it('falls back to battery-delta energy, 200 Wh/km, and default power/speed for null SI fields', () => {
    const score = scoreDrive(
      makeDrive({
        energyUsedWh: null,
        distanceM: null,
        avgPowerW: null,
        maxSpeedMps: null,
        startBatteryPct: null,
        endBatteryPct: null,
      }),
    );
    // distanceM null → division-by-zero guard yields the 200 Wh/km default;
    // avgPowerW null → 30 kW default; maxSpeedMps null → 80 mph default.
    expect(score).toEqual({
      total: 67,
      efficiency: 17,
      smoothness: 20,
      speed: 30,
      grade: 'C',
      whPerKm: 200,
    });
  });

  it('floors efficiency and smoothness at zero for an aggressive drive', () => {
    const score = scoreDrive(
      makeDrive({ energyUsedWh: 40_000, distanceM: 100_000, avgPowerW: 120_000, maxSpeedMps: 60 }),
    );
    expect(score.efficiency).toBe(0);
    expect(score.smoothness).toBe(0);
    expect(score.whPerKm).toBe(400);
    expect(score.grade).toBe('F');
    expect(score.total).toBeLessThan(15);
    expect(score.speed).toBeGreaterThan(0);
    expect(score.speed).toBeLessThan(30);
  });
});

describe('gradeFromScore', () => {
  it('maps score bands to letter grades at their boundaries', () => {
    expect(gradeFromScore(100)).toBe('A+');
    expect(gradeFromScore(90)).toBe('A+');
    expect(gradeFromScore(89)).toBe('A');
    expect(gradeFromScore(80)).toBe('A');
    expect(gradeFromScore(79)).toBe('B');
    expect(gradeFromScore(70)).toBe('B');
    expect(gradeFromScore(69)).toBe('C');
    expect(gradeFromScore(60)).toBe('C');
    expect(gradeFromScore(59)).toBe('D');
    expect(gradeFromScore(50)).toBe('D');
    expect(gradeFromScore(49)).toBe('F');
    expect(gradeFromScore(0)).toBe('F');
  });
});

describe('gradeVariant / gradeColor', () => {
  it('maps grades to the shared Badge variant', () => {
    expect(gradeVariant('A+')).toBe('success');
    expect(gradeVariant('A')).toBe('success');
    expect(gradeVariant('B')).toBe('info');
    expect(gradeVariant('C')).toBe('warning');
    expect(gradeVariant('D')).toBe('danger');
    expect(gradeVariant('F')).toBe('danger');
  });

  it('maps grades to gauge fill colors and falls back for unknown grades', () => {
    expect(gradeColor('A+')).toBe('#39ff14');
    expect(gradeColor('F')).toBe('#f87171');
    expect(gradeColor('Z')).toBe('#94a3b8');
  });
});

describe('default date window', () => {
  it('returns a today→30-days-ago ISO window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    try {
      const end = getDefaultEndDate();
      const start = getDefaultStartDate();
      // getDefaultEndDate is a pure UTC slice → deterministic across timezones.
      expect(end).toBe('2024-06-15');
      expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const spanDays =
        (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS;
      expect(spanDays).toBe(30);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('buildTips', () => {
  const tips = buildTips((_k, fallback) => fallback);

  it('returns nine tips balanced three-per-category', () => {
    expect(tips).toHaveLength(9);
    expect(tips.filter((t) => t.category === 'efficiency')).toHaveLength(3);
    expect(tips.filter((t) => t.category === 'smoothness')).toHaveLength(3);
    expect(tips.filter((t) => t.category === 'speed')).toHaveLength(3);
  });

  it('carries the resolved copy and an icon on each tip', () => {
    expect(tips.map((t) => t.key)).toContain(
      'Coast more by lifting your foot earlier before stops.',
    );
    expect(tips[0].icon).toBeTruthy();
  });
});

describe('buildAchievements', () => {
  const achievements = buildAchievements((_k, fallback) => fallback);
  const byId = (id: string) => {
    const found = achievements.find((a) => a.id === id);
    if (!found) throw new Error(`achievement ${id} not found`);
    return found;
  };

  it('unlocks drive-count achievements at their thresholds', () => {
    const drives = Array.from({ length: 50 }, () => makeDrive());
    expect(byId('first-drive').check([], [makeDrive()])).toBe(true);
    expect(byId('first-drive').check([], [])).toBe(false);
    expect(byId('ten-drives').check([], drives.slice(0, 10))).toBe(true);
    expect(byId('ten-drives').check([], drives.slice(0, 9))).toBe(false);
    expect(byId('fifty-drives').check([], drives)).toBe(true);
  });

  it('unlocks Perfect Score only at a full 100', () => {
    expect(byId('perfect-score').check([makeScore({ total: 100 })], [])).toBe(true);
    expect(byId('perfect-score').check([makeScore({ total: 99 })], [])).toBe(false);
  });

  it('requires five consecutive A+ drives for the streak', () => {
    const aplus = makeScore({ grade: 'A+' });
    const other = makeScore({ grade: 'B' });
    expect(byId('a-plus-streak').check([aplus, aplus, aplus, aplus, aplus], [])).toBe(true);
    expect(byId('a-plus-streak').check([aplus, aplus, aplus, aplus], [])).toBe(false);
    // A broken streak resets the counter.
    expect(
      byId('a-plus-streak').check([aplus, aplus, other, aplus, aplus, aplus], []),
    ).toBe(false);
  });

  it('counts per-category mastery achievements', () => {
    expect(
      byId('efficiency-master').check(
        [makeScore({ efficiency: 38 }), makeScore({ efficiency: 39 }), makeScore({ efficiency: 40 })],
        [],
      ),
    ).toBe(true);
    expect(
      byId('efficiency-master').check([makeScore({ efficiency: 38 }), makeScore({ efficiency: 39 })], []),
    ).toBe(false);
    expect(
      byId('smooth-operator').check(Array.from({ length: 3 }, () => makeScore({ smoothness: 28 })), []),
    ).toBe(true);
    expect(
      byId('speed-saint').check(Array.from({ length: 5 }, () => makeScore({ speed: 28 })), []),
    ).toBe(true);
    expect(
      byId('speed-saint').check(Array.from({ length: 4 }, () => makeScore({ speed: 28 })), []),
    ).toBe(false);
  });
});

describe('computePeriodStats', () => {
  const scored = (startTs: string, score: Partial<ComputedScore>): ScoredDrive => ({
    drive: makeDrive({ startTs }),
    score: makeScore(score),
  });

  it('returns null when there are no scored drives', () => {
    expect(computePeriodStats([], new Date())).toBeNull();
  });

  it('keeps the same week-of-month in different months as separate weeks', () => {
    // June 12 and July 17, 2024 both land in "week 3" of their month. The old
    // year-week key collapsed them into one bucket (avg 70); the fixed
    // year-month-week key keeps them apart so Best Week is the real 90.
    const june = scored(localIso(2024, 5, 12), { total: 90, grade: 'A+' });
    const july = scored(localIso(2024, 6, 17), { total: 50, grade: 'D' });
    const stats = computePeriodStats([june, july], new Date(2024, 6, 31, 12, 0, 0));
    expect(stats).not.toBeNull();
    if (!stats) return;

    expect(stats.totalDrives).toBe(2);
    expect(stats.aOrBetter).toBe(1);
    expect(stats.bestWeek.avg).toBe(90);
    expect(stats.bestWeek.label).toContain('-06-');
    expect(stats.bestMonth.avg).toBe(90);
    expect(stats.bestMonth.label).toBe('2024-06');
    expect(stats.thisMonthAvg).toBe(50);
    expect(stats.lastMonthAvg).toBe(90);
    expect(stats.thisWeekAvg).toBeNull();
  });

  it('averages drives that fall within the same actual week', () => {
    const a = scored(localIso(2024, 5, 11), { total: 80, grade: 'A' });
    const b = scored(localIso(2024, 5, 12), { total: 90, grade: 'A+' });
    const stats = computePeriodStats([a, b], new Date(2024, 6, 15, 12, 0, 0));
    expect(stats).not.toBeNull();
    if (!stats) return;

    expect(stats.bestWeek.avg).toBe(85);
    expect(stats.totalDrives).toBe(2);
    expect(stats.aOrBetter).toBe(2);
    expect(stats.lastMonthAvg).toBe(85);
  });
});
