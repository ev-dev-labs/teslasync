/**
 * TemperatureSection — behaviour, branch, a11y, and null-safety coverage for
 * the file's sole export.
 *
 * The section is a presentational leaf: given the drive's per-sample
 * `chartData` plus the derived `DriveStats` it renders a temperature stat band
 * (Outside / Inside / Driver / Passenger / Climate / Fan) above a synced line
 * chart, or a labelled empty state when there is nothing to plot. The chart SVG
 * never lays out under jsdom (recharts' ResponsiveContainer measures 0×0), so
 * every assertion targets the stat tiles, the ChartContainer chrome, or the
 * empty state — the parts that actually render.
 *
 * This file pins the hardening pass:
 *   1. AVERAGES — the driver/passenger tiles show the arithmetic mean of their
 *      per-sample series (the component derives these itself), and drop out
 *      entirely when the series is empty.
 *   2. UNIT LABEL — every temperature reads with the user's temperature unit
 *      (°C under metric, °F under Fahrenheit), applied at the render boundary.
 *   3. FAN i18n — the fan tile's "Max" label resolves through
 *      `driveDetail.max` rather than a hard-coded English literal (the bug this
 *      pass fixes).
 *   4. EMPTY STATE — fewer than two samples OR no temperature at all collapses
 *      the whole band to the translated placeholder, and its decorative icon is
 *      hidden from assistive tech (regression: the icon had no aria-hidden).
 *   5. NULL-SAFETY — undefined temperature arrays never crash the render and
 *      never surface "NaN".
 *   6. a11y — the chart is a labelled `figure` whose name comes from its title
 *      heading, and the chart body re-states the summary via `role="img"`.
 *
 * Strategy: the component takes chartData + stats as props, so no network is
 * touched by the section itself. `useSettings` is mocked per-file with a mutable
 * settings object so both the °C and °F branches of useUnits are exercised.
 * `react-i18next` is mocked so `t(key, fallback)` renders the English fallback
 * deterministically (and the spy asserts the exact keys). ChartContainer's
 * export + annotation hooks are stubbed (they would otherwise reach
 * html2canvas / the API client), matching the ChartContainer a11y test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppSettings } from '@/api/types';
import type { ChartDataPoint, DriveStats } from './types';

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

// Mutable settings so a single test can flip metric ↔ Fahrenheit. useUnits reads
// settings.unit_of_temp synchronously each render, so mutating before render is
// enough. This file-level mock takes precedence over the global test-setup stub.
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

// ChartContainer's export menu reaches into html2canvas-pro / FileSaver and its
// annotation hooks reach the API client — neither is needed here. Stub both to
// the production return shape, mirroring the ChartContainer a11y test.
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null },
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    copyToClipboard: vi.fn(async () => 'copied' as const),
    exporting: false,
  }),
}));
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));

// TemperatureSection calls useHiddenSeries at component scope; stub it to avoid
// needing a <Router> wrapper in every test (the hook calls useSearchParams).
vi.mock('@/hooks/useHiddenSeries', () => ({
  useHiddenSeries: () => ({
    hidden: new Set<string>(),
    toggle: () => undefined,
    isHidden: () => false,
    reset: () => undefined,
  }),
}));

import { TemperatureSection } from './TemperatureSection';

/** A minimal chart sample; only `chartData.length` gates the chart branch. */
function makePoint(over: Partial<ChartDataPoint> = {}): ChartDataPoint {
  return {
    time: '12:00',
    speed: 0,
    battery: 0,
    elevation: 0,
    power: 0,
    outsideTemp: null,
    insideTemp: null,
    driverTemp: null,
    passengerTemp: null,
    idealRange: null,
    ratedRange: null,
    estRange: null,
    odometer: null,
    soc: null,
    usableSoc: null,
    tireFl: null,
    tireFr: null,
    tireRl: null,
    tireRr: null,
    climateOn: null,
    fanStatus: null,
    ...over,
  };
}

/** Two samples — enough to satisfy the `points.length > 1` chart gate. */
function defaultPoints(): ChartDataPoint[] {
  return [makePoint(), makePoint()];
}

/**
 * Derived stats. Temperatures arrive already converted to the user's display
 * unit at this layer (useDriveDetailData converts before building DriveStats);
 * the section only appends the unit label. Defaults describe a drive with
 * outside/inside temperature telemetry but no driver/passenger/climate/fan data.
 */
