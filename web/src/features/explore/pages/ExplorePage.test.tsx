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
 *   - a11y / keyboard: "/" focuses search from anywhere, other keys don't, and
 *     icon-only KPI/card glyphs are aria-hidden with visible text labels.
 *
 * Network is never touched: useVehicles / useIsForwardAuth / usePageTitle are
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

// ── Hoisted, per-test controllable gating state ──────────────────────
const state = vi.hoisted(() => ({
  vehicles: [{ id: 1 }, { id: 2 }] as Array<{ id: number }> | undefined,
  forwardAuth: true,
  translations: {} as Record<string, string>,
  vehicleError: null as Error | null,
  vehiclePending: false,
  vehicleFetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  vehicleUpdatedAt: 0,
  locale: 'en-US',
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
    },
    settingsUnavailable: false,
  }),
}));
vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});
vi.mock('@/api/hooks/useAuthMode', () => ({
  useIsForwardAuth: () => state.forwardAuth,
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

beforeEach(() => {
  state.vehicles = [{ id: 1 }, { id: 2 }];
  state.forwardAuth = true;
  state.translations = {};
  state.vehicleError = null;
  state.vehiclePending = false;
  state.vehicleFetchStatus = 'idle';
  state.vehicleUpdatedAt = 0;
  state.locale = 'en-US';
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
    expect(overview.querySelector('[data-operational-metric="vehicles"]'))
      .toHaveAttribute('data-value-state', 'missing');
    expect(kpiValue('Vehicles')).toBe('—');
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
    expect(within(overview).getAllByText('Catalog ready').length).toBeGreaterThan(0);
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
    const { getLocation } = renderPage('/explore?q=powershare&section=charging');
    const overview = screen.getByTestId('explore-operational-brief');
    expect(within(overview).getAllByText('Visible catalog and returned fleet list · no date window').length)
      .toBeGreaterThan(0);
    expect(within(overview).getAllByText('Fleet last loaded: 2026-10-06T22:00:00.000Z').length)
      .toBeGreaterThan(0);
    const review = within(overview).getByRole('button', { name: 'Review details' });
    review.focus();
    fireEvent.click(review);
    const drawer = screen.getByRole('dialog', { name: 'Feature overview details' });
    expect(within(drawer).getByText('Operational metrics')).toBeInTheDocument();
    expect(within(drawer).getByText('matching filter')).toBeInTheDocument();
    expect(within(drawer).getByText('Search: powershare · Category: charging')).toBeInTheDocument();
    expect(within(drawer).getByText('Visible catalog and returned fleet list · no date window', { selector: '[data-drawer-header] span' })).toBeInTheDocument();
    expect(within(drawer).getByText('Fleet last loaded: 2026-10-06T22:00:00.000Z', { selector: '[data-drawer-header] span' })).toBeInTheDocument();
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

  it.each(['error', 'paused'] as const)('labels retained fleet evidence honestly during %s while preserving eligibility', mode => {
    const { rerenderPage, getLocation } = renderPage('/explore?section=vehicles');
    const before = screen.getAllByTestId(/^explore-card-/).map(link => link.getAttribute('href'));
    if (mode === 'error') state.vehicleError = new Error('Refresh unavailable');
    else state.vehicleFetchStatus = 'paused';
    rerenderPage();
    const overview = screen.getByTestId('explore-operational-brief');
    expect(within(overview).getAllByText(mode === 'error' ? 'Retained fleet' : 'Fleet offline').length)
      .toBeGreaterThan(0);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(kpiValue('Vehicles')).toBe('2');
    expect(getLocation().search).toBe('?section=vehicles');
    expect(screen.getAllByTestId(/^explore-card-/).map(link => link.getAttribute('href'))).toEqual(before);
    fireEvent.click(within(overview).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Feature overview details' });
    expect(within(drawer).getAllByText(mode === 'error' ? 'Retained fleet' : 'Fleet offline').length)
      .toBeGreaterThan(0);
  });

  it('reports a failed empty fleet source without replacing the independent discovery results', () => {
    state.vehicles = undefined;
    state.vehicleError = new Error('Fleet unavailable');
    renderPage('/explore?q=powershare');
    const overview = screen.getByTestId('explore-operational-brief');
    expect(within(overview).getAllByText('Fleet unavailable').length).toBeGreaterThan(0);
    expect(kpiValue('Vehicles')).toBe('—');
    expect(kpiValue('Showing')).toBe('1');
    expect(screen.getByTestId('explore-card-/powershare')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeEnabled();
  });

  it('keeps retained counts during an active refresh and closes the actual details drawer with Escape', () => {
    state.vehicleFetchStatus = 'fetching';
    const { getLocation } = renderPage('/explore?q=powershare');
    const overview = screen.getByTestId('explore-operational-brief');
    expect(within(overview).getAllByText('Fleet refreshing').length).toBeGreaterThan(0);
    expect(kpiValue('Vehicles')).toBe('2');
    expect(kpiValue('Showing')).toBe('1');
    const review = within(overview).getByRole('button', { name: 'Review details' });
    review.focus();
    fireEvent.click(review);
    const drawer = screen.getByRole('dialog', { name: 'Feature overview details' });
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
    expect(kpiValue('Vehicles')).toBe('—');
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
        expect(kpiValue('Vehicles')).toBe('—');
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
      expect(kpiValue('Vehicles')).toBe('—');
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
});
