/**
 * BatteryComparison — behavioural coverage + hardening regression tests.
 *
 * BatteryComparison fans out one `fetchVehicleState` request per vehicle inside
 * a single react-query query, then renders a battery bar per vehicle whose live
 * state resolved. It owns its own loading / empty states and must never leave a
 * blank panel behind.
 *
 * Coverage:
 *   1. Populated — one accessible progressbar per resolved vehicle, with the
 *      display name, clamped level %, SI→unit range, and the request fan-out.
 *   2. Failure isolation — a vehicle whose state fetch rejects is dropped, the
 *      rest still render (the per-vehicle try/catch branch).
 *   3. Empty — every vehicle resolves without state → the shared empty state
 *      shows instead of a hidden/blank panel.
 *   4. Loading — an in-flight fan-out renders the skeleton, no bars yet.
 *   5. No vehicles — renders nothing and never touches the network.
 *   6. Clamp — out-of-range / non-finite battery levels collapse to 0–100.
 *   7. Colour — the bar fill is mapped from the level through batteryColor.
 *
 * `fetchVehicleState` is the only network seam and is fully mocked; the real
 * useUnits + lib/unitConversion run on top of the globally-mocked km settings,
 * so the SI→display conversion is exercised end-to-end. Network is never hit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Vehicle, VehicleState } from '@/api/types';
import { BatteryComparison } from './BatteryComparison';

// ── i18n: echo the English fallback so assertions read on human copy. ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) =>
      typeof defaultValue === 'string' ? defaultValue : key,
  }),
}));

// ── The only network seam. ──
vi.mock('@/api/hooks/useVehicles', () => ({
  fetchVehicleState: vi.fn(),
}));

import { fetchVehicleState } from '@/api/hooks/useVehicles';

const mockFetch = fetchVehicleState as unknown as ReturnType<typeof vi.fn>;

function makeVehicle(id: number, display_name = `Car ${id}`, vin = `VIN${id}`): Vehicle {
  return { id, display_name, vin } as unknown as Vehicle;
}

/** Minimal VehicleState — the component only reads battery_level + rated_range. */
function makeState(battery_level: number, rated_range = 300_000): VehicleState {
  return { battery_level, rated_range } as unknown as VehicleState;
}

