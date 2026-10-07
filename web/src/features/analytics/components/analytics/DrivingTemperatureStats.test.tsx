/**
 * DrivingTemperatureStats — behaviour + branch coverage.
 *
 * The panel renders six <MetricCard>s (inside/outside min·avg·max) off a single
 * `useFleetAnalytics()` result threaded down as `query`, converting the backend's
 * SI-Celsius `drive_analytics.temperature` to the user's display unit at the
 * render boundary via the REAL `convertTempFromSI` + `fmtNumber`.
 *
 * Key behaviours asserted:
 *   1. Populated (°C) — all six cards render 1-dp values with the °C subtitle.
 *   2. Imperial (°F) — the real Celsius→Fahrenheit conversion runs (not identity).
 *   3. Partial data — one side present, the other side's cards fall back to "—"
 *      while the panel stays mounted (never gated away).
 *   4. Loading / error+retry — the panel owns its own skeleton / retryable error.
 *   5. Empty (count-aware) — this is the regression fix: the backend always emits
 *      `temperature.{inside,outside}` as a *zeroed* StatsSummary (`count: 0`) even
 *      with no drives, so emptiness must key off the sample count, not object
 *      presence — otherwise the panel showed six misleading "0.0°" cards and the
 *      empty state was unreachable.
 *   6. Null safety — `safe()` guards missing min/avg/max without crashing.
 *
 * Strategy: the component takes data as a prop, so no network is touched — we
 * hand it hand-built `UseQueryResult` shapes. `@/hooks/useUnits` is mocked with a
 * mutable return (mirrors DrivetrainHealthPage.test) so we can flip °C ↔ °F while
 * the real conversion/formatting lib runs. Only `react-i18next` is mocked so
 * `t(key, fallback)` renders the English fallback deterministically. The tree is
 * wrapped in QueryClient + MemoryRouter because <QueryError> reaches for
 * `useNavigate`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { FleetAnalytics, StatsSummary } from '@/api/types';

// jsdom lacks matchMedia; install a benign stub before any shared UI module that
// might read it at import time evaluates (defensive — GlassPanel pulls it in).
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

// Mutable useUnits mock — lets each test choose the display temperature unit
// while the REAL convertTempFromSI + fmtNumber run downstream.
const { unitsMock } = vi.hoisted(() => ({ unitsMock: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => unitsMock() }));

// i18n → return the developer fallback string, interpolating {{vars}} so any
// error/empty copy reads as real English instead of a raw key.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { DrivingTemperatureStats } from './DrivingTemperatureStats';
import type { FleetAnalyticsQuery } from './constants';
import { ApiError } from '@/lib/resilience';

const UNIT_PREFS_C = {
  distance: 'km',
  speed: 'km/h',
  temperature: '°C',
  pressure: 'bar',
  energy: 'kWh',
  duration: 'h',
  power: 'kW',
  locale: 'en-US',
  precision: undefined,
} as const;

/** Build a StatsSummary; `count` is what the empty-detection keys off. */
function stat(min: number, avg: number, max: number, count: number): StatsSummary {
  return { min, max, avg, median: avg, p95: max, count };
}

// Values chosen so the °C output is exact and the °F conversion lands on stable
// 1-dp results (e.g. 18.4°C → 65.1°F, -5.3°C → 22.5°F). Negative outside-min
// exercises sub-zero formatting.
const INSIDE = stat(18.4, 21.7, 25.9, 100);
const OUTSIDE = stat(-5.3, 12.6, 30.1, 80);
const ZEROED = stat(0, 0, 0, 0);

/** Only `drive_analytics.temperature` is read — cast a partial payload. */
function analytics(
  inside: StatsSummary | undefined,
  outside: StatsSummary | undefined,
): FleetAnalytics {
  return {
    drive_analytics: { temperature: { inside, outside } },
  } as unknown as FleetAnalytics;
}

const FULL = analytics(INSIDE, OUTSIDE);

interface QueryOverrides {
  data?: FleetAnalytics;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  refetch?: () => void;
}

function makeQuery(over: QueryOverrides = {}): FleetAnalyticsQuery {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  } as unknown as FleetAnalyticsQuery;
}

function renderPanel(query: FleetAnalyticsQuery) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DrivingTemperatureStats query={query} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const DASH = '\u2014';

beforeEach(() => {
  unitsMock.mockReset();
  unitsMock.mockReturnValue({ unitPrefs: UNIT_PREFS_C });
});

