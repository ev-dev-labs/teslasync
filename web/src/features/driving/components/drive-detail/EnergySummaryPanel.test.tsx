/**
 * EnergySummaryPanel — behaviour, branch, a11y, and null-safety coverage for
 * the file's sole export.
 *
 * The panel is a presentational leaf: given one DriveDetail + its derived
 * DriveStats it renders a six-cell metric grid (Energy Consumed / Energy
 * Recovered / Net Consumption / Efficiency / Battery Used / Range Used) inside
 * a labelled <GlassPanel> region. All the interesting logic is in the per-cell
 * derivation — the Wh→kWh threshold, the SI Wh/km → Wh/(mi|km) efficiency
 * conversion, and the null-safety placeholders — so each assertion reads the
 * value straight back out of the cell it targets.
 *
 * This file pins the hardening pass:
 *   1. EFFICIENCY — Wh/km displays verbatim under metric prefs and is scaled by
 *      the shared SI converter (×1.609344) under imperial prefs, with no
 *      hand-typed factor drift; a non-positive consumption shows "—".
 *   2. BATTERY sub-range — a missing pct renders the universal "—" placeholder,
 *      never the pre-fix "?%".
 *   3. NULL-SAFETY — undefined numeric stats coerce to finite output, never
 *      "NaN"; the panel never renders blank.
 *   4. a11y — the panel is a `region` landmark named by its heading, and the
 *      decorative battery icon is hidden from assistive tech.
 *
 * Strategy: the component takes drive + stats as props, so no network is
 * touched. `useSettings` is mocked per-file with a mutable settings object so
 * both the metric and imperial branches of useUnits are exercised.
 * `react-i18next` is mocked so `t(key, fallback)` renders the English fallback
 * deterministically (and the spy lets us assert the exact keys). fmtNumber /
 * fmtWithUnit run unmocked at their default precision (2) / locale (en-US).
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

import { EnergySummaryPanel } from './EnergySummaryPanel';

/** A completed 40 km drive: 25% battery used, ideal-range 300 → 250. */
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

/** Derived stats: 12 kWh gross, 3 kWh regen, 150 Wh/km, 50 (km) range used. */
function makeStats(over: Partial<DriveStats> = {}): DriveStats {
  return {
    maxSpd: 0,
    avgSpd: 0,
    minSpd: 0,
    powerMax: 0,
    powerMin: 0,
    avgPower: 0,
    energyWh: 12000,
    regenWh: 3000,
    consumptionWhKm: 150,
    elevGain: 0,
    elevLoss: 0,
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
    odometerStart: 0,
    odometerEnd: 0,
    hasTirePressure: false,
    efficiencyPctPer100: null,
    ...over,
  };
}

function renderPanel(over: { drive?: Partial<DriveDetail>; stats?: Partial<DriveStats> } = {}) {
  return render(<EnergySummaryPanel drive={makeDrive(over.drive)} stats={makeStats(over.stats)} />);
}

/** Text of the value <p> for a metric label (its next sibling within the cell). */
function cellValue(label: string): string {
  const labelEl = screen.getByText(label);
  const valueEl = labelEl.nextElementSibling;
  if (!valueEl) throw new Error(`no value cell for "${label}"`);
  return valueEl.textContent ?? '';
}

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

