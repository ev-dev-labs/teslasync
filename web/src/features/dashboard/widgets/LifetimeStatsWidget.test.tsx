/**
 * LifetimeStatsWidget — behaviour + hardening coverage.
 *
 * The widget renders a vehicle's lifetime driving/charging totals in three
 * responsive layouts — compact (≤1 col, a single AnimatedNumber), standard
 * (2 col, the four "core" stats) and wide (≥3 col, core + cost/ownership/
 * avg-daily). It has a single public export (the default component), so every
 * branch is exercised through it.
 *
 * The suite doubles as the regression guard for the real distance bug this
 * elevation fixes:
 *   - The API returns kilometres in `total_distance_km`. The widget previously
 *     multiplied km by KM_TO_MI and fed the result into `convertDistanceFromSI`,
 *     which expects SI *metres* — a double conversion that made a 50,000 km
 *     lifetime read as ~31 km (km pref) or ~19 mi (mi pref). The fix lifts km →
 *     metres (`* 1000`) before the SI converter, so the tests assert the true
 *     "50,000" km / "31,069" mi and prove the doubly-converted magnitude never
 *     leaks. Both the avg-daily derive and the compact big number share the fix.
 *
 * It also locks in the error-honesty fix (a genuine initial-load failure shows a
 * real error panel, while a background-refetch error with cached data keeps the
 * stats on screen), the loading/empty states, null-safety on every field, the
 * refresh interaction, and vehicle-id resolution.
 *
 * The real `useUnits`/`useFormatting` run here (a file-level `useSettings` mock
 * feeds them the display preference), so the conversion + currency math is
 * exercised for real. Network is never touched — the two data hooks are mocked
 * and driven per-test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useLifetimeStats, type LifetimeStats } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import type { WidgetProps } from './types';
import LifetimeStatsWidget from './LifetimeStatsWidget';

// ── Controllable user unit preference for the real useUnits/useFormatting ──
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

// ── useSettings: file-level override (takes precedence over the global
// setup mock) so a single test can flip the distance unit to miles while the
// real conversion/formatting hooks run unchanged. ──
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
vi.mock('@/api/hooks/useAnalytics', () => ({ useLifetimeStats: vi.fn() }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }));

const mockLifetime = useLifetimeStats as unknown as ReturnType<typeof vi.fn>;
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

function makeStats(over: Partial<LifetimeStats> = {}): LifetimeStats {
  return {
    total_drives: 1234,
    total_distance_km: 50000,
    total_driving_hours: 800,
    longest_drive_km: 500,
    highest_speed_kmh: 180,
    avg_efficiency_wh_km: 160,
    total_charge_sessions: 300,
    total_energy_kwh: 8500.5,
    total_charging_hours: 400,
    total_charging_cost: 456.78,
    gas_equivalent_cost: 3000,
    total_savings: 2500,
    co2_offset_kg: 3200,
    trees_equivalent: 50,
    earth_circumferences: 1.2,
    moon_trips: 0.1,
    days_on_road: 33,
    homes_equivalent_days: 20,
    first_drive_date: '2020-01-01',
    ownership_days: 1000,
    most_active_day_of_week: 'Monday',
    most_active_hour: 8,
    longest_drive_record: { value: 500, date: '2021-06-01' },
    highest_speed_record: { value: 180, date: '2021-07-01' },
    max_charge_record: { value: 75, date: '2021-08-01' },
    achievements: [],
    ...over,
  };
}

function renderWidget(props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LifetimeStatsWidget size={{ cols: 2, rows: 2 }} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  settingsState.unitOfLength = 'km';
  // Deterministic AnimatedNumber: report reduced-motion so the counter lands on
  // its target synchronously instead of tweening across rAF frames.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

  mockLifetime.mockReset();
  mockVehicles.mockReset();
  mockVehicles.mockReturnValue({ data: [{ id: 1 }] });
  mockLifetime.mockReturnValue(makeQuery({ data: makeStats() }));
});

describe('LifetimeStatsWidget — distance conversion (km→metres regression guard)', () => {
  it('renders the true km total, never the doubly-converted magnitude (km pref)', () => {
    settingsState.unitOfLength = 'km';
    mockLifetime.mockReturnValue(makeQuery({ data: makeStats({ total_distance_km: 50000 }) }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    // 50,000 km → metres → km = 50,000 (rendered as plain text by StatCard).
    expect(screen.getByText('Total Distance')).toBeInTheDocument();
    expect(screen.getByText('50,000')).toBeInTheDocument();
    // The old bug (km × 0.621371 ÷ 1000 ≈ 31) must never surface.
    expect(screen.queryByText('31')).not.toBeInTheDocument();
    expect(screen.getAllByText('km').length).toBeGreaterThan(0);
  });

  it('converts the km total to miles for a miles user (not the ~19 mi double bug)', () => {
    settingsState.unitOfLength = 'mi';
    mockLifetime.mockReturnValue(makeQuery({ data: makeStats({ total_distance_km: 50000 }) }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    // 50,000 km = 50,000,000 m ÷ 1609.344 ≈ 31,069 mi.
    expect(screen.getByText('31,069')).toBeInTheDocument();
    expect(screen.getAllByText('mi').length).toBeGreaterThan(0);
    // The old double conversion (~19) must never surface.
    expect(screen.queryByText('19')).not.toBeInTheDocument();
    expect(screen.queryByText('km')).not.toBeInTheDocument();
  });

  it('renders the corrected big number in the compact layout', () => {
    settingsState.unitOfLength = 'km';
    mockLifetime.mockReturnValue(makeQuery({ data: makeStats({ total_distance_km: 50000 }) }));
    renderWidget({ size: { cols: 1, rows: 1 } });

    // Compact big number (AnimatedNumber settles synchronously under reduced motion).
    expect(screen.getByText('50,000')).toBeInTheDocument();
    expect(screen.getByText(/km\s+lifetime/)).toBeInTheDocument();
    // No stat-grid labels in the compact variant.
    expect(screen.queryByText('Total Drives')).not.toBeInTheDocument();
  });
});

describe('LifetimeStatsWidget — layout variants', () => {
  it('shows only the four core stats in the standard (2-col) layout', () => {
    mockLifetime.mockReturnValue(makeQuery({ data: makeStats() }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    // Title + core stats.
    expect(screen.getByRole('heading', { name: 'Lifetime Stats' })).toBeInTheDocument();
    expect(screen.getByText('Total Distance')).toBeInTheDocument();
    expect(screen.getByText('Total Drives')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('Total Energy')).toBeInTheDocument();
    expect(screen.getByText('8,500.5')).toBeInTheDocument();
    expect(screen.getByText('3,200')).toBeInTheDocument();
    // Wide-only stats are absent when not wide.
    expect(screen.queryByText('Total Cost')).not.toBeInTheDocument();
    expect(screen.queryByText('Ownership Days')).not.toBeInTheDocument();
    expect(screen.queryByText('Avg Daily Distance')).not.toBeInTheDocument();
  });

  it('adds cost / ownership / avg-daily in the wide (≥3-col) layout', () => {
    mockLifetime.mockReturnValue(
      makeQuery({ data: makeStats({ total_distance_km: 50000, ownership_days: 1000, total_charging_cost: 456.78 }) }),
    );
    renderWidget({ size: { cols: 4, rows: 2 } });

    expect(screen.getByText('Total Cost')).toBeInTheDocument();
    expect(screen.getByText('$456.78')).toBeInTheDocument();
    expect(screen.getByText('Ownership Days')).toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument();
    expect(screen.getByText('Avg Daily Distance')).toBeInTheDocument();
    // 50,000 km / 1,000 days = 50 km/day → "50.0".
    expect(screen.getByText('50.0')).toBeInTheDocument();
  });

  it('renders no title in the compact layout', () => {
    mockLifetime.mockReturnValue(makeQuery({ data: makeStats() }));
    renderWidget({ size: { cols: 1, rows: 1 } });

    expect(screen.queryByText('Lifetime Stats')).not.toBeInTheDocument();
    expect(screen.queryByText('Total Distance')).not.toBeInTheDocument();
  });
});

describe('LifetimeStatsWidget — null safety', () => {
  it('coalesces missing core fields to 0 (never NaN)', () => {
    mockLifetime.mockReturnValue(
      makeQuery({
        data: makeStats({
          total_distance_km: undefined as unknown as number,
          total_drives: undefined as unknown as number,
          total_energy_kwh: undefined as unknown as number,
          co2_offset_kg: undefined as unknown as number,
        }),
      }),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    // total distance 0 + total drives 0 → at least two "0" readouts.
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
    // total energy 0 → "0.0" (1 decimal).
    expect(screen.getByText('0.0')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('guards avg-daily against a zero ownership window (no divide-by-zero)', () => {
    mockLifetime.mockReturnValue(
      makeQuery({ data: makeStats({ total_distance_km: 50000, ownership_days: 0 }) }),
    );
    renderWidget({ size: { cols: 4, rows: 2 } });

    expect(screen.getByText('Avg Daily Distance')).toBeInTheDocument();
    // Guarded to 0 → "0.0"; never NaN / Infinity.
    expect(screen.getByText('0.0')).toBeInTheDocument();
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
  });
});

describe('LifetimeStatsWidget — loading / empty / error', () => {
  it('shows a skeleton while loading (no content, no empty state)', () => {
    mockLifetime.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    const { container } = renderWidget({ size: { cols: 2, rows: 2 } });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No lifetime data')).not.toBeInTheDocument();
    expect(screen.queryByText('Total Distance')).not.toBeInTheDocument();
  });

  it('shows the empty state (not a blank panel) when no data has arrived', () => {
    mockLifetime.mockReturnValue(makeQuery({ data: undefined }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByText('No lifetime data')).toBeInTheDocument();
    expect(screen.queryByText('Total Distance')).not.toBeInTheDocument();
  });

  it('shows the compact empty state when no data has arrived', () => {
    mockLifetime.mockReturnValue(makeQuery({ data: undefined }));
    renderWidget({ size: { cols: 1, rows: 1 } });

    expect(screen.getByText('No lifetime data')).toBeInTheDocument();
  });

  it('surfaces a real error panel instead of the empty state on initial-load failure', () => {
    mockLifetime.mockReturnValue(
      makeQuery({ data: undefined, isError: true, error: new Error('boom') }),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    // Honest error panel from WidgetShell (QueryError), not "No lifetime data".
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No lifetime data')).not.toBeInTheDocument();
  });

  it('keeps cached stats on screen when a background refetch errors', () => {
    mockLifetime.mockReturnValue(
      makeQuery({ data: makeStats({ total_distance_km: 50000 }), isError: true, error: new Error('boom') }),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    // Data present → the error is a subtle freshness signal, not a full panel.
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    expect(screen.getByText('50,000')).toBeInTheDocument();
  });
});

describe('LifetimeStatsWidget — refresh + vehicle resolution', () => {
  it('refetches lifetime stats when the refresh control is activated', () => {
    const refetch = vi.fn();
    mockLifetime.mockReturnValue(makeQuery({ data: makeStats(), refetch }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('queries lifetime stats for the vehicleId prop (as a string)', () => {
    renderWidget({ vehicleId: 7 });
    expect(mockLifetime).toHaveBeenCalledWith('7');
  });

  it('falls back to the first vehicle id when no vehicleId prop is given', () => {
    mockVehicles.mockReturnValue({ data: [{ id: 42 }] });
    renderWidget();
    expect(mockLifetime).toHaveBeenCalledWith('42');
  });

  it('passes undefined (disabling the query) when no vehicle is available', () => {
    mockVehicles.mockReturnValue({ data: [] });
    renderWidget();
    expect(mockLifetime).toHaveBeenCalledWith(undefined);
  });
});
