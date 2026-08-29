/**
 * YearMonthlyChart — behaviour, branch, SI-derivation, a11y + null-safety coverage.
 *
 * The component is a presentational leaf: it takes a fully-loaded `YearReview`
 * and derives one `rows` array (`month`, `drives`, `distance`, `energy`) that it
 * feeds to a shared <ChartContainer> (bars = drives, line = distance) plus the
 * container's screen-reader / forced-colors fallback `<table>`. All of the
 * interesting logic lives in that derivation:
 *
 *   - `distance` is converted from the SI `distance_km` at the DISPLAY boundary
 *     via the REAL `convertDistanceFromSI` + the user's `useUnits()` pref, so km
 *     and mi produce different rounded values (and the series is re-labelled);
 *   - `energy` is read straight from the backend's derived `energy_kwh` field
 *     (kWh) — the regression this file pins is the old code reading a
 *     non-existent `energy_wh` key and re-dividing by 1000, which silently
 *     zeroed every month;
 *   - `month` is a locale short-name that clamps out-of-range / missing month
 *     numbers instead of letting `Date` wrap to an adjacent month;
 *   - an empty (or missing) `monthly_stats` shows the container's empty state
 *     while the title + accessible frame stay mounted (never a blank panel);
 *   - the subtitle interpolates a grouped, null-safe average-per-week count.
 *
 * Strategy: the component takes its data as a prop, so no network is touched.
 * `@/hooks/useUnits` is mocked with a mutable return so each test can flip the
 * distance unit while the REAL conversion lib runs. `@/hooks/useChartExport` is
 * stubbed (the container renders a real <ChartExportMenu> because this chart is
 * `exportable`). Only `react-i18next` is mocked so `t(key, fallback)` /
 * `t(key, { defaultValue, ...vars })` render the English fallback (with
 * {{var}} interpolation) deterministically. <ChartContainer> transitively pulls
 * in react-query (annotation hooks) and react-router (<EmptyState>'s <Link>),
 * so the tree is wrapped in QueryClientProvider + MemoryRouter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { YearReview, YearReviewMonthStat } from '@/api/types';

// jsdom lacks matchMedia; install a benign stub before any shared UI module that
// might read it at import time evaluates (defensive — shared chart UI pulls it in).
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

// Mutable useUnits mock — lets each test choose the display distance unit while
// the REAL convertDistanceFromSI runs downstream.
const { unitsMock } = vi.hoisted(() => ({ unitsMock: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => unitsMock() }));

// Deterministic export hook — the container renders a real <ChartExportMenu>
// because this chart is `exportable`; we only need the callbacks to be inert
// spies so opening the menu never reaches image-capture code.
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null },
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    copyToClipboard: vi.fn(async () => 'copied' as const),
    exporting: false,
  }),
}));

// i18n → return the developer fallback string, interpolating {{vars}} so the
// subtitle / labels read as real English. Handles all three call shapes the
// component + ChartContainer use: t(key, 'fallback'),
// t(key, 'fallback', { vars }), t(key, { defaultValue, ...vars }).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (template: string, vars?: Record<string, unknown>) =>
    vars
      ? template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        )
      : template;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        if (typeof second === 'string') {
          const vars = third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined;
          return interpolate(second, vars);
        }
        if (second && typeof second === 'object') {
          const opts = second as Record<string, unknown>;
          const template = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
          return interpolate(template, opts);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// ChartContainer wires up chart annotations unconditionally. We never pass
// `annotations`, so the results are unused — stub the hooks to no-ops so the
// tree doesn't demand a live query, mirroring the shared ChartContainer test.
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));

import { YearMonthlyChart } from './YearMonthlyChart';

const UNIT_PREFS_KM = {
  distance: 'km',
  speed: 'km/h',
  temperature: '°C',
  pressure: 'bar',
  energy: 'kWh',
  duration: 'h',
  power: 'kW',
  locale: 'en-US',
  precision: undefined,
} as const;
const UNIT_PREFS_MI = { ...UNIT_PREFS_KM, distance: 'mi', speed: 'mph' } as const;

/** useUnits return bag — only `unitPrefs` is read; formatters are inert spies. */
function unitsResult(unitPrefs: typeof UNIT_PREFS_KM | typeof UNIT_PREFS_MI) {
  return {
    unitPrefs,
    formatDistance: vi.fn(),
    formatSpeed: vi.fn(),
    formatTemperature: vi.fn(),
    formatPressure: vi.fn(),
    formatEnergy: vi.fn(),
    formatDuration: vi.fn(),
    formatPower: vi.fn(),
  };
}

/** Build one month stat; every field defaults to a zeroed SI value. */
function month(over: Partial<YearReviewMonthStat> = {}): YearReviewMonthStat {
  return { month: 1, drives: 0, distance_km: 0, energy_kwh: 0, cost: 0, ...over };
}

