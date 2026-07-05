/**
 * DriveStatCards — behaviour + hardening contract.
 *
 * DriveStatCards renders the 8-to-10 tile stat band at the top of the drive
 * detail page from an already-loaded `DriveDetail` + derived `DriveStats`. It
 * owns no data source of its own, so these tests pin the pure display
 * behaviour that matters and the null-safety hardening this file added:
 *
 *   - km preference → SI meters render through the real `convertDistanceFromSI`
 *     (32 000 m stays 32.0 km), duration formats via the real `formatDuration`,
 *     speeds carry the km/h suffix, and max-power reads through the real
 *     `fmtWithUnit`;
 *   - mi preference → distance converts to miles and the speed suffix + the
 *     "Cost / {unit}" label both switch to the imperial unit;
 *   - SOC null-safety (the real bug this elevation fixed) → a missing
 *     start/end battery reading renders the neutral "—" placeholder instead of
 *     a fabricated "0%" that would read as a fully-drained pack;
 *   - the two cost tiles are conditional: both appear only when there is energy
 *     AND distance, only Trip Cost when distance is 0, and neither when there is
 *     no energy (so the currency formatters are never even invoked);
 *   - a null cost-per-distance result clamps to 0 rather than crashing the
 *     currency formatter;
 *   - a non-finite `durationS` (a live/partial drive) renders "0m", never
 *     "NaNm".
 *
 * `react-i18next` is mocked to echo the English fallback (mirrors the
 * SummaryStats / HeroGauges convention). `useUnits` and `useFormatting` are the
 * settings-backed boundary hooks, so they're mocked to drive the km/mi branch
 * and to assert the currency-format calls — the pure SI converter and number
 * formatters run for real. `AnimatedNumber` is stubbed to its final settled
 * value (via the real `fmtNumber`) so assertions don't race the rAF tween. The
 * component exposes no interactive controls, so there is no userEvent surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DriveStatCards } from './DriveStatCards';
import { fmtWithUnit } from '@/lib/numberFormat';
import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';

/* ── Controllable mock state, hoisted above the vi.mock factories ─────────── */
const h = vi.hoisted(() => ({ system: 'km' as 'km' | 'mi' }));

const fmt = vi.hoisted(() => ({
  formatEnergyCost: vi.fn((kwh: number) => `$${(kwh * 0.1).toFixed(2)}`),
  formatCurrency: vi.fn((amount: number, decimals?: number) => `$${amount.toFixed(decimals ?? 2)}`),
  costPerDistanceUnit: vi.fn((_kwh: number, _distanceM: number): number | null => 0.25),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: unknown) => {
      if (typeof opts === 'string') return opts;
      if (opts && typeof opts === 'object') {
        const o = opts as Record<string, unknown>;
        const base = typeof o.defaultValue === 'string' ? o.defaultValue : key;
        return base.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(o[k] ?? ''));
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: h.system === 'mi' ? 'mi' : 'km',
      speed: h.system === 'mi' ? 'mph' : 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: 2,
    },
  }),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => fmt,
}));

// Settle AnimatedNumber to its final value synchronously — the rAF-driven
// count-up is AnimatedNumber's own concern; here we assert the value + suffix
// DriveStatCards feeds it, rendered through the real `fmtNumber`.
vi.mock('@/components/data-display', async () => {
  const { fmtNumber } = await vi.importActual<typeof import('@/lib/numberFormat')>(
    '@/lib/numberFormat',
  );
  return {
    AnimatedNumber: ({
      value,
      decimals = 0,
      prefix = '',
      suffix = '',
    }: {
      value: number;
      decimals?: number;
      prefix?: string;
      suffix?: string;
    }) => <span>{`${prefix}${fmtNumber(value, decimals)}${suffix}`}</span>,
  };
});

/* ── Unicode glyphs the component renders (escaped to avoid encoding drift) ─ */
const DASH = '\u2014'; // —
const ARROW = '\u2192'; // →
const UP = '\u2191'; // ↑
const DOWN = '\u2193'; // ↓

