/**
 * BatterySocChart — behaviour, branch, a11y, null-safety + regression coverage.
 *
 * The component is a presentational leaf: given a pre-shaped
 * `PowerHistoryPoint[]` plus `loading` / `error` flags it renders either the
 * shared <QueryError> (error branch) or a shared <ChartContainer> wrapping a
 * recharts SOC line (loading / empty / populated branches). The interesting
 * logic lives in two things this file pins:
 *
 *   1. the two exported axis tick-formatters —
 *      - `formatSocTimeTick` must degrade a malformed timestamp to the shared
 *        "—" placeholder instead of throwing `RangeError: Invalid time value`.
 *        That is the regression this file guards: the previous
 *        `formatDateShort(new Date(v).toISOString())` pre-conversion threw on
 *        any non-finite `v` because `Date#toISOString` rejects an Invalid Date,
 *        defeating `formatDateShort`'s own guard.
 *      - `formatSocPercentTick` must be null-safe (`null` → "0%").
 *   2. the branch selection + `data ?? []` null-safety — a `data` prop that is
 *      `undefined` at runtime (a caller whose query hasn't resolved) must show
 *      the empty state, never crash on `data.length`.
 *
 * Recharts measures the SVG bounding box and jsdom returns 0 × 0, so the chart
 * body itself renders nothing — every component assertion targets the
 * <ChartContainer> chrome (title heading, the role="img" chart frame, the
 * export affordance, the empty/loading placeholders) which lives outside the
 * ResponsiveContainer. Network is never touched: the component takes its data
 * as props and the transitively-pulled hooks (annotations / export / online
 * status) are stubbed. <ChartContainer>/<EmptyState>/<QueryError> pull in
 * react-query + react-router, so the tree is wrapped in QueryClientProvider +
 * MemoryRouter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { formatDateShort } from '@/lib/dateFormat';
import type { PowerHistoryPoint } from './PowerHistoryChart';

// jsdom lacks matchMedia; framer-motion's useReducedMotion (reached via the
// loading-state <Spinner>) reads it. Install a benign stub before any shared UI
// module evaluates.
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
// read as real English. Handles t(key, 'fallback'), t(key, 'fallback', { vars })
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

// The container renders a real <ChartExportMenu> in the populated state; only
// the callbacks need to be inert spies so opening the menu never reaches
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

// Pin the browser to "online" so <QueryError> deterministically renders the
// "Can't reach server" branch (with an enabled Retry CTA) for a status-less
// Error rather than the offline variant.
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

import { BatterySocChart, formatSocTimeTick, formatSocPercentTick } from './BatterySocChart';

const ARIA_LABEL = 'Battery state of charge percentage over time line chart';
const TITLE = 'Battery State of Charge';

/** Build one history sample; every field defaults to a zeroed value. */
function makePoint(over: Partial<PowerHistoryPoint> = {}): PowerHistoryPoint {
  return { time: Date.UTC(2024, 5, 30, 12), label: '12:00', solar: 0, battery: 0, grid: 0, load: 0, soc: 50, ...over };
}

