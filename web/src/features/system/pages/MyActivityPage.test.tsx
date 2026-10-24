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
 *   6.  503 hard-gate — unsupported-deployment notice; sections suppressed.
 *   7.  401 hard-gate — sign-in-required notice; sections suppressed.
 *   8.  Non-gate 500 — each section shows an inline error + Retry; the gate
 *       notice is NOT shown, and Retry re-issues the query.
 *   9.  Default window — the request carries precise range instants + limit=200.
 *   10. URL-driven range — legacy start/end bookmarks migrate to the shared
 *       range without changing saved preferences.
 *   11. Header range interaction — changing the shared URL window refetches
 *       without a redundant page-level picker.
 *
 * Network is mocked at the shared `request` helper so the hook runs for real
 * without touching the wire; i18n is stubbed so `t(key, 'Default')` resolves
 * to the English default.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SHARED_RANGE_STORAGE_KEY, useRangeState } from '@/hooks/useRangeState';
import { Button } from '@/components/ui';
import type { ReactNode } from 'react';
import englishCatalog from '@/i18n/en.json';
import activityCatalog from '@/i18n/en/locale-detail-activity.json';
import systemCatalog from '@/i18n/en/locale-system.json';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const interpolate = (base: string, opts?: Record<string, unknown>) => {
          if (!opts) return base;
          let s = base;
          for (const [k, v] of Object.entries(opts)) {
            if (k === 'defaultValue') continue;
            s = s.split(`{{${k}}}`).join(String(v));
          }
          return s;
        };
        if (typeof fallbackOrOpts === 'string') {
          return interpolate(fallbackOrOpts, maybeOpts as Record<string, unknown> | undefined);
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return interpolate(o.defaultValue, o);
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
import { assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import MyActivityPage from './MyActivityPage';
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings: { locale: 'en-US', decimal_precision: 2, currency_symbol: '$' }, settingsUnavailable: false }),
}));
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

function HeaderRangeControl() {
  const { setRange, setPreset } = useRangeState();
  const location = useLocation();
  return <>
    <Button type="button" data-testid="header-activity-range" onClick={() =>
      setRange({ start: '2015-01-01', end: '2026-09-25' }, 'custom')
    }>Change header range</Button>
    <Button type="button" onClick={() => setPreset('24h')}>Last 24 hours</Button>
    <output data-testid="activity-url">{location.search}</output>
  </>;
}

function renderPage(initialEntry = '/me/activity', enabled = true) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, enabled },
      mutations: { retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <MyActivityPage />
        <HeaderRangeControl />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, queryClient: qc };
}

/** Return the KPI card (`div.flex-1`) that owns a given label so the value
 *  paragraph can be asserted without cross-card collisions. */
function kpiCard(label: string): HTMLElement {
  const el = screen.getByText(label).closest('[data-operational-metric]');
  if (!el) throw new Error(`no KPI card for "${label}"`);
  return el as HTMLElement;
}

beforeEach(() => {
  onlineManager.setOnline(true);
  activityResult = baseEntries();
  activityError = null;
  pending = false;
  window.localStorage.clear();
  mockedRequest.mockReset();
  mockedRequest.mockImplementation((url: string, opts?: ReqOpts) => routeRequest(url, opts));
});

afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