/* ── Fixtures ─────────────────────────────────────────────────────────────── */
function makeDrive(overrides: Partial<DriveDetail> = {}): DriveDetail {
  return {
    id: 42,
    vehicleId: 1,
    startTs: '2025-03-01T10:00:00Z',
    endTs: '2025-03-01T10:45:00Z',
    durationS: 2700, // 45 min
    distanceM: 32000, // 32.0 km / 19.9 mi
    startAddress: 'A',
    endAddress: 'B',
    startLat: 47.6,
    startLon: -122.3,
    endLat: 47.44,
    endLon: -122.3,
    startBatteryPct: 82,
    endBatteryPct: 68,
    energyUsedWh: 7200,
    regenEnergyWh: 900,
    avgSpeedMps: 20,
    maxSpeedMps: 31,
    avgPowerW: 15000,
    outsideTempAvgC: 14,
    insideTempAvgC: 21,
    score: 88,
    endedStatus: 'parked',
    createdAt: '2025-03-01T10:45:05Z',
    updatedAt: '2025-03-01T10:45:05Z',
    positions: [],
    telemetry: [],
    ...overrides,
  };
}

function makeStats(overrides: Partial<DriveStats> = {}): DriveStats {
  return {
    maxSpd: 95,
    avgSpd: 60,
    minSpd: 0,
    powerMax: 250,
    powerMin: -40,
    avgPower: 30,
    energyWh: 7200,
    regenWh: 900,
    consumptionWhKm: 225,
    elevGain: 120,
    elevLoss: 85,
    avgOutsideTemp: 14,
    avgInsideTemp: 21,
    hasAnyTemp: true,
    insideTemps: [],
    outsideTemps: [],
    driverTemps: [],
    passengerTemps: [],
    climateStatus: null,
    avgFanSpeed: null,
    maxFanSpeed: null,
    startRange: 300,
    endRange: 250,
    odometerStart: 10000,
    odometerEnd: 10032,
    hasTirePressure: false,
    efficiencyPctPer100: null,
    ...overrides,
  };
}

beforeEach(() => {
  h.system = 'km';
  fmt.formatEnergyCost.mockClear();
  fmt.formatCurrency.mockClear();
  fmt.costPerDistanceUnit.mockClear();
});

