/**
 * DetailCards — behaviour + hardening contract.
 *
 * DetailCards renders the two-up "Temperature Details" + "Power Summary" band at
 * the bottom of the drivetrain-health page. It owns no data source of its own —
 * the parent feeds it an already-resolved `DrivetrainHealthData`, three derived
 * power scalars, and a `DrivingStats` bag — so these tests pin the display
 * behaviour that matters and the null/non-finite hardening this elevation added:
 *
 *   - the Temperature card is a three-state switch: `loading` → a 4-line skeleton
 *     (never the rows, never the empty state); `!health` → the shared EmptyState
 *     (role="status") with the "no health" copy; otherwise the four motor/inverter/
 *     battery rows, each read through the REAL `formatTemperature` converter;
 *   - a per-sensor `null` reading renders the neutral "—" placeholder for that row
 *     only, leaving its siblings intact (via the shared `displayTemp` helper);
 *   - temperature-unit preference flows end-to-end: °C vs °F converts the SI
 *     celsius payload through the real `convertTempFromSI`;
 *   - the Power Summary rows are conditional and, crucially, non-finite-safe (the
 *     real bug this elevation fixed): an `Infinity` peak/avg power, a `-Infinity`
 *     regen floor, or a `NaN` CO₂ figure now collapse to "—" instead of the
 *     fabricated "0 kW" / "0.0 kW" / "0.0 kg" the old `> 0` / bare-formatter path
 *     produced — while a genuine `0` still renders as a real "0.0" value;
 *   - `stats` absence blanks both stats-derived rows to "—" without ever invoking
 *     the energy formatter on undefined.
 *
 * `react-i18next` is mocked to echo the English fallback (mirrors the sibling
 * SummaryStats / HeroGauges / DriveStatCards convention). `useUnits` is the
 * settings-backed boundary hook, mocked to drive the °C/°F branch while the pure
 * SI temperature + energy converters from `@/lib/unitConversion` run for real.
 * The component exposes no interactive controls, so there is no userEvent surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';

import { DetailCards } from './DetailCards';
import type { DrivetrainHealthData, DrivingStats } from '@/types/driving';
import type { UnitPref } from '@/lib/unitConversion';

/* ── Controllable mock state, hoisted above the vi.mock factories ─────────── */
const h = vi.hoisted(() => ({ temp: '\u00B0C' as '\u00B0C' | '\u00B0F' }));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// Drive the temperature unit while letting the REAL SI converters + formatters
// run — the same pattern the sibling drive-detail tests use for `useUnits`.
vi.mock('@/hooks/useUnits', async () => {
  const lib = await vi.importActual<typeof import('@/lib/unitConversion')>('@/lib/unitConversion');
  return {
    useUnits: () => {
      const unitPrefs: UnitPref = {
        distance: 'km',
        speed: 'km/h',
        temperature: h.temp,
        pressure: 'bar',
        energy: 'kWh',
        duration: 'h',
        power: 'kW',
        locale: 'en-US',
      };
      type Opts = { precision?: number };
      return {
        unitPrefs,
        formatDistance: (v: number | null | undefined, o?: Opts) => lib.formatDistance(v, unitPrefs, o),
        formatSpeed: (v: number | null | undefined, o?: Opts) => lib.formatSpeed(v, unitPrefs, o),
        formatTemperature: (v: number | null | undefined, o?: Opts) => lib.formatTemperature(v, unitPrefs, o),
        formatPressure: (v: number | null | undefined, o?: Opts) => lib.formatPressure(v, unitPrefs, o),
        formatEnergy: (v: number | null | undefined, o?: Opts) => lib.formatEnergy(v, unitPrefs, o),
        formatDuration: (v: number | null | undefined, o?: Opts) => lib.formatDuration(v, unitPrefs, o),
        formatPower: (v: number | null | undefined, o?: Opts) => lib.formatPower(v, unitPrefs, o),
      };
    },
  };
});

