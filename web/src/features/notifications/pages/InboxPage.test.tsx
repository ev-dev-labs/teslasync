/**
 * InboxPage — behaviour + hardening tests.
 *
 * InboxPage is a thin composition route: it reads the vehicle registry
 * (`useVehicles`), the alert-rule registry (`useAlertRules`) and the
 * unfiltered active backlog (`useNotificationLogs({ archived: false })`),
 * then lays an `InboxSummary` KPI band over the shared `InboxBody` detail
 * surface inside a `PageContainer`.
 *
 * The three data hooks are mocked at the hook boundary so every summary
 * branch — loading, error, empty and the fully-populated happy path — is
 * exercised deterministically, and network never touches a real backend.
 * The heavy `InboxBody` (URL-state + bulk-selection machinery) is stubbed
 * with a prop-capturing marker so the assertions target THE PAGE'S own
 * wiring — the `archived={false}` flag and the vehicles/rules pass-through,
 * including the page's `?? []` null-safety defaults — rather than InboxBody's
 * internals. The real `InboxSummary` is rendered so the KPI derivation
 * (totals, unread-of-total, per-severity counts) is covered through the page.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n echo mock: returns the fallback string (or key when none), interpolating
// {{var}} tokens from the options object so assertions target rendered English.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fb?: unknown, opts?: unknown) => {
      const options = (
        opts && typeof opts === 'object'
          ? opts
          : fb && typeof fb === 'object'
            ? fb
            : undefined
      ) as Record<string, unknown> | undefined;
      let base: string;
      if (typeof fb === 'string') base = fb;
      else if (
        fb &&
        typeof fb === 'object' &&
        typeof (fb as { defaultValue?: unknown }).defaultValue === 'string'
      )
        base = (fb as { defaultValue: string }).defaultValue;
      else base = key;
      if (options) {
        base = base.replace(/{{\s*(\w+)\s*}}/g, (_m, n: string) =>
          n in options && options[n] != null ? String(options[n]) : `{{${n}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// jsdom lacks matchMedia; framer-motion (via <FadeIn>) reads it through
// useMotionPreference.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicles: vi.fn() };
});

vi.mock('@/api/hooks/useNotifications', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useNotifications')>();
  return { ...actual, useAlertRules: vi.fn(), useNotificationLogs: vi.fn() };
});

// Prop-capturing stub for the shared detail surface. Renders the flag +
// derived counts so the page's wiring is asserted without dragging in
// InboxBody's URL-state / bulk-selection / mutation machinery.
vi.mock('../components/InboxBody', () => ({
  InboxBody: ({
    archived,
    vehicles,
    rules,
  }: {
    archived: boolean;
    vehicles: unknown[];
    rules: unknown[];
  }) => (
    <div data-testid="inbox-body">
      <span data-testid="inbox-body-archived">{String(archived)}</span>
      <span data-testid="inbox-body-vehicles">{vehicles.length}</span>
      <span data-testid="inbox-body-rules">{rules.length}</span>
    </div>
  ),
}));

import { ToastProvider } from '@/components/feedback/Toast';
import InboxPage from './InboxPage';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useAlertRules, useNotificationLogs } from '@/api/hooks/useNotifications';
import { __resetTitleStoreForTests } from '@/lib/titleStore';
import type { NotificationLog, Vehicle, AlertRule } from '@/api/types';

const mockVehicles = vi.mocked(useVehicles);
const mockRules = vi.mocked(useAlertRules);
const mockLogs = vi.mocked(useNotificationLogs);

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): never {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  } as never;
}

// Two hours ago is safely the newest row regardless of wall-clock time.
const RECENT = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
const OLDER = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

// total=5, unread=3, critical=2, warn=1, info=2 — every KPI value is a distinct
// digit (5/3/1) except the intentional critical/info pair (2), so assertions
// can target each derived count unambiguously within the summary landmark.
const LOGS = [
  { id: 1, severity: 'critical', read_at: null, created_at: RECENT },
  { id: 2, severity: 'critical', read_at: OLDER, created_at: OLDER },
  { id: 3, severity: 'warn', read_at: OLDER, created_at: OLDER },
  { id: 4, severity: 'info', read_at: null, created_at: OLDER },
  { id: 5, severity: 'info', read_at: null, created_at: OLDER },
] as unknown as NotificationLog[];

const VEHICLES = [{ id: 1 }, { id: 2 }] as unknown as Vehicle[];
const RULES = [{ id: 10 }, { id: 11 }, { id: 12 }] as unknown as AlertRule[];

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/notifications/inbox']}>
        <ToastProvider>
          <InboxPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Scopes queries to the InboxSummary landmark (excludes the InboxBody stub). */
