/**
 * QuietHoursPage — contract + hardening tests.
 *
 * QuietHoursPage is a composition page: it fetches the quiet-hours windows
 * once via `useQuietHours()` and fans that single TanStack result out to both
 * the page-header freshness chip (via `PageContainer`) and the full-width KPI
 * band (the REAL `QuietHoursSummary`). It also owns the propose-only seed
 * hand-off (ADR-015 §I8): the AI advisor's "Apply to form" only seeds the
 * deterministic `QuietHoursPanel`'s draft through the page's `pendingSeed`
 * state — the panel keeps the sole Save write path.
 *
 * Because orchestration is the page's whole job, these tests drive it
 * end-to-end — the REAL `QuietHoursSummary` + `QuietHoursGuide` +
 * `PageContainer` against a mocked `request()` boundary — while stubbing the
 * two heavy, self-fetching children (`QuietHoursPanel`, `AIQuietHoursSuggestion`)
 * so we can assert exactly what the page forwards to them and drive the seed
 * round-trip deterministically. (`AIQuietHoursSuggestion` is also gated behind
 * `withAiFeature`, which renders null in the default `ai_mode='off'` test
 * settings, so stubbing it is the only way to exercise the hand-off.)
 *
 * Facets covered:
 *   1. Populated — header/subtitle/copy-link render; the KPI band derives the
 *      right totals from the window set; the guide + both children mount; the
 *      window fetch uses the SI-clean `/notifications/quiet-hours` path (no
 *      `/api/v1` double-prefix).
 *   2. Active-now — an always-active window flips the "Right now" KPI to Quiet
 *      with the interpolated "N window active now" subtitle.
 *   3. Loading — while the query is in flight the summary shows its skeleton
 *      (never a blank panel) and the rest of the page still mounts.
 *   4. Error — a failed query surfaces a retryable alert without hiding the
 *      rest of the page; Retry re-fires the request.
 *   5. Empty — a zero-window backlog renders honest zero/dash placeholders
 *      (not a blank panel, skeleton, or error).
 *   6. Seed hand-off — applying an AI draft seeds the panel, and consuming the
 *      seed clears it back to null (the page's `pendingSeed` state machine).
 *   7. Title — the page sets the document title.
 *
 * Network is mocked at the `@/api/client` boundary (repo convention — see
 * ArchivedPage.test.tsx). `react-i18next` is stubbed to echo the inline
 * fallback (with `{{var}}` interpolation) so text assertions stay
 * deterministic. `useSettings` / `useTimezone` come from the global stubs in
 * src/test-setup.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// react-i18next: echo the inline fallback, interpolating `{{var}}` tokens so
// the summary's "N window active now" subtitle asserts cleanly.
vi.mock('react-i18next', () => {
  const interpolate = (base: string, opts?: Record<string, unknown>): string => {
    if (!opts) return base;
    return Object.entries(opts).reduce(
      (out, [k, v]) => (k === 'defaultValue' ? out : out.replace(`{{${k}}}`, String(v))),
      base,
    );
  };
  return {
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: Record<string, unknown>) => {
        if (second !== null && typeof second === 'object') {
          const opts = second as Record<string, unknown>;
          const base = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
          return interpolate(base, opts);
        }
        const base = typeof second === 'string' ? second : key;
        return interpolate(base, third);
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// A stable AI draft the stubbed advisor hands up on "apply". The page must
// forward this exact reference into the panel's `seedDraft`.
const h = vi.hoisted(() => ({
  SAMPLE_PATCH: {
    enabled: true,
    start_local: '23:00',
    end_local: '07:00',
    timezone: 'UTC',
    weekdays: 127,
    bypass_severities: ['critical'],
  },
  captured: { panelSeed: undefined as unknown },
}));

// Stub the heavy, self-fetching QuietHoursPanel. Mirrors the seed it receives
// onto a data-* attribute (+ captures it) and exposes a button that fires
// onSeedConsumed so we can drive the page's clear-back-to-null path.
vi.mock('@/features/settings/components/QuietHoursPanel', () => ({
  QuietHoursPanel: (props: { seedDraft?: unknown; onSeedConsumed?: () => void }) => {
    h.captured.panelSeed = props.seedDraft ?? null;
    return (
      <div
        data-testid="quiet-hours-panel"
        data-seed={props.seedDraft ? JSON.stringify(props.seedDraft) : 'null'}
      >
        <button type="button" onClick={() => props.onSeedConsumed?.()}>
          consume-seed
        </button>
      </div>
    );
  },
}));

// Stub the withAiFeature-gated advisor (absent in ai_mode='off'). Exposes a
// button that fires onApplyDraft with the sample patch, standing in for the
// real "Apply to form" click.
vi.mock('@/components/ai/AIQuietHoursSuggestion', () => ({
  AIQuietHoursSuggestion: (props: { onApplyDraft: (patch: unknown) => void }) => (
    <div data-testid="ai-suggestion">
      <button type="button" onClick={() => props.onApplyDraft(h.SAMPLE_PATCH)}>
        apply-draft
      </button>
    </div>
  ),
}));

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import { __resetTitleStoreForTests } from '@/lib/titleStore';
import type { QuietHoursWindow } from '@/api/types';
import QuietHoursPage from './QuietHoursPage';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

/* ── Fixtures ─────────────────────────────────────────── */

