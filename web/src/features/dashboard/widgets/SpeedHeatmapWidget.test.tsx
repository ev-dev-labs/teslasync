/**
 * SpeedHeatmapWidget — behaviour, branch, null-safety and a11y coverage for the
 * dashboard's day-of-week × hour-of-day average-speed heatmap.
 *
 * What this file pins:
 *   - the three exported pure helpers:
 *       · `buildHeatmap` — the 7×24 accumulator: correct Mon-indexed day / hour
 *         placement, SI→display-unit conversion, cell averaging, the
 *         avg→max_speed fallback, and every skip guard (no start_ts, null /
 *         non-positive / NaN speed);
 *       · the REGRESSION FIX at the heart of this elevation: a malformed
 *         `start_ts` produces an Invalid Date whose getDay()/getHours() are NaN
 *         — the old code then indexed `acc[NaN][NaN]` and threw, crashing the
 *         whole widget. `buildHeatmap` now skips unparseable timestamps;
 *       · `speedToColor` — the empty-cell sentinel for non-positive input, the
 *         4-stop gradient endpoints, the clamp above the max, and the hardening
 *         that keeps a NaN input from crashing lerpColor;
 *       · `lerpColor` — channel interpolation + rounding at the endpoints and
 *         the midpoint;
 *   - the widget's data-source resolution (explicit `vehicleId` prop vs. the
 *     first fleet vehicle vs. an empty fleet → id 0 so the query stays
 *     disabled), and the snake_case `/drives?vehicle_id=…&limit=200` request URL
 *     with NO `/api/v1` prefix;
 *   - every render state fanned out by `WidgetShell` — loading skeleton, the
 *     QueryError panel on failure, the empty state (never a blank panel), and
 *     the working freshness Refresh control;
 *   - the populated full-size widget — the drive-count + peak-speed summary, the
 *     168-cell labelled SVG (role="img"), both title branches (a real cell vs.
 *     "No data"), and the Slow/Fast legend;
 *   - the wide variant's full weekday labels and the compact (1×1) peak metric
 *     with its own no-data em-dash;
 *   - a11y — the decorative grid icons are hidden from the a11y tree and the
 *     heatmap SVG is exposed as a labelled image.
 *
 * Strategy: the vehicle hook (`useVehicles`), the inline TanStack `useQuery`, the
 * API `request` client and `useUnits` are mocked so no network is touched and
 * every query state is controllable per-test. i18n is a passthrough that honours
 * the English default and interpolates `{{var}}` tokens, so the visible copy is
 * deterministic and real. The `unitConversion` / `numberFormat` libs are the
 * REAL implementations so expected speeds are computed the same way the source
 * does. Timestamps are parsed as local wall-clock (no trailing `Z`) so day/hour
 * placement is timezone-independent, and expected indices are derived from the
 * same parse rather than hardcoded. The widget renders inside a MemoryRouter
 * because the shared `QueryError` panel (error branch) calls `useNavigate()`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { Drive } from '@/api/types';
import { convertSpeedFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import SpeedHeatmapWidget, { buildHeatmap, speedToColor, lerpColor } from './SpeedHeatmapWidget';
import type { WidgetSize } from './types';

// ── Mocks ────────────────────────────────────────────────────────────────────

// i18n passthrough: returns the English default and interpolates {{var}} tokens
// so count/speed-bearing copy ("3 drives", "Peak avg 45 mph") assert as real.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      const vars = typeof defaultValue === 'string' ? options : undefined;
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const { useVehiclesMock, useQueryMock, requestMock, useUnitsMock } = vi.hoisted(() => ({
  useVehiclesMock: vi.fn(),
  useQueryMock: vi.fn(),
  requestMock: vi.fn(),
  useUnitsMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQuery: (options: unknown) => useQueryMock(options) };
});

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
}));

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, request: (...args: unknown[]) => requestMock(...args) };
});

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => useUnitsMock(),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Wed 2024-01-03 09:30, LOCAL wall-clock (no `Z`) → tz-independent placement. */
const LOCAL_STAMP = '2024-01-03T09:30:00';

/** Mirror the source's day-remap + hour extraction for the given stamp. */
function cellIndex(stamp: string): { day: number; hour: number } {
  const d = new Date(stamp);
  const jsDay = d.getDay();
  return { day: jsDay === 0 ? 6 : jsDay - 1, hour: d.getHours() };
}

/** Sum of every cell's `count` across the whole grid. */
function totalCount(grid: ReturnType<typeof buildHeatmap>): number {
  return grid.reduce((s, row) => s + row.reduce((r, c) => r + c.count, 0), 0);
}

