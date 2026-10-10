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
 *   4. Null-safety: a partial payload keeps unknown values distinct from zero.
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
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
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

    expect(screen.getByRole('heading', {
      name: (name, element) => name === 'API usage' && !element.closest('[data-operational-brief]'),
    })).toBeInTheDocument();
    const brief = screen.getByRole('region', { name: 'API usage' });
    expect(within(brief).getByRole('heading', { name: 'API usage' })).toBeInTheDocument();
    expect(screen.getByText('Total calls (24h)')).toBeInTheDocument();
    expect(screen.getByText('12,345')).toBeInTheDocument();
    expect(screen.getByText('Avg response')).toBeInTheDocument();
    expect(screen.getByText('123.40 ms')).toBeInTheDocument();
    expect(screen.getByText('Error rate')).toBeInTheDocument();
    expect(screen.getByText('2.00%')).toBeInTheDocument();
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

    expect(screen.getByText('12.00%')).toBeInTheDocument();
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

    expect(screen.getByText('3.00%')).toBeInTheDocument();
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

    expect(container.querySelector('[data-operational-brief]')).toBeTruthy();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(screen.getByRole('heading', {
      name: (name, element) => name === 'API usage' && !element.closest('[data-operational-brief]'),
    })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'API usage' }))
      .getByRole('heading', { name: 'API usage' })).toBeInTheDocument();
    expect(screen.getByText('Total calls (24h)')).toBeInTheDocument();
    expect(screen.getByText('800')).toBeInTheDocument();
  });
});