function makeWindow(overrides: Partial<QuietHoursWindow>): QuietHoursWindow {
  return {
    id: 1,
    user_id: 'u1',
    enabled: true,
    start_local: '22:00',
    end_local: '07:00',
    timezone: 'UTC',
    weekdays: 0,
    bypass_severities: [],
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// total 3 · enabled 2 (ids 1,2) · activeNow 0 (weekdays:0 for the enabled ones,
// id 3 disabled) · bypass union of the ENABLED windows = {critical, warn}.
const WINDOWS: QuietHoursWindow[] = [
  makeWindow({ id: 1, enabled: true, weekdays: 0, bypass_severities: ['critical'] }),
  makeWindow({ id: 2, enabled: true, weekdays: 0, bypass_severities: ['critical', 'warn'] }),
  makeWindow({ id: 3, enabled: false, weekdays: 127, bypass_severities: ['info'] }),
];

// start==end=='00:00' with all weekdays set is the cross-midnight wrap case that
// is active for every minute of every day — deterministic "Quiet" without
// touching the wall clock.
const ALWAYS_ON: QuietHoursWindow[] = [
  makeWindow({ id: 9, enabled: true, start_local: '00:00', end_local: '00:00', weekdays: 127, bypass_severities: ['critical'] }),
];

type Resolver = () => Promise<unknown>;

function installRequest(handlers: { quietHours?: Resolver } = {}) {
  mockedRequest.mockImplementation((path: string) => {
    if (path.startsWith('/notifications/quiet-hours')) {
      return (handlers.quietHours ?? (() => Promise.resolve({ windows: WINDOWS })))();
    }
    return Promise.resolve({});
  });
}

const quietHoursCallCount = () =>
  mockedRequest.mock.calls.filter((c) => String(c[0]).startsWith('/notifications/quiet-hours')).length;

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/notifications/quiet-hours']}>
        <ToastProvider>
          <QuietHoursPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedRequest.mockReset();
  h.captured.panelSeed = undefined;
  __resetTitleStoreForTests();
  installRequest();
});