function summaryScope() {
  return within(screen.getByRole('region', { name: 'Inbox summary' }));
}

beforeEach(() => {
  __resetTitleStoreForTests();
  mockVehicles.mockReturnValue(qr({ data: VEHICLES }));
  mockRules.mockReturnValue(qr({ data: RULES }));
  mockLogs.mockReturnValue(qr({ data: LOGS }));
});

describe('InboxPage — page shell & composition', () => {
  it('renders the title heading, subtitle and sets the document title', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument();
    expect(
      screen.getByText('Recent notifications from your alert rules.'),
    ).toBeInTheDocument();
    expect(document.title).toBe('Inbox — TeslaSync');
  });

  it('exposes an accessible "View archived" link to the archived surface', () => {
    renderPage();
    const link = screen.getByRole('link', { name: 'View archived' });
    expect(link).toHaveAttribute('href', '/notifications/archived');
  });

  it('reads the unfiltered active backlog for the summary band', () => {
    renderPage();
    expect(mockLogs).toHaveBeenCalledWith({ archived: false });
  });

  it('passes archived=false plus the fetched vehicles & rules to InboxBody', () => {
    renderPage();
    expect(screen.getByTestId('inbox-body-archived')).toHaveTextContent('false');
    expect(screen.getByTestId('inbox-body-vehicles')).toHaveTextContent('2');
    expect(screen.getByTestId('inbox-body-rules')).toHaveTextContent('3');
  });
});

describe('InboxPage — summary KPI derivation (happy path)', () => {
  it('renders the labelled summary landmark with every metric card', () => {
    renderPage();
    const summary = summaryScope();
    for (const label of ['Total', 'Unread', 'Critical', 'Warnings', 'Info', 'Last received']) {
      expect(summary.getByText(label)).toBeInTheDocument();
    }
  });

  it('derives totals, unread-of-total and per-severity counts from the rows', () => {
    renderPage();
    const summary = summaryScope();
    expect(summary.getByText('5')).toBeInTheDocument(); // total rows
    expect(summary.getByText('3')).toBeInTheDocument(); // unread (rows w/o read_at)
    expect(summary.getByText('3 of 5')).toBeInTheDocument(); // unread subtitle
    expect(summary.getByText('1')).toBeInTheDocument(); // warnings
    expect(summary.getAllByText('2')).toHaveLength(2); // critical + info both 2
  });
});

describe('InboxPage — summary states', () => {
  it('shows the loading skeleton (never a blank panel) while fetching', () => {
    mockLogs.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    renderPage();
    // Page shell is still present around the skeleton.
    expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading stat cards' })).toBeInTheDocument();
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
  });

  it('surfaces a retryable error state and invokes refetch on retry', () => {
    const refetch = vi.fn();
    mockLogs.mockReturnValue(
      qr({ isError: true, error: new Error('boom'), data: undefined, refetch }),
    );
    renderPage();

    expect(screen.queryByText('Total')).not.toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders an empty state (never a blank panel) when the backlog is empty', () => {
    mockLogs.mockReturnValue(qr({ data: [] }));
    renderPage();
    expect(screen.getByText('No notifications yet')).toBeInTheDocument();
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
    // The detail surface still mounts below the empty summary.
    expect(screen.getByTestId('inbox-body')).toBeInTheDocument();
  });
});

describe('InboxPage — null safety', () => {
  it('defaults vehicles & rules to empty arrays when their hooks return no data', () => {
    mockVehicles.mockReturnValue(qr({ data: undefined }));
    mockRules.mockReturnValue(qr({ data: undefined }));
    renderPage();
    expect(screen.getByTestId('inbox-body-vehicles')).toHaveTextContent('0');
    expect(screen.getByTestId('inbox-body-rules')).toHaveTextContent('0');
    expect(screen.getByTestId('inbox-body-archived')).toHaveTextContent('false');
  });
});
