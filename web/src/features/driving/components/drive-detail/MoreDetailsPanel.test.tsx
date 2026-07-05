/**
 * MoreDetailsPanel — behaviour, branch, a11y, and null-safety coverage for the
 * file's sole export.
 *
 * The panel is a presentational leaf: given one DriveDetail + its derived
 * DriveStats it renders a two-row metric grid (odometer / range / elevation /
 * energy consumed / recovered / consumption, then avg power / temps / min speed /
 * battery / net) inside a labelled <GlassPanel> region. All the interesting logic
 * lives in per-cell derivation — the Wh→kWh threshold, the SI Wh/km → Wh/(mi|km)
 * efficiency conversion, the conditional temperature cells, and the null-safety
 * placeholders — so each assertion reads the value straight back out of the cell
 * it targets.
 *
 * This file pins the hardening pass:
 *   1. EFFICIENCY — Wh/km displays verbatim under metric prefs and is scaled by
 *      the shared SI converter (×1.609344) under imperial prefs, with no
 *      hand-typed factor drift; a non-positive consumption shows "—".
 *   2. ENERGY — the shared fmtEnergy helper flips to kWh above 1 kWh and stays in
 *      Wh below it, for consumed / recovered / net (incl. a negative net).
 *   3. RANGE sub-endpoint — a missing end range renders the universal "—"
 *      placeholder, never the pre-fix stray "?".
 *   4. TEMPS — the two optional cells render with the user's temperature label
 *      when present and drop out entirely when null.
 *   5. NULL-SAFETY — undefined numeric stats coerce to finite output, never
 *      "NaN"; the panel never renders blank.
 *   6. a11y — the panel is a `region` landmark named by its heading, and every
 *      decorative icon is hidden from assistive tech.
 *
 * Strategy: the component takes drive + stats as props, so no network is touched.
 * `useSettings` is mocked per-file with a mutable settings object so both the
 * metric and imperial branches of useUnits are exercised. `react-i18next` is
 * mocked so `t(key, fallback)` renders the English fallback deterministically
 * (and the spy lets us assert the exact keys). fmtNumber / fmtInt / fmtWithUnit
 * run unmocked at their default precision (2) / locale (en-US).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { AppSettings } from '@/api/types';
import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';

// jsdom lacks matchMedia; FadeIn → useMotionPreference → framer-motion's
// useReducedMotion reaches for it. Install a benign stub before any shared
// module evaluates.
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

// Mutable settings so a single test can flip metric ↔ imperial. useUnits reads
// settings.unit_of_length synchronously each render, so mutating before render
// is enough. This file-level mock takes precedence over the global test-setup
// stub.
let mockSettings: Partial<AppSettings> = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  locale: 'en-US',
  decimal_precision: 2,
};
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: mockSettings }),
}));

// i18n → return the developer fallback so labels read as real English; the spy
// records the (key, fallback) pairs so we can assert the i18n contract.
const { tSpy } = vi.hoisted(() => ({
  tSpy: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
}));
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({ t: tSpy, i18n: { language: 'en', changeLanguage: vi.fn() } }),
  };
});

import { MoreDetailsPanel } from './MoreDetailsPanel';

/** A completed drive with a known 25-point SOC delta (90% → 65%). */
function makeDrive(over: Partial<DriveDetail> = {}): DriveDetail {
  return {
    id: 1,
    vehicleId: 1,
    startTs: '2024-06-01T12:00:00Z',
    endTs: '2024-06-01T12:30:00Z',
    durationS: 1800,
    distanceM: 40000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 90,
    endBatteryPct: 65,
    energyUsedWh: 12000,
    regenEnergyWh: 3000,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '2024-06-01T12:00:00Z',
    updatedAt: '2024-06-01T12:30:00Z',
    positions: [],
    telemetry: [],
    ...over,
  };
}

/**
 * Derived stats. Distances/ranges/speeds/temps are already in the user's display
 * unit at this layer (useDriveDetailData converts before building DriveStats);
 * energy is Wh (SI) and consumption is Wh/km (SI). Defaults: 12 kWh gross / 3 kWh
 * regen / 150 Wh/km, odometer 1000→1040, range 300→250, avg power 15 kW, min
 * speed 12.6, elevation +123 / −45.
 */
