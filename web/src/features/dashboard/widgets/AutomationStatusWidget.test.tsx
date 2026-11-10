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
 * renders the status badge (getStatusBadge) and localized absolute date/time
 * labels for each automation.
 *
 * The suite locks, facet by facet:
 *   1. The three query states (loading / error / empty) each short-circuit the
 *      content and surface the right chrome.
 *   2. Compact view: enabled/total ratio + the failing chip only when something
 *      is actually failing.
 *   3. Full view: summary counts + one row per automation, and every branch of
 *      the status badge (auto-disabled / disabled / failing / ok / idle).
 *   4. Schedules: past runs and future next-fire times use localized date/time;
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
import { cleanup, fireEvent, render, screen, within, act, waitFor } from '@testing-library/react';
import { getGlobalLocale, setGlobalLocale } from '@/lib/numberFormat';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

const pack = vi.hoisted(() => ({ id: 'classic' as PackId }));
vi.mock('./designPacks/PackBoundary', async importOriginal => ({
  ...await importOriginal<typeof import('./designPacks/PackBoundary')>(),
  usePackPresentation: () => pack.id,
}));

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
  data: Automation[] | undefined;
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

async function renderWidget(size: WidgetSize, query: AutomationsQuery = makeQuery()) {
  MOCK_QUERY = query;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AutomationStatusWidget size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  if (pack.id !== 'classic' && query.data?.length && !query.isLoading) {
    const appearance = PACK_APPEARANCES[pack.id];
    await waitFor(() => expect(view.container.querySelector(`[data-status-appearance="${appearance}"]`)).not.toBeNull());
  }
  return view;
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
  pack.id = 'classic';
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  mockToggleMutate.mockClear();
});