function makeStats(over: Partial<DriveStats> = {}): DriveStats {
  return {
    maxSpd: 0,
    avgSpd: 0,
    minSpd: 0,
    powerMax: 0,
    powerMin: 0,
    avgPower: 0,
    energyWh: 0,
    regenWh: 0,
    consumptionWhKm: 0,
    elevGain: 0,
    elevLoss: 0,
    avgOutsideTemp: 15,
    avgInsideTemp: 21,
    hasAnyTemp: true,
    insideTemps: [20, 22],
    outsideTemps: [14, 16],
    driverTemps: [],
    passengerTemps: [],
    climateStatus: null,
    avgFanSpeed: null,
    maxFanSpeed: null,
    startRange: null,
    endRange: null,
    odometerStart: 0,
    odometerEnd: 0,
    hasTirePressure: false,
    efficiencyPctPer100: null,
    ...over,
  };
}

function renderSection(over: { chartData?: ChartDataPoint[]; stats?: Partial<DriveStats> } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TemperatureSection chartData={over.chartData ?? defaultPoints()} stats={makeStats(over.stats)} />
    </QueryClientProvider>,
  );
}

/** Text of the value node for a metric label (its next sibling within the tile). */
function cellValue(label: string): string {
  const labelEl = screen.getByText(label);
  const valueEl = labelEl.nextElementSibling;
  if (!valueEl) throw new Error(`no value cell for "${label}"`);
  return (valueEl.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const EMPTY_MESSAGE = 'No temperature telemetry is available for this drive.';

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

describe('TemperatureSection — chart chrome + a11y', () => {
  it('renders as a figure named by its title heading, with a role="img" chart body', () => {
    renderSection();

    const figure = screen.getByRole('figure', { name: 'Temperatures' });
    expect(figure.tagName).toBe('FIGURE');

    const heading = screen.getByRole('heading', { level: 3, name: 'Temperatures' });
    expect(heading).toBeInTheDocument();

    // The named group re-states the summary and can contain legend controls.
    const body = screen.getByRole('group', {
      name: /Inside, outside, driver and passenger temperature lines/,
    });
    expect(body).toBeInTheDocument();
  });

  it('resolves the title and chart aria-label through i18n keys with English fallbacks', () => {
    renderSection();

    expect(tSpy).toHaveBeenCalledWith('driveDetail.temperatures', 'Temperatures');
    expect(tSpy).toHaveBeenCalledWith(
      'driveDetail.temperatures.aria',
      'Inside, outside, driver and passenger temperature lines over the drive timeline',
    );
  });
});

describe('TemperatureSection — outside + inside tiles', () => {
  it('shows the outside and inside averages with the °C label under metric preferences', () => {
    renderSection({ stats: { avgOutsideTemp: 15, avgInsideTemp: 21 } });

    expect(cellValue('Outside Temperature')).toBe('15.00°C');
    expect(cellValue('Inside Temperature')).toBe('21.00°C');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.outsideTemp', 'Outside Temperature');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.insideTemp', 'Inside Temperature');
  });

  it('labels the temperatures with °F under Fahrenheit preferences (unit applied at render)', () => {
    mockSettings = { ...mockSettings, unit_of_temp: 'F' };
    renderSection({ stats: { avgOutsideTemp: 59, avgInsideTemp: 70 } });

    // Values are pre-converted upstream; the section only swaps the label.
    expect(cellValue('Outside Temperature')).toBe('59.00°F');
    expect(cellValue('Inside Temperature')).toBe('70.00°F');
    expect(cellValue('Outside Temperature')).not.toContain('°C');
  });

  it('omits the outside/inside tiles when their average is null but the band still renders', () => {
    renderSection({
      stats: { avgOutsideTemp: null, avgInsideTemp: null, driverTemps: [22, 24] },
    });

    expect(screen.queryByText('Outside Temperature')).toBeNull();
    expect(screen.queryByText('Inside Temperature')).toBeNull();
    // …but a populated series keeps the band (and chart branch) alive.
    expect(screen.getByText('Driver Temperature')).toBeInTheDocument();
  });
});

describe('TemperatureSection — driver + passenger averages', () => {
  it('computes and shows the arithmetic mean of the driver and passenger series', () => {
    renderSection({
      stats: {
        driverTemps: [20, 24], // mean 22
        passengerTemps: [18, 20, 22], // mean 20
      },
    });

    expect(cellValue('Driver Temperature')).toBe('22.00°C');
    expect(cellValue('Passenger Temperature')).toBe('20.00°C');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.driverTemp', 'Driver Temperature');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.passengerTemp', 'Passenger Temperature');
  });

  it('averages an uneven series without rounding drift', () => {
    renderSection({ stats: { driverTemps: [10, 11] } }); // mean 10.5
    expect(cellValue('Driver Temperature')).toBe('10.50°C');
  });

  it('omits the driver/passenger tiles entirely when their series are empty', () => {
    renderSection({ stats: { driverTemps: [], passengerTemps: [] } });

    expect(screen.queryByText('Driver Temperature')).toBeNull();
    expect(screen.queryByText('Passenger Temperature')).toBeNull();
    // The outside/inside tiles from the default stats are still present.
    expect(screen.getByText('Outside Temperature')).toBeInTheDocument();
  });
});

