/**
 * HeroGauges — behaviour + hardening contract.
 *
 * HeroGauges renders the five radial gauges (distance, max speed, duration,
 * consumption, efficiency) at the top of the drive detail page from an
 * already-loaded `DriveDetail` + derived `DriveStats`. It owns no data source,
 * so these tests pin the pure gauge-plumbing behaviour that matters plus the
 * real bugs this elevation fixed:
 *
 *   - km preference → SI metres route through the real `convertDistanceFromSI`
 *     (32 000 m → 32 km), duration is seconds/60, speed + consumption arrive
 *     already display-converted, and each gauge gets its label, unit suffix and
 *     brand colour;
 *   - the max-speed ceiling (the headline bug) → the old code passed
 *     `convertSpeedFromSI(250, unit)` which mis-read 250 as SI m/s and produced
 *     a ~900 km/h ceiling, so every real reading sat as a near-empty sliver.
 *     The gauge now scales its `max` to the reading (value × 1.5, floored),
 *     matching its four sibling gauges;
 *   - mi preference → distance converts to miles, consumption to Wh/mi via the
 *     1.609344 factor, and the speed + efficiency unit suffixes flip to
 *     imperial;
 *   - the efficiency gauge is conditional (rendered only when
 *     `efficiencyPctPer100` is non-null) and now receives the RAW number — the
 *     old `Number(fmtNumber(x))` round-trip silently rounded (and, for a
 *     comma-grouped or comma-decimal locale, NaN'd) the value;
 *   - non-finite hardening → a still-live drive with a NaN `durationS`, or a
 *     partially-written NaN `distanceM`, collapses to 0 with a finite floor max
 *     instead of poisoning the SVG arc (the old `?? 0` never caught NaN);
 *   - a11y → the gauge cluster is exposed as a named `group`, and an all-zero
 *     drive still renders a full band of gauges rather than a blank panel.
 *
 * `RadialGauge` is mocked to capture the exact numeric contract HeroGauges
 * feeds it (value / max / unit / colour) — that is where the logic lives and it
 * is invisible in the rendered SVG. `react-i18next` echoes the English
 * fallback; `useUnits` and `useSettings` are the settings-backed boundary hooks,
 * mocked to drive the km/mi branch. The pure SI converter runs for real. The
 * component exposes no interactive controls, so there is no userEvent surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { HeroGauges } from './HeroGauges';
import { convertSpeedFromSI } from '@/lib/unitConversion';
import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';

/* ── Captured RadialGauge contract, hoisted above the vi.mock factories ────── */
interface GaugeProps {
  value: number;
  max: number;
  label: string;
  unit?: string;
  color?: string;
  size?: number;
}

const rec = vi.hoisted(() => ({
  system: 'km' as 'km' | 'mi',
  gauges: [] as GaugeProps[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: rec.system === 'mi' ? 'mi' : 'km',
      speed: rec.system === 'mi' ? 'mph' : 'km/h',
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

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ isMiles: rec.system === 'mi' }),
}));

// FadeIn wraps the panel in a framer-motion element that reaches for
// matchMedia via useMotionPreference; stub it to a passthrough so the test
// stays focused on HeroGauges' gauge logic.
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// RadialGauge's value/max maths is exactly what HeroGauges is responsible for,
// and `max` never surfaces as visible text — so capture the props it receives.
vi.mock('@/components/charts', () => ({
  RadialGauge: (props: GaugeProps) => {
    rec.gauges.push(props);
    return (
      <div
        data-testid="radial-gauge"
        data-label={props.label}
        data-value={String(props.value)}
        data-max={String(props.max)}
        data-unit={props.unit ?? ''}
        data-color={props.color ?? ''}
      />
    );
  },
}));

/* ── Fixtures (mirror the DriveStatCards suite for parity) ─────────────────── */
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
    maxSpd: 112, // already display-converted (km/h or mph) by useDriveDetailData
    avgSpd: 60,
    minSpd: 0,
    powerMax: 250,
    powerMin: -40,
    avgPower: 30,
    energyWh: 7200,
    regenWh: 900,
    consumptionWhKm: 180,
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

