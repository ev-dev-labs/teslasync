/**
 * SearchPage contract + hardening tests.
 *
 * SearchPage is a URL-driven orchestration shell: it mirrors `?q=` / `?types=`
 * into the address bar via `useUrlString` / `useUrlArray`, fans the trimmed
 * query out through the real `useGlobalSearch` hook (bumping the per-type LIMIT
 * to 25), groups the flat hit list back into ALL_TYPES display order, and
 * renders a KPI band + a bento grid of per-type result panels. Every render
 * state is self-sufficient (idle / too-short / loading / error / empty /
 * results) — the tests below prove each branch is reachable and correct.
 *
 * Facets covered:
 *   1. Idle        — no query → "Start typing" empty state, no KPI band, and
 *                    crucially NO network request (the disabled-query guard).
 *   2. Too short   — 1 char → guidance empty state, still no request.
 *   3. Loading     — pending fetch → KPI + results skeletons, no resolved KPIs.
 *   4. Results     — grouped panels in ALL_TYPES order, KPI values derived from
 *                    the hit set, hit rows with titles/subtitles.
 *   5. Top match   — the KPI surfaces the *largest* group, not the first.
 *   6. Empty       — resolved-but-empty → "No results" + zeroed KPI band.
 *   7. Error       — rejected fetch → QueryError banner; Retry re-issues.
 *   8. Navigate    — clicking a result row routes to that hit's url.
 *   9. Facets      — toggling a chip sets aria-pressed, reveals Clear, bumps
 *                    the Active-Filters KPI, and threads `types=` to the API.
 *  10. URL restore — `?q&types=` on first mount pre-selects the chip + filter.
 *  11. Typing      — controlled input drives the query and fires a request.
 *  12. a11y        — the labelled regions, filter group, and icon-only refresh
 *                    control all expose accessible names.
 *
 * Network flows through the mocked `@/api/client` `request` seam (the same seam
 * CommandsPage / DiagnosticPage use) so nothing touches the real network. The
 * heavy AI natural-language surface is stubbed to a marker so the page's own
 * typed-search behaviour is isolated. `@testing-library/user-event` is
 * intentionally not used — it is not a dependency of this repo (see
 * CommandsPage.test.tsx) — interactions go through `fireEvent`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

// i18n stub: return the fallback string (or an options object's `defaultValue`),
// interpolating `{{var}}` tokens from the trailing options object so assertions
// can target the rendered English copy. Mirrors the DiagnosticPage convention
// but also handles the `t(key, 'fallback {{x}}', { x })` 3-arg shape SearchPage
// leans on for its KPI subtitles and per-result aria-labels.
function interpolate(str: string, o?: Record<string, unknown>): string {
  if (!o) return str;
  return str.replace(/{{\s*(\w+)\s*}}/g, (_m, name: string) =>
    name in o ? String(o[name]) : `{{${name}}}`,
  );
}
function tImpl(key: string, second?: unknown, third?: unknown): string {
  if (typeof second === 'string') {
    const opts = third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined;
    return interpolate(second, opts);
  }
  if (second && typeof second === 'object') {
    const opts = second as Record<string, unknown>;
    if (typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue, opts);
  }
  return key;
}

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: tImpl,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Preserve the real client (QueryError reads `isApiError`/classification from
// it) and swap only the network primitive.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// The AI natural-language search surface is a stream-and-flag-laden child gated
// by an AI feature toggle. Stub it with a marker so the page's typed-search
// behaviour is asserted in isolation.
vi.mock('@/components/ai/AINLSearch', () => ({
  AINLSearch: () => <div data-testid="ai-nl-search" />,
}));

// jsdom lacks matchMedia; framer-motion (via <FadeIn>) + useMotionPreference
// read it. Guarded polyfill keeps the render deterministic.
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
import type { SearchHit, SearchHitType, SearchResponse } from '@/api/types';
import SearchPage from './SearchPage';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function makeHit(type: SearchHitType, id: number, overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    type,
    id,
    title: `${type}-title-${id}`,
    subtitle: `${type}-subtitle-${id}`,
    url: `/${type}/${id}`,
    score: 1,
    ...overrides,
  };
}

/**
 * Route the mocked `request` for the single `/search?…` endpoint the page hits.
 *  - `hits`    → resolves `{ hits, query }`.
 *  - `error`   → rejects with the given error.
 *  - `pending` → returns a never-resolving promise (loading state).
 * The resolver receives the parsed query params so tests can assert the exact
 * `q` / `types` / `limit` the hook forwarded.
 */
