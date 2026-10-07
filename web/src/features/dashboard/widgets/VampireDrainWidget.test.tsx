/**
 * VampireDrainWidget — behaviour + hardening coverage.
 *
 * The widget surfaces idle "vampire" battery drain while a car is parked: an
 * average %/day headline, an optional 30-sample drain-rate sparkline, and a
 * feed of the most recent drain events. It renders three responsive layouts —
 * compact (<=1 col: a single big %/day stat), standard (2 col: stat card +
 * event feed) and wide (>=3 col: stat card + sparkline + event feed). Its
 * public surface is the default component plus two pure utilities exported for
 * direct testing — `drainColor` and `formatDuration` — both covered here.
 *
 * The suite doubles as the regression guard for two real bugs this elevation
 * fixes:
 *   - `drainColor(NaN)` used to fall through both `< 1` / `< 3` checks and
 *     return the *critical red* colour, so a malformed drain rate rendered as
 *     an alarming red chip. The fix coalesces non-finite input to 0 → "safe"
 *     green; the tests assert green for NaN/Infinity.
 *   - `formatDuration` did not guard non-finite / negative hours, so a bad
 *     payload produced "0.0h" (for NaN, via the else branch) or "-30m" (for a
 *     negative span). The fix clamps to 0 → a consistent "0m"; the tests assert
 *     that below.
 *
 * It also locks in the three responsive layouts, the loading / empty / error
 * states, the canonical derived-history response shape, the refresh
 * interaction, and vehicle-id resolution (prop → first-vehicle fallback →
 * null).
 *
 * Network is never touched — the two energy hooks and `useVehicles` are mocked
 * and driven per-test. `react-i18next` is stubbed to echo fallback strings. The
 * real `WidgetShell` / `DataFreshness` / `EmptyState` / `StatCard` / `Sparkline`
 * / `WidgetEventFeed` render, so those surfaces are exercised for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { VampireDrainStats, VampireDrainEvent } from '@/types/energy';
import type { WidgetProps } from './types';

// ── i18n stub: return the fallback string, interpolating {{var}} options ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          let s = fallbackOrOpts;
          for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
          return s;
        }
        return fallbackOrOpts;
      }
      return _key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── The data hooks — driven per test ──
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }));
vi.mock('@/api/hooks/useEnergy', () => ({
  useVampireDrainStats: vi.fn(),
  useVampireDrainEvents: vi.fn(),
  useVampireDrainWatch: vi.fn(),
}));

import { useVehicles } from '@/api/hooks/useVehicles';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';
import { act } from '@testing-library/react';
import { useVampireDrainStats, useVampireDrainEvents, useVampireDrainWatch } from '@/api/hooks/useEnergy';
import VampireDrainWidget, { drainColor, formatDuration } from './VampireDrainWidget';

const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockStats = useVampireDrainStats as unknown as ReturnType<typeof vi.fn>;
const mockEvents = useVampireDrainEvents as unknown as ReturnType<typeof vi.fn>;
const mockWatch = useVampireDrainWatch as unknown as ReturnType<typeof vi.fn>;

// A minimal fallback-echoing translator for the pure-utility tests.
const echo = (_k: string, d: string) => d;

// The middot used between event-title parts (U+00B7), pinned so exact string
// matches don't depend on the source file's byte encoding.
const DOT = '\u00B7';

 
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeStats(over: Partial<VampireDrainStats> = {}): VampireDrainStats {
  return {
    avg_drain_pct_per_day: 2.4,
    median_drain_pct_per_day: 1.8,
    p95_drain_pct_per_day: 4.8,
    total_observed_hours: 48,
    event_count: 12,
    sample_window_days: 90,
    ...over,
  };
}

// A critical (red) parked window: 8% lost over 40h → 4.8 %/day.
function criticalEvent(over: Partial<VampireDrainEvent> = {}): VampireDrainEvent {
  return {
    started_at: '2020-01-01T00:00:00Z',
    ended_at: '2020-01-02T16:00:00Z',
    duration_hours: 40,
    start_battery_pct: 80,
    end_battery_pct: 72,
    drain_pct: 8,
    drain_pct_per_day: 4.8,
    ambient_temp_c_avg: 10,
    ...over,
  };
}

// A low (green) parked window: 1% over 40h → 0.6 %/day.
function lowEvent(over: Partial<VampireDrainEvent> = {}): VampireDrainEvent {
  return {
    started_at: '2020-01-03T00:00:00Z',
    ended_at: '2020-01-04T16:00:00Z',
    duration_hours: 40,
    start_battery_pct: 70,
    end_battery_pct: 69,
    drain_pct: 1,
    drain_pct_per_day: 0.6,
    ambient_temp_c_avg: 5,
    ...over,
  };
}

function renderWidget(props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <VampireDrainWidget size={{ cols: 2, rows: 2 }} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockVehicles.mockReset();
  mockStats.mockReset();
  mockEvents.mockReset();
  mockWatch.mockReset();
  mockVehicles.mockReturnValue({ data: [{ id: 1 }] });
  mockStats.mockReturnValue(makeQuery({ data: makeStats() }));
  mockEvents.mockReturnValue(makeQuery({ data: [criticalEvent(), lowEvent()] }));
  mockWatch.mockReturnValue(makeQuery({ data: null }));
});

it.each([1, 2, 3])('keeps an accessible heading at %s columns', cols => {
  renderWidget({ size: { cols, rows: 4 } });
  expect(screen.getByRole('heading', { name: 'Vampire drain', level: 3 })).toBeVisible();
});

describe('drainColor (utility)', () => {
  it('maps the drain rate to the green / amber / red severity ramp', () => {
    expect(drainColor(0)).toBe('#10b981'); // green
    expect(drainColor(0.99)).toBe('#10b981');
    expect(drainColor(2.9)).toBe('#f59e0b'); // amber
    expect(drainColor(10)).toBe('#ef4444'); // red
  });

  it('treats the 1 and 3 %/day boundaries as the start of the next tier', () => {
    // 1 is NOT < 1 → amber; 3 is NOT < 3 → red.
    expect(drainColor(1)).toBe('#f59e0b');
    expect(drainColor(3)).toBe('#ef4444');
  });

  it('keeps non-finite input unknown rather than healthy', () => {
    // Regression guard: NaN used to fall through to the critical red colour.
    expect(drainColor(NaN)).toBe('var(--text-muted)');
    expect(drainColor(Infinity)).toBe('var(--text-muted)');
    expect(drainColor(-5)).toBe('#10b981');
    expect(drainColor(NaN)).not.toBe('#ef4444');
  });
});

describe('formatDuration (utility)', () => {
  it('renders sub-hour spans as whole minutes and longer spans as hours', () => {
    expect(formatDuration(0.5, echo)).toBe('30.00m');
    expect(formatDuration(0, echo)).toBe('0.00m');
    expect(formatDuration(1, echo)).toBe('1.00h'); // boundary: 1 is NOT < 1
    expect(formatDuration(2.5, echo)).toBe('2.50h');
  });

  it('keeps non-finite and negative durations unknown', () => {
    // Regression guard: NaN used to render "0.0h" and negatives rendered "-30m".
    expect(formatDuration(NaN, echo)).toBe('—');
    expect(formatDuration(Infinity, echo)).toBe('—');
    expect(formatDuration(-3, echo)).toBe('—');
    expect(formatDuration(NaN, echo)).not.toBe('0.00h');
  });
});

describe('VampireDrainWidget — standard layout (2 col)', () => {
  it('keeps a missing event count unknown while retaining the observed hours and feed', () => {
    mockStats.mockReturnValue(makeQuery({ data: makeStats({ event_count: null as unknown as number }) }));
    renderWidget();
    expect(screen.getByText('— events · 48.00h total')).toBeInTheDocument();
    expect(screen.getByText(`8.00% ${DOT} 40.00h`)).toBeInTheDocument();
    expect(screen.queryByText('0 events · 48.00h total')).not.toBeInTheDocument();
  });

  it('renders the headline stat card and one row per recent drain event', () => {
    renderWidget({ size: { cols: 2, rows: 2 } });

    // Headline stat card: label + value + event/hours sublabel.
    expect(screen.getByText('Avg drain')).toBeInTheDocument();
    expect(screen.getByText('2.40%/day')).toBeInTheDocument();
    expect(screen.getByText('12 events · 48.00h total')).toBeInTheDocument();

    // Event feed: measured loss + duration and normalized %/day.
    expect(screen.getByText(`8.00% ${DOT} 40.00h`)).toBeInTheDocument();
    expect(screen.getByText('4.80%/day')).toBeInTheDocument();
    expect(screen.getByText(`1.00% ${DOT} 40.00h`)).toBeInTheDocument();
    expect(screen.getByText('0.60%/day')).toBeInTheDocument();
  });

  it('does not invent a Sentry attribution absent from the endpoint', () => {
    mockEvents.mockReturnValue(makeQuery({ data: [lowEvent()] }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByText(`1.00% ${DOT} 40.00h`)).toBeInTheDocument();
    expect(screen.queryByText(/Sentry/)).not.toBeInTheDocument();
  });

  it('does not render the wide-only sparkline in the standard layout', () => {
    const { container } = renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.queryByText('Daily drain rate (last 30)')).not.toBeInTheDocument();
    expect(container.querySelector('svg[role="img"]')).toBeNull();
  });

  it('shows the feed empty state when stats exist but there are no events', () => {
    mockStats.mockReturnValue(makeQuery({ data: makeStats() }));
    mockEvents.mockReturnValue(makeQuery({ data: [] }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    // hasData is true (stats present) → the card renders and the feed degrades
    // to a labelled empty state rather than a blank gap.
    expect(screen.getByText('Avg drain')).toBeInTheDocument();
    expect(screen.getByText('No recent drain events')).toBeInTheDocument();
  });
});

describe('VampireDrainWidget — compact layout (1 col)', () => {
  it('renders its heading and single big %/day stat without a card', () => {
    renderWidget({ size: { cols: 1, rows: 1 } });

    expect(screen.getByText('2.40%')).toBeInTheDocument();
    expect(screen.getByText('/day')).toBeInTheDocument();
    // The compact slot retains its heading without adding the standard stat card.
    expect(screen.queryByText('Avg drain')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vampire drain', level: 3 })).toBeVisible();
  });

  it('does not fabricate a zero average when only events are available', () => {
    mockStats.mockReturnValue(makeQuery({ data: undefined }));
    mockEvents.mockReturnValue(makeQuery({ data: [criticalEvent()] }));
    renderWidget({ size: { cols: 1, rows: 1 } });

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Average unavailable')).toBeInTheDocument();
    expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
  });
});

describe('VampireDrainWidget — wide layout (>=3 col)', () => {
  it('adds the drain-rate sparkline alongside the card and event feed', () => {
    const { container } = renderWidget({ size: { cols: 4, rows: 2 } });

    expect(screen.getByText('Avg drain')).toBeInTheDocument();
    expect(screen.getByText('Daily drain rate (last 30)')).toBeInTheDocument();
    // Two samples → a real sparkline (role=img) is drawn.
    expect(container.querySelector('svg[role="img"]')).not.toBeNull();
    expect(screen.getByText(`8.00% ${DOT} 40.00h`)).toBeInTheDocument();
  });

  it('omits the sparkline when there are fewer than two events to plot', () => {
    mockEvents.mockReturnValue(makeQuery({ data: [criticalEvent()] }));
    const { container } = renderWidget({ size: { cols: 4, rows: 2 } });

    expect(screen.queryByText('Daily drain rate (last 30)')).not.toBeInTheDocument();
    expect(container.querySelector('svg[role="img"]')).toBeNull();
  });
});

describe('VampireDrainWidget — loading / empty / error', () => {
  it('keeps the heading with a loading skeleton and no empty state', () => {
    mockStats.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    mockEvents.mockReturnValue(makeQuery({ data: undefined }));
    const { container } = renderWidget({ size: { cols: 2, rows: 2 } });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No vampire drain data')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Vampire drain' })).toBeInTheDocument();
  });

  it('shows the empty state (not a blank panel) when no data has arrived', () => {
    mockStats.mockReturnValue(makeQuery({ data: undefined }));
    mockEvents.mockReturnValue(makeQuery({ data: [] }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    // Title still renders; the body degrades to a labelled empty state.
    expect(screen.getByRole('heading', { name: 'Vampire drain' })).toBeInTheDocument();
    expect(screen.getByText('No vampire drain data')).toBeInTheDocument();
    expect(screen.queryByText('Avg drain')).not.toBeInTheDocument();
  });

  it('treats a nullable empty distribution as unavailable rather than zero drain', () => {
    mockStats.mockReturnValue(makeQuery({
      data: makeStats({
        event_count: 0,
        total_observed_hours: 0,
        avg_drain_pct_per_day: null,
        median_drain_pct_per_day: null,
        p95_drain_pct_per_day: null,
      }),
    }));
    mockEvents.mockReturnValue(makeQuery({ data: [] }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByText('No vampire drain data')).toBeInTheDocument();
    expect(screen.queryByText('0.00%/day')).not.toBeInTheDocument();
  });

  it('surfaces fatal initial history errors with recovery', () => {
    mockStats.mockReturnValue(makeQuery({ data: undefined, isError: true, error: new Error('404') }));
    mockEvents.mockReturnValue(makeQuery({ data: undefined, isError: true, error: new Error('404') }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    // The refresh control stays available so the user can retry.
    expect(screen.getByRole('button', { name: /^Refresh data/ })).toBeInTheDocument();
  });
});

describe('VampireDrainWidget — refresh + vehicle resolution', () => {
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('disables invalid vehicle %s', (vehicleId) => {
    renderWidget({ vehicleId });
    expect(mockStats).toHaveBeenLastCalledWith(null);
    expect(mockEvents).toHaveBeenLastCalledWith(null, 30);
    expect(mockWatch).toHaveBeenLastCalledWith(null);
  });

  it('reacts to precision and locale changes in headline, feed and duration', () => {
    renderWidget();
    expect(screen.getByText('2.40%/day')).toBeInTheDocument();
    try {
      act(() => { setGlobalPrecision(3); setGlobalLocale('de-DE'); });
      expect(screen.getByText('2,400%/day')).toBeInTheDocument();
      expect(screen.getByText(`8,000% ${DOT} 40,000h`)).toBeInTheDocument();
      expect(screen.getByText('4,800%/day')).toBeInTheDocument();
    } finally {
      act(() => { setGlobalPrecision(2); setGlobalLocale('en-US'); });
    }
  });

  it.each(['stats', 'events', 'watch'])('retains measurements and retries every source after %s failure', (source) => {
    const statsRetry = vi.fn();
    const eventsRetry = vi.fn();
    const watchRetry = vi.fn();
    mockStats.mockReturnValue(makeQuery({ data: makeStats(), refetch: statsRetry,
      ...(source === 'stats' ? { isError: true, error: new Error('stats') } : {}) }));
    mockEvents.mockReturnValue(makeQuery({ data: [criticalEvent()], refetch: eventsRetry,
      ...(source === 'events' ? { isError: true, error: new Error('events') } : {}) }));
    mockWatch.mockReturnValue(makeQuery({ data: source === 'watch' ? undefined : null, refetch: watchRetry,
      ...(source === 'watch' ? { isError: true, error: new Error('watch') } : {}) }));
    renderWidget();
    expect(screen.getByText('2.40%/day')).toBeInTheDocument();
    expect(screen.getByText(`8.00% ${DOT} 40.00h`)).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(statsRetry).toHaveBeenCalledOnce();
    expect(eventsRetry).toHaveBeenCalledOnce();
    expect(watchRetry).toHaveBeenCalledOnce();
  });

  it('retries failed vehicle discovery and leaves disabled queries idle', () => {
    const refetch = vi.fn();
    mockVehicles.mockReturnValue(makeQuery({ isError: true, error: new Error('vehicles'), refetch }));
    mockStats.mockReturnValue(makeQuery({ isPending: true }));
    mockEvents.mockReturnValue(makeQuery({ isPending: true }));
    renderWidget();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Retry/ }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(mockStats).toHaveBeenCalledWith(null);
  });

  it('refetches BOTH energy queries when the refresh control is activated', () => {
    const statsRefetch = vi.fn();
    const eventsRefetch = vi.fn();
    mockStats.mockReturnValue(makeQuery({ data: makeStats(), refetch: statsRefetch }));
    mockEvents.mockReturnValue(makeQuery({ data: [criticalEvent()], refetch: eventsRefetch }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    expect(statsRefetch).toHaveBeenCalledTimes(1);
    expect(eventsRefetch).toHaveBeenCalledTimes(1);
  });

  it('queries both hooks for the vehicleId prop (as a string; events limit 30)', () => {
    renderWidget({ vehicleId: 7 });
    expect(mockStats).toHaveBeenCalledWith('7');
    expect(mockEvents).toHaveBeenCalledWith('7', 30);
  });

  it('falls back to the first vehicle id when no vehicleId prop is given', () => {
    mockVehicles.mockReturnValue({ data: [{ id: 42 }] });
    renderWidget();
    expect(mockStats).toHaveBeenCalledWith('42');
    expect(mockEvents).toHaveBeenCalledWith('42', 30);
  });

  it('passes null (disabling the queries) when no vehicle is available', () => {
    mockVehicles.mockReturnValue({ data: [] });
    renderWidget();
    expect(mockStats).toHaveBeenCalledWith(null);
    expect(mockEvents).toHaveBeenCalledWith(null, 30);
  });
});

describe('VampireDrainWidget — watchdog strip', () => {
  it('hides the strip while the watch query has no data', () => {
    renderWidget({ size: { cols: 2, rows: 2 } });
    expect(screen.queryByRole('status', { name: 'Drain watchdog status' })).toBeNull();
  });

  it('shows the healthy copy when status is ok', () => {
    mockWatch.mockReturnValue(
      makeQuery({
        data: {
          status: 'ok',
          threshold_pct_per_day: 3,
          breach_streak: 0,
          recommendation: 'Parked drain looks healthy. No action needed.',
        },
      }),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });
    expect(screen.getByText('Watchdog: drain healthy')).toBeTruthy();
  });

  it('shows the streak and recommendation on breach', () => {
    mockWatch.mockReturnValue(
      makeQuery({
        data: {
          status: 'alert',
          threshold_pct_per_day: 3,
          breach_streak: 3,
          recommendation: 'Check Sentry mode.',
        },
      }),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });
    const strip = screen.getByRole('status', { name: 'Drain watchdog status' });
    expect(strip.textContent).toContain('3');
    expect(strip.textContent).toContain('Check Sentry mode.');
  });
});
