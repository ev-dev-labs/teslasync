/**
 * TripDrivesChart — behaviour, branch, SI-derivation, a11y, interaction and
 * null-safety coverage for the file's sole export (`TripDrivesChart`).
 *
 * The component is a presentational leaf on the Trip Detail page: given a
 * `TripDetail` (plus the query's loading / error flags and a retry callback) it
 * derives one `rows` array (`name`, `distance`) from `trip.drives[]` and feeds
 * it to a shared <ChartContainer> (a horizontal bar chart + the container's
 * screen-reader / forced-colors fallback `<table>`). Recharts measures the SVG
 * bounding box and jsdom reports 0 × 0, so the chart body renders nothing —
 * every VALUE assertion therefore targets the always-present fallback table.
 *
 * What this file pins:
 *   - the DISPLAY-BOUNDARY conversion: `distance_m` (SI meters) is converted to
 *     the user's unit via the REAL `convertDistanceFromSI` + `useUnits()` pref,
 *     so km and mi produce different rounded values AND relabel the column;
 *   - the 1-indexed drive LABELS (`Drive 1`, `Drive 2`, …) independent of the
 *     drive's `id`;
 *   - NULL-SAFETY: a `null` (or non-finite) `distance_m` degrades to `0.0`
 *     without poisoning sibling rows — the hardened `safeNumber(...)` guard
 *     (not `?? 0`, which would let NaN/Infinity through to the chart bar);
 *   - the three data states — LOADING (spinner, no table), EMPTY (shared
 *     "No data available", never a blank panel), and ERROR (a bespoke
 *     <QueryError> panel that replaces the chart, with actionable recovery
 *     copy per status: 404 → "Trip not found" + Back-to-list, 5xx → Server
 *     error + a Retry that invokes `onRetry`);
 *   - the export affordance the shared container ships.
 *
 * Strategy: the component takes its data as a prop, so no network is touched.
 * `@/hooks/useUnits` is mocked with a mutable return so each test can flip the
 * distance unit while the REAL conversion lib runs. `@/hooks/useChartExport` is
 * stubbed (the container renders a real <ChartExportMenu>). `react-i18next` is
 * mocked so `t(key, fallback)` / `t(key, fallback, {vars})` render the English
 * fallback (with {{var}} interpolation) deterministically. <ChartContainer> +
 * <QueryError> transitively pull in react-query (annotation hooks) and
 * react-router (navigate / <Link>), so the tree is wrapped in
 * QueryClientProvider + MemoryRouter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { TripDetail, TripDriveSummary } from '@/api/types';

// jsdom lacks matchMedia; framer-motion's useReducedMotion (reached via shared
// UI / the Spinner) reads it. Install a benign stub before any shared module
// evaluates.
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

// Deterministic export hook — the container renders a real <ChartExportMenu>;
// the callbacks only need to be inert spies so opening the menu never reaches
// image-capture code.
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null },
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    copyToClipboard: vi.fn(async () => 'copied' as const),
    exporting: false,
  }),
}));

// <ChartContainer> wires annotation hooks unconditionally; we never pass
// `annotations`, so stub them to no-ops instead of demanding a live query.
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));

// i18n → return the developer fallback string, interpolating {{vars}} so labels
// read as real English. Handles t(key, 'fallback'), t(key, 'fallback', {vars})
// and t(key, { defaultValue, ...vars }).
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

import { TripDrivesChart } from './TripDrivesChart';

const TITLE = 'Distance by Drive';
const CHART_ARIA =
  'Distance travelled per drive within this trip, as a horizontal bar chart';
const TABLE_CAPTION = 'Distance by Drive — data table';

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

/** Build one trip-drive; every field defaults to a null/unrecorded value. */
function drive(over: Partial<TripDriveSummary> = {}): TripDriveSummary {
  return {
    id: 1,
    started_at: '2024-06-01T10:00:00Z',
    ended_at: '2024-06-01T10:30:00Z',
    distance_m: null,
    energy_used_wh: null,
    duration_s: null,
    start_place: null,
    end_place: null,
    ...over,
  };
}

/**
 * A full, zeroed TripDetail so each test overrides only the field it reads
 * (`drives`); the prop type (a superset of `Trip`) demands the rest.
 */
