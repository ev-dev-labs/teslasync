/**
 * WeeklyDigestWidget — behavioural, branch, unit-conversion, null-safety and
 * a11y coverage for the dashboard "This Week" digest widget.
 *
 * The widget reads a legacy km / kWh / (Wh/km) digest envelope from
 * `useWeeklyDigest` and renders a `<WidgetComparisonCard>` of four
 * current-vs-previous metrics (Distance, Drives, Energy, Efficiency) inside a
 * `<WidgetShell>`. `size.cols <= 1` switches to a title-less compact layout
 * that clamps to the first two rows.
 *
 * What this file pins:
 *   - the DISTANCE unit fix: `distanceKm` is lifted km → SI metres → the user's
 *     display unit, so 100 km renders as ~62.1 mi (miles) / 100.0 km, never the
 *     pre-fix ~0.04 that came from feeding kilometres straight into the
 *     metres-based `convertDistanceFromSI`;
 *   - the EFFICIENCY unit fix: `efficiency` (Wh/km) is scaled by the km-per-
 *     display-unit span exactly once — 250 Wh/km → 402 Wh/mi (miles) / 250
 *     Wh/km (km) — never the pre-fix double-converted ~647;
 *   - the LAYOUT switch (compact clamps to Distance + Drives and drops the
 *     title heading; full shows all four + the "This Week" heading);
 *   - loading (skeleton only), the initial-load ERROR panel, and the
 *     background-refetch ERROR guard that keeps cached metrics on screen;
 *   - the empty branch (`<EmptyState>` when the digest is absent);
 *   - the vehicle-id resolution (`vehicleId` prop → `vehicles[0].id` fallback);
 *   - null-safety (missing numeric fields collapse to 0, no throw);
 *   - the accessible refresh control wiring (chip → `refetch`).
 *
 * Strategy: `useWeeklyDigest` / `useVehicles` / `useUnits` are mocked so the
 * data + unit preference are fully controllable and no network is touched. The
 * real `<WidgetShell>`, `<WidgetComparisonCard>`, `<EmptyState>` and the real
 * unit-conversion lib are exercised end-to-end; only `<Delta>` (the row change
 * indicator) is replaced with a prop-recording stub so the widget's computed
 * current/previous/direction stay observable at full precision, while the real
 * `<DataFreshness>` is kept so the refresh control is genuinely clicked.
 * `react-i18next` echoes each `t(key, fallback)` so assertions read as English.
 * A `<MemoryRouter>` wraps every render because the error panel navigates.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { WeeklyDigestData } from '@/types/analytics';
import type { WidgetSize } from './types';

// ── Hoisted mocks (referenced inside vi.mock factories) ─────────────────────────

const { weeklyDigestMock, vehiclesMock, unitsMock } = vi.hoisted(() => ({
  weeklyDigestMock: vi.fn(),
  vehiclesMock: vi.fn(),
  unitsMock: vi.fn(),
}));

vi.mock('@/api/hooks/useAnalytics', () => ({
  useWeeklyDigest: (vehicleId: string) => weeklyDigestMock(vehicleId),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => unitsMock(),
}));

// i18n → echo the developer fallback, interpolating `{{var}}` placeholders.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interp = (tpl: string, opts?: Record<string, unknown>) =>
    opts ? tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (opts[k] != null ? String(opts[k]) : '')) : tpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) =>
        typeof fallback === 'string' ? interp(fallback, opts) : _key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// DataFreshness leaf display hooks — stubbed so the freshness chip renders
// without a Settings / QueryClient provider.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (v: unknown) => String(v) }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));

interface StubDeltaProps {
  metric: { direction: string };
  current: number | null | undefined;
  previous: number | null | undefined;
  display?: string;
}

// Replace only <Delta> in the data-display barrel with a prop-recorder, while
// keeping the real <DataFreshness>/<DataFreshnessAuto> (WidgetShell needs them)
// by importing their own lightweight module rather than the heavy barrel.
vi.mock('@/components/data-display', async () => {
  const df = await vi.importActual<typeof import('@/components/data-display/DataFreshness')>(
    '@/components/data-display/DataFreshness',
  );
  return {
    DataFreshness: df.DataFreshness,
    DataFreshnessAuto: df.DataFreshnessAuto,
    Delta: ({ metric, current, previous, display }: StubDeltaProps) => (
      <span
        data-testid="delta"
        data-direction={metric.direction}
        data-current={String(current)}
        data-previous={String(previous)}
        data-display={display}
      />
    ),
  };
});

import WeeklyDigestWidget from './WeeklyDigestWidget';

// ── Fixtures ────────────────────────────────────────────────────────────────────

/**
 * Self-consistent week: 100 km on 25 kWh = 250 Wh/km. Previous week is lower on
 * every count so higher-is-better deltas trend positive and efficiency improves.
 */