describe('DrivingTemperatureStats — populated (metric °C)', () => {
  it('mounts the panel heading as a level-3 heading', () => {
    renderPanel(makeQuery({ data: FULL }));
    expect(
      screen.getByRole('heading', { level: 3, name: 'Temperature Stats' }),
    ).toBeInTheDocument();
  });

  it('renders all six labelled cards with 1-dp °C values and no "—" fallback', () => {
    renderPanel(makeQuery({ data: FULL }));

    // Labels for every card.
    for (const label of ['Inside Min', 'Inside Avg', 'Inside Max', 'Outside Min', 'Outside Avg', 'Outside Max']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Identity conversion at °C, formatted to a single decimal.
    expect(screen.getByText('18.4')).toBeInTheDocument();
    expect(screen.getByText('21.7')).toBeInTheDocument();
    expect(screen.getByText('25.9')).toBeInTheDocument();
    expect(screen.getByText('-5.3')).toBeInTheDocument();
    expect(screen.getByText('30.1')).toBeInTheDocument();

    // Every card carries the °C unit subtitle; none fell back to the em-dash.
    expect(screen.getAllByText('°C')).toHaveLength(6);
    expect(screen.queryByText(DASH)).toBeNull();
  });
});

describe('DrivingTemperatureStats — imperial (°F) conversion', () => {
  it('runs the real Celsius→Fahrenheit conversion and swaps the unit subtitle', () => {
    unitsMock.mockReturnValue({ unitPrefs: { ...UNIT_PREFS_C, temperature: '°F' } });
    renderPanel(makeQuery({ data: FULL }));

    // 18.4°C → 65.1°F and -5.3°C → 22.5°F prove it is not the °C identity path.
    expect(screen.getByText('65.1')).toBeInTheDocument();
    expect(screen.getByText('22.5')).toBeInTheDocument();
    // 25.9°C → 78.6°F (inside max).
    expect(screen.getByText('78.6')).toBeInTheDocument();

    expect(screen.getAllByText('°F')).toHaveLength(6);
    expect(screen.queryByText('°C')).toBeNull();
    // The raw °C figure must not leak through once converted.
    expect(screen.queryByText('18.4')).toBeNull();
  });
});

describe('DrivingTemperatureStats — partial data', () => {
  it('shows inside values and dashes the outside cards when outside has no samples', () => {
    renderPanel(makeQuery({ data: analytics(INSIDE, ZEROED) }));

    expect(screen.getByText('18.4')).toBeInTheDocument();
    // The three outside cards fall back to "—" (count 0 → no data).
    expect(screen.getAllByText(DASH)).toHaveLength(3);
    // Panel stays mounted, not gated to the empty state.
    expect(
      screen.getByRole('heading', { level: 3, name: 'Temperature Stats' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('No temperature stats')).toBeNull();
  });

  it('shows outside values and dashes the inside cards when inside has no samples', () => {
    renderPanel(makeQuery({ data: analytics(ZEROED, OUTSIDE) }));

    expect(screen.getByText('30.1')).toBeInTheDocument();
    expect(screen.getByText('-5.3')).toBeInTheDocument();
    expect(screen.getAllByText(DASH)).toHaveLength(3);
    expect(screen.queryByText('No temperature stats')).toBeNull();
  });
});

describe('DrivingTemperatureStats — loading', () => {
  it('renders a skeleton under the heading and leaks no values while loading', () => {
    const { container } = renderPanel(makeQuery({ isLoading: true, data: FULL }));

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Temperature Stats' }),
    ).toBeInTheDocument();
    // Data must not bleed through the skeleton.
    expect(screen.queryByText('18.4')).toBeNull();
  });
});

describe('DrivingTemperatureStats — error + retry', () => {
  it('surfaces a retryable server error and wires Retry to refetch', () => {
    const refetch = vi.fn();
    renderPanel(makeQuery({ isError: true, error: new ApiError('temp feed exploded', 500), refetch }));

    expect(screen.getByText('Server error')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
    // No card content renders behind the error.
    expect(screen.queryByText('18.4')).toBeNull();
  });

  it('ignores a stale error object when isError is false (err = isError ? error : undefined)', () => {
    renderPanel(makeQuery({ data: FULL, isError: false, error: new ApiError('stale', 500) }));

    expect(screen.queryByText('Server error')).toBeNull();
    expect(screen.getByText('18.4')).toBeInTheDocument();
  });
});

describe('DrivingTemperatureStats — empty states (count-aware)', () => {
  it('shows the empty state instead of six "0.0" cards when both sides have zero samples', () => {
    renderPanel(makeQuery({ data: analytics(ZEROED, ZEROED) }));

    // Regression guard: zeroed StatsSummary (count 0) is treated as "no data".
    expect(screen.getByText('No temperature stats')).toBeInTheDocument();
    expect(screen.queryByText('0.0')).toBeNull();
    expect(screen.queryByText('Inside Min')).toBeNull();
  });

  it('shows the empty state when the query produced no analytics payload', () => {
    renderPanel(makeQuery({ data: undefined }));

    expect(screen.getByText('No temperature stats')).toBeInTheDocument();
    expect(screen.queryByText('Inside Min')).toBeNull();
  });
});

describe('DrivingTemperatureStats — null safety', () => {
  it('renders zeroed values without crashing when a side has samples but missing stats', () => {
    // count > 0 (has data) but min/avg/max absent — safe() must coerce to 0.
    const malformedInside = { count: 5 } as unknown as StatsSummary;
    renderPanel(makeQuery({ data: analytics(malformedInside, undefined) }));

    // Three inside cards render "0.0" via safe(); heading stays mounted.
    expect(screen.getAllByText('0.0')).toHaveLength(3);
    // Outside is entirely absent → three "—" fallbacks.
    expect(screen.getAllByText(DASH)).toHaveLength(3);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Temperature Stats' }),
    ).toBeInTheDocument();
  });
});
