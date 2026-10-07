/**
 * APIUsageWidget tests.
 *
 * APIUsageWidget renders the fleet API-call telemetry (calls in the last 24h,
 * average response time, error rate, error count) sourced from
 * `useApiLogStats()`. Its behaviour surface — the thing under test — is:
 *
 *   1. Three responsive layouts driven by `size.cols`:
 *        - compact  (cols <= 1): a single big number + "Calls (24h)" label,
 *          with an inline error line only when the error rate is elevated.
 *        - standard (cols === 2): titled shell + a 2-up stat grid.
 *        - wide     (cols >= 3): titled shell + a 4-up stat grid.
 *   2. The four query states every data source must handle: loading (skeleton),
 *      error (QueryError panel), empty (EmptyState placeholder — never a blank
 *      panel), and data.
 *   3. Threshold branches: error rate > 5 paints the value red and shows a
 *      "High" trend chip / inline "% errors" line; a moderate rate shows
 *      neither.
 *   4. Null-safety: a partial payload must degrade to zeros, never throw.
 *   5. The freshness control: clicking it refetches, but only when a fetch is
 *      not already in flight.
 *   6. Graceful degradation (the hardened bug): a transient background-refetch
 *      error MUST NOT blank out otherwise-valid cached numbers — the widget
 *      keeps rendering the data and surfaces the failure through the freshness
 *      indicator's error state instead of the full-panel QueryError.
 *
 * `@/api/hooks/useAdmin` is mocked so the network is never touched and every
 * query state is driven deterministically. `react-i18next` is stubbed with a
 * passthrough `t(key, default)` so assertions read the English defaults. The
 * shared WidgetShell / DataFreshness / StatCard / EmptyState primitives all run
 * for real, so the assertions exercise the true rendered DOM. `<MemoryRouter>`
 * wraps every render because the error branch's <QueryError> uses `useNavigate`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { APICallLogStats } from '@/types/admin';
import APIUsageWidget from './APIUsageWidget';

// jsdom lacks matchMedia; framer-motion's useReducedMotion (reached via
// <DataFreshness>) reads it during render. Install a benign stub before any
// component mounts.
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

const { useApiLogStatsMock } = vi.hoisted(() => ({
  useApiLogStatsMock: vi.fn(),
}));

vi.mock('@/api/hooks/useAdmin', () => ({
  useApiLogStats: () => useApiLogStatsMock(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | Record<string, unknown>) =>
      typeof defaultValue === 'string' ? defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

function makeStats(overrides: Partial<APICallLogStats> = {}): APICallLogStats {
  return {
    totalCalls: 0,
    errorRate: 0,
    avgDurationMs: 0,
    last24h: 0,
    errorCount: 0,
    ...overrides,
  };
}

interface QueryState {
  data: APICallLogStats | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<QueryState> = {}): QueryState {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(size: { cols: number; rows: number } = { cols: 2, rows: 2 }) {
  return render(
    <MemoryRouter>
      <APIUsageWidget size={size} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Always provide a valid default so a test that forgets to seed the hook
  // still renders rather than crashing on a destructure of `undefined`.
  useApiLogStatsMock.mockReturnValue(makeQuery());
});

afterEach(() => {
  cleanup();
});

describe('APIUsageWidget — standard / wide layout', () => {
  it('renders the titled shell and all four stat cards with formatted values', () => {
    useApiLogStatsMock.mockReturnValue(
      makeQuery({
        data: makeStats({ last24h: 12345, avgDurationMs: 123.4, errorRate: 2, errorCount: 7 }),
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('API Usage')).toBeInTheDocument();
    expect(screen.getByText('Total Calls (24h)')).toBeInTheDocument();
    expect(screen.getByText('12,345')).toBeInTheDocument();
    expect(screen.getByText('Avg Response')).toBeInTheDocument();
    expect(screen.getByText('123.4')).toBeInTheDocument();
    expect(screen.getByText('ms')).toBeInTheDocument();
    expect(screen.getByText('Error Rate')).toBeInTheDocument();
    expect(screen.getByText('2.0')).toBeInTheDocument();
    expect(screen.getByText('Errors')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('paints a "High" down-trend chip when the error rate exceeds 5%', () => {
    useApiLogStatsMock.mockReturnValue(
      makeQuery({
        data: makeStats({ last24h: 1000, avgDurationMs: 50, errorRate: 12, errorCount: 40 }),
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('12.0')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    // StatCard renders a down arrow for the negative trend.
    expect(screen.getByText('↓')).toBeInTheDocument();
  });

  it('shows no "High" chip or trend arrow for a moderate (0 < rate <= 5) error rate', () => {
    useApiLogStatsMock.mockReturnValue(
      makeQuery({
        data: makeStats({ last24h: 1000, avgDurationMs: 50, errorRate: 3, errorCount: 30 }),
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('3.0')).toBeInTheDocument();
    expect(screen.queryByText('High')).not.toBeInTheDocument();
    expect(screen.queryByText('↓')).not.toBeInTheDocument();
  });

  it('renders a 4-up grid for wide widgets (cols >= 3)', () => {
    useApiLogStatsMock.mockReturnValue(
      makeQuery({
        data: makeStats({ last24h: 800, avgDurationMs: 60, errorRate: 1, errorCount: 4 }),
      }),
    );

    const { container } = renderWidget({ cols: 4, rows: 2 });

    // WidgetStatGrid maps cols=4 to the container-query 4-up class.
    expect(container.querySelector('.\\@sm\\:grid-cols-4')).toBeTruthy();
    expect(screen.getByText('API Usage')).toBeInTheDocument();
    expect(screen.getByText('Total Calls (24h)')).toBeInTheDocument();
    expect(screen.getByText('800')).toBeInTheDocument();
  });
});

describe('APIUsageWidget — compact layout', () => {
  it('renders a single big number with a "Calls (24h)" label and no section title / grid', () => {
    useApiLogStatsMock.mockReturnValue(
      makeQuery({ data: makeStats({ last24h: 999, errorRate: 1, errorCount: 3 }) }),
    );

    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('999')).toBeInTheDocument();
    expect(screen.getByText('Calls (24h)')).toBeInTheDocument();
    // Compact mode drops the header title and the full stat grid.
    expect(screen.queryByText('API Usage')).not.toBeInTheDocument();
    expect(screen.queryByText('Total Calls (24h)')).not.toBeInTheDocument();
    expect(screen.queryByText('Error Rate')).not.toBeInTheDocument();
  });

  it('surfaces an inline "% errors" line only when the error rate is elevated', () => {
    useApiLogStatsMock.mockReturnValue(
      makeQuery({ data: makeStats({ last24h: 500, errorRate: 12.5, errorCount: 60 }) }),
    );

    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('500')).toBeInTheDocument();
    const errorLine = screen.getByText(/errors/);
    expect(errorLine.textContent).toContain('12.5%');
    expect(errorLine.textContent).toContain('errors');
  });

  it('hides the inline error line when the error rate is within tolerance', () => {
    useApiLogStatsMock.mockReturnValue(
      makeQuery({ data: makeStats({ last24h: 500, errorRate: 4, errorCount: 5 }) }),
    );

    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.queryByText(/errors/)).not.toBeInTheDocument();
  });
});

describe('APIUsageWidget — query states', () => {
  it('renders a skeleton while loading and no content or empty message', () => {
    useApiLogStatsMock.mockReturnValue(makeQuery({ isLoading: true, data: undefined }));

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('API Usage')).not.toBeInTheDocument();
    expect(screen.queryByText('No API usage data')).not.toBeInTheDocument();
  });

  it('renders the QueryError panel on an initial load failure (no cached data)', () => {
    useApiLogStatsMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, data: undefined }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Generic (non-HTTP) error → network/unknown branch of <QueryError>.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('API Usage')).not.toBeInTheDocument();
    expect(screen.queryByText('Total Calls (24h)')).not.toBeInTheDocument();
  });

  it('renders an EmptyState placeholder (never a blank panel) when data is absent', () => {
    useApiLogStatsMock.mockReturnValue(
      makeQuery({ data: undefined, isLoading: false, error: null, isError: false }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Titled shell still renders; the body degrades to the placeholder.
    expect(screen.getByText('API Usage')).toBeInTheDocument();
    expect(screen.getByText('No API usage data')).toBeInTheDocument();
    expect(screen.queryByText('Total Calls (24h)')).not.toBeInTheDocument();
  });

  it('degrades a partial payload to zeros without throwing (null-safety)', () => {
    // A `{}` payload is truthy, so the grid renders — every field falls back
    // to 0 via the widget's `?? 0` guards rather than crashing.
    useApiLogStatsMock.mockReturnValue(makeQuery({ data: {} as APICallLogStats }));

    expect(() => renderWidget({ cols: 2, rows: 2 })).not.toThrow();
    expect(screen.getByText('Total Calls (24h)')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0.0').length).toBeGreaterThan(0);
  });
});

describe('APIUsageWidget — freshness interaction', () => {
  it('refetches when the accessible refresh control is clicked', () => {
    const refetch = vi.fn();
    useApiLogStatsMock.mockReturnValue(
      makeQuery({
        data: makeStats({ last24h: 10 }),
        isFetching: false,
        dataUpdatedAt: Date.now(),
        refetch,
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    const refreshControl = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshControl);

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not refetch while a fetch is already in flight', () => {
    const refetch = vi.fn();
    useApiLogStatsMock.mockReturnValue(
      makeQuery({ data: makeStats({ last24h: 10 }), isFetching: true, refetch }),
    );

    renderWidget({ cols: 2, rows: 2 });

    const refreshControl = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshControl);

    expect(refetch).not.toHaveBeenCalled();
  });
});

describe('APIUsageWidget — graceful degradation on transient error', () => {
  it('keeps rendering cached data and flags the freshness indicator instead of blanking out', () => {
    const { container } = (() => {
      useApiLogStatsMock.mockReturnValue(
        makeQuery({
          data: makeStats({ last24h: 8888, avgDurationMs: 20, errorRate: 1, errorCount: 2 }),
          error: new Error('transient'),
          isError: true,
          isFetching: false,
          dataUpdatedAt: Date.now(),
        }),
      );
      return renderWidget({ cols: 2, rows: 2 });
    })();

    // Data is still on screen …
    expect(screen.getByText('8,888')).toBeInTheDocument();
    expect(screen.getByText('Total Calls (24h)')).toBeInTheDocument();
    // … the full-panel error is NOT shown …
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    // … and the freshness indicator is in its error state (red dot).
    expect(container.querySelector('.bg-red-400')).toBeTruthy();
  });
});
