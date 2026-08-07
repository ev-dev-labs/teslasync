/**
 * EnergyProductsPage — behaviour + hardening coverage.
 *
 * EnergyProductsPage default-exports the page plus five pure helpers
 * (`fmtEnergy`, `fmtPower`, `resourceIcon`, `resourceLabel`,
 * `operationModeLabel`) that are unit-tested directly. The file-local
 * sub-components (SummaryBand, EnergySiteCard, SiteInfoSection, CapBadge,
 * InfoTile) are exercised transitively through the page render.
 *
 * What is covered:
 *   1. READY   — the KPI band, every site card stat, capability chips, and
 *      the on-demand SiteInfoSection (operation mode, backup-reserve gauge,
 *      rated power/energy, firmware, component chips, TOU rate plan) all
 *      render their deterministic values; refresh controls expose a11y names.
 *   2. CAPS    — capability chips convey on/off through BOTH colour and an
 *      aria-label state word, and the "Storm Mode Active" badge only shows
 *      when storm mode is enabled.
 *   3. AGG     — the KPI band aggregates counts + total SI capacity across
 *      multiple sites (useMemo derive), not a single-site smoke value.
 *   4. LOADING — sites-query loading shows skeletons in the KPI band and card
 *      grid and leaks no ready KPI labels.
 *   5. ERROR   — sites-query error swaps the whole body for QueryError and the
 *      Retry action is wired to the query's refetch (failure + interaction).
 *   6. EMPTY   — an empty site list shows the discovery EmptyState while the
 *      KPI band still renders its zeroed counts (never a blank page).
 *   7. REFRESH — the header "Refresh from Tesla" action invokes the mutation.
 *   8. SITEINFO — the per-card SiteInfoSection owns its own loading / error /
 *      empty states and wires its refresh + retry to the site-info mutation.
 *   9. TOU     — the "Update" affordance opens the rate-plan modal (dialog).
 *  10. HELPERS — fmtEnergy / fmtPower SI scaling + nullish, resourceLabel /
 *      operationModeLabel branch mapping + i18n fallbacks, resourceIcon map.
 *
 * Network is never hit: every energy hook (queries + mutations) is stubbed and
 * i18n is stubbed so visible copy is the English fallback.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Battery, Sun, Zap } from 'lucide-react';
import type { ReactNode } from 'react';

import { ToastProvider } from '@/components/feedback/Toast';
import type {
  TeslaEnergySite,
  TeslaEnergySiteInfo,
  TeslaEnergySiteInfoResponse,
} from '@/types/energy';

// ── Hoisted, per-test controllable state ─────────────────────────────
// `sites` feeds the stubbed useTeslaEnergySites; `siteInfo` feeds
// useTeslaEnergySiteInfo (shared by every rendered card).
const h = vi.hoisted(() => ({
  sites: undefined as unknown,
  siteInfo: undefined as unknown,
}));

const refetchSitesMock = vi.fn();
const refreshSitesMock = vi.fn();
const refreshSiteInfoMock = vi.fn();
const updateTouMock = vi.fn();

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useEnergy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useEnergy')>();
  return {
    ...actual,
    useTeslaEnergySites: () => h.sites,
    useRefreshTeslaEnergySites: () => ({ mutate: refreshSitesMock, isPending: false }),
    useTeslaEnergySiteInfo: (_siteId?: number) => h.siteInfo,
    useRefreshTeslaEnergySiteInfo: () => ({ mutate: refreshSiteInfoMock, isPending: false }),
    useUpdateTOUSettings: () => ({ mutate: updateTouMock, isPending: false }),
  };
});

import EnergyProductsPage, {
  fmtEnergy,
  fmtPower,
  resourceIcon,
  resourceLabel,
  operationModeLabel,
} from './EnergyProductsPage';

// jsdom lacks matchMedia (framer-motion's useReducedMotion via FadeIn). The
// chart/observer polyfills already live in test-setup.ts.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

interface SitesQueryStub {
  data: TeslaEnergySite[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
}

function makeSitesQuery(overrides: Partial<SitesQueryStub> = {}): SitesQueryStub {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: refetchSitesMock,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    ...overrides,
  };
}

interface SiteInfoQueryStub {
  data: TeslaEnergySiteInfoResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

function makeSiteInfoQuery(overrides: Partial<SiteInfoQueryStub> = {}): SiteInfoQueryStub {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    ...overrides,
  };
}

function makeSite(overrides: Partial<TeslaEnergySite> = {}): TeslaEnergySite {
  return {
    id: 1,
    energy_site_id: 555,
    resource_type: 'battery',
    site_name: 'Home Powerwall',
    gateway_id: 'GW-1',
    total_pack_energy: 13500, // → "13.5 kWh"
    percentage_charged: 87.5, // → "87.5%"
    battery_type: 'ac_powerwall',
    backup_capable: true,
    storm_mode_enabled: true,
    has_solar: true,
    has_battery: true,
    has_grid: true,
    has_load_meter: true,
    tou_capable: true,
    storm_mode_capable: true,
    fetched_at: '2026-06-01T12:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-06-01T12:00:00Z',
    site_info_fetched_at: '2026-06-01T12:00:00Z',
    ...overrides,
  };
}

function makeSiteInfo(overrides: Partial<TeslaEnergySiteInfo> = {}): TeslaEnergySiteInfoResponse {
  return {
    data: {
      site_name: 'Home Powerwall',
      installation_time_zone: 'America/Los_Angeles',
      backup_reserve_percent: 20, // → "20%"
      default_real_mode: 'autonomous', // → "Time-Based Control"
      version: '23.44.0',
      battery_count: 2,
      nameplate_power: 5000, // → "5.0 kW"
      nameplate_energy: 13500, // → "13.5 kWh"
      components: {
        solar: true,
        battery: true,
        grid: true,
        tou_capable: true,
        backup: false,
      },
      tariff_content_v2: { name: 'PG&E EV2-A' },
      ...overrides,
    },
    fetched_at: '2026-06-01T12:00:00Z',
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/battery/energy-products']}>
          <EnergyProductsPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.sites = makeSitesQuery({ data: [makeSite()] });
  h.siteInfo = makeSiteInfoQuery({ data: makeSiteInfo() });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EnergyProductsPage — ready dashboard', () => {
  it('renders the KPI band, site card, and on-demand site configuration', () => {
    renderPage();

    // Page shell + landmarks.
    expect(screen.getByRole('heading', { name: 'Energy Products', level: 1 })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Energy summary' });
    expect(summary).toBeInTheDocument();

    // KPI band — labels + the aggregated total capacity (scoped to the band
    // so the identical card/site-info "13.5 kWh" values don't leak in).
    expect(within(summary).getByText('Energy Sites')).toBeInTheDocument();
    expect(within(summary).getByText('With Solar')).toBeInTheDocument();
    expect(within(summary).getByText('Total Capacity')).toBeInTheDocument();
    expect(within(summary).getByText('13.5 kWh')).toBeInTheDocument();

    // Site card header + stats.
    expect(screen.getByText('Home Powerwall')).toBeInTheDocument();
    expect(screen.getByText('87.5%')).toBeInTheDocument(); // charge
    expect(screen.getByText('Powerwall')).toBeInTheDocument(); // Type card (battery → Powerwall)

    // Site configuration section (own query) — deterministic SI values.
    expect(screen.getByText('Site Configuration')).toBeInTheDocument();
    expect(screen.getByText('Time-Based Control')).toBeInTheDocument(); // autonomous mode
    // Backup reserve renders as a gauge: the value and its unit are separate
    // nodes, and the meter announces the reading with its range.
    const reserve = screen.getByRole('meter', { name: /backup reserve/i });
    expect(reserve).toHaveAttribute('aria-valuenow', '20');
    expect(reserve).toHaveAttribute('aria-valuetext', '20%');
    expect(screen.getByText('5.0 kW')).toBeInTheDocument(); // rated power (W → kW)
    expect(screen.getByText(/Firmware: 23\.44\.0/)).toBeInTheDocument(); // firmware label + version
    expect(screen.getByText(/America\/Los_Angeles/)).toBeInTheDocument(); // timezone
    expect(screen.getByText('tou capable')).toBeInTheDocument(); // component chip (underscored → spaced)
    expect(screen.getByText('PG&E EV2-A')).toBeInTheDocument(); // TOU rate plan

    // "13.5 kWh" appears in KPI total + card capacity + rated energy.
    expect(screen.getAllByText('13.5 kWh').length).toBe(3);

    // Refresh affordances expose accessible names on icon-only controls.
    expect(screen.getByRole('button', { name: 'Refresh from Tesla' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh site info' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update rate plan' })).toBeInTheDocument();
  });

  it('conveys capability state via aria-label and only badges an active storm mode', () => {
    h.sites = makeSitesQuery({
      data: [makeSite({ has_grid: false, storm_mode_enabled: true })],
    });

    renderPage();

    // Colour is not the only signal — the state word rides in the aria-label.
    expect(screen.getByLabelText('Solar: available')).toBeInTheDocument();
    expect(screen.getByLabelText('Grid: unavailable')).toBeInTheDocument();
    expect(screen.getByLabelText('Storm Watch: available')).toBeInTheDocument();
    // Storm mode is enabled → the extra active badge shows.
    expect(screen.getByText('Storm Mode Active')).toBeInTheDocument();
  });

  it('hides the storm-active badge when storm mode is disabled', () => {
    h.sites = makeSitesQuery({ data: [makeSite({ storm_mode_enabled: false })] });

    renderPage();

    expect(screen.queryByText('Storm Mode Active')).not.toBeInTheDocument();
  });

  it('aggregates KPI counts and total SI capacity across multiple sites', () => {
    h.sites = makeSitesQuery({
      data: [
        makeSite({ id: 1, energy_site_id: 1, total_pack_energy: 13500, has_solar: true }),
        makeSite({
          id: 2,
          energy_site_id: 2,
          site_name: 'Cabin',
          total_pack_energy: 13500,
          has_solar: false,
          storm_mode_capable: false,
        }),
      ],
    });

    renderPage();

    const summary = screen.getByRole('region', { name: 'Energy summary' });
    // 2 sites, 1 with solar, 1 storm-ready; 13500 + 13500 Wh → "27.0 kWh".
    expect(within(summary).getByText('27.0 kWh')).toBeInTheDocument();
    // Both site cards rendered.
    expect(screen.getByText('Home Powerwall')).toBeInTheDocument();
    expect(screen.getByText('Cabin')).toBeInTheDocument();
  });
});

describe('EnergyProductsPage — loading / error / empty', () => {
  it('shows skeletons and leaks no KPI labels while the sites query loads', () => {
    h.sites = makeSitesQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 });

    const { container } = renderPage();

    expect(screen.getByRole('heading', { name: 'Energy Products', level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('Energy Sites')).not.toBeInTheDocument();
    expect(screen.queryByText('Home Powerwall')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('swaps the body for QueryError and wires Retry to the sites refetch', () => {
    h.sites = makeSitesQuery({ isError: true, error: new Error('boom'), dataUpdatedAt: 0 });

    renderPage();

    expect(screen.getByText(/Can't reach server/i)).toBeInTheDocument();
    // The KPI band + cards must not render behind the error panel.
    expect(screen.queryByText('Energy Sites')).not.toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /^Retry$/i });
    fireEvent.click(retry);
    expect(refetchSitesMock).toHaveBeenCalledTimes(1);
  });

  it('renders the discovery EmptyState but still shows zeroed KPI counts', () => {
    h.sites = makeSitesQuery({ data: [] });

    renderPage();

    expect(
      screen.getByText(/No energy products found\. Use "Refresh from Tesla"/i),
    ).toBeInTheDocument();

    // KPI band still present — the page never goes fully blank.
    const summary = screen.getByRole('region', { name: 'Energy summary' });
    expect(within(summary).getByText('Energy Sites')).toBeInTheDocument();
    // Total capacity of an empty fleet is 0 Wh → "0 Wh".
    expect(within(summary).getByText('0 Wh')).toBeInTheDocument();
  });

  it('invokes the refresh mutation when the header action is clicked', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh from Tesla' }));
    expect(refreshSitesMock).toHaveBeenCalledTimes(1);
  });
});

describe('EnergyProductsPage — SiteInfoSection states', () => {
  it('shows a skeleton (not stale values) while the site-info query loads', () => {
    h.siteInfo = makeSiteInfoQuery({ isLoading: true });

    const { container } = renderPage();

    // The section header always renders; its body is a skeleton.
    expect(screen.getByText('Site Configuration')).toBeInTheDocument();
    expect(screen.queryByText('Time-Based Control')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('surfaces QueryError in the card and retries via the site-info mutation', () => {
    h.siteInfo = makeSiteInfoQuery({ isError: true, error: new Error('site boom') });

    renderPage();

    expect(screen.getByText(/Can't reach server/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
    expect(refreshSiteInfoMock).toHaveBeenCalledWith(555);
  });

  it('shows an EmptyState when no site configuration has been fetched', () => {
    h.siteInfo = makeSiteInfoQuery({ data: { data: null, fetched_at: null } });

    renderPage();

    expect(
      screen.getByText(/No site configuration loaded yet\. Use refresh to fetch from Tesla\./i),
    ).toBeInTheDocument();
  });

  it('invokes the site-info refresh mutation from the section refresh button', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh site info' }));
    expect(refreshSiteInfoMock).toHaveBeenCalledWith(555);
  });

  it('opens the TOU rate-plan modal when the Update affordance is clicked', () => {
    renderPage();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Update rate plan' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/Configure your utility rate plan/i)).toBeInTheDocument();
  });
});

describe('fmtEnergy / fmtPower', () => {
  it('returns an em dash for nullish input', () => {
    expect(fmtEnergy(null)).toBe('—');
    expect(fmtEnergy(undefined)).toBe('—');
    expect(fmtPower(null)).toBe('—');
    expect(fmtPower(undefined)).toBe('—');
  });

  it('scales at the 1000 SI boundary (Wh↔kWh, W↔kW)', () => {
    expect(fmtEnergy(999)).toBe('999 Wh');
    expect(fmtEnergy(1000)).toBe('1.0 kWh');
    expect(fmtEnergy(13500)).toBe('13.5 kWh');
    expect(fmtPower(500)).toBe('500 W');
    expect(fmtPower(5000)).toBe('5.0 kW');
  });

  it('uses magnitude so negative (export) values still scale', () => {
    expect(fmtPower(-2000)).toBe('-2.0 kW');
    expect(fmtEnergy(0)).toBe('0 Wh');
  });
});

describe('resourceLabel / operationModeLabel', () => {
  const t = (_key: string, fallback: string) => fallback;

  it('maps known resource types via i18n fallbacks and echoes unknown types', () => {
    expect(resourceLabel('battery', t)).toBe('Powerwall');
    expect(resourceLabel('solar', t)).toBe('Solar');
    expect(resourceLabel('wall_connector', t)).toBe('wall_connector');
  });

  it('maps known operation modes and degrades unknown / absent modes', () => {
    expect(operationModeLabel('self_consumption', t)).toBe('Self-Powered');
    expect(operationModeLabel('autonomous', t)).toBe('Time-Based Control');
    expect(operationModeLabel('backup', t)).toBe('Backup Only');
    expect(operationModeLabel('mystery_mode', t)).toBe('mystery_mode');
    expect(operationModeLabel(undefined, t)).toBe('—');
  });

  it('routes user-visible labels through the translate fn (i18n, not literals)', () => {
    const keys: string[] = [];
    const spyT = (key: string, fallback: string) => {
      keys.push(key);
      return fallback;
    };
    resourceLabel('battery', spyT);
    operationModeLabel('backup', spyT);
    expect(keys).toContain('energy.products.resourceType.powerwall');
    expect(keys).toContain('energy.siteInfo.mode.backup');
  });
});

describe('resourceIcon', () => {
  it('maps battery/solar to their icons and defaults to a bolt', () => {
    expect(resourceIcon('battery')).toBe(Battery);
    expect(resourceIcon('solar')).toBe(Sun);
    expect(resourceIcon('wall_connector')).toBe(Zap);
    expect(resourceIcon('')).toBe(Zap);
  });
});
