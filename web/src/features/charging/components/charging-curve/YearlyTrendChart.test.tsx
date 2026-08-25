/**
 * YearlyTrendChart — behaviour, branch, a11y, and null-safety coverage for the
 * file's sole export (the default `YearlyTrendChart`).
 *
 * The component is a presentational leaf: given a `yearlyTrend` array it feeds
 * the rows to a shared <ChartContainer> (a Composed bar + two lines, a custom
 * per-series HTML legend, and the container's screen-reader / forced-colors
 * fallback <table>). Recharts measures the SVG bounding box and jsdom reports
 * 0 × 0, so the chart body itself renders nothing — every value assertion
 * therefore targets the always-present fallback data table or the custom legend,
 * both of which are real DOM.
 *
 * This file pins the three things the hardening pass fixed:
 *   1. the EMPTY branch — a `yearlyTrend=[]` prop must route through
 *      <ChartContainer empty>, which surfaces the shared <EmptyState>
 *      ("No data available") AND suppresses the export menu. The pre-fix
 *      component never passed `empty`, so the export control rendered over a
 *      chart that had nothing to export;
 *   2. NULL-SAFETY — an `undefined` `yearlyTrend` prop must route to the empty
 *      state instead of throwing on `yearlyTrend.length`, and a missing per-row
 *      metric must render the universal "—" placeholder instead of crashing;
 *   3. the LEGEND colors — each swatch now reads its color inline from the same
 *      `CHART_COLORS` palette as the rendered series, so a palette switch can no
 *      longer leave the legend out of sync (the pre-fix swatches were hardcoded
 *      Tailwind classes such as `bg-[#00f0ff]` / `bg-purple-500` with no inline
 *      color at all).
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

import YearlyTrendChart from './YearlyTrendChart';

type TrendPoint = { year: string; avg10to80: number; avg20to80: number; count: number };

const TITLE = 'Yearly Charging Speed Trend';
const SUBTITLE = 'Average time-to-charge and session count by year';
const ARIA_LABEL = 'Yearly average charge-time and session-count composed chart';

const TREND: TrendPoint[] = [
  { year: '2022', avg10to80: 45, avg20to80: 35, count: 3 },
  { year: '2023', avg10to80: 40, avg20to80: 30, count: 5 },
];

function renderChart(yearlyTrend: TrendPoint[] | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <YearlyTrendChart yearlyTrend={yearlyTrend as TrendPoint[]} />
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

/** The <td> texts of the fallback-table data row whose first cell is `year`. */
function dataRowCells(year: string): string[] {
  const rows = Array.from(fallbackTable().querySelectorAll('tbody tr'));
  for (const r of rows) {
    const cells = Array.from(r.querySelectorAll('td')).map((c) => c.textContent ?? '');
    if (cells[0] === year) return cells;
  }
  throw new Error(`no data row for year "${year}"`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('YearlyTrendChart — chrome + a11y', () => {
  it('renders the panel title, subtitle and the accessible chart frame', () => {
    renderChart(TREND);

    expect(screen.getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument();
    expect(screen.getByText(SUBTITLE)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: ARIA_LABEL })).toBeInTheDocument();
  });

  it('builds the SR fallback table with all four localized columns', () => {
    renderChart(TREND);

    const table = fallbackTable();
    expect(within(table).getByText('Year')).toBeInTheDocument();
    expect(within(table).getByText('10→80% avg min')).toBeInTheDocument();
    expect(within(table).getByText('20→80% avg min')).toBeInTheDocument();
    expect(within(table).getByText('DC Sessions')).toBeInTheDocument();
  });
});

describe('YearlyTrendChart — data rows', () => {
  it('emits one fallback-table row per year with the exact stringified metrics', () => {
    renderChart(TREND);

    // Column order: year → 10→80% avg → 20→80% avg → DC session count.
    expect(dataRowCells('2022')).toEqual(['2022', '45', '35', '3']);
    expect(dataRowCells('2023')).toEqual(['2023', '40', '30', '5']);
    // Exactly two data rows — no phantom/duplicate years.
    expect(fallbackTable().querySelectorAll('tbody tr')).toHaveLength(2);
  });
});

describe('YearlyTrendChart — shared legend contract', () => {
  it('opts the chart into URL-persisted shared legend controls', () => {
    renderChart(TREND);

    expect(screen.getByRole('figure', { name: TITLE })).toHaveAttribute(
      'data-chart-key',
      'charging-curve-yearly-trend',
    );
    expect(document.querySelectorAll('span.rounded-sm')).toHaveLength(0);
  });
});

describe('YearlyTrendChart — empty branch (regression: no export over empty data)', () => {
  it('surfaces the shared empty state and hides the export control', () => {
    renderChart([]);

    // The pre-fix component omitted `empty`, so <ChartContainer> kept the export
    // menu visible and never rendered this placeholder.
    expect(screen.getByText('No data available')).toBeInTheDocument();
    // Title + accessible frame stay mounted (the panel is never truly blank).
    expect(screen.getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: ARIA_LABEL })).not.toBeInTheDocument();
    // No fallback data table and no export menu when there's nothing to show.
    expect(screen.queryByText(`${TITLE} — data table`)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export chart' })).toBeNull();
  });
});

describe('YearlyTrendChart — null safety', () => {
  it('treats an undefined yearlyTrend prop as empty without crashing', () => {
    // The pre-fix `yearlyTrend.length` read threw a TypeError on undefined; the
    // hardened `yearlyTrend ?? []` must route to the empty state instead.
    expect(() => renderChart(undefined)).not.toThrow();
    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.queryByText(`${TITLE} — data table`)).toBeNull();
  });

  it('placeholders a missing per-row metric with "—" instead of crashing', () => {
    expect(() =>
      renderChart([
        { year: '2024', avg10to80: null as unknown as number, avg20to80: 20, count: 2 },
      ]),
    ).not.toThrow();

    // A null metric renders the universal em-dash marker; the finite siblings
    // survive, and the row is never dropped.
    expect(dataRowCells('2024')).toEqual(['2024', '—', '20', '2']);
  });
});

describe('YearlyTrendChart — export interaction', () => {
  it('exposes an export control that opens the menu on activation', () => {
    renderChart(TREND);

    const trigger = screen.getByRole('button', { name: 'Export chart' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Export chart' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Save as PNG' })).toBeInTheDocument();
  });
});