it('keeps the existing per-row mutation owner and focused toggle mounted through every pack switch', async () => {
  MOCK_QUERY = makeQuery({ data: [makeAutomation({ name: 'Retained routine' })] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter><AutomationStatusWidget size={WIDE} /></MemoryRouter></QueryClientProvider>;
  const view = render(tree());
  const toggle = screen.getByRole('switch', { name: 'Toggle Retained routine' });
  toggle.focus();
  for (const [id, appearance] of Object.entries(PACK_APPEARANCES)) {
    pack.id = id as PackId;
    view.rerender(tree());
    await waitFor(() => expect(view.container.querySelector(`[data-status-appearance="${appearance}"]`)).not.toBeNull());
    expect(screen.getByRole('switch', { name: 'Toggle Retained routine' })).toBe(toggle);
    expect(toggle).toHaveFocus();
  }
  pack.id = 'classic';
  view.rerender(tree());
  expect(screen.getByRole('switch', { name: 'Toggle Retained routine' })).toBe(toggle);
  fireEvent.click(toggle);
  expect(mockToggleMutate).toHaveBeenCalledExactlyOnceWith({ id: 1, enabled: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each([1, 2, 3])('AutomationStatusWidget — identifying heading at cols=%i', (cols) => {
  it.each(['populated', 'loading', 'empty', 'initial failure', 'retained failure'] as const)(
    'keeps exactly one visible shell heading when %s',
    async (state) => {
      const populated = state === 'populated' || state === 'retained failure';
      const failed = state === 'initial failure' || state === 'retained failure';
      const { container } = await renderWidget({ cols, rows: 2 }, makeQuery({
        data: populated ? [makeAutomation({ name: 'Retained automation' })] : state === 'empty' ? [] : undefined,
        isLoading: state === 'loading',
        isError: failed,
        error: failed ? new Error('offline') : null,
      }));
      const headings = screen.getAllByRole('heading', { name: 'Automation status', level: 3 });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toBeVisible();
      if (populated) {
        expect(screen.getByText('Active')).toBeInTheDocument();
        if (cols === 1) expect(screen.getByText('1/1')).toBeInTheDocument();
        else expect(screen.getByText('Retained automation')).toBeInTheDocument();
        if (cols === 3) expect(screen.getByRole('switch', { name: 'Toggle Retained automation' })).toBeInTheDocument();
      }
      if (state === 'loading') {
        const skeleton = container.querySelector('[aria-hidden="true"].bg-\\[var\\(--skeleton-bg\\)\\]');
        expect(skeleton).toBeInTheDocument();
        expect(skeleton).toHaveClass('h-full', 'w-full', 'min-h-24', 'rounded-xl');
        expect(skeleton).toHaveAttribute('aria-hidden', 'true');
        expect(skeleton?.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
        expect(container.querySelector('.animate-pulse')).toBeNull();
      }
      if (state === 'empty') expect(screen.getByText('No automations configured')).toBeInTheDocument();
      if (state === 'initial failure') expect(screen.getByRole('alert')).toBeInTheDocument();
      if (state === 'retained failure') expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    },
  );
});

describe.each(PACK_IDS)('AutomationStatusWidget — query states [%s]', (id) => {
  beforeEach(() => {
    pack.id = id;
  });

  it('renders a skeleton (and no content) while loading', async () => {
    const { container } = await renderWidget(FULL, makeQuery({ isLoading: true, data: undefined }));
    const skeleton = container.querySelector('[aria-hidden="true"].bg-\\[var\\(--skeleton-bg\\)\\]');
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveClass('h-full', 'w-full', 'min-h-24', 'rounded-xl');
    expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    expect(skeleton?.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('.animate-pulse')).toBeNull();
    // The title remains; content and empty state are suppressed during load.
    expect(screen.queryByText('Automation status')).toBeInTheDocument();
    expect(screen.queryByText('No automations configured')).toBeNull();
  });

  it('surfaces a query error instead of the automation list', async () => {
    await renderWidget(FULL, makeQuery({ error: new Error('boom'), isError: true, data: undefined }));
    // jsdom reports navigator.onLine === true, so QueryError lands on the
    // generic network branch (role="alert").
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No automations configured')).toBeNull();
  });

  it('renders an accessible empty state when there are no automations', async () => {
    await renderWidget(FULL, makeQuery({ data: [] }));
    const empty = screen.getByRole('status');
    expect(empty).toBeInTheDocument();
    expect(screen.getByText('No automations configured')).toBeInTheDocument();
  });
});

describe.each(PACK_IDS)('AutomationStatusWidget — compact view [%s]', (id) => {
  beforeEach(() => {
    pack.id = id;
  });

  it('summarises enabled/total and flags failing automations', async () => {
    await renderWidget(
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
    // A cols<=1 tile still has an accessible identifying header.
    expect(screen.getByRole('heading', { name: 'Automation status', level: 3 })).toBeVisible();
  });

  it('omits the failing chip when nothing is failing', async () => {
    await renderWidget(
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

  it('preserves a measured zero active count without counting disabled failures', async () => {
    await renderWidget(COMPACT, makeQuery({
      data: [makeAutomation({ enabled: false, consecutive_failures: 3 })],
    }));
    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.queryByText(/Failing/)).toBeNull();
    expect(screen.queryByText('No automations configured')).toBeNull();
  });
});

describe.each(PACK_IDS)('AutomationStatusWidget — full view [%s]', (id) => {
  beforeEach(() => {
    pack.id = id;
  });

  it('reviews measured configuration counts while preserving the live per-entity action rail', async () => {
    await renderWidget(WIDE, makeQuery({
      data: [
        makeAutomation({ id: 1, name: 'Retained enabled', enabled: true }),
        makeAutomation({ id: 2, name: 'Retained failing', enabled: true, consecutive_failures: 2 }),
      ],
      isError: true, error: new Error('refresh failed'),
    }));
    expect(screen.getByRole('switch', { name: 'Toggle Retained enabled' })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('1 Failing')).toBeInTheDocument();
  });
  it('shows a titled summary header and one row per automation', async () => {
    await renderWidget(
      FULL,
      makeQuery({
        data: [
          makeAutomation({ id: 1, name: 'Preheat', enabled: true, last_success_at: iso(NOW) }),
          makeAutomation({ id: 2, name: 'Charge cap', enabled: true, consecutive_failures: 1 }),
          makeAutomation({ id: 3, name: 'Sentry sync', enabled: false }),
        ],
      }),
    );
    expect(screen.getByText('Automation status')).toBeInTheDocument();
    // 2 enabled → "2 Active"; 1 enabled+failing → "1 Failing" summary.
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Preheat')).toBeInTheDocument();
    expect(screen.getByText('Charge cap')).toBeInTheDocument();
    expect(screen.getByText('Sentry sync')).toBeInTheDocument();
  });

  describe('AutomationStatusWidget — retained automation evidence', () => {
    it('reacts to locale changes for counts without recasing automation identities', async () => {
      const locale = getGlobalLocale();
      try {
        const automations = Array.from({ length: 1000 }, (_, index) => makeAutomation({ id: index + 1, name: `CaseSensitive-${index}` }));
        await renderWidget(COMPACT, makeQuery({ data: automations }));
        act(() => setGlobalLocale('de-DE'));
        expect(screen.getByText('1.000/1.000')).toBeInTheDocument();
      } finally {
        act(() => setGlobalLocale(locale));
      }
    });

    it('keeps statuses and wide toggles on a failed refresh with real recovery', async () => {
      const refetch = vi.fn();
      await renderWidget(WIDE, makeQuery({
        data: [makeAutomation({ name: 'Retained automation', enabled: true })],
        isError: true,
        error: new Error('refresh failed'),
        refetch,
      }));
      expect(screen.getByRole('switch', { name: 'Toggle Retained automation' })).toBeInTheDocument();
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
      // The shell hides the warning retry when the freshness control exists; recovery is the freshness dot.
      fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Can't reach server")).toBeNull();
    });
  });

  it('renders the correct status badge for every automation state', async () => {
    await renderWidget(
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

describe.each(PACK_IDS)('AutomationStatusWidget — schedule times [%s]', (id) => {
  beforeEach(() => {
    pack.id = id;
  });

  it('formats past run times as localized absolute date/time values', async () => {
    await renderWidget(
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
    expect(within(rowOf('Five')).getByText(/\d{1,4}/)).toBeInTheDocument();
    expect(within(rowOf('Hour')).getByText(/\d{1,4}/)).toBeInTheDocument();
    expect(within(rowOf('Day')).getByText(/\d{1,4}/)).toBeInTheDocument();
    expect(within(rowOf('Now')).getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument();
  });

  it('formats future next-fire times as absolute date/time values', async () => {
    await renderWidget(
      FULL,
      makeQuery({
        data: [
          makeAutomation({ id: 1, name: 'SoonFire', next_fire_time: iso(NOW + 10 * 60_000) }),
          makeAutomation({ id: 2, name: 'HourFire', next_fire_time: iso(NOW + 3 * 3_600_000) }),
          makeAutomation({ id: 3, name: 'DayFire', next_fire_time: iso(NOW + 2 * 86_400_000) }),
        ],
      }),
    );
    expect(within(rowOf('SoonFire')).getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument();
    expect(within(rowOf('HourFire')).getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument();
    expect(within(rowOf('DayFire')).getByText(/\d{1,4}/)).toBeInTheDocument();
  });

  it('renders an em dash for an unparseable timestamp instead of "NaN"', async () => {
    await renderWidget(
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

describe.each(PACK_IDS)('AutomationStatusWidget — toggle interaction [%s]', (id) => {
  beforeEach(() => {
    pack.id = id;
  });

  it('exposes accessible per-row switches in wide view that mutate with the flipped state', async () => {
    await renderWidget(
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

  it('does not render switches in a non-wide full view', async () => {
    await renderWidget(FULL, makeQuery({ data: [makeAutomation({ id: 1, name: 'Solo' })] }));
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });
});
