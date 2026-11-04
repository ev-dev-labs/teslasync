/**
 * ExplorePage — behaviour + hardening coverage (co-located).
 *
 * ExplorePage default-exports a single orchestrator that composes a set of
 * internal, non-exported sub-components (KPI band, SectionAnchorStrip,
 * SectionBand, FeatureCard, Highlight, EmptyResult). We
 * therefore exercise every facet through the public page:
 *
 *   - Page shell: PageContainer h1 + interpolated subtitle, document-title
 *     side effect, and the search input's accessible name.
 *   - KPI overview band: the four derived counters (features / categories /
 *     showing / vehicles) are asserted against the real featureCatalog so the
 *     numbers can never silently drift, and "showing" tracks the live filter
 *     while "features"/"categories" stay stable.
 *   - Results: every visible section renders as a landmark band with a heading,
 *     a count badge, and one <li> per card; the category filter mirrors the
 *     template-gallery controls and scopes results via the URL.
 *   - Filtering: URL-driven (?q=) round-trip, match highlighting (single- and
 *     multi-token <mark> wrapping), and the empty state with a "did you mean"
 *     Levenshtein suggestion that navigates + clears on pick.
 *   - Visibility gates: minVehicles (Compare Vehicles) and requiresAuth
 *     (2FA / Sessions / My Activity) mirror the sidebar, plus the
 *     vehicles-undefined null-safety path.
 *   - a11y / keyboard: unclaimed "/" focuses search outside entry/overlays, and
 *     icon-only KPI/card glyphs are aria-hidden with visible text labels.
 *
 * Network is never touched: useVehicles / useAuthMode / usePageTitle are
 * stubbed and i18n is stubbed to the English fallback with {{placeholder}}
 * interpolation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ExplorePage from './ExplorePage';
import { buildFeatureCatalog, filterFeatureCatalog } from '../featureCatalog';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { resetProductPreferences, updateProductPreferences } from '@/lib/productPreferences';

// ── Hoisted, per-test controllable gating state ──────────────────────
const state = vi.hoisted(() => ({
  vehicles: [{ id: 1 }, { id: 2 }] as Array<{ id: number }> | undefined,
  forwardAuth: true,
  authResolved: true,
  authError: null as Error | null,
  authFetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  authRetry: vi.fn(),
  vehicleRetry: vi.fn(),
  translations: {} as Record<string, string>,
  vehicleError: null as Error | null,
  vehiclePending: false,
  vehicleFetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  vehicleUpdatedAt: 0,
  locale: 'en-US',
  timezone: 'America/Los_Angeles',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: state.locale },
    t: (_key: string, arg2?: unknown, arg3?: unknown) => {
      const template = state.translations[_key] ?? (typeof arg2 === 'string' ? arg2 : _key);
      const params =
        arg3 && typeof arg3 === 'object'
          ? (arg3 as Record<string, unknown>)
          : arg2 && typeof arg2 === 'object'
            ? (arg2 as Record<string, unknown>)
            : undefined;
      if (!params) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(params[k] ?? ''));
    },
  }),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({
    data: state.vehicles,
    error: state.vehicleError,
    isError: state.vehicleError != null,
    refetch: state.vehicleRetry,
    isPending: state.vehiclePending,
    fetchStatus: state.vehicleFetchStatus,
    isFetching: state.vehicleFetchStatus === 'fetching',
    dataUpdatedAt: state.vehicleUpdatedAt,
  }),
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      unit_of_length: 'km',
      unit_of_temp: 'C',
      unit_of_pressure: 'bar',
      decimal_precision: 2,
      currency_symbol: '$',
      locale: state.locale,
      tz_display_default: 'user',
      timezone_user: state.timezone,
    },
    locale: state.locale,
    settingsUnavailable: false,
  }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: undefined }),
}));
vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});
vi.mock('@/api/hooks/useAuthMode', () => ({
  useAuthMode: () => ({
    data: state.authResolved ? { mode: state.forwardAuth ? 'forward_auth' : 'open' } : undefined,
    error: state.authError,
    isError: state.authError != null,
    isPending: !state.authResolved,
    fetchStatus: state.authFetchStatus,
    isFetching: state.authFetchStatus === 'fetching',
    refetch: state.authRetry,
  }),
}));
vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
}));

// ── Catalog facts derived from the real data layer (no magic numbers) ─
const ALL = buildFeatureCatalog();
const ALL_COUNT = ALL.length;
const CATEGORY_COUNT = new Set(ALL.map((e) => e.section)).size;

function renderPage(initial = '/explore') {
  let loc = { pathname: '', search: '' };
  function LocationProbe() {
    const l = useLocation();
    loc = { pathname: l.pathname, search: l.search };
    return null;
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <ExplorePage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const utils = render(tree());
  return { ...utils, getLocation: () => loc, rerenderPage: () => utils.rerender(tree()) };
}

/** Read the real brief's formatted value without depending on typography markup. */
function kpiValue(label: string): string {
  const region = screen.getByRole('region', { name: 'Feature overview' });
  const labelNode = within(region).getByText(label);
  const metric = labelNode.closest('[data-operational-metric]');
  return metric?.querySelector('[data-operational-value]')?.textContent?.trim() ?? '';
}

/**
 * Face-value disclosure: an unknown metric leaves the brief face entirely —
 * no tile, no label, no em-dash placeholder.
 */
function expectVehiclesOmittedFromFace(overview: HTMLElement) {
  expect(overview.querySelector('[data-operational-metric="vehicles"]')).not.toBeInTheDocument();
  expect(within(overview).queryByText('Vehicles')).not.toBeInTheDocument();
}

/** Open the Review-details drawer and return the dialog. */
function openReviewDrawer(overview: HTMLElement): HTMLElement {
  fireEvent.click(within(overview).getByRole('button', { name: 'Review details' }));
  return screen.getByRole('dialog', { name: 'Feature overview details' });
}

function closeReviewDrawer(drawer: HTMLElement) {
  const close = within(drawer).getAllByRole('button', { name: 'Close' });
  fireEvent.click(close[close.length - 1]);
  expect(screen.queryByRole('dialog', { name: 'Feature overview details' })).not.toBeInTheDocument();
}

/**
 * The drawer counts omitted metrics instead of rendering empty tiles.
 * (The i18n stub does not pluralize, so the singular also renders "fields".)
 */
function expectHiddenFieldCount(drawer: HTMLElement, count: number) {
  expect(within(drawer).getByText(`${count} empty fields are hidden.`)).toBeInTheDocument();
}