/**
 * A full, zeroed YearReview so each test overrides only the fields it reads
 * (`monthly_stats` + `avg_drives_per_week`); the prop type demands the rest.
 */
function makeReview(over: Partial<YearReview> = {}): YearReview {
  return {
    year: 2024,
    vehicle: { id: 1, display_name: 'Model 3', model: 'model3' },
    total_drives: 0,
    total_distance_km: 0,
    total_energy_kwh: 0,
    total_charge_sessions: 0,
    total_driving_minutes: 0,
    total_charging_cost: 0,
    gas_savings: 0,
    co2_offset_kg: 0,
    longest_drive: null,
    shortest_drive: null,
    most_efficient_drive: null,
    least_efficient_drive: null,
    fastest_speed_kmh: 0,
    coldest_drive_temp_c: 0,
    hottest_drive_temp_c: 0,
    monthly_stats: [],
    most_active_day_of_week: '',
    most_active_hour: 0,
    avg_drives_per_week: 3,
    avg_distance_per_drive_km: 0,
    avg_efficiency_wh_km: 0,
    supercharger_pct: 0,
    dc_fast_pct: 0,
    ac_other_pct: 0,
    avg_charge_start_soc: 0,
    comparisons: [],
    ...over,
  };
}

function renderChart(data: YearReview) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <YearMonthlyChart data={data} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The container's SR/forced-colors fallback <table> (visually hidden, in DOM). */
function fallbackTable(): HTMLElement {
  const caption = screen.getByText('Monthly activity — data table');
  const table = caption.closest('table');
  if (!(table instanceof HTMLElement)) throw new Error('no fallback data table');
  return table;
}

/** The <td> texts of the fallback-table data row whose first cell is `label`. */
function dataRowCells(label: string): string[] {
  const rows = Array.from(fallbackTable().querySelectorAll('tbody tr'));
  for (const r of rows) {
    const cells = Array.from(r.querySelectorAll('td')).map((c) => c.textContent ?? '');
    if (cells[0] === label) return cells;
  }
  throw new Error(`no data row for month "${label}"`);
}

beforeEach(() => {
  unitsMock.mockReturnValue(unitsResult(UNIT_PREFS_KM));
});

describe('YearMonthlyChart — populated (metric / km)', () => {
  it('renders the title, interpolated subtitle, and the accessible chart frame', () => {
    renderChart(
      makeReview({
        avg_drives_per_week: 3,
        monthly_stats: [month({ month: 1, drives: 10, distance_km: 800, energy_kwh: 342 })],
      }),
    );

    // Title is the ChartContainer heading (h3).
    expect(screen.getByRole('heading', { level: 3, name: 'Monthly activity' })).toBeInTheDocument();
    // Subtitle interpolates the average-per-week count.
    expect(screen.getByText('3 drives per week on average')).toBeInTheDocument();
    // The interactive chart body is a named group for its legend controls.
    expect(
      screen.getByRole('group', {
        name: 'Bar and line chart of monthly drives and distance across the year',
      }),
    ).toBeInTheDocument();
  });

  it('builds the SR data table with month, drives, distance(km) and kWh columns', () => {
    renderChart(
      makeReview({
        monthly_stats: [
          month({ month: 1, drives: 10, distance_km: 800, energy_kwh: 342 }),
          month({ month: 2, drives: 14, distance_km: 1100, energy_kwh: 410 }),
        ],
      }),
    );

    const table = fallbackTable();
    expect(within(table).getByText('Monthly activity — data table')).toBeInTheDocument();
    expect(within(table).getByText('Month')).toBeInTheDocument();
    expect(within(table).getByText('drives')).toBeInTheDocument();
    expect(within(table).getByText('Distance (km)')).toBeInTheDocument();
    expect(within(table).getByText('kWh')).toBeInTheDocument();

    // Two data rows, each with the derived cell values.
    expect(dataRowCells('Jan')).toEqual(['Jan', '10', '800', '342']);
    expect(dataRowCells('Feb')).toEqual(['Feb', '14', '1100', '410']);
  });
});

describe('YearMonthlyChart — SI distance derivation', () => {
  it('rounds distance from SI meters to km (identity scale) at the display boundary', () => {
    renderChart(makeReview({ monthly_stats: [month({ month: 1, distance_km: 1609.344 })] }));
    // km: 1609.344 km → 1,609,344 m → /1000 → 1609.
    expect(dataRowCells('Jan')[2]).toBe('1609');
    expect(within(fallbackTable()).getByText('Distance (km)')).toBeInTheDocument();
  });

  it('converts distance to miles and relabels the series when the pref is imperial', () => {
    unitsMock.mockReturnValue(unitsResult(UNIT_PREFS_MI));
    renderChart(makeReview({ monthly_stats: [month({ month: 1, distance_km: 1609.344 })] }));
    // mi: 1609.344 km → 1,609,344 m → /1609.344 → 1000 (real conversion, not identity).
    expect(dataRowCells('Jan')[2]).toBe('1000');
    expect(within(fallbackTable()).getByText('Distance (mi)')).toBeInTheDocument();
    // The km label must be gone — proves the unit pref actually threads through.
    expect(within(fallbackTable()).queryByText('Distance (km)')).toBeNull();
  });
});

