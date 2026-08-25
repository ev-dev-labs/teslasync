/**
 * ChargingSection — behaviour + hardening contract.
 *
 * ChargingSection is the "Charging" panel of the Weekly Digest bento. It fans a
 * pre-aggregated `DigestMetrics` object plus a `DailyEnergyEntry[]` series into
 * four surfaces: a daily-energy bar chart (with its own loading / error / empty
 * states), a four-tile stat row, and a week-over-week energy badge.
 *
 * The elevation this file locks in fixes a real SI-cutover display bug. The
 * `/charging` API delivers energy in **watt-hours** (`total_energy_added_wh`,
 * documented SI-canonical in api/types.ts) and charge rate in **watts**, so the
 * digest's aggregated `chargeEnergyAddedWh` / `avgChargePowerW` / daily-energy bars
 * are all SI magnitudes. The panel previously slapped a raw `" kWh"` / `" kW"`
 * suffix on those numbers (and a "(kWh)" caption on Wh bars) — a silent 1000×
 * overstatement. The source now converts at the render boundary via
 * `useUnits()` (`formatEnergy` / `formatPower` / `convertEnergyFromSI`), and the
 * tests below pin every converted value.
 *
 * Conventions (mirrors GuardModePage / SharedDrivePage in this repo):
 *   - `react-i18next` is stubbed to echo the inline English fallback.
 *   - The jsdom-hostile recharts barrel (`@/components/charts`) is replaced with
 *     inert prop-capturing stubs so the derived chart data is assertable.
 *   - `useSettings` / `useTimezone` come from the global stub in
 *     src/test-setup.ts (currency `$`, precision 2, locale en-US) — so the real
 *     `useUnits` / `useFormatting` run against deterministic prefs.
 *   - The real feedback/ui components render inside a `MemoryRouter`
 *     (QueryError calls `useNavigate`). Interactions use `fireEvent`
 *     (`@testing-library/user-event` is not installed in this repo).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { ChargingSection } from './ChargingSection';
import type { DigestMetrics, DailyEnergyEntry } from './types';

/* ── react-i18next: deterministic English-fallback rendering ─────────────── */
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined;
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined);
        const interpolate = (s: string) =>
          opts
            ? Object.keys(opts).reduce(
                (acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(opts[k])),
                s,
              )
            : s;
        if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue);
        if (fallback != null) return interpolate(fallback);
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

/* ── Inert recharts barrel — capture derived chart data / series props ────── */
const H = vi.hoisted(() => ({
  barChartData: null as Array<Record<string, unknown>> | null,
  barProps: null as Record<string, unknown> | null,
}));

vi.mock('@/components/charts', async () => {
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
  ...chartTestDoubles,
  ChartTooltip: () => null,
  // Distinct sentinel palette so we can prove the Bar reads slot [1].
  CHART_COLORS: ['#c0', '#c1', '#c2', '#c3', '#c4'],
  chartGrid: null,
  axisTickSm: {},
  chartMarginLabeled: {},
  chartAnimation: {},
  BarChart: ({
    data,
    children,
  }: {
    data: Array<Record<string, unknown>>;
    children?: ReactNode;
  }) => {
    H.barChartData = data;
    return (
      <div data-testid="bar-chart" data-count={data?.length ?? 0}>
        {children}
      </div>
    );
  },
  Bar: (props: Record<string, unknown>) => {
    H.barProps = props;
    return (
      <div
        data-testid="bar"
        data-datakey={String(props.dataKey ?? '')}
        data-fill={String(props.fill ?? '')}
      />
    );
  },
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="responsive">{children}</div>
  ),
  };
});

/* ── Fixtures ─────────────────────────────────────────────────────────────── */
function baseMetrics(overrides: Partial<DigestMetrics> = {}): DigestMetrics {
  return {
    totalDistanceM: 0,
    prevDistanceM: 0,
    totalDrives: 0,
    prevDriveCount: 0,
    energyUsedWh: 0,
    prevEnergyWh: 0,
    chargingCost: 0,
    prevChargingCost: 0,
    co2Saved: 0,
    prevCo2: 0,
    avgEfficiencyWhPerM: 0,
    prevAvgEfficiencyWhPerM: 0,
    totalDurationS: 0,
    topDrive: undefined,
    chargeEnergyAddedWh: 0,
    prevChargeEnergyWh: 0,
    avgChargePowerW: 0,
    chargingSessionCount: 0,
    batteryStart: 0,
    batteryEnd: 0,
    alertsByType: {},
    alertTotal: 0,
    ...overrides,
  };
}

// Energy fixtures are in SI watt-hours, exactly as the API/hook deliver them.
const populatedEnergy: DailyEnergyEntry[] = [
  { day: 'Mon', energyWh: 12_000 },
  { day: 'Tue', energyWh: 0 },
  { day: 'Wed', energyWh: 3_000 },
];

const zeroEnergy: DailyEnergyEntry[] = [
  { day: 'Mon', energyWh: 0 },
  { day: 'Tue', energyWh: 0 },
];

