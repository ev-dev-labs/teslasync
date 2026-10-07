/**
 * TirePressureHistoryWidget — comprehensive unit + integration coverage.
 *
 * Exercises every export of TirePressureHistoryWidget.tsx:
 *   - `RECOMMENDED_RANGE_KPA` — the SI (kPa) recommended-range constant,
 *   - `buildChartData` — the canonical created_at-filter / converter-map / sort helper,
 *   - `latestNonNull` — the pure "last non-null reading" resolver,
 *   - `recommendedPressureRange` — the reference-line resolver (the R2 unit-bug
 *     regression guard: physical kPa thresholds are bridged to canonical Pa
 *     before display conversion, so Min/Max share the plotted pressure domain), and
 *   - the default widget across every render branch: the medium panel (title +
 *     per-tire summary), the titled compact tile, loading / error / empty
 *     states, vehicle selection, newest-reading-wins ordering, and the
 *     manual-refresh interaction.
 *
 * Strategy (mirrors the repo convention, e.g. BatteryCellsWidget.test.tsx and
 * SoftwareUpdateHistoryWidget.test.tsx):
 *   - The two data hooks (`useTirePressureHistory`, `useVehicles`) are the only
 *     network boundary and are replaced with hoisted `vi.fn()` doubles, so no
 *     real endpoint is ever touched and each render is deterministic.
 *   - `react-i18next` is stubbed to resolve the developer fallback (2nd arg) and
 *     interpolate `{{vars}}`, so assertions read the real English copy and the
 *     transitive <DataFreshness> header resolves.
 *   - The global test-setup (src/test-setup.ts) already mocks `useSettings`
 *     (km / °C / **bar** / precision 2 / en-US) and `useTimezone` (UTC), so the
 *     REAL `usePressureFormat` (Pa → display units) and `useDateFormat` run — this test
 *     covers the genuine conversion path end to end.
 *
 * `@testing-library/user-event` is intentionally NOT a dependency of this
 * codebase — interactions use `fireEvent`, consistent with the other slice tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import * as settingsHook from '@/hooks/useSettings';
import { convertPressureFromSI, PASCALS_PER_KPA } from '@/lib/unitConversion';
import { camelCaseKeys } from '@/lib/resilience';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

// jsdom lacks matchMedia; <DataFreshness>'s useMotionPreference touches it on
// first paint. Install a no-op reporting no reduced-motion before any import.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// react-i18next passthrough — resolve the fallback (2nd arg) and interpolate
// `{{vars}}` from the options object so assertions read production copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, opts?: Record<string, unknown>) => {
      let out = typeof fallback === 'string' ? fallback : key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
  }),
}));

// Hoisted hook doubles — the network boundary. Never hit real endpoints.
const { tireHistoryMock, vehiclesMock } = vi.hoisted(() => ({
  tireHistoryMock: vi.fn(),
  vehiclesMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useTirePressureHistory: tireHistoryMock,
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vehiclesMock }));

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual, ...chartTestDoubles,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    LineChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Line: () => null,
    chartGrid: null,
    ReferenceLine: ({ y, label }: { y: number; label: { value: string } }) => (
      <div data-testid="pressure-reference" data-value={y}>{label.value}</div>
    ),
  };
});

import TirePressureHistoryWidget, {
  RECOMMENDED_RANGE_KPA,
  buildChartData,
  latestNonNull,
  recommendedPressureRange,
  type ChartDatum,
} from './TirePressureHistoryWidget';

it.each([1, 2, 3])('identifies tire pressure history at %i columns', (cols) => {
  renderWidget(<TirePressureHistoryWidget size={{ cols, rows: 4 }} />);
  expect(screen.getByRole('heading', { name: 'Tire pressure history' })).toBeInTheDocument();
});
import type { TirePressureReading } from '@/types/vehicle-systems';
import type { WidgetSize } from './types';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const SIZE_COMPACT: WidgetSize = { cols: 1, rows: 1 };
const SIZE_MEDIUM: WidgetSize = { cols: 2, rows: 3 };

// Wire pressure is canonical Pa; render-boundary conversion produces bar:
//   250000 → 2.5, 260000 → 2.6, 240000 → 2.4, 270000 → 2.7.
type HistoryReading = Omit<TirePressureReading, 'timestamp'> & { created_at: string };

function makeReading(overrides: Partial<HistoryReading> = {}): HistoryReading {
  return {
    id: '1',
    vehicleId: '42',
    frontLeft: 250_000,
    frontRight: 260_000,
    rearLeft: 240_000,
    rearRight: 270_000,
    tpmsHardWarning: false,
    tpmsSoftWarning: false,
    created_at: '2024-11-01T10:00:00.000Z',
    ...overrides,
  };
}

interface QueryOverrides {
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function makeQuery(data?: unknown, over: QueryOverrides = {}) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: data ? Date.now() : 0,
    refetch: vi.fn(),
    ...over,
  };
}

function renderWidget(node: ReactElement) {
  const view = render(<MemoryRouter>{node}</MemoryRouter>);
  expect(view.container.querySelector('h3')).toHaveAccessibleName('Tire pressure history');
  return view;
}

// A converter matching the real bar projection (kPa → bar), with the same
// null / non-finite guard `usePressureFormat` applies.
const barConv = (kpa: number | null | undefined): number | null =>
  kpa == null || !Number.isFinite(kpa) ? null : kpa / 100_000;

beforeEach(() => {
  tireHistoryMock.mockReset();
  vehiclesMock.mockReset();
  // Sensible defaults: one vehicle, a single reading.
  vehiclesMock.mockReturnValue({ data: [{ id: 42 }] });
  tireHistoryMock.mockReturnValue(makeQuery([makeReading()]));
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ── RECOMMENDED_RANGE_KPA (constant) ─────────────────────────────────────────
describe('RECOMMENDED_RANGE_KPA', () => {
  it('is expressed in SI kilopascals (2.4–2.8 bar), not bar or Pascals', () => {
    expect(RECOMMENDED_RANGE_KPA).toEqual({ low: 240, high: 280 });
  });
});

// ── buildChartData (pure) ────────────────────────────────────────────────────
describe('buildChartData', () => {
  it('consumes the real created_at wire shape after request normalization, without a timestamp adapter', () => {
    const wire = [
      { id: 2, ts: '2024-11-02T00:00:00.000Z', created_at: '2024-11-02T00:00:00.000Z', front_left: 250_000, front_right: null, rear_left: 0, rear_right: 270_000 },
      { id: 1, ts: '2024-11-01T00:00:00.000Z', created_at: '2024-11-01T00:00:00.000Z', front_left: 210_000, front_right: 260_000, rear_left: null, rear_right: 240_000 },
    ];
    const normalized = camelCaseKeys(wire);
    expect(buildChartData(normalized, barConv)).toEqual([
      { time: wire[1].created_at, fl: 2.1, fr: 2.6, rl: null, rr: 2.4 },
      { time: wire[0].created_at, fl: 2.5, fr: null, rl: 0, rr: 2.7 },
    ]);
    expect(buildChartData([{ timestamp: wire[0].created_at, frontLeft: 250_000 }], barConv)).toEqual([]);
    expect(buildChartData([null, false, 42, 'invalid', { created_at: 'invalid' }], barConv)).toEqual([]);
    expect(wire.every((row) => !('timestamp' in row))).toBe(true);
  });
  it('rejects invalid history collections and timestamps without manufacturing a zero', () => {
    expect(buildChartData({} as unknown as TirePressureReading[], barConv)).toEqual([]);
    expect(buildChartData([makeReading({ created_at: 'not-a-date' })], barConv)).toEqual([]);
    expect(latestNonNull([{ time: 'now', fl: NaN, fr: 0, rl: null, rr: null }], 'fl')).toBeNull();
    expect(latestNonNull([{ time: 'now', fl: NaN, fr: 0, rl: null, rr: null }], 'fr')).toBe(0);
  });
  it('drops rows without created_at, converts every corner, and sorts oldest→newest', () => {
    const rows: HistoryReading[] = [
      makeReading({ id: 'b', created_at: '2024-11-02T00:00:00.000Z', frontLeft: 250_000 }),
      makeReading({ id: 'a', created_at: '2024-11-01T00:00:00.000Z', frontLeft: 210_000 }),
      makeReading({ id: 'skip', created_at: '' }), // filtered out
    ];

    const out = buildChartData(rows, barConv);

    // The empty-date row is filtered; the rest are ascending by time.
    expect(out).toHaveLength(2);
    expect(out.map((d) => d.time)).toEqual([
      '2024-11-01T00:00:00.000Z',
      '2024-11-02T00:00:00.000Z',
    ]);
    // Corners are projected through the converter (250 kPa → 2.5 bar).
    expect(out[1].fl).toBe(2.5);
    expect(out[0].fl).toBe(2.1);
    expect(out[0].rr).toBe(2.7); // rearRight 270 → 2.7
  });

  it('returns an empty array for undefined data (loading / disabled query)', () => {
    expect(buildChartData(undefined, barConv)).toEqual([]);
  });

  it('preserves nulls the converter emits for a missing corner reading', () => {
    // A converter that maps a 0 sentinel to null (as the real one does for
    // non-finite input) — buildChartData must propagate that null, not coerce it.
    const zeroToNull = (kpa: number | null | undefined): number | null => (kpa ? kpa : null);
    const out = buildChartData([makeReading({ frontLeft: 0, frontRight: 260_000 })], zeroToNull);

    expect(out[0].fl).toBeNull();
    expect(out[0].fr).toBe(260_000);
  });
});

// ── latestNonNull (pure) ─────────────────────────────────────────────────────
describe('latestNonNull', () => {
  const datum = (time: string, fl: number | null): ChartDatum => ({
    time,
    fl,
    fr: null,
    rl: null,
    rr: null,
  });

  it('returns the most recent non-null value, skipping trailing nulls', () => {
    const data = [datum('t1', 2.4), datum('t2', 2.6), datum('t3', null)];
    // Scans from the end: t3 is null → skip → t2 (2.6) is the answer.
    expect(latestNonNull(data, 'fl')).toBe(2.6);
  });

  it('returns null for an empty series and for an all-null series', () => {
    expect(latestNonNull([], 'fl')).toBeNull();
    expect(latestNonNull([datum('t1', null), datum('t2', null)], 'fl')).toBeNull();
  });
});

// ── recommendedPressureRange (pure — R2 unit-bug regression guard) ────────────
describe('recommendedPressureRange', () => {
  it('bridges 240/280 kPa to canonical Pa before real bar conversion', () => {
    const paToBar = vi.fn((pa: number | null | undefined): number | null =>
      pa == null ? null : convertPressureFromSI(pa / PASCALS_PER_KPA, 'bar'));
    const range = recommendedPressureRange(paToBar);
    expect(range).toEqual({ low: 2.4, high: 2.8 });
    expect(paToBar).toHaveBeenNthCalledWith(1, 240_000);
    expect(paToBar).toHaveBeenNthCalledWith(2, 280_000);
  });

  it('projects into psi when the converter targets psi', () => {
    const psiConv = (pa: number | null | undefined): number | null =>
      pa == null ? null : convertPressureFromSI(pa / PASCALS_PER_KPA, 'psi');
    const range = recommendedPressureRange(psiConv);
    expect(range.low).toBeCloseTo(34.81, 2);
    expect(range.high).toBeCloseTo(40.61, 2);
  });

  it.each([
    { unit: 'bar', low: 2.4, high: 2.8 },
    { unit: 'psi', low: 34.81, high: 40.61 },
  ] as const)('wires Min/Max reference positions through real usePressureFormat in $unit', ({ unit, low, high }) => {
    const current = settingsHook.useSettings();
    vi.spyOn(settingsHook, 'useSettings').mockReturnValue({
      ...current,
      settings: { ...current.settings, unit_of_pressure: unit },
    });
    renderWidget(<TirePressureHistoryWidget size={SIZE_MEDIUM} />);
    const references = screen.getAllByTestId('pressure-reference');
    expect(references).toHaveLength(2);
    expect(references[0]).toHaveTextContent('Min');
    expect(references[1]).toHaveTextContent('Max');
    expect(Number(references[0].getAttribute('data-value'))).toBeCloseTo(low, 2);
    expect(Number(references[1].getAttribute('data-value'))).toBeCloseTo(high, 2);
    expect(screen.getAllByText(unit)).toHaveLength(4);
  });

  it('falls back to the bar equivalent when the converter yields null', () => {
    expect(recommendedPressureRange(() => null)).toEqual({ low: 2.4, high: 2.8 });
  });
});

// ── Widget render states ─────────────────────────────────────────────────────
describe('TirePressureHistoryWidget', () => {
  it('retains locale and precision reactivity for canonical created_at readings', () => {
    const wire = [{
      id: 1,
      ts: '2024-11-01T10:00:00.000Z',
      created_at: '2024-11-01T10:00:00.000Z',
      front_left: 250_000,
      front_right: 260_000,
      rear_left: 240_000,
      rear_right: 270_000,
    }];
    const query = makeQuery(camelCaseKeys(wire));
    tireHistoryMock.mockReturnValue(query);
    renderWidget(<TirePressureHistoryWidget size={SIZE_MEDIUM} />);
    try {
      act(() => { setGlobalPrecision(3); setGlobalLocale('de-DE'); });
      for (const reading of ['2,500', '2,600', '2,400', '2,700']) {
        expect(screen.getByText(reading)).toBeInTheDocument();
      }
      expect(query.refetch).not.toHaveBeenCalled();
      expect(wire[0].created_at).toBe('2024-11-01T10:00:00.000Z');
      expect(wire[0].front_left).toBe(250_000);
    } finally {
      act(() => { setGlobalPrecision(2); setGlobalLocale('en-US'); });
    }
  });
  it.each([
    { cols: 1, unit: 'bar' },
    { cols: 2, unit: 'bar' },
    { cols: 3, unit: 'bar' },
    { cols: 1, unit: 'psi' },
    { cols: 2, unit: 'psi' },
    { cols: 3, unit: 'psi' },
  ] as const)('renders actual created_at wire readings at $cols columns in $unit', ({ cols, unit }) => {
    const current = settingsHook.useSettings();
    vi.spyOn(settingsHook, 'useSettings').mockReturnValue({
      ...current,
      settings: { ...current.settings, unit_of_pressure: unit },
    });
    const wire = [{
      id: 1,
      ts: '2024-11-01T10:00:00.000Z',
      created_at: '2024-11-01T10:00:00.000Z',
      front_left: 250_000,
      front_right: 260_000,
      rear_left: 240_000,
      rear_right: 270_000,
    }];
    tireHistoryMock.mockReturnValue(makeQuery(camelCaseKeys(wire)));
    renderWidget(<TirePressureHistoryWidget size={{ cols, rows: 3 }} />);
    expect(screen.getByRole('heading', { name: 'Tire pressure history' })).toBeInTheDocument();
    expect(screen.queryByText('No tire pressure history')).not.toBeInTheDocument();
    for (const pressure of [250_000, 260_000, 240_000, 270_000]) {
      const expected = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(convertPressureFromSI(pressure / PASCALS_PER_KPA, unit));
      expect(screen.getByText(expected)).toBeInTheDocument();
    }
    expect(screen.getAllByText(unit)).toHaveLength(4);
  });
  it('renders the title and the latest per-tire summary (kPa → bar) at medium size', () => {
    renderWidget(<TirePressureHistoryWidget size={SIZE_MEDIUM} />);

    // Title header (visible above compact).
    expect(screen.getByText('Tire pressure history')).toBeInTheDocument();

    // Per-corner labels.
    expect(screen.getByText('FL')).toBeInTheDocument();
    expect(screen.getByText('FR')).toBeInTheDocument();
    expect(screen.getByText('RL')).toBeInTheDocument();
    expect(screen.getByText('RR')).toBeInTheDocument();

    // Converted values (one decimal) + the bar unit on every tile.
    expect(screen.getByText('2.50')).toBeInTheDocument(); // FL 250 kPa
    expect(screen.getByText('2.60')).toBeInTheDocument(); // FR 260 kPa
    expect(screen.getByText('2.40')).toBeInTheDocument(); // RL 240 kPa
    expect(screen.getByText('2.70')).toBeInTheDocument(); // RR 270 kPa
    expect(screen.getAllByText('bar')).toHaveLength(4);
  });

  it('shows the newest reading in the summary even when the API returns rows out of order', () => {
    tireHistoryMock.mockReturnValue(
      makeQuery([
        makeReading({ id: 'new', created_at: '2024-11-05T00:00:00.000Z', frontLeft: 290_000 }),
        makeReading({ id: 'old', created_at: '2024-11-01T00:00:00.000Z', frontLeft: 300_000 }),
      ]),
    );

    renderWidget(<TirePressureHistoryWidget size={SIZE_MEDIUM} />);

    // 290 kPa → 2.9 is the newest FL; the older 300 → 3.0 must not appear.
    expect(screen.getByText('2.90')).toBeInTheDocument();
    expect(screen.queryByText('3.00')).not.toBeInTheDocument();
  });

  it('identifies the compact per-tire summary', () => {
    renderWidget(<TirePressureHistoryWidget size={SIZE_COMPACT} />);

    expect(screen.getByRole('heading', { name: 'Tire pressure history' })).toBeInTheDocument();
    expect(screen.getByText('FL')).toBeInTheDocument();
    expect(screen.getByText('2.50')).toBeInTheDocument();
  });

  it('falls back to the first vehicle when no vehicleId prop is supplied', () => {
    renderWidget(<TirePressureHistoryWidget size={SIZE_MEDIUM} />);
    expect(tireHistoryMock).toHaveBeenCalledWith('42');
  });

  it('uses the explicit vehicleId prop (stringified) when provided', () => {
    renderWidget(<TirePressureHistoryWidget vehicleId={7} size={SIZE_MEDIUM} />);
    expect(tireHistoryMock).toHaveBeenCalledWith('7');
  });

  it('passes an empty id (disabling the query) and shows the empty state with no vehicles', () => {
    vehiclesMock.mockReturnValue({ data: [] });
    tireHistoryMock.mockReturnValue(makeQuery(undefined));

    renderWidget(<TirePressureHistoryWidget size={SIZE_MEDIUM} />);

    expect(tireHistoryMock).toHaveBeenCalledWith('');
    expect(screen.getByText('No tire pressure history')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('FL')).not.toBeInTheDocument();
  });

  it('renders the empty state (and no summary) when the history is an empty array', () => {
    tireHistoryMock.mockReturnValue(makeQuery([]));

    renderWidget(<TirePressureHistoryWidget size={SIZE_MEDIUM} />);

    expect(screen.getByText('No tire pressure history')).toBeInTheDocument();
    expect(screen.queryByText('FL')).not.toBeInTheDocument();
  });

  it('renders a loading skeleton with no body while the first fetch is in flight', () => {
    tireHistoryMock.mockReturnValue(makeQuery(undefined, { isLoading: true }));

    const { container } = renderWidget(<TirePressureHistoryWidget size={SIZE_MEDIUM} />);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Tire pressure history')).toBeInTheDocument();
    expect(screen.queryByText('FL')).not.toBeInTheDocument();
  });

  it('keeps the last-known summary on a mid-poll error instead of blanking the panel', () => {
    tireHistoryMock.mockReturnValue(makeQuery([makeReading()], { isError: true }));

    renderWidget(<TirePressureHistoryWidget size={SIZE_MEDIUM} />);

    // Error is surfaced by the freshness chip; the summary still renders.
    expect(screen.getByText('FL')).toBeInTheDocument();
    expect(screen.getByText('2.50')).toBeInTheDocument();
  });

  it('exposes an accessible refresh control that invokes refetch when activated', () => {
    const refetch = vi.fn();
    tireHistoryMock.mockReturnValue(
      makeQuery([makeReading()], { refetch, isFetching: false, dataUpdatedAt: Date.now() }),
    );

    renderWidget(<TirePressureHistoryWidget size={SIZE_MEDIUM} />);

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshBtn);

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