function makeDigest(over: Partial<WeeklyDigestData> = {}): WeeklyDigestData {
  return {
    drives: 8,
    distanceKm: 100,
    energyKwh: 25,
    cost: 3.5,
    efficiency: 250,
    prevDrives: 5,
    prevDistanceKm: 80,
    prevEnergyKwh: 20,
    prevCost: 2.8,
    prevEfficiency: 300,
    ...over,
  };
}

interface DigestOverrides {
  data?: WeeklyDigestData | undefined;
  isLoading?: boolean;
  error?: unknown;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function setDigest(over: DigestOverrides = {}) {
  const q = {
    data: makeDigest() as WeeklyDigestData | undefined,
    isLoading: false,
    error: null as unknown,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.parse('2026-07-05T12:00:00.000Z'),
    refetch: vi.fn(),
    ...over,
  };
  weeklyDigestMock.mockReturnValue(q);
  return q;
}

function setUnits(distance: 'mi' | 'km') {
  unitsMock.mockReturnValue({
    unitPrefs: {
      distance,
      speed: distance === 'mi' ? 'mph' : 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
    },
  });
}

const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

function renderWidget(size: WidgetSize = FULL, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <WeeklyDigestWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

/** Ordered [Distance, Drives, Energy, Efficiency] (clamped to 2 when compact). */
function deltas(): HTMLElement[] {
  return screen.getAllByTestId('delta');
}
function num(el: HTMLElement, attr: 'data-current' | 'data-previous'): number {
  return parseFloat(el.getAttribute(attr) ?? 'NaN');
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue({ data: [{ id: 7, display_name: 'Car' }] });
  setUnits('mi');
  setDigest();
});

// ── Distance + efficiency unit conversion (the bug fixes) ─────────────────────

describe('WeeklyDigestWidget — unit conversion (miles)', () => {
  it('renders distance in miles by lifting km → SI → mi (100 km ⇒ 62.1 mi), not the pre-fix ~0.04', () => {
    renderWidget(FULL);

    const distance = screen.getByText('62.1');
    expect(distance).toBeInTheDocument();
    expect(distance.querySelector('span')?.textContent).toBe('mi');
    // Guard against the metres-vs-km regression that rendered ~0.0.
    expect(screen.queryByText('0.0')).toBeNull();
  });

  it('renders efficiency scaled to Wh/mi exactly once (250 Wh/km ⇒ 402 Wh/mi), not the double-converted ~647', () => {
    renderWidget(FULL);

    const efficiency = screen.getByText('402');
    expect(efficiency).toBeInTheDocument();
    expect(efficiency.querySelector('span')?.textContent).toBe('Wh/mi');
    expect(screen.queryByText('647')).toBeNull();
    expect(screen.queryByText('648')).toBeNull();
  });

  it('renders unit-agnostic drives and energy as-is (8 drives, 25.0 kWh)', () => {
    renderWidget(FULL);

    expect(screen.getByText('Drives')).toBeInTheDocument();
    const energy = screen.getByText('25.0');
    expect(energy.querySelector('span')?.textContent).toBe('kWh');
    // Drives delta carries the raw count with no unit label.
    expect(num(deltas()[1], 'data-current')).toBe(8);
  });

  it('forwards full-precision converted values + direction to each Delta (distance ≈ 62.14 mi, not 0.04)', () => {
    renderWidget(FULL);
    const [distance, drives, energy, efficiency] = deltas();

    expect(num(distance, 'data-current')).toBeCloseTo(62.137, 2);
    expect(num(distance, 'data-previous')).toBeCloseTo(49.71, 2);
    expect(num(distance, 'data-current')).not.toBeCloseTo(0.04, 1);
    expect(distance).toHaveAttribute('data-direction', 'higher_better');

    expect(num(drives, 'data-current')).toBe(8);
    expect(num(energy, 'data-current')).toBe(25);

    // Efficiency is "lower is better" and must land on ~402.34, not ~647.5.
    expect(num(efficiency, 'data-current')).toBeCloseTo(402.336, 1);
    expect(num(efficiency, 'data-current')).not.toBeCloseTo(647.5, 0);
    expect(efficiency).toHaveAttribute('data-direction', 'lower_better');
  });
});

describe('WeeklyDigestWidget — unit conversion (kilometres)', () => {
  beforeEach(() => setUnits('km'));

  it('shows distance untouched in km (100.0 km) and efficiency as Wh/km (250), fixing the km branch too', () => {
    renderWidget(FULL);

    const distance = screen.getByText('100.0');
    expect(distance.querySelector('span')?.textContent).toBe('km');

    const efficiency = screen.getByText('250');
    expect(efficiency.querySelector('span')?.textContent).toBe('Wh/km');
  });

  it('passes km-native raw values to Delta (distance current 100, efficiency current 250)', () => {
    renderWidget(FULL);
    const [distance, , , efficiency] = deltas();

    expect(num(distance, 'data-current')).toBeCloseTo(100, 6);
    expect(num(efficiency, 'data-current')).toBeCloseTo(250, 6);
  });
});

// ── Layout switch ─────────────────────────────────────────────────────────────

describe('WeeklyDigestWidget — layout', () => {
  it('full layout shows the title heading and all four metrics', () => {
    renderWidget(FULL);

    expect(screen.getByRole('heading', { name: 'This Week' })).toBeInTheDocument();
    expect(deltas()).toHaveLength(4);
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('Efficiency')).toBeInTheDocument();
  });

  it('compact layout drops the title and clamps to the first two metrics', () => {
    renderWidget(COMPACT);

    expect(screen.queryByRole('heading', { name: 'This Week' })).toBeNull();
    expect(deltas()).toHaveLength(2);
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('Drives')).toBeInTheDocument();
    expect(screen.queryByText('Energy')).toBeNull();
    expect(screen.queryByText('Efficiency')).toBeNull();
  });
});