function makeStats(over: Partial<DriveStats> = {}): DriveStats {
  return {
    maxSpd: 100,
    avgSpd: 60,
    minSpd: 12.6,
    powerMax: 90,
    powerMin: -30,
    avgPower: 15,
    energyWh: 12000,
    regenWh: 3000,
    consumptionWhKm: 150,
    elevGain: 123,
    elevLoss: 45,
    avgOutsideTemp: null,
    avgInsideTemp: null,
    hasAnyTemp: false,
    insideTemps: [],
    outsideTemps: [],
    driverTemps: [],
    passengerTemps: [],
    climateStatus: null,
    avgFanSpeed: null,
    maxFanSpeed: null,
    startRange: 300,
    endRange: 250,
    odometerStart: 1000,
    odometerEnd: 1040,
    hasTirePressure: false,
    efficiencyPctPer100: null,
    ...over,
  };
}

function renderPanel(over: { drive?: Partial<DriveDetail>; stats?: Partial<DriveStats> } = {}) {
  return render(<MoreDetailsPanel drive={makeDrive(over.drive)} stats={makeStats(over.stats)} />);
}

/** Text of the value node for a metric label (its next sibling within the cell). */
function cellValue(label: string): string {
  const labelEl = screen.getByText(label);
  const valueEl = labelEl.nextElementSibling;
  if (!valueEl) throw new Error(`no value cell for "${label}"`);
  return (valueEl.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Labels that must ALWAYS render (temperature cells are conditional). */
const ALWAYS_LABELS = [
  'Odometer (From → To)',
  'Range (Start → End)',
  'Elevation Summary',
  'Energy Consumed',
  'Energy Recovered',
  'Consumption',
  'Avg Power',
  'Min Speed',
  'Battery Used',
  'Net Consumption',
];

beforeEach(() => {
  tSpy.mockClear();
  mockSettings = {
    unit_of_length: 'km',
    unit_of_temp: 'C',
    unit_of_pressure: 'bar',
    locale: 'en-US',
    decimal_precision: 2,
  };
});

describe('MoreDetailsPanel — chrome + a11y', () => {
  it('exposes a labelled region landmark named by its heading', () => {
    renderPanel();

    const region = screen.getByRole('region', { name: 'More Details' });
    expect(region).toBeInTheDocument();

    const heading = screen.getByRole('heading', { level: 3, name: 'More Details' });
    expect(heading).toBeInTheDocument();
    // The heading must be the element that actually names the region.
    expect(region.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(heading.id).not.toBe('');
  });

  it('hides every decorative icon from assistive tech', () => {
    const { container } = renderPanel();

    const icons = container.querySelectorAll('svg');
    // Activity (heading) + ArrowUpRight + ArrowDownRight (elevation cell).
    expect(icons.length).toBeGreaterThanOrEqual(3);
    icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
    // Because icons are hidden, the heading's accessible name is the text alone.
    expect(screen.getByRole('heading', { level: 3 })).toHaveAccessibleName('More Details');
  });

  it('renders every always-on metric label so the panel is never blank', () => {
    renderPanel();

    for (const label of ALWAYS_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('resolves visible labels through i18n keys with English fallbacks', () => {
    renderPanel();

    expect(tSpy).toHaveBeenCalledWith('driveDetail.moreDetails', 'More Details');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.odometer', 'Odometer (From → To)');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.rangeStartEnd', 'Range (Start → End)');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.elevSummary', 'Elevation Summary');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.consumptionRate', 'Consumption');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.netEnergy', 'Net Consumption');
  });
});

describe('MoreDetailsPanel — odometer + range', () => {
  it('shows the odometer from → to with the user distance unit', () => {
    renderPanel({ stats: { odometerStart: 1000, odometerEnd: 1040 } });

    const odo = cellValue('Odometer (From → To)');
    expect(odo).toContain('1,000.00 → 1,040.00');
    expect(odo).toContain('km');
  });

  it('placeholders the odometer when a reading is missing (0 = unknown)', () => {
    renderPanel({ stats: { odometerStart: 0, odometerEnd: 0 } });

    const odo = cellValue('Odometer (From → To)');
    expect(odo).toContain('—');
    expect(odo).not.toContain('→');
  });

  it('shows the range start → end with the distance unit', () => {
    renderPanel({ stats: { startRange: 300, endRange: 250 } });

    const range = cellValue('Range (Start → End)');
    expect(range).toContain('300.00 → 250.00');
    expect(range).toContain('km');
  });

  it('placeholders a missing end range with "—" and never the stray "?" (regression)', () => {
    renderPanel({ stats: { startRange: 300, endRange: null } });

    const range = cellValue('Range (Start → End)');
    expect(range).toContain('300.00 → —');
    expect(range).not.toContain('?');
  });

  it('collapses the whole range cell to "—" when the start is missing', () => {
    renderPanel({ stats: { startRange: null, endRange: null } });

    const range = cellValue('Range (Start → End)');
    expect(range).toContain('—');
    expect(range).not.toContain('→');
  });
});

describe('MoreDetailsPanel — elevation', () => {
  it('shows both the elevation gain and loss in metres', () => {
    renderPanel({ stats: { elevGain: 123, elevLoss: 45 } });

    const elev = cellValue('Elevation Summary');
    expect(elev).toContain('123.00 m');
    expect(elev).toContain('45.00 m');
  });
});

describe('MoreDetailsPanel — energy formatting', () => {
  it('shows the energy metrics in kWh above the 1 kWh threshold', () => {
    renderPanel({ stats: { energyWh: 12000, regenWh: 3000 } });

    expect(cellValue('Energy Consumed')).toBe('12.00 kWh');
    expect(cellValue('Energy Recovered')).toBe('3.00 kWh');
    // Net = consumed − recovered = 9 kWh.
    expect(cellValue('Net Consumption')).toBe('9.00 kWh');
  });

  it('falls back to Wh for sub-kilowatt-hour readings', () => {
    renderPanel({ stats: { energyWh: 800, regenWh: 200 } });

    expect(cellValue('Energy Consumed')).toBe('800.00 Wh');
    expect(cellValue('Energy Recovered')).toBe('200.00 Wh');
    // 800 − 200 = 600 Wh, still below the kWh threshold.
    expect(cellValue('Net Consumption')).toBe('600.00 Wh');
  });

  it('renders a negative net when regeneration exceeds consumption', () => {
    renderPanel({ stats: { energyWh: 500, regenWh: 1500 } });

    // 500 − 1500 = −1000 Wh (not > 1000, so stays in the Wh branch).
    expect(cellValue('Net Consumption')).toBe('-1,000.00 Wh');
  });
});

describe('MoreDetailsPanel — efficiency conversion', () => {
  it('shows Wh/km verbatim under metric preferences', () => {
    mockSettings = { ...mockSettings, unit_of_length: 'km' };
    renderPanel({ stats: { consumptionWhKm: 150 } });

    expect(cellValue('Consumption')).toBe('150.00 Wh/km');
  });

  it('scales Wh/km to Wh/mi via the shared SI converter under imperial preferences', () => {
    mockSettings = { ...mockSettings, unit_of_length: 'mi' };
    renderPanel({ stats: { consumptionWhKm: 150 } });

    // 150 Wh/km × 1.609344 km/mi = 241.4016 → 241.40 Wh/mi (precision 2).
    const eff = cellValue('Consumption');
    expect(eff).toBe('241.40 Wh/mi');
    // Proves a real conversion happened, not the raw metric value.
    expect(eff).not.toContain('150.00');
  });

  it('shows the em-dash placeholder when consumption is non-positive', () => {
    renderPanel({ stats: { consumptionWhKm: 0 } });

    expect(cellValue('Consumption')).toBe('— Wh/km');
  });
});

describe('MoreDetailsPanel — power, speed, battery', () => {
  it('shows average power in kW', () => {
    renderPanel({ stats: { avgPower: 15 } });
    expect(cellValue('Avg Power')).toBe('15.00 kW');
  });

  it('shows the min speed as a rounded integer with the user speed unit', () => {
    renderPanel({ stats: { minSpd: 12.6 } });
    // fmtInt rounds to 0 decimals; metric label is km/h.
    expect(cellValue('Min Speed')).toBe('13 km/h');
  });

  it('labels the min speed in mph under imperial preferences', () => {
    mockSettings = { ...mockSettings, unit_of_length: 'mi' };
    renderPanel({ stats: { minSpd: 12.6 } });
    expect(cellValue('Min Speed')).toBe('13 mph');
  });

  it('shows the battery SOC delta for a complete drive', () => {
    renderPanel({ drive: { startBatteryPct: 90, endBatteryPct: 65 } });
    expect(cellValue('Battery Used')).toBe('25%');
  });

  it('placeholders the battery delta when either endpoint is missing', () => {
    renderPanel({ drive: { startBatteryPct: 80, endBatteryPct: null } });

    const battery = cellValue('Battery Used');
    expect(battery).toBe('—');
    expect(battery).not.toContain('%');
  });
});

describe('MoreDetailsPanel — optional temperature cells', () => {
  it('renders both temperature cells with the user unit when present', () => {
    renderPanel({ stats: { avgOutsideTemp: 20, avgInsideTemp: 22 } });

    // Values arrive pre-converted; the panel just appends the display label.
    expect(cellValue('Avg Outside Temp')).toBe('20.00°C');
    expect(cellValue('Avg Inside Temp')).toBe('22.00°C');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.avgOutsideTemp', 'Avg Outside Temp');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.avgInsideTemp', 'Avg Inside Temp');
  });

  it('labels the temperature with °F under Fahrenheit preferences', () => {
    mockSettings = { ...mockSettings, unit_of_temp: 'F' };
    renderPanel({ stats: { avgOutsideTemp: 68, avgInsideTemp: 72 } });

    expect(cellValue('Avg Outside Temp')).toBe('68.00°F');
    expect(cellValue('Avg Inside Temp')).toBe('72.00°F');
  });

  it('drops the outside-temp cell entirely when the reading is null', () => {
    renderPanel({ stats: { avgOutsideTemp: null, avgInsideTemp: 22 } });

    expect(screen.queryByText('Avg Outside Temp')).toBeNull();
    expect(screen.getByText('Avg Inside Temp')).toBeInTheDocument();
  });

  it('drops both temperature cells when neither reading exists', () => {
    renderPanel({ stats: { avgOutsideTemp: null, avgInsideTemp: null } });

    expect(screen.queryByText('Avg Outside Temp')).toBeNull();
    expect(screen.queryByText('Avg Inside Temp')).toBeNull();
    // …but the panel is still fully populated with its always-on metrics.
    expect(screen.getByText('Avg Power')).toBeInTheDocument();
  });
});

describe('MoreDetailsPanel — null safety', () => {
  it('coerces undefined numeric stats to finite output without NaN', () => {
    renderPanel({
      stats: {
        energyWh: undefined as unknown as number,
        regenWh: undefined as unknown as number,
        consumptionWhKm: undefined as unknown as number,
        avgPower: undefined as unknown as number,
        minSpd: undefined as unknown as number,
        elevGain: undefined as unknown as number,
        elevLoss: undefined as unknown as number,
        startRange: null,
        endRange: null,
      },
    });

    expect(cellValue('Energy Consumed')).toBe('0.00 Wh');
    expect(cellValue('Energy Recovered')).toBe('0.00 Wh');
    expect(cellValue('Net Consumption')).toBe('0.00 Wh');
    expect(cellValue('Avg Power')).toBe('0.00 kW');
    // consumption 0 → efficiency placeholder, not "NaN Wh/km".
    expect(cellValue('Consumption')).toBe('— Wh/km');
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it('never crashes and keeps the region present when every optional field is null', () => {
    expect(() =>
      render(
        <MoreDetailsPanel
          drive={makeDrive({ startBatteryPct: null, endBatteryPct: null })}
          stats={makeStats({
            energyWh: 0,
            regenWh: 0,
            consumptionWhKm: 0,
            avgOutsideTemp: null,
            avgInsideTemp: null,
            startRange: null,
            endRange: null,
            odometerStart: 0,
            odometerEnd: 0,
          })}
        />,
      ),
    ).not.toThrow();

    const region = screen.getByRole('region', { name: 'More Details' });
    expect(within(region).getByText('Battery Used')).toBeInTheDocument();
    expect(cellValue('Battery Used')).toBe('—');
    expect(cellValue('Consumption')).toBe('— Wh/km');
  });
});