function resolvedFleet(map: Record<number, VehicleState | null>) {
  mockFetch.mockImplementation(async (id: number) => {
    const state = map[id];
    if (state === undefined) throw new Error(`no fixture for ${id}`);
    return { state: state ?? undefined, live: state !== null };
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderComparison(vehicles: Vehicle[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<BatteryComparison vehicles={vehicles} />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('BatteryComparison', () => {
  it('renders an accessible battery bar per vehicle with clamped level and converted range', async () => {
    resolvedFleet({
      1: makeState(82, 300_000), // 300 km
      2: makeState(37, 150_000), // 150 km
    });

    renderComparison([makeVehicle(1, 'Model 3'), makeVehicle(2, 'Model Y')]);

    // Header is always present.
    expect(screen.getByText('Fleet Battery Status')).toBeInTheDocument();

    // One progressbar per resolved vehicle, each with an accessible name.
    const bars = await screen.findAllByRole('progressbar');
    expect(bars).toHaveLength(2);

    // Names + level readouts surface.
    expect(screen.getByText('Model 3')).toBeInTheDocument();
    expect(screen.getByText('Model Y')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('37%')).toBeInTheDocument();

    // aria-valuenow mirrors the level and the fill width tracks it.
    const bar1 = screen.getByRole('progressbar', { name: /Model 3 battery level/i });
    expect(bar1).toHaveAttribute('aria-valuenow', '82');
    expect(bar1).toHaveAttribute('aria-valuemax', '100');
    expect((bar1.firstElementChild as HTMLElement).style.width).toBe('82%');

    // SI metres are converted to the user's km unit (real useUnits pipeline).
    expect(screen.getByText(/300(\.\d+)?\s*km/)).toBeInTheDocument();
    expect(screen.getByText(/150(\.\d+)?\s*km/)).toBeInTheDocument();

    // Exactly one request per vehicle, keyed by id.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith(1);
    expect(mockFetch).toHaveBeenCalledWith(2);
  });

  it('drops vehicles whose state fetch fails while keeping the rest', async () => {
    mockFetch.mockImplementation(async (id: number) => {
      if (id === 2) throw new Error('offline');
      return { state: makeState(64), live: true };
    });

    renderComparison([makeVehicle(1, 'Keeper'), makeVehicle(2, 'Faulty')]);

    const bars = await screen.findAllByRole('progressbar');
    expect(bars).toHaveLength(1);
    expect(screen.getByText('Keeper')).toBeInTheDocument();
    expect(screen.queryByText('Faulty')).not.toBeInTheDocument();
  });

  it('shows the empty state — not a blank panel — when no vehicle has battery data', async () => {
    resolvedFleet({ 1: null, 2: null });

    renderComparison([makeVehicle(1), makeVehicle(2)]);

    // Header stays; the shared empty state (role=status) replaces the bars.
    expect(screen.getByText('Fleet Battery Status')).toBeInTheDocument();
    expect(
      await screen.findByText('No battery data available for the current fleet.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('renders a loading skeleton while the fleet states are in flight', async () => {
    const pending = deferred<{ state?: VehicleState; live: boolean }>();
    mockFetch.mockReturnValue(pending.promise);

    renderComparison([makeVehicle(1), makeVehicle(2)]);

    // Skeleton visible, no bars and no empty state yet.
    expect(screen.getByTestId('battery-comparison-loading')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(
      screen.queryByText('No battery data available for the current fleet.'),
    ).not.toBeInTheDocument();

    // Settle so the query resolves and the skeleton is replaced.
    pending.resolve({ state: makeState(55), live: true });
    await waitFor(() =>
      expect(screen.queryByTestId('battery-comparison-loading')).not.toBeInTheDocument(),
    );
    expect(await screen.findAllByRole('progressbar')).toHaveLength(2);
  });

  it('renders nothing and never fetches when there are no vehicles', () => {
    const { container } = renderComparison([]);
    expect(container).toBeEmptyDOMElement();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('clamps out-of-range and non-finite battery levels into 0–100', async () => {
    resolvedFleet({
      1: makeState(150), // over-range → 100
      2: makeState(-20), // under-range → 0
      3: makeState(Number.NaN), // non-finite → 0
    });

    renderComparison([
      makeVehicle(1, 'Over'),
      makeVehicle(2, 'Under'),
      makeVehicle(3, 'Nan'),
    ]);

    const over = await screen.findByRole('progressbar', { name: /Over battery level/i });
    const under = screen.getByRole('progressbar', { name: /Under battery level/i });
    const nan = screen.getByRole('progressbar', { name: /Nan battery level/i });

    expect(over).toHaveAttribute('aria-valuenow', '100');
    expect(under).toHaveAttribute('aria-valuenow', '0');
    expect(nan).toHaveAttribute('aria-valuenow', '0');
    expect((over.firstElementChild as HTMLElement).style.width).toBe('100%');
    expect((under.firstElementChild as HTMLElement).style.width).toBe('0%');
  });

  it('colours the bar fill from the battery level', async () => {
    resolvedFleet({
      1: makeState(85), // good → emerald
      2: makeState(40), // warning → amber
      3: makeState(12), // critical → red
    });

    renderComparison([
      makeVehicle(1, 'High'),
      makeVehicle(2, 'Mid'),
      makeVehicle(3, 'Low'),
    ]);

    const high = await screen.findByRole('progressbar', { name: /High battery level/i });
    const mid = screen.getByRole('progressbar', { name: /Mid battery level/i });
    const low = screen.getByRole('progressbar', { name: /Low battery level/i });

    expect((high.firstElementChild as HTMLElement).getAttribute('style')).toContain('#10b981');
    expect((mid.firstElementChild as HTMLElement).getAttribute('style')).toContain('#f59e0b');
    expect((low.firstElementChild as HTMLElement).getAttribute('style')).toContain('#ef4444');
  });
});