/* ── Unicode glyphs the component renders (escaped to avoid encoding drift) ─ */
const DASH = '\u2014'; // —
const DEGC = '\u00B0C';
const DEGF = '\u00B0F';
const CO2_SAVED = 'CO\u2082 Saved'; // "CO₂ Saved"

/* ── Fixtures ─────────────────────────────────────────────────────────────── */
function makeHealth(overrides: Partial<DrivetrainHealthData> = {}): DrivetrainHealthData {
  return {
    frontMotorTempC: 48,
    rearMotorTempC: 52,
    inverterTempC: 41,
    batteryTempC: 30,
    motorStatus: 'active',
    overallHealth: 'good',
    ...overrides,
  };
}

function makeStats(overrides: Partial<DrivingStats> = {}): DrivingStats {
  return {
    totalDrives: 10,
    totalDistanceKm: 500,
    totalDurationS: 36_000,
    avgEfficiencyWhKm: 160,
    avgSpeedKmh: 45,
    topSpeedKmh: 120,
    regenRatio: 0.2,
    regenEnergyWh: 5400,
    co2SavedKg: 12.34,
    ...overrides,
  };
}

type Props = ComponentProps<typeof DetailCards>;

function renderCards(overrides: Partial<Props> = {}) {
  const props: Props = {
    health: makeHealth(),
    peakPower: 305,
    avgPowerMax: 182.4,
    minRegenPower: -64.2,
    stats: makeStats(),
    loading: false,
    ...overrides,
  };
  return render(<DetailCards {...props} />);
}

/** Read the value cell (`<dd>`) of a KVList row addressed by its label text. */
function rowValue(label: string): string {
  const dt = screen.getByText(label);
  const dd = dt.parentElement?.querySelector('dd');
  return dd?.textContent ?? '';
}

beforeEach(() => {
  h.temp = '\u00B0C';
});

/* ── Temperature Details card — three-state switch ────────────────────────── */
describe('DetailCards — Temperature Details states', () => {
  it('renders a 4-line skeleton while loading (no rows, no empty state)', () => {
    const { container } = renderCards({ loading: true });

    // Both card headers are always present regardless of state.
    expect(screen.getByRole('heading', { name: 'Temperature Details' })).toBeInTheDocument();
    // Skeleton lines render as animate-pulse bars — one per requested line.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4);
    // The rows and the empty state must NOT show while loading.
    expect(screen.queryByText('Front Motor Temp')).not.toBeInTheDocument();
    expect(
      screen.queryByText('No drivetrain health data available yet'),
    ).not.toBeInTheDocument();
  });

  it('renders the shared EmptyState (role=status) when health is null', () => {
    const { container } = renderCards({ health: null, loading: false });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('No drivetrain health data available yet');
    // No skeleton, no temperature rows in the empty branch.
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByText('Rear Motor Temp')).not.toBeInTheDocument();
  });

  it('treats undefined health the same as null (EmptyState, not a crash)', () => {
    renderCards({ health: undefined });
    expect(screen.getByRole('status')).toHaveTextContent(
      'No drivetrain health data available yet',
    );
  });

  it('renders all four temperature rows through the real °C converter', () => {
    renderCards();

    expect(rowValue('Front Motor Temp')).toBe(`48.0${DEGC}`);
    expect(rowValue('Rear Motor Temp')).toBe(`52.0${DEGC}`);
    expect(rowValue('Inverter Temp')).toBe(`41.0${DEGC}`);
    expect(rowValue('Battery Temp')).toBe(`30.0${DEGC}`);
  });

  it('shows "—" for a single null sensor while its siblings still render', () => {
    renderCards({ health: makeHealth({ inverterTempC: null }) });

    expect(rowValue('Inverter Temp')).toBe(DASH);
    // Neighbours are unaffected — only the null row collapses.
    expect(rowValue('Front Motor Temp')).toBe(`48.0${DEGC}`);
    expect(rowValue('Battery Temp')).toBe(`30.0${DEGC}`);
  });

  it('converts the SI celsius payload to °F when that is the preference', () => {
    h.temp = '\u00B0F';
    renderCards();

    // 48 °C → 118.4 °F and 30 °C → 86.0 °F via the real convertTempFromSI.
    expect(rowValue('Front Motor Temp')).toBe(`118.4${DEGF}`);
    expect(rowValue('Battery Temp')).toBe(`86.0${DEGF}`);
    expect(rowValue('Front Motor Temp')).not.toContain(DEGC);
  });
});

