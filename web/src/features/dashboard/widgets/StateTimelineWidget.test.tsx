/**
 * StateTimelineWidget — behaviour + hardening coverage.
 *
 * The widget breaks a vehicle's per-state time budget (driving / charging /
 * asleep / idle / offline) into a stacked bar plus, depending on the grid slot,
 * a compact colour legend (≤1 col), a per-state row list (≥2 col), and a 24h
 * transition stripe (≥3 col). Its public surface is the default component plus
 * three pure utilities exported for direct testing — `buildSegments`,
 * `stateColor`, and `fmtDuration` — all covered here.
 *
 * The suite doubles as the regression guard for the real duration-formatting
 * bug this elevation fixes: `fmtDuration` used to floor the hours and round the
 * *remaining* minutes independently, so 59.6 min rendered as "60m" and 119.6 as
 * "1h 60m". The fix rounds to whole minutes first, so those roll over to
 * "1h 0m" / "2h 0m"; both are asserted below. It also locks in the null-safety
 * hardening (`stateColor(undefined)` no longer throws; `buildSegments` guards
 * null input and non-positive totals), the three responsive layouts, the
 * loading / empty states, the removed-endpoint error degradation (these two
 * analytics endpoints were dropped in Phase-42, so the queries error and the
 * widget must fall back to a non-blank empty state), the refresh interaction,
 * and vehicle-id resolution.
 *
 * Network is never touched — the two analytics hooks and `useVehicles` are
 * mocked and driven per-test. `react-i18next` is stubbed to echo fallback
 * strings. The real `WidgetShell` / `DataFreshness` / `EmptyState` render, so
 * the freshness control and empty state are exercised for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
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
vi.mock('@/api/hooks/useAnalytics', () => ({
  useStateSummary: vi.fn(),
  useTimeline: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }));

import { useStateSummary, useTimeline } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import StateTimelineWidget, {
  buildSegments,
  stateColor,
  fmtDuration,
} from './StateTimelineWidget';

const mockSummary = useStateSummary as unknown as ReturnType<typeof vi.fn>;
const mockTimeline = useTimeline as unknown as ReturnType<typeof vi.fn>;
const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;

// A minimal fallback-echoing translator for the pure-utility tests.
const echo = (_k: string, d: string) => d;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// driving 180 min (75%) + idle 60 min (25%) — clean, unique percentages.
function summaryRows() {
  return [
    { state: 'driving', totalMin: 180, count: 3 },
    { state: 'idle', totalMin: 60, count: 1 },
  ];
}

function timelineRows() {
  return [
    { id: 't1', state: 'driving', startDate: '2020-01-01T00:00:00Z', durationMin: 100 },
    { id: 't2', state: 'idle', startDate: '2020-01-01T02:00:00Z', durationMin: 50 },
  ];
}

function renderWidget(props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <StateTimelineWidget size={{ cols: 2, rows: 2 }} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockSummary.mockReset();
  mockTimeline.mockReset();
  mockVehicles.mockReset();
  mockVehicles.mockReturnValue({ data: [{ id: 1 }] });
  mockSummary.mockReturnValue(makeQuery({ data: [] }));
  mockTimeline.mockReturnValue(makeQuery({ data: [] }));
});

describe('buildSegments (utility)', () => {
  it('computes per-state percentages from the minute totals', () => {
    expect(buildSegments(summaryRows())).toEqual([
      { state: 'driving', pct: 75, totalMin: 180, count: 3 },
      { state: 'idle', pct: 25, totalMin: 60, count: 1 },
    ]);
  });

  it('returns an empty array for an empty, null, or undefined payload', () => {
    expect(buildSegments([])).toEqual([]);
    expect(buildSegments(null)).toEqual([]);
    expect(buildSegments(undefined)).toEqual([]);
  });

  it('treats an all-zero or non-positive total as empty (no divide-by-zero)', () => {
    expect(buildSegments([{ state: 'idle', totalMin: 0, count: 0 }])).toEqual([]);
    // A stray negative total must not produce negative percentages.
    expect(buildSegments([{ state: 'idle', totalMin: -10, count: 1 }])).toEqual([]);
  });

  it('coalesces null state/minutes/count fields without leaking NaN', () => {
    expect(
      buildSegments([
        { state: null, totalMin: null, count: null },
        { state: 'idle', totalMin: 60, count: 2 },
      ]),
    ).toEqual([
      { state: '—', pct: 0, totalMin: 0, count: 0 },
      { state: 'idle', pct: 100, totalMin: 60, count: 2 },
    ]);
  });
});

describe('stateColor (utility)', () => {
  it('maps each known state to its palette colour, case-insensitively', () => {
    expect(stateColor('driving')).toBe('#22d3ee');
    expect(stateColor('CHARGING')).toBe('#22c55e');
    expect(stateColor('Asleep')).toBe('#a855f7');
    expect(stateColor('idle')).toBe('#f59e0b');
    expect(stateColor('offline')).toBe('#ef4444');
  });

  it('falls back to neutral grey for unknown or absent states (no throw)', () => {
    expect(stateColor('teleporting')).toBe('#6b7280');
    expect(stateColor('')).toBe('#6b7280');
    expect(stateColor(undefined)).toBe('#6b7280');
    expect(stateColor(null)).toBe('#6b7280');
  });
});

describe('fmtDuration (utility)', () => {
  it('formats sub-hour and multi-hour durations', () => {
    expect(fmtDuration(30, echo)).toBe('30m');
    expect(fmtDuration(90, echo)).toBe('1h 30m');
    expect(fmtDuration(0, echo)).toBe('0m');
  });

  it('rolls minutes over correctly instead of emitting "60m" / "Xh 60m"', () => {
    // Regression guard: the old per-part rounding produced "60m" and "1h 60m".
    expect(fmtDuration(59.6, echo)).toBe('1h 0m');
    expect(fmtDuration(119.6, echo)).toBe('2h 0m');
    expect(fmtDuration(59.6, echo)).not.toBe('60m');
  });

  it('coalesces non-finite and negative inputs to "0m"', () => {
    expect(fmtDuration(NaN, echo)).toBe('0m');
    expect(fmtDuration(-5, echo)).toBe('0m');
    expect(fmtDuration(Infinity, echo)).toBe('0m');
  });
});

describe('StateTimelineWidget — standard layout (≥2 col)', () => {
  it('renders the title, stacked bar, and a labelled row per state', () => {
    mockSummary.mockReturnValue(makeQuery({ data: summaryRows() }));
    mockTimeline.mockReturnValue(makeQuery({ data: timelineRows() }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByRole('heading', { name: 'State Timeline' })).toBeInTheDocument();
    // State rows: label + human duration + percentage badge.
    expect(screen.getByText('driving')).toBeInTheDocument();
    expect(screen.getByText('idle')).toBeInTheDocument();
    expect(screen.getByText('3h 0m')).toBeInTheDocument();
    expect(screen.getByText('1h 0m')).toBeInTheDocument();
    expect(screen.getByText('75.0%')).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
    // Stacked bar segments carry the state/percentage tooltip.
    expect(screen.getByTitle('driving: 75.0%')).toBeInTheDocument();
    expect(screen.getByTitle('idle: 25.0%')).toBeInTheDocument();
    // The 24h stripe is wide-only — it must NOT appear here even with timeline data.
    expect(screen.queryByText('24h Timeline')).not.toBeInTheDocument();
  });
});

describe('StateTimelineWidget — compact layout (≤1 col)', () => {
  it('renders the stacked bar + integer legend, no title and no rows', () => {
    mockSummary.mockReturnValue(makeQuery({ data: summaryRows() }));
    renderWidget({ size: { cols: 1, rows: 1 } });

    // No shell title in the 1×1 slot.
    expect(screen.queryByRole('heading', { name: 'State Timeline' })).not.toBeInTheDocument();
    // Legend: label + integer percentage (no decimals, no duration rows).
    expect(screen.getByText('driving')).toBeInTheDocument();
    expect(screen.getByText('idle')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.queryByText('3h 0m')).not.toBeInTheDocument();
    // Stacked bar is still present in the compact slot.
    expect(screen.getByTitle('driving: 75.0%')).toBeInTheDocument();
  });
});

describe('StateTimelineWidget — wide layout (≥3 col)', () => {
  it('adds the 24h transition stripe alongside the state rows', () => {
    mockSummary.mockReturnValue(makeQuery({ data: summaryRows() }));
    mockTimeline.mockReturnValue(makeQuery({ data: timelineRows() }));
    renderWidget({ size: { cols: 4, rows: 3 } });

    expect(screen.getByRole('heading', { name: 'State Timeline' })).toBeInTheDocument();
    // Full row list is shared with the standard layout.
    expect(screen.getByText('3h 0m')).toBeInTheDocument();
    // Wide-only stripe: label + per-transition tooltips.
    expect(screen.getByText('24h Timeline')).toBeInTheDocument();
    expect(screen.getByTitle('driving: 100 min')).toBeInTheDocument();
    expect(screen.getByTitle('idle: 50 min')).toBeInTheDocument();
  });
});

describe('StateTimelineWidget — loading / empty / error', () => {
  it('shows a skeleton while loading (no title, no empty state)', () => {
    mockSummary.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    mockTimeline.mockReturnValue(makeQuery({ data: undefined }));
    const { container } = renderWidget({ size: { cols: 2, rows: 2 } });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No state data available')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'State Timeline' })).not.toBeInTheDocument();
  });

  it('shows the empty state (not a blank panel) when no state data has arrived', () => {
    mockSummary.mockReturnValue(makeQuery({ data: [] }));
    mockTimeline.mockReturnValue(makeQuery({ data: [] }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    // Title still renders; the body degrades to a labelled empty state.
    expect(screen.getByRole('heading', { name: 'State Timeline' })).toBeInTheDocument();
    expect(screen.getByText('No state data available')).toBeInTheDocument();
    expect(screen.queryByText('driving')).not.toBeInTheDocument();
  });

  it('degrades to the empty state (never a crash) when the removed endpoints error', () => {
    // /vehicle-states/{summary,timeline} were dropped in Phase-42, so these
    // queries always error in production — the widget must stay non-blank.
    mockSummary.mockReturnValue(makeQuery({ data: undefined, isError: true, error: new Error('410 Gone') }));
    mockTimeline.mockReturnValue(makeQuery({ data: undefined, isError: true, error: new Error('410 Gone') }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByText('No state data available')).toBeInTheDocument();
    // The refresh control stays available so the user can retry.
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});

describe('StateTimelineWidget — refresh + vehicle resolution', () => {
  it('refetches BOTH analytics queries when the refresh control is activated', () => {
    const summaryRefetch = vi.fn();
    const timelineRefetch = vi.fn();
    mockSummary.mockReturnValue(makeQuery({ data: summaryRows(), refetch: summaryRefetch }));
    mockTimeline.mockReturnValue(makeQuery({ data: timelineRows(), refetch: timelineRefetch }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(summaryRefetch).toHaveBeenCalledTimes(1);
    expect(timelineRefetch).toHaveBeenCalledTimes(1);
  });

  it('queries both hooks for the vehicleId prop (as a string)', () => {
    renderWidget({ vehicleId: 7 });
    expect(mockSummary).toHaveBeenCalledWith('7');
    expect(mockTimeline).toHaveBeenCalledWith('7');
  });

  it('falls back to the first vehicle id when no vehicleId prop is given', () => {
    mockVehicles.mockReturnValue({ data: [{ id: 42 }] });
    renderWidget();
    expect(mockSummary).toHaveBeenCalledWith('42');
    expect(mockTimeline).toHaveBeenCalledWith('42');
  });

  it('passes an empty string (disabling the queries) when no vehicle is available', () => {
    mockVehicles.mockReturnValue({ data: [] });
    renderWidget();
    expect(mockSummary).toHaveBeenCalledWith('');
    expect(mockTimeline).toHaveBeenCalledWith('');
  });
});
