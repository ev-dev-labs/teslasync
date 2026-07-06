/**
 * AutomationHistoryWidget — behavioural, branch, null-safety and a11y coverage
 * for the dashboard "Automation History" widget.
 *
 * The widget reads `useAutomationHistory()` (TanStack Query) and renders one of
 * two layouts driven by `size.cols`:
 *   • compact (cols ≤ 1): a big success-rate %, a caption, and the last-run
 *     timestamp — or an empty state when nothing has run;
 *   • full (cols ≥ 2): a graded success-rate badge, a total-runs count, and an
 *     event feed of recent executions.
 *
 * What this file pins:
 *   - the LAYOUT SWITCH (compact vs full) and each layout's empty state;
 *   - the STATUS → EventFeedItem MAPPING — icon colour + severity per status,
 *     the DEFAULT fallback for an unknown status, the `status · duration`
 *     subtitle, and the null-safe "—"/epoch guards for missing fields;
 *   - the BADGE GRADING thresholds (success ≥90 / warning ≥50 / danger <50) and
 *     the fix that a zero success-rate with ZERO runs is NEUTRAL, not a red
 *     "danger" chip (a fresh install must not look broken);
 *   - the ERROR handling fix — an errored load with no data surfaces an error
 *     panel instead of the misleading "no runs yet" empty state, while a
 *     background-refetch error over cached data keeps the data on screen;
 *   - the REFRESH control wiring (freshness chip → `refetch`).
 *
 * Strategy: the data hook is the network boundary and is fully controllable via
 * a hoisted mock. `react-i18next` echoes each `t(key, fallback)` fallback so
 * assertions read against English copy. The display-boundary hooks
 * (`useDateFormat` / `useTimeFormatPreference` / `useMotionPreference`) are
 * stubbed so the tree renders synchronously without a QueryClient/Settings
 * provider. The shared `WidgetEventFeed` is stubbed to expose the mapped
 * EventFeedItem fields (colour, severity, title, subtitle, timestamp) directly,
 * so the widget's mapping logic is asserted without reaching into TimelineItem's
 * DOM. A `<MemoryRouter>` wraps every render because the error panel navigates.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type {
  AutomationHistory,
  AutomationHistoryListResponse,
  AutomationHistoryStats,
  AutomationHistoryStatus,
} from '@/api/types';
import type { WidgetSize } from './types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { historyMock } = vi.hoisted(() => ({ historyMock: vi.fn() }));

// The single network boundary the widget consumes.
vi.mock('@/api/hooks/useAutomations', () => ({
  useAutomationHistory: () => historyMock(),
}));

// i18n → return the developer fallback so copy reads as English.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string) => fallback ?? _key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// Display-boundary hooks reach into the Settings query; stub them so no
// QueryClient/provider is required and formatting is deterministic.
vi.mock('@/hooks/useDateFormat', () => {
  const echo = (v: unknown) => String(v);
  return {
    useDateFormat: () => ({
      opts: {},
      tz: 'UTC',
      locale: 'en-US',
      formatDate: echo,
      formatDateTime: echo,
      formatTime: echo,
      formatDateShort: echo,
      formatDateWithDay: echo,
      formatRelative: echo,
      formatRelativeTime: echo,
      formatRelativeDays: echo,
    }),
  };
});
vi.mock('@/hooks/useTimeFormatPreference', () => ({
  useTimeFormatPreference: () => 'relative',
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));

// Expose the mapped EventFeedItem fields so the widget's status→item mapping is
// directly observable (order preserved — no sorting in the stub).
vi.mock('./shared', () => ({
  WidgetEventFeed: ({
    items,
    emptyMessage,
  }: {
    items: Array<{
      id: string | number;
      title: string;
      subtitle?: string;
      timestamp: string;
      color: string;
      severity?: string;
    }>;
    emptyMessage?: string;
  }) =>
    items.length === 0 ? (
      <div data-testid="feed-empty">{emptyMessage}</div>
    ) : (
      <ul data-testid="feed">
        {items.map((it) => (
          <li
            key={it.id}
            data-testid="feed-item"
            data-color={it.color}
            data-severity={it.severity}
            data-timestamp={it.timestamp}
          >
            <span data-testid="feed-title">{it.title}</span>
            <span data-testid="feed-subtitle">{it.subtitle}</span>
          </li>
        ))}
      </ul>
    ),
}));

import AutomationHistoryWidget from './AutomationHistoryWidget';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = '2026-07-05T12:00:00.000Z';
const EPOCH = '1970-01-01T00:00:00.000Z';

function makeHistory(over: Partial<AutomationHistory> = {}): AutomationHistory {
  return {
    id: 1,
    automation_id: 10,
    automation_name: 'Nightly Charge',
    vehicle_id: 7,
    triggered_at: NOW,
    completed_at: NOW,
    duration_ms: 1500,
    trigger_type: 'schedule',
    trigger_snapshot: null,
    conditions_met: true,
    conditions_snapshot: null,
    actions_executed: null,
    actions_total: 1,
    actions_succeeded: 1,
    actions_failed: 0,
    status: 'success',
    error: null,
    fsm_state: null,
    created_at: NOW,
    ...over,
  };
}

function makeStats(over: Partial<AutomationHistoryStats> = {}): AutomationHistoryStats {
  return {
    total_executions: 2,
    succeeded: 2,
    failed: 0,
    partial: 0,
    success_rate: 100,
    avg_duration_ms: 1500,
    ...over,
  };
}

function makeResponse(
  items: AutomationHistory[],
  statsOver: Partial<AutomationHistoryStats> = {},
): AutomationHistoryListResponse {
  return {
    items,
    total: items.length,
    limit: 20,
    offset: 0,
    summary: makeStats(statsOver),
  };
}

interface QueryOverrides {
  data?: AutomationHistoryListResponse;
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function setQuery(over: QueryOverrides = {}) {
  const q = {
    data: undefined as AutomationHistoryListResponse | undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.parse(NOW),
    refetch: vi.fn(),
    ...over,
  };
  historyMock.mockReturnValue(q);
  return q;
}

const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

function renderWidget(size: WidgetSize = FULL) {
  return render(
    <MemoryRouter>
      <AutomationHistoryWidget size={size} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible default: a healthy, fully-successful full-size response.
  setQuery({ data: makeResponse([makeHistory()]) });
});

// ── Loading & error states ────────────────────────────────────────────────────

describe('AutomationHistoryWidget — loading & error states', () => {
  it('renders only a skeleton (no title or content) while loading', () => {
    setQuery({ isLoading: true, data: undefined });
    const { container } = renderWidget(FULL);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: /Automation History/i })).toBeNull();
    expect(screen.queryByTestId('feed')).toBeNull();
    expect(screen.queryByTestId('feed-empty')).toBeNull();
  });

  it('surfaces an error panel instead of the empty state when the query errors with no data', () => {
    setQuery({ isError: true, data: undefined });
    renderWidget(FULL);

    // The error branch replaces all content — the misleading "no runs" empty
    // state must NOT be what the user sees on a failed load.
    expect(screen.queryByTestId('feed-empty')).toBeNull();
    expect(screen.queryByText('No automation runs yet')).toBeNull();
    expect(screen.getByText(/Can't reach server|You're offline/)).toBeInTheDocument();
  });

  it('keeps cached data visible (no error panel) when a background refetch errors', () => {
    setQuery({ isError: true, data: makeResponse([makeHistory({ automation_name: 'Nightly Charge' })]) });
    renderWidget(FULL);

    expect(screen.queryByText(/Can't reach server|You're offline/)).toBeNull();
    expect(screen.getByText('Nightly Charge')).toBeInTheDocument();
  });
});

// ── Full layout ───────────────────────────────────────────────────────────────

describe('AutomationHistoryWidget — full layout', () => {
  it('renders the heading, graded success-rate badge and total-runs count', () => {
    setQuery({ data: makeResponse([makeHistory()], { success_rate: 100, total_executions: 2 }) });
    renderWidget(FULL);

    expect(screen.getByRole('heading', { name: /Automation History/i })).toBeInTheDocument();
    const badge = screen.getByText(/100\.0% Success Rate/);
    expect(badge).toHaveClass('bg-green-100');
    expect(screen.getByText('2 runs')).toBeInTheDocument();
  });

  it('omits the total-runs count and stays neutral when the response has no summary', () => {
    // `data` undefined → summary absent → the "N runs" caption must not render,
    // and the widget must not crash on the missing summary.
    setQuery({ data: undefined });
    renderWidget(FULL);

    const badge = screen.getByText(/0\.0% Success Rate/);
    expect(badge).toHaveClass('bg-gray-100');
    expect(screen.queryByText(/^\d+ runs$/)).toBeNull();
    expect(screen.getByTestId('feed-empty')).toHaveTextContent('No automation runs yet');
  });
});

// ── Event-feed mapping & null safety ──────────────────────────────────────────

describe('AutomationHistoryWidget — event-feed mapping & null safety', () => {
  it('maps each row to a feed item with status-driven colour, severity and subtitle', () => {
    setQuery({
      data: makeResponse(
        [
          makeHistory({ id: 1, automation_name: 'Nightly Charge', status: 'success', duration_ms: 1500 }),
          makeHistory({ id: 2, automation_name: 'Climate Preheat', status: 'failed', duration_ms: 500 }),
        ],
        { success_rate: 50, total_executions: 2, succeeded: 1, failed: 1 },
      ),
    });
    renderWidget(FULL);

    const rows = screen.getAllByTestId('feed-item');
    expect(rows).toHaveLength(2);

    expect(within(rows[0]).getByTestId('feed-title')).toHaveTextContent('Nightly Charge');
    expect(within(rows[0]).getByTestId('feed-subtitle')).toHaveTextContent('success · 1.5s');
    expect(rows[0]).toHaveAttribute('data-color', '#22c55e');
    expect(rows[0]).toHaveAttribute('data-severity', 'info');

    expect(within(rows[1]).getByTestId('feed-subtitle')).toHaveTextContent('failed · 500ms');
    expect(rows[1]).toHaveAttribute('data-color', '#ef4444');
    expect(rows[1]).toHaveAttribute('data-severity', 'critical');
  });

  it('falls back to the DEFAULT mapping (grey / info) for an unknown status', () => {
    setQuery({
      data: makeResponse(
        [makeHistory({ id: 3, status: 'mystery' as AutomationHistoryStatus, duration_ms: 1500 })],
        { total_executions: 1, success_rate: 0, succeeded: 0 },
      ),
    });
    renderWidget(FULL);

    const row = screen.getByTestId('feed-item');
    expect(row).toHaveAttribute('data-color', '#6b7280');
    expect(row).toHaveAttribute('data-severity', 'info');
    // The raw (unknown) status is still echoed into the subtitle label.
    expect(within(row).getByTestId('feed-subtitle')).toHaveTextContent('mystery · 1.5s');
  });

  it('is null-safe: renders "—" placeholders and an epoch timestamp for a row with missing fields', () => {
    setQuery({
      data: makeResponse(
        [
          makeHistory({
            id: 4,
            automation_name: null as unknown as string,
            status: null as unknown as AutomationHistoryStatus,
            duration_ms: null,
            triggered_at: null as unknown as string,
          }),
        ],
        { total_executions: 1 },
      ),
    });
    renderWidget(FULL);

    const row = screen.getByTestId('feed-item');
    expect(within(row).getByTestId('feed-title')).toHaveTextContent('—');
    expect(within(row).getByTestId('feed-subtitle')).toHaveTextContent('— · —');
    expect(row).toHaveAttribute('data-timestamp', EPOCH);
    expect(row).toHaveAttribute('data-color', '#6b7280');
  });
});

// ── Badge grading ─────────────────────────────────────────────────────────────

describe('AutomationHistoryWidget — badge grading', () => {
  it.each([
    [95, 'bg-green-100'],
    [60, 'bg-yellow-100'],
    [30, 'bg-red-100'],
  ])('grades a %i%% success rate (with runs) using the %s variant', (rate, cls) => {
    setQuery({
      data: makeResponse([makeHistory()], { success_rate: rate, total_executions: 5, succeeded: 1 }),
    });
    renderWidget(FULL);

    const badge = screen.getByText(new RegExp(`${rate}\\.0% Success Rate`));
    expect(badge).toHaveClass(cls);
  });

  it('uses a NEUTRAL badge (not danger) when there are zero runs', () => {
    setQuery({ data: makeResponse([], { success_rate: 0, total_executions: 0, succeeded: 0 }) });
    renderWidget(FULL);

    const badge = screen.getByText(/0\.0% Success Rate/);
    expect(badge).toHaveClass('bg-gray-100');
    expect(badge).not.toHaveClass('bg-red-100');
    expect(screen.getByTestId('feed-empty')).toHaveTextContent('No automation runs yet');
  });
});

// ── Compact layout ────────────────────────────────────────────────────────────

describe('AutomationHistoryWidget — compact layout', () => {
  it('renders the success-rate percentage, caption and no event feed', () => {
    setQuery({ data: makeResponse([makeHistory({ triggered_at: NOW })], { success_rate: 75, total_executions: 8 }) });
    renderWidget(COMPACT);

    expect(screen.getByText('75.0%')).toBeInTheDocument();
    expect(screen.getByText('Success Rate')).toBeInTheDocument();
    expect(screen.queryByTestId('feed')).toBeNull();
    expect(screen.queryByText('No automation runs yet')).toBeNull();
  });

  it('shows the empty state (not a 0% figure) when there are no runs', () => {
    setQuery({ data: makeResponse([], { total_executions: 0, success_rate: 0 }) });
    renderWidget(COMPACT);

    expect(screen.getByText('No automation runs yet')).toBeInTheDocument();
    expect(screen.queryByText('0.0%')).toBeNull();
  });
});

// ── Interactions & accessibility ──────────────────────────────────────────────

describe('AutomationHistoryWidget — interactions & a11y', () => {
  it('invokes refetch when the accessible refresh control is activated', () => {
    const q = setQuery({ data: makeResponse([makeHistory()]) });
    renderWidget(FULL);

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.click(refresh);

    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('exposes the widget title as a heading', () => {
    setQuery({ data: makeResponse([makeHistory()]) });
    renderWidget(FULL);

    expect(
      screen.getByRole('heading', { name: /Automation History/i }),
    ).toBeInTheDocument();
  });
});