/* ── Power Summary card — populated values ────────────────────────────────── */
describe('DetailCards — Power Summary values', () => {
  it('formats every power/stats row with its unit suffix', () => {
    renderCards();

    expect(screen.getByRole('heading', { name: 'Power Summary' })).toBeInTheDocument();
    expect(rowValue('Peak Power')).toBe('305 kW');
    expect(rowValue('Avg Peak Power')).toBe('182.4 kW');
    // Regen floor is stored as a negative power; the card shows its magnitude.
    expect(rowValue('Max Regen')).toBe('64.2 kW');
    // 5400 Wh → 5.4 kWh via the real formatEnergy.
    expect(rowValue('Total Regen')).toBe('5.4 kWh');
    expect(rowValue(CO2_SAVED)).toBe('12.3 kg');
  });

  it('blanks every row to "—" when there is no power data and no stats', () => {
    renderCards({ peakPower: 0, avgPowerMax: 0, minRegenPower: 0, stats: undefined });

    expect(rowValue('Peak Power')).toBe(DASH);
    expect(rowValue('Avg Peak Power')).toBe(DASH);
    expect(rowValue('Max Regen')).toBe(DASH);
    expect(rowValue('Total Regen')).toBe(DASH);
    expect(rowValue(CO2_SAVED)).toBe(DASH);
  });

  it('shows "—" for regen when the floor is non-negative (no regen captured)', () => {
    renderCards({ minRegenPower: 5 });
    expect(rowValue('Max Regen')).toBe(DASH);
  });

  it('keeps rendering genuine zero stats as real "0.0" values, not "—"', () => {
    renderCards({ stats: makeStats({ regenEnergyWh: 0, co2SavedKg: 0 }) });

    // A present-but-zero stat is meaningful data, not an absence.
    expect(rowValue('Total Regen')).toBe('0.0 kWh');
    expect(rowValue(CO2_SAVED)).toBe('0.0 kg');
  });
});

/* ── Power Summary card — non-finite hardening (the real bug fixed here) ───── */
describe('DetailCards — non-finite power/stats safety', () => {
  it('collapses non-finite power + CO₂ inputs to "—" instead of fabricating a zero', () => {
    const { container } = renderCards({
      peakPower: Number.POSITIVE_INFINITY,
      avgPowerMax: Number.POSITIVE_INFINITY,
      minRegenPower: Number.NEGATIVE_INFINITY,
      stats: makeStats({ co2SavedKg: Number.NaN }),
    });

    expect(rowValue('Peak Power')).toBe(DASH);
    expect(rowValue('Avg Peak Power')).toBe(DASH);
    expect(rowValue('Max Regen')).toBe(DASH);
    expect(rowValue(CO2_SAVED)).toBe(DASH);

    // Regression guards: the old path coerced Infinity/NaN → a fabricated 0.
    expect(container.textContent).not.toContain('0 kW');
    expect(container.textContent).not.toContain('0.0 kW');
    expect(container.textContent).not.toContain('0.0 kg');
    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).not.toContain('Infinity');
  });

  it('still renders the finite sibling stat while a NaN stat collapses', () => {
    renderCards({ stats: makeStats({ regenEnergyWh: 5400, co2SavedKg: Number.NaN }) });

    // regen is finite → real value; co2 is NaN → placeholder. Independent rows.
    expect(rowValue('Total Regen')).toBe('5.4 kWh');
    expect(rowValue(CO2_SAVED)).toBe(DASH);
  });
});
