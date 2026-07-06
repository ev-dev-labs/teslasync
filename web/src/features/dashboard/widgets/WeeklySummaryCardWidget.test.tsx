/**
 * WeeklySummaryCardWidget contract + hardening tests.
 *
 * The widget is a self-refreshing dashboard tile that compares the current vs
 * previous week for a vehicle, reading `useWeeklyDigest(id)`. Its whole shape is
 * a function of three inputs: the resolved vehicle id (`vehicleId` prop, else the
 * first fleet vehicle, else 0), the digest query result, and the user's distance
 * preference. The widget renders one of four layouts by `size`:
 *
 *   - cols<=1 && rows<=1  → CompactView (one big distance number + unit label)
 *   - cols>=3             → Wide (four StatCards)
 *   - rows>=2             → Tall (four StatCards)
 *   - otherwise (e.g 2x1) → two StatCards + an InlineMetric cost/efficiency row
 *
 * Two layers are locked here:
 *
 *  A. The pure `trendOf` helper (exported for testability): the zero-baseline
 *     em-dash, the sub-1% "~0%" collapse, the up/down direction, and the
 *     `lowerIsPositive` polarity flip used by cost + efficiency.
 *
 *  B. The component behaviour — and, crucially, a REGRESSION GUARD on the SI
 *     cutover. The digest wire shape is km + Wh/km; `convertDistanceFromSI`
 *     expects SI metres. The pre-fix code passed miles to it (~1000x too small)
 *     and double-converted efficiency. These tests assert the corrected values
 *     for both km and mi preferences and pin the exact buggy outputs as absent.
 *
 * i18n is stubbed to echo the English fallback so every copy assertion is real;
 * `@/hooks/useUnits` + `@/hooks/useFormatting` are stubbed so the distance
 * preference and currency formatting are deterministic and injectable; and the
 * fleet list + digest query are mocked so no network is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
let MOCK_DISTANCE_UNIT: 'km' | 'mi';
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: MOCK_DISTANCE_UNIT } }),
}));

// Deterministic currency formatting — the widget only calls formatCurrency().
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
  }),
}));

// The fleet list + digest query result are injected per-test through these
// mutable holders (the `MOCK_`/`mock` prefixes let vitest hoist the factory
// above them safely). `mockUseWeeklyDigest` records the id string the widget
// resolves so the vehicle-resolution fallback chain can be asserted.
let MOCK_VEHICLES: { id: number }[] | undefined;
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: MOCK_VEHICLES }),
}));

const mockUseWeeklyDigest = vi.fn((_vehicleId: string): DigestQuery => MOCK_QUERY);
let MOCK_QUERY!: DigestQuery;
vi.mock('@/api/hooks/useAnalytics', () => ({
  useWeeklyDigest: (vehicleId: string) => mockUseWeeklyDigest(vehicleId),
}));

import WeeklySummaryCardWidget, { trendOf } from './WeeklySummaryCardWidget';
import type { WidgetSize } from './types';
import type { WeeklyDigestData } from '@/types/analytics';

/** Only the fields the widget reads off the `useWeeklyDigest` result. */
interface DigestQuery {
  data: WeeklyDigestData | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

const NOW = Date.parse('2026-07-05T12:00:00.000Z');

const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const NARROW: WidgetSize = { cols: 2, rows: 1 };
const TALL: WidgetSize = { cols: 2, rows: 2 };
const WIDE: WidgetSize = { cols: 3, rows: 2 };

/**
 * A digest with round SI-derived numbers chosen so the display values are
 * locale-stable and hand-verifiable:
 *   200 km → 200.0 km / 124.3 mi   |   200 Wh/km → 200 Wh/km / 322 Wh/mi
 */
function makeDigest(overrides: Partial<WeeklyDigestData> = {}): WeeklyDigestData {
  return {
    drives: 8,
    distanceKm: 200,
    energyKwh: 40,
    cost: 5.6,
    efficiency: 200,
    prevDrives: 4,
    prevDistanceKm: 100,
    prevEnergyKwh: 50,
    prevCost: 7,
    prevEfficiency: 250,
    ...overrides,
  };
}

function makeQuery(overrides: Partial<DigestQuery> = {}): DigestQuery {
  return {
    data: makeDigest(),
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

interface RenderOpts {
  size?: WidgetSize;
  query?: DigestQuery;
  vehicles?: { id: number }[];
  vehicleId?: number;
  distanceUnit?: 'km' | 'mi';
}

function renderWidget(opts: RenderOpts = {}) {
  MOCK_QUERY = opts.query ?? makeQuery();
  MOCK_VEHICLES = opts.vehicles;
  MOCK_DISTANCE_UNIT = opts.distanceUnit ?? 'km';
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WeeklySummaryCardWidget vehicleId={opts.vehicleId} size={opts.size ?? TALL} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The StatCard whose label is `label`, resolved via its shared `.flex` card. */
function cardOf(label: string): HTMLElement {
  const el = screen.getByText(label).closest('div.flex.flex-col');
  if (!el) throw new Error(`StatCard for "${label}" not found`);
  return el as HTMLElement;
}

beforeEach(() => {
  MOCK_QUERY = makeQuery();
  MOCK_VEHICLES = undefined;
  MOCK_DISTANCE_UNIT = 'km';
  mockUseWeeklyDigest.mockClear();
});

afterEach(() => {
  cleanup();
});

// ── A. Pure helper: trendOf ─────────────────────────────────────────────────

describe('trendOf', () => {
  it('returns an em-dash flat trend when the baseline is zero (no % is meaningful)', () => {
    expect(trendOf(42, 0)).toEqual({ direction: 'flat', value: '—' });
    // No `positive` key is emitted for the zero-baseline case.
    expect(trendOf(42, 0)).not.toHaveProperty('positive');
  });

  it('collapses sub-1% moves to "~0%" so noise never renders a coloured arrow', () => {
    expect(trendOf(100.5, 100)).toEqual({ direction: 'flat', value: '~0%' });
    expect(trendOf(100, 100)).toEqual({ direction: 'flat', value: '~0%' });
  });

  it('reports up/down direction with a whole-percent magnitude', () => {
    expect(trendOf(200, 100)).toEqual({ direction: 'up', value: '100%', positive: true });
    expect(trendOf(100, 200)).toEqual({ direction: 'down', value: '50%', positive: false });
  });

  it('flips polarity when lower is better (cost / efficiency)', () => {
    // A drop is good → positive; a rise is bad → not positive.
    expect(trendOf(100, 200, true)).toEqual({ direction: 'down', value: '50%', positive: true });
    expect(trendOf(200, 100, true)).toEqual({ direction: 'up', value: '100%', positive: false });
  });
});

// ── B. Conversion correctness (SI-cutover regression guard) ──────────────────

describe('WeeklySummaryCardWidget — unit conversion', () => {
  it('renders km + Wh/km values and NOT the pre-fix (metres-mistaken-for-miles) output', () => {
    renderWidget({ size: TALL, distanceUnit: 'km', query: makeQuery({ data: makeDigest() }) });

    // 200 km → "200.0" km, 200 Wh/km → "200" Wh/km, 40 kWh → "40.0".
    expect(within(cardOf('Distance')).getByText('200.0')).toBeInTheDocument();
    expect(within(cardOf('Distance')).getByText('km')).toBeInTheDocument();
    expect(within(cardOf('Energy')).getByText('40.0')).toBeInTheDocument();
    expect(within(cardOf('Efficiency')).getByText('200')).toBeInTheDocument();
    expect(within(cardOf('Efficiency')).getByText('Wh/km')).toBeInTheDocument();

    // Regression guards: the old code divided miles by 1609.344 → "0.1", and
    // multiplied Wh/km by 1.609 even in km mode → "322". Neither may appear.
    expect(screen.queryByText('0.1')).toBeNull();
    expect(screen.queryByText('322')).toBeNull();
  });

  it('converts to mi + Wh/mi and NOT the pre-fix double-converted output', () => {
    renderWidget({ size: TALL, distanceUnit: 'mi', query: makeQuery({ data: makeDigest() }) });

    // 200 km → 124.274 mi → "124.3"; 200 Wh/km → 321.87 Wh/mi → "322".
    expect(within(cardOf('Distance')).getByText('124.3')).toBeInTheDocument();
    expect(within(cardOf('Distance')).getByText('mi')).toBeInTheDocument();
    expect(within(cardOf('Efficiency')).getByText('322')).toBeInTheDocument();
    expect(within(cardOf('Efficiency')).getByText('Wh/mi')).toBeInTheDocument();

    // Regression guards: pre-fix distance collapsed to "0.1"; pre-fix efficiency
    // double-converted 200*1.609*1.609 ≈ 518.
    expect(screen.queryByText('0.1')).toBeNull();
    expect(screen.queryByText('518')).toBeNull();
  });
});

// ── C. Layout branches ──────────────────────────────────────────────────────

describe('WeeklySummaryCardWidget — layouts', () => {
  it('compact (1x1) shows a single big distance number + unit label, no title', () => {
    renderWidget({ size: COMPACT, distanceUnit: 'km' });

    // 200 km at 0 decimals → "200"; label interpolates the unit + "this week".
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText(/km\s+this week/i)).toBeInTheDocument();
    // No StatCards and no header title in the compact tile.
    expect(screen.queryByText('Weekly Summary')).toBeNull();
    expect(screen.queryByText('Distance')).toBeNull();
  });

  it('tall (2x2) shows all four StatCards and no inline metric row', () => {
    renderWidget({ size: TALL });

    expect(screen.getByText('Weekly Summary')).toBeInTheDocument();
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('Energy')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
    expect(screen.getByText('Efficiency')).toBeInTheDocument();
    // Cost card shows the formatted currency.
    expect(within(cardOf('Cost')).getByText('$5.60')).toBeInTheDocument();
  });

  it('narrow (2x1) shows only Distance + Energy cards plus an inline cost/efficiency row', () => {
    renderWidget({ size: NARROW, distanceUnit: 'km' });

    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('Energy')).toBeInTheDocument();
    // Cost / Efficiency are NOT promoted to StatCards at this size…
    expect(screen.queryByText('Cost')).toBeNull();
    expect(screen.queryByText('Efficiency')).toBeNull();
    // …they appear in the compact inline row instead.
    expect(screen.getByText('$5.60')).toBeInTheDocument();
    expect(screen.getByText('200 Wh/km')).toBeInTheDocument();
  });

  it('wide (3x2) promotes cost + efficiency to StatCards', () => {
    renderWidget({ size: WIDE });

    expect(screen.getByText('Cost')).toBeInTheDocument();
    expect(screen.getByText('Efficiency')).toBeInTheDocument();
    expect(within(cardOf('Cost')).getByText('$5.60')).toBeInTheDocument();
  });
});

// ── D. Lifecycle + empty states ─────────────────────────────────────────────

describe('WeeklySummaryCardWidget — lifecycle', () => {
  it('renders only a skeleton while the digest is loading', () => {
    const { container } = renderWidget({ size: TALL, query: makeQuery({ isLoading: true }) });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Weekly Summary')).toBeNull();
    expect(screen.queryByText('No weekly data')).toBeNull();
  });

  it('surfaces a query error instead of the misleading empty state', () => {
    renderWidget({
      size: TALL,
      query: makeQuery({ data: undefined, error: new Error('boom'), isError: true }),
    });

    // jsdom reports navigator.onLine === true → QueryError's non-offline branch.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No weekly data')).toBeNull();
    expect(screen.queryByText('Distance')).toBeNull();
  });

  it('shows an accessible empty state (full view) when no digest has landed', () => {
    renderWidget({ size: TALL, query: makeQuery({ data: undefined }) });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No weekly data')).toBeInTheDocument();
    expect(screen.queryByText('Distance')).toBeNull();
  });

  it('shows an accessible empty state (compact view) when no digest has landed', () => {
    renderWidget({ size: COMPACT, query: makeQuery({ data: undefined }) });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No weekly data')).toBeInTheDocument();
  });

  it('refetches when the accessible "Refresh" freshness control is activated', () => {
    const refetch = vi.fn();
    renderWidget({ size: TALL, query: makeQuery({ refetch }) });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ── E. Vehicle-id resolution ────────────────────────────────────────────────

describe('WeeklySummaryCardWidget — vehicle resolution', () => {
  it('queries the explicit vehicleId (as a string) when one is provided', () => {
    renderWidget({ vehicleId: 7, vehicles: [{ id: 3 }] });
    expect(mockUseWeeklyDigest).toHaveBeenCalledWith('7');
  });

  it('falls back to the first fleet vehicle when no vehicleId is given', () => {
    renderWidget({ vehicles: [{ id: 3 }, { id: 9 }] });
    expect(mockUseWeeklyDigest).toHaveBeenCalledWith('3');
  });

  it('resolves to "0" when neither a prop nor a fleet vehicle exists', () => {
    renderWidget({ vehicles: undefined });
    expect(mockUseWeeklyDigest).toHaveBeenCalledWith('0');
  });
});

// ── F. Null safety ──────────────────────────────────────────────────────────

describe('WeeklySummaryCardWidget — null safety', () => {
  it('coalesces missing numeric fields to zero without rendering NaN', () => {
    // A backend that omits fields (typed non-null but nullable on the wire).
    const sparse = { drives: 0 } as unknown as WeeklyDigestData;
    const { container } = renderWidget({ size: TALL, distanceUnit: 'km', query: makeQuery({ data: sparse }) });

    expect(within(cardOf('Distance')).getByText('0.0')).toBeInTheDocument();
    expect(within(cardOf('Cost')).getByText('$0.00')).toBeInTheDocument();
    // Zero baselines → em-dash trend, never "NaN".
    expect(container.textContent ?? '').not.toContain('NaN');
  });
});
