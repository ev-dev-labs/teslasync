/**
 * MonthlyMileageWidget — behaviour + hardening coverage.
 *
 * The widget renders a vehicle's last-12-month driving distance as a summary
 * stat pair ("This Month" + "12-Mo Total") plus a bar chart, in two responsive
 * layouts — compact (≤1 col: stats only, no title/chart) and standard (≥2 col:
 * titled shell + stat header + bar chart). It has one public component export
 * (the default) plus two pure utilities (`shortMonth`, `currentMonthKey`), all
 * covered here.
 *
 * The suite doubles as the regression guard for the error-honesty bug this
 * elevation fixes: the widget previously passed `error={error ? String(error)
 * : null}` to the shell, so ANY query error — including a background refetch
 * that still had cached buckets — blew the chart away and showed a full "Can't
 * reach server" panel. The fix only surfaces the panel on a genuine
 * initial-load failure (`isError && !data`); a background-refetch error keeps
 * the cached stats/chart on screen. Both layouts are asserted.
 *
 * It also locks in: the km→display conversion (SI metres in, km/mi out) for
 * both unit preferences, the current-month selection, the last-12 slice, the
 * loading/empty states, null-safety on `total_km`, the refresh interaction,
 * and vehicle-id resolution.
 *
 * The real `useUnits` runs here (a file-level `useSettings` mock feeds it the
 * distance preference), so the conversion math is exercised for real. Network
 * is never touched — the two data hooks are mocked and driven per-test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { MonthlyMileageBucket } from '@/types/analytics';
import type { WidgetProps } from './types';

// ── Controllable user unit preference for the real useUnits ──
const settingsState = vi.hoisted(() => ({ unitOfLength: 'km' as 'km' | 'mi' }));

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

// ── useSettings: file-level override (takes precedence over the global setup
// mock) so a single test can flip the distance unit to miles while the real
// conversion hooks run unchanged. ──
vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return {
    ...actual,
    useSettings: () => ({
      settings: {
        unit_of_length: settingsState.unitOfLength,
        unit_of_temp: 'C' as const,
        unit_of_pressure: 'bar' as const,
        base_cost_per_kwh: 0.12,
        decimal_precision: 2,
        currency_symbol: '$',
        locale: 'en-US',
        gas_price_per_unit: 0,
        gas_unit: 'gallon' as const,
        gas_efficiency_mpg: 25,
      },
      isMiles: settingsState.unitOfLength === 'mi',
      isFahrenheit: false,
      isPSI: false,
      decimals: 2,
      locale: 'en-US',
      density: 'comfortable' as const,
      rangeType: 'rated' as const,
    }),
  };
});

// ── The data hooks — driven per test ──
vi.mock('@/api/hooks/useAnalytics', () => ({ useMonthlyMileage: vi.fn() }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }));

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

import { useMonthlyMileage } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import MonthlyMileageWidget, { shortMonth, currentMonthKey } from './MonthlyMileageWidget';

const mockMileage = useMonthlyMileage as unknown as ReturnType<typeof vi.fn>;
const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;

 
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

function makeBucket(over: Partial<MonthlyMileageBucket> = {}): MonthlyMileageBucket {
  return {
    year_month: '2020-01',
    drive_count: 10,
    total_km: 100,
    total_wh_consumed: 15000,
    avg_efficiency_wh_per_km: 150,
    ...over,
  };
}

function renderWidget(props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <MonthlyMileageWidget size={{ cols: 2, rows: 2 }} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  settingsState.unitOfLength = 'km';
  mockMileage.mockReset();
  mockVehicles.mockReset();
  mockVehicles.mockReturnValue({ data: [{ id: 1 }] });
  mockMileage.mockReturnValue(makeQuery({ data: [] }));
});

describe('shortMonth (utility)', () => {
  it('maps a valid YYYY-MM to its short English month name', () => {
    expect(shortMonth('2026-04')).toBe('Apr');
    expect(shortMonth('2026-01')).toBe('Jan');
    expect(shortMonth('2026-12')).toBe('Dec');
    // A single-digit month (no zero-pad) still parses.
    expect(shortMonth('2026-7')).toBe('Jul');
  });

  it('returns the raw input for malformed or out-of-range keys', () => {
    expect(shortMonth('2026-13')).toBe('2026-13'); // month index past Dec
    expect(shortMonth('2026-00')).toBe('2026-00'); // month index before Jan
    expect(shortMonth('2026')).toBe('2026'); // no separator
    expect(shortMonth('')).toBe(''); // empty string
    expect(shortMonth('2026-xx')).toBe('2026-xx'); // non-numeric month
  });
});

describe('currentMonthKey (utility)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('always returns a zero-padded YYYY-MM string', () => {
    expect(currentMonthKey()).toMatch(/^\d{4}-\d{2}$/);
  });

  it('reflects the host clock and zero-pads single-digit months', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T12:00:00'));
    expect(currentMonthKey()).toBe('2026-03');

    vi.setSystemTime(new Date('2026-11-02T09:00:00'));
    expect(currentMonthKey()).toBe('2026-11');
  });
});

describe('MonthlyMileageWidget — standard layout + conversion', () => {
  it('renders the titled shell, both summary stats, and the chart (km)', () => {
    mockMileage.mockReturnValue(
      makeQuery({
        data: [
          makeBucket({ year_month: '2019-06', total_km: 200 }),
          makeBucket({ year_month: currentMonthKey(), total_km: 100 }),
        ],
      }),
    );
    const { container } = renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByRole('heading', { name: 'Monthly Mileage' })).toBeInTheDocument();
    expect(screen.getByText('This Month')).toBeInTheDocument();
    expect(screen.getByText('12-Mo Total')).toBeInTheDocument();
    // 100 km (this month) and 300 km (12-mo total) render as plain integers.
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getAllByText('km').length).toBe(2);
    // The chart region renders (not a blank panel) in the standard layout.
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull();
  });

  it('converts the km buckets to miles for a miles user (SI metres in between)', () => {
    settingsState.unitOfLength = 'mi';
    mockMileage.mockReturnValue(
      makeQuery({
        data: [
          makeBucket({ year_month: '2019-06', total_km: 100 }),
          makeBucket({ year_month: currentMonthKey(), total_km: 100 }),
        ],
      }),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    // 100 km = 100,000 m ÷ 1609.344 ≈ 62 mi (this month);
    // 200 km total ≈ 124 mi.
    expect(screen.getByText('62')).toBeInTheDocument();
    expect(screen.getByText('124')).toBeInTheDocument();
    expect(screen.getAllByText('mi').length).toBe(2);
    // The raw km magnitude must never leak under a miles preference.
    expect(screen.queryByText('km')).not.toBeInTheDocument();
    expect(screen.queryByText('100')).not.toBeInTheDocument();
  });

  it('counts only the most recent 12 buckets in the total (slice guard)', () => {
    const buckets: MonthlyMileageBucket[] = [
      // Oldest bucket — must be dropped by slice(-12); its huge value would
      // dominate the total if it leaked in.
      makeBucket({ year_month: '2019-01', total_km: 99999 }),
    ];
    for (let i = 1; i <= 12; i += 1) {
      buckets.push(makeBucket({ year_month: `2019-${String(i).padStart(2, '0')}`, total_km: 10 }));
    }
    mockMileage.mockReturnValue(makeQuery({ data: buckets }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    // 12 × 10 km = 120 km; the excluded 99,999 km bucket never contributes.
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.queryByText('100,119')).not.toBeInTheDocument();
  });

  it('coalesces a null total_km to 0 without leaking NaN', () => {
    mockMileage.mockReturnValue(
      makeQuery({
        data: [
          makeBucket({ year_month: currentMonthKey(), total_km: null as unknown as number }),
          makeBucket({ year_month: '2019-05', total_km: 50 }),
        ],
      }),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    // Current month has a null distance → 0; total is the other bucket's 50.
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});

describe('MonthlyMileageWidget — compact layout', () => {
  it('renders the stats but no title and no chart in the compact (1-col) slot', () => {
    mockMileage.mockReturnValue(
      makeQuery({
        data: [
          makeBucket({ year_month: '2019-05', total_km: 50 }),
          makeBucket({ year_month: currentMonthKey(), total_km: 100 }),
        ],
      }),
    );
    const { container } = renderWidget({ size: { cols: 1, rows: 1 } });

    // Stats still render (100 this month, 150 total)...
    expect(screen.getByText('This Month')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    // ...but the compact slot has no shell title and no chart.
    expect(screen.queryByRole('heading', { name: 'Monthly Mileage' })).not.toBeInTheDocument();
    expect(container.querySelector('.recharts-responsive-container')).toBeNull();
  });
});

describe('MonthlyMileageWidget — loading / empty', () => {
  it('shows a skeleton while loading (no stats, no empty state)', () => {
    mockMileage.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    const { container } = renderWidget({ size: { cols: 2, rows: 2 } });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No mileage data')).not.toBeInTheDocument();
    expect(screen.queryByText('This Month')).not.toBeInTheDocument();
  });

  it('shows the empty state (not a blank panel) when no buckets have arrived', () => {
    mockMileage.mockReturnValue(makeQuery({ data: [] }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByText('No mileage data')).toBeInTheDocument();
    expect(screen.queryByText('This Month')).not.toBeInTheDocument();
  });

  it('treats all-zero-distance buckets as empty', () => {
    mockMileage.mockReturnValue(
      makeQuery({ data: [makeBucket({ total_km: 0 }), makeBucket({ total_km: 0 })] }),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByText('No mileage data')).toBeInTheDocument();
  });

  it('shows the compact empty state when no buckets have arrived', () => {
    mockMileage.mockReturnValue(makeQuery({ data: [] }));
    renderWidget({ size: { cols: 1, rows: 1 } });

    expect(screen.getByText('No mileage data')).toBeInTheDocument();
  });
});

describe('MonthlyMileageWidget — error honesty', () => {
  it('surfaces a real error panel instead of the empty state on initial-load failure', () => {
    mockMileage.mockReturnValue(
      makeQuery({ data: undefined, isError: true, error: new Error('boom') }),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    // Honest error panel from WidgetShell (QueryError), not "No mileage data".
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No mileage data')).not.toBeInTheDocument();
    expect(screen.queryByText('This Month')).not.toBeInTheDocument();
  });

  it('keeps cached stats on screen when a background refetch errors', () => {
    mockMileage.mockReturnValue(
      makeQuery({
        data: [
          makeBucket({ year_month: '2019-05', total_km: 50 }),
          makeBucket({ year_month: currentMonthKey(), total_km: 100 }),
        ],
        isError: true,
        error: new Error('boom'),
      }),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    // Data present → the error is a subtle freshness signal, not a full panel.
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    expect(screen.getByText('This Month')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
  });

  it('keeps the compact stats on screen when a background refetch errors', () => {
    mockMileage.mockReturnValue(
      makeQuery({
        data: [
          makeBucket({ year_month: '2019-05', total_km: 50 }),
          makeBucket({ year_month: currentMonthKey(), total_km: 100 }),
        ],
        isError: true,
        error: new Error('boom'),
      }),
    );
    renderWidget({ size: { cols: 1, rows: 1 } });

    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
  });
});

describe('MonthlyMileageWidget — refresh + vehicle resolution', () => {
  it('refetches monthly mileage when the refresh control is activated', () => {
    const refetch = vi.fn();
    mockMileage.mockReturnValue(
      makeQuery({ data: [makeBucket({ year_month: currentMonthKey() })], refetch }),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('queries mileage for the vehicleId prop (as a string)', () => {
    renderWidget({ vehicleId: 7 });
    expect(mockMileage).toHaveBeenCalledWith('7');
  });

  it('falls back to the first vehicle id when no vehicleId prop is given', () => {
    mockVehicles.mockReturnValue({ data: [{ id: 42 }] });
    renderWidget();
    expect(mockMileage).toHaveBeenCalledWith('42');
  });

  it('passes an empty string (disabling the query) when no vehicle is available', () => {
    mockVehicles.mockReturnValue({ data: [] });
    renderWidget();
    expect(mockMileage).toHaveBeenCalledWith('');
  });
});