describe('MyActivityPage — Project Apex elevation', () => {
  it.each(['paused', 'idle'] as const)('keeps initial %s activity unknown with every shell and recovers', async (fetchStatus) => {
    if (fetchStatus === 'paused') onlineManager.setOnline(false);
    renderPage('/me/activity', fetchStatus !== 'idle');

    expect(screen.getByText(fetchStatus === 'paused' ? 'Refresh paused' : 'Pending')).toBeInTheDocument();
    expect(screen.getByText('No requested source has returned usable data yet.')).toBeInTheDocument();
    for (const title of ['Activity over time', 'Top actions', 'By category', 'By hour of day', 'Activity feed']) {
      const panel = screen.getByRole('heading', { name: title }).closest('[data-print-card]');
      expect(panel).not.toBeNull();
      expect(within(panel as HTMLElement).getByText('Unknown')).toBeInTheDocument();
      expect(panel!.querySelector('[aria-busy="true"]')).toBeNull();
    }
    const summary = screen.getByRole('region', { name: 'Activity summary' });
    expect(summary).not.toHaveAttribute('aria-busy', 'true');
    // Unknown metrics are omitted from the face; the drawer counts all five.
    expect(summary.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expect(within(summary).getByText('No metric values are available yet.')).toBeInTheDocument();
    for (const label of ['Total actions', 'Active days', 'Action types', 'Entities touched', 'Last active']) {
      assertOperationalMetricUnavailable(summary, label);
      expect(within(summary).queryByText('0')).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/no (recent )?activity|no actions|no categories/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/offline|service unavailable|server error/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading activity feed' })).not.toBeInTheDocument();
    expect(activityCalls()).toHaveLength(0);

    if (fetchStatus === 'paused') {
      act(() => onlineManager.setOnline(true));
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    }
    // Metrics mount on the face only once measured values resolve.
    expect(await within(summary).findByText('6')).toBeInTheDocument();
    expect(within(kpiCard('Total actions')).getByText('6')).toBeInTheDocument();
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  });

  it('renders panel shells + skeletons while the feed query is pending', () => {
    pending = true;
    renderPage();

    // The page header + every panel title mount immediately (never gated on
    // data), while the KPI numbers stay hidden behind their skeletons.
    expect(screen.getByText('My activity')).toBeInTheDocument();
    expect(screen.getAllByText('Activity over time').length).toBeGreaterThan(0);
    expect(screen.getByText('Activity feed')).toBeInTheDocument();
    expect(screen.getByText('Total actions')).toBeInTheDocument();
    expect(kpiCard('Total actions').querySelector('[data-operational-value]')).toBeNull();
    const summary = screen.getByRole('region', { name: 'Activity summary' });
    expect(summary).toHaveAttribute('aria-busy', 'true');
    const metrics = summary.querySelectorAll('[aria-hidden="true"][class~="bg-[var(--surface-3)]"][class~="h-5"][class~="w-20"]');
    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics).toHaveLength(5);
    expect(summary.querySelector('[data-operational-value]')).toBeNull();
    for (const title of ['Top actions', 'By category']) {
      const panel = screen.getByRole('heading', { name: title }).closest('[data-print-card]');
      expect(panel).not.toBeNull();
      const pending = panel!.querySelector('[aria-busy="true"]');
      expect(pending).not.toBeNull();
      expect(within(pending as HTMLElement).getByRole('status')).toHaveTextContent(/loading/i);
      const lines = pending!.querySelectorAll('[aria-hidden="true"][class~="bg-[var(--skeleton-bg)]"]');
      expect(lines).toHaveLength(5);
      lines.forEach(line => expect(line).toHaveStyle({ height: '28px' }));
      expect(panel!.querySelector('[data-testid="activity-breakdown-list"]')).toBeNull();
    }
    const feed = screen.getByRole('status', { name: 'Loading activity feed' });
    expect(feed).toHaveAttribute('aria-busy', 'true');
    const feedLines = feed.querySelectorAll('[aria-hidden="true"][class~="bg-[var(--skeleton-bg)]"]');
    expect(feedLines).toHaveLength(6);
    feedLines.forEach(line => expect(line).toHaveStyle({ height: '40px' }));
    for (const title of ['Activity over time', 'By hour of day']) {
      const chart = screen.getByRole('figure', { name: title });
      expect(within(chart).getByRole('heading', { name: title })).toBeInTheDocument();
      expect(chart).toHaveAttribute('data-chart-state', 'loading');
      expect(chart).toHaveAttribute('aria-busy', 'true');
      const placeholder = within(chart).getByRole('status', { name: 'Loading chart…' });
      expect(placeholder.querySelectorAll('[aria-hidden="true"][class~="bg-white/[0.04]"]')).toHaveLength(7);
      expect(within(chart).queryByRole('img')).not.toBeInTheDocument();
    }
  });

  it('derives the KPI band from the single activity payload', async () => {
    renderPage();

    // Labels persist during loading; await the resolved value in its own card.
    expect(await screen.findByText('Total actions')).toBeInTheDocument();

    expect(await within(kpiCard('Total actions')).findByText('6')).toBeInTheDocument();
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
    expect(await within(topActions).findByText('Signed in')).toBeInTheDocument();
    expect(within(topActions).getByText(/33%/)).toBeInTheDocument();

    // vehicle dominates the category split (3 of 6 = 50%), humanised from the
    // raw entity_type; the null-entity sentinel renders "System / other".
    expect(screen.getByText('Vehicle')).toBeInTheDocument();
    expect(screen.getByText(/50\.00%/)).toBeInTheDocument();
    expect(screen.getByText('System / other')).toBeInTheDocument();
  });

  it('lists feed entries with entity click-through links', async () => {
    renderPage();
    await screen.findByText('Total actions');

    // Both auth.login rows link to /vehicles/10 (entity_type=vehicle).
    const feed = screen.getByRole('heading', { name: 'Activity feed' }).closest('[data-print-card]');
    expect(feed).not.toBeNull();
    const vehicleLinks = (await within(feed as HTMLElement).findAllByRole('link'))
      .filter((a) => a.getAttribute('href') === '/vehicles/10');
    expect(vehicleLinks).toHaveLength(2);

    // The data-export row surfaces its detail in the subtitle.
    expect(within(feed as HTMLElement).getByText(/drives dataset/)).toBeInTheDocument();
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
    // With no activity, Last active is unknown — omitted from the face and
    // counted in the drawer rather than fabricated.
    assertOperationalMetricUnavailable(
      screen.getByRole('region', { name: 'Activity summary' }),
      'Last active',
    );
  });

  it('surfaces the feature-disabled notice on a 503 and suppresses the sections', async () => {
    activityError = new ApiError('forward auth not configured', 503, 'AUTH_MODE_OPEN');
    renderPage();

    expect(await screen.findByText('Activity feed is not supported')).toBeInTheDocument();
    const description = 'Per-user activity is only available when TeslaSync is deployed behind an identity provider (ForwardAuth). Ask your administrator to configure FORWARD_AUTH_HEADER.';
    expect(screen.getByText(description)).toBeInTheDocument();
    expect(englishCatalog.activity.myActivity.disabled.description).toBe(description);
    expect(activityCatalog.activity.myActivity.disabled.description).toBe(description);
    expect(systemCatalog.activity.myActivity.disabled.description).toBe(description);
    expect(screen.queryByText(/AUTH_FORWARD_HEADER/)).not.toBeInTheDocument();

    // Hard gate replaces the whole bento — no panels, no KPI band.
    expect(screen.queryByText('Activity feed')).toBeNull();
    expect(screen.queryByText('Activity over time')).toBeNull();
    expect(screen.queryByText('Total actions')).toBeNull();
    // ...and it is NOT mistaken for the 401 branch.
    expect(screen.queryByText('Sign in required')).toBeNull();
  });

  it('surfaces the identity-required notice on a 401 and suppresses the sections', async () => {
    activityError = new ApiError('no identity header', 401);
    renderPage();

    expect(await screen.findByText('Sign in required')).toBeInTheDocument();
    expect(screen.getByText(/session has expired/i)).toBeInTheDocument();

    expect(screen.queryByText('Activity feed')).toBeNull();
    expect(screen.queryByText('Activity feed is not supported')).toBeNull();
  });

  it('keeps sections visible and reports permission denial on a 403', async () => {
    activityError = new ApiError('activity scope denied', 403);
    renderPage();

    expect((await screen.findAllByText('Permission denied')).length).toBeGreaterThan(0);
    expect(screen.getByText('Activity feed')).toBeInTheDocument();
    expect(screen.getAllByText('Activity over time').length).toBeGreaterThan(0);
    expect(screen.queryByText('Sign in required')).toBeNull();
    expect(screen.queryByText('Activity feed is not supported')).toBeNull();
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
    expect(screen.getAllByText('Activity over time').length).toBeGreaterThan(0);

    // The hard-gate notices are NOT shown for a plain server error.
    expect(screen.queryByText('Activity feed is not supported')).toBeNull();
    expect(screen.queryByText('Sign in required')).toBeNull();

    const before = activityCalls().length;
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    await waitFor(() => {
      expect(activityCalls().length).toBeGreaterThan(before);
    });
  });

  it('requests precise default range instants with limit=200', async () => {
    renderPage();

    await waitFor(() => {
      expect(activityCalls().length).toBeGreaterThan(0);
    });
    const params = new URL(activityCalls()[0], 'http://localhost').searchParams;
    expect(params.get('start')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(params.get('end')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Date.parse(params.get('end')!)).toBeGreaterThan(Date.parse(params.get('start')!));
    expect(params.get('limit')).toBe('200');
  });

  it('migrates legacy bookmarks to the shared calendar range and exclusive end without overwriting preferences', async () => {
    const saved = JSON.stringify({ version: 2, start: '2025-06-01', end: '2025-06-08' });
    window.localStorage.setItem(SHARED_RANGE_STORAGE_KEY, saved);
    renderPage('/me/activity?start=2024-01-01&end=2024-02-01&filter=auth');

    await waitFor(() => {
      expect(activityCalls().length).toBeGreaterThan(0);
    });
    const params = new URL(activityCalls()[0], 'http://localhost').searchParams;
    expect(params.get('start')).toBe(new Date('2024-01-01T00:00:00Z').toISOString());
    expect(params.get('end')).toBe(new Date('2024-02-02T00:00:00Z').toISOString());
    const url = new URLSearchParams(screen.getByTestId('activity-url').textContent!);
    expect(url.get('from')).toBe('2024-01-01');
    expect(url.get('to')).toBe('2024-02-01');
    expect(url.get('filter')).toBe('auth');
    expect(url.has('start')).toBe(false);
    expect(url.has('end')).toBe(false);
    expect(window.localStorage.getItem(SHARED_RANGE_STORAGE_KEY)).toBe(saved);
  });

  it('prefers canonical header bounds over conflicting legacy bounds', async () => {
    renderPage('/me/activity?from=2025-06-01&to=2025-06-08&start=2024-01-01&end=2024-02-01');
    await waitFor(() => expect(activityCalls().length).toBeGreaterThan(0));
    const params = new URL(activityCalls()[0], 'http://localhost').searchParams;
    expect(params.get('start')).toBe(new Date('2025-06-01T00:00:00Z').toISOString());
    expect(params.get('end')).toBe(new Date('2025-06-09T00:00:00Z').toISOString());
  });

  it('restores the saved shared range instead of an obsolete page preference', async () => {
    const saved = JSON.stringify({ version: 2, start: '2025-06-01', end: '2025-06-08' });
    const pageSaved = JSON.stringify({ version: 2, start: '2024-01-01', end: '2024-02-01' });
    window.localStorage.setItem(SHARED_RANGE_STORAGE_KEY, saved);
    window.localStorage.setItem('my-activity.range', pageSaved);
    renderPage();
    await waitFor(() => expect(activityCalls().length).toBeGreaterThan(0));
    const params = new URL(activityCalls()[0], 'http://localhost').searchParams;
    expect(params.get('start')).toBe(new Date('2025-06-01T00:00:00Z').toISOString());
    expect(params.get('end')).toBe(new Date('2025-06-09T00:00:00Z').toISOString());
    expect(window.localStorage.getItem(SHARED_RANGE_STORAGE_KEY)).toBe(saved);
    expect(window.localStorage.getItem('my-activity.range')).toBe(pageSaved);
    expect(await within(kpiCard('Total actions')).findByText('6')).toBeInTheDocument();
  });

  it('uses exact rolling instants when the shared header selects 24 hours', async () => {
    const now = Date.parse('2026-10-14T20:27:46.810Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    renderPage();
    await waitFor(() => expect(activityCalls().length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Last 24 hours' }));
    await waitFor(() => {
      const params = new URL(activityCalls().at(-1)!, 'http://localhost').searchParams;
      expect(params.get('start')).toBe('2026-10-13T20:27:46.810Z');
      expect(params.get('end')).toBe('2026-10-14T20:27:46.810Z');
    });
    expect(await within(kpiCard('Total actions')).findByText('6')).toBeInTheDocument();
  });

  it('refetches when the shared header changes the URL range', async () => {
    activityResult = [];
    renderPage();

    await waitFor(() => {
      expect(activityCalls().length).toBeGreaterThan(0);
    });

    expect(screen.queryByTestId('my-activity-range')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('header-activity-range'));
    await waitFor(() => {
      expect(activityCalls().some((u) =>
        new URL(u, 'http://localhost').searchParams.get('start') ===
          new Date('2015-01-01T00:00:00Z').toISOString()
      )).toBe(true);
    });
  });

  it('uses neutral decorative icons without changing section labels', async () => {
    renderPage();
    expect(await within(kpiCard('Total actions')).findByText('6')).toBeInTheDocument();

    for (const title of ['Top actions', 'By category']) {
      const heading = screen.getByRole('heading', { name: title });
      const icon = heading.querySelector('svg');
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveClass('text-[var(--text-secondary)]');
      expect(icon).not.toHaveClass('text-cyan-300');
    }
  });

  it('does not present unavailable activity as measured zero after an initial failure', async () => {
    activityError = new ApiError('activity unavailable', 500);
    renderPage();
    await screen.findAllByText('Server error');

    const summary = screen.getByRole('region', { name: 'Activity summary' });
    // Unavailable metrics are omitted from the face (never zero-filled);
    // the drawer counts each unknown field.
    expect(summary.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    for (const label of ['Total actions', 'Active days', 'Action types', 'Entities touched']) {
      assertOperationalMetricUnavailable(summary, label);
      expect(within(summary).queryByText('0')).not.toBeInTheDocument();
    }
    expect(screen.getByText('Activity feed')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it.each([500, 503])('retains every populated section after a failed %i refresh and recovers through the shared retry', async (status) => {
    const { queryClient } = renderPage();
    expect(await within(kpiCard('Total actions')).findByText('6')).toBeInTheDocument();
    const feed = screen.getByRole('heading', { name: 'Activity feed' }).closest('[data-print-card]');
    expect(feed).not.toBeNull();
    const before = activityCalls().length;

    activityError = new ApiError('refresh unavailable', status);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['users', 'me', 'activity'] });
    });

    const warning = await screen.findByTestId('stale-refresh-warning');
    expect(warning).toHaveAttribute('role', 'status');
    expect(warning).toHaveAttribute('aria-live', 'polite');
    expect(warning).toHaveTextContent('Previously loaded data remains visible');
    expect(activityCalls().length).toBeGreaterThan(before);
    expect(within(kpiCard('Total actions')).getByText('6')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Top actions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'By category' })).toBeInTheDocument();
    for (const title of ['Activity over time', 'By hour of day']) {
      expect(screen.getByRole('figure', { name: title })).toHaveAttribute('data-chart-state', 'ready');
    }
    expect(within(feed as HTMLElement).getAllByRole('link').filter(link => link.getAttribute('href') === '/vehicles/10')).toHaveLength(2);
    expect(screen.queryByText('Server error')).not.toBeInTheDocument();
    expect(screen.queryByText('Activity feed is not supported')).not.toBeInTheDocument();

    activityError = null;
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument());
    expect(within(kpiCard('Total actions')).getByText('6')).toBeInTheDocument();
  });

  it('retains successful empty results and measured zero through a refresh failure and recovery', async () => {
    activityResult = [];
    const { queryClient } = renderPage();
    expect(await screen.findByText('No recent activity in this window.')).toBeInTheDocument();
    expect(within(kpiCard('Total actions')).getByText('0')).toBeInTheDocument();

    activityError = new ApiError('refresh unavailable', 500);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['users', 'me', 'activity'] });
    });
    const warning = await screen.findByTestId('stale-refresh-warning');
    expect(within(kpiCard('Total actions')).getByText('0')).toBeInTheDocument();
    for (const message of [
      'No activity recorded in this window.', 'No actions in this window.',
      'No categories to break down yet.', 'No activity to chart by hour yet.',
      'No recent activity in this window.',
    ]) {
      expect(screen.getByText(message)).toBeInTheDocument();
    }
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
    expect(screen.queryByText('Server error')).not.toBeInTheDocument();

    activityError = null;
    activityResult = baseEntries();
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(await within(kpiCard('Total actions')).findByText('6')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument());
    expect(screen.queryByText('No recent activity in this window.')).not.toBeInTheDocument();
  });

});
