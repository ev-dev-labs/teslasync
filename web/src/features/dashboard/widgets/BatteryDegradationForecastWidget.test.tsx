/**
 * BatteryDegradationForecastWidget — behaviour + hardening tests.
 *
 * The widget is a dashboard tile that reads the battery-degradation forecast
 * (`useBatteryDegradation`) for the active vehicle (`vehicleId` prop, else the
 * first vehicle from `useVehicles`) and renders one of two layouts inside
 * `WidgetShell`: a compact 1-col health%/tier badge, or a standard multi-row
 * panel with a projected-80% hero, a current-health stat, a risk-factor list,
 * and a recommendations tip stack. The shell owns loading / error / freshness.
 *
 * Both data hooks are mocked at their module boundaries so every orchestration
 * branch is exercised deterministically and the network is never touched.
 * `react-i18next` is echo-mocked (returns the English fallback, interpolating
 * `{{var}}`); `useSettings` / `useTimezone` come from the global stub in
 * src/test-setup.ts (locale en-US, tz UTC).
 *
 * Facets covered:
 *   - pure helpers: healthTier tiers + boundaries, scoreToImpact thresholds,
 *     riskIcon name→icon mapping incl. null-safety, formatProjectedMonth
 *     valid/invalid/empty date + invalid-locale fallback.
 *   - shell states: loading skeleton, QueryError on failure (the wired `error`
 *     prop — regression guard), explicit empty state (never a blank panel).
 *   - vehicle-id resolution: prop wins → first-vehicle fallback → null.
 *   - populated standard layout: projected date, current-health stat, tier
 *     badge, per-month rate, risk-factor rows, recommendation tips.
 *   - compact layout: health% + tier badge, title suppressed.
 *   - null-safety / hardening: an invalid projected date renders "—" (no
 *     RangeError crash); a payload with only risk factors / only
 *     recommendations still surfaces instead of the empty state; a risk factor
 *     with missing label/detail falls back to "—".
 *   - refresh wiring: the header freshness control invokes the query refetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n echo mock: returns the fallback string (or key when none), interpolating
// {{var}} tokens from the options object so assertions target rendered English.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fb?: unknown, opts?: unknown) => {
      const options = (opts && typeof opts === 'object' ? opts : undefined) as
        | Record<string, unknown>
        | undefined;
      let base = typeof fb === 'string' ? fb : key;
      if (options) {
        base = base.replace(/{{\s*(\w+)\s*}}/g, (_m, n: string) =>
          n in options && options[n] != null ? String(options[n]) : `{{${n}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/api/hooks/useEnergy', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useEnergy')>();
  return { ...actual, useBatteryDegradation: vi.fn() };
});

vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicles: vi.fn() };
});

// jsdom lacks matchMedia; useMotionPreference (via <DataFreshness>) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import { Thermometer, Zap, Battery, AlertTriangle } from 'lucide-react';
import BatteryDegradationForecastWidget, {
  riskIcon,
  healthTier,
  scoreToImpact,
  formatProjectedMonth,
} from './BatteryDegradationForecastWidget';
import { useBatteryDegradation } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import type { DegradationData } from '@/types/energy';
import type { WidgetProps, WidgetSize } from './types';

const mockDegradation = vi.mocked(useBatteryDegradation);
const mockVehicles = vi.mocked(useVehicles);

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): never {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  } as never;
}

function makeData(over: Partial<DegradationData> = {}): DegradationData {
  return {
    current_health: 0,
    current_capacity: 0,
    current_cycles: 0,
    current_range: 0,
    current_temp: 0,
    stress_level: 'Low',
    fast_charge_ratio: 0,
    snapshots: [],
    monthly_trend: [],
    prediction: null,
    charging_habits: null,
    current_health_pct: 92,
    degradation_rate_pct_per_month: 0.08,
    projected_80pct_date: '2027-03-15',
    projections: [],
    risk_factors: [
      { name: 'High Temperature', score: 8, label: 'High Temperature', detail: 'Frequent heat exposure' },
      { name: 'DC Fast Charging', score: 5, label: 'Fast Charging', detail: 'High DC usage' },
    ],
    recommendations: ['Charge to 80% for daily use', 'Avoid frequent DC fast charging'],
    ...over,
  };
}

const COMPACT: WidgetSize = { cols: 1, rows: 2 };
const STANDARD: WidgetSize = { cols: 2, rows: 4 };

function renderWidget(size: WidgetSize, props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BatteryDegradationForecastWidget size={size} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockVehicles.mockReturnValue(qr({ data: [{ id: 1 }] }));
  mockDegradation.mockReturnValue(qr({ data: makeData() }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('healthTier', () => {
  it('classifies rate into healthy / normal / accelerated tiers', () => {
    expect(healthTier(0.02)).toEqual({ label: 'Healthy', variant: 'success', key: 'healthy' });
    expect(healthTier(0.1)).toEqual({ label: 'Normal', variant: 'warning', key: 'normal' });
    expect(healthTier(0.5)).toEqual({ label: 'Accelerated', variant: 'danger', key: 'accelerated' });
  });

  it('treats the tier boundaries as inclusive of the lower tier', () => {
    expect(healthTier(0.05).key).toBe('healthy');
    expect(healthTier(0.12).key).toBe('normal');
    expect(healthTier(0.1201).key).toBe('accelerated');
  });
});

describe('scoreToImpact', () => {
  it('maps scores to high / medium / low at the 7 and 4 thresholds', () => {
    expect(scoreToImpact(9)).toBe('high');
    expect(scoreToImpact(7)).toBe('high');
    expect(scoreToImpact(6)).toBe('medium');
    expect(scoreToImpact(4)).toBe('medium');
    expect(scoreToImpact(3)).toBe('low');
    expect(scoreToImpact(0)).toBe('low');
  });
});

describe('riskIcon', () => {
  it('maps a factor name to the matching lucide icon by keyword', () => {
    expect(riskIcon('High Temperature').type).toBe(Thermometer);
    expect(riskIcon('Thermal stress').type).toBe(Thermometer);
    expect(riskIcon('DC Fast Charging').type).toBe(Zap);
    expect(riskIcon('Battery wear').type).toBe(Battery);
  });

  it('falls back to the warning icon and never throws on a missing name', () => {
    expect(riskIcon('Some unknown factor').type).toBe(AlertTriangle);
    expect(riskIcon(undefined).type).toBe(AlertTriangle);
    expect(riskIcon(null).type).toBe(AlertTriangle);
  });
});

describe('formatProjectedMonth', () => {
  it('formats a valid ISO date as a localized month + year', () => {
    const expected = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short' }).format(
      new Date('2027-03-15'),
    );
    expect(formatProjectedMonth('2027-03-15', 'en-US')).toBe(expected);
    expect(formatProjectedMonth('2027-03-15', 'en-US')).toContain('2027');
  });

  it('returns an em dash for missing / empty / unparseable dates (no crash)', () => {
    expect(formatProjectedMonth(null, 'en-US')).toBe('—');
    expect(formatProjectedMonth(undefined, 'en-US')).toBe('—');
    expect(formatProjectedMonth('', 'en-US')).toBe('—');
    expect(formatProjectedMonth('not-a-date', 'en-US')).toBe('—');
  });

  it('falls back to en-US when handed an invalid locale tag', () => {
    const expected = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short' }).format(
      new Date('2027-03-15'),
    );
    expect(formatProjectedMonth('2027-03-15', 'not-a-locale')).toBe(expected);
  });
});

describe('BatteryDegradationForecastWidget — shell states', () => {
  it('shows a skeleton (never a blank panel) and no content while loading', () => {
    mockDegradation.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Projected 80% Capacity')).toBeNull();
    expect(screen.queryByText('No degradation forecast data')).toBeNull();
  });

  it('renders a QueryError (not an empty state) when the fetch fails', () => {
    mockDegradation.mockReturnValue(
      qr({ isError: true, error: new Error('degradation down'), data: undefined }),
    );
    renderWidget(STANDARD);

    // The wired `error` prop drives the shell's QueryError — regression guard
    // for the previous behaviour where a failure looked identical to "no data".
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No degradation forecast data')).toBeNull();
  });

  it('renders an explicit empty state when the query resolves to no data', () => {
    mockDegradation.mockReturnValue(qr({ data: undefined }));
    renderWidget(STANDARD);

    expect(screen.getByText('No degradation forecast data')).toBeInTheDocument();
    expect(screen.queryByText('Projected 80% Capacity')).toBeNull();
  });
});

describe('BatteryDegradationForecastWidget — vehicle id resolution', () => {
  it('prefers the explicit vehicleId prop when provided', () => {
    mockVehicles.mockReturnValue(qr({ data: [{ id: 7 }] }));
    renderWidget(STANDARD, { vehicleId: 3 });

    expect(mockDegradation).toHaveBeenCalledWith('3');
  });

  it('falls back to the first vehicle id when no prop is given', () => {
    mockVehicles.mockReturnValue(qr({ data: [{ id: 7 }] }));
    renderWidget(STANDARD);

    expect(mockDegradation).toHaveBeenCalledWith('7');
  });

  it('passes null when there is neither a prop nor any vehicle', () => {
    mockVehicles.mockReturnValue(qr({ data: undefined }));
    renderWidget(STANDARD);

    expect(mockDegradation).toHaveBeenCalledWith(null);
  });
});

describe('BatteryDegradationForecastWidget — populated standard layout', () => {
  it('renders the projected-80% hero, current-health stat, and per-month rate', () => {
    const { container } = renderWidget(STANDARD);
    const expectedDate = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
    }).format(new Date('2027-03-15'));

    expect(screen.getByText('Projected 80% Capacity')).toBeInTheDocument();
    expect(screen.getByText(expectedDate)).toBeInTheDocument();
    expect(screen.getByText('Current Health')).toBeInTheDocument();
    expect(screen.getByText('92.0%')).toBeInTheDocument();
    // rate 0.08 → "Normal" tier and a "0.08%/mo" delta.
    expect(screen.getByText('Normal')).toBeInTheDocument();
    expect(container.textContent).toContain('0.08%/');
  });

  it('lists each risk factor with its label, detail, and score', () => {
    renderWidget(STANDARD);

    expect(screen.getByText('Risk Factors')).toBeInTheDocument();
    expect(screen.getByText('High Temperature')).toBeInTheDocument();
    expect(screen.getByText('Frequent heat exposure')).toBeInTheDocument();
    expect(screen.getByText('Fast Charging')).toBeInTheDocument();
    expect(screen.getByText('High DC usage')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders each recommendation as a tip card', () => {
    renderWidget(STANDARD);

    expect(screen.getByText('Recommendations')).toBeInTheDocument();
    expect(screen.getByText('Charge to 80% for daily use')).toBeInTheDocument();
    expect(screen.getByText('Avoid frequent DC fast charging')).toBeInTheDocument();
  });

  it('caps the risk-factor list at five rows', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      name: `Factor ${i}`,
      score: i,
      label: `Factor ${i}`,
      detail: `Detail ${i}`,
    }));
    mockDegradation.mockReturnValue(qr({ data: makeData({ risk_factors: many }) }));
    renderWidget(STANDARD);

    expect(screen.getByText('Factor 0')).toBeInTheDocument();
    expect(screen.getByText('Factor 4')).toBeInTheDocument();
    expect(screen.queryByText('Factor 5')).toBeNull();
  });
});

describe('BatteryDegradationForecastWidget — compact layout', () => {
  it('shows the health% and tier badge without a title', () => {
    renderWidget(COMPACT);

    expect(screen.getByText('92.0%')).toBeInTheDocument();
    expect(screen.getByText('Normal')).toBeInTheDocument();
    // Compact tiles suppress the shell title and the standard-only hero.
    expect(screen.queryByText('Battery Forecast')).toBeNull();
    expect(screen.queryByText('Projected 80% Capacity')).toBeNull();
  });

  it('renders an em dash when the health reading is absent', () => {
    mockDegradation.mockReturnValue(
      qr({
        data: makeData({
          current_health_pct: null as unknown as number,
          current_health: null as unknown as number,
        }),
      }),
    );
    renderWidget(COMPACT);

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('BatteryDegradationForecastWidget — hardening & null-safety', () => {
  it('renders "—" for the projected date instead of crashing on a bad value', () => {
    mockDegradation.mockReturnValue(
      qr({ data: makeData({ projected_80pct_date: 'not-a-real-date' }) }),
    );
    renderWidget(STANDARD);

    // The hero still renders (no RangeError bubbling out of the widget).
    expect(screen.getByText('Projected 80% Capacity')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('surfaces a risk-factors-only payload instead of the empty state', () => {
    mockDegradation.mockReturnValue(
      qr({
        data: makeData({
          current_health_pct: null as unknown as number,
          current_health: null as unknown as number,
          projected_80pct_date: null,
          recommendations: [],
        }),
      }),
    );
    renderWidget(STANDARD);

    expect(screen.getByText('High Temperature')).toBeInTheDocument();
    expect(screen.queryByText('No degradation forecast data')).toBeNull();
  });

  it('surfaces a recommendations-only payload instead of the empty state', () => {
    mockDegradation.mockReturnValue(
      qr({
        data: makeData({
          current_health_pct: null as unknown as number,
          current_health: null as unknown as number,
          projected_80pct_date: null,
          risk_factors: [],
          recommendations: ['Keep it plugged in overnight'],
        }),
      }),
    );
    renderWidget(STANDARD);

    expect(screen.getByText('Keep it plugged in overnight')).toBeInTheDocument();
    expect(screen.queryByText('No degradation forecast data')).toBeNull();
  });

  it('falls back to "—" for a risk factor with no label or detail', () => {
    mockDegradation.mockReturnValue(
      qr({
        data: makeData({
          current_health_pct: null as unknown as number,
          current_health: null as unknown as number,
          projected_80pct_date: null,
          recommendations: [],
          risk_factors: [
            {
              name: undefined as unknown as string,
              score: undefined as unknown as number,
              label: undefined as unknown as string,
              detail: undefined as unknown as string,
            },
          ],
        }),
      }),
    );
    const { container } = renderWidget(STANDARD);

    // Row renders (no throw) and the score defaults to 0 via fmtNumber.
    expect(screen.getByText('Risk Factors')).toBeInTheDocument();
    expect(container.textContent).toContain('—');
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});

describe('BatteryDegradationForecastWidget — refresh wiring', () => {
  it('invokes the query refetch when the freshness control is activated', () => {
    const refetch = vi.fn();
    mockDegradation.mockReturnValue(qr({ data: makeData(), refetch }));
    renderWidget(STANDARD);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
