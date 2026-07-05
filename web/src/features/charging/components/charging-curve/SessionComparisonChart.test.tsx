/**
 * SessionComparisonChart — behaviour + hardening coverage.
 *
 * SessionComparisonChart default-exports a single presentational chart that
 * overlays the power-vs-SOC curves of up to the 10 most-recent charging
 * sessions on one shared axis. Its real work is data-shaping, not pixels: it
 * caps the session list, asks the REAL `generateChargingCurve` helper for each
 * session's synthetic curve, then merges those curves onto a unified SOC axis
 * (one row per distinct SOC, one column per session). It also draws a
 * colour-swatch legend and threads a localized title / subtitle / aria summary
 * plus export config into the shared <ChartContainer>.
 *
 * Strategy: the shared chart primitives (<ChartContainer> + the recharts
 * re-exports) are stubbed to lightweight prop-echoing markers — recharts'
 * <ResponsiveContainer> measures 0×0 under jsdom and would render no line
 * paths, so asserting the component's derivations through prop-echo is both
 * deterministic and faithful to what the component itself controls. The pure
 * `generateChargingCurve` / `getChargerLabel` helpers stay REAL so the merge +
 * labelling are exercised end-to-end; `formatDateShort` is pinned to a
 * deterministic prefix so legend assertions don't drift with the runner's
 * timezone; and the chart palette is a fixed 3-colour array so stroke + wrap
 * assertions are exact.
 *
 * Covered facets:
 *   1. CONTAINER — the localized title/subtitle/aria + height + export config.
 *   2. MERGE     — two curves fold onto one 71-row SOC axis; overlap rows carry
 *      both series, non-overlap rows carry only the owning series.
 *   3. LINES     — one <Line> per session with palette stroke, "date (charger)"
 *      name, index dataKey and the kW unit.
 *   4. LEGEND    — one entry per session, each swatch decorative (aria-hidden).
 *   5. CAP+WRAP  — 12 sessions collapse to the 10 newest and the palette wraps
 *      modulo its length.
 *   6. EMPTY     — no sessions ⇒ the container is told it is empty and no line
 *      or legend swatch renders (never a blank panel).
 *   7. NULL-SAFE — an undefined `sessions` prop degrades to the empty state
 *      instead of throwing.
 *
 * Network is never hit: the component is pure/presentational and i18n resolves
 * to the English fallback so visible copy is assertable.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ChargingSession } from '@/api/types';

// Fixed, deterministic palette so stroke + modulo-wrap assertions are exact.
const { PALETTE } = vi.hoisted(() => ({ PALETTE: ['#aa0000', '#00bb00', '#0000cc'] }));

vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => PALETTE,
}));

// English-fallback i18n with {{placeholder}} interpolation (repo convention).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Timezone-stable short date so the legend + line names are assertable.
vi.mock('@/lib/dateFormat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dateFormat')>();
  return {
    ...actual,
    formatDateShort: (iso: string | Date | null | undefined) =>
      iso ? `D:${String(iso).slice(0, 10)}` : '—',
  };
});

// Shared chart primitives → prop-echoing stubs. ChartContainer renders its
// children so the LineChart / Line / legend all mount; recharts re-exports
// echo the derived data the component threads into them.
vi.mock('@/components/charts', () => ({
  ChartContainer: ({
    title,
    subtitle,
    ariaLabel,
    height,
    empty,
    exportable,
    exportFilename,
    children,
  }: {
    title: string;
    subtitle?: string;
    ariaLabel: string;
    height?: number;
    empty?: boolean;
    exportable?: boolean;
    exportFilename?: string;
    children?: ReactNode;
  }) => (
    <figure
      data-testid="chart-container"
      data-title={title}
      data-subtitle={subtitle ?? ''}
      data-aria-label={ariaLabel}
      data-height={String(height ?? '')}
      data-empty={String(!!empty)}
      data-exportable={String(!!exportable)}
      data-export-filename={exportFilename ?? ''}
    >
      {children}
    </figure>
  ),
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="responsive">{children}</div>
  ),
  LineChart: ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
    <div
      data-testid="line-chart"
      data-points={String(Array.isArray(data) ? data.length : 0)}
      data-json={JSON.stringify(data ?? [])}
    >
      {children}
    </div>
  ),
  Line: ({
    dataKey,
    name,
    stroke,
    unit,
  }: {
    dataKey?: string;
    name?: string;
    stroke?: string;
    unit?: string;
  }) => (
    <div
      data-testid="line"
      data-key={dataKey}
      data-name={name}
      data-stroke={stroke}
      data-unit={unit}
    />
  ),
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ChartTooltip: () => null,
  chartGrid: {},
  axisTickSm: {},
  AREA_DEFAULTS: {},
}));

import SessionComparisonChart from './SessionComparisonChart';

function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  const started_at = overrides.started_at ?? '2024-05-01T10:00:00Z';
  return {
    id: 101,
    vehicle_id: 7,
    started_at,
    ended_at: '2024-05-01T10:40:00Z',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 50_000,
    peak_power_w: 150_000,
    avg_power_w: 120_000,
    cost_decimal: 12.5,
    cost_currency: 'USD',
    charger_type: 'Tesla',
    cable_type: null,
    live: false,
    startedAt: started_at,
    duration_min: 40,
    ...overrides,
  };
}

// DC / Supercharger — 20→80%, 150 kW peak. Curve spans SOC 20..80 (61 rows).
const dcSession = makeSession({ id: 101, started_at: '2024-05-01T10:00:00Z' });
// Home / AC — 40→90%, 11 kW peak (< 20 kW ⇒ AC). Curve spans SOC 40..90 (51 rows).
const acSession = makeSession({
  id: 102,
  started_at: '2024-05-02T22:00:00Z',
  start_soc_pct: 40,
  end_soc_pct: 90,
  delta_soc_pct: 50,
  total_energy_added_wh: 30_000,
  peak_power_w: 11_000,
  avg_power_w: null,
  cost_decimal: 4.25,
  charger_type: null,
});

type Point = Record<string, number>;

function chartPoints(): Point[] {
  const chart = screen.getByTestId('line-chart');
  return JSON.parse(chart.getAttribute('data-json') ?? '[]') as Point[];
}

describe('SessionComparisonChart', () => {
  it('threads localized copy, height and export config into the chart container', () => {
    render(<SessionComparisonChart sessions={[dcSession, acSession]} />);

    const container = screen.getByTestId('chart-container');
    expect(container).toHaveAttribute('data-title', 'Session Comparison');
    expect(container).toHaveAttribute(
      'data-subtitle',
      'Power curves overlaid from last 10 sessions',
    );
    expect(container.getAttribute('data-aria-label')).toContain('Overlaid power-vs-SOC line chart');
    expect(container).toHaveAttribute('data-height', '300');
    expect(container).toHaveAttribute('data-exportable', 'true');
    expect(container).toHaveAttribute('data-export-filename', 'session-comparison');
    expect(container).toHaveAttribute('data-empty', 'false');
  });

  it('merges per-session power curves onto one unified SOC axis', () => {
    render(<SessionComparisonChart sessions={[dcSession, acSession]} />);

    // Union of SOC 20..80 (DC) and 40..90 (AC) ⇒ 20..90 ⇒ 71 distinct rows.
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-points', '71');

    const points = chartPoints();
    const at = (soc: number) => points.find((p) => p.soc === soc);

    // Overlap row carries BOTH series (DC 150 kW flat ≤50%, AC 11 kW flat).
    expect(at(50)).toEqual({ soc: 50, s0: 150, s1: 11 });
    // DC-only low end — no AC column yet.
    expect(at(20)).toEqual({ soc: 20, s0: 150 });
    // AC-only high end — DC curve stopped at 80%.
    expect(at(90)).toEqual({ soc: 90, s1: 11 });
    expect(at(20)).not.toHaveProperty('s1');
    expect(at(90)).not.toHaveProperty('s0');
  });

  it('draws one line per session with palette stroke, "date (charger)" name and kW unit', () => {
    render(<SessionComparisonChart sessions={[dcSession, acSession]} />);

    const lines = screen.getAllByTestId('line');
    expect(lines).toHaveLength(2);

    expect(lines[0]).toHaveAttribute('data-key', 's0');
    expect(lines[0]).toHaveAttribute('data-name', 'D:2024-05-01 (Supercharger)');
    expect(lines[0]).toHaveAttribute('data-stroke', PALETTE[0]);
    expect(lines[0]).toHaveAttribute('data-unit', ' kW');

    expect(lines[1]).toHaveAttribute('data-key', 's1');
    expect(lines[1]).toHaveAttribute('data-name', 'D:2024-05-02 (Home / AC)');
    expect(lines[1]).toHaveAttribute('data-stroke', PALETTE[1]);
  });

  it('renders a legend entry per session with a decorative (aria-hidden) swatch', () => {
    const { container } = render(
      <SessionComparisonChart sessions={[dcSession, acSession]} />,
    );

    // One dated legend row per session.
    expect(screen.getByText('D:2024-05-01')).toBeInTheDocument();
    expect(screen.getByText('D:2024-05-02')).toBeInTheDocument();

    // Colour swatches are pure decoration — hidden from assistive tech.
    const swatches = container.querySelectorAll('span.rounded-sm');
    expect(swatches).toHaveLength(2);
    swatches.forEach((sw) => expect(sw).toHaveAttribute('aria-hidden', 'true'));
  });

  it('caps the overlay at the 10 most recent sessions and wraps the palette', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      makeSession({ id: 200 + i, started_at: `2024-06-${String(i + 1).padStart(2, '0')}T10:00:00Z` }),
    );

    render(<SessionComparisonChart sessions={many} />);

    const lines = screen.getAllByTestId('line');
    expect(lines).toHaveLength(10);

    // Palette (length 3) wraps by index modulo its length.
    expect(lines[0]).toHaveAttribute('data-stroke', PALETTE[0]);
    expect(lines[2]).toHaveAttribute('data-stroke', PALETTE[2]);
    expect(lines[3]).toHaveAttribute('data-stroke', PALETTE[0]);
    expect(lines[9]).toHaveAttribute('data-stroke', PALETTE[0]);

    // Ten legend rows too — the 11th and 12th sessions are dropped.
    const legend = screen.getAllByText(/^D:2024-06-/);
    expect(legend).toHaveLength(10);
    expect(screen.queryByText('D:2024-06-11')).not.toBeInTheDocument();
  });

  it('signals the empty state and renders no line or swatch when there are no sessions', () => {
    const { container } = render(<SessionComparisonChart sessions={[]} />);

    expect(screen.getByTestId('chart-container')).toHaveAttribute('data-empty', 'true');
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-points', '0');
    expect(screen.queryAllByTestId('line')).toHaveLength(0);
    expect(container.querySelectorAll('span.rounded-sm')).toHaveLength(0);
  });

  it('is null-safe: degrades to the empty state when sessions is undefined', () => {
    const { container } = render(
      <SessionComparisonChart sessions={undefined as unknown as ChargingSession[]} />,
    );

    expect(screen.getByTestId('chart-container')).toHaveAttribute('data-empty', 'true');
    expect(screen.queryAllByTestId('line')).toHaveLength(0);
    expect(within(container).queryByTestId('line')).toBeNull();
  });
});