beforeEach(() => {
  resetProductPreferences();
  state.vehicles = [{ id: 1 }, { id: 2 }];
  state.forwardAuth = true;
  state.authResolved = true;
  state.authError = null;
  state.authFetchStatus = 'idle';
  state.authRetry.mockClear();
  state.vehicleRetry.mockClear();
  state.translations = {};
  state.vehicleError = null;
  state.vehiclePending = false;
  state.vehicleFetchStatus = 'idle';
  state.vehicleUpdatedAt = 0;
  state.locale = 'en-US';
  state.timezone = 'America/Los_Angeles';
  vi.mocked(useOperationalMetrics).mockClear();
  vi.mocked(usePageTitle).mockClear();
  // jsdom doesn't lay out, so scrollIntoView is a no-op stub.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => cleanup());

describe('ExplorePage — shell', () => {
  it('renders the page title, interpolated subtitle, search box, and sets the document title', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Explore features' }),
    ).toBeInTheDocument();
    // Unfiltered subtitle interpolates the total count.
    expect(
      screen.getByText(`Every feature in TeslaSync — ${ALL_COUNT} in total.`),
    ).toBeInTheDocument();
    const heading = screen.getByRole('heading', { level: 1, name: 'Explore features' });
    const header = heading.closest('[data-role="page-header"]');
    expect(header).toHaveTextContent(`Every feature in TeslaSync — ${ALL_COUNT} in total.`);
    expect(heading).toHaveAttribute('data-route-focus-target', 'true');
    // Search input is reachable by its accessible name.
    expect(
      screen.getByRole('searchbox', { name: 'Filter features' }),
    ).toBeInTheDocument();
    expect(vi.mocked(usePageTitle)).toHaveBeenCalledWith('Explore features');
  });

  it('derives the four KPI counters from the visible catalog', () => {
    renderPage();
    expect(kpiValue('Features')).toBe(String(ALL_COUNT));
    expect(kpiValue('Categories')).toBe(String(CATEGORY_COUNT));
    expect(kpiValue('Showing')).toBe(String(ALL_COUNT));
    expect(kpiValue('Vehicles')).toBe('2');
  });
});

