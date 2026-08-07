/**
 * HeroGauges — behaviour + hardening contract.
 *
 * HeroGauges renders the headline readings (distance, max speed, duration,
 * consumption, efficiency) at the top of the drive detail page from an
 * already-loaded `DriveDetail` + derived `DriveStats`, plus the reader's own
 * fleet baselines from `useDrivingStats`.
 *
 * These tests pin the numeric plumbing that matters plus the real defects this
 * elevation fixed:
 *
 *   - THE HEADLINE FIX — the readings used to be radial gauges whose ceiling
 *     was derived from the reading itself (`max={value * 1.5}`), which pins
 *     every arc at a constant 66.7% no matter what the value is. A 5 km errand
 *     and a 500 km road trip drew an identical ring, so the gauge was incapable
 *     of conveying anything. Section A asserts that two very different drives
 *     now produce visibly different output;
 *   - baselines are real, not invented — per-drive means come from
 *     `totalDistanceKm / totalDrives`, max speed is compared against the
 *     reader's `topSpeedKmh` record, and consumption against
 *     `avgEfficiencyWhKm`. A zero drive count must not divide by zero;
 *   - km preference → SI metres route through the real `convertDistanceFromSI`
 *     (32 000 m → 32.0 km), duration is seconds/60, speed and consumption
 *     arrive already display-converted;
 *   - mi preference → distance converts to miles, consumption to Wh/mi via the
 *     1.609344 factor, and the unit suffixes flip to imperial — including the
 *     BASELINES, which the API always reports in metric and which would
 *     otherwise be compared against an imperial reading;
 *   - the efficiency reading is conditional (rendered only when
 *     `efficiencyPctPer100` is non-null) and receives the raw number;
 *   - non-finite hardening → a still-live drive with a NaN `durationS`, or a
 *     partially-written NaN `distanceM`, collapses to 0 rather than rendering
 *     "NaN" to the reader;
 *   - a11y → the cluster is exposed as a named `group`, and an all-zero drive
 *     still renders a full band of readings rather than a blank panel.
 *
 * `Delta` is mocked to capture the exact comparison contract HeroGauges feeds
 * it (current / previous / direction), which is where the baseline logic lives
 * and is otherwise invisible in the rendered text. `react-i18next` echoes the
 * English fallback; `useUnits`, `useSettings` and `useDrivingStats` are the
 * data/settings boundaries. The pure SI converters run for real. The component
 * exposes no interactive controls, so there is no userEvent surface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

import { HeroGauges } from './HeroGauges';
import type { DriveDetail, DrivingStats } from '@/types/driving';
import type { DriveStats } from './types';

/* ── Captured Delta contract, hoisted above the vi.mock factories ──────────── */
interface DeltaCall {
  current: number | null | undefined;
  previous: number | null | undefined;
  direction: string;
  comparedTo?: string;
}

