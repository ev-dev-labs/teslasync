/**
 * MyActivityPage contract + hardening tests.
 *
 * The page has a single public export (the default `MyActivityPage`). Every
 * derived view (KPI band, daily trend, top-actions / by-category breakdowns,
 * by-hour histogram, chronological feed) is module-private and is exercised
 * here through the mounted page, driving the real `useMyRecentActivity`
 * TanStack Query hook end-to-end against a mocked `request` helper.
 *
 * Coverage:
 *   1.  Loading — panel shells + skeletons render; KPI numbers are withheld.
 *   2.  Loaded — KPI band derives total / active-days / action-types /
 *       entities-touched from the single feed payload.
 *   3.  Loaded — top-actions + by-category breakdowns rank + label correctly
 *       (i18n action labels, humanised categories, the "System / other"
 *       sentinel for null entity_type).
 *   4.  Loaded — the feed lists entries with entity click-through links.
 *   5.  Empty — every section shows its own empty state, KPIs read zero.
 *   6.  503 hard-gate — "Activity feed disabled" notice; sections suppressed.
 *   7.  401 hard-gate — "Identity required" notice; sections suppressed.
 *   8.  Non-gate 500 — each section shows an inline error + Retry; the gate
 *       notice is NOT shown, and Retry re-issues the query.
 *   9.  Default window — the request carries a 30-day ISO range + limit=200.
 *   10. URL-driven range — start/end query params flow verbatim into the
 *       request as snake_case params.
 *   11. RangePicker interaction — opening the popover exposes the accessible
 *       dialog + preset options; picking "All time" refetches with the new
 *       range.
 *
 * Network is mocked at the shared `request` helper so the hook runs for real
 * without touching the wire; i18n is stubbed so `t(key, 'Default')` resolves
 * to the English default.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') return fallbackOrOpts;
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return o.defaultValue;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { request } from '@/api/client';
import { ApiError } from '@/lib/resilience';
import MyActivityPage from './MyActivityPage';
import type { UserActivityEntry } from '@/types/admin';

const mockedRequest = request as unknown as Mock;

/* ------------------------------------------------------------------ */
/*  Mutable per-test fixtures                                          */
/* ------------------------------------------------------------------ */

// Three distinct calendar days spaced far enough apart that they resolve to
// three distinct *local* days in every timezone the runner might use.
const DAY1 = '2025-06-02T12:00:00.000Z';
const DAY2 = '2025-06-05T12:00:00.000Z';
const DAY3 = '2025-06-08T12:00:00.000Z';
const DAY3_LATER = '2025-06-08T15:00:00.000Z';

function entry(over: Partial<UserActivityEntry> & { id: number }): UserActivityEntry {
  return {
    id: over.id,
    ts: over.ts ?? DAY1,
    action: over.action ?? 'auth.login',
    entity_type: over.entity_type ?? null,
    entity_id: over.entity_id ?? null,
    detail: over.detail ?? null,
    ip: over.ip ?? null,
    user_agent: over.user_agent ?? null,
  };
}

function baseEntries(): UserActivityEntry[] {
  return [
    entry({ id: 1, ts: DAY1, action: 'auth.login', entity_type: 'vehicle', entity_id: '10' }),
    entry({ id: 2, ts: DAY1, action: 'auth.login', entity_type: 'vehicle', entity_id: '10' }),
    entry({ id: 3, ts: DAY2, action: 'vehicle.command.wake', entity_type: 'vehicle', entity_id: '11' }),
    entry({ id: 4, ts: DAY2, action: 'settings.update', entity_type: 'settings', entity_id: null }),
    entry({
      id: 5,
      ts: DAY3,
      action: 'data_export.create',
      entity_type: 'data_export',
      entity_id: '55',
      detail: 'drives dataset',
    }),
    entry({ id: 6, ts: DAY3_LATER, action: 'automation.create', entity_type: null }),
  ];
}

interface ReqOpts {
  signal?: unknown;
}

// Per-test knobs. `activityResult` is returned for the activity endpoint;
// `activityError` (when set) is rejected instead. `pending` leaves the
// request unresolved so the loading branch can be asserted.
let activityResult: UserActivityEntry[];
let activityError: unknown;
let pending: boolean;

