/**
 * RegenEfficiencyWidget — behaviour + hardening tests.
 *
 * RegenEfficiencyWidget is a dashboard tile that resolves a target vehicle
 * (`vehicleId` prop → first vehicle from `useVehicles` → undefined) and reads
 * that vehicle's regenerative-braking rollup (`useRegenEfficiency`). It renders
 * one of two layouts inside `WidgetShell`:
 *   - compact (cols ≤ 1)  → a titleless `WidgetGaugeHero` (radial recovery gauge
 *                            only, no stat tiles).
 *   - standard (cols > 1) → a titled shell (with a help affordance) wrapping the
 *                           gauge plus a 3-up stat strip: Total Recovered (energy),
 *                           Monthly Avg (power), and Free Charges (integer count).
 * The gauge stroke colour is threshold-driven: > 30% recovery is green, > 15% is
 * amber, everything else is red. The shell owns the loading skeleton, the error
 * `QueryError`, and the freshness / refresh affordance. The body is never a blank
 * panel — an explicit `EmptyState` stands in whenever there is no data.
 *
 * The two data hooks are mocked at their module boundaries so every orchestration
 * branch is deterministic and the network is never touched. `useUnits` is stubbed
 * with deterministic `formatEnergy` / `formatPower` spies so the SI pass-through,
 * the `{ precision: 1 }` override, and the null-placeholder path are all exact and
 * inspectable. `react-i18next` is echo-mocked (returns the English fallback);
 * `useSettings` / `useTimezone` come from the global stub in src/test-setup.ts.
 * `matchMedia` is polyfilled because `<DataFreshness>` reads it via
 * `useMotionPreference`.
 *
 * Facets covered:
 *   - vehicle resolution: explicit prop wins → first vehicle → undefined
 *     (which disables the query and surfaces the empty state).
 *   - standard layout: title, help trigger, gauge percentage label, all three
 *     stat tiles, and the exact `formatEnergy`/`formatPower(value, {precision:1})`
 *     call arguments.
 *   - compact layout: gauge with no title and no stat tiles; empty state.
 *   - colour thresholds: green / amber / red across the > 30 and > 15 boundaries
 *     (including the exact-boundary 30% → amber and 15% → red cases).
 *   - shell states: loading skeleton, error QueryError, and empty state — never a
 *     blank panel.
 *   - null-safety (the hardening): undefined regenRatio → 0% + red band; undefined
 *     energy/power → "—" placeholders; undefined freeCharges → "0".
 *   - refresh wiring: activating the freshness control invokes the query refetch
 *     from both the standard and compact tiles.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n echo mock: returns the fallback string (or key when none), interpolating
// {{var}} tokens from the options object so assertions target rendered English.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fb?: unknown, opts?: unknown) => {
      const options = (opts && typeof opts === 'object' ? opts : undefined) as
        | Record<string, unknown>
        | undefined;
      let base = typeof fb === 'string' ? fb : key;
      if (options) {
        base = base.replace(/{{\s*(\w+)\s*}}/g, (_m, n: string) =>
          n in options && options[n] != null ? String(options[n]) : `{{${n}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Both data hooks are mocked so the widget's orchestration is deterministic.
vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicles: vi.fn() };
});
vi.mock('@/api/hooks/useDriving', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useDriving')>();
  return { ...actual, useRegenEfficiency: vi.fn() };
});

// useUnits stub — deterministic energy/power formatters so the pass-through
// value, the `{ precision: 1 }` override, and the null-placeholder branch are all
// exact and the call arguments are inspectable. Returns a STABLE object so the
// widget's memoised `stats` keeps stable formatter references between renders.
const units = vi.hoisted(() => ({
  formatEnergy: vi.fn((v?: number | null) => (v == null ? '—' : `${v} Wh`)),
  formatPower: vi.fn((v?: number | null) => (v == null ? '—' : `${v} W`)),
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => units }));

// jsdom lacks matchMedia; useMotionPreference (via <DataFreshness>) reads it.
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

import RegenEfficiencyWidget from './RegenEfficiencyWidget';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useRegenEfficiency } from '@/api/hooks/useDriving';
import type { RegenEfficiencyData } from '@/types/driving';
import type { WidgetProps, WidgetSize } from './types';

const mockVehicles = vi.mocked(useVehicles);
const mockRegen = vi.mocked(useRegenEfficiency);

const STANDARD: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

// The RadialGauge progress arc is the only element carrying a hex `stroke`
// (the track uses `currentColor`), so this selector uniquely targets the gauge.
const GAUGE_SVG = 'svg[class~="-rotate-90"]';
const GREEN = '#10b981';
const AMBER = '#f59e0b';
const RED = '#ef4444';

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): never {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  } as never;
}

/** `useVehicles()` stub — the widget only reads `.data[0].id`. */
function vehicles(ids: number[]): never {
  return { data: ids.map((id) => ({ id })) } as never;
}