/** Find the captured props for the gauge carrying `label`. */
function gauge(label: string): GaugeProps {
  const g = rec.gauges.find((x) => x.label === label);
  if (!g) throw new Error(`no gauge labelled "${label}" was rendered`);
  return g;
}

beforeEach(() => {
  rec.system = 'km';
  rec.gauges.length = 0;
});

/* ── km preference — full contract ─────────────────────────────────────────── */
describe('HeroGauges — km preference', () => {
  it('renders all five gauges with SI-derived value, headroom max, unit and colour', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats({ efficiencyPctPer100: 12.5 })} />);

    // Five gauges, one per metric.
    expect(screen.getAllByTestId('radial-gauge')).toHaveLength(5);

    // Distance: 32 000 m → 32 km via the REAL converter; value < floor so the
    // ceiling clamps to the 100 floor.
    const distance = gauge('Distance');
    expect(distance.value).toBe(32);
    expect(distance.max).toBe(100);
    expect(distance.unit).toBe('km');
    expect(distance.color).toBe('#00f0ff');

    // Max speed arrives already display-converted (km/h); ceiling scales to it.
    const speed = gauge('Max Speed');
    expect(speed.value).toBe(112);
    expect(speed.max).toBe(168); // max(112 * 1.5, 120)
    expect(speed.unit).toBe('km/h');
    expect(speed.color).toBe('#a855f7');

    // Duration: 2700 s → 45 min.
    const duration = gauge('Duration');
    expect(duration.value).toBe(45);
    expect(duration.max).toBe(67.5); // max(45 * 1.5, 60)
    expect(duration.unit).toBe('min');

    // Consumption: 180 Wh/km, ceiling clamps to the 300 floor.
    const consumption = gauge('Consumption');
    expect(consumption.value).toBe(180);
    expect(consumption.max).toBe(300);
    expect(consumption.unit).toBe('Wh/km');

    // Efficiency: raw 12.5 %/100km against the fixed 30 ceiling.
    const efficiency = gauge('Efficiency');
    expect(efficiency.value).toBe(12.5);
    expect(efficiency.max).toBe(30);
    expect(efficiency.unit).toBe('%/100km');
    expect(efficiency.color).toBe('#10b981');
  });

  it('scales the max-speed ceiling to the reading, not a 900 km/h SI mis-conversion', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats({ maxSpd: 112 })} />);

    const speed = gauge('Max Speed');
    // Regression guard: the old code passed convertSpeedFromSI(250, 'km/h') as
    // the ceiling, treating 250 as SI m/s → 900 km/h, leaving a 12%-full ring.
    expect(convertSpeedFromSI(250, 'km/h')).toBe(900);
    expect(speed.max).not.toBe(900);
    expect(speed.max).toBe(168);
    // The reading now fills a meaningful, legible fraction of the ring.
    expect(speed.value / speed.max).toBeGreaterThan(0.5);
  });

  it('floors the speed ceiling at 120 so a slow crawl still sweeps the ring', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats({ maxSpd: 20 })} />);

    const speed = gauge('Max Speed');
    expect(speed.value).toBe(20);
    expect(speed.max).toBe(120); // max(20 * 1.5, 120) → floor wins
  });
});

/* ── mi preference ─────────────────────────────────────────────────────────── */
describe('HeroGauges — mi preference', () => {
  beforeEach(() => {
    rec.system = 'mi';
  });

  it('converts distance to miles, consumption to Wh/mi, and flips the unit suffixes', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats({ efficiencyPctPer100: 12.5 })} />);

    // 32 000 m / 1609.344 = 19.88 → 20 mi.
    const distance = gauge('Distance');
    expect(distance.value).toBe(20);
    expect(distance.unit).toBe('mi');

    // Speed value is unit-agnostic (already converted upstream); only suffix flips.
    expect(gauge('Max Speed').unit).toBe('mph');

    // Consumption 180 Wh/km × 1.609344 = 289.68 → 290 Wh/mi.
    const consumption = gauge('Consumption');
    expect(consumption.value).toBe(290);
    expect(consumption.unit).toBe('Wh/mi');
    expect(consumption.max).toBeGreaterThan(consumption.value);

    // Efficiency suffix follows the imperial preference.
    expect(gauge('Efficiency').unit).toBe('%/100mi');
  });

  it('keeps the max-speed ceiling scaled (mph), never the 559 mph SI mis-conversion', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats({ maxSpd: 70 })} />);

    const speed = gauge('Max Speed');
    // Old imperial ceiling was convertSpeedFromSI(250, 'mph') ≈ 559.
    expect(speed.max).not.toBeCloseTo(convertSpeedFromSI(250, 'mph'), 1);
    expect(speed.max).toBe(120); // max(70 * 1.5 = 105, 120) → floor wins
  });
});

