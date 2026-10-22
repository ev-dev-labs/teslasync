/**
 * AnalyticsPage contract + hardening tests.
 *
 * AnalyticsPage is a thin orchestration shell: it owns the active-tab state,
 * threads a single instant-bounded `useFleetAnalytics` query object down to a
 * KPI band (HeroGauges) plus one of four domain tabs, and consumes the header
 * range through `useRangeState`. Its five chart-heavy children are
 * mocked with prop-capturing stubs so the tests can assert the page's own
 * behaviour deterministically (recharts/leaflet render nothing meaningful in
 * jsdom and would only add flake). Everything else — the real
 * `useFleetAnalytics`, `useRangeState`, `PageContainer` and `TabNav`
 * render for real, so the query-param wiring is exercised
 * end-to-end.
 *
 * Facets covered:
 *   1. Shell — page heading, subtitle, labelled KPI region, labelled tab nav,
 *      default tab, and the document title side-effect.
 *   2. Loading — the pending query is threaded to the hero + active tab.
 *   3. Loaded — resolved fleet data (total_drives) reaches the hero + tab.
 *   4. Error  — a rejected query surfaces its error state through the shell.
 *   5. Tab switching — clicking each tab mounts exactly that domain panel and
 *      unmounts the previous one, and the freshly-mounted panel receives the
 *      same resolved query (data threading survives a tab change).
 *   6. a11y — the KPI region, the tab nav, and the four named tab buttons
 *      expose accessible names; no duplicate range picker renders in the page.
 *   7. Range contract — the fleet request is scoped by the URL range using
 *      `start`/`end` RFC 3339 params, with NO `/api/v1` double-prefix.
 *      The upper bound is exclusive, including for non-UTC calendar ranges.
 *   8. Range interaction — changing the header range re-scopes the
 *      query and re-fetches with the new window.
 *
 * Network is driven through the mocked `@/api/client` `request` seam (the same
 * seam FleetAPIPage / SchemaDriftPage use) so nothing touches the real network.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { FleetContentQuery } from '../components/overview-modernization/retainFleetContent';
import { FleetSectionBrief } from '../components/operationalbrief-a-m/FleetSectionBrief';
import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';

// i18n stub: return the fallback string, interpolating {{var}} tokens from the
// options object so assertions can target the rendered English copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          return fallbackOrOpts.replace(/{{(\w+)}}/g, (_m, name: string) =>
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
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Display zone for the range hook. Defaults to UTC (what the global timezone
// mock resolves for bare renders); the DST test sets a non-UTC zone to keep
// its transition coverage. Spread keeps every other timezone export real.
const savedZone = vi.hoisted(() => ({ tz: 'UTC' }));
vi.mock('@/lib/timezone', async () => {
  const actual = await vi.importActual<typeof import('@/lib/timezone')>('@/lib/timezone');
  return { ...actual, useTimezone: () => savedZone.tz };
});
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// The five chart/hook-heavy analytics children are stubbed with prop-capturing
// markers. Each echoes the threaded query's state so the page's data-threading
// and tab-switching contracts can be asserted without mounting recharts.
vi.mock('../components/analytics', () => {
  type StubQuery = FleetContentQuery;
  const label = (q: StubQuery): string =>
    q.isLoading ? 'loading' : q.isError ? 'error' : `ready:${q.data?.total_drives ?? 0}`;
  return {
    HeroGauges: ({ query }: { query: StubQuery }) => (
      <div data-testid="hero-gauges">{`hero:${label(query)}`}</div>
    ),
    OverviewTab: ({ query }: { query: StubQuery }) => (
      <div data-testid="tab-overview">{`overview:${label(query)}`}
        <FleetSectionBrief query={query} title="Overview brief" description="" metrics={[]} />
      </div>
    ),
    DrivingTab: ({ query }: { query: StubQuery }) => (
      <div data-testid="tab-driving">{`driving:${label(query)}`}
        <FleetSectionBrief query={query} title="Driving brief" description="" metrics={[]} />
      </div>
    ),
    ChargingTab: ({ query }: { query: StubQuery }) => (
      <div data-testid="tab-charging">{`charging:${label(query)}`}
        <FleetSectionBrief query={query} title="Charging brief" description="" metrics={[]} />
      </div>
    ),
    BatteryTab: ({ query }: { query: StubQuery }) => (
      <div data-testid="tab-battery">{`battery:${label(query)}`}
        <FleetSectionBrief query={query} title="Battery brief" description="" metrics={[]} />
      </div>
    ),
  };
});
vi.mock('../components/operationalbrief-a-m/FleetOverviewBrief', async () => {
  const { HeroGauges } = await import('../components/analytics');
  const { FleetOverviewBrief } = await vi.importActual<typeof import('../components/operationalbrief-a-m/FleetOverviewBrief')>(
    '../components/operationalbrief-a-m/FleetOverviewBrief',
  );
  return { FleetOverviewBrief: ({ query, scope, retained }: {
    query: Parameters<typeof HeroGauges>[0]['query']; scope: string; retained: boolean;
  }) => <><HeroGauges query={query} /><FleetOverviewBrief query={query} scope={scope} retained={retained} />
    <span data-testid="overview-source-status">{retained ? 'retained' : 'current'}</span>
  </> };
});

// jsdom lacks matchMedia; framer-motion (via <FadeIn>) reads it. Guarded
// polyfill keeps the render deterministic.
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
import { getDatePreset } from '@/lib/datePresets';
import { calendarRangeToInstants } from '@/lib/dateRange';
import { useRangeState } from '@/hooks/useRangeState';
import { analyticsKeys } from '@/api/hooks/useAnalytics';
import AnalyticsPage from './AnalyticsPage';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function makeFleet(overrides: Record<string, unknown> = {}) {
  return {
    period_days: 30,
    total_vehicles: 2,
    total_distance_km: 500,
    total_drives: 42,
    total_charging_sessions: 7,
    total_energy_kwh: 100,
    total_cost: 25,
    avg_efficiency_wh_km: 160,
    ...overrides,
  };
}

/** Resolve every fleet request with the given payload. */
function installFleet(data: Record<string, unknown> = makeFleet()) {
  mockedRequest.mockImplementation(() => Promise.resolve(data));
}

