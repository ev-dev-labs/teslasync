/**
 * ChargerTypeChart — behaviour, grouping/averaging, branch, a11y, null-safety
 * + regression coverage for the sole export (the default `ChargerTypeChart`).
 *
 * The component is a presentational leaf: given a `ChargingSession[]` it buckets
 * the sessions by charger label (`getChargerLabel`), derives per-bucket
 * `count` / `avgKw` / `avgKwh` / `avgDuration`, and feeds them to a shared
 * <ChartContainer> (a Composed bar chart + a per-bucket legend + the
 * container's screen-reader / forced-colors fallback `<table>`). All of the
 * interesting logic — and every assertion here — lives in that derivation and
 * in the container chrome, because Recharts measures the SVG bounding box and
 * jsdom reports 0 × 0, so the chart body itself renders nothing. Every value
 * assertion therefore targets the always-present fallback data table.
 *
 * This file pins three things the hardening pass fixed:
 *   1. the EMPTY branch — a `sessions=[]` prop must surface the shared
 *      <EmptyState> ("No data available") instead of a blank chart panel
 *      (the pre-fix component never passed `empty` to <ChartContainer>);
 *   2. NULL-SAFETY — an `undefined` `sessions` prop must route to the empty
 *      state instead of throwing on `sessions.length`, and a missing
 *      `total_energy_added_wh` must NOT poison its bucket's average (the
 *      pre-fix `s.total_energy_added_wh / 1000` produced `NaN`, which the
 *      `avg()` reducer then propagated across the whole bucket);
 *   3. the label BRANCHES of `getChargerLabel` (Supercharger / DC Fast /
 *      Home / AC) and the per-bucket averaging, read back through the table.
 *
 * Strategy: the component takes its data as a prop, so no network is touched.
 * `@/hooks/useChartExport` is stubbed (the container renders a real
 * <ChartExportMenu> because this chart is `exportable`). `@/api/hooks/useAnnotations`
 * is stubbed to no-ops (the container wires annotation hooks unconditionally).
 * `react-i18next` is mocked so `t(key, fallback)` / `t(key, fallback, {vars})`
 * render the English fallback (with {{var}} interpolation) deterministically.
 * <ChartContainer> transitively pulls in react-query (annotation hooks) and
 * react-router (<EmptyState>'s <Link>), so the tree is wrapped in
 * QueryClientProvider + MemoryRouter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { ChargingSession } from '@/api/types';

// jsdom lacks matchMedia; framer-motion's useReducedMotion (reached via shared
// UI) reads it. Install a benign stub before any shared module evaluates.
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

// Deterministic export hook — the container renders a real <ChartExportMenu>
// because this chart is `exportable`; the callbacks only need to be inert spies
// so opening the menu never reaches image-capture code.
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

import ChargerTypeChart from './ChargerTypeChart';

const TITLE = 'Charge Rate by Charger Type';
const ARIA_LABEL =
  'Composed bar/line chart of average power and energy per charger type';

/** Build one charging session; every field defaults to a zeroed/null value. */
function makeSession(over: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 1,
    vehicle_id: 1,
    started_at: '2024-06-01T10:00:00Z',
    ended_at: '2024-06-01T10:30:00Z',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 0,
    peak_power_w: null,
    avg_power_w: null,
    cost_decimal: null,
    cost_currency: null,
    charger_type: null,
    cable_type: null,
    startedAt: '2024-06-01T10:00:00Z',
    duration_min: 30,
    ...over,
  };
}

/** A session `minutes` long, with the given charger metadata. */
function session(
  id: number,
  minutes: number,
  over: Partial<ChargingSession> = {},
): ChargingSession {
  const start = Date.UTC(2024, 5, 1, 10 + id, 0, 0);
  const end = start + minutes * 60_000;
  return makeSession({
    id,
    started_at: new Date(start).toISOString(),
    ended_at: new Date(end).toISOString(),
    startedAt: new Date(start).toISOString(),
    duration_min: minutes,
    ...over,
  });
}

function renderChart(sessions: ChargingSession[] | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChargerTypeChart sessions={sessions as ChargingSession[]} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The container's SR/forced-colors fallback <table> (visually hidden, in DOM). */
function fallbackTable(): HTMLElement {
  const caption = screen.getByText(`${TITLE} — data table`);
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
  throw new Error(`no data row for charger "${label}"`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChargerTypeChart — chrome + a11y', () => {
  it('renders the panel title, subtitle and the accessible chart frame', () => {
    renderChart([session(1, 30, { charger_type: 'Tesla', peak_power_w: 100_000 })]);

    expect(screen.getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument();
    expect(screen.getByText('Average kW and kWh per charger category')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: ARIA_LABEL })).toBeInTheDocument();
  });

  it('builds the SR fallback table with all five localized columns', () => {
    renderChart([session(1, 30, { charger_type: 'Tesla', peak_power_w: 100_000 })]);

    const table = fallbackTable();
    expect(within(table).getByText('Charger Type')).toBeInTheDocument();
    expect(within(table).getByText('Sessions')).toBeInTheDocument();
    expect(within(table).getByText('Avg kW')).toBeInTheDocument();
    expect(within(table).getByText('Avg kWh')).toBeInTheDocument();
    expect(within(table).getByText('Avg minutes')).toBeInTheDocument();
  });
});