/**
 * Build a Drive. Overrides are intentionally loose (`unknown`) because several
 * tests exercise runtime-invalid shapes (bad `start_ts`, NaN speeds) that the
 * strict type would reject. `buildHeatmap` only reads start_ts + the speeds.
 */
function makeDrive(over: Partial<Record<keyof Drive, unknown>> = {}): Drive {
  const base: Record<string, unknown> = {
    id: 1,
    vehicle_id: 1,
    start_ts: LOCAL_STAMP,
    avg_speed_mps: 20,
    max_speed_mps: 30,
  };
  return { ...base, ...over } as unknown as Drive;
}

interface QueryResult {
  data: Drive[] | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeResult(over: Partial<QueryResult> = {}): QueryResult {
  return {
    data: [],
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

interface CapturedQuery {
  queryKey: unknown[];
  queryFn: () => Promise<unknown>;
  enabled: boolean;
}
function lastQueryOptions(): CapturedQuery {
  return useQueryMock.mock.calls.at(-1)?.[0] as CapturedQuery;
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <SpeedHeatmapWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useVehiclesMock.mockReset();
  useQueryMock.mockReset();
  requestMock.mockReset();
  useUnitsMock.mockReset();

  useVehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  useQueryMock.mockReturnValue(makeResult());
  requestMock.mockResolvedValue([]);
  useUnitsMock.mockReturnValue({ unitPrefs: { speed: 'mph' } });
});

// ── Pure helper: buildHeatmap ────────────────────────────────────────────────

describe('buildHeatmap', () => {
  it('always returns a full 7×24 grid with coordinates and zeroed empty cells', () => {
    const grid = buildHeatmap([], 'mph');
    expect(grid).toHaveLength(7);
    expect(grid.every((row) => row.length === 24)).toBe(true);
    expect(grid[3][11]).toEqual({ day: 3, hour: 11, avgSpeed: 0, count: 0 });
    expect(totalCount(grid)).toBe(0);
  });

  it('places a drive in the Mon-indexed day/hour cell and converts SI→display unit', () => {
    const { day, hour } = cellIndex(LOCAL_STAMP);
    const grid = buildHeatmap([makeDrive({ avg_speed_mps: 20 })], 'mph');
    const cell = grid[day][hour];
    expect(cell.count).toBe(1);
    // 20 m/s reported in mph — via the REAL converter, not a hand-typed factor.
    expect(cell.avgSpeed).toBeCloseTo(convertSpeedFromSI(20, 'mph'), 5);
    // The same SI input reads differently in km/h — proves the unit is applied.
    expect(buildHeatmap([makeDrive({ avg_speed_mps: 20 })], 'km/h')[day][hour].avgSpeed)
      .toBeCloseTo(convertSpeedFromSI(20, 'km/h'), 5);
  });

  it('averages multiple drives that fall in the same cell', () => {
    const { day, hour } = cellIndex(LOCAL_STAMP);
    const grid = buildHeatmap(
      [makeDrive({ avg_speed_mps: 10 }), makeDrive({ avg_speed_mps: 30 })],
      'mph',
    );
    expect(grid[day][hour].count).toBe(2);
    // mean of 10 and 30 m/s → 20 m/s, then converted.
    expect(grid[day][hour].avgSpeed).toBeCloseTo(convertSpeedFromSI(20, 'mph'), 5);
  });

  it('falls back to max_speed_mps when avg_speed_mps is null', () => {
    const { day, hour } = cellIndex(LOCAL_STAMP);
    const grid = buildHeatmap([makeDrive({ avg_speed_mps: null, max_speed_mps: 25 })], 'mph');
    expect(grid[day][hour].count).toBe(1);
    expect(grid[day][hour].avgSpeed).toBeCloseTo(convertSpeedFromSI(25, 'mph'), 5);
  });

  it('skips drives with no start_ts and drives with no usable speed', () => {
    const grid = buildHeatmap(
      [
        makeDrive({ start_ts: '' }), // missing timestamp
        makeDrive({ start_ts: null }), // missing timestamp
        makeDrive({ avg_speed_mps: null, max_speed_mps: null }), // no speed
        makeDrive({ avg_speed_mps: 0, max_speed_mps: null }), // non-positive
        makeDrive({ avg_speed_mps: -5, max_speed_mps: null }), // negative
      ],
      'mph',
    );
    expect(totalCount(grid)).toBe(0);
  });

  it('REGRESSION: skips an unparseable start_ts instead of crashing on acc[NaN][NaN]', () => {
    // The old implementation threw a TypeError here and took the widget down.
    expect(() => buildHeatmap([makeDrive({ start_ts: 'not-a-real-date' })], 'mph')).not.toThrow();
    const grid = buildHeatmap(
      [makeDrive({ start_ts: 'not-a-real-date' }), makeDrive({ start_ts: LOCAL_STAMP })],
      'mph',
    );
    // Only the valid drive is placed; the bad one is dropped, not fatal.
    expect(totalCount(grid)).toBe(1);
  });

  it('skips a NaN speed rather than poisoning the cell average', () => {
    const grid = buildHeatmap([makeDrive({ avg_speed_mps: NaN, max_speed_mps: null })], 'mph');
    expect(totalCount(grid)).toBe(0);
  });
});

// ── Pure helper: speedToColor ────────────────────────────────────────────────

describe('speedToColor', () => {
  const EMPTY = 'rgba(255,255,255,0.03)';

  it('returns the transparent empty-cell sentinel for non-positive inputs', () => {
    expect(speedToColor(0, 10)).toBe(EMPTY);
    expect(speedToColor(10, 0)).toBe(EMPTY);
    expect(speedToColor(-4, 10)).toBe(EMPTY);
  });

  it('maps the low end to teal and the top of the range to red', () => {
    // t→0 lands on the first stop (teal-500), t=1 on the last stop (red-500).
    expect(speedToColor(1e-9, 10)).toBe('rgb(20,184,166)');
    expect(speedToColor(10, 10)).toBe('rgb(239,68,68)');
  });

  it('clamps a speed above the max to the hottest colour (never past 1)', () => {
    expect(speedToColor(100, 10)).toBe('rgb(239,68,68)');
  });

  it('produces an interpolated rgb() colour in between the stops', () => {
    const mid = speedToColor(5, 10);
    expect(mid).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    expect(mid).not.toBe(EMPTY);
  });

  it('HARDENING: returns the sentinel for non-finite input instead of crashing', () => {
    // Pre-hardening these indexed COLOR_STOPS[NaN] → undefined → threw in lerp.
    expect(() => speedToColor(NaN, 10)).not.toThrow();
    expect(speedToColor(NaN, 10)).toBe(EMPTY);
    expect(speedToColor(10, NaN)).toBe(EMPTY);
    expect(speedToColor(Infinity, 10)).toBe(EMPTY);
  });
});

// ── Pure helper: lerpColor ───────────────────────────────────────────────────

describe('lerpColor', () => {
  it('returns each endpoint verbatim at t=0 and t=1', () => {
    expect(lerpColor([1, 2, 3], [4, 5, 6], 0)).toBe('rgb(1,2,3)');
    expect(lerpColor([1, 2, 3], [4, 5, 6], 1)).toBe('rgb(4,5,6)');
  });

  it('interpolates and rounds each channel at the midpoint', () => {
    expect(lerpColor([0, 0, 0], [10, 20, 30], 0.5)).toBe('rgb(5,10,15)');
    // 1.5 rounds to 2 on every channel.
    expect(lerpColor([0, 0, 0], [3, 3, 3], 0.5)).toBe('rgb(2,2,2)');
  });
});

// ── Data-source resolution + query wiring ────────────────────────────────────

describe('SpeedHeatmapWidget — query wiring', () => {
  it('keys + enables the query on the explicit vehicleId prop', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 99 }] });
    renderWidget({ cols: 2, rows: 2 }, 42);
    const opts = lastQueryOptions();
    expect(opts.queryKey).toEqual(['drives', 42, 'speed-heatmap']);
    expect(opts.enabled).toBe(true);
  });

  it('falls back to the first fleet vehicle when no prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 7 }, { id: 8 }] });
    renderWidget();
    expect(lastQueryOptions().queryKey[1]).toBe(7);
  });

  it('disables the query (id 0) when the fleet is empty and no prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [] });
    renderWidget();
    const opts = lastQueryOptions();
    expect(opts.queryKey[1]).toBe(0);
    expect(opts.enabled).toBe(false);
  });

  it('fetches the snake_case drives endpoint with NO /api/v1 prefix', async () => {
    renderWidget({ cols: 2, rows: 2 }, 42);
    await lastQueryOptions().queryFn();
    expect(requestMock).toHaveBeenCalledWith('/drives?vehicle_id=42&limit=200');
  });
});