describe('EnergySummaryPanel — chrome + a11y', () => {
  it('exposes a labelled region landmark named by its heading', () => {
    renderPanel();

    const region = screen.getByRole('region', { name: 'Energy Summary' });
    expect(region).toBeInTheDocument();

    const heading = screen.getByRole('heading', { level: 3, name: 'Energy Summary' });
    expect(heading).toBeInTheDocument();
    // The heading must be the element that actually names the region.
    expect(region.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(heading.id).not.toBe('');
  });

  it('hides the decorative battery icon from assistive tech', () => {
    const { container } = renderPanel();

    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    // Because the icon is hidden, the heading name is the text alone.
    expect(screen.getByRole('heading', { level: 3 })).toHaveAccessibleName('Energy Summary');
  });

  it('renders all six metric labels so the panel is never blank', () => {
    renderPanel();

    for (const label of [
      'Energy Consumed',
      'Energy Recovered',
      'Net Consumption',
      'Efficiency',
      'Battery Used',
      'Range Used',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('resolves every visible label through an i18n key with an English fallback', () => {
    renderPanel();

    expect(tSpy).toHaveBeenCalledWith('driveDetail.energySummary', 'Energy Summary');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.energyConsumed', 'Energy Consumed');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.efficiency', 'Efficiency');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.batteryUsed', 'Battery Used');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.rangeUsed', 'Range Used');
  });
});

describe('EnergySummaryPanel — energy formatting', () => {
  it('shows the three energy metrics in kWh above the 1 kWh threshold', () => {
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

describe('EnergySummaryPanel — efficiency conversion', () => {
  it('shows Wh/km verbatim under metric preferences', () => {
    mockSettings = { ...mockSettings, unit_of_length: 'km' };
    renderPanel({ stats: { consumptionWhKm: 150 } });

    expect(cellValue('Efficiency')).toBe('150.00 Wh/km');
  });

  it('scales Wh/km to Wh/mi via the shared SI converter under imperial preferences', () => {
    mockSettings = { ...mockSettings, unit_of_length: 'mi' };
    renderPanel({ stats: { consumptionWhKm: 150 } });

    // 150 Wh/km × 1.609344 km/mi = 241.4016 → 241.40 Wh/mi (precision 2).
    const eff = cellValue('Efficiency');
    expect(eff).toBe('241.40 Wh/mi');
    // Proves a real conversion happened, not the raw metric value.
    expect(eff).not.toContain('150.00');
  });

  it('shows the em-dash placeholder when consumption is non-positive', () => {
    renderPanel({ stats: { consumptionWhKm: 0 } });
    expect(cellValue('Efficiency')).toBe('—');
  });
});

describe('EnergySummaryPanel — battery used', () => {
  it('shows the SOC delta and the start → end sub-range for a complete drive', () => {
    renderPanel({ drive: { startBatteryPct: 90, endBatteryPct: 65 } });

    const battery = cellValue('Battery Used');
    expect(battery).toContain('25%');
    expect(battery).toContain('90% → 65%');
  });

  it('placeholders a missing end SOC with "—" while keeping the known start (regression: no "?")', () => {
    renderPanel({ drive: { startBatteryPct: 80, endBatteryPct: null } });

    const battery = cellValue('Battery Used');
    expect(battery).toContain('80% → —');
    // The delta needs BOTH ends, so it collapses to the "—" placeholder…
    expect(battery).not.toContain('15%');
    // …and the pre-fix stray "?" must never resurface.
    expect(battery).not.toContain('?');
  });

  it('placeholders both ends when the whole SOC reading is missing', () => {
    renderPanel({ drive: { startBatteryPct: null, endBatteryPct: null } });

    const battery = cellValue('Battery Used');
    expect(battery).toContain('— → —');
    expect(battery).not.toContain('%');
    expect(battery).not.toContain('?');
  });
});

describe('EnergySummaryPanel — range used', () => {
  it('shows the range delta with the user distance unit', () => {
    renderPanel({ stats: { startRange: 300, endRange: 250 } });
    expect(cellValue('Range Used')).toBe('50.00 km');
  });

  it('labels the range delta in miles under imperial preferences', () => {
    mockSettings = { ...mockSettings, unit_of_length: 'mi' };
    renderPanel({ stats: { startRange: 300, endRange: 250 } });
    expect(cellValue('Range Used')).toBe('50.00 mi');
  });

  it('shows the em-dash placeholder when either range endpoint is missing', () => {
    renderPanel({ stats: { startRange: 300, endRange: null } });
    expect(cellValue('Range Used')).toBe('—');
  });
});

describe('EnergySummaryPanel — null safety', () => {
  it('coerces undefined numeric stats to finite output without NaN', () => {
    renderPanel({
      stats: {
        energyWh: undefined as unknown as number,
        regenWh: undefined as unknown as number,
        consumptionWhKm: undefined as unknown as number,
        startRange: null,
        endRange: null,
      },
    });

    expect(cellValue('Energy Consumed')).toBe('0.00 Wh');
    expect(cellValue('Energy Recovered')).toBe('0.00 Wh');
    expect(cellValue('Net Consumption')).toBe('0.00 Wh');
    // consumption 0 → efficiency placeholder, not "NaN Wh/km".
    expect(cellValue('Efficiency')).toBe('—');
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it('never crashes and keeps the region present when every optional field is null', () => {
    expect(() =>
      render(
        <EnergySummaryPanel
          drive={makeDrive({ startBatteryPct: null, endBatteryPct: null })}
          stats={makeStats({
            energyWh: 0,
            regenWh: 0,
            consumptionWhKm: 0,
            startRange: null,
            endRange: null,
          })}
        />,
      ),
    ).not.toThrow();

    const region = screen.getByRole('region', { name: 'Energy Summary' });
    expect(within(region).getByText('Battery Used')).toBeInTheDocument();
    expect(cellValue('Efficiency')).toBe('—');
    expect(cellValue('Range Used')).toBe('—');
  });
});