describe('ChargerTypeChart — grouping + averaging', () => {
  it('buckets every getChargerLabel branch and averages within a bucket', () => {
    renderChart([
      // Supercharger bucket (charger_type contains "tesla") — two sessions,
      // so the row proves the per-bucket mean, not a single value.
      session(1, 20, { charger_type: 'Tesla', peak_power_w: 250_000, total_energy_added_wh: 40_000 }),
      session(2, 40, { charger_type: 'Tesla', peak_power_w: 150_000, total_energy_added_wh: 60_000 }),
      // DC Fast bucket (no charger_type but peak > 20 kW).
      session(3, 30, { charger_type: null, peak_power_w: 120_000, total_energy_added_wh: 80_000 }),
      // Home / AC bucket (low power, no charger_type).
      session(4, 60, { charger_type: null, peak_power_w: 7_000, total_energy_added_wh: 10_000 }),
    ]);

    // avgKw=(250+150)/2=200, avgKwh=(40+60)/2=50, avgDuration=(20+40)/2=30.
    expect(dataRowCells('Supercharger')).toEqual(['Supercharger', '2', '200.0', '50.0', '30']);
    // Single-session buckets — 120 kW / 80 kWh / 30 min and 7 kW / 10 kWh / 60 min.
    expect(dataRowCells('DC Fast')).toEqual(['DC Fast', '1', '120.0', '80.0', '30']);
    expect(dataRowCells('Home / AC')).toEqual(['Home / AC', '1', '7.0', '10.0', '60']);
  });

  it('mirrors each bucket in the visible legend (label + session count)', () => {
    renderChart([
      session(1, 30, { charger_type: 'Tesla', peak_power_w: 150_000, total_energy_added_wh: 30_000 }),
      session(2, 45, { charger_type: null, peak_power_w: 6_000, total_energy_added_wh: 8_000 }),
    ]);

    // The legend is real DOM (Recharts SVG is empty in jsdom) — assert both
    // bucket labels appear and that each bucket contributes its own
    // interpolated "N sessions · … min avg" summary (only the legend, not the
    // fallback table, carries that phrasing, so it pins the legend precisely).
    expect(screen.getAllByText('Supercharger').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Home / AC').length).toBeGreaterThanOrEqual(1);
    const summaries = screen.getAllByText(/min avg/);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toHaveTextContent('sessions');
  });
});

describe('ChargerTypeChart — empty branch (regression: never a blank panel)', () => {
  it('surfaces the shared empty state for a zero-length sessions array', () => {
    renderChart([]);

    // The pre-fix component omitted `empty`, so this placeholder never rendered.
    expect(screen.getByText('No data available')).toBeInTheDocument();
    // The title stays mounted while the empty state replaces the chart image.
    expect(screen.getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: ARIA_LABEL })).toBeNull();
    // No fallback data table and no export menu when there's nothing to show.
    expect(screen.queryByText(`${TITLE} — data table`)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export chart' })).toBeNull();
  });
});

describe('ChargerTypeChart — null safety', () => {
  it('treats an undefined sessions prop as empty without crashing', () => {
    // The pre-fix `sessions.length` read threw a TypeError on undefined; the
    // hardened `sessions ?? []` must route to the empty state instead.
    expect(() => renderChart(undefined)).not.toThrow();
    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.queryByText(`${TITLE} — data table`)).toBeNull();
  });

  it('does not let a missing energy value poison its bucket average (regression)', () => {
    // Two Home/AC sessions: one with 10 kWh, one whose energy is absent.
    // Pre-fix `total_energy_added_wh / 1000` yielded NaN for the missing one,
    // and avg([10, NaN]) === NaN → the WHOLE bucket collapsed to "0.0".
    // Hardened `?? 0` keeps the finite reading: avg([10, 0]) === 5 → "5.0".
    renderChart([
      session(1, 30, { charger_type: null, peak_power_w: 7_000, total_energy_added_wh: 10_000 }),
      session(2, 30, {
        charger_type: null,
        peak_power_w: 7_000,
        total_energy_added_wh: undefined as unknown as number,
      }),
    ]);

    const cells = dataRowCells('Home / AC');
    expect(cells[1]).toBe('2'); // both sessions counted
    expect(cells[3]).toBe('5.0'); // avgKwh survives the missing reading
    expect(cells[3]).not.toBe('0.0'); // pin the pre-fix collapse
  });

  it('coerces a null peak power to a zeroed kW average without crashing', () => {
    expect(() =>
      renderChart([
        session(1, 15, { charger_type: null, peak_power_w: null, total_energy_added_wh: 5_000 }),
      ]),
    ).not.toThrow();
    // peak_power_w null → avgKw 0 → "0.0"; energy 5 kWh survives.
    expect(dataRowCells('Home / AC')).toEqual(['Home / AC', '1', '0.0', '5.0', '15']);
  });
});

describe('ChargerTypeChart — export interaction', () => {
  it('exposes an export control that opens the menu on activation', () => {
    renderChart([session(1, 30, { charger_type: 'Tesla', peak_power_w: 120_000, total_energy_added_wh: 40_000 })]);

    const trigger = screen.getByRole('button', { name: 'Export chart' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Export chart' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Save as PNG' })).toBeInTheDocument();
  });
});