// ── Loading / error / empty states ────────────────────────────────────────────

describe('WeeklyDigestWidget — loading, error & empty states', () => {
  it('renders only a skeleton (no heading, no metrics) while loading', () => {
    setDigest({ isLoading: true, data: undefined });
    const { container } = renderWidget(FULL);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByTestId('delta')).toBeNull();
  });

  it('shows an error panel (not metrics) when the initial load fails with no data', () => {
    setDigest({ isError: true, error: new Error('boom'), data: undefined });
    renderWidget(FULL);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('delta')).toBeNull();
  });

  it('keeps cached metrics visible (no error panel) when a background refetch errors', () => {
    setDigest({ isError: true, error: new Error('boom'), data: makeDigest() });
    renderWidget(FULL);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(deltas()).toHaveLength(4);
    expect(screen.getByText('Distance')).toBeInTheDocument();
  });

  it('shows the empty state (not a blank panel) when the digest is absent', () => {
    setDigest({ data: undefined, dataUpdatedAt: 0 });
    renderWidget(FULL);

    expect(screen.getByText('No weekly data yet')).toBeInTheDocument();
    expect(screen.queryByTestId('delta')).toBeNull();
  });
});

// ── Vehicle-id resolution ─────────────────────────────────────────────────────

describe('WeeklyDigestWidget — vehicle id resolution', () => {
  it('queries the digest for the explicit vehicleId prop when provided', () => {
    renderWidget(FULL, 3);
    expect(weeklyDigestMock).toHaveBeenCalledWith('3');
  });

  it('falls back to the first vehicle id when no vehicleId prop is supplied', () => {
    vehiclesMock.mockReturnValue({ data: [{ id: 42, display_name: 'Other' }] });
    renderWidget(FULL, undefined);
    expect(weeklyDigestMock).toHaveBeenCalledWith('42');
  });

  it('falls back to "0" when there are no vehicles at all', () => {
    vehiclesMock.mockReturnValue({ data: [] });
    renderWidget(FULL, undefined);
    expect(weeklyDigestMock).toHaveBeenCalledWith('0');
  });
});

// ── Null safety ───────────────────────────────────────────────────────────────

describe('WeeklyDigestWidget — null safety', () => {
  it('collapses missing numeric fields to 0 without throwing', () => {
    setDigest({
      data: makeDigest({
        distanceKm: undefined as unknown as number,
        efficiency: undefined as unknown as number,
      }),
    });

    expect(() => renderWidget(FULL)).not.toThrow();
    const [distance, , , efficiency] = deltas();
    expect(num(distance, 'data-current')).toBe(0);
    expect(num(efficiency, 'data-current')).toBe(0);
  });
});

// ── Interactions & accessibility ──────────────────────────────────────────────

describe('WeeklyDigestWidget — interactions & a11y', () => {
  it('invokes refetch when the accessible refresh control is activated', () => {
    const q = setDigest({ data: makeDigest() });
    renderWidget(FULL);

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.click(refresh);

    expect(q.refetch).toHaveBeenCalledTimes(1);
  });
});
