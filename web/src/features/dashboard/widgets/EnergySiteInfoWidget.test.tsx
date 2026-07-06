/**
 * EnergySiteInfoWidget contract + hardening tests.
 *
 * The widget is a self-refreshing dashboard tile that summarises the user's
 * first Tesla Energy site (solar size, Powerwall count/energy, gateway firmware
 * and the installation timezone). Its whole shape is a function of two chained
 * queries and the widget `size`:
 *
 *   1. `useTeslaEnergySites()` — the product list. The FIRST site's
 *      `energy_site_id` becomes the `siteId`.
 *   2. `useTeslaEnergySiteInfo(siteId)` — the detailed config, gated on a
 *      truthy `siteId` (disabled until the site list resolves).
 *
 *   - size.cols <= 1  → compact tile: no header title (detail rows still show).
 *   - otherwise       → full tile: titled header + the four detail rows.
 *   - no sites        → the accessible "No Tesla Energy site linked" empty state.
 *   - sites but null info data → the "No site info available" empty state.
 *   - isLoading / hard error → skeleton / QueryError chrome (no rows).
 *
 * The suite locks, facet by facet:
 *   1. Full view (populated): the SI-on-disk watts / watt-hours are scaled to
 *      kW / kWh at the display boundary, the count × energy string composes, the
 *      firmware + timezone render, and the info query is gated on the resolved
 *      `siteId`.
 *   2. Null-safety: every optional field absent → each row degrades to an em
 *      dash, never a `undefined kW` / `NaN kWh` artefact.
 *   3. Compact view drops the header title but still renders the detail rows.
 *   4. Site resolution + query gating: an empty site list disables the info
 *      query (`useTeslaEnergySiteInfo(undefined)`) and shows the no-site empty.
 *   5. Empty (sites present, info `data: null`) → the no-data empty state.
 *   6. Lifecycle: the two loading branches (`sitesLoading`, and
 *      `siteId && infoLoading`) each render a skeleton only; an info error
 *      surfaces QueryError instead of the rows.
 *   7. Regression (Bug A): a FAILED `/tesla/energy-sites` fetch surfaces
 *      QueryError, NOT the misleading "no site linked" empty state.
 *   8. Refresh: the accessible "Refresh" freshness control refetches the sites
 *      query, and the info query only when a `siteId` is present.
 *
 * i18n is stubbed to echo the English fallback so every copy assertion is real,
 * and `@/api/hooks/useEnergy` is partially mocked (the real module is preserved,
 * only the two hooks the widget reads are overridden) so no network is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// i18n passthrough: honour the English fallback so every copy assertion is real.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown) =>
      typeof defaultValue === 'string' ? defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// The two chained query results are injected per-test through these mutable
// holders (the `mock`/`MOCK` prefixes let vitest hoist the factory above them
// safely). Only the two hooks the widget reads are overridden — the rest of the
// real module is preserved so transitive importers keep working.
const mockUseSites = vi.fn(() => MOCK_SITES);
const mockUseSiteInfo = vi.fn((_siteId?: number) => MOCK_INFO);
let MOCK_SITES: SitesQuery;
let MOCK_INFO: InfoQuery;
vi.mock('@/api/hooks/useEnergy', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useEnergy')>();
  return {
    ...actual,
    useTeslaEnergySites: () => mockUseSites(),
    useTeslaEnergySiteInfo: (siteId?: number) => mockUseSiteInfo(siteId),
  };
});

import EnergySiteInfoWidget from './EnergySiteInfoWidget';
import type { WidgetSize } from './types';
import type {
  TeslaEnergySite,
  TeslaEnergySiteInfo,
  TeslaEnergySiteInfoResponse,
} from '@/types/energy';

/** Only the fields the widget reads off the `useTeslaEnergySites` result. */
interface SitesQuery {
  data: TeslaEnergySite[] | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

/** Only the fields the widget reads off the `useTeslaEnergySiteInfo` result. */
interface InfoQuery {
  data: TeslaEnergySiteInfoResponse | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

const NOW = Date.parse('2026-07-05T12:00:00.000Z');
const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

/** A site row carrying only the `energy_site_id` the widget resolves against. */
function site(energySiteId: number): TeslaEnergySite {
  return { energy_site_id: energySiteId } as unknown as TeslaEnergySite;
}

function infoResponse(
  data: Partial<TeslaEnergySiteInfo> | null,
): TeslaEnergySiteInfoResponse {
  return {
    data: data as TeslaEnergySiteInfo | null,
    fetched_at: data ? '2026-07-05T00:00:00Z' : null,
  };
}

/** A fully-populated site-info payload used by the "happy path" cases. */
const POPULATED = infoResponse({
  nameplate_power: 10500, // W → 10.5 kW
  nameplate_energy: 27000, // Wh → 27.0 kWh
  battery_count: 2, // → "2 × 27.0 kWh"
  version: '23.44.30.9',
  installation_time_zone: 'America/Los_Angeles',
});

function sitesQuery(overrides: Partial<SitesQuery> = {}): SitesQuery {
  return {
    data: [],
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: NOW,
    refetch: vi.fn(),
    ...overrides,
  };
}

function infoQuery(overrides: Partial<InfoQuery> = {}): InfoQuery {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: 0,
    refetch: vi.fn(),
    ...overrides,
  };
}

interface RenderOpts {
  sites?: SitesQuery;
  info?: InfoQuery;
}

function renderWidget(size: WidgetSize, opts: RenderOpts = {}) {
  MOCK_SITES = opts.sites ?? sitesQuery();
  MOCK_INFO = opts.info ?? infoQuery();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EnergySiteInfoWidget size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  MOCK_SITES = sitesQuery();
  MOCK_INFO = infoQuery();
  mockUseSites.mockClear();
  mockUseSiteInfo.mockClear();
});