describe('ExplorePage — operational evidence', () => {
  it.each(['fetching', 'paused', 'idle'] as const)(
    'keeps unresolved authentication conservative and independent while %s',
    fetchStatus => {
      state.authResolved = false;
      state.authFetchStatus = fetchStatus;
      const { rerenderPage } = renderPage();
      const auth = screen.getByTestId('explore-auth-source');
      expect(within(auth).getByRole('status')).toHaveTextContent(
        fetchStatus === 'fetching' ? 'Loading' : fetchStatus === 'paused' ? 'Refresh paused' : 'Pending',
      );
      expect(auth).toHaveTextContent('No requested source has returned usable data yet.');
      for (const entry of ALL.filter(entry => entry.requiresAuth)) {
        expect(screen.queryByTestId(`explore-card-${entry.to}`)).not.toBeInTheDocument();
        expect(auth).toHaveTextContent(entry.label);
      }
      expect(kpiValue('Vehicles')).toBe('2');
      expect(screen.getByTestId('explore-card-/charging')).toBeInTheDocument();
      if (fetchStatus === 'paused') {
        fireEvent.click(within(auth).getByRole('button', { name: 'Retry' }));
        expect(state.authRetry).toHaveBeenCalledOnce();
        expect(state.vehicleRetry).not.toHaveBeenCalled();
      }
      state.authResolved = true;
      state.authFetchStatus = 'idle';
      rerenderPage();
      for (const entry of ALL.filter(entry => entry.requiresAuth)) {
        expect(screen.getByTestId(`explore-card-${entry.to}`)).toBeInTheDocument();
      }
      expect(auth).toBeEmptyDOMElement();
    },
  );

  it('keeps paused fleet without data unknown and retries only the fleet source', () => {
    state.vehicles = undefined;
    state.vehiclePending = true;
    state.vehicleFetchStatus = 'paused';
    const { rerenderPage } = renderPage();
    const overview = screen.getByTestId('explore-operational-brief');
    expectVehiclesOmittedFromFace(overview);
    const pausedDrawer = openReviewDrawer(overview);
    expectHiddenFieldCount(pausedDrawer, 1);
    closeReviewDrawer(pausedDrawer);
    expect(screen.getByTestId('explore-operational-brief')).toHaveTextContent('Refresh paused');
    fireEvent.click(screen.getByRole('button', { name: 'Retry · Vehicles' }));
    expect(state.vehicleRetry).toHaveBeenCalledOnce();
    expect(state.authRetry).not.toHaveBeenCalled();
    expect(screen.getByTestId(`explore-card-${ALL.find(entry => entry.requiresAuth)!.to}`)).toBeInTheDocument();
    state.vehicles = [];
    state.vehiclePending = false;
    state.vehicleFetchStatus = 'idle';
    rerenderPage();
    expect(kpiValue('Vehicles')).toBe('0');
    expect(screen.queryByRole('button', { name: 'Retry · Vehicles' })).not.toBeInTheDocument();
  });

  it('retains both sources through refresh failure and retries and recovers independently', () => {
    const { rerenderPage } = renderPage();
    const before = screen.getAllByTestId(/^explore-card-/).map(link => link.getAttribute('href'));
    state.authError = new Error('Auth refresh failed');
    state.vehicleError = new Error('Fleet refresh failed');
    rerenderPage();
    const auth = screen.getByTestId('explore-auth-source');
    expect(within(auth).getByTestId('stale-refresh-warning')).toHaveTextContent(
      'Previously loaded data remains visible while affected sources recover.',
    );
    expect(screen.getAllByTestId(/^explore-card-/).map(link => link.getAttribute('href'))).toEqual(before);
    fireEvent.click(within(auth).getByRole('button', { name: 'Refresh' }));
    expect(state.authRetry).toHaveBeenCalledOnce();
    expect(state.vehicleRetry).not.toHaveBeenCalled();
    state.authError = null;
    rerenderPage();
    expect(auth).toBeEmptyDOMElement();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(state.vehicleRetry).toHaveBeenCalledOnce();
    state.vehicleError = null;
    rerenderPage();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(kpiValue('Vehicles')).toBe('2');
  });

  it('offers auth-only recovery after an initial failure without erasing fleet or navigation', () => {
    state.authResolved = false;
    state.authError = new Error('Auth unavailable');
    const { rerenderPage } = renderPage();
    const auth = screen.getByTestId('explore-auth-source');
    expect(auth).toHaveTextContent('Failed');
    fireEvent.click(within(auth).getByRole('button', { name: 'Retry' }));
    expect(state.authRetry).toHaveBeenCalledOnce();
    expect(state.vehicleRetry).not.toHaveBeenCalled();
    expect(kpiValue('Vehicles')).toBe('2');
    expect(screen.getByRole('searchbox')).toBeEnabled();
    state.authResolved = true;
    state.authError = null;
    state.forwardAuth = false;
    rerenderPage();
    expect(auth).toHaveTextContent('requires authentication mode');
    expect(within(auth).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(kpiValue('Vehicles')).toBe('2');
  });

  it('passes only the original raw counts through the real bridge and preserves count semantics', () => {
    renderPage('/explore?q=powershare&section=home');
    const calls = vi.mocked(useOperationalMetrics).mock.calls;
    const rawMetrics = calls[calls.length - 1][0];
    expect(rawMetrics.map(metric => ({
      key: metric.occurrenceId, type: metric.metricId, raw: metric.rawValue,
    }))).toEqual([
      { key: 'features', type: 'count', raw: ALL_COUNT },
      { key: 'categories', type: 'count', raw: CATEGORY_COUNT },
      { key: 'showing', type: 'count', raw: 0 },
      { key: 'vehicles', type: 'count', raw: 2 },
    ]);
    const overview = screen.getByTestId('explore-operational-brief');
    expect(overview).toHaveAttribute('data-operational-brief');
    expect(overview.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    for (const metric of overview.querySelectorAll('[data-operational-metric]')) {
      expect(metric).toHaveAttribute('data-value-state', 'value');
    }
    expect(kpiValue('Showing')).toBe('0');
    expect(screen.getByTestId('explore-empty')).toBeInTheDocument();
  });

  it('keeps unknown fleet distinct from a successful empty fleet without hiding independent counts', () => {
    state.vehicles = undefined;
    state.vehiclePending = true;
    state.vehicleFetchStatus = 'fetching';
    const { rerenderPage } = renderPage();
    const overview = screen.getByTestId('explore-operational-brief');
    expectVehiclesOmittedFromFace(overview);
    const unknownDrawer = openReviewDrawer(overview);
    expectHiddenFieldCount(unknownDrawer, 1);
    expect(within(unknownDrawer).getAllByText('Fleet pending').length).toBeGreaterThan(0);
    closeReviewDrawer(unknownDrawer);
    expect(kpiValue('Features')).toBe(String(ALL_COUNT - 1));
    expect(within(overview).getAllByText('Fleet pending').length).toBeGreaterThan(0);
    expect(overview).not.toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('searchbox')).toBeEnabled();
    expect(screen.getByTestId('explore-card-/charging')).toBeInTheDocument();

    state.vehicles = [];
    state.vehiclePending = false;
    state.vehicleFetchStatus = 'idle';
    rerenderPage();
    expect(overview.querySelector('[data-operational-metric="vehicles"]'))
      .toHaveAttribute('data-value-state', 'value');
    expect(kpiValue('Vehicles')).toBe('0');
    expect(within(overview).queryByText('Catalog ready')).not.toBeInTheDocument();
    const readyDrawer = openReviewDrawer(overview);
    expect(within(readyDrawer).getAllByText('Catalog ready').length).toBeGreaterThan(0);
    closeReviewDrawer(readyDrawer);
  });

  it('formats fleet counts with saved locale while retaining integer raw values', () => {
    state.locale = 'de-DE';
    state.vehicles = Array.from({ length: 1200 }, (_, id) => ({ id }));
    renderPage();
    expect(kpiValue('Vehicles')).toBe('1.200');
    const calls = vi.mocked(useOperationalMetrics).mock.calls;
    expect(calls[calls.length - 1][0].find(metric => metric.occurrenceId === 'vehicles'))
      .toMatchObject({ metricId: 'count', rawValue: 1200 });
  });

  it('opens the built-in details drawer with complete filter, scope and source context, then closes it', () => {
    state.vehicleUpdatedAt = Date.parse('2026-10-06T22:00:00Z');
    const freshness = 'Fleet last loaded: Oct 6, 2026, 03:00 PM';
    const { getLocation } = renderPage('/explore?q=powershare&section=charging');
    const overview = screen.getByTestId('explore-operational-brief');
    // Face-value disclosure: scope and freshness context live in the drawer, not on the face.
    expect(within(overview).queryByText('Visible catalog and returned fleet list · no date window')).not.toBeInTheDocument();
    expect(within(overview).queryByText(freshness)).not.toBeInTheDocument();
    const review = within(overview).getByRole('button', { name: 'Review details' });
    review.focus();
    fireEvent.click(review);
    const drawer = screen.getByRole('dialog', { name: 'Feature overview details' });
    expect(within(drawer).getByText('Operational metrics')).toBeInTheDocument();
    expect(within(drawer).getByText('matching filter')).toBeInTheDocument();
    expect(within(drawer).getByText('Search: powershare · Category: charging')).toBeInTheDocument();
    expect(within(drawer).getByText('Visible catalog and returned fleet list · no date window', { selector: '[data-drawer-header] span' })).toBeInTheDocument();
    expect(within(drawer).getByText(freshness, { selector: '[data-drawer-header] span' })).toBeInTheDocument();
    expect(within(drawer).getByText('Visible catalog entries after vehicle and authentication gates; unaffected by search or category filters.'))
      .toBeInTheDocument();
    expect(within(drawer).getByText('Distinct categories in the visible catalog before search and category filters.'))
      .toBeInTheDocument();
    expect(within(drawer).getByText('Vehicles in the returned fleet list, not the workspace vehicle selection or a historical total.'))
      .toBeInTheDocument();
    expect(within(drawer).getByText('Local navigation catalog, authentication mode, and the vehicles query snapshot. Catalog counts are derived, not vehicle telemetry.'))
      .toBeInTheDocument();
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    expect(getLocation().search).toBe('?q=powershare&section=charging');
    const close = within(drawer).getAllByRole('button', { name: 'Close' });
    fireEvent.click(close[close.length - 1]);
    expect(screen.queryByRole('dialog', { name: 'Feature overview details' })).not.toBeInTheDocument();
    expect(review).toHaveFocus();
    expect(screen.getByTestId('explore-card-/powershare')).toBeInTheDocument();
  });

  it('reformats the retained query load time when display preferences change without changing raw evidence', () => {
    const timestamp = Date.parse('2026-10-06T22:00:00Z');
    state.vehicleUpdatedAt = timestamp;
    const { rerenderPage } = renderPage();
    const overview = screen.getByTestId('explore-operational-brief');
    expect(within(overview).queryByText('Fleet last loaded: Oct 6, 2026, 03:00 PM')).not.toBeInTheDocument();
    const initialDrawer = openReviewDrawer(overview);
    expect(within(initialDrawer).getAllByText('Fleet last loaded: Oct 6, 2026, 03:00 PM').length)
      .toBeGreaterThan(0);
    closeReviewDrawer(initialDrawer);

    state.locale = 'de-DE';
    state.timezone = 'Europe/Berlin';
    state.vehicleError = new Error('Fleet refresh failed');
    rerenderPage();
    const retainedDrawer = openReviewDrawer(overview);
    expect(within(retainedDrawer).getAllByText('Fleet last loaded: 7. Okt. 2026, 00:00').length)
      .toBeGreaterThan(0);
    expect(within(retainedDrawer).getAllByText('Retained fleet').length).toBeGreaterThan(0);
    closeReviewDrawer(retainedDrawer);
    expect(state.vehicleUpdatedAt).toBe(timestamp);
    expect(kpiValue('Vehicles')).toBe('2');
    expect(screen.getByTestId('explore-card-/vehicle-comparison')).toBeInTheDocument();
  });

  it('keeps unknown load time distinct from a successful empty fleet and never formats an epoch fallback', () => {
    state.vehicles = undefined;
    state.vehiclePending = true;
    state.vehicleFetchStatus = 'fetching';
    const { rerenderPage } = renderPage();
    const overview = screen.getByTestId('explore-operational-brief');
    expect(within(overview).queryByText('Fleet load time not supplied')).not.toBeInTheDocument();
    expect(overview).not.toHaveTextContent('Fleet last loaded:');
    expectVehiclesOmittedFromFace(overview);
    const unknownDrawer = openReviewDrawer(overview);
    expect(within(unknownDrawer).getAllByText('Fleet load time not supplied').length).toBeGreaterThan(0);
    expectHiddenFieldCount(unknownDrawer, 1);
    closeReviewDrawer(unknownDrawer);

    state.vehicles = [];
    state.vehiclePending = false;
    state.vehicleFetchStatus = 'idle';
    rerenderPage();
    expect(within(overview).queryByText('Fleet load time not supplied')).not.toBeInTheDocument();
    const emptyDrawer = openReviewDrawer(overview);
    expect(within(emptyDrawer).getAllByText('Fleet load time not supplied').length).toBeGreaterThan(0);
    closeReviewDrawer(emptyDrawer);
    expect(overview).not.toHaveTextContent('Fleet last loaded:');
    expect(kpiValue('Vehicles')).toBe('0');
  });

  it.each(['error', 'paused'] as const)('labels retained fleet evidence honestly during %s while preserving eligibility', mode => {
    const { rerenderPage, getLocation } = renderPage('/explore?section=vehicles');
    const before = screen.getAllByTestId(/^explore-card-/).map(link => link.getAttribute('href'));
    if (mode === 'error') state.vehicleError = new Error('Refresh unavailable');
    else state.vehicleFetchStatus = 'paused';
    rerenderPage();
    const overview = screen.getByTestId('explore-operational-brief');
    if (mode === 'error') {
      // Retained status is drawer context; the face keeps only live values.
      expect(within(overview).queryByText('Retained fleet')).not.toBeInTheDocument();
    } else {
      expect(within(overview).getAllByText('Refresh paused').length).toBeGreaterThan(0);
    }
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(kpiValue('Vehicles')).toBe('2');
    expect(getLocation().search).toBe('?section=vehicles');
    expect(screen.getAllByTestId(/^explore-card-/).map(link => link.getAttribute('href'))).toEqual(before);
    fireEvent.click(within(overview).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Feature overview details' });
    expect(within(drawer).getAllByText(mode === 'error' ? 'Retained fleet' : 'Refresh paused').length)
      .toBeGreaterThan(0);
  });

  it('retries a fatal initial fleet failure and recovers without replacing independent discovery results', () => {
    state.vehicles = undefined;
    state.vehicleError = new Error('Fleet unavailable');
    const { rerenderPage, getLocation } = renderPage('/explore?q=powershare');
    const overview = screen.getByTestId('explore-operational-brief');
    expect(within(overview).getAllByText('Fleet unavailable').length).toBeGreaterThan(0);
    expectVehiclesOmittedFromFace(overview);
    const fatalDrawer = openReviewDrawer(overview);
    expectHiddenFieldCount(fatalDrawer, 1);
    expect(within(fatalDrawer).getAllByText('Fleet unavailable').length).toBeGreaterThan(0);
    closeReviewDrawer(fatalDrawer);
    expect(kpiValue('Showing')).toBe('1');
    expect(screen.getByTestId('explore-card-/powershare')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry · Vehicles' }));
    expect(state.vehicleRetry).toHaveBeenCalledOnce();
    expect(state.authRetry).not.toHaveBeenCalled();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();

    state.vehicleError = null;
    state.vehiclePending = true;
    state.vehicleFetchStatus = 'fetching';
    rerenderPage();
    expectVehiclesOmittedFromFace(overview);
    const pendingDrawer = openReviewDrawer(overview);
    expectHiddenFieldCount(pendingDrawer, 1);
    closeReviewDrawer(pendingDrawer);
    expect(overview).toHaveTextContent('Fleet pending');
    expect(screen.queryByRole('button', { name: 'Retry · Vehicles' })).not.toBeInTheDocument();
    expect(screen.getByTestId('explore-card-/powershare')).toBeInTheDocument();

    state.vehicles = [];
    state.vehiclePending = false;
    state.vehicleFetchStatus = 'idle';
    rerenderPage();
    expect(kpiValue('Vehicles')).toBe('0');
    expect(overview).not.toHaveTextContent('Catalog ready');
    const recoveredDrawer = openReviewDrawer(overview);
    expect(within(recoveredDrawer).getAllByText('Catalog ready').length).toBeGreaterThan(0);
    closeReviewDrawer(recoveredDrawer);
    expect(screen.queryByRole('button', { name: 'Retry · Vehicles' })).not.toBeInTheDocument();
    expect(screen.getByTestId('explore-card-/powershare')).toBeInTheDocument();
    expect(getLocation().search).toBe('?q=powershare');
  });

  it('keeps retained counts during an active refresh and closes the actual details drawer with Escape', () => {
    state.vehicleFetchStatus = 'fetching';
    const { getLocation } = renderPage('/explore?q=powershare');
    const overview = screen.getByTestId('explore-operational-brief');
    expect(within(overview).queryByText('Fleet refreshing')).not.toBeInTheDocument();
    expect(kpiValue('Vehicles')).toBe('2');
    expect(kpiValue('Showing')).toBe('1');
    const review = within(overview).getByRole('button', { name: 'Review details' });
    review.focus();
    fireEvent.click(review);
    const drawer = screen.getByRole('dialog', { name: 'Feature overview details' });
    expect(within(drawer).getAllByText('Fleet refreshing').length).toBeGreaterThan(0);
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Feature overview details' })).not.toBeInTheDocument();
    expect(review).toHaveFocus();
    expect(getLocation().search).toBe('?q=powershare');
  });
});

describe('ExplorePage — results layout', () => {
  it('renders each visible section as a landmark band with a heading and one <li> per card', () => {
    renderPage();

    // The Home band is present for everyone.
    expect(screen.getByRole('heading', { level: 2, name: 'Home' })).toBeInTheDocument();
    const homeList = screen.getByTestId('explore-section-home');
    // Home includes the decision inbox + the activity timeline alongside the
    // five established entries.
    expect(within(homeList).getAllByRole('listitem')).toHaveLength(7);

    // A representative card + its description render.
    expect(screen.getByTestId('explore-card-/')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText(/Your daily summary/i)).toBeInTheDocument();
  });

  it('renders rectangular category buttons and scopes results via a shareable URL', () => {
    const { getLocation } = renderPage();
    const strip = screen.getByTestId('explore-anchor-strip');
    const buttons = within(strip).getAllByRole('button');
    expect(buttons).toHaveLength(CATEGORY_COUNT + 1);
    expect(within(strip).getByRole('button', { name: `All(${ALL_COUNT})` })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(strip).getByRole('button', { name: 'Home(7)' }));
    expect(getLocation().search).toBe('?section=home');
    expect(screen.getByTestId('explore-section-home')).toBeInTheDocument();
    expect(screen.queryByTestId('explore-section-charging')).not.toBeInTheDocument();
    expect(kpiValue('Showing')).toBe('7');
  });
});

describe('ExplorePage — filtering', () => {
  it('finds visible translated labels and section names without losing English matches', () => {
    const charging = ALL.find((entry) => entry.to === '/charging')!;
    state.translations[charging.labelKey] = 'Recarga';
    state.translations[charging.sectionKey] = 'Carga eléctrica';
    const { getLocation } = renderPage();
    const input = screen.getByTestId('explore-search');

    fireEvent.change(input, { target: { value: 'recarga' } });
    expect(screen.getByTestId('explore-card-/charging')).toHaveTextContent('Recarga');
    expect(getLocation().search).toBe('?q=recarga');

    fireEvent.change(input, { target: { value: 'carga eléctrica' } });
    expect(screen.getByRole('heading', { level: 2, name: 'Carga eléctrica' })).toBeInTheDocument();
    expect(screen.getByTestId('explore-card-/charging')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: charging.label } });
    expect(screen.getByTestId('explore-card-/charging')).toHaveTextContent('Recarga');
  });

  it('filters cards, reflects the query in the URL, and updates the "Showing" KPI only', () => {
    const { getLocation } = renderPage();
    const input = screen.getByTestId('explore-search') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'powershare' } });

    expect(screen.getByText(/match "powershare"/i)).toBeInTheDocument();
    expect(screen.getByTestId('explore-card-/powershare')).toBeInTheDocument();
    // An unrelated card is gone.
    expect(screen.queryByTestId('explore-card-/')).toBeNull();
    // Query pushed into the URL (replace).
    expect(getLocation().search).toBe('?q=powershare');
    // "Showing" tracks the filter; "Features"/"Categories" stay stable.
    expect(kpiValue('Showing')).toBe('1');
    expect(kpiValue('Features')).toBe(String(ALL_COUNT));
    expect(kpiValue('Categories')).toBe(String(CATEGORY_COUNT));
  });

  it('hydrates the filter from an initial ?q= in the URL', () => {
    renderPage('/explore?q=powershare');
    const input = screen.getByTestId('explore-search') as HTMLInputElement;
    expect(input.value).toBe('powershare');
    expect(screen.getByTestId('explore-card-/powershare')).toBeInTheDocument();
    expect(kpiValue('Showing')).toBe('1');
  });

  it('wraps a single matched token in <mark> without touching surrounding markup', () => {
    renderPage('/explore?q=powershare');
    const mark = screen.getByText('Powershare');
    expect(mark.tagName).toBe('MARK');
  });

  it('highlights every token of a multi-word query independently', () => {
    renderPage('/explore?q=battery%20health');
    const card = screen.getByTestId('explore-card-/battery');
    const marks = Array.from(card.querySelectorAll('mark')).map((m) =>
      (m.textContent ?? '').toLowerCase(),
    );
    expect(marks.length).toBeGreaterThanOrEqual(2);
    expect(marks).toContain('battery');
    expect(marks).toContain('health');
  });

  it('escapes regex metacharacters in the query so highlighting never throws', () => {
    // "(V2H)" appears verbatim in the Powershare description; a naive
    // RegExp(query) would blow up on the unbalanced parens.
    renderPage('/explore?q=(v2h)');
    const card = screen.getByTestId('explore-card-/powershare');
    const mark = within(card).getByText('(V2H)');
    expect(mark.tagName).toBe('MARK');
  });
});