const rec = vi.hoisted(() => ({
  system: 'km' as 'km' | 'mi',
  fleet: undefined as DrivingStats | undefined,
  deltas: [] as DeltaCall[],
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

vi.mock('@/api/hooks/useDriving', () => ({
  useDrivingStats: () => ({ data: rec.fleet }),
}));

// FadeIn wraps the panel in a framer-motion element that reaches for
// matchMedia via useMotionPreference; stub it to a passthrough so the test
// stays focused on HeroGauges' own logic.
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// The baseline maths is exactly what HeroGauges is responsible for, and
// `previous` never surfaces verbatim as visible text — so capture it.
vi.mock('@/components/data-display', () => ({
  Delta: (props: {
    current: number | null | undefined;
    previous: number | null | undefined;
    metric: { direction: string };
    comparedTo?: string;
  }) => {
    rec.deltas.push({
      current: props.current,
      previous: props.previous,
      direction: props.metric.direction,
      comparedTo: props.comparedTo,
    });
    return (
      <span
        data-testid="delta"
        data-current={String(props.current)}
        data-previous={String(props.previous)}
        data-direction={props.metric.direction}
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

function makeFleet(overrides: Partial<DrivingStats> = {}): DrivingStats {
  return {
    totalDrives: 100,
    totalDistanceKm: 2000, // → 20 km mean per drive
    totalDurationS: 180_000, // → 30 min mean per drive
    avgEfficiencyWhKm: 160,
    avgSpeedKmh: 55,
    topSpeedKmh: 140,
    regenRatio: 0.12,
    regenEnergyWh: 40_000,
    co2SavedKg: 300,
    ...overrides,
  };
}

/** The captured Delta for the reading whose current value is `current`. */
function deltaFor(current: number): DeltaCall {
  const d = rec.deltas.find((x) => x.current === current);
  if (!d) {
    throw new Error(
      `no Delta captured for current=${current}; got ${rec.deltas.map((x) => x.current).join(', ')}`,
    );
  }
  return d;
}

beforeEach(() => {
  rec.system = 'km';
  rec.fleet = makeFleet();
  rec.deltas.length = 0;
});

afterEach(() => cleanup());

/* ══ A. The headline fix: different drives must look different ═════════════ */

describe('HeroGauges — discrimination (the constant-arc regression)', () => {
  it('renders visibly different output for a short errand and a long road trip', () => {
    const { container: short } = render(
      <HeroGauges
        drive={makeDrive({ distanceM: 5_000, durationS: 600 })}
        stats={makeStats({ maxSpd: 48, consumptionWhKm: 210 })}
      />,
    );
    const shortText = short.textContent ?? '';
    cleanup();

    const { container: long } = render(
      <HeroGauges
        drive={makeDrive({ distanceM: 500_000, durationS: 21_600 })}
        stats={makeStats({ maxSpd: 130, consumptionWhKm: 155 })}
      />,
    );
    const longText = long.textContent ?? '';

    // The old value-scaled rings rendered an identical 66.7% arc for both.
    expect(shortText).not.toBe(longText);
    expect(shortText).toContain('5.0');
    expect(longText).toContain('500.0');
  });

  it('never derives a ceiling from the reading itself', () => {
    // Two drives an order of magnitude apart must produce distinct headline
    // numbers rather than the same fraction of a self-scaled maximum.
    render(<HeroGauges drive={makeDrive({ distanceM: 10_000 })} stats={makeStats()} />);
    expect(screen.getByText('10.0')).toBeInTheDocument();
    cleanup();
    rec.deltas.length = 0;

    render(<HeroGauges drive={makeDrive({ distanceM: 100_000 })} stats={makeStats()} />);
    expect(screen.getByText('100.0')).toBeInTheDocument();
  });
});

/* ══ B. Baselines are real ════════════════════════════════════════════════ */

describe('HeroGauges — baselines', () => {
  it('compares distance and duration against per-drive means, not totals', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats()} />);

    // 2000 km over 100 drives → 20 km mean.
    expect(deltaFor(32).previous).toBe(20);
    // 180 000 s over 100 drives → 1800 s → 30 min mean.
    expect(deltaFor(45).previous).toBe(30);
  });

  it('compares max speed against the reader record, not the fleet mean', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats()} />);

    const speed = deltaFor(112);
    expect(speed.previous).toBe(140); // topSpeedKmh, not avgSpeedKmh (55)
    expect(speed.comparedTo).toBe('vs your record');
  });

  it('compares consumption against the reader average and marks it lower-better', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats()} />);

    const consumption = deltaFor(180);
    expect(consumption.previous).toBe(160);
    expect(consumption.direction).toBe('lower_better');
    expect(consumption.comparedTo).toBe('vs your average');
  });

  it('treats distance and duration as neutral — neither is good nor bad', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats()} />);

    expect(deltaFor(32).direction).toBe('neutral');
    expect(deltaFor(45).direction).toBe('neutral');
  });

  it('omits a baseline rather than dividing by a zero drive count', () => {
    rec.fleet = makeFleet({ totalDrives: 0, totalDistanceKm: 0, totalDurationS: 0 });
    render(<HeroGauges drive={makeDrive()} stats={makeStats()} />);

    expect(deltaFor(32).previous).toBeNull();
    expect(deltaFor(45).previous).toBeNull();
    // Non-derived baselines still resolve.
    expect(deltaFor(112).previous).toBe(140);
  });

  it('renders every reading with no baselines at all (first-ever drive)', () => {
    rec.fleet = undefined;
    render(<HeroGauges drive={makeDrive()} stats={makeStats()} />);

    expect(screen.getByText('32.0')).toBeInTheDocument();
    expect(deltaFor(32).previous).toBeNull();
    expect(deltaFor(112).previous).toBeNull();
    expect(deltaFor(180).previous).toBeNull();
  });
});

/* ══ C. km preference ═════════════════════════════════════════════════════ */

describe('HeroGauges — km preference', () => {
  it('renders all five readings with SI-derived values and metric units', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats({ efficiencyPctPer100: 12.5 })} />);

    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('32.0')).toBeInTheDocument();
    expect(screen.getByText('km')).toBeInTheDocument();

    expect(screen.getByText('Max Speed')).toBeInTheDocument();
    expect(screen.getByText('112')).toBeInTheDocument();
    expect(screen.getByText('km/h')).toBeInTheDocument();

    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('min')).toBeInTheDocument();

    expect(screen.getByText('Consumption')).toBeInTheDocument();
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByText('Wh/km')).toBeInTheDocument();

    expect(screen.getByText('Efficiency')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();
    expect(screen.getByText('%/100km')).toBeInTheDocument();
  });
});

/* ══ D. mi preference ═════════════════════════════════════════════════════ */