function makeTrip(over: Partial<TripDetail> = {}): TripDetail {
  return {
    id: 1,
    vehicle_id: 1,
    name: 'Road trip',
    start_date: '2024-06-01',
    end_date: '2024-06-02',
    started_at: '2024-06-01T10:00:00Z',
    ended_at: '2024-06-02T18:00:00Z',
    total_distance_m: 0,
    total_energy_wh: 0,
    total_duration_s: 0,
    total_cost: 0,
    drive_count: 0,
    charge_count: 0,
    created_at: '2024-06-01T09:00:00Z',
    energy_used_wh: 0,
    drives: [],
    ...over,
  };
}

/** Duck-typed ApiError — `isApiError` accepts `{ name: 'ApiError', status }`. */
function apiError(status: number): unknown {
  return { name: 'ApiError', status, message: `http ${status}` };
}

interface RenderOpts {
  trip?: TripDetail;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

function renderChart(opts: RenderOpts = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onRetry = opts.onRetry ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TripDrivesChart
          trip={opts.trip}
          isLoading={opts.isLoading ?? false}
          isError={opts.isError ?? false}
          error={opts.error ?? null}
          onRetry={onRetry}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, onRetry };
}

/** The container's SR/forced-colors fallback <table> (visually hidden, in DOM). */
function fallbackTable(): HTMLElement {
  const caption = screen.getByText(TABLE_CAPTION);
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
  throw new Error(`no data row for "${label}"`);
}

beforeEach(() => {
  unitsMock.mockReturnValue(unitsResult(UNIT_PREFS_KM));
});

describe('TripDrivesChart — chrome + a11y', () => {
  it('renders the title, the accessible chart frame, and the SR fallback table', () => {
    renderChart({ trip: makeTrip({ drives: [drive({ id: 1, distance_m: 5000 })] }) });

    // Title is the ChartContainer heading (h3).
    expect(screen.getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument();
    // The chart body re-states the summary via role="img" + aria-label.
    expect(screen.getByRole('img', { name: CHART_ARIA })).toBeInTheDocument();
    // The always-present SR/forced-colors data table.
    expect(within(fallbackTable()).getByText(TABLE_CAPTION)).toBeInTheDocument();
  });

  it('builds the fallback table with the localized Drive + Distance(km) columns', () => {
    renderChart({ trip: makeTrip({ drives: [drive({ id: 1, distance_m: 5000 })] }) });

    const table = fallbackTable();
    // Column header "Drive" (exact) must not collide with row cell "Drive 1".
    expect(within(table).getByText('Drive')).toBeInTheDocument();
    expect(within(table).getByText('Distance (km)')).toBeInTheDocument();
  });
});

describe('TripDrivesChart — per-drive rows + 1-indexed labels', () => {
  it('emits one row per drive, numbered Drive N by position (not by id)', () => {
    renderChart({
      trip: makeTrip({
        drives: [
          drive({ id: 7, distance_m: 5000 }), // 5 km
          drive({ id: 3, distance_m: 12345 }), // 12.345 km → 12.3
        ],
      }),
    });

    // Label is 1-indexed by array position, independent of the drive id.
    expect(dataRowCells('Drive 1')).toEqual(['Drive 1', '5.0']);
    expect(dataRowCells('Drive 2')).toEqual(['Drive 2', '12.3']);
  });

  it('formats a large distance with locale grouping separators', () => {
    // 1,234,500 m → 1234.5 km → "1,234.5" under en-US grouping.
    renderChart({ trip: makeTrip({ drives: [drive({ distance_m: 1234500 })] }) });
    expect(dataRowCells('Drive 1')[1]).toBe('1,234.5');
  });
});

describe('TripDrivesChart — SI distance derivation (display boundary)', () => {
  it('converts SI meters to km (identity scale) and labels the column km', () => {
    // 1609.344 km input? No — 1609.344 METERS → 1.609344 km → "1.6".
    renderChart({ trip: makeTrip({ drives: [drive({ distance_m: 1609.344 })] }) });

    expect(dataRowCells('Drive 1')[1]).toBe('1.6');
    expect(within(fallbackTable()).getByText('Distance (km)')).toBeInTheDocument();
  });

  it('converts to miles and relabels the column when the pref is imperial', () => {
    unitsMock.mockReturnValue(unitsResult(UNIT_PREFS_MI));
    // 1609.344 m → exactly 1.0 mi (real conversion, not identity).
    renderChart({ trip: makeTrip({ drives: [drive({ distance_m: 1609.344 })] }) });

    expect(dataRowCells('Drive 1')[1]).toBe('1.0');
    expect(within(fallbackTable()).getByText('Distance (mi)')).toBeInTheDocument();
    // The km label must be gone — proves the unit pref threads through.
    expect(within(fallbackTable()).queryByText('Distance (km)')).toBeNull();
  });
});

describe('TripDrivesChart — null safety', () => {
  it('degrades a null distance to 0.0 without poisoning a sibling drive', () => {
    renderChart({
      trip: makeTrip({
        drives: [
          drive({ id: 1, distance_m: null }),
          drive({ id: 2, distance_m: 3000 }), // 3 km
        ],
      }),
    });

    expect(dataRowCells('Drive 1')).toEqual(['Drive 1', '0.0']);
    // The null drive must not collapse the finite sibling.
    expect(dataRowCells('Drive 2')).toEqual(['Drive 2', '3.0']);
  });

  it('coerces a non-finite distance to 0.0 (safeNumber guard, not `?? 0`)', () => {
    // `?? 0` would let NaN through to the chart bar; safeNumber pins it to 0.
    expect(() =>
      renderChart({ trip: makeTrip({ drives: [drive({ distance_m: Number.NaN })] }) }),
    ).not.toThrow();
    expect(dataRowCells('Drive 1')[1]).toBe('0.0');
  });
});

describe('TripDrivesChart — empty state (never a blank panel)', () => {
  it('surfaces the shared empty state for a trip with zero drives', () => {
    renderChart({ trip: makeTrip({ drives: [] }) });

    expect(screen.getByText('No data available')).toBeInTheDocument();
    // Title + accessible figure stay mounted (the panel is never truly blank).
    expect(screen.getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: TITLE })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: CHART_ARIA })).toBeNull();
    // No fallback data table when there is nothing to show.
    expect(screen.queryByText(TABLE_CAPTION)).toBeNull();
  });

  it('treats an undefined trip (not loading, no error) as empty without crashing', () => {
    expect(() => renderChart({ trip: undefined, isLoading: false })).not.toThrow();
    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.queryByText(TABLE_CAPTION)).toBeNull();
  });
});