describe('ExplorePage — empty state', () => {
  it.each([
    { search: '?section=unknown-category&context=retained', query: 'No search filter', category: 'unknown-category' },
    { search: '?q=powershare&section=home&context=retained', query: 'powershare', category: 'Localized home' },
  ])('explains a category miss for $search without changing URL state until explicitly cleared', ({ search, query, category }) => {
    const home = ALL.find(entry => entry.section === 'Home')!;
    state.translations[home.sectionKey] = 'Localized home';
    state.translations['explore.subtitle.category'] = '{{matches}} localized category matches';
    state.translations['explore.brief.filterContext'] = 'Localized search: {{query}}; category: {{category}}';
    const { getLocation } = renderPage(`/explore${search}`);
    const empty = screen.getByTestId('explore-empty');

    expect(within(empty).getByRole('heading', { name: '0 localized category matches' })).toBeInTheDocument();
    expect(within(empty).getByText(`Localized search: ${query}; category: ${category}`)).toBeInTheDocument();
    expect(within(empty).queryByText(/^No features match "/)).not.toBeInTheDocument();
    expect(getLocation().search).toBe(search);

    fireEvent.click(within(empty).getByRole('button', { name: /clear filter/i }));
    expect(getLocation().search).toBe('');
    expect(screen.getAllByTestId(/^explore-card-/)).toHaveLength(ALL_COUNT);
  });

  it('shows a self-contained empty state (no anchor strip) and clears via the button', () => {
    const { getLocation } = renderPage('/explore?q=zzznotarealthing');

    expect(screen.getByTestId('explore-empty')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /No features match/i }),
    ).toBeInTheDocument();
    // The anchor strip is suppressed when there are zero groups.
    expect(screen.queryByTestId('explore-anchor-strip')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /clear filter/i }));
    expect(screen.getByTestId('explore-card-/')).toBeInTheDocument();
    expect(getLocation().search).toBe('');
  });

  it('offers a "did you mean" suggestion for a near-miss and navigates + clears on pick', () => {
    const { getLocation } = renderPage('/explore?q=batttery');

    const suggestions = screen.getByTestId('explore-empty-suggestions');
    expect(within(suggestions).getAllByRole('button').length).toBeGreaterThan(0);

    // The Levenshtein engine surfaces /battery as the closest visible route.
    const batteryBtn = within(suggestions).getByText('/battery').closest('button');
    expect(batteryBtn).not.toBeNull();

    fireEvent.click(batteryBtn as HTMLButtonElement);
    expect(getLocation().pathname).toBe('/battery');
    expect(getLocation().search).toBe('');
  });
});

