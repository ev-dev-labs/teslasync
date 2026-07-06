/**
 * TeslaFeatureFlagsPage contract + hardening tests.
 *
 * The page pulls a single Tesla feature-config envelope
 * (`GET /tesla/user/feature-config`) plus a refresh mutation
 * (`POST /tesla/user/feature-config/refresh`), then fans the parsed rows across
 * a KPI band, an overview bento (enabled-rate gauge + composition chart) and a
 * searchable/filterable feature table. Each section owns its own
 * loading / empty / error state. These tests exercise every branch and
 * interaction:
 *
 *   1. Loading  — skeletons render; no KPI values and no chart yet.
 *   2. Loaded   — truthful KPIs (Total / Enabled / Disabled / rate), the
 *                 distribution gauge, the composition chart, every feature row,
 *                 and the "Showing N of M" tally. Also a hook-URL contract
 *                 guard: the GET path carries no `/api/v1` prefix.
 *   3. Search   — typing narrows the table to the matching row and updates the
 *                 tally.
 *   4. Filter   — the status <select> narrows the table to disabled features.
 *   5. Empty    — an empty payload shows every section's empty state, truthful
 *                 zero KPIs, and the "Not synced yet" freshness caption.
 *   6. Error    — when the fetch fails with no data, all three panels surface
 *                 <QueryError> AND the KPI band degrades every metric to an
 *                 em-dash (regression guard: it must NOT fabricate "0 features"
 *                 when the source errored — mirrors the FleetAPIPage rule).
 *   7. Refresh  — clicking the header Refresh button POSTs the refresh endpoint
 *                 and disables the control while the mutation is in flight.
 *   8. Stale    — a failed *background* refetch keeps the last-good rows visible
 *                 (no error panel) because the page only blocks when it has
 *                 nothing to fall back on.
 *   9. a11y     — labelled KPI + overview regions, an image-role chart, a named
 *                 search box, a named status filter, and a named Refresh button.
 *
 * Network is driven entirely through the mocked `@/api/client` `request` (the
 * same seam FleetAPIPage / APIKeysPage use) so nothing touches the real
 * network. `isApiError` is preserved from the real module so <QueryError>
 * falls to its generic network branch for a plain Error.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>;
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            );
          }
          return fallbackOrOpts;
        }
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

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    request: vi.fn(),
  };
});

// jsdom lacks matchMedia; framer-motion (<FadeIn>) and useMotionPreference read
// it. Guarded polyfill keeps the render deterministic.
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

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import TeslaFeatureFlagsPage from './TeslaFeatureFlagsPage';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

const FC_PATH = '/tesla/user/feature-config';
const REFRESH_PATH = '/tesla/user/feature-config/refresh';

interface ReqOpts {
  method?: string;
}

/**
 * A representative feature-config blob: two bare boolean flags + two configured
 * objects, split evenly enabled/disabled. Parsed + sorted by key this yields
 * total=4, enabled=2, disabled=2, enabledRate=50.
 */
const SAMPLE: Record<string, unknown> = {
  vehicle_command_enabled: true, // flag, enabled
  ludicrous_mode: false, // flag, disabled
  charge_on_solar: { enabled: true, threshold: 80 }, // configured, enabled
  sentry_upgrade: { enabled: false, tier: 'pro' }, // configured, disabled
};

function makeEnvelope(data: unknown, fetchedAt: string | null = '2026-07-01T12:00:00.000Z') {
  return { data, fetched_at: fetchedAt };
}

interface InstallCfg {
  /** Value the GET resolves with (ignored when `getSequence`/`getErrors` set). */
  envelope?: unknown;
  /** When true, the GET always rejects with a plain network Error. */
  getErrors?: boolean;
  /** Per-call GET outcomes (a value resolves, an Error rejects). */
  getSequence?: Array<unknown | Error>;
  /** Value the refresh POST resolves with (an Error rejects). */
  refreshResult?: unknown | Error;
  /** When true, the refresh POST never settles (keeps the mutation pending). */
  hangRefresh?: boolean;
}