describe('TripDrivesChart — loading state', () => {
  it('shows the spinner (not empty, not a table) while the first load is pending', () => {
    renderChart({ trip: undefined, isLoading: true });

    expect(screen.getByRole('status', { name: 'Loading chart…' })).toBeInTheDocument();
    // Loading is distinct from empty and from a populated table.
    expect(screen.queryByText('No data available')).toBeNull();
    expect(screen.queryByText(TABLE_CAPTION)).toBeNull();
  });

  it('keeps rendering stale data (no spinner flash) on a background refetch', () => {
    // isLoading true but trip already present → loading gate is false, so the
    // populated chart/table stay mounted instead of flashing a spinner.
    renderChart({ trip: makeTrip({ drives: [drive({ distance_m: 8000 })] }), isLoading: true });

    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
    expect(dataRowCells('Drive 1')).toEqual(['Drive 1', '8.0']);
  });
});

describe('TripDrivesChart — error branch (replaces the chart)', () => {
  it('renders the error panel instead of the chart on a network failure', () => {
    renderChart({ isError: true, error: new Error('network down') });

    // The chart title still frames the panel via <PanelTitle>.
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    // The chart figure + data table are gone — the error owns the surface.
    expect(screen.queryByRole('img', { name: CHART_ARIA })).toBeNull();
    expect(screen.queryByText(TABLE_CAPTION)).toBeNull();
  });

  it('invokes onRetry when the user clicks Retry on a server (5xx) error', () => {
    const onRetry = vi.fn();
    renderChart({ isError: true, error: apiError(500), onRetry });

    expect(screen.getByText('Server error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers a not-found panel with a back-to-list affordance on 404', () => {
    renderChart({ isError: true, error: apiError(404) });

    // resourceName "Trip" is interpolated into the not-found title.
    expect(screen.getByText('Trip not found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to list' })).toBeInTheDocument();
  });
});

describe('TripDrivesChart — export affordance (interaction)', () => {
  it('exposes an export control that opens the menu on activation', () => {
    renderChart({ trip: makeTrip({ drives: [drive({ distance_m: 5000 })] }) });

    const trigger = screen.getByRole('button', { name: 'Export chart' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Save as PNG' })).toBeInTheDocument();
  });
});