// ── Render states ────────────────────────────────────────────────────────────

describe('SpeedHeatmapWidget — states', () => {
  it('renders a loading skeleton while the query is pending', () => {
    useQueryMock.mockReturnValue(makeResult({ isLoading: true, data: undefined }));
    const { container } = renderWidget();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No drive data yet')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('surfaces a QueryError panel (never a blank widget) on failure', () => {
    useQueryMock.mockReturnValue(makeResult({ error: new Error('boom'), isError: true, data: undefined }));
    renderWidget();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No drive data yet')).toBeNull();
  });

  it('shows the empty state when the query returns no drives', () => {
    useQueryMock.mockReturnValue(makeResult({ data: [] }));
    renderWidget();
    expect(screen.getByText('No drive data yet')).toBeInTheDocument();
    // The legend belongs to the populated branch and must not render here.
    expect(screen.queryByText('Slow')).toBeNull();
  });

  it('shows the empty state when every returned drive is unusable', () => {
    useQueryMock.mockReturnValue(
      makeResult({ data: [makeDrive({ start_ts: '' }), makeDrive({ avg_speed_mps: null, max_speed_mps: null })] }),
    );
    renderWidget();
    expect(screen.getByText('No drive data yet')).toBeInTheDocument();
  });

  it('wires the freshness Refresh control back to refetch', () => {
    const refetch = vi.fn();
    useQueryMock.mockReturnValue(
      makeResult({ data: [makeDrive()], dataUpdatedAt: Date.now(), refetch }),
    );
    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ── Populated (full size) ────────────────────────────────────────────────────

describe('SpeedHeatmapWidget — populated (full size)', () => {
  it('renders the drive-count + peak-speed summary and the Slow/Fast legend', () => {
    useQueryMock.mockReturnValue(
      makeResult({
        data: [
          makeDrive({ avg_speed_mps: 20 }),
          makeDrive({ avg_speed_mps: 20 }),
          makeDrive({ avg_speed_mps: 20 }),
        ],
      }),
    );
    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('3 drives')).toBeInTheDocument();
    const peak = fmtNumber(convertSpeedFromSI(20, 'mph'), 0);
    expect(screen.getByText(`Peak avg ${peak} mph`)).toBeInTheDocument();
    expect(screen.getByText('Slow')).toBeInTheDocument();
    expect(screen.getByText('Fast')).toBeInTheDocument();
  });

  it('draws a 168-cell labelled SVG whose tooltips cover the data + no-data branches', () => {
    useQueryMock.mockReturnValue(makeResult({ data: [makeDrive({ avg_speed_mps: 20 })] }));
    renderWidget({ cols: 2, rows: 2 });

    const svg = screen.getByRole('img', { name: /average speed by day of week/i });
    expect(svg.querySelectorAll('rect')).toHaveLength(7 * 24);

    const titles = Array.from(svg.querySelectorAll('title')).map((el) => el.textContent ?? '');
    expect(titles).toHaveLength(7 * 24);
    // The one populated cell carries a speed tooltip; the rest read "No data".
    expect(titles.some((x) => /mph/.test(x) && /1 drives/.test(x))).toBe(true);
    expect(titles.some((x) => /No data/.test(x))).toBe(true);
  });

  it('renders full weekday labels only in the wide (3-col) variant', () => {
    useQueryMock.mockReturnValue(makeResult({ data: [makeDrive({ avg_speed_mps: 20 })] }));

    const wide = renderWidget({ cols: 3, rows: 2 });
    expect(screen.getByText('Wed')).toBeInTheDocument();
    wide.unmount();

    // The narrow variant uses single-letter labels, so "Wed" is absent.
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.queryByText('Wed')).toBeNull();
  });
});

// ── Compact (1×1) variant ────────────────────────────────────────────────────

describe('SpeedHeatmapWidget — compact (1×1)', () => {
  it('shows the peak speed metric and the unit label, without a heatmap', () => {
    useQueryMock.mockReturnValue(makeResult({ data: [makeDrive({ avg_speed_mps: 20 })] }));
    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText(fmtNumber(convertSpeedFromSI(20, 'mph'), 0))).toBeInTheDocument();
    expect(screen.getByText(/Peak/)).toHaveTextContent('mph');
    // No SVG heatmap and no widget title in the compact variant.
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText('Speed Heatmap')).toBeNull();
  });

  it('shows an em-dash instead of a peak when there is no drive data', () => {
    useQueryMock.mockReturnValue(makeResult({ data: [] }));
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

// ── Accessibility ────────────────────────────────────────────────────────────

describe('SpeedHeatmapWidget — accessibility', () => {
  it('hides the decorative grid icon from the accessibility tree', () => {
    useQueryMock.mockReturnValue(makeResult({ data: [makeDrive({ avg_speed_mps: 20 })] }));
    const { container } = renderWidget({ cols: 2, rows: 2 });
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThanOrEqual(1);
  });

  it('exposes the heatmap as a single labelled image (not the icons)', () => {
    useQueryMock.mockReturnValue(makeResult({ data: [makeDrive({ avg_speed_mps: 20 })] }));
    renderWidget({ cols: 2, rows: 2 });
    // Only the heatmap carries role="img"; the aria-hidden icons are excluded.
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });
});