function installSearch(config: {
  hits?: SearchHit[];
  error?: Error;
  pending?: boolean;
}) {
  mockedRequest.mockImplementation((path: string): Promise<SearchResponse> => {
    if (config.pending) return new Promise<SearchResponse>(() => {});
    if (config.error) return Promise.reject(config.error);
    const params = new URLSearchParams(path.split('?')[1] ?? '');
    return Promise.resolve({ hits: config.hits ?? [], query: params.get('q') ?? '' });
  });
}

/** Renders the current location so navigation side-effects can be asserted. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderPage(initialEntry = '/search') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <SearchPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The MetricCard root (`.rounded-xl`) that owns the given KPI label. */
function metricCard(label: string): HTMLElement {
  const span = screen.getByText(label);
  const root = span.closest('div.rounded-xl');
  if (!root) throw new Error(`no MetricCard root for "${label}"`);
  return root as HTMLElement;
}

beforeEach(() => {
  mockedRequest.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SearchPage', () => {
  it('renders the idle empty state and makes NO request with an empty query', () => {
    installSearch({ hits: [] });

    renderPage('/search');

    // Page chrome + AI surface + search input render immediately.
    expect(screen.getByRole('heading', { level: 1, name: 'Search' })).toBeInTheDocument();
    expect(screen.getByTestId('ai-nl-search')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search query' })).toBeInTheDocument();

    // Idle guidance, no KPI band, and — critically — no network call.
    expect(screen.getByText('Start typing to search')).toBeInTheDocument();
    expect(screen.queryByText('Total Results')).not.toBeInTheDocument();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('shows the too-short guidance and still makes no request for a 1-char query', () => {
    installSearch({ hits: [] });

    renderPage('/search?q=a');

    expect(screen.getByText('Type at least 2 characters')).toBeInTheDocument();
    expect(screen.queryByText('Total Results')).not.toBeInTheDocument();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('renders KPI + results skeletons while the search is pending', () => {
    installSearch({ pending: true });

    const { container } = renderPage('/search?q=model');

    // The query fired (it is enabled) but nothing has resolved yet.
    expect(mockedRequest).toHaveBeenCalledWith(
      expect.stringContaining('q=model'),
      expect.anything(),
    );
    // Resolved KPI labels are absent; the band is skeletonised instead.
    expect(screen.queryByText('Total Results')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(4);
  });

  it('groups hits into ALL_TYPES order and derives the KPI band from the hit set', async () => {
    // Scrambled input order proves the page re-sorts into canonical order.
    installSearch({
      hits: [
        makeHit('charging', 31, { title: 'supercharger-v3' }),
        makeHit('drive', 21, { title: 'coast-run' }),
        makeHit('vehicle', 11, { title: 'midnight-cruiser' }),
        makeHit('drive', 22, { title: 'canyon-loop' }),
        makeHit('vehicle', 12, { title: 'garage-queen' }),
        makeHit('drive', 23, { title: 'airport-dash' }),
      ],
    });

    renderPage('/search?q=model');

    // Grouped panels render inside the labelled results region.
    const region = await screen.findByRole('region', { name: 'Search results' });
    expect(within(region).getByText('coast-run')).toBeInTheDocument();
    expect(within(region).getByText('drive-subtitle-21')).toBeInTheDocument();

    // Canonical section order: Vehicles → Drives → Charging.
    const txt = region.textContent ?? '';
    expect(txt.indexOf('Vehicles')).toBeLessThan(txt.indexOf('Drives'));
    expect(txt.indexOf('Drives')).toBeLessThan(txt.indexOf('Charging'));

    // KPI band: 6 total hits across 3 categories, no active filters.
    expect(metricCard('Total Results')).toHaveTextContent('6');
    expect(metricCard('Categories')).toHaveTextContent('3');
    expect(metricCard('Active Filters')).toHaveTextContent('0');
  });

  it('surfaces the LARGEST group (not the first) as the Top Match KPI', async () => {
    installSearch({
      hits: [
        makeHit('vehicle', 11),
        makeHit('vehicle', 12),
        makeHit('drive', 21),
        makeHit('drive', 22),
        makeHit('drive', 23),
        makeHit('charging', 31),
      ],
    });

    renderPage('/search?q=model');

    await screen.findByRole('region', { name: 'Search results' });
    // Drives (3) beats Vehicles (2) even though Vehicles sorts first.
    const top = metricCard('Top Match');
    expect(top).toHaveTextContent('Drives');
    expect(top).toHaveTextContent('3 results');
  });

  it('renders the No-results state and a zeroed KPI band on an empty hit set', async () => {
    installSearch({ hits: [] });

    renderPage('/search?q=zzz');

    expect(await screen.findByText('No results')).toBeInTheDocument();
    expect(screen.getByText(/No matches for "zzz"/)).toBeInTheDocument();

    // The KPI band still renders (never gated) with zeroed derivations.
    expect(metricCard('Total Results')).toHaveTextContent('0');
    expect(metricCard('Top Match')).toHaveTextContent('—');
  });

  it('shows the QueryError banner on a failed fetch and re-issues on Retry', async () => {
    installSearch({ error: new Error('search exploded') });

    renderPage('/search?q=model');

    // Generic (non-ApiError) failure → the network branch of QueryError.
    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });

    const before = mockedRequest.mock.calls.length;
    fireEvent.click(retry);
    await waitFor(() =>
      expect(mockedRequest.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it('navigates to a hit url when its result row is activated', async () => {
    installSearch({ hits: [makeHit('drive', 21, { title: 'coast-run' })] });

    renderPage('/search?q=model');

    const row = await screen.findByRole('button', { name: 'Open coast-run' });
    expect(screen.getByTestId('location')).toHaveTextContent('/search');

    fireEvent.click(row);

    expect(screen.getByTestId('location')).toHaveTextContent('/drive/21');
  });

  it('toggles a facet chip: aria-pressed, Clear button, KPI, and types= param', async () => {
    installSearch({ hits: [makeHit('drive', 21)] });

    renderPage('/search?q=model');

    await screen.findByRole('region', { name: 'Search results' });
    const drivesChip = screen.getByRole('button', { name: 'Drives' });
    expect(drivesChip).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();

    fireEvent.click(drivesChip);

    // Chip is now pressed, Clear appears, and the KPI reflects one filter.
    expect(screen.getByRole('button', { name: 'Drives' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
    expect(metricCard('Active Filters')).toHaveTextContent('1');

    // The refined query threads the selected type to the backend.
    await waitFor(() =>
      expect(
        mockedRequest.mock.calls.some(([p]) => String(p).includes('types=drive')),
      ).toBe(true),
    );

    // Clearing restores the unfiltered view.
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('button', { name: 'Drives' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    expect(metricCard('Active Filters')).toHaveTextContent('0');
  });

  it('restores an active type filter from the URL on first mount', async () => {
    installSearch({ hits: [makeHit('charging', 31)] });

    renderPage('/search?q=model&types=charging');

    // The Charging chip is pre-pressed and the KPI shows one active filter.
    expect(screen.getByRole('button', { name: 'Charging' })).toHaveAttribute('aria-pressed', 'true');
    await screen.findByRole('region', { name: 'Search results' });
    expect(metricCard('Active Filters')).toHaveTextContent('1');
    expect(mockedRequest).toHaveBeenCalledWith(
      expect.stringContaining('types=charging'),
      expect.anything(),
    );
  });

  it('drives the search from the controlled input and fires a request on type', async () => {
    installSearch({ hits: [makeHit('vehicle', 11)] });

    renderPage('/search');
    expect(mockedRequest).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search query' }), {
      target: { value: 'roadster' },
    });

    await waitFor(() => expect(mockedRequest).toHaveBeenCalled());
    expect(mockedRequest).toHaveBeenCalledWith(
      expect.stringContaining('q=roadster'),
      expect.anything(),
    );
    // limit is bumped to the page's 25-per-type ceiling.
    expect(mockedRequest.mock.calls[0]?.[0]).toContain('limit=25');
  });

  it('exposes accessible names for the labelled regions and icon-only controls', async () => {
    installSearch({ hits: [makeHit('vehicle', 11)] });

    renderPage('/search?q=model');

    // Filter group + input are labelled immediately.
    expect(screen.getByRole('group', { name: 'Filter results by type' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search query' })).toBeInTheDocument();

    // Once active, the KPI + results regions and the icon-only refresh
    // control all carry accessible names.
    expect(await screen.findByRole('region', { name: 'Search results' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Search summary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh results' })).toBeInTheDocument();
  });

  it('re-issues the request when the header Refresh control is activated', async () => {
    installSearch({ hits: [makeHit('vehicle', 11)] });

    renderPage('/search?q=model');

    await screen.findByRole('region', { name: 'Search results' });
    const before = mockedRequest.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Refresh results' }));

    await waitFor(() =>
      expect(mockedRequest.mock.calls.length).toBeGreaterThan(before),
    );
  });
});