function renderPage(initialEntries: string[] = ['/analytics']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return { client, ...render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        <HeaderRangeChange />
        <AnalyticsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  ) };
}

function HeaderRangeChange() {
  const { setRange } = useRangeState();
  // Resolve in UTC (the display zone this file pins): the page re-resolves
  // the scope preset in the display zone, so a local-zone resolution would
  // disagree by a day whenever the local and UTC dates differ.
  return <button onClick={() => setRange(getDatePreset('7d')!.resolve(new Date(), 'UTC'))}>Change header range</button>;
}

/** The single fleet request path that was issued (last call). */
function fleetPaths(): string[] {
  return mockedRequest.mock.calls
    .map((c) => c[0] as string)
    .filter((p) => typeof p === 'string' && p.startsWith('/analytics/fleet'));
}

beforeEach(() => {
  mockedRequest.mockReset();
  window.localStorage.clear();
  savedZone.tz = 'UTC';
});

afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

function fleetPath(start: string, end: string) {
  return `/analytics/fleet?${new URLSearchParams({ start, end })}`;
}

function calendarFleetPath(start: string, end: string) {
  // Bare renders resolve the display zone to UTC (global timezone mock).
  const bounds = calendarRangeToInstants({
    startDate: start, endDate: end,
    timezone: 'UTC',
  });
  return fleetPath(bounds.startInstant, bounds.endInstantExclusive);
}

