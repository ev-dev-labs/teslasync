/**
 * WebhooksPage — behaviour + regression tests.
 *
 * WebhooksPage is a thin orchestrator: it fires a single `useWebhookChannels()`
 * query, threads that one result into both the page-header freshness chip
 * (via `PageContainer query={…}`) and the KPI band (`WebhookSummary query={…}`),
 * and lays out three real sections in a responsive bento — the KPI summary,
 * the CRUD hero (`WebhookChannelsSection`), and the static `WebhookGuide` rail.
 *
 * These tests drive the REAL child components through a mocked `request()`
 * client (the same seam the sibling AuditLogPage + WebhookChannelsSection
 * suites use) so the TanStack Query wiring, the `kind === 'webhook'` filter in
 * `useWebhookChannels`, and the summary's `useMemo` aggregation all execute for
 * real. Only the network boundary, i18n, and framer-motion are stubbed.
 *
 * Coverage:
 *   1. Loading — the KPI band shows its skeleton, no metric labels have
 *      mounted yet, and the always-on page shell (copy-link control, guide
 *      rail, CRUD section, document title) is still present.
 *   2. Happy path — the summary aggregates the payload (endpoints, enabled,
 *      secure, methods), the non-webhook channel is filtered out of every
 *      count, the hook hit the un-prefixed `/notifications` path, and the
 *      single shared query dedupes to exactly one fetch across page + section.
 *   3. Empty — a `[]` payload renders the band as zeros/placeholders rather
 *      than a blank panel or a hidden section, and no skeleton remains.
 *   4. Guide rail — the static how-it-works panel surfaces its signing
 *      reference (header, algorithm, methods) regardless of data state.
 *   5. Error + retry — a rejected fetch surfaces the summary's alert while
 *      keeping every other section visible, and the Retry control refetches
 *      and recovers to the data state.
 *   6. REGRESSION (null-safety) — a webhook whose `url`/`method` are null
 *      (legal on the wire even though the TS type narrows them) is counted
 *      via the `?? ''` / `?? 'POST'` hardening instead of crashing the band.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// ── i18n stub: return the English fallback, interpolating {{vars}} from the
//    3rd positional arg OR from a `{ defaultValue, ...vars }` object. ────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, second?: unknown, third?: unknown) => {
      const interpolate = (tpl: string, vars?: Record<string, unknown>) => {
        if (!vars) return tpl;
        let out = tpl;
        for (const [k, v] of Object.entries(vars)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
        return out;
      };
      if (typeof second === 'string') {
        return interpolate(
          second,
          third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined,
        );
      }
      if (second && typeof second === 'object') {
        const o = second as Record<string, unknown>;
        const tpl = typeof o.defaultValue === 'string' ? o.defaultValue : key;
        const { defaultValue: _dv, ...vars } = o;
        return interpolate(tpl, vars);
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── framer-motion: strip animation props, render children synchronously. ────
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const safe: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              ['animate', 'initial', 'exit', 'transition', 'whileHover', 'whileTap', 'whileInView', 'whileFocus', 'variants', 'layout', 'layoutId'].includes(
                k,
              )
            )
              continue;
            safe[k] = v;
          }
          return <div {...(safe as Record<string, unknown>)}>{children}</div>;
        },
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
  };
});

// ── API client: mock only `request`; keep the real ApiError so the summary's
//    QueryError branches on a genuine status code. ────────────────────────────
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

import { request, ApiError } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import WebhooksPage from './WebhooksPage';
import type { NotificationChannel, NotificationChannelWebhook } from '@/api/types';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

// ── Fixtures ────────────────────────────────────────────────────────────────
const ISO = '2026-01-01T00:00:00Z';

function webhook(overrides: Partial<NotificationChannelWebhook> = {}): NotificationChannelWebhook {
  return {
    id: 1,
    name: 'Alpha',
    kind: 'webhook',
    enabled: true,
    url: 'https://alpha.example/hook',
    method: 'POST',
    headers: {},
    body_template: '',
    created_at: ISO,
    updated_at: ISO,
    ...overrides,
  };
}

// A non-webhook channel that MUST be filtered out of every KPI count.
const DISCORD: NotificationChannel = {
  id: 99,
  name: 'Zeta Discord',
  kind: 'discord',
  enabled: true,
  webhook_url: 'https://discord.example/xyz',
  username: null,
  avatar_url: null,
  created_at: ISO,
  updated_at: ISO,
};

const SUMMARY_REGION = 'Webhook endpoints summary';

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
    },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <WebhooksPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function channelFetchCount() {
  return mockedRequest.mock.calls.filter((c) => c[0] === '/notifications').length;
}

beforeEach(() => {
  mockedRequest.mockReset();
  localStorage.clear();
  document.title = '';
});

describe('WebhooksPage — data states', () => {
  it('shows the KPI skeleton while the shared fetch is in flight, with the shell always visible', () => {
    // A never-resolving fetch keeps the query in its loading state.
    mockedRequest.mockReturnValue(new Promise<NotificationChannel[]>(() => {}));
    renderPage();

    // KPI band renders its skeleton, not its metric labels, during load.
    const summary = screen.getByRole('region', { name: SUMMARY_REGION });
    expect(within(summary).getByTestId('stat-grid-skeleton')).toBeInTheDocument();
    expect(within(summary).queryByText('Endpoints')).toBeNull();

    // The page shell is present regardless of data availability.
    expect(screen.getByRole('button', { name: 'Copy link to this view' })).toBeInTheDocument();
    expect(screen.getByText('How webhooks work')).toBeInTheDocument();
    expect(screen.getByTestId('webhook-channels-section')).toBeInTheDocument();
    expect(document.title).toContain('Webhooks');
  });

  it('aggregates the payload, filters non-webhook channels, and dedupes to one fetch', async () => {
    mockedRequest.mockResolvedValue([
      webhook({ id: 1, name: 'Alpha', enabled: true, url: 'https://a.example/hook', method: 'POST' }),
      webhook({ id: 2, name: 'Bravo', enabled: false, url: 'http://b.example/hook', method: 'PUT' }),
      DISCORD, // filtered out by kind
    ]);
    renderPage();

    // "Endpoints" is unique to the KPI band — wait for the data render.
    expect(await screen.findByText('Endpoints')).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: SUMMARY_REGION });

    // 2 webhooks (Discord excluded), 1 of 2 enabled, 1 of 2 over HTTPS.
    expect(within(summary).getByText('2')).toBeInTheDocument();
    expect(within(summary).getAllByText('1/2')).toHaveLength(2);
    // Methods de-duped + sorted + joined.
    expect(within(summary).getByText('POST, PUT')).toBeInTheDocument();

    // The hook hits the un-prefixed path (request() adds /api/v1).
    expect(mockedRequest).toHaveBeenCalledWith('/notifications', expect.anything());
    // One shared query backs both the page freshness chip and the CRUD
    // section, so the channels list is fetched exactly once.
    expect(channelFetchCount()).toBe(1);
  });

  it('renders the KPI band as zeros/placeholders (never a blank panel) when empty', async () => {
    mockedRequest.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('Endpoints')).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: SUMMARY_REGION });

    // Zero endpoints; enabled/secure/methods collapse to the "—" placeholder.
    expect(within(summary).getByText('0')).toBeInTheDocument();
    expect(within(summary).getAllByText('—').length).toBeGreaterThanOrEqual(3);
    // The loading skeleton is gone.
    expect(within(summary).queryByTestId('stat-grid-skeleton')).toBeNull();
  });
});

describe('WebhooksPage — static guide rail', () => {
  it('surfaces the signing reference regardless of data state', async () => {
    mockedRequest.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('How webhooks work')).toBeInTheDocument();
    expect(screen.getByText('X-TeslaSync-Signature')).toBeInTheDocument();
    expect(screen.getByText('HMAC-SHA256 · sha256=…')).toBeInTheDocument();
    expect(screen.getByText('POST · PUT · PATCH')).toBeInTheDocument();
  });
});

describe('WebhooksPage — error + recovery', () => {
  it('shows the summary alert on failure while keeping other sections, then recovers on Retry', async () => {
    mockedRequest
      .mockRejectedValueOnce(new ApiError('backend exploded', 500))
      .mockResolvedValue([webhook({ id: 1, name: 'Alpha', enabled: true, url: 'https://a.example/hook', method: 'POST' })]);
    renderPage();

    // The KPI band surfaces the 5xx failure via QueryError ("Server error" is
    // unique to that branch — the CRUD section's own error reads differently).
    expect(await screen.findByText('Server error')).toBeInTheDocument();
    // …and it is announced through a role="alert" live region for a11y.
    expect(screen.getByText('Server error').closest('[role="alert"]')).not.toBeNull();

    // …but the rest of the page stays visible (sections are never hidden).
    expect(screen.getByTestId('webhook-channels-section')).toBeInTheDocument();
    expect(screen.getByText('How webhooks work')).toBeInTheDocument();

    // Retry refetches the shared query and the band recovers to data.
    const before = mockedRequest.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Endpoints')).toBeInTheDocument();
    const recovered = screen.getByRole('region', { name: SUMMARY_REGION });
    expect(within(recovered).getByText('1')).toBeInTheDocument();
    expect(mockedRequest.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('WebhooksPage — null safety', () => {
  it('counts a webhook with null url/method via the summary fallbacks instead of crashing', async () => {
    // The backend can legitimately omit url/method on a half-provisioned
    // row even though the TS type narrows them to string — the summary's
    // `?? ''` / `?? 'POST'` guards must keep the band alive.
    const nullish = webhook({
      id: 7,
      name: 'NullEdge',
      enabled: true,
      url: null,
      method: null,
    } as unknown as Partial<NotificationChannelWebhook>);
    mockedRequest.mockResolvedValue([nullish]);
    renderPage();

    expect(await screen.findByText('Endpoints')).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: SUMMARY_REGION });

    // 1 endpoint, enabled 1/1, secure 0/1 (null url is not HTTPS), method
    // defaults to POST — and the page did not crash.
    expect(within(summary).getByText('1')).toBeInTheDocument();
    expect(within(summary).getByText('1/1')).toBeInTheDocument();
    expect(within(summary).getByText('0/1')).toBeInTheDocument();
    expect(within(summary).getByText('POST')).toBeInTheDocument();
  });
});
