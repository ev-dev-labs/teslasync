/**
 * MonthlyCostChart — the Cost Analysis "monthly cost trend" hero band.
 *
 * The band renders through the shared <ChartContainer> (an <AreaChart> inside a
 * <ResponsiveContainer> that jsdom sizes at 0×0 and never paints), so — like the
 * sibling SpeedTrendChart / ChartContainer.a11y suites — these tests assert
 * against the pieces the component actually owns and paints in jsdom:
 *   - the ChartContainer shell (labelled <figure>, level-3 heading, the
 *     `role="img"` chart region carrying the summary aria-label),
 *   - the visually-hidden accessible fallback <table> that ChartContainer
 *     renders from the `data` / `dataColumns` props — the one place the
 *     formatting is observable (the shared `MM/YY` month label + the
 *     currency-formatted cost cells that now match the visible axis),
 *   - the four mutually-exclusive states in priority order (error > loading >
 *     empty > data): loading swaps in the Spinner, empty shows the "No data
 *     available" EmptyState, error swaps the whole chart for a <CostSection>
 *     QueryError with a working Retry, and
 *   - the hardening this file adds: an undefined / null `data` prop (a late or
 *     failed fetch) degrades to the empty state instead of crashing on
 *     `.map` / `.length`, and missing per-row numerics coerce to `$0.00` / `—`
 *     with no NaN reaching the DOM.
 *
 * `react-i18next` is stubbed so `t(key, 'Default', vars?)` returns the English
 * default (interpolated), making copy assertions exact. `useChartPalette` is
 * pinned to a known palette so `palette[0]` is deterministic. `useChartExport`
 * + `useAnnotations` (reached through the real ChartContainer) are stubbed to
 * no-ops so nothing touches html2canvas or the network, and `useOnlineStatus`
 * is pinned online so the error branch renders QueryError's network
 * `role="alert"` with an enabled Retry. `useSettings` is auto-mocked by the
 * global test setup (currency '$', precision 2, en-US), so the real
 * `useFormatting` produces deterministic currency strings.
 */
import { type ComponentProps, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

function tMock(key: string, fallback?: unknown, opts?: Record<string, unknown>): string {
  const interpolate = (s: string, vars?: Record<string, unknown>): string => {
    if (!vars) return s;
    let out = s;
    for (const [k, v] of Object.entries(vars)) {
      if (k === 'defaultValue') continue;
      out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return out;
  };
  if (typeof fallback === 'string') return interpolate(fallback, opts);
  if (fallback && typeof fallback === 'object') {
    const o = fallback as Record<string, unknown>;
    const base = typeof o.defaultValue === 'string' ? o.defaultValue : key;
    return interpolate(base, o);
  }
  return key;
}

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: tMock,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => ['#0072b2', '#e69f00', '#009e73'],
}));

// The real ChartContainer reaches for these; keep them off the network / canvas.
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null },
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    copyToClipboard: vi.fn(async () => 'copied' as const),
    exporting: false,
  }),
}));

vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [], isLoading: false }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

import { MonthlyCostChart } from './MonthlyCostChart';
import type { MonthlyBucket } from './types';

const TITLE = 'Monthly Cost Trend';
const CHART_LABEL = 'Monthly charging cost trend area chart';
const EMPTY_COPY = 'No data available';

function makeBucket(overrides: Partial<MonthlyBucket> = {}): MonthlyBucket {
  return {
    month: '2024-01',
    cost: 30,
    energy: 100,
    sessions: 5,
    avgCostPerKwh: 0.3,
    gasEquiv: 45,
    savings: 15,
    ...overrides,
  };
}

type Props = ComponentProps<typeof MonthlyCostChart>;

function renderChart(overrides: Partial<Props> = {}) {
  const onRetry = overrides.onRetry ?? vi.fn();
  const props: Props = {
    data: [],
    vehicleId: 7,
    ...overrides,
    onRetry,
  };
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MonthlyCostChart {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, onRetry };
}

/** Read the visually-hidden fallback table as an array of data-row cell arrays. */
function readTableRows(): string[][] {
  const table = screen.getByRole('table');
  const rows = within(table).getAllByRole('row');
  // rows[0] is the <thead> header row; the rest are data rows.
  return rows
    .slice(1)
    .map((r) => within(r).getAllByRole('cell').map((c) => c.textContent ?? ''));
}

