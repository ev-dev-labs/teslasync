/**
 * TirePressureHistoryWidget — comprehensive unit + integration coverage.
 *
 * Exercises every export of TirePressureHistoryWidget.tsx:
 *   - `RECOMMENDED_RANGE_KPA` — the SI (kPa) recommended-range constant,
 *   - `buildChartData` — the pure timestamp-filter / converter-map / sort helper,
 *   - `latestNonNull` — the pure "last non-null reading" resolver,
 *   - `recommendedPressureRange` — the reference-line resolver (the R2 unit-bug
 *     regression guard: the range is fed to the converter as kilopascals, NOT
 *     Pascals, so the Min/Max lines land on the plotted domain instead of ~1000×
 *     too high), and
 *   - the default widget across every render branch: the medium panel (title +
 *     per-tire summary), the compact tile (no title), loading / error / empty
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
 *     REAL `usePressureFormat` (kPa → bar) and `useDateFormat` run — this test
 *     covers the genuine conversion path end to end.
 *
 * `@testing-library/user-event` is intentionally NOT a dependency of this
 * codebase — interactions use `fireEvent`, consistent with the other slice tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

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

import TirePressureHistoryWidget, {
  RECOMMENDED_RANGE_KPA,
  buildChartData,
  latestNonNull,
  recommendedPressureRange,
  type ChartDatum,
} from './TirePressureHistoryWidget';
import type { TirePressureReading } from '@/types/vehicle-systems';
import type { WidgetSize } from './types';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const SIZE_COMPACT: WidgetSize = { cols: 1, rows: 1 };
const SIZE_MEDIUM: WidgetSize = { cols: 2, rows: 3 };

// SI kilopascals — the on-the-wire pressure unit the app converts at the render
// boundary. Chosen to render as distinct one-decimal bar values (÷100):
//   250 → 2.5, 260 → 2.6, 240 → 2.4, 270 → 2.7.
function makeReading(overrides: Partial<TirePressureReading> = {}): TirePressureReading {
  return {
    id: '1',
    vehicleId: '42',
    frontLeft: 250_000,
    frontRight: 260_000,
    rearLeft: 240_000,
    rearRight: 270_000,
    tpmsHardWarning: false,
    tpmsSoftWarning: false,
    timestamp: '2024-11-01T10:00:00.000Z',
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

function makeQuery(data?: TirePressureReading[], over: QueryOverrides = {}) {
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
  return render(<MemoryRouter>{node}</MemoryRouter>);
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

// ── RECOMMENDED_RANGE_KPA (constant) ─────────────────────────────────────────
describe('RECOMMENDED_RANGE_KPA', () => {
  it('is expressed in SI kilopascals (2.4–2.8 bar), not bar or Pascals', () => {
    expect(RECOMMENDED_RANGE_KPA).toEqual({ low: 240, high: 280 });
  });
});

// ── buildChartData (pure) ────────────────────────────────────────────────────
describe('buildChartData', () => {
  it('drops timestamp-less rows, converts every corner, and sorts oldest→newest', () => {
    const rows: TirePressureReading[] = [
      makeReading({ id: 'b', timestamp: '2024-11-02T00:00:00.000Z', frontLeft: 250_000 }),
      makeReading({ id: 'a', timestamp: '2024-11-01T00:00:00.000Z', frontLeft: 210_000 }),
      makeReading({ id: 'skip', timestamp: '' }), // filtered out
    ];

    const out = buildChartData(rows, barConv);

    // The empty-timestamp row is filtered; the rest are ascending by time.
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
  it('feeds the range to the converter as kilopascals → 2.4/2.8 bar (NOT 2400/2800)', () => {
    const kpaToBar = (kpa: number | null | undefined): number | null =>
      kpa == null || !Number.isFinite(kpa) ? null : kpa / 100;
    const range = recommendedPressureRange(kpaToBar);
    expect(range).toEqual({ low: 2.4, high: 2.8 });
    // Explicit guard against the old `* 100_000` Pascals bug (240000 → 2400 bar).
    expect(range.low).not.toBe(2400);
    expect(range.high).not.toBeGreaterThan(10);
  });

  it('projects into psi when the converter targets psi', () => {
    const psiConv = (kpa: number | null | undefined): number | null =>
      kpa == null ? null : kpa / 6.894757;
    const range = recommendedPressureRange(psiConv);
    expect(range.low).toBeCloseTo(240 / 6.894757, 5);
    expect(range.high).toBeCloseTo(280 / 6.894757, 5);
  });

  it('passes kilopascals straight through an identity (kPa) converter', () => {
    expect(recommendedPressureRange((kpa) => kpa ?? null)).toEqual({ low: 240, high: 280 });
  });

  it('falls back to the bar equivalent when the converter yields null', () => {
    expect(recommendedPressureRange(() => null)).toEqual({ low: 2.4, high: 2.8 });
  });
});

// ── Widget render states ─────────────────────────────────────────────────────
describe('TirePressureHistoryWidget', () => {
  it('renders the title and the latest per-tire summary (kPa → bar) at medium size', () => {
    renderWidget(<TirePressureHistoryWidget size={SIZE_MEDIUM} />);

    // Title header (visible above compact).
    expect(screen.getByText('Tire Pressure History')).toBeInTheDocument();

    // Per-corner labels.
    expect(screen.getByText('FL')).toBeInTheDocument();
    expect(screen.getByText('FR')).toBeInTheDocument();
    expect(screen.getByText('RL')).toBeInTheDocument();
    expect(screen.getByText('RR')).toBeInTheDocument();

    // Converted values (one decimal) + the bar unit on every tile.
    expect(screen.getByText('2.5')).toBeInTheDocument(); // FL 250 kPa
    expect(screen.getByText('2.6')).toBeInTheDocument(); // FR 260 kPa
    expect(screen.getByText('2.4')).toBeInTheDocument(); // RL 240 kPa
    expect(screen.getByText('2.7')).toBeInTheDocument(); // RR 270 kPa
    expect(screen.getAllByText('bar')).toHaveLength(4);
  });

  it('shows the newest reading in the summary even when the API returns rows out of order', () => {
    tireHistoryMock.mockReturnValue(
      makeQuery([
        makeReading({ id: 'new', timestamp: '2024-11-05T00:00:00.000Z', frontLeft: 290_000 }),
        makeReading({ id: 'old', timestamp: '2024-11-01T00:00:00.000Z', frontLeft: 300_000 }),
      ]),
    );

    renderWidget(<TirePressureHistoryWidget size={SIZE_MEDIUM} />);

    // 290 kPa → 2.9 is the newest FL; the older 300 → 3.0 must not appear.
    expect(screen.getByText('2.9')).toBeInTheDocument();
    expect(screen.queryByText('3.0')).not.toBeInTheDocument();
  });

  it('hides the title in compact layout but still renders the per-tire summary', () => {
    renderWidget(<TirePressureHistoryWidget size={SIZE_COMPACT} />);

    expect(screen.queryByText('Tire Pressure History')).not.toBeInTheDocument();
    expect(screen.getByText('FL')).toBeInTheDocument();
    expect(screen.getByText('2.5')).toBeInTheDocument();
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
    expect(screen.queryByText('Tire Pressure History')).not.toBeInTheDocument();
    expect(screen.queryByText('FL')).not.toBeInTheDocument();
  });

  it('keeps the last-known summary on a mid-poll error instead of blanking the panel', () => {
    tireHistoryMock.mockReturnValue(makeQuery([makeReading()], { isError: true }));

    renderWidget(<TirePressureHistoryWidget size={SIZE_MEDIUM} />);

    // Error is surfaced by the freshness chip; the summary still renders.
    expect(screen.getByText('FL')).toBeInTheDocument();
    expect(screen.getByText('2.5')).toBeInTheDocument();
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
