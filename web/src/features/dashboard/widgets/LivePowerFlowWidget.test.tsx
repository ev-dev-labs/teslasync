/**
 * LivePowerFlowWidget — behavioural, branch, null-safety and a11y coverage for
 * the dashboard "Live Power Flow" widget.
 *
 * The widget discovers Tesla Energy sites (`useTeslaEnergySites`), takes the
 * first site's `energy_site_id`, subscribes to its live power snapshot
 * (`useTeslaEnergyLiveStatus`), converts the SI-watt readings to kW, and folds
 * them into a `WidgetFlowDiagram` of four fixed nodes (solar/grid/home/battery)
 * plus directional arrows.
 *
 * What this file pins:
 *   - the SITE-RESOLUTION + hook contract (first site id → live-status hook,
 *     `undefined` when no sites so the query stays disabled);
 *   - the LOADING gate (skeleton while the *sites list* OR the live status
 *     loads — never flashing the "no site" empty state prematurely);
 *   - the two distinct EMPTY states — "No Tesla Energy site linked" (no sites)
 *     vs. the diagram's own "No live power data" (sites, but no live snapshot);
 *   - NODE derivation: watts→kW, `Math.abs` magnitude, "N.N kW" formatting and
 *     the fixed top/left/right/bottom positions;
 *   - the ARROW battery-sign REGRESSION — Tesla live-status reports
 *     `battery_power` as SI watts where NEGATIVE = charging / POSITIVE =
 *     discharging (the canonical convention from PowerFlowDashboardPage). The
 *     widget previously inverted this, drawing charge/discharge arrows
 *     backwards; these tests lock the corrected directions;
 *   - the solar/grid direction branches (produce, import, export) and the
 *     negligible-solar inactive threshold;
 *   - NULL-SAFETY (all power fields null → zeroed nodes, no arrows);
 *   - COMPACT sizing (1-col → compact diagram);
 *   - the REFRESH wiring (both queries from the diagram; only sites from the
 *     no-site empty state) and the title heading.
 *
 * Strategy mirrors EnergyFlowWidget.test.tsx: `@/api/hooks/useEnergy` is the
 * network boundary (hoisted mocks); `WidgetFlowDiagram` is a prop-recording
 * stub that also mirrors nodes/arrows into the DOM; `react-i18next` echoes each
 * `t(key, fallback)` fallback; `DataFreshness`'s display hooks are stubbed so
 * the refresh chip renders without a Settings provider; `<MemoryRouter>` wraps
 * every render because `EmptyState` can reach for `<Link>`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { TeslaEnergySite, TeslaEnergyLiveStatus } from '@/types/energy';
import type { FlowNode, FlowArrow } from './shared';

// ── Hoisted mocks (referenced inside vi.mock factories) ─────────────────────────

const { sitesMock, liveMock, flowSpy } = vi.hoisted(() => ({
  sitesMock: vi.fn(),
  liveMock: vi.fn(),
  flowSpy: vi.fn(),
}));

vi.mock('@/api/hooks/useEnergy', () => ({
  useTeslaEnergySites: () => sitesMock(),
  useTeslaEnergyLiveStatus: (...args: unknown[]) => liveMock(...args),
}));

// WidgetFlowDiagram — a prop-recording stub. It records the derived
// nodes/arrows (the unit under test) and mirrors them into the DOM so both the
// structure and the rendered copy are assertable, without the animated SVG.
vi.mock('./shared', () => ({
  WidgetFlowDiagram: (props: {
    nodes: FlowNode[];
    arrows: FlowArrow[];
    compact?: boolean;
    emptyMessage?: string;
  }) => {
    flowSpy(props);
    return (
      <div
        data-testid="flow-diagram"
        data-empty={props.emptyMessage}
        data-compact={String(props.compact)}
      >
        {props.nodes.map((n) => (
          <div
            key={n.id}
            data-testid={`node-${n.id}`}
            data-value={String(n.value)}
            data-position={n.position}
          >
            <span data-testid={`node-${n.id}-label`}>{n.label}</span>
            <span data-testid={`node-${n.id}-value`}>{n.formattedValue}</span>
          </div>
        ))}
        {props.arrows.map((a) => (
          <div
            key={`${a.from}-${a.to}`}
            data-testid={`arrow-${a.from}-${a.to}`}
            data-active={String(a.active)}
            data-value={String(a.value)}
          />
        ))}
      </div>
    );
  },
}));

// i18n → return the developer fallback so copy reads as English.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string) => fallback ?? _key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// DataFreshness display hooks — stubbed so the freshness chip renders without a
// Settings/QueryClient provider.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (v: unknown) => String(v) }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));

import LivePowerFlowWidget from './LivePowerFlowWidget';

// ── Fixtures ────────────────────────────────────────────────────────────────────

const NOW = '2026-07-05T12:00:00.000Z';
const SIZE = { cols: 2, rows: 2 };

function makeSite(over: Partial<TeslaEnergySite> = {}): TeslaEnergySite {
  return {
    id: 1,
    energy_site_id: 100,
    resource_type: 'battery',
    site_name: 'Home',
    gateway_id: null,
    total_pack_energy: null,
    percentage_charged: null,
    battery_type: null,
    backup_capable: true,
    storm_mode_enabled: false,
    has_solar: true,
    has_battery: true,
    has_grid: true,
    has_load_meter: true,
    tou_capable: true,
    storm_mode_capable: true,
    fetched_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    site_info_fetched_at: null,
    ...over,
  };
}

function makeLive(over: Partial<TeslaEnergyLiveStatus> = {}): TeslaEnergyLiveStatus {
  return {
    id: 1,
    energy_site_id: 100,
    solar_power: 0,
    battery_power: 0,
    load_power: 0,
    grid_power: 0,
    grid_services_power: 0,
    energy_left: 0,
    total_pack_energy: 0,
    percentage_charged: 0,
    grid_status: 'Connected',
    backup_capable: true,
    storm_mode_active: false,
    timestamp: NOW,
    fetched_at: NOW,
    ...over,
  };
}

interface QueryOverrides<T> {
  data?: T;
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function setSites(over: QueryOverrides<TeslaEnergySite[]> = {}) {
  const q = {
    data: [makeSite()] as TeslaEnergySite[] | undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.parse(NOW),
    refetch: vi.fn(),
    ...over,
  };
  sitesMock.mockReturnValue(q);
  return q;
}

function setLive(over: QueryOverrides<TeslaEnergyLiveStatus> = {}) {
  const q = {
    data: makeLive() as TeslaEnergyLiveStatus | undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.parse(NOW),
    refetch: vi.fn(),
    ...over,
  };
  liveMock.mockReturnValue(q);
  return q;
}

function renderWidget(size: { cols: number; rows: number } = SIZE) {
  return render(
    <MemoryRouter>
      <LivePowerFlowWidget size={size} />
    </MemoryRouter>,
  );
}

/** The nodes/arrows the widget handed to the (mocked) diagram on its last render. */
function lastFlowProps() {
  return flowSpy.mock.calls.at(-1)?.[0] as {
    nodes: FlowNode[];
    arrows: FlowArrow[];
    compact?: boolean;
    emptyMessage?: string;
  };
}
function nodeById(id: string): FlowNode | undefined {
  return lastFlowProps().nodes.find((n) => n.id === id);
}
function arrowByEnds(from: string, to: string): FlowArrow | undefined {
  return lastFlowProps().arrows.find((a) => a.from === from && a.to === to);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSites();
  setLive();
});

