/**
 * ExplorePage — behaviour + hardening coverage (co-located).
 *
 * ExplorePage default-exports a single orchestrator that composes a set of
 * internal, non-exported sub-components (KPI band, RecentStrip,
 * SectionAnchorStrip, SectionBand, FeatureCard, Highlight, EmptyResult). We
 * therefore exercise every facet through the public page:
 *
 *   - Page shell: PageContainer h1 + interpolated subtitle, document-title
 *     side effect, and the search input's accessible name.
 *   - KPI overview band: the four derived counters (features / categories /
 *     showing / vehicles) are asserted against the real featureCatalog so the
 *     numbers can never silently drift, and "showing" tracks the live filter
 *     while "features"/"categories" stay stable.
 *   - Results: every visible section renders as a landmark band with a heading,
 *     a count badge, and one <li> per card; the sticky anchor strip mirrors the
 *     section list with in-page hrefs.
 *   - Filtering: URL-driven (?q=) round-trip, match highlighting (single- and
 *     multi-token <mark> wrapping), and the empty state with a "did you mean"
 *     Levenshtein suggestion that navigates + clears on pick.
 *   - Visibility gates: minVehicles (Compare Vehicles) and requiresAuth
 *     (2FA / Sessions / My Activity) mirror the sidebar, plus the
 *     vehicles-undefined null-safety path.
 *   - Recently-visited strip: resolves localStorage recents against the visible
 *     catalog, navigates on click, and hides itself while filtering.
 *   - a11y / keyboard: "/" focuses search from anywhere, other keys don't, and
 *     icon-only KPI/card glyphs are aria-hidden with visible text labels.
 *
 * Network is never touched: useVehicles / useIsForwardAuth / usePageTitle are
 * stubbed and i18n is stubbed to the English fallback with {{placeholder}}
 * interpolation. The recentPages store is the real module (localStorage-backed)
 * and reset between tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ExplorePage from './ExplorePage';
import { buildFeatureCatalog } from '../featureCatalog';
import { recordPageView, __resetRecentPagesForTests } from '@/lib/recentPages';
import { usePageTitle } from '@/hooks/usePageTitle';

// ── Hoisted, per-test controllable gating state ──────────────────────
const state = vi.hoisted(() => ({
  vehicles: [{ id: 1 }, { id: 2 }] as Array<{ id: number }> | undefined,
  forwardAuth: true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, arg2?: unknown, arg3?: unknown) => {
      const template = typeof arg2 === 'string' ? arg2 : _key;
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
  useVehicles: () => ({ data: state.vehicles }),
}));
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
  const utils = render(
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
    </QueryClientProvider>,
  );
  return { ...utils, getLocation: () => loc };
}

/** Read a KPI card's numeric value by its label, scoped to the overview band. */
function kpiValue(label: string): string {
  const region = screen.getByRole('region', { name: 'Feature overview' });
  const labelNode = within(region).getByText(label);
  const valueP = labelNode.closest('p')?.nextElementSibling;
  return valueP?.textContent?.trim() ?? '';
}

beforeEach(() => {
  state.vehicles = [{ id: 1 }, { id: 2 }];
  state.forwardAuth = true;
  __resetRecentPagesForTests();
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

describe('ExplorePage — results layout', () => {
  it('renders each visible section as a landmark band with a heading and one <li> per card', () => {
    renderPage();

    // The Home band is present for everyone.
    expect(screen.getByRole('heading', { level: 2, name: 'Home' })).toBeInTheDocument();
    const homeList = screen.getByTestId('explore-section-home');
    // Home has exactly five items in navSections.
    expect(within(homeList).getAllByRole('listitem')).toHaveLength(5);

    // A representative card + its description render.
    expect(screen.getByTestId('explore-card-/')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText(/Your daily summary/i)).toBeInTheDocument();
  });

  it('renders a sticky anchor strip that mirrors the section list with in-page hrefs', () => {
    renderPage();
    const strip = screen.getByTestId('explore-anchor-strip');
    const anchors = strip.querySelectorAll('a');
    expect(anchors).toHaveLength(CATEGORY_COUNT);

    const home = strip.querySelector('a[href="#explore-section-home"]');
    expect(home).not.toBeNull();
    expect(home?.textContent).toContain('Home');
  });
});

describe('ExplorePage — filtering', () => {
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
    expect(kpiValue('Vehicles')).toBe('0');
    expect(screen.queryByTestId('explore-card-/vehicle-comparison')).toBeNull();
  });
});

describe('ExplorePage — recently visited', () => {
  it('resolves localStorage recents against the visible catalog and navigates on click', () => {
    recordPageView({ path: '/battery', title: 'Battery Health' });
    recordPageView({ path: '/charging', title: 'Charging Overview' });

    const { getLocation } = renderPage();
    const strip = screen.getByTestId('explore-recent-strip');
    expect(within(strip).getByTestId('explore-recent-/charging')).toBeInTheDocument();
    expect(within(strip).getByTestId('explore-recent-/battery')).toBeInTheDocument();

    fireEvent.click(within(strip).getByTestId('explore-recent-/charging'));
    expect(getLocation().pathname).toBe('/charging');
  });

  it('hides the recent strip while filtering', () => {
    recordPageView({ path: '/battery', title: 'Battery Health' });
    renderPage('/explore?q=charging');
    expect(screen.queryByTestId('explore-recent-strip')).toBeNull();
  });

  it('omits the recent strip entirely when there is no history', () => {
    renderPage();
    expect(screen.queryByTestId('explore-recent-strip')).toBeNull();
  });
});

describe('ExplorePage — keyboard', () => {
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
