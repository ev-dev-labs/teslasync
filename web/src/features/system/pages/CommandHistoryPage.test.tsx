/**
 * CommandHistoryPage — behaviour + branch coverage.
 *
 * This page is the command-center audit log for a single vehicle. Its own
 * responsibilities (what these tests exercise) are:
 *
 *   1. A `useCommandHistory(vehicleId)` feed keyed on the derived active
 *      vehicle (URL `?vehicle_id` > store > first fleet vehicle).
 *   2. A KPI band derived from the FULL history (total, 24h, success rate,
 *      failed, most-used, last-sent) — never scoped by the filter bar.
 *   3. Per-section loading / error / empty branches for EVERY panel (KPI,
 *      daily-activity chart, top commands, timeline, status breakdown) — no
 *      panel is gated away when data is missing.
 *   4. Filter wiring: status tabs + live search narrow ONLY the timeline
 *      (count, pagination), while the range scopes the analytics.
 *   5. Command-name i18n resolution (curated map + Title-Case fallback) and
 *      the timeline subtitle builder (JSON params, error prefix, raw-on-parse
 *      -failure).
 *   6. Pagination + the page-clamp that keeps the timeline from rendering
 *      blank when a filter shrinks the result set or the URL `?page=` is out
 *      of range — this is where the real bugs lived (see the "regressions"
 *      block).
 *
 * Strategy mirrors the sibling PeriodComparePage suite: render the REAL page +
 * REAL shared subtree (PageContainer, MetricCard, Timeline, TabNav, Pagination,
 * QueryError, charts). Only the network `request` helper and react-i18next are
 * mocked. `useVehicles` runs for real (driven by the mocked `request`) so the
 * active-vehicle derivation and its enabled/disabled query gate are genuinely
 * exercised. Interactions use `fireEvent` — the repo's established convention
 * (no @testing-library/user-event dependency is present).
 *
 * Note on scoping: command names appear in BOTH the "Top Commands" breakdown
 * and the timeline, so every timeline-content assertion is scoped to the
 * timeline GlassPanel via `timelinePanel()`. Panel headings render before the
 * feed resolves, so "data loaded" is signalled by the timeline's count badge
 * (`waitForCount`), never a heading.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (reached via <FadeIn> + PageContainer's
// freshness chip) reads it at module load. Install before any import evaluates.
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

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));

// Only `request` is replaced; the real `isApiError` / `ApiError` exports stay so
// <QueryError> classifies the injected ApiError(500) into its "Server error" branch.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: mockRequest };
});

// i18n → return the developer fallback, interpolating {{vars}} so assertions can
// read real sentences instead of raw keys.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import CommandHistoryPage from './CommandHistoryPage';
import type { CommandLogEntry } from '@/api/hooks/useCommands';
import { SelectedVehicleProvider } from '@/store/selectedVehicle';
import { ApiError } from '@/lib/resilience';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = Date.now();
const RECENT = new Date(NOW - 60_000).toISOString(); // 1 min ago — inside the 24h window
const OLD = new Date(NOW - 3 * 24 * 60 * 60_000).toISOString(); // 3 days ago — outside 24h

const VEHICLES = [
  { id: 10, vehicle_id: 10, vin: 'VIN0000010', display_name: 'Model 3', state: 'online' },
  { id: 20, vehicle_id: 20, vin: 'VIN0000020', display_name: 'Model Y', state: 'asleep' },
];

let idSeq = 1;
function mkCmd(over: Partial<CommandLogEntry> = {}): CommandLogEntry {
  return {
    id: idSeq++,
    vehicle_id: 10,
    command: 'lock',
    params: '',
    status: 'success',
    error: '',
    created_at: RECENT,
    ...over,
  };
}

// 5 commands, newest-first (as the API returns them). Deterministic KPIs:
//   total 5 · 24h 3 · success 3 (60%) · failed 2 · most-used "lock".
function richCommands(): CommandLogEntry[] {
  return [
    mkCmd({ command: 'lock', status: 'success', created_at: RECENT, params: '{"foo":"bar"}' }),
    mkCmd({ command: 'lock', status: 'success', created_at: RECENT }),
    mkCmd({ command: 'lock', status: 'failed', created_at: RECENT, error: 'Vehicle offline' }),
    mkCmd({ command: 'wake_up', status: 'success', created_at: OLD }),
    mkCmd({ command: 'honk_horn', status: 'failed', created_at: OLD }),
  ];
}

function manyCommands(n: number, over: Partial<CommandLogEntry> = {}): CommandLogEntry[] {
  return Array.from({ length: n }, () =>
    mkCmd({ command: 'lock', status: 'success', created_at: RECENT, ...over }),
  );
}

// 30 commands — 28 honk_horn + 2 wake_up — so a "wake" search narrows 30 → 2.
function raceCommands(): CommandLogEntry[] {
  const arr = manyCommands(28, { command: 'honk_horn' });
  arr.push(mkCmd({ command: 'wake_up', created_at: RECENT }));
  arr.push(mkCmd({ command: 'wake_up', created_at: RECENT }));
  return arr;
}

type Mode = 'resolve' | 'pending' | 'reject';

interface InstallOpts {
  vehicles?: unknown[];
  commands?: CommandLogEntry[];
  commandsMode?: Mode;
  commandsError?: unknown;
}

function installRequest({
  vehicles = VEHICLES,
  commands = [],
  commandsMode = 'resolve',
  commandsError,
}: InstallOpts = {}) {
  mockRequest.mockImplementation((url: unknown) => {
    const u = String(url);
    // Order matters: the history path also contains "/vehicles".
    if (u.includes('/commands/history')) {
      if (commandsMode === 'pending') return new Promise(() => {});
      if (commandsMode === 'reject') return Promise.reject(commandsError ?? new Error('boom'));
      return Promise.resolve(commands);
    }
    if (u.includes('/vehicles')) return Promise.resolve(vehicles);
    return Promise.resolve({});
  });
}

function historyCalls(): string[] {
  return mockRequest.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes('/commands/history'));
}

function renderPage(initialEntries: string[] = ['/command-history']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <SelectedVehicleProvider>
          <CommandHistoryPage />
        </SelectedVehicleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The KPI band is the only `<section aria-label>` → exposed as role "region". */