/** Route the single `request` mock by "METHOD path" so query + mutation work. */
function installRequest(cfg: InstallCfg = {}) {
  const {
    envelope = makeEnvelope(SAMPLE),
    getErrors = false,
    getSequence,
    refreshResult = makeEnvelope(SAMPLE),
    hangRefresh = false,
  } = cfg;

  let getCall = 0;

  mockedRequest.mockImplementation((path: string, opts?: ReqOpts) => {
    const method = opts?.method ?? 'GET';
    if (method === 'GET' && path === FC_PATH) {
      const idx = getCall;
      getCall += 1;
      if (getSequence) {
        const outcome = getSequence[Math.min(idx, getSequence.length - 1)];
        return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
      }
      return getErrors ? Promise.reject(new Error('network down')) : Promise.resolve(envelope);
    }
    if (method === 'POST' && path === REFRESH_PATH) {
      if (hangRefresh) return new Promise(() => {});
      return refreshResult instanceof Error
        ? Promise.reject(refreshResult)
        : Promise.resolve(refreshResult);
    }
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });

  return { getCallCount: () => getCall };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <TeslaFeatureFlagsPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const kpiRegion = () => screen.getByRole('region', { name: 'Feature summary metrics' });
const overviewRegion = () => screen.getByRole('region', { name: 'Feature overview' });

/**
 * The header Refresh control is a real <button>. PageContainer also renders a
 * DataFreshness chip with role="button"/aria-label="Refresh", so filter down to
 * the actual button element.
 */
function getRefreshButton(): HTMLButtonElement {
  const btn = screen
    .getAllByRole('button', { name: 'Refresh' })
    .find((el): el is HTMLButtonElement => el.tagName === 'BUTTON');
  if (!btn) throw new Error('header Refresh button not found');
  return btn;
}

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('TeslaFeatureFlagsPage', () => {
  it('renders skeletons — no KPI values and no chart — while the source loads', () => {
    // Never-resolving promise keeps the query pending.
    mockedRequest.mockReturnValue(new Promise(() => {}));

    renderPage();

    // Page shell + labelled KPI region are present from the first paint.
    expect(screen.getByRole('heading', { level: 1, name: 'Feature Flags' })).toBeInTheDocument();
    expect(kpiRegion()).toBeInTheDocument();
    expect(getRefreshButton()).toBeInTheDocument();

    // KPI skeleton renders no metric labels yet...
    expect(within(kpiRegion()).queryByText('Total Features')).toBeNull();
    // ...and the composition chart (image role) only exists once data lands.
    expect(screen.queryByRole('img', { name: /Enabled versus disabled/i })).toBeNull();
  });

  it('renders truthful KPIs, the gauge, the composition chart, and every feature row', async () => {
    installRequest();

    renderPage();

    const region = kpiRegion();
    // Total is unique in the band; enabled + disabled both read "2".
    expect(await within(region).findByText('4')).toBeInTheDocument();
    expect(within(region).getByText('Total Features')).toBeInTheDocument();
    expect(within(region).getByText('50%')).toBeInTheDocument();
    expect(within(region).getAllByText('2')).toHaveLength(2);
    // Truthful data → no fabricated em-dash placeholders in the band.
    expect(within(region).queryByText('—')).toBeNull();

    // Overview bento: the enabled-rate gauge label + the grouped-bar chart.
    expect(within(overviewRegion()).getByText('Enabled Rate')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Enabled versus disabled feature counts/i }),
    ).toBeInTheDocument();

    // The table lists every parsed key and the running tally.
    expect(screen.getByText('vehicle_command_enabled')).toBeInTheDocument();
    expect(screen.getByText('charge_on_solar')).toBeInTheDocument();
    expect(screen.getByText('sentry_upgrade')).toBeInTheDocument();
    expect(screen.getByText('Showing 4 of 4')).toBeInTheDocument();

    // Hook-URL contract: the GET carries no `/api/v1` prefix and stays snake_case.
    expect(mockedRequest.mock.calls.some((c) => c[0] === FC_PATH)).toBe(true);
    expect(mockedRequest.mock.calls.some((c) => c[0] === '/api/v1/tesla/user/feature-config')).toBe(
      false,
    );
  });

  it('filters the table down to the matching feature as the user searches', async () => {
    installRequest();

    renderPage();

    expect(await screen.findByText('vehicle_command_enabled')).toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: 'Search features' });
    fireEvent.change(search, { target: { value: 'ludicrous' } });

    // Only the matching row survives; the tally reflects the narrowed view.
    expect(screen.getByText('ludicrous_mode')).toBeInTheDocument();
    expect(screen.queryByText('vehicle_command_enabled')).toBeNull();
    expect(screen.queryByText('charge_on_solar')).toBeNull();
    expect(screen.getByText('Showing 1 of 4')).toBeInTheDocument();
  });

  it('narrows the table to disabled features when the status filter changes', async () => {
    installRequest();

    renderPage();

    expect(await screen.findByText('vehicle_command_enabled')).toBeInTheDocument();

    const filter = screen.getByRole('combobox', { name: 'Filter by status' }) as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: 'disabled' } });

    // Only the two disabled features remain visible.
    expect(screen.getByText('ludicrous_mode')).toBeInTheDocument();
    expect(screen.getByText('sentry_upgrade')).toBeInTheDocument();
    expect(screen.queryByText('vehicle_command_enabled')).toBeNull();
    expect(screen.queryByText('charge_on_solar')).toBeNull();
    expect(screen.getByText('Showing 2 of 4')).toBeInTheDocument();
  });

  it('shows every section empty state and truthful zero KPIs for an empty payload', async () => {
    installRequest({ envelope: makeEnvelope({}, null) });

    renderPage();

    const region = kpiRegion();
    // An empty payload is a KNOWN 0 (the fetch succeeded) — not an em-dash.
    await waitFor(() => expect(within(region).getByText('0%')).toBeInTheDocument());
    expect(within(region).getAllByText('0')).toHaveLength(3);
    expect(within(region).queryByText('—')).toBeNull();

    // Each panel owns its empty copy.
    expect(screen.getByText('No feature data to summarise yet.')).toBeInTheDocument();
    expect(screen.getByText('No feature composition to chart yet.')).toBeInTheDocument();
    expect(
      screen.getByText('No feature config data yet. Click Refresh to fetch from Tesla.'),
    ).toBeInTheDocument();

    // A null timestamp reads as "never synced".
    expect(screen.getByText('Not synced yet')).toBeInTheDocument();
  });

  it('surfaces QueryError panels AND em-dash KPIs (no fabricated 0s) when the fetch fails with no data', async () => {
    installRequest({ getErrors: true });

    renderPage();

    // All three data panels degrade to the actionable network error state.
    expect(await screen.findAllByText("Can't reach server")).toHaveLength(3);

    // Truthfulness guard: the KPI band must NOT invent "0 features" — every
    // value collapses to an em-dash while the labels stay put.
    const region = kpiRegion();
    expect(within(region).getByText('Total Features')).toBeInTheDocument();
    expect(within(region).getAllByText('—')).toHaveLength(4);
    expect(within(region).queryByText('0')).toBeNull();
    expect(within(region).queryByText('0%')).toBeNull();

    // Recovery affordance stays available.
    expect(getRefreshButton()).toBeInTheDocument();
  });

  it('POSTs the refresh endpoint and disables the control while the mutation is in flight', async () => {
    installRequest({ hangRefresh: true });

    renderPage();

    // Wait for the first load so the Refresh button is interactive.
    await screen.findByText('vehicle_command_enabled');

    const refresh = getRefreshButton();
    expect(refresh).not.toBeDisabled();

    fireEvent.click(refresh);

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        REFRESH_PATH,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    // The still-pending mutation keeps the button disabled.
    await waitFor(() => expect(getRefreshButton()).toBeDisabled());
  });

  it('keeps the last-good rows visible when a background refetch errors', async () => {
    // First GET succeeds; the refresh-triggered refetch (2nd GET) rejects.
    const handle = installRequest({
      getSequence: [makeEnvelope(SAMPLE), new Error('refetch failed')],
      refreshResult: makeEnvelope(SAMPLE),
    });

    renderPage();

    await screen.findByText('vehicle_command_enabled');

    fireEvent.click(getRefreshButton());

    // The refresh POST succeeds and invalidates → a second GET fires and fails.
    await waitFor(() => expect(handle.getCallCount()).toBe(2));

    // Because stale data is still on hand, the page must NOT blank the panels:
    // the rows stay and no error panel is shown.
    expect(screen.getByText('vehicle_command_enabled')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).toBeNull();
    // KPIs keep their truthful last-good values (no em-dash degradation).
    expect(within(kpiRegion()).getByText('4')).toBeInTheDocument();
  });

  it('is accessible: labelled regions, an image-role chart, and named controls', async () => {
    installRequest();

    renderPage();

    await screen.findByText('vehicle_command_enabled');

    expect(screen.getByRole('region', { name: 'Feature summary metrics' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Feature overview' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Enabled versus disabled feature counts/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search features' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeInTheDocument();
    expect(getRefreshButton()).toBeInTheDocument();
  });
});
