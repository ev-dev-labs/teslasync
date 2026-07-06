/**
 * ActivityTrendPanel — behaviour, a11y + hardening cover.
 *
 * The panel is the "My Activity" hero: a gap-filled daily bar chart that owns
 * its own loading / error / empty / populated states. It is a pure
 * props-in / JSX-out component, so these tests drive it directly rather than
 * through a QueryClient. What is pinned here:
 *
 *   1. Populated — the chart region is exposed as a single labelled `role="img"`
 *      whose accessible name summarises the window (total actions × days), and
 *      none of the other states leak in.
 *   2. Loading — a busy skeleton, the title shell kept, no chart / empty / error.
 *   3. Error — QueryError renders an alert with a Retry control wired to onRetry.
 *   4. Error / null payload (NEW hardening) — an `isError` window with a falsy
 *      `error` must NOT collapse to a bare title; the FALLBACK_ERROR keeps a
 *      recoverable retry state on screen.
 *   5. Empty via the `isEmpty` flag — takes precedence over present data.
 *   6. Empty via a zero-length window.
 *   7. Quiet window — non-empty gap-filled days with zero counts still render the
 *      chart (not the empty state) and summarise "0 actions".
 *   8. Null-safety (NEW hardening) — NaN / null / negative / fractional counts are
 *      coerced so the summary total is exact and no `NaN` ever reaches the DOM.
 *   9. Precedence — loading beats error when both flags are set.
 *  10. Null `data` prop — degrades to the empty state instead of throwing.
 *  11. className passthrough + decorative header icon.
 *
 * `react-i18next` is stubbed to the English-fallback + {{var}} interpolation
 * (repo convention — see AcDcStatsPanel.test / FleetComparisonPanel.test) so the
 * aria summary is deterministic, and `useOnlineStatus` is pinned to `true` so
 * QueryError takes its deterministic online branch. Renders are wrapped in
 * <MemoryRouter> because the real QueryError / EmptyState reach for react-router
 * navigation hooks. No network is touched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { ActivityTrendPanel, type ActivityTrendPanelProps } from './ActivityTrendPanel';
import type { TrendPoint } from './myActivityAnalytics';

// English-fallback i18n with {{placeholder}} interpolation (repo convention).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tpl: string, vars?: Record<string, unknown>) =>
    vars ? tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`)) : tpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        if (typeof second === 'string') {
          const vars = third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined;
          return interpolate(second, vars);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Pin QueryError's network branch to "online" so its role + retry copy are
// deterministic regardless of the jsdom navigator.onLine default.
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

const TITLE = 'Activity over time';
const EMPTY = 'No activity recorded in this window.';

function point(overrides: Partial<TrendPoint> = {}): TrendPoint {
  return { day: '2024-04-01', label: 'Apr 1', count: 0, ...overrides };
}

function renderPanel(overrides: Partial<ActivityTrendPanelProps> = {}) {
  const props: ActivityTrendPanelProps = {
    data: [],
    isLoading: false,
    isError: false,
    isEmpty: false,
    error: null,
    onRetry: vi.fn(),
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <ActivityTrendPanel {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('ActivityTrendPanel — populated', () => {
  it('renders a single labelled chart region summarising total actions × days', () => {
    renderPanel({
      data: [
        point({ day: '2024-04-01', label: 'Apr 1', count: 1 }),
        point({ day: '2024-04-02', label: 'Apr 2', count: 2 }),
      ],
    });

    // The panel title shell is always present as a heading.
    expect(screen.getByRole('heading', { name: new RegExp(TITLE, 'i') })).toBeInTheDocument();

    // The bar chart is exposed as one image with a data-derived accessible name:
    // 1 + 2 = 3 actions across the 2 gap-filled days.
    const chart = screen.getByRole('img', { name: '3 actions across 2 days' });
    expect(chart).toBeInTheDocument();

    // None of the other states leak into the populated view.
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    expect(document.querySelector('.animate-pulse')).toBeNull();
  });

  it('renders the chart (not the empty state) for a quiet window of all-zero days', () => {
    // Gap-filled days exist but nothing happened → still a chart, summarising 0.
    renderPanel({
      isEmpty: false,
      data: [point({ label: 'A', count: 0 }), point({ label: 'B', count: 0 }), point({ label: 'C', count: 0 })],
    });

    expect(screen.getByRole('img', { name: '0 actions across 3 days' })).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });
});

describe('ActivityTrendPanel — loading / error', () => {
  it('shows a busy skeleton (keeping the title) and no chart while loading', () => {
    const { container } = renderPanel({
      isLoading: true,
      data: [point({ count: 5 })], // present data must not pre-empt the skeleton
    });

    expect(screen.getByRole('heading', { name: new RegExp(TITLE, 'i') })).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('renders an error alert and invokes onRetry when the retry control is used', () => {
    const onRetry = vi.fn();
    renderPanel({ isError: true, error: new Error('boom'), onRetry });

    // The error card is an assertive alert (online branch), never the chart.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('never collapses to a blank panel when isError is set without an error payload', () => {
    // Regression guard for the FALLBACK_ERROR hardening: QueryError returns null
    // for a falsy error, which pre-fix left only the title behind.
    const onRetry = vi.fn();
    renderPanel({ isError: true, error: null, onRetry });

    expect(screen.getByRole('heading', { name: new RegExp(TITLE, 'i') })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('gives loading precedence over error when both flags are set', () => {
    const { container } = renderPanel({ isLoading: true, isError: true, error: new Error('x') });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});

describe('ActivityTrendPanel — empty states', () => {
  it('shows the empty placeholder when the isEmpty flag is set, even with data present', () => {
    renderPanel({ isEmpty: true, data: [point({ count: 9 })] });

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(screen.getByText(EMPTY)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the empty placeholder for a zero-length window', () => {
    renderPanel({ isEmpty: false, data: [] });

    expect(screen.getByText(EMPTY)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('degrades to the empty state instead of throwing when data is null', () => {
    const run = () =>
      renderPanel({ isEmpty: false, data: null as unknown as TrendPoint[] });

    expect(run).not.toThrow();
    expect(screen.getByText(EMPTY)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('ActivityTrendPanel — null safety + a11y', () => {
  it('coerces NaN / null / negative / fractional counts so the summary total is exact and NaN-free', () => {
    const { container } = renderPanel({
      data: [
        point({ label: 'A', count: 3 }),
        point({ label: 'B', count: Number.NaN as unknown as number }),
        point({ label: 'C', count: null as unknown as number }),
        point({ label: 'D', count: -4 }),
        point({ label: 'E', count: 2.9 }),
      ] as TrendPoint[],
    });

    // 3 + 0 (NaN) + 0 (null) + 0 (negative) + 2 (trunc 2.9) = 5 across 5 days.
    expect(screen.getByRole('img', { name: '5 actions across 5 days' })).toBeInTheDocument();
    // No arithmetic ever leaks to the DOM.
    expect(container.textContent).not.toContain('NaN');
  });

  it('applies the caller className to the panel shell and marks the header icon decorative', () => {
    const { container } = renderPanel({
      className: 'trend-xl',
      data: [point({ count: 1 })],
    });

    expect(container.querySelector('.trend-xl')).toBeTruthy();
    // The header glyph is decorative (aria-hidden) so it is not announced twice.
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    // The meaningful chart still carries an accessible name.
    expect(screen.getByRole('img', { name: '1 actions across 1 days' })).toBeInTheDocument();
  });
});