function kpiBand() {
  return screen.getByRole('region', { name: 'Command metrics' });
}

/** The GlassPanel (`[data-print-card]`) that owns the command timeline. */
function timelinePanel(): HTMLElement {
  return screen
    .getByRole('heading', { name: 'Command Timeline' })
    .closest('[data-print-card]') as HTMLElement;
}

/** The GlassPanel that owns the status breakdown bars. */
function statusPanel(): HTMLElement {
  return screen
    .getByRole('heading', { name: 'Status Breakdown' })
    .closest('[data-print-card]') as HTMLElement;
}

/** Resolve once the timeline's count badge shows the expected total — the
 *  canonical "data has loaded" signal (headings render before the feed does). */
async function waitForCount(n: number) {
  await screen.findByText(`${n} commands`);
}

beforeEach(() => {
  mockRequest.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── 1. Happy path — shell, KPI band, analytics, timeline ─────────────────────

describe('CommandHistoryPage — happy path', () => {
  it('renders the page shell and fetches history for the derived active vehicle (snake_case, no /api/v1)', async () => {
    installRequest({ commands: richCommands() });
    renderPage();

    await waitForCount(5); // feed resolved for the derived active vehicle

    expect(screen.getByRole('heading', { level: 1, name: 'Command History' })).toBeInTheDocument();
    expect(screen.getByText('Audit log of all vehicle commands')).toBeInTheDocument();

    expect(historyCalls().some((u) => /\/vehicles\/10\/commands\/history/.test(u))).toBe(true);
    expect(historyCalls().every((u) => !u.includes('/api/v1'))).toBe(true);
    expect(historyCalls().some((u) => /limit=200/.test(u))).toBe(true);
  });

  it('derives every KPI from the full history (total, 24h, success-rate, failed, most-used)', async () => {
    installRequest({ commands: richCommands() });
    renderPage();

    await waitForCount(5);

    const band = kpiBand();
    for (const label of [
      'Total Commands',
      'Commands (24h)',
      'Success Rate',
      'Failed',
      'Most Used',
      'Last Sent',
    ]) {
      expect(within(band).getByText(label)).toBeInTheDocument();
    }
    expect(within(band).getByText('5')).toBeInTheDocument(); // total
    expect(within(band).getByText('3')).toBeInTheDocument(); // 24h
    expect(within(band).getByText('60%')).toBeInTheDocument(); // success rate
    expect(within(band).getByText('2')).toBeInTheDocument(); // failed
    expect(within(band).getByText('Lock')).toBeInTheDocument(); // most-used, i18n-resolved
  });

  it('renders all four analytics/detail panels with data (never their empty states)', async () => {
    installRequest({ commands: richCommands() });
    renderPage();

    await waitForCount(5);

    expect(screen.getAllByRole('heading', { level: 3, name: 'Daily Activity' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 3, name: 'Top Commands' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Status Breakdown' })).toBeInTheDocument();

    // Status breakdown percentages exercise pctLabel(n, total): 3/5 and 2/5.
    // Regex avoids depending on the middle-dot glyph in "3 · 60%".
    expect(within(statusPanel()).getByText(/60%/)).toBeInTheDocument();
    expect(within(statusPanel()).getByText(/40%/)).toBeInTheDocument();

    // Analytics rendered data, not the "no commands in range" placeholder.
    expect(screen.queryByText('No commands in the selected range')).not.toBeInTheDocument();
  });

  it('lists commands in the timeline with i18n names, subtitles and a live count badge', async () => {
    installRequest({ commands: richCommands() });
    renderPage();

    await waitForCount(5);

    const tl = timelinePanel();
    expect(within(tl).getByText('Wake Up')).toBeInTheDocument();
    expect(within(tl).getByText('Honk Horn')).toBeInTheDocument();
    // Subtitles are timeline-only: JSON params and the error prefix.
    expect(within(tl).getByText(/foo: bar/)).toBeInTheDocument();
    expect(within(tl).getByText(/Error: Vehicle offline/)).toBeInTheDocument();
    // Count badge reflects the full (unfiltered) set.
    expect(within(tl).getByText('5 commands')).toBeInTheDocument();
  });
});

// ─── 2. Loading / error / empty branches ──────────────────────────────────────

describe('CommandHistoryPage — loading / error / empty branches', () => {
  it('shows skeleton placeholders (never a blank panel) while the feed is in flight', async () => {
    installRequest({ commandsMode: 'pending' });
    const { container } = renderPage();

    await waitFor(() =>
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0),
    );
    // Panels stay mounted; the KPI band is present even while the feed loads.
    expect(screen.getAllByRole('heading', { level: 3, name: 'Daily Activity' }).length).toBeGreaterThan(0);
    expect(kpiBand()).toBeInTheDocument();
    // No analytics empty copy while genuinely loading.
    expect(screen.queryByText('No commands in the selected range')).not.toBeInTheDocument();
  });

  it('renders per-section error states with a working Retry that refetches', async () => {
    installRequest({ commandsMode: 'reject', commandsError: new ApiError('kaboom', 500) });
    renderPage();

    // Every data panel surfaces the error rather than blanking.
    await waitFor(() => expect(screen.getAllByText('Server error').length).toBeGreaterThanOrEqual(3));

    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBeGreaterThan(0);

    const before = historyCalls().length;
    fireEvent.click(retries[0]);
    await waitFor(() => expect(historyCalls().length).toBeGreaterThan(before));
  });

  it('shows dedicated empty copy for the timeline and the analytics when there are no commands', async () => {
    installRequest({ commands: [] });
    renderPage();

    // 3 analytics panels share one copy; the timeline owns its own.
    await waitFor(() =>
      expect(screen.getAllByText('No commands in the selected range').length).toBe(3),
    );
    expect(screen.getByText('No commands have been sent yet')).toBeInTheDocument();
    // KPI band still renders zeros — not hidden.
    expect(within(kpiBand()).getAllByText('0').length).toBeGreaterThan(0);
  });

  it('prompts to select a vehicle (and fires no history request) when the fleet is empty', async () => {
    installRequest({ vehicles: [], commands: richCommands() });
    renderPage();

    await waitFor(() =>
      expect(screen.getAllByText('Select a vehicle to view command activity').length).toBe(3),
    );
    expect(screen.getByText('Select a vehicle to view command history')).toBeInTheDocument();
    // The command feed is gated off — enabled:!!vehicleId — so it never fires.
    expect(historyCalls().length).toBe(0);
  });
});

// ─── 3. Filters, interactions & a11y ──────────────────────────────────────────

describe('CommandHistoryPage — filters & interactions', () => {
  it('filters the timeline to failures when the Failed status tab is chosen', async () => {
    installRequest({ commands: richCommands() });
    renderPage();

    await waitForCount(5);

    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));

    // 2 of 5 commands failed → timeline narrows; the success-only "Wake Up" leaves.
    await screen.findByText('2 commands');
    const tl = timelinePanel();
    expect(within(tl).getByText('Honk Horn')).toBeInTheDocument();
    expect(within(tl).queryByText('Wake Up')).not.toBeInTheDocument();
    // KPI band is unaffected by the timeline filter (still full history).
    expect(within(kpiBand()).getByText('5')).toBeInTheDocument();
  });

  it('filters the timeline by the live search box (label + placeholder are accessible)', async () => {
    installRequest({ commands: richCommands() });
    renderPage();

    await waitForCount(5);

    const search = screen.getByRole('textbox', { name: 'Search commands' });
    expect(search).toHaveAttribute('placeholder', 'Search commands…');

    fireEvent.change(search, { target: { value: 'wake' } });

    await screen.findByText('1 commands');
    const tl = timelinePanel();
    expect(within(tl).getByText('Wake Up')).toBeInTheDocument();
    expect(within(tl).queryByText('Honk Horn')).not.toBeInTheDocument();
  });

  it('switches the active-vehicle feed when a different vehicle is selected', async () => {
    installRequest({ commands: richCommands() });
    renderPage();

    await waitForCount(5);

    const select = screen.getByRole('combobox', { name: 'Select vehicle' });
    fireEvent.change(select, { target: { value: '20' } });

    await waitFor(() =>
      expect(historyCalls().some((u) => /\/vehicles\/20\/commands\/history/.test(u))).toBe(true),
    );
  });
});

// ─── 4. Pagination + page clamp ───────────────────────────────────────────────

describe('CommandHistoryPage — pagination & page clamp', () => {
  it('paginates a large history and advances to the next page', async () => {
    installRequest({ commands: manyCommands(30) });
    renderPage();

    // 30 > PAGE_SIZE (25) → pager shown on page 1.
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
    expect(screen.getByText(/Showing 1.25 of 30/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument());
    expect(screen.getByText(/Showing 26.30 of 30/)).toBeInTheDocument();
  });

  it('clamps an out-of-range URL ?page= down to the last page (never a blank timeline)', async () => {
    installRequest({ commands: manyCommands(30) });
    renderPage(['/command-history?page=5']); // only 2 pages exist

    await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument());
    expect(screen.getByText(/Showing 26.30 of 30/)).toBeInTheDocument();
    // The timeline shows the clamped page's rows rather than an empty window.
    expect(within(timelinePanel()).queryByText('No commands have been sent yet')).not.toBeInTheDocument();
  });

  it('clamps a zero/negative URL ?page= up to the first page', async () => {
    installRequest({ commands: manyCommands(30) });
    renderPage(['/command-history?page=-3']);

    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
    expect(screen.getByText(/Showing 1.25 of 30/)).toBeInTheDocument();
  });
});

// ─── 5. Bug regressions: URL-write races ──────────────────────────────────────

describe('CommandHistoryPage — URL-write race regressions', () => {
  it('applies a search typed while on page ≥ 2 without dropping the character (atomic batch)', async () => {
    // Regression guard: the old handler fired setSearchQuery() AND setPage(1) as
    // two single-key URL writes in one tick. Under react-router v6 the second
    // discards the first, so the typed text vanished whenever the user searched
    // from a later page. useUrlBatch now lands both keys in one navigation.
    installRequest({ commands: raceCommands() });
    renderPage();

    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument());

    const search = screen.getByRole('textbox', { name: 'Search commands' });
    fireEvent.change(search, { target: { value: 'wake' } });

    // The character survives (input reflects it) AND the search actually applies.
    await waitFor(() => expect(search).toHaveValue('wake'));
    await screen.findByText('2 commands');
    const tl = timelinePanel();
    expect(within(tl).getAllByText('Wake Up')).toHaveLength(2);
    expect(within(tl).queryByText('Honk Horn')).not.toBeInTheDocument();
  });

  it('resets pagination to page 1 when the status filter changes (atomic status+page write)', async () => {
    // Mixed statuses so switching to "failed" leaves a small (<= 1 page) set.
    const cmds = [
      ...manyCommands(26, { command: 'lock', status: 'success' }),
      ...manyCommands(4, { command: 'honk_horn', status: 'failed' }),
    ];
    installRequest({ commands: cmds });
    renderPage();

    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument());

    // Switch to "failed" (4 items → single page). Page resets; timeline is not blank.
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));

    await screen.findByText('4 commands');
    expect(within(timelinePanel()).getAllByText('Honk Horn')).toHaveLength(4);
    // <= PAGE_SIZE now, so the pager is gone entirely (not stuck on a blank page 2).
    expect(screen.queryByText('2 / 2')).not.toBeInTheDocument();
  });
});