function makeData(over: Partial<RegenEfficiencyData> = {}): RegenEfficiencyData {
  return {
    totalRegenWh: 1234,
    totalDriveWh: 5000,
    regenRatio: 0.4,
    monthlyAvgRegen: 56,
    freeCharges: 7,
    ...over,
  };
}

function renderWidget(size: WidgetSize, props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RegenEfficiencyWidget size={size} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockVehicles.mockReturnValue(vehicles([1]));
  mockRegen.mockReturnValue(qr({ data: makeData() }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RegenEfficiencyWidget — vehicle resolution', () => {
  it('prefers the explicit vehicleId prop over the vehicle list', () => {
    mockVehicles.mockReturnValue(vehicles([7, 9]));
    renderWidget(STANDARD, { vehicleId: 42 });

    expect(mockRegen).toHaveBeenCalledWith('42');
  });

  it('falls back to the first vehicle id when no vehicleId prop is given', () => {
    mockVehicles.mockReturnValue(vehicles([7, 9]));
    renderWidget(STANDARD);

    expect(mockRegen).toHaveBeenCalledWith('7');
  });

  it('passes undefined (disabling the query) when there is neither a prop nor any vehicle', () => {
    mockVehicles.mockReturnValue(vehicles([]));
    mockRegen.mockReturnValue(qr({ data: undefined }));
    renderWidget(STANDARD);

    expect(mockRegen).toHaveBeenCalledWith(undefined);
    // No vehicle → no data → explicit empty state, never a blank panel.
    expect(screen.getByText('No regen data')).toBeInTheDocument();
  });
});

describe('RegenEfficiencyWidget — standard layout', () => {
  it('renders the title, gauge percentage, and all three formatted stat tiles', () => {
    const { container } = renderWidget(STANDARD);

    expect(screen.getByText('Regen Braking')).toBeInTheDocument();
    // Gauge recovery label (rounded percentage) — 0.4 → 40%.
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(container.querySelector(GAUGE_SVG)).not.toBeNull();

    // Three stat tiles with their formatted values.
    expect(screen.getByText('Total Recovered')).toBeInTheDocument();
    expect(screen.getByText('1234 Wh')).toBeInTheDocument();
    expect(screen.getByText('Monthly Avg')).toBeInTheDocument();
    expect(screen.getByText('56 W')).toBeInTheDocument();

    // Free charges renders through the integer formatter within its own tile.
    const freeTile = screen.getByText('Free Charges').parentElement as HTMLElement;
    expect(within(freeTile).getByText('7')).toBeInTheDocument();

    // Energy/power formatters receive the SI value + the 1-dp precision override.
    expect(units.formatEnergy).toHaveBeenCalledWith(1234, { precision: 1 });
    expect(units.formatPower).toHaveBeenCalledWith(56, { precision: 1 });
  });

  it('exposes an accessible help affordance describing regen recovery', () => {
    renderWidget(STANDARD);

    expect(
      screen.getByRole('button', { name: 'More info about Regen Braking' }),
    ).toBeInTheDocument();
  });
});

describe('RegenEfficiencyWidget — compact layout', () => {
  it('renders the gauge without a title or the stat tiles', () => {
    const { container } = renderWidget(COMPACT);

    expect(screen.queryByText('Regen Braking')).toBeNull();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(container.querySelector(GAUGE_SVG)).not.toBeNull();
    // Stats are suppressed in the compact gauge hero.
    expect(screen.queryByText('Total Recovered')).toBeNull();
    expect(screen.queryByText('Monthly Avg')).toBeNull();
  });

  it('shows the empty state (never a blank panel) when there is no data', () => {
    mockRegen.mockReturnValue(qr({ data: undefined }));
    const { container } = renderWidget(COMPACT);

    expect(screen.getByText('No regen data')).toBeInTheDocument();
    expect(container.querySelector(GAUGE_SVG)).toBeNull();
  });
});

describe('RegenEfficiencyWidget — recovery colour thresholds', () => {
  it.each([
    { ratio: 0.5, label: '50%', color: GREEN, band: 'green' },
    { ratio: 0.31, label: '31%', color: GREEN, band: 'green' },
    { ratio: 0.3, label: '30%', color: AMBER, band: 'amber (boundary: 30 is not > 30)' },
    { ratio: 0.16, label: '16%', color: AMBER, band: 'amber' },
    { ratio: 0.15, label: '15%', color: RED, band: 'red (boundary: 15 is not > 15)' },
    { ratio: 0.05, label: '5%', color: RED, band: 'red' },
  ])('paints the gauge $band at $label recovery', ({ ratio, label, color }) => {
    mockRegen.mockReturnValue(qr({ data: makeData({ regenRatio: ratio }) }));
    const { container } = renderWidget(STANDARD);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector(`circle[stroke="${color}"]`)).not.toBeNull();
  });
});