afterEach(() => {
  cleanup();
});

// ── Full view (populated) ───────────────────────────────────────────────────

describe('EnergySiteInfoWidget — full view (populated)', () => {
  it('scales SI power/energy to kW/kWh, composes the rows, and titles the tile', () => {
    renderWidget(FULL, {
      sites: sitesQuery({ data: [site(555)] }),
      info: infoQuery({ data: POPULATED }),
    });

    // Full tile shows the header title.
    expect(screen.getByText('Energy Site')).toBeInTheDocument();

    // Labels + display-boundary conversions.
    expect(screen.getByText('Solar System')).toBeInTheDocument();
    expect(screen.getByText('10.5 kW')).toBeInTheDocument();
    expect(screen.getByText('Powerwalls')).toBeInTheDocument();
    expect(screen.getByText('2 × 27.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('Gateway Firmware')).toBeInTheDocument();
    expect(screen.getByText('23.44.30.9')).toBeInTheDocument();
    expect(screen.getByText('Installation Timezone')).toBeInTheDocument();
    expect(screen.getByText('America/Los_Angeles')).toBeInTheDocument();
  });

  it('gates the info query on the FIRST site’s energy_site_id', () => {
    renderWidget(FULL, {
      sites: sitesQuery({ data: [site(555), site(999)] }),
      info: infoQuery({ data: POPULATED }),
    });

    expect(mockUseSiteInfo).toHaveBeenCalledWith(555);
    expect(mockUseSiteInfo).not.toHaveBeenCalledWith(999);
  });
});

// ── Null-safety / partial fields ─────────────────────────────────────────────

describe('EnergySiteInfoWidget — null-safety', () => {
  it('degrades every absent field to an em dash (no undefined/NaN artefacts)', () => {
    renderWidget(FULL, {
      sites: sitesQuery({ data: [site(1)] }),
      // battery_count 0 + every other field missing.
      info: infoQuery({ data: infoResponse({ battery_count: 0 }) }),
    });

    // All four rows render their labels …
    expect(screen.getByText('Solar System')).toBeInTheDocument();
    expect(screen.getByText('Powerwalls')).toBeInTheDocument();
    expect(screen.getByText('Gateway Firmware')).toBeInTheDocument();
    expect(screen.getByText('Installation Timezone')).toBeInTheDocument();

    // … but every value is the em-dash placeholder, never "undefined kW" etc.
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText(/kWh/)).toBeNull();
    expect(screen.queryByText(/kW/)).toBeNull();
    expect(screen.queryByText(/undefined/)).toBeNull();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});

// ── Compact view ─────────────────────────────────────────────────────────────

describe('EnergySiteInfoWidget — compact view', () => {
  it('renders the detail rows but drops the header title', () => {
    renderWidget(COMPACT, {
      sites: sitesQuery({ data: [site(9)] }),
      info: infoQuery({ data: POPULATED }),
    });

    expect(screen.getByText('10.5 kW')).toBeInTheDocument();
    expect(screen.getByText('2 × 27.0 kWh')).toBeInTheDocument();
    // A compact (1×1) tile suppresses the header title entirely.
    expect(screen.queryByText('Energy Site')).toBeNull();
  });
});

// ── Site resolution + query gating ───────────────────────────────────────────

describe('EnergySiteInfoWidget — site resolution + gating', () => {
  it('disables the info query and shows the no-site empty when the list is empty', () => {
    renderWidget(FULL, { sites: sitesQuery({ data: [] }) });

    // siteId is undefined → the info query is called disabled.
    expect(mockUseSiteInfo).toHaveBeenCalledWith(undefined);
    expect(
      screen.getByText('No Tesla Energy site linked'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // No detail rows.
    expect(screen.queryByText('Solar System')).toBeNull();
  });
});

// ── Empty (sites present, no info data) ──────────────────────────────────────

describe('EnergySiteInfoWidget — empty (no info data)', () => {
  it('shows the no-data empty state when a linked site returns null info', () => {
    renderWidget(FULL, {
      sites: sitesQuery({ data: [site(1)] }),
      info: infoQuery({ data: infoResponse(null) }),
    });

    expect(screen.getByText('No site info available')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Solar System')).toBeNull();
  });
});

// ── Lifecycle (loading / error) ──────────────────────────────────────────────

describe('EnergySiteInfoWidget — lifecycle', () => {
  it('renders only a skeleton while the site list is loading', () => {
    const { container } = renderWidget(FULL, {
      sites: sitesQuery({ isLoading: true, data: undefined }),
    });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Energy Site')).toBeNull();
    expect(screen.queryByText('No Tesla Energy site linked')).toBeNull();
  });

  it('renders a skeleton while a resolved site’s info is loading', () => {
    const { container } = renderWidget(FULL, {
      sites: sitesQuery({ data: [site(3)] }),
      info: infoQuery({ isLoading: true }),
    });

    // isLoading = sitesLoading || (!!siteId && infoLoading) → true here.
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Energy Site')).toBeNull();
  });

  it('surfaces the info query error instead of the detail rows', () => {
    renderWidget(FULL, {
      sites: sitesQuery({ data: [site(3)] }),
      info: infoQuery({ error: new Error('info boom'), isError: true }),
    });

    // jsdom reports navigator.onLine === true → QueryError renders role=alert.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Solar System')).toBeNull();
  });
});

// ── Regression: sites-fetch failure must not masquerade as "no site" ─────────

describe('EnergySiteInfoWidget — sites-fetch error (Bug A regression)', () => {
  it('surfaces QueryError, never the misleading "no site linked" empty state', () => {
    renderWidget(FULL, {
      sites: sitesQuery({
        data: undefined,
        error: new Error('sites boom'),
        isError: true,
      }),
    });

    // A genuine fetch failure must be an error, not a "you have no site" lie.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No Tesla Energy site linked')).toBeNull();
    expect(screen.queryByText('Solar System')).toBeNull();
  });
});

// ── Refresh ──────────────────────────────────────────────────────────────────

describe('EnergySiteInfoWidget — refresh', () => {
  it('refetches BOTH queries when a site is linked', () => {
    const sitesRefetch = vi.fn();
    const infoRefetch = vi.fn();
    renderWidget(FULL, {
      sites: sitesQuery({ data: [site(7)], refetch: sitesRefetch }),
      info: infoQuery({ data: POPULATED, refetch: infoRefetch }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(sitesRefetch).toHaveBeenCalledTimes(1);
    expect(infoRefetch).toHaveBeenCalledTimes(1);
  });

  it('refetches only the sites query when no site is linked', () => {
    const sitesRefetch = vi.fn();
    const infoRefetch = vi.fn();
    renderWidget(FULL, {
      sites: sitesQuery({ data: [], refetch: sitesRefetch }),
      info: infoQuery({ refetch: infoRefetch }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    // The `if (siteId) refetchInfo()` guard skips the disabled info query.
    expect(sitesRefetch).toHaveBeenCalledTimes(1);
    expect(infoRefetch).not.toHaveBeenCalled();
  });
});
