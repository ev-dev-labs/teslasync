/**
 * TemperatureTrendChart — behaviour + hardening contract.
 *
 * TemperatureTrendChart renders the "Temperature Trend" line chart on the
 * drivetrain-health page. It owns no data source of its own — the parent feeds
 * it a `ChartDataPoint[]` whose `outsideTemp` is SI **°C** (`outsideTempAvgC`)
 * and a `loading` flag — so these tests pin the display behaviour that matters
 * and the unit + null hardening this elevation added:
 *
 *   - the container is a three-state switch driven by `empty = length <= 1`:
 *     `loading` → the loading branch (no chart body); a 0- or 1-point series →
 *     the shared EmptyState (role="status"); ≥2 points → the plotted line;
 *   - THE REAL BUG FIXED HERE — the plotted series is now converted to the
 *     user's display unit at the render boundary. The Y-axis label, the
 *     freezing/warm reference bands, and the a11y fallback table already read
 *     in the display unit, but the line itself used to plot raw Celsius, so a
 *     °F preference drew the data on a different scale from its own axis and
 *     reference lines. The series, the reference bands, and the fallback table
 *     now share one scale (identity in °C; converted in °F);
 *   - a per-point `null` reading stays `null` (Recharts gap / "—" table cell)
 *     instead of being coerced to a fabricated number by the converter;
 *   - the converted series is memoised, so a re-render with identical props
 *     returns a stable reference and a unit change recomputes it.
 *
 * Conventions (mirror the sibling drivetrain-health / weekly-digest suites):
 *   - `react-i18next` is stubbed to echo the inline English fallback.
 *   - `@/components/motion` FadeIn is a passthrough (keeps the DOM flat).
 *   - The jsdom-hostile recharts barrel (`@/components/charts`) is replaced with
 *     inert prop-capturing stubs so the derived chart data / reference-line
 *     positions / fallback-table cells are assertable (Recharts measures the
 *     SVG bounding box and jsdom returns 0×0 → empty render).
 *   - `useUnits` is the settings-backed boundary hook, mocked to drive the
 *     °C/°F branch while the REAL `convertTempFromSI` from `@/lib/unitConversion`
 *     runs. The component exposes no interactive controls, so there is no
 *     userEvent surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { TemperatureTrendChart } from './TemperatureTrendChart';
import type { ChartDataPoint } from './constants';
import type { UnitPref } from '@/lib/unitConversion';

/* ── Controllable mock state, hoisted above the vi.mock factories ─────────── */
const H = vi.hoisted(() => ({
  temp: '\u00B0C' as '\u00B0C' | '\u00B0F',
  // Last props captured from the chart primitive stubs.
  container: null as null | {
    title: string;
    subtitle?: string;
    ariaLabel: string;
    loading?: boolean;
    empty?: boolean;
    data?: Array<Record<string, unknown>>;
    dataColumns?: Array<{ key: string; label: string }>;
  },
  lineChartData: null as null | Array<{ date: string; outsideTemp: number | null }>,
  line: null as null | Record<string, unknown>,
  refLines: [] as Array<{ y: unknown; label: unknown; stroke: unknown }>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// FadeIn reaches for matchMedia via useMotionPreference; a passthrough keeps
// the DOM flat and the test focused on TemperatureTrendChart's own output.
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Drive the temperature unit while the REAL SI converter runs. The component
// only reads `unitPrefs.temperature`.
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => {
    const unitPrefs: UnitPref = {
      distance: 'km',
      speed: 'km/h',
      temperature: H.temp,
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
    };
    return { unitPrefs };
  },
}));

/* ── Inert recharts barrel — capture derived chart data / series props ────── */
interface StubColumn {
  key: string;
  label: string;
  format?: (v: unknown) => string;
}
interface StubContainerProps {
  title: string;
  subtitle?: string;
  ariaLabel: string;
  loading?: boolean;
  empty?: boolean;
  data?: Array<Record<string, unknown>>;
  dataColumns?: StubColumn[];
  children?: ReactNode;
}