describe('APIUsageWidget — compact layout', () => {
  it('renders a single big number with a "Calls (24h)" label and no section title / grid', () => {
    useApiLogStatsMock.mockReturnValue(
      makeQuery({ data: makeStats({ last24h: 999, errorRate: 1, errorCount: 3 }) }),
    );

    const { container } = renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('999')).toBeInTheDocument();
    expect(screen.getByText('Calls (24h)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'API source counters' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getAllByText('999')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'API usage' })).not.toBeInTheDocument();
    expect(container.querySelector('[data-operational-brief]')).toBeNull();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText('Total calls (24h)')).not.toBeInTheDocument();
    expect(screen.queryByText('Error rate')).not.toBeInTheDocument();
  });

  it('surfaces an inline "% errors" line only when the error rate is elevated', () => {
    useApiLogStatsMock.mockReturnValue(
      makeQuery({ data: makeStats({ last24h: 500, errorRate: 12.5, errorCount: 60 }) }),
    );

    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('500')).toBeInTheDocument();
    const errorLine = screen.getByText(/errors/);
    expect(errorLine.textContent).toContain('12.50%');
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

    const shell = container.querySelector('[data-data-state="initial"]');
    expect(shell).not.toBeNull();
    expect(shell).toHaveAttribute('aria-busy', 'true');
    const skeleton = shell?.querySelector('[aria-hidden="true"].bg-\\[var\\(--skeleton-bg\\)\\]');
    expect(skeleton).not.toBeNull();
    expect(skeleton).toHaveClass('h-full', 'min-h-24', 'rounded-xl', 'w-full', 'bg-[var(--skeleton-bg)]');
    expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(container.querySelector('[data-operational-brief]')).toBeNull();
    expect(container.querySelector('[data-operational-value]')).toBeNull();
    expect(screen.queryByText('Total calls (24h)')).not.toBeInTheDocument();
    expect(screen.queryByText('API usage')).toBeInTheDocument();
    expect(screen.queryByText('No API usage data')).not.toBeInTheDocument();
  });

  it('renders the QueryError panel on an initial load failure (no cached data)', () => {
    useApiLogStatsMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, data: undefined }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Generic (non-HTTP) error → network/unknown branch of <QueryError>.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('API usage')).toBeInTheDocument();
    expect(screen.queryByText('Total calls (24h)')).not.toBeInTheDocument();
  });

  it('renders an EmptyState placeholder (never a blank panel) when data is absent', () => {
    useApiLogStatsMock.mockReturnValue(
      makeQuery({ data: undefined, isLoading: false, error: null, isError: false }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Titled shell still renders; the body degrades to the placeholder.
    expect(screen.getByRole('heading', {
      name: (name, element) => name === 'API usage' && !element.closest('[data-operational-brief]'),
    })).toBeInTheDocument();
    const brief = screen.getByRole('region', { name: 'API usage' });
    expect(within(brief).getByRole('heading', { name: 'API usage' })).toBeInTheDocument();
    expect(within(brief).getAllByText('—')).toHaveLength(4);
    expect(screen.getByText('No API usage data')).toBeInTheDocument();
    expect(screen.getByText('Total calls (24h)')).toBeInTheDocument();
    expect(within(brief).getByText('Avg response')).toBeInTheDocument();
    expect(within(brief).getByText('Error rate')).toBeInTheDocument();
    expect(within(brief).getByText('Errors')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('preserves unknown readings in a partial payload instead of inventing zeros', () => {
    // A partial payload keeps every metric slot but does not invent readings.
    useApiLogStatsMock.mockReturnValue(makeQuery({ data: {} as APICallLogStats }));

    expect(() => renderWidget({ cols: 2, rows: 2 })).not.toThrow();
    expect(screen.getByText('Total calls (24h)')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
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
    expect(screen.getByText('Total calls (24h)')).toBeInTheDocument();
    // … the full-panel error is NOT shown …
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    expect(screen.getByText('20.00 ms')).toBeInTheDocument();
    expect(screen.getByText('1.00%')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state="stale"]')).toHaveAttribute('aria-busy', 'false');
    const warning = screen.getByTestId('stale-refresh-warning');
    expect(warning).toHaveAttribute('role', 'status');
    expect(warning).toHaveAttribute('aria-live', 'polite');
    expect(within(warning).getByText('Data may be stale')).toBeInTheDocument();
    expect(within(warning).getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument();
    expect(within(screen.getByTestId('api-usage-operational-brief'))
      .getByText('Retained readings')).toBeInTheDocument();
    // The unchanged i18n stub leaves interpolation tokens literal; the source
    // control's semantic error state and retained-data notice carry trust here.
    const freshness = screen.getByRole('button', { name: 'Refresh data · {{state}}' });
    expect(freshness).toHaveClass('text-[var(--semantic-danger)]');
    expect(freshness).toHaveAttribute('aria-live', 'polite');
    expect(freshness).toHaveAttribute('aria-atomic', 'true');
    expect(freshness).toBeEnabled();
  });

  describe('APIUsageWidget — measured zero and missing readings', () => {
    it('keeps genuine zeros distinct from an unknown duration in wide mode', () => {
      useApiLogStatsMock.mockReturnValue(makeQuery({
        data: makeStats({ avgDurationMs: Number.NaN }),
      }));
      renderWidget({ cols: 3, rows: 2 });
      expect(screen.getAllByText('0')).toHaveLength(2);
      expect(screen.getByText('0.00%')).toBeInTheDocument();
      expect(screen.getByText('—')).toBeInTheDocument();
      expect(screen.queryByText('High')).not.toBeInTheDocument();
    });

    it('opens the actual review drawer with retained source windows and latency', () => {
      useApiLogStatsMock.mockReturnValue(makeQuery({
        data: makeStats({ last24h: 200, avgDurationMs: 123.4, errorRate: 12, errorCount: 24 }),
        isError: true, error: new Error('refresh failed'),
      }));
      renderWidget();
      const brief = screen.getByTestId('api-usage-operational-brief');
      expect(within(brief).getByText('Retained readings')).toBeInTheDocument();
      fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
      const drawer = screen.getByRole('dialog');
      expect(within(drawer).getByText('123.40 ms')).toBeInTheDocument();
      expect(within(drawer).getByText('12.00%')).toBeInTheDocument();
      expect(within(drawer).getByText('High')).toBeInTheDocument();
      const scope = 'System API logs; calls cover 24 hours, other counters have no exact source bounds';
      const headerScope = within(drawer).getByText(scope);
      expect(headerScope.closest('[data-drawer-header]')).not.toBeNull();
      expect(headerScope).toHaveTextContent(scope);
      const narrative = within(drawer).getByRole('region', { name: 'Decision narrative' });
      expect(within(narrative).getByText(/other counters have no exact source bounds/)).toHaveTextContent(
        `API activity and latency retain their reported windows; no service-wide confidence score is inferred. ${scope}`,
      );
      expect(within(drawer).getAllByText(/other counters have no exact source bounds/)).toHaveLength(2);
      expect(within(drawer).getByText('Total calls (24h)')).toBeInTheDocument();
      expect(within(drawer).getByText('200')).toBeInTheDocument();
      expect(within(drawer).getByText('24')).toBeInTheDocument();
      expect(within(drawer).getByText('API calls reported by the 24-hour source counter.')).toBeInTheDocument();
      expect(within(drawer).getByText('Reported average latency; source milliseconds are retained as canonical seconds.')).toBeInTheDocument();
    });
  });
});