interface RenderOverrides {
  metrics?: Partial<DigestMetrics>;
  dailyEnergyData?: DailyEnergyEntry[];
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

function renderSection(over: RenderOverrides = {}) {
  // Use `in` so an explicit `dailyEnergyData: undefined` (the missing-series
  // edge case) is passed through rather than swallowed by a `??` default.
  const dailyEnergyData = (
    'dailyEnergyData' in over ? over.dailyEnergyData : populatedEnergy
  ) as DailyEnergyEntry[];
  return render(
    <MemoryRouter>
      <ChargingSection
        metrics={baseMetrics(over.metrics)}
        dailyEnergyData={dailyEnergyData}
        isLoading={over.isLoading}
        isError={over.isError}
        error={over.error}
        onRetry={over.onRetry}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  H.barChartData = null;
  H.barProps = null;
});

/* ── Chart branch: loading / error / empty / populated ────────────────────── */
describe('ChargingSection — chart branch state machine', () => {
  it('renders the skeleton while loading and suppresses the chart + empty state', () => {
    const { container } = renderSection({ isLoading: true });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByTestId('bar-chart')).toBeNull();
    expect(screen.queryByText(/No charging energy data/i)).toBeNull();
  });

  it('renders a retryable QueryError when isError, and wires the retry callback', () => {
    const onRetry = vi.fn();
    renderSection({
      isError: true,
      error: new Error('charging fetch boom'),
      onRetry,
    });

    // The chart must not render behind the error surface.
    expect(screen.queryByTestId('bar-chart')).toBeNull();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state (not a blank panel) when no day has positive energy', () => {
    renderSection({ dailyEnergyData: zeroEnergy });

    expect(screen.getByText('No charging energy data is available for this week.')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).toBeNull();
  });

  it('renders the empty state when the daily-energy series is missing entirely', () => {
    // Null series must degrade to the empty state, never throw on `.some`.
    renderSection({ dailyEnergyData: undefined as unknown as DailyEnergyEntry[] });

    expect(screen.getByText('No charging energy data is available for this week.')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).toBeNull();
  });
});

/* ── The SI-cutover fix: Wh bars are converted to kWh at the boundary ─────── */
describe('ChargingSection — daily-energy chart converts SI watt-hours to kWh', () => {
  it('feeds the bar chart kWh-scaled values (12000 Wh → 12 kWh)', () => {
    renderSection({ dailyEnergyData: populatedEnergy });

    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(H.barChartData).toEqual([
      { day: 'Mon', energy: 12 },
      { day: 'Tue', energy: 0 },
      { day: 'Wed', energy: 3 },
    ]);
  });

  it('binds the energy series to the second chart colour', () => {
    renderSection({ dailyEnergyData: populatedEnergy });

    expect(H.barProps?.dataKey).toBe('energy');
    expect(H.barProps?.fill).toBe('#c1');
  });

  it('tolerates malformed series rows without crashing (null day/energy)', () => {
    const dirty = [
      { day: 'Mon', energyWh: 5_000 },
      { day: undefined, energyWh: undefined },
    ] as unknown as DailyEnergyEntry[];
    renderSection({ dailyEnergyData: dirty });

    // The truthy first row keeps the chart mounted; the dirty row is coerced.
    expect(H.barChartData).toEqual([
      { day: 'Mon', energy: 5 },
      { day: '', energy: 0 },
    ]);
  });
});

/* ── Stat row: energy/power converted, currency + counts formatted ────────── */
describe('ChargingSection — stat row values', () => {
  it('converts SI energy (Wh) and power (W) into kWh / kW for display', () => {
    renderSection({
      metrics: {
        chargeEnergyAddedWh: 50_000, // 50 kWh
        avgChargePowerW: 7_000, // 7 kW
        chargingCost: 12.5,
        chargingSessionCount: 3,
      },
    });

    expect(screen.getByText('50.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('7.0 kW')).toBeInTheDocument();
    expect(screen.getByText('$12.50')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    // Regression guard: the raw SI magnitude must NOT leak through.
    expect(screen.queryByText('50,000.0 kWh')).toBeNull();
  });

  it('null-safe defaults render zeroed stats rather than NaN / blank tiles', () => {
    renderSection({
      metrics: {
        chargeEnergyAddedWh: undefined as unknown as number,
        avgChargePowerW: undefined as unknown as number,
        chargingCost: undefined as unknown as number,
        chargingSessionCount: undefined as unknown as number,
      },
      dailyEnergyData: zeroEnergy,
    });

    expect(screen.getByText('0.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('0.0 kW')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    // The "Sessions" tile falls back to fmtInt(0) → "0".
    expect(screen.getByText('Total Energy Added')).toBeInTheDocument();
  });

  it('always renders every stat label + the section title', () => {
    renderSection();

    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('Total Energy Added')).toBeInTheDocument();
    expect(screen.getByText('Avg Charge Rate')).toBeInTheDocument();
    expect(screen.getByText('Total Cost')).toBeInTheDocument();
  });
});

/* ── Week-over-week energy badge ──────────────────────────────────────────── */
describe('ChargingSection — energy-vs-last-week badge', () => {
  it('is a success badge with a signed-free percentage when energy is up', () => {
    renderSection({
      metrics: { chargeEnergyAddedWh: 60_000, prevChargeEnergyWh: 50_000 },
    });

    const badge = screen.getByText('20.0%');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('green');
    expect(badge.className).not.toContain('yellow');
  });

  it('is a warning badge with a negative percentage when energy is down', () => {
    renderSection({
      metrics: { chargeEnergyAddedWh: 40_000, prevChargeEnergyWh: 50_000 },
    });

    const badge = screen.getByText('-20.0%');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('yellow');
  });

  it('falls back to an em-dash when there is no prior-week baseline', () => {
    renderSection({
      metrics: { chargeEnergyAddedWh: 50_000, prevChargeEnergyWh: 0 },
    });

    // No prior baseline → no misleading "Infinity%" — just the placeholder.
    const badge = screen.getByText('—');
    expect(badge).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
  });
});

/* ── Structure / a11y ─────────────────────────────────────────────────────── */
describe('ChargingSection — structure', () => {
  it('marks the leading section icon as decorative (aria-hidden)', () => {
    const { container } = renderSection();
    const title = screen.getByText('Charging');
    const icon = title.querySelector('svg');

    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    // The panel always renders its caption regardless of data state.
    expect(container.textContent).toContain('Daily Energy Added (kWh)');
  });
});