/* ── Core render — metric (km) preference ─────────────────────────────────── */
describe('DriveStatCards — km preference', () => {
  it('renders every core tile with SI-converted values and its label', () => {
    render(<DriveStatCards drive={makeDrive()} stats={makeStats()} />);

    // Distance: 32 000 m → 32.0 km via the REAL converter.
    expect(screen.getByText('32.0 km')).toBeInTheDocument();
    // Duration: 2700 s → 45 min via the REAL formatDuration.
    expect(screen.getByText('45m')).toBeInTheDocument();
    // Speeds carry the metric suffix.
    expect(screen.getByText('95 km/h')).toBeInTheDocument();
    expect(screen.getByText('60 km/h')).toBeInTheDocument();
    // SOC start → end.
    expect(screen.getByText(`82% ${ARROW} 68%`)).toBeInTheDocument();
    // Max power through the REAL fmtWithUnit.
    expect(screen.getByText(fmtWithUnit(250, 'kW'))).toBeInTheDocument();
    // Elevation gain / loss rounded with directional arrows.
    expect(screen.getByText(`120 m ${UP}`)).toBeInTheDocument();
    expect(screen.getByText(`85 m ${DOWN}`)).toBeInTheDocument();

    // Every stat label is present as accessible text.
    for (const label of ['Distance', 'Duration', 'Max Speed', 'Avg Speed', 'SOC', 'Max Power', 'Elev. Gain', 'Elev. Loss']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('rounds elevation to whole metres before display', () => {
    render(<DriveStatCards drive={makeDrive()} stats={makeStats({ elevGain: 119.7, elevLoss: 84.2 })} />);
    expect(screen.getByText(`120 m ${UP}`)).toBeInTheDocument();
    expect(screen.getByText(`84 m ${DOWN}`)).toBeInTheDocument();
  });

  it('formats a multi-hour duration as "1h 30m"', () => {
    render(<DriveStatCards drive={makeDrive({ durationS: 5400 })} stats={makeStats()} />);
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });
});

/* ── Imperial (mi) preference ─────────────────────────────────────────────── */
describe('DriveStatCards — mi preference', () => {
  beforeEach(() => {
    h.system = 'mi';
  });

  it('converts distance to miles and switches the speed + cost units', () => {
    render(<DriveStatCards drive={makeDrive()} stats={makeStats()} />);

    // 32 000 m / 1609.344 = 19.884 → 19.9 mi.
    expect(screen.getByText('19.9 mi')).toBeInTheDocument();
    expect(screen.getByText('95 mph')).toBeInTheDocument();
    expect(screen.getByText('60 mph')).toBeInTheDocument();
    // The interpolated cost label follows the display unit.
    expect(screen.getByText('Cost / mi')).toBeInTheDocument();
    expect(screen.queryByText('Cost / km')).not.toBeInTheDocument();
  });
});

/* ── SOC null-safety — the real bug this elevation fixed ───────────────────── */
describe('DriveStatCards — SOC null safety', () => {
  it('renders "—" placeholders instead of a fabricated "0%" when SOC is unknown', () => {
    render(
      <DriveStatCards
        drive={makeDrive({ startBatteryPct: null, endBatteryPct: null })}
        stats={makeStats()}
      />,
    );

    expect(screen.getByText(`${DASH} ${ARROW} ${DASH}`)).toBeInTheDocument();
    // Regression guard: the old `fmtInt(null)` coerced null → "0".
    expect(screen.queryByText(`0% ${ARROW} 0%`)).not.toBeInTheDocument();
  });

  it('shows a placeholder only for the missing side of a partial reading', () => {
    render(
      <DriveStatCards
        drive={makeDrive({ startBatteryPct: 82, endBatteryPct: null })}
        stats={makeStats()}
      />,
    );
    expect(screen.getByText(`82% ${ARROW} ${DASH}`)).toBeInTheDocument();
  });

  it('still renders a genuine 0% reading as "0%", not a placeholder', () => {
    render(
      <DriveStatCards
        drive={makeDrive({ startBatteryPct: 5, endBatteryPct: 0 })}
        stats={makeStats()}
      />,
    );
    expect(screen.getByText(`5% ${ARROW} 0%`)).toBeInTheDocument();
  });
});

/* ── Conditional cost tiles ───────────────────────────────────────────────── */
describe('DriveStatCards — cost tiles', () => {
  it('shows both cost tiles and feeds the formatters when energy + distance exist', () => {
    render(<DriveStatCards drive={makeDrive()} stats={makeStats({ energyWh: 7200 })} />);

    expect(screen.getByText('Trip Cost')).toBeInTheDocument();
    expect(screen.getByText('Cost / km')).toBeInTheDocument();

    // 7200 Wh → 7.2 kWh reaches the energy-cost formatter.
    expect(fmt.formatEnergyCost).toHaveBeenCalledWith(7.2);
    // Cost-per-distance reads SI metres, not display units.
    expect(fmt.costPerDistanceUnit).toHaveBeenCalledWith(7.2, 32000);
    // The per-unit tile renders at 3-dp currency precision.
    expect(fmt.formatCurrency).toHaveBeenCalledWith(0.25, 3);
    expect(screen.getByText('$0.250')).toBeInTheDocument();
    expect(screen.getByText('$0.72')).toBeInTheDocument();
  });

  it('hides BOTH cost tiles and never calls the cost formatters when energy is 0', () => {
    render(<DriveStatCards drive={makeDrive()} stats={makeStats({ energyWh: 0 })} />);

    expect(screen.queryByText('Trip Cost')).not.toBeInTheDocument();
    expect(screen.queryByText('Cost / km')).not.toBeInTheDocument();
    expect(fmt.formatEnergyCost).not.toHaveBeenCalled();
    expect(fmt.costPerDistanceUnit).not.toHaveBeenCalled();
  });

  it('shows only Trip Cost (not the per-distance tile) when distance is 0', () => {
    render(<DriveStatCards drive={makeDrive({ distanceM: 0 })} stats={makeStats({ energyWh: 7200 })} />);

    expect(screen.getByText('Trip Cost')).toBeInTheDocument();
    expect(screen.queryByText('Cost / km')).not.toBeInTheDocument();
    expect(fmt.formatEnergyCost).toHaveBeenCalledWith(7.2);
    expect(fmt.costPerDistanceUnit).not.toHaveBeenCalled();
  });

  it('clamps a null cost-per-distance result to 0 before formatting', () => {
    fmt.costPerDistanceUnit.mockReturnValueOnce(null);
    render(<DriveStatCards drive={makeDrive()} stats={makeStats({ energyWh: 7200 })} />);

    expect(fmt.formatCurrency).toHaveBeenCalledWith(0, 3);
    expect(screen.getByText('$0.000')).toBeInTheDocument();
  });
});

/* ── Duration hardening ───────────────────────────────────────────────────── */
describe('DriveStatCards — duration hardening', () => {
  it('renders "0m" (never "NaNm") for a non-finite durationS', () => {
    const { container } = render(
      <DriveStatCards drive={makeDrive({ durationS: Number.NaN })} stats={makeStats()} />,
    );
    expect(screen.getByText('0m')).toBeInTheDocument();
    expect(container.textContent).not.toContain('NaN');
  });
});