describe('ExplorePage — navigation', () => {
  it('navigates on a plain left-click of a card', () => {
    const { getLocation } = renderPage();
    fireEvent.click(screen.getByTestId('explore-card-/'));
    expect(getLocation().pathname).toBe('/');
  });

  it('lets the browser handle cmd/ctrl-click (opens a new tab, no SPA navigation)', () => {
    const { getLocation } = renderPage();
    fireEvent.click(screen.getByTestId('explore-card-/'), { metaKey: true });
    expect(getLocation().pathname).toBe('/explore');
  });
});

describe('ExplorePage — visibility gates', () => {
  it('hides experiment cards and categories immediately while preserving normal discovery', () => {
    renderPage();
    expect(screen.getByTestId('explore-card-/experiments/vehicle-lab')).toBeInTheDocument();
    act(() => { updateProductPreferences({ showExperiments: false }); });
    expect(screen.queryByTestId('explore-card-/experiments/vehicle-lab')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Experiments', exact: true })).not.toBeInTheDocument();
    expect(screen.getByTestId('explore-card-/drives')).toBeInTheDocument();
    act(() => { updateProductPreferences({ showExperiments: true }); });
    expect(screen.getByTestId('explore-card-/experiments/vehicle-lab')).toBeInTheDocument();
  });

  it('translates the new experiment descriptions and searches their translated text', () => {
    state.translations['experiments.vehicleLab.description'] = 'Beschreibung Fahrzeuglabor';
    renderPage('/explore?q=Beschreibung');
    expect(screen.getByTestId('explore-card-/experiments/vehicle-lab')).toHaveTextContent('Beschreibung Fahrzeuglabor');
    expect(screen.queryByTestId('explore-card-/drives')).not.toBeInTheDocument();
  });

  it('hides minVehicles-gated cards below the threshold and reflects the fleet size', () => {
    state.vehicles = [{ id: 1 }];
    renderPage();

    expect(screen.queryByTestId('explore-card-/vehicle-comparison')).toBeNull();
    expect(kpiValue('Vehicles')).toBe('1');
    expect(kpiValue('Features')).toBe(String(ALL_COUNT - 1));
  });

  it('shows minVehicles-gated cards once the fleet is large enough', () => {
    renderPage(); // default: 2 vehicles
    expect(screen.getByTestId('explore-card-/vehicle-comparison')).toBeInTheDocument();
  });

  it('hides requiresAuth cards in open mode and shows them under forward-auth', () => {
    state.forwardAuth = false;
    const { unmount } = renderPage();
    expect(screen.queryByTestId('explore-card-/account/2fa')).toBeNull();
    expect(screen.queryByTestId('explore-card-/account/sessions')).toBeNull();
    expect(screen.queryByTestId('explore-card-/me/activity')).toBeNull();
    expect(kpiValue('Features')).toBe(String(ALL_COUNT - 3));
    unmount();

    state.forwardAuth = true;
    renderPage();
    expect(screen.getByTestId('explore-card-/account/2fa')).toBeInTheDocument();
  });

  it('is null-safe when the vehicles query has no data yet', () => {
    state.vehicles = undefined;
    renderPage();
    const overview = screen.getByTestId('explore-operational-brief');
    expectVehiclesOmittedFromFace(overview);
    const drawer = openReviewDrawer(overview);
    expectHiddenFieldCount(drawer, 1);
    closeReviewDrawer(drawer);
    expect(screen.queryByTestId('explore-card-/vehicle-comparison')).toBeNull();
  });
});

describe('ExplorePage — keyboard', () => {
  it('uses pressed filter buttons, not document tabs or arrow-driven selection', () => {
    const { getLocation } = renderPage('/explore?q=charging');
    const group = screen.getByRole('group', { name: 'Filter features by category' });
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    const buttons = within(group).getAllByRole('button');
    expect(buttons.every(button => button.tabIndex === 0)).toBe(true);
    const before = getLocation().search;
    fireEvent.keyDown(buttons[0], { key: 'ArrowRight' });
    expect(getLocation().search).toBe(before);
    const charging = buttons.find(button => button.textContent?.startsWith('Charging'));
    expect(charging).toBeDefined();
    fireEvent.click(charging!);
    expect(getLocation().search).toContain('q=charging');
    expect(getLocation().search).toContain('section=charging');
    expect(charging).toHaveAttribute('aria-pressed', 'true');
    expect(charging).not.toHaveAttribute('aria-selected');
  });

  describe('ExplorePage — mounted preservation closure', () => {
    it('renders every eligible feature link in catalog order with its complete description and native destination', () => {
      renderPage();
      const links = screen.getAllByTestId(/^explore-card-/);
      expect(links.map(link => link.getAttribute('href'))).toEqual(ALL.map(entry => entry.to));
      for (const entry of ALL) {
        const link = screen.getByTestId(`explore-card-${entry.to}`);
        expect(link.tagName).toBe('A');
        expect(link).not.toHaveAttribute('role', 'button');
        expect(link).toHaveTextContent(entry.label);
        const description = within(link).getByText(entry.description);
        expect(description).toHaveClass('break-words');
        expect(description).not.toHaveClass('line-clamp-2');
      }
    });

    it('intersects query and category while preserving unrelated URL state and restoring query matches with All', () => {
      const { getLocation } = renderPage('/explore?q=charge&section=charging&context=retained');
      const expected = filterFeatureCatalog(ALL, 'charge');
      const inCategory = expected.filter(entry => entry.section === 'Charging');
      expect(expected.some(entry => entry.section !== 'Charging')).toBe(true);
      expect(screen.getAllByTestId(/^explore-card-/).map(link => link.getAttribute('href')))
        .toEqual(inCategory.map(entry => entry.to));

      const group = screen.getByRole('group', { name: 'Filter features by category' });
      fireEvent.click(within(group).getByRole('button', { name: /^All\(/ }));
      expect(new URLSearchParams(getLocation().search).get('section')).toBeNull();
      expect(new URLSearchParams(getLocation().search).get('q')).toBe('charge');
      expect(new URLSearchParams(getLocation().search).get('context')).toBe('retained');
      expect(screen.getAllByTestId(/^explore-card-/).map(link => link.getAttribute('href')))
        .toEqual(expected.map(entry => entry.to));

      fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
      expect(getLocation().search).toBe('?context=retained');
      expect(screen.getAllByTestId(/^explore-card-/)).toHaveLength(ALL_COUNT);
    });

    it('recovers an empty category intersection without treating the catalog or fleet as an empty source', () => {
      const { getLocation } = renderPage('/explore?q=powershare&section=home');
      expect(screen.getByTestId('explore-empty')).toBeInTheDocument();
      expect(kpiValue('Features')).toBe(String(ALL_COUNT));
      expect(kpiValue('Showing')).toBe('0');
      expect(kpiValue('Vehicles')).toBe('2');
      const group = screen.getByRole('group', { name: 'Filter features by category' });
      expect(within(group).getByRole('button', { name: 'Charging(1)' })).toBeInTheDocument();
      fireEvent.click(within(group).getByRole('button', { name: 'Charging(1)' }));
      expect(getLocation().search).toBe('?q=powershare&section=charging');
      expect(screen.queryByTestId('explore-empty')).not.toBeInTheDocument();
      expect(screen.getByTestId('explore-card-/powershare')).toBeInTheDocument();
    });

    it('keeps full long translated labels, stable category identity and complete descriptions in wrapping controls', () => {
      const charging = ALL.find(entry => entry.to === '/charging')!;
      const longSection = 'Charging category with a detailed localized explanation '.repeat(4);
      const longLabel = 'VeryLongUnbrokenLocalizedChargingFeatureLabel'.repeat(4);
      state.translations[charging.sectionKey] = longSection;
      state.translations[charging.labelKey] = longLabel;
      const { getLocation } = renderPage();
      const group = screen.getByRole('group', { name: 'Filter features by category' });
      const filter = within(group).getByRole('button', { name: new RegExp('^Charging category') });
      expect(filter).toHaveClass('h-auto', 'max-w-full', 'whitespace-normal');
      expect(within(filter).getByText(longSection.trim())).toHaveClass('break-words');
      fireEvent.click(filter);
      expect(getLocation().search).toBe('?section=charging');
      const heading = screen.getByRole('heading', { level: 2, name: longSection.trim() });
      expect(heading).toHaveClass('min-w-0', 'break-words');
      expect(heading).not.toHaveClass('truncate');
      const card = screen.getByTestId('explore-card-/charging');
      expect(within(card).getByText(longLabel)).toHaveClass('break-words');
      expect(card).toHaveAttribute('href', '/charging');
      expect(within(card).getByText(charging.description)).not.toHaveClass('line-clamp-2');
    });

    it('allows a long localized clear action to wrap while preserving empty-result recovery', () => {
      const clearLabel = 'Clear the feature search and selected category to see all available destinations '.repeat(3).trim();
      state.translations['explore.empty.clear'] = clearLabel;
      const { getLocation } = renderPage('/explore?q=zzznotarealthing&section=home');
      const clear = screen.getByRole('button', { name: clearLabel });
      expect(clear).toHaveClass('h-auto', 'whitespace-normal', 'max-w-full');
      expect(within(clear).getByText(clearLabel)).toHaveClass('break-words');
      fireEvent.click(clear, { detail: 0 });
      expect(getLocation().search).toBe('');
      expect(screen.getAllByTestId(/^explore-card-/)).toHaveLength(ALL_COUNT);
    });

    it('keeps every suggested destination readable within an adaptive action and clears scope on keyboard-generated navigation', () => {
      const { getLocation } = renderPage('/explore?q=batttery&section=home');
      const suggestions = screen.getByTestId('explore-empty-suggestions');
      const buttons = within(suggestions).getAllByRole('button');
      for (const button of buttons) {
        expect(button).toHaveClass('h-auto', 'max-w-full', 'whitespace-normal');
        const path = within(button).getByText(/^\//);
        expect(path).toHaveClass('break-all');
        expect(ALL.some(entry => entry.to === path.textContent)).toBe(true);
      }
      const battery = within(suggestions).getByText('/battery').closest('button')!;
      battery.focus();
      fireEvent.click(battery, { detail: 0 });
      expect(getLocation()).toEqual({ pathname: '/battery', search: '' });
    });

    it.each([
      { path: '/vehicle-comparison', query: 'vehicle-comparisno' },
      { path: '/account/sessions', query: 'account/sessinos' },
    ])('does not suggest gated $path through a near-match empty result', ({ path, query }) => {
      state.vehicles = [{ id: 1 }];
      state.forwardAuth = false;
      renderPage(`/explore?q=${encodeURIComponent(query)}`);
      expect(screen.getByTestId('explore-empty')).toBeInTheDocument();
      expect(screen.queryByTestId(`explore-card-${path}`)).not.toBeInTheDocument();
      const suggestions = screen.queryByTestId('explore-empty-suggestions');
      if (suggestions) expect(within(suggestions).queryByText(path)).not.toBeInTheDocument();
      expect(kpiValue('Vehicles')).toBe('1');
    });

    it.each(['paused', 'fetching', 'idle'] as const)(
      'keeps independent catalog navigation available with an unresolved %s vehicle source',
      fetchStatus => {
        state.vehicles = undefined;
        state.vehiclePending = true;
        state.vehicleFetchStatus = fetchStatus;
        const { rerenderPage } = renderPage();
        const overview = screen.getByTestId('explore-operational-brief');
        expectVehiclesOmittedFromFace(overview);
        const unresolvedDrawer = openReviewDrawer(overview);
        expectHiddenFieldCount(unresolvedDrawer, 1);
        closeReviewDrawer(unresolvedDrawer);
        expect(screen.queryByTestId('explore-empty')).not.toBeInTheDocument();
        expect(screen.getByRole('searchbox')).toBeInTheDocument();
        expect(screen.getByTestId('explore-card-/charging')).toBeInTheDocument();
        expect(screen.queryByTestId('explore-card-/vehicle-comparison')).not.toBeInTheDocument();

        state.vehicles = [];
        state.vehiclePending = false;
        state.vehicleFetchStatus = 'idle';
        rerenderPage();
        expect(kpiValue('Vehicles')).toBe('0');
        expect(screen.queryByTestId('explore-empty')).not.toBeInTheDocument();
        expect(screen.getByTestId('explore-card-/charging')).toBeInTheDocument();
      },
    );

    it('preserves selected filters and retained fleet eligibility across a refresh failure', () => {
      const { getLocation, rerenderPage } = renderPage('/explore?section=vehicles');
      const before = screen.getAllByTestId(/^explore-card-/).map(link => link.getAttribute('href'));
      expect(screen.getByTestId('explore-card-/vehicle-comparison')).toBeInTheDocument();
      state.vehicleError = new Error('Refresh unavailable');
      rerenderPage();
      expect(getLocation().search).toBe('?section=vehicles');
      expect(kpiValue('Vehicles')).toBe('2');
      expect(screen.getAllByTestId(/^explore-card-/).map(link => link.getAttribute('href'))).toEqual(before);
      expect(screen.queryByTestId('explore-empty')).not.toBeInTheDocument();
    });

    it('does not replace independent search results when the fleet source fails without data', () => {
      state.vehicles = undefined;
      state.vehicleError = new Error('Fleet unavailable');
      const { getLocation } = renderPage('/explore?q=powershare');
      const overview = screen.getByTestId('explore-operational-brief');
      expectVehiclesOmittedFromFace(overview);
      const failedDrawer = openReviewDrawer(overview);
      expectHiddenFieldCount(failedDrawer, 1);
      closeReviewDrawer(failedDrawer);
      expect(kpiValue('Showing')).toBe('1');
      fireEvent.click(screen.getByTestId('explore-card-/powershare'));
      expect(getLocation().pathname).toBe('/powershare');
    });

    it.each([{ ctrlKey: true }, { shiftKey: true }, { button: 1 }])(
      'leaves native destination handling intact for %j',
      modifiers => {
        const { getLocation } = renderPage('/explore?q=powershare');
        const link = screen.getByTestId('explore-card-/powershare');
        expect(link).toHaveAttribute('href', '/powershare');
        expect(fireEvent.click(link, modifiers)).toBe(true);
        expect(getLocation()).toEqual({ pathname: '/explore', search: '?q=powershare' });
      },
    );

    it('accepts a keyboard-generated category activation without implementing tab arrow semantics', () => {
      const { getLocation } = renderPage('/explore?q=charging');
      const group = screen.getByRole('group', { name: 'Filter features by category' });
      const charging = within(group).getByRole('button', { name: /^Charging\(/ });
      charging.focus();
      for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
        expect(fireEvent.keyDown(charging, { key })).toBe(true);
        expect(getLocation().search).toBe('?q=charging');
        expect(charging).toHaveFocus();
      }
      // jsdom does not implement native Enter/Space activation; dispatch its
      // resulting zero-detail click, not a fabricated component keyboard handler.
      fireEvent.click(charging, { detail: 0 });
      expect(charging).toHaveAttribute('aria-pressed', 'true');
      expect(charging).toHaveFocus();
      expect(getLocation().search).toBe('?q=charging&section=charging');
    });

    it('does not steal slash typing from the actual search input and removes its shortcut on unmount', () => {
      const { unmount } = renderPage();
      const search = screen.getByRole('searchbox');
      search.focus();
      expect(fireEvent.keyDown(search, { key: '/' })).toBe(true);
      expect(search).toHaveFocus();

      const link = screen.getByTestId('explore-card-/charging');
      link.focus();
      expect(fireEvent.keyDown(link, { key: '/' })).toBe(false);
      expect(search).toHaveFocus();
      unmount();
      expect(fireEvent.keyDown(document, { key: '/' })).toBe(true);
    });
  });

  it('focuses the search box on "/" and ignores other keys', () => {
    renderPage();
    const input = screen.getByTestId('explore-search');

    fireEvent.keyDown(document, { key: 'a' });
    expect(document.activeElement).not.toBe(input);

    act(() => {
      fireEvent.keyDown(document, { key: '/' });
    });
    expect(document.activeElement).toBe(input);
  });

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { shiftKey: true },
    { isComposing: true },
  ])('leaves modified or composing slash events untouched: %j', modifiers => {
    renderPage();
    const card = screen.getByTestId('explore-card-/charging');
    card.focus();
    expect(fireEvent.keyDown(card, { key: '/', ...modifiers })).toBe(true);
    expect(card).toHaveFocus();
  });

  it('respects an already prevented slash event', () => {
    renderPage();
    const card = screen.getByTestId('explore-card-/charging');
    card.focus();
    const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    event.preventDefault();
    fireEvent(card, event);
    expect(card).toHaveFocus();
    expect(screen.getByTestId('explore-search')).not.toHaveFocus();
  });

  it.each(['input', 'textarea', 'select', 'contenteditable', 'textbox', 'combobox'])(
    'preserves slash entry in %s, including events dispatched on document',
    kind => {
      renderPage();
      const owner = document.createElement(
        ['input', 'textarea', 'select'].includes(kind) ? kind : 'div',
      );
      owner.tabIndex = 0;
      if (kind === 'contenteditable') owner.setAttribute('contenteditable', 'true');
      else if (kind === 'textbox' || kind === 'combobox') owner.setAttribute('role', kind);
      const child = document.createElement('span');
      if (owner.tagName === 'DIV') owner.append(child);
      document.body.append(owner);
      try {
        owner.focus();
        expect(fireEvent.keyDown(owner.tagName === 'DIV' ? child : owner, { key: '/' })).toBe(true);
        expect(owner).toHaveFocus();
        expect(fireEvent.keyDown(document, { key: '/' })).toBe(true);
        expect(owner).toHaveFocus();
      } finally {
        owner.remove();
      }
    },
  );

  it.each(['dialog', 'alertdialog', 'menu', 'listbox', 'aria-modal'])(
    'does not take an active %s overlay control focus',
    role => {
      renderPage();
      const overlay = document.createElement('div');
      if (role === 'aria-modal') overlay.setAttribute('aria-modal', 'true');
      else overlay.setAttribute('role', role);
      const control = document.createElement('button');
      overlay.append(control);
      document.body.append(overlay);
      try {
        control.focus();
        expect(fireEvent.keyDown(control, { key: '/' })).toBe(true);
        expect(control).toHaveFocus();
        expect(fireEvent.keyDown(document, { key: '/' })).toBe(true);
        expect(control).toHaveFocus();
      } finally {
        overlay.remove();
      }
      expect(fireEvent.keyDown(document, { key: '/' })).toBe(false);
      expect(screen.getByTestId('explore-search')).toHaveFocus();
    },
  );
});


describe('ExplorePage — restrained discovery adoption', () => {
  it('keeps native feature destinations and keyboard navigation on semantic surfaces with shared focus treatment', () => {
    const { getLocation } = renderPage('/explore?section=charging');
    const card = screen.getByTestId('explore-card-/charging');
    expect(card).toHaveAttribute('href', '/charging');
    expect(card).toHaveClass(
      'bg-[var(--surface-1)]', 'border-[var(--border-default)]',
      'hover:border-[var(--control-border-hover)]',
      'focus-visible:outline-2', 'focus-visible:outline-offset-2',
      'focus-visible:outline-[var(--focus-ring)]',
      'forced-colors:focus-visible:outline-[Highlight]',
      'forced-colors:border-[ButtonBorder]', 'motion-reduce:transition-none',
    );
    const iconTile = card.querySelector('[aria-hidden="true"]');
    expect(iconTile).toHaveClass('bg-[var(--surface-2)]', 'border-[var(--border-default)]');
    expect(iconTile).not.toHaveClass('bg-white/[0.04]');
    card.focus();
    expect(card).toHaveFocus();
    fireEvent.click(card, { detail: 0 });
    expect(getLocation().pathname).toBe('/charging');
  });

  it('preserves every dense search hit and complete descriptions with neutral, non-color-only emphasis', () => {
    const { getLocation } = renderPage('/explore?q=battery%20health&section=battery');
    const card = screen.getByTestId('explore-card-/battery');
    const marks = Array.from(card.querySelectorAll('mark'));
    expect(marks.map(mark => mark.textContent?.toLowerCase())).toEqual(expect.arrayContaining(['battery', 'health']));
    for (const mark of marks) {
      expect(mark).toHaveClass('bg-[var(--control-bg)]', 'underline', 'text-[var(--text-primary)]');
      expect(mark).toHaveClass('forced-colors:bg-[Highlight]', 'forced-colors:text-[HighlightText]');
      expect(mark).not.toHaveClass('bg-[var(--theme-primary)]/25');
    }
    const battery = ALL.find(entry => entry.to === '/battery')!;
    expect(card).toHaveTextContent(battery.description);
    expect(screen.getByTestId('explore-search-panel')).toBeInTheDocument();
    expect(screen.getByTestId('explore-operational-brief')).toBeInTheDocument();
    expect(getLocation().search).toBe('?q=battery%20health&section=battery');
  });

  it('localizes a long suggested destination without changing near-match ranking, retained fleet gates or clear-and-open navigation', () => {
    const label = 'Localized battery health destination with complete readable context '.repeat(3).trim();
    const battery = ALL.find(entry => entry.to === '/battery')!;
    state.translations['routes.batteryHealth'] = label;
    state.translations[battery.labelKey] = label;
    state.vehicles = [{ id: 1 }];
    state.forwardAuth = false;
    state.vehicleError = new Error('Refresh unavailable');
    const { getLocation } = renderPage('/explore?q=batttery&section=home');
    const suggestions = screen.getByTestId('explore-empty-suggestions');
    const buttons = within(suggestions).getAllByRole('button');
    expect(buttons.length).toBeLessThanOrEqual(5);
    const batteryButton = within(suggestions).getByText('/battery').closest('button')!;
    expect(within(batteryButton).getByText(label)).toHaveClass('min-w-0', 'break-words');
    expect(batteryButton).toHaveAccessibleName(label + ' /battery');
    expect(batteryButton).toHaveClass('h-auto', 'max-w-full', 'whitespace-normal');
    expect(within(suggestions).queryByText('/vehicle-comparison')).not.toBeInTheDocument();
    expect(within(suggestions).queryByText('/account/sessions')).not.toBeInTheDocument();
    expect(kpiValue('Vehicles')).toBe('1');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByTestId('explore-search-panel')).toBeInTheDocument();
    batteryButton.focus();
    fireEvent.click(batteryButton, { detail: 0 });
    expect(getLocation()).toEqual({ pathname: '/battery', search: '' });
  });
});