describe('HeroGauges — mi preference', () => {
  beforeEach(() => {
    rec.system = 'mi';
  });

  it('converts distance to miles, consumption to Wh/mi, and flips the suffixes', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats({ efficiencyPctPer100: 12.5 })} />);

    // 32 000 m / 1609.344 = 19.88 → 19.9 mi.
    expect(screen.getByText('19.9')).toBeInTheDocument();
    expect(screen.getByText('mi')).toBeInTheDocument();
    expect(screen.getByText('mph')).toBeInTheDocument();
    // 180 Wh/km × 1.609344 = 289.68 → 290 Wh/mi.
    expect(screen.getByText('290')).toBeInTheDocument();
    expect(screen.getByText('Wh/mi')).toBeInTheDocument();
    expect(screen.getByText('%/100mi')).toBeInTheDocument();
  });

  it('converts the BASELINES to imperial too, never comparing mi against km', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats()} />);

    // 20 km mean → 12.43 mi. Comparing 19.9 mi against a raw 20 would report a
    // near-zero delta when the drive is in fact ~60% longer than usual.
    const distance = rec.deltas.find((d) => d.comparedTo === 'vs your average');
    expect(distance?.previous).toBeCloseTo(12.43, 1);

    // 140 km/h record → 87.0 mph.
    const speed = rec.deltas.find((d) => d.comparedTo === 'vs your record');
    expect(speed?.previous).toBeCloseTo(87.0, 1);

    // 160 Wh/km → 257.5 Wh/mi, matching the Wh/mi reading it is compared to.
    const consumption = rec.deltas.find((d) => d.direction === 'lower_better');
    expect(consumption?.previous).toBeCloseTo(257.5, 1);
  });
});

/* ══ E. Efficiency reading — conditional branch + raw value ═══════════════ */

describe('HeroGauges — efficiency reading', () => {
  it('omits the efficiency reading when efficiencyPctPer100 is null', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats({ efficiencyPctPer100: null })} />);

    expect(screen.queryByText('Efficiency')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('delta')).toHaveLength(4);
  });

  it('renders a genuine 0 %/100km efficiency reading (not treated as absent)', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats({ efficiencyPctPer100: 0 })} />);

    expect(screen.getByText('Efficiency')).toBeInTheDocument();
    expect(deltaFor(0)).toBeDefined();
  });

  it('passes the raw efficiency number through, not a locale-formatted round-trip', () => {
    // 12.345 distinguishes the fix from the old Number(fmtNumber(x)) round-trip,
    // which rounded to precision-2 (and NaN'd on comma-decimal locales).
    render(<HeroGauges drive={makeDrive()} stats={makeStats({ efficiencyPctPer100: 12.345 })} />);

    expect(deltaFor(12.345)).toBeDefined();
  });
});

/* ══ F. Non-finite hardening ══════════════════════════════════════════════ */

describe('HeroGauges — non-finite hardening', () => {
  it('renders 0 for a live drive whose durationS is NaN, never the text "NaN"', () => {
    const { container } = render(
      <HeroGauges drive={makeDrive({ durationS: Number.NaN })} stats={makeStats()} />,
    );

    expect(deltaFor(0)).toBeDefined();
    expect(container.textContent).not.toContain('NaN');
  });

  it('coerces a NaN distanceM to 0 rather than rendering NaN', () => {
    const { container } = render(
      <HeroGauges drive={makeDrive({ distanceM: Number.NaN })} stats={makeStats()} />,
    );

    expect(screen.getByText('0.0')).toBeInTheDocument();
    expect(container.textContent).not.toContain('NaN');
  });

  it('coerces a NaN consumption reading to 0', () => {
    const { container } = render(
      <HeroGauges drive={makeDrive()} stats={makeStats({ consumptionWhKm: Number.NaN })} />,
    );

    expect(container.textContent).not.toContain('NaN');
  });

  it('survives a non-finite baseline without poisoning the comparison', () => {
    rec.fleet = makeFleet({ totalDistanceKm: Number.NaN, avgEfficiencyWhKm: Number.NaN });
    const { container } = render(<HeroGauges drive={makeDrive()} stats={makeStats()} />);

    expect(container.textContent).not.toContain('NaN');
    expect(deltaFor(32).previous).toBe(0); // safeNumber floors it, never NaN
  });
});

/* ══ G. Accessibility & degenerate data ═══════════════════════════════════ */

describe('HeroGauges — accessibility & degenerate data', () => {
  it('exposes the reading cluster as a named group', () => {
    render(<HeroGauges drive={makeDrive()} stats={makeStats()} />);

    expect(screen.getByRole('group', { name: 'Drive summary gauges' })).toBeInTheDocument();
  });

  it('still renders a full band of readings (never a blank panel) for an all-zero drive', () => {
    render(
      <HeroGauges
        drive={makeDrive({ distanceM: 0, durationS: 0 })}
        stats={makeStats({ maxSpd: 0, consumptionWhKm: 0, efficiencyPctPer100: null })}
      />,
    );

    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('Max Speed')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Consumption')).toBeInTheDocument();
    expect(screen.getAllByTestId('delta')).toHaveLength(4);
  });
});