// ── Site resolution & hook contract ──────────────────────────────────────────────

describe('LivePowerFlowWidget — site resolution & hook contract', () => {
  it('passes the first site energy_site_id to the live-status hook', () => {
    setSites({ data: [makeSite({ energy_site_id: 100 }), makeSite({ id: 2, energy_site_id: 200 })] });
    renderWidget();

    expect(liveMock).toHaveBeenCalledWith(100);
  });

  it('passes undefined to the live-status hook when no sites are linked', () => {
    setSites({ data: [] });
    setLive({ data: undefined });
    renderWidget();

    expect(liveMock).toHaveBeenCalledWith(undefined);
  });
});

// ── Loading & empty states ──────────────────────────────────────────────────────

describe('LivePowerFlowWidget — loading & empty states', () => {
  it('renders only a skeleton while the sites list loads', () => {
    // Bug pin: the "no site" empty state must NOT flash while the list loads.
    setSites({ data: undefined, isLoading: true });
    setLive({ data: undefined });
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByTestId('flow-diagram')).toBeNull();
    expect(screen.queryByText('No Tesla Energy site linked')).toBeNull();
    expect(flowSpy).not.toHaveBeenCalled();
  });

  it('renders a skeleton (not the empty state) while the live status loads', () => {
    setSites({ data: [makeSite()] });
    setLive({ isLoading: true, data: undefined });
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByTestId('flow-diagram')).toBeNull();
  });

  it('shows the "No Tesla Energy site linked" empty state (no heading) when no sites exist', () => {
    setSites({ data: [] });
    setLive({ data: undefined });
    renderWidget();

    expect(screen.getByRole('status')).toHaveTextContent('No Tesla Energy site linked');
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByTestId('flow-diagram')).toBeNull();
  });

  it('hands empty nodes and the localized empty message to the diagram when live data is absent', () => {
    setSites({ data: [makeSite()] });
    setLive({ data: undefined });
    renderWidget();

    expect(screen.getByTestId('flow-diagram')).toBeInTheDocument();
    expect(lastFlowProps().nodes).toHaveLength(0);
    expect(lastFlowProps().arrows).toHaveLength(0);
    expect(lastFlowProps().emptyMessage).toBe('No live power data');
  });

  it('renders the flow diagram with all four nodes once live data resolves', () => {
    setSites({ data: [makeSite()] });
    setLive({ data: makeLive({ solar_power: 4000 }) });
    renderWidget();

    expect(screen.getByTestId('flow-diagram')).toBeInTheDocument();
    expect(lastFlowProps().nodes).toHaveLength(4);
  });
});

