/**
 * RegenEfficiencyWidget — behaviour + hardening tests.
 *
 * RegenEfficiencyWidget is a dashboard tile that resolves a target vehicle
 * (`vehicleId` prop → first vehicle from `useVehicles` → undefined) and reads
 * that vehicle's regenerative-braking rollup (`useRegenEfficiency`). It renders
 * one of two layouts inside `WidgetShell`:
 *   - compact (cols ≤ 1)  → a titled `WidgetGaugeHero` (recovery gauge
 *                            only, no stat tiles).
 *   - standard (cols > 1) → a titled shell (with a help affordance) wrapping the
 *                           gauge plus a 3-up stat strip: Total Recovered,
 *                           Drive Energy, and Free Charges (integer count).
 * The gauge stroke colour is threshold-driven: > 30% recovery is green, > 15% is
 * amber, everything else is red. The shell owns the loading skeleton, the error
 * `QueryError`, and the freshness / refresh affordance. The body is never a blank
 * panel — an explicit `EmptyState` stands in whenever there is no data.
 *
 * The two data hooks are mocked at their module boundaries so every orchestration
 * branch is deterministic and the network is never touched. `useUnits` is stubbed
 * with deterministic `formatEnergy` spies so the SI pass-through,
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
 *   - compact layout: heading and gauge without stat tiles; empty state.
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
  unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar', energy: 'kWh', power: 'kW', duration: 'h', locale: 'en-US' },
  formatEnergy: vi.fn((v?: number | null) => (v == null ? '—' : `${v} Wh`)),
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
import { hasGauge, hasGaugeColor } from '@/test/gaugeTestUtils';

const mockVehicles = vi.mocked(useVehicles);
const mockRegen = vi.mocked(useRegenEfficiency);

const STANDARD: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

// The LinearGauge progress arc is the only element carrying a hex `stroke`
// (the track uses `currentColor`), so this selector uniquely targets the gauge.
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
    vehicleId: 1,
    totalRegenWh: 1234,
    totalDriveWh: 5000,
    // `/analytics/regen` returns regen_ratio already as a percentage
    // (1234 / 5000 * 100), not a 0-1 fraction.
    regenRatio: 24.7,
    monthlyAvgRegen: 56,
    freeCharges: 7,
    monthlySummary: [],
    drives: [],
    batteryCapacityWh: 75_000,
    capacitySource: 'default',
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

it.each([1, 2, 3])('keeps an accessible heading at %s columns', cols => {
  renderWidget({ cols, rows: 2 });
  expect(screen.getByRole('heading', { name: 'Regen braking', level: 3 })).toBeVisible();
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

    expect(screen.getByText('Regen braking')).toBeInTheDocument();
    // Gauge recovery label (rounded percentage) — 24.7 → 25%.
    expect(screen.getByText('24.70%')).toBeInTheDocument();
    expect(hasGauge(container)).toBe(true);

    // Three stat tiles with their formatted values.
    expect(screen.getByText('Total recovered')).toBeInTheDocument();
    expect(screen.getByText('1234 Wh')).toBeInTheDocument();
    expect(screen.getByText('Drive energy')).toBeInTheDocument();
    expect(screen.getByText('5000 Wh')).toBeInTheDocument();

    // Free charges renders through the integer formatter within its own tile.
    const freeTile = screen.getByText('Free charges').closest('[data-operational-metric]') as HTMLElement;
    expect(within(freeTile).getByText('7')).toBeInTheDocument();

    expect(units.formatEnergy).toHaveBeenCalledWith(1234);
    expect(units.formatEnergy).toHaveBeenCalledWith(5000);
  });

  it('exposes an accessible help affordance describing regen recovery', () => {
    renderWidget(STANDARD);

    expect(
      screen.getByRole('button', { name: 'More info about Regen braking' }),
    ).toBeInTheDocument();
  });
});

describe('RegenEfficiencyWidget — compact layout', () => {
  it('renders the heading and gauge without the stat tiles', () => {
    const { container } = renderWidget(COMPACT);

    expect(screen.getByRole('heading', { name: 'Regen braking', level: 3 })).toBeVisible();
    expect(screen.getByText('24.70%')).toBeInTheDocument();
    expect(hasGauge(container)).toBe(true);
    // Stats are suppressed in the compact gauge hero.
    expect(screen.queryByText('Total recovered')).toBeNull();
    expect(screen.queryByText('Drive energy')).toBeNull();
  });

  it('shows the empty state (never a blank panel) when there is no data', () => {
    mockRegen.mockReturnValue(qr({ data: undefined }));
    const { container } = renderWidget(COMPACT);

    expect(screen.getByText('No regen data')).toBeInTheDocument();
    expect(hasGauge(container)).toBe(false);
  });
});

describe('RegenEfficiencyWidget — recovery colour thresholds', () => {
  it.each([
    { ratio: 50, label: '50.00%', color: GREEN, band: 'green' },
    { ratio: 31, label: '31.00%', color: GREEN, band: 'green' },
    { ratio: 30, label: '30.00%', color: AMBER, band: 'amber (boundary: 30 is not > 30)' },
    { ratio: 16, label: '16.00%', color: AMBER, band: 'amber' },
    { ratio: 15, label: '15.00%', color: RED, band: 'red (boundary: 15 is not > 15)' },
    { ratio: 5, label: '5.00%', color: RED, band: 'red' },
  ])('paints the gauge $band at $label recovery', ({ ratio, label, color }) => {
    mockRegen.mockReturnValue(qr({ data: makeData({ regenRatio: ratio }) }));
    const { container } = renderWidget(STANDARD);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(hasGaugeColor(container, color)).toBe(true);
  });
});

describe('RegenEfficiencyWidget — API scale contract', () => {
  it('does not re-scale the percentage the API already returns', () => {
    // Regression: the widget multiplied regen_ratio by 100. Because
    // /analytics/regen returns regenWh / driveWh * 100 (a percentage), a real
    // 25% recovery rendered as "2500%", the gauge clamped to its 100 max so it
    // sat permanently full, and regenColor's > 30 branch made it always green.
    mockRegen.mockReturnValue(qr({ data: makeData({ regenRatio: 25 }) }));
    const { container } = renderWidget(STANDARD);

    expect(screen.getByText('25.00%')).toBeInTheDocument();
    expect(screen.queryByText('2500%')).toBeNull();
    // 25 is not > 30, so the band must be amber — proof the colour thresholds
    // still discriminate rather than saturating green.
    expect(hasGaugeColor(container, AMBER)).toBe(true);
    expect(hasGaugeColor(container, GREEN)).toBe(false);
  });

  it('keeps the gauge off its ceiling for a typical recovery rate', () => {
    mockRegen.mockReturnValue(qr({ data: makeData({ regenRatio: 18 }) }));
    renderWidget(STANDARD);

    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '18');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
  });
});

describe('RegenEfficiencyWidget — shell states', () => {
  it('shows a loading skeleton (never a blank panel) with no gauge or empty state', () => {
    mockRegen.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(hasGauge(container)).toBe(false);
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
    expect(hasGauge(container)).toBe(false);
  });
});

describe('RegenEfficiencyWidget — null-safety', () => {
  it('does not replace an out-of-scale recovery reading with the visual ceiling', () => {
    const data = makeData({ regenRatio: 125 });
    mockRegen.mockReturnValue(qr({ data }));
    renderWidget(STANDARD);
    expect(screen.getByText('125.00%')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByRole('group', { name: '125.00%' })).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText('1234 Wh')).toBeInTheDocument();
    expect(screen.getByText('5000 Wh')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(data.regenRatio).toBe(125);
  });

  it('preserves signed recovered energy and a genuine zero recovery ratio', () => {
    mockRegen.mockReturnValue(qr({ data: makeData({ regenRatio: 0, totalRegenWh: -1234, freeCharges: 0 }) }));
    renderWidget(STANDARD);
    expect(screen.getByText('0.00%')).toBeInTheDocument();
    expect(screen.getByText('-1234 Wh')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
  });

  it('retains all readings on refresh failure and exposes a warning retry', () => {
    const refetch = vi.fn();
    mockRegen.mockReturnValue(qr({ data: makeData(), error: new Error('offline'), isError: true, refetch }));
    renderWidget(STANDARD);
    expect(screen.getByText('24.70%')).toBeInTheDocument();
    expect(screen.getByText('1234 Wh')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps missing regen fields unknown and never renders a zero gauge', () => {
    mockRegen.mockReturnValue(
      qr({
        data: makeData({
          regenRatio: undefined as unknown as number,
          totalRegenWh: undefined as unknown as number,
          totalDriveWh: undefined as unknown as number,
          freeCharges: undefined as unknown as number,
        }),
      }),
    );
    const { container } = renderWidget(STANDARD);

    expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
    expect(hasGauge(container)).toBe(false);

    // The actual bridge validates missing values before specialist formatting.
    expect(units.formatEnergy).not.toHaveBeenCalled();
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('reviews actual retained watt-hour sources without relabelling absolute drive power as regeneration', () => {
    mockRegen.mockReturnValue(qr({ data: makeData(), isError: true, error: new Error('refresh failed') }));
    renderWidget(STANDARD, { vehicleId: 42 });
    const brief = screen.getByTestId('regen-efficiency-operational-brief');
    expect(within(brief).getByText('Retained readings')).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('1234 Wh')).toBeInTheDocument();
    expect(within(drawer).getByText('5000 Wh')).toBeInTheDocument();
    expect(within(drawer).getByText('7')).toBeInTheDocument();
    expect(within(drawer).getByText(/absolute drive power is not regenerative power/)).toBeInTheDocument();
    expect(within(drawer).getByText(/Vehicle 42/, { selector: '[data-drawer-header] span' })).toBeInTheDocument();
  });
});

describe('RegenEfficiencyWidget — refresh wiring', () => {
  it('invokes the query refetch when the freshness control is activated (standard)', () => {
    const refetch = vi.fn();
    mockRegen.mockReturnValue(qr({ data: makeData(), refetch }));
    renderWidget(STANDARD);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('invokes the query refetch from the compact tile too', () => {
    const refetch = vi.fn();
    mockRegen.mockReturnValue(qr({ data: makeData(), refetch }));
    renderWidget(COMPACT);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