describe('YearMonthlyChart — energy_kwh regression', () => {
  it('reads monthly energy straight from energy_kwh without re-dividing by 1000', () => {
    renderChart(
      makeReview({ monthly_stats: [month({ month: 1, drives: 10, distance_km: 800, energy_kwh: 350 })] }),
    );

    // The regression: old code read a non-existent `energy_wh` and divided by
    // 1000, which zeroed the column. The kWh cell must show the real value.
    expect(dataRowCells('Jan')).toEqual(['Jan', '10', '800', '350']);
    expect(dataRowCells('Jan')[3]).toBe('350');
    // Nothing in the table is zeroed — the pre-fix bug rendered energy as "0".
    expect(within(fallbackTable()).queryByText('0')).toBeNull();
  });
});

describe('YearMonthlyChart — month labels', () => {
  it('formats a mid-year month with the locale short name', () => {
    renderChart(makeReview({ monthly_stats: [month({ month: 7, drives: 1 })] }));
    expect(within(fallbackTable()).getByText('Jul')).toBeInTheDocument();
  });

  it('clamps out-of-range month indices instead of wrapping to an adjacent month', () => {
    // month 13 would wrap to Jan (next year) under a raw Date; clamp → Dec.
    const { unmount } = renderChart(makeReview({ monthly_stats: [month({ month: 13, drives: 1 })] }));
    expect(within(fallbackTable()).getByText('Dec')).toBeInTheDocument();
    expect(within(fallbackTable()).queryByText('Jan')).toBeNull();
    unmount();

    // month 0 would wrap to Dec (prev year) under a raw Date; clamp → Jan.
    renderChart(makeReview({ monthly_stats: [month({ month: 0, drives: 1 })] }));
    expect(within(fallbackTable()).getByText('Jan')).toBeInTheDocument();
    expect(within(fallbackTable()).queryByText('Dec')).toBeNull();
  });
});

describe('YearMonthlyChart — empty state', () => {
  it('shows the empty placeholder (never a blank panel) with no data table', () => {
    renderChart(makeReview({ monthly_stats: [] }));

    expect(screen.getByText('No data available')).toBeInTheDocument();
    // The title stays mounted while the empty state replaces the chart image.
    expect(screen.getByRole('heading', { level: 3, name: 'Monthly activity' })).toBeInTheDocument();
    expect(
      screen.queryByRole('group', {
        name: 'Bar and line chart of monthly drives and distance across the year',
      }),
    ).toBeNull();
    // No fallback data table is built when there are zero rows.
    expect(screen.queryByText('Monthly activity — data table')).toBeNull();
  });

  it('treats a missing monthly_stats array as empty without crashing', () => {
    const sparse = { ...makeReview(), monthly_stats: undefined as unknown as YearReviewMonthStat[] };
    renderChart(sparse);
    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.queryByText('Monthly activity — data table')).toBeNull();
  });
});

describe('YearMonthlyChart — null safety', () => {
  it('coerces null numeric fields and a missing month to safe defaults', () => {
    const nullish = {
      month: null,
      drives: null,
      distance_km: null,
      energy_kwh: null,
      cost: null,
    } as unknown as YearReviewMonthStat;

    renderChart(makeReview({ monthly_stats: [nullish] }));

    // month → Jan (default), every numeric → 0, no crash.
    expect(dataRowCells('Jan')).toEqual(['Jan', '0', '0', '0']);
  });

  it('renders a null-safe, grouped average-per-week subtitle', () => {
    renderChart(makeReview({ avg_drives_per_week: 1234.6, monthly_stats: [month({ drives: 1 })] }));
    // fmtInt groups + rounds: 1234.6 → "1,235".
    expect(screen.getByText('1,235 drives per week on average')).toBeInTheDocument();
  });

  it('falls back to zero when the average-per-week count is missing', () => {
    const review = { ...makeReview({ monthly_stats: [month({ drives: 1 })] }), avg_drives_per_week: undefined as unknown as number };
    renderChart(review);
    expect(screen.getByText('0 drives per week on average')).toBeInTheDocument();
  });
});

describe('YearMonthlyChart — export affordance (interaction)', () => {
  it('exposes an export control and opens the menu on activation', () => {
    renderChart(makeReview({ monthly_stats: [month({ month: 6, drives: 5, distance_km: 100 })] }));

    const trigger = screen.getByRole('button', { name: 'Export chart' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Export chart' })).toBeInTheDocument();
  });
});