describe('AnalyticsPage', () => {
  it('discloses HTTP-success partial sources, retains totals during retry failure and clears the notice on recovery', async () => {
    const reasons = ['drive_query_failed', 'charging_record_cap_reached', 'future_source_reason'];
    const data = makeFleet({ partial_result: {
      is_partial: true, reasons,
    } });
    installFleet(data);
    renderPage();
    const notice = await screen.findByTestId('analytics-fleet-partial');
    expect(notice).toHaveTextContent('not treated as complete');
    for (const reason of reasons) expect(notice).toHaveTextContent(reason);
    assertOperationalBriefDisclosure(screen.getByRole('region', { name: 'Fleet summary metrics' }), 'Partial data');
    expect(screen.getByTestId('tab-overview')).toHaveTextContent('overview:ready:42');
    mockedRequest.mockRejectedValue(new Error('Fleet refresh failed'));
    fireEvent.click(within(notice).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByTestId('overview-source-status')).toHaveTextContent('retained'));
    expect(screen.getByTestId('analytics-fleet-partial')).toHaveTextContent('drive_query_failed');
    expect(screen.getByTestId('tab-overview')).toHaveTextContent('overview:ready:42');
    installFleet(makeFleet({ total_drives: 43, partial_result: { is_partial: false, reasons: [] } }));
    fireEvent.click(within(screen.getByTestId('analytics-fleet-partial')).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByTestId('analytics-fleet-partial')).not.toBeInTheDocument());
    expect(screen.getByTestId('tab-overview')).toHaveTextContent('overview:ready:43');
    expect(screen.getByTestId('overview-source-status')).toHaveTextContent('current');
  });

  it('discloses partial zero totals even when no reasons were returned', async () => {
    installFleet(makeFleet({ total_drives: 0, partial_result: { is_partial: true, reasons: null } }));
    renderPage();
    expect(await screen.findByTestId('analytics-fleet-partial')).toHaveTextContent('not treated as complete');
    expect(screen.getByTestId('tab-overview')).toHaveTextContent('overview:ready:0');
  });

  it('renders the shell: heading, subtitle, labelled KPI region, tab nav, default tab + title', async () => {
    installFleet();

    renderPage();

    // Page chrome from PageContainer.
    expect(screen.getByRole('heading', { level: 1, name: 'Fleet analytics' })).toBeInTheDocument();
    expect(
      screen.getByText('Comprehensive fleet performance insights'),
    ).toBeInTheDocument();

    // KPI band lives inside a labelled region and always renders (self-sufficient).
    const kpiRegion = screen.getByRole('region', { name: 'Fleet summary metrics' });
    expect(within(kpiRegion).getByTestId('hero-gauges')).toBeInTheDocument();

    // Domain switcher is a labelled nav; the default tab is Overview.
    expect(screen.getByRole('navigation', { name: 'Analytics sections' })).toBeInTheDocument();
    expect(await screen.findByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-driving')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-charging')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-battery')).not.toBeInTheDocument();

    // usePageTitle side-effect.
    expect(document.title).toContain('Fleet analytics');
  });

  it('renders analytics evidence briefs without a nested surface', async () => {
    renderPage();
    await screen.findByTestId('tab-overview');

    const brief = screen.getByText('Overview brief').closest('[data-operational-brief]');
    expect(brief?.querySelector('[data-operational-brief-surface="embedded"]')).toBeInTheDocument();
    expect(brief?.querySelector('[data-operational-brief-surface="standalone"]')).toBeNull();
  });

  it('threads the pending query state to the hero band and the active tab', () => {
    // Never-resolving request keeps the query in its loading state.
    mockedRequest.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByTestId('hero-gauges')).toHaveTextContent('hero:loading');
    expect(screen.getByTestId('tab-overview')).toHaveTextContent('overview:loading');
    assertOperationalBriefDisclosure(screen.getByTestId('tab-overview'), 'Loading evidence');
  });

  it('shows unavailable rather than loading or returned evidence when paused without data', () => {
    onlineManager.setOnline(false);
    mockedRequest.mockReturnValue(new Promise(() => {}));
    renderPage();
    const tab = screen.getByTestId('tab-overview');
    assertOperationalBriefDisclosure(tab, 'Evidence unavailable');
    expect(within(tab).queryByText('Loading evidence')).not.toBeInTheDocument();
    expect(within(tab).queryByText('Returned evidence')).not.toBeInTheDocument();
    expect(fleetPaths()).toEqual([]);
  });

  it('treats a successful zero response as returned evidence, not unavailable', async () => {
    installFleet(makeFleet({ total_drives: 0, total_distance_km: 0, total_energy_kwh: 0,
      vehicle_comparison: [], battery_trend: [] }));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('tab-overview')).toHaveTextContent('overview:ready:0'));
    assertOperationalBriefDisclosure(screen.getByTestId('tab-overview'), 'Returned evidence');
  });

  it('hands retained failure state to every domain brief without replacing content, then recovers', async () => {
    installFleet();
    const { client } = renderPage();
    await waitFor(() => expect(screen.getByTestId('tab-overview')).toHaveTextContent('overview:ready:42'));
    mockedRequest.mockRejectedValue(new Error('Refresh unavailable'));
    await client.refetchQueries({ queryKey: ['analytics'] });
    await waitFor(() => expect(screen.getByTestId('overview-source-status')).toHaveTextContent('retained'));
    const nav = screen.getByRole('navigation', { name: 'Analytics sections' });
    for (const [name, id] of [
      ['Overview', 'overview'], ['Driving', 'driving'], ['Charging', 'charging'], ['Battery', 'battery'],
    ]) {
      fireEvent.click(within(nav).getByRole('button', { name }));
      const tab = screen.getByTestId(`tab-${id}`);
      expect(tab).toHaveTextContent(`${id}:ready:42`);
      assertOperationalBriefDisclosure(tab, 'Retained evidence');
    }
    installFleet(makeFleet({ total_drives: 43 }));
    await client.refetchQueries({ queryKey: ['analytics'] });
    await waitFor(() => expect(screen.getByTestId('tab-battery')).toHaveTextContent('battery:ready:43'));
    assertOperationalBriefDisclosure(screen.getByTestId('tab-battery'), 'Returned evidence');
    expect(screen.getByTestId('overview-source-status')).toHaveTextContent('current');
  });

  it('threads resolved fleet data (total_drives) to the hero band and the active tab', async () => {
    installFleet(makeFleet({ total_drives: 42 }));

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('hero-gauges')).toHaveTextContent('hero:ready:42'),
    );
    expect(screen.getByTestId('tab-overview')).toHaveTextContent('overview:ready:42');
  });

  it('surfaces the error state through the shell when the fleet request fails', async () => {
    mockedRequest.mockRejectedValue(new Error('fleet analytics unavailable'));

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('hero-gauges')).toHaveTextContent('hero:error'),
    );
    expect(screen.getByTestId('tab-overview')).toHaveTextContent('overview:error');
    // The KPI region is still present — the page never blanks a panel.
    expect(screen.getByRole('region', { name: 'Fleet summary metrics' })).toBeInTheDocument();
  });

  it('switches tabs and threads the resolved query to each freshly-mounted panel', async () => {
    installFleet(makeFleet({ total_drives: 42 }));

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('tab-overview')).toHaveTextContent('overview:ready:42'),
    );

    const nav = screen.getByRole('navigation', { name: 'Analytics sections' });

    fireEvent.click(within(nav).getByRole('button', { name: 'Driving' }));
    expect(screen.getByTestId('tab-driving')).toHaveTextContent('driving:ready:42');
    expect(screen.queryByTestId('tab-overview')).not.toBeInTheDocument();

    fireEvent.click(within(nav).getByRole('button', { name: 'Charging' }));
    expect(screen.getByTestId('tab-charging')).toHaveTextContent('charging:ready:42');
    expect(screen.queryByTestId('tab-driving')).not.toBeInTheDocument();

    fireEvent.click(within(nav).getByRole('button', { name: 'Battery' }));
    expect(screen.getByTestId('tab-battery')).toHaveTextContent('battery:ready:42');
    expect(screen.queryByTestId('tab-charging')).not.toBeInTheDocument();

    // ...and back to Overview.
    fireEvent.click(within(nav).getByRole('button', { name: 'Overview' }));
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-battery')).not.toBeInTheDocument();
  });

  it('is accessible: labelled KPI region + nav, four named tab buttons, and a named range trigger', () => {
    installFleet();

    renderPage();

    expect(screen.getByRole('region', { name: 'Fleet summary metrics' })).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Analytics sections' });
    const tabButtons = within(nav).getAllByRole('button');
    expect(tabButtons).toHaveLength(4);
    expect(tabButtons.map((b) => b.textContent)).toEqual([
      'Overview',
      'Driving',
      'Charging',
      'Battery',
    ]);

    expect(screen.queryByTestId('analytics-range')).not.toBeInTheDocument();
  });

  it('keeps decorative tab icons hidden and unfocusable without changing the named controls', () => {
    installFleet();

    renderPage();

    const nav = screen.getByRole('navigation', { name: 'Analytics sections' });
    for (const name of ['Overview', 'Driving', 'Charging', 'Battery']) {
      const button = within(nav).getByRole('button', { name });
      const icon = button.querySelector('svg');
      expect(button).toHaveAccessibleName(name);
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveAttribute('focusable', 'false');
      expect(icon).toHaveClass('h-4', 'w-4', 'shrink-0');
      expect(icon).toHaveAttribute('stroke-width', '2');
    }
  });

  it('scopes the fleet request to the URL range with exact exclusive instant bounds (no /api/v1)', async () => {
    installFleet();

    renderPage(['/analytics?from=2025-03-01&to=2025-03-15']);

    await waitFor(() =>
      expect(
        fleetPaths().some((p) => p === calendarFleetPath('2025-03-01', '2025-03-15')),
      ).toBe(true),
    );
    // Regression guards: the request client adds /api/v1 itself, so the hook
    // path must not double-prefix it, and the params are snake_case.
    const issued = fleetPaths();
    expect(issued.every((p) => !p.includes('/api/v1'))).toBe(true);
    expect(issued.every((p) => !p.includes('vehicleId='))).toBe(true);
  });

  it('re-scopes and re-fetches the query when the header range changes', async () => {
    installFleet();

    const { client } = renderPage(['/analytics?from=2025-03-01&to=2025-03-15']);

    // Initial request uses the URL window.
    await waitFor(() =>
      expect(fleetPaths()).toContain(calendarFleetPath('2025-03-01', '2025-03-15')),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Change header range' }));

    const expected = getDatePreset('7d')!.resolve(new Date(), 'UTC');
    const expectedPath = calendarFleetPath(expected.start, expected.end);
    await waitFor(() => expect(fleetPaths()).toContain(expectedPath));
    // The window actually changed (a new request was issued, not the URL one).
    expect(expectedPath).not.toBe(calendarFleetPath('2025-03-01', '2025-03-15'));
    const initialParams = new URL(calendarFleetPath('2025-03-01', '2025-03-15'), 'http://localhost').searchParams;
    const updatedParams = new URL(expectedPath, 'http://localhost').searchParams;
    const initialKey = analyticsKeys.fleet(undefined, initialParams.get('start')!, initialParams.get('end')!);
    const updatedKey = analyticsKeys.fleet(undefined, updatedParams.get('start')!, updatedParams.get('end')!);
    expect(updatedKey).not.toEqual(initialKey);
    await waitFor(() => expect(client.getQueryData(updatedKey)).toBeDefined());
    expect(client.getQueryData(initialKey)).toBeDefined();
  });

  it.each(['42', '99'])('keeps populated fleet analytics unfiltered with carried vehicle_id=%s', async (vehicleId) => {
    installFleet(makeFleet({ total_vehicles: 2, total_drives: 42 }));
    const { client } = renderPage([
      `/analytics?vehicle_id=${vehicleId}&from=2025-03-01&to=2025-03-15`,
    ]);
    const expectedPath = calendarFleetPath('2025-03-01', '2025-03-15');

    await waitFor(() => expect(screen.getByTestId('hero-gauges')).toHaveTextContent('hero:ready:42'));
    expect(screen.getByTestId('tab-overview')).toHaveTextContent('overview:ready:42');
    expect(fleetPaths()).toEqual([expectedPath]);
    for (const path of fleetPaths()) {
      const params = new URL(path, 'http://localhost').searchParams;
      expect([...params.keys()].sort()).toEqual(['end', 'start']);
    }
    const params = new URL(expectedPath, 'http://localhost').searchParams;
    expect(client.getQueryData(analyticsKeys.fleet(undefined, params.get('start')!, params.get('end')!)))
      .toMatchObject({ total_vehicles: 2, total_drives: 42 });
  });

  it('preserves non-UTC custom boundaries across daylight saving time in both the request and cache key', async () => {
    // The range follows the saved display zone (not the browser zone), so
    // set a non-UTC saved zone to keep the DST-transition coverage.
    savedZone.tz = 'America/Los_Angeles';
    installFleet();
    const { client } = renderPage(['/analytics?from=2025-03-08&to=2025-03-09']);
    const start = '2025-03-08T08:00:00.000Z';
    const end = '2025-03-10T07:00:00.000Z';
    await waitFor(() => expect(fleetPaths()).toContain(fleetPath(start, end)));
    await waitFor(() => expect(client.getQueryData(analyticsKeys.fleet(undefined, start, end))).toBeDefined());
    assertOperationalBriefDisclosure(screen.getByRole('region', { name: 'Fleet summary metrics' }), '2025-03-08 – 2025-03-09');
    expect(Date.parse(end) - Date.parse(start)).toBe(47 * 60 * 60_000);
  });

  it.each([
    ['24h', 24 * 60 * 60_000],
    ['live', 5 * 60_000],
  ])('uses the exact rolling %s window rather than whole calendar days', async (preset, duration) => {
    const now = new Date('2026-10-14T16:59:07.544Z').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    installFleet();
    const { client } = renderPage([`/analytics?from=2026-10-13&to=2026-10-14&time_scope=${preset}`]);
    const start = new Date(now - duration).toISOString();
    const end = new Date(now).toISOString();
    await waitFor(() => expect(fleetPaths()).toContain(fleetPath(start, end)));
    await waitFor(() => expect(client.getQueryData(analyticsKeys.fleet(undefined, start, end))).toBeDefined());
    expect(new URL(fleetPaths().at(-1)!, 'http://localhost').searchParams.get('end')).toBe(end);
  });
});