describe('QuietHoursPage', () => {
  it('renders the header, copy-link, guide, both children, and a populated KPI band from a SI-clean fetch', async () => {
    renderPage();

    // Header + subtitle render synchronously from the page shell.
    expect(screen.getByRole('heading', { level: 1, name: 'Quiet hours' })).toBeInTheDocument();
    expect(
      screen.getByText('Suppress non-critical notifications during a configurable window.'),
    ).toBeInTheDocument();

    // Copy-link header affordance is wired via `copyLink`.
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();

    // Both heavy children are orchestrated in, plus the static guide rail.
    expect(screen.getByTestId('quiet-hours-panel')).toBeInTheDocument();
    expect(screen.getByTestId('ai-suggestion')).toBeInTheDocument();
    expect(screen.getByText('How quiet hours work')).toBeInTheDocument();

    // KPI band derives its totals from the fetched windows.
    const region = await screen.findByRole('region', { name: 'Quiet hours summary' });
    await within(region).findByText('Windows');
    expect(within(region).getByText('3')).toBeInTheDocument(); // total windows
    expect(within(region).getByText('2/3')).toBeInTheDocument(); // enabled/total
    expect(within(region).getByText('Delivering')).toBeInTheDocument(); // none active now
    expect(within(region).getByText('No window active now')).toBeInTheDocument();
    expect(within(region).getByText('critical, warn')).toBeInTheDocument(); // bypass union

    // The window fetch uses the SI-clean path: no /api/v1 double-prefix.
    expect(mockedRequest).toHaveBeenCalledWith('/notifications/quiet-hours', expect.anything());
    const badPrefix = mockedRequest.mock.calls.some((c) => String(c[0]).includes('/api/v1'));
    expect(badPrefix).toBe(false);
  });

  it('flips the "Right now" KPI to Quiet with an interpolated subtitle when a window is active', async () => {
    installRequest({ quietHours: () => Promise.resolve({ windows: ALWAYS_ON }) });
    renderPage();

    const region = await screen.findByRole('region', { name: 'Quiet hours summary' });
    await within(region).findByText('Windows');
    expect(within(region).getByText('Quiet')).toBeInTheDocument();
    expect(within(region).getByText('1 window active now')).toBeInTheDocument();
    expect(within(region).getByText('1/1')).toBeInTheDocument(); // enabled/total
  });

  it('shows the summary skeleton while the query is in flight, without blanking the page', async () => {
    installRequest({ quietHours: () => new Promise<never>(() => {}) });
    renderPage();

    // Loading renders the stat-grid skeleton, not populated cards.
    expect(await screen.findByTestId('stat-grid-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Windows')).toBeNull();

    // The rest of the page still renders — never a frozen/blank surface.
    expect(screen.getByTestId('quiet-hours-panel')).toBeInTheDocument();
    expect(screen.getByText('How quiet hours work')).toBeInTheDocument();
  });

  it('surfaces a retryable error and keeps the page usable; Retry re-fires the request', async () => {
    installRequest({ quietHours: () => Promise.reject(new Error('boom')) });
    renderPage();

    const region = await screen.findByRole('region', { name: 'Quiet hours summary' });
    expect(await within(region).findByRole('alert')).toBeInTheDocument();
    const retry = within(region).getByRole('button', { name: 'Retry' });

    // Graceful degrade: the panel + guide remain despite the summary error.
    expect(screen.getByTestId('quiet-hours-panel')).toBeInTheDocument();
    expect(screen.getByText('How quiet hours work')).toBeInTheDocument();

    // Retry re-issues the windows request.
    const before = quietHoursCallCount();
    fireEvent.click(retry);
    await waitFor(() => expect(quietHoursCallCount()).toBeGreaterThan(before));
  });

  it('renders honest zero/dash placeholders (not a blank panel) when there are no windows', async () => {
    installRequest({ quietHours: () => Promise.resolve({ windows: [] }) });
    renderPage();

    const region = await screen.findByRole('region', { name: 'Quiet hours summary' });
    await within(region).findByText('Windows');
    expect(within(region).getByText('0')).toBeInTheDocument(); // total
    expect(within(region).getByText('Delivering')).toBeInTheDocument();
    expect(within(region).getByText('No window active now')).toBeInTheDocument();
    // Enabled + bypass both collapse to an em dash when there is nothing to show.
    expect(within(region).getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('seeds the panel when the AI advisor applies a draft, then clears it once consumed', async () => {
    renderPage();
    await screen.findByText('Windows'); // let the query settle first

    // Nothing seeded yet — the panel receives a null draft.
    expect(screen.getByTestId('quiet-hours-panel')).toHaveAttribute('data-seed', 'null');
    expect(h.captured.panelSeed).toBeNull();

    // AI "apply" hands the draft up; the page seeds it straight into the panel.
    fireEvent.click(screen.getByRole('button', { name: 'apply-draft' }));
    await waitFor(() =>
      expect(screen.getByTestId('quiet-hours-panel')).toHaveAttribute(
        'data-seed',
        JSON.stringify(h.SAMPLE_PATCH),
      ),
    );
    expect(h.captured.panelSeed).toEqual(h.SAMPLE_PATCH);

    // Consuming the seed clears the page's pendingSeed back to null so the
    // panel does not re-seed on subsequent renders.
    fireEvent.click(screen.getByRole('button', { name: 'consume-seed' }));
    await waitFor(() =>
      expect(screen.getByTestId('quiet-hours-panel')).toHaveAttribute('data-seed', 'null'),
    );
    expect(h.captured.panelSeed).toBeNull();
  });

  it('sets the document title to the page title', async () => {
    renderPage();
    await screen.findByText('Windows');
    await waitFor(() => expect(document.title).toBe('Quiet hours — TeslaSync'));
  });
});