// ─── 6. Command-name + subtitle formatting ────────────────────────────────────

describe('CommandHistoryPage — command name & subtitle formatting', () => {
  it('resolves curated names, Title-Cases unknowns, and builds subtitles from params/error/parse-failures', async () => {
    const cmds = [
      mkCmd({ command: 'super_secret_mode', status: 'success', created_at: RECENT }),
      mkCmd({ command: 'set_charge_limit', status: 'success', created_at: RECENT, params: '{"percent":80}' }),
      mkCmd({ command: 'lock', status: 'failed', created_at: RECENT, error: 'Timeout' }),
      mkCmd({ command: 'unlock', status: 'success', created_at: RECENT, params: '{bad json' }),
    ];
    installRequest({ commands: cmds });
    renderPage();

    await waitForCount(4);

    const tl = timelinePanel();
    // Curated label from COMMAND_LABELS.
    expect(within(tl).getByText('Set Charge Limit')).toBeInTheDocument();
    // Fallback Title-Case for an unmapped command.
    expect(within(tl).getByText('Super Secret Mode')).toBeInTheDocument();
    // Subtitle from JSON params.
    expect(within(tl).getByText(/percent: 80/)).toBeInTheDocument();
    // Subtitle from the error field.
    expect(within(tl).getByText(/Error: Timeout/)).toBeInTheDocument();
    // Subtitle falls back to the raw string when params aren't valid JSON.
    expect(within(tl).getByText(/\{bad json/)).toBeInTheDocument();
  });
});
