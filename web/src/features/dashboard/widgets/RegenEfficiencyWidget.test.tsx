/**
 * RegenEfficiencyWidget — behaviour + hardening tests.
 *
 * RegenEfficiencyWidget is a dashboard tile that resolves a target vehicle
 * (`vehicleId` prop → first vehicle from `useVehicles` → undefined) and reads
 * that vehicle's regenerative-braking rollup (`useRegenEfficiency`). It renders
 * one of two layouts inside `WidgetShell`:
 *   - compact (cols ≤ 1)  → a titleless `WidgetGaugeHero` (recovery gauge
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
    // Gauge recovery label (rounded percentage) — 24.7 → 25%.
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(hasGauge(container)).toBe(true);

    // Three stat tiles with their formatted values.
    expect(screen.getByText('Total Recovered')).toBeInTheDocument();
    expect(screen.getByText('1234 Wh')).toBeInTheDocument();
    expect(screen.getByText('Drive Energy')).toBeInTheDocument();
    expect(screen.getByText('5000 Wh')).toBeInTheDocument();

    // Free charges renders through the integer formatter within its own tile.
    const freeTile = screen.getByText('Free Charges').parentElement as HTMLElement;
    expect(within(freeTile).getByText('7')).toBeInTheDocument();

    // Energy formatters receive both SI values + the 1-dp precision override.
    expect(units.formatEnergy).toHaveBeenCalledWith(1234, { precision: 1 });
    expect(units.formatEnergy).toHaveBeenCalledWith(5000, { precision: 1 });
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
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(hasGauge(container)).toBe(true);
    // Stats are suppressed in the compact gauge hero.
    expect(screen.queryByText('Total Recovered')).toBeNull();
    expect(screen.queryByText('Drive Energy')).toBeNull();
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
    { ratio: 50, label: '50%', color: GREEN, band: 'green' },
    { ratio: 31, label: '31%', color: GREEN, band: 'green' },
    { ratio: 30, label: '30%', color: AMBER, band: 'amber (boundary: 30 is not > 30)' },
    { ratio: 16, label: '16%', color: AMBER, band: 'amber' },
    { ratio: 15, label: '15%', color: RED, band: 'red (boundary: 15 is not > 15)' },
    { ratio: 5, label: '5%', color: RED, band: 'red' },
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

    expect(screen.getByText('25%')).toBeInTheDocument();
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

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
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
  it('treats missing regen fields as zero/placeholder without crashing', () => {
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

    // regenRatio undefined → 0% gauge, red band (0 is not > 15).
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(hasGaugeColor(container, RED)).toBe(true);

    // Both energy formatters are still called; missing drive energy returns
    // the placeholder (never a blank tile).
    expect(units.formatEnergy).toHaveBeenCalledWith(undefined, { precision: 1 });
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
