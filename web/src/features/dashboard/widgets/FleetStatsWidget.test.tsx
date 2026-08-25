/**
 * FleetStatsWidget — behaviour + hardening tests.
 *
 * FleetStatsWidget is the dashboard orchestrator behind the fleet KPI strip. It
 * resolves the primary vehicle (`useVehicles().data[0]`), pulls the 30-day fleet
 * rollup (`useFleetAnalytics`), streams that vehicle's five most-recent drives
 * and charges via a raw `useQuery` + `request`, derives display-unit converters
 * from `useUnits`, and hands everything to the pure `FleetStatsBar` inside a
 * `WidgetShell` (freshness + refresh affordance, never a blank panel).
 *
 * The data hooks are mocked at their module boundaries so orchestration is
 * deterministic; the raw drive/charge queries run through a REAL
 * QueryClientProvider against a mocked `request`, so the snake-case SI URLs and
 * the `enabled: primaryId > 0` gate are exercised for real without touching the
 * network. `useUnits` is stubbed so the km / mi branch flips per test while the
 * REAL SI converters (`convertDistanceFromSI`) still run — this is what proves
 * the distance fix. `react-i18next` is echo-mocked (returns the English
 * fallback, interpolating `{{var}}`); `useSettings` / `useTimezone` come from
 * the global stub in src/test-setup.ts. `matchMedia` reports reduced-motion so
 * the `AnimatedNumber` count-ups land on their final values synchronously and
 * the rendered magnitudes are inspectable.
 *
 * Facets covered:
 *   - fleet counts: vehicle count, online-only filter, energy pass-through.
 *   - distance conversion (the fix / regression): total_distance_km is already
 *     kilometres, so it is restated to SI metres before convertDistanceFromSI —
 *     1,000 km must render at full magnitude ("1,000 km"), and 1,609.344 km must
 *     become "1,000 mi", not the 1000×-too-small "1 km" / "1 mi".
 *   - efficiency conversion: Wh/km passes straight through for metric users and
 *     is restated as Wh/mi (× 1.609344) for imperial users, with a matching unit.
 *   - recent queries: the primary vehicle's drives & charges are fetched with
 *     snake_case, prefix-free, limit-capped URLs, and both sparklines paint.
 *   - the `enabled` gate: with no primary vehicle the queries never fire.
 *   - resilience: undefined vehicles + analytics still render all five tiles
 *     with placeholder zeros (never a blank panel); an analytics error is
 *     surfaced through the freshness dot without blanking the strip.
 *   - refresh wiring: activating the freshness control retries the analytics query.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent, cleanup } from '@testing-library/react';
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

// The two orchestration hooks are mocked so the widget's inputs are deterministic.
vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicles: vi.fn() };
});
vi.mock('@/api/hooks/useAnalytics', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useAnalytics')>();
  return { ...actual, useFleetAnalytics: vi.fn() };
});

// useUnits stub — lets each test flip the display distance unit (km / mi) while
// the real SI converters in @/lib/unitConversion still execute.
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));

// The raw drive/charge queries go through the real QueryClient against a mocked
// request(); the rest of the client surface is preserved.
vi.mock('@/api/client', async (importActual) => {
  const actual = await importActual<typeof import('@/api/client')>();
  return { ...actual, request: vi.fn() };
});

// jsdom lacks matchMedia. Report reduced-motion so AnimatedNumber lands on its
// final value synchronously and the count-up magnitudes are assertable.
window.matchMedia = ((query: string) => ({
  matches: /prefers-reduced-motion/.test(query),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

import FleetStatsWidget from './FleetStatsWidget';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { useUnits } from '@/hooks/useUnits';
import { request } from '@/api/client';
import type { FleetAnalytics, Drive, ChargingSession } from '../types';
import type { WidgetSize } from './types';

const mockVehicles = vi.mocked(useVehicles);
const mockAnalytics = vi.mocked(useFleetAnalytics);
const mockUnits = vi.mocked(useUnits);
const mockRequest = vi.mocked(request);

const SIZE: WidgetSize = { cols: 5, rows: 1 };

/** Minimal analytics `UseQueryResult` stub (incl. the DataFreshness fields). */
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

/** `useVehicles()` stub — the widget reads `.data[0].id`, `.length`, `.state`. */
function vehicles(list: Array<{ id: number; state?: string }>): never {
  return { data: list } as never;
}

function makeAnalytics(over: Partial<FleetAnalytics> = {}): FleetAnalytics {
  return {
    total_vehicles: 3,
    total_drives: 10,
    total_charging_sessions: 5,
    total_distance_km: 1000,
    total_energy_kwh: 250,
    total_cost: 0,
    avg_efficiency_wh_km: 160,
    period_days: 30,
    ...over,
  };
}

const DRIVES = [
  { distance_m: 3000 },
  { distance_m: 5000 },
  { distance_m: 4000 },
] as Drive[];

const CHARGES = [
  { total_energy_added_wh: 12000 },
  { total_energy_added_wh: 8000 },
  { total_energy_added_wh: 15000 },
] as ChargingSession[];

function renderWidget() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FleetStatsWidget size={SIZE} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Let the real drive/charge queries resolve so both sparklines paint. */
async function settleSparklines() {
  await waitFor(() =>
    expect(document.querySelectorAll('polyline')).toHaveLength(2),
  );
}

function group(name: string): HTMLElement {
  return screen.getByRole('group', { name });
}