describe('MonthlyCostChart — panel shell + a11y', () => {
  it('renders the ChartContainer figure with its title heading and labelled img region', () => {
    renderChart({ data: [makeBucket()] });

    const figure = screen.getByRole('figure', { name: /Monthly Cost Trend/ });
    expect(figure.tagName).toBe('FIGURE');
    expect(
      screen.getByRole('heading', { level: 3, name: TITLE }),
    ).toBeInTheDocument();
    // The chart body is exposed as a single labelled image region.
    expect(
      within(figure).getByRole('img', { name: CHART_LABEL }),
    ).toBeInTheDocument();

    // Fully populated → no loading spinner, empty status, or error alert.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('MonthlyCostChart — accessible fallback table', () => {
  it('renders the fallback table headers and currency-/month-formatted cells', () => {
    renderChart({
      data: [
        makeBucket({ month: '2024-01', cost: 30 }),
        makeBucket({ month: '2024-02', cost: 12.5 }),
      ],
    });

    const table = screen.getByRole('table');
    // Column headers come straight from `dataColumns`.
    expect(
      within(table).getAllByRole('columnheader').map((h) => h.textContent),
    ).toEqual(['Month', 'Cost ($)']);

    const rows = readTableRows();
    expect(rows).toHaveLength(2);
    // Month reads as the compact MM/YY axis label; cost as 2dp currency so the
    // SR/forced-colors table matches the visible currency axis.
    expect(rows[0]).toEqual(['01/24', '$30.00']);
    expect(rows[1]).toEqual(['02/24', '$12.50']);
  });

  it('leaves an unparseable month untouched instead of mangling it', () => {
    renderChart({ data: [makeBucket({ month: '2024', cost: 5 })] });

    const rows = readTableRows();
    // "2024" has no `-` split → returned verbatim (never a `undefined/NN` label).
    expect(rows[0]).toEqual(['2024', '$5.00']);
  });
});

describe('MonthlyCostChart — state priority (error > loading > empty > data)', () => {
  it('shows the loading Spinner (and no table/empty/error) while isLoading', () => {
    renderChart({ data: [], isLoading: true });

    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    // Loading strictly precedes the empty / data branches.
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // The shell keeps its heading throughout.
    expect(
      screen.getByRole('heading', { level: 3, name: TITLE }),
    ).toBeInTheDocument();
  });

  it('renders an EmptyState (never a blank panel) when there are no buckets', () => {
    renderChart({ data: [] });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
    // The empty branch renders no fallback data table.
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders a QueryError alert with a working Retry (and no chart figure) on error', () => {
    const { onRetry } = renderChart({
      data: [makeBucket()],
      error: new Error('boom'),
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/can't reach server/i)).toBeInTheDocument();
    // The error section replaces the chart figure entirely, but keeps the heading.
    expect(screen.queryByRole('figure')).toBeNull();
    expect(screen.queryByRole('img', { name: CHART_LABEL })).toBeNull();
    expect(
      screen.getByRole('heading', { level: 3, name: TITLE }),
    ).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /retry/i });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('prioritises the error branch over stale data + a concurrent load', () => {
    renderChart({ data: [makeBucket()], error: new Error('down'), isLoading: true });

    // Error beats both the (stale) chart and the loading spinner.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('figure')).toBeNull();
    expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
  });
});

describe('MonthlyCostChart — null-safety hardening', () => {
  it('degrades an undefined data prop to the empty state without crashing on .map/.length', () => {
    expect(() =>
      renderChart({ data: undefined as unknown as MonthlyBucket[] }),
    ).not.toThrow();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('degrades a null data prop to the empty state without crashing', () => {
    expect(() =>
      renderChart({ data: null as unknown as MonthlyBucket[] }),
    ).not.toThrow();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
  });

  it('coerces missing per-row numerics to $0.00 / em-dash month with no NaN', () => {
    const { container } = renderChart({
      data: [{ month: undefined, cost: undefined } as unknown as MonthlyBucket],
    });

    const rows = readTableRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(['—', '$0.00']);
    expect(container.textContent).not.toMatch(/NaN/);
    expect(container.innerHTML).not.toContain('NaN');
  });
});