describe('TemperatureSection — climate tile', () => {
  it('shows the climate status in the accent colour only when the system is On', () => {
    renderSection({ stats: { climateStatus: 'On' } });

    const value = screen.getByText('On');
    expect(value.textContent).toBe('On');
    expect(value).toHaveClass('text-green-400');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.climate', 'Climate');
  });

  it('renders a non-On status in the muted colour rather than the accent', () => {
    renderSection({ stats: { climateStatus: 'Off' } });

    const value = screen.getByText('Off');
    expect(value).not.toHaveClass('text-green-400');
    expect(value.className).toContain('text-[var(--text-muted)]');
  });

  it('omits the climate tile when the status is unknown', () => {
    renderSection({ stats: { climateStatus: null } });
    expect(screen.queryByText('Climate')).toBeNull();
  });
});

describe('TemperatureSection — fan tile', () => {
  it('renders the fan tile as "Avg <avg> · Max <max>" with an integer average', () => {
    renderSection({ stats: { avgFanSpeed: 2.6, maxFanSpeed: 5 } });

    // fmtInt rounds 2.6 → 3; the tile pairs it with the raw max.
    expect(cellValue('Fan Status')).toBe('Avg 3 · Max 5');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.avg', 'Avg');
    expect(tSpy).toHaveBeenCalledWith('driveDetail.fanStatus', 'Fan Status');
  });

  it('resolves the "Max" label through driveDetail.max (regression: was hard-coded English)', () => {
    renderSection({ stats: { avgFanSpeed: 1, maxFanSpeed: 4 } });

    expect(tSpy).toHaveBeenCalledWith('driveDetail.max', 'Max');
  });

  it('omits the fan tile when there is no fan telemetry', () => {
    renderSection({ stats: { avgFanSpeed: null, maxFanSpeed: null } });
    expect(screen.queryByText('Fan Status')).toBeNull();
  });
});

describe('TemperatureSection — empty state', () => {
  it('collapses to the translated placeholder when there is no temperature at all', () => {
    renderSection({ stats: { hasAnyTemp: false, avgOutsideTemp: null, avgInsideTemp: null } });

    expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    expect(tSpy).toHaveBeenCalledWith('driveDetail.noTemperatureData', EMPTY_MESSAGE);
    // No stat tiles render in the empty branch.
    expect(screen.queryByText('Outside Temperature')).toBeNull();
  });

  it('shows the empty state when there are fewer than two samples even if temps exist', () => {
    renderSection({ chartData: [makePoint({ outsideTemp: 15 })], stats: { hasAnyTemp: true } });

    expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText('Outside Temperature')).toBeNull();
  });

  it('hides the decorative empty-state icon from assistive tech (regression: missing aria-hidden)', () => {
    renderSection({ stats: { hasAnyTemp: false } });

    const message = screen.getByText(EMPTY_MESSAGE);
    const icon = message.parentElement?.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('TemperatureSection — null safety', () => {
  it('never crashes and shows the empty state when the temperature arrays are undefined', () => {
    expect(() =>
      renderSection({
        stats: {
          hasAnyTemp: false,
          avgOutsideTemp: null,
          avgInsideTemp: null,
          outsideTemps: undefined as unknown as number[],
          insideTemps: undefined as unknown as number[],
          driverTemps: undefined as unknown as number[],
          passengerTemps: undefined as unknown as number[],
        },
      }),
    ).not.toThrow();

    expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it('derives averages safely when only some series are present, without NaN', () => {
    renderSection({
      stats: {
        avgOutsideTemp: null,
        avgInsideTemp: null,
        outsideTemps: undefined as unknown as number[],
        insideTemps: undefined as unknown as number[],
        driverTemps: [10, 10], // mean 10
        passengerTemps: undefined as unknown as number[],
      },
    });

    expect(cellValue('Driver Temperature')).toBe('10.00°C');
    expect(screen.queryByText('Passenger Temperature')).toBeNull();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});