// ── Node derivation (watts → kW) ─────────────────────────────────────────────────

describe('LivePowerFlowWidget — node derivation', () => {
  it('derives solar/grid/home/battery nodes at fixed positions with kW-formatted values', () => {
    setLive({
      data: makeLive({ solar_power: 4000, grid_power: 2000, load_power: 3500, battery_power: 1500 }),
    });
    renderWidget();

    const solar = nodeById('solar');
    expect(solar?.position).toBe('top');
    expect(solar?.value).toBe(4);
    expect(solar?.formattedValue).toBe('4.0 kW');
    expect(screen.getByTestId('node-solar-label')).toHaveTextContent('Solar');

    expect(nodeById('grid')?.position).toBe('left');
    expect(nodeById('grid')?.formattedValue).toBe('2.0 kW');
    expect(nodeById('home')?.position).toBe('right');
    expect(nodeById('home')?.formattedValue).toBe('3.5 kW');
    expect(nodeById('battery')?.position).toBe('bottom');
    expect(nodeById('battery')?.value).toBe(1.5);
    expect(nodeById('battery')?.formattedValue).toBe('1.5 kW');
  });

  it('uses the magnitude (abs) of negative power readings for node values', () => {
    setLive({ data: makeLive({ grid_power: -1000, battery_power: -2000 }) });
    renderWidget();

    expect(nodeById('grid')?.value).toBe(1);
    expect(nodeById('grid')?.formattedValue).toBe('1.0 kW');
    expect(nodeById('battery')?.value).toBe(2);
    expect(nodeById('battery')?.formattedValue).toBe('2.0 kW');
  });

  it('gives every node an icon and a localized label', () => {
    renderWidget();

    expect(nodeById('solar')?.icon).toBeTruthy();
    expect(nodeById('grid')?.icon).toBeTruthy();
    expect(nodeById('home')?.label).toBe('Home');
    expect(nodeById('battery')?.label).toBe('Battery');
  });
});

// ── Arrow derivation — battery sign convention (regression) ───────────────────────

describe('LivePowerFlowWidget — battery flow direction (regression)', () => {
  it('draws Battery → Home (active) when the pack is discharging (battery_power > 0)', () => {
    setLive({ data: makeLive({ battery_power: 1500 }) });
    renderWidget();

    const discharge = arrowByEnds('battery', 'home');
    expect(discharge?.active).toBe(true);
    expect(discharge?.value).toBe(1.5);
    // Discharging must NOT be misread as charging.
    expect(arrowByEnds('grid', 'battery')).toBeUndefined();
    expect(arrowByEnds('solar', 'battery')).toBeUndefined();
  });

  it('draws Grid → Battery when charging from the grid (battery_power < 0, no solar)', () => {
    setLive({ data: makeLive({ battery_power: -2000, solar_power: 0 }) });
    renderWidget();

    const gridCharge = arrowByEnds('grid', 'battery');
    expect(gridCharge?.active).toBe(true);
    expect(gridCharge?.value).toBe(2);
    // A charging pack must NOT be drawn as discharging to the home.
    expect(arrowByEnds('battery', 'home')).toBeUndefined();
  });

  it('draws Solar → Battery when excess solar charges the pack (battery_power < 0, solar > 0)', () => {
    setLive({ data: makeLive({ solar_power: 4000, battery_power: -1000 }) });
    renderWidget();

    const solarCharge = arrowByEnds('solar', 'battery');
    expect(solarCharge?.active).toBe(true);
    expect(solarCharge?.value).toBe(1); // min(solarKw 4, |batteryKw| 1)
    // With solar available the pack charges from solar, not the grid.
    expect(arrowByEnds('grid', 'battery')).toBeUndefined();
    expect(arrowByEnds('battery', 'home')).toBeUndefined();
  });
});