/* ── Efficiency gauge — conditional branch + raw-value regression ──────────── */
describe('HeroGauges — efficiency gauge', () => {
  it('omits the efficiency gauge when efficiencyPctPer100 is null', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats({ efficiencyPctPer100: null })} />);

    expect(screen.getAllByTestId('radial-gauge')).toHaveLength(4);
    expect(rec.gauges.some((g) => g.label === 'Efficiency')).toBe(false);
  });

  it('passes the raw efficiency number through, not a locale-formatted round-trip', () => {
    // 12.345 distinguishes the fix from the old Number(fmtNumber(x)) round-trip,
    // which rounded to precision-2 → 12.35 (and NaN'd on comma-decimal locales).
    render(<HeroGauges drive={makeDrive()} stats={makeStats({ efficiencyPctPer100: 12.345 })} />);

    const efficiency = gauge('Efficiency');
    expect(efficiency.value).toBe(12.345);
    expect(Number.isNaN(efficiency.value)).toBe(false);
  });

  it('renders a genuine 0 %/100km efficiency reading (not treated as absent)', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats({ efficiencyPctPer100: 0 })} />);

    expect(screen.getAllByTestId('radial-gauge')).toHaveLength(5);
    expect(gauge('Efficiency').value).toBe(0);
  });
});

/* ── Non-finite hardening ──────────────────────────────────────────────────── */
describe('HeroGauges — non-finite hardening', () => {
  it('renders 0 with a finite floor max for a live drive whose durationS is NaN', () => {
    render(<HeroGauges drive={makeDrive({ durationS: Number.NaN })} stats={makeStats()} />);

    const duration = gauge('Duration');
    expect(duration.value).toBe(0);
    expect(duration.max).toBe(60); // max(0 * 1.5, 60) — finite, never NaN
    expect(Number.isFinite(duration.max)).toBe(true);
  });

  it('coerces a NaN distanceM to 0 instead of poisoning the gauge arc', () => {
    render(<HeroGauges drive={makeDrive({ distanceM: Number.NaN })} stats={makeStats()} />);

    const distance = gauge('Distance');
    expect(distance.value).toBe(0);
    expect(distance.max).toBe(100);
    expect(Number.isFinite(distance.value)).toBe(true);
  });

  it('coerces a NaN consumption reading to 0 rather than a NaN ring', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats({ consumptionWhKm: Number.NaN })} />);

    const consumption = gauge('Consumption');
    expect(consumption.value).toBe(0);
    expect(Number.isFinite(consumption.max)).toBe(true);
  });
});

/* ── Accessibility & degenerate data ───────────────────────────────────────── */
describe('HeroGauges — accessibility & degenerate data', () => {
  it('exposes the gauge cluster as a named group', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats()} />);

    expect(screen.getByRole('group', { name: 'Drive summary gauges' })).toBeInTheDocument();
  });

  it('still renders a full band of gauges (never a blank panel) for an all-zero drive', () => {
    render(
      <HeroGauges
        drive={makeDrive({ distanceM: 0, durationS: 0 })}
        stats={makeStats({ maxSpd: 0, consumptionWhKm: 0, efficiencyPctPer100: null })}
      />,
    );

    // Four gauges (efficiency omitted), each pinned to its floor ceiling.
    expect(screen.getAllByTestId('radial-gauge')).toHaveLength(4);
    expect(gauge('Distance').value).toBe(0);
    expect(gauge('Distance').max).toBe(100);
    expect(gauge('Max Speed').max).toBe(120);
    expect(gauge('Duration').max).toBe(60);
    expect(gauge('Consumption').max).toBe(300);
  });
});
