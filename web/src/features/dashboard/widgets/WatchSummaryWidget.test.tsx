/**
 * WatchSummaryWidget tests.
 *
 * The widget projects a Tesla "watch face" summary (`useWatchSummary`) plus a
 * minimal charging complication (`useWatchComplication`) into two responsive
 * layouts. Its behaviour surface — the thing under test:
 *
 *   1. `getBatteryColor` — the SoC → accent-color band utility (an export):
 *        > 50 % emerald, > 20 % amber, ≤ 20 % red, with the two boundaries pinned.
 *   2. Two layouts driven by `size.cols`:
 *        - compact (cols <= 1): a title-less watch face — a LinearGauge whose
 *          progress stroke is `getBatteryColor(level)`, a StatusBadge, the
 *          SI→preference converted range, and a pulsing charging indicator.
 *        - standard (cols >= 2): a titled "Watch Summary" shell with a battery
 *          big-number + state badge (variant derived from the state), and a 2×2
 *          detail grid (range, lock/unlock, cabin temp, last seen).
 *   3. Unit conversion at the display boundary: `range_km` is kilometres — the
 *        widget lifts it to SI metres (`× 1000`) before `convertDistanceFromSI`,
 *        so 300 km → "186" mi / "300" km; `inside_temp_c` is Celsius, so
 *        20 °C → "68" °F. Both converters run for real.
 *   4. The four query states each source must handle: loading (skeleton),
 *        comp-loading (OR-aggregation still shows the skeleton), empty
 *        (EmptyState — never a blank panel), and data.
 *   5. Graceful degradation (the design contract): this widget never surfaces a
 *        full-panel QueryError. A background-refetch error keeps cached content
 *        on screen and flags the freshness dot red; an error with no data falls
 *        through to the EmptyState, still red-dotted — never a blank panel.
 *   6. Null-safety: a partial summary degrades every absent field to an em-dash
 *        placeholder rather than throwing on the optional reads.
 *   7. The freshness control: clicking refetches, but only when a fetch is not
 *        already in flight.
 *   8. Prop wiring: the `vehicleId` prop is threaded to BOTH query hooks.
 *
 * `@/api/hooks/useWatch` and `@/hooks/useUnits` are mocked so the network is
 * never touched and every query state / unit preference is deterministic.
 * `react-i18next` is stubbed with a passthrough `t(key, default)` so assertions
 * read the English defaults. `@/hooks/useDateFormat` + `@/hooks/useTimeFormatPreference`
 * are stubbed so the real `<TimeStamp>` / `<DataFreshness>` render without a
 * settings QueryClient. The shared WidgetShell / DataFreshness / LinearGauge /
 * StatusBadge / WidgetBigNumber / Badge / EmptyState primitives and the real
 * `convertDistanceFromSI` / `convertTempFromSI` all run for real, so assertions
 * exercise the true rendered DOM.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { WatchSummary, WatchComplication } from '@/api/hooks/useWatch';
import WatchSummaryWidget, { getBatteryColor } from './WatchSummaryWidget';
import { BADGE_VARIANTS } from '@/components/ui';
import { hasGaugeColor } from '@/test/gaugeTestUtils';

// jsdom lacks matchMedia; DataFreshness → useMotionPreference and AnimatedNumber
// read it during render. Report reduced-motion = true so AnimatedNumber skips
// its rAF tween and lands on the target value synchronously — making every
// rendered number deterministic under `render`. All other queries report false.
vi.hoisted(() => {
  if (typeof window !== 'undefined') {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
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

const { useWatchSummaryMock, useWatchComplicationMock, useUnitsMock } = vi.hoisted(() => ({
  useWatchSummaryMock: vi.fn(),
  useWatchComplicationMock: vi.fn(),
  useUnitsMock: vi.fn(),
}));

vi.mock('@/api/hooks/useWatch', () => ({
  useWatchSummary: (vehicleId?: number) => useWatchSummaryMock(vehicleId),
  useWatchComplication: (vehicleId?: number) => useWatchComplicationMock(vehicleId),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => useUnitsMock(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | Record<string, unknown>) =>
      typeof defaultValue === 'string' ? defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// TimeStamp (last-seen cell) and DataFreshness read the user's settings via
// these hooks, which are otherwise backed by TanStack Query. Stub them so the
// real components render deterministically without a settings QueryClient.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDate: () => 'May 1, 2024',
    formatDateTime: () => 'May 1, 2024, 12:00 PM',
    formatTime: () => '12:00 PM',
    formatRelative: () => '2h ago',
  }),
}));

vi.mock('@/hooks/useTimeFormatPreference', () => ({
  useTimeFormatPreference: () => 'relative',
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeUnits(distance: 'mi' | 'km' = 'mi', temperature: '°C' | '°F' = '°C') {
  return { unitPrefs: { distance, temperature } };
}

function makeSummary(overrides: Partial<WatchSummary> = {}): WatchSummary {
  return {
    vehicle_name: 'Model Y',
    state: 'online',
    battery_level: 72,
    range_km: 300,
    is_charging: false,
    charge_rate: 0,
    time_to_full: 0,
    is_locked: true,
    sentry_mode: false,
    inside_temp_c: 21,
    outside_temp_c: 15,
    is_climate_on: false,
    last_updated: '2024-05-01T12:00:00Z',
    ...overrides,
  };
}

function makeComplication(overrides: Partial<WatchComplication> = {}): WatchComplication {
  return {
    battery: '72%',
    range: '186 mi',
    state: 'online',
    charging: false,
    ...overrides,
  };
}

interface SummaryQuery {
  data: WatchSummary | null | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeSummaryQuery(overrides: Partial<SummaryQuery> = {}): SummaryQuery {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

interface ComplicationQuery {
  data: WatchComplication | null | undefined;
  isLoading: boolean;
}

function makeComplicationQuery(overrides: Partial<ComplicationQuery> = {}): ComplicationQuery {
  return {
    data: undefined,
    isLoading: false,
    ...overrides,
  };
}

function renderWidget(
  size: { cols: number; rows: number } = { cols: 2, rows: 2 },
  vehicleId?: number,
) {
  return render(
    <MemoryRouter>
      <WatchSummaryWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults so a test that forgets to seed a hook still renders a
  // populated widget rather than crashing on a destructure of `undefined`.
  useUnitsMock.mockReturnValue(makeUnits('mi', '°C'));
  useWatchSummaryMock.mockReturnValue(makeSummaryQuery({ data: makeSummary() }));
  useWatchComplicationMock.mockReturnValue(makeComplicationQuery({ data: makeComplication() }));
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getBatteryColor', () => {
  it('maps healthy SoC (> 50%) to emerald', () => {
    expect(getBatteryColor(100)).toBe('#10b981');
    expect(getBatteryColor(72)).toBe('#10b981');
    expect(getBatteryColor(51)).toBe('#10b981');
  });

  it('maps low SoC (> 20% and <= 50%) to amber, including the 50 boundary', () => {
    expect(getBatteryColor(50)).toBe('#f59e0b');
    expect(getBatteryColor(30)).toBe('#f59e0b');
    expect(getBatteryColor(21)).toBe('#f59e0b');
  });

  it('maps critical SoC (<= 20%) to red, including the 20 boundary and zero', () => {
    expect(getBatteryColor(20)).toBe('#ef4444');
    expect(getBatteryColor(5)).toBe('#ef4444');
    expect(getBatteryColor(0)).toBe('#ef4444');
  });
});

describe('WatchSummaryWidget — standard layout', () => {
  it('renders the title, battery big number + state badge, and the full detail grid (mi/°C)', () => {
    useUnitsMock.mockReturnValue(makeUnits('mi', '°C'));
    useWatchSummaryMock.mockReturnValue(
      makeSummaryQuery({
        data: makeSummary({
          battery_level: 72,
          range_km: 300,
          state: 'online',
          is_locked: true,
          inside_temp_c: 21,
        }),
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Title + hero battery.
    expect(screen.getByText('Watch Summary')).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(screen.getByText('online')).toBeInTheDocument();

    // Range: 300 km → 300000 m → 300000 / 1609.344 = 186.4 → "186" mi.
    expect(screen.getByText('Range')).toBeInTheDocument();
    expect(screen.getByText('186')).toBeInTheDocument();
    expect(screen.getByText('mi')).toBeInTheDocument();

    // Lock + cabin temp + last seen.
    expect(screen.getByText('Lock')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Cabin')).toBeInTheDocument();
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByText('°C')).toBeInTheDocument();
    expect(screen.getByText('Last Seen')).toBeInTheDocument();
  });

  it('converts range to the km preference and temperature to the °F preference', () => {
    useUnitsMock.mockReturnValue(makeUnits('km', '°F'));
    useWatchSummaryMock.mockReturnValue(
      makeSummaryQuery({
        data: makeSummary({ range_km: 300, inside_temp_c: 20 }),
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // 300 km → "300" km (no unit lift artefacts) and 20 °C → 68 °F.
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('km')).toBeInTheDocument();
    expect(screen.getByText('68')).toBeInTheDocument();
    expect(screen.getByText('°F')).toBeInTheDocument();
    // The mi label must NOT appear once the preference is km.
    expect(screen.queryByText('mi')).not.toBeInTheDocument();
  });

  it('renders the Unlocked chip when the vehicle is unlocked', () => {
    useWatchSummaryMock.mockReturnValue(
      makeSummaryQuery({ data: makeSummary({ is_locked: false }) }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Unlocked')).toBeInTheDocument();
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
  });
});

describe('WatchSummaryWidget — state badge variants', () => {
  const cases = [
    { state: 'online', cls: 'bg-green-100' },
    { state: 'asleep', cls: BADGE_VARIANTS.neutral },
    { state: 'offline', cls: 'bg-yellow-100' },
  ] as const;

  it.each(cases)('renders "$state" with the $cls badge variant', ({ state, cls }) => {
    useWatchSummaryMock.mockReturnValue(makeSummaryQuery({ data: makeSummary({ state }) }));

    renderWidget({ cols: 2, rows: 2 });

    const badge = screen.getByText(state);
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain(cls);
  });
});

describe('WatchSummaryWidget — compact layout', () => {
  it('renders the gauge %, status badge and converted range with no section title', () => {
    useUnitsMock.mockReturnValue(makeUnits('mi', '°C'));
    useWatchSummaryMock.mockReturnValue(
      makeSummaryQuery({ data: makeSummary({ battery_level: 72, range_km: 300, state: 'online' }) }),
    );

    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText('72')).toBeInTheDocument(); // gauge value
    expect(screen.getByText('%')).toBeInTheDocument(); // gauge unit
    expect(screen.getByText('online')).toBeInTheDocument(); // StatusBadge
    expect(screen.getByText(/186/)).toBeInTheDocument(); // converted range
    // Compact mode drops the header title.
    expect(screen.queryByText('Watch Summary')).not.toBeInTheDocument();
  });

  it('paints the gauge progress stroke with the healthy-band color at high SoC', () => {
    useWatchSummaryMock.mockReturnValue(makeSummaryQuery({ data: makeSummary({ battery_level: 80 }) }));

    const { container } = renderWidget({ cols: 1, rows: 2 });

    expect(hasGaugeColor(container, '#10b981')).toBe(true);
    expect(hasGaugeColor(container, '#ef4444')).toBe(false);
  });

  it('paints the gauge progress stroke with the critical-band color at low SoC', () => {
    useWatchSummaryMock.mockReturnValue(makeSummaryQuery({ data: makeSummary({ battery_level: 8 }) }));

    const { container } = renderWidget({ cols: 1, rows: 2 });

    expect(hasGaugeColor(container, '#ef4444')).toBe(true);
    expect(hasGaugeColor(container, '#10b981')).toBe(false);
  });

  it('shows the pulsing charging indicator when the complication reports charging', () => {
    useWatchSummaryMock.mockReturnValue(makeSummaryQuery({ data: makeSummary() }));
    useWatchComplicationMock.mockReturnValue(
      makeComplicationQuery({ data: makeComplication({ charging: true }) }),
    );

    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText(/Charging/i)).toBeInTheDocument();
  });

  it('omits the charging indicator when not charging', () => {
    useWatchSummaryMock.mockReturnValue(makeSummaryQuery({ data: makeSummary() }));
    useWatchComplicationMock.mockReturnValue(
      makeComplicationQuery({ data: makeComplication({ charging: false }) }),
    );

    renderWidget({ cols: 1, rows: 2 });

    expect(screen.queryByText(/Charging/i)).not.toBeInTheDocument();
  });
});

describe('WatchSummaryWidget — empty states (never a blank panel)', () => {
  it('renders the titled shell with the "No watch data" placeholder when summary is absent (standard)', () => {
    useWatchSummaryMock.mockReturnValue(makeSummaryQuery({ data: undefined }));

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Watch Summary')).toBeInTheDocument();
    expect(screen.getByText('No watch data')).toBeInTheDocument();
  });

  it('renders the title-less empty state when summary is absent (compact)', () => {
    useWatchSummaryMock.mockReturnValue(makeSummaryQuery({ data: null }));

    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText('No watch data')).toBeInTheDocument();
    expect(screen.queryByText('Watch Summary')).not.toBeInTheDocument();
  });
});

describe('WatchSummaryWidget — query states', () => {
  it('renders a skeleton while the summary query is loading, with no title or content', () => {
    useWatchSummaryMock.mockReturnValue(makeSummaryQuery({ isLoading: true, data: undefined }));

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Watch Summary')).not.toBeInTheDocument();
    expect(screen.queryByText('No watch data')).not.toBeInTheDocument();
  });

  it('enters the loading state when only the complication query is still loading (OR aggregation)', () => {
    useWatchSummaryMock.mockReturnValue(makeSummaryQuery({ data: makeSummary() }));
    useWatchComplicationMock.mockReturnValue(makeComplicationQuery({ isLoading: true }));

    const { container } = renderWidget({ cols: 2, rows: 2 });

    // isLoading = summaryLoading || compLoading → the shell shows the skeleton
    // and suppresses the content even though the summary payload has landed.
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Watch Summary')).not.toBeInTheDocument();
  });
});

describe('WatchSummaryWidget — graceful degradation on error', () => {
  it('keeps cached content and flags the freshness dot red instead of a full-panel error', () => {
    useWatchSummaryMock.mockReturnValue(
      makeSummaryQuery({
        data: makeSummary({ battery_level: 72, state: 'online' }),
        isError: true,
        isFetching: false,
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    // Content is still on screen …
    expect(screen.getByText('Watch Summary')).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument();
    // … the full-panel QueryError is NOT shown …
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    // … and the freshness indicator is in its error state (red dot).
    expect(container.querySelector('.bg-red-400')).toBeTruthy();
  });

  it('falls through to the EmptyState (not a QueryError) when the summary errors with no data', () => {
    useWatchSummaryMock.mockReturnValue(
      makeSummaryQuery({ data: undefined, isError: true, isFetching: false }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Watch Summary')).toBeInTheDocument();
    expect(screen.getByText('No watch data')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    expect(container.querySelector('.bg-red-400')).toBeTruthy();
  });
});

describe('WatchSummaryWidget — null-safety', () => {
  it('degrades a partial summary to em-dash placeholders without throwing', () => {
    useWatchSummaryMock.mockReturnValue(
      // Only battery_level present — every other field is absent.
      makeSummaryQuery({ data: { battery_level: 50 } as WatchSummary }),
    );

    expect(() => renderWidget({ cols: 2, rows: 2 })).not.toThrow();

    expect(screen.getByText('50')).toBeInTheDocument();
    // range, lock, cabin temp and last-seen all collapse to the "—" placeholder.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    // No state → no badge chip.
    expect(screen.queryByText('online')).not.toBeInTheDocument();
  });
});

describe('WatchSummaryWidget — freshness interaction', () => {
  it('refetches the summary when the accessible refresh control is clicked', () => {
    const refetch = vi.fn();
    useWatchSummaryMock.mockReturnValue(
      makeSummaryQuery({ data: makeSummary(), refetch, isFetching: false }),
    );

    renderWidget({ cols: 2, rows: 2 });

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not refetch while a fetch is already in flight', () => {
    const refetch = vi.fn();
    useWatchSummaryMock.mockReturnValue(
      makeSummaryQuery({ data: makeSummary(), refetch, isFetching: true }),
    );

    renderWidget({ cols: 2, rows: 2 });

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetch).not.toHaveBeenCalled();
  });
});

describe('WatchSummaryWidget — prop wiring', () => {
  it('threads an explicit vehicleId to both the summary and complication hooks', () => {
    renderWidget({ cols: 2, rows: 2 }, 7);

    expect(useWatchSummaryMock).toHaveBeenCalledWith(7);
    expect(useWatchComplicationMock).toHaveBeenCalledWith(7);
  });

  it('passes undefined through to both hooks when no vehicleId prop is given', () => {
    renderWidget({ cols: 2, rows: 2 });

    expect(useWatchSummaryMock).toHaveBeenCalledWith(undefined);
    expect(useWatchComplicationMock).toHaveBeenCalledWith(undefined);
  });
});