// ── Arrow derivation — solar & grid direction ────────────────────────────────────

describe('LivePowerFlowWidget — solar & grid flow direction', () => {
  it('draws an active Solar → Home arrow while solar is producing', () => {
    setLive({ data: makeLive({ solar_power: 4000 }) });
    renderWidget();

    const solarHome = arrowByEnds('solar', 'home');
    expect(solarHome?.active).toBe(true);
    expect(solarHome?.value).toBe(4);
  });

  it('marks Solar → Home inactive for a negligible (<10 W) solar reading', () => {
    setLive({ data: makeLive({ solar_power: 5 }) });
    renderWidget();

    const solarHome = arrowByEnds('solar', 'home');
    expect(solarHome).toBeDefined();
    expect(solarHome?.active).toBe(false); // 0.005 kW ≤ 0.01 kW threshold
  });

  it('draws Grid → Home when importing (grid_power > 0)', () => {
    setLive({ data: makeLive({ grid_power: 2000 }) });
    renderWidget();

    const gridHome = arrowByEnds('grid', 'home');
    expect(gridHome?.active).toBe(true);
    expect(gridHome?.value).toBe(2);
    expect(arrowByEnds('home', 'grid')).toBeUndefined();
  });

  it('draws Home → Grid when exporting (grid_power < 0)', () => {
    setLive({ data: makeLive({ grid_power: -1000 }) });
    renderWidget();

    const homeGrid = arrowByEnds('home', 'grid');
    expect(homeGrid?.active).toBe(true);
    expect(homeGrid?.value).toBe(1); // |gridKw|
    expect(arrowByEnds('grid', 'home')).toBeUndefined();
  });

  it('emits no arrows when the system is idle (all readings zero)', () => {
    setLive({ data: makeLive() });
    renderWidget();

    expect(lastFlowProps().arrows).toHaveLength(0);
    expect(screen.queryByTestId('arrow-battery-home')).toBeNull();
  });
});

// ── Null safety ──────────────────────────────────────────────────────────────────

describe('LivePowerFlowWidget — null safety', () => {
  it('collapses null power fields to zeroed nodes and no arrows', () => {
    setLive({
      data: makeLive({
        solar_power: null,
        battery_power: null,
        grid_power: null,
        load_power: null,
      }),
    });
    renderWidget();

    expect(nodeById('solar')?.formattedValue).toBe('0.0 kW');
    expect(nodeById('battery')?.value).toBe(0);
    expect(lastFlowProps().nodes).toHaveLength(4);
    expect(lastFlowProps().arrows).toHaveLength(0);
  });
});

// ── Compact sizing ───────────────────────────────────────────────────────────────

describe('LivePowerFlowWidget — compact sizing', () => {
  it('passes compact=true to the diagram for a single-column widget', () => {
    renderWidget({ cols: 1, rows: 2 });

    expect(lastFlowProps().compact).toBe(true);
    expect(screen.getByTestId('flow-diagram')).toHaveAttribute('data-compact', 'true');
  });

  it('passes compact=false for a multi-column widget', () => {
    renderWidget({ cols: 2, rows: 2 });

    expect(lastFlowProps().compact).toBe(false);
  });
});

// ── Interactions & accessibility ─────────────────────────────────────────────────

describe('LivePowerFlowWidget — interactions & a11y', () => {
  it('refreshes both the sites and live-status queries from the freshness control', () => {
    const sites = setSites({ data: [makeSite({ energy_site_id: 100 })] });
    const live = setLive({ data: makeLive() });
    renderWidget();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(sites.refetch).toHaveBeenCalledTimes(1);
    expect(live.refetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes only the sites query (not live) from the no-site empty state', () => {
    const sites = setSites({ data: [] });
    const live = setLive({ data: undefined });
    renderWidget();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(sites.refetch).toHaveBeenCalledTimes(1);
    expect(live.refetch).not.toHaveBeenCalled();
  });

  it('exposes the widget title as a heading', () => {
    renderWidget();

    expect(screen.getByRole('heading', { name: /Live Power Flow/i })).toBeInTheDocument();
  });
});
