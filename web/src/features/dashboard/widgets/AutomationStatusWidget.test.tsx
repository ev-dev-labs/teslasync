/**
 * AutomationStatusWidget contract.
 *
 * The widget is a self-refreshing dashboard tile that summarises the fleet's
 * automations. Its shape is driven purely by two inputs: the `useAutomations()`
 * query result and the widget `size`.
 *
 *   - size.cols <= 1 || rows <= 1  → CompactView (enabled/total + failing chip)
 *   - otherwise                    → FullView (summary header + one row each)
 *   - size.cols >= 3               → FullView rows expose a per-automation Toggle
 *
 * Query state maps straight onto <WidgetShell>: `isLoading` → skeleton,
 * `error` → <QueryError>, and an empty list → <EmptyState>. Everything else
 * renders the status badge (getStatusBadge) and relative-time labels
 * (formatRelativeTime) for each automation.
 *
 * The suite locks, facet by facet:
 *   1. The three query states (loading / error / empty) each short-circuit the
 *      content and surface the right chrome.
 *   2. Compact view: enabled/total ratio + the failing chip only when something
 *      is actually failing.
 *   3. Full view: summary counts + one row per automation, and every branch of
 *      the status badge (auto-disabled / disabled / failing / ok / idle).
 *   4. Relative time: past runs render "Xm/Xh/Xd ago"; a *future* next-fire time
 *      renders "in Xm" (regression guard — it used to collapse to "Just now");
 *      an unparseable timestamp renders an em dash, never "NaN".
 *   5. Toggle: wide view shows accessible per-row switches that reflect each
 *      automation's enabled state and mutate with the flipped value; non-wide
 *      full view shows no switches.
 *
 * i18n is stubbed to return the interpolated English fallback so the visible
 * copy is deterministic, and `@/api/hooks/useAutomations` is mocked so no
 * network is touched. `Date.now` is pinned so relative-time output is stable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// i18n stub: passthrough that honours the English default and interpolates
// {{var}} tokens so every count/name assertion is real.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      const vars = typeof defaultValue === 'string' ? options : undefined;
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// The query result + toggle mutation are injected per-test through these
// mutable holders (the `MOCK_`/`mock` prefixes let vitest hoist the factory
// above them safely).
const mockToggleMutate = vi.fn();
let MOCK_QUERY!: AutomationsQuery;
vi.mock('@/api/hooks/useAutomations', () => ({
  useAutomations: () => MOCK_QUERY,
  useToggleAutomation: () => ({ mutate: mockToggleMutate }),
}));

import AutomationStatusWidget from './AutomationStatusWidget';
import type { WidgetSize } from './types';
import type { Automation } from '@/api/types';

/** Only the fields the widget reads off the query result. */
interface AutomationsQuery {
  data: Automation[];
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

// Pinned "now" — every fixture timestamp is expressed relative to it.
const NOW = Date.parse('2026-07-05T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  // The `Automation` type layers a "removed compatibility" mapped type
  // (trigger_type/conditions/... : never) on top of the model to forbid legacy
  // keys, so a plain object literal is cast to satisfy it.
  return {
    id: 1,
    name: 'Preheat cabin',
    description: null,
    enabled: true,
    vehicle_id: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    stop_on_failure: false,
    notify_on_run: false,
    notify_on_failure: false,
    seasonal_start: null,
    seasonal_end: null,
    last_triggered_at: null,
    last_success_at: null,
    last_failure_at: null,
    execution_count: 0,
    failure_count: 0,
    consecutive_failures: 0,
    auto_disabled: false,
    auto_disabled_reason: null,
    preset_id: null,
    next_fire_time: null,
    ...overrides,
  } as Automation;
}

function makeQuery(overrides: Partial<AutomationsQuery> = {}): AutomationsQuery {
  return {
    data: [],
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: NOW,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(size: WidgetSize, query: AutomationsQuery = makeQuery()) {
  MOCK_QUERY = query;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AutomationStatusWidget size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The `.flex-1` column that wraps a single automation row (name + times). */
function rowOf(name: string): HTMLElement {
  const el = screen.getByText(name).closest('.flex-1');
  if (!el) throw new Error(`row column for "${name}" not found`);
  return el as HTMLElement;
}

const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const WIDE: WidgetSize = { cols: 3, rows: 2 };

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  mockToggleMutate.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AutomationStatusWidget — query states', () => {
  it('renders a skeleton (and no content) while loading', () => {
    const { container } = renderWidget(FULL, makeQuery({ isLoading: true }));
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    // The content, title and empty state are all suppressed during load.
    expect(screen.queryByText('Automation Status')).toBeNull();
    expect(screen.queryByText('No automations configured')).toBeNull();
  });

  it('surfaces a query error instead of the automation list', () => {
    renderWidget(FULL, makeQuery({ error: new Error('boom'), isError: true }));
    // jsdom reports navigator.onLine === true, so QueryError lands on the
    // generic network branch (role="alert").
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No automations configured')).toBeNull();
  });

  it('renders an accessible empty state when there are no automations', () => {
    renderWidget(FULL, makeQuery({ data: [] }));
    const empty = screen.getByRole('status');
    expect(empty).toBeInTheDocument();
    expect(screen.getByText('No automations configured')).toBeInTheDocument();
  });
});

describe('AutomationStatusWidget — compact view', () => {
  it('summarises enabled/total and flags failing automations', () => {
    renderWidget(
      COMPACT,
      makeQuery({
        data: [
          makeAutomation({ id: 1, name: 'A', enabled: true, consecutive_failures: 2 }),
          makeAutomation({ id: 2, name: 'B', enabled: true }),
          makeAutomation({ id: 3, name: 'C', enabled: false }),
        ],
      }),
    );
    // 2 of 3 enabled, 1 of the enabled ones is failing.
    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('1 Failing')).toBeInTheDocument();
    // A cols<=1 tile suppresses the header title entirely.
    expect(screen.queryByText('Automation Status')).toBeNull();
  });

  it('omits the failing chip when nothing is failing', () => {
    renderWidget(
      COMPACT,
      makeQuery({
        data: [
          makeAutomation({ id: 1, name: 'A', enabled: true }),
          makeAutomation({ id: 2, name: 'B', enabled: true }),
          makeAutomation({ id: 3, name: 'C', enabled: true }),
        ],
      }),
    );
    expect(screen.getByText('3/3')).toBeInTheDocument();
    expect(screen.queryByText(/Failing/)).toBeNull();
  });
});

describe('AutomationStatusWidget — full view', () => {
  it('shows a titled summary header and one row per automation', () => {
    renderWidget(
      FULL,
      makeQuery({
        data: [
          makeAutomation({ id: 1, name: 'Preheat', enabled: true, last_success_at: iso(NOW) }),
          makeAutomation({ id: 2, name: 'Charge cap', enabled: true, consecutive_failures: 1 }),
          makeAutomation({ id: 3, name: 'Sentry sync', enabled: false }),
        ],
      }),
    );
    expect(screen.getByText('Automation Status')).toBeInTheDocument();
    // 2 enabled → "2 Active"; 1 enabled+failing → "1 Failing" summary.
    expect(screen.getByText('2 Active')).toBeInTheDocument();
    expect(screen.getByText('1 Failing')).toBeInTheDocument();
    expect(screen.getByText('Preheat')).toBeInTheDocument();
    expect(screen.getByText('Charge cap')).toBeInTheDocument();
    expect(screen.getByText('Sentry sync')).toBeInTheDocument();
  });

  it('renders the correct status badge for every automation state', () => {
    renderWidget(
      FULL,
      makeQuery({
        data: [
          makeAutomation({ id: 1, name: 'Auto A', enabled: true, auto_disabled: true }),
          makeAutomation({ id: 2, name: 'Disabled B', enabled: false }),
          makeAutomation({ id: 3, name: 'Failing C', enabled: true, consecutive_failures: 3 }),
          makeAutomation({ id: 4, name: 'Ok D', enabled: true, last_success_at: iso(NOW) }),
          makeAutomation({ id: 5, name: 'Idle E', enabled: true }),
        ],
      }),
    );
    // auto_disabled wins even though the automation is still "enabled".
    expect(within(rowOf('Auto A')).getByText('Auto-disabled')).toBeInTheDocument();
    expect(within(rowOf('Disabled B')).getByText('Disabled')).toBeInTheDocument();
    expect(within(rowOf('Failing C')).getByText('Failing')).toBeInTheDocument();
    expect(within(rowOf('Ok D')).getByText('OK')).toBeInTheDocument();
    expect(within(rowOf('Idle E')).getByText('Idle')).toBeInTheDocument();
  });
});

describe('AutomationStatusWidget — relative time', () => {
  it('formats past run times as "Xm/Xh/Xd ago" and near-now as "Just now"', () => {
    renderWidget(
      FULL,
      makeQuery({
        data: [
          makeAutomation({ id: 1, name: 'Five', last_triggered_at: iso(NOW - 5 * 60_000) }),
          makeAutomation({ id: 2, name: 'Hour', last_triggered_at: iso(NOW - 90 * 60_000) }),
          makeAutomation({ id: 3, name: 'Day', last_triggered_at: iso(NOW - 26 * 3_600_000) }),
          makeAutomation({ id: 4, name: 'Now', last_triggered_at: iso(NOW - 30_000) }),
        ],
      }),
    );
    expect(within(rowOf('Five')).getByText('5m ago')).toBeInTheDocument();
    expect(within(rowOf('Hour')).getByText('1h ago')).toBeInTheDocument();
    expect(within(rowOf('Day')).getByText('1d ago')).toBeInTheDocument();
    expect(within(rowOf('Now')).getByText('Just now')).toBeInTheDocument();
  });

  it('formats a future next-fire time as "in Xm/Xh/Xd", not "Just now"', () => {
    renderWidget(
      FULL,
      makeQuery({
        data: [
          makeAutomation({ id: 1, name: 'SoonFire', next_fire_time: iso(NOW + 10 * 60_000) }),
          makeAutomation({ id: 2, name: 'HourFire', next_fire_time: iso(NOW + 3 * 3_600_000) }),
          makeAutomation({ id: 3, name: 'DayFire', next_fire_time: iso(NOW + 2 * 86_400_000) }),
        ],
      }),
    );
    expect(within(rowOf('SoonFire')).getByText('in 10m')).toBeInTheDocument();
    expect(within(rowOf('HourFire')).getByText('in 3h')).toBeInTheDocument();
    expect(within(rowOf('DayFire')).getByText('in 2d')).toBeInTheDocument();
    // Regression guard: a future instant must not collapse to the past-tense label.
    expect(within(rowOf('SoonFire')).queryByText('Just now')).toBeNull();
  });

  it('renders an em dash for an unparseable timestamp instead of "NaN"', () => {
    renderWidget(
      FULL,
      makeQuery({
        data: [makeAutomation({ id: 1, name: 'Broken', last_triggered_at: 'not-a-real-date' })],
      }),
    );
    const row = rowOf('Broken');
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(row.textContent ?? '').not.toContain('NaN');
  });
});

describe('AutomationStatusWidget — toggle interaction', () => {
  it('exposes accessible per-row switches in wide view that mutate with the flipped state', () => {
    renderWidget(
      WIDE,
      makeQuery({
        data: [
          makeAutomation({ id: 11, name: 'On One', enabled: true }),
          makeAutomation({ id: 22, name: 'Off Two', enabled: false }),
        ],
      }),
    );
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(2);

    const onToggle = screen.getByRole('switch', { name: 'Toggle On One' });
    const offToggle = screen.getByRole('switch', { name: 'Toggle Off Two' });
    expect(onToggle).toHaveAttribute('aria-checked', 'true');
    expect(offToggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(onToggle);
    expect(mockToggleMutate).toHaveBeenCalledWith({ id: 11, enabled: false });

    fireEvent.click(offToggle);
    expect(mockToggleMutate).toHaveBeenCalledWith({ id: 22, enabled: true });
    expect(mockToggleMutate).toHaveBeenCalledTimes(2);
  });

  it('does not render switches in a non-wide full view', () => {
    renderWidget(FULL, makeQuery({ data: [makeAutomation({ id: 1, name: 'Solo' })] }));
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });
});