beforeEach(() => {
  mockVehicles.mockReturnValue(
    vehicles([
      { id: 1, state: 'online' },
      { id: 2, state: 'offline' },
      { id: 3, state: 'online' },
    ]),
  );
  mockAnalytics.mockReturnValue(qr({ data: makeAnalytics() }));
  mockUnits.mockReturnValue({ unitPrefs: { distance: 'km' } } as never);
  mockRequest.mockImplementation(
    ((path: string) =>
      path.startsWith('/charging')
        ? Promise.resolve(CHARGES)
        : Promise.resolve(DRIVES)) as unknown as typeof request,
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FleetStatsWidget — fleet counts & delegation', () => {
  it('renders all five tiles with the vehicle count, online-only count, and energy pass-through', async () => {
    const { container } = renderWidget();
    await settleSparklines();

    // Five labelled KPI tiles — never a blank panel.
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(5);

    // Fleet size = data.length (3); online = state === 'online' filter (2 of 3).
    const size = group('Fleet Size');
    expect(within(size).getByText('3')).toBeInTheDocument();
    expect(size).toHaveTextContent('2 online');

    // total_energy_kwh is already kWh → shown verbatim at one decimal.
    expect(group('Energy (30d)')).toHaveTextContent('250.0 kWh');
  });
});

describe('FleetStatsWidget — SI distance conversion (regression)', () => {
  it('restates the already-kilometre total to SI metres so km renders at full magnitude', async () => {
    // total_distance_km = 1000. The bug (feeding km straight to the metres
    // converter) rendered this as "1 km"; the fix restores "1,000 km".
    renderWidget();
    await settleSparklines();

    expect(group('Distance (30d)')).toHaveTextContent('1,000 km');
    expect(group('Distance (30d)')).not.toHaveTextContent('1 km');
  });

  it('converts kilometres to miles for imperial users (1,609.344 km → 1,000 mi)', async () => {
    mockUnits.mockReturnValue({ unitPrefs: { distance: 'mi' } } as never);
    mockAnalytics.mockReturnValue(qr({ data: makeAnalytics({ total_distance_km: 1609.344 }) }));

    renderWidget();
    await settleSparklines();

    const distance = group('Distance (30d)');
    expect(distance).toHaveTextContent('1,000 mi');
    expect(distance).not.toHaveTextContent('1 mi');
    // The efficiency tile relabels to the imperial unit alongside it.
    expect(group('Efficiency')).toHaveTextContent('Wh/mi');
  });
});

describe('FleetStatsWidget — efficiency conversion', () => {
  it('passes Wh/km straight through for metric users', async () => {
    mockAnalytics.mockReturnValue(qr({ data: makeAnalytics({ avg_efficiency_wh_km: 160 }) }));
    renderWidget();
    await settleSparklines();

    expect(group('Efficiency')).toHaveTextContent('160 Wh/km');
  });

  it('restates Wh/km as Wh/mi (× 1.609344) for imperial users', async () => {
    mockUnits.mockReturnValue({ unitPrefs: { distance: 'mi' } } as never);
    mockAnalytics.mockReturnValue(qr({ data: makeAnalytics({ avg_efficiency_wh_km: 200 }) }));

    renderWidget();
    await settleSparklines();

    // 200 Wh/km × 1.609344 km/mi = 321.8688 Wh/mi → "322" at 0 decimals.
    expect(group('Efficiency')).toHaveTextContent('322 Wh/mi');
  });
});

describe('FleetStatsWidget — recent drive & charge queries', () => {
  it('fetches the primary vehicle drives & charges with snake_case, prefix-free, capped URLs', async () => {
    const { container } = renderWidget();
    await settleSparklines();

    // Raw SI query strings: vehicle_id (snake_case), limit=5, and NO /api/v1 prefix.
    expect(mockRequest).toHaveBeenCalledWith('/drives?vehicle_id=1&limit=5');
    expect(mockRequest).toHaveBeenCalledWith('/charging?vehicle_id=1&limit=5');

    // Both trend sparklines paint once their series arrive.
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
  });

  it('never issues the drive/charge queries when there is no primary vehicle', async () => {
    mockVehicles.mockReturnValue(vehicles([]));
    renderWidget();

    // `enabled: primaryId > 0` keeps both queries idle — request is untouched.
    await waitFor(() => expect(screen.getAllByRole('group')).toHaveLength(5));
    expect(mockRequest).not.toHaveBeenCalled();
    expect(within(group('Fleet Size')).getByText('0')).toBeInTheDocument();
  });
});

describe('FleetStatsWidget — resilience & shell wiring', () => {
  it('renders every tile with placeholder zeros when vehicles and analytics are undefined', () => {
    mockVehicles.mockReturnValue({ data: undefined } as never);
    mockAnalytics.mockReturnValue(qr({ data: undefined }));

    const { container } = renderWidget();

    // No section is hidden — the strip degrades to zeros, never a blank panel.
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(5);
    expect(group('Distance (30d)')).toHaveTextContent('0 km');
    expect(group('Energy (30d)')).toHaveTextContent('0.0 kWh');
    // No primary vehicle → the recent queries stay idle.
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('surfaces an analytics fetch error through the freshness dot without blanking the tiles', () => {
    mockVehicles.mockReturnValue(vehicles([]));
    mockAnalytics.mockReturnValue(
      qr({ isError: true, error: new Error('fleet down'), data: undefined }),
    );

    const { container } = renderWidget();

    // The error is communicated by the freshness chip…
    expect(container.querySelector('.bg-red-400')).not.toBeNull();
    // …while all five tiles still render (never a blank panel).
    expect(screen.getAllByRole('group')).toHaveLength(5);
  });

  it('retries the analytics query when the freshness control is activated', () => {
    const refetch = vi.fn();
    mockVehicles.mockReturnValue(vehicles([]));
    mockAnalytics.mockReturnValue(qr({ data: makeAnalytics(), refetch }));

    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