vi.mock('@/components/charts', () => ({
  AREA_DEFAULTS: { type: 'monotone', strokeWidth: 2 },
  ChartGradient: () => null,
  ChartTooltip: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="responsive">{children}</div>
  ),
  LineChart: ({
    data,
    children,
  }: {
    data?: Array<{ date: string; outsideTemp: number | null }>;
    children?: ReactNode;
  }) => {
    H.lineChartData = data ?? null;
    return (
      <svg data-testid="line-chart" data-count={data?.length ?? 0}>
        {children}
      </svg>
    );
  },
  Line: (props: Record<string, unknown>) => {
    H.line = props;
    return (
      <g
        data-testid="line"
        data-datakey={String(props.dataKey ?? '')}
        data-name={String(props.name ?? '')}
      />
    );
  },
  ReferenceLine: (props: Record<string, unknown>) => {
    const label = props.label as { value?: unknown } | undefined;
    H.refLines.push({ y: props.y, label: label?.value, stroke: props.stroke });
    return (
      <g
        data-testid="reference-line"
        data-y={String(props.y)}
        data-label={String(label?.value ?? '')}
        data-stroke={String(props.stroke ?? '')}
      />
    );
  },
  // Mirrors the real ChartContainer's contract closely enough to assert on:
  // title/subtitle/aria, the three render states, and the always-present
  // (when data is non-empty) a11y fallback table built from data + dataColumns.
  ChartContainer: ({
    title,
    subtitle,
    ariaLabel,
    loading,
    empty,
    data,
    dataColumns,
    children,
  }: StubContainerProps) => {
    H.container = { title, subtitle, ariaLabel, loading, empty, data, dataColumns };
    const hasTable = !!(data && data.length > 0 && dataColumns && dataColumns.length > 0);
    return (
      <figure role="img" aria-label={ariaLabel}>
        <h3>{title}</h3>
        {subtitle ? <p data-testid="subtitle">{subtitle}</p> : null}
        {loading ? <div data-testid="chart-loading">loading</div> : null}
        {empty ? (
          <div role="status" data-testid="chart-empty">
            No data available
          </div>
        ) : null}
        {!loading && !empty ? <div data-testid="chart-body">{children}</div> : null}
        {hasTable ? (
          <table data-testid="fallback-table">
            <thead>
              <tr>
                {dataColumns!.map((c) => (
                  <th key={c.key} data-testid={`col-${c.key}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data!.map((row, i) => (
                <tr key={i} data-testid="fallback-row">
                  {dataColumns!.map((c) => {
                    const raw = row[c.key];
                    const cell = c.format
                      ? c.format(raw)
                      : raw == null
                        ? '\u2014'
                        : String(raw);
                    return (
                      <td key={c.key} data-col={c.key}>
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </figure>
    );
  },
}));

/* ── Unicode glyphs (escaped to avoid encoding drift) ─────────────────────── */
const DASH = '\u2014'; // —
const DEGC = '\u00B0C';
const DEGF = '\u00B0F';

/* ── Fixtures ─────────────────────────────────────────────────────────────── */
function pt(overrides: Partial<ChartDataPoint> = {}): ChartDataPoint {
  return { date: 'Mon', powerMax: 0, powerMin: 0, outsideTemp: 10, distance: 0, ...overrides };
}

// Two SI °C points that convert to clean °F integers: 10 °C → 50, 20 °C → 68.
const twoPoints: ChartDataPoint[] = [
  pt({ date: 'Mon', outsideTemp: 10 }),
  pt({ date: 'Tue', outsideTemp: 20 }),
];

/* ── DOM read helpers ─────────────────────────────────────────────────────── */
function tempCells(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('td[data-col="outsideTemp"]')).map(
    (el) => el.textContent ?? '',
  );
}

function refLine(label: string): HTMLElement | null {
  return (
    screen.getAllByTestId('reference-line').find((el) => el.getAttribute('data-label') === label) ??
    null
  );
}

function plottedTemps(): Array<number | null> {
  return (H.lineChartData ?? []).map((d) => d.outsideTemp);
}

beforeEach(() => {
  H.temp = '\u00B0C';
  H.container = null;
  H.lineChartData = null;
  H.line = null;
  H.refLines = [];
});

/* ── Structure / a11y / i18n ──────────────────────────────────────────────── */
describe('TemperatureTrendChart — structure & accessibility', () => {
  it('renders an accessible chart figure with the localized title and subtitle', () => {
    render(<TemperatureTrendChart data={twoPoints} />);

    // role="img" carries the accessible name for assistive tech.
    expect(
      screen.getByRole('img', {
        name: 'Outside temperature trend line chart per recent drive',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Temperature Trend' })).toBeInTheDocument();
    expect(screen.getByTestId('subtitle')).toHaveTextContent(
      'Outside temperature recorded during recent drives',
    );
  });

  it('names the plotted series and both reference bands via i18n fallbacks', () => {
    render(<TemperatureTrendChart data={twoPoints} />);

    expect(screen.getByTestId('line')).toHaveAttribute('data-datakey', 'outsideTemp');
    expect(screen.getByTestId('line')).toHaveAttribute('data-name', 'Outside Temp');
    expect(refLine('Warm Zone')).not.toBeNull();
    expect(refLine('Freezing')).not.toBeNull();
  });
});

/* ── Three-state switch (loading / empty / populated) ─────────────────────── */
describe('TemperatureTrendChart — render states', () => {
  it('passes loading through and suppresses the chart body while loading', () => {
    render(<TemperatureTrendChart data={twoPoints} loading />);

    expect(H.container?.loading).toBe(true);
    expect(screen.getByTestId('chart-loading')).toBeInTheDocument();
    // The recharts body (and thus the line) must not render while loading.
    expect(screen.queryByTestId('chart-body')).not.toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
  });

  it('marks the chart empty and shows a status region for a zero-point series', () => {
    render(<TemperatureTrendChart data={[]} />);

    expect(H.container?.empty).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('No data available');
    expect(screen.queryByTestId('chart-body')).not.toBeInTheDocument();
    // A truly empty series carries no fallback table rows either.
    expect(screen.queryByTestId('fallback-table')).not.toBeInTheDocument();
  });

  it('treats a single-point series as empty (length <= 1) but still surfaces it to SR users', () => {
    const { container } = render(<TemperatureTrendChart data={[pt({ outsideTemp: 12 })]} />);

    // One point is not enough to plot a trend → empty branch, no chart body…
    expect(H.container?.empty).toBe(true);
    expect(screen.queryByTestId('chart-body')).not.toBeInTheDocument();
    // …yet the lone reading is still exposed in the accessible fallback table.
    expect(tempCells(container)).toEqual(['12']);
  });

  it('renders the plotted line for a series of two or more points', () => {
    render(<TemperatureTrendChart data={twoPoints} />);

    expect(H.container?.empty).toBe(false);
    expect(screen.getByTestId('chart-body')).toBeInTheDocument();
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-count', '2');
  });

  it('null-safely defaults a missing data prop to an empty series without throwing', () => {
    // Defensive: the typed prop is required, but a JS caller may omit it.
    expect(() =>
      render(<TemperatureTrendChart data={undefined as unknown as ChartDataPoint[]} />),
    ).not.toThrow();
    expect(H.container?.empty).toBe(true);
  });
});

/* ── Unit conversion — °C identity ────────────────────────────────────────── */
describe('TemperatureTrendChart — °C (identity) scale', () => {
  it('plots the raw Celsius values and labels the column + reference bands in °C', () => {
    const { container } = render(<TemperatureTrendChart data={twoPoints} />);

    expect(screen.getByTestId('col-outsideTemp')).toHaveTextContent(`Outside (${DEGC})`);
    expect(tempCells(container)).toEqual(['10', '20']);
    expect(plottedTemps()).toEqual([10, 20]);
    // 35 °C warm band and 0 °C freezing band are identities in °C.
    expect(refLine('Warm Zone')).toHaveAttribute('data-y', '35');
    expect(refLine('Freezing')).toHaveAttribute('data-y', '0');
  });
});

/* ── Unit conversion — °F (the real bug fixed here) ───────────────────────── */
describe('TemperatureTrendChart — °F scale (series, axis & bands agree)', () => {
  it('converts the plotted series, the fallback table, and both reference bands to °F', () => {
    H.temp = '\u00B0F';
    const { container } = render(<TemperatureTrendChart data={twoPoints} />);

    // Column label follows the preference…
    expect(screen.getByTestId('col-outsideTemp')).toHaveTextContent(`Outside (${DEGF})`);
    // …the plotted series is converted (10 °C → 50 °F, 20 °C → 68 °F)…
    expect(plottedTemps()).toEqual([50, 68]);
    expect(tempCells(container)).toEqual(['50', '68']);
    // …and the reference bands land on the SAME °F scale (35 °C → 95, 0 °C → 32).
    expect(refLine('Warm Zone')).toHaveAttribute('data-y', '95');
    expect(refLine('Freezing')).toHaveAttribute('data-y', '32');
  });

  it('regression guard: never plots raw Celsius under a °F axis', () => {
    H.temp = '\u00B0F';
    const { container } = render(<TemperatureTrendChart data={twoPoints} />);

    // The old bug plotted 10 / 20 (Celsius) while the axis + bands read °F.
    expect(plottedTemps()).not.toContain(10);
    expect(plottedTemps()).not.toContain(20);
    expect(tempCells(container)).not.toContain('10');
    expect(tempCells(container)).not.toContain('20');
  });
});

/* ── Null safety ──────────────────────────────────────────────────────────── */
describe('TemperatureTrendChart — null readings', () => {
  it('keeps a null reading as a gap while converting its finite siblings', () => {
    H.temp = '\u00B0F';
    const { container } = render(
      <TemperatureTrendChart
        data={[
          pt({ date: 'Mon', outsideTemp: 10 }),
          pt({ date: 'Tue', outsideTemp: null }),
          pt({ date: 'Wed', outsideTemp: 20 }),
        ]}
      />,
    );

    // The null stays null (no NaN, no fabricated 0) so Recharts draws a gap…
    expect(plottedTemps()).toEqual([50, null, 68]);
    // …and the fallback table renders the neutral "—" marker for that row only.
    expect(tempCells(container)).toEqual(['50', DASH, '68']);
  });
});

/* ── Memoisation (perf facet) ─────────────────────────────────────────────── */
describe('TemperatureTrendChart — memoised series', () => {
  it('returns a stable series reference across re-renders with identical props', () => {
    const { rerender } = render(<TemperatureTrendChart data={twoPoints} />);
    const first = H.lineChartData;

    rerender(<TemperatureTrendChart data={twoPoints} />);
    const second = H.lineChartData;

    // useMemo keyed on [data, tempUnit] returns the cached array unchanged.
    expect(second).toBe(first);
  });

  it('recomputes the series when the temperature unit changes', () => {
    const { rerender } = render(<TemperatureTrendChart data={twoPoints} />);
    const celsius = H.lineChartData;
    expect(celsius?.map((d) => d.outsideTemp)).toEqual([10, 20]);

    H.temp = '\u00B0F';
    rerender(<TemperatureTrendChart data={twoPoints} />);
    const fahrenheit = H.lineChartData;

    expect(fahrenheit).not.toBe(celsius);
    expect(fahrenheit?.map((d) => d.outsideTemp)).toEqual([50, 68]);
  });
});
