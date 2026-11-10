/**
 * EnergySiteInfoWidget contract + hardening tests.
 *
 * The widget is a self-refreshing dashboard tile that summarises the user's
 * first Tesla Energy site (solar size, Powerwall count/energy, gateway firmware).
 * Its whole shape is a function of two chained queries and the widget `size`:
 *
 *   1. `useTeslaEnergySites()` — the product list. The FIRST site's
 *      `energy_site_id` becomes the `siteId`.
 *   2. `useTeslaEnergySiteInfo(siteId)` — the detailed config, gated on a
 *      truthy `siteId` (disabled until the site list resolves).
 *
 *   - size.cols <= 1  → compact tile: titled header and compact detail rows.
 *   - otherwise       → full tile: titled header + all five detail rows.
 *   - no sites        → the accessible "No Tesla Energy site linked" empty state.
 *   - sites but null info data → the "No site info available" empty state.
 *   - isLoading / hard error → skeleton / QueryError chrome (no rows).
 *
 * The suite locks, facet by facet:
 *   1. Full view (populated): the SI-on-disk watts / watt-hours are scaled to
 *      kW / kWh at the display boundary, count and total site capacity compose, the
 *      firmware renders without a timezone row, and the info query is gated on the
 *      resolved `siteId`.
 *   2. Null-safety: every optional field absent → each row degrades to an em
 *      dash, never a `undefined kW` / `NaN kWh` artefact.
 *   3. Compact view retains the header identity and all detail rows.
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
 * i18n is stubbed to echo the English fallback so every copy assertion is real.
 * Every pack runs the same controller, state and interaction contracts. Non-classic
 * content must finish loading its shared status family before assertions run.
 * `@/api/hooks/useEnergy` is partially mocked (the real module is preserved,
 * only the two hooks the widget reads are overridden) so no network is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: { unit_of_length: 'km', locale: 'en-US' } }),
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
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS } from './designPacks/types';
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
  battery_count: 2, // Count is separate from the site's 27.0 kWh total.
  version: '23.44.30.9',
  backup_reserve_percent: 20,
  default_real_mode: 'self_consumption',
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

describe.each(PACK_IDS)('EnergySiteInfoWidget — pack %s', (packId) => {
async function renderWidget(size: WidgetSize, opts: RenderOpts = {}) {
  MOCK_SITES = opts.sites ?? sitesQuery();
  MOCK_INFO = opts.info ?? infoQuery();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PackBoundary requestedPackId={packId}>
          <EnergySiteInfoWidget size={size} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
  if (packId !== 'classic' && !view.container.querySelector(
    '[data-data-state="initial"], [data-data-state="initialFailure"]',
  )) {
    await waitFor(() => {
      expect(view.container.querySelector('[data-status-appearance]'))
        .toHaveAttribute('data-status-appearance', PACK_APPEARANCES[packId]);
    });
  }
  return view;
}

beforeEach(() => {
  MOCK_SITES = sitesQuery();
  MOCK_INFO = infoQuery();
  mockUseSites.mockClear();
  mockUseSiteInfo.mockClear();
});

it('uses the canonical responsive details while preserving all five complete source values', async () => {
  const firmware = '2026.40.5-complete-energy-gateway-firmware-identity';
  const timezone = 'America/Argentina/ComodRivadavia';
  const { container } = await renderWidget(FULL, {
    sites: sitesQuery({ data: [site(42)] }),
    info: infoQuery({ data: infoResponse({
      nameplate_power: 10500, nameplate_energy: 27000, battery_count: 2,
      version: firmware, installation_time_zone: timezone,
    }) }),
  });
  const list = container.querySelector('dl');
  expect(list).toHaveClass('@container/kv-list');
  expect(list?.querySelectorAll('dt')).toHaveLength(5);
  expect(list?.querySelectorAll('dd')).toHaveLength(5);
  expect(screen.getByText(firmware)).not.toHaveClass('truncate');
  expect(screen.queryByText(timezone)).not.toBeInTheDocument();
  expect(screen.getByText(/27\.00 kWh/)).toBeInTheDocument();
  expect(mockUseSiteInfo).toHaveBeenCalledWith(42);
});

afterEach(() => {
  cleanup();
});

// ── Full view (populated) ───────────────────────────────────────────────────

describe('EnergySiteInfoWidget — full view (populated)', () => {
  it('scales SI power/energy to kW/kWh, composes the rows, and titles the tile', async () => {
    const { container } = await renderWidget(FULL, {
      sites: sitesQuery({ data: [site(555)] }),
      info: infoQuery({ data: POPULATED }),
    });

    // Full tile shows the header title.
    expect(screen.getByText('Energy site')).toBeInTheDocument();

    // Labels + display-boundary conversions.
    expect(screen.getByText('Solar system')).toBeInTheDocument();
    expect(screen.getByText('10.50 kW')).toBeInTheDocument();
    expect(screen.getByText('Powerwalls')).toBeInTheDocument();
    expect(screen.getByText('2 · 27.00 kWh')).toBeInTheDocument();
    expect(screen.getByText('Gateway firmware')).toBeInTheDocument();
    expect(screen.getByText('23.44.30.9')).toBeInTheDocument();
    expect(screen.getByText('Backup reserve')).toBeInTheDocument();
    const details = within(container.querySelector('dl')!);
    expect(details.getByText('Operating mode')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(details.getByText('Self-Powered')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'ok');
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.queryByText('Installation timezone')).not.toBeInTheDocument();
    expect(screen.queryByText('America/Los_Angeles')).not.toBeInTheDocument();
  });

  it('gates the info query on the FIRST site’s energy_site_id', async () => {
    await renderWidget(FULL, {
      sites: sitesQuery({ data: [site(555), site(999)] }),
      info: infoQuery({ data: POPULATED }),
    });

    expect(mockUseSiteInfo).toHaveBeenCalledWith(555);
    expect(mockUseSiteInfo).not.toHaveBeenCalledWith(999);
  });

  it.each([
    ['autonomous', 'Time-Based Control'],
    ['backup', 'Backup Only'],
    ['vendor-future-mode', 'vendor-future-mode'],
  ])('preserves the operating mode %s without changing its meaning', async (mode, label) => {
    const { container } = await renderWidget(FULL, {
      sites: sitesQuery({ data: [site(7)] }),
      info: infoQuery({ data: infoResponse({ ...POPULATED.data, default_real_mode: mode }) }),
    });
    expect(within(container.querySelector('dl')!).getByText(label)).toBeInTheDocument();
    if (packId !== 'classic') {
      expect(container.querySelector('.widget-big-number')).toHaveTextContent(label);
    }
  });
});

// ── Null-safety / partial fields ─────────────────────────────────────────────

describe('EnergySiteInfoWidget — null-safety', () => {
  it('degrades every absent field to an em dash (no undefined/NaN artefacts)', async () => {
    const { container } = await renderWidget(FULL, {
      sites: sitesQuery({ data: [site(1)] }),
      // Every field is unmeasured.
      info: infoQuery({ data: infoResponse({}) }),
    });

    // All five rows render their labels …
    expect(screen.getByText('Solar system')).toBeInTheDocument();
    expect(screen.getByText('Powerwalls')).toBeInTheDocument();
    expect(screen.getByText('Gateway firmware')).toBeInTheDocument();
    expect(screen.getByText('Backup reserve')).toBeInTheDocument();
    const details = within(container.querySelector('dl')!);
    expect(details.getByText('Operating mode')).toBeInTheDocument();

    // … but every value is the em-dash placeholder, never "undefined kW" etc.
    expect(details.getAllByText('—')).toHaveLength(5);
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'partial');
    expect(screen.queryByText(/kWh/)).toBeNull();
    expect(screen.queryByText(/kW/)).toBeNull();
    expect(screen.queryByText(/undefined/)).toBeNull();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it('keeps invalid measurements and blank metadata unknown without inventing zeros', async () => {
    const { container } = await renderWidget(FULL, {
      sites: sitesQuery({ data: [site(7)] }),
      info: infoQuery({ data: infoResponse({
        nameplate_power: Number.NaN,
        nameplate_energy: Number.POSITIVE_INFINITY,
        battery_count: Number.NEGATIVE_INFINITY,
        backup_reserve_percent: Number.NaN,
        version: ' ',
        default_real_mode: ' ',
      }) }),
    });
    expect(within(container.querySelector('dl')!).getAllByText('—')).toHaveLength(5);
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'partial');
    expect(screen.queryByText(/NaN|Infinity|0\.00 kW|0%/)).not.toBeInTheDocument();
  });
});

// ── Compact view ─────────────────────────────────────────────────────────────

describe('EnergySiteInfoWidget — compact view', () => {
  it('retains the titled header and icon alongside the compact detail rows', async () => {
    const { container } = await renderWidget(COMPACT, {
      sites: sitesQuery({ data: [site(9)] }),
      info: infoQuery({ data: POPULATED }),
    });

    expect(screen.getByText('10.50 kW')).toBeInTheDocument();
    expect(screen.getByText('2 · 27.00 kWh')).toBeInTheDocument();
    expect(container.querySelectorAll('dd')).toHaveLength(5);
    const heading = screen.getByRole('heading', { name: 'Energy site', level: 3 });
    expect(heading).toBeVisible();
    expect(heading.parentElement?.querySelector('svg.lucide-home')).toBeInTheDocument();
  });

  it('keeps its identity when the compact site is unlinked', async () => {
    await renderWidget(COMPACT);
    expect(screen.getByRole('heading', { name: 'Energy site', level: 3 })).toBeVisible();
    expect(screen.getByText('No Tesla energy site linked')).toBeInTheDocument();
  });
});

// ── Site resolution + query gating ───────────────────────────────────────────

describe('EnergySiteInfoWidget — site resolution + gating', () => {
  it('disables the info query and shows the no-site empty when the list is empty', async () => {
    await renderWidget(FULL, { sites: sitesQuery({ data: [] }) });

    // siteId is undefined → the info query is called disabled.
    expect(mockUseSiteInfo).toHaveBeenCalledWith(undefined);
    expect(
      screen.getByText('No Tesla energy site linked'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // No detail rows.
    expect(screen.queryByText('Solar system')).toBeNull();
  });
});

// ── Empty (sites present, no info data) ──────────────────────────────────────

describe('EnergySiteInfoWidget — empty (no info data)', () => {
  it('shows the no-data empty state when a linked site returns null info', async () => {
    await renderWidget(FULL, {
      sites: sitesQuery({ data: [site(1)] }),
      info: infoQuery({ data: infoResponse(null) }),
    });

    expect(screen.getByText('No site info available')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Solar system')).toBeNull();
  });
});

// ── Lifecycle (loading / error) ──────────────────────────────────────────────

describe('EnergySiteInfoWidget — lifecycle', () => {
  it('renders only a skeleton while the site list is loading', async () => {
    const { container } = await renderWidget(FULL, {
      sites: sitesQuery({ isLoading: true, data: undefined }),
    });

    expect(container.querySelector('[class*="--skeleton-bg"]')).toBeTruthy();
    expect(screen.queryByText('Energy site')).toBeInTheDocument();
    expect(screen.queryByText('No Tesla energy site linked')).toBeNull();
  });

  it('renders a skeleton while a resolved site’s info is loading', async () => {
    const { container } = await renderWidget(FULL, {
      sites: sitesQuery({ data: [site(3)] }),
      info: infoQuery({ isLoading: true }),
    });

    // isLoading = sitesLoading || (!!siteId && infoLoading) → true here.
    expect(container.querySelector('[class*="--skeleton-bg"]')).toBeTruthy();
    expect(screen.queryByText('Energy site')).toBeInTheDocument();
  });

  it('surfaces the info query error instead of the detail rows', async () => {
    await renderWidget(FULL, {
      sites: sitesQuery({ data: [site(3)] }),
      info: infoQuery({ error: new Error('info boom'), isError: true }),
    });

    // jsdom reports navigator.onLine === true → QueryError renders role=alert.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Solar system')).toBeNull();
  });
});

// ── Regression: sites-fetch failure must not masquerade as "no site" ─────────

describe('EnergySiteInfoWidget — sites-fetch error (Bug A regression)', () => {
  it('surfaces QueryError, never the misleading "no site linked" empty state', async () => {
    await renderWidget(FULL, {
      sites: sitesQuery({
        data: undefined,
        error: new Error('sites boom'),
        isError: true,
      }),
    });

    // A genuine fetch failure must be an error, not a "you have no site" lie.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No Tesla energy site linked')).toBeNull();
    expect(screen.queryByText('Solar system')).toBeNull();
  });
});

// ── Refresh ──────────────────────────────────────────────────────────────────

describe('EnergySiteInfoWidget — refresh', () => {
  it('keeps cached details visible while both queries refresh', async () => {
    const { container } = await renderWidget(FULL, {
      sites: sitesQuery({ data: [site(7)], isFetching: true }),
      info: infoQuery({ data: POPULATED, isFetching: true }),
    });
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'ok');
    expect(container.querySelectorAll('dd')).toHaveLength(5);
    expect(screen.getByText('10.50 kW')).toBeInTheDocument();
    expect(screen.getByText('2 · 27.00 kWh')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it.each([FULL, COMPACT])('retains every detail on cached refresh failure at %j', async (size) => {
    const { container } = await renderWidget(size, {
      sites: sitesQuery({ data: [site(7)] }),
      info: infoQuery({ data: POPULATED, isError: true, error: new Error('refresh failed') }),
    });
    expect(screen.getByText('10.50 kW')).toBeInTheDocument();
    expect(screen.getByText('2 · 27.00 kWh')).toBeInTheDocument();
    expect(screen.getByText('23.44.30.9')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(within(container.querySelector('dl')!).getByText('Self-Powered')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'stale');
    expect(screen.queryByText('America/Los_Angeles')).not.toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('preserves a measured zero solar size, battery count, and energy capacity', async () => {
    const { container } = await renderWidget(FULL, {
      sites: sitesQuery({ data: [site(7)] }),
      info: infoQuery({ data: infoResponse({
        nameplate_power: 0, battery_count: 0, nameplate_energy: 0, backup_reserve_percent: 0,
      }) }),
    });
    expect(screen.getByText('0.00 kW')).toBeInTheDocument();
    expect(screen.getByText('0 · 0.00 kWh')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(within(container.querySelector('dl')!).getAllByText('—')).toHaveLength(2);
  });

  it('retains measured site capacity when the battery count is unknown', async () => {
    await renderWidget(FULL, {
      sites: sitesQuery({ data: [site(7)] }),
      info: infoQuery({ data: infoResponse({ battery_count: undefined, nameplate_energy: 27_000 }) }),
    });
    expect(screen.getByText('— · 27.00 kWh')).toBeInTheDocument();
  });

  it('retains long firmware values without truncating their content', async () => {
    const firmware = 'gateway-firmware-build-with-a-long-release-identifier';
    const timezone = 'America/Argentina/ComodRivadavia';
    await renderWidget(COMPACT, {
      sites: sitesQuery({ data: [site(7)] }),
      info: infoQuery({ data: infoResponse({ version: firmware, installation_time_zone: timezone }) }),
    });
    expect(screen.getByText(firmware)).toBeInTheDocument();
    expect(screen.queryByText(timezone)).not.toBeInTheDocument();
  });
  it('refetches BOTH queries when a site is linked', async () => {
    const sitesRefetch = vi.fn();
    const infoRefetch = vi.fn();
    await renderWidget(FULL, {
      sites: sitesQuery({ data: [site(7)], refetch: sitesRefetch }),
      info: infoQuery({ data: POPULATED, refetch: infoRefetch }),
    });

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(sitesRefetch).toHaveBeenCalledTimes(1);
    expect(infoRefetch).toHaveBeenCalledTimes(1);
  });

  it('refetches only the sites query when no site is linked', async () => {
    const sitesRefetch = vi.fn();
    const infoRefetch = vi.fn();
    await renderWidget(FULL, {
      sites: sitesQuery({ data: [], refetch: sitesRefetch }),
      info: infoQuery({ refetch: infoRefetch }),
    });

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    // The `if (siteId) refetchInfo()` guard skips the disabled info query.
    expect(sitesRefetch).toHaveBeenCalledTimes(1);
    expect(infoRefetch).not.toHaveBeenCalled();
  });
});
});