describe('RegenEfficiencyWidget — shell states', () => {
  it('shows a loading skeleton (never a blank panel) with no gauge or empty state', () => {
    mockRegen.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(container.querySelector(GAUGE_SVG)).toBeNull();
    expect(screen.queryByText('No regen data')).toBeNull();
  });

  it('surfaces a query error (not an empty state) when the fetch fails', () => {
    mockRegen.mockReturnValue(
      qr({ isError: true, error: new Error('regen down'), data: undefined }),
    );
    renderWidget(STANDARD);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No regen data')).toBeNull();
  });

  it('renders an explicit empty state when the standard query resolves with no data', () => {
    mockRegen.mockReturnValue(qr({ data: undefined }));
    const { container } = renderWidget(STANDARD);

    expect(screen.getByText('No regen data')).toBeInTheDocument();
    expect(container.querySelector(GAUGE_SVG)).toBeNull();
  });
});

describe('RegenEfficiencyWidget — null-safety', () => {
  it('treats missing regen fields as zero/placeholder without crashing', () => {
    mockRegen.mockReturnValue(
      qr({
        data: makeData({
          regenRatio: undefined as unknown as number,
          totalRegenWh: undefined as unknown as number,
          monthlyAvgRegen: undefined as unknown as number,
          freeCharges: undefined as unknown as number,
        }),
      }),
    );
    const { container } = renderWidget(STANDARD);

    // regenRatio undefined → 0% gauge, red band (0 is not > 15).
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(container.querySelector(`circle[stroke="${RED}"]`)).not.toBeNull();

    // Energy + power formatters are still called with the undefined SI value and
    // return the placeholder (never a blank tile).
    expect(units.formatEnergy).toHaveBeenCalledWith(undefined, { precision: 1 });
    expect(units.formatPower).toHaveBeenCalledWith(undefined, { precision: 1 });
    expect(screen.getAllByText('—')).toHaveLength(2);

    // freeCharges undefined → integer formatter coalesces to "0".
    const freeTile = screen.getByText('Free Charges').parentElement as HTMLElement;
    expect(within(freeTile).getByText('0')).toBeInTheDocument();
  });
});

describe('RegenEfficiencyWidget — refresh wiring', () => {
  it('invokes the query refetch when the freshness control is activated (standard)', () => {
    const refetch = vi.fn();
    mockRegen.mockReturnValue(qr({ data: makeData(), refetch }));
    renderWidget(STANDARD);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('invokes the query refetch from the compact tile too', () => {
    const refetch = vi.fn();
    mockRegen.mockReturnValue(qr({ data: makeData(), refetch }));
    renderWidget(COMPACT);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