function activityCalls(): string[] {
  return mockedRequest.mock.calls
    .map((c) => c[0])
    .filter((u): u is string => typeof u === 'string' && u.startsWith('/users/me/activity'));
}

function routeRequest(url: string, _opts?: ReqOpts): Promise<unknown> {
  if (url.startsWith('/users/me/activity')) {
    if (pending) return new Promise<never>(() => {});
    if (activityError) return Promise.reject(activityError);
    return Promise.resolve(activityResult);
  }
  return Promise.resolve(undefined);
}

function renderPage(initialEntry = '/my-activity') {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <MyActivityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Return the KPI card (`div.flex-1`) that owns a given label so the value
 *  paragraph can be asserted without cross-card collisions. */
function kpiCard(label: string): HTMLElement {
  const el = screen.getByText(label).closest('.flex-1');
  if (!el) throw new Error(`no KPI card for "${label}"`);
  return el as HTMLElement;
}

beforeEach(() => {
  activityResult = baseEntries();
  activityError = null;
  pending = false;
  window.localStorage.clear();
  mockedRequest.mockReset();
  mockedRequest.mockImplementation((url: string, opts?: ReqOpts) => routeRequest(url, opts));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MyActivityPage — Project Apex elevation', () => {
  it('renders panel shells + skeletons while the feed query is pending', () => {
    pending = true;
    const { container } = renderPage();

    // The page header + every panel title mount immediately (never gated on
    // data), while the KPI numbers stay hidden behind their skeletons.
    expect(screen.getByText('My Activity')).toBeInTheDocument();
    expect(screen.getByText('Activity over time')).toBeInTheDocument();
    expect(screen.getByText('Activity feed')).toBeInTheDocument();
    expect(screen.queryByText('Total actions')).toBeNull();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('derives the KPI band from the single activity payload', async () => {
    renderPage();

    // Gate on the KPI band leaving its loading skeletons.
    expect(await screen.findByText('Total actions')).toBeInTheDocument();

    expect(within(kpiCard('Total actions')).getByText('6')).toBeInTheDocument();
    expect(within(kpiCard('Active days')).getByText('3')).toBeInTheDocument();
    expect(within(kpiCard('Action types')).getByText('5')).toBeInTheDocument();
    expect(within(kpiCard('Entities touched')).getByText('4')).toBeInTheDocument();
    // Last-active tile renders a value (relative/absolute date) rather than the
    // em-dash placeholder used when there is no activity at all.
    expect(within(kpiCard('Last active')).queryByText('—')).toBeNull();
  });

  it('ranks + labels the top-actions and by-category breakdowns', async () => {
    renderPage();
    await screen.findByText('Total actions');

    expect(screen.getByText('Top actions')).toBeInTheDocument();
    expect(screen.getByText('By category')).toBeInTheDocument();

    // auth.login is the modal action (2 of 6 = 33%); its i18n label resolves
    // to the English fallback under the stubbed translator.
    const topActions = screen.getByText('Top actions').closest('div')?.parentElement as HTMLElement;
    expect(within(topActions).getByText('Signed in')).toBeInTheDocument();
    expect(within(topActions).getByText(/33%/)).toBeInTheDocument();

    // vehicle dominates the category split (3 of 6 = 50%), humanised from the
    // raw entity_type; the null-entity sentinel renders "System / other".
    expect(screen.getByText('Vehicle')).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();
    expect(screen.getByText('System / other')).toBeInTheDocument();
  });

  it('lists feed entries with entity click-through links', async () => {
    renderPage();
    await screen.findByText('Total actions');

    // Both auth.login rows link to /vehicles/10 (entity_type=vehicle).
    const vehicleLinks = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/vehicles/10');
    expect(vehicleLinks).toHaveLength(2);

    // The data-export row surfaces its detail in the subtitle.
    expect(screen.getByText(/drives dataset/)).toBeInTheDocument();
  });

  it('shows per-section empty states and zeroed KPIs when there is no activity', async () => {
    activityResult = [];
    renderPage();

    expect(await screen.findByText('No activity recorded in this window.')).toBeInTheDocument();
    expect(screen.getByText('No actions in this window.')).toBeInTheDocument();
    expect(screen.getByText('No categories to break down yet.')).toBeInTheDocument();
    expect(screen.getByText('No activity to chart by hour yet.')).toBeInTheDocument();
    expect(screen.getByText('No recent activity in this window.')).toBeInTheDocument();

    // KPI band still renders (not a skeleton) with an explicit zero total.
    expect(within(kpiCard('Total actions')).getByText('0')).toBeInTheDocument();
    expect(within(kpiCard('Last active')).getByText('—')).toBeInTheDocument();
  });

  it('surfaces the feature-disabled notice on a 503 and suppresses the sections', async () => {
    activityError = new ApiError('forward auth not configured', 503, 'AUTH_MODE_OPEN');
    renderPage();

    expect(await screen.findByText('Activity feed disabled')).toBeInTheDocument();
    expect(screen.getByText(/ForwardAuth/)).toBeInTheDocument();

    // Hard gate replaces the whole bento — no panels, no KPI band.
    expect(screen.queryByText('Activity feed')).toBeNull();
    expect(screen.queryByText('Activity over time')).toBeNull();
    expect(screen.queryByText('Total actions')).toBeNull();
    // ...and it is NOT mistaken for the 401 branch.
    expect(screen.queryByText('Identity required')).toBeNull();
  });

  it('surfaces the identity-required notice on a 401 and suppresses the sections', async () => {
    activityError = new ApiError('no identity header', 401);
    renderPage();

    expect(await screen.findByText('Identity required')).toBeInTheDocument();
    expect(screen.getByText(/identity header/)).toBeInTheDocument();

    expect(screen.queryByText('Activity feed')).toBeNull();
    expect(screen.queryByText('Activity feed disabled')).toBeNull();
  });

  it('renders inline section errors (not the gate) on a non-gate 500 and retries on demand', async () => {
    activityError = new ApiError('boom: internal', 500);
    renderPage();

    // Wait for the inline 5xx error state to resolve inside the sections
    // (panel titles alone render during loading, so gate on the error copy).
    const serverErrors = await screen.findAllByText('Server error');
    expect(serverErrors.length).toBeGreaterThan(0);

    // Sections remain mounted around the errors.
    expect(screen.getByText('Activity feed')).toBeInTheDocument();
    expect(screen.getByText('Activity over time')).toBeInTheDocument();

    // The hard-gate notices are NOT shown for a plain server error.
    expect(screen.queryByText('Activity feed disabled')).toBeNull();
    expect(screen.queryByText('Identity required')).toBeNull();

    const before = activityCalls().length;
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    await waitFor(() => {
      expect(activityCalls().length).toBeGreaterThan(before);
    });
  });

  it('requests a default 30-day ISO window with limit=200', async () => {
    renderPage();

    await waitFor(() => {
      expect(activityCalls().length).toBeGreaterThan(0);
    });
    expect(activityCalls()[0]).toMatch(
      /^\/users\/me\/activity\?start=\d{4}-\d{2}-\d{2}&end=\d{4}-\d{2}-\d{2}&limit=200$/,
    );
  });

  it('forwards start/end URL params verbatim as snake_case query params', async () => {
    renderPage('/my-activity?start=2024-01-01&end=2024-02-01');

    await waitFor(() => {
      expect(activityCalls().length).toBeGreaterThan(0);
    });
    expect(activityCalls()[0]).toBe(
      '/users/me/activity?start=2024-01-01&end=2024-02-01&limit=200',
    );
  });

  it('refetches with a new range when a RangePicker preset is applied', async () => {
    activityResult = [];
    renderPage();

    await waitFor(() => {
      expect(activityCalls().length).toBeGreaterThan(0);
    });

    // The range trigger is an accessible, labelled control.
    const trigger = screen.getByTestId('my-activity-range');
    expect(trigger).toHaveAttribute('aria-label', 'Date range');

    fireEvent.click(trigger);

    // Opening exposes the accessible popover dialog + selectable presets.
    expect(screen.getByRole('dialog', { name: 'Date range picker' })).toBeInTheDocument();
    const allTime = screen.getByRole('option', { name: 'All time' });
    fireEvent.click(allTime);

    // "All time" pins the start to the 2015 baseline → a fresh request fires.
    await waitFor(() => {
      expect(activityCalls().some((u) => u.includes('start=2015-01-01'))).toBe(true);
    });
  });
});