interface RenderOver {
  data?: PowerHistoryPoint[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

function renderChart(over: RenderOver = {}) {
  const onRetry = over.onRetry ?? vi.fn();
  // Distinguish "data omitted" (use a sensible default) from "data explicitly
  // undefined" (exercise the component's own `data ?? []` null-safety) — a
  // blanket `over.data ?? default` would mask the very branch under test.
  const data = 'data' in over ? (over.data as PowerHistoryPoint[]) : [makePoint()];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BatterySocChart
          data={data}
          loading={over.loading ?? false}
          error={over.error}
          onRetry={onRetry}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, onRetry };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('formatSocTimeTick', () => {
  it('returns the shared "—" placeholder for null / undefined', () => {
    expect(formatSocTimeTick(null)).toBe('—');
    expect(formatSocTimeTick(undefined)).toBe('—');
  });

  it('degrades unrenderable input to "—" WITHOUT throwing (regression)', () => {
    // The pre-fix implementation pre-converted via `new Date(v).toISOString()`,
    // which throws on a non-finite value — prove both the old hazard and the
    // new safety in one place.
    expect(() => new Date(Number.NaN).toISOString()).toThrow();
    expect(() => formatSocTimeTick(Number.NaN)).not.toThrow();
    expect(formatSocTimeTick(Number.NaN)).toBe('—');
    expect(formatSocTimeTick('not-a-date')).toBe('—');
  });

  it('formats a valid epoch-ms tick identically to the shared date formatter', () => {
    const t = Date.UTC(2024, 5, 30, 12);
    const formatted = formatSocTimeTick(t);
    expect(formatted).not.toBe('—');
    // Behaviour parity with formatDateShort — the ISO round-trip the old code
    // did never changed the instant, so the rendered short date is the same.
    expect(formatted).toBe(formatDateShort(new Date(t)));
  });

  it('accepts an ISO string and a Date equivalently to an epoch-ms number', () => {
    const t = Date.UTC(2024, 0, 15, 8, 30);
    const fromNumber = formatSocTimeTick(t);
    expect(formatSocTimeTick(new Date(t).toISOString())).toBe(fromNumber);
    expect(formatSocTimeTick(new Date(t))).toBe(fromNumber);
  });
});

describe('formatSocPercentTick', () => {
  it('renders a whole-number percentage label', () => {
    expect(formatSocPercentTick(0)).toBe('0%');
    expect(formatSocPercentTick(50)).toBe('50%');
    expect(formatSocPercentTick(100)).toBe('100%');
  });

  it('coerces null / undefined to a 0% label (null-safe)', () => {
    expect(formatSocPercentTick(null)).toBe('0%');
    expect(formatSocPercentTick(undefined)).toBe('0%');
  });
});

describe('BatterySocChart — error branch', () => {
  it('renders the panel title + a retryable error, and invokes onRetry on click', () => {
    const { onRetry } = renderChart({ error: new Error('boom') });

    expect(screen.getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does NOT mount the chart frame while in the error branch', () => {
    renderChart({ error: new Error('boom') });
    expect(screen.queryByRole('img', { name: ARIA_LABEL })).toBeNull();
    expect(screen.queryByText('No data available')).toBeNull();
  });
});

describe('BatterySocChart — loading branch', () => {
  it('shows the spinner inside the accessible chart frame, not the empty state', () => {
    renderChart({ loading: true, data: [] });

    expect(screen.getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: ARIA_LABEL })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByText('No data available')).toBeNull();
  });
});

describe('BatterySocChart — empty branch', () => {
  it('shows the empty placeholder (never a blank panel) with the frame still mounted', () => {
    renderChart({ data: [] });

    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: ARIA_LABEL })).toBeInTheDocument();
    // Not the loading spinner.
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
  });

  it('treats an undefined data prop as empty without crashing (null-safety regression)', () => {
    // A caller whose query hasn't resolved may pass `undefined`; the old
    // `data.length` read would throw. `data ?? []` must route to the empty state.
    expect(() =>
      renderChart({ data: undefined as unknown as PowerHistoryPoint[] }),
    ).not.toThrow();
    expect(screen.getByText('No data available')).toBeInTheDocument();
  });
});

describe('BatterySocChart — populated branch', () => {
  it('mounts the chart (no loading/empty placeholder) with the accessible frame', () => {
    renderChart({ data: [makePoint({ soc: 42 }), makePoint({ time: Date.UTC(2024, 5, 30, 13), soc: 55 })] });

    expect(screen.getByRole('img', { name: ARIA_LABEL })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument();
    expect(screen.queryByText('No data available')).toBeNull();
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
  });

  it('exposes an export affordance that opens a menu on activation', () => {
    renderChart({ data: [makePoint()] });

    const trigger = screen.getByRole('button', { name: 'Export chart' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Export chart' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Save as PNG' })).toBeInTheDocument();
  });
});
