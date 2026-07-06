/**
 * RangeEstimateWidget contract + hardening tests.
 *
 * The widget is a self-refreshing dashboard tile that surfaces a vehicle's
 * rated + ideal range from `GET /vehicles/{id}/state` (read through
 * `useVehicleState`). Its whole shape is a function of three inputs: the
 * resolved vehicle id (`vehicleId` prop, else the first fleet vehicle, else
 * none/0), the state query result, and the user's distance preference:
 *
 *   - a resolved `state` snapshot → the two labelled range rows.
 *   - no snapshot                → the accessible "No range data" empty state.
 *   - isLoading                  → skeleton chrome only.
 *   - a hard query error         → QueryError (never the misleading empty state).
 *
 * Two layers are locked here:
 *
 *  A. The pure `formatRange` helper (exported for testability): the SI-metres →
 *     display-unit conversion (km + mi), whole-unit rounding, the unit suffix,
 *     and — crucially — the null-safety contract that distinguishes a genuine,
 *     finite zero ("0 km") from an absent / non-finite reading ("—"). The old
 *     code coalesced null to a fabricated "0 km" that read as a dead battery;
 *     this test pins the fix.
 *
 *  B. The component behaviour: populated view, °-unit-agnostic conversion, the
 *     null → em-dash placeholder, the vehicle-id resolution fallback chain, the
 *     loading / empty / error lifecycle branches, and the accessible refresh
 *     control.
 *
 * i18n is stubbed to echo the English fallback so every copy assertion is real,
 * `@/hooks/useUnits` is stubbed so the distance preference is injectable, and
 * `@/api/hooks/useVehicles` is partially mocked (the real module is preserved,
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

// The distance preference is injected per-test through a mutable holder so the
// SI → display conversion can be exercised for both km and mi. The widget only
// reads `unitPrefs.distance`, so a partial stub is sufficient.
let MOCK_DISTANCE_UNIT: DistanceUnitPref;
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: MOCK_DISTANCE_UNIT } }),
}));

// The fleet list + state query result are injected per-test through these
// mutable holders (the `MOCK_`/`mock` prefixes let vitest hoist the factory
// above them safely). Only the two hooks the widget reads are overridden — the
// rest of the real module is preserved so transitive importers keep working.
const mockUseVehicleState = vi.fn((_id: number) => MOCK_STATE);
let MOCK_VEHICLES: { data: Vehicle[] | undefined };
let MOCK_STATE: StateResult;
vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return {
    ...actual,
    useVehicles: () => MOCK_VEHICLES,
    useVehicleState: (id: number) => mockUseVehicleState(id),
  };
});

import RangeEstimateWidget, { formatRange } from './RangeEstimateWidget';
import type { WidgetSize } from './types';
import type { VehicleState } from '@/api/types';
import type { Vehicle } from '@/types/vehicle';
import type { DistanceUnitPref } from '@/lib/unitConversion';

/** Only the fields the widget reads off the `useVehicleState` result. */
interface StateResult {
  data: { state?: VehicleState; live: boolean } | undefined;
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

/**
 * Build a VehicleState carrying only the two range fields the widget reads.
 * The override type widens `rated_range`/`ideal_range` to allow the null the
 * backend can actually send (the interface types them non-null).
 */
type StateOverrides = Omit<Partial<VehicleState>, 'rated_range' | 'ideal_range'> & {
  rated_range?: number | null;
  ideal_range?: number | null;
};

function makeState(overrides: StateOverrides = {}): VehicleState {
  return {
    vehicle_id: 7,
    state: 'online',
    rated_range: 0,
    ideal_range: 0,
    ...overrides,
  } as unknown as VehicleState;
}

function makeQuery(overrides: Partial<StateResult> = {}): StateResult {
  return {
    data: { state: makeState({ rated_range: 500_000, ideal_range: 480_000 }), live: true },
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

function fleet(...ids: number[]): Vehicle[] {
  return ids.map((id) => ({ id })) as unknown as Vehicle[];
}

interface RenderOpts {
  query?: StateResult;
  vehicles?: Vehicle[];
  vehicleId?: number;
  distanceUnit?: DistanceUnitPref;
}

function renderWidget(opts: RenderOpts = {}) {
  MOCK_STATE = opts.query ?? makeQuery();
  MOCK_VEHICLES = { data: opts.vehicles ?? [] };
  MOCK_DISTANCE_UNIT = opts.distanceUnit ?? 'km';
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RangeEstimateWidget vehicleId={opts.vehicleId} size={FULL} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  MOCK_VEHICLES = { data: [] };
  MOCK_STATE = makeQuery();
  MOCK_DISTANCE_UNIT = 'km';
  mockUseVehicleState.mockClear();
});

afterEach(() => {
  cleanup();
});

// ── A. Pure helper ──────────────────────────────────────────────────────────

describe('formatRange', () => {
  it('converts SI metres to the display unit, rounds to whole units, and appends it', () => {
    expect(formatRange(500_000, 'km')).toBe('500 km');
    // 123_456 m → 123.456 km, rounded to the nearest whole unit.
    expect(formatRange(123_456, 'km')).toBe('123 km');
    // 1 mile = 1609.344 m → 482803.2 m is exactly 300 mi.
    expect(formatRange(482_803.2, 'mi')).toBe('300 mi');
  });

  it('keeps a real zero but renders an em-dash for absent / non-finite input', () => {
    // A finite zero is a legitimate reading (empty battery), not "no data".
    expect(formatRange(0, 'km')).toBe('0 km');
    // Null / undefined / NaN / Infinity are "no data" → placeholder, never "0 km".
    expect(formatRange(null, 'km')).toBe('—');
    expect(formatRange(undefined, 'km')).toBe('—');
    expect(formatRange(Number.NaN, 'mi')).toBe('—');
    expect(formatRange(Number.POSITIVE_INFINITY, 'km')).toBe('—');
  });
});

// ── B. Component behaviour ──────────────────────────────────────────────────

describe('RangeEstimateWidget — populated', () => {
  it('renders both labels and the SI→km-converted rated + ideal ranges', () => {
    renderWidget({
      vehicleId: 7,
      query: makeQuery({
        data: { state: makeState({ rated_range: 500_000, ideal_range: 480_000 }), live: true },
      }),
    });

    expect(screen.getByText('Rated Range')).toBeInTheDocument();
    expect(screen.getByText('Ideal Range')).toBeInTheDocument();
    expect(screen.getByText('500 km')).toBeInTheDocument();
    expect(screen.getByText('480 km')).toBeInTheDocument();
    // A present snapshot never shows the empty state.
    expect(screen.queryByText('No range data')).toBeNull();
  });

  it('converts the SI ranges to miles when that is the distance preference', () => {
    renderWidget({
      vehicleId: 7,
      distanceUnit: 'mi',
      query: makeQuery({
        data: {
          state: makeState({ rated_range: 482_803.2, ideal_range: 321_868.8 }),
          live: true,
        },
      }),
    });

    // 482803.2 m → 300 mi, 321868.8 m → 200 mi; the km unit never appears.
    expect(screen.getByText('300 mi')).toBeInTheDocument();
    expect(screen.getByText('200 mi')).toBeInTheDocument();
    expect(screen.queryByText(/km/)).toBeNull();
  });

  it('renders an em-dash for a null range but keeps a genuine zero', () => {
    renderWidget({
      vehicleId: 7,
      query: makeQuery({
        data: { state: makeState({ rated_range: null, ideal_range: 0 }), live: true },
      }),
    });

    // Rated is absent → placeholder; ideal is a real 0 → "0 km" (not a dash).
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('0 km')).toBeInTheDocument();
    // The section chrome still renders (never a blank panel).
    expect(screen.getByText('Rated Range')).toBeInTheDocument();
    expect(screen.getByText('Ideal Range')).toBeInTheDocument();
  });
});

describe('RangeEstimateWidget — vehicle resolution', () => {
  it('queries the explicit vehicleId when one is provided', () => {
    renderWidget({ vehicleId: 7 });
    expect(mockUseVehicleState).toHaveBeenCalledWith(7);
  });

  it('falls back to the first fleet vehicle when no vehicleId is given', () => {
    renderWidget({ vehicles: fleet(3, 9) });
    expect(mockUseVehicleState).toHaveBeenCalledWith(3);
  });

  it('resolves to id 0 (disabled) when neither a prop nor a fleet vehicle exists', () => {
    renderWidget({ vehicles: [] });
    expect(mockUseVehicleState).toHaveBeenCalledWith(0);
  });
});

describe('RangeEstimateWidget — lifecycle + empty states', () => {
  it('shows an accessible empty state when no snapshot has landed', () => {
    renderWidget({ vehicleId: 7, query: makeQuery({ data: undefined }) });

    expect(screen.getByText('No range data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Rated Range')).toBeNull();
  });

  it('renders only a skeleton while the state query is loading', () => {
    const { container } = renderWidget({
      vehicleId: 7,
      query: makeQuery({ isLoading: true }),
    });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Rated Range')).toBeNull();
    expect(screen.queryByText('No range data')).toBeNull();
  });

  it('surfaces a query error instead of the misleading empty state', () => {
    renderWidget({
      vehicleId: 7,
      query: makeQuery({ data: undefined, error: new Error('boom'), isError: true }),
    });

    // jsdom reports navigator.onLine === true → QueryError's non-offline branch.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No range data')).toBeNull();
    expect(screen.queryByText('Rated Range')).toBeNull();
  });

  it('refetches when the accessible "Refresh" freshness control is activated', () => {
    const refetch = vi.fn();
    renderWidget({ vehicleId: 7, query: makeQuery({ refetch, isFetching: false }) });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
